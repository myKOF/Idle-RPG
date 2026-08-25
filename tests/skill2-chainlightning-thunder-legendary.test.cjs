/* 傳奇進化第八批（2026-08-26）：連鎖閃電（單手劍）／落雷術（單手魔杖）
   設計來源：神力之巔_記事錄試算表〈傳奇進化〉頁籤的連鎖閃電、落雷術兩段。
   守住的事：
     1. 連鎖閃電五個傳奇：電荷連鎖（彈射數）、電擊（發射道數）、雷散落（擴散）、
        超導（每彈射一次增傷）、過載（打滿次數即爆炸）
     2. 連鎖閃電三個超神：天地雷鎖陣（重複施放）、永恒超導體（往返鏈＋雷電傷害疊層）、
        飛雷神（放電期每拍打最遠的 N 個敵人）
     3. 落雷術五個傳奇：三重雷（每目標次數）、雷鎖（目標數）、震雷（暈眩時間＋暈眩易傷）、
        雷之再生（迅雷重生機率改寫）、引雷針（優先低血並加傷）
     4. 落雷術三個超神：雷電矩陣（十字雷幕）、雷霆天劫（永久追擊雷）、永恒雷獄（重複施放）

   ⚠️ 本檔只驗「機制有沒有接上」，不驗「數字調校得對不對」（那是參數表的事）。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const M = 10; // 1 米 ＝ 10 個戰場單位（bfMeterPx）

function loadContext(extra) {
  const logs = [];
  const context = {
    console,
    Math: Object.create(Math),
    setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    UI: { dirty: {} },
    blog(message) { logs.push(message); },
    floatText() {}, trackDps() {}, recordRunDamage() {},
    logs
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js',
    'js/skills.js', 'js/skills2.js', 'js/legendary.js'].concat(extra || [])
    .forEach((file) => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file }));
  context.G = { player: { gold: 0, skills2: { levels: {}, ult: {} }, loadout: [] }, stage: { current: 1 } };
  context.BASE_STATS = {
    atk: 1000, matk: 500, hp: 1000, mp: 500, level: 10, aspd: 2, cdr: 0,
    critRate: 0, critDmg: 150, hit: 100, tenacity: 0, shieldEff: 0,
    hpRegen: 0, mpRegen: 0, lifesteal: 0, manaSteal: 0,
    passives: {}, elemAtk: null, elemDmgPct: 0, elemDmgUp: {},
    eliteDmg: 0, bossDmg: 0, normalDmg: 0, totalDmgPct: 0, dmgVsElem: null,
    aoeDmg: 0, globalDmgRed: 0, legendaryEffects: {}, legendaryEffectMults: {}
  };
  context.getStats = () => context.BASE_STATS;
  context.GT = 0;
  context.trackDps = () => {};
  context.recordRunDamage = () => {};
  return context;
}

function enemy(hp, x, y, name, kind) {
  return {
    name: name || '測試怪', maxHp: hp, hp, def: 0, mdef: 0, level: 1,
    effects: {}, buffs: {}, dots: [], resist: {}, ctrlRes: 0,
    elite: kind === 'elite', isBoss: kind === 'boss',
    pos: (x === undefined) ? undefined : { x, y }
  };
}
function playerEnt() {
  return { hp: 1000, mp: 500, shield: 0, shieldMax: 0, skillCds: {}, buffs: {}, dots: [], effects: {}, _lockTarget: null };
}
/* 命中紀錄：resolveHit 是所有「一次攻擊」的唯一出口，因此數這裡就等於數命中。 */
function stubHits(c) {
  const calls = [];
  c.resolveHit = function (attacker, defender, aCfg) {
    calls.push({ ent: defender, atk: aCfg.atk, total: aCfg.totalDmgPct || 0, elem: aCfg.skillElem });
    return { dmg: 100, crit: false, miss: false, blocked: false, killed: false };
  };
  c.applySkillFinalDamageMultiplier = function () {};
  return calls;
}
/* 衍生傷害（過載爆炸）不經 resolveHit，改由 applyEnemyHpDamage 直接扣血。 */
function stubDerived(c) {
  const hits = [];
  c.applyEnemyHpDamage = function (ent, amount) {
    hits.push({ ent: ent, amount: amount });
    return amount;
  };
  return hits;
}
function stubVfx(c) {
  const specs = [];
  c.playCombatVfx = (spec) => specs.push(spec);
  c.enemyEventFloatTarget = (ent) => ent.name;
  c.playerEventFloatTarget = (sel) => sel;
  c.floatEnemyEvent = () => {};
  c.floatPlayerEvent = () => {};
  return specs;
}
function tickCtx(c, p, enemies) {
  return { pEnt: p, getEnemies: () => enemies, floatSel: 'mv-float', onDeaths() {}, onDamage() {} };
}
function advance(c, p, enemies, seconds, step) {
  const dt = step || 0.05;
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    c.GT = +(c.GT + dt).toFixed(4);
    c.tickSkill2(dt, tickCtx(c, p, enemies));
  }
}
function setLevels(c, gid, levels) { c.G.player.skills2.levels[gid] = levels.slice(); }
function maxLevels(c, gid) { setLevels(c, gid, [10, 10, 10, 10, 10, 10, 10]); }
function equip(c, gid) { c.G.player.loadout = [c.SG_PREFIX + gid]; }
function setUlt(c, gid, id, lv) {
  c.G.player.skills2.ult[gid] = { pick: c.sgUltIndexOfId(gid, id), lv: lv === undefined ? 1 : lv };
}
function setLegendary(c, keys) {
  const on = {};
  (keys || []).forEach((k) => { on[k] = true; });
  c.BASE_STATS = Object.assign({}, c.BASE_STATS, { legendaryEffects: on, legendaryEffectMults: {} });
}
function countFor(calls, ent) {
  return calls.filter((h) => h.ent === ent).length;
}

/* ===========================================================================
   1) 連鎖閃電的五個傳奇特效
   =========================================================================== */

test('【電荷連鎖】：閃電鏈的彈射數 +2（總命中次數跟著多 2 次）', () => {
  function hits(keys) {
    const c = loadContext();
    stubVfx(c);
    const calls = stubHits(c);
    setLegendary(c, keys);
    setLevels(c, 'chainlightning', [1, 0, 0, 0, 0, 0, 0]);
    // 敵人夠多才彈得完：表定彈射 4 次，加傳奇後 6 次
    const es = [];
    for (let i = 0; i < 10; i++) es.push(enemy(1e9, 20 + i * 5, 0, 'e' + i));
    c.castSkill2(playerEnt(), es, 'chainlightning', 'mv-float');
    return calls.length;
  }
  assert.equal(hits([]), 4, '表定 4 次彈射');
  assert.equal(hits(['chainlightningSurge']), 6, '+2 次');
});

test('【電擊】：同時射出的閃電鏈道數 +2（第 7 階沒學也照加）', () => {
  function bolts(keys) {
    const c = loadContext();
    const specs = stubVfx(c);
    stubHits(c);
    setLegendary(c, keys);
    setLevels(c, 'chainlightning', [1, 0, 0, 0, 0, 0, 0]);
    const es = [];
    for (let i = 0; i < 10; i++) es.push(enemy(1e9, 20 + i * 5, 0, 'e' + i));
    c.castSkill2(playerEnt(), es, 'chainlightning', 'mv-float');
    /* 每一道鏈的起手都會送一個「只帶 1 個目標、沒有 delayMs」的雷鏈特效，
       正好等於道數（後續每一跳都是兩點式，且帶 delayMs）。 */
    return specs.filter((s) => s.variant === 'lightning-chain' && s.targets.length === 1 && !s.delayMs).length;
  }
  assert.equal(bolts([]), 1, '第 1 階只有 1 道');
  assert.equal(bolts(['chainlightningVolley']), 3, '+2 道');
});

test('【雷散落】：電殛擴散多打 1 個敵人，且擴散傷害 +50%', () => {
  /* 階數會級聯（前一階至少 Lv.1 才算數），因此要看第 5 階就得把前五階都投資。
     不足 1 次的擲骰一律讓它失敗，命中次數才數得準。 */
  function splash(keys) {
    const c = loadContext();
    stubVfx(c);
    const calls = stubHits(c);
    c.chance = () => false;
    setLegendary(c, keys);
    setLevels(c, 'chainlightning', [1, 1, 1, 1, 1, 0, 0]);
    const es = [];
    for (let i = 0; i < 12; i++) es.push(enemy(1e9, 20 + i * 4, 0, 'e' + i));
    c.castSkill2(playerEnt(), es, 'chainlightning', 'mv-float');
    return calls;
  }
  const base = splash([]);
  const wide = splash(['chainlightningScatter']);
  /* 主鏈的次數兩邊相同；差額全部來自擴散——擴散只在「彈射時」發生（起手那一擊不算），
     每次機會多打 1 個敵人。 */
  assert.ok(base.length > 0 && wide.length > base.length, '雷散落會多打幾下');
  assert.equal(wide.length - base.length, 4, '5 段鏈＝ 4 次彈射，每次各多打 1 個');
  const baseSplashAtk = Math.min.apply(null, base.map((h) => h.atk));
  const wideSplashAtk = Math.min.apply(null, wide.map((h) => h.atk));
  assert.equal(Math.round(wideSplashAtk / baseSplashAtk * 100), 150, '擴散傷害 +50%');
});

test('【超導】：同一道鏈每彈射 1 次，之後每一擊的傷害再加一份（加算）', () => {
  const c = loadContext();
  stubVfx(c);
  const calls = stubHits(c);
  setLegendary(c, ['chainlightningSuper']);
  setLevels(c, 'chainlightning', [1, 0, 0, 0, 0, 0, 0]);
  const es = [];
  for (let i = 0; i < 10; i++) es.push(enemy(1e9, 20 + i * 5, 0, 'e' + i));
  c.castSkill2(playerEnt(), es, 'chainlightning', 'mv-float');
  assert.equal(calls.length, 4);
  const first = calls[0].atk;
  [0, 1, 2, 3].forEach((i) => {
    assert.equal(Math.round(calls[i].atk / first * 100), 100 + 10 * i, '第 ' + (i + 1) + ' 擊 ＝ 1 + 10% × 彈射次數');
  });
});

test('【過載】：同一個敵人被閃電鏈打滿 5 次就在牠身上炸開（爆炸是衍生傷害）', () => {
  const c = loadContext();
  stubVfx(c);
  stubHits(c);
  const derived = stubDerived(c);
  setLegendary(c, ['chainlightningOverload']);
  setLevels(c, 'chainlightning', [1, 0, 0, 0, 0, 0, 0]);
  const p = playerEnt();
  const hub = enemy(1e9, 20, 0, 'hub');
  const near = enemy(1e9, 24, 0, 'near');   // 距離 hub 4 單位＝ 0.4 米，在 6 米爆炸範圍內
  const far = enemy(1e9, 300, 0, 'far');    // 30 米外，不吃爆炸
  // 場上只有這三個，主鏈每次施放都從最近的 hub 起手；累積打滿 5 次即爆
  for (let i = 0; i < 6; i++) c.castSkill2(p, [hub, near, far], 'chainlightning', 'mv-float');
  assert.ok(derived.length > 0, '應該炸過至少一次');
  assert.ok(derived.every((h) => h.ent !== undefined), '爆炸有受害者');
  assert.ok(!derived.some((h) => h.ent === far), '30 米外的敵人不吃爆炸');
  // 計數跨施放累積：打滿一次就歸零重算，因此計數恆小於門檻
  assert.ok((hub._sgChainHits || 0) < 5 && (near._sgChainHits || 0) < 5, '計數打滿即歸零');
});

/* ===========================================================================
   2) 連鎖閃電的三個超神進化
   =========================================================================== */

test('【天地雷鎖陣】：施放後每 gap 秒自動再施放，且重複施放不扣魔、不進冷卻', () => {
  const c = loadContext();
  stubVfx(c);
  const calls = stubHits(c);
  maxLevels(c, 'chainlightning');
  equip(c, 'chainlightning');
  setUlt(c, 'chainlightning', 'skyThunderArray', 1);
  const p = playerEnt();
  const es = [];
  for (let i = 0; i < 8; i++) es.push(enemy(1e9, 20 + i * 5, 0, 'e' + i));
  c.castSkill2(p, es, 'chainlightning', 'mv-float');
  const mpAfterCast = p.mp;
  const cdAfterCast = p.skillCds['sg:chainlightning'];
  const firstBatch = calls.length;
  assert.ok(cdAfterCast > 0, '手動施放要進冷卻');
  const rp = c.SKILL2_RT.ultRepeat.chainlightning;
  assert.ok(rp && rp.until > c.GT, '施放後應起算重複節拍');

  advance(c, p, es, 1.2);
  assert.ok(calls.length > firstBatch, '節拍到就自動再施放一次');
  assert.equal(p.mp, mpAfterCast, '重複施放不扣魔');
  assert.equal(p.skillCds['sg:chainlightning'], cdAfterCast, '重複施放不重設冷卻');

  // 持續時間走完就停（Lv.1 ＝ 3 + 0.3 秒）
  advance(c, p, es, 6);
  const settled = calls.length;
  advance(c, p, es, 3);
  assert.equal(calls.length, settled, '持續時間結束後不再自動施放');
  assert.equal(c.SKILL2_RT.ultRepeat.chainlightning, undefined, '節拍回收');
});

test('【永恒超導體】：往返鏈對範圍內每個敵人各打一次，並疊出雷電傷害提升', () => {
  /* 三隻敵人各離我方 25 米（在超導體的 30 米範圍內），但彼此相距 43 米（超過彈射範圍），
     因此主鏈的擴散一個也打不到——命中次數與隨機選目標無關，兩邊才比得準。 */
  const RING = [[250, 0], [-125, 216], [-125, -216]];
  function cast(ultOn) {
    const c = loadContext();
    stubVfx(c);
    const calls = stubHits(c);
    c.chance = () => false;
    maxLevels(c, 'chainlightning');
    equip(c, 'chainlightning');
    if (ultOn) setUlt(c, 'chainlightning', 'eternalSuperconductor', 1);
    const p = playerEnt();
    const es = RING.map((xy, i) => enemy(1e9, xy[0], xy[1], 'e' + i));
    c.castSkill2(p, es, 'chainlightning', 'mv-float');
    return { c: c, p: p, calls: calls };
  }
  const plain = cast(false);
  const withUlt = cast(true);
  assert.ok(plain.calls.length > 0, '基準本身要打得到人');
  assert.equal(withUlt.calls.length - plain.calls.length, RING.length, '額外鏈＝範圍內每個敵人各一次');

  const c = withUlt.c;
  const p = withUlt.p;
  assert.equal(c.buffVal(p, 'sgSuperconduct'), RING.length * (2 + 0.2), '每經過自身一次疊 1 層（Lv.1 單層 2.2%）');
  assert.equal(c.skill2LightningDamageUpPct(p), c.buffVal(p, 'sgSuperconduct'));
  // 疊層直接進入「屬性傷害提升%」的唯一收斂點
  const up = c.legendaryElementDamageUp(c.getStats(), p);
  assert.equal(Math.round(up.lightning * 10) / 10, Math.round(c.buffVal(p, 'sgSuperconduct') * 10) / 10);
  // 死亡／讀檔時要收得回來，否則會帶進下一場
  c.resetSkill2RT();
  assert.equal(p.buffs.sgSuperconduct, undefined, 'resetSkill2RT 撤掉疊層');
});

test('【飛雷神】：放電期每 gap 秒打向最遠的 N 個敵人，各自炸開一個範圍', () => {
  const c = loadContext();
  stubVfx(c);
  const calls = stubHits(c);
  maxLevels(c, 'chainlightning');
  equip(c, 'chainlightning');
  setUlt(c, 'chainlightning', 'flyingThunderGod', 1);
  const p = playerEnt();
  const near = enemy(1e9, 10, 0, 'near');
  const mid = enemy(1e9, 100, 0, 'mid');
  const far1 = enemy(1e9, 200, 0, 'far1');
  const far2 = enemy(1e9, 210, 0, 'far2');       // 與 far1 相距 1 米，互相在 12 米爆炸範圍內
  const es = [near, mid, far1, far2];
  c.castSkill2(p, es, 'chainlightning', 'mv-float');
  assert.ok(c.SKILL2_RT.flyThunder, '施放後進入放電期');
  const afterCast = calls.length;

  advance(c, p, es, 0.4);
  const pulse = calls.slice(afterCast);
  assert.ok(pulse.length > 0, '節拍到就放電');
  assert.ok(pulse.some((h) => h.ent === far1) && pulse.some((h) => h.ent === far2), '打最遠的敵人');

  // 持續 6.3 秒（Lv.1）：走完就停
  advance(c, p, es, 8);
  const settled = calls.length;
  advance(c, p, es, 2);
  assert.equal(calls.length, settled, '放電期結束後不再放電');
  assert.equal(c.SKILL2_RT.flyThunder, null, '放電期回收');
});

/* ===========================================================================
   3) 落雷術的五個傳奇特效
   =========================================================================== */

/* 落雷是天降打擊：施放當下只排程，要跑完落地時間才結算傷害。 */
function castThunder(c, p, es, sec) {
  c.castSkill2(p, es, 'thunderstrike', 'mv-float');
  advance(c, p, es, sec === undefined ? 3 : sec);
}

test('【三重雷】：每個目標的攻擊次數 +1（不以【雙重落雷】已學為前提）', () => {
  function hits(keys) {
    const c = loadContext();
    stubVfx(c);
    const calls = stubHits(c);
    setLegendary(c, keys);
    setLevels(c, 'thunderstrike', [1, 0, 0, 0, 0, 0, 0]);   // 目標 2 個、每個 1 次
    const es = [enemy(1e9, 20, 0, 'a'), enemy(1e9, 40, 0, 'b')];
    castThunder(c, playerEnt(), es);
    return calls.length;
  }
  assert.equal(hits([]), 2, '表定 2 個目標各 1 次');
  assert.equal(hits(['thunderstrikeTriple']), 4, '每個目標各 +1 次');
});

test('【雷鎖】：落雷術的目標數 +1', () => {
  function targets(keys) {
    const c = loadContext();
    stubVfx(c);
    const calls = stubHits(c);
    setLegendary(c, keys);
    setLevels(c, 'thunderstrike', [1, 0, 0, 0, 0, 0, 0]);
    const es = [enemy(1e9, 20, 0, 'a'), enemy(1e9, 40, 0, 'b'), enemy(1e9, 60, 0, 'c')];
    castThunder(c, playerEnt(), es);
    return calls.length;
  }
  assert.equal(targets([]), 2);
  assert.equal(targets(['thunderstrikeLock']), 3, '+1 個目標');
});

test('【震雷】：暈眩時間 +1 秒，且該敵人在暈眩中受到的傷害提高', () => {
  const c = loadContext();
  stubVfx(c);
  stubHits(c);
  setLegendary(c, ['thunderstrikeQuake']);
  setLevels(c, 'thunderstrike', [1, 0, 0, 0, 0, 0, 0]);   // 第 5 階沒學：暈眩完全來自傳奇
  const p = playerEnt();
  const e = enemy(1e9, 20, 0, 'a');
  // 落雷是天降打擊：落地約 1 秒；傳奇給的暈眩只有 1 秒，因此要在它過期前檢查
  castThunder(c, p, [e], 1.3);
  assert.ok(c.effectActive(e, 'stun'), '沒學【雷電脈衝】也會被震暈');
  assert.equal(c.buffVal(e, 'sgThunderQuake'), 25, '塗上雷痕');
  // 暈眩中才吃增傷；暈眩結束就沒有
  assert.equal(c.skill2ThunderQuakeVulnPct(e), 25);
  const aCfg = c.skill2VulnACfg({}, e);
  assert.equal(aCfg.totalDmgPct, 25, '增傷加進 totalDmgPct 的同一個收斂點');
  delete e.effects.stun;
  assert.equal(c.skill2ThunderQuakeVulnPct(e), 0, '沒暈眩＝沒有增傷');
});

test('【雷之再生】：把【迅雷重生】的機率改寫成 100%；該階沒學則不生效', () => {
  function regenBolts(keys, levels) {
    const c = loadContext();
    stubVfx(c);
    const calls = stubHits(c);
    setLegendary(c, keys);
    setLevels(c, 'thunderstrike', levels);
    c.chance = (pct) => pct >= 100;   // 只有 100% 才過：分得出「有沒有被改寫成 100」
    const es = [enemy(1e9, 20, 0, 'a')];
    castThunder(c, playerEnt(), es, 6);
    return calls.length;
  }
  // 階數會級聯：要看第 6 階就得把前六階都投資
  const noTier = regenBolts(['thunderstrikeRebirth'], [1, 1, 1, 1, 1, 0, 0]);
  const withTier = regenBolts(['thunderstrikeRebirth'], [1, 1, 1, 1, 1, 1, 0]);
  const tierOnly = regenBolts([], [1, 1, 1, 1, 1, 1, 0]);
  assert.ok(noTier > 0, '基準本身要打得到人');
  assert.equal(tierOnly, noTier, '沒有特效時表定機率不到 100，替身不讓它過＝沒有再生');
  assert.ok(withTier > noTier, '學了第 6 階＝機率改寫成 100%，每道都再生');
});

test('【引雷針】：優先劈範圍內生命值最低的敵人，且對範圍內目標加傷', () => {
  const c = loadContext();
  stubVfx(c);
  const calls = stubHits(c);
  setLegendary(c, ['thunderstrikeRod']);
  setLevels(c, 'thunderstrike', [1, 0, 0, 0, 0, 0, 0]);
  const fat = enemy(1e9, 20, 0, 'fat');
  const weak = enemy(100, 200, 0, 'weak');       // 20 米：在 24 米引雷範圍內
  const outside = enemy(50, 400, 0, 'outside');  // 40 米：範圍外，不該被優先挑
  const es = [fat, weak, outside];
  castThunder(c, playerEnt(), es);
  assert.ok(countFor(calls, weak) > 0, '範圍內最低血的敵人被劈到');
  assert.equal(countFor(calls, outside), 0, '範圍外的不進候選');
  assert.ok(calls.every((h) => h.total >= 20), '範圍內目標吃到 +20% 加傷');
});

/* ===========================================================================
   4) 落雷術的三個超神進化
   =========================================================================== */

test('【雷電矩陣】：橫向與直向各 N 道貫穿全場的雷幕，一次結算完畢', () => {
  function matrixHits(withUlt) {
    const c = loadContext();
    stubVfx(c);
    const calls = stubHits(c);
    maxLevels(c, 'thunderstrike');
    equip(c, 'thunderstrike');
    if (withUlt) setUlt(c, 'thunderstrike', 'thunderMatrix', 1);
    const p = playerEnt();
    // 同一條橫線上排開：橫向雷幕一定掃得到全部
    const es = [enemy(1e9, 20, 0, 'a'), enemy(1e9, 60, 0, 'b'), enemy(1e9, 100, 0, 'c')];
    c.castSkill2(p, es, 'thunderstrike', 'mv-float');
    return calls.length;   // 矩陣在施放當下就結算，不必等落地
  }
  const base = matrixHits(false);
  const withMatrix = matrixHits(true);
  assert.equal(base, 0, '落雷本體要等落地才結算，施放當下沒有傷害');
  assert.ok(withMatrix > 0, '矩陣在施放當下就掃過全場');
});

test('【雷霆天劫】：只要落雷術裝配著就永久運轉，每拍追擊範圍內最低血的敵人', () => {
  const c = loadContext();
  stubVfx(c);
  const calls = stubHits(c);
  maxLevels(c, 'thunderstrike');
  equip(c, 'thunderstrike');
  setUlt(c, 'thunderstrike', 'heavenTribulation', 1);
  const p = playerEnt();
  const fat = enemy(1e9, 20, 0, 'fat');
  const weak = enemy(1e8, 40, 0, 'weak');
  const es = [fat, weak];
  // 沒有施放技能，也應該自己跑起來
  advance(c, p, es, 2);
  assert.ok(calls.length > 0, '永久雷電不必施放就會運轉');
  assert.ok(calls.every((h) => h.ent === weak), '每拍都挑生命值最低的');

  // 卸下技能就停
  c.G.player.loadout = [];
  const settled = calls.length;
  advance(c, p, es, 2);
  assert.equal(calls.length, settled, '沒裝配在技能列就不生效');
});

test('【永恒雷獄】：施放落雷術後每 gap 秒自動再施放，持續時間走完就停', () => {
  const c = loadContext();
  stubVfx(c);
  stubHits(c);
  maxLevels(c, 'thunderstrike');
  equip(c, 'thunderstrike');
  setUlt(c, 'thunderstrike', 'eternalThunderPrison', 1);
  const p = playerEnt();
  const es = [enemy(1e9, 20, 0, 'a')];
  const mpBefore = p.mp;
  c.castSkill2(p, es, 'thunderstrike', 'mv-float');
  const mpAfter = p.mp;
  assert.ok(mpBefore > mpAfter, '手動施放要扣魔');
  assert.ok(c.SKILL2_RT.ultRepeat.thunderstrike, '施放後起算重複節拍');
  advance(c, p, es, 1.2);
  assert.equal(p.mp, mpAfter, '重複施放不扣魔');
  advance(c, p, es, 8);
  assert.equal(c.SKILL2_RT.ultRepeat.thunderstrike, undefined, '持續時間走完就回收');
});

/* ===========================================================================
   5) 接線與參數表
   =========================================================================== */

test('第八批十個傳奇特效：各自只出現在指定武器類型，且關聯到新版技能群組', () => {
  const c = loadContext();
  const NEW_ONES = {
    chainlightningSurge: ['電荷連鎖', 'sword1h', 'chainlightning'],
    chainlightningVolley: ['電擊', 'sword1h', 'chainlightning'],
    chainlightningScatter: ['雷散落', 'sword1h', 'chainlightning'],
    chainlightningSuper: ['超導', 'sword1h', 'chainlightning'],
    chainlightningOverload: ['過載', 'sword1h', 'chainlightning'],
    thunderstrikeTriple: ['三重雷', 'wand1h', 'thunderstrike'],
    thunderstrikeLock: ['雷鎖', 'wand1h', 'thunderstrike'],
    thunderstrikeQuake: ['震雷', 'wand1h', 'thunderstrike'],
    thunderstrikeRebirth: ['雷之再生', 'wand1h', 'thunderstrike'],
    thunderstrikeRod: ['引雷針', 'wand1h', 'thunderstrike']
  };
  Object.keys(NEW_ONES).forEach((id) => {
    const def = c.PASSIVE_POOL[id];
    const [name, weaponType, gid] = NEW_ONES[id];
    assert.ok(def, id + ' 必須在傳奇特效池裡');
    assert.equal(def.name, name);
    assert.equal(def.legendary, true);
    assert.equal(def.type, 'lightning', id + ' 應為雷屬性');
    assert.deepEqual(Array.from(def.weaponTypes || []), [weaponType]);
    assert.equal(def.relatedSkill, gid);
    assert.ok(def.desc && def.desc.length > 0);
  });
});

test('legendarySkill2Mods：兩個雷系群組的傳奇 fx 不互相汙染', () => {
  const c = loadContext();
  setLegendary(c, ['chainlightningSurge', 'thunderstrikeLock']);
  assert.equal(c.legendarySkill2Mods('chainlightning').chainLinkAdd.count, 2);
  assert.equal(c.legendarySkill2Mods('chainlightning').thunderTargetAdd, undefined, '不跨群組');
  assert.equal(c.legendarySkill2Mods('thunderstrike').thunderTargetAdd.count, 1);
  assert.equal(c.legendarySkill2Mods('thunderorb'), null, '沒有關聯特效的群組回 null');
});

test('參數表往返：Skills2 的六個超神進化列與 Equipment_Affix 的十個新特效都落表', () => {
  const skills2 = fs.readFileSync(path.join(root, 'config/CSV/Skills2.csv'), 'utf8');
  ['skyThunderArray', 'eternalSuperconductor', 'flyingThunderGod',
    'thunderMatrix', 'heavenTribulation', 'eternalThunderPrison'].forEach((id) => {
    assert.ok(skills2.includes(id), 'Skills2.csv 缺少超神進化 ' + id);
  });
  const affix = fs.readFileSync(path.join(root, 'config/CSV/Equipment_Affix.csv'), 'utf8');
  ['chainlightningSurge', 'chainlightningVolley', 'chainlightningScatter', 'chainlightningSuper',
    'chainlightningOverload', 'thunderstrikeTriple', 'thunderstrikeLock', 'thunderstrikeQuake',
    'thunderstrikeRebirth', 'thunderstrikeRod'].forEach((id) => {
    assert.ok(affix.includes(id), 'Equipment_Affix.csv 缺少傳奇特效 ' + id);
  });
  const status = fs.readFileSync(path.join(root, 'config/CSV/Status.csv'), 'utf8');
  assert.ok(status.includes('sgSuperconduct'), 'Status.csv 缺少超導電荷');
  assert.ok(status.includes('sgThunderQuake'), 'Status.csv 缺少震雷雷痕');
});
