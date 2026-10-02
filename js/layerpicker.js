'use strict';
(function () {
  var ov = null, box = null, listEl = null;
  var lastFocus = null;

  function vis(el) {
    if (!el || !el.classList) return false;
    return !el.classList.contains('hidden');
  }

  App.layersAtPoint = function (clientX, clientY) {
    var out = [], seen = {}, topIds = {};
    App.state.layers.forEach(function (l) { topIds[l.id] = 1; });
    var els = document.elementsFromPoint ? document.elementsFromPoint(clientX, clientY) : [];
    for (var i = 0; i < els.length; i++) {
      var n = els[i], topId = null;
      while (n && n !== App.svg) {
        if (n.getAttribute && n.getAttribute('data-layer')) {
          topId = parseInt(n.getAttribute('data-layer'), 10);
        }
        n = n.parentNode;
      }
      if (topId === null || seen[topId] || !topIds[topId]) continue;
      seen[topId] = 1;
      var l = App.findLayer(topId);
      if (l) out.push(l);
    }
    if (!out.length) {
      for (var k = App.state.layers.length - 1; k >= 0; k--) {
        var lk = App.state.layers[k];
        var vis = false;
        try { vis = !!(App.layerVisibleAtSync && App.layerVisibleAtSync(lk, clientX, clientY)); } catch (e) { vis = false; }
        if (vis) out.push(lk);
      }
    }
    if (!out.length) {
      var pd = null;
      try { pd = App.screenToDoc(clientX, clientY); } catch (e) { pd = null; }
      if (pd) {
        for (var j = App.state.layers.length - 1; j >= 0; j--) {
          var lj = App.state.layers[j];
          var b = null;
          try { b = App.getItemDocBBox(lj); } catch (e) { b = null; }
          if (!b || !b.corners || b.corners.length < 4) continue;
          if (App.pointInQuad(pd, b.corners)) out.push(lj);
        }
      }
    }
    return out;
  };

  function paintCloseLabel() {
    var b = ov && ov.querySelector('.lp-close');
    if (b) b.setAttribute('aria-label', App.i18n.t('lp.close'));
  }

  if (App.i18n && App.i18n.onApply) App.i18n.onApply(paintCloseLabel);

  function build() {
    if (ov && ov.isConnected) return ov;
    ov = document.createElement('div');
    ov.id = 'layerPickOv';
    ov.className = 'hidden';
    ov.innerHTML =
      '<div class="lp-box" role="dialog">' +
        '<div class="lp-head">' +
          '<span class="lp-title" data-i18n="lp.title"></span>' +
          '<button class="lp-close" data-i18n="lp.close" data-i18n-attr="title">×</button>' +
        '</div>' +
        '<div class="lp-list"></div>' +
      '</div>';
    document.body.appendChild(ov);
    box = ov.querySelector('.lp-box');
    listEl = ov.querySelector('.lp-list');
    ov.addEventListener('pointerdown', function (e) {
      if (e.button === 2) return;
      if (e.target === ov) close();
    });

    ov.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      var hits = App.layersAtPoint(e.clientX, e.clientY);
      if (!hits.length) { close(); return; }
      openAt(e.clientX, e.clientY, hits);
    });
    ov.querySelector('.lp-close').addEventListener('click', function (e) { e.preventDefault(); close(); });
    listEl.addEventListener('click', function (e) {
      var row = e.target && e.target.closest ? e.target.closest('.lp-row') : null;
      if (row) pickRow(row);
    });
    paintCloseLabel();
    if (App.i18n && App.i18n.apply) App.i18n.apply(ov);
    return ov;
  }

  function rowFor(layer, isTop) {
    var row = document.createElement('div');
    row.className = 'lp-row' + (isTop ? ' sel' : '');
    row.setAttribute('data-layer', String(layer.id));
    var thumb = document.createElement('div');
    thumb.className = 'lp-thumb';
    var img = document.createElement('img');
    img.draggable = false;
    img.alt = '';
    thumb.appendChild(img);
    row.appendChild(thumb);
    var meta = document.createElement('div');
    meta.className = 'lp-meta';
    var name = document.createElement('div');
    name.className = 'lp-name';
    name.textContent = layer.name || (App.i18n.t('lp.unnamed'));
    meta.appendChild(name);
    if (layer.kind === 'merged') {
      var badge = document.createElement('span');
      badge.className = 'lp-badge';
      badge.textContent = '×' + App.countInLayer(layer);
      meta.appendChild(badge);
    }
    if (layer.isMask) {
      var mb = document.createElement('span');
      mb.className = 'lp-badge lp-mask';
      mb.textContent = App.i18n.t('lp.mask');
      meta.appendChild(mb);
    }
    row.appendChild(meta);
    App.getLayerThumb(layer).then(function (url) {
      if (!img.isConnected) return;
      if (url) { img.src = url; thumb.classList.add('has-img'); }
    }).catch(function () { });
    return row;
  }

  function pickRow(row) {
    if (!row) return;
    var id = parseInt(row.getAttribute('data-layer'), 10);
    var l = App.findLayer(id);
    close();
    if (!l) return;
    App.state.selectedByTab = false;
    App.state.selBarDismissed = false;
    var _bi = App.panelLayers().indexOf(l);
    if (_bi >= 0) App.lastWheelIdx = _bi;
    App.setSelection([l.id], { scrollPanel: true });
    if (App.requestFlashRefresh) App.requestFlashRefresh();
  }

  function openAt(clientX, clientY, hits) {
    build();
    lastFocus = document.activeElement;
    listEl.innerHTML = '';
    hits.forEach(function (l, i) { listEl.appendChild(rowFor(l, i === 0)); });
    App.showOverlay(ov);
    var pad = 8, w = box.offsetWidth, h = box.offsetHeight;
    var left = clientX + pad, top = clientY + pad;
    if (left + w + pad > window.innerWidth) left = clientX - w - pad;
    if (top + h + pad > window.innerHeight) top = clientY - h - pad;
    left = Math.max(pad, Math.min(left, window.innerWidth - w - pad));
    top = Math.max(pad, Math.min(top, window.innerHeight - h - pad));
    box.style.left = Math.round(left) + 'px';
    box.style.top = Math.round(top) + 'px';
    var br = box.getBoundingClientRect();
    if (clientX >= br.left && clientX <= br.right && clientY >= br.top && clientY <= br.bottom) {
      var altTop = (clientY - h - pad >= pad) ? (clientY - h - pad) : (clientY + pad + h <= window.innerHeight - pad ? clientY + pad : null);
      if (altTop !== null && !(clientX >= br.left && clientX <= br.right && clientY >= altTop && clientY <= altTop + h)) {
        top = altTop;
      } else {
        var altLeft = (clientX - w - pad >= pad) ? (clientX - w - pad) : (clientX + pad + w <= window.innerWidth - pad ? clientX + pad : null);
        if (altLeft !== null) left = altLeft;
      }
      box.style.left = Math.round(Math.max(pad, Math.min(left, window.innerWidth - w - pad))) + 'px';
      box.style.top = Math.round(Math.max(pad, Math.min(top, window.innerHeight - h - pad))) + 'px';
    }
  }

  function close() {
    if (!ov || ov.classList.contains('hidden') || ov.classList.contains('sve-closing')) return false;
    App.hideOverlay(ov);
    if (lastFocus && lastFocus.blur) { try { lastFocus.blur(); } catch (e) { /* ignore */ } }
    return true;
  }

  function isOpen() { return !!ov && !ov.classList.contains('hidden'); }

  App.wireLayerPicker = function () {
    var host = App.wrap || document.getElementById('canvasWrap');
    if (!host) return;
    host.addEventListener('contextmenu', function (e) {
      if (App.state.edit) return;
      var home = document.getElementById('homeOverlay');
      if (vis(home)) return;
      var hits = App.layersAtPoint(e.clientX, e.clientY);
      if (!hits.length) { if (isOpen()) close(); return; }
      e.preventDefault();
      openAt(e.clientX, e.clientY, hits);
    });
    host.addEventListener('wheel', function () { if (isOpen()) close(); }, { passive: true });
    window.addEventListener('blur', function () { if (isOpen()) close(); });
  };

  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !isOpen()) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    close();
  }, true);

  App.layerPicker = { openAt: openAt, close: close, isOpen: isOpen, layersAtPoint: App.layersAtPoint };
})();
