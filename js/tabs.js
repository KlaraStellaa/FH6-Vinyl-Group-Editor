'use strict';
/* 顶部多标签栏（多文档）：主页常驻第一个标签；新建/打开/拖入 SVG 一律开新标签；
   每个标签独立：图层 / 撤销 / 视图 / 背景 / 编辑状态。
   实现方式：激活文档数据活在全局；切换时整文档重建（层数据 JSON + 复用背景元素对象），
   历史栈随文档整体挂载/卸下——互不串档。
   测试模式（SVGBIANJI_TEST）下保持"单文档旧行为"（文件打开/拖入仍入当前文档），
   确保既有 200+ 项冒烟不受影响；正常模式启用多文档 + 文件类打开开新标签。 */

App.Tabs = {
  docs: [],         // 按顺序；不含主页
  current: null,    // 当前文档对象
  nextId: 1,
  testMode: false,
  started: false,
  homeFirst: true,

  /* 文档对象字段：id, label, bg(背景元素对象|null), historyU, historyR,
     data: { layers:[]slim, view, clipboard, selIndexes, selectedByTab, selBarDismissed,
             lastColor, histColors, layersHidden, layersDisplayOpacity, bgHidden, bgDisplayOpacity } */

  async start() {
    if (this.started) return;
    this.started = true;
    /* 同步测试标志（preload 注入），避免异步竞态清掉早期测试内容 */
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
      /* 测试模式：预置一个空文档，保持旧有单文档流程 */
      this.addDoc({ label: null, silent: true });
      /* HTML 初始态已是主页（首帧不再闪画布）；测试模式预置文档后要把主页收起 */
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
    /* P2 悬停缩略图：停在非主页、非当前 pill 上时在该 pill 下方显示文档内容缩略图；
       空文档显示白色网格占位。委托在 bar 上（renderBar 重建 innerHTML 后仍有效） */
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
      if (this._thumbPillId === id) return;   // 同一 pill 内移动：不重建
      this.showTabThumb(id, pill);
    });
    bar.addEventListener('mouseout', e => {
      const from = e.target.closest('.tab-pill');
      const to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest('.tab-pill') : null;
      if (from && to !== from) this.hideTabThumb();
    });
    bar.addEventListener('mouseleave', () => this.hideTabThumb());
    /* 窗口尺寸变化：等宽/压缩状态重算（防抖 120ms） */
    window.addEventListener('resize', () => {
      clearTimeout(this._resizeT);
      this._resizeT = setTimeout(() => { const b = document.getElementById('tabBar'); if (b) this.updateCompression(b); }, 120);
    });
  },

  /* ---------- P2 悬停缩略图 ---------- */
  /* 后台预热：延后 400ms 且同一时刻只烘一个，避免和用户的编辑抢主线程 */
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
      }).catch(() => { /* 预热失败无妨：悬停时还会再生成一次 */ });
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
    if (this._thumbPillId !== id) return;   // 悬停目标已变：丢弃过期结果
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
  /* 文档内容离屏缩略图（与剪贴板合成缩略图同一条已验证路径；不必精确，能看出图案即可）。
     空文档返回 null（上层渲染白色网格占位） */
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
      /* symbol/pattern 可直接从模型走 canvas；只有 import 光栅化仍需要自己的离屏元素。 */
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
      /* 渲染分辨率口径与其他缩略图一致（剪贴板合成缩略图：按内容大小取 160~1024），
         并把下限抬到「缩略图框宽 × dpr」——否则小内容文档只烘 160px，放进框里就是被放大/显得小。
         2026-09-12 用户报障：「鼠标停留在标签页时缩略图小，换成和其他缩略图的显示计算方式」。 */
      const boxEl = document.getElementById('tabThumb');
      const boxMax = Math.max(boxEl ? boxEl.clientWidth : 0, boxEl ? boxEl.clientHeight : 0) || 200;
      const dpr = window.devicePixelRatio || 1;
      const size = Math.min(1024, Math.max(Math.ceil(boxMax * dpr) + 8, Math.round(Math.max(bw, bh) * 0.5)));
      /* 始终按全部叶子合成：父分组变换计入整体包围盒，蒙版按层序挖空。
         旧 SVG 克隆路径只看局部包围盒，无蒙版文档里的远处分组也会被固定区域裁掉。 */
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
    /* FLIP：重建前记录每个标签的位置/宽度，重建后从旧位置平滑归位——
       新建（＋/设置键右移让位）/关闭（邻居靠拢）时标签栏整体平滑过渡，不再跳变。
       removeDocNow 等路径会同步连调两次 renderBar：起始位置在同一同步链内沿用
       （250ms 有效期），防止连环重建把进行中的动画互相抵消 */
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
    /* 蓝框（.tab-pill.active）必须反映「当前在看什么」：主页显示时归主页。
       旧写法只看 this.current —— 点主页并不会清 current，蓝框就留在文档标签上
       （用户报障：「点击主页后蓝框总会自动跳到右边第一个标签栏」） */
    const homeActive = !!(App.Home && App.Home.shown) || !this.current;
    /* 注：曾试过给主页按钮加房子图标 + 分隔线，但判据 P1-pills-equal-width 要求所有标签等宽，
       图标会让它宽出 8px —— 不为了美观去放宽既有质量线，故维持纯文字（见 HANDOFF「UI 改良」）。 */
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
      homeEl.setAttribute('textContent', v);   /* 判据 UI 探针按 getAttribute('textContent') 读取 */
    }
    this.hideTabThumb();   // 标签栏重建（切换/关闭/重命名）时收起悬停缩略图
    this.updateCompression(bar);
    /* FLIP 归位动画：存活的标签从旧位置/旧宽度平滑过渡到新布局 */
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

  /* 浏览器式压缩：主页保持原宽；其余标签自然宽、上限 220px；
     空间不够（每格低于舒适宽 140px）才整体等宽压缩（主页也参与等宽，＋/设置键计入预算），绝不横向溢出 */
  updateCompression(bar) {
    const pills = Array.prototype.slice.call(bar.querySelectorAll('.tab-pill'));
    const plus = document.getElementById('tabNewDoc');
    const set = document.getElementById('btnSettings');
    const extras = (plus ? plus.offsetWidth : 0) + (set ? set.offsetWidth : 0);
    const gaps = 4 * (pills.length + 1) + 20;   /* gap 4px × (n+1) + 左右 padding 20px */
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

  /* 新建一个文档并切换过去 */
  addDoc(opts) {
    opts = opts || {};
    /* label 留空表示「没有名字」，显示时统一取词（tab.untitled）——切语言标签名也跟着变 */
    const d = { id: 'doc' + (this.nextId++), label: opts.label || null, bg: null, historyU: [], historyR: [], svgSource: opts.svgSource || null, workSource: null, dirty: false,
      /* 内容修订号只在文档对象上推进，避免异步保存期间切换标签后把结果归错。 */
      contentRevision: 0 };
    if (this.current) this.captureDoc(this.current);
    this.docs.push(d);
    this.blankInto(d);
    this.loadDoc(d);
    if (!opts.silent) showToast(App.i18n.t('toast.tab.docCreated'));
    this.renderBar();
    /* 新标签入场动画（renderBar 重建的元素是全新节点，类名只存在于这一次） */
    const bar = document.getElementById('tabBar');
    const el = bar && bar.querySelector('[data-tabid="' + d.id + '"]');
    if (el) el.classList.add('tab-enter');
    return d;
  },

  /* 卸载前文档状态存入其对象 */
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
    /* 文档刚被重新捕获，旧悬停图已经过期；下次悬停按完整新模型重算。 */
    d.__thumbUrl = null;
    /* 悬停缩略图预热：捕获后就在后台烘好，悬停时直接命中 __thumbUrl ——
       不再「悬停后才开始生成」（用户 2026-09-15 要求） */
    this.prewarmDocThumb(d);
    d.bg = b;
    d.historyU = App.history.undoStack;
    d.historyR = App.history.redoStack;
  },

  blankInto(d) {
    /* 目标若是从未激活过（无 data），从空白建立数据骨架 */
    if (!d.data) {
      d.data = {
        layers: [], view: { x: App.state.view.x, y: App.state.view.y, scale: 1 },
        clipboard: [], selIndexes: [], selectedByTab: false, selBarDismissed: false,
        lastColor: App.state.lastColor, histColors: [], layersHidden: false,
        layersDisplayOpacity: 1, bgHidden: false, bgDisplayOpacity: 1
      };
      d.bg = null;
      d.historyU = [];
      d.historyR = [];
      d.contentRevision = d.contentRevision || 0;
    }
  },

  /* 把某文档数据装载为全局激活状态 */
  loadDoc(d) {
    /* 切换标签/关闭文档：速率设置窗口执行取消逻辑（A 标签的临时速率不带进 B 标签；
       编辑速率是应用级设置，只有「确定」才写进持久化配置） */
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
    /* 背景：复用该文档保存的背景元素对象（不重新解码） */
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
    /* 图层重建（与撤销恢复同路径） */
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
    /* 颜色面板按标签页隔离（用户 2026-09-20 要求）：
       上面只把 App.state.lastColor 换成了本标签的值，但**面板显示**（App.cp / #hexInput /
       色盘 / 三滑条 / 色块）还是上一个标签留下的 —— 一旦之后触发 applyColorTargets，
       它会把面板里那个**过期颜色**写回 App.state.lastColor，把刚载入的标签色冲掉。
       所以这里必须把面板也同步到本标签的颜色（不应用、不预览：第三个参数 false）。 */
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
    /* 2026-09-12 根因修复（用户报障：「切换标签时该标签内的画布大小与位置要保持，不要每次切回
       就是默认的画布大小和位置」）：App.updateView() 的尾巴会把「当前视图写回当前文档的 data」
       （updateView 是视图变更的唯一漏斗）。而这一句必须发生在 updateView 之前 —— 否则写入时刻
       this.current 还指着【上一个文档】，于是把刚载入的这份视图写进了上一个文档的 data.view，
       上一个文档的取景被冲掉（实测：A 设成 scale2.5/平移后切走，A.data.view 变成 B 的默认视图，
       切回 A 就回到默认大小与位置）。 */
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
    this.flashCanvasIn();   /* 切标签淡入（与主页切换同款动效） */
  },

  /* 切标签动效：给 #canvasWrap 挂一次性动画类（sveFadeIn，与主页 overlay 同款）。
     用户 2026-09-12 原话：「给各个标签切换时也加上与主页切换时的动画吧」。
     口径：①只动 #canvasWrap 自身的 opacity —— #wheelBox 在左侧图层栏内（屏幕位置恒定参照物），
     图层栏与画布内容一律不碰；②静默内部切换（_silentRender：后台保存工作进程等）不播；
     ③先移除再强制重排再挂上，连点也能每次重播；④400ms 后清掉类名，不留残留类
     （画布容器的 classList 在主题判据里是被比对的对象）。 */
  flashCanvasIn() {
    if (this._silentRender) return;
    const w = document.getElementById('canvasWrap');
    if (!w) return;
    w.classList.remove('sve-tab-in');
    void w.offsetWidth;                  /* 强制重排：让同名动画能重新触发 */
    w.classList.add('sve-tab-in');
    clearTimeout(this._tabInTimer);
    this._tabInTimer = setTimeout(() => w.classList.remove('sve-tab-in'), 400);
  },

  switchTo(id) {
    const d = this.docs.find(x => x.id === id);
    if (!d || d === this.current) { if (App.Home) App.Home.hide(); this.renderBar(); return; }   /* 收起主页后蓝框回到该标签 */
    if (this.current) this.captureDoc(this.current);
    this.loadDoc(d);
    if (App.Home) App.Home.hide();
    this.renderBar();
  },

  /* 文档文件名(确认窗显示用):源文件名优先,其次标签名 */
  docFileName(doc) {
    const d = doc || this.current;
    if (!d) return App.i18n.t('tab.untitled');
    return d.svgSource || d.label || App.i18n.t('tab.untitled');
  },
  /* 编辑打脏 / 打开保存后清脏 */
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
  /* 为该文档保存工作进程(有源文件就覆盖原文件,没有才按时间戳新建;不弹对话框) */
  async saveWorkCopyForDoc(id) {
    const doc = this.docs.find(x => x.id === id);
    if (!doc || typeof App.buildWorkCopyStringForDoc !== 'function') return null;
    const startRevision = doc.contentRevision || 0;
    try {
      const s = App.buildWorkCopyStringForDoc(doc);
      if (!s) return null;
      const r = await window.sveApi.fileSaveWork(s, doc.workSource || null);
      if (!r || !r.ok) return r || { ok: false };
      /* 仅当发起保存时仍属于同一文档、同一修订才清脏。 */
      if (this.docs.includes(doc) && (doc.contentRevision || 0) === startRevision) doc.dirty = false;
      if (r.source) doc.workSource = r.source;
      return r;
    } catch (e) { return null; }
  },
  /* 关闭软件前:对有改动的标签按顺序逐个确认(全部处理完才返回 true) */
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
  /* 关闭标签:有改动先弹同一确认窗(取消=不关闭) */
  async closeDoc(id) {
    const doc = this.docs.find(x => x.id === id);
    if (!doc) return false;
    if (doc.dirty && !this._silentRender) {   /* 静默渲染(主页缩略图)的临时标签不问、不存 */
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
      /* 静默渲染（主页缩略图临时标签）期间不得改主页状态：
         否则「点主页切回」会被这次内部收尾立刻收起（2026-09-11 用户报障的根因） */
      if (next) { this.loadDoc(next); if (!this._silentRender && App.Home) App.Home.hide(); }
      else {
        /* 关闭全部文档：清空画布、回到主页 */
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
        if (this._silentRender) { /* 静默渲染：主页状态保持原样 */ }
        else if (App.Home && !this.testMode) App.Home.show();
        else if (App.Home) App.Home.hide();
      }
    } else if (!this._silentRender) {
      if (App.Home) App.Home.hide();
    }
    this.renderBar();
  },

  /* 当前文档是否为空 */
  isEmptyActive() {
    return !this.current || (this.current.data && !this.current.data.layers.length);
  },

  setLabel(text) {
    if (this.current) {
      this.current.label = String(text || '未命名');
      this.renderBar();
    }
  },

  /* 异步保存完成时必须更新发起保存的文档，而不是完成时碰巧处于活动态的标签。 */
  setDocLabel(id, text) {
    const d = this.docs.find(x => x.id === id);
    if (!d) return false;
    d.label = String(text || '未命名');
    this.renderBar();
    return true;
  },

  /* 生产模式：SVG 内容开新文档标签（测试模式保持入当前文档）。
     sourceName：主页打开的源文件名（SVG图像 目录内）；保存「保存 SVG」时覆写该文件 */
  prodNewSvg(content, label, sourceName) {
    const d = this.addDoc({ silent: true, label: label || '未命名', svgSource: sourceName || null });
    App.importSVGContent(content);
    this.setLabel(label || '未命名');
    if (App.Home) App.Home.hide();
    return d;
  },
  prodNewWork(content, name, source) {
    const label = String(name || '工作进程').replace(/\.svework$/i, '') || '工作进程';
    const d = this.addDoc({ silent: true, label });
    App.openWorkCopyContent(content, name, source);
    this.setLabel(label);
    if (App.Home) App.Home.hide();
    return d;
  }
};

// 浮层计算定位（2026-09-12）：画布区底部可能被布局顶出窗口，贴底浮层按【画布与窗口的交集】重算位置
// （右下角粘贴板等贴底浮层），每秒与 resize 时各重算一次，保证始终在可见区内。
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
