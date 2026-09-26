'use strict';
App.initColorPanel = function () {
  App.cp = { h: 0, s: 0, v: 100, hex: '#ffffff', suppress: false, syncing: false };
  App.previewColor = null;
  App.previewRestore = [];
  App.histColors = [];
  App.wheelCanvas = $('#colorWheel');
  App.wheelCtx = App.wheelCanvas.getContext('2d');
  if (App.ensurePreviewColorFilter) App.ensurePreviewColorFilter();
  App.loadFavs();
  App.setPanelColor(App.state.lastColor, false);

  $('#hexInput').addEventListener('change', () => {
    const v = $('#hexInput').value.trim();
    const rgb = hexToRgb(v);
    if (!rgb) { showToast(App.i18n.t('toast.color.badHex')); App.setPanelColor(App.cp.hex, false); return; }
    App.setPanelColor(rgbToHex(rgb.r, rgb.g, rgb.b), false);
  });
  $('#hexInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') e.target.blur();
    e.stopPropagation();
  });

  const syncFromNums = () => {
    if (App.cp.suppress) return;
    const h = clamp(parseFloat($('#hInput').value) || 0, 0, 100) * 3.6;
    const s = clamp(parseFloat($('#sInput').value) || 0, 0, 100);
    const v = clamp(parseFloat($('#bInput').value) || 0, 0, 100);
    App.setPanelHSV(h, s, v, false);
  };
  ['hInput', 'sInput', 'bInput'].forEach(id => {
    $('#' + id).addEventListener('input', syncFromNums);
    $('#' + id).addEventListener('keydown', e => {
      if (e.key === 'Enter') e.target.blur();
      e.stopPropagation();
    });
  });

  const syncFromRanges = () => {
    if (App.cp.suppress) return;
    const h = clamp(parseFloat($('#hRange').value) || 0, 0, 100) * 3.6;
    const s = clamp(parseFloat($('#sRange').value) || 0, 0, 100);
    const v = clamp(parseFloat($('#bRange').value) || 0, 0, 100);
    App.setPanelHSV(h, s, v, false);
  };
  ['hRange', 'sRange', 'bRange'].forEach(id => {
    $('#' + id).addEventListener('input', syncFromRanges);
    $('#' + id).addEventListener('wheel', e => {
      e.preventDefault();
      const step = (id === 'hRange' ? 1 : 1) * (e.deltaY > 0 ? -1 : 1);
      const cur = parseFloat($('#' + id).value) || 0;
      const max = 100;
      $('#' + id).value = clamp(cur + step, 0, max);
      syncFromRanges();
    }, { passive: false });
  });

  const wheelPick = e => {
    const r = App.wheelCanvas.getBoundingClientRect();
    const cx = r.width / 2, cy = r.height / 2;
    const dx = e.clientX - r.left - cx, dy = e.clientY - r.top - cy;
    const rad = Math.sqrt(dx * dx + dy * dy);
    if (rad > cx) return;
    let h = Math.atan2(dy, dx) * 180 / Math.PI;
    if (h < 0) h += 360;
    const s = clamp(rad / cx, 0, 1) * 100;
    App.setPanelHSV(h, s, App.cp.v, false);
  };
  let wheelDrag = false;
  App.wheelCanvas.addEventListener('pointerdown', e => { wheelDrag = true; App.wheelCanvas.setPointerCapture(e.pointerId); wheelPick(e); });
  App.wheelCanvas.addEventListener('pointermove', e => { if (wheelDrag) wheelPick(e); });
  App.wheelCanvas.addEventListener('pointerup', () => { wheelDrag = false; });

  $('#btnEyeLayer').addEventListener('click', () => App.eyedropperToggle('layer'));
  $('#btnEyeBg').addEventListener('click', () => App.eyedropperToggle('bg'));

  $('#btnApplyColor').addEventListener('click', () => App.commitColor(App.cp.hex));

  $('#btnFav').addEventListener('click', App.addFavorite);
};

App.hsvHex = function (h, s, v) {
  const rgb = hsvToRgb(h, s, v);
  return rgbToHex(rgb.r, rgb.g, rgb.b);
};

App.drawWheel = function () {
  const c = App.wheelCanvas, cx = App.wheelCtx;
  const W = c.width, H = c.height, R = Math.min(W, H) / 2;
  const img = cx.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - R, dy = y - R;
      const rad = Math.sqrt(dx * dx + dy * dy);
      let a = 255;
      if (rad > R) a = 0;
      else if (rad > R - 1) a = 255 * (R - rad);
      let h = Math.atan2(dy, dx) * 180 / Math.PI;
      if (h < 0) h += 360;
      const s = Math.min(1, rad / R);
      const rgb = hsvToRgb(h, s * 100, App.cp.v);
      const i = (y * W + x) * 4;
      d[i] = rgb.r; d[i + 1] = rgb.g; d[i + 2] = rgb.b; d[i + 3] = a;
    }
  }
  cx.putImageData(img, 0, 0);
  const ang = App.cp.h * Math.PI / 180;
  const rr = App.cp.s / 100 * (R - 1);
  const ix = R + Math.cos(ang) * rr, iy = R + Math.sin(ang) * rr;
  cx.strokeStyle = '#ffffff'; cx.lineWidth = 2;
  cx.beginPath(); cx.arc(ix, iy, 5, 0, Math.PI * 2); cx.stroke();
  cx.strokeStyle = '#000000'; cx.lineWidth = 1;
  cx.beginPath(); cx.arc(ix, iy, 6.5, 0, Math.PI * 2); cx.stroke();
};

App.setPanelHSV = function (h, s, v, apply, preview) {
  h = clamp(h, 0, 360);
  s = clamp(s, 0, 100);
  v = clamp(v, 0, 100);
  App.cp.h = h; App.cp.s = s; App.cp.v = v;
  const hex = App.hsvHex(h, s, v);
  App.cp.hex = hex;
  App.cp.suppress = true;
  try {
    $('#hexInput').value = hex;
    $('#hInput').value = Math.round(h / 3.6);
    $('#sInput').value = Math.round(s);
    $('#bInput').value = Math.round(v);
    $('#hRange').value = Math.round(h / 3.6);
    $('#sRange').value = Math.round(s);
    $('#bRange').value = Math.round(v);
  } finally {
    App.cp.suppress = false;
  }
  $('#colorSwatch').style.background = hex;
  App.drawWheel();
  if (App.cp.syncing) return;
  if (apply) App.commitColor(hex);
  else if (preview !== false) App.applyColorPreview(hex);
};

App.setPanelColor = function (hex, apply, preview) {
  const rgb = hexToRgb(hex);
  if (!rgb) return;
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  let h = hsv.h;
  if (h === 0 && App.cp.h >= 359) h = 360;
  App.setPanelHSV(h, hsv.s, hsv.v, apply, preview);
};

App.commitColor = function (hex) {
  const items = (App.state.edit ? App.editTargets() : App.operationTargets()).slice();
  if (App.wholeSymbolColorTargets && App.wholeSymbolColorTargets(items)) {
    App.beginWholeSymbolColorVisual(items, hex);
    App.applyColorToTargets(hex, items);
    App.recordHistColor(hex);
    try { App.log('info', '应用颜色', { hex, targets: items.length, wholeSymbolFast: true }); }
    catch (e) { console.warn('[color] 记录整体换色日志失败', e && e.message); }
    return;
  }
  App.previewBitmapYield(items);
  App.paintColorImmediate(items, hex);
  App.applyColorToTargets(hex, items);
  App.recordHistColor(hex);
  App.settleColorPreview(items);
  try { App.log('info', '应用颜色', { hex, targets: items.length }); } catch (e) { /* ignore */ }
};

App.previewBitmapYield = function (items) {
  App._colorYield = 1;
  if (App.autoStatic && App.autoStatic.active && App.autoStaticRelease) App.autoStaticRelease();
  const un = App._previewUnproxied || (App._previewUnproxied = []);
  const walk = l => {
    if (!l) return;
    if (l.kind !== 'merged') return;
    if (App._proxyBake && App._proxyBake.has(l.id) && App.unbakeProxy) { App.unbakeProxy(l); un.push(l); }
    (l.children || []).forEach(walk);
  };
  (items || []).forEach(walk);
};
App.previewBitmapRestore = function () {
  const wasYield = !!App._colorYield;
  App._colorYield = 0;
  const un = App._previewUnproxied || [];
  App._previewUnproxied = [];
  un.forEach(l => { try { if (App.maybeBakeProxy) App.maybeBakeProxy(l); } catch (e) { /* ignore */ } });
  if (wasYield && App.autoStaticMaybe) App.autoStaticMaybe();
};

App.claimPreviewRestore = function (key, fn, el) {
  const set = App.previewRestoreKeys || (App.previewRestoreKeys = new Set());
  if (set.has(key)) return;
  set.add(key);
  if (!Array.isArray(App.previewRestore)) App.previewRestore = [];
  App.previewRestore.push({ k: String(key).split(':')[0], key: key, el: el || null, fn: () => { set.delete(key); fn(); } });
};
App.releasePreviewRestores = function (onlyKind) {
  const recs = Array.isArray(App.previewRestore) ? App.previewRestore : [];
  App.previewRestore = [];
  App.previewRestoreKeys = new Set();
  recs.forEach(rec => {
    if (!rec) return;
    if (onlyKind && rec.k !== onlyKind) return;
    try { (rec.fn || rec)(); } catch (e) { /* ignore */ }
  });
};

App.paintColorImmediate = function (items, hex) {
  const paint = l => {
    if (!l) return;
    if (l.kind === 'merged') { (l.children || []).forEach(paint); return; }
    if (l.kind !== 'symbol' || l.isMask || !l.el) return;
    const el = l.el;
    App.claimPreviewRestore('filter:' + l.id, () => { el.style.filter = ''; }, el);
    el.style.filter = App.previewColorFilter(hex);
  };
  (items || []).forEach(paint);
};

App.settleColorPreview = function (items) {
  const list = [];
  const walk = l => {
    if (!l) return;
    if (l.kind === 'merged') (l.children || []).forEach(walk);
    else if (l.kind === 'symbol' && !l.isMask && l.dataUri && l.symbolKey && App.symbolMap.has(l.symbolKey)) {
      list.push(App.symbolColorUrl(l).catch(() => ''));
    }
  };
  (items || []).forEach(walk);
  const clear = () => { App.previewColor = null; App.releasePreviewRestores('filter'); App.previewBitmapRestore(); };
  if (!list.length) { clear(); return; }
  Promise.race([Promise.all(list), new Promise(r => setTimeout(r, 1500))]).then(clear, clear);
};

App.previewColorFilterId = 'svePreviewTint';
App.previewColorMatrix = function (hex) {
  const rgb = hexToRgb(hex) || { r: 255, g: 255, b: 255 };
  const r = Math.round(rgb.r) / 255, g = Math.round(rgb.g) / 255, b = Math.round(rgb.b) / 255;
  return '0 0 0 0 ' + r + '  0 0 0 0 ' + g + '  0 0 0 0 ' + b + '  0 0 0 1 0';
};
App.ensurePreviewColorFilter = function () {
  if (App._previewColorMatrixEl) return App._previewColorMatrixEl;
  const host = (App.defs || App.svg);
  if (!host || !svgEl) return null;
  const f = svgEl('filter', {
    id: App.previewColorFilterId, 'color-interpolation-filters': 'sRGB',
    x: '0%', y: '0%', width: '100%', height: '100%'
  });
  const m = svgEl('feColorMatrix', { type: 'matrix', values: App.previewColorMatrix('#ffffff') });
  f.appendChild(m);
  host.appendChild(f);
  App._previewColorMatrixEl = m;
  return m;
};
App.previewColorFilter = function (hex) {
  const m = App.ensurePreviewColorFilter();
  if (!m) return '';
  m.setAttribute('values', App.previewColorMatrix(hex));
  return 'url(#' + App.previewColorFilterId + ')';
};

App.wholeSymbolColorPlan = function (items) {
  const layers = App.state.layers || [];
  const threshold = Math.max(300, Number(App.autoStaticLayerThreshold) || 0);
  if (App.state.edit || (App.editStatic && App.editStatic.active) || !items || !items.length) return null;
  const revision = App.contentRevision || 0;
  let cached = App._wholeSymbolColorEligibility;
  if (!cached || cached.layers !== layers || cached.length !== layers.length || cached.revision !== revision) {
    const flatLeaves = layers.length >= threshold && layers.every(l =>
      l && l.kind === 'symbol' && !l.isMask && l.el && l.imgEl) ? layers.slice() : null;
    let groupLeaves = null;
    const groupThreshold = Math.max(1000, threshold * 3);
    if (layers.length === 1 && layers[0] && layers[0].kind === 'merged') {
      const found = [];
      let valid = true;
      const walk = l => {
        if (!l || !valid) return;
        if (l.kind === 'merged') { (l.children || []).forEach(walk); return; }
        if (l.kind !== 'symbol' || l.isMask || !l.el || !l.imgEl) { valid = false; return; }
        found.push(l);
      };
      walk(layers[0]);
      if (valid && found.length >= groupThreshold) groupLeaves = found;
    }
    cached = {
      layers: layers, length: layers.length, revision: revision,
      flatLeaves: flatLeaves, groupLeaves: groupLeaves
    };
    App._wholeSymbolColorEligibility = cached;
  }
  if (cached.flatLeaves && items.length === layers.length &&
      App.state.selectedByTab && App.state.selected.size === layers.length &&
      items.every(l => layers.indexOf(l) >= 0)) {
    return { mode: 'flat', roots: layers, leaves: cached.flatLeaves };
  }
  if (cached.groupLeaves && items.length === 1 && items[0] === layers[0]) {
    return { mode: 'single-merged', roots: layers, leaves: cached.groupLeaves };
  }
  return null;
};
App.wholeSymbolColorTargets = function (items) {
  return !!App.wholeSymbolColorPlan(items);
};

App.beginWholeSymbolColorVisual = function (items, hex) {
  const root = App.layersRoot;
  if (!root) return false;
  const bitmap = App.autoStatic && App.autoStatic.active && !App.autoStatic.baking &&
    App.autoStaticBgEl && App.autoStaticBgEl.isConnected ? App.autoStaticBgEl : null;
  const target = bitmap || root;
  let visual = App._wholeSymbolColorVisual;
  if (!visual || visual.target !== target || visual.layers !== App.state.layers) {
    if (visual && visual.target) visual.target.style.filter = visual.oldFilter || '';
    visual = {
      target: target,
      layers: App.state.layers,
      oldFilter: target.style.filter || '',
      commitSeq: 0,
      hex: hex
    };
    App._wholeSymbolColorVisual = visual;
  }
  visual.hex = hex;
  visual.commitSeq = 0;
  target.style.filter = App.previewColorFilter(hex);
  App.previewColor = hex;
  return true;
};

App.clearWholeSymbolColorVisual = function (commitSeq) {
  const visual = App._wholeSymbolColorVisual;
  if (!visual) return;
  if (commitSeq && visual.commitSeq !== commitSeq) return;
  if (visual.target) visual.target.style.filter = visual.oldFilter || '';
  App._wholeSymbolColorVisual = null;
  App.previewColor = null;
};

App.materializeWholeSymbolColor = function (leaves, hex, revision) {
  const seq = (App._wholeSymbolColorCommitSeq || 0) + 1;
  App._wholeSymbolColorCommitSeq = seq;
  const visual = App._wholeSymbolColorVisual;
  if (visual) visual.commitSeq = seq;
  const started = performance.now();
  const sourcePromise = App.resolveBakeLayerSources
    ? App.resolveBakeLayerSources(leaves, 256, 4)
    : Promise.all(leaves.map(l => App.symbolColorUrl(l).catch(e => {
      console.warn('[color] 整体换色图源生成失败', l && l.id, e && e.message);
      return '';
    })));

  Promise.resolve(sourcePromise).then(urls => new Promise(resolve => {
    let i = 0;
    const applyStep = function () {
      if (seq !== App._wholeSymbolColorCommitSeq) { resolve(false); return; }
      const t0 = performance.now();
      let count = 0;
      while (i < leaves.length && count < 32 && (count < 4 || performance.now() - t0 < 5)) {
        const layer = leaves[i];
        const url = urls[i];
        if (layer && layer.color === hex && layer.imgEl && url) layer.imgEl.setAttribute('href', url);
        i++; count++;
      }
      if (i < leaves.length) setTimeout(applyStep, 0);
      else resolve(true);
    };
    applyStep();
  })).then(applied => {
    if (!applied || seq !== App._wholeSymbolColorCommitSeq) return;
    const finish = function (releaseOldCache) {
      if (seq !== App._wholeSymbolColorCommitSeq) return;
      if (releaseOldCache && App.autoStaticRelease) App.autoStaticRelease();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (seq !== App._wholeSymbolColorCommitSeq) return;
        App.clearWholeSymbolColorVisual(seq);
        if (releaseOldCache && App.autoStaticMaybe) App.autoStaticMaybe();
      }));
    };
    const waitForCache = function () {
      if (seq !== App._wholeSymbolColorCommitSeq) return;
      const sameRevision = (App.contentRevision || 0) === revision;
      const cacheReady = !!(App.autoStatic && App.autoStatic.active && !App.autoStatic.baking &&
        App.autoStatic.contentRevision === revision);
      const noCache = !App.autoStatic || (!App.autoStatic.active && !App.autoStatic.baking);
      if (cacheReady || noCache) { finish(false); return; }
      if (!sameRevision || performance.now() - started > 12000) { finish(true); return; }
      setTimeout(waitForCache, 50);
    };
    waitForCache();
  }).catch(e => {
    console.warn('[color] 整体换色后台更新失败', e && e.message);
    if (seq !== App._wholeSymbolColorCommitSeq) return;
    if (App.autoStaticRelease) App.autoStaticRelease();
    App.clearWholeSymbolColorVisual(seq);
    if (App.autoStaticMaybe) App.autoStaticMaybe();
  });
};

App.applyColorPreview = function (hex) {
  App.previewColor = null;
  const items = App.state.edit ? App.editTargets() : App.operationTargets();
  if (!items.length) { App.resetPreviewVisual(); return; }
  if (App.wholeSymbolColorTargets(items)) {
    App.beginWholeSymbolColorVisual(items, hex);
    return;
  }
  App.previewBitmapYield(items);
  const liveEls = new Set();
  const previewOne = l => {
    if (!l || l.isMask) return;
    if (App.updateImpDisplay) App.updateImpDisplay(l);
    if (l.kind === 'symbol' && l.el && !l.isMask) {
      const el = l.el;
      liveEls.add(el);
      const oldFilter = el.style.filter || '';
      App.claimPreviewRestore('filter:' + l.id, () => { el.style.filter = oldFilter; }, el);
      el.style.filter = App.previewColorFilter(hex);
    } else if (l.kind === 'pattern' && l.patBaseRect) {
      const rect = l.patBaseRect;
      liveEls.add(rect);
      const old = rect.getAttribute('fill');
      App.claimPreviewRestore('fill:' + l.id, () => { if (old) rect.setAttribute('fill', old); else rect.removeAttribute('fill'); }, rect);
      rect.setAttribute('fill', hex);
    } else if (l.kind === 'import' && l.el && !l.isMask) {
      const els = $$('[fill]', l.el).filter(e => {
        const f = e.getAttribute('fill');
        return f && f !== 'none';
      });
      const olds = els.map(e => e.getAttribute('fill'));
      els.forEach(e => liveEls.add(e));
      App.claimPreviewRestore('fill:' + l.id, () => els.forEach((e, i) => { if (olds[i]) e.setAttribute('fill', olds[i]); }), els[0] || null);
      els.forEach(e => e.setAttribute('fill', hex));
    }
  };
  items.forEach(it => {
    if (it.kind === 'bg') return;
    const walk = l => {
      if (l.kind === 'merged') (l.children || []).forEach(walk);
      else previewOne(l);
    };
    walk(it);
  });
  const recs = Array.isArray(App.previewRestore) ? App.previewRestore : [];
  const stale = recs.filter(rec => rec && rec.el && !liveEls.has(rec.el));
  if (stale.length) {
    App.previewRestore = recs.filter(rec => stale.indexOf(rec) < 0);
    stale.forEach(rec => { try { if (App.previewRestoreKeys) App.previewRestoreKeys.delete(rec.key); rec.fn(); } catch (e) { /* ignore */ } });
  }
  App.previewColor = hex;
};

App.resetPreviewVisual = function () {
  App.previewColor = null;
  App.clearWholeSymbolColorVisual();
  App.releasePreviewRestores();
  App.previewBitmapRestore();
};

App.cancelColorPreview = function () {
  const had = App.previewRestore && App.previewRestore.length > 0;
  App.resetPreviewVisual();
  if (had && App.state.edit) {
    const items = App.editTargets().filter(it => it && it.kind !== 'bg' && it.kind !== 'merged');
    if (items.length === 1) {
      const hex = (items[0].color && hexToRgb(items[0].color)) ? items[0].color : '#ffffff';
      App.cp.syncing = true;
      try { App.setPanelColor(hex, false); } finally { App.cp.syncing = false; }
    }
  }
};

App.applyColorToTargets = function (hex, targetItems) {
  App.state.lastColor = hex;
  let items = Array.isArray(targetItems) ? targetItems.slice() : App.editTargets();
  if (!items.length) items = App.operationTargets();
  const wholeSymbolPlan = App.wholeSymbolColorPlan ? App.wholeSymbolColorPlan(items) : null;
  const wholeSymbolFast = !!wholeSymbolPlan;
  if (wholeSymbolFast) App.beginWholeSymbolColorVisual(items, hex);
  if (App.state.edit) {
    App.editHist.checkpoint();
    App.editHist.scheduleEnd();
  } else if (items.length) {
    App.history.markContinuous();
    App.history.scheduleEnd();
  }
  if (wholeSymbolFast) {
    wholeSymbolPlan.leaves.forEach(it => { it.color = hex; it.thumbDirty = true; });
    wholeSymbolPlan.roots.forEach(it => {
      it.thumbDirty = true;
      if (it.kind === 'merged' && App.markProxyDirty) App.markProxyDirty(it);
    });
    App.refreshLayerThumbs();
    if (App.contentChanged) App.contentChanged();
    const revision = App.contentRevision || 0;
    App.materializeWholeSymbolColor(wholeSymbolPlan.leaves, hex, revision);
    return;
  }
  items.forEach(it => {
    if (it.kind === 'bg') return;
    if (it.kind === 'merged') {
      it.children.forEach(ch => App.setLayerColor(ch, hex));
      App.markThumbDirty(it);
    } else {
      App.setLayerColor(it, hex);
    }
  });
  App.refreshLayerThumbs();
  items.forEach(it => { if (it.kind !== 'bg' && App.dropEditStaticItem) App.dropEditStaticItem(it); });
  if (items.some(it => it.kind !== 'bg') && App.contentChanged) App.contentChanged({ preserveAutoStatic: false });
};

App.syncColorPanelToTargets = function () {
  if (App.state.edit) return;
  App.cancelColorPreview();
  const items = App.operationTargets();
  if (items.length !== 1 || items[0].kind === 'merged' || items[0].kind === 'bg') return;
  const hex = (items[0].color && hexToRgb(items[0].color)) ? items[0].color : '#ffffff';
  App.cp.syncing = true;
  try { App.setPanelColor(hex, false); } finally { App.cp.syncing = false; }
};

App.recordHistColor = function (hex) {
  hex = String(hex || '').toLowerCase();
  if (!hexToRgb(hex)) return;
  App.histColors = App.histColors.filter(c => c !== hex);
  App.histColors.unshift(hex);
  if (App.histColors.length > 16) App.histColors.length = 16;
  App.renderHistGrid();
};
App.applyColorNoHist = function (hex) {
  App.setPanelColor(hex, false, false);
  App.cancelColorPreview();
  App.applyColorToTargets(hex);
};

App.renderHistGrid = function () {
  const grid = $('#histGrid');
  if (!grid) return;
  grid.innerHTML = '';
  if (!App.histColors.length) {
    const empty = document.createElement('div');
    empty.className = 'fav-empty';
    empty.textContent = App.i18n.t('color.noHist');
    grid.appendChild(empty);
    return;
  }
  App.histColors.forEach(hex => {
    const sw = document.createElement('div');
    sw.className = 'hist-swatch';
    sw.style.background = hex;
    sw.addEventListener('click', () => App.applyColorNoHist(hex));
    const del = document.createElement('span');
    del.className = 'fav-del';
    del.textContent = '×';
    del.addEventListener('click', e => { e.stopPropagation(); App.removeHistColor(hex); });
    sw.appendChild(del);
    grid.appendChild(sw);
  });
};
App.removeHistColor = function (hex) {
  App.histColors = App.histColors.filter(c => c !== hex);
  App.renderHistGrid();
};

App.eyedropperToggle = function (mode) {
  try { App.log('info', '取色器', { mode }); } catch (e) { /* ignore */ }
  if (App.state.eyeMode === mode) { App.setEyedropper(null); return; }
  App.setEyedropper(mode);
};
App.setEyedropper = function (mode) {
  if (mode !== 'layer' && mode !== 'bg') mode = null;
  if (mode === 'bg' && !App.state.bg.image) {
    showToast(App.i18n.t('toast.bg.noBg2'));
    return;
  }
  if (App.state.eyeMode === 'bg') {
    if (App.eyeLayersDisplay !== undefined) {
      App.layersRoot.style.display = App.state.layersHidden ? 'none' : (App.eyeLayersDisplay || '');
      App.eyeLayersDisplay = undefined;
    }
    if (App.eyeBgDisplay !== undefined) {
      App.bgG.style.display = App.state.bg.hidden ? 'none' : (App.eyeBgDisplay || '');
      App.eyeBgDisplay = undefined;
    }
    if (App.eyeBgDispOpacity !== undefined) {
      if (!App.eyeOpacityUserChanged) {
        App.state.bgDisplayOpacity = App.eyeBgDispOpacity;
        if (App.applyBgDisplayOpacity) App.applyBgDisplayOpacity();
        if (App.updateBgOpacitySlider) App.updateBgOpacitySlider();
      }
      App.eyeBgDispOpacity = undefined;
    }
    if (App.state.selected.size) App.startFlash();
  }
  if (App.state.eyeMode === 'layer' && App.eyeLayersDispOpacity !== undefined) {
    if (!App.eyeOpacityUserChanged) {
      App.state.layersDisplayOpacity = App.eyeLayersDispOpacity;
      if (App.applyLayersDisplayOpacity) App.applyLayersDisplayOpacity();
      if (App.updateLayersDisplaySlider) App.updateLayersDisplaySlider();
    }
    App.eyeLayersDispOpacity = undefined;
  }
  App.eyeOpacityUserChanged = false;
  App.state.eyeMode = mode;
  if (mode) {
    if (App.endEditStatic && App.state.edit) App.endEditStatic();
  } else if (App.state.edit) {
    if (App.beginEditStatic) App.beginEditStatic();
  }
  App.svg.style.cursor = mode ? 'crosshair' : '';
  $('#btnEyeLayer').classList.toggle('active', mode === 'layer');
  $('#btnEyeBg').classList.toggle('active', mode === 'bg');
  if (mode === 'bg') {
    App.stopFlash();
    App.eyeLayersDisplay = App.layersRoot.style.display;
    App.layersRoot.style.display = 'none';
    App.eyeBgDisplay = App.bgG.style.display;
    App.bgG.style.display = '';
    App.eyeBgDispOpacity = App.state.bgDisplayOpacity;
    App.state.bgDisplayOpacity = 1;
    App.applyBgDisplayOpacity();
    App.updateBgOpacitySlider();
    showToast(App.i18n.t('toast.color.bgPick'));
  } else if (mode === 'layer') {
    App.eyeLayersDispOpacity = App.state.layersDisplayOpacity;
    App.state.layersDisplayOpacity = 1;
    App.applyLayersDisplayOpacity();
    App.updateLayersDisplaySlider();

  }
};
App.colorOfLayer = function (layer) {
  if (!layer || layer.isMask) return null;
  if (layer.kind === 'symbol' || layer.kind === 'pattern' || layer.kind === 'import') return layer.color || null;
  return null;
};
App.eyePickColor = function (layer, clientX, clientY) {
  if (!layer) return null;
  if (layer.kind === 'merged') {
    if (App.proxySampleColor && App._proxyBake && App._proxyBake.has(layer.id)) {
      const ps = App.proxySampleColor(layer, clientX, clientY);
      if (ps) return ps;
    }
    const kids = layer.children || [];
    for (let j = kids.length - 1; j >= 0; j--) {
      const ch = kids[j];
      if (ch.isMask) continue;
      if (ch.kind === 'merged') {
        const sub = App.eyePickColor(ch, clientX, clientY);
        if (sub) return sub;
      } else if (App.layerVisibleAtSync(ch, clientX, clientY)) {
        const c = App.colorOfLayer(ch);
        if (c) return c;
      }
    }
    return null;
  }
  return App.colorOfLayer(layer);
};
App.onEyeMove = function (e) {
  const mode = App.state.eyeMode;
  if (!mode) return;
  if (mode === 'bg') {
    const hex = App.sampleBackgroundColor(e.clientX, e.clientY);
    if (hex) App.setPanelColor(hex, false, false);
  } else {
    const layer = App.hitLayerPaintedSync(e.clientX, e.clientY);
    const hex = App.eyePickColor(layer, e.clientX, e.clientY);
    if (hex) App.setPanelColor(hex, false, false);
  }
};
App.onEyeDown = function (e) {
  const mode = App.state.eyeMode;
  if (!mode) return;
  if (mode === 'bg') {
    const hex = App.sampleBackgroundColor(e.clientX, e.clientY);
    if (!hex) return;
    App.setPanelColor(hex, true);
    App.setEyedropper(null);
  } else {
    const layer = App.hitLayerPaintedSync(e.clientX, e.clientY);
    const hex = App.eyePickColor(layer, e.clientX, e.clientY);
    if (!hex) return;
    App.setPanelColor(hex, true);
    App.setEyedropper(null);
  }
};

App.favKey = 'sve-fav-colors';
App.loadFavs = function () {
  try {
    App.favs = JSON.parse(localStorage.getItem(App.favKey) || '[]');
  } catch (e) { App.favs = []; }
  App.renderFavGrid();
};
App.saveFavs = function () {
  try { localStorage.setItem(App.favKey, JSON.stringify(App.favs)); } catch (e) { /* ignore */ }
};
App.addFavorite = function () {
  const hex = App.cp.hex;
  if (!App.favs.includes(hex)) {
    App.favs.push(hex);
    if (App.favs.length > 64) App.favs.shift();
    App.saveFavs();
    App.renderFavGrid();
    showToast(App.i18n.tf('toast.color.favAdded', { v: hex }));
  } else {
    showToast(App.i18n.t('toast.color.favExists'));
  }
};
App.removeFavorite = function (hex) {
  App.favs = App.favs.filter(c => c !== hex);
  App.saveFavs();
  App.renderFavGrid();
};
App.renderFavGrid = function () {
  const grid = $('#favGrid');
  grid.innerHTML = '';
  if (!App.favs.length) {
    const empty = document.createElement('div');
    empty.className = 'fav-empty';
    empty.textContent = App.i18n.t('color.noFav');
    grid.appendChild(empty);
    return;
  }
  App.favs.forEach(hex => {
    const sw = document.createElement('div');
    sw.className = 'fav-swatch';
    sw.style.background = hex;
    sw.addEventListener('click', () => App.applyColorNoHist(hex));
    const del = document.createElement('span');
    del.className = 'fav-del';
    del.textContent = '×';
    del.addEventListener('click', e => { e.stopPropagation(); App.removeFavorite(hex); });
    sw.appendChild(del);
    grid.appendChild(sw);
  });
};
