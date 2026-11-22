'use strict';
(function () {
  if (window.__diagRenderInstalled) return;
  window.__diagRenderInstalled = true;

  const SCHEMA = 1;
  const MAX_EVENTS = 512;
  const MAX_BYTES = 256 * 1024;
  const MAX_ITEM_BYTES = 1024;
  const WINDOW_MS = 250;
  const WINDOW_MAX = 32;
  const KEY_RESERVED = 96;          

  const EVENTS = {
    'boot': 1, 'view.commit': 1, 'doc.change': 1,
    'plan.snapshot': 1, 'plan.cull': 1, 'plan.resource': 1,
    'bake.start': 1, 'bake.end': 1, 'bake.abort': 1, 'bake.cancel': 1, 'bake.fail': 1,
    'snap.build': 1, 'snap.raster': 1, 'ink.check': 1, 'drop.check': 1,
    'bake.install': 1, 'bit.replace': 1, 'bit.release': 1,
    'visibility.apply': 1, 'visibility.restore': 1,
    'task.gc': 1, 'cache.evict': 1,
    'user.mark': 1, 'roi.compare': 1, 'gap': 1, 'perf.frame': 1
  };
  const KEY_EVENTS = {
    'bake.install': 1, 'bake.fail': 1, 'bake.abort': 1, 'visibility.apply': 1,
    'visibility.restore': 1, 'user.mark': 1, 'roi.compare': 1, 'bit.release': 1, 'boot': 1
  };
  const NUM_FIELDS = {
    seq: 1, ms: 1, op: 1, epoch: 1, c: 1, v: 1, gen: 1, parent: 1, task: 1, bit: 1, bitView: 1,
    layer: 1, group: 1, f: 1, leaf: 1, tops: 1, clones: 1, defs: 1, pending: 1, bytes: 1,
    culled: 1, hidden: 1, visible: 1, slot: 1, keep: 1, samples: 1, actualInk: 1, referenceInk: 1,
    frozenSeq: 1, cycle: 1, dur: 1, fps: 1, p95: 1, longest: 1, count: 1, total: 1, fail: 1,
    wait: 1, drawn: 1, alpha: 1, px: 1, keepOld: 1, keepStale: 1, active: 1, nw: 1, nh: 1,
    baseAll: 1, w: 1, h: 1, x: 1, y: 1, density: 1, lost: 1
  };
  const STR_FIELDS = {
    event: 1, schema: 0, build: 1, session: 1, proc: 1, doc: 1, owner: 1, tier: 1, path: 1,
    reason: 1, nextOwner: 1, priorBit: 1, vector: 1, coversCell: 1, alternativeOwner: 1,
    report: 1, symptom: 1, expectedLayer: 1, source: 1, src: 1, authority: 1, mode: 1, ok: 1, why: 1, err: 1,
    kind: 1, scope: 1, fallback: 1, reasonCode: 1, cover: 1, product: 1
  };
  const ARR_FIELDS = { cell: 4, roi: 4, top: 8, bits: 8 };

  const D = {
    enabled: true,
    schema: SCHEMA,
    session: 's' + Math.random().toString(36).slice(2, 8),
    proc: 'r' + (window.__diagRenderProcSeq = (window.__diagRenderProcSeq || 0) + 1),
    build: '',
    seq: 0,
    docEpoch: 1,
    viewRev: 0,
    contentRev: 0,
    events: [],
    bytes: 0,
    lost: { count: 0, firstSeq: 0, lastSeq: 0, byType: {} },
    counters: Object.create(null),
    reports: [],
    winStart: 0,
    winCount: 0,
    frames: { cycle: 0, fps: 0, p95: 0, longest: 0, at: 0 },
    t0: (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  };
  App.diagRender = D;

  const isNum = v => typeof v === 'number' && isFinite(v);
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const round1 = v => Math.round(v * 10) / 10;

  D.setEnabled = function (on) {
    D.enabled = !!on;
    if (!D.enabled) { D.events.length = 0; D.bytes = 0; }
    return D.enabled;
  };
  D.setBuild = function (b) { D.build = String(b || '').slice(0, 24); };
  D.env = { version: '', electron: '', chrome: '', platform: '', osRelease: '' };
  try {
    if (window.sveApi && window.sveApi.appFlags) {
      window.sveApi.appFlags().then(function (r) {
        if (!r) return;
        D.env = {
          version: String(r.version || '').slice(0, 20),
          electron: String(r.electron || '').slice(0, 16),
          chrome: String(r.chrome || '').slice(0, 16),
          platform: String(r.platform || '').slice(0, 16),
          osRelease: String(r.osRelease || '').slice(0, 24)
        };
        if (r.version) D.setBuild('v' + r.version);
      }).catch(function () {   });
    }
  } catch (e) {   }

  D.bump = function (key, n) {
    if (!D.enabled) return;
    D.counters[key] = (D.counters[key] || 0) + (n === undefined ? 1 : n);
  };

  function sanitize(name, fields) {
    const out = {};
    let dropped = 0;
    if (!fields) return { out, dropped };
    for (const k in fields) {
      if (!Object.prototype.hasOwnProperty.call(fields, k)) continue;
      const v = fields[k];
      if (v === undefined || v === null) continue;    
      if (NUM_FIELDS[k] && isNum(v)) { out[k] = round1(v); continue; }
      if (STR_FIELDS[k] && (typeof v === 'string' || typeof v === 'boolean')) {
        out[k] = typeof v === 'boolean' ? v : String(v).slice(0, 80); continue;
      }
      if (ARR_FIELDS[k] && Array.isArray(v)) {
        out[k] = v.slice(0, ARR_FIELDS[k]).map(function (n) { return isNum(n) ? Math.round(n) : 0; });
        continue;
      }
      dropped++;
    }
    return { out, dropped };
  }

  function pushRecord(rec, isKey) {
    const line = JSON.stringify(rec);
    const size = line.length + 1;
    if (size > MAX_ITEM_BYTES) { D.lost.count++; return false; }
    while (D.events.length && (D.events.length >= MAX_EVENTS || D.bytes + size > MAX_BYTES)) {
      let idx = 0;
      if (isKey) {
        const i = D.events.findIndex(function (e) { return !e.__key; });
        if (i >= 0) idx = i;
      }
      const old = D.events.splice(idx, 1)[0];
      if (old) {
        D.bytes -= old.__size || 0;
        D.lost.count++;
        if (!D.lost.firstSeq) D.lost.firstSeq = old.seq;
        D.lost.lastSeq = old.seq;
        D.lost.byType[old.event] = (D.lost.byType[old.event] || 0) + 1;
      }
    }
    rec.__size = size;
    rec.__key = !!isKey;
    D.events.push(rec);
    D.bytes += size;
    return true;
  }

  D.ev = function (name, fields) {
    if (!D.enabled) return null;
    if (!EVENTS[name]) return null;
    const t = now();
    if (t - D.winStart >= WINDOW_MS) { D.winStart = t; D.winCount = 0; }
    const isKey = !!KEY_EVENTS[name];
    if (!isKey) {
      if (D.winCount >= WINDOW_MAX) { D.bump('ev.throttled'); return null; }
      D.winCount++;
    }
    const s = sanitize(name, fields);
    if (s.dropped) D.bump('field.dropped', s.dropped);
    const rec = Object.assign({
      seq: ++D.seq, ms: Math.round(t), event: name,
      doc: 'D' + D.docEpoch,
      c: Number(App.contentRevision) || 0,
      v: Number(App.viewRevision) || 0,
    }, s.out);
    if (!pushRecord(rec, isKey)) { D.bump('ev.dropped'); return null; }
    D.bump('ev.total');
    return rec;
  };

  D.tickDoc = function (why) {
    D.docEpoch++;
    D.contentRev = 0;
    D.ev('doc.change', { reason: String(why || '').slice(0, 40), epoch: D.docEpoch });
    return D.docEpoch;
  };
  D.tickContent = function (why) {
    D.contentRev++;
    D.bump('content.tick');
    return D.contentRev;
  };
  D.tickView = function (action) {
    D.viewRev++;
    D.ev('view.commit', { action: String(action || 'set').slice(0, 24) });
    return D.viewRev;
  };

  D.mark = function (symptom, opts) {
    const o = opts || {};
    const id = 'R' + (D.reports.length + 1);
    const rec = {
      id: id, symptom: String(symptom || 'unknown').slice(0, 24),
      cell: Array.isArray(o.cell) ? o.cell.slice(0, 4).map(n => Math.round(Number(n) || 0)) : null,
      roi: Array.isArray(o.roi) ? o.roi.slice(0, 4).map(n => Math.round(Number(n) || 0)) : null,
      expectedLayer: isNum(o.expectedLayer) ? Math.round(o.expectedLayer) : null,
      docEpoch: D.docEpoch, contentRev: D.contentRev, viewRev: D.viewRev,
      frozenSeq: D.seq, at: Math.round(now()), evidence: o.evidence || 'candidate',
    };
    D.reports.push(rec);
    if (D.reports.length > 20) D.reports.shift();
    D.ev('user.mark', { report: id, symptom: rec.symptom, cell: rec.cell, expectedLayer: rec.expectedLayer, frozenSeq: rec.frozenSeq });
    return rec;
  };

  let lastFrame = 0, win = [], lastBeat = 0;
  function frame(ts) {
    if (!D.enabled) return;
    if (lastFrame) {
      const g = ts - lastFrame;
      win.push(g);
      if (win.length > 240) win.shift();
    }
    lastFrame = ts;
    if (!lastBeat) lastBeat = ts;
    if (ts - lastBeat >= 1000) {
      const arr = win.slice().sort((a, b) => a - b);
      const p95 = arr.length ? Math.round(arr[Math.floor(arr.length * 0.95)]) : 0;
      const longest = arr.length ? Math.round(arr[arr.length - 1]) : 0;
      D.frames = { cycle: D.frames.cycle + 1, fps: win.length, p95: p95, longest: longest, at: Math.round(ts - D.t0) };
      if (longest > 100) D.ev('perf.frame', { fps: win.length, p95: p95, longest: longest });
      win = [];
      lastBeat = ts;
    }
    requestAnimationFrame(frame);
  }
  try { requestAnimationFrame(frame); } catch (e) {   }

  D.snapshot = function (opts) {
    const o = opts || {};
    const evs = D.events.map(function (e) {
      const c = {}; for (const k in e) if (k !== '__size' && k !== '__key') c[k] = e[k];
      return c;
    });
    return {
      schema: SCHEMA,
      session: D.session, proc: D.proc, build: D.build,
      generatedAt: new Date().toISOString(),
      uptimeMs: Math.round(now() - D.t0),
      counts: { events: evs.length, bytes: D.bytes, seq: D.seq, lost: D.lost.count },
      lost: D.lost,
      counters: D.counters,
      frames: D.frames,
      reports: D.reports.slice(),
      events: evs,
      symptom: o.symptom || null,
      mode: o.mode || null,
    };
  };

  D.summaryText = function (snap) {
    const s = snap || D.snapshot();
    const L = [];
    L.push('FH6 彩绘编辑器 · 渲染诊断摘要');
    L.push('schema=' + s.schema + '  build=' + (s.build || '(未设置)') + '  session=' + s.session + '  proc=' + s.proc);
    L.push('生成时间 ' + s.generatedAt + '  运行 ' + Math.round(s.uptimeMs / 1000) + 's');
    L.push('事件 ' + s.counts.events + ' 条 / ' + s.counts.bytes + ' 字节；seq 最高 ' + s.counts.seq +
      '；被淘汰 ' + s.counts.lost + ' 条');
    if (s.reports.length) {
      L.push('');
      L.push('用户标记：');
      s.reports.forEach(function (r) {
        L.push('  ' + r.id + ' 症状=' + r.symptom + ' 格=' + (r.cell ? '[' + r.cell.join(',') + ']' : '-') +
          ' 期望层=' + (r.expectedLayer === null ? '-' : ('L' + r.expectedLayer)) +
          ' 冻结 seq=' + r.frozenSeq + ' 证据级=' + r.evidence);
      });
    }
    const keys = Object.keys(s.counters || {}).sort();
    if (keys.length) {
      L.push('');
      L.push('计数器：' + keys.map(function (k) { return k + '=' + s.counters[k]; }).join('  '));
    }
    const ev = s.events.slice(-40);
    if (ev.length) {
      L.push('');
      L.push('最近事件（最多 40 条，正序）：');
      ev.forEach(function (e) {
        const rest = Object.keys(e).filter(function (k) { return ['seq', 'ms', 'event'].indexOf(k) < 0; })
          .map(function (k) { return k + '=' + (Array.isArray(e[k]) ? '[' + e[k].join(',') + ']' : e[k]); }).join(' ');
        L.push('  #' + e.seq + ' t+' + e.ms + 'ms ' + e.event + ' ' + rest);
      });
    }
    return L.join('\n');
  };

  D.ev('boot', { build: D.build, session: D.session, proc: D.proc });
})();
