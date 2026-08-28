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
const skills2 = fs.readFileSync(path.join(root, 'js', 'skills2.js'), 'utf8');
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
  assert.match(combat, /floatPlayerEvent\(playerFloatSel,\s*'🛡️吸收 ' \+ fmt\(res\.absorbed\)/);
  assert.match(combat, /res\.procs\.forEach\(function \(proc\)/);
});

test('我方受到的傷害帶負號，回復類飄字不得用紅色', () => {
  const renderer = fs.readFileSync(path.join(root, 'js', 'battle-renderer.js'), 'utf8');

  /* 數字前面要有負號：畫面上同時會有吸血、吸魔、護盾吸收好幾個數字，
     沒有正負號分不出哪一個在扣血。 */
  assert.match(combat, /var dmgStr = '-' \+ fmt\(res\.dmg\);/);

  /* 顏色不能再用「有沒有 player-event 這個類別」判斷——吸血／吸魔／岩甲護盾
     走的是 floatText（沒有那個類別），舊規則會把回血塗成紅色。 */
  const styleStart = renderer.indexOf('function floatStyle(');
  const styleEnd = renderer.indexOf('function floatMergeKey(', styleStart);
  assert.ok(styleStart >= 0 && styleEnd > styleStart, '找不到 floatStyle');
  const style = renderer.slice(styleStart, styleEnd);
  const playerBlock = style.slice(style.indexOf("elId === 'pv-float'"), style.indexOf('/* 敵方側'));
  assert.match(playerBlock, /isDamageToUs/);

  const redIdx = playerBlock.indexOf('#ff6b6b');
  const healIdx = playerBlock.indexOf("cls.indexOf('heal')");
  assert.ok(redIdx >= 0, '我方扣血仍然要用紅色');
  assert.ok(healIdx > redIdx, '扣血那一段要在回復分支之前就 return');
  /* 「紅」以顏色本身判定，不比對字面：R 很高而 G、B 都低就是紅色。
     這樣之後換色號也擋得住，而黃色 #ffd75e（G 高）不會被誤判。 */
  const reddish = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return r >= 0xd0 && g <= 0x80 && b <= 0x80;
  };
  const tailColors = playerBlock.slice(healIdx).match(/#[0-9a-f]{6}/ig) || [];
  tailColors.forEach((hex) => {
    assert.equal(reddish(hex), false, '扣血以外的分支不得用紅色，卻出現 ' + hex);
  });
  assert.match(playerBlock, /cls\.indexOf\('heal'\) >= 0[\s\S]*?#6dfb8f/);
  assert.match(playerBlock, /cls\.indexOf\('mp'\) >= 0[\s\S]*?#5fb2ff/);
});

test('復活倒數讀 FIELD.reviveCd，不是玩家實體上的欄位', () => {
  /* 這是 2026-08-13 的實際 bug：模擬層寫 FIELD.reviveCd，顯示層卻讀
     field.player.reviveCd——玩家實體（newPlayerEntity）根本沒有這個欄位，
     於是 dead 永遠是 false，倒地動作與 5 秒倒數都不會出現，而且不報錯。 */
  const renderer = fs.readFileSync(path.join(root, 'js', 'battle-renderer.js'), 'utf8');
  const uiSrc = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
  const combatSrc = fs.readFileSync(path.join(root, 'js', 'combat.js'), 'utf8');

  assert.match(combatSrc, /FIELD\.reviveCd = REVIVE_DELAY;/, '前提：倒數寫在 FIELD 上');
  assert.doesNotMatch(combatSrc, /player\.reviveCd\s*=/, '玩家實體上不該有 reviveCd');

  assert.match(renderer, /Number\(field\.reviveCd\) \|\| 0/);
  assert.doesNotMatch(renderer, /fp\.reviveCd/);
  assert.match(uiSrc, /uiCountdownRemain\(field\.reviveCd, battleSnapshot\.gt\)/);
  assert.doesNotMatch(uiSrc, /uiCountdownRemain\(p\.reviveCd/);
});

test('玩家倒地只旋轉本體，血條與死亡倒數維持水平並顯示整數秒', () => {
  const renderer = fs.readFileSync(path.join(root, 'js', 'battle-renderer.js'), 'utf8');
  const playerTickStart = renderer.indexOf('var p = S.player;');
  const playerTickEnd = renderer.indexOf('/* ---- 鏡頭：即時對準玩家 ----', playerTickStart);
  assert.ok(playerTickStart >= 0 && playerTickEnd > playerTickStart, '找不到玩家逐幀更新區塊');
  const playerTick = renderer.slice(playerTickStart, playerTickEnd);

  assert.match(playerTick, /p\.bodyWrap\.rotation\s*=\s*-\(Math\.PI\s*\/\s*2\)/);
  assert.doesNotMatch(playerTick, /p\.root\.rotation/);
  assert.match(renderer, /p\.reviveText\.text\s*=\s*'💀 復活倒數 '\s*\+\s*Math\.max\(1,\s*Math\.ceil/);
  assert.doesNotMatch(renderer, /p\.reviveText\.text\s*=.*Math\.round\(.*\*\s*10/);
});

test('血條與死亡倒數的畫面間距及字級符合死亡 UI 規格', () => {
  const renderer = fs.readFileSync(path.join(root, 'js', 'battle-renderer.js'), 'utf8');
  const reviveStart = renderer.indexOf('var reviveText = new PIXI.Text({');
  const reviveEnd = renderer.indexOf('S.layers.overlay.addChild(reviveText);', reviveStart);
  assert.ok(reviveStart >= 0 && reviveEnd > reviveStart, '找不到死亡倒數 HUD 建立區塊');
  const reviveHud = renderer.slice(reviveStart, reviveEnd);

  assert.match(renderer, /vitals\.y\s*=\s*8/);
  assert.match(renderer, /hpText\.y\s*=\s*8\s*\+\s*5/);
  assert.match(renderer, /mpText\.y\s*=\s*8\s*\+\s*16/);
  assert.match(reviveHud, /fontSize:\s*24/);
  assert.match(reviveHud, /reviveText\.y\s*=\s*-104/);
  assert.match(renderer, /p\.reviveText\.y\s*=\s*world\.y\s*\+\s*p\.root\.y\s*-\s*104/);
});

test('玩家死亡時紅色視野迷霧由外向中心收縮，復活後恢復黑色暗角', () => {
  const renderer = fs.readFileSync(path.join(root, 'js', 'battle-renderer.js'), 'utf8');
  assert.match(renderer, /function drawDeathFog\(k\)/);
  assert.match(renderer, /createRadialGradient\(center,\s*center,\s*inner/);
  assert.match(renderer, /rgba\(180, 0, 20, 0\)/);
  assert.match(renderer, /rgba\(180, 0, 20, 0\.03\)/);
  assert.match(renderer, /rgba\(180, 0, 20, 0\.07\)/);
  assert.match(renderer, /rgba\(180, 0, 20, 0\.10\)/);
  assert.doesNotMatch(renderer, /rgba\(180, 0, 20, 0\.(?:2[89]|[3-9]\d)\)/);
  assert.match(renderer, /inner\s*=\s*\(0\.42\s*-\s*0\.40\s*\*\s*k\)/);
  assert.match(renderer, /S\.deathFog\.visible\s*=\s*dead/);
  assert.match(renderer, /S\.vignette\.visible\s*=\s*!dead/);
  assert.match(renderer, /p\.deathFogK\s*=\s*Math\.min\(1,\s*\(p\.deathFogK\s*\|\|\s*0\)/);
});

test('飄字不重疊：新的字會避開畫面上還在的字', () => {
  const renderer = fs.readFileSync(path.join(root, 'js', 'battle-renderer.js'), 'utf8');
  assert.match(renderer, /function placeFloatNode\(node, baseX, baseY\)/);
  assert.match(renderer, /placeFloatNode\(node, pt\.x, pt\.y - 8\);/);
  /* 不能只靠隨機抖動：同一點同時落下三四個字時，隨機位移必然還是會疊在一起 */
  assert.doesNotMatch(renderer, /node\.x = pt\.x \+ \(Math\.random\(\) \* 36 - 18\)/);
});

test('擊殺目標之後要隔一段時間才對下一隻出手（TARGET_SWITCH_DELAY）', () => {
  const data = fs.readFileSync(path.join(root, 'js', 'data.js'), 'utf8');
  const csv = fs.readFileSync(path.join(root, 'config', 'CSV', 'game_parameters.csv'), 'utf8');
  assert.match(data, /var TARGET_SWITCH_DELAY = [\d.]+;/);
  assert.match(csv, /表-固定參數,換目標間隔,/, '參數表要有這一列，數值才調得動');
  /* 鎖定目標死掉的當下就要把普攻冷卻壓住，不能等下一輪選目標才處理——
     那時候這一個 tick 已經打出去了。 */
  assert.match(combat, /FIELD\.player\.atkCd = Math\.max\(Number\(FIELD\.player\.atkCd\) \|\| 0, switchCd\)/);
});

test('敵人尚未建立卡片就被擊殺時，傷害浮字會等卡片建立後補顯示', () => {
  assert.match(util, /floatText\(enemyEventFloatTarget\(ent, floatSel\), text, cls, damageValue, ent, undefined, delayMs\)/);
  assert.match(ui, /var PENDING_ENEMY_FLOATS = \[\];/);
  assert.match(ui, /var INSTANT_KILL_HP_ANIMATION_MS = 100;/);
  assert.match(ui, /function queuePendingEnemyFloat\(elId, text, cls, damageValue, ent\)/);
  assert.match(ui, /function animatePendingEnemyKill\(ent, elId, cls, battleSnapshot\)/);
  assert.match(ui, /fill\.style\.width = '100%';[\s\S]*?fill\.style\.transition = 'width ' \+ INSTANT_KILL_HP_ANIMATION_MS \+ 'ms linear';[\s\S]*?fill\.style\.width = '0%';/);
  assert.match(ui, /function flushPendingEnemyFloats\(battleSnapshot\)/);
  /* 圖層還沒掛上就先排隊，這個行為不變；只是判斷改由 floatLayerAttached 做，
     它把 offsetParent 這個版面讀取在同一幀內快取起來（見 js/ui.js 該函式說明）。 */
  assert.match(ui, /if \(!floatLayerAttached\(layer\)\) \{[\s\S]*?queuePendingEnemyFloat\(elId, text, cls, damageValue, ent\)/);
  assert.match(ui, /function floatLayerAttached\(layer\)[\s\S]*?layer\.offsetParent !== null/);
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
  assert.match(missBlock[1], /color:\s*#ef4444/);
  assert.match(missBlock[1], /rgba\(239,\s*68,\s*68,\s*0\.95\)/);
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
  /* 「敵方傷害浮字不裁切、其他浮字裁切在面板內」這個規則不變，
     只是條件搬到 clipGeometry 的計算上——容器幾何改成在浮字掛進 DOM 之前先讀
     並依幀快取（見 js/ui.js floatClipGeometry）。 */
  assert.match(ui, /var clipGeometry = \(clipPanel && !enemyHitFloat\) \? floatClipGeometry\(layer, clipPanel\) : null;/);
  assert.match(ui, /if \(clipGeometry && clipGeometry\.width > 0\) \{/);
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
  assert.match(ui, /var pct = enemyHitFloat \? 8 \+ Math\.random\(\) \* 84 :[\s\S]*?15 \+ Math\.random\(\) \* 70/);
  assert.match(ui, /sp\.style\.top = \(28 \+ Math\.random\(\) \* 44\) \+ '%'/);
  assert.match(ui, /sp\.style\.marginTop = \(enemyHitFloat \? \(Math\.random\(\) \* 24 - 12\) :[\s\S]*?Math\.random\(\) \* 30 - 15/);
  assert.match(css, /\.float-txt\.enemy-hit-float\.enemy-hit-attack\s*\{[\s\S]*?--enemy-hit-font-size:\s*12px[\s\S]*?font-size:\s*var\(--enemy-hit-font-size\)[\s\S]*?--enemy-hit-rise-duration:\s*0\.72s[\s\S]*?--enemy-hit-lifetime-base:\s*0\.68s/);
  assert.match(css, /\.float-txt\.enemy-hit-float\.enemy-hit-skill\s*\{[\s\S]*?--enemy-hit-font-size:\s*15px[\s\S]*?font-size:\s*var\(--enemy-hit-font-size\)[\s\S]*?--enemy-hit-lifetime-base:\s*0\.74s/);
  assert.match(css, /\.float-txt\.enemy-hit-float\.enemy-hit-attack-crit\s*\{[\s\S]*?--enemy-hit-font-size:\s*16px[\s\S]*?font-size:\s*var\(--enemy-hit-font-size\)[\s\S]*?--enemy-hit-lifetime-base:\s*0\.72s/);
  assert.match(css, /\.float-txt\.enemy-hit-float\.enemy-hit-skill-crit\s*\{[\s\S]*?--enemy-hit-font-size:\s*20px[\s\S]*?font-size:\s*var\(--enemy-hit-font-size\)[\s\S]*?--enemy-hit-lifetime-base:\s*0\.8s/);
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

/* 一般傷害合併仍維持關閉，以便觀察非連擊的多段受擊；明確標記的主普攻群組
   不受這個全域開關影響，另由「每次主普攻」測試驗證。 */
test('一般傷害浮字合併目前為關閉狀態', () => {
  assert.match(ui, /var ENEMY_DAMAGE_FLOAT_MERGE_ENABLED = false;/);
  const helperSource = ui.match(/function enemyDamageFloatMergeLimit\(battleSnapshot\) \{[\s\S]*?\n\}/)[0];
  const getLimit = vm.runInNewContext(
    '(function () { ' + helperSource + '; return enemyDamageFloatMergeLimit; })()',
    { Math, Number, isFinite, ENEMY_DAMAGE_FLOAT_MAX_HITS: 20, ENEMY_DAMAGE_FLOAT_MERGE_ENABLED: false }
  );
  // 0 = 一般事件不合併；明確的 damage-group 會在 floatText 內使用 Infinity 上限
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

test('每次主普攻的連擊傷害獨立累加，追加劍氣不重播普攻動作', () => {
  assert.match(combat, /var BASIC_DAMAGE_FLOAT_GROUP_SEQ = 0;/);
  assert.match(combat, /function basicDamageFloatGroupClass\(cls, groupId\)/);
  assert.match(combat, /var damageGroupId = \(opts && opts\.damageGroupId\) \|\|/);
  assert.match(combat, /!depth \? 'basic-' \+ \(\+\+BASIC_DAMAGE_FLOAT_GROUP_SEQ\) : ''/);
  assert.match(combat, /basicDamageFloatGroupClass\(combatDamageFloatClass\('enemy-attack', res\), damageGroupId\)/);
  assert.match(combat, /damageGroupId: damageGroupId/);
  assert.match(combat, /variant: depth \? 'swordwave-extra' : 'swordwave'/);

  const renderer = fs.readFileSync(path.join(root, 'js', 'battle-renderer.js'), 'utf8');
  const vfx = fs.readFileSync(path.join(root, 'js', 'vfx.js'), 'utf8');
  assert.match(renderer, /function floatDamageGroupId\(cls\)/);
  assert.match(renderer, /if \(groupId\) return elId \+ '\|damage-group:' \+ groupId;/);
  assert.match(renderer, /spec\.variant !== 'swordwave-extra'/);
  assert.match(renderer, /\(groupMerge \|\| nowMs\(\) - exist\.bornAt < FLOAT_MERGE_MS\)/);
  assert.match(vfx, /if \(v === 'swordwave' \|\| v === 'swordwave-extra'\) return 'vfx-proj-sword';/);

  assert.match(ui, /function enemyDamageFloatGroupId\(cls\)/);
  assert.match(ui, /if \(groupId\) return 'damage-group:' \+ groupId;/);
  assert.match(ui, /var damageMergeLimit = enemyDamageFloatMergeLimitForLayer\(battleSnapshot, layer\);[\s\S]*?if \(damageGroupId\) damageMergeLimit = Infinity;/);

  const helperSource = ui.match(/function enemyDamageFloatGroupId\(cls\) \{[\s\S]*?function enemyDamageFloatKey\(cls\) \{[\s\S]*?\n\}/)[0];
  const getKey = vm.runInNewContext(
    '(function () { ' + helperSource + '; return enemyDamageFloatKey; })()',
    {}
  );
  assert.equal(getKey('dmg enemy-attack damage-group-basic-1'), 'damage-group:basic-1');
  assert.equal(getKey('crit enemy-attack damage-group-basic-2'), 'damage-group:basic-2');
  assert.notEqual(getKey('dmg enemy-attack damage-group-basic-1'), getKey('dmg enemy-attack damage-group-basic-2'));
});

test('敵方區四種傷害樣式獨立，爆擊不改變普攻／技能來源顏色', () => {
  // v17 起普攻傷害數字與劍氣命中同步（atkHitDelayMs）
  assert.match(combat, /floatEnemyEvent\(mEnt,\s*floatSel,\s*dmgStr,\s*basicDamageFloatGroupClass\(combatDamageFloatClass\('enemy-attack',\s*res\),\s*damageGroupId\),\s*res\.dmg,\s*atkHitDelayMs\)/);
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
  assert.match(css, /@keyframes\s+enemyDamageFloatUp\s*\{[\s\S]*?translate\(-50%,\s*-42px\)\s+scale\(1\)/);
  assert.match(css, /\.float-txt\.player-event\.dodge\s*\{[\s\S]*?z-index:\s*8/);
});

test('玩家技能取得護盾與所有自身 buff 時會顯示玩家事件浮字', () => {
  assert.match(skills, /function playerBuffFloatClass\(key\)/);
  assert.match(skills, /function showPlayerBuffFloat\(floatSel,\s*buff,\s*lv,\s*mult\)/); // 5 轉昇華天賦倍率同步顯示
  assert.match(skills, /playerBuffFloatClass\(statusRefKey\(buff\)\)/);
  assert.match(skills, /floatPlayerEvent\(floatSel,\s*'🛡️\+' \+ fmt\(gainedShield\)/);
  // 2026-07-30 技能融合改造：buff 施加改走 skillFxBuffList 迴圈（支援融合技不限數量的 buffList）
  assert.match(skills, /skillFxBuffList\(fx\)\.forEach\(function \(bf\) \{/);
  assert.match(skills, /showPlayerBuffFloat\(floatSel,\s*ref,\s*lv,\s*fxMult\)/);
  assert.match(skills, /floatPlayerEvent\(floatSel,\s*'✨淨化',\s*'special'\)/);
  assert.match(skills, /floatPlayerEvent\(floatSel,\s*statusRefName\(ref\) \+ ' ' \+ refDur \+ '秒',\s*'heal'\)/);
  assert.match(skills, /floatPlayerEvent\(floatSel,\s*'法力 \+' \+ fmt\(mpGain\),\s*'mana',\s*mpGain\)/);
});

test('玩家事件浮字依效果類型使用不同顏色', () => {
  assert.match(css, /\.float-txt\.player-event\.shield,[\s\S]*?\.float-txt\.player-event\.mana\s*\{[\s\S]*?color:\s*#7dd3fc/);
  assert.match(css, /\.float-txt\.player-event\.attack\s*\{[\s\S]*?color:\s*#fb923c/);
  assert.match(css, /\.float-txt\.player-event\.special\s*\{[\s\S]*?color:\s*#facc15/);
  assert.match(css, /\.float-txt\.player-event\.defense,[\s\S]*?\.float-txt\.player-event\.heal\s*\{[\s\S]*?color:\s*#4ade80/);
  assert.match(css, /\.float-txt\.player-event\.debuff\s*\{[\s\S]*?color:\s*#ef4444/);
});

test('我方飄字依承傷／增益分成紅區與藍區，技能名稱從中心向左右隨機滑出', () => {
  const renderer = fs.readFileSync(path.join(root, 'js', 'battle-renderer.js'), 'utf8');
  const potential = fs.readFileSync(path.join(root, 'js', 'potential.js'), 'utf8');
  assert.match(util, /function floatPlayerSkillCast\(floatSel, skill, totalDamage\)/);
  assert.match(util, /skill-cast-' \+ direction/);
  assert.match(ui, /function playerFloatStyleClass\(elId, text, cls\)/);
  assert.match(ui, /return isDamage \? 'player-damage' : 'player-benefit'/);
  assert.match(ui, /if \(isPlayerDamage\) placePlayerDamageFloat\(sp, layer\)/);
  assert.match(ui, /else if \(isPlayerBenefit\) placePlayerBenefitFloat\(sp, layer\)/);
  assert.match(css, /\.float-txt\.player-damage\s*\{[\s\S]*?color:\s*#ef4444/);
  assert.match(css, /\.float-txt\.player-benefit\s*\{[\s\S]*?top:\s*6%/);
  assert.match(css, /\.float-txt\.player-event\.skill-cast\s*\{[\s\S]*?color:\s*#ffd43b/);
  assert.match(css, /skill-cast-left\s*\{[\s\S]*?left:\s*calc\(50% - 120px\)/);
  assert.match(css, /skill-cast-right\s*\{[\s\S]*?left:\s*calc\(50% \+ 120px\)/);
  assert.match(css, /@keyframes\s+skillCastFloatLeft\s*\{[\s\S]*?translate\(calc\(-50% - 16px\)/);
  assert.match(css, /@keyframes\s+skillCastFloatRight\s*\{[\s\S]*?translate\(calc\(-50% \+ 16px\)/);
  assert.match(skills, /floatPlayerSkillCast\(floatSel, sk, out\.dmg\)/);
  assert.match(potential, /floatPlayerSkillCast\(floatSel, def, res && res\.dmg\)/);
  assert.match(renderer, /cls\.indexOf\('skill-cast'\) >= 0/);
  assert.match(renderer, /PLAYER_SKILL_FLOAT_SIDE_OFFSET = 120/);
  assert.match(renderer, /x: S\.player\.root\.x \+ castOffset/);
  assert.match(renderer, /drift: castLeft \? -PLAYER_SKILL_FLOAT_DRIFT : \(castRight \? PLAYER_SKILL_FLOAT_DRIFT : 0\)/);
});

test('skill cast summary formats total damage and keeps the doubled lifetime contract', () => {
  const renderer = fs.readFileSync(path.join(root, 'js', 'battle-renderer.js'), 'utf8');
  const calls = [];
  const context = {
    floatText: (...args) => calls.push(args)
  };
  vm.runInNewContext(util, context);

  context.floatPlayerSkillCast('pv-float', { emoji: '🗡️', name: 'Pierce' }, 12345);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'pv-float');
  assert.equal(calls[0][1], '🗡️Pierce 12.3K');
  assert.match(calls[0][2], /player-event skill-cast skill-cast-total skill-cast-(left|right)/);
  assert.equal(calls[0][3], 12345);

  calls.length = 0;
  context.floatPlayerSkillCast('pv-float', { emoji: '✨', name: 'Buff' }, 0);
  assert.equal(calls[0][1], '✨Buff');
  assert.equal(calls[0][3], undefined);

  assert.match(ui, /var SKILL_CAST_FLOAT_LIFETIME_MS = 1050/);
  assert.match(ui, /var SKILL_CAST_TOTAL_FLOAT_LIFETIME_MS = SKILL_CAST_FLOAT_LIFETIME_MS \* 2/);
  assert.match(ui, /if \(isSkillCastTotalFloat\)\s*\{[\s\S]*?scheduleFloatTextRemoval\(sp, SKILL_CAST_TOTAL_FLOAT_LIFETIME_MS\)/);
  assert.match(css, /\.float-txt\.player-event\.skill-cast-total\s*\{[\s\S]*?animation-duration:\s*2\.1s/);
  assert.match(renderer, /PLAYER_SKILL_TOTAL_FLOAT_LIFE_SEC = PLAYER_SKILL_FLOAT_LIFE_SEC \* 2/);
  assert.match(renderer, /PLAYER_SKILL_TOTAL_FLOAT_LIFE_SEC : PLAYER_SKILL_FLOAT_LIFE_SEC/);
  assert.match(renderer, /var MAX_FLOATS = 60;[\s\S]*?技能名稱.*傷害不計入/);
  assert.match(renderer, /function isSkillCastFloatEvent\(ev\)/);
  assert.match(renderer, /if \(!skillCastEvent\) \{[\s\S]*?ordinaryFloatCount[\s\S]*?if \(!S\.floats\[oi\]\.skillCast\)/);
  assert.match(renderer, /skillCast: skillCast/);
  assert.match(renderer, /pendingFloats: \[\]/);
  assert.match(renderer, /if \(!S\.ready\)[\s\S]*?queueFloatUntilReady\(ev\)/);
  assert.match(renderer, /S\.ready = true;\s*flushPendingFloats\(\);/);
  assert.match(skills2, /if \(out\._pendingProjectiles > 0\)[\s\S]*?out\._skillFloatPending/);
  assert.match(skills2, /sgFinishSkillCastFloat\(projectile\.out\)/);
  assert.ok(skills.indexOf('floatPlayerSkillCast(floatSel, sk, out.dmg)') > skills.indexOf('out.dmg = totalDmg;'));
});
