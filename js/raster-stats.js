'use strict';
(function () {
  if (window.__rasterStatsInstalled) return;
  window.__rasterStatsInstalled = true;

  const MAX_EVICT_MEM = 2048;     
  const MAX_EVENTS = 400;         

  function mkPool() {
    return {
      req: 0, first: 0, hit: 0, tooSmall: 0, evicted: 0, inflight: 0,
      skip1: 0, reject: 0, drop: 0, put: 0, putUpgrade: 0,
      evictCount: 0, evictPx: 0, evictWastePx: 0,
      avoidable: 0, avoidableMs: 0, redraw: 0, redrawMs: 0,
      px: 0, peakPx: 0, items: 0, peakItems: 0, inflightPeak: 0,
    };
  }

  const S = {
    on: false,
    t0: (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    pools: { vec: mkPool(), use: mkPool() },
    alias: { vec: new Map(), use: new Map() },
    aliasSeq: { vec: 0, use: 0 },
    evictedMem: new Map(),       
    inflight: new Map(),         
    events: [],
    budgets: { vec: 0, use: 0 },
    marks: [],
  };
  App.rasterStats = S;

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const P = n => S.pools[n];

  S.aliasOf = function (pool, key) {
    const m = S.alias[pool];
    let a = m.get(key);
    if (!a) {
      a = (pool === 'vec' ? 'V' : 'U') + (++S.aliasSeq[pool]);
      m.set(key, a);
    }
    return a;
  };

  S.setEnabled = function (on) {
    S.on = !!on;
    if (!S.on) { S.evictedMem.clear(); S.inflight.clear(); S.events.length = 0; }
    return S.on;
  };

  S.setBudget = function (pool, px) {
    const v = Math.max(0, Math.round(Number(px) || 0));
    if (pool === 'vec') { App._bakeVecRasterBudget = v; S.budgets.vec = v; }
    else if (pool === 'use') { App._bakeUseRasterBudget = v; S.budgets.use = v; }
    return v;
  };
  S.readBudgets = function () {
    S.budgets.vec = App._bakeVecRasterBudget;
    S.budgets.use = App._bakeUseRasterBudget;
    return { vec: S.budgets.vec, use: S.budgets.use };
  };

  const push = function (ev) {
    if (!S.on) return;
    if (S.events.length >= MAX_EVENTS) S.events.shift();
    S.events.push(ev);
  };

  S.verdict = function (pool, key, hitOk, want, meta) {
    if (!S.on) return null;
    const p = P(pool);
    p.req++;
    const alias = S.aliasOf(pool, key);
    if (S.inflight.has(key) && !hitOk) { p.inflight++; return { cls: 'inflight', alias }; }

    if (hitOk) {
      p.hit++;
      return { cls: 'hit', alias };
    }
    const gone = S.evictedMem.get(key);
    const avoidable = !!(gone && (pool === 'use' || (Number(gone.side) || 0) >= (Number(want) || 0)));
    if (avoidable) {
      p.evicted++;
      p.avoidable++;
      push({ t: Math.round(now() - S.t0), ev: 'avoidable', pool, alias, want, side: gone.side, px: gone.px, gap: Math.round(now() - gone.t) });
      S.evictedMem.delete(key);
      return { cls: 'evicted', alias, avoidable: true, gonePx: gone.px };
    }
    const present = !!(meta && meta.present);
    if (present) { p.tooSmall++; return { cls: 'tooSmall', alias }; }
    p.first++;
    return { cls: 'first', alias };
  };

  S.skipOneShot = function () { if (S.on) P('vec').skip1++; };
  S.noteInflight = function (key) { if (S.on) S.inflight.set(key, now()); };
  S.clearInflight = function (key) { if (S.on) S.inflight.delete(key); };

  S.missStart = function () {
    return S.on ? now() : 0;
  };
  S.missEnd = function (t0, cls) {
    if (!S.on || !t0) return;
    const p = P(cls === 'use' ? 'use' : 'vec');
    const dur = now() - t0;
    p.redraw++;
    p.redrawMs += dur;
    if (cls === 'evicted') { p.avoidableMs += dur; }
  };

  S.notePut = function (pool, key, px, side, hadOld, evicted) {
    if (!S.on) return;
    const p = P(pool);
    p.put++;
    if (hadOld) p.putUpgrade++;
    if (evicted && evicted.length) {
      for (let i = 0; i < evicted.length; i++) {
        const [k, meta] = evicted[i];
        p.evictCount++;
        p.evictPx += meta.px || 0;
        if ((Number(meta.side) || 0) > (Number(side) || 0)) p.evictWastePx += meta.px || 0;
        S.evictedMem.set(k, { pool, alias: S.aliasOf(pool, k), px: meta.px || 0, side: meta.side || 0, t: now() });
        if (S.evictedMem.size > MAX_EVICT_MEM) {
          const firstKey = S.evictedMem.keys().next().value;
          S.evictedMem.delete(firstKey);
        }
      }
    }
    S.sample(pool);
  };

  S.noteReject = function (pool, key, px) {
    if (!S.on) return;
    P(pool).reject++;
    push({ t: Math.round(now() - S.t0), ev: 'reject', pool, alias: S.aliasOf(pool, key), px });
  };

  S.noteDrop = function (pool, n) {
    if (!S.on) return;
    const p = P(pool);
    p.drop++;
    p.items = 0;
    push({ t: Math.round(now() - S.t0), ev: 'drop', pool, px: n || 0 });
  };

  S.sample = function (pool) {
    if (!S.on) return;
    const p = P(pool);
    if (pool === 'vec') {
      p.px = App._bakeVecRasterPx || 0;
      p.items = App._bakeVecRaster ? App._bakeVecRaster.size : 0;
    } else {
      p.px = App._bakeUseRasterPx || 0;
      p.items = App._bakeUseRaster ? App._bakeUseRaster.size : 0;
    }
    if (p.px > p.peakPx) p.peakPx = p.px;
    if (p.items > p.peakItems) p.peakItems = p.items;
  };

  S.mark = function (tag) {
    if (!S.on) return null;
    const m = { tag: String(tag).slice(0, 24), t: Math.round(now() - S.t0), budgets: { vec: App._bakeVecRasterBudget, use: App._bakeUseRasterBudget } };
    S.marks.push(m);
    S.sample('vec'); S.sample('use');
    m.pools = { vec: { px: P('vec').px, items: P('vec').items }, use: { px: P('use').px, items: P('use').items } };
    return m;
  };

  S.snapshot = function () {
    const out = { when: new Date().toISOString(), budgets: S.readBudgets(), pools: {}, marks: S.marks.slice(), events: S.events.slice(-120) };
    for (const k of ['vec', 'use']) {
      const p = S.pools[k];
      out.pools[k] = Object.assign({}, p, {
        hitRate: p.req ? +(p.hit / p.req * 100).toFixed(1) : 0,
        avoidableRate: p.req ? +(p.avoidable / p.req * 100).toFixed(2) : 0,
        pxMB: +(p.px * 4 / 1e6).toFixed(1),
        peakMB: +(p.peakPx * 4 / 1e6).toFixed(1),
      });
    }
    return out;
  };

  S.reset = function () {
    S.pools = { vec: mkPool(), use: mkPool() };
    S.evictedMem.clear(); S.inflight.clear(); S.events.length = 0; S.marks.length = 0;
    S.t0 = now();
  };
})();
