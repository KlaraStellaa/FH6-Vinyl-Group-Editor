'use strict';
/* ================= 手柄（Xbox 布局，Gamepad API）=================
   2026-10-29 用户口径：**手柄与键盘彻底解耦**。
     1. 手柄按键**不再投影成键盘按键** —— 旧实现往 window 派发合成 KeyboardEvent，
        键盘一改键手柄就跟着变、两个动作抢同一个键时还会串台，那套机制整个删掉。
     2. 手柄走自己的通道：直接调 App.dispatchAction(A, e) / App.releaseAction(A, e)，
        绑定表是独立的 App.gpmap（同一套动作、两套绑定）。
        键盘那边怎么改键，都不会让手柄按键失效 / 变错 / 串台。
     3. 摇杆（轴）不参与绑定，摇杆只当摇杆：
        数字 4 向（迟滞 8°）→ 画布上/下移白框、编辑模式里连续调整；
        移动模式的左摇杆仍是全向模拟量，直接调 App.applyEditMove（与 WASD 完全同一基准，
        设置里改「编辑速率」立刻生效）。这条通道**与 WASD 的代码路径分开**，互不打架。
     4. 焦点只管功能栏那 18 个按钮（#selToolbar）：手柄操作时按钮有可见焦点，
        键盘/鼠标一动立即失效（记忆点保留），功能栏一关记忆点彻底清掉。
     5. **十字键管按钮焦点、摇杆管图层选择**（2026-10-29 02:15 用户最终口径）：
        功能栏打开时十字键专职跳按钮，摇杆上下照旧移动左侧图层选择；两条通道并行不互抢。

   ★ 用户没有实体手柄：本文件的行为一律是「代码级正确 + 假手柄模拟输入验证」，
     不是真机实测。 */
App.gpFocus = {
  active: false,
  /* ★ 记忆点**全局只记一个**：焦点因键盘/鼠标失效时写入（按钮 id），重新唤起后立刻清空。
     不用数组、不往 DOM 上贴标记 ⇒ 不存在「越积越多让软件变大」。 */
  mem: null,
  el: null,

  /* 功能栏是否处于「可以给焦点」的状态：
     未进编辑 / 没被 Esc 收掉 / 不在主页 / 没有模态窗 / 节点可见且不在滑出动画里。
     （可见性判定沿用 PR #1 的口径：hidden 与 sve-bar-out 都算不可用） */
  bar() {
    if (!App.state) return null;
    if (App.state.edit) return null;
    if (App.state.selBarDismissed) return null;
    if (App.state.plusAnchorActive) return null;
    if (App.Home && App.Home.shown) return null;
    if (document.querySelector('.confirm-overlay:not(.hidden)')) return null;
    const bar = document.getElementById('selToolbar');
    if (!bar) return null;
    if (bar.classList.contains('hidden') || bar.classList.contains('sve-bar-out')) return null;
    return bar;
  },
  /* 可导航 = 没有被禁用、且真的占着版面（PR #1 的口径） */
  buttons(scope) {
    return Array.prototype.slice.call(scope.querySelectorAll('button:not(:disabled)'))
      .filter(b => b.getClientRects().length);
  },
  clearRing() {
    document.querySelectorAll('#selToolbar button.gp-focus').forEach(b => b.classList.remove('gp-focus'));
  },
  setFocus(el) {
    this.clearRing();
    if (!el) { this.el = null; return; }
    this.el = el;
    el.classList.add('gp-focus');
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* ignore */ }
  },

  /* 唤起焦点：有记忆点就从记忆点继续，没有就从**左上角第一个可用按钮**开始 */
  wake() {
    const bar = this.bar();
    if (!bar) return false;
    const list = this.buttons(bar);
    if (!list.length) return false;
    let target = null;
    if (this.mem) target = list.find(b => b.id === this.mem) || null;
    this.mem = null;              /* ★ 重新唤起即删除记忆点（只留一个，不堆积） */
    this.active = true;
    this.setFocus(target || list[0]);
    return true;
  },

  /* 十字键按下：焦点还没出现时，第一次按只把焦点落到起点（不移动） */
  press(btnId) {
    if (!this.bar()) return false;
    if (!this.active || !this.el || !this.el.isConnected) { this.wake(); return true; }
    const dir = { DUp: 'up', DDown: 'down', DLeft: 'left', DRight: 'right' }[btnId];
    if (dir) this.move(dir);
    return true;
  },

  /* 同列上下跳；跨列左右跳，按垂直距离就近选（算法照搬 PR #1） */
  move(dir) {
    const bar = this.bar();
    if (!bar || !this.el) return;
    const cols = Array.prototype.slice.call(bar.querySelectorAll('.st-col'));
    const col = this.el.closest('.st-col');
    let target = null;
    if (dir === 'up' || dir === 'down') {
      const list = this.buttons(col || bar);
      const i = list.indexOf(this.el);
      target = list[i + (dir === 'up' ? -1 : 1)] || null;
    } else {
      const adj = cols[cols.indexOf(col) + (dir === 'left' ? -1 : 1)];
      if (adj) {
        const cy = b => { const r = b.getBoundingClientRect(); return r.top + r.height / 2; };
        const y = cy(this.el);
        target = this.buttons(adj).sort((a, b) => Math.abs(cy(a) - y) - Math.abs(cy(b) - y))[0] || null;
      }
    }
    if (target) this.setFocus(target);
  },

  /* A 键：点当前焦点按钮（合成 click 不会执行浏览器默认动作，必须显式 .click()） */
  pressA() {
    const el = this.el;
    if (!el || !el.isConnected || el.disabled) return false;
    el.click();
    return true;
  },

  /* 键盘/鼠标一动：焦点立刻失效，但**保留记忆点**（功能栏还开着，手柄回来要接着走） */
  deactivate() {
    if (!this.active) return;
    if (this.el && this.el.id) this.mem = this.el.id;
    this.active = false;
    this.clearRing();
    this.el = null;
  },

  /* 功能栏关闭：连记忆点一起清（下次打开从左上角重新开始），DOM 残留标记一并清掉 */
  clear() {
    this.active = false;
    this.mem = null;
    this.el = null;
    this.clearRing();
  },

  /* 每帧兜底：功能栏没了 → 清干净；焦点元素被禁用/重建 → 重新落位 */
  tick() {
    const bar = this.bar();
    if (!bar) {
      if (this.active || this.mem || this.el) this.clear();
      return;
    }
    if (!this.active) return;
    const live = this.el && this.el.isConnected && !this.el.disabled && bar.contains(this.el);
    if (!live) this.wake();
  }
};

App.gamepad = {
  enabled: true,
  /* 摇杆死区：小于它一律当没推（避免漂移） */
  DEAD: 0.18,
  /* 数字方向判定的迟滞：越过 45° 分界还要多走 8° 才换向，
     这样「上推偏 10°」稳稳是正上，不会在分界线附近来回抖 */
  HYST: 8,
  _pad: null,
  _pressed: new Set(),  /* 当前按住的动作 id */
  _stickDir: null,      /* 0=右 1=上 2=左 3=下 */
  _stickAct: null,      /* 摇杆当前按住的动作 id */
  _analogOn: false,
  _lastT: 0,
  _bp: {},              /* 手柄按键 id → 上一帧是否按住（边沿检测） */
  _btnAct: {},          /* 手柄按键 id → 按下时派发的动作 id（松开必须按**同一个**动作回收：
                           上下文可能在这期间变了 —— 画布按 A 是 toolbar、编辑里按 A 是 editFinish，
                           按松开时的上下文去回收会漏掉一个，_pressed 里留下僵尸动作 ⇒ 手柄按键失效） */
  _capPrev: {},         /* 设置窗捕获时用的独立边沿表 */

  /* 数字方向的轴心角（度）：0=右 90=上 180=左 -90=下 */
  DIR_CENTER: [0, 90, 180, -90],
  /* 摇杆方向 → 动作（**摇杆不可自定义**，固定如下）：
       画布：只有上/下（= W/S；左/右在画布本来就没有动作）
       编辑（非移动模式）：连续调整上下左右（= WASD） */
  STICK_ACT: { canvas: [null, 'up', null, 'down'], edit: ['moveRight', 'moveUp', 'moveLeft', 'moveDown'] },

  /* 手柄事件是**伪事件**：dispatchAction 只读 repeat / key / shiftKey / target 并调 preventDefault，
     不必也不该伪造 KeyboardEvent（合成的 KeyboardEvent 是 untrusted，浏览器不会执行按钮默认动作，
     旧实现就是在这一点上既失效又串台）。 */
  ev() {
    return {
      repeat: false, key: '', code: '', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
      target: null, preventDefault() { }, stopPropagation() { }
    };
  },

  /* ---------- 手柄 → 动作（唯一入口，不经过键盘） ---------- */
  ctx() { return (App.state && App.state.edit) ? 'edit' : 'canvas'; },
  actionOf(btn) {
    if (!App.gpmap) return null;
    return App.gpmap.actionFor(btn, this.ctx());
  },
  /* 功能栏未呼出时，十字键 → 也能呼出（等价于 A/Enter 的单击）。
     条件与 toolbar 动作本身一致：不在编辑态、不在主页、有白框。
     返回 true 表示"这次按下已经被呼出消耗掉"，调用方不要再派发 nudgeRight。 */
  openToolbarByRight() {
    if (!App.dispatchAction) return false;
    if (App.state && App.state.edit) return false;
    if (App.Home && App.Home.shown) return false;
    if (!App.whiteBoxLayer || !App.whiteBoxLayer()) return false;
    App.dispatchAction('toolbar', this.ev());
    return true;
  },
  /* 引用计数：LT 和 RT 默认都绑 Tab（highlight），必须做到「任一按住就算按住、全松开才抬起」
     —— 与解耦前那句 `const trig = down(6) || down(7)` 逐字等价。
     顺带也覆盖「用户把两个物理键绑到同一个动作」的情况。 */
  _refs: {},
  act(A) {
    if (!A) return;
    const n = this._refs[A] || 0;
    this._refs[A] = n + 1;
    if (n) return;                       /* 别的按键已经按着它了：只加引用，不重复派发 */
    this._pressed.add(A);
    if (App.dispatchAction) App.dispatchAction(A, this.ev());
  },
  unact(A) {
    if (!A) return;
    const n = this._refs[A] || 0;
    if (n > 1) { this._refs[A] = n - 1; return; }   /* 还有一个按键按着：不抬 */
    delete this._refs[A];
    if (!this._pressed.has(A)) return;
    this._pressed.delete(A);
    if (App.releaseAction) App.releaseAction(A, this.ev());
  },
  releaseAll() {
    this._refs = {};                                   /* 先清引用计数：保证下面每一条都是真的「抬」 */
    Array.from(this._pressed).forEach(a => this.unact(a));
    this._btnAct = {};
    this._stickDir = null;
    this._stickAct = null;
  },
  /* 按下/松开都记着**按下那一刻**解析出的动作 id（见 _btnAct 注释） */
  pressBtn(id, A) {
    if (!A) { delete this._btnAct[id]; return; }
    this._btnAct[id] = A;
    this.act(A);
  },
  releaseBtn(id) {
    const A = this._btnAct[id];
    delete this._btnAct[id];
    if (A) this.unact(A);
  },

  /* 焦点在**文字输入**里时不抢输入（与键盘那条闸门同口径）。
     ★ 只拦文字类 input：滑条 / 勾选框 / 按钮拿到焦点时不该让手柄整体失效 ——
       拖过一次透明度滑条，document.activeElement 就停在 input[type=range] 上，
       以前这里会把整个手柄屏蔽掉（表现为「拖完滑条手柄就没反应了」）。 */
  blocked() {
    const t = document.activeElement;
    if (!t) return false;
    if (t.isContentEditable === true) return true;
    if (t.tagName === 'TEXTAREA') return true;
    if (t.tagName !== 'INPUT') return false;
    const ty = String(t.type || 'text').toLowerCase();
    return ['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file'].indexOf(ty) < 0;
  },
  editingLayer() {
    const e = App.state && App.state.edit;
    return !!(e && e.type !== 'bg');
  },
  inMoveMode() {
    return this.editingLayer() && App.state.editMode === 'move';
  },

  /* ---------- 按钮 ---------- */
  btnDown(i) {
    const p = this._pad;
    return !!(p && p.buttons && p.buttons[i] && p.buttons[i].pressed);
  },
  /* 边沿检测：返回 { d: 现在按住, e: 这一帧刚按下 } */
  edge(id, i) {
    const d = this.btnDown(i);
    const was = !!this._bp[id];
    this._bp[id] = d;
    return { d: d, e: d && !was };
  },

  handleButtons() {
    const GP = App.gpmap;
    if (!GP) return;

    /* 十字键：功能栏打开时**专职跳按钮焦点**（2026-10-29 口径），关着时才走绑定表 */
    const bar = App.gpFocus.bar();
    ['DUp', 'DDown', 'DLeft', 'DRight'].forEach(id => {
      const st = this.edge(id, GP.idxOf(id));
      if (st.d && bar) {
        /* 焦点模式：按下才动，不产生画布动作；顺手把之前可能按住的动作松开（不许两条通道并存） */
        if (st.e) App.gpFocus.press(id);
        this.releaseBtn(id);
      } else if (st.d) {
        /* 功能栏还没呼出时，→ 也能把它呼出来（2026-10-29 用户口径）。
           只在按下那一帧触发一次；呼出成功后 bar 非空，后续 → 自动转为跳焦点，
           既不会重复触发，也不会和编辑模式的 nudgeRight 抢（编辑态直接返回 false）。 */
        if (id === 'DRight' && st.e && this.openToolbarByRight()) { this.releaseBtn(id); return; }
        /* ★ 只在按下那一帧派发一次：act/unact 带引用计数，每帧都调会让计数越加越高，
           松开时减不到 0 → 这个动作永远卡在「按下」态（下一次按同一方向也不响应）。 */
        if (st.e) this.pressBtn(id, this.actionOf(id));
      } else {
        this.releaseBtn(id);
      }
    });

    /* 其余按键：A/B/X/Y、LB/RB、LT/RT、L3/R3（可绑定范围就是这 14 个，没有 Start/Back） */
    ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'L3', 'R3'].forEach(id => {
      const st = this.edge(id, GP.idxOf(id));
      if (!st.d) { this.releaseBtn(id); return; }
      /* A：焦点已经点亮时 = 点当前焦点按钮（PR #1 的核心技术点：必须显式 .click()） */
      if (id === 'A' && App.gpFocus.active) {
        this.releaseBtn(id);
        if (st.e) App.gpFocus.pressA();
        return;
      }
      if (st.e) this.pressBtn(id, this.actionOf(id));
    });
  },

  /* ---------- 左摇杆 ---------- */
  stickMag(pad) {
    const ax = (pad.axes && pad.axes[0]) || 0;
    const ay = (pad.axes && pad.axes[1]) || 0;
    return Math.sqrt(ax * ax + ay * ay);
  },
  /* 诊断日志（不弹任何界面文案）：手柄接上时记一次身份，推杆时每秒记一次原始轴值。
     用户「设置 → 查看日志 → 保存日志」之后可以直接看到到底收到的是什么输入。 */
  _diagT: 0, _diagPad: '',
  diag(pad, ax, ay, mag) {
    const now = performance.now();
    const id = String(pad.id || '') + '|' + String(pad.mapping || 'none');
    if (id !== this._diagPad) {
      this._diagPad = id;
      this._diagT = now;
      try { App.log('info', '手柄已连接', { id: pad.id, mapping: pad.mapping, axes: (pad.axes || []).length, buttons: (pad.buttons || []).length }); } catch (e) { /* ignore */ }
      return;
    }
    if (now - this._diagT < 1000) return;
    this._diagT = now;
    const dpad = [12, 13, 14, 15].filter(i => pad.buttons && pad.buttons[i] && pad.buttons[i].pressed);
    try {
      App.log('info', '手柄摇杆', {
        ax: Math.round(ax * 1000) / 1000, ay: Math.round(ay * 1000) / 1000,
        mag: Math.round(mag * 1000) / 1000, dpad: dpad, mode: this.inMoveMode() ? 'analog' : 'digital'
      });
    } catch (e) { /* ignore */ }
  },
  handleStick(pad) {
    const ax = (pad.axes && pad.axes[0]) || 0;
    const ay = (pad.axes && pad.axes[1]) || 0;
    const mag = Math.sqrt(ax * ax + ay * ay);
    if (mag >= this.DEAD) this.diag(pad, ax, ay, mag);
    if (mag < this.DEAD) {
      this.stopAnalog();
      this.releaseStickKeys();
      return;
    }
    if (this.inMoveMode()) {
      /* 模拟量通道独占：先把数字方向的键全部松开，绝不与 WASD 判定并存（打架） */
      this.releaseStickKeys();
      this.analogMove(ax, ay, mag);
    } else {
      this.stopAnalog();
      this.digitalStick(ax, ay);
    }
  },
  /* 数字方向：4 向 + 迟滞；一次只按一个动作（避免画布上一步变两步）。
     ★ 摇杆不受功能栏焦点影响：功能栏开着时上下照样移动左侧图层选择。 */
  digitalStick(ax, ay) {
    const ang = Math.atan2(-ay, ax) * 180 / Math.PI;   /* 0=右 90=上 -90=下 ±180=左 */
    let dir = this._stickDir;
    if (dir !== null) {
      const dev = Math.abs(this.norm180(ang - this.DIR_CENTER[dir]));
      if (dev <= 45 + this.HYST) { /* 仍在本方向的扇区内（含迟滞）：保持 */ }
      else dir = this.nearestDir(ang);
    } else {
      dir = this.nearestDir(ang);
    }
    this._stickDir = dir;
    const table = this.STICK_ACT[this.ctx()];
    const want = table ? table[dir] : null;
    /* 换向：先松开旧动作再按新动作。
       ★ act/unact 是**带引用计数**的，只能在「方向真的变了」那一刻调一次；
         每帧都调会把计数越加越高（松开时永远减不到 0 → 动作卡在按下态，摇杆从此失灵）。 */
    const prev = this._stickAct;
    if (prev && prev !== want) this.unact(prev);
    this._stickAct = want;
    if (want && prev !== want) this.act(want);
  },
  nearestDir(ang) {
    let best = 0, bestD = 999;
    for (let i = 0; i < 4; i++) {
      const d = Math.abs(this.norm180(ang - this.DIR_CENTER[i]));
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  },
  norm180(x) { return ((x + 180) % 360 + 360) % 360 - 180; },
  releaseStickKeys() {
    if (this._stickAct) { this.unact(this._stickAct); this._stickAct = null; }
    this._stickDir = null;
  },

  /* 移动模式：全向模拟量。位移 = (editSpeeds.move / view.scale) × 幅度 × dt
     —— 与 App.tick 的 WASD 完全同一基准，所以设置里的「编辑速率」改了立刻生效。 */
  analogMove(ax, ay, mag) {
    const now = performance.now();
    if (!this._lastT) this._lastT = now;
    const dt = Math.min(0.1, Math.max(0, (now - this._lastT) / 1000));
    this._lastT = now;
    if (!this._analogOn) {
      this._analogOn = true;
      if (App.editHist && App.editHist.checkpoint) App.editHist.checkpoint();
    }
    const t = Math.min(1, Math.max(0, (mag - this.DEAD) / (1 - this.DEAD)));
    const speeds = (App.state && App.state.editSpeeds) || {};
    const base = isFinite(speeds.move) ? speeds.move : 70;
    const scale = (App.state && App.state.view && App.state.view.scale) || 1;
    const sp = base / scale;
    const dx = (ax / mag) * sp * t * dt;
    const dy = (ay / mag) * sp * t * dt;
    if (dx || dy) App.applyEditMove(dx, dy);
  },
  stopAnalog() {
    if (!this._analogOn) { this._lastT = 0; return; }
    this._analogOn = false;
    this._lastT = 0;
    if (App.editHist && App.editHist.endGesture) App.editHist.endGesture();
  },

  /* 设置窗里「等用户按一个手柄按键」：捕获期间不产生任何动作 */
  captureTick() {
    const GP = App.gpmap;
    if (!GP || !GP.capturing) return;
    for (let i = 0; i < GP.BUTTONS.length; i++) {
      const b = GP.BUTTONS[i];
      const d = this.btnDown(b.idx);
      const was = !!this._capPrev[b.id];
      this._capPrev[b.id] = d;
      if (d && !was) { GP.finishCapture(b.id); return; }
    }
  },

  /* ---------- 轮询 ---------- */
  poll() {
    if (!this.enabled) return;
    /* 功能栏没了就把记忆点清干净（切页面/鼠标点别处/进编辑都由这条兜底） */
    App.gpFocus.tick();

    let pad = null;
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (let i = 0; i < pads.length; i++) {
        const p = pads[i];
        if (p && p.connected) { pad = p; break; }
      }
    } catch (e) { pad = null; }
    if (!pad) {
      if (this._pad) {
        this._pad = null; this._bp = {}; this._capPrev = {};
        this.releaseAll(); this.stopAnalog(); App.gpFocus.deactivate();
      }
      return;
    }
    this._pad = pad;
    /* 设置窗正在等一个手柄按键：只做捕获，别的什么都不做 */
    if (App.gpmap && App.gpmap.capturing) {
      this.releaseAll();
      this.stopAnalog();
      this.captureTick();
      return;
    }
    this._capPrev = {};
    if (this.blocked()) {
      this.releaseAll();
      this.stopAnalog();
      return;
    }
    this.handleButtons();
    this.handleStick(pad);
  },
  start() {
    if (this._started) return;
    this._started = true;
    const loop = () => {
      try { this.poll(); } catch (e) { console.warn('[gamepad] 轮询异常', String(e && e.message || e).slice(0, 160)); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    /* 键盘/鼠标一操作，焦点立即失效（视觉消失），但记忆点保留 */
    window.addEventListener('keydown', () => App.gpFocus.deactivate(), true);
    window.addEventListener('pointerdown', () => App.gpFocus.deactivate(), true);
    window.addEventListener('mousedown', () => App.gpFocus.deactivate(), true);
    window.addEventListener('wheel', () => App.gpFocus.deactivate(), { capture: true, passive: true });
    window.addEventListener('blur', () => {
      this.releaseAll(); this.stopAnalog(); this._bp = {}; this._capPrev = {};
      App.gpFocus.deactivate();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.releaseAll(); this.stopAnalog(); this._bp = {}; this._capPrev = {};
        App.gpFocus.deactivate();
      }
    });
  }
};
App.gamepad.start();
