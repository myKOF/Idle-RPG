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
  assert.match(util, /function floatEnemyEvent\(ent,\s*floatSel,\s*text,\s*cls,\s*damageValue,\s*delayMs\)/);

  const block = css.match(/\.float-txt\.player-event\s*\{([\s\S]*?)\}/);
  assert.ok(block, '找不到玩家事件浮字樣式');
  assert.match(block[1], /top:\s*20%/);
  assert.match(block[1], /animation:\s*playerEventFloat\s+2s\s+ease-out\s+forwards/);
  assert.match(css, /@keyframes\s+playerEventFloat\s*\{/);
  assert.match(ui, /Each float has its own removal timer/);
  assert.doesNotMatch(ui, /querySelectorAll\('\.float-txt:not\(\.player-event\)'\)/);
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

test('敵人尚未建立卡片就被擊殺時，傷害浮字會等卡片建立後補顯示', () => {
  assert.match(util, /floatText\(enemyEventFloatTarget\(ent, floatSel\), text, cls, damageValue, ent, undefined, delayMs\)/);
  assert.match(ui, /var PENDING_ENEMY_FLOATS = \[\];/);
  assert.match(ui, /var INSTANT_KILL_HP_ANIMATION_MS = 100;/);
  assert.match(ui, /function queuePendingEnemyFloat\(elId, text, cls, damageValue, ent\)/);
  assert.match(ui, /function animatePendingEnemyKill\(ent, elId, cls, battleSnapshot\)/);
  assert.match(ui, /fill\.style\.width = '100%';[\s\S]*?fill\.style\.transition = 'width ' \+ INSTANT_KILL_HP_ANIMATION_MS \+ 'ms linear';[\s\S]*?fill\.style\.width = '0%';/);
  assert.match(ui, /function flushPendingEnemyFloats\(battleSnapshot\)/);
  assert.match(ui, /if \(!layer \|\| layer\.offsetParent === null\) \{[\s\S]*?queuePendingEnemyFloat\(elId, text, cls, damageValue, ent\)/);
  assert.match(ui, /flushPendingEnemyFloats\(battleSnapshot\);/);
});

test('我方攻擊被敵方閃避時，MISS 顯示在敵方浮層', () => {
  // v17 起普攻 MISS 也等劍氣飛到才跳（atkHitDelayMs＝飛行＋追加波次錯開）
  assert.match(combat, /floatEnemyEvent\(mEnt,\s*floatSel,\s*'MISS',\s*'miss enemy-dodge',\s*undefined,\s*atkHitDelayMs\)/);
  assert.doesNotMatch(combat, /floatText\(mEnt\.floatSel \|\| floatSel,\s*'MISS'/);
  // 技能的 MISS 與傷害數字一樣要等「打到人」才跳（多段技逐段錯開）
  assert.match(skills, /floatEnemyEvent\(targetEnt,\s*floatSel,\s*'MISS',\s*'miss enemy-dodge',\s*undefined,\s*hitDelayMs\)/);
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

test('敵人傷害浮字維持可讀字號且出現範圍更分散', () => {
  assert.match(ui, /function isEnemyHitFloat\(elId,\s*cls\)/);
  assert.match(ui, /var ENEMY_DAMAGE_FLOAT_WINDOW_MS = 4000/);
  assert.match(ui, /var ENEMY_DAMAGE_FLOAT_MAX_HITS = 20/);
  assert.match(ui, /function enemyDamageFloatMergeLimit\(battleSnapshot\)/);
  assert.match(ui, /Math\.min\(ENEMY_DAMAGE_FLOAT_MAX_HITS, Math\.floor\(comboHits \* aspd \* 2\)\)/);
  assert.match(ui, /existing\._damageFloatHits >= damageMergeLimit/);
  assert.match(ui, /var FLOAT_TEXT_LIFETIME_MS = 2000/);
  assert.match(ui, /damage-aggregate/);
  assert.match(ui, /function placeEnemyDamageFloat\(sp, layer\)/);
  assert.match(ui, /if \(enemyHitFloat\) placeEnemyDamageFloat\(sp, layer, targetLayer\);/);
  assert.match(ui, /if \(panel && !enemyHitFloat\) \{/);
  assert.match(ui, /tokens\.indexOf\('crit'\) >= 0/);
  assert.match(ui, /tokens\.indexOf\('crit-high-roll'\) >= 0/);
  assert.match(ui, /sp\.className \+= ' enemy-hit-float'/);
  assert.match(ui, /function enemyDamageFloatStyleClass\(cls\)/);
  assert.match(ui, /isCrit \? 'enemy-hit-attack-crit' : 'enemy-hit-attack'/);
  assert.match(ui, /isCrit \? 'enemy-hit-skill-crit' : 'enemy-hit-skill'/);
  assert.match(ui, /enemy-hit-crit-high/);
  assert.match(ui, /function enemyDamageFloatLifetimeMs\(sp\)/);
  assert.match(ui, /getPropertyValue\('--enemy-hit-lifetime'\)/);
  assert.match(ui, /scheduleFloatTextRemoval\(existing, enemyDamageFloatLifetimeMs\(existing\)\)/);
  assert.match(ui, /scheduleFloatTextRemoval\(sp, enemyDamageFloatLifetimeMs\(sp\)\)/);
  assert.match(ui, /var enemyStyleClass = enemyHitFloat \? enemyDamageFloatStyleClass\(cls\) : ''/);
  assert.match(ui, /var pct = enemyHitFloat \? 8 \+ Math\.random\(\) \* 84 : 15 \+ Math\.random\(\) \* 70/);
  assert.match(ui, /sp\.style\.top = \(28 \+ Math\.random\(\) \* 44\) \+ '%'/);
  assert.match(ui, /sp\.style\.marginTop = \(enemyHitFloat \? \(Math\.random\(\) \* 24 - 12\) : \(Math\.random\(\) \* 30 - 15\)\) \+ 'px'/);
  assert.match(css, /\.float-txt\.enemy-hit-float\.enemy-hit-attack\s*\{[\s\S]*?--enemy-hit-font-size:\s*12px[\s\S]*?font-size:\s*var\(--enemy-hit-font-size\)[\s\S]*?--enemy-hit-rise-duration:\s*0\.8s[\s\S]*?--enemy-hit-lifetime-base:\s*0\.8s/);
  assert.match(css, /\.float-txt\.enemy-hit-float\.enemy-hit-skill\s*\{[\s\S]*?--enemy-hit-font-size:\s*15px[\s\S]*?font-size:\s*var\(--enemy-hit-font-size\)[\s\S]*?--enemy-hit-rise-duration:\s*1s[\s\S]*?--enemy-hit-lifetime-base:\s*1s/);
  assert.match(css, /\.float-txt\.enemy-hit-float\.enemy-hit-attack-crit\s*\{[\s\S]*?--enemy-hit-font-size:\s*16px[\s\S]*?font-size:\s*var\(--enemy-hit-font-size\)[\s\S]*?--enemy-hit-rise-duration:\s*1s[\s\S]*?--enemy-hit-lifetime-base:\s*1s/);
  assert.match(css, /\.float-txt\.enemy-hit-float\.enemy-hit-skill-crit\s*\{[\s\S]*?--enemy-hit-font-size:\s*20px[\s\S]*?font-size:\s*var\(--enemy-hit-font-size\)[\s\S]*?--enemy-hit-rise-duration:\s*1\.2s[\s\S]*?--enemy-hit-lifetime-base:\s*1\.2s/);
  assert.doesNotMatch(css, /\.float-txt\.enemy-hit-float\.dmg\s*\{/);
  assert.doesNotMatch(css, /\.float-txt\.enemy-hit-float\.enemy-attack\s*\{/);
});

test('傷害浮字合併上限依連擊數與攻速計算', () => {
  const helperSource = ui.match(/function enemyDamageFloatMergeLimit\(battleSnapshot\) \{[\s\S]*?\n\}/)[0];
  let stats = { comboHits: 0, aspd: 2 };
  // 合併目前被使用者暫時關閉（見 ENEMY_DAMAGE_FLOAT_MERGE_ENABLED），
  // 這裡明確開啟以驗證公式本身沒被改壞；關閉狀態另有一支測試。
  const getLimit = vm.runInNewContext(
    '(function () { ' + helperSource + '; return enemyDamageFloatMergeLimit; })()',
    {
      Math,
      Number,
      isFinite,
      ENEMY_DAMAGE_FLOAT_MAX_HITS: 20,
      ENEMY_DAMAGE_FLOAT_MERGE_ENABLED: true
    }
  );

  assert.equal(getLimit(), 0);
  assert.equal(getLimit(null), 0);
  stats = { comboHits: 0.9, aspd: 2 };
  assert.equal(getLimit({ stats }), 3);
  stats = { comboHits: 100, aspd: 5 };
  assert.equal(getLimit({ stats }), 20);
});

/* 使用者要求暫時關閉合併，以便觀察實際的多段受擊。
   這支測試釘住「目前是關的」這個事實——恢復時會失敗，提醒把這段一併改掉。 */
test('傷害浮字合併目前為關閉狀態（暫時設定）', () => {
  assert.match(ui, /var ENEMY_DAMAGE_FLOAT_MERGE_ENABLED = false;/);
  const helperSource = ui.match(/function enemyDamageFloatMergeLimit\(battleSnapshot\) \{[\s\S]*?\n\}/)[0];
  const getLimit = vm.runInNewContext(
    '(function () { ' + helperSource + '; return enemyDamageFloatMergeLimit; })()',
    { Math, Number, isFinite, ENEMY_DAMAGE_FLOAT_MAX_HITS: 20, ENEMY_DAMAGE_FLOAT_MERGE_ENABLED: false }
  );
  // 0 = 不合併：合併迴圈的 hits >= limit 恆成立，每一段都會各自飄字
  assert.equal(getLimit({ stats: { comboHits: 100, aspd: 5 } }), 0);
});

test('傷害浮字高峰會自動合併並跳過昂貴的碰撞排版', () => {
  assert.match(ui, /var ENEMY_DAMAGE_FLOAT_AUTO_MERGE_THRESHOLD = 12/);
  assert.match(ui, /var ENEMY_DAMAGE_FLOAT_AUTO_MERGE_LIMIT = 4/);
  assert.match(ui, /function enemyDamageFloatActiveCount\(layer\)/);
  assert.match(ui, /enemyDamageFloatActiveCount\(layer\) >= ENEMY_DAMAGE_FLOAT_AUTO_MERGE_THRESHOLD/);
  assert.match(ui, /if \(!ENEMY_FLOAT_LAYOUT_ENABLED\) return/);
  assert.match(ui, /if \(damageMergeLimit > 0\) \{[\s\S]*?damageFloats = layer\.querySelectorAll/);
});

test('敵方區四種傷害樣式獨立，爆擊不改變普攻／技能來源顏色', () => {
  // v17 起普攻傷害數字與劍氣命中同步（atkHitDelayMs）
  assert.match(combat, /floatEnemyEvent\(mEnt,\s*floatSel,\s*dmgStr,\s*combatDamageFloatClass\('enemy-attack',\s*res\),\s*res\.dmg,\s*atkHitDelayMs\)/);
  assert.match(combat, /'crit enemy-attack'/);
  assert.match(skills, /floatEnemyEvent\(targetEnt,\s*floatSel,\s*sk\.emoji \+ dmgStr,\s*combatDamageFloatClass\('enemy-skill',\s*dmgRes\),\s*dmgRes\.dmg,\s*hitDelayMs\)/);
  assert.match(skills, /'crit enemy-skill'/);
  assert.match(util, /function combatDamageFloatClass\(source, result, forceCrit\)/);
  assert.match(util, /crit-high-roll/);
  assert.match(css, /\.float-txt\.enemy-hit-float\.enemy-hit-attack\s*\{[\s\S]*?color:\s*#ffffff/);
  assert.match(css, /\.enemy-combatant\s*\{[\s\S]*?overflow:\s*visible/);
  assert.match(css, /\.float-txt\.enemy-hit-float\.enemy-hit-attack\s*\{[\s\S]*?--enemy-hit-font-size:\s*12px/);
  assert.match(css, /\.float-txt\.enemy-hit-float\.enemy-hit-attack-crit\s*\{[\s\S]*?--enemy-hit-font-size:\s*16px/);
  assert.match(css, /\.float-txt\.enemy-hit-float\.enemy-hit-skill\s*\{[\s\S]*?color:\s*#ffd700/);
  assert.match(css, /\.float-txt\.enemy-hit-float\.enemy-hit-skill-crit\s*\{[\s\S]*?color:\s*#ffd700/);
  assert.match(css, /\.float-txt\.enemy-hit-float\.enemy-hit-attack\s*\{[\s\S]*?z-index:\s*10\s*!important/);
  assert.match(css, /\.float-txt\.enemy-hit-float\.enemy-hit-skill\s*\{[\s\S]*?z-index:\s*20\s*!important/);
  assert.match(css, /\.enemy-hit-attack-crit\.enemy-hit-crit-high,[\s\S]*?\.enemy-hit-skill-crit\.enemy-hit-crit-high[\s\S]*?font-size:\s*calc\(var\(--enemy-hit-font-size\) \+ 2px\)/);
  assert.match(css, /\.enemy-hit-crit-high[\s\S]*?--enemy-hit-lifetime:\s*calc\(var\(--enemy-hit-lifetime-base\) \* 2\)/);
  assert.match(css, /\.float-txt\.enemy-hit-float\.damage-aggregate\s*\{[\s\S]*?var\(--enemy-hit-rise-duration,\s*2s\)[\s\S]*?var\(--enemy-hit-lifetime,\s*2s\)/);
  assert.doesNotMatch(css, /\.float-txt\.enemy-hit-float\.enemy-attack\s*\{/);
  assert.doesNotMatch(css, /\.float-txt\.enemy-hit-float\.enemy-skill\s*\{/);
  assert.match(css, /\.float-txt\.enemy-hit-float\.damage-aggregate\s*\{[\s\S]*?animation:\s*enemyDamageFloatUp\s+var\(--enemy-hit-rise-duration,\s*2s\)[\s\S]*?enemyDamageFloatFade\s+var\(--enemy-hit-lifetime,\s*2s\)/);
  assert.match(css, /@keyframes\s+enemyDamageFloatFade\s*\{[\s\S]*?75%\s*\{[\s\S]*?opacity:\s*1[\s\S]*?100%\s*\{[\s\S]*?opacity:\s*0/);
  assert.match(css, /@keyframes\s+enemyDamageFloatUp\s*\{[\s\S]*?translate\(-50%,\s*-80px\)/);
  assert.match(css, /\.float-txt\.player-event\.dodge\s*\{[\s\S]*?z-index:\s*8/);
});

test('玩家技能取得護盾與所有自身 buff 時會顯示玩家事件浮字', () => {
  assert.match(skills, /function playerBuffFloatClass\(key\)/);
  assert.match(skills, /function showPlayerBuffFloat\(floatSel,\s*buff,\s*lv,\s*mult\)/); // 5 轉昇華天賦倍率同步顯示
  assert.match(skills, /playerBuffFloatClass\(buff\.key\)/);
  assert.match(skills, /floatPlayerEvent\(floatSel,\s*'🛡️\+' \+ fmt\(gainedShield\)/);
  // 2026-07-30 技能融合改造：buff 施加改走 skillFxBuffList 迴圈（支援融合技不限數量的 buffList）
  assert.match(skills, /skillFxBuffList\(fx\)\.forEach\(function \(bf\) \{/);
  assert.match(skills, /showPlayerBuffFloat\(floatSel,\s*bf,\s*lv,\s*fxMult\)/);
  assert.match(skills, /floatPlayerEvent\(floatSel,\s*'✨淨化',\s*'special'\)/);
  assert.match(skills, /floatPlayerEvent\(floatSel,\s*'再生 ' \+ fx\.hotDur \+ '秒',\s*'heal'\)/);
  assert.match(skills, /floatPlayerEvent\(floatSel,\s*'法力 \+' \+ fmt\(mpGain\),\s*'mana',\s*mpGain\)/);
});

test('玩家事件浮字依效果類型使用不同顏色', () => {
  assert.match(css, /\.float-txt\.player-event\.shield,[\s\S]*?\.float-txt\.player-event\.mana\s*\{[\s\S]*?color:\s*#7dd3fc/);
  assert.match(css, /\.float-txt\.player-event\.attack\s*\{[\s\S]*?color:\s*#fb923c/);
  assert.match(css, /\.float-txt\.player-event\.special\s*\{[\s\S]*?color:\s*#facc15/);
  assert.match(css, /\.float-txt\.player-event\.defense,[\s\S]*?\.float-txt\.player-event\.heal\s*\{[\s\S]*?color:\s*#4ade80/);
  assert.match(css, /\.float-txt\.player-event\.debuff\s*\{[\s\S]*?color:\s*#fb7185/);
});
