'use strict';
/* 背景：灰白/灰黑底色、网格、背景图片与独立编辑 */
App.initBackground = function () {
  App.updateBaseButtons();
  App.applyBaseStyle();
  App.updateGridStroke();
  App.updateGridVisibility();
  $('#btnBase').addEventListener('click', App.toggleBase);
  $('#btnGrid').addEventListener('click', App.toggleGrid);
  $('#btnZoomWheel').addEventListener('click', App.toggleWheelZoom);
  App.updateZoomWheelButton();
  $('#btnBgImage').addEventListener('click', App.onBgButton);
  $('#btnRemoveBg').addEventListener('click', () => {
    App.removeBackground();
    App.exitEdit();
    showToast(App.i18n.t('toast.bg.removed'));
  });
  $('#btnHideBg').addEventListener('click', App.toggleBgHidden);
  $('#btnHideLayers').addEventListener('click', App.toggleLayersHidden);
  /* 「隐藏其他图层」：全局开关（与另外两个按钮同级，随时可用）。
     与「隐藏图层」互斥；选中项变化时立刻跟随（见 syncHideOthersSelection）。 */
  $('#btnHideOthers').addEventListener('click', App.toggleHideOthers);
  $('#bgOpacityRange').addEventListener('input', App.onLayersDisplayOpacityInput);
  $('#bgOpacityBgRange').addEventListener('input', App.onBgDisplayOpacityInput);
  App.updateHideBgButton();
  App.updateHideLayersButton();
  App.updateLayersDisplaySlider();
  App.updateBgOpacitySlider();
};
/* 所有图案的显示透明度：竖向滑条快捷调节 0~100。
   仅影响画布显示（layersRoot 的 CSS opacity）——不改任何图层的 opacity 数据、
   不进历史、导出 SVG 时会被剔除，编辑/导出中图案原本的透明度都不变 */
App.onLayersDisplayOpacityInput = function () {
  const v0 = parseFloat($('#bgOpacityRange').value);
  const v = isNaN(v0) ? 100 : clamp(v0, 0, 100);
  App.state.layersDisplayOpacity = v / 100;
  /* 取色器激活期间用户拖动：退出取色器时保留新值（不被激活前快照覆盖） */
  if (App.state.eyeMode) App.eyeOpacityUserChanged = true;
  App.applyLayersDisplayOpacity();
};
App.applyLayersDisplayOpacity = function () {
  if (!App.layersRoot) return;
  const o = clamp(App.state.layersDisplayOpacity, 0, 1);
  App.layersRoot.style.opacity = o >= 1 ? '' : String(o);
};
App.updateLayersDisplaySlider = function () {
  const s = $('#bgOpacityRange');
  if (!s) return;
  const has = App.state.layers.length > 0;
  s.disabled = !has;
  if (!has) { s.value = 100; App.state.layersDisplayOpacity = 1; }
  else if (document.activeElement !== s) s.value = Math.round((App.state.layersDisplayOpacity ?? 1) * 100);
  App.applyLayersDisplayOpacity();
};
/* 背景图片显示透明度：竖向滑条快捷调节（与图案显示透明度同一套机制，
   仅影响背景显示，不改背景图片的 opacity 数据） */
App.onBgDisplayOpacityInput = function () {
  const v0 = parseFloat($('#bgOpacityBgRange').value);
  const v = isNaN(v0) ? 100 : clamp(v0, 0, 100);
  App.state.bgDisplayOpacity = v / 100;
  /* 取色器激活期间用户拖动：退出取色器时保留新值（不被激活前快照覆盖） */
  if (App.state.eyeMode) App.eyeOpacityUserChanged = true;
  App.applyBgDisplayOpacity();
};
App.applyBgDisplayOpacity = function () {
  if (!App.bgG) return;
  const o = clamp(App.state.bgDisplayOpacity ?? 1, 0, 1);
  App.bgG.style.opacity = o >= 1 ? '' : String(o);
};
App.updateBgOpacitySlider = function () {
  const s = $('#bgOpacityBgRange');
  if (!s) return;
  const has = !!App.state.bg.image;
  s.disabled = !has;
  if (!has) { s.value = 100; App.state.bgDisplayOpacity = 1; }
  else if (document.activeElement !== s) s.value = Math.round((App.state.bgDisplayOpacity ?? 1) * 100);
  App.applyBgDisplayOpacity();
};
/* 快捷键调显示透明度：每次 = 量程的 1/10 —— 0↔100 正好 10 次，两端钳住不溢出。
   滑条被禁用（无图层 / 无背景图）时不响应，与直接拖滑条一致；
   与拖滑条同一套 state 与同一套 apply（只影响显示，不改图层数据、不进历史）。 */
App.nudgeLayersDisplayOpacity = function (dir) {
  const s = $('#bgOpacityRange');
  if (!s || s.disabled) return;
  const cur = clamp(Math.round((App.state.layersDisplayOpacity ?? 1) * 100), 0, 100);
  const v = clamp(cur + (dir > 0 ? 10 : -10), 0, 100);
  if (v === cur) return;
  App.state.layersDisplayOpacity = v / 100;
  s.value = v;
  if (App.state.eyeMode) App.eyeOpacityUserChanged = true;
  App.applyLayersDisplayOpacity();
};
App.nudgeBgDisplayOpacity = function (dir) {
  const s = $('#bgOpacityBgRange');
  if (!s || s.disabled) return;
  const cur = clamp(Math.round((App.state.bgDisplayOpacity ?? 1) * 100), 0, 100);
  const v = clamp(cur + (dir > 0 ? 10 : -10), 0, 100);
  if (v === cur) return;
  App.state.bgDisplayOpacity = v / 100;
  s.value = v;
  if (App.state.eyeMode) App.eyeOpacityUserChanged = true;
  App.applyBgDisplayOpacity();
};
/* 隐藏所有图案图层（画布右上角，两种模式都显示） */
App.toggleLayersHidden = function () {
  /* 背景取色器激活时禁用：取色器临时隐藏图案与按钮状态互相覆盖会错乱（退出取色器后
     按钮说隐藏但图层显示 / 按钮取消隐藏但图层仍隐藏） */
  if (App.state.eyeMode === 'bg') { showToast(App.i18n.t('toast.bg.eyeBusyLayers')); return; }
  if (!App.state.layers.length) { showToast(App.i18n.t('toast.bg.noLayers')); return; }
  App.state.layersHidden = !App.state.layersHidden;
  /* 与「隐藏其他图层」互斥：整体隐藏时关掉「只显示当前编辑图层」 */
  if (App.state.layersHidden) App.state.hideOthers = false;
  App.updateHideLayersButton();
};
App.updateHideLayersButton = function () {
  const b = $('#btnHideLayers');
  if (!b) return;
  const has = App.state.layers.length > 0;
  b.classList.toggle('active', has && App.state.layersHidden);
  b.classList.toggle('disabled', !has);
  if (!has) b.textContent = App.i18n.t('canvas.hideLayers');
  else b.textContent = App.i18n.t(App.state.layersHidden ? 'canvas.showLayers' : 'canvas.hideLayers');
  /* ---- 「隐藏其他图层」：全局开关，按钮态与显隐都由 updateHideOthers 统一处理 ---- */
  App.updateHideOthers();
  /* 背景取色器激活时：图层保持隐藏（取色器临时隐藏优先，任何刷新都不能把它显示出来） */
  App.layersRoot.style.display = (App.state.layersHidden || App.state.eyeMode === 'bg') ? 'none' : '';
  /* flashG 的显示由闪动动画驱动：这里只响应“隐藏图层”开关——
     隐藏时强制隐藏；取消隐藏时若有覆盖层则重播一次动画，
     避免覆盖层以固定颜色卡住（无条件 display='' 会让 Y 复制等
     操作后闪动残留在画布上） */
  if (App.state.layersHidden) App.flashG.style.display = 'none';
  else if (App.flashOverlayMap && App.flashOverlayMap.size) App.animateFlash();
};
/* ================= 「隐藏其他图层」：只显示当前选中的图层（全局） =================
   目标集合口径 = 与剪切/删除/换色**完全一致**：
     编辑中 → 编辑目标（editTargets）；否则 → 操作目标（多选集合 / 白框所在图层）。
   这样「按钮说显示这个、操作动那个」不会出现。
   三条硬要求（都是踩过的）：
     ① 选中变化必须**同一帧**跟上 —— 只写差集（新露出的显示 / 刚落选的隐藏），
        千层文档滚轮换层也只动 2 个元素，不掉帧；
     ② 与 autoStatic 视口位图互斥：位图用 display:none 接管整棵矢量树，
        本模式也用 display 表达显隐 ⇒ 开启瞬间先释放位图，开启期间视口位图不参与
        （render.js 的 autoStaticEligible / beginEditStatic 各有一道闸）；
     ③ 没有可选目标时自动关掉并置灰（否则会退化成「整张画布全黑」的死状态）。 */
App.hideOthersTargets = function () {
  if (App.state.edit && App.state.edit.type !== 'bg') return App.editTargets();
  /* 多选（≥2）整体当成一组：全部显示。
     不依赖 selectedByTab —— 用户口径是「多选就是一组」，标志位只是 UI 细节，
     不能让它决定显隐（否则某些路径建出来的多选会只显示白框那一层）。 */
  if (App.state.selected.size >= 2) return App.selectedItems();
  return App.operationTargets();
};
App.toggleHideOthers = function () {
  if (App.state.eyeMode === 'bg') { showToast(App.i18n.t('toast.bg.eyeBusyLayers')); return; }
  if (!App.state.hideOthers && !App.hideOthersTargets().length) return;
  App.state.hideOthers = !App.state.hideOthers;
  if (App.state.hideOthers) {
    /* 与「隐藏图层」互斥 */
    App.state.layersHidden = false;
    /* 先撤视口位图（它把顶层设成 display:none，会和本模式的 display 打架）；
       编辑中的静态化同理（它会把非目标层烘进背景位图 ⇒ 隐藏看起来失效） */
    if (App.autoStaticRelease) App.autoStaticRelease();
    if (App.editStatic && (App.editStatic.active || App.editStatic.baking) && App.endEditStatic) App.endEditStatic();
  }
  App.updateHideLayersButton();
};
/* full = true：按当前 layers 全量重算（开关切换 / 结构变化 / 面板重建）；
   full = false：只按「新旧目标集合的差」增量改 display（选中变化走这条）。 */
App.applyHideOthersDisplay = function (full) {
  if (!App.state.hideOthers) {
    /* 关：只还原本函数设过 none 的图层，绝不碰别人的 display */
    const hid = App._hideOthersHidden;
    if (hid && hid.size) {
      hid.forEach(l => { if (l && l.el && l.el.style.display === 'none') l.el.style.display = ''; });
    }
    App._hideOthersHidden = new Set();
    App._hideOthersTargets = new Set();
    if (App.autoStaticMaybe) App.autoStaticMaybe();
    return;
  }
  const targets = new Set(App.hideOthersTargets());
  const prevT = App._hideOthersTargets;
  const prevH = App._hideOthersHidden;
  if (!full && prevT && prevH) {
    /* 增量：之前在隐藏集里、现在成了目标 → 显示；之前在目标集里、现在不是 → 隐藏 */
    prevH.forEach(l => {
      if (targets.has(l)) { if (l.el && l.el.style.display === 'none') l.el.style.display = ''; prevH.delete(l); }
    });
    prevT.forEach(l => {
      if (!targets.has(l)) { if (l.el) l.el.style.display = 'none'; prevH.add(l); }
    });
    App._hideOthersTargets = targets;
    return;
  }
  /* 全量：先还原再按目标隐藏（同一任务内完成，不会闪） */
  const hid = new Set();
  App.state.layers.forEach(l => {
    if (!l || !l.el) return;
    if (targets.has(l)) { if (l.el.style.display === 'none') l.el.style.display = ''; }
    else { l.el.style.display = 'none'; hid.add(l); }
  });
  App._hideOthersTargets = targets;
  App._hideOthersHidden = hid;
};
/* 选中 / 白框变化时调用（syncPanelSelectionClasses 的每帧路径）：关闭态零开销 */
App.syncHideOthersSelection = function () {
  if (!App.state.hideOthers) return;
  const on = App.refreshHideOthersButton();
  /* 目标消失导致自动关闭 → 需要一次全量还原；否则只走差集 */
  App.applyHideOthersDisplay(on ? false : true);
};
/* 只刷按钮态（不做显隐计算），返回「当前是否仍在开启」 */
App.refreshHideOthersButton = function () {
  const ob = $('#btnHideOthers');
  const has = App.hideOthersTargets().length > 0;
  if (App.state.hideOthers && !has) App.state.hideOthers = false;   // 无目标：自动关
  const on = !!App.state.hideOthers;
  if (!ob) return on;
  ob.classList.toggle('active', on);
  ob.classList.toggle('disabled', !has);
  ob.disabled = !has;
  ob.textContent = App.i18n.t(on ? 'canvas.showOthers' : 'canvas.hideOthers');
  return on;
};
App.updateHideOthers = function () {
  App.refreshHideOthersButton();
  App.applyHideOthersDisplay(true);
};
App.toggleBgHidden = function () {
  /* 背景取色器激活时禁用：取色器临时显示背景与按钮状态互相覆盖会错乱 */
  if (App.state.eyeMode === 'bg') { showToast(App.i18n.t('toast.bg.eyeBusyBg')); return; }
  if (!App.state.bg.image) { showToast(App.i18n.t('toast.bg.noBg')); return; }
  App.state.bg.hidden = !App.state.bg.hidden;
  App.updateHideBgButton();
};
App.updateHideBgButton = function () {
  const b = $('#btnHideBg');
  if (!b) return;
  const has = !!App.state.bg.image;
  b.classList.toggle('active', has && App.state.bg.hidden);
  b.classList.toggle('disabled', !has);
  if (!has) b.textContent = App.i18n.t('canvas.hideBg');
  else b.textContent = App.i18n.t(App.state.bg.hidden ? 'canvas.showBg' : 'canvas.hideBg');
  /* 背景取色器激活时：背景强制显示（取色需要），任何刷新都不能把它隐藏 */
  App.bgG.style.display = (App.state.eyeMode === 'bg') ? '' : ((has && App.state.bg.hidden) ? 'none' : '');
};

App.applyBaseStyle = function () {
  App.wrap.classList.toggle('dark', App.state.bg.base === 'dark');
  App.updateGridStroke();
};
App.toggleBase = function () {
  App.state.bg.base = App.state.bg.base === 'light' ? 'dark' : 'light';
  App.applyBaseStyle();
  /* 蒙版指示图案随背景主题切换（浅色背景用 light，深色用 dark） */
  App.ensureMaskIndDef();
  const mark = l => {
    if (l.isMask) { l.thumbDirty = true; l.thumbCache = null; }
    if (l.kind === 'merged' && l.children) l.children.forEach(mark);
  };
  App.state.layers.forEach(mark);
  App.refreshLayerThumbs();
  App.updateBaseButtons();
};
App.toggleGrid = function () {
  App.state.bg.grid = !App.state.bg.grid;
  App.updateGridVisibility();
  App.updateBaseButtons();
};
/* 滚轮缩放画布开关（顶栏，网格开关右侧） */
App.toggleWheelZoom = function () {
  App.state.wheelZoomEnabled = !App.state.wheelZoomEnabled;
  App.updateZoomWheelButton();
};
App.updateZoomWheelButton = function () {
  const b = $('#btnZoomWheel');
  if (!b) return;
  b.textContent = App.i18n.t(App.state.wheelZoomEnabled ? 'toolbar.zoomOn' : 'toolbar.zoomOff');
  b.classList.toggle('active', !App.state.wheelZoomEnabled);
};
/* 网格显隐：两条独立条件取交集，**绝不改写用户开关** App.state.bg.grid ——
   ① 用户开关（画布右上角/工具栏「网格」）关了就永远不显示；
   ② 缩得太小时自动隐藏：格子屏幕像素 < App.GRID_MIN_CELL_PX 时网格会糊成一片，
      此时只做「显示层」的隐藏，开关状态原样保留，放大回去自动重新显示。
   （2026-10-26 用户口径：缩到很小的时候网格糊成一块，要求自动隐藏但不影响开关设置） */
App.GRID_MIN_CELL_PX = 8;
App.updateGridVisibility = function () {
  if (!App.gridRect) return false;
  const on = !!App.state.bg.grid;
  const cellPx = (App.GRID_STEP || 20) * ((App.state.view && App.state.view.scale) || 1);
  const autoHidden = on && cellPx < App.GRID_MIN_CELL_PX;
  const want = (on && !autoHidden) ? '' : 'none';
  if (App.gridRect.style.display !== want) App.gridRect.style.display = want;
  App._gridAutoHidden = autoHidden;   /* 只读诊断量，判据用它区分「自动隐藏」和「开关关闭」 */
  return on && !autoHidden;
};

App.onBgButton = function () {
  if (App.state.edit && App.state.edit.type === 'bg') { App.exitEdit(); return; }
  App.enterBgEdit();
};
App.enterBgEdit = function () {
  if (!App.state.bg.image) {
    showToast(App.i18n.t('toast.bg.dragFirst'));
    return;
  }
  App.enterEdit({ type: 'bg' });
};

App.setBackgroundImage = function (dataUrl) {
  App.history.markDiscrete();
  const token = ++App.bgSeq;
  loadImage(dataUrl).then(img => {
    if (token !== App.bgSeq) return; // 已被撤销/恢复覆盖
    if (App.state.bg.image && App.state.bg.image.el) App.state.bg.image.el.remove();
    const v = App.state.view;
    const cw = App.wrap.clientWidth / v.scale, ch = App.wrap.clientHeight / v.scale;
    const fit = Math.min(1, (cw * 0.8) / img.width, (ch * 0.8) / img.height);
    const model = {
      kind: 'bg',
      x: v.x + cw / 2, y: v.y + ch / 2,
      w: img.width, h: img.height,
      sx: fit, sy: fit, rot: 0, skew: 0, opacity: 1,
      flipH: false, flipV: false,
      dataUrl, imgEl: img, el: null
    };
    model.el = svgEl('image', {
      href: dataUrl,
      x: -img.width / 2, y: -img.height / 2,
      width: img.width, height: img.height,
      preserveAspectRatio: 'none', 'pointer-events': 'none'
    });
    App.bgG.appendChild(model.el);
    App.applyBgTransform(model);
    App.state.bg.image = model;
    App.state.bg.hidden = false;
    App.updateBaseButtons();
    App.updateHideBgButton();
    App.updateLayersDisplaySlider();
    App.updateBgOpacitySlider();
    showToast(App.i18n.t('toast.bg.set'));
  }).catch(() => showToast(App.i18n.t('toast.bg.readFail')));
};

App.applyBgTransform = function (m) {
  if (!m.el) return;
  const sfx = m.flipH ? -1 : 1, sfy = m.flipV ? -1 : 1;
  m.el.setAttribute('transform',
    'translate(' + m.x + ' ' + m.y + ') rotate(' + m.rot + ') scale(' + (m.sx * sfx) + ' ' + (m.sy * sfy) + ') skewX(' + m.skew + ')');
  m.el.setAttribute('opacity', m.opacity);
  m.el.setAttribute('pointer-events', App.state.edit && App.state.edit.type === 'bg' && App.state.editMode === 'move' ? 'all' : 'none');
};

/* 编辑背景图片（移动模式）鼠标命中：点落在背景图片的四角四边形内 = 命中。
   背景图片不在 App.state.layers 里，通用的像素命中（hitLayerPaintedSync）扫不到它，
   所以单独给一条几何命中 —— 与大小/旋转/倾斜模式的「点是否在目标框内」同一套判定。
   非「编辑背景」状态一律返回 null，否则拖画布会误把背景移走。 */
App.hitBgImageAt = function (clientX, clientY) {
  const e = App.state.edit;
  if (!e || e.type !== 'bg') return null;
  const m = App.state.bg.image;
  if (!m || App.state.bg.hidden) return null;
  const b = App.getItemDocBBox(m);
  if (!b || !b.corners || b.corners.length < 4) return null;
  const pd = App.screenToDoc(clientX, clientY);
  return App.pointInQuad(pd, b.corners) ? m : null;
};

App.removeBackground = function () {
  const m = App.state.bg.image;
  if (!m) return;
  App.history.markDiscrete();
  App.bgSeq++;
  if (m.el) m.el.remove();
  App.state.bg.image = null;
  App.state.bg.hidden = false;
  App.updateBaseButtons();
  App.updateHideBgButton();
  App.updateLayersDisplaySlider();
  App.updateBgOpacitySlider();
};

/* 取色：把背景图片按当前变换绘制到离屏画布并采样 */
App.sampleBackgroundColor = function (clientX, clientY) {
  const m = App.state.bg.image;
  if (!m || !m.imgEl) return null;
  const r = App.svg.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  if (!App.offCanvas) App.offCanvas = document.createElement('canvas');
  const c = App.offCanvas;
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
  const cx = c.getContext('2d');
  const v = App.state.view;
  cx.setTransform(1, 0, 0, 1, 0, 0);
  cx.clearRect(0, 0, w, h);
  cx.setTransform(v.scale, 0, 0, v.scale, -v.x * v.scale, -v.y * v.scale);
  cx.translate(m.x, m.y);
  cx.scale(m.sx * (m.flipH ? -1 : 1), m.sy * (m.flipV ? -1 : 1));
  cx.rotate(m.rot * D2R);
  cx.transform(1, 0, Math.tan(m.skew * D2R), 1, 0, 0);
  cx.drawImage(m.imgEl, -m.w / 2, -m.h / 2, m.w, m.h);
  const px = clamp(Math.round(clientX - r.left), 0, w - 1);
  const py = clamp(Math.round(clientY - r.top), 0, h - 1);
  const d = cx.getImageData(px, py, 1, 1).data;
  /* 透明 = 图片外的画布背景板：返回 null（取色器据此不做任何反应） */
  if (d[3] === 0) return null;
  return rgbToHex(d[0], d[1], d[2]);
};
