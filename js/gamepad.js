'use strict';

App.gpFocus = {
  active: false,
  
  mem: null,
  el: null,

  
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
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {  }
  },

  
  wake() {
    const bar = this.bar();
    if (!bar) return false;
    const list = this.buttons(bar);
    if (!list.length) return false;
    let target = null;
    if (this.mem) target = list.find(b => b.id === this.mem) || null;
    this.mem = null;              
    this.active = true;
    this.setFocus(target || list[0]);
    return true;
  },

  
  press(btnId) {
    if (!this.bar()) return false;
    if (!this.active || !this.el || !this.el.isConnected) { this.wake(); return true; }
    const dir = { DUp: 'up', DDown: 'down', DLeft: 'left', DRight: 'right' }[btnId];
    if (dir) this.move(dir);
    return true;
  },

  
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

  
  pressA() {
    const el = this.el;
    if (!el || !el.isConnected || el.disabled) return false;
    el.click();
    return true;
  },

  
  deactivate() {
    if (!this.active) return;
    if (this.el && this.el.id) this.mem = this.el.id;
    this.active = false;
    this.clearRing();
    this.el = null;
  },

  
  clear() {
    this.active = false;
    this.mem = null;
    this.el = null;
    this.clearRing();
  },

  
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
  
  DEAD: 0.18,
  
  HYST: 8,
  _pad: null,
  _pressed: new Set(),  
  _stickDir: null,      
  _stickAct: null,      
  _analogOn: false,
  _lastT: 0,
  _bp: {},              
  _btnAct: {},          
  _capPrev: {},         

  
  DIR_CENTER: [0, 90, 180, -90],
  
  STICK_ACT: { canvas: [null, 'up', null, 'down'], edit: ['moveRight', 'moveUp', 'moveLeft', 'moveDown'] },

  
  ev() {
    return {
      repeat: false, key: '', code: '', shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
      target: null, preventDefault() { }, stopPropagation() { }
    };
  },

  
  ctx() { return (App.state && App.state.edit) ? 'edit' : 'canvas'; },
  actionOf(btn) {
    if (!App.gpmap) return null;
    return App.gpmap.actionFor(btn, this.ctx());
  },
  
  openToolbarByRight() {
    if (!App.dispatchAction) return false;
    if (App.state && App.state.edit) return false;
    if (App.Home && App.Home.shown) return false;
    if (!App.whiteBoxLayer || !App.whiteBoxLayer()) return false;
    App.dispatchAction('toolbar', this.ev());
    return true;
  },
  
  _refs: {},
  act(A) {
    if (!A) return;
    const n = this._refs[A] || 0;
    this._refs[A] = n + 1;
    if (n) return;                       
    this._pressed.add(A);
    if (App.dispatchAction) App.dispatchAction(A, this.ev());
  },
  unact(A) {
    if (!A) return;
    const n = this._refs[A] || 0;
    if (n > 1) { this._refs[A] = n - 1; return; }   
    delete this._refs[A];
    if (!this._pressed.has(A)) return;
    this._pressed.delete(A);
    if (App.releaseAction) App.releaseAction(A, this.ev());
  },
  releaseAll() {
    this._refs = {};                                   
    Array.from(this._pressed).forEach(a => this.unact(a));
    this._btnAct = {};
    this._stickDir = null;
    this._stickAct = null;
  },
  
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

  
  btnDown(i) {
    const p = this._pad;
    return !!(p && p.buttons && p.buttons[i] && p.buttons[i].pressed);
  },
  
  edge(id, i) {
    const d = this.btnDown(i);
    const was = !!this._bp[id];
    this._bp[id] = d;
    return { d: d, e: d && !was };
  },

  handleButtons() {
    const GP = App.gpmap;
    if (!GP) return;

    
    const bar = App.gpFocus.bar();
    ['DUp', 'DDown', 'DLeft', 'DRight'].forEach(id => {
      const st = this.edge(id, GP.idxOf(id));
      if (st.d && bar) {
        
        if (st.e) App.gpFocus.press(id);
        this.releaseBtn(id);
      } else if (st.d) {
        
        if (id === 'DRight' && st.e && this.openToolbarByRight()) { this.releaseBtn(id); return; }
        
        if (st.e) this.pressBtn(id, this.actionOf(id));
      } else {
        this.releaseBtn(id);
      }
    });

    
    ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'L3', 'R3'].forEach(id => {
      const st = this.edge(id, GP.idxOf(id));
      if (!st.d) { this.releaseBtn(id); return; }
      
      if (id === 'A' && App.gpFocus.active) {
        this.releaseBtn(id);
        if (st.e) App.gpFocus.pressA();
        return;
      }
      if (st.e) this.pressBtn(id, this.actionOf(id));
    });
  },

  
  stickMag(pad) {
    const ax = (pad.axes && pad.axes[0]) || 0;
    const ay = (pad.axes && pad.axes[1]) || 0;
    return Math.sqrt(ax * ax + ay * ay);
  },
  
  _diagT: 0, _diagPad: '',
  diag(pad, ax, ay, mag) {
    const now = performance.now();
    const id = String(pad.id || '') + '|' + String(pad.mapping || 'none');
    if (id !== this._diagPad) {
      this._diagPad = id;
      this._diagT = now;
      try { App.log('info', '手柄已连接', { id: pad.id, mapping: pad.mapping, axes: (pad.axes || []).length, buttons: (pad.buttons || []).length }); } catch (e) {  }
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
    } catch (e) {  }
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
      
      this.releaseStickKeys();
      this.analogMove(ax, ay, mag);
    } else {
      this.stopAnalog();
      this.digitalStick(ax, ay);
    }
  },
  
  digitalStick(ax, ay) {
    const ang = Math.atan2(-ay, ax) * 180 / Math.PI;   
    let dir = this._stickDir;
    if (dir !== null) {
      const dev = Math.abs(this.norm180(ang - this.DIR_CENTER[dir]));
      if (dev <= 45 + this.HYST) {  }
      else dir = this.nearestDir(ang);
    } else {
      dir = this.nearestDir(ang);
    }
    this._stickDir = dir;
    const table = this.STICK_ACT[this.ctx()];
    const want = table ? table[dir] : null;
    
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

  
  poll() {
    if (!this.enabled) return;
    
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
