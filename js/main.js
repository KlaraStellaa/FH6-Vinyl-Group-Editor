'use strict';
/* 启动、全局事件（键盘/鼠标/滚轮/拖放）、主循环 */
/* Per-frame input coalescing.  State is mutated immediately so hit-testing and
   model code see the latest gesture, while expensive view/outline/flash work is
   committed once in the next frame. */
App._frameUpdate = App._frameUpdate || { raf: 0, view: false, wheel: false, edit: false };
App.scheduleFrameUpdate = function (kind) {
  const q = App._frameUpdate;
  if (kind === 'wheel') { q.wheel = true; q.view = true; }
  else if (kind === 'view') q.view = true;
  else if (kind === 'edit') q.edit = true;
  if (q.raf) return;
  q.raf = requestAnimationFrame(function () {
    q.raf = 0;
    App.flushFrameUpdates();
  });
};
App.flushFrameUpdates = function () {
  const q = App._frameUpdate;
  if (q.raf) { cancelAnimationFrame(q.raf); q.raf = 0; }
  if (q.wheel && App._wheelPending) {
    const p = App._wheelPending;
    App._wheelPending = null;
    const f = Math.exp(-p.deltaY * 0.0015);
    const ns = clamp(App.state.view.scale * f, 0.02, 32);
    App.state.view.x = p.anchorX - p.mx / ns;
    App.state.view.y = p.anchorY - p.my / ns;
    App.state.view.scale = ns;
  }
  const needView = q.view;
  q.wheel = q.view = false;
  if (needView) {
    App.updateView();
    App.drawOutlines();
  }
  if (q.edit) {
    App.drawOutlines();
    if (App.state && App.state.edit) App.updateEditValue();
  }
  q.edit = false;
};
App.boot = function () {
  if (App.initPerfMonitor) App.initPerfMonitor(); // 性能监测：长任务/低帧率写日志
  App.initRender();
  if (App.initClickLog) App.initClickLog(); // 鼠标点击记录：坐标/命中/选中结果写日志（需 App.svg 已建）
  App.initPanels();
  App.initColorPanel();
  App.initBackground();
  App.initEditMode();
  App.initSelectionToolbar();
  App.initIO();
  App.wireTabs();
  App.wirePointer();
  App.wireKeyboard();
  App.wireWheel();
  if (App.wireLayerPicker) App.wireLayerPicker();   /* 画布右键：挑出该点上的所有图层 */
  App.wireDragDrop();
  App.wireResize();
  if (App.Tabs) App.Tabs.start(); // 顶部多标签（测试模式预置默认文档；正常模式等待主页新建/打开）

  /* 初始视图：原点位于画面中央 */
  const cw = App.wrap.clientWidth || 1200, ch = App.wrap.clientHeight || 800;
  App.state.view.x = -cw / 2;
  App.state.view.y = -ch / 2;
  App.state.view.scale = 1;
  App.updateView();
  App.switchTab('lib');
  App.refreshCount();

  App.loadLibrary().then(() => {
    showToast(App.i18n.t('toast.main.assetsLoaded'));
  }).catch(err => {
    console.error(err);
    $('#loadingOverlay').innerHTML = '<div class="loader-box">图案库加载失败<br>' + (err && err.message ? err.message : '') + '</div>';
  });

  let last = performance.now();
  const loop = now => {
    const dt = clamp((now - last) / 1000, 0, 0.1);
    last = now;
    /* 批量创建期间隐藏的图层容器：解除批量后恢复显示（避免导入 2000 层后一直隐藏）。
       但"隐藏图层"开关 / 背景取色器 的隐藏不能被恢复（否则隐藏/取色效果下一帧就失效） */
    if (App.layersRoot && App.layersRoot.style.display === 'none' && !App.state.batching &&
        !App.state.layersHidden && App.state.eyeMode !== 'bg') {
      App.layersRoot.style.display = '';
    }
    if (App.state.edit) App.tick(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
};

App.wireTabs = function () {
  $$('#panelTabs .tab').forEach(t => {
    t.addEventListener('click', () => {
      if (App.state.edit && App.state.edit.type !== 'bg') return; // 编辑中锁定颜色面板
      App.switchTab(t.getAttribute('data-tab'));
    });
  });
};

App.wirePointer = function () {
  /* 所有指针手势都让后台烘焙让位，包括图层栏/工具栏触发的内容操作。
     capture 级监听还能覆盖指针从画布外松开的情况。 */
  window.addEventListener('pointerdown', () => {
    if (App.noteRenderInteraction) App.noteRenderInteraction(true);
  }, true);
  window.addEventListener('pointerup', () => {
    if (App.noteRenderInteraction) App.noteRenderInteraction(false);
    if (App.flushFrameUpdates) App.flushFrameUpdates();
  }, true);
  window.addEventListener('pointercancel', () => {
    if (App.noteRenderInteraction) App.noteRenderInteraction(false);
    if (App.flushFrameUpdates) App.flushFrameUpdates();
  }, true);
  App.svg.addEventListener('pointerdown', e => {
    if (App.state.eyeMode) { App.onEyeDown(e); return; }
    if (App.state.spaceDown || e.button === 1) {
      App.drag = {
        kind: 'pan', startX: e.clientX, startY: e.clientY,
        vx: App.state.view.x, vy: App.state.view.y
      };
      try { App.svg.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件无活动指针 */ }
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    /* 「画布拖动使用空格」关掉时（设置窗 → 自定义快捷键 → 第一个开关）：左键直接拖动 = 平移。
       不能一按下就抢：还得区分「点击（选中 / 清空）」与「拖动（平移）」，
       所以先记起点（panPending），指针移动超过阈值才真的转成 pan —— 与 Tab 框选同一套做法。
       编辑模式下不参与（拖动是移动图形），tabDown 时也不参与（那是框选）。 */
    if (App.settings && App.settings.panNeedsSpace === false &&
        !App.state.edit && !App.state.tabDown) {
      App.panPending = {
        x: e.clientX, y: e.clientY, pointerId: e.pointerId,
        vx: App.state.view.x, vy: App.state.view.y
      };
      try { App.svg.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件无活动指针 */ }
      e.preventDefault();
      return;
    }
    if (App.state.edit) App.onEditPointerDown(e);
    else if (App.state.tabDown) {
      /* 按住 Tab 按下：先回滚白框图层的自动加选/取消，记录起点但不立即创建蓝框——
         移动超过阈值才进入框选；直接松开 = 画布内点击（加入/移出多选）。
         rolledId 传给松开时的点击处理：点击的是 Tab 刚自动操作过的图层时不再重复切换 */
      const rolledId = App.rollbackTabAutoSel();
      App.tabPending = { x: e.clientX, y: e.clientY, ctrl: !!e.ctrlKey, active: false, pointerId: e.pointerId, rolledId };
    } else {
      App.onCanvasPointerDown(e);
    }
  });
  App.svg.addEventListener('pointermove', e => {
    if (App.state.eyeMode) { App.onEyeMove(e); return; }
    /* 直接拖动平移：超过阈值才认定是拖动（否则留给 pointerup 当点击处理）。
       置好 App.drag 后**不 return** —— 继续往下走，本帧就开始平移。 */
    if (App.panPending && !App.drag) {
      if (Math.hypot(e.clientX - App.panPending.x, e.clientY - App.panPending.y) <= 4) return;
      App.drag = {
        kind: 'pan', startX: App.panPending.x, startY: App.panPending.y,
        vx: App.panPending.vx, vy: App.panPending.vy
      };
      App.panPending = null;
    }
    /* 正在放置锚点：图标跟随鼠标（无需按住）。只更新锚点图标与限制后的位置，
       不触发整份文档重绘，也不建立任何拖动手势 */
    if (!App.drag && App.state.edit && App.state.anchorPlacing) { App.onAnchorHover(e.clientX, e.clientY); return; }
    if (App.tabPending && !App.tabPending.active &&
        Math.hypot(e.clientX - App.tabPending.x, e.clientY - App.tabPending.y) > 4) {
      /* 拖动超过阈值：进入蓝框框选（Ctrl = 取消多选） */
      App.tabPending.active = true;
      App.startBoxSelect({
        clientX: App.tabPending.x, clientY: App.tabPending.y,
        ctrlKey: App.tabPending.ctrl, pointerId: e.pointerId
      }, App.tabPending.ctrl ? 'remove' : 'add');
    }
    if (App.boxSelect) { App.moveBoxSelect(e); return; }
    if (!App.drag) return;
    if (App.drag.kind === 'pan') {
      const dx = e.clientX - App.drag.startX;
      const dy = e.clientY - App.drag.startY;
      App.state.view.x = App.drag.vx - dx / App.state.view.scale;
      App.state.view.y = App.drag.vy - dy / App.state.view.scale;
      if (App.scheduleFrameUpdate) App.scheduleFrameUpdate('view');
    } else if (App.state.edit) {
      App.onEditPointerMove(e);
    }
  });
  const up = e => {
    if (App.panPending) {
      const p = App.panPending;
      App.panPending = null;
      /* 一直没超过阈值 = 只是一次普通点击：补一次画布点击（选中 / 清空） */
      if (!App.drag) {
        App.onCanvasPointerDown(Object.assign({}, e, { clientX: p.x, clientY: p.y }));
      }
      App.drag = null;
      try { App.svg.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      return;
    }
    if (App.tabPending) {
      const p = App.tabPending;
      App.tabPending = null;
      if (!p.active) {
        /* Tab 点击（未拖动）：画布内点击选择（加入/移出多选） */
        App.onCanvasPointerDown(Object.assign({}, e, { clientX: p.x, clientY: p.y, _rolledId: p.rolledId }));
        App.drag = null;
        try { App.svg.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        return;
      }
    }
    if (App.boxSelect) App.endBoxSelect(e);
    if (App.drag && App.state.edit) App.onEditPointerUp(); // 结束手势：下一次操作记录新撤回点
    App.drag = null;
    try { App.svg.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  };
  App.svg.addEventListener('pointerup', up);
  App.svg.addEventListener('pointercancel', e => {
    App.panPending = null;   /* 手势被系统取消：不当作点击 */
    App.cancelBoxSelect();
    up(e);
  });
  /* 双击画布中的图层进入编辑 */
  App.svg.addEventListener('dblclick', e => {
    if (App.state.edit || App.state.tabDown || App.state.spaceDown || App.state.eyeMode) return;
    /* 模拟事件无坐标时退化为 DOM 命中 */
    const layer = (e.clientX === 0 && e.clientY === 0 && e.target)
      ? App.hitLayer(e)
      : App.hitLayerPaintedSync(e.clientX, e.clientY);
    if (!layer) return;
    const top = App.topOf(layer);
    if (App.state.selected.size > 1 && App.state.selected.has(top.id)) {
      App.enterEdit({ type: 'multi', ids: Array.from(App.state.selected) });
    } else {
      App.enterEdit({ type: 'layer', id: top.id });
    }
  });
};

App.wireKeyboard = function () {
  /* 点击任意按钮/拖动条后立即失焦：防止残留焦点导致之后按 Enter/空格/方向键再次触发
     （工具栏/右侧面板/页签/滑条等所有 button 与 input[type=range] 统一处理） */
  document.addEventListener('click', e => {
    const t = e.target;
    const b = t && t.closest ? t.closest('button, input[type="range"]') : null;
    if (b) b.blur();
  }, true);
  /* 所有按键都经 App.keymap 查表（绑定表见根目录 keymap.js，用户可在设置窗里改）：
     同一个键在不同上下文可以绑不同动作——先查当前上下文，再查通用。
     改造前的行为逐条保留，注释里标注了对应的动作 id。 */
  window.addEventListener('keydown', e => {
    const t = e.target;
    const inInput = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    /* 速率设置窗口内的输入框：Tab/Esc/空格 属于窗口自己的交互，不被全局快捷键吃掉 */
    const inSpeedWin = !!(t && t.closest && t.closest('#speedPanel'));
    /* 设置窗（含「自定义快捷键」视图）开着时，全局快捷键一律不生效：
       窗口里的按键属于窗口自己（Esc 由 keymap.js 的捕获监听处理成「取消」） */
    if (App.keymapUI && App.keymapUI.isOpen()) return;

    const A = App.keymap.actionFor(e, App.state.edit ? 'edit' : 'canvas');

    /* pan：按住空格平移视图 */
    if (A === 'pan') {
      if (inSpeedWin) return;
      App.state.spaceDown = true; e.preventDefault(); return;
    }
    /* highlight：按住/单击 Tab 扫选高亮（画布）；editFlip：编辑模式内 Tab 翻转循环 */
    if (A === 'highlight' || A === 'editFlip') {
      if (inSpeedWin) return;   // 窗口内 Tab = 切换输入框焦点
      if (A === 'editFlip') {
        if (!e.repeat) App.editFlipCycle();
        e.preventDefault();
        return;
      }
      if (!e.repeat) {
        App.state.tabGestureUsed = false;
        App.state.sweepMode = null;
        App.state.sweepDir = 0;
        /* 按住/单击 Tab：白框内图层立即响应（选定或取消），滚轮再继续扫 */
        App.actOnWhiteBoxLayer();
      }
      App.state.tabDown = true;
      App.syncPanelSelectionClasses();
      e.preventDefault();
      return;
    }
    if (e.key === 'Shift') { App.state.shiftDown = true; return; }
    if (A === 'escape') {
      if (inSpeedWin) return;   // 窗口内 Esc = 交给窗口（取消并关闭）
      /* 编辑+取色器并存时：先退取色器再退编辑（避免取色器残留激活） */
      if (App.state.eyeMode) { App.setEyedropper(null); }
      else if (App.state.edit) { App.exitEdit(true); }
      else if (App.state.replacing) { App.setReplacing(false); }
      else {
        /* 白框保持原位，绝不跳到第一个图层 */
        const box = App.whiteBoxLayer();
        if (box) {
          const ids = App.state.layers.slice().reverse().map(l => l.id);
          const i = ids.indexOf(box.id);
          if (i >= 0) App.lastWheelIdx = i;
        }
        if (App.state.selected.size > 1) {
          /* 多选状态：Esc 只关闭功能栏，绝不清空多选 */
          App.state.selBarDismissed = true;
          App.updateSelToolbar();
        } else {
          /* 单选/无选中：清空选择 */
          App.state.selBarDismissed = true;
          App.setSelection([]);
        }
      }
      return;
    }
    /* editFinish：编辑模式内 Enter 完成编辑 */
    if (A === 'editFinish' && !e.repeat) {
      if (inInput) { try { e.target.blur(); } catch (err) { /* ignore */ } }
      App.exitEdit(false);
      return;
    }

    /* 撤销 / 重做（放在输入框判断之前，输入框聚焦时也能响应） */
    if (A === 'undo') {
      e.preventDefault();
      if (App.state.edit) {
        /* 编辑模式内独立撤回（每个手势一步，不退出编辑） */
        showToast(App.editHist.undo() ? App.i18n.t('toast.main.undone') : App.i18n.t('toast.main.nothingToUndo'));
      } else {
        showToast(App.history.undo() ? App.i18n.t('toast.main.undone') : App.i18n.t('toast.main.nothingToUndo'));
      }
      return;
    }
    if (A === 'redo') {
      e.preventDefault();
      if (App.state.edit) {
        showToast(App.editHist.redo() ? App.i18n.t('toast.main.redone') : App.i18n.t('toast.main.nothingToRedo'));
      } else {
        showToast(App.history.redo() ? App.i18n.t('toast.main.redone') : App.i18n.t('toast.main.nothingToRedo'));
      }
      return;
    }
    if (inInput) return;

    if (App.state.edit) {
      /* 编辑中做任何键盘操作：撤销未点「应用」的颜色预览 */
      if (App.cancelColorPreview) App.cancelColorPreview();
      /* sizeMode：大小模式内 Backspace 切换等比/自由（非大小模式时无动作，与改造前一致） */
      if (A === 'sizeMode') {
        if (!e.repeat && App.state.editMode === 'size') {
          App.state.sizeMode = App.state.sizeMode === 'prop' ? 'free' : 'prop';
          App.updateEditBar();
          showToast(App.state.sizeMode === 'prop' ? App.i18n.t('toast.main.propMode') : App.i18n.t('toast.main.freeMode'));
        }
        return;
      }
      /* editDelete：编辑模式内 Delete 删除当前编辑的图层（Backspace 只切换等比/自由） */
      if (A === 'editDelete' && !e.repeat) {
        const items = App.editTargets().filter(it => it.kind !== 'bg');
        App.exitEdit(false);
        if (items.length) {
          App.history.markDiscrete();
          items.forEach(it => {
            const l = App.findLayer(it.id);
            if (l && App.state.layers.includes(l)) App.removeTopLayer(l);
          });
          showToast(App.i18n.tf('toast.sel.deleted', { n: items.length }));
        }
        return;
      }
      if (A === 'editDup') { if (!e.repeat) App.duplicateEditing(); return; }
      /* anchor：放置/清除缩放锚点（仅在编辑单个普通图案时生效；
         焦点在输入框时上面已 return，不会拦截） */
      if (A === 'anchor') { if (!e.repeat) App.toggleAnchor(); return; }
      if (A === 'mode1' || A === 'mode2' || A === 'mode3' || A === 'mode4' || A === 'mode5') {
        App.setEditMode(['move', 'size', 'rotate', 'skew', 'opacity'][parseInt(A.slice(4), 10) - 1]);
        return;
      }
      if (A === 'nudgeUp' || A === 'nudgeDown' || A === 'nudgeLeft' || A === 'nudgeRight') {
        App.arrowStep(A.slice(5).toLowerCase());
        e.preventDefault();
        return;
      }
      if (A === 'moveUp' || A === 'moveDown' || A === 'moveLeft' || A === 'moveRight') {
        /* 连续调整按住期间 = 一次手势：按下第一帧记录撤回点，松开后结束手势。
           App.state.keys 存的是**方向**（up/down/left/right）而不是字母，改键后依旧成立。 */
        if (!e.repeat && !App.state.keys.size) App.editHist.checkpoint();
        App.state.keys.add(A.slice(4).toLowerCase());
        return;
      }
    } else {
      /* toolbar：单击 Enter=呼出白框图层的功能界面；双击=进入编辑画面 */
      if (A === 'toolbar' && !e.repeat) {
        const box = App.whiteBoxLayer();
        if (!box) return;
        const now = Date.now();
        if (now - (App.lastEnterTime || 0) < 400) {
          App.lastEnterTime = 0;
          App.enterEdit({ type: 'layer', id: box.id });
        } else if (App.state.selected.size > 1 || (App.state.selectedByTab && App.state.selected.size >= 1)) {
          /* 多选（含 Tab 遗留单选）状态下单击 Enter：呼出功能栏操作整个多选集合，绝不取消多选 */
          App.lastEnterTime = now;
          App.state.selBarDismissed = false;
          App.updateSelToolbar();
        } else {
          App.lastEnterTime = now;
          App.state.selectedByTab = false;
          App.state.selBarDismissed = false;
          App.setSelection([box.id], { scrollPanel: true });
        }
        return;
      }
      /* up / down：白框上下移一个图层（按住 Tab 时同样扫选） */
      if (A === 'up') { App.stepWhiteBox(-1); e.preventDefault(); return; }
      if (A === 'down') { App.stepWhiteBox(1); e.preventDefault(); return; }
      if (A === 'cut') { App.cutSelection(); return; }
      if (A === 'paste') { App.pasteClipboard(); return; }
      /* delete：删除选中图层 */
      if (A === 'delete') { App.deleteSelection(); return; }
    }
    /* base：切换灰白/灰黑画布底色（画布与编辑模式都生效） */
    if (A === 'base') { App.toggleBase(); e.preventDefault(); return; }
  });
  /* 松开：手势状态按**当前绑定**回退（改键后仍然对得上） */
  const anyMatch = (id, e) => App.keymap.combos(id).some(c => window.SVE_KEYMAP.matchesEvent(c, e));
  window.addEventListener('keyup', e => {
    if (anyMatch('pan', e)) App.state.spaceDown = false;
    if (anyMatch('highlight', e) || anyMatch('editFlip', e)) {
      App.state.tabDown = false;
      App.state.sweepMode = null;
      App.state.sweepDir = 0;
      App.state.tabGestureUsed = false;
      App.state.tabAutoSel = null; // Tab 手势结束：不再回滚
      App.syncPanelSelectionClasses();
    }
    if (e.key === 'Shift') App.state.shiftDown = false;
    const dirs = { moveUp: 'up', moveDown: 'down', moveLeft: 'left', moveRight: 'right' };
    Object.keys(dirs).forEach(id => { if (anyMatch(id, e)) App.state.keys.delete(dirs[id]); });
    if (!App.state.keys.size && App.state.edit) App.editHist.endGesture(); // 全部松开：手势结束
  });
  window.addEventListener('blur', () => {
    if (App.noteRenderInteraction) App.noteRenderInteraction(false);
    if (App.flushFrameUpdates) App.flushFrameUpdates();
    App.state.spaceDown = false;
    App.state.tabDown = false;
    App.state.shiftDown = false;
    App.state.keys.clear();
  });
};

App.wireWheel = function () {
  App._wheelPending = null;
  App.svg.addEventListener('wheel', e => {
    e.preventDefault();
    if (!App.state.wheelZoomEnabled) return; // 已禁用滚轮缩放
    if (App.noteRenderInteraction) App.noteRenderInteraction();
    const r = App.svg.getBoundingClientRect();
    /* Keep the latest pointer anchor and accumulate deltas.  The math and DOM
       writes happen once per frame, even when Chromium dispatches a wheel burst
       faster than the display refresh rate. */
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const old = App._wheelPending;
    App._wheelPending = {
      clientX: e.clientX, clientY: e.clientY, mx, my,
      anchorX: old ? old.anchorX : App.state.view.x + mx / App.state.view.scale,
      anchorY: old ? old.anchorY : App.state.view.y + my / App.state.view.scale,
      deltaY: (old ? old.deltaY : 0) + e.deltaY
    };
    if (App.scheduleFrameUpdate) App.scheduleFrameUpdate('wheel');
  }, { passive: false });
};

App.wireDragDrop = function () {
  /* 图案库拖入 */
  App.svg.addEventListener('dragover', e => {
    const types = e.dataTransfer.types ? Array.from(e.dataTransfer.types) : [];
    if (types.includes('text/plain') || types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  });
  App.svg.addEventListener('drop', e => {
    const text = e.dataTransfer.getData('text/plain');
    /* 「已保存的彩绘」拖放分支已随该功能下线整块删除（2026-09-15） */
    if (text && text.indexOf('SVE:') === 0) {
      e.preventDefault();
      const spec = JSON.parse(text.slice(4));
      const p = App.screenToDoc(e.clientX, e.clientY);
      App.placePatternAt(spec, p.x, p.y);
      return;
    }
    if (e.dataTransfer.files && e.dataTransfer.files.length) {
      e.preventDefault();
      e.stopPropagation(); // 防止 window 级二次处理
      App.handleFiles(e.dataTransfer.files);
    }
  });
  /* 本地文件拖入（窗口级兜底） */
  let lastFileDrop = 0;
  window.addEventListener('dragover', e => { e.preventDefault(); });
  window.addEventListener('drop', e => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length) {
      const now = Date.now();
      if (now - lastFileDrop < 300) return;
      lastFileDrop = now;
      App.handleFiles(e.dataTransfer.files);
    }
  });
};

App.wireResize = function () {
  const ro = new ResizeObserver(() => {
    if (App.noteRenderResize) App.noteRenderResize();
    App.updateView();
    App.drawOutlines();
  });
  ro.observe(App.wrap);
};

window.addEventListener('error', e => {
  console.error('[app error]', e.message, e.filename, e.lineno);
});

document.addEventListener('DOMContentLoaded', () => App.boot());

/* ---------- 语言切换后重刷「动态文案」 ----------
   app 里很多文案是 JS 按当前状态拼出来的（「滚轮缩放：开/关」「隐藏图层/显示图层」
   「图案总数：N」「等比/自由」「暂无历史颜色」等），data-i18n 的静态扫描管不到，
   必须在这里注册重刷器，切语言时才会跟着变。 */
App.i18n.onApply(function () {
  if (App.updateBaseButtons) App.updateBaseButtons();
  if (App.updateZoomWheelButton) App.updateZoomWheelButton();
  if (App.refreshCount) App.refreshCount();
  if (App.updateHideBgButton) App.updateHideBgButton();
  if (App.updateEditBar) App.updateEditBar();
  if (App.renderHistGrid) App.renderHistGrid();
  if (App.renderFavGrid) App.renderFavGrid();
  if (App.refreshShortcutPanel) App.refreshShortcutPanel();
  /* 设置窗里的「自定义快捷键」视图：分组名/动作名/键位框全是 JS 拼的，必须重渲 */
  if (App.keymapUI) App.keymapUI.render();
  /* 编辑条上的模式键位是 JS 写进去的，切语言/改键后都要重取 */
  if (App.refreshEditBarKeys) App.refreshEditBarKeys();
  /* 下拉克隆（ev-dd）里存的是创建时的选项文案，必须重建才会跟着语言变 */
  if (App.evDropdownSyncAll) App.evDropdownSyncAll();
  /* 左侧功能栏被 data-i18n 的 textContent 冲掉了图标，必须重挂图标 */
  if (App.refreshFluentIcons) App.refreshFluentIcons();
  /* 顶部工具栏同理（6 个按钮）；必须在 updateBaseButtons 之后 —— 那个重刷器会改写
     btnBgImage 的文案，先写文案再重挂图标，顺序反了图标会被文案冲掉 */
  if (App.refreshToolbarIcons) App.refreshToolbarIcons();
  /* 日志窗开着时，路径文案也要跟着语言变 */
  if (App.refreshLogPath) {
    var lp = document.getElementById('logPanel');
    if (lp && !lp.classList.contains('hidden')) App.refreshLogPath();
  }
  /* 素材库（画布右侧彩绘纹饰图案栏）：下拉分组名与正文分组标题都走词条，必须重建 */
  if (App.refreshLibraryPanel) App.refreshLibraryPanel();
  /* 主页卡片：相对时间（刚刚 / N 分钟前…）是 JS 拼的，必须重渲才跟着语言变 */
  if (App.Home && App.Home.shown && App.Home.refresh) App.Home.refresh();
});
