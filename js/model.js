'use strict';
const App = window.App = window.App || {};

App.state = {
  layers: [],               // 顶层图层（文档顺序，后面的在上层）
  layerMap: new Map(),      // id -> layer（含合并图层内部子图层）
  nextId: 1,
  selected: new Set(),      // 选中的顶层图层 id 集合
  selectedByTab: false,     // 当前选择是否由 Tab 操作产生（Tab 留下的单选也显示红三角）
  edit: null,               // {type:'layer'|'multi'|'merged'|'bg', ids:[...]}
  editMode: 'move',         // move|size|rotate|skew|opacity
  sizeMode: 'free',         // free|prop
  axisHint: true,           // 大小模式 W/A 方向指示开关
  showHandles: true,        // 大小模式手柄显示开关（隐藏时手柄不绘制、不被鼠标触发）
  lastColor: '#ffffff',     // 上一个编辑过的颜色，新拖入图案继承
  clipboard: [],
  bg: { base: 'light', grid: true, image: null },
  layersHidden: false,       // 画布右上角“隐藏图层”开关
  layersDisplayOpacity: 1,   // 所有图案的显示透明度（仅显示：不改图层数据、不导出、不进历史）
  selBarDismissed: false,    // 白框移动后收起功能栏：只有再次鼠标点击/Enter 呼出
  plusAnchorActive: false,   // 白框是否停靠在图层栏首位「+」功能栏上（此时粘贴插到第 2 位）
  batching: false,           // 批量导入/粘贴期间抑制面板逐层重建
  wheelZoomEnabled: true,    // 滚轮缩放画布开关
  /* 编辑速率（WASD 连续调整）与微调速率（方向键单步）：可在设置里改，持久化到 settings.json。
     opacity 的单位 = 透明度/秒（WASD）与 透明度%/次（方向键），默认值与改造前的硬编码一致 */
  editSpeeds: { move: 70, size: 95, rotate: 70, skew: 25, opacity: 30 },
  nudgeSpeeds: { move: 0.2, size: 0.8, rotate: 0.1, skew: 0.1, opacity: 1 },
  /* 缩放锚点（仅单个普通图案可用）：null = 未放置（沿用中心固定）。
     { layerId, lx, ly, placed } —— lx/ly 是目标图层本地坐标（内容中心为原点），
     文档坐标每次由当前变换矩阵现算，画布缩放/视图变化不会让锚点失效 */
  anchor: null,
  anchorPlacing: false,
  view: { x: 0, y: 0, scale: 1 },
  replacing: false,
  keys: new Set(),
  spaceDown: false,
  tabDown: false,
  sweepMode: null,          // 本次 Tab 按住期间滚轮扫选方向：'add' | 'remove'
  sweepDir: 0,              // 扫选手势方向：1 向下 / -1 向上
  tabGestureUsed: false,    // 本次 Tab 按住期间是否已用滚轮/点击
  tabAutoSel: null,         // 本次 Tab 手势对白框图层的自动操作记录（鼠标介入时回滚）
  shiftDown: false,
  flashTimer: null,
  loaded: false,
  eyeMode: null,            // 取色器模式：null | 'layer'（图层取色）| 'bg'（背景图片取色）
  editFlipStep: 0,          // 编辑模式 Tab 翻转循环：0=无 1=水平 2=水平+垂直 3=垂直
};

/* ---------- 图层模型 ---------- */
App.newLayer = function (opt) {
  opt = opt || {};
  return {
    id: App.state.nextId++,
    kind: opt.kind || 'symbol',        // symbol | pattern | import | merged
    name: opt.name || '图案',
    color: opt.color !== undefined ? opt.color : App.state.lastColor,
    opacity: opt.opacity !== undefined ? opt.opacity : 1,
    x: opt.x || 0, y: opt.y || 0,
    w: opt.w || 128, h: opt.h || 128,  // 图案本机尺寸
    sx: opt.sx || 1, sy: opt.sy || 1,  // 屏幕方向缩放（不受旋转/倾斜影响）
    rot: opt.rot || 0, skew: opt.skew || 0,
    flipH: !!opt.flipH, flipV: !!opt.flipV,
    isMask: !!opt.isMask,               // 蒙版图层：剪影填充棋盘格指示图案
    symbolKey: opt.symbolKey || null,
    patternKey: opt.patternKey || null,
    dataUri: opt.dataUri || null,
    importMarkup: opt.importMarkup || null,
    children: opt.children || null,    // merged：子图层数组
    el: null, maskEl: null, rectEl: null, innerEl: null,
    patDefEl: null, patBaseRect: null, patStroke: null,
    thumbDirty: true, thumbCache: null,
    /* 异步彩色剪影请求的代次。图层换色/重建内容时递增，
       旧 Promise 即使最后完成也不得把 href 写回新元素。 */
    _symbolColorEpoch: 0,
  };
};

/* 符号剪影图片定义共享：同一符号的所有图层共用一张 <image>（大幅降低大量图层时的内存与渲染开销） */
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
/* 蒙版共享同一份符号图片，但 use 必须显式缩放到当前图层框。
   旧版直接 use 原生尺寸，图层 w/h 与符号尺寸不同时剪影会缩在中央。 */
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

/* 符号彩色剪影 PNG（免蒙版直绘）：亮度→透明度 × 图层颜色，按 符号+颜色 缓存。
   大量图层时每个图层只是一个 <image>，不再每个图层都做一次 mask 合成（性能关键） */
App.symbolColorUrlCache = new Map();
App.symbolColorPending = new Map();
/* 剪影染色像素循环分片：2000 层并发生成时，同步像素循环会连续占满主线程
   （日志：合并/换色后 8-10 秒阻塞）。每片 ~2 万像素（约 1ms），批间让出主线程；
   首片也走 setTimeout——并发 Promise.all 时 2000 个 then 回调若同步执行首片
   仍会连成一段大阻塞（实测 8.8 秒） */
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
  /* 并发去重：千层同符号同色时共享一次像素处理，避免重复占用主线程 */
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
/* 同步取剪影画布：仅命中缓存（未生成返回 null）——点击/拖拽命中判定用，避免异步延迟 */
App.symbolColorCanvasSync = function (uri, color, w, h) {
  const key = 'sc:' + uri.slice(0, 60) + uri.slice(-40) + '|' + color + '|' + w + 'x' + h;
  return silhouetteCache.get(key) || null;
};
App.symbolColorUrl = function (layer) {
  /* 尺寸是彩色剪影 PNG 的一部分：更换图案/恢复快照会保留用户尺寸，
     同一素材同一颜色但不同 w/h 不能共用一张已经栅格化的图片。 */
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

/* 安装异步生成的彩色剪影时统一做归属校验。
   生成期间可能发生换色、换素材、重建内容、切标签或删除图层；仅检查 Promise
   是否成功不足以保证它仍属于当前 <image>。保留元素身份、图源、颜色、尺寸和代次
   五项校验，且允许元素尚未 append（初始 build 的 Promise 可能先完成）。 */
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

/* 构建图层 SVG 元素（内容以原点为中心） */
App.buildLayerElement = function (layer) {
  const g = svgEl('g', { 'data-layer': layer.id, 'data-kind': layer.kind });
  if (layer.kind === 'symbol') {
    if (layer.isMask) {
      /* 蒙版图层：保留 蒙版+棋盘格指示 渲染 */
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
      /* 普通符号：彩色剪影 PNG 直绘（无蒙版，大量图层时渲染快；命中检测交给图片可见像素） */
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
    /* import 位图化：内容构建后作废旧位图并排队重烘焙 */
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

/* 重建图层内容（更换图案时使用） */
App.rebuildLayerContent = function (layer) {
  if (!layer.el) return;
  layer.el.innerHTML = '';
  /* 无论新内容是否仍为 symbol，都让旧的异步安装回调失效。 */
  layer._symbolColorEpoch = (layer._symbolColorEpoch || 0) + 1;
  layer.maskEl = null; layer.rectEl = null; layer.innerEl = null; layer.imgEl = null;
  layer.bitmapEl = null; // 旧位图元素随 innerHTML 清空脱离 DOM：不重置会导致 import 层永久隐形（impEnsureEl 误判已存在）
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
    /* import 位图化：内容构建后作废旧位图并排队重烘焙 */
    if (App.impMarkDirty && !layer._detachedRender) App.impMarkDirty(layer);
  } else if (layer.kind === 'merged') {
    (layer.children || []).forEach(ch => g.appendChild(ch.el || App.buildLayerElement(ch)));
  }
  App.applyLayerTransform(layer);
};

/* 导入图层切换为蒙版时：把所有填充/描边替换为棋盘格指示图案（剪影化） */
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

/* 图层树（含合并图层递归）中是否含蒙版 */
App.layerTreeHasMask = function (layer) {
  if (layer.isMask) return true;
  if (layer.kind === 'merged' && layer.children) return layer.children.some(App.layerTreeHasMask);
  return false;
};

/* 为填充图案图层克隆 pattern 定义到 appDefs */
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

/* transform 组合：translate rotate scale skewX（scale 在旋转之前 => 随图层方向缩放的本地轴缩放）
   翻转用负缩放实现，位于旋转之前（本地轴翻转） */
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
  /* 编辑操作（移动/大小/旋转/倾斜/透明度）同步闪动覆盖层位置，但不重启动画 */
  /* Batch callers can update many targets without rebuilding overlays per leaf;
     the caller/frame scheduler performs one refresh after the batch. */
  if (!App._batchTransformDepth && App.requestFlashRefresh) App.requestFlashRefresh(false);
};

/* ---------- 图层增删 ---------- */
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
  /* 批量创建（batching）时隐藏图层容器：逐层 appendChild 会触发增量布局，
     2000 层导入/恢复时卡 8 秒（日志）；解除批量后由 updateView 恢复显示 */
  if (App.state.batching && App.layersRoot.style.display !== 'none') App.layersRoot.style.display = 'none';
  App.layersRoot.appendChild(layer.el);
  App.state.layers.push(layer);
  App.registerChildren(layer);
  layer.thumbDirty = true;
  if (!App.state.batching) {
    App.refreshPanel();
    App.refreshCount();
  }
  /* 大分组渲染代理：粘贴/恢复等入口统一启用 */
  if (layer.kind === 'merged' && App.maybeBakeProxy) App.maybeBakeProxy(layer);
    /* 内容变化：位图缓存失效 + 重绘（新图层必须立刻改变画布） */
    if (App.contentChanged) App.contentChanged();
  return layer;
};

App.removeTopLayer = function (layer) {
  /* 作废该层（及其子层）在途的彩色剪影安装，避免删除/切标签后旧 Promise
     仍把 href 写入已脱离画布的元素。 */
  const invalidateColor = function (l) {
    if (!l) return;
    l._symbolColorEpoch = (l._symbolColorEpoch || 0) + 1;
    if (l.kind === 'merged' && l.children) l.children.forEach(invalidateColor);
  };
  invalidateColor(layer);
  /* 编辑静态化：被删除的非编辑层从背景快照移除（防抖重烘焙，不恢复全部图层） */
  if (App.dropEditStaticItem) App.dropEditStaticItem(layer);
  /* 移除渲染代理缓存（分组 DOM 一并移除） */
  if (layer.kind === 'merged' && App.unbakeProxy) App.unbakeProxy(layer);
  /* import 位图化：释放位图 URL */
  if (App.impCleanup) App.impCleanup(layer);
  /* 批量删除时隐藏图层容器：逐层 removeChild 触发增量布局（千层清空卡顿） */
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
    /* 删除图层后立即清理其闪动覆盖层，避免残留/白框移动后闪动失效 */
    if (App.requestFlashRefresh) App.requestFlashRefresh();
    /* 内容变化：位图缓存失效 + 重绘（删掉的图层必须立刻从画布消失） */
    if (App.contentChanged) App.contentChanged();
  }
};

/* 深拷贝一个图层（用于复制/剪切粘贴） */
App.duplicateLayer = function (layer) {
  const slim = App.serializeLayer(layer, true);
  return App.deserializeLayer(slim);
};

App.findLayer = function (id) { return App.state.layerMap.get(id); };

/* 找到包含该图层的顶层图层（合并图层内部 -> 合并图层） */
App.topOf = function (layer) {
  let el = layer.el;
  while (el && el.parentNode && el.parentNode !== App.layersRoot) el = el.parentNode;
  return el ? App.findLayer(parseInt(el.getAttribute('data-layer'), 10)) : layer;
};

/* ---------- 合并 / 拆分 ---------- */
App.mergeLayers = function (ids) {
  /* 合并：撤销未点「应用」的颜色预览 */
  if (App.cancelColorPreview) App.cancelColorPreview();
  App.perfCtx.lastOp = '合并分组';
  const __t0 = performance.now();
  const items = ids.map(id => App.findLayer(id)).filter(Boolean);
  if (items.length < 2) return null;
  /* 锚点：白框所在的图层位置为准；白框不在合并项中时取最上层的合并项 */
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
  const merged = App.newLayer({ kind: 'merged', name: '合并图层', color: '', opacity: 1 });
  /* 子层顺序必须与图层栏层级一致（数组靠前=下层，SVG g 内先画的在下）：
     传入的 ids 是扫选/多选顺序（与层级无关），直接使用会导致合并后
     渲染顺序错乱（第一个反而排到最后） */
  const ordered = items.slice().sort((a, b) => App.state.layers.indexOf(a) - App.state.layers.indexOf(b));
  merged.children = ordered;
  items.forEach(l => {
    /* 编辑静态化：被合并的层从背景快照移除（合并层显示在背景之上） */
    if (App.dropEditStaticItem) App.dropEditStaticItem(l);
    const i = App.state.layers.indexOf(l);
    if (i >= 0) App.state.layers.splice(i, 1);
    App.state.layerMap.delete(l.id);
  });
  App.buildLayerElement(merged); // 会把子图层 el 移入 merged
  /* 子分组若已有烘焙代理：先移除（子代理图会被顶层代理覆盖；嵌套代理还会干扰
     顶层安装时的代理查找，导致子层不隐藏、整组裸渲染） */
  if (App.unbakeProxy) {
    merged.children.forEach(ch => { if (ch.kind === 'merged' && App._proxyBake && App._proxyBake.has(ch.id)) App.unbakeProxy(ch); });
  }
  /* 插回白框图层原位置（DOM 顺序与图层数组顺序保持一致，不再跳到最上方） */
  App.state.layers.splice(newIdx, 0, merged);
  const next = App.state.layers[newIdx + 1];
  if (next && next.el && next.el.parentNode === App.layersRoot) {
    App.layersRoot.insertBefore(merged.el, next.el);
  } else {
    App.layersRoot.appendChild(merged.el);
  }
  App.registerChildren(merged);
  /* 合并后白框自动定位到合并后的图层并停留 */
  App.lastWheelIdx = App.state.layers.length - 1 - newIdx;
  /* 合并后清除选定（Tab 多选标志一并复位） */
  App.state.selected = new Set();
  App.state.selectedByTab = false;
  App.refreshPanel();
  App.refreshCount();
  /* 白框条目立即滚入可视区（已在可视区内则不跳动） */
  if (App.scrollItemToTop) App.scrollItemToTop(merged, true);
  /* 大分组渲染代理：子层数量超过阈值时烘焙单图（千层分组全图显示不再卡顿） */
  if (App.maybeBakeProxy) App.maybeBakeProxy(merged);
  /* 内容变化：合并改变了图层结构，位图缓存必须失效 */
  if (App.contentChanged) App.contentChanged();
  /* 日志：合并耗时与规模 */
  try { App.log('info', '合并分组', { layers: items.length, ms: Math.round(performance.now() - __t0) }); } catch (e) { /* ignore */ }
  return merged;
};

App.splitMerged = function (merged) {
  if (!merged || merged.kind !== 'merged') return;
  /* 拆分：撤销未点「应用」的颜色预览 */
  if (App.cancelColorPreview) App.cancelColorPreview();
  /* 编辑静态化：拆分的分组从背景快照移除（子层显示在背景之上） */
  if (App.dropEditStaticItem) App.dropEditStaticItem(merged);
  const __t0 = performance.now();
  const __n = merged.children ? merged.children.length : 0;
  /* 拆分前移除渲染代理：恢复子层显示（烘焙位图随分组删除） */
  if (App.unbakeProxy) App.unbakeProxy(merged);
  /* 视口静态位图必须随分组一起消失：否则取消分组后画布上仍留着一张「分组烘出来的图」，
     且 hiding 列表指向已删除的层（案底：拆分后 bg=SHOWN、hidDom=0、位图可见贡献 0.276%） */
  if (App.autoStaticRelease) App.autoStaticRelease();
  const i = App.state.layers.indexOf(merged);
  const next = i >= 0 ? App.state.layers[i + 1] : null;
  const refEl = next && next.el && next.el.parentNode === App.layersRoot ? next.el : null;
  /* 把分组的当前变换烘焙进每个直接子图层：拆分后图案的视觉位置/大小/旋转与拆分前完全一致 */
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
  /* 子图层按原顺序插回合并图层原位置 */
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
  /* 拆分出的子层重新纳入编辑静态化（编辑中/退出后保持）：位于交互层下方的层
     重新进背景快照并重烘——否则子层永久矢量渲染、静态化集合单向收缩 */
  if (App.editStatic && App.editStatic.active && App.rebakeEditStaticViewport) {
    children.forEach(ch => { if (!App.editStatic.items.includes(ch)) App.editStatic.items.push(ch); });
    App.rebakeEditStaticViewport();
  }
  /* 拆分后清除选定（Tab 多选标志一并复位） */
  App.state.selected = new Set();
  App.state.selectedByTab = false;
  App.refreshPanel();
  App.refreshCount();
  /* 白框条目立即滚入可视区（拆分后白框停在同一面板位置） */
  const box = App.whiteBoxLayer ? App.whiteBoxLayer() : null;
  if (App.scrollItemToTop) App.scrollItemToTop(box || children[0] || null, true);
  /* 结构已变：按新结构重新评估视口静态位图（大文件帧率保护不丢） */
  if (App.autoStaticMaybe) App.autoStaticMaybe();
  /* 日志：拆分耗时与规模 */
  try { App.log('info', '拆分分组', { layers: __n, ms: Math.round(performance.now() - __t0) }); } catch (e) { /* ignore */ }
};

/* ---------- 图案总数（合并图层内部也算，嵌套合并递归） ---------- */
App.countInLayer = function (layer) {
  if (layer.kind !== 'merged') return 1;
  return (layer.children || []).reduce((acc, ch) => acc + App.countInLayer(ch), 0);
};
App.countPatterns = function () {
  return App.state.layers.reduce((acc, l) => acc + App.countInLayer(l), 0);
};

/* ---------- 批量清空（撤销/重做恢复用） ---------- */
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

/* ---------- 颜色 ---------- */
App.setLayerColor = function (layer, color) {
  layer.color = color;
  layer.thumbDirty = true;
  if (layer.kind === 'symbol') {
    /* 先递增代次，再启动新颜色请求；旧颜色请求即使后完成也只能被丢弃。 */
    layer._symbolColorEpoch = (layer._symbolColorEpoch || 0) + 1;
    if (layer.isMask) {
      if (layer.rectEl) layer.rectEl.setAttribute('fill', 'url(#sveMaskInd)');
    } else if (layer.imgEl) {
      /* 彩色剪影 PNG：换色即异步换图 */
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
    /* import 位图化：换色后作废位图并排队重烘焙 */
    if (App.impMarkDirty) App.impMarkDirty(layer);
  } else if (layer.kind === 'merged' && layer.children) {
    layer.children.forEach(ch => App.setLayerColor(ch, color));
    /* 大分组渲染代理：换色后重烘焙（防抖，后台分片） */
    if (App.markProxyDirty) App.markProxyDirty(layer);
  }
  /* 编辑静态化背景：换色后重烘（否则背景位图保持旧色，取消选中/取色看到旧颜色） */
  if (App.editStatic && App.editStatic.active && App.rebakeEditStaticViewport) App.rebakeEditStaticViewport();
};

/* ---------- 当前编辑目标 ---------- */
App.editTargets = function () {
  const e = App.state.edit;
  if (!e) return [];
  if (e.type === 'bg') return App.state.bg.image ? [App.state.bg.image] : [];
  if (e.type === 'multi') return (e.ids || []).map(id => App.findLayer(id)).filter(Boolean);
  const l = App.findLayer(e.id);
  return l ? [l] : [];
};

/* ---------- 序列化（剪切板 / 复制 / 导出） ---------- */
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
App.deserializeLayer = function (slim) {
  const l = App.newLayer({
    kind: slim.kind, name: slim.name, color: slim.color, opacity: slim.opacity,
    x: slim.x, y: slim.y, w: slim.w, h: slim.h, sx: slim.sx, sy: slim.sy,
    rot: slim.rot, skew: slim.skew, flipH: slim.flipH, flipV: slim.flipV,
    isMask: slim.isMask, symbolKey: slim.symbolKey,
    patternKey: slim.patternKey, dataUri: slim.dataUri, importMarkup: slim.importMarkup
  });
  if (slim.kind === 'merged' && slim.children) {
    l.children = slim.children.map(ch => App.deserializeLayer(ch));
  }
  return l;
};

/* 缩略图/工作进程专用反序列化：只构造离屏模型，不消耗 App.state.nextId，
   同时递归补回快照省略的符号素材。调用方可安全渲染另一份文档而不碰当前画布状态。 */
App.deserializeLayersDetached = function (slims, prefix) {
  let next = 0;
  const idPrefix = String(prefix || 'detached_').replace(/[^A-Za-z0-9_-]/g, '_');
  const build = function (slim) {
    slim = slim || {};
    const layer = {
      id: idPrefix + (++next),
      kind: slim.kind || 'symbol',
      name: slim.name || '图案',
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
    if (layer.kind === 'merged') layer.children = (slim.children || []).map(build);
    return layer;
  };
  return (slims || []).map(build);
};

/* ---------- 选中集合 ---------- */
App.selectedItems = function () {
  return Array.from(App.state.selected).map(id => App.findLayer(id)).filter(Boolean);
};
App.markThumbDirty = function (layer) {
  layer.thumbDirty = true;
  if (layer.kind === 'merged' && layer.children) layer.children.forEach(ch => App.markThumbDirty(ch));
};

/* ---------- 历史快照瘦身：不含符号 dataUri（撤销恢复时按 symbolKey 从素材库找回） ---------- */
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
/* 恢复时按 symbolKey 重新挂接素材图片（历史快照不再保存 dataUri） */
App.relinkSymbolData = function (layer) {
  if (layer.kind === 'symbol' && !layer.dataUri && layer.symbolKey) {
    const sym = App.symbolMap.get(layer.symbolKey);
    if (sym) {
      layer.dataUri = App.symbolUri(sym);
      /* 历史/标签快照中的 w/h 是用户当前显示尺寸（更换图案也明确保持尺寸），
         这里只补回缺失素材，不得用素材原生尺寸覆盖快照。旧格式若确实没有
         有效尺寸，才以素材尺寸初始化。 */
      const hasW = Number.isFinite(Number(layer.w)) && Number(layer.w) > 0;
      const hasH = Number.isFinite(Number(layer.h)) && Number(layer.h) > 0;
      if (!hasW) layer.w = sym.w;
      if (!hasH) layer.h = sym.h;
    }
  }
  if (layer.kind === 'merged' && layer.children) layer.children.forEach(App.relinkSymbolData);
};
