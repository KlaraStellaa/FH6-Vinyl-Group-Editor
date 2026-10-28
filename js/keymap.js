'use strict';
/* 快捷键自定义（渲染层）：
     App.keymap    —— 当前绑定表（默认值 ← settings.json 的 keymap 差分）、查表、改键
     App.keymapUI  —— 设置窗内的「自定义快捷键」视图（入口按钮 + 列表 + 重置/取消/确认）
   规则全在根目录 keymap.js（纯函数）；这里只管状态与界面。

   三按钮语义与「编辑速率」窗口**完全一致**：
     重置 = 只把临时绑定表恢复默认，不落盘（还要点确认才生效）
     取消 = 丢弃本次改动，回到打开窗口前的绑定表并关闭窗口
     确认 = 保留本次改动，写入 settings.json 并关闭窗口 */

/* ---------- 词典（加载时并入 App.i18n.dicts，与 shortcuts.js 同一套做法） ---------- */
App.KM_I18N = {
  'zh-CN': {
    'settings.keymap': '自定义快捷键',
    'km.g.global': '通用', 'km.g.canvas': '画布', 'km.g.edit': '编辑模式',
    'km.hint': '点击按键框后按下新按键；与已有键位撞车时会自动与对方交换',
    'km.panSpace': '画布拖动使用空格',
    'km.mode.key': '键盘', 'km.mode.pad': '手柄',
    'km.gp.press': '按下手柄按键…', 'km.gp.swapped': '已与「{v}」交换按键',
    'km.gp.conflict': '手柄按键冲突：{v}',
    'km.a.tabPrev': '上一个标签页', 'km.a.tabNext': '下一个标签页',
    'km.a.modePrev': '上一个编辑模式', 'km.a.modeNext': '下一个编辑模式',
    'km.press': '按下按键…', 'km.escCancel': 'Esc 取消',
    'km.conflict': '键位冲突：{v}', 'km.swapped': '已与「{v}」交换键位',
    'km.saved': '已保存快捷键设置', 'km.saveFail': '快捷键设置保存失败：{v}',
    'km.a.pan': '平移视图（按住）', 'km.a.highlight': '高亮图层 / 取消高亮（按住）',
    'km.a.undo': '撤销', 'km.a.redo': '重做', 'km.a.base': '切换画布底色',
    'km.a.hideLayers': '隐藏图层', 'km.a.hideBg': '隐藏背景', 'km.a.hideOthers': '隐藏其他图层',
    'km.a.opacityLayersDown': '图层透明度减 10%', 'km.a.opacityLayersUp': '图层透明度加 10%',
    'km.a.opacityBgDown': '背景透明度减 10%', 'km.a.opacityBgUp': '背景透明度加 10%',
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
    'km.g.global': '通用', 'km.g.canvas': '畫布', 'km.g.edit': '編輯模式',
    'km.hint': '點擊按鍵框後按下新按鍵；與既有鍵位撞車時會自動與對方交換',
    'km.panSpace': '畫布拖曳使用空格',
    'km.mode.key': '鍵盤', 'km.mode.pad': '手柄',
    'km.gp.press': '按下手柄按鍵…', 'km.gp.swapped': '已與「{v}」交換按鍵',
    'km.gp.conflict': '手柄按鍵衝突：{v}',
    'km.a.tabPrev': '上一個頁籤', 'km.a.tabNext': '下一個頁籤',
    'km.a.modePrev': '上一個編輯模式', 'km.a.modeNext': '下一個編輯模式',
    'km.press': '按下按鍵…', 'km.escCancel': 'Esc 取消',
    'km.conflict': '鍵位衝突：{v}', 'km.swapped': '已與「{v}」交換鍵位',
    'km.saved': '已儲存快速鍵設定', 'km.saveFail': '快速鍵設定儲存失敗：{v}',
    'km.a.pan': '平移檢視（按住）', 'km.a.highlight': '反白圖層 / 取消反白（按住）',
    'km.a.undo': '復原', 'km.a.redo': '重做', 'km.a.base': '切換畫布底色',
    'km.a.hideLayers': '隱藏圖層', 'km.a.hideBg': '隱藏背景', 'km.a.hideOthers': '隱藏其他圖層',
    'km.a.opacityLayersDown': '圖層透明度減 10%', 'km.a.opacityLayersUp': '圖層透明度加 10%',
    'km.a.opacityBgDown': '背景透明度減 10%', 'km.a.opacityBgUp': '背景透明度加 10%',
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
    'km.g.global': 'General', 'km.g.canvas': 'Canvas', 'km.g.edit': 'Edit mode',
    'km.hint': 'Click a key box, then press the new key. If it clashes, the two bindings are swapped',
    'km.panSpace': 'Use Space to drag the canvas',
    'km.mode.key': 'Keyboard', 'km.mode.pad': 'Gamepad',
    'km.gp.press': 'Press a gamepad button…', 'km.gp.swapped': 'Swapped the button with "{v}"',
    'km.gp.conflict': 'Gamepad button conflict: {v}',
    'km.a.tabPrev': 'Previous tab', 'km.a.tabNext': 'Next tab',
    'km.a.modePrev': 'Previous edit mode', 'km.a.modeNext': 'Next edit mode',
    'km.press': 'Press a key…', 'km.escCancel': 'Esc to cancel',
    'km.conflict': 'Key conflict: {v}', 'km.swapped': 'Swapped keys with "{v}"',
    'km.saved': 'Shortcut settings saved', 'km.saveFail': 'Failed to save shortcut settings: {v}',
    'km.a.pan': 'Pan the view (hold)', 'km.a.highlight': 'Highlight / clear highlight (hold)',
    'km.a.undo': 'Undo', 'km.a.redo': 'Redo', 'km.a.base': 'Toggle canvas background',
    'km.a.hideLayers': 'Hide all layers', 'km.a.hideBg': 'Hide background image', 'km.a.hideOthers': 'Hide other layers',
    'km.a.opacityLayersDown': 'Layer opacity -10%', 'km.a.opacityLayersUp': 'Layer opacity +10%',
    'km.a.opacityBgDown': 'Background opacity -10%', 'km.a.opacityBgUp': 'Background opacity +10%',
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
    'km.g.global': '共通', 'km.g.canvas': 'キャンバス', 'km.g.edit': '編集モード',
    'km.hint': 'キー枠をクリックして新しいキーを押します。重複した場合は互いに交換されます',
    'km.panSpace': 'キャンバスのドラッグにスペースを使用',
    'km.mode.key': 'キーボード', 'km.mode.pad': 'ゲームパッド',
    'km.gp.press': 'ゲームパッドのボタンを押してください…', 'km.gp.swapped': '「{v}」とボタンを交換しました',
    'km.gp.conflict': 'ゲームパッドのボタン重複：{v}',
    'km.a.tabPrev': '前のタブ', 'km.a.tabNext': '次のタブ',
    'km.a.modePrev': '前の編集モード', 'km.a.modeNext': '次の編集モード',
    'km.press': 'キーを押してください…', 'km.escCancel': 'Esc でキャンセル',
    'km.conflict': 'キーの重複：{v}', 'km.swapped': '「{v}」とキーを交換しました',
    'km.saved': 'ショートカット設定を保存しました', 'km.saveFail': 'ショートカット設定の保存に失敗：{v}',
    'km.a.pan': '表示を移動（長押し）', 'km.a.highlight': 'レイヤーを強調 / 解除（長押し）',
    'km.a.undo': '元に戻す', 'km.a.redo': 'やり直す', 'km.a.base': 'キャンバス背景を切替',
    'km.a.hideLayers': 'レイヤーを隠す', 'km.a.hideBg': '背景画像を隠す', 'km.a.hideOthers': '他のレイヤーを隠す',
    'km.a.opacityLayersDown': 'レイヤーの不透明度 -10%', 'km.a.opacityLayersUp': 'レイヤーの不透明度 +10%',
    'km.a.opacityBgDown': '背景の不透明度 -10%', 'km.a.opacityBgUp': '背景の不透明度 +10%',
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
    'km.g.global': '공통', 'km.g.canvas': '캔버스', 'km.g.edit': '편집 모드',
    'km.hint': '키 상자를 클릭한 뒤 새 키를 누르세요. 겹치면 서로 교환됩니다',
    'km.panSpace': '캔버스 드래그에 스페이스 사용',
    'km.mode.key': '키보드', 'km.mode.pad': '게임패드',
    'km.gp.press': '게임패드 버튼을 누르세요…', 'km.gp.swapped': '"{v}"와(과) 버튼을 교환했습니다',
    'km.gp.conflict': '게임패드 버튼 충돌: {v}',
    'km.a.tabPrev': '이전 탭', 'km.a.tabNext': '다음 탭',
    'km.a.modePrev': '이전 편집 모드', 'km.a.modeNext': '다음 편집 모드',
    'km.press': '키를 누르세요…', 'km.escCancel': 'Esc 취소',
    'km.conflict': '키 충돌: {v}', 'km.swapped': '"{v}"와 키를 교환했습니다',
    'km.saved': '단축키 설정을 저장했습니다', 'km.saveFail': '단축키 설정 저장 실패: {v}',
    'km.a.pan': '보기 이동(길게)', 'km.a.highlight': '레이어 강조 / 해제(길게)',
    'km.a.undo': '실행 취소', 'km.a.redo': '다시 실행', 'km.a.base': '캔버스 배경 전환',
    'km.a.hideLayers': '레이어 숨기기', 'km.a.hideBg': '배경 이미지 숨기기', 'km.a.hideOthers': '다른 레이어 숨기기',
    'km.a.opacityLayersDown': '레이어 불투명도 -10%', 'km.a.opacityLayersUp': '레이어 불투명도 +10%',
    'km.a.opacityBgDown': '배경 불투명도 -10%', 'km.a.opacityBgUp': '배경 불투명도 +10%',
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

/* ================= 绑定表状态 ================= */
App.keymap = {
  map: null,
  index: null,     /* 上下文 → { 规范组合串: 动作 id }，每次改表重建（查表 O(1)） */

  init() {
    this.map = window.SVE_KEYMAP.resolve(null);
    this.reindex();
    return this.map;
  },

  /* 用 settings.json 里的差分覆盖默认值（非法项自动回退默认） */
  load(saved) {
    this.map = window.SVE_KEYMAP.resolve(saved || null);
    this.reindex();
    return this.map;
  },

  /* 索引里同时登记「松散匹配」变体：无 Ctrl/Alt 的组合也接住 Shift+本键，
     与 keymap.js 的 matchesEvent 规则保持一致（W 与 Shift+W 等效）。 */
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

  /* 当前按键属于哪个动作：先查本上下文，再查通用（编辑模式内 Tab=翻转 覆盖画布 Tab=高亮） */
  actionFor(e, ctx) {
    if (!this.index) return null;
    const canon = window.SVE_KEYMAP.normalizeKey(e);
    if (!canon) return null;
    const local = this.index[ctx];
    if (local && local[canon]) return local[canon];
    return this.index.global[canon] || null;
  },

  /* 改一个槽位。若新组合被「同上下文 / 通用」的别的动作占用 → 两者**交换**，
     这样永远不会出现「某动作没绑定」或「两个动作抢同一个键」。返回被交换的动作 id 列表。 */
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

  /* 给「一个绑定都没有」的动作新增一条绑定（modePrev / modeNext 的键盘默认就是空数组）。
     撞车时没有旧键可交换 ⇒ 直接拒绝并返回撞车的动作 id；非法组合返回 null；成功返回 ''。
     与 setCombo 的交换语义互补：交换只解决「有旧键」，新增只解决「一个键都没有」。 */
  addCombo(id, combo) {
    const KM = window.SVE_KEYMAP;
    if (!KM || !this.map[id] || !KM.isValidCombo(combo)) return null;
    const mine = this.map[id];
    if (mine.indexOf(combo) >= 0) return '';
    let clash = null;
    KM.ACTIONS.forEach(a => {
      if (a.id === id || !KM.canConflict(a.id, id)) return;
      if ((this.map[a.id] || []).some(c => KM.sameBinding(c, combo))) clash = a.id;
    });
    if (clash) return clash;
    mine.push(combo);
    this.reindex();
    return '';
  },

  snapshot() { return JSON.parse(JSON.stringify(this.map)); },
  restore(snap) { this.map = JSON.parse(JSON.stringify(snap)); this.reindex(); },
  resetToDefaults() { this.map = window.SVE_KEYMAP.resolve(null); this.reindex(); },
  isDefault() { return Object.keys(window.SVE_KEYMAP.toSaved(this.map)).length === 0; },
  conflicts() { return window.SVE_KEYMAP.conflicts(this.map); },
  /* 落盘用：只存与默认值不同的动作 */
  payload() { return window.SVE_KEYMAP.toSaved(this.map); },
  /* 显示用：把某个动作的绑定拆成 chip 列表 */
  display(id) {
    return this.combos(id).map(c => window.SVE_KEYMAP.displayParts(c));
  }
};
App.keymap.init();

/* ================= 设置窗内的快捷键视图 ================= */
App.keymapUI = {
  el: null,          /* #settingsKeyView */
  box: null,         /* .confirm-box */
  capturing: null,   /* { id, slot, btn } */
  gpCap: null,       /* 手柄捕获：{ id, slot, btn } */
  snapshot: null,
  gpSnapshot: null,
  mode: 'key',       /* key = 键盘绑定 · pad = 手柄绑定 */
  /* 「待绑定」的动作：**默认一个键都没绑**，但仍然要出现在改键名单里（带一个「+」让用户自己绑）。
     2026-10-29 03:35 用户口径：切标签页这两个动作不许占默认快捷键（原来占着 ctrl+Tab / LT+RT，
     把「LT/RT = Tab」顶掉了），但要在设置里留着，等用户自己绑。 */
  PENDING: ['tabPrev', 'tabNext'],

  build(box) {
    this.box = box;
    let view = box.querySelector('#settingsKeyView');
    if (!view) return null;
    this.el = view;
    view.innerHTML =
      /* 第一个是「画布拖动使用空格」开关：
         开（默认）= 按住空格才能拖动平移画布；关 = 鼠标直接拖动即可平移。 */
      '<div class="km-opt-row">' +
        '<label class="km-opt-label" for="kmPanSpace" data-i18n="km.panSpace"></label>' +
        '<label class="sve-switch"><input type="checkbox" id="kmPanSpace">' +
          '<span class="sve-switch-track" aria-hidden="true"></span></label>' +
      '</div>' +
      /* 紧贴它的**下方**：键盘 / 手柄 两个切换钮（与软件其它切换钮同一套 ev-tabs 组件 + glider） */
      '<div class="km-mode-row">' +
        '<div class="ev-tabs"><div class="ev-tabs-track">' +
          '<input type="radio" id="kmModeKey" name="kmMode" value="key" checked>' +
          '<label for="kmModeKey" data-i18n="km.mode.key"></label>' +
          '<input type="radio" id="kmModePad" name="kmMode" value="pad">' +
          '<label for="kmModePad" data-i18n="km.mode.pad"></label>' +
          '<span class="ev-glider"></span>' +
        '</div></div>' +
      '</div>' +
      '<div class="km-hint" id="kmHint" data-i18n="km.hint"></div>' +
      '<div class="km-scroll" id="kmList"></div>' +
      '<div class="km-warn hidden" id="kmWarn"></div>' +
      '<div class="speed-reset-row"><button class="speed-reset km-reset" data-i18n="speed.reset"></button></div>' +
      '<div class="anchor-btns">' +
        '<button class="km-cancel" data-i18n="speed.cancel"></button>' +
        '<button class="km-ok" data-i18n="speed.ok"></button>' +
      '</div>';
    if (App.i18n && App.i18n.apply) App.i18n.apply(view);
    /* 「画布拖动使用空格」开关：**即时生效 + 立即落盘**（与设置窗主视图的语言/主题同一做法）。
       它不参与本视图「重置 / 取消 / 确认」的快照 —— 那三个按钮管的是键位绑定。 */
    const panSw = view.querySelector('#kmPanSpace');
    if (panSw) {
      panSw.checked = App.settings.panNeedsSpace !== false;
      panSw.addEventListener('change', () => {
        App.settings.panNeedsSpace = !!panSw.checked;
        App.settings.save();
      });
    }
    /* 键盘 / 手柄 视图切换：只换下面那份列表，快照（取消回滚点）不受影响 */
    const modeWrap = view.querySelector('.km-mode-row');
    if (modeWrap) {
      const posGlider = () => {
        const track = modeWrap.querySelector('.ev-tabs-track');
        const checked = track && track.querySelector('input:checked');
        const label = checked ? track.querySelector('label[for="' + checked.id + '"]') : null;
        const glider = track && track.querySelector('.ev-glider');
        if (!label || !glider) return;
        glider.style.width = label.offsetWidth + 'px';
        glider.style.transform = 'translateX(' + label.offsetLeft + 'px)';
      };
      modeWrap.querySelectorAll('input[type="radio"]').forEach(r => {
        r.addEventListener('change', () => {
          this.stopCapture();          /* 切视图 = 放弃正在进行的按键捕获 */
          this.mode = r.value;
          posGlider();
          this.render();
        });
      });
      this.posModeGlider = posGlider;
      requestAnimationFrame(posGlider);
    }
    view.querySelector('.km-reset').addEventListener('click', () => this.reset());
    view.querySelector('.km-cancel').addEventListener('click', () => this.cancel());
    view.querySelector('.km-ok').addEventListener('click', () => this.commit());
    /* 列表用事件委托：键位框是每次重渲重建的 */
    view.querySelector('#kmList').addEventListener('click', e => {
      const b = e.target && e.target.closest ? e.target.closest('.km-key') : null;
      if (!b) return;
      e.preventDefault();
      /* 手柄视图：键位框上挂的是手柄按键 id，不是键盘组合串 */
      if (this.mode === 'pad') {
        if (this.gpCap && this.gpCap.btn === b) { this.stopCapture(); return; }   /* 再点一次=放弃 */
        const gadd = b.getAttribute('data-gp-add');
        if (gadd) { this.startGpCapture(gadd, 0, b, true); return; }              /* 待绑定 → 新增 */
        const gid = b.getAttribute('data-gp-act');
        if (gid) this.startGpCapture(gid, parseInt(b.getAttribute('data-gp-slot'), 10), b);
        return;
      }
      const id = b.getAttribute('data-act'), slot = parseInt(b.getAttribute('data-slot'), 10);
      if (this.capturing && this.capturing.btn === b) { this.stopCapture(); return; }   /* 再点一次=放弃 */
      this.startCapture(id, slot, b, b.getAttribute('data-add') === '1');
    });
    this.render();
    return view;
  },

  /* 列表：分组标题 + 每行「动作名 + 若干键位框」。
     两个视图（键盘 / 手柄）共用同一副外壳与同一套分组，只有键位框的来源不同。 */
  render() {
    if (!this.el) return;
    const list = this.el.querySelector('#kmList');
    if (!list) return;
    if (this.mode === 'pad') this.renderPad(list);
    else this.renderKeys(list);
    /* 改键期间绑定**已经生效**（动作立刻可用），所以编辑条上的键位提示也必须同步，
       不能等点「确认」——否则窗口里写着 Q、编辑条还写着 3。 */
    if (App.refreshEditBarKeys) App.refreshEditBarKeys();
  },

  /* 说明文字：键盘 / 手柄**共用同一句**（2026-10-29 03:30 用户口径）——
     「点击按键框后按下新按键；与已有键位撞车时会自动与对方交换」。
     它挂在 #kmHint 的静态 data-i18n="km.hint" 上，apply() 自己会跟着语言重刷，
     所以不需要再按视图切一次文案。 */

  /* 两个视图（键盘 / 手柄）**共用这一个渲染器**：
       · 分组永远是 SVE_KEYMAP.GROUPS 那三组（通用 / 画布 / 编辑模式），顺序也一致 ——
         手柄这边与键盘那边**分类完全一样**，不会各写一套；
       · 2026-10-29 03:24 用户口径：**没有可改键的那一行整行不出现**（不是留个空格位），
         未绑定的按键不进可绑定名单；一组里一条绑定都没有的话，连组标题都不出现；
       · 唯一的差别只有「键位框长什么样」：`makeChip` 由调用方给。
     combosOf(a.id) 返回该视图这一侧当前的绑定数组（键盘=组合串，手柄=按键 id）。 */
  renderList(list, combosOf, makeChip, makeAdd) {
    const t = k => App.i18n.t(k);
    const PENDING = this.PENDING;
    list.innerHTML = '';
    window.SVE_KEYMAP.GROUPS.forEach(g => {
      /* 只保留「这一侧有绑定」的动作；PENDING 里的动作即使没绑定也留着（待绑定） */
      const acts = window.SVE_KEYMAP.ACTIONS.filter(a =>
        a.ctx === g.ctx && (combosOf(a.id).length || PENDING.indexOf(a.id) >= 0));
      if (!acts.length) return;                  /* 整组都没有可改键 → 整组不出现 */
      const box = document.createElement('div');
      box.className = 'km-group';
      box.setAttribute('data-km-ctx', g.ctx);
      const h = document.createElement('div');
      h.className = 'km-group-title';
      h.textContent = t(g.title);
      box.appendChild(h);
      acts.forEach(a => {
        const row = document.createElement('div');
        row.className = 'km-row';
        row.setAttribute('data-km-act', a.id);
        const lab = document.createElement('div');
        lab.className = 'km-label';
        lab.textContent = t(a.label);
        row.appendChild(lab);
        const keys = document.createElement('div');
        keys.className = 'km-keys';
        const vals = combosOf(a.id);
        vals.forEach((v, slot) => keys.appendChild(makeChip(a.id, v, slot)));
        if (!vals.length) keys.appendChild(makeAdd(a.id));   /* 待绑定：虚线「+」自己绑 */
        row.appendChild(keys);
        box.appendChild(row);
      });
      list.appendChild(box);
    });
    if (this.mode === 'pad') this.renderGpConflicts();
    else this.renderConflicts();
  },

  /* 键盘视图：键位框 = 键盘组合串 */
  renderKeys(list) {
    this.renderList(list, id => App.keymap.combos(id), (id, combo, slot) => {
      const b = document.createElement('button');
      b.className = 'km-key';
      b.setAttribute('data-act', id);
      b.setAttribute('data-slot', String(slot));
      this.fillButton(b, combo);
      return b;
    }, id => {
      const add = document.createElement('button');
      add.className = 'km-key km-add';
      add.setAttribute('data-act', id);
      add.setAttribute('data-add', '1');
      add.textContent = '+';
      return add;
    });
  },

  /* 手柄视图：键位框 = 手柄物理按键（A/B/X/Y/十字键/LB/RB/LT/RT/L3/R3），
     与键盘那套**完全独立**（改键盘不会碰到这里，反之亦然） */
  renderPad(list) {
    const GP = App.gpmap;
    this.renderList(list, id => GP.combos(id), (id, btn, slot) => {
      const b = document.createElement('button');
      b.className = 'km-key';
      b.setAttribute('data-gp-act', id);
      b.setAttribute('data-gp-slot', String(slot));
      b.textContent = GP.glyph(btn);
      return b;
    }, id => {
      const add = document.createElement('button');
      add.className = 'km-key km-add';
      add.setAttribute('data-gp-add', id);
      add.textContent = '+';
      return add;
    });
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
    this.showWarn(App.keymap.conflicts(), 'km.conflict');
  },
  renderGpConflicts() {
    this.showWarn(App.gpmap ? App.gpmap.conflicts() : [], 'km.gp.conflict');
  },
  showWarn(cs, key) {
    const warn = this.el && this.el.querySelector('#kmWarn');
    if (!warn) return;
    if (!cs.length) { warn.classList.add('hidden'); warn.textContent = ''; return; }
    const t = k => App.i18n.t(k);
    const name = id => t((window.SVE_KEYMAP.ACTIONS_BY_ID[id] || {}).label || id);
    warn.textContent = t(key).replace('{v}', cs.map(c => name(c.a) + ' ↔ ' + name(c.b)).join('，'));
    warn.classList.remove('hidden');
  },

  /* 切回设置主视图（再次打开设置窗时必须回到主视图，不能停在上次的快捷键页） */
  showMainView() {
    this.stopCapture();
    this.snapshot = null;
    this.gpSnapshot = null;
    /* 下次进来从键盘视图开始（与「重置/取消/确认」的快照口径无关） */
    if (this.el) this.setMode('key'); else this.mode = 'key';
    const box = document.getElementById('settingsPanel');
    if (!box) return;
    const main = box.querySelector('#settingsMainView');
    const key = box.querySelector('#settingsKeyView');
    const title = box.querySelector('#settingsTitle');
    if (main) main.classList.remove('hidden');
    if (key) key.classList.add('hidden');
    if (this.box) this.box.classList.remove('km-mode');
    if (title) { title.setAttribute('data-i18n', 'settings.title'); title.textContent = App.i18n.t('settings.title'); }
    /* 回到主视图：× 的语义变回「直接关窗」（主视图里没有待确认状态） */
    if (this.box && App.attachDlgClose) {
      const panel = document.getElementById('settingsPanel');
      App.attachDlgClose(this.box, () => { App.hideOverlay(panel || box); return true; });
    }
  },

  /* 键盘 / 手柄 视图切换（radio 的 change 与 open() 复位共用这一份） */
  setMode(mode) {
    this.mode = mode === 'pad' ? 'pad' : 'key';
    const r = this.el && this.el.querySelector('#' + (this.mode === 'pad' ? 'kmModePad' : 'kmModeKey'));
    if (r) r.checked = true;
    if (this.posModeGlider) this.posModeGlider();
  },

  /* 开关状态与真实设置同步（面板不许与真实设置不一致 —— 与 settings.syncPanel 同一原则） */
  syncPanSwitch() {
    const sw = this.el && this.el.querySelector('#kmPanSpace');
    if (sw) sw.checked = App.settings.panNeedsSpace !== false;
  },

  /* 打开：切到快捷键视图，并记下当前两张绑定表（键盘 + 手柄）作为「取消」的回滚点 */
  open() {
    const box = document.getElementById('settingsPanel');
    if (!box) return false;
    if (!this.el) this.build(box.querySelector('.confirm-box') || box);
    this.snapshot = App.keymap.snapshot();
    this.gpSnapshot = App.gpmap ? App.gpmap.snapshot() : null;
    /* 每次打开都从「键盘」视图开始（与「每次打开都回设置主视图」同一纪律：
       上次停在手柄视图，打开时看到的是另一张表，很容易改错地方） */
    this.setMode('key');
    const main = box.querySelector('#settingsMainView');
    const key = box.querySelector('#settingsKeyView');
    const title = box.querySelector('#settingsTitle');
    if (main) main.classList.add('hidden');
    if (key) key.classList.remove('hidden');
    if (this.box) this.box.classList.add('km-mode');   /* 快捷键视图更宽一点，键位框才排得下 */
    if (title) { title.setAttribute('data-i18n', 'settings.keymap'); title.textContent = App.i18n.t('settings.keymap'); }
    /* 进快捷键视图：× 必须改走 cancel()。本视图里改的绑定是「待确认」的临时表，
       走主视图那个直接隐藏会把没确认的绑定静默留下（下拉里的 Cancel 本来就会回滚）。 */
    if (this.box && App.attachDlgClose) App.attachDlgClose(this.box, () => this.cancel());
    this.syncPanSwitch();
    this.render();
    return true;
  },

  /* 重置：只改临时绑定表 + 界面，不落盘（与速率窗口一致，要确认才生效）。
     键盘、手柄两张表一起回默认（同一个窗口、同一副按钮，口径要一致）。 */
  reset() {
    this.stopCapture();
    App.keymap.resetToDefaults();
    if (App.gpmap) App.gpmap.resetToDefaults();
    this.render();
    return true;
  },

  /* 取消：丢弃本次改动（回到打开窗口前的绑定表）并关闭设置窗 */
  cancel() {
    this.stopCapture();
    if (this.snapshot) { App.keymap.restore(this.snapshot); this.snapshot = null; }
    if (this.gpSnapshot) { App.gpmap.restore(this.gpSnapshot); this.gpSnapshot = null; }
    const box = document.getElementById('settingsPanel');
    if (box) App.hideOverlay(box);
    return true;
  },

  /* 确认：保留本次改动、写入 settings.json 并关闭；保存失败要提示，不静默伪装成功 */
  commit() {
    this.stopCapture();
    this.snapshot = null;
    this.gpSnapshot = null;
    const box = document.getElementById('settingsPanel');
    if (box) App.hideOverlay(box);
    /* 帮助窗口与编辑条立刻同步新键位（不等下次打开/重进编辑） */
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

  /* ---------- 按键捕获 ---------- */
  startCapture(id, slot, btn, isNew) {
    this.stopCapture();
    this.capturing = { id, slot, btn, isNew: !!isNew };   /* isNew = 待绑定那个「+」 */
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

  /* 手柄捕获：键盘那边监听 keydown，手柄只能靠 js/gamepad.js 的轮询，
     所以这里只登记「在等一个手柄按键」，真正的落键在 onGpCapture 里做。 */
  startGpCapture(id, slot, btn, isNew) {
    this.stopCapture();
    this.gpCap = { id, slot, btn, isNew: !!isNew };
    if (App.gpmap) App.gpmap.startCapture(id, slot, isNew);
    btn.classList.add('km-capturing');
    btn.textContent = App.i18n.t('km.gp.press');
  },

  /* 手柄按键捕获到之后的落表（由 App.gpmap.finishCapture 回调） */
  onGpCapture(cap, btn) {
    this.gpCap = null;                     /* 捕获已结束，别再走 stopCapture 的还原分支 */
    const t = k => App.i18n.t(k);
    const name = id => t((window.SVE_KEYMAP.ACTIONS_BY_ID[id] || {}).label || id);
    if (cap.isNew) {
      const clash = App.gpmap.addButton(cap.id, btn);
      if (clash) showToast(t('km.gp.conflict').replace('{v}', name(cap.id) + ' ↔ ' + name(clash)));
    } else {
      const swapped = App.gpmap.setButton(cap.id, cap.slot, btn);
      if (swapped.length) showToast(t('km.gp.swapped').replace('{v}', swapped.map(name).join('、')));
    }
    this.render();
  },

  stopCapture() {
    /* 手柄捕获：清掉捕获状态，并把被改过的那个键位框还原成当前真实绑定 */
    const g = this.gpCap;
    this.gpCap = null;
    if (g) {
      if (App.gpmap) App.gpmap.stopCapture();
      if (this.mode === 'pad') this.render();
    }
    const c = this.capturing;
    this.capturing = null;
    if (!c || !c.btn) return;
    c.btn.classList.remove('km-capturing');
    /* 还原成当前真实绑定（可能没改） */
    const cur = App.keymap.combos(c.id)[c.slot];
    if (cur) this.fillButton(c.btn, cur);
    else if (c.isNew) { c.btn.textContent = '+'; }   /* 待绑定还没绑上：还原成「+」 */
  },

  /* 捕获期间接管键盘：捕获阶段 + 掐断传播，避免被全局快捷键吃掉。
     只按修饰键不算（继续等）；Esc = 放弃本次捕获。 */
  onKeydown(e) {
    const c = this.capturing;
    if (!c) return false;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    if (e.key === 'Escape') { this.stopCapture(); return true; }
    const combo = window.SVE_KEYMAP.comboFromEvent(e);
    if (!combo) return true;
    /* 只按下修饰键（Ctrl / Alt / Shift / ⌘）→ 继续等真正的按键 */
    const parts = combo.split('+');
    if (parts.length === 1 && ['ctrl', 'alt', 'shift'].indexOf(parts[0]) >= 0) return true;
    const name = id => App.i18n.t((window.SVE_KEYMAP.ACTIONS_BY_ID[id] || {}).label || id);
    /* 待绑定的「+」：这个动作原本一个绑定都没有，没有旧键可交换 ⇒ 撞车时直接拒绝 */
    if (c.isNew) {
      const clash = App.keymap.addCombo(c.id, combo);
      this.stopCapture();
      this.render();
      if (clash) showToast(App.i18n.t('km.conflict').replace('{v}', name(c.id) + ' ↔ ' + name(clash)));
      return true;
    }
    const swapped = App.keymap.setCombo(c.id, c.slot, combo);
    this.stopCapture();
    this.render();
    if (swapped.length) {
      showToast(App.i18n.tf('km.swapped', { v: swapped.map(name).join('、') }));
    }
    return true;
  },

  /* 设置窗（含快捷键视图）开着时，全局快捷键一律不生效 */
  isOpen() {
    const box = document.getElementById('settingsPanel');
    return !!(box && !box.classList.contains('hidden'));
  }
};

/* 编辑条上的模式键位（1~5）也要跟着自定义绑定走：
   index.html 里那几颗 <kbd>1</kbd>~<kbd>5</kbd> 是写死的，改键后必须重写，
   否则「编辑条写着 3、实际要按 Q」这种自相矛盾的界面就出现了。 */
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

/* 捕获监听：注册在捕获阶段，先于 main.js 的全局 keydown */
window.addEventListener('keydown', function (e) {
  if (App.keymapUI && App.keymapUI.capturing) { App.keymapUI.onKeydown(e); return; }
  /* 设置窗开着时 Esc = 取消（与速率窗口一致：Esc 关窗即回滚） */
  if (e.key === 'Escape' && App.keymapUI && App.keymapUI.isOpen()) {
    const key = document.getElementById('settingsKeyView');
    if (key && !key.classList.contains('hidden')) {
      e.preventDefault(); e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      /* 正在等手柄按键：Esc 只放弃这次捕获，不关窗（否则一个错按就把整窗设置丢掉） */
      if (App.keymapUI.gpCap) { App.keymapUI.stopCapture(); return; }
      App.keymapUI.cancel();
    }
  }
}, true);

/* 切语言：本视图里的分组标题、动作名、说明、冲突提示都是 t() 现拼的，
   data-i18n 扫描管不到 ⇒ 注册到 apply() 末尾重刷（与 fonts.js 同一做法）。 */
if (App.i18n && App.i18n.onApply) {
  App.i18n.onApply(function () {
    const ui = App.keymapUI;
    if (!ui || !ui.el) return;
    const view = document.getElementById('settingsKeyView');
    if (!view || view.classList.contains('hidden')) return;
    if (ui.render) ui.render();
    if (ui.posModeGlider) ui.posModeGlider();
  });
}
