'use strict';

(function () {
  const ICONS = {
    minimize: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4.5 12.75a.75.75 0 0 1 0-1.5h15a.75.75 0 0 1 0 1.5h-15Z" fill="currentColor"/></svg>',
    maximize: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6.25 4.5h11.5A1.75 1.75 0 0 1 19.5 6.25v11.5a1.75 1.75 0 0 1-1.75 1.75H6.25a1.75 1.75 0 0 1-1.75-1.75V6.25A1.75 1.75 0 0 1 6.25 4.5Zm11.5 1.5H6.25a.25.25 0 0 0-.25.25v11.5c0 .138.112.25.25.25h11.5a.25.25 0 0 0 .25-.25V6.25a.25.25 0 0 0-.25-.25Z" fill="currentColor"/></svg>',
    restore: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M17.999 8.946Q17.999 8.338 17.757 7.8Q17.515 7.261 17.101 6.862Q16.688 6.463 16.142 6.232Q15.596 6.001 14.996 6.001L7.627 6.001Q7.745 5.665 7.957 5.386Q8.169 5.108 8.448 4.91Q8.726 4.712 9.059 4.606Q9.393 4.5 9.751 4.5L14.996 4.5Q15.926 4.5 16.746 4.855Q17.566 5.21 18.178 5.818Q18.79 6.426 19.145 7.247Q19.5 8.067 19.5 8.997L19.5 14.249Q19.5 14.607 19.394 14.941Q19.288 15.274 19.09 15.552Q18.892 15.831 18.614 16.043Q18.335 16.255 17.999 16.373L17.999 8.946ZM6.712 19.5Q6.272 19.5 5.87 19.321Q5.467 19.141 5.163 18.837Q4.859 18.533 4.679 18.13Q4.5 17.728 4.5 17.288L4.5 9.715Q4.5 9.268 4.679 8.869Q4.859 8.47 5.163 8.166Q5.467 7.862 5.866 7.682Q6.265 7.503 6.712 7.503L14.285 7.503Q14.732 7.503 15.135 7.682Q15.538 7.862 15.838 8.162Q16.138 8.462 16.318 8.865Q16.497 9.268 16.497 9.715L16.497 17.288Q16.497 17.735 16.318 18.134Q16.138 18.533 15.834 18.837Q15.53 19.141 15.131 19.321Q14.732 19.5 14.285 19.5L6.712 19.5ZM14.249 17.999Q14.402 17.999 14.538 17.94Q14.673 17.881 14.78 17.779Q14.886 17.676 14.944 17.541Q15.003 17.405 15.003 17.251L15.003 9.751Q15.003 9.598 14.944 9.458Q14.886 9.319 14.783 9.217Q14.681 9.114 14.542 9.056Q14.402 8.997 14.249 8.997L6.749 8.997Q6.595 8.997 6.459 9.056Q6.324 9.114 6.221 9.22Q6.119 9.327 6.06 9.462Q6.001 9.598 6.001 9.751L6.001 17.251Q6.001 17.405 6.06 17.541Q6.119 17.676 6.221 17.779Q6.324 17.881 6.459 17.94Q6.595 17.999 6.749 17.999L14.249 17.999Z" fill="currentColor"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4.397 4.554a.75.75 0 0 1 1.06 0L12 11.1l6.545-6.546a.75.75 0 1 1 1.06 1.06L13.06 12.16l6.546 6.545a.75.75 0 0 1-1.06 1.06L12 13.22l-6.545 6.545a.75.75 0 0 1-1.06-1.06l6.545-6.546-6.545-6.545a.75.75 0 0 1 0-1.06Z" fill="currentColor"/></svg>'
  };

  App.TitleBar = {
    box: null,
    btnMax: null,
    unsub: null,
    _maximized: false,

    title() {
      const t = document.querySelector('head > title');
      const s = t ? String(t.textContent || '').trim() : '';
      return s || 'FH6 Vinyl Group Editor';
    },

    renderMaxBtn() {
      const b = this.btnMax;
      if (!b) return;
      const isMax = !!this._maximized;
      const key = isMax ? 'win.restore' : 'win.maximize';
      const label = App.i18n.t(key);
      b.innerHTML = isMax ? ICONS.restore : ICONS.maximize;
      b.setAttribute('aria-label', label);
      b.setAttribute('title', label);
      b.setAttribute('data-i18n-attr', 'aria-label');
      b.setAttribute('data-i18n', key);
      b.setAttribute('data-max', isMax ? '1' : '0');
      b.setAttribute('aria-pressed', isMax ? 'true' : 'false');
    },

    applyState(st) {
      if (!st) return;
      this._maximized = !!st.maximized;
      this.renderMaxBtn();
      if (this.box) this.box.classList.toggle('sve-inactive', st.focused === false);
    },

    renderLabels() {
      const set = (el, key) => {
        if (!el) return;
        const v = App.i18n.t(key);
        el.setAttribute('aria-label', v);
        el.setAttribute('title', v);
        el.setAttribute('data-i18n', key);
        el.setAttribute('data-i18n-attr', 'aria-label');
      };
      const paint = (el, svg) => { if (el) el.innerHTML = svg; };
      paint(document.getElementById('winMin'), ICONS.minimize);
      paint(document.getElementById('winClose'), ICONS.close);
      set(document.getElementById('winMin'), 'win.minimize');
      set(document.getElementById('winMax'), 'win.maximize');
      set(document.getElementById('winClose'), 'win.close');
      this.renderMaxBtn();
      const host = document.getElementById('titleBarTitle');
      if (host) host.textContent = this.title();
    },

    async act(action) {
      if (!window.sveApi || typeof window.sveApi.windowControl !== 'function') return false;
      try {
        const r = await window.sveApi.windowControl(action);
        if (r && typeof r.maximized === 'boolean') {
          this._maximized = r.maximized;
          this.renderMaxBtn();
        }
        return !!(r && r.ok);
      } catch (e) {
        console.warn('[titlebar] 窗口操作失败', action, String(e && e.message || e).slice(0, 160));
        return false;
      }
    },

    build() {
      this.box = document.getElementById('titleBar');
      if (!this.box) return false;
      this.btnMax = document.getElementById('winMax');

      const bind = (id, action) => {
        const b = document.getElementById(id);
        if (!b) return;
        b.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          this.act(action);
        });
        b.addEventListener('dblclick', e => { e.preventDefault(); e.stopPropagation(); });
      };
      bind('winMin', 'minimize');
      bind('winMax', 'toggle-maximize');
      bind('winClose', 'close');


      this.renderLabels();
      if (window.sveApi && typeof window.sveApi.windowStateGet === 'function') {
        window.sveApi.windowStateGet().then(r => {
          if (r && r.ok) this.applyState(r);
        }).catch(() => { });
      }
      if (this.unsub) { try { this.unsub(); } catch (e) {   } this.unsub = null; }
      if (window.sveApi && typeof window.sveApi.onWindowState === 'function') {
        this.unsub = window.sveApi.onWindowState(st => this.applyState(st));
      }

      if (App.i18n && App.i18n.onApply) App.i18n.onApply(() => this.renderLabels());
      return true;
    }
  };

  if (!App.TitleBar.build()) {
    document.addEventListener('DOMContentLoaded', () => App.TitleBar.build(), { once: true });
  }
})();
