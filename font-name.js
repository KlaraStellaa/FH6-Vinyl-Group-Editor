'use strict';
/* 字体家族名解析（主进程，纯函数，可 node 直接 require）。
   支持 sfnt（ttf / otf）、ttc、woff、woff2 —— 只读 `name` 表，不解析字形。
   解析不出来就回 null，由调用方用文件名兜底（绝不因为字体名读不出就导入失败）。

   为什么不用现成库：本仓零运行时依赖（只有 electron 两个 devDependency），
   打包体积与「新增主进程模块必须同步 build.files」的约束都要求自足。 */
const zlib = require('zlib');

/* name 表：format(2) count(2) stringOffset(2)，随后 count 条 12 字节记录 */
function parseNameTable(buf, off, len) {
  if (!buf || off + 6 > buf.length) return null;
  const end = Math.min(buf.length, off + (len || buf.length - off));
  const count = buf.readUInt16BE(off + 2);
  const strOff = off + buf.readUInt16BE(off + 4);
  const cands = [];
  for (let i = 0; i < count; i++) {
    const r = off + 6 + i * 12;
    if (r + 12 > end) break;
    const platformID = buf.readUInt16BE(r);
    const encodingID = buf.readUInt16BE(r + 2);
    const languageID = buf.readUInt16BE(r + 4);
    const nameID = buf.readUInt16BE(r + 6);
    const length = buf.readUInt16BE(r + 8);
    const offset = buf.readUInt16BE(r + 10);
    if (nameID !== 1 && nameID !== 4 && nameID !== 16) continue;
    const s = strOff + offset;
    if (s + length > buf.length) continue;
    let text = '';
    if (platformID === 3 || platformID === 0) {
      /* Windows / Unicode：UTF-16BE */
      const b = Buffer.from(buf.subarray(s, s + length));
      if (b.length % 2) continue;
      b.swap16();
      text = b.toString('utf16le');
    } else if (platformID === 1) {
      /* Macintosh / Roman：ASCII 覆盖足够（字体家族名基本都是 ASCII） */
      text = buf.toString('latin1', s, s + length);
    } else continue;
    text = String(text).replace(/\u0000/g, '').trim();
    if (!text) continue;
    /* 优先级：nameID 16（排版家族）> 1（家族）> 4（完整名）；
       Windows 英文（languageID 0x0409）优先，其余同分按出现顺序 */
    let score = nameID === 16 ? 300 : nameID === 1 ? 200 : 100;
    if (platformID === 3) score += 20;
    if (languageID === 0x0409) score += 10;
    cands.push({ text, score });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.score - a.score);
  return cands[0].text;
}

function sfntTable(buf, base, tag) {
  const numTables = buf.readUInt16BE(base + 4);
  for (let i = 0; i < numTables; i++) {
    const r = base + 12 + i * 16;
    if (r + 16 > buf.length) return null;
    if (buf.toString('latin1', r, r + 4) === tag) {
      return { offset: buf.readUInt32BE(r + 8), length: buf.readUInt32BE(r + 12) };
    }
  }
  return null;
}

const WOFF2_TAGS = ('cmap head hhea hmtx maxp name OS/2 post cvt  fpgm glyf loca prep CFF  VORG EBDT EBLC gasp hdmx kern LTSH PCLT VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG  sbix acnt avar bdat bloc bsln cvar fdsc feat fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill').split(' ');

function readBase128(buf, p) {
  let v = 0;
  for (let i = 0; i < 5; i++) {
    const b = buf[p.i++];
    if (b === undefined) throw new Error('woff2 dir truncated');
    v = (v << 7) | (b & 0x7f);
    if (!(b & 0x80)) return v >>> 0;
  }
  throw new Error('woff2 base128 too long');
}

/* WOFF2：目录里只有长度，数据是**一整块 brotli**；name 表本身不被变换，
   按目录顺序累加长度即可切出来（glyf/loca 用变换后长度）。 */
function woff2NameTable(buf) {
  const numTables = buf.readUInt16BE(12);
  const totalCompressedSize = buf.readUInt32BE(20);
  let p = { i: 48 };
  const dir = [];
  for (let i = 0; i < numTables; i++) {
    const flags = buf[p.i++];
    let tag;
    const idx = flags & 0x3f;
    if (idx === 63) { tag = buf.toString('latin1', p.i, p.i + 4); p.i += 4; }
    else tag = WOFF2_TAGS[idx];
    const origLength = readBase128(buf, p);
    let transformed;
    if (tag === 'glyf' || tag === 'loca') transformed = ((flags >> 6) === 0);
    else transformed = ((flags >> 6) === 3);
    const storeLength = transformed ? readBase128(buf, p) : origLength;
    dir.push({ tag, storeLength });
  }
  const dataStart = p.i;
  const data = buf.subarray(dataStart, dataStart + totalCompressedSize);
  const raw = zlib.brotliDecompressSync(data);
  let off = 0;
  for (const e of dir) {
    if (e.tag === 'name') return { buf: raw, off: off, len: e.storeLength };
    off += e.storeLength;
  }
  return null;
}

/* 主入口：Buffer → 家族名（string）或 null */
function readFamilyName(buf) {
  if (!buf || buf.length < 12) return null;
  const sig = buf.toString('latin1', 0, 4);
  try {
    if (sig === 'wOFF') {
      const numTables = buf.readUInt16BE(12);
      for (let i = 0; i < numTables; i++) {
        const r = 44 + i * 20;
        if (r + 20 > buf.length) break;
        if (buf.toString('latin1', r, r + 4) !== 'name') continue;
        const offset = buf.readUInt32BE(r + 4);
        const compLength = buf.readUInt32BE(r + 8);
        const origLength = buf.readUInt32BE(r + 12);
        const slice = buf.subarray(offset, offset + compLength);
        const table = compLength < origLength ? zlib.inflateSync(slice) : slice;
        return parseNameTable(table, 0, table.length);
      }
      return null;
    }
    if (sig === 'wOF2') {
      const t = woff2NameTable(buf);
      if (!t) return null;
      return parseNameTable(t.buf, t.off, t.len);
    }
    if (sig === 'ttcf') {
      const numFonts = buf.readUInt32BE(8);
      if (!numFonts) return null;
      const base = buf.readUInt32BE(12);
      const t = sfntTable(buf, base, 'name');
      return t ? parseNameTable(buf, t.offset, t.length) : null;
    }
    /* sfnt：0x00010000（TrueType）/ OTTO（CFF）/ true / typ1 */
    if (sig === '\u0000\u0001\u0000\u0000' || sig === 'OTTO' || sig === 'true' || sig === 'typ1') {
      const t = sfntTable(buf, 0, 'name');
      return t ? parseNameTable(buf, t.offset, t.length) : null;
    }
    /* 兜底：有的字体 sfntVersion 是别的值，但表目录结构相同 */
    const t = sfntTable(buf, 0, 'name');
    if (t) return parseNameTable(buf, t.offset, t.length);
  } catch (e) {
    return null;
  }
  return null;
}

module.exports = { readFamilyName };
