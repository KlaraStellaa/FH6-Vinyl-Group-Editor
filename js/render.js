'use strict';
/* 渲染：视图变换、网格、外框、手柄、缩略图（实时含旋转/倾斜/缩放） */
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
  /* 大分组的预染色闪动图层独立常驻；放在普通闪动层下、内容层上。 */
  App.autoStaticFlashG = svgEl('g', { 'pointer-events': 'none' });
  App.flashG.parentNode.insertBefore(App.autoStaticFlashG, App.flashG);
  /* 闪动颜色变量在初始化时就落到「动画起始色（黄）」：这样任何路径（含不带动画的刷新
     updateFlashOverlays(false)）都不会出现「覆盖层已建、颜色未设」的无色状态
     —— 旧代码此时会露出 CSS 兜底的红色 #ff3b30（更早三色动画的残留），2026-09-11 删除 */
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
  /* 视图变更时间戳：周期性选中闪烁在视图交互进行中暂缓（整组闪动会盖住缩放/平移的
     连续性，也会干扰按视口取帧的判据）；交互停止后下一个 5s 周期自然恢复 */
  App._viewMutT = performance.now();
  /* 批量创建期间隐藏的图层容器：解除批量后恢复显示（一次布局）。
     "隐藏图层"开关 / 背景取色器 的隐藏不能被恢复（否则隐藏/取色效果随视图变化失效） */
  if (App.layersRoot && App.layersRoot.style.display === 'none' && !(App.state && App.state.batching) &&
      !(App.state && App.state.layersHidden) && !(App.state && App.state.eyeMode === 'bg')) {
    App.layersRoot.style.display = '';
  }
  const r = App.wrap.getBoundingClientRect();
  const v = App.state.view;
  App.svg.setAttribute('viewBox', v.x + ' ' + v.y + ' ' + (r.width / v.scale) + ' ' + (r.height / v.scale));
  App.updateGridRect();
  /* 编辑静态化视口烘焙：视图缩放/平移后背景按新视口防抖重烘焙（保持清晰） */
  if (App.updateEditStaticViewport) App.updateEditStaticViewport();
  /* 分组烘焙分辨率自适应：放大到超过缓存清晰度时防抖重烘焙（借鉴 Inkscape
     按屏幕尺寸重建缓存）；仅检查已烘焙分组，数量少开销可忽略 */
  if (App.maybeUpgradeProxyRes) App.maybeUpgradeProxyRes();
  /* 大批图层 + 全览：切换视口静态位图（autostatic），避免逐帧光栅化上千元素 */
  if (App.autoStaticMaybe) App.autoStaticMaybe();
  /* 2026-09-12 修复「切回标签后画布显示成别的图案」的根因：
     视图（x/y/scale）是文档状态的一部分，但此前只有 captureDoc/切标签时才写回 d.data.view；
     导入后的自动取景（fit）只改了 state.view 没写回 → 下次 loadDoc 用旧（fitted）视图恢复，
     画布就停在另一个取景上（实测 scale 1 → 0.5488、x -557 → -1439）。
     updateView 是所有视图变更的唯一漏斗，在这里同步最省且不会漏。 */
  try {
    if (App.Tabs && App.Tabs.current && App.Tabs.current.data) {
      App.Tabs.current.data.view = { x: App.state.view.x, y: App.state.view.y, scale: App.state.view.scale };
    }
  } catch (e) { /* ignore */ }
  /* 视图变化同时刷新锚点图标：图标按 1/scale 反向缩放保持屏幕尺寸恒定，
     scale 变了必须立刻重定位（否则只改视图不重绘的路径上图标尺寸会跟着画布缩放变） */
  if (App.drawAnchorIcon && App.state.editMode === 'size') App.drawAnchorIcon();
};

/* 屏幕坐标 <-> 文档坐标 */
App.screenToDoc = function (clientX, clientY) {
  const p = new DOMPoint(clientX, clientY).matrixTransform(App.svg.getScreenCTM().inverse());
  return { x: p.x, y: p.y };
};
App.docToScreen = function (x, y) {
  const p = new DOMPoint(x, y).matrixTransform(App.svg.getScreenCTM());
  return { x: p.x, y: p.y };
};

/* 图层/背景在文档坐标中的包围盒（含旋转倾斜） */
App.getItemDocBBox = function (item) {
  /* 合并分组的本地包围盒不可变（子图层不能单独编辑、图片尺寸不随换色变化）：
     缓存 getBBox 结果，大分组旋转/缩放时不再每帧强制整个子树布局 */
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
      /* 用 transform 属性链矩阵（零布局、永远最新）：getScreenCTM 返回缓存的 CTM，
         viewBox 更新后不失效（大量图层/视图变化后包围盒错位 1.3× 的根因） */
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
  /* 非 merged：用模型数据计算包围盒（零布局）。
     旧实现走 item.el.getBBox()/getScreenCTM()——单层查询会强制整棵 SVG 树同步布局，
     1942 层时切换 size 模式/手柄拖拽卡数秒（日志 5.2s 阻塞） */
  if (item.kind === 'merged') {
    /* merged 且 _localBB 不可用（getBBox 为空）：递归子层模型计算（组本地 AABB 角点），
       再套分组自身变换得到文档坐标 */
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

/* 模型计算图层文档包围盒：局部四角（-w/2..w/2）经图层变换得真实角点 + AABB。
   不触发布局（getBBox/getScreenCTM 会强制整树布局，大量图层时极慢）。
   嵌套在合并分组内的子图层：模型坐标是合并时的绝对位置，分组变换只写在分组元素上
   （移动/缩放/旋转分组只改分组自身），必须用 DOM transform 属性链（含祖先分组）换算
   文档坐标——否则子层包围盒停留在合并前位置，点击命中/视口判断全部失效 */
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

/* ---------- 编辑模式静态化：非编辑图层合成为背景位图（借鉴 Inkscape 静态位图缓存） ----------
   大量顶层图层（未合并）时编辑单层会触发整画布重绘（1942 层时旋转一步卡 ~600ms）。
   进入编辑后把非编辑图层异步烘焙成一张背景位图并隐藏原图层（DOM 保留），
   编辑中只有编辑层矢量重绘 + 一张静态位图 → 流畅；退出编辑自动恢复。
   取色器激活时恢复矢量（取色需要真实图层）。分辨率自适应（上限 4096），
   背景模糊不影响编辑精度（编辑对象始终是矢量）。 */
App.editStatic = { active: false, baking: false, items: [], bit: null, view: null, failedTop: null };
App.editStaticBgEl = null;

/* 当前视口矩形（文档坐标，含边距）——背景位图只烘视口内，放大时保持清晰 */
App.editStaticViewportRect = function () {
  const v = App.state.view;
  const r = App.wrap.getBoundingClientRect();
  const vw = r.width / (v.scale || 1), vh = r.height / (v.scale || 1);
  const padX = vw * 0.25, padY = vh * 0.25;
  return { x: v.x - padX, y: v.y - padY, w: vw + padX * 2, h: vh + padY * 2, scale: v.scale || 1 };
};
App.layerInRect = function (l, rc) {
  try {
    /* 顶层合并分组：modelBBox 用分组自身的 w/h 与锚点（合并分组 w/h 无意义、锚点远离内容），
       必须走 getItemDocBBox（本地包围盒缓存 + 分组变换） */
    const b = l.kind === 'merged'
      ? App.getItemDocBBox(l)
      : (App.modelBBox ? App.modelBBox(l) : App.getItemDocBBox(l));
    return b.x < rc.x + rc.w && b.x + b.w > rc.x && b.y < rc.y + rc.h && b.y + b.h > rc.y;
  } catch (e) { return true; }
};

/* 烘焙取图统一入口：同一轮里相同的符号/蒙版只生成一次。
   尤其是整组合并后切为蒙版的场景，旧实现会为 2000 个同源叶子各做一次
   canvas + toDataURL，再各解码一次，形成数秒主线程长任务。 */
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
  /* FH6 内嵌剪影通常为 513px。蒙版若先降到 256 再放大，全览边缘会明显糊；
     512 保留原图有效细节，再由最终视口位图按屏幕分辨率采样。 */
  if (layer && layer.isMask && layer.kind !== 'import') size = Math.max(size, 512);
  const key = App.bakeLayerSourceKey(layer, size);
  if (memo && memo.has(key)) return memo.get(key);
  let source;
  try {
    /* 历史瘦身快照可能没带 dataUri，取图前按 symbolKey 补齐。 */
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

/* 大集合按「实际图源键」只等待一次。图源生成也限并发，避免数百个蒙版 canvas
   在同一个微任务批次里同时合成/编码，拖住指针和绘制。 */
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

/* 烘焙非编辑顶层图层为一张位图（异步分片；merged 递归到叶子）。
   viewport 指定时只烘该文档矩形内的层（位图像素 ≈ 屏幕像素，放大不模糊）；
   缺省烘全部（自适应分辨率，上限 4096） */
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
      /* 位图范围：视口 = 视口矩形（层在其外部分被 canvas 裁剪）；否则 = 全部层包围盒 */
      const bx = viewport ? viewport.x : minx;
      const by = viewport ? viewport.y : miny;
      const bw = viewport ? viewport.w : Math.max(1, maxx - minx);
      const bh = viewport ? viewport.h : Math.max(1, maxy - miny);
      let f;
      if (viewport) {
        /* 边距用于平移复用，不应把可见区密度压低；以 zoom×DPR 为目标，
           再由 4096 单图上限裁定实际密度。 */
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
            /* 编辑背景沿用 data URL，生命周期由元素持有且不会留下未回收的 Blob URL。 */
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
  if (App.state.eyeMode) return; // 取色器激活：保持矢量
  const targets = App.editTargets();
  if (App.editStatic.active) {
    /* 退出编辑后静态化保持：当前编辑目标退出背景快照（避免矢量与背景重复显示），
       剩余非编辑层重烘焙背景（不恢复全部图层，不卡）。
       重烘过渡期置位图未就绪（view/bit 清空）：编辑目标矢量显示无残影，
       旧位图不残留（否则重烘完成前新目标与旧位图双显） */
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
    /* 编辑目标立即恢复矢量显示（不再隐藏） */
    targets.forEach(l => App.restoreEsVisibility(l));
    return;
  }
  if (App.editStatic.baking) return;
  /* 编辑目标必须矢量可见：可能被 autoStatic/上一轮静态化设过 visibility:hidden，
     不恢复就会「停在原位原形状」，只有再次进入编辑才恢复（用户报障的不对称） */
  targets.forEach(l => App.restoreEsVisibility(l));
  const items = s.layers.filter(l => !targets.includes(l));
  if (!items.length) return;
  App.editStatic.active = true;
  App.editStatic.items = items;
  App.editStatic.view = null;
  /* 视口内烘焙（防抖）：放大时背景保持清晰 */
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
  /* 恢复全部图层显示（只恢复静态化设置过的 visibility，不抹掉导入文件自带的数据级 visibility） */
  try { (App.state.layers || []).forEach(l => App.restoreEsVisibility(l)); } catch (e) { /* ignore */ }
};
/* 静态化隐藏/恢复的 visibility 原值管理：隐藏时记录原值，恢复时还原，
   避免无条件 removeAttribute 抹掉导入 SVG 自带的数据级 visibility="hidden" */
App.setEsHidden = function (l, hide) {
  if (!l || !l.el) return;
  if (hide) {
    if (l.el.getAttribute('visibility') === 'hidden' && l._esPrevVis !== undefined) return;
    if (l._esPrevVis === undefined) l._esPrevVis = l.el.getAttribute('visibility');
    l.el.setAttribute('visibility', 'hidden');
  } else {
    if (l._esPrevVis === undefined) return; // 不是静态化隐藏的层：不动
    if (l._esPrevVis === null) l.el.removeAttribute('visibility');
    else l.el.setAttribute('visibility', l._esPrevVis);
    delete l._esPrevVis;
  }
};
App.restoreEsVisibility = function (l) { App.setEsHidden(l, false); };

/* autoStatic 接管后整棵矢量树无需参与布局/绘制。使用 display:none 而非 visibility:hidden，
   否则 Chromium 仍会为隐藏的数千个 SVG mask 做滤镜/蒙版准备，后续任一 DOM 提交会形成长帧。
   编辑静态化仍使用上面的 visibility 管理，两套原值互不覆盖。 */
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

﻿/* ---------- autoStatic：普通模式下的「大批图层 + 全览」视口静态位图 ----------
   场景：拆分/无合并的大批量图层（如 2973 层）在画布全览时逐帧矢量光栅化 → 实测 211~375ms/帧。
   做法（复用编辑模式静态位图的思路，但独立一套，互不干扰）：
     触发 = 叶子图层数 ≥ threshold 且 view.scale ≤ maxScale 且 存在「未被代理位图覆盖的顶层」
     烘焙 = 当前视口矩形内的全部顶层（含 merged 内叶子）→ 1 张视口位图（像素≈屏幕像素）
     安装 = 位图插到 layersRoot 最底 + 全部图层 visibility hidden（DOM 保留，命中/导出/拆分不受影响）
     退出 = 放大超过 maxScale / 图层数降下来 / 进入编辑 / 取色器 / 隐藏图层 / 结构变化
   与 merged 代理分工：顶层全都有代理位图时不介入（避免与代理重复烘焙，也保住 A/B/D 三档指标）。 */
App.autoStatic = { active: false, baking: false, bit: null, view: null, token: 0, hiding: [], url: null, flashUrls: null, contentRevision: null };
App.autoStaticBgEl = null;
App.autoStaticFlashPair = null;
App.autoStaticLayerThreshold = 300;
/* 指针/滚轮交互保护：烘焙只在手势结束后的静默窗口启动；已经开始的分片也会让位。
   这只推迟缓存生成，不改变矢量显示与模型状态。 */
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
/* 触发依据 = 视口内可见图层数（不再用全局 scale 当门槛：放大到局部后视口内仍可能有几百层） */
App.autoStaticViewportPad = 1.0;
/* 总开关：2026-09-11 用户否决（放大后位图被拉伸、清晰度不足，无法正常使用）→ 默认关闭，退回纯矢量渲染。
   实现保留待改进（改进方向：位图分辨率低于屏幕需求时也要重烘，见 maybeUpgradeProxyRes 的同款口径）。 */
App.autoStaticEnabled = true;   /* 2026-09-11 方案A：重启，清晰度口径已修为「f 跟随 zoom×dpr，不足即重烘」 */   /* 烘焙范围 = 视口 ×(1+2*pad) = 视口×3 的边距比（0.5 即 2 倍面积） */


App.autoStaticLeafCount = function () {
  let n = 0;
  const layers = App.state.layers || [];
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    n += (l.kind === 'merged' && App.countInLayer) ? App.countInLayer(l) : 1;
  }
  return n;
};
/* 只要还有「没被代理位图覆盖的顶层」，autoStatic 就有意义 */
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
  /* 编辑静态化已接管时不许再上视口位图：两套机制会抢同一份 visibility（
     案底：重新进入编辑时目标图层被 autoStatic 位图压住，视觉停在原位原形状） */
  if (App.editStatic && App.editStatic.active) return false;
  if (!App.autoStaticEnabled) return false;   /* 退回：默认不启用视口静态位图 */
  if (!App.state.layers || !App.state.layers.length) return false;
  if (App.state.edit) return false;            /* 编辑模式由 editStatic 负责 */
  if (App.state.eyeMode) return false;         /* 取色器需要矢量 */
  if (App.state.layersHidden) return false;    /* 用户主动隐藏图层：不干预 */
  if (App.state.batching) return false;        /* 批量建层中 */
  /* 颜色预览/提交期间让位：位图是按【数据色】烘的，接管显示会把预览盖住
     （2026-09-12 用户报障：「ceshi这个文件没有颜色预渲染」——该工作副本 348 叶子 ≥ 阈值，
     视口位图接管后预览只改被隐藏的矢量，全屏仅 0.02% 像素变化 = 看不见） */
  if (App._colorYield) return false;
  if (!App.autoStaticNeeded()) return false;
  return App.autoStaticVisibleLeafCount() >= App.autoStaticLayerThreshold;
};
/* 视口内可见图层数（叶子口径）：顶层用 layerInRect 判可见，命中则累加其叶子数 */
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
/* 烘焙范围 = 当前视口 + pad（默认 1.0 → 边长 ×3、面积 ×9 太大；实际用 0.5 → 边长 ×2） */
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

/* 该矩形烘出来能达到的分辨率（位图像素 / 文档单位），受 4096 像素上限约束 */
App.autoStaticRectF = function (rect) {
  const dpr = window.devicePixelRatio || 1;
  /* pad 是预取区域，不应挤占可见视口的像素密度。目标密度始终按 zoom×DPR，
     只有触及单图 4096 上限时才降低密度/收窄范围。 */
  const byScreen = (App.state.view.scale || 1) * dpr;
  const byCap = 4096 / Math.max(rect.w, rect.h);
  return Math.min(byScreen, byCap);
};
App.bakeOpacity = function (layer) {
  const n = Number(layer && layer.opacity);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
};

/* Canvas 的 globalAlpha 会逐叶应用，不能表达 SVG `opacity` 对整个分组“先合成、
   后透明”的语义。下面按模型树绘制：opacity=1 的分组零额外画布；只有半透明分组
   才按其可见包围盒建立临时 surface，再以一次 globalAlpha 合回父级。 */
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
          /* Chromium 可尽早释放半透明分组的临时像素面。 */
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
/* 屏幕需要的分辨率：每文档单位多少设备像素（= zoom × dpr） */
App.autoStaticNeedF = function () {
  const dpr = window.devicePixelRatio || 1;
  return (App.state.view.scale || 1) * dpr;
};
/* 视图签名：用于跳过无意义的重算（x/y/scale 量化到视口 1/8 粒度） */
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
  /* 必须无条件清签名：否则「视图签名未变就节流跳过」会让它在结构变化后永远不再评估
     （案底：拆分分组后视口未动，eligible 明明为 true，却因签名命中旧值被跳过 → 永不烘焙） */
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
/* 从最终静态位图的 alpha 直接生成同分辨率黄/蓝剪影。只在首次烘焙阶段编码；
   选中后的每一帧只改两个 image 的 opacity，不再重算整张图的颜色矩阵。 */
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
/* 烘焙：与 bakeEditStatic 同思路，但 ① toBlob 异步编码 ② 8ms 时间预算分片 ③ 图片按 url 去重 */
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
/* 结构签名：图层 id 序列（增删/重建/换文档/导入中途合并都会变）。
   异步烘焙装图前用它校验「这张位图还属不属于当前这份画布内容」（2026-09-12 根因修复）。 */
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
      /* SVG image 的 load 只表示资源就绪；再跨两帧，确保它已进入合成树后才隐藏旧图/矢量。 */
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
        /* 双缓冲期间可能还隐藏着旧结构中的层；新位图没包含的失败层必须恢复为矢量。 */
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
        /* 透明常驻并声明 opacity 动画，让 Chromium 在用户点击前完成解码与合成层准备。 */
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
  /* 清晰度优先：默认 pad=0.5（覆盖 2× 视口，平移不露白）；
     若受 4096 上限导致 f 不足当前 zoom，收窄到只烘视口本身以提高分辨率 */
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
  const structSig = App.autoStaticStructSig();   /* 本次烘焙对应的画布结构 */
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
      /* 过期任务不能改写新一轮烘焙的状态。 */
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
    /* 装图前校验（2026-09-12 根因修复）：
       烘焙是异步的（toBlob + 分片），期间画布可能已经被换掉 —— 切标签 loadDoc、导入中途合并、
       撤销/拆分等。旧实现直接装上，于是「停在主页/切标签之后画布显示的是别的图案」，而且要等
       下一次视图变化（用户手动缩放/刷新）才会被释放 → 用户报障「调一下缩放刷新一下又回来了」。
       两道校验：①结构签名（位图是否属于当前这份图层）；②覆盖范围（当前视口需求是否仍被这张
       位图覆盖，内容包围盒变了就说明几何已过期）。不合格=丢弃，不留残图。 */
    const install = function () {
      if (token !== App.autoStatic.token) { drop('superseded', false); return; }
      if (App.renderInteractionBusy && App.renderInteractionBusy()) { setTimeout(install, 60); return; }
      if (contentRevision !== (App.contentRevision || 0)) { drop('stale-content', true); App.autoStaticSchedule(); return; }
      if (structSig !== App.autoStaticStructSig()) { drop('stale-struct', true); App.autoStaticSchedule(); return; }
      if (viewRevision !== (App.viewRevision || 0)) { drop('stale-view', true); App.autoStaticSchedule(80); return; }
      if (!App.autoStaticEligible()) { drop('stale-ineligible', true); return; }
      /* 覆盖校验用 pad=0（只要求覆盖「当前视口」本身）：本函数上面在受 4096 上限时会故意把
         pad 收到 0 换分辨率，拿 pad=0.5 的需求矩形去比会把这类合法烘焙全部误杀。 */
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
          /* view 与 bit 必须作为同一次安装一起提交；预解码/双 rAF 期间继续保留旧
             view+bit，避免监测与覆盖判断把“待安装高清图”误当成已经显示。 */
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
    /* 新位图先在独立 Image 中完成解码，再一次性改几何/href 并隐藏矢量。
       这样首次接管和放大重烘都不会出现一帧空白或旧图被新几何拉偏。 */
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

/* 防抖排期：视图变化即重置定时器；到期后【无条件】按当前视图重烘
   （上一版把它与「视图签名节流」叠加，导致 timer 被反复重置、永不执行 —— 这里只保留防抖） */
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
    /* 节流窗口内的这次视图变化不能丢：安排尾随检查
       （否则「动作停止前最后一次 updateView」被吞 → 位图永不重烘 → 放大后一直模糊） */
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
    /* 烘焙进行中也不能吞掉「已经不合格」这件事：换文档/结构变化发生在烘焙期间时，
       这里的 release（token++）会让在途结果作废，否则那张属于上一份内容的位图会装到
       新文档的画布上（2026-09-12 报障根因：切标签后画布显示的是别的图案，缩放才恢复）。 */
    if (!App.autoStaticEligible()) { App.autoStaticRelease(); return; }
    return;
  }
  if (!App.autoStaticEligible()) { if (App.autoStatic.active) App.autoStaticRelease(); return; }
  if (!App.autoStatic.active || !App.autoStatic.view) { App.autoStaticRebake(); return; }
  /* 位置（旧图是否仍覆盖当前视口）与清晰度（f 是否够当前 zoom）任一不足 → 防抖重烘 */
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

/* 结构变化（合并/拆分/删除/撤销/导入等）时清除静态化：背景快照失效，恢复全部图层 */
App.invalidateEditStatic = function () {
  if (App.editStatic && App.editStatic.active && App.endEditStatic) App.endEditStatic();
  /* 结构变化同样让 autoStatic 视口位图失效（图层增删/合并/拆分/撤销/导入） */
  if (App.autoStaticRelease) App.autoStaticRelease();
  /* 静态化已拆除：让视口位图重新评估接管（大文件性能保护不丢） */
  if (App.autoStaticMaybe) App.autoStaticMaybe();
};
/* 内容变化（图层增删/重排/合并/删除）后的统一收尾：位图缓存必须失效并按新内容重绘。
   用户口径（2026-09-12）：「记得每次操作渲染都要更新」——案底：删图层后模型与图层栏都更新了，
   但 autoStatic 视口位图不失效（它只按视口覆盖/分辨率判重烘，无内容判定），画布上仍显示含已删图层的旧位图。 */
App.contentChanged = function (options) {
  if (App.state.batching) return;   /* 批量期间不逐次失效（入口结束时由各路径统一刷） */
  App.contentRevision = (App.contentRevision || 0) + 1;
  const preserveRequested = !options || options.preserveAutoStatic !== false;
  const preserve = !!(preserveRequested && App.autoStatic && App.autoStatic.active &&
    App.autoStaticEligible && App.autoStaticEligible());
  if (preserve) {
    /* 稳态内容更新走双缓冲：旧位图继续遮住矢量，新内容离屏烘好并预解码后原子换上。
       新增层也先隐藏，避免它在旧底图上提前出现；删除/重排则在新图落地时一次生效。 */
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
  /* 内容刷新只同步覆盖层，不能重播选中动画；大分组会因此整幅黄蓝闪一下。 */
  if (App.requestFlashRefresh) App.requestFlashRefresh(false);
};
/* 视口内背景烘焙（防抖）：编辑静态化只烘当前视口内的非交互层，
   位图像素 ≈ 屏幕像素 → 放大视图背景依然清晰（不再模糊）。
   退出编辑后只烘"交互层下方"的层（上方层保持矢量显示，z 顺序正确） */
App.rebakeEditStaticViewport = function () {
  if (!App.editStatic || !App.editStatic.active) return;
  if (App._editStaticViewTimer) clearTimeout(App._editStaticViewTimer);
  const token = ++App._editStaticToken; // 过期烘焙丢弃：重烘在途时 items/视口已变，旧结果不安装
  App._editStaticViewTimer = setTimeout(() => {
    App._editStaticViewTimer = null;
    try {
      if (!App.editStatic.active) return;
      if (App.renderInteractionBusy && App.renderInteractionBusy()) { App.rebakeEditStaticViewport(); return; }
      const vp = App.editStaticViewportRect();
      let items = App.editStatic.items.filter(l => App.layerInRect(l, vp));
      /* 只烘"交互层下方"的层（编辑中/退出后一致）——上方层保持矢量显示，层序正确；
         与 updateEditStaticViewport 的隐藏集合严格一致，不会隐藏了却没烘 */
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
        /* 背景为空（无交互层下方层）：view 标记为当前视口（items 为空不会隐藏任何层），
           避免 updateEditStaticViewport 视口检测反复触发重烘焙；清背景并恢复全部显示 */
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
        if (!App.editStatic.active || token !== App._editStaticToken) return; // 过期烘焙：丢弃
        if (!bit) {
          /* 烘焙失败：恢复全部显示 + 清旧背景（否则图层带着旧隐藏状态残留 → 缺层） */
          failCurrent('bake-returned-null');
          return;
        }
        if (!(bit.f > 0) || bit.f < (App.state.view.scale || 1) * (window.devicePixelRatio || 1) * 0.8) {
          failCurrent('stale-quality');
          App.rebakeEditStaticViewport();
          return;
        }
        /* 新背景用独立 image 预装；load + 双 rAF 后再一次性替换旧背景并隐藏矢量，
           避免先改旧图几何/href 导致过渡帧缺层或拉伸。 */
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
            /* 烘焙完成后隐藏"烘焙视口内、交互层下方"的非交互层。 */
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
/* 视口/交互刷新：交互层（白框/选中/编辑目标）显示矢量。
   隐藏判定与烘焙严格一致（借鉴 Inkscape 缓存一致性原则）：
   - 用"烘焙时的视口"（editStatic.view）判定隐藏，被隐藏的层一定烘进了背景位图，不会缺层；
   - 背景未就绪（view 为空）时不隐藏任何层（全部矢量显示，绝无"隐藏了但没烘"）；
   - 只隐藏"交互层下方"的层（编辑中/退出后一致）——上方层保持矢量显示，
     按 DOM 顺序渲染在交互层之上，z 序正确（编辑下层不再盖住上层）；
   - 烘焙失败的叶子所属顶层不隐藏（背景里没有它）。
   实时视口变化只触发防抖重烘焙（收敛），不直接隐藏未烘的层 */
App.updateEditStaticViewport = function () {
  if (!App.editStatic || !App.editStatic.active) return;
  const s = App.state;
  if (!s || !s.layers) return;
  const es = App.editStatic;
  let interMinNow = -1;
  if (es.view && es.bit) {
    /* 背景位图已就绪：按烘焙视口隐藏（与烘焙集合一致，不缺层）。
       位图未就绪（bit 为空：烘焙中/失败/空背景）时不隐藏任何层 */
    const box = App.whiteBoxLayer ? App.whiteBoxLayer() : null;
    const editItems = (s.edit && App.editTargets) ? App.editTargets() : [];
    /* 交互层最低索引：其下方层进背景，上方层保持矢量（z 序正确）。
       隐藏判定用【已烘焙时的 interMin】（_bakedInterMin）：白框/选中变化后、
       重烘完成前，隐藏集合与旧背景保持一致（不缺失、不双显） */
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
      /* 隐藏条件：非交互 + 在快照中 + 烘焙视口内 + 位于【已烘焙】交互层下方 + 烘焙成功 */
      const hide = !inter && inItems && inView && (interMin < 0 || i < interMin) &&
        !(es.failedTop && es.failedTop.has(l.id));
      App.setEsHidden(l, hide);
    }
  }
  /* 交互层最低索引变化（白框/选中/编辑目标移动）：背景按新交互集重烘；
     防抖合并快速滚动，烘焙完成前隐藏集合保持旧值（见上） */
  if (es.view && es._bakedInterMin !== undefined && es._bakedInterMin !== interMinNow) {
    App.rebakeEditStaticViewport();
  }
  /* 实时视口/缩放变化：防抖重烘焙（背景按新视口，保持清晰）；
     背景未就绪（view 为空）时也触发：烘焙失败后允许重试 */
  const vpNow = App.editStaticViewportRect();
  if (!es.view || Math.abs(es.view.x - vpNow.x) > 5 || Math.abs(es.view.y - vpNow.y) > 5 ||
      Math.abs(es.view.scale - (App.state.view.scale || 1)) > 0.05) {
    App.rebakeEditStaticViewport();
  }
};
/* 编辑静态化：从快照移除某图层（删除/合并/拆分后背景不残留） */
App.dropEditStaticItem = function (layer) {
  if (!App.editStatic || !App.editStatic.active || !layer) return;
  const idx = App.editStatic.items.indexOf(layer);
  if (idx >= 0) {
    App.editStatic.items.splice(idx, 1);
    /* 恢复该层的静态化隐藏（否则残留 visibility:hidden：合并时整组空白） */
    App.restoreEsVisibility(layer);
    /* 立即隐藏旧背景位图：防抖重烘完成前不显示被删层的"幽灵"残影 */
    if (App.editStaticBgEl) App.editStaticBgEl.style.display = 'none';
    App.rebakeEditStaticViewport();
  }
};
/* 编辑模式外框：大小模式下只画手柄（蓝框已按需求移除，避免遮挡视野；
   拖动图案中心区域移动的交互仍按几何判定保留） */
App.drawOutlines = function () {
  /* 普通模式本来就不画蓝框/手柄。空组上反复写 innerHTML 仍会让 Chromium
     把整棵 2000 叶 SVG 标成需重绘，单次可形成数百毫秒原生长帧。 */
  if (!App.state.edit && !App.outlineG.firstChild && !App.handleG.firstChild) {
    App.outlinePolys = [];
    if (App.anchorIconEl) App.anchorIconEl.style.display = 'none';
    return;
  }
  App.outlineG.innerHTML = '';
  App.outlineG.setAttribute('pointer-events', 'none');
  App.handleG.setAttribute('pointer-events', 'none');
  App.outlinePolys = [];
  /* 手柄与方向指示互相独立：手柄显示开关只管 8 个手柄（关时不绘制、鼠标无法命中）；
     方向指示按 axisHint 单独绘制（手柄隐藏后仍显示 W/A 箭头，键盘缩放方向提示不丢）。
     正在放置锚点时手柄与其命中区一并隐藏（放置点击不能被手柄吃掉），方向指示照旧 */
  App.handleG.innerHTML = '';
  if (App.state.edit && App.state.editMode === 'size') {
    if (App.state.showHandles !== false && !App.state.anchorPlacing) App.drawHandles();
    if (App.state.axisHint) App.drawAxisArrows();
  }
  /* 缩放锚点图标：只改自身 transform/显隐，不重建（合并动画不被打断），不触发文档重绘 */
  if (App.drawAnchorIcon) App.drawAnchorIcon();
  /* 编辑中：本次改动（移动/大小/旋转/倾斜/透明度）必须同步到闪动覆盖层，
     否则闪烁副本停在进入编辑时的位置与大小。走轻量同步，不走整份刷新 */
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

/* 手柄几何：单个目标取图案变换后的真实角点/边中点（随旋转倾斜），多选取包围盒 */
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

/* 手柄屏幕像素尺寸（视觉 = 命中）：默认 9px；图层在屏幕上很小时
   （包围盒屏幕短边 < 36px）手柄随图层同步缩小（短边/4），下限 3px——
   小图层 8 个手柄不再挤成一团；图层正常大小或放大视图后自动回到 9px */
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
  const hpx = App.handleSizePx(g.box); // 命中区与视觉方块同尺寸（判定不再大于视觉）
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

/* W/A 缩放方向指示：独立于手柄显示开关绘制（手柄隐藏时方向指示仍可用）。
   W 沿本地竖直向上、A 沿本地水平向左（随旋转转动，取自实时变换矩阵） */
App.drawAxisArrows = function () {
  const g = App.handleGeometry();
  if (!g) return;
  if (!App.state.axisHint) return;
  const sc = App.state.view.scale || 1;
  const items = App.editTargets();
  const c = { x: g.cx, y: g.cy };
  const L = 30 / sc, head = 7 / sc;
  let axes = [[0, -1], [-1, 0]]; // 默认：W 上、A 左
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

/* 选中/白框闪烁：图案 #FFFA01（黄）→ #0402FF（蓝）渐变，0.3 秒内完成，每 5 秒一次。
   覆盖层按图层 id 增量维护（复用 DOM，不每周期重建），颜色用 CSS 变量一次性切换——
   大量图层选中时不再卡顿。目标 = 全部选中图层 ∪ 白框所在图层（白框移动立即闪动提示）。 */
App.flashTimers = [];
App.flashSeq = 0;
App.flashColor = null;
App.flashOverlayMap = new Map(); // 图层 id -> {kind, el}
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
/* 合成闪动的 PNG 直接以 Blob URL 挂到 SVG image；覆盖层销毁时一并回收。
   避免把大 PNG 再复制成 base64 字符串，并消除随后集中回收大字符串造成的长帧。 */
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
  /* 新选择先立即闪一次；周期从这次闪动重新起算，避免沿用旧计时器导致间隔忽长忽短。 */
  App.ensureFlashRunning(true);
  App.updateFlashOverlays();
};
App.stopFlash = function () {
  if (App.state.flashTimer) { clearInterval(App.state.flashTimer); App.state.flashTimer = null; }
  if (App.compRebuildTimer) { clearTimeout(App.compRebuildTimer); App.compRebuildTimer = null; }
  App.flashTimers.forEach(t => { cancelAnimationFrame(t); clearTimeout(t); });
  App.flashTimers = [];
  App.flashSeq++;
  App.compFlashToken++; // 作废进行中的合成闪动
  /* 清除在途签名/动画意图，否则同一集合再次请求会命中旧锁，且旧回调
     被 token 丢弃后无人负责解锁。 */
  App.compBuildSig = null;
  App.compBuildAnimate = false;
  App.compAlignCheckToken++; // 作废进行中的分片偏差自检
  App.flashColor = null;
  App.flashOverlayMap.forEach(App.releaseFlashOverlay);
  App.flashG.innerHTML = '';
  App.flashG.style.display = 'none';
  App.flashOverlayMap.clear();
};

/* 单个图层的闪动覆盖层（symbol/pattern 用轻量 rect；import/merged 克隆原内容） */
App.buildFlashOverlayFor = function (layer) {
  const t = layer.el.getAttribute('transform');
  const op = layer.el.getAttribute('opacity');
  if (layer.kind === 'symbol') {
    const g = svgEl('g', { transform: t, opacity: op, 'pointer-events': 'none' });
    /* 闪动覆盖层自带蒙版（普通符号图层已无蒙版，避免影响画布渲染性能） */
    const m = svgEl('mask', {
      id: 'sveFM' + layer.id, maskUnits: 'userSpaceOnUse',
      x: -layer.w / 2, y: -layer.h / 2, width: layer.w, height: layer.h
    });
    if (layer.dataUri) {
      /* 蒙版直接用原始图并按图层当前 w/h 拉伸——与图案 imgEl 显示完全一致。
         不能用共享 def（#sveImg 是原始尺寸）：更换图案后图层 w/h 保持旧尺寸
         （"更换保持大小"），def 尺寸与图层尺寸不同会导致蒙版裁剪/形状与图案不符 */
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
    /* 合并分组：逐个孩子递归生成各自覆盖层（符号=剪影精确染色，图案/导入=原样染色），
       整组覆盖 = 集体闪烁；不再整组克隆（克隆出的符号 <image> 无 fill 染不上色） */
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

/* 合成闪动：把集合/合并分组的全部图案剪影一次性画到离屏画布，
   只生成 1 个蒙版 + 1 个矩形（动画每帧只变色一个矩形，与图案数量无关）。
   单个合并分组：画在分组本地坐标，拖动时只同步外框变换、不重算剪影；
   多选集合：画在文档坐标，集合变化时重新合成一次。
   位置一律用 transform 属性链（纯用户空间）计算——不能用 getCTM()：
   getCTM 返回视口空间矩阵（含 viewBox 的平移/缩放），而蒙版/矩形
   按 userSpaceOnUse 解释（用户空间），一旦画布平移缩放（viewBox 非恒等），
   合成动画就会整体偏离原图层。 */
App.compFlashToken = 0;
/* 解析 SVG transform 属性为 DOMMatrix（支持 translate/scale/rotate(含中心)/skewX/skewY/matrix） */
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
/* 元素自身起、沿父链上溯到 layersRoot 为止的 transform 属性乘积（用户空间文档矩阵） */
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
App.transformChainMat = transformChainMat; // 暴露给命中检测（零布局坐标换算）
App.buildCompositeFlash = function (items) {
  App.__compBuildT0 = performance.now();
  const isMerged = items.length === 1 && items[0].kind === 'merged';
  /* 代理快速路径：已烘出整幅底图的合并分组直接用底图的白色剪影蒙版——
     不再逐叶生成剪影、不做同步 toDataURL 编码（2000 叶文档操作期间的主要卡顿源） */
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
    /* 每个叶子相对合成根空间的真实矩阵：transform 属性链（用户空间，嵌套分组自身变换不丢失；
       与 viewBox/窗口缩放无关，合成位置永不错位）；
       根 = 合并分组（其本地空间，外框变换随拖动同步）；多选集合根 = 文档坐标（恒等） */
    const rootM = isMerged && items[0].el ? transformChainMat(items[0]) : null;
    const mats = leaves.map(l => {
      const m = transformChainMat(l);
      if (rootM) {
        try { return rootM.inverse().multiply(m); } catch (e) { return m; }
      }
      return m;
    });
    /* 大集合分片构建（每片 300 层）：包围盒与绘制循环不再一次性占满主线程，
       千层文档（如 2096 层）合成构建期间界面保持可交互，不再卡顿吞操作 */
    const BUDGET = 8, MIN_CHUNK = 8;
    const token = App.compFlashToken;
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    let bi = 0, di = 0, bw = 0, bh = 0, f = 1, cv = null, cx = null;
    const bboxStep = () => {
      if (App.compFlashToken !== token) return resolve(null); // 选择已变化：作废本次构建
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
          /* 画布坐标系 = (doc - (minx,miny)) × f：平移量必须与缩放同序（先乘 f 再平移）。 */
          const T = new DOMMatrix().translate(-minx * f, -miny * f).scale(f).multiply(mats[di]);
          cx.setTransform(T.a, T.b, T.c, T.d, T.e, T.f);
          cx.drawImage(entry.canvas, entry.rect.x, entry.rect.y, entry.rect.w, entry.rect.h,
            -(l.w || 0) / 2, -(l.h || 0) / 2, l.w || 0, l.h || 0);
          cx.restore();
        }
        di++; n++;
      }
      if (di < leaves.length) { setTimeout(drawStep, 0); return; }
      /* 蒙版位图必须保持透明背景（无底色填充）：任何底色都会让位图全不透明，
         蒙版失效、闪动层变成覆盖整个包围盒的实心矩形（旋转图层的盒子并集远大于
         图案内容，视觉上就是"闪动偏离图案坐标"，且矩形框位置按模型是对的，
         偏差自检也无法发现）。只画剪影本身，透明处即蒙版透明处。 */
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
        /* 蒙版/矩形必须放在并集的真实位置 (minx, miny)。 */
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
      /* 编码放到浏览器异步路径，避免 cv.toDataURL() 在 2000 叶选择/刷新时同步卡住 UI。 */
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

/* 合成覆盖层偏差自检（兜底保险丝）：复用路径下核对合成矩形与叶子实际渲染位置，
   任何原因导致的偏离都会在节流内被发现并强制重建——确保“自动检测组成形状，
   只算一次”的动画永不偏离原图案。期望包围盒与合成构建同源（transform 属性链，
   纯矩阵运算，不触发布局） */
App.compAlignCheckAt = 0;
App.compAlignDrift = 0;
App.compAlignCheckToken = 0;
App.checkCompositeAlign = function (items, rec, sig, animate) {
  const now = performance.now();
  if (now - App.compAlignCheckAt < 2000) return false; // 2 秒节流：快速多选时不重复扫描
  App.compAlignCheckAt = now;
  if (!items.length || !rec) return false;
  const rect = rec.el.querySelector('rect');
  if (!rect) return false;
  /* 期望文档包围盒：全部叶子按 transform 链展开角点并集。
     2000 叶同步扫描会在覆盖层刚显示时制造 100ms+ 长帧；按 6ms 预算分片，
     保留同样的错位保险丝，但不再抢占交互帧。 */
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
    /* 矩形文档位置：rect 在根空间，乘合成 g 的【实际】变换链
       （合并分组 g 有 transform；多选集合应无。用实际值才能发现 g 上任何错位） */
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
    /* 偏离：先隐藏旧覆盖层，再防抖重建，错误位置不会继续闪。 */
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

/* 闪动覆盖层的内容指纹：更换图案（symbolKey/patternKey 变化）时强制重建，
   否则 updateFlashOverlays 会因 kind 未变而复用旧图案的覆盖层（闪烁仍是原图案） */
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

/* 闪动目标集合：白框所在图层必闪；白框在多选集合内时，全部多选图层一起闪
   （唯一口径，updateFlashOverlays 与编辑中的轻量同步共用，不许各写一套） */
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

/* 编辑中的轻量闪动同步：只把覆盖层的 transform/opacity 跟到图层当前字段。
   编辑每帧都会调用，必须绕开 updateFlashOverlays 里的重活
   （refreshImpBitmaps / updateEditStaticViewport 都是 O(图层数)，逐帧调会拖垮编辑）。
   案底：编辑里移动/缩放/旋转后，闪动覆盖层仍停在进入编辑时的位置与大小。 */
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

/* 增量刷新覆盖层：白框所在图层必闪；白框在多选集合内时，全部多选图层一起闪；
   白框不在多选集合内时只闪白框图层（鼠标点击其他图层定位白框后，
   多选图层不跟随闪烁；框选操作后白框会自动归位到框选集合内）。
   图案总数 ≤400：每个图案单独渲染动画；>400：优先直接给当前整图缓存换色，
   无法独占整图缓存时才异步合成一张剪影，任何路径都不逐叶播放动画。
   animate=false 时只同步位置/增删，不重启动画 */
App.updateFlashOverlays = function (animate) {
  /* 白框/选中/编辑变化：同步 import 位图化显示（交互层恢复矢量、其余用位图） */
  if (App.refreshImpBitmaps) App.refreshImpBitmaps();
  /* 退出编辑后静态化保持：交互层恢复矢量显示、视口内非交互层用背景位图 */
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

    /* 单个 ×2000 分组占据整份画布时，autoStatic 已经是最终清晰画面。
       直接给这一个 image 做颜色矩阵动画：零新增全屏覆盖图、零逐叶工作，也不存在坐标偏移。 */
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

    /* 不是整画布目标时走现有的单剪影异步合成；同一签名在途只保留一份任务。 */
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
  /* ---------- 每个图案单独渲染（≤400 层）---------- */
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
      /* 复用 DOM：只同步 transform/opacity（编辑操作拖拽/按键时闪动同步跟随） */
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
  /* 一次 CSS 变量切换改变全部覆盖层颜色（不再逐元素 setAttribute） */
  App.flashG.style.setProperty('--sve-flash-color', c);
  const direct = App.flashOverlayMap.get('__composite__');
  if (direct && direct.kind === 'auto-static-direct') App.applyDirectFlashColor(direct, c);
};
function mixRGB(a, b, p) {
  /* p 必须夹在 [0,1]：rAF 的 now 是本帧起始时间，animateFlash 可能在同一帧内被调用，
     首帧 now - t0 会为负 → 外插出 rgb(260,255,-4) 这类越界色（判子实测踩到） */
  const t = p < 0 ? 0 : (p > 1 ? 1 : p);
  return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * t) + ',' +
    Math.round(a[1] + (b[1] - a[1]) * t) + ',' +
    Math.round(a[2] + (b[2] - a[2]) * t) + ')';
}
App.flashNow = function () {
  App.updateFlashOverlays();
};
/* 动画：#FFFA01 → #0402FF 渐变 0.3 秒，结束后隐藏覆盖层（保留 DOM，下个周期无需重建） */
App.animateFlash = function (opts) {
  /* 隐藏图层时：覆盖层保持隐藏（flashG 与 layersRoot 平级，隐藏图层盖不住它，
     定时周期/交互触发都不能把它重新点亮） */
  if (App.state && App.state.layersHidden) { App.flashG.style.display = 'none'; return; }
  /* 任何立即闪动都从此刻重置 5 秒倒计时；周期调用自身不重置，因而稳定保持 5 秒。 */
  if (!(opts && opts.periodic)) App.ensureFlashRunning(true);
  /* 白框变化检测：白框移动后某些路径未刷新闪烁覆盖层（Tab+点击等），
     每次闪烁前先同步（白框变了才重建，开销小） */
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
    /* 静默刷新会故意不预建覆盖层；真正到下一次闪动时再建立，异步完成后自行播放。 */
    const box = App.whiteBoxLayer ? App.whiteBoxLayer() : null;
    if (box && !App.compRebuildTimer) setTimeout(function () { App.updateFlashOverlays(true); }, 0);
    return;
  }
  /* 周期自检：离屏合成覆盖层若与图案偏离，立即强制重建。直接缓存路径天然同位，无需扫描。 */
  const crec = App.flashOverlayMap.get('__composite__');
  if (crec && crec.kind === 'composite' && crec.items) App.checkCompositeAlign(crec.items, crec, crec.sig);
  App.flashG.style.display = crec && crec.kind === 'auto-static-direct' ? 'none' : '';
  const colors = [[255, 250, 1], [4, 2, 255]]; // #FFFA01 → #0402FF
  const seq = ++App.flashSeq;
  App.flashTimers.forEach(t => { cancelAnimationFrame(t); clearTimeout(t); });
  App.flashTimers = [];
  App.applyFlashColor('rgb(' + colors[0].join(',') + ')'); // 起始 #FFFA01：瞬时（无渐变）
  const t0 = performance.now();
  const duration = App.flashDurationMs || 300;
  const seg1 = t0 + duration; // #FFFA01 → #0402FF 渐变，0.3 秒内完成
  const step = now => {
    if (seq !== App.flashSeq) return;
    if (now < seg1) {
      App.applyFlashColor(mixRGB(colors[0], colors[1], (now - t0) / duration));
      App.flashTimers.push(requestAnimationFrame(step));
    } else {
      const current = App.flashOverlayMap.get('__composite__');
      if (current && current.kind === 'auto-static-direct') App.restoreDirectFlash(current);
      App.flashG.style.display = 'none'; // 隐藏覆盖层：瞬时（无渐变），DOM 保留复用
      App.flashColor = null;
    }
  };
  App.flashTimers.push(requestAnimationFrame(step));
};

/* ---------- 缩略图 ---------- */
const imgCache = new Map();
const silhouetteCache = new Map();
/* 把 data URL 转成 Blob：fetch(dataURL) 的 base64 解析在渲染线程极慢（1.8s+），
   手动 atob 解析亚毫秒级（大量图层性能关键） */
function dataUrlToBlob(uri) {
  const comma = uri.indexOf(',');
  const mime = (uri.slice(5, comma).split(';')[0]) || 'image/png';
  const bin = atob(uri.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
/* 解码符号位图：createImageBitmap（后台线程解码，不阻塞主线程）——
   loadImage 对 data URL 的 JPEG 解码会占满渲染线程（千层合成首次构建卡死数秒的根因） */
App.decodedImage = function (uri) {
  if (!imgCache.has(uri)) {
    const p = (window.createImageBitmap
      ? Promise.resolve().then(() => createImageBitmap(dataUrlToBlob(uri))).catch(() => loadImage(uri).catch(() => null))
      : loadImage(uri).catch(() => null));
    imgCache.set(uri, p);
  }
  return imgCache.get(uri);
};
/* 大文件导入后的抢占式符号预热已停用。旧实现每 40ms 在编辑器线程解码、染色一张图，
   两三千层文件会持续数秒制造 60~130ms 长帧，正好撞上导入后的首次操作。
   autoStatic 首次烘焙已按实际可见内容生成所需图源，后续闪动也直接复用该位图。 */
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
/* 与图层 transform 同序：先 skewX，再 scale（含翻转负号），再 rotate（本地轴缩放随旋转） */
function tfPoint(x, y, f) {
  let px = x + Math.tan(f.skew * D2R) * y;
  let py = y;
  px *= f.sx * (f.flipH ? -1 : 1); py *= f.sy * (f.flipV ? -1 : 1);
  const a = f.rot * D2R, c = Math.cos(a), s = Math.sin(a);
  return [px * c - py * s, px * s + py * c];
}
/* 分析式计算图层内容的本地包围盒（不依赖 getBBox，合并图层克隆体 getBBox 会返回空） */
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
/* 把基础图（canvas + 内容矩形）按图层旋转/倾斜/缩放绘制到 48px 缩略图 */
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
/* 符号剪影基础图（亮度->透明度 + 颜色），按 uri+颜色+尺寸缓存。
   并发去重：同一 key 的多次调用（如千层同符号的合成构建）共享同一个生成 promise，
   避免 2096 层各自重复执行像素循环（之前会阻塞主线程数秒） */
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
    /* 像素染色分片：大量符号并发生成时不占满主线程 */
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
/* 蒙版显示开关：true = 画布/缩略图中蒙版不再显示灰色网格（改为透明）；
   false（默认=原状） = 蒙版显示灰棋盘格指示 */
const MASK_INDICATOR_TRANSPARENT = false;
/* 蒙版指示基础图（随背景主题；透明模式下为空白透明画布） */
App.maskIndicatorCanvas = function (size) {
  const themeKey = App.maskThemeKey();
  const key = 'ind:' + themeKey + ':' + size + (MASK_INDICATOR_TRANSPARENT ? ':t' : '');
  if (silhouetteCache.has(key)) return silhouetteCache.get(key);
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  if (MASK_INDICATOR_TRANSPARENT) {
    silhouetteCache.set(key, c);
    return c; // 透明蒙版：不画网格
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
/* 位图接管中的蒙版纹理必须保持 SVG 的 userSpaceOnUse 语义。
   通用缩略图固定画 8x8 格；若直接拿来铺图层，图层越大格子就越粗，接管瞬间会明显跳变。
   这里把图案原点固定在图层本地 (0,0)，并按图层实际宽高映射到源画布。 */
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
  /* 源图案的内容组 translate(.5,.5)：矩形描边正好落在每个 11x11 单元边界上。 */
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
/* 蒙版符号缩略图基础图：棋盘格 × 符号亮度（剪影），按主题缓存 */
/* 蒙版图层在【位图烘焙】里的取图：必须与 DOM 显示一致 —— 棋盘格指示图案，
   symbol 蒙版再按剪影裁形（DOM 是 指示图案矩形 + mask=剪影），pattern 蒙版铺满整个矩形。
   import 蒙版不走这里（它的 markup 已被 styleImportAsMask 换成指示图案，交给 svgRasterThumb）。
   案底（用户报障「渲染会把蒙版识别成图层并渲染」）：两个烘焙只按 kind 取图
   （symbol → App.symbolColorUrl），蒙版层被当成普通图案按自身颜色画进了位图。 */
/* 蒙版缩略图的底图：【棋盘格 ∩ 剪影】，与 DOM 显示和烘焙取图同一口径。
   案底（用户报「缩略图的蒙版渲染也会变成图层」）：symbol 蒙版原来走 maskSilhouetteCanvas，
   画出来是剪影本身 → 在图层栏里看着和普通图案一样，分不出这是蒙版。
   返回 {canvas, rect}：rect 取剪影的内容盒，让缩略图保持「形状贴边」的取景（与普通层一致）。 */
App.maskThumbEntry = async function (layer, size) {
  size = size || 96;
  const ind = App.maskIndicatorCanvas(size);
  const entry = layer.dataUri ? await App.silhouetteCanvas(layer.dataUri, '#ffffff', size) : null;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const cx = c.getContext('2d');
  if (ind) cx.drawImage(ind, 0, 0, size, size);
  if (entry && entry.canvas) {
    cx.globalCompositeOperation = 'destination-in';   /* 棋盘格按剪影裁形 */
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
  if (MASK_INDICATOR_TRANSPARENT) return Promise.resolve("");   /* 透明蒙版主题：本就不该画 */
  const key = App.maskBakeUrlKey(layer, size);
  if (App.maskBakeUrlCache.has(key)) return App.maskBakeUrlCache.get(key);
  const promise = Promise.resolve().then(function () {
    const ind = App.maskBakeIndicatorCanvas(layer, size);
    if (!ind) return "";
    if (layer.kind !== "symbol" || !layer.dataUri) return App.canvasPngUrl(ind, 'mask-indicator');
    /* DOM 蒙版里的 <image preserveAspectRatio="none"> 会把源图强制铺满图层框。
       这里也先铺满方形源画布；若用 silhouetteCanvas 的 contain 取景，非方形 JPEG
       会被额外留白，放大后蒙版笔画就会变细、断裂，和矢量真值明显不一致。 */
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
/* 填充图案基础图 */
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

/* 图案库缩略图：白色剪影（64px 图标） */
App.libThumb = function (symbol) {
  if (symbol.thumb) return Promise.resolve(symbol.thumb);
  return App.silhouetteCanvas(App.symbolUri(symbol), '#ffffff', 64).then(entry => {
    if (!entry) return '';
    symbol.thumb = entry.canvas.toDataURL();
    return symbol.thumb;
  });
};

/* 导入/合并图层：SVG 光栅化（含旋转倾斜、子图层相对位置与颜色）；size 为输出方图边长。
   结果按图层缓存（thumbDirty 时失效）：快速多选/合成重建时同一图层不重复加载，
   避免数百个异步栅格反复生成导致卡顿 */
/* 合并分组的缩略图：逐叶子【canvas 合成】，不走"整组序列化成 SVG 再光栅化"。
   案底（用户报障）：导入生成的 SVG 后取消分组，里面的小分组在图层栏没有缩略图 ——
   那些组的子层被压成发丝级细条（实测 sx≈0.0071），SVG 光栅化会把亚像素宽的 <image> 整块剔掉
   （实测该口径下 ink 0%、714B 空图；同一组 canvas 逐层 drawImage 则 ink 18%，与画布放大后的 18.32% 一致）。
   取图口径与烘焙一致（含蒙版指示图案），透明度逐层带。 */
/* 缩略图专用：把「蒙版形状」改写成【挖空】（只影响缩略图显示，不改导出文件、不改画布渲染）。
   语义（用户 2026-09-12 口径）：蒙版把【位于它下面的图层】在它的剪影范围内擦掉，露出缩略图底下的空白网格。
   做法：给该蒙版之前的兄弟节点套 <g mask="url(#sveKnockN)">；掩膜 = 白底 + 一份“涂黑”的蒙版副本
   （导出串里蒙版形状的填充是 mask_indicator_* 图案，副本 fill 改黑即得剪影）；蒙版自身不再绘制。
   识别口径与导入侧一致：id 以 mask 开头 / fill 含 mask_indicator / data-forza-mask-group="1"。 */
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
/* 合并缩略图的真实几何：直接沿离屏模型树累乘变换，不要求先创建数千个隐藏 DOM 节点。
   根分组自身变换不计入缩略图，子分组的平移/旋转/缩放全部计入包围盒。 */
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
      /* 蒙版：不画自己，而是把【下面已画的图层】在它的剪影范围内挖空（露出空白网格）。
         取图口径仍是 maskBakeUrl（其 alpha = 剪影形状），destination-out 按 alpha 擦除。 */
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
    /* import 位图化模式：矢量组被 display:none 隐藏，克隆光栅化前恢复显示 */
    $$('[style]', clone).forEach(el => { if (el.style && el.style.display === 'none') el.style.display = ''; });
    /* 代理烘焙会把分组子层 visibility:hidden：克隆光栅化前恢复（否则 import 叶子
       在编辑静态化背景中缺失——代理是渲染优化，光栅化要按"层可见"来烘） */
    $$('[data-layer]', clone).forEach(el => el.removeAttribute('visibility'));
    /* 彩色剪影 PNG 可能尚未异步就绪：补填 href 后再光栅化 */
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
    /* 合并分组：模型字段算出的本地框可能与实际画出来的几何错位（导入的矢量形状
       x/y 与 DOM transform 不同源），会让组缩略图只画出一部分或整体偏出去
       （案底：4 方块夹具的组缩略图只露红色，均色 [186,60,69]；改 DOM 后 20 色桶齐全）。
       光栅化是低频 + 按图层缓存的操作，直接取 DOM 包围盒最准，也与 getItemDocBBox
       对 merged 的首选口径（_localBB 来自 el.getBBox）一致。 */
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
    /* 蒙版图层：克隆 sveMaskInd 定义进宿主，否则 url(#sveMaskInd) 无法解析 */
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
    /* 共享符号图片定义：图层内 <use href="#sveImg*"> 需要把对应定义一并带进宿主 */
    $$('use', clone).forEach(u => {
      const h = (u.getAttribute('href') || '').replace(/^#/, '');
      if (h.indexOf('sveImg') !== 0) return;
      const d = $('#' + h, App.defs);
      if (d) addDefs().appendChild(d.cloneNode(true));
    });
    /* 填充图案定义：fill=url(#svePat*) 的图层（含合并分组内的 pattern 子层）
       需要把对应定义一并带进宿主，否则光栅化时图案填充为空 */
    $$('[fill]', clone).forEach(el => {
      const m = /url\(#(svePat\d+)\)/.exec(el.getAttribute('fill') || '');
      if (!m) return;
      const d = $('#' + m[1], App.defs);
      if (!d) return;
      const host = addDefs();
      /* 注意：defsHost 为 null 时不能用 $('#'+id, defsHost)（会退化成查整个 document） */
      if (!$('#' + m[1], host)) host.appendChild(d.cloneNode(true));
    });
    host.appendChild(clone);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(host)], { type: 'image/svg+xml' }));
    return loadImage(url).then(im => {
      URL.revokeObjectURL(url);
      const { canvas } = fitDrawRect(im, size);
      const out = canvas.toDataURL();
      layer.rasterCache = { size, url: out };
      layer.thumbCache = out; // 与面板缩略图缓存一致（同为 96px），避免 thumbDirty 被清后返回旧缩略图
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

/* 图层缩略图：实时反映颜色、形状、旋转、倾斜、缩放、透明度 */
App.getLayerThumb = function (layer) {
  if (layer.thumbCache && !layer.thumbDirty) return Promise.resolve(layer.thumbCache);
  /* 蒙版在缩略图里【不画灰棋盘格】：它表现为"挖空"——下面的图层被遮掉、露出缩略图底下的空白网格。
     所以本层自己的缩略图直接给空结果（行内显示占位网格）；组合缩略图里的挖空在 mergedThumbUrl 做。 */
  if (layer.isMask) return Promise.resolve('');
  /* 空结果不落缓存：否则一次失败就永久空白（缩略图再也不会重生） */
  const done = url => { layer.thumbCache = url; if (url) layer.thumbDirty = false; return url; };
  let p;
  if (layer.kind === 'symbol') {
    if (!layer.dataUri) p = Promise.resolve('');
    else if (layer.isMask) {
      /* 蒙版缩略图 = 棋盘格 ∩ 剪影（原来画的是剪影本身，看不出是蒙版） */
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
    p = (layer.kind === "merged") ? App.mergedThumbUrl(layer, 96) : App.svgRasterThumb(layer);   /* 分组走 canvas 合成（发丝级细条不会被光栅化剔掉） */
  }
  return p.then(done);
};

App.doRefreshLayerThumbs = function () {
  /* 只更新可视区域内的缩略图（大量图层时避免全量遍历） */
  App.fillVisibleThumbs();
};
/* 持续操作（旋转/缩放等）期间做 60ms 防抖，避免每帧重建缩略图 */
App.refreshLayerThumbs = function () {
  if (App.thumbTimer) clearTimeout(App.thumbTimer);
  App.thumbTimer = setTimeout(() => { App.thumbTimer = null; App.doRefreshLayerThumbs(); }, 60);
};

/* ---------- 大分组渲染代理（烘焙单图） ----------
   合并分组内图层很多时（>400），SVG 要逐帧绘制数千个 <image>，全图显示时
   缩放画布/编辑拖动只有 ~3fps。把分组内容烘焙成 1 张位图 + 1 个 <image> 代替：
   渲染成本与图层数量无关（实测 325ms/帧 → 13ms/帧）。子层 DOM 保留（visibility
   hidden），分组变换（移动/旋转/缩放/倾斜）由分组 g 统一驱动，无需重烘焙；
   颜色/图案变化时防抖重烘焙。 */
/* 2026-09-12 用户要求：取消分组的渲染（合并分组不再烘代理位图，全部走矢量渲染） */
App.proxyEnabled = false;
App.proxyThreshold = 400;
App._proxyBake = new Map();      // merged.id -> {canvas, minx, miny, bw, bh, f}
App._proxyQueue = new Map();     // 防抖重烘焙队列
App._proxyTimer = null;

App.maybeBakeProxy = function (merged) {
  if (!App.proxyEnabled) {                                   /* 取消分组渲染：已有代理就地拆掉，回到矢量 */
    try { if (App._proxyBake && App._proxyBake.has(merged.id) && App.unbakeProxy) App.unbakeProxy(merged); } catch (e) { }
    return;
  }
  if (!merged || merged.kind !== 'merged' || !merged.el) return;
  if (App.countInLayer(merged) <= App.proxyThreshold) return;
  if (App._proxyBake.has(merged.id)) return;
  App._enqueueProxyBake(merged);
};
/* 分组视觉变化（换色/换图案/蒙版切换等）：防抖重烘焙 */
App.markProxyDirty = function (merged) {
  if (merged && merged.kind === 'merged' && App._proxyBake.has(merged.id)) {
    App._enqueueProxyBake(merged);
  }
};
/* 移除代理（拆分/删除分组时）：恢复子层显示、作废烘焙缓存；嵌套子分组递归清理。
   底图（data-proxy-base）与其 blob url 一并清理，不泄漏 */
App.unbakeProxy = function (merged) {
  if (!merged) return;
  merged.__proxyEpoch = (merged.__proxyEpoch || 0) + 1;   /* 作废在途烘焙：完成时不得再安装 */
  App._proxyQueue.delete(merged.id);
  const rec = App._proxyBake.get(merged.id);
  if (rec && rec.url) { try { URL.revokeObjectURL(rec.url); } catch (e) { /* ignore */ } }
  if (rec && rec.baseUrl) { try { URL.revokeObjectURL(rec.baseUrl); } catch (e) { /* ignore */ } }
  if (rec && rec.baseMaskUrl) { try { URL.revokeObjectURL(rec.baseMaskUrl); } catch (e) { /* ignore */ } }
  App._proxyBake.delete(merged.id);
  if (merged.el) {
    merged.el.querySelectorAll('image[data-proxy]').forEach(img => img.remove());   /* 活动裁剪图/退休图/底图一并移除 */
    merged.el.querySelectorAll('[data-layer]').forEach(el => el.removeAttribute('visibility'));
    merged._localBB = undefined; // 代理图移除改变 getBBox：清缓存
  }
  (merged.children || []).forEach(ch => { if (ch.kind === 'merged') App.unbakeProxy(ch); });
};
/* ---------- import 图层自动位图化（大量 import 图层时渲染性能） ----------
   借鉴 Inkscape 的"静态内容位图缓存"：顶层 import（矢量路径）图层过多（≥300）时，
   非交互的 import 图层显示为预渲染位图（浏览器按 image 纹理合成，远快于逐路径光栅化）；
   交互（白框/选中/编辑/颜色预览）的图层恢复矢量显示；颜色/蒙版/图案变化后重新烘焙。
   位图随图层 transform 走（移动/旋转/缩放/倾斜/翻转无需重烘焙），
   命中检测走几何/像素（不依赖 DOM 可见性），导出/序列化用矢量数据不受影响。 */
App.impBitmapThreshold = 300;
App.impBitmapMaxSide = 512; // 超过该尺寸的 import 层不位图化（保持矢量）
App.impBakeQueue = [];
App.impBakeTimer = null;

App.impBitmapActive = function () {
  let n = 0;
  for (let i = 0; i < App.state.layers.length; i++) {
    if (App.state.layers[i].kind === 'import') { n++; if (n >= App.impBitmapThreshold) return true; }
  }
  return false;
};
/* 该 import 层当前是否处于交互目标（白框/选中/编辑中） */
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
/* 惰性创建位图 <image>（置于矢量组之下） */
App.impEnsureEl = function (layer) {
  if (!layer.el || layer.bitmapEl) return;
  const img = svgEl('image', {
    x: -layer.w / 2, y: -layer.h / 2, width: layer.w, height: layer.h,
    preserveAspectRatio: 'none', 'pointer-events': 'none', class: 'sve-imp-bitmap'
  });
  layer.el.insertBefore(img, layer.el.firstChild);
  layer.bitmapEl = img;
};
/* 烘焙：importMarkup → 独立 SVG → Blob URL → <image>（解码由浏览器后台完成） */
App.impBakeLayer = function (layer) {
  if (!layer || layer.kind !== 'import' || layer.isMask) return;
  if (layer.w > App.impBitmapMaxSide || layer.h > App.impBitmapMaxSide) return;
  if (layer.impBaking || (layer.impBitmapUrl && !layer.impBitmapDirty)) return;
  /* 引用外部 defs（渐变/滤镜等）的片段无法独立渲染：保持矢量 */
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
/* 显示切换：交互层显示矢量，其余显示位图（有 diff，避免高频重复赋值） */
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
/* 全量刷新（白框/选中/编辑/结构变化后调用）：遍历顶层 import 层 */
App.refreshImpBitmaps = function () {
  if (!App.impBitmapActive()) return;
  for (let i = 0; i < App.state.layers.length; i++) {
    if (App.state.layers[i].kind === 'import') App.updateImpDisplay(App.state.layers[i]);
  }
};
/* 内容变化（改色/蒙版/更换图案）：作废位图并排队重烘焙 */
App.impMarkDirty = function (layer) {
  if (!layer || layer.kind !== 'import') return;
  layer.impBitmapDirty = true;
  App.updateImpDisplay(layer);
};
/* 删除图层：释放位图 URL */
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
/* 后台分片烘焙：彩色渲染全部分子到一张位图，替换为单个 <image> */
App._bakeProxyAsync = function (merged) {
  if (!merged || merged.kind !== 'merged' || !merged.el) return;
  /* 烘焙令牌：分片烘焙是异步的，取消失效后完成的任务不得再安装（
     案底：拆分分组时在途烘焙完成后把代理图又塞回已拆开的组里 → proxyMapSize=1、帧间隔 78ms） */
  const bakeToken = (merged.__proxyEpoch = (merged.__proxyEpoch || 0) + 1);
  /* 在途标记：烘焙期间旧位图仍在显示（分辨率看着「不足」），不加这个的话
     updateView 每帧都会重新入队 → 烘完立刻再烘、永不停歇（实测 8x 场景 30s 不收敛、78ms/帧） */
  App._proxyBaking = App._proxyBaking || {};
  App._proxyBaking[merged.id] = true;
  merged.__bakeT0 = performance.now();
  const leaves = [];
  const walk = l => { if (l.kind === 'merged') (l.children || []).forEach(walk); else leaves.push(l); };
  (merged.children || []).forEach(walk);
  if (!leaves.length) return;
  /* 矩阵与并集（分片）：上溯到分组自身为止（不含分组 transform）——
     位图按【组本地坐标】烘焙，image 放在分组 g 内随分组变换渲染；
     否则分组非恒等变换（移动/旋转/缩放后）时位图按文档坐标放置会整体错位 */
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
  /* 必须传 DOM 元素 l.el：传模型对象 l 会因缺少 nodeType/getAttribute 得到空链=单位矩阵，
     全部图案被画到原点挤成一团（2973 层合并后"渲染崩"的根因） */
  const mats = leaves.map(l => chainToGroup(l.el));
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  const SLICE_MS = 8;   // 每片按时间预算切片：不出现 >100ms 长任务（原固定 250 个/片，单耗大时超预算）
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
    /* 方案A：烘焙范围 = 「分辨率允许的最大范围」∩ 整组包围盒，以当前视口为中心。
       旧做法（整组包围盒）在 4096 上限下分辨率被压死 → 放大进分组内部一直模糊；
       只取视口本身虽最清晰，但平移几步就跑出已烘范围 → 边平移边重烘（实测 p95 尖峰 97ms）。
       折中：cropMax = px 预算 / 需求分辨率，取视口中心展开到该尺寸再与包围盒求交 */
    const needF = App.proxyNeedF(merged);
    const fWant = Math.max(0.2, needF * 1.15);
    const CROP_PX_BUDGET = 6.0e6;                       /* ≈24MB RGBA，兼顾清晰与内存 */
    const cropMax = Math.max(1, Math.min(4096, Math.sqrt(CROP_PX_BUDGET)) / fWant);
    let cx0 = minx, cy0 = miny, cw0 = bw, ch0 = bh;
    const vrect = App.proxyLocalViewRect(merged, 0);
    if (vrect) {
      /* 中心取「视口 ∩ 包围盒」的中心：视口中心可能整个落在内容之外
         （例如缩小全览后再直接放大——位置没跟着变），拿它当中心会被包围盒裁掉一半，
         覆盖不全 → 每帧都判「不覆盖」→ 反复重烘（实测 p95 187ms、settle 超时） */
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
    /* 分辨率自适应（借鉴 Inkscape 按屏幕像素评分缓存）：至少 2048px，
       按当前视图缩放需求提高（放大后仍清晰），上限 4096 控制内存 */
    const screenScale = App.state.view.scale || 1;
    const dpr = window.devicePixelRatio || 1;
    const target = Math.max(2048, Math.ceil(Math.max(bw, bh) * screenScale * dpr));
    /* 允许超采样（f 可 > 1）：位图分辨率必须能超过「组本地 1:1」，否则放大视图时被拉伸变模糊 */
    /* 分辨率跟随屏幕需求（×1.15 余量），上限由 4096 与 crop 尺寸决定；下限 0.2 防退化。
       与旧口径的区别：不再用「整组包围盒」定 f，裁剪后同样的 4096 上限能给出更高分辨率 */
    const f = Math.max(0.2, Math.min(fWant, 4096 / Math.max(cw0, ch0)));
    const cw = Math.max(1, Math.round(cw0 * f)), ch = Math.max(1, Math.round(ch0 * f));
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const cx = cv.getContext('2d');
    /* 彩色图加载（symbolColorUrl 缓存命中后快） */
    Promise.all(leaves.map(l => App.symbolColorUrl(l).catch(() => ''))).then(urls => {
      /* 按 url 去重后再加载：2973 个叶子实际只有 ≤121 个不同 url，
         无去重 = 近 3k 次 Image 加载/解码（代理烘焙超时的首要根因） */
      const uniq = Array.from(new Set(urls.filter(Boolean)));
      const tLoad = performance.now();
      return App.loadBakeImages(uniq, '[proxy-bake] 图片加载异常').then(byUrl => {
        const imgs = urls.map(u => (u ? (byUrl.get(u) || null) : null));
        /* 单叶绘制（裁剪位图与整幅底图共用的同一条绘制路径） */
        const drawLeaf = (ctx2, di2, f2, ox, oy) => {
          const img = imgs[di2];
          if (!img) return;
          const l = leaves[di2];
          ctx2.save();
          const T = new DOMMatrix().translate(-ox * f2, -oy * f2).scale(f2).multiply(mats[di2]);
          ctx2.setTransform(T.a, T.b, T.c, T.d, T.e, T.f);
          ctx2.globalAlpha = (l && l.opacity >= 0 && l.opacity <= 1) ? l.opacity : 1;   /* 烘焙带上图案原本的透明度 */
          ctx2.drawImage(img, 0, 0, img.width, img.height, -(l.w || 0) / 2, -(l.h || 0) / 2, l.w || 0, l.h || 0);
          ctx2.restore();
        };
        /* 整幅低分辨率底图：垫在裁剪位图之下，消除「裁剪框外先空白、新位图落地才补上」的
           缩放抽动（Inkscape drawing-item 的整幅缓存思路；我们受 4096 上限约束裁剪，故补底图
           而不是取消裁剪）。范围 = 完整包围盒，fBase = min(2, 2048/长边)；复用同一批已加载图片 */
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
            if (bakeToken === merged.__proxyEpoch) bakeBase();   /* 底图总是随裁剪位图重烘：退休式换图保证无空窗，且内容/颜色一变立即跟上 */
          }
          catch (err) { console.warn('[proxy-bake] 安装异常', merged.id, String(err).slice(0, 200)); }
          finally { if (App._proxyBaking) delete App._proxyBaking[merged.id]; }   /* 在途标记必清：安装可能因令牌过期/已拆分而跳过 */
        };
        drawStep();
      }).catch(err => console.warn('[proxy-bake] 图片加载异常', merged.id, String(err).slice(0, 200)));
    }).catch(err => console.warn('[proxy-bake] 剪影生成异常', merged.id, String(err).slice(0, 200)));
  };
  bboxStep();
};
/* 安装/更新代理 image（首次插入；后续只换 href）。
   注意必须只匹配【直接子级】的代理图：嵌套合并后子分组的代理图也位于本 g 内，
   误匹配会导致跳过隐藏步骤（子层全部裸渲染，大分组导入卡顿的根因） */
App._installProxy = function (merged, cv, minx, miny, bw, bh, f, stat) {
  if (!merged.el) return;
  /* 过期/失效的在途烘焙一律丢弃：令牌被新一轮烘焙或 unbakeProxy 顶掉、或该组已不在图层树里 */
  if (stat && stat.token !== undefined && stat.token !== merged.__proxyEpoch) return;
  if (!App.state || !App.state.layers || App.state.layers.indexOf(merged) < 0) return;
  const rec0 = App._proxyBake.get(merged.id);
  /* PNG 编码走 toBlob（Chromium 离线线程）。换图采用【退休式原子提交】（Inkscape
     drawing-item 同思路）：先在 DOM 外解码，新图就绪后在同一个任务里替换旧图并隐藏子层。
     首次烘焙也不能先塞空 <image> 再隐藏矢量，否则编码/解码期间整组会消失。 */
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
      /* 新图已解码并落 DOM，才在同一任务中隐藏子层；不会出现空白过渡帧。 */
      merged.el.querySelectorAll('[data-layer]').forEach(el => el.setAttribute('visibility', 'hidden'));
      const prev = App._proxyBake.get(merged.id) || rec0;
      App._proxyBake.set(merged.id, Object.assign({}, prev || {}, {
        canvas: cv, minx, miny, bw, bh, f, url: url.indexOf('blob:') === 0 ? url : null,
        needF: (stat && stat.needF) || 0, full: (stat && stat.full) || null
      }));
      if (prev && prev.url && prev.url !== url) { try { URL.revokeObjectURL(prev.url); } catch (e) { /* ignore */ } }
      merged._localBB = undefined;
      /* 日志：烘焙各阶段耗时与规模（诊断"突然卡好一会"） */
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
/* 安装/更新整幅低分辨率底图（data-proxy-base，垫在裁剪位图之下：DOM 在前 = 绘制在下层）。
   与裁剪位图同一套令牌防过期规则；不参与子层可见性切换（子层 visibility 仍由裁剪位图管）。
   换图同用【退休式原子提交】：新图解码完成前旧图保留显示，杜绝解码空窗；旧 url 解码后回收 */
App._installProxyBase = function (merged, cv, minx, miny, bw, bh, fBase, token) {
  if (!merged || !merged.el) return;
  if (token !== undefined && token !== merged.__proxyEpoch) return;   /* 过期：安装即弃 */
  if (!App.state || !App.state.layers || App.state.layers.indexOf(merged) < 0) return;
  /* 底图 alpha 顺手转成白色剪影。闪动覆盖层直接复用它，不再重走 2000 叶
     剪影合成，也不再在交互路径调用同步 canvas.toDataURL()。 */
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
      return;   /* 编码期间被新一轮烘焙/unbake 顶掉：不安装 */
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
      /* 裁剪图与底图并行编码；底图偶尔先解码，等裁剪图完成原子提交后再挂底图。 */
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
/* 分组烘焙分辨率自适应检查：缓存像素（bw*f）低于屏幕需求（bw*scale*dpr）的 80% 时
   防抖重烘焙更高分辨率（旧图保留显示，烘焙完成才替换，无闪烁） */
/* ---------- 方案A（2026-09-11）：合并分组代理位图「按视口裁剪 + 清晰度判定重烘」 ----------
   原理：位图按【组本地坐标】烘焙、受 4096 像素上限约束；把烘焙范围从「整组包围盒」收窄到
   「视口映射回组本地的矩形 ∩ 包围盒」，同样的上限就能给出更高的每单位分辨率 → 放大进分组
   内部依然清晰（与 autoStatic 同一口径：位置与清晰度分开判定）。 */
App.proxyLocalViewRect = function (merged, pad) {
  try {
    const r = App.wrap.getBoundingClientRect();
    const v = App.state.view;
    const sc = v.scale || 1;
    const pd = typeof pad === 'number' ? pad : 0;
    const vx = v.x - (r.width / sc) * pd, vy = v.y - (r.height / sc) * pd;
    const vw = (r.width / sc) * (1 + pd * 2), vh = (r.height / sc) * (1 + pd * 2);
    const m = App.transformChainMat ? App.transformChainMat(merged) : null;   /* 本地 → 文档 */
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
/* 分组自身缩放（本地 → 文档的线性放大倍数）：设备像素需求 = 视图缩放 × dpr × 它 */
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
/* 已烘 crop 是否仍完整覆盖当前视口（位置判定） */
/* 当前视口内是否还有该组的内容（viewport ∩ 包围盒 非空）
   没有任何内容可见时不需要重烘：既无意义，又会在 4096 上限下永远达不到需求分辨率 → 自激重烘 */
App.proxyViewHasContent = function (merged) {
  const vr = App.proxyLocalViewRect(merged, 0);
  if (!vr || !merged || !merged.el) return true;      /* 算不出：按有内容处理（保守） */
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
  if (!vr || !rec || !rec.full) return true;        /* 算不出：不折腾 */
  /* 只要求覆盖「视口 ∩ 该组包围盒」：视口伸出内容之外的部分本来就没有东西要画，
     拿整块视口比会在内容边缘反复判不覆盖 → 反复重烘 */
  const fx0 = rec.full.minx, fy0 = rec.full.miny;
  const fx1 = fx0 + rec.full.bw, fy1 = fy0 + rec.full.bh;
  const ix0 = Math.max(vr.minx, fx0), iy0 = Math.max(vr.miny, fy0);
  const ix1 = Math.min(vr.maxx, fx1), iy1 = Math.min(vr.maxy, fy1);
  if (ix1 <= ix0 || iy1 <= iy0) return true;         /* 视口内没有该组内容 */
  const eps = 1;
  return rec.minx <= ix0 + eps && rec.miny <= iy0 + eps &&
    (rec.minx + rec.bw) >= ix1 - eps && (rec.miny + rec.bh) >= iy1 - eps;
};
App.maybeUpgradeProxyRes = function () {
  if (!App.proxyEnabled) return;                              /* 取消分组渲染：不再升级重烘 */
  if (!App._proxyBake || !App._proxyBake.size) return;
  const scale = App.state.view.scale || 1;
  const dpr = window.devicePixelRatio || 1;
  App._proxyBake.forEach((rec, id) => {
    try {
      if (!rec || !rec.f) return;
      const m = App.findLayer(id);
      if (!m || m.kind !== 'merged') return;
      if (App._proxyQueue.has(id)) return;          /* 已在重烘队列里 */
      if (App._proxyBaking && App._proxyBaking[id]) return;   /* 烘焙在途：等它落地再判（防自激重烘） */
      if (!App.proxyViewHasContent(m)) return;                /* 视口里没有该组内容：不重烘（否则自激） */
      /* 方案A 两条判定（与 autoStatic 同口径）：
         ①清晰度：f 低于屏幕需求 ×0.85 → 重烘（裁剪会让下次 f 更高）
         ②覆盖度：视口跑出已烘 crop（平移离开）→ 重烘
         旧实现「到 4096 像素上限就不再折腾」正是放大进分组内部一直模糊的原因 */
      const needF = App.proxyNeedF(m);
      const resShort = rec.f < needF * 0.85;                 /* 太糊：放大后需要更高分辨率 */
      const resFat = rec.f > needF * 1.15 * 2.2;              /* 太肥：缩小视图后仍拿大位图逐帧降采样，
                                                              实测 2449×1655 全览时 70.9ms/帧；重烘会自动裁小 */
      const cover = App.proxyCropCoversView(m, rec);
      if (resShort || resFat || !cover) App.markProxyDirty(m);

    } catch (e) { /* ignore */ }
  });
};
/* 代理分组取色：从烘焙位图像素取色（子层隐藏时取色器仍可用）。
   位图是组本地坐标：文档点先经分组自身变换的逆变换折算到组本地再采样 */
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
