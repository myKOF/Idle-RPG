const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const util = fs.readFileSync(path.join(root, 'js', 'util.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
const combat = fs.readFileSync(path.join(root, 'js', 'combat.js'), 'utf8');
const skills = fs.readFileSync(path.join(root, 'js', 'skills.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');

test('玩家事件浮字使用頭像區專用位置，不和傷害數字共用位置', () => {
  assert.match(util, /function playerEventFloatTarget\(floatSel\)/);
  assert.match(util, /function floatPlayerEvent\(floatSel,\s*text,\s*cls,\s*value\)/);
  assert.match(util, /function enemyEventFloatTarget\(ent,\s*floatSel\)/);
  assert.match(util, /function floatEnemyEvent\(ent,\s*floatSel,\s*text,\s*cls,\s*damageValue\)/);

  const block = css.match(/\.float-txt\.player-event\s*\{([\s\S]*?)\}/);
  assert.ok(block, '找不到玩家事件浮字樣式');
  assert.match(block[1], /top:\s*20%/);
  assert.match(block[1], /animation:\s*playerEventFloat\s+2s\s+ease-out\s+forwards/);
  assert.match(css, /@keyframes\s+playerEventFloat\s*\{/);
  assert.match(ui, /var isPlayerEvent = \(cls \|\| ''\)\.split\(\/\\s\+\/\)\.indexOf\('player-event'\) >= 0/);
  assert.match(ui, /querySelectorAll\('\.float-txt:not\(\.player-event\)'\)/);
  assert.doesNotMatch(ui, /if \(layer\.children\.length > 50\) layer\.removeChild\(layer\.firstChild\)/);
});

test('怪物攻擊玩家時，閃避、格擋、護盾吸收與附加效果會顯示玩家事件浮字', () => {
  const monsterAttackStart = combat.indexOf('function doMonsterAttack(');
  const monsterAttackEnd = combat.indexOf('function trackDps', monsterAttackStart);
  assert.ok(monsterAttackStart >= 0 && monsterAttackEnd > monsterAttackStart, '找不到 doMonsterAttack 區塊');
  const monsterAttack = combat.slice(monsterAttackStart, monsterAttackEnd);

  assert.match(monsterAttack, /var playerFloatSel = playerEventFloatTarget\(floatSel\);/);
  assert.doesNotMatch(monsterAttack, /floatText\(floatSel,\s*'MISS',\s*'miss'\)/);
  assert.doesNotMatch(monsterAttack, /floatText\(floatSel,\s*dmgStr/);
  assert.match(monsterAttack, /floatText\(playerFloatSel,\s*dmgStr,\s*isCrit \? 'crit' : 'mdmg'\)/);
  assert.match(combat, /floatPlayerEvent\(playerFloatSel,\s*'閃避!',\s*'dodge defend'\)/);
  assert.match(combat, /floatPlayerEvent\(playerFloatSel,\s*'格擋!'/);
  assert.match(combat, /floatPlayerEvent\(playerFloatSel,\s*'🛡️護盾吸收 ' \+ fmt\(res\.absorbed\)/);
  assert.match(combat, /res\.procs\.forEach\(function \(proc\)/);
});

test('我方攻擊被敵方閃避時，MISS 顯示在敵方浮層', () => {
  assert.match(combat, /floatEnemyEvent\(mEnt,\s*floatSel,\s*'MISS',\s*'miss enemy-dodge'\)/);
  assert.doesNotMatch(combat, /floatText\(mEnt\.floatSel \|\| floatSel,\s*'MISS'/);
  assert.match(skills, /floatEnemyEvent\(targetEnt,\s*floatSel,\s*'MISS',\s*'miss enemy-dodge'\)/);
  assert.doesNotMatch(skills, /floatText\(targetEnt\.floatSel \|\| floatSel,\s*'MISS'/);
  const missBlock = css.match(/\.float-txt\.miss\s*\{([\s\S]*?)\}/);
  assert.ok(missBlock, '找不到 MISS 浮字樣式');
  assert.match(missBlock[1], /color:\s*#dc2626/);
  assert.match(missBlock[1], /rgba\(127,\s*29,\s*29,\s*0\.9\)/);
});

test('高塔 BOSS 攻擊被玩家閃避時，黃色閃避字顯示在玩家浮層', () => {
  const floats = [];
  const context = {
    console,
    setTimeout() {},
    Math,
    SHIELD_MAX_VERSION: 1,
    ELEMENTS: []
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(util, context);
  vm.runInContext(combat, context);
  Object.assign(context, {
    floatText(id, text, cls) { floats.push({ id, text, cls }); },
    fmt(v) { return String(v); },
    blog() {}
  });
  vm.runInContext(`
    playerDefCfg = function () { return {}; };
    monsterAtkCfg = function () { return {}; };
    resolveHit = function () { return { miss: true, procs: [], thorns: 0 }; };
  `, context);

  context.doMonsterAttack({ name: 'BOSS' }, {}, 'tp-float', 1);
  assert.deepEqual(floats, [
    { id: 'tp-float', text: '閃避!', cls: 'player-event dodge defend' }
  ]);
});

test('高塔 BOSS 浮層收到 MISS 時，會轉成玩家區黃色閃避字', () => {
  assert.match(ui, /if \(elId === 'tb-float' && text === 'MISS' && cls === 'miss'\) \{/);
  assert.match(ui, /elId = 'tp-float';/);
  assert.match(ui, /text = '閃避!';/);
  assert.match(ui, /cls = 'player-event dodge defend';/);
});

test('高塔 BOSS 敵方閃避 MISS 會節流，避免畫面被連擊 MISS 洗版', () => {
  assert.match(ui, /if \(elId === 'tb-float' && text === 'MISS' && cls && cls\.indexOf\('enemy-dodge'\) >= 0\) \{/);
  assert.match(ui, /data-last-miss-at/);
  assert.match(ui, /now - lastMissAt < 300/);
});

test('敵人傷害浮字字號較小且出現範圍更分散', () => {
  assert.match(ui, /function isEnemyHitFloat\(elId,\s*cls\)/);
  assert.match(ui, /var ENEMY_DAMAGE_FLOAT_WINDOW_MS = 4000/);
  assert.match(ui, /var ENEMY_DAMAGE_FLOAT_MAX_HITS = 20/);
  assert.match(ui, /var FLOAT_TEXT_LIFETIME_MS = 2000/);
  assert.match(ui, /damage-aggregate/);
  assert.match(ui, /function placeEnemyDamageFloat\(sp, layer\)/);
  assert.match(ui, /if \(enemyHitFloat\) placeEnemyDamageFloat\(sp, layer\);/);
  assert.match(ui, /if \(panel && !enemyHitFloat\) \{/);
  assert.match(ui, /tokens\.indexOf\('crit'\) >= 0/);
  assert.match(ui, /sp\.className \+= ' enemy-hit-float'/);
  assert.match(ui, /var pct = enemyHitFloat \? 8 \+ Math\.random\(\) \* 84 : 15 \+ Math\.random\(\) \* 70/);
  assert.match(ui, /sp\.style\.top = \(28 \+ Math\.random\(\) \* 44\) \+ '%'/);
  assert.match(ui, /sp\.style\.marginTop = \(enemyHitFloat \? \(Math\.random\(\) \* 24 - 12\) : \(Math\.random\(\) \* 30 - 15\)\) \+ 'px'/);
  assert.match(css, /\.float-txt\.enemy-hit-float\.dmg,[\s\S]*?\.float-txt\.enemy-hit-float\.mdmg\s*\{[\s\S]*?font-size:\s*12px/);
  assert.match(css, /\.float-txt\.enemy-hit-float\.crit,[\s\S]*?\.float-txt\.enemy-hit-float\.skill\s*\{[\s\S]*?font-size:\s*18px/);
});

test('敵方區普攻固定白色、技能固定黃色，爆擊不改變來源顏色', () => {
  assert.match(combat, /floatEnemyEvent\(mEnt,\s*floatSel,\s*dmgStr,\s*\(res\.crit \? 'crit ' : 'dmg '\) \+ 'enemy-attack',\s*res\.dmg\)/);
  assert.match(combat, /'crit enemy-attack'/);
  assert.match(skills, /floatEnemyEvent\(targetEnt,\s*floatSel,\s*sk\.emoji \+ dmgStr,\s*\(dmgRes\.crit \? 'crit ' : 'dmg '\) \+ 'enemy-skill',\s*dmgRes\.dmg\)/);
  assert.match(skills, /'crit enemy-skill'/);
  assert.match(css, /\.float-txt\.enemy-hit-float\.enemy-attack\s*\{[\s\S]*?color:\s*#ffffff/);
  assert.match(css, /\.enemy-combatant\s*\{[\s\S]*?overflow:\s*visible/);
  assert.match(css, /\.float-txt\.enemy-hit-float\.enemy-attack\s*\{[\s\S]*?font-size:\s*10px/);
  assert.match(css, /\.float-txt\.enemy-hit-float\.enemy-attack\.crit\s*\{[\s\S]*?font-size:\s*16px/);
  assert.match(css, /\.float-txt\.enemy-hit-float\.enemy-skill\s*\{[\s\S]*?color:\s*#ffd700/);
  assert.match(css, /\.float-txt\.enemy-hit-float\.enemy-attack\s*\{[\s\S]*?z-index:\s*10\s*!important/);
  assert.match(css, /\.float-txt\.enemy-hit-float\.enemy-skill\s*\{[\s\S]*?z-index:\s*20\s*!important/);
  assert.match(css, /\.float-txt\.enemy-hit-float\.damage-aggregate\s*\{[\s\S]*?animation:\s*enemyDamageFloatUp\s+2s\s+ease-out\s+forwards,\s*enemyDamageFloatFade\s+2s/);
  assert.match(css, /@keyframes\s+enemyDamageFloatFade\s*\{[\s\S]*?75%\s*\{[\s\S]*?opacity:\s*1[\s\S]*?100%\s*\{[\s\S]*?opacity:\s*0/);
  assert.match(css, /@keyframes\s+enemyDamageFloatUp\s*\{[\s\S]*?translate\(-50%,\s*-80px\)/);
  assert.match(css, /\.float-txt\.player-event\.dodge\s*\{[\s\S]*?z-index:\s*8/);
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
  assert.match(skills, /floatPlayerEvent\(floatSel,\s*'法力 \+' \+ fmt\(fx\.mpRestore\),\s*'mana',\s*fx\.mpRestore\)/);
});

test('玩家事件浮字依效果類型使用不同顏色', () => {
  assert.match(css, /\.float-txt\.player-event\.shield,[\s\S]*?\.float-txt\.player-event\.mana\s*\{[\s\S]*?color:\s*#7dd3fc/);
  assert.match(css, /\.float-txt\.player-event\.attack\s*\{[\s\S]*?color:\s*#fb923c/);
  assert.match(css, /\.float-txt\.player-event\.special\s*\{[\s\S]*?color:\s*#facc15/);
  assert.match(css, /\.float-txt\.player-event\.defense,[\s\S]*?\.float-txt\.player-event\.heal\s*\{[\s\S]*?color:\s*#4ade80/);
  assert.match(css, /\.float-txt\.player-event\.debuff\s*\{[\s\S]*?color:\s*#fb7185/);
});
