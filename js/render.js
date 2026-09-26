'use strict';
App.viewRevision = App.viewRevision || 0;
App.renderPerfCounters = App.renderPerfCounters || {
  viewCommits: 0, autoVisibleScans: 0, autoVisibleLeaves: 0,
  autoBakeStarts: 0, autoBakeCancels: 0, autoBakeInstalls: 0
};
App.renderTaskTrace = App.renderTaskTrace || [];
App.traceRenderTask = function (kind, event, detail) {
  const rec = Object.assign({
    t: Math.round(performance.now() * 10) / 10,
    kind: kind, event: event
  }, detail || {});
  App.renderTaskTrace.push(rec);
  if (App.renderTaskTrace.length > 200) App.renderTaskTrace.splice(0, App.renderTaskTrace.length - 200);
  return rec;
};
App.initRender = function () {
  App.wrap = $('#canvasWrap');
  App.svg = $('#canvas');
  App.defs = $('#appDefs');
  App.gridRect = $('#gridRect');
  App.bgG = $('#bgG');
  App.layersRoot = $('#layersRoot');
  App.outlineG = $('#outlineG');
  App.handleG = $('#handleG');
  App.anchorG = $('#anchorG');
  App.flashG = $('#flashG');
  App.autoStaticFlashG = svgEl('g', { 'pointer-events': 'none' });
  App.flashG.parentNode.insertBefore(App.autoStaticFlashG, App.flashG);
  try { App.flashG.style.setProperty('--sve-flash-color', 'rgb(255,250,1)'); }
  catch (e) { console.warn('[render] 闪动颜色初始化失败', e); }
  App.overlayG = $('#overlayG');
  App.outlinePolys = [];
  App.handleEls = [];
  App.buildGridPattern();
  App.hiddenThumbHost = svgEl('svg', { style: 'display:none' });
  document.body.appendChild(App.hiddenThumbHost);
  window.addEventListener('resize', function () {
    if (App.noteRenderResize) App.noteRenderResize();
  }, true);
};

App.buildGridPattern = function () {
  const p = svgEl('pattern', { id: 'sveGridP', width: 20, height: 20, patternUnits: 'userSpaceOnUse' });
  App.gridPath = svgEl('path', { d: 'M 20 0 L 0 0 0 20', fill: 'none', stroke: 'rgba(0,0,0,0.20)' });
  p.appendChild(App.gridPath);
  App.defs.appendChild(p);
};
App.updateGridStroke = function () {
  if (!App.gridPath) return;
  App.gridPath.setAttribute('stroke', App.state.bg.base === 'light' ? 'rgba(0,0,0,0.20)' : 'rgba(255,255,255,0.16)');
};
App.updateGridRect = function () {
  const v = App.state.view, w = App.wrap.clientWidth, h = App.wrap.clientHeight;
  App.gridRect.setAttribute('x', v.x - 4);
  App.gridRect.setAttribute('y', v.y - 4);
  App.gridRect.setAttribute('width', w / v.scale + 8);
  App.gridRect.setAttribute('height', h / v.scale + 8);
};
App.updateView = function () {
  App.viewRevision = (App.viewRevision || 0) + 1;
  App.renderPerfCounters.viewCommits++;
  App._viewMutT = performance.now();
  if (App.layersRoot && App.layersRoot.style.display === 'none' && !(App.state && App.state.batching) &&
      !(App.state && App.state.layersHidden) && !(App.state && App.state.eyeMode === 'bg')) {
    App.layersRoot.style.display = '';
  }
  const r = App.wrap.getBoundingClientRect();
  const v = App.state.view;
  App.svg.setAttribute('viewBox', v.x + ' ' + v.y + ' ' + (r.width / v.scale) + ' ' + (r.height / v.scale));
  App.updateGridRect();
  if (App.updateEditStaticViewport) App.updateEditStaticViewport();
  if (App.maybeUpgradeProxyRes) App.maybeUpgradeProxyRes();
  if (App.autoStaticMaybe) App.autoStaticMaybe();
  try {
    if (App.Tabs && App.Tabs.current && App.Tabs.current.data) {
      App.Tabs.current.data.view = { x: App.state.view.x, y: App.state.view.y, scale: App.state.view.scale };
    }
  } catch (e) { /* ignore */ }
  const _am = App.state.editMode;
  if (App.drawAnchorIcon && (_am === 'size' || _am === 'rotate' || _am === 'skew')) App.drawAnchorIcon();
};

App.screenToDoc = function (clientX, clientY) {
  const p = new DOMPoint(clientX, clientY).matrixTransform(App.svg.getScreenCTM().inverse());
  return { x: p.x, y: p.y };
};
App.docToScreen = function (x, y) {
  const p = new DOMPoint(x, y).matrixTransform(App.svg.getScreenCTM());
  return { x: p.x, y: p.y };
};

App.getItemDocBBox = function (item) {
  if (item.kind === 'merged') {
    if (item._localBB === undefined) {
      const bb0 = item.el.getBBox();
      if (bb0 && bb0.width && bb0.height) {
        item._localBB = {
          pts: [[bb0.x, bb0.y], [bb0.x + bb0.width, bb0.y], [bb0.x + bb0.width, bb0.y + bb0.height], [bb0.x, bb0.y + bb0.height]]
        };
      } else {
        item._localBB = null;
      }
    }
    const loc = item._localBB;
    if (loc) {
      let m = null;
      try { m = App.transformChainMat(item); } catch (e) { m = null; }
      if (m) {
        let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
        const corners = loc.pts.map(p => {
          const q = new DOMPoint(p[0], p[1]).matrixTransform(m);
          minx = Math.min(minx, q.x); miny = Math.min(miny, q.y);
          maxx = Math.max(maxx, q.x); maxy = Math.max(maxy, q.y);
          return { x: q.x, y: q.y };
        });
        return {
          x: minx, y: miny, w: maxx - minx, h: maxy - miny,
          cx: (minx + maxx) / 2, cy: (miny + maxy) / 2, corners
        };
      }
    }
  }
  if (item.kind === 'merged') {
    const lb = App.computeLocalBBox(item);
    const cs = [[lb.x, lb.y], [lb.x + lb.w, lb.y], [lb.x + lb.w, lb.y + lb.h], [lb.x, lb.y + lb.h]]
      .map(p => {
        const q = tfPoint(p[0], p[1], item);
        return { x: q[0] + item.x, y: q[1] + item.y };
      });
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    cs.forEach(p => {
      minx = Math.min(minx, p.x); miny = Math.min(miny, p.y);
      maxx = Math.max(maxx, p.x); maxy = Math.max(maxy, p.y);
    });
    return {
      x: minx, y: miny, w: maxx - minx, h: maxy - miny,
      cx: (minx + maxx) / 2, cy: (miny + maxy) / 2, corners: cs
    };
  }
  return App.modelBBox(item);
};

App.modelBBox = function (item) {
  const hw = (item.w || 0) / 2, hh = (item.h || 0) / 2;
  const cs = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  let pts;
  const el = item.el;
  const nested = el && el.parentNode && el.parentNode !== App.layersRoot && el.parentNode !== App.svg;
  if (nested) {
    const m = transformChainMat(item);
    pts = cs.map(p => {
      const q = new DOMPoint(p[0], p[1]).matrixTransform(m);
      return { x: q.x, y: q.y };
    });
  } else {
    pts = cs.map(p => {
      const q = tfPoint(p[0], p[1], item);
      return { x: q[0] + item.x, y: q[1] + item.y };
    });
  }
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  pts.forEach(p => {
    minx = Math.min(minx, p.x); miny = Math.min(miny, p.y);
    maxx = Math.max(maxx, p.x); maxy = Math.max(maxy, p.y);
  });
  return {
    x: minx, y: miny, w: maxx - minx, h: maxy - miny,
    cx: (minx + maxx) / 2, cy: (miny + maxy) / 2, corners: pts
  };
};

App.editStatic = { active: false, baking: false, items: [], bit: null, view: null, failedTop: null };
App.editStaticBgEl = null;

App.editStaticViewportRect = function () {
  const v = App.state.view;
  const r = App.wrap.getBoundingClientRect();
  const vw = r.width / (v.scale || 1), vh = r.height / (v.scale || 1);
  const padX = vw * 0.25, padY = vh * 0.25;
  return { x: v.x - padX, y: v.y - padY, w: vw + padX * 2, h: vh + padY * 2, scale: v.scale || 1 };
};
App.layerInRect = function (l, rc) {
  try {
    const b = l.kind === 'merged'
      ? App.getItemDocBBox(l)
      : (App.modelBBox ? App.modelBBox(l) : App.getItemDocBBox(l));
    return b.x < rc.x + rc.w && b.x + b.w > rc.x && b.y < rc.y + rc.h && b.y + b.h > rc.y;
  } catch (e) { return true; }
};

App.bakeLayerSourceKey = function (layer, size) {
  if (!layer) return 'none';
  const symbol = layer.symbolKey || (layer.dataUri
    ? (layer.dataUri.length + ':' + layer.dataUri.slice(0, 48) + ':' + layer.dataUri.slice(-32))
    : layer.id);
  if (layer.isMask && layer.kind !== 'import') {
    const theme = App.maskThemeKey ? App.maskThemeKey() : '';
    return 'mask:' + theme + ':' + layer.kind + ':' + symbol + ':' + (layer.patternKey || '') + ':' +
      (layer.w || 0) + 'x' + (layer.h || 0) + ':' + size;
  }
  if (layer.kind === 'symbol') return 'symbol:' + symbol + ':' + (layer.color || '#ffffff');
  if (layer.kind === 'pattern') return 'pattern:' + (layer.patternKey || '') + ':' + (layer.color || '#ffffff') + ':' + size;
  return 'import:' + layer.id + ':' + size;
};
App.bakeLayerSource = function (layer, size, memo) {
  size = size || 256;
  if (layer && layer.isMask && layer.kind !== 'import') size = Math.max(size, 512);
  const key = App.bakeLayerSourceKey(layer, size);
  if (memo && memo.has(key)) return memo.get(key);
  let source;
  try {
    if (layer.kind === 'symbol' && !layer.dataUri && layer.symbolKey && App.relinkSymbolData) App.relinkSymbolData(layer);
    if (layer.isMask && layer.kind !== 'import' && App.maskBakeUrl) source = App.maskBakeUrl(layer, size);
    else if (layer.kind === 'symbol') source = App.symbolColorUrl(layer);
    else if (layer.kind === 'pattern') source = Promise.resolve(App.patternThumbCanvas(layer.patternKey, layer.color || '#ffffff', size).toDataURL());
    else if (layer.kind === 'import') source = App.svgRasterThumb(layer, size);
    else source = Promise.resolve('');
  } catch (e) {
    console.warn('[bake] 取图失败', layer && layer.id, String(e && e.message || e).slice(0, 160));
    source = Promise.resolve('');
  }
  const result = Promise.resolve(source).catch(function (e) {
    console.warn('[bake] 异步取图失败', layer && layer.id, String(e && e.message || e).slice(0, 160));
    return '';
  });
  if (memo) memo.set(key, result);
  return result;
};

App.resolveBakeLayerSources = function (leaves, size, concurrency, shouldContinue) {
  leaves = leaves || [];
  size = size || 256;
  if (!leaves.length) return Promise.resolve([]);
  return new Promise(function (resolve) {
    const alive = typeof shouldContinue === 'function' ? shouldContinue : function () { return true; };
    let settled = false;
    const finish = function (value) { if (!settled) { settled = true; resolve(value); } };
    const keys = new Array(leaves.length);
    const unique = new Map();
    let i = 0;
    const collect = function () {
      if (!alive()) { finish([]); return; }
      if (App.renderInteractionBusy && App.renderInteractionBusy()) { setTimeout(collect, 60); return; }
      const t0 = performance.now();
      do {
        const layer = leaves[i];
        const actualSize = layer && layer.isMask && layer.kind !== 'import' ? Math.max(size, 512) : size;
        const key = App.bakeLayerSourceKey(layer, actualSize);
        keys[i] = key;
        if (!unique.has(key)) unique.set(key, { layer: layer, size: actualSize });
        i++;
      } while (i < leaves.length && performance.now() - t0 < 6);
      if (i < leaves.length) { setTimeout(collect, 0); return; }
      const entries = Array.from(unique.entries());
      const byKey = new Map();
      const requestedLimit = Number(concurrency);
      const defaultLimit = entries.length > 32 ? 4 : entries.length;
      const sourceLimit = Math.min(entries.length,
        Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.max(1, Math.floor(requestedLimit)) : defaultLimit);
      let sourceIndex = 0;
      let sourceDone = 0;
      const expand = function () {
        if (!alive()) { finish([]); return; }
        const urls = new Array(keys.length);
        let j = 0;
        const expandStep = function () {
          if (!alive()) { finish([]); return; }
          if (App.renderInteractionBusy && App.renderInteractionBusy()) { setTimeout(expandStep, 60); return; }
          const t1 = performance.now();
          do { urls[j] = byKey.get(keys[j]) || ''; j++; }
          while (j < keys.length && performance.now() - t1 < 6);
          if (j < keys.length) setTimeout(expandStep, 0);
          else finish(urls);
        };
        expandStep();
      };
      const pumpSources = function () {
        if (!alive()) { finish([]); return; }
        if (App.renderInteractionBusy && App.renderInteractionBusy()) { setTimeout(pumpSources, 60); return; }
        while (sourceIndex < entries.length && sourceIndex - sourceDone < sourceLimit) {
          const entry = entries[sourceIndex++];
          let source;
          try { source = App.bakeLayerSource(entry[1].layer, entry[1].size); }
          catch (e) {
            console.warn('[bake] 图源启动失败', entry[0], String(e && e.message || e).slice(0, 160));
            source = Promise.resolve('');
          }
          Promise.resolve(source).then(function (url) {
            if (settled) return;
            byKey.set(entry[0], url || '');
          }, function (e) {
            if (settled) return;
            console.warn('[bake] 单个图源解析失败', entry[0], String(e && e.message || e).slice(0, 160));
            byKey.set(entry[0], '');
          }).then(function () {
            if (settled) return;
            sourceDone++;
            if (sourceDone >= entries.length) expand();
            else pumpSources();
          });
        }
      };
      if (!entries.length) finish(new Array(leaves.length).fill(''));
      else pumpSources();
    };
    collect();
  });
};

/* Decode a large source set with a small, interaction-aware queue.  Creating
   thousands of Image elements in one Promise.all still blocks Chromium even
   when the canvas drawing itself is sliced. */
App.loadBakeImages = function (urls, warnLabel, shouldContinue) {
  const uniq = Array.from(new Set((urls || []).filter(Boolean)));
  if (!uniq.length) return Promise.resolve(new Map());
  const limit = uniq.length > 32 ? 8 : uniq.length;
  return new Promise(function (resolve) {
    const alive = typeof shouldContinue === 'function' ? shouldContinue : function () { return true; };
    let settled = false;
    const finish = function (value) { if (!settled) { settled = true; resolve(value); } };
    const byUrl = new Map();
    let next = 0, active = 0, done = 0;
    const pump = function () {
      if (!alive()) { finish(byUrl); return; }
      if (App.renderInteractionBusy && App.renderInteractionBusy()) { setTimeout(pump, 60); return; }
      while (next < uniq.length && active < limit) {
        const url = uniq[next++];
        active++;
        let task;
        try { task = loadImage(url); }
        catch (e) { task = Promise.reject(e); }
        Promise.resolve(task).then(function (img) {
          if (settled) return;
          byUrl.set(url, img || null);
        }, function (e) {
          if (settled) return;
          console.warn(warnLabel || '[bake] 图源解码失败', String(e && e.message || e).slice(0, 160));
          byUrl.set(url, null);
        }).then(function () {
          if (settled) return;
          active--; done++;
          if (done >= uniq.length) finish(byUrl);
          else pump();
        });
      }
    };
    pump();
  });
};

App.bakeEditStatic = function (items, viewport, shouldContinue) {
  const vis = viewport ? items.filter(l => App.layerInRect(l, viewport)) : items;
  const leaves = [];
  const walk = l => { if (l.kind === 'merged') (l.children || []).forEach(walk); else leaves.push(l); };
  vis.forEach(walk);
  if (!leaves.length) return Promise.resolve(null);
  const alive = typeof shouldContinue === 'function' ? shouldContinue : function () { return true; };
  const mats = new Array(leaves.length);
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  const CHUNK = 300;
  const BUDGET = 8, MIN_CHUNK = 8;
  return new Promise(resolve => {
    let settled = false;
    const finishResult = function (value) { if (!settled) { settled = true; resolve(value); } };
    let mi = 0;
    let i = 0;
    const matrixStep = () => {
      if (!alive()) { finishResult(null); return; }
      if (App.renderInteractionBusy && App.renderInteractionBusy()) { setTimeout(matrixStep, 60); return; }
      const t0 = performance.now();
      let n = 0;
      while (mi < leaves.length && (n < MIN_CHUNK || performance.now() - t0 < BUDGET)) {
        mats[mi] = transformChainMat(leaves[mi]);
        mi++; n++;
      }
      if (mi < leaves.length) { setTimeout(matrixStep, 0); return; }
      bboxStep();
    };
    const bboxStep = () => {
      if (!alive()) { finishResult(null); return; }
      if (App.renderInteractionBusy && App.renderInteractionBusy()) { setTimeout(bboxStep, 60); return; }
      const end = Math.min(leaves.length, i + CHUNK);
      for (; i < end; i++) {
        const hw = (leaves[i].w || 0) / 2, hh = (leaves[i].h || 0) / 2;
        [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].forEach(p => {
          const r = new DOMPoint(p[0], p[1]).matrixTransform(mats[i]);
          minx = Math.min(minx, r.x); maxx = Math.max(maxx, r.x);
          miny = Math.min(miny, r.y); maxy = Math.max(maxy, r.y);
        });
      }
      if (i < leaves.length) { setTimeout(bboxStep, 0); return; }
      if (!isFinite(minx)) { finishResult(null); return; }
      const bx = viewport ? viewport.x : minx;
      const by = viewport ? viewport.y : miny;
      const bw = viewport ? viewport.w : Math.max(1, maxx - minx);
      const bh = viewport ? viewport.h : Math.max(1, maxy - miny);
      let f;
      if (viewport) {
        const dpr = window.devicePixelRatio || 1;
        const target = (App.state.view.scale || 1) * dpr;
        f = Math.min(target, 4096 / Math.max(bw, bh));
      } else {
        const scale = App.state.view.scale || 1;
        const dpr = window.devicePixelRatio || 1;
        const target = Math.max(1024, Math.ceil(Math.max(bw, bh) * scale * dpr));
        f = Math.min(1, Math.min(target, 4096) / Math.max(bw, bh));
      }
      const cw = Math.max(1, Math.round(bw * f)), ch = Math.max(1, Math.round(bh * f));
      const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
      const cx = cv.getContext('2d');
      App.resolveBakeLayerSources(leaves, 256, undefined, alive).then(urls => {
        if (!alive() || urls.length !== leaves.length) { finishResult(null); return; }
        const uniq = Array.from(new Set(urls.filter(Boolean)));
        App.loadBakeImages(uniq, '[bake] 编辑静态图源解码失败', alive).then(byUrl => {
          if (!alive()) { finishResult(null); return; }
          const images = urls.map(function (url) { return url ? (byUrl.get(url) || null) : null; });
          const tree = App.prepareBakeTree(vis, leaves, mats);
          const ready = App.bakeDrawableItems(vis, tree, images);
          App.drawBakeTree(cx, ready.items, {
            tree: tree, images: images, mats: mats, f: f,
            rootRect: { x: bx, y: by, w: bw, h: bh }, shouldContinue: alive
          }).then(function (drawn) {
            if (!drawn || !alive()) { finishResult(null); return; }
            finishResult({ url: cv.toDataURL(), x: bx, y: by, w: bw, h: bh, f: f, failedTop: ready.failedTop });
          });
        }).catch(e => { console.warn('[bake] 编辑静态图源加载失败', String(e && e.message || e).slice(0, 160)); finishResult(null); });
      }).catch(e => { console.warn('[bake] 编辑静态取图失败', String(e && e.message || e).slice(0, 160)); finishResult(null); });
    };
    matrixStep();
  });
};
App.beginEditStatic = function () {
  const s = App.state;
  if (!s.edit || s.edit.type === 'bg') return;
  if (App.state.eyeMode) return;
  const targets = App.editTargets();
  if (App.editStatic.active) {
    const before = App.editStatic.items.length;
    App.editStatic.items = App.editStatic.items.filter(l => !targets.includes(l));
    if (App.editStatic.items.length !== before) {
      App.editStatic.view = null;
      App.editStatic.bit = null;
      App.editStatic.failedTop = null;
      App.editStatic._bakedInterMin = undefined;
      if (App.editStaticBgEl) {
        App.editStaticBgEl.style.display = 'none';
        App.editStaticBgEl.removeAttribute('href');
      }
      App.rebakeEditStaticViewport();
    }
    targets.forEach(l => App.restoreEsVisibility(l));
    return;
  }
  if (App.editStatic.baking) return;
  targets.forEach(l => App.restoreEsVisibility(l));
  const items = s.layers.filter(l => !targets.includes(l));
  if (!items.length) return;
  App.editStatic.active = true;
  App.editStatic.items = items;
  App.editStatic.view = null;
  App.rebakeEditStaticViewport();
};
App.endEditStatic = function () {
  if (!App.editStatic.active && !App.editStatic.baking) return;
  App.editStatic.active = false;
  App.editStatic.baking = false;
  App.editStatic.items = [];
  App.editStatic.bit = null;
  App.editStatic.view = null;
  App.editStatic.failedTop = null;
  App.editStatic._bakedInterMin = undefined;
  if (App._editStaticViewTimer) { clearTimeout(App._editStaticViewTimer); App._editStaticViewTimer = null; }
  if (App.editStaticBgEl) {
    App.editStaticBgEl.style.display = 'none';
    App.editStaticBgEl.removeAttribute('href');
  }
  if (App.editStaticStageEl) {
    if (App.editStaticStageEl.isConnected) App.editStaticStageEl.remove();
    App.editStaticStageEl = null;
  }
  try { (App.state.layers || []).forEach(l => App.restoreEsVisibility(l)); } catch (e) { /* ignore */ }
};
App.setEsHidden = function (l, hide) {
  if (!l || !l.el) return;
  if (hide) {
    if (l.el.getAttribute('visibility') === 'hidden' && l._esPrevVis !== undefined) return;
    if (l._esPrevVis === undefined) l._esPrevVis = l.el.getAttribute('visibility');
    l.el.setAttribute('visibility', 'hidden');
  } else {
    if (l._esPrevVis === undefined) return;
    if (l._esPrevVis === null) l.el.removeAttribute('visibility');
    else l.el.setAttribute('visibility', l._esPrevVis);
    delete l._esPrevVis;
  }
};
App.restoreEsVisibility = function (l) { App.setEsHidden(l, false); };

App.setAutoStaticHidden = function (l, hide) {
  if (!l || !l.el) return;
  if (hide) {
    if (l._asPrevDisplay === undefined) l._asPrevDisplay = l.el.style.display || '';
    l.el.style.display = 'none';
  } else {
    if (l._asPrevDisplay === undefined) return;
    l.el.style.display = l._asPrevDisplay;
    delete l._asPrevDisplay;
  }
};
App.restoreAutoStaticDisplay = function (l) { App.setAutoStaticHidden(l, false); };

App.autoStatic = { active: false, baking: false, bit: null, view: null, token: 0, hiding: [], url: null, flashUrls: null, contentRevision: null };
App.autoStaticBgEl = null;
App.autoStaticFlashPair = null;
App.autoStaticLayerThreshold = 300;
App.renderPointerActive = false;
App.renderInteractionUntil = 0;
App.renderResizeUntil = 0;
App.noteRenderInteraction = function (active) {
  if (typeof active === 'boolean') App.renderPointerActive = active;
  App.renderInteractionUntil = performance.now() + 180;
  if (!App.renderPointerActive && App.autoStaticEnabled) {
    if (App._renderIdleTimer) clearTimeout(App._renderIdleTimer);
    App._renderIdleTimer = setTimeout(function () {
      App._renderIdleTimer = null;
      if (App.autoStaticMaybe) App.autoStaticMaybe();
      if (App.editStatic && App.editStatic.active && App.rebakeEditStaticViewport) App.rebakeEditStaticViewport();
    }, 190);
  }
};
App.noteRenderResize = function () {
  const until = performance.now() + 500;
  App.renderResizeUntil = Math.max(App.renderResizeUntil || 0, until);
  if (App._renderIdleTimer) clearTimeout(App._renderIdleTimer);
  App._renderIdleTimer = setTimeout(function () {
    App._renderIdleTimer = null;
    if (App.autoStaticMaybe) App.autoStaticMaybe();
    if (App.editStatic && App.editStatic.active && App.rebakeEditStaticViewport) App.rebakeEditStaticViewport();
  }, 520);
};
App.renderInteractionBusy = function () {
  const now = performance.now();
  return !!App.renderPointerActive || now < (App.renderInteractionUntil || 0) || now < (App.renderResizeUntil || 0);
};
App.autoStaticViewportPad = 1.0;
App.autoStaticEnabled = true;

App.autoStaticLeafCount = function () {
  let n = 0;
  const layers = App.state.layers || [];
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    n += (l.kind === 'merged' && App.countInLayer) ? App.countInLayer(l) : 1;
  }
  return n;
};
App.autoStaticNeeded = function () {
  const layers = App.state.layers || [];
  const prof = App._proxyBake;
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    if (l.kind === 'merged' && prof && prof.has(l.id)) continue;
    return true;
  }
  return false;
};
App.autoStaticEligible = function () {
  if (App.editStatic && App.editStatic.active) return false;
  if (!App.autoStaticEnabled) return false;
  if (!App.state.layers || !App.state.layers.length) return false;
  if (App.state.edit) return false;
  if (App.state.eyeMode) return false;
  if (App.state.layersHidden) return false;
  if (App.state.batching) return false;
  if (App._colorYield) return false;
  if (!App.autoStaticNeeded()) return false;
  return App.autoStaticVisibleLeafCount() >= App.autoStaticLayerThreshold;
};
App.autoStaticVisibleLeafCount = function () {
  const layers = App.state.layers || [];
  if (!layers.length) return 0;
  const vp = App.autoStaticViewportRect();
  let n = 0;
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    let inside = true;
    try { inside = App.layerInRect(l, vp); } catch (e) { inside = true; }
    if (!inside) continue;
    n += 1;
    if (l.kind === 'merged' && App.countInLayer) n += App.countInLayer(l) - 1;
  }
  App.renderPerfCounters.autoVisibleScans++;
  App.renderPerfCounters.autoVisibleLeaves += n;
  return n;
};
App.autoStaticContentBBox = function () {
  const layers = App.state.layers || [];
  if (!layers.length) return null;
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (let i = 0; i < layers.length; i++) {
    try {
      const b = App.getItemDocBBox(layers[i]);
      if (!b || !isFinite(b.x + b.w)) continue;
      minx = Math.min(minx, b.x); miny = Math.min(miny, b.y);
      maxx = Math.max(maxx, b.x + b.w); maxy = Math.max(maxy, b.y + b.h);
    } catch (e) { /* ignore */ }
  }
  if (!isFinite(minx)) return null;
  return { minx: minx, miny: miny, maxx: maxx, maxy: maxy };
};
App.autoStaticViewportRect = function (pad) {
  const v = App.state.view;
  const r = App.wrap.getBoundingClientRect();
  const sc = v.scale || 1;
  const vw = r.width / sc, vh = r.height / sc;
  const p = (typeof pad === 'number') ? pad : 0.5;
  let x = v.x - vw * p, y = v.y - vh * p, w = vw * (1 + p * 2), h = vh * (1 + p * 2);
  try {
    const b = App.autoStaticContentBBox();
    if (b) {
      const x2 = Math.max(x, b.minx), y2 = Math.max(y, b.miny);
      const x3 = Math.min(x + w, b.maxx), y3 = Math.min(y + h, b.maxy);
      if (x3 > x2 && y3 > y2) { x = x2; y = y2; w = x3 - x2; h = y3 - y2; }
    }
  } catch (e) { /* ignore */ }
  return { x: x, y: y, w: w, h: h, scale: sc };
};

App.autoStaticRectF = function (rect) {
  const dpr = window.devicePixelRatio || 1;
  const byScreen = (App.state.view.scale || 1) * dpr;
  const byCap = 4096 / Math.max(rect.w, rect.h);
  return Math.min(byScreen, byCap);
};
App.bakeOpacity = function (layer) {
  const n = Number(layer && layer.opacity);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
};

App.prepareBakeTree = function (items, leaves, mats) {
  const leafIndex = new Map();
  (leaves || []).forEach(function (leaf, i) { leafIndex.set(leaf, i); });
  const bounds = new Map();
  const union = function (a, b) {
    if (!a) return b;
    if (!b) return a;
    const x1 = Math.min(a.x, b.x), y1 = Math.min(a.y, b.y);
    const x2 = Math.max(a.x + a.w, b.x + b.w), y2 = Math.max(a.y + a.h, b.y + b.h);
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  };
  const visit = function (node) {
    if (!node) return null;
    let b = null;
    if (node.kind === 'merged') {
      (node.children || []).forEach(function (ch) { b = union(b, visit(ch)); });
    } else {
      const i = leafIndex.get(node);
      const m = i === undefined ? null : mats[i];
      if (m) {
        const hw = Math.abs(node.w || 0) / 2, hh = Math.abs(node.h || 0) / 2;
        const ex = Math.abs(m.a) * hw + Math.abs(m.c) * hh;
        const ey = Math.abs(m.b) * hw + Math.abs(m.d) * hh;
        b = { x: m.e - ex, y: m.f - ey, w: ex * 2, h: ey * 2 };
      }
    }
    bounds.set(node, b);
    return b;
  };
  (items || []).forEach(visit);
  return { leafIndex: leafIndex, bounds: bounds };
};

App.bakeDrawableItems = function (items, tree, images) {
  const failedTop = new Set();
  const drawable = [];
  (items || []).forEach(function (top) {
    let failed = false;
    (function check(node) {
      if (!node || failed) return;
      if (node.kind === 'merged') (node.children || []).forEach(check);
      else {
        const i = tree.leafIndex.get(node);
        if (i === undefined || !images[i]) failed = true;
      }
    })(top);
    if (failed) failedTop.add(top.id);
    else drawable.push(top);
  });
  return { items: drawable, failedTop: failedTop };
};

App.drawBakeTree = function (ctx, items, options) {
  options = options || {};
  const tree = options.tree;
  const images = options.images || [];
  const mats = options.mats || [];
  const f = options.f || 1;
  const root = options.rootRect || { x: 0, y: 0, w: 1, h: 1 };
  const alive = typeof options.shouldContinue === 'function' ? options.shouldContinue : function () { return true; };
  let sliceStart = performance.now();
  const clip = function (b) {
    if (!b) return null;
    const x1 = Math.max(root.x, b.x), y1 = Math.max(root.y, b.y);
    const x2 = Math.min(root.x + root.w, b.x + b.w), y2 = Math.min(root.y + root.h, b.y + b.h);
    return x2 > x1 && y2 > y1 ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : null;
  };
  const waitForBudget = function () {
    if (!alive()) return Promise.resolve(false);
    const busy = App.renderInteractionBusy && App.renderInteractionBusy();
    if (!busy && performance.now() - sliceStart < 8) return null;
    return new Promise(function (resolve) {
      const resume = function () {
        if (!alive()) { resolve(false); return; }
        if (App.renderInteractionBusy && App.renderInteractionBusy()) { setTimeout(resume, 60); return; }
        setTimeout(function () { sliceStart = performance.now(); resolve(alive()); }, 0);
      };
      resume();
    });
  };
  const drawNodes = async function (nodes, target, origin) {
    for (let ni = 0; ni < nodes.length; ni++) {
      if (!alive()) return false;
      const node = nodes[ni];
      if (!node) continue;
      if (node.kind === 'merged') {
        const opacity = App.bakeOpacity(node);
        if (opacity <= 0) continue;
        const children = node.children || [];
        if (opacity >= 0.999999) {
          if (!(await drawNodes(children, target, origin))) return false;
        } else {
          const b = clip(tree.bounds.get(node));
          if (!b) continue;
          const scratch = document.createElement('canvas');
          scratch.width = Math.max(1, Math.ceil(b.w * f));
          scratch.height = Math.max(1, Math.ceil(b.h * f));
          const sc = scratch.getContext('2d');
          if (!sc || !(await drawNodes(children, sc, b))) return false;
          if (!alive()) return false;
          target.save();
          target.setTransform(1, 0, 0, 1, 0, 0);
          target.globalCompositeOperation = 'source-over';
          target.globalAlpha = opacity;
          target.drawImage(scratch, (b.x - origin.x) * f, (b.y - origin.y) * f);
          target.restore();
          scratch.width = 1; scratch.height = 1;
        }
      } else {
        const i = tree.leafIndex.get(node);
        const img = i === undefined ? null : images[i];
        const m = i === undefined ? null : mats[i];
        if (!img || !m) continue;
        target.save();
        const T = new DOMMatrix().translate(-origin.x * f, -origin.y * f).scale(f).multiply(m);
        target.setTransform(T.a, T.b, T.c, T.d, T.e, T.f);
        target.globalCompositeOperation = 'source-over';
        target.globalAlpha = App.bakeOpacity(node);
        target.drawImage(img, 0, 0, img.width, img.height,
          -(node.w || 0) / 2, -(node.h || 0) / 2, node.w || 0, node.h || 0);
        target.restore();
      }
      const wait = waitForBudget();
      if (wait && !(await wait)) return false;
    }
    return alive();
  };
  return drawNodes(items || [], ctx, { x: root.x, y: root.y });
};
App.autoStaticNeedF = function () {
  const dpr = window.devicePixelRatio || 1;
  return (App.state.view.scale || 1) * dpr;
};
App.autoStaticViewSig = function () {
  const v = App.state.view;
  const r = App.wrap.getBoundingClientRect();
  const sc = v.scale || 1;
  const step = Math.max(1, r.width / sc / 8);
  return Math.round(v.x / step) + '/' + Math.round(v.y / step) + '/' + Math.round(sc * 200);
};
App.revokeAutoStaticFlashUrls = function (urls) {
  if (!urls) return;
  ['yellow', 'blue'].forEach(function (key) {
    const url = urls[key];
    if (!url || url.indexOf('blob:') !== 0) return;
    try { URL.revokeObjectURL(url); }
    catch (e) { console.warn('[bake] 回收闪动剪影失败', key, String(e && e.message || e).slice(0, 120)); }
  });
};
App.removeAutoStaticFlashPair = function (pair) {
  if (!pair) return;
  if (pair.yellow) pair.yellow.style.opacity = '0';
  if (pair.blue) pair.blue.style.opacity = '0';
  if (pair.g && pair.g.parentNode) pair.g.parentNode.removeChild(pair.g);
};
App.autoStaticRelease = function () {
  App._autoStaticSig = null;
  if (!App.autoStatic.active && !App.autoStatic.baking && !(App.autoStatic.hiding || []).length &&
      !App.autoStaticFlashPair && !App.autoStatic.flashUrls) return;
  App.autoStatic.active = false;
  App.autoStatic.baking = false;
  App.autoStatic.token++;
  (App.autoStatic.hiding || []).forEach(function (l) { try { App.restoreAutoStaticDisplay(l); } catch (e) { /* ignore */ } });
  App.autoStatic.hiding = [];
  App.autoStatic.bit = null;
  App.autoStatic.view = null;
  App.autoStatic.contentRevision = null;
  App._autoStaticSig = null;
  if (App.autoStaticStageEl) {
    App.autoStaticStageEl.remove();
    App.autoStaticStageEl = null;
  }
  if (App.autoStatic.url) {
    try { URL.revokeObjectURL(App.autoStatic.url); }
    catch (e) { console.warn('[bake] 回收静态位图失败', String(e && e.message || e).slice(0, 120)); }
    App.autoStatic.url = null;
  }
  App.removeAutoStaticFlashPair(App.autoStaticFlashPair);
  App.autoStaticFlashPair = null;
  App.revokeAutoStaticFlashUrls(App.autoStatic.flashUrls);
  App.autoStatic.flashUrls = null;
  if (App.autoStaticBgEl) {
    App.autoStaticBgEl.style.display = 'none';
    App.autoStaticBgEl.removeAttribute('href');
  }
};
App.buildAutoStaticFlashUrls = function (source, shouldContinue) {
  if (!source || !source.width || !source.height) return Promise.resolve(null);
  const alive = typeof shouldContinue === 'function' ? shouldContinue : function () { return true; };
  if (!alive()) return Promise.resolve(null);
  const tinted = document.createElement('canvas');
  tinted.width = source.width;
  tinted.height = source.height;
  const cx = tinted.getContext('2d');
  const encode = function (color, label) {
    cx.globalCompositeOperation = 'source-over';
    cx.clearRect(0, 0, tinted.width, tinted.height);
    cx.drawImage(source, 0, 0);
    cx.globalCompositeOperation = 'source-in';
    cx.fillStyle = color;
    cx.fillRect(0, 0, tinted.width, tinted.height);
    cx.globalCompositeOperation = 'source-over';
    return new Promise(function (resolve) {
      if (!tinted.toBlob) {
        try { resolve(tinted.toDataURL('image/png')); }
        catch (e) { console.warn('[bake] 闪动剪影回退编码失败', label, String(e && e.message || e).slice(0, 120)); resolve(''); }
        return;
      }
      tinted.toBlob(function (blob) {
        if (!blob) { console.warn('[bake] 闪动剪影编码返回空', label); resolve(''); return; }
        try { resolve(URL.createObjectURL(blob)); }
        catch (e) { console.warn('[bake] 闪动剪影地址创建失败', label, String(e && e.message || e).slice(0, 120)); resolve(''); }
      }, 'image/png');
    });
  };
  let yellow = '';
  return encode('#FFFA01', 'yellow').then(function (url) {
    yellow = url;
    if (!alive()) {
      App.revokeAutoStaticFlashUrls({ yellow: yellow });
      yellow = '';
      return '';
    }
    return encode('#0402FF', 'blue');
  }).then(function (blue) {
    tinted.width = 1;
    tinted.height = 1;
    if (!alive() || !yellow || !blue) {
      App.revokeAutoStaticFlashUrls({ yellow: yellow, blue: blue });
      return null;
    }
    return { yellow: yellow, blue: blue };
  }).catch(function (e) {
    console.warn('[bake] 闪动剪影生成失败', String(e && e.message || e).slice(0, 160));
    App.revokeAutoStaticFlashUrls({ yellow: yellow });
    return null;
  });
};
App.bakeAutoStatic = function (items, viewport, shouldContinue) {
  const vis = viewport ? items.filter(function (l) { return App.layerInRect(l, viewport); }) : items;
  const leaves = [];
  const walk = function (l) { if (l.kind === 'merged') (l.children || []).forEach(walk); else leaves.push(l); };
  vis.forEach(walk);
  if (!leaves.length) return Promise.resolve(null);
  const alive = typeof shouldContinue === 'function' ? shouldContinue : function () { return true; };
  const mats = new Array(leaves.length);
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  const BUDGET = 8, MIN_CHUNK = 8;
  return new Promise(function (resolve) {
    let settled = false;
    const finishResult = function (value) { if (!settled) { settled = true; resolve(value); } };
    let mi = 0;
    let i = 0;
    const matrixStep = function () {
      if (!alive()) { finishResult(null); return; }
      if (App.renderInteractionBusy && App.renderInteractionBusy()) { setTimeout(matrixStep, 60); return; }
      const t0 = performance.now();
      let n = 0;
      while (mi < leaves.length && (n < MIN_CHUNK || performance.now() - t0 < BUDGET)) {
        mats[mi] = transformChainMat(leaves[mi]);
        mi++; n++;
      }
      if (mi < leaves.length) { setTimeout(matrixStep, 0); return; }
      bboxStep();
    };
    const bboxStep = function () {
      if (!alive()) { finishResult(null); return; }
      if (App.renderInteractionBusy && App.renderInteractionBusy()) { setTimeout(bboxStep, 60); return; }
      const t0 = performance.now();
      let n = 0;
      while (i < leaves.length && (n < MIN_CHUNK || performance.now() - t0 < BUDGET)) {
        const hw = (leaves[i].w || 0) / 2, hh = (leaves[i].h || 0) / 2;
        [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].forEach(function (p) {
          const r = new DOMPoint(p[0], p[1]).matrixTransform(mats[i]);
          minx = Math.min(minx, r.x); maxx = Math.max(maxx, r.x);
          miny = Math.min(miny, r.y); maxy = Math.max(maxy, r.y);
        });
        i++; n++;
      }
      if (i < leaves.length) { setTimeout(bboxStep, 0); return; }
      if (!isFinite(minx)) { finishResult(null); return; }
      const bx = viewport ? viewport.x : minx;
      const by = viewport ? viewport.y : miny;
      const bw = viewport ? viewport.w : Math.max(1, maxx - minx);
      const bh = viewport ? viewport.h : Math.max(1, maxy - miny);
      let f;
      if (viewport) {
        const dpr2 = window.devicePixelRatio || 1;
        f = Math.min((App.state.view.scale || 1) * dpr2, 4096 / Math.max(bw, bh));
      } else {
        const sc = App.state.view.scale || 1;
        const dpr2 = window.devicePixelRatio || 1;
        f = Math.min(1, Math.min(Math.max(1024, Math.ceil(Math.max(bw, bh) * sc * dpr2)), 4096) / Math.max(bw, bh));
      }
      const cw = Math.max(1, Math.round(bw * f)), ch = Math.max(1, Math.round(bh * f));
      const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
      const cx = cv.getContext('2d');
      App.resolveBakeLayerSources(leaves, 256, undefined, alive).then(function (urls) {
        if (!alive() || urls.length !== leaves.length) { finishResult(null); return; }
        const uniq = Array.from(new Set(urls.filter(Boolean)));
        App.loadBakeImages(uniq, '[bake] 自动静态图源解码失败', alive).then(function (byUrl) {
          if (!alive()) { finishResult(null); return; }
          const images = urls.map(function (url) { return url ? (byUrl.get(url) || null) : null; });
          const tree = App.prepareBakeTree(vis, leaves, mats);
          const ready = App.bakeDrawableItems(vis, tree, images);
          App.drawBakeTree(cx, ready.items, {
            tree: tree, images: images, mats: mats, f: f,
            rootRect: { x: bx, y: by, w: bw, h: bh }, shouldContinue: alive
          }).then(function (drawn) {
            if (!drawn || !alive()) { finishResult(null); return; }
            const finish = function (url) {
              if (!alive()) {
                if (url && url.indexOf('blob:') === 0) { try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } }
                finishResult(null);
                return;
              }
              const bit = { url: url, x: bx, y: by, w: bw, h: bh, f: f, failedTop: ready.failedTop, flashUrls: null };
              if (leaves.length <= 400 || !url) { finishResult(bit); return; }
              App.buildAutoStaticFlashUrls(cv, alive).then(function (urls) {
                if (!alive()) {
                  if (url && url.indexOf('blob:') === 0) { try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } }
                  if (urls) App.revokeAutoStaticFlashUrls(urls);
                  finishResult(null);
                  return;
                }
                bit.flashUrls = urls;
                finishResult(bit);
              });
            };
            if (cv.toBlob) {
              cv.toBlob(function (blob) {
                if (!blob) { finish(cv.toDataURL()); return; }
                try { finish(URL.createObjectURL(blob)); }
                catch (e) { console.warn('[bake] 静态图 URL 创建失败', String(e && e.message || e).slice(0, 120)); finish(''); }
              }, 'image/png');
            } else { finish(cv.toDataURL()); }
          }).catch(function (e) { console.warn('[bake] 自动静态绘制失败', String(e && e.message || e).slice(0, 160)); finishResult(null); });
        }).catch(function (e) { console.warn('[bake] 自动静态图源加载失败', String(e && e.message || e).slice(0, 160)); finishResult(null); });
      }).catch(function (e) { console.warn('[bake] 自动静态取图失败', String(e && e.message || e).slice(0, 160)); finishResult(null); });
    };
    matrixStep();
  });
};
App.autoStaticStructSig = function () {
  const L = App.state.layers || [];
  let s = String(L.length) + ':';
  for (let i = 0; i < L.length; i++) s += L[i].id + ',';
  return s;
};
App.autoStaticInstall = function (bit, token) {
  if (!bit || !bit.url) return Promise.resolve(false);
  if (App.autoStaticStageEl) App.autoStaticStageEl.remove();
  const oldEl = App.autoStaticBgEl;
  const oldUrl = App.autoStatic.url;
  const oldFlashPair = App.autoStaticFlashPair;
  const oldFlashUrls = App.autoStatic.flashUrls;
  const stage = svgEl('image', { 'pointer-events': 'none', preserveAspectRatio: 'none', class: 'sve-auto-static' });
  let flashPair = null;
  if (bit.flashUrls && App.autoStaticFlashG) {
    const g = svgEl('g', { 'pointer-events': 'none' });
    const make = function (href) {
      const el = svgEl('image', {
        href: href, x: bit.x, y: bit.y, width: bit.w, height: bit.h,
        preserveAspectRatio: 'none', opacity: 0, 'pointer-events': 'none'
      });
      el.style.willChange = 'opacity';
      g.appendChild(el);
      return el;
    };
    flashPair = { g: g, yellow: make(bit.flashUrls.yellow), blue: make(bit.flashUrls.blue), target: stage };
    App.autoStaticFlashG.appendChild(g);
  }
  App.autoStaticStageEl = stage;
  stage.setAttribute('x', bit.x);
  stage.setAttribute('y', bit.y);
  stage.setAttribute('width', bit.w);
  stage.setAttribute('height', bit.h);
  stage.style.visibility = 'hidden';
  App.layersRoot.insertBefore(stage, App.layersRoot.firstChild);
  return new Promise(function (resolve) {
    let settled = false;
    const clear = function () {
      stage.removeEventListener('load', ready);
      stage.removeEventListener('error', failed);
    };
    const failed = function () {
      if (settled) return;
      settled = true;
      clear();
      if (stage.isConnected) stage.remove();
      App.removeAutoStaticFlashPair(flashPair);
      if (App.autoStaticStageEl === stage) App.autoStaticStageEl = null;
      resolve(false);
    };
    const ready = function () {
      if (settled) return;
      settled = true;
      clear();
      requestAnimationFrame(function () { requestAnimationFrame(function () {
        if (token !== App.autoStatic.token || !stage.isConnected || App.autoStaticStageEl !== stage) {
          if (stage.isConnected) stage.remove();
          App.removeAutoStaticFlashPair(flashPair);
          if (App.autoStaticStageEl === stage) App.autoStaticStageEl = null;
          resolve(false);
          return;
        }
        const failedTop = bit.failedTop || new Set();
        const hiding = (App.state.layers || []).filter(function (l) { return !failedTop.has(l.id); });
        const hidingIds = new Set(hiding.map(function (l) { return l.id; }));
        stage.style.visibility = '';
        stage.style.display = '';
        if (oldEl && oldEl !== stage) oldEl.remove();
        if (oldFlashPair && oldFlashPair !== flashPair) App.removeAutoStaticFlashPair(oldFlashPair);
        App.autoStaticBgEl = stage;
        if (flashPair) flashPair.target = stage;
        App.autoStaticFlashPair = flashPair;
        App.autoStaticStageEl = null;
        App.autoStatic.url = bit.url.indexOf('blob:') === 0 ? bit.url : null;
        App.autoStatic.flashUrls = bit.flashUrls || null;
        (App.autoStatic.hiding || []).forEach(function (l) {
          if (!hidingIds.has(l.id)) { try { App.restoreAutoStaticDisplay(l); } catch (e) { console.warn('[bake] 恢复矢量层失败', l && l.id, String(e && e.message || e).slice(0, 120)); } }
        });
        hiding.forEach(function (l) { try { App.setAutoStaticHidden(l, true); } catch (e) { console.warn('[bake] 隐藏矢量层失败', l && l.id, String(e && e.message || e).slice(0, 120)); } });
        App.autoStatic.hiding = hiding;
        App.autoStatic.bit = bit;
        if (bit._view) {
          App.autoStatic.view = bit._view;
          delete bit._view;
        }
        App.autoStatic.active = true;
        if (oldUrl && oldUrl !== bit.url) setTimeout(function () { try { URL.revokeObjectURL(oldUrl); } catch (e) { console.warn('[bake] 回收旧位图失败', String(e && e.message || e).slice(0, 120)); } }, 0);
        if (oldFlashUrls && oldFlashUrls !== bit.flashUrls) {
          setTimeout(function () { App.revokeAutoStaticFlashUrls(oldFlashUrls); }, 0);
        }
        if (flashPair) {
          flashPair.yellow.style.opacity = '0.001';
          flashPair.blue.style.opacity = '0.001';
          requestAnimationFrame(function () { requestAnimationFrame(function () {
            if (flashPair.yellow) flashPair.yellow.style.opacity = '0';
            if (flashPair.blue) flashPair.blue.style.opacity = '0';
          }); });
        }
        resolve(true);
      }); });
    };
    stage.addEventListener('load', ready);
    stage.addEventListener('error', failed);
    stage.setAttribute('href', bit.url);
  });
};
App.autoStaticRebake = function () {
  if (App.autoStatic.baking) return;
  if (App.renderInteractionBusy && App.renderInteractionBusy()) { App.autoStaticSchedule(120); return; }
  if (!App.autoStaticEligible()) { App.autoStaticRelease(); return; }
  const needF = App.autoStaticNeedF();
  let rect = App.autoStaticViewportRect(0.5);
  let rectPad = 0.5;
  let f = App.autoStaticRectF(rect);
  if (f < needF * 0.8) {
    const rect2 = App.autoStaticViewportRect(0);
    const f2 = App.autoStaticRectF(rect2);
    if (f2 > f) { rect = rect2; rectPad = 0; f = f2; }
  }
  rect._f = f;
  rect._pad = rectPad;
  App.autoStatic.lastErr = null;
  App.autoStatic.baking = true;
  const token = ++App.autoStatic.token;
  const items = App.state.layers.slice();
  const contentRevision = App.contentRevision || 0;
  const structSig = App.autoStaticStructSig();
  const docId = App.Tabs && App.Tabs.current ? App.Tabs.current.id : null;
  const viewRevision = App.viewRevision || 0;
  App.renderPerfCounters.autoBakeStarts++;
  App.traceRenderTask('autoStatic', 'start', {
    docId: docId, contentRevision: contentRevision, viewRevision: viewRevision,
    generation: token, targets: items.map(function (l) { return l.id; }),
    rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h, f: rect._f, pad: rect._pad }
  });
  let __p = null;
  const shouldContinue = function () {
    const currentDocId = App.Tabs && App.Tabs.current ? App.Tabs.current.id : null;
    return token === App.autoStatic.token && contentRevision === (App.contentRevision || 0) &&
      structSig === App.autoStaticStructSig() && currentDocId === docId &&
      viewRevision === (App.viewRevision || 0);
  };
  try { __p = App.bakeAutoStatic(items, rect, shouldContinue); }
  catch (e) { App.autoStatic.baking = false; App.autoStatic.lastErr = 'bake-sync-throw: ' + String(e && e.message || e).slice(0, 120); return; }
  if (!__p || typeof __p.then !== 'function') { App.autoStatic.baking = false; App.autoStatic.lastErr = 'bake-not-promise'; return; }
  __p.then(function (bit) {
    const drop = function (why, releaseCurrent) {
      if (bit && bit.url && bit.url.indexOf('blob:') === 0) {
        try { URL.revokeObjectURL(bit.url); }
        catch (e) { console.warn('[bake] 回收废弃位图失败', String(e && e.message || e).slice(0, 120)); }
      }
      if (bit && bit.flashUrls) App.revokeAutoStaticFlashUrls(bit.flashUrls);
      if (token !== App.autoStatic.token) return;
      App.autoStatic.baking = false;
      App.autoStatic.lastErr = why;
      App.renderPerfCounters.autoBakeCancels++;
      App.traceRenderTask('autoStatic', 'cancel', {
        docId: docId, contentRevision: contentRevision, viewRevision: viewRevision,
        generation: token, reason: why
      });
      if (releaseCurrent && App.autoStatic.active) App.autoStaticRelease();
    };
    if (token !== App.autoStatic.token) { drop('superseded', false); return; }
    if (!bit) {
      drop('bake-returned-null', true);
      if (App.autoStaticEligible && App.autoStaticEligible()) App.autoStaticSchedule(80);
      return;
    }
    const install = function () {
      if (token !== App.autoStatic.token) { drop('superseded', false); return; }
      if (App.renderInteractionBusy && App.renderInteractionBusy()) { setTimeout(install, 60); return; }
      if (contentRevision !== (App.contentRevision || 0)) { drop('stale-content', true); App.autoStaticSchedule(); return; }
      if (structSig !== App.autoStaticStructSig()) { drop('stale-struct', true); App.autoStaticSchedule(); return; }
      if (viewRevision !== (App.viewRevision || 0)) { drop('stale-view', true); App.autoStaticSchedule(80); return; }
      if (!App.autoStaticEligible()) { drop('stale-ineligible', true); return; }
      const want = App.autoStaticViewportRect(0);
      if (!(rect.x <= want.x && rect.y <= want.y && (rect.x + rect.w) >= (want.x + want.w) && (rect.y + rect.h) >= (want.y + want.h))) {
        drop('stale-cover', true);
        App.autoStaticSchedule();
        return;
      }
      if (!(bit.f > 0) || bit.f < App.autoStaticNeedF() * 0.8) {
        drop('stale-quality', true);
        App.autoStaticSchedule(80);
        return;
      }
      if (typeof bit.f === 'number' && bit.f > 0) rect._f = bit.f;
      bit._view = rect;
      App.autoStaticInstall(bit, token).then(function (installed) {
        if (!installed) { drop('stage-failed', false); return; }
        if (token === App.autoStatic.token) {
          App.autoStatic.contentRevision = contentRevision;
          App.autoStatic.baking = false;
          App.renderPerfCounters.autoBakeInstalls++;
          App.traceRenderTask('autoStatic', 'install', {
            docId: docId, contentRevision: contentRevision, viewRevision: viewRevision,
            generation: token, f: bit.f, failedTop: bit.failedTop ? bit.failedTop.size : 0
          });
        }
      }).catch(function (e) {
        console.warn('[bake] 自动静态位图切换失败', String(e && e.message || e).slice(0, 160));
        drop('stage-throw', false);
      });
    };
    const preload = [loadImage(bit.url)];
    if (bit.flashUrls) {
      preload.push(loadImage(bit.flashUrls.yellow));
      preload.push(loadImage(bit.flashUrls.blue));
    }
    Promise.all(preload).then(install).catch(function (e) {
      console.warn('[bake] 自动静态位图预解码失败', String(e && e.message || e).slice(0, 160));
      drop('decode-failed', true);
    });
  }).catch(function (e) { App.autoStatic.baking = false; App.autoStatic.lastErr = 'bake-throw: ' + String(e && e.message || e).slice(0, 120); });
};

App.autoStaticSchedule = function (delay) {
  if (App._autoStaticTimer) clearTimeout(App._autoStaticTimer);
  App._autoStaticTimer = setTimeout(function () {
    App._autoStaticTimer = null;
    if (App.renderInteractionBusy && App.renderInteractionBusy()) { App.autoStaticSchedule(120); return; }
    App.autoStaticRebake();
  }, typeof delay === 'number' ? delay : 280);
};
App.autoStaticMaybe = function () {
  if (!App.autoStaticEnabled) return;
  const nowTs = Date.now();
  const gap = nowTs - (App.autoStaticLastCheck || 0);
  if (gap < 60) {
    if (!App._autoStaticTrailTimer) {
      App._autoStaticTrailTimer = setTimeout(function () {
        App._autoStaticTrailTimer = null;
        App.autoStaticMaybe();
      }, 61 - gap);
    }
    return;
  }
  App.autoStaticLastCheck = nowTs;
  if (App.autoStatic.baking) {
    if (!App.autoStaticEligible()) { App.autoStaticRelease(); return; }
    return;
  }
  if (!App.autoStaticEligible()) { if (App.autoStatic.active) App.autoStaticRelease(); return; }
  if (!App.autoStatic.active || !App.autoStatic.view) { App.autoStaticRebake(); return; }
  const v = App.autoStatic.view;
  /* Coverage must use the same pad as the installed bake. A bake narrowed to
     pad=0 for resolution is valid for the current viewport and should not be
     rejected against a larger pad=0.5 rectangle on every check. */
  const pad = (v && v._pad !== undefined) ? v._pad : 0.5;
  const rect = App.autoStaticViewportRect(pad);
  const covered = v.x <= rect.x && v.y <= rect.y && (v.x + v.w) >= (rect.x + rect.w) && (v.y + v.h) >= (rect.y + rect.h);
  const enoughRes = !!(v._f && v._f >= App.autoStaticNeedF() * 0.8);
  if (covered && enoughRes) return;
  App.autoStaticSchedule();
};

App.invalidateEditStatic = function () {
  if (App.editStatic && App.editStatic.active && App.endEditStatic) App.endEditStatic();
  if (App.autoStaticRelease) App.autoStaticRelease();
  if (App.autoStaticMaybe) App.autoStaticMaybe();
};
App.contentChanged = function (options) {
  if (App.state.batching) return;
  App.contentRevision = (App.contentRevision || 0) + 1;
  const preserveRequested = !options || options.preserveAutoStatic !== false;
  const preserve = !!(preserveRequested && App.autoStatic && App.autoStatic.active &&
    App.autoStaticEligible && App.autoStaticEligible());
  if (preserve) {
    App._autoStaticSig = null;
    if (App.autoStatic.baking) { App.autoStatic.token++; App.autoStatic.baking = false; }
    const current = App.state.layers || [];
    current.forEach(function (l) { try { App.setAutoStaticHidden(l, true); } catch (e) { /* ignore */ } });
    App.autoStatic.hiding = Array.from(new Set((App.autoStatic.hiding || []).concat(current)));
    if (App.autoStaticRebake) App.autoStaticRebake();
  } else {
    if (App.autoStaticRelease) App.autoStaticRelease();
    if (App.autoStaticMaybe) App.autoStaticMaybe();
  }
  if (App.requestFlashRefresh) App.requestFlashRefresh(false);
};
App.rebakeEditStaticViewport = function () {
  if (!App.editStatic || !App.editStatic.active) return;
  if (App._editStaticViewTimer) clearTimeout(App._editStaticViewTimer);
  const token = ++App._editStaticToken;
  App._editStaticViewTimer = setTimeout(() => {
    App._editStaticViewTimer = null;
    try {
      if (!App.editStatic.active) return;
      if (App.renderInteractionBusy && App.renderInteractionBusy()) { App.rebakeEditStaticViewport(); return; }
      const vp = App.editStaticViewportRect();
      let items = App.editStatic.items.filter(l => App.layerInRect(l, vp));
      const box = App.whiteBoxLayer ? App.whiteBoxLayer() : null;
      const editItems = (App.state.edit && App.editTargets) ? App.editTargets() : [];
      let interMin = -1;
      for (let i = 0; i < App.state.layers.length; i++) {
        const l = App.state.layers[i];
        if (l === box || App.state.selected.has(l.id) || editItems.includes(l)) { interMin = i; break; }
      }
      if (interMin >= 0) items = items.filter(l => App.state.layers.indexOf(l) < interMin);
      else items = [];
      if (!items.length) {
        App.editStatic.view = vp;
        App.editStatic.bit = null;
        App.editStatic.failedTop = null;
        App.editStatic._bakedInterMin = undefined;
        App.editStatic.baking = false;
        if (App.editStaticBgEl) {
          App.editStaticBgEl.style.display = 'none';
          App.editStaticBgEl.removeAttribute('href');
        }
        try { App.state.layers.forEach(l => App.restoreEsVisibility(l)); } catch (e) { /* ignore */ }
        return;
      }
      const docId = App.Tabs && App.Tabs.current ? App.Tabs.current.id : null;
      const contentRevision = App.contentRevision || 0;
      const viewRevision = App.viewRevision || 0;
      App.editStatic.baking = true;
      App.traceRenderTask('editStatic', 'start', {
        docId: docId, contentRevision: contentRevision, viewRevision: viewRevision,
        generation: token, targets: items.map(function (l) { return l.id; })
      });
      const shouldContinue = function () {
        const currentDocId = App.Tabs && App.Tabs.current ? App.Tabs.current.id : null;
        return App.editStatic.active && token === App._editStaticToken && currentDocId === docId &&
          contentRevision === (App.contentRevision || 0) && viewRevision === (App.viewRevision || 0);
      };
      const failCurrent = function (reason) {
        if (!App.editStatic.active || token !== App._editStaticToken) return;
        App.editStatic.baking = false;
        App.editStatic.view = null;
        App.editStatic.bit = null;
        App.editStatic.failedTop = null;
        App.editStatic._bakedInterMin = undefined;
        if (App.editStaticBgEl) {
          App.editStaticBgEl.style.display = 'none';
          App.editStaticBgEl.removeAttribute('href');
        }
        try { App.state.layers.forEach(l => App.restoreEsVisibility(l)); } catch (e) { /* ignore */ }
        App.traceRenderTask('editStatic', 'cancel', {
          docId: docId, contentRevision: contentRevision, viewRevision: viewRevision,
          generation: token, reason: reason
        });
      };
      App.bakeEditStatic(items, vp, shouldContinue).then(bit => {
        if (!App.editStatic.active || token !== App._editStaticToken) return;
        if (!bit) {
          failCurrent('bake-returned-null');
          return;
        }
        if (!(bit.f > 0) || bit.f < (App.state.view.scale || 1) * (window.devicePixelRatio || 1) * 0.8) {
          failCurrent('stale-quality');
          App.rebakeEditStaticViewport();
          return;
        }
        if (App.editStaticStageEl && App.editStaticStageEl.isConnected) App.editStaticStageEl.remove();
        const stage = svgEl('image', { 'pointer-events': 'none', preserveAspectRatio: 'none', class: 'sve-edit-static' });
        App.editStaticStageEl = stage;
        stage.setAttribute('x', bit.x); stage.setAttribute('y', bit.y);
        stage.setAttribute('width', bit.w); stage.setAttribute('height', bit.h);
        stage.style.visibility = 'hidden';
        App.layersRoot.insertBefore(stage, App.layersRoot.firstChild);
        let settled = false;
        const clear = function () {
          stage.removeEventListener('load', ready);
          stage.removeEventListener('error', failed);
        };
        const failed = function () {
          if (settled) return;
          settled = true; clear();
          if (stage.isConnected) stage.remove();
          if (App.editStaticStageEl === stage) App.editStaticStageEl = null;
          failCurrent('stage-failed');
        };
        const ready = function () {
          if (settled) return;
          settled = true; clear();
          requestAnimationFrame(function () { requestAnimationFrame(function () {
            if (!shouldContinue() || !stage.isConnected) {
              if (stage.isConnected) stage.remove();
              if (App.editStaticStageEl === stage) App.editStaticStageEl = null;
              failCurrent('stale-before-install');
              return;
            }
            const old = App.editStaticBgEl;
            stage.style.visibility = '';
            App.editStaticBgEl = stage;
            if (App.editStaticStageEl === stage) App.editStaticStageEl = null;
            App.editStatic.bit = bit;
            App.editStatic.view = vp;
            App.editStatic.failedTop = bit.failedTop || null;
            App.editStatic._bakedInterMin = interMin;
            App.editStatic.baking = false;
            if (old && old !== stage && old.isConnected) old.remove();
            App.updateEditStaticViewport();
            App.traceRenderTask('editStatic', 'install', {
              docId: docId, contentRevision: contentRevision, viewRevision: viewRevision,
              generation: token, f: bit.f, failedTop: bit.failedTop ? bit.failedTop.size : 0
            });
          }); });
        };
        stage.addEventListener('load', ready);
        stage.addEventListener('error', failed);
        stage.setAttribute('href', bit.url);
      }).catch(function (e) {
        console.warn('[bake] 编辑静态任务失败', String(e && e.message || e).slice(0, 160));
        failCurrent('bake-throw');
      });
    } catch (e) { /* ignore */ }
  }, 300);
};
App.updateEditStaticViewport = function () {
  if (!App.editStatic || !App.editStatic.active) return;
  const s = App.state;
  if (!s || !s.layers) return;
  const es = App.editStatic;
  let interMinNow = -1;
  if (es.view && es.bit) {
    const box = App.whiteBoxLayer ? App.whiteBoxLayer() : null;
    const editItems = (s.edit && App.editTargets) ? App.editTargets() : [];
    for (let i = 0; i < s.layers.length; i++) {
      const l = s.layers[i];
      if (l === box || s.selected.has(l.id) || editItems.includes(l)) { interMinNow = i; break; }
    }
    const interMin = es._bakedInterMin !== undefined ? es._bakedInterMin : interMinNow;
    for (let i = 0; i < s.layers.length; i++) {
      const l = s.layers[i];
      if (!l || !l.el) continue;
      const inter = l === box || s.selected.has(l.id) || editItems.includes(l);
      const inItems = es.items.includes(l);
      const inView = App.layerInRect(l, es.view);
      const hide = !inter && inItems && inView && (interMin < 0 || i < interMin) &&
        !(es.failedTop && es.failedTop.has(l.id));
      App.setEsHidden(l, hide);
    }
  }
  if (es.view && es._bakedInterMin !== undefined && es._bakedInterMin !== interMinNow) {
    App.rebakeEditStaticViewport();
  }
  const vpNow = App.editStaticViewportRect();
  if (!es.view || Math.abs(es.view.x - vpNow.x) > 5 || Math.abs(es.view.y - vpNow.y) > 5 ||
      Math.abs(es.view.scale - (App.state.view.scale || 1)) > 0.05) {
    App.rebakeEditStaticViewport();
  }
};
App.dropEditStaticItem = function (layer) {
  if (!App.editStatic || !App.editStatic.active || !layer) return;
  const idx = App.editStatic.items.indexOf(layer);
  if (idx >= 0) {
    App.editStatic.items.splice(idx, 1);
    App.restoreEsVisibility(layer);
    if (App.editStaticBgEl) App.editStaticBgEl.style.display = 'none';
    App.rebakeEditStaticViewport();
  }
};
App.drawOutlines = function () {
  if (!App.state.edit && !App.outlineG.firstChild && !App.handleG.firstChild) {
    App.outlinePolys = [];
    if (App.anchorIconEl) App.anchorIconEl.style.display = 'none';
    return;
  }
  App.outlineG.innerHTML = '';
  App.outlineG.setAttribute('pointer-events', 'none');
  App.handleG.setAttribute('pointer-events', 'none');
  App.outlinePolys = [];
  App.handleG.innerHTML = '';
  if (App.state.edit && App.state.editMode === 'size') {
    if (App.state.showHandles !== false && !App.state.anchorPlacing) App.drawHandles();
    if (App.state.axisHint) App.drawAxisArrows();
  }
  if (App.drawAnchorIcon) App.drawAnchorIcon();
  if (App.state.edit && App.syncFlashForEdit) App.syncFlashForEdit();
};

App.editTargetBox = function () {
  const items = App.editTargets();
  if (!items.length) return null;
  if (items.length === 1) return App.getItemDocBBox(items[0]);
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  const corners = [];
  items.forEach(it => {
    const b = App.getItemDocBBox(it);
    b.corners.forEach(c => {
      corners.push(c);
      minx = Math.min(minx, c.x); miny = Math.min(miny, c.y);
      maxx = Math.max(maxx, c.x); maxy = Math.max(maxy, c.y);
    });
  });
  return { x: minx, y: miny, w: maxx - minx, h: maxy - miny, cx: (minx + maxx) / 2, cy: (miny + maxy) / 2, corners };
};

App.handleGeometry = function () {
  const items = App.editTargets();
  if (!items.length) return null;
  let box, corners;
  if (items.length === 1) {
    box = App.getItemDocBBox(items[0]);
    corners = box.corners;
  } else {
    box = App.editTargetBox();
    corners = box ? [
      { x: box.x, y: box.y }, { x: box.x + box.w, y: box.y },
      { x: box.x + box.w, y: box.y + box.h }, { x: box.x, y: box.y + box.h }
    ] : null;
  }
  if (!box || !corners || corners.length < 4) return null;
  const [nw, ne, se, sw] = corners;
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  return {
    box, nw, ne, se, sw,
    n: mid(nw, ne), e: mid(ne, se), s: mid(se, sw), w: mid(sw, nw),
    cx: (nw.x + se.x) / 2, cy: (nw.y + se.y) / 2
  };
};

App.handleSizePx = function (box) {
  if (!box || !(box.w > 0) || !(box.h > 0)) return 9;
  const short = Math.min(box.w, box.h) * (App.state.view.scale || 1);
  return Math.max(3, Math.min(9, short / 4));
};

App.drawHandles = function () {
  App.handleG.innerHTML = '';
  App.handleEls = [];
  const g = App.handleGeometry();
  if (!g) return;
  const sc = App.state.view.scale;
  const hpx = App.handleSizePx(g.box);
  const s = hpx / sc, hs = hpx / sc;
  const keys = [
    ['nw', g.nw, 'nwse-resize'], ['n', g.n, 'ns-resize'],
    ['ne', g.ne, 'nesw-resize'], ['e', g.e, 'ew-resize'],
    ['se', g.se, 'nwse-resize'], ['s', g.s, 'ns-resize'],
    ['sw', g.sw, 'nesw-resize'], ['w', g.w, 'ew-resize']
  ];
  keys.forEach(k => {
    const hit = svgEl('rect', {
      x: k[1].x - hs / 2, y: k[1].y - hs / 2, width: hs, height: hs,
      class: 'sve-handle-hit', 'data-h': k[0], fill: 'transparent',
      'pointer-events': 'all', cursor: k[2]
    });
    App.handleG.appendChild(hit);
    App.handleG.appendChild(svgEl('rect', {
      x: k[1].x - s / 2, y: k[1].y - s / 2, width: s, height: s,
      class: 'sve-handle', 'pointer-events': 'none'
    }));
    App.handleEls.push({ key: k[0], el: hit });
  });
};

App.drawAxisArrows = function () {
  const g = App.handleGeometry();
  if (!g) return;
  if (!App.state.axisHint) return;
  const sc = App.state.view.scale || 1;
  const items = App.editTargets();
  const c = { x: g.cx, y: g.cy };
  const L = 30 / sc, head = 7 / sc;
  let axes = [[0, -1], [-1, 0]];
  if (items.length === 1 && items[0].el) {
    const ctm = items[0].el.getScreenCTM();
    if (ctm) {
      const o = new DOMPoint(0, 0).matrixTransform(ctm);
      const nrm = p => {
        const x = p.x - o.x, y = p.y - o.y;
        const m = Math.hypot(x, y) || 1;
        return [x / m, y / m];
      };
      axes = [nrm(new DOMPoint(0, -1).matrixTransform(ctm)), nrm(new DOMPoint(-1, 0).matrixTransform(ctm))];
    }
  }
  const labels = ['W', 'A'];
  const cols = ['#4ea1ff', '#ffb14e'];
  axes.forEach((d, i) => {
    const x1 = c.x + d[0] * L, y1 = c.y + d[1] * L;
    const ag = svgEl('g', { class: 'sve-axis', 'pointer-events': 'none' });
    ag.appendChild(svgEl('line', {
      x1: c.x, y1: c.y, x2: x1, y2: y1,
      stroke: cols[i], 'stroke-width': 2 / sc, 'stroke-linecap': 'round'
    }));
    const perp = [-d[1], d[0]];
    const tx = x1 - d[0] * head, ty = y1 - d[1] * head;
    ag.appendChild(svgEl('polygon', {
      points: x1 + ',' + y1 + ' ' + (tx + perp[0] * head * 0.65) + ',' + (ty + perp[1] * head * 0.65) + ' ' + (tx - perp[0] * head * 0.65) + ',' + (ty - perp[1] * head * 0.65),
      fill: cols[i]
    }));
    const txt = svgEl('text', {
      x: x1 + d[0] * head * 1.7, y: y1 + d[1] * head * 1.7,
      fill: cols[i], 'font-size': 12 / sc, 'font-weight': 'bold'
    });
    txt.textContent = labels[i];
    ag.appendChild(txt);
    App.handleG.appendChild(ag);
  });
};

App.flashTimers = [];
App.flashSeq = 0;
App.flashColor = null;
App.flashOverlayMap = new Map();
App.flashIntervalMs = 5000;
App.flashDurationMs = 300;
App.restoreDirectFlash = function (rec) {
  if (!rec || rec.kind !== 'auto-static-direct') return;
  const pair = rec.pair;
  if (pair && pair.yellow) pair.yellow.style.opacity = '0';
  if (pair && pair.blue) pair.blue.style.opacity = '0';
  rec.active = false;
};
App.applyDirectFlashColor = function (rec, color) {
  const pair = rec && rec.pair;
  if (!rec || rec.kind !== 'auto-static-direct' || !pair || pair !== App.autoStaticFlashPair ||
      !pair.yellow || !pair.blue || !pair.g || !pair.g.isConnected) return false;
  const match = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(color || '');
  const blueMix = match ? Math.max(0, Math.min(1, (Number(match[3]) - 1) / 254)) : 0;
  pair.yellow.style.opacity = '1';
  pair.blue.style.opacity = String(blueMix);
  rec.active = true;
  return true;
};
App.releaseFlashOverlay = function (rec) {
  if (rec && rec.kind === 'auto-static-direct') {
    App.restoreDirectFlash(rec);
    return;
  }
  const el = rec && rec.el ? rec.el : rec;
  if (!el) return;
  const u = el._sveFlashBlobUrl;
  if (u) {
    try { URL.revokeObjectURL(u); }
    catch (e) { console.warn('[flash] 覆盖层 Blob URL 回收失败', String(e && e.message || e).slice(0, 160)); }
    el._sveFlashBlobUrl = null;
  }
  if (el.parentNode) el.parentNode.removeChild(el);
};

App.ensureFlashRunning = function (reset) {
  if (reset && App.state.flashTimer) {
    clearInterval(App.state.flashTimer);
    App.state.flashTimer = null;
  }
  if (!App.state.flashTimer) {
    App.state.flashTimer = setInterval(() => App.animateFlash({ periodic: true }), App.flashIntervalMs);
  }
};
App.startFlash = function () {
  App.ensureFlashRunning(true);
  App.updateFlashOverlays();
};
App.stopFlash = function () {
  if (App.state.flashTimer) { clearInterval(App.state.flashTimer); App.state.flashTimer = null; }
  if (App.compRebuildTimer) { clearTimeout(App.compRebuildTimer); App.compRebuildTimer = null; }
  App.flashTimers.forEach(t => { cancelAnimationFrame(t); clearTimeout(t); });
  App.flashTimers = [];
  App.flashSeq++;
  App.compFlashToken++;
  App.compBuildSig = null;
  App.compBuildAnimate = false;
  App.compAlignCheckToken++;
  App.flashColor = null;
  App.flashOverlayMap.forEach(App.releaseFlashOverlay);
  App.flashG.innerHTML = '';
  App.flashG.style.display = 'none';
  App.flashOverlayMap.clear();
};

App.buildFlashOverlayFor = function (layer) {
  const t = layer.el.getAttribute('transform');
  const op = layer.el.getAttribute('opacity');
  if (layer.kind === 'symbol') {
    const g = svgEl('g', { transform: t, opacity: op, 'pointer-events': 'none' });
    const m = svgEl('mask', {
      id: 'sveFM' + layer.id, maskUnits: 'userSpaceOnUse',
      x: -layer.w / 2, y: -layer.h / 2, width: layer.w, height: layer.h
    });
    if (layer.dataUri) {
      m.appendChild(svgEl('image', {
        href: layer.dataUri,
        x: -layer.w / 2, y: -layer.h / 2,
        width: layer.w, height: layer.h,
        preserveAspectRatio: 'none'
      }));
    }
    g.appendChild(m);
    g.appendChild(svgEl('rect', {
      x: -layer.w / 2, y: -layer.h / 2, width: layer.w, height: layer.h,
      class: 'sve-flash-fill', mask: 'url(#sveFM' + layer.id + ')'
    }));
    return g;
  }
  if (layer.kind === 'pattern') {
    const g = svgEl('g', { transform: t, opacity: op, 'pointer-events': 'none' });
    g.appendChild(svgEl('rect', {
      x: -layer.w / 2, y: -layer.h / 2, width: layer.w, height: layer.h,
      class: 'sve-flash-fill', opacity: 0.55
    }));
    return g;
  }
  if (layer.kind === 'merged') {
    const g = svgEl('g', { transform: t, opacity: op, 'pointer-events': 'none' });
    (layer.children || []).forEach(ch => {
      const sub = App.buildFlashOverlayFor(ch);
      if (sub) g.appendChild(sub);
    });
    return g;
  }
  const clone = layer.el.cloneNode(true);
  clone.removeAttribute('data-layer');
  clone.removeAttribute('data-kind');
  $$('mask', clone).forEach(m => m.remove());
  $$('[fill]', clone).forEach(el => {
    const f = el.getAttribute('fill');
    if (f && f !== 'none') el.classList.add('sve-flash-fill');
  });
  clone.setAttribute('pointer-events', 'none');
  return clone;
};

App.compFlashToken = 0;
function parseTransformAttr(s) {
  const m = new DOMMatrix();
  if (!s) return m;
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let mm;
  while ((mm = re.exec(s))) {
    const a = mm[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (!a.length) continue;
    switch (mm[1]) {
      case 'translate': m.translateSelf(a[0] || 0, a.length > 1 ? a[1] || 0 : 0); break;
      case 'scale': m.scaleSelf(a[0] || 1, a.length > 1 ? (a[1] || a[0] || 1) : (a[0] || 1)); break;
      case 'rotate':
        if (a.length >= 3) m.translateSelf(a[1], a[2]).rotateSelf(a[0]).translateSelf(-a[1], -a[2]);
        else m.rotateSelf(a[0] || 0);
        break;
      case 'skewX': m.skewXSelf(a[0] || 0); break;
      case 'skewY': m.skewYSelf(a[0] || 0); break;
      case 'matrix': try { m.multiplySelf(new DOMMatrix(a)); } catch (e) {} break;
    }
  }
  return m;
}
function transformChainMat(l) {
  const chain = [];
  let el = l.el;
  while (el && el.nodeType === 1 && el !== App.layersRoot && el !== App.svg) {
    chain.push(el.getAttribute('transform'));
    el = el.parentNode;
  }
  let m = new DOMMatrix();
  for (let i = chain.length - 1; i >= 0; i--) m = m.multiply(parseTransformAttr(chain[i]));
  return m;
}
App.transformChainMat = transformChainMat;
App.buildCompositeFlash = function (items) {
  App.__compBuildT0 = performance.now();
  const isMerged = items.length === 1 && items[0].kind === 'merged';
  if (isMerged) {
    const g0 = items[0];
    const prec = App._proxyBake && App._proxyBake.get(g0.id);
    if (prec && prec.baseMaskUrl && prec.baseMinx !== undefined && g0.el) {
      const g = svgEl('g', { transform: g0.el.getAttribute('transform') || '', 'pointer-events': 'none' });
      const m = svgEl('mask', { id: 'sveFComp', maskUnits: 'userSpaceOnUse', x: prec.baseMinx, y: prec.baseMiny, width: prec.baseBw, height: prec.baseBh });
      m.appendChild(svgEl('image', { href: prec.baseMaskUrl, x: prec.baseMinx, y: prec.baseMiny, width: prec.baseBw, height: prec.baseBh, preserveAspectRatio: 'none' }));
      g.appendChild(m);
      g.appendChild(svgEl('rect', { x: prec.baseMinx, y: prec.baseMiny, width: prec.baseBw, height: prec.baseBh, class: 'sve-flash-fill', mask: 'url(#sveFComp)' }));
      try { App.log('perf', '合成闪动快速路径', { ms: Math.round(performance.now() - App.__compBuildT0) }); } catch (e) { /* ignore */ }
      return Promise.resolve(g);
    }
  }
  const leaves = [];
  const walk = l => { if (l.kind === 'merged') (l.children || []).forEach(walk); else leaves.push(l); };
  if (isMerged) walk(items[0]); else items.forEach(walk);
  if (!leaves.length) return Promise.resolve(null);
  const srcs = leaves.map(l => {
    if (l.kind === 'symbol' && l.dataUri) return App.silhouetteCanvas(l.dataUri, '#ffffff', 64);
    if (l.kind === 'pattern') {
      const c = App.patternThumbCanvas(l.patternKey, '#ffffff', 64);
      return Promise.resolve({ canvas: c, rect: { x: 0, y: 0, w: 64, h: 64 } });
    }
    return App.svgRasterThumb(l).then(url => (url ? loadImage(url) : null))
      .then(img => (img ? { canvas: img, rect: { x: 0, y: 0, w: img.width, h: img.height } } : null))
      .catch(e => { console.warn('[flash] 导入图层剪影生成失败', l && l.id, String(e && e.message || e).slice(0, 160)); return null; });
  });
  return Promise.all(srcs).then(canvases => new Promise(resolve => {
    const rootM = isMerged && items[0].el ? transformChainMat(items[0]) : null;
    const mats = leaves.map(l => {
      const m = transformChainMat(l);
      if (rootM) {
        try { return rootM.inverse().multiply(m); } catch (e) { return m; }
      }
      return m;
    });
    const BUDGET = 8, MIN_CHUNK = 8;
    const token = App.compFlashToken;
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    let bi = 0, di = 0, bw = 0, bh = 0, f = 1, cv = null, cx = null;
    const bboxStep = () => {
      if (App.compFlashToken !== token) return resolve(null);
      const t0 = performance.now();
      let n = 0;
      while (bi < leaves.length && (n < MIN_CHUNK || performance.now() - t0 < BUDGET)) {
        const hw = (leaves[bi].w || 0) / 2, hh = (leaves[bi].h || 0) / 2;
        [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].forEach(p => {
          const r = new DOMPoint(p[0], p[1]).matrixTransform(mats[bi]);
          minx = Math.min(minx, r.x); maxx = Math.max(maxx, r.x);
          miny = Math.min(miny, r.y); maxy = Math.max(maxy, r.y);
        });
        bi++; n++;
      }
      if (bi < leaves.length) { setTimeout(bboxStep, 0); return; }
      if (!isFinite(minx)) return resolve(null);
      bw = Math.max(1, maxx - minx); bh = Math.max(1, maxy - miny);
      f = Math.min(1, 1024 / Math.max(bw, bh));
      const cw = Math.max(1, Math.round(bw * f)), ch2 = Math.max(1, Math.round(bh * f));
      cv = document.createElement('canvas'); cv.width = cw; cv.height = ch2;
      cx = cv.getContext('2d');
      drawStep();
    };
    const drawStep = () => {
      if (App.compFlashToken !== token) return resolve(null);
      const t0 = performance.now();
      let n = 0;
      while (di < leaves.length && (n < MIN_CHUNK || performance.now() - t0 < BUDGET)) {
        const l = leaves[di];
        const entry = canvases[di];
        if (entry && entry.canvas) {
          cx.save();
          const T = new DOMMatrix().translate(-minx * f, -miny * f).scale(f).multiply(mats[di]);
          cx.setTransform(T.a, T.b, T.c, T.d, T.e, T.f);
          cx.drawImage(entry.canvas, entry.rect.x, entry.rect.y, entry.rect.w, entry.rect.h,
            -(l.w || 0) / 2, -(l.h || 0) / 2, l.w || 0, l.h || 0);
          cx.restore();
        }
        di++; n++;
      }
      if (di < leaves.length) { setTimeout(drawStep, 0); return; }
      const finish = href => {
        if (App.compFlashToken !== token || !href) {
          if (href && href.indexOf('blob:') === 0) {
            try { URL.revokeObjectURL(href); }
            catch (e) { console.warn('[flash] 过期 Blob URL 回收失败', String(e && e.message || e).slice(0, 160)); }
          }
          return resolve(null);
        }
        const g = svgEl('g', {
          transform: isMerged ? (items[0].el.getAttribute('transform') || '') : null,
          'pointer-events': 'none'
        });
        if (href.indexOf('blob:') === 0) g._sveFlashBlobUrl = href;
        const m = svgEl('mask', { id: 'sveFComp', maskUnits: 'userSpaceOnUse', x: minx, y: miny, width: bw, height: bh });
        m.appendChild(svgEl('image', { href, x: minx, y: miny, width: bw, height: bh, preserveAspectRatio: 'none' }));
        g.appendChild(m);
        g.appendChild(svgEl('rect', { x: minx, y: miny, width: bw, height: bh, class: 'sve-flash-fill', mask: 'url(#sveFComp)' }));
        try {
          const __ct0 = App.__compBuildT0 || 0;
          App.log('perf', '合成闪动构建', { layers: leaves.length, ms: Math.round(performance.now() - __ct0), w: bw, h: bh });
        } catch (e) { /* ignore */ }
        resolve(g);
      };
      if (cv.toBlob) {
        cv.toBlob(blob => {
          if (!blob) { console.warn('[flash] 合成剪影编码返回空'); resolve(null); return; }
          try { finish(URL.createObjectURL(blob)); }
          catch (e) {
            console.warn('[flash] 合成剪影 Blob URL 创建失败，使用回退编码', String(e && e.message || e).slice(0, 160));
            try { finish(cv.toDataURL()); }
            catch (fallbackErr) { console.warn('[flash] 合成剪影回退编码失败', String(fallbackErr && fallbackErr.message || fallbackErr).slice(0, 160)); resolve(null); }
          }
        }, 'image/png');
      } else {
        try { finish(cv.toDataURL()); }
        catch (e) { console.warn('[flash] 合成剪影编码失败', String(e && e.message || e).slice(0, 160)); resolve(null); }
      }
    };
    bboxStep();
  }));
};

App.compAlignCheckAt = 0;
App.compAlignDrift = 0;
App.compAlignCheckToken = 0;
App.checkCompositeAlign = function (items, rec, sig, animate) {
  const now = performance.now();
  if (now - App.compAlignCheckAt < 2000) return false;
  App.compAlignCheckAt = now;
  if (!items.length || !rec) return false;
  const rect = rec.el.querySelector('rect');
  if (!rect) return false;
  const leaves = [];
  const walk = l => { if (l.kind === 'merged') (l.children || []).forEach(walk); else leaves.push(l); };
  items.forEach(walk);
  if (!leaves.length) return false;
  const token = ++App.compAlignCheckToken;
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  let i = 0;
  const step = function () {
    if (token !== App.compAlignCheckToken || App.flashOverlayMap.get('__composite__') !== rec) return;
    const t0 = performance.now();
    do {
      const l = leaves[i];
      const m = transformChainMat(l);
      const hw = (l.w || 0) / 2, hh = (l.h || 0) / 2;
      [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].forEach(p => {
        const r = new DOMPoint(p[0], p[1]).matrixTransform(m);
        minx = Math.min(minx, r.x); maxx = Math.max(maxx, r.x);
        miny = Math.min(miny, r.y); maxy = Math.max(maxy, r.y);
      });
      i++;
    } while (i < leaves.length && performance.now() - t0 < 6);
    if (i < leaves.length) { setTimeout(step, 0); return; }
    if (!isFinite(minx)) return;
    const gM = parseTransformAttr(rec.el.getAttribute('transform') || '');
    const rx = parseFloat(rect.getAttribute('x')), ry = parseFloat(rect.getAttribute('y'));
    const rw = parseFloat(rect.getAttribute('width')), rh = parseFloat(rect.getAttribute('height'));
    const corners = [[rx, ry], [rx + rw, ry], [rx + rw, ry + rh], [rx, ry + rh]]
      .map(p => new DOMPoint(p[0], p[1]).matrixTransform(gM));
    const dx = Math.min(...corners.map(p => p.x)) - minx;
    const dy = Math.min(...corners.map(p => p.y)) - miny;
    const dx2 = Math.max(...corners.map(p => p.x)) - maxx;
    const dy2 = Math.max(...corners.map(p => p.y)) - maxy;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(dx2) < 1 && Math.abs(dy2) < 1) return;
    App.compAlignDrift++;
    rec.sig = '__stale__';
    App.flashG.style.display = 'none';
    if (App.compRebuildTimer) clearTimeout(App.compRebuildTimer);
    App.compRebuildTimer = setTimeout(() => {
      App.compRebuildTimer = null;
      const buildToken = ++App.compFlashToken;
      App.buildCompositeFlash(items).then(g => {
        if (buildToken !== App.compFlashToken || !g) { if (g) App.releaseFlashOverlay(g); return; }
        const old = App.flashOverlayMap.get('__composite__');
        if (old) App.releaseFlashOverlay(old);
        App.flashG.appendChild(g);
        App.flashOverlayMap.set('__composite__', { kind: 'composite', sig, el: g, items });
        if (animate !== false && App.state.flashTimer) App.animateFlash();
      });
    }, 50);
  };
  setTimeout(step, 0);
  return true;
};

App.layerFlashContentSig = function (layer) {
  if (!layer) return '';
  if (layer.kind === 'symbol') return 'S:' + (layer.symbolKey || layer.dataUri || '') + (layer.isMask ? ':M' : '');
  if (layer.kind === 'pattern') return 'P:' + (layer.patternKey || '');
  if (layer.kind === 'merged') return 'G:' + (layer.children || []).map(ch => App.layerFlashContentSig(ch)).join(',');
  return 'I';
};

App.directAutoStaticFlashTarget = function (items) {
  const layers = App.state.layers || [];
  const cache = App.autoStatic;
  const target = App.autoStaticBgEl;
  const pair = App.autoStaticFlashPair;
  if (!cache || !cache.active || cache.baking || cache.contentRevision !== (App.contentRevision || 0)) return null;
  if (!target || !target.isConnected || !target.getAttribute('href')) return null;
  if (!pair || pair.target !== target || !pair.g || !pair.g.isConnected) return null;
  if (cache.bit && cache.bit.failedTop && cache.bit.failedTop.size) return null;
  if (!items || items.length !== layers.length) return null;
  const wanted = new Set(items);
  if (layers.some(layer => !wanted.has(layer))) return null;
  return target;
};
App.largeFlashSig = function (items) {
  return (App.contentRevision || 0) + ':' + (items || []).map(layer => layer.id).join(',');
};

App.flashTargetLayers = function () {
  const items = [];
  const box = App.whiteBoxLayer ? App.whiteBoxLayer() : null;
  if (box) items.push(box);
  if (App.state.selectedByTab && box) {
    const sel = App.selectedItems();
    if (sel.some(l => l === box)) {
      sel.forEach(l => { if (items.indexOf(l) < 0) items.push(l); });
    }
  }
  return items;
};

App.syncFlashForEdit = function () {
  const map = App.flashOverlayMap;
  if (!map || !map.size) return;
  const items = App.flashTargetLayers();
  if (!items.length) return;
  const comp = map.get('__composite__');
  items.forEach(layer => {
    if (!layer || !layer.el) return;
    const tr = layer.el.getAttribute('transform') || '';
    const rec = map.get('L' + layer.id);
    if (rec && rec.el) {
      rec.el.setAttribute('transform', tr);
      rec.el.setAttribute('opacity', layer.el.getAttribute('opacity') || '1');
    }
    if (comp && comp.kind === 'composite' && comp.el && comp.items &&
        comp.items.length === 1 && comp.items[0] === layer) {
      comp.el.setAttribute('transform', tr);
    }
  });
};

App.updateFlashOverlays = function (animate) {
  if (App.refreshImpBitmaps) App.refreshImpBitmaps();
  if (App.updateEditStaticViewport) App.updateEditStaticViewport();
  const items = App.flashTargetLayers();
  const total = items.reduce((acc, l) => acc + App.countInLayer(l), 0);
  if (total > 400) {
    const sig = App.largeFlashSig(items);
    const directTarget = App.directAutoStaticFlashTarget(items);
    let composite = App.flashOverlayMap.get('__composite__');
    Array.from(App.flashOverlayMap.keys()).forEach(key => {
      if (key === '__composite__') return;
      App.releaseFlashOverlay(App.flashOverlayMap.get(key));
      App.flashOverlayMap.delete(key);
    });

    if (directTarget) {
      if (App.compBuildSig) {
        App.compFlashToken++;
        App.compBuildSig = null;
        App.compBuildAnimate = false;
      }
      if (!composite || composite.kind !== 'auto-static-direct' ||
          composite.target !== directTarget || composite.sig !== sig) {
        if (composite) App.releaseFlashOverlay(composite);
        composite = {
          kind: 'auto-static-direct', sig: sig, target: directTarget, pair: App.autoStaticFlashPair,
          items: items.slice(), active: false
        };
        App.flashOverlayMap.set('__composite__', composite);
      }
      App.flashG.style.display = 'none';
      if (animate !== false) App.animateFlash();
      return;
    }

    if (composite && composite.kind === 'composite' && composite.sig === sig) {
      if (items.length === 1 && items[0].kind === 'merged' && composite.el) {
        composite.el.setAttribute('transform', items[0].el.getAttribute('transform') || '');
      }
      if (animate !== false) App.animateFlash();
      return;
    }
    if (App.compBuildSig === sig) {
      if (animate !== false) App.compBuildAnimate = true;
      return;
    }
    if (composite) {
      App.releaseFlashOverlay(composite);
      App.flashOverlayMap.delete('__composite__');
    }
    App.flashG.style.display = 'none';
    const buildToken = ++App.compFlashToken;
    App.compBuildSig = sig;
    App.compBuildAnimate = animate !== false;
    App.buildCompositeFlash(items).then(g => {
      const shouldAnimate = App.compBuildAnimate;
      if (buildToken !== App.compFlashToken || App.compBuildSig !== sig || !g) {
        if (g) App.releaseFlashOverlay(g);
        if (buildToken === App.compFlashToken && App.compBuildSig === sig) {
          App.compBuildSig = null;
          App.compBuildAnimate = false;
        }
        return;
      }
      App.compBuildSig = null;
      App.compBuildAnimate = false;
      const old = App.flashOverlayMap.get('__composite__');
      if (old) App.releaseFlashOverlay(old);
      App.flashG.appendChild(g);
      App.flashOverlayMap.set('__composite__', { kind: 'composite', sig: sig, el: g, items: items.slice() });
      if (shouldAnimate && App.state.flashTimer) App.animateFlash();
    }).catch(e => {
      console.warn('[flash] 大分组合成失败', String(e && e.message || e).slice(0, 160));
      if (buildToken === App.compFlashToken) {
        App.compBuildSig = null;
        App.compBuildAnimate = false;
      }
    });
    return;
  }
  if (App.compBuildSig) {
    App.compFlashToken++;
    App.compBuildSig = null;
    App.compBuildAnimate = false;
  }
  const wanted = new Set(items.map(l => 'L' + l.id));
  Array.from(App.flashOverlayMap.keys()).forEach(k => {
    if (!wanted.has(k)) {
      App.releaseFlashOverlay(App.flashOverlayMap.get(k));
      App.flashOverlayMap.delete(k);
    }
  });
  items.forEach(layer => {
    const rec = App.flashOverlayMap.get('L' + layer.id);
    if (rec && rec.kind === layer.kind && rec.contentSig === App.layerFlashContentSig(layer)) {
      rec.el.setAttribute('transform', layer.el.getAttribute('transform') || '');
      rec.el.setAttribute('opacity', layer.el.getAttribute('opacity') || '1');
      return;
    }
    if (rec) {
      App.releaseFlashOverlay(rec);
      App.flashOverlayMap.delete('L' + layer.id);
    }
    const g = App.buildFlashOverlayFor(layer);
    if (g) {
      App.flashG.appendChild(g);
      App.flashOverlayMap.set('L' + layer.id, { kind: layer.kind, contentSig: App.layerFlashContentSig(layer), el: g });
    }
  });
  if (animate !== false) App.animateFlash();
};

App.applyFlashColor = function (c) {
  App.flashColor = c;
  App.flashG.style.setProperty('--sve-flash-color', c);
  const direct = App.flashOverlayMap.get('__composite__');
  if (direct && direct.kind === 'auto-static-direct') App.applyDirectFlashColor(direct, c);
};
function mixRGB(a, b, p) {
  const t = p < 0 ? 0 : (p > 1 ? 1 : p);
  return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * t) + ',' +
    Math.round(a[1] + (b[1] - a[1]) * t) + ',' +
    Math.round(a[2] + (b[2] - a[2]) * t) + ')';
}
App.flashNow = function () {
  App.updateFlashOverlays();
};
App.animateFlash = function (opts) {
  if (App.state && App.state.layersHidden) { App.flashG.style.display = 'none'; return; }
  if (!(opts && opts.periodic)) App.ensureFlashRunning(true);
  try {
    const box = App.whiteBoxLayer ? App.whiteBoxLayer() : null;
    if (box && App._flashBoxId !== box.id) {
      App._flashBoxId = box.id;
      App.updateFlashOverlays(false);
    }
  } catch (e) { console.warn('[flash] 同步白框覆盖层失败', e && e.message); }
  let direct = App.flashOverlayMap.get('__composite__');
  if (direct && direct.kind === 'auto-static-direct' &&
      (!direct.target || !direct.target.isConnected || direct.target !== App.autoStaticBgEl ||
       !direct.pair || direct.pair !== App.autoStaticFlashPair)) {
    App.updateFlashOverlays(false);
    direct = App.flashOverlayMap.get('__composite__');
  }
  if (!App.flashOverlayMap.size) {
    App.flashG.style.display = 'none';
    const box = App.whiteBoxLayer ? App.whiteBoxLayer() : null;
    if (box && !App.compRebuildTimer) setTimeout(function () { App.updateFlashOverlays(true); }, 0);
    return;
  }
  const crec = App.flashOverlayMap.get('__composite__');
  if (crec && crec.kind === 'composite' && crec.items) App.checkCompositeAlign(crec.items, crec, crec.sig);
  App.flashG.style.display = crec && crec.kind === 'auto-static-direct' ? 'none' : '';
  const colors = [[255, 250, 1], [4, 2, 255]];
  const seq = ++App.flashSeq;
  App.flashTimers.forEach(t => { cancelAnimationFrame(t); clearTimeout(t); });
  App.flashTimers = [];
  App.applyFlashColor('rgb(' + colors[0].join(',') + ')');
  const t0 = performance.now();
  const duration = App.flashDurationMs || 300;
  const seg1 = t0 + duration;
  const step = now => {
    if (seq !== App.flashSeq) return;
    if (now < seg1) {
      App.applyFlashColor(mixRGB(colors[0], colors[1], (now - t0) / duration));
      App.flashTimers.push(requestAnimationFrame(step));
    } else {
      const current = App.flashOverlayMap.get('__composite__');
      if (current && current.kind === 'auto-static-direct') App.restoreDirectFlash(current);
      App.flashG.style.display = 'none';
      App.flashColor = null;
    }
  };
  App.flashTimers.push(requestAnimationFrame(step));
};

const imgCache = new Map();
const silhouetteCache = new Map();
function dataUrlToBlob(uri) {
  const comma = uri.indexOf(',');
  const mime = (uri.slice(5, comma).split(';')[0]) || 'image/png';
  const bin = atob(uri.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
App.decodedImage = function (uri) {
  if (!imgCache.has(uri)) {
    const p = (window.createImageBitmap
      ? Promise.resolve().then(() => createImageBitmap(dataUrlToBlob(uri))).catch(() => loadImage(uri).catch(() => null))
      : loadImage(uri).catch(() => null));
    imgCache.set(uri, p);
  }
  return imgCache.get(uri);
};
App._warmupTimer = null;
App.warmupSymbols = function () {
  if (App._warmupTimer) clearTimeout(App._warmupTimer);
  App._warmupTimer = null;
};
function fitDrawRect(img, size) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const cx = c.getContext('2d');
  const s = Math.min(size / img.width, size / img.height);
  const w = img.width * s, h = img.height * s;
  const x = (size - w) / 2, y = (size - h) / 2;
  cx.drawImage(img, x, y, w, h);
  return { canvas: c, ctx: cx, rect: { x, y, w, h } };
}
function tfPoint(x, y, f) {
  let px = x + Math.tan(f.skew * D2R) * y;
  let py = y;
  px *= f.sx * (f.flipH ? -1 : 1); py *= f.sy * (f.flipV ? -1 : 1);
  const a = f.rot * D2R, c = Math.cos(a), s = Math.sin(a);
  return [px * c - py * s, px * s + py * c];
}
App.computeLocalBBox = function (layer) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  const addCorners = l => {
    if (l.kind === 'merged') { (l.children || []).forEach(addCorners); return; }
    const hw = (l.w || 0) / 2, hh = (l.h || 0) / 2;
    [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].forEach(p => {
      let px = p[0] + Math.tan(l.skew * D2R) * p[1];
      let py = p[1];
      px *= l.sx * (l.flipH ? -1 : 1); py *= l.sy * (l.flipV ? -1 : 1);
      const a = l.rot * D2R, c = Math.cos(a), s = Math.sin(a);
      const rx = px * c - py * s, ry = px * s + py * c;
      minx = Math.min(minx, rx + l.x); maxx = Math.max(maxx, rx + l.x);
      miny = Math.min(miny, ry + l.y); maxy = Math.max(maxy, ry + l.y);
    });
  };
  if (layer.kind === 'merged') (layer.children || []).forEach(addCorners);
  else addCorners(layer);
  if (!isFinite(minx)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minx, y: miny, w: maxx - minx, h: maxy - miny };
};
App.renderTransformedThumb = function (base, rect, f) {
  const c = document.createElement('canvas');
  c.width = 48; c.height = 48;
  const cx = c.getContext('2d');
  const cs = [[rect.x, rect.y], [rect.x + rect.w, rect.y], [rect.x + rect.w, rect.y + rect.h], [rect.x, rect.y + rect.h]];
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  cs.forEach(p => {
    const q = tfPoint(p[0], p[1], f);
    minx = Math.min(minx, q[0]); miny = Math.min(miny, q[1]);
    maxx = Math.max(maxx, q[0]); maxy = Math.max(maxy, q[1]);
  });
  const w = maxx - minx, h = maxy - miny;
  if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return null;
  const s = Math.min(46 / w, 46 / h);
  cx.translate(24, 24);
  cx.scale(s, s);
  cx.rotate(f.rot * D2R);
  cx.scale(f.sx * (f.flipH ? -1 : 1), f.sy * (f.flipV ? -1 : 1));
  cx.transform(1, 0, Math.tan(f.skew * D2R), 1, 0, 0);
  cx.drawImage(base, -(rect.x + rect.w / 2), -(rect.y + rect.h / 2));
  return c;
};
App.silhouettePending = new Map();
App.silhouetteCanvas = function (uri, color, size) {
  const key = uri.length + ':' + uri.slice(0, 60) + uri.slice(-40) + '|' + color + '|' + size;
  if (silhouetteCache.has(key)) return Promise.resolve(silhouetteCache.get(key));
  if (App.silhouettePending.has(key)) return App.silhouettePending.get(key);
  const p = App.decodedImage(uri).then(img => {
    if (!img) return null;
    const { canvas, ctx, rect } = fitDrawRect(img, size);
    const d = ctx.getImageData(0, 0, size, size);
    const p2 = d.data;
    const rgb = hexToRgb(color) || { r: 255, g: 255, b: 255 };
    return tintPixels(p2, rgb).then(() => {
      ctx.putImageData(d, 0, 0);
      const entry = { canvas, rect };
      silhouetteCache.set(key, entry);
      return entry;
    });
  }).finally(() => App.silhouettePending.delete(key));
  App.silhouettePending.set(key, p);
  return p;
};
const MASK_INDICATOR_TRANSPARENT = false;
App.maskIndicatorCanvas = function (size) {
  const themeKey = App.maskThemeKey();
  const key = 'ind:' + themeKey + ':' + size + (MASK_INDICATOR_TRANSPARENT ? ':t' : '');
  if (silhouetteCache.has(key)) return silhouetteCache.get(key);
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  if (MASK_INDICATOR_TRANSPARENT) {
    silhouetteCache.set(key, c);
    return c;
  }
  const src = (App.patterns || []).find(p => p.key === themeKey);
  const cx = c.getContext('2d');
  const cell = size / 8;
  cx.fillStyle = src ? src.fill : '#3b3b3b';
  cx.fillRect(0, 0, size, size);
  cx.strokeStyle = src ? src.stroke : '#505050';
  cx.lineWidth = Math.max(1, size / 96);
  for (let r = 0; r < 8; r++) {
    for (let cc = 0; cc < 8; cc++) {
      cx.strokeRect(cc * cell, r * cell, cell, cell);
      cx.beginPath();
      cx.moveTo(cc * cell, r * cell + cell);
      cx.lineTo(cc * cell + cell, r * cell);
      cx.stroke();
    }
  }
  silhouetteCache.set(key, c);
  return c;
};
App.maskBakeIndicatorCanvas = function (layer, size) {
  const themeKey = App.maskThemeKey();
  const w = Math.max(0.0001, Math.abs(Number(layer && layer.w) || 0));
  const h = Math.max(0.0001, Math.abs(Number(layer && layer.h) || 0));
  const key = 'ind-bake:' + themeKey + ':' + w + 'x' + h + ':' + size +
    (MASK_INDICATOR_TRANSPARENT ? ':t' : '');
  if (silhouetteCache.has(key)) return silhouetteCache.get(key);
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  if (MASK_INDICATOR_TRANSPARENT) {
    silhouetteCache.set(key, c);
    return c;
  }
  const src = (App.patterns || []).find(p => p.key === themeKey);
  const node = src && src.node;
  const rect = node && node.querySelector('rect');
  const pw = Math.max(0.0001, parseFloat(node && node.getAttribute('width')) || 11);
  const ph = Math.max(0.0001, parseFloat(node && node.getAttribute('height')) || 11);
  const rx = parseFloat(rect && rect.getAttribute('x')) || 0;
  const ry = parseFloat(rect && rect.getAttribute('y')) || 0;
  const rw = Math.max(0, parseFloat(rect && rect.getAttribute('width')) || 10);
  const rh = Math.max(0, parseFloat(rect && rect.getAttribute('height')) || 10);
  const fill = (rect && rect.getAttribute('fill')) || (src && src.fill) || '#3b3b3b';
  const stroke = (rect && rect.getAttribute('stroke')) || (src && src.stroke) || '#505050';
  const cx = c.getContext('2d');
  const sx = size / w, sy = size / h;
  cx.setTransform(sx, 0, 0, sy, size / 2, size / 2);
  cx.fillStyle = fill;
  cx.strokeStyle = stroke;
  cx.lineWidth = 1;
  const minCol = Math.floor((-w / 2) / pw) - 1;
  const maxCol = Math.ceil((w / 2) / pw) + 1;
  const minRow = Math.floor((-h / 2) / ph) - 1;
  const maxRow = Math.ceil((h / 2) / ph) + 1;
  const tx = 0.5, ty = 0.5;
  cx.beginPath();
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      cx.rect(col * pw + tx + rx, row * ph + ty + ry, rw, rh);
    }
  }
  cx.fill();
  cx.stroke();
  cx.beginPath();
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      const x = col * pw + tx, y = row * ph + ty;
      cx.moveTo(x, y + rh);
      cx.lineTo(x + rw, y);
    }
  }
  cx.stroke();
  cx.setTransform(1, 0, 0, 1, 0, 0);
  silhouetteCache.set(key, c);
  return c;
};
App.maskThumbEntry = async function (layer, size) {
  size = size || 96;
  const ind = App.maskIndicatorCanvas(size);
  const entry = layer.dataUri ? await App.silhouetteCanvas(layer.dataUri, '#ffffff', size) : null;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const cx = c.getContext('2d');
  if (ind) cx.drawImage(ind, 0, 0, size, size);
  if (entry && entry.canvas) {
    cx.globalCompositeOperation = 'destination-in';
    cx.drawImage(entry.canvas, 0, 0, size, size);
    cx.globalCompositeOperation = 'source-over';
  }
  return { canvas: c, rect: (entry && entry.rect) ? entry.rect : { x: 0, y: 0, w: size, h: size } };
};
App.maskBakeUrlCache = new Map();
App.canvasPngUrl = function (canvas, label) {
  return new Promise(function (resolve) {
    const fallback = function () {
      try { resolve(canvas ? canvas.toDataURL() : ''); }
      catch (e) {
        console.warn('[bake] PNG 兜底编码失败', label || '', String(e && e.message || e).slice(0, 160));
        resolve('');
      }
    };
    if (!canvas || typeof canvas.toBlob !== 'function') { fallback(); return; }
    try {
      canvas.toBlob(function (blob) {
        if (!blob) { fallback(); return; }
        try { resolve(URL.createObjectURL(blob)); }
        catch (e) {
          console.warn('[bake] PNG 对象地址创建失败', label || '', String(e && e.message || e).slice(0, 160));
          fallback();
        }
      }, 'image/png');
    } catch (e) {
      console.warn('[bake] PNG 异步编码启动失败', label || '', String(e && e.message || e).slice(0, 160));
      fallback();
    }
  });
};
App.maskBakeUrlKey = function (layer, size) {
  const uri = layer && layer.dataUri;
  const source = (layer && layer.symbolKey) || (uri ? uri.length + ':' + uri.slice(0, 48) + ':' + uri.slice(-32) : (layer && layer.patternKey) || 'plain');
  return App.maskThemeKey() + ':' + (layer && layer.kind) + ':' + source + ':' +
    (layer && layer.w || 0) + 'x' + (layer && layer.h || 0) + ':' + size;
};
App.maskBakeUrl = function (layer, size) {
  size = size || 256;
  if (!layer || !layer.isMask) return Promise.resolve("");
  if (MASK_INDICATOR_TRANSPARENT) return Promise.resolve("");
  const key = App.maskBakeUrlKey(layer, size);
  if (App.maskBakeUrlCache.has(key)) return App.maskBakeUrlCache.get(key);
  const promise = Promise.resolve().then(function () {
    const ind = App.maskBakeIndicatorCanvas(layer, size);
    if (!ind) return "";
    if (layer.kind !== "symbol" || !layer.dataUri) return App.canvasPngUrl(ind, 'mask-indicator');
    return App.symbolColorCanvas(layer.dataUri, "#ffffff", size, size).then(function (maskCanvas) {
      if (!maskCanvas) return App.canvasPngUrl(ind, 'mask-indicator');
      const c = document.createElement("canvas");
      c.width = size; c.height = size;
      const cx = c.getContext("2d");
      cx.drawImage(ind, 0, 0, size, size);
      cx.globalCompositeOperation = "destination-in";
      cx.drawImage(maskCanvas, 0, 0, size, size);
      cx.globalCompositeOperation = "source-over";
      return App.canvasPngUrl(c, 'mask-composite');
    });
  }).catch(function (e) {
    console.warn('[mask-bake] 蒙版位图生成失败', layer && layer.id, String(e && e.message || e).slice(0, 160));
    try {
      const ind = App.maskBakeIndicatorCanvas(layer, size);
      return ind ? App.canvasPngUrl(ind, 'mask-fallback') : '';
    } catch (fallbackErr) {
      console.warn('[mask-bake] 蒙版兜底图生成失败', String(fallbackErr && fallbackErr.message || fallbackErr).slice(0, 160));
      return '';
    }
  });
  App.maskBakeUrlCache.set(key, promise);
  return promise;
};
App.maskSilhouetteCanvas = function (uri, size) {
  const themeKey = App.maskThemeKey();
  const key = 'mask:' + themeKey + ':' + uri.slice(0, 60) + uri.slice(-40) + '|' + size;
  if (silhouetteCache.has(key)) return Promise.resolve(silhouetteCache.get(key));
  return App.decodedImage(uri).then(img => {
    if (!img) return null;
    const { canvas: imgC, ctx: imgCtx, rect } = fitDrawRect(img, size);
    const lum = imgCtx.getImageData(0, 0, size, size).data;
    const base = App.maskIndicatorCanvas(size);
    const out = document.createElement('canvas');
    out.width = size; out.height = size;
    const cx = out.getContext('2d');
    cx.drawImage(base, 0, 0);
    const d = cx.getImageData(0, 0, size, size);
    for (let i = 0; i < lum.length; i += 4) {
      d.data[i + 3] = clamp(lum[i] * 0.299 + lum[i + 1] * 0.587 + lum[i + 2] * 0.114, 0, 255);
    }
    cx.putImageData(d, 0, 0);
    const entry = { canvas: out, rect };
    silhouetteCache.set(key, entry);
    return entry;
  });
};
App.patternThumbCanvas = function (key, color, size) {
  const src = (App.patterns || []).find(p => p.key === key);
  const base = color || (src ? src.fill : '#888888');
  const line = src ? src.stroke : '#aaaaaa';
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const cx = c.getContext('2d');
  const cell = size / 4;
  for (let r = 0; r < 4; r++) {
    for (let cc = 0; cc < 4; cc++) {
      cx.fillStyle = base;
      cx.fillRect(cc * cell, r * cell, cell - 1, cell - 1);
      cx.strokeStyle = line;
      cx.beginPath();
      cx.moveTo(cc * cell, r * cell + cell - 1);
      cx.lineTo(cc * cell + cell - 1, r * cell);
      cx.stroke();
    }
  }
  return c;
};
App.patternThumb = function (key, color) {
  return App.patternThumbCanvas(key, color, 64).toDataURL();
};

App.libThumb = function (symbol) {
  if (symbol.thumb) return Promise.resolve(symbol.thumb);
  return App.silhouetteCanvas(App.symbolUri(symbol), '#ffffff', 64).then(entry => {
    if (!entry) return '';
    symbol.thumb = entry.canvas.toDataURL();
    return symbol.thumb;
  });
};

App.thumbKnockoutMasks = function (svgText) {
  try { return window.SveThumbRenderer ? SveThumbRenderer.knockoutMasks(svgText) : svgText; }
  catch (e) { console.warn('[thumb] thumbKnockoutMasks 失败', String(e && e.message || e).slice(0, 160)); return svgText; }
};
App.thumbSvgHasMasks = function (svgText) {
  try { return !!(window.SveThumbRenderer && SveThumbRenderer.hasMasks(svgText)); }
  catch (e) { console.warn('[thumb] thumbSvgHasMasks 失败', String(e && e.message || e).slice(0, 160)); return false; }
};
App.thumbKnockoutRaster = async function (svgText) {
  try { return window.SveThumbRenderer ? await SveThumbRenderer.rasterizeKnockout(svgText, 1920) : ''; }
  catch (e) { console.warn('[thumb] thumbKnockoutRaster 失败', String(e && e.message || e).slice(0, 160)); return ''; }
};
App.mergedThumbGeometry = function (layer) {
  const leaves = [], mats = [];
  const modelMatrix = function (l) {
    const sx = (Number.isFinite(Number(l.sx)) ? Number(l.sx) : 1) * (l.flipH ? -1 : 1);
    const sy = (Number.isFinite(Number(l.sy)) ? Number(l.sy) : 1) * (l.flipV ? -1 : 1);
    return new DOMMatrix().translate(Number(l.x) || 0, Number(l.y) || 0)
      .rotate(Number(l.rot) || 0).scale(sx, sy).skewX(Number(l.skew) || 0);
  };
  (function walk(l, parent, isRoot) {
    if (!l) return;
    let current = parent;
    try { if (!isRoot) current = parent.multiply(modelMatrix(l)); }
    catch (e) {
      console.warn('[thumb] 缩略图模型矩阵计算失败', l && l.id, String(e && e.message || e).slice(0, 160));
      current = parent;
    }
    if (l.kind === 'merged') (l.children || []).forEach(ch => walk(ch, current, false));
    else { leaves.push(l); mats.push(current); }
  })(layer, new DOMMatrix(), true);
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  leaves.forEach(function (l, i) {
    const m = mats[i];
    if (!m) return;
    const hw = Math.abs(l.w || 0) / 2, hh = Math.abs(l.h || 0) / 2;
    const ex = Math.abs(m.a) * hw + Math.abs(m.c) * hh;
    const ey = Math.abs(m.b) * hw + Math.abs(m.d) * hh;
    minx = Math.min(minx, m.e - ex); miny = Math.min(miny, m.f - ey);
    maxx = Math.max(maxx, m.e + ex); maxy = Math.max(maxy, m.f + ey);
  });
  const lb = isFinite(minx)
    ? { x: minx, y: miny, w: Math.max(0, maxx - minx), h: Math.max(0, maxy - miny) }
    : { x: 0, y: 0, w: 0, h: 0 };
  return { leaves: leaves, mats: mats, lb: lb };
};
App.mergedThumbUrl = async function (layer, size, preparedGeometry) {
  try {
    size = size || 96;
    const geom = preparedGeometry || App.mergedThumbGeometry(layer);
    const leaves = geom.leaves;
    if (!leaves.length) return "";
    const lb = geom.lb;
    if (!(lb.w > 0) || !(lb.h > 0)) return "";
    const mats = geom.mats;
    const urls = await App.resolveBakeLayerSources(leaves, 256, 24);
    const uniq = Array.from(new Set(urls.filter(Boolean)));
    const byUrl = await App.loadBakeImages(uniq, '[thumb] 分组图源解码失败');
    const cv = document.createElement("canvas");
    cv.width = size; cv.height = size;
    const cx = cv.getContext("2d");
    cx.imageSmoothingEnabled = true;
    if (cx.imageSmoothingQuality !== undefined) cx.imageSmoothingQuality = 'high';
    const f = (size * 0.96) / Math.max(lb.w, lb.h);
    const offx = size / 2 - (lb.x + lb.w / 2) * f;
    const offy = size / 2 - (lb.y + lb.h / 2) * f;
    let sliceStart = performance.now();
    for (let i = 0; i < leaves.length; i++) {
      const u = urls[i];
      const img = u ? byUrl.get(u) : null;
      const M = mats[i];
      if (!img || !M) continue;
      const l = leaves[i];
      cx.save();
      const T = new DOMMatrix().translate(offx, offy).scale(f).multiply(M);
      cx.setTransform(T.a, T.b, T.c, T.d, T.e, T.f);
      cx.globalAlpha = (l && l.opacity >= 0 && l.opacity <= 1) ? l.opacity : 1;
      cx.globalCompositeOperation = l.isMask ? 'destination-out' : 'source-over';
      cx.drawImage(img, 0, 0, img.width, img.height, -(l.w || 0) / 2, -(l.h || 0) / 2, l.w || 0, l.h || 0);
      cx.restore();
      if (i + 1 < leaves.length && performance.now() - sliceStart >= 6) {
        await new Promise(resolve => setTimeout(resolve, 0));
        sliceStart = performance.now();
      }
    }
    const out = await App.canvasPngUrl(cv, 'merged-thumb');
    return out;
  } catch (e) { console.warn("[thumb] mergedThumbUrl 失败", String(e && e.message || e).slice(0, 160)); return ""; }
};
App.svgRasterThumb = async function (layer, size) {
  size = size || 96;
  if (layer.rasterCache && layer.rasterCache.size === size && !layer.thumbDirty) {
    return Promise.resolve(layer.rasterCache.url);
  }
  try {
    const f = { sx: layer.sx, sy: layer.sy, rot: layer.rot, skew: layer.skew, flipH: !!layer.flipH, flipV: !!layer.flipV };
    const clone = layer.el.cloneNode(true);
    clone.removeAttribute('data-layer');
    clone.removeAttribute('data-kind');
    clone.removeAttribute('opacity');
    $$('[style]', clone).forEach(el => { if (el.style && el.style.display === 'none') el.style.display = ''; });
    $$('[data-layer]', clone).forEach(el => el.removeAttribute('visibility'));
    const pendingFills = [];
    $$('[data-layer]', clone).forEach(el => {
      const id = parseInt(el.getAttribute('data-layer'), 10);
      const l = App.findLayer(id);
      if (!l || l.kind !== 'symbol') return;
      const img = el.querySelector('image');
      if (img && !(img.getAttribute('href') || '')) {
        pendingFills.push(App.symbolColorUrl(l).then(url => { img.setAttribute('href', url || ''); }));
      }
    });
    if (pendingFills.length) await Promise.all(pendingFills);
    let lb = App.computeLocalBBox(layer);
    if (layer.kind === "merged" && layer.el) {
      try { const bb = layer.el.getBBox(); if (bb && bb.width > 0 && bb.height > 0) lb = { x: bb.x, y: bb.y, w: bb.width, h: bb.height }; }
      catch (e) { console.warn('[thumb] 分组 DOM 包围盒读取失败', layer && layer.id, String(e && e.message || e).slice(0, 160)); }
    }
    if (!lb.w && !lb.h) return Promise.resolve('');
    const cs = [[lb.x, lb.y], [lb.x + lb.w, lb.y], [lb.x + lb.w, lb.y + lb.h], [lb.x, lb.y + lb.h]];
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    cs.forEach(p => {
      const q = tfPoint(p[0], p[1], f);
      minx = Math.min(minx, q[0]); miny = Math.min(miny, q[1]);
      maxx = Math.max(maxx, q[0]); maxy = Math.max(maxy, q[1]);
    });
    const w = maxx - minx, h = maxy - miny;
    if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return Promise.resolve('');
    const pad = Math.max(w, h) * 0.05;
    const sfx = f.flipH ? -1 : 1, sfy = f.flipV ? -1 : 1;
    clone.setAttribute('transform', 'rotate(' + f.rot + ') scale(' + (f.sx * sfx) + ' ' + (f.sy * sfy) + ') skewX(' + f.skew + ')');
    const host = svgEl('svg');
    host.setAttribute('viewBox', (minx - pad) + ' ' + (miny - pad) + ' ' + (w + 2 * pad) + ' ' + (h + 2 * pad));
    let defsHost = null;
    const addDefs = () => {
      if (defsHost) return defsHost;
      defsHost = svgEl('defs');
      host.appendChild(defsHost);
      return defsHost;
    };
    if (App.layerTreeHasMask(layer)) {
      const ind = $('#sveMaskInd', App.defs);
      if (ind) addDefs().appendChild(ind.cloneNode(true));
    }
    $$('use', clone).forEach(u => {
      const h = (u.getAttribute('href') || '').replace(/^#/, '');
      if (h.indexOf('sveImg') !== 0) return;
      const d = $('#' + h, App.defs);
      if (d) addDefs().appendChild(d.cloneNode(true));
    });
    $$('[fill]', clone).forEach(el => {
      const m = /url\(#(svePat\d+)\)/.exec(el.getAttribute('fill') || '');
      if (!m) return;
      const d = $('#' + m[1], App.defs);
      if (!d) return;
      const host = addDefs();
      if (!$('#' + m[1], host)) host.appendChild(d.cloneNode(true));
    });
    host.appendChild(clone);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(host)], { type: 'image/svg+xml' }));
    return loadImage(url).then(im => {
      URL.revokeObjectURL(url);
      const { canvas } = fitDrawRect(im, size);
      const out = canvas.toDataURL();
      layer.rasterCache = { size, url: out };
      layer.thumbCache = out;
      layer.thumbDirty = false;
      return out;
    }).catch(e => {
      URL.revokeObjectURL(url);
      console.warn('[thumb] SVG 图层光栅化失败', layer && layer.id, String(e && e.message || e).slice(0, 160));
      return '';
    });
  } catch (e) {
    console.warn('[thumb] SVG 图层光栅化初始化失败', layer && layer.id, String(e && e.message || e).slice(0, 160));
    return Promise.resolve('');
  }
};

App.getLayerThumb = function (layer) {
  if (layer.thumbCache && !layer.thumbDirty) return Promise.resolve(layer.thumbCache);
  if (layer.isMask) return Promise.resolve('');
  const done = url => { layer.thumbCache = url; if (url) layer.thumbDirty = false; return url; };
  let p;
  if (layer.kind === 'symbol') {
    if (!layer.dataUri) p = Promise.resolve('');
    else if (layer.isMask) {
      p = App.maskThumbEntry(layer, 96).then(entry => {
        const out = App.renderTransformedThumb(entry.canvas, entry.rect, layer);
        return out ? out.toDataURL() : '';
      });
    } else {
      p = App.silhouetteCanvas(layer.dataUri, layer.color || '#ffffff', 96).then(entry => {
        if (!entry) return '';
        const out = App.renderTransformedThumb(entry.canvas, entry.rect, layer);
        return out ? out.toDataURL() : '';
      });
    }
  } else if (layer.kind === 'pattern') {
    const base = layer.isMask ? App.maskIndicatorCanvas(96) : App.patternThumbCanvas(layer.patternKey, layer.color, 96);
    const out = App.renderTransformedThumb(base, { x: 0, y: 0, w: 96, h: 96 }, layer);
    p = Promise.resolve(out ? out.toDataURL() : '');
  } else {
    p = (layer.kind === "merged") ? App.mergedThumbUrl(layer, 96) : App.svgRasterThumb(layer);
  }
  return p.then(done);
};

App.doRefreshLayerThumbs = function () {
  App.fillVisibleThumbs();
};
App.refreshLayerThumbs = function () {
  if (App.thumbTimer) clearTimeout(App.thumbTimer);
  App.thumbTimer = setTimeout(() => { App.thumbTimer = null; App.doRefreshLayerThumbs(); }, 60);
};

App.proxyEnabled = false;
App.proxyThreshold = 400;
App._proxyBake = new Map();      // merged.id -> {canvas, minx, miny, bw, bh, f}
App._proxyQueue = new Map();
App._proxyTimer = null;

App.maybeBakeProxy = function (merged) {
  if (!App.proxyEnabled) {
    try { if (App._proxyBake && App._proxyBake.has(merged.id) && App.unbakeProxy) App.unbakeProxy(merged); } catch (e) { }
    return;
  }
  if (!merged || merged.kind !== 'merged' || !merged.el) return;
  if (App.countInLayer(merged) <= App.proxyThreshold) return;
  if (App._proxyBake.has(merged.id)) return;
  App._enqueueProxyBake(merged);
};
App.markProxyDirty = function (merged) {
  if (merged && merged.kind === 'merged' && App._proxyBake.has(merged.id)) {
    App._enqueueProxyBake(merged);
  }
};
App.unbakeProxy = function (merged) {
  if (!merged) return;
  merged.__proxyEpoch = (merged.__proxyEpoch || 0) + 1;
  App._proxyQueue.delete(merged.id);
  const rec = App._proxyBake.get(merged.id);
  if (rec && rec.url) { try { URL.revokeObjectURL(rec.url); } catch (e) { /* ignore */ } }
  if (rec && rec.baseUrl) { try { URL.revokeObjectURL(rec.baseUrl); } catch (e) { /* ignore */ } }
  if (rec && rec.baseMaskUrl) { try { URL.revokeObjectURL(rec.baseMaskUrl); } catch (e) { /* ignore */ } }
  App._proxyBake.delete(merged.id);
  if (merged.el) {
    merged.el.querySelectorAll('image[data-proxy]').forEach(img => img.remove());
    merged.el.querySelectorAll('[data-layer]').forEach(el => el.removeAttribute('visibility'));
    merged._localBB = undefined;
  }
  (merged.children || []).forEach(ch => { if (ch.kind === 'merged') App.unbakeProxy(ch); });
};
App.impBitmapThreshold = 300;
App.impBitmapMaxSide = 512;
App.impBakeQueue = [];
App.impBakeTimer = null;

App.impBitmapActive = function () {
  let n = 0;
  for (let i = 0; i < App.state.layers.length; i++) {
    if (App.state.layers[i].kind === 'import') { n++; if (n >= App.impBitmapThreshold) return true; }
  }
  return false;
};
App.impIsInteractive = function (layer) {
  if (!layer || layer.kind !== 'import') return false;
  if (App.state.selected.has(layer.id)) return true;
  const box = App.whiteBoxLayer ? App.whiteBoxLayer() : null;
  if (box === layer) return true;
  if (App.state.edit) {
    const t = App.editTargets();
    for (let i = 0; i < t.length; i++) if (t[i] === layer) return true;
  }
  return false;
};
App.impEnsureEl = function (layer) {
  if (!layer.el || layer.bitmapEl) return;
  const img = svgEl('image', {
    x: -layer.w / 2, y: -layer.h / 2, width: layer.w, height: layer.h,
    preserveAspectRatio: 'none', 'pointer-events': 'none', class: 'sve-imp-bitmap'
  });
  layer.el.insertBefore(img, layer.el.firstChild);
  layer.bitmapEl = img;
};
App.impBakeLayer = function (layer) {
  if (!layer || layer.kind !== 'import' || layer.isMask) return;
  if (layer.w > App.impBitmapMaxSide || layer.h > App.impBitmapMaxSide) return;
  if (layer.impBaking || (layer.impBitmapUrl && !layer.impBitmapDirty)) return;
  if (/url\(#/.test(layer.importMarkup || '')) return;
  layer.impBaking = true;
  const w = Math.max(1, Math.round(layer.w)), h = Math.max(1, Math.round(layer.h));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="' +
    (-w / 2) + ' ' + (-h / 2) + ' ' + w + ' ' + h + '">' + (layer.importMarkup || '') + '</svg>';
  let url = null;
  try { url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); } catch (e) { layer.impBaking = false; return; }
  const img = new Image();
  img.onload = () => {
    layer.impBaking = false;
    if (layer.impBitmapUrl && layer.impBitmapUrl !== url) URL.revokeObjectURL(layer.impBitmapUrl);
    layer.impBitmapUrl = url;
    layer.impBitmapDirty = false;
    App.updateImpDisplay(layer);
  };
  img.onerror = () => { layer.impBaking = false; URL.revokeObjectURL(url); };
  img.src = url;
};
App.impQueueBake = function (layer) {
  if (!layer || layer.impBaking || (layer.impBitmapUrl && !layer.impBitmapDirty)) return;
  if (App.impBakeQueue.indexOf(layer) >= 0) return;
  App.impBakeQueue.push(layer);
  if (App.impBakeTimer) return;
  App.impBakeTimer = setInterval(() => {
    let done = 0;
    while (App.impBakeQueue.length && done < 8) {
      const l = App.impBakeQueue.shift();
      if (l && l.el && l.kind === 'import') App.impBakeLayer(l);
      done++;
    }
    if (!App.impBakeQueue.length) { clearInterval(App.impBakeTimer); App.impBakeTimer = null; }
  }, 50);
};
App.updateImpDisplay = function (layer) {
  if (!layer || layer.kind !== 'import') return;
  if (!App.impBitmapActive()) return;
  const interactive = App.impIsInteractive(layer);
  if (interactive) {
    if (layer.innerEl && layer.innerEl.style.display !== '') layer.innerEl.style.display = '';
    if (layer.bitmapEl && layer.bitmapEl.style.display !== 'none') layer.bitmapEl.style.display = 'none';
  } else if (layer.impBitmapUrl && !layer.impBitmapDirty) {
    App.impEnsureEl(layer);
    if (layer.bitmapEl.getAttribute('href') !== layer.impBitmapUrl) layer.bitmapEl.setAttribute('href', layer.impBitmapUrl);
    if (layer.innerEl && layer.innerEl.style.display !== 'none') layer.innerEl.style.display = 'none';
    if (layer.bitmapEl.style.display !== '') layer.bitmapEl.style.display = '';
  } else {
    if (layer.innerEl && layer.innerEl.style.display !== '') layer.innerEl.style.display = '';
    if (layer.bitmapEl && layer.bitmapEl.style.display !== 'none') layer.bitmapEl.style.display = 'none';
    App.impQueueBake(layer);
  }
};
App.refreshImpBitmaps = function () {
  if (!App.impBitmapActive()) return;
  for (let i = 0; i < App.state.layers.length; i++) {
    if (App.state.layers[i].kind === 'import') App.updateImpDisplay(App.state.layers[i]);
  }
};
App.impMarkDirty = function (layer) {
  if (!layer || layer.kind !== 'import') return;
  layer.impBitmapDirty = true;
  App.updateImpDisplay(layer);
};
App.impCleanup = function (layer) {
  if (!layer) return;
  if (layer.impBitmapUrl) { try { URL.revokeObjectURL(layer.impBitmapUrl); } catch (e) { /* ignore */ } }
  layer.impBitmapUrl = null;
  layer.impBitmapDirty = false;
  layer.bitmapEl = null;
};

App._drainProxyBakeQueue = function () {
  App._proxyTimer = null;
  if (App.renderInteractionBusy && App.renderInteractionBusy()) {
    App._proxyTimer = setTimeout(App._drainProxyBakeQueue, 120);
    return;
  }
  const entries = Array.from(App._proxyQueue.values());
  App._proxyQueue.clear();
  entries.forEach(m => {
    try { App._bakeProxyAsync(m); }
    catch (err) { console.warn('[proxy-bake] 烘焙异常', m.id, String(err).slice(0, 200)); }
  });
};
App._enqueueProxyBake = function (merged) {
  App._proxyQueue.set(merged.id, merged);
  if (App._proxyTimer) return;
  App._proxyTimer = setTimeout(App._drainProxyBakeQueue, 80);
};
App._bakeProxyAsync = function (merged) {
  if (!merged || merged.kind !== 'merged' || !merged.el) return;
  const bakeToken = (merged.__proxyEpoch = (merged.__proxyEpoch || 0) + 1);
  App._proxyBaking = App._proxyBaking || {};
  App._proxyBaking[merged.id] = true;
  merged.__bakeT0 = performance.now();
  const leaves = [];
  const walk = l => { if (l.kind === 'merged') (l.children || []).forEach(walk); else leaves.push(l); };
  (merged.children || []).forEach(walk);
  if (!leaves.length) return;
  const chainToGroup = el => {
    const chain = [];
    let e = el;
    while (e && e.nodeType === 1 && e !== merged.el && e !== App.layersRoot && e !== App.svg) {
      chain.push(e.getAttribute('transform'));
      e = e.parentNode;
    }
    let m = new DOMMatrix();
    for (let i = chain.length - 1; i >= 0; i--) m = m.multiply(parseTransformAttr(chain[i]));
    return m;
  };
  const mats = leaves.map(l => chainToGroup(l.el));
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  const SLICE_MS = 8;
  let i = 0;
  const bboxStep = () => {
    if (App.renderInteractionBusy && App.renderInteractionBusy()) { setTimeout(bboxStep, 60); return; }
    const tS = performance.now();
    do {
      const hw = (leaves[i].w || 0) / 2, hh = (leaves[i].h || 0) / 2;
      [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].forEach(p => {
        const r = new DOMPoint(p[0], p[1]).matrixTransform(mats[i]);
        minx = Math.min(minx, r.x); maxx = Math.max(maxx, r.x);
        miny = Math.min(miny, r.y); maxy = Math.max(maxy, r.y);
      });
      i++;
    } while (i < leaves.length && performance.now() - tS < SLICE_MS);
    if (i < leaves.length) { setTimeout(bboxStep, 0); return; }
    if (!isFinite(minx)) return;
    const bw = Math.max(1, maxx - minx), bh = Math.max(1, maxy - miny);
    const needF = App.proxyNeedF(merged);
    const fWant = Math.max(0.2, needF * 1.15);
    const CROP_PX_BUDGET = 6.0e6;
    const cropMax = Math.max(1, Math.min(4096, Math.sqrt(CROP_PX_BUDGET)) / fWant);
    let cx0 = minx, cy0 = miny, cw0 = bw, ch0 = bh;
    const vrect = App.proxyLocalViewRect(merged, 0);
    if (vrect) {
      const ix0 = Math.max(minx, vrect.minx), iy0 = Math.max(miny, vrect.miny);
      const ix1 = Math.min(maxx, vrect.maxx), iy1 = Math.min(maxy, vrect.maxy);
      if (ix1 > ix0 && iy1 > iy0) {
        const vcx = (ix0 + ix1) / 2, vcy = (iy0 + iy1) / 2;
        const half = cropMax / 2;
        const gx0 = Math.max(minx, vcx - half), gy0 = Math.max(miny, vcy - half);
        const gx1 = Math.min(maxx, vcx + half), gy1 = Math.min(maxy, vcy + half);
        if (gx1 > gx0 && gy1 > gy0) { cx0 = gx0; cy0 = gy0; cw0 = gx1 - gx0; ch0 = gy1 - gy0; }
      }
    }
    const screenScale = App.state.view.scale || 1;
    const dpr = window.devicePixelRatio || 1;
    const target = Math.max(2048, Math.ceil(Math.max(bw, bh) * screenScale * dpr));
    const f = Math.max(0.2, Math.min(fWant, 4096 / Math.max(cw0, ch0)));
    const cw = Math.max(1, Math.round(cw0 * f)), ch = Math.max(1, Math.round(ch0 * f));
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const cx = cv.getContext('2d');
    Promise.all(leaves.map(l => App.symbolColorUrl(l).catch(() => ''))).then(urls => {
      const uniq = Array.from(new Set(urls.filter(Boolean)));
      const tLoad = performance.now();
      return App.loadBakeImages(uniq, '[proxy-bake] 图片加载异常').then(byUrl => {
        const imgs = urls.map(u => (u ? (byUrl.get(u) || null) : null));
        const drawLeaf = (ctx2, di2, f2, ox, oy) => {
          const img = imgs[di2];
          if (!img) return;
          const l = leaves[di2];
          ctx2.save();
          const T = new DOMMatrix().translate(-ox * f2, -oy * f2).scale(f2).multiply(mats[di2]);
          ctx2.setTransform(T.a, T.b, T.c, T.d, T.e, T.f);
          ctx2.globalAlpha = (l && l.opacity >= 0 && l.opacity <= 1) ? l.opacity : 1;
          ctx2.drawImage(img, 0, 0, img.width, img.height, -(l.w || 0) / 2, -(l.h || 0) / 2, l.w || 0, l.h || 0);
          ctx2.restore();
        };
        const bakeBase = () => {
          const fBase = Math.max(0.05, Math.min(2, 2048 / Math.max(bw, bh)));
          const bcv = document.createElement('canvas');
          bcv.width = Math.max(1, Math.round(bw * fBase));
          bcv.height = Math.max(1, Math.round(bh * fBase));
          const bctx = bcv.getContext('2d');
          let bi = 0;
          const baseStep = () => {
            if (App.renderInteractionBusy && App.renderInteractionBusy()) { setTimeout(baseStep, 60); return; }
            const tS = performance.now();
            do { drawLeaf(bctx, bi, fBase, minx, miny); bi++; }
            while (bi < leaves.length && performance.now() - tS < SLICE_MS);
            if (bi < leaves.length) { setTimeout(baseStep, 0); return; }
            try { App._installProxyBase(merged, bcv, minx, miny, bw, bh, fBase, bakeToken); }
            catch (err) { console.warn('[proxy-bake] 底图安装异常', merged.id, String(err).slice(0, 200)); }
          };
          baseStep();
        };
        let di = 0;
        const tDraw = performance.now();
        const drawStep = () => {
          if (App.renderInteractionBusy && App.renderInteractionBusy()) { setTimeout(drawStep, 60); return; }
          const tS = performance.now();
          do {
            drawLeaf(cx, di, f, cx0, cy0);
            di++;
          } while (di < leaves.length && performance.now() - tS < SLICE_MS);
          if (di < leaves.length) { setTimeout(drawStep, 0); return; }
          try {
            App._installProxy(merged, cv, cx0, cy0, cw0, ch0, f,
              { leaves: leaves.length, uniqUrls: uniq.length, loadMs: Math.round(performance.now() - tLoad), drawMs: Math.round(performance.now() - tDraw),
                needF: needF, full: { minx: minx, miny: miny, bw: bw, bh: bh }, token: bakeToken });
            if (bakeToken === merged.__proxyEpoch) bakeBase();
          }
          catch (err) { console.warn('[proxy-bake] 安装异常', merged.id, String(err).slice(0, 200)); }
          finally { if (App._proxyBaking) delete App._proxyBaking[merged.id]; }
        };
        drawStep();
      }).catch(err => console.warn('[proxy-bake] 图片加载异常', merged.id, String(err).slice(0, 200)));
    }).catch(err => console.warn('[proxy-bake] 剪影生成异常', merged.id, String(err).slice(0, 200)));
  };
  bboxStep();
};
App._installProxy = function (merged, cv, minx, miny, bw, bh, f, stat) {
  if (!merged.el) return;
  if (stat && stat.token !== undefined && stat.token !== merged.__proxyEpoch) return;
  if (!App.state || !App.state.layers || App.state.layers.indexOf(merged) < 0) return;
  const rec0 = App._proxyBake.get(merged.id);
  const tEnc = performance.now();
  cv.toBlob(blob => {
    let url = null;
    try { url = blob ? URL.createObjectURL(blob) : cv.toDataURL(); }
    catch (e) { console.warn('[proxy-bake] PNG 编码失败', merged.id, String(e && e.message || e).slice(0, 160)); }
    if (!url) return;
    const warm = new Image();
    warm.src = url;
    const done = () => {
      if ((stat && stat.token !== undefined && stat.token !== merged.__proxyEpoch) ||
          !merged.el || !App.state || App.state.layers.indexOf(merged) < 0) {
        if (url.indexOf('blob:') === 0) { try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } }
        return;
      }
      const fresh = svgEl('image', {
        'data-proxy': '1', href: url,
        x: minx, y: miny, width: bw, height: bh,
        preserveAspectRatio: 'none'
      });
      const current = merged.el.querySelector(':scope > image[data-proxy="1"]');
      if (current && current.parentNode === merged.el) merged.el.insertBefore(fresh, current);
      else merged.el.appendChild(fresh);
      if (current) current.remove();
      merged.el.querySelectorAll('[data-layer]').forEach(el => el.setAttribute('visibility', 'hidden'));
      const prev = App._proxyBake.get(merged.id) || rec0;
      App._proxyBake.set(merged.id, Object.assign({}, prev || {}, {
        canvas: cv, minx, miny, bw, bh, f, url: url.indexOf('blob:') === 0 ? url : null,
        needF: (stat && stat.needF) || 0, full: (stat && stat.full) || null
      }));
      if (prev && prev.url && prev.url !== url) { try { URL.revokeObjectURL(prev.url); } catch (e) { /* ignore */ } }
      merged._localBB = undefined;
      try {
        const t0 = merged.__bakeT0 || 0;
        App.log('perf', '分组烘焙阶段', { merged: merged.id, totalMs: Math.round(performance.now() - t0),
          encodeMs: Math.round(performance.now() - tEnc), leaves: stat && stat.leaves, uniqUrls: stat && stat.uniqUrls,
          loadMs: stat && stat.loadMs, drawMs: stat && stat.drawMs, w: cv.width, h: cv.height, f: f });
      } catch (e) { /* ignore */ }
    };
    const fail = () => {
      console.warn('[proxy-bake] 代理位图解码失败', merged.id);
      if (url.indexOf('blob:') === 0) { try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } }
    };
    if (warm.decode) warm.decode().then(done, fail); else setTimeout(done, 400);
  }, 'image/png');
};
App._installProxyBase = function (merged, cv, minx, miny, bw, bh, fBase, token) {
  if (!merged || !merged.el) return;
  if (token !== undefined && token !== merged.__proxyEpoch) return;
  if (!App.state || !App.state.layers || App.state.layers.indexOf(merged) < 0) return;
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = cv.width; maskCanvas.height = cv.height;
  const maskCtx = maskCanvas.getContext('2d');
  maskCtx.drawImage(cv, 0, 0);
  maskCtx.globalCompositeOperation = 'source-in';
  maskCtx.fillStyle = '#ffffff';
  maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
  maskCtx.globalCompositeOperation = 'source-over';
  const tEnc = performance.now();
  const asBlob = canvas => new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  Promise.all([asBlob(cv), asBlob(maskCanvas)]).then(parts => {
    const url = parts[0] ? URL.createObjectURL(parts[0]) : null;
    const maskUrl = parts[1] ? URL.createObjectURL(parts[1]) : null;
    if (token !== undefined && token !== merged.__proxyEpoch) {
      if (url) { try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } }
      if (maskUrl) { try { URL.revokeObjectURL(maskUrl); } catch (e) { /* ignore */ } }
      return;
    }
    if (!url || !maskUrl) {
      if (url) { try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } }
      if (maskUrl) { try { URL.revokeObjectURL(maskUrl); } catch (e) { /* ignore */ } }
      console.warn('[proxy-bake] 底图或剪影编码失败', merged.id);
      return;
    }
    let installAttempts = 0;
    const done = () => {
      if ((token !== undefined && token !== merged.__proxyEpoch) || !merged.el || App.state.layers.indexOf(merged) < 0) {
        try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
        try { URL.revokeObjectURL(maskUrl); } catch (e) { /* ignore */ }
        return;
      }
      const cur = App._proxyBake.get(merged.id);
      if (!cur) {
        if (++installAttempts < 100) { setTimeout(done, 20); return; }
        try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
        try { URL.revokeObjectURL(maskUrl); } catch (e) { /* ignore */ }
        console.warn('[proxy-bake] 底图等待裁剪图超时', merged.id);
        return;
      }
      const cropImg = merged.el.querySelector(':scope > image[data-proxy="1"]');
      const old = merged.el.querySelector(':scope > image[data-proxy-base="1"]');
      const fresh = svgEl('image', {
        'data-proxy-base': '1', 'data-proxy': 'base', href: url,
        x: minx, y: miny, width: bw, height: bh,
        preserveAspectRatio: 'none', 'pointer-events': 'none'
      });
      if (old && old.parentNode === merged.el) merged.el.insertBefore(fresh, old);
      else if (cropImg) merged.el.insertBefore(fresh, cropImg);
      else merged.el.appendChild(fresh);
      if (old) old.remove();
      if (cur.baseUrl && cur.baseUrl !== url) { try { URL.revokeObjectURL(cur.baseUrl); } catch (e) { /* ignore */ } }
      if (cur.baseMaskUrl && cur.baseMaskUrl !== maskUrl) { try { URL.revokeObjectURL(cur.baseMaskUrl); } catch (e) { /* ignore */ } }
      App._proxyBake.set(merged.id, Object.assign({}, cur, {
        baseCanvas: cv, baseF: fBase, baseUrl: url, baseMaskUrl: maskUrl,
        baseMinx: minx, baseMiny: miny, baseBw: bw, baseBh: bh
      }));
      try { App.log('perf', '底图烘焙', { merged: merged.id, w: cv.width, h: cv.height, f: fBase, encodeMs: Math.round(performance.now() - tEnc) }); } catch (e) { /* ignore */ }
    };
    const fail = () => {
      try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
      try { URL.revokeObjectURL(maskUrl); } catch (e) { /* ignore */ }
      console.warn('[proxy-bake] 底图预解码失败', merged.id);
    };
    Promise.all([loadImage(url), loadImage(maskUrl)]).then(done, fail);
  }).catch(e => console.warn('[proxy-bake] 底图编码异常', merged.id, String(e && e.message || e).slice(0, 160)));
};
App.proxyLocalViewRect = function (merged, pad) {
  try {
    const r = App.wrap.getBoundingClientRect();
    const v = App.state.view;
    const sc = v.scale || 1;
    const pd = typeof pad === 'number' ? pad : 0;
    const vx = v.x - (r.width / sc) * pd, vy = v.y - (r.height / sc) * pd;
    const vw = (r.width / sc) * (1 + pd * 2), vh = (r.height / sc) * (1 + pd * 2);
    const m = App.transformChainMat ? App.transformChainMat(merged) : null;
    if (!m) return null;
    const inv = m.inverse();
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    [[vx, vy], [vx + vw, vy], [vx, vy + vh], [vx + vw, vy + vh]].forEach(function (pt) {
      const o = new DOMPoint(pt[0], pt[1]).matrixTransform(inv);
      minx = Math.min(minx, o.x); maxx = Math.max(maxx, o.x);
      miny = Math.min(miny, o.y); maxy = Math.max(maxy, o.y);
    });
    if (!isFinite(minx)) return null;
    return { minx: minx, miny: miny, maxx: maxx, maxy: maxy };
  } catch (e) { return null; }
};
App.proxyGroupScale = function (merged) {
  try {
    const m = App.transformChainMat ? App.transformChainMat(merged) : null;
    if (!m) return 1;
    const det = Math.abs(m.a * m.d - m.b * m.c);
    return det > 0 ? Math.sqrt(det) : 1;
  } catch (e) { return 1; }
};
App.proxyNeedF = function (merged) {
  const dpr = window.devicePixelRatio || 1;
  return (App.state.view.scale || 1) * dpr * App.proxyGroupScale(merged);
};
App.proxyViewHasContent = function (merged) {
  const vr = App.proxyLocalViewRect(merged, 0);
  if (!vr || !merged || !merged.el) return true;
  const bb = App.getItemDocBBox ? null : null;
  const rec = App._proxyBake ? App._proxyBake.get(merged.id) : null;
  const full = (rec && rec.full) || null;
  if (!full) return true;
  const ix0 = Math.max(vr.minx, full.minx), iy0 = Math.max(vr.miny, full.miny);
  const ix1 = Math.min(vr.maxx, full.minx + full.bw), iy1 = Math.min(vr.maxy, full.miny + full.bh);
  return ix1 > ix0 && iy1 > iy0;
};
App.proxyCropCoversView = function (merged, rec) {
  const vr = App.proxyLocalViewRect(merged, 0);
  if (!vr || !rec || !rec.full) return true;
  const fx0 = rec.full.minx, fy0 = rec.full.miny;
  const fx1 = fx0 + rec.full.bw, fy1 = fy0 + rec.full.bh;
  const ix0 = Math.max(vr.minx, fx0), iy0 = Math.max(vr.miny, fy0);
  const ix1 = Math.min(vr.maxx, fx1), iy1 = Math.min(vr.maxy, fy1);
  if (ix1 <= ix0 || iy1 <= iy0) return true;
  const eps = 1;
  return rec.minx <= ix0 + eps && rec.miny <= iy0 + eps &&
    (rec.minx + rec.bw) >= ix1 - eps && (rec.miny + rec.bh) >= iy1 - eps;
};
App.maybeUpgradeProxyRes = function () {
  if (!App.proxyEnabled) return;
  if (!App._proxyBake || !App._proxyBake.size) return;
  const scale = App.state.view.scale || 1;
  const dpr = window.devicePixelRatio || 1;
  App._proxyBake.forEach((rec, id) => {
    try {
      if (!rec || !rec.f) return;
      const m = App.findLayer(id);
      if (!m || m.kind !== 'merged') return;
      if (App._proxyQueue.has(id)) return;
      if (App._proxyBaking && App._proxyBaking[id]) return;
      if (!App.proxyViewHasContent(m)) return;
      const needF = App.proxyNeedF(m);
      const resShort = rec.f < needF * 0.85;
      const resFat = rec.f > needF * 1.15 * 2.2;
      const cover = App.proxyCropCoversView(m, rec);
      if (resShort || resFat || !cover) App.markProxyDirty(m);

    } catch (e) { /* ignore */ }
  });
};
App.proxySampleColor = function (merged, clientX, clientY) {
  const rec = App._proxyBake.get(merged && merged.id);
  if (!rec || !rec.canvas) return null;
  const p = App.screenToDoc(clientX, clientY);
  let lp = p;
  try {
    const inv = App.transformChainMat(merged).inverse();
    const q = new DOMPoint(p.x, p.y).matrixTransform(inv);
    lp = { x: q.x, y: q.y };
  } catch (e) { /* ignore */ }
  const px = Math.round((lp.x - rec.minx) * rec.f);
  const py = Math.round((lp.y - rec.miny) * rec.f);
  if (px < 0 || py < 0 || px >= rec.canvas.width || py >= rec.canvas.height) return null;
  const ctx = rec.canvas.getContext('2d', { willReadFrequently: true });
  const d = ctx.getImageData(px, py, 1, 1).data;
  if (d[3] < 16) return null;
  return rgbToHex(d[0], d[1], d[2]);
};
