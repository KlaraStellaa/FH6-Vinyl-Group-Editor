'use strict';
(function () {
  if (window.__diagOpsInstalled) return;
  window.__diagOpsInstalled = true;
  const D = {
    enabled: true,
    maxOps: 12,
    ops: [],
    fpsWindow: [],
    lastFrame: 0,
    longFrames: 0,
    lastBeat: 0,
    lastOpsLog: 0
  };
  App.diagOps = D;

  const log = function (level, msg, data) {
    if (!D.enabled) return;
    try { if (App.log) App.log(level, msg, data); } catch (e) {   }
  };
  const clamp = function (n, d) {
    const v = Number(n);
    return Number.isFinite(v) ? Math.round(v * d) / d : 0;
  };
  D.snapshot = function () {
    let s = null, v = null, a = null, e = null;
    try { s = App.state || null; } catch (err) { }
    try { v = (s && s.view) || null; } catch (err) { }
    try { a = App.autoStatic || null; } catch (err) { }
    try { e = App.editStatic || null; } catch (err) { }
    const out = {
      sc: v ? clamp(v.scale || 1, 1000) : 0,
      vx: v ? Math.round(v.x || 0) : 0,
      vy: v ? Math.round(v.y || 0) : 0,
      layers: (s && s.layers) ? s.layers.length : 0,
      sel: (s && s.selected && s.selected.size) || 0,
      edit: (s && s.edit) ? (s.edit.type || 'yes') : null
    };
    if (a) {
      out.ast = a.active ? (a.bit ? 'bit' : 'on') : (a.baking ? 'baking' : 'off');
      out.ov = a.base ? 1 : 0;
      out.hid = (a._hidePrefix === undefined ? -1 : a._hidePrefix);
      if (a._run && a._run.leaf) out.leaf = a._run.leaf;
    }
    if (e) out.es = e.active ? (e.bit ? 'bit' : 'on') : 'off';
    try { out.dom = document.getElementsByTagName('*').length; } catch (err) { }
    return out;
  };
  const docPoint = function (cx, cy) {
    try {
      const v = App.state.view, r = App.wrap.getBoundingClientRect();
      return { dx: clamp(v.x + (cx - r.left) / (v.scale || 1), 10), dy: clamp(v.y + (cy - r.top) / (v.scale || 1), 10) };
    } catch (e) { return null; }
  };
  const pushOp = function (kind, data) {
    if (!D.enabled) return;
    try {
      D.ops.push({ t: Math.round(performance.now()), k: kind, d: data });
      if (D.ops.length > D.maxOps) D.ops.shift();
    } catch (e) {   }
  };
  const recentOps = function () {
    return D.ops.slice(-D.maxOps);
  };
  const layerUnder = function (t) {
    try {
      const el = t && t.closest ? t.closest('[data-layer]') : null;
      return el ? parseInt(el.getAttribute('data-layer'), 10) || null : null;
    } catch (e) { return null; }
  };

  const frame = function (ts) {
    if (!D.enabled) { requestAnimationFrame(frame); return; }
    if (D.lastFrame) {
      const gap = ts - D.lastFrame;
      if (gap > 50) D.longFrames++;
      D.fpsWindow.push(gap);
      if (D.fpsWindow.length > 240) D.fpsWindow.shift();
    }
    D.lastFrame = ts;
    const nowMs = Date.now();
    if (!D.lastBeat) D.lastBeat = nowMs;
    if (nowMs - D.lastBeat >= 1000) {
      const win = D.fpsWindow;
      let maxGap = 0;
      for (let i = 0; i < win.length; i++) if (win[i] > maxGap) maxGap = win[i];
      const fps = Math.round(win.length * 1000 / Math.max(1, nowMs - D.lastBeat + 1000 - 1000));
      const st = D.snapshot();
      const line = Object.assign({ fps: fps, maxGap: Math.round(maxGap), long50: D.longFrames }, st);
      if (fps < 45 || maxGap > 80) {
        log('perf', 'FRAME-DROP', Object.assign({}, line, { ops: recentOps() }));
      } else if (nowMs - (D.lastOpsLog || 0) >= 10000) {
        D.lastOpsLog = nowMs;
        log('perf', 'FPS', line);
      }
      D.fpsWindow = [];
      D.longFrames = 0;
      D.lastBeat = nowMs;
    }
    requestAnimationFrame(frame);
  };
  try { requestAnimationFrame(frame); } catch (e) {   }

  window.addEventListener('keydown', function (ev) {
    if (!D.enabled || ev.repeat) return;
    const mods = (ev.ctrlKey ? 'C' : '') + (ev.shiftKey ? 'S' : '') + (ev.altKey ? 'A' : '') + (ev.metaKey ? 'M' : '');
    const tgt = ev.target || {};
    const data = {
      key: String(ev.key || '').slice(0, 24), code: String(ev.code || '').slice(0, 24), mods: mods,
      tag: String(tgt.tagName || '').toLowerCase().slice(0, 12),
      sc: clamp((App.state && App.state.view && App.state.view.scale) || 1, 1000)
    };
    pushOp('key', data.key + (mods ? '+' + mods : ''));
    log('op', 'KEY', data);
  }, true);
  window.addEventListener('keyup', function (ev) {
    if (!D.enabled) return;
    if (!ev.ctrlKey && !ev.shiftKey && !ev.altKey && !ev.metaKey && String(ev.key || '').length === 1) return;
    log('op', 'KEYUP', { key: String(ev.key || '').slice(0, 24), code: String(ev.code || '').slice(0, 24) });
  }, true);

  let lastMoveAt = 0, downButtons = 0;
  window.addEventListener('pointerdown', function (ev) {
    if (!D.enabled) return;
    downButtons = ev.buttons || 0;
    const p = docPoint(ev.clientX, ev.clientY);
    const data = {
      btn: ev.button, buttons: ev.buttons, pointer: ev.pointerType || 'mouse',
      cx: Math.round(ev.clientX), cy: Math.round(ev.clientY),
      layer: layerUnder(ev.target)
    };
    if (p) { data.dx = p.dx; data.dy = p.dy; }
    Object.assign(data, { sc: D.snapshot().sc });
    pushOp('down', 'b' + ev.button + '@' + Math.round(ev.clientX) + ',' + Math.round(ev.clientY));
    log('op', 'POINTER-DOWN', data);
  }, true);
  window.addEventListener('pointerup', function (ev) {
    if (!D.enabled) return;
    downButtons = 0;
    const p = docPoint(ev.clientX, ev.clientY);
    const data = { btn: ev.button, pointer: ev.pointerType || 'mouse', cx: Math.round(ev.clientX), cy: Math.round(ev.clientY) };
    if (p) { data.dx = p.dx; data.dy = p.dy; }
    pushOp('up', 'b' + ev.button);
    log('op', 'POINTER-UP', data);
  }, true);
  window.addEventListener('pointermove', function (ev) {
    if (!D.enabled || !downButtons) return;
    const t = Date.now();
    if (t - lastMoveAt < 100) return;
    lastMoveAt = t;
    const p = docPoint(ev.clientX, ev.clientY);
    log('op', 'POINTER-MOVE', { cx: Math.round(ev.clientX), cy: Math.round(ev.clientY), dx: p ? p.dx : null, dy: p ? p.dy : null, buttons: ev.buttons });
  }, true);
  window.addEventListener('contextmenu', function (ev) {
    if (!D.enabled) return;
    log('op', 'CONTEXTMENU', { cx: Math.round(ev.clientX), cy: Math.round(ev.clientY), layer: layerUnder(ev.target) });
  }, true);

  let wheelAcc = null, wheelTimer = null;
  window.addEventListener('wheel', function (ev) {
    if (!D.enabled) return;
    if (!wheelAcc) wheelAcc = { n: 0, dy: 0, dx: 0, ctrl: !!ev.ctrlKey, sc0: (App.state && App.state.view && App.state.view.scale) || 1, x: Math.round(ev.clientX), y: Math.round(ev.clientY), layer: layerUnder(ev.target) };
    wheelAcc.n++;
    wheelAcc.dy += ev.deltaY || 0;
    wheelAcc.dx += ev.deltaX || 0;
    if (wheelTimer) return;
    wheelTimer = setTimeout(function () {
      wheelTimer = null;
      const w = wheelAcc; wheelAcc = null;
      if (!w || !D.enabled) return;
      const sc1 = (App.state && App.state.view && App.state.view.scale) || 1;
      const data = {
        n: w.n, dy: Math.round(w.dy), dx: Math.round(w.dx), ctrl: w.ctrl,
        sc0: clamp(w.sc0, 1000), sc1: clamp(sc1, 1000),
        ratio: w.sc0 ? clamp(sc1 / w.sc0, 100) : 1,
        cx: w.x, cy: w.y, layer: w.layer
      };
      pushOp('wheel', 'dy' + data.dy + ' sc' + data.sc0 + '->' + data.sc1);
      log('op', 'WHEEL', data);
    }, 200);
  }, { capture: true, passive: true });

  let viewTimer = null, lastView = null;
  const watchView = function () {
    if (!D.enabled) { setTimeout(watchView, 400); return; }
    let v = null;
    try { v = App.state.view; } catch (e) { }
    if (v) {
      const key = v.x.toFixed(2) + ',' + v.y.toFixed(2) + ',' + v.scale.toFixed(4);
      if (key !== lastView) {
        lastView = key;
        if (viewTimer) clearTimeout(viewTimer);
        viewTimer = setTimeout(function () {
          viewTimer = null;
          const s = D.snapshot();
          log('op', 'VIEW-SETTLED', { sc: s.sc, vx: s.vx, vy: s.vy, layers: s.layers, ast: s.ast, ov: s.ov, hid: s.hid });
        }, 320);
      }
    }
    setTimeout(watchView, 250);
  };
  setTimeout(watchView, 800);

  const padState = new Map();
  window.addEventListener('gamepadconnected', function (ev) {
    if (!D.enabled) return;
    log('op', 'PAD-CONNECT', { id: String(ev.gamepad && ev.gamepad.id || '').slice(0, 60), index: ev.gamepad ? ev.gamepad.index : -1 });
  }, true);
  window.addEventListener('gamepaddisconnected', function (ev) {
    if (!D.enabled) return;
    log('op', 'PAD-DISCONNECT', { index: ev.gamepad ? ev.gamepad.index : -1 });
  }, true);
  setInterval(function () {
    if (!D.enabled || !navigator.getGamepads) return;
    let pads = null;
    try { pads = navigator.getGamepads(); } catch (e) { return; }
    if (!pads) return;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (!p) continue;
      const prev = padState.get(p.index) || { b: [], a: [] };
      const btn = [];
      p.buttons.forEach(function (b, k) { if (b && b.pressed) btn.push(k); });
      const axes = [];
      p.axes.forEach(function (a, k) { if (Math.abs(a) > 0.5) axes.push(k + ':' + clamp(a, 10)); });
      const added = btn.filter(function (k) { return prev.b.indexOf(k) < 0; });
      const axisChanged = axes.some(function (s) { return prev.a.indexOf(s) < 0; });
      if (added.length || axisChanged) {
        pushOp('pad', 'b' + added.join(','));
        log('op', 'PAD', { id: String(p.id || '').slice(0, 40), buttons: btn, axes: axes });
      }
      padState.set(p.index, { b: btn, a: axes });
    }
  }, 500);

  setTimeout(function () {
    try {
      const s = D.snapshot();
      log('info', '操作日志已启用', { fps: '1s', ops: 'key/pointer/wheel/pad', view: 'settled', render: s });
    } catch (e) {   }
  }, 1200);
})();
