'use strict';
/* Inkscape2Forza 兼容层：
   导出：use(#fh6_t*_i*_w*) + 内嵌符号定义 + mask_indicator_dark 蒙版标记，画布 1920x1080（原点居中）
         —— 可被 Inkscape2Forza 正常识别并注入 FH6 存档；
   导入：解析 Inkscape2Forza / 游戏导出的 SVG（use 矩阵分解为 位置/旋转/缩放/倾斜，分组 -> 合并图层，
         蒙版填充 -> isMask）。
   坐标约定：编辑器文档原点 <-> Forza 画布中心（960,540）。FH6 旋转为 SVG 旋转取负、y 轴翻转。
*/

App.FZA = {
  useRe: /fh6_t(\d+)_i(\d+)_w(\d+)/,
  symbolDefCache: null
};

/* 解析素材文本中所有 <symbol> 的位置与 viewBox（惰性一次缓存） */
App.FZA.symbolDefMap = function () {
  if (App.FZA.symbolDefCache) return App.FZA.symbolDefCache;
  const map = {};
  const text = App.libText;
  if (!text) return map;
  const re = /<symbol\s+([^>]*)>/g;
  let m;
  while ((m = re.exec(text))) {
    const idM = /id="([^"]+)"/.exec(m[1]);
    const vbM = /viewBox="([^"]+)"/.exec(m[1]);
    if (!idM || !vbM) continue;
    const vb = vbM[1].trim().split(/[\s,]+/).map(Number);
    if (vb.length !== 4 || !vb.every(isFinite)) continue;
    const end = text.indexOf('</symbol>', m.index);
    if (end < 0) continue;
    map[idM[1]] = { start: m.index, end: end + 9, x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
  }
  App.FZA.symbolDefCache = map;
  return map;
};

/* 图层 2x2 矩阵（与 transform 同序：rotate·scale·skewX，翻转折入缩放符号） */
App.FZA.layerMatrix = function (l) {
  const sxf = (l.flipH ? -1 : 1) * (l.sx || 1);
  const syf = (l.flipV ? -1 : 1) * (l.sy || 1);
  const t = Math.tan((l.skew || 0) * D2R);
  const a0 = Math.cos((l.rot || 0) * D2R), b0 = Math.sin((l.rot || 0) * D2R);
  return {
    a: a0 * sxf,
    b: b0 * sxf,
    c: a0 * sxf * t - b0 * syf,
    d: b0 * sxf * t + a0 * syf
  };
};

/* 矩阵乘法 M1·M2（列向量约定） */
App.FZA.mul = function (m1, m2) {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f
  };
};

/* 解析 SVG transform 列表（translate/rotate/scale/skewX/skewY/matrix，与 Inkscape2Forza 同序右乘） */
App.FZA.matFromString = function (str) {
  let M = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  if (!str) return M;
  const re = /([a-zA-Z]+)\s*\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(str))) {
    const cmd = m[1];
    const vals = m[2].replace(/,/g, ' ').trim().split(/\s+/).map(Number).filter(isFinite);
    let mm;
    if (cmd === 'matrix' && vals.length === 6) {
      mm = { a: vals[0], b: vals[1], c: vals[2], d: vals[3], e: vals[4], f: vals[5] };
    } else if (cmd === 'translate') {
      mm = { a: 1, b: 0, c: 0, d: 1, e: vals[0] || 0, f: vals[1] || 0 };
    } else if (cmd === 'scale') {
      mm = { a: vals[0] || 1, b: 0, c: 0, d: (vals.length > 1 ? vals[1] : vals[0]) || 1, e: 0, f: 0 };
    } else if (cmd === 'rotate') {
      const r = (vals[0] || 0) * D2R, ca = Math.cos(r), sa = Math.sin(r);
      if (vals.length >= 3) {
        const cx2 = vals[1] || 0, cy2 = vals[2] || 0;
        mm = { a: ca, b: sa, c: -sa, d: ca, e: cx2 - cx2 * ca + cy2 * sa, f: cy2 - cx2 * sa - cy2 * ca };
      } else {
        mm = { a: ca, b: sa, c: -sa, d: ca, e: 0, f: 0 };
      }
    } else if (cmd === 'skewX') {
      mm = { a: 1, b: 0, c: Math.tan((vals[0] || 0) * D2R), d: 1, e: 0, f: 0 };
    } else if (cmd === 'skewY') {
      mm = { a: 1, b: Math.tan((vals[0] || 0) * D2R), c: 0, d: 1, e: 0, f: 0 };
    } else continue;
    M = App.FZA.mul(M, mm);
  }
  return M;
};

/* SVG 矩阵 -> 编辑器模型参数（y 向下，内容中心锚点，rot/skew 为角度）。
   与 Inkscape2Forza decompose_matrix 互逆：FH6 rot = -我们的 rot，FH6 skew = -(sx/sy)·tan(我们的 skew°) */
App.FZA.decomposeToModel = function (M) {
  const a = M.a, b = M.b, c = M.c, d = M.d;
  const rot = Math.atan2(b, a) * 180 / Math.PI;
  const sx = Math.hypot(a, b);
  const rr = rot * D2R;
  const sy = d * Math.cos(rr) - c * Math.sin(rr);
  const t = sx > 1e-9 ? (a * c + b * d) / (a * a + b * b) : 0;
  const skew = Math.atan(t) * 180 / Math.PI;
  return { rot, sx, sy, skew };
};

/* 编辑器模型矩阵 -> Inkscape2Forza 形式矩阵（导出用，保证其 importer 分解无损失）。
   翻转直接写入负 sx/sy：FH6 图层格式的 sx/sy 为 float，支持负值（镜像），
   Inkscape2Forza 分解（sx 恒正、负号进 sy）会把水平镜像正确表示为 rot+180° 与 sy<0——
   游戏原生渲染镜像，无需 180° 旋转近似（旧近似会导致游戏中角度错误）。 */
App.FZA.modelToFzaMatrix = function (l) {
  const sx = (l.flipH ? -1 : 1) * (l.sx || 1); // 水平镜像 = 负 sx
  const sy = (l.flipV ? -1 : 1) * (l.sy || 1); // 垂直镜像 = 负 sy
  const t = Math.tan((l.skew || 0) * D2R);
  /* 矩阵 R(rot)·S(sx,sy)·K(t)（与 transform 同序） */
  const a0 = Math.cos((l.rot || 0) * D2R), b0 = Math.sin((l.rot || 0) * D2R);
  const a = a0 * sx, b = b0 * sx, c = a0 * sx * t - b0 * sy, d = b0 * sx * t + a0 * sy;
  /* 分解为 Inkscape2Forza 参数（其 importer 的逆分解在此形式上无损），再按其约定合成 */
  const sxF = Math.hypot(a, b);
  const rotF = Math.atan2(-b, a);
  const syF = c * Math.sin(rotF) + d * Math.cos(rotF);
  const skF = Math.abs(syF) > 1e-9 ? (-c * Math.cos(rotF) + d * Math.sin(rotF)) / syF : 0;
  return {
    a: sxF * Math.cos(rotF),
    b: -sxF * Math.sin(rotF),
    c: syF * (Math.sin(rotF) - skF * Math.cos(rotF)),
    d: syF * (Math.cos(rotF) + skF * Math.sin(rotF))
  };
};

/* 导出用的模型序列化：仅包含会写入文件的图层（symbol/merged），pattern/import 跳过 */
App.FZA.exportSlim = function (l) {
  if (l.kind !== 'symbol' && l.kind !== 'merged') return null;
  if (l.kind === 'symbol' && !(l.symbolKey && App.symbolMap.has(l.symbolKey))) return null;
  const slim = App.serializeLayer(l, false);
  if (l.kind === 'merged' && slim.children) {
    slim.children = (l.children || []).map(c => App.FZA.exportSlim(c)).filter(Boolean);
  }
  return slim;
};

/* 生成 Forza 兼容 SVG 字符串（与保存对话框分离，便于测试）。
   quiet=true 时抑制 showToast（注入/自动保存等静默路径用） */
App.buildForzaExportString = function (quiet, layers) {
  /* layers：可选的显式图层数组（不传 = 当前画布）。主页渲染「工作进程」卡缩略图时用离屏图层调用，
     避免为了产出一次字符串而把画布内容换掉（2026-09-12「切回标签显示成别的图案」的根因修复）。 */
  const src = Array.isArray(layers) ? layers : App.state.layers;
  if (!src.length) { if (!quiet) showToast(App.i18n.t('toast.forza.noLayers')); return null; }
  const defMap = App.FZA.symbolDefMap();
  let skipped = 0, anyMask = false;
  const useLayers = [];
  const markUse = l => { useLayers.push(l); if (l.isMask) anyMask = true; };

  const toNode = l => {
    if (l.kind === 'symbol') {
      if (l.symbolKey && App.symbolMap.has(l.symbolKey) && defMap[l.symbolKey]) {
        markUse(l);
        return { type: 'use', layer: l };
      }
      skipped++;
      return null;
    }
    if (l.kind === 'merged' && l.children) {
      const kids = l.children.map(toNode).filter(Boolean);
      if (!kids.length) { skipped += l.children.length; return null; }
      return { type: 'g', layer: l, children: kids };
    }
    skipped++;
    return null;
  };
  const nodes = src.map(toNode).filter(Boolean);
  if (!useLayers.length) {
    if (!quiet) showToast(App.i18n.t('toast.forza.noSymbols'));
    return null;
  }

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const f6 = n => Math.round(n * 1e6) / 1e6;
  const hex2 = n => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  /* 蒙版填充图案跟随当前背景主题，仍能被识别为蒙版状态 */
  const maskFillRef = 'url(#' + App.maskThemeKey() + ')';

  /* use 元素：内容中心 -> 图层原点。use 内容点 p -> (e,f)+M·(p-min)，viewBox 居中 => min=-W/2，
     故 (e,f) = (x,y) - M·(W/2,H/2) */
  let nid = 0;
  const writeUse = (l) => {
    const def = defMap[l.symbolKey];
    const M = App.FZA.modelToFzaMatrix(l);
    const e = f6((l.x || 0) - (M.a * def.w / 2 + M.c * def.h / 2));
    const f = f6((l.y || 0) - (M.b * def.w / 2 + M.d * def.h / 2));
    const rgb = hexToRgb(l.color || '#ffffff') || { r: 255, g: 255, b: 255 };
    const fill = l.isMask ? maskFillRef : '#' + hex2(rgb.r) + hex2(rgb.g) + hex2(rgb.b);
    const op = clamp(l.opacity, 0, 1);
    const id = (l.isMask ? 'mask_' : 'shape_') + (++nid);
    const slim = JSON.stringify(App.FZA.exportSlim(l));
    return '    <use xlink:href="#' + l.symbolKey + '" x="0" y="0" id="' + id +
      '" transform="matrix(' + [M.a, M.b, M.c, M.d, e, f].map(f6).join(',') + ')"' +
      ' style="fill:' + fill + ';opacity:' + op + '"' +
      ' data-sve="' + esc(slim) + '" />';
  };
  const writeNode = (node, depth) => {
    const pad = '  '.repeat(depth);
    if (node.type === 'use') return pad + writeUse(node.layer);
    const g = node.layer;
    const M = App.FZA.modelToFzaMatrix(g);
    const attrs = ' id="' + (g.name ? esc(String(g.name)).slice(0, 80) : 'group_' + (++nid)) + '"' +
      ' transform="matrix(' + [M.a, M.b, M.c, M.d, f6(g.x || 0), f6(g.y || 0)].map(f6).join(',') + ')"' +
      (g.opacity !== undefined && g.opacity !== 1 ? ' style="opacity:' + clamp(g.opacity, 0, 1) + '"' : '') +
      (g.isMask ? ' data-forza-mask-group="1"' : '') +
      ' data-sve="' + esc(JSON.stringify(App.FZA.exportSlim(g))) + '"';
    const inner = node.children.map(c => writeNode(c, depth + 1)).join('\n');
    return pad + '<g' + attrs + '>\n' + inner + '\n' + pad + '</g>';
  };

  /* 内嵌符号定义（仅使用到的）+ 蒙版指示图案定义（深/浅两个都带，任选背景主题） */
  const usedKeys = Array.from(new Set(useLayers.map(l => l.symbolKey))).sort();
  const defsParts = [];
  usedKeys.forEach(k => defsParts.push(App.libText.slice(defMap[k].start, defMap[k].end)));
  if (anyMask) {
    ['mask_indicator_dark', 'mask_indicator_light'].forEach(k => {
      const pat = (App.patterns || []).find(p => p.key === k);
      if (pat) defsParts.push(new XMLSerializer().serializeToString(pat.node));
    });
  }

  const body = nodes.map(n => writeNode(n, 2)).join('\n');
  const str = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"' +
    ' xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"' +
    ' xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"' +
    ' width="1920" height="1080" viewBox="-960 -540 1920 1080" version="1.1"' +
    ' inkscape:version="1.4" data-sve-version="2">\n' +
    '  <sodipodi:namedview id="namedview1" pagecolor="#ffffff" showgrid="false" />\n' +
    '  <defs>\n' + defsParts.join('\n') + '\n  </defs>\n' +
    body + '\n</svg>\n';

  const d = new Date();
  const name = 'Forza图案-' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0') + '-' + String(d.getHours()).padStart(2, '0') +
    String(d.getMinutes()).padStart(2, '0') + '.svg';

  const warns = [];
  if (skipped) warns.push(skipped + ' 个图案或导入图层不会写入导出文件');
  if (warns.length && !quiet) showToast(App.i18n.tf('toast.forza.exportWarn', { v: warns.join('；') }));
  return { str, name };
};

/* ---------- 导入 Inkscape2Forza / 游戏导出的 SVG ---------- */
App.importForza = function (root) {
  /* 画布中心（viewBox 或 1920x1080）-> 编辑器文档原点 */
  let cx = 960, cy = 540;
  const vbM = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (vbM.length === 4 && vbM.every(isFinite)) { cx = vbM[0] + vbM[2] / 2; cy = vbM[1] + vbM[3] / 2; }

  const defInfo = {};
  $$('symbol', root).forEach(s => {
    const id = s.getAttribute('id');
    const vb2 = (s.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    if (id && vb2.length === 4 && vb2.every(isFinite)) defInfo[id] = { x: vb2[0], y: vb2[1], w: vb2[2], h: vb2[3] };
  });

  const adoptSymbolDef = id => {
    if ($('#' + id, App.defs)) return;
    const src = root.querySelector('symbol#' + id);
    if (src) App.defs.appendChild(src.cloneNode(true));
  };

  const styleVal = (el, name) => {
    const m = new RegExp(name + ':\\s*([^;]+)', 'i').exec(el.getAttribute('style') || '');
    return m ? m[1].trim() : el.getAttribute(name);
  };
  const parseOpacity = el => {
    const v = parseFloat(styleVal(el, 'opacity'));
    return isFinite(v) ? clamp(v, 0, 1) : 1;
  };
  const parseColor = el => {
    const fill = styleVal(el, 'fill') || '';
    if (!fill || fill === 'none' || fill.indexOf('url(') >= 0) return '#ffffff';
    const m = /#([0-9a-fA-F]{6})/.exec(fill);
    if (m) return '#' + m[1].toLowerCase();
    const rgb = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(fill);
    if (rgb) return rgbToHex(+rgb[1], +rgb[2], +rgb[3]);
    return '#ffffff';
  };
  const isMaskEl = el => {
    const id = (el.getAttribute('id') || '').toLowerCase();
    const fill = (styleVal(el, 'fill') || '').toLowerCase();
    return id.startsWith('mask') || fill.indexOf('mask_indicator') >= 0 ||
      el.getAttribute('data-forza-mask-group') === '1';
  };

  /* 从 data-sve 提取翻转/名称（我们自己的导出文件，Inkscape 二次编辑后位置仍以 DOM 为准） */
  const slimOf = el => {
    const raw = el.getAttribute('data-sve');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  };

  const buildUse = (useEl, M, mask, opacity) => {
    const href = useEl.getAttribute('href') || useEl.getAttributeNS(XLINK, 'href') || '';
    const id = href.replace(/^#/, '');
    const def = defInfo[id];
    const sym = App.symbolMap.get(id);
    const W = def ? def.w : (sym ? sym.w : 128);
    const H = def ? def.h : (sym ? sym.h : 128);
    const ux = parseFloat(useEl.getAttribute('x')) || 0;
    const uy = parseFloat(useEl.getAttribute('y')) || 0;
    const Me = { a: M.a, b: M.b, c: M.c, d: M.d, e: M.e + M.a * ux + M.c * uy, f: M.f + M.b * ux + M.d * uy };
    const x = Me.e + (Me.a * W / 2 + Me.c * H / 2) - cx;
    const y = Me.f + (Me.b * W / 2 + Me.d * H / 2) - cy;
    const p = App.FZA.decomposeToModel(Me);
    let sy = Math.abs(p.sy), flipV = p.sy < 0, flipH = false, rot = normalizeDeg(p.rot);
    const slim = slimOf(useEl);
    if (slim && slim.kind === 'symbol') {
      flipH = !!slim.flipH; flipV = !!slim.flipV;
      /* 导出分解只对 flipH（x 轴列翻转）把 180° 折进 rot；flipV 的符号在 sy 的负号里，
         rot 保持原值——因此只有 flipH 需要按 data-sve 撤销 180°，flipV 再减会错 180° */
      if (flipH) rot = normalizeDeg(p.rot - 180);
    }
    const op = clamp(opacity, 0, 1);
    if (sym) {
      const l = App.newLayer({
        kind: 'symbol', name: (slim && slim.name) || sym.label,
        w: sym.w, h: sym.h, x, y, sx: Math.abs(p.sx), sy, rot, skew: p.skew,
        opacity: op, color: mask ? '#ffffff' : parseColor(useEl),
        flipH, flipV, isMask: !!mask
      });
      l.symbolKey = id;
      l.dataUri = App.symbolUri(sym);
      return l;
    }
    /* 符号库缺失：原样保留 use（配合内嵌定义仍可显示） */
    adoptSymbolDef(id);
    return App.newLayer({
      kind: 'import', name: '导入·' + id, x: 0, y: 0, w: 0, h: 0,
      opacity: op, color: '#ffffff', importMarkup: useEl.outerHTML, isMask: !!mask
    });
  };

  const buildG = (gEl, M, mask, opacity) => {
    const slim = slimOf(gEl);
    const gMask = mask || isMaskEl(gEl);
    const gOp = opacity * parseOpacity(gEl);
    const children = [];
    Array.from(gEl.children).forEach(ch => {
      const tag = ch.nodeName.toLowerCase();
      if (tag === 'use' && App.FZA.useRe.test(ch.getAttribute('href') || ch.getAttributeNS(XLINK, 'href') || '')) {
        const Mc = App.FZA.mul(M, App.FZA.matFromString(ch.getAttribute('transform')));
        const l = buildUse(ch, Mc, gMask || isMaskEl(ch), gOp * parseOpacity(ch));
        if (l) children.push(l);
      } else if (tag === 'g') {
        const Mc = App.FZA.mul(M, App.FZA.matFromString(ch.getAttribute('transform')));
        const sub = buildG(ch, Mc, gMask, gOp);
        if (sub) children.push(sub);
      }
    });
    if (!children.length) return null;
    if (children.length === 1) return children[0];
    const merged = App.newLayer({
      kind: 'merged', name: (slim && slim.name) || gEl.getAttribute('id') || '合并图层',
      color: '', opacity: 1, isMask: gMask
    });
    merged.children = children;
    return merged;
  };

  App.history.markDiscrete();
  let count = 0;
  /* 批量导入：抑制逐层面板重建（大量图层时导入速度提升数倍） */
  App.state.batching = true;
  try {
    Array.from(root.children).forEach(ch => {
      const tag = ch.nodeName.toLowerCase();
      if (tag === 'use' && App.FZA.useRe.test(ch.getAttribute('href') || ch.getAttributeNS(XLINK, 'href') || '')) {
        const M = App.FZA.matFromString(ch.getAttribute('transform'));
        const l = buildUse(ch, M, isMaskEl(ch), parseOpacity(ch));
        if (l) { App.addLayer(l); count++; }
      } else if (tag === 'g') {
        const M = App.FZA.matFromString(ch.getAttribute('transform'));
        const sub = buildG(ch, M, isMaskEl(ch), parseOpacity(ch));
        if (sub) { App.addLayer(sub); count++; }
      }
    });
  } finally {
    App.state.batching = false;
  }
  App.refreshPanel();
  App.refreshCount();
  if (count && App.contentChanged && !App._importingSvg) App.contentChanged();
  if (!count) showToast(App.i18n.t('toast.forza.noRecognized'));
  else showToast(App.i18n.tf('toast.imported', { n: count }));
};

/* ========== FH6 模型桥：Forza SVG <-> 游戏 C_group 模型 ==========
   解码侧思路：C_group（主进程解码）-> 本函数生成官方同款 SVG -> App.importForza 进编辑器；
   编码侧思路：App.buildForzaExportString -> modelFromForzaSvg 读出与 Inkscape2Forza
   官方 process_svg 完全一致的 FH6 字段模型 -> 主进程编码为 C_group。 */

/* FH6 矩阵分解（镜像 Python svg_codec.decompose_matrix；FH6 画布 1920x1080 等比适配 + y 翻转） */
App.FZA.decomposeFza = function (a, b, c, d, e, f, minX, minY, canvasX, canvasY, canvasW, canvasH) {
  const realSvgCx = a * (-minX) + c * (-minY) + e;
  const realSvgCy = b * (-minX) + d * (-minY) + f;
  const scale = Math.min(1920 / canvasW, 1080 / canvasH);
  const tx = (realSvgCx - (canvasX + canvasW / 2)) * scale;
  const ty = ((canvasY + canvasH / 2) - realSvgCy) * scale;
  const A = a, B = -b, C = -c, D = d;
  const sx = Math.hypot(A, B);
  if (sx < 1e-6) return { tx, ty, sx: 0, sy: 0, rot: 0, skew: 0 };
  let rotDeg = Math.atan2(B, A) * 180 / Math.PI;
  rotDeg = ((rotDeg % 360) + 360) % 360;
  const rad = rotDeg * D2R;
  const sy = -C * Math.sin(rad) + D * Math.cos(rad);
  const skew = Math.abs(sy) > 1e-6 ? (C * Math.cos(rad) + D * Math.sin(rad)) / sy : 0;
  return { tx, ty, sx: sx * scale, sy: sy * scale, rot: rotDeg, skew };
};

/* 解析 Forza 兼容 SVG（本编辑器导出或官方工具/游戏导出的 SVG）为 FH6 模型（镜像 process_svg）。
   返回 { root, count }，root.kind==='group'。 */
App.FZA.modelFromForzaSvg = function (svgStr) {
  const doc = new DOMParser().parseFromString(svgStr, 'image/svg+xml');
  const rootEl = doc.documentElement;
  const vb = ((rootEl.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number));
  let canvasX = 0, canvasY = 0, canvasW = 1920, canvasH = 1080;
  if (vb.length === 4 && vb.every(isFinite)) { canvasX = vb[0]; canvasY = vb[1]; canvasW = vb[2]; canvasH = vb[3]; }
  else {
    const pw = parseFloat(rootEl.getAttribute('width'));
    const ph = parseFloat(rootEl.getAttribute('height'));
    if (isFinite(pw) && pw > 0) canvasW = pw;
    if (isFinite(ph) && ph > 0) canvasH = ph;
  }
  const symbolOrigins = {};
  $$('symbol', rootEl).forEach(s => {
    const id = s.getAttribute('id');
    const sVb = ((s.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number));
    if (id && sVb.length === 4 && sVb.every(isFinite)) symbolOrigins[id] = { x: sVb[0], y: sVb[1] };
  });
  const styleVal = (el, name) => {
    const m = new RegExp(name + ':\\s*([^;]+)', 'i').exec(el.getAttribute('style') || '');
    return m ? m[1].trim() : el.getAttribute(name);
  };
  const parseOp = el => {
    const v = parseFloat(styleVal(el, 'opacity'));
    return isFinite(v) ? clamp(v, 0, 1) : 1;
  };
  const parseCol = el => {
    const fill = styleVal(el, 'fill') || '';
    if (!fill || fill === 'none') return null;
    if (fill.indexOf('url(') >= 0) return null;
    const m = /#([0-9a-fA-F]{6})/.exec(fill);
    if (m) return [parseInt(m[1].substr(0, 2), 16), parseInt(m[1].substr(2, 2), 16), parseInt(m[1].substr(4, 2), 16)];
    const rgb = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(fill);
    if (rgb) return [parseInt(rgb[1], 10), parseInt(rgb[2], 10), parseInt(rgb[3], 10)];
    return null;
  };
  const maskLike = el => {
    const id = (el.getAttribute('id') || '').toLowerCase();
    const fill = (styleVal(el, 'fill') || '').toLowerCase();
    return id.indexOf('mask') === 0 || fill.indexOf('mask_indicator') >= 0 ||
      el.getAttribute('data-forza-mask-group') === '1';
  };
  let count = 0;
  const shapes = [];
  const HREF_RE = App.FZA.useRe;

  function walkG(parentEl, parentM, inheritedMask, inheritedOp) {
    const groupChildren = [];
    Array.from(parentEl.children).forEach(ch => {
      const tag = ch.nodeName.toLowerCase();
      if (tag === 'defs' || tag === 'title' || tag === 'metadata' || tag === 'namedview' || tag === 'style') return;
      const M = App.FZA.mul(parentM, App.FZA.matFromString(ch.getAttribute('transform')));
      if (tag === 'g') {
        const gMask = inheritedMask || maskLike(ch);
        const gOp = inheritedOp * parseOp(ch);
        const sub = walkG(ch, M, gMask, gOp);
        if (sub.length) groupChildren.push({ kind: 'group', children: sub, isMaskGroup: gMask, name: ch.getAttribute('id') || '' });
        return;
      }
      if (tag !== 'use') return;
      const href = ch.getAttribute('href') || ch.getAttributeNS(XLINK, 'href') || '';
      const m = HREF_RE.exec(href);
      if (!m) return;
      const isMask = inheritedMask || maskLike(ch);
      const opAll = clamp(inheritedOp * parseOp(ch), 0, 1);
      const a = Math.round(opAll * 255);
      if (a <= 0) return;
      let col = parseCol(ch);
      if (isMask) col = [255, 255, 255];
      if (!col) return;
      const word = parseInt(m[3], 10);
      const def = symbolOrigins[href.replace(/^#/, '')] || { x: 0, y: 0 };
      const ux = parseFloat(ch.getAttribute('x')) || 0;
      const uy = parseFloat(ch.getAttribute('y')) || 0;
      const Me = { a: M.a, b: M.b, c: M.c, d: M.d, e: M.e + M.a * ux + M.c * uy, f: M.f + M.b * ux + M.d * uy };
      const p = App.FZA.decomposeFza(Me.a, Me.b, Me.c, Me.d, Me.e, Me.f, def.x, def.y,
        canvasX, canvasY, canvasW, canvasH);
      count++;
      groupChildren.push({
        kind: 'shape', word, rot: p.rot, tx: p.tx, ty: p.ty, sx: p.sx, sy: p.sy, skew: p.skew,
        r: col[0], g: col[1], b: col[2], a, isMask
      });
    });
    return groupChildren;
  }

  const root = { kind: 'group', children: walkG(rootEl, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, false, 1), isMaskGroup: false, name: 'root' };
  return { root, count };
};

/* FH6 模型 -> Forza 兼容 SVG 字符串（镜像 Python export_cgroup_to_svg：画布 0..1920 官方约定，
   组保留为 <g>（mask 组加 data-forza-mask-group），形状按各自 isMask 标记蒙版）。
   embedSvg：含符号 defs 的库文本（默认 App.libText）。返回 { str, name }。 */
App.FZA.svgStringFromModel = function (root, opts) {
  opts = opts || {};
  const embed = opts.embedSvg || App.libText || '';
  /* 收集用到的 word -> 符号 id（词表 id 形如 fh6_t{Type}_i{Idx}_w{Word}） */
  const wordToId = {};
  const collect = n => { if (n.kind === 'group') n.children.forEach(collect); else if (!wordToId[n.word]) wordToId[n.word] = null; };
  collect(root);
  const symRe = /<symbol\s+([^>]*)>/g;
  const defParts = [];
  const usedWords = Object.keys(wordToId).map(Number).filter(w => wordToId[w] === null);
  let mm;
  while ((mm = symRe.exec(embed))) {
    const idM = /id="([^"]+)"/.exec(mm[1]);
    if (!idM) continue;
    const wM = App.FZA.useRe.exec(idM[1]);
    if (!wM) continue;
    const word = parseInt(wM[3], 10);
    if (usedWords.indexOf(word) < 0 || wordToId[word] !== null) continue;
    wordToId[word] = idM[1];
    const end = embed.indexOf('</symbol>', mm.index);
    if (end > 0) defParts.push(embed.slice(mm.index, end + 9));
    if (defParts.length === usedWords.length) break;
  }
  const defMap = App.FZA.symbolDefMap();
  const svgCx = 960, svgCy = 540;
  const f6 = n => Math.round(n * 1e6) / 1e6;
  const hex2 = n => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  const maskKey = (App.maskThemeKey ? App.maskThemeKey() : 'mask_indicator_dark');
  const maskPattern = maskKey === 'mask_indicator_dark' ? 'mask_indicator_light' : 'mask_indicator_dark';
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const body = [];
  let nid = 0;

  const shapeLine = (sh, indent) => {
    const href = wordToId[sh.word];
    if (!href) return '';
    const def = defMap[href];
    const minX = def ? def.x : 0, minY = def ? def.y : 0;
    const rad = sh.rot * D2R;
    const cosR = Math.cos(rad), sinR = Math.sin(rad);
    const ma = sh.sx * cosR;
    const mb = -sh.sx * sinR;
    const mc = sh.sy * (sinR - sh.skew * cosR);
    const md = sh.sy * (cosR + sh.skew * sinR);
    const me = (svgCx + sh.tx) + ma * minX + mc * minY;
    const mf = (svgCy - sh.ty) + mb * minX + md * minY;
    const fill = sh.isMask ? 'url(#' + maskKey + ')' : '#' + hex2(sh.r) + hex2(sh.g) + hex2(sh.b);
    return indent + '<use xlink:href="#' + href + '" x="0" y="0" id="' + (sh.isMask ? 'mask_' : 'shape_') + (++nid) + '"' +
      ' transform="matrix(' + [f6(ma), f6(mb), f6(mc), f6(md), f6(me), f6(mf)].join(',') + ')"' +
      ' style="fill:' + fill + ';opacity:' + f6(clamp(sh.a / 255, 0, 1)) + '" />';
  };
  const writeNode = (node, indent, prefix) => {
    const pad = '  '.repeat(indent);
    if (node.kind === 'group') {
      const gId = (node.name || prefix || 'group_' + (++nid)).slice(0, 80);
      const lines = [];
      node.children.forEach((c, i) => {
        const pl = prefix ? prefix + '_' + (i + 1) : 'g_' + (i + 1);
        const out = writeNode(c, indent + 1, pl);
        if (out) lines.push(out);
      });
      if (!lines.length) return '';
      const attrs = ' id="' + esc(String(gId)) + '"' + (node.isMaskGroup ? ' data-forza-mask-group="1"' : '');
      return pad + '<g' + attrs + '>\n' + lines.join('\n') + '\n' + pad + '</g>';
    }
    return shapeLine(node, pad);
  };
  root.children.forEach((c, i) => {
    const out = writeNode(c, 1, 'forza_' + (i + 1));
    if (out) body.push(out);
  });

  /* 蒙版指示图案（深浅两个都带，兼容任意背景主题） */
  const patternDefs = [];
  (App.patterns || []).forEach(p => {
    if (p.key === maskKey || p.key === maskPattern) {
      patternDefs.push(new XMLSerializer().serializeToString(p.node));
    }
  });
  const str = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"' +
    ' xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"' +
    ' xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"' +
    ' width="1920" height="1080" viewBox="0 0 1920 1080" version="1.1" inkscape:version="1.4">\n' +
    '  <sodipodi:namedview id="namedview1" pagecolor="#ffffff" showgrid="false" />\n' +
    '  <defs>\n' + defParts.join('\n') + (patternDefs.length ? '\n' + patternDefs.join('\n') : '') + '\n  </defs>\n' +
    body.join('\n') + '\n</svg>\n';
  return { str, name: 'Forza导出.svg' };
};
