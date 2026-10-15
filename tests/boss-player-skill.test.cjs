'use strict';
/* ============================================================
   boss-player-skill.test.cjs — 封魔塔 BOSS 施放玩家超神進化技能（js/elite_data.js bsk*／js/elite_boss*.js）
   規則（使用者 2026-10-15）：
     1. 某層 BOSS 解鎖哪個超神進化技能，牠就固定使用哪個
     2. 技能的效果參數、特效 Preset 讀玩家技能那一列，傷害套 BOSS 強度
     3. 沒有解鎖技能的 BOSS 額外多抽 2 個 NPC 隨機技能；101 層起每場隨機抽 2 個玩家技能
     4. 隨機技能每次挑戰都重抽，只有解鎖技能的 BOSS 是固定專屬
   ============================================================ */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadEliteEnv, stepElite } = require('./helpers/elite-env.cjs');

const root = path.resolve(__dirname, '..');
const PRESETS = new Set(fs.readdirSync(path.join(root, 'vfx/presets')).map((f) => f.replace(/\.json$/i, '')));

function run(c, code) { return vm.runInContext(code, c); }

/* 在塔戰裡放一隻只帶指定技能的 BOSS：玩家站在原點，BOSS 站在自己的停步距離（與真實戰鬥一致）。 */
function towerWith(ids, over) {
  over = over || {};
  const c = loadEliteEnv();
  c.errors = [];
  c.console = { error: (...a) => c.errors.push(a.map(String).join(' ')), log() {}, warn() {} };
  c.blogs = [];
  c.blog = (t) => c.blogs.push(String(t));
  run(c, 'G.tower.active = true; TOWER.floor = ' + (over.floor || 19) + '; TOWER.boss = makeBoss(' + (over.floor || 19) + ');' +
    'TOWER.player = newPlayerEntity(getStats()); TOWER.playerPos = bfPlayerPos(); TOWER.introCd = 0; eliteReset();' +
    'TOWER.boss.hp = TOWER.boss.maxHp = 1e15; TOWER.player.hp = 1e15;');
  const b = c.TOWER.boss;
  c.eliteEquip(b, ids, { tier: 'tower' });
  if (!over.autocast) Object.keys(b._el.cd).forEach((k) => { b._el.cd[k] = 1e9; });   // 只由測試手動施放，不讓冷卻自己再放一次
  b.pos = { x: c.bfStopDistance(b), y: 0 };
  return { c, b };
}
function castAll(c, b, id, sec) {
  const d = c.ELITE_AFFIXES[id];
  c.eliteCast(b, d, id);
  stepElite(c, sec || 14, { before: () => c.eliteStepMotion([b], 0.1) });
}

test('BPS-1 每個超神進化選項都由「封魔塔層級」門檻的那一層 BOSS 固定使用', () => {
  const c = loadEliteEnv();
  const opts = c.bskOptionList();
  assert.equal(opts.length, 69, '23 個群組 × 3 個超神選項');
  const byFloor = {};
  opts.forEach((o) => {
    assert.ok(o.ult.unlock && Number(o.ult.unlock.tower) > 0, o.ult.id + ' 要有封魔塔層級');
    (byFloor[o.ult.unlock.tower] = byFloor[o.ult.unlock.tower] || []).push(c.bskIdOf(o.ult.id));
  });
  Object.keys(byFloor).forEach((floor) => {
    const pick = c.bskPickForFloor(Number(floor));
    assert.deepEqual(Array.from(pick.ids).sort(), byFloor[floor].slice().sort(), '第 ' + floor + ' 層固定技能');
    assert.equal(pick.fixed, true);
    assert.equal(pick.extraNpc, 0, '有固定技能的 BOSS 不再額外抽 NPC 技能');
  });
  // 同層解鎖兩個技能的 BOSS 兩個都用
  assert.equal(c.bskPickForFloor(25).ids.length, 2);
});

test('BPS-2 沒解鎖技能：101 層以前額外 +2 個 NPC 隨機技能；101 層起每場隨機抽 2 個玩家技能', () => {
  const c = loadEliteEnv();
  const fixedFloors = new Set(c.bskOptionList().map((o) => Number(o.ult.unlock.tower)));
  [1, 5, 18, 100].forEach((floor) => {
    if (fixedFloors.has(floor)) return;
    const pk = c.bskPickForFloor(floor);
    assert.deepEqual(Array.from(pk.ids), [], '第 ' + floor + ' 層沒有玩家技能');
    assert.equal(pk.extraNpc, 2);
  });
  for (let i = 0; i < 40; i++) {
    const pk = c.bskPickForFloor(101 + i);
    assert.equal(pk.fixed, false);
    assert.equal(pk.extraNpc, 0, '101 層起改抽玩家技能，不再額外 NPC 技能');
    assert.equal(pk.ids.length, 2);
    assert.notEqual(pk.ids[0], pk.ids[1], '兩個不重複');
    pk.ids.forEach((id) => assert.ok(c.ELITE_AFFIXES[id] && c.ELITE_AFFIXES[id].pool === 'player', id));
  }
  const seen = new Set();
  for (let i = 0; i < 60; i++) seen.add(c.bskPickForFloor(150).ids.slice().sort().join('+'));
  assert.ok(seen.size > 10, '每場重抽（60 次抽出 ' + seen.size + ' 種組合）');
});

test('BPS-3 玩家技能定義進 ELITE_AFFIXES（pool=player），不污染敵人技能表與隨機技能池', () => {
  const c = loadEliteEnv();
  const ps = Object.keys(c.ELITE_AFFIXES).filter((k) => k.indexOf('ps_') === 0);
  assert.equal(ps.length, 69);
  assert.equal(c.ELITE_AFFIX_ORDER.length, Object.keys(c.ENEMY_SKILLS2).length, '敵人技能表筆數不變');
  assert.ok(c.ELITE_AFFIX_ORDER.every((id) => /^e_/.test(id)));
  assert.ok(!c.eliteSkillIds('random').some((id) => id.indexOf('ps_') === 0), '玩家技能不在隨機池');
  ps.forEach((id) => {
    const d = c.ELITE_AFFIXES[id];
    assert.equal(d.pool, 'player');
    assert.ok(d.name && d.emoji && d.desc, id + ' 要有名稱、圖示、說明（說明＝玩家那一列在最高等級的文字）');
    if (d.kind === 'active') {
      assert.ok(Array.from(c.ELITE_CASTERS ? Object.keys(c.ELITE_CASTERS) : []).indexOf(d.arch) >= 0, id + ' 的招式要接得上引擎');
      assert.ok(d.cd[0] > 0 && d.cd[1] >= d.cd[0], id + ' 要有冷卻');
      assert.equal(typeof c.BSK_RECIPES[d.ultId], 'function', id + ' 要有招式函式');
    } else {
      assert.ok(Array.from(c.ELITE_PASSIVE_ARCHS).indexOf(d.arch) >= 0, id + ' 的被動 arch 要登記');
    }
  });
});

test('BPS-4 技能的特效 Preset 全部取自玩家那一列（Skills2），程式沒有另寫 preset id', () => {
  const c = loadEliteEnv();
  c.bskOptionList().forEach((o) => {
    const d = c.ELITE_AFFIXES[c.bskIdOf(o.ult.id)];
    const body = c.sgVfxRoles(o.gid, { vfxUlt: o.ult.id, vfxBase: true });
    const map = { cast: 'cast', attack: 'attack', projectile: 'proj', hit: 'hit', ground: 'ground', field: 'field' };
    Object.keys(map).forEach((k) => assert.equal(d.v[map[k]], body[k], o.ult.id + ' 本體 ' + k));
    const trig = o.ult.triggerVfx || {};
    const tmap = { attack: 'attack2', projectile: 'proj2', hit: 'hit2', ground: 'ground2', field: 'field2' };
    Object.keys(tmap).forEach((k) => assert.equal(d.v[tmap[k]], trig[k] ? trig[k] : undefined, o.ult.id + ' 觸發 ' + k));
  });
  // 程式碼本身不得寫死 preset id（docs/vfx/VFX_PRESET_USAGE_OUTSIDE_TABLES.md 的規則）
  const src = ['js/elite_boss.js', 'js/elite_boss_recipes.js'].map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
  const literal = src.match(/['"](?:proj|hit|burst|slash|bolt|orb|aura|ground|field|pillar|beam|mark|st|en)-[a-z0-9-]+['"]/g) || [];
  assert.deepEqual(literal.filter((s) => PRESETS.has(s.slice(1, -1))), [], '不得出現寫死的 preset id');
});

test('BPS-5 makeBoss：固定技能、額外 NPC 技能、101 層隨機玩家技能，且每場重抽', () => {
  const c = loadEliteEnv();
  const base = (floor) => {
    const bd = run(c, 'BOSS_LIST[(' + floor + ' - 1) % BOSS_LIST.length]');
    return { ex: Array.from(bd.skills.ex).length, rnd: Array.from(bd.skills.rnd) };
  };
  const make = (floor) => run(c, 'makeBoss(' + floor + ')');
  // 第 19 層：固定帶暴雨梨花，其餘照舊（專屬＋4~6 隨機）
  for (let i = 0; i < 20; i++) {
    const b = make(19);
    assert.ok(b.affixes.indexOf('ps_petalStorm') >= 0);
    const b0 = base(19);
    const npc = b.affixes.filter((id) => id.indexOf('e_') === 0).length;
    assert.ok(npc >= b0.ex + b0.rnd[0] && npc <= b0.ex + b0.rnd[1], 'NPC 技能數 ' + npc);
  }
  // 第 5 層：沒有解鎖，NPC 隨機技能多 2 個
  const b5 = base(5);
  const counts = new Set();
  const combos = new Set();
  for (let i = 0; i < 60; i++) {
    const b = make(5);
    assert.ok(!b.affixes.some((id) => id.indexOf('ps_') === 0), '第 5 層沒有玩家技能');
    counts.add(b.affixes.length);
    combos.add(b.affixes.slice().sort().join(','));
    assert.ok(b.affixes.length >= b5.ex + b5.rnd[0] + 2 && b.affixes.length <= b5.ex + b5.rnd[1] + 2);
  }
  assert.ok(Math.min.apply(null, Array.from(counts)) >= b5.ex + b5.rnd[0] + 2);
  assert.ok(combos.size > 20, '隨機技能每場重抽');
  // 第 101 層：2 個玩家技能，每場不同
  const sets = new Set();
  for (let i = 0; i < 40; i++) {
    const b = make(101);
    const player = b.affixes.filter((id) => id.indexOf('ps_') === 0);
    assert.equal(player.length, 2);
    sets.add(player.slice().sort().join('+'));
  }
  assert.ok(sets.size > 5);
});

test('BPS-6 69 個技能逐一施放：不丟例外、特效 Preset 都存在、有實際動作（傷害／增益／特效）', () => {
  const c0 = loadEliteEnv();
  const ids = Object.keys(c0.ELITE_AFFIXES).filter((k) => k.indexOf('ps_') === 0 && c0.ELITE_AFFIXES[k].kind === 'active');
  assert.ok(ids.length >= 60);
  const idle = [];
  ids.forEach((id) => {
    const { c, b } = towerWith([id]);
    let hits = 0;
    const orig = c.eliteHitPlayer;
    c.eliteHitPlayer = function (m, o) { hits++; assert.ok(o.mult >= 0 && isFinite(o.mult), id + ' 傷害倍率'); return orig(m, o); };
    run(c, 'eliteHitPlayer = this.eliteHitPlayer');
    const vfx0 = c.vfx.length;
    castAll(c, b, id, 14);
    assert.deepEqual(c.errors, [], id + ' 施放過程不得有例外');
    assert.equal(c.ELITE_RT.errors, 0, id + ' 引擎不得吞例外');
    c.vfx.slice(vfx0).forEach((v) => {
      Object.keys(v.vfx || {}).forEach((role) => {
        const pid = v.vfx[role];
        if (pid) assert.ok(PRESETS.has(pid), id + ' 送出了不存在的特效 ' + pid);
      });
    });
    const emitted = c.vfx.length - vfx0;
    const buffed = !!(b._el.ps && (b._el.ps.atkUntil > 0 || b._el.ps.drUntil > 0 || b._el.ps.lifestealUntil > 0)) || b.shield > 0;
    if (!hits && !emitted && !buffed && !b.buffs.sgBloodrage) idle.push(id);
  });
  assert.deepEqual(idle, [], '這些技能施放後什麼事都沒發生');
});

test('BPS-7 傷害套 BOSS 強度：倍率＝技能 pct ÷ 100 × psDmgPct，旋鈕加倍傷害就加倍', () => {
  const sumMult = (knob) => {
    const { c, b } = towerWith(['ps_oneStrikeKill']);
    if (knob) run(c, 'ELITE_GROUP.psDmgPct = ' + knob);
    let total = 0;
    const orig = c.eliteHitPlayer;
    c.eliteHitPlayer = function (m, o) { total += o.mult; return orig(m, o); };
    run(c, 'eliteHitPlayer = this.eliteHitPlayer');
    castAll(c, b, 'ps_oneStrikeKill', 4);
    return total;
  };
  const a = sumMult(20), d = sumMult(40);
  assert.ok(a > 0);
  assert.ok(Math.abs(d / a - 2) < 1e-6, '旋鈕加倍＝傷害加倍（' + a + ' → ' + d + '）');
  // 公式：一擊必殺＝第 1 階 pct × 超神 mult × 0.5，倍率再乘 psDmgPct
  const c = loadEliteEnv();
  const t1 = c.sgVal(c.SKILLS2.thrust.tiers[0].fx, 'pct', c.bskLevel());
  const um = c.sgVal(c.SKILLS2.thrust.ult[2].fx, 'mult', c.bskLevel());
  assert.ok(Math.abs(a - t1 * um * 0.5 / 100 * 20 / 100) < 1e-6, '倍率公式');
});

test('BPS-8 衝近：BOSS 離玩家比招式範圍遠時，先高速衝近再出招', () => {
  const { c, b } = towerWith(['ps_slayerDomain']);
  b.pos = { x: 600, y: 0 };
  const d = c.ELITE_AFFIXES.ps_slayerDomain;
  c.eliteCast(b, d, 'ps_slayerDomain');
  assert.ok(b._elDash, '先衝鋒');
  const before = b.pos.x;
  stepElite(c, 3, { before: () => c.eliteStepMotion([b], 0.1) });
  assert.ok(b.pos.x < before - 200, '實際往玩家靠近（' + before + ' → ' + b.pos.x + '）');
  assert.equal(b._elDash, null, '到位後結束衝鋒');
});

test('BPS-9 環繞體：只送一則軌道事件，圓心指到 BOSS，角速度與起始角對得上判定', () => {
  const { c, b } = towerWith(['ps_solarRing']);
  b.pos = { x: 80, y: 0 };
  const vfx0 = c.vfx.length;
  castAll(c, b, 'ps_solarRing', 1);
  const orbit = c.vfx.slice(vfx0).filter((v) => v.area && v.area.orbs > 0);
  assert.equal(orbit.length, 1, '一組環繞體只送一則事件');
  const a = orbit[0].area;
  assert.equal(a.centreId, b.floatSel, '圓心＝BOSS');
  assert.ok(a.orbs >= 2 && a.spinRate !== 0 && isFinite(a.startAng) && a.r > 0 && a.orbR > 0);
  assert.equal(orbit[0].vfx.projectile, c.ELITE_AFFIXES.ps_solarRing.v.proj, '環繞體外觀＝玩家烈陽星環那一列');
  const rt = fs.readFileSync(path.join(root, 'js/vfx-runtime.js'), 'utf8');
  assert.ok(/orbitCentre\(presetId, centreId\)/.test(rt) && /spec\.area\.centreId/.test(rt), '顯示層認得 area.centreId');
});

test('BPS-10 不屈鬥魂：致命傷保命一次、冷卻內第二次才真的死；天地再造／逆轉乾坤有復活次數', () => {
  const kill = (c, b) => { b.hp = 0; c.G.tower.active = true; c.endTowerFight(true); };
  {
    const { c, b } = towerWith(['ps_indomitable']);
    c.TOWER.showingResult = false;
    kill(c, b);
    assert.equal(c.TOWER.showingResult, false, '第一次被打死：保命，戰鬥繼續');
    assert.ok(b.hp > 0, '留一口氣');
    assert.ok(b._el.invulnUntil > c.GT, '獲得無敵護盾');
    c.GT += 1;
    kill(c, b);
    assert.equal(c.TOWER.showingResult, true, '冷卻內第二次致命傷就真的結束');
  }
  {
    const { c, b } = towerWith(['ps_worldRebirth']);
    kill(c, b);
    assert.equal(c.TOWER.showingResult, false, '天地再造：復活一次');
    assert.ok(b.hp > 0 && b.hp < b.maxHp, '以部分生命重生');
    kill(c, b);
    assert.equal(c.TOWER.showingResult, true, '只有一次');
  }
  {
    const { c, b } = towerWith(['ps_worldRebirth', 'ps_fateReversal']);
    let revived = 0;
    for (let i = 0; i < 6 && !c.TOWER.showingResult; i++) { kill(c, b); if (!c.TOWER.showingResult) revived++; }
    assert.equal(revived, 3, '天地再造 1 次＋逆轉乾坤 2 次');
  }
});

test('BPS-11 神聖之體：BOSS 每受 N 次攻擊就射出光彈；天穹崩裂：受擊機率反擊追蹤風刃', () => {
  {
    const { c, b } = towerWith(['ps_holyBody']);
    const need = Math.floor(c.sgVal(c.SKILLS2.counter.ult[0].fx, 'count', c.bskLevel()));
    let hits = 0;
    const orig = c.eliteHitPlayer;
    c.eliteHitPlayer = function (m, o) { hits++; return orig(m, o); };
    run(c, 'eliteHitPlayer = this.eliteHitPlayer');
    for (let i = 0; i < need - 1; i++) c.eliteOnDamaged(b, 100, null);
    stepElite(c, 3, { before: () => c.eliteStepMotion([b], 0.1) });
    assert.equal(hits, 0, '次數不足不觸發');
    c.eliteOnDamaged(b, 100, null);
    stepElite(c, 3, { before: () => c.eliteStepMotion([b], 0.1) });
    assert.ok(hits >= 1, '滿 ' + need + ' 次射出光彈');
  }
  {
    const { c, b } = towerWith(['ps_skyCollapse']);
    const vfx0 = c.vfx.length;
    c.Math = Math;
    const orig = Math.random;
    Math.random = () => 0;
    try { c.eliteOnDamaged(b, 100, null); } finally { Math.random = orig; }
    stepElite(c, 5, { before: () => c.eliteStepMotion([b], 0.1) });
    assert.ok(c.vfx.length > vfx0, '反擊的小風刃有畫面');
  }
});

test('BPS-12 自身增益：BOSS 增益提高對玩家的傷害、減傷降低受到的傷害', () => {
  const { c, b } = towerWith(['ps_slayerAdvent']);
  const base = c.eliteAtkFactor(b);
  castAll(c, b, 'ps_slayerAdvent', 1);
  assert.ok(c.eliteAtkFactor(b) > base, '狂怒期間攻擊力提高');
  const t = towerWith(['ps_valgrForce']);
  const dmg0 = t.c.eliteIncomingDamage(t.b, 1000, null);
  castAll(t.c, t.b, 'ps_valgrForce', 1);
  assert.ok(t.c.eliteIncomingDamage(t.b, 1000, null) < dmg0, '暴風神體期間受到的傷害降低');
  const v = towerWith(['ps_shadowExecutioner']);
  const f0 = v.c.eliteAtkFactor(v.b);
  v.b._el.ps = v.c.bskPs(v.b);
  v.c.bskVuln({ m: v.b }, 0.3, 10);
  assert.ok(v.c.eliteAtkFactor(v.b) > f0, '玩家被標記易傷後，BOSS 對玩家的傷害提高');
});

test('BPS-13 整場塔戰連跑 60 秒：帶玩家技能的 BOSS 不丟例外、會施放玩家技能', () => {
  const c = loadEliteEnv();
  c.errors = [];
  c.console = { error: (...a) => c.errors.push(a.map(String).join(' ')), log() {}, warn() {} };
  const logs = [];
  c.blog = (t) => logs.push(String(t));
  run(c, 'GM_TEST = { god: true }; G.tower.highest = 18; G.player.gold = 1e30; UI = { dirty: {} }; startTowerFight(19);' +
    'TOWER.boss.hp = TOWER.boss.maxHp = 1e15; TOWER.player.hp = 1e15;');
  assert.ok(c.TOWER.boss.affixes.indexOf('ps_petalStorm') >= 0);
  for (let i = 0; i < 600 && c.G.tower.active && !c.TOWER.showingResult; i++) {
    c.GT = Math.round((c.GT + 0.1) * 1000) / 1000;
    c.towerTick(0.1);
  }
  assert.deepEqual(c.errors, []);
  assert.equal(c.ELITE_RT.errors, 0);
  assert.ok(c.TOWER.elapsed > 50, '打滿整場');
  assert.ok(logs.some((l) => l.indexOf('【🔪暴雨梨花】') >= 0), 'BOSS 有施放暴雨梨花');
});

test('BPS-14 野外菁英也能帶玩家技能（GM 測試用）：效果照常，被動只在塔戰生效', () => {
  const c = loadEliteEnv();
  const { makeElite } = require('./helpers/elite-env.cjs');
  const m = makeElite(c, ['ps_chidori'], { tier: 'elite' });
  const d = c.ELITE_AFFIXES.ps_chidori;
  c.eliteCast(m, d, 'ps_chidori');
  stepElite(c, 5);
  assert.equal(c.ELITE_RT.errors, 0);
});

test('BPS-15 整體強度旋鈕在參數表「封魔塔BOSS玩家技能」一列，與 data.js ELITE_GROUP、程式預設值三處一致', () => {
  const csv = fs.readFileSync(path.join(root, 'config/CSV/game_parameters.csv'), 'utf8');
  const line = csv.split(/\r?\n/).find((l) => l.indexOf(',4-菁英群組,封魔塔BOSS玩家技能,') >= 0);
  assert.ok(line, '參數表要有這一列');
  const cells = line.split(',');
  const values = cells.slice(cells.length - 12).map(Number);       // 參數 a~l
  const keys = ['psDmgPct', 'psTickPct', 'psAreaPct', 'psBuffPct', 'psCtrlPct', 'psShieldPct', 'psReviveHpPct', 'psPassiveGap'];
  const c = loadEliteEnv();
  keys.forEach((k, i) => {
    assert.equal(run(c, 'ELITE_GROUP.' + k), values[i], 'data.js ELITE_GROUP.' + k + ' 要等於參數表第 ' + (i + 1) + ' 格');
  });
  // 程式端的預設值（參數沒填時用）與參數表預設一致：把 ELITE_GROUP 的鍵拿掉後，bskG 的結果要回到同一個數字
  const fallbacks = { DmgPct: 'psDmgPct', TickPct: 'psTickPct', AreaPct: 'psAreaPct', BuffPct: 'psBuffPct', CtrlPct: 'psCtrlPct', ShieldPct: 'psShieldPct', ReviveHpPct: 'psReviveHpPct', PassiveGap: 'psPassiveGap' };
  Object.keys(fallbacks).forEach((suffix) => {
    const want = run(c, 'ELITE_GROUP.' + fallbacks[suffix]);
    const src = fs.readFileSync(path.join(root, 'js/elite_boss.js') , 'utf8') + fs.readFileSync(path.join(root, 'js/elite_boss_recipes.js'), 'utf8');
    const m = src.match(new RegExp("bskG\\('" + suffix + "', (\\d+(?:\\.\\d+)?)\\)"));
    assert.ok(m, suffix + ' 在程式裡要有預設值');
    assert.equal(Number(m[1]), want, suffix + ' 程式預設值要與參數表一致');
  });
});
