/* 新版技能第二批（2026-08-14，js/skills2.js）：反擊（counter，被動）＋嗜血狂怒（bloodrage，爆發）
   守住六件事：
     1. 主動型被動：可裝載但永不施放；未裝配技能列時效果完全不生效
     2. 反擊觸發：受傷機率反擊（T1）、格擋必反（T2）、強化反擊累加（T3）、傷害走普攻組態×pct%
     3. 反擊衍生：反擊盾（T4）、破甲疊層與重置（T5）、二次反擊（T6）、狂化反殺（T7）
     4. 嗜血狂怒：施放進入狂怒（RT＋sgBloodrage 增益）、攻速/爆傷/總傷/反震/連擊各因子
     5. 擊殺效果：狂化連殺疊連擊、狂血盛宴延長持續
     6. 血飲術反噬：敵人受傷→自身扣血（穿護盾、GM 鎖血鎖 1、超出範圍不觸發）
   傷害管線以替身固定（測機制不測公式，公式由既有測試守）。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext() {
  const logs = [];
  const context = {
    console,
    Math: Object.create(Math),
    setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    UI: { dirty: {} },
    blog(message) { logs.push(message); },
    floatText() {}, trackDps() {}, recordRunDamage() {},
    logs
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js', 'js/skills.js', 'js/skills2.js']
    .forEach((file) => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file }));
  context.G = { player: { gold: 0, skills2: { levels: {} }, loadout: [] }, stage: { current: 1 } };
  // 測試用固定屬性（getStats 為全域函式，直接覆蓋）
  context.getStats = () => ({
    atk: 1000, matk: 0, hp: 1000, mp: 100, level: 10, aspd: 2, cdr: 0,
    critRate: 0, critDmg: 150, hit: 100, tenacity: 0,
    passives: {}, elemAtk: null, elemDmgPct: 0, elemDmgUp: 0,
    eliteDmg: 0, bossDmg: 0, normalDmg: 0, totalDmgPct: 0, dmgVsElem: null,
    aoeDmg: 0, globalDmgRed: 0
  });
  return context;
}

function enemy(hp, x, y, name) {
  return {
    name: name || '測試怪', maxHp: hp, hp, def: 0, mdef: 0, level: 1,
    effects: {}, buffs: {}, dots: [], resist: {}, ctrlRes: 0,
    pos: (x === undefined) ? undefined : { x, y }
  };
}
function playerEnt() {
  return { hp: 1000, mp: 100, shield: 0, shieldMax: 0, skillCds: {}, buffs: {}, dots: [], effects: {}, _lockTarget: null };
}
/* 傷害管線替身：固定 100 傷並記錄 (defender, aCfg)——反擊的傷害倍率驗證吃 aCfg.atk。 */
function stubHits(c, opts) {
  const calls = [];
  c.resolveHit = function (attacker, defender, aCfg) {
    calls.push({ defender, aCfg });
    const dmg = (opts && opts.dmg) || 100;
    defender.hp = Math.max(0, defender.hp - dmg);
    return { dmg, crit: !!(opts && opts.crit), miss: false, blocked: false, killed: defender.hp <= 0 };
  };
  c.applySkillFinalDamageMultiplier = function () {};
  return calls;
}
/* 敵攻玩家結算結果的最小替身（skills2OnPlayerDamaged 只讀 miss/invuln/absorbed）。 */
function hitRes(extra) { return Object.assign({ miss: false, invuln: false, absorbed: 0 }, extra || {}); }

/* ---- 1) 主動型被動 ---- */

test('counter 為主動型被動：可裝載、永不施放，且未裝配時效果不生效', () => {
  const c = loadContext();
  assert.ok(c.skills2IsPassive('counter'));
  assert.ok(!c.skills2IsPassive('bloodrage'));
  const calls = stubHits(c);
  const p = playerEnt();
  const m = enemy(1e9, 40, 0);
  c.GT = 0;
  c.G.player.skills2.levels.counter = [10, 10, 10, 10, 10, 10, 10];
  c.chance = () => true;

  // 未裝配：效果完全不生效
  assert.ok(!c.skills2PassiveActive('counter'), '未裝配時不生效');
  c.skills2OnPlayerDamaged(m, p, 50, true, hitRes(), 'pv-float');
  assert.equal(calls.length, 0, '未裝配時受擊不得反擊');
  assert.equal(p.shield, 0, '未裝配時不得給反擊盾');
  assert.equal(c.buffVal(m, 'sgDefBrk'), 0, '未裝配時不得破甲');

  // 裝載：走與主動技能相同的裝載規則
  assert.equal(c.equipSkillToLoadout('sg:counter'), null, '主動型被動應可裝載');
  assert.deepEqual(JSON.parse(JSON.stringify(c.G.player.loadout)), ['sg:counter']);
  assert.ok(c.skills2PassiveActive('counter'), '裝配後即生效');
  c.skills2OnPlayerDamaged(m, p, 50, true, hitRes(), 'pv-float');
  assert.ok(calls.length > 0, '裝配後受擊應反擊');

  // 但永遠不會被主動施放（也不佔用出手節奏）
  assert.equal(c.castSkill2(p, [m], 'counter', 'mv-float'), null, '主動型被動不可施放');
  assert.equal(p.mp, 100, '施放嘗試不得扣魔');
  assert.equal(p.skillCds['sg:counter'], undefined, '不得寫入冷卻');
  const picked = c.pickAndCastSkill(p, [m], 'mv-float');
  assert.ok(!picked || picked.skillId !== 'counter', '自動施放不得選中主動型被動');

  // 卸下後立即失效
  c.unequipSkillFromLoadout('sg:counter');
  assert.ok(!c.skills2PassiveActive('counter'), '卸下後應失效');
  const before = calls.length;
  c.skills2OnPlayerDamaged(m, p, 50, true, hitRes(), 'pv-float');
  assert.equal(calls.length, before, '卸下後受擊不得反擊');
});

/* ---- 2) 反擊觸發 ---- */

test('反擊 T1：受傷且機率命中時對攻擊者反擊一次，傷害＝普攻×(50%+強化)', () => {
  const c = loadContext();
  const calls = stubHits(c);
  c.GT = 0;
  c.G.player.skills2.levels.counter = [1, 0, 0, 0, 0, 0, 0];
  c.G.player.loadout = ['sg:counter']; // 主動型被動：裝配技能列才生效
  c.chance = (p) => p === 35; // 只讓 T1（35%）擲骰成功
  const p = playerEnt();
  const m = enemy(1e9, 40, 0);
  c.skills2OnPlayerDamaged(m, p, 50, false, hitRes(), 'pv-float');
  assert.equal(calls.length, 1, '應反擊 1 次');
  assert.equal(calls[0].defender, m, '反擊目標是攻擊者');
  // Lv.1：50% 普攻傷害 → aCfg.atk = 1000 × 50%
  assert.equal(calls[0].aCfg.atk, 500);

  // 強化反擊（T3）累加：50 + (30 + 5×9) = 125%
  c.G.player.skills2.levels.counter = [10, 1, 10, 0, 0, 0, 0];
  c.G.player.loadout = ['sg:counter']; // 主動型被動：裝配技能列才生效
  c.skills2OnPlayerDamaged(m, p, 50, false, hitRes(), 'pv-float');
  // T1 Lv.10＝50+5×9＝95，＋T3 Lv.10＝30+5×9＝75 → 170%
  assert.equal(calls[1].aCfg.atk, 1700);
});

test('反擊 T1：機率未命中或未受傷（閃避/無敵）不反擊', () => {
  const c = loadContext();
  const calls = stubHits(c);
  c.GT = 0;
  c.G.player.skills2.levels.counter = [1, 0, 0, 0, 0, 0, 0];
  c.G.player.loadout = ['sg:counter']; // 主動型被動：裝配技能列才生效
  const p = playerEnt();
  const m = enemy(1e9, 40, 0);
  c.chance = () => false;
  c.skills2OnPlayerDamaged(m, p, 50, false, hitRes(), 'pv-float');
  assert.equal(calls.length, 0, '機率未命中不反擊');
  c.chance = () => true;
  c.skills2OnPlayerDamaged(m, p, 0, false, hitRes({ miss: true }), 'pv-float');
  assert.equal(calls.length, 0, '閃避（miss）不反擊');
  c.skills2OnPlayerDamaged(m, p, 0, false, hitRes({ invuln: true }), 'pv-float');
  assert.equal(calls.length, 0, '無敵免疫不反擊');
  c.skills2OnPlayerDamaged(m, p, 0, false, hitRes(), 'pv-float');
  assert.equal(calls.length, 0, '零傷害（未受傷）不觸發 T1');
  c.skills2OnPlayerDamaged(m, p, 0, false, hitRes({ absorbed: 40 }), 'pv-float');
  assert.equal(calls.length, 1, '護盾全吸收仍算受傷，應反擊');
});

test('反擊 T2 招架：格擋必反，傷害＝格擋減傷值×300%（與 T1 各自結算）', () => {
  const c = loadContext();
  const calls = stubHits(c);
  c.GT = 0;
  c.G.player.skills2.levels.counter = [1, 1, 0, 0, 0, 0, 0];
  c.G.player.loadout = ['sg:counter']; // 主動型被動：裝配技能列才生效
  c.chance = () => false; // T1 不觸發 → 只剩招架
  const p = playerEnt();
  const m = enemy(1e9, 40, 0);
  c.skills2OnPlayerDamaged(m, p, 30, true, hitRes(), 'pv-float');
  assert.equal(calls.length, 1, '格擋必反 1 次');
  // 招架 Lv.1：格擋總減傷（基礎值，st.blockDmgRed 未給）× 300%
  const expectPct = c.blockDmgReduction(0) * 300 / 100;
  assert.ok(Math.abs(calls[0].aCfg.atk - 1000 * expectPct / 100) < 1e-9, '招架傷害應為格擋減傷×倍率');
  // T1 同時擲中 → 兩個反擊各自結算
  c.chance = () => true;
  c.skills2OnPlayerDamaged(m, p, 30, true, hitRes(), 'pv-float');
  assert.equal(calls.length - 1, 2, '受傷反擊＋招架同時成立時各打一次');
});

/* ---- 3) 反擊衍生 ---- */

test('反擊盾 T4：觸發反擊時回復最大生命比例的護盾（每次事件一次）', () => {
  const c = loadContext();
  stubHits(c);
  c.GT = 0;
  c.G.player.skills2.levels.counter = [1, 1, 1, 1, 0, 0, 0];
  c.G.player.loadout = ['sg:counter']; // 主動型被動：裝配技能列才生效
  c.chance = (p) => p === 35;
  const p = playerEnt();
  const m = enemy(1e9, 40, 0);
  c.skills2OnPlayerDamaged(m, p, 50, false, hitRes(), 'pv-float');
  // Lv.1＝最大生命 1% → 10（護盾效率未給＝0）
  assert.equal(p.shield, 10);
});

test('破甲擊 T5：格擋機率上破甲，疊層×單層值、上限 4 層、疊層重置時間', () => {
  const c = loadContext();
  stubHits(c);
  c.GT = 0;
  c.G.player.skills2.levels.counter = [1, 1, 1, 1, 1, 0, 0];
  c.G.player.loadout = ['sg:counter']; // 主動型被動：裝配技能列才生效
  c.chance = (p) => p === 35; // T5 破甲機率 35 → 成功；T1 也是 35 會反擊（無妨）
  const p = playerEnt();
  const m = enemy(1e9, 40, 0);
  m.def = 100;
  c.skills2OnPlayerDamaged(m, p, 30, true, hitRes(), 'pv-float');
  assert.equal(c.buffVal(m, 'sgDefBrk'), 25, '第 1 層＝25%');
  c.GT = 1;
  c.skills2OnPlayerDamaged(m, p, 30, true, hitRes(), 'pv-float');
  assert.equal(c.buffVal(m, 'sgDefBrk'), 50, '疊到第 2 層＝50%');
  assert.ok(m.buffs.sgDefBrk.until > 1 + 3.9, '疊層時重置時間');
  c.skills2OnPlayerDamaged(m, p, 30, true, hitRes(), 'pv-float');
  c.skills2OnPlayerDamaged(m, p, 30, true, hitRes(), 'pv-float');
  c.skills2OnPlayerDamaged(m, p, 30, true, hitRes(), 'pv-float');
  assert.equal(c.buffVal(m, 'sgDefBrk'), 100, '上限 4 層＝100%');
  assert.equal(c.monsterDefCfg(m).def, 0, '4 層破甲＝防禦剝光（下限 0 不為負）');
});

test('二次反擊 T6：機率追加 2 次同傷害反擊（不再判定）', () => {
  const c = loadContext();
  const calls = stubHits(c);
  c.GT = 0;
  c.G.player.skills2.levels.counter = [1, 1, 1, 1, 1, 1, 0];
  c.G.player.loadout = ['sg:counter']; // 主動型被動：裝配技能列才生效
  // T1（35）與 T6（50+5×0=50）都擲中；T5 破甲（35）也會中，無妨
  c.chance = (p) => p === 35 || p === 50;
  const p = playerEnt();
  const m = enemy(1e9, 40, 0);
  c.skills2OnPlayerDamaged(m, p, 50, false, hitRes(), 'pv-float');
  assert.equal(calls.length, 3, '1 次本體＋追加 2 次');
  assert.ok(calls.every((x) => x.defender === m), '追加反擊仍打攻擊者');
});

test('狂化反殺 T7：每次反擊額外反擊範圍內隨機 2 個其他敵人', () => {
  const c = loadContext();
  const calls = stubHits(c);
  c.GT = 0;
  c.G.player.skills2.levels.counter = [1, 1, 1, 1, 1, 1, 1];
  c.G.player.loadout = ['sg:counter']; // 主動型被動：裝配技能列才生效
  c.chance = (p) => p === 35; // T1 觸發；T6（50+5×0…Lv1=50）不觸發
  const p = playerEnt();
  const m = enemy(1e9, 40, 0);
  const m2 = enemy(1e9, 60, 30, '反殺目標A');
  const m3 = enemy(1e9, 60, -30, '反殺目標B');
  c.FIELD = { player: p, dpsWindow: [] };
  c.combatFieldEnemies = () => [m, m2, m3];
  c.skills2OnPlayerDamaged(m, p, 50, false, hitRes(), 'pv-float');
  assert.equal(calls.length, 3, '本體 1 次＋反殺 2 個目標');
  const sprayed = calls.slice(1).map((x) => x.defender);
  assert.ok(sprayed.indexOf(m2) >= 0 && sprayed.indexOf(m3) >= 0, '反殺打向攻擊者以外的敵人');
  // 反殺傷害＝100%＋強化反擊（T3 Lv.1＝30）→ 130%
  assert.equal(calls[1].aCfg.atk, 1300);
});

/* ---- 4) 嗜血狂怒 ---- */

test('嗜血狂怒：施放進入狂怒（RT＋增益＋冷卻＋扣魔），各項因子期間生效、到期歸位', () => {
  const c = loadContext();
  stubHits(c);
  c.GT = 0;
  c.G.player.skills2.levels.bloodrage = [10, 10, 10, 10, 10, 10, 10];
  const p = playerEnt();
  const m = enemy(1e9, 40, 0);
  const res = c.castSkill2(p, [m], 'bloodrage', 'mv-float');
  assert.ok(res, '應可施放');
  assert.equal(p.mp, 100 - 50, '扣魔 50');
  assert.ok(p.skillCds['sg:bloodrage'] > 0, '寫入冷卻');
  assert.ok(c.skill2RageActive(), '進入狂怒');
  // Lv.10 攻速 20+2×9＝38% → 乘算因子 1.38
  assert.ok(Math.abs(c.skill2AspdFactor(p) - 1.38) < 1e-9, '攻速乘算（sgBloodrage 增益）');
  // 爆傷（T2）與反震（T5）：各 1.38 倍
  assert.ok(Math.abs(c.skill2RageCritDmgFactor() - 1.38) < 1e-9);
  assert.ok(Math.abs(c.skill2RageThornsFactor() - 1.38) < 1e-9);
  // 總傷（T3 38%）×血飲（T6 30+3×9＝57%）；滿血無盛宴加成
  assert.ok(Math.abs(c.skill2RageDamageMultiplier(p) - 1.38 * 1.57) < 1e-9);
  // 狂血盛宴（T7）：失血 50% → 每 1% 加 1+0.1×9＝1.9% → ×(1+95%)
  p.hp = 500;
  assert.ok(Math.abs(c.skill2RageDamageMultiplier(p) - 1.38 * 1.57 * 1.95) < 1e-9);
  // 連擊（T4）：0.5+0.1×9＝1.4
  assert.ok(Math.abs(c.skill2ComboBonus() - 1.4) < 1e-9);
  // 到期：全部歸位
  c.GT = 100;
  c.tickSkill2(0.1, { pEnt: p, getEnemies: () => [m], floatSel: 'mv-float', onDeaths() {} });
  assert.ok(!c.skill2RageActive());
  assert.equal(c.skill2AspdFactor(p), 1);
  assert.equal(c.skill2RageCritDmgFactor(), 1);
  assert.equal(c.skill2RageDamageMultiplier(p), 1);
  assert.equal(c.skill2ComboBonus(), 0);
});

/* ---- 5) 擊殺效果 ---- */

test('狂怒擊殺：狂化連殺疊連擊（+0.1/殺）、狂血盛宴延長持續（+0.5 秒/殺且無上限）', () => {
  const c = loadContext();
  stubHits(c);
  c.GT = 0;
  c.G.player.skills2.levels.bloodrage = [1, 1, 1, 1, 1, 1, 1];
  const p = playerEnt();
  const m = enemy(1e9, 40, 0);
  c.castSkill2(p, [m], 'bloodrage', 'mv-float');
  const until0 = c.SKILL2_RT.rage.until;
  const combo0 = c.skill2ComboBonus();
  c.skills2OnEnemyDeath(enemy(0, 50, 0), []);
  c.skills2OnEnemyDeath(enemy(0, 50, 0), []);
  assert.ok(Math.abs(c.SKILL2_RT.rage.until - (until0 + 1.0)) < 1e-9, '2 殺延長 1 秒');
  assert.ok(Math.abs(c.skill2ComboBonus() - (combo0 + 0.2)) < 1e-9, '2 殺疊 0.2 連擊');
  // 增益剩餘時間跟隨延長（權威在 rt.until）
  assert.ok(p.buffs.sgBloodrage.until >= c.SKILL2_RT.rage.until - 1e-9);
  // 狂怒結束後擊殺不再累積
  c.GT = 100;
  c.tickSkill2(0.1, { pEnt: p, getEnemies: () => [], floatSel: 'mv-float', onDeaths() {} });
  c.skills2OnEnemyDeath(enemy(0, 50, 0), []);
  assert.equal(c.skill2ComboBonus(), 0);
});

test('狂血盛宴：每 1 連擊數讓普攻多攻擊 1 個敵人，目標數不設技能上限', () => {
  const c = loadContext();
  stubHits(c);
  c.GT = 0;
  c.G.player.skills2.levels.bloodrage = [1, 1, 1, 1, 1, 1, 1];
  const primary = enemy(1e9, 40, 0);
  const enemies = [primary, enemy(1e9, 50, 0), enemy(1e9, 60, 0), enemy(1e9, 70, 0)];
  c.castSkill2(playerEnt(), enemies, 'bloodrage', 'mv-float');
  c.getStats = () => ({ comboHits: 3 });
  assert.equal(c.skill2RageBasicAttackTargets(primary, enemies).length, 4, '3 連擊數應同時攻擊 3 個額外敵人');
  c.getStats = () => ({ comboHits: 9999 });
  assert.equal(c.skill2RageBasicAttackTargets(primary, enemies).length, 4, '連擊數無上限，但目標數受存活敵人數量限制');
});

/* ---- 6) 血飲術反噬 ---- */

test('血飲術：狂怒期間敵人受傷→自身扣血（穿護盾）；GM 鎖血鎖 1；超遠敵人不觸發', () => {
  const c = loadContext();
  stubHits(c);
  c.GT = 0;
  c.G.player.skills2.levels.bloodrage = [1, 1, 1, 1, 1, 1, 0];
  const p = playerEnt();
  const m = enemy(1e9, 40, 0);
  c.castSkill2(p, [m], 'bloodrage', 'mv-float');
  p.shield = 500;
  c.skills2OnEnemyDamaged(m, 12345);
  // 自身損失最大生命 1% → 10；護盾不動（直接扣血）
  assert.equal(p.hp, 990);
  assert.equal(p.shield, 500, '不可被護盾吸收');
  // 超出 80 米（80×10px=800）不觸發
  const far = enemy(1e9, 5000, 0);
  c.skills2OnEnemyDamaged(far, 100);
  assert.equal(p.hp, 990, '超遠敵人受傷不反噬');
  // GM 鎖血：最低鎖 1
  c.GM_TEST = { god: true };
  p.hp = 5;
  c.skills2OnEnemyDamaged(m, 100);
  assert.equal(p.hp, 1);
  // 狂怒未啟用（T6 未投資）時不反噬
  const c2 = loadContext();
  stubHits(c2);
  c2.GT = 0;
  c2.G.player.skills2.levels.bloodrage = [1, 0, 0, 0, 0, 0, 0];
  const p2 = playerEnt();
  const m2 = enemy(1e9, 40, 0);
  c2.castSkill2(p2, [m2], 'bloodrage', 'mv-float');
  c2.skills2OnEnemyDamaged(m2, 100);
  assert.equal(p2.hp, 1000, '未投資血飲術不反噬');
});

/* ---- 7) 審查修正（2026-08-14 對抗式審查）---- */

test('致命一擊不觸發反擊（與反震「致命擊不反傷」一致；避免死者反殺領獎）', () => {
  const c = loadContext();
  const calls = stubHits(c);
  c.GT = 0;
  c.G.player.skills2.levels.counter = [10, 10, 10, 10, 10, 10, 10];
  c.G.player.loadout = ['sg:counter']; // 主動型被動：裝配技能列才生效
  c.chance = () => true;
  const p = playerEnt();
  const m = enemy(1e9, 40, 0);
  // 這一擊打死玩家（res.killed）
  c.skills2OnPlayerDamaged(m, p, 1000, true, hitRes({ killed: true }), 'pv-float');
  assert.equal(calls.length, 0, '致命一擊不得反擊');
  // 玩家已經是 0 血（後續同 tick 的其他受擊事件）也不反擊
  p.hp = 0;
  c.skills2OnPlayerDamaged(m, p, 50, true, hitRes(), 'pv-float');
  assert.equal(calls.length, 0, '死亡狀態不得反擊');
  assert.equal(p.shield, 0, '死者不得獲得反擊盾');
});

test('狂化連殺 killCombo 仍依自身參數限額、狂血盛宴延時不設上限', () => {
  const c = loadContext();
  stubHits(c);
  c.GT = 0;
  c.G.player.skills2.levels.bloodrage = [1, 1, 1, 1, 1, 1, 1];
  const p = playerEnt();
  const m = enemy(1e9, 40, 0);
  c.castSkill2(p, [m], 'bloodrage', 'mv-float');
  const t = c.SKILLS2.bloodrage.tiers;
  const killMax = Number(t[3].fx.killMax);
  assert.ok(killMax > 0, '狂化連殺仍應保留自身表定上限');
  assert.equal(t[6].fx.maxSec, undefined, '狂血盛宴不得有延時上限');
  const base = Number(t[0].fx.sec);
  for (let i = 0; i < 2000; i++) c.skills2OnEnemyDeath(enemy(0, 50, 0), []);
  // 連擊加成 = 基準(0.5) + 累積上限
  assert.equal(c.skill2ComboBonus(), Number(t[3].fx.add) + killMax, 'killCombo 應被夾在上限');
  assert.equal(c.SKILL2_RT.rage.until, c.GT + base + 2000 * Number(t[6].fx.sec), '狂血盛宴延時應持續累加');
  assert.ok(c.skill2RageActive(), '夾上限後狂怒仍在持續中');
});

test('狂怒 RT 為權威：resetSkill2RT 撤掉殘留增益，且攻速因子不吃殘留值', () => {
  const c = loadContext();
  stubHits(c);
  c.GT = 0;
  c.G.player.skills2.levels.bloodrage = [10, 0, 0, 0, 0, 0, 0];
  const p = playerEnt();
  const m = enemy(1e9, 40, 0);
  c.castSkill2(p, [m], 'bloodrage', 'mv-float');
  assert.ok(c.skill2AspdFactor(p) > 1, '狂怒中攻速乘算生效');
  // 死亡／讀檔／進出高塔：resetSkillRT → resetSkill2RT
  c.resetSkill2RT();
  assert.equal(p.buffs.sgBloodrage, undefined, '重置時應撤掉跟隨 RT 的增益');
  assert.equal(c.skill2AspdFactor(p), 1, '重置後不得殘留攻速加成');
  // 即使增益被其他路徑留下，RT 沒了就不給值
  c.applyStatus(p, 'sgBloodrage', { val: 38, dur: 99 });
  assert.equal(c.skill2AspdFactor(p), 1, 'RT 才是權威：殘留增益不得生效');
});

test('普攻路徑補上玩家死亡判定（血飲術反噬致死不得被下一 tick 回血抵銷）', () => {
  const combat = fs.readFileSync(path.join(root, 'js/combat.js'), 'utf8');
  const tower = fs.readFileSync(path.join(root, 'js/tower.js'), 'utf8');
  // 野外：普攻結算後、空場提前返回之前必須判死
  assert.match(combat, /doPlayerAttack\(p, primary[\s\S]{0,600}?if \(p\.hp <= 0\) \{ onPlayerFieldDeath\(\); return; \}[\s\S]{0,200}?if \(!combatFieldEnemies\(\)\.length\) return;/);
  // 高塔：普攻結算後判死
  assert.match(tower, /doPlayerAttack\(p, b, 'tb-float'\)[\s\S]{0,400}?if \(p\.hp <= 0\) \{ endTowerFight\(false, 'death'\); return; \}/);
});

test('血飲術通知掛鉤：resolveHit（玩家攻擊端）與 applyEnemyHpDamage 都會回報敵人受傷', () => {
  const c = loadContext();
  c.GT = 0;
  const hits = [];
  c.skills2OnEnemyDamaged = (ent, amount) => hits.push([ent, amount]);
  const p = playerEnt();
  const m = enemy(1e9, 40, 0);
  // 真 resolveHit：玩家攻擊敵人（命中固定：巨量 hit）
  const res = c.resolveHit(p, m, { atk: 1000, dmgType: 'phys', level: 10, critRate: 0, critDmg: 150, hit: 999, isPlayer: true }, c.monsterDefCfg(m));
  assert.ok(!res.miss);
  assert.equal(hits.length, 1, 'resolveHit 主傷害段應通知');
  assert.equal(hits[0][0], m);
  assert.equal(hits[0][1], res.dmg);
  // applyEnemyHpDamage（持續傷害／衍生傷害路徑）
  c.applyEnemyHpDamage(m, 77);
  assert.equal(hits.length, 2);
  assert.equal(hits[1][1], 77);
  // 玩家自身扣血（無 maxHp）不通知——阻斷血飲術遞迴
  c.applyEnemyHpDamage(p, 30);
  assert.equal(hits.length, 2, '玩家實體不觸發敵方受傷通知');
});
