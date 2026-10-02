'use strict';

(function () {
  const ICONS = {
    minimize: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4.5 12.75a.75.75 0 0 1 0-1.5h15a.75.75 0 0 1 0 1.5h-15Z" fill="currentColor"/></svg>',
    maximize: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6.25 4.5h11.5A1.75 1.75 0 0 1 19.5 6.25v11.5a1.75 1.75 0 0 1-1.75 1.75H6.25a1.75 1.75 0 0 1-1.75-1.75V6.25A1.75 1.75 0 0 1 6.25 4.5Zm11.5 1.5H6.25a.25.25 0 0 0-.25.25v11.5c0 .138.112.25.25.25h11.5a.25.25 0 0 0 .25-.25V6.25a.25.25 0 0 0-.25-.25Z" fill="currentColor"/></svg>',
    restore: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7.5 5.75A2.75 2.75 0 0 1 10.25 3h7A3.75 3.75 0 0 1 21 6.75v7a2.75 2.75 0 0 1-2.75 2.75v.25a3.25 3.25 0 0 1-3.25 3.25h-7A4.25 4.25 0 0 1 3.75 15.5v-7A3.75 3.75 0 0 1 7.5 4.75V5.75Zm1.5.25v8.25a.25.25 0 0 1-.25.25H5.25v6.5A2.75 2.75 0 0 0 8 18.25h6.75v-6.5a.25.25 0 0 1-.25-.25V6H10.25a.25.25 0 0 0-.25.25Zm2.75 8h6.5a.25.25 0 0 0 .25-.25v-7A2.25 2.25 0 0 0 16.25 4.5h-6.5v7c0 .69-.56 1.25-1.25 1.25h-.25v1.25c0 .138.112.25.25.25h.25Z" fill="currentColor"/></svg>',
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

      const drag = this.box.querySelector('.titlebar-drag');
      if (drag) {
        drag.addEventListener('dblclick', e => {
          if (e.target.closest && e.target.closest('.titlebar-btn, button')) return;
          e.preventDefault();
          this.act('toggle-maximize');
        });
      }

      this.renderLabels();
      if (window.sveApi && typeof window.sveApi.windowStateGet === 'function') {
        window.sveApi.windowStateGet().then(r => {
          if (r && r.ok) this.applyState(r);
        }).catch(() => { });
      }
      if (this.unsub) { try { this.unsub(); } catch (e) { /* ignore */ } this.unsub = null; }
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
