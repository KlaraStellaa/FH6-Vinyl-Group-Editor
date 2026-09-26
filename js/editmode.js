'use strict';
/* 编辑模式：五种模式（1移动/2大小/3旋转/4倾斜/5透明度）、WASD/方向键/鼠标、角度与透明度显示、Y 复制 */
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
  /* 手柄显示开关：隐藏时大小模式不画手柄、鼠标不触发手柄（拖图案内部移动保留） */
  $('#btnShowHandles').addEventListener('click', () => {
    App.state.showHandles = !App.state.showHandles;
    App.updateEditBar();
    App.drawOutlines();
  });
  /* 缩放锚点：点按钮 = 开始放置（再点 = 取消放置） / 已固定 = 清除锚点。
     与 F 键共用 App.toggleAnchor —— 两套状态逻辑不允许分叉 */
  $('#btnPlaceAnchor').addEventListener('click', () => App.toggleAnchor());
  $$('#editBar .edit-modes button[data-mode]').forEach(b => {
    b.addEventListener('click', () => App.setEditMode(b.getAttribute('data-mode')));
  });
  $('#editValueInput').addEventListener('change', App.editValueCommit);
  $('#editValueInput').addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.target.blur(); }
  });
  /* 编辑条滑条：旋转/倾斜/透明度三模式都有——拖动 = 同步到输入框后走统一提交路径（双向同步） */
  $('#editValueRange').addEventListener('input', () => {
    if (!['skew', 'opacity'].includes(App.state.editMode)) return;   /* 旋转模式无滑条 */
    if (App.cancelColorPreview) App.cancelColorPreview();
    $('#editValueInput').value = $('#editValueRange').value; // 输入框跟随滑条显示
    App.editValueCommit(); // 与回车/输入框提交同一路径
  });
};

/* 叶子颜色快照（递归到叶子层）：嵌套分组的 color 为 ''，直接按分组恢复会把子图层全部洗白 */
App.leafColorEntries = function (l) {
  if (l.kind !== 'merged') return [{ c: l, color: l.color }];
  return (l.children || []).reduce((acc, ch) => acc.concat(App.leafColorEntries(ch)), []);
};

/* Transform batching shared by edit gestures.  applyItemTransform remains the
   single model→DOM path, but nested calls defer overlay refresh until the outer
   batch exits.  This keeps model order and history semantics unchanged. */
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

/* ---------- 编辑模式内独立撤销/重做（每个手势一个撤回点；退出编辑后一步撤回整段） ---------- */
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
    /* 复制的撤回：snapshot 携带 despawn（本次操作新建的图层 id 列表）时，
       撤销先移除这些图层（Y 复制出来的副本），再恢复原图层字段 —— 副本与锚点各自安好 */
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
    App.groupRebase(); // 组会话以恢复后的状态为新起点（旧 M0 失配）
    App.drawOutlines();
    App.updateEditValue();
    App.refreshLayerThumbs();
  },
  /* 每个手势开始前记录一次撤回点（手势过程中不重复记录） */
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
    /* 编辑内撤销：先撤销未点「应用」的颜色预览 */
    if (App.cancelColorPreview) App.cancelColorPreview();
    this.redoStack.push(this.snapshot());
    this.gesture = false;
    this.restore(this.stack.pop());
    return true;
  },
  redo: function () {
    if (!this.redoStack.length) return false;
    /* 编辑内重做：先撤销未点「应用」的颜色预览 */
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
  /* 进入编辑：撤销未点「应用」的颜色预览 */
  if (App.cancelColorPreview) App.cancelColorPreview();
  /* 新编辑会话不继承上一段的缩放锚点（锚点绑定编辑目标，目标可能完全不同） */
  App.clearAnchor();
  /* 取色器激活中进入编辑：先退出（否则取色器拦截指针、编辑目标保持隐藏不可见） */
  if (App.state.eyeMode) App.setEyedropper(null);
  try { App.log('info', '进入编辑', { type: spec && spec.type, id: spec && spec.id, ids: spec && spec.ids ? spec.ids.length : undefined }); } catch (e) { /* ignore */ }
  if (!App.editTargets2(spec).length && spec.type !== 'bg') return;
  App.state.edit = spec;
  App.state.editMode = 'move';
  App.state.sizeMode = 'free';
  App.state.editFlipStep = 0; // Tab 翻转循环从“无翻转”状态开始计数
  App.editHist.reset(); // 编辑会话内的撤回点是独立的
  /* Esc 取消编辑的历史记录点：记录编辑会话开始时的栈位置（cancelTop 据此
     只丢弃会话记录、保留编辑期间独立操作的记录） */
  App.editHistStart = App.history.undoStack.length;
  /* 编辑会话快照（Esc 取消恢复用）+ 撤销历史记录点 */
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
  /* 多选整组（≥2 目标）：初始化组矩阵会话——整组倾斜/缩放/旋转与合并分组
     同一数学模型（每个内容点按组矩阵精确变形，旋转层不再"各改各的"） */
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
  eb.classList.remove('sve-editbar-out');   /* 快速退出再进入时清掉退场动画 */
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
  App.drawOutlines();
  /* import 位图化：进入编辑立即恢复编辑层的矢量显示 */
  if (App.refreshImpBitmaps) App.refreshImpBitmaps();
  /* 进编辑先撤下视口位图（方案A）：否则位图里烘着「进编辑之前」的目标副本，
     编辑中视觉会停在原位原形状 —— 2026-09-11 用户报障 */
  if (App.autoStaticRelease) App.autoStaticRelease();
  /* 编辑模式静态化：大量图层时非编辑层合成背景位图（编辑流畅） */
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
  /* 完成/取消编辑一律清除锚点与放置状态（Esc 取消不写历史快照——锚点本来就不进模型） */
  App.clearAnchor();
  try { App.log('info', '退出编辑', { cancel: !!cancel, type: App.state.edit.type }); } catch (e) { /* ignore */ }
  App.editHistStart = undefined; // 编辑会话结束：历史记录点恢复全局语义
  /* 退出编辑：撤销未点「应用」的颜色预览 */
  if (App.cancelColorPreview) App.cancelColorPreview();
  const es = App.editSession;
  App.editHist.reset(); // 编辑会话内的撤回点随退出清空（退出后一步撤回整段）
  if (cancel && es) {
    /* Esc 取消：回到本次编辑前的状态（批量恢复，避免逐层刷新造成卡顿） */
    App.state.batching = true;
    try {
      es.snapshot.forEach(s => {
        s.it.x = s.x; s.it.y = s.y;
        s.it.sx = s.sx; s.it.sy = s.sy;
        s.it.rot = s.rot; s.it.skew = s.skew; s.it.opacity = s.opacity;
        s.it.flipH = !!s.flipH; s.it.flipV = !!s.flipV;
        App.applyItemTransform(s.it);
        App.markThumbDirty(s.it);
        /* 颜色恢复到各叶子图层的原始颜色（嵌套分组递归，不经过分组的空颜色） */
        if (s.colors) {
          s.colors.forEach(p => App.setLayerColor(p.c, p.color));
        } else if (s.it.kind !== 'bg' && s.color !== undefined) {
          App.setLayerColor(s.it, s.color);
        }
      });
      App.state.lastColor = es.lastColor;
      /* 编辑期间按 Y 复制的图层保留：Esc 只回退原图层的修改，不删除复制层 */
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
  /* 编辑模式静态化：退出后保持背景位图（非编辑层不立即恢复，
     避免 1942 层全量恢复渲染卡 30 秒+）；交互层由 updateFlashOverlays 按需恢复 */
  if (App.updateEditStaticViewport) App.updateEditStaticViewport();
  App.state.keys.clear();
  App.drag = null;
  /* 退出编辑：清空单选/遗留单选留下的选中残留（编辑期间 selected 保持进入时的值不动。
     不清理的话，退出后白框滚轮移到其他图层再按 Tab 多选，会把原编辑图层一起带上；
     多选集合（≥2 个）保留——多选编辑退出后仍维持多选状态 */
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
  /* 面板重新显示后重新对齐白框（编辑期间面板隐藏时对齐被跳过，不补一次会停在错误位置） */
  if (App.alignWheelScroll) App.alignWheelScroll();
  /* 编辑期间合并分组的缩略图重绘被跳过：退出时统一刷新 */
  App.refreshLayerThumbs();
  App.updateSelToolbar();
  App.drawOutlines();
  /* 退出编辑后补一次闪动同步：Esc 取消恢复期间 batching 会跳过 requestFlashRefresh，
     不补的话闪动覆盖层会停留在取消前编辑过的位置/大小/旋转 */
  if (App.requestFlashRefresh) App.requestFlashRefresh(false);
  /* 退出编辑瞬间图案不得被闪动颜色覆盖：3 秒周期的动画可能正播放到红/绿/蓝阶段，
     此时退出会看到图案短暂变蓝——立即取消当前动画并隐藏覆盖层
     （覆盖层 DOM 保留，3 秒周期照常继续）；同时作废进行中的合成构建，
     防止其异步 resolve 后重播动画再染一次色 */
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
  /* 切换编辑模式：撤销未点「应用」的颜色预览 */
  if (App.cancelColorPreview) App.cancelColorPreview();
  /* 移动/旋转/倾斜/透明度：离开大小模式 = 取消「正在放置」（尚未点击固定时不保存临时锚点）；
     已固定的锚点保留信息，回到大小模式继续生效 */
  if (App.state.anchorPlacing && mode !== 'size') App.cancelAnchorPlacing();
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
  /* 放置锚点：只在大小模式显示；非「单个普通图案」（背景/合并分组/多选）时禁用 */
  const anchorBtn = $('#btnPlaceAnchor');
  if (anchorBtn) {
    anchorBtn.classList.toggle('hidden', !isSize);
    anchorBtn.disabled = !(isSize && App.anchorEligible());
    const anchorTxt = App.i18n.t(App.state.anchor ? 'edit.anchorCancel' : 'edit.anchorPlace');
    anchorBtn.textContent = anchorTxt;
    anchorBtn.setAttribute('textContent', anchorTxt);   // 与 i18n.apply 的写法保持一致（探针按属性读）
    anchorBtn.setAttribute('data-i18n', App.state.anchor ? 'edit.anchorCancel' : 'edit.anchorPlace');
    anchorBtn.classList.toggle('active', !!App.state.anchorPlacing);
  }
  /* 编辑条（旋转/倾斜/透明度）：三种模式共用第 2 行，且都显示滑条 */
  const rng = $('#editValueRange');
  $('#editValueBox').classList.toggle('hidden', !isRotSkewOp);
  /* 滑条：旋转模式不显示（用户 2026-09-11：「删去旋转之前莫名其妙不知道怎么加的滑条」，
     但明确保留倾斜角度与透明度的滑条） */
  rng.classList.toggle('hidden', !isRotSkewOp || mode === 'rotate');
  if (isRotSkewOp) {
    $('#editValueLabel').textContent = App.i18n.t(mode === 'rotate' ? 'edit.label.rotate' : mode === 'skew' ? 'edit.label.skew' : 'edit.label.opacity');
    $('#editValueUnit').textContent = mode === 'opacity' ? '%' : '°';
    if (mode === 'opacity') { rng.min = 0; rng.max = 100; rng.step = 1; }
    else { rng.min = -180; rng.max = 180; rng.step = 0.5; }
  }
  App.updateEditValue();
  /* 第 2 行可见性：大小模式（手柄显示/方向指示/等比）或 旋转倾斜透明度（编辑条）或 背景编辑（移除背景）任一项可见即显示 */
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
    $('#editValueRange').value = d; // 滑条与输入框同步（-180~180）
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
  /* 编辑数值输入：撤销未点「应用」的颜色预览 */
  if (App.cancelColorPreview) App.cancelColorPreview();
  const v = parseFloat($('#editValueInput').value);
  if (isNaN(v)) { App.updateEditValue(); return; }
  const items = App.editTargets();
  if (App.state.editMode === 'rotate') {
    if (items.length > 1) {
      /* 多选：组级旋转（相对第一个图层的角度增量，绕组中心），与合并分组一致 */
      App.groupRotateItems(items, v - items[0].rot);
    } else items.forEach(it => {
      if (it.kind === 'merged') { const c = App.mergedContentCenter(it); it.rot = v; App.anchorToKeepCenter(it, c.x, c.y); }
      else {
        const af = App.anchorFixedLocal(it);
        if (af) {
          /* 有锚点：输入角度直接绕锚点旋转（锚点文档坐标不动） */
          const p0 = App.itemLocalToDoc(it, af.x, af.y);
          it.rot = v;
          App.placeItemAtDocPoint(it, af.x, af.y, p0.x, p0.y);
        } else it.rot = v;
      }
      App.applyItemTransform(it);
    });
  } else if (App.state.editMode === 'skew') {
    if (items.length > 1) {
      App.groupSkewItems(items, v - items[0].skew);
    } else items.forEach(it => {
      if (it.kind === 'merged') { const c = App.mergedContentCenter(it); it.skew = v; App.anchorToKeepCenter(it, c.x, c.y); }
      else it.skew = v;
      App.applyItemTransform(it);
    });
  } else if (App.state.editMode === 'opacity') items.forEach(it => { it.opacity = clamp(v / 100, 0, 1); App.applyItemTransform(it); App.markThumbDirty(it); });
  App.drawOutlines();
  App.updateEditValue();
  App.refreshLayerThumbs();
};

/* ---------- 变换操作 ---------- */
App.applyEditMove = function (dx, dy) {
  App.withTransformBatch(() => App.editTargets().forEach(it => {
    it.x += dx; it.y += dy;
    App.applyItemTransform(it);
  }));
  if (App.scheduleFrameUpdate) App.scheduleFrameUpdate('edit');
  else App.drawOutlines();
};
/* 编辑缩放支持负值：负值 = 镜像（flip 标志 + 正缩放）。
   语义为“绝对值”（参数 = 期望的带符号缩放）：连续增量（键盘 WASD / 鼠标拖拽）
   过零后符号保持，翻转只发生一次，不会在 0 附近反复翻转循环 */
App.applyScaleWithFlip = function (it, sx, sy) {
  if (sx < 0) { it.flipH = true; sx = -sx; }
  else if (sx > 0) { it.flipH = false; }
  if (sy < 0) { it.flipV = true; sy = -sy; }
  else if (sy > 0) { it.flipV = false; }
  it.sx = clamp(sx, 1e-6, 1e6);
  it.sy = clamp(sy, 1e-6, 1e6);
};

/* 缩放单图层时保持视觉中心不动：仅合并分组需要（锚点可能远离视觉中心，
   直接改 sx/sy 会绕锚点缩放导致图案整体跑偏）；普通图层锚点=内容几何中心，
   绕锚点缩放视觉中心自然不动，锚点保持原位（不随缩放移动） */
App.scaleItemKeepCenter = function (it, fx, fy) {
  const af = App.anchorFixedLocal(it);
  if (af) {
    /* 有锚点：固定点 = 锚点本地坐标（不是几何中心）。先把锚点的文档坐标记下来，
       缩放后重算 x/y 让它回到原处 —— 模型 x/y/sx/sy 保持真实，保存/撤销/导出都一致 */
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
/* ---------- 多选整组编辑 = 组矩阵模型（与合并分组根叠加同构） ----------
   合并分组"是一个整体"的原因：倾斜/缩放/旋转全部叠加在分组根矩阵上，
   组内每个内容点（包括旋转过的图案）都按同一个矩阵变形。
   多选没有公共根，若每层各改各的 rot/skew/sx（再加位置模拟），
   旋转过的图案变形方向会与整组不一致——视觉上"不是一个整体"。
   解法：编辑会话内记录每个成员在会话开始时的完整文档矩阵 M0 与固定的
   组内容中心 C，任何组级操作只累积组参数 {rot, skew, sx, sy}，随后
   每层从 G(C, 参数)·M0 精确分解回字段（矩阵分解与 splitMerged 烘焙同源）。
   这样任意仿射组合（含旋转层的倾斜/非等比缩放）都与合并分组完全等价。 */
/* 成员完整文档矩阵（字段 → 仿射，含位移）：T(x,y)·R(rot)·S(sx,sy)·K(skew)，翻转=负号进 S */
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
/* 组矩阵：G = T(C)·R(rot)·S(sx,sy)·K(skew)·T(-C)（与分组根 transform 同序，绕组内容中心） */
function groupMatrix(g, C) {
  return App.FZA.matFromString('translate(' + C.x + ' ' + C.y + ') rotate(' + (g.rot || 0) +
    ') scale(' + (g.sx || 1) + ' ' + (g.sy || 1) + ') skewX(' + (g.skew || 0) + ') translate(' + (-C.x) + ' ' + (-C.y) + ')');
}
/* 把组参数分解写回每个成员的字段（每层 = G·M0），并同步 el 变换。
   返回 false = 当前会话无组状态（调用方走原单层/合并逻辑） */
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
    it.skew = p.skew;
    it.sx = Math.abs(p.sx) || 1;
    /* 负 sy = 垂直镜像（与 splitMerged 烘焙同一约定）；水平反射由分解折入 rot±180，
       几何完全保真；每次操作从会话起点 M0 重算，无累积漂移 */
    it.flipH = false;
    it.flipV = !!(sy < 0);
    it.sy = Math.abs(sy) || 1;
    App.applyItemTransform(it);
    App.markThumbDirty(it);
  }));
  App.drawOutlines();
  return true;
};
/* 组级变换入口：更新组参数并重算全部成员（返回 false = 非组会话，调用方走单层路径） */
App.groupTransformApply = function (upd) {
  const es = App.editSession;
  if (!es || !es.grp) return false;
  const items = App.editTargets();
  if (items.length < 2) return false;
  upd(es.grp);
  return App.groupDecompose();
};
/* 撤销/重做恢复字段后：组会话以当前状态为新起点（组参数清零），避免旧 M0 失配 */
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
/* 多选整组按统一比例缩放（与合并分组同一语义）：所有图层倍率同乘 fx/fy，
   位置绕组中心等比拉伸（组中心不动），负比例 = 整组镜像。
   合并分组目标用内容中心跟随（锚点远离内容中心，直接用锚点会跑偏） */
App.applyGroupScaleAt = function (items, cx, cy, fx, fy) {
  items.forEach(it => {
    if (it.kind === 'merged') {
      const p = App.mergedContentCenter(it);
      const tx = cx + (p.x - cx) * fx;
      const ty = cy + (p.y - cy) * fy;
      App.applyScaleWithFlip(it, (it.flipH ? -1 : 1) * (it.sx || 1) * fx, (it.flipV ? -1 : 1) * (it.sy || 1) * fy);
      App.anchorToKeepCenter(it, tx, ty);
    } else {
      it.x = cx + (it.x - cx) * fx; // fx 负 = 绕组中心镜像位置（配合内容 flipH = 整组镜像）
      it.y = cy + (it.y - cy) * fy;
      /* 带符号缩放：比例乘法保留当前翻转标志（fx 正不变、fx 负镜像切换） */
      App.applyScaleWithFlip(it, (it.flipH ? -1 : 1) * (it.sx || 1) * fx, (it.flipV ? -1 : 1) * (it.sy || 1) * fy);
    }
    App.applyItemTransform(it);
    App.markThumbDirty(it);
  });
};
App.applyEditScale = function (fx, fy) {
  const items = App.editTargets();
  if (items.length >= 2) {
    /* 多选整组：组矩阵模型（每个内容点按组矩阵精确变形，与合并分组等价） */
    if (App.groupTransformApply(g => { g.sx *= fx; g.sy *= fy; })) {
      App.refreshLayerThumbs();
      return;
    }
  }
  App.withTransformBatch(() => items.forEach(it => App.scaleItemKeepCenter(it, fx, fy)));
  App.drawOutlines();
  App.refreshLayerThumbs();
};
/* 大小调整（键盘 WASD）：按带符号绝对值增量连续调整。
   旧实现用比例因子 (sx+ddx)/sx：sx 接近 0 时因子爆炸、镜像反复翻转，
   导致按住缩小键在 0 附近循环；现在缩放值线性穿过零点，
   过零只翻转一次镜像，|sx| 从 0 连续增长（与鼠标拖拽一致） */
App.scaleItemKeepCenterAbs = function (it, ddx, ddy) {
  const ssx = (it.flipH ? -1 : 1) * (it.sx || 1); // 带符号缩放（镜像 = 负）
  const ssy = (it.flipV ? -1 : 1) * (it.sy || 1);
  if (it.kind === 'merged') {
    /* 键盘 WASD 大小速度归一化：与单图层视觉速度一致。
       增量是绝对值（sx += d），单图层视觉变化 = 本机宽(128)×d；
       合并组内容宽（当前比例）大 → 同样增量视觉变化大（"分组后调整大小更快"），
       按 128/内容宽 折算增量，视觉变化恒定 = 128×d */
    let bw = 128;
    try {
      const loc = it._localBB;
      if (loc) bw = Math.max(1, loc.pts[2][0] - loc.pts[0][0]);
      else {
        const lb = App.computeLocalBBox(it);
        if (lb && lb.w > 0) bw = lb.w;
      }
    } catch (e) { /* ignore */ }
    const k = 128 / Math.max(1, bw * Math.abs(ssx));
    const nddx = ddx * k, nddy = ddy * k;
    const nsx = ssx + nddx, nsy = ssy + nddy;
    /* 合并分组：锚点远离内容中心（尤其旋转/倾斜后），位置必须用矩阵精确换算，
       保证缩放时【视觉中心不动】——标量比例（绕 cx 缩放锚点）在旋转/倾斜时会漂移。
       内容中心用纯矩阵计算（mergedContentCenter），不再每帧 getItemDocBBox——
       getScreenCTM 强制整组同步布局，大分组 WASD 缩放时掉帧、速度异常变慢 */
    const af = App.anchorFixedLocal(it);
    if (af) {
      /* 有锚点：固定点 = 锚点本地坐标（与普通图层同一套语义），视觉速度仍按上面的 k 归一化 */
      const p0 = App.itemLocalToDoc(it, af.x, af.y);
      App.applyScaleWithFlip(it, nsx, nsy);
      App.placeItemAtDocPoint(it, af.x, af.y, p0.x, p0.y);
    } else {
      const { lcx, lcy } = App.mergedLocalCenter(it);
      const c = App.mergedContentCenter(it); // 当前内容几何中心（旧矩阵）
      const M = App.FZA.layerMatrix({ flipH: nsx < 0, flipV: nsy < 0, sx: Math.abs(nsx), sy: Math.abs(nsy), rot: it.rot, skew: it.skew });
      it.x = c.x - (M.a * lcx + M.c * lcy);
      it.y = c.y - (M.b * lcx + M.d * lcy);
      App.applyScaleWithFlip(it, nsx, nsy);
    }
  } else {
    const nsx = ssx + ddx, nsy = ssy + ddy;
    const af = App.anchorFixedLocal(it);
    if (af) {
      /* 有锚点：绕锚点缩放，锚点文档坐标在手势前后保持一致（含过零/镜像） */
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
/* 多选整组键盘缩放：整组统一比例（与合并分组完全一致——不再各层各加各的）。
   增量换算比例：视觉速度与合并分组/单层一致（每帧视觉变化 = 128×d，
   与 scaleItemKeepCenterAbs 的 128 基准相同），换算基准 = 组当前视觉宽/高；
   组参数按比例累积（sx *= f），负比例（|128·d| 超过组宽）整组镜像。 */
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
App.applyEditScaleDelta = function (ddx, ddy) {
  if (!App.applyGroupScaleAbs(ddx, ddy)) {
    App.withTransformBatch(() => App.editTargets().forEach(it => App.scaleItemKeepCenterAbs(it, ddx, ddy)));
  }
  if (App.scheduleFrameUpdate) App.scheduleFrameUpdate('edit');
  else App.drawOutlines();
  /* 不在这里刷缩略图：WASD 按住期间每帧触发，合并分组/大分组的缩略图重绘很重，
     掉帧后 dt 被截断 → 调整大小速度变慢；编辑中图层栏隐藏，缩略图在退出编辑时统一刷新 */
};
function rotatePoint(p, c, deg) {
  const a = deg * D2R, cos = Math.cos(a), sin = Math.sin(a);
  return {
    x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin,
    y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos
  };
}
/* ---------- 合并分组：旋转/倾斜时保持内容几何中心不动 ----------
   merged 的锚点 (x,y) 远离内容中心（子图案整体相对锚点有偏移），
   旋转/倾斜若只改 rot/skew 或绕 AABB 中心换算，内容会绕锚点甩动/逐帧漂移。
   内容几何中心 = 本地包围盒中心 (lcx,lcy) 经当前变换矩阵映射到文档坐标；
   变换后把锚点重算为 内容中心 - M'(lcx,lcy)，视觉中心即保持不动（与缩放一致）。 */
App.mergedLocalCenter = function (it) {
  const loc = it._localBB;
  if (loc) return { lcx: (loc.pts[0][0] + loc.pts[2][0]) / 2, lcy: (loc.pts[0][1] + loc.pts[2][1]) / 2 };
  /* _localBB 未缓存（getBBox 尚未计算/返回空）时：用模型递归包围盒兜底，
     否则内容中心算成 (0,0)，组级旋转/倾斜时合并分组位置跑偏（"倾斜变位置"） */
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
/* 把锚点重算为：内容中心落在 (ccx, ccy)（用当前 rot/skew 的矩阵） */
App.anchorToKeepCenter = function (it, ccx, ccy) {
  const { lcx, lcy } = App.mergedLocalCenter(it);
  const M = App.FZA.layerMatrix({ flipH: it.flipH, flipV: it.flipV, sx: it.sx, sy: it.sy, rot: it.rot, skew: it.skew });
  it.x = ccx - (M.a * lcx + M.c * lcy);
  it.y = ccy - (M.b * lcx + M.d * lcy);
};
/* 编辑手势快照：merged 额外记录手势开始时的内容中心，旋转/倾斜拖动时保持 */
App.editTransformSnap = function (it) {
  const s = { it, x: it.x, y: it.y, sx: it.sx, sy: it.sy, rot: it.rot, skew: it.skew };
  if (it.kind === 'merged') {
    const c = App.mergedContentCenter(it);
    s.ccx = c.x; s.ccy = c.y;
  }
  return s;
};
/* 按快照保持 merged 内容中心（rot/skew 已按快照更新后调用） */
App.applySnapCenterKeep = function (s) {
  if (s.it.kind !== 'merged' || s.ccx === undefined) return;
  App.anchorToKeepCenter(s.it, s.ccx, s.ccy);
};

/* ---------- 缩放锚点（仅单个普通图案） ----------
   锚点 = 用户指定的固定点：缩放/旋转时该点在【文档坐标】中保持不动。
   存储为目标图层的【本地坐标】{ lx, ly }（内容中心 = 原点，与 modelBBox 同系），
   文档坐标每次由当前变换矩阵现算 —— 画布缩放/平移/切视图后锚点不会失效。
   锚点只活在编辑会话里（App.state.anchor），不写进图层模型、不进导出、不进历史。 */
App.anchorTarget = function () {
  const e = App.state.edit;
  if (!e || e.type !== 'layer') return null;      // 背景 / 多选：不可用
  const items = App.editTargets();
  if (items.length !== 1) return null;
  const it = items[0];
  /* 合并分组同样可以放锚点（用户 2026-09-15 要求取消「合并图层不能用锚点」的限制）：
     合并分组的本地坐标系就是分组自身的变换空间，四角包围盒与本地↔文档换算与普通图层同一套 */
  if (!it || it.kind === 'bg') return null;
  return it;
};
App.anchorEligible = function () { return !!App.anchorTarget(); };
/* 已固定、且仍属于当前编辑目标的锚点（否则 null） */
App.currentAnchor = function () {
  const a = App.state.anchor;
  if (!a || !a.placed) return null;
  const it = App.anchorTarget();
  if (!it || it.id !== a.layerId) return null;
  return a;
};
/* 当前应作为「固定点」的本地坐标：有锚点返回锚点，否则 null（调用方走原有中心路径）。
   锚点【只在大小模式生效】——切到移动/旋转/倾斜/透明度时暂时无效化（信息保留、图标隐藏），
   这些模式一律走各自的原有算法；回到大小模式继续作为缩放固定点。 */
App.anchorFixedLocal = function (it) {
  if (App.state.editMode !== 'size') return null;
  const a = App.currentAnchor();
  if (!a || !it || it.id !== a.layerId) return null;
  return { x: a.lx, y: a.ly };
};
/* 图层本地坐标 -> 文档坐标（当前模型字段的变换矩阵） */
App.itemLocalToDoc = function (it, lx, ly) {
  const M = App.FZA.layerMatrix(it);
  return { x: it.x + M.a * lx + M.c * ly, y: it.y + M.b * lx + M.d * ly };
};
/* 文档坐标 -> 图层本地坐标（矩阵求逆） */
App.docToItemLocal = function (it, px, py) {
  const M = App.FZA.layerMatrix(it);
  const det = M.a * M.d - M.b * M.c;
  if (!det) return { x: 0, y: 0 };
  const dx = px - it.x, dy = py - it.y;
  return { x: (M.d * dx - M.c * dy) / det, y: (M.a * dy - M.b * dx) / det };
};
/* 改 x/y，让本地点 (lx,ly) 的文档坐标落在 (px,py)（当前 rot/skew/sx/sy 不变） */
App.placeItemAtDocPoint = function (it, lx, ly, px, py) {
  const M = App.FZA.layerMatrix(it);
  it.x = px - (M.a * lx + M.c * ly);
  it.y = py - (M.b * lx + M.d * ly);
};
/* 锚点位置限制：目标图案变换后四角包围四边形内原样保留；外部投影到最近边 */
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
/* 目标图案的四角（模型包围盒，零布局；放置期间不变 → 缓存） */
App.anchorQuad = function (it) {
  const c = App._anchorQuadCache;
  if (c && c.id === it.id) return c.corners;
  const b = App.getItemDocBBox(it);
  const corners = (b && b.corners && b.corners.length >= 4) ? b.corners.slice(0, 4) : null;
  App._anchorQuadCache = { id: it.id, corners: corners };
  return corners;
};

/* ---------- 锚点图标（原生 SVG，无框架；屏幕尺寸恒定） ---------- */
App.anchorIconPx = 20;        // 图标屏幕外接尺寸
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
  /* 四段圆弧（缺口在上下左右）= “展开/瞄准”态；固定时整体收拢成环 = “合并”动画 */
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
/* 取消“合并”态：直接抹掉动画（不播反向展开动画，回到静态展开态） */
App.anchorUnmerge = function () {
  const arcs = App.anchorArcsEl;
  if (!arcs) return;
  try { arcs.getAnimations().forEach(a => a.cancel()); } catch (e) { /* 老环境无 WAAPI */ }
};
App.anchorMergeAnim = function () {
  const arcs = App.anchorArcsEl;
  if (!arcs || !arcs.animate) return;
  try {
    arcs.animate([{ transform: 'scale(1)' }, { transform: 'scale(0.55)' }],
      { duration: 240, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' });
  } catch (e) { /* ignore */ }
};
/* 每帧按状态重定位/显隐（只改 transform 与 style，不重建节点，动画不被打断） */
App.drawAnchorIcon = function () {
  const it = App.anchorTarget();
  const a = it ? App.currentAnchor() : null;
  const placing = !!(it && App.state.anchorPlacing);
  const show = !!it && App.state.editMode === 'size' && (!!a || placing);
  if (!show) { if (App.anchorIconEl) App.anchorIconEl.style.display = 'none'; return; }
  const el = App.ensureAnchorIcon();
  if (!el) return;
  el.style.display = '';
  const doc = placing
    ? (App.anchorHoverDoc || App.itemLocalToDoc(it, 0, 0))
    : App.itemLocalToDoc(it, a.lx, a.ly);
  const k = 1 / (App.state.view.scale || 1);   // 反向缩放：图标在屏幕上恒定尺寸
  el.setAttribute('transform', 'translate(' + fmtNum(doc.x, 3) + ' ' + fmtNum(doc.y, 3) + ') scale(' + fmtNum(k, 6) + ')');
};

/* ---------- 放置流程 ---------- */
App.startAnchorPlacing = function () {
  const it = App.anchorTarget();
  if (!it) return false;
  App.state.anchor = null;          // 重新放置：先丢弃旧锚点
  App.state.anchorPlacing = true;
  App.anchorHoverDoc = null;
  App._anchorQuadCache = null;
  App.anchorUnmerge();
  /* 起始预览 = 图案当前几何包围盒中心（合并分组的本地原点常远离内容，不能用 (0,0)） */
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
  /* 尚未点击固定：临时锚点直接丢弃，回到默认中心固定 */
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
/* F 键与按钮的唯一入口：同一状态机，不产生两套逻辑 */
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
/* 放置期间鼠标移动：限制在四角四边形内并跟随 */
App.onAnchorHover = function (clientX, clientY) {
  const it = App.anchorTarget();
  if (!it || !App.state.anchorPlacing) return;
  const pd = App.screenToDoc(clientX, clientY);
  const p = App.clampToQuad(pd, App.anchorQuad(it));
  App.anchorHoverDoc = p;
  App.anchorHoverLocal = App.docToItemLocal(it, p.x, p.y);
  App.drawAnchorIcon();
};
/* 点击固定：图案内部 = 点击处；图案外部 = 已限制后的边界位置 */
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
  App.anchorMergeAnim();            // 固定时播放一次“合并”动画，结束后保持合并静态态
  App.updateEditBar();
  App.drawOutlines();
  /* 固定锚点后统一刷新编辑界面（不绕过 contentChanged 造成缓存过期） */
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
/* 多选组级旋转：绕组中心旋转（每个图层位置跟随 + 自身 rot 同步），
   视觉上与合并分组整体旋转一致（不再各绕各的散开）。
   合并分组目标用【内容中心】跟随（锚点远离内容中心，直接用锚点会跑偏） */
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
/* 多选组级倾斜：绕组中心水平剪切（位置 x 偏移 + 每层 skew 同步），
   视觉上与合并分组整体倾斜一致。合并分组目标用内容中心跟随 */
App.groupSkewItems = function (items, dd, c) {
  if (!items.length) return;
  if (!c) c = groupCenter(items);
  const t = Math.tan(dd * D2R);
  items.forEach(it => {
    if (it.kind === 'merged') {
      const p = App.mergedContentCenter(it);
      const rx = p.x - c.x, ry = p.y - c.y;
      it.skew += dd;
      App.anchorToKeepCenter(it, c.x + rx + t * ry, c.y + ry);
    } else {
      const rx = it.x - c.x, ry = it.y - c.y;
      it.x = c.x + rx + t * ry;
      it.y = c.y + ry;
      it.skew += dd;
    }
    App.applyItemTransform(it);
  });
};
App.applyEditRotate = function (dd) {
  const items = App.editTargets();
  if (items.length > 1) {
    /* 多选：组矩阵模型（每个内容点绕组中心按同一矩阵旋转，与合并分组等价） */
    if (App.groupTransformApply(g => { g.rot += dd; })) {
      App.updateEditValue();
      App.refreshLayerThumbs();
      return;
    }
  }
  App.withTransformBatch(() => items.forEach(it => {
    if (it.kind === 'merged') {
      /* 合并分组：绕内容几何中心旋转锚点（AABB 中心在旋转中会漂移，不能用） */
      const c = App.mergedContentCenter(it);
      const p = rotatePoint({ x: it.x, y: it.y }, c, dd);
      it.x = p.x; it.y = p.y; it.rot += dd;
    } else {
      const af = App.anchorFixedLocal(it);
      if (af) {
        /* 有锚点：旋转中心 = 锚点（锚点文档坐标保持不动，与缩放同一套固定点语义） */
        const p0 = App.itemLocalToDoc(it, af.x, af.y);
        it.rot += dd;
        App.placeItemAtDocPoint(it, af.x, af.y, p0.x, p0.y);
      } else {
        const b = App.getItemDocBBox(it);
        const p = rotatePoint({ x: it.x, y: it.y }, { x: b.cx, y: b.cy }, dd);
        it.x = p.x; it.y = p.y; it.rot += dd;
      }
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
    /* 多选：组矩阵模型（倾斜作用在整组内容上，旋转层变形方向与合并分组一致） */
    if (App.groupTransformApply(g => { g.skew += dd; })) {
      App.updateEditValue();
      App.refreshLayerThumbs();
      return;
    }
  }
  App.withTransformBatch(() => items.forEach(it => {
    if (it.kind === 'merged') {
      /* 合并分组：倾斜后内容中心会随矩阵偏移，保持中心不动 */
      const c = App.mergedContentCenter(it);
      it.skew += dd;
      App.anchorToKeepCenter(it, c.x, c.y);
    } else {
      it.skew += dd;
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

/* ---------- 持续按键（WASD） ---------- */
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
    /* 屏幕固定速度：除以画布缩放，放大/缩小多少视觉速度一致；与当前比例无关 */
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
    /* A = 往左倾，D = 往右倾 */
    let d = 0;
    if (k.has('left')) d += App.state.editSpeeds.skew * dt;
    if (k.has('right')) d -= App.state.editSpeeds.skew * dt;
    if (d) App.applyEditSkew(d);
  } else if (mode === 'opacity') {
    const spd = (App.state.editSpeeds && isFinite(App.state.editSpeeds.opacity)) ? App.state.editSpeeds.opacity : 30;
    let d = 0;
    if (k.has('up')) d += (spd / 100) * dt;   // W = 更不透明
    if (k.has('down')) d -= (spd / 100) * dt;   // S = 更透明
    if (d) App.applyEditOpacityDelta(d);
  }
};

/* ---------- 方向键微调 ---------- */
/* dir：'up' | 'down' | 'left' | 'right'（语义方向，不依赖具体按键名，便于自定义快捷键） */
App.arrowStep = function (dir) {
  const mode = App.state.editMode;
  if (!mode) return;
  /* 编辑中任何操作：撤销未点「应用」的颜色预览 */
  if (App.cancelColorPreview) App.cancelColorPreview();
  const ns = App.state.nudgeSpeeds || {};
  const nv = (v, d) => (isFinite(v) ? v : d);
  App.editHist.checkpoint();
  App.editHist.endGesture(); // 单次按键 = 一步
  if (mode === 'move') {
    /* 屏幕固定速度：除以画布缩放（与 WASD 一致，放大/缩小后视觉位移相同） */
    const st = nv(ns.move, 0.2) / (App.state.view.scale || 1);
    let dx = 0, dy = 0;
    if (dir === 'left') dx -= st;
    if (dir === 'right') dx += st;
    if (dir === 'up') dy -= st;
    if (dir === 'down') dy += st;
    App.applyEditMove(dx, dy);
  } else if (mode === 'size') {
    const f = 1 + nv(ns.size, 0.8) / 100; // 默认 0.8%/次（与改造前一致）
    if (App.state.sizeMode === 'prop') {
      if (dir === 'up' || dir === 'right') App.applyEditScale(f, f);
      else if (dir === 'down' || dir === 'left') App.applyEditScale(1 / f, 1 / f);
    } else {
      if (dir === 'up') App.applyEditScale(1, f);
      else if (dir === 'down') App.applyEditScale(1, 1 / f);
      else if (dir === 'left') App.applyEditScale(f, 1);       // ← = 横向放大
      else if (dir === 'right') App.applyEditScale(1 / f, 1);  // → = 横向缩小
    }
  } else if (mode === 'rotate') {
    const d = nv(ns.rotate, 0.1);
    if (dir === 'left') App.applyEditRotate(-d);
    else if (dir === 'right') App.applyEditRotate(d);
  } else if (mode === 'skew') {
    /* 方向键与 A/D 一致：← = 往左倾，→ = 往右倾 */
    const d = nv(ns.skew, 0.1);
    if (dir === 'left') App.applyEditSkew(d);
    else if (dir === 'right') App.applyEditSkew(-d);
  } else if (mode === 'opacity') {
    const d = nv(ns.opacity, 1) / 100;
    if (dir === 'up') App.applyEditOpacityDelta(d);
    else if (dir === 'down') App.applyEditOpacityDelta(-d);
  }
};

/* ---------- 鼠标 ---------- */
/* 凸四边形（蓝框四角）内点判定：按顺时针/逆时针顺序传入 4 个角点 */
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
  /* 编辑中鼠标操作：撤销未点「应用」的颜色预览 */
  if (App.cancelColorPreview) App.cancelColorPreview();
  const mode = App.state.editMode;
  /* 正在放置锚点：画布上任意点击 = 在该处（已限制到图案四角范围内）固定锚点，
     本次点击不进入任何拖动手势 */
  if (App.state.anchorPlacing && mode === 'size') {
    App.fixAnchorAt(e.clientX, e.clientY);
    e.preventDefault();
    return;
  }
  if (mode === 'move') {
    /* 像素级命中：半透明边缘不算命中；模拟事件无坐标时退化为 DOM 命中 */
    const layer = (e.clientX === 0 && e.clientY === 0 && e.target)
      ? App.hitLayer(e)
      : App.hitLayerPaintedSync(e.clientX, e.clientY);
    if (!layer) return;
    const top = App.topOf(layer);
    const items = App.editTargets();
    const inTarget = items.some(it => it === top || (it.kind === 'merged' && it.children && it.children.includes(layer)));
    if (!inTarget) return;
    App.editHist.checkpoint(); // 手势开始前记录撤回点（拖动过程中不重复记录）
    App.drag = {
      kind: 'editmove',
      startX: e.clientX, startY: e.clientY,
      scale: App.state.view.scale,
      snap: items.map(it => ({ it, x: it.x, y: it.y }))
    };
    try { App.svg.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件无活动指针 */ }
    e.preventDefault();
  } else if (mode === 'size') {
    /* 手柄隐藏时：命中层与角部兜底判定全部禁用（拖图案内部=移动保留） */
    const gizmo = App.state.showHandles !== false;
    const hEl = gizmo ? (e.target.closest && e.target.closest('[data-h]')) : null;
    const g = App.handleGeometry();
    if (!g) return;
    /* 点击位置是否在图案框内：框内点击 = 移动（四角手柄的框内命中不算，判定只在框外） */
    const items = App.editTargets();
    const pd = App.screenToDoc(e.clientX, e.clientY);
    let inside = false;
    for (const it of items) {
      const b = App.getItemDocBBox(it);
      if (b.corners && b.corners.length >= 4 && App.pointInQuad(pd, b.corners)) { inside = true; break; }
    }
    let h = hEl ? hEl.getAttribute('data-h') : null;
    if (h && ['nw', 'ne', 'se', 'sw'].includes(h) && inside) h = null; // 四角：框内命中不算手柄
    if (!h && !inside && gizmo) {
      /* 框外兜底判定：距四角 ≤ 手柄当前屏幕尺寸即视为该角手柄（命中 = 视觉，随图层缩小同步收窄） */
      const R = App.handleSizePx(g.box);
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
      App.editHist.checkpoint(); // 手柄手势开始前记录撤回点
      const _g0 = App.editSession && App.editSession.grp
        ? { rot: App.editSession.grp.rot, skew: App.editSession.grp.skew, sx: App.editSession.grp.sx, sy: App.editSession.grp.sy } : null;
      /* 有锚点（仅单目标）：手势开始时记录锚点的当前文档坐标，
         拖动中据此重算 x/y —— 锚点屏幕位置全程不动（含 Shift 旋转/倾斜） */
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
        groupC: { x: g.cx, y: g.cy }, // 多选整组缩放的组中心
        g0: _g0, // 多选组矩阵会话在手势起点的组参数快照
        grabAngle: Math.atan2(hp.y - _anchorCenter.y, hp.x - _anchorCenter.x), // 手柄相对中心的初始角度（Shift 旋转用）
        rotLock: 0,
        skewLock: 0, // Shift+上下手柄快捷倾斜的保持值
        snap: App.editTargets().map(it => ({ it, x: it.x, y: it.y, sx: it.sx, sy: it.sy, rot: it.rot, skew: it.skew }))
      };
      try { App.svg.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件无活动指针 */ }
      e.preventDefault();
    } else {
      /* 拖动蓝框内部（中心区域）= 移动图案位置（复用移动模式拖拽，中心/大小/旋转不变） */
      if (!items.length) return;
      if (!inside) return;
      App.editHist.checkpoint(); // 拖蓝框内部移动：开始前记录撤回点
      App.drag = {
        kind: 'editmove',
        startX: e.clientX, startY: e.clientY,
        scale: App.state.view.scale,
        snap: items.map(it => ({ it, x: it.x, y: it.y }))
      };
      try { App.svg.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件无活动指针 */ }
      e.preventDefault();
    }
  } else if (mode === 'rotate') {
    /* 旋转模式鼠标拖拽：拖图案外部任意区域 = 绕中心旋转；
       拖图案内部 = 调整位置（与移动模式同一拖拽） */
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
    App.editHist.checkpoint(); // 手势开始前记录撤回点
    if (inside) {
      App.drag = {
        kind: 'editmove',
        startX: e.clientX, startY: e.clientY,
        scale: App.state.view.scale,
        snap: items.map(it => ({ it, x: it.x, y: it.y }))
      };
    } else {
      /* 有锚点（仅单目标）：旋转中心 = 锚点文档坐标（否则仍绕蓝框中心） */
      const _af = (items.length === 1) ? App.anchorFixedLocal(items[0]) : null;
      const _ad = _af ? App.itemLocalToDoc(items[0], _af.x, _af.y) : null;
      const _rc = _ad ? { x: _ad.x, y: _ad.y } : { x: g.cx, y: g.cy };
      App.drag = {
        kind: 'editrotate',
        center: _rc,
        anchorFix: _af,
        anchorDoc: _ad,
        grabAngle: Math.atan2(pd.y - _rc.y, pd.x - _rc.x), // 指针相对中心的初始角度
        g0: App.editSession && App.editSession.grp
          ? { rot: App.editSession.grp.rot, skew: App.editSession.grp.skew, sx: App.editSession.grp.sx, sy: App.editSession.grp.sy } : null,
        snap: items.map(it => App.editTransformSnap(it))
      };
    }
    try { App.svg.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件无活动指针 */ }
    e.preventDefault();
  } else if (mode === 'skew') {
    /* 倾斜模式鼠标拖拽：拖图案外部 = 水平左右拖动调整倾斜角度；
       拖图案内部 = 调整位置（与移动模式同一拖拽） */
    const items = App.editTargets();
    if (!items.length) return;
    const pd = App.screenToDoc(e.clientX, e.clientY);
    let inside = false;
    for (const it of items) {
      const b = App.getItemDocBBox(it);
      if (b.corners && b.corners.length >= 4 && App.pointInQuad(pd, b.corners)) { inside = true; break; }
    }
    App.editHist.checkpoint(); // 手势开始前记录撤回点
    if (inside) {
      App.drag = {
        kind: 'editmove',
        startX: e.clientX, startY: e.clientY,
        scale: App.state.view.scale,
        snap: items.map(it => ({ it, x: it.x, y: it.y }))
      };
    } else {
      App.drag = {
        kind: 'editskew',
        startX: e.clientX, startY: e.clientY,
        scale: App.state.view.scale,
        g0: App.editSession && App.editSession.grp
          ? { rot: App.editSession.grp.rot, skew: App.editSession.grp.skew, sx: App.editSession.grp.sx, sy: App.editSession.grp.sy } : null,
        snap: items.map(it => App.editTransformSnap(it))
      };
    }
    try { App.svg.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件无活动指针 */ }
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
    /* 旋转模式拖图案外：指针绕中心的角度变化 = 旋转量（快照 + 增量，与方向键/WASD 共用撤回点） */
    const pd = App.screenToDoc(e.clientX, e.clientY);
    const rotD = (Math.atan2(pd.y - App.drag.center.y, pd.x - App.drag.center.x) - App.drag.grabAngle) * 180 / Math.PI;
    if (App.drag.snap.length > 1) {
      /* 多选：组矩阵模型——组旋转 = 手势起点 + 指针总角（每个内容点同矩阵旋转，与合并分组一致） */
      const g0 = App.drag.g0;
      if (g0) { App.editSession.grp.rot = g0.rot + rotD; App.groupDecompose(); }
    } else {
      apply(() => App.drag.snap.forEach(s => {
        s.it.rot = s.rot + rotD;
        /* 有锚点：旋转中心是锚点 —— 每帧把 x/y 重算回锚点文档坐标（锚点屏幕位置不动） */
        if (App.drag.anchorFix && App.drag.anchorDoc) {
          App.placeItemAtDocPoint(s.it, App.drag.anchorFix.x, App.drag.anchorFix.y, App.drag.anchorDoc.x, App.drag.anchorDoc.y);
        }
        App.applySnapCenterKeep(s); // merged：锚点重算，内容中心保持不动
        App.applyItemTransform(s.it);
      }));
    }
    if (App.scheduleFrameUpdate) App.scheduleFrameUpdate('edit');
    else { App.drawOutlines(); App.updateEditValue(); }
  } else if (App.drag.kind === 'editskew') {
    /* 倾斜模式拖图案外：水平位移 → 倾斜角（每拖 200 文档单位 = 60°）。
       方向与 WASD/Shift 快捷一致：左拖（dx<0）→ 倾斜角增大，右拖（dx>0）→ 减小 */
    const dx = (e.clientX - App.drag.startX) / App.drag.scale;
    const skewD = -(dx / 200) * 60;
    if (App.drag.snap.length > 1) {
      /* 多选：组矩阵模型——组倾斜 = 手势起点 + 拖动总量（旋转层变形方向与合并分组一致） */
      const g0 = App.drag.g0;
      if (g0) { App.editSession.grp.skew = g0.skew + skewD; App.groupDecompose(); }
    } else {
      apply(() => App.drag.snap.forEach(s => {
        s.it.skew = s.skew + skewD;
        App.applySnapCenterKeep(s); // merged：锚点重算，内容中心保持不动
        App.applyItemTransform(s.it);
      }));
    }
    if (App.scheduleFrameUpdate) App.scheduleFrameUpdate('edit');
    else { App.drawOutlines(); App.updateEditValue(); }
  } else if (App.drag.kind === 'edithandle') {
    const dx = (e.clientX - App.drag.startX) / App.drag.scale;
    const dy = (e.clientY - App.drag.startY) / App.drag.scale;
    const h = App.drag.h;
    /* 把画布位移投影到图层本地轴（只按旋转转动；翻转不参与投影——
       手柄在 AABB 边缘 = 视觉方向，拖拽方向与内容镜像无关。
       否则翻转后拖 W/E、N/S 手柄的缩放方向会反） */
    const items = App.editTargets();
    const it = items[0];
    let dxx = 1, dxy = 0, dyx = 0, dyy = 1;
    if (it && it.w && it.h) {
      const th = (it.rot || 0) * D2R;
      dxx = Math.cos(th); dxy = Math.sin(th); // 本地 +x 轴（单位向量，仅旋转）
      dyx = -Math.sin(th); dyy = Math.cos(th); // 本地 +y 轴（单位向量，仅旋转）
    }
    const lx = dx * dxx + dy * dxy; // 沿本地 x 的拖拽分量
    const ly = dx * dyx + dy * dyy; // 沿本地 y 的拖拽分量
    /* 屏幕固定速度：每拖 200 文档单位缩放值变化 1.0（灵敏度减半，避免"拖一点就猛放大"）；
       与当前比例、画布缩放都无关，鼠标拖动长度与变化量严格成正比 */
    let gx = 0, gy = 0;
    if (h.includes('e')) gx += lx / 200;
    if (h.includes('w')) gx -= lx / 200;
    if (h.includes('n')) gy -= ly / 200;
    if (h.includes('s')) gy += ly / 200;
    if (App.state.sizeMode === 'prop') {
      const g = (h.includes('e') || h.includes('w')) ? gx : gy;
      gx = g; gy = g;
    }
    /* Shift+角手柄：不调大小，改为绕中心旋转——手柄跟着鼠标走（旋转角度 = 指针角 - 初始角）；
       松开 Shift 后旋转保持，继续拖动恢复调大小 */
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
    /* Shift+上下手柄（竖直方向边中点）左右拖 = 快捷改倾斜：左拉为正（左倾）、右拉为负（右倾）；
       每拖一个图案高度的距离 ≈ 60°，松 Shift 后保持 */
    let skewD = 0;
    if (App.state.shiftDown && (h === 'n' || h === 's')) {
      gx = 0; gy = 0;
      skewD = (-lx / (App.drag.box.h || 1)) * 60;
      App.drag.skewLock = skewD;
    } else {
      skewD = App.drag.skewLock || 0;
    }
    if (App.drag.snap.length > 1) {
      /* 多选整组：组矩阵模型——目标组参数 = 手势起点快照 + 当前手柄总量
         （缩放 ×(1+2g)，Shift 旋转/倾斜加总量；每个内容点同矩阵变形，与合并分组一致） */
      const g0 = App.drag.g0;
      if (g0 && App.editSession && App.editSession.grp) {
        App.editSession.grp.rot = g0.rot + (rotD || 0);
        App.editSession.grp.skew = g0.skew + (skewD || 0);
        App.editSession.grp.sx = g0.sx * (1 + 2 * gx);
        App.editSession.grp.sy = g0.sy * (1 + 2 * gy);
        App.groupDecompose();
      }
    } else {
    apply(() => App.drag.snap.forEach(s => {
      /* 中心固定：缩放以图案正中心对称进行，中心坐标保持不变；
         单边手柄拖动时对面镜像（缩放增量 ×2），拖动距离与速度感不变。
         缩放值一律带符号计算：保留当前 flipH/flipV（Tab 翻转/工具栏翻转后
         拖手柄不再翻回去），过零时镜像切换照常 */
      const ssx = (s.it.flipH ? -1 : 1) * (s.sx || 1);
      const ssy = (s.it.flipV ? -1 : 1) * (s.sy || 1);
      /* 有锚点（单目标，含合并分组）：固定点 = 锚点本地坐标。
         缩放 / Shift 转角旋转 / Shift 上下手柄倾斜全程保持锚点文档坐标不动，
         x/y 每帧从手势起点的锚点位置重算（不累积漂移） */
      if (App.drag.anchorFix && App.drag.anchorDoc) {
        const af = App.drag.anchorFix, ad = App.drag.anchorDoc;
        s.it.rot = rotD ? s.rot + rotD : s.it.rot;
        s.it.skew = skewD ? s.skew + skewD : s.it.skew;
        App.applyScaleWithFlip(s.it, ssx + 2 * gx, ssy + 2 * gy);
        App.placeItemAtDocPoint(s.it, af.x, af.y, ad.x, ad.y);
      } else if (s.it.kind === 'merged') {
        /* 合并分组：锚点远离内容中心（尤其旋转/倾斜后），用矩阵精确换算位置，
           保证缩放/旋转/倾斜时【视觉中心不动】。
           注意 x/y 必须用本帧最终 rot/skew 计算（不能沿用上帧值），
           否则内容中心每帧滞后一个增量 → 旋转/倾斜时位置抽搐 */
        const cx = App.drag.center.x, cy = App.drag.center.y;
        const nsx = ssx + 2 * gx, nsy = ssy + 2 * gy;
        const { lcx, lcy } = App.mergedLocalCenter(s.it);
        const rotF = rotD ? s.rot + rotD : s.it.rot;
        const skewF = skewD ? s.skew + skewD : s.it.skew;
        const M = App.FZA.layerMatrix({ flipH: nsx < 0, flipV: nsy < 0, sx: Math.abs(nsx), sy: Math.abs(nsy), rot: rotF, skew: skewF });
        s.it.x = cx - (M.a * lcx + M.c * lcy);
        s.it.y = cy - (M.b * lcx + M.d * lcy);
        App.applyScaleWithFlip(s.it, nsx, nsy);
      } else {
        /* 普通图层（无锚点）：中心固定——x/y 不动，缩放以图案正中心对称进行 */
        s.it.x = s.x;
        s.it.y = s.y;
        App.applyScaleWithFlip(s.it, ssx + 2 * gx, ssy + 2 * gy);
        if (rotD) s.it.rot = s.rot + rotD;
        if (skewD) s.it.skew = s.skew + skewD;
      }
      /* 合并分组走「内容中心」分支时，rot/skew 在这里补写（锚点分支已在上面写好） */
      if (s.it.kind === 'merged' && !(App.drag.anchorFix && App.drag.anchorDoc)) {
        if (rotD) s.it.rot = s.rot + rotD;
        if (skewD) s.it.skew = s.skew + skewD;
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
  App.editHist.endGesture(); // 手势结束：下一次手势开始前记录新撤回点
};

/* ---------- Y：复制当前编辑图层（位置、大小、旋转、倾斜、透明度不变） ---------- */
/* 副本插入到正在编辑的图层正下方（layers 数组与 DOM 顺序一致）；白框保持在编辑图层上。
   锚点状态下（单个普通图案 + 已固定锚点）：只复制这一层，副本插到原图层下方，
   当前编辑目标仍是原图层，原图层锚点信息保持不变；副本不共享可变的锚点对象
   （锚点活在编辑会话 App.state.anchor 上，不是图层字段），也不继承「正在放置」状态。 */
App.duplicateEditing = function () {
  if (!App.state.edit || App.state.edit.type === 'bg') return;
  const items = App.editTargets();
  if (!items.length) return;
  /* 先收尾进行中的手势，保证这次一定拿到一个新撤回点（撤回点 = 复制前的状态） */
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
    /* 插到正在编辑的图层下方（先画=在下层；不经过 addLayer 的 appendChild） */
    App.layersRoot.insertBefore(c.el, it.el);
    App.state.layers.splice(App.state.layers.indexOf(it), 0, c);
    App.registerChildren(c);
    c.thumbDirty = true;
    if (c.kind === 'merged' && App.maybeBakeProxy) App.maybeBakeProxy(c);
  });
  /* 撤回点带上本次新建的图层：编辑内 Ctrl+Z 会连同副本一起移除（原图层与锚点不受影响） */
  if (cp) cp.despawn = copies.map(c => c.id);
  App.refreshPanel();
  App.refreshCount();
  /* 白框保持在正在编辑的图层上（复制不改变编辑目标） */
  const first = items[0];
  App.lastWheelIdx = App.state.layers.length - 1 - App.state.layers.indexOf(first);
  App.refreshLayerThumbs();
  if (App.contentChanged) App.contentChanged();
  if (App.requestFlashRefresh) App.requestFlashRefresh(false);
  showToast(App.i18n.tf('toast.edit.copied', { n: copies.length }));
};

/* ---------- Tab：翻转循环（编辑模式） ----------
   第1次=水平翻转，第2次=水平+垂直，第3次=垂直，第4次=无翻转（循环） */
App.editFlipCycle = function () {
  const items = App.editTargets();
  if (!items.length) return;
  App.editHist.checkpoint();
  App.editHist.endGesture();
  App.state.editFlipStep = (App.state.editFlipStep + 1) % 4; // 1,2,3,0
  items.forEach(it => {
    /* 合并分组：翻转后重算锚点保持内容几何中心不动（否则内容绕锚点镜像跳到远处） */
    const c = it.kind === 'merged' && App.mergedContentCenter ? App.mergedContentCenter(it) : null;
    /* 有缩放锚点时：翻转绕锚点进行（锚点屏幕位置保持不动，与缩放/旋转同一固定点语义） */
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
