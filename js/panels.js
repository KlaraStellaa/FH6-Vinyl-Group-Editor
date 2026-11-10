'use strict';

App.initPanels = function () {
  App.layerListEl = $('#layerList');
  App.layerListEl.addEventListener('click', e => {
    
    if (App.lastPanelDragEnd && Date.now() - App.lastPanelDragEnd < 200) return;
    const item = e.target.closest('.layer-item');
    if (!item) return;
    const id = parseInt(item.getAttribute('data-id'), 10);
    App.onLayerItemClick(id);
  });
  
  App.layerListEl.addEventListener('dblclick', e => {
    const item = e.target.closest('.layer-item');
    if (!item || App.state.tabDown) return;
    const id = parseInt(item.getAttribute('data-id'), 10);
    if (App.state.selected.size > 1 && App.state.selected.has(id)) {
      App.enterEdit({ type: 'multi', ids: Array.from(App.state.selected) });
    } else {
      App.enterEdit({ type: 'layer', id });
    }
  });
  App.initLayerWheelNav();
  App.initLayerDragReorder();
  App.initPlusRow();          
  App.initRightPanel();
  
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !App.state.plusAnchorActive || App.state.edit) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const ov = document.getElementById('fzaOv');
    if (ov && !ov.classList.contains('hidden')) return;   
    e.preventDefault();
    e.stopPropagation();
    App.openPlusPicker();
  });
  
  let thumbRaf = 0;
  App.layerListEl.addEventListener('scroll', () => {
    if (App._thumbSettleTimer) { clearTimeout(App._thumbSettleTimer); App._thumbSettleTimer = null; }
    App._thumbSettleTimer = setTimeout(() => {
      App._thumbSettleTimer = null;
      App.fillVisibleThumbs();
    }, 90);
    if (thumbRaf) return;
    thumbRaf = requestAnimationFrame(() => {
      thumbRaf = 0;
      App.fillVisibleThumbs({ budget: 4 });
    });
  }, { passive: true });
};


App.initPlusRow = function () {
  const list = App.layerListEl;
  const wrap = list ? list.parentElement : null;
  if (!list || !wrap || App.plusRowEl) return;
  const row = document.createElement('div');
  row.className = 'layer-plus';           
  row.id = 'layerPlusRow';
  
  row.setAttribute('data-i18n', 'panel.plusTip');
  row.setAttribute('data-i18n-attr', 'title');
  row.title = App.i18n.t('panel.plusTip');
  row.textContent = '+';
  row.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    
    if (App.state.plusAnchorActive) App.openPlusPicker();
    else App.setPlusAnchor(true);
  });
  App.plusRowEl = row;
  list.insertBefore(row, list.firstChild);  
  App.refreshPlusRow();
};
App.plusRowH = function () {
  const el = App.plusRowEl;
  if (!el) return 0;
  const cs = getComputedStyle(el);
  return el.offsetHeight + (parseFloat(cs.marginBottom) || 0);
};
App.refreshPlusRow = function () {
  const list = App.layerListEl;
  if (!list || !App.plusRowEl) return;
  if (list.firstChild !== App.plusRowEl) list.insertBefore(App.plusRowEl, list.firstChild);
};

App.setPlusAnchor = function (on) {
  on = !!on;
  if (!!App.state.plusAnchorActive === on) return;
  App.state.plusAnchorActive = on;
  if (on) {
    App.lastWheelIdx = undefined;   
    App.state.selBarDismissed = true;
    
  }
  if (App.plusRowEl) App.plusRowEl.classList.toggle('anchor', on);
  App.syncPanelSelectionClasses();
  App.updateSelToolbar();
  App.requestFlashRefresh();
  App.alignWheelScroll();
};


App.openPlusPicker = async function () {
  const text = await App.fzaPickSvgLibrary();
  if (text === null) return;
  App.importSVGContent(text);
};

App.onLayerItemClick = function (id) {
  const layer = App.findLayer(id);
  if (!layer) return;
  if (App.state.tabDown) {
    
    App.rollbackTabAutoSel();
    App.state.tabGestureUsed = true;
    App.toggleLayerSelection(layer);
    App.scrollItemToTop(layer);
  } else if (App.state.selected.size > 1 || (App.state.selectedByTab && App.state.selected.size >= 1)) {
    
    App.state.selBarDismissed = false;
    App.scrollItemToTop(layer);
    App.syncPanelSelectionClasses();
    App.updateSelToolbar();
    App.requestFlashRefresh();
  } else {
    
    if (App.setPlusAnchor) App.setPlusAnchor(false);   
    App.state.selectedByTab = false;
    App.lastWheelIdx = undefined;
    App.state.selBarDismissed = false;
    App.setSelection([id]);
    App.scrollItemToTop(layer);
  }
};


App.lastWheelIdx = undefined;
App._progScrollTop = null;   

App._layerRowsCache = null;
App._layerRowHCache = 0;
App.layerRows = function () {
  if (!App._layerRowsCache) App._layerRowsCache = $$('.layer-item', App.layerListEl);
  return App._layerRowsCache;
};
App.invalidateLayerRows = function () {
  App._layerRowsCache = null;
  App._layerRowHCache = 0;
};

App.layerRowH = function () {
  if (App._layerRowHCache > 0) return App._layerRowHCache;
  const items = App.layerRows();
  if (items.length >= 2) {
    const h = items[1].offsetTop - items[0].offsetTop;
    if (h > 0) { App._layerRowHCache = h; return h; }
  }
  const it = items[0];
  if (it) {
    const cs = getComputedStyle(it);
    const h = it.offsetHeight + (parseFloat(cs.marginBottom) || 0);
    if (h > 0) { App._layerRowHCache = h; return h; }
  }
  return 76;
};

App.alignWheelScroll = function () {
  const list = App.layerListEl;
  const wb = $('#wheelBox');
  if (!list || !wb) return;
  
  if (!list.clientHeight) return;
  const rh = App.layerRowH();
  const plusH = App.plusRowH();   
  const n = App.panelLayers().length;
  
  
  const padTop = (1 * rh) + 'px';
  if (list.style.paddingTop !== padTop) list.style.paddingTop = padTop;
  const padBottom = Math.max(0, list.clientHeight - 2 * rh) + 'px';
  if (list.style.paddingBottom !== padBottom) list.style.paddingBottom = padBottom;
  
  const wbTop = (1 * rh + plusH) + 'px';
  if (wb.style.top !== wbTop) wb.style.top = wbTop;
  const wbH = Math.max(40, rh - 4) + 'px';
  if (wb.style.height !== wbH) wb.style.height = wbH;
  wb.classList.remove('hidden');   
  if (!n) {
    
    list.style.paddingBottom = '0px';
    
    if (!App.state.plusAnchorActive && App.setPlusAnchor) {
      App.state.plusAnchorEmptyForce = true;
      App.setPlusAnchor(true);
    }
    if (App.plusRowEl) App.plusRowEl.style.marginTop = plusH + 'px';
    list.scrollTop = 0;
    return;
  }
  if (App.state.plusAnchorEmptyForce && App.state.plusAnchorActive) {
    App.state.plusAnchorEmptyForce = false;
    if (App.setPlusAnchor) App.setPlusAnchor(false);   
  }
  
  if (App.state.plusAnchorActive) {
    if (App.plusRowEl) App.plusRowEl.style.marginTop = plusH + 'px';
    list.scrollTop = 0;
    return;
  }
  if (App.plusRowEl) App.plusRowEl.style.marginTop = '';
  
  let idx;
  if (App.lastWheelIdx !== undefined) idx = clamp(App.lastWheelIdx, 0, n - 1);
  else if (App.state.selected.size === 1) {
    const ids = App.panelLayers().map(l => l.id);
    idx = ids.indexOf(Array.from(App.state.selected)[0]);
    if (idx < 0) idx = 0;
  } else {
    idx = 0;
  }
  App.lastWheelIdx = idx;
  const max = Math.max(0, list.scrollHeight - list.clientHeight);
  
  const target = clamp(idx * rh, 0, max);   
  
  if (Math.abs(list.scrollTop - target) > 0.5) { App._progScrollTop = target; list.scrollTop = target; }
};
App.initLayerWheelNav = function () {
  App.layerListEl.addEventListener('wheel', e => {
    if (!App.state.layers.length) return;
    e.preventDefault();
    e.stopPropagation();
    App.stepWhiteBox(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });
  
  App.layerListEl.addEventListener('scrollend', () => {
    const list = App.layerListEl;
    const n = App.panelLayers().length;
    if (!n) return;
    
    if (App._progScrollTop !== null && Math.abs(list.scrollTop - App._progScrollTop) < 0.5) {
      App._progScrollTop = null;
      return;
    }
    App._progScrollTop = null;
    const rh = App.layerRowH();
    if (App.state.plusAnchorActive) {
      
      if (list.scrollTop > 0) {
        App.lastWheelIdx = clamp(Math.round(list.scrollTop / rh), 0, n - 1);
        App.setPlusAnchor(false);
      }
      return;
    }
    const idx = clamp(Math.round(list.scrollTop / rh), 0, n - 1);
    if (idx !== App.lastWheelIdx) {
      App.lastWheelIdx = idx;
      App.syncPanelSelectionClasses();
      App.requestFlashRefresh();
      App.updateSelToolbar();
    }
    
    if (list.scrollTop <= 0) { App.setPlusAnchor(true); return; }
    App.alignWheelScroll();
  });
};

App.stepWhiteBox = function (dir) {
  const n = App.panelLayers().length;
  if (!n) return;
  const ids = App.panelLayers().map(l => l.id); 
  let ni;
  
  if (App.state.plusAnchorActive) {
    if (dir !== 1) return;
    
    ni = 0;
    App.lastWheelIdx = ni;
    App.setPlusAnchor(false);
    
  } else {
    let i;
    if (App.lastWheelIdx !== undefined) {
      
      i = App.lastWheelIdx;
    } else if (App.state.tabDown) {
      const selIdx = Array.from(App.state.selected).map(id => ids.indexOf(id)).filter(j => j >= 0);
      i = selIdx.length ? Math.min(...selIdx) : 0;
    } else if (App.state.selected.size === 1) {
      i = ids.indexOf(Array.from(App.state.selected)[0]);
      if (i < 0) i = 0;
    } else {
      i = 0;
    }
    ni = clamp(i + dir, 0, n - 1);
    if (ni === i) {
      
      if (dir === -1 && i === 0) App.setPlusAnchor(true);
      return; 
    }
    App.lastWheelIdx = ni;
  }
  if (App.state.tabDown) {
    
    App.state.tabGestureUsed = true;
    
    App.state.tabAutoSel = null;
    
    if (!App.state.sweepMode) {
      App.state.sweepMode = App.state.selected.has(ids[ni]) ? 'remove' : 'add';
    }
    if (!App.state.sweepDir) App.state.sweepDir = dir;
    if (App.state.sweepMode === 'remove' && dir !== App.state.sweepDir) {
      App.syncPanelSelectionClasses();
      App.alignWheelScroll();
      App.requestFlashRefresh();
      return;
    }
    const s = new Set(App.state.selected);
    if (App.state.sweepMode === 'add') {
      if (!s.has(ids[ni])) {
        s.add(ids[ni]);
        App.state.selectedByTab = s.size >= 1;
        App.setSelection(Array.from(s));
      } else {
        App.syncPanelSelectionClasses();
      }
    } else {
      if (s.has(ids[ni])) {
        s.delete(ids[ni]);
        App.state.selectedByTab = s.size >= 1;
        App.setSelection(Array.from(s));
      } else {
        App.syncPanelSelectionClasses();
      }
    }
  } else {
    
    App.syncPanelSelectionClasses();
  }
  
  App.alignWheelScroll();
  
  App.requestFlashRefresh();
  
  if (!App.state.tabDown) {
    App.state.selBarDismissed = true;
    App.updateSelToolbar();
  }
};


App.WB_STEP_DELAY = 200;
App.WB_STEP_RATE = 100;
App._wbStep = { dir: 0, delayT: 0, rateT: 0 };

App.startWhiteBoxStep = function (dir) {
  App.stopWhiteBoxStep();
  const d = dir < 0 ? -1 : 1;
  App._wbStep.dir = d;
  App.stepWhiteBox(d);                      
  App._wbStep.delayT = setTimeout(function () {
    App._wbStep.delayT = 0;
    if (!App._wbStep.dir) return;
    App._wbStep.rateT = setInterval(function () {
      if (!App._wbStep.dir) return;
      
      App.stepWhiteBox(App._wbStep.dir);
    }, App.WB_STEP_RATE);
  }, App.WB_STEP_DELAY);
};

App.stopWhiteBoxStep = function () {
  const s = App._wbStep;
  s.dir = 0;
  if (s.delayT) { clearTimeout(s.delayT); s.delayT = 0; }
  if (s.rateT) { clearInterval(s.rateT); s.rateT = 0; }
};


App.requestFlashRefresh = function (animate) {
  if (App.state.batching) return;
  
  App.ensureFlashRunning(animate !== false);
  App.updateFlashOverlays(animate);
};


App.initLayerDragReorder = function () {
  const list = App.layerListEl;
  let drag = null; 
  App.dropIndicator = document.createElement('div');
  App.dropIndicator.id = 'dropIndicator';
  list.appendChild(App.dropIndicator);

  list.addEventListener('pointerdown', e => {
    
    if (e.button !== 0 || App.state.edit || App.state.tabDown) return;
    const item = e.target.closest('.layer-item');
    if (!item) return;
    drag = {
      id: parseInt(item.getAttribute('data-id'), 10),
      startX: e.clientX, startY: e.clientY,
      active: false,
      item
    };
  });
  window.addEventListener('pointermove', e => {
    if (!drag) return;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 6) return;
      drag.active = true;
      drag.item.classList.add('drag-ghost');
      App.showDragGhost(drag.item, e.clientX, e.clientY);
    }
    App.moveDragGhost(e.clientX, e.clientY);
    App.updateDropIndicator(e.clientY);
  });
  window.addEventListener('pointerup', e => {
    if (!drag) return;
    const wasActive = drag.active;
    const id = drag.id;
    drag = null;
    App.hideDropIndicator();
    App.hideDragGhost();
    if (!wasActive) return;
    const q = App.dropIndexAt(e.clientY);
    if (q !== null && q !== undefined) App.reorderLayer(id, q);
    
    App.lastPanelDragEnd = Date.now();
  });
  window.addEventListener('pointercancel', () => {
    if (!drag) return;
    drag = null;
    App.hideDropIndicator();
    App.hideDragGhost();
    App.clearDropMark();
  });
};

App.showDragGhost = function (item, x, y) {
  App.hideDragGhost();
  const src = item.querySelector('img');
  App.dragGhostEl = document.createElement('div');
  App.dragGhostEl.className = 'drag-ghost-float';
  if (src) App.dragGhostEl.appendChild(src.cloneNode());
  document.body.appendChild(App.dragGhostEl);
  App.moveDragGhost(x, y);
};
App.moveDragGhost = function (x, y) {
  if (!App.dragGhostEl) return;
  App.dragGhostEl.style.left = (x + 10) + 'px';
  App.dragGhostEl.style.top = (y + 10) + 'px';
};
App.hideDragGhost = function () {
  if (App.dragGhostEl) { App.dragGhostEl.remove(); App.dragGhostEl = null; }
};
App.dropIndexAt = function (clientY) {
  
  const items = App.layerRows();
  let q = items.length; 
  for (let p = 0; p < items.length; p++) {
    const r = items[p].getBoundingClientRect();
    if (clientY < r.top + r.height / 2) { q = p; break; }
  }
  return q;
};
App.updateDropIndicator = function (clientY) {
  if (!App.dropIndicator) return;
  const items = App.layerRows();
  
  const q = App.dropIndexAt(clientY);
  let top;
  if (q >= items.length) {
    const last = items[items.length - 1];
    top = last ? last.offsetTop + last.offsetHeight + 2 : 4;
  } else {
    top = items[q].offsetTop - 2;
  }
  App.dropIndicator.style.top = Math.max(2, top) + 'px';
  App.dropIndicator.classList.add('visible');
};
App.hideDropIndicator = function () {
  if (App.dropIndicator) App.dropIndicator.classList.remove('visible');
};
App.clearDropMark = function () {
  $$('.layer-item.drop-before, .layer-item.drop-after, .layer-item.drag-ghost', App.layerListEl).forEach(it =>
    it.classList.remove('drop-before', 'drop-after', 'drag-ghost'));
};


App.reorderLayer = function (id, q) {
  const i = App.state.layers.findIndex(l => l.id === id);
  if (i < 0) return;
  App.history.markDiscrete();
  const [l] = App.state.layers.splice(i, 1);
  const after = App.state.layers.length;
  const arrIdx = clamp(after - q, 0, after);
  App.state.layers.splice(arrIdx, 0, l);
  
  const ref = App.state.layers[arrIdx + 1];
  if (ref && ref.el && ref.el.parentNode === App.layersRoot) App.layersRoot.insertBefore(l.el, ref.el);
  else App.layersRoot.appendChild(l.el);
  
  if (App.invalidateEditStatic && App.editStatic && App.editStatic.active) App.invalidateEditStatic();
  App.refreshPanel();
  App.clearDropMark();
  
  if (App.contentChanged) App.contentChanged();
};


App.panelLayers = function () {
  const ex = App.currentExcluded ? App.currentExcluded() : null;
  const src = ex ? App.state.layers.filter(l => !ex.has(l)) : App.state.layers;
  return src.slice().reverse();
};

App.refreshPanel = function () {
  if (!App.layerListEl) return;
  const list = App.panelLayers(); 
  
  const existing = new Map();
  $$('.layer-item', App.layerListEl).forEach(el => {
    existing.set(parseInt(el.getAttribute('data-id'), 10), el);
  });
  const wantedIds = new Set(list.map(l => l.id));
  existing.forEach((el, id) => { if (!wantedIds.has(id)) el.remove(); });
  
  let refNode = App.layerListEl.firstChild;
  list.forEach(layer => {
    let item = existing.get(layer.id);
    if (!item) {
      item = document.createElement('div');
      item.className = 'layer-item';
      item.setAttribute('data-id', layer.id);
      const selectedBg = document.createElement('span');
      selectedBg.className = 'layer-select-bg';
      selectedBg.setAttribute('aria-hidden', 'true');
      item.appendChild(selectedBg);
      const thumb = document.createElement('div');
      thumb.className = 'layer-thumb';
      const img = document.createElement('img');
      img.draggable = false;
      thumb.appendChild(img);
      item.appendChild(thumb);
    }
    
    if (!item._selBg) {
      let bg = item.querySelector('.layer-select-bg');
      if (!bg) {
        bg = document.createElement('span');
        bg.className = 'layer-select-bg';
        bg.setAttribute('aria-hidden', 'true');
        item.insertBefore(bg, item.firstChild);
      }
      item._selBg = bg;
    }
    if (item.classList.contains('selected') !== App.state.selected.has(layer.id)) {
      item.classList.toggle('selected', App.state.selected.has(layer.id));
    }
    if (layer.kind === 'merged') {
      if (!item._badge) {
        item._badge = document.createElement('span');
        item._badge.className = 'layer-badge';
        item.appendChild(item._badge);
      }
      const bt = '×' + App.countInLayer(layer);
      if (item._badge.textContent !== bt) item._badge.textContent = bt;
    } else if (item._badge) {
      item._badge.remove();
      item._badge = null;
    }
    
    if (layer.isMask) {
      if (!item._mb) {
        item._mb = document.createElement('span');
        item._mb.className = 'mask-badge';
        item.appendChild(item._mb);
      }
    } else if (item._mb) {
      item._mb.remove();
      item._mb = null;
    }
    
    layer._panelItem = item;
    if (item === refNode) refNode = refNode.nextSibling;
    else App.layerListEl.insertBefore(item, refNode);
  });
  
  App.invalidateLayerRows();
  
  if (App.dropIndicator) App.layerListEl.appendChild(App.dropIndicator);
  App.refreshPlusRow();
  App.syncPanelSelectionClasses();
  App.fillVisibleThumbs(); 
  App.alignWheelScroll(); 
  
  if (App.syncGroupBackBtn) App.syncGroupBackBtn();
};


App.fillVisibleThumbs = function (opts) {
  const list = App.layerListEl;
  if (!list) return;
  
  if (!list.clientHeight) return;
  const st = list.scrollTop, vh = list.clientHeight;
  
  const rows = App.layerRows();
  if (!rows.length) return;
  const rh = (App.layerRowH && App.layerRowH()) || 0;
  const first = 1 * rh + (App.plusRowH ? App.plusRowH() : 0);   
  let from = 0, to = rows.length;
  if (rh > 20) {
    from = Math.max(0, Math.floor((st - 80 - first) / rh));
    to = Math.min(rows.length, Math.ceil((st + vh + 80 - first) / rh) + 1);
  }
  const budget = (opts && opts.budget > 0) ? opts.budget : Infinity;
  let started = 0;
  for (let ri = from; ri < to; ri++) {
    const item = rows[ri];
    if (!item) continue;
    const id = parseInt(item.getAttribute('data-id'), 10);
    const layer = App.findLayer(id);
    if (!layer) continue;
    
    if (App.state.edit && layer.kind === 'merged') continue;
    const img = $('img', item);
    if (img && img.getAttribute('src') && !layer.thumbDirty) continue;
    if (item.dataset.thumbLoading === '1') continue;
    item.dataset.thumbLoading = '1';
    started++;
    const thumb = $('.layer-thumb', item);
    const loader = App.startThumbLoading(thumb);
    App.getLayerThumb(layer).then(async url => {
      if (!img || !img.isConnected || !url) return;
      await App.showThumbImage(thumb, img, url, loader);
    }).catch(e => {
      console.warn('[thumb] 图层栏缩略图生成失败', layer && layer.id, String(e && e.message || e).slice(0, 160));
    }).finally(() => {
      App.finishThumbLoading(thumb, loader);
      if (item.isConnected) delete item.dataset.thumbLoading;
    });
    if (started >= budget) break;
  }
};


App.applyRowSelection = function (item, inSel, showTri) {
  
  if (item.classList.contains('multi-sel') !== inSel) item.classList.toggle('multi-sel', inSel);
  const selectedBg = item._selBg || item.querySelector('.layer-select-bg');
  if (selectedBg) {
    item._selBg = selectedBg;
    const opacity = inSel ? '1' : '0';
    if (selectedBg.style.opacity !== opacity) selectedBg.style.opacity = opacity;
  }
  let tri = item._tri || item.querySelector('.tri');
  if (showTri) {
    if (!tri) {
      tri = document.createElement('span');
      tri.className = 'tri';
      item.appendChild(tri);
    }
    item._tri = tri;
  } else if (tri) {
    tri.remove();
    item._tri = null;
  }
};

App.syncPanelSelectionClasses = function () {
  
  const sel = App.state.selected || new Set();
  const size = sel.size;
  
  const showTri = (size > 1) || !!App.state.tabDown || (size === 1 && !!App.state.selectedByTab);
  const prev = App._selRows || (App._selRows = new Set());
  const next = new Set();
  sel.forEach(id => {
    const l = App.findLayer(id);
    const item = l && l._panelItem;
    if (item && item.isConnected) next.add(item);
  });
  let touched = 0;
  prev.forEach(item => {
    if (next.has(item)) return;
    touched++;
    if (item.isConnected) App.applyRowSelection(item, false, false);
  });
  next.forEach(item => { touched++; App.applyRowSelection(item, true, showTri); });
  App._selRows = next;
  
  
  if (App.state.hideOthers && App.syncHideOthersSelection) App.syncHideOthersSelection();
};

App.refreshCount = function () {
  
  const all = App.countPatterns();
  const ex = App.currentExcluded ? App.currentExcluded() : null;
  let text;
  if (ex) {
    const inScope = App.state.layers.reduce((a, l) => a + (ex.has(l) ? 0 : App.countInLayer(l)), 0);
    text = App.i18n.t('panel.totalPrefix') + App.i18n.tf('panel.totalPair', { in: inScope, all: all });
  } else {
    text = App.i18n.t('panel.totalPrefix') + all;
  }
  $('#totalCount').textContent = text;
  if (App.updateHideLayersButton) App.updateHideLayersButton();
  if (App.updateLayersDisplaySlider) App.updateLayersDisplaySlider();
};


App.scrollItemToTop = function (layer, instant) {
  if (!App.layerListEl || !layer) return;
  if (App.state.plusAnchorActive) App.setPlusAnchor(false);   
  const ids = App.panelLayers().map(l => l.id);
  const i = ids.indexOf(layer.id);
  if (i < 0) return;
  App.lastWheelIdx = i;
  App.alignWheelScroll();
};

App.updateBaseButtons = function () {
  $('#btnBase').textContent = App.i18n.t(App.state.bg.base === 'light' ? 'toolbar.baseLight' : 'toolbar.baseDark');
  $('#btnGrid').textContent = App.i18n.t(App.state.bg.grid ? 'toolbar.gridOn' : 'toolbar.gridOff');
  $('#btnBgImage').textContent = App.i18n.t(App.state.bg.image ? 'toolbar.bgSet' : 'toolbar.bgNone');
  
  if (App.refreshToolbarIcons) App.refreshToolbarIcons();
};

App.switchTab = function (name) {
  const radio = document.querySelector('#panelTabs input[value="' + name + '"]');
  if (radio) radio.checked = true;
  const libEl = $('#libTab'), colorEl = $('#colorTab');
  
  const target = name === 'lib' ? libEl : (name === 'color' ? colorEl : null);
  const willShow = !!(target && target.classList.contains('hidden'));
  [libEl, colorEl].forEach(el => { if (el) el.classList.remove('sve-tab-from-left', 'sve-tab-from-right'); });
  if (willShow) target.classList.add(name === 'lib' ? 'sve-tab-from-left' : 'sve-tab-from-right');
  if (libEl) libEl.classList.toggle('hidden', name !== 'lib');
  if (colorEl) colorEl.classList.toggle('hidden', name !== 'color');
  
  const track = document.querySelector('#panelTabs .ev-tabs-track');
  if (track) {
    const checked = track.querySelector('input:checked');
    const label = checked ? track.querySelector('label[for="' + checked.id + '"]') : null;
    const glider = track.querySelector('.ev-glider');
    if (label && glider) {
      glider.style.width = label.offsetWidth + 'px';
      glider.style.transform = 'translateX(' + label.offsetLeft + 'px)';
    }
  }
  
  if (App.cancelColorPreview) App.cancelColorPreview();
};



App.initRightPanel = function () {
  const rp = $('#rightPanel'), rz = $('#panelResizer'), btn = $('#panelMinBtn');
  rz.addEventListener('pointerdown', e => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = rp.getBoundingClientRect().width;
    const move = ev => {
      const w = clamp(startW + (startX - ev.clientX), 210, 680);
      rp.style.width = w + 'px';
      rp.dataset.lastWidth = w;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  btn.addEventListener('click', () => App.toggleRightPanel());
  
  let _autoT = null;
  window.addEventListener('mousemove', e => {
    if (!rp.classList.contains('minimized')) { clearTimeout(_autoT); _autoT = null; return; }
    const wrap = $('#canvasWrap');
    if (!wrap) return;
    const wr = wrap.getBoundingClientRect();
    if (e.clientY < wr.top || e.clientY > wr.bottom) { clearTimeout(_autoT); _autoT = null; return; }
    if (e.clientX >= window.innerWidth - 4) App.toggleRightPanel(true, true);
  });
  rp.addEventListener('mouseleave', () => {
    clearTimeout(_autoT); _autoT = null;
    if (rp.dataset.autoOpen === '1') App.toggleRightPanel(false, true);
  });
  
  const track = document.querySelector('#panelTabs .ev-tabs-track');
  if (track) {
    track.querySelectorAll('input[type="radio"]').forEach(r => {
      r.addEventListener('change', () => App.switchTab(r.value));
    });
    requestAnimationFrame(() => App.switchTab('lib'));
  }
};


App.toggleRightPanel = function (open, auto) {
  const rp = $('#rightPanel'), btn = $('#panelMinBtn');
  if (!rp || !btn) return;
  const min = rp.classList.contains('minimized');
  const wantMin = (open === undefined) ? !min : !open;   
  if (wantMin === min) { if (auto !== undefined) rp.dataset.autoOpen = auto ? '1' : ''; return; }
  rp.classList.add('sve-panel-anim');
  setTimeout(() => rp.classList.remove('sve-panel-anim'), 280);
  if (!wantMin) {
    rp.classList.remove('minimized');
    rp.style.width = (rp.dataset.lastWidth || 312) + 'px';
    btn.textContent = '▶';
    if (auto !== undefined) rp.dataset.autoOpen = auto ? '1' : ''; else delete rp.dataset.autoOpen;
  } else {
    
    const cur = parseInt(rp.style.width, 10) || parseInt(rp.dataset.lastWidth, 10) || 312;
    if (cur > 60) rp.dataset.lastWidth = String(cur);
    rp.classList.add('minimized');
    btn.textContent = '◀';
    delete rp.dataset.autoOpen;
  }
};


App.refreshClipboardPanel = function () {
  const panel = $('#clipboardPanel');
  const box = $('#cpThumbBox');
  App._clipboardPanelSeq = (App._clipboardPanelSeq || 0) + 1;
  const seq = App._clipboardPanelSeq;
  const slims = App.state.clipboard;
  if (!slims || !slims.length) {
    panel.classList.add('hidden');
    App.finishThumbLoading(box);
    const img = $('#cpThumbImg');
    img.src = '';
    img.style.cssText = '';
    box.style.cssText = '';
    panel.style.width = '';
    return;
  }
  panel.classList.remove('hidden');
  $('#cpCount').textContent = '×' + slims.length;
  const loader = App.startThumbLoading(box);
  App.renderClipboardComposite(slims).then(async res => {
    if (seq !== App._clipboardPanelSeq || !res || !res.url) return;
    const img = $('#cpThumbImg');
    
    const loaded = await App.showThumbImage(box, img, res.url, loader);
    if (!loaded || seq !== App._clipboardPanelSeq) return;
    const w = res.bw, h = res.bh;
    if (!w || !h) { img.style.cssText = ''; return; }
    const boxW = 182, boxH = 102; 
    const s = Math.min(boxW / w, boxH / h);
    img.style.width = Math.round(w * s) + 'px';
    img.style.height = Math.round(h * s) + 'px';
  }).catch(e => {
    console.warn('[thumb] 粘贴板缩略图生成失败', String(e && e.message || e).slice(0, 160));
  }).finally(() => App.finishThumbLoading(box, loader));
};


App.renderClipboardComposite = async function (slims) {
  let g = null;
  try {
    App._clipboardThumbSeq = (App._clipboardThumbSeq || 0) + 1;
    const children = App.deserializeLayersDetached(slims, 'clipthumb_' + App._clipboardThumbSeq + '_');
    g = svgEl('g');
    const symLayers = [];
    const collect = l => {
      if (l.kind === 'symbol') symLayers.push(l);
      if (l.kind === 'merged' && l.children) l.children.forEach(collect);
    };
    children.forEach(ch => {
      App.buildLayerElement(ch);
      g.appendChild(ch.el);
      collect(ch);
    });
    const fake = { kind: 'merged', children, el: g, sx: 1, sy: 1, rot: 0, skew: 0, x: 0, y: 0 };
    (App.hiddenThumbHost || App.svg).appendChild(g);
    
    const lb = App.mergedThumbGeometry(fake).lb;
    const bw = lb.w || 1, bh = lb.h || 1;
    
    const size = Math.min(1024, Math.max(160, Math.round(Math.max(bw, bh) * 0.5)));
    
    await Promise.all(symLayers.map(l => App.symbolColorUrl(l)));
    const url = await App.mergedThumbUrl(fake, size);             
    return { url, bw, bh };
  } catch (e) {
    console.warn('[thumb] renderClipboardComposite 失败', String(e && e.message || e).slice(0, 160));
    return null;
  } finally {
    if (g && g.remove) g.remove();
  }
};

