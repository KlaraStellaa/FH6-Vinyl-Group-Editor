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
    /* 骨架里**不放固定的「取消」按钮**。
       按钮一律由各弹窗自己生成，并挂到 .confirm-box 上（见 fzaFoot）。 */
    ov.innerHTML = '<div class="confirm-box fza-box"><div class="anchor-title"></div>' +
      '<div class="fza-body"></div></div>';
    document.body.appendChild(ov);
    /* 遮罩点击与右上角 × 共用一个取消动作（没登记时退化为纯隐藏） */
    const cancelNow = () => {
      if (typeof ov._fzaCancel === 'function') { ov._fzaCancel(); return; }
      App.hideOverlay(ov);
    };
    ov.addEventListener('click', e => { if (e.target === ov) cancelNow(); });
    App.attachDlgClose(ov.querySelector('.confirm-box'), () => { cancelNow(); });
  }
  return ov;
}
/* 所有弹窗的「取消/确定」按钮必须在**显示区域之外**、贴在窗口右下角边缘。
   所以按钮行一律挂在 .confirm-box（弹框本体）上做页脚，而不是挂在 .fza-body（滚动内容区）里
   —— 长列表滚动时按钮不再跟着滚。
   各弹窗只清 .fza-body、不清 .confirm-box，所以这里必须**先清掉上一个弹窗遗留的页脚**：
     不清的话 box 里会堆着多个 .anchor-btns，querySelector 会先命中旧的那个「确定」，
     表现为「点了确定没反应」。
   注意：每个弹窗只能调用一次（第二次调用会把刚挂上的页脚删掉）。 */
function fzaBox(ov) { return ov.querySelector('.confirm-box'); }
/* 清掉 .confirm-box 上遗留的某类子元素。
   各弹窗只清 .fza-body、不清 box，所以**挂在 box 上的东西必须显式清**，
   否则会像页脚那样累积（曾出现「querySelector 先命中旧按钮、点确定没反应」）。 */
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
/* 重建弹窗时，挂在 .confirm-box 上的「弹窗级」子元素必须**一并**清掉。
   只清 .fza-body、不清 box 会让上一步留下的东西跨窗口残留 ——
   典型症状：从「注入 SVG」窗口进到「即将覆盖分组」窗后，
   **「导入 SVG 文件…」按钮还挂在弹窗顶部**（它是 .fza-tools 里的）。
   所有弹窗统一走本函数，就不会漏。返回正文区元素。 */
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
/* 通用列表选择（对齐官方 ChoiceDialog：标题栏 + 提示语 + 默认选中第一项(高亮) + 确定/取消） */
function fzaPick(title, items, rowHtml, promptMsg) {
  return new Promise(resolve => {
    const ov = fzaOverlay();
    const ovCancel = ov.querySelector('.fza-cancel');
    if (ovCancel) ovCancel.classList.add('hidden'); // 本函数自带 取消/确定
    ov.querySelector('.anchor-title').textContent = title;
    const body = fzaResetBox(ov);   /* 重建弹窗：正文 + box 上的弹窗级残留（工具条/页脚）一起清 */
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
      fzaFoot(ov).appendChild(btns0);   /* 页脚：在滚动区之外 */
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
    fzaFoot(ov).appendChild(btns);   /* 页脚：在滚动区之外 */
    App.showOverlay(ov);
  });
}
function fzaConfirm(title, message, okText) {
  return new Promise(resolve => {
    const ov = fzaOverlay();
    const ovCancel = ov.querySelector('.fza-cancel');
    if (ovCancel) ovCancel.classList.add('hidden'); // 本函数自带 取消/继续，隐藏遮罩层多余的取消
    ov.querySelector('.anchor-title').textContent = title;
    const body = fzaResetBox(ov);   /* 重建弹窗：正文 + box 上的弹窗级残留（工具条/页脚）一起清 */
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
    fzaFoot(ov).appendChild(btns);   /* 页脚：在滚动区之外 */
    App.showOverlay(ov);
  });
}
function fzaPrompt(title, message, def) {
  return new Promise(resolve => {
    const ov = fzaOverlay();
    const ovCancel = ov.querySelector('.fza-cancel');
    if (ovCancel) ovCancel.classList.add('hidden'); // 本函数自带 取消/确定，隐藏遮罩层多余的取消
    ov.querySelector('.anchor-title').textContent = title;
    const body = fzaResetBox(ov);   /* 重建弹窗：正文 + box 上的弹窗级残留（工具条/页脚）一起清 */
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
    fzaFoot(ov).appendChild(btns);   /* 页脚：在滚动区之外 */
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
    const body = fzaResetBox(ov);   /* 重建弹窗：正文 + box 上的弹窗级残留（工具条/页脚）一起清 */
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
    fzaFoot(ov).appendChild(btns);   /* 页脚：在滚动区之外 */
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
/* 工作进程卡 / 锚点卡的缓存身份：内容在内存里，没有主进程可 stat 的源路径，
   所以由这里给一个「名字 + 版本号（mtime）」的身份串，交给主进程算 sha1 当 key。
   ★ 版本号必须进身份串 —— 否则文件更新后仍命中旧图（本次要解决的问题）。
   命名空间常量与 main.js 的 genericThumbPath 对应。 */
App.WORKCOPY_THUMB_NS = 'workcopy-thumb-v1';
App.workcopyThumbIdentity = function (name, ver) {
  return String(name || '') + '\0' + String(ver == null ? '' : ver);
};
App.fzaSvgThumb = function (name, text, ver) {
  /* ver：文件 mtime 等版本号；带上它后同名文件重新保存会重新渲染，避免主页卡片显示旧缩略图 */
  const key = ver ? name + '@' + ver : name;
  if (App.fzaSvgThumbCache.has(key)) return Promise.resolve(App.fzaSvgThumbCache.get(key));
  if (App.fzaSvgThumbInflight.has(key)) return App.fzaSvgThumbInflight.get(key);
  const p = (async function () {
    try {
      let durl = '';
      if (window.sveApi && typeof window.sveApi.svgThumbRenderCached === 'function' && App.WORKCOPY_THUMB_NS) {
        const result = await window.sveApi.svgThumbRenderCached(
          String(text || ''), App.WORKCOPY_THUMB_NS, App.workcopyThumbIdentity(name, ver));
        if (result && result.ok) durl = result.url || '';
        else if (result && result.error) console.warn('[fzaSvgThumb] 独立进程生成失败', result.error);
      } else if (window.sveApi && typeof window.sveApi.svgThumbRender === 'function') {
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
   模型 -> 官方格式 SVG(svgStringFromModel) -> 内容框取景(frameToContent) -> 光栅化
   -> 双阈值内容盒裁剪 -> 等比居中到 256x256(透明底,放大无上限) -> webp。
   ★ 取景 / 裁剪 / 缩放与「卡片缩略图 / 工作进程缩略图」共用同一套规则
     （`SveThumbRenderer.renderCardBlob`）：先 frameToContent 放宽根 viewBox，
     再取「不透明核心」内容盒（α>200，取不到才退回 α>8）并外扩 2px，最后 contain 居中。
     旧实现只按「α>0」扫内容盒，抗锯齿软边被算进内容 → 内容顶满 256、四周不留白，
     与其它缩略图不一致（2026-09-26 用户报障「注入后的替换缩略图也有问题」）。
   蒙版形状在 v1 中按官方导出样式(指示图案)渲染;色调/α 与游戏一致。 */
App.fzaComputeThumbDataUrl = async function (root) {
  try {
    if (!root || !(root.children || []).length) return null;
    let { str } = App.FZA.svgStringFromModel(root);
    /* ① 内容框取景：直接复用卡片缩略图那套（放宽根 viewBox，内容不再贴边/被裁） */
    const TR = window.SveThumbRenderer;
    if (TR && typeof TR.frameToContent === 'function') str = TR.frameToContent(str);
    const rasterUrl = (App.thumbSvgHasMasks && App.thumbSvgHasMasks(str) && App.thumbKnockoutRaster)
      ? await App.thumbKnockoutRaster(str) : '';
    const url = rasterUrl || ('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str));
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('svg render')); img.src = url; });
    let W = img.naturalWidth || 1920, H = img.naturalHeight || 1080;
    let full = document.createElement('canvas');
    full.width = W; full.height = H;
    let fg = full.getContext('2d', { willReadFrequently: true });
    fg.drawImage(img, 0, 0, W, H);
    /* ② 内容盒：与 thumb-render-core 的 contentBox(canvas,200,1,2) || contentBox(canvas,8,1,2) 同口径 */
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
    /* ★ 上面这遍按【整张画布】光栅化，内容拿到的源像素 = 画布边长 × 内容占比。
       实测（极限竞速.1800.svg，1920×1080 画布、内容只占宽 9.8% / 高 14.3%）：
         修前 —— 内容盒 184×149px，contain 那步 dw/sw = 1.391（放大 1.39 倍）；
         补这一遍后 —— 内容盒 512×412px，dw/sw = 0.5（缩小）。
       这里按【内容盒】重取景、并把根 width/height 声明成「长边 = 输出 × 2」再光栅化一次，
       内容直接拿到 2× 源像素。只在「内容长边 < 输出」时才做（= 会放大才做），
       本来就不放大的文件完全不动；取景口径不变（仍是内容盒 → 等比 contain 居中），
       所以不会溢出。 */
    if (Math.max(box.w, box.h) < SIZE && TR && typeof TR.reframeRootAt === 'function') {
      const rewritten = TR.reframeRootAt(str, box, W, H, Math.min(SIZE * 2, 1024));
      if (rewritten) {
        try {
          const img2 = new Image();
          await new Promise((res, rej) => {
            img2.onload = res; img2.onerror = () => rej(new Error('svg render'));
            img2.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(rewritten);
          });
          const W2 = Math.max(1, img2.naturalWidth || W), H2 = Math.max(1, img2.naturalHeight || H);
          const full2 = document.createElement('canvas'); full2.width = W2; full2.height = H2;
          const fg2 = full2.getContext('2d', { willReadFrequently: true });
          fg2.drawImage(img2, 0, 0, W2, H2);
          /* ★ boxOf 读的是闭包里的 fg / W / H —— 必须先换掉它们再调，否则量到的是旧画布坐标 */
          const oFull = full, oFg = fg, oW = W, oH = H, oBox = box;
          full = full2; fg = fg2; W = W2; H = H2;
          const b2 = boxOf(200) || boxOf(8);
          if (b2) {
            const b2x = Math.max(0, b2.x - PAD), b2y = Math.max(0, b2.y - PAD);
            box = { x: b2x, y: b2y, w: Math.min(W2 - b2x, b2.w + PAD * 2), h: Math.min(H2 - b2y, b2.h + PAD * 2) };
          } else {
            full = oFull; fg = oFg; W = oW; H = oH; box = oBox;   /* 重取景烘出空图：退回原结果 */
          }
        } catch (e) {
          console.warn('[fzaComputeThumbDataUrl] 内容盒重取景失败，退回整画布结果', String(e && e.message || e).slice(0, 180));
        }
      }
    }
    /* ③ contain 居中到 256：短边留白居中（游戏规则；cover 会溢出画布） */
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
    const w = c.toDataURL('image/webp', 0.95); // Chromium 仅有损 webp(VP8+ALPH);游戏本体保存会用自己的 VP8L 再生成
    return w.indexOf('data:image/webp') === 0 ? w : c.toDataURL('image/png');
  } catch (e) { console.warn('[fzaComputeThumbDataUrl] 生成失败：', e && e.message); return null; }
};

/* ---------- 选择窗「多选」按键（两个选择窗共用） ----------
   规程：点「多选」进入多选（同时把标题包成「（已选 N 项）」并清空当前单选高亮）；
   多选态单击行 = 切换该行高亮（不互斥），点「确定」返回所选集合；
   再点「多选」退出并清空全部高亮，回到单选（默认第一项高亮）。
   startMulti：构建时直接进多选态（批量注入需要「选满 N 个」时用）。 */
/* 「（已选 N 项）」是 JS 拼出来的字符串，data-i18n 扫描管不到，
   所以改走 App.i18n.tf('fza.multiCount') 按当前语言取词，并注册一个重刷器，
   切语言时跟着变（与 help.js / layerpicker.js 同一套 onApply 机制）。
   弹层 #fzaOv 是单例、同时只会开一个窗，所以只留一个当前重刷器即可。 */
let _fzaTitleSync = null;
if (App.i18n && typeof App.i18n.onApply === 'function') {
  App.i18n.onApply(() => { if (_fzaTitleSync) { try { _fzaTitleSync(); } catch (e) { /* 已关窗 */ } } });
}
function mountMultiToggle(ov, api, startMulti) {
  const titleEl = ov.querySelector('.anchor-title');
  /* 标题区先收成一个**受管理的文本节点**，再挂按钮 —— 顺序不能反，
     反了会把刚挂上的「多选」键一起清掉。
     顺序反了会渲染成「选择要注入的 SVG（已选 2 项）选择要注入的 SVG」（标题显示两遍）。 */
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
    /* 文本节点已被换掉（窗口重建）→ 本重刷器作废，切语言时不再调用 */
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
  if (multi) api.setMulti(true);        /* 初始即多选态：把 selected 同步成数组 */
  btn.classList.toggle('active', multi);
  syncTitle();
  return { isMulti: () => multi, syncTitle };
}
/* 把一个基础选择器升级成"可多选、集合返回"的选择器：resolve 数组，取消为 null */
/* 构建"软件内 SVG 库"弹层；multi=false 时点行即选中并关窗，true 时按多选规程。
   结果统一由 onTexts 回调返回文本数组（取消=[]）；resolve 值 = 'multi' | 'single' | null(取消) */
﻿function buildSvgLibraryOverlay(multi, onTexts, opts) {
  opts = opts || {};
  return new Promise(async resolve => {
    /* 不预先启动隐藏 renderer：先建立选择窗和加载动画，首个可视行任务
       自己负责启动 renderer，并由队列串行执行，避免打开弹窗时发生空白等待。 */
    const ov = fzaOverlay();
    const titleEl = ov.querySelector('.anchor-title');
    const baseTitle = opts.title || (multi ? App.i18n.t('fza.pickSvgInject') : App.i18n.t('fza.pickSvgOpen'));
    /* 列表来源（拆分为两个窗口）：
       'recent'  = SVG图像目录（软件内彩绘，与主页/「+」栏一致）
       'palette' = 编辑器内「已保存的彩绘」列表（注入存档窗口专用） */
    const applyTitle = () => {
      /* 标题不带来源括号说明：来源由上方切换条的选中态表达 */
      titleEl.textContent = baseTitle;
      titleEl.setAttribute('data-title', baseTitle);
    };
    const old = titleEl.querySelector('.fza-multi');
    if (old) old.remove();
    applyTitle();
    const body = fzaResetBox(ov);   /* 重建弹窗：正文 + box 上的弹窗级残留（工具条/页脚）一起清 */
    let done = false;
    /* 本窗口用「onTexts 回调 + resolve」双轨收尾，
       三条出口（本地列表 / 文件导入 / 取消）必须**各自**收尾一次。
       统一走 finish()：幂等守卫 + 关窗 + 回调 + resolve，一次到位。
       否则调用方 await 的 Promise 可能永远不返回 → 后续流程卡死。 */
    let settled = false;
    /* 读取/解码进行中置 busy ——
       期间禁用确定、导入、多选开关与点行，避免重复启动读取任务或改变选择。 */
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
    /* 唯一收尾口：v = resolve 值（'multi' | 'single' | null），texts = 交给 onTexts 的文本数组（取消 = []）
       幂等：重复调用（例如关窗后又收到异步结果）只生效第一次，避免重复回调。 */
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
    /* **单选态也要点「确定」才开始执行**（与选择的窗口逻辑统一）。
       所以单选态用一个单独的高亮项 selSingle，点行只高亮、不立即动作。 */
    let selSingle = null;
    let yesBtn = null;
    /* 判断「是否真的进了多选态」必须看多选开关（api.isMulti），
       不能用闭包 multi（它恒为构建时的值）——否则单选态的高亮永远画不出来。 */
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
      /* 未选中任何项 → 确定键灰色不可点（单选、多选一致）；读取/解码期间一律置灰 */
      if (yesBtn) {
        yesBtn.disabled = busy ? true
          : (inMultiNow() ? !(selected && selected.length > 0) : !selSingle);
      }
      /* 读取期间禁用「导入 SVG 文件…」与「多选」开关（它们都会改变选择） */
      if (importBtn) importBtn.disabled = busy;
      const mt = ov.querySelector('.fza-multi');
      if (mt) mt.disabled = busy;
    };
    /* 「导入 SVG 文件…」与来源栏放在一个**不滚动**的工具条 .fza-tools（正文区之前）：
       .fza-body 是滚动容器、里面的 .fza-svg-list 又是另一个 →
       窗口里会出现**两条滑条**（一条滚按钮、一条滚文件），按钮还会被滚走。
       正文区因此不自己滚、只负责给高度，全窗只留文件列表这一条滑条。 */
    const box = fzaBox(ov);                     /* 工具条遗留已在 fzaResetBox 里清过 */
    const tools = document.createElement('div');
    tools.className = 'fza-tools';
    box.insertBefore(tools, body);
    importBtn = document.createElement('button');
    importBtn.textContent = App.i18n.t('fza.importFile');
    importBtn.className = 'active';
    importBtn.addEventListener('click', () => {
      if (busy) return;
      /* 先关窗（不让弹窗压在系统文件框后面）没问题，
         但**必须**在文件读完后收尾 Promise。否则调用方 await 的 Promise 会一直挂着。 */
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
    /* 骨架里已不再有固定的 .fza-cancel，这里判空后再挂，兼容旧结构 */
    const _ovc = ov.querySelector('.fza-cancel');
    if (_ovc) _ovc.onclick = () => finish(null);
    const btns = document.createElement('div');
    btns.className = 'anchor-btns';
    const no = document.createElement('button');
    no.textContent = App.i18n.t('fza.cancel');
    no.addEventListener('click', () => finish(null));
    /* 把「所选项」解析成 SVG 文本数组。
       列表只含本地 SVG 文件项：fileRead('svg', name) 取 rd.content。
       串行 await，**严格保持传入顺序** —— 第 i 个 SVG 必须对应第 i 个目标分组，
       所以绝不并行收集、绝不改变顺序。
       返回 { texts, failName, why }：texts 非空 = 全部成功。 */
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
    /* 点「确定」的唯一执行口（单选、多选共用）：
       ① 全部读取/解码成功 → 关窗收尾（onTexts + resolve 各一次）；
       ② 任一项失败 → **保留窗口与选择**，指出失败文件名和原因，恢复按钮供重试，
          绝不「丢弃失败项后继续」，也绝不进入后续分组选择；
       ③ busy 期间重复点确定直接忽略，保证只有一轮读取与一次后续流程；
       ④ 读取期间用户取消（settled）→ 晚到结果直接丢弃，不回调、不重开窗。 */
    const commitPicked = async () => {
      if (busy || settled) return;
      const items = inMultiNow() ? (selected || []).slice() : (selSingle ? [selSingle] : []);
      if (!items.length) return;
      const wasMulti = inMultiNow();
      busy = true;
      paint();
      try {
        const r = await resolveTexts(items);
        if (settled) return;                       /* 读取期间已取消：丢弃晚到结果 */
        if (!r.texts) {
          busy = false;
          paint();                                 /* 恢复按钮，选择原样保留 */
          showToast(App.i18n.tf('toast.fza.readSvgFail', { name: r.failName, why: r.why }), 6000);
          return;
        }
        finish(wasMulti ? 'multi' : 'single', r.texts);
      } catch (e) {
        /* 异步错误必须接住，否则会留下未处理的 rejection + 永不结束的 Promise */
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
    yes.disabled = true;                       /* 初始无选中 → 置灰（paint 会同步） */
    yesBtn = yes;
    yes.addEventListener('click', () => {
      /* 单选/多选都走 commitPicked —— 多选分支若直接把文件对象当文本返回，
         没有 fileRead，解析器会拿到 object 得到 0 个图层，分组窗口根本不弹。 */
      commitPicked();
    });
    /* 单选态也要有「确定」键（与选择窗口逻辑统一） */
    btns.appendChild(no);
    btns.appendChild(yes);
    fzaFoot(ov).appendChild(btns);   /* 页脚：在滚动区之外 */
    if (multi) {
      api = mountMultiToggle(ov, {
        count: () => (selected ? selected.length : 0),
        setMulti: on => { if (busy) return; selected = on ? [] : null; paint(); }
      });
      /* 「撤销注入」键排在「多选」左边，多选靠右。
         mountMultiToggle 会先把标题区清空再挂「多选」，所以这里只能在它之后创建，
         再 insertBefore 到「多选」前面 —— 顺序：[标题文字] …… [撤销注入][多选]。 */
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
      /* 两个键包进同一个容器，由**容器**承担 margin-left:auto。
         若只给 .fza-multi 加 auto 边距，那段空白会落在两键**之间**（撤销键被推到标题那头）。
         包起来后：[标题文字] …空白… [撤销注入][多选]（两键紧挨、整组贴右）。 */
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
          /* 与「选择窗口」逻辑统一 ——
             真正进了多选态：点行切换勾选；
             否则（单选态，含未点多选开关）：**只高亮选中，点「确定」才开始**。
             读取/解码进行中（busy）点行无效，避免中途改变选择。 */
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
