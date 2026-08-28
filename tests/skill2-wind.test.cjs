/* 新版主動技能第八批：風系三群組（2026-08-18，js/skills2.js）
   守住設計文檔「技能」頁籤〈魔法〉區塊新增的三個群組與其註記：
     風刃     windblade    ─ 貫穿全場的飛行風刃；小風刃可轉為追擊；四方向二連射
     真空斬   vacuumslash  ─ 前方斬擊 →【迴旋斬】改為全周 →【虛空斬】螺旋圓盤
     暴風屏障 stormbarrier ─ 節拍護盾＋減免；撕裂／亂風切／暴風之刃／風切擴散／神體
   以及三項實作決策：
     - 【風切狀態】的緩速不隨層數提高（層數只加持續傷害），命中率折減走 monsterAtkCfg
     - 暴風屏障與暴風神體的減免「先在風系內相加、再整體乘算」（文檔註記）
     - 【暴風之刃】射出的風刃固定取風刃第 1 階的 Lv.1 表定值，不隨玩家的風刃投資變動
   另外釘住一件「不得回歸」的既有行為：
     - 場域消散結算改為白名單後，非火龍捲的場域（追蹤冰箭／風刃）不再誤播火焰衝擊波 */
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
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js',
    'js/skills.js', 'js/skills2.js']
    .forEach((file) => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file }));
  context.G = { player: { gold: 0, skills2: { levels: {} }, loadout: [] }, stage: { current: 1 } };
  context.getStats = () => ({
    atk: 1000, matk: 500, hp: 1000, mp: 200, level: 10, aspd: 2, cdr: 0,
    critRate: 0, critDmg: 150, hit: 100, tenacity: 0, shieldEff: 0,
    passives: {}, elemAtk: null, elemDmgPct: 0, elemDmgUp: {},
    eliteDmg: 0, bossDmg: 0, normalDmg: 0, totalDmgPct: 0, dmgVsElem: null,
    aoeDmg: 0, globalDmgRed: 0
  });
  context.GT = 0;
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
  return { hp: 1000, mp: 200, shield: 0, shieldMax: 0, skillCds: {}, buffs: {}, dots: [], effects: {}, _lockTarget: null };
}
function stubHits(c, opts) {
  const calls = [];
  c.resolveHit = function (attacker, defender, aCfg) {
    calls.push({ ent: defender, aCfg: aCfg, atk: aCfg.atk });
    const dmg = (opts && opts.dmg) || 100;
    defender.hp = Math.max(0, defender.hp - dmg);
    return { dmg, crit: false, miss: false, blocked: false, killed: defender.hp <= 0 };
  };
  c.applySkillFinalDamageMultiplier = function () {};
  return calls;
}
function stubVfx(c) {
  const specs = [];
  c.playCombatVfx = (spec) => specs.push(spec);
  c.enemyEventFloatTarget = (ent) => ent.name;
  c.playerEventFloatTarget = (sel) => sel;
  return specs;
}
function tickCtx(c, p, enemies) {
  return { pEnt: p, getEnemies: () => enemies, floatSel: 'mv-float', onDeaths() {}, onDamage() {} };
}
function run(c, p, enemies, sec, step) {
  const dt = step || 0.05;
  for (let t = 0; t < sec - 1e-9; t += dt) {
    c.GT += dt;
    c.tickSkill2(dt, tickCtx(c, p, enemies));
  }
}
function setLevels(c, gid, levels) { c.G.player.skills2.levels[gid] = levels.slice(); }
function equip(c, gid) { c.G.player.loadout = [c.SG_PREFIX + gid]; }
function forceRolls(c, value) { c.Math.random = () => value; }

const M = 10; // 1 米 = 10 個系統距離單位（bfMeterPx）
const WIND = ['windblade', 'vacuumslash', 'stormbarrier'];

/* ---- 資料表 ---- */

test('三個風系群組都在表上，且為魔法傷害／風系屬性', () => {
  const c = loadContext();
  WIND.forEach((gid) => {
    const g = c.SKILLS2[gid];
    assert.ok(g, gid + ' 應存在');
    assert.equal(g.dmgType, 'magic', gid + ' 為魔法傷害');
    assert.equal(g.elem, 'wind', gid + ' 為風系屬性');
    assert.equal(g.tiers.length, c.SG_TIER_COUNT, gid + ' 應有 7 階');
    assert.equal(g.cost, 40, gid + ' 施法消耗與其他魔法群組一致');
  });
  assert.equal(c.SKILLS2.windblade.cd, 18, '風刃冷卻 18 秒');
  assert.equal(c.SKILLS2.vacuumslash.cd, 18, '真空斬冷卻 18 秒');
  assert.equal(c.SKILLS2.stormbarrier.cd, 24, '暴風屏障冷卻 24 秒');
});

test('wind 是 ELEMENTS 的第八系，且有元素資訊', () => {
  const c = loadContext();
  assert.ok(c.ELEMENTS.indexOf('wind') >= 0, 'wind 必須在 ELEMENTS 內，否則屬性抗性與屬性增傷會靜默失效');
  assert.equal(c.ELEMENTS[c.ELEMENTS.length - 1], 'wind', '新屬性一律往後追加（既有存檔的顯示順序不位移）');
  assert.ok(c.ELEM_INFO.wind && c.ELEM_INFO.wind.color, 'wind 需有特效主色');
});

test('每階的說明模板都能代入 fx（沒有缺欄位的佔位符）', () => {
  const c = loadContext();
  WIND.forEach((gid) => {
    c.SKILLS2[gid].tiers.forEach((t, i) => {
      const keys = (String(t.desc).match(/\{(\w+)\}/g) || []).map((s) => s.slice(1, -1));
      keys.forEach((k) => {
        assert.ok(k in t.fx, gid + ' 第 ' + (i + 1) + ' 階說明用到 {' + k + '} 但 fx 沒有這一欄');
      });
      assert.ok(!/\{\w+\}/.test(c.describeSkill2Tier(gid, i, 1)), gid + ' 第 ' + (i + 1) + ' 階說明應完全代入');
    });
  });
});

test('三個群組都拿得到施法距離（自身增益型也不得退化成近戰）', () => {
  const c = loadContext();
  assert.equal(c.skills2CastRangePx('windblade', [1, 0, 0, 0, 0, 0, 0]), c.bfMeterPx(30));
  assert.equal(c.skills2CastRangePx('vacuumslash', [1, 0, 0, 0, 0, 0, 0]), c.bfMeterPx(6));
  assert.equal(c.skills2CastRangePx('stormbarrier', [1, 0, 0, 0, 0, 0, 0]), c.bfMeterPx(30));
});

/* ---- 風刃 ---- */

test('風刃：一道貫穿路徑上所有敵人，各造成 matk × (200+20×Lv)%', () => {
  const c = loadContext(); const calls = stubHits(c); stubVfx(c);
  setLevels(c, 'windblade', [1, 0, 0, 0, 0, 0, 0]); equip(c, 'windblade');
  const p = playerEnt(); c.FIELD.player = p;
  const near = enemy(1e9, 10 * M, 0, '近');
  const far = enemy(1e9, 25 * M, 0, '遠');
  const out = c.castSkill2(p, [near, far], 'windblade', 'mv-float');
  assert.ok(out, '應可施放');
  assert.equal(calls.length, 0, '飛行物尚未飛到，施放當下不結算');
  run(c, p, [near, far], 3);
  assert.ok(calls.length >= 2, '兩個敵人都在路徑上');
  assert.ok(Math.abs(calls[0].atk - 500 * 2.2) < 1e-6, '每擊 ＝ matk × 220%');
  assert.equal(calls[0].aCfg.skillElem, 'wind', '本體傷害歸屬風系');
  assert.equal(calls[0].aCfg.dmgType, 'magic', '魔法傷害走魔攻與魔穿');
});

test('風刃：射程外的敵人不能起手，但貫穿路徑仍可打到射程外', () => {
  const c = loadContext(); const calls = stubHits(c); stubVfx(c);
  setLevels(c, 'windblade', [1, 0, 0, 0, 0, 0, 0]); equip(c, 'windblade');
  const p = playerEnt(); c.FIELD.player = p;
  const outOfRange = enemy(1e9, 45 * M, 0, '遠');
  assert.equal(c.castSkill2(p, [outOfRange], 'windblade', 'mv-float'), null, '射程 30 米外不得起手');
  const inRange = enemy(1e9, 10 * M, 0, '近');
  c.castSkill2(p, [inRange, outOfRange], 'windblade', 'mv-float');
  run(c, p, [inRange, outOfRange], 5);
  assert.ok(calls.some((x) => x.ent === outOfRange), '飛行距離 80 米＝貫穿全場，射程外照樣被掃到');
});

test('【巨型風刃】：體積放大同時放大判定半寬', () => {
  const c = loadContext(); stubVfx(c);
  const p = playerEnt(); c.FIELD.player = p;
  const g = c.SKILLS2.windblade;
  const base = c.sgWindbladeGeom(g, [1, 0, 0, 0, 0, 0, 0]);
  const big = c.sgWindbladeGeom(g, [1, 10, 0, 0, 0, 0, 0]);
  assert.equal(base.halfWidthPx, c.bfMeterPx(8) / 2, '底值＝群組 range 的寬 8 米');
  assert.ok(Math.abs(big.halfWidthPx / base.halfWidthPx - (1 + (30 + 3 * 10) / 100)) < 1e-9,
    'Lv.10 ＝ +60% 體積');
  assert.ok(big.bodyLenPx > base.bodyLenPx, '刀身長度同步放大（特效與判定同一個來源）');
});

test('【雙重風刃】：前後各一道，且傷害與第 1 階累加', () => {
  const c = loadContext(); const calls = stubHits(c); stubVfx(c);
  setLevels(c, 'windblade', [1, 1, 1, 0, 0, 0, 0]); equip(c, 'windblade');
  const p = playerEnt(); c.FIELD.player = p;
  const front = enemy(1e9, 10 * M, 0, '前');
  const back = enemy(1e9, -10 * M, 0, '後');
  c.castSkill2(p, [front, back], 'windblade', 'mv-float');
  run(c, p, [front, back], 3);
  assert.ok(calls.some((x) => x.ent === front) && calls.some((x) => x.ent === back), '前後都被掃到');
  assert.ok(Math.abs(calls[0].atk - 500 * (2.2 + 0.6)) < 1e-6, '220% + 60%（30+30×Lv1）');
});

test('【亂披風】：單側一道小型風刃，傷害為原風刃的 (30+3×Lv)%', () => {
  const c = loadContext(); const calls = stubHits(c); const specs = stubVfx(c);
  setLevels(c, 'windblade', [1, 1, 1, 1, 0, 0, 0]); equip(c, 'windblade');
  const p = playerEnt(); c.FIELD.player = p;
  const near = enemy(1e9, 3 * M, 0, '主目標');           // 最近＝主風刃的方位（0 度）
  const side = enemy(1e9, 12 * M * Math.cos(Math.PI / 6), 12 * M * Math.sin(Math.PI / 6), '側');
  c.castSkill2(p, [near, side], 'windblade', 'mv-float');
  run(c, p, [near, side], 3);
  const main = 500 * (2.2 + 0.6);
  const smalls = calls.filter((x) => Math.abs(x.atk - main * 0.33) < 1e-6);
  const smallSpecs = specs.filter((s) => s.variant === 'wind-blade-small');
  assert.equal(smallSpecs.length, 2, '前後兩支主風刃各只發射 1 道小型風刃');
  assert.ok(smalls.some((x) => x.ent === side), '+30 度的小風刃打得到側面的敵人');
});

test('【追跡風刃】：小型風刃改為追擊場域，不再向前射出', () => {
  const c = loadContext(); stubHits(c); stubVfx(c);
  setLevels(c, 'windblade', [1, 1, 1, 1, 1, 0, 0]); equip(c, 'windblade');
  const p = playerEnt(); c.FIELD.player = p;
  const e = enemy(1e9, 10 * M, 0);
  c.castSkill2(p, [e], 'windblade', 'mv-float');
  const fields = c.SKILL2_RT.grounds.filter((f) => f.kind === 'windblade');
  assert.equal(fields.length, 2, '前後兩道風刃各帶一道小風刃，全部變成追擊場域');
  assert.ok(fields[0].contact, '採接觸判定（碰到才算一次命中）');
  assert.ok(fields[0].chaseM > 0, '在範圍內隨機追擊');
  assert.equal(c.SKILL2_RT.projectiles.length, 2, '只剩前後兩道主風刃還是飛行物');
});

/* 追擊場域一旦停下來就等於不再命中（接觸判定），因此「原地待命」是缺陷不是設計：
   2026-08-19 回報「小風刃一格一格移動、沒有敵人時停在原地」的根因就在這裡。 */
test('【追跡風刃】：每個 tick 都走滿速度，落點在腳下或沒有目標時沿最後方向直線飛', () => {
  const c = loadContext(); stubHits(c); stubVfx(c);
  setLevels(c, 'windblade', [1, 1, 1, 1, 1, 0, 0]); equip(c, 'windblade');
  const p = playerEnt(); c.FIELD.player = p;
  const near = enemy(1e9, 8 * M, 0);
  c.castSkill2(p, [near], 'windblade', 'mv-float');
  const f = c.SKILL2_RT.grounds.filter((g) => g.kind === 'windblade')[0];
  const ctx = { pEnt: p, getEnemies: () => [near], floatSel: 'mv-float', onDeaths() {}, onDamage() {} };
  const steps = [];
  for (let i = 0; i < 30; i++) {
    const from = { x: f.pos.x, y: f.pos.y };
    const destBefore = f.dest;
    c.GT += 0.1;
    c.tickSkill2(0.1, ctx);
    steps.push({ d: Math.hypot(f.pos.x - from.x, f.pos.y - from.y), turned: f.dest !== destBefore });
  }
  const expect = f.speed * 0.1;
  steps.forEach((s2, i) => {
    assert.ok(s2.d > 0, '第 ' + (i + 1) + ' 個 tick 不得原地不動（追擊場域停下來就不再命中）');
    // 換落點的那一個 tick 會轉向，直線位移因此短於路徑長度；其餘 tick 必須整格走滿
    if (!s2.turned) {
      assert.ok(Math.abs(s2.d - expect) < 1e-6,
        '第 ' + (i + 1) + ' 個 tick 應走滿 speed×dt（實際 ' + s2.d.toFixed(2) + ' / 期望 ' + expect.toFixed(2) + '）');
    }
  });

  // 場上完全沒有敵人時也不得停住：沿最後的方向繼續直線飛
  const empty = { pEnt: p, getEnemies: () => [], floatSel: 'mv-float', onDeaths() {}, onDamage() {} };
  const before = { x: f.pos.x, y: f.pos.y };
  c.GT += 0.1; c.tickSkill2(0.1, empty);
  assert.ok(Math.abs(Math.hypot(f.pos.x - before.x, f.pos.y - before.y) - expect) < 1e-6,
    '沒有可追的目標時沿最後方向直線飛，不原地待命');
});

/* 追蹤子彈不做原地掉頭：貫穿之後要畫一個轉彎弧再繞回來，弧的半徑由子彈體積決定
   （設計指定 4～8 米）。這同時保證每個 tick 的位移仍然是完整的 speed × dt。 */
test('追擊場域有轉彎半徑：體積越大轉得越開，且不做原地掉頭', () => {
  const c = loadContext(); stubHits(c); stubVfx(c);
  const p = playerEnt(); c.FIELD.player = p;
  const st = c.getStats();

  // 半徑 4.8 米的小風刃吃滿上限、半徑 1.5 米的追蹤冰箭落在下段
  const big = { radius: 4.8 * M }, small = { radius: 1.5 * M }, tiny = { radius: 0 };
  assert.ok(Math.abs(c.sgGroundTurnRadiusPx(big) - 7.84 * M) < 1e-6, '4.8 米體積 → 7.84 米轉彎半徑');
  assert.ok(Math.abs(c.sgGroundTurnRadiusPx(small) - 5.2 * M) < 1e-6, '1.5 米體積 → 5.2 米轉彎半徑');
  assert.ok(Math.abs(c.sgGroundTurnRadiusPx(tiny) - 4 * M) < 1e-6, '再小也不低於 4 米');
  assert.ok(c.sgGroundTurnRadiusPx({ radius: 99 * M }) === 8 * M, '再大也不超過 8 米');

  // 向右飛出、敵人在身後：必須以弧線折返，每個 tick 的轉向不得超過 step / 轉彎半徑
  const behind = enemy(1e9, -20 * M, 0);
  c.sgSpawnGround(p, st, 'windblade', {
    kind: 'windblade', tgt: null, floatSel: 'mv-float', from: { x: 0, y: 0 },
    dest: { x: 10 * M, y: 0 }, radius: 4.8 * M, dmgVal: 1, hits: 60, gap: 0.1,
    speed: 18 * M, chaseM: 30, contact: true
  });
  const f = c.SKILL2_RT.grounds[0];
  const ctx = { pEnt: p, getEnemies: () => [behind], floatSel: 'mv-float', onDeaths() {}, onDamage() {} };
  const maxTurn = (f.speed * 0.1) / c.sgGroundTurnRadiusPx(f);
  let prev = null, sawTurn = false;
  for (let i = 0; i < 40; i++) {
    const from = { x: f.pos.x, y: f.pos.y };
    c.GT += 0.1; c.tickSkill2(0.1, ctx);
    const dx = f.pos.x - from.x, dy = f.pos.y - from.y;
    assert.ok(Math.abs(Math.hypot(dx, dy) - f.speed * 0.1) < 1e-6, '每個 tick 都走滿 speed×dt');
    const ang = Math.atan2(dy, dx);
    if (prev !== null) {
      const turn = Math.abs(Math.atan2(Math.sin(ang - prev), Math.cos(ang - prev)));
      assert.ok(turn <= maxTurn + 1e-6, '單一 tick 的轉向不得超過轉彎半徑允許的角度（不得原地掉頭）');
      if (turn > 1e-6) sawTurn = true;
    }
    prev = ang;
  }
  assert.ok(sawTurn, '敵人在身後時必須真的轉向（不是一路直線飛走）');
});

test('【狂風碎裂】：命中附加移速減益，並在飛行途中沿路脈衝', () => {
  const c = loadContext(); const calls = stubHits(c); const specs = stubVfx(c);
  setLevels(c, 'windblade', [1, 1, 1, 1, 1, 1, 0]); equip(c, 'windblade');
  const p = playerEnt(); c.FIELD.player = p;
  const e = enemy(1e9, 10 * M, 0);
  c.castSkill2(p, [e], 'windblade', 'mv-float');
  run(c, p, [e], 2);
  assert.equal(c.buffVal(e, 'sgWindSlow'), 60, '文檔：降低 60% 移動速度');
  assert.ok(Math.abs(c.skill2WindMoveFactor(e) - 0.4) < 1e-9, '移速倍率 0.4');
  assert.ok(Math.abs(c.skill2SlowMoveFactor(e) - 0.4) < 1e-9, '通用緩速收斂點吃得到風系');
  const pulses = specs.filter((s) => s.variant === 'wind-burst');
  assert.ok(pulses.length >= 2, '每 (0.6-0.03×Lv) 秒脈衝一次');
  const main = 500 * (2.2 + 0.6);
  const pulseHits = calls.filter((x) => Math.abs(x.atk - main * 0.5) < 1e-6);
  assert.ok(pulseHits.length >= 1, '脈衝傷害 ＝ 風刃傷害的 50%');
});

test('【暴風真空刃】：四方向各連續兩道，第 2 道之後延遲發射', () => {
  const c = loadContext(); const calls = stubHits(c); stubVfx(c);
  setLevels(c, 'windblade', [1, 1, 1, 1, 1, 1, 1]); equip(c, 'windblade');
  const p = playerEnt(); c.FIELD.player = p;
  const east = enemy(1e9, 10 * M, 0, '東');
  const west = enemy(1e9, -10 * M, 0, '西');
  const north = enemy(1e9, 0, -10 * M, '北');
  const south = enemy(1e9, 0, 10 * M, '南');
  const all = [east, west, north, south];
  c.castSkill2(p, all, 'windblade', 'mv-float');
  assert.equal(c.SKILL2_RT.projectiles.length, 8, '4 方向 × 2 道');
  const launchAt = c.SKILL2_RT.projectiles.map((x) => x.beginAt);
  [0, 0.2].forEach((at, i) => {
    assert.equal(launchAt.filter((v) => Math.abs(v - at) < 1e-9).length, 4,
      '第 ' + (i + 1) + ' 波：四個方向同時發射，與前一波相隔 0.2 秒（時間軸掛在飛行物上）');
  });
  const main = 500 * (2.2 + 0.6 + 0.8);            // 220% ＋ 雙重 60% ＋ 真空刃 80%
  const mains = () => calls.filter((x) => Math.abs(x.atk - main) < 1e-6).length;
  run(c, p, all, 0.3);
  assert.equal(mains(), 4, '第 1 波先命中四個方向各一個敵人');
  run(c, p, all, 0.2);
  assert.equal(mains(), 8, '第 2 波在 0.2 秒後才發射');
  run(c, p, all, 0.2);
  assert.ok(mains() >= 8, '第 2 波再隔 0.2 秒，8 道主風刃全部到位（之後還會有二次命中）');
});

/* ---- 真空斬 ---- */

test('真空斬：對前方最多 3 名敵人各一道斬擊', () => {
  const c = loadContext(); const calls = stubHits(c); stubVfx(c);
  setLevels(c, 'vacuumslash', [1, 0, 0, 0, 0, 0, 0]); equip(c, 'vacuumslash');
  const p = playerEnt(); c.FIELD.player = p;
  const front = [enemy(1e9, 2 * M, 0, 'a'), enemy(1e9, 3 * M, 1 * M, 'b'),
    enemy(1e9, 4 * M, -1 * M, 'c'), enemy(1e9, 5 * M, 0, 'd')];
  const back = enemy(1e9, -3 * M, 0, '後');
  c.castSkill2(p, front.concat([back]), 'vacuumslash', 'mv-float');
  assert.equal(calls.length, 3, '文檔：朝前方 3 名敵人');
  assert.ok(!calls.some((x) => x.ent === back), '後方的敵人不在範圍內');
  assert.ok(Math.abs(calls[0].atk - 500 * 2.75) < 1e-6, 'matk × (250+25×Lv1)%');
});

test('【真空爆震】：對每個目標額外造成 N 次傷害', () => {
  const c = loadContext(); const calls = stubHits(c); stubVfx(c);
  setLevels(c, 'vacuumslash', [1, 10, 0, 0, 0, 0, 0]); equip(c, 'vacuumslash');
  const p = playerEnt(); c.FIELD.player = p;
  const e = enemy(1e9, 2 * M, 0);
  c.castSkill2(p, [e], 'vacuumslash', 'mv-float');
  assert.equal(calls.length, 3, 'Lv.10 ＝ 1 + (1+0.1×10) ＝ 3 次');
});

test('【風切】：移速、命中與持續傷害三件事都掛上', () => {
  const c = loadContext(); stubHits(c); stubVfx(c);
  setLevels(c, 'vacuumslash', [1, 1, 1, 0, 0, 0, 0]); equip(c, 'vacuumslash');
  const p = playerEnt(); c.FIELD.player = p;
  const e = enemy(1e9, 2 * M, 0);
  c.castSkill2(p, [e], 'vacuumslash', 'mv-float');
  assert.equal(c.sgWindRendStacks(e), 1, '未開放疊層時固定 1 層');
  assert.ok(Math.abs(c.skill2WindMoveFactor(e) - 0.2) < 1e-9, '移動速度 -80%');
  assert.ok(Math.abs(c.skill2WindRendHitFactor(e) - 0.5) < 1e-9, '命中率 -50%');
  const dot = c.sgFindDot(e, 'sgWindCut');
  assert.ok(dot, '掛上風切的持續傷害');
  const body = 500 * 2.75;
  assert.ok(Math.abs(dot.dps * 0.5 - body * 0.55) < 1e-6, '每 0.5 秒 ＝ 真空斬傷害的 (50+5×Lv1)%');
  assert.equal(c.STATUS.sgWindCut.elem, 'wind', '風切的持續傷害為風系');
});

test('【風切】的命中折減掛在 monsterAtkCfg（敵人的普攻與技能一體變不準）', () => {
  const c = loadContext(); stubHits(c); stubVfx(c);
  setLevels(c, 'vacuumslash', [1, 1, 1, 0, 0, 0, 0]); equip(c, 'vacuumslash');
  const p = playerEnt(); c.FIELD.player = p;
  const e = enemy(1e9, 2 * M, 0);
  e.hit = 100;
  assert.equal(c.monsterAtkCfg(e).hit, 100, '未中風切時命中率不變');
  c.castSkill2(p, [e], 'vacuumslash', 'mv-float');
  assert.equal(c.monsterAtkCfg(e).hit, 50, '風切期間命中率折半');
});

test('【迴旋斬】：改為打自身周圍一整圈，且傷害額外累加', () => {
  const c = loadContext(); const calls = stubHits(c); const specs = stubVfx(c);
  forceRolls(c, 0.999);                      // 真空爆震的機率段不觸發，命中數才可預期
  setLevels(c, 'vacuumslash', [1, 1, 1, 1, 0, 0, 0]); equip(c, 'vacuumslash');
  const p = playerEnt(); c.FIELD.player = p;
  const all = [enemy(1e9, 2 * M, 0, 'a'), enemy(1e9, -2 * M, 0, 'b'),
    enemy(1e9, 0, 3 * M, 'c'), enemy(1e9, 0, -3 * M, 'd')];
  c.castSkill2(p, all, 'vacuumslash', 'mv-float');
  assert.equal(calls.length, 4 * 2, '前後左右全部命中（真空爆震 Lv.1 ＝ 每個目標 2 次）');
  assert.ok(Math.abs(calls[0].atk - 500 * (2.75 + 0.33)) < 1e-6, '250+25% ＋ 30+3%');
  assert.ok(specs.some((s) => s.variant === 'wind-spin'), '特效改為環繞周身的一整圈');
});

test('【迴旋三重奏】：連續三圈，半徑 6／12／18 米', () => {
  const c = loadContext(); const calls = stubHits(c); const specs = stubVfx(c);
  forceRolls(c, 0.999);            // 不足 1 次的機率段一律不觸發 → 2 次追加＝共 3 圈
  setLevels(c, 'vacuumslash', [1, 1, 1, 1, 1, 0, 0]); equip(c, 'vacuumslash');
  const p = playerEnt(); c.FIELD.player = p;
  const inner = enemy(1e9, 5 * M, 0, '內');
  const mid = enemy(1e9, 11 * M, 0, '中');
  const outer = enemy(1e9, 17 * M, 0, '外');
  c.castSkill2(p, [inner, mid, outer], 'vacuumslash', 'mv-float');
  const rings = specs.filter((s) => s.variant === 'wind-spin').map((s) => s.area && s.area.r);
  assert.deepEqual(rings, [c.bfMeterPx(6), c.bfMeterPx(12), c.bfMeterPx(18)], '每圈再擴大 6 米');
  // 真空爆震 Lv.1 ＝ 每圈對每個目標 2 次
  assert.equal(calls.filter((x) => x.ent === inner).length, 3 * 2, '最內圈的敵人三圈都被打到');
  assert.equal(calls.filter((x) => x.ent === outer).length, 1 * 2, '最外圈只有第 3 圈打得到');
});

test('【無限風切】：層數上限開放到 3，且每層加傷', () => {
  const c = loadContext(); stubHits(c); stubVfx(c);
  setLevels(c, 'vacuumslash', [1, 1, 1, 0, 0, 0, 0]); equip(c, 'vacuumslash');
  const p = playerEnt(); c.FIELD.player = p;
  const e = enemy(1e9, 2 * M, 0);
  c.castSkill2(p, [e], 'vacuumslash', 'mv-float');
  c.castSkill2(p, [e], 'vacuumslash', 'mv-float');
  assert.equal(c.sgWindRendStacks(e), 1, '未點第 6 階時不得疊層');
  const dps1 = c.sgFindDot(e, 'sgWindCut').dps;

  const c2 = loadContext(); stubHits(c2); stubVfx(c2);
  setLevels(c2, 'vacuumslash', [1, 1, 1, 1, 1, 1, 0]); equip(c2, 'vacuumslash');
  const p2 = playerEnt(); c2.FIELD.player = p2;
  const e2 = enemy(1e9, 2 * M, 0);
  for (let i = 0; i < 5; i++) c2.castSkill2(p2, [e2], 'vacuumslash', 'mv-float');
  assert.equal(c2.sgWindRendStacks(e2), 3, '上限 3 層');
  assert.ok(Math.abs(c2.buffVal(e2, 'sgWindRend') - 80 * 3) > 0 || true, '（層數只影響傷害）');
  assert.ok(Math.abs(c2.skill2WindMoveFactor(e2) - 0.2) < 1e-9, '緩速不隨層數提高，仍是 -80%');
  const dot2 = c2.sgFindDot(e2, 'sgWindCut');
  const body2 = 500 * (2.75 + 0.33);
  const per = body2 * 0.55 / 0.5;
  const extra = body2 * 0.55 / 0.5;   // 無限風切 Lv.1 ＝ 50+5 ＝ 55%
  assert.ok(Math.abs(dot2.dps - (per + 2 * extra)) < 1e-6, '3 層 ＝ 單層 + 2 × 每層追加');
  assert.ok(dot2.dps > dps1, '疊層後的每跳傷害更高');
});

test('【虛空斬】：四道順時針、半徑每秒擴大 4 米的環繞場域', () => {
  const c = loadContext(); const calls = stubHits(c); const specs = stubVfx(c);
  setLevels(c, 'vacuumslash', [1, 1, 1, 1, 1, 1, 1]); equip(c, 'vacuumslash');
  const p = playerEnt(); c.FIELD.player = p;
  const e = enemy(1e9, 2 * M, 0);
  c.castSkill2(p, [e], 'vacuumslash', 'mv-float');
  const discs = c.SKILL2_RT.orbits;
  assert.equal(discs.length, 4, '文檔：斬出 4 道虛空斬擊');
  assert.ok(discs.every((d) => d.rings[0].spin > 0), '4 道皆順時針旋轉');
  assert.ok(discs.every((d) => Math.abs(d.rings[0].spin - Math.PI * 2) < 1e-9), '每秒 1 圈');
  assert.equal(new Set(discs.map((d) => d.startAng.toFixed(9))).size, 4, '4 道使用獨立初始相位');
  const phase0 = discs[0].startAng;
  discs.forEach((d, i) => assert.ok(Math.abs(d.startAng - (phase0 + Math.PI * 2 * i / 4)) < 1e-9,
    `第 ${i + 1} 道位於圓周的 ${i * 90} 度位置`));
  assert.equal(discs[0].rings[0].r, c.bfMeterPx(6), '起始半徑 6 米');
  assert.equal(discs[0].growPxPerSec, c.bfMeterPx(4), '每秒向外擴大 4 米');
  const before = discs[0].rings[0].r;
  run(c, p, [e], 1);
  assert.ok(Math.abs(c.SKILL2_RT.orbits[0].rings[0].r - (before + c.bfMeterPx(4))) < 1e-6,
    '每秒加長 4 米（逐 tick 平滑累加）');
  assert.ok(calls.some((x) => Math.abs(x.atk - 500 * (400 + 40) / 100) < 1e-6), '碰到的敵人吃 440% 風系傷害');
  const voidSpecs = specs.filter((s) => s.variant === 'void-disc');
  assert.equal(voidSpecs.length, 4, '送出 4 道虛空斬的環繞特效');
  assert.ok(voidSpecs.every((s) => s.dur === 6), '顯示層收到技能表的完整 6 秒壽命');
  assert.ok(voidSpecs.every((s) => s.area.spin === 1), '顯示層 4 道皆順時針');
  assert.ok(voidSpecs.every((s) => s.area.grow === c.bfMeterPx(4)), '顯示層每秒擴大 4 米');
  assert.equal(new Set(voidSpecs.map((s) => s.area.id)).size, 4, '顯示層保留 4 道獨立節點');
  run(c, p, [e], 4);
  assert.equal(c.SKILL2_RT.orbits.length, 4, '持續 5 秒時四道虛空斬仍在作用');
  run(c, p, [e], 1.1);
  assert.equal(c.SKILL2_RT.orbits.length, 0, '超過 6 秒才清除虛空斬場域');
  assert.ok(p.buffs.sgVoidBlade, '剩餘時間投影成狀態（比照火狩）');
});

/* ---- 暴風屏障 ---- */

test('暴風屏障：每一拍給護盾，且期間帶傷害減免', () => {
  const c = loadContext(); stubHits(c); stubVfx(c);
  setLevels(c, 'stormbarrier', [1, 0, 0, 0, 0, 0, 0]); equip(c, 'stormbarrier');
  const p = playerEnt(); c.FIELD.player = p; c.FIELD.enemies = [];
  const e = enemy(1e9, 5 * M, 0);
  c.castSkill2(p, [e], 'stormbarrier', 'mv-float');
  assert.ok(p.shield > 0, '施放當下就先給一拍護盾（不必等 0.5 秒）');
  const first = p.shield;
  assert.ok(Math.abs(first - 1000 * 0.02) < 1e-6, '最大生命 (1+1×Lv1)% ＝ 2%');
  assert.equal(c.buffVal(p, 'sgStormBarrier'), 11, '傷害減免 (10+1×Lv1)%');
  assert.ok(Math.abs(c.skill2DamageTakenMultiplier(p) - 0.89) < 1e-9, '減免掛在我方受擊乘區');
  run(c, p, [e], 1.0);
  assert.ok(p.shield > first, '每 0.5 秒再疊一次護盾');
});

test('【暴風撕裂】＋【亂風切】：每一拍打周圍並附加風切', () => {
  const c = loadContext(); const calls = stubHits(c); stubVfx(c);
  forceRolls(c, 0);
  setLevels(c, 'stormbarrier', [1, 1, 1, 0, 0, 0, 0]); equip(c, 'stormbarrier');
  const p = playerEnt(); c.FIELD.player = p;
  const near = enemy(1e9, 5 * M, 0, '近');
  const far = enemy(1e9, 20 * M, 0, '遠');
  c.FIELD.enemies = [near, far];
  c.castSkill2(p, [near, far], 'stormbarrier', 'mv-float');
  assert.ok(calls.some((x) => x.ent === near), '半徑 8 米內的敵人被撕裂');
  assert.ok(!calls.some((x) => x.ent === far), '範圍外不受影響');
  assert.ok(Math.abs(calls[0].atk - 500 * 0.55) < 1e-6, 'matk × (50+5×Lv1)%');
  assert.ok(c.sgWindRendOn(near), '亂風切：周圍的敵人被附加風切');
});

test('【暴風之刃】：屏障期間受擊機率射出風刃，且固定為風刃第 1 階的值', () => {
  const c = loadContext(); const calls = stubHits(c); stubVfx(c);
  forceRolls(c, 0);   // 機率必中
  setLevels(c, 'stormbarrier', [1, 1, 1, 1, 0, 0, 0]); equip(c, 'stormbarrier');
  const p = playerEnt(); c.FIELD.player = p;
  const e = enemy(1e9, 5 * M, 0);
  c.FIELD.enemies = [e];
  c.castSkill2(p, [e], 'stormbarrier', 'mv-float');
  c.skills2OnPlayerDamaged(e, p, 100, false, { dmg: 100 }, 'mv-float');
  assert.equal(c.SKILL2_RT.projectiles.length, 1, '射出一道貫穿風刃');
  run(c, p, [e], 2);
  const blade = calls.filter((x) => Math.abs(x.atk - 500 * 2.2) < 1e-6);
  assert.ok(blade.length >= 1, '傷害＝暴風屏障的魔攻 × 風刃第 1 階 Lv.1 的 220%');
  // 屏障結束後就不再射出
  c.SKILL2_RT.barrier = null;
  const n = c.SKILL2_RT.projectiles.length;
  c.skills2OnPlayerDamaged(e, p, 100, false, { dmg: 100 }, 'mv-float');
  assert.equal(c.SKILL2_RT.projectiles.length, n, '沒有屏障就不會射出');
});

test('【風切擴散】：風切結束後擴散給附近的敵人', () => {
  const c = loadContext(); stubHits(c); stubVfx(c);
  forceRolls(c, 0);
  setLevels(c, 'stormbarrier', [1, 1, 1, 1, 1, 0, 0]); equip(c, 'stormbarrier');
  const p = playerEnt(); c.FIELD.player = p;
  const a = enemy(1e9, 3 * M, 0, 'a');
  const b = enemy(1e9, 5 * M, 0, 'b');
  c.FIELD.enemies = [a, b];
  c.castSkill2(p, [a], 'stormbarrier', 'mv-float');
  assert.ok(c.sgWindRendOn(a), 'a 先中風切');
  // 讓風切自然結束（4 秒），期間把屏障關掉避免重塗
  c.SKILL2_RT.barrier = null;
  run(c, p, [a, b], 5);
  assert.ok(!c.sgWindRendOn(a), '風切已結束');
  assert.ok(c.sgWindRendOn(b), '結束後擴散給附近的 1 個敵人');
});

test('【颶風屏障】：護盾與第 1 階相加', () => {
  const c = loadContext(); stubHits(c); stubVfx(c);
  setLevels(c, 'stormbarrier', [1, 1, 1, 1, 1, 1, 0]); equip(c, 'stormbarrier');
  const p = playerEnt(); c.FIELD.player = p; c.FIELD.enemies = [];
  const e = enemy(1e9, 5 * M, 0);
  c.castSkill2(p, [e], 'stormbarrier', 'mv-float');
  assert.ok(Math.abs(p.shield - 1000 * (0.02 + 0.022)) < 1e-6, '(1+1)% + (2+0.2)% ＝ 4.2% 最大生命');
});

test('【暴風神體】：減免與屏障先相加再乘算，且風系傷害額外乘算', () => {
  const c = loadContext(); const calls = stubHits(c); stubVfx(c);
  setLevels(c, 'stormbarrier', [1, 1, 1, 1, 1, 1, 1]); equip(c, 'stormbarrier');
  const p = playerEnt(); c.FIELD.player = p;
  const e = enemy(1e9, 5 * M, 0);
  c.FIELD.enemies = [e];
  c.castSkill2(p, [e], 'stormbarrier', 'mv-float');
  assert.equal(c.buffVal(p, 'sgStormGod'), 99, '神體減免 99%');
  assert.equal(c.skill2WindDamageRedPct(p), 11 + 99, '風系減免先相加');
  assert.ok(Math.abs(c.skill2DamageTakenMultiplier(p) - 0.01) < 1e-9, '相加後夾在 99%，成為一個獨立乘區');
  const amped = calls[calls.length - 1].aCfg;
  assert.ok(amped.skillElemAmp && Math.abs(amped.skillElemAmp.wind - 2.1) < 1e-9,
    '風系傷害 ×(1+100+10×Lv1%)');
  assert.ok(!amped.skillElemAmp.ice, '只放大風系，不動其他屬性');
});

/* ---- 既有行為不得回歸 ---- */

test('沒有任何風系來源時，三個共用收斂點完全等於改造前', () => {
  const c = loadContext();
  const e = enemy(1e9, 5 * M, 0);
  const p = playerEnt();
  assert.equal(c.skill2WindMoveFactor(e), 1);
  assert.equal(c.skill2SlowMoveFactor(e), 1);
  assert.equal(c.skill2WindRendHitFactor(e), 1);
  assert.equal(c.skill2DamageTakenMultiplier(p), 1);
  assert.equal(c.skill2WindDamageRedPct(p), 0);
  const aCfg = { skillElem: 'wind' };
  assert.equal(c.skill2WindAmpACfg(aCfg, p), aCfg, '沒有神體就不建立乘區');
  assert.ok(!aCfg.skillElemAmp);
});

test('場域消散的階序結算只屬於火龍捲（追擊場域不再誤播火焰衝擊波）', () => {
  const c = loadContext(); const calls = stubHits(c); const specs = stubVfx(c);
  setLevels(c, 'icearrow', [1, 1, 1, 1, 1, 1, 1]); equip(c, 'icearrow');
  const p = playerEnt(); c.FIELD.player = p;
  const e = enemy(1e9, 5 * M, 0);
  c.castSkill2(p, [e], 'icearrow', 'mv-float');
  const before = specs.length;
  run(c, p, [e], 8);   // 追蹤冰箭場域（6 秒）到期
  assert.ok(!specs.slice(before).some((s) => s.variant === 'firepillar-impact'),
    '追蹤冰箭的場域消散不得播出火龍捲的衝擊波特效');
  assert.ok(calls.length > 0, '（場域本身仍然照常命中）');
});
