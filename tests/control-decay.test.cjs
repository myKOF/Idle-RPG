const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

/* 控場效果遞減（2026-10-05，取代舊的「依存活秒數」遞減）：
   控場分三類各自獨立計次——act 無法行動、aspd 攻速降低、move 移速降低；
   該類每被控 1 次，之後同類控場持續時間再 −5%（線性，20 次起完全免疫）。
   遞減只作用在獨立記錄的控場效果（ent.ccLock／ent.ccDr），狀態本身（effects／buffs）
   的數值與持續時間不受影響。玩家實體不遞減；BOSS 對攻擊頻率類控場另有完全免疫。 */

function loadCtx() {
  const context = { console, UI: { dirty: {} }, GT: 0, RUN_STATS: { skills: {} }, blog() {}, floatText() {} };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

function foe(extra) {
  return Object.assign({ _spawnAt: 0, elite: false, isBoss: false, hp: 1000, maxHp: 1000, effects: {}, buffs: {}, dots: [], shield: 0 }, extra);
}
const near = (a, b) => Math.abs(a - b) < 1e-9;

test('遞減倍率曲線：每次 5%、線性、20 次歸零、不會變負數；三類各自一個比率', () => {
  const c = loadCtx();
  assert.equal(c.CONTROL_DECAY_PER_HIT_ACT, 5);
  assert.equal(c.CONTROL_DECAY_PER_HIT_ASPD, 5);
  assert.equal(c.CONTROL_DECAY_PER_HIT_MOVE, 5);
  assert.equal(c.CONTROL_DECAY_MERGE_SEC, 0.5);
  assert.equal(c.controlDecayFactor('act', 0), 1);
  assert.ok(near(c.controlDecayFactor('act', 1), 0.95));
  assert.ok(near(c.controlDecayFactor('aspd', 10), 0.5));
  assert.equal(c.controlDecayFactor('move', 20), 0);
  assert.equal(c.controlDecayFactor('move', 99), 0);
  // 比率各自獨立：把攻速類調成 10%，另外兩類不動
  c.CONTROL_DECAY_PER_HIT_ASPD = 10;
  assert.ok(near(c.controlDecayFactor('aspd', 3), 0.7));
  assert.ok(near(c.controlDecayFactor('act', 3), 0.85));
  assert.ok(near(c.controlDecayFactor('move', 3), 0.85));
  c.CONTROL_DECAY_PER_HIT_ACT = 0; // 填 0 ＝該類不遞減
  assert.equal(c.controlDecayFactor('act', 50), 1);
});

test('使用者範例：冰凍 2 秒，下一次剩 1.9 秒；狀態本身一律是完整 2 秒', () => {
  const c = loadCtx();
  const m = foe();
  c.GT = 0;
  assert.equal(c.applyEffect(m, 'stun', 2), 2);
  assert.equal(m.effects.stun, 2);          // 狀態：完整
  assert.ok(near(m.ccLock.act, 2));          // 控場：第 1 次不遞減
  c.GT = 10;
  assert.equal(c.applyEffect(m, 'stun', 2), 2);
  assert.equal(m.effects.stun, 12);          // 狀態仍是完整 2 秒
  assert.ok(near(m.ccLock.act, 10 + 2 * 0.95)); // 控場：1.9 秒
  c.GT = 20;
  c.applyEffect(m, 'stun', 2);
  assert.ok(near(m.ccLock.act, 20 + 2 * 0.9));  // 第 3 次 1.8 秒（線性）
  assert.equal(m.ccDr.act.n, 3);
});

test('完全免疫：20 次之後控場效果歸零，但狀態照常掛上、依賴「暈眩中」的判定照常成立', () => {
  const c = loadCtx();
  const m = foe();
  for (let i = 0; i < 20; i++) { c.GT = i * 10; c.applyEffect(m, 'stun', 2); }
  c.GT = 200;
  assert.equal(c.applyEffect(m, 'stun', 2), 2);   // 回傳仍是狀態秒數，不再是 false
  assert.ok(c.effectActive(m, 'stun'));            // 狀態掛著
  assert.ok(!c.ccLockOn(m, 'act'));                // 控場效果沒有了
  assert.ok(!c.ccActionLocked(m));                 // → 可以行動
  c.GT = 201;
  assert.ok(c.effectActive(m, 'stun') && !c.ccActionLocked(m));
  // 還沒免疫時：狀態與控場同時成立
  const fresh = foe();
  c.GT = 0; c.applyEffect(fresh, 'stun', 2);
  c.GT = 1;
  assert.ok(c.ccActionLocked(fresh));
  c.GT = 2.5; // 控場到期後就不鎖了
  assert.ok(!c.ccActionLocked(fresh));
});

test('無法行動類：合併秒數內的重複施加算同一次（多段命中不連扣）', () => {
  const c = loadCtx();
  const m = foe();
  c.GT = 0; c.applyEffect(m, 'stun', 1);
  c.GT = 0.3; c.applyEffect(m, 'stun', 1);   // 0.3 < 0.5 → 同一次
  assert.equal(m.ccDr.act.n, 1);
  c.GT = 0.6; c.applyEffect(m, 'stun', 1);   // ≥ 0.5 → 新的一次
  assert.equal(m.ccDr.act.n, 2);
  assert.ok(near(m.ccLock.act, 0.6 + 0.95)); // 第 2 次的倍率
});

test('三類各自計次：暈眩不影響攻速／移速的次數，泥沼同時計攻速與移速', () => {
  const c = loadCtx();
  const m = foe();
  c.GT = 0;
  c.applyEffect(m, 'stun', 1);
  assert.deepEqual(Object.keys(m.ccDr), ['act']);
  c.applyBuff(m, 'sgMire', 50, 1);
  assert.equal(m.ccDr.aspd.n, 1);
  assert.equal(m.ccDr.move.n, 1);
  assert.equal(m.ccDr.act.n, 1);
  // 風切只管移速
  const w = foe();
  c.applyBuff(w, 'sgWindSlow', 60, 3);
  assert.deepEqual(Object.keys(w.ccDr), ['move']);
  // 其他類別的比率調整不互相牽動：只把移速類改成 20%
  c.CONTROL_DECAY_PER_HIT_MOVE = 20;
  c.GT = 10; c.applyBuff(m, 'sgMire', 50, 1);  // 上一輪 1 秒已到期 → 新的一次
  assert.ok(near(m.ccLock.move, 10 + 1 * (1 - 1 * 0.2)));
  assert.ok(near(m.ccLock.aspd, 10 + 1 * 0.95));
});

test('攻速降低（applyBuff）：狀態數值與持續時間不變，控場另記並遞減', () => {
  const c = loadCtx();
  const m = foe();
  c.GT = 0;
  assert.equal(c.applyBuff(m, 'aspdDown', 30, 6), 6);
  assert.equal(m.buffs.aspdDown.until, 6);
  assert.equal(m.buffs.aspdDown.val, 30);
  c.GT = 20;
  c.applyBuff(m, 'aspdDown', 30, 6);
  assert.equal(m.buffs.aspdDown.until, 26);      // 狀態：完整 6 秒
  assert.equal(m.buffs.aspdDown.val, 30);        // 數值不變
  assert.ok(near(m.ccLock.aspd, 20 + 6 * 0.95)); // 控場：5.7 秒
  assert.equal(c.applyBuff(m, 'atkDown', 18, 6), 6); // 非控場類狀態：不登記
  assert.equal(m.ccDr.aspd.n, 2);
  const player = { buffs: {}, effects: {} };         // 玩家實體無 _spawnAt → 不遞減、不登記
  assert.equal(c.applyBuff(player, 'aspdUp', 25, 6), 6);
  assert.equal(c.applyEffect(player, 'stun', 2), 2);
  assert.equal(player.ccDr, undefined);
  assert.ok(c.ccLockOn(player, 'act') && c.ccLockOn(player, 'aspd'));
  assert.ok(c.ccActionLocked(player));
});

test('攻速／移速類：同類控場還在生效中不重複計次，場域緩速每 0.5 秒重塗只算進入的那一次', () => {
  const c = loadCtx();
  const m = foe();
  for (let t = 0; t < 10; t += 0.5) { c.GT = t; c.applyBuff(m, 'sgMire', 50, 1); }
  assert.equal(m.ccDr.aspd.n, 1);
  assert.equal(m.ccDr.move.n, 1);
  c.GT = 9.9;
  assert.ok(c.ccLockOn(m, 'aspd') && c.ccLockOn(m, 'move')); // 一路都在作用
  c.GT = 30; c.applyBuff(m, 'sgMire', 50, 1);                // 離開後重新進入：算新的一次
  assert.equal(m.ccDr.aspd.n, 2);
});

test('控場失效時（狀態還在）：攻速倍率與移速倍率回到 1', () => {
  const c = loadCtx();
  c.skill2SlowAspdFactor = () => 0.5;
  c.skill2SlowMoveFactor = () => 0.4;
  const m = foe();
  c.GT = 0; c.applyBuff(m, 'sgMire', 50, 5);
  c.GT = 1;
  assert.equal(c.slowFactor(m), 0.5);
  assert.equal(c.bfEnemySpeedFactor(m), 0.4);
  // 這類已經被控 20 次 → 狀態照樣掛上，但沒有控場效果
  const immune = foe({ ccDr: { aspd: { n: 20, last: -1e9, f: 0 }, move: { n: 20, last: -1e9, f: 0 } }, ccLock: {} });
  c.GT = 0; c.applyBuff(immune, 'sgMire', 50, 5);
  c.GT = 1;
  assert.ok(c.buffVal(immune, 'sgMire') > 0);        // 狀態在
  assert.equal(c.slowFactor(immune), 1);              // 攻速不受影響
  assert.equal(c.bfEnemySpeedFactor(immune), 1);      // 移速不受影響
  // 玩家（未登記）不受影響：照舊讀狀態
  const player = { buffs: {}, effects: {} };
  c.GT = 0; c.applyBuff(player, 'sgMire', 50, 5);
  c.GT = 1;
  assert.equal(c.slowFactor(player), 0.5);
});

test('潛力【時間結界】的攻速降低%：控場失效時不再拉長敵人攻擊間隔', () => {
  const c = loadCtx();
  const m = foe();
  c.GT = 0; c.applyBuff(m, 'enemyAspdDown', 40, 5);
  c.GT = 1;
  assert.equal(c.enemyAspdDownPct(m), 40);
  const immune = foe({ ccDr: { aspd: { n: 20, last: -1e9, f: 0 } }, ccLock: {} });
  c.GT = 0; c.applyBuff(immune, 'enemyAspdDown', 40, 5);
  c.GT = 1;
  assert.equal(c.enemyAspdDownPct(immune), 0);
});

test('強制控場（時空凝滯）：不計次、不遞減；對 BOSS 也能生效', () => {
  const c = loadCtx();
  const boss = foe({ isBoss: true });
  c.GT = 0;
  boss.effects.stun = 5;               // potential.js 直接寫入的狀態時戳
  c.ccForceLock(boss, 'act', 5);
  c.GT = 1;
  assert.ok(c.ccActionLocked(boss));
  assert.equal(boss.ccDr && boss.ccDr.act, undefined); // 沒有計次
  c.GT = 6;
  assert.ok(!c.ccActionLocked(boss));
});

test('BOSS 對攻擊頻率類控制的完全免疫維持不變；非控制效果不受影響', () => {
  const c = loadCtx();
  c.GT = 999;
  const boss = { isBoss: true, effects: {}, buffs: {} };
  assert.equal(c.applyEffect(boss, 'stun', 8), false);
  assert.equal(c.applyEffect(boss, 'slow', 3), false);
  assert.equal(c.applyBuff(boss, 'aspdDown', 30, 3), false);
  assert.equal(boss.effects.stun, undefined);
  const m = foe();
  assert.ok(c.applyEffect(m, 'burn', 5)); // 非控場鍵 → 照常寫入、不登記
  assert.equal(m.effects.burn, 999 + 5);
  assert.equal(m.ccDr, undefined);
});

test('無敵狀態仍免疫暈眩／減速（先於遞減）', () => {
  const c = loadCtx();
  const m = foe();
  c.GT = 0; m.effects.invuln = 5;
  assert.equal(c.applyEffect(m, 'stun', 2), false);
  assert.equal(m.ccDr, undefined);
});

test('冰元素減速 proc：攻速控場遞減歸零時不誤報（狀態照樣掛上）', () => {
  const c = loadCtx();
  c.chance = (p) => p >= 15; // 命中(100)與冰特效(15)成立、暴擊(0)與控制抵抗(0)不成立
  c.rnd = () => 1;
  const aCfg = { atk: 0, dmgType: 'magic', level: 1, hit: 100, critRate: 0, elemAtk: { ice: 100 } };
  const dCfg = { dodge: 0, mdef: 0, mRes: 0, resist: {}, ctrlRes: 0 };
  c.GT = 0;
  const fresh = foe();
  const r1 = c.resolveHit({}, fresh, aCfg, dCfg);
  assert.ok(r1.procs.includes('減速'));
  assert.ok(c.effectActive(fresh, 'slow'));
  const worn = foe({ ccDr: { aspd: { n: 20, last: -1e9, f: 0 } }, ccLock: {} });
  const r2 = c.resolveHit({}, worn, aCfg, dCfg);
  assert.ok(!r2.procs.includes('減速'));
  assert.ok(c.effectActive(worn, 'slow')); // 狀態仍在
});

test('控場分類登記表：只收「讓敵人傷害降低或移動變慢」的效果鍵', () => {
  const c = loadCtx();
  assert.deepEqual(Array.from(c.statusControlCats('stun')), ['act']);
  assert.deepEqual(Array.from(c.statusControlCats('slow')), ['aspd']);
  assert.deepEqual(Array.from(c.statusControlCats('sgMire')), ['aspd', 'move']);
  assert.deepEqual(Array.from(c.statusControlCats('sgWindSlow')), ['move']);
  assert.equal(c.statusControlCats('atkDown'), null);
  assert.equal(c.statusControlCats('sgFrozen'), null); // 凍結只是標記，行動限制由暈眩承擔
  // 登記表裡的每個鍵都真的是狀態表上的效果鍵（打錯字或狀態改名會在這裡被抓到）
  for (const key of Object.keys(c.CC_CATS_BY_KEY)) {
    assert.ok(key === 'aspdDown' || key === 'attackSpeedDown' || c.statusIdByKey(key), '狀態表查無效果鍵：' + key);
  }
});

test('野外敵人生成時標記 _spawnAt（原始碼接線）', () => {
  const combat = fs.readFileSync(path.join(root, 'js', 'combat.js'), 'utf8');
  assert.match(combat, /_spawnAt:\s*GT/);
});

test('敵人出手與攻擊冷卻改走 ccActionLocked（暈眩狀態還在但控場遞減掉時照常出手）', () => {
  const combat = fs.readFileSync(path.join(root, 'js', 'combat.js'), 'utf8');
  const tower = fs.readFileSync(path.join(root, 'js', 'tower.js'), 'utf8');
  assert.match(combat, /ccActionLocked\(m\)\) return false/);
  assert.match(combat, /if \(!ccActionLocked\(m\)\) \{\s*m\.atkCd -= dt \* slowFactor\(m\)/);
  assert.match(tower, /if \(!ccActionLocked\(b\)\)/);
  assert.doesNotMatch(combat, /effectActive\(m, 'stun'\)/);
  assert.doesNotMatch(tower, /effectActive\(b, 'stun'\)/);
});

test('控場遞減參數已入參數表（game_parameters「3-戰鬥核心／控場遞減」a~d）並接上 apply_params 錨點', () => {
  const csv = fs.readFileSync(path.join(root, 'config', 'CSV', 'game_parameters.csv'), 'utf8');
  const line = csv.split(/\r?\n/).find((l) => l.indexOf(',3-戰鬥核心,控場遞減,') >= 0);
  assert.ok(line, '參數表缺「控場遞減」列');
  assert.match(line, /,5,5,5,0\.5,0,0,0,0,0,0,0,0$/);
  const ap = fs.readFileSync(path.join(root, 'tools', 'apply_params.cjs'), 'utf8');
  ['ACT', 'ASPD', 'MOVE'].forEach((k, i) => {
    assert.match(ap, new RegExp("'CONTROL_DECAY_PER_HIT_" + k + "', '3-戰鬥核心', '控場遞減', " + i + '\\)'));
  });
  assert.match(ap, /'CONTROL_DECAY_MERGE_SEC', '3-戰鬥核心', '控場遞減', 3\)/);
  assert.doesNotMatch(ap, /CONTROL_DECAY_PER_SEC/);
});
