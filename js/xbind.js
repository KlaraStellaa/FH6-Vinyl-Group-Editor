'use strict';


App.XB_I18N = {
  'zh-CN': {
    'xb.notInCanvas': '不在画布中无法添加',
    'xb.pickHint': '请点击需要绑定的按键（Esc退出）',
    'xb.cannotBind': '无法绑定该按键',
    'xb.press': '按下要绑定的按键…（可同时按住多个）',
    'xb.conflict': '该键已被占用：{v}',
    'xb.empty': '还没绑定任何按键',
    'xb.assigned': '已写入该按键的快捷键，旧键已替换'
  },
  'zh-TW': {
    'xb.notInCanvas': '不在畫布中無法新增',
    'xb.pickHint': '請點擊需要綁定的按鍵（Esc退出）',
    'xb.cannotBind': '無法綁定該按鍵',
    'xb.press': '按下要綁定的按鍵…（可同時按住多個）',
    'xb.conflict': '該鍵已被佔用：{v}',
    'xb.empty': '還沒綁定任何按鍵',
    'xb.assigned': '已寫入該按鍵的快速鍵，舊鍵已替換'
  },
  'en': {
    'xb.notInCanvas': 'Not on the canvas — cannot add',
    'xb.pickHint': 'Click the key to bind (Esc to exit)',
    'xb.cannotBind': 'This key cannot be bound',
    'xb.press': 'Press the key to bind… (hold several to bind them together)',
    'xb.conflict': 'Already in use: {v}',
    'xb.empty': 'No key bound yet',
    'xb.assigned': 'Shortcut updated — the old key was replaced'
  },
  'ja': {
    'xb.notInCanvas': 'キャンバス上ではないため追加できません',
    'xb.pickHint': 'バインドするキーをクリック（Esc で終了）',
    'xb.cannotBind': 'このキーはバインドできません',
    'xb.press': 'バインドするキーを押してください…（同時押しで複数可）',
    'xb.conflict': '既に使用中：{v}',
    'xb.empty': 'まだキーがバインドされていません',
    'xb.assigned': 'このボタンのショートカットに書き込み、元のキーは置き換えました'
  },
  'ko': {
    'xb.notInCanvas': '캔버스가 아니어서 추가할 수 없습니다',
    'xb.pickHint': '바인딩할 키를 클릭하세요 (Esc 종료)',
    'xb.cannotBind': '이 키는 바인딩할 수 없습니다',
    'xb.press': '바인딩할 키를 누르세요… (동시에 여러 개 가능)',
    'xb.conflict': '이미 사용 중: {v}',
    'xb.empty': '아직 바인딩된 키가 없습니다',
    'xb.assigned': '이 버튼의 단축키로 기록했고 기존 키는 교체했습니다'
  }
};
Object.keys(App.XB_I18N).forEach(function (lang) {
  if (App.i18n.dicts[lang]) Object.assign(App.i18n.dicts[lang], App.XB_I18N[lang]);
});

App.xbind = {
  
  ACT: {
    btnHideLayers: 'hideLayers',
    btnHideBg: 'hideBg',
    btnHideOthers: 'hideOthers',
    btnBase: 'base',
    btnCut: 'cut',
    btnDelete: 'delete',
    btnFinish: 'editFinish',
    btnPlaceAnchor: 'anchor',
    btnPropMode: 'sizeMode',
    btnInsertBelow: 'insertBelow'
  },
  map: {},          
  names: {},        
  picking: false,
  dlg: null,
  hintEl: null,
  wasRef: false,

  
  load(saved) {
    this.map = {};
    this.names = {};
    const src = saved && saved.keys;
    if (src && typeof src === 'object') {
      Object.keys(src).forEach(k => {
        if (!Array.isArray(src[k])) return;
        
        if (this.ACT[k]) return;
        const list = src[k].filter(c => typeof c === 'string' &&
          window.SVE_KEYMAP && window.SVE_KEYMAP.isValidCombo(c)).slice(0, 4);
        if (list.length) this.map[k] = list;
      });
    }
    if (saved && saved.names && typeof saved.names === 'object') {
      Object.keys(saved.names).forEach(k => {
        if (typeof saved.names[k] === 'string') this.names[k] = saved.names[k];
      });
    }
  },
  payload() {
    const keys = {};
    Object.keys(this.map).forEach(k => { if (this.map[k].length) keys[k] = this.map[k].slice(); });
    return { keys: keys };
  },
  snapshot() { return JSON.parse(JSON.stringify({ map: this.map, names: this.names })); },
  restore(s) {
    this.map = (s && s.map) ? JSON.parse(JSON.stringify(s.map)) : {};
    this.names = (s && s.names) ? JSON.parse(JSON.stringify(s.names)) : {};
  },
  clear() { this.map = {}; this.names = {}; },

  
  entries() {
    return Object.keys(this.map)
      .filter(k => (this.map[k] || []).length)
      .map(k => ({ key: k, name: this.nameOfKey(k), combos: this.map[k].slice() }));
  },
  removeCombo(key, slot) {
    const arr = this.map[key];
    if (!arr || slot < 0 || slot >= arr.length) return false;
    arr.splice(slot, 1);
    if (!arr.length) delete this.map[key];
    return true;
  },

  
  elOf(key) {
    if (!key) return null;
    if (key.indexOf(':') === 0) return null;              
    const byId = document.getElementById(key);
    if (byId) return byId;
    return document.querySelector('[data-xbind="' + key + '"]');
  },
  keyOf(el) {
    if (!el) return '';
    if (el.id) return el.id;
    return el.getAttribute('data-xbind') || '';
  },
  
  nameOf(el) {
    if (!el) return '';
    let txt = '';
    try {
      const clone = el.cloneNode(true);
      if (clone.querySelectorAll) {
        Array.prototype.forEach.call(clone.querySelectorAll('kbd, svg'), n => n.remove());
      }
      txt = (clone.textContent || '').replace(/\s+/g, ' ').trim();
    } catch (e) { txt = ''; }
    if (!txt || (txt.length <= 2 && !/[A-Za-z0-9\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(txt))) {
      txt = el.getAttribute('aria-label') || el.getAttribute('title') || '';
    }
    return txt || this.keyOf(el) || '?';
  },
  nameOfKey(key) {
    const el = this.elOf(key);
    if (el) {
      const n = this.nameOf(el);
      if (n) this.names[key] = n;
      return n;
    }
    return this.names[key] || key;
  },

  
  excludes(target) {
    if (!target || !target.closest) return false;
    
    if (target.closest('#tabHome, .tab-pill, .tab-close, #btnSettings')) return true;
    
    if (target.closest('#btnShortcuts, #helpFab')) return true;
    
    if (target.closest('.layer-item')) return true;
    
    if (target.closest('.lib-item, .lib-filter-btn, .lib-filter-panel')) return true;
    
    if (target.closest('#colorWheel, #hRange, #sRange, #bRange, #hInput, #sInput, #bInput')) return true;
    return false;
  },
  bindable(target) {
    if (!target || !target.closest) return null;
    const el = target.closest('button, label[data-tab], #layerPlusRow');
    if (!el) return null;
    if (this.excludes(el)) return null;
    if (!this.keyOf(el)) return null;                 
    return el;
  },

  
  canFire(el) {
    if (!el || !el.isConnected) return false;
    if (el.disabled) return false;
    if (el.closest('.hidden')) return false;
    const r = el.getBoundingClientRect();
    if (!r || !r.width || !r.height) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none') return false;
    return true;
  },
  matchEntry(e, mouse) {
    const KM = window.SVE_KEYMAP;
    if (!KM) return null;
    for (const key of Object.keys(this.map)) {
      const combos = this.map[key] || [];
      for (let i = 0; i < combos.length; i++) {
        const c = combos[i];
        if (mouse) { if (KM.matchesMouse(c, e)) return { key: key, combo: c }; }
        else if (!KM.isMouseCombo(c) && KM.matchesEvent(c, e)) return { key: key, combo: c };
      }
    }
    return null;
  },
  blocked() {
    if (this.picking || (this.dlg && !this.dlg.el.classList.contains('hidden'))) return true;
    
    if (App.Home && App.Home.shown) return true;
    if (App.keymapUI && (App.keymapUI.isOpen() || App.keymapUI.capturing)) return true;
    return false;
  },
  onKey(e) {
    if (this.blocked()) return;
    if (e.key === 'Escape') return;
    const hit = this.matchEntry(e, false);
    if (!hit) return;
    const el = this.elOf(hit.key);
    if (!this.canFire(el)) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    el.click();
  },
  onMouse(e) {
    if (this.blocked()) return;
    const hit = this.matchEntry(e, true);
    if (!hit) return;
    const el = this.elOf(hit.key);
    if (!this.canFire(el)) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    el.click();
  },

  
  canvasActive() {
    return !(App.Home && App.Home.shown);
  },
  startPick() {
    if (this.picking) return;
    if (!this.canvasActive()) { showToast(App.i18n.t('xb.notInCanvas')); return; }
    
    if (App.state.edit) App.exitEdit(true);
    if (App.help && App.help.isArmed && App.help.isArmed()) App.help.exit();
    this.picking = true;
    
    const box = document.getElementById('settingsPanel');
    if (box && !box.classList.contains('hidden')) App.hideOverlay(box);
    this.closeOtherWindows();
    
    this.wasRef = !!(App.RefWindow && App.RefWindow.el && !App.RefWindow.el.classList.contains('hidden'));
    if (this.wasRef && App.RefWindow) App.RefWindow.hide();
    
    if (App.setSelToolbarVisible) App.setSelToolbarVisible(true);
    document.body.classList.add('sve-xpick');
    this.showHint();
    this.bindPickEvents(true);
    App.log && App.log('info', 'xbind.pick.start', {});
  },

  closeOtherWindows() {
    
    document.querySelectorAll('.confirm-overlay').forEach(el => {
      if (!el.classList.contains('hidden')) App.hideOverlay(el);
    });
    const hide = id => {
      const el = document.getElementById(id);
      if (el && !el.classList.contains('hidden')) App.hideOverlay(el);
    };
    ['logPanel', 'shortcutPanel', 'layerPickOv', 'fzaOv'].forEach(hide);
    if (App.speedEditor && App.speedEditor.isOpen && App.speedEditor.isOpen()) App.speedEditor.close();
    if (App.speedOverview && App.speedOverview.isOpen && App.speedOverview.isOpen()) App.speedOverview.close();
    if (App.autoSaveEditor && App.autoSaveEditor.isOpen && App.autoSaveEditor.isOpen()) App.autoSaveEditor.close();
  },

  endPick(backToSettings) {
    if (!this.picking) return;
    this.picking = false;
    this.bindPickEvents(false);
    document.body.classList.remove('sve-xpick');
    this.hideHint();
    
    if (this.wasRef && App.RefWindow && App.RefWindow.el) {
      App.RefWindow.el.classList.remove('hidden');
    }
    this.wasRef = false;
    if (App.updateSelToolbar) App.updateSelToolbar();
    if (backToSettings) {
      const box = document.getElementById('settingsPanel');
      if (box) App.showOverlay(box);
      if (App.keymapUI) {
        App.keymapUI.render();
        const list = document.getElementById('kmList');
        if (list) list.scrollTop = list.scrollHeight;   
      }
    }
    App.log && App.log('info', 'xbind.pick.end', { back: !!backToSettings });
  },

  showHint() {
    if (!this.hintEl) {
      this.hintEl = document.createElement('div');
      this.hintEl.id = 'xbindHint';
      document.body.appendChild(this.hintEl);
    }
    this.hintEl.textContent = App.i18n.t('xb.pickHint');
    this.hintEl.classList.add('sve-show');
  },
  hideHint() { if (this.hintEl) this.hintEl.classList.remove('sve-show'); },

  
  bindPickEvents(on) {
    const docs = ['pointerdown', 'mousedown', 'click'];
    if (on) {
      this._pick = e => this.onPick(e);
      docs.forEach(tp => document.addEventListener(tp, this._pick, true));
      
      this._pickKey = e => {
        if (!this.picking) return;
        e.preventDefault(); e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        if (this.dlgOpen()) {
          if (e.key === 'Escape') { this.closeDlg(); return; }  
          this.dlgKeyDown(e);
          return;
        }
        if (e.key === 'Escape') this.endPick(true);
      };
      this._pickUp = e => {
        if (!this.picking) return;
        e.preventDefault(); e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        if (this.dlgOpen()) this.dlgKeyUp(e);
      };
      window.addEventListener('keydown', this._pickKey, true);
      window.addEventListener('keyup', this._pickUp, true);
    } else {
      if (this._pick) docs.forEach(tp => document.removeEventListener(tp, this._pick, true));
      if (this._pickKey) window.removeEventListener('keydown', this._pickKey, true);
      if (this._pickUp) window.removeEventListener('keyup', this._pickUp, true);
      this._pick = null; this._pickKey = null; this._pickUp = null;
    }
  },
  dlgOpen() { return !!(this.dlg && !this.dlg.el.classList.contains('hidden')); },
  onPick(e) {
    if (!this.picking) return;
    
    if (this.dlgOpen()) {
      if (this.dlg.el.contains(e.target)) return;
      e.preventDefault(); e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      return;
    }
    const t = e.target;
    if (this.excludes(t)) {
      e.preventDefault(); e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      if (e.type === 'click') showToast(App.i18n.t('xb.cannotBind'));
      return;
    }
    const el = this.bindable(t);
    if (!el) {
      
      return;
    }
    e.preventDefault(); e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    if (e.type === 'click') {
      this.openDlg(el);
    }
  },

  
  buildDlg() {
    if (this.dlg && this.dlg.el.isConnected) return this.dlg.el;
    const ov = document.createElement('div');
    ov.id = 'xbindOv';
    ov.className = 'confirm-overlay';
    ov.innerHTML =
      '<div class="confirm-box settings-box km-mode xb-box">' +
        '<div class="anchor-title" data-i18n="km.moreKeys"></div>' +
        '<div class="km-row xb-row">' +
          '<div class="km-label" id="xbName"></div>' +
          '<div class="km-keys" id="xbKeys"></div>' +
        '</div>' +
        '<div class="km-hint" id="xbHint" data-i18n="xb.press"></div>' +
        '<div class="anchor-btns">' +
          '<button type="button" class="km-cancel xb-cancel" data-i18n="speed.cancel"></button>' +
          '<button type="button" class="km-ok xb-ok" data-i18n="speed.ok" disabled></button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    this.dlg = { el: ov, key: '', name: '', keys: [], pending: [], down: new Set(), btn: null };
    ov.querySelector('.xb-cancel').addEventListener('click', () => this.closeDlg());
    ov.querySelector('.xb-ok').addEventListener('click', () => this.commitDlg());
    
    this._dlgKeyDown = e => this.dlgKeyDown(e);
    this._dlgKeyUp = e => this.dlgKeyUp(e);
    this._dlgMouse = e => this.dlgMouse(e);
    return ov;
  },
  openDlg(el) {
    const ov = this.buildDlg();
    const d = this.dlg;
    d.key = this.keyOf(el);
    d.name = this.nameOf(el);
    
    d.keys = [];
    d.pending = [];
    d.down = new Set();
    ov.querySelector('#xbName').textContent = d.name;
    if (App.i18n.apply) App.i18n.apply(ov);
    this.paintDlg();
    App.showOverlay(ov);
    
    window.addEventListener('mousedown', this._dlgMouse, true);
  },
  closeDlg() {
    if (!this.dlg) return;
    App.hideOverlay(this.dlg.el);
    window.removeEventListener('mousedown', this._dlgMouse, true);
    this.dlg.pending = [];
    this.dlg.down = new Set();
    
    if (this.picking) this.showHint();
  },
  paintDlg() {
    const d = this.dlg;
    if (!d) return;
    const box = d.el.querySelector('#xbKeys');
    box.innerHTML = '';
    const all = d.keys.concat(d.pending.filter(c => d.keys.indexOf(c) < 0));
    all.forEach(c => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'km-key';
      b.disabled = true;
      const parts = window.SVE_KEYMAP.displayParts(c);
      parts.forEach((p, i) => {
        if (i > 0) {
          const plus = document.createElement('span');
          plus.className = 'sc-plus';
          plus.textContent = '+';
          b.appendChild(plus);
        }
        const kbd = document.createElement('kbd');
        kbd.textContent = p.i18n ? App.i18n.t(p.i18n) : p.text;
        b.appendChild(kbd);
      });
      box.appendChild(b);
    });
    const hint = d.el.querySelector('#xbHint');
    if (hint) hint.textContent = App.i18n.t(all.length ? 'xb.press' : 'xb.press');
    d.el.querySelector('.xb-ok').disabled = all.length === 0;   
  },
  dlgKeyDown(e) {
    if (!this.dlg || this.dlg.el.classList.contains('hidden')) return;
    e.preventDefault(); e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    if (e.key === 'Escape') { this.closeDlg(); return; }     
    const combo = window.SVE_KEYMAP.comboFromEvent(e);
    if (!combo) return;
    if (window.SVE_KEYMAP.modOnly(combo)) return;
    if (this.dlg.pending.indexOf(combo) < 0 && this.dlg.keys.indexOf(combo) < 0) {
      this.dlg.pending.push(combo);
    }
    this.dlg.down.add(e.code || e.key);
    this.paintDlg();
  },
  dlgKeyUp(e) {
    if (!this.dlg || this.dlg.el.classList.contains('hidden')) return;
    e.preventDefault(); e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    if (e.key === 'Escape') return;
    this.dlg.down.delete(e.code || e.key);
    if (!this.dlg.down.size && this.dlg.pending.length) {
      this.dlg.keys = this.dlg.keys.concat(this.dlg.pending).slice(0, 4);
      this.dlg.pending = [];
      this.paintDlg();
    }
  },
  dlgMouse(e) {
    if (!this.dlg || this.dlg.el.classList.contains('hidden')) return;
    if (e.button === 1) {
      e.preventDefault(); e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      showToast(App.i18n.t('km.mouse3'));
      return;
    }
    const combo = window.SVE_KEYMAP.mouseComboFromEvent(e);
    if (!combo) return;
    e.preventDefault(); e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    if (this.dlg.keys.indexOf(combo) < 0 && this.dlg.pending.indexOf(combo) < 0) {
      this.dlg.keys = this.dlg.keys.concat([combo]).slice(0, 4);
      this.paintDlg();
    }
  },
  
  findConflict(key, combos) {
    const KM = window.SVE_KEYMAP;
    const name = id => App.i18n.t((KM.ACTIONS_BY_ID[id] || {}).label || id);
    for (const a of KM.ACTIONS) {
      const list = App.keymap.combos(a.id) || [];
      for (const c of combos) {
        if (list.some(d => KM.sameBinding(c, d))) return name(a.id);
      }
    }
    return null;
  },
  commitDlg() {
    const d = this.dlg;
    if (!d) return;
    const key = d.key;
    const add = d.keys.slice();
    if (!add.length) return;
    const hasMouse = add.some(c => window.SVE_KEYMAP.isMouseCombo(c));
    const hasKey = add.some(c => !window.SVE_KEYMAP.isMouseCombo(c));
    if (hasMouse && hasKey) { showToast(App.i18n.t('km.mix')); return; }

    
    const act = this.ACT[key];
    if (act) {
      const r = App.keymap.overwriteCombos(act, add);
      if (r && r.error === 'mix') { showToast(App.i18n.t('km.mix')); return; }
      if (r && r.error) { showToast(App.i18n.tf('km.saveFail', { v: r.error })); return; }
      
      Object.keys(this.map).forEach(k => {
        const left = (this.map[k] || []).filter(c => !add.some(d2 => window.SVE_KEYMAP.sameBinding(c, d2)));
        if (left.length) this.map[k] = left; else { delete this.map[k]; delete this.names[k]; }
      });
      this.finishDlgApply(d);
      showToast(App.i18n.t('xb.assigned'));
      this.endPick(true);
      return;
    }

    
    const clash = this.findConflict(key, add);
    if (clash) { showToast(App.i18n.tf('xb.conflict', { v: clash })); return; }
    const out = add.slice(0, 4);
    Object.keys(this.map).forEach(k => {
      if (k === key) return;
      const left = (this.map[k] || []).filter(c => !out.some(d2 => window.SVE_KEYMAP.sameBinding(c, d2)));
      if (left.length) this.map[k] = left; else delete this.map[k];
    });
    this.map[key] = out;
    this.names[key] = d.name;
    this.finishDlgApply(d);
    showToast(App.i18n.t('km.extraAdded'));
    
    this.endPick(true);
  },

  
  finishDlgApply(d) {
    App.hideOverlay(d.el);
    window.removeEventListener('mousedown', this._dlgMouse, true);
    d.pending = [];
    d.down = new Set();
  },
};


window.addEventListener('keydown', function (e) { App.xbind.onKey(e); }, true);
window.addEventListener('mousedown', function (e) { App.xbind.onMouse(e); }, true);


if (App.i18n && App.i18n.onApply) {
  App.i18n.onApply(function () {
    if (App.xbind.hintEl && App.xbind.hintEl.classList.contains('sve-show')) {
      App.xbind.hintEl.textContent = App.i18n.t('xb.pickHint');
    }
    if (App.xbind.dlgOpen && App.xbind.dlgOpen()) App.xbind.paintDlg();
  });
}
