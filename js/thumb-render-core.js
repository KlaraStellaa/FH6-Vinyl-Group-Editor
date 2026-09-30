'use strict';
/* 主页/选择窗 SVG 缩略图的独立渲染核心。
   只依赖浏览器 DOM 与 canvas，可同时加载在主界面和隐藏缩略图进程中。 */
(function (global) {
  const NS = 'http://www.w3.org/2000/svg';
  const NON_DRAW = /^(defs|title|desc|metadata|style|script|namedview)$/;

  function tagOf(el) {
    return String(el && (el.localName || el.nodeName) || '').toLowerCase();
  }

  function isMaskElement(el) {
    if (!el || !el.getAttribute) return false;
    const tag = tagOf(el);
    /* <defs> 内每个 FH6 symbol 都有一个内部 <mask>，那只是素材剪影，不能被
       当成编辑器蒙版层。真正的蒙版只会落在绘制节点上。 */
    if (tag === 'mask' || tag === 'pattern' || tag === 'symbol') return false;
    const id = String(el.getAttribute('id') || '').toLowerCase();
    const fillAttr = String(el.getAttribute('fill') || '').toLowerCase();
    const style = String(el.getAttribute('style') || '').toLowerCase();
    return id.indexOf('mask_') === 0 || fillAttr.indexOf('mask_indicator') >= 0 ||
      style.indexOf('mask_indicator') >= 0 || el.getAttribute('data-forza-mask-group') === '1';
  }

  function hasMasks(svgText) {
    const text = String(svgText || '');
    if (!text || text.indexOf('mask') < 0) return false;
    /* 限定到绘制标签，避免命中 symbol 定义里的 mask_fh6_*。 */
    return /<(?:g|use|path|rect|image|polygon|ellipse|circle)\b[^>]*(?:data-forza-mask-group\s*=\s*["']1["']|\bid\s*=\s*["']mask_|mask_indicator)/i.test(text);
  }

  function viewBoxOf(root) {
    const vb = String(root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    if (vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) {
      return { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
    }
    const w = parseFloat(root.getAttribute('width')) || 1920;
    const h = parseFloat(root.getAttribute('height')) || 1080;
    return { x: 0, y: 0, w: Math.max(1, w), h: Math.max(1, h) };
  }

  function cloneWrapper(src) {
    const out = src.cloneNode(false);
    out.removeAttribute('id');
    out.removeAttribute('data-forza-mask-group');
    return out;
  }

  function appendWithWrappers(host, wrappers, node) {
    let at = host;
    wrappers.forEach(function (src) {
      const g = cloneWrapper(src);
      at.appendChild(g);
      at = g;
    });
    at.appendChild(node.cloneNode(true));
  }

  function makeOpaqueShape(el) {
    if (!el || !el.getAttribute) return;
    el.removeAttribute('id');
    el.removeAttribute('data-forza-mask-group');
    el.setAttribute('fill', '#fff');
    el.setAttribute('stroke', '#fff');
    el.setAttribute('color', '#fff');
    el.setAttribute('opacity', '1');
    const style = el.style;
    if (style && style.setProperty) {
      style.setProperty('fill', '#fff');
      style.setProperty('stroke', '#fff');
      style.setProperty('color', '#fff');
      style.setProperty('opacity', '1');
    }
    Array.prototype.slice.call(el.children || []).forEach(makeOpaqueShape);
  }

  /* 把按层序出现的蒙版改成真正的“擦除下面内容”。关键是全局累计绘制顺序：
     每遇到一个蒙版，就用一个 alpha-out 掩膜包住此前累计的全部内容；蒙版后的
     图层继续画在包裹外面。一个文档最终仍只需解析/光栅化一次。 */
  function knockoutMasks(svgText) {
    const text = String(svgText || '');
    if (!hasMasks(text)) return text;
    try {
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      const root = doc.documentElement;
      if (!root || tagOf(root) !== 'svg' || root.querySelector('parsererror')) return text;
      const box = viewBoxOf(root);
      let defs = null;
      Array.prototype.slice.call(root.children || []).some(function (el) {
        if (tagOf(el) === 'defs') { defs = el; return true; }
        return false;
      });
      if (!defs) {
        defs = doc.createElementNS(NS, 'defs');
        root.insertBefore(defs, root.firstChild);
      }

      const deepMemo = new WeakMap();
      const hasDeepMask = function (el) {
        if (deepMemo.has(el)) return deepMemo.get(el);
        let found = isMaskElement(el);
        if (!found) {
          const kids = Array.prototype.slice.call(el.children || []);
          for (let i = 0; i < kids.length && !found; i++) found = hasDeepMask(kids[i]);
        }
        deepMemo.set(el, found);
        return found;
      };

      const originals = Array.prototype.slice.call(root.children || []);
      const drawNodes = originals.filter(function (el) {
        const tag = tagOf(el);
        return !NON_DRAW.test(tag) && tag.indexOf('namedview') < 0;
      });
      if (!drawNodes.some(hasDeepMask)) return text;
      drawNodes.forEach(function (el) { el.remove(); });
      const stage = doc.createElementNS(NS, 'g');
      stage.setAttribute('data-sve-thumb-stage', '1');
      root.appendChild(stage);
      let maskNo = 0;

      const applyMask = function (maskNode, wrappers) {
        maskNo++;
        const fid = 'sveThumbOut' + maskNo;
        const mid = 'sveThumbMask' + maskNo;
        const filter = doc.createElementNS(NS, 'filter');
        filter.setAttribute('id', fid);
        filter.setAttribute('filterUnits', 'userSpaceOnUse');
        filter.setAttribute('primitiveUnits', 'userSpaceOnUse');
        filter.setAttribute('x', box.x); filter.setAttribute('y', box.y);
        filter.setAttribute('width', box.w); filter.setAttribute('height', box.h);
        filter.setAttribute('color-interpolation-filters', 'sRGB');
        const flood = doc.createElementNS(NS, 'feFlood');
        flood.setAttribute('x', box.x); flood.setAttribute('y', box.y);
        flood.setAttribute('width', box.w); flood.setAttribute('height', box.h);
        flood.setAttribute('flood-color', '#fff'); flood.setAttribute('flood-opacity', '1');
        flood.setAttribute('result', 'solid');
        const out = doc.createElementNS(NS, 'feComposite');
        out.setAttribute('in', 'solid'); out.setAttribute('in2', 'SourceGraphic');
        out.setAttribute('operator', 'out');
        filter.appendChild(flood); filter.appendChild(out); defs.appendChild(filter);

        const mask = doc.createElementNS(NS, 'mask');
        mask.setAttribute('id', mid);
        mask.setAttribute('maskUnits', 'userSpaceOnUse');
        mask.setAttribute('maskContentUnits', 'userSpaceOnUse');
        mask.setAttribute('x', box.x); mask.setAttribute('y', box.y);
        mask.setAttribute('width', box.w); mask.setAttribute('height', box.h);
        mask.setAttribute('mask-type', 'alpha'); mask.style.setProperty('mask-type', 'alpha');
        const shape = doc.createElementNS(NS, 'g');
        shape.setAttribute('filter', 'url(#' + fid + ')');
        appendWithWrappers(shape, wrappers, maskNode);
        makeOpaqueShape(shape);
        mask.appendChild(shape); defs.appendChild(mask);

        if (stage.childNodes.length) {
          const wrapped = doc.createElementNS(NS, 'g');
          wrapped.setAttribute('mask', 'url(#' + mid + ')');
          while (stage.firstChild) wrapped.appendChild(stage.firstChild);
          stage.appendChild(wrapped);
        }
      };

      const walk = function (el, wrappers) {
        const tag = tagOf(el);
        if (NON_DRAW.test(tag) || tag.indexOf('namedview') >= 0) return;
        if (isMaskElement(el)) { applyMask(el, wrappers); return; }
        if (tag === 'g' && hasDeepMask(el)) {
          const next = wrappers.concat(el);
          Array.prototype.slice.call(el.children || []).forEach(function (ch) { walk(ch, next); });
          return;
        }
        appendWithWrappers(stage, wrappers, el);
      };
      drawNodes.forEach(function (el) { walk(el, []); });
      return new XMLSerializer().serializeToString(doc);
    } catch (e) {
      console.warn('[thumb-core] 蒙版结构改写失败', String(e && e.message || e).slice(0, 180));
      return text;
    }
  }

  /* ---------- 把根 viewBox 放宽到「内容实际范围」 ----------
     为什么需要：软件导出的 svg 根节点固定是 Forza 画布约定
     `width=1920 height=1080 viewBox="-960 -540 1920 1080"`（保存成 .svg 时必须原样保留，
     Inkscape2Forza 依赖它），但画布上的图案完全可以超出这个框 —— 超出部分会被 viewport
     整块裁掉，光栅化后缩略图就成了「图案显示不完全」（2026-09-25 用户报障）。
     工作进程卡 / 锚点卡的缩略图走 App.thumbFrameToContent 放宽过，svg 卡片这条路没有，
     这里补上，让两条路遵循同一套取景规则。
     只在「内容确实超出根 viewBox」时改写；装得下就原样返回，不影响既有正常缩略图。 */
  function mulMat(A, B) {
    return [
      A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1],
      A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
      A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]
    ];
  }

  function applyMat(M, x, y) {
    return [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];
  }

  function parseTransformAttr(str) {
    let M = [1, 0, 0, 1, 0, 0];
    const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
    let m;
    while ((m = re.exec(String(str || '')))) {
      const v = m[2].replace(/,/g, ' ').trim().split(/\s+/).map(Number).filter(Number.isFinite);
      let T = null;
      if (m[1] === 'matrix' && v.length === 6) T = v.slice(0, 6);
      else if (m[1] === 'translate') T = [1, 0, 0, 1, v[0] || 0, v[1] || 0];
      else if (m[1] === 'scale') T = [v[0] === undefined ? 1 : v[0], 0, 0,
        v[1] === undefined ? (v[0] === undefined ? 1 : v[0]) : v[1], 0, 0];
      else if (m[1] === 'rotate') {
        const r = (v[0] || 0) * Math.PI / 180, ca = Math.cos(r), sa = Math.sin(r);
        T = [ca, sa, -sa, ca, 0, 0];
        if (v.length >= 3) {
          const cx = v[1] || 0, cy = v[2] || 0;
          T[4] = cx - cx * ca + cy * sa;
          T[5] = cy - cx * sa - cy * ca;
        }
      } else if (m[1] === 'skewX') T = [1, 0, Math.tan((v[0] || 0) * Math.PI / 180), 1, 0, 0];
      else if (m[1] === 'skewY') T = [1, Math.tan((v[0] || 0) * Math.PI / 180), 0, 1, 0, 0];
      if (T) M = mulMat(M, T);
    }
    return M;
  }

  function frameToContent(svgText) {
    const text = String(svgText || '');
    /* 只有「用 <use> 引用符号」这种结构才需要算（软件自己导出的都是这种）；
       其它结构原样返回，避免误伤外部 svg。 */
    if (!text || text.indexOf('<use') < 0) return text;
    try {
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      const root = doc.documentElement;
      if (!root || tagOf(root) !== 'svg' || root.querySelector('parsererror')) return text;
      const box = viewBoxOf(root);
      const symBox = {};
      Array.prototype.slice.call(root.querySelectorAll('symbol')).forEach(function (s) {
        const id = s.getAttribute('id');
        const vb = String(s.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
        if (id && vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) symBox[id] = vb;
      });
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const grow = function (M, bx) {
        [[bx[0], bx[1]], [bx[0] + bx[2], bx[1]], [bx[0], bx[1] + bx[3]], [bx[0] + bx[2], bx[1] + bx[3]]]
          .forEach(function (p) {
            const q = applyMat(M, p[0], p[1]);
            if (q[0] < x0) x0 = q[0];
            if (q[0] > x1) x1 = q[0];
            if (q[1] < y0) y0 = q[1];
            if (q[1] > y1) y1 = q[1];
          });
      };
      const walk = function (el, M) {
        const tag = tagOf(el);
        if (NON_DRAW.test(tag) || tag.indexOf('namedview') >= 0) return;
        const T = mulMat(M, parseTransformAttr(el.getAttribute && el.getAttribute('transform')));
        if (tag === 'g' || tag === 'svg') {
          Array.prototype.slice.call(el.children || []).forEach(function (ch) { walk(ch, T); });
          return;
        }
        if (tag === 'use') {
          const href = String(el.getAttribute('xlink:href') || el.getAttribute('href') || '').replace(/^#/, '');
          if (symBox[href]) grow(T, symBox[href]);
          return;
        }
        if (tag === 'image' || tag === 'rect') {
          const w = parseFloat(el.getAttribute('width')), h = parseFloat(el.getAttribute('height'));
          if (w > 0 && h > 0) {
            grow(T, [parseFloat(el.getAttribute('x')) || 0, parseFloat(el.getAttribute('y')) || 0, w, h]);
          }
        }
      };
      Array.prototype.slice.call(root.children || []).forEach(function (el) { walk(el, [1, 0, 0, 1, 0, 0]); });
      if (!(x1 > x0) || !(y1 > y0)) return text;
      const eps = Math.max(x1 - x0, y1 - y0) * 1e-4;
      if (x0 >= box.x - eps && y0 >= box.y - eps &&
          x1 <= box.x + box.w + eps && y1 <= box.y + box.h + eps) return text;  /* 装得下：不动 */
      const pad = Math.max(x1 - x0, y1 - y0) * 0.02;
      const nw = (x1 - x0) + 2 * pad, nh = (y1 - y0) + 2 * pad;
      root.setAttribute('viewBox', (x0 - pad) + ' ' + (y0 - pad) + ' ' + nw + ' ' + nh);
      root.setAttribute('width', String(Math.round(nw)));
      root.setAttribute('height', String(Math.round(nh)));
      return new XMLSerializer().serializeToString(doc);
    } catch (e) {
      console.warn('[thumb-core] 缩略图取景放宽失败', String(e && e.message || e).slice(0, 180));
      return text;
    }
  }

  function loadSvg(text) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }));
      const img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('SVG 光栅化失败')); };
      img.src = url;
    });
  }

  function contentBox(canvas, thresh, step, expand) {
    const g = canvas.getContext('2d', { willReadFrequently: true });
    const w = canvas.width, h = canvas.height;
    const d = g.getImageData(0, 0, w, h).data;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    const st = step || 2;
    for (let y = 0; y < h; y += st) {
      for (let x = 0; x < w; x += st) {
        if (d[(y * w + x) * 4 + 3] <= (thresh == null ? 8 : thresh)) continue;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) return null;
    if (expand !== 0) {
      const pad = st * Math.max(1, Number(expand) || 1);
      minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
      maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
    }
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  function canvasToBlob(canvas) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error('PNG 编码失败'));
      }, 'image/png');
    });
  }

  function nextFrame() {
    return new Promise(function (resolve) { requestAnimationFrame(function () { resolve(); }); });
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(reader.error || new Error('PNG 读取失败')); };
      reader.readAsDataURL(blob);
    });
  }

  async function rasterizeKnockout(svgText, maxSide) {
    if (!hasMasks(svgText)) return '';
    const img = await loadSvg(knockoutMasks(svgText));
    const side = maxSide || 1920;
    let scale = Math.min(side / img.naturalWidth, side / img.naturalHeight, 1);
    if (!(scale > 0)) scale = 1;
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    return blobToDataUrl(await canvasToBlob(canvas));
  }

  /* 把根 <svg> 的取景收到「栅格画布上的某个区域」，并把 width/height 声明成
     「长边 = longSidePx」。浏览器会按这个声明尺寸光栅化，于是内容能拿到与输出匹配的
     源像素 —— 用于「画稿只占 viewBox 一小部分」的文件：否则按整张画布光栅化时，
     内容拿到的源像素 = 画布像素 × 占比，最后再放大填满输出就必然发糊
     （实测极限竞速.1800.svg 占比 9.7% ⇒ 放大 5.16 倍）。
     取景本身不变（仍是内容盒），只提高光栅化分辨率。

     ★ box 是【栅格画布 canvasW×canvasH 上的像素坐标】，内部换算成用户单位。
     换算必须带上 viewBox 原点偏移 —— 画布原点不一定是 0 0。
     实测 线条.svg 的根 viewBox 是 `-960 -540 1920 1080`（不是 0 0）；
     同一份文件、同一个内容盒，传 `858 406 210 288` 烘出**空图**，
     传 `-102 -134 210 288` 正常（内容占重取景画布 98.7%）——
     即漏掉原点偏移会去取画面外的区域，这是 A/B 实测的，不是推断。 */
  function reframeRootAt(svgText, box, canvasW, canvasH, longSidePx) {
    try {
      const text = String(svgText || '');
      if (!text || !box) return '';
      if (!(box.w > 0) || !(box.h > 0) || !(canvasW > 0) || !(canvasH > 0) || !(longSidePx > 0)) return '';
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      const root = doc.documentElement;
      if (!root || tagOf(root) !== 'svg' || root.querySelector('parsererror')) return '';
      const vb = viewBoxOf(root);
      const kx = vb.w / canvasW, ky = vb.h / canvasH;
      const ux = vb.x + box.x * kx, uy = vb.y + box.y * ky;
      const uw = box.w * kx, uh = box.h * ky;
      if (!(uw > 0) || !(uh > 0) || !isFinite(ux) || !isFinite(uy)) return '';
      const k = longSidePx / Math.max(uw, uh);
      root.setAttribute('viewBox', ux + ' ' + uy + ' ' + uw + ' ' + uh);
      root.setAttribute('width', String(Math.max(1, Math.round(uw * k))));
      root.setAttribute('height', String(Math.max(1, Math.round(uh * k))));
      return new XMLSerializer().serializeToString(doc);
    } catch (e) {
      console.warn('[thumb-core] 按内容盒重取景失败', String(e && e.message || e).slice(0, 180));
      return '';
    }
  }

  async function renderCardBlob(svgText, outputSize) {
    const size = outputSize || 480;
    /* 先按内容框放宽根 viewBox（与工作进程卡/锚点卡同一套取景规则），再处理蒙版挖空 */
    const framed = frameToContent(svgText);
    let processed = hasMasks(framed) ? knockoutMasks(framed) : String(framed || '');
    const img = await loadSvg(processed);
    svgText = '';
    /* 960px 是 480px 成品的 2 倍抗锯齿采样。先画 1600px 再同步读回
       大画布的开销更大；这里既保住缩略图清晰度，也显著减少像素读回与内存压力。 */
    const ANALYSIS_SIDE = 960;
    let fullScale = Math.min(ANALYSIS_SIDE / img.naturalWidth, ANALYSIS_SIDE / img.naturalHeight, 1);
    if (!(fullScale > 0)) fullScale = 0.2;
    const fw = Math.max(1, Math.round(img.naturalWidth * fullScale));
    const fh = Math.max(1, Math.round(img.naturalHeight * fullScale));
    let full = document.createElement('canvas'); full.width = fw; full.height = fh;
    const fg = full.getContext('2d', { willReadFrequently: true });
    fg.drawImage(img, 0, 0, fw, fh);
    img.src = '';
    const solid = contentBox(full, 200, 1, 2);
    const box = solid || contentBox(full, 8, 1, 2);
    let sx = 0, sy = 0, sw = fw, sh = fh;
    if (box) {
      sx = Math.max(0, Math.min(box.x, fw - 1)); sy = Math.max(0, Math.min(box.y, fh - 1));
      sw = Math.max(1, Math.min(box.w, fw - sx)); sh = Math.max(1, Math.min(box.h, fh - sy));
    }
    /* ★ 上面这遍按【整张画布】光栅化：内容只拿到「画布边长 × 内容占比」个源像素。
       实测（极限竞速.1800.svg，viewBox 1920×1080，内容只占宽 9.8% / 高 14.3%）：
         修前 —— 内容盒 93×77px，contain 那步 dw/sw = 5.161（放大 5.16 倍），
                 成品梯度能量 5.69；
         补这一遍后 —— 内容盒 945×762px，dw/sw = 0.508（缩小），梯度能量 35.08（×6.17）。
       ⇒ 修前把 93px 的源拉成 480px，细节量只剩 1/6（这是实测，不是"放大就一定糊"的推断）。
       做法：把取景收到【内容盒】、让根 width/height 声明成「长边 = 输出 × 2」，
       内容直接拿到 2× 源像素（变成缩小而不是放大）。只在「内容长边 < 输出」时才做
       （= 会放大才做），本来就不放大的文件完全不动。取景口径不变
       （仍是内容盒 → 等比 contain 居中），所以不会溢出。 */
    if (Math.max(sw, sh) < size && processed) {
      const rewritten = reframeRootAt(processed, { x: sx, y: sy, w: sw, h: sh },
        fw, fh, Math.min(size * 2, 2048));
      if (rewritten) {
        try {
          const img2 = await loadSvg(rewritten);
          const w2 = Math.max(1, img2.naturalWidth), h2 = Math.max(1, img2.naturalHeight);
          const full2 = document.createElement('canvas'); full2.width = w2; full2.height = h2;
          const fg2 = full2.getContext('2d', { willReadFrequently: true });
          fg2.drawImage(img2, 0, 0, w2, h2);
          img2.src = '';
          const box2 = contentBox(full2, 200, 1, 2) || contentBox(full2, 8, 1, 2);
          let sx2 = 0, sy2 = 0, sw2 = w2, sh2 = h2;
          if (box2) {
            sx2 = Math.max(0, Math.min(box2.x, w2 - 1)); sy2 = Math.max(0, Math.min(box2.y, h2 - 1));
            sw2 = Math.max(1, Math.min(box2.w, w2 - sx2)); sh2 = Math.max(1, Math.min(box2.h, h2 - sy2));
          }
          full.width = 1; full.height = 1;      /* 释放第一遍那张大画布 */
          full = full2; sx = sx2; sy = sy2; sw = sw2; sh = sh2;
        } catch (e) {
          console.warn('[thumb-core] 内容盒重取景失败，退回整画布结果', String(e && e.message || e).slice(0, 180));
        }
      }
    }
    processed = '';
    const scale = Math.min(size / sw, size / sh);
    const longSide = Math.max(sw, sh);
    const dw = Math.max(1, Math.min(size, sw === longSide ? size : Math.floor(sw * scale)));
    const dh = Math.max(1, Math.min(size, sh === longSide ? size : Math.floor(sh * scale)));
    const dx = Math.floor((size - dw) / 2), dy = Math.floor((size - dh) / 2);
    const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = true;
    if (g.imageSmoothingQuality !== undefined) g.imageSmoothingQuality = 'high';
    g.drawImage(full, sx, sy, sw, sh, dx, dy, dw, dh);
    full.width = 1; full.height = 1;
    const blob = await canvasToBlob(canvas);
    canvas.width = 1; canvas.height = 1;
    /* 数千图层 SVG 的解码资源先在隐藏进程内释放，再通知主界面完成。
       否则 Chromium 会把清理推迟到缩略图出现后，抢占随后一次卡片交互。 */
    await nextFrame();
    await nextFrame();
    return blob;
  }

  async function renderCard(svgText, outputSize) {
    return blobToDataUrl(await renderCardBlob(svgText, outputSize));
  }

  global.SveThumbRenderer = { hasMasks, knockoutMasks, rasterizeKnockout, renderCard, renderCardBlob, frameToContent, reframeRootAt };
})(window);
