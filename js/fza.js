'use strict';
/* Forza 游戏存档整合 UI（Inkscape2Forza 功能，操作语义照搬原软件）：
   游戏菜单：导入 Geometrize JSON / 导入 Vinylizer JSON / 导出 SVG 到游戏存档(注入) /
   从游戏存档导入 SVG(解码) / 备份当前账户存档。
   注入前必须经覆盖确认；注入后提示回游戏重新保存刷新。 */

/* ---------- 通用弹层 ---------- */
/* 各弹层函数在 showOverlay 之前用 App.fzaSetCancel 登记「× 与遮罩点击共用的取消动作」，
   保证 × 和点窗外走的是同一条收尾路径（该 resolve(null) 的 resolve、该回滚的回滚），
   不会出现「点 × 关掉了窗但 Promise 永远挂着」的悬挂态。 */
App.fzaSetCancel = function (ov, fn) { ov._fzaCancel = fn; };
function fzaOverlay() {
  let ov = document.getElementById('fzaOv');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'fzaOv';
    ov.className = 'confirm-overlay hidden';
    ov.innerHTML = '<div class="confirm-box fza-box"><div class="anchor-title"></div>' +
      '<div class="fza-body"></div><div class="anchor-btns"><button class="fza-cancel">取消</button></div></div>';
    document.body.appendChild(ov);
    /* 遮罩点击与右上角 × 共用一个取消动作（没登记时退化为纯隐藏） */
    const cancelNow = () => {
      if (typeof ov._fzaCancel === 'function') { ov._fzaCancel(); return; }
      App.hideOverlay(ov);
    };
    ov.addEventListener('click', e => { if (e.target === ov) cancelNow(); });
    ov.querySelector('.fza-cancel').addEventListener('click', () => cancelNow());
    App.attachDlgClose(ov.querySelector('.confirm-box'), () => { cancelNow(); });
  }
  return ov;
}
/* 通用列表选择（对齐官方 ChoiceDialog：标题栏 + 提示语 + 默认选中第一项(高亮) + 确定/取消） */
function fzaPick(title, items, rowHtml, promptMsg) {
  return new Promise(resolve => {
    const ov = fzaOverlay();
    const ovCancel = ov.querySelector('.fza-cancel');
    if (ovCancel) ovCancel.classList.add('hidden'); // 本函数自带 取消/确定
    ov.querySelector('.anchor-title').textContent = title;
    const body = ov.querySelector('.fza-body');
    body.innerHTML = '';
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
      body.appendChild(btns0);
      App.showOverlay(ov);
      return;
    }
    let done = false;
    let selIdx = 0; // 默认选中第一项（同官方）
    const finish = v => { if (done) return; done = true; App.hideOverlay(ov); resolve(v); };
    App.fzaSetCancel(ov, () => finish(null));
    const rows = [];
    const paint = () => rows.forEach((r, i) => r.classList.toggle('sel', i === selIdx));
    items.forEach((it, idx) => {
      const row = document.createElement('div');
      row.className = 'anchor-item fza-row';
      const cell = rowHtml ? rowHtml(it, idx) : null;
      /* rowHtml 可能返回 DOM 元素（缩略图行）或字符串：元素必须 appendChild，
         直接 innerHTML=元素会被强转为 "[object HTMLSpanElement]" 而丢失子结构 */
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
    body.appendChild(btns);
    App.showOverlay(ov);
  });
}
function fzaConfirm(title, message, okText) {
  return new Promise(resolve => {
    const ov = fzaOverlay();
    const ovCancel = ov.querySelector('.fza-cancel');
    if (ovCancel) ovCancel.classList.add('hidden'); // 本函数自带 取消/继续，隐藏遮罩层多余的取消
    ov.querySelector('.anchor-title').textContent = title;
    const body = ov.querySelector('.fza-body');
    body.innerHTML = '';
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
    body.appendChild(btns);
    App.showOverlay(ov);
  });
}
function fzaPrompt(title, message, def) {
  return new Promise(resolve => {
    const ov = fzaOverlay();
    const ovCancel = ov.querySelector('.fza-cancel');
    if (ovCancel) ovCancel.classList.add('hidden'); // 本函数自带 取消/确定，隐藏遮罩层多余的取消
    ov.querySelector('.anchor-title').textContent = title;
    const body = ov.querySelector('.fza-body');
    body.innerHTML = '';
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
    body.appendChild(btns);
    App.showOverlay(ov);
    setTimeout(() => inp.focus(), 50);
  });
}
/* 文本输入弹框(重命名/命名保存用):取消=null;确定=输入值(空则默认值) */
function fzaTextPrompt(title, message, def) {
  return new Promise(resolve => {
    const ov = fzaOverlay();
    const ovCancel = ov.querySelector('.fza-cancel');
    if (ovCancel) ovCancel.classList.add('hidden');
    ov.querySelector('.anchor-title').textContent = title;
    const body = ov.querySelector('.fza-body');
    body.innerHTML = '';
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
    body.appendChild(btns);
    App.showOverlay(ov);
    setTimeout(() => { inp.focus(); inp.select(); }, 50);
  });
}
App.fzaTextPrompt = fzaTextPrompt;
/* ---------- 软件内 SVG 库选择器（完整缩略图 + 「导入 SVG 文件…」按钮） ---------- */
App.fzaSvgThumbCache = new Map(); // name -> dataURL
App.fzaSvgThumbInflight = new Map();
/* 计算画布中非透明内容的包围盒（alpha>阈值，步进采样控制成本）
   expand：是否向外扩一个步长（步进采样时防止漏掉边界，默认扩；传 0 表示不扩） */
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
  /* 步进采样可能漏边界：向外扩一个步长保证不裁到内容（expand=0 时不扩） */
  if (expand !== 0) {
    minX = Math.max(0, minX - st); minY = Math.max(0, minY - st);
    maxX = Math.min(w - 1, maxX + st); maxY = Math.min(h - 1, maxY + st);
  }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}
App.fzaSvgThumb = function (name, text, ver) {
  /* ver：文件 mtime 等版本号；带上它后同名文件重新保存会重新渲染，避免主页卡片显示旧缩略图 */
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
/* 按游戏同款规则计算组缩略图(替代游戏端保存生成的 thumb.webp)：
   模型 -> 官方格式 SVG(svgStringFromModel) -> 1920x1080 光栅化 -> 内容盒裁剪
   -> 等比适配居中到 256x256(透明底,放大无上限) -> webp。
   蒙版形状在 v1 中按官方导出样式(指示图案)渲染;色调/α 与游戏一致。 */
App.fzaComputeThumbDataUrl = async function (root) {
  try {
    if (!root || !(root.children || []).length) return null;
    const { str } = App.FZA.svgStringFromModel(root);
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
    /* 内容盒 = 渲染像素并集(α>0)——与游戏 thumb 生成规则一致(034647/005738 双文件实测验证) */
    const d = fg.getImageData(0, 0, W, H).data;
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (d[(y * W + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    if (maxX < 0) return null;
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    const sc = Math.min(256 / bw, 256 / bh); /* contain:等比缩放取小值,短边留白居中(游戏规则;cover 会溢出画布) */
    const dw = Math.max(1, Math.round(bw * sc)), dh = Math.max(1, Math.round(bh * sc));
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const g = c.getContext('2d');
    if (rasterUrl) {
      g.drawImage(full, minX, minY, bw, bh, (256 - dw) / 2, (256 - dh) / 2, dw, dh);
      const masked = c.toDataURL('image/webp', 0.95);
      return masked.indexOf('data:image/webp') === 0 ? masked : c.toDataURL('image/png');
    }
    /* 无蒙版时保持单遍渲染：裁剪 viewBox 后直接按最终尺寸光栅化。 */
    const str2 = str
      .replace(/viewBox="[^"]*"/, 'viewBox="' + minX + ' ' + minY + ' ' + bw + ' ' + bh + '"')
      .replace(/width="[^"]*"/, 'width="' + dw + '"')
      .replace(/height="[^"]*"/, 'height="' + dh + '"');
    const url2 = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str2);
    const img2 = new Image();
    await new Promise((res, rej) => { img2.onload = res; img2.onerror = () => rej(new Error('svg render2')); img2.src = url2; });
    g.drawImage(img2, (256 - dw) / 2, (256 - dh) / 2, dw, dh);
    const w = c.toDataURL('image/webp', 0.95); // Chromium 仅有损 webp(VP8+ALPH);游戏本体保存会用自己的 VP8L 再生成
    return w.indexOf('data:image/webp') === 0 ? w : c.toDataURL('image/png');
  } catch (e) { console.warn('[fzaComputeThumbDataUrl] 生成失败：', e && e.message); return null; }
};

/* ---------- 选择窗「多选」按键（两个选择窗共用） ----------
   规程：点「多选」进入多选（同时把标题包成「已选 N 项」并清空当前单选高亮）；
   多选态单击行 = 切换该行高亮（不互斥），点「确定」返回所选集合；
   再点「多选」退出并清空全部高亮，回到单选（默认第一项高亮）。 */
function mountMultiToggle(ov, api) {
  const titleEl = ov.querySelector('.anchor-title');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'fza-multi';
  btn.textContent = App.i18n.t('fza.multi');
  titleEl.appendChild(btn);
  /* 标题文字与「多选」键共存：正文单独一个文本节点，改它不会清掉按钮 */
  const textNode = document.createTextNode(String(titleEl.getAttribute('data-title') || titleEl.textContent || ''));
  titleEl.insertBefore(textNode, titleEl.firstChild);
  let multi = false;
  const syncTitle = () => {
    textNode.nodeValue = (titleEl.getAttribute('data-title') || '') + (multi ? '（已选 ' + api.count() + ' 项）' : '');
  };
  api.onChange = syncTitle;
  btn.addEventListener('click', () => {
    multi = !multi;
    api.setMulti(multi);
    btn.classList.toggle('active', multi);
    syncTitle();
  });
  syncTitle();
  return { isMulti: () => multi, syncTitle };
}
/* 把一个基础选择器升级成"可多选、集合返回"的选择器：resolve 数组，取消为 null */
/* 构建"软件内 SVG 库"弹层；multi=false 时沿用旧行为（点行即选中并关窗），true 时按多选规程。
   结果统一由 onTexts 回调返回文本数组（取消=[]）；resolve 值 = 'multi' | 'single' | null(取消) */
﻿function buildSvgLibraryOverlay(multi, onTexts, opts) {
  opts = opts || {};
  return new Promise(async resolve => {
    /* 不预先启动隐藏 renderer：先建立选择窗和加载动画，首个可视行任务
       自己负责启动 renderer，并由队列串行执行，避免打开弹窗时发生空白等待。 */
    const ov = fzaOverlay();
    const titleEl = ov.querySelector('.anchor-title');
    const baseTitle = opts.title || (multi ? App.i18n.t('fza.pickSvgInject') : App.i18n.t('fza.pickSvgOpen'));
    /* 列表来源（用户 2026-09-11 要求拆分两个窗口）：
       'recent'  = SVG图像目录（软件内彩绘，与主页/「+」栏一致）
       'palette' = 编辑器内「已保存的彩绘」列表（注入存档窗口专用） */
    const applyTitle = () => {
      /* 标题不带来源括号说明（用户要求删掉）：来源由上方切换条的选中态表达 */
      titleEl.textContent = baseTitle;
      titleEl.setAttribute('data-title', baseTitle);
    };
    const old = titleEl.querySelector('.fza-multi');
    if (old) old.remove();
    applyTitle();
    const body = ov.querySelector('.fza-body');
    body.innerHTML = '';
    let done = false;
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
    App.fzaSetCancel(ov, close);
    let rows = [];
    let selected = multi ? [] : null;
    let api = null;
    const paint = () => rows.forEach(r => {
      const on = selected === null ? false : (multi ? selected.indexOf(r.it) >= 0 : false);
      r.el.classList.toggle('sel', on);
      const mk = r.el.querySelector('.fza-check');
      if (mk) mk.style.display = on ? '' : 'none';
    });
    const importBtn = document.createElement('button');
    importBtn.textContent = App.i18n.t('fza.importFile');
    importBtn.className = 'active';
    importBtn.addEventListener('click', () => {
      close();
      pickSvgFile().then(text => { if (text !== null) onTexts([text]); });
    });
    body.appendChild(importBtn);
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
    ov.querySelector('.fza-cancel').onclick = () => { close(); resolve(null); };
    const finishMulti = () => {
      const picked = (selected || []).slice();
      close();
      onTexts(picked);
      resolve(picked.length ? 'multi' : null);
    };
    const btns = document.createElement('div');
    btns.className = 'anchor-btns';
    const no = document.createElement('button');
    no.textContent = App.i18n.t('fza.cancel');
    no.addEventListener('click', () => { close(); resolve(null); });
    const yes = document.createElement('button');
    yes.textContent = App.i18n.t('fza.ok');
    yes.className = 'active';
    if (multi) {
      yes.addEventListener('click', finishMulti);
      btns.appendChild(no);
      btns.appendChild(yes);
      body.appendChild(btns);
      api = mountMultiToggle(ov, {
        count: () => (selected ? selected.length : 0),
        setMulti: on => { selected = on ? [] : null; paint(); }
      });
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
      if (!items.length) { showEmpty('SVG图像目录暂无文件，可点上方「导入 SVG 文件…」选择本地文件'); return; }
      items.forEach(it => {
        const t = thumbRow();
        t.nameEl.textContent = it.name;
        addCheck(t.row);
        observeVisibleThumb(t.row, t.box, async loader => {
          let url = '';
          if (typeof window.sveApi.svgThumbFile === 'function') {
            const tr = await window.sveApi.svgThumbFile(it.name);
            if (!tr || !tr.ok) throw new Error((tr && tr.error) || '独立缩略图生成失败');
            url = tr.url || '';
          } else {
            const rd = await window.sveApi.fileRead('svg', it.name);
            if (!rd || !rd.ok) throw new Error((rd && rd.error) || 'SVG 读取失败');
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
        t.row.addEventListener('click', async () => {
          if (multi) {
            const i = selected.indexOf(it);
            if (i >= 0) selected.splice(i, 1); else selected.push(it);
            paint();
            if (api) api.syncTitle();
            return;
          }
          close();
          const rd = await window.sveApi.fileRead('svg', it.name);
          const txt = rd && rd.ok ? rd.content : null;
          onTexts(txt === null ? [] : [txt]);
          resolve(txt === null ? null : 'single');
        });
        list.appendChild(t.row);
      });
    };
    const render = async () => {
      resetThumbWork();
      list.innerHTML = '';
      rows = [];
      await renderSoft();   /* 开源版：只列软件内 SVGImages 目录 */
    };
    await render();
    App.showOverlay(ov);
  });
}

/* 单选版（「+」栏用）：标题=选择要打开的 SVG，列表来自软件内 SVGImages 目录 */
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
  /* 到这里才开新标签页：解析失败就不该留一个空标签。
     标签名用来源（Geometrize / Vinylizer），方便在标签栏区分是哪次生成。 */
  fzaEnsureDocForImport(from);
  App.importForza(doc.documentElement);
};
