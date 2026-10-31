'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'lib-thumbs');
const PORT = 9795;
delete process.env.ELECTRON_RUN_AS_NODE;

const CHUNK = 20;    

function pageFn() {
  return (async (from, count) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < 600 && !(window.App && App.state && App.state.loaded); i++) await sleep(150);
    if (!(window.App && App.state && App.state.loaded)) return { error: 'app not loaded' };
    if (!window.__genAll) {
      window.__genAll = (App.symbols || []).map(s => ({ key: s.key, sym: s }));
    }
    const all = window.__genAll;
    const items = [];
    for (let i = from; i < Math.min(all.length, from + count); i++) {
      const rec = all[i];
      try {
        const url = await App.libThumbBuild(rec.sym, true);    
        items.push({ key: rec.key, url: url || '' });
      } catch (e) {
        items.push({ key: rec.key, url: '', error: String(e && e.message || e).slice(0, 120) });
      }
    }
    return { total: all.length, symLen: (App.libText || '').length, items };
  });
}

(async () => {
  const MEASURE = '(' + pageFn.toString() + ')';
  const child = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    ['--remote-debugging-port=' + PORT, '--in-process-gpu', '.'], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false,
      env: Object.assign({}, process.env, {
        SVGBIANJI_NO_CONFIRM: '1', SVGBIANJI_TEST: '1', SVGBIANJI_ISOLATE: '1',
        SVGBIANJI_NO_GPU: '1'
      })
    });
  try {
    let target = null;
    for (let i = 0; i < 150; i++) {
      try {
        const l = await fetch('http://127.0.0.1:' + PORT + '/json').then(r => r.json());
        target = l.find(t => t.type === 'page' && t.url.indexOf('index.html') >= 0);
        if (target) break;
      } catch (e) {   }
      await new Promise(r => setTimeout(r, 500));
    }
    if (!target) throw new Error('没有 devtools target');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    let mid = 0; const pending = new Map();
    ws.addEventListener('message', e => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    });
    const send = (method, params) => new Promise(res => {
      const id = ++mid; pending.set(id, res);
      ws.send(JSON.stringify({ id, method, params }));
    });
    const ev = async expr => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
      const body = r.result || {};
      if (body.exceptionDetails) {
        const d = body.exceptionDetails.exception ? body.exceptionDetails.exception.description : body.exceptionDetails.text;
        throw new Error('EVAL-EXC ' + String(d).split('\n')[0].slice(0, 300));
      }
      if (!body.result || body.result.value === undefined) {
        console.log('  [debug] 原始消息：' + JSON.stringify(r).slice(0, 600));
      }
      return body.result ? body.result.value : undefined;
    };

    fs.mkdirSync(OUT, { recursive: true });
    let from = 0, total = 0, symLen = 0, written = 0, failed = [];
    const keys = [];
    const t0 = Date.now();
    for (;;) {
      let out;
      for (let a = 0; a < 6; a++) {
        try { out = await ev(MEASURE + '()(' + from + ',' + CHUNK + ')'); break; }
        catch (e) { if (/context/i.test(e.message)) { await new Promise(r => setTimeout(r, 800)); continue; } throw e; }
      }
      if (!out || out.error) throw new Error('页内取图失败：' + JSON.stringify(out && out.error));
      total = out.total; symLen = out.symLen;
      for (const it of out.items) {
        if (!it.url || it.url.indexOf('data:image/png;base64,') !== 0) { failed.push(it); continue; }
        const buf = Buffer.from(it.url.slice('data:image/png;base64,'.length), 'base64');
        fs.writeFileSync(path.join(OUT, it.key + '.png'), buf);
        keys.push(it.key);
        written++;
      }
      from += out.items.length;
      process.stdout.write('\r  已生成 ' + written + '/' + total + '  失败 ' + failed.length + '  ' +
        ((Date.now() - t0) / 1000).toFixed(1) + 's');
      if (from >= total) break;
    }
    process.stdout.write('\n');
    keys.sort();
    fs.writeFileSync(path.join(OUT, 'index.json'),
      JSON.stringify({ v: 1, symLen: symLen, keys: keys }, null, 0));
    const bytes = keys.reduce((a, k) => a + fs.statSync(path.join(OUT, k + '.png')).size, 0);
    console.log('  完成：' + written + ' 张 / ' + (bytes / 1048576).toFixed(2) + ' MB · ' +
      'symLen=' + symLen + ' · 失败 ' + failed.length + ' · 用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
    if (failed.length) {
      console.log('  失败样例：' + JSON.stringify(failed.slice(0, 5)));
      process.exit(2);
    }
  } finally {
    child.kill();
  }
})().catch(e => { console.log('GEN-FAIL', e && e.message || e); process.exit(1); });
