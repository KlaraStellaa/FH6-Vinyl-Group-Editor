'use strict';
/* 快捷键绑定表（纯函数，主进程与渲染层共用，可被 node 直接 require 做秒级判据）
   —— 默认值 / 事件归一化 / 解析 / 冲突检测 / 显示拆分，全在这里，UI 与事件处理只调这里。

   组合串格式（规范形式，比较一律用字符串相等）：
     修饰键按固定顺序 ctrl → alt → shift，键名小写；
     例：'ctrl+shift+z'、'shift+arrowup'、'w'、'space'、'delete'
   ctrl 同时代表 macOS 的 ⌘（与改造前 `e.ctrlKey || e.metaKey` 的行为一致）。

   匹配规则（`matchesEvent`）：
     · 声明了修饰键的组合 → 修饰键必须**完全一致**（否则 ctrl+z 会吃掉 ctrl+shift+z）
     · 没声明修饰键的组合 → 忽略多余的 Shift（保持改造前「W 与 Shift+W 等效」的行为），
       但 Ctrl/Alt 仍算不匹配（避免把 Ctrl+W 当成 W）

   动作按「上下文」分组，冲突只在同上下文或与 global 之间判定：
     global 画布与编辑模式都生效 · canvas 仅未进入编辑时 · edit 仅编辑模式内
   （同一个键在不同上下文绑不同动作是**正常**的：Tab 在画布=高亮、在编辑=翻转循环） */

var ACTIONS = [
  { id: 'pan', ctx: 'global', def: ['space'], label: 'km.a.pan' },
  { id: 'highlight', ctx: 'global', def: ['Tab'], label: 'km.a.highlight' },
  { id: 'undo', ctx: 'global', def: ['ctrl+z'], label: 'km.a.undo' },
  { id: 'redo', ctx: 'global', def: ['ctrl+shift+z'], label: 'km.a.redo' },
  { id: 'base', ctx: 'global', def: ['p'], label: 'km.a.base' },
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
  /* overrides：本动作在该上下文里**有意**覆盖某个 global 动作的同键绑定
     （Tab 在画布=高亮扫选，在编辑=翻转循环——这是设计，不是冲突） */
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

/* 设置窗里按这三组展示（顺序即展示顺序） */
var GROUPS = [
  { ctx: 'global', title: 'km.g.global' },
  { ctx: 'canvas', title: 'km.g.canvas' },
  { ctx: 'edit', title: 'km.g.edit' }
];

var ACTIONS_BY_ID = {};
ACTIONS.forEach(function (a) { ACTIONS_BY_ID[a.id] = a; });

/* 无法作为绑定的键（合成中的死键/无法识别） */
var REJECT_KEYS = { 'Dead': 1, 'Unidentified': 1, 'Process': 1, 'Compose': 1 };
var MODS = ['ctrl', 'alt', 'shift'];

function isAction(id) { return !!ACTIONS_BY_ID[id]; }
function defaultCombo(id) { var a = ACTIONS_BY_ID[id]; return a ? a.def.slice() : null; }
function contextOf(id) { var a = ACTIONS_BY_ID[id]; return a ? a.ctx : null; }

/* 事件 → 规范组合串；不可绑定的键返回 null */
function normalizeKey(e) {
  if (!e) return null;
  var k = e.key;
  if (e.code === 'Space' || k === ' ') k = 'space';
  if (!k || REJECT_KEYS[k]) return null;
  if (k.length === 1) k = k.toLowerCase();
  else if (k === 'Esc') k = 'Escape';
  var parts = [];
  /* ctrl 兼收 meta（macOS ⌘），与改造前的 e.ctrlKey || e.metaKey 一致 */
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

/* 组合串是否合法：有键名（且键名不能是修饰键本身）、修饰键只含 ctrl/alt/shift、顺序规范 */
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
  if (s.hasMod) return false;            /* 声明了修饰键：必须完全一致 */
  /* 未声明修饰键：忽略多余的 Shift（W 与 Shift+W 等效），但 Ctrl/Alt 算不匹配 */
  var evs = splitCombo(ev);
  if (evs.mods.ctrl || evs.mods.alt) return false;
  return evs.key === s.key;
}

/* 一个组合串实际能接住的按键集合。
   没有 Ctrl/Alt 的组合会同时接住「本键」与「Shift+本键」（与 matchesEvent 的宽松规则一致），
   所以 'w' 与 'shift+w' 会互相抢——冲突检测必须按这个集合取交集，而不是字符串比较。 */
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

/* 合并默认值与已保存值；非法项丢弃并回退默认。每个动作至少保留一个绑定。 */
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
    out[a.id] = keep.length ? keep : def;    /* 全非法 → 回退默认，绝不出现「无绑定」 */
  });
  return out;
}

/* 只存与默认值不同的动作（默认值将来若调整，用户没动过的项能跟着更新） */
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

/* 两个动作之间**是否允许**判定冲突（UI 改键时的交换也按这个口径）：
   同上下文、或任一方是 global 才算；上下文动作显式 overrides 某个 global 动作时不算。 */
function canConflict(idA, idB) {
  if (idA === idB) return false;
  var a = ACTIONS_BY_ID[idA], b = ACTIONS_BY_ID[idB];
  if (!a || !b) return false;
  if (a.ctx !== 'global' && b.ctx !== 'global' && a.ctx !== b.ctx) return false;
  if (a.ctx !== 'global' && a.overrides === b.id) return false;
  if (b.ctx !== 'global' && b.overrides === a.id) return false;
  return true;
}

/* 冲突检测：同一上下文内撞键，或 global 与某上下文撞键。
   两类例外（都算正常，不报冲突）：
     ① 两个动作分属不同上下文（w 在画布=白框上移、在编辑=连续上移）；
     ② 上下文动作显式声明 overrides 覆盖某个 global 动作（Tab：画布高亮 / 编辑翻转）。 */
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

/* 显示拆分：修饰键与特殊键给字面量或 i18n key，字母/数字大写 */
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

/* 把事件直接转成「给某动作的某个槽位」的候选绑定；不可绑定返回 null */
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
