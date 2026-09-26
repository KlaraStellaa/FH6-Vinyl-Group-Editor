'use strict';
/* 画布右键「此处有哪些图层」选择器。
   场景：一个位置叠了好几个图层，普通点击只能选到最上面那个，选不到压在下面的。
   做法：在画布上右键 → 用 document.elementsFromPoint 按**实际绘制顺序**取出该点上的全部图层
        （自上而下，与左侧图层栏顺序一致），在光标旁弹一个小窗列出缩略图；
        点某一行的缩略图 = 选中该图层并自动关窗。
   关闭：右上角 × / Esc / 点击窗外 / 选完自动关。
   只在非编辑态生效（编辑态有自己的手势与选中语义，不去掺和）。 */
(function () {
  var ov = null, box = null, listEl = null;
  var lastFocus = null;

  function vis(el) {
    if (!el || !el.classList) return false;
    return !el.classList.contains('hidden');
  }

  /* 该屏幕点上「看得见」的图层，自上而下（elementsFromPoint 给的就是绘制顺序）。
     图层内容是 <g data-layer="id"> 里的；覆盖层（outlineG/handleG/anchorG）与网格不带 data-layer，自动跳过。

     ★ 必须取**最外层**的 data-layer：合并图层的子图层也各自带 data-layer（model.js 统一建的），
       只找最近的那个祖先会列出「子图层」。用户口径：合并图层要作为**整体**出现，与左侧图层栏一致
       ——所以一路走到 App.svg，记住最后遇到的那个（最外层），再用 state.layers 兜底只认顶层。 */
  App.layersAtPoint = function (clientX, clientY) {
    var out = [], seen = {}, topIds = {};
    App.state.layers.forEach(function (l) { topIds[l.id] = 1; });
    var els = document.elementsFromPoint ? document.elementsFromPoint(clientX, clientY) : [];
    for (var i = 0; i < els.length; i++) {
      var n = els[i], topId = null;
      while (n && n !== App.svg) {
        if (n.getAttribute && n.getAttribute('data-layer')) {
          topId = parseInt(n.getAttribute('data-layer'), 10);   /* 不 break：继续往上取最外层 */
        }
        n = n.parentNode;
      }
      if (topId === null || seen[topId] || !topIds[topId]) continue;
      seen[topId] = 1;
      var l = App.findLayer(topId);
      if (l) out.push(l);
    }
    /* ★★ 兜底必须走**模型**判据，不能只走 DOM —— 这是「右键没反应」反复复发的真因。
       背景（2026-09-21 实测复现）：autoStatic 视口位图接管后，全部顶层图层被置
       `display:none`（render.js 的 setAutoStaticHidden；≥300 叶子图层 + 缩小视图时自动触发，
       静置约 190ms 后烘好落地）。此时：
         ① `document.elementsFromPoint` 一个 data-layer 都取不到（隐藏元素不参与命中测试）；
         ② 旧的几何兜底用 `getBoundingClientRect()`，隐藏元素的矩形**恒为 0 尺寸**，
            被 `r.width <= 0` 直接跳过 —— 兜底静默失效。
       两条路一起瞎 → `layersAtPoint` 恒返回空 → 右键永远不弹窗。
       而**左键完全正常**：`App.hitLayerPaintedSync` 走的是纯模型判据
       （docBBox 四角 + pointInQuad + 剪影 canvas alpha），压根不碰 DOM。
       用户体感就是「图案明明在那儿、左键点得中，右键却说这里没有图层」，
       并且是「过一阵（位图烘好）才犯」——同一块区域、同样的图层，时间不同结果不同。

       ① 模型级像素命中：逐顶层图层用与左键**同一套**判据（像素精确，且不受 display:none 影响）。
          只在 DOM 命中为空时启用，DOM 命中非空时列表口径完全不变。 */
    if (!out.length) {
      for (var k = App.state.layers.length - 1; k >= 0; k--) {
        var lk = App.state.layers[k];
        var vis = false;
        try { vis = !!(App.layerVisibleAtSync && App.layerVisibleAtSync(lk, clientX, clientY)); } catch (e) { vis = false; }
        if (vis) out.push(lk);
      }
    }
    /* ② 仍为空 → 几何兜底（包围框包含该点）。
       大幅合并图层（几千个子形状拼的一整幅画）包围框覆盖全图、像素却极稀疏，
       用户点在花纹之间的空隙里时上面两条都取不到，这里按包围框列出（用户口径：能弹出来优先）。
       ★ 用**模型包围框**（getItemDocBBox + pointInQuad）而不是 DOM 的 getBoundingClientRect：
         后者在 display:none 时恒为 0，兜底会静默失效（见上）。 */
    if (!out.length) {
      var pd = null;
      try { pd = App.screenToDoc(clientX, clientY); } catch (e) { pd = null; }
      if (pd) {
        for (var j = App.state.layers.length - 1; j >= 0; j--) {
          var lj = App.state.layers[j];
          var b = null;
          try { b = App.getItemDocBBox(lj); } catch (e) { b = null; }
          if (!b || !b.corners || b.corners.length < 4) continue;
          if (App.pointInQuad(pd, b.corners)) out.push(lj);
        }
      }
    }
    return out;
  };

  /* 关闭按钮的无障碍名：data-i18n-attr 只能管一个属性，aria-label 由这里按当前语言写 */
  function paintCloseLabel() {
    var b = ov && ov.querySelector('.lp-close');
    if (b) b.setAttribute('aria-label', App.i18n.t('lp.close'));
  }

  /* 切语言时跟着更新（与其它弹层同一个重刷器机制） */
  if (App.i18n && App.i18n.onApply) App.i18n.onApply(paintCloseLabel);

  function build() {
    if (ov && ov.isConnected) return ov;
    ov = document.createElement('div');
    ov.id = 'layerPickOv';
    ov.className = 'hidden';
    ov.innerHTML =
      '<div class="lp-box" role="dialog">' +
        '<div class="lp-head">' +
          '<span class="lp-title" data-i18n="lp.title"></span>' +
          '<button class="lp-close" data-i18n="lp.close" data-i18n-attr="title">×</button>' +
        '</div>' +
        '<div class="lp-list"></div>' +
      '</div>';
    document.body.appendChild(ov);
    box = ov.querySelector('.lp-box');
    listEl = ov.querySelector('.lp-list');
    /* 点窗外关窗（窗内的点击不冒泡到这里）。
       ★ 必须排除右键：右键的真实事件序列是 pointerdown → contextmenu，
         若右键也在 pointerdown 上关窗，就会变成「每次右键都先关再开」——
         窗每点一次都要闪一下 130ms 的关闭动画；一旦 contextmenu 那一步因任何原因没接上
         （点进了正在播放动画、已 pointer-events:none 的遮罩），窗就真的关掉了，
         表现就是用户报的「连点几次右键之后弹不出窗」。右键交给下面的 contextmenu 单独处理。 */
    ov.addEventListener('pointerdown', function (e) {
      if (e.button === 2) return;          /* 右键不在按下时关窗，由 contextmenu 决定 */
      if (e.target === ov) close();
    });
    /* 遮罩上的右键 = 「换个地方再挑一次」：按新位置**原地重开**。
       为什么必须处理：遮罩铺满全屏且在最上层，右键只会打到它、到不了画布上的 contextmenu 监听；
       若这里只关不重开，用户会觉得「右键一次之后再右键就不出窗了」——而且关闭动画那 130ms 里
       再右键还会重启收起动画，把窗一直挡在那儿（用户报障：短时间内无法再次触发，同一位置也一样）。
       openAt 里的 App.showOverlay 会作废收起令牌并清掉 sve-closing，所以不会闪。

       ★ 窗本体（.lp-box / .lp-row 等）上的右键**走同一条路**（用户 2026-09-20 再次复报
         「右键几次后弹不出窗」）：窗开在光标右下 8px，尺寸 200~320 × 最多 3 行（约 250px）。
         真人「一直在不同地方一直右键」时手会小幅挪动，**右键很容易落在上一拍刚开出来的窗上**。
         旧口径是「窗内右键一律 return 不处理」，于是那一下什么都不发生 ——
         用户看到的就是「右键没弹出窗」（其实窗一直开着没动，但没有任何反馈，等同于失效）。
         后来一度改成「行上右键=选中该行」——**更糟**：pickRow 内部会 close()，
         于是「手没挪、第二下右键落在行上」直接把窗关掉了（实测 K1/K3/K4 全挂，就是本 bug）。
         正确口径：**窗内右键与遮罩空白处完全一致** = 「按这个位置再挑一次」——
         该位置下面有图层就换到那儿，一个都没有才关窗。右键永远不做「选中并关窗」。 */

    /* ★ 遮罩上（含窗本体）的右键，**一律**「按这个位置重新挑」——与点画布空白处右键同一语义。
       绝不做「选中并关窗」：右键不是点击，用户右手不离鼠标时右键只是「换个地方再看看」，
       一旦在这里顺手 close，就变成「手没挪、连点两下右键，窗就没了」，用户体感=「弹不出窗」。
       （历史教训：曾把行上右键接到 pickRow → 右键落在行上会 close()，真人连点必中，实测 K1/K3/K4 全挂。）
       该位置下面有图层就就地重开到那儿；一个都没有才真正关窗。 */
    ov.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      var hits = App.layersAtPoint(e.clientX, e.clientY);
      if (!hits.length) { close(); return; }
      openAt(e.clientX, e.clientY, hits);
    });
    ov.querySelector('.lp-close').addEventListener('click', function (e) { e.preventDefault(); close(); });
    /* 列表用委托：行是每次打开重建的。**只有左键**点行才走 pickRow（选中并关窗）。 */
    listEl.addEventListener('click', function (e) {
      var row = e.target && e.target.closest ? e.target.closest('.lp-row') : null;
      if (row) pickRow(row);
    });
    paintCloseLabel();
    if (App.i18n && App.i18n.apply) App.i18n.apply(ov);
    return ov;
  }

  function rowFor(layer, isTop) {
    var row = document.createElement('div');
    row.className = 'lp-row' + (isTop ? ' sel' : '');
    row.setAttribute('data-layer', String(layer.id));
    var thumb = document.createElement('div');
    thumb.className = 'lp-thumb';
    var img = document.createElement('img');
    img.draggable = false;
    img.alt = '';
    thumb.appendChild(img);
    row.appendChild(thumb);
    var meta = document.createElement('div');
    meta.className = 'lp-meta';
    var name = document.createElement('div');
    name.className = 'lp-name';
    name.textContent = layer.name || (App.i18n.t('lp.unnamed'));
    meta.appendChild(name);
    if (layer.kind === 'merged') {
      var badge = document.createElement('span');
      badge.className = 'lp-badge';
      badge.textContent = '×' + App.countInLayer(layer);
      meta.appendChild(badge);
    }
    if (layer.isMask) {
      var mb = document.createElement('span');
      mb.className = 'lp-badge lp-mask';
      mb.textContent = App.i18n.t('lp.mask');
      meta.appendChild(mb);
    }
    row.appendChild(meta);
    /* 缩略图与图层栏同一来源（App.getLayerThumb 有缓存，不会重复烘焙） */
    App.getLayerThumb(layer).then(function (url) {
      if (!img.isConnected) return;
      if (url) { img.src = url; thumb.classList.add('has-img'); }
    }).catch(function () { /* 生成失败就留棋盘格底 */ });
    return row;
  }

  /* 左键点某一行 = 选中该图层并关窗。
     与点画布同一条选择路径：单选 + 图层栏滚到它。
     ⚠ 只给左键用（listEl 的 click）。右键**绝不**走这里——右键语义是「换个地方再挑」，
       在这里 close 会变成「右键一下就关窗」，用户体感就是「连点几次右键后弹不出窗」。 */
  function pickRow(row) {
    if (!row) return;
    var id = parseInt(row.getAttribute('data-layer'), 10);
    var l = App.findLayer(id);
    close();
    if (!l) return;
    App.state.selectedByTab = false;
    App.state.selBarDismissed = false;
    App.lastWheelIdx = App.state.layers.length - 1 - App.state.layers.indexOf(l);
    App.setSelection([l.id], { scrollPanel: true });
    if (App.requestFlashRefresh) App.requestFlashRefresh();
  }

  function openAt(clientX, clientY, hits) {
    build();
    lastFocus = document.activeElement;
    listEl.innerHTML = '';
    hits.forEach(function (l, i) { listEl.appendChild(rowFor(l, i === 0)); });
    /* showOverlay 会清掉 .sve-closing 并作废收起令牌 —— 上一拍请求的关闭因此自动失效，
       不会出现「刚开出来又被上一拍的 130ms 定时器收掉」。 */
    App.showOverlay(ov);
    /* 位置：光标右下 8px，贴边时翻到另一侧，再兜底夹进视口 */
    var pad = 8, w = box.offsetWidth, h = box.offsetHeight;
    var left = clientX + pad, top = clientY + pad;
    if (left + w + pad > window.innerWidth) left = clientX - w - pad;
    if (top + h + pad > window.innerHeight) top = clientY - h - pad;
    left = Math.max(pad, Math.min(left, window.innerWidth - w - pad));
    top = Math.max(pad, Math.min(top, window.innerHeight - h - pad));
    box.style.left = Math.round(left) + 'px';
    box.style.top = Math.round(top) + 'px';
    /* ★ 兜底：极端窄视口下上面两条翻转可能互相压回来，导致窗体把光标盖住。
       窗体盖住光标 = 下一次右键打在窗体上（用户「一直在不同地方一直右键」时必然遇到）。
       contextmenu 已改为「就地重挑」不会关窗，但光标被盖住本身就该避免：
       这里再检查一次，若确实盖住就把窗体推到光标另一侧，实在推不开就竖直错开。 */
    var br = box.getBoundingClientRect();
    if (clientX >= br.left && clientX <= br.right && clientY >= br.top && clientY <= br.bottom) {
      /* 优先竖直方向让开（横向空间通常更紧） */
      var altTop = (clientY - h - pad >= pad) ? (clientY - h - pad) : (clientY + pad + h <= window.innerHeight - pad ? clientY + pad : null);
      if (altTop !== null && !(clientX >= br.left && clientX <= br.right && clientY >= altTop && clientY <= altTop + h)) {
        top = altTop;
      } else {
        var altLeft = (clientX - w - pad >= pad) ? (clientX - w - pad) : (clientX + pad + w <= window.innerWidth - pad ? clientX + pad : null);
        if (altLeft !== null) left = altLeft;
      }
      box.style.left = Math.round(Math.max(pad, Math.min(left, window.innerWidth - w - pad))) + 'px';
      box.style.top = Math.round(Math.max(pad, Math.min(top, window.innerHeight - h - pad))) + 'px';
    }
  }

  function close() {
    /* 正在收起或已隐藏：不重复播动画（避免连续关闭把动画一拍拍地叠下去） */
    if (!ov || ov.classList.contains('hidden') || ov.classList.contains('sve-closing')) return false;
    App.hideOverlay(ov);
    if (lastFocus && lastFocus.blur) { try { lastFocus.blur(); } catch (e) { /* ignore */ } }
    return true;
  }

  function isOpen() { return !!ov && !ov.classList.contains('hidden'); }

  /* ---------- 接线 ---------- */
  App.wireLayerPicker = function () {
    var host = App.wrap || document.getElementById('canvasWrap');
    if (!host) return;
    host.addEventListener('contextmenu', function (e) {
      /* 编辑态不掺和（编辑有自己的手势/选中语义）；主页盖在画布上时也不弹 */
      if (App.state.edit) return;
      var home = document.getElementById('homeOverlay');
      if (vis(home)) return;
      var hits = App.layersAtPoint(e.clientX, e.clientY);
      if (!hits.length) { if (isOpen()) close(); return; }
      e.preventDefault();          /* 拦掉系统右键菜单：这里右键是「挑图层」 */
      openAt(e.clientX, e.clientY, hits);
    });
    /* 画布滚轮/缩放时关掉，避免窗留在原地指向已经变了的图层 */
    host.addEventListener('wheel', function () { if (isOpen()) close(); }, { passive: true });
    /* 窗口失焦/切标签时收起 */
    window.addEventListener('blur', function () { if (isOpen()) close(); });
  };

  /* Esc 关窗：**在模块加载期注册**（早于 App.boot 里的全局键盘处理）。
     原因：事件常常直接派发到 window，此时同节点的捕获/冒泡监听器按**注册顺序**执行，
     谁先注册谁先跑；只有先跑的那个调 stopImmediatePropagation 才拦得住后面的。
     注册晚了就会「窗关了、选中也被全局 Esc 一起清掉」。 */
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !isOpen()) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    close();
  }, true);

  App.layerPicker = { openAt: openAt, close: close, isOpen: isOpen, layersAtPoint: App.layersAtPoint };
})();
