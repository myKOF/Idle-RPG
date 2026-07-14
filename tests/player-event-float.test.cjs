const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const util = fs.readFileSync(path.join(root, 'js', 'util.js'), 'utf8');
const combat = fs.readFileSync(path.join(root, 'js', 'combat.js'), 'utf8');
const skills = fs.readFileSync(path.join(root, 'js', 'skills.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');

test('玩家事件浮字使用頭像區專用位置，不和傷害數字共用位置', () => {
  assert.match(util, /function playerEventFloatTarget\(floatSel\)/);
  assert.match(util, /function floatPlayerEvent\(floatSel,\s*text,\s*cls\)/);
  assert.match(util, /function enemyEventFloatTarget\(ent,\s*floatSel\)/);
  assert.match(util, /function floatEnemyEvent\(ent,\s*floatSel,\s*text,\s*cls\)/);

  const block = css.match(/\.float-txt\.player-event\s*\{([\s\S]*?)\}/);
  assert.ok(block, '找不到玩家事件浮字樣式');
  assert.match(block[1], /top:\s*20%/);
  assert.match(block[1], /animation:\s*playerEventFloat/);
  assert.match(css, /@keyframes\s+playerEventFloat\s*\{/);
});

test('怪物攻擊玩家時，閃避、格擋、護盾吸收與附加效果會顯示玩家事件浮字', () => {
  assert.match(combat, /floatPlayerEvent\(floatSel,\s*'閃避!'/);
  assert.match(combat, /floatPlayerEvent\(floatSel,\s*'格擋!'/);
  assert.match(combat, /floatPlayerEvent\(floatSel,\s*'🛡️護盾吸收 ' \+ fmt\(res\.absorbed\)/);
  assert.match(combat, /res\.procs\.forEach\(function \(proc\)/);
});

test('我方攻擊被敵方閃避時，MISS 顯示在敵方浮層', () => {
  assert.match(combat, /floatEnemyEvent\(mEnt,\s*floatSel,\s*'MISS',\s*'miss'\)/);
  assert.doesNotMatch(combat, /floatText\(mEnt\.floatSel \|\| floatSel,\s*'MISS'/);
  assert.match(skills, /floatEnemyEvent\(targetEnt,\s*floatSel,\s*'MISS',\s*'miss'\)/);
  assert.doesNotMatch(skills, /floatText\(targetEnt\.floatSel \|\| floatSel,\s*'MISS'/);
  const missBlock = css.match(/\.float-txt\.miss\s*\{([\s\S]*?)\}/);
  assert.ok(missBlock, '找不到 MISS 浮字樣式');
  assert.match(missBlock[1], /color:\s*#dc2626/);
  assert.match(missBlock[1], /rgba\(127,\s*29,\s*29,\s*0\.9\)/);
});

test('玩家技能取得護盾與所有自身 buff 時會顯示玩家事件浮字', () => {
  assert.match(skills, /function playerBuffFloatClass\(key\)/);
  assert.match(skills, /function showPlayerBuffFloat\(floatSel,\s*buff,\s*lv\)/);
  assert.match(skills, /playerBuffFloatClass\(buff\.key\)/);
  assert.match(skills, /floatPlayerEvent\(floatSel,\s*'🛡️\+' \+ fmt\(gainedShield\)/);
  assert.match(skills, /showPlayerBuffFloat\(floatSel,\s*fx\.buff,\s*lv\)/);
  assert.match(skills, /showPlayerBuffFloat\(floatSel,\s*fx\.buff2,\s*lv\)/);
  assert.match(skills, /floatPlayerEvent\(floatSel,\s*'✨淨化',\s*'special'\)/);
  assert.match(skills, /floatPlayerEvent\(floatSel,\s*'再生 ' \+ fx\.hotDur \+ '秒',\s*'heal'\)/);
  assert.match(skills, /floatPlayerEvent\(floatSel,\s*'法力 \+' \+ fx\.mpRestore,\s*'mana'\)/);
});

test('玩家事件浮字依效果類型使用不同顏色', () => {
  assert.match(css, /\.float-txt\.player-event\.shield,[\s\S]*?\.float-txt\.player-event\.mana\s*\{[\s\S]*?color:\s*#7dd3fc/);
  assert.match(css, /\.float-txt\.player-event\.attack\s*\{[\s\S]*?color:\s*#fb923c/);
  assert.match(css, /\.float-txt\.player-event\.special\s*\{[\s\S]*?color:\s*#facc15/);
  assert.match(css, /\.float-txt\.player-event\.defense,[\s\S]*?\.float-txt\.player-event\.heal\s*\{[\s\S]*?color:\s*#4ade80/);
  assert.match(css, /\.float-txt\.player-event\.debuff\s*\{[\s\S]*?color:\s*#fb7185/);
});
