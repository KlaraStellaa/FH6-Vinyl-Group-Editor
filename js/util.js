'use strict';
function appLog(level, msg, data) {
  try {
    if (window.sveApi && window.sveApi.log) window.sveApi.log(level, msg, data);
  } catch (e) { }
}
window.App = window.App || {};
App.log = appLog;

App.startThumbLoading = function (host) {
  if (!host) return null;
  App.finishThumbLoading(host);
  const loader = document.createElement('span');
  loader.className = 'sve-thumb-loader loader';
  loader.setAttribute('aria-hidden', 'true');
  const primary = document.createElement('span');
  primary.className = 'jimu-primary-loading dot-spinner';
  primary.textContent = '加载中';
  for (let i = 0; i < 8; i++) {
    const dot = document.createElement('span');
    dot.className = 'dot-spinner__dot';
    primary.appendChild(dot);
  }
  loader.appendChild(primary);
  host.classList.add('sve-thumb-loading');
  host.appendChild(loader);
  return loader;
};
App.finishThumbLoading = function (host, loader) {
  if (!host) return;
  if (loader) {
    if (loader.parentNode !== host) return;
    loader.remove();
  } else {
    Array.from(host.children || []).forEach(ch => {
      if (ch.classList && ch.classList.contains('sve-thumb-loader')) ch.remove();
    });
  }
  const remains = Array.from(host.children || []).some(ch =>
    ch.classList && ch.classList.contains('sve-thumb-loader'));
  if (!remains) host.classList.remove('sve-thumb-loading');
};
App.showThumbImage = function (host, img, url, loader) {
  return new Promise(resolve => {
    if (!host || !img || !url) {
      App.finishThumbLoading(host, loader);
      resolve(false);
      return;
    }
    let settled = false;
    let decoding = false;
    const done = ok => {
      if (settled) return;
      settled = true;
      img.onload = null;
      img.onerror = null;
      App.finishThumbLoading(host, loader);
      resolve(!!ok);
    };
    const decoded = () => {
      if (settled || decoding) return;
      if (!(img.naturalWidth > 0)) { done(false); return; }
      if (typeof img.decode !== 'function') { done(true); return; }
      decoding = true;
      img.decode().then(() => done(true)).catch(e => {
        if (img.naturalWidth > 0) done(true);
        else {
          console.warn('[thumb-loader] 缩略图解码失败', String(e && e.message || e).slice(0, 160));
          done(false);
        }
      });
    };
    img.decoding = 'async';
    img.onload = decoded;
    img.onerror = () => done(false);
    try {
      img.src = url;
      if (img.complete) queueMicrotask(decoded);
    } catch (e) {
      console.warn('[thumb-loader] 缩略图装载失败', String(e && e.message || e).slice(0, 160));
      done(false);
    }
  });
};
App.initClickLog = function () {
  if (!App.svg) return;
  const clickAt = (e, where) => {
    if (e.button !== 0) return;
    try {
      let doc = null, hit = null;
      if (App.screenToDoc && App.state) {
        doc = App.screenToDoc(e.clientX, e.clientY);
        if (App.hitLayerPaintedSync) hit = App.hitLayerPaintedSync(e.clientX, e.clientY);
      }
      appLog('click', '鼠标点击' + where, {
        x: Math.round(e.clientX), y: Math.round(e.clientY),
        doc: doc ? [Math.round(doc.x * 10) / 10, Math.round(doc.y * 10) / 10] : null,
        hit: hit ? hit.id : null, hitKind: hit ? hit.kind : null,
        edit: App.state && App.state.edit ? App.state.edit.type + '/' + (App.state.editMode || '') : null,
        selBefore: App.state ? App.state.selected.size : 0,
        whiteBox: App.whiteBoxLayer ? (App.whiteBoxLayer() ? App.whiteBoxLayer().id : null) : null
      });
      setTimeout(() => {
        try {
          if (!App.state) return;
          appLog('click', '点击结果', {
            sel: App.state.selected.size,
            selIds: Array.from(App.state.selected).slice(0, 12).join(','),
            selectedByTab: !!App.state.selectedByTab,
            whiteBox: App.whiteBoxLayer ? (App.whiteBoxLayer() ? App.whiteBoxLayer().id : null) : null,
            edit: App.state.edit ? App.state.edit.type : null
          });
        } catch (err) { /* ignore */ }
      }, 0);
    } catch (err) { /* ignore */ }
  };
  App.svg.addEventListener('pointerdown', e => clickAt(e, '画布'));
  if (App.layerListEl) App.layerListEl.addEventListener('pointerdown', e => clickAt(e, '图层栏'));
};

App.perfCtx = { lastOp: '' };
App._gpuInfoCache = null;
App.gpuInfo = function () {
  if (App._gpuInfoCache) return App._gpuInfoCache;
  let renderer = '', vendor = '';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      renderer = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      vendor = String(dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : '');
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
  } catch (e) { /* ignore */ }
  App._gpuInfoCache = { renderer, vendor };
  return App._gpuInfoCache;
};
App.stateSnapshot = function () {
  try {
    const s = App.state || {};
    const kinds = { symbol: 0, import: 0, pattern: 0, merged: 0 };
    (s.layers || []).forEach(l => { kinds[l.kind] = (kinds[l.kind] || 0) + 1; });
    let proxyN = 0, impBaked = 0, impTotal = 0;
    if (App._proxyBake) proxyN = App._proxyBake.size;
    (s.layers || []).forEach(l => {
      if (l.kind === 'import') {
        impTotal++;
        if (l.impBitmapUrl) impBaked++;
      }
    });
    const mem = (performance && performance.memory) ? {
      usedMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
      totalMB: Math.round(performance.memory.jsHeapSizeLimit / 1048576)
    } : null;
    const g = App.gpuInfo();
    return {
      layers: (s.layers || []).length,
      kinds,
      mergedGroups: kinds.merged,
      proxyBaked: proxyN,
      impBitmap: { enabled: impTotal >= (App.impBitmapThreshold || 300), total: impTotal, baked: impBaked },
      sel: s.selected ? s.selected.size : 0,
      edit: s.edit ? s.edit.type + (s.editMode ? '/' + s.editMode : '') : null,
      drag: App.drag ? App.drag.kind : null,
      view: s.view ? { x: +s.view.x.toFixed(1), y: +s.view.y.toFixed(1), scale: +s.view.scale.toFixed(2) } : null,
      lastOp: App.perfCtx.lastOp,
      memory: mem,
      gpu: g.renderer ? g.renderer.slice(0, 120) : null
    };
  } catch (e) { return { error: String(e) }; }
};
App.initPerfMonitor = function () {
  try {
    appLog('info', '应用启动', App.stateSnapshot());
  } catch (e) { /* ignore */ }
  try {
    if (typeof PerformanceObserver === 'function') {
      const po = new PerformanceObserver(list => {
        for (const e of list.getEntries()) {
          try {
            appLog('perf', '主线程长任务', Object.assign({ ms: Math.round(e.duration) }, App.stateSnapshot()));
          } catch (err) { /* ignore */ }
        }
      });
      po.observe({ entryTypes: ['longtask'] });
    }
  } catch (e) { }
  let frames = 0, t0 = performance.now(), worst = 0, last = performance.now();
  const loop = () => {
    const now = performance.now();
    frames++;
    const dt = now - last;
    last = now;
    if (dt > worst) worst = dt;
    if (now - t0 >= 1000) {
      if (document.visibilityState === 'visible') {
        const fps = Math.round(frames * 1000 / (now - t0));
        if (fps < 16) {
          try {
            appLog('perf', '低帧率', Object.assign({ fps, worstMs: Math.round(worst) }, App.stateSnapshot()));
          } catch (e) { /* ignore */ }
        }
      }
      frames = 0; t0 = now; worst = 0;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
};
window.addEventListener('error', e => {
  appLog('error', '渲染进程未捕获异常', Object.assign(
    { message: String(e.message || e.error).slice(0, 300), file: e.filename, line: e.lineno },
    window.App && App.stateSnapshot ? App.stateSnapshot() : {}));
});
window.addEventListener('unhandledrejection', e => {
  const r = e.reason;
  appLog('error', '未处理的 Promise 拒绝', Object.assign(
    { message: String(r && r.message || r).slice(0, 300) },
    window.App && App.stateSnapshot ? App.stateSnapshot() : {}));
});
function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
const SVGNS = 'http://www.w3.org/2000/svg';
const XLINK = 'http://www.w3.org/1999/xlink';
const D2R = Math.PI / 180;
function svgEl(tag, attrs) {
  const e = document.createElementNS(SVGNS, tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v !== null && v !== undefined) e.setAttribute(k, v);
  }
  return e;
}
function fmtNum(n, d) {
  const x = Number(n) || 0;
  if (d === undefined) return String(Math.round(x * 100) / 100);
  const f = Math.pow(10, d);
  return String(Math.round(x * f) / f);
}
function loadImage(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => {
      console.warn('[img-fail]', String(src).slice(0, 80), 'len=' + String(src).length);
      rej(new Error('image load failed'));
    };
    im.src = src;
  });
}
function hexToRgb(hex) {
  let h = String(hex || '').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) return null;
  const n = parseInt(h, 16);
  if (isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex(r, g, b) {
  const p = v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return '#' + p(r) + p(g) + p(b);
}
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max ? d / max : 0;
  return { h: h, s: s * 100, v: max * 100 };
}
function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 100) / 100;
  v = clamp(v, 0, 100) / 100;
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}
function normalizeDeg(d) {
  d = d % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}
const _sveCloseQueue = new WeakMap();
App.hideOverlay = function (el, done) {
  if (!el) { if (done) done(); return; }
  if (el.classList.contains('hidden')) { if (done) done(); return; }
  if (el.classList.contains('sve-closing')) {
    if (done) {
      const q = _sveCloseQueue.get(el);
      if (q) q.push(done); else done();
    }
    return;
  }
  const token = {};
  const queue = done ? [done] : [];
  _sveCloseQueue.set(el, queue);
  el._sveHideToken = token;
  el.classList.add('sve-closing');
  setTimeout(function () {
    if (el._sveHideToken !== token) {
      _sveCloseQueue.delete(el);
      queue.forEach(fn => { try { fn(); } catch (e) { /* ignore */ } });
      return;
    }
    el._sveHideToken = null;
    el.classList.remove('sve-closing');
    el.classList.add('hidden');
    _sveCloseQueue.delete(el);
    queue.forEach(fn => { try { fn(); } catch (e) { /* ignore */ } });
  }, 130);
};
App.showOverlay = function (el) {
  if (!el) return;
  el._sveHideToken = null;
  el.classList.remove('sve-closing');
  el.classList.remove('hidden');
};

App.attachDlgClose = function (box, onClose) {
  if (!box || typeof onClose !== 'function') return null;
  const title = box.querySelector('.anchor-title') || box.querySelector('.speed-title');
  if (!title) return null;
  const old = box.querySelector('.dlg-close');
  if (old) old.remove();
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dlg-close';
  btn.textContent = '×';
  btn.setAttribute('aria-label', App.i18n.t('lp.close'));
  btn.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (onClose() === false) return;
  });
  title.insertAdjacentElement('afterend', btn);
  box._dlgCloseBtn = btn;
  return btn;
};
if (App.i18n && App.i18n.onApply) {
  App.i18n.onApply(function () {
    const label = App.i18n.t('lp.close');
    const list = document.querySelectorAll('.dlg-close');
    for (let i = 0; i < list.length; i++) list[i].setAttribute('aria-label', label);
  });
}
let toastTimer = null;
function showToast(msg, ms) {
  if (window.App && App.Tabs && App.Tabs._silentRender) return;
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  if (App.showOverlay) App.showOverlay(t);
  else { t.classList.remove('sve-closing'); t.classList.remove('hidden'); }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (App.hideOverlay) App.hideOverlay(t);
    else t.classList.add('hidden');
  }, ms || 2400);
}

App.siScrollTo = function (el, top) {
  if (!el) return;
  const st = el.__siScroll || (el.__siScroll = { target: el.scrollTop, raf: 0, last: 0, expected: el.scrollTop, gliding: false });
  const max = () => Math.max(0, el.scrollHeight - el.clientHeight);
  st.target = Math.max(0, Math.min(max(), top));
  if (st.raf) return;
  st.gliding = true;
  st.last = performance.now();
  const step = now => {
    const s2 = el.__siScroll; if (!s2) { el.__siGliding = false; return; }
    if (Math.abs(el.scrollTop - s2.expected) > 1.5) { s2.raf = 0; s2.gliding = false; return; }
    const dis = s2.target - el.scrollTop;
    if (Math.abs(dis) <= 2) { el.scrollTop = s2.target; s2.raf = 0; s2.gliding = false; return; }
    const dt = Math.min(50, now - s2.last); s2.last = now;
    el.scrollTop += Math.sign(dis) * (Math.abs(dis) / 6 + 2) * (dt / 16.7);
    s2.expected = el.scrollTop;
    s2.raf = requestAnimationFrame(step);
  };
  st.raf = requestAnimationFrame(step);
  el.__siGliding = true;
};
App.attachSiWheel = function (el) {
  if (!el || el.__siWheelAttached) return;
  el.__siWheelAttached = true;
  el.addEventListener('wheel', e => {
    if (e.ctrlKey) return;
    e.preventDefault();
    const st = el.__siScroll || (el.__siScroll = { target: el.scrollTop, raf: 0, last: 0, expected: el.scrollTop });
    const max = () => Math.max(0, el.scrollHeight - el.clientHeight);
    App.siScrollTo(el, Math.max(0, Math.min(max(), st.target + (e.deltaY > 0 ? 100 : -100))));
  }, { passive: false });
};

(function () {
  const el = document.createElement('div');
  el.id = 'siTip';
  el.innerHTML = '<div class="si-tip-hl"></div><span class="si-tip-text"></span>';
  document.body.appendChild(el);
  const txt = () => el.querySelector('.si-tip-text');
  const st = { shown: false };
  App.siTip = {
    show(text, x, y) {
      if (txt().textContent !== String(text)) {
        txt().textContent = String(text);
        const hl = el.querySelector('.si-tip-hl');
        hl.classList.remove('si-tip-flash'); void hl.offsetWidth; hl.classList.add('si-tip-flash');
      }
      el.classList.add('si-tip-show');
      st.shown = true;
      App.siTip.move(x, y);
    },
    hide() { st.shown = false; el.classList.remove('si-tip-show'); },
    move(x, y) {
      const w = el.offsetWidth, h = el.offsetHeight;
      const vw = window.innerWidth, vh = window.innerHeight;
      let left = x + 4;
      if (left + w > vw) left = x - w - 4;
      if (left < 0) left = Math.max(0, vw - w);
      let top = y - h;
      if (top < 0) top = y + 4;
      if (top + h > vh) top = Math.max(0, vh - h);
      el.style.left = Math.round(left) + 'px';
      el.style.top = Math.round(top) + 'px';
    },
    shown() { return st.shown; }
  };
  window.addEventListener('mousemove', e => { if (st.shown) App.siTip.move(e.clientX, e.clientY); });
})();
App.siTipBind = function (el, textOrFn) {
  if (!el) return;
  el.addEventListener('mouseenter', e => App.siTip.show(typeof textOrFn === 'function' ? textOrFn() : textOrFn, e.clientX, e.clientY));
  el.addEventListener('mousemove', e => App.siTip.move(e.clientX, e.clientY));
  el.addEventListener('mouseleave', () => App.siTip.hide());
};

App.evDropdown = function (sel) {
  if (!sel || sel.__evDd) return;
  sel.__evDd = true;
  sel.style.display = 'none';
  const wrap = document.createElement('div');
  wrap.className = 'ev-dd-wrap';
  const btn = document.createElement('div'); btn.className = 'ev-dd-btn';
  const panel = document.createElement('div'); panel.className = 'ev-dd-panel';
  const syncBtn = () => {
    const o = sel.options[sel.selectedIndex];
    btn.textContent = o ? o.textContent : '';
  };
  const build = () => {
    panel.innerHTML = '';
    Array.from(sel.options).forEach(o => {
      const it = document.createElement('div');
      it.className = 'ev-dd-item' + (o.selected ? ' active' : '');
      it.textContent = o.textContent; it.dataset.value = o.value;
      it.addEventListener('click', () => {
        sel.value = o.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        build(); close();
      });
      panel.appendChild(it);
    });
    syncBtn();
  };
  build();
  new MutationObserver(build).observe(sel, { childList: true, subtree: true, characterData: true });
  function open() { panel.classList.add('ev-dd-open'); btn.classList.add('ev-dd-active'); }
  function close() { panel.classList.remove('ev-dd-open'); btn.classList.remove('ev-dd-active'); }
  btn.addEventListener('click', e => { e.stopPropagation(); panel.classList.contains('ev-dd-open') ? close() : open(); });
  document.addEventListener('click', e => { if (!wrap.contains(e.target)) close(); });
  wrap.appendChild(btn); wrap.appendChild(panel);
  sel.parentNode.insertBefore(wrap, sel);
  sel.__evDdApi = { refresh: build };
};
App.evDropdownSync = function (sel) { if (sel && sel.__evDdApi) sel.__evDdApi.refresh(); };
App.evDropdownSyncAll = function () {
  document.querySelectorAll('select').forEach(function (s) { App.evDropdownSync(s); });
};
