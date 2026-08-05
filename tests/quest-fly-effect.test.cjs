'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('spawnQuestRewardFlyFx and quest-claim-flash styles exist', () => {
  const css = fs.readFileSync(path.join(__dirname, '../css/style.css'), 'utf8');
  assert.match(css, /\.quest-claim-flash/);
  assert.match(css, /questClaimFlashAnim/);
  assert.match(css, /\.quest-fly-reward/);
  assert.match(css, /\.fly-trail-particle/);
  assert.match(css, /\.res-hit-bump/);

  const ui = fs.readFileSync(path.join(__dirname, '../js/ui.js'), 'utf8');
  assert.match(ui, /function spawnQuestRewardFlyFx/);
  assert.match(ui, /spawnQuestRewardFlyFx\(rewardType/);
});
