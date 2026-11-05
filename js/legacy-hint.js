'use strict';


App.skewMode = 'v2';   

App.SkewMode = {
  isLegacy() { return App.skewMode === '132'; },

  
  set(mode) {
    App.skewMode = (mode === '132') ? '132' : 'v2';
    if (App.Tabs && App.Tabs.current) App.Tabs.current.skewMode = App.skewMode;
    return App.skewMode;
  },

  
  refreshTransforms() {
    const walk = l => {
      if (!l) return;
      if (l.el && l.kind !== 'bg' && App.applyLayerTransform) App.applyLayerTransform(l);
      if (l.children && l.children.length) l.children.forEach(walk);
    };
    (App.state.layers || []).forEach(walk);
    if (App.state.bg.image && App.applyBgTransform) App.applyBgTransform(App.state.bg.image);
    if (App.drawOutlines) App.drawOutlines();
    if (App.refreshLayerThumbs) App.refreshLayerThumbs();
    if (App.requestFlashRefresh) App.requestFlashRefresh(false);
  }
};

App.LegacyHint = {
  el: null,
  pending: null,     

  
  build() {
    if (this.el) return this.el;
    const host = document.getElementById('canvasWrap') || document.body;
    const box = document.createElement('div');
    box.id = 'legacyHint';
    box.className = 'lh-card hidden';
    box.setAttribute('role', 'dialog');
    box.innerHTML =
      '<button class="lh-x" type="button"></button>' +
      '<div class="lh-title"></div>' +
      '<div class="lh-sub"></div>' +
      '<div class="lh-foot">' +
      '<label class="lh-ack"><input type="checkbox"><span class="lh-box"></span><span class="lh-ack-txt"></span></label>' +
      '<button class="lh-btn" type="button"></button>' +
      '</div>';
    host.appendChild(box);
    this.el = box;

    box.querySelector('.lh-x').addEventListener('click', () => this.hide());
    box.querySelector('.lh-btn').addEventListener('click', () => this.change());
    const cb = box.querySelector('.lh-ack input');
    cb.addEventListener('change', () => this.ack(cb.checked));

    this.syncText();
    
    if (App.i18n && App.i18n.onApply) App.i18n.onApply(() => this.syncText());
    return box;
  },

  syncText() {
    if (!this.el) return;
    const T = k => App.i18n.t(k);
    this.el.querySelector('.lh-x').setAttribute('aria-label', T('legacy.close'));
    this.el.querySelector('.lh-x').title = T('legacy.close');
    this.el.querySelector('.lh-title').textContent = T('legacy.title');
    this.el.querySelector('.lh-sub').textContent = T('legacy.sub');
    this.el.querySelector('.lh-ack-txt').textContent = T('legacy.noPrompt');
    this.el.querySelector('.lh-btn').textContent = T('legacy.change');
  },

  
  
  maybeShow(info) {
    if (!info || !info.content) return;
    if (App.settings && App.settings.legacyHintAck) return;
    if (App.Tabs && App.Tabs.testMode) return;      
    if (App.skewMode === '132') return;             
    this.pending = info;
    this.build();
    this.syncText();
    this.el.classList.remove('hidden');
    
    this.el.classList.remove('lh-in');
    void this.el.offsetWidth;
    this.el.classList.add('lh-in');
  },

  hide() {
    if (this.el) this.el.classList.add('hidden');
  },

  
  
  change() {
    const info = this.pending;
    this.hide();
    if (!info) return;
    App.SkewMode.set('132');
    
    if (App.openWorkCopyContent) {
      App.openWorkCopyContent(info.content, info.name, info.source, info.mtimeMs, { legacy: true, silentHint: true });
    }
  },

  
  ack(on) {
    if (!on) return;
    if (App.settings) {
      App.settings.legacyHintAck = true;
      try { App.settings.save(); } catch (e) {  }
    }
    this.hide();
  },

  
  markLegacy() { App.SkewMode.set('132'); }
};

(function () {
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {  });
  }
})();
