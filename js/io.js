'use strict';
/* 导出 / 打开 / 导入 SVG（保存=Forza 兼容格式，另存备份=编辑器自有格式） */
/* 对话框关闭后让触发按钮失焦：否则按钮保留焦点，用户按 Enter 会再次触发
   （"打开 SVG 文件"对话框关闭后按 Enter 又弹出 = 焦点残留 bug） */
function blurActiveButton() {
  const el = document.activeElement;
  if (el && el.blur && (el.tagName === 'BUTTON' || el.tagName === 'INPUT')) el.blur();
}
App.initIO = function () {
  $('#btnOpen').addEventListener('click', App.openSVG);
  /* 按钮鼠标点击后失焦:消除残留蓝框(:focus-visible)与 Enter 误触发;
     键盘 Tab 聚焦不受影响(仅鼠标点击路径 blur) */
  document.addEventListener('click', e => {
    const b = e.target && e.target.closest && e.target.closest('button');
    if (b) setTimeout(() => b.blur(), 0);
  });
  /* 拖入 .svg 文件:读取文本 → 导入当前标签(保留原文件名) */
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
      App.importSvgIntoCurrent(String(rd.result || ''), f.name.replace(/\.svg$/i, '') || '未命名');
      App.recordSvgSource(f.name);
      if (App.Tabs && App.Tabs.clearDirty) App.Tabs.clearDirty();
    };
    rd.onerror = () => showToast(App.i18n.t('toast.io.readFileFail'));
    rd.readAsText(f);
  });
  $('#btnSave').addEventListener('click', function () { App.exportForzaSVG(); });
  $('#btnSaveWork').addEventListener('click', function () { App.saveWorkCopy(); });
  /* 「打开工作副本」按键已移至首页（主页最近工作副本列表打开） */
  const btnOpenWorkEl = document.getElementById('btnOpenWork');
  if (btnOpenWorkEl) btnOpenWorkEl.addEventListener('click', App.openWorkCopy);
  $('#btnHistAnchor').addEventListener('click', App.openHistAnchor);
  /* 日志面板：查看保存状态 / 复制最近日志 / 保存日志到文件并打开文件夹 */
  /* 日志入口已整合进「设置」面板（顶栏的日志键已移除）：点它先收起设置再展开日志窗 */
  const logBtnInSettings = document.getElementById('btnLogInSettings');
  if (logBtnInSettings) logBtnInSettings.addEventListener('click', function () {
    if (App.settings) App.settings.toggle();
    App.toggleLogPanel();
  });
  $('#btnLogCopy').addEventListener('click', App.copyLog);
  $('#btnLogOpen').addEventListener('click', async () => {
    /* 日志默认只存内存（不点保存不写磁盘）：点保存 = 写文件 + 打开所在文件夹 */
    const r = await window.sveApi.logSave();
    if (!r || !r.ok) { showToast(App.i18n.tf('toast.io.logSaveFail', { v: ((r && r.error) || App.i18n.t('toast.unknownError')) })); return; }
    showToast(App.i18n.tf('toast.io.logSaved', { n: r.lines, v: r.path }));
    const o = await window.sveApi.logOpen();
    if (!o || !o.ok) showToast(App.i18n.t('toast.io.logOpenFail'));
  });
  $('#btnLogClose').addEventListener('click', () => $('#logPanel').classList.add('hidden'));
  /* 打开背景图片文件（顶栏右侧，与背景图片编辑按钮同组） */
  $('#btnOpenImage').addEventListener('click', App.openBgImageDialog);
  /* 2026-09-12 用户要求：「保存」按钮不再存进「已保存的彩绘」，改走正常保存 SVG 流程
     （弹重命名输入框 → 写入软件「SVG图像」目录，与顶栏「保存 SVG」同一条路径） */
  $('#btnSavePalette').addEventListener('click', function () {
    /* 用户要求（2026-09-12）：图层栏的「保存」= 只导出【白框内那一层】；
       白框停在「+」栏（没有对应图层）时退化为整份导出，不让按钮变成死的 */
    const wb = App.whiteBoxLayer ? App.whiteBoxLayer() : null;
    App.exportForzaSVG(wb ? [wb] : undefined);
  });
  /* 历史工作锚点：每 10 分钟自动保存（画布上有内容时才保存） */
  App.startHistAnchors();
};

/* 日志面板：显示路径并展开/收起 */
App.toggleLogPanel = async function () {
  const panel = $('#logPanel');
  const showing = !panel.classList.contains('hidden');
  if (showing) { panel.classList.add('hidden'); return; }
  await App.refreshLogPath();
  panel.classList.remove('hidden');
};
/* 日志面板的路径文案（单独抽出：切语言时由重刷器再调一次） */
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
/* 复制最近日志到剪贴板（直接粘贴发送即可排查） */
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

/* 打开图片文件作为背景（按钮专用，拖拽失败时的替代路径） */
App.openBgImageDialog = async function () {
  const r = await window.sveApi.openImageDialog();
  blurActiveButton();
  if (r.canceled) {
    if (r.error) showToast(App.i18n.tf('toast.io.openImageFail', { v: r.error }));
    return;
  }
  App.setBackgroundImage(r.dataUrl);
};

/* 记录当前文档的 SVG 源文件名(打开/拖入的文件;保存时作为默认名,覆写同名文件) */
App.recordSvgSource = function (name) {
  const nm = String(name || '');
  if (App.Tabs && App.Tabs.current) App.Tabs.current.svgSource = nm || null;
  else App.currentSvgSource = nm || null;
};

/* 导出 Forza 兼容 SVG（可被 Inkscape2Forza 识别并注入 FH6 存档）。
   保存流程:弹重命名输入框(预填默认名=源文件名或 Forza图案-时间戳)
   → 确定:存入 <exe目录>\SVG图像\ (同名=覆写);取消:不保存 */
App.exportForzaSVG = async function (layersOverride) {
  /* layersOverride：可选，只导出这些图层（图层栏「保存」= 只导白框那一层）；不传 = 整份文档 */
  const __t0 = performance.now();
  const sourceDoc = App.Tabs && App.Tabs.current ? App.Tabs.current : null;
  const sourceDocId = sourceDoc ? sourceDoc.id : null;
  const sourceRevision = sourceDoc ? (sourceDoc.contentRevision || 0) : 0;
  const fullDocumentSave = layersOverride === undefined || layersOverride === null;
  const built = App.buildForzaExportString(false, layersOverride);
  blurActiveButton();
  if (!built) return;
  const srcName = sourceDoc ? (sourceDoc.svgSource || null) : (App.currentSvgSource || null);
  const defName = (srcName ? srcName : (built.name || 'Forza图案')).replace(/\.svg$/i, '') || 'Forza图案';
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
  /* 单层导出只是生成一个独立文件，不能改整份文档的来源、标签或脏状态。
     整文档保存也只归属发起保存的标签；等待期间切换标签不会误改新标签。 */
  if (fullDocumentSave) {
    if (sourceDoc && App.Tabs && App.Tabs.docs && App.Tabs.docs.includes(sourceDoc)) {
      sourceDoc.svgSource = final;
      if (App.Tabs.setDocLabel) App.Tabs.setDocLabel(sourceDocId, nm || '未命名');
      else { sourceDoc.label = nm || '未命名'; if (App.Tabs.renderBar) App.Tabs.renderBar(); }
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
  const r = await window.sveApi.saveSvgDialog(built.name, built.str);
  blurActiveButton();
  if (r.canceled) {
    if (r.error) showToast(App.i18n.tf('toast.io.saveFail', { v: r.error }));
    return;
  }
  showToast(App.i18n.tf('toast.io.backupExported', { v: r.path }));
};

/* 生成导出 SVG 字符串（与保存分离，便于测试） */
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
  /* 导出剔除渲染代理：代理位图是显示优化，不写入文件；
     恢复被代理隐藏的子层 visibility，子层数据照常导出 */
  $$('[data-proxy]', c).forEach(el => el.remove());
  $$('[data-layer]', c).forEach(el => el.removeAttribute('visibility'));
  /* 剔除编辑静态化背景位图（layersRoot 首子元素，旧快照不能进导出文件） */
  $$('.sve-edit-static', c).forEach(el => el.remove());
  /* import 位图化：矢量组被 display:none 隐藏，恢复显示再导出（否则内容空白）；
     位图元素剔除（blob 引用跨会话失效） */
  $$('[style]', c).forEach(el => { if (el.style && el.style.display === 'none') el.style.display = ''; });
  const layersRoot = c.querySelector('#layersRoot');
  if (layersRoot) {
    layersRoot.removeAttribute('id');
    /* 剔除显示样式（隐藏图层 display:none / 图案显示透明度 opacity）：
       导出 SVG 只保留每个图层自身的透明度，显示设置不影响导出 */
    layersRoot.removeAttribute('style');
  }
  c.removeAttribute('id');
  c.setAttribute('data-sve-version', '1');
  c.setAttribute('viewBox', bx + ' ' + by + ' ' + bw + ' ' + bh);
  c.setAttribute('width', bw);
  c.setAttribute('height', bh);
  /* 为每个图层写入模型信息 */
  $$('[data-layer]', c).forEach(el => {
    const id = parseInt(el.getAttribute('data-layer'), 10);
    const layer = App.findLayer(id);
    if (!layer) return;
    el.setAttribute('data-sve', JSON.stringify(App.serializeLayer(layer, false)));
  });
  const str = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(c);
  const d = new Date();
  const name = '图案拼贴-' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0') + '.svg';
  return { str, name };
};

App.openSVG = async function () {
  const r = await window.sveApi.openSvgDialog();
  blurActiveButton();
  if (r.canceled) {
    if (r.error) showToast(App.i18n.tf('toast.io.openFail', { v: r.error }));
    return;
  }
  App.importSvgIntoCurrent(r.content, (r.name || '').replace(/\.svg$/i, '') || '未命名');
  App.recordSvgSource(r.name); // 记住源文件名:保存时默认名=原名,同名覆写
  if (App.Tabs && App.Tabs.clearDirty) App.Tabs.clearDirty(); // 打开文件=干净状态(不算改动)
};

/* 生产模式：SVG 导入当前标签（无标签时先创建一个）；测试模式保持旧行为（直接导入当前文档） */
App.importSvgIntoCurrent = function (text, label) {
      /* 2026-09-12 用户要求：主页显示中点打开=新建标签页；画布中=注入当前标签 */
      if (App.Tabs && !App.Tabs.testMode && App.Home && App.Home.shown) { App.Tabs.prodNewSvg(text, label || '未命名', null); return; }
  if (App.Tabs && !App.Tabs.testMode) {
    if (!App.Tabs.docs.length) App.Tabs.addDoc({ silent: true, label: label || null });
    if (App.Home) App.Home.hide();
  }
  App.importSVGContent(text);
};

App.importSVGContent = function (text) {
  if (App.cancelColorPreview) App.cancelColorPreview();
  /* 取色器激活中导入：先退出（否则恢复/重建后 eyeMode 残留，图层被强制隐藏且按钮被禁） */
  if (App.state.eyeMode && App.setEyedropper) App.setEyedropper(null);
  if (App.invalidateEditStatic) App.invalidateEditStatic();
  App.perfCtx.lastOp = '导入SVG';
  const __t0 = performance.now();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.querySelector('parsererror')) { showToast(App.i18n.t('toast.io.badSvgFile')); return; }
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg') { showToast(App.i18n.t('toast.io.notSvg')); return; }
  App.history.markDiscrete();
  const n0 = App.state.layers.length;
  const hasForzaUse = $$('use', root).some(u =>
    App.FZA.useRe.test(u.getAttribute('href') || u.getAttributeNS(XLINK, 'href') || ''));
  /* 版本号优先：备份格式按版本走 importOwn，避免其内部 <use> 被误判为 Forza 文件 */
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
  /* 每次导入：把本次导入的全部图层整体平移到【当前显示画布的中心】（当前视野中心） */
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
  /* 每次导入：把本次导入的全部图层默认合并为 1 个分组（可随时拆分） */
  if (news.length > 1) {
    const merged = App.mergeLayers(news.map(l => l.id));
    if (merged) showToast(App.i18n.tf('toast.io.importedMerged', { n: news.length }));
  }
  /* 导入器内部在批量结束时先恢复显示；平移到视口中心/自动合并完成后，再以最终模型作废旧底图。 */
  if (news.length && App.contentChanged) App.contentChanged();
  /* 后台预解码符号位图：点击选中时的合成构建不再等待解码（大量图层不卡顿） */
  if (App.warmupSymbols) App.warmupSymbols();
  /* import 位图化：大量 import 图层时排队后台烘焙（显示为位图，渲染不卡） */
  if (App.refreshImpBitmaps) App.refreshImpBitmaps();
  /* 大分组渲染代理：导入产生的超大分组烘焙单图（全图显示不卡顿） */
  if (App.maybeBakeProxy) {
    App.state.layers.forEach(l => { if (l.kind === 'merged') App.maybeBakeProxy(l); });
      /* 初始渲染未完成先不显示（用户 2026-09-12 要求） */
      if (App.holdUntilRendered) App.holdUntilRendered();
    /* 兜底：嵌套分组先烘焙（子代理干扰/异步竞争）可能导致首次触发失败，
       延迟重试确保超大门组最终烘焙（否则数千子层裸渲染会卡顿） */
    setTimeout(() => {
      App.state.layers.forEach(l => {
        if (l.kind === 'merged' && App.countInLayer && App.countInLayer(l) > App.proxyThreshold &&
          App._proxyBake && !App._proxyBake.has(l.id)) App.maybeBakeProxy(l);
      });
    }, 1500);
  }
};

/* 导入本编辑器导出的文件（备份格式） */
App.importOwn = function (root) {
  let count = 0;
  /* 蒙版指示定义：优先采用文件内定义，其次本地素材 */
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
    l.el = el;
    el.setAttribute('data-layer', l.id);
    el.setAttribute('data-kind', l.kind);
    /* 修正 mask/pattern 引用 id */
    if (l.kind === 'symbol') {
      const mask = el.querySelector('mask');
      let img = el.querySelector('image');
      if (!img) {
        /* 新版备份：mask 内是 <use> 引用共享符号图片定义 */
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
      /* 优先按 symbolKey 从素材库取原始 JPEG（画布内存的是彩色剪影 PNG，直接复用会二次染色） */
      if (l.symbolKey && App.symbolMap.get(l.symbolKey)) {
        const sym = App.symbolMap.get(l.symbolKey);
        l.dataUri = App.symbolUri(sym);
        l.w = sym.w; l.h = sym.h;
      }
      if (l.dataUri) App.ensureSymbolImageDef(l); // 补建共享定义，供 mask 内 <use> 解析
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

/* 导入任意标准 SVG：每个顶层图形转为一个图层 */
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
      /* 归一化：把该形状在【文件坐标】里的自身原点挪到 (0,0)。
         buildLayerElement 对 import 层用的是 translate(-w/2 -h/2) —— 它假定 markup 从原点开始，
         而这里序列化的是文件坐标原样 markup，于是每个形状都会多带一个自己的文件原点：
         实测 4 方块夹具里圆的模型盒与画面差 225、蓝块差 150、黄块差 200（文件原点各是多少就差多少），
         连带缩略图裁错、选中高亮/几何判定错位。把偏移烘焙进 markup 后，模型中心 == 绘制中心，
         且相对排布与源文件一致（保存/快照走 innerEl.innerHTML，会自动带上这段归一化，不会二次偏移）。 */
      const _ox = r.left - hostRect.left, _oy = r.top - hostRect.top;
      if (_ox || _oy) {
        const _t = ch.getAttribute("transform");
        ch.setAttribute("transform", "translate(" + (-_ox) + " " + (-_oy) + ")" + (_t ? " " + _t : ""));
      }
      const markup = ch.outerHTML;
      ch.remove();
      const l = App.newLayer({
        kind: 'import', name: '导入·' + ch.nodeName.toLowerCase() + '-' + (count + 1),
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

/* 从图案库拖入画布创建图层 */
App.placePatternAt = function (spec, x, y) {
  if (App.cancelColorPreview) App.cancelColorPreview();
  App.history.markDiscrete();
  /* 初始大小按当前画布缩放调整：拖入时屏幕视觉大小恒定，
     画布放大多少倍、初始缩放就缩小多少倍（缩放 100% 时与原来完全一致） */
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
  /* 白框自动聚焦并选中新图层（需求：拖入新图案后自动选中）。
     批量创建（batching）时跳过逐层全量刷新（setSelection → 面板/闪动遍历 = O(n²)，
     2000 层循环调用卡 8 秒），只更新状态，结束时由调用方统一刷新。
     多选（含 Tab 遗留单选）状态下拖入：保持多选不被清空（白框移到新图层即可） */
  if (App.state.batching) {
    App.state.selected = new Set([l.id]);
    App.state.selectedByTab = false;
    App.lastWheelIdx = 0;
  } else if (App.state.selected.size > 1 || (App.state.selectedByTab && App.state.selected.size >= 1)) {
    App.lastWheelIdx = 0; // 面板最上层 = 刚拖入的图层
    App.scrollItemToTop(l);
    App.syncPanelSelectionClasses();
    App.updateSelToolbar();
    App.requestFlashRefresh();
  } else {
    App.state.selBarDismissed = false;
    App.state.selectedByTab = false;
    App.lastWheelIdx = 0; // 面板最上层 = 刚拖入的图层
    App.setSelection([l.id], { scrollPanel: true });
    /* 白框已随面板对齐到新图层：闪动覆盖层必须同步跟随白框，
       否则白框在新图层、闪烁动画还停留/残留在上一个图层 */
    if (App.requestFlashRefresh) App.requestFlashRefresh();
  }
  return l;
};

/* ---------- 已保存的彩绘：保存 / 应用 ---------- */

/* 把图层（单个/合并分组，或多个图层=多选保存）序列化为独立 SVG 文件内容：
   自包含视觉图形 + 每个图层的 data-sve 模型数据（文件可直接用「打开 SVG 文件」重新导入） */
App.buildPaletteExportString = function (layers) {
  const list = Array.isArray(layers) ? layers.filter(Boolean) : (layers ? [layers] : []);
  if (!list.length) return null;
  const defs = svgEl('defs');
  let seq = 0;
  const processOne = layer => {
    const g = layer.el.cloneNode(true);
    /* 剔除渲染代理并恢复被隐藏的子层（与整图导出一致） */
    $$('[data-proxy]', g).forEach(el => el.remove());
    $$('[data-layer]', g).forEach(el => el.removeAttribute('visibility'));
    /* 剔除编辑静态化背景位图（克隆自 layersRoot 首子元素） */
    $$('.sve-edit-static', g).forEach(el => el.remove());
    /* import 位图化：矢量组被 display:none 隐藏，恢复显示再导出（否则内容空白）；
       位图元素一并剔除（blob 引用跨会话失效） */
    $$('[style]', g).forEach(el => { if (el.style && el.style.display === 'none') el.style.display = ''; });
    /* 符号共享图片定义内联（蒙版图层的 <use> 引用 App.defs 里的 #sveImg…） */
    $$('use', g).forEach(u => {
      const href = u.getAttribute('href') || u.getAttributeNS(XLINK, 'href') || '';
      if (href && href.indexOf('#sveImg') === 0) {
        const src = $('#' + href.slice(1), App.defs);
        if (src && !$('#' + href.slice(1), defs)) defs.appendChild(src.cloneNode(true));
      }
    });
    /* 填充图案定义内联（引用 #svePatN 的 defs 在 App.defs 里，不内联则独立文件缺定义） */
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
    /* 每个图层写入模型数据（子层一并写，供拖回画布时按保存的样子恢复） */
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
  /* 视口 = 全部图层文档包围盒的并集（对称留白：viewBox 中心即整体中心） */
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
  return { str, name: '彩绘.svg' };
};

/* 2026-09-12 用户要求删除：savePaletteLayer（保存到「已保存彩绘」）已移除 */

/* 把已保存的彩绘按保存时的样子（大小/旋转/颜色/分组结构）放到画布 (x,y)（=新中心）；
   多图层彩绘整体平移，全部恢复并选中 */
App.applySavedPalette = function (name, content, x, y) {
  if (App.cancelColorPreview) App.cancelColorPreview();
  if (App.invalidateEditStatic) App.invalidateEditStatic();
  let doc;
  try { doc = new DOMParser().parseFromString(content, 'image/svg+xml'); }
  catch (e) { showToast(App.i18n.tf('toast.io.paletteBad', { v: name })); return; }
  if (doc.querySelector('parsererror')) { showToast(App.i18n.tf('toast.io.paletteBroken', { v: name })); return; }
  const tops = Array.from(doc.documentElement.children).filter(el => el.getAttribute && el.getAttribute('data-sve'));
  if (!tops.length) { showToast(App.i18n.tf('toast.io.paletteNoLayers', { v: name })); return; }
  /* 保存时 viewBox 对称留白：viewBox 中心 = 整体原中心；
     拖放点作为新中心（大小/旋转/颜色/分组结构不变，整体平移） */
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
  /* 批量放置：隐藏容器避免逐层布局 + 跳过逐层面板刷新（2000 层时 O(n²) 卡 8 秒） */
  App.state.batching = true;
  try {
    layers.forEach(l => App.addLayer(l));
  } finally {
    App.state.batching = false;
  }
  /* 恢复容器显示；"隐藏图层"开关 / 背景取色器 激活时保持隐藏 */
  if (!App.state.layersHidden && App.state.eyeMode !== 'bg') App.layersRoot.style.display = '';
  App.refreshPanel();
  App.refreshCount();
  /* 拖回后不自动选中：仅白框定位到最上层（避免选中被后续 Tab 多选意外带上）；
     多选（含 Tab 遗留单选）状态下放置：保持多选不被清空 */
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
  /* import 位图化：大量 import 图层时排队后台烘焙 */
  if (App.refreshImpBitmaps) App.refreshImpBitmaps();
  if (layers.length && App.contentChanged) App.contentChanged();
  showToast(App.i18n.tf('toast.io.placed', { v: name }));
};

/* 拖入的本地文件：SVG=导入当前标签（无标签先建），图片=背景 */
App.handleFiles = function (files) {
  Array.from(files).forEach(f => {
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    const prod = !!(App.Tabs && !App.Tabs.testMode);
    if (ext === 'svg') {
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result);
        App.importSvgIntoCurrent(text, f.name.replace(/\.svg$/i, '') || '未命名');
      };
      reader.readAsText(f);
    } else if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'jfif', 'ico', 'tif', 'tiff'].includes(ext)) {
      /* 无文档时拖背景图：先建一个空文档承载 */
      if (prod && !App.Tabs.docs.length) App.Tabs.addDoc({ silent: true, label: null });
      const reader = new FileReader();
      reader.onload = () => App.setBackgroundImage(String(reader.result));
      reader.readAsDataURL(f);
    } else {
      showToast(App.i18n.tf('toast.io.badFileType', { v: f.name }));
    }
  });
};

/* ---------- 工作副本：图案 + 背景图片（含全部变换）+ 历史颜色等，无损保存/读取 ---------- */
/* 把标签快照里的瘦图层补成可独立保存的工作副本图层。只克隆数据，不切换标签、
   不重建画布；symbol 的 dataUri 按 symbolKey 从素材库补回。 */
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
    histColors: (histColors || stateData.histColors || []).slice(0, 16),
    lastColor: stateData.lastColor,
    view: {
      x: stateData.view ? stateData.view.x : 0,
      y: stateData.view ? stateData.view.y : 0,
      scale: stateData.view ? stateData.view.scale : 1
    }
  };
};

/* 序列化当前全部工作状态为 JSON 字符串（背景图片以 data URL 内嵌，不丢失任何信息） */
App.buildWorkCopyString = function () {
  const s = App.state;
  const stateData = {
    bgHidden: !!s.bg.hidden,
    bgDisplayOpacity: s.bgDisplayOpacity ?? 1,
    layersHidden: !!s.layersHidden,
    layersDisplayOpacity: s.layersDisplayOpacity ?? 1,
    lastColor: s.lastColor,
    view: s.view
  };
  const data = App.buildWorkCopyData(
    s.layers.map(l => App.serializeLayer(l, true)),
    s.bg.image,
    stateData,
    App.histColors
  );
  return JSON.stringify(data);
};

/* 为指定标签生成工作副本。当前标签从实时模型读取；非当前标签只读 captureDoc 留下的
   数据快照。整个过程不临时切换活动画布，因此不会播放动画、改变选择或污染其他标签。 */
App.buildWorkCopyStringForDoc = function (doc) {
  if (!doc) return null;
  if (App.Tabs && App.Tabs.current === doc) return App.buildWorkCopyString();
  const d = doc.data || {};
  const layers = (d.layers || []).map(App.workCopyLayerFromSlim);
  return JSON.stringify(App.buildWorkCopyData(layers, doc.bg || null, d, d.histColors));
};

/* 记录当前文档的工作进程源文件句柄（由主进程在打开/保存时签发；保存时据此回写原文件）。
   与 recordSvgSource 对称：有当前文档就记在文档上，否则记在 App 级兜底上。 */
App.recordWorkSource = function (source) {
  if (App.Tabs && App.Tabs.current) App.Tabs.current.workSource = source || null;
  else App.currentWorkSource = source || null;
};

/* 保存工作进程：有源文件就【覆盖原文件】，没有（新建的空白文档）才按时间戳新建一个。
   源文件句柄只由主进程签发，渲染层不传路径/文件名，避免 IPC 越权写盘。 */
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
  /* 保存成功才认领新句柄：源文件被外部改动导致失败时，句柄保持原样，用户可以另存新文件。 */
  if (sourceDoc && App.Tabs && App.Tabs.docs && App.Tabs.docs.includes(sourceDoc)) {
    if ((sourceDoc.contentRevision || 0) === sourceRevision) sourceDoc.dirty = false;
    if (r.source) sourceDoc.workSource = r.source;
    const label = (r.name || '').replace(/\.svework$/i, '') || '工作进程';
    if (App.Tabs.setDocLabel) App.Tabs.setDocLabel(sourceDocId, label);
    else { sourceDoc.label = label; if (App.Tabs.renderBar) App.Tabs.renderBar(); }
  } else if (r.source) {
    App.currentWorkSource = r.source;
  }
  showToast(App.i18n.tf('toast.io.workSaved', { v: (r.name || '') }));
  if (App.Home && App.Home.refresh) App.Home.refresh();
  return r;
};

/* 打开工作副本：选择文件并整体恢复（覆盖当前画布，打开前的状态可撤销） */
App.openWorkCopy = async function () {
  const r = await window.sveApi.workOpen();
  blurActiveButton();
  if (r.canceled) {
    if (r.error) showToast(App.i18n.tf('toast.io.openFail', { v: r.error }));
    return;
  }
  App.openWorkCopyContent(r.content, r.name, r.source);
};

/* 按名称从自动目录打开工作副本（首页「最近工作副本」条目点击） */
App.openWorkCopyByName = async function (name) {
  const r = await window.sveApi.fileRead('workcopy', name);
  if (!r.ok) { showToast(App.i18n.tf('toast.home.openWorkFail', { v: (r.error || '') })); return; }
  App.openWorkCopyContent(r.content, r.name, r.source);
};

/* 恢复指定内容为当前文档（编辑中先退出；打开前状态可撤销）
   source：主进程签发的源文件句柄；带上它，之后保存才会回写这个文件 */
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

/* 恢复工作副本：清空当前画布，按保存的数据重建图层/背景/历史颜色/显示状态/视口 */
App.restoreWorkCopy = function (data) {
  App.history.markDiscrete(); // 打开前的状态作为一个撤回点
  if (App.cancelColorPreview) App.cancelColorPreview();
  /* 取色器激活中恢复：先退出（否则恢复后 eyeMode 残留，图层被强制隐藏且按钮被禁） */
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
    /* 恢复全部图层（合并分组/蒙版/图案等结构完整重建） */
    (data.layers || []).forEach(slim => {
      const l = App.deserializeLayer(slim);
      App.relinkSymbolData(l);
      App.addLayer(l);
    });
  } finally {
    App.state.batching = false;
  }
  /* 恢复背景图片（异步解码后重建元素，位置/大小/旋转/倾斜/缩放/翻转/透明度原样恢复） */
  if (data.bg && data.bg.dataUrl) {
    const m = data.bg;
    const token = ++App.bgSeq;
    loadImage(m.dataUrl).then(img => {
      if (token !== App.bgSeq) return; // 期间已被移除/替换
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
  /* 恢复历史颜色（仅内存，最多两行）、上次使用颜色、显示状态、视口 */
  App.histColors = Array.isArray(data.histColors) ? data.histColors.slice(0, 16) : [];
  App.renderHistGrid();
  if (data.lastColor) App.state.lastColor = data.lastColor;
  App.state.layersHidden = !!data.layersHidden;
  App.state.layersDisplayOpacity = (typeof data.layersDisplayOpacity === 'number') ? data.layersDisplayOpacity : 1;
  App.updateHideLayersButton();
  App.updateLayersDisplaySlider();
  App.applyLayersDisplayOpacity();
  /* 无背景时重置背景透明度滑条与隐藏背景按钮（有背景时在异步恢复完成后刷新） */
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
  if (App.Tabs && App.Tabs.clearDirty) App.Tabs.clearDirty(); // 打开工作进程=干净状态
  App.ensureMaskIndDef();
  App.refreshPanel();
  App.refreshCount();
  App.refreshLayerThumbs();
  /* 大分组渲染代理 + 符号预解码预热 */
  if (App.maybeBakeProxy) App.state.layers.forEach(l => { if (l.kind === 'merged') App.maybeBakeProxy(l); });
  if (App.warmupSymbols) App.warmupSymbols();
  if (App.contentChanged) App.contentChanged({ preserveAutoStatic: false });
  if (App.requestFlashRefresh) App.requestFlashRefresh(false);
  /* 代理首次烘焙失败的延迟重试（与导入路径一致）：嵌套子代理干扰/异步竞争
     可能导致首次触发失败，恢复后超大门组长期裸渲染卡顿 */
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

/* ---------- 历史工作锚点：每 10 分钟自动保存一次（最多 20 个，超出自动删最早） ---------- */
App.startHistAnchors = function () {
  if (App._histAnchorTimer) return;
  App._histAnchorTimer = setInterval(() => {
    /* 画布上有工作内容（图案或背景图片）才创建锚点 */
    if (App.state.layers.length > 0 || (App.state.bg.image && App.state.bg.image.el)) {
      App.saveHistAnchor();
    }
  }, 600000); // 10 分钟
};

/* 保存一个历史锚点（文件名带系统显示时间，由主进程生成） */
App.saveHistAnchor = async function () {
  const __t0 = performance.now();
  const str = App.buildWorkCopyString();
  const r = await window.sveApi.histAnchorSave(str);
  if (!r.ok) { console.warn('[hist-anchor] 保存失败', r.error); return null; }
  try { App.log('info', '历史锚点保存', { name: r.name, ms: Math.round(performance.now() - __t0) }); } catch (e) { /* ignore */ }
  return r.name;
};

/* 恢复工作进程按钮：列出锚点供选择 */
App.openHistAnchor = async function () {
  const list = await window.sveApi.histAnchorList();
  blurActiveButton();
  if (!list.ok) { showToast(App.i18n.tf('toast.io.anchorListFail', { v: (list.error || '') })); return; }
  if (!list.files.length) { showToast(App.i18n.t('toast.io.noAnchors')); return; }
  App.showHistAnchorPicker(list.files);
};

/* 锚点选择器：每个锚点显示保存时的系统时间与文件名 */
App.showHistAnchorPicker = function (files) {
  let ov = $('#histAnchorOv');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'histAnchorOv';
    ov.className = 'confirm-overlay hidden';
    /* 文案走 data-i18n；这个浮层是**按需创建**的，创建后要立刻 apply 一次，
       否则首开会停在 HTML 里的中文默认值（要等下一次切语言才更新） */
    ov.innerHTML = '<div class="confirm-box anchor-box"><div class="anchor-title" data-i18n="toolbar.histAnchor">恢复工作进程</div><div class="anchor-list"></div><div class="anchor-btns"><button class="anchor-cancel" data-i18n="dlg.cancel">取消</button></div></div>';
    document.body.appendChild(ov);
    if (App.i18n) App.i18n.apply(ov);
    /* 遮罩点击 / 右上角 × / 「取消」三者同一条收尾路径：纯隐藏即可（这个窗没有临时状态） */
    ov.addEventListener('click', e => { if (e.target === ov) App.hideOverlay(ov); });
    ov.querySelector('.anchor-cancel').addEventListener('click', () => App.hideOverlay(ov));
    if (App.attachDlgClose) App.attachDlgClose(ov.querySelector('.confirm-box'), () => { App.hideOverlay(ov); return true; });
  }
  const listEl = ov.querySelector('.anchor-list');
  listEl.innerHTML = '';
  files.slice().reverse().forEach(f => {
    const item = document.createElement('div');
    item.className = 'anchor-item';
    /* 左侧缩略图（用户 2026-09-23 要求，与主页一致）：先占位，异步填图 */
    item.innerHTML = '<img class="anchor-thumb" alt="" aria-hidden="true">' +
      '<span class="anchor-time"></span><span class="anchor-name"></span>';
    item.querySelector('.anchor-time').textContent = f.time;
    item.querySelector('.anchor-name').textContent = f.name;
    /* 缩略图链路与主页完全相同：离屏导出 SVG → App.fzaSvgThumb（带缓存）。
       失败就保持占位（不显示图），绝不影响列表可用性。 */
    const thumbImg = item.querySelector('.anchor-thumb');
    if (thumbImg && App.buildSvgFromAnchor && App.fzaSvgThumb) {
      (async () => {
        try {
          /* ⚠ buildSvgFromAnchor 返回的是 { str, ... } 对象（与 buildSvgFromWorkCopy 一致），
             不是字符串 —— 直接当字符串用会得到 "[object Object]"（2026-09-23 踩过）。 */
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

/* 回退到指定锚点：当前若有工作内容，先自动保存一次回退前状态为锚点（不丢失当前工作） */
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

/* 导入后的「初始渲染未完成先不显示」（2026-09-12 用户要求）：
   导入大文件时分组代理/位图化都是异步烘的，先显示矢量、随后被位图替换，用户会看到图案换一次。
   做法：把图层容器显示透明度压到 0 等烘焙落地（opacity 不影响布局与 getBBox），
   等没有在途烘焙（_proxyBaking 空 且 代理队列空）再恢复；兜底 4s，绝不把画布留在不可见状态。
   只有确实有待渲染的活时才介入，小文件（无代理）行为完全不变。 */
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
