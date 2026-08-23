/* GM 技能測試工具（2026-08-14 技能檢驗流程規範 → docs/SKILL_TEST_SPEC.md）
   守住四件事：
     1. god 鎖血：我方生命最低鎖 1（直接傷害與 DoT 兩條路徑），敵人不受影響
     2. HP_lock／MP_lock：完全鎖定玩家生命／法力，重複輸入切換
     3. statset／maxstats：屬性覆寫旗標寫入 GM_TEST（computeStats 尾端合併）
     4. spawn 演武場：指定數量/敵種/血量倍率、_stage=-1 不計配額、off 清場復原
     5. sglv：等級直設經過循序解鎖正規化 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext() {
  const context = {
    console,
    Math: Object.create(Math),
    setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    location: { hostname: 'localhost' }, // GM 指令只認本機 hostname
    UI: { dirty: {} },
    blog() {}, floatText() {}, trackDps() {}, recordRunDamage() {}
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js',
    'js/combat.js', 'js/skills.js', 'js/skills2.js', 'js/gm_exec.js']
    .forEach((file) => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file }));
  context.G = {
    /* 等級拉高：新版技能有「解鎖轉生/等級」門檻，低等會被正規化成 Lv.0，
       那不是這支測試要驗的東西（門檻本身由 skill2-system 專門驗）。 */
    player: { gold: 0, level: 1000, skills2: { levels: {} }, loadout: [] },   // MAX_LEVEL：暴風屏障第 7 階解鎖於 1000 級
    stage: { current: 1, zone: 'desert' }
  };
  return context;
}

/* ---- 1) god 鎖血 ---- */

test('god：我方生命最低鎖 1（applyEnemyHpDamage 與 resolveHit 兩條路徑）；敵人不受影響', () => {
  const c = loadContext();
  assert.equal(c.executeGMCommand('god 1').ok, true);
  assert.equal(c.GM_TEST.god, true);

  // DoT／直接傷害路徑：玩家實體（無 maxHp）鎖 1
  const p = { hp: 50, shield: 0, effects: {}, buffs: {}, dots: [] };
  c.applyEnemyHpDamage(p, 999999);
  assert.equal(p.hp, 1, '鎖血下我方生命最低 1');
  // 敵人（有 maxHp）照常歸零
  const m = { hp: 50, maxHp: 100, effects: {}, buffs: {}, dots: [] };
  c.applyEnemyHpDamage(m, 999999);
  assert.equal(m.hp, 0, '敵人不受鎖血影響');

  // resolveHit 路徑：巨量攻擊打玩家，不得進入致死分支
  const pv = { hp: 100, shield: 0, shieldMax: 0, effects: {}, buffs: {}, dots: [] };
  const res = c.resolveHit({ hp: 1 }, pv,
    { atk: 1e12, dmgType: 'phys', hit: 999, critRate: 0, critDmg: 150, level: 1 },
    { def: 0, mdef: 0, level: 1, dodge: 0, isPlayer: true, resist: {}, maxHp: 1000, ccFactor: 1, tenacity: 0 });
  assert.equal(pv.hp, 1, 'resolveHit 路徑同樣鎖 1');
  assert.equal(res.killed, false, '不得標記擊殺');

  // 關閉後恢復可死亡
  assert.equal(c.executeGMCommand('god 0').ok, true);
  const p2 = { hp: 50, shield: 0, effects: {}, buffs: {}, dots: [] };
  c.applyEnemyHpDamage(p2, 999999);
  assert.equal(p2.hp, 0, '鎖血關閉後恢復正常');
});

test('HP_lock／MP_lock：重複輸入切換，鎖定時不扣生命且零魔可施放新版技能', () => {
  const c = loadContext();
  const p = { hp: 50, mp: 0, shield: 0, effects: {}, buffs: {}, dots: [] };

  assert.equal(c.executeGMCommand('HP_lock').ok, true);
  assert.equal(c.GM_TEST.hpLock, true);
  c.applyEnemyHpDamage(p, 999999);
  assert.equal(p.hp, 50, 'HP_lock 不得扣除直接傷害');

  const pv = { hp: 100, shield: 0, shieldMax: 0, effects: {}, buffs: {}, dots: [] };
  c.resolveHit({ hp: 1, maxHp: 100 }, pv,
    { atk: 1e12, dmgType: 'phys', hit: 999, critRate: 0, critDmg: 150, level: 1 },
    { def: 0, mdef: 0, level: 1, dodge: 0, isPlayer: true, resist: {}, maxHp: 1000, ccFactor: 1, tenacity: 0 });
  assert.equal(pv.hp, 100, 'HP_lock 不得扣除 resolveHit 傷害');

  assert.equal(c.executeGMCommand('HP_lock').ok, true);
  assert.equal(c.GM_TEST.hpLock, false);
  c.applyEnemyHpDamage(p, 10);
  assert.equal(p.hp, 40, '解除 HP_lock 後恢復扣血');

  assert.equal(c.executeGMCommand('MP_lock').ok, true);
  assert.equal(c.GM_TEST.mpLock, true);
  assert.equal(c.gmMpLockActive(p), true);
  c.G.player.skills2.levels.thrust = [1, 1, 1, 1, 1, 1, 1];
  c.getStats = () => ({
    atk: 1000, matk: 0, hp: 1000, mp: 100, level: 10, aspd: 2, cdr: 0,
    critRate: 0, critDmg: 150, hit: 100, tenacity: 0,
    passives: {}, elemAtk: null, elemDmgPct: 0, elemDmgUp: 0,
    eliteDmg: 0, bossDmg: 0, normalDmg: 0, totalDmgPct: 0, dmgVsElem: null,
    aoeDmg: 0, globalDmgRed: 0
  });
  const target = { hp: 1e9, maxHp: 1e9, def: 0, mdef: 0, level: 1,
    effects: {}, buffs: {}, dots: [], resist: {}, ctrlRes: 0 };
  assert.ok(c.castSkill2(p, [target], 'thrust', 'mv-float'), 'MP_lock 下 MP=0 仍可施放新版技能');
  assert.equal(p.mp, 0, 'MP_lock 不得扣除技能消耗');

  assert.equal(c.executeGMCommand('MP_lock').ok, true);
  assert.equal(c.GM_TEST.mpLock, false);
});

test('HP_lock：不讓既有暈眩／倒地狀態卡住技能行動閘門；一般狀態仍會阻擋', () => {
  const c = loadContext();
  const p = { hp: 100, effects: { stun: c.GT + 10 }, buffs: {}, dots: [] };

  assert.equal(c.playerActionControlBlocked(p), true, '未鎖血時暈眩仍應阻擋行動');
  assert.equal(c.executeGMCommand('HP_lock').ok, true);
  assert.equal(c.playerActionControlBlocked(p), false, 'HP_lock 下暈眩不應卡死技能列');

  p.effects.stun = 0;
  c.SKILL2_RT.lastStand = { done: false, reviveAt: c.GT + 10, pEnt: p };
  assert.equal(c.playerActionControlBlocked(p), false, 'HP_lock 下倒地也不應卡死技能列');
  assert.equal(c.executeGMCommand('HP_lock').ok, true);
  assert.equal(c.playerActionControlBlocked(p), true, '解除 HP_lock 後倒地應恢復行動阻擋');
});

/* ---- 2) statset / maxstats ---- */

test('statset：覆寫旗標寫入與清除；maxstats 基準組；非法欄位被拒', () => {
  const c = loadContext();
  assert.equal(c.executeGMCommand('statset atk 100000').ok, true);
  assert.equal(c.GM_TEST.statOverride.atk, 100000);
  assert.equal(c.executeGMCommand('statset crit 0').ok, true);
  assert.equal(c.GM_TEST.statOverride.critRate, 0);
  assert.equal(c.executeGMCommand('statset nope 5').ok, false);
  assert.equal(c.executeGMCommand('maxstats').ok, true);
  assert.ok(c.GM_TEST.statOverride.aspd > 0, 'maxstats 應設定攻速');
  assert.ok(c.GM_TEST.statOverride.cdr > 0, 'maxstats 應設定冷卻縮減');
  assert.equal(c.GM_TEST.statOverride.hit, 999);
  assert.equal(c.executeGMCommand('statset clear').ok, true);
  assert.equal(c.GM_TEST.statOverride, null);
});

/* ---- 3) spawn 演武場 ---- */

test('spawn：數量/敵種/血量倍率、暫停旗標與配額隔離；spawn off 清場復原', () => {
  const c = loadContext();
  // 基準：1 隻真實血量小怪
  assert.equal(c.executeGMCommand('spawn 1 small 1').ok, true);
  const baseHp = c.FIELD.monsters[0].maxHp;
  assert.ok(baseHp > 0);

  // 20 隻千倍血小怪（超過棋盤 16 容量也要成功）
  const r = c.executeGMCommand('spawn 20 small 1000');
  assert.equal(r.ok, true, r.message);
  assert.equal(c.FIELD.monsters.length, 20, '演武場應生成 20 隻');
  assert.equal(c.FIELD._gmArena, true, '演武場旗標應開啟');
  c.FIELD.monsters.forEach((m) => {
    assert.equal(m._stage, -1, '演武場敵人不計入過關配額');
    assert.ok(m.pos && isFinite(m.pos.x), '演武場敵人必須有座標');
    assert.ok(Math.abs(m.maxHp - baseHp * 1000) < baseHp * 0.001, '血量倍率應生效');
  });

  // BOSS 敵種
  assert.equal(c.executeGMCommand('spawn 2 boss 1000').ok, true);
  assert.equal(c.FIELD.monsters.length, 2);
  c.FIELD.monsters.forEach((m) => assert.equal(m.isBoss, true));

  // off：清場並復原
  assert.equal(c.executeGMCommand('spawn off').ok, true);
  assert.equal(c.FIELD._gmArena, false);
  assert.equal(c.FIELD.monsters.length, 0);

  // 邊界：數量超上限被拒
  assert.equal(c.executeGMCommand('spawn 99').ok, false);
  assert.equal(c.executeGMCommand('spawn 4 dragon').ok, false);
});

/* ---- 4) sglv ---- */

test('sglv：max／單值／逐階列表；循序解鎖正規化；未知群組被拒', () => {
  const c = loadContext();
  assert.equal(c.executeGMCommand('sglv thrust max').ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(c.G.player.skills2.levels.thrust)), [10, 10, 10, 10, 10, 10, 10]);

  assert.equal(c.executeGMCommand('sglv thrust 1').ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(c.G.player.skills2.levels.thrust)), [1, 1, 1, 1, 1, 1, 1]);

  // 逐階列表：第 2 階 0 → 循序解鎖把第 3 階以後歸 0
  assert.equal(c.executeGMCommand('sglv bloodblade 10,0,5,0,0,0,0').ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(c.G.player.skills2.levels.bloodblade)), [10, 0, 0, 0, 0, 0, 0]);

  assert.equal(c.executeGMCommand('sglv all max').ok, true);
  Object.keys(c.SKILLS2).forEach((gid) => {
    assert.deepEqual(JSON.parse(JSON.stringify(c.G.player.skills2.levels[gid])),
      [10, 10, 10, 10, 10, 10, 10], gid + ' 應全滿');
  });

  assert.equal(c.executeGMCommand('sglv nope 1').ok, false);
  assert.equal(c.executeGMCommand('sglv thrust abc').ok, false);
});
