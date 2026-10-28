'use strict';
/* SVG 文件收藏（2026-10-29 从 klara 版移植，只搬收藏，功能与源码逻辑未改）。
   · 收藏对象 = SVGImages 目录里的文件名（与主页「SVG图像」分类同一套名字）
   · 持久化走 settings.json 的 favorites 字段（preload 的 settingsGet/settingsSet），
     localStorage 作双保险（与 App.settings 同一口径：API 不可用时仍有记忆）
   · 任何一处改动收藏，都会广播给所有订阅者 → 主页收藏页签与操作条按钮立刻同步 */
(function () {
  var LS_KEY = 'sve-favorites';
  var listeners = [];

  /* 只收「非空字符串」，去重、去空白：坏值不许进收藏表（与设置里其它项的校验口径一致） */
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
      /* 主通道没给出收藏时，退回 localStorage（API 不可用的环境） */
      if (!next.length && !Array.isArray(saved)) {
        try { next = sanitize(JSON.parse(localStorage.getItem(LS_KEY) || '[]')); } catch (e) { /* ignore */ }
      }
      this.list = next;
      this.emit();
      return this.list;
    },

    has: function (name) { return this.list.indexOf(String(name)) >= 0; },

    count: function () { return this.list.length; },

    /* 切换收藏；返回切换后的状态（true = 已收藏），方便调用方提示 */
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

    /* 落盘：localStorage 立即写；settings.json 交给 App.settings.save()（它会把 favorites 一起带上） */
    persist: function () {
      try { localStorage.setItem(LS_KEY, JSON.stringify(this.list)); } catch (e) { /* ignore */ }
      if (App.settings && App.settings.save) {
        var p = App.settings.save();
        if (p && p.then) p.then(function (r) {
          if (r && r.ok === false) console.warn('[favorites] 写入 settings.json 失败：' + r.error);
        });
      }
    },

    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },

    /* 广播：某个订阅者抛错不能拖垮其它订阅者（与 App.i18n 的重刷器同一纪律） */
    emit: function () {
      var list = this.list.slice();
      listeners.forEach(function (fn) {
        try { fn(list); } catch (e) { console.warn('[favorites] 订阅者异常', e); }
      });
    }
  };
})();
