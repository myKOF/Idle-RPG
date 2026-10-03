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
  for (const f of ['util', 'data', 'status', 'formula', 'battlefield', 'combat', 'skills', 'skills2', 'tower']) {
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

test('開場：BOSS 站在我方正前方、帶 tb-float 定址，塔戰站位與野外共用同一個 bfPlayerPos 參照', () => {
  const { c } = setup();
  const home = c.bfPlayerPos();
  home.x = 1234; home.y = -56;     // 野外走到一半才進塔：沿用當下位置，鏡頭不跳
  c.startTowerFight(1);
  assert.equal(c.G.tower.active, true);
  const b = c.TOWER.boss;
  assert.equal(b.floatSel, 'tb-float');
  assert.equal(c.TOWER.playerPos, c.bfPlayerPos());
  assert.deepStrictEqual({ x: b.pos.x, y: b.pos.y }, { x: 1234 + c.TOWER_BOSS_SPAWN_DIST, y: -56 });
});

test('交戰：雙方對衝後才出手，普攻一律在近戰距離內、BOSS 攻擊一律在射程內，限時燒掉不到一秒', () => {
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
  assert.ok(s.log.player[0].t <= intro + 1, '登場結束後一秒內接戰（實際 ' + s.log.player[0].t + ' 秒）');
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
  // 一走進射程只補一下普攻＋一下蓄力重擊，不會把十秒的欠債一次打完
  b.pos.x = s.c.bfPlayerPos().x + 60;
  s.tick(0.1);
  assert.equal(s.log.boss.length, 2);
  assert.deepStrictEqual(s.log.boss.map(h => h.name).sort(), ['', '蓄力重擊']);
  assert.equal(s.log.player.length, 1);
});

test('結束：清掉塔戰站位參照，畫面據此回到野外', () => {
  const s = setup();
  s.c.startTowerFight(1);
  s.c.fleeTower();
  s.c.finishTowerFight();
  assert.equal(s.c.TOWER.playerPos, null);
  assert.equal(s.c.TOWER.boss, null);
});

test('登場：轉場期間限時不走、雙方不動也不出手，結束後才開打；回野外時出怪延後同樣長度', () => {
  const s = setup();
  s.c.startTowerFight(4);
  const intro = s.c.TOWER_INTRO_SEC;
  assert.ok(intro >= 2 && intro <= 3, '轉場約 2～3 秒（使用者要求）');
  const b = s.c.TOWER.boss;
  const start = { x: b.pos.x, y: b.pos.y };
  s.tick(intro - 0.2);
  assert.equal(s.c.TOWER.elapsed, 0);
  assert.deepStrictEqual({ x: b.pos.x, y: b.pos.y }, start);
  assert.equal(s.log.player.length + s.log.boss.length, 0);
  s.tick(1.2);
  assert.ok(s.c.TOWER.elapsed > 0.5, '登場結束後限時開始走');
  s.c.fleeTower();
  s.c.finishTowerFight();
  assert.equal(s.c.FIELD.spawnCd, s.c.TOWER_EXIT_SPAWN_HOLD_SEC);
});
