const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const geometry = require('../tools/skills2-geometry.cjs');
const root = path.resolve(__dirname, '..');

function load(lv = 1, roll = 0.999) {
  const events = [], hits = [];
  const c = { console, Math: Object.create(Math), setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    UI: { dirty: {} }, blog() {}, floatText() {}, trackDps() {}, recordRunDamage() {},
    floatEnemyEvent() {}, floatPlayerEvent() {} };
  c.window = c;
  vm.createContext(c);
  for (const file of ['util', 'data', 'status', 'formula', 'battlefield', 'combat', 'skills', 'skills2']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'js', file + '.js'), 'utf8'), c, { filename: file });
  }
  const g = c.SKILLS2.thunderstrike;
  g.tiers[5].fx.chance = 0;
  g.tiers[5].fx.chancePer = 0;
  // 驗證使用者透過 BAT 套用後的正式配置，缺失時直接失敗。
  const option = g.ult.find(u => u.id === 'eternalThunderPrison');
  assert.equal(option.fx.count, 2); assert.equal(option.fx.countPer, 0.2); assert.equal(option.fx.m, 30);
  c.G = { player: { skills2: { levels: { thunderstrike: [10, 10, 10, 10, 10, 10, 10] },
    ult: { thunderstrike: { pick: c.sgUltIndexOfId('thunderstrike', 'eternalThunderPrison'), lv } } },
    loadout: ['sg:thunderstrike'] }, stage: { current: 1 } };
  const p = { hp: 1000, mp: 1000000, effects: {}, buffs: {}, dots: [], skillCds: {} };
  const st = { hp: 1000, mp: 1000000, atk: 1000, matk: 500, level: 10,
    critRate: 0, critDmg: 150, hit: 100, cdr: 0, passives: {}, elemDmgUp: {},
    legendaryEffects: {}, legendaryEffectMults: {} };
  c.getStats = () => st;
  c.Math.random = () => roll;
  c.playCombatVfx = spec => events.push({ at: c.GT, spec });
  c.enemyEventFloatTarget = ent => ent.name;
  c.playerEventFloatTarget = sel => sel;
  c.resolveHit = (attacker, target, cfg) => {
    hits.push({ at: c.GT, target, cfg });
    const mode = target.mode;
    if (mode === 'kill') target.hp = 0;
    return { dmg: mode === 'miss' || mode === 'invuln' ? 0 : 100,
      miss: mode === 'miss', invuln: mode === 'invuln', killed: mode === 'kill', crit: false };
  };
  c.applySkillFinalDamageMultiplier = () => {};
  c.GT = 0;
  const levels = [10, 10, 10, 10, 10, 0, 0]; // 只隔離關閉本次落雷的再生與範圍，不改超神解鎖。
  function bolt(target, enemies, lvs = levels, out = { dmg: 0, killed: false }) {
    c.sgQueueThunderBolt(p, st, g, lvs, 1000, target, enemies, 'mv-float', out, 0, 0);
    return out;
  }
  function tick(enemies, at) {
    c.GT = at;
    c.sgTickMeteors({ pEnt: p, getEnemies: () => enemies, onDamage() {}, onDeaths() {} });
  }
  function settle(enemies) {
    let guard = 0;
    while (c.SKILL2_RT.meteors.length && guard++ < 100) {
      tick(enemies, Math.max(c.GT, Math.min(...c.SKILL2_RT.meteors.map(m => m.at))));
    }
    assert.ok(guard < 100, '有限預算必須結束，不可無限重啟');
  }
  return { c, p, st, g, events, hits, bolt, tick, settle };
}
function enemy(name, x) {
  return { name, hp: 1e9, maxHp: 1e9, level: 1, pos: { x, y: 0 },
    effects: {}, buffs: {}, dots: [], resist: {}, ctrlRes: 0 };
}

test('永恒接續：實際命中才接下一道，範圍以命中敵人為圓心且不受玩家射程限制', () => {
  const h = load();
  const a = enemy('a', 200), b = enemy('b', 450), d = enemy('d', 700), far = enemy('far', 1500);
  const pool = [a, b, d, far];
  const out = h.bolt(a, pool);
  assert.equal(h.hits.length, 0);
  h.tick(pool, 0.128);
  assert.equal(h.events.length, 1, '落地前只有原始落雷，沒有預先追加');
  h.tick(pool, 0.129);
  assert.equal(h.hits.length, 1);
  assert.equal(h.events.filter(e => e.spec.variant === 'thunder-strike').length, 2);
  h.settle(pool);
  assert.deepEqual(h.hits.map(e => e.target.name), ['a', 'b', 'd']);
  assert.equal(h.hits[1].at, 0.258);
  assert.equal(h.hits[2].at, 0.387);
  assert.equal(out._pendingProjectiles, 0);
  assert.equal(h.p.mp, 1000000, '追加不扣法力');
  assert.deepEqual(h.p.skillCds, {}, '追加不寫技能冷卻');
  for (const e of h.events.filter(e => e.spec.variant === 'thunder-strike')) {
    assert.equal(e.spec.vfx.attack, 'bolt-thunderstrike-bluewhite');
    assert.equal(e.spec.travelMs[0], 129);
  }
});

test('永恒接續：每級+0.2沿小數機率，Lv1有2或3道追加、Lv10固定4道', () => {
  for (const [lv, roll, total] of [[1, 0.999, 3], [1, 0, 4], [5, 0.999, 4], [10, 0.999, 5]]) {
    const h = load(lv, roll), pool = [enemy('a', 50), enemy('b', 60)];
    h.bolt(pool[0], pool);
    h.settle(pool);
    const bolts = h.events.filter(e => e.spec.variant === 'thunder-strike');
    assert.equal(bolts.length, total, '包含原始一道，範圍傷害不算額外落雷');
    assert.ok(bolts.every((bolt, i) => i === 0 || bolt.spec.targets[0] !== bolts[i-1].spec.targets[0]), '只有兩名時輪流，不自打');
  }
});

test('永恒新配置：正式施放只付一次法力／冷卻，命中接續且說明讀取30米與成長道數', () => {
  const h = load(), pool = [enemy('a', 200), enemy('b', 450), enemy('c', 700)];
  // 將普通階追加數歸零，隔離一次本體施放；超神參數仍讀正式表格。
  h.g.tiers[0].fx.count = 1;
  for (const i of [1, 2]) { h.g.tiers[i].fx.add = 0; h.g.tiers[i].fx.addPer = 0; }
  h.g.tiers[6].fx.mult = 1;
  const out = h.c.castSkill2(h.p, pool, 'thunderstrike', 'mv-float');
  assert.ok(out);
  assert.equal(h.p.mp, 990000);
  const cd = h.p.skillCds['sg:thunderstrike'];
  assert.ok(cd > 0);
  assert.equal(h.c.SKILL2_RT.ultRepeat.thunderstrike, undefined);
  h.settle(pool);
  assert.equal(h.events.filter(e => e.spec.variant === 'thunder-strike').length, 3);
  assert.equal(h.p.mp, 990000); assert.equal(h.p.skillCds['sg:thunderstrike'], cd);
  assert.match(h.c.describeSkill2Ult('thunderstrike', 2, 1), /30 米.*2.2 道/);
});

test('永恒接續：隨機選敵且優先不重複，完整一輪後才重新選取', () => {
  const results = new Set();
  for (const roll of [0, 0.3, 0.6, 0.999]) {
    const h = load(10, roll), pool = [enemy('a', 50), enemy('b', 80), enemy('c', 100), enemy('d', 120)];
    h.bolt(pool[0], pool); h.settle(pool);
    const bolts = h.events.filter(e => e.spec.variant === 'thunder-strike');
    results.add(bolts[1].spec.targets[0]);
    assert.equal(new Set(bolts.slice(0, 4).map(x => x.spec.targets[0])).size, 4);
  }
  assert.ok(results.size > 1, '不固定最近、最低血或陣列第一個');
});

test('永恒接續：30米沿既有體型邊緣距離，邊界內選取、邊界外不選取', () => {
  for (const margin of [-0.01, 0.01]) {
    const h = load(), a = enemy('a', 50), b = enemy('b', 0);
    b.pos.x = a.pos.x + 300 + h.c.bfEntityRadius(a) + h.c.bfEntityRadius(b) + margin;
    h.bolt(a, [a, b]); h.tick([a, b], 0.129);
    assert.equal(h.events.filter(e => e.spec.variant === 'thunder-strike').length, margin < 0 ? 2 : 1);
  }
});

test('永恒接續：無其他敵人、範圍外、閃避／無敵不續接；致死命中可以接續', () => {
  for (const mode of ['alone', 'far', 'miss', 'invuln', 'kill']) {
    const h = load(), a = enemy('a', 50), b = enemy('b', mode === 'far' ? 1500 : 80);
    a.mode = mode;
    const pool = mode === 'alone' ? [a] : [a, b];
    h.bolt(a, pool); h.settle(pool);
    assert.equal(h.hits.length, mode === 'kill' ? 2 : 1, mode);
  }
});

test('永恒接續：再生共用追加預算，不重置上限或啟動舊自動重施', () => {
  const h = load(), pool = [enemy('a', 50), enemy('b', 100)];
  h.c.chance = pct => pct >= 100;
  h.g.tiers[5].fx.chance = 100;
  h.g.tiers[5].fx.max = 2;
  const out = h.bolt(pool[0], pool, [10, 10, 10, 10, 10, 10, 0]);
  h.settle(pool);
  const bolts = h.events.filter(e => e.spec.variant === 'thunder-strike');
  assert.ok(bolts.length <= 9, '原始與兩道追加各至多兩次再生，不因接續重開預算');
  assert.ok(bolts.length > 3, '保留迅雷重生');
  assert.equal(out._pendingProjectiles, 0);
  h.c.sgArmUltRepeat('thunderstrike');
  assert.equal(h.c.SKILL2_RT.ultRepeat.thunderstrike, undefined);
  h.c.SKILL2_RT.ultRepeat.thunderstrike = { until: 10, nextAt: 0.5, gap: 0.5 };
  h.c.sgTickUltRepeat({ pEnt: h.p, getEnemies: () => pool }, 0.1);
  assert.equal(h.c.SKILL2_RT.ultRepeat.thunderstrike, undefined, '參數熱套用也撤掉舊重施');
});

test('永恒接續：追加待落地時目標死亡／離場、玩家死亡／卸下／換超神均取消', () => {
  for (const mode of ['deadTarget', 'removedTarget', 'deadPlayer', 'unequip', 'otherUlt', 'reset']) {
    const h = load(), a = enemy('a', 50), b = enemy('b', 100), pool = [a, b];
    const out = h.bolt(a, pool); h.tick(pool, 0.129);
    assert.equal(h.c.SKILL2_RT.meteors.length, 1, '確實已排入追加落雷，再測取消');
    if (mode === 'deadTarget') b.hp = 0;
    if (mode === 'removedTarget') pool.pop();
    if (mode === 'deadPlayer') {
      h.p.hp = 0;
      h.c.tickSkill2(0.01, { pEnt: h.p, getEnemies: () => pool, onDamage() {}, onDeaths() {} });
      h.p.hp = 1000; // 倒地已取消的追加不能等復活後補落地。
    }
    if (mode === 'unequip') h.c.G.player.loadout = [];
    if (mode === 'otherUlt') h.c.G.player.skills2.ult.thunderstrike.pick = 0;
    if (mode === 'reset') h.c.resetSkill2RT();
    h.tick(pool, 0.258);
    assert.equal(h.hits.length, 1, mode);
    if (mode !== 'reset') assert.equal(out._pendingProjectiles, 0, '取消也回收待結算數');
  }
});

test('永恒新參數搜敵欄接入幾何管線，不會混成傷害範圍', () => {
  const fx = geometry.apply('thunderstrike', 'eternalThunderPrison', { count: 2, countPer: 0.2 },
    column => column === geometry.labels.search ? '30' : '').fx;
  assert.deepEqual(fx, { count: 2, countPer: 0.2, m: 30 });
  assert.equal(geometry.extract('thunderstrike', 'eternalThunderPrison', fx, '')[geometry.labels.search], '30');
});
