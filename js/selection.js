'use strict';
App.setSelection = function (ids, opts) {
  opts = opts || {};
  App.state.selected = new Set(ids);
  App.syncPanelSelectionClasses();
  App.drawOutlines();
  App.startFlash();
  App.updateSelToolbar();
  if (opts.scrollPanel && ids.length === 1) {
    const l = App.findLayer(ids[0]);
    if (l) App.scrollItemToTop(l);
  }
};

App.toggleLayerSelection = function (layer) {
  const s = new Set(App.state.selected);
  if (s.has(layer.id)) s.delete(layer.id);
  else s.add(layer.id);
  App.state.selectedByTab = s.size >= 1;
  App.setSelection(Array.from(s));
};

App.hitLayer = function (e) {
  let n = e.target;
  while (n && n !== App.svg) {
    if (n.getAttribute && n.getAttribute('data-layer')) {
      return App.findLayer(parseInt(n.getAttribute('data-layer'), 10));
    }
    n = n.parentNode;
  }
  return null;
};

App.actOnWhiteBoxLayer = function () {
  if (!App.state.layers.length) return;
  if (App.state.plusAnchorActive) return;
  App.state.selBarDismissed = true;
  const ids = App.state.layers.slice().reverse().map(l => l.id);
  let i;
  if (App.lastWheelIdx !== undefined) i = clamp(App.lastWheelIdx, 0, ids.length - 1);
  else if (App.state.selected.size === 1) i = ids.indexOf(Array.from(App.state.selected)[0]);
  else i = 0;
  if (i < 0) i = 0;
  App.lastWheelIdx = i;
  const layer = App.findLayer(ids[i]);
  if (!layer) return;
  const wasSelected = App.state.selected.has(layer.id);
  const legacySingle = App.state.selectedByTab && App.state.selected.size === 1;
  App.state.sweepDir = 0;
  App.state.tabAutoSel = { id: layer.id, prevSelected: wasSelected };
  if (App.state.selected.size === 1 && !wasSelected && !App.state.selectedByTab) {
    App.state.selectedByTab = false;
    App.setSelection([]);
  }
  if (legacySingle && wasSelected) {
    App.state.sweepMode = 'remove';
    App.state.selectedByTab = false;
    App.setSelection([]);
  } else if (wasSelected && App.state.selected.size === 1) {
    App.state.sweepMode = 'add';
    App.state.selectedByTab = true;
    App.setSelection(Array.from(App.state.selected));
  } else if (wasSelected) {
    App.state.sweepMode = 'remove';
    App.toggleLayerSelection(layer);
  } else {
    App.state.sweepMode = 'add';
    App.toggleLayerSelection(layer);
  }
};

App.rollbackTabAutoSel = function () {
  const t = App.state.tabAutoSel;
  if (!t) return null;
  App.state.tabAutoSel = null;
  const l = App.findLayer(t.id);
  if (!l) return t.id;
  if (t.prevSelected && !App.state.selected.has(l.id)) {
    App.state.selected.add(l.id);
  } else if (!t.prevSelected && App.state.selected.has(l.id)) {
    App.state.selected.delete(l.id);
  } else {
    return t.id;
  }
  App.state.selectedByTab = App.state.selected.size >= 1;
  App.setSelection(Array.from(App.state.selected));
  return t.id;
};

App.canvasAlphaAt = function (c, layer, clientX, clientY) {
  const doc = App.screenToDoc(clientX, clientY);
  const inv = App.transformChainMat ? App.transformChainMat(layer).inverse() : null;
  let lx;
  if (inv) {
    const q = new DOMPoint(doc.x, doc.y).matrixTransform(inv);
    lx = { x: q.x, y: q.y };
  } else {
    lx = new DOMPoint(clientX, clientY).matrixTransform(layer.el.getScreenCTM().inverse());
  }
  const px = Math.round(lx.x + layer.w / 2), py = Math.round(lx.y + layer.h / 2);
  if (px < 0 || py < 0 || px >= c.width || py >= c.height) return 0;
  return c.getContext('2d', { willReadFrequently: true }).getImageData(px, py, 1, 1).data[3];
};
App.hitLayerPaintedSync = function (clientX, clientY) {
  for (let i = App.state.layers.length - 1; i >= 0; i--) {
    if (App.layerVisibleAtSync(App.state.layers[i], clientX, clientY)) return App.state.layers[i];
  }
  return null;
};
App.layerVisibleAtSync = function (layer, clientX, clientY) {
  if (layer.kind === 'merged') {
    const bb = App.getItemDocBBox(layer);
    const pd = App.screenToDoc(clientX, clientY);
    if (bb.corners && bb.corners.length >= 4 && !App.pointInQuad(pd, bb.corners)) return false;
    for (let j = layer.children.length - 1; j >= 0; j--) {
      if (App.layerVisibleAtSync(layer.children[j], clientX, clientY)) return true;
    }
    return false;
  }
  const b = App.getItemDocBBox(layer);
  if (!b.corners || b.corners.length < 4) return true;
  const pd = App.screenToDoc(clientX, clientY);
  if (!App.pointInQuad(pd, b.corners)) return false;
  if (layer.kind === 'symbol' && !layer.isMask) {
    const c = App.symbolColorCanvasSync(layer.dataUri, layer.color || '#ffffff', Math.max(1, Math.round(layer.w)), Math.max(1, Math.round(layer.h)));
    if (!c) return true;
    return App.canvasAlphaAt(c, layer, clientX, clientY) >= 32;
  }
  return true;
};

App.onCanvasPointerDown = function (e) {
  if (App.state.spaceDown) return;
  let rolledId = e && e._rolledId;
  if (App.state.tabDown && rolledId === undefined) rolledId = App.rollbackTabAutoSel();
  const layer = (e.clientX === 0 && e.clientY === 0 && e.target)
    ? App.hitLayer(e)
    : App.hitLayerPaintedSync(e.clientX, e.clientY);
  if (layer) {
    const top = App.topOf(layer);
    if (App.state.tabDown) {
      App.state.tabGestureUsed = true;
      App.toggleLayerSelection(top);
      const ids = App.state.layers.slice().reverse().map(l => l.id);
      const bi = ids.indexOf(top.id);
      if (bi >= 0) { App.lastWheelIdx = bi; App.syncPanelSelectionClasses(); }
      App.scrollItemToTop(top);
      App.requestFlashRefresh(false);
    } else if (App.state.selected.size > 1 || (App.state.selectedByTab && App.state.selected.size >= 1)) {
      App.state.selBarDismissed = false;
      const ids = App.state.layers.slice().reverse().map(l => l.id);
      const i = ids.indexOf(top.id);
      if (i >= 0) App.lastWheelIdx = i;
      App.syncPanelSelectionClasses();
      App.updateSelToolbar();
      App.requestFlashRefresh();
      App.scrollItemToTop(top);
    } else {
      App.state.selectedByTab = false;
      App.lastWheelIdx = undefined;
      App.state.selBarDismissed = false;
      App.setSelection([top.id], { scrollPanel: true });
    }
  } else {
    if (App.state.replacing || App.state.tabDown) return;
    if (App.state.selected.size > 1 || (App.state.selectedByTab && App.state.selected.size >= 1)) {
      App.state.selBarDismissed = true;
      App.updateSelToolbar();
    } else {
      App.state.selectedByTab = false;
      App.setSelection([]);
    }
  }
};

App.boxSelect = null;
App.startBoxSelect = function (e, mode) {
  if (App.state.tabDown) App.rollbackTabAutoSel();
  const p = App.screenToDoc(e.clientX, e.clientY);
  App.boxSelect = { mode, x0: p.x, y0: p.y, x1: p.x, y1: p.y, startCX: e.clientX, startCY: e.clientY };
  if (!App.boxSelG) {
    App.boxSelG = svgEl('g', { 'pointer-events': 'none' });
    App.overlayG.appendChild(App.boxSelG);
  }
  App.drawBoxSelect();
  try { App.svg.setPointerCapture(e.pointerId); } catch (err) { }
  if (e.preventDefault) e.preventDefault();
};
App.moveBoxSelect = function (e) {
  if (!App.boxSelect) return;
  const p = App.screenToDoc(e.clientX, e.clientY);
  App.boxSelect.x1 = p.x; App.boxSelect.y1 = p.y;
  App.drawBoxSelect();
};
App.drawBoxSelect = function () {
  const b = App.boxSelect;
  if (!b) return;
  const x = Math.min(b.x0, b.x1), y = Math.min(b.y0, b.y1);
  const w = Math.abs(b.x1 - b.x0), h = Math.abs(b.y1 - b.y0);
  const sc = App.state.view.scale || 1;
  let g = b.el;
  if (!g) {
    g = svgEl('g');
    const rect = svgEl('rect', { fill: 'rgba(78,161,255,.15)', stroke: '#4ea1ff', 'stroke-width': 1.5 / sc, class: 'sve-boxsel' });
    const mark = svgEl('text', {
      class: 'sve-boxsel-mark', 'text-anchor': 'middle', 'dominant-baseline': 'central',
      'font-size': 16 / sc, 'font-weight': 'bold', fill: '#ffffff', stroke: '#1d6fd1',
      'paint-order': 'stroke', 'stroke-width': 3 / sc
    });
    mark.textContent = b.mode === 'add' ? '+' : '−';
    g.appendChild(rect);
    g.appendChild(mark);
    App.boxSelG.appendChild(g);
    b.el = g; b.rect = rect; b.mark = mark;
  }
  b.rect.setAttribute('x', x); b.rect.setAttribute('y', y);
  b.rect.setAttribute('width', w); b.rect.setAttribute('height', h);
  b.rect.setAttribute('stroke-width', 1.5 / sc);
  b.mark.setAttribute('x', x + w);
  b.mark.setAttribute('y', y);
  b.mark.setAttribute('font-size', 16 / sc);
  b.mark.setAttribute('stroke-width', 3 / sc);
};
App.cancelBoxSelect = function () {
  const b = App.boxSelect;
  App.boxSelect = null;
  if (b && b.el) b.el.remove();
};
App.endBoxSelect = function (e) {
  const b = App.boxSelect;
  if (!b) return;
  App.boxSelect = null;
  const x = Math.min(b.x0, b.x1), y = Math.min(b.y0, b.y1);
  const w = Math.abs(b.x1 - b.x0), h = Math.abs(b.y1 - b.y0);
  const moved = Math.hypot(e.clientX - b.startCX, e.clientY - b.startCY) > 4;
  if (b.el) b.el.remove();
  if (!moved) {
    const t = document.elementFromPoint(e.clientX, e.clientY);
    const fake = Object.assign({}, e, { target: t || App.svg });
    App.onCanvasPointerDown(fake);
    return;
  }
  if (w < 1 && h < 1) return;
  const hits = App.layersInBox(x, y, w, h);
  const s = new Set(App.state.selected);
  hits.forEach(id => {
    if (b.mode === 'add') { if (!s.has(id)) s.add(id); }
    else { if (s.has(id)) s.delete(id); }
  });
  App.state.selectedByTab = s.size >= 1;
  App.state.selBarDismissed = true;
  App.setSelection(Array.from(s));
  if (s.size) {
    let target = null;
    for (let i = App.state.layers.length - 1; i >= 0; i--) {
      if (s.has(App.state.layers[i].id)) { target = App.state.layers[i]; break; }
    }
    if (target) {
      App.scrollItemToTop(target);
      App.syncPanelSelectionClasses();
      if (App.requestFlashRefresh) App.requestFlashRefresh(false);
    }
  }
};

App.pointInPoly = function (p, poly) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const cr = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cr !== 0) {
      const s = cr > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
  }
  return true;
};
App.segIntersect = function (p1, p2, p3, p4) {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (d === 0) return false;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
};
App.layerPolyHitBox = function (layer, x, y, w, h) {
  const bb = App.getItemDocBBox(layer);
  const poly = (bb.corners && bb.corners.length === 4) ? bb.corners
    : [{ x: bb.x, y: bb.y }, { x: bb.x + bb.w, y: bb.y }, { x: bb.x + bb.w, y: bb.y + bb.h }, { x: bb.x, y: bb.y + bb.h }];
  const rect = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  if (poly.some(p => p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h)) return true;
  if (rect.some(p => App.pointInPoly(p, poly))) return true;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      if (App.segIntersect(poly[i], poly[(i + 1) % 4], rect[j], rect[(j + 1) % 4])) return true;
    }
  }
  return false;
};
App.layersInBox = function (x, y, w, h) {
  const out = [];
  App.state.layers.forEach(top => {
    if (top.kind === 'merged') {
      const leaves = [];
      const walk = l => { if (l.kind === 'merged') l.children.forEach(walk); else leaves.push(l); };
      walk(top);
      if (leaves.some(l => App.layerPolyHitBox(l, x, y, w, h))) out.push(top.id);
    } else if (App.layerPolyHitBox(top, x, y, w, h)) {
      out.push(top.id);
    }
  });
  return out;
};

App.setSelToolbarVisible = function (show) {
  const bar = $('#selToolbar');
  if (!bar) return;
  if (show) {
    if (!bar.classList.contains('hidden')) return;
    bar.classList.remove('hidden', 'sve-bar-out');
    bar.classList.add('sve-bar-in');
    setTimeout(() => bar.classList.remove('sve-bar-in'), 260);
  } else {
    if (bar.classList.contains('hidden')) return;
    bar.classList.add('sve-bar-out');
    setTimeout(() => { bar.classList.add('hidden'); bar.classList.remove('sve-bar-out'); }, 180);
  }
};
App.updateSelToolbar = function () {
  const bar = $('#selToolbar');
  const inEdit = !!App.state.edit;
  const locateBtn = $('#btnLocateLayer');
  if (locateBtn) locateBtn.disabled = !App.whiteBoxLayer();
  if (App.syncColorPanelToTargets) App.syncColorPanelToTargets();
  if (!App.state.selected.size || inEdit || App.state.plusAnchorActive) { App.setSelToolbarVisible(false); return; }
  const items = App.operationTargets();
  const single = items.length === 1;
  const canReplace = single && items[0].kind !== 'merged';
  $('#btnReplace').disabled = !canReplace;
  $('#btnMerge').disabled = items.length < 2;
  $('#btnSplit').disabled = !App.splitTarget();
  const allMask = items.every(l => !!l.isMask);
  const anyMask = items.some(l => !!l.isMask);
  $('#btnToMask').disabled = allMask;
  $('#btnToLayer').disabled = !anyMask;
  const show = !App.state.selBarDismissed;
  App.setSelToolbarVisible(!!show);
};

App.setSelectedMask = function (flag) {
  const items = App.operationTargets();
  if (!items.length) return;
  App.ensureMaskIndDef();
  App.history.markDiscrete();
  const leaves = [];
  const applyModel = l => {
    l.isMask = !!flag;
    l.thumbDirty = true;
    l.thumbCache = null;
    if (l.kind === 'merged' && l.children) l.children.forEach(applyModel);
    else leaves.push(l);
  };
  items.forEach(applyModel);
  const token = App._maskRenderToken = (App._maskRenderToken || 0) + 1;
  App._maskRenderBusy = true;
  const preserveAutoStatic = leaves.length > 400 && !!(App.autoStatic && App.autoStatic.active);

  const finish = () => {
    if (token !== App._maskRenderToken) return;
    App._maskRenderBusy = false;
    items.forEach(l => { if (App.dropEditStaticItem) App.dropEditStaticItem(l); });
    if (App.contentChanged) App.contentChanged({ preserveAutoStatic });
    items.forEach(l => { if (l.kind === 'merged' && App.markProxyDirty) App.markProxyDirty(l); });
    App.refreshPanel();
    App.updateSelToolbar();
    App.refreshLayerThumbs();
    try { App.log('info', '蒙版切换', { flag: !!flag, layers: leaves.length }); } catch (e) { /* ignore */ }
    showToast(flag ? App.i18n.t('toast.sel.maskOn') : App.i18n.t('toast.sel.maskOff'));
  };

  if (leaves.length <= 400) {
    leaves.forEach(l => App.rebuildLayerContent(l));
    finish();
    return;
  }

  if (App.stopFlash) App.stopFlash();
  let i = 0;
  const step = () => {
    if (token !== App._maskRenderToken) return;
    const t0 = performance.now();
    do {
      const l = leaves[i++];
      if (l && l.isMask === !!flag) {
        try { App.rebuildLayerContent(l); }
        catch (e) { console.warn('[mask] 图层显示重建失败', l.id, String(e && e.message || e).slice(0, 160)); }
      }
    } while (i < leaves.length && performance.now() - t0 < 6);
    if (i < leaves.length) { setTimeout(step, 0); return; }
    finish();
  };
  setTimeout(step, 0);
};

App.flipSelected = function (axis) {
  const items = App.operationTargets();
  if (!items.length) return;
  App.history.markDiscrete();
  items.forEach(l => {
    const c = l.kind === 'merged' && App.mergedContentCenter ? App.mergedContentCenter(l) : null;
    if (axis === 'h') l.flipH = !l.flipH;
    else l.flipV = !l.flipV;
    if (c) App.anchorToKeepCenter(l, c.x, c.y);
    l.thumbDirty = true;
    l.thumbCache = null;
    App.applyItemTransform(l);
    App.markThumbDirty(l);
  });
  App.refreshLayerThumbs();
  App.drawOutlines();
  items.forEach(l => { if (App.dropEditStaticItem) App.dropEditStaticItem(l); });
  if (App.contentChanged) App.contentChanged();
  try { App.log('info', '翻转', { axis, layers: items.length }); } catch (e) { /* ignore */ }
  showToast(axis === 'h' ? App.i18n.t('toast.sel.flipH') : App.i18n.t('toast.sel.flipV'));
};

App.whiteBoxLayer = function () {
  if (App.state.plusAnchorActive) return null;
  if (!App.state.layers.length) return null;
  const ids = App.state.layers.slice().reverse().map(l => l.id);
  let i;
  if (App.lastWheelIdx !== undefined) i = clamp(App.lastWheelIdx, 0, ids.length - 1);
  else if (App.state.selected.size === 1) i = ids.indexOf(Array.from(App.state.selected)[0]);
  else i = 0;
  if (i < 0 || i >= ids.length) i = 0;
  return App.findLayer(ids[i]);
};
App.operationTargets = function () {
  if (App.state.selectedByTab && App.state.selected.size) return App.selectedItems();
  const box = App.whiteBoxLayer();
  return box ? [box] : App.selectedItems();
};
App.whiteBoxOutsideSet = function () {
  if (!(App.state.selectedByTab && App.state.selected.size)) return false;
  const box = App.whiteBoxLayer();
  return !box || !App.state.selected.has(box.id);
};
App.activeTargetItems = function () {
  return App.operationTargets();
};

App.cutSelection = function () {
  const hadSel = App.state.selected.size > 0;
  let items;
  if (App.whiteBoxOutsideSet()) {
    const box = App.whiteBoxLayer();
    items = box ? [box] : [];
  } else {
    items = App.activeTargetItems();
  }
  if (!items.length) { showToast(App.i18n.t('toast.sel.noCut')); return; }
  App.history.markDiscrete();
  try { App.log('info', '剪切', { layers: items.length }); } catch (e) { /* ignore */ }
  App.state.clipboard = items.map(l => App.serializeLayer(l, true));
  items.forEach(l => App.removeTopLayer(l));
  if (hadSel) App.setSelection([]);
  else App.syncPanelSelectionClasses();
  App.refreshClipboardPanel();
  showToast(App.i18n.tf('toast.sel.cut', { n: App.state.clipboard.length }));
};

App.copySelection = function () {
  const items = App.activeTargetItems();
  if (!items.length) { showToast(App.i18n.t('toast.sel.noCopy')); return; }
  App.history.markDiscrete();
  App.state.clipboard = items.map(l => App.serializeLayer(l, true));
  App.refreshClipboardPanel();
  showToast(App.i18n.tf('toast.sel.copied', { n: items.length }));
};

App.pasteClipboard = function () {
  if (!App.state.clipboard.length) { return; }
  App.history.markDiscrete();
  try { App.log('info', '粘贴', { layers: App.state.clipboard.length }); } catch (e) { /* ignore */ }
  const items = App.state.clipboard;
  const newLayers = items.map(slim => App.deserializeLayer(slim));
  const hideBatch = newLayers.length > 50 && App.layersRoot.style.display !== 'none';
  if (hideBatch) App.layersRoot.style.display = 'none';
  const sel = App.selectedItems();
  if (App.state.plusAnchorActive && App.state.layers.length) {
    const insertAt = App.state.layers.length;
    const topEl = App.state.layers[insertAt - 1] ? App.state.layers[insertAt - 1].el : null;
    newLayers.forEach((l, k) => {
      if (!l.el) App.buildLayerElement(l);
      const ref = k === 0 ? topEl : newLayers[k - 1].el;
      if (ref && ref.parentNode) ref.before(l.el); else App.layersRoot.appendChild(l.el);
      App.state.layers.splice(insertAt, 0, l);
      App.registerChildren(l);
      l.thumbDirty = true;
    });
    App.refreshPanel();
    App.refreshCount();
    if (hideBatch && !App.state.layersHidden && App.state.eyeMode !== 'bg') App.layersRoot.style.display = '';
    App.state.selectedByTab = false;
    App.state.selBarDismissed = false;
    App.setSelection([]);
    try { App.log('info', '粘贴到「+」栏下方', { layers: newLayers.length, insertAt: insertAt, firstId: newLayers[0] && newLayers[0].id }); } catch (e) { /* ignore */ }
    if (App.contentChanged) App.contentChanged();

    return;
  }
  let anchor = App.whiteBoxLayer();
  try { App.log('info', '粘贴（非停靠）', { layers: newLayers.length, anchorId: anchor && anchor.id }); } catch (e) { /* ignore */ }
  if (!anchor && sel.length === 1 && App.state.layers.includes(sel[0])) anchor = sel[0];
  if (anchor && App.state.layers.includes(anchor)) {
    const idx = App.state.layers.indexOf(anchor);
    newLayers.forEach((l, k) => {
      if (!l.el) App.buildLayerElement(l);
      const ref = k === 0 ? anchor.el : newLayers[k - 1].el;
      ref.before(l.el);
      App.state.layers.splice(idx + k, 0, l);
      App.registerChildren(l);
      l.thumbDirty = true;
    });
  } else {
    newLayers.forEach(l => App.addLayer(l));
  }
  App.refreshPanel();
  App.refreshCount();
  if (hideBatch && !App.state.layersHidden && App.state.eyeMode !== 'bg') App.layersRoot.style.display = '';
  App.state.selectedByTab = false;
  App.state.selBarDismissed = false;
  App.setSelection([]);
  if (newLayers.length) {
    const topPaste = newLayers[newLayers.length - 1];
    if (App.scrollItemToTop) App.scrollItemToTop(topPaste, true);
  }
  if (App.contentChanged) App.contentChanged();

};

App.deleteSelection = function () {
  const hadSel = App.state.selected.size > 0;
  let items;
  if (App.whiteBoxOutsideSet()) {
    const box = App.whiteBoxLayer();
    items = box ? [box] : [];
  } else {
    items = App.activeTargetItems();
  }
  if (!items.length) return;
  App.history.markDiscrete();
  items.forEach(l => App.removeTopLayer(l));
  if (hadSel) App.setSelection([]);
  else App.syncPanelSelectionClasses();
  showToast(App.i18n.tf('toast.sel.deleted', { n: items.length }));
};

App.deleteAllLayers = function () {
  if (!App.state.layers.length) { showToast(App.i18n.t('toast.sel.barEmpty')); return; }
  if (App.invalidateEditStatic) App.invalidateEditStatic();
  App.history.markDiscrete();
  App.state.batching = true;
  try {
    App.state.layers.slice().forEach(l => App.removeTopLayer(l));
  } finally {
    App.state.batching = false;
  }
  App.state.layersHidden = false;
  if (App.updateHideLayersButton) App.updateHideLayersButton();
  App.refreshPanel();
  App.refreshCount();
  App.setSelection([]);
  if (App.contentChanged) App.contentChanged({ preserveAutoStatic: false });
  showToast(App.i18n.t('toast.sel.deletedAll'));
};

App.mergeSelected = function () {
  const items = App.operationTargets();
  if (items.length < 2) { showToast(App.i18n.t('toast.sel.needTwo')); return; }
  App.history.markDiscrete();
  const merged = App.mergeLayers(items.map(l => l.id));
  if (merged) {
    App.setSelection([]);
    showToast(App.i18n.t('toast.sel.merged'));
  }
};

App.splitSelected = function () {
  const m = App.splitTarget();
  if (!m) { showToast(App.i18n.t('toast.sel.pickMerged')); return; }
  App.history.markDiscrete();
  App.splitMerged(m);
  App.setSelection([]);
  showToast(App.i18n.t('toast.sel.split'));
};
App.splitTarget = function () {
  const items = App.operationTargets();
  if (items.length === 1 && items[0].kind === 'merged') return items[0];
  const box = App.whiteBoxLayer();
  return (box && box.kind === 'merged') ? box : null;
};

App.initSelectionToolbar = function () {
  $('#btnEditPos').addEventListener('click', () => {
    const items = App.operationTargets();
    if (!items.length) return;
    if (items.length > 1) App.enterEdit({ type: 'multi', ids: items.map(l => l.id) });
    else App.enterEdit({ type: 'layer', id: items[0].id });
  });
  $('#btnEditColor').addEventListener('click', () => {
    if (!App.operationTargets().length) return;
    App.switchTab('color');
  });
  $('#btnReplace').addEventListener('click', () => App.setReplacing(true));
  $('#btnToMask').addEventListener('click', () => App.setSelectedMask(true));
  $('#btnToLayer').addEventListener('click', () => App.setSelectedMask(false));
  $('#btnFlipH').addEventListener('click', () => App.flipSelected('h'));
  $('#btnFlipV').addEventListener('click', () => App.flipSelected('v'));
  $('#btnMerge').addEventListener('click', App.mergeSelected);
  $('#btnSplit').addEventListener('click', App.splitSelected);
  $('#btnCut').addEventListener('click', App.cutSelection);
  $('#btnCopy').addEventListener('click', App.copySelection);
  $('#btnDelete').addEventListener('click', App.deleteSelection);
  $('#btnSelectAll').addEventListener('click', App.selectAllLayers);
  $('#btnClearSel').addEventListener('click', () => {
    App.state.selectedByTab = false;
    App.setSelection([]);
  });
  $('#btnDeleteAll').addEventListener('click', App.deleteAllLayers);
  $('#btnLocateLayer').addEventListener('click', App.locateWhiteBoxLayer);
};

App.locateWhiteBoxLayer = function () {
  const layer = App.whiteBoxLayer();
  if (!layer) return;
  const b = App.getItemDocBBox(layer);
  if (!b || !isFinite(b.x) || !isFinite(b.y) || !isFinite(b.w) || !isFinite(b.h)) return;
  const r = App.wrap.getBoundingClientRect();
  const v = App.state.view;
  const sc = v.scale || 1;
  v.x = (b.x + b.w / 2) - r.width / (2 * sc);
  v.y = (b.y + b.h / 2) - r.height / (2 * sc);
  App.updateView();
};

App.selectAllLayers = function () {
  if (!App.state.layers.length) { showToast(App.i18n.t('toast.sel.noHighlight')); return; }
  App.state.selectedByTab = true;
  App.setSelection(App.state.layers.map(l => l.id));
  showToast(App.i18n.tf('toast.sel.highlightedAll', { n: App.state.layers.length }));
};
