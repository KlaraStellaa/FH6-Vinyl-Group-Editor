'use strict';
const App = window.App = window.App || {};

App.state = {
  layers: [],
  layerMap: new Map(),
  nextId: 1,
  selected: new Set(),
  selectedByTab: false,
  edit: null,               // {type:'layer'|'multi'|'merged'|'bg', ids:[...]}
  editMode: 'move',         // move|size|rotate|skew|opacity
  sizeMode: 'free',         // free|prop
  axisHint: true,
  showHandles: true,
  lastColor: '#ffffff',
  clipboard: [],
  bg: { base: 'light', grid: true, image: null },
  layersHidden: false,
  layersDisplayOpacity: 1,
  selBarDismissed: false,
  plusAnchorActive: false,
  batching: false,
  wheelZoomEnabled: true,
  editSpeeds: { move: 70, size: 95, rotate: 70, skew: 32, opacity: 30 },
  nudgeSpeeds: { move: 0.5, size: 1, rotate: 0.2, skew: 2, opacity: 1 },
  anchor: null,
  anchorPlacing: false,
  view: { x: 0, y: 0, scale: 1 },
  replacing: false,
  keys: new Set(),
  spaceDown: false,
  tabDown: false,
  sweepMode: null,
  sweepDir: 0,
  tabGestureUsed: false,
  tabAutoSel: null,
  shiftDown: false,
  flashTimer: null,
  loaded: false,
  eyeMode: null,
  editFlipStep: 0,
};

App.newLayer = function (opt) {
  opt = opt || {};
  return {
    id: App.state.nextId++,
    kind: opt.kind || 'symbol',        // symbol | pattern | import | merged
    name: opt.name || App.i18n.t('name.pattern'),
    color: opt.color !== undefined ? opt.color : App.state.lastColor,
    opacity: opt.opacity !== undefined ? opt.opacity : 1,
    x: opt.x || 0, y: opt.y || 0,
    w: opt.w || 128, h: opt.h || 128,
    sx: opt.sx || 1, sy: opt.sy || 1,
    rot: opt.rot || 0, skew: opt.skew || 0,
    flipH: !!opt.flipH, flipV: !!opt.flipV,
    isMask: !!opt.isMask,
    symbolKey: opt.symbolKey || null,
    patternKey: opt.patternKey || null,
    dataUri: opt.dataUri || null,
    importMarkup: opt.importMarkup || null,
    children: opt.children || null,
    el: null, maskEl: null, rectEl: null, innerEl: null,
    patDefEl: null, patBaseRect: null, patStroke: null,
    thumbDirty: true, thumbCache: null,
    _symbolColorEpoch: 0,
  };
};

App.symbolImageDefId = function (layer) {
  return 'sveImg' + String(layer.symbolKey || layer.id).replace(/[^A-Za-z0-9_-]/g, '_');
};
App.ensureSymbolImageDef = function (layer) {
  const id = App.symbolImageDefId(layer);
  if ($('#' + id, App.defs)) return id;
  if (!layer.dataUri) return null;
  const sym = App.symbolMap.get(layer.symbolKey);
  const w = sym ? sym.w : layer.w, h = sym ? sym.h : layer.h;
  const img = svgEl('image', {
    id, href: layer.dataUri,
    x: -w / 2, y: -h / 2, width: w, height: h,
    preserveAspectRatio: 'none'
  });
  App.defs.appendChild(img);
  return id;
};
App.appendMaskSymbolImage = function (maskEl, layer) {
  if (!maskEl || !layer || !layer.dataUri) return;
  const defId = App.ensureSymbolImageDef(layer);
  const sym = layer.symbolKey ? App.symbolMap.get(layer.symbolKey) : null;
  const sourceW = Math.max(0.0001, (sym && sym.w) || layer.w || 1);
  const sourceH = Math.max(0.0001, (sym && sym.h) || layer.h || 1);
  if (defId) {
    maskEl.appendChild(svgEl('use', {
      href: '#' + defId,
      transform: 'scale(' + ((layer.w || 1) / sourceW) + ' ' + ((layer.h || 1) / sourceH) + ')'
    }));
    return;
  }
  maskEl.appendChild(svgEl('image', {
    href: layer.dataUri, x: -layer.w / 2, y: -layer.h / 2,
    width: layer.w, height: layer.h, preserveAspectRatio: 'none'
  }));
};

App.symbolColorUrlCache = new Map();
App.symbolColorPending = new Map();
const TINT_CHUNK = 20000;
function tintPixels(d, rgb) {
  return new Promise(resolve => {
    const total = d.length;
    let i = 0;
    const step = () => {
      const end = Math.min(i + TINT_CHUNK * 4, total);
      for (; i < end; i += 4) {
        const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
        d[i] = rgb.r; d[i + 1] = rgb.g; d[i + 2] = rgb.b;
        d[i + 3] = clamp(lum, 0, 255);
      }
      if (i < total) setTimeout(step, 0);
      else resolve();
    };
    setTimeout(step, 0);
  });
}
App.symbolColorCanvas = function (uri, color, w, h) {
  const key = 'sc:' + uri.slice(0, 60) + uri.slice(-40) + '|' + color + '|' + w + 'x' + h;
  if (silhouetteCache.has(key)) return Promise.resolve(silhouetteCache.get(key));
  if (App.symbolColorPending.has(key)) return App.symbolColorPending.get(key);
  const p = App.decodedImage(uri).then(img => {
    if (!img) return null;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0, w, h);
    const d = cx.getImageData(0, 0, w, h);
    const p2 = d.data;
    const rgb = hexToRgb(color) || { r: 255, g: 255, b: 255 };
    return tintPixels(p2, rgb).then(() => {
      cx.putImageData(d, 0, 0);
      silhouetteCache.set(key, c);
      return c;
    });
  }).finally(() => App.symbolColorPending.delete(key));
  App.symbolColorPending.set(key, p);
  return p;
};
App.symbolColorCanvasSync = function (uri, color, w, h) {
  const key = 'sc:' + uri.slice(0, 60) + uri.slice(-40) + '|' + color + '|' + w + 'x' + h;
  return silhouetteCache.get(key) || null;
};
App.symbolColorUrl = function (layer) {
  const w = Math.max(1, Math.round(layer.w));
  const h = Math.max(1, Math.round(layer.h));
  const key = (layer.symbolKey || layer.dataUri) + '|' + (layer.color || '#ffffff') + '|' + w + 'x' + h;
  if (!App.symbolColorUrlCache.has(key)) {
    App.symbolColorUrlCache.set(key,
      App.symbolColorCanvas(layer.dataUri, layer.color || '#ffffff', w, h)
        .then(c => (c ? c.toDataURL('image/png') : '')));
  }
  return App.symbolColorUrlCache.get(key);
};

App.installSymbolColorUrl = function (layer, imgEl) {
  if (!layer || !imgEl || typeof App.symbolColorUrl !== 'function') return Promise.resolve(false);
  const epoch = layer._symbolColorEpoch || 0;
  const source = layer.dataUri || null;
  const symbolKey = layer.symbolKey || null;
  const color = layer.color || '#ffffff';
  const w = Math.max(1, Math.round(layer.w));
  const h = Math.max(1, Math.round(layer.h));
  let p;
  try { p = App.symbolColorUrl(layer); }
  catch (e) { return Promise.resolve(false); }
  return Promise.resolve(p).then(url => {
    if (!url || layer._symbolColorEpoch !== epoch || layer.imgEl !== imgEl ||
        (layer.dataUri || null) !== source || (layer.symbolKey || null) !== symbolKey ||
        (layer.color || '#ffffff') !== color ||
        Math.max(1, Math.round(layer.w)) !== w || Math.max(1, Math.round(layer.h)) !== h) return false;
    /* A rebuilt/removed element no longer belongs to this layer. During initial build
       parentNode is already set before this callback can run; detached elements are
       therefore rejected while an as-yet-unattached initial element remains valid. */
    if (imgEl.parentNode && layer.el && imgEl.parentNode !== layer.el) return false;
    imgEl.setAttribute('href', url);
    return true;
  }, () => false);
};

App.buildLayerElement = function (layer) {
  const g = svgEl('g', { 'data-layer': layer.id, 'data-kind': layer.kind });
  if (layer.kind === 'symbol') {
    if (layer.isMask) {
      const m = svgEl('mask', {
        id: 'sveM' + layer.id, maskUnits: 'userSpaceOnUse', maskContentUnits: 'userSpaceOnUse',
        x: -layer.w / 2, y: -layer.h / 2, width: layer.w, height: layer.h
      });
      if (layer.dataUri) {
        App.appendMaskSymbolImage(m, layer);
      }
      g.appendChild(m);
      const r = svgEl('rect', {
        x: -layer.w / 2, y: -layer.h / 2, width: layer.w, height: layer.h,
        fill: 'url(#sveMaskInd)', mask: 'url(#sveM' + layer.id + ')',
        'pointer-events': 'visiblePainted'
      });
      g.appendChild(r);
      layer.maskEl = m; layer.rectEl = r;
    } else {
      layer._symbolColorEpoch = (layer._symbolColorEpoch || 0) + 1;
      const imgEl = svgEl('image', {
        id: 'sveLImg' + layer.id,
        x: -layer.w / 2, y: -layer.h / 2, width: layer.w, height: layer.h,
        preserveAspectRatio: 'none', 'pointer-events': 'visiblePainted'
      });
      layer.imgEl = imgEl;
      App.installSymbolColorUrl(layer, imgEl);
      g.appendChild(imgEl);
      layer.maskEl = null; layer.rectEl = null;
    }
  } else if (layer.kind === 'pattern') {
    App.ensurePatternDef(layer);
    const r = svgEl('rect', {
      x: -layer.w / 2, y: -layer.h / 2, width: layer.w, height: layer.h,
      fill: layer.isMask ? 'url(#sveMaskInd)' : 'url(#svePat' + layer.id + ')',
      'pointer-events': 'visiblePainted'
    });
    g.appendChild(r);
    layer.rectEl = r;
  } else if (layer.kind === 'import') {
    const inner = svgEl('g', { transform: 'translate(' + (-layer.w / 2) + ' ' + (-layer.h / 2) + ')' });
    const tpl = document.createElementNS(SVGNS, 'svg');
    tpl.innerHTML = layer.importMarkup || '';
    while (tpl.firstChild) inner.appendChild(tpl.firstChild);
    g.appendChild(inner);
    layer.innerEl = inner;
    if (layer.isMask) App.styleImportAsMask(layer);
    if (App.impMarkDirty && !layer._detachedRender) App.impMarkDirty(layer);
  } else if (layer.kind === 'merged') {
    (layer.children || []).forEach(ch => {
      const el = ch.el || App.buildLayerElement(ch);
      g.appendChild(el);
    });
  }
  layer.el = g;
  App.applyLayerTransform(layer);
  return g;
};

App.rebuildLayerContent = function (layer) {
  if (!layer.el) return;
  layer.el.innerHTML = '';
  layer._symbolColorEpoch = (layer._symbolColorEpoch || 0) + 1;
  layer.maskEl = null; layer.rectEl = null; layer.innerEl = null; layer.imgEl = null;
  layer.bitmapEl = null;
  layer.el.setAttribute('data-kind', layer.kind);
  const g = layer.el;
  if (layer.kind === 'symbol') {
    if (layer.isMask) {
      const m = svgEl('mask', {
        id: 'sveM' + layer.id, maskUnits: 'userSpaceOnUse', maskContentUnits: 'userSpaceOnUse',
        x: -layer.w / 2, y: -layer.h / 2, width: layer.w, height: layer.h
      });
      if (layer.dataUri) {
        App.appendMaskSymbolImage(m, layer);
      }
      g.appendChild(m);
      const r = svgEl('rect', {
        x: -layer.w / 2, y: -layer.h / 2, width: layer.w, height: layer.h,
        fill: 'url(#sveMaskInd)', mask: 'url(#sveM' + layer.id + ')',
        'pointer-events': 'visiblePainted'
      });
      g.appendChild(r);
      layer.maskEl = m; layer.rectEl = r;
    } else {
      const imgEl = svgEl('image', {
        id: 'sveLImg' + layer.id,
        x: -layer.w / 2, y: -layer.h / 2, width: layer.w, height: layer.h,
        preserveAspectRatio: 'none', 'pointer-events': 'visiblePainted'
      });
      layer.imgEl = imgEl;
      App.installSymbolColorUrl(layer, imgEl);
      g.appendChild(imgEl);
      layer.maskEl = null; layer.rectEl = null;
    }
  } else if (layer.kind === 'pattern') {
    App.ensurePatternDef(layer);
    const r = svgEl('rect', {
      x: -layer.w / 2, y: -layer.h / 2, width: layer.w, height: layer.h,
      fill: layer.isMask ? 'url(#sveMaskInd)' : 'url(#svePat' + layer.id + ')',
      'pointer-events': 'visiblePainted'
    });
    g.appendChild(r);
    layer.rectEl = r;
  } else if (layer.kind === 'import') {
    const inner = svgEl('g', { transform: 'translate(' + (-layer.w / 2) + ' ' + (-layer.h / 2) + ')' });
    const tpl = document.createElementNS(SVGNS, 'svg');
    tpl.innerHTML = layer.importMarkup || '';
    while (tpl.firstChild) inner.appendChild(tpl.firstChild);
    g.appendChild(inner);
    layer.innerEl = inner;
    if (layer.isMask) App.styleImportAsMask(layer);
    if (App.impMarkDirty && !layer._detachedRender) App.impMarkDirty(layer);
  } else if (layer.kind === 'merged') {
    (layer.children || []).forEach(ch => g.appendChild(ch.el || App.buildLayerElement(ch)));
  }
  App.applyLayerTransform(layer);
};

App.styleImportAsMask = function (layer) {
  $$('[fill], [stroke]', layer.el).forEach(e => {
    if (e.hasAttribute('fill')) {
      const f = e.getAttribute('fill');
      if (f && f !== 'none' && f.indexOf('url(#sveMaskInd)') < 0) e.setAttribute('fill', 'url(#sveMaskInd)');
    }
    if (e.hasAttribute('stroke')) {
      const st = e.getAttribute('stroke');
      if (st && st !== 'none' && st.indexOf('url(#sveMaskInd)') < 0) e.setAttribute('stroke', 'url(#sveMaskInd)');
    }
  });
};

App.layerTreeHasMask = function (layer) {
  if (layer.isMask) return true;
  if (layer.kind === 'merged' && layer.children) return layer.children.some(App.layerTreeHasMask);
  return false;
};

App.ensurePatternDef = function (layer) {
  if (layer.patDefEl) return;
  const src = (App.patterns || []).find(p => p.key === layer.patternKey);
  if (!src) return;
  const node = src.node.cloneNode(true);
  node.setAttribute('id', 'svePat' + layer.id);
  App.defs.appendChild(node);
  layer.patDefEl = node;
  layer.patStroke = src.stroke;
  const base = node.querySelector('rect');
  if (base) { base.setAttribute('fill', layer.color || '#888888'); layer.patBaseRect = base; }
};

App.applyLayerTransform = function (layer) {
  if (!layer.el) return;
  const sfx = layer.flipH ? -1 : 1, sfy = layer.flipV ? -1 : 1;
  layer.el.setAttribute('transform',
    'translate(' + layer.x + ' ' + layer.y + ') rotate(' + layer.rot + ') scale(' + (layer.sx * sfx) + ' ' + (layer.sy * sfy) + ') skewX(' + layer.skew + ')');
  layer.el.setAttribute('opacity', layer.opacity);
  if (layer.kind !== 'bg') layer.thumbDirty = true;
};
App.applyItemTransform = function (it) {
  if (it.kind === 'bg') App.applyBgTransform(it);
  else App.applyLayerTransform(it);
  /* Batch callers can update many targets without rebuilding overlays per leaf;
     the caller/frame scheduler performs one refresh after the batch. */
  if (!App._batchTransformDepth && App.requestFlashRefresh) App.requestFlashRefresh(false);
};

App.registerChildren = function (layer) {
  App.state.layerMap.set(layer.id, layer);
  if (layer.kind === 'merged' && layer.children) {
    layer.children.forEach(ch => App.registerChildren(ch));
  }
};
App.unregisterChildren = function (layer) {
  App.state.layerMap.delete(layer.id);
  if (layer.kind === 'merged' && layer.children) {
    layer.children.forEach(ch => App.unregisterChildren(ch));
  }
};

App.addLayer = function (layer) {
  if (!layer.el) App.buildLayerElement(layer);
  if (App.state.batching && App.layersRoot.style.display !== 'none') App.layersRoot.style.display = 'none';
  App.layersRoot.appendChild(layer.el);
  App.state.layers.push(layer);
  App.registerChildren(layer);
  layer.thumbDirty = true;
  if (!App.state.batching) {
    App.refreshPanel();
    App.refreshCount();
  }
  if (layer.kind === 'merged' && App.maybeBakeProxy) App.maybeBakeProxy(layer);
    if (App.contentChanged) App.contentChanged();
  return layer;
};

App.removeTopLayer = function (layer) {
  const invalidateColor = function (l) {
    if (!l) return;
    l._symbolColorEpoch = (l._symbolColorEpoch || 0) + 1;
    if (l.kind === 'merged' && l.children) l.children.forEach(invalidateColor);
  };
  invalidateColor(layer);
  if (App.dropEditStaticItem) App.dropEditStaticItem(layer);
  if (layer.kind === 'merged' && App.unbakeProxy) App.unbakeProxy(layer);
  if (App.impCleanup) App.impCleanup(layer);
  if (App.state.batching && App.layersRoot.style.display !== 'none') App.layersRoot.style.display = 'none';
  if (layer.el && layer.el.parentNode) layer.el.parentNode.removeChild(layer.el);
  const i = App.state.layers.indexOf(layer);
  if (i >= 0) App.state.layers.splice(i, 1);
  App.unregisterChildren(layer);
  App.state.selected.delete(layer.id);
  layer.thumbDirty = true;
  if (!App.state.batching) {
    App.refreshPanel();
    App.refreshCount();
    if (App.requestFlashRefresh) App.requestFlashRefresh();
    if (App.contentChanged) App.contentChanged();
  }
};

App.duplicateLayer = function (layer) {
  const slim = App.serializeLayer(layer, true);
  return App.deserializeLayer(slim);
};

App.findLayer = function (id) { return App.state.layerMap.get(id); };

App.topOf = function (layer) {
  let el = layer.el;
  while (el && el.parentNode && el.parentNode !== App.layersRoot) el = el.parentNode;
  return el ? App.findLayer(parseInt(el.getAttribute('data-layer'), 10)) : layer;
};

App.mergeLayers = function (ids) {
  if (App.cancelColorPreview) App.cancelColorPreview();
  App.perfCtx.lastOp = App.i18n.t('name.mergedLayer');
  const __t0 = performance.now();
  const items = ids.map(id => App.findLayer(id)).filter(Boolean);
  if (items.length < 2) return null;
  const box = App.whiteBoxLayer ? App.whiteBoxLayer() : null;
  let aIdx = items.indexOf(box);
  if (aIdx < 0) {
    aIdx = 0;
    let topIdx = -1;
    items.forEach((l, k) => {
      const di = App.state.layers.indexOf(l);
      if (di > topIdx) { topIdx = di; aIdx = k; }
    });
  }
  const anchorOld = App.state.layers.indexOf(items[aIdx]);
  const removedBefore = items.filter(l => App.state.layers.indexOf(l) < anchorOld).length;
  const newIdx = anchorOld - removedBefore;
  const merged = App.newLayer({ kind: 'merged', name: App.i18n.t('name.mergedLayer'), color: '', opacity: 1 });
  const ordered = items.slice().sort((a, b) => App.state.layers.indexOf(a) - App.state.layers.indexOf(b));
  merged.children = ordered;
  items.forEach(l => {
    if (App.dropEditStaticItem) App.dropEditStaticItem(l);
    const i = App.state.layers.indexOf(l);
    if (i >= 0) App.state.layers.splice(i, 1);
    App.state.layerMap.delete(l.id);
  });
  App.buildLayerElement(merged);
  if (App.unbakeProxy) {
    merged.children.forEach(ch => { if (ch.kind === 'merged' && App._proxyBake && App._proxyBake.has(ch.id)) App.unbakeProxy(ch); });
  }
  App.state.layers.splice(newIdx, 0, merged);
  const next = App.state.layers[newIdx + 1];
  if (next && next.el && next.el.parentNode === App.layersRoot) {
    App.layersRoot.insertBefore(merged.el, next.el);
  } else {
    App.layersRoot.appendChild(merged.el);
  }
  App.registerChildren(merged);
  App.lastWheelIdx = App.state.layers.length - 1 - newIdx;
  App.state.selected = new Set();
  App.state.selectedByTab = false;
  App.refreshPanel();
  App.refreshCount();
  if (App.scrollItemToTop) App.scrollItemToTop(merged, true);
  if (App.maybeBakeProxy) App.maybeBakeProxy(merged);
  if (App.contentChanged) App.contentChanged();
  try { App.log('info', '合并分组', { layers: items.length, ms: Math.round(performance.now() - __t0) }); } catch (e) { /* ignore */ }
  return merged;
};

App.splitMerged = function (merged) {
  if (!merged || merged.kind !== 'merged') return;
  if (App.cancelColorPreview) App.cancelColorPreview();
  if (App.dropEditStaticItem) App.dropEditStaticItem(merged);
  const __t0 = performance.now();
  const __n = merged.children ? merged.children.length : 0;
  if (App.unbakeProxy) App.unbakeProxy(merged);
  if (App.autoStaticRelease) App.autoStaticRelease();
  const i = App.state.layers.indexOf(merged);
  const next = i >= 0 ? App.state.layers[i + 1] : null;
  const refEl = next && next.el && next.el.parentNode === App.layersRoot ? next.el : null;
  const mergedM = merged.el ? App.FZA.matFromString(merged.el.getAttribute('transform') || '') : null;
  if (mergedM) {
    (merged.children || []).forEach(ch => {
      const childM = ch.el ? App.FZA.matFromString(ch.el.getAttribute('transform') || '') : null;
      if (!childM) return;
      const comb = App.FZA.mul(mergedM, childM);
      const p = App.FZA.decomposeToModel(comb);
      ch.x = comb.e;
      ch.y = comb.f;
      ch.sx = Math.abs(p.sx) || 1;
      ch.sy = Math.abs(p.sy) || 1;
      ch.rot = normalizeDeg(p.rot);
      ch.skew = p.skew;
      ch.flipH = false;
      ch.flipV = p.sy < 0;
      App.applyLayerTransform(ch);
    });
  }
  if (merged.el && merged.el.parentNode) {
    while (merged.el.firstChild) {
      const ch = merged.el.firstChild;
      if (refEl) App.layersRoot.insertBefore(ch, refEl);
      else App.layersRoot.appendChild(ch);
    }
    merged.el.remove();
  }
  if (i >= 0) App.state.layers.splice(i, 1);
  App.state.layerMap.delete(merged.id);
  const children = (merged.children || []).slice();
  if (i >= 0 && children.length) App.state.layers.splice(i, 0, ...children);
  else children.forEach(ch => App.state.layers.push(ch));
  children.forEach(ch => App.registerChildren(ch));
  if (App.editStatic && App.editStatic.active && App.rebakeEditStaticViewport) {
    children.forEach(ch => { if (!App.editStatic.items.includes(ch)) App.editStatic.items.push(ch); });
    App.rebakeEditStaticViewport();
  }
  App.state.selected = new Set();
  App.state.selectedByTab = false;
  App.refreshPanel();
  App.refreshCount();
  const box = App.whiteBoxLayer ? App.whiteBoxLayer() : null;
  if (App.scrollItemToTop) App.scrollItemToTop(box || children[0] || null, true);
  if (App.autoStaticMaybe) App.autoStaticMaybe();
  try { App.log('info', '拆分分组', { layers: __n, ms: Math.round(performance.now() - __t0) }); } catch (e) { /* ignore */ }
};

App.countInLayer = function (layer) {
  if (layer.kind !== 'merged') return 1;
  return (layer.children || []).reduce((acc, ch) => acc + App.countInLayer(ch), 0);
};
App.countPatterns = function () {
  return App.state.layers.reduce((acc, l) => acc + App.countInLayer(l), 0);
};

App.bgSeq = 0;
App.clearAllLayers = function () {
  App.state.layers.slice().forEach(l => {
    const invalidateColor = function (x) {
      if (!x) return;
      x._symbolColorEpoch = (x._symbolColorEpoch || 0) + 1;
      if (x.kind === 'merged' && x.children) x.children.forEach(invalidateColor);
    };
    invalidateColor(l);
    if (l.el && l.el.parentNode) l.el.parentNode.removeChild(l.el);
  });
  App.state.layers = [];
  App.state.layerMap.clear();
  App.state.selected = new Set();
  $$('pattern[id^="svePat"]', App.defs).forEach(p => p.remove());
};

App.setLayerColor = function (layer, color) {
  layer.color = color;
  layer.thumbDirty = true;
  if (layer.kind === 'symbol') {
    layer._symbolColorEpoch = (layer._symbolColorEpoch || 0) + 1;
    if (layer.isMask) {
      if (layer.rectEl) layer.rectEl.setAttribute('fill', 'url(#sveMaskInd)');
    } else if (layer.imgEl) {
      App.installSymbolColorUrl(layer, layer.imgEl);
    }
  } else if (layer.kind === 'pattern') {
    App.ensurePatternDef(layer);
    if (layer.patBaseRect) layer.patBaseRect.setAttribute('fill', color);
  } else if (layer.kind === 'import' && layer.el && !layer.isMask) {
    $$('[fill]', layer.el).forEach(e => {
      const f = e.getAttribute('fill');
      if (f && f !== 'none') e.setAttribute('fill', color);
    });
    if (App.impMarkDirty) App.impMarkDirty(layer);
  } else if (layer.kind === 'merged' && layer.children) {
    layer.children.forEach(ch => App.setLayerColor(ch, color));
    if (App.markProxyDirty) App.markProxyDirty(layer);
  }
  if (App.editStatic && App.editStatic.active && App.rebakeEditStaticViewport) App.rebakeEditStaticViewport();
};

App.editTargets = function () {
  const e = App.state.edit;
  if (!e) return [];
  if (e.type === 'bg') return App.state.bg.image ? [App.state.bg.image] : [];
  if (e.type === 'multi') return (e.ids || []).map(id => App.findLayer(id)).filter(Boolean);
  const l = App.findLayer(e.id);
  return l ? [l] : [];
};

App.serializeLayer = function (layer, forClipboard) {
  const slim = {
    kind: layer.kind, name: layer.name, color: layer.color,
    opacity: layer.opacity, x: layer.x, y: layer.y, w: layer.w, h: layer.h,
    sx: layer.sx, sy: layer.sy, rot: layer.rot, skew: layer.skew,
    flipH: !!layer.flipH, flipV: !!layer.flipV, isMask: !!layer.isMask,
    symbolKey: layer.symbolKey, patternKey: layer.patternKey
  };
  if (forClipboard) {
    if (layer.kind === 'symbol') slim.dataUri = layer.dataUri;
    if (layer.kind === 'import') slim.importMarkup = layer.innerEl ? layer.innerEl.innerHTML : (layer.importMarkup || '');
  }
  if (layer.kind === 'merged' && layer.children) {
    slim.children = layer.children.map(ch => App.serializeLayer(ch, forClipboard));
  }
  return slim;
};
App.normalizeSymbolSize = function (layer) {
  if (!layer || layer.kind !== 'symbol' || !layer.symbolKey) return false;
  if (!App.symbolMap || !App.symbolMap.get) return false;
  const sym = App.symbolMap.get(layer.symbolKey);
  if (!sym || !(sym.w > 0) || !(sym.h > 0)) return false;
  const oldW = Number(layer.w), oldH = Number(layer.h);
  if (Number.isFinite(oldW) && Math.abs(oldW - sym.w) < 1e-6 &&
      Number.isFinite(oldH) && Math.abs(oldH - sym.h) < 1e-6) return false;
  if (Number.isFinite(oldW) && oldW > 0 && Number.isFinite(oldH) && oldH > 0) {
    layer.sx = (Number(layer.sx) || 1) * (oldW / sym.w);
    layer.sy = (Number(layer.sy) || 1) * (oldH / sym.h);
  }
  layer.w = sym.w;
  layer.h = sym.h;
  return true;
};

App.deserializeLayer = function (slim) {
  const l = App.newLayer({
    kind: slim.kind, name: slim.name, color: slim.color, opacity: slim.opacity,
    x: slim.x, y: slim.y, w: slim.w, h: slim.h, sx: slim.sx, sy: slim.sy,
    rot: slim.rot, skew: slim.skew, flipH: slim.flipH, flipV: slim.flipV,
    isMask: slim.isMask, symbolKey: slim.symbolKey,
    patternKey: slim.patternKey, dataUri: slim.dataUri, importMarkup: slim.importMarkup
  });
  App.normalizeSymbolSize(l);
  if (slim.kind === 'merged' && slim.children) {
    l.children = slim.children.map(ch => App.deserializeLayer(ch));
  }
  return l;
};

App.deserializeLayersDetached = function (slims, prefix) {
  let next = 0;
  const idPrefix = String(prefix || 'detached_').replace(/[^A-Za-z0-9_-]/g, '_');
  const build = function (slim) {
    slim = slim || {};
    const layer = {
      id: idPrefix + (++next),
      kind: slim.kind || 'symbol',
      name: slim.name || App.i18n.t('name.pattern'),
      color: slim.color !== undefined ? slim.color : '#ffffff',
      opacity: slim.opacity !== undefined ? slim.opacity : 1,
      x: slim.x || 0, y: slim.y || 0,
      w: slim.w || 128, h: slim.h || 128,
      sx: slim.sx || 1, sy: slim.sy || 1,
      rot: slim.rot || 0, skew: slim.skew || 0,
      flipH: !!slim.flipH, flipV: !!slim.flipV,
      isMask: !!slim.isMask,
      symbolKey: slim.symbolKey || null,
      patternKey: slim.patternKey || null,
      dataUri: slim.dataUri || null,
      importMarkup: slim.importMarkup || null,
      children: null,
      el: null, maskEl: null, rectEl: null, innerEl: null,
      patDefEl: null, patBaseRect: null, patStroke: null,
      thumbDirty: true, thumbCache: null,
      _detachedRender: true
    };
    if (layer.kind === 'symbol' && !layer.dataUri && layer.symbolKey) {
      const sym = App.symbolMap && App.symbolMap.get(layer.symbolKey);
      if (sym) layer.dataUri = App.symbolUri(sym);
    }
    App.normalizeSymbolSize(layer);
    if (layer.kind === 'merged') layer.children = (slim.children || []).map(build);
    return layer;
  };
  return (slims || []).map(build);
};

App.selectedItems = function () {
  return Array.from(App.state.selected).map(id => App.findLayer(id)).filter(Boolean);
};
App.markThumbDirty = function (layer) {
  layer.thumbDirty = true;
  if (layer.kind === 'merged' && layer.children) layer.children.forEach(ch => App.markThumbDirty(ch));
};

App.snapshotSlim = function (layer) {
  const slim = App.serializeLayer(layer, false);
  const addMarkup = (s, orig) => {
    if (s.kind === 'import') s.importMarkup = orig.innerEl ? orig.innerEl.innerHTML : (orig.importMarkup || '');
    if (s.kind === 'merged' && s.children && orig.children) {
      s.children.forEach((c, i) => addMarkup(c, orig.children[i]));
    }
  };
  addMarkup(slim, layer);
  return slim;
};
App.relinkSymbolData = function (layer) {
  if (layer.kind === 'symbol' && !layer.dataUri && layer.symbolKey) {
    const sym = App.symbolMap.get(layer.symbolKey);
    if (sym) {
      layer.dataUri = App.symbolUri(sym);
      const hasW = Number.isFinite(Number(layer.w)) && Number(layer.w) > 0;
      const hasH = Number.isFinite(Number(layer.h)) && Number(layer.h) > 0;
      if (!hasW) layer.w = sym.w;
      if (!hasH) layer.h = sym.h;
    }
  }
  if (layer.kind === 'merged' && layer.children) layer.children.forEach(App.relinkSymbolData);
};
