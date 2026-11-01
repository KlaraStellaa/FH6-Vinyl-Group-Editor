'use strict';

App.fonts = {
  DEFAULT_ID: 'default',
  list: [],
  current: 'default',
  _lastLang: null,

  
  supported() {
    const l = String((App.settings && App.settings.lang) || 'zh-CN');
    return l.indexOf('zh') === 0;
  },
  currentFamily() {
    if (this.current === this.DEFAULT_ID) return App.i18n.t('font.default');
    const it = this.list.find(x => x.id === this.current);
    return it ? it.family : App.i18n.t('font.default');
  },

  load(saved) {
    const f = saved && saved.font;
    this.list = (f && Array.isArray(f.list) ? f.list : [])
      .filter(x => x && typeof x.id === 'string' && typeof x.file === 'string')
      .map(x => ({ id: x.id, file: x.file, family: String(x.family || x.file) }));
    const cur = f && f.current;
    this.current = (cur && cur !== this.DEFAULT_ID && this.list.some(x => x.id === cur)) ? cur : this.DEFAULT_ID;
    this._lastLang = (App.settings && App.settings.lang) || 'zh-CN';
    this.apply();
    return this;
  },
  payload() {
    return {
      current: this.current,
      list: this.list.map(x => ({ id: x.id, file: x.file, family: x.family }))
    };
  },

  
  apply() {
    const root = document.documentElement;
    let style = document.getElementById('sveUiFont');
    const it = this.current !== this.DEFAULT_ID ? this.list.find(x => x.id === this.current) : null;
    if (!it) {
      if (style) style.textContent = '';
      root.style.removeProperty('--ui-font');
      return;
    }
    if (!style) {
      style = document.createElement('style');
      style.id = 'sveUiFont';
      document.head.appendChild(style);
    }
    
    style.textContent =
      "@font-face{font-family:'SVEUI';src:url('app://fonts/" + encodeURIComponent(it.file) + "');font-display:swap;}";
    root.style.setProperty('--ui-font', "'SVEUI', 'Microsoft YaHei', system-ui, sans-serif");
    try { if (document.fonts && document.fonts.load) document.fonts.load("12px 'SVEUI'"); } catch (e) {  }
  },

  setCurrent(id, opts) {
    const next = (id && id !== this.DEFAULT_ID && this.list.some(x => x.id === id)) ? id : this.DEFAULT_ID;
    this.current = next;
    this.apply();
    this.render();      
    this.syncPanel();
    if (!opts || opts.save !== false) App.settings.save();
  },

  
  syncPanel() {
    const row = document.getElementById('settingsFontRow');
    const btn = document.getElementById('btnFont');
    const ok = this.supported();
    
    const lab = row && row.querySelector('label');
    if (lab) lab.textContent = App.i18n.t('settings.font');
    if (btn) {
      btn.disabled = !ok;
      btn.classList.toggle('disabled', !ok);
    }
    if (row) row.classList.toggle('disabled', !ok);
  },

  
  open() {
    if (!this.supported()) return false;
    const box = document.getElementById('settingsPanel');
    if (!box) return false;
    const el = this.buildView();
    const main = box.querySelector('#settingsMainView');
    const key = box.querySelector('#settingsKeyView');
    const tv = box.querySelector('#settingsThemeView');
    const title = box.querySelector('#settingsTitle');
    if (main) main.classList.add('hidden');
    if (key) key.classList.add('hidden');
    if (tv) tv.classList.add('hidden');
    if (el) el.classList.remove('hidden');
    const cb = box.querySelector('.confirm-box');
    if (cb) cb.classList.add('ft-mode');
    if (title) { title.setAttribute('data-i18n', 'font.title'); title.textContent = App.i18n.t('font.title'); }
    
    App.attachDlgClose(cb, () => { App.hideOverlay(box); return true; });
    this.render();
    return true;
  },
  buildView() {
    let el = document.getElementById('settingsFontView');
    if (el && el.dataset.built === '1') return el;
    const host = document.querySelector('#settingsPanel .confirm-box');
    if (!host) return null;
    if (!el) {
      el = document.createElement('div');
      el.id = 'settingsFontView';
      el.className = 'hidden';
      host.appendChild(el);
    }
    el.innerHTML =
      '<div class="ft-scroll" id="ftList"></div>' +
      '<div class="ft-foot">' +
        '<button id="ftDownload" data-i18n="font.download"></button>' +
        '<span class="ft-spacer"></span>' +
        '<button id="ftImport" data-i18n="font.import"></button>' +
        '<button id="ftConfirm" data-i18n="font.confirm"></button>' +
      '</div>';
    el.dataset.built = '1';
    
    if (App.i18n && App.i18n.apply) App.i18n.apply(el);
    el.querySelector('#ftDownload').addEventListener('click', () => {
      if (window.sveApi && window.sveApi.fontOpenDownload) window.sveApi.fontOpenDownload();
    });
    el.querySelector('#ftImport').addEventListener('click', () => this.doImport());
    el.querySelector('#ftConfirm').addEventListener('click', () => {
      const box = document.getElementById('settingsPanel');
      if (box) App.hideOverlay(box);
    });
    return el;
  },
  render() {
    const el = document.getElementById('settingsFontView');
    const list = el && el.querySelector('#ftList');
    if (!list) return;
    const rows = [];
    rows.push(this.rowHtml(this.DEFAULT_ID, App.i18n.t('font.default'), this.current === this.DEFAULT_ID));
    this.list.forEach(it => {
      rows.push(this.rowHtml(it.id, it.family, this.current === it.id));
    });
    list.innerHTML = rows.join('') +
      (this.list.length ? '' : '<div class="ft-empty" data-i18n="font.empty">' + App.i18n.t('font.empty') + '</div>');
    list.querySelectorAll('.ft-row').forEach(r => {
      const id = r.getAttribute('data-id');
      r.addEventListener('click', () => this.setCurrent(id));
      const del = r.querySelector('.ft-del');
      if (del) del.addEventListener('click', ev => {
        ev.stopPropagation();
        this.confirmDelete(id);
      });
    });
  },
  rowHtml(id, name, isCurrent) {
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    
    const del = (id === this.DEFAULT_ID || isCurrent) ? '' : '<button class="ft-del" type="button" aria-label="×">×</button>';
    return '<div class="ft-row' + (isCurrent ? ' active' : '') + '" data-id="' + esc(id) + '"' +
      (isCurrent ? ' data-current="1"' : '') + '>' +
      '<span class="ft-name">' + esc(name) + '</span>' + del + '</div>';
  },

  
  confirmDelete(id) {
    const it = this.list.find(x => x.id === id);
    if (!it) return;
    const ov = document.createElement('div');
    ov.className = 'confirm-overlay';
    ov.id = 'fontDelOv';
    ov.innerHTML =
      '<div class="confirm-box font-del-box">' +
        '<div class="anchor-title">' + App.i18n.t('font.deleteTitle') + '</div>' +
        '<div class="ft-del-msg">' + App.i18n.t('font.deleteMsg').replace('{v}', it.family) + '</div>' +
        '<div class="anchor-btns">' +
          '<button id="ftDelYes">' + App.i18n.t('font.yes') + '</button>' +
          '<button id="ftDelNo">' + App.i18n.t('font.no') + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    const close = () => { if (ov.isConnected) ov.remove(); };
    ov.querySelector('#ftDelNo').addEventListener('click', close);
    ov.querySelector('#ftDelYes').addEventListener('click', () => {
      close();
      this.doDelete(id);
    });
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    ov.querySelector('#ftDelYes').focus();
  },
  doDelete(id) {
    const idx = this.list.findIndex(x => x.id === id);
    if (idx < 0) return;
    const it = this.list[idx];
    if (window.sveApi && window.sveApi.fontDelete) {
      window.sveApi.fontDelete(it.file).then(r => {
        if (r && r.ok === false) console.warn('[font] 删除失败', r.error);
      }).catch(e => console.warn('[font] 删除异常', e));
    }
    this.list.splice(idx, 1);
    if (this.current === id) this.current = this.DEFAULT_ID;
    this.apply();
    this.render();
    this.syncPanel();
    App.settings.save();
  },
  doImport() {
    if (!window.sveApi || !window.sveApi.fontImport) return;
    window.sveApi.fontImport().then(r => {
      if (!r || r.ok === false) {
        if (r && !r.canceled) showToast(App.i18n.t('font.importFail'));
        return;
      }
      (r.items || []).forEach(it => {
        if (!it || !it.id || !it.file) return;
        this.list.push({ id: it.id, file: it.file, family: String(it.family || it.file) });
      });
      this.render();
      App.settings.save();
      showToast(App.i18n.t('font.imported').replace('{v}', String((r.items || []).length)));
    }).catch(e => {
      console.warn('[font] 导入异常', e);
      showToast(App.i18n.t('font.importFail'));
    });
  },

  
  onLangChanged() {
    const lang = String((App.settings && App.settings.lang) || 'zh-CN');
    const prev = this._lastLang || lang;
    this._lastLang = lang;
    const zh = s => String(s).indexOf('zh') === 0;
    if (zh(lang) && zh(prev)) { this.syncPanel(); return; }
    if (this.current !== this.DEFAULT_ID) {
      this.current = this.DEFAULT_ID;
      this.apply();
      App.settings.save();
    }
    this.syncPanel();
    if (App.fonts && App.fonts.render && document.getElementById('settingsFontView')) this.render();
  }
};


if (App.i18n && App.i18n.onApply) {
  App.i18n.onApply(function () {
    if (!App.fonts) return;
    App.fonts.onLangChanged();
  });
}
