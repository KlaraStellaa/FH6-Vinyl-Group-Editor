'use strict';
/* 通用缩略图磁盘缓存（渲染层一侧）。
   主进程侧实现在 main.js：genericThumbPath / svg-thumb-cache-get / -put / -drop，
   缓存目录 userData/thumb-cache/<命名空间>/<sha1>.png，URL 走 app://thumb-cache/<ns>/<key>.png。

   为什么需要它：
   · 工作进程卡的缩略图（fza.js 的 App.fzaSvgThumb）以前每次都把整份模型重新导出成
     SVG 再交给隐藏进程光栅化 —— 文档动辄上千图层，启动主页要等很久；
   · 「彩绘纹饰」面板（App.libThumb）以前每次都把素材里那 1400 个内嵌 JPEG 逐个解码、
     逐像素染色成白色剪影 —— 只在内存 Map 里留着，进程一退就全没了。
   两者都属于「输入不变则输出不变」的纯计算，正适合落盘。

   ★ 缓存 key 必须随「内容版本」变化（工作进程 = name+mtime；素材 = 素材文件 mtime），
     否则文件更新后仍旧命中旧图 —— 这是本功能要解决的原始问题。 */

/* 版本号：渲染逻辑（剪影染色 / 光栅化参数）一变就必须升，否则旧缓存不失效。
   与主页那套 thumb-v8-480 同理（见 §4.2 交接书 3.4 节）。 */
App.LIB_THUMB_NS = 'lib-thumb-v1';

/* 把「身份串」变成 40 位十六进制 key。
   用同步实现的 SHA-1：身份串很短（名字+mtime），无需异步，也不用引第三方库。
   纯实现，独立于被测逻辑，供 __tests__ / 判据直接调用。 */
(function () {
  const K = [
    0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xca62c1d6
  ];
  function rotl(n, s) { return ((n << s) | (n >>> (32 - s))) >>> 0; }
  /* 输入按 UTF-8 编码成字节（名字可能是中文） */
  function utf8Bytes(str) {
    const out = [];
    for (let i = 0; i < str.length; i++) {
      let c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0xd800 || c >= 0xe000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else {
        const c2 = str.charCodeAt(++i);
        const cp = 0x10000 + (((c & 0x3ff) << 10) | (c2 & 0x3ff));
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      }
    }
    return out;
  }
  App.sha1Hex = function (str) {
    const bytes = utf8Bytes(String(str == null ? '' : str));
    const bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    const hi = Math.floor(bitLen / 4294967296), lo = bitLen >>> 0;
    for (let i = 3; i >= 0; i--) bytes.push((hi >>> (i * 8)) & 0xff);
    for (let i = 3; i >= 0; i--) bytes.push((lo >>> (i * 8)) & 0xff);
    let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
    const w = new Array(80);
    for (let off = 0; off < bytes.length; off += 64) {
      for (let i = 0; i < 16; i++) {
        w[i] = ((bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) |
          (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3]) >>> 0;
      }
      for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
      let a = h0, b = h1, c = h2, d = h3, e = h4;
      for (let i = 0; i < 80; i++) {
        let f, k;
        if (i < 20) { f = (b & c) | (~b & d); k = K[0]; }
        else if (i < 40) { f = b ^ c ^ d; k = K[1]; }
        else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = K[2]; }
        else { f = b ^ c ^ d; k = K[3]; }
        const tmp = (rotl(a, 5) + f + e + k + w[i]) >>> 0;
        e = d; d = c; c = rotl(b, 30); b = a; a = tmp;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0;
      h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
    }
    return [h0, h1, h2, h3, h4].map(n => ('00000000' + n.toString(16)).slice(-8)).join('');
  };
})();

App.thumbCacheKey = function (identity) {
  return (/^[a-f0-9]{40}$/.test(String(identity || ''))) ? String(identity) : App.sha1Hex(identity);
};

/* 批量查盘：命中返回 Map<identity, url>。失败一律静默（缓存是优化，不是功能）。 */
App.thumbCacheLookup = async function (ns, identities) {
  const out = new Map();
  const list = (identities || []).filter(Boolean);
  if (!list.length || !App.sha1Hex) return out;
  const keyToId = new Map();
  list.forEach(id => keyToId.set(App.thumbCacheKey(id), id));
  const keys = Array.from(keyToId.keys());
  try {
    if (window.sveApi && typeof window.sveApi.thumbCacheGet === 'function') {
      const r = await window.sveApi.thumbCacheGet(ns, keys);
      if (r && r.ok) {
        (r.hits || []).forEach((k, i) => {
          const id = keyToId.get(k);
          if (id) out.set(id, (r.urls && r.urls[i]) || ('app://thumb-cache/' + ns + '/' + k + '.png'));
        });
      }
    }
  } catch (e) { console.warn('[thumb-cache] 查盘失败', String(e && e.message || e).slice(0, 160)); }
  return out;
};

/* 写盘一个 dataURL。返回落盘后的 URL（可直接当 <img src>），失败返回 ''。 */
App.thumbCacheStore = async function (ns, identity, dataUrl) {
  if (!dataUrl || !window.sveApi || typeof window.sveApi.thumbCachePut !== 'function') return '';
  try {
    const r = await window.sveApi.thumbCachePut(ns, App.thumbCacheKey(identity), dataUrl);
    return (r && r.ok && r.url) ? r.url : '';
  } catch (e) {
    console.warn('[thumb-cache] 落盘失败', String(e && e.message || e).slice(0, 160));
    return '';
  }
};

/* 失效：删掉若干 identity 的缓存。keys 为空数组时，主进程会清空整个命名空间。 */
App.thumbCacheDrop = async function (ns, identities) {
  try {
    if (!window.sveApi || typeof window.sveApi.thumbCacheDrop !== 'function') return false;
    const keys = (identities || []).filter(Boolean).map(App.thumbCacheKey);
    const r = await window.sveApi.thumbCacheDrop(ns, keys);
    return !!(r && r.ok);
  } catch (e) { return false; }
};
