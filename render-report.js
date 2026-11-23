'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const SCHEMA = 1;
const MAX_EVENTS = 2000;
const MAX_EVENT_BYTES = 2048;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;

function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xFF;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosTime(d) {
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
  const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date };
}

function makeZip(entries, when) {
  const d = when || new Date();
  const { time, date } = dosTime(d);
  const locals = [];
  const centrals = [];
  let offset = 0;
  entries.forEach(function (e) {
    const name = Buffer.from(e.name, 'utf8');
    const raw = e.data;
    const crc = crc32(raw);
    let method = 0, body = raw;
    if (raw.length > 64) {
      const z = zlib.deflateRawSync(raw, { level: 6 });
      if (z.length < raw.length) { method = 8; body = z; }
    }
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(time, 10);
    lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, body);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(time, 12);
    ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);

    offset += 30 + name.length + body.length;
  });
  const cdBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([Buffer.concat(locals), cdBuf, eocd]);
}

const NUM_OK = /^-?\d{1,12}(\.\d{1,3})?$/;
const STR_MAX = 80;
const FORBIDDEN_KEY = /^(name|fileName|path|url|user|password|key|clipboard|text|content|svg|bitmap|dataUrl|base64)$/i;
const STR_FIELDS = new Set(['event', 'build', 'session', 'proc', 'doc', 'owner', 'tier', 'path', 'reason',
  'nextOwner', 'priorBit', 'vector', 'coversCell', 'alternativeOwner', 'report', 'symptom',
  'expectedLayer', 'source', 'mode', 'ok', 'why', 'err', 'kind', 'scope', 'fallback', 'reasonCode']);
const ARR_FIELDS = new Set(['cell', 'roi', 'top', 'bits']);

function cleanEvent(e) {
  if (!e || typeof e !== 'object') return null;
  if (typeof e.event !== 'string' || !/^[a-z][a-z0-9.]{1,30}$/.test(e.event)) return null;
  const out = {};
  let n = 0;
  for (const k in e) {
    if (FORBIDDEN_KEY.test(k)) continue;
    const v = e[k];
    if (typeof v === 'number') {
      if (isFinite(v) && NUM_OK.test(String(v))) { out[k] = v; n++; }
      continue;
    }
    if (typeof v === 'boolean') { out[k] = v; n++; continue; }
    if (typeof v === 'string') {
      if (STR_FIELDS.has(k) || k === 'event') { out[k] = v.slice(0, STR_MAX); n++; }
      continue;
    }
    if (Array.isArray(v) && (ARR_FIELDS.has(k) || k === 'top' || k === 'bits')) {
      out[k] = v.slice(0, 8).map(function (x) { return typeof x === 'number' && isFinite(x) ? Math.round(x) : 0; });
      n++;
      continue;
    }
  }
  const line = JSON.stringify(out);
  if (Buffer.byteLength(line) > MAX_EVENT_BYTES) {
    delete out.top; delete out.bits;
    const l2 = JSON.stringify(out);
    if (Buffer.byteLength(l2) > MAX_EVENT_BYTES) return null;
  }
  return out;
}

function sanitizePayload(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const schema = parseInt(p.schema, 10) || 0;
  if (schema !== SCHEMA) return { error: '不支持的主版本：' + (p.schema === undefined ? '缺失' : String(p.schema).slice(0, 12)), code: 'schema' };
  const rawEvents = Array.isArray(p.events) ? p.events : [];
  if (rawEvents.length > MAX_EVENTS) return { error: '事件条数超限：' + rawEvents.length + ' > ' + MAX_EVENTS, code: 'too-many-events' };
  const events = [];
  for (let i = 0; i < rawEvents.length; i++) {
    const c = cleanEvent(rawEvents[i]);
    if (c) events.push(c);
  }
  const reports = (Array.isArray(p.reports) ? p.reports : []).slice(0, 20).map(function (r) {
    return {
      id: String(r && r.id || '').slice(0, 12),
      symptom: String(r && r.symptom || '').slice(0, 24),
      cell: Array.isArray(r && r.cell) ? r.cell.slice(0, 4).map(Number) : null,
      roi: Array.isArray(r && r.roi) ? r.roi.slice(0, 4).map(Number) : null,
      expectedLayer: typeof (r && r.expectedLayer) === 'number' ? r.expectedLayer : null,
      docEpoch: Number(r && r.docEpoch) || 0,
      contentRev: Number(r && r.contentRev) || 0,
      viewRev: Number(r && r.viewRev) || 0,
      frozenSeq: Number(r && r.frozenSeq) || 0,
      evidence: String(r && r.evidence || 'candidate').slice(0, 16)
    };
  });
  const sys = (p.sys && typeof p.sys === 'object') ? p.sys : {};
  const manifest = {
    schema: SCHEMA,
    kind: 'render-report',
    generatedAt: new Date().toISOString(),
    build: String(p.build || '').slice(0, 24),
    session: String(p.session || '').slice(0, 12),
    proc: String(p.proc || '').slice(0, 12),
    app: {
      product: String(sys.product || 'FH6 Vinyl Group Editor').slice(0, 40),
      version: String(sys.version || '').slice(0, 20),
    },
    env: {
      platform: String(sys.platform || '').slice(0, 16),
      osRelease: String(sys.osRelease || '').slice(0, 24),
      electron: String(sys.electron || '').slice(0, 16),
      chrome: String(sys.chrome || '').slice(0, 16),
      gpuAccel: String(sys.gpuAccel || 'unknown').slice(0, 16),
      dpr: Number(sys.dpr) || 0,
      refreshHz: Number(sys.refreshHz) || 0,
      refreshMeasurable: !!sys.refreshMeasurable,
      canvas: Array.isArray(sys.canvas) ? sys.canvas.slice(0, 2).map(Number) : null,
    },
    counts: {
      events: events.length,
      dropped: Number(p.counts && p.counts.lost) || 0,
      seqMax: Number(p.counts && p.counts.seq) || 0,
    },
    gaps: Array.isArray(p.gapRanges) ? p.gapRanges.slice(0, 20) : [],
    flags: { diagRender: true, screenshots: false },
  };
  const summary = String(p.summary || '').slice(0, 64 * 1024);
  return { manifest, events, reports, summary };
}

function writeRenderReport(dir, payload) {
  let clean;
  try {
    clean = sanitizePayload(payload);
  } catch (e) {
    return { ok: false, error: '诊断包内容解析失败', detail: String(e && e.message || e) };
  }
  if (clean.error) return { ok: false, error: clean.error, code: clean.code };

  const jsonl = clean.events.map(function (e) { return JSON.stringify(e); }).join('\n') + (clean.events.length ? '\n' : '');
  const report = {
    schema: SCHEMA,
    reports: clean.reports,
    evidenceLevel: clean.reports.length ? clean.reports[clean.reports.length - 1].evidence : 'insufficient',
    note: '本包只含结构化诊断事件与用户标记；不含作品内容、文件名、路径、位图与按键。',
  };
  const entries = [
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(clean.manifest, null, 1), 'utf8') },
    { name: 'events.jsonl', data: Buffer.from(jsonl, 'utf8') },
    { name: 'report.json', data: Buffer.from(JSON.stringify(report, null, 1), 'utf8') },
    { name: 'summary.txt', data: Buffer.from(clean.summary || '（无摘要）', 'utf8') },
  ];
  const total = entries.reduce(function (n, e) { return n + e.data.length; }, 0);
  if (total > MAX_TOTAL_BYTES) return { ok: false, error: '诊断包超限：' + total + ' 字节 > ' + MAX_TOTAL_BYTES, code: 'too-big' };

  const zip = makeZip(entries);
  const id = 'RR-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {   }
  const file = path.join(dir, 'render-report-' + id + '.zip');
  const tmp = file + '.tmp';
  try {
    fs.writeFileSync(tmp, zip);
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (e2) {   }
    return { ok: false, error: '写入失败（磁盘空间 / 权限）', detail: String(e && e.message || e), dir: dir };
  }
  return {
    ok: true, path: file, id: id, bytes: zip.length,
    entries: entries.map(function (e) { return { name: e.name, bytes: e.data.length }; }),
    events: clean.events.length,
    dropped: clean.manifest.counts.dropped,
  };
}

module.exports = { SCHEMA, writeRenderReport, makeZip, sanitizePayload, cleanEvent, crc32 };
