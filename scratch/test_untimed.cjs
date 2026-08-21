'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve('.');

function createSimContext() {
  const ctx = {
    Math, Object, Array, Number, String, RegExp, console,
    setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
    location: { hostname: 'localhost' }, BF_COLS: 10, BF_ROWS: 10
  };
  ctx.window = ctx; ctx.self = ctx; vm.createContext(ctx);
  const files = [
    'js/worker/protocol.js', 'js/worker/shim.js', 'js/util.js', 'js/data.js', 'js/status.js',
    'js/formula.js', 'js/battlefield.js', 'js/stats.js', 'js/item.js', 'js/skills.js',
    'js/skills2.js', 'js/talents.js', 'js/player.js', 'js/special_rules.js', 'js/combat.js',
    'js/legendary.js', 'js/potential.js', 'js/tower.js', 'js/factory.js', 'js/newforge.js',
    'js/forge.js', 'js/save.js', 'js/tasks.js', 'js/gm_exec.js'
  ];
  files.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
  return ctx;
}

function testUntilDead(gid, isBase, optIdx, name) {
  const ctx = createSimContext();
  ctx.G = ctx.newGameState();
  ctx.G.player.level = 100; ctx.G.player.reincarnations = 1; ctx.G.player.gold = 1e9;
  ctx.G.player.skills2 = {
    levels: { [gid]: [10, 10, 10, 10, 10, 10, 10] },
    ult: isBase ? {} : { [gid]: { pick: optIdx, lv: 10 } }
  };
  ctx.G.player.loadout = ['sg:' + gid];
  ctx.G.stage.current = 300; ctx.G.stage.zone = 'swamp';

  const eq = {};
  ctx.SLOT_LIST.forEach(slot => {
    eq[slot] = {
      id: 'eq_' + slot, kind: 'equip', slot, rarity: 5, level: 100, name: '100級傳奇裝備',
      affixes: [
        { key: 'atkPct', roll: 100 }, { key: 'critDmg', roll: 100 },
        { key: 'atkFlat', roll: 100 }, { key: 'critRate', roll: 100 },
        { key: 'pPen', roll: 100 }
      ],
      upgrade: 40, sockets: []
    };
  });
  ctx.G.equipment = eq; ctx.G.player.equipment = eq;
  const pStats = ctx.computeStats();
  pStats.blockRate = 50; pStats.blockDmgRed = 80; pStats.comboHits = 3;
  pStats.totalDmgPct = (pStats.totalDmgPct || 0) + 1000;
  pStats.elemDmgPct = (pStats.elemDmgPct || 0) + 1000;
  ctx.ELEMENTS.forEach(e => { pStats.elemDmgUp[e] = (pStats.elemDmgUp[e] || 0) + 1000; });

  ctx.bfResetPlayer();
  ctx.FIELD = { monsters: [], monster: null, player: ctx.newPlayerEntity(pStats), mapComplete: false, _gmArena: true, spawnCd: 0, reviveCd: 0, dpsWindow: [] };
  ctx.FIELD.player.hp = 1e15; ctx.FIELD.player.maxHp = 1e15; ctx.FIELD.player.mp = 1e15; ctx.FIELD.player.maxMp = 1e15;
  ctx.fieldMonsterAttack = function () { return false; };
  ctx.resetSkillRT();
  if (typeof ctx.resetSkill2RT === 'function') ctx.resetSkill2RT();

  const base = ctx.monsterStatsFor(300, false, false);
  const newEnemies = [];
  for (let i = 0; i < 20; i++) {
    newEnemies.push({
      id: 'm_0_' + i, name: '小怪_' + i, emoji: '👾', level: base.level, maxHp: base.hp, hp: base.hp,
      atk: base.atk, def: 0, mdef: 0, magic: false, aspd: 1, dodge: base.dodge, hit: base.hit, elite: false, isBoss: false,
      atkCd: 0, effects: {}, ctrlRes: 0, _spawnAt: 0, _stage: -1, _enterCd: 0, shield: 0, buffs: {}, dots: []
    });
  }
  const placed = ctx.bfPlaceEnemies(newEnemies, ctx.FIELD.monsters);
  ctx.FIELD.monsters = placed;
  ctx.syncFieldPrimary();

  let totalDmg = 0;
  ctx.trackDps = function (dmg) { totalDmg += dmg; };
  const origTickStatuses = ctx.tickStatuses;
  ctx.tickStatuses = function (ent, dt) {
    const oldHp = ent ? ent.hp : 0;
    const res = origTickStatuses ? origTickStatuses.apply(this, arguments) : false;
    if (ent && ent.maxHp > 0 && oldHp > ent.hp) {
      const dotDmg = oldHp - ent.hp;
      if (dotDmg > 0) ctx.trackDps(dotDmg);
    }
    return res;
  };

  let t = 0, dt = 0.05;
  const t0 = Date.now();
  while (true) {
    ctx.fieldTick(dt);
    t += dt;
    ctx.FIELD.monsters = ctx.FIELD.monsters.filter(m => m && m.hp > 0);
    ctx.syncFieldPrimary();
    if (ctx.FIELD.monsters.length === 0) break;
    if (t > 20000) { console.log('Timeout > 20000s'); break; }
  }
  console.log(`[${name}] 戰鬥通關耗時: ${t.toFixed(2)}s (運算耗時: ${Date.now() - t0}ms) | DPS: ${Math.round(totalDmg / t).toLocaleString()}`);
}

console.log('--- 突刺（不限時長打到死為止）---');
testUntilDead('thrust', true, 0, '基礎突刺');
testUntilDead('thrust', false, 0, '幻影八方陣');
testUntilDead('thrust', false, 1, '暗影絕殺者');
testUntilDead('thrust', false, 2, '一擊必殺');
