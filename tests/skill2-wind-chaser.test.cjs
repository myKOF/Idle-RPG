const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));

function fixture(level = 1, selected = true) {
  const c = { console, Math: Object.create(Math), setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    UI: { dirty: {} }, blog() {}, floatText() {} };
  c.window = c;
  vm.createContext(c);
  for (const name of ['util', 'data', 'status', 'formula', 'battlefield', 'combat', 'skills', 'skills2']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8'), c);
  }
  c.G = { player: { level: 800, gold: 1e15, skills2: { levels: { cleave: Array(7).fill(10) }, ult: {} },
    loadout: ['sg:cleave'] }, stage: { current: 1 } };
  if (selected) c.G.player.skills2.ult.cleave = { pick: c.sgUltIndexOfId('cleave', 'windChaser'), lv: level };
  c.GT = 0;
  const st = { atk: 1000, matk: 500, hp: 1000, mp: 10000, level: 800, aspd: 2, cdr: 0,
    critRate: 0, critDmg: 150, hit: 100, tenacity: 0, passives: {}, legendaryEffects: {}, legendaryEffectMults: {},
    elemDmgUp: {}, elemDmgPct: 0, totalDmgPct: 0, aoeDmg: 0 };
  c.getStats = () => st;
  const p = { hp: 1000, mp: 10000, skillCds: {}, buffs: {}, dots: [], effects: {}, shield: 0 };
  const enemy = { name: '目標', hp: 1e9, maxHp: 1e9, def: 0, mdef: 0, level: 1,
    buffs: {}, effects: {}, dots: [], resist: {}, pos: { x: 20, y: 0 } };
  c.FIELD = { player: p };
  const hits = [], events = [], records = [], reported = [];
  c.Math.random = () => 0.05;
  c.resolveHit = (_, target, cfg) => {
    const dmg = cfg.atk;
    hits.push({ target, cfg }); target.hp -= dmg;
    return { dmg, crit: false, miss: false, blocked: false, killed: target.hp <= 0 };
  };
  c.trackDps = c.applySkillFinalDamageMultiplier = () => {};
  c.recordRunDamage = (...args) => records.push(args);
  c.playCombatVfx = spec => events.push(plain(spec));
  c.enemyEventFloatTarget = target => target.name;
  const out = { dmg: 0, crit: false, killed: false };
  const ctx = { pEnt: p, getEnemies: () => [enemy], floatSel: 'mv-float',
    onDamage: dmg => reported.push(dmg), onDeaths() {} };
  const u = c.sgUlt('cleave', 'windChaser');
  const hook = { pEnt: p, st, out, floatSel: 'mv-float',
    vacuum: u ? { chance: c.sgUltVal(u, 'chance'), pct: c.sgUltVal(u, 'pct') } : null };
  return { c, st, p, enemy, hits, events, records, reported, ctx, out, hook };
}

function advance(f, seconds = 3) {
  for (let i = 0; i < seconds * 20; i++) { f.c.GT += 0.05; f.c.tickSkill2(0.05, f.ctx); }
}

test('逐風者配置固定10%機率，風系與本體傷害各自每級成長', () => {
  const f = fixture();
  const fx = f.c.SKILLS2.cleave.ult.find(u => u.id === 'windChaser').fx;
  assert.deepEqual(plain(fx), { chance: 10, pct: 200, pctPer: 20, cleavePct: 150, cleavePctPer: 15 });
  assert.equal(f.c.sgVal(fx, 'pct', 1), 220);
  assert.equal(f.c.sgVal(fx, 'pct', 10), 400);
  assert.equal(f.c.sgVal(fx, 'cleavePct', 1), 165);
  assert.equal(f.c.sgVal(fx, 'cleavePct', 10), 300);
  assert.equal(f.c.sgVal(fx, 'chance', 10), 10);
});

test('逐風者命中機率邊界、MISS及未選技能都不多觸發', () => {
  for (const [roll, miss, selected, expected] of [[0.099999, false, true, 1], [0.1, false, true, 0],
    [0.5, false, true, 0], [0, true, true, 0], [0, false, false, 0]]) {
    const f = fixture(10, selected);
    f.c.Math.random = () => roll;
    f.c.sgCleaveOnHit(f.hook, f.enemy, { miss }, f.ctx);
    assert.equal(f.hits.length, expected, `${roll}, MISS=${miss}, selected=${selected}`);
    assert.equal(f.events.length, expected);
    assert.equal(f.c.SKILL2_RT.grounds.length, 0);
  }
});

test('逐風者成功只造成一道風系傷害，沿用物攻並計入來源及非同步傷害統計', () => {
  const f = fixture(10);
  f.c.sgCleaveOnHit(f.hook, f.enemy, { miss: false }, f.ctx);
  assert.equal(f.hits.length, 1);
  assert.equal(f.hits[0].cfg.atk, 4000);
  assert.equal(f.hits[0].cfg.skillElem, 'wind');
  assert.equal(f.out.dmg, 4000);
  assert.deepEqual(f.reported, [4000]);
  assert.equal(f.records[0][2], 'skill2:cleave');
  assert.equal(f.records[0][4], '逐風者真空斬');
  assert.deepEqual(f.events[0].vfx, { attack: 'slash-wind-crescent', hit: 'hit-wind' });
  assert.equal(f.events[0].variant, 'wind-chaser-slash');
  assert.equal(f.events[0].count, 1);
  assert.equal(f.events[0].angle, 0);
  assert.deepEqual(f.events[0].targets, ['目標']);
  assert.equal(f.events[0].area, null, '單體搜敵距離不能放大傷害或特效');
});

test('逐風者觸發特效可配置、留白不繼承本體或龍捲風欄', () => {
  for (const custom of [{ attack: 'custom-slash', hit: 'custom-hit', ground: 'legacy-tornado' },
    { ground: 'legacy-tornado' }, {}]) {
    const f = fixture();
    f.c.SKILLS2.cleave.ult.find(u => u.id === 'windChaser').triggerVfx = custom;
    f.c.sgCleaveOnHit(f.hook, f.enemy, { miss: false }, f.ctx);
    const expected = {};
    if (custom.attack) expected.attack = custom.attack;
    if (custom.hit) expected.hit = custom.hit;
    assert.deepEqual(f.events[0].vfx, expected);
    assert.equal(f.hits.length, 1, '配置外觀不影響傷害');
  }
});

test('逐風者追加段MISS只播放斬擊；擊殺仍保留受擊目標且回報死亡', () => {
  const miss = fixture();
  miss.c.resolveHit = () => ({ miss: true });
  miss.c.sgCleaveOnHit(miss.hook, miss.enemy, { miss: false }, miss.ctx);
  assert.deepEqual(miss.events[0].vfx, { attack: 'slash-wind-crescent' });
  assert.equal(miss.out.dmg, 0);
  const kill = fixture(); let deaths = 0;
  kill.enemy.hp = 100;
  kill.ctx.onDeaths = () => deaths++;
  kill.c.sgCleaveOnHit(kill.hook, kill.enemy, { miss: false }, kill.ctx);
  assert.equal(deaths, 1);
  assert.deepEqual(kill.events[0].targets, ['目標']);
});

for (const level of [1, 10]) {
  test(`逐風者 Lv.${level} 迴旋斬乘法增傷與真空斬係數分離`, () => {
    const base = fixture(level, false), f = fixture(level);
    for (const item of [base, f]) {
      item.c.sgCastCleave(item.p, item.st, item.c.SKILLS2.cleave, Array(7).fill(10),
        [item.enemy], item.enemy, 'mv-float', item.out);
      advance(item);
    }
    const physical = f.hits.filter(h => !h.cfg.skillElem), wind = f.hits.filter(h => h.cfg.skillElem === 'wind');
    assert.equal(physical.length, base.hits.length, '增傷不額外增加本體刀波');
    assert.ok(physical.length > 0);
    assert.ok(Math.abs(physical[0].cfg.atk / base.hits[0].cfg.atk - (level === 1 ? 2.65 : 4)) < 1e-12);
    assert.equal(wind.length, physical.length, '每次成功本體命中恰有一道追加，不遞迴');
    assert.ok(wind.every(h => h.cfg.atk === (level === 1 ? 2200 : 4000)));
    assert.equal(f.c.SKILL2_RT.grounds.length, 0);
    assert.equal(f.out.dmg, f.hits.reduce((n, h) => n + h.cfg.atk, 0));
    assert.equal(f.reported.reduce((a, b) => a + b, 0), f.out.dmg);
  });
}

test('逐風者正式施放、無座標高塔與非飛行刀波都接命中掛鉤', () => {
  for (const noPosition of [false, true]) {
    const f = fixture(10);
    if (noPosition) delete f.enemy.pos;
    const cast = f.c.castSkill2(f.p, [f.enemy], 'cleave', 'mv-float');
    assert.ok(cast);
    advance(f);
    assert.ok(f.hits.some(h => h.cfg.skillElem === 'wind'));
  }
  const f = fixture();
  f.c.sgCastCleave(f.p, f.st, f.c.SKILLS2.cleave, [1, 0, 0, 0, 0, 0, 0],
    [f.enemy], f.enemy, 'mv-float', f.out);
  advance(f);
  assert.equal(f.hits.length, 2);
  assert.equal(f.events.filter(e => e.variant === 'wind-chaser-slash').length, 1);
});

test('逐風者直接與飛行刀波對多個敵人各派送追加斬擊，不綁當前目標', () => {
  for (const flying of [false, true]) {
    const f = fixture();
    f.p.pos = { x: 0, y: 0 };
    const enemies = [f.enemy,
      { ...f.enemy, name: '側面敵人', pos: { x: 0, y: 30 } },
      { ...f.enemy, name: '後方敵人', pos: { x: -40, y: 0 } }];
    f.ctx.getEnemies = () => enemies;
    f.c.sgCastCleave(f.p, f.st, f.c.SKILLS2.cleave, [1, 0, 0, 0, 0, flying ? 1 : 0, 0],
      enemies, f.enemy, 'mv-float', f.out);
    advance(f);
    const windHits = f.hits.filter(h => h.cfg.skillElem === 'wind');
    const slashes = f.events.filter(e => e.variant === 'wind-chaser-slash');
    assert.equal(windHits.length, 3, `飛行=${flying}：每個敵人只追加一次`);
    assert.deepEqual(slashes.map(e => e.targets[0]).sort(), windHits.map(h => h.target.name).sort());
    for (const enemy of enemies) {
      const event = slashes.find(e => e.targets[0] === enemy.name);
      assert.ok(event, enemy.name);
      assert.equal(event.count, 1);
      assert.equal(event.area, null);
      assert.equal(event.angle, Math.atan2(enemy.pos.y, enemy.pos.x));
      assert.deepEqual(event.vfx, { attack: 'slash-wind-crescent', hit: 'hit-wind' });
    }
  }
});

test('疾風傳奇風捲殘雲仍保留龍捲場域，不混入逐風者真空斬特效', () => {
  const f = fixture();
  f.c.sgGaleTornado({ pEnt: f.p, st: f.st, dmgVal: 1000, floatSel: 'mv-float',
    tornado: { m: 4, pct: 50, hits: 3, gap: 0.4 } }, f.enemy);
  assert.equal(f.c.SKILL2_RT.grounds.length, 1);
  advance(f, 0.5);
  const tornado = f.events.filter(e => e.variant === 'wind-tornado');
  assert.ok(tornado.length > 0);
  assert.deepEqual(tornado[0].vfx, { ground: 'slash-cleave-ring-warm-09-hit' });
  assert.equal(f.events.some(e => e.variant === 'wind-chaser-slash'), false);
});
