'use strict';


const fs = require('fs');
const path = require('path');


const PROXIES = [
  'https://gh-proxy.com/',
  'https://ghfast.top/',
  'https://hk.gh-proxy.com/',
  'https://edgeone.gh-proxy.com/'
];


function endpoints(url) {
  const u = String(url || '');
  if (!u) return [];
  const out = [u];
  for (const p of PROXIES) {
    const cand = p + u;
    if (out.indexOf(cand) < 0) out.push(cand);
  }
  return out;
}


function proxyHost(prefix) {
  try { return new URL(prefix).host; } catch (e) { return String(prefix || ''); }
}

function readPreferred(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const p = String((j && j.prefix) || '');
    return p === '' || PROXIES.indexOf(p) >= 0 ? p : '';
  } catch (e) { return ''; }
}
function writePreferred(file, prefix) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ prefix: String(prefix || ''), at: Date.now() }, null, 2), 'utf8');
  } catch (e) {  }
}


function getJson(url, net, timeoutMs) {
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = net.request({ method: 'GET', url: String(url), redirect: 'follow' });
    } catch (e) { reject(e); return; }
    let done = false;
    const finish = (err, val) => {
      if (done) return;
      done = true;
      try { clearTimeout(timer); } catch (e) {  }
      if (err) reject(err); else resolve(val);
    };
    const timer = setTimeout(() => { try { req.abort(); } catch (e) {  } finish(new Error('timeout')); }, timeoutMs || 8000);
    try {
      req.setHeader('User-Agent', 'VinylFH6-UpdateCheck');
      req.setHeader('Accept', 'application/vnd.github+json');
      req.setHeader('Accept-Encoding', 'identity');
    } catch (e) {  }
    let body = '';
    req.on('response', res => {
      if (res.statusCode !== 200) { finish(new Error('HTTP ' + res.statusCode)); return; }
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { finish(null, JSON.parse(body)); } catch (e) { finish(e); }
      });
      res.on('error', e => finish(e));
      res.on('aborted', () => finish(new Error('aborted')));
    });
    req.on('error', e => finish(e));
    req.end();
  });
}


function fetchReleaseJson(url, opts) {
  const o = opts || {};
  const net = o.net;
  const timeoutMs = o.timeoutMs || 9000;
  const cands = endpoints(url);   
  return new Promise((resolve, reject) => {
    let pending = cands.length;
    let lastErr = new Error('no-endpoint');
    if (!pending) { reject(lastErr); return; }
    let settled = false;
    cands.forEach(cand => {
      Promise.resolve().then(() => getJson(cand, net, timeoutMs)).then(json => {
        if (settled) return;
        settled = true;
        resolve({ json: json, url: cand });
      }).catch(err => {
        lastErr = err;
        pending--;
        if (!pending && !settled) reject(lastErr);
      });
    });
  });
}




function probeMirrors(url, opts) {
  const o = opts || {};
  const net = o.net;
  const timeoutMs = o.timeoutMs || 8000;
  const cands = endpoints(url);
  const results = [];
  return new Promise(resolve => {
    let pending = cands.length;
    if (!pending) { resolve([]); return; }
    const done = () => { if (--pending <= 0) resolve(results.sort((a, b) => a.ms - b.ms)); };
    cands.forEach(cand => {
      const t0 = Date.now();
      let req;
      try {
        req = net.request({ method: 'GET', url: cand, redirect: 'follow' });
      } catch (e) { done(); return; }
      let settled = false;
      const finish = ok => {
        if (settled) return;
        settled = true;
        try { clearTimeout(timer); } catch (e) {  }
        try { req.abort(); } catch (e) {  }
        if (ok) results.push({ url: cand, ms: Date.now() - t0 });
        done();
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      try {
        req.setHeader('Range', 'bytes=0-65535');
        req.setHeader('User-Agent', 'VinylFH6-Updater');
        req.setHeader('Accept-Encoding', 'identity');
      } catch (e) {  }
      req.on('response', res => finish(res.statusCode === 200 || res.statusCode === 206));
      req.on('error', () => finish(false));
      req.end();
    });
  });
}


const DL_IDLE_MS = 45000;
function downloadToFile(url, dest, onPct, net) {
  return new Promise((resolve, reject) => {
    let out;
    try { out = fs.createWriteStream(dest); } catch (e) { reject(e); return; }
    let req = null;
    let settled = false;
    let idleTimer = null;
    const report = (pct, got, total) => {
      try { if (typeof onPct === 'function') onPct(pct, got, total); } catch (e) {  }
    };
    const fail = err => {
      if (settled) return;
      settled = true;
      if (idleTimer) { try { clearTimeout(idleTimer); } catch (e) {  } idleTimer = null; }
      try { out.destroy(); } catch (e) {  }
      try { fs.unlinkSync(dest); } catch (e) {  }
      reject(err);
    };
    out.on('error', fail);
    try { req = net.request({ method: 'GET', url: String(url), redirect: 'follow' }); }
    catch (e) { fail(e); return; }
    try {
      req.setHeader('User-Agent', 'VinylFH6-Updater');
      
      req.setHeader('Accept-Encoding', 'identity');
    } catch (e) {  }
    const armIdle = () => {
      if (idleTimer) { try { clearTimeout(idleTimer); } catch (e) {  } }
      idleTimer = setTimeout(() => {
        try { req.abort(); } catch (e) {  }
        fail(new Error('timeout'));
      }, DL_IDLE_MS);
    };
    armIdle();
    req.on('response', res => {
      if (res.statusCode !== 200) { fail(new Error('HTTP ' + res.statusCode)); return; }
      const total = Number((res.headers && res.headers['content-length']) || 0);
      let got = 0;
      report(0, 0, total);
      res.on('data', chunk => {
        armIdle();
        got += chunk.length;
        let ok = true;
        try { ok = out.write(chunk); } catch (e) { fail(e); return; }
        if (ok === false) {
          try { res.pause(); } catch (e) {  }
          out.once('drain', () => { try { res.resume(); } catch (e) {  } });
        }
        if (total) report(Math.min(99, Math.round(got / total * 100)), got, total);
        else report(-1, got, total);
      });
      res.on('end', () => {
        if (idleTimer) { try { clearTimeout(idleTimer); } catch (e) {  } idleTimer = null; }
        if (total && got !== total) { fail(new Error('incomplete ' + got + '/' + total)); return; }
        out.end(() => {
          if (settled) return;
          settled = true;
          report(100, got, total);
          resolve(dest);
        });
      });
      res.on('error', fail);
      res.on('aborted', () => fail(new Error('aborted')));
    });
    req.on('error', fail);
    req.end();
  });
}


async function downloadAsset(opts) {
  const o = opts || {};
  const net = o.net;
  const url = String(o.url || '');
  const dest = String(o.dest || '');
  const onPct = o.onPct;
  const preferred = String(o.preferred || '');
  const probeTimeout = Number(o.probeTimeout || 7000);
  const probes = await probeMirrors(url, { net: net, timeoutMs: probeTimeout });
  const order = [];
  const push = u => { if (u && order.indexOf(u) < 0) order.push(u); };
  if (preferred && probes.some(p => p.url === preferred + url)) push(preferred + url);
  probes.forEach(p => push(p.url));
  
  endpoints(url).forEach(push);
  const tried = [];
  for (const cand of order) {
    try {
      await downloadToFile(cand, dest, onPct, net);
      return { ok: true, via: cand, tried: tried };
    } catch (e) {
      tried.push({ url: cand, error: String(e && e.message || e).slice(0, 140) });
      try { fs.unlinkSync(dest); } catch (e2) {  }
    }
  }
  return { ok: false, via: '', tried: tried };
}

module.exports = {
  PROXIES: PROXIES,
  endpoints: endpoints,
  proxyHost: proxyHost,
  readPreferred: readPreferred,
  writePreferred: writePreferred,
  fetchReleaseJson: fetchReleaseJson,
  probeMirrors: probeMirrors,
  downloadToFile: downloadToFile,
  downloadAsset: downloadAsset
};
