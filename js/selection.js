'use strict';
/* 选中、多选、外框、闪烁、剪切/粘贴/删除/合并/拆分 */
App.setSelection = function (ids, opts) {
  opts = opts || {};
  App.state.selected = new Set(ids);
  /* 不在这里清除 selBarDismissed：只有鼠标点击/Enter 呼出才清除，
     Tab 扫选等选择变化不会把功能栏顶出来 */
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
  App.state.selectedByTab = s.size >= 1; // Tab 操作产生的选择
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

/* 按住/单击 Tab：白框所在图层立即响应——未选→选定（并进入加选扫过）；
   多选集合内的图层按 Tab → 取消（取消扫过）；
   普通单选（未处于多选）按 Tab → 保持选中、直接进入多选；
   多选遗留单选（selectedByTab=true 只剩 1 个）按 Tab：
     - 白框图层是遗留项 → 取消它、退出多选
     - 白框图层是其他图层 → 清除遗留、从该图层开始新多选 */
App.actOnWhiteBoxLayer = function () {
  if (!App.state.layers.length) return;
  /* 白框停在「+」栏上时它不在任何图层行上：Tab 一律不动图层状态。
     案底（用户报障）：停靠态按 Tab 会把「+」栏下面那一行图层选上——lastWheelIdx 已被停靠置空，
     回退口径 i=0 恰好落在面板第一行，而白框并不在那个图层上。 */
  if (App.state.plusAnchorActive) return;
  /* Tab 手势期间功能栏一律收起（多选不呼出） */
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
  /* 记录本次 Tab 手势对白框图层的自动操作：期间发生鼠标点击/拖动则立刻回滚 */
  App.state.tabAutoSel = { id: layer.id, prevSelected: wasSelected };
  /* 单选残留清理：当前只有 1 个选中且白框不在该图层上——清除残留，从白框图层开始加选。
     仅针对【鼠标点击的普通单选】（selectedByTab=false）：
     用户按 Tab 逐个加选产生的选择（selectedByTab=true）绝不清空——
     否则"按 Tab 加选第一个 → 白框移到下一个 → 再按 Tab"时第一个被误清
     （多选必须累积，而不是只能同时存在一个） */
  if (App.state.selected.size === 1 && !wasSelected && !App.state.selectedByTab) {
    App.state.selectedByTab = false;
    App.setSelection([]);
  }
  if (legacySingle && wasSelected) {
    /* 多选遗留单选：白框图层是遗留项 → Tab 取消它、退出多选 */
    App.state.sweepMode = 'remove';
    App.state.selectedByTab = false;
    App.setSelection([]);
  } else if (wasSelected && App.state.selected.size === 1) {
    /* 普通单选：保持选中并进入多选（加选扫过从该图层开始），不取消 */
    App.state.sweepMode = 'add';
    App.state.selectedByTab = true;
    App.setSelection(Array.from(App.state.selected));
  } else if (wasSelected) {
    /* 多选集合内的图层再按 Tab：取消它（Tab 切换语义：未选=加选、已选=取消） */
    App.state.sweepMode = 'remove';
    App.toggleLayerSelection(layer);
  } else {
    /* 未选图层：正常加选（累积多选——逐个 Tab 加选时之前的保持选中，
       不会被"单选残留清理"误清——见上方 selectedByTab 条件） */
    App.state.sweepMode = 'add';
    App.toggleLayerSelection(layer);
  }
};

/* Tab 手势期间鼠标介入（点击/拖动）：回滚 Tab 对白框图层的自动加选/取消。
   返回被回滚的图层 id（没有则 null）——点击该图层时不应再重复切换 */
App.rollbackTabAutoSel = function () {
  const t = App.state.tabAutoSel;
  if (!t) return null;
  App.state.tabAutoSel = null;
  const l = App.findLayer(t.id);
  if (!l) return t.id;
  if (t.prevSelected && !App.state.selected.has(l.id)) {
    App.state.selected.add(l.id); // Tab 取消了的：恢复
  } else if (!t.prevSelected && App.state.selected.has(l.id)) {
    App.state.selected.delete(l.id); // Tab 加选了的：取消
  } else {
    return t.id;
  }
  App.state.selectedByTab = App.state.selected.size >= 1;
  App.setSelection(Array.from(App.state.selected));
  return t.id;
};

/* 像素级命中：判定范围 = 图案可见像素（半透明/羽化边缘不再误选），透明区穿透到下层。
   剪影 PNG 的 alpha = 原图亮度，浅色边缘视觉几乎不可见但 alpha>0，
   浏览器 visiblePainted 只要 alpha>0 就命中，导致判定范围比视觉大——这里按 alpha≥32 判定。
   坐标换算用 transform 属性链矩阵（纯字符串解析，零布局）——getScreenCTM 会强制整树布局，
   大量图层时每次点击都卡 */
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
/* 从顶层到底层找第一个"可见像素"图层（透明区穿透下层）。
   剪影画布在图层创建时即预生成，命中判定可同步完成；未就绪时按几何保守命中 */
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
  if (!b.corners || b.corners.length < 4) return true; // 无法计算：保守命中
  const pd = App.screenToDoc(clientX, clientY);
  if (!App.pointInQuad(pd, b.corners)) return false;
  if (layer.kind === 'symbol' && !layer.isMask) {
    const c = App.symbolColorCanvasSync(layer.dataUri, layer.color || '#ffffff', Math.max(1, Math.round(layer.w)), Math.max(1, Math.round(layer.h)));
    if (!c) return true; // 位图未就绪：保守命中
    return App.canvasAlphaAt(c, layer, clientX, clientY) >= 32;
  }
  return true; // pattern/import/蒙版：矩形（不透明）命中
};

/* 普通模式画布点击：只选中，不移动；按住 Tab 点击=加入/移出多选 */
App.onCanvasPointerDown = function (e) {
  if (App.state.spaceDown) return; // 平移由 main 处理
  /* Tab 手势期间鼠标点击：先回滚 Tab 对白框图层的自动加选/取消。
     tabPending 流程在 pointerdown 已回滚并把 rolledId 通过 _rolledId 传入；
     直接调用（测试/框选路径）时现场回滚 */
  let rolledId = e && e._rolledId;
  if (App.state.tabDown && rolledId === undefined) rolledId = App.rollbackTabAutoSel();
  /* 模拟事件可能不带坐标（以 target 派发）：退化为 DOM 命中；真实事件坐标恒有效 */
  const layer = (e.clientX === 0 && e.clientY === 0 && e.target)
    ? App.hitLayer(e)
    : App.hitLayerPaintedSync(e.clientX, e.clientY);
  if (layer) {
    const top = App.topOf(layer);
    if (App.state.tabDown) {
      /* 按住 Tab 点击画布中的图案：加入/移出多选，白框立刻选中点到的图层。
         点击=明确意图：无论是否刚回滚过白框层都切换（Tab+滚轮扫过后再点击该层，
         rollback 恢复原状态后 toggle 是用户的新操作——旧逻辑用 rolledId 拦截
         导致"点到白框层加不进去/第一个被取消"） */
      App.state.tabGestureUsed = true;
      App.toggleLayerSelection(top);
      const ids = App.state.layers.slice().reverse().map(l => l.id);
      const bi = ids.indexOf(top.id);
      if (bi >= 0) { App.lastWheelIdx = bi; App.syncPanelSelectionClasses(); }
      App.scrollItemToTop(top);
      /* 白框已移动：补刷新闪烁覆盖层（否则闪烁停在旧白框位置） */
      App.requestFlashRefresh(false);
    } else if (App.state.selected.size > 1 || (App.state.selectedByTab && App.state.selected.size >= 1)) {
      /* 多选（含遗留单选）状态下普通点击：绝不取消多选；白框移到点击的图层并呼出功能栏（按钮作用于整个多选集合） */
      App.state.selBarDismissed = false;
      const ids = App.state.layers.slice().reverse().map(l => l.id);
      const i = ids.indexOf(top.id);
      if (i >= 0) App.lastWheelIdx = i;
      App.syncPanelSelectionClasses();
      App.updateSelToolbar();
      App.requestFlashRefresh();
      App.scrollItemToTop(top);
    } else {
      /* 普通点击：单选该图层并快速定位（普通单选不显示红三角） */
      App.state.selectedByTab = false;
      App.lastWheelIdx = undefined;
      App.state.selBarDismissed = false;
      App.setSelection([top.id], { scrollPanel: true });
    }
  } else {
    /* 按住 Tab 点击画布空白处：不清空多选（防止扫选过程中误触清空） */
    if (App.state.replacing || App.state.tabDown) return;
    if (App.state.selected.size > 1 || (App.state.selectedByTab && App.state.selected.size >= 1)) {
      /* 多选（含遗留单选）状态下点击空白：绝不清空多选，只收起功能栏、白框不动 */
      App.state.selBarDismissed = true;
      App.updateSelToolbar();
    } else {
      App.state.selectedByTab = false;
      App.setSelection([]);
    }
  }
};

/* ---------- Tab 拖拽框选（蓝框 +/−） ---------- */
App.boxSelect = null;
App.startBoxSelect = function (e, mode) {
  /* Tab 手势期间鼠标拖动框选：先回滚 Tab 对白框图层的自动加选/取消 */
  if (App.state.tabDown) App.rollbackTabAutoSel();
  const p = App.screenToDoc(e.clientX, e.clientY);
  App.boxSelect = { mode, x0: p.x, y0: p.y, x1: p.x, y1: p.y, startCX: e.clientX, startCY: e.clientY };
  if (!App.boxSelG) {
    App.boxSelG = svgEl('g', { 'pointer-events': 'none' });
    App.overlayG.appendChild(App.boxSelG);
  }
  App.drawBoxSelect();
  try { App.svg.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件无活动指针 */ }
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
    /* 右上角小符号（跟随蓝框移动） */
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
  b.mark.setAttribute('x', x + w); // 右上角
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
    /* 点按未拖动：按原有 Tab 点击切换选中（加入/移出多选）。
       注意：startBoxSelect 已对画布设置 pointer capture，pointerup 的 target 恒为画布，
       hitLayer 会失效——用 elementFromPoint 还原坐标处的真实元素 */
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
  App.state.selBarDismissed = true; // Tab 框选不呼出功能栏
  App.setSelection(Array.from(s));
  /* 白框归位到框选集合的最上层（面板第一个图层）：
     框选后白框总是自动选中集合第一个图层，不保留原位（含原白框已在集合内的情况）；
     闪烁动画跟随整个集合（白框在集合内才全部闪）。
     scrollItemToTop 同时滚动图层栏，让显示的白框（wheelBox）同步到位 */
  if (s.size) {
    let target = null;
    for (let i = App.state.layers.length - 1; i >= 0; i--) {
      if (s.has(App.state.layers[i].id)) { target = App.state.layers[i]; break; }
    }
    if (target) {
      App.scrollItemToTop(target);
      App.syncPanelSelectionClasses();
      /* setSelection 在归位之前执行，overlay 已按旧白框构建过；
         归位后补一次同步（不重启动画），闪烁动画跟随新白框 */
      if (App.requestFlashRefresh) App.requestFlashRefresh(false);
    }
  }
};

/* 点在凸多边形内（各边叉积同号） */
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
/* 线段相交（含端点） */
App.segIntersect = function (p1, p2, p3, p4) {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (d === 0) return false;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
};
/* 图层实际图形（旋转角点多边形）与蓝框矩形是否相交：
   不用轴对齐包围盒（细长图案旋转后包围盒远大于实际图形，会误选框外图层） */
App.layerPolyHitBox = function (layer, x, y, w, h) {
  const bb = App.getItemDocBBox(layer);
  const poly = (bb.corners && bb.corners.length === 4) ? bb.corners
    : [{ x: bb.x, y: bb.y }, { x: bb.x + bb.w, y: bb.y }, { x: bb.x + bb.w, y: bb.y + bb.h }, { x: bb.x, y: bb.y + bb.h }];
  const rect = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  /* 图案任一角点在框内 */
  if (poly.some(p => p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h)) return true;
  /* 框任一角点在图案内 */
  if (rect.some(p => App.pointInPoly(p, poly))) return true;
  /* 任一边相交 */
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      if (App.segIntersect(poly[i], poly[(i + 1) % 4], rect[j], rect[(j + 1) % 4])) return true;
    }
  }
  return false;
};
/* 与蓝框相交的顶层图层（合并分组：任一子图案在框内 → 整组） */
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

/* ---------- 选中工具栏 ---------- */
/* 功能栏呼出/收起（带滑入滑出过渡；高频调用安全：重复同向调用直接跳过） */
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
  /* 定位按钮：没有可定位的图层（白框停在「+」栏 / 无图层）就置灰不可用。
     这句必须写在下面的早退之前——白框停靠时本函数会提前 return，
     而那时恰恰是最需要它置灰的时候。 */
  const locateBtn = $('#btnLocateLayer');
  if (locateBtn) locateBtn.disabled = !App.whiteBoxLayer();
  /* 颜色面板跟随白框：单个普通图层同步、合并分组不同步、编辑中不同步 */
  if (App.syncColorPanelToTargets) App.syncColorPanelToTargets();
  /* 无选中或编辑中：隐藏并返回（按钮可用状态只在可见时才有意义） */
  if (!App.state.selected.size || inEdit || App.state.plusAnchorActive) { App.setSelToolbarVisible(false); return; }
  const items = App.operationTargets();
  const single = items.length === 1;
  const canReplace = single && items[0].kind !== 'merged';
  $('#btnReplace').disabled = !canReplace;
  $('#btnMerge').disabled = items.length < 2;
  $('#btnSplit').disabled = !App.splitTarget();
  /* 蒙版按钮：全部已是蒙版 → 禁用“切换为蒙版”；无蒙版 → 禁用“切换为图层” */
  const allMask = items.every(l => !!l.isMask);
  const anyMask = items.some(l => !!l.isMask);
  $('#btnToMask').disabled = allMask;
  $('#btnToLayer').disabled = !anyMask;
  /* 可见性：仅鼠标点击/Enter 呼出（Tab 手势/白框移动后收起，多选时呼出后按钮作用于整个集合） */
  const show = !App.state.selBarDismissed;
  App.setSelToolbarVisible(!!show);
};


/* ---------- 蒙版 / 翻转 ---------- */
/* 切换所选图层为蒙版（棋盘格指示）或普通图层；合并图层递归处理全部子图层 */
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
    /* 蒙版切换改变了这些图层的显示：缓存必须失效并按新模型重绘。
       大集合几何未变，可保留旧 autoStatic 到新位图原子落地，杜绝 2000 mask 的中间绘制峰值。 */
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

  /* 合并分组本身没有独立图形，不必再清空并重挂全部子 DOM。叶子按 6ms 预算分片重建，
     避免一次操作同步创建数千组 mask/use/rect 节点。 */
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

/* 翻转所选图层（合并图层整体翻转，不影响子图层各自状态） */
App.flipSelected = function (axis) {
  const items = App.operationTargets();
  if (!items.length) return;
  App.history.markDiscrete();
  items.forEach(l => {
    /* 合并分组：锚点远离内容中心，直接翻转标志会让内容绕锚点镜像（跳到远处/消失），
       翻转后重算锚点保持内容几何中心不动（与普通图层绕自身中心翻转一致） */
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
  /* 翻转同样改变显示：位图缓存必须失效并重绘（否则画布上还是翻转前的样子） */
  items.forEach(l => { if (App.dropEditStaticItem) App.dropEditStaticItem(l); });
  if (App.contentChanged) App.contentChanged();
  try { App.log('info', '翻转', { axis, layers: items.length }); } catch (e) { /* ignore */ }
  showToast(axis === 'h' ? App.i18n.t('toast.sel.flipH') : App.i18n.t('toast.sel.flipV'));
};

/* ---------- 剪切 / 复制 / 粘贴 ---------- */
/* 白框所在的图层（左侧图层栏白框即当前图层，无需显式选中）；
   白框停靠在首位「+」功能栏上时没有对应图层 → null（粘贴走第 2 位分支） */
App.whiteBoxLayer = function () {
  if (App.state.plusAnchorActive) return null;
  if (!App.state.layers.length) return null;
  const ids = App.state.layers.slice().reverse().map(l => l.id); // 面板顺序（最上层在前）
  let i;
  if (App.lastWheelIdx !== undefined) i = clamp(App.lastWheelIdx, 0, ids.length - 1);
  else if (App.state.selected.size === 1) i = ids.indexOf(Array.from(App.state.selected)[0]);
  else i = 0;
  if (i < 0 || i >= ids.length) i = 0;
  return App.findLayer(ids[i]);
};
/* 统一的操作目标：Tab 多选状态操作整个选中集合；
   否则始终操作白框所在图层——选中判定全面跟随白框（剪切/删除/复制/工具栏按钮/颜色全部一致） */
App.operationTargets = function () {
  if (App.state.selectedByTab && App.state.selected.size) return App.selectedItems();
  const box = App.whiteBoxLayer();
  return box ? [box] : App.selectedItems();
};
/* 多选状态下白框是否已滚出集合：此时 X 剪切 / Delete 删除跟随白框图层，
   而不是继续作用在集合上（集合本身不被取消） */
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
  /* 多选状态下白框滚出集合：X 剪切作用于白框图层（集合本身保留） */
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
  else App.syncPanelSelectionClasses(); // 白框原位保留，不呼出功能界面
  App.refreshClipboardPanel();
  showToast(App.i18n.tf('toast.sel.cut', { n: App.state.clipboard.length }));
};

/* 复制：只放入剪切板，不立即生成副本 */
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
  /* 粘贴不消耗剪切板：可反复粘贴，直到下一次剪切/复制才顶替 */
  const newLayers = items.map(slim => App.deserializeLayer(slim));
  /* 大组粘贴时隐藏图层容器：逐层 DOM 插入会触发增量布局（千层粘贴卡数秒） */
  const hideBatch = newLayers.length > 50 && App.layersRoot.style.display !== 'none';
  if (hideBatch) App.layersRoot.style.display = 'none';
  const sel = App.selectedItems();
  /* 粘贴位置：①白框停靠在首位「+」功能栏 → 插到第 2 位（现顶层之上）；
     ②白框所在图层 → 贴到它下方；③无白框用单选图层；④都没有则追加 */
  if (App.state.plusAnchorActive && App.state.layers.length) {
    /* 数组末尾 = 面板第一行 = 最顶层（实测：数组 [1,2,3] ↔ DOM [3,2,1]）；
       「+」栏正下方那一行就是最顶层 → 新层插到数组原末尾；多图层时第 1 个在最上、后续依次向下 */
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
    /* 停靠态【不】调用 scrollItemToTop：它的首句是 if (plusAnchorActive) setPlusAnchor(false)，
       会把刚停靠好的白框踢回图层行（实测 anchoredAfter=false），用户就没法连续按 Y 往「+」栏下方粘。
       新层已在最顶层、列表本就停在顶（停靠态 scrollTop=0），无需滚动定位 */
    try { App.log('info', '粘贴到「+」栏下方', { layers: newLayers.length, insertAt: insertAt, firstId: newLayers[0] && newLayers[0].id }); } catch (e) { /* ignore */ }
    if (App.contentChanged) App.contentChanged();

    return;
  }
  let anchor = App.whiteBoxLayer();
  try { App.log('info', '粘贴（非停靠）', { layers: newLayers.length, anchorId: anchor && anchor.id }); } catch (e) { /* ignore */ }
  if (!anchor && sel.length === 1 && App.state.layers.includes(sel[0])) anchor = sel[0];
  if (anchor && App.state.layers.includes(anchor)) {
    /* 粘贴到锚点图层的下方（数组/DOM 中锚点之前；多个图层时紧贴锚点依次向下排） */
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
  /* 恢复容器显示（一次布局）；「隐藏图层」/背景取色器 激活时保持隐藏 */
  if (hideBatch && !App.state.layersHidden && App.state.eyeMode !== 'bg') App.layersRoot.style.display = '';
  /* 粘贴后不自动选中：仅白框定位到粘贴层（避免粘贴产生的选中被后续 Tab 多选意外带上） */
  App.state.selectedByTab = false;
  App.state.selBarDismissed = false;
  App.setSelection([]);
  /* 白框自动移到新粘贴的图层上（多个时指向最上层粘贴层） */
  if (newLayers.length) {
    const topPaste = newLayers[newLayers.length - 1];
    if (App.scrollItemToTop) App.scrollItemToTop(topPaste, true);
  }
  if (App.contentChanged) App.contentChanged();

};

App.deleteSelection = function () {
  const hadSel = App.state.selected.size > 0;
  /* 多选状态下白框滚出集合：Delete 删除白框图层（集合本身保留） */
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

/* 删除图层栏里的全部图层 */
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
  /* 清空后重置「隐藏图层」状态：否则再放的新图案默认仍隐藏（按钮与显示脱节） */
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
/* 拆分目标：操作集合为单个合并分组时拆集合；否则白框所在图层是合并分组时拆白框图层
   （多选状态滚轮把白框移到未选的合并分组上，拆分按钮应作用于白框分组而不是整个多选集合） */
App.splitTarget = function () {
  const items = App.operationTargets();
  if (items.length === 1 && items[0].kind === 'merged') return items[0];
  const box = App.whiteBoxLayer();
  return (box && box.kind === 'merged') ? box : null;
};

/* ---------- 选中工具栏事件 ---------- */
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
    /* 取消所有高亮：清空选定并复位 Tab 标志，工具栏随之隐藏 */
    App.state.selectedByTab = false;
    App.setSelection([]);
  });
  $('#btnDeleteAll').addEventListener('click', App.deleteAllLayers);
  $('#btnLocateLayer').addEventListener('click', App.locateWhiteBoxLayer);
};

/* 定位图层位置：把画布可视区中心移到【白框所在图层】的文档包围盒中心。
   只平移，不改缩放；不写历史（纯视图操作，与拖拽平移同类）。
   多选时同样取白框那一层，而不是整个多选集合的并集中心。 */
App.locateWhiteBoxLayer = function () {
  const layer = App.whiteBoxLayer();
  if (!layer) return;                       /* 按钮已置灰；这里再挡一次 */
  const b = App.getItemDocBBox(layer);
  if (!b || !isFinite(b.x) || !isFinite(b.y) || !isFinite(b.w) || !isFinite(b.h)) return;
  const r = App.wrap.getBoundingClientRect();
  const v = App.state.view;
  const sc = v.scale || 1;
  /* viewBox = "v.x v.y (w/scale) (h/scale)" ⇒ 可视区中心 = v.x + w/(2*scale)
     令其等于图层中心，反解 v.x / v.y */
  v.x = (b.x + b.w / 2) - r.width / (2 * sc);
  v.y = (b.y + b.h / 2) - r.height / (2 * sc);
  App.updateView();
};

/* 高亮全部图层：所有顶层图层加入选定（含合并分组；白框位置保持不动） */
App.selectAllLayers = function () {
  if (!App.state.layers.length) { showToast(App.i18n.t('toast.sel.noHighlight')); return; }
  App.state.selectedByTab = true;
  App.setSelection(App.state.layers.map(l => l.id));
  showToast(App.i18n.tf('toast.sel.highlightedAll', { n: App.state.layers.length }));
};
