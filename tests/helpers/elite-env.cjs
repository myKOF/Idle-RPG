'use strict';
/* 菁英詞條測試共用環境：以 Worker 的載入順序把模擬層（含 elite_data.js／elite.js）載進同一個 vm，
   建好全新的 G 與野外玩家，並把 playCombatVfx／floatText／blog 換成收集器。 */
const { loadRuneEnv } = require('./runeword-env.cjs');

const FILES = [
  'util.js', 'data.js', 'elite_data.js', 'runeword_data.js', 'status.js', 'formula.js', 'battlefield.js', 'stats.js',
  'item.js', 'runeword.js', 'skills.js', 'skills2.js', 'talents.js', 'player.js', 'special_rules.js',
  'combat.js', 'elite.js', 'legendary.js', 'potential.js', 'tower.js', 'factory.js', 'newforge.js', 'forge.js', 'save.js', 'tasks.js'
];

function loadEliteEnv(opts) {
  opts = opts || {};
  const c = loadRuneEnv({ files: FILES });
  c.vfx = [];
  c.floats = [];
  c.playCombatVfx = function (spec) { c.vfx.push(spec); };
  c.floatText = function (id, text, cls) { c.floats.push({ id, text, cls }); };
  c.vm_exec = null;
  c.GT = 100;
  // 固定一個野外戰場：玩家站原點、全新玩家實體
  require('node:vm').runInContext(
    "G.stage.zone = 'desert'; G.stage.current = " + (opts.stage || 30) + "; FIELD.monsters = []; FIELD.monster = null;" +
    "FIELD.reviveCd = 0; FIELD.player = newPlayerEntity(getStats()); bfResetPlayer(); eliteReset();", c);
  return c;
}

/* 在 (x, y) 生一隻已進場的菁英（不經出怪流程，詞條由 ids 指定）。 */
function makeElite(c, ids, over) {
  over = over || {};
  const zn = c.currentZoneDef();
  const stage = c.G.stage.current;
  const base = c.monsterStatsFor(stage, true, false);
  const m = c.makeFieldEnemy(c.pickZoneMonsterType(zn), base, zn, stage, { elite: true, enterCd: 0 });
  m._gid = over.gid === undefined ? 1 : over.gid;
  m._gRole = 'leader';
  m._stage = -1;
  m.pos = { x: over.x === undefined ? 220 : over.x, y: over.y === undefined ? 0 : over.y };
  if (ids && ids.length) c.eliteEquip(m, ids);
  if (over.hp) { m.maxHp = over.hp; m.hp = over.hp; }
  c.FIELD.monsters = c.FIELD.monsters.concat([m]);
  c.markFieldEnemyFloatTargets(c.FIELD.monsters);
  c.syncFieldPrimary();
  return m;
}
function makeMinion(c, gid, over) {
  over = over || {};
  const zn = c.currentZoneDef();
  const stage = c.G.stage.current;
  const base = c.monsterStatsFor(stage, false, false);
  const m = c.makeFieldEnemy(c.pickZoneMonsterType(zn), base, zn, stage, { enterCd: 0 });
  m._gid = gid === undefined ? 1 : gid;
  m._gRole = 'minion';
  m._stage = -1;
  m.pos = { x: over.x === undefined ? 260 : over.x, y: over.y === undefined ? 40 : over.y };
  c.FIELD.monsters = c.FIELD.monsters.concat([m]);
  c.markFieldEnemyFloatTargets(c.FIELD.monsters);
  c.syncFieldPrimary();
  return m;
}

/* 推進 sec 秒（每 0.1 秒一步）：GT 前進並呼叫 eliteTick。回傳玩家是否在期間被打死。 */
function stepElite(c, sec, hooks) {
  const steps = Math.round(sec * 10);
  for (let i = 0; i < steps; i++) {
    c.GT += 0.1;
    if (hooks && hooks.before) hooks.before(i);
    if (c.eliteTick(0.1)) return true;
  }
  return false;
}

module.exports = { loadEliteEnv, makeElite, makeMinion, stepElite, FILES };
