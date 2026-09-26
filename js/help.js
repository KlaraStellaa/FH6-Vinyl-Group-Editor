'use strict';
/* ============ 「帮助模式」 ============
   用法：**右键**顶部工具栏的 `?` 按钮进入帮助模式 → 点界面上任意可交互按钮 →
        弹出该按钮的说明，并自动退出帮助模式。要看别的，重新右键 `?`。
        退出：Esc，或右键 `?` 以外的任意位置。
        弹窗（设置页等）开着时顶部 `?` 被遮罩盖住，右下角会补一个同款浮动 `?`（见下文）。

   两条硬要求（实现时最容易踩）：
   1. **帮助模式下点击按钮绝不能执行原动作**。所以拦截在**捕获阶段**做，并且
      pointerdown / mousedown / click 三个事件一起挡（有的按钮动作在 pointerdown 上）。
      登记表漏掉的按钮也必须拦下来（find 末尾的通用兜底）——否则「删除所有图层」这类
      按钮在帮助模式下会被真按下去。
   2. **Esc 监听必须在模块加载期注册**（本文件在 js/main.js 之前加载）。事件常常直接派发到
      window，同节点监听器按注册顺序执行；注册晚了会「帮助模式退了、选中也被全局 Esc 一起清掉」。
      （与 js/layerpicker.js 同一套案底与做法。）

   按钮 → 词条的对应写在下面的 MAP 里，用**选择器**而不是 id 映射：
   很多按钮是 JS 动态生成的（弹窗、标签页、图层选择窗、日志窗），运行时才存在；
   选择器在点击那一刻现查，天然支持动态元素。
   MAP 里不只有按钮：画布本体 `#canvas`、图层行 `.layer-item` 这类「区域」也各配一条
   （点它们同样弹说明）。这类**容器级**选择器覆盖面大，必须排在画布/列表内的具体元素之后。
   MAP 顺序敏感：**具体选择器在前、通用兜底在后**（同一元素可能匹配多条，取第一条）。
   新增按钮：① 这里加一条 [选择器, 标识]；② js/help-i18n.js 补 5 条 help.<标识>；
            ③ 判据 _forza-src/run-help.js 会扫出漏网的按钮。 */
(function () {
  /* ---------- 按钮 → 帮助词条 ---------- */
  var MAP = [
    /* --- 顶部工具栏 --- */
    ['#btnOpen', 'btnOpen'], ['#btnSave', 'btnSave'], ['#btnSaveWork', 'btnSaveWork'],
    ['#btnHistAnchor', 'btnHistAnchor'], ['#btnBase', 'btnBase'], ['#btnGrid', 'btnGrid'],
    ['#btnZoomWheel', 'btnZoomWheel'], ['#btnShortcuts', 'btnShortcuts'],
    ['#helpFab', 'helpFab'],
    ['#btnOpenImage', 'btnOpenImage'], ['#btnBgImage', 'btnBgImage'],
    /* --- 标签栏（.tab-close 必须在 [data-tabid] 之前） --- */
    ['.tab-close', 'tabClose'], ['#tabHome', 'tabHome'], ['[data-tabid]', 'tabPill'],
    ['#tabNewDoc', 'tabNewDoc'], ['#btnSettings', 'btnSettings'],
    /* --- 左侧功能栏 17 键 --- */
    ['#btnEditPos', 'selEditPos'], ['#btnEditColor', 'selEditColor'], ['#btnReplace', 'selReplace'],
    ['#btnToMask', 'selToMask'], ['#btnToLayer', 'selToLayer'], ['#btnFlipH', 'selFlipH'],
    ['#btnFlipV', 'selFlipV'], ['#btnMerge', 'selMerge'], ['#btnSplit', 'selSplit'],
    ['#btnCut', 'selCut'], ['#btnCopy', 'selCopy'], ['#btnDelete', 'selDelete'],
    ['#btnSelectAll', 'selSelectAll'], ['#btnClearSel', 'selClearSel'],
    ['#btnSavePalette', 'selSavePalette'], ['#btnDeleteAll', 'selDeleteAll'],
    ['#btnLocateLayer', 'selLocateLayer'],
    /* --- 编辑模式工具栏 --- */
    ['#editBar [data-mode="move"]', 'editModeMove'], ['#editBar [data-mode="size"]', 'editModeSize'],
    ['#editBar [data-mode="rotate"]', 'editModeRotate'], ['#editBar [data-mode="skew"]', 'editModeSkew'],
    ['#editBar [data-mode="opacity"]', 'editModeOpacity'],
    ['#btnFinish', 'btnFinish'], ['#btnShowHandles', 'btnShowHandles'], ['#btnAxisHint', 'btnAxisHint'],
    ['#btnPlaceAnchor', 'btnPlaceAnchor'], ['#btnPropMode', 'btnPropMode'], ['#btnRemoveBg', 'btnRemoveBg'],
    /* --- 画布右上角 --- */
    ['#btnHideLayers', 'btnHideLayers'], ['#btnHideBg', 'btnHideBg'],
    ['#bgOpacityRange', 'bgOpacityRange'], ['#bgOpacityBgRange', 'bgOpacityBgRange'],
    /* --- 画布本体（空白处 / 图形上的手势） ---
       ⚠ #canvas 是 SVG 根节点，画布里的一切都是它的后代 —— 属于「容器级」选择器，
         必须排在所有画布内的具体元素之后（也在末尾的通用兜底之前），
         否则会把画布里的按钮一并吃掉。 --- */
    ['#canvas', 'canvas'],
    /* --- 图层栏 ---
       ① 图层行 .layer-item —— 点击选中 / 拖动排序 / Tab 高亮；
       ② 「+」栏用的是**另一个类名** .layer-plus（见 js/panels.js:53），
          不落在 .layer-item 集合里，所以两条互不遮蔽。 --- */
    ['.layer-item', 'layerItem'],
    ['#layerPlusRow', 'layerPlusRow'],
    /* --- 右键图层选择窗 --- */
    ['#layerPickOv .lp-close', 'lpClose'], ['#layerPickOv .lp-row', 'lpRow'],
    /* --- 右侧面板 --- */
    /* 图案库里的**单个图案格子**：点它弹说明（用户 2026-09-23 要求）。
       排在页签 label[data-tab="lib"] 之前 —— 格子更具体，避免被页签规则抢先匹配。 */
    ['.lib-item', 'libItem'],
    ['#panelMinBtn', 'panelMinBtn'], ['label[data-tab="lib"]', 'ptabLib'], ['label[data-tab="color"]', 'ptabColor'],
    ['#btnEyeLayer', 'btnEyeLayer'], ['#btnEyeBg', 'btnEyeBg'],
    ['#btnApplyColor', 'btnApplyColor'], ['#btnFav', 'btnFav'],
    /* --- 主页 --- */
    ['[data-home-act="new"]', 'homeNew'], ['[data-home-act="open"]', 'homeOpen'],
    ['#btnFzaGeo', 'btnFzaGeo'], ['#btnFzaVinyl', 'btnFzaVinyl'], ['#btnFzaBackup', 'btnFzaBackup'],
    ['#btnFzaInject', 'btnFzaInject'], ['#btnFzaExport', 'btnFzaExport'],
    ['#homeSearch', 'homeSearch'], ['#homeSort', 'homeSort'],
    ['#btnHomeOpen', 'btnHomeOpen'], ['#btnHomeRename', 'btnHomeRename'],
    ['#btnHomeExportAs', 'btnHomeExportAs'], ['#btnHomeDelete', 'btnHomeDelete'],
    ['#btnHomeImport', 'btnHomeImport'], ['#btnHomeRefresh', 'btnHomeRefresh'],
    ['label[data-home-tab]', 'homeTabs'], ['#homeGrid .home-card', 'homeCard'],
    /* --- 日志窗 --- */
    ['#btnLogCopy', 'btnLogCopy'], ['#btnLogOpen', 'btnLogOpen'], ['#btnLogClose', 'btnLogClose'],
    /* --- 快捷键一览窗 --- */
    ['#btnShortcutClose', 'btnShortcutClose'],
    /* --- 设置窗 --- */
    ['#btnEditSpeed', 'btnEditSpeed'], ['#btnNudgeSpeed', 'btnNudgeSpeed'],
    ['#btnKeymap', 'btnKeymap'], ['#btnLogInSettings', 'btnLogInSettings'],
    ['#btnSettingsClose', 'btnSettingsClose'],
    /* --- 速率窗 / 快捷键窗 自己的按钮 ---
       ⚠ 这些按钮都长在 .anchor-btns 里面，所以**绝不能**再写一条 ['.anchor-btns button', …] 之类的
         通用兜底排在前面 —— 通用条目会把这些具体按钮全部吃掉（2026-09-21 实测确实如此：
         速率窗的「确定」被解析成「取消」的说明）。
       弹窗里的「确定 / 取消 / ×」按用户 2026-09-21 的批注**不再单独配说明**，
       由 find 末尾的通用兜底接住（拦下不执行 + 显示「暂无说明」）。 --- */
    ['.speed-ok', 'dlgOk'], ['.km-ok', 'dlgOk'],
    ['.speed-cancel', 'dlgCancel'], ['.km-cancel', 'dlgCancel'],
    ['.speed-reset', 'speedReset'], ['.km-reset', 'speedReset'],
    ['.fza-cancel', 'fzaCancel'],
    ['.fza-multi', 'fzaMulti'], ['.fza-src-btn', 'fzaSource'],
    ['.fza-body button.active', 'fzaImportFile']
  ];

  var armed = false;          /* 帮助模式是否开启 */
  var ov = null, titleEl = null, bodyEl = null, okBtn = null;
  var hint = null;            /* 底部提示条 */
  var last = null;            /* 最近一次显示的 { node, key }，切语言时按它重刷 */

  function t(k) { return App.i18n.t(k); }
  function tf(k, p) { return App.i18n.tf ? App.i18n.tf(k, p) : App.i18n.t(k); }
  function known(k) { return t(k) !== k; }

  /* 按钮的显示名：优先用 help.n.<标识>（给只有图标的按钮准备的），
     否则用按钮自身的文字（去掉 <kbd> 键位小标签），再退到 aria-label。
     —— 不另建一套「按钮名」词条：按钮文字本身就随语言变，直接读它最省事也最不容易脱节。 */
  function labelOf(node, key) {
    if (key) {
      var nk = 'help.n.' + key;
      if (known(nk)) return t(nk);
    }
    var clone = node.cloneNode(true);
    if (clone.querySelectorAll) {
      Array.prototype.forEach.call(clone.querySelectorAll('kbd'), function (k) { k.remove(); });
    }
    var txt = (clone.textContent || '').replace(/\s+/g, ' ').trim();
    if (txt) return txt;
    var aria = node.getAttribute && node.getAttribute('aria-label');
    if (aria) return aria;
    return key || '?';
  }

  /* 点单选/多选按钮的小圆点本身时，事件目标是 input，把它换算成对应的 label，
     这样「点页签文字」和「点页签圆点」走同一条登记 */
  function resolveTarget(target) {
    if (!target || !target.tagName) return target;
    if (target.tagName === 'INPUT' && target.type === 'radio' && target.id) {
      var lb = document.querySelector('label[for="' + target.id + '"]');
      if (lb) return lb;
    }
    return target;
  }

  function find(target) {
    for (var i = 0; i < MAP.length; i++) {
      var node = target.closest ? target.closest(MAP[i][0]) : null;
      if (node) return { node: node, key: MAP[i][1] };
    }
    /* ★ 通用兜底：登记表漏掉的按钮也必须拦下来。
       帮助模式下绝不能让动作真的执行（否则「删除所有图层」会被真按下去）；
       没有词条就显示「暂无说明」，顺带把漏网的按钮暴露出来。 */
    var generic = target.closest ? target.closest('button, input[type="range"], select') : null;
    if (generic) return { node: generic, key: null };
    return null;
  }

  /* ---------- 帮助窗 ---------- */
  function build() {
    if (ov && ov.isConnected) return ov;
    ov = document.createElement('div');
    ov.id = 'helpOv';
    ov.className = 'hidden';
    /* 只留底部一个「关闭」：右上角的 × 与它功能重复（用户 2026-09-21 要求去掉）。
       关窗途径：底部「关闭」按钮 / 点遮罩空白处。 */
    ov.innerHTML =
      '<div class="help-box" role="dialog" aria-modal="true">' +
        '<div class="help-title"></div>' +
        '<div class="help-body"></div>' +
        '<div class="help-foot"><button type="button" class="help-ok"></button></div>' +
      '</div>';
    document.body.appendChild(ov);
    titleEl = ov.querySelector('.help-title');
    bodyEl = ov.querySelector('.help-body');
    okBtn = ov.querySelector('.help-ok');
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    okBtn.addEventListener('click', function () { close(); });
    return ov;
  }

  function paint() {
    if (!last || !ov) return;
    var name = (last.node && last.node.isConnected) ? labelOf(last.node, last.key) : last.label;
    var txt = last.key ? t('help.' + last.key) : '';
    if (!txt || txt === 'help.' + last.key) txt = tf('help.unknown', { name: name });
    /* 用「·」而不是「：」分隔：按钮文字本身常带冒号（「网格：开」「背景：灰白」），
       两个冒号连在一起读着别扭 */
    titleEl.textContent = t('help.title') + ' · ' + name;
    bodyEl.textContent = txt;
    okBtn.textContent = t('help.close');
  }

  function open(hit) {
    build();
    last = { node: hit.node, key: hit.key, label: labelOf(hit.node, hit.key) };
    paint();
    App.showOverlay(ov);
  }
  function close() {
    if (!ov) return;
    App.hideOverlay(ov);
  }
  function closeNow() {
    if (!ov) return;
    ov.classList.add('hidden');
    ov.classList.remove('sve-closing');
    ov._sveHideToken = null;
  }

  /* ---------- 进入 / 退出帮助模式 ---------- */
  function showHint() {
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'helpHint';
      document.body.appendChild(hint);
    }
    hint.textContent = t('help.hint');
    hint.classList.add('sve-show');
  }
  function hideHint() { if (hint) hint.classList.remove('sve-show'); }

  function enter() {
    closeNow();                                  /* 上一轮的说明窗先收掉，避免两个窗叠着 */
    if (App.closeShortcutPanel) App.closeShortcutPanel();
    if (armed) return;
    armed = true;
    document.body.classList.add('sve-help-mode');
    var b = document.getElementById('btnShortcuts');
    if (b) b.classList.add('sve-help-armed');
    showHint();
  }
  function exit() {
    if (!armed) return;
    armed = false;
    document.body.classList.remove('sve-help-mode');
    var b = document.getElementById('btnShortcuts');
    if (b) b.classList.remove('sve-help-armed');
    hideHint();
  }

  /* ---------- 弹窗右下角的浮动帮助键 ----------
     为什么需要它：弹窗遮罩（.confirm-overlay，z-index 120）铺满全屏，会把顶部工具栏的 ? 盖住，
     右键不到 —— 用户要求「出现弹窗后在软件右下角再加个同款帮助按键，退出窗口后自动隐藏」。

     为什么不跟顶部那个 ? 完全同款（左键开快捷键一览表）：
     #shortcutPanel 的 z-index 是 70，而弹窗遮罩是 120 —— 弹窗开着时开快捷键表，它会被压在遮罩底下看不见。
     所以这个浮动键只当帮助入口：左键、右键都进入帮助模式。

     显隐怎么判：这里用**定时轮询**而不是去包 App.showOverlay/hideOverlay。
     包那两个函数能立刻响应，但以后有人新写一个不走它们的弹窗就会静默失效；
     轮询只查几个选择器、开销可以忽略，对「怎么被打开的」不挑食。 */
  var fab = null;

  /* 有「盖住界面的东西」开着吗。新增遮罩根节点时记得把它加进这个列表。
     #homeOverlay 是主页（z-index 80 < 浮动键 130）；它盖住的是画布区，
     主页上的按钮同样要能查帮助，所以主页也当作「需要浮动键」的场合。 */
  function dialogOpen() {
    var list = document.querySelectorAll('.confirm-overlay, #layerPickOv, #helpOv, #homeOverlay');
    for (var i = 0; i < list.length; i++) {
      if (!list[i].classList.contains('hidden')) return true;
    }
    return false;
  }

  function buildFab() {
    if (fab && fab.isConnected) return fab;
    fab = document.createElement('button');
    fab.id = 'helpFab';
    fab.type = 'button';
    fab.className = 'hidden';
    /* 图标直接抄顶部 ? 的 svg，两个键看起来才是同一套（拿不到 svg 就退到文字 ?） */
    var src = document.getElementById('btnShortcuts');
    var svg = (src && src.querySelector) ? src.querySelector('svg') : null;
    if (svg) fab.appendChild(svg.cloneNode(true));
    else fab.textContent = '?';
    document.body.appendChild(fab);
    var go = function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      enter();
    };
    fab.addEventListener('click', go);
    fab.addEventListener('contextmenu', go);
    return fab;
  }

  function syncFab() {
    var b = buildFab();
    var on = dialogOpen();
    b.classList.toggle('hidden', !on);
    if (!on) return;
    var nm = t('help.n.helpFab');
    b.setAttribute('aria-label', nm);
    b.setAttribute('title', nm);
    b.classList.toggle('sve-help-armed', armed);
  }

  /* ---------- 拦截：帮助模式下点按钮 = 看说明，不执行原动作 ---------- */
  function intercept(e) {
    if (!armed) return;
    var hit = find(resolveTarget(e.target));
    if (!hit) return;   /* 既没登记、也不是 button/range/select：放行（例如点界面空白背景） */
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    if (e.type === 'click') { open(hit); exit(); }
  }
  ['pointerdown', 'mousedown', 'click'].forEach(function (tp) {
    document.addEventListener(tp, intercept, true);
  });

  /* ---------- 右键：进入帮助模式 ---------- */
  function wire() {
    var b = document.getElementById('btnShortcuts');
    if (!b) return;
    b.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      enter();
    });
  }
  /* 帮助模式下，右键「?」以外的位置 = 退出（自然的「取消」）。
     顺便挡掉画布右键菜单与图层选择窗——它们与帮助模式混在一起只会让人困惑。 */
  document.addEventListener('contextmenu', function (e) {
    if (!armed) return;
    /* 右键「?」（顶部那个、或弹窗右下角那个）不算「右键别处」——那是帮助模式自己的入口 */
    var hit = (e.target && e.target.closest) ? e.target.closest('#btnShortcuts, #helpFab') : null;
    var b = document.getElementById('btnShortcuts');
    if (hit || (b && e.target === b)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    exit();
  }, true);

  /* ---------- Esc 退出（加载期注册，早于 main.js 的全局键盘处理） ---------- */
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !armed) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    exit();
  }, true);

  /* ---------- 切语言：提示条、说明窗、浮动键的提示文字跟着变 ---------- */
  if (App.i18n && App.i18n.onApply) {
    App.i18n.onApply(function () {
      if (hint && hint.classList.contains('sve-show')) hint.textContent = t('help.hint');
      if (ov && !ov.classList.contains('hidden')) paint();
      syncFab();
    });
  }

  wire();
  syncFab();
  setInterval(syncFab, 250);   /* 弹窗一开一关，右下角的 ? 就跟着出现/收起 */

  App.help = {
    isArmed: function () { return armed; },
    enter: enter,
    exit: exit,
    /* 给判据用：把元素按 MAP 解析成 { node, key }（含末尾的通用兜底）。
       用来做「MAP 顺序自检」——每个登记过的按钮都必须解析到**它自己**那条词条，
       不能被排在它前面的通用条目吃掉（2026-09-21 就踩过这个坑）。 */
    resolve: function (node) { return find(resolveTarget(node)); },
    dialogOpen: dialogOpen,
    MAP: MAP
  };
})();
