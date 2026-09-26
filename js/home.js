'use strict';
/* 首页（主页）：PS 风格最近使用项。左侧：主页/新建/打开；主区：全部 | 最近工作副本 | SVG图像
   三分类、排序（最近使用/名称/大小）、搜索文件名过滤、卡片网格（名称+相对时间+大小）。
   工作副本/保存的 SVG 自动存 <exe目录>\工作副本\ 与 <exe目录>\SVG图像\。 */

App.Home = {
  items: [],  tab: 'all',      // all | workcopy | svg
  sort: 'recent',  // recent | name | size
  query: '',
  shown: false,
  testMode: false,
  selectedItem: null, // 单选中的文件（另存为/删除作用于它）

  async init() {
    try {
      const flags = await window.sveApi.appFlags();
      this.testMode = !!(flags && flags.testMode);
    } catch (e) { this.testMode = false; }
    /* 主页入口统一在顶部标签栏（常驻首标签）；此处不再单独挂按钮 */
    document.querySelectorAll('#homeRail [data-home-act]').forEach(b => {
      b.addEventListener('click', () => this.rail(b.getAttribute('data-home-act')));
    });
    /* EvolveUI 页签切换：radio change → 更新 tab + 定位 glider */
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
      /* 初始定位（等 DOM 渲染完） */
      requestAnimationFrame(posGlider);
      window.addEventListener('resize', () => requestAnimationFrame(posGlider));
    }
    const sort = document.getElementById('homeSort');
    sort.addEventListener('change', () => { this.sort = sort.value; this.render(); });
    const search = document.getElementById('homeSearch');
    search.addEventListener('input', () => { this.query = search.value.trim().toLowerCase(); this.render(); });
    /* 选中项操作：打开 / 重命名 / 另存为 / 删除（用户 2026-09-11 要求「打开」置于最前） */
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
    /* 常驻按键：导入（选文件 → 复制进 SVGImages 目录）与刷新（重列主页文件） */
    const impBtn = document.getElementById('btnHomeImport');
    if (impBtn) impBtn.addEventListener('click', () => this.importFiles());
    const refBtn = document.getElementById('btnHomeRefresh');
    if (refBtn) refBtn.addEventListener('click', () => {
      this.refresh();
      showToast(App.i18n.t('toast.home.refreshed'));
    });
    /* 自动目录内容变化时刷新（保存工作副本/保存SVG 后） */
    window.addEventListener('sve-dirty', () => this.refresh());
    /* EvolveUI 风格下拉：统一走 App.evDropdown（util.js）。
       原先这里有一份**重复实现**，它不会在切语言时重建克隆 → 首页排序下拉的
       选项文字永远停在旧语言。合并成一份后由 App.evDropdownSyncAll 统一刷新。 */
    this.__evDropdownsInit = true;
    document.querySelectorAll('#homeSort').forEach(sel => {
      if (App.evDropdown) App.evDropdown(sel);
    });

    /* 首次启动自动落首页（测试模式跳过，避免遮挡冒烟测试） */
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
    /* 进入不显示画布的页面：速率设置窗口执行取消逻辑（临时速率回滚，不跨页面带走） */
    if (App.speedEditor) App.speedEditor.cancel();
    this.refresh();
    /* ★ 先把画布区「停靠」再显示主页（用户 2026-09-20：切主页后标签页还在下方渲染，图层多时很卡）。
       顺序有讲究：先挂 parked（跳渲染），主页遮罩的 blur(24px) 下面就没东西可模糊了。
       用 content-visibility:hidden 而不是 display:none —— 保留布局尺寸，
       切回编辑器时视图/仪表不发生归零重算，避免回到画布时的跳动与重排。 */
    this.parkCanvas(true);
    App.showOverlay(document.getElementById('homeOverlay'));
    /* 蓝框跟随真实视图：主页显示后把活动态归到「主页」pill（见 tabs.js renderBar） */
    if (App.Tabs && App.Tabs.renderBar) App.Tabs.renderBar();
    /* 左下角 Forza 功能坞已移入主页左栏，随主页整体显隐，无需手动切换 */
    if (App.state && App.state.edit) App.exitEdit(false);
  },
  hide() {
    this.shown = false;
    this.cancelThumbQueue();
    /* ★ 先恢复画布区再收起主页遮罩，避免「遮罩已淡出、画布还没回来」的空窗帧 */
    this.parkCanvas(false);
    App.hideOverlay(document.getElementById('homeOverlay'));
    if (App.kickLibraryThumbQueue) App.kickLibraryThumbQueue();
    if (App.Tabs && App.Tabs.renderBar) App.Tabs.renderBar();
  },

  /* 主页期间停靠/恢复画布区（#main）。见 css/style.css 里 .sve-home-parked 的说明。 */
  parkCanvas(on) {
    const main = document.getElementById('main');
    if (main) main.classList.toggle('sve-home-parked', !!on);
  },
  toggle() { this.shown ? this.hide() : this.show(); },

  async refresh() {
    if (!this.shown) return;
    /* 只在真正进入缩略图界面时启动独立 renderer；编辑画布期间不让它常驻抢资源。
       不预先等待/启动隐藏窗口：先把卡片和加载动画画出来，首个缩略图任务
       自己负责启动 renderer 并排队，主页不会被预热过程挡住。 */
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
    /* main：回到主页列表 */
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
    App.openSVG(); /* 多标签：打开文件开新标签并自动回编辑器 */
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

  /* 卡片缩略图 URL 缓存：key = type:name@mtime。切到标签页再切回主页直接复用，
     不重新生成也不重新下载（用户 2026-09-15：「主页的缩略图加载后要保留」）。
     文件被改动后 mtime 变 → key 变 → 自然重新生成。 */
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
      /* 命中缓存直接上屏（连 IPC 都不发）——这是「切回主页不重新加载」的关键 */
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

  /* 相对时间：全部走词条（切语言时随 Home 重渲一起变，见 main.js 的重刷器） */
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
      /* 大文件缩略图只在卡片进入可视区后串行生成；打开主页不再同时解析全部文件。 */
      thumbCards.push({ it, card });
      /* 单击=选中（高亮 + 搜索框下出现 另存为/删除）；双击=新标签打开 */
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
    /* 操作条状态跟着「有没有选中」走：导入/刷新常驻可用，四个文件操作按需置灰 */
    this.updateSelBar();
  },

  /* ---------- 选中与操作 ---------- */
  /* 操作条常驻（用户 2026-09-15）：导入/刷新 永远可用；打开/重命名/另存为/删除
     只在选中文件时可用（未选中时置灰，不留可点的死按钮） */
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
  /* 导入：选本地文件 → 复制进软件 SVGImages 目录 → 立即刷新列表 */
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
    /* 二次确认后才删除(取消不删) */
    const ok = await fzaConfirm(App.i18n.t('dlg.delTitle'),
      App.i18n.tf('dlg.delMsg', { name: it.name }), App.i18n.t('dlg.delOk'));
    if (!ok) return;
    const r = await window.sveApi.fileDelete(it.type === 'svg' ? 'svg' : 'workcopy', it.name);
    if (!r.ok) { showToast(App.i18n.tf('toast.home.delFail', { v: (r.error || '') })); return; }
    showToast(App.i18n.tf('toast.home.deleted', { v: it.name }));
    this.clearSelect();
    this.refresh();
  },

  /* 主页重命名:弹输入框(预填当前名去后缀) → fileRename → 刷新;当前打开文档即该文件则同步源名 */
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
    /* 若当前打开文档的源名=旧名,同步为新的(后续保存用新名) */
    const cur = (App.Tabs && App.Tabs.current) ? App.Tabs.current.svgSource : App.currentSvgSource;
    if (cur === it.name && App.recordSvgSource) App.recordSvgSource(r.name);
    /* 工作进程：主进程已把源句柄重指向新路径，这里只把显示名同步过来 */
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

  /* 工作副本 → SVG 内容（离屏导出，不动当前画布；实现只有一份，见 App.buildSvgFromWorkCopy） */
  async buildSvgFromWorkCopy(name) {
    return App.buildSvgFromWorkCopy(name);
  },

  async openItem(it) {
    this.clearSelect();
    const prod = !!(App.Tabs && !App.Tabs.testMode);
    if (it.type === 'workcopy') {
      const r = await window.sveApi.fileRead('workcopy', it.name);
      if (!r.ok) { showToast(App.i18n.tf('toast.home.openWorkFail', { v: (r.error || '') })); return; }
      /* r.source = 主进程签发的源文件句柄；带上它，之后保存才是回写这份文件而不是另存新文件 */
      if (prod) { App.Tabs.prodNewWork(r.content, r.name, r.source); return; }
      App.openWorkCopyContent(r.content, r.name, r.source);
      this.hide();
      return;
    }
    const r = await window.sveApi.fileRead('svg', it.name);
    if (!r.ok) { showToast(App.i18n.tf('toast.home.openSvgFail', { v: (r.error || '') })); return; }
    if (prod) { App.Tabs.prodNewSvg(r.content, it.name.replace(/\.svg$/i, '') || '未命名', it.name); return; }
    App.currentSvgSource = it.name; /* 非生产模式(测试)：标记源文件，保存时覆写 */
    App.importSVGContent(r.content);
    if (App.Tabs && App.Tabs.clearDirty) App.Tabs.clearDirty(); /* 打开文件=干净状态 */
    this.hide();
  }
};

/* 工作进程 → Forza SVG 内容（**离屏**：只在内存里反序列化图层并导出，绝不借用画布）
   必须是 App 级函数：主页卡片缩略图分支依赖 App.buildSvgFromWorkCopy。

   2026-09-12 根因修复（用户报障：「打开某标签后切回主页再切回来，画布上显示的就是其他的图案了，
   调一下缩放刷新一下又回来了」）：旧实现为了拿到导出字符串，先 openWorkCopyContent 把工作进程
   内容【装载进画布】再导出、然后靠 finally 还原。那条路径直接改写共享的 App.state.view 与
   App.state.layers（io.js 里是直接赋值、不过 updateView 漏斗），于是：
     · 停在主页时画布被换成工作进程的图案、视图被换成它的取景；
     · 切回标签时 switchTo 命中「同一文档」早退分支、不会重载 → 画布就停在那份借来的内容上；
     · 手动缩放/刷新会触发重绘，看起来「又回来了」。
   现在改为离屏图层直接导出（buildForzaExportString 接受显式图层数组）：不碰画布、不碰视图、
   不建临时标签、不动历史栈与选中 —— 主页渲染期间画布状态零变更。 */
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
    if (T) { prevSilent = !!T._silentRender; T._silentRender = true; }  /* 缩略图渲染期间不弹 toast */
    App._workCopyRenderSeq = (App._workCopyRenderSeq || 0) + 1;
    const layers = App.deserializeLayersDetached(data.layers || [], 'workcopy_' + App._workCopyRenderSeq + '_');
    return App.buildForzaExportString(true, layers);  /* quiet：不弹"画布上还没有图层" */
  } catch (e) {
    console.warn('[home] 工作进程离屏导出失败', String(e && e.message || e).slice(0, 160));
    return null;
  } finally {
    if (T) T._silentRender = prevSilent;
  }
};

/* 历史锚点 → SVG 内容（离屏导出）。
   与上面的 buildSvgFromWorkCopy 是**同一套做法**（锚点和「工作进程」本来就是同一种数据：
   type === 'sve-work-copy'），唯一区别是读取来源 —— 锚点走 histAnchorRead
   （WorkCopiesHistory 目录），工作进程走 fileRead('workcopy')。
   用户 2026-09-23 要求：恢复工作进程列表里每项左侧显示图案缩略图，且与主页一致 ——
   所以复用主页那条链路：buildSvgFromAnchor → App.fzaSvgThumb（带缓存）。 */
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
    if (T) { prevSilent = !!T._silentRender; T._silentRender = true; }  /* 缩略图渲染期间不弹 toast */
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

/* 空白文档：编辑中先退出，清空图层/背景（历史保留一条离散点，可撤回打开前状态） */
App.blankDocument = function () {
  if (App.cancelColorPreview) App.cancelColorPreview();
  if (App.state.edit) App.exitEdit(false);
  App.history.markDiscrete();
  if (App.Tabs && App.Tabs.clearDirty) App.Tabs.clearDirty(); /* 新建空白=干净状态 */
  /* 空白文档不再属于任何磁盘文件：必须解除源文件关联，
     否则「保存」会把空白内容写回刚才那份文件（工作进程 / SVG 都会被清空） */
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
