/* 傷害數字的時序：模擬層一瞬間結算完整段傷害，但畫面上子彈要飛、多段要一段一段打。
   這支測試釘的是「數字什麼時候跳出來」，不是傷害算得對不對。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext() {
  const context = {
    console, Math: Object.create(Math), UI: { dirty: {} }, GT: 0,
    RUN_STATS: { skills: {} },
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    blog() {}, trackDps() {}, recordRunDamage() {}
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js', 'js/skills.js']
    .forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), context, { filename: f }));
  context.G = {
    player: { level: 1, skills: {}, loadout: [], fusions: [], talents: { levels: {}, potentialLevels: {} } },
    stage: { current: 1 }, tower: { active: false }
  };
  context.getStats = () => ({
    cdr: 0, castSpeed: 0, hp: 1000, mp: 1000, atk: 100, matk: 100,
    aoeDmg: 0, critRate: 0, critDmg: 150, pPen: 0, mPen: 0, hit: 999, level: 1,
    passives: {}, lifesteal: 0, manaSteal: 0, shieldEff: 0, skillTriggers: {}
  });
  return context;
}

function enemy(col, row) {
  return {
    hp: 1e9, maxHp: 1e9, def: 0, mdef: 0, dodge: 0, resist: {}, ctrlRes: 0,
    elite: false, isBoss: false, buffs: {}, dots: [], effects: {}, shield: 0,
    cell: { col, row, w: 1, h: 1 }
  };
}

// 收集每一則浮字的延遲；floatText 的第 7 個參數是 delayMs
function captureFloats(context) {
  const floats = [];
  context.floatText = (elId, text, cls, damageValue, ent, snap, delayMs) => {
    floats.push({ text, cls, delayMs: delayMs || 0 });
  };
  return floats;
}

test('投射物是等速飛行：距離越遠飛越久，不是固定時間', () => {
  const c = loadContext();
  const near = enemy(1, 2);   // 第 1 行、中央列 → 最近
  const mid = enemy(2, 2);
  const far = enemy(4, 1);    // 第 4 行、外側列 → 最遠
  const tNear = c.bfTravelSeconds(near);
  const tMid = c.bfTravelSeconds(mid);
  const tFar = c.bfTravelSeconds(far);
  assert.ok(tNear < tMid && tMid < tFar, '越遠應該飛越久：' + [tNear, tMid, tFar].join(' / '));
  // 時間確實是「距離 ÷ 速度」，而不是隨便給的級距
  assert.ok(Math.abs(tFar / tNear - c.bfTravelDistance(far) / c.bfTravelDistance(near)) < 1e-6,
    '飛行時間應與距離成正比');
  // 夾在上下限內
  assert.ok(tNear >= c.VFX_TRAVEL_MIN_SEC && tFar <= c.VFX_TRAVEL_MAX_SEC);
});

test('打遠處的敵人，傷害數字比打近處的晚跳出來', () => {
  function delayOf(cell) {
    const c = loadContext();
    const floats = captureFloats(c);
    const player = { hp: 1000, mp: 1000, atkCd: 0, skillCds: {}, skillGcd: 0, buffs: {}, dots: [], effects: {} };
    c.castSkill(player, [enemy(cell.col, cell.row)], 'fireball', 1, 'mv-float');
    return floats.filter((f) => /enemy-skill/.test(f.cls))[0].delayMs;
  }
  const near = delayOf({ col: 1, row: 2 });   // 第 1 行、中央列
  const far = delayOf({ col: 4, row: 1 });    // 第 4 行、外側列
  assert.ok(far > near, '打遠的敵人數字應該較晚：近 ' + near + 'ms／遠 ' + far + 'ms');
  // 不是固定值——v11 的做法是不管遠近都 500ms，那正是使用者回報「不順」的原因
  assert.notEqual(near, far);
});

test('投射物的動畫長度與傷害數字用同一組飛行時間（不會走鐘）', () => {
  const c = loadContext();
  const player = { hp: 1000, mp: 1000, atkCd: 0, skillCds: {}, skillGcd: 0, buffs: {}, dots: [], effects: {} };
  let spec = null;
  c.playCombatVfx = (s) => { spec = s; };
  captureFloats(c);
  const target = enemy(4, 1);
  c.castSkill(player, [target], 'fireball', 1, 'mv-float');
  assert.ok(spec && spec.travelMs && spec.travelMs.length === 1, 'vfx 事件應帶每個目標的飛行時間');
  assert.equal(spec.travelMs[0], Math.round(c.bfTravelSeconds(target) * 1000));
  // 顯示端拿同一個數字當動畫長度
  const vfx = fs.readFileSync(path.join(root, 'js/vfx.js'), 'utf8');
  assert.match(vfx, /vfxProjectile\(s, layer, from, pt, delay, travelMs \? travelMs\[t\] : 0\)/);
  assert.match(vfx, /d\.style\.animationDuration = flight \+ 'ms'/);
  /* shim 是逐欄挑選後才送出事件的，漏掉 travelMs 的話畫面會退回預設飛行時間，
     變成「數字到了子彈還在飛」——實機驗證時就是這樣抓到的。 */
  const shim = fs.readFileSync(path.join(root, 'js/worker/shim.js'), 'utf8');
  assert.match(shim, /travelMs:\s*spec\.travelMs \|\| null/);
});

test('投射物技能：傷害數字延後到子彈飛到才跳出', () => {
  const c = loadContext();
  const floats = captureFloats(c);
  const player = { hp: 1000, mp: 1000, atkCd: 0, skillCds: {}, skillGcd: 0, buffs: {}, dots: [], effects: {} };
  // 火球術：魔法系單體 → 投射物
  const sk = c.SKILLS.fireball;
  assert.ok(sk, '火球術應存在');
  assert.equal(c.skillVfxKind(sk, c.effectiveFx('fireball', sk, 1), sk.shape), 'projectile');

  c.castSkill(player, [enemy(1, 2)], 'fireball', 1, 'mv-float');
  const dmg = floats.filter((f) => /enemy-skill/.test(f.cls));
  assert.ok(dmg.length >= 1, '應該有傷害浮字');
  assert.ok(dmg[0].delayMs > 0, '投射物的傷害數字不能在發射當下就跳出來');
});

test('近戰技能：當場命中，數字不延後', () => {
  const c = loadContext();
  const floats = captureFloats(c);
  const player = { hp: 1000, mp: 1000, atkCd: 0, skillCds: {}, skillGcd: 0, buffs: {}, dots: [], effects: {} };
  // 強力斬：物理系單體 → 斬擊（沒有飛行時間）
  const sk = c.SKILLS.powerSlash;
  assert.equal(c.skillVfxKind(sk, c.effectiveFx('powerSlash', sk, 1), sk.shape), 'slash');

  c.castSkill(player, [enemy(1, 2)], 'powerSlash', 1, 'mv-float');
  const dmg = floats.filter((f) => /enemy-skill/.test(f.cls));
  assert.equal(dmg[0].delayMs, 0, '斬擊是當場發生，不該延後');
});

test('多段技：每一段各自一個傷害數字，且逐段錯開', () => {
  const c = loadContext();
  const floats = captureFloats(c);
  const player = { hp: 1000, mp: 1000, atkCd: 0, skillCds: {}, skillGcd: 0, buffs: {}, dots: [], effects: {} };
  // 奧術彈幕：2026-07-30 改制後里程碑全附加，Lv.1 即為 M8 的 6 段
  const fx = c.effectiveFx('arcaneBarrage', c.SKILLS.arcaneBarrage, 1);
  assert.equal(fx.hits, 6);

  c.castSkill(player, [enemy(1, 2)], 'arcaneBarrage', 1, 'mv-float');
  const dmg = floats.filter((f) => /enemy-skill/.test(f.cls));
  assert.equal(dmg.length, 6, '6 段應該有 6 個獨立的傷害數字，不是一個總和');

  // 逐段遞增錯開，間隔等於 VFX_HIT_STAGGER_SEC
  const step = Math.round(c.VFX_HIT_STAGGER_SEC * 1000);
  for (let i = 1; i < dmg.length; i++) {
    assert.equal(dmg[i].delayMs - dmg[i - 1].delayMs, step,
      '第 ' + (i + 1) + ' 段應比前一段晚 ' + step + 'ms');
  }
});

test('延遲只是顯示時序，不影響傷害結算', () => {
  const c = loadContext();
  captureFloats(c);
  const player = { hp: 1000, mp: 1000, atkCd: 0, skillCds: {}, skillGcd: 0, buffs: {}, dots: [], effects: {} };
  const target = enemy(1, 2);
  const before = target.hp;
  const out = c.castSkill(player, [target], 'arcaneBarrage', 1, 'mv-float');
  // 呼叫回來的當下血量就已經扣完了——延遲的是數字，不是傷害
  assert.ok(target.hp < before, '傷害必須在同一次呼叫內結算完畢');
  assert.ok(out.dmg > 0);
  assert.equal(Math.round(before - target.hp), Math.round(out.dmg));
});

test('浮字延遲會原樣送到顯示端（協議 v11 的 delayMs）', () => {
  const shim = fs.readFileSync(path.join(root, 'js/worker/shim.js'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  assert.match(shim, /delayMs:\s*\(delayMs > 0\) \? delayMs : 0/);
  assert.match(ui, /floatText\(event\.elId, event\.text, event\.cls, event\.damageValue, null, uiBattlePanelSnapshot\(\), event\.delayMs\)/);
  // 顯示端收到延遲就排程重播，不是丟掉
  assert.match(ui, /if \(delayMs > 0\) \{[\s\S]*?setTimeout\([\s\S]*?floatText\(elId, text, cls, damageValue, ent, battleSnapshot, 0\)/);
});
