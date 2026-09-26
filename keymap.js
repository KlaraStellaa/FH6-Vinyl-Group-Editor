'use strict';

var ACTIONS = [
  { id: 'pan', ctx: 'global', def: ['space'], label: 'km.a.pan' },
  { id: 'highlight', ctx: 'global', def: ['Tab'], label: 'km.a.highlight' },
  { id: 'undo', ctx: 'global', def: ['ctrl+z'], label: 'km.a.undo' },
  { id: 'redo', ctx: 'global', def: ['ctrl+shift+z'], label: 'km.a.redo' },
  { id: 'base', ctx: 'global', def: ['p'], label: 'km.a.base' },
  { id: 'hideLayers', ctx: 'global', def: ['c'], label: 'km.a.hideLayers' },
  { id: 'hideBg', ctx: 'global', def: ['v'], label: 'km.a.hideBg' },
  { id: 'escape', ctx: 'global', def: ['Escape'], label: 'km.a.escape' },

  { id: 'up', ctx: 'canvas', def: ['w', 'ArrowUp'], label: 'km.a.up' },
  { id: 'down', ctx: 'canvas', def: ['s', 'ArrowDown'], label: 'km.a.down' },
  { id: 'toolbar', ctx: 'canvas', def: ['Enter'], label: 'km.a.toolbar' },
  { id: 'cut', ctx: 'canvas', def: ['x'], label: 'km.a.cut' },
  { id: 'paste', ctx: 'canvas', def: ['y'], label: 'km.a.paste' },
  { id: 'delete', ctx: 'canvas', def: ['Delete', 'Backspace'], label: 'km.a.delete' },

  { id: 'editFinish', ctx: 'edit', def: ['Enter'], label: 'km.a.editFinish' },
  { id: 'editDelete', ctx: 'edit', def: ['Delete'], label: 'km.a.editDelete' },
  { id: 'editDup', ctx: 'edit', def: ['y'], label: 'km.a.editDup' },
  { id: 'anchor', ctx: 'edit', def: ['f'], label: 'km.a.anchor' },
  { id: 'sizeMode', ctx: 'edit', def: ['Backspace'], label: 'km.a.sizeMode' },
  { id: 'editFlip', ctx: 'edit', def: ['Tab'], label: 'km.a.editFlip', overrides: 'highlight' },
  { id: 'mode1', ctx: 'edit', def: ['1'], label: 'km.a.mode1' },
  { id: 'mode2', ctx: 'edit', def: ['2'], label: 'km.a.mode2' },
  { id: 'mode3', ctx: 'edit', def: ['3'], label: 'km.a.mode3' },
  { id: 'mode4', ctx: 'edit', def: ['4'], label: 'km.a.mode4' },
  { id: 'mode5', ctx: 'edit', def: ['5'], label: 'km.a.mode5' },
  { id: 'nudgeUp', ctx: 'edit', def: ['ArrowUp'], label: 'km.a.nudgeUp' },
  { id: 'nudgeDown', ctx: 'edit', def: ['ArrowDown'], label: 'km.a.nudgeDown' },
  { id: 'nudgeLeft', ctx: 'edit', def: ['ArrowLeft'], label: 'km.a.nudgeLeft' },
  { id: 'nudgeRight', ctx: 'edit', def: ['ArrowRight'], label: 'km.a.nudgeRight' },
  { id: 'moveUp', ctx: 'edit', def: ['w'], label: 'km.a.moveUp' },
  { id: 'moveDown', ctx: 'edit', def: ['s'], label: 'km.a.moveDown' },
  { id: 'moveLeft', ctx: 'edit', def: ['a'], label: 'km.a.moveLeft' },
  { id: 'moveRight', ctx: 'edit', def: ['d'], label: 'km.a.moveRight' }
];

var GROUPS = [
  { ctx: 'global', title: 'km.g.global' },
  { ctx: 'canvas', title: 'km.g.canvas' },
  { ctx: 'edit', title: 'km.g.edit' }
];

var ACTIONS_BY_ID = {};
ACTIONS.forEach(function (a) { ACTIONS_BY_ID[a.id] = a; });

var REJECT_KEYS = { 'Dead': 1, 'Unidentified': 1, 'Process': 1, 'Compose': 1 };
var MODS = ['ctrl', 'alt', 'shift'];

function isAction(id) { return !!ACTIONS_BY_ID[id]; }
function defaultCombo(id) { var a = ACTIONS_BY_ID[id]; return a ? a.def.slice() : null; }
function contextOf(id) { var a = ACTIONS_BY_ID[id]; return a ? a.ctx : null; }

function normalizeKey(e) {
  if (!e) return null;
  var k = e.key;
  if (e.code === 'Space' || k === ' ') k = 'space';
  if (!k || REJECT_KEYS[k]) return null;
  if (k.length === 1) k = k.toLowerCase();
  else if (k === 'Esc') k = 'Escape';
  var parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  parts.push(k);
  return parts.join('+');
}

function splitCombo(combo) {
  var parts = String(combo || '').split('+');
  var key = parts.pop() || '';
  var mods = { ctrl: false, alt: false, shift: false };
  parts.forEach(function (p) { if (mods[p] !== undefined) mods[p] = true; });
  return { mods: mods, key: key, hasMod: parts.length > 0 };
}

function isValidCombo(combo) {
  if (typeof combo !== 'string' || !combo) return false;
  var s = splitCombo(combo);
  if (!s.key || MODS.indexOf(s.key) >= 0) return false;
  var want = MODS.filter(function (m) { return s.mods[m]; });
  var got = String(combo).split('+').slice(0, -1);
  if (want.length !== got.length) return false;
  for (var i = 0; i < want.length; i++) if (want[i] !== got[i]) return false;
  return true;
}

function matchesEvent(combo, e) {
  if (!isValidCombo(combo)) return false;
  var ev = normalizeKey(e);
  if (!ev) return false;
  if (ev === combo) return true;
  var s = splitCombo(combo);
  if (s.hasMod) return false;
  var evs = splitCombo(ev);
  if (evs.mods.ctrl || evs.mods.alt) return false;
  return evs.key === s.key;
}

function matchSet(combo) {
  if (!isValidCombo(combo)) return [];
  var s = splitCombo(combo);
  if (s.mods.ctrl || s.mods.alt) return [combo];
  return s.mods.shift ? ['shift+' + s.key, s.key] : [s.key, 'shift+' + s.key];
}
function sameBinding(a, b) {
  if (a === b) return true;
  var A = matchSet(a), B = matchSet(b);
  return A.some(function (x) { return B.indexOf(x) >= 0; });
}

function resolve(saved) {
  var out = {};
  ACTIONS.forEach(function (a) {
    var def = a.def.slice();
    var v = saved && Object.prototype.hasOwnProperty.call(saved, a.id) ? saved[a.id] : undefined;
    if (!Array.isArray(v)) { out[a.id] = def; return; }
    var keep = [];
    v.forEach(function (c) {
      if (typeof c !== 'string') return;
      var canon = c === 'esc' ? 'Escape' : c;
      if (!isValidCombo(canon)) return;
      if (keep.indexOf(canon) < 0) keep.push(canon);
    });
    out[a.id] = keep.length ? keep : def;
  });
  return out;
}

function toSaved(map) {
  var out = {};
  ACTIONS.forEach(function (a) {
    var cur = (map && map[a.id]) || a.def;
    if (cur.length !== a.def.length || cur.some(function (c, i) { return c !== a.def[i]; })) {
      out[a.id] = cur.slice();
    }
  });
  return out;
}

function canConflict(idA, idB) {
  if (idA === idB) return false;
  var a = ACTIONS_BY_ID[idA], b = ACTIONS_BY_ID[idB];
  if (!a || !b) return false;
  if (a.ctx !== 'global' && b.ctx !== 'global' && a.ctx !== b.ctx) return false;
  if (a.ctx !== 'global' && a.overrides === b.id) return false;
  if (b.ctx !== 'global' && b.overrides === a.id) return false;
  return true;
}

function conflicts(map) {
  var list = [];
  var flat = [];
  ACTIONS.forEach(function (a) {
    (map[a.id] || []).forEach(function (c) { flat.push({ id: a.id, ctx: a.ctx, combo: c, overrides: a.overrides }); });
  });
  for (var i = 0; i < flat.length; i++) {
    for (var j = i + 1; j < flat.length; j++) {
      var a1 = flat[i], a2 = flat[j];
      if (!canConflict(a1.id, a2.id)) continue;
      if (sameBinding(a1.combo, a2.combo)) list.push({ a: a1.id, b: a2.id, combo: a1.combo });
    }
  }
  return list;
}

var SPECIAL = {
  'space': { i18n: 'sc.k.space' }, 'ArrowUp': { text: '↑' }, 'ArrowDown': { text: '↓' },
  'ArrowLeft': { text: '←' }, 'ArrowRight': { text: '→' }, 'Escape': { text: 'Esc' },
  'Tab': { text: 'Tab' }, 'Enter': { text: 'Enter' }, 'Delete': { text: 'Delete' },
  'Backspace': { text: 'Backspace' }, 'ctrl': { text: 'Ctrl' }, 'alt': { text: 'Alt' },
  'shift': { text: 'Shift' }
};
function displayParts(combo) {
  if (!isValidCombo(combo)) return [];
  return String(combo).split('+').map(function (p) {
    if (SPECIAL[p]) return SPECIAL[p];
    return { text: p.length === 1 ? p.toUpperCase() : p };
  });
}

function comboFromEvent(e) { return normalizeKey(e); }

var API = {
  ACTIONS: ACTIONS, GROUPS: GROUPS, ACTIONS_BY_ID: ACTIONS_BY_ID, SPECIAL: SPECIAL,
  isAction: isAction, defaultCombo: defaultCombo, contextOf: contextOf,
  normalizeKey: normalizeKey, comboFromEvent: comboFromEvent, splitCombo: splitCombo,
  isValidCombo: isValidCombo, matchesEvent: matchesEvent, sameBinding: sameBinding, matchSet: matchSet,
  resolve: resolve, toSaved: toSaved, conflicts: conflicts, canConflict: canConflict, displayParts: displayParts
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.SVE_KEYMAP = API;
