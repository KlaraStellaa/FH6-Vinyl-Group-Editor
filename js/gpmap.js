'use strict';
App.gpmap = {
  BUTTONS: [
    { id: 'A', idx: 0 }, { id: 'B', idx: 1 }, { id: 'X', idx: 2 }, { id: 'Y', idx: 3 },
    { id: 'DUp', idx: 12 }, { id: 'DDown', idx: 13 }, { id: 'DLeft', idx: 14 }, { id: 'DRight', idx: 15 },
    { id: 'LB', idx: 4 }, { id: 'RB', idx: 5 }, { id: 'LT', idx: 6 }, { id: 'RT', idx: 7 },
    { id: 'L3', idx: 10 }, { id: 'R3', idx: 11 }
  ],
  GLYPH: { DUp: '↑', DDown: '↓', DLeft: '←', DRight: '→' },

  DEFAULTS: {
    toolbar: ['A'], editFinish: ['A'], escape: ['B'],
    cut: ['X'], paste: ['Y'], editDup: ['Y'],
    up: ['DUp'], down: ['DDown'],
    nudgeUp: ['DUp'], nudgeDown: ['DDown'], nudgeLeft: ['DLeft'], nudgeRight: ['DRight'],
    modePrev: ['LB'], modeNext: ['RB'],
    highlight: ['LT', 'RT'], editFlip: ['LT', 'RT']
  },

  map: null,         
  index: null,       
  capturing: null,   

  actions() { return (window.SVE_KEYMAP && window.SVE_KEYMAP.ACTIONS) || []; },
  isButton(id) { return this.BUTTONS.some(b => b.id === id); },
  idxOf(id) { const b = this.BUTTONS.find(x => x.id === id); return b ? b.idx : -1; },
  glyph(id) { return this.GLYPH[id] || id; },

  init() { this.map = this.resolve(null); this.reindex(); return this.map; },

  resolve(saved) {
    const out = {};
    this.actions().forEach(a => {
      const def = (this.DEFAULTS[a.id] || []).slice();
      const v = saved && Object.prototype.hasOwnProperty.call(saved, a.id) ? saved[a.id] : undefined;
      if (!Array.isArray(v)) { out[a.id] = def; return; }
      const keep = [];
      v.forEach(id => { if (typeof id === 'string' && this.isButton(id) && keep.indexOf(id) < 0) keep.push(id); });
      out[a.id] = keep;
    });
    return out;
  },

  load(saved) { this.map = this.resolve(saved); this.reindex(); return this.map; },

  reindex() {
    const idx = { global: {}, canvas: {}, edit: {} };
    this.actions().forEach(a => {
      const ctx = idx[a.ctx] || (idx[a.ctx] = {});
      (this.map[a.id] || []).forEach(btn => { ctx[btn] = a.id; });
    });
    this.index = idx;
    return idx;
  },

  combos(id) { return (this.map[id] || []).slice(); },

  actionFor(btn, ctx) {
    if (!this.index) this.reindex();
    const local = this.index[ctx];
    if (local && local[btn]) return local[btn];
    return this.index.global[btn] || null;
  },

  payload() {
    const out = {};
    this.actions().forEach(a => {
      const cur = this.map[a.id] || [];
      const def = this.DEFAULTS[a.id] || [];
      if (cur.length !== def.length || cur.some((v, i) => v !== def[i])) out[a.id] = cur.slice();
    });
    return out;
  },

  snapshot() { return JSON.parse(JSON.stringify(this.map)); },
  restore(snap) { this.map = JSON.parse(JSON.stringify(snap)); this.reindex(); },
  resetToDefaults() { this.map = this.resolve(null); this.reindex(); },

  setButton(id, slot, btn) {
    const KM = window.SVE_KEYMAP;
    const mine = this.map[id];
    if (!KM || !mine || slot < 0 || slot >= mine.length || !this.isButton(btn)) return [];
    const old = mine[slot];
    if (old === btn) return [];
    const swapped = [];
    this.actions().forEach(a => {
      if (a.id === id || !KM.canConflict(a.id, id)) return;
      (this.map[a.id] || []).forEach((b, i) => {
        if (b === btn) { this.map[a.id][i] = old; swapped.push(a.id); }
      });
    });
    mine[slot] = btn;
    this.reindex();
    return swapped;
  },

  addButton(id, btn) {
    const KM = window.SVE_KEYMAP;
    if (!KM || !this.map[id] || !this.isButton(btn)) return null;
    const mine = this.map[id];
    if (mine.indexOf(btn) >= 0) return '';
    let clash = null;
    this.actions().forEach(a => {
      if (a.id === id || !KM.canConflict(a.id, id)) return;
      if ((this.map[a.id] || []).indexOf(btn) >= 0) clash = a.id;
    });
    if (clash) return clash;
    mine.push(btn);
    this.reindex();
    return '';
  },

  removeButton(id, slot) {
    const arr = this.map[id];
    if (!arr || slot < 0 || slot >= arr.length) return false;
    arr.splice(slot, 1);
    this.reindex();
    return true;
  },

  conflicts() {
    const KM = window.SVE_KEYMAP;
    if (!KM) return [];
    const flat = [];
    this.actions().forEach(a => {
      (this.map[a.id] || []).forEach(btn => flat.push({ id: a.id, ctx: a.ctx, btn: btn }));
    });
    const list = [];
    for (let i = 0; i < flat.length; i++) {
      for (let j = i + 1; j < flat.length; j++) {
        if (flat[i].btn !== flat[j].btn) continue;
        if (!KM.canConflict(flat[i].id, flat[j].id)) continue;
        list.push({ a: flat[i].id, b: flat[j].id, btn: flat[i].btn });
      }
    }
    return list;
  },

  startCapture(id, slot, isNew) { this.capturing = { id, slot, isNew: !!isNew }; },
  stopCapture() { this.capturing = null; },
  finishCapture(btn) {
    const cap = this.capturing;
    if (!cap) return;
    this.capturing = null;
    if (App.keymapUI && App.keymapUI.onGpCapture) App.keymapUI.onGpCapture(cap, btn);
  }
};
App.gpmap.init();
