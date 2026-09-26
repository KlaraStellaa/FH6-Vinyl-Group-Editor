'use strict';
/* 左侧图层面板（无名字、实时图标、滚轮选择、拖拽排序）+ 总数 + 右侧面板缩放/最小化 + 右下粘贴板 */
App.initPanels = function () {
  App.layerListEl = $('#layerList');
  App.layerListEl.addEventListener('click', e => {
    /* 拖拽排序结束后的合成点击：吞掉，避免误选 */
    if (App.lastPanelDragEnd && Date.now() - App.lastPanelDragEnd < 200) return;
    const item = e.target.closest('.layer-item');
    if (!item) return;
    const id = parseInt(item.getAttribute('data-id'), 10);
    App.onLayerItemClick(id);
  });
  /* 双击图层项进入编辑 */
  App.layerListEl.addEventListener('dblclick', e => {
    const item = e.target.closest('.layer-item');
    if (!item || App.state.tabDown) return;
    const id = parseInt(item.getAttribute('data-id'), 10);
    if (App.state.selected.size > 1 && App.state.selected.has(id)) {
      App.enterEdit({ type: 'multi', ids: Array.from(App.state.selected) });
    } else {
      App.enterEdit({ type: 'layer', id });
    }
  });
  App.initLayerWheelNav();
  App.initLayerDragReorder();
  App.initPlusRow();          // 图层栏首位「+」功能栏（不算图层）
  App.initRightPanel();
  /* 白框停靠在「+」栏时按 Enter = 弹出注入窗口（两段式的第二段）。
     仅在非编辑模式、焦点不在输入框/可编辑元素时生效，不干扰既有 Enter 用途 */
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !App.state.plusAnchorActive || App.state.edit) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const ov = document.getElementById('fzaOv');
    if (ov && !ov.classList.contains('hidden')) return;   // 注入窗口已开着：交给窗口自身
    e.preventDefault();
    e.stopPropagation();
    App.openPlusPicker();
  });
  /* 滚动图层栏时按需补充可视范围内的缩略图 */
  App.layerListEl.addEventListener('scroll', () => App.fillVisibleThumbs(), { passive: true });
};

/* ---------- 图层栏首位「+」功能栏（常驻第一行） ----------
   规则：①不算图层（不参与图案总数/图层数）；②可被白框停靠（白框在它上面时，粘贴插入到第 2 位）；
   ③不参与多选与拖动排序（类名 .layer-plus，不进 .layer-item 集合，Tab 手势与拖拽自动忽略）；
   ④点击 = 与「注入选 SVG」完全一致的窗口（软件内 SVG 列表 + 导入 SVG 文件…）。 */
App.initPlusRow = function () {
  const list = App.layerListEl;
  const wrap = list ? list.parentElement : null;
  if (!list || !wrap || App.plusRowEl) return;
  const row = document.createElement('div');
  row.className = 'layer-plus';           // 关键：不是 .layer-item → 不进多选/拖拽/白框索引
  row.id = 'layerPlusRow';
  /* 文案走词条：+ 栏是常驻节点、不会重建，用 data-i18n 让切语言时 apply() 自动改写 title */
  row.setAttribute('data-i18n', 'panel.plusTip');
  row.setAttribute('data-i18n-attr', 'title');
  row.title = App.i18n.t('panel.plusTip');
  row.textContent = '+';
  row.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    /* 两段式：白框不在「+」栏 → 只把白框停靠过来（不弹窗）；已在「+」栏 → 再点一次才弹窗 */
    if (App.state.plusAnchorActive) App.openPlusPicker();
    else App.setPlusAnchor(true);
  });
  App.plusRowEl = row;
  list.insertBefore(row, list.firstChild);  // 作为滚动内容的第一个行：随图层栏一起上下滚动
  App.refreshPlusRow();
};
App.plusRowH = function () {
  const el = App.plusRowEl;
  if (!el) return 0;
  const cs = getComputedStyle(el);
  return el.offsetHeight + (parseFloat(cs.marginBottom) || 0);
};
App.refreshPlusRow = function () {
  const list = App.layerListEl;
  if (!list || !App.plusRowEl) return;
  if (list.firstChild !== App.plusRowEl) list.insertBefore(App.plusRowEl, list.firstChild);
};
/* 白框停靠到「+」栏 / 离开 */
App.setPlusAnchor = function (on) {
  on = !!on;
  if (!!App.state.plusAnchorActive === on) return;
  App.state.plusAnchorActive = on;
  if (on) {
    App.lastWheelIdx = undefined;   // 白框不再指向某个图层（这是位置指针，不是选择状态）
    App.state.selBarDismissed = true;
    /* 停靠只是白框位置变化：不得清空既有选择、也不得改写 selectedByTab。
       案底（用户报障）：按住 Tab 连续加选后，滚轮滑到或点击「+」栏，曾经的多选被整体取消。
       功能栏在停靠态本就隐藏（updateSelToolbar 已有 plusAnchorActive 分支），无需靠清空选择来收起。 */
  }
  if (App.plusRowEl) App.plusRowEl.classList.toggle('anchor', on);
  App.syncPanelSelectionClasses();
  App.updateSelToolbar();
  App.requestFlashRefresh();
  App.alignWheelScroll();
};
/* 点击它 = 与「注入选 SVG」一致的窗口（列表 + 导入 SVG 文件…）→ 选完走同一注入流程 */
/* 点「+」栏 = 把 SVG 打开到当前画布（与画布内「打开 SVG 文件」同一条路径：App.importSVGContent，
   追加导入并平移到当前视野中心）。
   弹窗只列软件内 SVGImages 目录里的 SVG（开源版不含游戏存档相关来源）。 */
App.openPlusPicker = async function () {
  const text = await App.fzaPickSvgLibrary();
  if (text === null) return;
  App.importSVGContent(text);
};

App.onLayerItemClick = function (id) {
  const layer = App.findLayer(id);
  if (!layer) return;
  if (App.state.tabDown) {
    /* 按住 Tab 点击：先回滚白框图层的自动加选/取消，再加入/移出多选；
       白框立刻选中点到的图层 */
    App.rollbackTabAutoSel();
    App.state.tabGestureUsed = true;
    App.toggleLayerSelection(layer);
    App.scrollItemToTop(layer);
  } else if (App.state.selected.size > 1 || (App.state.selectedByTab && App.state.selected.size >= 1)) {
    /* 多选（含遗留单选）状态下普通点击：绝不取消多选；白框移到点击的图层并呼出功能栏 */
    App.state.selBarDismissed = false;
    App.scrollItemToTop(layer);
    App.syncPanelSelectionClasses();
    App.updateSelToolbar();
    App.requestFlashRefresh();
  } else {
    /* 普通点击：单选该图层（普通单选不显示红三角） */
    if (App.setPlusAnchor) App.setPlusAnchor(false);   // 离开「+」栏停靠
    App.state.selectedByTab = false;
    App.lastWheelIdx = undefined;
    App.state.selBarDismissed = false;
    App.setSelection([id]);
    App.scrollItemToTop(layer);
  }
};

/* ---------- 白框固定第 4 行：滚轮/按键滚动图层列表（按住 Tab = 扫选） ---------- */
App.lastWheelIdx = undefined;
App._progScrollTop = null;   /* alignWheelScroll 最近一次程序性 scrollTop 落点（scrollend 用于识别程序性滚动） */
/* 一行图层的高度（含间距）：用两个相邻条目的 offsetTop 差测量，与 CSS 解耦 */
App.layerRowH = function () {
  const items = $$('.layer-item', App.layerListEl);
  if (items.length >= 2) {
    const h = items[1].offsetTop - items[0].offsetTop;
    if (h > 0) return h;
  }
  const it = items[0];
  if (it) {
    const cs = getComputedStyle(it);
    return it.offsetHeight + (parseFloat(cs.marginBottom) || 0);
  }
  return 76;
};
/* 白框固定在上往下第 2 行（其上方 = 1 行留白 + 「+」栏）：顶部留 1 行空白、底部补足视口，
   滚动列表使当前图层（lastWheelIdx）恰好对准白框；位置域最顶一格是「+」栏（滚轮可停靠） */
App.alignWheelScroll = function () {
  const list = App.layerListEl;
  const wb = $('#wheelBox');
  if (!list || !wb) return;
  /* 列表隐藏（编辑模式左侧面板隐藏）时跳过：此时 clientHeight 为 0，对齐会错误滚回 0 */
  if (!list.clientHeight) return;
  const rh = App.layerRowH();
  const plusH = App.plusRowH();   // 「+」栏是图层面的第一行（排在顶部 1 行留白之下，随列表滚动）
  const n = App.state.layers.length;
  /* 白框固定在第 2 行（其上方 1 行留白），「+」栏作为图层面的第一行紧随留白之后。
     白框 top 只是视觉；判定走 lastWheelIdx → scrollTop = idx*rh，两者必须同口径（曾错位一行） */
  list.style.paddingTop = (1 * rh) + 'px';
  list.style.paddingBottom = Math.max(0, list.clientHeight - 2 * rh) + 'px';
  /* 白框屏幕位置恒定（常态 = 停靠态同位）：停靠靠「+」栏下移来贴框，白框不上移 */
  wb.style.top = (1 * rh + plusH) + 'px';
  wb.style.height = Math.max(40, rh - 4) + 'px';
  wb.classList.remove('hidden');   /* 无图层时也显示白框（停在「+」栏上，用户要求） */
  if (!n) {
    /* 无图层：白框【屏幕位置不动】（保持上面设的常态 top），由「+」栏下移一行移到白框位置贴住它
       —— 与用户主动停靠同一套机制（用户要求：「+框移动到白框位置，白框位置不动」）。
       emptyForce 标记「这是空态强制停靠」：重新有图层后自动解除。 */
    if (!App.state.plusAnchorActive && App.setPlusAnchor) {
      App.state.plusAnchorEmptyForce = true;
      App.setPlusAnchor(true);
    }
    if (App.plusRowEl) App.plusRowEl.style.marginTop = plusH + 'px';
    list.scrollTop = 0;
    return;
  }
  if (App.state.plusAnchorEmptyForce && App.state.plusAnchorActive) {
    App.state.plusAnchorEmptyForce = false;
    if (App.setPlusAnchor) App.setPlusAnchor(false);   /* 有图层了：白框回到图层行 */
  }
  /* 白框停靠在「+」栏上：「+」栏下来一行正好压在白框下（白框保持屏幕位置不动），列表滚到最顶 */
  if (App.state.plusAnchorActive) {
    if (App.plusRowEl) App.plusRowEl.style.marginTop = plusH + 'px';
    list.scrollTop = 0;
    return;
  }
  if (App.plusRowEl) App.plusRowEl.style.marginTop = '';
  /* 白框索引未建立时回退到选中图层（与 whiteBoxLayer 判定一致），绝不直接跳第 0 位 */
  let idx;
  if (App.lastWheelIdx !== undefined) idx = clamp(App.lastWheelIdx, 0, n - 1);
  else if (App.state.selected.size === 1) {
    const ids = App.state.layers.slice().reverse().map(l => l.id);
    idx = ids.indexOf(Array.from(App.state.selected)[0]);
    if (idx < 0) idx = 0;
  } else {
    idx = 0;
  }
  App.lastWheelIdx = idx;
  const max = Math.max(0, list.scrollHeight - list.clientHeight);
  /* 判定口径：idx 是"面板顺序（最上层在前）"里的位置；列表顶部有 1 行留白，「+」栏在留白之下，
     图层行从 y=1*rh+plusH 开始。idx=0 的图层到白框处 → scrollTop=0；
     故 scrollTop = clamp(idx*rh, 0, max) 与白框 top=(1*rh+plusH) 同口径（两者都用 idx*rh 对齐） */
  const target = clamp(idx * rh, 0, max);   /* 白框对齐（吸附式） */
  /* 值真的变了才写，并记下期望落点供 scrollend 识别程序性滚动（残留标记会吞掉下一次手势） */
  if (Math.abs(list.scrollTop - target) > 0.5) { App._progScrollTop = target; list.scrollTop = target; }
};
App.initLayerWheelNav = function () {
  App.layerListEl.addEventListener('wheel', e => {
    if (!App.state.layers.length) return;
    e.preventDefault();
    e.stopPropagation();
    App.stepWhiteBox(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });
  /* 手动拖动滚动条后：吸附回整行，并更新白框当前图层；
     拖到最顶（越过第 0 层）与滚轮同义 = 白框停靠「+」栏（用户要求：滑条也要能到「+」栏） */
  App.layerListEl.addEventListener('scrollend', () => {
    const list = App.layerListEl;
    const n = App.state.layers.length;
    if (!n) return;
    /* 程序性滚动识别：alignWheelScroll 写 scrollTop 前记下期望落点（_progScrollTop），
       落点吻合即对齐自身产生的滚动、不算用户手势——否则每次对齐到第 0 层都会误停靠 */
    if (App._progScrollTop !== null && Math.abs(list.scrollTop - App._progScrollTop) < 0.5) {
      App._progScrollTop = null;
      return;
    }
    App._progScrollTop = null;
    const rh = App.layerRowH();
    if (App.state.plusAnchorActive) {
      /* 停靠态：只有用户真的把列表滚离顶部才算离开停靠；
         离开前先把位置指针放到用户拖到的那一行（否则回退到单选图层 = 白框跳转 bug） */
      if (list.scrollTop > 0) {
        App.lastWheelIdx = clamp(Math.round(list.scrollTop / rh), 0, n - 1);
        App.setPlusAnchor(false);
      }
      return;
    }
    const idx = clamp(Math.round(list.scrollTop / rh), 0, n - 1);
    if (idx !== App.lastWheelIdx) {
      App.lastWheelIdx = idx;
      App.syncPanelSelectionClasses();
      App.requestFlashRefresh();
      App.updateSelToolbar();
    }
    /* 拖到最顶：位置域最上一格是「+」栏（与滚轮在 idx 0 再上滚同义） */
    if (list.scrollTop <= 0) { App.setPlusAnchor(true); return; }
    App.alignWheelScroll();
  });
};
/* dir: 1 = 白框向底层移动，-1 = 向上层移动（列表随之滚动一行） */
App.stepWhiteBox = function (dir) {
  const n = App.state.layers.length;
  if (!n) return;
  const ids = App.state.layers.slice().reverse().map(l => l.id); // 面板顺序（最上层在前）
  let ni;
  /* 「+」栏停靠态纳入滚轮位置域：向下滚一格 = 离开停靠、回到第 0 个图层行（只走一格）；
     向上滚保持停靠不动（「+」栏已是位置域最顶格） */
  if (App.state.plusAnchorActive) {
    if (dir !== 1) return;
    /* 离开「+」栏 = 落到「+」栏下方第一个图层（面板第 0 位）。
       必须先把位置指针写回 0：停靠时它被置为 undefined，alignWheelScroll 会回退到
       「单选图层」→ 白框瞬移到那个图层（用户报障：误以为是点「定位图层位置」触发的跳转） */
    ni = 0;
    App.lastWheelIdx = ni;
    App.setPlusAnchor(false);
    /* 注意：这里**不能 return**——「离开停靠」这一格本身就是落在第 0 行上，必须继续走下面的扫选逻辑。
       否则按住 Tab 从「+」栏往下扫时：① 第 0 行永远不参与扫选（表现为「第一个图层总选不上」）；
       ② sweepMode 从未被定过（停靠态 actOnWhiteBoxLayer 直接 return），
          于是「批量取消高亮」会退化成加选（表现为「取消不生效」）。案底：2026-09-20 用户报障。 */
  } else {
    let i;
    if (App.lastWheelIdx !== undefined) {
      /* 白框位置记忆：从上次白框位置继续，绝不瞬移到选中图层 */
      i = App.lastWheelIdx;
    } else if (App.state.tabDown) {
      const selIdx = Array.from(App.state.selected).map(id => ids.indexOf(id)).filter(j => j >= 0);
      i = selIdx.length ? Math.min(...selIdx) : 0;
    } else if (App.state.selected.size === 1) {
      i = ids.indexOf(Array.from(App.state.selected)[0]);
      if (i < 0) i = 0;
    } else {
      i = 0;
    }
    ni = clamp(i + dir, 0, n - 1);
    if (ni === i) {
      /* 顶层（idx 0）再向上滚：白框进入「+」栏停靠（位置域 = n 个图层行 + 最顶「+」栏一格） */
      if (dir === -1 && i === 0) App.setPlusAnchor(true);
      return; // 已到边界：不再重复切换
    }
    App.lastWheelIdx = ni;
  }
  if (App.state.tabDown) {
    /* 按住 Tab 扫选：白框图层已在按下的瞬间响应；按既定方向继续扫，
       取消扫过中反向移动只移白框（不误删其余选定） */
    App.state.tabGestureUsed = true;
    /* 滚轮扫选即确认了多选集合：Tab 按下瞬间的自动加选不再回滚——
       否则扫选后点击任一图层时 rollbackTabAutoSel 会把扫选集合里的层
       意外移出（"点到第二个第一个就取消"的根因之一） */
    App.state.tabAutoSel = null;
    /* 扫选方向模式：正常路径由 actOnWhiteBoxLayer 在 Tab 按下时按白框图层的选中状态定好；
       只有「白框停在「+」栏上」这条路径进来时它还是 null（那里没有图层可判），
       此时按**第一个真正扫过的图层**的选中状态定：未选=加选、已选=取消，
       与 Tab 的切换语义一致（也才能让「从 + 栏往下批量取消高亮」成立）。 */
    if (!App.state.sweepMode) {
      App.state.sweepMode = App.state.selected.has(ids[ni]) ? 'remove' : 'add';
    }
    if (!App.state.sweepDir) App.state.sweepDir = dir;
    if (App.state.sweepMode === 'remove' && dir !== App.state.sweepDir) {
      App.syncPanelSelectionClasses();
      App.alignWheelScroll();
      App.requestFlashRefresh();
      return;
    }
    const s = new Set(App.state.selected);
    if (App.state.sweepMode === 'add') {
      if (!s.has(ids[ni])) {
        s.add(ids[ni]);
        App.state.selectedByTab = s.size >= 1;
        App.setSelection(Array.from(s));
      } else {
        App.syncPanelSelectionClasses();
      }
    } else {
      if (s.has(ids[ni])) {
        s.delete(ids[ni]);
        App.state.selectedByTab = s.size >= 1;
        App.setSelection(Array.from(s));
      } else {
        App.syncPanelSelectionClasses();
      }
    }
  } else {
    /* 未按 Tab：只移动白框，绝不改变选择（防止把仅剩的选定取消） */
    App.syncPanelSelectionClasses();
  }
  /* 白框固定第 4 行：滚动列表把当前图层对准白框 */
  App.alignWheelScroll();
  /* 白框移动：闪动提示立即跟上白框所在图层 */
  App.requestFlashRefresh();
  /* 白框切换图层：立即收起选中功能栏（Tab 扫选除外，扫选不呼出功能栏） */
  if (!App.state.tabDown) {
    App.state.selBarDismissed = true;
    App.updateSelToolbar();
  }
};

/* 白框/选中变化后刷新闪动覆盖层（animate=false 表示只同步不重启动画） */
App.requestFlashRefresh = function (animate) {
  if (App.state.batching) return;
  /* 用户触发的新一次闪动从此刻重新起算 5 秒；静默内容刷新只同步覆盖层，不扰乱周期。 */
  App.ensureFlashRunning(animate !== false);
  App.updateFlashOverlays(animate);
};

/* ---------- 图层拖拽自由插入（指针实现 + 白色插入指示线） ---------- */
App.initLayerDragReorder = function () {
  const list = App.layerListEl;
  let drag = null; // {id, startX, startY, active, item}
  App.dropIndicator = document.createElement('div');
  App.dropIndicator.id = 'dropIndicator';
  list.appendChild(App.dropIndicator);

  list.addEventListener('pointerdown', e => {
    /* 按住 Tab 时点击=切换选中，禁止启动拖拽排序（防止手抖变成拖动，
       松手后合成点击落到重排后第一项导致“莫名其妙选中第一个图层”） */
    if (e.button !== 0 || App.state.edit || App.state.tabDown) return;
    const item = e.target.closest('.layer-item');
    if (!item) return;
    drag = {
      id: parseInt(item.getAttribute('data-id'), 10),
      startX: e.clientX, startY: e.clientY,
      active: false,
      item
    };
  });
  window.addEventListener('pointermove', e => {
    if (!drag) return;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 6) return;
      drag.active = true;
      drag.item.classList.add('drag-ghost');
      App.showDragGhost(drag.item, e.clientX, e.clientY);
    }
    App.moveDragGhost(e.clientX, e.clientY);
    App.updateDropIndicator(e.clientY);
  });
  window.addEventListener('pointerup', e => {
    if (!drag) return;
    const wasActive = drag.active;
    const id = drag.id;
    drag = null;
    App.hideDropIndicator();
    App.hideDragGhost();
    if (!wasActive) return;
    const q = App.dropIndexAt(e.clientY);
    if (q !== null && q !== undefined) App.reorderLayer(id, q);
    /* 记录拖拽结束时刻：吞掉紧随其后的合成点击，避免误选重排后位置的图层 */
    App.lastPanelDragEnd = Date.now();
  });
  window.addEventListener('pointercancel', () => {
    if (!drag) return;
    drag = null;
    App.hideDropIndicator();
    App.hideDragGhost();
    App.clearDropMark();
  });
};
/* 拖拽浮影：图标跟随鼠标 */
App.showDragGhost = function (item, x, y) {
  App.hideDragGhost();
  const src = item.querySelector('img');
  App.dragGhostEl = document.createElement('div');
  App.dragGhostEl.className = 'drag-ghost-float';
  if (src) App.dragGhostEl.appendChild(src.cloneNode());
  document.body.appendChild(App.dragGhostEl);
  App.moveDragGhost(x, y);
};
App.moveDragGhost = function (x, y) {
  if (!App.dragGhostEl) return;
  App.dragGhostEl.style.left = (x + 10) + 'px';
  App.dragGhostEl.style.top = (y + 10) + 'px';
};
App.hideDragGhost = function () {
  if (App.dragGhostEl) { App.dragGhostEl.remove(); App.dragGhostEl = null; }
};
App.dropIndexAt = function (clientY) {
  const ids = App.state.layers.slice().reverse().map(l => l.id);
  const items = $$('.layer-item', App.layerListEl);
  let q = ids.length; // 默认插入到最底层
  for (let p = 0; p < items.length; p++) {
    const r = items[p].getBoundingClientRect();
    if (clientY < r.top + r.height / 2) { q = p; break; }
  }
  return q;
};
App.updateDropIndicator = function (clientY) {
  if (!App.dropIndicator) return;
  const items = $$('.layer-item', App.layerListEl);
  const q = App.dropIndexAt(clientY);
  let top;
  if (q >= items.length) {
    const last = items[items.length - 1];
    top = last ? last.offsetTop + last.offsetHeight + 2 : 4;
  } else {
    top = items[q].offsetTop - 2;
  }
  App.dropIndicator.style.top = Math.max(2, top) + 'px';
  App.dropIndicator.classList.add('visible');
};
App.hideDropIndicator = function () {
  if (App.dropIndicator) App.dropIndicator.classList.remove('visible');
};
App.clearDropMark = function () {
  $$('.layer-item.drop-before, .layer-item.drop-after, .layer-item.drag-ghost', App.layerListEl).forEach(it =>
    it.classList.remove('drop-before', 'drop-after', 'drag-ghost'));
};

/* 把图层移动到面板第 q 个位置（0=最上层；q=总数=最底层） */
App.reorderLayer = function (id, q) {
  const i = App.state.layers.findIndex(l => l.id === id);
  if (i < 0) return;
  App.history.markDiscrete();
  const [l] = App.state.layers.splice(i, 1);
  const after = App.state.layers.length;
  const arrIdx = clamp(after - q, 0, after);
  App.state.layers.splice(arrIdx, 0, l);
  App.state.layers.forEach(x => App.layersRoot.appendChild(x.el));
  /* 重排改变交互层相对位置：静态化背景与隐藏集合失效（否则层错位/消失/双重显示） */
  if (App.invalidateEditStatic && App.editStatic && App.editStatic.active) App.invalidateEditStatic();
  App.refreshPanel();
  App.clearDropMark();
  /* 内容变化（z 顺序改变）：位图缓存里烘着旧的层序，必须失效重绘 */
  if (App.contentChanged) App.contentChanged();
};

App.refreshPanel = function () {
  if (!App.layerListEl) return;
  const list = App.state.layers.slice().reverse(); // 最上层排最前
  /* 按 id 复用已有条目 DOM（单图层操作只增删一个节点，千层文档也不卡） */
  const existing = new Map();
  $$('.layer-item', App.layerListEl).forEach(el => {
    existing.set(parseInt(el.getAttribute('data-id'), 10), el);
  });
  const wantedIds = new Set(list.map(l => l.id));
  existing.forEach((el, id) => { if (!wantedIds.has(id)) el.remove(); });
  list.forEach(layer => {
    let item = existing.get(layer.id);
    if (!item) {
      item = document.createElement('div');
      item.className = 'layer-item';
      item.setAttribute('data-id', layer.id);
      const selectedBg = document.createElement('span');
      selectedBg.className = 'layer-select-bg';
      selectedBg.setAttribute('aria-hidden', 'true');
      item.appendChild(selectedBg);
      const thumb = document.createElement('div');
      thumb.className = 'layer-thumb';
      const img = document.createElement('img');
      img.draggable = false;
      thumb.appendChild(img);
      item.appendChild(thumb);
    }
    if (!item.querySelector('.layer-select-bg')) {
      const selectedBg = document.createElement('span');
      selectedBg.className = 'layer-select-bg';
      selectedBg.setAttribute('aria-hidden', 'true');
      item.insertBefore(selectedBg, item.firstChild);
    }
    item.classList.toggle('selected', App.state.selected.has(layer.id));
    let badge = item.querySelector('.layer-badge');
    if (layer.kind === 'merged') {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'layer-badge';
        item.appendChild(badge);
      }
      badge.textContent = '×' + App.countInLayer(layer);
    } else if (badge) {
      badge.remove();
    }
    /* 蒙版图层：图标右下角黑色小三角 */
    let mb = item.querySelector('.mask-badge');
    if (layer.isMask) {
      if (!mb) {
        mb = document.createElement('span');
        mb.className = 'mask-badge';
        item.appendChild(mb);
      }
    } else if (mb) {
      mb.remove();
    }
    App.layerListEl.appendChild(item); // 已挂载的节点按新顺序移动，O(1)
  });
  /* 面板重建后重新挂载拖拽指示线 + 保持「+」功能栏在首位 */
  if (App.dropIndicator) App.layerListEl.appendChild(App.dropIndicator);
  App.refreshPlusRow();
  App.syncPanelSelectionClasses();
  App.fillVisibleThumbs(); // 只生成可视范围内的缩略图（大量图层时不卡顿）
  App.alignWheelScroll(); // 白框固定第 4 行：增删图层后保持当前图层对准白框
};

/* 仅生成可视区域内的图层缩略图（滚动时按需补充；脏缩略图即时刷新） */
App.fillVisibleThumbs = function () {
  const list = App.layerListEl;
  if (!list) return;
  const st = list.scrollTop, vh = list.clientHeight;
  $$('.layer-item', list).forEach(item => {
    const top = item.offsetTop, bottom = top + item.offsetHeight;
    if (bottom < st - 80 || top > st + vh + 80) return;
    const id = parseInt(item.getAttribute('data-id'), 10);
    const layer = App.findLayer(id);
    if (!layer) return;
    /* 编辑大分组期间跳过其缩略图重绘（序列化数千子元素开销大），退出编辑时统一刷新 */
    if (App.state.edit && layer.kind === 'merged') return;
    const img = $('img', item);
    if (img && img.getAttribute('src') && !layer.thumbDirty) return;
    if (item.dataset.thumbLoading === '1') return;
    item.dataset.thumbLoading = '1';
    const thumb = $('.layer-thumb', item);
    const loader = App.startThumbLoading(thumb);
    App.getLayerThumb(layer).then(async url => {
      if (!img || !img.isConnected || !url) return;
      await App.showThumbImage(thumb, img, url, loader);
    }).catch(e => {
      console.warn('[thumb] 图层栏缩略图生成失败', layer && layer.id, String(e && e.message || e).slice(0, 160));
    }).finally(() => {
      App.finishThumbLoading(thumb, loader);
      if (item.isConnected) delete item.dataset.thumbLoading;
    });
  });
};

App.syncPanelSelectionClasses = function () {
  $$('.layer-item', App.layerListEl).forEach((item) => {
    const id = parseInt(item.getAttribute('data-id'), 10);
    const inSel = App.state.selected.has(id);
    /* 红三角显示规则：多选（≥2）或按住 Tab，或 Tab 操作留下的单选；普通点击的单选不显示 */
    const showTri = inSel && (App.state.selected.size > 1 || App.state.tabDown || (App.state.selected.size === 1 && App.state.selectedByTab));
    /* .multi-sel 仅保留为状态钩子；底色由预创建的独立层做 opacity 合成，
       避免类选择器背景变化触发包含数千 SVG 节点的全页样式/绘制失效。 */
    if (item.classList.contains('multi-sel') !== inSel) item.classList.toggle('multi-sel', inSel);
    const selectedBg = item.querySelector('.layer-select-bg');
    if (selectedBg) {
      const opacity = inSel ? '1' : '0';
      if (selectedBg.style.opacity !== opacity) selectedBg.style.opacity = opacity;
    }
    let tri = item.querySelector('.tri');
    if (showTri) {
      if (!tri) {
        tri = document.createElement('span');
        tri.className = 'tri';
        item.appendChild(tri);
      }
    } else if (tri) {
      tri.remove();
    }
  });
};

App.refreshCount = function () {
  $('#totalCount').textContent = App.i18n.t('panel.totalPrefix') + App.countPatterns();
  if (App.updateHideLayersButton) App.updateHideLayersButton();
  if (App.updateLayersDisplaySlider) App.updateLayersDisplaySlider();
};

/* 把目标图层滚动到白框（第 4 行）位置：设置白框索引并对齐列表 */
App.scrollItemToTop = function (layer, instant) {
  if (!App.layerListEl || !layer) return;
  if (App.state.plusAnchorActive) App.setPlusAnchor(false);   // 定位到真实图层 = 离开「+」栏停靠
  const ids = App.state.layers.slice().reverse().map(l => l.id);
  const i = ids.indexOf(layer.id);
  if (i < 0) return;
  App.lastWheelIdx = i;
  App.alignWheelScroll();
};

App.updateBaseButtons = function () {
  $('#btnBase').textContent = App.i18n.t(App.state.bg.base === 'light' ? 'toolbar.baseLight' : 'toolbar.baseDark');
  $('#btnGrid').textContent = App.i18n.t(App.state.bg.grid ? 'toolbar.gridOn' : 'toolbar.gridOff');
  $('#btnBgImage').textContent = App.i18n.t(App.state.bg.image ? 'toolbar.bgSet' : 'toolbar.bgNone');
  /* btnBase / btnGrid 是纯文字按钮，不受影响；btnBgImage 已图标化，
     文案刚被改写 → 必须重挂图标，否则一改背景图就退回文字按钮。 */
  if (App.refreshToolbarIcons) App.refreshToolbarIcons();
};

App.switchTab = function (name) {
  const radio = document.querySelector('#panelTabs input[value="' + name + '"]');
  if (radio) radio.checked = true;
  $('#libTab').classList.toggle('hidden', name !== 'lib');
  $('#colorTab').classList.toggle('hidden', name !== 'color');
  /* EvolveUI glider 定位 */
  const track = document.querySelector('#panelTabs .ev-tabs-track');
  if (track) {
    const checked = track.querySelector('input:checked');
    const label = checked ? track.querySelector('label[for="' + checked.id + '"]') : null;
    const glider = track.querySelector('.ev-glider');
    if (label && glider) {
      glider.style.width = label.offsetWidth + 'px';
      glider.style.transform = 'translateX(' + label.offsetLeft + 'px)';
    }
  }
  /* 切页签：撤销未点「应用」的颜色预览（需求：预览不保留） */
  if (App.cancelColorPreview) App.cancelColorPreview();
};

/* 图案库子页签（彩绘纹饰形状 / 已保存的彩绘）与已保存面板已按用户要求于 2026-09-12 整块删除 */

/* ---------- 右侧面板：拖边调宽 + 最小化 ---------- */
App.initRightPanel = function () {
  const rp = $('#rightPanel'), rz = $('#panelResizer'), btn = $('#panelMinBtn');
  /* 2026-09-12 子页签与已保存彩绘按钮已删除，对应接线一并移除 */
  rz.addEventListener('pointerdown', e => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = rp.getBoundingClientRect().width;
    const move = ev => {
      const w = clamp(startW + (startX - ev.clientX), 210, 680);
      rp.style.width = w + 'px';
      rp.dataset.lastWidth = w;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  btn.addEventListener('click', () => App.toggleRightPanel());
  /* 折叠态：鼠标贴屏幕右缘停留 600ms 后自动呼出整栏（延迟防误触：快速移向展开按键不会被劫持）；
     移出贴边区域或栏自动折叠（仅限自动呼出的） */
  let _autoT = null;
  window.addEventListener('mousemove', e => {
    if (!rp.classList.contains('minimized')) { clearTimeout(_autoT); _autoT = null; return; }
    const wrap = $('#canvasWrap');
    if (!wrap) return;
    const wr = wrap.getBoundingClientRect();
    if (e.clientY < wr.top || e.clientY > wr.bottom) { clearTimeout(_autoT); _autoT = null; return; }
    if (e.clientX >= window.innerWidth - 4) App.toggleRightPanel(true, true);
  });
  rp.addEventListener('mouseleave', () => {
    clearTimeout(_autoT); _autoT = null;
    if (rp.dataset.autoOpen === '1') App.toggleRightPanel(false, true);
  });
  /* EvolveUI 页签切换：radio change → switchTab + glider 定位 */
  const track = document.querySelector('#panelTabs .ev-tabs-track');
  if (track) {
    track.querySelectorAll('input[type="radio"]').forEach(r => {
      r.addEventListener('change', () => App.switchTab(r.value));
    });
    requestAnimationFrame(() => App.switchTab('lib'));
  }
};

/* 右侧栏折叠/展开（宽度过渡；隐藏图层/隐藏背景按键与两个滑条由布局连续跟随画布边缘）。
   open 缺省 = 切换；auto=true 表示由鼠标贴边呼出：移出栏时会自动折叠 */
App.toggleRightPanel = function (open, auto) {
  const rp = $('#rightPanel'), btn = $('#panelMinBtn');
  if (!rp || !btn) return;
  const min = rp.classList.contains('minimized');
  const wantMin = (open === undefined) ? !min : !open;   /* 目标：true=折叠 */
  if (wantMin === min) { if (auto !== undefined) rp.dataset.autoOpen = auto ? '1' : ''; return; }
  rp.classList.add('sve-panel-anim');
  setTimeout(() => rp.classList.remove('sve-panel-anim'), 280);
  if (!wantMin) {
    rp.classList.remove('minimized');
    rp.style.width = (rp.dataset.lastWidth || 312) + 'px';
    btn.textContent = '▶';
    if (auto !== undefined) rp.dataset.autoOpen = auto ? '1' : ''; else delete rp.dataset.autoOpen;
  } else {
    /* 记录"上次宽度"用内联样式值（逻辑宽度），不读动画中的实时 rect——
       否则宽度过渡中途收起会把动画中的小宽度记下来，下次展开只展开到那么宽 */
    const cur = parseInt(rp.style.width, 10) || parseInt(rp.dataset.lastWidth, 10) || 312;
    if (cur > 60) rp.dataset.lastWidth = String(cur);
    rp.classList.add('minimized');
    btn.textContent = '◀';
    delete rp.dataset.autoOpen;
  }
};

/* ---------- 右下角粘贴板 ---------- */
App.refreshClipboardPanel = function () {
  const panel = $('#clipboardPanel');
  const box = $('#cpThumbBox');
  App._clipboardPanelSeq = (App._clipboardPanelSeq || 0) + 1;
  const seq = App._clipboardPanelSeq;
  const slims = App.state.clipboard;
  if (!slims || !slims.length) {
    panel.classList.add('hidden');
    App.finishThumbLoading(box);
    const img = $('#cpThumbImg');
    img.src = '';
    img.style.cssText = '';
    box.style.cssText = '';
    panel.style.width = '';
    return;
  }
  panel.classList.remove('hidden');
  $('#cpCount').textContent = '×' + slims.length;
  const loader = App.startThumbLoading(box);
  App.renderClipboardComposite(slims).then(async res => {
    if (seq !== App._clipboardPanelSeq || !res || !res.url) return;
    const img = $('#cpThumbImg');
    /* 面板尺寸固定不变：图片按内容自身比例自适应显示在固定框内（不撑大面板/框） */
    const loaded = await App.showThumbImage(box, img, res.url, loader);
    if (!loaded || seq !== App._clipboardPanelSeq) return;
    const w = res.bw, h = res.bh;
    if (!w || !h) { img.style.cssText = ''; return; }
    const boxW = 182, boxH = 102; // 固定框内容区
    const s = Math.min(boxW / w, boxH / h);
    img.style.width = Math.round(w * s) + 'px';
    img.style.height = Math.round(h * s) + 'px';
  }).catch(e => {
    console.warn('[thumb] 粘贴板缩略图生成失败', String(e && e.message || e).slice(0, 160));
  }).finally(() => App.finishThumbLoading(box, loader));
};

/* 剪切板合成缩略图：所有剪切图层的总体形状（含大小/旋转/相对位置），与图层栏一致。
   返回 { url, bw, bh }：bw/bh 为内容实际宽高（自动检测，用于自适应显示） */
App.renderClipboardComposite = async function (slims) {
  let g = null;
  try {
    App._clipboardThumbSeq = (App._clipboardThumbSeq || 0) + 1;
    const children = App.deserializeLayersDetached(slims, 'clipthumb_' + App._clipboardThumbSeq + '_');
    g = svgEl('g');
    const symLayers = [];
    const collect = l => {
      if (l.kind === 'symbol') symLayers.push(l);
      if (l.kind === 'merged' && l.children) l.children.forEach(collect);
    };
    children.forEach(ch => {
      App.buildLayerElement(ch);
      g.appendChild(ch.el);
      collect(ch);
    });
    const fake = { kind: 'merged', children, el: g, sx: 1, sy: 1, rot: 0, skew: 0, x: 0, y: 0 };
    (App.hiddenThumbHost || App.svg).appendChild(g);
    /* 内容包围盒（自动检测剪切图层总体大小与比例） */
    const lb = App.mergedThumbGeometry(fake).lb;
    const bw = lb.w || 1, bh = lb.h || 1;
    /* 渲染分辨率自适应：按内容大小取 160~1024（不再固定 96 小方图） */
    const size = Math.min(1024, Math.max(160, Math.round(Math.max(bw, bh) * 0.5)));
    /* 等彩色剪影 PNG 就绪后再光栅化，否则符号图层是空白的 */
    await Promise.all(symLayers.map(l => App.symbolColorUrl(l)));
    const url = await App.mergedThumbUrl(fake, size);             /* 全部叶子合成；蒙版按层序挖空 */
    return { url, bw, bh };
  } catch (e) {
    console.warn('[thumb] renderClipboardComposite 失败', String(e && e.message || e).slice(0, 160));
    return null;
  } finally {
    if (g && g.remove) g.remove();
  }
};

/* 2026-09-12 用户要求删除：「已保存的彩绘」面板相关函数（savedSel/refreshSavedPanel/paletteExportSelected/paletteDeleteSelected/paletteConfirm）整块移除 */
