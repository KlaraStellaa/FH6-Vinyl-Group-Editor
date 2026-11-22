'use strict';
App.viewRevision = App.viewRevision || 0;
App.renderPerfCounters = App.renderPerfCounters || {
  viewCommits: 0, autoVisibleScans: 0, autoVisibleLeaves: 0,
  autoBakeStarts: 0, autoBakeCancels: 0, autoBakeInstalls: 0
};
App.renderTaskTrace = App.renderTaskTrace || [];
App.dr = function (name, fields) {
  try { if (App.diagRender) App.diagRender.ev(name, fields); } catch (e) {   }
};
App.drb = function (key, n) {
  try { if (App.diagRender) App.diagRender.bump(key, n); } catch (e) {   }
};
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
  try { App.flashG.style.setProperty('--sve-flash-color', 'rgb(235,234,58)'); }
  catch (e) { console.warn('[render] 闪动颜色初始化失败', e); }
  try {
    window.addEventListener('blur', function () { if (App.clearFlash) App.clearFlash(); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden' && App.clearFlash) App.clearFlash();
    });
  } catch (e) {   }
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
  const g = App.GRID_STEP || 20;
  const N = 3;
  const P = g / N;                     
  const dash = P * 0.5, gap = P * 0.5; 
  const off = dash / 2;                
  const col = 'rgba(0,0,0,0.26)';
  const base = {
    fill: 'none', stroke: col, 'stroke-width': 1,
    'vector-effect': 'non-scaling-stroke',
    'stroke-dasharray': dash + ' ' + gap,
    'stroke-dashoffset': off,
    'stroke-linecap': 'butt'
  };
  const p = svgEl('pattern', { id: 'sveGridP', width: g, height: g, patternUnits: 'userSpaceOnUse' });
  App.gridPathH = svgEl('path', Object.assign({}, base, { d: 'M ' + g + ' 0 L 0 0' }));
  App.gridPathV = svgEl('path', Object.assign({}, base, { d: 'M 0 0 L 0 ' + g }));
  p.appendChild(App.gridPathH);
  p.appendChild(App.gridPathV);
  App.defs.appendChild(p);
  App.gridPath = App.gridPathH;    
};
App.updateGridStroke = function () {
  const col = App.state.bg.base === 'light' ? 'rgba(0,0,0,0.26)' : 'rgba(255,255,255,0.20)';
  if (App.gridPathH) App.gridPathH.setAttribute('stroke', col);
  if (App.gridPathV) App.gridPathV.setAttribute('stroke', col);
  if (App.gridCross) { App.gridCross.remove(); App.gridCross = null; }    
};App.updateGridRect = function () {
  const v = App.state.view, w = App.wrap.clientWidth, h = App.wrap.clientHeight;
  App.gridRect.setAttribute('x', v.x - 4);
  App.gridRect.setAttribute('y', v.y - 4);
  App.gridRect.setAttribute('width', w / v.scale + 8);
  App.gridRect.setAttribute('height', h / v.scale + 8);
  if (App.updateGridVisibility) App.updateGridVisibility();
};
App.updateView = function () {
  App.viewRevision = (App.viewRevision || 0) + 1;
  App.renderPerfCounters.viewCommits++;
  App._viewMutT = performance.now();
  if (App.layersRoot && App.layersRoot.style.display === 'none' && !(App.state && App.state.batching) &&
      !(App.state && App.state.layersHidden) && !(App.state && App.state.eyeMode === 'bg') &&
      !(App.staticOverlayBusy && App.staticOverlayBusy())) {
    App.layersRoot.style.display = '';
  }
  const r = App.wrap.getBoundingClientRect();
  const v = App.state.view;
  App.svg.setAttribute('viewBox', v.x + ' ' + v.y + ' ' + (r.width / v.scale) + ' ' + (r.height / v.scale));
  if (App.staticOverlayUpdate) App.staticOverlayUpdate();
  App.updateGridRect();
  if (App.updateEditStaticViewport) App.updateEditStaticViewport();
  if (App.syncFlashCompositing) App.syncFlashCompositing();
  if (App.maybeUpgradeProxyRes) App.maybeUpgradeProxyRes();
  if (App.autoStaticMaybe) App.autoStaticMaybe();
  try {
    if (App.Tabs && App.Tabs.current && App.Tabs.current.data) {
      App.Tabs.current.data.view = { x: App.state.view.x, y: App.state.view.y, scale: App.state.view.scale };
    }
  } catch (e) {   }
  const _am = App.state.editMode;
  if (App.drawAnchorIcon && (_am === 'size' || _am === 'rotate' || _am === 'skew')) App.drawAnchorIcon();
  if (App.scheduleLodRefresh) App.scheduleLodRefresh();
  try {
    if (App._viewCommitTimer) clearTimeout(App._viewCommitTimer);
    App._viewCommitTimer = setTimeout(function () {
      App._viewCommitTimer = null;
      App.dr('view.commit', { v: App.viewRevision || 0, f: App.state.view.scale });
    }, 220);
  } catch (e) {   }
};

App.lod = {
  enabled: true,
  step: 1.25,                  
  minScale: 0.01,
  maxSide: 4096,               
  maxPixels: 8.4e6,            
  layerMaxSide: 768,           
  layerMaxPixels: 6e5,         
  minUpgrade: 1.5,
  debounceMs: 130,             
  maxLayersPerPass: 48,        
  maxInflight: 2,              
  maxPixelsPerPass: 1.2e7,     
  unknownNativeSide: 1024,     
  flashLeafMax: 256,           
  flashTotalPixels: 1.6e7,
  stats: { passes: 0, rebuilt: 0, offscreen: 0, capped: 0, bucket: 0, bucketScale: 1, lastPassMs: 0, walkMs: 0, texMaxSide: 0 }
};
App._texNative = new Map();
App.texNativeKey = function (uri) {
  if (!uri) return '';
  return uri.length + ':' + uri.slice(0, 48) + ':' + uri.slice(-32);
};
App.noteTexNative = function (uri, w, h) {
  if (!uri || !(w > 0) || !(h > 0)) return;
  App._texNative.set(App.texNativeKey(uri), Math.max(w, h));
};
App.lodNativeSide = function (layer) {
  if (!layer) return App.lod.unknownNativeSide;
  if (layer._texSide) return layer._texSide;
  const uri = layer.dataUri;
  if (!uri) return App.lod.unknownNativeSide;
  const v = App._texNative.get(App.texNativeKey(uri));
  if (v) { layer._texSide = v; return v; }
  return App.lod.unknownNativeSide;
};
App.lodBucketOf = function (scale) {
  const s = Math.max(App.lod.minScale, Number(scale) || 1);
  return Math.max(-24, Math.ceil(Math.log(s) / Math.log(App.lod.step) - 1e-9));
};
App.lodBucketScale = function (bucket) {
  return Math.pow(App.lod.step, Math.max(-24, bucket | 0));
};
App.lodTexPlan = function (layer, bucketOverride) {
  const dpr = window.devicePixelRatio || 1;
  const bucket = bucketOverride === undefined
    ? App.lodBucketOf(App.state && App.state.view ? App.state.view.scale : 1)
    : bucketOverride;
  const w = Math.max(1, Number(layer && layer.w) || 1);
  const h = Math.max(1, Number(layer && layer.h) || 1);
  const want = App.lodBucketScale(bucket) * dpr;
  const byNative = App.lodNativeSide(layer) / Math.max(w, h);
  const bySide = App.lod.layerMaxSide / Math.max(w, h);
  const byPixels = Math.sqrt(App.lod.layerMaxPixels / (w * h));
  let k = Math.max(0.02, Math.min(want, byNative, bySide, byPixels));
  const held = k > 1 && k < App.lod.minUpgrade;
  if (held) k = 1;
  const cappedBy = (held || k >= want * 0.999) ? '' : (byNative <= bySide && byNative <= byPixels ? 'native' : 'texture');
  const px = Math.max(1, Math.round(w * k));
  const py = Math.max(1, Math.round(h * k));
  return {
    bucket: bucket, dpr: dpr, k: k, want: want, held: held,
    px: px, py: py,
    capped: !!cappedBy,
    cappedBy: cappedBy,
    key: px + 'x' + py + '@' + dpr
  };
};
App.layerLodKey = function (layer) {
  if (!layer || layer.kind !== 'symbol' || layer.isMask) return '';
  return App.lodTexPlan(layer).key;
};
App.layerLodUrl = function (layer) {
  if (!layer || layer.kind !== 'symbol' || layer.isMask) {
    return App.symbolColorUrl ? App.symbolColorUrl(layer) : Promise.resolve('');
  }
  const plan = App.lodTexPlan(layer);
  return App.symbolColorUrl(layer, { k: plan.k });
};
App._lodQueue = null;          
App.lodGroupLocalView = function (group, cache) {
  if (cache.has(group)) return cache.get(group);
  let r = null;
  try { r = App.proxyLocalViewRect ? App.proxyLocalViewRect(group, 0.25) : null; } catch (e) { r = null; }
  cache.set(group, r);
  return r;
};
App.lodLeafNearRect = function (l, r) {
  if (!r) return true;
  const hw = Math.abs(Number(l.w) || 0) / 2, hh = Math.abs(Number(l.h) || 0) / 2;
  const sx = Math.abs(Number(l.sx) || 1), sy = Math.abs(Number(l.sy) || 1);
  const rad = Math.sqrt(hw * hw + hh * hh) * Math.max(sx, sy, 1e-6);
  const cx = Number(l.x) || 0, cy = Number(l.y) || 0;
  return cx + rad >= r.minx && cx - rad <= r.maxx && cy + rad >= r.miny && cy - rad <= r.maxy;
};
App.lodKeyArea = function (key, l) {
  const m = key ? /^(\d+)x(\d+)@/.exec(key) : null;
  if (m) return (Number(m[1]) || 1) * (Number(m[2]) || 1);
  return Math.max(1, Math.round(Number(l && l.w) || 1)) * Math.max(1, Math.round(Number(l && l.h) || 1));
};
App.lodInstalledPx = function (l) {
  const m = l && l._lodKey ? /^(\d+)x(\d+)@/.exec(l._lodKey) : null;
  if (m) return Number(m[1]) || 1;
  return Math.max(1, Math.round(Number(l && l.w) || 1));
};
App.lodBuildQueue = function (bucket, force) {
  const layers = (App.state && App.state.layers) || [];
  const vp = App.autoStaticViewportRect ? App.autoStaticViewportRect(0.25) : null;
  const groupCache = new Map();
  const list = [];
  let offscreen = 0, capped = 0;
  const consider = (l, localRect) => {
    if (!l || l.kind !== 'symbol' || l.isMask || !l.imgEl) return;
    if (App.symbolVecPath && App.symbolVecPath(l)) return;
    const plan = App.lodTexPlan(l, bucket);
    if (plan.cappedBy === 'texture') capped++;
    if (!force && l._lodKey === plan.key) return;
    if (!force && plan.px * plan.py <= App.lodKeyArea(l._lodKey, l)) return;    
    const near = localRect ? App.lodLeafNearRect(l, localRect)
      : (!vp || !App.layerInRect || App.layerInRect(l, vp));
    if (!near) { offscreen++; return; }
    list.push({ layer: l, plan: plan, area: (Number(l.w) || 0) * (Number(l.h) || 0) });
  };
  const walk = (node, group) => {
    const kids = node.children || [];
    for (let i = 0; i < kids.length; i++) {
      const ch = kids[i];
      if (ch && ch.kind === 'merged') { walk(ch, ch); continue; }
      const local = group && ch.el && ch.el.parentNode === group.el
        ? App.lodGroupLocalView(group, groupCache) : null;
      consider(ch, local);
    }
  };
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    if (l && l.kind === 'merged') walk(l, l);
    else consider(l, null);
  }
  list.sort((a, b) => b.area - a.area);
  App.lod.stats.capped = capped;
  App.lod.stats.offscreen = offscreen;
  return list;
};
App.refreshLayerLod = function (opts) {
  opts = opts || {};
  if (!App.lod.enabled) return 0;
  const layers = App.state && App.state.layers;
  if (!layers || !layers.length) return 0;
  if (App.autoStatic && (App.autoStatic.active || App.autoStatic.baking)) { App._lodQueue = null; return 0; }
  if (App.editStatic && (App.editStatic.active || App.editStatic.baking)) { App._lodQueue = null; return 0; }
  if (App.autoStaticEligible && App.autoStaticEligible()) { App._lodQueue = null; return 0; }
  const t0 = performance.now();
  const bucket = App.lodBucketOf(App.state.view.scale || 1);
  let q = App._lodQueue;
  if (!q || q.bucket !== bucket) {
    if (App.refreshImpBitmaps) App.refreshImpBitmaps();
    q = App._lodQueue = { bucket: bucket, list: App.lodBuildQueue(bucket, opts.force), i: 0, done: 0 };
    App.lod.stats.walkMs = Math.round((performance.now() - t0) * 10) / 10;
  }
  const list = q.list;
  if (q.i >= list.length) { App._lodQueue = null; return 0; }
  const limit = Math.max(1, opts.limit || App.lod.maxLayersPerPass);
  let px = 0, done = 0;
  while (q.i < list.length && done < limit) {
    if ((App._lodInflight || 0) >= App.lod.maxInflight) break;
    const entry = list[q.i];
    const cost = entry.plan.px * entry.plan.py;
    if (done && (px + cost > App.lod.maxPixelsPerPass || performance.now() - t0 > 8)) break;
    q.i++; done++;
    px += cost;
    try {
      const p = App.installSymbolColorUrl(entry.layer, entry.layer.imgEl, { lod: true });
      if (p && typeof p.then === 'function') {
        App._lodInflight = (App._lodInflight || 0) + 1;
        const done1 = function () { App._lodInflight = Math.max(0, (App._lodInflight || 1) - 1); };
        p.then(done1, done1);
      }
    } catch (e) { console.warn('[lod] 纹理重建失败', entry.layer && entry.layer.id, String(e && e.message || e).slice(0, 160)); }
  }
  q.done += done;
  App.lod.stats.passes++;
  App.lod.stats.rebuilt += done;
  App.lod.stats.bucket = bucket;
  App.lod.stats.bucketScale = App.lodBucketScale(bucket);
  App.lod.stats.lastPassMs = Math.round(performance.now() - t0);
  if (done) {
    App.lod.stats.texMaxSide = Math.max(App.lod.stats.texMaxSide, list[q.i - 1].plan.px);
    try {
      App.log('perf', 'LOD 纹理重建', {
        bucket: bucket, bucketScale: +App.lodBucketScale(bucket).toFixed(3), dpr: window.devicePixelRatio || 1,
        scale: +(App.state.view.scale || 1).toFixed(3), todo: list.length, rebuilt: done,
        px: Math.round(px), ms: App.lod.stats.lastPassMs, walkMs: App.lod.stats.walkMs
      });
    } catch (e) {   }
  }
  if (q.i < list.length) {
    if (App._lodDrainTimer) clearTimeout(App._lodDrainTimer);
    App._lodDrainTimer = setTimeout(function () {
      App._lodDrainTimer = null;
      App.refreshLayerLod(opts);
    }, 12);
  } else {
    App._lodQueue = null;
  }
  return done;
};
App._lodAppliedBucket = null;
App._lodLastAt = 0;
App._lodDirty = false;          
App.scheduleLodRefresh = function (delay) {
  if (!App.lod.enabled) return;
  const scale = (App.state && App.state.view ? App.state.view.scale : 1) || 1;
  const bucket = App.lodBucketOf(scale);
  const pending = !!App._lodQueue || !!App._lodDrainTimer;
  if (bucket === App._lodAppliedBucket && !pending && !App._lodDirty && !App._lodTimer) return;
  const now = performance.now();
  const stale = App._lodAppliedBucket !== null &&
    (bucket - App._lodAppliedBucket) >= 2 && (now - (App._lodLastAt || 0)) > 250;
  const wait = stale ? 0 : (typeof delay === 'number' ? delay : App.lod.debounceMs);
  if (App._lodTimer) clearTimeout(App._lodTimer);
  App._lodTimer = setTimeout(function () {
    App._lodTimer = null;
    App._lodDirty = false;
    App._lodLastAt = performance.now();
    App._lodAppliedBucket = App.lodBucketOf((App.state && App.state.view ? App.state.view.scale : 1) || 1);
    App.refreshLayerLod();
    if (App.refreshFlashLod) App.refreshFlashLod();
  }, wait);
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

App.editStatic = {
  active: false, baking: false, items: [], bit: null, view: null, failedTop: null,
  url: null,             
  bakingToken: 0,        
  _bakedInterMin: undefined,
  _bakedItems: null,     
  _bakedColorRev: -1,
  _bakedContentRev: -1,
  base: null,            
  baseUrl: null,
  _itemSet: null, _itemSetArr: null, _itemSetLen: -1, _itemSetVer: -1,
  _hideEpoch: 0, _run: null
};
App.editStaticBgEl = null;
App.editStaticBaseEl = null;    
App.editStaticBaseStageEl = null;
App._editStaticBaseTimer = null;
App._editStaticBaseToken = 0;
App._editStaticToken = 0;
App._editStaticEpoch = 0;
App.editStaticItemsVer = 0;
App.editStaticTouchItems = function () { App.editStaticItemsVer++; };
App.editStaticItemSet = function () {
  const es = App.editStatic;
  const arr = es.items || [];
  if (es._itemSetArr !== arr || es._itemSetLen !== arr.length || es._itemSetVer !== App.editStaticItemsVer) {
    es._itemSet = new Set(arr);
    es._itemSetArr = arr;
    es._itemSetLen = arr.length;
    es._itemSetVer = App.editStaticItemsVer;
  }
  return es._itemSet;
};
App.editStaticBumpToken = function () { App._editStaticToken++; };

App.editStaticViewportRect = function (pad) {
  const v = App.state.view;
  const r = App.wrap.getBoundingClientRect();
  const sc = v.scale || 1;
  const vw = r.width / sc, vh = r.height / sc;
  const p = (typeof pad === 'number') ? pad : 0.25;
  return { x: v.x - vw * p, y: v.y - vh * p, w: vw * (1 + p * 2), h: vh * (1 + p * 2), scale: sc };
};
App.editStaticRectF = function (rect) {
  const dpr = window.devicePixelRatio || 1;
  return Math.min((App.state.view.scale || 1) * dpr, 4096 / Math.max(1, Math.max(rect.w, rect.h)));
};
App.editStaticNeedF = function () {
  return (App.state.view.scale || 1) * (window.devicePixelRatio || 1);
};
App.editStaticCovers = function (rect, need) {
  if (!rect || !need) return false;
  const e = 0.5;
  return rect.x <= need.x + e && rect.y <= need.y + e &&
    (rect.x + rect.w) >= (need.x + need.w) - e && (rect.y + rect.h) >= (need.y + need.h) - e;
};
App.editStaticOverlap = function (rect, need) {
  if (!rect || !need) return 0;
  const x1 = Math.max(rect.x, need.x), y1 = Math.max(rect.y, need.y);
  const x2 = Math.min(rect.x + rect.w, need.x + need.w), y2 = Math.min(rect.y + rect.h, need.y + need.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  return ((x2 - x1) * (y2 - y1)) / Math.max(1, need.w * need.h);
};
App.editStaticLayerBBox = function (l) {
  try {
    return l.kind === 'merged'
      ? App.getItemDocBBox(l)
      : (App.modelBBox ? App.modelBBox(l) : App.getItemDocBBox(l));
  } catch (e) { return null; }
};
App.layerInRect = function (l, rc) {
  const b = App.editStaticLayerBBox(l);
  if (!b) return true;    
  return b.x < rc.x + rc.w && b.x + b.w > rc.x && b.y < rc.y + rc.h && b.y + b.h > rc.y;
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
  if (layer.kind === 'symbol') {
    return 'symbol:' + symbol + ':' + (layer.color || '#ffffff') +
      ':' + Math.round(layer.w || 0) + 'x' + Math.round(layer.h || 0);
  }
  if (layer.kind === 'pattern') return 'pattern:' + (layer.patternKey || '') + ':' + (layer.color || '#ffffff') + ':' + size;
  return 'import:' + layer.id + ':' + size;
};
App._bakeVecRaster = new Map();
App._bakeVecRasterSeq = 0;
App._bakeVecRasterPx = 0;
App._bakeVecRasterBudget = 3e8;
App._bakeVecRasterMaxSide = 2048;
App.BAKE_VEC_STEP = 1.5;
App.bakeVecRasterSnap = function (needSide) {
  const st = App.BAKE_VEC_STEP;
  const q = Math.pow(st, Math.ceil(Math.log(Math.max(1, needSide)) / Math.log(st)));
  return Math.max(16, Math.min(App._bakeVecRasterMaxSide, Math.round(q)));
};
App.bakeVecRasterDrop = function () {
  const n = App._bakeVecRaster.size;
  App._bakeVecRaster.clear();
  App._bakeVecRasterPx = 0;
  if (App.rasterStats) { try { App.rasterStats.noteDrop('vec', n); } catch (e) {   } }
};
App.BAKE_CULLED_URL = (function () {
  try {
    const c = document.createElement('canvas');
    c.width = 1; c.height = 1;
    c.getContext('2d').clearRect(0, 0, 1, 1);
    return c.toDataURL('image/png');
  } catch (e) {
    return 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  }
})();
App.bakeVecRasterGet = function (key) {
  const hit = App._bakeVecRaster.get(key);
  if (!hit) return null;
  hit.t = ++App._bakeVecRasterSeq;
  return hit;
};
App.bakeVecRasterPut = function (key, cv, px, side) {
  if (px > App._bakeVecRasterBudget) {
    if (App.rasterStats) { try { App.rasterStats.noteReject('vec', key, px); } catch (e) {   } }
    return;
  }
  const old = App._bakeVecRaster.get(key);
  if (old) { App._bakeVecRasterPx -= old.px; App._bakeVecRaster.delete(key); }
  const ev = (App.rasterStats && App.rasterStats.on) ? [] : null;    
  if (App._bakeVecRasterPx + px > App._bakeVecRasterBudget) {
    const arr = Array.from(App._bakeVecRaster.entries()).sort(function (a, b) { return a[1].t - b[1].t; });
    for (let i = 0; i < arr.length && App._bakeVecRasterPx + px > App._bakeVecRasterBudget; i++) {
      App._bakeVecRaster.delete(arr[i][0]);
      App._bakeVecRasterPx -= arr[i][1].px;
      if (ev) ev.push([arr[i][0], arr[i][1]]);
    }
  }
  App._bakeVecRaster.set(key, { c: cv, px: px, side: side || 0, t: ++App._bakeVecRasterSeq });
  App._bakeVecRasterPx += px;
  if (App.rasterStats) { try { App.rasterStats.notePut('vec', key, px, side, !!old, ev); } catch (e) {   } }
};
App.bakeSourceSize = function (leaves, f) {
  let side = 1;
  const list = leaves || [];
  for (let i = 0; i < list.length; i++) {
    const l = list[i];
    if (!l) continue;
    if (l.kind === 'import') continue;
    const nx = Number(l.sx), ny = Number(l.sy);
    const sx = (Number.isFinite(nx) && nx !== 0) ? Math.abs(nx) : 1;
    const sy = (Number.isFinite(ny) && ny !== 0) ? Math.abs(ny) : 1;
    const rot = Math.abs(Number(l.rot) || 0);
    const k = rot > 0.01 ? 1.5 : 1;
    const sd = Math.max((Number(l.w) || 0) * sx, (Number(l.h) || 0) * sy) * k;
    if (sd > side) side = sd;
  }
  const raw = Math.max(24, Math.min(512, side * (f || 1)));
  const q = App.bakeVecRasterSnap ? App.bakeVecRasterSnap(raw) : Math.ceil(raw);
  return Math.max(24, Math.min(512, q));
};
App.bakeLayerSource = function (layer, size, memo, opts, frame) {
  size = size || 256;
  const drawable = !!(opts && opts.drawable);
  if (layer && layer.isMask && layer.kind !== 'import') size = Math.max(size, 512);
  const key = App.bakeLayerSourceKey(layer, size);
  if (memo && memo.has(key)) return memo.get(key);
  let source;
  try {
    if (layer.kind === 'symbol' && !layer.dataUri && layer.symbolKey && App.relinkSymbolData) App.relinkSymbolData(layer);
    if (frame && layer.kind === 'import' && App.bakeFrameSource) {
      source = App.bakeFrameSource(layer, frame, size, (opts && opts.useKey) || null);
    }
    else if (layer.isMask && layer.kind !== 'import' && App.maskBakeUrl) source = App.maskBakeUrl(layer, size);
    else if (layer.kind === 'symbol') {
      const f = Number(opts && opts.f) || 0;
      const vurl = App.symbolVecUrl ? App.symbolVecUrl(layer) : '';
      if (vurl && f > 0) {
        const sym = App.symbolMap && App.symbolMap.get ? App.symbolMap.get(layer.symbolKey) : null;
        const sw0 = Math.max(1, (sym && sym.w) || layer.w || 1);
        const sh0 = Math.max(1, (sym && sym.h) || layer.h || 1);
        const want = App.bakeVecRasterSnap(Math.max(sw0, sh0) * f);
        const ck = 'v|' + (layer.symbolKey || '') + '|' + (layer.color || '#ffffff');
        const rc = opts && opts.pairCount ? (opts.pairCount.get(ck) || 0) : 2;
        if (rc < 2) {
          if (App.rasterStats) { try { App.rasterStats.skipOneShot(); } catch (e) {   } }
          source = Promise.resolve(vurl);
        }
        else {
        const hit = App.bakeVecRasterGet(ck);
        const hitOk = !!(hit && (hit.side || 0) >= want);
        let vd = null;
        if (App.rasterStats) {
          try { vd = App.rasterStats.verdict('vec', ck, hitOk, want, { present: !!hit }); } catch (e) { vd = null; }
        }
        if (hitOk) source = Promise.resolve(hit.c);
        else {
          const k = want / Math.max(sw0, sh0);
          const W = Math.max(1, Math.round(sw0 * k));
          const H = Math.max(1, Math.round(sh0 * k));
          const tMiss = App.rasterStats ? App.rasterStats.missStart() : 0;
          source = loadImage(vurl).then(function (img) {
            if (!img) return '';
            const cv = document.createElement('canvas');
            cv.width = W; cv.height = H;
            const cx = cv.getContext('2d');
            cx.imageSmoothingEnabled = true;
            cx.imageSmoothingQuality = 'high';
            cx.drawImage(img, 0, 0, img.naturalWidth || img.width, img.naturalHeight || img.height, 0, 0, W, H);
            App.bakeVecRasterPut(ck, cv, W * H, want);
            if (App.noteBakeProgress) App.noteBakeProgress();
            if (App.rasterStats) { try { App.rasterStats.missEnd(tMiss, vd && vd.cls); } catch (e) {   } }
            return cv;
          });
        }
        }
      } else if (vurl) {
        source = Promise.resolve(vurl);
      } else if (drawable) {
        source = App.symbolColorCanvas(layer.dataUri, layer.color || '#ffffff',
          Math.max(1, Math.round(layer.w)), Math.max(1, Math.round(layer.h)),
          App.symbolColorIdent(layer), { lod: false });
      } else source = App.symbolColorUrl(layer);
    }
    else if (layer.kind === 'pattern') {
      const pcv = App.patternThumbCanvas(layer.patternKey, layer.color || '#ffffff', size);
      source = Promise.resolve(drawable ? pcv : pcv.toDataURL());
    }
    else if (layer.kind === 'import') source = App.svgRasterThumb(layer, size, 'bakeRasterCache');
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

App.resolveBakeLayerSources = function (leaves, size, concurrency, shouldContinue, opts) {
  leaves = leaves || [];
  size = size || 256;
  if (!leaves.length) return Promise.resolve([]);
  return new Promise(function (resolve) {
    const alive = typeof shouldContinue === 'function' ? shouldContinue : function () { return true; };
    let settled = false;
    const finish = function (value) { if (!settled) { settled = true; resolve(value); } };
    const keys = new Array(leaves.length);
    const unique = new Map();
    const pairCount = new Map();
    const keep = (opts && opts.keep) || null;    
    const sizesAt = (opts && opts.sizes) || null;      
    const framesAt = (opts && opts.frames) || null;    
    const useAt = (opts && opts.useKeys) || null;      
    let i = 0;
    const collect = function () {
      if (!alive()) { finish([]); return; }
      if (App.bakeDeferBusy()) { if (App.noteBakeProgress) App.noteBakeProgress(); setTimeout(collect, 60); return; }
      const t0 = performance.now();
      do {
        const layer = leaves[i];
        if (keep && !keep[i]) { keys[i] = ''; i++; continue; }
        const own = sizesAt ? sizesAt[i] : 0;
        const actualSize = layer && layer.isMask && layer.kind !== 'import'
          ? Math.max(own || size, 512) : (own || size);
        const key = App.bakeLayerSourceKey(layer, actualSize);
        keys[i] = key;
        if (!unique.has(key)) {
          unique.set(key, {
            layer: layer, size: actualSize,
            frame: framesAt ? framesAt[i] : null,
            useKey: useAt ? useAt[i] : null
          });
        }
        if (layer && layer.kind === 'symbol' && !layer.isMask) {
          const pk = 'v|' + (layer.symbolKey || '') + '|' + (layer.color || '#ffffff');
          pairCount.set(pk, (pairCount.get(pk) || 0) + 1);
        }
        i++;
      } while (i < leaves.length && performance.now() - t0 < 6);
      if (App.noteBakeProgress) App.noteBakeProgress();
      if (i < leaves.length) { setTimeout(collect, 0); return; }
      const entries = Array.from(unique.entries());
      if (App.autoStatic && App.autoStatic.baking && App.autoStatic._run) {
        App.autoStatic._run.src = entries.length;
        App.autoStatic._run.srcDone = 0;
      }
      const srcOpts = Object.assign({}, opts || {}, { pairCount: pairCount });
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
          if (App.bakeDeferBusy()) { if (App.noteBakeProgress) App.noteBakeProgress(); setTimeout(expandStep, 60); return; }
          const t1 = performance.now();
          do { urls[j] = keys[j] ? (byKey.get(keys[j]) || '') : App.BAKE_CULLED_URL; j++; }
          while (j < keys.length && performance.now() - t1 < 6);
          if (j < keys.length) setTimeout(expandStep, 0);
          else finish(urls);
        };
        expandStep();
      };
      const pumpSources = function () {
        if (!alive()) { finish([]); return; }
        if (App.bakeDeferBusy()) { if (App.noteBakeProgress) App.noteBakeProgress(); setTimeout(pumpSources, 60); return; }
        if (App.noteBakeProgress) App.noteBakeProgress();
        if (sourceIndex >= entries.length) return;
        if (sourceIndex - sourceDone >= sourceLimit) return;    
        const entry = entries[sourceIndex++];
        const ent = entry[1];
        let source;
        try {
          const srcOpts2 = ent.useKey ? Object.assign({}, srcOpts, { useKey: ent.useKey }) : srcOpts;
          source = App.bakeLayerSource(ent.layer, ent.size, undefined, srcOpts2, ent.frame);
        }
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
          if (App.autoStatic && App.autoStatic.baking && App.autoStatic._run) App.autoStatic._run.srcDone = sourceDone;
          if (sourceDone >= entries.length) expand();
          else setTimeout(pumpSources, 0);
        });
        if (sourceIndex < entries.length && sourceIndex - sourceDone < sourceLimit) {
          setTimeout(pumpSources, 0);
        }
      };
      if (!entries.length) finish(new Array(leaves.length).fill(App.BAKE_CULLED_URL));
      else pumpSources();
    };
    collect();
  });
};

App.loadBakeImages = function (urls, warnLabel, shouldContinue) {
  const uniq = Array.from(new Set((urls || []).filter(Boolean)));
  if (!uniq.length) return Promise.resolve(new Map());
  if (App.autoStatic && App.autoStatic.baking && App.autoStatic._run) {
    App.autoStatic._run.dec = uniq.length;
    App.autoStatic._run.decDone = 0;
  }
  const limit = uniq.length > 32 ? 8 : uniq.length;
  const SVG_CAP = 2600;
  const cache = App._bakeSvgCache || (App._bakeSvgCache = new Map());
  return new Promise(function (resolve) {
    const alive = typeof shouldContinue === 'function' ? shouldContinue : function () { return true; };
    let settled = false;
    const finish = function (value) { if (!settled) { settled = true; resolve(value); } };
    const byUrl = new Map();
    let next = 0, active = 0, done = 0;
    const pump = function () {
      if (!alive()) { finish(byUrl); return; }
      if (App.bakeDeferBusy()) { if (App.noteBakeProgress) App.noteBakeProgress(); setTimeout(pump, 60); return; }
      while (next < uniq.length && active < limit) {
        const url = uniq[next++];
        const isSvg = url.indexOf('data:image/svg') === 0;
        const hitSvg = isSvg ? cache.get(url) : null;
        if (hitSvg) {                        
          byUrl.set(url, hitSvg);
          done++;
          if (done >= uniq.length) { finish(byUrl); return; }
          continue;
        }
        active++;
        let task;
        try { task = loadImage(url); }
        catch (e) { task = Promise.reject(e); }
        Promise.resolve(task).then(function (img) {
          if (settled) return;
          byUrl.set(url, img || null);
          if (isSvg && img && img.decode) {
            if (cache.size >= SVG_CAP) {
              let drop = Math.max(1, Math.round(SVG_CAP * 0.25));
              for (const k of cache.keys()) { cache.delete(k); if (--drop <= 0) break; }
            }
            cache.set(url, img);
          }
        }, function (e) {
          if (settled) return;
          console.warn(warnLabel || '[bake] 图源解码失败', String(e && e.message || e).slice(0, 160));
          byUrl.set(url, null);
        }).then(function () {
          if (settled) return;
          active--; done++;
          if (App.autoStatic && App.autoStatic.baking && App.autoStatic._run) App.autoStatic._run.decDone = done;
          if (App.noteBakeProgress) App.noteBakeProgress();
          if (done >= uniq.length) finish(byUrl);
          else pump();
        });
      }
      if (uniq.length && active === 0 && done >= uniq.length) finish(byUrl);
    };
    pump();
  });
};

App.bakeInkAsyncEnabled = true;
App.bakeInkEvaluate = function (src, meta) {
  const s = 128;
  const t0 = performance.now();
  try {
    let c = App._inkCanvas;
    if (!c) { c = document.createElement('canvas'); c.width = s; c.height = s; App._inkCanvas = c; }
    const g = c.getContext('2d', { willReadFrequently: true });
    g.clearRect(0, 0, s, s);
    g.drawImage(src, 0, 0, s, s);
    const d = g.getImageData(0, 0, s, s).data;
    let sum = 0, peak = 0;
    for (let i = 3; i < d.length; i += 4) {
      const a = d[i];
      if (a > peak) peak = a;
      sum += a;
    }
    const why = peak === 0 ? 'alpha-0' : (sum < 255 ? 'under-255' : 'ok');
    const ok = why === 'ok';
    App.drb(ok ? 'ink.ok' : (why === 'alpha-0' ? 'ink.empty' : 'ink.tooWeak'));
    App.dr('ink.check', Object.assign({
      ok: ok, samples: s * s, why: why,
      src: (meta && meta.src) || 'sync',
      ms: Math.round(performance.now() - t0),
      wait: (meta && meta.wait) || 0,
      w: (meta && meta.w) || 0, h: (meta && meta.h) || 0
    }, (meta && meta.extra) || {}));
    return ok;
  } catch (e) {
    App.drb('ink.readFail');
    App.dr('ink.check', { ok: false, samples: s * s, why: 'read-fail', src: (meta && meta.src) || 'sync',
      ms: Math.round(performance.now() - t0) });
    try { console.warn('[bake] 墨量读取失败，按空图处理（保留矢量）', String(e && e.message || e).slice(0, 120)); } catch (e2) {   }
    return false;
  }
};
App.bakeCanvasHasInk = function (cv) {
  const w = cv.width, h = cv.height;
  if (!w || !h) return false;
  return App.bakeInkEvaluate(cv, { src: 'sync', w: w, h: h });
};
App.bakeCanvasHasInkAsync = function (cv) {
  const w = cv.width, h = cv.height;
  if (!w || !h) return Promise.resolve(false);
  App.drb('ink.asyncCall');
  if (!App.bakeInkAsyncEnabled || typeof createImageBitmap !== 'function') {
    App.drb('ink.syncPath');
    return Promise.resolve(App.bakeInkEvaluate(cv, { src: 'sync-fallback', w: w, h: h }));
  }
  const tCall = performance.now();
  let p;
  try {
    p = createImageBitmap(cv, { resizeWidth: 128, resizeHeight: 128, resizeQuality: 'low' });
  } catch (e) {
    p = Promise.reject(e);
  }
  return Promise.resolve(p).then(function (bmp) {
    App.drb('ink.bitmapPath');
    try {
      return App.bakeInkEvaluate(bmp, { src: 'bitmap', wait: Math.round(performance.now() - tCall), w: w, h: h });
    } finally {
      try { bmp.close(); } catch (e) {   }
    }
  }).catch(function (e) {
    App.drb('ink.bitmapFail');
    return App.bakeInkEvaluate(cv, { src: 'sync-fallback', wait: Math.round(performance.now() - tCall), w: w, h: h });
  });
};
App.bakeInkUseAccumulator = true;
App.bakeInkFromAccumulator = function (ink, cv) {
  const drawn = (ink && ink.drawn) || 0;
  const ok = drawn > 0;
  App.drb(ok ? 'ink.ok' : 'ink.empty');
  App.dr('ink.check', {
    ok: ok, samples: 0, why: ok ? 'draw' : 'no-draw', src: 'draw-accumulator',
    drawn: drawn, alpha: Math.round(((ink && ink.alpha) || 0) * 100) / 100,
    px: Math.round((ink && ink.px) || 0), ms: 0,
    w: cv ? cv.width : 0, h: cv ? cv.height : 0
  });
  return ok;
};

App.bakeFrameEnabled = true;
App._bakeUseRaster = new Map();
App._bakeUseRasterPx = 0;
App._bakeUseRasterSeq = 0;
App._bakeUseRasterBudget = 1.2e8;    

App.bakeFramePad = function (w, h) {
  return Math.max(1, 0.02 * Math.max(Math.abs(w) || 0, Math.abs(h) || 0));
};

App.bakeMeasureElBBox = function (el) {
  if (!el || el.nodeType !== 1) return null;
  const undo = [];
  let n = el;
  try {
    while (n && n.nodeType === 1 && n !== document.documentElement) {
      if (n.style && n.style.display === 'none') {
        undo.push([n, n.style.display]);
        n.style.display = '';
      }
      n = n.parentNode;
    }
    const bb = el.getBBox();
    if (bb && bb.width > 0 && bb.height > 0) {
      return { x: bb.x, y: bb.y, w: bb.width, h: bb.height };
    }
    return null;
  } catch (e) {
    return null;
  } finally {
    for (let i = 0; i < undo.length; i++) undo[i][0].style.display = undo[i][1];
  }
};

App.bakeUseInfo = function (layer) {
  if (!layer || layer.kind !== 'import') return null;
  if (layer._bakeUse !== undefined) return layer._bakeUse;
  let info = null;
  try {
    const markup = String(layer.importMarkup || '');
    if (markup && markup.indexOf('<use') >= 0) {
      const tpl = document.createElementNS(SVGNS, 'svg');
      tpl.innerHTML = markup;
      const kids = Array.from(tpl.children || []);
      if (kids.length === 1 && kids[0].nodeName.toLowerCase() === 'use') {
        const u = kids[0];
        const href = (u.getAttribute('href') || u.getAttributeNS(XLINK, 'href') || '').replace(/^#/, '');
        const hasWH = u.hasAttribute('width') || u.hasAttribute('height');
        if (href && !hasWH) {
          const attrs = {};
          for (let ai = 0; ai < u.attributes.length; ai++) {
            const an = u.attributes[ai].name;
            if (an === 'transform' || an === 'x' || an === 'y' ||
                an === 'href' || an === 'xlink:href' || an === 'id') continue;
            attrs[an] = u.attributes[ai].value;
          }
          info = {
            href: href,
            x: parseFloat(u.getAttribute('x')) || 0,
            y: parseFloat(u.getAttribute('y')) || 0,
            transform: u.getAttribute('transform') || '',
            attrs: attrs
          };
        }
      }
    }
  } catch (e) { info = null; }
  layer._bakeUse = info;
  return info;
};

App.bakeUseFrame = function (layer) {
  const info = App.bakeUseInfo(layer);
  if (!info) return null;
  let defEl = null;
  try { defEl = $('#' + info.href, App.defs); } catch (e) { defEl = null; }
  if (!defEl) return null;
  if (defEl.__bakeUseFrame) return defEl.__bakeUseFrame;
  const w = Number(layer.w) || 0, h = Number(layer.h) || 0;
  let M;
  try {
    M = new DOMMatrix()
      .translate(-w / 2, -h / 2)
      .multiply(parseTransformAttr(info.transform || ''))
      .multiply(new DOMMatrix().translate(info.x || 0, info.y || 0));
  } catch (e) { return null; }
  let inv;
  try { inv = M.inverse(); } catch (e) { return null; }
  const bb = App.bakeMeasureElBBox(layer.el);
  if (!bb) return null;
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  [[bb.x, bb.y], [bb.x + bb.w, bb.y], [bb.x + bb.w, bb.y + bb.h], [bb.x, bb.y + bb.h]].forEach(function (p) {
    const q = new DOMPoint(p[0], p[1]).matrixTransform(inv);
    minx = Math.min(minx, q.x); miny = Math.min(miny, q.y);
    maxx = Math.max(maxx, q.x); maxy = Math.max(maxy, q.y);
  });
  if (!isFinite(minx) || !(maxx > minx) || !(maxy > miny)) return null;
  const p = App.bakeFramePad(maxx - minx, maxy - miny);
  const S = { x: minx - p, y: miny - p, w: (maxx - minx) + p * 2, h: (maxy - miny) + p * 2 };
  try { defEl.__bakeUseFrame = S; } catch (e) {   }
  return S;
};

App.bakeFrameOf = function (layer) {
  if (!layer || !App.bakeFrameEnabled) return null;
  if (layer.kind === 'merged') return null;
  if (layer.kind === 'symbol' || layer.kind === 'pattern') {
    const w = Number(layer.w) || 0, h = Number(layer.h) || 0;
    if (!(w > 0) || !(h > 0)) return null;
    return { x: -w / 2, y: -h / 2, w: w, h: h };
  }
  if (layer.kind !== 'import') return null;
  const uf = layer.isMask ? null : App.bakeUseFrame(layer);
  if (uf) return uf;
  const el = layer.el;
  if (!el) return null;
  const cached = el.__bakeFrame;
  if (cached && cached._w === layer.w && cached._h === layer.h) return cached;
  const bb = App.bakeMeasureElBBox(el);
  if (bb) {
    const p = App.bakeFramePad(bb.w, bb.h);
    const fr = { x: bb.x - p, y: bb.y - p, w: bb.w + p * 2, h: bb.h + p * 2, _w: layer.w, _h: layer.h };
    try { el.__bakeFrame = fr; } catch (e) {   }
    return fr;
  }
  const w = Number(layer.w) || 0, h = Number(layer.h) || 0;
  if (!(w > 0) || !(h > 0)) return null;
  const p = App.bakeFramePad(w, h);
  return { x: -w / 2 - p, y: -h / 2 - p, w: w + p * 2, h: h + p * 2 };
};

App.bakeNodeOf = function (layer, baseMat) {
  if (!App.bakeFrameEnabled) return { frame: null, mat: baseMat, useKey: null };
  const info = (layer && !layer.isMask) ? App.bakeUseInfo(layer) : null;
  if (info) {
    const S = App.bakeUseFrame(layer);
    if (S) {
      const w = Number(layer.w) || 0, h = Number(layer.h) || 0;
      let m;
      try {
        m = new DOMMatrix()
          .translate(-w / 2, -h / 2)
          .multiply(parseTransformAttr(info.transform || ''))
          .multiply(new DOMMatrix().translate(info.x || 0, info.y || 0));
        m = baseMat ? baseMat.multiply(m) : m;
      } catch (e) { m = baseMat; }
      return { frame: S, mat: m, useKey: info.href };
    }
  }
  return { frame: App.bakeFrameOf(layer), mat: baseMat, useKey: null };
};

App.bakeMatScale = function (m) {
  if (!m) return 1;
  return Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d)) || 1;
};

App.bakeSourceSizeFor = function (node, f) {
  const fr = node && node.frame;
  if (!fr) return 0;
  const raw = Math.max(fr.w, fr.h) * App.bakeMatScale(node.mat) * (f || 1);
  const q = App.bakeVecRasterSnap ? App.bakeVecRasterSnap(raw) : Math.ceil(raw);
  return Math.max(16, Math.min(512, q));
};

App.bakeFrameDocRect = function (layer, matFn) {
  if (!layer || !layer.el) return null;
  if (layer.kind === 'merged') {
    try { return App.getItemDocBBox(layer); } catch (e) { return null; }
  }
  let baseMat = null;
  try { baseMat = (matFn || App.bakeLeafMatFn())(layer); } catch (e) { baseMat = null; }
  if (!baseMat) return null;
  const node = App.bakeNodeOf(layer, baseMat);
  if (!node.frame) return null;
  const m = node.mat || baseMat;
  const fr = node.frame;
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  [[fr.x, fr.y], [fr.x + fr.w, fr.y], [fr.x + fr.w, fr.y + fr.h], [fr.x, fr.y + fr.h]].forEach(function (p) {
    const q = new DOMPoint(p[0], p[1]).matrixTransform(m);
    minx = Math.min(minx, q.x); miny = Math.min(miny, q.y);
    maxx = Math.max(maxx, q.x); maxy = Math.max(maxy, q.y);
  });
  if (!isFinite(minx)) return null;
  return { x: minx, y: miny, w: maxx - minx, h: maxy - miny };
};
App.bakeFrameDocIntersects = function (layer, rect, matFn) {
  if (!rect) return true;
  const b = App.bakeFrameDocRect(layer, matFn);
  if (!b) return true;    
  return b.x < rect.x + rect.w && b.x + b.w > rect.x && b.y < rect.y + rect.h && b.y + b.h > rect.y;
};

App.bakeGatherDefs = function (root, hostDefs, seenShared) {
  if (!root || !hostDefs) return;
  const DEF_TAGS = {
    symbol: 1, g: 1, mask: 1, clippath: 1, lineargradient: 1, radialgradient: 1, pattern: 1,
    filter: 1, image: 1, use: 1, path: 1, rect: 1, circle: 1, ellipse: 1, polygon: 1,
    polyline: 1, line: 1, style: 1, defs: 1
  };
  App._DEF_TAGS = DEF_TAGS;
  const seen = seenShared || new Set();
  const visit = function (node) {
    if (!node || node.nodeType !== 1) return;
    const attrs = node.attributes || [];
    for (let i = 0; i < attrs.length; i++) {
      const name = attrs[i].name || '';
      const val = attrs[i].value || '';
      if (name === 'href' || name === 'xlink:href') {
        if (val.charAt(0) === '#') addDef(val.slice(1), node);
      } else if (val.indexOf('url(#') >= 0) {
        const re = /url\(#([^)]+)\)/g;
        let m;
        while ((m = re.exec(val))) addDef(m[1], node);
      }
    }
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1) visit(c);
    }
  };
  const addDef = function (id, from) {
    if (!id || seen.has(id)) return;
    seen.add(id);
    try {
      if (from && from !== root && root.querySelector && root.querySelector('#' + id)) return;
    } catch (e) {   }
    let src = null;
    try { src = $('#' + id, App.defs); } catch (e) { src = null; }
    if (!src) {
      try {
        const cand = document.getElementById(id);
        if (cand && App._DEF_TAGS[String(cand.tagName).toLowerCase()] && cand !== root && !root.contains(cand) && !hostDefs.contains(cand)) {
          src = cand;
        }
      } catch (e) { src = null; }
    }
    if (!src) { App._bakeDefMiss = (App._bakeDefMiss || 0) + 1; return; }
    const clone = src.cloneNode(true);
    hostDefs.appendChild(clone);
    visit(clone);
  };
  visit(root);
};

App._bakeUseRasterGet = function (key) {
  const hit = App._bakeUseRaster.get(key);
  if (!hit) return null;
  hit.t = ++App._bakeUseRasterSeq;
  return hit.c;
};
App._bakeUseRasterPut = function (key, cv, px) {
  if (px > App._bakeUseRasterBudget) {
    if (App.rasterStats) { try { App.rasterStats.noteReject('use', key, px); } catch (e) {   } }
    return;
  }
  const old = App._bakeUseRaster.get(key);
  if (old) { App._bakeUseRasterPx -= old.px; App._bakeUseRaster.delete(key); }
  const ev = (App.rasterStats && App.rasterStats.on) ? [] : null;
  if (App._bakeUseRasterPx + px > App._bakeUseRasterBudget) {
    const arr = Array.from(App._bakeUseRaster.entries()).sort(function (a, b) { return a[1].t - b[1].t; });
    for (let i = 0; i < arr.length && App._bakeUseRasterPx + px > App._bakeUseRasterBudget; i++) {
      App._bakeUseRaster.delete(arr[i][0]);
      App._bakeUseRasterPx -= arr[i][1].px;
      if (ev) ev.push([arr[i][0], arr[i][1]]);
    }
  }
  App._bakeUseRaster.set(key, { c: cv, px: px, t: ++App._bakeUseRasterSeq });
  App._bakeUseRasterPx += px;
  if (App.rasterStats) { try { App.rasterStats.notePut('use', key, px, 0, !!old, ev); } catch (e) {   } }
};

App.bakeFrameSource = function (layer, frame, pxLong, useHref) {
  if (!layer || !frame || !(frame.w > 0) || !(frame.h > 0)) return Promise.resolve(null);
  const long = Math.max(1, pxLong || 16);
  let scale = long / Math.max(frame.w, frame.h);
  let pw = Math.max(1, Math.round(frame.w * scale));
  let ph = Math.max(1, Math.round(frame.h * scale));
  const MAX_SIDE = 4096;
  if (pw > MAX_SIDE || ph > MAX_SIDE) {
    const k = MAX_SIDE / Math.max(pw, ph);
    pw = Math.max(1, Math.round(pw * k));
    ph = Math.max(1, Math.round(ph * k));
  }
  const useInfo = useHref ? App.bakeUseInfo(layer) : null;
  const attrSig = (useInfo && useInfo.attrs) ? JSON.stringify(useInfo.attrs) : '';
  const sharedKey = useHref ? ('u|' + useHref + '|' + attrSig + '|' + pw + 'x' + ph) : null;
  if (sharedKey) {
    const hit = App._bakeUseRasterGet(sharedKey);
    if (App.rasterStats) { try { App.rasterStats.verdict('use', sharedKey, !!hit, 0, { present: !!hit }); } catch (e) {   } }
    if (hit) return Promise.resolve(hit);
  } else if (layer.bakeFrameCache && layer.bakeFrameCache.key ===
      (pw + 'x' + ph + '|' + frame.x + ',' + frame.y + ',' + frame.w + ',' + frame.h)) {
    return Promise.resolve(layer.bakeFrameCache.c);
  }
  try {
    const host = svgEl('svg');
    host.setAttribute('xmlns', SVGNS);
    host.setAttribute('viewBox', frame.x + ' ' + frame.y + ' ' + frame.w + ' ' + frame.h);
    host.setAttribute('width', pw);
    host.setAttribute('height', ph);
    const defs = svgEl('defs');
    host.appendChild(defs);
    if (useHref) {
      let def = null;
      try { def = $('#' + useHref, App.defs); } catch (e) { def = null; }
      if (!def) return Promise.resolve(null);
      const defClone = def.cloneNode(true);
      defs.appendChild(defClone);
      App.bakeGatherDefs(defClone, defs);
      const info = App.bakeUseInfo(layer);
      const uEl = svgEl('use', { href: '#' + useHref });
      if (info && info.attrs) {
        Object.keys(info.attrs).forEach(function (k) {
          try { uEl.setAttribute(k, info.attrs[k]); } catch (e) {   }
        });
      }
      const sw = def.getAttribute('width'), sh = def.getAttribute('height');
      if (sw) uEl.setAttribute('width', sw);
      if (sh) uEl.setAttribute('height', sh);
      host.appendChild(uEl);
    } else {
      const clone = layer.el.cloneNode(true);
      clone.removeAttribute('data-layer');
      clone.removeAttribute('data-kind');
      clone.removeAttribute('opacity');
      clone.removeAttribute('transform');
      if (clone.style) { clone.style.display = ''; clone.style.visibility = ''; }
      $$('[style]', clone).forEach(function (el) {
        if (el.style && el.style.display === 'none') el.style.display = '';
      });
      $$('[data-layer]', clone).forEach(function (el) { el.removeAttribute('visibility'); });
      const pending = [];
      $$('[data-layer]', clone).forEach(function (el) {
        const id = parseInt(el.getAttribute('data-layer'), 10);
        const l = App.findLayer ? App.findLayer(id) : null;
        if (!l || l.kind !== 'symbol') return;
        const img = el.querySelector('image');
        if (img && !(img.getAttribute('href') || '')) {
          pending.push(App.symbolColorUrl(l).then(function (url) { img.setAttribute('href', url || ''); }));
        }
      });
      host.appendChild(clone);
      const go = function () {
        App.bakeGatherDefs(clone, defs);
        return App.bakeFrameSourceRender(host, layer, frame, pw, ph, sharedKey);
      };
      if (pending.length) return Promise.all(pending).then(go).catch(function () { return go(); });
      return go();
    }
    return App.bakeFrameSourceRender(host, layer, frame, pw, ph, sharedKey);
  } catch (e) {
    console.warn('[bake] 取景光栅化初始化失败', layer && layer.id, String(e && e.message || e).slice(0, 160));
    return Promise.resolve(null);
  }
};

App.bakeFrameSourceRender = function (host, layer, frame, pw, ph, sharedKey) {
  let url = '';
  try {
    url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(host)], { type: 'image/svg+xml' }));
  } catch (e) {
    return Promise.resolve(null);
  }
  return loadImage(url).then(function (im) {
    try { URL.revokeObjectURL(url); } catch (e) {   }
    if (!im) return null;
    const cv = document.createElement('canvas');
    cv.width = pw; cv.height = ph;
    const cx = cv.getContext('2d');
    cx.imageSmoothingEnabled = true;
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(im, 0, 0, im.width || pw, im.height || ph, 0, 0, pw, ph);
    if (sharedKey) App._bakeUseRasterPut(sharedKey, cv, pw * ph);
    else {
      try {
        layer.bakeFrameCache = {
          key: pw + 'x' + ph + '|' + frame.x + ',' + frame.y + ',' + frame.w + ',' + frame.h,
          c: cv
        };
      } catch (e) {   }
    }
    return cv;
  }).catch(function (e) {
    try { URL.revokeObjectURL(url); } catch (err) {   }
    console.warn('[bake] 取景光栅化失败', layer && layer.id, String(e && e.message || e).slice(0, 160));
    return null;
  });
};

App.bakeNeedSnapshot = function (leaves) {
  if (!leaves || !App.bakeFrameEnabled) return false;
  let imps = 0, broken = 0, symbols = 0;
  for (let i = 0; i < leaves.length; i++) {
    const l = leaves[i];
    if (!l) continue;
    if (l.kind === 'symbol') { symbols++; continue; }
    if (l.kind !== 'import') continue;
    imps++;
    if ((Number(l.w) || 0) === 128 && (Number(l.h) || 0) === 128) broken++;
  }
  const need = broken > 0 || imps >= 200;
  App.drb(need ? 'plan.snapshot.yes' : 'plan.snapshot.no');
  const sig = need ? (broken > 0 ? 'imp:model-128' : 'imp:200+') : 'leaf-path';
  if (App._snapPlanSig !== sig) {
    App._snapPlanSig = sig;
    App.dr('plan.snapshot', { leaf: leaves.length, tops: need ? imps : symbols,
      reasonCode: need ? (broken > 0 ? 'model-128' : 'imports-200') : 'leaf-path',
      kind: need ? 'import' : 'symbol' });
  }
  return need;
};

App.bakeContentBBox = function () {
  const a = App.autoStatic || {};
  const stages = [App.autoStaticBgEl, App.autoStaticBaseEl, App.autoStaticStageEl, App.editStaticBgEl, App.editStaticBaseEl]
    .filter(function (el) { return !!el; });
  const prevStage = stages.map(function (el) { return [el, el.style.display]; });
  stages.forEach(function (el) { el.style.display = 'none'; });
  const hidden = (a.hiding || []).filter(function (l) { return l && l.el; });
  const prevHidden = hidden.map(function (l) { return [l, l.el.style.display]; });
  hidden.forEach(function (l) {
    if (l._asPrevDisplay !== undefined) l.el.style.display = l._asPrevDisplay;
  });
  let bb = null;
  try { bb = App.layersRoot.getBBox(); } catch (e) { bb = null; }
  hidden.forEach(function (l, i) { l.el.style.display = prevHidden[i][1]; });
  prevStage.forEach(function (pair) { pair[0].style.display = pair[1]; });
  return bb;
};

App._snapDocCache = null;
App.docNeedsSnapshot = function () {
  const layers = (App.state && App.state.layers) || [];
  const key = String(layers.length) + ':' + (App.contentRevision || 0);
  if (App._snapDocCache && App._snapDocCache.key === key) { App.drb('plan.docSnap.hit'); return App._snapDocCache.val; }
  App.drb('plan.docSnap.miss');
  const leaves = [];
  const walk = function (l) { if (l.kind === 'merged') (l.children || []).forEach(walk); else leaves.push(l); };
  layers.forEach(walk);
  const val = App.bakeNeedSnapshot(leaves);
  App._snapDocCache = { key: key, val: val };
  return val;
};

App._snapBBoxCache = null;
App.snapContentBBox = function () {
  const key = String((App.state && App.state.layers ? App.state.layers.length : 0)) + ':' + (App.contentRevision || 0);
  if (App._snapBBoxCache && App._snapBBoxCache.key === key) return App._snapBBoxCache.bb;
  const bb = App.bakeContentBBox();
  App._snapBBoxCache = { key: key, bb: bb };
  return bb;
};

App.bakeSnapshotInto = function (cx, items, rect, f, alive, ink) {
  const snapT0 = performance.now();
  const snapDone = function (ok, extra) {
    App.drb(ok ? 'snap.ok' : 'snap.fail');
    App.dr('snap.raster', Object.assign({ ok: ok, dur: Math.round(performance.now() - snapT0), f: Number(f) || 0 }, extra || {}));
    return ok;
  };
  return new Promise(function (resolve) {
    try {
      const cw = Math.max(1, Math.round(rect.w * f));
      const ch = Math.max(1, Math.round(rect.h * f));
      const host = svgEl('svg');
      host.setAttribute('xmlns', SVGNS);
      host.setAttribute('viewBox', rect.x + ' ' + rect.y + ' ' + rect.w + ' ' + rect.h);
      host.setAttribute('width', cw);
      host.setAttribute('height', ch);
      const defs = svgEl('defs');
      host.appendChild(defs);
      const clones = [];
      const pending = [];
      (items || []).forEach(function (l) {
        if (!l || !l.el || !alive()) return;
        const clone = l.el.cloneNode(true);
        clone.removeAttribute('data-kind');
        if (l._asPrevDisplay !== undefined && clone.style) clone.style.display = l._asPrevDisplay;
        const hadProxy = !!clone.querySelector('image[data-proxy]');
        if (hadProxy) {
          $$('image[data-proxy]', clone).forEach(function (im) { im.remove(); });
          $$('[data-layer]', clone).forEach(function (el) { el.removeAttribute('visibility'); });
        } else {
          $$('[data-layer]', clone).forEach(function (el) {
            const id = parseInt(el.getAttribute('data-layer'), 10);
            const l2 = App.findLayer ? App.findLayer(id) : null;
            if (!l2 || l2._esPrevVis === undefined) return;
            if (l2._esPrevVis === null) el.removeAttribute('visibility');
            else el.setAttribute('visibility', l2._esPrevVis);
          });
        }
        if (l.kind === 'symbol') {
          const rootImg = clone.querySelector(':scope > image');
          if (rootImg && !(rootImg.getAttribute('href') || '')) {
            pending.push(App.symbolColorUrl(l).then(function (url) { rootImg.setAttribute('href', url || ''); }));
          }
        }
        $$('[data-layer]', clone).forEach(function (el) {
          const id = parseInt(el.getAttribute('data-layer'), 10);
          const l2 = App.findLayer ? App.findLayer(id) : null;
          if (!l2 || l2.kind !== 'symbol') return;
          const img = el.querySelector('image');
          if (img && !(img.getAttribute('href') || '')) {
            pending.push(App.symbolColorUrl(l2).then(function (url) { img.setAttribute('href', url || ''); }));
          }
        });
        clones.push(clone);
        host.appendChild(clone);
      });
      const render = function () {
        if (!alive()) { resolve(false); return; }
        App._bakeDefMiss = 0;
        const seenDefs = new Set();
        clones.forEach(function (root) { App.bakeGatherDefs(root, defs, seenDefs); });
        const defMiss = App._bakeDefMiss || 0;
        if (ink) {
          ink.drawn = (clones.length > 0 && defMiss === 0) ? 1 : 0;
          ink.alpha = ink.drawn;
          ink.px = ink.drawn;
        }
        App.drb(defMiss ? 'snap.defMiss' : 'snap.defOk');
        App.dr('snap.build', { tops: (items || []).length, clones: clones.length,
          defs: defs.childNodes ? defs.childNodes.length : 0, pending: pending.length,
          fail: defMiss, why: defMiss ? 'missing-defs' : 'ok' });
        let url = '';
        try {
          url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(host)], { type: 'image/svg+xml' }));
        } catch (e) { resolve(false); return; }
        loadImage(url).then(function (im) {
          try { URL.revokeObjectURL(url); } catch (e) {   }
          if (!im || !alive()) { snapDone(false, { why: im ? 'stale' : 'decode-fail' }); resolve(false); return; }
          try {
            cx.clearRect(0, 0, cw, ch);
            cx.imageSmoothingEnabled = true;
            cx.imageSmoothingQuality = 'high';
            cx.drawImage(im, 0, 0, cw, ch);
          } catch (e) { snapDone(false, { why: 'draw-fail' }); resolve(false); return; }
          snapDone(true, { w: cw, h: ch });
          resolve(true);
        }).catch(function (e) {
          try { URL.revokeObjectURL(url); } catch (err) {   }
          console.warn('[bake] 整块快照光栅化失败', String(e && e.message || e).slice(0, 160));
          snapDone(false, { why: 'load-error' });
          resolve(false);
        });
      };
      if (pending.length) Promise.all(pending).then(render).catch(render);
      else render();
    } catch (e) {
      console.warn('[bake] 整块快照初始化失败', String(e && e.message || e).slice(0, 160));
      resolve(false);
    }
  });
};

App.bakeEditStatic = function (items, viewport, shouldContinue) {
  const leafMat = App.bakeLeafMatFn();
  const quickLeaves = [];
  const quickWalk = l => { if (l.kind === 'merged') (l.children || []).forEach(quickWalk); else quickLeaves.push(l); };
  items.forEach(quickWalk);
  const snapshotMode = App.bakeNeedSnapshot(quickLeaves);
  const vis = (viewport && !snapshotMode) ? items.filter(l => App.bakeFrameDocIntersects(l, viewport, leafMat)) : items;
  const leaves = [];
  const walk = l => { if (l.kind === 'merged') (l.children || []).forEach(walk); else leaves.push(l); };
  vis.forEach(walk);
  if (!leaves.length) {
    App.drb('bake.abort.empty');
    App.dr('bake.abort', { owner: 'edit', why: 'no-leaves', tops: (items || []).length });
    return Promise.resolve(null);
  }
  const alive = typeof shouldContinue === 'function' ? shouldContinue : function () { return true; };
  const run = { leaf: leaves.length, t0: performance.now(), matrix: 0, bbox: 0, src: 0, dec: 0, draw: 0, enc: 0 };
  App.editStatic._run = run;
  const ink = { drawn: 0, alpha: 0, px: 0 };
  App.drb('bake.start.edit');
  App.dr('bake.start', { owner: 'edit', tier: viewport ? 'fine' : 'base', path: snapshotMode ? 'snapshot' : 'leaf',
    leaf: leaves.length, tops: (items || []).length, f: Number(viewport && viewport._f) || 0 });
  const mats = new Array(leaves.length);
  const frames = new Array(leaves.length);
  const useKeys = new Array(leaves.length);
  const unitLong = new Array(leaves.length);
  const useMax = new Map();
  const keep = viewport ? new Array(leaves.length) : null;
  const kx = viewport ? viewport.x : 0, ky = viewport ? viewport.y : 0;
  const kw = viewport ? viewport.w : 0, kh = viewport ? viewport.h : 0;
  let culled = 0;
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  const BUDGET = 8, MIN_CHUNK = 8;
  const SINGLE_PASS = leaves.length <= 12000;
  return new Promise(resolve => {
    let settled = false;
    const finishResult = function (value) {
      if (settled) return;
      settled = true;
      App.drb(value ? 'bake.ok.edit' : 'bake.fail.edit');
      App.dr('bake.end', {
        owner: 'edit', tier: viewport ? 'fine' : 'base', path: snapshotMode ? 'snapshot' : 'leaf',
        ok: !!value, dur: Math.round(performance.now() - run.t0), leaf: leaves.length, culled: culled,
        w: value ? value.w : 0, h: value ? value.h : 0, f: value ? Number(value.f) || 0 : 0,
        why: value ? 'ok' : 'no-result'
      });
      resolve(value);
    };
    let mi = 0;
    let i = 0;
    let fi = 0;
    const matrixStep = () => {
      if (!alive()) { finishResult(null); return; }
      if (!SINGLE_PASS && App.bakeDeferBusy()) { if (App.noteBakeProgress) App.noteBakeProgress(); setTimeout(matrixStep, 60); return; }
      const t0 = performance.now();
      let n = 0;
      while (mi < leaves.length && (SINGLE_PASS || n < MIN_CHUNK || performance.now() - t0 < BUDGET)) {
        mats[mi] = leafMat(leaves[mi]);
        mi++; n++;
      }
      run.matrix += performance.now() - t0;
      if (App.noteBakeProgress) App.noteBakeProgress();
      if (mi < leaves.length) { setTimeout(matrixStep, 0); return; }
      frameStep();
    };
    const frameStep = () => {
      if (!alive()) { finishResult(null); return; }
      if (snapshotMode) { fi = leaves.length; bboxStep(); return; }
      if (!SINGLE_PASS && App.bakeDeferBusy()) { if (App.noteBakeProgress) App.noteBakeProgress(); setTimeout(frameStep, 60); return; }
      const t0 = performance.now();
      let n = 0;
      while (fi < leaves.length && (SINGLE_PASS || n < MIN_CHUNK || performance.now() - t0 < BUDGET)) {
        const nd = App.bakeNodeOf(leaves[fi], mats[fi]);
        frames[fi] = nd.frame;
        if (nd.mat && nd.mat !== mats[fi]) mats[fi] = nd.mat;
        useKeys[fi] = nd.useKey || null;
        const unit = nd.frame ? Math.max(nd.frame.w, nd.frame.h) * App.bakeMatScale(mats[fi]) : 0;
        unitLong[fi] = unit;
        if (nd.useKey && unit > 0) useMax.set(nd.useKey, Math.max(useMax.get(nd.useKey) || 0, unit));
        fi++; n++;
      }
      if (App.noteBakeProgress) App.noteBakeProgress();
      if (fi < leaves.length) { setTimeout(frameStep, 0); return; }
      bboxStep();
    };
    const bboxStep = () => {
      if (!alive()) { finishResult(null); return; }
      if (!SINGLE_PASS && App.bakeDeferBusy()) { if (App.noteBakeProgress) App.noteBakeProgress(); setTimeout(bboxStep, 60); return; }
      const t0 = performance.now();
      let n = 0;
      if (snapshotMode) {
        i = leaves.length;
        if (viewport) {
          minx = viewport.x; miny = viewport.y;
          maxx = viewport.x + viewport.w; maxy = viewport.y + viewport.h;
        } else {
          const bb = App.bakeContentBBox();
          if (bb && bb.width > 0 && bb.height > 0) {
            const pd = Math.max(1, 0.02 * Math.max(bb.width, bb.height));
            minx = bb.x - pd; miny = bb.y - pd;
            maxx = bb.x + bb.width + pd; maxy = bb.y + bb.height + pd;
          }
        }
      }
      while (i < leaves.length && (SINGLE_PASS || n < MIN_CHUNK || performance.now() - t0 < BUDGET)) {
        const fr = frames[i];
        const hw = (leaves[i].w || 0) / 2, hh = (leaves[i].h || 0) / 2;
        const cs = fr
          ? [[fr.x, fr.y], [fr.x + fr.w, fr.y], [fr.x + fr.w, fr.y + fr.h], [fr.x, fr.y + fr.h]]
          : [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
        let lminx = Infinity, lminy = Infinity, lmaxx = -Infinity, lmaxy = -Infinity;
        cs.forEach(p => {
          const r = new DOMPoint(p[0], p[1]).matrixTransform(mats[i]);
          minx = Math.min(minx, r.x); maxx = Math.max(maxx, r.x);
          miny = Math.min(miny, r.y); maxy = Math.max(maxy, r.y);
          if (r.x < lminx) lminx = r.x; if (r.x > lmaxx) lmaxx = r.x;
          if (r.y < lminy) lminy = r.y; if (r.y > lmaxy) lmaxy = r.y;
        });
        if (keep) {
          keep[i] = (lmaxx + 1 >= kx && lminx - 1 <= kx + kw && lmaxy + 1 >= ky && lminy - 1 <= ky + kh);
          if (!keep[i]) culled++;
        }
        i++; n++;
      }
      run.bbox += performance.now() - t0;
      if (App.noteBakeProgress) App.noteBakeProgress();
      if (i < leaves.length) { setTimeout(bboxStep, 0); return; }
      if (!isFinite(minx)) { finishResult(null); return; }
      if (keep && leaves.length && culled >= leaves.length) {
        console.warn('[bake] 编辑静态：全部叶子被视口裁掉，放弃本轮位图（保留矢量）', {
          leaves: leaves.length, culled: culled,
          viewport: { x: Math.round(kx), y: Math.round(ky), w: Math.round(kw), h: Math.round(kh) }
        });
        finishResult(null);
        return;
      }
      const bx = viewport ? viewport.x : minx;
      const by = viewport ? viewport.y : miny;
      const bw = viewport ? viewport.w : Math.max(1, maxx - minx);
      const bh = viewport ? viewport.h : Math.max(1, maxy - miny);
      let f;
      if (viewport) {
        const fGiven = Number(viewport._f);
        f = (fGiven > 0) ? fGiven : Math.min(App.editStaticNeedF(), 4096 / Math.max(bw, bh));
      } else {
        const capF = (App.autoStaticBaseMaxSide || 1400) / Math.max(1, Math.max(bw, bh));
        const needF = App.autoStaticNeedF ? App.autoStaticNeedF() : 1;
        f = Math.max(0.05, Math.min(capF, Math.max(needF, 4)));
      }
      const cw = Math.max(1, Math.round(bw * f)), ch = Math.max(1, Math.round(bh * f));
      if (App.renderPerfCounters) App.renderPerfCounters.esBakeCulled = culled;
      const srcSizeGlobal = App.bakeSourceSize(leaves, f);
      const sizes = new Array(leaves.length);
      for (let k = 0; k < leaves.length; k++) {
        const l = leaves[k];
        if (l.kind === 'import' && frames[k]) {
          const unit = useKeys[k] ? (useMax.get(useKeys[k]) || unitLong[k]) : unitLong[k];
          sizes[k] = Math.max(16, Math.min(512, App.bakeVecRasterSnap(unit * f)));
        } else {
          sizes[k] = srcSizeGlobal;
        }
      }
      const cv = App.takeBakeCanvas(cw, ch);
      const cx = cv.getContext('2d');

      const finishFromCanvas = function (failedTop) {
        let tEnc = 0;
        const finishUrl = function (url) {
          run.enc = performance.now() - tEnc;
          App.releaseBakeCanvas(cv);
          if (!url) { finishResult(null); return; }
          if (!alive()) {
            if (url.indexOf('blob:') === 0) { try { URL.revokeObjectURL(url); } catch (e) {   } }
            finishResult(null);
            return;
          }
          finishResult({ url: url, x: bx, y: by, w: bw, h: bh, f: f, failedTop: failedTop, snapshot: snapshotMode });
        };
        const afterInk = function (ok) {
          if (!alive()) { App.releaseBakeCanvas(cv); finishResult(null); return; }
          if (!ok) {
            console.warn('[bake] 编辑静态：位图为空，放弃本轮位图（保留矢量）', { leaves: leaves.length });
            App.releaseBakeCanvas(cv);
            finishResult(null);
            return;
          }
          tEnc = performance.now();
          if (cv.toBlob) {
            try {
              cv.toBlob(function (blob) {
                if (!blob) { finishUrl(''); return; }
                try { finishUrl(URL.createObjectURL(blob)); }
                catch (e) {
                  console.warn('[bake] 编辑静态位图地址创建失败', String(e && e.message || e).slice(0, 120));
                  finishUrl('');
                }
              }, 'image/png');
            } catch (e) {
              console.warn('[bake] 编辑静态位图编码失败', String(e && e.message || e).slice(0, 120));
              finishUrl('');
            }
          } else {
            try { finishUrl(cv.toDataURL()); } catch (e) { finishUrl(''); }
          }
        };
        if (!alive()) { App.releaseBakeCanvas(cv); finishResult(null); return; }
        if (App.bakeInkUseAccumulator) { afterInk(App.bakeInkFromAccumulator(ink, cv)); return; }
        App.bakeCanvasHasInkAsync(cv).then(afterInk, function () { afterInk(false); });
      };

      if (snapshotMode) {
        App.bakeSnapshotInto(cx, vis, { x: bx, y: by, w: bw, h: bh }, f, alive, ink).then(function (ok) {
          if (!ok) { App.releaseBakeCanvas(cv); finishResult(null); return; }
          finishFromCanvas(null);
        });
        return;
      }

      const tSrc = performance.now();
      App.resolveBakeLayerSources(leaves, srcSizeGlobal, undefined, alive, {
        drawable: true, f: f, keep: keep, sizes: sizes, frames: frames, useKeys: useKeys
      }).then(urls => {
        run.src = performance.now() - tSrc;
        if (!alive() || urls.length !== leaves.length) { App.releaseBakeCanvas(cv); finishResult(null); return; }
        const uniq = Array.from(new Set(urls.filter(function (u) { return typeof u === 'string' && u; })));
        const tDec = performance.now();
        App.loadBakeImages(uniq, '[bake] 编辑静态图源解码失败', alive).then(byUrl => {
          run.dec = performance.now() - tDec;
          if (!alive()) { App.releaseBakeCanvas(cv); finishResult(null); return; }
          const images = urls.map(function (u) {
            if (!u) return null;
            return typeof u === 'string' ? (byUrl.get(u) || null) : u;
          });
          const tree = App.prepareBakeTree(vis, leaves, mats, frames);
          const ready = App.bakeDrawableItems(vis, tree, images);
          const tDraw = performance.now();
          App.drawBakeTree(cx, ready.items, {
            tree: tree, images: images, mats: mats, frames: frames, f: f, ink: ink,
            rootRect: { x: bx, y: by, w: bw, h: bh }, shouldContinue: alive
          }).then(function (drawn) {
            run.draw = performance.now() - tDraw;
            if (!drawn) { App.releaseBakeCanvas(cv); finishResult(null); return; }
            finishFromCanvas(ready.failedTop);
          }).catch(function (e) { console.warn('[bake] 编辑静态绘制失败', String(e && e.message || e).slice(0, 160)); App.releaseBakeCanvas(cv); finishResult(null); });
        }).catch(e => { console.warn('[bake] 编辑静态图源加载失败', String(e && e.message || e).slice(0, 160)); App.releaseBakeCanvas(cv); finishResult(null); });
      }).catch(e => { console.warn('[bake] 编辑静态取图失败', String(e && e.message || e).slice(0, 160)); App.releaseBakeCanvas(cv); finishResult(null); });
    };
    matrixStep();
  });
};
App.editStaticDetachBg = function () {
  const es = App.editStatic;
  if (App.editStaticBgEl) {
    App.editStaticBgEl.style.display = 'none';
    App.editStaticBgEl.removeAttribute('href');
  }
  if (es.url) {
    const u = es.url;
    es.url = null;
    setTimeout(function () { try { URL.revokeObjectURL(u); } catch (e) {   } }, 0);
  }
  App.editStaticDropBase();
};
App.editStaticDropBase = function () {
  const es = App.editStatic;
  const el = App.editStaticBaseEl;
  const u = es.baseUrl;
  App.editStaticBaseEl = null;
  es.base = null;
  es.baseUrl = null;
  es._hideBase = undefined;
  if (el && el.isConnected) el.remove();
  if (u) setTimeout(function () { try { URL.revokeObjectURL(u); } catch (e) {   } }, 0);
};
App.editStaticRestack = function () {
  const root = App.layersRoot;
  if (!root) return;
  const b = App.editStaticBaseEl, d = App.editStaticBgEl;
  if (b && b.parentNode === root) root.insertBefore(b, root.firstChild);
  if (d && d.parentNode === root) {
    if (b && b.parentNode === root && b.nextSibling !== d) root.insertBefore(d, b.nextSibling || null);
    else if (!b) root.insertBefore(d, root.firstChild);
  }
};
App.editStaticBaseMaxSide = 1200;    
App.editStaticContentRect = function () {
  const layers = App.state.layers || [];
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (let i = 0; i < layers.length; i++) {
    try {
      const b = App.getItemDocBBox(layers[i]);
      if (!b || !isFinite(b.x + b.w) || !isFinite(b.y + b.h)) continue;
      minx = Math.min(minx, b.x); miny = Math.min(miny, b.y);
      maxx = Math.max(maxx, b.x + b.w); maxy = Math.max(maxy, b.y + b.h);
    } catch (e) {   }
  }
  if (!isFinite(minx) || !(maxx > minx) || !(maxy > miny)) return null;
  const padX = (maxx - minx) * 0.02, padY = (maxy - miny) * 0.02;
  const rect = {
    x: minx - padX, y: miny - padY,
    w: (maxx - minx) + padX * 2, h: (maxy - miny) + padY * 2
  };
  const capF = App.editStaticBaseMaxSide / Math.max(1, Math.max(rect.w, rect.h));
  const needF = App.editStaticNeedF ? App.editStaticNeedF() : 1;
  rect._f = Math.max(0.05, Math.min(capF, Math.max(needF, 4)));
  return rect;
};
App.editStaticDetailCoversContent = function () {
  const es = App.editStatic;
  if (!es.view) return false;
  const r = App.editStaticContentRect();
  if (!r) return false;
  return App.editStaticCovers(es.view, r);
};
App.editStaticBaseSchedule = function (delay) {
  const es = App.editStatic;
  if (!es || !es.active) return;
  if (App._editStaticBaseTimer) clearTimeout(App._editStaticBaseTimer);
  App._editStaticBaseTimer = setTimeout(function () {
    App._editStaticBaseTimer = null;
    App.runEditStaticBase();
  }, (typeof delay === 'number' && delay >= 0) ? delay : 2500);
};
App.editStaticBaseCancel = function () {
  if (App._editStaticBaseTimer) { clearTimeout(App._editStaticBaseTimer); App._editStaticBaseTimer = null; }
  App._editStaticBaseToken = (App._editStaticBaseToken || 0) + 1;    
};
App.runEditStaticBase = function () {
  const es = App.editStatic;
  if (!es || !es.active) return;
  if (App.wantOverviewBitmap && !App.wantOverviewBitmap()) {
    if (es.base) App.editStaticDropBase();
    return;
  }
  if (App.renderInteractionBusy && App.renderInteractionBusy()) { App.editStaticBaseSchedule(600); return; }
  if (es.baking) { App.editStaticBaseSchedule(500); return; }    
  if (App.editStaticDetailCoversContent()) return;
  const rect = App.editStaticContentRect();
  if (!rect || !(rect._f > 0)) return;
  const s = App.state;
  const box = App.whiteBoxLayer ? App.whiteBoxLayer() : null;
  const editItems = (s.edit && App.editTargets) ? App.editTargets() : [];
  const interMin = App.editStaticCut(s, box, editItems);
  const itemSet = App.editStaticItemSet();
  const items = [];
  for (let i = 0; i < interMin; i++) {
    const l = s.layers[i];
    if (l && itemSet.has(l)) items.push(l);
  }
  if (!items.length) return;
  const docId = (App.Tabs && App.Tabs.current) ? App.Tabs.current.id : null;
  const contentRev = App.contentRevision || 0;
  const colorRev = App._colorRev || 0;
  const structSig = App.autoStaticStructSig();
  const token = (App._editStaticBaseToken || 0) + 1;
  App._editStaticBaseToken = token;
  let lastChk = 0;
  const alive = function () {
    if (!App.editStatic.active || token !== App._editStaticBaseToken) return false;
    if ((App.contentRevision || 0) !== contentRev || (App._colorRev || 0) !== colorRev) return false;
    const curDoc = (App.Tabs && App.Tabs.current) ? App.Tabs.current.id : null;
    if (curDoc !== docId) return false;
    const now = performance.now();
    if (now - lastChk > 120) {
      lastChk = now;
      if (structSig !== App.autoStaticStructSig()) return false;
    }
    return true;
  };
  App.bakeEditStatic(items, rect, alive).then(function (bit) {
    if (!alive()) { if (bit) App.editStaticDropBit(bit); return; }
    if (!bit || !bit.url) { if (bit) App.editStaticDropBit(bit); return; }
    const stage = svgEl('image', { 'pointer-events': 'none', 'preserveAspectRatio': 'none', 'class': 'sve-edit-static' });
    App.editStaticBaseStageEl = stage;
    stage.setAttribute('x', bit.x); stage.setAttribute('y', bit.y);
    stage.setAttribute('width', bit.w); stage.setAttribute('height', bit.h);
    stage.style.visibility = 'hidden';
    App.layersRoot.insertBefore(stage, App.layersRoot.firstChild);
    let settled = false;
    const done = function (ok) {
      if (settled) return;
      settled = true;
      stage.removeEventListener('load', onLoad);
      stage.removeEventListener('error', onErr);
      if (App.editStaticBaseStageEl === stage) App.editStaticBaseStageEl = null;
      if (!ok) {
        if (stage.isConnected) stage.remove();
        App.editStaticDropBit(bit);
        return;
      }
      const oldEl = App.editStaticBaseEl;
      const oldUrl = es.baseUrl;
      stage.style.visibility = '';
      App.editStaticBaseEl = stage;
      es.base = { rect: rect, items: new Set(items), failed: bit.failedTop || null, min: interMin, bit: bit };
      es.baseUrl = bit.url;
      es._hideBase = es.base;
      if (oldEl && oldEl !== stage && oldEl.isConnected) oldEl.remove();
      if (oldUrl && oldUrl !== bit.url) {
        setTimeout(function () { try { URL.revokeObjectURL(oldUrl); } catch (e) {   } }, 0);
      }
      App.editStaticRestack();
      App.updateEditStaticViewport();
    };
    const onLoad = function () { done(true); };
    const onErr = function () { done(false); };
    stage.addEventListener('load', onLoad);
    stage.addEventListener('error', onErr);
    stage.setAttribute('href', bit.url);
  }).catch(function (e) {
    console.warn('[bake] 粗位图失败', String(e && e.message || e).slice(0, 160));
  });
};
App.editStaticClearBg = function () {
  const es = App.editStatic;
  es.view = null;
  es.bit = null;
  es.failedTop = null;
  es._bakedInterMin = undefined;
  es._bakedItems = null;
  App.editStaticDetachBg();
  App.editStaticBaseCancel();        
  try { (App.state.layers || []).forEach(l => App.restoreEsVisibility(l)); } catch (e) {   }
  if (es.active) App.editStaticBaseSchedule(2500);
};
App.editStaticDropBit = function (bit) {
  if (bit && bit.url && bit.url.indexOf('blob:') === 0) {
    try { URL.revokeObjectURL(bit.url); } catch (e) {   }
  }
};
App.beginEditStatic = function () {
  const s = App.state;
  if (!s.edit || s.edit.type === 'bg') return;
  if (App.state.eyeMode) return; 
  if (App.state.hideOthers) {
    if (App.editStatic.active || App.editStatic.baking) App.endEditStatic();
    return;
  }
  const targets = App.editTargets();
  if (App.editStatic.active) {
    const before = App.editStatic.items.length;
    App.editStatic.items = App.editStatic.items.filter(l => !targets.includes(l));
    if (App.editStatic.items.length !== before) {
      App.editStaticTouchItems();
      App.editStaticBumpToken();       
      App.editStaticClearBg();
      App.rebakeEditStaticViewport(0);
    }
    targets.forEach(l => App.restoreEsVisibility(l));
    return;
  }
  targets.forEach(l => App.restoreEsVisibility(l));
  const items = s.layers.filter(l => !targets.includes(l));
  if (!items.length) return;
  if (App.editStatic.baking) App.editStaticBumpToken();
  App.editStatic.active = true;
  App.editStatic.items = items;
  App.editStaticTouchItems();
  App.editStaticClearBg();
  App.rebakeEditStaticViewport();
};
App.endEditStatic = function () {
  if (!App.editStatic.active && !App.editStatic.baking) return;
  App.editStatic.active = false;
  App.editStatic.baking = false;
  App.editStatic.bakingToken = 0;
  App.editStatic.bakingSince = 0;
  App.editStaticBumpToken();           
  App.editStatic.items = [];
  App.editStaticTouchItems();
  App.editStatic.bit = null;
  App.editStatic.view = null;
  App.editStatic.failedTop = null;
  App.editStatic._bakedItems = null;
  App.editStatic._bakedInterMin = undefined;
  if (App._editStaticViewTimer) { clearTimeout(App._editStaticViewTimer); App._editStaticViewTimer = null; }
  App.editStaticBaseCancel();
  if (App.editStaticBaseStageEl) {
    if (App.editStaticBaseStageEl.isConnected) App.editStaticBaseStageEl.remove();
    App.editStaticBaseStageEl = null;
  }
  if (App.editStaticBgEl) {
    App.editStaticBgEl.style.display = 'none';
    App.editStaticBgEl.removeAttribute('href');
  }
  if (App.editStatic.url) {
    const u = App.editStatic.url;
    App.editStatic.url = null;
    setTimeout(function () { try { URL.revokeObjectURL(u); } catch (e) {   } }, 0);
  }
  App.editStaticDropBase();
  if (App.editStaticStageEl) {
    if (App.editStaticStageEl.isConnected) App.editStaticStageEl.remove();
    App.editStaticStageEl = null;
  }
  try { (App.state.layers || []).forEach(l => App.restoreEsVisibility(l)); } catch (e) {   }
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
    if (l.el.style.display !== 'none') l.el.style.display = 'none';
  } else {
    if (l._asPrevDisplay === undefined) return;
    l.el.style.display = l._asPrevDisplay;
    delete l._asPrevDisplay;
  }
};
App.restoreAutoStaticDisplay = function (l) { App.setAutoStaticHidden(l, false); };

App.autoStatic = { active: false, baking: false, bit: null, view: null, token: 0, hiding: [], url: null, flashUrls: null, contentRevision: null, colorRev: 0,
  base: null   };
App._colorRev = 0;
App.autoStaticBgEl = null;
App.autoStaticFlashPair = null;
App.autoStaticBaseFlashPair = null;
App.autoStaticBaseFlashUrls = null;
App.autoStaticBaseFlashToken = 0;
App.autoStaticBaseEl = null;
App.autoStaticBaseUrl = null;
App.autoStaticBaseToken = 0;
App._autoStaticBaseTimer = null;
App.autoStaticBaseMaxSide = 1400;
App._bakeCanvasSpare = null;
App.takeBakeCanvas = function (w, h) {
  let cv = App._bakeCanvasSpare;
  App._bakeCanvasSpare = null;
  if (!cv) cv = document.createElement('canvas');
  if (cv.width !== w) cv.width = w;
  if (cv.height !== h) cv.height = h;
  const cx = cv.getContext('2d');
  if (cx) cx.clearRect(0, 0, w, h);
  return cv;
};
App.releaseBakeCanvas = function (cv) {
  if (cv) App._bakeCanvasSpare = cv;
};
App.autoStaticLayerThreshold = 300;
App.overviewBitmapMinLeaves = 500;
App.wantOverviewBitmap = function () {
  let leaves = 0;
  try { leaves = App.autoStaticLeafCount ? App.autoStaticLeafCount() : 0; } catch (e) { return true; }
  return leaves >= App.overviewBitmapMinLeaves;
};
App.renderPointerActive = false;
App.renderInteractionUntil = 0;
App.renderResizeUntil = 0;
App._autoStaticQuietUntil = 0;
App._staticOverlayEndTimer = 0;
App.noteRenderInteraction = function (active) {
  if (typeof active === 'boolean') App.renderPointerActive = active;
  App.renderInteractionUntil = performance.now() + 180;
  if (!App.renderPointerActive && App.autoStaticEnabled) {
    if (App._renderIdleTimer) clearTimeout(App._renderIdleTimer);
    const markQuiet = function () {
      try {
        const baseOk = !!(App.autoStatic && App.autoStatic.base &&
          App.autoStaticBaseUsable && App.autoStaticBaseUsable());
        const fineOk = !!(App.autoStaticViewUpToDate && App.autoStaticViewUpToDate());
        if (baseOk || fineOk) {
          App._autoStaticQuietUntil = performance.now() + (baseOk ? 1200 : 800);
        }
      } catch (e) {   }
    };
    const finishGesture = function () {
      if (App.staticOverlayEnd) App.staticOverlayEnd('idle');
      markQuiet();
      if (App.autoStaticMaybe) App.autoStaticMaybe();
      if (App.editStatic && App.editStatic.active && App.rebakeEditStaticViewport) App.rebakeEditStaticViewport();
    };
    App._renderIdleTimer = setTimeout(function () {
      App._renderIdleTimer = null;
      if (App.renderPointerActive) return;
      if (App.staticOverlayBusy && App.staticOverlayBusy()) {
        if (App._staticOverlayEndTimer) clearTimeout(App._staticOverlayEndTimer);
        App._staticOverlayEndTimer = setTimeout(function () {
          App._staticOverlayEndTimer = 0;
          if (App.renderPointerActive) return;    
          finishGesture();
        }, 450);
        return;
      }
      finishGesture();
    }, 190);
  }
};
App.noteRenderResize = function () {
  const until = performance.now() + 500;
  App.renderResizeUntil = Math.max(App.renderResizeUntil || 0, until);
  if (App._renderIdleTimer) clearTimeout(App._renderIdleTimer);
  App._renderIdleTimer = setTimeout(function () {
    App._renderIdleTimer = null;
    if (App._staticOverlayEndTimer) { clearTimeout(App._staticOverlayEndTimer); App._staticOverlayEndTimer = 0; }
    if (App.staticOverlayEnd) App.staticOverlayEnd('resize');
    App._autoStaticQuietUntil = 0;
    if (App.autoStaticMaybe) App.autoStaticMaybe();
    if (App.editStatic && App.editStatic.active && App.rebakeEditStaticViewport) App.rebakeEditStaticViewport();
  }, 520);
};
App.renderInteractionBusy = function () {
  if (App.staticOverlayBusy && App.staticOverlayBusy()) return true;
  const now = performance.now();
  return !!App.renderPointerActive || now < (App.renderInteractionUntil || 0) || now < (App.renderResizeUntil || 0);
};
App.bakeDeferBusy = function () {
  if (App._bakeUrgent) return false;
  if (App.staticOverlayBusy && App.staticOverlayBusy()) return true;
  if (!App.autoStatic.active &&
      !(App.autoStatic.base && App.autoStaticBaseUsable && App.autoStaticBaseUsable())) return false;
  if (!App.renderInteractionBusy || !App.renderInteractionBusy()) return false;
  const hasBase = !!(App.autoStatic.base &&
    App.autoStaticBaseUsable && App.autoStaticBaseUsable());
  if (App.autoStatic.baking && !hasBase && !App.autoStaticViewUpToDate()) return false;
  return true;
};
App.noteBakeProgress = function () {
  if (App.autoStatic && App.autoStatic.baking) App.autoStatic._progressAt = performance.now();
};
App.autoStaticViewUpToDate = function () {
  const st = App.autoStatic;
  if (!st || !st.active || !st.view) return false;
  const v = st.view;
  const want = App.autoStaticViewportRect(0);
  const covered = v.x <= want.x && v.y <= want.y &&
    (v.x + v.w) >= (want.x + want.w) && (v.y + v.h) >= (want.y + want.h);
  if (!covered) return false;
  const f = Number(v._f) || 0;
  return !(f > 0 && (f < App.autoStaticNeedF() * (App.autoStaticResTol || 0.65) ||
    f > App.autoStaticNeedF() * 1.75));
};
App.autoStaticKeepStale = function () {
  if (!App.autoStatic || !App.autoStatic.active) return false;
  if (!(App.renderInteractionBusy && App.renderInteractionBusy())) return false;
  return App.autoStaticKeepOld();
};
App.autoStaticDeferStart = function () {
  if (!App.renderInteractionBusy || !App.renderInteractionBusy()) return false;
  return !!App.autoStatic.active ||
    !!(App.autoStatic.base && App.autoStaticBaseUsable && App.autoStaticBaseUsable());
};
App.autoStaticViewportPad = 1.0;
App.autoStaticEnabled = true;        
App.autoStaticResTol = 0.65;


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
App.autoStaticInside = function (l, rect) {
  if (!l || !rect) return false;
  const b = App.editStaticLayerBBox(l);
  if (!b) return false;
  return b.x >= rect.x && b.y >= rect.y &&
    (b.x + b.w) <= (rect.x + rect.w) && (b.y + b.h) <= (rect.y + rect.h);
};
App.autoStaticHidePrefix = function (rect, failed, keep) {
  const layers = App.state.layers || [];
  const items = [];
  let slot = 0;
  const cover = App.autoStaticCoversViewport(rect);
  const matFn = App.bakeLeafMatFn();
  if (cover) {
    const vp = App.autoStaticViewportRaw(0);
    const baseAll = App.autoStaticBaseUsable();
    const snapAll = !!(App.autoStatic.bit && App.autoStatic.bit.snapshot);
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i];
      if (!l || !l.el) continue;
      if (failed && failed.has(l.id)) continue;
      if (keep && keep.has(l)) continue;
      if (!baseAll && !snapAll && !App.bakeFrameDocIntersects(l, vp, matFn)) continue;
      items.push(l);
    }
    return { items: items, slot: null, cover: true, baseAll: baseAll || snapAll };
  }
  if (App.docNeedsSnapshot && App.docNeedsSnapshot()) {
    return { items: [], slot: 0, cover: false };
  }
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    if (!l || !l.el) break;
    if (failed && failed.has(l.id)) break;
    if (keep && keep.has(l)) break;
    const fb = App.bakeFrameDocRect(l, matFn);
    if (!fb || fb.x < rect.x || fb.y < rect.y ||
        (fb.x + fb.w) > (rect.x + rect.w) || (fb.y + fb.h) > (rect.y + rect.h)) break;
    items.push(l); slot = i + 1;
  }
  return { items: items, slot: slot, cover: false };
};
App.autoStaticCoversViewport = function (rect) {
  if (!rect) return false;
  try {
    return App.autoStaticRectCovers(rect, App.autoStaticCoverNeed(0), 0.5);
  } catch (err) { return false; }
};
App.autoStaticPlace = function (slot) {
  const root = App.layersRoot;
  if (!root) return;
  const layers = App.state.layers || [];
  const fine = App.autoStaticBgEl, base = App.autoStaticBaseEl;
  if (slot === null) {
    if (fine && fine.parentNode === root && root.firstChild !== fine) root.insertBefore(fine, root.firstChild);
    if (base && base.parentNode === root && root.firstChild !== base) root.insertBefore(base, root.firstChild);
    return;
  }
  const ref = (slot >= 0 && slot < layers.length && layers[slot] && layers[slot].el &&
    layers[slot].el.parentNode === root) ? layers[slot].el : null;
  if (fine && fine.parentNode === root) {
    if (ref) { if (fine.nextSibling !== ref) root.insertBefore(fine, ref); }
    else if (fine !== root.lastChild) root.appendChild(fine);
  }
  if (base && base.parentNode === root && root.firstChild !== base) root.insertBefore(base, root.firstChild);
};
App.autoStaticAudit = function (slot) {
  const root = App.layersRoot, layers = App.state.layers || [];
  const fine = App.autoStaticBgEl, base = App.autoStaticBaseEl;
  const autoHidden = ((App.autoStatic && App.autoStatic.hiding) || [])
    .filter(function (l) { return l && l.el; }).length;
  const fineUsable = !!(fine && fine.isConnected && fine.getAttribute('href'));
  const baseUsable = !!(base && base.isConnected && base.getAttribute('href'));
  if (!root) return autoHidden ? 'precondition:no-layers-root' : null;
  if (autoHidden > 0 && !fineUsable && !baseUsable) return 'precondition:no-bitmap';
  if (!fineUsable) return null;
  const kids = Array.prototype.slice.call(root.children);
  const pos = new Map();
  kids.forEach(function (k, i) { pos.set(k, i); });
  const fi = kids.indexOf(fine);
  if (slot === null) {
    const vp = App.autoStaticViewportRaw(0);
    const matFn = App.bakeLeafMatFn();
    const snap = !!(App.autoStatic.bit && App.autoStatic.bit.snapshot);
    const keepVec = new Set(App.autoStatic.vectorKeep || []);
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i];
      if (!l || !l.el) continue;
      if (l.el.style.display === 'none') continue;
      if (keepVec.has(l)) continue;
      if (snap) return 'visible-in-viewport:' + i;
      if (App.bakeFrameDocIntersects(l, vp, matFn)) return 'visible-in-viewport:' + i;
    }
    if (base && base.parentNode === root && kids.indexOf(base) > fi) return 'base-above-fine';
    return null;
  }
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    if (!l || !l.el) continue;
    const hidden = l.el.style.display === 'none';
    if (i < slot && !hidden) return 'prefix-not-hidden:' + i;
    if (i >= slot && hidden) return 'above-prefix-hidden:' + i;
    const li = pos.has(l.el) ? pos.get(l.el) : -1;
    if (!hidden && li >= 0 && li < fi) return 'vector-below-bitmap:' + i;
  }
  if (base && base.parentNode === root && kids.indexOf(base) > fi) return 'base-above-fine';
  return null;
};
App.autoStaticSelfHeal = function () {
  const a = App.autoStatic;
  if (!a || a.baking) return false;
  if (App.layersRoot && App.layersRoot.style.display === 'none' &&
      !App.state.layersHidden && App.state.eyeMode !== 'bg' && !App.state.batching) {
    App.layersRoot.style.display = '';
    return true;
  }
  const el = App.autoStaticBgEl;
  const usable = !!(a.bit && el && el.isConnected && el.getAttribute('href'));
  if (a.active && !usable) { App.autoStaticRelease('self-heal'); return true; }
  const baseOk = !!(a.base && App.autoStaticBaseUsable && App.autoStaticBaseUsable());
  if (!a.active && !baseOk && (a.hiding || []).length) {
    (a.hiding || []).forEach(function (l) { try { App.restoreAutoStaticDisplay(l); } catch (e) {   } });
    a.hiding = [];
    return true;
  }
  return false;
};
App.autoStaticEligible = function () {
  if (App.editStatic && App.editStatic.active) {
    if (App.state.edit) return false;
    if (App.editStaticHealthy && App.editStaticHealthy()) return false;
  }
  if (!App.autoStaticEnabled) return false;    
  if (!App.state.layers || !App.state.layers.length) return false;
  if (App.state.edit) return false;             
  if (App.state.eyeMode) return false;          
  if (App.state.layersHidden) return false;     
  if (App.state.hideOthers) return false;
  if (App.state.batching) return false;         
  if (App._colorYield) return false;
  if (App.autoStatic.active && App.autoStatic.bit) return true;
  if (App.autoStatic.base && App.autoStaticBaseUsable && App.autoStaticBaseUsable()) return true;
  if (!App.autoStaticNeeded()) return false;
  if (App.autoStaticVisibleLeafCount() >= App.autoStaticLayerThreshold) return true;
  return !!(App.autoStatic.active && App.autoStatic.bit);
};
App.autoStaticVisibleLeafCount = function () {
  const layers = App.state.layers || [];
  if (!layers.length) return 0;
  if (App.docNeedsSnapshot && App.docNeedsSnapshot()) {
    let total = 0;
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i];
      total += 1;
      if (l.kind === 'merged' && App.countInLayer) total += App.countInLayer(l) - 1;
    }
    App.renderPerfCounters.autoVisibleScans++;
    App.renderPerfCounters.autoVisibleLeaves += total;
    return total;
  }
  const vp = App.autoStaticViewportRect();
  const matFn = App.bakeLeafMatFn();
  let n = 0;
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    let inside = true;
    try { inside = App.bakeFrameDocIntersects(l, vp, matFn); } catch (e) { inside = true; }
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
  if (App.docNeedsSnapshot && App.docNeedsSnapshot()) {
    const bb = App.snapContentBBox();
    if (!bb) return null;
    return { minx: bb.x, miny: bb.y, maxx: bb.x + bb.width, maxy: bb.y + bb.height };
  }
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  const matFn = App.bakeLeafMatFn();
  for (let i = 0; i < layers.length; i++) {
    try {
      const l = layers[i];
      const b = (l.kind === 'merged')
        ? App.getItemDocBBox(l)
        : (App.bakeFrameDocRect(l, matFn) || App.getItemDocBBox(l));
      if (!b || !isFinite(b.x + b.w)) continue;
      minx = Math.min(minx, b.x); miny = Math.min(miny, b.y);
      maxx = Math.max(maxx, b.x + b.w); maxy = Math.max(maxy, b.y + b.h);
    } catch (e) {   }
  }
  if (!isFinite(minx)) return null;
  return { minx: minx, miny: miny, maxx: maxx, maxy: maxy };
};
App._autoContentBBoxCache = null;
App.autoStaticContentBBoxCached = function () {
  const layers = (App.state && App.state.layers) || [];
  const key = String(layers.length) + ':' + (App.contentRevision || 0);
  if (App._autoContentBBoxCache && App._autoContentBBoxCache.key === key) return App._autoContentBBoxCache.bb;
  const bb = App.autoStaticContentBBox();
  App._autoContentBBoxCache = { key: key, bb: bb };
  return bb;
};
App.autoStaticCoverNeed = function (pad) {
  const want = App.autoStaticViewportRect(typeof pad === 'number' ? pad : 0);
  const content = App.autoStaticContentBBoxCached();
  if (!content) return want;
  const x1 = Math.max(want.x, content.minx), y1 = Math.max(want.y, content.miny);
  const x2 = Math.min(want.x + want.w, content.maxx), y2 = Math.min(want.y + want.h, content.maxy);
  if (x2 > x1 && y2 > y1) return { x: x1, y: y1, w: x2 - x1, h: y2 - y1, scale: want.scale };
  return want;
};
App.autoStaticRectCovers = function (rect, need, e) {
  if (!rect || !need) return false;
  const m = typeof e === 'number' ? e : 0;
  return rect.x <= need.x + m && rect.y <= need.y + m &&
    (rect.x + rect.w) >= (need.x + need.w) - m && (rect.y + rect.h) >= (need.y + need.h) - m;
};
App.autoStaticViewportRect = function (pad) {
  const v = App.state.view;
  const r = App.wrap.getBoundingClientRect();
  const sc = v.scale || 1;
  const vw = r.width / sc, vh = r.height / sc;
  const p = (typeof pad === 'number') ? pad : 0.5;
  let x = v.x - vw * p, y = v.y - vh * p, w = vw * (1 + p * 2), h = vh * (1 + p * 2);
  try {
    const b = App.autoStaticContentBBoxCached();
    if (b) {
      const x2 = Math.max(x, b.minx), y2 = Math.max(y, b.miny);
      const x3 = Math.min(x + w, b.maxx), y3 = Math.min(y + h, b.maxy);
      if (x3 > x2 && y3 > y2) { x = x2; y = y2; w = x3 - x2; h = y3 - y2; }
    }
  } catch (e) {   }
  const dpr = window.devicePixelRatio || 1;
  const u = 1 / Math.max(1e-6, sc * dpr);
  const x0 = v.x + Math.floor((x - v.x) / u) * u, y0 = v.y + Math.floor((y - v.y) / u) * u;
  const x1 = v.x + Math.ceil((x + w - v.x) / u) * u, y1 = v.y + Math.ceil((y + h - v.y) / u) * u;
  return { x: x0, y: y0, w: Math.max(u, x1 - x0), h: Math.max(u, y1 - y0), scale: sc };
};

App.autoStaticViewportRaw = function (pad) {
  const v = App.state.view;
  const r = App.wrap.getBoundingClientRect();
  const sc = v.scale || 1;
  const p = (typeof pad === 'number') ? pad : 0;
  const vw = r.width / sc, vh = r.height / sc;
  return { x: v.x - vw * p, y: v.y - vh * p, w: vw * (1 + p * 2), h: vh * (1 + p * 2), scale: sc };
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

App.prepareBakeTree = function (items, leaves, mats, frames) {
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
      const fr = (frames && i !== undefined) ? frames[i] : null;
      if (m) {
        if (fr) {
          let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
          [[fr.x, fr.y], [fr.x + fr.w, fr.y], [fr.x + fr.w, fr.y + fr.h], [fr.x, fr.y + fr.h]].forEach(function (p) {
            const q = new DOMPoint(p[0], p[1]).matrixTransform(m);
            mnx = Math.min(mnx, q.x); mny = Math.min(mny, q.y);
            mxx = Math.max(mxx, q.x); mxy = Math.max(mxy, q.y);
          });
          if (isFinite(mnx)) b = { x: mnx, y: mny, w: mxx - mnx, h: mxy - mny };
        } else {
          const hw = Math.abs(node.w || 0) / 2, hh = Math.abs(node.h || 0) / 2;
          const ex = Math.abs(m.a) * hw + Math.abs(m.c) * hh;
          const ey = Math.abs(m.b) * hw + Math.abs(m.d) * hh;
          b = { x: m.e - ex, y: m.f - ey, w: ex * 2, h: ey * 2 };
        }
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
  const ink = options.ink || null;          
  const frames = options.frames || null;    
  const f = options.f || 1;
  const root = options.rootRect || { x: 0, y: 0, w: 1, h: 1 };
  const alive = typeof options.shouldContinue === 'function' ? options.shouldContinue : function () { return true; };
  let sliceStart = performance.now();
  const hiQ = function (c) {
    if (!c) return;
    try { c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; } catch (e) {   }
  };
  hiQ(ctx);
  const clip = function (b) {
    if (!b) return null;
    const x1 = Math.max(root.x, b.x), y1 = Math.max(root.y, b.y);
    const x2 = Math.min(root.x + root.w, b.x + b.w), y2 = Math.min(root.y + root.h, b.y + b.h);
    return x2 > x1 && y2 > y1 ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : null;
  };
  const waitForBudget = function () {
    if (!alive()) return Promise.resolve(false);
    const busy = App.bakeDeferBusy();
    if (!busy && performance.now() - sliceStart < 8) return null;
    return new Promise(function (resolve) {
      const resume = function () {
        if (!alive()) { resolve(false); return; }
        if (App.bakeDeferBusy()) { if (App.noteBakeProgress) App.noteBakeProgress(); setTimeout(resume, 60); return; }
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
          hiQ(sc);
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
        const op = App.bakeOpacity(node);
        target.save();
        const T = new DOMMatrix().translate(-origin.x * f, -origin.y * f).scale(f).multiply(m);
        target.setTransform(T.a, T.b, T.c, T.d, T.e, T.f);
        target.globalCompositeOperation = 'source-over';
        target.globalAlpha = op;
        const fr = (frames && i !== undefined) ? frames[i] : null;
        const dx = fr ? fr.x : -(node.w || 0) / 2;
        const dy = fr ? fr.y : -(node.h || 0) / 2;
        const dw = fr ? fr.w : (node.w || 0);
        const dh = fr ? fr.h : (node.h || 0);
        target.drawImage(img, 0, 0, img.width, img.height, dx, dy, dw, dh);
        target.restore();
        if (ink && op > 0) {
          ink.drawn++;
          ink.alpha += op;
          const area = Math.abs(dw * dh) * f * f * op;
          if (isFinite(area)) ink.px += area;
        }
      }
      const wait = waitForBudget();
      if (wait && !(await wait)) return false;
      if (App.noteBakeProgress) App.noteBakeProgress();
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
App.removeAutoStaticBaseFlashPair = function () {
  const p = App.autoStaticBaseFlashPair;
  App.autoStaticBaseFlashPair = null;
  if (p) App.removeAutoStaticFlashPair(p);
  const u = App.autoStaticBaseFlashUrls;
  App.autoStaticBaseFlashUrls = null;
  App.revokeAutoStaticFlashUrls(u);
};
App.autoStaticFlashPairUsable = function (pair) {
  if (!pair || !pair.g || !pair.g.isConnected) return false;
  if (!pair.yellow || !pair.blue) return false;
  if (!pair.yellow.getAttribute('href') || !pair.blue.getAttribute('href')) return false;
  if (!pair.target || !pair.target.isConnected) return false;
  return true;
};
App.buildAutoStaticBaseFlashPair = function (bit, stage, alive) {
  App.removeAutoStaticBaseFlashPair();
  if (!bit || !bit.url || !stage || !App.autoStaticFlashG) return;
  const token = ++App.autoStaticBaseFlashToken;
  const ok = function () {
    if (token !== App.autoStaticBaseFlashToken) return false;
    return typeof alive === 'function' ? !!alive() : true;
  };
  const build = function (img) {
    if (!ok() || !img || !img.width) return;
    App.buildAutoStaticFlashUrls(img, ok).then(function (urls) {
      if (!urls) return;
      if (!ok() || !stage.isConnected || App.autoStaticBaseEl !== stage) {
        App.revokeAutoStaticFlashUrls(urls);
        return;
      }
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
      const pair = { g: g, yellow: make(urls.yellow), blue: make(urls.blue), target: stage, base: true };
      App.autoStaticFlashG.appendChild(g);
      App.autoStaticBaseFlashPair = pair;
      App.autoStaticBaseFlashUrls = urls;
      try {
        App.log('perf', '整幅剪影就绪', {
          w: Math.round(bit.w), h: Math.round(bit.h),
          f: Math.round((bit.f || 0) * 100) / 100
        });
      } catch (e) {   }
    }).catch(function (e) {
      console.warn('[bake] 整幅剪影生成失败', String(e && e.message || e).slice(0, 160));
    });
  };
  if (bit._img && bit._img.width) { build(bit._img); return; }
  loadImage(bit.url).then(build).catch(function () {   });
};
App.autoStaticAbortBake = function (why) {
  const a = App.autoStatic;
  if (!a || !a.baking) return false;
  a.token = (a.token || 0) + 1;
  a.baking = false;
  a.bakingToken = 0;
  a.bakingSince = 0;
  a._finishing = 0;
  a._stage = 'aborted';
  App._autoStaticQuietUntil = performance.now() + 1200;
  try {
    App.log('perf', '烘焙中止', {
      why: String(why || '').slice(0, 24), leaf: a._run ? a._run.leaf : 0
    });
  } catch (e) {   }
  return true;
};
App.autoStaticRelease = function (reason, keepBase) {
  const releaseWhy = String(reason || 'release').slice(0, 40);
  if (App.staticOverlayBusy && App.staticOverlayBusy() && App.staticOverlayEnd) {
    App.staticOverlayEnd('release:' + releaseWhy);
  }
  if (App.autoStatic && App.autoStatic.active) {
    try { App._asRelStack = String((new Error()).stack || '').split(String.fromCharCode(10)).slice(1, 6).join(' <- ').slice(0, 400); } catch (e) {   }
  }
  App._bakeUrgent = 0;
  App._autoStaticSig = null;
  App.autoStatic._finishing = 0;
  if (!App.autoStatic.active && !App.autoStatic.baking && !(App.autoStatic.hiding || []).length &&
      !App.autoStaticFlashPair && !App.autoStaticBaseFlashPair && !App.autoStatic.flashUrls && !App.autoStaticBaseEl &&
      !App.autoStatic.base) return;
  App.autoStatic.active = false;
  App.autoStatic.baking = false;
  App.autoStatic.token++;
  (App.autoStatic.hiding || []).forEach(function (l) { try { App.restoreAutoStaticDisplay(l); } catch (e) {   } });
  (App.autoStatic.vectorKeep || []).forEach(function (l) { try { App.restoreAutoStaticDisplay(l); } catch (e) {   } });
  App.autoStatic.vectorKeep = null;

  App.autoStatic.hiding = [];
  App.autoStatic.bit = null;
  App.autoStatic.view = null;
  App.autoStatic.contentRevision = null;
  App.drb('bit.release.auto');
  App.dr('bit.release', { owner: 'auto', reason: releaseWhy, hidden: 0, gen: Number(App.viewRevision) || 0 });
  App.dr('visibility.restore', { owner: 'auto', hidden: 0, visible: (App.state.layers || []).length, vector: 'all' });
  App.autoStatic._emptyAt = 0;    
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
  App.removeAutoStaticBaseFlashPair();
  App.revokeAutoStaticFlashUrls(App.autoStatic.flashUrls);
  App.autoStatic.flashUrls = null;
  if (App.autoStaticBgEl) {
    App.autoStaticBgEl.style.display = 'none';
    App.autoStaticBgEl.removeAttribute('href');
  }
  if (!keepBase) {
    App.autoStaticDropBase(releaseWhy);
  } else if (App.autoStaticBaseUsable && App.autoStaticBaseUsable()) {
    try { App.autoStaticApplyHiding(); } catch (e) {   }
  }
};
App.autoStaticContentRect = function () {
  const b = App.autoStaticContentBBoxCached ? App.autoStaticContentBBoxCached() : App.autoStaticContentBBox();
  if (!b || !isFinite(b.minx) || !(b.maxx > b.minx) || !(b.maxy > b.miny)) return null;
  const w = b.maxx - b.minx, h = b.maxy - b.miny;
  const px = w * 0.02, py = h * 0.02;
  const rect = { x: b.minx - px, y: b.miny - py, w: w + px * 2, h: h + py * 2 };
  const capF = App.autoStaticBaseMaxSide / Math.max(1, Math.max(rect.w, rect.h));
  const needF = App.autoStaticNeedF ? App.autoStaticNeedF() : 1;
  rect._f = Math.max(0.05, Math.min(capF, Math.max(needF, 4)));
  return rect;
};
App.autoStaticBaseUsable = function () {
  const a = App.autoStatic;
  if (!a || !a.base || !a.base.rect) return false;
  const el = App.autoStaticBaseEl;
  if (!el || !el.isConnected || !el.getAttribute('href')) return false;
  if (el.style.display === 'none') return false;
  if (a.base.contentRev !== undefined && a.base.contentRev !== (App.contentRevision || 0)) return false;
  if (a.base.colorRev !== undefined && a.base.colorRev !== (App._colorRev || 0)) return false;
  const r = a.base.rect;
  const key = (App.contentRevision || 0) + ':' + ((App.state.layers || []).length) + ':' +
    Math.round(r.x) + ',' + Math.round(r.y) + ',' + Math.round(r.w) + ',' + Math.round(r.h);
  if (a._baseChkKey === key) return a._baseChkVal;
  let ok = true, cb = null;
  try {
    cb = App.autoStaticContentBBoxCached ? App.autoStaticContentBBoxCached() : App.autoStaticContentBBox();
    if (cb && isFinite(cb.minx) && isFinite(cb.maxx)) {
      const eps = Math.max(1, Math.max(r.w, r.h) * 0.02);
      ok = r.x <= cb.minx + eps && r.y <= cb.miny + eps &&
        r.x + r.w >= cb.maxx - eps && r.y + r.h >= cb.maxy - eps;
    }
  } catch (e) { ok = true; }
  a._baseChkKey = key;
  a._baseChkVal = ok;
  if (!ok) {
    console.warn('[bake] 粗图矩形与内容包围盒不符，丢弃重烘', {
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) },
      content: cb ? { x: Math.round(cb.minx), y: Math.round(cb.miny), w: Math.round(cb.maxx - cb.minx), h: Math.round(cb.maxy - cb.miny) } : null
    });
    App.autoStaticDropBase('geometry-mismatch');
    App.autoStaticBaseSchedule(400);
  }
  return ok;
};
App.autoStaticApplyHiding = function () {
  const a = App.autoStatic;
  if (!a) return;
  const hasBase = !!(a.base && App.autoStaticBaseUsable && App.autoStaticBaseUsable());
  if (!a.active && !hasBase) return;
  const layers = App.state.layers || [];
  const keep = new Set(a.vectorKeep || []);
  const fineOk = !!(a.view && a.bit && App.autoStaticBgEl && App.autoStaticBgEl.isConnected &&
    App.autoStaticBgEl.getAttribute('href') && App.autoStaticBgEl.style.display !== 'none');
  const baseOk = App.autoStaticBaseUsable();
  const fineCovers = !!(fineOk && a.view && App.autoStaticCoversViewport(a.view));
  const authority = baseOk ? a.base : (fineCovers ? { rect: a.view } : null);
  if (!authority) {
    (a.hiding || []).forEach(function (l) { try { App.restoreAutoStaticDisplay(l); } catch (e) {   } });
    a.hiding = [];
    a._hidePrefix = 0;
    a._hideMode = 'none';
    return;
  }
  const failed = baseOk ? (a.base.failed || (a.bit && a.bit.failedTop) || null)
    : ((a.bit && a.bit.failedTop) || null);
  const plan = { items: [], slot: null, cover: true, baseAll: !!baseOk };
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    if (!l || !l.el) continue;
    if (keep.has(l)) continue;
    if (failed && failed.has(l.id)) continue;
    plan.items.push(l);
  }
  try {
    const failN = failed ? (failed.size !== undefined ? failed.size : (failed.length || 0)) : 0;
    const visSample = [];
    for (let i = 0; i < layers.length && visSample.length < 8; i++) {
      const l = layers[i];
      if (l && l.el && l.el.style.display !== 'none' && !keep.has(l)) visSample.push(i);
    }
    App.dr('plan.cull', {
      owner: 'auto', total: layers.length, hidden: plan.items ? plan.items.length : 0,
      culled: Math.max(0, layers.length - (plan.items ? plan.items.length : 0) - keep.size - failN),
      fail: failN, keep: keep.size, baseAll: plan.baseAll ? 1 : 0,
      scope: plan.cover ? 'viewport' : 'prefix', top: visSample,
      roi: [Math.round(authority.rect.x), Math.round(authority.rect.y), Math.round(authority.rect.w), Math.round(authority.rect.h)]
    });
  } catch (e) {   }
  const hideSet = new Set(plan.items);
  const hiding = [];
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    if (!l || !l.el) continue;
    const hide = hideSet.has(l);
    try { App.setAutoStaticHidden(l, hide); } catch (e) {   }
    if (hide) hiding.push(l);
  }
  a.hiding = hiding;
  a._hidePrefix = plan.slot === null ? -1 : plan.slot;
  a._hideMode = 'all';
  App.dr('visibility.apply', {
    owner: 'auto', hidden: hiding.length, visible: layers.length - hiding.length,
    slot: a._hidePrefix, mode: a._hideMode,
    bit: baseOk ? 2 : 1, gen: Number(App.viewRevision) || 0,
    baseAll: plan.baseAll ? 1 : 0, authority: baseOk ? 'base' : 'fine',
    cover: baseOk ? 'content' : 'viewport',
    roi: [Math.round(authority.rect.x), Math.round(authority.rect.y),
      Math.round(authority.rect.w), Math.round(authority.rect.h)],
    vector: fineOk || baseOk ? 'partial' : 'all'
  });
  App.autoStaticPlace(plan.slot);
  if (App.renderAssert) {
    const bad = App.autoStaticAudit(plan.slot);
    if (bad) {
      console.warn('[autoStatic] z-order violated', { at: bad, slot: plan.slot, layers: layers.length });
      a._auditFails = (a._auditFails || 0) + 1;
      App.autoStaticRelease();
      return;
    }
  }
  if (App.autoStaticBaseEl) {
    const fineCovers = !!(fineOk && a.view &&
      App.autoStaticRectCovers(a.view, App.autoStaticCoverNeed(0)));
    App.autoStaticBaseEl.style.visibility = fineCovers ? 'hidden' : '';
    if (App.autoStaticBaseEl.style.display === 'none') App.autoStaticBaseEl.style.display = '';
    if (App.staticOverlayBusy && App.staticOverlayBusy()) {
      App.autoStaticBaseEl.style.visibility = 'hidden';
    }
  }
};
App.autoStaticDropBase = function (reason) {
  const why = reason || 'release';
  if (App.autoStatic && (App.autoStatic.base || App.autoStatic.baseBaking || App.autoStaticBaseEl)) {
    try {
      App.log('perf', '粗图丢弃', {
        reason: why, hadBase: !!App.autoStatic.base,
        baseBaking: !!App.autoStatic.baseBaking, el: !!App.autoStaticBaseEl,
        baseRev: App.autoStatic.base ? App.autoStatic.base.contentRev : null,
        contentRev: App.contentRevision || 0
      });
    } catch (e) {   }
  }
  App.autoStaticBaseToken = (App.autoStaticBaseToken || 0) + 1;    
  if (App._autoStaticBaseTimer) { clearTimeout(App._autoStaticBaseTimer); App._autoStaticBaseTimer = null; }
  const el = App.autoStaticBaseEl, url = App.autoStaticBaseUrl;
  App.autoStaticBaseEl = null;
  App.autoStaticBaseUrl = null;
  App.removeAutoStaticBaseFlashPair();
  if (App.autoStatic) App.autoStatic.base = null;
  if (el && el.isConnected) el.remove();
  if (url) setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {   } }, 0);
};
App.autoStaticBaseSchedule = function (delay) {
  if (!App.autoStatic) return;
  if (App.wantOverviewBitmap && !App.wantOverviewBitmap()) return;
  if (App._autoStaticBaseTimer) clearTimeout(App._autoStaticBaseTimer);
  App._autoStaticBaseTimer = setTimeout(function () {
    App._autoStaticBaseTimer = null;
    App.autoStaticBaseRun();
  }, (typeof delay === 'number' && delay >= 0) ? delay : 2000);
};
App.autoStaticBaseRun = function () {
  const a = App.autoStatic;
  if (!a) return;
  if (App.staticOverlayBusy && App.staticOverlayBusy()) return;
  const quietLeft = (App._autoStaticQuietUntil || 0) - performance.now();
  if (quietLeft > 0) { App.autoStaticBaseSchedule(Math.min(900, quietLeft)); return; }
  const skip = function (why) {
    if (App._baseSkipSig === why) return;
    App._baseSkipSig = why;
    try {
      App.log('perf', '粗图跳过', {
        why: why, scale: Math.round((App.state.view.scale || 1) * 100) / 100,
        tops: (App.state.layers || []).length, active: !!a.active,
        baking: !!a.baking, baseBaking: !!a.baseBaking, base: !!a.base
      });
    } catch (e) {   }
  };
  if (App.wantOverviewBitmap && !App.wantOverviewBitmap()) { skip('want-overview-off'); return; }    
  if (a.baking && !a.active && !a.base) {
    a.token = (a.token || 0) + 1;
    a.baking = false;
    a.bakingToken = 0;
    a._finishing = 0;
  }
  if (a.baking || a.baseBaking) { skip('bake-busy'); App.autoStaticBaseSchedule(700); return; }  
  const coveredNow = !!(a.active ||
    (a.base && App.autoStaticBaseUsable && App.autoStaticBaseUsable()));
  if (!coveredNow && App.renderInteractionBusy && App.renderInteractionBusy()) {
    skip('interaction-uncovered');  
  } else if (App.renderInteractionBusy && App.renderInteractionBusy()) {
    skip('interaction-covered'); App.autoStaticBaseSchedule(700); return;
  }
  if (a.base && App.autoStaticBaseUsable && !App.autoStaticBaseUsable()) {
    try {
      App.log('perf', '粗图过期', {
        baseRev: a.base.contentRev, contentRev: App.contentRevision || 0,
        baseColorRev: a.base.colorRev, colorRev: App._colorRev || 0
      });
    } catch (e) {   }
    App.autoStaticDropBase('stale');
  }
  if (a.base && App.autoStaticBaseUsable && App.autoStaticBaseUsable()) { skip('already-usable'); return; }
  const rect = App.autoStaticContentRect();
  if (!rect || !(rect._f > 0)) { skip('no-content-rect'); return; }
  App._baseSkipSig = '';
  try {
    App.log('perf', '粗图开始', {
      leaf: (App.state.layers || []).length, f: Math.round(rect._f * 100) / 100,
      rect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.w), Math.round(rect.h)],
      contentRev: App.contentRevision || 0, scale: Math.round((App.state.view.scale || 1) * 100) / 100
    });
  } catch (e) {   }
  const token = ++App.autoStaticBaseToken;
  a.baseBaking = true;
  const items = (App.state.layers || []).slice();
  const contentRev = App.contentRevision || 0;
  const colorRev = App._colorRev || 0;
  const structSig = App.autoStaticStructSig();
  const docId = App.Tabs && App.Tabs.current ? App.Tabs.current.id : null;
  let lastChk = 0;
  const alive = function () {
    if (token !== App.autoStaticBaseToken) return false;
    if ((App.contentRevision || 0) !== contentRev || (App._colorRev || 0) !== colorRev) return false;
    const cur = App.Tabs && App.Tabs.current ? App.Tabs.current.id : null;
    if (cur !== docId) return false;
    const now = performance.now();
    if (now - lastChk > 120) { lastChk = now; if (structSig !== App.autoStaticStructSig()) return false; }
    return true;
  };
  let pBase;
  try {
    pBase = App.bakeAutoStatic(items, rect, alive, { skipFlash: true });
  } catch (e) {
    a.baseBaking = false;
    return;
  }
  if (!pBase || typeof pBase.then !== 'function') { a.baseBaking = false; return; }
  pBase.then(function (bit) {
    a.baseBaking = false;
    if (!alive() || !bit || !bit.url) {
      if (bit && bit.url && bit.url.indexOf('blob:') === 0) { try { URL.revokeObjectURL(bit.url); } catch (e) {   } }
      return;
    }
    const stage = svgEl('image', { 'pointer-events': 'none', preserveAspectRatio: 'none', class: 'sve-auto-static' });
    App.autoStaticBaseEl = stage;
    stage.setAttribute('x', bit.x); stage.setAttribute('y', bit.y);
    stage.setAttribute('width', bit.w); stage.setAttribute('height', bit.h);
    stage.style.visibility = 'hidden';
    const detail = App.autoStaticBgEl;
    if (detail && detail.parentNode === App.layersRoot) App.layersRoot.insertBefore(stage, detail);
    else App.layersRoot.insertBefore(stage, App.layersRoot.firstChild);
    let settled = false;
    const done = function (ok) {
      if (settled) return;
      settled = true;
      stage.removeEventListener('load', onLoad);
      stage.removeEventListener('error', onErr);
      if (!ok || !alive() || App.autoStaticBaseEl !== stage) {
        if (stage.isConnected) stage.remove();
        if (App.autoStaticBaseEl === stage) App.autoStaticBaseEl = null;
        if (bit.url && bit.url.indexOf('blob:') === 0) { try { URL.revokeObjectURL(bit.url); } catch (e) {   } }
        return;
      }
      const oldEl = a.base && a.base.el;
      const oldUrl = App.autoStaticBaseUrl;
      stage.style.visibility = '';
      stage.style.display = '';
      a.base = { rect: rect, items: null, failed: bit.failedTop || null, bit: bit, el: stage,
        contentRev: contentRev, colorRev: colorRev };
      try {
        App.log('perf', '粗图安装', {
          w: Math.round(bit.w), h: Math.round(bit.h), f: Math.round((bit.f || 0) * 100) / 100,
          contentRev: contentRev, colorRev: colorRev,
          rect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.w), Math.round(rect.h)]
        });
      } catch (e) {   }
      App.autoStaticBaseUrl = bit.url.indexOf('blob:') === 0 ? bit.url : null;
      if (oldEl && oldEl !== stage && oldEl.isConnected) oldEl.remove();
      if (oldUrl && oldUrl !== App.autoStaticBaseUrl) {
        setTimeout(function () { try { URL.revokeObjectURL(oldUrl); } catch (e) {   } }, 0);
      }
      App.buildAutoStaticBaseFlashPair(bit, stage, alive);
      App.autoStaticApplyHiding();
    };
    const onLoad = function () { requestAnimationFrame(function () { requestAnimationFrame(function () { done(true); }); }); };
    const onErr = function () { done(false); };
    stage.addEventListener('load', onLoad);
    stage.addEventListener('error', onErr);
    loadImage(bit.url).then(function (im) { bit._img = im; }).catch(function () {   });
    stage.setAttribute('href', bit.url);
  }).catch(function (e) {
    a.baseBaking = false;
    console.warn('[bake] 粗位图失败', String(e && e.message || e).slice(0, 160));
  });
};
App.buildAutoStaticFlashUrls = function (source, shouldContinue) {
  if (!source || !source.width || !source.height) return Promise.resolve(null);
  const alive = typeof shouldContinue === 'function' ? shouldContinue : function () { return true; };
  if (!alive()) return Promise.resolve(null);
  const tw = Math.max(1, Math.round(source.width / 2));
  const th = Math.max(1, Math.round(source.height / 2));
  const tinted = document.createElement('canvas');
  tinted.width = tw;
  tinted.height = th;
  const cx = tinted.getContext('2d');
  const encode = function (color, label) {
    cx.globalCompositeOperation = 'source-over';
    cx.clearRect(0, 0, tinted.width, tinted.height);
    cx.drawImage(source, 0, 0, source.width, source.height, 0, 0, tinted.width, tinted.height);
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
  return encode('#EBEA3A', 'yellow').then(function (url) {
    yellow = url;
    if (!alive()) {
      App.revokeAutoStaticFlashUrls({ yellow: yellow });
      yellow = '';
      return '';
    }
    return encode('#0A0AFC', 'blue');
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
App.bakeAutoStatic = function (items, viewport, shouldContinue, opts) {
  const skipFlash = !!(opts && opts.skipFlash);
  const leafMat = App.bakeLeafMatFn();
  const quickLeaves = [];
  const quickWalk = function (l) { if (l.kind === 'merged') (l.children || []).forEach(quickWalk); else quickLeaves.push(l); };
  (items || []).forEach(quickWalk);
  const snapshotMode = App.bakeNeedSnapshot(quickLeaves);
  const vis = (viewport && !snapshotMode)
    ? items.filter(function (l) { return App.bakeFrameDocIntersects(l, viewport, leafMat); })
    : items;
  const leaves = [];
  const walk = function (l) { if (l.kind === 'merged') (l.children || []).forEach(walk); else leaves.push(l); };
  vis.forEach(walk);
  if (!leaves.length) {
    App.drb('bake.abort.empty');
    App.dr('bake.abort', { owner: 'auto', why: 'no-leaves', tops: (items || []).length });
    return Promise.resolve(null);
  }
  const bakeT0 = performance.now();
  App.drb('bake.start.auto');
  App.dr('bake.start', { owner: 'auto', tier: viewport ? 'fine' : 'base', path: snapshotMode ? 'snapshot' : 'leaf',
    leaf: leaves.length, tops: (items || []).length, f: Number(viewport && viewport._f) || 0 });
  const alive = typeof shouldContinue === 'function' ? shouldContinue : function () { return true; };
  const mats = new Array(leaves.length);
  const frames = new Array(leaves.length);
  const useKeys = new Array(leaves.length);
  const unitLong = new Array(leaves.length);
  const useMax = new Map();
  App.autoStatic._run = { leaf: leaves.length, src: 0, srcDone: 0, dec: 0, decDone: 0 };
  const ink = { drawn: 0, alpha: 0, px: 0 };
  const keep = viewport ? new Array(leaves.length) : null;
  const bxKeep = viewport ? viewport.x : 0;
  const byKeep = viewport ? viewport.y : 0;
  const bwKeep = viewport ? viewport.w : 0;
  const bhKeep = viewport ? viewport.h : 0;
  let culled = 0;
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  const BUDGET = 8, MIN_CHUNK = 8;
  const coveredByBase = !!(App.autoStatic.base &&
    App.autoStaticBaseUsable && App.autoStaticBaseUsable());
  const urgent = !App.autoStatic.active && !coveredByBase;
  if (urgent) App._bakeUrgent = (App._bakeUrgent || 0) + 1;
  const noteEmptyBake = function (why) {
    try {
      App.autoStatic._emptyAt = performance.now();
      App.autoStatic._emptySig = App.autoStaticViewSig();
      App.autoStatic._emptyRev = App.contentRevision || 0;
      App.autoStatic._emptyWhy = why;
    } catch (e) {   }
  };
  const p = new Promise(function (resolve) {
    let settled = false;
    const finishResult = function (value) {
      if (settled) return;
      settled = true;
      App.drb(value ? 'bake.ok.auto' : 'bake.fail.auto');
      App.dr('bake.end', {
        owner: 'auto', tier: viewport ? 'fine' : 'base', path: snapshotMode ? 'snapshot' : 'leaf',
        ok: !!value, dur: Math.round(performance.now() - bakeT0), leaf: leaves.length, culled: culled,
        w: value ? value.w : 0, h: value ? value.h : 0, f: value ? Number(value.f) || 0 : 0,
        why: value ? 'ok' : (App.autoStatic && App.autoStatic._emptyWhy) || 'no-result'
      });
      resolve(value);
    };
    let mi = 0;
    let i = 0;
    let fi = 0;
    const SINGLE_PASS = leaves.length <= 12000;
    const matrixStep = function () {
      if (!alive()) { finishResult(null); return; }
      if (App.bakeDeferBusy()) { if (App.noteBakeProgress) App.noteBakeProgress(); setTimeout(matrixStep, 60); return; }
      App.autoStatic._stage = 'matrix';
      const t0 = performance.now();
      let n = 0;
      while (mi < leaves.length && (SINGLE_PASS || n < MIN_CHUNK || performance.now() - t0 < BUDGET)) {
        mats[mi] = leafMat(leaves[mi]);
        mi++; n++;
      }
      if (App.autoStatic._run) {
        App.autoStatic._run.mc = (App.autoStatic._run.mc || 0) + 1;
        App.autoStatic._run.mi = mi;
        App.autoStatic._run.mdur = Math.round(performance.now() - t0);
        App.autoStatic._run.mgap = Math.round(performance.now() - (App.autoStatic._run.mlast || t0));
        App.autoStatic._run.mlast = performance.now();
      }
      if (App.noteBakeProgress) App.noteBakeProgress();
      if (mi < leaves.length) { setTimeout(matrixStep, 0); return; }
      frameStep();
    };
    const frameStep = function () {
      if (!alive()) { finishResult(null); return; }
      if (snapshotMode) { fi = leaves.length; bboxStep(); return; }
      if (App.bakeDeferBusy()) { if (App.noteBakeProgress) App.noteBakeProgress(); setTimeout(frameStep, 60); return; }
      App.autoStatic._stage = 'frame';
      const t0 = performance.now();
      let n = 0;
      while (fi < leaves.length && (SINGLE_PASS || n < MIN_CHUNK || performance.now() - t0 < BUDGET)) {
        const nd = App.bakeNodeOf(leaves[fi], mats[fi]);
        frames[fi] = nd.frame;
        if (nd.mat && nd.mat !== mats[fi]) mats[fi] = nd.mat;
        useKeys[fi] = nd.useKey || null;
        const unit = nd.frame ? Math.max(nd.frame.w, nd.frame.h) * App.bakeMatScale(mats[fi]) : 0;
        unitLong[fi] = unit;
        if (nd.useKey && unit > 0) useMax.set(nd.useKey, Math.max(useMax.get(nd.useKey) || 0, unit));
        fi++; n++;
      }
      if (App.autoStatic._run) {
        App.autoStatic._run.fdur = Math.round(performance.now() - t0);
        App.autoStatic._run.fi = fi;
      }
      if (App.noteBakeProgress) App.noteBakeProgress();
      if (fi < leaves.length) { setTimeout(frameStep, 0); return; }
      bboxStep();
    };
    const bboxStep = function () {
      if (!alive()) { finishResult(null); return; }
      if (App.bakeDeferBusy()) { if (App.noteBakeProgress) App.noteBakeProgress(); setTimeout(bboxStep, 60); return; }
      App.autoStatic._stage = 'bbox';
      const t0 = performance.now();
      let n = 0;
      if (snapshotMode) {
        i = leaves.length;
        if (viewport) {
          minx = viewport.x; miny = viewport.y;
          maxx = viewport.x + viewport.w; maxy = viewport.y + viewport.h;
        } else {
          const bb = App.bakeContentBBox();
          if (bb && bb.width > 0 && bb.height > 0) {
            const pd = Math.max(1, 0.02 * Math.max(bb.width, bb.height));
            minx = bb.x - pd; miny = bb.y - pd;
            maxx = bb.x + bb.width + pd; maxy = bb.y + bb.height + pd;
          }
        }
      }
      while (i < leaves.length && (SINGLE_PASS || n < MIN_CHUNK || performance.now() - t0 < BUDGET)) {
        const fr = frames[i];
        const hw = (leaves[i].w || 0) / 2, hh = (leaves[i].h || 0) / 2;
        const cs = fr
          ? [[fr.x, fr.y], [fr.x + fr.w, fr.y], [fr.x + fr.w, fr.y + fr.h], [fr.x, fr.y + fr.h]]
          : [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
        let lminx = Infinity, lminy = Infinity, lmaxx = -Infinity, lmaxy = -Infinity;
        cs.forEach(function (p) {
          const r = new DOMPoint(p[0], p[1]).matrixTransform(mats[i]);
          minx = Math.min(minx, r.x); maxx = Math.max(maxx, r.x);
          miny = Math.min(miny, r.y); maxy = Math.max(maxy, r.y);
          if (r.x < lminx) lminx = r.x;
          if (r.x > lmaxx) lmaxx = r.x;
          if (r.y < lminy) lminy = r.y;
          if (r.y > lmaxy) lmaxy = r.y;
        });
        if (keep) {
          keep[i] = (lmaxx + 1 >= bxKeep && lminx - 1 <= bxKeep + bwKeep &&
                     lmaxy + 1 >= byKeep && lminy - 1 <= byKeep + bhKeep);
          if (!keep[i]) culled++;
        }
        i++; n++;
      }
      if (App.noteBakeProgress) App.noteBakeProgress();
      if (i < leaves.length) { setTimeout(bboxStep, 0); return; }
      if (!isFinite(minx)) { finishResult(null); return; }
      if (keep && leaves.length && culled >= leaves.length) {
        console.warn('[bake] 自动静态：全部叶子被视口裁掉，放弃本轮位图（保留矢量）', {
          leaves: leaves.length, culled: culled,
          viewport: { x: Math.round(bxKeep), y: Math.round(byKeep), w: Math.round(bwKeep), h: Math.round(bhKeep) }
        });
        noteEmptyBake('all-culled');
        finishResult(null);
        return;
      }
      const bx = viewport ? viewport.x : minx;
      const by = viewport ? viewport.y : miny;
      const bw = viewport ? viewport.w : Math.max(1, maxx - minx);
      const bh = viewport ? viewport.h : Math.max(1, maxy - miny);
      let f;
      if (viewport) {
        const dpr2 = window.devicePixelRatio || 1;
        const fGiven = Number(viewport._f);
        f = (fGiven > 0) ? fGiven : Math.min((App.state.view.scale || 1) * dpr2, 4096 / Math.max(bw, bh));
      } else {
        const sc = App.state.view.scale || 1;
        const dpr2 = window.devicePixelRatio || 1;
        f = Math.min(1, Math.min(Math.max(1024, Math.ceil(Math.max(bw, bh) * sc * dpr2)), 4096) / Math.max(bw, bh));
      }
      const cw = Math.max(1, Math.round(bw * f)), ch = Math.max(1, Math.round(bh * f));
      const cv = App.takeBakeCanvas(cw, ch);
      const cx = cv.getContext('2d');
      const srcSize = App.bakeSourceSize(leaves, f);
      const sizes = new Array(leaves.length);
      for (let k = 0; k < leaves.length; k++) {
        const l = leaves[k];
        if (l.kind === 'import' && frames[k]) {
          const unit = useKeys[k] ? (useMax.get(useKeys[k]) || unitLong[k]) : unitLong[k];
          sizes[k] = Math.max(16, Math.min(512, App.bakeVecRasterSnap(unit * f)));
        } else {
          sizes[k] = srcSize;
        }
      }
      if (App.renderPerfCounters) App.renderPerfCounters.autoBakeCulled = culled;

      const finishFromCanvas = function (failedTop) {
        if (!alive()) { App.releaseBakeCanvas(cv); finishResult(null); return; }
        const afterInk = function (ok) {
          if (!alive()) {
            App.autoStatic._finishing = 0;
            App.releaseBakeCanvas(cv);
            finishResult(null);
            return;
          }
          if (!ok) {
            App.autoStatic._finishing = 0;
            console.warn('[bake] 自动静态：位图为空，放弃本轮位图（保留矢量）', { leaves: leaves.length });
            App.releaseBakeCanvas(cv);
            noteEmptyBake('no-ink');
            finishResult(null);
            return;
          }
          const finish = function (url) {
            App.autoStatic._finishing = 0;
            if (!alive()) {
              if (url && url.indexOf('blob:') === 0) { try { URL.revokeObjectURL(url); } catch (e) {   } }
              App.releaseBakeCanvas(cv);    
              finishResult(null);
              return;
            }
            const bit = { url: url, x: bx, y: by, w: bw, h: bh, f: f, failedTop: failedTop,
              snapshot: snapshotMode, flashUrls: null };
            if (skipFlash || leaves.length <= 400 || !url) { App.releaseBakeCanvas(cv); finishResult(bit); return; }
            App.autoStatic._stage = 'flash';
            App.buildAutoStaticFlashUrls(cv, alive).then(function (urls) {
              if (!alive()) {
                if (url && url.indexOf('blob:') === 0) { try { URL.revokeObjectURL(url); } catch (e) {   } }
                if (urls) App.revokeAutoStaticFlashUrls(urls);
                App.releaseBakeCanvas(cv);
                finishResult(null);
                return;
              }
              bit.flashUrls = urls;
              App.releaseBakeCanvas(cv);      
              finishResult(bit);
            });
          };
          App.autoStatic._stage = 'encode';
          if (cv.toBlob) {
            cv.toBlob(function (blob) {
              if (!blob) { finish(cv.toDataURL()); return; }
              try { finish(URL.createObjectURL(blob)); }
              catch (e) { console.warn('[bake] 静态图 URL 创建失败', String(e && e.message || e).slice(0, 120)); finish(''); }
            }, 'image/png');
          } else { finish(cv.toDataURL()); }
        };
        if (App.bakeInkUseAccumulator) { afterInk(App.bakeInkFromAccumulator(ink, cv)); return; }
        App.autoStatic._finishing = performance.now();
        App.autoStatic._stage = 'ink';
        if (App.noteBakeProgress) App.noteBakeProgress();
        App.bakeCanvasHasInkAsync(cv).then(afterInk, function () { afterInk(false); });
      };

      if (snapshotMode) {
        App.autoStatic._stage = 'snapshot';
        App.bakeSnapshotInto(cx, vis, { x: bx, y: by, w: bw, h: bh }, f, alive, ink).then(function (ok) {
          if (!ok) { App.releaseBakeCanvas(cv); finishResult(null); return; }
          finishFromCanvas(new Set());
        });
        return;
      }

      App.autoStatic._stage = 'sources';
      App.resolveBakeLayerSources(leaves, srcSize, undefined, alive, {
        drawable: true, f: f, keep: keep, sizes: sizes, frames: frames, useKeys: useKeys
      }).then(function (urls) {
        if (!alive() || urls.length !== leaves.length) { finishResult(null); return; }
        const uniq = Array.from(new Set(urls.filter(function (u) { return typeof u === 'string' && u; })));
        App.autoStatic._stage = 'decode';
        App.loadBakeImages(uniq, '[bake] 自动静态图源解码失败', alive).then(function (byUrl) {
          if (!alive()) { finishResult(null); return; }
          const images = urls.map(function (u) {
            if (!u) return null;
            return typeof u === 'string' ? (byUrl.get(u) || null) : u;
          });
          const tree = App.prepareBakeTree(vis, leaves, mats, frames);
          const ready = App.bakeDrawableItems(vis, tree, images);
          App.drawBakeTree(cx, ready.items, {
            tree: tree, images: images, mats: mats, frames: frames, f: f, ink: ink,
            rootRect: { x: bx, y: by, w: bw, h: bh }, shouldContinue: alive
          }).then(function (drawn) {
            if (!drawn) { finishResult(null); return; }
            finishFromCanvas(ready.failedTop);
          }).catch(function (e) { console.warn('[bake] 自动静态绘制失败', String(e && e.message || e).slice(0, 160)); finishResult(null); });
        }).catch(function (e) { console.warn('[bake] 自动静态图源加载失败', String(e && e.message || e).slice(0, 160)); finishResult(null); });
      }).catch(function (e) { console.warn('[bake] 自动静态取图失败', String(e && e.message || e).slice(0, 160)); finishResult(null); });
    };
    matrixStep();
  });
  if (!urgent) return p;
  const release = function () { App._bakeUrgent = Math.max(0, (App._bakeUrgent || 1) - 1); };
  return p.then(function (v) { release(); return v; }, function (e) { release(); throw e; });
};
App.autoStaticStructSig = function () {
  const L = App.state.layers || [];
  let s = String(L.length) + ':';
  for (let i = 0; i < L.length; i++) s += L[i].id + ',';
  return s;
};
App.autoStaticInstall = function (bit, token) {
  if (!bit || !bit.url) return Promise.resolve(false);
  App.autoStatic._emptyAt = 0;    
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
  const baseEl0 = App.autoStaticBaseEl;
  if (baseEl0 && baseEl0.parentNode === App.layersRoot) App.layersRoot.insertBefore(stage, baseEl0.nextSibling || null);
  else App.layersRoot.insertBefore(stage, App.layersRoot.firstChild);
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
        App.autoStatic.bit = bit;
        if (bit._view) {
          App.autoStatic.view = bit._view;
          delete bit._view;
        }
        App.autoStatic.active = true;
        App.autoStatic.vectorKeep = null;
        App.autoStaticApplyHiding();
        if (!App.autoStatic.base && (!App.wantOverviewBitmap || App.wantOverviewBitmap())) App.autoStaticBaseSchedule(1800);
        if (App.refreshLayerThumbs) {
          setTimeout(function () { try { App.refreshLayerThumbs(); } catch (e) {   } }, 80);
        }
        if (oldUrl && oldUrl !== bit.url) setTimeout(function () { try { URL.revokeObjectURL(oldUrl); } catch (e) { console.warn('[bake] 回收旧位图失败', String(e && e.message || e).slice(0, 120)); } }, 0);
        const vpNow = App.autoStatic.view && App.autoStatic.view.rect;
        const covers = !!(vpNow && bit.x <= vpNow.x + 1 && bit.y <= vpNow.y + 1 &&
          bit.x + bit.w >= vpNow.x + vpNow.w - 1 && bit.y + bit.h >= vpNow.y + vpNow.h - 1);
        App.drb('bake.install.auto');
        App.dr('bake.install', {
          owner: 'auto', tier: 'fine', bit: (App.autoStatic.bitCount = (App.autoStatic.bitCount || 0) + 1),
          priorBit: oldEl ? 1 : 0, gen: Number(bit._gen) || (App.viewRevision || 0),
          w: Number(bit.w) || 0, h: Number(bit.h) || 0, f: Number(bit.f) || 0,
          hidden: (App.autoStatic.hiding || []).length, slot: App.autoStatic._hidePrefix === undefined ? -2 : App.autoStatic._hidePrefix,
          mode: App.autoStatic._hideMode || '-', culled: 0,
          coversCell: covers ? 'true' : 'false'
        });
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
App.autoStaticKeepOld = function () {
  const v = (App.autoStatic && App.autoStatic.active) ? App.autoStatic.view : null;
  if (!v) return false;
  const need = App.autoStaticCoverNeed(0);
  const covered = App.autoStaticRectCovers(v, need);
  if (covered) return true;
  try {
    const c = App.autoStaticContentBBoxCached();
    if (c) {
      const cr = { x: c.minx, y: c.miny, w: c.maxx - c.minx, h: c.maxy - c.miny };
      if (App.autoStaticRectCovers(v, cr)) return true;
    }
  } catch (e) {   }
  if (App.renderPointerActive) return true;
  return !!(App.renderInteractionBusy && App.renderInteractionBusy());
};
App.autoStaticRectStillUseful = function (rect) {
  if (!rect) return true;
  const need = App.autoStaticCoverNeed(0);
  const covered = App.autoStaticRectCovers(rect, need);
  if (!covered) return false;
  const f = Number(rect._f) || 0;
  const needF = App.autoStaticNeedF();
  return !(f > 0 && f < needF * (App.autoStaticResTol || 0.65));
};
App.autoStaticRebake = function () {
  if (App.staticOverlayBusy && App.staticOverlayBusy()) return;
  const quietLeft = (App._autoStaticQuietUntil || 0) - performance.now();
  if (quietLeft > 0) { App.autoStaticSchedule(Math.min(900, quietLeft)); return; }
  if (App.autoStatic._emptyAt && performance.now() - App.autoStatic._emptyAt < 5000) {
    const sameSig = App.autoStatic._emptySig === App.autoStaticViewSig();
    const sameRev = App.autoStatic._emptyRev === (App.contentRevision || 0);
    if (sameSig && sameRev) return;
  }
  if (App.autoStatic.baking) return;
  if (App.autoStatic.baseBaking) { App.autoStaticSchedule(120); return; }
  if (!App.autoStatic.active && !App.autoStatic.base &&
      (!App.wantOverviewBitmap || App.wantOverviewBitmap())) {
    App.autoStaticBaseSchedule(0);
    return;
  }
  if (App._autoStaticBaseTimer) { clearTimeout(App._autoStaticBaseTimer); App._autoStaticBaseTimer = null; }
  App.autoStaticBaseToken = (App.autoStaticBaseToken || 0) + 1;
  if (App.autoStaticDeferStart()) { App.autoStaticSchedule(120); return; }
  if (!App.autoStaticEligible()) { App.autoStaticRelease('ineligible'); return; }
  const needF = App.autoStaticNeedF();
  let rect = App.autoStaticViewportRect(0.5);
  let rectPad = 0.5;
  let f = App.autoStaticRectF(rect);
  if (f < needF * (App.autoStaticResTol || 0.65)) {
    const rect2 = App.autoStaticViewportRect(0);
    const f2 = App.autoStaticRectF(rect2);
    if (f2 > f) { rect = rect2; rectPad = 0; f = f2; }
  }
  rect._f = f;
  rect._pad = rectPad;
  App.autoStatic.lastErr = null;
  App.autoStatic.baking = true;
  const token = ++App.autoStatic.token;
  App.autoStatic.bakingToken = token;       
  App.autoStatic.bakingSince = performance.now();
  App.autoStatic._progressAt = performance.now();    
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
  let lastGeomAt = 0;
  const shouldContinue = function () {
    const currentDocId = App.Tabs && App.Tabs.current ? App.Tabs.current.id : null;
    if (token !== App.autoStatic.token || contentRevision !== (App.contentRevision || 0) ||
        currentDocId !== docId) return false;
    const now = performance.now();
    if (now - lastGeomAt > 60) {
      lastGeomAt = now;
      if (structSig !== App.autoStaticStructSig()) return false;
      if (!App.autoStaticRectStillUseful(rect)) return false;
    }
    return true;
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
      if (App.autoStatic.baking && App.autoStatic.bakingToken === token) {
        App.autoStatic.baking = false;
        App.autoStatic.bakingToken = 0;
        if (App.autoStaticSchedule) App.autoStaticSchedule(0);    
      }
      if (token !== App.autoStatic.token) return;
      App.autoStatic.baking = false;
      App.autoStatic.lastErr = why;
      App.renderPerfCounters.autoBakeCancels++;
      App.traceRenderTask('autoStatic', 'cancel', {
        docId: docId, contentRevision: contentRevision, viewRevision: viewRevision,
        generation: token, reason: why
      });
      try {
        const ko = App.autoStaticKeepOld ? !!App.autoStaticKeepOld() : false;
        const ks = App.autoStaticKeepStale ? !!App.autoStaticKeepStale() : false;
        const av = App.autoStatic && App.autoStatic.view;
        const need = App.autoStaticCoverNeed ? App.autoStaticCoverNeed(0) : null;
        App.dr('drop.check', {
          why: why, keep: releaseCurrent ? 1 : 0, keepOld: ko ? 1 : 0, keepStale: ks ? 1 : 0,
          active: App.autoStatic && App.autoStatic.active ? 1 : 0,
          w: av ? Math.round(av.w) : 0, h: av ? Math.round(av.h) : 0,
          x: need ? Math.round(need.x) : 0, y: need ? Math.round(need.y) : 0,
          nw: need ? Math.round(need.w) : 0, nh: need ? Math.round(need.h) : 0
        });
      } catch (e) {   }
      const keepBase = (why === 'bake-aborted' || why === 'stale-cover' || why === 'stale-quality' || why === 'superseded');
      if (releaseCurrent && App.autoStatic.active) App.autoStaticRelease(why, keepBase);
    };
    if (token !== App.autoStatic.token) { drop('superseded', false); return; }
    if (!bit) {
      drop('bake-aborted', !(App.autoStaticKeepOld() || App.autoStaticKeepStale()));
      if (App.autoStaticEligible && App.autoStaticEligible()) App.autoStaticSchedule(80);
      return;
    }
    const install = function () {
      if (token !== App.autoStatic.token) { drop('superseded', false); return; }
      if (App.autoStaticDeferStart()) { if (App.noteBakeProgress) App.noteBakeProgress(); setTimeout(install, 60); return; }
      if (contentRevision !== (App.contentRevision || 0)) { drop('stale-content', true); App.autoStaticSchedule(); return; }
      if (structSig !== App.autoStaticStructSig()) { drop('stale-struct', true); App.autoStaticSchedule(); return; }
      if (!App.autoStaticEligible()) { drop('stale-ineligible', true); return; }
      const want = App.autoStaticCoverNeed(0);
      const covered = App.autoStaticRectCovers(rect, want);
      if (!covered) {
        drop('stale-cover', !(App.autoStaticKeepOld() || App.autoStaticKeepStale()));
        App.autoStaticSchedule();
        return;
      }
      if (!(bit.f > 0) || bit.f < App.autoStaticNeedF() * (App.autoStaticResTol || 0.65)) {
        drop('stale-quality', !(App.autoStaticKeepOld() || App.autoStaticKeepStale()));
        App.autoStaticSchedule(80);
        return;
      }
      if (typeof bit.f === 'number' && bit.f > 0) rect._f = bit.f;
      if (Math.abs(bit.x - rect.x) > 0.01 || Math.abs(bit.y - rect.y) > 0.01 ||
          Math.abs(bit.w - rect.w) > 0.01 || Math.abs(bit.h - rect.h) > 0.01) {
        console.warn('[bake] 位图矩形与烘焙矩形不一致，已按烘焙矩形纠正', {
          bit: { x: bit.x, y: bit.y, w: bit.w, h: bit.h },
          rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h }
        });
        bit.x = rect.x; bit.y = rect.y; bit.w = rect.w; bit.h = rect.h;
      }
      bit._view = rect;
      App.autoStaticInstall(bit, token).then(function (installed) {
        App.autoStatic._finishing = 0;
        if (!installed) { drop('stage-failed', false); return; }
        if (token === App.autoStatic.token) {
          App.autoStatic.contentRevision = contentRevision;
          App.autoStatic.colorRev = App._colorRev || 0;
          App.autoStatic.baking = false;
          App.renderPerfCounters.autoBakeInstalls++;
          App.traceRenderTask('autoStatic', 'install', {
            docId: docId, contentRevision: contentRevision, viewRevision: viewRevision,
            generation: token, f: bit.f, failedTop: bit.failedTop ? bit.failedTop.size : 0
          });
        }
      }).catch(function (e) {
        App.autoStatic._finishing = 0;
        console.warn('[bake] 自动静态位图切换失败', String(e && e.message || e).slice(0, 160));
        drop('stage-throw', false);
      });
    };
    App.autoStatic._stage = 'install';
    App.autoStatic._finishing = performance.now();    
    const preload = [loadImage(bit.url)];
    if (bit.flashUrls) {
      preload.push(loadImage(bit.flashUrls.yellow));
      preload.push(loadImage(bit.flashUrls.blue));
    }
    Promise.all(preload).then(function (imgs) {
      if (imgs && imgs[0]) bit._img = imgs[0];
      install();
    }).catch(function (e) {
      App.autoStatic._finishing = 0;
      console.warn('[bake] 自动静态位图预解码失败', String(e && e.message || e).slice(0, 160));
      drop('decode-failed', true);
    });
  }).catch(function (e) { App.autoStatic.baking = false; App.autoStatic._finishing = 0; App.autoStatic.lastErr = 'bake-throw: ' + String(e && e.message || e).slice(0, 120); });
};

App.autoStaticSchedule = function (delay) {
  if (App._autoStaticTimer) clearTimeout(App._autoStaticTimer);
  App._autoStaticTimer = setTimeout(function () {
    App._autoStaticTimer = null;
    if (App.autoStaticDeferStart()) { App.autoStaticSchedule(120); return; }
    App.autoStaticRebake();
  }, typeof delay === 'number' ? delay
     : 280);
};
App.logBakeStatus = function (force) {
  const now = performance.now();
  if (!force && now - (App._bakeLogAt || 0) < 10000) return;
  App._bakeLogAt = now;
  const st = App.autoStatic || {};
  const rc = App.renderPerfCounters || {};
  try {
    App.log('perf', '烘焙状态', {
      active: !!st.active, baking: !!st.baking,
      stage: st._stage || '',
      run: st._run ? { leaf: st._run.leaf, src: [st._run.srcDone, st._run.src], dec: [st._run.decDone, st._run.dec] } : null,
      age: st.bakingSince ? Math.round(now - st.bakingSince) : 0,
      idle: st._progressAt ? Math.round(now - st._progressAt) : -1,
      starts: rc.autoBakeStarts || 0, installs: rc.autoBakeInstalls || 0,
      cancels: rc.autoBakeCancels || 0, culled: rc.autoBakeCulled || 0,
      err: st.lastErr || null,
      f: (st.view && st.view._f) ? Math.round(st.view._f * 100) / 100 : 0,
      rasterN: App._bakeVecRaster ? App._bakeVecRaster.size : -1,
      rasterPx: App._bakeVecRasterPx || 0,
      svgCacheN: App._bakeSvgCache ? App._bakeSvgCache.size : -1,
      deferBusy: !!(App.bakeDeferBusy && App.bakeDeferBusy()),
      interaction: !!(App.renderInteractionBusy && App.renderInteractionBusy()),
      base: !!st.base, baseBaking: !!st.baseBaking,
      baseUsable: !!(App.autoStaticBaseUsable && App.autoStaticBaseUsable()),
      baseRev: st.base ? st.base.contentRev : null,
      baseColorRev: st.base ? st.base.colorRev : null,
      baseF: st.base && st.base.bit ? Math.round((st.base.bit.f || 0) * 100) / 100 : 0,
      baseRect: st.base && st.base.rect ? [Math.round(st.base.rect.x), Math.round(st.base.rect.y), Math.round(st.base.rect.w), Math.round(st.base.rect.h)] : null,
      hideMode: st._hideMode || '', hidePrefix: st._hidePrefix === undefined ? null : st._hidePrefix,
      baseAll: !!(st._hideMode === 'all' || st._hideMode === 'viewport'),
      hidden: (st.hiding || []).length,
      wantOverview: !!(App.wantOverviewBitmap && App.wantOverviewBitmap()),
      overlay: !!(App.staticOverlayBusy && App.staticOverlayBusy()),
      overlaySrc: (App.staticOverlay && App.staticOverlay.drawn) ? App.staticOverlay.drawn.length : 0,
      quiet: Math.max(0, Math.round((App._autoStaticQuietUntil || 0) - now)),
      leaves: App.autoStaticLeafCount ? App.autoStaticLeafCount() : -1,
      visibleScans: rc.autoVisibleScans || 0,
      scanLeaves: rc.autoVisibleLeaves || 0
    });
  } catch (e) {   }
};
App.autoStaticMaybe = function () {
  if (!App.autoStaticEnabled) return;
  if (App.staticOverlayBusy && App.staticOverlayBusy()) return;
  App.autoStaticSelfHeal();
  if (App.autoStaticBaseEl && App.autoStaticBaseEl.style.display === 'none') {
    App.autoStaticBaseEl.style.display = '';
  }
  const baseUsable = !!(App.autoStatic.base && App.autoStaticBaseUsable && App.autoStaticBaseUsable());
  if ((!App.autoStatic.base || !baseUsable) && !App.autoStatic.baseBaking && !App.autoStatic.baking &&
      (!App.wantOverviewBitmap || App.wantOverviewBitmap())) {
    const urgentBase = !App.autoStatic.active || !App.autoStatic.bit || !baseUsable;
    App.autoStaticBaseSchedule(urgentBase ? 0 : 1800);
  }
  try {
    const b = App.autoStatic.base;
    const sig = [!!App.autoStatic.active, !!App.autoStatic.baking, !!App.autoStatic.baseBaking,
      !!b, b ? b.contentRev : -1, b ? b.colorRev : -1,
      !!(App.autoStaticBaseUsable && App.autoStaticBaseUsable()),
      (App.autoStatic.hiding || []).length, App.autoStatic._hideMode || '',
      Math.round((App.state.view.scale || 1) * 10) / 10].join('|');
    if (sig !== App._baseStateSig) {
      App._baseStateSig = sig;
      App.log('perf', '粗图状态', {
        active: !!App.autoStatic.active, baking: !!App.autoStatic.baking,
        baseBaking: !!App.autoStatic.baseBaking, base: !!b,
        baseUsable: !!(App.autoStaticBaseUsable && App.autoStaticBaseUsable()),
        baseRev: b ? b.contentRev : null, colorRev: b ? b.colorRev : null,
        hidden: (App.autoStatic.hiding || []).length, mode: App.autoStatic._hideMode || '',
        scale: Math.round((App.state.view.scale || 1) * 100) / 100,
        tops: (App.state.layers || []).length
      });
    }
  } catch (e) {   }
  if (App.autoStatic.active && App.autoStatic.bit && App.autoStatic.view) {
    const vpRaw = App.autoStaticViewportRaw(0);
    const br = App.autoStatic.view;
    const covered = br.x <= vpRaw.x + 0.5 && br.y <= vpRaw.y + 0.5 &&
      br.x + br.w >= vpRaw.x + vpRaw.w - 0.5 && br.y + br.h >= vpRaw.y + vpRaw.h - 0.5;
    if (!covered) {
      if (!App.autoStatic._coverLost) {
        App.autoStatic._coverLost = true;
        App.autoStaticApplyHiding();
      }
    } else App.autoStatic._coverLost = false;
  }
  App.logBakeStatus();
  if (App.autoStatic.baking && !App._bakeStatusTimer) {
    App._bakeStatusTimer = setTimeout(function () {
      App._bakeStatusTimer = null;
      App.logBakeStatus(true);
      if (App.autoStaticMaybe) App.autoStaticMaybe();
    }, 10000);
  }
  if (App.autoStatic.baking) {
    const last = App.autoStatic._progressAt || App.autoStatic.bakingSince;
    const finishing = Number(App.autoStatic._finishing) || 0;
    const finishingWarm = finishing && (performance.now() - finishing < 120000);
    if (last && !finishingWarm && performance.now() - last > 45000) {
      try {
        const st = App.autoStatic;
        App.log('perf', '烘焙复位(45s无进度)', {
          age: st.bakingSince ? Math.round(performance.now() - st.bakingSince) : 0,
          idle: st._progressAt ? Math.round(performance.now() - st._progressAt) : -1,
          defer: !!(App.bakeDeferBusy && App.bakeDeferBusy()),
          inter: !!(App.renderInteractionBusy && App.renderInteractionBusy()),
          active: !!st.active,
          stage: st._stage || '',
          starts: App.renderPerfCounters.autoBakeStarts,
          installs: App.renderPerfCounters.autoBakeInstalls
        });
      } catch (e) {   }
      console.warn('[bake] baking 45s 无进度，强制复位', 'idle=' + Math.round(performance.now() - (App.autoStatic._progressAt || last)) +
        ' defer=' + (App.bakeDeferBusy ? App.bakeDeferBusy() : '?') + ' inter=' + (App.renderInteractionBusy ? App.renderInteractionBusy() : '?') + ' stage=' + (App.autoStatic._stage || ''));
      App.autoStatic.baking = false;
      App.autoStatic.bakingToken = 0;
      App.autoStatic.bakingSince = 0;
      App.autoStatic._progressAt = 0;
    }
  }
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
    if (!App.autoStaticEligible()) { App.autoStaticRelease('ineligible'); return; }
    return;
  }
  if (!App.autoStaticEligible()) { if (App.autoStatic.active) App.autoStaticRelease(); return; }
  if (!App.autoStatic.active || !App.autoStatic.view) { App.autoStaticRebake(); return; }
  if (App.autoStatic.colorRev !== (App._colorRev || 0)) {
    App.autoStaticDropBase('color');
    App.autoStaticSchedule(0);
    return;
  }
  const v = App.autoStatic.view;
  const pad = (v && v._pad !== undefined) ? v._pad : 0.5;
  const rect = App.autoStaticViewportRect(pad);
  const covered = v.x <= rect.x && v.y <= rect.y && (v.x + v.w) >= (rect.x + rect.w) && (v.y + v.h) >= (rect.y + rect.h);
  const enoughRes = !!(v._f && v._f >= App.autoStaticNeedF() * (App.autoStaticResTol || 0.65));
  const tooDense = !!(v._f && v._f > App.autoStaticNeedF() * 1.75);
  if (covered && enoughRes && !tooDense) return;
  if (covered && tooDense) { App.autoStaticSchedule(150); return; }
  if (!covered && App.autoStatic.active) {
    App.autoStaticSchedule(0);
    return;
  }
  App.autoStaticSchedule();
};

App.staticOverlayEnabled = true;
App.staticOverlay = { active: false, canvas: null, ctx: null, dpr: 1, v: null,
  cssW: 0, cssH: 0, sources: [], hidden: [], drawn: [], startedAt: 0, lastAt: 0, retry: 0,
  rootHidden: false, rootPrevDisplay: '' };
App._staticOverlayImgs = null;
App.staticOverlayBusy = function () {
  return !!(App.staticOverlay && App.staticOverlay.active);
};
App.staticOverlaySourceList = function () {
  const out = [];
  const a = App.autoStatic;
  if (!a) return out;
  const add = function (el, bit) {
    if (!el || !el.isConnected) return;
    if (el.style.display === 'none') return;
    const href = el.getAttribute('href');
    if (!href) return;
    const x = parseFloat(el.getAttribute('x')), y = parseFloat(el.getAttribute('y'));
    const w = parseFloat(el.getAttribute('width')), h = parseFloat(el.getAttribute('height'));
    if (!isFinite(x) || !isFinite(y) || !(w > 0) || !(h > 0)) return;
    out.push({ el: el, bit: bit || null, href: href, x: x, y: y, w: w, h: h, img: null });
  };
  add(App.autoStaticBaseEl, a.base ? a.base.bit : null);
  add(App.autoStaticBgEl, a.bit || null);
  return out;
};
App.staticOverlayImage = function (src) {
  if (!src) return null;
  if (src.img && src.img.complete && src.img.naturalWidth) return src.img;
  const bit = src.bit;
  if (bit && bit._img && bit._img.complete && bit._img.naturalWidth) {
    src.img = bit._img;
    return src.img;
  }
  const cache = App._staticOverlayImgs || (App._staticOverlayImgs = new Map());
  let im = cache.get(src.href);
  if (im && im.complete && im.naturalWidth) { src.img = im; return im; }
  if (!im) {
    im = new Image();
    im.decoding = 'async';
    cache.set(src.href, im);
    while (cache.size > 3) {
      const first = cache.keys().next();
      if (first.done || first.value === src.href) break;
      cache.delete(first.value);
    }
    im.onload = function () {
      src.img = im;
      if (bit) bit._img = im;
      if (App.staticOverlayBusy()) {
        try { App.staticOverlayDraw(); } catch (e) { App.staticOverlayEnd('draw-fail'); }
      }
    };
    im.onerror = function () {
      console.warn('[overlay] 位图解码失败', String(src.href).slice(0, 64));
    };
    im.src = src.href;
    return null;
  }
  return null;
};
App.staticOverlayDrawBg = function (ctx) {
  const m = App.state && App.state.bg ? App.state.bg.image : null;
  if (!m || !m.imgEl || App.state.bg.hidden) return false;
  if (App.state.eyeMode === 'bg') return false;
  if (!App.bgG || App.bgG.style.display === 'none') return false;
  ctx.save();
  ctx.globalAlpha = (typeof m.opacity === 'number') ? m.opacity : 1;
  ctx.translate(m.x || 0, m.y || 0);
  ctx.rotate((m.rot || 0) * Math.PI / 180);
  const sk = function () { ctx.transform(1, 0, Math.tan((m.skew || 0) * Math.PI / 180), 1, 0, 0); };
  const sc = function () { ctx.scale((m.sx || 1) * (m.flipH ? -1 : 1), (m.sy || 1) * (m.flipV ? -1 : 1)); };
  if (App.skewMode === '132') { sc(); sk(); } else { sk(); sc(); }
  ctx.drawImage(m.imgEl, -(m.w || 0) / 2, -(m.h || 0) / 2, m.w || 0, m.h || 0);
  ctx.restore();
  return true;
};
App.staticOverlayHideEl = function (el) {
  const st = App.staticOverlay;
  if (!el || !st) return;
  for (let i = 0; i < st.hidden.length; i++) if (st.hidden[i].el === el) return;
  st.hidden.push({ el: el, visibility: el.style.visibility || '' });
  el.style.visibility = 'hidden';
};
App.staticOverlayDraw = function () {
  const st = App.staticOverlay;
  if (!st || !st.active || !st.ctx || !st.canvas || !st.v) return;
  const ctx = st.ctx, cv = st.canvas, v = st.v, dpr = st.dpr || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.setTransform(v.scale * dpr, 0, 0, v.scale * dpr, -v.x * v.scale * dpr, -v.y * v.scale * dpr);
  if (App.staticOverlayDrawBg(ctx) && App.bgG) App.staticOverlayHideEl(App.bgG);
  let fineSrc = null;
  for (let i = 0; i < st.sources.length; i++) {
    if (st.sources[i].el === App.autoStaticBgEl) { fineSrc = st.sources[i]; break; }
  }
  const drawn = [];
  for (let i = 0; i < st.sources.length; i++) {
    const s = st.sources[i];
    const img = App.staticOverlayImage(s);
    if (!img) continue;
    const clipBase = !!(s.el === App.autoStaticBaseEl && fineSrc && fineSrc.el !== s.el);
    if (clipBase) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(v.x, v.y, (st.cssW || 0) / v.scale, (st.cssH || 0) / v.scale);
      ctx.rect(fineSrc.x, fineSrc.y, fineSrc.w, fineSrc.h);
      ctx.clip('evenodd');
    }
    try { ctx.drawImage(img, s.x, s.y, s.w, s.h); } catch (e) {   }
    if (clipBase) ctx.restore();
    App.staticOverlayHideEl(s.el);
    drawn.push(s);
  }
  st.drawn = drawn;
  App.staticOverlayUpdate();
};
App.staticOverlayRetry = function () {
  const st = App.staticOverlay;
  if (!st || st.retry) return;
  st.retry = setTimeout(function () {
    st.retry = 0;
    if (App.staticOverlayBusy()) return;
    if (App.renderPointerActive || (App.renderInteractionBusy && App.renderInteractionBusy())) {
      App.staticOverlayStart('retry');
    }
  }, 40);
};
App.staticOverlayStart = function (reason) {
  if (!App.staticOverlayEnabled || !App.autoStaticEnabled) return false;
  const st = App.staticOverlay;
  if (!st) return false;
  if (App._staticOverlayEndTimer) {
    clearTimeout(App._staticOverlayEndTimer);
    App._staticOverlayEndTimer = 0;
  }
  if (st.active) { st.lastAt = performance.now(); return true; }
  if (!App.wrap || !App.svg || !App.layersRoot || !App.autoStatic) return false;
  if (App.state.eyeMode) return false;
  if (App.state.layersHidden || App.state.batching) return false;
  if (App.layersRoot.style.display === 'none') return false;
  const sources = App.staticOverlaySourceList();
  if (!sources.length) return false;
  for (let i = 0; i < sources.length; i++) {
    if (!App.staticOverlayImage(sources[i])) { App.staticOverlayRetry(); return false; }
  }
  const cv = document.getElementById('staticOverlay');
  if (!cv) return false;
  const r = App.wrap.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  const dpr = Math.min(window.devicePixelRatio || 1, 2, 4096 / Math.max(w, h));
  const pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
  if (cv.width !== pw) cv.width = pw;
  if (cv.height !== ph) cv.height = ph;
  cv.style.width = w + 'px';
  cv.style.height = h + 'px';
  const ctx = cv.getContext('2d');
  if (!ctx) return false;
  st.canvas = cv;
  st.ctx = ctx;
  st.dpr = dpr;
  st.cssW = w;
  st.cssH = h;
  st.v = { x: App.state.view.x, y: App.state.view.y, scale: App.state.view.scale || 1 };
  st.sources = sources;
  st.hidden = [];
  st.drawn = [];
  if (App.autoStaticAbortBake) App.autoStaticAbortBake(reason || 'gesture');
  st.active = true;
  st.startedAt = performance.now();
  st.lastAt = st.startedAt;
  cv.style.display = 'block';
  try { App.staticOverlayDraw(); } catch (e) { App.staticOverlayEnd('draw-fail'); return false; }
  try {
    const a = App.autoStatic;
    st.rootHidden = false;
    if (a && a._hideMode === 'all' && !(a.vectorKeep && a.vectorKeep.length)) {
      st.rootPrevDisplay = App.layersRoot.style.display || '';
      App.layersRoot.style.display = 'none';
      st.rootHidden = true;
    }
  } catch (e) {   }
  try {
    App.log('perf', '覆盖层开始', {
      why: String(reason || '').slice(0, 24), src: sources.length, fixed: st.drawn.length,
      scale: Math.round((st.v.scale || 1) * 100) / 100,
      ms: st.startedAt ? Math.round(performance.now() - st.startedAt) : 0
    });
  } catch (e) {   }
  return true;
};
App.staticOverlayUpdate = function () {
  const st = App.staticOverlay;
  if (!st || !st.active || !st.canvas || !st.v) return;
  const v = App.state.view || {};
  const b = st.v;
  const sc = v.scale || 1;
  const k = sc / (b.scale || 1);
  const tx = (b.x - (v.x || 0)) * sc;
  const ty = (b.y - (v.y || 0)) * sc;
  const tf = 'translate(' + tx + 'px,' + ty + 'px) scale(' + k + ')';
  if (st.canvas.style.transform !== tf) st.canvas.style.transform = tf;
};
App.staticOverlayEnd = function (reason) {
  const st = App.staticOverlay;
  if (!st || !st.active) return false;
  st.active = false;
  if (App._staticOverlayEndTimer) {
    clearTimeout(App._staticOverlayEndTimer);
    App._staticOverlayEndTimer = 0;
  }
  if (st.retry) { clearTimeout(st.retry); st.retry = 0; }
  const cv = st.canvas;
  if (cv) {
    cv.style.display = 'none';
    cv.style.transform = '';
  }
  if (st.rootHidden) {
    try {
      App.layersRoot.style.display = (App.state.layersHidden || App.state.eyeMode === 'bg')
        ? 'none' : (st.rootPrevDisplay || '');
    } catch (e) {   }
    st.rootHidden = false;
    st.rootPrevDisplay = '';
  }
  (st.hidden || []).forEach(function (h) {
    try { h.el.style.visibility = h.visibility || ''; } catch (e) {   }
  });
  st.hidden = [];
  st.sources = [];
  st.drawn = [];
  st.v = null;
  const why = String(reason || '');
  const refreshHiding = why === 'idle' || why === 'resize' || why === 'draw-fail';
  try {
    if (refreshHiding && App.autoStaticApplyHiding) App.autoStaticApplyHiding();
  } catch (e) {   }
  try {
    App.log('perf', '覆盖层结束', {
      why: String(reason || '').slice(0, 24),
      ms: st.startedAt ? Math.round(performance.now() - st.startedAt) : 0
    });
  } catch (e) {   }
  st.startedAt = 0;
  return true;
};

App.invalidateEditStatic = function () {
  if (App.editStatic && App.editStatic.active && App.endEditStatic) App.endEditStatic();
  App._autoStaticQuietUntil = 0;
  if (App.autoStaticRelease) App.autoStaticRelease();
  if (App.autoStaticMaybe) App.autoStaticMaybe();
};
App.contentChanged = function (options) {
  if (App.state.batching) return;    
  if (App.staticOverlayBusy && App.staticOverlayBusy() && App.staticOverlayEnd) {
    App.staticOverlayEnd('content');
  }
  App._autoStaticQuietUntil = 0;
  App.contentRevision = (App.contentRevision || 0) + 1;
  App._lodQueue = null;
  App._lodDirty = true;
  if (App._lodDrainTimer) { clearTimeout(App._lodDrainTimer); App._lodDrainTimer = null; }
  if (App.scheduleLodRefresh) App.scheduleLodRefresh();
  const preserveRequested = !options || options.preserveAutoStatic !== false;
  const preserve = !!(preserveRequested && App.autoStatic && App.autoStatic.active &&
    App.autoStaticEligible && App.autoStaticEligible() &&
    App.autoStaticBgEl && App.autoStaticBgEl.isConnected &&
    App.autoStaticBgEl.getAttribute('href') && App.autoStatic.view);
  if (preserve) {
    App._autoStaticSig = null;
    if (App.autoStatic.baking) { App.autoStatic.token++; App.autoStatic.baking = false; }
    const current = App.state.layers || [];
    const keepVec = new Set();
    const sel = App.state.selected;
    if (sel && typeof sel.forEach === 'function') {
      sel.forEach(function (id) {
        for (let k = 0; k < current.length; k++) {
          if (current[k] && current[k].id === id) { keepVec.add(current[k]); return; }
        }
      });
    }
    const prevHiding = new Set();
    (App.autoStatic.hiding || []).forEach(function (l) { if (l) prevHiding.add(l.id); });
    if (App.autoStatic.active && prevHiding.size > 0) {
      current.forEach(function (l) { if (l && !prevHiding.has(l.id)) keepVec.add(l); });
    }
    App.autoStatic.vectorKeep = Array.from(keepVec);
    App.autoStaticDropBase('content');
    App.autoStaticApplyHiding();
    if (App.autoStaticSchedule) App.autoStaticSchedule(110);
    else if (App.autoStaticRebake) App.autoStaticRebake();
  } else {
    if (App.autoStaticRelease) App.autoStaticRelease();
    if (App.autoStaticMaybe) App.autoStaticMaybe();
  }
  if (App.requestFlashRefresh) App.requestFlashRefresh(false);
};
App.editStaticCut = function (s, box, editItems) {
  if (!s.edit) return s.layers.length;
  for (let i = 0; i < s.layers.length; i++) {
    const l = s.layers[i];
    if (s.selected.has(l.id) || editItems.includes(l)) return i;
  }
  return s.layers.length;
};
App.editStaticHealthy = function () {
  const es = App.editStatic;
  if (!es) return false;
  if (es.bit && App.editStaticBgEl && App.editStaticBgEl.isConnected &&
      App.editStaticBgEl.getAttribute('href')) return true;
  if (es.base && App.editStaticBaseEl && App.editStaticBaseEl.isConnected &&
      App.editStaticBaseEl.getAttribute('href')) return true;
  if (es.baking) return true;
  if (es.items && es.items.length && es._bakedInterMin > 0) return true;
  return false;
};
App.rebakeEditStaticViewport = function (delay) {
  if (!App.editStatic || !App.editStatic.active) return;
  const d = (typeof delay === 'number' && delay >= 0) ? delay : 300;
  if (App._editStaticViewTimer) clearTimeout(App._editStaticViewTimer);
  App._editStaticViewTimer = setTimeout(function () {
    App._editStaticViewTimer = null;
    App.runEditStaticBake();
  }, d);
};
App.runEditStaticBake = function () {
  const es = App.editStatic;
  if (!es || !es.active) return;
  try {
    if (App.renderInteractionBusy && App.renderInteractionBusy()) { App.rebakeEditStaticViewport(); return; }
    let vp = App.editStaticViewportRect(0.5);
    let f = App.editStaticRectF(vp);
    const needF = App.editStaticNeedF();
    if (f < needF * 0.8) {
      const vp0 = App.editStaticViewportRect(0);
      const f0 = App.editStaticRectF(vp0);
      if (f0 > f) { vp = vp0; f = f0; }
    }
    vp._f = f;
    const s = App.state;
    const box = App.whiteBoxLayer ? App.whiteBoxLayer() : null;
    const editItems = (s.edit && App.editTargets) ? App.editTargets() : [];
    const interMin = App.editStaticCut(s, box, editItems);
    const itemSet = App.editStaticItemSet();
    const items = [];
    const matFn = App.bakeLeafMatFn();
    const noFrame = !!(App.docNeedsSnapshot && App.docNeedsSnapshot());
    for (let i = 0; i < interMin; i++) {
      const l = s.layers[i];
      if (!l || !itemSet.has(l)) continue;
      if (!noFrame && !App.bakeFrameDocIntersects(l, vp, matFn)) continue;
      items.push(l);
    }
    if (!items.length && interMin > 0) {
      return;
    }
    if (!items.length) {
      App.editStaticBumpToken();       
      es.bit = null;
      es.failedTop = null;
      App.editStaticDetachBg();
      try { s.layers.forEach(l => App.restoreEsVisibility(l)); } catch (e) {   }
      es.view = vp;
      es._bakedInterMin = interMin;
      return;
    }
    const docId = (App.Tabs && App.Tabs.current) ? App.Tabs.current.id : null;
    const contentRevision = App.contentRevision || 0;
    const colorRev = App._colorRev || 0;
    if (es.bit && es.view && es._bakedItems && f >= App.editStaticNeedF() * 0.8 &&
        es._bakedColorRev === (App._colorRev || 0) && es._bakedContentRev === contentRevision &&
        Math.abs(es.view.x - vp.x) < 1 && Math.abs(es.view.y - vp.y) < 1 &&
        Math.abs(es.view.w - vp.w) < 1 && Math.abs(es.view.h - vp.h) < 1 &&
        es._bakedItems.size === items.length &&
        items.every(function (l) { return es._bakedItems.has(l); })) {
      es._bakedInterMin = interMin;    
      return;
    }
    if (es.baking && es.bakingToken === App._editStaticToken &&
        performance.now() - (es.bakingSince || 0) < 4000) {
      App.rebakeEditStaticViewport(200);
      return;
    }
    const structSig = App.autoStaticStructSig();
    const token = ++App._editStaticToken;
    const t0 = performance.now();
    es.baking = true;
    es.bakingToken = token;
    es.bakingSince = t0;
    App.traceRenderTask('editStatic', 'start', {
      docId: docId, contentRevision: contentRevision, generation: token,
      f: f, n: items.length
    });
    const why = { reason: '' };
    let lastChk = 0;
    const shouldContinue = function () {
      if (!App.editStatic.active || token !== App._editStaticToken) { why.reason = why.reason || 'superseded'; return false; }
      const curDoc = (App.Tabs && App.Tabs.current) ? App.Tabs.current.id : null;
      if (curDoc !== docId) { why.reason = 'stale-doc'; return false; }
      if (contentRevision !== (App.contentRevision || 0)) { why.reason = 'stale-content'; return false; }
      const now = performance.now();
      if (now - lastChk > 80) {
        lastChk = now;
        if (structSig !== App.autoStaticStructSig()) { why.reason = 'stale-struct'; return false; }
        if (App.editStaticOverlap(vp, App.editStaticViewportRect(0)) < 0.25) { why.reason = 'stale-cover'; return false; }
      }
      return true;
    };
    const finishBake = function () {
      if (es.bakingToken === token) { es.baking = false; es.bakingToken = 0; es.bakingSince = 0; }
    };
    App.bakeEditStatic(items, vp, shouldContinue).then(function (bit) {
      const cancelled = function (reason, dropBg) {
        finishBake();
        if (bit) App.editStaticDropBit(bit);
        if (dropBg) App.editStaticClearBg();
        App.traceRenderTask('editStatic', 'cancel', {
          docId: docId, contentRevision: contentRevision, generation: token,
          reason: reason || why.reason || 'aborted', ms: Math.round(performance.now() - t0),
          run: es._run || null
        });
      };
      if (!bit) { cancelled(why.reason || 'bake-null', false); return; }
      if (!es.active || token !== App._editStaticToken) { cancelled('superseded', false); return; }
      if (contentRevision !== (App.contentRevision || 0)) { cancelled('stale-content', true); return; }
      if (structSig !== App.autoStaticStructSig()) { cancelled('stale-struct', true); return; }
      if (colorRev !== (App._colorRev || 0)) {
        cancelled('stale-color', false);
        App.rebakeEditStaticViewport();
        return;
      }
      const needNow = App.editStaticNeedF();
      if (!(bit.f > 0) || bit.f < needNow * 0.8) {
        const best = App.editStaticRectF(App.editStaticViewportRect(0));
        if (best >= needNow * 0.8) {
          cancelled('stale-quality', false);
          App.rebakeEditStaticViewport();
          return;
        }
      }
      vp._f = bit.f;
      const needView0 = App.editStaticViewportRect(0);
      if (es.bit && !App.editStaticCovers(vp, needView0)) {
        cancelled('stale-cover', false);
        App.rebakeEditStaticViewport();
        return;
      }
      if (App.editStaticStageEl && App.editStaticStageEl.isConnected) App.editStaticStageEl.remove();
      const stage = svgEl('image', { 'pointer-events': 'none', 'preserveAspectRatio': 'none', 'class': 'sve-edit-static' });
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
        cancelled('stage-failed', false);
      };
      const ready = function () {
        if (settled) return;
        settled = true; clear();
        requestAnimationFrame(function () { requestAnimationFrame(function () {
          if (!es.active || token !== App._editStaticToken || !stage.isConnected) {
            if (stage.isConnected) stage.remove();
            if (App.editStaticStageEl === stage) App.editStaticStageEl = null;
            cancelled('stale-before-install', false);
            return;
          }
          const old = App.editStaticBgEl;
          const oldUrl = es.url;
          stage.style.visibility = '';
          App.editStaticBgEl = stage;
          if (App.editStaticStageEl === stage) App.editStaticStageEl = null;
          es.bit = bit;
          es.view = vp;
          es.failedTop = bit.failedTop || null;
          es._bakedInterMin = interMin;
          es._bakedItems = new Set(items);
          es._bakedColorRev = colorRev;
          es._bakedContentRev = contentRevision;
          es.url = (bit.url && bit.url.indexOf('blob:') === 0) ? bit.url : null;
          finishBake();
          if (!es.base && !App.editStaticDetailCoversContent()) App.editStaticBaseSchedule(1200);
          if (old && old !== stage && old.isConnected) old.remove();
          if (oldUrl && oldUrl !== es.url) {
            setTimeout(function () { try { URL.revokeObjectURL(oldUrl); } catch (e) {   } }, 0);
          }
          App.editStaticRestack();
          App.updateEditStaticViewport();
          App.traceRenderTask('editStatic', 'install', {
            docId: docId, contentRevision: contentRevision, generation: token,
            f: bit.f, failedTop: bit.failedTop ? bit.failedTop.size : 0,
            ms: Math.round(performance.now() - t0), run: es._run || null
          });
        }); });
      };
      stage.addEventListener('load', ready);
      stage.addEventListener('error', failed);
      stage.setAttribute('href', bit.url);
    }).catch(function (e) {
      console.warn('[bake] 编辑静态任务失败', String(e && e.message || e).slice(0, 160));
      finishBake();
      App.traceRenderTask('editStatic', 'cancel', {
        docId: docId, contentRevision: contentRevision, generation: token,
        reason: 'bake-throw', ms: Math.round(performance.now() - t0)
      });
    });
  } catch (e) {   }
};
App.updateEditStaticViewport = function () {
  const es = App.editStatic;
  if (!es || !es.active) return;
  const s = App.state;
  if (!s || !s.layers) return;
  if (!s.edit && !App.editStaticHealthy()) {
    App.endEditStatic();
    if (App.autoStaticMaybe) App.autoStaticMaybe();
    return;
  }
  const box = App.whiteBoxLayer ? App.whiteBoxLayer() : null;
  const editItems = (s.edit && App.editTargets) ? App.editTargets() : [];
  const interMinNow = App.editStaticCut(s, box, editItems);
  const vrev = App.viewRevision || 0;
  const viewChanged = (es._uevRev !== vrev);
  es._uevRev = vrev;
  const covers = [];
  if (es.view && es.bit && App.editStaticBgEl && App.editStaticBgEl.isConnected &&
      App.editStaticBgEl.getAttribute('href')) {
    covers.push({
      r: es.view,
      items: (es._bakedItems || App.editStaticItemSet()),
      failed: es.failedTop,
      min: (es._bakedInterMin !== undefined ? es._bakedInterMin : interMinNow),
      f: Number(es.view._f) || 0, primary: true
    });
  }
  if (es.base && es.base.rect && es.base.items && App.editStaticBaseEl &&
      App.editStaticBaseEl.isConnected && App.editStaticBaseEl.getAttribute('href') &&
      (!App.wantOverviewBitmap || App.wantOverviewBitmap())) {
    covers.push({
      r: es.base.rect, items: es.base.items, failed: es.base.failed,
      min: (es.base.min === undefined ? -1 : es.base.min),
      f: Number(es.base.rect._f) || 0, primary: false
    });
  }
  if (!covers.length) {
    try { (s.layers || []).forEach(l => App.restoreEsVisibility(l)); } catch (e) {   }
    es._hideEpoch = 0; es._hideBit = null; es._hideFailed = null; es._hideSig = '';
    es._hideView = null; es._hideBase = undefined;
    for (let i = 0; i < (s.layers || []).length; i++) if (s.layers[i]) s.layers[i]._esEpoch = 0;
  }
  if (covers.length) {
    const itemSet = App.editStaticItemSet();
    const noCut = !s.edit;
    const usable = covers;
    const sig = usable.map(function (c) {
      return (c.r.x | 0) + ',' + (c.r.y | 0) + ',' + (c.r.w | 0) + ',' + (c.r.h | 0) + ',' + (c.f | 0);
    }).join('|');
    let ep = es._hideEpoch || 0;
    if (es._hideView !== covers[0].r || es._hideBase !== es.base ||
        es._hideBit !== es.bit || es._hideFailed !== es.failedTop || es._hideSig !== sig ||
        es._hideRev !== (App.contentRevision || 0) ||
        es._hideLen !== s.layers.length || es._hideMin !== covers[0].min ||
        es._hideVer !== App.editStaticItemsVer) {
      ep = ++App._editStaticEpoch;
      es._hideView = covers[0].r; es._hideRev = App.contentRevision || 0;
      es._hideLen = s.layers.length; es._hideMin = covers[0].min;
      es._hideVer = App.editStaticItemsVer; es._hideBase = es.base;
      es._hideBit = es.bit; es._hideFailed = es.failedTop; es._hideSig = sig;
      es._hideEpoch = ep;
    }
    for (let i = 0; i < s.layers.length; i++) {
      const l = s.layers[i];
      if (!l || !l.el) continue;
      const inter = (l === box) || s.selected.has(l.id) || (editItems.length > 0 && editItems.indexOf(l) >= 0);
      let eligible = false;
      if ((noCut || !inter) && itemSet.has(l)) {
        for (let ci = 0; ci < usable.length; ci++) {
          const c = usable[ci];
          if (!c.items.has(l)) continue;
          if (c.min >= 0 && i >= c.min) continue;
          if (c.failed && c.failed.has(l.id)) continue;
          eligible = true;
          break;
        }
      }
      if (!eligible) {
        if (l._esPrevVis !== undefined) App.setEsHidden(l, false);
        if (l._esEpoch) l._esEpoch = 0;
        continue;
      }
      if (l._esEpoch === ep) continue;    
      const b = App.editStaticLayerBBox(l);
      let hide = false;
      if (b) {
        for (let ci = 0; ci < usable.length && !hide; ci++) {
          const r = usable[ci].r;
          hide = b.x >= r.x && b.y >= r.y &&
            (b.x + b.w) <= (r.x + r.w) && (b.y + b.h) <= (r.y + r.h);
        }
      }
      App.setEsHidden(l, hide);
      l._esEpoch = ep;
    }
  }
  if (App.editStaticBaseEl) {
    let cov = false;
    if (es.bit && es.view) {
      try { cov = App.editStaticCovers(es.view, App.editStaticViewportRect(0)); } catch (e) { cov = false; }
    }
    const want = cov ? 'none' : '';
    if (App.editStaticBaseEl.style.display !== want) App.editStaticBaseEl.style.display = want;
  }
  if (es.view && es._bakedInterMin !== undefined && es._bakedInterMin !== interMinNow) {
    App.rebakeEditStaticViewport();
    return;
  }
  if (!es.view) { App.rebakeEditStaticViewport(); return; }
  if (!viewChanged) return;
  if (!es.bit) return;    
  const needView = App.editStaticViewportRect(0);
  if (!App.editStaticCovers(es.view, needView)) { App.rebakeEditStaticViewport(); return; }
  const haveF = Number(es.view._f) || 0;
  if (!(haveF > 0) || haveF < App.editStaticNeedF() * 0.8 ||
      haveF > App.editStaticNeedF() * 1.75) App.rebakeEditStaticViewport();
};
App.dropEditStaticItem = function (layer) {
  const es = App.editStatic;
  if (!es || !es.active || !layer) return;
  const idx = es.items.indexOf(layer);
  if (idx >= 0) {
    es.items.splice(idx, 1);
    App.editStaticTouchItems();
    App.restoreEsVisibility(layer);
    App.editStaticBumpToken();
    App.editStaticClearBg();
    App.rebakeEditStaticViewport(0);
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
  if (App.state.edit && App.state.editMode === 'size' && !App.state.eyeMode) {
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
  return Math.max(1, Math.min(9, short / 4));
};

App.handleArrowSpec = function (S) {
  const L = S * 1.7;
  return {
    S: S,
    len: L,
    thick: Math.max(0.8, L * 0.5),
    shaft: Math.max(0.5, L * 0.25),
    gap: S * 0.4,
    arm: L,
    rthick: Math.max(0.7, L * 0.25)
  };
};

App.handleArrowPath = function (len, thick, shaft) {
  const h = len / 2, t = thick / 2, s = shaft / 2;
  const hl = len / 4;
  const x1 = h - hl;
  return 'M' + (-h) + ',0' +
    ' L' + (-x1) + ',' + (-t) + ' L' + (-x1) + ',' + (-s) +
    ' L' + x1 + ',' + (-s) + ' L' + x1 + ',' + (-t) +
    ' L' + h + ',0' +
    ' L' + x1 + ',' + t + ' L' + x1 + ',' + s +
    ' L' + (-x1) + ',' + s + ' L' + (-x1) + ',' + t + ' Z';
};

App.handleRotPath = function (arm, thick) {
  const r = arm * 0.25;
  const hl = arm * 0.25;
  return 'M' + (arm - hl) + ',0 L' + r + ',0 Q0,0 0,' + r + ' L0,' + (arm - hl);
};

App.quickModActive = function () {
  if (App.settings && App.settings.quickClick) return !!App.state.quickClickOn;
  return !!(App.state.quickModDown || App.state.shiftDown);
};

App.handleHitAt = function (clientX, clientY) {
  const rects = App.handleHitGeom || [];
  if (!rects.length) return null;
  const p = App.screenToDoc(clientX, clientY);
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const dx = p.x - r.cx, dy = p.y - r.cy;
    const lu = dx * r.ux + dy * r.uy;
    const lv = dx * r.vx + dy * r.vy;
    if (Math.abs(lu) <= r.w / 2 + 1e-9 && Math.abs(lv) <= r.h / 2 + 1e-9) return r.key;
  }
  return null;
};

App.handleHitPx = function (box) {
  return App.handleArrowSpec(App.handleSizePx(box)).len;
};

App.drawHandles = function () {
  App.handleG.innerHTML = '';
  App.handleEls = [];
  App.handleHitGeom = [];
  const g = App.handleGeometry();
  if (!g) return;
  const sc = App.state.view.scale || 1;
  const S = App.handleSizePx(g.box);
  const a = App.handleArrowSpec(S);
  const quick = !!App.quickModActive();
  const L = a.len / sc, T = a.thick / sc, SH = a.shaft / sc, GAP = a.gap / sc,
    ARM = a.arm / sc, RTH = a.rthick / sc;


  const norm = (x, y) => { const m = Math.hypot(x, y) || 1; return { x: x / m, y: y / m }; };
  const mid = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
  const ctr = { x: g.cx, y: g.cy };
  const outOf = p => norm(p.x - ctr.x, p.y - ctr.y);
  const midN = mid(g.nw, g.ne), midS = mid(g.se, g.sw), midE = mid(g.ne, g.se), midW = mid(g.nw, g.sw);
  const D = GAP + L / 2;               

  const addStraight = function (key, at, dir, cursor, axisDir) {
    const n = norm(dir.x, dir.y);
    const a = norm((axisDir || dir).x, (axisDir || dir).y);
    const cx = at.x + n.x * D, cy = at.y + n.y * D;
    const deg = Math.atan2(a.y, a.x) * 180 / Math.PI;
    const gg = svgEl('g', { transform: 'translate(' + cx + ',' + cy + ') rotate(' + deg + ')' });
    const hit = svgEl('rect', {
      x: -L / 2, y: -T / 2, width: L, height: T,
      class: 'sve-handle-hit', 'data-h': key, fill: 'transparent',
      'pointer-events': 'fill', 'stroke-width': 0, cursor: cursor
    });
    gg.appendChild(hit);
    gg.appendChild(svgEl('path', {
      d: App.handleArrowPath(L, T, SH), class: 'sve-harrow', 'pointer-events': 'none'
    }));
    App.handleG.appendChild(gg);
    App.handleEls.push({ key: key, el: hit });
    App.handleHitGeom.push({ key: key, cx: cx, cy: cy, ux: a.x, uy: a.y, vx: -a.y, vy: a.x, w: L, h: T });
  };

  const addRot = function (key, corner, u, v, cursor) {
    const G2 = GAP + RTH * 0.9;
    const d = outOf(corner);                   
    const k = G2 * Math.SQRT2;                 
    const px = corner.x + d.x * k;
    const py = corner.y + d.y * k;
    const gg = svgEl('g', {
      transform: 'matrix(' + u.x + ',' + u.y + ',' + v.x + ',' + v.y + ',' + px + ',' + py + ')'
    });
    const hl = ARM * 0.25;
    const hw = ARM * 0.25;
    gg.appendChild(svgEl('path', {
      d: App.handleRotPath(ARM, RTH), class: 'sve-harrow-line',
      'stroke-width': RTH, 'stroke-linecap': 'butt', 'stroke-linejoin': 'round',
      'pointer-events': 'none'
    }));
    gg.appendChild(svgEl('path', {
      d: 'M' + ARM + ',0 L' + (ARM - hl) + ',' + (-hw) + ' L' + (ARM - hl) + ',' + hw + ' Z',
      class: 'sve-harrow', 'pointer-events': 'none'
    }));
    gg.appendChild(svgEl('path', {
      d: 'M0,' + ARM + ' L' + (-hw) + ',' + (ARM - hl) + ' L' + hw + ',' + (ARM - hl) + ' Z',
      class: 'sve-harrow', 'pointer-events': 'none'
    }));
    const mkHit = function (lx0, ly0, lx1, ly1) {
      const w = Math.abs(lx1 - lx0), h = Math.abs(ly1 - ly0);
      const x0 = Math.min(lx0, lx1), y0 = Math.min(ly0, ly1);
      const hit = svgEl('rect', {
        x: x0, y: y0, width: w, height: h,
        class: 'sve-handle-hit', 'data-h': key, fill: 'transparent',
        'pointer-events': 'fill', 'stroke-width': 0, cursor: cursor
      });
      gg.appendChild(hit);
      App.handleEls.push({ key: key, el: hit });
      const lcx = x0 + w / 2, lcy = y0 + h / 2;
      App.handleHitGeom.push({
        key: key,
        cx: px + u.x * lcx + v.x * lcy,
        cy: py + u.y * lcx + v.y * lcy,
        ux: u.x, uy: u.y, vx: v.x, vy: v.y, w: w, h: h
      });
    };
    mkHit(0, -RTH / 2, ARM - hl, RTH / 2);        
    mkHit(ARM - hl, -hw, ARM, hw);                
    mkHit(-RTH / 2, 0, RTH / 2, ARM - hl);        
    mkHit(-hw, ARM - hl, hw, ARM);                
    App.handleG.appendChild(gg);
  };

  if (!quick) {
    addStraight('nw', g.nw, outOf(g.nw), 'nwse-resize');
    addStraight('ne', g.ne, outOf(g.ne), 'nesw-resize');
    addStraight('se', g.se, outOf(g.se), 'nwse-resize');
    addStraight('sw', g.sw, outOf(g.sw), 'nesw-resize');
    addStraight('n', midN, outOf(midN), 'ns-resize');
    addStraight('s', midS, outOf(midS), 'ns-resize');
    addStraight('w', midW, outOf(midW), 'ew-resize');
    addStraight('e', midE, outOf(midE), 'ew-resize');
  } else {
    const edgeU = {
      nw: norm(g.ne.x - g.nw.x, g.ne.y - g.nw.y),
      ne: norm(g.nw.x - g.ne.x, g.nw.y - g.ne.y),
      se: norm(g.sw.x - g.se.x, g.sw.y - g.se.y),
      sw: norm(g.se.x - g.sw.x, g.se.y - g.sw.y)
    };
    const edgeV = {
      nw: norm(g.sw.x - g.nw.x, g.sw.y - g.nw.y),
      ne: norm(g.se.x - g.ne.x, g.se.y - g.ne.y),
      se: norm(g.ne.x - g.se.x, g.ne.y - g.se.y),
      sw: norm(g.nw.x - g.sw.x, g.nw.y - g.sw.y)
    };
    addRot('nw', g.nw, edgeU.nw, edgeV.nw, 'nwse-resize');
    addRot('ne', g.ne, edgeU.ne, edgeV.ne, 'nesw-resize');
    addRot('se', g.se, edgeU.se, edgeV.se, 'nwse-resize');
    addRot('sw', g.sw, edgeU.sw, edgeV.sw, 'nesw-resize');
    const tangN = norm(g.ne.x - g.nw.x, g.ne.y - g.nw.y);
    const tangS = norm(g.sw.x - g.se.x, g.sw.y - g.se.y);
    addStraight('n', midN, outOf(midN), 'ns-resize', tangN);
    addStraight('s', midS, outOf(midS), 'ns-resize', tangS);
  }
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
App.flashIntervalMs = 3000;
App.flashDurationMs = 400;
App.restoreDirectFlash = function (rec) {
  if (!rec || rec.kind !== 'auto-static-direct') return;
  const pair = rec.pair;
  if (pair && pair.yellow) pair.yellow.style.opacity = '0';
  if (pair && pair.blue) pair.blue.style.opacity = '0';
  const cur = App.autoStaticFlashPair;
  if (cur && cur !== pair) {
    if (cur.yellow) cur.yellow.style.opacity = '0';
    if (cur.blue) cur.blue.style.opacity = '0';
  }
  const curBase = App.autoStaticBaseFlashPair;
  if (curBase && curBase !== pair) {
    if (curBase.yellow) curBase.yellow.style.opacity = '0';
    if (curBase.blue) curBase.blue.style.opacity = '0';
  }
  rec.active = false;
};
App.hideAutoStaticFlashPair = function () {
  [App.autoStaticFlashPair, App.autoStaticBaseFlashPair].forEach(function (p) {
    if (!p) return;
    try {
      if (p.yellow) p.yellow.style.opacity = '0';
      if (p.blue) p.blue.style.opacity = '0';
    } catch (e) {   }
  });
};
App.applyDirectFlashColor = function (rec, color) {
  if (!rec || rec.kind !== 'auto-static-direct') return false;
  let pair = rec.pair;
  if (pair !== App.autoStaticFlashPair && pair !== App.autoStaticBaseFlashPair) {
    if (App.autoStaticBaseFlashPair && App.autoStaticBaseFlashPair.target === rec.target &&
        App.autoStaticFlashPairUsable(App.autoStaticBaseFlashPair)) pair = App.autoStaticBaseFlashPair;
    else if (App.autoStaticFlashPair && App.autoStaticFlashPair.target === rec.target &&
        App.autoStaticFlashPairUsable(App.autoStaticFlashPair)) pair = App.autoStaticFlashPair;
    else return false;
    rec.pair = pair;
  }
  if (!App.autoStaticFlashPairUsable(pair)) return false;
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
  const sig = Array.from(App.state.selected).sort((a, b) => a - b).join(',') + '|' + (App.state.edit ? 'E' : '-');
  const changed = sig !== App._flashRunSig;
  App._flashRunSig = sig;
  if (reset && changed && App.state.flashTimer) {
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
      const vnode = App.symbolVecMaskNode
        ? App.symbolVecMaskNode(layer, -layer.w / 2, -layer.h / 2, layer.w, layer.h) : null;
      if (vnode) {
        m.appendChild(vnode);
      } else {
      m.appendChild(svgEl('image', {
        href: layer.dataUri,
        x: -layer.w / 2, y: -layer.h / 2,
        width: layer.w, height: layer.h,
        preserveAspectRatio: 'none'
      }));
      }
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
  if (layer._esPrevVis === null || layer._esPrevVis === 'visible') clone.removeAttribute('visibility');
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
App.bakeLeafMatFn = function () {
  const cache = new Map();
  const ancestor = function (node) {
    if (!node || node.nodeType !== 1 || node === App.layersRoot || node === App.svg) return new DOMMatrix();
    const hit = cache.get(node);
    if (hit) return hit;
    const chain = [];
    let el = node;
    while (el && el.nodeType === 1 && el !== App.layersRoot && el !== App.svg) {
      chain.push(el.getAttribute('transform'));
      el = el.parentNode;
    }
    let m = new DOMMatrix();
    for (let i = chain.length - 1; i >= 0; i--) m = m.multiply(parseTransformAttr(chain[i]));
    cache.set(node, m);
    return m;
  };
  return function (l) {
    if (!l || !l.el || !l.el.parentNode) return transformChainMat(l);
    return ancestor(l.el.parentNode).multiply(parseTransformAttr(l.el.getAttribute('transform')));
  };
};
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
      try { App.log('perf', '合成闪动快速路径', { ms: Math.round(performance.now() - App.__compBuildT0) }); } catch (e) {   }
      return Promise.resolve(g);
    }
  }
  const leaves = [];
  const walk = l => { if (l.kind === 'merged') (l.children || []).forEach(walk); else leaves.push(l); };
  if (isMerged) walk(items[0]); else items.forEach(walk);
  if (!leaves.length) return Promise.resolve(null);
  if (leaves.length > (App.compFlashMaxLeaves || 800)) {
    try { App.log('perf', '合成闪动跳过', { leaves: leaves.length, ms: Math.round(performance.now() - App.__compBuildT0) }); } catch (e) {   }
    return Promise.resolve(null);
  }
  return new Promise(resolve => {
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
    let leafScale = 1;
    {
      let sum = 0;
      for (let i = 0; i < leaves.length; i++) {
        const need = Math.max(1, Math.max(Number(leaves[i].w) || 0, Number(leaves[i].h) || 0) * f);
        const p = Math.max(16, Math.min(App.lod.flashLeafMax, Math.round(need)));
        sum += p * p;
      }
      if (sum > App.lod.flashTotalPixels) leafScale = Math.sqrt(App.lod.flashTotalPixels / sum);
    }
    const leafTexSize = l => {
      const need = Math.max(1, Math.max(Number(l && l.w) || 0, Number(l && l.h) || 0) * f) * leafScale;
      return Math.max(16, Math.min(App.lod.flashLeafMax, App.lod.maxSide, Math.round(need)));
    };
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
      const dpr = window.devicePixelRatio || 1;
      const bucket = App.lodBucketOf(App.state.view.scale || 1);
      const wantF = App.lodBucketScale(bucket) * dpr;
      f = Math.max(1e-4, Math.min(wantF, App.lod.maxSide / Math.max(bw, bh),
        Math.sqrt(App.lod.maxPixels / (bw * bh))));
      const srcs = leaves.map(l => {
        if (l.kind === 'symbol' && l.dataUri) {
          const vd = App.symbolVecPathOf && l.symbolKey ? App.symbolVecPathOf(l.symbolKey) : null;
          if (vd && App.libVec && App.libVec.ready && App.symbolVecPath2D) {
            const p2 = App.symbolVecPath2D(l.symbolKey);
            if (p2) return Promise.resolve({ path: p2, key: l.symbolKey });
          }
          return App.silhouetteCanvas(l.dataUri, '#ffffff', leafTexSize(l), App.symbolColorIdent(l));
        }
        if (l.kind === 'pattern') {
          const s = Math.min(256, leafTexSize(l));
          const c = App.patternThumbCanvas(l.patternKey, '#ffffff', s);
          return Promise.resolve({ canvas: c, rect: { x: 0, y: 0, w: s, h: s } });
        }
        return App.svgRasterThumb(l, Math.min(App.lod.flashLeafMax, leafTexSize(l)))
          .then(url => (url ? loadImage(url) : null))
          .then(img => (img ? { canvas: img, rect: { x: 0, y: 0, w: img.width, h: img.height } } : null))
          .catch(e => { console.warn('[flash] 导入图层剪影生成失败', l && l.id, String(e && e.message || e).slice(0, 160)); return null; });
      });
      Promise.all(srcs).then(canvases => {
        if (App.compFlashToken !== token) return resolve(null);
        const cw = Math.max(1, Math.round(bw * f)), ch2 = Math.max(1, Math.round(bh * f));
        cv = document.createElement('canvas'); cv.width = cw; cv.height = ch2;
        cx = cv.getContext('2d');
        drawStep(canvases);
      }).catch(e => {
        console.warn('[flash] 合成剪影取图失败', String(e && e.message || e).slice(0, 160));
        resolve(null);
      });
    };
    const drawStep = (canvases) => {
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
        } else if (entry && entry.path) {
          const sym = App.symbolMap.get(entry.key);
          const u = App.libVec.unit;
          const sw = Math.max(1e-6, (sym && sym.w) || l.w || 1);
          const sh = Math.max(1e-6, (sym && sym.h) || l.h || 1);
          const T = new DOMMatrix().translate(-minx * f, -miny * f).scale(f).multiply(mats[di])
            .translate(-(l.w || 0) / 2, -(l.h || 0) / 2)
            .scale(((l.w || 0) / (sw * u)), ((l.h || 0) / (sh * u)));
          cx.save();
          cx.setTransform(T.a, T.b, T.c, T.d, T.e, T.f);
          cx.fillStyle = '#ffffff';
          cx.fill(entry.path, 'evenodd');
          cx.restore();
        }
        di++; n++;
      }
      if (di < leaves.length) { setTimeout(() => drawStep(canvases), 0); return; }
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
        } catch (e) {   }
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
  });
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
        if (buildToken !== App.compFlashToken || !g) { if (g) App.releaseFlashOverlay(g); App.hideAutoStaticFlashPair(); return; }
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
  let pair = App.autoStaticBaseFlashPair;
  let target = App.autoStaticBaseEl;
  if (!App.autoStaticFlashPairUsable(pair)) {
    pair = App.autoStaticFlashPair;
    target = App.autoStaticBgEl;
  }
  if (!cache || !cache.active) return null;
  if (!target || !target.isConnected || !target.getAttribute('href')) return null;
  if (!pair || pair.target !== target || !pair.g || !pair.g.isConnected) return null;
  if (cache.bit && cache.bit.failedTop && cache.bit.failedTop.size) return null;
  if (!items || items.length !== layers.length) return null;
  const wanted = new Set(items);
  if (layers.some(layer => !wanted.has(layer))) return null;
  return target;
};
App.largeFlashSig = function (items) {
  return (App.contentRevision || 0) + ':' + (items || []).map(layer => layer.id).join(',') +
    ':lod' + (App.lodBucketOf ? App.lodBucketOf(App.state.view.scale || 1) : 0);
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
      const wantPair = (App.autoStaticBaseFlashPair && App.autoStaticBaseFlashPair.target === directTarget &&
        App.autoStaticFlashPairUsable(App.autoStaticBaseFlashPair))
        ? App.autoStaticBaseFlashPair : App.autoStaticFlashPair;
      if (!composite || composite.kind !== 'auto-static-direct' ||
          composite.target !== directTarget || composite.sig !== sig || composite.pair !== wantPair) {
        if (composite) App.releaseFlashOverlay(composite);
        composite = {
          kind: 'auto-static-direct', sig: sig, target: directTarget, pair: wantPair,
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
          App.hideAutoStaticFlashPair();
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

App._flashLodBucket = -1;
App.refreshFlashLod = function () {
  if (!App.flashOverlayMap || !App.flashOverlayMap.size) return;
  const composite = App.flashOverlayMap.get('__composite__');
  if (!composite || composite.kind !== 'composite') { App._flashLodBucket = App.lodBucketOf(App.state.view.scale || 1); return; }
  const bucket = App.lodBucketOf(App.state.view.scale || 1);
  if (bucket === App._flashLodBucket) return;
  App._flashLodBucket = bucket;
  const n = (composite.items || []).reduce((acc, l) => acc + (App.countInLayer ? App.countInLayer(l) : 1), 0);
  if (n > 400) return;
  try { App.updateFlashOverlays(false); }
  catch (e) { console.warn('[flash] LOD 重建覆盖层失败', String(e && e.message || e).slice(0, 160)); }
};

App.applyFlashColor = function (c) {
  App.flashColor = c;
  App.flashG.style.setProperty('--sve-flash-color', c);
  const direct = App.flashOverlayMap.get('__composite__');
  if (direct && direct.kind === 'auto-static-direct') App.applyDirectFlashColor(direct, c);
};
App.resetFlashColorVar = function () {
  App.flashColor = null;
  try { App.flashG.style.setProperty('--sve-flash-color', 'rgb(' + App.flashColors.yellow.join(',') + ')'); }
  catch (e) {   }
};
App.clearFlash = function () {
  try {
    if (App._flashSafetyTimer) { clearTimeout(App._flashSafetyTimer); App._flashSafetyTimer = null; }
    if (App.flashTimers) {
      App.flashTimers.forEach(function (t) { try { cancelAnimationFrame(t); } catch (e) {   } });
      App.flashTimers = [];
    }
    App.flashSeq++;                        
    const cur = App.flashOverlayMap.get('__composite__');
    if (cur && cur.kind === 'auto-static-direct') App.restoreDirectFlash(cur);
    App.hideAutoStaticFlashPair();
    if (App.flashG) App.flashG.style.display = 'none';
    App.setFlashOpacity(1);
    App.resetFlashColorVar();
  } catch (e) {   }
};
App.syncFlashCompositing = function () {
  const sc = (App.state && App.state.view) ? (App.state.view.scale || 1) : 1;
  const want = sc >= 8 ? 'opacity' : '';
  try {
    if (App.flashG && App.flashG.style.willChange !== want) App.flashG.style.willChange = want;
    if (App.autoStaticFlashG && App.autoStaticFlashG.style.willChange !== want) App.autoStaticFlashG.style.willChange = want;
  } catch (e) {   }
};
App.setFlashOpacity = function (v) {
  const s = String(Math.max(0, Math.min(1, Number(v) || 0)));
  App.flashG.style.opacity = s;
  if (App.autoStaticFlashG) App.autoStaticFlashG.style.opacity = s;
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
App.flashColors = { yellow: [235, 234, 58], blue: [10, 10, 252] };
App.flashCurve = function (t) {
  const D = App.flashDurationMs || 400;
  const Y = App.flashColors.yellow, B = App.flashColors.blue;
  const tY = D * 0.325, tB = D * 0.575;
  if (!(t >= 0)) t = 0;
  if (t >= D) return null;
  if (t < tY) return { color: 'rgb(' + Y.join(',') + ')', opacity: t / tY };
  if (t < tB) return { color: mixRGB(Y, B, (t - tY) / (tB - tY)), opacity: 1 };
  return { color: 'rgb(' + B.join(',') + ')', opacity: 1 - (t - tB) / (D - tB) };
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
      (!direct.target || !direct.target.isConnected ||
       (direct.target !== App.autoStaticBgEl && direct.target !== App.autoStaticBaseEl) ||
       !direct.pair || (direct.pair !== App.autoStaticFlashPair && direct.pair !== App.autoStaticBaseFlashPair))) {
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
  const directOk = !!(crec && crec.kind === 'auto-static-direct' && App.autoStaticFlashPairUsable(crec.pair));
  App.flashG.style.display = directOk ? 'none' : '';
  const seq = ++App.flashSeq;
  App.flashTimers.forEach(t => { cancelAnimationFrame(t); clearTimeout(t); });
  App.flashTimers = [];
  App.applyFlashColor('rgb(' + App.flashColors.yellow.join(',') + ')');
  App.setFlashOpacity(0);
  const t0 = performance.now();
  const step = now => {
    if (seq !== App.flashSeq) return;
    const f = App.flashCurve(now - t0);
    if (f) {
      App.setFlashOpacity(f.opacity);
      App.applyFlashColor(f.color);
      App.flashTimers.push(requestAnimationFrame(step));
      return;
    }
    const current = App.flashOverlayMap.get('__composite__');
    if (current && current.kind === 'auto-static-direct') App.restoreDirectFlash(current);
    App.hideAutoStaticFlashPair();
    App.flashG.style.display = 'none'; 
    App.setFlashOpacity(1);            
    App.resetFlashColorVar();
    App.flashTimers = [];
  };
  App.flashTimers.push(requestAnimationFrame(step));
  if (App._flashSafetyTimer) clearTimeout(App._flashSafetyTimer);
  App._flashSafetyTimer = setTimeout(function () {
    App._flashSafetyTimer = null;
    if (seq !== App.flashSeq) return;
    try {
      const cur = App.flashOverlayMap.get('__composite__');
      if (cur && cur.kind === 'auto-static-direct') App.restoreDirectFlash(cur);
      App.hideAutoStaticFlashPair();
      App.flashG.style.display = 'none';
      App.setFlashOpacity(1);
      App.resetFlashColorVar();
      App.flashTimers = [];
    } catch (e) {   }
  }, (App.flashDurationMs || 400));
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
      : loadImage(uri).catch(() => null))
      .then(img => { if (img && App.noteTexNative) App.noteTexNative(uri, img.width, img.height); return img; });
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
  const sx = f.sx * (f.flipH ? -1 : 1);
  const sy = f.sy * (f.flipV ? -1 : 1);
  const py0 = y * sy;
  const t = Math.tan(f.skew * D2R);
  const px = App.skewMode === '132' ? (x + t * y) * sx : x * sx + t * py0;
  const a = f.rot * D2R, c = Math.cos(a), s = Math.sin(a);
  return [px * c - py0 * s, px * s + py0 * c];
}
App.computeLocalBBox = function (layer) {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  const addCorners = l => {
    if (l.kind === 'merged') { (l.children || []).forEach(addCorners); return; }
    const hw = (l.w || 0) / 2, hh = (l.h || 0) / 2;
    [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].forEach(p => {
      const sx = l.sx * (l.flipH ? -1 : 1);
      const py = p[1] * (l.sy * (l.flipV ? -1 : 1));
      const tt = Math.tan(l.skew * D2R);
      const px = App.skewMode === '132' ? (p[0] + tt * p[1]) * sx : p[0] * sx + tt * py;
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
  const _sk = () => cx.transform(1, 0, Math.tan(f.skew * D2R), 1, 0, 0);
  const _sc = () => cx.scale(f.sx * (f.flipH ? -1 : 1), f.sy * (f.flipV ? -1 : 1));
  if (App.skewMode === '132') { _sc(); _sk(); } else { _sk(); _sc(); }
  cx.drawImage(base, -(rect.x + rect.w / 2), -(rect.y + rect.h / 2));
  return c;
};
App.silhouettePending = new Map();
App.silhouetteCanvas = function (uri, color, size, ident) {
  const key = App.silhouetteCacheKey(uri, color, size, ident);
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
  const entry = layer.dataUri ? await App.silhouetteCanvas(layer.dataUri, '#ffffff', size, App.symbolColorIdent(layer)) : null;
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
    return App.symbolColorCanvas(layer.dataUri, "#ffffff", size, size, App.symbolColorIdent(layer)).then(function (maskCanvas) {
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
  if (App.libThumbPreUrl) {
    const pre = App.libThumbPreUrl(symbol);
    if (pre) return Promise.resolve(pre);
  }
  const identity = App.libThumbIdentity(symbol);
  const diskOk = !!(identity && typeof App.thumbCacheLookup === 'function' &&
    window.sveApi && typeof window.sveApi.thumbCachePut === 'function');
  if (diskOk) return App.libThumbResolve(symbol, identity);
  return App.libThumbBuild(symbol);
};

App.libThumbIdentity = function (symbol) {
  if (!symbol || !symbol.key) return '';
  return 'lib\0' + String(symbol.key) + '\0' + String(App.libAssetVer || '0');
};

App.libThumbResolve = function (symbol, identity) {
  const cache = App.__libThumbDiskCache || (App.__libThumbDiskCache = new Map());
  if (cache.has(identity)) return Promise.resolve(cache.get(identity));
  const p = (async function () {
    const hits = await App.thumbCacheLookup(App.LIB_THUMB_NS, [identity]);
    let url = hits.get(identity) || '';
    if (url) {
      const ok = await App.probeImageUrl(url);
      if (!ok) {
        await App.thumbCacheDrop(App.LIB_THUMB_NS, [identity]);
        url = '';
      }
    }
    if (!url) {
      const dataUrl = await App.libThumbBuild(symbol, true);
      if (!dataUrl) return '';
      url = (await App.thumbCacheStore(App.LIB_THUMB_NS, identity, dataUrl)) || dataUrl;
      symbol.thumb = dataUrl;       
    }
    cache.set(identity, url);
    return url;
  })();
  cache.set(identity, p);
  p.catch(() => cache.delete(identity));
  return p;
};

App.libThumbBuild = function (symbol, wantDataUrl) {
  return App.silhouetteCanvas(App.symbolUri(symbol), '#ffffff', 64,
    { key: symbol.key, group: App.symbolGroupOfKey(symbol.key) }).then(entry => {
    if (!entry) return '';
    const dataUrl = entry.canvas.toDataURL();
    if (!wantDataUrl) symbol.thumb = dataUrl;
    return dataUrl;
  });
};

App.probeImageUrl = function (url) {
  return new Promise(function (resolve) {
    const img = new Image();
    const done = ok => { img.onload = img.onerror = null; resolve(ok); };
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = url;
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
    const base = new DOMMatrix().translate(Number(l.x) || 0, Number(l.y) || 0)
      .rotate(Number(l.rot) || 0);
    return App.skewMode === '132'
      ? base.scale(sx, sy).skewX(Number(l.skew) || 0)
      : base.skewX(Number(l.skew) || 0).scale(sx, sy);
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

App._thumbBitmapCache = new Map();
App.bitmapImageFor = function (url) {
  const hit = App._thumbBitmapCache.get(url);
  if (hit) return hit;
  const p = loadImage(url).then(function (im) { return im || null; },
    function () { return null; });
  App._thumbBitmapCache.set(url, p);
  if (App._thumbBitmapCache.size > 8) {
    const k = App._thumbBitmapCache.keys().next().value;
    App._thumbBitmapCache.delete(k);
  }
  return p;
};
App.mergedThumbRectExclusive = function (layer, bb) {
  if (!bb || !(bb.w > 0) || !(bb.h > 0)) return false;
  const layers = App.state.layers || [];
  const bx2 = bb.x + bb.w, by2 = bb.y + bb.h;
  for (let i = 0; i < layers.length; i++) {
    const o = layers[i];
    if (!o || o === layer) continue;
    if (o.kind === 'import') return false;
    let ob = null;
    try { ob = App.getItemDocBBox(o); } catch (e) { ob = null; }
    if (!ob || !(ob.w > 0) || !(ob.h > 0)) {
      if (o.kind === 'merged') return false;
      continue;
    }
    if (ob.x < bx2 && ob.x + ob.w > bb.x && ob.y < by2 && ob.y + ob.h > bb.y) return false;
  }
  return true;
};
App.mergedThumbFromBitmap = function (layer, size) {
  const st = App.autoStatic;
  const bit = st && st.active ? st.bit : null;
  if (!bit || !bit.url || !(bit.f > 0)) return null;
  if (st.colorRev !== (App._colorRev || 0)) return null;                  
  if (st.contentRevision !== (App.contentRevision || 0)) return null;     
  if (Math.abs(Number(layer.rot) || 0) > 0.01) return null;
  if (Math.abs(Number(layer.skew) || 0) > 0.01) return null;
  if (layer.flipH || layer.flipV) return null;
  let bb = null;
  try { bb = App.getItemDocBBox(layer); } catch (e) { return null; }
  if (!bb || !(bb.w > 0) || !(bb.h > 0)) return null;
  if (!App.mergedThumbRectExclusive(layer, bb)) return null;
  const eps = 0.5;    
  if (bb.x < bit.x - eps || bb.y < bit.y - eps ||
      bb.x + bb.w > bit.x + bit.w + eps || bb.y + bb.h > bit.y + bit.h + eps) return null;
  const f = (size * 0.96) / Math.max(bb.w, bb.h);
  return App.bitmapImageFor(bit.url).then(function (img) {
    if (!img) return '';
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    const cx = cv.getContext('2d');
    if (!cx) return '';
    cx.imageSmoothingEnabled = true;
    if (cx.imageSmoothingQuality !== undefined) cx.imageSmoothingQuality = 'high';
    const dw = bb.w * f, dh = bb.h * f;
    cx.drawImage(img,
      (bb.x - bit.x) * bit.f, (bb.y - bit.y) * bit.f, bb.w * bit.f, bb.h * bit.f,
      (size - dw) / 2, (size - dh) / 2, dw, dh);
    return cv.toDataURL();
  });
};
App.thumbWorkShouldWait = function (layer) {
  const st = App.autoStatic || {};
  if (st.active) return false;                         
  if (st.baking) return true;
  if (App.autoStaticEligible && App.autoStaticEligible()) return true;    
  return false;
};
App._mergedThumbChain = Promise.resolve();
App.mergedThumbSerial = function (layer, size) {
  const run = function () { return App.mergedThumbUrl(layer, size); };
  const p = App._mergedThumbChain.then(function () {
    return new Promise(function (res) { setTimeout(res, 0); }).then(run);
  });
  App._mergedThumbChain = p.then(function () { return ''; }, function () { return ''; });
  return p;
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
    const urls = await App.resolveBakeLayerSources(leaves, 256, 24, undefined, { drawable: true, f: 1 });
    const urlOnly = Array.from(new Set(urls.filter(s => typeof s === 'string' && s)));
    const byUrl = await App.loadBakeImages(urlOnly, '[thumb] 分组图源解码失败');
    const sourceOf = s => (typeof s === 'string' ? (byUrl.get(s) || null) : (s || null));
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
      const img = u ? sourceOf(u) : null;
      const M = mats[i];
      if (!img || !M) continue;
      const l = leaves[i];
      const sw = img.naturalWidth || img.width;
      const sh = img.naturalHeight || img.height;
      if (!(sw > 0) || !(sh > 0)) continue;
      cx.save();
      const T = new DOMMatrix().translate(offx, offy).scale(f).multiply(M);
      cx.setTransform(T.a, T.b, T.c, T.d, T.e, T.f);
      cx.globalAlpha = (l && l.opacity >= 0 && l.opacity <= 1) ? l.opacity : 1;
      cx.globalCompositeOperation = l.isMask ? 'destination-out' : 'source-over';
      cx.drawImage(img, 0, 0, sw, sh, -(l.w || 0) / 2, -(l.h || 0) / 2, l.w || 0, l.h || 0);
      cx.restore();
      if (i + 1 < leaves.length && performance.now() - sliceStart >= 6) {
        await new Promise(resolve => setTimeout(resolve, 0));
        sliceStart = performance.now();
      }
    }
    if (layer.flipH || layer.flipV) {
      const c2 = document.createElement('canvas');
      c2.width = size; c2.height = size;
      const x2 = c2.getContext('2d');
      x2.translate(layer.flipH ? size : 0, layer.flipV ? size : 0);
      x2.scale(layer.flipH ? -1 : 1, layer.flipV ? -1 : 1);
      x2.drawImage(cv, 0, 0);
      return await App.canvasPngUrl(c2, 'merged-thumb');
    }
    const out = await App.canvasPngUrl(cv, 'merged-thumb');
    return out;
  } catch (e) { console.warn("[thumb] mergedThumbUrl 失败", String(e && e.message || e).slice(0, 160)); return ""; }
};
App.svgRasterThumb = async function (layer, size, cacheSlot) {
  size = size || 96;
  const sk = cacheSlot || 'rasterCache';
  const slotCache = layer[sk];
  if (slotCache && slotCache.size === size && !layer.thumbDirty) {
    return Promise.resolve(slotCache.url);
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
    clone.setAttribute('transform', 'rotate(' + f.rot + ') ' +
      (App.skewMode === '132'
        ? 'scale(' + (f.sx * sfx) + ' ' + (f.sy * sfy) + ') skewX(' + f.skew + ')'
        : 'skewX(' + f.skew + ') scale(' + (f.sx * sfx) + ' ' + (f.sy * sfy) + ')'));
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
      layer[sk] = { size, url: out };
      if (sk === 'rasterCache') {
        layer.thumbCache = out; 
        layer.thumbDirty = false;
      }
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
      p = App.silhouetteCanvas(layer.dataUri, layer.color || '#ffffff', 96, App.symbolColorIdent(layer)).then(entry => {
        if (!entry) return '';
        const out = App.renderTransformedThumb(entry.canvas, entry.rect, layer);
        return out ? out.toDataURL() : '';
      });
    }
  } else if (layer.kind === 'pattern') {
    const base = layer.isMask ? App.maskIndicatorCanvas(96) : App.patternThumbCanvas(layer.patternKey, layer.color, 96);
    const out = App.renderTransformedThumb(base, { x: 0, y: 0, w: 96, h: 96 }, layer);
    p = Promise.resolve(out ? out.toDataURL() : '');
  } else if (layer.kind === 'merged') {
    const viaBit = App.mergedThumbFromBitmap(layer, 96);
    if (viaBit) p = viaBit;
    else if (App.thumbWorkShouldWait(layer)) return Promise.resolve('');    
    else p = App.mergedThumbSerial(layer, 96);    
  } else {
    p = App.svgRasterThumb(layer);
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
App._proxyBake = new Map();
App._proxyTryHideChildren = function (merged, from) {
  if (!merged || !merged.el) return false;
  const rec = App._proxyBake.get(merged.id);
  if (!rec) return false;
  const cropOk = !!rec.url;
  const baseOk = !!rec.baseUrl;
  const fullBox = rec.full;
  const cropCoversAll = !!(fullBox && rec.cropToken !== undefined &&
    Math.abs(rec.minx - fullBox.minx) < 0.5 && Math.abs(rec.miny - fullBox.miny) < 0.5 &&
    Math.abs(rec.bw - fullBox.bw) < 0.5 && Math.abs(rec.bh - fullBox.bh) < 0.5 && !!rec.url);
  if (!((cropOk && baseOk) || cropCoversAll)) return false;
  merged.el.querySelectorAll('[data-layer]').forEach(el => el.setAttribute('visibility', 'hidden'));
  merged._localBB = undefined;
  return true;
};      
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
  if (rec && rec.url) { try { URL.revokeObjectURL(rec.url); } catch (e) {   } }
  if (rec && rec.baseUrl) { try { URL.revokeObjectURL(rec.baseUrl); } catch (e) {   } }
  if (rec && rec.baseMaskUrl) { try { URL.revokeObjectURL(rec.baseMaskUrl); } catch (e) {   } }
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
  if (App.docNeedsSnapshot && App.docNeedsSnapshot()) return;
  if (layer.w > App.impBitmapMaxSide || layer.h > App.impBitmapMaxSide) return;
  const plan = App.lodTexPlan ? App.lodTexPlan(layer) : null;
  const lodKey = plan ? plan.key : '';
  if (layer.impBaking || (layer.impBitmapUrl && !layer.impBitmapDirty && layer.impLodKey === lodKey)) return;
  if (/url\(#/.test(layer.importMarkup || '')) return;
  layer.impBaking = true;
  const k = plan ? plan.k : 1;
  const bw = Math.max(1, Math.min(2048, Math.round(layer.w * k)));
  const bh = Math.max(1, Math.min(2048, Math.round(layer.h * k)));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + bw + '" height="' + bh + '" viewBox="' +
    (-layer.w / 2) + ' ' + (-layer.h / 2) + ' ' + layer.w + ' ' + layer.h + '">' + (layer.importMarkup || '') + '</svg>';
  let url = null;
  try { url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); } catch (e) { layer.impBaking = false; return; }
  const img = new Image();
  img.onload = () => {
    layer.impBaking = false;
    if (layer.impBitmapUrl && layer.impBitmapUrl !== url) URL.revokeObjectURL(layer.impBitmapUrl);
    layer.impBitmapUrl = url;
    layer.impBitmapDirty = false;
    layer.impLodKey = lodKey;
    App.updateImpDisplay(layer);
  };
  img.onerror = () => { layer.impBaking = false; URL.revokeObjectURL(url); };
  img.src = url;
};
App.impQueueBake = function (layer) {
  if (!layer || layer.impBaking) return;
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
  if (App.docNeedsSnapshot && App.docNeedsSnapshot()) {
    if (layer.innerEl && layer.innerEl.style.display !== '') layer.innerEl.style.display = '';
    if (layer.bitmapEl && layer.bitmapEl.style.display !== 'none') layer.bitmapEl.style.display = 'none';
    return;
  }
  if (!App.impBitmapActive()) return;
  const interactive = App.impIsInteractive(layer);
  const lodKey = App.lodTexPlan ? App.lodTexPlan(layer).key : '';
  const fresh = !!(layer.impBitmapUrl && !layer.impBitmapDirty && layer.impLodKey === lodKey);
  if (interactive) {
    if (layer.innerEl && layer.innerEl.style.display !== '') layer.innerEl.style.display = '';
    if (layer.bitmapEl && layer.bitmapEl.style.display !== 'none') layer.bitmapEl.style.display = 'none';
  } else if (fresh) {
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
  if (App.docNeedsSnapshot && App.docNeedsSnapshot()) {
    for (let i = 0; i < App.state.layers.length; i++) {
      const l = App.state.layers[i];
      if (!l || l.kind !== 'import') continue;
      if (l.innerEl && l.innerEl.style.display === 'none') l.innerEl.style.display = '';
      if (l.bitmapEl && l.bitmapEl.style.display !== 'none') l.bitmapEl.style.display = 'none';
    }
    return;
  }
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
  if (layer.impBitmapUrl) { try { URL.revokeObjectURL(layer.impBitmapUrl); } catch (e) {   } }
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
        if (url.indexOf('blob:') === 0) { try { URL.revokeObjectURL(url); } catch (e) {   } }
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
      const prev = App._proxyBake.get(merged.id) || rec0;
      App._proxyBake.set(merged.id, Object.assign({}, prev || {}, {
        canvas: cv, minx, miny, bw, bh, f, url: url.indexOf('blob:') === 0 ? url : null,
        needF: (stat && stat.needF) || 0, full: (stat && stat.full) || null,
        cropToken: (stat && stat.token !== undefined) ? stat.token : undefined
      }));
      App._proxyTryHideChildren(merged, 'crop');
      if (prev && prev.url && prev.url !== url) { try { URL.revokeObjectURL(prev.url); } catch (e) {   } }
      merged._localBB = undefined;
      try {
        const t0 = merged.__bakeT0 || 0;
        App.log('perf', '分组烘焙阶段', { merged: merged.id, totalMs: Math.round(performance.now() - t0),
          encodeMs: Math.round(performance.now() - tEnc), leaves: stat && stat.leaves, uniqUrls: stat && stat.uniqUrls,
          loadMs: stat && stat.loadMs, drawMs: stat && stat.drawMs, w: cv.width, h: cv.height, f: f });
      } catch (e) {   }
    };
    const fail = () => {
      console.warn('[proxy-bake] 代理位图解码失败', merged.id);
      if (url.indexOf('blob:') === 0) { try { URL.revokeObjectURL(url); } catch (e) {   } }
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
      if (url) { try { URL.revokeObjectURL(url); } catch (e) {   } }
      if (maskUrl) { try { URL.revokeObjectURL(maskUrl); } catch (e) {   } }
      return;    
    }
    if (!url || !maskUrl) {
      if (url) { try { URL.revokeObjectURL(url); } catch (e) {   } }
      if (maskUrl) { try { URL.revokeObjectURL(maskUrl); } catch (e) {   } }
      console.warn('[proxy-bake] 底图或剪影编码失败', merged.id);
      return;
    }
    let installAttempts = 0;
    const done = () => {
      if ((token !== undefined && token !== merged.__proxyEpoch) || !merged.el || App.state.layers.indexOf(merged) < 0) {
        try { URL.revokeObjectURL(url); } catch (e) {   }
        try { URL.revokeObjectURL(maskUrl); } catch (e) {   }
        return;
      }
      const cur = App._proxyBake.get(merged.id);
      if (!cur) {
        if (++installAttempts < 100) { setTimeout(done, 20); return; }
        try { URL.revokeObjectURL(url); } catch (e) {   }
        try { URL.revokeObjectURL(maskUrl); } catch (e) {   }
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
      if (cur.baseUrl && cur.baseUrl !== url) { try { URL.revokeObjectURL(cur.baseUrl); } catch (e) {   } }
      if (cur.baseMaskUrl && cur.baseMaskUrl !== maskUrl) { try { URL.revokeObjectURL(cur.baseMaskUrl); } catch (e) {   } }
      App._proxyBake.set(merged.id, Object.assign({}, cur, {
        baseCanvas: cv, baseF: fBase, baseUrl: url, baseMaskUrl: maskUrl,
        baseMinx: minx, baseMiny: miny, baseBw: bw, baseBh: bh,
        baseToken: token
      }));
      App._proxyTryHideChildren(merged, 'base');
      try { App.log('perf', '底图烘焙', { merged: merged.id, w: cv.width, h: cv.height, f: fBase, encodeMs: Math.round(performance.now() - tEnc) }); } catch (e) {   }
    };
    const fail = () => {
      try { URL.revokeObjectURL(url); } catch (e) {   }
      try { URL.revokeObjectURL(maskUrl); } catch (e) {   }
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

    } catch (e) {   }
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
  } catch (e) {   }
  const px = Math.round((lp.x - rec.minx) * rec.f);
  const py = Math.round((lp.y - rec.miny) * rec.f);
  if (px < 0 || py < 0 || px >= rec.canvas.width || py >= rec.canvas.height) return null;
  const ctx = rec.canvas.getContext('2d', { willReadFrequently: true });
  const d = ctx.getImageData(px, py, 1, 1).data;
  if (d[3] < 16) return null;
  return rgbToHex(d[0], d[1], d[2]);
};
