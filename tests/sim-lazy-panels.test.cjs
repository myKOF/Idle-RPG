/* 決策點的面板按需建立（scripts/sim/lazy_panels.js ＋ policy_interpreter.js 的 LAZY）。

   要守的只有一件事：**按需建立與一次全建，決策逐位相同**。
   面板沒建時直譯器丟 NeedPanel、還原 memo、補建後重跑——只要還原有漏（memo 少還原一個欄位、
   BAD_PATHS 多記一筆、lite 版欄位跟完整版不一樣），之後每一輪都會悄悄偏掉，
   模擬結果還是看起來很正常。所以這裡最後一定用真的遊戲引擎、兩種跑法並排推進，
   逐輪比對送出的指令，最後比對存檔雜湊。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { createPolicy } = require(path.join(ROOT, 'scripts/sim/policy.js'));
const { createPanelSupplier } = require(path.join(ROOT, 'scripts/sim/lazy_panels.js'));

/* 合成策略。規則順序是刻意的：ra（everySec）排在 rb 前面，所以 rb 讀到沒建的面板時，
   ra 已經把 memo.lastAt.ra 寫下去了——還原漏掉的話，補建重跑時 ra 會被 everySec 擋掉。
   rc 每輪都讀 c（給預測測試用）；equipSets 的 active 由情境每輪讀。 */
function synthPolicy() {
  return createPolicy({
    name: 'lazy-test',
    decideEveryGameSec: 5,
    needPanels: ['a', 'b', 'c', 'equipSets'],
    equipSets: { home: 0 },
    rules: [
      { id: 'ra', cmd: 'x.a', everySec: 30, args: { v: { $path: 'panels.a.v' } } },
      { id: 'rb', cmd: 'x.b', everySec: 20, args: { v: { $path: 'panels.b.v' }, away: { $path: 'ctx.setAway' } } },
      { id: 'rc', cmd: 'x.c', args: { v: { $path: 'panels.c.v' } } }
    ]
  });
}
function synthBuild(t) {
  return (n, p) => {
    if (n === 'a') return { v: t * 2 };
    if (n === 'b') return { v: t * 3 };
    if (n === 'c') return { v: t * 5 };
    if (n === 'equipSets') return (p && p.lite) ? { active: 1, count: 3, unlocked: [true, true, false] }
      : { active: 1, count: 3, unlocked: [true, true, false], sets: [{ big: t }], candidates: {} };
    throw new Error('unknown panel ' + n);
  };
}

test('沒建的面板被讀到時回報 needPanel，而且 memo 還原成這一輪之前的樣子', () => {
  const p = synthPolicy();
  const state = { view: {}, panels: { a: { v: 1 }, c: { v: 3 } }, gameTimeSec: 0 };
  const r = p.decideLazy(state, { skip: { b: null } });
  assert.equal(r.needPanel, 'b');
  /* 還原的證據：ra 在 rb 丟出 NeedPanel 之前已經跑過，memo.lastAt.ra 被寫成 0。
     沒還原的話，補建後重跑時 ra 會被 everySec 擋掉，指令就少 x.a。 */
  const r2 = p.decideLazy({ view: {}, panels: { a: { v: 1 }, b: { v: 7 }, c: { v: 3 } }, gameTimeSec: 0 }, {});
  assert.deepEqual(r2.cmds.map((c) => c.name), ['x.a', 'x.b', 'x.c']);
});

test('lite 版有的欄位不必建完整版；讀 lite 版沒有的欄位才要', () => {
  const p = synthPolicy();
  const lite = { active: 1, count: 3, unlocked: [true, true, false] };
  /* 情境只讀 equipSets.active：lite 版就夠，不應要求完整版 */
  const r = p.decideLazy({ view: {}, panels: { a: { v: 1 }, b: { v: 2 }, c: { v: 3 }, equipSets: lite }, gameTimeSec: 0 },
    { skip: { equipSets: ['active', 'count', 'unlocked'] } });
  assert.equal(r.needPanel, undefined);
  assert.equal(r.cmds.find((c) => c.name === 'x.b').args.away, true, 'active=1 不是 home=0，setAway 應為 true');
  assert.ok(r.used.indexOf('equipSets') < 0, '只讀 lite 欄位不算用到完整版');
});

test('按需建立與全建，逐輪送出的指令完全相同（合成策略）', () => {
  const eager = synthPolicy(), lazy = synthPolicy();
  let built = 0;
  const sup = createPanelSupplier({
    names: lazy.needPanels,
    build: (n, prm) => { built++; return synthBuild(sup._t)(n, prm); }
  });
  for (let t = 0; t <= 300; t += 5) {
    sup._t = t;
    const b = synthBuild(t);
    const panels = {};
    for (const n of eager.needPanels) panels[n] = b(n);
    const want = eager.decide({ view: {}, panels, gameTimeSec: t });
    const got = sup.decide(lazy, (ps) => ({ view: {}, panels: ps, gameTimeSec: t }));
    assert.deepEqual(got, want, '第 ' + t + ' 秒的決策不同');
  }
  assert.ok(built < 61 * 4, '按需建立應少建面板（實建 ' + built + ' 次，全建 ' + 61 * 4 + ' 次）');
  assert.ok(sup.stats.retries > 0, 'a／b 每 20~30 秒才讀，應該發生過補建重跑');
});

test('連續兩輪都讀的面板，第三輪起預先建好、不再重跑', () => {
  const p = synthPolicy();
  const sup = createPanelSupplier({ names: p.needPanels, build: synthBuild(0) });
  const mk = (t) => (ps) => ({ view: {}, panels: ps, gameTimeSec: t });
  sup.decide(p, mk(0)); sup.decide(p, mk(5));
  const before = sup.stats.retries;
  sup.decide(p, mk(10));   // 10 秒：ra／rb 都未到期，只有 c 要讀，而 c 已連續兩輪被讀
  assert.equal(sup.stats.retries, before, 'c 應已預先建好');
});

test('重跑用的分段序列化與 JSON.stringify 逐字相同（含 undefined／函式／NaN／日期／陣列）', () => {
  const { stateJson } = require(path.join(ROOT, 'scripts/sim/policy.js'));
  const shared = { deep: { a: [1, { b: null }], c: 'x' } };
  const state = {
    view: { stage: 3, nan: NaN, inf: Infinity, d: new Date(0), u: undefined },
    panels: { a: shared, b: [1, 2, { z: undefined }], c: null, gone: undefined, fn() {} },
    gameTimeSec: 12.5, seed: undefined, f: function () {}, arr: [undefined, () => 1, 3],
    ctx: { '鍵': '中文' }
  };
  const cache = new WeakMap();
  assert.equal(stateJson(state, cache), JSON.stringify(state));
  assert.equal(stateJson(state, cache), JSON.stringify(state), '第二次走快取仍須相同');
  assert.equal(stateJson({ view: 1, panels: [1, 2] }, cache), JSON.stringify({ view: 1, panels: [1, 2] }));
});

/* ---- 真的遊戲引擎：兩種跑法並排推進 ---- */
function lockstep(policyFile, seed, minutes) {
  const { createEngine } = require(path.join(ROOT, 'scripts/sim/engine.js'));
  const { stateHash } = require(path.join(ROOT, 'scripts/sim/hash.js'));
  const pj = require(path.join(ROOT, 'scripts/sim', policyFile));
  const run = (mode) => {
    const pol = createPolicy(pj);
    const eng = createEngine({ seed });
    eng.boot(null);
    if (pol.evalConfig) eng.setEvalParams(pol.evalConfig);
    const params = (n) => (pol.panelParams && pol.panelParams[n]) || undefined;
    const sup = mode === 'lazy'
      ? createPanelSupplier({ names: pol.needPanels, build: (n, p) => eng.panel(n, p), paramsFor: params })
      : null;
    return { pol, eng, sup, params };
  };
  const A = run('eager'), B = run('lazy');
  const every = pj.decideEveryGameSec || 10;
  const n = Math.round(minutes * 60 / every);
  for (let i = 0; i < n; i++) {
    for (const X of [A, B]) {
      X.eng.stepSeconds(every);
      const mk = (ps) => ({ view: X.eng.view(), panels: ps, gameTimeSec: X.eng.gameTimeSec(), seed });
      let cmds;
      if (X.sup) cmds = X.sup.decide(X.pol, mk);
      else {
        const ps = {};
        for (const nm of X.pol.needPanels) ps[nm] = X.eng.panel(nm, X.params(nm));
        cmds = X.pol.decide(mk(ps));
      }
      X.last = cmds;
      for (const c of cmds) X.eng.cmd(c.name, c.args);
    }
    assert.deepEqual(B.last, A.last, policyFile + '：第 ' + (i + 1) + ' 個決策點的指令不同');
  }
  assert.equal(stateHash(B.eng.saveJson()), stateHash(A.eng.saveJson()), policyFile + '：最終存檔雜湊不同');
  return B.sup.stats;
}

test('真的引擎：extreme 策略兩種跑法逐輪指令與最終存檔雜湊相同', () => {
  const s = lockstep('policy.extreme.json', 20261120, 20);
  assert.ok(s.fullBuilds + s.liteBuilds < s.eagerEquivalentBuilds, '按需建立應少建面板');
});

test('真的引擎：ROI 策略（有 eval 面板與評估參數）兩種跑法相同', () => {
  lockstep('policy.extreme.roi.json', 20261121, 20);
});
