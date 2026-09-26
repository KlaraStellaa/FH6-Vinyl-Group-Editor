'use strict';
function blurActiveButton() {
  const el = document.activeElement;
  if (el && el.blur && (el.tagName === 'BUTTON' || el.tagName === 'INPUT')) el.blur();
}
App.initIO = function () {
  $('#btnOpen').addEventListener('click', App.openSVG);
  document.addEventListener('click', e => {
    const b = e.target && e.target.closest && e.target.closest('button');
    if (b) setTimeout(() => b.blur(), 0);
  });
  window.addEventListener('dragover', e => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') >= 0) e.preventDefault();
  });
  window.addEventListener('drop', e => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    if (!/\.svg$/i.test(f.name)) return;
    e.preventDefault();
    const rd = new FileReader();
    rd.onload = () => {
      App.importSvgIntoCurrent(String(rd.result || ''), f.name.replace(/\.svg$/i, '') || App.i18n.t('name.untitled'));
      App.recordSvgSource(f.name);
      if (App.Tabs && App.Tabs.clearDirty) App.Tabs.clearDirty();
    };
    rd.onerror = () => showToast(App.i18n.t('toast.io.readFileFail'));
    rd.readAsText(f);
  });
  $('#btnSave').addEventListener('click', function () { App.exportForzaSVG(); });
  $('#btnSaveWork').addEventListener('click', function () { App.saveWorkCopy(); });
  const btnOpenWorkEl = document.getElementById('btnOpenWork');
  if (btnOpenWorkEl) btnOpenWorkEl.addEventListener('click', App.openWorkCopy);
  $('#btnHistAnchor').addEventListener('click', App.openHistAnchor);
  const logBtnInSettings = document.getElementById('btnLogInSettings');
  if (logBtnInSettings) logBtnInSettings.addEventListener('click', function () {
    if (App.settings) App.settings.toggle();
    App.toggleLogPanel();
  });
  $('#btnLogCopy').addEventListener('click', App.copyLog);
  $('#btnLogOpen').addEventListener('click', async () => {
    const r = await window.sveApi.logSave();
    if (!r || !r.ok) { showToast(App.i18n.tf('toast.io.logSaveFail', { v: ((r && r.error) || App.i18n.t('toast.unknownError')) })); return; }
    showToast(App.i18n.tf('toast.io.logSaved', { n: r.lines, v: r.path }));
    const o = await window.sveApi.logOpen();
    if (!o || !o.ok) showToast(App.i18n.t('toast.io.logOpenFail'));
  });
  $('#btnLogClose').addEventListener('click', () => $('#logPanel').classList.add('hidden'));
  $('#btnOpenImage').addEventListener('click', App.openBgImageDialog);
  $('#btnSavePalette').addEventListener('click', function () {
    const items = App.operationTargets();
    const sel = (items || []).slice()
      .sort((a, b) => App.state.layers.indexOf(a) - App.state.layers.indexOf(b));
    App.exportForzaSVG(sel.length ? sel : undefined);
  });
  App.startHistAnchors();
};

App.toggleLogPanel = async function () {
  const panel = $('#logPanel');
  const showing = !panel.classList.contains('hidden');
  if (showing) { panel.classList.add('hidden'); return; }
  await App.refreshLogPath();
  panel.classList.remove('hidden');
};
App.refreshLogPath = async function () {
  const el = $('#logPathText');
  if (!el) return;
  try {
    const r = await window.sveApi.logPath();
    if (r && r.path) el.textContent = App.i18n.tf('log.savedPath', { v: r.path });
    else el.textContent = App.i18n.tf('log.inMemory', { n: (r ? r.buffered : 0) });
  } catch (e) {
    el.textContent = App.i18n.t('log.pathUnavailable');
  }
};
App.copyLog = async function () {
  try {
    const r = await window.sveApi.logRead(200000);
    if (!r || !r.ok) { showToast(App.i18n.t('toast.io.logReadFail')); return; }
    const text = (r.content || '').trim();
    if (!text) { showToast(App.i18n.t('toast.io.logEmpty')); return; }
    await navigator.clipboard.writeText(text);

  } catch (e) {
    showToast(App.i18n.tf('toast.io.logCopyFail', { v: String(e).slice(0, 80) }));
  }
};

App.openBgImageDialog = async function () {
  const r = await window.sveApi.openImageDialog();
  blurActiveButton();
  if (r.canceled) {
    if (r.error) showToast(App.i18n.tf('toast.io.openImageFail', { v: r.error }));
    return;
  }
  App.setBackgroundImage(r.dataUrl);
};

App.recordSvgSource = function (name) {
  const nm = String(name || '');
  if (App.Tabs && App.Tabs.current) App.Tabs.current.svgSource = nm || null;
  else App.currentSvgSource = nm || null;
};

App.exportForzaSVG = async function (layersOverride) {
  const __t0 = performance.now();
  const sourceDoc = App.Tabs && App.Tabs.current ? App.Tabs.current : null;
  const sourceDocId = sourceDoc ? sourceDoc.id : null;
  const sourceRevision = sourceDoc ? (sourceDoc.contentRevision || 0) : 0;
  const fullDocumentSave = layersOverride === undefined || layersOverride === null;
  const built = App.buildForzaExportString(false, layersOverride);
  blurActiveButton();
  if (!built) return;
  const srcName = sourceDoc ? (sourceDoc.svgSource || null) : (App.currentSvgSource || null);
  const autoName = App.autoNamePrefix() + (Number(built.layers) || 0);
  const defName = String(srcName || autoName).replace(/\.svg$/i, '') || autoName;
  const inp = await App.fzaTextPrompt(App.i18n.t('dlg.saveSvgTitle'),
    App.i18n.t('dlg.saveSvgMsg'), defName);
  if (inp === null) { showToast(App.i18n.t('toast.io.saveCancelled')); return; }
  let nm = String(inp || defName).trim();
  nm = nm.replace(/\.svg$/i, '');
  if (!nm || nm.indexOf('/') >= 0 || nm.indexOf('\\') >= 0 || nm.indexOf('..') >= 0) {
    showToast(App.i18n.t('toast.home.badName')); return;
  }
  const final = nm + '.svg';
  // Exporting a single layer must not silently overwrite its parent SVG.
  const r = await window.sveApi.fileSaveSvg(final, built.str, fullDocumentSave ? srcName : null);
  if (r && r.canceled) { showToast(App.i18n.t('toast.io.saveCancelled')); return; }
  try { App.log('info', '保存SVG(命名)', { ms: Math.round(performance.now() - __t0), kb: Math.round(built.str.length / 1024), name: final, exists: !!(r && r.exists) }); } catch (e) { /* ignore */ }
  if (!r || !r.ok) { showToast(App.i18n.tf('toast.io.saveFail', { v: ((r && r.error) || '') })); return; }
  showToast(App.i18n.tf('toast.io.saved', { ov: (r.exists ? App.i18n.t('toast.io.overwrite') : ''), v: r.name }));
  if (fullDocumentSave) {
    if (sourceDoc && App.Tabs && App.Tabs.docs && App.Tabs.docs.includes(sourceDoc)) {
      sourceDoc.svgSource = final;
      if (App.Tabs.setDocLabel) App.Tabs.setDocLabel(sourceDocId, nm || App.i18n.t('name.untitled'));
      else { sourceDoc.label = nm || App.i18n.t('name.untitled'); if (App.Tabs.renderBar) App.Tabs.renderBar(); }
      if ((sourceDoc.contentRevision || 0) === sourceRevision) sourceDoc.dirty = false;
    } else if (!sourceDoc) {
      App.currentSvgSource = final;
    }
  }
  if (App.Home && App.Home.refresh) App.Home.refresh();
};

App.exportSVG = async function () {
  const built = App.buildExportString();
  if (!built) return;
  const autoName = App.autoNamePrefix() + App.state.layers.length + '.svg';
  const r = await window.sveApi.saveSvgDialog(autoName, built.str);
  blurActiveButton();
  if (r.canceled) {
    if (r.error) showToast(App.i18n.tf('toast.io.saveFail', { v: r.error }));
    return;
  }
  showToast(App.i18n.tf('toast.io.backupExported', { v: r.path }));
};

App.buildExportString = function () {
  if (!App.state.layers.length) { showToast(App.i18n.t('toast.io.noPatterns')); return null; }
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  App.state.layers.forEach(l => {
    const b = App.getItemDocBBox(l);
    minx = Math.min(minx, b.x); miny = Math.min(miny, b.y);
    maxx = Math.max(maxx, b.x + b.w); maxy = Math.max(maxy, b.y + b.h);
  });
  if (!isFinite(minx)) { showToast(App.i18n.t('toast.io.noBounds')); return null; }
  const pad = 20;
  const bw = maxx - minx + pad * 2, bh = maxy - miny + pad * 2;
  const bx = minx - pad, by = miny - pad;

  const c = App.svg.cloneNode(true);
  const gridRect = c.querySelector('#gridRect');
  const overlay = c.querySelector('#overlayG');
  const bgG = c.querySelector('#bgG');
  if (gridRect) gridRect.remove();
  if (overlay) overlay.remove();
  if (bgG) bgG.remove();
  const gridP = c.querySelector('#sveGridP');
  if (gridP) gridP.remove();
  $$('[data-proxy]', c).forEach(el => el.remove());
  $$('[data-layer]', c).forEach(el => el.removeAttribute('visibility'));
  $$('.sve-edit-static', c).forEach(el => el.remove());
  $$('[style]', c).forEach(el => { if (el.style && el.style.display === 'none') el.style.display = ''; });
  const layersRoot = c.querySelector('#layersRoot');
  if (layersRoot) {
    layersRoot.removeAttribute('id');
    layersRoot.removeAttribute('style');
    const ex = App.currentExcluded ? App.currentExcluded() : null;
    if (ex) {
      const scopeEls = [];
      App.state.layers.forEach(l => {
        if (ex.has(l)) return;
        const el = c.querySelector('[data-layer="' + l.id + '"]');
        if (el) scopeEls.push(el);
      });
      if (scopeEls.length >= 2) {
        const wrapG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        wrapG.setAttribute('id', App.i18n.t('name.mergedLayer'));
        scopeEls[0].parentNode.insertBefore(wrapG, scopeEls[0]);
        scopeEls.forEach(el => wrapG.appendChild(el));
      }
    }
  }
  c.removeAttribute('id');
  c.setAttribute('data-sve-version', '1');
  c.setAttribute('viewBox', bx + ' ' + by + ' ' + bw + ' ' + bh);
  c.setAttribute('width', bw);
  c.setAttribute('height', bh);
  $$('[data-layer]', c).forEach(el => {
    const id = parseInt(el.getAttribute('data-layer'), 10);
    const layer = App.findLayer(id);
    if (!layer) return;
    el.setAttribute('data-sve', JSON.stringify(App.serializeLayer(layer, false)));
  });
  const str = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(c);
  const d = new Date();
  const name = App.i18n.t('name.collageFile') + '-' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0') + '.svg';
  return { str, name };
};

App.openSVG = async function () {
  const r = await window.sveApi.openSvgDialog();
  blurActiveButton();
  if (r.canceled) {
    if (r.error) showToast(App.i18n.tf('toast.io.openFail', { v: r.error }));
    return;
  }
  App.importSvgIntoCurrent(r.content, (r.name || '').replace(/\.svg$/i, '') || App.i18n.t('name.untitled'));
  App.recordSvgSource(r.name);
  if (App.Tabs && App.Tabs.clearDirty) App.Tabs.clearDirty();
};

App.importSvgIntoCurrent = function (text, label) {
      if (App.Tabs && !App.Tabs.testMode && App.Home && App.Home.shown) { App.Tabs.prodNewSvg(text, label || App.i18n.t('name.untitled'), null); return; }
  if (App.Tabs && !App.Tabs.testMode) {
    if (!App.Tabs.docs.length) App.Tabs.addDoc({ silent: true, label: label || null });
    if (App.Home) App.Home.hide();
  }
  App.importSVGContent(text);
};

App.importSVGContent = function (text) {
  if (App.cancelColorPreview) App.cancelColorPreview();
  if (App.state.eyeMode && App.setEyedropper) App.setEyedropper(null);
  if (App.invalidateEditStatic) App.invalidateEditStatic();
  App.perfCtx.lastOp = App.i18n.t('name.importPrefix') + 'SVG';
  const __t0 = performance.now();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.querySelector('parsererror')) { showToast(App.i18n.t('toast.io.badSvgFile')); return; }
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg') { showToast(App.i18n.t('toast.io.notSvg')); return; }
  App.history.markDiscrete();
  const n0 = App.state.layers.length;
  const hasForzaUse = $$('use', root).some(u =>
    App.FZA.useRe.test(u.getAttribute('href') || u.getAttributeNS(XLINK, 'href') || ''));
  let __importKind = 'generic';
  const prevImporting = !!App._importingSvg;
  App._importingSvg = true;
  try {
    if (root.getAttribute('data-sve-version') === '1') { App.importOwn(root); __importKind = 'own'; }
    else if (root.getAttribute('data-sve-version') === '2' || hasForzaUse) { App.importForza(root); __importKind = 'forza'; }
    else App.importGeneric(root);
  } finally {
    App._importingSvg = prevImporting;
  }
  App.log('perf', '导入SVG', { kind: __importKind, ms: Math.round(performance.now() - __t0), layers: App.state.layers.length - n0, total: App.state.layers.length, kb: Math.round(text.length / 1024) });
  const news = App.state.layers.slice(n0);
  if (news.length) {
    const v = App.state.view;
    const vcx = v.x + (App.wrap.clientWidth / 2) / v.scale;
    const vcy = v.y + (App.wrap.clientHeight / 2) / v.scale;
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    news.forEach(l => {
      const b = App.getItemDocBBox(l);
      if (!isFinite(b.x + b.w)) return;
      minx = Math.min(minx, b.x); miny = Math.min(miny, b.y);
      maxx = Math.max(maxx, b.x + b.w); maxy = Math.max(maxy, b.y + b.h);
    });
    if (isFinite(minx)) {
      const dx = vcx - (minx + maxx) / 2, dy = vcy - (miny + maxy) / 2;
      news.forEach(l => { l.x += dx; l.y += dy; App.applyLayerTransform(l); });
    }
  }
  if (news.length > 1) {
    const merged = App.mergeLayers(news.map(l => l.id));
    if (merged) showToast(App.i18n.tf('toast.io.importedMerged', { n: news.length }));
  }
  if (news.length && App.contentChanged) App.contentChanged();
  if (App.warmupSymbols) App.warmupSymbols();
  if (App.refreshImpBitmaps) App.refreshImpBitmaps();
  if (App.maybeBakeProxy) {
    App.state.layers.forEach(l => { if (l.kind === 'merged') App.maybeBakeProxy(l); });
      if (App.holdUntilRendered) App.holdUntilRendered();
    setTimeout(() => {
      App.state.layers.forEach(l => {
        if (l.kind === 'merged' && App.countInLayer && App.countInLayer(l) > App.proxyThreshold &&
          App._proxyBake && !App._proxyBake.has(l.id)) App.maybeBakeProxy(l);
      });
    }, 1500);
  }
};

App.importOwn = function (root) {
  let count = 0;
  const fileInd = root.querySelector('#sveMaskInd');
  if (fileInd) {
    const local = $('#sveMaskInd', App.defs);
    if (local) local.remove();
    App.defs.appendChild(fileInd.cloneNode(true));
  } else {
    App.ensureMaskIndDef();
  }
  const buildFromEl = (el, top) => {
    const data = JSON.parse(el.getAttribute('data-sve') || '{}');
    const l = App.newLayer({
      kind: data.kind, name: data.name, color: data.color, opacity: data.opacity,
      x: data.x, y: data.y, w: data.w, h: data.h, sx: data.sx, sy: data.sy,
      rot: data.rot, skew: data.skew, flipH: data.flipH, flipV: data.flipV,
      isMask: data.isMask, symbolKey: data.symbolKey, patternKey: data.patternKey
    });
    const sizeFixed = App.normalizeSymbolSize(l);
    l.el = el;
    el.setAttribute('data-layer', l.id);
    el.setAttribute('data-kind', l.kind);
    if (l.kind === 'symbol') {
      const mask = el.querySelector('mask');
      let img = el.querySelector('image');
      if (!img) {
        const useEl = el.querySelector('use');
        const href = useEl ? (useEl.getAttribute('href') || '').replace(/^#/, '') : '';
        if (href) {
          const defEl = root.querySelector('#' + href);
          img = defEl && defEl.nodeName.toLowerCase() === 'image' ? defEl
            : (defEl ? defEl.querySelector('image') : null);
        }
      }
      if (mask) {
        mask.setAttribute('id', 'sveM' + l.id);
        l.maskEl = mask;
        const rect = el.querySelector('rect');
        if (rect) { rect.setAttribute('mask', 'url(#sveM' + l.id + ')'); l.rectEl = rect; }
      }
      if (img) l.dataUri = img.getAttribute('href') || img.getAttributeNS(XLINK, 'href') || '';
      if (l.symbolKey && App.symbolMap.get(l.symbolKey)) {
        const sym = App.symbolMap.get(l.symbolKey);
        l.dataUri = App.symbolUri(sym);
        l.w = sym.w; l.h = sym.h;
      }
      if (l.dataUri) App.ensureSymbolImageDef(l);
      if (sizeFixed) App.rebuildLayerContent(l);
    } else if (l.kind === 'pattern') {
      const rect = el.querySelector('rect');
      const fillM = rect ? /url\(#(svePat\d+)\)/.exec(rect.getAttribute('fill') || '') : null;
      if (fillM && root) {
        const oldPat = root.querySelector('#' + fillM[1]);
        if (oldPat) {
          const clone = oldPat.cloneNode(true);
          clone.setAttribute('id', 'svePat' + l.id);
          App.defs.appendChild(clone);
          l.patDefEl = clone;
          const base = clone.querySelector('rect');
          if (base) { base.setAttribute('fill', l.color || '#888888'); l.patBaseRect = base; }
          if (rect) { rect.setAttribute('fill', 'url(#svePat' + l.id + ')'); l.rectEl = rect; }
        }
      }
    } else if (l.kind === 'merged') {
      l.children = [];
      Array.from(el.children).forEach(ch => {
        if (ch.getAttribute && ch.getAttribute('data-sve')) l.children.push(buildFromEl(ch, false));
      });
    }
    App.applyLayerTransform(l);
    App.registerChildren(l);
    if (top) {
      App.addLayer(l);
      count++;
    }
    return l;
  };
  const all = $$('[data-sve]', root);
  App.state.batching = true;
  try {
    all.forEach(el => {
      let p = el.parentNode, nested = false;
      while (p && p !== root) {
        if (p.getAttribute && p.getAttribute('data-sve')) { nested = true; break; }
        p = p.parentNode;
      }
      if (!nested) buildFromEl(el, true);
    });
  } finally {
    App.state.batching = false;
  }
  App.refreshPanel();
  App.refreshCount();
  if (count && App.contentChanged && !App._importingSvg) App.contentChanged();
  showToast(App.i18n.tf('toast.imported', { n: count }));
};

App.importGeneric = function (root) {
  const host = svgEl('svg');
  const vb = root.viewBox && root.viewBox.baseVal;
  const vw = vb && vb.width ? vb.width : 2000;
  const vh = vb && vb.height ? vb.height : 2000;
  host.setAttribute('viewBox', '0 0 ' + vw + ' ' + vh);
  host.setAttribute('width', vw);
  host.setAttribute('height', vh);
  host.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;';
  const defs = root.querySelector('defs');
  if (defs) host.appendChild(defs.cloneNode(true));
  document.body.appendChild(host);
  const skip = ['defs', 'metadata', 'title', 'desc', 'namedview', 'style'];
  const children = Array.from(root.children).filter(ch => !skip.includes(ch.nodeName.toLowerCase()));
  const hostRect = host.getBoundingClientRect();
  let count = 0;
  App.state.batching = true;
  try {
    children.forEach(ch => {
      if (ch.nodeName.toLowerCase().indexOf(':') >= 0) return;
      host.appendChild(ch);
      const r = ch.getBoundingClientRect();
      if (!r.width || !r.height) { ch.remove(); return; }
      const cx = r.left + r.width / 2 - hostRect.left;
      const cy = r.top + r.height / 2 - hostRect.top;
      const prefix = 'imp' + App.state.nextId + '_';
      const map = new Map();
      $$('[id]', ch).forEach(e => { map.set(e.getAttribute('id'), prefix + e.getAttribute('id')); });
      if (map.size) {
        map.forEach((nv, ov) => {
          $$('[id="' + ov + '"]', ch).forEach(e => e.setAttribute('id', nv));
          $$('*', ch).forEach(e => {
            ['fill', 'stroke', 'mask', 'clip-path', 'filter'].forEach(attr => {
              const v = e.getAttribute(attr);
              if (v && v.indexOf('url(#' + ov + ')') >= 0) e.setAttribute(attr, v.split('url(#' + ov + ')').join('url(#' + nv + ')'));
            });
            const st = e.getAttribute('style');
            if (st && st.indexOf('url(#' + ov + ')') >= 0) e.setAttribute('style', st.split('url(#' + ov + ')').join('url(#' + nv + ')'));
            const href = e.getAttribute('href') || e.getAttributeNS(XLINK, 'href');
            if (href && href === '#' + ov) {
              if (e.hasAttribute('href')) e.setAttribute('href', '#' + nv);
              else e.setAttributeNS(XLINK, 'href', '#' + nv);
            }
          });
        });
      }
      const _ox = r.left - hostRect.left, _oy = r.top - hostRect.top;
      if (_ox || _oy) {
        const _t = ch.getAttribute("transform");
        ch.setAttribute("transform", "translate(" + (-_ox) + " " + (-_oy) + ")" + (_t ? " " + _t : ""));
      }
      const markup = ch.outerHTML;
      ch.remove();
      const l = App.newLayer({
        kind: 'import', name: App.i18n.t('name.importPrefix') + '·' + ch.nodeName.toLowerCase() + '-' + (count + 1),
        x: cx, y: cy, w: r.width, h: r.height, color: '#ffffff', importMarkup: markup
      });
      App.addLayer(l);
      count++;
    });
  } finally {
    App.state.batching = false;
  }
  document.body.removeChild(host);
  App.refreshPanel();
  App.refreshCount();
  if (count && App.contentChanged && !App._importingSvg) App.contentChanged();
  if (!count) showToast(App.i18n.t('toast.io.nothingImported'));
  else showToast(App.i18n.tf('toast.imported', { n: count }));
};

App.placePatternAt = function (spec, x, y) {
  if (App.cancelColorPreview) App.cancelColorPreview();
  App.history.markDiscrete();
  const inv = clamp(1 / (App.state.view.scale || 1), 0.02, 50);
  let l = null;
  if (spec.kind === 'symbol') {
    const sym = App.symbolMap.get(spec.key);
    if (!sym) return;
    l = App.newLayer({
      kind: 'symbol', name: sym.label, w: sym.w, h: sym.h,
      x, y, sx: inv, sy: inv, color: App.state.lastColor
    });
    l.symbolKey = spec.key;
    l.dataUri = App.symbolUri(sym);
    App.addLayer(l);
  } else {
    const pat = App.patterns.find(p => p.key === spec.key);
    if (!pat) return;
    l = App.newLayer({
      kind: 'pattern', name: pat.name, w: 100, h: 100,
      x, y, sx: inv, sy: inv, color: App.state.lastColor
    });
    l.patternKey = spec.key;
    App.addLayer(l);
  }
  if (App.state.batching) {
    App.state.selected = new Set([l.id]);
    App.state.selectedByTab = false;
    App.lastWheelIdx = 0;
  } else if (App.state.selected.size > 1 || (App.state.selectedByTab && App.state.selected.size >= 1)) {
    App.lastWheelIdx = 0;
    App.scrollItemToTop(l);
    App.syncPanelSelectionClasses();
    App.updateSelToolbar();
    App.requestFlashRefresh();
  } else {
    App.state.selBarDismissed = false;
    App.state.selectedByTab = false;
    App.lastWheelIdx = 0;
    App.setSelection([l.id], { scrollPanel: true });
    if (App.requestFlashRefresh) App.requestFlashRefresh();
  }
  return l;
};

App.buildPaletteExportString = function (layers) {
  const list = Array.isArray(layers) ? layers.filter(Boolean) : (layers ? [layers] : []);
  if (!list.length) return null;
  const defs = svgEl('defs');
  let seq = 0;
  const processOne = layer => {
    const g = layer.el.cloneNode(true);
    $$('[data-proxy]', g).forEach(el => el.remove());
    $$('[data-layer]', g).forEach(el => el.removeAttribute('visibility'));
    $$('.sve-edit-static', g).forEach(el => el.remove());
    $$('[style]', g).forEach(el => { if (el.style && el.style.display === 'none') el.style.display = ''; });
    $$('use', g).forEach(u => {
      const href = u.getAttribute('href') || u.getAttributeNS(XLINK, 'href') || '';
      if (href && href.indexOf('#sveImg') === 0) {
        const src = $('#' + href.slice(1), App.defs);
        if (src && !$('#' + href.slice(1), defs)) defs.appendChild(src.cloneNode(true));
      }
    });
    $$('[fill]', g).forEach(el => {
      const m = /url\(#(svePat\d+)\)/.exec(el.getAttribute('fill') || '');
      if (!m) return;
      const oldId = m[1];
      if ($('#' + oldId, defs)) return;
      const src = $('#' + oldId, App.defs);
      if (!src) return;
      const newId = 'palPat' + (++seq);
      const clone = src.cloneNode(true);
      clone.setAttribute('id', newId);
      defs.appendChild(clone);
      $$('[fill]', g).forEach(e2 => {
        const f = e2.getAttribute('fill');
        if (f && f.indexOf('url(#' + oldId + ')') >= 0) {
          e2.setAttribute('fill', f.split('url(#' + oldId + ')').join('url(#' + newId + ')'));
        }
      });
    });
    const attach = (el, l) => {
      el.setAttribute('data-sve', JSON.stringify(App.serializeLayer(l, true)));
      if (l.kind === 'merged' && l.children) {
        const kids = Array.from(el.children || []).filter(c => c.getAttribute && c.getAttribute('data-layer'));
        l.children.forEach((ch, i) => { const k = kids[i]; if (k) attach(k, ch); });
      }
    };
    attach(g, layer);
    return g;
  };
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  list.forEach(l => {
    const b = App.getItemDocBBox(l);
    if (!isFinite(b.x + b.w)) return;
    minx = Math.min(minx, b.x); miny = Math.min(miny, b.y);
    maxx = Math.max(maxx, b.x + b.w); maxy = Math.max(maxy, b.y + b.h);
  });
  if (!isFinite(minx)) { showToast(App.i18n.t('toast.io.noLayerBounds')); return null; }
  const pad = 20;
  const bw = Math.max(1, maxx - minx + pad * 2), bh = Math.max(1, maxy - miny + pad * 2);
  const svg = svgEl('svg', {
    xmlns: 'http://www.w3.org/2000/svg',
    'data-sve-version': '1',
    'data-sve-palette': '1',
    viewBox: (minx - pad) + ' ' + (miny - pad) + ' ' + bw + ' ' + bh,
    width: bw, height: bh
  });
  if (defs.childNodes.length) svg.appendChild(defs);
  list.forEach(l => svg.appendChild(processOne(l)));
  const str = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
  return { str, name: App.i18n.t('name.paletteFile') + '.svg' };
};

App.applySavedPalette = function (name, content, x, y) {
  if (App.cancelColorPreview) App.cancelColorPreview();
  if (App.invalidateEditStatic) App.invalidateEditStatic();
  let doc;
  try { doc = new DOMParser().parseFromString(content, 'image/svg+xml'); }
  catch (e) { showToast(App.i18n.tf('toast.io.paletteBad', { v: name })); return; }
  if (doc.querySelector('parsererror')) { showToast(App.i18n.tf('toast.io.paletteBroken', { v: name })); return; }
  const tops = Array.from(doc.documentElement.children).filter(el => el.getAttribute && el.getAttribute('data-sve'));
  if (!tops.length) { showToast(App.i18n.tf('toast.io.paletteNoLayers', { v: name })); return; }
  const vb = (doc.documentElement.getAttribute('viewBox') || '').split(/[\s,]+/).map(parseFloat);
  let cx = 0, cy = 0;
  if (vb.length >= 4) { cx = vb[0] + vb[2] / 2; cy = vb[1] + vb[3] / 2; }
  const layers = [];
  for (const top of tops) {
    let slim;
    try { slim = JSON.parse(top.getAttribute('data-sve')); }
    catch (e) { showToast(App.i18n.tf('toast.io.layerDataBroken', { v: name })); return; }
    const l = App.deserializeLayer(slim);
    App.relinkSymbolData(l);
    if (!l.el) App.buildLayerElement(l);
    if (vb.length >= 4) { l.x += x - cx; l.y += y - cy; }
    App.applyLayerTransform(l);
    layers.push(l);
  }
  App.history.markDiscrete();
  App.state.batching = true;
  try {
    layers.forEach(l => App.addLayer(l));
  } finally {
    App.state.batching = false;
  }
  if (!App.state.layersHidden && App.state.eyeMode !== 'bg') App.layersRoot.style.display = '';
  App.refreshPanel();
  App.refreshCount();
  if (App.state.selected.size > 1 || (App.state.selectedByTab && App.state.selected.size >= 1)) {
    App.state.selBarDismissed = false;
    App.lastWheelIdx = 0;
    const top = App.state.layers[App.state.layers.length - 1];
    if (top && App.scrollItemToTop) App.scrollItemToTop(top);
    App.syncPanelSelectionClasses();
    App.updateSelToolbar();
    App.requestFlashRefresh();
  } else {
    App.state.selBarDismissed = false;
    App.state.selectedByTab = false;
    App.lastWheelIdx = 0;
    App.setSelection([]);
    App.syncPanelSelectionClasses();
  }
  if (App.refreshImpBitmaps) App.refreshImpBitmaps();
  if (layers.length && App.contentChanged) App.contentChanged();
  showToast(App.i18n.tf('toast.io.placed', { v: name }));
};

App.handleFiles = function (files) {
  Array.from(files).forEach(f => {
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    const prod = !!(App.Tabs && !App.Tabs.testMode);
    if (ext === 'svg') {
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result);
        App.importSvgIntoCurrent(text, f.name.replace(/\.svg$/i, '') || App.i18n.t('name.untitled'));
      };
      reader.readAsText(f);
    } else if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'jfif', 'ico', 'tif', 'tiff'].includes(ext)) {
      if (prod && !App.Tabs.docs.length) App.Tabs.addDoc({ silent: true, label: null });
      const reader = new FileReader();
      reader.onload = () => App.setBackgroundImage(String(reader.result));
      reader.readAsDataURL(f);
    } else {
      showToast(App.i18n.tf('toast.io.badFileType', { v: f.name }));
    }
  });
};

App.workCopyLayerFromSlim = function (slim) {
  slim = slim || {};
  const out = Object.assign({}, slim);
  if (slim.kind === 'merged') out.children = (slim.children || []).map(App.workCopyLayerFromSlim);
  if (slim.kind === 'symbol' && !out.dataUri && slim.symbolKey && App.symbolMap && App.symbolMap.get) {
    const sym = App.symbolMap.get(slim.symbolKey);
    if (sym && App.symbolUri) out.dataUri = App.symbolUri(sym);
  }
  return out;
};

App.buildWorkCopyData = function (layers, b, stateData, histColors) {
  stateData = stateData || {};
  return {
    type: 'sve-work-copy',
    version: 1,
    layers: layers || [],
    bg: b ? {
      dataUrl: b.dataUrl, x: b.x, y: b.y, w: b.w, h: b.h,
      sx: b.sx, sy: b.sy, rot: b.rot, skew: b.skew, opacity: b.opacity,
      flipH: !!b.flipH, flipV: !!b.flipV
    } : null,
    bgHidden: !!stateData.bgHidden,
    bgDisplayOpacity: stateData.bgDisplayOpacity ?? 1,
    layersHidden: !!stateData.layersHidden,
    layersDisplayOpacity: stateData.layersDisplayOpacity ?? 1,
    groupEdit: stateData.groupEdit || null,
    histColors: (histColors || stateData.histColors || []).slice(0, 16),
    lastColor: stateData.lastColor,
    view: {
      x: stateData.view ? stateData.view.x : 0,
      y: stateData.view ? stateData.view.y : 0,
      scale: stateData.view ? stateData.view.scale : 1
    }
  };
};

App.buildWorkCopyString = function () {
  const s = App.state;
  const stateData = {
    bgHidden: !!s.bg.hidden,
    bgDisplayOpacity: s.bgDisplayOpacity ?? 1,
    layersHidden: !!s.layersHidden,
    layersDisplayOpacity: s.layersDisplayOpacity ?? 1,
    lastColor: s.lastColor,
    view: s.view,
    groupEdit: (s.groupEdit && s.groupEdit.length)
      ? s.groupEdit.map(fr => ({
          excluded: s.layers.map((l, i) => (fr.excluded.has(l) ? i : -1)).filter(i => i >= 0),
          anchor: fr.anchor ? s.layers.indexOf(fr.anchor) : -1
        }))
      : null
  };
  const data = App.buildWorkCopyData(
    s.layers.map(l => App.serializeLayer(l, true)),
    s.bg.image,
    stateData,
    App.histColors
  );
  return JSON.stringify(data);
};

App.buildWorkCopyStringForDoc = function (doc) {
  if (!doc) return null;
  if (App.Tabs && App.Tabs.current === doc) return App.buildWorkCopyString();
  const d = doc.data || {};
  const layers = (d.layers || []).map(App.workCopyLayerFromSlim);
  return JSON.stringify(App.buildWorkCopyData(layers, doc.bg || null, d, d.histColors));
};

App.recordWorkSource = function (source) {
  if (App.Tabs && App.Tabs.current) App.Tabs.current.workSource = source || null;
  else App.currentWorkSource = source || null;
};

App.saveWorkCopy = async function () {
  if (App.cancelColorPreview) App.cancelColorPreview();
  const __t0 = performance.now();
  const sourceDoc = App.Tabs && App.Tabs.current ? App.Tabs.current : null;
  const sourceDocId = sourceDoc ? sourceDoc.id : null;
  const sourceRevision = sourceDoc ? (sourceDoc.contentRevision || 0) : 0;
  const source = (sourceDoc && sourceDoc.workSource) || App.currentWorkSource || null;
  const str = App.buildWorkCopyString();
  const r = await window.sveApi.fileSaveWork(str, source);
  blurActiveButton();
  try { App.log('info', '保存工作进程', { ms: Math.round(performance.now() - __t0), kb: Math.round(str.length / 1024), path: r && r.path, overwrite: !!(source && r && r.ok) }); } catch (e) { /* ignore */ }
  if (!r || !r.ok) { showToast(App.i18n.tf('toast.io.saveFail', { v: ((r && r.error) || '') })); return null; }
  if (sourceDoc && App.Tabs && App.Tabs.docs && App.Tabs.docs.includes(sourceDoc)) {
    if ((sourceDoc.contentRevision || 0) === sourceRevision) sourceDoc.dirty = false;
    if (r.source) sourceDoc.workSource = r.source;
    const label = (r.name || '').replace(/\.svework$/i, '') || App.i18n.t('name.workcopy');
    if (App.Tabs.setDocLabel) App.Tabs.setDocLabel(sourceDocId, label);
    else { sourceDoc.label = label; if (App.Tabs.renderBar) App.Tabs.renderBar(); }
  } else if (r.source) {
    App.currentWorkSource = r.source;
  }
  showToast(App.i18n.tf('toast.io.workSaved', { v: (r.name || '') }));
  if (App.Home && App.Home.refresh) App.Home.refresh();
  return r;
};

App.openWorkCopy = async function () {
  const r = await window.sveApi.workOpen();
  blurActiveButton();
  if (r.canceled) {
    if (r.error) showToast(App.i18n.tf('toast.io.openFail', { v: r.error }));
    return;
  }
  App.openWorkCopyContent(r.content, r.name, r.source);
};

App.openWorkCopyByName = async function (name) {
  const r = await window.sveApi.fileRead('workcopy', name);
  if (!r.ok) { showToast(App.i18n.tf('toast.home.openWorkFail', { v: (r.error || '') })); return; }
  App.openWorkCopyContent(r.content, r.name, r.source);
};

App.openWorkCopyContent = function (content, name, source) {
  let data;
  try { data = JSON.parse(content); }
  catch (e) { showToast(App.i18n.t('toast.io.workBroken')); return; }
  if (!data || data.type !== 'sve-work-copy') { showToast(App.i18n.t('toast.io.notWorkFile')); return; }
  if (App.state.edit) App.exitEdit(false);
  App.restoreWorkCopy(data);
  App.recordWorkSource(source || null);
  showToast(App.i18n.tf('toast.io.workOpened', { v: name }));
};

App.restoreWorkCopy = function (data) {
  App.history.markDiscrete();
  if (App.cancelColorPreview) App.cancelColorPreview();
  if (App.state.eyeMode && App.setEyedropper) App.setEyedropper(null);
  if (App.invalidateEditStatic) App.invalidateEditStatic();
  App.state.batching = true;
  try {
    App.state.layers.slice().forEach(l => App.removeTopLayer(l));
    App.bgSeq++;
    if (App.state.bg.image && App.state.bg.image.el) App.state.bg.image.el.remove();
    App.state.bg.image = null;
    App.state.bg.hidden = false;
    App.state.layersHidden = false;
    App.state.layersDisplayOpacity = 1;
    App.state.selected = new Set();
    App.state.selectedByTab = false;
    (data.layers || []).forEach(slim => {
      const l = App.deserializeLayer(slim);
      App.relinkSymbolData(l);
      App.addLayer(l);
    });
  } finally {
    App.state.batching = false;
  }
  if (data.bg && data.bg.dataUrl) {
    const m = data.bg;
    const token = ++App.bgSeq;
    loadImage(m.dataUrl).then(img => {
      if (token !== App.bgSeq) return;
      const model = {
        kind: 'bg',
        x: m.x, y: m.y, w: m.w, h: m.h,
        sx: m.sx, sy: m.sy, rot: m.rot, skew: m.skew, opacity: m.opacity,
        flipH: !!m.flipH, flipV: !!m.flipV,
        dataUrl: m.dataUrl, imgEl: img, el: null
      };
      model.el = svgEl('image', {
        href: m.dataUrl,
        x: -m.w / 2, y: -m.h / 2,
        width: m.w, height: m.h,
        preserveAspectRatio: 'none', 'pointer-events': 'none'
      });
      App.bgG.appendChild(model.el);
      App.applyBgTransform(model);
      App.state.bg.image = model;
      App.state.bg.hidden = !!data.bgHidden;
      App.state.bgDisplayOpacity = (typeof data.bgDisplayOpacity === 'number') ? data.bgDisplayOpacity : 1;
      App.applyBgDisplayOpacity();
      App.updateBaseButtons();
      App.updateHideBgButton();
      App.updateBgOpacitySlider();
    }).catch(() => showToast(App.i18n.t('toast.bg.readFail2')));
  }
  App.histColors = Array.isArray(data.histColors) ? data.histColors.slice(0, 16) : [];
  App.renderHistGrid();
  if (data.lastColor) App.state.lastColor = data.lastColor;
  App.state.groupEdit = (data.groupEdit || []).map(fr => {
    const set = new Set();
    (fr.excluded || []).forEach(i => { const l = App.state.layers[i]; if (l) set.add(l); });
    const anchor = (typeof fr.anchor === 'number' && App.state.layers[fr.anchor]) ? App.state.layers[fr.anchor] : null;
    return { excluded: set, anchor: anchor };
  });
  App.state.hideOthers = false;
  App.state.layersHidden = !!data.layersHidden;
  App.state.layersDisplayOpacity = (typeof data.layersDisplayOpacity === 'number') ? data.layersDisplayOpacity : 1;
  App.updateHideLayersButton();
  App.updateLayersDisplaySlider();
  App.applyLayersDisplayOpacity();
  if (!(data.bg && data.bg.dataUrl)) {
    App.updateBgOpacitySlider();
    if (App.updateHideBgButton) App.updateHideBgButton();
  }
  if (data.view && isFinite(data.view.x)) {
    App.state.view.x = data.view.x;
    App.state.view.y = data.view.y;
    App.state.view.scale = clamp(data.view.scale || 1, 0.02, 32);
  }
  App.updateView();
  if (App.Tabs && App.Tabs.clearDirty) App.Tabs.clearDirty();
  App.ensureMaskIndDef();
  App.refreshPanel();
  App.refreshCount();
  App.refreshLayerThumbs();
  if (App.maybeBakeProxy) App.state.layers.forEach(l => { if (l.kind === 'merged') App.maybeBakeProxy(l); });
  if (App.warmupSymbols) App.warmupSymbols();
  if (App.contentChanged) App.contentChanged({ preserveAutoStatic: false });
  if (App.requestFlashRefresh) App.requestFlashRefresh(false);
  if (App._proxyBake && App.countInLayer && App.proxyThreshold !== undefined) {
    setTimeout(() => {
      App.state.layers.forEach(l => {
        if (l.kind === 'merged' && App.countInLayer(l) > App.proxyThreshold && !App._proxyBake.has(l.id)) {
          if (App.maybeBakeProxy) App.maybeBakeProxy(l);
        }
      });
    }, 1500);
  }
};

App.startHistAnchors = function () {
  if (App._histAnchorTimer) return;
  App._histAnchorTimer = setInterval(() => {
    if (App.state.layers.length > 0 || (App.state.bg.image && App.state.bg.image.el)) {
      App.saveHistAnchor();
    }
  }, 900000);
};

App.saveHistAnchor = async function () {
  const __t0 = performance.now();
  const str = App.buildWorkCopyString();
  const r = await window.sveApi.histAnchorSave(str);
  if (!r.ok) { console.warn('[hist-anchor] 保存失败', r.error); return null; }
  try { App.log('info', '历史锚点保存', { name: r.name, ms: Math.round(performance.now() - __t0) }); } catch (e) { /* ignore */ }
  return r.name;
};

App.openHistAnchor = async function () {
  const list = await window.sveApi.histAnchorList();
  blurActiveButton();
  if (!list.ok) { showToast(App.i18n.tf('toast.io.anchorListFail', { v: (list.error || '') })); return; }
  if (!list.files.length) { showToast(App.i18n.t('toast.io.noAnchors')); return; }
  App.showHistAnchorPicker(list.files);
};

App.showHistAnchorPicker = function (files) {
  let ov = $('#histAnchorOv');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'histAnchorOv';
    ov.className = 'confirm-overlay hidden';
    ov.innerHTML = '<div class="confirm-box anchor-box"><div class="anchor-title" data-i18n="toolbar.histAnchor">恢复工作进程</div><div class="anchor-list"></div><div class="anchor-btns"><button class="anchor-cancel" data-i18n="dlg.cancel">取消</button></div></div>';
    document.body.appendChild(ov);
    if (App.i18n) App.i18n.apply(ov);
    ov.addEventListener('click', e => { if (e.target === ov) App.hideOverlay(ov); });
    ov.querySelector('.anchor-cancel').addEventListener('click', () => App.hideOverlay(ov));
    if (App.attachDlgClose) App.attachDlgClose(ov.querySelector('.confirm-box'), () => { App.hideOverlay(ov); return true; });
  }
  const listEl = ov.querySelector('.anchor-list');
  listEl.innerHTML = '';
  files.slice().reverse().forEach(f => {
    const item = document.createElement('div');
    item.className = 'anchor-item';
    item.innerHTML = '<img class="anchor-thumb" alt="" aria-hidden="true">' +
      '<span class="anchor-time"></span><span class="anchor-name"></span>';
    item.querySelector('.anchor-time').textContent = f.time;
    item.querySelector('.anchor-name').textContent = f.name;
    const thumbImg = item.querySelector('.anchor-thumb');
    if (thumbImg && App.buildSvgFromAnchor && App.fzaSvgThumb) {
      (async () => {
        try {
          const built = await App.buildSvgFromAnchor(f.name);
          const svg = built && built.str ? built.str : null;
          if (!svg) return;
          const url = await App.fzaSvgThumb('anchor:' + f.name, svg, 0);
          if (url && thumbImg.isConnected) {
            thumbImg.src = url;
            thumbImg.classList.add('ready');
          }
        } catch (e) {
          console.warn('[anchor] 缩略图生成失败', String(e && e.message || e).slice(0, 160));
        }
      })();
    }
    item.addEventListener('click', () => {
      App.hideOverlay(ov);
      App.pickHistAnchor(f.name, f.time);
    });
    listEl.appendChild(item);
  });
  App.showOverlay(ov);
};

App.pickHistAnchor = async function (name, time) {
  const hasWork = App.state.layers.length > 0 || (App.state.bg.image && App.state.bg.image.el);
  let savedBefore = null;
  if (hasWork) savedBefore = await App.saveHistAnchor();
  const r = await window.sveApi.histAnchorRead(name);
  if (!r.ok) { showToast(App.i18n.tf('toast.io.anchorReadFail', { v: (r.error || '') })); return; }
  let data;
  try { data = JSON.parse(r.content); }
  catch (e) { showToast(App.i18n.t('toast.io.anchorBroken')); return; }
  if (!data || data.type !== 'sve-work-copy') { showToast(App.i18n.t('toast.io.anchorInvalid')); return; }
  if (App.state.edit) App.exitEdit(false);
  App.restoreWorkCopy(data);
  showToast(App.i18n.tf('toast.io.rewound', { v: time, extra: (savedBefore ? App.i18n.t('toast.io.rewoundExtra') : '') }));
};

App.holdUntilRendered = function () {
  const root = App.layersRoot;
  if (!root) return;
  const busy = function () {
    const baking = (App._proxyBaking && Object.keys(App._proxyBaking).length) || 0;
    const queued = (App._proxyQueue && App._proxyQueue.size) || 0;
    return baking + queued;
  };
  if (!busy()) return;
  root.style.opacity = '0';
  const t0 = performance.now();
  const tick = function () {
    if (!busy() || performance.now() - t0 > 4000) { root.style.opacity = ''; return; }
    setTimeout(tick, 100);
  };
  setTimeout(tick, 100);
};
