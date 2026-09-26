/* ---------- 快捷键面板（工具栏最右圆形按钮 → 弹出全部快捷键与说明） ----------
   数据来源：逐条对照 js/main.js 的 window keydown、js/panels.js 的「+」栏 Enter
   与 js/editmode.js 的鼠标修饰键整理；2026-09-14 按用户逐条要求改版。
   多语言：App.SHORTCUTS 只存 **i18n key**，文案在下方 App.SC_I18N 里
   （加载时并入 App.i18n.dicts），切语言由 App.refreshShortcutPanel 重渲。 */

/* keys 数组里每一项要么是字符串（i18n key 或各语言通用字面量），
   要么是 { act: '动作 id' } —— 后者渲染成该动作**当前**的绑定（改键后这里立刻跟着变）。
   鼠标/修饰键类（单击、滚轮、Shift+手柄拖动）不参与自定义，保持字面量。 */
App.SHORTCUTS = [
  {
    group: 'sc.g.canvas', items: [
      { keys: ['sc.k.click'], desc: 'sc.d.clickSelect' },
      { keys: [{ act: 'pan' }, 'sc.k.holdDrag'], desc: 'sc.d.pan' },
      { keys: ['sc.k.wheel'], desc: 'sc.d.zoom' },
      { keys: [{ act: 'base' }], desc: 'sc.d.base' }
    ]
  },
  {
    group: 'sc.g.select', items: [
      { keys: [{ act: 'up' }], desc: 'sc.d.up' },
      { keys: [{ act: 'down' }], desc: 'sc.d.down' },
      { keys: [{ act: 'highlight' }, 'sc.k.click'], desc: 'sc.d.hlToggle' },
      { keys: [{ act: 'highlight' }, 'sc.k.wheel'], desc: 'sc.d.hlSweep' },
      { keys: [{ act: 'highlight' }, 'sc.k.tabDrag'], desc: 'sc.d.hlBox' },
      { keys: [{ act: 'highlight' }, 'sc.k.tabCtrlDrag'], desc: 'sc.d.hlBoxCancel' },
      { keys: [{ act: 'toolbar' }], desc: 'sc.d.toolbar' },
      { keys: [{ act: 'toolbar' }, 'sc.k.dbl'], desc: 'sc.d.enterEdit' },
      { keys: ['sc.k.mouseDbl'], desc: 'sc.d.mouseDblEdit' },
      { keys: [{ act: 'escape' }], desc: 'sc.d.escBar' }
    ]
  },
  {
    group: 'sc.g.edit', items: [
      { keys: [{ act: 'undo' }], desc: 'sc.d.undo' },
      { keys: [{ act: 'redo' }], desc: 'sc.d.redo' },
      { keys: [{ act: 'cut' }], desc: 'sc.d.cut' },
      { keys: [{ act: 'paste' }], desc: 'sc.d.paste' },
      { keys: [{ act: 'delete' }], desc: 'sc.d.del' },
      { keys: ['sc.k.dragBar'], desc: 'sc.d.reorder' }
    ]
  },
  {
    group: 'sc.g.mode', items: [
      { keys: [{ act: 'mode1' }], desc: 'sc.d.m1' },
      { keys: [{ act: 'mode2' }], desc: 'sc.d.m2' },
      { keys: [{ act: 'mode3' }], desc: 'sc.d.m3' },
      { keys: [{ act: 'mode4' }], desc: 'sc.d.m4' },
      { keys: [{ act: 'mode5' }], desc: 'sc.d.m5' }
    ]
  },
  {
    group: 'sc.g.ops', items: [
      { keys: [{ act: 'moveUp' }, { act: 'moveLeft' }, { act: 'moveDown' }, { act: 'moveRight' }], desc: 'sc.d.wasd' },
      { keys: [{ act: 'nudgeUp' }, { act: 'nudgeDown' }, { act: 'nudgeLeft' }, { act: 'nudgeRight' }], desc: 'sc.d.nudge' },
      { keys: ['Shift', 'sc.k.shiftCorner'], desc: 'sc.d.rotate' },
      { keys: ['Shift', 'sc.k.shiftEdge'], desc: 'sc.d.skew' },
      { keys: [{ act: 'sizeMode' }], desc: 'sc.d.propMode' },
      { keys: [{ act: 'anchor' }], desc: 'sc.d.anchor' },
      { keys: [{ act: 'editDup' }], desc: 'sc.d.dup' },
      { keys: [{ act: 'editFlip' }], desc: 'sc.d.flipCycle' },
      { keys: [{ act: 'editDelete' }], desc: 'sc.d.delEdit' },
      { keys: [{ act: 'base' }], desc: 'sc.d.baseEdit' },
      { keys: [{ act: 'editFinish' }], desc: 'sc.d.finish' },
      { keys: [{ act: 'escape' }], desc: 'sc.d.cancelEdit' }
    ]
  }
];

/* 快捷键面板专属词典（加载时并入 App.i18n.dicts） */
App.SC_I18N = {
  'zh-CN': {
    'sc.g.canvas': '画布与视图', 'sc.g.select': '图层选择', 'sc.g.edit': '图层编辑',
    'sc.g.mode': '编辑模式 · 切换模式', 'sc.g.ops': '编辑模式 · 操作',
    'sc.k.click': '鼠标单击', 'sc.k.space': '空格', 'sc.k.holdDrag': '按住拖动', 'sc.k.wheel': '滚轮',
    'sc.k.tabClick': 'tab/tab+鼠标点击', 'sc.k.tabWheel': 'tab+滚轮',
    'sc.k.tabDrag': 'tab+鼠标画布内拖动', 'sc.k.tabCtrlDrag': 'tab+ctrl+鼠标画布内拖动',
    'sc.k.dbl': '双击', 'sc.k.mouseDbl': '鼠标双击', 'sc.k.dragBar': '拖动图层栏',
    'sc.k.arrows': '方向键', 'sc.k.shiftCorner': '+ 角手柄拖动', 'sc.k.shiftEdge': '+ 上下手柄左右拖',
    'sc.d.clickSelect': '选中图层', 'sc.d.pan': '平移视图',
    'sc.d.zoom': '缩放画布（可在工具栏「滚轮缩放」开关）', 'sc.d.base': '切换画布底色：灰白 / 灰黑',
    'sc.d.up': '上移一个图层', 'sc.d.down': '下移一个图层',
    'sc.d.hlToggle': '高亮图层/取消高亮图层', 'sc.d.hlSweep': '扫选高亮图层/取消高亮图层',
    'sc.d.hlBox': '框内高亮图层', 'sc.d.hlBoxCancel': '框内取消高亮图层',
    'sc.d.toolbar': '单击呼出白框所在图层的功能栏', 'sc.d.enterEdit': '进入编辑模式',
    'sc.d.mouseDblEdit': '进入编辑模式', 'sc.d.escBar': '关闭功能栏/刷新闪烁动画',
    'sc.d.undo': '撤销', 'sc.d.redo': '重做', 'sc.d.cut': '剪切选中图层', 'sc.d.paste': '粘贴',
    'sc.d.del': '删除选中图层', 'sc.d.reorder': '排序：图标浮影跟随鼠标，白色插入线指示落点',
    'sc.d.m1': '移动', 'sc.d.m2': '大小', 'sc.d.m3': '旋转', 'sc.d.m4': '倾斜', 'sc.d.m5': '透明度',
    'sc.d.wasd': '按当前模式操作：移动=上下左右；大小=沿图层轴向缩放；旋转/倾斜=左右',
    'sc.d.nudge': '微调', 'sc.d.rotate': '旋转', 'sc.d.skew': '倾斜',
    'sc.d.propMode': '大小模式：切换「等比 / 自由」', 'sc.d.anchor': '放置/清除锚点', 'sc.d.dup': '原位复制当前编辑的图层',
    'sc.d.flipCycle': '翻转循环：水平 → 水平+垂直 → 垂直 → 无',
    'sc.d.delEdit': '删除正在编辑的图层', 'sc.d.baseEdit': '切换画布底色',
    'sc.d.finish': '完成编辑并保留改动', 'sc.d.cancelEdit': '取消本次编辑，回退到进入编辑前的状态'
  },
  'zh-TW': {
    'sc.g.canvas': '畫布與檢視', 'sc.g.select': '圖層選擇', 'sc.g.edit': '圖層編輯',
    'sc.g.mode': '編輯模式 · 切換模式', 'sc.g.ops': '編輯模式 · 操作',
    'sc.k.click': '滑鼠單擊', 'sc.k.space': '空格', 'sc.k.holdDrag': '按住拖曳', 'sc.k.wheel': '滾輪',
    'sc.k.tabClick': 'tab/tab+滑鼠點擊', 'sc.k.tabWheel': 'tab+滾輪',
    'sc.k.tabDrag': 'tab+滑鼠畫布內拖曳', 'sc.k.tabCtrlDrag': 'tab+ctrl+滑鼠畫布內拖曳',
    'sc.k.dbl': '雙擊', 'sc.k.mouseDbl': '滑鼠雙擊', 'sc.k.dragBar': '拖曳圖層列',
    'sc.k.arrows': '方向鍵', 'sc.k.shiftCorner': '+ 角手柄拖曳', 'sc.k.shiftEdge': '+ 上下手柄左右拖',
    'sc.d.clickSelect': '選取圖層', 'sc.d.pan': '平移檢視',
    'sc.d.zoom': '縮放畫布（可在工具列「滾輪縮放」開關）', 'sc.d.base': '切換畫布底色：灰白 / 灰黑',
    'sc.d.up': '上移一個圖層', 'sc.d.down': '下移一個圖層',
    'sc.d.hlToggle': '反白圖層/取消反白圖層', 'sc.d.hlSweep': '掃選反白圖層/取消反白圖層',
    'sc.d.hlBox': '框內反白圖層', 'sc.d.hlBoxCancel': '框內取消反白圖層',
    'sc.d.toolbar': '單擊呼出白框所在圖層的功能列', 'sc.d.enterEdit': '進入編輯模式',
    'sc.d.mouseDblEdit': '進入編輯模式', 'sc.d.escBar': '關閉功能列/重新整理閃爍動畫',
    'sc.d.undo': '復原', 'sc.d.redo': '重做', 'sc.d.cut': '剪下選取的圖層', 'sc.d.paste': '貼上',
    'sc.d.del': '刪除選取的圖層', 'sc.d.reorder': '排序：圖示浮影跟隨滑鼠，白色插入線指示落點',
    'sc.d.m1': '移動', 'sc.d.m2': '大小', 'sc.d.m3': '旋轉', 'sc.d.m4': '傾斜', 'sc.d.m5': '透明度',
    'sc.d.wasd': '依目前模式操作：移動=上下左右；大小=沿圖層軸向縮放；旋轉/傾斜=左右',
    'sc.d.nudge': '微調', 'sc.d.rotate': '旋轉', 'sc.d.skew': '傾斜',
    'sc.d.propMode': '大小模式：切換「等比 / 自由」', 'sc.d.anchor': '放置/清除錨點', 'sc.d.dup': '原位複製目前編輯的圖層',
    'sc.d.flipCycle': '翻轉循環：水平 → 水平+垂直 → 垂直 → 無',
    'sc.d.delEdit': '刪除正在編輯的圖層', 'sc.d.baseEdit': '切換畫布底色',
    'sc.d.finish': '完成編輯並保留變更', 'sc.d.cancelEdit': '取消本次編輯，回到進入編輯前的狀態'
  },
  'en': {
    'sc.g.canvas': 'Canvas & view', 'sc.g.select': 'Layer selection', 'sc.g.edit': 'Layer editing',
    'sc.g.mode': 'Edit mode · Switch mode', 'sc.g.ops': 'Edit mode · Operations',
    'sc.k.click': 'Mouse click', 'sc.k.space': 'Space', 'sc.k.holdDrag': 'Hold + drag', 'sc.k.wheel': 'Wheel',
    'sc.k.tabClick': 'tab / tab + mouse click', 'sc.k.tabWheel': 'tab + wheel',
    'sc.k.tabDrag': 'tab + drag on canvas', 'sc.k.tabCtrlDrag': 'tab + ctrl + drag on canvas',
    'sc.k.dbl': 'double-click', 'sc.k.mouseDbl': 'Mouse double-click', 'sc.k.dragBar': 'Drag in layer bar',
    'sc.k.arrows': 'Arrow keys', 'sc.k.shiftCorner': '+ drag corner handle', 'sc.k.shiftEdge': '+ drag top/bottom handle',
    'sc.d.clickSelect': 'Select layer', 'sc.d.pan': 'Pan the view',
    'sc.d.zoom': 'Zoom canvas (toggle "Wheel zoom" in the toolbar)', 'sc.d.base': 'Toggle canvas background: light / dark gray',
    'sc.d.up': 'Move up one layer', 'sc.d.down': 'Move down one layer',
    'sc.d.hlToggle': 'Highlight layer / clear highlight', 'sc.d.hlSweep': 'Sweep-highlight layers / clear highlight',
    'sc.d.hlBox': 'Highlight layers inside the box', 'sc.d.hlBoxCancel': 'Clear highlight inside the box',
    'sc.d.toolbar': 'Click to open the toolbar for the white-box layer', 'sc.d.enterEdit': 'Enter edit mode',
    'sc.d.mouseDblEdit': 'Enter edit mode', 'sc.d.escBar': 'Close the toolbar / refresh the flash animation',
    'sc.d.undo': 'Undo', 'sc.d.redo': 'Redo', 'sc.d.cut': 'Cut selected layers', 'sc.d.paste': 'Paste',
    'sc.d.del': 'Delete selected layers', 'sc.d.reorder': 'Reorder: icon ghost follows the mouse, white line shows the drop point',
    'sc.d.m1': 'Move', 'sc.d.m2': 'Size', 'sc.d.m3': 'Rotate', 'sc.d.m4': 'Skew', 'sc.d.m5': 'Opacity',
    'sc.d.wasd': 'Act per current mode: Move = up/down/left/right; Size = scale along layer axes; Rotate/Skew = left/right',
    'sc.d.nudge': 'Nudge', 'sc.d.rotate': 'Rotate', 'sc.d.skew': 'Skew',
    'sc.d.propMode': 'Size mode: toggle Uniform / Free', 'sc.d.anchor': 'Place / clear the anchor', 'sc.d.dup': 'Duplicate the layer being edited in place',
    'sc.d.flipCycle': 'Flip cycle: horizontal -> horizontal+vertical -> vertical -> none',
    'sc.d.delEdit': 'Delete the layer being edited', 'sc.d.baseEdit': 'Toggle canvas background',
    'sc.d.finish': 'Finish editing and keep changes', 'sc.d.cancelEdit': 'Cancel this edit and restore the previous state'
  },
  'ja': {
    'sc.g.canvas': 'キャンバスと表示', 'sc.g.select': 'レイヤー選択', 'sc.g.edit': 'レイヤー編集',
    'sc.g.mode': '編集モード · モード切替', 'sc.g.ops': '編集モード · 操作',
    'sc.k.click': 'マウスクリック', 'sc.k.space': 'スペース', 'sc.k.holdDrag': '長押しドラッグ', 'sc.k.wheel': 'ホイール',
    'sc.k.tabClick': 'tab / tab+マウスクリック', 'sc.k.tabWheel': 'tab+ホイール',
    'sc.k.tabDrag': 'tab+キャンバス内ドラッグ', 'sc.k.tabCtrlDrag': 'tab+ctrl+キャンバス内ドラッグ',
    'sc.k.dbl': 'ダブルクリック', 'sc.k.mouseDbl': 'マウスダブルクリック', 'sc.k.dragBar': 'レイヤー列をドラッグ',
    'sc.k.arrows': '矢印キー', 'sc.k.shiftCorner': '+ 角ハンドルをドラッグ', 'sc.k.shiftEdge': '+ 上下ハンドルを左右にドラッグ',
    'sc.d.clickSelect': 'レイヤーを選択', 'sc.d.pan': '表示を移動',
    'sc.d.zoom': 'キャンバスを拡大縮小（ツールバー「ホイール拡大」で切替）', 'sc.d.base': 'キャンバス背景を切替：ライト / ダークグレー',
    'sc.d.up': '1 つ上のレイヤーへ', 'sc.d.down': '1 つ下のレイヤーへ',
    'sc.d.hlToggle': 'レイヤーを強調 / 強調を解除', 'sc.d.hlSweep': 'なぞって強調 / 強調を解除',
    'sc.d.hlBox': '枠内のレイヤーを強調', 'sc.d.hlBoxCancel': '枠内の強調を解除',
    'sc.d.toolbar': 'クリックで白枠レイヤーの機能バーを表示', 'sc.d.enterEdit': '編集モードに入る',
    'sc.d.mouseDblEdit': '編集モードに入る', 'sc.d.escBar': '機能バーを閉じる/点滅アニメーションを更新',
    'sc.d.undo': '元に戻す', 'sc.d.redo': 'やり直す', 'sc.d.cut': '選択レイヤーを切り取り', 'sc.d.paste': '貼り付け',
    'sc.d.del': '選択レイヤーを削除', 'sc.d.reorder': '並べ替え：アイコンの残像がマウスに追随、白い線が挿入位置を表示',
    'sc.d.m1': '移動', 'sc.d.m2': 'サイズ', 'sc.d.m3': '回転', 'sc.d.m4': '傾き', 'sc.d.m5': '不透明度',
    'sc.d.wasd': '現在のモードで操作：移動=上下左右、サイズ=レイヤー軸方向に拡縮、回転/傾き=左右',
    'sc.d.nudge': '微調整', 'sc.d.rotate': '回転', 'sc.d.skew': '傾き',
    'sc.d.propMode': 'サイズモード：「等倍 / 自由」を切替', 'sc.d.anchor': 'アンカーを配置/解除', 'sc.d.dup': '編集中のレイヤーをその場で複製',
    'sc.d.flipCycle': '反転サイクル：水平 → 水平+垂直 → 垂直 → なし',
    'sc.d.delEdit': '編集中のレイヤーを削除', 'sc.d.baseEdit': 'キャンバス背景を切替',
    'sc.d.finish': '編集を完了して変更を保持', 'sc.d.cancelEdit': 'この編集を取消し、編集前の状態に戻す'
  },
  'ko': {
    'sc.g.canvas': '캔버스와 보기', 'sc.g.select': '레이어 선택', 'sc.g.edit': '레이어 편집',
    'sc.g.mode': '편집 모드 · 모드 전환', 'sc.g.ops': '편집 모드 · 조작',
    'sc.k.click': '마우스 클릭', 'sc.k.space': '스페이스', 'sc.k.holdDrag': '길게 눌러 드래그', 'sc.k.wheel': '휠',
    'sc.k.tabClick': 'tab / tab+마우스 클릭', 'sc.k.tabWheel': 'tab+휠',
    'sc.k.tabDrag': 'tab+캔버스 내 드래그', 'sc.k.tabCtrlDrag': 'tab+ctrl+캔버스 내 드래그',
    'sc.k.dbl': '더블 클릭', 'sc.k.mouseDbl': '마우스 더블 클릭', 'sc.k.dragBar': '레이어 목록 드래그',
    'sc.k.arrows': '방향키', 'sc.k.shiftCorner': '+ 모서리 핸들 드래그', 'sc.k.shiftEdge': '+ 상하 핸들 좌우 드래그',
    'sc.d.clickSelect': '레이어 선택', 'sc.d.pan': '보기 이동',
    'sc.d.zoom': '캔버스 확대/축소(툴바 「휠 확대」로 전환)', 'sc.d.base': '캔버스 배경 전환: 밝은 / 어두운 회색',
    'sc.d.up': '한 레이어 위로', 'sc.d.down': '한 레이어 아래로',
    'sc.d.hlToggle': '레이어 강조 / 강조 해제', 'sc.d.hlSweep': '훑어서 강조 / 강조 해제',
    'sc.d.hlBox': '상자 안 레이어 강조', 'sc.d.hlBoxCancel': '상자 안 강조 해제',
    'sc.d.toolbar': '클릭하여 흰 상자 레이어의 기능 바 열기', 'sc.d.enterEdit': '편집 모드 진입',
    'sc.d.mouseDblEdit': '편집 모드 진입', 'sc.d.escBar': '기능 바 닫기/깜빡임 애니메이션 새로 고침',
    'sc.d.undo': '실행 취소', 'sc.d.redo': '다시 실행', 'sc.d.cut': '선택 레이어 잘라내기', 'sc.d.paste': '붙여넣기',
    'sc.d.del': '선택 레이어 삭제', 'sc.d.reorder': '정렬: 아이콘 잔상이 마우스를 따라가고 흰 선이 삽입 위치를 표시',
    'sc.d.m1': '이동', 'sc.d.m2': '크기', 'sc.d.m3': '회전', 'sc.d.m4': '기울기', 'sc.d.m5': '불투명도',
    'sc.d.wasd': '현재 모드로 조작: 이동=상하좌우, 크기=레이어 축 방향 확대/축소, 회전/기울기=좌우',
    'sc.d.nudge': '미세 조정', 'sc.d.rotate': '회전', 'sc.d.skew': '기울기',
    'sc.d.propMode': '크기 모드: 「등비 / 자유」 전환', 'sc.d.anchor': '앵커 배치/해제', 'sc.d.dup': '편집 중인 레이어를 제자리 복제',
    'sc.d.flipCycle': '반전 순환: 가로 → 가로+세로 → 세로 → 없음',
    'sc.d.delEdit': '편집 중인 레이어 삭제', 'sc.d.baseEdit': '캔버스 배경 전환',
    'sc.d.finish': '편집 완료 후 변경 유지', 'sc.d.cancelEdit': '이 편집을 취소하고 이전 상태로 되돌림'
  }
};
/* 并入主词典（i18n.js 先加载，这里追加即可） */
Object.keys(App.SC_I18N).forEach(function (lang) {
  if (App.i18n.dicts[lang]) Object.assign(App.i18n.dicts[lang], App.SC_I18N[lang]);
});

App.initShortcutPanel = function () {
  const btn = document.getElementById('btnShortcuts');
  const panel = document.getElementById('shortcutPanel');
  const list = document.getElementById('shortcutList');
  if (!btn || !panel || !list || App.shortcutPanelReady) return;
  App.shortcutPanelReady = true;

  /* 渲染：分组标题 + 「键位 chip + 说明」行。抽成函数以便切语言时整体重渲。 */
  App.refreshShortcutPanel = function () {
    const t = function (k) { return App.i18n.t(k); };
    list.innerHTML = '';
    App.SHORTCUTS.forEach(function (g) {
      const box = document.createElement('div');
      box.className = 'sc-group';
      const h = document.createElement('div');
      h.className = 'sc-group-title';
      h.textContent = t(g.group);
      box.appendChild(h);
      g.items.forEach(function (it) {
        const row = document.createElement('div');
        row.className = 'sc-row';
        const kc = document.createElement('div');
        kc.className = 'sc-keys';
        const sep = function (txt, cls) {
          const el = document.createElement('span');
          el.className = cls;
          el.textContent = txt;
          kc.appendChild(el);
        };
        const chip = function (text) {
          const kbd = document.createElement('kbd');
          kbd.textContent = text;
          kc.appendChild(kbd);
        };
        it.keys.forEach(function (k, i) {
          if (i > 0) sep('+', 'sc-plus');
          /* { act }：取该动作**当前**的绑定（设置窗里改键后这里立刻同步） */
          if (k && typeof k === 'object' && k.act) {
            const combos = App.keymap ? App.keymap.combos(k.act) : [];
            combos.forEach(function (combo, j) {
              if (j > 0) sep('/', 'sc-plus');
              window.SVE_KEYMAP.displayParts(combo).forEach(function (p, m) {
                if (m > 0) sep('+', 'sc-plus');
                chip(p.i18n ? t(p.i18n) : p.text);
              });
            });
            return;
          }
          /* 以 sc.k. 开头的才是词典 key，其余（Enter / Esc …）各语言通用字面量 */
          chip(k.indexOf('sc.k.') === 0 ? t(k) : k);
        });
        const d = document.createElement('div');
        d.className = 'sc-desc';
        d.textContent = t(it.desc);
        row.appendChild(kc);
        row.appendChild(d);
        box.appendChild(row);
      });
      list.appendChild(box);
    });
  };
  App.refreshShortcutPanel();

  const isOpen = function () { return !panel.classList.contains('hidden'); };
  App.openShortcutPanel = function () {
    panel.classList.remove('hidden');
    btn.classList.add('active');
  };
  App.closeShortcutPanel = function () {
    panel.classList.add('hidden');
    btn.classList.remove('active');
  };

  /* 悬停气泡：必须挂在 <body> 上，不能放在按钮内部。
     原因：#toolbar 带了 backdrop-filter（亚克力），它会**创建层叠上下文**——
     气泡无论 z-index 多高都被关在 toolbar 的上下文里，压不过 z-index:100 的 #tabBar，
     表现为「上方气泡被标签栏遮挡」。挂到 body 后气泡在根上下文里以 z-index:105 参与
     层叠，> 标签栏(100)、< 标签页缩略图(110)，不再被遮。 */
  const tip = document.createElement('span');
  tip.id = 'scTip';
  tip.className = 'sc-tooltip';
  tip.setAttribute('data-i18n', 'toolbar.tip');
  tip.textContent = 'QuQ';
  document.body.appendChild(tip);
  const placeTip = function () {
    const r = btn.getBoundingClientRect();
    tip.style.left = (r.left + r.width / 2) + 'px';
    tip.style.top = (r.top - 8) + 'px';       /* 气泡底边落在按钮上方 8px（translateY(-100%) 抬上去） */
  };
  btn.addEventListener('mouseenter', function () { placeTip(); tip.classList.add('sc-tip-show'); });
  btn.addEventListener('mouseleave', function () { tip.classList.remove('sc-tip-show'); });
  window.addEventListener('resize', function () { if (tip.classList.contains('sc-tip-show')) placeTip(); });

  btn.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (isOpen()) App.closeShortcutPanel(); else App.openShortcutPanel();
  });
  const closeBtn = document.getElementById('btnShortcutClose');
  if (closeBtn) closeBtn.addEventListener('click', function () { App.closeShortcutPanel(); });

  /* 点击面板以外任意处关闭（按钮自身已 stopPropagation，不会误关） */
  document.addEventListener('click', function (e) {
    if (!isOpen()) return;
    if (panel.contains(e.target)) return;
    App.closeShortcutPanel();
  }, true);

  /* Esc 关闭：用捕获阶段并掐断传播，避免同时触发 main.js 的 Esc 链路
     （取色器/退出编辑/清空选择）。面板开着时 Esc 只关面板。 */
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !isOpen()) return;
    e.preventDefault();
    e.stopPropagation();
    App.closeShortcutPanel();
  }, true);
};

App.initShortcutPanel();
