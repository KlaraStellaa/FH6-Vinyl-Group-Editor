'use strict';
/* 颜色面板：HEX / 色盘 / HSB 三滑条（竖直分布，H 上限 100，S/B 上限 100）/ 应用 / 历史 / 收藏 / 取色器
   H 控件（滑条/数值框）显示 0-100，内部色相仍按 0-360 计算（UI 值 ×3.6）；
   需求：拖动滑条/色盘/HEX/取色只做“预览渲染”（不写入图层数据），点「应用」才真正写入颜色；
   预览在切页签、白框移动、编辑中做其他操作时立即撤销恢复原色 */
App.initColorPanel = function () {
  App.cp = { h: 0, s: 0, v: 100, hex: '#ffffff', suppress: false, syncing: false };
  App.previewColor = null;
  App.previewRestore = [];
  App.histColors = [];
  App.wheelCanvas = $('#colorWheel');
  App.wheelCtx = App.wheelCanvas.getContext('2d');
  /* 空画布阶段先建好滤镜定义，避免第一次拖色时向含数千节点的 SVG 临时插入 defs 子树。 */
  if (App.ensurePreviewColorFilter) App.ensurePreviewColorFilter();
  App.loadFavs();
  App.setPanelColor(App.state.lastColor, false);

  /* HEX 输入 */
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

  /* H/S/B 数值输入（手打）：H 控件为 0-100，内部色相 ×3.6 */
  const syncFromNums = () => {
    if (App.cp.suppress) return;
    const h = clamp(parseFloat($('#hInput').value) || 0, 0, 100) * 3.6;
    const s = clamp(parseFloat($('#sInput').value) || 0, 0, 100);
    const v = clamp(parseFloat($('#bInput').value) || 0, 0, 100);
    App.setPanelHSV(h, s, v, false);
  };
  ['hInput', 'sInput', 'bInput'].forEach(id => {
    $('#' + id).addEventListener('input', syncFromNums);
    $('#' + id).addEventListener('keydown', e => e.stopPropagation());
  });

  /* H/S/B 进度条拖动：H 控件为 0-100，内部色相 ×3.6 */
  const syncFromRanges = () => {
    if (App.cp.suppress) return;
    const h = clamp(parseFloat($('#hRange').value) || 0, 0, 100) * 3.6;
    const s = clamp(parseFloat($('#sRange').value) || 0, 0, 100);
    const v = clamp(parseFloat($('#bRange').value) || 0, 0, 100);
    App.setPanelHSV(h, s, v, false);
  };
  ['hRange', 'sRange', 'bRange'].forEach(id => {
    $('#' + id).addEventListener('input', syncFromRanges);
    /* 悬停在滑条上滚轮微调（H 步进 1 = 内部 3.6°） */
    $('#' + id).addEventListener('wheel', e => {
      e.preventDefault();
      const step = (id === 'hRange' ? 1 : 1) * (e.deltaY > 0 ? -1 : 1);
      const cur = parseFloat($('#' + id).value) || 0;
      const max = 100;
      $('#' + id).value = clamp(cur + step, 0, max);
      syncFromRanges();
    }, { passive: false });
  });

  /* 色盘（H=角度，S=半径，B 用下方进度条） */
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

  /* 取色器：图层取色 / 背景图片取色（取到的颜色只预览，点「应用」才写入） */
  $('#btnEyeLayer').addEventListener('click', () => App.eyedropperToggle('layer'));
  $('#btnEyeBg').addEventListener('click', () => App.eyedropperToggle('bg'));

  /* 应用：把当前面板颜色真正写入当前图层 */
  $('#btnApplyColor').addEventListener('click', () => App.commitColor(App.cp.hex));

  /* 收藏 */
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
  /* 指示圈 */
  const ang = App.cp.h * Math.PI / 180;
  const rr = App.cp.s / 100 * (R - 1);
  const ix = R + Math.cos(ang) * rr, iy = R + Math.sin(ang) * rr;
  cx.strokeStyle = '#ffffff'; cx.lineWidth = 2;
  cx.beginPath(); cx.arc(ix, iy, 5, 0, Math.PI * 2); cx.stroke();
  cx.strokeStyle = '#000000'; cx.lineWidth = 1;
  cx.beginPath(); cx.arc(ix, iy, 6.5, 0, Math.PI * 2); cx.stroke();
};

/* 面板状态直接以 HSV 为准（拖动滑条不再经过 HEX 往返，避免色相量化回跳） */
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
    $('#hInput').value = Math.round(h / 3.6); // H 控件 0-100
    $('#sInput').value = Math.round(s);
    $('#bInput').value = Math.round(v);
    $('#hRange').value = Math.round(h / 3.6); // H 控件 0-100
    $('#sRange').value = Math.round(s);
    $('#bRange').value = Math.round(v);
  } finally {
    App.cp.suppress = false;
  }
  $('#colorSwatch').style.background = hex;
  App.drawWheel();
  /* 面板同步（显示某图层现有颜色）不触发预览/应用 */
  if (App.cp.syncing) return;
  if (apply) App.commitColor(hex);
  else if (preview !== false) App.applyColorPreview(hex);
};

/* 从 HEX 设置（输入框/收藏/取色器/历史）。
   preview=false 时只更新面板颜色、不做图层视觉预览（取色器悬停取色用） */
App.setPanelColor = function (hex, apply, preview) {
  const rgb = hexToRgb(hex);
  if (!rgb) return;
  const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  let h = hsv.h;
  /* 用户在 360 时选中纯红（HEX 往返为 0）：保持 360 不回跳 */
  if (h === 0 && App.cp.h >= 359) h = 360;
  App.setPanelHSV(h, hsv.s, hsv.v, apply, preview);
};

/* 提交颜色：直接写数据 —— 不再「先恢复原色、再异步换剪影图」。
   2026-09-12 用户报障：「调整颜色未应用时颜色在图层上的预渲染会与原本图层渲染冲突，导致一直来回
   切换或预渲染失效，并且应用颜色后要等渲染刷新才生效」。旧实现每一步预览都先 resetPreviewVisual
   把原色恢复上屏（=来回切换），symbol 换色又是每子层一次异步重渲染（126 子层的分组→乱序、迟迟不
   落地=预渲染失效）；提交时先 cancelColorPreview（原色回屏）再 setLayerColor（异步换图）→ 新色要
   等一次异步渲染才上屏。现在：预览用同步滤镜（见 previewColorFilter），提交后滤镜保持在位，等剪影
   PNG 换好再撤 —— 全程零回跳。 */
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
  App.previewBitmapYield(items);         /* 提交期间同样让位（否则新色被旧位图盖住 = "等刷新才生效"） */
  App.paintColorImmediate(items, hex);   /* 先同步上色（滤镜），保证"应用即生效" */
  App.applyColorToTargets(hex, items);
  App.recordHistColor(hex);
  App.settleColorPreview(items);
  try { App.log('info', '应用颜色', { hex, targets: items.length }); } catch (e) { /* ignore */ }
};

/* ---------- 预览/提交期间的「位图让位」 ----------
   2026-09-12 用户报障：「ceshi这个文件没有颜色预渲染是什么问题」。实测根因：该工作副本 348 个 symbol
   叶子 ≥ autoStatic 阈值 300 → 视口位图接管显示（矢量层 visibility:hidden，屏幕上放的是按【数据色】
   烘出来的位图）；预览改的是被隐藏的矢量 → 全屏只有 0.02% 像素变化 = 等于看不见。
   所以预览与提交期间必须让位：①释放视口位图（并用 App._colorYield 挡住期间重新接管）；
   ②被分组代理位图接管的分组临时回矢量（结束再排队重烘）。显示口径与阈值一律不动。 */
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
  if (wasYield && App.autoStaticMaybe) App.autoStaticMaybe();   /* 重新评估接管（大文件帧率保护不丢） */
};

/* ---------- 预览恢复记录（统一入口） ----------
   连续预览时**不能跑恢复项**（跑了就会把图层原色闪回一帧 —— 用户报障的「一直来回切换」）。
   所以恢复项按 key 只登记一次（保留「预览开始前的原始值」），由 cancel/settle 统一执行并释放。
   前一轮预览过、这一轮不再预览的目标，由 applyColorPreview 单独挑出来立刻恢复。 */
App.claimPreviewRestore = function (key, fn, el) {
  const set = App.previewRestoreKeys || (App.previewRestoreKeys = new Set());
  if (set.has(key)) return;
  set.add(key);
  if (!Array.isArray(App.previewRestore)) App.previewRestore = [];
  App.previewRestore.push({ k: String(key).split(':')[0], key: key, el: el || null, fn: () => { set.delete(key); fn(); } });
};
/* 执行并释放恢复项；onlyKind 给定时只执行该类的，其它直接作废（提交路径：图案/导入的新色已经
   同步写进 fill，跑它们的恢复会把新色改回旧色）。 */
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

/* 同步把目标的 symbol 染成指定色（预览滤镜），并登记可撤销项。
   提交色可能与当前预览色不同（点色卡/直接提交），所以提交路径也要走一次。 */
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

/* 提交收尾：等目标（含合并分组的子层）的彩色剪影就绪后，只撤掉「预览滤镜」类恢复项；
   图案/导入类的恢复项直接作废（提交已经把新色同步写进它们的 fill）。
   兜底 1500ms：渲染失败/缺图时不至于一直挂着滤镜。 */
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

/* ---------- 颜色预览（未点「应用」不写入图层数据） ---------- */
/* 预览上色：symbol 用【同步滤镜】——feColorMatrix 把 RGB 强制成目标色、alpha 原样保留，
   与 tintPixels 的语义等价，但不需要解码/着色/toDataURL 的异步链。
   2026-09-12 根因修复（用户报障「预渲染与原本图层渲染冲突，一直来回切换或预渲染失效」）：
   旧实现把每个 symbol 子层的 imgEl.href 换成异步渲染出的剪影 PNG，并且每次预览都先
   resetPreviewVisual 把原色恢复上屏 → 拖动时视觉在「原色 ↔ 新色」之间来回跳；126 个子层的
   分组还会各写各的、后完成的乱序覆盖。改成一层 style.filter 后：同步、无异步、无回跳。
   color-interpolation-filters 必须显式 sRGB，否则按 linearRGB 解释会让颜色偏掉。 */
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
/* 返回可赋给 style.filter 的 url(#id)（同一个 def 复用，改 values 即整体换色） */
App.previewColorFilter = function (hex) {
  const m = App.ensurePreviewColorFilter();
  if (!m) return '';
  m.setAttribute('values', App.previewColorMatrix(hex));
  return 'url(#' + App.previewColorFilterId + ')';
};

/* 大文件“全部换成同一种颜色”的窄路径：视口缓存/全部矢量共用一个根滤镜，避免每次
   拖动都恢复 2000 层 visibility 并逐层写 style.filter。
   支持两种可证明等价的结构：①全部顶层均为纯 symbol 且已全选；②画布只有一个超大
   merged，且其所有叶子均为非蒙版 symbol。第二种正是图层栏显示“×2000”的工作进程；
   小分组、蒙版、导入、图案仍走原路径，避免改变它们各自的显示语义。 */
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
  /* 稳态大文件只给屏幕上实际显示的那张合成位图加滤镜；给 layersRoot 加滤镜会让
     Chromium 同时失效它下面数千个隐藏节点的样式与合成状态，首个颜色事件仍会顿一下。 */
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

/* 模型一次写完；昂贵的彩色剪影只按图源去重生成，并把 2000 个 href 分片落到隐藏矢量。
   根滤镜一直覆盖旧位图，直到同一 contentRevision 的新位图完成双缓冲切换。 */
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
  /* 连续预览：**不跑**上一次的恢复项（跑了就会把原色闪回一帧 = 用户报障的「一直来回切换」）。
     目标集合在预览期间稳定（选中/编辑目标变化都会先走 cancelColorPreview），所以只需要把
     「上一轮预览过、这一轮不再预览的目标」单独恢复掉。 */
  App.previewColor = null;
  const items = App.state.edit ? App.editTargets() : App.operationTargets();
  if (!items.length) { App.resetPreviewVisual(); return; }
  if (App.wholeSymbolColorTargets(items)) {
    App.beginWholeSymbolColorVisual(items, hex);
    return;
  }
  App.previewBitmapYield(items);   /* 位图让位：否则大文件下预览改的是被隐藏的矢量，等于看不见 */
  const liveEls = new Set();
  const previewOne = l => {
    if (!l || l.isMask) return;
    /* import 位图化：预览前恢复矢量显示（位图看不到颜色变化） */
    if (App.updateImpDisplay) App.updateImpDisplay(l);
    if (l.kind === 'symbol' && l.el && !l.isMask) {
      /* 同步滤镜上色（不再异步重渲染剪影图）：一次 style 写入，立刻上屏 */
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
    /* 合并分组：递归预览全部子层（拖动色盘/HSB 时整体实时变色，撤销时一并恢复） */
    const walk = l => {
      if (l.kind === 'merged') (l.children || []).forEach(walk);
      else previewOne(l);
    };
    walk(it);
  });
  /* 不再属于本轮预览的目标：立刻恢复原样（目标集合变化时的兜底，不做它会留下"卡住"的预览色） */
  const recs = Array.isArray(App.previewRestore) ? App.previewRestore : [];
  const stale = recs.filter(rec => rec && rec.el && !liveEls.has(rec.el));
  if (stale.length) {
    App.previewRestore = recs.filter(rec => stale.indexOf(rec) < 0);
    stale.forEach(rec => { try { if (App.previewRestoreKeys) App.previewRestoreKeys.delete(rec.key); rec.fn(); } catch (e) { /* ignore */ } });
  }
  App.previewColor = hex;
  /* 颜色预览不碰闪动覆盖层：overlay 形状/位置只随图层几何变化，与颜色无关。
     刷新（requestFlashRefresh 默认会重播一次动画）会导致拖动色相环/HSB 时
     闪烁动画每帧被重置、闪断——颜色变化一律不影响闪烁动画 */
};

/* 静默还原预览视觉（不重置面板颜色）；同样不刷新闪动覆盖层（颜色与闪烁无关） */
App.resetPreviewVisual = function () {
  App.previewColor = null;
  App.clearWholeSymbolColorVisual();
  App.releasePreviewRestores();
  App.previewBitmapRestore();   /* 预览结束：让被释放的位图重新评估接管 */
};

/* 撤销未应用的预览：恢复图层原样；编辑模式下把面板同步回该图层真实颜色 */
App.cancelColorPreview = function () {
  const had = App.previewRestore && App.previewRestore.length > 0;
  App.resetPreviewVisual();
  if (had && App.state.edit) {
    /* 编辑模式：面板回到当前编辑图层的真实颜色 */
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
    /* 编辑模式内改色：计入编辑会话内的独立撤回点（连续拖动合并为一次手势） */
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

/* 颜色面板同步：白框选中单个普通图层时，色盘/HSB/颜色编号与该图案当前颜色一致；
   合并分组不同步（面板保持现状）；编辑模式中不同步 */
App.syncColorPanelToTargets = function () {
  if (App.state.edit) return;
  /* 白框移动/选中变化：撤销未应用的预览，面板显示新图层真实颜色 */
  App.cancelColorPreview();
  const items = App.operationTargets();
  if (items.length !== 1 || items[0].kind === 'merged' || items[0].kind === 'bg') return;
  const hex = (items[0].color && hexToRgb(items[0].color)) ? items[0].color : '#ffffff';
  App.cp.syncing = true;
  try { App.setPanelColor(hex, false); } finally { App.cp.syncing = false; }
};

/* ---------- 历史使用过的颜色（仅内存，关闭软件后清空；最多两行 = 16 个） ---------- */
App.recordHistColor = function (hex) {
  hex = String(hex || '').toLowerCase();
  if (!hexToRgb(hex)) return;
  App.histColors = App.histColors.filter(c => c !== hex);
  App.histColors.unshift(hex);
  if (App.histColors.length > 16) App.histColors.length = 16;
  App.renderHistGrid();
};
/* 应用颜色但不写入/重排历史（历史色/收藏色点击用：直接应用，不改历史记录） */
App.applyColorNoHist = function (hex) {
  App.setPanelColor(hex, false, false); // 面板显示该色（不预览）
  App.cancelColorPreview();
  App.applyColorToTargets(hex);          // 应用到当前目标
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
    /* 直接点击历史颜色：立即应用，但不更新历史颜色的使用顺序 */
    sw.addEventListener('click', () => App.applyColorNoHist(hex));
    /* 删除该历史颜色（与收藏颜色一致的 × 删除按钮） */
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

/* ---------- 取色器：图层取色 / 背景图片取色 ---------- */
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
  /* 退出旧模式并恢复现场（显示/透明度临时值全部还原） */
  if (App.state.eyeMode === 'bg') {
    if (App.eyeLayersDisplay !== undefined) {
      /* 恢复显示要与"隐藏图层"按钮状态一致：按钮隐藏中则保持隐藏，
         否则取色器激活期间切换按钮会导致退出后显示状态错乱（按钮说隐藏、图层却显示） */
      App.layersRoot.style.display = App.state.layersHidden ? 'none' : (App.eyeLayersDisplay || '');
      App.eyeLayersDisplay = undefined;
    }
    if (App.eyeBgDisplay !== undefined) {
      /* 恢复背景显示要与"隐藏背景"按钮状态一致（取色器激活期间切换按钮会错乱） */
      App.bgG.style.display = App.state.bg.hidden ? 'none' : (App.eyeBgDisplay || '');
      App.eyeBgDisplay = undefined;
    }
    if (App.eyeBgDispOpacity !== undefined) {
      /* 取色器激活期间用户拖过透明度滑块：保留新值（不被激活前快照覆盖） */
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
  App.eyeOpacityUserChanged = false; // 新会话：重置"用户拖动过透明度"标志
  App.state.eyeMode = mode;
  /* 编辑模式静态化：取色器激活时恢复矢量（取色需要真实图层），退出取色后重新静态化。
     必须放在 eyeMode 赋值之后：beginEditStatic 检查 eyeMode，若在赋值前调用
     会看到旧值（仍为 'layer'）而误判"取色器激活中"提前返回 */
  if (mode) {
    if (App.endEditStatic && App.state.edit) App.endEditStatic();
  } else if (App.state.edit) {
    if (App.beginEditStatic) App.beginEditStatic();
  }
  App.svg.style.cursor = mode ? 'crosshair' : '';
  $('#btnEyeLayer').classList.toggle('active', mode === 'layer');
  $('#btnEyeBg').classList.toggle('active', mode === 'bg');
  if (mode === 'bg') {
    /* 隐藏所有图案，保留完整背景显示；背景显示透明度临时回到不透明（看到真实颜色） */
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
    /* 图层显示透明度临时回到不透明（看到真实颜色） */
    App.eyeLayersDispOpacity = App.state.layersDisplayOpacity;
    App.state.layersDisplayOpacity = 1;
    App.applyLayersDisplayOpacity();
    App.updateLayersDisplaySlider();

  }
};
/* 图层实际使用的颜色（蒙版图层不参与取色） */
App.colorOfLayer = function (layer) {
  if (!layer || layer.isMask) return null;
  if (layer.kind === 'symbol' || layer.kind === 'pattern' || layer.kind === 'import') return layer.color || null;
  return null;
};
/* 取色器取色：合并分组返回被点击位置子图层的颜色（大分组代理从烘焙位图像素取色） */
App.eyePickColor = function (layer, clientX, clientY) {
  if (!layer) return null;
  if (layer.kind === 'merged') {
    /* 大分组渲染代理：子层已隐藏，从烘焙位图取像素色 */
    if (App.proxySampleColor && App._proxyBake && App._proxyBake.has(layer.id)) {
      const ps = App.proxySampleColor(layer, clientX, clientY);
      if (ps) return ps;
    }
    /* 小分组：从最上层子图层开始找第一个命中的可见子层，取该子层颜色（嵌套分组递归） */
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
    /* 只在背景图片内预览，图片外不做任何反应 */
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
    /* 图片外的背景板：不做任何反应，继续取色 */
    const hex = App.sampleBackgroundColor(e.clientX, e.clientY);
    if (!hex) return;
    /* 点击取色：立即应用到当前目标，无需再点「应用」 */
    App.setPanelColor(hex, true);
    App.setEyedropper(null);
  } else {
    /* 背景（画布底色/背景图片）：不做任何反应，继续取色 */
    const layer = App.hitLayerPaintedSync(e.clientX, e.clientY);
    const hex = App.eyePickColor(layer, e.clientX, e.clientY);
    if (!hex) return;
    /* 点击取色：立即应用到当前目标，无需再点「应用」 */
    App.setPanelColor(hex, true);
    App.setEyedropper(null);
  }
};

/* ---------- 收藏颜色 ---------- */
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
    /* 直接点击收藏颜色：立即应用，但不写入历史使用过的颜色 */
    sw.addEventListener('click', () => App.applyColorNoHist(hex));
    const del = document.createElement('span');
    del.className = 'fav-del';
    del.textContent = '×';
    del.addEventListener('click', e => { e.stopPropagation(); App.removeFavorite(hex); });
    sw.appendChild(del);
    grid.appendChild(sw);
  });
};
