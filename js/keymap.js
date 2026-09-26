'use strict';

App.KM_I18N = {
  'zh-CN': {
    'settings.keymap': '自定义快捷键',
    'km.g.global': '通用（画布与编辑都生效）', 'km.g.canvas': '画布（未进入编辑）', 'km.g.edit': '编辑模式',
    'km.hint': '点击按键框后按下新按键；与已有键位撞车时会自动与对方交换',
    'km.panSpace': '画布拖动使用空格',
    'km.press': '按下按键…', 'km.escCancel': 'Esc 取消',
    'km.conflict': '键位冲突：{v}', 'km.swapped': '已与「{v}」交换键位',
    'km.saved': '已保存快捷键设置', 'km.saveFail': '快捷键设置保存失败：{v}',
    'km.a.pan': '平移视图（按住）', 'km.a.highlight': '高亮图层 / 取消高亮（按住）',
    'km.a.undo': '撤销', 'km.a.redo': '重做', 'km.a.base': '切换画布底色',
    'km.a.hideLayers': '隐藏图层', 'km.a.hideBg': '隐藏背景', 'km.a.hideOthers': '隐藏其他图层',
    'km.a.escape': '关闭功能栏 / 退出编辑 / 清空选择',
    'km.a.up': '白框上移一个图层', 'km.a.down': '白框下移一个图层',
    'km.a.toolbar': '呼出功能栏 / 进入编辑', 'km.a.cut': '剪切选中图层',
    'km.a.paste': '粘贴', 'km.a.delete': '删除选中图层',
    'km.a.editFinish': '完成编辑', 'km.a.editDelete': '删除正在编辑的图层',
    'km.a.editDup': '原位复制当前编辑的图层', 'km.a.anchor': '放置 / 清除缩放锚点',
    'km.a.sizeMode': '大小模式：等比 / 自由', 'km.a.editFlip': '翻转循环',
    'km.a.mode1': '切换为「移动」', 'km.a.mode2': '切换为「大小」', 'km.a.mode3': '切换为「旋转」',
    'km.a.mode4': '切换为「倾斜」', 'km.a.mode5': '切换为「透明度」',
    'km.a.nudgeUp': '微调：上', 'km.a.nudgeDown': '微调：下', 'km.a.nudgeLeft': '微调：左', 'km.a.nudgeRight': '微调：右',
    'km.a.moveUp': '连续调整：上', 'km.a.moveDown': '连续调整：下',
    'km.a.moveLeft': '连续调整：左', 'km.a.moveRight': '连续调整：右'
  },
  'zh-TW': {
    'settings.keymap': '自訂快速鍵',
    'km.g.global': '通用（畫布與編輯都生效）', 'km.g.canvas': '畫布（未進入編輯）', 'km.g.edit': '編輯模式',
    'km.hint': '點擊按鍵框後按下新按鍵；與既有鍵位撞車時會自動與對方交換',
    'km.panSpace': '畫布拖曳使用空格',
    'km.press': '按下按鍵…', 'km.escCancel': 'Esc 取消',
    'km.conflict': '鍵位衝突：{v}', 'km.swapped': '已與「{v}」交換鍵位',
    'km.saved': '已儲存快速鍵設定', 'km.saveFail': '快速鍵設定儲存失敗：{v}',
    'km.a.pan': '平移檢視（按住）', 'km.a.highlight': '反白圖層 / 取消反白（按住）',
    'km.a.undo': '復原', 'km.a.redo': '重做', 'km.a.base': '切換畫布底色',
    'km.a.hideLayers': '隱藏圖層', 'km.a.hideBg': '隱藏背景', 'km.a.hideOthers': '隱藏其他圖層',
    'km.a.escape': '關閉功能列 / 退出編輯 / 清空選取',
    'km.a.up': '白框上移一個圖層', 'km.a.down': '白框下移一個圖層',
    'km.a.toolbar': '呼出功能列 / 進入編輯', 'km.a.cut': '剪下選取的圖層',
    'km.a.paste': '貼上', 'km.a.delete': '刪除選取的圖層',
    'km.a.editFinish': '完成編輯', 'km.a.editDelete': '刪除正在編輯的圖層',
    'km.a.editDup': '原位複製目前編輯的圖層', 'km.a.anchor': '放置 / 清除縮放錨點',
    'km.a.sizeMode': '大小模式：等倍 / 自由', 'km.a.editFlip': '翻轉循環',
    'km.a.mode1': '切換為「移動」', 'km.a.mode2': '切換為「大小」', 'km.a.mode3': '切換為「旋轉」',
    'km.a.mode4': '切換為「傾斜」', 'km.a.mode5': '切換為「透明度」',
    'km.a.nudgeUp': '微調：上', 'km.a.nudgeDown': '微調：下', 'km.a.nudgeLeft': '微調：左', 'km.a.nudgeRight': '微調：右',
    'km.a.moveUp': '連續調整：上', 'km.a.moveDown': '連續調整：下',
    'km.a.moveLeft': '連續調整：左', 'km.a.moveRight': '連續調整：右'
  },
  'en': {
    'settings.keymap': 'Custom shortcuts',
    'km.g.global': 'General (canvas and edit)', 'km.g.canvas': 'Canvas (not editing)', 'km.g.edit': 'Edit mode',
    'km.hint': 'Click a key box, then press the new key. If it clashes, the two bindings are swapped',
    'km.panSpace': 'Use Space to drag the canvas',
    'km.press': 'Press a key…', 'km.escCancel': 'Esc to cancel',
    'km.conflict': 'Key conflict: {v}', 'km.swapped': 'Swapped keys with "{v}"',
    'km.saved': 'Shortcut settings saved', 'km.saveFail': 'Failed to save shortcut settings: {v}',
    'km.a.pan': 'Pan the view (hold)', 'km.a.highlight': 'Highlight / clear highlight (hold)',
    'km.a.undo': 'Undo', 'km.a.redo': 'Redo', 'km.a.base': 'Toggle canvas background',
    'km.a.hideLayers': 'Hide all layers', 'km.a.hideBg': 'Hide background image', 'km.a.hideOthers': 'Hide other layers',
    'km.a.escape': 'Close toolbar / exit edit / clear selection',
    'km.a.up': 'Move white box up one layer', 'km.a.down': 'Move white box down one layer',
    'km.a.toolbar': 'Open toolbar / enter edit', 'km.a.cut': 'Cut selected layers',
    'km.a.paste': 'Paste', 'km.a.delete': 'Delete selected layers',
    'km.a.editFinish': 'Finish editing', 'km.a.editDelete': 'Delete the layer being edited',
    'km.a.editDup': 'Duplicate the layer being edited in place', 'km.a.anchor': 'Place / clear the zoom anchor',
    'km.a.sizeMode': 'Size mode: uniform / free', 'km.a.editFlip': 'Flip cycle',
    'km.a.mode1': 'Switch to Move', 'km.a.mode2': 'Switch to Size', 'km.a.mode3': 'Switch to Rotate',
    'km.a.mode4': 'Switch to Skew', 'km.a.mode5': 'Switch to Opacity',
    'km.a.nudgeUp': 'Nudge up', 'km.a.nudgeDown': 'Nudge down', 'km.a.nudgeLeft': 'Nudge left', 'km.a.nudgeRight': 'Nudge right',
    'km.a.moveUp': 'Continuous up', 'km.a.moveDown': 'Continuous down',
    'km.a.moveLeft': 'Continuous left', 'km.a.moveRight': 'Continuous right'
  },
  'ja': {
    'settings.keymap': 'ショートカットのカスタマイズ',
    'km.g.global': '共通（キャンバスと編集）', 'km.g.canvas': 'キャンバス（編集中以外）', 'km.g.edit': '編集モード',
    'km.hint': 'キー枠をクリックして新しいキーを押します。重複した場合は互いに交換されます',
    'km.panSpace': 'キャンバスのドラッグにスペースを使用',
    'km.press': 'キーを押してください…', 'km.escCancel': 'Esc でキャンセル',
    'km.conflict': 'キーの重複：{v}', 'km.swapped': '「{v}」とキーを交換しました',
    'km.saved': 'ショートカット設定を保存しました', 'km.saveFail': 'ショートカット設定の保存に失敗：{v}',
    'km.a.pan': '表示を移動（長押し）', 'km.a.highlight': 'レイヤーを強調 / 解除（長押し）',
    'km.a.undo': '元に戻す', 'km.a.redo': 'やり直す', 'km.a.base': 'キャンバス背景を切替',
    'km.a.hideLayers': 'レイヤーを隠す', 'km.a.hideBg': '背景画像を隠す', 'km.a.hideOthers': '他のレイヤーを隠す',
    'km.a.escape': '機能バーを閉じる / 編集を終了 / 選択解除',
    'km.a.up': '白枠を 1 つ上へ', 'km.a.down': '白枠を 1 つ下へ',
    'km.a.toolbar': '機能バーを開く / 編集に入る', 'km.a.cut': '選択レイヤーを切り取り',
    'km.a.paste': '貼り付け', 'km.a.delete': '選択レイヤーを削除',
    'km.a.editFinish': '編集を完了', 'km.a.editDelete': '編集中のレイヤーを削除',
    'km.a.editDup': '編集中のレイヤーをその場で複製', 'km.a.anchor': 'アンカーを配置 / 解除',
    'km.a.sizeMode': 'サイズモード：等倍 / 自由', 'km.a.editFlip': '反転サイクル',
    'km.a.mode1': '「移動」に切替', 'km.a.mode2': '「サイズ」に切替', 'km.a.mode3': '「回転」に切替',
    'km.a.mode4': '「傾き」に切替', 'km.a.mode5': '「不透明度」に切替',
    'km.a.nudgeUp': '微調整：上', 'km.a.nudgeDown': '微調整：下', 'km.a.nudgeLeft': '微調整：左', 'km.a.nudgeRight': '微調整：右',
    'km.a.moveUp': '連続調整：上', 'km.a.moveDown': '連続調整：下',
    'km.a.moveLeft': '連続調整：左', 'km.a.moveRight': '連続調整：右'
  },
  'ko': {
    'settings.keymap': '단축키 사용자 지정',
    'km.g.global': '공통(캔버스와 편집)', 'km.g.canvas': '캔버스(편집 전)', 'km.g.edit': '편집 모드',
    'km.hint': '키 상자를 클릭한 뒤 새 키를 누르세요. 겹치면 서로 교환됩니다',
    'km.panSpace': '캔버스 드래그에 스페이스 사용',
    'km.press': '키를 누르세요…', 'km.escCancel': 'Esc 취소',
    'km.conflict': '키 충돌: {v}', 'km.swapped': '"{v}"와 키를 교환했습니다',
    'km.saved': '단축키 설정을 저장했습니다', 'km.saveFail': '단축키 설정 저장 실패: {v}',
    'km.a.pan': '보기 이동(길게)', 'km.a.highlight': '레이어 강조 / 해제(길게)',
    'km.a.undo': '실행 취소', 'km.a.redo': '다시 실행', 'km.a.base': '캔버스 배경 전환',
    'km.a.hideLayers': '레이어 숨기기', 'km.a.hideBg': '배경 이미지 숨기기', 'km.a.hideOthers': '다른 레이어 숨기기',
    'km.a.escape': '기능 바 닫기 / 편집 종료 / 선택 해제',
    'km.a.up': '흰 상자를 한 레이어 위로', 'km.a.down': '흰 상자를 한 레이어 아래로',
    'km.a.toolbar': '기능 바 열기 / 편집 진입', 'km.a.cut': '선택 레이어 잘라내기',
    'km.a.paste': '붙여넣기', 'km.a.delete': '선택 레이어 삭제',
    'km.a.editFinish': '편집 완료', 'km.a.editDelete': '편집 중인 레이어 삭제',
    'km.a.editDup': '편집 중인 레이어 제자리 복제', 'km.a.anchor': '앵커 배치 / 해제',
    'km.a.sizeMode': '크기 모드: 등비 / 자유', 'km.a.editFlip': '반전 순환',
    'km.a.mode1': '「이동」으로 전환', 'km.a.mode2': '「크기」로 전환', 'km.a.mode3': '「회전」으로 전환',
    'km.a.mode4': '「기울기」로 전환', 'km.a.mode5': '「불투명도」로 전환',
    'km.a.nudgeUp': '미세 조정: 위', 'km.a.nudgeDown': '미세 조정: 아래', 'km.a.nudgeLeft': '미세 조정: 왼쪽', 'km.a.nudgeRight': '미세 조정: 오른쪽',
    'km.a.moveUp': '연속 조정: 위', 'km.a.moveDown': '연속 조정: 아래',
    'km.a.moveLeft': '연속 조정: 왼쪽', 'km.a.moveRight': '연속 조정: 오른쪽'
  }
};
Object.keys(App.KM_I18N).forEach(function (lang) {
  if (App.i18n.dicts[lang]) Object.assign(App.i18n.dicts[lang], App.KM_I18N[lang]);
});

App.keymap = {
  map: null,
  index: null,

  init() {
    this.map = window.SVE_KEYMAP.resolve(null);
    this.reindex();
    return this.map;
  },

  load(saved) {
    this.map = window.SVE_KEYMAP.resolve(saved || null);
    this.reindex();
    return this.map;
  },

  reindex() {
    const KM = window.SVE_KEYMAP;
    const idx = { global: {}, canvas: {}, edit: {} };
    KM.ACTIONS.forEach(a => {
      const ctx = idx[a.ctx] || (idx[a.ctx] = {});
      (this.map[a.id] || []).forEach(combo => {
        KM.matchSet(combo).forEach(c => { ctx[c] = a.id; });
      });
    });
    this.index = idx;
    return idx;
  },

  combos(id) { return (this.map[id] || []).slice(); },

  actionFor(e, ctx) {
    if (!this.index) return null;
    const canon = window.SVE_KEYMAP.normalizeKey(e);
    if (!canon) return null;
    const local = this.index[ctx];
    if (local && local[canon]) return local[canon];
    return this.index.global[canon] || null;
  },

  setCombo(id, slot, combo) {
    const KM = window.SVE_KEYMAP;
    const mine = this.map[id];
    if (!mine || slot < 0 || slot >= mine.length) return [];
    if (!KM.isValidCombo(combo)) return [];
    const old = mine[slot];
    if (old === combo) return [];
    const swapped = [];
    KM.ACTIONS.forEach(a => {
      if (a.id === id || !KM.canConflict(a.id, id)) return;
      (this.map[a.id] || []).forEach((c, i) => {
        if (KM.sameBinding(c, combo)) { this.map[a.id][i] = old; swapped.push(a.id); }
      });
    });
    mine[slot] = combo;
    this.reindex();
    return swapped;
  },

  snapshot() { return JSON.parse(JSON.stringify(this.map)); },
  restore(snap) { this.map = JSON.parse(JSON.stringify(snap)); this.reindex(); },
  resetToDefaults() { this.map = window.SVE_KEYMAP.resolve(null); this.reindex(); },
  isDefault() { return Object.keys(window.SVE_KEYMAP.toSaved(this.map)).length === 0; },
  conflicts() { return window.SVE_KEYMAP.conflicts(this.map); },
  payload() { return window.SVE_KEYMAP.toSaved(this.map); },
  display(id) {
    return this.combos(id).map(c => window.SVE_KEYMAP.displayParts(c));
  }
};
App.keymap.init();

App.keymapUI = {
  el: null,          /* #settingsKeyView */
  box: null,         /* .confirm-box */
  capturing: null,   /* { id, slot, btn } */
  snapshot: null,

  build(box) {
    this.box = box;
    let view = box.querySelector('#settingsKeyView');
    if (!view) return null;
    this.el = view;
    view.innerHTML =
      '<div class="km-opt-row">' +
        '<label class="km-opt-label" for="kmPanSpace" data-i18n="km.panSpace"></label>' +
        '<label class="sve-switch"><input type="checkbox" id="kmPanSpace">' +
          '<span class="sve-switch-track" aria-hidden="true"></span></label>' +
      '</div>' +
      '<div class="km-hint" data-i18n="km.hint"></div>' +
      '<div class="km-scroll" id="kmList"></div>' +
      '<div class="km-warn hidden" id="kmWarn"></div>' +
      '<div class="speed-reset-row"><button class="speed-reset km-reset" data-i18n="speed.reset"></button></div>' +
      '<div class="anchor-btns">' +
        '<button class="km-cancel" data-i18n="speed.cancel"></button>' +
        '<button class="km-ok" data-i18n="speed.ok"></button>' +
      '</div>';
    if (App.i18n && App.i18n.apply) App.i18n.apply(view);
    const panSw = view.querySelector('#kmPanSpace');
    if (panSw) {
      panSw.checked = App.settings.panNeedsSpace !== false;
      panSw.addEventListener('change', () => {
        App.settings.panNeedsSpace = !!panSw.checked;
        App.settings.save();
      });
    }
    view.querySelector('.km-reset').addEventListener('click', () => this.reset());
    view.querySelector('.km-cancel').addEventListener('click', () => this.cancel());
    view.querySelector('.km-ok').addEventListener('click', () => this.commit());
    view.querySelector('#kmList').addEventListener('click', e => {
      const b = e.target && e.target.closest ? e.target.closest('.km-key') : null;
      if (!b) return;
      e.preventDefault();
      const id = b.getAttribute('data-act'), slot = parseInt(b.getAttribute('data-slot'), 10);
      if (this.capturing && this.capturing.btn === b) { this.stopCapture(); return; }
      this.startCapture(id, slot, b);
    });
    this.render();
    return view;
  },

  render() {
    if (!this.el) return;
    const list = this.el.querySelector('#kmList');
    if (!list) return;
    const t = k => App.i18n.t(k);
    list.innerHTML = '';
    window.SVE_KEYMAP.GROUPS.forEach(g => {
      const box = document.createElement('div');
      box.className = 'km-group';
      const h = document.createElement('div');
      h.className = 'km-group-title';
      h.textContent = t(g.title);
      box.appendChild(h);
      window.SVE_KEYMAP.ACTIONS.filter(a => a.ctx === g.ctx).forEach(a => {
        const row = document.createElement('div');
        row.className = 'km-row';
        const lab = document.createElement('div');
        lab.className = 'km-label';
        lab.textContent = t(a.label);
        row.appendChild(lab);
        const keys = document.createElement('div');
        keys.className = 'km-keys';
        App.keymap.combos(a.id).forEach((combo, slot) => {
          const b = document.createElement('button');
          b.className = 'km-key';
          b.setAttribute('data-act', a.id);
          b.setAttribute('data-slot', String(slot));
          this.fillButton(b, combo);
          keys.appendChild(b);
        });
        row.appendChild(keys);
        box.appendChild(row);
      });
      list.appendChild(box);
    });
    this.renderConflicts();
    if (App.refreshEditBarKeys) App.refreshEditBarKeys();
  },

  fillButton(btn, combo) {
    const t = k => App.i18n.t(k);
    btn.classList.remove('km-capturing');
    btn.innerHTML = '';
    const parts = window.SVE_KEYMAP.displayParts(combo);
    parts.forEach((p, i) => {
      if (i > 0) {
        const plus = document.createElement('span');
        plus.className = 'sc-plus';
        plus.textContent = '+';
        btn.appendChild(plus);
      }
      const kbd = document.createElement('kbd');
      kbd.textContent = p.i18n ? t(p.i18n) : p.text;
      btn.appendChild(kbd);
    });
  },

  renderConflicts() {
    const warn = this.el && this.el.querySelector('#kmWarn');
    if (!warn) return;
    const cs = App.keymap.conflicts();
    if (!cs.length) { warn.classList.add('hidden'); warn.textContent = ''; return; }
    const t = k => App.i18n.t(k);
    const name = id => t((window.SVE_KEYMAP.ACTIONS_BY_ID[id] || {}).label || id);
    warn.textContent = t('km.conflict').replace('{v}', cs.map(c => name(c.a) + ' ↔ ' + name(c.b)).join('，'));
    warn.classList.remove('hidden');
  },

  showMainView() {
    this.stopCapture();
    this.snapshot = null;
    const box = document.getElementById('settingsPanel');
    if (!box) return;
    const main = box.querySelector('#settingsMainView');
    const key = box.querySelector('#settingsKeyView');
    const title = box.querySelector('#settingsTitle');
    if (main) main.classList.remove('hidden');
    if (key) key.classList.add('hidden');
    if (this.box) this.box.classList.remove('km-mode');
    if (title) { title.setAttribute('data-i18n', 'settings.title'); title.textContent = App.i18n.t('settings.title'); }
    if (this.box && App.attachDlgClose) {
      const panel = document.getElementById('settingsPanel');
      App.attachDlgClose(this.box, () => { App.hideOverlay(panel || box); return true; });
    }
  },

  syncPanSwitch() {
    const sw = this.el && this.el.querySelector('#kmPanSpace');
    if (sw) sw.checked = App.settings.panNeedsSpace !== false;
  },

  open() {
    const box = document.getElementById('settingsPanel');
    if (!box) return false;
    if (!this.el) this.build(box.querySelector('.confirm-box') || box);
    this.snapshot = App.keymap.snapshot();
    const main = box.querySelector('#settingsMainView');
    const key = box.querySelector('#settingsKeyView');
    const title = box.querySelector('#settingsTitle');
    if (main) main.classList.add('hidden');
    if (key) key.classList.remove('hidden');
    if (this.box) this.box.classList.add('km-mode');
    if (title) { title.setAttribute('data-i18n', 'settings.keymap'); title.textContent = App.i18n.t('settings.keymap'); }
    if (this.box && App.attachDlgClose) App.attachDlgClose(this.box, () => this.cancel());
    this.syncPanSwitch();
    this.render();
    return true;
  },

  reset() {
    this.stopCapture();
    App.keymap.resetToDefaults();
    this.render();
    return true;
  },

  cancel() {
    this.stopCapture();
    if (this.snapshot) { App.keymap.restore(this.snapshot); this.snapshot = null; }
    const box = document.getElementById('settingsPanel');
    if (box) App.hideOverlay(box);
    return true;
  },

  commit() {
    this.stopCapture();
    this.snapshot = null;
    const box = document.getElementById('settingsPanel');
    if (box) App.hideOverlay(box);
    if (App.refreshShortcutPanel) App.refreshShortcutPanel();
    if (App.refreshEditBarKeys) App.refreshEditBarKeys();
    const p = App.settings.save();
    if (p && p.then) {
      p.then(r => {
        if (r && r.ok === false) showToast(App.i18n.tf('km.saveFail', { v: r.error || '' }));
        else showToast(App.i18n.t('km.saved'));
      });
    }
    return true;
  },

  startCapture(id, slot, btn) {
    this.stopCapture();
    this.capturing = { id, slot, btn };
    btn.classList.add('km-capturing');
    btn.innerHTML = '';
    const kbd = document.createElement('kbd');
    kbd.textContent = App.i18n.t('km.press');
    btn.appendChild(kbd);
    const tip = document.createElement('span');
    tip.className = 'km-esc';
    tip.textContent = App.i18n.t('km.escCancel');
    btn.appendChild(tip);
  },

  stopCapture() {
    const c = this.capturing;
    this.capturing = null;
    if (!c || !c.btn) return;
    c.btn.classList.remove('km-capturing');
    const cur = App.keymap.combos(c.id)[c.slot];
    if (cur) this.fillButton(c.btn, cur);
  },

  onKeydown(e) {
    const c = this.capturing;
    if (!c) return false;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    if (e.key === 'Escape') { this.stopCapture(); return true; }
    const combo = window.SVE_KEYMAP.comboFromEvent(e);
    if (!combo) return true;
    const parts = combo.split('+');
    if (parts.length === 1 && ['ctrl', 'alt', 'shift'].indexOf(parts[0]) >= 0) return true;
    const swapped = App.keymap.setCombo(c.id, c.slot, combo);
    this.stopCapture();
    this.render();
    if (swapped.length) {
      const t = k => App.i18n.t(k);
      const name = id => t((window.SVE_KEYMAP.ACTIONS_BY_ID[id] || {}).label || id);
      showToast(App.i18n.tf('km.swapped', { v: swapped.map(name).join('、') }));
    }
    return true;
  },

  isOpen() {
    const box = document.getElementById('settingsPanel');
    return !!(box && !box.classList.contains('hidden'));
  }
};

App.refreshEditBarKeys = function () {
  if (!App.keymap || !window.SVE_KEYMAP) return;
  ['move', 'size', 'rotate', 'skew', 'opacity'].forEach(function (m, i) {
    const btn = document.querySelector('#editBar .edit-modes button[data-mode="' + m + '"]');
    if (!btn) return;
    const kbd = btn.querySelector('kbd');
    if (!kbd) return;
    const parts = App.keymap.display('mode' + (i + 1))[0] || [];
    kbd.textContent = parts.map(p => (p.i18n ? App.i18n.t(p.i18n) : p.text)).join('+');
  });
};
App.refreshEditBarKeys();

window.addEventListener('keydown', function (e) {
  if (App.keymapUI && App.keymapUI.capturing) { App.keymapUI.onKeydown(e); return; }
  if (e.key === 'Escape' && App.keymapUI && App.keymapUI.isOpen()) {
    const key = document.getElementById('settingsKeyView');
    if (key && !key.classList.contains('hidden')) {
      e.preventDefault(); e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      App.keymapUI.cancel();
    }
  }
}, true);
