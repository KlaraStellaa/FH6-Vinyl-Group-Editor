'use strict';


App.RefWindow = {
  el: null,
  img: null,
  _drag: null,
  _raf: 0,
  _rect: null,
  MIN_W: 160,
  MIN_H: 120,

  
  async pick() {
    let r = null;
    try { r = await window.sveApi.openImageDialog(); }
    catch (e) {
      showToast(App.i18n.tf('toast.io.openImageFail', { v: String((e && e.message) || e) }));
      return;
    }
    if (typeof blurActiveButton === 'function') blurActiveButton();
    if (r && r.canceled) {
      if (r.error) showToast(App.i18n.tf('toast.io.openImageFail', { v: r.error }));
      return;
    }
    if (!r || !r.dataUrl) return;
    this.show(r.dataUrl);
  },

  build() {
    if (this.el) return this.el;
    const win = document.createElement('div');
    win.id = 'refWin';
    win.className = 'rw-win hidden';
    win.innerHTML =
      '<div class="rw-body"><img class="rw-img" alt=""></div>' +
      '<button class="rw-x" type="button"></button>' +
      '<i class="rw-h" data-d="n"></i><i class="rw-h" data-d="s"></i>' +
      '<i class="rw-h" data-d="w"></i><i class="rw-h" data-d="e"></i>' +
      '<i class="rw-h" data-d="nw"></i><i class="rw-h" data-d="ne"></i>' +
      '<i class="rw-h" data-d="sw"></i><i class="rw-h" data-d="se"></i>';
    document.body.appendChild(win);
    this.el = win;
    this.img = win.querySelector('.rw-img');

    win.querySelector('.rw-x').addEventListener('click', e => {
      e.stopPropagation();
      this.hide();
    });

    
    win.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      if (e.target.closest('.rw-x') || e.target.closest('.rw-h')) return;
      const b = win.getBoundingClientRect();
      this._drag = { mode: 'move', px: e.clientX, py: e.clientY, l: b.left, t: b.top, w: b.width, h: b.height };
      win.classList.add('rw-dragging');
      try { win.setPointerCapture(e.pointerId); } catch (err) {  }
      e.preventDefault();
    });

    
    win.querySelectorAll('.rw-h').forEach(h => {
      h.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        e.stopPropagation();
        const b = win.getBoundingClientRect();
        this._drag = {
          mode: 'resize', dir: h.getAttribute('data-d'),
          px: e.clientX, py: e.clientY, l: b.left, t: b.top, w: b.width, h: b.height
        };
        win.classList.add('rw-dragging');
        try { win.setPointerCapture(e.pointerId); } catch (err) {  }
        e.preventDefault();
      });
    });

    document.addEventListener('pointermove', e => this.onMove(e));
    document.addEventListener('pointerup', () => this.endDrag());
    document.addEventListener('pointercancel', () => this.endDrag());
    
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.el && !this.el.classList.contains('hidden')) {
        this.hide();
      }
    });

    
    if (App.i18n && App.i18n.onApply) App.i18n.onApply(() => this.syncText());
    this.syncText();
    return win;
  },

  syncText() {
    if (!this.el) return;
    const b = this.el.querySelector('.rw-x');
    b.title = App.i18n.t('refwin.close');
    b.setAttribute('aria-label', App.i18n.t('refwin.close'));
  },

  show(dataUrl) {
    const win = this.build();
    this.img.src = dataUrl;
    win.classList.remove('hidden');
    this.syncText();
    
    const sizeToImage = () => {
      if (this._rect) return;                 
      const iw = this.img.naturalWidth || 4, ih = this.img.naturalHeight || 3;
      const maxW = Math.min(560, Math.max(220, Math.round(window.innerWidth * 0.44)));
      const maxH = Math.min(460, Math.max(180, Math.round(window.innerHeight * 0.52)));
      const k = Math.min(maxW / iw, maxH / ih);
      const w = Math.max(this.MIN_W, Math.round(iw * k));
      const h = Math.max(this.MIN_H, Math.round(ih * k));
      const left = Math.max(12, window.innerWidth - w - 76);
      const top = Math.max(72, Math.min(140, Math.round(window.innerHeight * 0.12)));
      this.applyRect(left, top, w, h);
    };
    if (this.img.complete && this.img.naturalWidth) sizeToImage();
    else this.img.addEventListener('load', sizeToImage, { once: true });
  },

  hide() {
    if (!this.el) return;
    this.el.classList.add('hidden');
    this.el.classList.remove('rw-dragging');
    this._drag = null;
  },

  
  applyRect(l, t, w, h) {
    const win = this.el;
    if (!win) return;
    win.style.left = Math.round(l) + 'px';
    win.style.top = Math.round(t) + 'px';
    win.style.width = Math.round(w) + 'px';
    win.style.height = Math.round(h) + 'px';
    this._rect = { l, t, w, h };
  },

  onMove(e) {
    const d = this._drag;
    if (!d || !this.el) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    let l = d.l, t = d.t, w = d.w, h = d.h;

    if (d.mode === 'move') {
      l = Math.min(Math.max(0, d.l + dx), Math.max(0, window.innerWidth - d.w));
      t = Math.min(Math.max(0, d.t + dy), Math.max(0, window.innerHeight - d.h));
    } else {
      const dir = d.dir || '';
      if (dir.indexOf('e') >= 0) w = d.w + dx;
      if (dir.indexOf('s') >= 0) h = d.h + dy;
      if (dir.indexOf('w') >= 0) { w = d.w - dx; l = d.l + dx; }
      if (dir.indexOf('n') >= 0) { h = d.h - dy; t = d.t + dy; }
      
      if (w < this.MIN_W) {
        if (dir.indexOf('w') >= 0) l = d.l + d.w - this.MIN_W;
        w = this.MIN_W;
      }
      if (h < this.MIN_H) {
        if (dir.indexOf('n') >= 0) t = d.t + d.h - this.MIN_H;
        h = this.MIN_H;
      }
      
      l = Math.min(Math.max(0, l), Math.max(0, window.innerWidth - w));
      t = Math.min(Math.max(0, t), Math.max(0, window.innerHeight - h));
      w = Math.min(w, window.innerWidth);
      h = Math.min(h, window.innerHeight);
    }

    
    const next = { l, t, w, h };
    this._pending = next;
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      const p = this._pending;
      if (p) this.applyRect(p.l, p.t, p.w, p.h);
    });
  },

  endDrag() {
    if (!this._drag) return;
    this._drag = null;
    if (this.el) this.el.classList.remove('rw-dragging');
  }
};


(function () {
  const bind = () => {
    const btn = document.getElementById('btnRefWin');
    if (!btn || btn.getAttribute('data-wired')) return;
    btn.setAttribute('data-wired', '1');
    btn.addEventListener('click', () => App.RefWindow.pick());
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
