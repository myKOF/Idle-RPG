const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('tower auto challenge shows result modal with countdown before next fight', () => {
  const tower = fs.readFileSync(path.join(root, 'js/tower.js'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.match(html, /id="trm-stop-auto"/);
  assert.match(tower, /var TOWER_AUTO_RESULT_DELAY = 3\.0/);
  assert.match(tower, /result\.autoCountdown = reason !== 'flee'/);
  assert.match(tower, /result\.autoContinue = true/);
  assert.match(tower, /function stopTowerAutoFromResult\(\)/);
  assert.match(tower, /TOWER\.result\.autoContinue = false/);
  assert.match(tower, /TOWER\.auto = null/);
  assert.match(tower, /showTowerResultModal\(result, TOWER\.player, TOWER\.boss, TOWER\.dmgDealt, TOWER\.bossDmgDealt, \{/);
  assert.match(tower, /autoCountdown: result\.autoCountdown/);
  assert.match(tower, /countdown: TOWER_AUTO_RESULT_DELAY/);
  assert.match(tower, /function confirmTowerResult\(\)/);
  assert.match(tower, /startTowerFight\(auto\.floor\)/);

  const autoStart = tower.indexOf('if (TOWER.auto) {');
  const manualStart = tower.indexOf("if (typeof showTowerResultModal === 'function')");
  const autoBranch = tower.slice(autoStart, manualStart);
  assert.ok(autoStart >= 0);
  assert.ok(manualStart > autoStart);
  assert.doesNotMatch(autoBranch, /finishTowerFight\(\);/);

  assert.match(ui, /function showTowerResultModal\(r, p, b, myDmg, bDmg, options\)/);
  assert.match(ui, /function stopTowerAutoFromResultModal\(\)/);
  assert.match(ui, /options && options\.autoCountdown/);
  assert.match(ui, /confirmBtn\.disabled = countdown > 0/);
  assert.match(ui, /var stopAutoBtn = \$id\('trm-stop-auto'\)/);
  assert.match(ui, /var canStopAuto = countdown > 0 && r && r\.autoContinue/);
  assert.match(ui, /stopAutoBtn\.style\.display = canStopAuto \? 'inline-block' : 'none'/);
  assert.match(ui, /confirmBtn\.textContent = countdown > 0 \?/);
  assert.match(ui, /setInterval\(function \(\) \{/);
  assert.match(ui, /if \(countdown <= 0\) \{/);
  assert.match(ui, /confirmTowerResultModal\(\);/);
  assert.match(ui, /function confirmTowerResultModal\(\)/);
  assert.match(ui, /confirmTowerResult\(\)/);
  assert.match(ui, /\$id\('trm-stop-auto'\)\.onclick = stopTowerAutoFromResultModal/);
});
