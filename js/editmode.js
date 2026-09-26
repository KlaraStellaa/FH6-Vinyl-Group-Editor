'use strict';
App.initEditMode = function () {
  $('#btnFinish').addEventListener('click', () => App.exitEdit(false));
  $('#btnPropMode').addEventListener('click', () => {
    App.state.sizeMode = App.state.sizeMode === 'free' ? 'prop' : 'free';
    App.updateEditBar();
  });
  $('#btnAxisHint').addEventListener('click', () => {
    App.state.axisHint = !App.state.axisHint;
    App.updateEditBar();
    App.drawOutlines();
  });
  $('#btnShowHandles').addEventListener('click', () => {
    App.state.showHandles = !App.state.showHandles;
    App.updateEditBar();
    App.drawOutlines();
  });
  $('#btnPlaceAnchor').addEventListener('click', () => App.toggleAnchor());
  $$('#editBar .edit-modes button[data-mode]').forEach(b => {
    b.addEventListener('click', () => App.setEditMode(b.getAttribute('data-mode')));
  });
  $('#editValueInput').addEventListener('change', App.editValueCommit);
  $('#editValueInput').addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.target.blur(); }
  });
  $('#editValueRange').addEventListener('input', () => {
    if (!['skew', 'opacity'].includes(App.state.editMode)) return;
    if (App.cancelColorPreview) App.cancelColorPreview();
    $('#editValueInput').value = $('#editValueRange').value;
    App.editValueCommit();
  });
};

App.leafColorEntries = function (l) {
  if (l.kind !== 'merged') return [{ c: l, color: l.color }];
  return (l.children || []).reduce((acc, ch) => acc.concat(App.leafColorEntries(ch)), []);
};

App.withTransformBatch = function (fn) {
  App._batchTransformDepth = (App._batchTransformDepth || 0) + 1;
  try { return fn(); }
  finally {
    App._batchTransformDepth = Math.max(0, (App._batchTransformDepth || 1) - 1);
    if (!App._batchTransformDepth) {
      if (App.scheduleFrameUpdate) App.scheduleFrameUpdate('edit');
      else if (App.requestFlashRefresh) App.requestFlashRefresh(false);
    }
  }
};

App.editHist = {
  stack: [],
  redoStack: [],
  gesture: false,
  snapshot: function () {
    return App.editTargets().map(it => ({
      id: it.id,
      x: it.x, y: it.y, sx: it.sx, sy: it.sy, rot: it.rot, skew: it.skew, opacity: it.opacity,
      flipH: !!it.flipH, flipV: !!it.flipV,
      colors: App.leafColorEntries(it)
    }));
  },
  restore: function (snap) {
    if (snap && snap.despawn && snap.despawn.length) {
      snap.despawn.forEach(id => {
        const l = App.findLayer(id);
        if (l && App.state.layers.includes(l)) App.removeTopLayer(l);
      });
    }
    snap.forEach(s => {
      const l = App.findLayer(s.id);
      if (!l) return;
      l.x = s.x; l.y = s.y; l.sx = s.sx; l.sy = s.sy;
      l.rot = s.rot; l.skew = s.skew; l.opacity = s.opacity;
      l.flipH = !!s.flipH; l.flipV = !!s.flipV;
      App.applyItemTransform(l);
      App.markThumbDirty(l);
      (s.colors || []).forEach(p => App.setLayerColor(p.c, p.color));
    });
    App.groupRebase();
    App.drawOutlines();
    App.updateEditValue();
    App.refreshLayerThumbs();
  },
  checkpoint: function () {
    if (this.gesture) return null;
    const s = this.snapshot();
    this.stack.push(s);
    if (this.stack.length > 80) this.stack.shift();
    this.redoStack.length = 0;
    this.gesture = true;
    return s;
  },
  endGesture: function () { this.gesture = false; },
  scheduleEnd: function () {
    if (this.endTimer) clearTimeout(this.endTimer);
    this.endTimer = setTimeout(() => { this.endTimer = null; this.endGesture(); }, 600);
  },
  undo: function () {
    if (!this.stack.length) return false;
    if (App.cancelColorPreview) App.cancelColorPreview();
    this.redoStack.push(this.snapshot());
    this.gesture = false;
    this.restore(this.stack.pop());
    return true;
  },
  redo: function () {
    if (!this.redoStack.length) return false;
    if (App.cancelColorPreview) App.cancelColorPreview();
    this.stack.push(this.snapshot());
    this.gesture = false;
    this.restore(this.redoStack.pop());
    return true;
  },
  reset: function () {
    this.stack.length = 0;
    this.redoStack.length = 0;
    this.gesture = false;
    if (this.endTimer) { clearTimeout(this.endTimer); this.endTimer = null; }
  }
};

App.enterEdit = function (spec) {
  if (App.cancelColorPreview) App.cancelColorPreview();
  App.clearAnchor();
  if (App.state.eyeMode) App.setEyedropper(null);
  try { App.log('info', '进入编辑', { type: spec && spec.type, id: spec && spec.id, ids: spec && spec.ids ? spec.ids.length : undefined }); } catch (e) { /* ignore */ }
  if (!App.editTargets2(spec).length && spec.type !== 'bg') return;
  App.state.edit = spec;
  App.state.editMode = 'move';
  App.state.sizeMode = 'free';
  App.state.editFlipStep = 0;
  App.editHist.reset();
  App.editHistStart = App.history.undoStack.length;
  App.editSession = {
    lastColor: App.state.lastColor,
    snapshot: App.editTargets().map(it => ({
      it,
      x: it.x, y: it.y, sx: it.sx, sy: it.sy, rot: it.rot, skew: it.skew, opacity: it.opacity,
      flipH: !!it.flipH, flipV: !!it.flipV,
      color: it.color,
      colors: App.leafColorEntries(it)
    })),
  };
  {
    const t = App.editTargets();
    if (t.length >= 2) {
      App.editSession.grp = { rot: 0, skew: 0, sx: 1, sy: 1 };
      const e = groupExtent(t);
      App.editSession.grpC = { x: e.cx, y: e.cy };
      App.editSession.grpM0 = t.map(it => layerDocMatrix(it));
    }
  }
  App.history.markContinuous();
  $('#leftPanel').classList.add('hidden');
  const eb = $('#editBar');
  eb.classList.remove('hidden');
  eb.classList.remove('sve-editbar-out');
  $('#selToolbar').classList.add('hidden');
  const isBg = spec.type === 'bg';
  if (isBg) {
    App.switchTab('lib');
    $('#panelTabs').classList.add('hidden');
  } else {
    $('#panelTabs').classList.remove('hidden');
    App.switchTab('color');
  }
  $('#btnRemoveBg').classList.toggle('hidden', !isBg);
  App.layersRoot.style.pointerEvents = 'auto';
  App.updateEditBar();
  if (App.updateHideLayersButton) App.updateHideLayersButton();
  App.drawOutlines();
  if (App.refreshImpBitmaps) App.refreshImpBitmaps();
  if (App.autoStaticRelease) App.autoStaticRelease();
  if (App.beginEditStatic) App.beginEditStatic();
};
App.editTargets2 = function (spec) {
  const old = App.state.edit;
  App.state.edit = spec;
  const items = App.editTargets();
  App.state.edit = old;
  return items;
};

App.exitEdit = function (cancel) {
  if (!App.state.edit) return;
  App.clearAnchor();
  try { App.log('info', '退出编辑', { cancel: !!cancel, type: App.state.edit.type }); } catch (e) { /* ignore */ }
  App.editHistStart = undefined;
  if (App.cancelColorPreview) App.cancelColorPreview();
  const es = App.editSession;
  App.editHist.reset();
  if (cancel && es) {
    App.state.batching = true;
    try {
      es.snapshot.forEach(s => {
        s.it.x = s.x; s.it.y = s.y;
        s.it.sx = s.sx; s.it.sy = s.sy;
        s.it.rot = s.rot; s.it.skew = s.skew; s.it.opacity = s.opacity;
        s.it.flipH = !!s.flipH; s.it.flipV = !!s.flipV;
        App.applyItemTransform(s.it);
        App.markThumbDirty(s.it);
        if (s.colors) {
          s.colors.forEach(p => App.setLayerColor(p.c, p.color));
        } else if (s.it.kind !== 'bg' && s.color !== undefined) {
          App.setLayerColor(s.it, s.color);
        }
      });
      App.state.lastColor = es.lastColor;
    } finally {
      App.state.batching = false;
    }
    App.refreshPanel();
    App.refreshCount();
    App.refreshLayerThumbs();
    if (App.contentChanged) App.contentChanged();
    App.history.cancelTop();
    showToast(App.i18n.t('toast.edit.cancelled'));
  } else {
    App.history.endGesture();
  }
  App.editSession = null;
  App.state.edit = null;
  if (App.updateHideLayersButton) App.updateHideLayersButton();
  if (App.updateEditStaticViewport) App.updateEditStaticViewport();
  App.state.keys.clear();
  App.drag = null;
  if (!(App.state.selectedByTab && App.state.selected.size > 1)) {
    App.state.selected = new Set();
    App.state.selectedByTab = false;
    App.state.selBarDismissed = false;
  }
  App.syncPanelSelectionClasses();
  $('#leftPanel').classList.remove('hidden');
  const eb = $('#editBar');
  eb.classList.add('sve-editbar-out');
  setTimeout(() => { eb.classList.add('hidden'); eb.classList.remove('sve-editbar-out'); }, 200);
  $('#panelTabs').classList.remove('hidden');
  App.layersRoot.style.pointerEvents = 'auto';
  App.handleG.innerHTML = '';
  App.handleEls = [];
  if (App.state.bg.image) App.applyBgTransform(App.state.bg.image);
  if (App.alignWheelScroll) App.alignWheelScroll();
  App.refreshLayerThumbs();
  App.updateSelToolbar();
  App.drawOutlines();
  if (App.requestFlashRefresh) App.requestFlashRefresh(false);
  App.flashSeq++;
  App.flashTimers.forEach(t => { cancelAnimationFrame(t); clearTimeout(t); });
  App.flashTimers = [];
  App.compFlashToken++;
  if (App.compRebuildTimer) { clearTimeout(App.compRebuildTimer); App.compRebuildTimer = null; }
  App.flashColor = null;
  App.flashG.style.display = 'none';
  App.switchTab('lib');
};

App.setEditMode = function (mode) {
  if (App.cancelColorPreview) App.cancelColorPreview();
  if (App.state.anchorPlacing && mode !== 'size' && mode !== 'rotate' && mode !== 'skew') App.cancelAnchorPlacing();
  App.state.editMode = mode;
  App.updateEditBar();
  App.drawOutlines();
};

App.updateEditBar = function () {
  $$('#editBar .edit-modes button[data-mode]').forEach(b =>
    b.classList.toggle('active', b.getAttribute('data-mode') === App.state.editMode));
  const mode = App.state.editMode;
  const isSize = mode === 'size';
  const isRotSkewOp = mode === 'rotate' || mode === 'skew' || mode === 'opacity';
  $('#btnPropMode').classList.toggle('hidden', !isSize);
  $('#btnPropMode').textContent = App.i18n.t(App.state.sizeMode === 'prop' ? 'edit.propRatio' : 'edit.propFree');
  $('#btnAxisHint').classList.toggle('hidden', !isSize);
  $('#btnAxisHint').textContent = App.i18n.t(App.state.axisHint ? 'edit.axisOn' : 'edit.axisOff');
  $('#btnShowHandles').classList.toggle('hidden', !isSize);
  $('#btnShowHandles').textContent = App.i18n.t(App.state.showHandles ? 'edit.handlesOn' : 'edit.handlesOff');
  const anchorShown = isSize || mode === 'rotate' || mode === 'skew';
  const anchorBtn = $('#btnPlaceAnchor');
  if (anchorBtn) {
    anchorBtn.classList.toggle('hidden', !anchorShown);
    anchorBtn.disabled = !(anchorShown && App.anchorEligible());
    const anchorTxt = App.i18n.t(App.state.anchor ? 'edit.anchorCancel' : 'edit.anchorPlace');
    anchorBtn.textContent = anchorTxt;
    anchorBtn.setAttribute('textContent', anchorTxt);
    anchorBtn.setAttribute('data-i18n', App.state.anchor ? 'edit.anchorCancel' : 'edit.anchorPlace');
    anchorBtn.classList.toggle('active', !!App.state.anchorPlacing);
  }
  const rng = $('#editValueRange');
  $('#editValueBox').classList.toggle('hidden', !isRotSkewOp);
  rng.classList.toggle('hidden', mode !== 'opacity');
  if (isRotSkewOp) {
    $('#editValueLabel').textContent = App.i18n.t(mode === 'rotate' ? 'edit.label.rotate' : mode === 'skew' ? 'edit.label.skew' : 'edit.label.opacity');
    $('#editValueUnit').textContent = mode === 'opacity' ? '%' : '°';
    if (mode === 'opacity') { rng.min = 0; rng.max = 100; rng.step = 1; }
    else { rng.min = -180; rng.max = 180; rng.step = 0.5; }
  }
  App.updateEditValue();
  const any2 = !$('#btnShowHandles').classList.contains('hidden') ||
    !$('#btnAxisHint').classList.contains('hidden') ||
    !$('#btnPropMode').classList.contains('hidden') ||
    !(anchorBtn && anchorBtn.classList.contains('hidden')) ||
    !$('#editValueBox').classList.contains('hidden') ||
    !$('#btnRemoveBg').classList.contains('hidden');
  $('#editRow2').classList.toggle('hidden', !any2);
  if (isSize) {
    App.layersRoot.style.pointerEvents = 'none';
  } else if (mode === 'move') {
    App.layersRoot.style.pointerEvents = 'auto';
  } else {
    App.layersRoot.style.pointerEvents = 'none';
  }
};

App.updateEditValue = function () {
  const items = App.editTargets();
  if (!items.length) return;
  const it = items[0];
  const inp = $('#editValueInput');
  if (App.state.editMode === 'rotate') {
    const d = normalizeDeg(it.rot);
    inp.value = fmtNum(d, 1);
    $('#editValueRange').value = d;
  } else if (App.state.editMode === 'skew') {
    const d = normalizeDeg(it.skew);
    inp.value = fmtNum(d, 1);
    $('#editValueRange').value = d;
  } else if (App.state.editMode === 'opacity') {
    inp.value = fmtNum(clamp(it.opacity, 0, 1) * 100, 0);
    $('#editValueRange').value = Math.round(clamp(it.opacity, 0, 1) * 100);
  }
};

App.editValueCommit = function () {
  if (App.cancelColorPreview) App.cancelColorPreview();
  const v = parseFloat($('#editValueInput').value);
  if (isNaN(v)) { App.updateEditValue(); return; }
  const items = App.editTargets();
  if (App.state.editMode === 'rotate') {
    if (items.length > 1) {
      App.groupRotateItems(items, v - items[0].rot);
    } else items.forEach(it => {
      const af = App.anchorFixedLocal(it);
      if (af) {
        const p0 = App.itemLocalToDoc(it, af.x, af.y);
        it.rot = v;
        App.placeItemAtDocPoint(it, af.x, af.y, p0.x, p0.y);
      } else if (it.kind === 'merged') {
        const c = App.mergedContentCenter(it); it.rot = v; App.anchorToKeepCenter(it, c.x, c.y);
      } else it.rot = v;
      App.applyItemTransform(it);
    });
  } else if (App.state.editMode === 'skew') {
    if (items.length > 1) {
      App.groupSkewItems(items, v - items[0].skew);
    } else items.forEach(it => {
      const af = App.anchorFixedLocal(it);
      if (af) {
        const p0 = App.itemLocalToDoc(it, af.x, af.y);
        it.skew = App.clampSkew(v);
        App.placeItemAtDocPoint(it, af.x, af.y, p0.x, p0.y);
      } else if (it.kind === 'merged') {
        const c = App.mergedContentCenter(it); it.skew = App.clampSkew(v); App.anchorToKeepCenter(it, c.x, c.y);
      } else it.skew = App.clampSkew(v);
      App.applyItemTransform(it);
    });
  } else if (App.state.editMode === 'opacity') items.forEach(it => { it.opacity = clamp(v / 100, 0, 1); App.applyItemTransform(it); App.markThumbDirty(it); });
  App.drawOutlines();
  App.updateEditValue();
  App.refreshLayerThumbs();
};

App.applyEditMove = function (dx, dy) {
  App.withTransformBatch(() => App.editTargets().forEach(it => {
    it.x += dx; it.y += dy;
    App.applyItemTransform(it);
  }));
  if (App.scheduleFrameUpdate) App.scheduleFrameUpdate('edit');
  else App.drawOutlines();
};
App.applyScaleWithFlip = function (it, sx, sy) {
  if (sx < 0) { it.flipH = true; sx = -sx; }
  else if (sx > 0) { it.flipH = false; }
  if (sy < 0) { it.flipV = true; sy = -sy; }
  else if (sy > 0) { it.flipV = false; }
  it.sx = clamp(sx, 1e-6, 1e6);
  it.sy = clamp(sy, 1e-6, 1e6);
};

App.scaleItemKeepCenter = function (it, fx, fy) {
  const af = App.anchorFixedLocal(it);
  if (af) {
    const p0 = App.itemLocalToDoc(it, af.x, af.y);
    App.applyScaleWithFlip(it, (it.flipH ? -1 : 1) * (it.sx || 1) * fx, (it.flipV ? -1 : 1) * (it.sy || 1) * fy);
    App.placeItemAtDocPoint(it, af.x, af.y, p0.x, p0.y);
    App.applyItemTransform(it);
    App.markThumbDirty(it);
    return;
  }
  if (it.kind === 'merged') {
    const b = App.getItemDocBBox(it);
    const cx = b.cx, cy = b.cy;
    const ox = it.x, oy = it.y;
    it.x = cx + (ox - cx) * fx;
    it.y = cy + (oy - cy) * fy;
  }
  App.applyScaleWithFlip(it, (it.flipH ? -1 : 1) * (it.sx || 1) * fx, (it.flipV ? -1 : 1) * (it.sy || 1) * fy);
  App.applyItemTransform(it);
  App.markThumbDirty(it);
};
function groupExtent(items) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  items.forEach(it => {
    const b = App.getItemDocBBox(it);
    minx = Math.min(minx, b.x); miny = Math.min(miny, b.y);
    maxx = Math.max(maxx, b.x + b.w); maxy = Math.max(maxy, b.y + b.h);
  });
  return { cx: (minx + maxx) / 2, cy: (miny + maxy) / 2, w: maxx - minx, h: maxy - miny };
}
function groupCenter(items) {
  const e = groupExtent(items);
  return { x: e.cx, y: e.cy };
}
function layerDocMatrix(it) {
  const sxf = (it.flipH ? -1 : 1) * (it.sx || 1);
  const syf = (it.flipV ? -1 : 1) * (it.sy || 1);
  const t = Math.tan((it.skew || 0) * D2R);
  const a0 = Math.cos((it.rot || 0) * D2R), b0 = Math.sin((it.rot || 0) * D2R);
  return {
    a: a0 * sxf, b: b0 * sxf,
    c: a0 * sxf * t - b0 * syf, d: b0 * sxf * t + a0 * syf,
    e: it.x, f: it.y
  };
}
function groupMatrix(g, C) {
  return App.FZA.matFromString('translate(' + C.x + ' ' + C.y + ') rotate(' + (g.rot || 0) +
    ') scale(' + (g.sx || 1) + ' ' + (g.sy || 1) + ') skewX(' + (g.skew || 0) + ') translate(' + (-C.x) + ' ' + (-C.y) + ')');
}
App.groupDecompose = function () {
  const es = App.editSession;
  if (!es || !es.grp || !es.grpM0) return false;
  const G = groupMatrix(es.grp, es.grpC);
  const items = App.editTargets();
  App.withTransformBatch(() => es.grpM0.forEach((M0, i) => {
    const it = items[i];
    if (!it) return;
    const M = App.FZA.mul(G, M0);
    const p = App.FZA.decomposeToModel(M);
    const sy = p.sy;
    it.x = M.e; it.y = M.f;
    it.rot = normalizeDeg(p.rot);
    it.skew = App.clampSkew(p.skew);
    it.sx = Math.abs(p.sx) || 1;
    it.flipH = false;
    it.flipV = !!(sy < 0);
    it.sy = Math.abs(sy) || 1;
    App.applyItemTransform(it);
    App.markThumbDirty(it);
  }));
  App.drawOutlines();
  return true;
};
App.groupTransformApply = function (upd) {
  const es = App.editSession;
  if (!es || !es.grp) return false;
  const items = App.editTargets();
  if (items.length < 2) return false;
  upd(es.grp);
  return App.groupDecompose();
};
App.groupRebase = function () {
  const es = App.editSession;
  if (!es || !es.grp) return;
  const items = App.editTargets();
  if (items.length < 2) { es.grp = null; return; }
  es.grp.rot = 0; es.grp.skew = 0; es.grp.sx = 1; es.grp.sy = 1;
  es.grpM0 = items.map(it => layerDocMatrix(it));
  const e = groupExtent(items);
  es.grpC = { x: e.cx, y: e.cy };
};
App.applyGroupScaleAt = function (items, cx, cy, fx, fy) {
  items.forEach(it => {
    if (it.kind === 'merged') {
      const p = App.mergedContentCenter(it);
      const tx = cx + (p.x - cx) * fx;
      const ty = cy + (p.y - cy) * fy;
      App.applyScaleWithFlip(it, (it.flipH ? -1 : 1) * (it.sx || 1) * fx, (it.flipV ? -1 : 1) * (it.sy || 1) * fy);
      App.anchorToKeepCenter(it, tx, ty);
    } else {
      it.x = cx + (it.x - cx) * fx;
      it.y = cy + (it.y - cy) * fy;
      App.applyScaleWithFlip(it, (it.flipH ? -1 : 1) * (it.sx || 1) * fx, (it.flipV ? -1 : 1) * (it.sy || 1) * fy);
    }
    App.applyItemTransform(it);
    App.markThumbDirty(it);
  });
};
App.applyEditScale = function (fx, fy) {
  const items = App.editTargets();
  if (items.length >= 2) {
    if (App.groupTransformApply(g => { g.sx *= fx; g.sy *= fy; })) {
      App.refreshLayerThumbs();
      return;
    }
  }
  App.withTransformBatch(() => items.forEach(it => App.scaleItemKeepCenter(it, fx, fy)));
  App.drawOutlines();
  App.refreshLayerThumbs();
};
App.localContentSize = function (it) {
  if (it && it.kind === 'merged') {
    const loc = it._localBB;
    if (loc && loc.pts && loc.pts.length >= 3) {
      const xs = loc.pts.map(p => p[0]), ys = loc.pts.map(p => p[1]);
      return { w: Math.max(1, Math.max.apply(null, xs) - Math.min.apply(null, xs)),
               h: Math.max(1, Math.max.apply(null, ys) - Math.min.apply(null, ys)) };
    }
    const lb = App.computeLocalBBox(it);
    if (lb && lb.w > 0 && lb.h > 0) return { w: lb.w, h: lb.h };
    return { w: 128, h: 128 };
  }
  return { w: Math.max(1, Number(it && it.w) || 128), h: Math.max(1, Number(it && it.h) || 128) };
};
App.scaleItemKeepCenterAbs = function (it, ddx, ddy) {
  const ssx = (it.flipH ? -1 : 1) * (it.sx || 1);
  const ssy = (it.flipV ? -1 : 1) * (it.sy || 1);
  const _lcs = App.localContentSize(it);
  const k = 128 / Math.max(1, _lcs.w);
  const nddx = ddx * k, nddy = ddy * k;
  if (it.kind === 'merged') {
    const nsx = ssx + nddx, nsy = ssy + nddy;
    const af = App.anchorFixedLocal(it);
    if (af) {
      const p0 = App.itemLocalToDoc(it, af.x, af.y);
      App.applyScaleWithFlip(it, nsx, nsy);
      App.placeItemAtDocPoint(it, af.x, af.y, p0.x, p0.y);
    } else {
      const { lcx, lcy } = App.mergedLocalCenter(it);
      const c = App.mergedContentCenter(it);
      const M = App.FZA.layerMatrix({ flipH: nsx < 0, flipV: nsy < 0, sx: Math.abs(nsx), sy: Math.abs(nsy), rot: it.rot, skew: it.skew });
      it.x = c.x - (M.a * lcx + M.c * lcy);
      it.y = c.y - (M.b * lcx + M.d * lcy);
      App.applyScaleWithFlip(it, nsx, nsy);
    }
  } else {
    const nsx = ssx + nddx, nsy = ssy + nddy;
    const af = App.anchorFixedLocal(it);
    if (af) {
      const p0 = App.itemLocalToDoc(it, af.x, af.y);
      App.applyScaleWithFlip(it, nsx, nsy);
      App.placeItemAtDocPoint(it, af.x, af.y, p0.x, p0.y);
    } else {
      App.applyScaleWithFlip(it, nsx, nsy);
    }
  }
  App.applyItemTransform(it);
  App.markThumbDirty(it);
};
App.applyGroupScaleAbs = function (ddx, ddy) {
  const items = App.editTargets();
  if (items.length < 2) return false;
  if (!App.editSession || !App.editSession.grp) return false;
  const e = groupExtent(items);
  const fx = ddx ? 1 + (128 * ddx) / Math.max(1e-6, e.w) : 1;
  const fy = ddy ? 1 + (128 * ddy) / Math.max(1e-6, e.h) : 1;
  if (fx === 1 && fy === 1) return true;
  App.groupTransformApply(g => { g.sx *= fx; g.sy *= fy; });
  return true;
};
App.propScalePair = function (ddx, ddy) {
  const targets = App.editTargets();
  if (targets.length !== 1) return [ddx, ddy];
  const it = targets[0];
  if (!it) return [ddx, ddy];
  const sx0 = (it.flipH ? -1 : 1) * (it.sx || 1);
  const sy0 = (it.flipV ? -1 : 1) * (it.sy || 1);
  if (ddx && sx0) return [ddx, ddx * (sy0 / sx0)];
  if (ddy && sy0) return [ddy * (sx0 / sy0), ddy];
  return [ddx, ddy];
};
App.applyEditScaleDelta = function (ddx, ddy) {
  if (App.state.sizeMode === 'prop') {
    const p = App.propScalePair(ddx, ddy);
    ddx = p[0]; ddy = p[1];
  }
  if (!App.applyGroupScaleAbs(ddx, ddy)) {
    App.withTransformBatch(() => App.editTargets().forEach(it => App.scaleItemKeepCenterAbs(it, ddx, ddy)));
  }
  if (App.scheduleFrameUpdate) App.scheduleFrameUpdate('edit');
  else App.drawOutlines();
};
function rotatePoint(p, c, deg) {
  const a = deg * D2R, cos = Math.cos(a), sin = Math.sin(a);
  return {
    x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin,
    y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos
  };
}
App.clampSkew = function (deg) {
  return (App.FZA && App.FZA.normalizeSkew) ? App.FZA.normalizeSkew(deg) : deg;
};

App.mergedLocalCenter = function (it) {
  const loc = it._localBB;
  if (loc) return { lcx: (loc.pts[0][0] + loc.pts[2][0]) / 2, lcy: (loc.pts[0][1] + loc.pts[2][1]) / 2 };
  try {
    const lb = App.computeLocalBBox(it);
    if (isFinite(lb.w) && lb.w > 0 && isFinite(lb.h) && lb.h > 0) {
      return { lcx: lb.x + lb.w / 2, lcy: lb.y + lb.h / 2 };
    }
  } catch (e) { /* ignore */ }
  return { lcx: 0, lcy: 0 };
};
App.mergedContentCenter = function (it) {
  const { lcx, lcy } = App.mergedLocalCenter(it);
  const M = App.FZA.layerMatrix({ flipH: it.flipH, flipV: it.flipV, sx: it.sx, sy: it.sy, rot: it.rot, skew: it.skew });
  return { x: it.x + (M.a * lcx + M.c * lcy), y: it.y + (M.b * lcx + M.d * lcy) };
};
App.anchorToKeepCenter = function (it, ccx, ccy) {
  const { lcx, lcy } = App.mergedLocalCenter(it);
  const M = App.FZA.layerMatrix({ flipH: it.flipH, flipV: it.flipV, sx: it.sx, sy: it.sy, rot: it.rot, skew: it.skew });
  it.x = ccx - (M.a * lcx + M.c * lcy);
  it.y = ccy - (M.b * lcx + M.d * lcy);
};
App.editTransformSnap = function (it) {
  const s = { it, x: it.x, y: it.y, sx: it.sx, sy: it.sy, rot: it.rot, skew: it.skew };
  if (it.kind === 'merged') {
    const c = App.mergedContentCenter(it);
    s.ccx = c.x; s.ccy = c.y;
  }
  return s;
};
App.applySnapCenterKeep = function (s) {
  if (s.it.kind !== 'merged' || s.ccx === undefined) return;
  App.anchorToKeepCenter(s.it, s.ccx, s.ccy);
};

App.anchorTarget = function () {
  const e = App.state.edit;
  if (!e || e.type !== 'layer') return null;
  const items = App.editTargets();
  if (items.length !== 1) return null;
  const it = items[0];
  if (!it || it.kind === 'bg') return null;
  return it;
};
App.anchorEligible = function () { return !!App.anchorTarget(); };
App.currentAnchor = function () {
  const a = App.state.anchor;
  if (!a || !a.placed) return null;
  const it = App.anchorTarget();
  if (!it || it.id !== a.layerId) return null;
  return a;
};
App.anchorFixedLocal = function (it) {
  const _am = App.state.editMode;
  if (_am !== 'size' && _am !== 'rotate' && _am !== 'skew') return null;
  const a = App.currentAnchor();
  if (!a || !it || it.id !== a.layerId) return null;
  return { x: a.lx, y: a.ly };
};
App.itemLocalToDoc = function (it, lx, ly) {
  const M = App.FZA.layerMatrix(it);
  return { x: it.x + M.a * lx + M.c * ly, y: it.y + M.b * lx + M.d * ly };
};
App.docToItemLocal = function (it, px, py) {
  const M = App.FZA.layerMatrix(it);
  const det = M.a * M.d - M.b * M.c;
  if (!det) return { x: 0, y: 0 };
  const dx = px - it.x, dy = py - it.y;
  return { x: (M.d * dx - M.c * dy) / det, y: (M.a * dy - M.b * dx) / det };
};
App.placeItemAtDocPoint = function (it, lx, ly, px, py) {
  const M = App.FZA.layerMatrix(it);
  it.x = px - (M.a * lx + M.c * ly);
  it.y = py - (M.b * lx + M.d * ly);
};
App.clampToQuad = function (p, q) {
  if (!q || q.length < 4) return p;
  if (App.pointInQuad(p, q)) return p;
  let best = null, bestD = Infinity;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const vx = b.x - a.x, vy = b.y - a.y;
    const L2 = vx * vx + vy * vy;
    let t = L2 ? ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2 : 0;
    t = clamp(t, 0, 1);
    const qx = a.x + vx * t, qy = a.y + vy * t;
    const d = (p.x - qx) * (p.x - qx) + (p.y - qy) * (p.y - qy);
    if (d < bestD) { bestD = d; best = { x: qx, y: qy }; }
  }
  return best || p;
};
App.anchorQuad = function (it) {
  const c = App._anchorQuadCache;
  if (c && c.id === it.id) return c.corners;
  const b = App.getItemDocBBox(it);
  const corners = (b && b.corners && b.corners.length >= 4) ? b.corners.slice(0, 4) : null;
  App._anchorQuadCache = { id: it.id, corners: corners };
  return corners;
};

App.anchorIconPx = 20;
App.anchorArcPath = function (r, a0, a1) {
  const p0 = [r * Math.cos(a0 * D2R), r * Math.sin(a0 * D2R)];
  const p1 = [r * Math.cos(a1 * D2R), r * Math.sin(a1 * D2R)];
  return 'M' + fmtNum(p0[0], 2) + ' ' + fmtNum(p0[1], 2) +
    ' A' + r + ' ' + r + ' 0 0 1 ' + fmtNum(p1[0], 2) + ' ' + fmtNum(p1[1], 2);
};
App.ensureAnchorIcon = function () {
  if (App.anchorIconEl && App.anchorIconEl.isConnected) return App.anchorIconEl;
  const host = App.anchorG || document.getElementById('anchorG');
  if (!host) return null;
  const g = svgEl('g', { class: 'sve-anchor-icon', 'pointer-events': 'none' });
  const arcs = svgEl('g', { class: 'sve-anchor-arcs', 'pointer-events': 'none' });
  const R = App.anchorIconPx / 2 - 1.4;
  for (let i = 0; i < 4; i++) {
    arcs.appendChild(svgEl('path', {
      d: App.anchorArcPath(R, i * 90 + 24, i * 90 + 66),
      fill: 'none', 'pointer-events': 'none'
    }));
  }
  const dot = svgEl('circle', { class: 'sve-anchor-dot', cx: 0, cy: 0, r: 2.2, 'pointer-events': 'none' });
  g.appendChild(arcs);
  g.appendChild(dot);
  g.style.display = 'none';
  host.appendChild(g);
  App.anchorIconEl = g;
  App.anchorArcsEl = arcs;
  return g;
};
App.anchorUnmerge = function () {
  const arcs = App.anchorArcsEl;
  if (!arcs) return;
  try { arcs.getAnimations().forEach(a => a.cancel()); } catch (e) { }
};
App.anchorMergeAnim = function () {
  const arcs = App.anchorArcsEl;
  if (!arcs || !arcs.animate) return;
  try {
    arcs.animate([{ transform: 'scale(1)' }, { transform: 'scale(0.55)' }],
      { duration: 240, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' });
  } catch (e) { /* ignore */ }
};
App.drawAnchorIcon = function () {
  const it = App.anchorTarget();
  const a = it ? App.currentAnchor() : null;
  const placing = !!(it && App.state.anchorPlacing);
  const _am = App.state.editMode;
  const show = !!it && (_am === 'size' || _am === 'rotate' || _am === 'skew') && (!!a || placing);
  if (!show) { if (App.anchorIconEl) App.anchorIconEl.style.display = 'none'; return; }
  const el = App.ensureAnchorIcon();
  if (!el) return;
  el.style.display = '';
  const doc = placing
    ? (App.anchorHoverDoc || App.itemLocalToDoc(it, 0, 0))
    : App.itemLocalToDoc(it, a.lx, a.ly);
  const k = 1 / (App.state.view.scale || 1);
  el.setAttribute('transform', 'translate(' + fmtNum(doc.x, 3) + ' ' + fmtNum(doc.y, 3) + ') scale(' + fmtNum(k, 6) + ')');
};

App.startAnchorPlacing = function () {
  const it = App.anchorTarget();
  if (!it) return false;
  App.state.anchor = null;
  App.state.anchorPlacing = true;
  App.anchorHoverDoc = null;
  App._anchorQuadCache = null;
  App.anchorUnmerge();
  const bb = App.getItemDocBBox(it);
  const c = (bb && isFinite(bb.cx) && isFinite(bb.cy)) ? { x: bb.cx, y: bb.cy } : App.itemLocalToDoc(it, 0, 0);
  App.anchorHoverDoc = c;
  App.anchorHoverLocal = App.docToItemLocal(it, c.x, c.y);
  App.updateEditBar();
  App.drawOutlines();
  return true;
};
App.cancelAnchorPlacing = function () {
  if (!App.state.anchorPlacing) return;
  App.state.anchorPlacing = false;
  App.anchorHoverDoc = null;
  App.anchorHoverLocal = null;
  App.anchorUnmerge();
  App.updateEditBar();
  App.drawOutlines();
};
App.clearAnchor = function () {
  App.state.anchor = null;
  App.state.anchorPlacing = false;
  App.anchorHoverDoc = null;
  App.anchorHoverLocal = null;
  App._anchorQuadCache = null;
  App.anchorUnmerge();
  if (App.anchorIconEl) App.anchorIconEl.style.display = 'none';
};
App.toggleAnchor = function () {
  if (!App.anchorEligible()) return false;
  if (App.state.anchorPlacing) { App.cancelAnchorPlacing(); return true; }
  if (App.state.anchor && App.state.anchor.placed) {
    App.clearAnchor();
    App.updateEditBar();
    App.drawOutlines();
    return true;
  }
  return App.startAnchorPlacing();
};
App.onAnchorHover = function (clientX, clientY) {
  const it = App.anchorTarget();
  if (!it || !App.state.anchorPlacing) return;
  const pd = App.screenToDoc(clientX, clientY);
  const p = App.clampToQuad(pd, App.anchorQuad(it));
  App.anchorHoverDoc = p;
  App.anchorHoverLocal = App.docToItemLocal(it, p.x, p.y);
  App.drawAnchorIcon();
};
App.fixAnchorAt = function (clientX, clientY) {
  const it = App.anchorTarget();
  if (!it || !App.state.anchorPlacing) return false;
  const pd = App.screenToDoc(clientX, clientY);
  const p = App.clampToQuad(pd, App.anchorQuad(it));
  const lp = App.docToItemLocal(it, p.x, p.y);
  App.state.anchor = { layerId: it.id, lx: lp.x, ly: lp.y, placed: true };
  App.state.anchorPlacing = false;
  App.anchorHoverDoc = null;
  App.anchorHoverLocal = null;
  App.anchorMergeAnim();
  App.updateEditBar();
  App.drawOutlines();
  if (App.contentChanged) App.contentChanged();
  return true;
};
function groupCenter(items) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  items.forEach(it => {
    const b = App.getItemDocBBox(it);
    minx = Math.min(minx, b.x); miny = Math.min(miny, b.y);
    maxx = Math.max(maxx, b.x + b.w); maxy = Math.max(maxy, b.y + b.h);
  });
  return { x: (minx + maxx) / 2, y: (miny + maxy) / 2 };
}
App.groupRotateItems = function (items, dd, c) {
  if (!items.length) return;
  if (!c) c = groupCenter(items);
  items.forEach(it => {
    if (it.kind === 'merged') {
      const p = App.mergedContentCenter(it);
      const p2 = rotatePoint(p, c, dd);
      it.rot += dd;
      App.anchorToKeepCenter(it, p2.x, p2.y);
    } else {
      const p = rotatePoint({ x: it.x, y: it.y }, c, dd);
      it.x = p.x; it.y = p.y; it.rot += dd;
    }
    App.applyItemTransform(it);
  });
};
App.groupSkewItems = function (items, dd, c) {
  if (!items.length) return;
  if (!c) c = groupCenter(items);
  const t = Math.tan(dd * D2R);
  items.forEach(it => {
    if (it.kind === 'merged') {
      const p = App.mergedContentCenter(it);
      const rx = p.x - c.x, ry = p.y - c.y;
      it.skew = App.clampSkew(it.skew + dd);
      App.anchorToKeepCenter(it, c.x + rx + t * ry, c.y + ry);
    } else {
      const rx = it.x - c.x, ry = it.y - c.y;
      it.x = c.x + rx + t * ry;
      it.y = c.y + ry;
      it.skew = App.clampSkew(it.skew + dd);
    }
    App.applyItemTransform(it);
  });
};
App.applyEditRotate = function (dd) {
  const items = App.editTargets();
  if (items.length > 1) {
    if (App.groupTransformApply(g => { g.rot += dd; })) {
      App.updateEditValue();
      App.refreshLayerThumbs();
      return;
    }
  }
  App.withTransformBatch(() => items.forEach(it => {
    const af = App.anchorFixedLocal(it);
    if (af) {
      const p0 = App.itemLocalToDoc(it, af.x, af.y);
      it.rot += dd;
      App.placeItemAtDocPoint(it, af.x, af.y, p0.x, p0.y);
    } else if (it.kind === 'merged') {
      const c = App.mergedContentCenter(it);
      const p = rotatePoint({ x: it.x, y: it.y }, c, dd);
      it.x = p.x; it.y = p.y; it.rot += dd;
    } else {
      const b = App.getItemDocBBox(it);
      const p = rotatePoint({ x: it.x, y: it.y }, { x: b.cx, y: b.cy }, dd);
      it.x = p.x; it.y = p.y; it.rot += dd;
    }
    App.applyItemTransform(it);
  }));
  App.drawOutlines();
  App.updateEditValue();
  App.refreshLayerThumbs();
};
App.applyEditSkew = function (dd) {
  const items = App.editTargets();
  if (items.length > 1) {
    if (App.groupTransformApply(g => { g.skew = App.clampSkew(g.skew + dd); })) {
      App.updateEditValue();
      App.refreshLayerThumbs();
      return;
    }
  }
  App.withTransformBatch(() => items.forEach(it => {
    const _h = Math.max(1, App.localContentSize(it).h);
    const _th = it.skew * D2R;
    const _t0 = Math.tan(_th);
    const _t1 = _t0 + (128 / _h) * (Math.tan(_th + dd * D2R) - _t0);
    const d = Math.atan(_t1) / D2R - it.skew;
    const af = App.anchorFixedLocal(it);
    if (af) {
      const p0 = App.itemLocalToDoc(it, af.x, af.y);
      it.skew = App.clampSkew(it.skew + d);
      App.placeItemAtDocPoint(it, af.x, af.y, p0.x, p0.y);
    } else if (it.kind === 'merged') {
      const c = App.mergedContentCenter(it);
      it.skew = App.clampSkew(it.skew + d);
      App.anchorToKeepCenter(it, c.x, c.y);
    } else {
      it.skew = App.clampSkew(it.skew + d);
    }
    App.applyItemTransform(it);
  }));
  App.drawOutlines();
  App.updateEditValue();
  App.refreshLayerThumbs();
};
App.applyEditOpacityDelta = function (d) {
  App.withTransformBatch(() => App.editTargets().forEach(it => {
    it.opacity = clamp(it.opacity + d, 0, 1);
    App.applyItemTransform(it);
    App.markThumbDirty(it);
  }));
  App.drawOutlines();
  App.updateEditValue();
  App.refreshLayerThumbs();
};

App.tick = function (dt) {
  if (!App.state.edit) return;
  const k = App.state.keys;
  const mode = App.state.editMode;
  if (!k.size) return;
  if (mode === 'move') {
    const sp = App.state.editSpeeds.move / App.state.view.scale;
    let dx = 0, dy = 0;
    if (k.has('up')) dy -= sp * dt;
    if (k.has('down')) dy += sp * dt;
    if (k.has('left')) dx -= sp * dt;
    if (k.has('right')) dx += sp * dt;
    if (dx || dy) App.applyEditMove(dx, dy);
  } else if (mode === 'size') {
    const d = (App.state.editSpeeds.size / 100) * dt / App.state.view.scale;
    if (App.state.sizeMode === 'prop') {
      let dd = 0;
      if (k.has('up')) dd += d;
      if (k.has('down')) dd -= d;
      if (k.has('left')) dd += d;
      if (k.has('right')) dd -= d;
      if (dd) App.applyEditScaleDelta(dd, dd);
    } else {
      let ddx = 0, ddy = 0;
      if (k.has('up')) ddy += d;
      if (k.has('down')) ddy -= d;
      if (k.has('left')) ddx += d;
      if (k.has('right')) ddx -= d;
      if (ddx || ddy) App.applyEditScaleDelta(ddx, ddy);
    }
  } else if (mode === 'rotate') {
    let d = 0;
    if (k.has('left')) d -= App.state.editSpeeds.rotate * dt;
    if (k.has('right')) d += App.state.editSpeeds.rotate * dt;
    if (d) App.applyEditRotate(d);
  } else if (mode === 'skew') {
    let d = 0;
    if (k.has('left')) d += App.state.editSpeeds.skew * dt;
    if (k.has('right')) d -= App.state.editSpeeds.skew * dt;
    if (d) App.applyEditSkew(d);
  } else if (mode === 'opacity') {
    const spd = (App.state.editSpeeds && isFinite(App.state.editSpeeds.opacity)) ? App.state.editSpeeds.opacity : 30;
    let d = 0;
    if (k.has('up')) d += (spd / 100) * dt;
    if (k.has('down')) d -= (spd / 100) * dt;
    if (d) App.applyEditOpacityDelta(d);
  }
};

App.arrowStep = function (dir) {
  const mode = App.state.editMode;
  if (!mode) return;
  if (App.cancelColorPreview) App.cancelColorPreview();
  const ns = App.state.nudgeSpeeds || {};
  const nv = (v, d) => (isFinite(v) ? v : d);
  App.editHist.checkpoint();
  App.editHist.endGesture();
  if (mode === 'move') {
    const st = nv(ns.move, 0.2) / (App.state.view.scale || 1);
    let dx = 0, dy = 0;
    if (dir === 'left') dx -= st;
    if (dir === 'right') dx += st;
    if (dir === 'up') dy -= st;
    if (dir === 'down') dy += st;
    App.applyEditMove(dx, dy);
  } else if (mode === 'size') {
    const d = nv(ns.size, 0.8) / 100;
    if (App.state.sizeMode === 'prop') {
      if (dir === 'up' || dir === 'right') App.applyEditScaleDelta(d, d);
      else if (dir === 'down' || dir === 'left') App.applyEditScaleDelta(-d, -d);
    } else {
      if (dir === 'up') App.applyEditScaleDelta(0, d);
      else if (dir === 'down') App.applyEditScaleDelta(0, -d);
      else if (dir === 'left') App.applyEditScaleDelta(d, 0);
      else if (dir === 'right') App.applyEditScaleDelta(-d, 0);
    }
    App.refreshLayerThumbs();
  } else if (mode === 'rotate') {
    const d = nv(ns.rotate, 0.1);
    if (dir === 'left') App.applyEditRotate(-d);
    else if (dir === 'right') App.applyEditRotate(d);
  } else if (mode === 'skew') {
    const d = nv(ns.skew, 0.1);
    if (dir === 'left') App.applyEditSkew(d);
    else if (dir === 'right') App.applyEditSkew(-d);
  } else if (mode === 'opacity') {
    const d = nv(ns.opacity, 1) / 100;
    if (dir === 'up') App.applyEditOpacityDelta(d);
    else if (dir === 'down') App.applyEditOpacityDelta(-d);
  }
};

App.pointInQuad = function (p, q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const cr = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cr !== 0) {
      const s = cr > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
  }
  return true;
};

App.onEditPointerDown = function (e) {
  if (App.state.spaceDown) return;
  if (App.cancelColorPreview) App.cancelColorPreview();
  const mode = App.state.editMode;
  if (App.state.anchorPlacing &&
      (mode === 'size' || mode === 'rotate' || mode === 'skew')) {
    App.fixAnchorAt(e.clientX, e.clientY);
    e.preventDefault();
    return;
  }
  if (mode === 'move') {
    const layer = (e.clientX === 0 && e.clientY === 0 && e.target)
      ? App.hitLayer(e)
      : App.hitLayerPaintedSync(e.clientX, e.clientY);
    if (!layer) return;
    const top = App.topOf(layer);
    const items = App.editTargets();
    const inTarget = items.some(it => it === top || (it.kind === 'merged' && it.children && it.children.includes(layer)));
    if (!inTarget) return;
    App.editHist.checkpoint();
    App.drag = {
      kind: 'editmove',
      startX: e.clientX, startY: e.clientY,
      scale: App.state.view.scale,
      snap: items.map(it => ({ it, x: it.x, y: it.y }))
    };
    try { App.svg.setPointerCapture(e.pointerId); } catch (err) { }
    e.preventDefault();
  } else if (mode === 'size') {
    const gizmo = App.state.showHandles !== false;
    const hEl = gizmo ? (e.target.closest && e.target.closest('[data-h]')) : null;
    const g = App.handleGeometry();
    if (!g) return;
    const items = App.editTargets();
    const pd = App.screenToDoc(e.clientX, e.clientY);
    let inside = false;
    for (const it of items) {
      const b = App.getItemDocBBox(it);
      if (b.corners && b.corners.length >= 4 && App.pointInQuad(pd, b.corners)) { inside = true; break; }
    }
    let h = hEl ? hEl.getAttribute('data-h') : null;
    if (!h && !inside && gizmo) {
      const R = App.handleHitPx(g.box) / 2;
      let best = null, bestD = R;
      for (const k of ['nw', 'ne', 'se', 'sw']) {
        const hp = g[k];
        if (!hp) continue;
        const sp = App.docToScreen(hp.x, hp.y);
        const d = Math.hypot(e.clientX - sp.x, e.clientY - sp.y);
        if (d < bestD) { bestD = d; best = k; }
      }
      h = best;
    }
    if (h) {
      const hp = g[h] || { x: g.cx, y: g.cy };
      App.editHist.checkpoint();
      const _g0 = App.editSession && App.editSession.grp
        ? { rot: App.editSession.grp.rot, skew: App.editSession.grp.skew, sx: App.editSession.grp.sx, sy: App.editSession.grp.sy } : null;
      const _af = (items.length === 1) ? App.anchorFixedLocal(items[0]) : null;
      const _ad = _af ? App.itemLocalToDoc(items[0], _af.x, _af.y) : null;
      const _anchorCenter = (items.length === 1 && _ad) ? { x: _ad.x, y: _ad.y } : { x: g.cx, y: g.cy };
      App.drag = {
        kind: 'edithandle',
        h,
        startX: e.clientX, startY: e.clientY,
        scale: App.state.view.scale,
        box: g.box,
        center: _anchorCenter,
        anchorFix: _af,
        anchorDoc: _ad,
        groupC: { x: g.cx, y: g.cy },
        g0: _g0,
        grabAngle: Math.atan2(hp.y - _anchorCenter.y, hp.x - _anchorCenter.x),
        rotLock: 0,
        skewLock: 0,
        snap: App.editTargets().map(it => ({ it, x: it.x, y: it.y, sx: it.sx, sy: it.sy, rot: it.rot, skew: it.skew }))
      };
      try { App.svg.setPointerCapture(e.pointerId); } catch (err) { }
      e.preventDefault();
    } else {
      if (!items.length) return;
      if (!inside) return;
      App.editHist.checkpoint();
      App.drag = {
        kind: 'editmove',
        startX: e.clientX, startY: e.clientY,
        scale: App.state.view.scale,
        snap: items.map(it => ({ it, x: it.x, y: it.y }))
      };
      try { App.svg.setPointerCapture(e.pointerId); } catch (err) { }
      e.preventDefault();
    }
  } else if (mode === 'rotate') {
    const items = App.editTargets();
    if (!items.length) return;
    const pd = App.screenToDoc(e.clientX, e.clientY);
    const g = App.handleGeometry();
    if (!g) return;
    let inside = false;
    for (const it of items) {
      const b = App.getItemDocBBox(it);
      if (b.corners && b.corners.length >= 4 && App.pointInQuad(pd, b.corners)) { inside = true; break; }
    }
    App.editHist.checkpoint();
    if (inside) {
      App.drag = {
        kind: 'editmove',
        startX: e.clientX, startY: e.clientY,
        scale: App.state.view.scale,
        snap: items.map(it => ({ it, x: it.x, y: it.y }))
      };
    } else {
      const _af = (items.length === 1) ? App.anchorFixedLocal(items[0]) : null;
      const _ad = _af ? App.itemLocalToDoc(items[0], _af.x, _af.y) : null;
      const _rc = _ad ? { x: _ad.x, y: _ad.y } : { x: g.cx, y: g.cy };
      App.drag = {
        kind: 'editrotate',
        center: _rc,
        anchorFix: _af,
        anchorDoc: _ad,
        grabAngle: Math.atan2(pd.y - _rc.y, pd.x - _rc.x),
        g0: App.editSession && App.editSession.grp
          ? { rot: App.editSession.grp.rot, skew: App.editSession.grp.skew, sx: App.editSession.grp.sx, sy: App.editSession.grp.sy } : null,
        snap: items.map(it => App.editTransformSnap(it))
      };
    }
    try { App.svg.setPointerCapture(e.pointerId); } catch (err) { }
    e.preventDefault();
  } else if (mode === 'skew') {
    const items = App.editTargets();
    if (!items.length) return;
    const pd = App.screenToDoc(e.clientX, e.clientY);
    let inside = false;
    for (const it of items) {
      const b = App.getItemDocBBox(it);
      if (b.corners && b.corners.length >= 4 && App.pointInQuad(pd, b.corners)) { inside = true; break; }
    }
    App.editHist.checkpoint();
    if (inside) {
      App.drag = {
        kind: 'editmove',
        startX: e.clientX, startY: e.clientY,
        scale: App.state.view.scale,
        snap: items.map(it => ({ it, x: it.x, y: it.y }))
      };
    } else {
      const _af = (items.length === 1) ? App.anchorFixedLocal(items[0]) : null;
      const _ad = _af ? App.itemLocalToDoc(items[0], _af.x, _af.y) : null;
      App.drag = {
        kind: 'editskew',
        startX: e.clientX, startY: e.clientY,
        scale: App.state.view.scale,
        anchorFix: _af,
        anchorDoc: _ad,
        g0: App.editSession && App.editSession.grp
          ? { rot: App.editSession.grp.rot, skew: App.editSession.grp.skew, sx: App.editSession.grp.sx, sy: App.editSession.grp.sy } : null,
        snap: items.map(it => App.editTransformSnap(it))
      };
    }
    try { App.svg.setPointerCapture(e.pointerId); } catch (err) { }
    e.preventDefault();
  }
};

App.onEditPointerMove = function (e) {
  if (!App.drag) return;
  const apply = fn => App.withTransformBatch ? App.withTransformBatch(fn) : fn();
  if (App.drag.kind === 'editmove') {
    const dx = (e.clientX - App.drag.startX) / App.drag.scale;
    const dy = (e.clientY - App.drag.startY) / App.drag.scale;
    apply(() => App.drag.snap.forEach(s => {
      s.it.x = s.x + dx; s.it.y = s.y + dy;
      App.applyItemTransform(s.it);
    }));
    if (App.scheduleFrameUpdate) App.scheduleFrameUpdate('edit');
    else App.drawOutlines();
  } else if (App.drag.kind === 'editrotate') {
    const pd = App.screenToDoc(e.clientX, e.clientY);
    const rotD = (Math.atan2(pd.y - App.drag.center.y, pd.x - App.drag.center.x) - App.drag.grabAngle) * 180 / Math.PI;
    if (App.drag.snap.length > 1) {
      const g0 = App.drag.g0;
      if (g0) { App.editSession.grp.rot = g0.rot + rotD; App.groupDecompose(); }
    } else {
      apply(() => App.drag.snap.forEach(s => {
        s.it.rot = s.rot + rotD;
        if (App.drag.anchorFix && App.drag.anchorDoc) {
          App.placeItemAtDocPoint(s.it, App.drag.anchorFix.x, App.drag.anchorFix.y, App.drag.anchorDoc.x, App.drag.anchorDoc.y);
        } else {
          App.applySnapCenterKeep(s);
        }
        App.applyItemTransform(s.it);
      }));
    }
    if (App.scheduleFrameUpdate) App.scheduleFrameUpdate('edit');
    else { App.drawOutlines(); App.updateEditValue(); }
  } else if (App.drag.kind === 'editskew') {
    const dx = (e.clientX - App.drag.startX) / App.drag.scale;
    const skewD = -(dx / 200) * 60;
    if (App.drag.snap.length > 1) {
      const g0 = App.drag.g0;
      if (g0) { App.editSession.grp.skew = App.clampSkew(g0.skew + skewD); App.groupDecompose(); }
    } else {
      apply(() => App.drag.snap.forEach(s => {
        s.it.skew = App.clampSkew(s.skew + skewD);
        if (App.drag.anchorFix && App.drag.anchorDoc) {
          App.placeItemAtDocPoint(s.it, App.drag.anchorFix.x, App.drag.anchorFix.y, App.drag.anchorDoc.x, App.drag.anchorDoc.y);
        } else {
          App.applySnapCenterKeep(s);
        }
        App.applyItemTransform(s.it);
      }));
    }
    if (App.scheduleFrameUpdate) App.scheduleFrameUpdate('edit');
    else { App.drawOutlines(); App.updateEditValue(); }
  } else if (App.drag.kind === 'edithandle') {
    const dx = (e.clientX - App.drag.startX) / App.drag.scale;
    const dy = (e.clientY - App.drag.startY) / App.drag.scale;
    const h = App.drag.h;
    const items = App.editTargets();
    const it = items[0];
    let dxx = 1, dxy = 0, dyx = 0, dyy = 1;
    if (it && it.w && it.h) {
      const th = (it.rot || 0) * D2R;
      dxx = Math.cos(th); dxy = Math.sin(th);
      dyx = -Math.sin(th); dyy = Math.cos(th);
    }
    const lx = dx * dxx + dy * dxy;
    const ly = dx * dyx + dy * dyy;
    let gx = 0, gy = 0;
    if (h.includes('e')) gx += lx / 200;
    if (h.includes('w')) gx -= lx / 200;
    if (h.includes('n')) gy -= ly / 200;
    if (h.includes('s')) gy += ly / 200;
    if (App.state.sizeMode === 'prop') {
      if (App.drag.snap.length === 1 && it) {
        const p = App.propScalePair(gx, gy);
        gx = p[0]; gy = p[1];
      } else {
        const g = (h.includes('e') || h.includes('w')) ? gx : gy;
        gx = g; gy = g;
      }
    }
    let rotD = 0;
    if (App.state.shiftDown && (h === 'nw' || h === 'ne' || h === 'sw' || h === 'se')) {
      gx = 0; gy = 0;
      const pd = App.screenToDoc(e.clientX, e.clientY);
      const ang = Math.atan2(pd.y - App.drag.center.y, pd.x - App.drag.center.x);
      rotD = (ang - App.drag.grabAngle) * 180 / Math.PI;
      App.drag.rotLock = rotD;
    } else {
      rotD = App.drag.rotLock || 0;
    }
    let skewD = 0;
    if (App.state.shiftDown && (h === 'n' || h === 's')) {
      gx = 0; gy = 0;
      const skewDir = (h === 'n') ? -1 : 1;
      skewD = (skewDir * lx / (App.drag.box.h || 1)) * 60;
      App.drag.skewLock = skewD;
    } else {
      skewD = App.drag.skewLock || 0;
    }
    if (App.drag.snap.length > 1) {
      const g0 = App.drag.g0;
      if (g0 && App.editSession && App.editSession.grp) {
        App.editSession.grp.rot = g0.rot + (rotD || 0);
        App.editSession.grp.skew = App.clampSkew(g0.skew + (skewD || 0));
        App.editSession.grp.sx = g0.sx * (1 + 2 * gx);
        App.editSession.grp.sy = g0.sy * (1 + 2 * gy);
        App.groupDecompose();
      }
    } else {
    apply(() => App.drag.snap.forEach(s => {
      const ssx = (s.it.flipH ? -1 : 1) * (s.sx || 1);
      const ssy = (s.it.flipV ? -1 : 1) * (s.sy || 1);
      if (App.drag.anchorFix && App.drag.anchorDoc) {
        const af = App.drag.anchorFix, ad = App.drag.anchorDoc;
        s.it.rot = rotD ? s.rot + rotD : s.it.rot;
        s.it.skew = skewD ? App.clampSkew(s.skew + skewD) : s.it.skew;
        App.applyScaleWithFlip(s.it, ssx + 2 * gx, ssy + 2 * gy);
        App.placeItemAtDocPoint(s.it, af.x, af.y, ad.x, ad.y);
      } else if (s.it.kind === 'merged') {
        const cx = App.drag.center.x, cy = App.drag.center.y;
        const nsx = ssx + 2 * gx, nsy = ssy + 2 * gy;
        const { lcx, lcy } = App.mergedLocalCenter(s.it);
        const rotF = rotD ? s.rot + rotD : s.it.rot;
        const skewF = skewD ? App.clampSkew(s.skew + skewD) : s.it.skew;
        const M = App.FZA.layerMatrix({ flipH: nsx < 0, flipV: nsy < 0, sx: Math.abs(nsx), sy: Math.abs(nsy), rot: rotF, skew: skewF });
        s.it.x = cx - (M.a * lcx + M.c * lcy);
        s.it.y = cy - (M.b * lcx + M.d * lcy);
        App.applyScaleWithFlip(s.it, nsx, nsy);
      } else {
        s.it.x = s.x;
        s.it.y = s.y;
        App.applyScaleWithFlip(s.it, ssx + 2 * gx, ssy + 2 * gy);
        if (rotD) s.it.rot = s.rot + rotD;
        if (skewD) s.it.skew = App.clampSkew(s.skew + skewD);
      }
      if (s.it.kind === 'merged' && !(App.drag.anchorFix && App.drag.anchorDoc)) {
        if (rotD) s.it.rot = s.rot + rotD;
        if (skewD) s.it.skew = App.clampSkew(s.skew + skewD);
      }
      App.applyItemTransform(s.it);
      App.markThumbDirty(s.it);
    }));
    }
    if (App.scheduleFrameUpdate) App.scheduleFrameUpdate('edit');
    else { App.drawOutlines(); App.updateEditValue(); App.refreshLayerThumbs(); }
  }
};

App.onEditPointerUp = function () {
  App.drag = null;
  App.editHist.endGesture();
};

App.duplicateEditing = function () {
  if (!App.state.edit || App.state.edit.type === 'bg') return;
  const items = App.editTargets();
  if (!items.length) return;
  App.editHist.endGesture();
  const cp = App.editHist.checkpoint();
  App.editHist.endGesture();
  const copies = [];
  items.forEach(it => {
    const slim = App.serializeLayer(it, true);
    copies.push(App.deserializeLayer(slim));
  });
  copies.forEach((c, i) => {
    const it = items[i];
    if (!c.el) App.buildLayerElement(c);
    App.layersRoot.insertBefore(c.el, it.el);
    App.state.layers.splice(App.state.layers.indexOf(it), 0, c);
    App.registerChildren(c);
    c.thumbDirty = true;
    if (c.kind === 'merged' && App.maybeBakeProxy) App.maybeBakeProxy(c);
  });
  if (cp) cp.despawn = copies.map(c => c.id);
  App.refreshPanel();
  App.refreshCount();
  const first = items[0];
  const boxIdx = App.panelLayers().indexOf(first);
  if (boxIdx >= 0) App.lastWheelIdx = boxIdx;
  App.refreshLayerThumbs();
  if (App.contentChanged) App.contentChanged();
  if (App.requestFlashRefresh) App.requestFlashRefresh(false);
  showToast(App.i18n.tf('toast.edit.copied', { n: copies.length }));
};

App.editFlipCycle = function () {
  const items = App.editTargets();
  if (!items.length) return;
  App.editHist.checkpoint();
  App.editHist.endGesture();
  App.state.editFlipStep = (App.state.editFlipStep + 1) % 4; // 1,2,3,0
  items.forEach(it => {
    const c = it.kind === 'merged' && App.mergedContentCenter ? App.mergedContentCenter(it) : null;
    const af = App.anchorFixedLocal(it);
    const p0 = af ? App.itemLocalToDoc(it, af.x, af.y) : null;
    it.flipH = App.state.editFlipStep === 1 || App.state.editFlipStep === 2;
    it.flipV = App.state.editFlipStep === 2 || App.state.editFlipStep === 3;
    if (af && p0) App.placeItemAtDocPoint(it, af.x, af.y, p0.x, p0.y);
    else if (c) App.anchorToKeepCenter(it, c.x, c.y);
    App.applyItemTransform(it);
    App.markThumbDirty(it);
  });
  App.drawOutlines();
  App.refreshLayerThumbs();
  if (App.contentChanged) App.contentChanged();
  const names = ['edit.flip.none', 'edit.flip.h', 'edit.flip.hv', 'edit.flip.v'];
  showToast(App.i18n.tf('toast.edit.flip', { v: App.i18n.t(names[App.state.editFlipStep]) }));
};
