'use strict';
/* ============ Proxy 守門 A/B 判定測試 ============

   針對 docs/PROXY_GUARD_OPTIMIZATION.md 提出的方案，回答兩個問題：
     1. 那個 Proxy 守門會不會改變遊戲行為？（會的話，用它跑出來的數據全部無效）
     2. WeakMap 快取是不是真的解決了它描述的病灶？

   對照組三種：
     none    不裝守門（基準）
     naive   文件中的「原實作」：每次 get 都新建一個 Proxy
     cached  文件中的「優化後」：WeakMap 快取，同一個裸物件只包一次

   判定依據是**正規化後的 G 雜湊**（見 scripts/sim/hash.js）。
   三者雜湊都相同 → 守門是行為中性的；任何一個不同 → 那個守門在改遊戲。

   用法：node scripts/proxy_guard_ab.js [遊戲分鐘數] */

const { createEngine } = require('./sim/engine');
const { stateHash } = require('./sim/hash');

const MINUTES = Number(process.argv[2] || 10);

/* 文件中的「原實作」：無快取，每次讀到物件就包一層新的 Proxy。 */
function installNaiveGuard(ctx) {
  const depth = { n: 0 };
  function attach(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    return new Proxy(obj, {
      get(target, prop, receiver) {
        const val = Reflect.get(target, prop, receiver);
        if (val && typeof val === 'object') return attach(val);
        return val;
      },
      set(target, prop, value, receiver) {
        if (depth.n <= 0) throw new Error('[Proxy Guard Veto] 違規寫入 G.' + String(prop));
        return Reflect.set(target, prop, value, receiver);
      }
    });
  }
  return wrapEngineFns(ctx, attach, depth);
}

/* 文件中的「優化後」：WeakMap 快取。 */
function installCachedGuard(ctx) {
  const depth = { n: 0 };
  const proxyMap = new WeakMap();
  function attach(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    if (proxyMap.has(obj)) return proxyMap.get(obj);
    const proxy = new Proxy(obj, {
      get(target, prop, receiver) {
        const val = Reflect.get(target, prop, receiver);
        if (val && typeof val === 'object') return attach(val);
        return val;
      },
      set(target, prop, value, receiver) {
        if (depth.n <= 0) throw new Error('[Proxy Guard Veto] 違規寫入 G.' + String(prop));
        return Reflect.set(target, prop, value, receiver);
      },
      deleteProperty(target, prop) {
        if (depth.n <= 0) throw new Error('[Proxy Guard Veto] 違規刪除 G.' + String(prop));
        return Reflect.deleteProperty(target, prop);
      }
    });
    proxyMap.set(obj, proxy);
    return proxy;
  }
  return wrapEngineFns(ctx, attach, depth);
}

/* 把 G 換成代理，並讓 simStep / runCommand 期間的寫入合法（_engineDepth 的等價物）。 */
function wrapEngineFns(ctx, attach, depth) {
  const rawG = ctx.G;
  ctx.G = attach(rawG);
  const origStep = ctx.simStep;
  const origCmd = ctx.runCommand;
  ctx.simStep = function (dt) { depth.n++; try { return origStep(dt); } finally { depth.n--; } };
  ctx.runCommand = function (n, a) { depth.n++; try { return origCmd(n, a); } finally { depth.n--; } };
  /* 5Hz 區塊那三支也會寫 G（shownRes / 商店 / 解鎖旗標），同樣要放行。 */
  for (const fn of ['updateShownRes', 'maintainGemShop', 'checkForgeUnlockNotice']) {
    const orig = ctx[fn];
    ctx[fn] = function () { depth.n++; try { return orig.apply(null, arguments); } finally { depth.n--; } };
  }
  return () => rawG;
}

function run(label, install) {
  const eng = createEngine({ seed: 4242 }).boot(null);
  let getRaw = () => eng.ctx.G;
  if (install) getRaw = install(eng.ctx);

  const t0 = process.hrtime.bigint();
  let err = null;
  try {
    eng.stepSeconds(MINUTES * 60);
  } catch (e) {
    err = e.message.split('\n')[0];
  }
  const sec = Number(process.hrtime.bigint() - t0) / 1e9;
  const raw = getRaw();
  const h = err ? '（中斷）' : stateHash(JSON.stringify(raw));
  const v = err ? {} : eng.ctx.buildView();
  console.log(`  ${label.padEnd(10)} ${String(h).slice(0, 16).padEnd(18)} ${err ? '❌ ' + err : `Lv.${v.level} stage ${v.stage} gold ${v.gold}`}`);
  console.log(`  ${''.padEnd(10)} ${sec.toFixed(2)}s（${Math.round(MINUTES * 60 / sec).toLocaleString()}x）`);
  return { hash: h, sec, err };
}

console.log(`\n模擬 ${MINUTES} 遊戲分鐘，seed=4242，比對正規化 G 雜湊\n`);
const none = run('none', null);
const naive = run('naive', installNaiveGuard);
const cached = run('cached', installCachedGuard);

console.log('\n──────── 結論 ────────');
const naiveSame = naive.hash === none.hash;
const cachedSame = cached.hash === none.hash;
console.log(`${naiveSame ? '✅' : '❌'} naive 守門行為中性：${naiveSame ? '是' : '否——用它跑出的數據全部無效'}`);
console.log(`${cachedSame ? '✅' : '❌'} cached 守門行為中性：${cachedSame ? '是' : '否——用它跑出的數據全部無效'}`);
if (!none.err && !naive.err && !cached.err) {
  console.log(`\n效能：none ${(none.sec).toFixed(2)}s ／ naive ${(naive.sec).toFixed(2)}s（${(naive.sec / none.sec).toFixed(1)}x 慢）` +
    ` ／ cached ${(cached.sec).toFixed(2)}s（${(cached.sec / none.sec).toFixed(1)}x 慢）`);
}
