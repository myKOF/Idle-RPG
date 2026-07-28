const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('戰鬥日誌分類與色彩樣式規則驗證', () => {
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const combat = fs.readFileSync(path.join(root, 'js/combat.js'), 'utf8');
  const skills = fs.readFileSync(path.join(root, 'js/skills.js'), 'utf8');
  const tower = fs.readFileSync(path.join(root, 'js/tower.js'), 'utf8');
  const forge = fs.readFileSync(path.join(root, 'js/forge.js'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'js/worker/sim.worker.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');

  // 1. 驗證掉落物僅分類「打敗敵人的掉落物」與「敵人掉落」，其餘獲得途徑不屬於 loot 分類
  assert.match(ui, /else\s+if\s*\(msg\.includes\('📦\s*戰利品：'\)\s*\|\|\s*msg\.includes\('敵人掉落'\)\)\s*cat\s*=\s*'loot';/);

  // 2. 驗證戰鬥日誌有寫入敵人攻擊
  assert.match(combat, /doMonsterAttack\([\s\S]*?blog\('🛡️\s*'\s*\+\s*logMsg,\s*cls,\s*logCat\);/);

  // 3. 驗證戰鬥日誌的顏色類別宣告
  // 我方的普攻: log-player-attack (白色)
  assert.match(combat, /blog\('⚔️\s*'\s*\+\s*logMsg,\s*'log-player-attack',\s*'combat'\);/);
  assert.match(css, /\.log-line\.log-player-attack\s*\{[\s\S]*?color:\s*#ffffff;[\s\S]*?\}/);

  // 我方的技能: log-player-skill (黃色)
  assert.match(skills, /var\s+cls\s*=\s*'log-player-skill';[\s\S]*?blog\(logMsg\s*\+\s*parts\.join\('，'\)\s*\+\s*'。',\s*cls,\s*'combat'\);/);
  assert.match(css, /\.log-line\.log-player-skill\s*\{[\s\S]*?color:\s*#fde047;[\s\S]*?\}/);

  // 我方施放的buff及debuff: log-player-buff (淺綠色)
  assert.match(skills, /if\s*\(sk\.cat\s*===\s*'def'\s*\|\|\s*sk\.cat\s*===\s*'special'\s*\|\|\s*\(sk\.cat\s*===\s*'fusion'\s*&&\s*!fx\.dmgType\)\)\s*\{\s*cls\s*=\s*'log-player-buff';\s*\}/);
  assert.match(css, /\.log-line\.log-player-buff\s*\{[\s\S]*?color:\s*#86efac;[\s\S]*?\}/);

  // 敵方造成的傷害: log-enemy-damage (淡紅色)
  assert.match(combat, /var\s+cls\s*=\s*'log-enemy-damage';/);
  assert.match(css, /\.log-line\.log-enemy-damage\s*\{[\s\S]*?color:\s*#fca5a5;[\s\S]*?\}/);

  // 敵方命中時拆分總傷害、生命實際損失與護盾吸收量
  assert.match(combat, /var\s+hpDamage\s*=\s*0;/);
  assert.match(combat, /hpDamage\s*=\s*Math\.max\(0,\s*res\.dmg\s*-\s*\(res\.absorbed\s*\|\|\s*0\)\)/);
  assert.match(combat, /生命減少\s+'\s*\+\s*fmt\(hpDamage\)\s*\+\s*'，護盾吸收/);

  // 敵方的技能: log-enemy-skill (淡黃色)
  assert.match(combat, /if\s*\(mult\s*&&\s*mult\s*>\s*1\)\s*\{\s*cls\s*=\s*'log-enemy-skill';\s*\}/);
  assert.match(css, /\.log-line\.log-enemy-skill\s*\{[\s\S]*?color:\s*#fff59d;[\s\S]*?\}/);
  assert.match(combat, /function\s+doMonsterAttack\(mEnt,\s*pEnt,\s*floatSel,\s*mult,\s*skillName\)/);
  assert.match(combat, /skillName\s*\?\s*' 使用【'\s*\+\s*skillName\s*\+\s*'】'/);
  assert.match(combat, /if\s*\(skillName\)\s*\{\s*cls\s*=\s*'log-enemy-skill';\s*\}/);
  assert.match(tower, /var\s+bossSpecialTarget\s*=[\s\S]*?doMonsterAttack\(b,\s*bossSpecialTarget,\s*'tp-float',\s*2\.2\s*\*\s*mult,\s*'蓄力重擊'\)/);

  // 敵方施放的buff或debuff: log-enemy-buff (淡咖啡色)
  assert.match(combat, /if\s*\(hasDebuff\)\s*\{\s*cls\s*=\s*'log-enemy-buff';\s*\}/);
  assert.match(css, /\.log-line\.log-enemy-buff\s*\{[\s\S]*?color:\s*#d7ccc8;[\s\S]*?\}/);

  // 4. 驗證神鑄日誌與 Worker 寶石批次日誌歸類到 factory，不屬於 loot
  assert.match(forge, /blog\('🔯 神鑄成功！6 顆'[\s\S]*?,\s*'good',\s*'factory'\);/);
  assert.match(forge, /blog\('🔯 鑄造失敗！損失 '[\s\S]*?,\s*'warn',\s*'factory'\);/);
  assert.match(forge, /blog\('🔯 神鑄成功！獲得 '[\s\S]*?,\s*'good',\s*'factory'\);/);
  assert.match(forge, /blog\('🔯 鑄造失敗！損失 '[\s\S]*?,\s*'warn',\s*'factory'\);/);
  assert.match(worker, /'gem\.composeAll'[\s\S]*blog\('♻️ 全部合成：'[\s\S]*'good',\s*'factory'\);/);
  assert.match(worker, /'gem\.dismantleAll'[\s\S]*blog\('⛏️ 全部拆解：'[\s\S]*'good',\s*'factory'\);/);

  // 寶石 UI 只送協議指令；Worker 產生的 log Event 再由主執行緒分類與渲染
  for (const command of [
    'gem.compose', 'gem.composeAll', 'gem.convert', 'gem.dismantle',
    'gem.dismantleAll', 'gem.dismantleFused', 'gem.fuse',
    'gem.shopBuyAll', 'gem.shopRefresh', 'gem.shopUpgrade'
  ]) {
    assert.match(ui, new RegExp("sendGemUiCommand\\(\\s*['\"]" + command.replace('.', '\\.') + "['\"]"));
  }
  assert.match(ui, /event\.kind === 'log'[\s\S]*routeUiLog\(event\.msg, event\.cls, event\.cat/);
});
