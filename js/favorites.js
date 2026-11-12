'use strict';
(function () {
  var LS_KEY = 'sve-favorites';
  var listeners = [];

  function sanitize(v) {
    if (!Array.isArray(v)) return [];
    var out = [];
    v.forEach(function (n) {
      if (typeof n !== 'string') return;
      var s = n.trim();
      if (!s || out.indexOf(s) >= 0) return;
      out.push(s);
    });
    return out;
  }

  App.Favorites = {
    list: [],

    load: function (saved) {
      var next = sanitize(saved);
      if (!next.length && !Array.isArray(saved)) {
        try { next = sanitize(JSON.parse(localStorage.getItem(LS_KEY) || '[]')); } catch (e) {   }
      }
      this.list = next;
      this.emit();
      return this.list;
    },

    has: function (name) { return this.list.indexOf(String(name)) >= 0; },

    count: function () { return this.list.length; },

    toggle: function (name) {
      var s = String(name || '').trim();
      if (!s) return false;
      var i = this.list.indexOf(s);
      var on;
      if (i >= 0) { this.list.splice(i, 1); on = false; }
      else { this.list.push(s); on = true; }
      this.persist();
      this.emit();
      return on;
    },

    remove: function (name) {
      var i = this.list.indexOf(String(name));
      if (i < 0) return false;
      this.list.splice(i, 1);
      this.persist();
      this.emit();
      return true;
    },

    payload: function () { return this.list.slice(); },

    persist: function () {
      try { localStorage.setItem(LS_KEY, JSON.stringify(this.list)); } catch (e) {   }
      if (App.settings && App.settings.save) {
        var p = App.settings.save();
        if (p && p.then) p.then(function (r) {
          if (r && r.ok === false) console.warn('[favorites] 写入 settings.json 失败：' + r.error);
        });
      }
    },

    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },

    emit: function () {
      var list = this.list.slice();
      listeners.forEach(function (fn) {
        try { fn(list); } catch (e) { console.warn('[favorites] 订阅者异常', e); }
      });
    }
  };
})();
