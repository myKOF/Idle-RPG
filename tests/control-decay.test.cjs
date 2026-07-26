const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

/* 控場遞減：對敵方施加會改變攻擊頻率的控制（暈眩/減速/攻速降低），
   實際持續時間 × max(0, 1 − 敵人存活秒數 × 每秒遞減%)；
   普通敵人 1%/秒（100 秒歸零）、菁英 3%/秒、BOSS 完全免疫（既有）；玩家受控不遞減。 */

function loadCtx() {
  const context = { console, UI: { dirty: {} }, GT: 0, RUN_STATS: { skills: {} }, blog() {}, floatText() {} };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/combat.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

function foe(spawnAt, elite) {
  return { _spawnAt: spawnAt, elite: !!elite, isBoss: false, hp: 1000, maxHp: 1000, effects: {}, buffs: {}, dots: [], shield: 0 };
}

test('控場遞減倍率曲線：普通 1%/秒、菁英 3%/秒、非敵人實體不遞減', () => {
  const c = loadCtx();
  assert.equal(c.CONTROL_DECAY_PER_SEC_NORMAL, 1);
  assert.equal(c.CONTROL_DECAY_PER_SEC_ELITE, 3);
  c.GT = 0;
  assert.equal(c.controlDurationFactor(foe(0)), 1);
  c.GT = 50;
  assert.equal(c.controlDurationFactor(foe(0)), 0.5);
  c.GT = 100;
  assert.equal(c.controlDurationFactor(foe(0)), 0);
  c.GT = 120;
  assert.equal(c.controlDurationFactor(foe(0)), 0);   // 不會變負數
  c.GT = 20;
  assert.ok(Math.abs(c.controlDurationFactor(foe(0, true)) - 0.4) < 1e-9); // 菁英 20 秒 → −60%
  c.GT = 40;
  assert.equal(c.controlDurationFactor(foe(0, true)), 0);
  assert.equal(c.controlDurationFactor({ effects: {} }), 1); // 無 _spawnAt（玩家實體）→ 不遞減
});

test('使用者範例：8 秒暈眩在戰鬥 50 秒時施放 → 4 秒；100 秒後完全無效', () => {
  const c = loadCtx();
  c.GT = 50;
  const m1 = foe(0);
  assert.equal(c.applyEffect(m1, 'stun', 8), 4);
  assert.equal(m1.effects.stun, 54); // GT 50 + 4 秒
  c.GT = 100;
  const m2 = foe(0);
  assert.equal(c.applyEffect(m2, 'stun', 8), false);
  assert.equal(m2.effects.stun, undefined);
});

test('菁英怪 3%/秒：8 秒暈眩在 20 秒時施放 → 3.2 秒', () => {
  const c = loadCtx();
  c.GT = 20;
  const m = foe(0, true);
  const applied = c.applyEffect(m, 'stun', 8);
  assert.ok(Math.abs(applied - 3.2) < 1e-9);
});

test('攻速類減益（applyBuff）同樣遞減；非控制類與玩家增益不受影響', () => {
  const c = loadCtx();
  c.GT = 50;
  const m = foe(0);
  assert.equal(c.applyBuff(m, 'aspdDown', 30, 6), 3); // 攻擊頻率控制 → 減半
  assert.equal(m.buffs.aspdDown.until, 53);
  assert.equal(c.applyBuff(m, 'atkDown', 18, 6), 6);  // 非攻擊頻率控制 → 不遞減
  const player = { buffs: {}, effects: {} };           // 玩家實體無 _spawnAt
  assert.equal(c.applyBuff(player, 'aspdUp', 25, 6), 6);
});

test('BOSS 完全免疫維持不變；非控制效果（中毒鍵）不受遞減影響', () => {
  const c = loadCtx();
  c.GT = 999;
  const boss = { isBoss: true, effects: {}, buffs: {} };
  assert.equal(c.applyEffect(boss, 'stun', 8), false);
  const m = foe(0);
  assert.ok(c.applyEffect(m, 'burn', 5)); // 非攻擊頻率控制鍵 → 照常套用
  assert.equal(m.effects.burn, 999 + 5);
});

test('冰元素減速 proc 依實際套用結果顯示（遞減歸零時不再誤報減速）', () => {
  const c = loadCtx();
  c.chance = (p) => p >= 15; // 命中(100)與冰特效(15)成立、暴擊(0)與控制抵抗(0)不成立
  c.rnd = () => 1;
  const aCfg = { atk: 0, dmgType: 'magic', level: 1, hit: 100, critRate: 0, elemAtk: { ice: 100 } };
  const dCfg = { dodge: 0, mdef: 0, mRes: 0, resist: {}, ctrlRes: 0 };
  c.GT = 0;
  const fresh = foe(0);
  const r1 = c.resolveHit({}, fresh, aCfg, dCfg);
  assert.ok(r1.procs.includes('減速'));
  assert.ok(c.effectActive(fresh, 'slow'));
  c.GT = 100;
  const worn = foe(0);
  const r2 = c.resolveHit({}, worn, aCfg, dCfg);
  assert.ok(!r2.procs.includes('減速'));
  assert.equal(worn.effects.slow, undefined);
});

test('野外敵人生成時標記 _spawnAt（原始碼接線）', () => {
  const combat = fs.readFileSync(path.join(root, 'js', 'combat.js'), 'utf8');
  assert.match(combat, /_spawnAt:\s*GT/);
});

test('控場遞減參數已入參數表並接上 apply_params 錨點', () => {
  const csv = fs.readFileSync(path.join(root, 'config', 'CSV', 'game_parameters.csv'), 'utf8');
  assert.match(csv, /3-戰鬥核心,控場遞減,/);
  const ap = fs.readFileSync(path.join(root, 'tools', 'apply_params.cjs'), 'utf8');
  assert.match(ap, /CONTROL_DECAY_PER_SEC_NORMAL.*3-戰鬥核心.*控場遞減/);
  assert.match(ap, /CONTROL_DECAY_PER_SEC_ELITE.*3-戰鬥核心.*控場遞減/);
});
