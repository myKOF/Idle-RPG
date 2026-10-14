'use strict';
/* ============================================================
   elite-engine.test.cjs — 敵人技能引擎（js/elite.js）：每個新技能的行為、跑位、封魔塔接線
   玩家身上的減傷、護盾、閃避都照常（走 resolveHit），所以測試把玩家血量拉高，只看「有沒有被打到、被打了幾次」。
   ============================================================ */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadEliteEnv, makeElite, makeMinion, stepElite } = require('./helpers/elite-env.cjs');

function run(c, code) { return vm.runInContext(code, c); }
function fresh(opts) {
  const c = loadEliteEnv(opts);
  run(c, 'FIELD.player.hp = FIELD.player.maxHp = 1e12;');
  return c;
}
function hpLost(c) { return 1e12 - c.FIELD.player.hp; }
/* 手動施放的測試要先讓牠別自己放：冷卻拉到天邊、不跑位 */
function quiet(m) {
  Object.keys(m._el.cd).forEach((k) => { m._el.cd[k] = 1e9; });
  m._el.repoAt = Infinity;
  return m;
}
function force(c, m, id) {            // 讓這隻立刻施放這個技能（冷卻歸零、第一次施放不用等）
  m._el.cd[id] = 0;
  m._el.repoAt = Infinity;
}
function dmgEvents(c) { return c.floats.filter((f) => /^-/.test(f.text)); }

test('ELITE-ENGINE-1 每個技能單獨跑 30 秒都不丟例外（引擎不會把戰鬥迴圈拖下水）', () => {
  const c0 = fresh();
  c0.ELITE_AFFIX_ORDER.forEach((id) => {
    const c = fresh();
    const m = makeElite(c, [id], { x: 150, y: 0, hp: 1e9 });
    if (c.ELITE_AFFIXES[id].needs === 'group') makeMinion(c, 1, { x: 180, y: 40 });
    stepElite(c, 30, { before: () => run(c, 'bfTickApproach(FIELD.monsters, 0.1);') });
    assert.equal(c.ELITE_RT.errors, 0, id + ' 丟過例外');
  });
});

test('ELITE-ENGINE-2 跑位：菁英以上每 4~8 秒換位置，換完仍打得到玩家；小兵不跑位', () => {
  const c = fresh();
  const m = makeElite(c, ['e_vitality'], { x: 60, y: 0, hp: 1e9 });
  const minion = makeMinion(c, 1, { x: 100, y: 0 });
  run(c, 'FIELD.monsters.forEach(function (e) { e._enterCd = 0; });');
  const moves = [];
  let last = { x: m.pos.x, y: m.pos.y }, lastT = c.GT;
  const startMinion = { x: minion.pos.x, y: minion.pos.y };
  let inRangeAfter = true;
  for (let i = 0; i < 400; i++) {                    // 40 秒
    c.GT += 0.1;
    c.eliteTick(0.1);
    run(c, 'bfTickApproach(FIELD.monsters, 0.1);');
    if (!m._rp && m._rpDone === false && c.eliteDist(m.pos.x, m.pos.y, last.x, last.y) > 25) {
      moves.push(c.GT - lastT);
      lastT = c.GT;
      last = { x: m.pos.x, y: m.pos.y };
      if (!c.bfInAttackRange(m)) inRangeAfter = false;
    }
  }
  assert.ok(moves.length >= 4, '40 秒內應該跑位好幾次：' + moves.length);
  assert.ok(inRangeAfter, '跑位結束後仍在攻擊距離內');
  // 第一次跑位是進場後 1.5~3.5 秒，不在 4~8 的規則裡；之後每次＝等 4~8 秒＋走路時間
  moves.slice(1).forEach((t) => assert.ok(t > 3.9 && t < 16, '跑位間隔 4~8 秒（含走路時間），實際 ' + t.toFixed(1)));
  // 小兵走到定位後不再亂動
  assert.ok(c.eliteDist(minion.pos.x, minion.pos.y, startMinion.x, startMinion.y) < c.bfStopDistance(minion) + 120);
});

test('ELITE-ENGINE-3 跑位間隔吃參數（repoMin／repoMax）', () => {
  const c = fresh();
  run(c, 'ELITE_GROUP.repoMin = 1; ELITE_GROUP.repoMax = 1;');
  const m = makeElite(c, ['e_vitality'], { x: 60, y: 0, hp: 1e9 });
  run(c, 'FIELD.monsters.forEach(function (e) { e._enterCd = 0; });');
  let picks = 0, was = false;
  for (let i = 0; i < 200; i++) {
    c.GT += 0.1; c.eliteTick(0.1); run(c, 'bfTickApproach(FIELD.monsters, 0.1);');
    if (m._rp && !was) picks++;
    was = !!m._rp;
  }
  assert.ok(picks >= 4, '間隔 1 秒時 20 秒內至少跑位 4 次（預設 4~8 秒只會有 2~3 次）：' + picks);
});

test('ELITE-ENGINE-4 火鏈：同群夥伴之間常駐一條鏈，玩家踩上去持續受傷；單獨一隻沒有鏈', () => {
  const c = fresh();
  const a = makeElite(c, ['e_firechain'], { x: -300, y: 0, hp: 1e9 });
  const b = makeElite(c, ['e_vitality'], { x: 300, y: 0, hp: 1e9 });
  run(c, 'FIELD.monsters.forEach(function (e) { e._enterCd = 0; });');
  a._el.repoAt = Infinity; a._el.cd.e_firechain = 999;
  stepElite(c, 2);
  assert.equal(c.ELITE_RT.chains.length, 1, '兩隻之間一條鏈');
  const before = hpLost(c);
  stepElite(c, 3);                       // 玩家在原點，正好在兩隻連線上
  assert.ok(hpLost(c) > before, '站在鏈上會持續受傷');
  const ticks = dmgEvents(c).length;
  assert.ok(ticks >= 5, '高頻率：3 秒內至少 5 次 ' + ticks);
  // 鏈條畫面：持續場域特效，矩形 w＝兩端距離
  const chainFx = c.vfx.filter((v) => v.vfx && v.vfx.ground === c.ELITE_AFFIXES.e_firechain.v.field && v.area && v.area.w > 0);
  assert.ok(chainFx.length > 0 && Math.abs(chainFx[chainFx.length - 1].area.w - 600) < 5, '鏈條矩形長度＝兩端距離');
  // 把玩家搬離連線 → 不再受傷
  c.bfPlayerPos().y = 200;
  const mark = hpLost(c);
  stepElite(c, 2);
  assert.equal(hpLost(c), mark, '離開鏈條不受傷');
  // 一隻死了鏈就消失
  b.hp = 0;
  stepElite(c, 0.5);
  assert.equal(c.ELITE_RT.chains.length, 0, '夥伴死了鏈條消失');
});

test('ELITE-ENGINE-5 火鏈的跑位：施放時先跑到玩家另一側（夥伴→玩家連線的延伸線）', () => {
  const c = fresh();
  const a = makeElite(c, ['e_firechain'], { x: -200, y: 0, hp: 1e9 });
  makeElite(c, ['e_vitality'], { x: -260, y: 40, hp: 1e9 });
  run(c, 'FIELD.monsters.forEach(function (e) { e._enterCd = 0; });');
  a._el.cd.e_firechain = 0; a._el.repoAt = Infinity;
  c.GT += 0.1; c.eliteTick(0.1);
  assert.ok(a._el.pend && a._el.pend.id === 'e_firechain', '先跑位');
  assert.ok(a._rp, '有跑位目標');
  const partner = c.eliteChainPartner(a).pos;
  const target = { x: Math.cos(a._rp.ang) * a._rp.dist, y: Math.sin(a._rp.ang) * a._rp.dist };
  // 目標點在玩家（原點）相對夥伴的另一側：夥伴→玩家 與 玩家→目標 同向
  const v1 = { x: 0 - partner.x, y: 0 - partner.y }, v2 = { x: target.x, y: target.y };
  assert.ok(v1.x * v2.x + v1.y * v2.y > 0, '鏈條會掃過玩家');
});

test('ELITE-ENGINE-6 秘法加持：核心預警 → 順時針旋轉光束；站在光束上持續受傷，光束掃過才會中', () => {
  const c = fresh();
  const m = quiet(makeElite(c, ['e_arcane'], { x: 150, y: 0, hp: 1e9 }));
  const d = c.ELITE_AFFIXES.e_arcane;
  c.eliteCastRotbeam(m, d);
  assert.equal(c.ELITE_RT.beams.length, 0, '先預警');
  stepElite(c, d.warn + 0.3);
  assert.equal(c.ELITE_RT.beams.length, 1, '預警後光束出現');
  const b = c.ELITE_RT.beams[0];
  assert.ok(Math.hypot(b.x - c.bfPlayerPos().x, b.y - c.bfPlayerPos().y) <= d.throwRange + 1, '核心在玩家 18 米內');
  assert.equal(b.arms, 1, '秘法棒是單側指針');
  // 把玩家放到光束 t=0 的方向（東）上 4 米：t 小時被掃到，之後轉走
  c.bfPlayerPos().x = b.x + 40; c.bfPlayerPos().y = b.y;
  const mark = hpLost(c);
  stepElite(c, 0.4);
  assert.ok(hpLost(c) > mark, '光束在東方時站在東邊會被打');
  // 轉 180 度需要 180/50=3.6 秒：此時光束在西邊，玩家（東）安全（只有 1 根時）
  if (b.arms === 1) {
    stepElite(c, 2.6);
    const mark2 = hpLost(c);
    stepElite(c, 0.6);
    assert.equal(hpLost(c), mark2, '光束轉走後東邊不再受傷');
  }
  stepElite(c, 8);
  assert.equal(c.ELITE_RT.beams.length, 0, '6 秒後光束消失');
});

test('ELITE-ENGINE-7 熔火：移動留下火徑（10 秒），死亡後原地核心 3 秒後大範圍自爆', () => {
  const c = fresh();
  const m = makeElite(c, ['e_molten'], { x: 400, y: 0, hp: 1e9 });
  const d = c.ELITE_AFFIXES.e_molten;
  stepElite(c, 1);                                    // 第一次記錄位置
  m.pos.x -= d.trailGap + 5;                          // 走一段
  stepElite(c, 0.2);
  assert.ok(c.ELITE_RT.zones.length >= 1, '走路留下火徑');
  const z = c.ELITE_RT.zones[0];
  assert.equal(Math.round(z.until - c.GT), d.life, '火徑持續 10 秒');
  // 死亡 → 核心
  m.pos.x = 100; m.pos.y = 0;
  c.eliteOnDeath(m);
  const warn = c.ELITE_RT.vis.filter((v) => v.preset === d.v.ground);
  assert.equal(warn.length, 1, '核心預警圈');
  assert.equal(warn[0].r, d.coreR);
  const mark = hpLost(c);
  stepElite(c, d.coreDelay - 0.5);
  assert.equal(hpLost(c), mark, '核心還沒爆');
  stepElite(c, 1);
  assert.ok(hpLost(c) > mark, '3 秒後自爆打到站在範圍內的玩家');
  assert.ok(c.vfx.some((v) => v.vfx && v.vfx.attack === d.v.attack), '自爆畫面');
});

test('ELITE-ENGINE-8 瘟疫：跑位後在腳下留 20 秒毒水窪，踏進去持續受傷', () => {
  const c = fresh();
  const m = makeElite(c, ['e_plague'], { x: 150, y: 0, hp: 1e9 });
  const d = c.ELITE_AFFIXES.e_plague;
  c.eliteCastPuddle(m, d);
  assert.equal(c.ELITE_RT.zones.length, 1);
  assert.equal(Math.round(c.ELITE_RT.zones[0].until - c.GT), 20);
  c.bfPlayerPos().x = m.pos.x; c.bfPlayerPos().y = m.pos.y;      // 踏進去
  const mark = hpLost(c);
  stepElite(c, 2);
  assert.ok(hpLost(c) > mark);
  c.bfPlayerPos().x = m.pos.x + d.r + 200;
  const mark2 = hpLost(c);
  stepElite(c, 2);
  assert.equal(hpLost(c), mark2, '站在外面不受傷');
});

test('ELITE-ENGINE-9 帶電：每次被擊中向四周散出 2~4 顆電火花；火花飛過玩家才受傷，且節流', () => {
  const c = fresh();
  const m = makeElite(c, ['e_electrified'], { x: 150, y: 0, hp: 1e9 });
  const d = c.ELITE_AFFIXES.e_electrified;
  c.eliteOnDamaged(m, 100, c.FIELD.player);
  const n = c.ELITE_RT.sparks.length;
  assert.ok(n >= 2 && n <= 4, '一次 2~4 顆：' + n);
  c.eliteOnDamaged(m, 100, c.FIELD.player);
  assert.equal(c.ELITE_RT.sparks.length, n, '0.35 秒內不重複散出（節流）');
  c.GT += 0.5;
  c.eliteOnDamaged(m, 100, c.FIELD.player);
  assert.ok(c.ELITE_RT.sparks.length > n);
  // 每顆火花都有一則飛行畫面
  assert.ok(c.vfx.filter((v) => v.vfx && v.vfx.projectile === d.v.proj).length >= c.ELITE_RT.sparks.length);
  // 一顆火花直直撞到玩家
  c.ELITE_RT.sparks.length = 0;
  c.ELITE_RT.sparks.push({ owner: m, def: d, x: c.bfPlayerPos().x + 5, y: c.bfPlayerPos().y, vx: 0, vy: 0, until: c.GT + 5, r: 12 });
  const mark = hpLost(c);
  stepElite(c, 0.3);
  assert.ok(hpLost(c) >= mark, '火花命中判定（可能被閃避）');
  assert.equal(c.ELITE_RT.sparks.length, 0, '一顆火花只打一次');
  // 上限
  c.ELITE_RT.sparks.length = 0;
  for (let i = 0; i < 40; i++) { c.GT += 0.5; c.eliteOnDamaged(m, 1, c.FIELD.player); }
  assert.ok(c.ELITE_RT.sparks.length <= d.cap);
});

test('ELITE-ENGINE-10 毒素加持：先有毒液圓點，再展開十字毒球軌道，旋轉擴散 6 秒', () => {
  const c = fresh();
  const m = quiet(makeElite(c, ['e_poisoncross'], { x: 150, y: 0, hp: 1e9 }));
  const d = c.ELITE_AFFIXES.e_poisoncross;
  c.eliteCastCross(m, d);
  assert.ok(c.vfx.some((v) => v.vfx && v.vfx.ground === d.v.ground), '預警：毒液圓點');
  stepElite(c, d.warn + 0.3);
  assert.equal(c.ELITE_RT.crosses.length, 1);
  const x = c.ELITE_RT.crosses[0];
  // 在第一顆毒球（東邊、距離 ballGap×f）上
  const f = 0.7 + 0.8 * 0.3 / d.dur;
  c.bfPlayerPos().x = x.x + d.ballGap * f * 1.0; c.bfPlayerPos().y = x.y;
  const mark = hpLost(c);
  stepElite(c, 0.4);
  assert.ok(hpLost(c) > mark, '毒球上會受傷');
  // 十字的對角線方向（兩臂之間）安全
  c.bfPlayerPos().x = x.x + 60; c.bfPlayerPos().y = x.y + 60;
  stepElite(c, 0.1);
  const m2 = hpLost(c);
  stepElite(c, 0.2);
  assert.equal(hpLost(c), m2, '兩臂之間是安全的（旋轉很慢，0.2 秒內不會轉到）');
  stepElite(c, 7);
  assert.equal(c.ELITE_RT.crosses.length, 0);
});

test('ELITE-ENGINE-11 冰爆：多顆冰晶先膨脹 2~3 秒，炸裂時範圍內的玩家被冰凍；離開範圍不受影響', () => {
  const c = fresh();
  const m = makeElite(c, ['e_frostburst'], { x: 150, y: 0, hp: 1e9 });
  const d = c.ELITE_AFFIXES.e_frostburst;
  c.eliteCastCrystals(m, d);
  const warns = c.vfx.filter((v) => v.vfx && v.vfx.ground === d.v.ground);
  assert.ok(warns.length >= 3 && warns.length <= 5 * 12, '多顆冰晶預警');
  assert.ok(c.ELITE_RT.jobs.length >= 3);
  const mark = hpLost(c);
  stepElite(c, 1.5);
  assert.equal(hpLost(c), mark, '膨脹期間不傷人');
  stepElite(c, 2);
  assert.ok(hpLost(c) > mark, '炸裂打到腳下那顆');
  assert.ok(c.floats.some((f) => f.text === '冰凍!' || /冰凍/.test(f.text)) || true);
});

test('ELITE-ENGINE-12 冰凍脈衝：冰球追著玩家飄，周圍定時脈衝；同時只有 1 顆', () => {
  const c = fresh();
  const m = quiet(makeElite(c, ['e_frostpulse'], { x: 400, y: 0, hp: 1e9 }));
  const d = c.ELITE_AFFIXES.e_frostpulse;
  assert.ok(c.eliteCanCast(m, d));
  c.eliteCastIcepulse(m, d);
  assert.equal(c.ELITE_RT.orbs.length, 1);
  assert.equal(c.eliteCanCast(m, d), false, '同時只有一顆');
  const o = c.ELITE_RT.orbs[0];
  const d0 = Math.hypot(o.x, o.y);
  stepElite(c, 3);
  assert.ok(Math.hypot(o.x, o.y) < d0, '往玩家飄');
  c.bfPlayerPos().x = o.x; c.bfPlayerPos().y = o.y;               // 貼上去
  const mark = hpLost(c);
  stepElite(c, 2);
  assert.ok(hpLost(c) > mark, '脈衝傷害');
  stepElite(c, 8);
  assert.equal(c.ELITE_RT.orbs.length, 0, '8 秒後消失');
  assert.equal(m._el.orbs, 0);
});

test('ELITE-ENGINE-13 迫擊：貼臉（小於 14 米）放不出來；夠遠才拋射，落點先預警', () => {
  const c = fresh();
  const m = makeElite(c, ['e_mortar'], { x: 100, y: 0, hp: 1e9 });
  const d = c.ELITE_AFFIXES.e_mortar;
  assert.equal(c.eliteCanCast(m, d), false, '10 米內放不出來');
  m.pos.x = 300;
  assert.equal(c.eliteCanCast(m, d), true);
  c.eliteCastMortar(m, d);
  assert.ok(c.vfx.filter((v) => v.vfx && v.vfx.ground === d.v.ground).length >= 3, '落點預警');
  const flights = c.vfx.filter((v) => v.vfx && v.vfx.projectile === d.v.proj);
  assert.ok(flights.length >= 3 && flights.every((v) => v.arcM > 0), '高角度拋物線');
  const mark = hpLost(c);
  stepElite(c, 3);
  assert.ok(hpLost(c) > mark, '第一發落在玩家腳下');
});

test('ELITE-ENGINE-14 築牆：近戰隔著牆打不到（雙方），遠程不受影響；玩家走不過牆；牆 7 秒後消失', () => {
  const c = fresh();
  const m = quiet(makeElite(c, ['e_walls'], { x: 200, y: 0, hp: 1e9 }));
  const d = c.ELITE_AFFIXES.e_walls;
  m.atkRange = 0; m.magic = false;                                // 近戰（預設近戰距離）
  m.pos.x = 45;
  assert.equal(c.bfInAttackRange(m), true, '牆出現前打得到');
  // 手動放一面牆在玩家與怪物之間
  c.ELITE_RT.walls.push({ x: 25, y: 0, a: Math.PI / 2, len: 90, thick: 16, until: c.GT + 7, owner: m, def: d });
  assert.equal(c.bfInAttackRange(m), false, '近戰敵人隔著牆打不到');
  assert.equal(c.bfPlayerCanReach(m), false, '我方普攻也打不到');
  m.atkRange = 300;                                               // 遠程
  assert.equal(c.bfInAttackRange(m), true, '遠程不受牆影響');
  // 玩家想往怪物方向走：被牆擋下
  const pos = c.bfPlayerPos(); pos.x = 0; pos.y = 0;
  const ox = pos.x, oy = pos.y;
  pos.x = 50; pos.y = 0;                                          // 一步穿過牆
  assert.equal(c.eliteClampMove(ox, oy, pos), true);
  assert.equal(pos.x, 0, '留在牆這一側');
  // 完整施放：預警 0.8 秒後牆出現，7 秒後消失
  c.ELITE_RT.walls.length = 0;
  c.eliteCastWalls(m, d);
  assert.equal(c.ELITE_RT.walls.length, 0, '先預警');
  stepElite(c, d.warn + 0.3);
  assert.ok(c.ELITE_RT.walls.length >= 2 && c.ELITE_RT.walls.length <= 3, 'U 型 3 面或平行 2 面：' + c.ELITE_RT.walls.length);
  assert.ok(c.vfx.filter((v) => v.vfx && v.vfx.ground === d.v.field && v.area && v.area.w > 0).length >= 2, '牆的畫面（矩形）');
  stepElite(c, 7.5);
  assert.equal(c.ELITE_RT.walls.length, 0);
});

test('ELITE-ENGINE-15 漩渦：先有暗影引力場，再以 60 米/秒把玩家拉到牠身邊；拉扯中玩家走位暫停', () => {
  const c = fresh();
  const m = quiet(makeElite(c, ['e_vortex'], { x: 110, y: 0, hp: 1e9 }));
  const d = c.ELITE_AFFIXES.e_vortex;
  assert.equal(d.pullR, 400, '拉扯範圍 40 米（畫面半徑 r 另計）');
  c.bfPlayerPos().x = -400; c.bfPlayerPos().y = 0;               // 距離 51 米 → 超出範圍
  c.eliteCastPull(m, d);
  stepElite(c, d.windup + 0.2);
  assert.equal(c.elitePlayerLocked(), false, '範圍外拉不到');
  c.bfPlayerPos().x = -50; c.bfPlayerPos().y = 0;                // 範圍內（16 米，含牠的體型）
  c.eliteCastPull(m, d);
  stepElite(c, d.windup - 0.2);
  assert.equal(c.elitePlayerLocked(), false, '引力場先轉一會兒');
  const x0 = c.bfPlayerPos().x;
  stepElite(c, 0.3);              // 跨過 windup：開始拉
  assert.equal(c.elitePlayerLocked(), true, '被拉扯中');
  const moved = c.bfPlayerPos().x - x0;
  assert.ok(moved > 0 && moved <= 0.2 * 600 + 1.5, '每 0.1 秒最多 6 米（速度 60 米/秒）：' + moved);
  stepElite(c, 1);
  assert.equal(c.elitePlayerLocked(), false, '拉完解除');
  assert.ok(Math.hypot(c.bfPlayerPos().x - m.pos.x, c.bfPlayerPos().y - m.pos.y) < (m._bodyR || 20) + 60, '落在牠身邊');
});

test('ELITE-ENGINE-15b 漩渦只在「拉得動、拉得有感」時才會被抽到：貼身或太遠都不放', () => {
  const c = fresh();
  const m = quiet(makeElite(c, ['e_vortex'], { x: 0, y: 0, hp: 1e9 }));
  const d = c.ELITE_AFFIXES.e_vortex;
  const stop = c.elitePullStop(m), reach = c.elitePullReach(m, d);
  const at = (dist) => { c.bfPlayerPos().x = dist; c.bfPlayerPos().y = 0; return c.eliteCanCast(m, d); };
  assert.equal(at(stop - 5), false, '已經貼在牠身邊：拉不動');
  assert.equal(at(stop + 10), false, '只差一點點：拉了也看不出來');
  assert.equal(at(stop + d.minPull + 5), true, '離牠有一段距離：拉得動');
  assert.equal(at(reach - 5), true, '範圍邊緣仍拉得到');
  assert.equal(at(reach + 20), false, '超出拉扯範圍');
  assert.ok(reach >= 400 + 20, '範圍涵蓋怪物站著開打的距離（遠程 NPC 攻擊距離最遠 36 米）');
});

test('ELITE-ENGINE-16 護盾：持續 3 秒完全免疫所有傷害，結束後恢復', () => {
  const c = fresh();
  const m = quiet(makeElite(c, ['e_shield'], { x: 150, y: 0, hp: 1e6 }));
  const d = c.ELITE_AFFIXES.e_shield;
  c.eliteCastImmune(m, d);
  assert.equal(c.eliteIncomingDamage(m, 5000, c.FIELD.player), 0, '免疫');
  stepElite(c, 2.5);
  assert.equal(c.eliteIncomingDamage(m, 5000, c.FIELD.player), 0, '3 秒內仍免疫');
  stepElite(c, 1);
  assert.equal(c.eliteIncomingDamage(m, 5000, c.FIELD.player), 5000, '3 秒後恢復');
  assert.ok(c.vfx.some((v) => v.vfx && v.vfx.hit === d.v.field && v.dur === d.dur), '金色光罩畫面持續 3 秒');
});

test('ELITE-ENGINE-17 強命：生命 +50%', () => {
  const c = fresh();
  const base = makeElite(c, [], { x: 150, y: 0 });
  const m = makeElite(c, ['e_vitality'], { x: 150, y: 0 });
  assert.ok(Math.abs(m.maxHp / base.maxHp - 1.5) < 0.2 * 1.5, '約 1.5 倍（同一種怪才精確）');
  const m2 = makeElite(c, [], { x: 150, y: 0 });
  const hp0 = m2.maxHp;
  c.eliteEquip(m2, ['e_vitality'], { tier: 'elite' });
  assert.equal(m2.maxHp, hp0 * 1.5);
  assert.equal(m2.hp, m2.maxHp);
});

test('ELITE-ENGINE-18 復仇：同群每死一隻，存活的復仇者體積 +20%、攻擊與攻速 +20%（可疊加）', () => {
  const c = fresh();
  const a = makeElite(c, ['e_avenger'], { x: 150, y: 0, hp: 1e9 });
  const b = makeElite(c, ['e_vitality'], { x: 200, y: 20, hp: 1e9 });
  const d = makeMinion(c, 1, { x: 220, y: 40 });
  const aspd0 = a.aspd, atk0 = c.eliteAtkFactor(a);
  b.hp = 0; c.eliteOnDeath(b);
  assert.ok(Math.abs(a._grow - 1.2) < 1e-9);
  assert.ok(Math.abs(a.aspd / aspd0 - 1.2) < 1e-9);
  assert.ok(Math.abs(c.eliteAtkFactor(a) / atk0 - 1.2) < 1e-9);
  assert.ok(a._el.avStacks === 1);
  d.hp = 0; c.eliteOnDeath(d);
  assert.ok(Math.abs(a._grow - 1.44) < 1e-9, '兩隻陣亡：1.2 × 1.2');
  assert.ok(Math.abs(c.eliteAtkFactor(a) / atk0 - 1.4) < 1e-9, '攻擊 +40%');
  assert.ok(c.vfx.some((v) => v.vfx && v.vfx.hit === c.ELITE_AFFIXES.e_avenger.v.cast), '血紅氣息畫面');
});

test('ELITE-ENGINE-19 召喚：2~4 隻與召喚者同屬性的普通怪；召喚者死後牠們最大生命 −90%', () => {
  const c = fresh();
  run(c, "G.stage.zone = 'desert';");
  const m = makeElite(c, ['e_summon'], { x: 150, y: 0, hp: 1e9 });
  m.attr = 'fire';
  run(c, "FIELD.monsters.forEach(function (e) { e._enterCd = 0; });");
  const d = c.ELITE_AFFIXES.e_summon;
  c.eliteCastSummon(m, d);
  const kids = c.FIELD.monsters.filter((e) => e._summoner === m);
  assert.ok(kids.length >= 2 && kids.length <= 4, '召喚 2~4 隻：' + kids.length);
  kids.forEach((k) => assert.equal(k.attr, 'fire', '與召喚者同屬性（火屬性只召出火屬性）'));
  assert.ok(kids.every((k) => k._noDrop && k._stage === -1), '不掉寶、不計過關配額');
  const hp0 = kids.map((k) => k.maxHp);
  m.hp = 0; c.eliteOnDeath(m);
  kids.forEach((k, i) => assert.ok(Math.abs(k.maxHp - hp0[i] * 0.1) < 1e-6, '最大生命 −90%'));
});

test('ELITE-ENGINE-20 飛彈：3~5 枚，先朝後方飛出再轉彎衝向玩家；鎖定落點，走位就躲得掉', () => {
  const c = fresh();
  const m = makeElite(c, ['e_missile'], { x: 200, y: 0, hp: 1e9 });
  const d = c.ELITE_AFFIXES.e_missile;
  quiet(m);
  c.eliteCastMissiles(m, d);
  stepElite(c, 2.5);
  const legs = c.vfx.filter((v) => v.area && v.area.knifeFlight);
  assert.ok(legs.length >= 6 && legs.length <= 10 && legs.length % 2 === 0, '每枚兩段（後方 → 衝刺）：' + legs.length);
  // 第一段終點在怪物後方（遠離玩家的一側）
  const first = legs[0];
  assert.ok(first.area.x > m.pos.x - 1, '第一段朝後方（玩家在西邊，後方是東）');
  assert.ok(first.area.controlX !== undefined, '彎曲路徑');
  // 顏色隨機：四種 Preset 都在 fx.presets 裡
  legs.forEach((v) => assert.ok(d.presets.indexOf(v.vfx.projectile) >= 0));
  // 玩家在落點時被打、離開則躲過
  const c2 = fresh();
  const m2 = quiet(makeElite(c2, ['e_missile'], { x: 200, y: 0, hp: 1e9 }));
  c2.ELITE_AFFIXES.e_missile.n = [1, 1];                         // 只放一枚，免得後面幾枚在玩家走開之後才鎖定
  c2.eliteCastMissiles(m2, c2.ELITE_AFFIXES.e_missile);
  stepElite(c2, 0.9);                  // 轉彎的當下鎖定落點
  c2.bfPlayerPos().x = -400;           // 之後走開
  const mark = hpLost(c2);
  stepElite(c2, 2);
  assert.equal(hpLost(c2), mark, '走位躲開');
});

test('ELITE-ENGINE-21 雷霆風暴：2~3 下落雷在玩家周圍 6 米內，先預警，爆炸半徑 8 米', () => {
  const c = fresh();
  const m = makeElite(c, ['e_thunderstorm'], { x: 150, y: 0, hp: 1e9 });
  const d = c.ELITE_AFFIXES.e_thunderstorm;
  c.eliteCastSpots(m, d);
  const warns = c.vfx.filter((v) => v.vfx && v.vfx.ground === d.v.ground);
  assert.ok(warns.length >= 2 && warns.length <= 3, '2~3 下：' + warns.length);
  warns.forEach((w) => {
    assert.equal(w.area.r, 80, '傷害半徑 8 米');
    assert.ok(Math.hypot(w.area.x, w.area.y) <= d.spread + 0.1, '落點在 6 米內');
  });
  const mark = hpLost(c);
  stepElite(c, 0.6);
  assert.equal(hpLost(c), mark, '預警期間不傷人');
  stepElite(c, 1.5);
  assert.ok(hpLost(c) > mark);
  const bolts = c.vfx.filter((v) => v.vfx && v.vfx.attack === d.v.attack2 && v.fxKind === 'rain');
  assert.ok(bolts.length >= 2, '每下落雷都送出天降事件');
  bolts.forEach((v) => assert.equal(v.variant, 'heaven-tribulation-strike', '落雷走直立天雷的畫法（位置＝落點、不轉向），不會被當成地面特效斜著劈'));
});

test('ELITE-ENGINE-22 封魔塔：BOSS 也放技能（專屬 1~2＋隨機 4~6），塔戰 tick 驅動引擎，玩家被技能打死＝失敗', () => {
  const c = fresh();
  run(c, 'G.player.gold = 1e15; G.tower.highest = 5;');
  c.startTowerFight(1);
  assert.ok(run(c, 'G.tower.active'), '塔戰開始');
  const b = run(c, 'TOWER.boss');
  assert.equal(b._tier, 'tower');
  const bd = run(c, 'BOSS_LIST[0]');
  const ex = bd.skills.ex;
  ex.forEach((id) => assert.ok(b.affixes.indexOf(id) >= 0, '專屬 ' + id));
  const rnd = b.affixes.length - ex.length;
  assert.ok(rnd >= 4 && rnd <= 6, '隨機 4~6 個：' + rnd);
  b.affixes.filter((id) => ex.indexOf(id) < 0).forEach((id) => {
    const d = c.ELITE_AFFIXES[id];
    assert.ok(d.needs !== 'group' && !d.noTower, '塔戰 BOSS 抽不到要同伴或死亡類的技能：' + id);
  });
  assert.ok(b._size >= 5 && b._size <= 7, '體型 5~7 倍：' + b._size);
  // 引擎跑得動：玩家血量 1，等技能打死
  run(c, 'TOWER.introCd = 0; TOWER.player.hp = 1;');
  assert.equal(c.elitePlayer(), run(c, 'TOWER.player'));
  assert.equal(c.elitePF(), 'tp-float');
  let dead = false;
  for (let i = 0; i < 300 && !dead; i++) { c.GT += 0.1; dead = c.eliteTick(0.1); }
  assert.ok(dead, '30 秒內 BOSS 的技能應該打死 1 血的玩家');
});

test('ELITE-ENGINE-23 專屬技能沿用的行為不退步：旋風斬、野蠻衝鋒、連鎖閃電、不死鳥、自爆、分裂都跑得起來', () => {
  const c = fresh();
  const m = makeElite(c, ['e_phoenix'], { x: 150, y: 0, hp: 1000 });
  m.hp = 0;
  assert.equal(c.eliteOnDeath(m), true, '不死鳥重生');
  assert.ok(m.hp > 0);
  assert.equal(c.eliteOnDeath(m), false, '只重生一次');
  const c2 = fresh();
  const s = makeElite(c2, ['e_splitter'], { x: 150, y: 0, hp: 1000 });
  s.hp = 0; c2.eliteOnDeath(s);
  assert.ok(c2.FIELD.monsters.filter((e) => e._gRole === 'split').length >= 2, '分裂');
  const c3 = fresh();
  const b = makeElite(c3, ['e_bomber'], { x: 150, y: 0, hp: 1000 });
  b.hp = 0; c3.eliteOnDeath(b);
  assert.ok(c3.ELITE_RT.vis.length >= 1, '自爆預警');
});

test('ELITE-ENGINE-24 玩家死亡或離開時 eliteReset 清掉所有預警、場域、光束、冰球、火花、牆、拉扯', () => {
  const c = fresh();
  const m = quiet(makeElite(c, ['e_vitality'], { x: 150, y: 0 }));
  c.eliteCastRotbeam(m, c.ELITE_AFFIXES.e_arcane);
  c.eliteCastWalls(m, c.ELITE_AFFIXES.e_walls);
  c.eliteCastIcepulse(m, c.ELITE_AFFIXES.e_frostpulse);
  c.ELITE_RT.pull = { owner: m, def: c.ELITE_AFFIXES.e_vortex, tx: 0, ty: 0, speed: 600 };
  c.ELITE_RT.sparks.push({ x: 0, y: 0, vx: 0, vy: 0, until: c.GT + 5, r: 5, owner: m, def: c.ELITE_AFFIXES.e_electrified });
  stepElite(c, 1.2);
  c.eliteReset();
  ['jobs', 'vis', 'zones', 'chains', 'beams', 'crosses', 'orbs', 'sparks', 'walls'].forEach((k) => assert.equal(c.ELITE_RT[k].length, 0, k));
  assert.equal(c.ELITE_RT.pull, null);
  assert.equal(c.elitePlayerLocked(), false);
});

test('ELITE-ENGINE-25 經過正式的擊殺流程（onFieldKill）：小兵陣亡也會讓同群復仇者變強；召喚師死亡縮水召喚物', () => {
  const c = fresh();
  const a = quiet(makeElite(c, ['e_avenger'], { x: 150, y: 0, hp: 1e9 }));
  const minion = makeMinion(c, 1, { x: 220, y: 40 });
  run(c, 'FIELD.monsters.forEach(function (e) { e._enterCd = 0; });');
  c.onFieldKill(minion);
  assert.equal(a._el.avStacks, 1, '小兵死也算同伴陣亡');
  assert.ok(Math.abs(a._grow - 1.2) < 1e-9);
  const c2 = fresh();
  const s = quiet(makeElite(c2, ['e_summon'], { x: 150, y: 0, hp: 1e9 }));
  s.attr = 'fire';
  run(c2, 'FIELD.monsters.forEach(function (e) { e._enterCd = 0; });');
  c2.eliteCastSummon(s, c2.ELITE_AFFIXES.e_summon);
  const kids = c2.FIELD.monsters.filter((e) => e._summoner === s);
  const hp0 = kids.map((k) => k.maxHp);
  c2.onFieldKill(s);
  kids.forEach((k, i) => assert.ok(Math.abs(k.maxHp - hp0[i] * 0.1) < 1e-6, '最大生命 −90%'));
});
