'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { createEngine } = require('../scripts/sim/engine.js');
const tables = require('../tools/config_tables.cjs');

function engine(raw) {
  const e = createEngine({ seed: 1018 });
  e.boot(raw || null);
  return e;
}
const plain = value => JSON.parse(JSON.stringify(value));

test('新角色與正式 Worker 投影不建立潛力或技能點，也沒有潛力指令', () => {
  const e = engine(), c = e.ctx;
  assert.deepEqual(plain(c.G.player.talents), { levels: {} });
  assert.equal(c.G.player.skillPoints, undefined);
  assert.equal(c.POTENTIAL_TALENTS, undefined);
  for (const fn of ['potentialDef', 'potentialUpgrade', 'castPotentialSkill', 'availableSkillPoints']) {
    assert.equal(c[fn], undefined, fn);
  }
  assert.deepEqual(Object.keys(e.panel('skills')).sort(), ['loadout', 'loadoutSize', 'mastery', 'skills2']);
  assert.equal(Object.keys(c.COMMANDS).length, 94);
  assert.equal(c.WORKER_PROTOCOL_VERSION, 58);
  for (const command of ['Upgrade', 'Max', 'Downgrade', 'Delete']) {
    assert.equal(e.cmd('talent.potential' + command, { id: 'velocityForce' }).ok, false);
  }
  assert.match(e.cmd('skill.equipLoadout', { id: 'potential:velocityForce' }).result, /未知技能/);
  assert.deepEqual(plain(c.G.player.loadout), []);
});

test('現代舊檔清除潛力與解鎖節點，精確退點、保留其他威能與技能格位，重讀不重複退', () => {
  const e = engine(), raw = JSON.parse(e.saveJson());
  raw.player.reincarnations = 10;
  raw.player.gold = 987654;
  raw.player.reincarnationTalentPoints = 7;
  raw.player.talents = {
    levels: { t1_str: 3, t3_potential: 2 },
    potentialLevels: { velocityForce: 3, lightningOverdrive: 10, omegaImpact: -3, unknown: 10 }
  };
  raw.player.skillPoints = 123;
  raw.player.potentialPoints = 123;
  raw.player.loadout = ['sg:thrust', 'potential:velocityForce', 'sg:knife', 'potential:lightningOverdrive'];
  raw.player.skillMastery = { level: 123, xp: 45 };
  const migrated = e.ctx.migrateSave(raw);
  assert.equal(migrated.player.reincarnationTalentPoints, 71); // 7 + 6 + 55 + 3
  assert.equal(migrated.player.gold, 987654);
  assert.equal(migrated.player.talents.levels.t1_str, 3);
  assert.equal(migrated.player.talents.levels.t3_potential, undefined);
  assert.equal(migrated.player.talents.potentialLevels, undefined);
  assert.equal(migrated.player.skillPoints, undefined);
  assert.equal(migrated.player.potentialPoints, undefined);
  assert.deepEqual(plain(migrated.player.loadout), ['sg:thrust', null, 'sg:knife']);
  assert.deepEqual(plain(migrated.player.skillMastery), { level: 123, xp: 45 });
  const reloaded = engine(plain(migrated));
  assert.equal(reloaded.ctx.G.player.reincarnationTalentPoints, 71);
  const savedAgain = engine(JSON.parse(reloaded.saveJson()));
  assert.equal(savedAgain.ctx.G.player.reincarnationTalentPoints, 71);
  assert.equal(savedAgain.ctx.G.player.talents.potentialLevels, undefined);
});

test('早期威能遷移保留舊解鎖節點退款與潛力升級金幣，不重複發現代點數', () => {
  const c = engine().ctx;
  const raw = {
    player: {
      reincarnations: 3, gold: 100, reincarnationTalentPoints: 7,
      talents: { levels: { t3_potential: 2 }, potentialLevels: { velocityForce: 3 } }, loadout: []
    }
  };
  c.migratePowerSave(raw);
  assert.equal(raw.player.reincarnationTalentPoints, 31); // 舊制：2 × (3 + 9)
  assert.equal(raw.player.gold, 3182); // 歷史升級金幣 20 + 1026 + 2036
  assert.equal(raw.player.talents.potentialLevels, undefined);
  c.migratePowerSave(raw);
  assert.equal(raw.player.reincarnationTalentPoints, 31);
  assert.equal(raw.player.gold, 3182);
});

test('威能整轉全滿不加倍且威脅沿表值，移除的四個節點不參與判斷', () => {
  const c = engine().ctx;
  c.G.player.reincarnations = 10;
  for (const turn of [3, 4, 7, 10]) {
    assert.equal(c.TALENT_TREES[turn].length, 7);
    assert.equal(c.talentDef('t' + turn + '_potential'), null);
    for (const def of c.TALENT_TREES[turn]) c.G.player.talents.levels[def.id] = 10;
    assert.equal(c.talentCompleteMultiplier(turn), 1);
  }
  assert.equal(c.talentThreatTotal(), 56);
  assert.equal(c.talentSpentPoints(), 1540);
});

test('移除潛力專用狀態與戰鬥出口，同名通用符文增益仍作用於技能與普攻', () => {
  const c = engine().ctx;
  for (const id of ['velocitySurge', 'lightningOverload', 'chronoCdr', 'sacredInvert', 'enemyAspdDown']) {
    assert.equal(c.STATUS[id], undefined);
  }
  const p = c.newPlayerEntity(c.getStats());
  c.applyStatus(p, 'allDmgUp', { val: 20, dur: 8 });
  assert.equal(c.skills2AllDamageUpPct(p), 20);
  assert.equal(c.playerAtkCfg(p).totalDmgPct, c.getStats().totalDmgPct + 20);
  assert.equal(c.playerDefCfg(p).undyingGuard, undefined);
  assert.equal(c.potentialVelocityFactor, undefined);
  assert.equal(c.enemyAspdDownPct, undefined);
  assert.equal(c.ccForceLock, undefined);
  assert.equal(c.VFX_COMBAT_DEFAULTS.chainLightning, undefined);
});

test('Skills主表與生成入口已刪除；現行三份相關Excel、CSV與程式資料一致', () => {
  for (const file of ['config/Excel/Skills.xlsx', 'config/CSV/Skills.csv', 'outputs/skills-descriptions/Skills.xlsx', 'js/potential.js']) {
    assert.equal(fs.existsSync(file), false, file);
  }
  assert.equal(tables.SCHEMAS.Skills, undefined);
  const obsoleteTable = spawnSync(process.execPath, ['tools/config_tables.cjs', '--gen', 'Skills'], { encoding: 'utf8' });
  assert.equal(obsoleteTable.status, 1);
  assert.match(obsoleteTable.stderr, /Skills 表已移除/);
  for (const name of ['Talents', 'Status', 'game_parameters']) {
    const rows = tables.readXlsxRows('config/Excel/' + name + '.xlsx');
    const csv = tables.csvParse(fs.readFileSync('config/CSV/' + name + '.csv', 'utf8').replace(/^\uFEFF/, ''));
    assert.deepEqual(csv, rows, name);
    assert.doesNotMatch(JSON.stringify(rows), /潛力|potential/);
  }
  const params = tables.csvParse(fs.readFileSync('config/CSV/game_parameters.csv', 'utf8'));
  assert.ok(params.slice(1).every(row => Number.isInteger(Number(row[0])) && Number(row[0]) > 0), '刪列後保留有效、穩定的參數編號');
  assert.equal(params.some(row => row[3] === '技能點總預算'), false);
  assert.equal(params.some(row => row[2] === '9-技能' && ['升級費用', '等級上限'].includes(row[3])), false);
  assert.ok(params.filter(row => row[2] === '1-轉生對照表').every(row => Number(row[10]) === 0));
});

test('技能與威能頁、說明、載入鏈與配套工具沒有潛力入口或已移除模組引用', () => {
  const c = engine().ctx;
  c.document = { getElementById: () => null };
  vm.runInContext(fs.readFileSync('js/ui.js', 'utf8'), c);
  for (const fn of ['potentialNodeHTML', 'describePotentialSkill', 'potentialSkillId', 'renderSkillModal']) assert.equal(c[fn], undefined, fn);
  for (const file of ['index.html', 'monte_carlo_app.html', 'js/ui.js', 'js/skills.js', 'js/skills2.js', 'js/combat.js', 'js/tower.js', 'js/formula.js', 'tools/config_tables.cjs']) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /potential:|POTENTIAL_TALENTS|potential\.js|talent\.potential|sgb-potential|潛力/, file);
  }
  assert.doesNotMatch(fs.readFileSync('index.html', 'utf8'), /sp-count|id="skill-modal"|每升 1 級 \+1 技能點/);
  for (const name of fs.readdirSync('scripts/sim').filter(name => /^policy\..*\.json$/.test(name) || name === 'command_coverage.json')) {
    assert.doesNotMatch(fs.readFileSync('scripts/sim/' + name, 'utf8'), /potential|潛力/i, name);
  }
});
