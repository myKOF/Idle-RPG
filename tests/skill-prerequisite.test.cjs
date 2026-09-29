const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

// 舊技能表（SKILLS／tierLockReason／learnOrUpgradeSkill）已整個移除，原「所有技能取消前置投入點數限制」
// 的行為斷言隨之刪除；這裡只保留仍然成立的不變量：前置投入點數門檻不得以任何形式復活。
test('技能樹不再顯示前置投入點數門檻', () => {
  const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
  const applyParams = fs.readFileSync(path.join(root, 'tools', 'apply_params.cjs'), 'utf8');
  const paramsCsv = fs.readFileSync(path.join(root, 'config', 'CSV', 'game_parameters.csv'), 'utf8');
  assert.doesNotMatch(ui, /需投入 .*TIER_GATE_POINTS/);
  assert.doesNotMatch(applyParams, /TIER_GATE_POINTS/);
  assert.doesNotMatch(paramsCsv, /技能樹門檻/);
});
