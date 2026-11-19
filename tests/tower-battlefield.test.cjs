'use strict';
/* 封魔塔改走野外的即時戰場（2026-10-03）：
   BOSS 與我方都有座標（js/battlefield.js），雙方先走到射程內才交手；
   Canvas 戰場以 TOWER.playerPos／boss.pos／boss.floatSel 畫塔戰（js/battle-renderer.js towerFieldView）。
   這支測試跑真的 startTowerFight／towerTick／finishTowerFight，只把攻擊結算換成記錄器。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function setup() {
  const c = {
    console, Math, UI: { dirty: {} }, blog() {}, floatText() {}, trackDps() {}, recordRunDamage() {},
    setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } }
  };
  c.window = c;
  vm.createContext(c);
  for (const f of ['util', 'strings_data', 'strings', 'data', 'status', 'formula', 'battlefield', 'combat', 'skills', 'skills2', 'tower']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'), c, { filename: f + '.js' });
  }
  const st = { hp: 1e9, mp: 0, atk: 100, matk: 0, aspd: 2, level: 1000, hpRegen: 0, mpRegen: 0,
    passives: {}, skillTriggers: {}, cdr: 0, critRate: 0, critDmg: 150, hit: 100, enrageThreshold: 0 };
  c.getStats = () => st;
  c.G = { player: { gold: 1e30, loadout: [], skills2: { levels: {} } },
    stage: { current: 1, best: 1, kills: 0, zone: 'desert' }, tower: { active: false, highest: 10 } };
  c.FIELD = { player: c.newPlayerEntity(st), monster: null, monsters: [], spawnCd: 0, reviveCd: 0, dpsWindow: [] };
  c.GT = 0;
  c.pickAndCastSkill = () => null;
  c.tickLegendaryEffects = () => null;
  c.tickSkillSchedulers = () => {};
  c.chance = () => false;
  const log = { player: [], boss: [] };
  c.doPlayerAttack = (p, b) => {
    log.player.push({ t: c.GT, reach: c.bfPlayerCanReach(b), gap: c.bfEntityDistance(b) });
    return { dmg: 1, killed: false };
  };
  c.doMonsterAttack = (b, p, sel, mult, name) => {
    log.boss.push({ t: c.GT, inRange: c.bfInAttackRange(b), gap: c.bfEntityDistance(b), sel, name: name || '' });
    return { dmg: 1 };
  };
  return { c, log, tick(sec) {
    for (let i = 0; i < Math.round(sec / 0.1); i++) { c.GT = Math.round((c.GT + 0.1) * 1000) / 1000; c.towerTick(0.1); }
  } };
}

test('開場：玩家再左移五米、BOSS 從原右邊界出生點左移十米，法陣保持原位', () => {
  const { c } = setup();
  const home = c.bfPlayerPos();
  home.x = 1234; home.y = -56;     // 野外走到一半才進塔：沿用當下位置，鏡頭不跳
  c.startTowerFight(1);
  assert.equal(c.G.tower.active, true);
  const b = c.TOWER.boss;
  assert.equal(b.floatSel, 'tb-float');
  assert.equal(c.TOWER.playerPos, c.bfPlayerPos());
  assert.equal(home.x, 1234 - c.bfMeterPx(10), '玩家相對最初出生點共向左移十米');
  const arena = c.TOWER.arena;
  assert.equal(arena.cx, 1234 + c.TOWER_BOSS_SPAWN_DIST / 2, '法陣不隨玩家左移或遠端生成點偏移');
  assert.equal(arena.cy, home.y);
  assert.deepStrictEqual({ x: b.pos.x, y: b.pos.y }, { x: arena.cx + arena.halfWidth - c.bfEntityRadius(b) - c.bfMeterPx(10), y: -56 });
  assert.ok(b.pos.x > home.x + arena.viewWidth / 2, '從基準畫面右方之外跑入');
  assert.equal(b._alerted, true, '超出野外視野仍直接追向挑戰者');
});

test('交戰：遠端生成後雙方依原速對衝，兩秒內接戰，普攻與 BOSS 攻擊都在各自射程內', () => {
  const s = setup();
  s.c.startTowerFight(4);                     // 第 4 層：鋼鐵魔像（無元素＝近戰）
  assert.equal(s.c.TOWER.boss.magic, false);
  const intro = s.c.TOWER_INTRO_SEC;
  s.tick(intro + 6);
  assert.ok(s.log.player.length > 0, '我方有出手');
  assert.ok(s.log.boss.length > 0, 'BOSS 有出手');
  /* 距離要是有限值：沒有座標時 bfPlayerCanReach／bfInAttackRange 一律放行，光看布林值證明不了有在走位 */
  assert.ok(s.log.player.every(h => h.reach && h.gap <= s.c.bfMeleeRange()), '普攻不隔空');
  assert.ok(s.log.boss.every(h => h.inRange && h.gap <= s.c.bfEnemyAttackRange(s.c.TOWER.boss)), 'BOSS 不隔空');
  assert.ok(s.log.player[0].t <= intro + 2, '右邊界跑入後兩秒內接戰（實際 ' + s.log.player[0].t + ' 秒）');
  assert.ok(s.log.boss.every(h => h.sel === 'tp-float'), 'BOSS 打我方仍走塔戰定址');
  assert.ok(s.c.bfPlayerCanReach(s.c.TOWER.boss));
});

test('打不到時冷卻停在 ready 不累積：BOSS 走不過來就不出手、也不攢一堆攻擊', () => {
  const s = setup();
  s.c.startTowerFight(4);
  const b = s.c.TOWER.boss;
  b.runSpeed = 1e-6;                          // 幾乎走不動
  s.c.bfTickPlayer = () => false;             // 我方也站著不追
  s.tick(s.c.TOWER_INTRO_SEC + 10);                                 // 超過蓄力周期（8 秒）
  assert.equal(s.log.boss.length, 0);
  assert.equal(s.log.player.length, 0);
  assert.equal(b.atkCd, 0);
  assert.equal(s.c.TOWER.specialCd, 0);
  assert.equal(s.c.TOWER.player.atkCd, 0);
  // 走進射程先普攻，播完才接蓄力重擊；不能同時出兩個動作，也不累積欠債。
  b.pos.x = s.c.bfPlayerPos().x + 60;
  s.tick(0.1);
  assert.equal(s.log.boss.length, 1);
  assert.equal(s.log.boss[0].name, '');
  b.atkCd = 10; // 單獨觀察已蓄好的重擊在普攻結束後接續。
  s.tick(s.c.towerBossActionDuration(b) + .1);
  assert.equal(s.log.boss.length, 2);
  assert.deepStrictEqual(s.log.boss.map(h => h.name).sort(), ['', '蓄力重擊']);
  assert.ok(s.log.player.length >= 1);
});

test('結束：清掉塔戰站位參照，畫面據此回到野外', () => {
  const s = setup();
  s.c.startTowerFight(1);
  s.c.fleeTower();
  s.c.finishTowerFight();
  assert.equal(s.c.TOWER.playerPos, null);
  assert.equal(s.c.TOWER.boss, null);
});

test('登場：等黑幕消失後雙方立即互相靠近；黑幕中不移動、計時、扣冷卻或出手', () => {
  const s = setup();
  s.c.startTowerFight(4);
  const intro = s.c.TOWER_INTRO_SEC;
  assert.ok(intro >= 2 && intro <= 3, '轉場約 2～3 秒（使用者要求）');
  const b = s.c.TOWER.boss;
  const start = { x: b.pos.x, y: b.pos.y };
  const home = { ...s.c.TOWER.playerPos }, cooldowns = [b.atkCd, s.c.TOWER.player.atkCd, s.c.TOWER.specialCd];
  s.tick(intro);
  assert.equal(s.c.TOWER.elapsed, 0);
  assert.equal(b.pos.x, start.x);
  assert.equal(b.pos.y, start.y);
  assert.equal(s.c.TOWER.playerPos.x, home.x);
  assert.equal(s.c.TOWER.playerPos.y, home.y);
  assert.deepStrictEqual([b.atkCd, s.c.TOWER.player.atkCd, s.c.TOWER.specialCd], cooldowns);
  assert.equal(s.log.player.length + s.log.boss.length, 0);
  s.tick(.1);
  assert.ok(Math.abs(b.pos.x - (start.x - b.runSpeed * .1)) < 1e-7);
  assert.ok(Math.abs(s.c.TOWER.playerPos.x - (home.x + s.c.bfPlayerSpeed() * .1)) < 1e-7);
  s.tick(1.2);
  assert.ok(s.c.TOWER.elapsed > 0.5, '登場結束後限時開始走');
  s.c.fleeTower();
  s.c.finishTowerFight();
  assert.equal(s.c.FIELD.spawnCd, s.c.TOWER_EXIT_SPAWN_HOLD_SEC);
});

test('150 層：黑幕消失後首步雙方即依原速移動，入場不偷跑且在途中相遇', () => {
  const s = setup(), c = s.c;
  c.G.tower.highest = 150;
  for (let floor = 1; floor <= 150; floor++) {
    c.startTowerFight(floor);
    const b = c.TOWER.boss, arena = JSON.stringify(c.TOWER.arena);
    const bossStart = b.pos.x, playerStart = c.TOWER.playerPos.x;
    for (let i = 0; i < 24; i++) {
      s.tick(.1);
      assert.equal(b.pos.x, bossStart);
      assert.equal(c.TOWER.playerPos.x, playerStart);
      assert.equal(c.TOWER.elapsed, 0);
      assert.equal(JSON.stringify(c.TOWER.arena), arena);
    }
    assert.equal(s.log.player.length + s.log.boss.length, 0);
    s.tick(.1);
    assert.ok(Math.abs(bossStart - b.pos.x - b.runSpeed * .1) < 1e-7, 'floor ' + floor + ' first step');
    assert.ok(Math.abs(c.TOWER.playerPos.x - playerStart - c.bfPlayerSpeed() * .1) < 1e-7);
    for (let i = 0; i < 40 && !c.bfPlayerCanReach(b); i++) s.tick(.1);
    assert.ok(c.bfPlayerCanReach(b), 'floor ' + floor + ' 雙方主動接近後相遇');
    assert.ok(c.TOWER.playerPos.x > playerStart && c.TOWER.playerPos.x < bossStart);
    assert.ok(b.pos.x < bossStart && b.pos.x > playerStart);
    assert.equal(JSON.stringify(c.TOWER.arena), arena);
    assert.ok(b.pos.x <= c.TOWER.arena.cx + c.TOWER.arena.halfWidth - c.bfEntityRadius(b));
    s.log.player.length = s.log.boss.length = 0;
    c.fleeTower(); c.finishTowerFight();
  }
});

test('較長模擬步跨越入場結束時不提前移動或攻擊，下一步才正常戰鬥', () => {
  const { c, log } = setup();
  c.startTowerFight(3);
  const b = c.TOWER.boss, start = b.pos.x;
  c.TOWER.introCd = .05;
  c.towerTick(.2);
  assert.equal(b.pos.x, start);
  assert.equal(c.TOWER.introCd, 0);
  assert.equal(c.TOWER.elapsed, 0);
  assert.equal(log.player.length + log.boss.length, 0);
  c.towerTick(.2);
  assert.equal(c.TOWER.elapsed, .2);
});
