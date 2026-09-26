'use strict';

App.Home = {
  items: [],  tab: 'all',      // all | workcopy | svg
  sort: 'recent',  // recent | name | size
  query: '',
  shown: false,
  testMode: false,
  selectedItem: null,

  async init() {
    try {
      const flags = await window.sveApi.appFlags();
      this.testMode = !!(flags && flags.testMode);
    } catch (e) { this.testMode = false; }
    document.querySelectorAll('#homeRail [data-home-act]').forEach(b => {
      b.addEventListener('click', () => this.rail(b.getAttribute('data-home-act')));
    });
    const homeTabs = document.getElementById('homeTabs');
    if (homeTabs) {
      const posGlider = () => {
        const track = homeTabs.querySelector('.ev-tabs-track');
        const checked = track && track.querySelector('input:checked');
        const label = checked ? track.querySelector('label[for="' + checked.id + '"]') : null;
        const glider = track && track.querySelector('.ev-glider');
        if (!label || !glider) return;
        glider.style.width = label.offsetWidth + 'px';
        glider.style.transform = 'translateX(' + label.offsetLeft + 'px)';
      };
      homeTabs.querySelectorAll('input[type="radio"]').forEach(r => {
        r.addEventListener('change', () => {
          this.tab = r.value;
          posGlider();
          this.render();
        });
      });
      requestAnimationFrame(posGlider);
      window.addEventListener('resize', () => requestAnimationFrame(posGlider));
    }
    const sort = document.getElementById('homeSort');
    sort.addEventListener('change', () => { this.sort = sort.value; this.render(); });
    const search = document.getElementById('homeSearch');
    search.addEventListener('input', () => { this.query = search.value.trim().toLowerCase(); this.render(); });
    const opBtn = document.getElementById('btnHomeOpen');
    if (opBtn) opBtn.addEventListener('click', () => {
      const it = this.selectedItem;
      if (it) this.openItem(it);
    });
    const reBtn = document.getElementById('btnHomeRename');
    if (reBtn) reBtn.addEventListener('click', () => this.renameSelected());
    const exBtn = document.getElementById('btnHomeExportAs');
    exBtn.addEventListener('click', () => this.exportAs());
    const delBtn = document.getElementById('btnHomeDelete');
    delBtn.addEventListener('click', () => this.delSelected());
    const impBtn = document.getElementById('btnHomeImport');
    if (impBtn) impBtn.addEventListener('click', () => this.importFiles());
    const refBtn = document.getElementById('btnHomeRefresh');
    if (refBtn) refBtn.addEventListener('click', () => {
      this.refresh();
      showToast(App.i18n.t('toast.home.refreshed'));
    });
    window.addEventListener('sve-dirty', () => this.refresh());
    this.__evDropdownsInit = true;
    document.querySelectorAll('#homeSort').forEach(sel => {
      if (App.evDropdown) App.evDropdown(sel);
    });

    const wait = setInterval(() => {
      if (App.state && App.state.loaded) {
        clearInterval(wait);
        if (!this.testMode) setTimeout(() => this.show(), 400);
      }
    }, 250);
  },

  show() {
    if (this.shown) return;
    this.shown = true;
    if (App.speedEditor) App.speedEditor.cancel();
    this.refresh();
    this.parkCanvas(true);
    App.showOverlay(document.getElementById('homeOverlay'));
    if (App.Tabs && App.Tabs.renderBar) App.Tabs.renderBar();
    if (App.state && App.state.edit) App.exitEdit(false);
  },
  hide() {
    this.shown = false;
    this.cancelThumbQueue();
    this.parkCanvas(false);
    App.hideOverlay(document.getElementById('homeOverlay'));
    if (App.kickLibraryThumbQueue) App.kickLibraryThumbQueue();
    if (App.Tabs && App.Tabs.renderBar) App.Tabs.renderBar();
  },

  parkCanvas(on) {
    const main = document.getElementById('main');
    if (main) main.classList.toggle('sve-home-parked', !!on);
  },
  toggle() { this.shown ? this.hide() : this.show(); },

  async refresh() {
    if (!this.shown) return;
    try {
      const r = await window.sveApi.fileRecent();
      if (r && r.ok) this.items = r.items;
    } catch (e) { this.items = []; }
    this.render();
  },

  rail(act) {
    document.querySelectorAll('#homeRail [data-home-act]').forEach(b =>
      b.classList.toggle('active', b.getAttribute('data-home-act') === act));
    if (act === 'new') { this.newDoc(); return; }
    if (act === 'open') { this.openDialog(); return; }
    this.refresh();
  },

  newDoc() {
    if (App.Tabs && !App.Tabs.testMode) {
      App.Tabs.addDoc({ label: null });
    } else {
      App.blankDocument();
    }
    this.hide();
    showToast(App.i18n.t('toast.home.newDoc'));
  },

  openDialog() {
    App.openSVG();
  },

  filtered() {
    let list = this.items.slice();
    if (this.tab === 'workcopy') list = list.filter(i => i.type === 'workcopy');
    else if (this.tab === 'svg') list = list.filter(i => i.type === 'svg');
    if (this.query) list = list.filter(i => i.name.toLowerCase().indexOf(this.query) >= 0);
    const name = a => a.name.toLowerCase();
    if (this.sort === 'name') list.sort((a, b) => name(a) < name(b) ? -1 : name(a) > name(b) ? 1 : b.mtime - a.mtime);
    else if (this.sort === 'size') list.sort((a, b) => b.size - a.size || b.mtime - a.mtime);
    else list.sort((a, b) => b.mtime - a.mtime);
    return list;
  },

  thumbKey(it) { return it.type + ':' + it.name + '@' + it.mtime; },
  cachedThumb(it) {
    if (!this._thumbCache) this._thumbCache = new Map();
    return this._thumbCache.get(this.thumbKey(it)) || '';
  },
  putThumb(it, url) {
    if (!url) return;
    if (!this._thumbCache) this._thumbCache = new Map();
    this._thumbCache.set(this.thumbKey(it), url);
  },

  cancelThumbQueue() {
    this._thumbEpoch = (this._thumbEpoch || 0) + 1;
    this._thumbQueue = [];
    if (this._thumbObserver) { this._thumbObserver.disconnect(); this._thumbObserver = null; }
    if (this._thumbStartTimer) { clearTimeout(this._thumbStartTimer); this._thumbStartTimer = null; }
    return this._thumbEpoch;
  },

  enqueueThumb(it, card, epoch) {
    if (!this.shown || epoch !== this._thumbEpoch || !card || card.dataset.thumbQueued) return;
    card.dataset.thumbQueued = '1';
    const cover = card.querySelector('.home-card-cover');
    card.__thumbLoader = App.startThumbLoading(cover);
    (this._thumbQueue || (this._thumbQueue = [])).push({ it, card, epoch });
    this.pumpThumbQueue(250);
  },

  pumpThumbQueue(delay) {
    if (this._thumbBusy || this._thumbStartTimer || !this.shown || !(this._thumbQueue || []).length) return;
    this._thumbStartTimer = setTimeout(async () => {
      this._thumbStartTimer = null;
      if (!this.shown) return;
      const job = this._thumbQueue.shift();
      if (!job || job.epoch !== this._thumbEpoch || !job.card.isConnected) {
        this.pumpThumbQueue(30);
        return;
      }
      this._thumbBusy = true;
      try { await this.loadCardThumb(job.it, job.card, job.epoch); }
      catch (e) { console.warn('[home] 卡片缩略图生成失败', String(e && e.message || e).slice(0, 160)); }
      finally {
        this._thumbBusy = false;
        this.pumpThumbQueue(30);
      }
    }, delay == null ? 30 : delay);
  },

  async loadCardThumb(it, card, epoch) {
    if (!it || !card || epoch !== this._thumbEpoch || !this.shown || !card.isConnected) return;
    const cover = card.querySelector('.home-card-cover');
    const img = card.querySelector('.home-card-thumb');
    const loader = card.__thumbLoader || App.startThumbLoading(cover);
    try {
      let url = this.cachedThumb(it);
      if (!url) {
      if (it.type === 'svg' && window.sveApi && App.fzaSvgThumb) {
        if (typeof window.sveApi.svgThumbFile === 'function') {
          const r = await window.sveApi.svgThumbFile(it.name);
          if (r && r.ok) {
            url = r.url || '';
            if (url) App.fzaSvgThumbCache.set(it.name + '@' + it.mtime, url);
          } else if (r && r.error) console.warn('[home] SVG 卡片缩略图生成失败', it.name, r.error);
        } else {
          const r = await window.sveApi.fileRead('svg', it.name);
          if (r && r.ok) url = await App.fzaSvgThumb(it.name, r.content, it.mtime);
        }
      } else if (it.type === 'workcopy' && App.buildSvgFromWorkCopy && App.fzaSvgThumb) {
        const built = await App.buildSvgFromWorkCopy(it.name);
        const svg = built && built.str ? built.str : null;
        if (svg) url = await App.fzaSvgThumb('workcopy:' + it.name, svg, it.mtime);
      }
      if (url) this.putThumb(it, url);
      }
      if (!url || epoch !== this._thumbEpoch || !this.shown || !img.isConnected) return;
      const loaded = await App.showThumbImage(cover, img, url, loader);
      if (!loaded || epoch !== this._thumbEpoch || !this.shown || !img.isConnected) return;
      img.classList.remove('hidden');
      cover.classList.add('has-thumb');
    } finally {
      App.finishThumbLoading(cover, loader);
      if (card.__thumbLoader === loader) card.__thumbLoader = null;
    }
  },

  relTime(ms) {
    const T = k => App.i18n.t(k);
    const diff = Date.now() - ms;
    if (diff < 0) return T('home.time.justNow');
    const m = Math.floor(diff / 60000);
    if (m < 1) return T('home.time.justNow');
    if (m < 60) return App.i18n.tf('home.time.minutes', { n: m });
    const h = Math.floor(m / 60);
    if (h < 24) return App.i18n.tf('home.time.hours', { n: h });
    const d = Math.floor(h / 24);
    if (d < 30) return App.i18n.tf('home.time.days', { n: d });
    const mo = Math.floor(d / 30);
    if (mo < 12) return App.i18n.tf('home.time.months', { n: mo });
    return App.i18n.tf('home.time.years', { n: Math.floor(d / 365) });
  },
  fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  },

  render() {
    const thumbEpoch = this.cancelThumbQueue();
    const grid = document.getElementById('homeGrid');
    const empty = document.getElementById('homeEmpty');
    grid.innerHTML = '';
    const list = this.filtered();
    if (!list.length) {
      empty.classList.remove('hidden');
      grid.classList.add('hidden');
      this.clearSelect();
      return;
    }
    empty.classList.add('hidden');
    grid.classList.remove('hidden');
    const frag = document.createDocumentFragment();
    const thumbCards = [];
    list.forEach(it => {
      const card = document.createElement('div');
      card.className = 'home-card' + (this.selectedItem && this.selectedItem.name === it.name ? ' sel' : '');
      const d = new Date(it.mtime);
      const stamp = d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0') +
        ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      card.innerHTML =
        '<div class="home-card-cover ' + (it.type === 'workcopy' ? 'cv-work' : 'cv-svg') + '">' +
        '<div class="thumb-grid"></div>' +
        '<img class="home-card-thumb hidden" alt=""></div>' +
        '<div class="home-card-name"></div>' +
        '<div class="home-card-meta"></div>';
      card.querySelector('.home-card-name').textContent = it.name;
      card.querySelector('.home-card-name').title = it.name;
      card.querySelector('.home-card-meta').textContent = this.relTime(it.mtime) + ' · ' + this.fmtSize(it.size);
      card.title = it.name + '\n' + stamp;
      thumbCards.push({ it, card });
      card.addEventListener('click', () => this.selectItem(it));
      card.addEventListener('dblclick', () => this.openItem(it));
      frag.appendChild(card);
    });
    grid.appendChild(frag);
    if (typeof IntersectionObserver === 'function') {
      this._thumbObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          this._thumbObserver.unobserve(entry.target);
          const found = thumbCards.find(x => x.card === entry.target);
          if (found) this.enqueueThumb(found.it, found.card, thumbEpoch);
        });
      }, { root: grid, rootMargin: '180px' });
      thumbCards.forEach(x => this._thumbObserver.observe(x.card));
    } else {
      thumbCards.forEach(x => this.enqueueThumb(x.it, x.card, thumbEpoch));
    }
    this.updateSelBar();
  },

  updateSelBar() {
    const bar = document.getElementById('homeSelBar');
    if (!bar) return;
    bar.classList.remove('hidden');
    const it = this.selectedItem;
    const nameEl = document.getElementById('homeSelName');
    if (nameEl) nameEl.textContent = it ? it.name : '';
    ['btnHomeOpen', 'btnHomeRename', 'btnHomeExportAs', 'btnHomeDelete'].forEach(id => {
      const b = document.getElementById(id);
      if (b) b.disabled = !it;
    });
  },
  selectItem(it) {
    this.selectedItem = it;
    this.updateSelBar();
    document.querySelectorAll('#homeGrid .home-card').forEach(c =>
      c.classList.toggle('sel', (this.selectedItem && c.querySelector('.home-card-name').textContent) === it.name));
  },
  clearSelect() {
    this.selectedItem = null;
    this.updateSelBar();
    document.querySelectorAll('#homeGrid .home-card.sel').forEach(c => c.classList.remove('sel'));
  },
  async importFiles() {
    if (!window.sveApi || !window.sveApi.homeImportDialog) return;
    let r = null;
    try { r = await window.sveApi.homeImportDialog(); }
    catch (e) { showToast(App.i18n.tf('toast.home.importFail', { v: String(e && e.message || e) })); return; }
    if (!r || !r.ok) { showToast(App.i18n.tf('toast.home.importFail', { v: (r && r.error) || '' })); return; }
    if (r.canceled) return;
    const n = (r.imported || []).length;
    showToast(App.i18n.tf('toast.home.imported', { n: n, names: (r.imported || []).join('、') }));
    this.refresh();
  },

  async delSelected() {
    const it = this.selectedItem;
    if (!it) return;
    const ok = await fzaConfirm(App.i18n.t('dlg.delTitle'),
      App.i18n.tf('dlg.delMsg', { name: it.name }), App.i18n.t('dlg.delOk'));
    if (!ok) return;
    const r = await window.sveApi.fileDelete(it.type === 'svg' ? 'svg' : 'workcopy', it.name);
    if (!r.ok) { showToast(App.i18n.tf('toast.home.delFail', { v: (r.error || '') })); return; }
    showToast(App.i18n.tf('toast.home.deleted', { v: it.name }));
    this.clearSelect();
    this.refresh();
  },

  async renameSelected() {
    const it = this.selectedItem;
    if (!it) return;
    const ext = it.type === 'svg' ? '.svg' : '.svework';
    const base = String(it.name).replace(/\.[^.]+$/, '');
    const inp = await App.fzaTextPrompt(App.i18n.t('dlg.renameTitle'),
      App.i18n.t(it.type === 'svg' ? 'dlg.renameMsgSvg' : 'dlg.renameMsgWork'), base);
    if (inp === null) return;
    let nm = String(inp).trim();
    nm = nm.replace(/\.[^.]+$/, '');
    if (!nm || nm.indexOf('/') >= 0 || nm.indexOf('\\') >= 0 || nm.indexOf('..') >= 0) {
      showToast(App.i18n.t('toast.home.badName')); return;
    }
    const r = await window.sveApi.fileRename(it.type === 'svg' ? 'svg' : 'workcopy', it.name, nm + ext);
    if (!r.ok) { showToast(App.i18n.tf('toast.home.renameFail', { v: (r.error || '') })); return; }
    showToast(App.i18n.tf('toast.home.renamed', { v: r.name }));
    const cur = (App.Tabs && App.Tabs.current) ? App.Tabs.current.svgSource : App.currentSvgSource;
    if (cur === it.name && App.recordSvgSource) App.recordSvgSource(r.name);
    const curDoc = App.Tabs && App.Tabs.current;
    if (it.type === 'workcopy' && curDoc && curDoc.workSource && curDoc.workSource.name === it.name) {
      curDoc.workSource.name = r.name;
    }
    this.clearSelect();
    this.refresh();
  },

  async exportAs() {
    const it = this.selectedItem;
    if (!it) return;
    if (it.type === 'svg') {
      const r = await window.sveApi.fileRead('svg', it.name);
      if (!r.ok) { showToast(App.i18n.tf('toast.home.readFail', { v: (r.error || '') })); return; }
      const s = await window.sveApi.saveSvgDialog(it.name, r.content);
      if (s && !s.canceled) showToast(App.i18n.tf('toast.home.savedAs', { v: s.path }));
      return;
    }
    const built = await this.buildSvgFromWorkCopy(it.name);
    if (!built) return;
    const s = await window.sveApi.saveSvgDialog(built.name, built.str);
    if (s && !s.canceled) showToast(App.i18n.tf('toast.home.savedAs', { v: s.path }));
  },

  async buildSvgFromWorkCopy(name) {
    return App.buildSvgFromWorkCopy(name);
  },

  async openItem(it) {
    this.clearSelect();
    const prod = !!(App.Tabs && !App.Tabs.testMode);
    if (it.type === 'workcopy') {
      const r = await window.sveApi.fileRead('workcopy', it.name);
      if (!r.ok) { showToast(App.i18n.tf('toast.home.openWorkFail', { v: (r.error || '') })); return; }
      if (prod) { App.Tabs.prodNewWork(r.content, r.name, r.source); return; }
      App.openWorkCopyContent(r.content, r.name, r.source);
      this.hide();
      return;
    }
    const r = await window.sveApi.fileRead('svg', it.name);
    if (!r.ok) { showToast(App.i18n.tf('toast.home.openSvgFail', { v: (r.error || '') })); return; }
    if (prod) { App.Tabs.prodNewSvg(r.content, it.name.replace(/\.svg$/i, '') || App.i18n.t('name.untitled'), it.name); return; }
    App.currentSvgSource = it.name;
    App.importSVGContent(r.content);
    if (App.Tabs && App.Tabs.clearDirty) App.Tabs.clearDirty();
    this.hide();
  }
};

App.buildSvgFromWorkCopy = async function (name) {
  const r = await window.sveApi.fileRead('workcopy', name);
  if (!r.ok) { showToast(App.i18n.tf('toast.home.readFail', { v: (r.error || '') })); return null; }
  let data;
  try { data = JSON.parse(r.content); }
  catch (e) { console.warn('[home] 工作进程内容解析失败', String(e && e.message || e).slice(0, 160)); return null; }
  if (!data || data.type !== 'sve-work-copy') return null;
  const T = App.Tabs;
  let prevSilent = false;
  try {
    if (T) { prevSilent = !!T._silentRender; T._silentRender = true; }
    App._workCopyRenderSeq = (App._workCopyRenderSeq || 0) + 1;
    const layers = App.deserializeLayersDetached(data.layers || [], 'workcopy_' + App._workCopyRenderSeq + '_');
    return App.buildForzaExportString(true, layers);
  } catch (e) {
    console.warn('[home] 工作进程离屏导出失败', String(e && e.message || e).slice(0, 160));
    return null;
  } finally {
    if (T) T._silentRender = prevSilent;
  }
};

App.buildSvgFromAnchor = async function (name) {
  const r = await window.sveApi.histAnchorRead(name);
  if (!r.ok) return null;
  let data;
  try { data = JSON.parse(r.content); }
  catch (e) { console.warn('[anchor] 锚点内容解析失败', String(e && e.message || e).slice(0, 160)); return null; }
  if (!data || data.type !== 'sve-work-copy') return null;
  const T = App.Tabs;
  let prevSilent = false;
  try {
    if (T) { prevSilent = !!T._silentRender; T._silentRender = true; }
    App._workCopyRenderSeq = (App._workCopyRenderSeq || 0) + 1;
    const layers = App.deserializeLayersDetached(data.layers || [], 'anchor_' + App._workCopyRenderSeq + '_');
    return App.buildForzaExportString(true, layers);
  } catch (e) {
    console.warn('[anchor] 锚点离屏导出失败', String(e && e.message || e).slice(0, 160));
    return null;
  } finally {
    if (T) T._silentRender = prevSilent;
  }
};

App.blankDocument = function () {
  if (App.cancelColorPreview) App.cancelColorPreview();
  if (App.state.edit) App.exitEdit(false);
  App.history.markDiscrete();
  if (App.Tabs && App.Tabs.clearDirty) App.Tabs.clearDirty();
  if (App.recordWorkSource) App.recordWorkSource(null);
  if (App.recordSvgSource) App.recordSvgSource(null);
  if (App.state.bg.image && App.state.bg.image.el) App.state.bg.image.el.remove();
  App.state.bg.image = null;
  App.state.bg.hidden = false;
  App.state.batching = true;
  try { App.state.layers.slice().forEach(l => App.removeTopLayer(l)); } finally { App.state.batching = false; }
  App.setSelection([]);
  if (App.stopFlash) App.stopFlash();
  App.refreshPanel();
  App.refreshCount();
  App.refreshLayerThumbs();
  if (App.contentChanged) App.contentChanged({ preserveAutoStatic: false });
};

(function () {
  let inited = false;
  const boot = () => {
    if (inited || !App.Home) return;
    inited = true;
    App.Home.init();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else if (App.state) boot();
  else setTimeout(boot, 200);
})();
