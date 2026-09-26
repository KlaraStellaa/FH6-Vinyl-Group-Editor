'use strict';

App.fzaSetCancel = function (ov, fn) { ov._fzaCancel = fn; };
function fzaOverlay() {
  let ov = document.getElementById('fzaOv');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'fzaOv';
    ov.className = 'confirm-overlay hidden';
    ov.innerHTML = '<div class="confirm-box fza-box"><div class="anchor-title"></div>' +
      '<div class="fza-body"></div></div>';
    document.body.appendChild(ov);
    const cancelNow = () => {
      if (typeof ov._fzaCancel === 'function') { ov._fzaCancel(); return; }
      App.hideOverlay(ov);
    };
    ov.addEventListener('click', e => { if (e.target === ov) cancelNow(); });
    App.attachDlgClose(ov.querySelector('.confirm-box'), () => { cancelNow(); });
  }
  return ov;
}
function fzaBox(ov) { return ov.querySelector('.confirm-box'); }
function fzaClearBox(ov, cls) {
  const box = fzaBox(ov);
  if (box) {
    Array.prototype.slice.call(box.children).forEach(c => {
      if (c.classList && c.classList.contains(cls)) c.remove();
    });
  }
  return box;
}
function fzaFoot(ov) { return fzaClearBox(ov, 'anchor-btns'); }
function fzaResetBox(ov) {
  const box = fzaBox(ov);
  if (box) {
    Array.prototype.slice.call(box.children).forEach(c => {
      if (!c.classList) return;
      if (c.classList.contains('anchor-btns') || c.classList.contains('fza-tools')) c.remove();
    });
  }
  const body = ov.querySelector('.fza-body');
  if (body) body.innerHTML = '';
  return body;
}
function fzaPick(title, items, rowHtml, promptMsg) {
  return new Promise(resolve => {
    const ov = fzaOverlay();
    const ovCancel = ov.querySelector('.fza-cancel');
    if (ovCancel) ovCancel.classList.add('hidden');
    ov.querySelector('.anchor-title').textContent = title;
    const body = fzaResetBox(ov);
    if (promptMsg) {
      const msg = document.createElement('div');
      msg.className = 'fza-msg';
      msg.textContent = promptMsg;
      body.appendChild(msg);
    }
    if (!items || !items.length) {
      const empty = document.createElement('div');
      empty.className = 'anchor-item';
      empty.textContent = App.i18n.t('fza.empty');
      body.appendChild(empty);
      const btns0 = document.createElement('div');
      btns0.className = 'anchor-btns';
      const no0 = document.createElement('button');
      no0.textContent = App.i18n.t('fza.cancel');
      const finishEmpty = () => { App.hideOverlay(ov); resolve(null); };
      no0.addEventListener('click', finishEmpty);
      App.fzaSetCancel(ov, finishEmpty);
      btns0.appendChild(no0);
      fzaFoot(ov).appendChild(btns0);
      App.showOverlay(ov);
      return;
    }
    let done = false;
    let selIdx = 0;
    const finish = v => { if (done) return; done = true; App.hideOverlay(ov); resolve(v); };
    App.fzaSetCancel(ov, () => finish(null));
    const rows = [];
    const paint = () => rows.forEach((r, i) => r.classList.toggle('sel', i === selIdx));
    items.forEach((it, idx) => {
      const row = document.createElement('div');
      row.className = 'anchor-item fza-row';
      const cell = rowHtml ? rowHtml(it, idx) : null;
      if (cell && cell.nodeType === 1) {
        row.appendChild(cell);
      } else {
        row.innerHTML = '<span class="anchor-name"></span>';
        row.querySelector('.anchor-name').textContent =
          String(cell != null ? cell : (it.label || it.title || it.folder || it));
      }
      row.addEventListener('click', () => { selIdx = idx; paint(); });
      rows.push(row);
      body.appendChild(row);
    });
    paint();
    const btns = document.createElement('div');
    btns.className = 'anchor-btns';
    const no = document.createElement('button');
    no.textContent = App.i18n.t('fza.cancel');
    no.addEventListener('click', () => finish(null));
    const yes = document.createElement('button');
    yes.textContent = App.i18n.t('fza.ok');
    yes.className = 'active';
    yes.addEventListener('click', () => finish(items[selIdx]));
    btns.appendChild(no);
    btns.appendChild(yes);
    fzaFoot(ov).appendChild(btns);
    App.showOverlay(ov);
  });
}
function fzaConfirm(title, message, okText) {
  return new Promise(resolve => {
    const ov = fzaOverlay();
    const ovCancel = ov.querySelector('.fza-cancel');
    if (ovCancel) ovCancel.classList.add('hidden');
    ov.querySelector('.anchor-title').textContent = title;
    const body = fzaResetBox(ov);
    const msg = document.createElement('div');
    msg.className = 'fza-msg';
    msg.textContent = message;
    body.appendChild(msg);
    const btns = document.createElement('div');
    btns.className = 'anchor-btns';
    const no = document.createElement('button');
    no.textContent = App.i18n.t('fza.cancel');
    const cancelConfirm = () => { App.hideOverlay(ov); resolve(false); };
    no.addEventListener('click', cancelConfirm);
    App.fzaSetCancel(ov, cancelConfirm);
    const yes = document.createElement('button');
    yes.textContent = okText || App.i18n.t('fza.cont');
    yes.className = 'active';
    yes.addEventListener('click', () => { App.hideOverlay(ov); resolve(true); });
    btns.appendChild(no);
    btns.appendChild(yes);
    fzaFoot(ov).appendChild(btns);
    App.showOverlay(ov);
  });
}
function fzaPrompt(title, message, def) {
  return new Promise(resolve => {
    const ov = fzaOverlay();
    const ovCancel = ov.querySelector('.fza-cancel');
    if (ovCancel) ovCancel.classList.add('hidden');
    ov.querySelector('.anchor-title').textContent = title;
    const body = fzaResetBox(ov);
    const msg = document.createElement('div');
    msg.className = 'fza-msg';
    msg.textContent = message;
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.min = '0';
    inp.max = '255';
    inp.step = '1';
    inp.value = String(def === undefined ? 0 : def);
    body.appendChild(msg);
    body.appendChild(inp);
    const btns = document.createElement('div');
    btns.className = 'anchor-btns';
    const no = document.createElement('button');
    no.textContent = App.i18n.t('fza.cancel');
    const cancelPrompt = () => { App.hideOverlay(ov); resolve(null); };
    no.addEventListener('click', cancelPrompt);
    App.fzaSetCancel(ov, cancelPrompt);
    const yes = document.createElement('button');
    yes.textContent = App.i18n.t('fza.ok');
    yes.className = 'active';
    yes.addEventListener('click', () => { App.hideOverlay(ov); resolve(parseInt(inp.value, 10)); });
    btns.appendChild(no);
    btns.appendChild(yes);
    fzaFoot(ov).appendChild(btns);
    App.showOverlay(ov);
    setTimeout(() => inp.focus(), 50);
  });
}
function fzaTextPrompt(title, message, def) {
  return new Promise(resolve => {
    const ov = fzaOverlay();
    const ovCancel = ov.querySelector('.fza-cancel');
    if (ovCancel) ovCancel.classList.add('hidden');
    ov.querySelector('.anchor-title').textContent = title;
    const body = fzaResetBox(ov);
    const msg = document.createElement('div');
    msg.className = 'fza-msg';
    msg.textContent = message;
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = String(def === undefined || def == null ? '' : def);
    body.appendChild(msg);
    body.appendChild(inp);
    const btns = document.createElement('div');
    btns.className = 'anchor-btns';
    const no = document.createElement('button');
    no.textContent = App.i18n.t('fza.cancel');
    const cancelText = () => { App.hideOverlay(ov); resolve(null); };
    no.addEventListener('click', cancelText);
    App.fzaSetCancel(ov, cancelText);
    const yes = document.createElement('button');
    yes.textContent = App.i18n.t('fza.ok');
    yes.className = 'active';
    yes.addEventListener('click', () => { App.hideOverlay(ov); resolve(inp.value.trim() || String(def === undefined || def == null ? '' : def)); });
    btns.appendChild(no);
    btns.appendChild(yes);
    fzaFoot(ov).appendChild(btns);
    App.showOverlay(ov);
    setTimeout(() => { inp.focus(); inp.select(); }, 50);
  });
}
App.fzaTextPrompt = fzaTextPrompt;
App.fzaSvgThumbCache = new Map(); // name -> dataURL
App.fzaSvgThumbInflight = new Map();
function fzaThumbContentBox(canvas, thresh, step, expand) {
  const g = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const d = g.getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  const st = step || 2;
  for (let y = 0; y < h; y += st) {
    for (let x = 0; x < w; x += st) {
      if (d[(y * w + x) * 4 + 3] > (thresh == null ? 8 : thresh)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  if (expand !== 0) {
    minX = Math.max(0, minX - st); minY = Math.max(0, minY - st);
    maxX = Math.min(w - 1, maxX + st); maxY = Math.min(h - 1, maxY + st);
  }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}
App.fzaSvgThumb = function (name, text, ver) {
  const key = ver ? name + '@' + ver : name;
  if (App.fzaSvgThumbCache.has(key)) return Promise.resolve(App.fzaSvgThumbCache.get(key));
  if (App.fzaSvgThumbInflight.has(key)) return App.fzaSvgThumbInflight.get(key);
  const p = (async function () {
    try {
      let durl = '';
      if (window.sveApi && typeof window.sveApi.svgThumbRender === 'function') {
        const result = await window.sveApi.svgThumbRender(String(text || ''));
        if (result && result.ok) durl = result.url || '';
        else if (result && result.error) console.warn('[fzaSvgThumb] 独立进程生成失败', result.error);
      } else if (window.SveThumbRenderer) {
        durl = await window.SveThumbRenderer.renderCard(String(text || ''), 480);
      }
      if (durl) App.fzaSvgThumbCache.set(key, durl);
      return durl;
    } catch (e) {
      console.warn('[fzaSvgThumb] 生成失败', String(e && e.message || e).slice(0, 180));
      return '';
    } finally {
      App.fzaSvgThumbInflight.delete(key);
    }
  })();
  App.fzaSvgThumbInflight.set(key, p);
  return p;
};
App.fzaComputeThumbDataUrl = async function (root) {
  try {
    if (!root || !(root.children || []).length) return null;
    let { str } = App.FZA.svgStringFromModel(root);
    const TR = window.SveThumbRenderer;
    if (TR && typeof TR.frameToContent === 'function') str = TR.frameToContent(str);
    const rasterUrl = (App.thumbSvgHasMasks && App.thumbSvgHasMasks(str) && App.thumbKnockoutRaster)
      ? await App.thumbKnockoutRaster(str) : '';
    const url = rasterUrl || ('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str));
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('svg render')); img.src = url; });
    const W = img.naturalWidth || 1920, H = img.naturalHeight || 1080;
    const full = document.createElement('canvas');
    full.width = W; full.height = H;
    const fg = full.getContext('2d', { willReadFrequently: true });
    fg.drawImage(img, 0, 0, W, H);
    const boxOf = (thresh) => {
      const d = fg.getImageData(0, 0, W, H).data;
      let minX = W, minY = H, maxX = -1, maxY = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (d[(y * W + x) * 4 + 3] <= thresh) continue;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      if (maxX < 0) return null;
      return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    };
    let box = boxOf(200) || boxOf(8);
    if (!box) return null;
    const PAD = 2;
    const bx = Math.max(0, box.x - PAD), by = Math.max(0, box.y - PAD);
    box = { x: bx, y: by, w: Math.min(W - bx, box.w + PAD * 2), h: Math.min(H - by, box.h + PAD * 2) };
    const SIZE = 256;
    const sc = Math.min(SIZE / box.w, SIZE / box.h);
    const dw = Math.max(1, Math.min(SIZE, Math.floor(box.w * sc)));
    const dh = Math.max(1, Math.min(SIZE, Math.floor(box.h * sc)));
    const dx = Math.floor((SIZE - dw) / 2), dy = Math.floor((SIZE - dh) / 2);
    const c = document.createElement('canvas');
    c.width = SIZE; c.height = SIZE;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    if (g.imageSmoothingQuality !== undefined) g.imageSmoothingQuality = 'high';
    g.drawImage(full, box.x, box.y, box.w, box.h, dx, dy, dw, dh);
    const w = c.toDataURL('image/webp', 0.95);
    return w.indexOf('data:image/webp') === 0 ? w : c.toDataURL('image/png');
  } catch (e) { console.warn('[fzaComputeThumbDataUrl] 生成失败：', e && e.message); return null; }
};

let _fzaTitleSync = null;
if (App.i18n && typeof App.i18n.onApply === 'function') {
  App.i18n.onApply(() => { if (_fzaTitleSync) { try { _fzaTitleSync(); } catch (e) { } } });
}
function mountMultiToggle(ov, api, startMulti) {
  const titleEl = ov.querySelector('.anchor-title');
  const baseTitle = String(titleEl.getAttribute('data-title') || titleEl.textContent || '');
  titleEl.textContent = '';
  const textNode = document.createTextNode(baseTitle);
  titleEl.appendChild(textNode);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'fza-multi';
  btn.textContent = App.i18n.t('fza.multi');
  titleEl.appendChild(btn);
  let multi = !!startMulti;
  const syncTitle = () => {
    if (!textNode.isConnected) { if (_fzaTitleSync === syncTitle) _fzaTitleSync = null; return; }
    textNode.nodeValue = baseTitle + (multi ? App.i18n.tf('fza.multiCount', { n: api.count() }) : '');
  };
  _fzaTitleSync = syncTitle;
  api.onChange = syncTitle;
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    multi = !multi;
    api.setMulti(multi);
    btn.classList.toggle('active', multi);
    syncTitle();
  });
  if (multi) api.setMulti(true);
  btn.classList.toggle('active', multi);
  syncTitle();
  return { isMulti: () => multi, syncTitle };
}
﻿function buildSvgLibraryOverlay(multi, onTexts, opts) {
  opts = opts || {};
  return new Promise(async resolve => {
    const ov = fzaOverlay();
    const titleEl = ov.querySelector('.anchor-title');
    const baseTitle = opts.title || (multi ? App.i18n.t('fza.pickSvgInject') : App.i18n.t('fza.pickSvgOpen'));
    const applyTitle = () => {
      titleEl.textContent = baseTitle;
      titleEl.setAttribute('data-title', baseTitle);
    };
    const old = titleEl.querySelector('.fza-multi');
    if (old) old.remove();
    applyTitle();
    const body = fzaResetBox(ov);
    let done = false;
    let settled = false;
    let busy = false;
    let importBtn = null;
    let thumbObserver = null;
    let visibleThumbQueue = [];
    let visibleThumbBusy = false;
    let renderEpoch = 0;
    const resetThumbWork = () => {
      renderEpoch++;
      if (thumbObserver) { thumbObserver.disconnect(); thumbObserver = null; }
      visibleThumbQueue.forEach(job => App.finishThumbLoading(job.box, job.loader));
      visibleThumbQueue = [];
    };
    const close = () => {
      if (done) return;
      done = true;
      resetThumbWork();
      App.hideOverlay(ov);
    };
    const finish = (v, texts) => {
      if (settled) return;
      settled = true;
      close();
      onTexts(texts || []);
      resolve(v);
    };
    App.fzaSetCancel(ov, () => finish(null));
    let rows = [];
    let selected = multi ? [] : null;
    let api = null;
    let selSingle = null;
    let yesBtn = null;
    const inMultiNow = () => !!(multi && api && api.isMulti());
    const paint = () => {
      rows.forEach(r => {
        const on = inMultiNow()
          ? (selected === null ? false : selected.indexOf(r.it) >= 0)
          : (selSingle === r.it);
        r.el.classList.toggle('sel', on);
        const mk = r.el.querySelector('.fza-check');
        if (mk) mk.style.display = on ? '' : 'none';
      });
      if (yesBtn) {
        yesBtn.disabled = busy ? true
          : (inMultiNow() ? !(selected && selected.length > 0) : !selSingle);
      }
      if (importBtn) importBtn.disabled = busy;
      const mt = ov.querySelector('.fza-multi');
      if (mt) mt.disabled = busy;
    };
    const box = fzaBox(ov);
    const tools = document.createElement('div');
    tools.className = 'fza-tools';
    box.insertBefore(tools, body);
    importBtn = document.createElement('button');
    importBtn.textContent = App.i18n.t('fza.importFile');
    importBtn.className = 'active';
    importBtn.addEventListener('click', () => {
      if (busy) return;
      close();
      pickSvgFile()
        .then(text => finish(text ? 'single' : null, text ? [text] : []))
        .catch(e => { console.warn('[picker] 导入 SVG 文件失败', String(e && e.message || e).slice(0, 160)); finish(null); });
    });
    tools.appendChild(importBtn);
    const list = document.createElement('div');
    list.className = 'fza-svg-list';
    body.appendChild(list);
    const pumpVisibleThumbs = () => {
      if (visibleThumbBusy || !visibleThumbQueue.length || done) return;
      const job = visibleThumbQueue.shift();
      if (!job || job.epoch !== renderEpoch || !job.row.isConnected) {
        if (job) App.finishThumbLoading(job.box, job.loader);
        pumpVisibleThumbs();
        return;
      }
      visibleThumbBusy = true;
      Promise.resolve().then(() => job.run(job.loader)).catch(e => {
        console.warn(job.warnLabel || '[picker] 缩略图生成失败', String(e && e.message || e).slice(0, 180));
      }).finally(() => {
        App.finishThumbLoading(job.box, job.loader);
        visibleThumbBusy = false;
        pumpVisibleThumbs();
      });
    };
    const enqueueVisibleThumb = (row, box, run, warnLabel, epoch) => {
      if (!row || row.dataset.thumbQueued === '1' || epoch !== renderEpoch || done) return;
      row.dataset.thumbQueued = '1';
      const loader = App.startThumbLoading(box);
      visibleThumbQueue.push({ row, box, run, warnLabel, epoch, loader });
      pumpVisibleThumbs();
    };
    const observeVisibleThumb = (row, box, run, warnLabel) => {
      const epoch = renderEpoch;
      row.__sveThumbStart = () => enqueueVisibleThumb(row, box, run, warnLabel, epoch);
      if (typeof IntersectionObserver !== 'function') { row.__sveThumbStart(); return; }
      if (!thumbObserver) {
        const observer = new IntersectionObserver(entries => {
          entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            observer.unobserve(entry.target);
            if (entry.target.__sveThumbStart) entry.target.__sveThumbStart();
          });
        }, { root: list, rootMargin: '180px' });
        thumbObserver = observer;
      }
      thumbObserver.observe(row);
    };
    const _ovc = ov.querySelector('.fza-cancel');
    if (_ovc) _ovc.onclick = () => finish(null);
    const btns = document.createElement('div');
    btns.className = 'anchor-btns';
    const no = document.createElement('button');
    no.textContent = App.i18n.t('fza.cancel');
    no.addEventListener('click', () => finish(null));
    const resolveTexts = async (items) => {
      const texts = [];
      for (const it of items) {
        const rd = await window.sveApi.fileRead('svg', it.name);
        const txt = rd && rd.ok && typeof rd.content === 'string' ? rd.content : null;
        if (!txt || !txt.trim()) {
          return { texts: null, failName: it.name, why: (rd && rd.error) || App.i18n.t('toast.fza.readFileFail') };
        }
        texts.push(txt);
      }
      return { texts: texts, failName: null, why: null };
    };
    const commitPicked = async () => {
      if (busy || settled) return;
      const items = inMultiNow() ? (selected || []).slice() : (selSingle ? [selSingle] : []);
      if (!items.length) return;
      const wasMulti = inMultiNow();
      busy = true;
      paint();
      try {
        const r = await resolveTexts(items);
        if (settled) return;
        if (!r.texts) {
          busy = false;
          paint();
          showToast(App.i18n.tf('toast.fza.readSvgFail', { name: r.failName, why: r.why }), 6000);
          return;
        }
        finish(wasMulti ? 'multi' : 'single', r.texts);
      } catch (e) {
        if (settled) return;
        busy = false;
        paint();
        const why = String(e && e.message || e).slice(0, 120);
        console.warn('[picker] 确认后读取失败', why);
        showToast(App.i18n.tf('toast.fza.readSvgFail', { name: '', why: why }), 6000);
      }
    };
    const yes = document.createElement('button');
    yes.textContent = App.i18n.t('fza.ok');
    yes.className = 'active';
    yes.disabled = true;
    yesBtn = yes;
    yes.addEventListener('click', () => {
      commitPicked();
    });
    btns.appendChild(no);
    btns.appendChild(yes);
    fzaFoot(ov).appendChild(btns);
    if (multi) {
      api = mountMultiToggle(ov, {
        count: () => (selected ? selected.length : 0),
        setMulti: on => { if (busy) return; selected = on ? [] : null; paint(); }
      });
      const undoBtn = document.createElement('button');
      undoBtn.type = 'button';
      undoBtn.className = 'fza-undo';
      undoBtn.textContent = App.i18n.t('fza.undo');
      undoBtn.addEventListener('click', () => {
        if (undoBtn.disabled) return;
        undoBtn.disabled = true;
        Promise.resolve(App.fzaRunUndo()).catch(e => {
          console.warn('[undo] 撤销流程异常', String(e && e.message || e).slice(0, 160));
        }).finally(() => { undoBtn.disabled = false; });
      });
      const mtBtn = titleEl.querySelector('.fza-multi');
      if (mtBtn) {
        const bar = document.createElement('span');
        bar.className = 'fza-tbar';
        titleEl.appendChild(bar);
        bar.appendChild(undoBtn);
        bar.appendChild(mtBtn);
      } else {
        titleEl.appendChild(undoBtn);
      }
    }
    const showEmpty = txt => {
      const d = document.createElement('div');
      d.className = 'fza-empty';
      d.textContent = txt;
      list.appendChild(d);
    };
    const thumbRow = () => {
      const row = document.createElement('div');
      row.className = 'anchor-item fza-row';
      const box = document.createElement('span');
      box.className = 'fza-thumb-box';
      const img = document.createElement('img');
      img.className = 'fza-thumb';
      img.alt = '';
      const fb = document.createElement('span');
      fb.className = 'fza-thumb-fallback';
      fb.textContent = '◇';
      box.appendChild(fb);
      box.appendChild(img);
      const nameEl = document.createElement('span');
      nameEl.className = 'anchor-name';
      row.appendChild(box);
      row.appendChild(nameEl);
      return { row: row, box: box, img: img, fb: fb, nameEl: nameEl };
    };
    const addCheck = row => {
      if (!multi) return;
      const mark = document.createElement('span');
      mark.className = 'fza-check';
      mark.setAttribute('data-check', '1');
      mark.textContent = '✓';
      mark.style.display = 'none';
      row.appendChild(mark);
    };
    const renderSoft = async () => {
      const r = await window.sveApi.fileRecent();
      const items = (r && r.ok ? r.items : []).filter(i => i.type === 'svg');
      if (!items.length) { showEmpty(App.i18n.tf('fza.emptyNoSvg', { v: App.i18n.t('dlg.importFile') })); return; }
      items.forEach(it => {
        const t = thumbRow();
        t.nameEl.textContent = it.name;
        addCheck(t.row);
        observeVisibleThumb(t.row, t.box, async loader => {
          let url = '';
          if (typeof window.sveApi.svgThumbFile === 'function') {
            const tr = await window.sveApi.svgThumbFile(it.name);
            if (!tr || !tr.ok) throw new Error((tr && tr.error) || App.i18n.t('fza.thumbGenFail'));
            url = tr.url || '';
          } else {
            const rd = await window.sveApi.fileRead('svg', it.name);
            if (!rd || !rd.ok) throw new Error((rd && rd.error) || App.i18n.t('fza.svgReadFail'));
            url = await App.fzaSvgThumb(it.name, rd.content, it.mtime);
          }
          const loaded = url && t.img.isConnected
            ? await App.showThumbImage(t.box, t.img, url, loader) : false;
          if (loaded && t.img.isConnected) {
            t.img.classList.add('loaded');
            t.fb.style.display = 'none';
          }
        }, '[picker] SVG 缩略图生成失败：' + it.name);
        rows.push({ it: it, el: t.row });
        t.        row.addEventListener('click', () => {
          if (busy) return;
          if (multi && api && api.isMulti()) {
            const i = selected.indexOf(it);
            if (i >= 0) selected.splice(i, 1); else selected.push(it);
            paint();
            api.syncTitle();
            return;
          }
          selSingle = it;
          paint();
        });
        list.appendChild(t.row);
      });
    };
    const render = async () => {
      resetThumbWork();
      list.innerHTML = '';
      rows = [];
      await renderSoft();
    };
    await render();
    App.showOverlay(ov);
  });
}

App.fzaPickSvgLibrary = function () {
  return new Promise(resolve => {
    buildSvgLibraryOverlay(false, texts => resolve(texts[0] || null),
      { title: App.i18n.t('fza.pickSvgOpen') }).then(v => { if (v === null) resolve(null); });
  });
};

function pickSvgFile() {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.svg,image/svg+xml';
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0];
      if (!f) { resolve(null); return; }
      const rd = new FileReader();
      rd.onload = () => resolve(String(rd.result || ''));
      rd.onerror = () => { showToast(App.i18n.t('toast.fza.readFileFail')); resolve(null); };
      rd.readAsText(f);
      setTimeout(() => inp.remove(), 1000);
    });
    inp.addEventListener('cancel', () => resolve(null));
    inp.click();
  });
}

App.fzaImportSvg = function (svg, from) {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (!doc.documentElement || doc.documentElement.getElementsByTagName('parsererror').length) {
    showToast(App.i18n.tf('toast.fza.convertFail', { v: from }));
    return;
  }
  fzaEnsureDocForImport(from);
  App.importForza(doc.documentElement);
};
