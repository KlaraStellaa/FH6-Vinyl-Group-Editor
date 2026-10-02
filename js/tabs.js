'use strict';

App.Tabs = {
  docs: [],
  current: null,
  nextId: 1,
  testMode: false,
  started: false,
  homeFirst: true,

  async start() {
    if (this.started) return;
    this.started = true;
    if (window.sveApi && window.sveApi.appTestMode !== undefined) {
      this.testMode = !!window.sveApi.appTestMode;
    } else {
      try {
        const f = await window.sveApi.appFlags();
        this.testMode = !!(f && f.testMode);
      } catch (e) { this.testMode = false; }
    }
    this.wireBar();
    if (this.testMode) {
      this.addDoc({ label: null, silent: true });
      if (App.Home) App.Home.hide();
    }
  },

  wireBar() {
    const bar = document.getElementById('tabBar');
    if (!bar || bar.getAttribute('data-wired')) return;
    bar.setAttribute('data-wired', '1');
    bar.addEventListener('click', e => {
      const close = e.target.closest('.tab-close');
      if (close) {
        e.stopPropagation();
        const id = close.closest('[data-tabid]').getAttribute('data-tabid');
        this.closeDoc(id);
        return;
      }
      const set = e.target.closest('#btnSettings');
      if (set) { e.stopPropagation(); if (App.settings) App.settings.toggle(); return; }
      const tab = e.target.closest('[data-tabid]');
      const plus = e.target.closest('#tabNewDoc');
      const home = e.target.closest('#tabHome');
      if (home) { this.showHome(); return; }
      if (tab) {
        const id = tab.getAttribute('data-tabid');
        if (id !== (this.current && this.current.id)) this.switchTo(id);
        else this.hideHome();
        return;
      }
      if (plus) { this.addDoc(); this.hideHome(); }
    });
    let th = document.getElementById('tabThumb');
    if (!th) {
      th = document.createElement('div');
      th.id = 'tabThumb';
      th.className = 'hidden';
      document.body.appendChild(th);
    }
    if (!window.__thumbLog) window.__thumbLog = [];
    bar.addEventListener('mouseover', e => {
      const pill = e.target.closest('.tab-pill');
      if (!pill) return;
      const id = pill.getAttribute('data-tabid');
      if (!id || pill.classList.contains('active')) { this.hideTabThumb(); return; }
      if (this._thumbPillId === id) return;
      this.showTabThumb(id, pill);
    });
    bar.addEventListener('mouseout', e => {
      const from = e.target.closest('.tab-pill');
      const to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest('.tab-pill') : null;
      if (from && to !== from) this.hideTabThumb();
    });
    bar.addEventListener('mouseleave', () => this.hideTabThumb());
    window.addEventListener('resize', () => {
      clearTimeout(this._resizeT);
      this._resizeT = setTimeout(() => { const b = document.getElementById('tabBar'); if (b) this.updateCompression(b); }, 120);
    });
  },

  prewarmDocThumb(d) {
    if (!d || d.__thumbUrl || d.__thumbPrewarm) return;
    d.__thumbPrewarm = true;
    if (this._prewarmTimer) clearTimeout(this._prewarmTimer);
    this._prewarmTimer = setTimeout(() => {
      this._prewarmTimer = null;
      d.__thumbPrewarm = false;
      if (!d || d.__thumbUrl || this.docs.indexOf(d) < 0) return;
      Promise.resolve(this.docThumbUrl(d)).then(url => {
        if (url && !d.__thumbUrl && this.docs.indexOf(d) >= 0) d.__thumbUrl = url;
      }).catch(() => { });
    }, 400);
  },

  async showTabThumb(id, pill) {
    const th = document.getElementById('tabThumb');
    const doc = this.docs.find(x => x.id === id);
    if (!th || !doc) return;
    const r = pill.getBoundingClientRect();
    th.style.left = Math.round(r.left) + 'px';
    th.style.top = Math.round(r.bottom) + 'px';
    this._thumbPillId = id;
    th.classList.remove('hidden');
    th.classList.remove('empty');
    th.innerHTML = '';
    const loader = App.startThumbLoading(th);
    if (doc.__thumbUrl) {
      const loaded = await this.fillTabThumb(th, doc.__thumbUrl, loader);
      if (this._thumbPillId === id && !loaded) {
        th.classList.add('empty');
        th.innerHTML = '<div class="tab-thumb-grid"></div>';
      }
      return;
    }
    const url = await this.docThumbUrl(doc);
    if (this._thumbPillId !== id) return;
    if (url) {
      doc.__thumbUrl = url;
      const loaded = await this.fillTabThumb(th, url, loader);
      if (this._thumbPillId === id && !loaded) {
        th.classList.add('empty');
        th.innerHTML = '<div class="tab-thumb-grid"></div>';
      }
    }
    else {
      App.finishThumbLoading(th, loader);
      th.classList.add('empty');
      th.innerHTML = '<div class="tab-thumb-grid"></div>';
    }
  },
  async fillTabThumb(th, url, loader) {
    th.classList.remove('empty');
    Array.from(th.children).forEach(ch => { if (ch !== loader) ch.remove(); });
    const img = document.createElement('img');
    img.alt = '';
    th.appendChild(img);
    const loaded = await App.showThumbImage(th, img, url, loader);
    if (!loaded) img.remove();
    return loaded;
  },
  hideTabThumb() {
    this._thumbPillId = null;
    const th = document.getElementById('tabThumb');
    if (th) {
      App.finishThumbLoading(th);
      th.classList.add('hidden'); th.innerHTML = ''; th.classList.remove('empty');
    }
  },
  async docThumbUrl(doc) {
    const importEls = [];
    try {
      const slims = (doc === this.current || !doc.data)
        ? App.state.layers.map(l => App.snapshotSlim(l))
        : (doc.data.layers || []);
      if (!slims.length) return null;
      this._thumbRenderSeq = (this._thumbRenderSeq || 0) + 1;
      const prefix = 'tabthumb_' + this._thumbRenderSeq + '_';
      const children = App.deserializeLayersDetached(slims, prefix);
      (function prepareImports(items) {
        (items || []).forEach(l => {
          if (l.kind === 'merged') prepareImports(l.children);
          else if (l.kind === 'import') {
            App.buildLayerElement(l);
            (App.hiddenThumbHost || App.svg).appendChild(l.el);
            importEls.push(l.el);
          }
        });
      })(children);
      const fake = { kind: 'merged', children: children, sx: 1, sy: 1, rot: 0, skew: 0, x: 0, y: 0 };
      const geom = App.mergedThumbGeometry(fake);
      const lb = geom.lb;
      const bw = lb.w || 1, bh = lb.h || 1;
      const boxEl = document.getElementById('tabThumb');
      const boxMax = Math.max(boxEl ? boxEl.clientWidth : 0, boxEl ? boxEl.clientHeight : 0) || 200;
      const dpr = window.devicePixelRatio || 1;
      const size = Math.min(1024, Math.max(Math.ceil(boxMax * dpr) + 8, Math.round(Math.max(bw, bh) * 0.5)));
      const url = await App.mergedThumbUrl(fake, size, geom);
      return url || null;
    } catch (e) {
      console.warn('[thumb] docThumbUrl 失败', String(e && e.message || e).slice(0, 160));
      return null;
    } finally {
      importEls.forEach(el => { if (el && el.remove) el.remove(); });
    }
  },

  renderBar() {
    const bar = document.getElementById('tabBar');
    if (!bar) return;
    const t = (k) => (App.i18n ? App.i18n.t(k) : k);
    const now = performance.now();
    const pend = bar.__flipPrevPending;
    const prev = (pend && now - pend.ts < 300) ? pend.map : (() => {
      const m = new Map();
      Array.from(bar.children).forEach(el => {
        const key = el.id || el.getAttribute('data-tabid');
        if (key) { const r = el.getBoundingClientRect(); m.set(key, { x: r.left, w: r.width }); }
      });
      return m;
    })();
    const parts = [];
    const homeActive = !!(App.Home && App.Home.shown) || !this.current;
    parts.push('<button id="tabHome" class="tab-pill' + (homeActive ? ' active' : '') + '"><span class="tab-label"></span></button>');
    this.docs.forEach(d => {
      parts.push('<button class="tab-pill' + ((!homeActive && d === this.current) ? ' active' : '') + '" data-tabid="' + d.id + '">' +
        '<span class="tab-label"></span><span class="tab-close" title="×">×</span></button>');
    });
    parts.push('<button id="tabNewDoc" class="tab-plus" title="' + t('tab.new') + '">+</button>');
    parts.push('<button id="btnSettings" class="tab-plus" title="' + t('tab.settings') + '">' +
      '<span class="bar bar1"></span><span class="bar bar2"></span><span class="bar bar1"></span></button>');
    bar.innerHTML = parts.join('');
    this.docs.forEach(d => {
      const el = bar.querySelector('[data-tabid="' + d.id + '"] .tab-label');
      if (el) el.textContent = d.label || App.i18n.t('tab.untitled');
    });
    const homeEl = bar.querySelector('#tabHome .tab-label');
    if (homeEl) {
      const v = t('tab.home');
      homeEl.textContent = v;
      homeEl.setAttribute('textContent', v);
    }
    this.hideTabThumb();
    this.updateCompression(bar);
    if (prev.size) {
      bar.__flipPrevPending = { ts: now, map: prev };
      Array.from(bar.children).forEach(el => {
        const key = el.id || el.getAttribute('data-tabid');
        const p = key ? prev.get(key) : null;
        if (!p) return;
        const r = el.getBoundingClientRect();
        const dx = p.x - r.left, dw = p.w - r.width;
        if (Math.abs(dx) < 2 && Math.abs(dw) < 2) return;
        bar.__flipApplied++;
        el.style.transition = 'none';
        el.style.transform = 'translateX(' + Math.round(dx) + 'px)';
        if (Math.abs(dw) >= 2) el.style.width = Math.round(p.w) + 'px';
        requestAnimationFrame(() => {
          el.style.transition = 'transform .18s ease-out, width .18s ease-out';
          el.style.transform = '';
          el.style.width = '';
          setTimeout(() => {
            el.style.transition = ''; el.style.transform = ''; el.style.width = '';
            if (bar.__flipPrevPending && bar.__flipPrevPending.map === prev) delete bar.__flipPrevPending;
          }, 220);
        });
      });
    } else if (bar.__flipPrevPending) {
      delete bar.__flipPrevPending;
    }
  },

  updateCompression(bar) {
    const pills = Array.prototype.slice.call(bar.querySelectorAll('.tab-pill'));
    const plus = document.getElementById('tabNewDoc');
    const set = document.getElementById('btnSettings');
    const extras = (plus ? plus.offsetWidth : 0) + (set ? set.offsetWidth : 0);
    const gaps = 4 * (pills.length + 1) + 20;
    const avail = Math.max(0, bar.clientWidth - extras - gaps);
    const COMFORT = 140;
    const per = pills.length ? avail / pills.length : Infinity;
    const compressed = pills.length > 0 && per < COMFORT;
    if (compressed) bar.dataset.compressed = '1';
    else bar.dataset.compressed = '';
    const hideLabel = compressed && per < 150;
    pills.forEach(p => p.classList.toggle('hide-label', hideLabel));
    bar.dataset.anyHiddenLabel = hideLabel ? '1' : '';
  },

  showHome() {
    if (App.Home) App.Home.show();
    this.renderBar();
  },
  hideHome() {
    if (App.Home) App.Home.hide();
    this.renderBar();
  },

  addDoc(opts) {
    opts = opts || {};
    const d = { id: 'doc' + (this.nextId++), label: opts.label || null, bg: null, historyU: [], historyR: [], svgSource: opts.svgSource || null, workSource: null, dirty: false,
      contentRevision: 0 };
    if (this.current) this.captureDoc(this.current);
    this.docs.push(d);
    this.blankInto(d);
    this.loadDoc(d);
    if (!opts.silent) showToast(App.i18n.t('toast.tab.docCreated'));
    this.renderBar();
    const bar = document.getElementById('tabBar');
    const el = bar && bar.querySelector('[data-tabid="' + d.id + '"]');
    if (el) el.classList.add('tab-enter');
    return d;
  },

  captureDoc(d) {
    if (App.state.edit) { try { App.exitEdit(false); } catch (e) { /* ignore */ } }
    if (App.cancelColorPreview) { try { App.cancelColorPreview(); } catch (e) { /* ignore */ } }
    const b = App.state.bg.image;
    const selIndexes = Array.from(App.state.selected)
      .map(id => App.state.layers.findIndex(l => l.id === id)).filter(i => i >= 0);
    d.data = {
      layers: App.state.layers.map(l => App.snapshotSlim(l)),
      view: { x: App.state.view.x, y: App.state.view.y, scale: App.state.view.scale },
      clipboard: JSON.parse(JSON.stringify(App.state.clipboard || [])),
      selIndexes,
      selectedByTab: !!App.state.selectedByTab,
      selBarDismissed: !!App.state.selBarDismissed,
      lastColor: App.state.lastColor,
      histColors: (App.histColors || []).slice(0, 16),
      layersHidden: !!App.state.layersHidden,
      layersDisplayOpacity: App.state.layersDisplayOpacity ?? 1,
      bgHidden: !!App.state.bg.hidden,
      bgDisplayOpacity: App.state.bgDisplayOpacity ?? 1
    };
    d.__thumbUrl = null;
    this.prewarmDocThumb(d);
    d.bg = b;
    d.historyU = App.history.undoStack;
    d.historyR = App.history.redoStack;
  },

  blankInto(d) {
    if (!d.data) {
      d.data = {
        layers: [], view: { x: App.state.view.x, y: App.state.view.y, scale: 1 },
        clipboard: [], selIndexes: [], selectedByTab: false, selBarDismissed: false,
        lastColor: '#ffffff', histColors: [], layersHidden: false,
        layersDisplayOpacity: 1, bgHidden: false, bgDisplayOpacity: 1
      };
      d.bg = null;
      d.historyU = [];
      d.historyR = [];
      d.contentRevision = d.contentRevision || 0;
    }
  },

  loadDoc(d) {
    if (App.speedEditor) App.speedEditor.cancel();
    this.blankInto(d);
    if (App.state.edit) { try { App.exitEdit(false); } catch (e) { /* ignore */ } }
    if (App.cancelColorPreview) { try { App.cancelColorPreview(); } catch (e) { /* ignore */ } }
    if (App.invalidateEditStatic) App.invalidateEditStatic();
    App.clearAllLayers();
    App.bgSeq++;
    if (App.state.bg.image && App.state.bg.image.el && App.state.bg.image.el.parentNode) {
      App.state.bg.image.el.parentNode.removeChild(App.state.bg.image.el);
    }
    App.state.bg.image = null;
    const data = d.data;
    App.state.bgDisplayOpacity = (typeof data.bgDisplayOpacity === 'number') ? data.bgDisplayOpacity : 1;
    if (d.bg && d.bg.el) {
      App.bgG.appendChild(d.bg.el);
      App.state.bg.image = d.bg;
      App.state.bg.hidden = !!data.bgHidden;
      App.applyBgTransform(d.bg);
      App.applyBgDisplayOpacity();
    } else {
      App.state.bg.image = null;
      App.state.bg.hidden = false;
      App.applyBgDisplayOpacity();
    }
    (data.layers || []).forEach(slim => {
      const l = App.deserializeLayer(slim);
      App.relinkSymbolData(l);
      App.buildLayerElement(l);
      App.layersRoot.appendChild(l.el);
      App.state.layers.push(l);
      App.registerChildren(l);
    });
    App.updateBaseButtons();
    if (App.updateHideLayersButton) App.updateHideLayersButton();
    if (App.updateHideBgButton) App.updateHideBgButton();
    if (App.updateBgOpacitySlider) App.updateBgOpacitySlider();
    if (App.updateLayersDisplaySlider) App.updateLayersDisplaySlider();
    App.state.lastColor = data.lastColor;
    if (App.setPanelColor) App.setPanelColor(data.lastColor, false, false);
    App.state.clipboard = JSON.parse(JSON.stringify(data.clipboard || []));
    App.histColors = Array.isArray(data.histColors) ? data.histColors.slice(0, 16) : [];
    if (App.renderHistGrid) App.renderHistGrid();
    App.state.layersHidden = !!data.layersHidden;
    App.state.layersDisplayOpacity = (typeof data.layersDisplayOpacity === 'number') ? data.layersDisplayOpacity : 1;
    App.applyLayersDisplayOpacity();
    if (App.state.bg.image && !App.state.bg.image.el) { App.state.bg.image = null; }
    App.state.selected = new Set((data.selIndexes || []).map(i => (App.state.layers[i] ? App.state.layers[i].id : null)).filter(Boolean));
    App.state.selectedByTab = !!data.selectedByTab;
    App.state.selBarDismissed = !!data.selBarDismissed;
    this.current = d;
    if (data.view && isFinite(data.view.x)) {
      App.state.view.x = data.view.x;
      App.state.view.y = data.view.y;
      App.state.view.scale = clamp(data.view.scale || 1, 0.02, 32);
    }
    App.updateView();
    App.ensureMaskIndDef();
    App.history.undoStack = d.historyU || [];
    App.history.redoStack = d.historyR || [];
    App.history.gesture = false;
    if (App.editHist) App.editHist.reset();
    App.editSession = null;
    App.state.edit = null;
    App.state.groupEdit = [];
    App.state.hideOthers = false;
    App.state.keys.clear();
    App.drag = null;
    App.refreshPanel();
    App.refreshCount();
    App.refreshClipboardPanel();
    App.drawOutlines();
    App.updateSelToolbar();
    App.refreshLayerThumbs();
    if (App.stopFlash) App.stopFlash();
    if (App.maybeBakeProxy) App.state.layers.forEach(l => { if (l.kind === 'merged') App.maybeBakeProxy(l); });
    if (App.requestFlashRefresh && App.state.selected.size) App.requestFlashRefresh();
    if (App.warmupSymbols) App.warmupSymbols();
    this.flashCanvasIn();
  },

  flashCanvasIn() {
    if (this._silentRender) return;
    const w = document.getElementById('canvasWrap');
    if (!w) return;
    w.classList.remove('sve-tab-in');
    void w.offsetWidth;
    w.classList.add('sve-tab-in');
    clearTimeout(this._tabInTimer);
    this._tabInTimer = setTimeout(() => w.classList.remove('sve-tab-in'), 400);
  },

  switchTo(id) {
    const d = this.docs.find(x => x.id === id);
    if (!d || d === this.current) { if (App.Home) App.Home.hide(); this.renderBar(); return; }
    if (this.current) this.captureDoc(this.current);
    this.loadDoc(d);
    if (App.Home) App.Home.hide();
    this.renderBar();
  },

  docFileName(doc) {
    const d = doc || this.current;
    if (!d) return App.i18n.t('tab.untitled');
    return d.svgSource || d.label || App.i18n.t('tab.untitled');
  },
  markDirty() {
    const d = this.current;
    if (d) {
      d.dirty = true;
      d.contentRevision = (d.contentRevision || 0) + 1;
    }
  },
  clearDirty(id) {
    const d = id ? this.docs.find(x => x.id === id) : this.current;
    if (d) d.dirty = false;
  },
  async saveWorkCopyForDoc(id) {
    const doc = this.docs.find(x => x.id === id);
    if (!doc || typeof App.buildWorkCopyStringForDoc !== 'function') return null;
    const startRevision = doc.contentRevision || 0;
    try {
      const s = App.buildWorkCopyStringForDoc(doc);
      if (!s) return null;
      const r = await window.sveApi.fileSaveWork(s, doc.workSource || null);
      if (!r || !r.ok) return r || { ok: false };
      if (this.docs.includes(doc) && (doc.contentRevision || 0) === startRevision) doc.dirty = false;
      if (r.source) doc.workSource = r.source;
      return r;
    } catch (e) { return null; }
  },
  async closeAllTabsGuard() {
    const dirtyDocs = this.docs.filter(d => d.dirty);
    if (!dirtyDocs.length) return true;
    for (const d of dirtyDocs) {
      const r = await window.sveApi.confirmCloseDoc(this.docFileName(d));
      const act = r && r.action;
      if (act === 'cancel') return false;
      if (act === 'save') {
        const saved = await this.saveWorkCopyForDoc(d.id);
        if (!saved || !saved.ok) return false;
      }
      if (act === 'dont') d.dirty = false;
    }
    return true;
  },
  async closeDoc(id) {
    const doc = this.docs.find(x => x.id === id);
    if (!doc) return false;
    if (doc.dirty && !this._silentRender) {
      let act = 'dont';
      try {
        const r = await window.sveApi.confirmCloseDoc(this.docFileName(doc));
        act = (r && r.action) || 'dont';
      } catch (e) { act = 'dont'; }
      if (act === 'cancel') return false;
      if (act === 'save') {
        const saved = await this.saveWorkCopyForDoc(id);
        if (!saved || !saved.ok) return false;
      }
    }
    this.removeDocNow(id);
    return true;
  },
  removeDocNow(id) {
    const idx = this.docs.findIndex(x => x.id === id);
    if (idx < 0) return;
    const wasCurrent = this.docs[idx] === this.current;
    if (wasCurrent && this.current) this.captureDoc(this.current);
    this.docs.splice(idx, 1);
    if (wasCurrent) {
      const next = this.docs[Math.max(0, idx - 1)] || null;
      if (next) { this.loadDoc(next); if (!this._silentRender && App.Home) App.Home.hide(); }
      else {
        if (App.state.edit) { try { App.exitEdit(false); } catch (e) { /* ignore */ } }
        App.clearAllLayers();
        App.bgSeq++;
        if (App.state.bg.image && App.state.bg.image.el && App.state.bg.image.el.parentNode) {
          App.state.bg.image.el.parentNode.removeChild(App.state.bg.image.el);
        }
        App.state.bg.image = null;
        App.history.undoStack = [];
        App.history.redoStack = [];
        this.current = null;
        App.refreshPanel();
        App.refreshCount();
        App.updateView();
        if (this._silentRender) { }
        else if (App.Home && !this.testMode) App.Home.show();
        else if (App.Home) App.Home.hide();
      }
    } else if (!this._silentRender) {
      if (App.Home) App.Home.hide();
    }
    this.renderBar();
  },

  isEmptyActive() {
    return !this.current || (this.current.data && !this.current.data.layers.length);
  },

  setLabel(text) {
    if (this.current) {
      this.current.label = String(text || App.i18n.t('name.untitled'));
      this.renderBar();
    }
  },

  setDocLabel(id, text) {
    const d = this.docs.find(x => x.id === id);
    if (!d) return false;
    d.label = String(text || App.i18n.t('name.untitled'));
    this.renderBar();
    return true;
  },

  prodNewSvg(content, label, sourceName) {
    const d = this.addDoc({ silent: true, label: label || App.i18n.t('name.untitled'), svgSource: sourceName || null });
    App.importSVGContent(content);
    this.setLabel(label || App.i18n.t('name.untitled'));
    if (App.Home) App.Home.hide();
    return d;
  },
  prodNewWork(content, name, source) {
    const label = String(name || App.i18n.t('name.workcopy')).replace(/\.svework$/i, '') || App.i18n.t('name.workcopy');
    const d = this.addDoc({ silent: true, label });
    App.openWorkCopyContent(content, name, source);
    this.setLabel(label);
    if (App.Home) App.Home.hide();
    return d;
  }
};

App.layoutFloatingBoxes = function () {
  const wrap = document.getElementById('canvasWrap');
  if (!wrap) return;
  const r = wrap.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  const left = Math.max(0, Math.round(r.left));
  const right = Math.min(vw, Math.round(r.right));
  const bottom = Math.min(vh, Math.round(r.bottom));
  const place = function (el, defW, defH, align) {
    if (!el) return;
    const b = el.getBoundingClientRect();
    const w = Math.round(b.width) || defW, h = Math.round(b.height) || defH;
    el.style.position = 'fixed';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.left = (align === 'right' ? Math.max(0, right - w - 10) : left + 10) + 'px';
    el.style.top = Math.max(0, bottom - h - 10) + 'px';
  };
  place(document.getElementById('clipboardPanel'), 200, 122, 'right');
};
(function () {
  if (App.__floatBoxTimer) return;
  const call = function () { try { App.layoutFloatingBoxes(); } catch (e) { } };
  App.__floatBoxTimer = setInterval(call, 1000);
  window.addEventListener('resize', function () { setTimeout(call, 80); });
  setTimeout(call, 300); setTimeout(call, 1200);
})();
