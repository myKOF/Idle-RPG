/* 新版主動技能第三批：魔法系火球術／火柱（2026-08-16，js/skills2.js）
   守住設計文檔「技能」頁籤新增的「傷害範圍說明」欄所描述的作用範圍法算：
     1. 魔法群組走魔攻／魔穿，本體傷害整段歸屬火屬性
     2. 施法距離＝各階 fx.castM（火球 30 米、殞石術改 20 米、火柱 30 米）
     3. 火球術：爆炸 6 米、爆裂 20 米、爆燃我方 12 米、火焰增幅我方 20 米、殞石 15 米
     4. 火柱：地板場域 3 米連續 5 段、雙重火柱 20 米內 2 個目標、烈焰衝擊、重生、火牆 6×18 橫向
     5. 無座標（高塔）一律退化為單體語意 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext() {
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
    'js/skills.js', 'js/skills2.js']
    .forEach((file) => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file }));
  context.G = { player: { gold: 0, skills2: { levels: {} }, loadout: [] }, stage: { current: 1 } };
  // 魔法技能要看得到魔攻：物攻與魔攻刻意給不同值，才能驗出「吃的是哪一個」
  context.getStats = () => ({
    atk: 1000, matk: 500, hp: 1000, mp: 100, level: 10, aspd: 2, cdr: 0,
    critRate: 0, critDmg: 150, hit: 100, tenacity: 0,
    passives: {}, elemAtk: null, elemDmgPct: 0, elemDmgUp: {},
    eliteDmg: 0, bossDmg: 0, normalDmg: 0, totalDmgPct: 0, dmgVsElem: null,
    aoeDmg: 0, globalDmgRed: 0
  });
  context.GT = 0;
  return context;
}

function enemy(hp, x, y, name) {
  return {
    name: name || '測試怪', maxHp: hp, hp, def: 0, mdef: 0, level: 1,
    effects: {}, buffs: {}, dots: [], resist: {}, ctrlRes: 0,
    pos: (x === undefined) ? undefined : { x, y }
  };
}
function playerEnt() {
  return { hp: 1000, mp: 500, shield: 0, shieldMax: 0, skillCds: {}, buffs: {}, dots: [], effects: {}, _lockTarget: null };
}

/* 傷害管線替身：記下每一次命中的目標與攻擊組態，測「機制與範圍」不測「公式」。 */
function stubHits(c, opts) {
  const calls = [];
  c.resolveHit = function (attacker, defender, aCfg) {
    calls.push({ ent: defender, aCfg: aCfg });
    const dmg = (opts && opts.dmg) || 100;
    defender.hp = Math.max(0, defender.hp - dmg);
    return { dmg, crit: false, miss: false, blocked: false, killed: defender.hp <= 0 };
  };
  c.applySkillFinalDamageMultiplier = function () {};
  return calls;
}
function tickCtx(c, p, enemies, extra) {
  return Object.assign({
    pEnt: p, getEnemies: () => enemies, floatSel: 'mv-float', onDeaths() {}, onDamage() {}
  }, extra || {});
}
function finishFireball(c, p, enemies, at) {
  c.GT = at === undefined ? 1 : at;
  c.tickSkill2(c.GT, tickCtx(c, p, enemies));
}
/* 把等級陣列直接寫進存檔（階層循序解鎖的驗證由 skill2-system 守，這裡只擺場景）。 */
function setLevels(c, gid, levels) { c.G.player.skills2.levels[gid] = levels.slice(); }

/* ---- 1) 魔法傷害類型與屬性 ---- */

test('魔法群組：傷害基準吃魔攻、穿透吃魔穿、本體傷害整段歸屬火屬性', () => {
  const c = loadContext();
  const calls = stubHits(c);
  c.chance = () => false;
  const p = playerEnt();
  const m = enemy(100000, 60, 0);

  c.castSkill2(p, [m], 'fireball', 'mv-float');
  finishFireball(c, p, [m]);

  assert.equal(calls.length, 1);
  const aCfg = calls[0].aCfg;
  assert.equal(aCfg.dmgType, 'magic');
  assert.equal(aCfg.skillElem, 'fire');
  // 火球術 Lv.1＝150% → 魔攻 500 × 150% ＝ 750（若誤吃物攻 1000 會是 1500）
  assert.equal(Math.round(aCfg.atk), 750);
});

test('武技群組不受影響：仍是物理傷害、無屬性、吃物攻', () => {
  const c = loadContext();
  const calls = stubHits(c);
  c.chance = () => false;
  c.castSkill2(playerEnt(), [enemy(100000, 40, 0)], 'gale', 'mv-float');

  assert.ok(calls.length > 0);
  assert.equal(calls[0].aCfg.dmgType, 'phys');
  assert.equal(calls[0].aCfg.skillElem, undefined);
  assert.equal(Math.round(calls[0].aCfg.atk), 2500); // 疾風斬 250% × 物攻 1000
});

/* ---- 2) 施法距離（傷害範圍說明：射程） ---- */

test('施法距離：火球 30 米可施放、31 米不可；武技仍只有近戰 5 米', () => {
  const c = loadContext();
  stubHits(c);
  c.chance = () => false;
  const p = playerEnt();
  const far = enemy(100000, 320, 0);   // 距離 320-20＝300＝30 米，剛好在射程內
  const tooFar = enemy(100000, 340, 0); // 距離 320＝32 米，超出射程

  assert.equal(c.skills2CanReach('fireball', far), true);
  assert.equal(c.skills2CanReach('fireball', tooFar), false);
  assert.equal(c.skills2CanReach('gale', far), false);
  assert.ok(c.castSkill2(p, [far], 'fireball', 'mv-float'));
  assert.equal(c.castSkill2(playerEnt(), [tooFar], 'fireball', 'mv-float'), null);
});

/* ---- 3) 火球術 ---- */

test('一般火球：使用標準飛行物佇列，抵達前不命中且不走殞石佇列', () => {
  const c = loadContext();
  const calls = stubHits(c);
  c.chance = () => false;
  const p = playerEnt();
  const m = enemy(100000, 120, 0);

  const out = c.castSkill2(p, [m], 'fireball', 'mv-float');
  assert.equal(calls.length, 0);
  assert.equal(c.SKILL2_RT.meteors.length, 0);
  assert.equal(c.SKILL2_RT.projectiles.length, 1);
  assert.equal(out._pendingProjectiles, 1);

  c.GT = 0.05;
  c.tickSkill2(0.05, tickCtx(c, p, [m]));
  assert.equal(calls.length, 0, '一般火球尚未飛抵前不應命中');

  finishFireball(c, p, [m], 0.6);
  assert.equal(calls.length, 1);
  assert.equal(out._pendingProjectiles, 0);
});

test('火球術：命中目標與 6 米內敵人，範圍外不受影響', () => {
  const c = loadContext();
  const calls = stubHits(c);
  c.chance = () => false;
  const main = enemy(100000, 100, 0);
  const near = enemy(100000, 100, 70);  // 離爆心 70－體型 20＝50 ≤ 60（6 米）
  const out = enemy(100000, 100, 200);  // 離爆心 200－20＝180 ＞ 60

  c.castSkill2(playerEnt(), [main, near, out], 'fireball', 'mv-float');
  finishFireball(c, playerEnt(), [main, near, out]);

  const hit = calls.map((x) => x.ent);
  assert.ok(hit.indexOf(main) >= 0 && hit.indexOf(near) >= 0);
  assert.equal(hit.indexOf(out), -1);
});

test('火球術·燃燒：塗上烈焰燃燒，每跳量＝技能傷害 20%、間隔 0.5 秒', () => {
  const c = loadContext();
  stubHits(c);
  c.chance = () => false;
  setLevels(c, 'fireball', [1, 1, 0, 0, 0, 0, 0]);
  const m = enemy(100000, 100, 0);

  const p = playerEnt();
  c.castSkill2(p, [m], 'fireball', 'mv-float');
  finishFireball(c, p, [m]);

  const dot = c.sgFindDot(m, 'sgBurn');
  assert.ok(dot, '應塗上 sgBurn');
  assert.equal(dot.interval, 0.5);
  assert.equal(Math.round((dot.until - c.GT) * 100) / 100, 5);
  // 每跳量＝750（魔攻 500×150%）× 20% ＝ 150；dps＝每跳量 ÷ 間隔
  assert.equal(Math.round(dot.dps * dot.interval), 150);
});

test('火球術·強化燃燒：作用間隔縮短到 0.4 秒，每級再 -0.015 秒', () => {
  const c = loadContext();
  stubHits(c);
  c.chance = () => false;
  setLevels(c, 'fireball', [1, 1, 1, 3, 0, 0, 0]);
  const m = enemy(100000, 100, 0);

  const p = playerEnt();
  c.castSkill2(p, [m], 'fireball', 'mv-float');
  finishFireball(c, p, [m]);

  const dot = c.sgFindDot(m, 'sgBurn');
  assert.equal(Math.round(dot.interval * 1000) / 1000, 0.37); // 0.4 - 0.015×2
});

test('火球術·火球爆裂：分裂 3 個小火球打 20 米內的其他敵人，各造成 30% 傷害', () => {
  const c = loadContext();
  const calls = stubHits(c);
  c.chance = () => false;
  setLevels(c, 'fireball', [1, 1, 1, 0, 0, 0, 0]);
  const main = enemy(100000, 100, 0);
  const a = enemy(100000, 100, 300);   // 離主目標 300－40＝260 ≤ 200？否 → 不在 20 米內
  const b = enemy(100000, 100, 150);   // 離主目標 150－40＝110 ≤ 200 ✓
  const d = enemy(100000, 100, 180);
  const e = enemy(100000, 100, 210);

  const p = playerEnt();
  c.castSkill2(p, [main, a, b, d, e], 'fireball', 'mv-float');
  finishFireball(c, p, [main, a, b, d, e]);
  finishFireball(c, p, [main, a, b, d, e], 2);

  const splitCalls = calls.filter((x) => Math.round(x.aCfg.atk) === 225); // 750 × 30%
  assert.equal(splitCalls.length, 3, '應分裂出 3 個小火球');
  assert.equal(splitCalls.some((x) => x.ent === a), false, '20 米外不該被分裂火球選中');
});

test('火球術·殞石術：三顆殞石、傷害與範圍改讀第 7 階、射程縮為 20 米', () => {
  const c = loadContext();
  const calls = stubHits(c);
  c.chance = () => false;
  setLevels(c, 'fireball', [1, 0, 0, 0, 0, 0, 0]);
  const solo = enemy(1e9, 100, 0);
  const p = playerEnt();
  c.castSkill2(p, [solo], 'fireball', 'mv-float');
  finishFireball(c, p, [solo]);
  const baseHits = calls.length;

  const c2 = loadContext();
  const calls2 = stubHits(c2);
  c2.chance = () => false;
  setLevels(c2, 'fireball', [1, 1, 1, 1, 1, 1, 1]);
  const solo2 = enemy(1e9, 100, 0);
  const out2 = c2.castSkill2(playerEnt(), [solo2], 'fireball', 'mv-float');

  assert.equal(baseHits, 1);
  assert.equal(calls2.length, 0, '殞石尚未落地前不應提前扣血');
  assert.equal(c2.SKILL2_RT.meteors.length, 3, '應建立三個獨立落地事件');
  assert.equal(out2._pendingProjectiles, 3);
  assert.equal(Math.round((c2.SKILL2_RT.meteors[1].at - c2.SKILL2_RT.meteors[0].at) * 1000), 350);
  assert.equal(Math.round((c2.SKILL2_RT.meteors[2].at - c2.SKILL2_RT.meteors[1].at) * 1000), 350);
  // 三顆殞石各打一次主目標（本體），第 3 階分裂沒有其他敵人可選
  c2.GT = 10;
  c2.tickSkill2(0, tickCtx(c2, playerEnt(), [solo2]));
  assert.equal(calls2.filter((x) => x.ent === solo2 && Math.round(x.aCfg.atk) === 1250).length, 3);
  const meteorBurn = c2.sgFindDot(solo2, 'sgBurn');
  assert.ok(meteorBurn, '殞石命中後應保留燃燒');
  assert.equal(Math.round(meteorBurn.dps * meteorBurn.interval), 500, '殞石燃燒傷害應為 2 倍');
  assert.equal(out2._pendingProjectiles, 0, '三顆落地後才完成技能命中');
  // 射程由第 7 階改寫為 20 米
  assert.equal(c2.skills2CastRangePx('fireball', c2.skills2Levels('fireball')), c2.bfMeterPx(20));
});

test('殞石術：三顆會在附近有多名敵人時先各自隨機取不同目標', () => {
  const c = loadContext();
  stubHits(c);
  c.chance = () => false;
  setLevels(c, 'fireball', [1, 1, 1, 1, 1, 1, 1]);
  const main = enemy(1e9, 100, 0, '主目標');
  const east = enemy(1e9, 210, 0, '東側');
  const north = enemy(1e9, 100, 110, '北側');
  c.castSkill2(playerEnt(), [main, east, north], 'fireball', 'mv-float');

  const selected = c.SKILL2_RT.meteors.map((m) => m.target);
  assert.equal(selected.length, 3);
  assert.equal(new Set(selected).size, 3, '附近有三名敵人時不應三顆全鎖同一目標');
});

test('殞石術：落地前不查詢範圍命中，落地時才依當下位置結算', () => {
  const c = loadContext();
  const calls = stubHits(c);
  c.chance = () => false;
  setLevels(c, 'fireball', [1, 1, 1, 1, 1, 1, 1]);
  const main = enemy(1e9, 100, 0, '落點');
  const late = enemy(1e9, 500, 0, '落地前才進範圍');
  const p = playerEnt();

  c.castSkill2(p, [main, late], 'fireball', 'mv-float');
  assert.equal(calls.length, 0);

  // 15 米範圍內的判定刻意在施放後才成立；只有落地查詢才應看到它。
  late.pos.x = 120;
  c.GT = 0.99;
  c.tickSkill2(0, tickCtx(c, p, [main, late]));
  assert.equal(calls.length, 0, '落地前即使敵人已進入範圍也不能提前扣血');

  c.GT = 2.1;
  c.tickSkill2(0, tickCtx(c, p, [main, late]));
  assert.equal(calls.filter((x) => x.ent === late).length, 3, '三顆殞石落地時才應各自檢查並命中範圍內敵人');
});

test('火球術·爆燃：燃燒結束時對我方 12 米內 2 個敵人造成累積傷害的 50%', () => {
  const c = loadContext();
  stubHits(c);
  c.chance = () => false;
  setLevels(c, 'fireball', [1, 1, 1, 1, 1, 0, 0]);
  const p = playerEnt();
  const burned = enemy(100000, 100, 0);
  const near1 = enemy(100000, 60, 0);   // 我方 60－20＝40 ≤ 120（12 米）
  const near2 = enemy(100000, 80, 0);
  const far = enemy(100000, 600, 0);    // 遠在 12 米外
  const enemies = [burned, near1, near2, far];

  c.castSkill2(p, [burned], 'fireball', 'mv-float');
  finishFireball(c, p, enemies);
  const dot = c.sgFindDot(burned, 'sgBurn');
  const total = dot.dps * (dot.until - c.GT);

  // 讓燃燒自然結束（DoT 實例過期），節拍器應在下一個 tick 引爆
  const before = [near1.hp, near2.hp, far.hp];
  c.GT = dot.until + 0.01;
  burned.dots.length = 0;
  c.tickSkill2(0.5, tickCtx(c, p, enemies));

  assert.ok(near1.hp < before[0] && near2.hp < before[1], '我方 12 米內的兩個敵人應被爆燃波及');
  assert.equal(far.hp, before[2], '12 米外不該被波及');
  const dealt = before[0] - near1.hp;
  assert.equal(dealt, Math.max(1, Math.round(total * 0.5)));
  assert.equal(burned._sgBurnWatch, null, '引爆後應清掉快照，不得重複引爆');
});

test('火球術·火焰增幅：燃燒每作用 1 次疊 0.25% 火傷，且掛進屬性傷害提升的唯一收斂點', () => {
  const c = loadContext();
  stubHits(c);
  c.chance = () => false;
  setLevels(c, 'fireball', [1, 1, 1, 1, 1, 1, 0]);
  const p = playerEnt();
  const m = enemy(100000, 100, 0);

  c.castSkill2(p, [m], 'fireball', 'mv-float');
  assert.equal(c.skill2FireAmpPct(p), 0);

  c.GT = 0.5;
  c.tickSkill2(0.5, tickCtx(c, p, [m]));
  assert.equal(Math.round(c.skill2FireAmpPct(p) * 1000) / 1000, 0.25);

  c.GT = 1.0;
  c.tickSkill2(0.5, tickCtx(c, p, [m]));
  assert.equal(Math.round(c.skill2FireAmpPct(p) * 1000) / 1000, 0.5, '無限疊加：第二次作用再疊一層');

  // 掛點：js/legendary.js 的 legendaryElementDamageUp 是全專案唯一的屬性傷害提升收斂點
  const legendary = fs.readFileSync(path.join(root, 'js/legendary.js'), 'utf8');
  assert.match(legendary, /skill2FireAmpPct\(pEnt\)/);
  assert.match(legendary, /out\.fire = \(out\.fire \|\| 0\) \+ fireAmp;/);
});

/* ---- 4) 火柱（地板場域） ---- */

test('火柱：地板場域連續 5 段、每段 60% 魔攻，打完就消失', () => {
  const c = loadContext();
  const calls = stubHits(c);
  c.chance = () => false;
  const p = playerEnt();
  const m = enemy(1e9, 100, 0);

  const out = c.castSkill2(p, [m], 'firepillar', 'mv-float');
  assert.ok(out);
  assert.equal(calls.length, 0, '火柱是地板技能：施放當下不造成傷害');
  assert.equal(c.SKILL2_RT.grounds.length, 1);

  for (let i = 1; i <= 6; i++) {
    c.GT = i * 0.5;
    c.tickSkill2(0.5, tickCtx(c, p, [m]));
  }
  assert.equal(calls.length, 5, '2.5 秒內共 5 段');
  assert.equal(Math.round(calls[0].aCfg.atk), 300); // 魔攻 500 × 60%
  assert.equal(calls[0].aCfg.skillElem, 'fire');
  assert.equal(c.SKILL2_RT.grounds.length, 0, '打完 5 段後場域消失');
});

test('火柱：傷害範圍是目標周圍 3 米，範圍外的敵人不受影響', () => {
  const c = loadContext();
  const calls = stubHits(c);
  c.chance = () => false;
  const p = playerEnt();
  const m = enemy(1e9, 100, 0);
  const near = enemy(1e9, 100, 45);   // 離柱心 45－20＝25 ≤ 30（3 米）
  const out = enemy(1e9, 100, 120);   // 離柱心 120－20＝100 ＞ 30

  c.castSkill2(p, [m, near, out], 'firepillar', 'mv-float');
  c.GT = 0.5;
  c.tickSkill2(0.5, tickCtx(c, p, [m, near, out]));

  const hit = calls.map((x) => x.ent);
  assert.ok(hit.indexOf(m) >= 0 && hit.indexOf(near) >= 0);
  assert.equal(hit.indexOf(out), -1);
});

test('火柱·雙重火柱：同時對 2 個目標施放，且火屬性傷害額外 +20%', () => {
  const c = loadContext();
  const calls = stubHits(c);
  c.chance = () => false;
  setLevels(c, 'firepillar', [1, 1, 1, 0, 0, 0, 0]);
  const p = playerEnt();
  const a = enemy(1e9, 100, 0);
  const b = enemy(1e9, 100, 150); // 離主目標 150－40＝110 ≤ 200（20 米）

  c.castSkill2(p, [a, b], 'firepillar', 'mv-float');
  assert.equal(c.SKILL2_RT.grounds.length, 2);

  // 多根柱子的節拍刻意錯開一點，兩根都作用過才比對命中集合
  for (let i = 1; i <= 2; i++) {
    c.GT = i * 0.5;
    c.tickSkill2(0.5, tickCtx(c, p, [a, b]));
  }
  const hit = calls.map((x) => x.ent);
  assert.ok(hit.indexOf(a) >= 0 && hit.indexOf(b) >= 0);
  assert.equal(Math.round(calls[0].aCfg.atk), 400); // 魔攻 500 ×（60%＋20%）
});

test('火柱·烈焰衝擊：場域不再追擊，消失時對周圍 6 米造成 100% 火焰傷害', () => {
  const c = loadContext();
  const calls = stubHits(c);
  const vfxEvents = [];
  c.playCombatVfx = (spec) => vfxEvents.push(spec);
  c.chance = () => false;
  setLevels(c, 'firepillar', [1, 1, 1, 1, 1, 0, 0]);
  const p = playerEnt();
  const m = enemy(1e9, 100, 0);
  const near = enemy(1e9, 100, 100); // 超出火龍捲 3 米半徑，但仍在烈焰衝擊 6 米內
  const out = enemy(1e9, 100, 200);

  c.castSkill2(p, [m, near, out], 'firepillar', 'mv-float');
  const field = c.SKILL2_RT.grounds[0];
  assert.equal(field.pos.x, 100);

  m.pos.x = 300; // 目標跑掉了，場域仍應留在原地
  c.GT = 0.5;
  c.tickSkill2(0.5, tickCtx(c, p, [m, near, out]));
  assert.equal(Math.round(field.pos.x), 100, '烈焰衝擊改制後，火龍捲不應追擊目標');

  for (let i = 2; i <= 5; i++) {
    c.GT = i * 0.5;
    c.tickSkill2(0.5, tickCtx(c, p, [m, near, out]));
  }
  const nearHitsBeforeExpire = calls.filter((x) => x.ent === near).length;
  c.GT = 3.0;
  c.tickSkill2(0.5, tickCtx(c, p, [m, near, out]));
  const impactHits = calls.filter((x) => x.ent === near);
  const newNearHits = impactHits.slice(nearHitsBeforeExpire);
  assert.equal(newNearHits.filter((x) => Math.round(x.aCfg.atk) === 600).length, 1,
    '場域消失時應只對 6 米內敵人新增一次烈焰衝擊');
  assert.equal(Math.round(newNearHits.at(-1).aCfg.atk), 600, '第 5 階 Lv.1 100% 應加上第 3 階火焰傷害增幅');
  const impactVfx = vfxEvents.filter((x) => x.variant === 'firepillar-impact');
  assert.ok(impactVfx.length > 0, '烈焰衝擊應發送獨立爆炸衝擊波 VFX');
  assert.ok(impactVfx.every((x) => x.area && x.area.r === 60), '烈焰衝擊 VFX 應帶 6 米範圍');
  assert.equal(calls.filter((x) => x.ent === out).length, 0, '6 米外敵人不應受到烈焰衝擊');
});

test('火柱·重生：消失後機率成立時在我方範圍內的敵人身上重來一次', () => {
  const c = loadContext();
  stubHits(c);
  const p = playerEnt();
  const m = enemy(1e9, 100, 0);
  const other = enemy(1e9, 150, 0);

  c.chance = () => false;
  setLevels(c, 'firepillar', [1, 1, 1, 1, 1, 1, 0]);
  c.castSkill2(p, [m, other], 'firepillar', 'mv-float');
  // 投資到第 6 階必然也經過第 3 階【雙重火柱】＝一次施放 2 根柱子
  const spawned = c.SKILL2_RT.grounds.length;
  assert.equal(spawned, 2);
  c.chance = () => true; // 重生必定成立
  for (let i = 1; i <= 5; i++) {
    c.GT = i * 0.5;
    c.tickSkill2(0.5, tickCtx(c, p, [m, other]));
  }
  assert.equal(c.SKILL2_RT.grounds.length, spawned, '每根火柱消失後都應重生一根新的');
  assert.ok(c.SKILL2_RT.grounds.some((f) => f.hitsLeft === 5), '重生的火柱段數重新計算');
});

test('火柱·無限火牆：3 道橫向 6×18 米火牆、每道 8 段，且每道只再召喚 1 次', () => {
  const c = loadContext();
  const calls = stubHits(c);
  c.chance = () => false;
  setLevels(c, 'firepillar', [1, 1, 1, 1, 1, 1, 1]);
  const p = playerEnt();
  const m = enemy(1e9, 200, 0);
  // 只用主目標施放，三道火牆就都疊在他腳下；形狀探針稍後才進場，
  // 才不會各自被分到一道自己的火牆而測不出「範圍」。
  c.castSkill2(p, [m], 'firepillar', 'mv-float');
  assert.equal(c.SKILL2_RT.grounds.length, 3);
  assert.equal(c.SKILL2_RT.grounds[0].kind, 'wall');
  assert.equal(c.SKILL2_RT.grounds[0].hitsLeft, 8);
  // 第 2 階【強化火柱】的範圍擴大 10% 對火牆一樣生效（設計文檔：2~6 階效果仍然生效）
  assert.equal(Math.round(c.SKILL2_RT.grounds[0].length), Math.round(c.bfMeterPx(18) * 1.1));
  assert.equal(Math.round(c.SKILL2_RT.grounds[0].width), Math.round(c.bfMeterPx(6) * 1.1));
  assert.equal(c.SKILL2_RT.grounds[0].respawnLeft, 1);

  // 火牆橫向＝與我方視線垂直：與主目標同 x、y 相差 80（8 米）者落在 18 米長度內；
  // 沿視線再往後 20 米者則超出 6 米寬度。
  const side = enemy(1e9, 200, 80);
  const behind = enemy(1e9, 400, 0);
  c.GT = 0.5;
  c.tickSkill2(0.5, tickCtx(c, p, [m, side, behind]));
  const hit = calls.map((x) => x.ent);
  assert.ok(hit.indexOf(side) >= 0, '橫向 18 米長度內的敵人應被火牆命中');
  assert.equal(hit.indexOf(behind), -1, '視線方向 20 米外超出 6 米寬度，不該被命中');

  // 每道火牆消失後只能再召喚 1 道，不可無限觸發
  c.chance = () => false; // 關掉第 6 階【重生】，只留第 7 階的再召喚
  for (let i = 1; i <= 20; i++) {
    c.GT = i * 0.5;
    c.tickSkill2(0.5, tickCtx(c, p, [m, side, behind]));
  }
  assert.equal(c.SKILL2_RT.grounds.filter((f) => f.respawnLeft > 0).length, 0);
  assert.equal(c.SKILL2_RT.grounds.length, 0, '再召喚的火牆打完就結束，不會再生');
});

/* ---- 5) 無座標（高塔）退化 ---- */

test('高塔（無座標）：火球術與火柱都退化為單體語意，不會漏打也不會多打', () => {
  const c = loadContext();
  const calls = stubHits(c);
  c.chance = () => false;
  const p = playerEnt();
  const boss = enemy(1e9); // 無 pos

  c.castSkill2(p, boss, 'fireball', 'tb-float');
  finishFireball(c, p, [boss]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].ent, boss);

  const c2 = loadContext();
  const calls2 = stubHits(c2);
  c2.chance = () => false;
  const p2 = playerEnt();
  const boss2 = enemy(1e9);
  c2.castSkill2(p2, boss2, 'firepillar', 'tb-float');
  assert.equal(c2.SKILL2_RT.grounds.length, 1);
  assert.equal(c2.SKILL2_RT.grounds[0].pos, null);
  for (let i = 1; i <= 6; i++) {
    c2.GT = i * 0.5;
    c2.tickSkill2(0.5, tickCtx(c2, p2, [boss2]));
  }
  assert.equal(calls2.length, 5, '無座標時仍應打滿 5 段');
});

/* ---- 6) 存檔與參數表 ---- */

test('兩個新群組可裝載、可升級，且參數表往返一致', () => {
  const c = loadContext();
  c.G.player.gold = 1e12;
  assert.equal(c.skills2Learn('fireball', 1), null);
  assert.equal(c.skills2Learn('firepillar', 1), null);
  assert.equal(c.equipSkillToLoadout('sg:fireball'), null);
  assert.equal(c.equipSkillToLoadout('sg:firepillar'), null);

  const csv = fs.readFileSync(path.join(root, 'config/CSV/Skills2.csv'), 'utf8').replace(/^﻿/, '');
  const rows = csv.trim().split(/\r?\n/);
  assert.match(rows[0], /傷害類型/);
  assert.match(rows[0], /傷害屬性/);
  assert.ok(rows.some((r) => r.indexOf('fireball,火球術') === 0 && r.indexOf('magic,fire') > 0));
  assert.ok(rows.some((r) => r.indexOf('firepillar,火龍捲') === 0 && r.indexOf('magic,fire') > 0));
});
