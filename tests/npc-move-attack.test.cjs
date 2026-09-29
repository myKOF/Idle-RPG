/* NPC 表的移動速度／攻擊速度／攻擊距離（2026-09-29 NPC 改造）
   資料流：config/CSV/NPC.csv → tools/config_tables.cjs → js/data.js 各地圖 pool
          → NPC_CONFIG_TABLE（米、次/秒）→ combat.js npcCombatProfile（換成座標單位）
          → 敵人身上的 aspd／runSpeed／atkRange → js/battlefield.js 逼近與射程判定。
   期望值一律從 CSV 讀，不寫死數字——策劃調表不該讓這些測試誤報。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function readNpcCsv() {
  const lines = fs.readFileSync(path.join(root, 'config/CSV/NPC.csv'), 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/);
  const header = lines[0].split(',');
  const col = (name) => {
    const i = header.indexOf(name);
    assert.ok(i >= 0, 'NPC.csv 缺少欄位：' + name);
    return i;
  };
  const idx = { id: col('NPC識別碼'), move: col('移動速度(米/秒)'), aspd: col('攻擊速度(次/秒)'), range: col('攻擊距離(米)') };
  return lines.slice(1).map((line) => {
    const f = line.split(',');
    return { id: f[idx.id], move: Number(f[idx.move]), aspd: Number(f[idx.aspd]), range: Number(f[idx.range]) };
  });
}

function loadCombat() {
  const context = {
    console,
    Math: Object.create(Math),
    UI: { dirty: {} },
    blog() {},
    document: { getElementById() { return null; } }
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

test('NPC.csv 的移動速度／攻擊速度／攻擊距離與 NPC_CONFIG_TABLE 逐列一致', () => {
  const c = loadCombat();
  const rows = readNpcCsv();
  assert.ok(rows.length >= 84);
  for (const r of rows) {
    const npc = c.NPC_CONFIG_TABLE[r.id];
    assert.ok(npc, r.id + ' 不在 NPC_CONFIG_TABLE');
    assert.equal(npc.runSpeed, r.move, r.id + ' 移動速度');
    assert.equal(npc.atkSpeed, r.aspd, r.id + ' 攻擊速度');
    assert.equal(npc.atkRange, r.range, r.id + ' 攻擊距離');
    assert.ok(r.move > 0 && r.aspd > 0 && r.range > 0, r.id + ' 三欄都必須是正數');
  }
});

test('套用流程能無損回寫三欄（dry-run 語意變更 0）', () => {
  const result = spawnSync(process.execPath, ['tools/config_tables.cjs', '--apply', 'NPC'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /重建字面值 7 個（語意變更 0）/);
});

test('npcCombatProfile：表格值換成座標單位（1 米 = 10 單位），攻速為絕對值', () => {
  const c = loadCombat();
  const p = c.npcCombatProfile({ runSpeed: 12, atkSpeed: 0.75, atkRange: 24 }, { aspd: 1 }, { aspdMult: 1 });
  assert.equal(p.runSpeed, c.bfMeterPx(12));
  assert.equal(p.atkRange, c.bfMeterPx(24));
  assert.equal(p.aspd, 0.75);
});

test('npcCombatProfile：攻速 = 表格攻速 × 階級係數 × 場景攻速倍率', () => {
  const c = loadCombat();
  const npc = { atkSpeed: 1.5, runSpeed: 6, atkRange: 6 };
  assert.equal(c.npcCombatProfile(npc, { aspd: 1 }, { aspdMult: 1 }).aspd, 1.5);
  assert.equal(c.npcCombatProfile(npc, { aspd: 1 }, { aspdMult: 2 }).aspd, 3, '場景攻速倍率仍要乘上去');
  assert.equal(c.npcCombatProfile(npc, { aspd: 2 }, { aspdMult: 1 }).aspd, 3, 'BOSS／菁英的階級係數仍要乘上去');
});

test('npcCombatProfile：表格留白＝0＝戰場預設，攻速以 1 次/秒計', () => {
  const c = loadCombat();
  const p = c.npcCombatProfile({}, { aspd: 1 }, { aspdMult: 1 });
  assert.equal(p.runSpeed, 0);
  assert.equal(p.atkRange, 0);
  assert.equal(p.aspd, 1);
  const ent = { hp: 1, pos: { x: 500, y: 0 }, runSpeed: p.runSpeed, atkRange: p.atkRange };
  assert.equal(c.bfEnemyRunSpeed(ent), c.BF_ENEMY_SPEED);
  assert.equal(c.bfEnemyAttackRange(ent), c.BF_MELEE_RANGE);
});

test('生成的敵人身上帶著自己 NPC 的攻速、跑速、射程', () => {
  const c = loadCombat();
  const desert = c.ZONES.desert.pool;
  c.G = { stage: { current: 1, zone: 'desert' }, tower: { active: false } };
  c.FIELD = { player: null, monster: null, monsters: [], spawnCd: 0, reviveCd: 0, dpsWindow: [], mapComplete: false };
  c.rollFieldEnemyCount = () => 6;
  c.isFieldBossStage = () => false;
  c.isEliteStage = () => false;
  const spawned = c.spawnFieldMonster();
  assert.ok(spawned.length > 0);
  const zoneMult = c.ZONES.desert.aspdMult;
  spawned.forEach((m) => {
    const npc = desert.find((e) => e.id === m.npcId);
    assert.ok(npc, m.name);
    assert.equal(m.runSpeed, c.bfMeterPx(npc.runSpeed), m.name + ' 移動速度');
    assert.equal(m.atkRange, c.bfMeterPx(npc.atkRange), m.name + ' 攻擊距離');
    assert.ok(Math.abs(m.aspd - npc.atkSpeed * c.FIELD_MONSTER_GROWTH.aspd * zoneMult) < 1e-9, m.name + ' 攻速');
    assert.ok(Math.abs(m.atkCd - 1 / m.aspd) < 1e-9);
  });
});

test('攻擊表現看射程不看魔法型：24 米出投射物、6 米近身出手', () => {
  const c = loadCombat();
  const R = c.bfMeterPx(24);
  const near = c.bfMeterPx(6);
  assert.equal(c.enemyAttackIsRanged({ magic: false, atkRange: R }), true);
  assert.equal(c.enemyAttackIsRanged({ magic: true, atkRange: near }), false);
  assert.equal(c.enemyAttackProjectileTravelMs({ magic: true, atkRange: near }), 0, '近身的魔法怪沒有投射物延遲');
  assert.ok(c.enemyAttackProjectileTravelMs({ magic: false, atkRange: R }) > 0);
  // 沒有表格射程（高塔 BOSS）：退回舊規則，魔法系仍是遠程
  assert.equal(c.enemyAttackIsRanged({ magic: true }), true);
  assert.equal(c.enemyAttackIsRanged({ magic: false }), false);
});
