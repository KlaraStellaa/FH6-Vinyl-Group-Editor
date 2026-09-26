'use strict';
/* 撤销/重做：整文档快照 + 连续手势合并 */
App.history = {
  undoStack: [],
  redoStack: [],
  gesture: false,
  max: 80,
  snapshot: function () {
    const b = App.state.bg.image;
    return {
      layers: App.state.layers.map(l => App.snapshotSlim(l)),
      bg: b ? {
        el: b.el, imgEl: b.imgEl, dataUrl: b.dataUrl,
        x: b.x, y: b.y, w: b.w, h: b.h,
        sx: b.sx, sy: b.sy, rot: b.rot, skew: b.skew, opacity: b.opacity,
        flipH: !!b.flipH, flipV: !!b.flipV
      } : null,
      lastColor: App.state.lastColor,
      clipboard: App.state.clipboard.map(s => JSON.parse(JSON.stringify(s))),
      /* 选择与功能栏状态：删除/多选后撤回应完整恢复（否则撤回后选中丢失、无法呼出功能栏）。
         用图层索引记录（恢复时图层是重建对象、id 会变化，按索引还原最稳） */
      selIndexes: Array.from(App.state.selected).map(id => App.state.layers.findIndex(l => l.id === id)).filter(i => i >= 0),
      selectedByTab: !!App.state.selectedByTab,
      selBarDismissed: !!App.state.selBarDismissed
    };
  },
  trim: function () {
    if (this.undoStack.length > this.max) this.undoStack.shift();
  },
  /* 连续操作（编辑会话、颜色拖动、透明度滑块）合并为一个记录点 */
  markContinuous: function () {
    if (this.gesture) return;
    const s = this.snapshot();
    s.cont = true; // 标记连续会话记录（Esc 取消编辑时只丢弃这类记录）
    this.undoStack.push(s);
    this.trim();
    this.redoStack = [];
    this.gesture = true;
    if (App.Tabs && App.Tabs.markDirty) App.Tabs.markDirty();
  },
  /* 单次操作（放置/删除/合并/剪切/粘贴/导入等）立即成点 */
  markDiscrete: function () {
    this.endGesture();
    this.undoStack.push(this.snapshot());
    this.trim();
    this.redoStack = [];
    if (App.Tabs && App.Tabs.markDirty) App.Tabs.markDirty();
  },
  endGesture: function () { this.gesture = false; },
  scheduleEnd: function () {
    if (this.endTimer) clearTimeout(this.endTimer);
    this.endTimer = setTimeout(() => {
      this.endTimer = null;
      if (!App.state.edit) this.endGesture();
    }, 600);
  },
  /* Esc 取消编辑：丢弃本次编辑会话的记录点（cont 记录及其上的会话内记录），
     但保留编辑期间独立操作的记录（导入/设背景等 markDiscrete 记录移回栈尾，
     否则下一次 Ctrl+Z 会误删编辑期间导入的内容） */
  cancelTop: function () {
    const start = (App.editHistStart !== undefined && App.editHistStart >= 0) ? App.editHistStart : this.undoStack.length;
    if (this.undoStack.length > start) {
      const session = this.undoStack.splice(start);
      const keep = session.filter(r => !r.cont);
      if (keep.length) this.undoStack.push(...keep);
    }
    this.gesture = false;
    App.editHistStart = undefined;
  },
  restore: function (snap) {
    /* 撤销/重做重建图层结构：清除编辑静态化背景快照（旧图失效） */
    if (App.invalidateEditStatic) App.invalidateEditStatic();
    App.clearAllLayers();
    snap.layers.forEach(slim => {
      const l = App.deserializeLayer(slim);
      App.relinkSymbolData(l);
      App.buildLayerElement(l);
      App.layersRoot.appendChild(l.el);
      App.state.layers.push(l);
      App.registerChildren(l);
    });
    /* 背景恢复（复用共享的图片元素，无需重新解码） */
    App.bgSeq++;
    const cur = App.state.bg.image;
    if (cur && cur.el && cur.el.parentNode) cur.el.parentNode.removeChild(cur.el);
    if (snap.bg) {
      const m = {
        kind: 'bg',
        dataUrl: snap.bg.dataUrl, imgEl: snap.bg.imgEl, el: snap.bg.el,
        x: snap.bg.x, y: snap.bg.y, w: snap.bg.w, h: snap.bg.h,
        sx: snap.bg.sx, sy: snap.bg.sy, rot: snap.bg.rot, skew: snap.bg.skew, opacity: snap.bg.opacity,
        flipH: !!snap.bg.flipH, flipV: !!snap.bg.flipV
      };
      App.bgG.appendChild(m.el);
      App.applyBgTransform(m);
      App.state.bg.image = m;
    } else {
      App.state.bg.image = null;
    }
    App.updateBaseButtons();
    /* 撤销/重做重建了图层/背景：同步刷新隐藏按钮与透明度滑条状态
       （否则背景隐藏/图层隐藏按钮与实际显示状态脱节） */
    if (App.updateHideLayersButton) App.updateHideLayersButton();
    if (App.updateHideBgButton) App.updateHideBgButton();
    if (App.updateBgOpacitySlider) App.updateBgOpacitySlider();
    App.state.lastColor = snap.lastColor;
    App.state.clipboard = snap.clipboard.map(s => JSON.parse(JSON.stringify(s)));
    /* 恢复选择（按快照时的图层索引还原到重建后的图层）与功能栏状态 */
    App.state.selected = new Set((snap.selIndexes || []).map(i => (App.state.layers[i] ? App.state.layers[i].id : null)).filter(Boolean));
    App.state.selectedByTab = !!snap.selectedByTab;
    App.state.selBarDismissed = !!snap.selBarDismissed;
    App.refreshPanel();
    App.refreshCount();
    App.refreshClipboardPanel();
    App.drawOutlines();
    App.updateSelToolbar();
    App.refreshLayerThumbs();
    if (App.contentChanged) App.contentChanged({ preserveAutoStatic: false });
    /* 恢复的大分组重新启用渲染代理（撤销/重做后全图显示仍流畅） */
    if (App.maybeBakeProxy) App.state.layers.forEach(l => { if (l.kind === 'merged') App.maybeBakeProxy(l); });
    /* 撤销/重做清空或恢复了选择：停止并清理旧闪动覆盖层后，
       若恢复出选中图层则重新点亮闪烁（选中状态完整还原） */
    if (App.stopFlash) App.stopFlash();
    if (App.state.selected.size && App.requestFlashRefresh) App.requestFlashRefresh();
  },
  undo: function () {
    if (!this.undoStack.length) return false;
    /* 撤销：先撤销未点「应用」的颜色预览 */
    if (App.cancelColorPreview) App.cancelColorPreview();
    this.endGesture();
    this.redoStack.push(this.snapshot());
    const snap = this.undoStack.pop();
    this.restore(snap);
    return true;
  },
  redo: function () {
    if (!this.redoStack.length) return false;
    /* 重做：先撤销未点「应用」的颜色预览 */
    if (App.cancelColorPreview) App.cancelColorPreview();
    this.endGesture();
    this.undoStack.push(this.snapshot());
    const snap = this.redoStack.pop();
    this.restore(snap);
    return true;
  }
};
