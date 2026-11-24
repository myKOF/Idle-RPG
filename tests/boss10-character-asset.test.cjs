'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const cfg = require('../tools/config_tables.cjs');

for (const [baseFloor, material, suffix] of [[10,1,''],[20,2,'_lv2']]) test('BOSS10 material '+material+' carries the five supplied motions and its tower appearance', () => {
  const modelPath = 'images/models/npc3d/boss10'+suffix+'.glb';
  const model = fs.readFileSync(require.resolve('../'+modelPath));
  assert.equal(model.readUInt32LE(0), 0x46546c67);
  assert.equal(model.readUInt32LE(8), model.length);
  const doc = JSON.parse(model.subarray(20, 20 + model.readUInt32LE(12)));
  assert.equal(doc.meshes.length, 1);
  assert.equal(doc.skins[0].joints.length, 52);
  assert.equal(doc.images.length, 3);
  const expected = { Walk: 4.1, Attack1: 55/30, Attack2: 2.8, Attack3: 95/30, Die: 89/30 };
  assert.deepEqual(doc.animations.map(clip => clip.name), Object.keys(expected));
  for (const clip of doc.animations) {
    assert.equal(clip.channels.length, 144);
    const duration = Math.max(...clip.samplers.map(sampler => doc.accessors[sampler.input].max[0]));
    assert.ok(Math.abs(duration - expected[clip.name]) < .0001, clip.name);
  }

  const rows = cfg.readXlsxRows(require.resolve('../config/Excel/NPC.xlsx'));
  const csv = cfg.csvParse(fs.readFileSync(require.resolve('../config/CSV/NPC.csv'), 'utf8')).filter(row => row.length > 1);
  assert.deepEqual(rows, csv);
  const id = 'tower_boss_'+baseFloor;
  const row = rows.find(entry => entry[0] === id);
  assert.equal(row[rows[0].indexOf('NPC名稱')], '熔岩巨人');
  assert.ok(row[rows[0].indexOf('備註')].startsWith('外觀：熔岩巨人'+material+'｜'));
  const source = fs.readFileSync(require.resolve('../js/data.js'), 'utf8');
  const bosses = cfg.evalLiteral(cfg.extractLiteral(source, 'BOSS_LIST').literal);
  const boss = bosses[baseFloor-1];
  assert.deepEqual([boss.id, boss.name, boss.attr, boss.runSpeed, boss.atkSpeed, boss.atkRange],
    [id, '熔岩巨人', 'dark', 21, 3, 32]);
  assert.deepEqual(boss.skills, { ex: ['e_curse', 'e_manadrain'], rnd: [4,6] });
  assert.equal(boss.model3d.file, modelPath);
  assert.equal(boss.img, 'sprites/boss/boss10_lava'+suffix+'.png');
  assert.deepEqual(Object.values(boss.model3d.clips), ['Walk', 'Walk', 'Attack1', 'Attack2', 'Attack3', 'Die']);
  for (const floor of [9, 30, 40, 50]) assert.equal(bosses[floor-1].model3d, undefined);

  const formula = fs.readFileSync(require.resolve('../js/formula.js'), 'utf8');
  const lookupSource = formula.match(/^function towerBossDefFor\(floor\) \{[\s\S]*?^\}/m)?.[0];
  assert.ok(lookupSource, 'tower floor lookup');
  const lookup = vm.runInNewContext(lookupSource + '\ntowerBossDefFor', { BOSS_LIST: bosses });
  for (const add of [0, 50, 100]) assert.equal(lookup(baseFloor+add), boss);
});
