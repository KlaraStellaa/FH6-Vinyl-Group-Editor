'use strict';
(function () {
  var MAP = [
    ['#btnOpen', 'btnOpen'], ['#btnSave', 'btnSave'], ['#btnSaveWork', 'btnSaveWork'],
    ['#btnOpenWork', 'btnOpenWork'],
    ['#btnHistAnchor', 'btnHistAnchor'], ['#btnBase', 'btnBase'], ['#btnGrid', 'btnGrid'],
    ['#btnZoomWheel', 'btnZoomWheel'], ['#btnShortcuts', 'btnShortcuts'],
    ['#helpFab', 'helpFab'],
    ['#btnOpenImage', 'btnOpenImage'], ['#btnBgImage', 'btnBgImage'],
    ['.tab-close', 'tabClose'], ['#tabHome', 'tabHome'], ['[data-tabid]', 'tabPill'],
    ['#tabNewDoc', 'tabNewDoc'], ['#btnSettings', 'btnSettings'],
    ['#btnEditPos', 'selEditPos'], ['#btnEditColor', 'selEditColor'], ['#btnReplace', 'selReplace'],
    ['#btnToMask', 'selToMask'], ['#btnToLayer', 'selToLayer'], ['#btnFlipH', 'selFlipH'],
    ['#btnFlipV', 'selFlipV'], ['#btnMerge', 'selMerge'], ['#btnSplit', 'selSplit'],
    ['#btnCut', 'selCut'], ['#btnCopy', 'selCopy'], ['#btnDelete', 'selDelete'],
    ['#btnSelectAll', 'selSelectAll'], ['#btnClearSel', 'selClearSel'],
    ['#btnSavePalette', 'selSavePalette'], ['#btnDeleteAll', 'selDeleteAll'],
    ['#btnLocateLayer', 'selLocateLayer'],
    ['#editBar [data-mode="move"]', 'editModeMove'], ['#editBar [data-mode="size"]', 'editModeSize'],
    ['#editBar [data-mode="rotate"]', 'editModeRotate'], ['#editBar [data-mode="skew"]', 'editModeSkew'],
    ['#editBar [data-mode="opacity"]', 'editModeOpacity'],
    ['#btnFinish', 'btnFinish'], ['#btnShowHandles', 'btnShowHandles'], ['#btnAxisHint', 'btnAxisHint'],
    ['#btnPlaceAnchor', 'btnPlaceAnchor'], ['#btnPropMode', 'btnPropMode'], ['#btnRemoveBg', 'btnRemoveBg'],
    ['#btnHideLayers', 'btnHideLayers'], ['#btnHideBg', 'btnHideBg'],
    ['#bgOpacityRange', 'bgOpacityRange'], ['#bgOpacityBgRange', 'bgOpacityBgRange'],
    ['#canvas', 'canvas'],
    ['.layer-item', 'layerItem'],
    ['#layerPlusRow', 'layerPlusRow'],
    ['#layerPickOv .lp-close', 'lpClose'], ['#layerPickOv .lp-row', 'lpRow'],
    ['.lib-item', 'libItem'],
    ['#panelMinBtn', 'panelMinBtn'], ['label[data-tab="lib"]', 'ptabLib'], ['label[data-tab="color"]', 'ptabColor'],
    ['#btnEyeLayer', 'btnEyeLayer'], ['#btnEyeBg', 'btnEyeBg'],
    ['#btnApplyColor', 'btnApplyColor'], ['#btnFav', 'btnFav'],
    ['[data-home-act="new"]', 'homeNew'], ['[data-home-act="open"]', 'homeOpen'],
    ['#btnFzaGeo', 'btnFzaGeo'], ['#btnFzaVinyl', 'btnFzaVinyl'], ['#btnFzaBackup', 'btnFzaBackup'],
    ['#btnFzaInject', 'btnFzaInject'], ['#btnFzaExport', 'btnFzaExport'],
    ['#homeSearch', 'homeSearch'], ['#homeSort', 'homeSort'],
    ['#btnHomeOpen', 'btnHomeOpen'], ['#btnHomeRename', 'btnHomeRename'],
    ['#btnHomeExportAs', 'btnHomeExportAs'], ['#btnHomeDelete', 'btnHomeDelete'],
    ['#btnHomeImport', 'btnHomeImport'], ['#btnHomeRefresh', 'btnHomeRefresh'],
    ['label[data-home-tab]', 'homeTabs'], ['#homeGrid .home-card', 'homeCard'],
    ['#btnLogCopy', 'btnLogCopy'], ['#btnLogOpen', 'btnLogOpen'], ['#btnLogClose', 'btnLogClose'],
    ['#btnShortcutClose', 'btnShortcutClose'],
    ['#btnEditSpeed', 'btnEditSpeed'], ['#btnNudgeSpeed', 'btnNudgeSpeed'],
    ['#btnKeymap', 'btnKeymap'], ['#btnLogInSettings', 'btnLogInSettings'],
    ['#btnSettingsClose', 'btnSettingsClose'],
    ['.speed-ok', 'dlgOk'], ['.km-ok', 'dlgOk'],
    ['.speed-cancel', 'dlgCancel'], ['.km-cancel', 'dlgCancel'],
    ['.speed-reset', 'speedReset'], ['.km-reset', 'speedReset'],
    ['.fza-cancel', 'fzaCancel'],
    ['.fza-multi', 'fzaMulti'], ['.fza-src-btn', 'fzaSource'],
    ['.fza-undo', 'fzaUndo'],
    ['.fza-body button.active', 'fzaImportFile']
  ];

  var armed = false;
  var ov = null, titleEl = null, bodyEl = null, okBtn = null;
  var hint = null;
  var last = null;

  function t(k) { return App.i18n.t(k); }
  function tf(k, p) { return App.i18n.tf ? App.i18n.tf(k, p) : App.i18n.t(k); }
  function known(k) { return t(k) !== k; }

  var KBD = { btnHideLayers: 'hideLayers', btnHideBg: 'hideBg' };

  function comboText(id) {
    if (!App.keymap || !App.keymap.combos || !window.SVE_KEYMAP) return '';
    return (App.keymap.combos(id) || []).map(function (c) {
      return window.SVE_KEYMAP.displayParts(c).map(function (p) {
        return p.i18n ? t(p.i18n) : p.text;
      }).join('+');
    }).join('/');
  }

  function labelOf(node, key) {
    if (key) {
      var nk = 'help.n.' + key;
      if (known(nk)) return t(nk);
    }
    var clone = node.cloneNode(true);
    if (clone.querySelectorAll) {
      Array.prototype.forEach.call(clone.querySelectorAll('kbd'), function (k) { k.remove(); });
    }
    var txt = (clone.textContent || '').replace(/\s+/g, ' ').trim();
    if (txt) return txt;
    var aria = node.getAttribute && node.getAttribute('aria-label');
    if (aria) return aria;
    return key || '?';
  }

  function resolveTarget(target) {
    if (!target || !target.tagName) return target;
    if (target.tagName === 'INPUT' && target.type === 'radio' && target.id) {
      var lb = document.querySelector('label[for="' + target.id + '"]');
      if (lb) return lb;
    }
    return target;
  }

  function find(target) {
    for (var i = 0; i < MAP.length; i++) {
      var node = target.closest ? target.closest(MAP[i][0]) : null;
      if (node) return { node: node, key: MAP[i][1] };
    }
    var generic = target.closest ? target.closest('button, input[type="range"], select') : null;
    if (generic) return { node: generic, key: null };
    return null;
  }

  function build() {
    if (ov && ov.isConnected) return ov;
    ov = document.createElement('div');
    ov.id = 'helpOv';
    ov.className = 'hidden';
    ov.innerHTML =
      '<div class="help-box" role="dialog" aria-modal="true">' +
        '<div class="help-title"></div>' +
        '<div class="help-body"></div>' +
        '<div class="help-foot"><button type="button" class="help-ok"></button></div>' +
      '</div>';
    document.body.appendChild(ov);
    titleEl = ov.querySelector('.help-title');
    bodyEl = ov.querySelector('.help-body');
    okBtn = ov.querySelector('.help-ok');
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    okBtn.addEventListener('click', function () { close(); });
    return ov;
  }

  function paint() {
    if (!last || !ov) return;
    var name = (last.node && last.node.isConnected) ? labelOf(last.node, last.key) : last.label;
    var txt = last.key ? t('help.' + last.key) : '';
    if (!txt || txt === 'help.' + last.key) txt = tf('help.unknown', { name: name });
    else {
      var act = last.key ? KBD[last.key] : null;
      var k = act ? comboText(act) : '';
      if (k) txt = txt + tf('help.kbdSuffix', { k: k });
    }
    titleEl.textContent = t('help.title') + ' · ' + name;
    bodyEl.textContent = txt;
    okBtn.textContent = t('help.close');
  }

  function open(hit) {
    build();
    last = { node: hit.node, key: hit.key, label: labelOf(hit.node, hit.key) };
    paint();
    App.showOverlay(ov);
  }
  function close() {
    if (!ov) return;
    App.hideOverlay(ov);
  }
  function closeNow() {
    if (!ov) return;
    ov.classList.add('hidden');
    ov.classList.remove('sve-closing');
    ov._sveHideToken = null;
  }

  function showHint() {
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'helpHint';
      document.body.appendChild(hint);
    }
    hint.textContent = t('help.hint');
    hint.classList.add('sve-show');
  }
  function hideHint() { if (hint) hint.classList.remove('sve-show'); }

  function enter() {
    closeNow();
    if (App.closeShortcutPanel) App.closeShortcutPanel();
    if (armed) return;
    armed = true;
    document.body.classList.add('sve-help-mode');
    var b = document.getElementById('btnShortcuts');
    if (b) b.classList.add('sve-help-armed');
    showHint();
  }
  function exit() {
    if (!armed) return;
    armed = false;
    document.body.classList.remove('sve-help-mode');
    var b = document.getElementById('btnShortcuts');
    if (b) b.classList.remove('sve-help-armed');
    hideHint();
  }

  var fab = null;

  function dialogOpen() {
    var list = document.querySelectorAll('.confirm-overlay, #layerPickOv, #helpOv, #homeOverlay');
    for (var i = 0; i < list.length; i++) {
      if (!list[i].classList.contains('hidden')) return true;
    }
    return false;
  }

  var fabTip = null;

  function buildFabTip() {
    if (fabTip && fabTip.isConnected) return fabTip;
    fabTip = document.createElement('span');
    fabTip.id = 'helpFabTip';
    fabTip.className = 'sc-tooltip';
    fabTip.textContent = 'QuQ';
    document.body.appendChild(fabTip);
    return fabTip;
  }

  function placeFabTip() {
    if (!fab || !fabTip) return;
    var r = fab.getBoundingClientRect();
    fabTip.style.left = (r.left + r.width / 2) + 'px';
    fabTip.style.top = (r.top - 8) + 'px';
  }

  function showFabTip() {
    if (!fab || !fab.isConnected) return;
    var tp = buildFabTip();
    placeFabTip();
    tp.classList.add('sc-tip-show');
  }

  function hideFabTip() {
    if (fabTip) fabTip.classList.remove('sc-tip-show');
  }

  function buildFab() {
    if (fab && fab.isConnected) return fab;
    fab = document.createElement('button');
    fab.id = 'helpFab';
    fab.type = 'button';
    fab.className = 'hidden';
    var src = document.getElementById('btnShortcuts');
    var svg = (src && src.querySelector) ? src.querySelector('svg') : null;
    if (svg) fab.appendChild(svg.cloneNode(true));
    else fab.textContent = '?';
    document.body.appendChild(fab);
    var go = function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      enter();
    };
    fab.addEventListener('click', go);
    fab.addEventListener('contextmenu', go);
    fab.addEventListener('mouseenter', showFabTip);
    fab.addEventListener('mouseleave', hideFabTip);
    fab.addEventListener('blur', hideFabTip);
    window.addEventListener('resize', function () {
      if (fabTip && fabTip.classList.contains('sc-tip-show')) placeFabTip();
    });
    return fab;
  }

  function syncFab() {
    var b = buildFab();
    var on = dialogOpen();
    b.classList.toggle('hidden', !on);
    if (!on) { hideFabTip(); return; }
    var nm = t('help.n.helpFab');
    b.setAttribute('aria-label', nm);
    b.removeAttribute('title');
    b.classList.toggle('sve-help-armed', armed);
  }

  function intercept(e) {
    if (!armed) return;
    var hit = find(resolveTarget(e.target));
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    if (e.type === 'click') { open(hit); exit(); }
  }
  ['pointerdown', 'mousedown', 'click'].forEach(function (tp) {
    document.addEventListener(tp, intercept, true);
  });

  function wire() {
    var b = document.getElementById('btnShortcuts');
    if (!b) return;
    b.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      enter();
    });
  }
  document.addEventListener('contextmenu', function (e) {
    if (!armed) return;
    var hit = (e.target && e.target.closest) ? e.target.closest('#btnShortcuts, #helpFab') : null;
    var b = document.getElementById('btnShortcuts');
    if (hit || (b && e.target === b)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    exit();
  }, true);

  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !armed) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    exit();
  }, true);

  if (App.i18n && App.i18n.onApply) {
    App.i18n.onApply(function () {
      if (hint && hint.classList.contains('sve-show')) hint.textContent = t('help.hint');
      if (ov && !ov.classList.contains('hidden')) paint();
      syncFab();
    });
  }

  wire();
  syncFab();
  setInterval(syncFab, 250);

  App.help = {
    isArmed: function () { return armed; },
    enter: enter,
    exit: exit,
    resolve: function (node) { return find(resolveTarget(node)); },
    dialogOpen: dialogOpen,
    MAP: MAP
  };
})();
