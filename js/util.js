'use strict';
/* ---------- 日志：记录关键操作/错误/性能事件到 sve-debug.log（出问题时发日志排查） ----------
   顶栏「日志」按钮可复制最近日志 / 打开日志文件夹 */
function appLog(level, msg, data) {
  try {
    if (window.sveApi && window.sveApi.log) window.sveApi.log(level, msg, data);
  } catch (e) { /* 日志失败不影响运行 */ }
}
window.App = window.App || {}; // util 最先加载：先建立 App 对象（model.js 会复用）
App.log = appLog; // 各模块用 App.log('info'|'perf'|'error', 消息, 数据)

/* 所有可见缩略图共用的加载态。返回的 loader 同时也是本次异步任务令牌：
   较旧任务结束时不会误删较新任务刚挂上的动画。 */
App.startThumbLoading = function (host) {
  if (!host) return null;
  App.finishThumbLoading(host);
  const loader = document.createElement('span');
  loader.className = 'sve-thumb-loader loader';
  loader.setAttribute('aria-hidden', 'true');
  /* 点阵加载动画（8 个点绕圈依次脉冲）：结构与样式见 css/thumb-loader.css。
     外壳仍是 .sve-thumb-loader、返回值仍是「本次任务的令牌」，finish/清理语义未动；
     .jimu-primary-loading 保留为动画容器锚点（既有样式与判据都引用它）。 */
  const primary = document.createElement('span');
  primary.className = 'jimu-primary-loading dot-spinner';
  primary.textContent = '加载中';
  for (let i = 0; i < 8; i++) {
    const dot = document.createElement('span');
    dot.className = 'dot-spinner__dot';
    primary.appendChild(dot);
  }
  loader.appendChild(primary);
  host.classList.add('sve-thumb-loading');
  host.appendChild(loader);
  return loader;
};
App.finishThumbLoading = function (host, loader) {
  if (!host) return;
  if (loader) {
    if (loader.parentNode !== host) return;
    loader.remove();
  } else {
    Array.from(host.children || []).forEach(ch => {
      if (ch.classList && ch.classList.contains('sve-thumb-loader')) ch.remove();
    });
  }
  const remains = Array.from(host.children || []).some(ch =>
    ch.classList && ch.classList.contains('sve-thumb-loader'));
  if (!remains) host.classList.remove('sve-thumb-loading');
};
/* URL 生成完不等于像素已经显示；动画必须等 img 真正完成解码后再收起。 */
App.showThumbImage = function (host, img, url, loader) {
  return new Promise(resolve => {
    if (!host || !img || !url) {
      App.finishThumbLoading(host, loader);
      resolve(false);
      return;
    }
    let settled = false;
    let decoding = false;
    const done = ok => {
      if (settled) return;
      settled = true;
      img.onload = null;
      img.onerror = null;
      App.finishThumbLoading(host, loader);
      resolve(!!ok);
    };
    const decoded = () => {
      if (settled || decoding) return;
      if (!(img.naturalWidth > 0)) { done(false); return; }
      if (typeof img.decode !== 'function') { done(true); return; }
      decoding = true;
      img.decode().then(() => done(true)).catch(e => {
        /* Chromium 对已经可显示的缓存图偶尔以 EncodingError 拒绝 decode；
           naturalWidth 有效时仍可正常显示，只记录真正的空图。 */
        if (img.naturalWidth > 0) done(true);
        else {
          console.warn('[thumb-loader] 缩略图解码失败', String(e && e.message || e).slice(0, 160));
          done(false);
        }
      });
    };
    img.decoding = 'async';
    img.onload = decoded;
    img.onerror = () => done(false);
    try {
      img.src = url;
      if (img.complete) queueMicrotask(decoded);
    } catch (e) {
      console.warn('[thumb-loader] 缩略图装载失败', String(e && e.message || e).slice(0, 160));
      done(false);
    }
  });
};
/* 鼠标点击记录：画布/图层栏的左键点击写入日志（坐标、命中图层、选中结果），
   诊断"点击无法选中"类问题 */
App.initClickLog = function () {
  if (!App.svg) return;
  const clickAt = (e, where) => {
    if (e.button !== 0) return;
    try {
      let doc = null, hit = null;
      if (App.screenToDoc && App.state) {
        doc = App.screenToDoc(e.clientX, e.clientY);
        if (App.hitLayerPaintedSync) hit = App.hitLayerPaintedSync(e.clientX, e.clientY);
      }
      appLog('click', '鼠标点击' + where, {
        x: Math.round(e.clientX), y: Math.round(e.clientY),
        doc: doc ? [Math.round(doc.x * 10) / 10, Math.round(doc.y * 10) / 10] : null,
        hit: hit ? hit.id : null, hitKind: hit ? hit.kind : null,
        edit: App.state && App.state.edit ? App.state.edit.type + '/' + (App.state.editMode || '') : null,
        selBefore: App.state ? App.state.selected.size : 0,
        whiteBox: App.whiteBoxLayer ? (App.whiteBoxLayer() ? App.whiteBoxLayer().id : null) : null
      });
      /* 点击处理后的结果（下一轮事件循环，选中状态已更新） */
      setTimeout(() => {
        try {
          if (!App.state) return;
          appLog('click', '点击结果', {
            sel: App.state.selected.size,
            selIds: Array.from(App.state.selected).slice(0, 12).join(','),
            selectedByTab: !!App.state.selectedByTab,
            whiteBox: App.whiteBoxLayer ? (App.whiteBoxLayer() ? App.whiteBoxLayer().id : null) : null,
            edit: App.state.edit ? App.state.edit.type : null
          });
        } catch (err) { /* ignore */ }
      }, 0);
    } catch (err) { /* ignore */ }
  };
  App.svg.addEventListener('pointerdown', e => clickAt(e, '画布'));
  if (App.layerListEl) App.layerListEl.addEventListener('pointerdown', e => clickAt(e, '图层栏'));
};

/* ---------- 性能监测与诊断快照 ----------
   日志里的 perf 事件附带【完整计算信息】：图层构成、proxy/位图化状态、
   内存、GPU 渲染器、视图与交互状态，而不是零散提示——卡顿原因可直接从日志判断 */
App.perfCtx = { lastOp: '' };
/* GPU 信息（一次性缓存）：软件渲染（SwiftShader）时大量图层必卡 */
App._gpuInfoCache = null;
App.gpuInfo = function () {
  if (App._gpuInfoCache) return App._gpuInfoCache;
  let renderer = '', vendor = '';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      renderer = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      vendor = String(dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : '');
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
  } catch (e) { /* ignore */ }
  App._gpuInfoCache = { renderer, vendor };
  return App._gpuInfoCache;
};
/* 完整状态快照：诊断卡顿的完整计算信息 */
App.stateSnapshot = function () {
  try {
    const s = App.state || {};
    const kinds = { symbol: 0, import: 0, pattern: 0, merged: 0 };
    (s.layers || []).forEach(l => { kinds[l.kind] = (kinds[l.kind] || 0) + 1; });
    let proxyN = 0, impBaked = 0, impTotal = 0;
    if (App._proxyBake) proxyN = App._proxyBake.size;
    (s.layers || []).forEach(l => {
      if (l.kind === 'import') {
        impTotal++;
        if (l.impBitmapUrl) impBaked++;
      }
    });
    const mem = (performance && performance.memory) ? {
      usedMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
      totalMB: Math.round(performance.memory.jsHeapSizeLimit / 1048576)
    } : null;
    const g = App.gpuInfo();
    return {
      layers: (s.layers || []).length,
      kinds,
      mergedGroups: kinds.merged,
      proxyBaked: proxyN,
      impBitmap: { enabled: impTotal >= (App.impBitmapThreshold || 300), total: impTotal, baked: impBaked },
      sel: s.selected ? s.selected.size : 0,
      edit: s.edit ? s.edit.type + (s.editMode ? '/' + s.editMode : '') : null,
      drag: App.drag ? App.drag.kind : null,
      view: s.view ? { x: +s.view.x.toFixed(1), y: +s.view.y.toFixed(1), scale: +s.view.scale.toFixed(2) } : null,
      lastOp: App.perfCtx.lastOp,
      memory: mem,
      gpu: g.renderer ? g.renderer.slice(0, 120) : null
    };
  } catch (e) { return { error: String(e) }; }
};
App.initPerfMonitor = function () {
  /* 启动快照：版本/环境/GPU/内存基线 */
  try {
    appLog('info', '应用启动', App.stateSnapshot());
  } catch (e) { /* ignore */ }
  /* 主线程长任务：同步阻塞超过 50ms 即记录（浏览器 Long Task API），带完整快照 */
  try {
    if (typeof PerformanceObserver === 'function') {
      const po = new PerformanceObserver(list => {
        for (const e of list.getEntries()) {
          try {
            appLog('perf', '主线程长任务', Object.assign({ ms: Math.round(e.duration) }, App.stateSnapshot()));
          } catch (err) { /* ignore */ }
        }
      });
      po.observe({ entryTypes: ['longtask'] });
    }
  } catch (e) { /* 不支持：跳过 */ }
  /* 帧率监测：独立 rAF 循环每秒统计；平均低于 16fps 记录（带完整快照）；窗口隐藏时不算 */
  let frames = 0, t0 = performance.now(), worst = 0, last = performance.now();
  const loop = () => {
    const now = performance.now();
    frames++;
    const dt = now - last;
    last = now;
    if (dt > worst) worst = dt;
    if (now - t0 >= 1000) {
      if (document.visibilityState === 'visible') {
        const fps = Math.round(frames * 1000 / (now - t0));
        if (fps < 16) {
          try {
            appLog('perf', '低帧率', Object.assign({ fps, worstMs: Math.round(worst) }, App.stateSnapshot()));
          } catch (e) { /* ignore */ }
        }
      }
      frames = 0; t0 = now; worst = 0;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
};
/* 全局错误捕获：未捕获异常/未处理 Promise 拒绝都写入日志（附完整状态快照） */
window.addEventListener('error', e => {
  appLog('error', '渲染进程未捕获异常', Object.assign(
    { message: String(e.message || e.error).slice(0, 300), file: e.filename, line: e.lineno },
    window.App && App.stateSnapshot ? App.stateSnapshot() : {}));
});
window.addEventListener('unhandledrejection', e => {
  const r = e.reason;
  appLog('error', '未处理的 Promise 拒绝', Object.assign(
    { message: String(r && r.message || r).slice(0, 300) },
    window.App && App.stateSnapshot ? App.stateSnapshot() : {}));
});
function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
const SVGNS = 'http://www.w3.org/2000/svg';
const XLINK = 'http://www.w3.org/1999/xlink';
const D2R = Math.PI / 180;
function svgEl(tag, attrs) {
  const e = document.createElementNS(SVGNS, tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    /* null/undefined = 不设置属性（setAttribute 会把 null 转成字符串 "null"） */
    if (v !== null && v !== undefined) e.setAttribute(k, v);
  }
  return e;
}
function fmtNum(n, d) {
  const x = Number(n) || 0;
  if (d === undefined) return String(Math.round(x * 100) / 100);
  const f = Math.pow(10, d);
  return String(Math.round(x * f) / f);
}
function loadImage(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => {
      console.warn('[img-fail]', String(src).slice(0, 80), 'len=' + String(src).length);
      rej(new Error('image load failed'));
    };
    im.src = src;
  });
}
function hexToRgb(hex) {
  let h = String(hex || '').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) return null;
  const n = parseInt(h, 16);
  if (isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex(r, g, b) {
  const p = v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return '#' + p(r) + p(g) + p(b);
}
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max ? d / max : 0;
  return { h: h, s: s * 100, v: max * 100 };
}
function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 100) / 100;
  v = clamp(v, 0, 100) / 100;
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}
function normalizeDeg(d) {
  d = d % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}
/* ---------- 覆盖层显隐（带出场动画） ----------
   关闭：先挂 .sve-closing 播 130ms 出场动画，动画结束后再加 .hidden（关闭是「看得见地」发生）。
   done 在真正隐藏之后回调，await 的流程看到的一定是已关闭状态；
   期间若被重新打开（App.showOverlay），这次隐藏自动作废，不会把新开的窗关掉。

   ★ 幂等（2026-09-20 修用户复报的「右键几次后弹不出窗」）：
     同一次收起动作被**连续调用多次**时，必须只保留**最早那一次**的定时器，
     不能再挂一次 sve-closing、也不能覆盖 _sveHideToken。
     案底（实测时序，画布上「边走边右键」最容易触发）：
       show → 28ms → hide（挂 closing，起 130ms 定时器）
                 → 8ms → show（清 closing、令牌置 null）
                 → 29ms → hide（又挂 closing，又起定时器，令牌被覆盖）
       ...这样反复时，只有「最后写入令牌的那次」定时器能通过校验，前面几次全部作废；
       结果是窗长时间停在 .sve-closing 里 —— 而 .sve-closing 上遮罩是
       pointer-events:none（CSS）且窗在往 0 淡出，用户看到的就是
       「窗半死不活地挂着、右键点上去没反应」（等同用户描述的「弹不出窗」）。
     修法：已经在 .sve-closing 就直接返回（复用已有定时器与 done 队列）。 */
const _sveCloseQueue = new WeakMap();   /* el -> done 回调数组（幂等期间累积） */
App.hideOverlay = function (el, done) {
  if (!el) { if (done) done(); return; }
  if (el.classList.contains('hidden')) { if (done) done(); return; }
  /* 已经在收起动画里：复用本次动画，只把 done 追加进队列，不重启定时器、不覆盖令牌。
     这样连续 hide 的收尾时间仍然是「第一次 hide 起算的 130ms」，不会一拍拍往后拖。 */
  if (el.classList.contains('sve-closing')) {
    if (done) {
      const q = _sveCloseQueue.get(el);
      if (q) q.push(done); else done();
    }
    return;
  }
  const token = {};
  const queue = done ? [done] : [];
  _sveCloseQueue.set(el, queue);
  el._sveHideToken = token;
  el.classList.add('sve-closing');
  setTimeout(function () {
    /* 期间被 showOverlay 重新打开 → 本次隐藏作废（回调照常补发，await 的流程不会挂住） */
    if (el._sveHideToken !== token) {
      _sveCloseQueue.delete(el);
      queue.forEach(fn => { try { fn(); } catch (e) { /* ignore */ } });
      return;
    }
    el._sveHideToken = null;
    el.classList.remove('sve-closing');
    el.classList.add('hidden');
    _sveCloseQueue.delete(el);
    queue.forEach(fn => { try { fn(); } catch (e) { /* ignore */ } });
  }, 130);
};
App.showOverlay = function (el) {
  if (!el) return;
  /* 重新打开：作废在途的收起动作（定时器到点会因令牌不符而跳过），并清掉收起视觉。
     队列里累积的 done 由那个定时器负责补发（见上），这里不必管。 */
  el._sveHideToken = null;
  el.classList.remove('sve-closing');
  el.classList.remove('hidden');
};

/* ---------- 弹窗右上角统一关闭键 ----------
   给任意「标题 + 内容」结构的弹窗挂一个右上角 ×。所有弹窗的骨架都一样
   （.anchor-title 一行 + 内容 + .anchor-btns），所以统一往标题那一行塞，
   不必改各弹窗的 HTML。

   onClose 必传：× 不等于「隐藏」——带临时状态的窗（速率窗 / 快捷键视图）必须走它们自己的
   取消入口把改动回滚，否则点 × 会把临时值静默留下。onClose 返回 false 表示这次关闭被拒
   （例如还在跑异步流程），此时不动窗口。

   可重复调用：每次调用都会先摘掉旧键再按当前 onClose 重建，
   这样同一个窗体切换视图/模式后，× 指向的仍是当前语义的取消入口。

   ⚠ 不把 × 放进 .anchor-title 里面：那个节点在多个弹窗里会被 `titleEl.textContent = ...`
   整段重写（fzaPrompt/fzaTextPrompt/fzaPick 都是这么写标题的），放进去会被文本一起冲掉。
   这里改为把 × 作为**兄弟节点**插到标题之后（.anchor-title 是 flex，× 靠 margin-left:auto
   顶到最右），标题怎么重写都不影响它。 */
App.attachDlgClose = function (box, onClose) {
  if (!box || typeof onClose !== 'function') return null;
  const title = box.querySelector('.anchor-title') || box.querySelector('.speed-title');
  if (!title) return null;
  const old = box.querySelector('.dlg-close');
  if (old) old.remove();
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dlg-close';
  btn.textContent = '×';
  /* 无障碍名：data-i18n-attr 只管一个属性，aria-label 走 App.i18n.t 按当前语言写 */
  btn.setAttribute('aria-label', App.i18n.t('lp.close'));
  btn.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (onClose() === false) return;
  });
  /* 插到标题之后（不是标题里面）：标题行与 × 各自是独立元素，只有这样才能
     既保证视觉上同一行，又不会被标题的 textContent 重写吞掉。 */
  title.insertAdjacentElement('afterend', btn);
  box._dlgCloseBtn = btn;
  return btn;
};
/* 切语言时刷新所有已挂 × 的无障碍名（与 .lp-close 走同一个重刷器机制） */
if (App.i18n && App.i18n.onApply) {
  App.i18n.onApply(function () {
    const label = App.i18n.t('lp.close');
    const list = document.querySelectorAll('.dlg-close');
    for (let i = 0; i < list.length; i++) list[i].setAttribute('aria-label', label);
  });
}
let toastTimer = null;
function showToast(msg, ms) {
  /* 缩略图/静默渲染路径：主页卡片批量渲染工作进程时不弹 toast（避免刷屏与遮挡） */
  if (window.App && App.Tabs && App.Tabs._silentRender) return;
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  /* 显示走 App.showOverlay：清掉上一轮可能正在播的关闭动作（令牌作废），
     避免「上一条提示的消失动作把刚弹出的新提示一起吞掉」。 */
  if (App.showOverlay) App.showOverlay(t);
  else { t.classList.remove('sve-closing'); t.classList.remove('hidden'); }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    /* 消失走出场动画：与弹窗同一套 App.hideOverlay —— 挂 .sve-closing 播 130ms 出场动画，播完再加 .hidden。
       用户 2026-09-12 要求：「给下方操作提示栏消失的时候也添加上动画」。 */
    if (App.hideOverlay) App.hideOverlay(t);
    else t.classList.add('hidden');
  }, ms || 2400);
}

/* ---------- SiUI 风格平滑滚动 ----------
   行为参数与 PyQt-SiliconUI siui/components/widgets/scrollarea.py 一致：
   指数趋近动画 factor=1/6、bias=2（差距≤2px 直接贴上）；滚轮步长 strength=100、
   目标累积式（连续滚动时目标不断累加，从当前位置继续趋近）。GPL 源码仅作行为参考，
   此为 JS 干净重写。滑行中若 scrollTop 被外部直接改写（判据/程序赋值）则立即中止滑行。 */
App.siScrollTo = function (el, top) {
  if (!el) return;
  const st = el.__siScroll || (el.__siScroll = { target: el.scrollTop, raf: 0, last: 0, expected: el.scrollTop, gliding: false });
  const max = () => Math.max(0, el.scrollHeight - el.clientHeight);
  st.target = Math.max(0, Math.min(max(), top));
  if (st.raf) return;
  st.gliding = true;
  st.last = performance.now();
  const step = now => {
    const s2 = el.__siScroll; if (!s2) { el.__siGliding = false; return; }
    if (Math.abs(el.scrollTop - s2.expected) > 1.5) { s2.raf = 0; s2.gliding = false; return; }   /* 外部改写检测：中止滑行 */
    const dis = s2.target - el.scrollTop;
    if (Math.abs(dis) <= 2) { el.scrollTop = s2.target; s2.raf = 0; s2.gliding = false; return; }
    const dt = Math.min(50, now - s2.last); s2.last = now;
    el.scrollTop += Math.sign(dis) * (Math.abs(dis) / 6 + 2) * (dt / 16.7);
    s2.expected = el.scrollTop;
    s2.raf = requestAnimationFrame(step);
  };
  st.raf = requestAnimationFrame(step);
  el.__siGliding = true;
};
/* 滚轮接管：每格滚轮 ±100px（strength=100），目标累积；Ctrl+滚轮（缩放手势）不接管 */
App.attachSiWheel = function (el) {
  if (!el || el.__siWheelAttached) return;
  el.__siWheelAttached = true;
  el.addEventListener('wheel', e => {
    if (e.ctrlKey) return;
    e.preventDefault();
    const st = el.__siScroll || (el.__siScroll = { target: el.scrollTop, raf: 0, last: 0, expected: el.scrollTop });
    const max = () => Math.max(0, el.scrollHeight - el.clientHeight);
    App.siScrollTo(el, Math.max(0, Math.min(max(), st.target + (e.deltaY > 0 ? 100 : -100))));
  }, { passive: false });
};

/* ---------- SiUI 风格悬停提示（tooltip.py 同机制，备用组件） ----------
   全局单例跟随鼠标右上角（x+4、底边贴鼠标 y，60fps 跟踪），文本刷新闪一下高光，
   显示/隐藏走透明度过渡。需要时 App.siTipBind(el, textOrFn) 绑定即可。 */
(function () {
  const el = document.createElement('div');
  el.id = 'siTip';
  el.innerHTML = '<div class="si-tip-hl"></div><span class="si-tip-text"></span>';
  document.body.appendChild(el);
  const txt = () => el.querySelector('.si-tip-text');
  const st = { shown: false };
  App.siTip = {
    show(text, x, y) {
      if (txt().textContent !== String(text)) {
        txt().textContent = String(text);
        const hl = el.querySelector('.si-tip-hl');
        hl.classList.remove('si-tip-flash'); void hl.offsetWidth; hl.classList.add('si-tip-flash');   // 高光闪一下
      }
      el.classList.add('si-tip-show');
      st.shown = true;
      App.siTip.move(x, y);
    },
    hide() { st.shown = false; el.classList.remove('si-tip-show'); },
    /* 默认落在鼠标右上角（x+4、底边贴鼠标上沿），但**必须夹在视口内**：
       工具栏最右那两个按钮（「打开背景图片文件」/「背景图片」）就在屏幕右缘，
       原实现只写 left = x + 4，提示会整条顶出视口右侧（用户 2026-09-21 报障）。
       夹紧规则：右边放不下 → 翻到鼠标左侧；左侧也放不下 → 贴右缘。
       纵向同理：上方放不下 → 翻到鼠标下方；下方也放不下 → 贴底缘。 */
    move(x, y) {
      const w = el.offsetWidth, h = el.offsetHeight;
      const vw = window.innerWidth, vh = window.innerHeight;
      let left = x + 4;
      if (left + w > vw) left = x - w - 4;          /* 翻到鼠标左侧 */
      if (left < 0) left = Math.max(0, vw - w);     /* 左侧也放不下 → 贴右缘 */
      let top = y - h;                              /* 底边贴鼠标上沿 */
      if (top < 0) top = y + 4;                     /* 上方放不下 → 翻到鼠标下方 */
      if (top + h > vh) top = Math.max(0, vh - h);  /* 下方也放不下 → 贴底缘 */
      el.style.left = Math.round(left) + 'px';
      el.style.top = Math.round(top) + 'px';
    },
    shown() { return st.shown; }
  };
  window.addEventListener('mousemove', e => { if (st.shown) App.siTip.move(e.clientX, e.clientY); });
})();
/* 绑定悬停提示：mouseenter 显示 / mousemove 跟随 / mouseleave 隐藏（textOrFn 支持动态文本） */
App.siTipBind = function (el, textOrFn) {
  if (!el) return;
  el.addEventListener('mouseenter', e => App.siTip.show(typeof textOrFn === 'function' ? textOrFn() : textOrFn, e.clientX, e.clientY));
  el.addEventListener('mousemove', e => App.siTip.move(e.clientX, e.clientY));
  el.addEventListener('mouseleave', () => App.siTip.hide());
};

/* ---------- EvolveUI 风格自定义下拉（EDropdown.qml 同效果） ----------
   把原生 <select> 替换为 ev-dd 自定义下拉：点击按钮下方弹出选项、
   过渡动画 scale+fade、点击选项更新原 select 并触发 change 事件。
   重复调用安全（__evDd 标记防重入）。 */
App.evDropdown = function (sel) {
  if (!sel || sel.__evDd) return;
  sel.__evDd = true;
  sel.style.display = 'none';
  const wrap = document.createElement('div');
  wrap.className = 'ev-dd-wrap';
  const btn = document.createElement('div'); btn.className = 'ev-dd-btn';
  const panel = document.createElement('div'); panel.className = 'ev-dd-panel';
  const syncBtn = () => {
    const o = sel.options[sel.selectedIndex];
    btn.textContent = o ? o.textContent : '';
  };
  const build = () => {
    panel.innerHTML = '';
    Array.from(sel.options).forEach(o => {
      const it = document.createElement('div');
      it.className = 'ev-dd-item' + (o.selected ? ' active' : '');
      it.textContent = o.textContent; it.dataset.value = o.value;
      it.addEventListener('click', () => {
        sel.value = o.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        build(); close();
      });
      panel.appendChild(it);
    });
    syncBtn();
  };
  build();
  /* 选项列表/文字变化自动重建：①账户列表异步填充（childList）
     ②切语言时 i18n 改写 option.textContent（subtree+characterData）。
     没有这个观察者，克隆里会一直留着旧文案。 */
  new MutationObserver(build).observe(sel, { childList: true, subtree: true, characterData: true });
  function open() { panel.classList.add('ev-dd-open'); btn.classList.add('ev-dd-active'); }
  function close() { panel.classList.remove('ev-dd-open'); btn.classList.remove('ev-dd-active'); }
  btn.addEventListener('click', e => { e.stopPropagation(); panel.classList.contains('ev-dd-open') ? close() : open(); });
  document.addEventListener('click', e => { if (!wrap.contains(e.target)) close(); });
  wrap.appendChild(btn); wrap.appendChild(panel);
  sel.parentNode.insertBefore(wrap, sel);
  /* 对外句柄：设置面板 syncPanel 改完 select.value、切语言后，都要重建克隆 */
  sel.__evDdApi = { refresh: build };
};
/* 让某个/全部 ev-dd 克隆与原生 select 重新对齐（文案与选中态） */
App.evDropdownSync = function (sel) { if (sel && sel.__evDdApi) sel.__evDdApi.refresh(); };
App.evDropdownSyncAll = function () {
  document.querySelectorAll('select').forEach(function (s) { App.evDropdownSync(s); });
};
