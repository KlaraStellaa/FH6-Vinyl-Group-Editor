
(function () {
  const MIN_MS = 260;        
  const MAX_MS = 12000;      
  const POLL_MS = 90;

  const G = App.renderGate = { on: false, armed: false, t0: 0, timer: null, el: null, tip: null };

  function ensureEl() {
    if (G.el && G.el.parentNode) return G.el;
    const host = (App.wrap && App.wrap.nodeType === 1) ? App.wrap : document.body;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

    const style = document.createElement('style');
    style.textContent =
      
      '#renderGate{position:absolute;inset:0;z-index:18;display:none;align-items:center;' +
      'justify-content:center;flex-direction:column;gap:14px;background:var(--bg,#fafafc);' +
      'background:color-mix(in srgb, var(--bg,#fafafc) 92%, transparent);' +
      'pointer-events:auto;cursor:progress;user-select:none}' +
      '#renderGate.on{display:flex}' +
      '#renderGate .rg-spin{width:26px;height:26px;border-radius:50%;' +
      'border:2.5px solid var(--line,#d8d8de);border-top-color:var(--accent,#3b82f6);' +
      'animation:rg-spin .8s linear infinite}' +
      '@keyframes rg-spin{to{transform:rotate(360deg)}}' +
      '#renderGate .rg-txt{font:13px/1.5 system-ui,"Microsoft YaHei",sans-serif;' +
      'color:var(--text-dim,#666);letter-spacing:.02em}';
    (document.head || document.documentElement).appendChild(style);

    const d = document.createElement('div');
    d.id = 'renderGate';
    d.innerHTML = '<div class="rg-spin"></div><div class="rg-txt"></div>';
    host.appendChild(d);
    G.el = d;
    G.tip = d.querySelector('.rg-txt');
    return d;
  }

  
  function txt(key, fallback) {
    try { return (App.i18n && App.i18n.t) ? (App.i18n.t(key) || fallback) : fallback; } catch (e) { return fallback; }
  }
  function paint(key) {
    const d = ensureEl();
    G.key = key;
    if (G.tip) G.tip.textContent = txt(key, '正在渲染图案…');
    d.classList.add('on');
  }
  
  try {
    if (App.i18n && typeof App.i18n.onApply === 'function') {
      App.i18n.onApply(function () {
        try { if (G.on && G.key && G.tip) G.tip.textContent = txt(G.key, ''); } catch (e) {  }
      });
    }
  } catch (e) {  }

  
  function ready() {
    const a = App.autoStatic;
    if (!a) return true;
    if (a.baking) return false;
    if (a.active) return true;
    try { if (App.autoStaticEligible && !App.autoStaticEligible()) return true; } catch (e) { return true; }
    return false;
  }

  function tick() {
    G.timer = null;
    if (!G.on) return;
    const dt = Date.now() - G.t0;
    if ((ready() && dt >= MIN_MS) || dt >= MAX_MS) { App.renderGateEnd(); return; }
    G.timer = setTimeout(tick, POLL_MS);
  }

  App.renderGateBegin = function (text) {
    G.armed = true;
    if (G.on) return;
    G.on = true;
    App.state.renderGate = true;
    G.t0 = Date.now();
    paint(text);
    if (G.timer) clearTimeout(G.timer);
    G.timer = setTimeout(tick, POLL_MS);
  };

  App.renderGateEnd = function () {
    G.armed = false;
    if (!G.on) return;
    G.on = false;
    App.state.renderGate = false;
    if (G.timer) { clearTimeout(G.timer); G.timer = null; }
    if (G.el) G.el.classList.remove('on');
  };

  
  
  const modalOpen = () => {
    const m = document.querySelector('.confirm-overlay:not(.hidden), .confirm-overlay:not([style*="display: none"])');
    return !!m;
  };
  const swallow = e => {
    if (!G.on || modalOpen()) return;
    e.stopPropagation();
    e.preventDefault();
  };
  ['keydown', 'keyup', 'wheel', 'pointerdown', 'pointerup', 'pointermove', 'mousedown', 'dblclick', 'contextmenu']
    .forEach(t => window.addEventListener(t, swallow, true));

  
  function watchEntry(name, text) {
    const orig = App[name];
    if (typeof orig !== 'function') return;
    App[name] = function () {
      let r;
      try {
        App.renderGateBegin(text);
        r = orig.apply(this, arguments);
      } catch (e) {
        App.renderGateEnd();
        throw e;
      }
      if (r && typeof r.then === 'function') {
        return r.then(v => v, e => { App.renderGateEnd(); throw e; });
      }
      return r;
    };
  }
  watchEntry('importSVGContent', 'render.gate');
  watchEntry('openWorkCopyContent', 'render.gate.open');

  
  let lastDocSig = '';
  setInterval(function () {
    if (G.on) return;
    const a = App.autoStatic;
    if (!a || !a.baking || a.active) return;
    let n = 0;
    try { n = App.autoStaticLeafCount ? App.autoStaticLeafCount() : 0; } catch (e) { return; }
    if (n < 300) return;
    const sig = (App.Tabs && App.Tabs.current ? App.Tabs.current.id : '') + ':' + n;
    if (sig === lastDocSig) return;
    lastDocSig = sig;
    App.renderGateBegin('render.gate');
  }, 250);
})();
