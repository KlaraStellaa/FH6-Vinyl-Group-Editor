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
function fzaThumbRow(group, opts) {
  opts = opts || {};
  /* 与官方一致：行文本 = "标题 - 作者"（无额外后缀）；缩略图 72px；加载失败显示兜底图标 */
  const wrap = document.createElement('span');
  wrap.className = 'fza-row';
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
  wrap.appendChild(box);
  const label = document.createElement('span');
  label.className = 'anchor-name';
  label.textContent = group.title + ' - ' + group.author;
  wrap.appendChild(label);
  /* 选择标记：多选态由 确定/取消 控制，点击由外层事件委托处理（此处仅承载勾选样式与锚点） */
  const mark = document.createElement('span');
  mark.className = 'fza-check';
  mark.setAttribute('data-check', '1');
  mark.textContent = '✓';
  wrap.appendChild(mark);
  if (opts.setChecked) {
    mark.style.display = 'none';                 // 由外层 paint 控制显隐
    wrap.setChecked = on => { mark.style.display = on ? '' : 'none'; };
  } else {
    mark.style.display = 'none';                 // 单选态不显示勾选
  }
  const loadThumb = async externalLoader => {
    if (box.dataset.thumbStarted === '1') return;
    box.dataset.thumbStarted = '1';
    const loader = externalLoader || App.startThumbLoading(box);
    let url = '';
    try {
      if (window.sveApi && group.thumbnail) {
        const r = await window.sveApi.forzaThumb(group.thumbnail);
        url = r && r.ok ? r.dataUrl : '';
      }
      if (url) {
        const loaded = await App.showThumbImage(box, img, url, loader);
        if (loaded) {
          img.classList.add('loaded');
          fb.style.display = 'none';
          return;
        }
      }
      fb.style.display = ''; // 失败/无图：保留兜底图标（绝不空白）
    } catch (e) {
      console.warn('[picker] 游戏缩略图读取失败', group && group.title, String(e && e.message || e).slice(0, 160));
      if (fb.isConnected) fb.style.display = '';
    } finally {
      App.finishThumbLoading(box, loader);
    }
  };
  wrap.loadThumb = loadThumb;
  wrap.thumbBox = box;
  if (!opts.deferThumb) loadThumb();
  return wrap;
}

/* 多选版列表选择窗：行渲染同 fzaPick；标题右侧带「多选」键。
   返回：多选态 → 所选数组（未选/取消 → null）；单选态 → 该行元素携带的 item（点行即确定） */
function fzaPickMulti(opts) {
  return new Promise(resolve => {
    const ov = fzaOverlay();
    const ovCancel = ov.querySelector('.fza-cancel');
    if (ovCancel) ovCancel.classList.add('hidden');
    const titleEl = ov.querySelector('.anchor-title');
    titleEl.textContent = String(opts.title || '');
    titleEl.setAttribute('data-title', String(opts.title || ''));
    const oldBtn = titleEl.querySelector('.fza-multi');
    if (oldBtn) oldBtn.remove();
    const body = fzaResetBox(ov);   /* 重建弹窗：正文 + box 上的弹窗级残留（工具条/页脚）一起清 */
    if (opts.prompt) {
      const msg = document.createElement('div');
      msg.className = 'fza-msg';
      msg.textContent = opts.prompt;
      body.appendChild(msg);
    }
    let done = false;
    const finish = v => { if (done) return; done = true; App.hideOverlay(ov); resolve(v); };
    App.fzaSetCancel(ov, () => finish(null));
    const rows = [];
    let selected = null;                        /* null = 单选态；数组 = 多选态 */
    let selSingle = null;                       /* 单选态下高亮的那一项（点「确定」才执行） */
    let yesBtn = null;                          /* 确定键：未选中时置灰 */
    let multiAPI = null;                        /* 多选开关（mountMultiToggle 的返回值） */
    /* 关键：判断「是否真的进了多选态」要看多选开关，不能用闭包 opts.multi，
       否则单选态的高亮永远画不出来（表现为「点不中」）。 */
    const inMultiNow = () => !!(opts.multi && multiAPI && multiAPI.isMulti());
    /* 数量上限：exactCount（批量注入 = 文件个数）传入时，
       勾选数必须**正好**等于它 —— 少一个「确定」保持灰色，多一个直接拦下。
       need = 0 表示不限制（批量导出、普通多选）。 */
    const need = Number(opts.exactCount) || 0;
    const atLimit = () => need > 0 && !!selected && selected.length >= need;
    const paint = () => {
      rows.forEach(r => {
        const on = inMultiNow()
          ? (selected === null ? false : selected.indexOf(r.it) >= 0)
          : (selSingle === r.it);
        r.el.classList.toggle('sel', on);
        /* 不依赖行内回调：直接按 data-check 找勾选节点（分组窗与 SVG 窗写法一致） */
        const mk = r.el.matches('[data-check]') ? r.el : r.el.querySelector('[data-check]');
        if (mk) mk.style.display = on ? '' : 'none';
      });
      /* 确定键可用条件：
         —— 有限额（批量注入）：勾选数**正好**等于 need 才亮，少了/多了都保持灰色；
         —— 无限额：单选、多选都是「选了至少一项」即可。 */
      if (yesBtn) {
        yesBtn.disabled = inMultiNow()
          ? (need > 0 ? !(selected && selected.length === need) : !(selected && selected.length > 0))
          : !selSingle;
      }
    };
    const api = {
      count: () => (selected ? selected.length : 0),
      setMulti: on => { selected = on ? [] : null; paint(); },
      onChange: null
    };
    const btns = document.createElement('div');
    btns.className = 'anchor-btns';
    const no = document.createElement('button');
    no.textContent = App.i18n.t('fza.cancel');
    no.addEventListener('click', () => finish(null));
    /* **单选态也要点「确定」才执行**（与选择窗口逻辑统一），
       所以确定键不再只出现在多选态；未选中任何项时置灰。 */
    const yes = document.createElement('button');
    yes.textContent = App.i18n.t('fza.ok');
    yes.className = 'active';
    yes.disabled = true;                     /* 初始无选中（paint 会同步） */
    yesBtn = yes;
    yes.addEventListener('click', () => {
      /* 用 inMultiNow()（看多选开关），不能用闭包 opts.multi —— 否则单选态也会走多选分支 */
      if (inMultiNow()) {
        if (selected) {
          /* 兜底：确定键在 paint() 里已按 need 置灰，这里再挡一次，防程序化触发 */
          if (need > 0 && selected.length !== need) {
            showToast(App.i18n.tf('fza.needExact', { n: need, got: selected.length }), 4000);
            return;
          }
          finish(selected.length ? selected.slice() : null);
          return;
        }
        finish(null);
        return;
      }
      if (!selSingle) return;
      /* 单选态也必须过 exactCount。
         否则批量注入需要 N>1 个分组时，用户在单选态只选 1 个 → 关窗后外层才发现数量不符，
         表现为「点了确定，窗口关了，然后什么都没有」。这里拦住并留在窗口内提示。 */
      if (need > 1) {
        showToast(App.i18n.tf('fza.needExact', { n: need, got: 1 }), 4000);
        return;
      }
      finish(selSingle);                     /* 单选：点确定才返回高亮项 */
    });
    btns.appendChild(no);
    btns.appendChild(yes);
    if (opts.multi) {
      /* exactCount 传入时（批量注入）初始就进多选态：需求是「选满 N 个」，
         默认停在单选态会诱导用户只选 1 个。 */
      multiAPI = mountMultiToggle(ov, api, need > 0);
      /* 有限额时**锁死多选态**。
         否则用户切回单选就永远凑不满 need，「确定」会一直是灰色 —— 那是个死路。
         锁定后按钮可见但置灰，配合提示语明确「本次必须勾满 N 个」。 */
      if (need > 0) {
        const mt = ov.querySelector('.fza-multi');
        if (mt) { mt.disabled = true; mt.classList.add('locked'); }
      }
    }
    (opts.items || []).forEach((it, idx) => {
      const row = document.createElement('div');
      row.className = 'anchor-item fza-row';
      const cell = opts.rowHtml ? opts.rowHtml(it, idx) : null;
      if (cell && cell.nodeType === 1) row.appendChild(cell);
      else {
        row.innerHTML = '<span class="anchor-name"></span>';
        row.querySelector('.anchor-name').textContent = String(cell != null ? cell : (it.label || it.title || it));
      }
      rows.push({ it, el: row });
      row.addEventListener('click', () => {
        /* 与选择窗口统一 —— 真正进了多选态才切换勾选；
           否则只高亮选中，点「确定」才返回。 */
        if (opts.multi && multiAPI && multiAPI.isMulti()) {
          const i = selected.indexOf(it);
          if (i >= 0) {
            selected.splice(i, 1);               /* 取消勾选：永远允许 */
          } else {
            /* 已选满 need 个还想再勾 → 拦住并提示，
               不改变当前选择（已勾的仍保留，用户可先取消一个再换）。 */
            if (atLimit()) {
              showToast(App.i18n.tf('fza.maxPicked', { n: need }), 3500);
              return;
            }
            selected.push(it);
          }
          paint();
          if (multiAPI) multiAPI.syncTitle();
          return;
        }
        selSingle = it;
        paint();
      });
      body.appendChild(row);
    });
    paint();
    fzaFoot(ov).appendChild(btns);   /* 页脚：在滚动区之外 */
    App.showOverlay(ov);
  });
}

/* ---------- 账户（常驻选择器）/ 分组 ---------- */
App.forza = {
  accounts: [],     // [{label,xuid,folder,uDir,containersRoot}]（排序=官方：文件夹升序）
  current: null,    // 当前账户（默认第一个，同官方 select 语义）
  /* 从主进程拉取账户并填充常驻下拉；无账户时返回 null（首次提示） */
  async refreshAccounts() {
    const sel = document.getElementById('forzaAccountSel');
    const r = await window.sveApi.forzaAccounts();
    if (!r.ok) { showToast(App.i18n.tf('toast.fza.readSaveFail', { v: (r.error || '') })); return null; }
    this.accounts = r.accounts || [];
    if (!this.accounts.length) {
      if (sel) sel.innerHTML = '';
      this.current = null;
      showToast(App.i18n.t('toast.fza.noPlayer'));
      return null;
    }
    if (!this.current || !this.accounts.some(a => a.xuid === this.current.xuid)) {
      this.current = this.accounts[0]; // 默认选中第一个（同官方）
    }
    if (sel) {
      sel.innerHTML = '';
      this.accounts.forEach(a => {
        const op = document.createElement('option');
        op.value = a.xuid;
        op.textContent = a.label; // 纯文本标签（同官方：gamertag / xuid / 重名加后缀）
        sel.appendChild(op);
      });
      sel.value = this.current.xuid;
    }
    return this.current;
  },
  /* 取当前账户；下拉手动切换也走这里更新 */
  setAccount(xuid) {
    const a = this.accounts.find(x => x.xuid === String(xuid));
    if (a) this.current = a;
    return this.current;
  },
  /* 注入/导出/备份入口的账户保障：常驻选择器已就绪则直接用；没有则先拉取/首次提示 */
  async ensureAccount() {
    if (this.accounts.length && this.current) return this.current;
    return this.refreshAccounts();
  },
  async chooseGroup(title) {
    const acct = await this.ensureAccount();
    if (!acct) return null;
    const r = await window.sveApi.forzaGroups(acct.containersRoot);
    if (!r.ok) { showToast(App.i18n.tf('toast.fza.readGroupsFail', { v: (r.error || '') })); return null; }
    if (!r.groups.length) { showToast(App.i18n.t('toast.fza.noGroups')); return null; }
    /* 与官方 ChoiceDialog 完全一致：标题+提示语+缩略图行+默认选中第一项 */
    return fzaPick(title || App.i18n.t('fza.pickGroup'), r.groups, g => fzaThumbRow(g),
      App.i18n.t('fza.pickGroupPrompt'));
  },
  /* 同 chooseGroup，但支持多选：返回分组数组（取消/未选 → null）
     exactCount 传入时，要求**正好**勾选该数量（批量注入 = SVG 文件个数），
     否则确定键会提示并拒绝关闭，保证「SVG 数 == 分组数」一一配对。 */
  async chooseGroupMulti(exactCount) {
    const acct = await this.ensureAccount();
    if (!acct) return null;
    const r = await window.sveApi.forzaGroups(acct.containersRoot);
    if (!r.ok) { showToast(App.i18n.tf('toast.fza.readGroupsFail', { v: (r.error || '') })); return null; }
    if (!r.groups.length) { showToast(App.i18n.t('toast.fza.noGroups')); return null; }
    const need = Number(exactCount) || 0;
    const res = await fzaPickMulti({
      title: App.i18n.t('fza.pickGroup'),
      multi: true,
      items: r.groups,
      rowHtml: g => fzaThumbRow(g, { setChecked: true }),
      exactCount: need,
      prompt: need
        ? App.i18n.tf('fza.pickGroupExactPrompt', { n: need })
        : App.i18n.t('fza.pickGroupMultiPrompt')
    });
    /* 单选态（未点多选开关）返回的是**单个分组对象**，
       而本函数对外约定返回**数组**。这里统一包装成数组，
       否则单选的合法结果会被当取消丢掉（表现为「单选点了确定没有反应」）。 */
    if (Array.isArray(res)) return res;
    return res ? [res] : null;
  },
  toastErr(r, act) {
    showToast(((r && r.error) ? App.i18n.tf('toast.fza.opFailWhy', { v: (act || App.i18n.t('toast.fza.opName')), v2: r.error }) : App.i18n.tf('toast.fza.opFail', { v: (act || App.i18n.t('toast.fza.opName')) })));
  }
};
/* 账户下拉变化：同步当前账户 */
function wireAccountSel() {
  const sel = document.getElementById('forzaAccountSel');
  if (!sel || sel.getAttribute('data-wired')) return;
  sel.setAttribute('data-wired', '1');
  sel.addEventListener('change', () => App.forza.setAccount(sel.value));
}

/* ---------- 注入：编辑器内「已保存的彩绘」列表（含缩略图）或导入文件 -> 游戏占位组 ---------- */
App.exportToGame = async function () {
  if (!(await App.forza.ensureAccount())) return; // 无账户：已提示
  /* 注入存档用专用窗口：只列编辑器内「已保存的彩绘」+「导入 SVG 文件…」
     （不与「+」栏的打开窗口共用） */
  const text = await App.fzaPickSvgForInject();
  if (text === null) return;
  await App.proceedInject(text);
};

/* 选定 SVG 文本后：解析为 FH6 模型 →（账户已就绪）→ 选占位组 → 覆盖确认+风险提示 → 注入 */
App.proceedInject = async function (svgText, opts) {
  const { root, count } = App.FZA.modelFromForzaSvg(svgText);
  if (!count) { showToast(App.i18n.t('toast.fza.notWritable')); return; }
  const acct = await App.forza.ensureAccount(); // 账户已由常驻选择器确定；无账户首次提示
  if (!acct) return;
  /* 批量流程已在外层逐个选好组（并在确认窗里统一展示缩略图），
     这里若收到 opts.group 就直接用，不再弹选组窗。 */
  const group = (opts && opts.group) || await App.forza.chooseGroup(opts && opts.title);
  if (!group) return;
  if (opts && opts.silentConfirm) {                 /* 批量：逐个选组即注入，不重复弹风险确认 */
    const r0 = await window.sveApi.forzaInject(group.cgroup, group.header, root);
    if (!r0.ok) { App.forza.toastErr(r0, App.i18n.t('fza.opInject')); return null; }
    try {
      const thumbUrl = await App.fzaComputeThumbDataUrl(root);
      if (thumbUrl) await window.sveApi.forzaThumbWrite(group.thumbnail, thumbUrl);
    } catch (e) { console.warn('[forza] 批量注入缩略图写入失败', String(e && e.message || e).slice(0, 160)); }
    try { App.log("info", "Forza 批量注入成功", { layers: r0.layers, group: group.title }); }
    catch (e) { console.warn('[forza] 批量注入日志写入失败', String(e && e.message || e).slice(0, 160)); }
    return { group: group.title, layers: r0.layers };
  }
  /* 单次注入的二次确认也带缩略图 —— 与批量窗共用 fzaConfirmOverwrite，
     按钮布局只有一份，不会重复放置按键。 */
  const ok = await fzaConfirmOverwrite([group], {
    title: App.i18n.t('dlg.injectTitle'),
    message: App.i18n.tf('dlg.injectMsg', { group: group.title, author: group.author }),
    okText: App.i18n.t('dlg.injectOk')
  });
  if (!ok) return;
  /* 注入写盘**之前**先备份原分组（撤销用）。备份失败 → 弹窗二选一（取消注入 / 直接注入）。 */
  if (!(await App.fzaBackupOrAsk(acct, [group]))) return;
  const r = await window.sveApi.forzaInject(group.cgroup, group.header, root);
  if (!r.ok) { App.forza.toastErr(r, App.i18n.t('fza.opInject')); return; }
  /* 自动生成并替换缩略图（任何来源均生效；失败记日志但不影响注入结果） */
  try {
    const thumbUrl = await App.fzaComputeThumbDataUrl(root);
    if (thumbUrl) {
      const wr = await window.sveApi.forzaThumbWrite(group.thumbnail, thumbUrl);
      if (wr && wr.ok) {
        try { App.log('info', '缩略图已生成并替换', { bytes: wr.bytes }); }
        catch (e) { console.warn('[forza] 缩略图日志写入失败', String(e && e.message || e).slice(0, 160)); }
      }
    }
  } catch (e) { console.warn('[forza] 注入缩略图写入失败', String(e && e.message || e).slice(0, 160)); }
  try { App.log('info', 'Forza 注入成功', { layers: r.layers, group: group.title }); }
  catch (e) { console.warn('[forza] 注入日志写入失败', String(e && e.message || e).slice(0, 160)); }
  showToast(App.i18n.tf('toast.fza.injected', { n: r.layers }), 5000);
};

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
App.WORKCOPY_THUMB_NS = 'workcopy-thumb-v2';
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
     再取「真实可见范围」内容盒（α>8，取不到才退回 α>200 的实心核心）并外扩 2px，最后 contain 居中。
     ★ 顺序必须是 α>8 优先：α>200 这个阈值在结构上排除了**不透明度 ≤ 200/255 ≈ 0.78 的图层**
       （它们渲染出的像素永远到不了 α>200），于是这些图层不参与取景计算；
       细长/抗锯齿严重的小内容核心也只剩几个像素。实测 图案-26.svg（各层 0.64/0.38/0.31 不透明）
       实心核只有 49×3px，缩略图被压成 256×14 一条横条；改成 α>8 后是 256×245。
       拿存档里游戏自己生成的 thumb.webp 当基准（152 个分组取最大的 4 个），
       α>8 口径 4/4 组都更接近游戏（平均像素差 35.6/13.4/0.75/1.00，α>200 是 42.6/26.3/2.34/6.92）
       ⇒ 「α>200 才是游戏口径」这个前提不成立（2026-10-04 实测）。
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
    /* ② 内容盒：与 thumb-render-core 的 contentBox(canvas,8,1,2) || contentBox(canvas,200,1,2) 同口径 */
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
    let box = boxOf(8) || boxOf(200);
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
          const b2 = boxOf(8) || boxOf(200);
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
function withMultiPick(base, rowOf, pickMulti) {
  return new Promise(resolve => {
    let selected = null;
    const ov = fzaOverlay();
    const titleEl = ov.querySelector('.anchor-title');
    if (!titleEl.getAttribute('data-title')) titleEl.setAttribute('data-title', String(pickMulti.title || ''));
    const api = {
      count: () => (selected ? selected.length : 0),
      setMulti: on => { selected = on ? [] : null; rowOf.setSel(on ? [] : null); },
      onChange: null
    };
    let canceled = false;
    const ovCancel = ov.querySelector('.fza-cancel');
    const prevCancel = ovCancel.onclick;
    ovCancel.onclick = () => { canceled = true; App.hideOverlay(ov); ovCancel.onclick = prevCancel; if (api.onChange) api.onChange(); resolve(null); };
    const multiApi = mountMultiToggle(ov, api);
    rowOf.onClick = it => {
      if (!multiApi.isMulti()) { ovCancel.onclick = prevCancel; return base(it); }   // 单选：交给 base 的确定/取消流程
      const i = selected.indexOf(it);
      if (i >= 0) selected.splice(i, 1); else selected.push(it);
      rowOf.setSel(selected);
      if (api.onChange) api.onChange();
      return 'handled';
    };
    base.onConfirm = () => {
      ovCancel.onclick = prevCancel;
      resolve(multiApi.isMulti() ? (selected || []).slice() : null);
      return true;                                 // 多选态下由本层收尾（resolve 集合）
    };
    pickMulti.pick(base).then(baseOk => {
      if (canceled) return;
      if (baseOk) return;                          // 正常由 onConfirm 收尾
      resolve(null);                               // 取消 / 无选择
    }).catch(() => { ovCancel.onclick = prevCancel; resolve(null); });
  });
}

/* 构建"软件内 SVG 库"弹层；multi=false 时点行即选中并关窗，true 时按多选规程。
   结果统一由 onTexts 回调返回文本数组（取消=[]）；resolve 值 = 'multi' | 'single' | null(取消) */
﻿function buildSvgLibraryOverlay(multi, onTexts, opts) {
  opts = opts || {};
  const withSource = !!opts.sourceSwitch;
  return new Promise(async resolve => {
    /* 不预先启动隐藏 renderer：先建立选择窗和加载动画，首个可视行任务
       自己负责启动 renderer，并由队列串行执行，避免打开弹窗时发生空白等待。 */
    const ov = fzaOverlay();
    const titleEl = ov.querySelector('.anchor-title');
    const baseTitle = opts.title || (multi ? App.i18n.t('fza.pickSvgInject') : App.i18n.t('fza.pickSvgOpen'));
    /* 列表来源（拆分为两个窗口）：
       'recent'  = SVG图像目录（软件内彩绘，与主页/「+」栏一致）
       'palette' = 编辑器内「已保存的彩绘」列表（注入存档窗口专用） */
    const listSource = opts.listSource || 'recent';
    let source = 'soft';
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
       四条出口（本地列表 / 游戏分组 / 文件导入 / 取消）必须**各自**收尾一次。
       统一走 finish()：幂等守卫 + 关窗 + 回调 + resolve，一次到位。
       否则 await App.fzaPickSvgLibraryMulti(...) 可能永远不返回 → 后续分组窗口不弹、流程卡死。 */
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
         但**必须**在文件读完后收尾 Promise。否则 await App.fzaPickSvgLibraryMulti(...) 会一直挂着。 */
      close();
      pickSvgFile()
        .then(text => finish(text ? 'single' : null, text ? [text] : []))
        .catch(e => { console.warn('[picker] 导入 SVG 文件失败', String(e && e.message || e).slice(0, 160)); finish(null); });
    });
    tools.appendChild(importBtn);
    const srcBtns = {};
    if (withSource) {
      const bar = document.createElement('div');
      bar.className = 'fza-src-bar';
      bar.id = 'fzaSrcBar';
      const mkBtn = (key, label) => {
        const b = document.createElement('button');
        b.className = 'fza-src-btn' + (key === 'soft' ? ' active' : '');
        b.setAttribute('data-src', key);
        b.textContent = label;
        b.addEventListener('click', () => {
          if (source === key) return;
          source = key;
          Object.keys(srcBtns).forEach(k => srcBtns[k].classList.toggle('active', k === key));
          applyTitle();
          render();
        });
        srcBtns[key] = b;
        return b;
      };
      /* 来源按钮文案：「软件内彩绘 / 游戏内彩绘」 */
      bar.appendChild(mkBtn('soft', opts.softLabel || App.i18n.t('fza.softLabel')));
      bar.appendChild(mkBtn('game', opts.gameLabel || App.i18n.t('fza.gameLabel')));
      tools.appendChild(bar);
    }
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
       —— 本地 SVG 文件项：fileRead('svg', name) 取 rd.content；
       —— 游戏内分组项：走 decodeGroupExport 解码（**不能**用 fileRead）。
       类型判断沿用最稳的依据：本地文件项带 name、游戏分组不带（带 cgroup）。
       串行 await，**严格保持传入顺序** —— 第 i 个 SVG 必须对应第 i 个目标分组，
       所以绝不并行收集、绝不改变顺序。
       返回 { texts, failName, why }：texts 非空 = 全部成功。 */
    const resolveTexts = async (items) => {
      const texts = [];
      for (const it of items) {
        const isLocalFile = !!(it && it.name && !it.cgroup);
        if (!isLocalFile) {
          showToast(App.i18n.t('toast.fza.decoding'));
          const out = await App.decodeGroupExport(it);
          if (!out) return { texts: null, failName: (it && (it.title || it.cgroup)) || '?', why: App.i18n.t('toast.fza.decodeFail') };
          texts.push(out.svg);
          continue;
        }
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
    const renderGame = async () => {
      const acct = await App.forza.ensureAccount();
      if (!acct) { showEmpty(App.i18n.t('fza.emptyNoAccount')); return; }
      let r = null;
      try { r = await window.sveApi.forzaGroups(acct.containersRoot); }
      catch (e) { console.warn('[picker] 游戏分组读取失败', String(e && e.message || e).slice(0, 160)); r = null; }
      if (!r || !r.ok) { showEmpty(App.i18n.tf('toast.fza.readGroupsFail', { v: ((r && r.error) || App.i18n.t('toast.unknown')) })); return; }
      const groups = r.groups || [];
      if (!groups.length) { showEmpty(App.i18n.t('toast.fza.noGroups')); return; }
      groups.forEach(g => {
        const row = document.createElement('div');
        row.className = 'anchor-item fza-row';
        const thumb = fzaThumbRow(g, { deferThumb: true });
        row.appendChild(thumb);
        observeVisibleThumb(row, thumb.thumbBox, loader => thumb.loadThumb(loader),
          '[picker] 游戏缩略图生成失败：' + g.title);
        rows.push({ it: g, el: row });
        row.addEventListener('click', () => {
          /* 同上：未进多选态时只高亮，点「确定」才开始解码导出；busy 期间无效 */
          if (busy) return;
          if (multi && api && api.isMulti()) {
            const i = selected.indexOf(g);
            if (i >= 0) selected.splice(i, 1); else selected.push(g);
            paint();
            api.syncTitle();
            return;
          }
          selSingle = g;
          paint();
        });
        list.appendChild(row);
      });
    };
    const render = async () => {
      resetThumbWork();
      list.innerHTML = '';
      rows = [];
      if (source === 'game') await renderGame();
      /* 非 'game' 源走 SVGImages 目录（source 初值 'soft'） */
      else await renderSoft();
    };
    await render();
    App.showOverlay(ov);
  });
}

/* 单选版（「+」栏用）：标题=选择要打开的 SVG，带来源切换（软件内彩绘 / 游戏内彩绘） */
App.fzaPickSvgLibrary = function () {
  return new Promise(resolve => {
    buildSvgLibraryOverlay(false, texts => resolve(texts[0] || null),
      { title: App.i18n.t('fza.pickSvgOpen'), sourceSwitch: true }).then(v => { if (v === null) resolve(null); });
  });
};

/* 注入存档专用窗口：
   只给「导入 SVG 文件…」按钮 + **编辑器保存的 SVG 列表**（＝SVG图像 目录，主页显示的那批）；
   不带来源切换，也不列游戏存档里的图案（那些属于「+」栏的打开窗口）。 */
App.fzaPickSvgForInject = function () {
  return new Promise(resolve => {
    buildSvgLibraryOverlay(false, texts => resolve(texts[0] || null),
      { title: App.i18n.t('fza.pickSvgInject'), sourceSwitch: false, listSource: 'recent' })
      .then(v => { if (v === null) resolve(null); });
  });
};

/* 多选版（批量注入存档用，与 fzaPickSvgForInject 同一口径）：
   结果经 onTexts 回调返回文本数组（取消=[]） */
App.fzaPickSvgLibraryMulti = function (onTexts) {
  return buildSvgLibraryOverlay(true, onTexts, { title: App.i18n.t('fza.pickSvgInject'), listSource: 'recent' });
};
/* 多选版「选择彩绘纹饰分组」：返回所选分组数组（取消 → null）
   exactCount：要求正好选这么多个（批量注入时 = SVG 文件数） */
App.fzaPickGroupMulti = function (exactCount) {
  return App.forza.chooseGroupMulti(exactCount);
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

/* ---------- 从游戏存档导出（方案①：只登记到 SVG图像，不开标签、不导入） ---------- */
/* 解码某占位组为 Forza 兼容 SVG 文本（供测试/登记复用）：返回 { svg, title, author, layers } 或 null */
App.decodeGroupExport = async function (group) {
  const r = await window.sveApi.forzaExport(group.cgroup, group.header);
  if (!r.ok) { App.forza.toastErr(r, App.i18n.t('fza.opExport')); return null; }
  const svg = App.FZA.svgStringFromModel(r.model, { embedSvg: App.libText });
  const doc = new DOMParser().parseFromString(svg.str, 'image/svg+xml');
  if (doc.documentElement.getElementsByTagName('parsererror').length) { showToast(App.i18n.t('toast.fza.badSvg')); return null; }
  return { svg: svg.str, title: r.title, author: r.author, layers: countLayers(r.model) };
};
/* 登记到「SVG图像」分类目录（自动命名去重） */
App.registerGameExport = async function (svgStr, title, fileName) {
  try {
    const saved = await window.sveApi.fileAutoSave('svg', svgStr, fileName);
    if (saved && saved.ok && App.Home && App.Home.refresh) App.Home.refresh();
    return saved;
  } catch (e) { console.warn('[forza] 存档导出登记失败', String(e && e.message || e).slice(0, 160)); return null; }
};
App.fromGameExport = async function () {
  const acct = await App.forza.ensureAccount(); // 账户由常驻选择器确定
  if (!acct) return;
  const group = await App.forza.chooseGroup();
  if (!group) return;
  const out = await App.decodeGroupExport(group);
  if (!out) return;
  /* 从存档导出 SVG 的默认命名 = 原存档这个图案的命名 + 该图案的图层数量。
     这里必须传 fileName，否则会落到「图案-<时间戳>」的通用默认名；
     批量导出那条路用的是 fzaOfficialExportName，两条路要保持一致。 */
  const saved = await App.registerGameExport(out.svg, out.title,
    App.fzaOfficialExportName(out.title, out.layers));
  try { App.log('info', '从存档导出并登记', { title: out.title, layers: out.layers, path: saved && saved.path }); }
  catch (e) { console.warn('[forza] 导出日志写入失败', String(e && e.message || e).slice(0, 160)); }
  if (saved && saved.ok) showToast(App.i18n.tf('toast.fza.exported', { v: saved.path }), 5000);
  else showToast(App.i18n.tf('toast.fza.exportRegFail', { v: (saved && saved.error || App.i18n.t('toast.unknown')) }), 5000);
  App.forza.lastExport = { title: out.title, author: out.author, svg: out.svg, layers: out.layers };
};
function countLayers(node) {
  if (!node) return 0;
  let n = 0;
  const st = [node];
  while (st.length) {
    const it = st.pop();
    if (it.kind === 'group') st.push(...it.children);
    else n++;
  }
  return n;
}

/* ---------- 备份当前账户存档（备份常驻选择器所选的账户） ---------- */
App.backupAccount = async function () {
  const acct = await App.forza.ensureAccount();
  if (!acct) return;
  const r = await window.sveApi.forzaBackup(acct.uDir);
  if (!r) return;
  if (r.canceled) return;
  if (!r.ok) { App.forza.toastErr(r, App.i18n.t('fza.opBackup')); return; }
  showToast(App.i18n.tf('toast.fza.backupDone', { v: r.path }), 6000);
};

/* ---------- JSON -> 当前文档（镜像官方 workflows，产出同款 SVG 再走 importForza） ---------- */

/* 找出符号库中 w{word} 对应的完整 id */
function fzaHrefByWord(word) {
  if (!App.symbolMap) return null;
  for (const key of App.symbolMap.keys()) {
    if (/^fh6_t\d+_i\d+_w\d+$/.test(key) && key.endsWith('_w' + word)) return key;
  }
  return null;
}
function fzaSvgWrap(body, words) {
  const defParts = [];
  const seen = new Set();
  if (App.libText) {
    const symRe = /<symbol\s+([^>]*)>/g;
    let mm;
    while ((mm = symRe.exec(App.libText))) {
      const idM = /id="([^"]+)"/.exec(mm[1]);
      if (!idM) continue;
      if (words.indexOf(idM[1]) < 0 || seen.has(idM[1])) continue;
      seen.add(idM[1]);
      const end = App.libText.indexOf('</symbol>', mm.index);
      if (end > 0) defParts.push(App.libText.slice(mm.index, end + 9));
    }
  }
  const maskKey = App.maskThemeKey ? App.maskThemeKey() : 'mask_indicator_dark';
  const patternParts = [];
  (App.patterns || []).forEach(p => {
    if (p.key === maskKey || p.key === 'mask_indicator_dark' || p.key === 'mask_indicator_light') {
      patternParts.push(new XMLSerializer().serializeToString(p.node));
    }
  });
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"' +
    ' xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"' +
    ' xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"' +
    ' width="1920" height="1080" viewBox="0 0 1920 1080" version="1.1" inkscape:version="1.4">\n' +
    '  <sodipodi:namedview id="namedview1" pagecolor="#ffffff" showgrid="false" />\n' +
    '  <defs>\n' + defParts.join('\n') + (patternParts.length ? '\n' + patternParts.join('\n') : '') + '\n  </defs>\n' +
    body + '\n</svg>\n';
}
function fzaUseLine(href, svgCx, svgCy, sx, sy, rotDeg, fill, opacity, id) {
  const f6 = n => Math.round(n * 1e6) / 1e6;
  const rad = (rotDeg || 0) * D2R;
  const cosR = Math.cos(rad), sinR = Math.sin(rad);
  const ma = sx * cosR;
  const mb = -sx * sinR;
  const mc = sy * (sinR);
  const md = sy * cosR;
  /* 符号本地坐标视其 viewBox 原点（skew 恒 0；origin 由 defs 携带，me/mf 含 min 项） */
  const def = App.FZA.symbolDefMap()[href];
  const minX = def ? def.x : 0, minY = def ? def.y : 0;
  const me = svgCx + ma * minX + mc * minY;
  const mf = svgCy + mb * minX + md * minY;
  return '    <use xlink:href="#' + href + '" x="0" y="0" id="' + id + '"' +
    ' transform="matrix(' + [f6(ma), f6(mb), f6(mc), f6(md), f6(me), f6(mf)].join(',') + ')"' +
    ' style="fill:' + fill + ';opacity:' + f6(clamp(opacity, 0, 1)) + '" />';
}
function fzaLoadJsonText(text) {
  try { return JSON.parse(text); } catch (e) { showToast(App.i18n.tf('toast.fza.badJson', { v: e.message })); return null; }
}
function jsonShapeTransparent(shape) {
  const c = shape && shape.color || [];
  return c.length >= 4 && Number.isFinite(parseFloat(c[3])) && parseFloat(c[3]) <= 0;
}
function jsonShapeLowOpacity(shape, threshold) {
  const c = shape && shape.color || [];
  if (c.length < 4) return false;
  const o = parseFloat(c[3]);
  if (!Number.isFinite(o)) return false;
  return Math.max(0, Math.min(255, o)) <= threshold;
}

/* 生成结果要放进**一个属于自己的新标签页**：
   若只保证「有文档可用」，连续点「从 Geometrize JSON 生成」/「从 Vinylizer JSON 生成」时，
   生成的图形会全部堆在同一个标签页里，几个作品混在一张画布上，无法分别处理。
   因此每次导入都新开一个标签页（与「打开 SVG 文件」在生产模式下的做法一致），
   标签名用来源（Geometrize / Vinylizer）便于区分。
   测试模式（SVGBIANJI_TEST / Tabs.testMode）保持单文档行为：仍导入当前文档，
   否则既有测试里「先造一个文档再断言导入结果」的写法会被新标签页打乱。
   label 由调用方传入（App.fzaImportSvg 的 from 参数），保证两种来源都可辨识。 */
function fzaEnsureDocForImport(label) {
  if (!(App.Tabs && !App.Tabs.testMode)) return;
  App.Tabs.addDoc({ silent: true, label: label || null });
  if (App.Home) App.Home.hide();
}

/* Geometrize：type1 矩形 / type16 圆形；透明边界矩形自动四边补 mask_indicator 蒙版 */
App.importGeometrizeJSON = async function (text) {
  const data = fzaLoadJsonText(text);
  if (!data) return;
  const shapes = (data.shapes || (Array.isArray(data) ? data : []));
  if (!shapes.length) { showToast(App.i18n.t('toast.fza.noShapes')); return; }
  const rectId = fzaHrefByWord(101);
  const circleId = fzaHrefByWord(102);
  if (!rectId || !circleId) { showToast(App.i18n.t('toast.fza.noBase')); return; }
  const boundaryIndex = shapes.findIndex(s => s && s.type === 1 && (s.data || []).length >= 4 && jsonShapeTransparent(s));
  let geoW = 2048, geoH = 2048;
  if (boundaryIndex >= 0) {
    const bd = shapes[boundaryIndex].data;
    geoW = parseFloat(bd[2]); geoH = parseFloat(bd[3]);
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let hasVisible = false;
  shapes.forEach((s, i) => {
    if (!s || (s.data || []).length < 4) return;
    if (i === boundaryIndex || jsonShapeTransparent(s)) return;
    if (s.type !== 1 && s.type !== 16) return;
    hasVisible = true;
    const d = s.data;
    const cx = s.type === 1 ? parseFloat(d[0]) + parseFloat(d[2]) / 2 : parseFloat(d[0]);
    const cy = s.type === 1 ? parseFloat(d[1]) + parseFloat(d[3]) / 2 : parseFloat(d[1]);
    const hw = s.type === 1 ? parseFloat(d[2]) / 2 : parseFloat(d[2]);
    const hh = s.type === 1 ? parseFloat(d[3]) / 2 : parseFloat(d[3]);
    const radius = Math.hypot(hw, hh);
    minX = Math.min(minX, cx - radius); maxX = Math.max(maxX, cx + radius);
    minY = Math.min(minY, cy - radius); maxY = Math.max(maxY, cy + radius);
  });
  if (!hasVisible && boundaryIndex >= 0) {
    const bd = shapes[boundaryIndex].data;
    minX = parseFloat(bd[0]); minY = parseFloat(bd[1]);
    maxX = minX + parseFloat(bd[2]); maxY = minY + parseFloat(bd[3]);
  }
  const lines = [];
  const usedWords = new Set([rectId, circleId]);
  const pad2 = n => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  const offX = 960 - geoW / 2, offY = 540 - geoH / 2;
  shapes.forEach((s, i) => {
    if (!s) return;
    const type = s.type, d = s.data;
    if (type !== 1 && type !== 16) return;
    if ((d || []).length < 4) return;
    if (i === boundaryIndex || (jsonShapeTransparent(s) && i !== boundaryIndex)) return;
    const color = s.color || [255, 255, 255, 255];
    while (color.length < 4) color.push(255);
    const r = clamp(Math.round(parseFloat(color[0])), 0, 255);
    const g = clamp(Math.round(parseFloat(color[1])), 0, 255);
    const b = clamp(Math.round(parseFloat(color[2])), 0, 255);
    const a = clamp(Math.round(parseFloat(color[3])), 0, 255);
    let cx, cy, sx, sy, rot;
    if (type === 1) {
      cx = parseFloat(d[0]) + parseFloat(d[2]) / 2;
      cy = parseFloat(d[1]) + parseFloat(d[3]) / 2;
      sx = parseFloat(d[2]) / 127.0;
      sy = parseFloat(d[3]) / 127.0;
      rot = d.length >= 5 ? parseFloat(d[4]) : 0;
    } else {
      cx = parseFloat(d[0]); cy = parseFloat(d[1]);
      sx = parseFloat(d[2]) / 63.0;
      sy = parseFloat(d[3]) / 63.0;
      rot = d.length >= 5 ? ((360 - parseFloat(d[4])) % 360) : 0;
    }
    const fill = '#' + pad2(r) + pad2(g) + pad2(b);
    lines.push(fzaUseLine(type === 1 ? rectId : circleId, cx + offX, cy + offY, sx, sy, rot, fill, a / 255, 'geo_shape_' + i));
  });
  if (boundaryIndex >= 0) {
    const bd = shapes[boundaryIndex].data;
    const svgMinX = minX + offX, svgMinY = minY + offY;
    const svgMaxX = maxX + offX, svgMaxY = maxY + offY;
    const hw = parseFloat(bd[2]) / 2, hh = parseFloat(bd[3]) / 2;
    const cxx = (parseFloat(bd[0]) + parseFloat(bd[2]) / 2) + offX;
    const cyy = (parseFloat(bd[1]) + parseFloat(bd[3]) / 2) + offY;
    const top = Math.max(10, (cyy - hh) - svgMinY + 20);
    const bottom = Math.max(10, svgMaxY - (cyy + hh) + 20);
    const left = Math.max(10, (cxx - hw) - svgMinX + 20);
    const right = Math.max(10, svgMaxX - (cxx + hw) + 20);
    const mw = 2 * hw + left + right;
    const mk = 'url(#' + (App.maskThemeKey ? App.maskThemeKey() : 'mask_indicator_dark') + ')';
    const masks = [
      [cxx + (right - left) / 2, cyy - hh - top / 2, mw / 127, top / 127],
      [cxx + (right - left) / 2, cyy + hh + bottom / 2, mw / 127, bottom / 127],
      [cxx - hw - left / 2, cyy, left / 127, (2 * hh) / 127],
      [cxx + hw + right / 2, cyy, right / 127, (2 * hh) / 127]
    ];
    masks.forEach((maskArgs, mi) => {
      lines.push(fzaUseLine(rectId, maskArgs[0], maskArgs[1], maskArgs[2], maskArgs[3], 0, mk, 1, 'mask_geo_' + boundaryIndex + '_' + ['top', 'bottom', 'left', 'right'][mi]));
    });
  }
  const svg = fzaSvgWrap(lines.join('\n'), Array.from(usedWords));
  App.fzaImportSvg(svg, 'Geometrize');
};

/* Vinylizer：type 1/16/103/228，先按不透明度阈值过滤，内容居中到画布 */
App.importVinylizerJSON = async function (text) {
  const data = fzaLoadJsonText(text);
  if (!data) return;
  const shapes = (data.shapes || (Array.isArray(data) ? data : []));
  if (!shapes.length) { showToast(App.i18n.t('toast.fza.noShapes')); return; }
  const spec = { 1: [101, 127, 127], 16: [102, 63, 63], 103: [103, 63, 109.265625], 228: [228, 63, 63] };
  const hrefs = {};
  for (const type of Object.keys(spec)) {
    hrefs[type] = fzaHrefByWord(spec[type][0]);
    if (!hrefs[type]) { showToast(App.i18n.tf('toast.fza.noSymbol', { v: spec[type][0] })); return; }
  }
  const threshold = await fzaPrompt(App.i18n.t('dlg.vinylTitle'), App.i18n.t('dlg.vinylMsg'), 0);
  if (threshold === null) return;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let any = false;
  shapes.forEach(s => {
    if (!s || !spec[s.type] || (s.data || []).length < 4 || jsonShapeLowOpacity(s, threshold)) return;
    any = true;
    const cx = parseFloat(s.data[0]), cy = parseFloat(s.data[1]);
    minX = Math.min(minX, cx); maxX = Math.max(maxX, cx);
    minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
  });
  if (!any) { showToast(App.i18n.t('toast.fza.filteredOut')); return; }
  const offX = 960 - (minX + maxX) / 2;
  const offY = 540 - (minY + maxY) / 2;
  const pad2 = n => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  const lines = [];
  const usedWords = new Set(Object.values(hrefs));
  shapes.forEach((s, i) => {
    if (!s || !spec[s.type]) return;
    const d = s.data || [];
    if (d.length < 4 || jsonShapeLowOpacity(s, threshold)) return;
    const color = s.color || [255, 255, 255, 255];
    while (color.length < 4) color.push(255);
    const r = clamp(Math.round(parseFloat(color[0])), 0, 255);
    const g = clamp(Math.round(parseFloat(color[1])), 0, 255);
    const b = clamp(Math.round(parseFloat(color[2])), 0, 255);
    const a = clamp(Math.round(parseFloat(color[3])), 0, 255);
    const divX = spec[s.type][1], divY = spec[s.type][2];
    const cx = parseFloat(d[0]), cy = parseFloat(d[1]);
    const sx = parseFloat(d[2]) / divX;
    const sy = parseFloat(d[3]) / divY;
    const rot = d.length >= 5 ? ((360 - parseFloat(d[4])) % 360) : 0;
    lines.push(fzaUseLine(hrefs[s.type], cx + offX, cy + offY, sx, sy, rot,
      '#' + pad2(r) + pad2(g) + pad2(b), a / 255, 'vin_shape_' + i));
  });
  const svg = fzaSvgWrap(lines.join('\n'), Array.from(usedWords));
  App.fzaImportSvg(svg, 'Vinylizer');
};

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

/* ---------- 左下角功能坞（五键，顺序同原软件：Geometrize→Vinylizer→备份→注入→导出） ---------- */
App.initFzaDock = function () {
  const byId = id => document.getElementById(id);
  byId('btnFzaGeo').addEventListener('click', () => pickJsonFile().then(text => { if (text !== null) App.importGeometrizeJSON(text); }));
  byId('btnFzaVinyl').addEventListener('click', () => pickJsonFile().then(text => { if (text !== null) App.importVinylizerJSON(text); }));
  byId('btnFzaBackup').addEventListener('click', App.backupAccount);
  /* 入口指向多选版：单选时退化为单条流程，多选时批量执行。
     不要指向单选版（exportToGame / fromGameExport）—— 它弹窗里没有「多选」开关，批量功能会被埋没。 */
  /* injectSvgsMulti / exportGroupsMulti 定义在本文件**靠后**的位置，
     而绑定发生在这里（更早）—— 直接写 `App.xxx` 会把当时的 undefined 绑上去，点击毫无反应。
     所以用箭头函数**延迟取值**，点击时才从 App 上取。 */
  byId('btnFzaInject').addEventListener('click', () => App.injectSvgsMulti());
  byId('btnFzaExport').addEventListener('click', () => App.exportGroupsMulti());
  wireAccountSel();
  App.forza.refreshAccounts().catch(() => { /* 无账户等场景由入口提示 */ });
};

function pickJsonFile() {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
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

/* 初始化（脚本置于页面底部、其余 js 之后） */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => App.initFzaDock());
} else {
  App.initFzaDock();
}
/* ---------- 批量导出命名（官方规则 <安全标题>.<层数>.svg） ----------
   非法字符（Windows 保留 \\ / : * ? " < > | 与控制字符）替换为 _；
   首尾点/空格修剪；空结果回退 Exported_Forza_VinylGroup。 */
App.fzaSafeFileTitle = function (title) {
  let s = String(title == null ? "" : title);
  s = s.replace(/[\\/:*?"<>|]/g, "_").replace(/[\u0000-\u001f]/g, "_");
  s = s.replace(/^[.\s]+|[.\s]+$/g, "");
  return s || "Exported_Forza_VinylGroup";
};
/* 官方命名：<安全标题>.<层数>.svg（层数非法按 0） */
App.fzaOfficialExportName = function (title, layers) {
  const n = Math.max(0, Math.floor(Number(layers) || 0));
  return App.fzaSafeFileTitle(title) + "." + n + ".svg";
};
/* 批量导出：一次导出全部选中分组（各自解码 → 按官方名登记到 SVG图像 目录） */
App.batchExportGroups = async function (groups) {
  const list = Array.isArray(groups) ? groups.filter(Boolean) : [];
  if (!list.length) { showToast(App.i18n.t('toast.fza.noGroupPicked')); return { ok: 0, fail: 0, files: [] }; }
  const files = []; let ok = 0, fail = 0;
  for (const g of list) {
    const out = await App.decodeGroupExport(g);
    if (!out) { fail++; continue; }
    const nm = App.fzaOfficialExportName(out.title, out.layers);
    const saved = await App.registerGameExport(out.svg, out.title, nm);
    if (saved && saved.ok) { ok++; files.push(nm); } else { fail++; files.push("FAILED:" + nm); }
  }
  showToast(App.i18n.tf('toast.fza.batchExport', { ok: ok, fail: fail, files: (files.length ? App.i18n.tf('toast.fza.batchExportFiles', { n: files.length }) : '') }), 5000);
  try { App.log("info", "批量导出", { groups: list.length, ok, fail, files }); }
  catch (e) { console.warn('[forza] 批量导出日志写入失败', String(e && e.message || e).slice(0, 160)); }
  return { ok, fail, files };
};
/* 批量导入：三阶段 ——
   ① 一次选出**正好 N 个**分组（N = 有效 SVG 个数；选少/选多都会被确定键拦下）
   ② **一次**风险确认，弹窗里列出全部即将被覆盖的分组（带存档缩略图），并与 SVG 一一对应
   ③ 依次注入
   多选数量必须与 SVG 文件数严格匹配，不能少也不能多。 */
App.batchInjectSvgs = async function (texts) {
  const raw = Array.isArray(texts) ? texts : [];
  /* 入口类型校验 —— 传进来的必须是非空 SVG 文本数组。
     只做 filter(t => t) 的话，文件信息对象（{name, path}）会被当成「有效项」混进来，
     解析器拿到 object 得到 0 个图层，用户只看到笼统的「没有可写入内容」，无从排查。 */
  if (!raw.length) { showToast(App.i18n.t('toast.fza.noSvgPicked')); return { ok: 0, fail: 0 }; }
  if (!raw.every(t => typeof t === 'string' && t.trim())) {
    showToast(App.i18n.t('toast.fza.pickSvgTypeErr'), 6000);
    return { ok: 0, fail: raw.length };
  }
  const list = raw;
  if (!(await App.forza.ensureAccount())) return { ok: 0, fail: 0 };

  /* ① 先解析全部 SVG。**不**「过滤掉无效项后继续」——那会把目标数从 N 悄悄缩成 M，
     导致「N 个文件对应 N 个分组」的配对关系错位。任一项不可写就整批停止并列出失败序号。 */
  const parsedList = list.map(svg => {
    const parsed = App.FZA.modelFromForzaSvg(svg);
    return (parsed && parsed.count) ? { svg: svg, root: parsed.root } : null;
  });
  const badIdx = parsedList.map((v, i) => (v ? 0 : i + 1)).filter(Boolean);
  if (badIdx.length) {
    showToast(App.i18n.tf('toast.fza.batchSomeNotWritable', { n: badIdx.length, total: list.length, list: badIdx.join('、') }), 7000);
    return { ok: 0, fail: list.length };
  }
  const valid = parsedList;

  /* ② 一次选**正好 valid.length 个**分组 */
  const groups = await App.fzaPickGroupMulti(valid.length);
  if (!Array.isArray(groups) || groups.length !== valid.length) return { ok: 0, fail: valid.length };

  /* ③ 一一配对（第 i 个 SVG → 第 i 个分组） */
  const plan = valid.map((v, i) => ({ svg: v.svg, root: v.root, group: groups[i] }));

  /* ④ 一次风险确认：列出全部将被覆盖的分组（带缩略图） */
  if (!(await fzaConfirmBatchOverwrite(plan))) return { ok: 0, fail: plan.length };

  /* 整批**只备份一次、只问一次** —— N 个分组合并成一条撤销记录，
     撤销时一次把它们全部恢复。备份失败时弹窗二选一（取消整批 / 跳过备份继续）。 */
  const acct = await App.forza.ensureAccount();
  if (!(await App.fzaBackupOrAsk(acct, plan.map(p => p.group)))) return { ok: 0, fail: plan.length };

  /* ⑤ 依次注入（组已选定，proceedInject 收 opts.group 后不再弹选择窗） */
  let ok = 0, fail = 0;
  for (const it of plan) {
    const r = await App.proceedInject(it.svg, { group: it.group, silentConfirm: true });
    if (r) ok++; else fail++;
  }
  showToast(App.i18n.tf('toast.fza.batchInject', { ok: ok, fail: fail }), 5000);
  return { ok, fail };
};

/* 批量覆盖确认窗：把每个即将被覆盖的分组连同**存档缩略图**列出来（复用 fzaThumbRow 的行样式）。
   plan = [{ svg, group, root }]；返回 true=继续，false=取消 */
/* 覆盖确认窗：**单次 / 批量共用**的一份实现。
   两处共用同一份实现，按钮布局只有一处，天然不会「重复放置按键」。
   groups : 分组对象数组（需含 title / author / thumbnail）
   opts   : { title, message, okText, numbered }  numbered=true 时行首加「1. 2. 3.」
   返回   : true=继续 / false=取消 */
function fzaConfirmOverwrite(groups, opts) {
  opts = opts || {};
  const list = Array.isArray(groups) ? groups.filter(Boolean) : [];
  return new Promise(resolve => {
    const ov = fzaOverlay();
    const ovCancel = ov.querySelector('.fza-cancel');
    if (ovCancel) ovCancel.classList.add('hidden');
    let done = false;
    const finish = v => { if (done) return; done = true; App.hideOverlay(ov); resolve(v); };
    /* #fzaOv 是全局复用的**同一个**元素，ov._fzaCancel 会残留上一个窗口的收尾函数。
       本窗口必须显式登记自己的取消动作，否则点 × / 点窗外会去调用上一个（早已 settled 的）finish，
       结果是「点 × 关不掉、Promise 一直挂着」。 */
    App.fzaSetCancel(ov, () => finish(false));
    const titleEl = ov.querySelector('.anchor-title');
    titleEl.setAttribute('data-title', String(opts.title || ''));
    titleEl.textContent = String(opts.title || '');
    const body = fzaResetBox(ov);   /* 重建弹窗：正文 + box 上的弹窗级残留（工具条/页脚）一起清 */
    if (opts.message) {
      const msg = document.createElement('div');
      msg.className = 'fza-msg';
      msg.textContent = opts.message;
      body.appendChild(msg);
    }
    /* 逐条列出目标分组：序号（可选）+ 缩略图 + 「标题 - 作者」 */
    list.forEach((g, i) => {
      const row = document.createElement('div');
      /* 缩略图与名称**靠左**。
         .anchor-item 是 justify-content: space-between，行里有「序号 + 缩略图名称组」两个子元素时
         会把后者顶到最右边；这个类把它改回 flex-start（只影响带缩略图行的这几个窗口）。 */
      row.className = 'anchor-item fza-row fza-confirm-row';
      if (opts.numbered) {
        const idx = document.createElement('span');
        idx.className = 'fza-batch-idx';
        idx.textContent = (i + 1) + '.';
        row.appendChild(idx);
      }
      const cell = fzaThumbRow(g, { deferThumb: true });
      row.appendChild(cell);
      body.appendChild(row);
      if (cell.loadThumb) cell.loadThumb();            /* 行已入 DOM 再拉缩略图 */
    });
    const btns = document.createElement('div');
    btns.className = 'anchor-btns';
    const no = document.createElement('button');
    no.textContent = App.i18n.t('fza.cancel');
    no.addEventListener('click', () => finish(false));
    const yes = document.createElement('button');
    yes.textContent = opts.okText || App.i18n.t('fza.cont');
    yes.className = 'active';
    yes.addEventListener('click', () => finish(true));
    btns.appendChild(no);
    btns.appendChild(yes);
    fzaFoot(ov).appendChild(btns);   /* 页脚：在滚动区之外 */
    App.showOverlay(ov);
  });
}
function fzaConfirmBatchOverwrite(plan) {
  const groups = (Array.isArray(plan) ? plan : []).map(p => p && p.group).filter(Boolean);
  return fzaConfirmOverwrite(groups, {
    title: App.i18n.tf('fza.batchTitle', { n: groups.length }),
    message: App.i18n.t('fza.batchMsg'),
    okText: App.i18n.t('fza.cont'),
    numbered: true
  });
}

/* ================= 注入撤销：备份 / 恢复 ================= */
/* 撤销记录：自动保存最近三次被注入的分组原文件；
   多选同时注入的 N 个分组合并为**一条**记录（一次撤销把它们一起恢复）；
   第 4 次注入时最早那条被永久删除（由主进程 InjectUndo 目录负责裁剪）。 */

/* 注入前备份：把被覆盖分组的**原模型**（精确还原用）+ 原缩略图副本存成一条记录。
   acct  : 当前账户（写进 meta，撤销列表按账户区分）
   groups: 本次将被覆盖的分组数组
   返回  : { ok:true, id, count } / { ok:false, why } */
App.fzaBackupInjectGroups = async function (acct, groups) {
  const list = (Array.isArray(groups) ? groups : []).filter(Boolean);
  if (!list.length) return { ok: false, why: 'no groups' };
  try {
    const recs = [];
    for (const g of list) {
      /* 用 forzaExport 解码出「注入前」的模型 —— 这是唯一能精确还原的形态 */
      const r = await window.sveApi.forzaExport(g.cgroup, g.header);
      if (!r || !r.ok) return { ok: false, why: (r && r.error) || App.i18n.t('toast.fza.decodeFail'), group: g.title };
      recs.push({
        cgroup: g.cgroup, header: g.header, folder: g.folder,
        title: g.title, author: g.author, thumbPath: g.thumbnail, model: r.model
      });
    }
    const res = await window.sveApi.undoSave({
      account: acct ? { xuid: acct.xuid, containersRoot: acct.containersRoot } : null,
      groups: recs
    });
    if (!res || !res.ok) return { ok: false, why: (res && res.error) || 'undo-save failed' };
    return { ok: true, id: res.id, count: res.count };
  } catch (e) {
    return { ok: false, why: String(e && e.message || e) };
  }
};
/* 备份失败确认窗：二选一 —— 取消注入 / 直接注入（跳过备份，本次不可撤销）。
   返回 'cancel' | 'go' */
function fzaConfirmBackupFailed(why) {
  return new Promise(resolve => {
    const ov = fzaOverlay();
    const ovCancel = ov.querySelector('.fza-cancel');
    if (ovCancel) ovCancel.classList.add('hidden');
    let done = false;
    const finish = v => { if (done) return; done = true; App.hideOverlay(ov); resolve(v); };
    App.fzaSetCancel(ov, () => finish('cancel'));
    const titleEl = ov.querySelector('.anchor-title');
    const t = App.i18n.t('fza.backupFailTitle');
    titleEl.setAttribute('data-title', t);
    titleEl.textContent = t;
    const body = fzaResetBox(ov);   /* 重建弹窗：正文 + box 上的弹窗级残留（工具条/页脚）一起清 */
    const msg = document.createElement('div');
    msg.className = 'fza-msg';
    msg.textContent = App.i18n.tf('fza.backupFailMsg', { why: String(why || '') });
    body.appendChild(msg);
    const btns = document.createElement('div');
    btns.className = 'anchor-btns';
    const no = document.createElement('button');
    no.textContent = App.i18n.t('fza.backupFailCancel');
    no.addEventListener('click', () => finish('cancel'));
    const yes = document.createElement('button');
    yes.textContent = App.i18n.t('fza.backupFailGo');
    yes.className = 'active';
    yes.addEventListener('click', () => finish('go'));
    btns.appendChild(no);
    btns.appendChild(yes);
    fzaFoot(ov).appendChild(btns);   /* 页脚：在滚动区之外 */
    App.showOverlay(ov);
  });
}
/* 备份 → 成功直接继续；失败弹窗询问。返回 true=继续注入，false=取消注入。 */
App.fzaBackupOrAsk = async function (acct, groups) {
  const r = await App.fzaBackupInjectGroups(acct, groups);
  if (r.ok) return true;
  const choice = await fzaConfirmBackupFailed(r.why);
  if (choice === 'go') {
    showToast(App.i18n.t('toast.fza.undoBackupSkipped'), 5000);
    return true;
  }
  showToast(App.i18n.tf('toast.fza.undoBackupFail', { why: r.why }), 6000);
  return false;
};

/* ---------- 撤销注入：三个窗口 + 流程编排 ---------- */
/* 撤销窗的分组行：缩略图用**备份时存下的原图**（dataURL），不是存档当前缩略图 ——
   用户看到的就是「将被恢复成什么样」。与 fzaThumbRow 同款结构，只是图源不同。 */
function fzaUndoThumbRow(g) {
  const wrap = document.createElement('span');
  wrap.className = 'fza-row';
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
  wrap.appendChild(box);
  const label = document.createElement('span');
  label.className = 'anchor-name';
  label.textContent = String(g.title || '') + (g.author ? ' - ' + g.author : '');
  wrap.appendChild(label);
  if (g.thumbDataUrl) {
    img.addEventListener('load', () => { img.classList.add('loaded'); fb.style.display = 'none'; });
    img.src = g.thumbDataUrl;
  }
  return wrap;
}
/* 窗口 A：列出最近三次注入（时间 + 分组数）。**点某一行直接进窗口 B**；
   底部只放「取消」——不另放确定键，避免重复放置按键。返回记录 id 或 null。 */
function fzaPickUndoRecord(records) {
  return new Promise(resolve => {
    const ov = fzaOverlay();
    const ovCancel = ov.querySelector('.fza-cancel');
    if (ovCancel) ovCancel.classList.add('hidden');
    let done = false;
    const finish = v => { if (done) return; done = true; App.hideOverlay(ov); resolve(v); };
    App.fzaSetCancel(ov, () => finish(null));
    const titleEl = ov.querySelector('.anchor-title');
    const t = App.i18n.t('fza.undoPickTitle');
    titleEl.setAttribute('data-title', t);
    titleEl.textContent = t;
    const body = fzaResetBox(ov);   /* 重建弹窗：正文 + box 上的弹窗级残留（工具条/页脚）一起清 */
    records.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = 'anchor-item fza-row';
      const idx = document.createElement('span');
      idx.className = 'fza-batch-idx';
      idx.textContent = (i + 1) + '.';
      row.appendChild(idx);
      const nameEl = document.createElement('span');
      nameEl.className = 'anchor-name';
      nameEl.textContent = App.i18n.tf('fza.undoRec', { time: r.time, count: r.count });
      row.appendChild(nameEl);
      row.addEventListener('click', () => finish(r.id));
      body.appendChild(row);
    });
    const btns = document.createElement('div');
    btns.className = 'anchor-btns';
    const no = document.createElement('button');
    no.textContent = App.i18n.t('fza.cancel');
    no.addEventListener('click', () => finish(null));
    btns.appendChild(no);
    fzaFoot(ov).appendChild(btns);   /* 页脚：在滚动区之外 */
    App.showOverlay(ov);
  });
}
/* 窗口 B：列出该次注入涉及的分组（缩略图 + 名字），右下角「取消 / 恢复」。
   返回 true=恢复 / false=取消。 */
function fzaConfirmUndoRestore(meta, groups) {
  return new Promise(resolve => {
    const ov = fzaOverlay();
    const ovCancel = ov.querySelector('.fza-cancel');
    if (ovCancel) ovCancel.classList.add('hidden');
    let done = false;
    const finish = v => { if (done) return; done = true; App.hideOverlay(ov); resolve(v); };
    App.fzaSetCancel(ov, () => finish(false));
    const titleEl = ov.querySelector('.anchor-title');
    const t = App.i18n.tf('fza.undoGroupsTitle', { n: groups.length });
    titleEl.setAttribute('data-title', t);
    titleEl.textContent = t;
    const body = fzaResetBox(ov);   /* 重建弹窗：正文 + box 上的弹窗级残留（工具条/页脚）一起清 */
    const msg = document.createElement('div');
    msg.className = 'fza-msg';
    msg.textContent = App.i18n.tf('fza.undoMsg', { time: (meta && meta.time) || '' });
    body.appendChild(msg);
    groups.forEach(g => {
      const row = document.createElement('div');
      row.className = 'anchor-item fza-row fza-confirm-row';
      row.appendChild(fzaUndoThumbRow(g));
      body.appendChild(row);
    });
    const btns = document.createElement('div');
    btns.className = 'anchor-btns';
    const no = document.createElement('button');
    no.textContent = App.i18n.t('fza.cancel');
    no.addEventListener('click', () => finish(false));
    const yes = document.createElement('button');
    yes.textContent = App.i18n.t('fza.undoOk');
    yes.className = 'active';
    yes.addEventListener('click', () => finish(true));
    btns.appendChild(no);
    btns.appendChild(yes);
    fzaFoot(ov).appendChild(btns);   /* 页脚：在滚动区之外 */
    App.showOverlay(ov);
  });
}
/* 窗口 C：原位置已不存在（游戏内被删）的分组，询问是否把它们注入前的原内容导出为 SVG。
   右下角「取消 / 导出」。返回 true=导出 / false=取消。 */
function fzaAskExportMissing(groups) {
  return new Promise(resolve => {
    const ov = fzaOverlay();
    const ovCancel = ov.querySelector('.fza-cancel');
    if (ovCancel) ovCancel.classList.add('hidden');
    let done = false;
    const finish = v => { if (done) return; done = true; App.hideOverlay(ov); resolve(v); };
    App.fzaSetCancel(ov, () => finish(false));
    const titleEl = ov.querySelector('.anchor-title');
    const t = App.i18n.t('fza.undoMissingTitle');
    titleEl.setAttribute('data-title', t);
    titleEl.textContent = t;
    const body = fzaResetBox(ov);   /* 重建弹窗：正文 + box 上的弹窗级残留（工具条/页脚）一起清 */
    const msg = document.createElement('div');
    msg.className = 'fza-msg';
    msg.textContent = App.i18n.tf('fza.undoMissingMsg', {
      n: groups.length,
      list: groups.map(g => g.title || g.folder || '').filter(Boolean).join('、')
    });
    body.appendChild(msg);
    groups.forEach(g => {
      const row = document.createElement('div');
      row.className = 'anchor-item fza-row fza-confirm-row';
      row.appendChild(fzaUndoThumbRow(g));
      body.appendChild(row);
    });
    const btns = document.createElement('div');
    btns.className = 'anchor-btns';
    const no = document.createElement('button');
    no.textContent = App.i18n.t('fza.cancel');
    no.addEventListener('click', () => finish(false));
    const yes = document.createElement('button');
    yes.textContent = App.i18n.t('fza.undoExportOk');
    yes.className = 'active';
    yes.addEventListener('click', () => finish(true));
    btns.appendChild(no);
    btns.appendChild(yes);
    fzaFoot(ov).appendChild(btns);   /* 页脚：在滚动区之外 */
    App.showOverlay(ov);
  });
}
/* 撤销流程编排：列表 → 确认 → 恢复 →（有丢失）询问导出为 SVG */
App.fzaRunUndo = async function () {
  const acct = await App.forza.ensureAccount();
  if (!acct) return;
  const lr = await window.sveApi.undoList();
  if (!lr || !lr.ok) { showToast(App.i18n.tf('toast.fza.undoFail', { why: (lr && lr.error) || '' }), 5000); return; }
  /* 记录按账户区分：只列当前账户的（老记录没写账户时不拦，避免看不见自己的备份） */
  const mine = (lr.records || []).filter(r => !r.account || !r.account.xuid || r.account.xuid === acct.xuid);
  if (!mine.length) { showToast(App.i18n.t('toast.fza.undoNothing')); return; }
  const id = await fzaPickUndoRecord(mine);
  if (!id) return;
  const rr = await window.sveApi.undoRead(id);
  if (!rr || !rr.ok) { showToast(App.i18n.tf('toast.fza.undoFail', { why: (rr && rr.error) || '' }), 5000); return; }
  const groups = rr.groups || [];
  if (!groups.length) { showToast(App.i18n.t('toast.fza.undoNothing')); return; }
  if (!(await fzaConfirmUndoRestore(rr.meta, groups))) return;
  const res = await window.sveApi.undoRestore(id);
  if (!res || !res.ok) { showToast(App.i18n.tf('toast.fza.undoFail', { why: (res && res.error) || '' }), 5000); return; }
  if (res.restored) showToast(App.i18n.tf('toast.fza.undoDone', { ok: res.restored }), 5000);
  /* 原位置已不见（游戏内被删除）的分组 → 询问是否导出为 SVG */
  const missing = (res.missing || []).map(i => groups[i]).filter(Boolean);
  if (!missing.length) return;
  if (!(await fzaAskExportMissing(missing))) return;
  let ok = 0, fail = 0;
  for (const g of missing) {
    try {
      const mr = await window.sveApi.undoReadModel(id, g.index);
      if (!mr || !mr.ok || !mr.model) { fail++; continue; }
      const svg = App.FZA.svgStringFromModel(mr.model, { embedSvg: App.libText });
      const base = App.fzaSafeFileTitle ? App.fzaSafeFileTitle(g.title || g.folder || 'undo') : (g.title || 'undo');
      const saved = await window.sveApi.saveSvgDialog(base + '.svg', svg.str);
      if (saved && !saved.canceled) ok++; else fail++;
    } catch (e) {
      fail++;
      console.warn('[undo] 导出 SVG 失败', String(e && e.message || e).slice(0, 160));
    }
  }
  if (ok) showToast(App.i18n.tf('toast.fza.undoExportDone', { n: ok }), 5000);
  if (fail) showToast(App.i18n.t('toast.fza.undoExportFail'), 5000);
};
App.exportGroupsMulti = async function () {
  const groups = await App.fzaPickGroupMulti();
  if (!groups) return null;
  return App.batchExportGroups(groups);
};
App.injectSvgsMulti = async function () {
  /* 本函数（连同下面的 exportGroupsMulti）必须挂到 UI 按钮上 ——
     否则「将 SVG 导入存档」弹窗里没有「多选」开关、批量功能形同虚设。
     btnFzaInject 直接指向本函数。
     账户前置与 exportToGame 保持一致（无账户先提示，不弹选择窗）。 */
  if (!(await App.forza.ensureAccount())) return null;
  let texts = null;
  await App.fzaPickSvgLibraryMulti(t => { texts = t; });
  if (!texts || !texts.length) return null;
  /* 入口再校验一次「非空字符串数组」。
     选择窗正常情况下只会回传 SVG 文本，但这里是外部数据进入解析器的唯一关口，
     加一道类型检查，防止文件信息对象一类的非法元素再次误入下游。 */
  if (!texts.every(t => typeof t === 'string' && t.trim())) {
    showToast(App.i18n.t('toast.fza.pickSvgTypeErr'), 6000);
    return null;
  }
  /* 数量校验规则统一：不再按数量分流。
     以前 1 个文件走 proceedInject（官方单选分组窗，没有「勾选」概念），
     于是「所选分组数必须正好等于文件数」这条规则在 N=1 时无法体现。
     现在一律走批量流程 —— 1 个文件同样进入「必须勾选正好 1 个」的分组窗，
     第 2 个分组点不动并提示已达上限。 */
  return App.batchInjectSvgs(texts);
};
