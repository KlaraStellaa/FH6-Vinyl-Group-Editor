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
/* 隐藏所有图案图层（画布右上角，两种模式都显示） */
App.toggleLayersHidden = function () {
  /* 背景取色器激活时禁用：取色器临时隐藏图案与按钮状态互相覆盖会错乱（退出取色器后
     按钮说隐藏但图层显示 / 按钮取消隐藏但图层仍隐藏） */
  if (App.state.eyeMode === 'bg') { showToast(App.i18n.t('toast.bg.eyeBusyLayers')); return; }
  if (!App.state.layers.length) { showToast(App.i18n.t('toast.bg.noLayers')); return; }
  App.state.layersHidden = !App.state.layersHidden;
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
  /* 背景取色器激活时：图层保持隐藏（取色器临时隐藏优先，任何刷新都不能把它显示出来） */
  App.layersRoot.style.display = (App.state.layersHidden || App.state.eyeMode === 'bg') ? 'none' : '';
  /* flashG 的显示由闪动动画驱动：这里只响应“隐藏图层”开关——
     隐藏时强制隐藏；取消隐藏时若有覆盖层则重播一次动画，
     避免覆盖层以固定颜色卡住（旧代码无条件 display='' 会导致 Y 复制等
     操作后闪动残留在画布上） */
  if (App.state.layersHidden) App.flashG.style.display = 'none';
  else if (App.flashOverlayMap && App.flashOverlayMap.size) App.animateFlash();
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
App.updateGridVisibility = function () {
  App.gridRect.style.display = App.state.bg.grid ? '' : 'none';
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
