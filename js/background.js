'use strict';
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
  $('#btnHideOthers').addEventListener('click', App.toggleHideOthers);
  $('#bgOpacityRange').addEventListener('input', App.onLayersDisplayOpacityInput);
  $('#bgOpacityBgRange').addEventListener('input', App.onBgDisplayOpacityInput);
  App.updateHideBgButton();
  App.updateHideLayersButton();
  App.updateLayersDisplaySlider();
  App.updateBgOpacitySlider();
};
App.onLayersDisplayOpacityInput = function () {
  const v0 = parseFloat($('#bgOpacityRange').value);
  const v = isNaN(v0) ? 100 : clamp(v0, 0, 100);
  App.state.layersDisplayOpacity = v / 100;
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
App.onBgDisplayOpacityInput = function () {
  const v0 = parseFloat($('#bgOpacityBgRange').value);
  const v = isNaN(v0) ? 100 : clamp(v0, 0, 100);
  App.state.bgDisplayOpacity = v / 100;
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
App.toggleLayersHidden = function () {
  if (App.state.eyeMode === 'bg') { showToast(App.i18n.t('toast.bg.eyeBusyLayers')); return; }
  if (!App.state.layers.length) { showToast(App.i18n.t('toast.bg.noLayers')); return; }
  App.state.layersHidden = !App.state.layersHidden;
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
  App.updateHideOthers();
  App.layersRoot.style.display = (App.state.layersHidden || App.state.eyeMode === 'bg') ? 'none' : '';
  if (App.state.layersHidden) App.flashG.style.display = 'none';
  else if (App.flashOverlayMap && App.flashOverlayMap.size) App.animateFlash();
};
App.hideOthersTargets = function () {
  if (App.state.edit && App.state.edit.type !== 'bg') return App.editTargets();
  if (App.state.selected.size >= 2) return App.selectedItems();
  return App.operationTargets();
};
App.toggleHideOthers = function () {
  if (App.state.eyeMode === 'bg') { showToast(App.i18n.t('toast.bg.eyeBusyLayers')); return; }
  if (!App.state.hideOthers && !App.hideOthersTargets().length) return;
  App.state.hideOthers = !App.state.hideOthers;
  if (App.state.hideOthers) {
    App.state.layersHidden = false;
    if (App.autoStaticRelease) App.autoStaticRelease();
    if (App.editStatic && (App.editStatic.active || App.editStatic.baking) && App.endEditStatic) App.endEditStatic();
  }
  App.updateHideLayersButton();
};
App.applyHideOthersDisplay = function (full) {
  if (!App.state.hideOthers) {
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
    prevH.forEach(l => {
      if (targets.has(l)) { if (l.el && l.el.style.display === 'none') l.el.style.display = ''; prevH.delete(l); }
    });
    prevT.forEach(l => {
      if (!targets.has(l)) { if (l.el) l.el.style.display = 'none'; prevH.add(l); }
    });
    App._hideOthersTargets = targets;
    return;
  }
  const hid = new Set();
  App.state.layers.forEach(l => {
    if (!l || !l.el) return;
    if (targets.has(l)) { if (l.el.style.display === 'none') l.el.style.display = ''; }
    else { l.el.style.display = 'none'; hid.add(l); }
  });
  App._hideOthersTargets = targets;
  App._hideOthersHidden = hid;
};
App.syncHideOthersSelection = function () {
  if (!App.state.hideOthers) return;
  const on = App.refreshHideOthersButton();
  App.applyHideOthersDisplay(on ? false : true);
};
App.refreshHideOthersButton = function () {
  const ob = $('#btnHideOthers');
  const has = App.hideOthersTargets().length > 0;
  if (App.state.hideOthers && !has) App.state.hideOthers = false;   
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
  App.bgG.style.display = (App.state.eyeMode === 'bg') ? '' : ((has && App.state.bg.hidden) ? 'none' : '');
};

App.applyBaseStyle = function () {
  App.wrap.classList.toggle('dark', App.state.bg.base === 'dark');
  App.updateGridStroke();
};
App.toggleBase = function () {
  App.state.bg.base = App.state.bg.base === 'light' ? 'dark' : 'light';
  App.applyBaseStyle();
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
App.GRID_MIN_CELL_PX = 8;
App.updateGridVisibility = function () {
  if (!App.gridRect) return false;
  const on = !!App.state.bg.grid;
  const cellPx = (App.GRID_STEP || 20) * ((App.state.view && App.state.view.scale) || 1);
  const autoHidden = on && cellPx < App.GRID_MIN_CELL_PX;
  const want = (on && !autoHidden) ? '' : 'none';
  if (App.gridRect.style.display !== want) App.gridRect.style.display = want;
  App._gridAutoHidden = autoHidden;    
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
    if (token !== App.bgSeq) return; 
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
    'translate(' + m.x + ' ' + m.y + ') rotate(' + m.rot + ') skewX(' + m.skew + ') scale(' + (m.sx * sfx) + ' ' + (m.sy * sfy) + ')');
  m.el.setAttribute('opacity', m.opacity);
  m.el.setAttribute('pointer-events', App.state.edit && App.state.edit.type === 'bg' && App.state.editMode === 'move' ? 'all' : 'none');
};

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
  cx.rotate(m.rot * D2R);
  cx.transform(1, 0, Math.tan(m.skew * D2R), 1, 0, 0);
  cx.scale(m.sx * (m.flipH ? -1 : 1), m.sy * (m.flipV ? -1 : 1));
  cx.drawImage(m.imgEl, -m.w / 2, -m.h / 2, m.w, m.h);
  const px = clamp(Math.round(clientX - r.left), 0, w - 1);
  const py = clamp(Math.round(clientY - r.top), 0, h - 1);
  const d = cx.getImageData(px, py, 1, 1).data;
  if (d[3] === 0) return null;
  return rgbToHex(d[0], d[1], d[2]);
};
