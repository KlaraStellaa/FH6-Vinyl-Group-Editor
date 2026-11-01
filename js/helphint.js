'use strict';

App.helpHint = {
  el: null,
  
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
        
        '<div class="helphint-contact">QQ：1074132460   X：@KlaraStellak</div>' +
        
        '<div style="max-height:240px;overflow-y:auto;border:1px solid var(--btn-border);border-radius:10px;padding:8px 10px;">' + paras + '</div>' +
        '<div class="anchor-btns"><button class="helphint-ok">确认</button></div>' +
      '</div>';
    document.body.appendChild(p);
    
    p.addEventListener('click', e => { if (e.target === p) e.stopPropagation(); });
    p.querySelector('.helphint-ok').addEventListener('click', () => this.confirm());
    this.el = p;
    return p;
  },

  
  check() {
    if (!App.settings) return false;
    if (App.settings.helpHintAck === true) return false;
    return this.open();
  },

  open() {
    const p = this.build();
    App.showOverlay(p);
    
    if (!this._esc) {
      this._esc = e => {
        if (e.key === 'Escape' && this.isOpen()) { e.stopPropagation(); e.preventDefault(); }
      };
      document.addEventListener('keydown', this._esc, true);
    }
    return true;
  },

  
  confirm() {
    if (App.settings) {
      App.settings.helpHintAck = true;
      try { App.settings.save(); } catch (e) {  }
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
