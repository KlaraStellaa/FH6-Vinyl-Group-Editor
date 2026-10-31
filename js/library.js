'use strict';
App.symbols = [];        
App.symbolMap = new Map();
App.categories = [];     
App.patterns = [];       

App.LIB_CAT_MAP = {
  '01_Primitives': { id: 'c01', key: 'lib.cat.01' },
  '02_Community_Vinyls_1': { id: 'c02', key: 'lib.cat.02' },
  '03_Community_Vinyls_2': { id: 'c03', key: 'lib.cat.03' },
  '04_Community_Vinyls_3': { id: 'c04', key: 'lib.cat.04' },
  '05_Community_Vinyls_4': { id: 'c05', key: 'lib.cat.05' },
  '06_Gradient_Shapes': { id: 'c06', key: 'lib.cat.06' },
  '07_Stripes': { id: 'c07', key: 'lib.cat.07' },
  '08_Tears': { id: 'c08', key: 'lib.cat.08' },
  '09_Racing_Icons': { id: 'c09', key: 'lib.cat.09' },
  '10_Flames': { id: 'c10', key: 'lib.cat.10' },
  '11_Paint_Splats': { id: 'c11', key: 'lib.cat.11' },
  '12_Tribal': { id: 'c12', key: 'lib.cat.12' },
  '13_Nature': { id: 'c13', key: 'lib.cat.13' },
  '14_Upper_Letters_1': { id: 'font1', key: 'lib.cat.font1' },
  '15_Lower_Letters_1': { id: 'font1', key: 'lib.cat.font1' },
  '16_Upper_Letters_2': { id: 'font2', key: 'lib.cat.font2' },
  '17_Lower_Letters_2': { id: 'font2', key: 'lib.cat.font2' },
  '18_Upper_Letters_3': { id: 'font3', key: 'lib.cat.font3' },
  '19_Lower_Letters_3': { id: 'font3', key: 'lib.cat.font3' },
  '20_Upper_Letters_4': { id: 'font4', key: 'lib.cat.font4' },
  '21_Lower_Letters_4': { id: 'font4', key: 'lib.cat.font4' },
  '22_Upper_Letters_5': { id: 'font5', key: 'lib.cat.font5' },
  '23_Lower_Letters_5': { id: 'font5', key: 'lib.cat.font5' },
  '24_Upper_Letters_6': { id: 'font6', key: 'lib.cat.font6' },
  '25_Lower_Letters_6': { id: 'font6', key: 'lib.cat.font6' },
  '26_Upper_Letters_7': { id: 'font7', key: 'lib.cat.font7' },
  '27_Lower_Letters_7': { id: 'font7', key: 'lib.cat.font7' },
  '28_Upper_Letters_8': { id: 'font8', key: 'lib.cat.font8' },
  '29_Lower_Letters_8': { id: 'font8', key: 'lib.cat.font8' },
  '30_Upper_Letters_9': { id: 'font9', key: 'lib.cat.font9' },
  '31_Lower_Letters_9': { id: 'font9', key: 'lib.cat.font9' },
  '32_Upper_Letters_10': { id: 'font10', key: 'lib.cat.font10' },
  '33_Lower_Letters_10': { id: 'font10', key: 'lib.cat.font10' },
  '34_Upper_Letters_11': { id: 'font11', key: 'lib.cat.font11' },
  '35_Lower_Letters_11': { id: 'font11', key: 'lib.cat.font11' }
};
App.LIB_HIDE_PATTERN_GROUP = true;
App.libText = null;
App.symbolUri = s => 'data:image/jpeg;base64,' + App.libText.slice(s.uriStart, s.uriEnd);

App.loadLibrary = async function () {
  const [symText, patText] = await Promise.all([
    fetch('assets/FH6_Vinyl_Symbols.svg').then(r => { if (!r.ok) throw new Error('symbols fetch ' + r.status); return r.text(); }),
    fetch('assets/FH6_Vinyl_Patterns.svg').then(r => { if (!r.ok) throw new Error('patterns fetch ' + r.status); return r.text(); })
  ]);
  App.libText = symText;
  try {
    const r = window.sveApi && window.sveApi.libAssetVer ? await window.sveApi.libAssetVer() : null;
    App.libAssetVer = (r && r.ok && r.ver) ? r.ver : ('len:' + symText.length + ':' + patText.length);
  } catch (e) {
    App.libAssetVer = 'len:' + symText.length + ':' + patText.length;
  }
  App.parseSymbols();
  App.parsePatterns(patText);
  App.ensureMaskIndDef();
  await App.loadLibThumbManifest();
  App.buildLibraryPanel();
  App.state.loaded = true;
  $('#loadingOverlay').classList.add('hidden');
};

App.loadLibThumbManifest = function () {
  if (!App.LIB_THUMB_PRE_URL) App.LIB_THUMB_PRE_URL = 'assets/lib-thumbs/index.json';
  const load = fetch(App.LIB_THUMB_PRE_URL).then(r => {
    if (!r.ok) return null;
    return r.json();
  }).then(man => {
    if (!man || !Array.isArray(man.keys) || !man.keys.length) return;
    if (Number(man.symLen) !== (App.libText || '').length) {
      console.warn('[library] 预渲染缩略图清单与素材不匹配（symLen ' + man.symLen + ' ≠ ' + (App.libText || '').length + '），改用现算');
      return;
    }
    App.LIB_THUMB_PRE = new Set(man.keys);
    App.LIB_THUMB_PRE_BASE = new URL('assets/lib-thumbs/', location.href).href;
    if (App.kickLibraryThumbQueue) App.kickLibraryThumbQueue();
  }).catch(() => {   });
  return Promise.race([load, new Promise(r => setTimeout(r, 400))]);
};

App.libThumbPreUrl = function (symbol) {
  if (!App.LIB_THUMB_PRE || !symbol || !symbol.key) return '';
  if (!App.LIB_THUMB_PRE.has(symbol.key)) return '';
  return App.LIB_THUMB_PRE_BASE + encodeURIComponent(symbol.key) + '.png';
};

App.parseSymbols = function () {
  const text = App.libText;
  const re = /<symbol\s+([^>]*)>/g;
  let m, count = 0;
  while ((m = re.exec(text))) {
    const attrs = m[1];
    const end = text.indexOf('</symbol>', m.index);
    if (end < 0) continue;
    const seg = text.slice(m.index, end);
    const idM = /id="([^"]+)"/.exec(attrs);
    const labM = /inkscape:label="([^"]+)"/.exec(attrs);
    const wM = /width="([^"]+)"/.exec(attrs);
    const hM = /height="([^"]+)"/.exec(attrs);
    if (!idM || !labM) continue;
    const prefix = 'xlink:href="data:image/jpeg;base64,';
    const up = seg.indexOf(prefix);
    if (up < 0) continue;
    const rel = up + prefix.length;
    const b64 = /^[A-Za-z0-9+/=]+/.exec(seg.slice(rel));
    if (!b64) continue;
    const label = labM[1];
    const parts = label.split('|');
    const sym = {
      key: idM[1],
      cat: (parts[0] || App.i18n.t('name.uncategorized')).trim(),
      label: parts.length > 1 ? parts[1].trim() : idM[1],
      w: parseFloat(wM ? wM[1] : 128) || 128,
      h: parseFloat(hM ? hM[1] : 128) || 128,
      uriStart: m.index + rel,
      uriEnd: m.index + rel + b64[0].length,
      thumb: null
    };
    App.symbols.push(sym);
    App.symbolMap.set(sym.key, sym);
    count++;
  }
  const catOrder = [];
  const catMap = new Map();
  App.symbols.forEach(s => {
    const m = App.LIB_CAT_MAP[s.cat] || { id: s.cat, key: null };
    let g = catMap.get(m.id);
    if (!g) { g = { id: m.id, key: m.key, items: [] }; catMap.set(m.id, g); catOrder.push(m.id); }
    g.items.push(s);
  });
  App.categories = catOrder.map(id => catMap.get(id));
  console.log('[library] symbols:', count, 'categories:', App.categories.length,
    'sizes:', App.categories.map(c => c.items.length).join('/'));
};

App.parsePatterns = function (text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  $$('pattern', doc).forEach(p => {
    const key = p.getAttribute('id');
    const rect = p.querySelector('rect');
    const path = p.querySelector('path');
    App.patterns.push({
      key,
      name: key === 'mask_indicator_dark' ? App.i18n.t('name.maskDark') : App.i18n.t('name.maskLight'),
      node: p,
      fill: rect ? rect.getAttribute('fill') : '#888888',
      stroke: path ? path.getAttribute('stroke') : '#aaaaaa'
    });
  });
  console.log('[library] patterns:', App.patterns.length);
};

App.maskThemeKey = function () {
  return App.state.bg.base === 'dark' ? 'mask_indicator_dark' : 'mask_indicator_light';
};

App.ensureMaskIndDef = function () {
  if (!App.defs) return;
  const themeKey = App.maskThemeKey();
  const neutralize = node => {
    if (typeof MASK_INDICATOR_TRANSPARENT === 'undefined' || !MASK_INDICATOR_TRANSPARENT) return;
    node.querySelectorAll('*').forEach(el => {
      el.setAttribute('fill', 'none');
      el.setAttribute('stroke', 'none');
      el.removeAttribute('style');
    });
    node.setAttribute('data-mask-t', '1');
  };
  let cur = $('#sveMaskInd', App.defs);
  if (cur) {
    if (cur.getAttribute('data-theme') !== themeKey) {
      cur.remove();
      cur = null;
    } else {
      neutralize(cur);
      return;
    }
  }
  const src = (App.patterns || []).find(p => p.key === themeKey);
  if (!src) return;
  const node = src.node.cloneNode(true);
  node.setAttribute('id', 'sveMaskInd');
  node.setAttribute('data-theme', themeKey);
  neutralize(node);
  App.defs.appendChild(node);
};

App.libFilter = null;    

App.libClickLog = [];
App.libClickTraceOn = true;
App.libClickTrace = function (cat, item, tile, path, act) {
  if (!App.libClickTraceOn) { act(); return null; }
  const scroll = $('#libScroll');
  const rec = {
    groupKey: (cat && cat.id) || null,    
    renderedIndex: -1,
    scrollOffset: scroll ? Math.round(scroll.scrollTop) : 0,
    tileId: item && item.key,
    previewId: item && item.key,      
    committedId: null,
    path: path
  };
  try {
    if (scroll && tile) rec.renderedIndex = Array.prototype.indexOf.call(scroll.querySelectorAll('.lib-item'), tile);
    act();
  } finally {
    const t = (path === 'edit' ? App.editTargets() : App.operationTargets()) || [];
    const l = t.length === 1 ? t[0] : null;
    rec.committedId = l ? (l.symbolKey || l.patternKey || l.kind || null) : null;
    App.libClickLog.push(rec);
    if (App.libClickLog.length > 400) App.libClickLog.shift();
    console.log('[lib-click] ' + JSON.stringify(rec));
  }
  return rec;
};

App.buildLibraryPanel = function () {
  const scroll = $('#libScroll');
  App.libThumbEpoch = (App.libThumbEpoch || 0) + 1;
  const thumbEpoch = App.libThumbEpoch;
  if (App.libThumbObserver) App.libThumbObserver.disconnect();
  if (App.libThumbPumpTimer) clearTimeout(App.libThumbPumpTimer);
  App.libThumbPumpTimer = null;
  scroll.innerHTML = '';
  const cats = App.categories.slice();
  if (!App.LIB_HIDE_PATTERN_GROUP) cats.push({ id: 'pattern', key: 'lib.cat.pattern', items: App.patterns, isPattern: true });
  const catLabel = id => { const c = cats.find(x => x.id === id); return App.i18n.t(c && c.key ? c.key : String(id)); };

  const filterBar = document.createElement('div');
  filterBar.className = 'lib-filter-bar';
  const filterBtn = document.createElement('div');
  filterBtn.className = 'lib-filter-btn';
  filterBtn.textContent = App.libFilter ? catLabel(App.libFilter) : App.i18n.t('lib.cat.all');
  const filterPanel = document.createElement('div');
  filterPanel.className = 'lib-filter-panel';

  const addFilterItem = (label, value) => {
    const item = document.createElement('div');
    item.className = 'lib-filter-item' + ((App.libFilter || null) === value ? ' active' : '');
    item.textContent = label;
    item.addEventListener('click', e => {
      e.stopPropagation();
      App.libFilter = value;
      filterBtn.textContent = label;
      filterPanel.classList.remove('open');
      App.buildLibraryPanel();    
    });
    filterPanel.appendChild(item);
  };
  addFilterItem(App.i18n.t('lib.cat.all'), null);
  cats.forEach(cat => addFilterItem(App.i18n.t(cat.key || cat.id), cat.id));

  filterBtn.addEventListener('click', e => {
    e.stopPropagation();
    filterPanel.classList.toggle('open');
  });
  scroll.addEventListener('click', () => filterPanel.classList.remove('open'));

  filterBar.appendChild(filterBtn);
  filterBar.appendChild(filterPanel);
  scroll.appendChild(filterBar);

  const thumbQueue = [];
  let thumbActive = 0;
  const scheduleThumbPump = delay => {
    if (thumbEpoch !== App.libThumbEpoch || App.libThumbPumpTimer) return;
    App.libThumbPumpTimer = setTimeout(() => {
      App.libThumbPumpTimer = null;
      pumpThumbs();
    }, delay == null ? 16 : delay);
  };
  const pumpThumbs = () => {
    if (thumbEpoch !== App.libThumbEpoch) return;
    if (App.Home && App.Home.shown) return;
    if (App.renderInteractionBusy && App.renderInteractionBusy()) {
      scheduleThumbPump(100);
      return;
    }
    while (thumbActive < 2 && thumbQueue.length) {
      const job = thumbQueue.shift();
      if (!job.tile.isConnected) {
        App.finishThumbLoading(job.tile, job.loader);
        continue;
      }
      thumbActive++;
      const source = job.kind === 'symbol'
        ? (() => { const sym = App.symbolMap.get(job.key); return sym ? App.libThumb(sym) : Promise.resolve(''); })()
        : Promise.resolve(App.patternThumb(job.key, null));
      source.then(url => App.showThumbImage(job.tile, job.img, url, job.loader)).catch(e => {
        console.warn('[library] 素材缩略图生成失败', job.key, String(e && e.message || e).slice(0, 160));
      }).finally(() => {
        App.finishThumbLoading(job.tile, job.loader);
        thumbActive--;
        scheduleThumbPump(16);
      });
    }
  };
  App.kickLibraryThumbQueue = () => scheduleThumbPump(0);

  const observer = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      const tile = en.target;
      observer.unobserve(tile);
      const kind = tile.getAttribute('data-kind');
      const key = tile.getAttribute('data-key');
      const img = $('img', tile);
      const loader = App.startThumbLoading(tile);
      thumbQueue.push({ tile, img, loader, kind, key });
      scheduleThumbPump(0);
    });
  }, { root: scroll, rootMargin: '300px' });
  App.libThumbObserver = observer;

  const showCats = App.libFilter ? cats.filter(c => c.id === App.libFilter) : cats;
  showCats.forEach(cat => {
    const header = document.createElement('div');
    header.className = 'lib-cat';
    header.textContent = App.i18n.t(cat.key || cat.id);
    scroll.appendChild(header);
    const grid = document.createElement('div');
    grid.className = 'lib-grid';
    cat.items.forEach(item => {
      const isPat = !!cat.isPattern;
      const tile = document.createElement('div');
      tile.className = 'lib-item';
      tile.setAttribute('draggable', 'true');
      tile.setAttribute('data-kind', isPat ? 'pattern' : 'symbol');
      tile.setAttribute('data-key', item.key);
      tile.title = isPat ? item.name : item.label;
      const img = document.createElement('img');
      img.draggable = false;
      tile.appendChild(img);
      tile.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', 'SVE:' + JSON.stringify({ kind: isPat ? 'pattern' : 'symbol', key: item.key }));
        e.dataTransfer.effectAllowed = 'copy';
      });
      tile.addEventListener('click', () => {
        if (App.state.edit) {
          App.libClickTrace(cat, item, tile, 'edit', () =>
            App.replacePatternInEdit({ kind: isPat ? 'pattern' : 'symbol', key: item.key }));
          return;
        }
        if (App.state.replacing) {
          App.libClickTrace(cat, item, tile, 'replace', () =>
            App.replaceSelectedPattern({ kind: isPat ? 'pattern' : 'symbol', key: item.key }));
        }
      });
      grid.appendChild(tile);
      const pre = (isPat ? '' : App.libThumbPreUrl({ key: item.key }));
      if (pre) {
        img.loading = 'lazy';
        img.decoding = 'async';
        img.onerror = () => {
          img.onerror = null;
          tile.classList.remove('sve-thumb-pre');
          img.removeAttribute('src');
          observer.observe(tile);
        };
        img.src = pre;
        tile.classList.add('sve-thumb-pre');
      } else {
        observer.observe(tile);
      }
    });
    scroll.appendChild(grid);
  });
};

App.refreshLibraryPanel = function () {
  if (App.state && App.state.loaded) App.buildLibraryPanel();
};

App.findSymbol = key => App.symbolMap.get(key);

App.applyPatternToLayer = function (layer, spec) {
  if (!layer || !spec) return false;
  if (spec.kind === 'symbol') {
    const sym = App.symbolMap.get(spec.key);
    if (!sym) return false;
    layer.kind = 'symbol';
    layer.symbolKey = spec.key;
    layer.name = sym.label;
    layer.dataUri = App.symbolUri(sym);
    App.normalizeSymbolSize(layer);
  } else {
    const pat = App.patterns.find(p => p.key === spec.key);
    if (!pat) return false;
    layer.kind = 'pattern';
    layer.patternKey = spec.key;
    layer.name = pat.name;
    layer.dataUri = null;
  }
  layer.thumbDirty = true;
  layer.thumbCache = null;
  App.rebuildLayerContent(layer);
  if (App.dropEditStaticItem) App.dropEditStaticItem(layer);
  if (App.contentChanged) App.contentChanged();
  App.refreshPanel();
  return true;
};

App.samePattern = function (layer, spec) {
  if (!layer || !spec) return false;
  if (spec.kind === 'symbol') return layer.kind === 'symbol' && layer.symbolKey === spec.key;
  return layer.kind === 'pattern' && layer.patternKey === spec.key;
};

App.replacePatternInEdit = function (spec) {
  if (!App.state.edit || !spec) return false;
  const t = App.editTargets();
  if (t.length !== 1) return false;
  const layer = t[0];
  if (!layer || layer.kind === 'bg' || layer.kind === 'merged') return false;
  if (spec.kind === 'symbol' && !App.symbolMap.get(spec.key)) return false;
  if (spec.kind === 'pattern' && !App.patterns.find(p => p.key === spec.key)) return false;
  if (App.samePattern(layer, spec)) return false;
  if (App.editHist) {
    App.editHist.endGesture();       
    App.editHist.checkpoint();
    App.editHist.endGesture();
  }
  const ok = App.applyPatternToLayer(layer, spec);
  if (ok && App.requestFlashRefresh) App.requestFlashRefresh();
  return ok;
};

App.replaceSelectedPattern = function (spec) {
  const sel = App.operationTargets();
  if (sel.length !== 1) { showToast(App.i18n.t('toast.lib.oneLayerOnly')); return; }
  const layer = sel[0];
  if (layer.kind === 'merged') { showToast(App.i18n.t('toast.lib.mergedNoReplace')); return; }
  App.history.markDiscrete();
  if (!App.applyPatternToLayer(layer, spec)) return;
  App.setReplacing(false);
  if (App.requestFlashRefresh) App.requestFlashRefresh();
};

App.setReplacing = function (on) {
  App.state.replacing = on;
  $('#libScroll').classList.toggle('replace-mode', on);
  if (on) showToast(App.i18n.t('toast.lib.replaceHint'));
};
