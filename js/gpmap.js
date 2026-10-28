'use strict';
/* ================= 手柄绑定表（与键盘绑定表**完全独立**的两套绑定，同一套动作）=================
   为什么要单独一张表（2026-10-29 用户口径）：
     旧实现把每个手柄按键**投影成键盘按键**（派发合成 KeyboardEvent 走 App.keymap），
     所以「键盘改了键」⇒ 手柄跟着变，甚至两个动作抢同一个键时手柄就串台了。
     解耦后手柄走自己的通道（App.dispatchAction），绑定表也独立：键盘怎么改都碰不到手柄。

   两条铁律：
     1. 可绑定范围**严格限定在手柄物理存在的按键**（BUTTONS 里那 14 个）。
        没有 Start / Back；摇杆（轴）压根不参与绑定，摇杆只当摇杆（见 js/gamepad.js）。
     2. 动作目录**复用 keymap.js 的 ACTIONS** —— 同一套动作、同一套上下文（global/canvas/edit），
        不新造动作，也不复制一份文案。

   数据：settings.json 的 gpmap 字段，只存与默认值不同的动作（与 keymap 同一做法）。
   解析规则与 keymap 的差别只有一条：**存过的空数组就是「用户主动解绑」**，
   不回退默认（键盘那边每个动作至少保留一个绑定，手柄这边允许一个都没有）。 */
App.gpmap = {
  /* 物理按键目录：顺序 = 设置窗里的展示顺序；idx = Gamepad API buttons[] 下标（standard mapping） */
  BUTTONS: [
    { id: 'A', idx: 0 }, { id: 'B', idx: 1 }, { id: 'X', idx: 2 }, { id: 'Y', idx: 3 },
    { id: 'DUp', idx: 12 }, { id: 'DDown', idx: 13 }, { id: 'DLeft', idx: 14 }, { id: 'DRight', idx: 15 },
    { id: 'LB', idx: 4 }, { id: 'RB', idx: 5 }, { id: 'LT', idx: 6 }, { id: 'RT', idx: 7 },
    { id: 'L3', idx: 10 }, { id: 'R3', idx: 11 }
  ],
  /* 十字键在界面里的显示字形（其余按键用 id 本身） */
  GLYPH: { DUp: '↑', DDown: '↓', DLeft: '←', DRight: '→' },

  /* 默认绑定 = **解耦前的实际行为，一个都没改**：
       A→呼出功能栏 / 完成编辑、B→Esc、X→剪切、Y→粘贴 / 原位复制、
       十字键上下→白框上下移一图层（编辑模式里变成微调上下）、十字键左右→编辑微调左右、
       LB/RB→上一个 / 下一个编辑模式、
       **LT/RT→Tab**（按住高亮扫选；编辑模式里 = 翻转循环，与键盘 Tab 完全同一套实现）。
     L3/R3 默认什么都不绑（解耦前原代码也不理它们），要绑就在设置里自己绑。
     `tabPrev`/`tabNext`（切标签页）**默认不绑**，留在设置里当「待绑定按键」让用户自己绑 ——
     2026-10-29 03:35 用户口径：LT/RT 必须回到 Tab，不许被切标签顶掉。 */
  DEFAULTS: {
    toolbar: ['A'], editFinish: ['A'], escape: ['B'],
    cut: ['X'], paste: ['Y'], editDup: ['Y'],
    up: ['DUp'], down: ['DDown'],
    nudgeUp: ['DUp'], nudgeDown: ['DDown'], nudgeLeft: ['DLeft'], nudgeRight: ['DRight'],
    modePrev: ['LB'], modeNext: ['RB'],
    highlight: ['LT', 'RT'], editFlip: ['LT', 'RT']
  },

  map: null,        /* 动作 id → [手柄按键 id] */
  index: null,      /* 上下文 → { 手柄按键 id: 动作 id }，每次改表重建 */
  capturing: null,  /* 设置窗里正在等待按下手柄按键：{ id, slot } */

  actions() { return (window.SVE_KEYMAP && window.SVE_KEYMAP.ACTIONS) || []; },
  isButton(id) { return this.BUTTONS.some(b => b.id === id); },
  idxOf(id) { const b = this.BUTTONS.find(x => x.id === id); return b ? b.idx : -1; },
  glyph(id) { return this.GLYPH[id] || id; },

  init() { this.map = this.resolve(null); this.reindex(); return this.map; },

  /* 合并默认值与已保存值：非法按键丢弃；未存过的动作用默认；存过（含空数组）以存为准 */
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

  /* 某个手柄按键在当前上下文里对应哪个动作：先查本上下文，再查 universal（与键盘查表同口径） */
  actionFor(btn, ctx) {
    if (!this.index) this.reindex();
    const local = this.index[ctx];
    if (local && local[btn]) return local[btn];
    return this.index.global[btn] || null;
  },

  /* 只存与默认值不同的动作（默认值将来调整时，没动过的项能跟着更新） */
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

  /* 改一个槽位：新按键若已被「同上下文 / 通用」的别的动作占用 → 两者**交换**
     （与键盘改键完全同一套语义：永远不会出现两个动作抢同一个按键）。返回被交换的动作 id。 */
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

  /* 给「一个绑定都没有」的动作新增一条。返回 null = 非法按键，'' = 成功，动作 id = 撞车（不加）。
     ★ 只给「待绑定」的那两个动作（设置窗 App.keymapUI.PENDING）用：没有旧键可以交换，
       所以撞车时直接拒绝（不像 setButton 那样交换）。 */
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

  /* 手柄按键冲突（同上下文撞键，或通用动作与某上下文撞键）：
     global 与上下文的「同一个键绑两个动作」是正常设计（A 在画布=呼出功能栏、在编辑=完成），不算冲突。 */
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

  /* ---------- 设置窗里的按键捕获 ----------
     键盘那边是监听 keydown；手柄这边只能靠轮询，所以捕获状态挂在这里，
     由 js/gamepad.js 的 poll 每帧查一次「有没有新按下的手柄按键」。 */
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
