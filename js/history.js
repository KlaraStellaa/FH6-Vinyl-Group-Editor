'use strict';
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
      selIndexes: Array.from(App.state.selected).map(id => App.state.layers.findIndex(l => l.id === id)).filter(i => i >= 0),
      selectedByTab: !!App.state.selectedByTab,
      selBarDismissed: !!App.state.selBarDismissed,
      groupEdit: (App.state.groupEdit && App.state.groupEdit.length)
        ? App.state.groupEdit.map(fr => ({
            excluded: App.state.layers.map((l, i) => (fr.excluded.has(l) ? i : -1)).filter(i => i >= 0),
            anchor: fr.anchor ? App.state.layers.indexOf(fr.anchor) : -1
          }))
        : null
    };
  },
  trim: function () {
    if (this.undoStack.length > this.max) this.undoStack.shift();
  },
  markContinuous: function () {
    if (this.gesture) return;
    const s = this.snapshot();
    s.cont = true;
    this.undoStack.push(s);
    this.trim();
    this.redoStack = [];
    this.gesture = true;
    if (App.Tabs && App.Tabs.markDirty) App.Tabs.markDirty();
  },
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
    if (App.updateHideLayersButton) App.updateHideLayersButton();
    if (App.updateHideBgButton) App.updateHideBgButton();
    if (App.updateBgOpacitySlider) App.updateBgOpacitySlider();
    App.state.lastColor = snap.lastColor;
    App.state.clipboard = snap.clipboard.map(s => JSON.parse(JSON.stringify(s)));
    App.state.selected = new Set((snap.selIndexes || []).map(i => (App.state.layers[i] ? App.state.layers[i].id : null)).filter(Boolean));
    App.state.selectedByTab = !!snap.selectedByTab;
    App.state.selBarDismissed = !!snap.selBarDismissed;
    App.state.groupEdit = (snap.groupEdit || []).map(fr => {
      const set = new Set();
      (fr.excluded || []).forEach(i => { const l = App.state.layers[i]; if (l) set.add(l); });
      const anchor = (typeof fr.anchor === 'number' && App.state.layers[fr.anchor]) ? App.state.layers[fr.anchor] : null;
      return { excluded: set, anchor: anchor };
    });
    App.refreshPanel();
    App.refreshCount();
    App.refreshClipboardPanel();
    App.drawOutlines();
    App.updateSelToolbar();
    App.refreshLayerThumbs();
    if (App.contentChanged) App.contentChanged({ preserveAutoStatic: false });
    if (App.maybeBakeProxy) App.state.layers.forEach(l => { if (l.kind === 'merged') App.maybeBakeProxy(l); });
    if (App.stopFlash) App.stopFlash();
    if (App.state.selected.size && App.requestFlashRefresh) App.requestFlashRefresh();
  },
  undo: function () {
    if (!this.undoStack.length) return false;
    if (App.cancelColorPreview) App.cancelColorPreview();
    this.endGesture();
    this.redoStack.push(this.snapshot());
    const snap = this.undoStack.pop();
    this.restore(snap);
    return true;
  },
  redo: function () {
    if (!this.redoStack.length) return false;
    if (App.cancelColorPreview) App.cancelColorPreview();
    this.endGesture();
    this.undoStack.push(this.snapshot());
    const snap = this.redoStack.pop();
    this.restore(snap);
    return true;
  }
};
