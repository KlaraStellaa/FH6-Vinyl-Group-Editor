'use strict';
(function (global) {
  const NS = 'http://www.w3.org/2000/svg';
  const NON_DRAW = /^(defs|title|desc|metadata|style|script|namedview)$/;

  function tagOf(el) {
    return String(el && (el.localName || el.nodeName) || '').toLowerCase();
  }

  function isMaskElement(el) {
    if (!el || !el.getAttribute) return false;
    const tag = tagOf(el);
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
          x1 <= box.x + box.w + eps && y1 <= box.y + box.h + eps) return text;
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

  async function renderCardBlob(svgText, outputSize) {
    const framed = frameToContent(svgText);
    let processed = hasMasks(framed) ? knockoutMasks(framed) : String(framed || '');
    const img = await loadSvg(processed);
    processed = '';
    svgText = '';
    const ANALYSIS_SIDE = 960;
    let fullScale = Math.min(ANALYSIS_SIDE / img.naturalWidth, ANALYSIS_SIDE / img.naturalHeight, 1);
    if (!(fullScale > 0)) fullScale = 0.2;
    const fw = Math.max(1, Math.round(img.naturalWidth * fullScale));
    const fh = Math.max(1, Math.round(img.naturalHeight * fullScale));
    const full = document.createElement('canvas'); full.width = fw; full.height = fh;
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
    const size = outputSize || 480;
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
    await nextFrame();
    await nextFrame();
    return blob;
  }

  async function renderCard(svgText, outputSize) {
    return blobToDataUrl(await renderCardBlob(svgText, outputSize));
  }

  global.SveThumbRenderer = { hasMasks, knockoutMasks, rasterizeKnockout, renderCard, renderCardBlob, frameToContent };
})(window);
