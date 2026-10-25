'use strict';
/* ================= 手柄（Xbox 布局，Gamepad API）=================
   用户口径（2026-10-26）：
     A→Enter、B→Esc、X→X、Y→Y、两个扳机（RT/LT）→Tab（按住态，与键盘 Tab 同语义）；
     左摇杆→WASD、十字键→方向键；右摇杆**不理会**；
     编辑图层「移动」模式里左摇杆必须按**真实方位**走（全向、模拟量），不能退化成八方向；
     LB/RB 在图层编辑模式里左/右移一格模式（到边界不响应）；
     左摇杆判 WASD 的角度区域必须有明确边界（上推偏 10° 也算 W）；
     移动模式的摇杆与 WASD 判定**绝不许打架**。

   实现原则：**不新造一套动作**。数字按键一律派发真实 KeyboardEvent，
   走 App.keymap 查表 → 自动继承自定义键位、上下文、输入框闸门、帮助模式拦截。
   只有「移动模式的模拟量」这一条不走按键，直接调 App.applyEditMove（并把摇杆的
   虚拟 WASD 键全部松开，保证两条通道不并存）。

   速度口径：与 WASD **完全同一基准** —— 每帧位移 = (editSpeeds.move / view.scale) × 摇杆幅度 × dt。
   所以设置里改「编辑速率」立刻生效，摇杆只是乘一个 0~1 的百分比，不是写死的数值。 */
App.gamepad = {
  enabled: true,
  /* 摇杆死区：小于它一律当没推（避免漂移） */
  DEAD: 0.18,
  /* 数字方向（WASD）判定的迟滞：越过 45° 分界还要多走 8° 才换向，
     这样「上推偏 10°」稳稳是 W，不会在分界线附近来回抖 */
  HYST: 8,
  _pad: null,
  _pressed: new Set(),
  _stickDir: null,      /* 0=右 1=上 2=左 3=下 */
  _analogOn: false,
  _lastT: 0,

  CODE: {
    'w': 'KeyW', 'a': 'KeyA', 's': 'KeyS', 'd': 'KeyD',
    'x': 'KeyX', 'y': 'KeyY',
    'ArrowUp': 'ArrowUp', 'ArrowDown': 'ArrowDown', 'ArrowLeft': 'ArrowLeft', 'ArrowRight': 'ArrowRight',
    'Tab': 'Tab', 'Enter': 'Enter', 'Escape': 'Escape'
  },
  /* 数字方向的轴心角（度）：0=右 90=上 180=左 -90=下 */
  DIR_CENTER: [0, 90, 180, -90],
  DIR_KEY: ['d', 'w', 'a', 's'],
  MODES: ['move', 'size', 'rotate', 'skew', 'opacity'],

  send(type, key) {
    const ev = new KeyboardEvent(type, {
      key: key, code: this.CODE[key] || '', bubbles: true, cancelable: true
    });
    window.dispatchEvent(ev);
  },
  press(key) {
    if (this._pressed.has(key)) return;
    this._pressed.add(key);
    this.send('keydown', key);
  },
  release(key) {
    if (!this._pressed.has(key)) return;
    this._pressed.delete(key);
    this.send('keyup', key);
  },
  releaseAll() {
    Array.from(this._pressed).forEach(k => this.release(k));
    this._stickDir = null;
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
  handleButtons(pad) {
    const b = pad.buttons || [];
    const down = i => !!(b[i] && b[i].pressed);
    const edge = (i, key) => { if (down(i)) this.press(key); else this.release(key); };

    edge(0, 'Enter');    /* A */
    edge(1, 'Escape');   /* B */
    edge(2, 'x');        /* X */
    edge(3, 'y');        /* Y */

    /* 十字键 → 方向键。
       ★ 摇杆已经在给模拟量时，十字键的「方向」不再重复映射：
         不少手柄/驱动会把左摇杆同时镜像成 DPad，两路一起走会表现为
         「一会儿连续、一会儿按格子蹦」。摇杆优先，十字键让位。 */
    const stickLive = this.stickMag(pad) >= this.DEAD;
    if (stickLive) {
      this.release('ArrowUp'); this.release('ArrowDown');
      this.release('ArrowLeft'); this.release('ArrowRight');
    } else {
      edge(12, 'ArrowUp');
      edge(13, 'ArrowDown');
      edge(14, 'ArrowLeft');
      edge(15, 'ArrowRight');
    }

    /* 两个扳机 → Tab（按住态）：任一按住就算按住，全松开才抬起 */
    const trig = down(6) || down(7);
    if (trig) this.press('Tab'); else this.release('Tab');

    /* 肩键 → 编辑模式左右移一格（边沿触发，到边界不响应） */
    this.edgeButton(4, () => this.stepMode(-1));
    this.edgeButton(5, () => this.stepMode(1));
  },
  _prevBtn: {},
  edgeButton(i, fn) {
    const pad = this._pad;
    const pressed = !!(pad && pad.buttons && pad.buttons[i] && pad.buttons[i].pressed);
    const was = !!this._prevBtn[i];
    this._prevBtn[i] = pressed;
    if (pressed && !was) fn();
  },
  stepMode(dir) {
    /* 只在**图层编辑**里切（编辑背景图片时肩键不响应，与需求一致） */
    if (!this.editingLayer()) return;
    const i = this.MODES.indexOf(App.state.editMode);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= this.MODES.length) return;   /* 边界：不响应，不循环 */
    App.setEditMode(this.MODES[j]);
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
  /* 数字方向：4 向（上/下/左/右）+ 迟滞；一次只按一个键（避免画布上一步变两步） */
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
    const want = this.DIR_KEY[dir];
    /* 换向：先松开旧键再按新键 */
    ['w', 'a', 's', 'd'].forEach(k => { if (k !== want) this.release(k); });
    this.press(want);
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
    if (this._stickDir === null) return;
    this._stickDir = null;
    ['w', 'a', 's', 'd'].forEach(k => this.release(k));
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

  /* ---------- 轮询 ---------- */
  poll() {
    if (!this.enabled) return;
    let pad = null;
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (let i = 0; i < pads.length; i++) {
        const p = pads[i];
        if (p && p.connected) { pad = p; break; }
      }
    } catch (e) { pad = null; }
    if (!pad) {
      if (this._pad) { this._pad = null; this._prevBtn = {}; this.releaseAll(); this.stopAnalog(); }
      return;
    }
    this._pad = pad;
    if (this.blocked()) {
      this.releaseAll();
      this.stopAnalog();
      return;
    }
    this.handleButtons(pad);
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
    window.addEventListener('blur', () => { this.releaseAll(); this.stopAnalog(); this._prevBtn = {}; });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.releaseAll(); this.stopAnalog(); this._prevBtn = {}; }
    });
  }
};
App.gamepad.start();
