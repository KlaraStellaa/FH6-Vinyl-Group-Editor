'use strict';
/* ================= 首次启动帮助提示窗（2026-10-29 用户口径）=================
   触发：用户下载新版本后**初次启动**时弹一次；点「确认」后把 helpHintAck 写进
        settings.json，此后任何版本更新都不再弹（永久只弹一次）。
   内容：五种语言**从上到下堆叠、每段换行隔开**（不按当前语言切换 ——
        让任何语言的用户都能看懂）。
   交互：**只有右下角「确认」**。没有关闭按钮、没有取消、点遮罩不关、Esc 不关。
        点确认之前离不开这个窗口。
   ========================================================================= */
App.helpHint = {
  el: null,
  /* 顺序固定：简中 → 繁中 → 英 → 日 → 韩（与软件支持的五种语言一致） */
  TEXTS: [
    '请鼠标右击！右击！！编辑页面中上方的“？”帮助按键后，左击！画布与左侧图层栏（不是+栏！不是+栏！），弹出的帮助窗口可能会教会你更容易地使用这个软件',
    '請滑鼠右擊！右擊！！編輯頁面中上方的「？」說明按鍵後，左擊！畫布與左側圖層欄（不是+欄！不是+欄！），彈出的說明視窗可能會教會你更容易地使用這個軟體',
    'Right-click! Right-click!! the "?" help button at the top of the editing page, then left-click! the canvas and the layer list on the left (NOT the + bar! NOT the + bar!). The help window that pops up may teach you to use this software more easily',
    '右クリック！右クリック！！編集画面の上部にある「？」ヘルプボタンを右クリックしてから、キャンバスと左側のレイヤー欄（＋バーではありません！＋バーではありません！）を左クリックしてください。表示されるヘルプウィンドウが、このソフトをもっと簡単に使えるように教えてくれるかもしれません',
    '마우스 오른쪽 버튼을 클릭하세요! 오른쪽 클릭!! 편집 화면 상단의 "?" 도움말 버튼을 오른쪽 클릭한 다음, 캔버스와 왼쪽 레이어 목록(+ 막대가 아닙니다! + 막대가 아닙니다!)을 왼쪽 클릭하세요. 나타나는 도움말 창이 이 소프트웨어를 더 쉽게 사용하는 방법을 가르쳐 줄 것입니다'
  ],

  esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },

  build() {
    if (this.el && this.el.isConnected) return this.el;
    const p = document.createElement('div');
    p.id = 'helpHintPanel';
    p.className = 'confirm-overlay hidden';
    const paras = this.TEXTS.map((t, i) =>
      '<p class="helphint-p" data-lang-idx="' + i + '" style="margin:0 0 12px;line-height:1.6;font-size:13px;">' +
      this.esc(t) + '</p>').join('');
    p.innerHTML =
      '<div class="confirm-box" style="width:560px;max-width:92vw;">' +
        /* 内容区固定高度 + 滚动条：窗口不再随文案变高（2026-10-29 用户口径）。
           滚动条沿用全局 ::-webkit-scrollbar 样式（10px，主题色滑块）。 */
        '<div style="max-height:240px;overflow-y:auto;border:1px solid var(--btn-border);border-radius:10px;padding:8px 10px;">' + paras + '</div>' +
        '<div class="anchor-btns"><button class="helphint-ok">确认</button></div>' +
      '</div>';
    document.body.appendChild(p);
    /* 点遮罩：不关（用户口径：只有「确认」能关） */
    p.addEventListener('click', e => { if (e.target === p) e.stopPropagation(); });
    p.querySelector('.helphint-ok').addEventListener('click', () => this.confirm());
    this.el = p;
    return p;
  },

  /* 启动时调用：没确认过才弹 */
  check() {
    if (!App.settings) return false;
    if (App.settings.helpHintAck === true) return false;
    return this.open();
  },

  open() {
    const p = this.build();
    App.showOverlay(p);
    /* 窗口开着时 Esc 一律吃掉：既不关窗，也不穿透去退编辑/清选择 */
    if (!this._esc) {
      this._esc = e => {
        if (e.key === 'Escape' && this.isOpen()) { e.stopPropagation(); e.preventDefault(); }
      };
      document.addEventListener('keydown', this._esc, true);
    }
    return true;
  },

  /* 确认：写入标记并落盘，然后关窗。此后任何版本更新都不再弹。 */
  confirm() {
    if (App.settings) {
      App.settings.helpHintAck = true;
      try { App.settings.save(); } catch (e) { /* 保存失败也不阻塞用户 */ }
    }
    this.close();
    return true;
  },

  close() {
    if (this.el) App.hideOverlay(this.el);
    if (this._esc) { document.removeEventListener('keydown', this._esc, true); this._esc = null; }
    return true;
  },

  isOpen() {
    return !!(this.el && this.el.isConnected && !this.el.classList.contains('hidden'));
  }
};
