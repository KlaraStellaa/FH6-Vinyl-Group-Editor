'use strict';
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
  if (App.initPerfMonitor) App.initPerfMonitor();
  App.initRender();
  if (App.initClickLog) App.initClickLog();
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
  if (App.wireLayerPicker) App.wireLayerPicker();
  App.wireDragDrop();
  App.wireResize();
  if (App.Tabs) App.Tabs.start();

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
      if (App.state.edit && App.state.edit.type !== 'bg') return;
      App.switchTab(t.getAttribute('data-tab'));
    });
  });
};

App.wirePointer = function () {
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
      try { App.svg.setPointerCapture(e.pointerId); } catch (err) { }
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    if (App.settings && App.settings.panNeedsSpace === false &&
        !App.state.edit && !App.state.tabDown) {
      App.panPending = {
        x: e.clientX, y: e.clientY, pointerId: e.pointerId,
        vx: App.state.view.x, vy: App.state.view.y
      };
      try { App.svg.setPointerCapture(e.pointerId); } catch (err) { }
      e.preventDefault();
      return;
    }
    if (App.state.edit) App.onEditPointerDown(e);
    else if (App.state.tabDown) {
      const rolledId = App.rollbackTabAutoSel();
      App.tabPending = { x: e.clientX, y: e.clientY, ctrl: !!e.ctrlKey, active: false, pointerId: e.pointerId, rolledId };
    } else {
      App.onCanvasPointerDown(e);
    }
  });
  App.svg.addEventListener('pointermove', e => {
    if (App.state.eyeMode) { App.onEyeMove(e); return; }
    if (App.panPending && !App.drag) {
      if (Math.hypot(e.clientX - App.panPending.x, e.clientY - App.panPending.y) <= 4) return;
      App.drag = {
        kind: 'pan', startX: App.panPending.x, startY: App.panPending.y,
        vx: App.panPending.vx, vy: App.panPending.vy
      };
      App.panPending = null;
    }
    if (!App.drag && App.state.edit && App.state.anchorPlacing) { App.onAnchorHover(e.clientX, e.clientY); return; }
    if (App.tabPending && !App.tabPending.active &&
        Math.hypot(e.clientX - App.tabPending.x, e.clientY - App.tabPending.y) > 4) {
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
        App.onCanvasPointerDown(Object.assign({}, e, { clientX: p.x, clientY: p.y, _rolledId: p.rolledId }));
        App.drag = null;
        try { App.svg.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        return;
      }
    }
    if (App.boxSelect) App.endBoxSelect(e);
    if (App.drag && App.state.edit) App.onEditPointerUp();
    App.drag = null;
    try { App.svg.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  };
  App.svg.addEventListener('pointerup', up);
  App.svg.addEventListener('pointercancel', e => {
    App.panPending = null;
    App.cancelBoxSelect();
    up(e);
  });
  App.svg.addEventListener('dblclick', e => {
    if (App.state.edit || App.state.tabDown || App.state.spaceDown || App.state.eyeMode) return;
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
  document.addEventListener('click', e => {
    const t = e.target;
    const b = t && t.closest ? t.closest('button, input[type="range"]') : null;
    if (b) b.blur();
  }, true);
  window.addEventListener('keydown', e => {
    const t = e.target;
    const inInput = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    const inSpeedWin = !!(t && t.closest && t.closest('#speedPanel'));
    if (App.keymapUI && App.keymapUI.isOpen()) return;

    if (inInput) {
      if (e.key === 'Enter') {
        e.stopPropagation();
        try { e.target.blur(); } catch (err) { /* ignore */ }
      }
      return;
    }

    const A = App.keymap.actionFor(e, App.state.edit ? 'edit' : 'canvas');

    if (A === 'pan') {
      if (inSpeedWin) return;
      App.state.spaceDown = true; e.preventDefault(); return;
    }
    if (A === 'highlight' || A === 'editFlip') {
      if (inSpeedWin) return;
      if (A === 'editFlip') {
        if (!e.repeat) App.editFlipCycle();
        e.preventDefault();
        return;
      }
      if (!e.repeat) {
        App.state.tabGestureUsed = false;
        App.state.sweepMode = null;
        App.state.sweepDir = 0;
        App.actOnWhiteBoxLayer();
      }
      App.state.tabDown = true;
      App.syncPanelSelectionClasses();
      e.preventDefault();
      return;
    }
    if (e.key === 'Shift') { App.state.shiftDown = true; return; }
    if (A === 'escape') {
      if (inSpeedWin) return;
      if (App.state.eyeMode) { App.setEyedropper(null); }
      else if (App.state.edit) { App.exitEdit(true); }
      else if (App.state.replacing) { App.setReplacing(false); }
      else {
        const box = App.whiteBoxLayer();
        if (box) {
          const ids = App.state.layers.slice().reverse().map(l => l.id);
          const i = ids.indexOf(box.id);
          if (i >= 0) App.lastWheelIdx = i;
        }
        if (App.state.selected.size > 1) {
          App.state.selBarDismissed = true;
          App.updateSelToolbar();
        } else {
          App.state.selBarDismissed = true;
          App.setSelection([]);
        }
      }
      return;
    }
    if (A === 'editFinish' && !e.repeat) {
      App.exitEdit(false);
      return;
    }

    if (A === 'undo') {
      e.preventDefault();
      if (App.state.edit) {
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

    if (App.state.edit) {
      if (App.cancelColorPreview) App.cancelColorPreview();
      if (A === 'sizeMode') {
        if (!e.repeat && App.state.editMode === 'size') {
          App.state.sizeMode = App.state.sizeMode === 'prop' ? 'free' : 'prop';
          App.updateEditBar();
          showToast(App.state.sizeMode === 'prop' ? App.i18n.t('toast.main.propMode') : App.i18n.t('toast.main.freeMode'));
        }
        return;
      }
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
        if (!e.repeat && !App.state.keys.size) App.editHist.checkpoint();
        App.state.keys.add(A.slice(4).toLowerCase());
        return;
      }
    } else {
      if (A === 'toolbar' && !e.repeat) {
        const box = App.whiteBoxLayer();
        if (!box) return;
        const now = Date.now();
        if (now - (App.lastEnterTime || 0) < 400) {
          App.lastEnterTime = 0;
          App.enterEdit({ type: 'layer', id: box.id });
        } else if (App.state.selected.size > 1 || (App.state.selectedByTab && App.state.selected.size >= 1)) {
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
      if (A === 'up') { App.stepWhiteBox(-1); e.preventDefault(); return; }
      if (A === 'down') { App.stepWhiteBox(1); e.preventDefault(); return; }
      if (A === 'cut') { App.cutSelection(); return; }
      if (A === 'paste') { App.pasteClipboard(); return; }
      if (A === 'delete') { App.deleteSelection(); return; }
    }
    if (A === 'base') { App.toggleBase(); e.preventDefault(); return; }
  });
  const anyMatch = (id, e) => App.keymap.combos(id).some(c => window.SVE_KEYMAP.matchesEvent(c, e));
  window.addEventListener('keyup', e => {
    if (anyMatch('pan', e)) App.state.spaceDown = false;
    if (anyMatch('highlight', e) || anyMatch('editFlip', e)) {
      App.state.tabDown = false;
      App.state.sweepMode = null;
      App.state.sweepDir = 0;
      App.state.tabGestureUsed = false;
      App.state.tabAutoSel = null;
      App.syncPanelSelectionClasses();
    }
    if (e.key === 'Shift') App.state.shiftDown = false;
    const dirs = { moveUp: 'up', moveDown: 'down', moveLeft: 'left', moveRight: 'right' };
    Object.keys(dirs).forEach(id => { if (anyMatch(id, e)) App.state.keys.delete(dirs[id]); });
    if (!App.state.keys.size && App.state.edit) App.editHist.endGesture();
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
    if (!App.state.wheelZoomEnabled) return;
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
  App.svg.addEventListener('dragover', e => {
    const types = e.dataTransfer.types ? Array.from(e.dataTransfer.types) : [];
    if (types.includes('text/plain') || types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  });
  App.svg.addEventListener('drop', e => {
    const text = e.dataTransfer.getData('text/plain');
    if (text && text.indexOf('SVE:') === 0) {
      e.preventDefault();
      const spec = JSON.parse(text.slice(4));
      const p = App.screenToDoc(e.clientX, e.clientY);
      App.placePatternAt(spec, p.x, p.y);
      return;
    }
    if (e.dataTransfer.files && e.dataTransfer.files.length) {
      e.preventDefault();
      e.stopPropagation();
      App.handleFiles(e.dataTransfer.files);
    }
  });
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

App.i18n.onApply(function () {
  if (App.updateBaseButtons) App.updateBaseButtons();
  if (App.updateZoomWheelButton) App.updateZoomWheelButton();
  if (App.refreshCount) App.refreshCount();
  if (App.updateHideBgButton) App.updateHideBgButton();
  if (App.updateEditBar) App.updateEditBar();
  if (App.renderHistGrid) App.renderHistGrid();
  if (App.renderFavGrid) App.renderFavGrid();
  if (App.refreshShortcutPanel) App.refreshShortcutPanel();
  if (App.keymapUI) App.keymapUI.render();
  if (App.refreshEditBarKeys) App.refreshEditBarKeys();
  if (App.evDropdownSyncAll) App.evDropdownSyncAll();
  if (App.refreshFluentIcons) App.refreshFluentIcons();
  if (App.refreshToolbarIcons) App.refreshToolbarIcons();
  if (App.refreshLogPath) {
    var lp = document.getElementById('logPanel');
    if (lp && !lp.classList.contains('hidden')) App.refreshLogPath();
  }
  if (App.refreshLibraryPanel) App.refreshLibraryPanel();
  if (App.Home && App.Home.shown && App.Home.refresh) App.Home.refresh();
});
