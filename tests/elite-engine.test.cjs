'use strict';
/* ============================================================
   elite-engine.test.cjs — 菁英詞條引擎（js/elite.js）的行為

   每一條都驗「規則」而不是畫面：預警先於傷害、離開範圍就不受傷、護盾／無敵／鏈結怎麼改傷害、
   死亡時的重生／自爆／分裂、各種上限。特效由 elite-data.test.cjs 驗 preset 接線，
   實際長相靠實機（見 docs/AI_TASKS.md 的驗證紀錄）。
   ============================================================ */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadEliteEnv, makeElite, makeMinion, stepElite } = require('./helpers/elite-env.cjs');

function run(c, code) { return vm.runInContext(code, c); }
/* 玩家血量墊高，吃傷但不死；回傳量測用的玩家。 */
function tank(c) {
  const p = c.FIELD.player;
  p.hp = 1e12;
  return p;
}
function playerHit(c, m, mult) {
  const p = c.FIELD.player;
  return c.resolveHit(p, m, Object.assign(c.playerAtkCfg(p), { atk: (mult || 1000), matk: (mult || 1000), critRate: 0, hit: 1e6 }), c.monsterDefCfg(m));
}
function cast(c, m, id) {
  m._el.busyUntil = 0;
  c.eliteCast(m, c.ELITE_AFFIXES[id], id);
  m._el.cd[id] = 1e9;          // 手動施放一次，之後不讓它自己再開
}
function eventsOf(c, variant) { return c.vfx.filter((e) => e.variant === variant); }

test('ELITE-ENGINE-1 範圍落點：先出預警、倒數完才爆；人離開落點就不受傷', () => {
  const c = loadEliteEnv({ stage: 60 });
  const p = tank(c);
  const m = makeElite(c, ['moltenblast']);
  const d = c.ELITE_AFFIXES.moltenblast;
  cast(c, m, 'moltenblast');
  assert.ok(eventsOf(c, 'elite-ground').some((e) => e.vfx.ground === d.warnPreset), '一施放就要出預警圈');
  const hp0 = p.hp;
  stepElite(c, d.warn - 0.3);
  assert.equal(p.hp, hp0, '倒數還沒完，不該受傷');
  assert.equal(eventsOf(c, 'elite-burst').length, 0, '倒數還沒完，不該爆');
  stepElite(c, 0.8);
  assert.ok(eventsOf(c, 'elite-burst').length >= 1, '倒數完要爆');
  assert.ok(p.hp < hp0, '站在圈裡要受傷');

  // 第二次：倒數期間走出圈外
  const c2 = loadEliteEnv({ stage: 60 });
  const p2 = tank(c2);
  const m2 = makeElite(c2, ['moltenblast']);
  cast(c2, m2, 'moltenblast');
  const hp2 = p2.hp;
  stepElite(c2, 0.5);
  c2.bfPlayerPos().x += d.r + 200;
  stepElite(c2, d.warn + 1);
  assert.equal(p2.hp, hp2, '走出圈外就不該受傷');
  assert.ok(eventsOf(c2, 'elite-burst').length >= 1, '特效照樣爆（空爆）');
});

test('ELITE-ENGINE-2 隕石雨：第一發落在腳下，每顆都有預警與落體，爆炸時才結算', () => {
  const c = loadEliteEnv({ stage: 60 });
  const p = tank(c);
  const m = makeElite(c, ['meteor']);
  const d = c.ELITE_AFFIXES.meteor;
  cast(c, m, 'meteor');
  const warns = eventsOf(c, 'elite-ground').filter((e) => e.vfx.ground === d.warnPreset);
  assert.equal(warns.length, d.n, '每顆隕石一個預警圈');
  assert.equal(eventsOf(c, 'elite-rain').length, d.n, '每顆隕石一個落體');
  assert.ok(eventsOf(c, 'elite-rain').every((e) => e.lineWidth === d.bodyD && e.area.fixedLanding === true));
  const hp0 = p.hp;
  stepElite(c, d.warn - 0.2);
  assert.equal(p.hp, hp0);
  stepElite(c, 0.6);
  assert.ok(p.hp < hp0, '第一發落在腳下，要吃到傷害');
  assert.ok(p.dots.some((x) => x.sid === 'burn'), '隕石附帶燃燒');
});

test('ELITE-ENGINE-3 持續場域：在裡面每拍扣血，出去就停，時間到就消失', () => {
  const c = loadEliteEnv({ stage: 60 });
  const p = tank(c);
  const m = makeElite(c, ['plaguecloud']);
  const d = c.ELITE_AFFIXES.plaguecloud;
  cast(c, m, 'plaguecloud');
  stepElite(c, d.warn + 0.2);
  assert.equal(c.ELITE_RT.zones.length, 1, '預警結束後場域成形');
  const hp0 = p.hp;
  stepElite(c, 2);
  assert.ok(p.hp < hp0, '站在場域裡持續受傷');
  const hp1 = p.hp;
  c.bfPlayerPos().x += 1000;
  c.FIELD.player.dots = [];
  stepElite(c, 2);
  assert.equal(p.hp, hp1, '走出場域就不再受傷');
  stepElite(c, d.life + 1);
  assert.equal(c.ELITE_RT.zones.length, 0, '場域到期消失');
});

test('ELITE-ENGINE-4 長條場域（火牆）以旋轉矩形判定：牆上受傷、牆外不受傷', () => {
  const c = loadEliteEnv({ stage: 60 });
  const p = tank(c);
  const m = makeElite(c, ['firewall'], { x: 300, y: 0 });
  const d = c.ELITE_AFFIXES.firewall;
  cast(c, m, 'firewall');
  stepElite(c, d.warn + 0.2);
  const z = c.ELITE_RT.zones[0];
  assert.ok(z && z.w > 0 && z.h > 0);
  assert.ok(c.eliteInRect(z.x, z.y, z.w, z.h, z.a), '牆生在你的位置，你在牆上');
  // 沿牆軸向走出牆端 → 不在矩形內
  const pp = c.bfPlayerPos();
  pp.x += Math.cos(z.a) * (z.w / 2 + 120); pp.y += Math.sin(z.a) * (z.w / 2 + 120);
  assert.ok(!c.eliteInRect(z.x, z.y, z.w, z.h, z.a), '走出牆端就不在判定內');
  const hp0 = p.hp;
  p.dots = [];
  stepElite(c, 1.5);
  assert.equal(p.hp, hp0);
});

test('ELITE-ENGINE-5 彈體：逐發送出，抵達時以落點判定；人移開就落空', () => {
  const c = loadEliteEnv({ stage: 60 });
  const p = tank(c);
  const m = makeElite(c, ['darkorbs']);
  const d = c.ELITE_AFFIXES.darkorbs;
  cast(c, m, 'darkorbs');
  stepElite(c, 0.4 + d.n * d.gap);
  const projs = eventsOf(c, 'elite-proj');
  assert.ok(projs.length >= 1 && projs.length <= d.n);
  assert.ok(projs.every((e) => e.sourceId === m.floatSel && e.targets[0] === 'pv-float' && e.lineWidth === d.bodyD));
  stepElite(c, d.travel + 0.5);
  assert.equal(eventsOf(c, 'elite-proj').length, d.n, '全部送出');

  const c2 = loadEliteEnv({ stage: 60 });
  const p2 = tank(c2);
  const m2 = makeElite(c2, ['darkorbs']);
  cast(c2, m2, 'darkorbs');
  stepElite(c2, 0.35 + (d.n - 1) * d.gap + 0.05);     // 最後一發剛送出
  assert.equal(eventsOf(c2, 'elite-proj').length, d.n);
  c2.bfPlayerPos().x += 600;                           // 彈體飛行期間走開
  const hp2 = p2.hp;
  stepElite(c2, d.travel + 1);
  assert.equal(p2.hp, hp2, '玩家早已離開彈體落點，不受傷');
});

test('ELITE-ENGINE-6 光束：預警沿路徑鋪圈，沿線上的人受傷、線外的人沒事', () => {
  const run1 = (offsetY) => {
    const c = loadEliteEnv({ stage: 60 });
    const p = tank(c);
    const m = makeElite(c, ['arcanebeam'], { x: 260, y: 0 });
    const d = c.ELITE_AFFIXES.arcanebeam;
    cast(c, m, 'arcanebeam');
    const rings = eventsOf(c, 'elite-ground').filter((e) => e.vfx.ground === d.warnPreset);
    assert.ok(rings.length >= 2, '路徑上有一排預警圈');
    c.bfPlayerPos().y += offsetY;
    const hp0 = p.hp;
    stepElite(c, d.warn + 0.8);
    assert.ok(eventsOf(c, 'elite-beam').length === 1);
    return hp0 - p.hp;
  };
  assert.ok(run1(0) > 0, '光束沿線打到人');
  assert.equal(run1(400), 0, '站在線外不受傷');
});

test('ELITE-ENGINE-7 無敵、護盾、巨像：吃到的傷害被改寫', () => {
  const c = loadEliteEnv({ stage: 60 });
  tank(c);
  const m = makeElite(c, ['invulnaura'], { hp: 1e9 });
  makeElite(c, [], { x: 300 });          // 庇護光環要有同伴才會施放
  const d = c.ELITE_AFFIXES.invulnaura;
  const before = m.hp;
  playerHit(c, m);
  assert.ok(m.hp < before, '沒有無敵時照常受傷');
  cast(c, m, 'invulnaura');
  const hpInv = m.hp;
  playerHit(c, m);
  assert.equal(m.hp, hpInv, '無敵期間不掉血');
  c.GT += d.dur + 0.1;
  playerHit(c, m);
  assert.ok(m.hp < hpInv, '無敵結束後恢復受傷');

  const c2 = loadEliteEnv({ stage: 60 });
  tank(c2);
  const s = makeElite(c2, ['shield'], { hp: 1e9 });
  cast(c2, s, 'shield');
  assert.ok(s.shield > 0, '施放後有護盾');
  const sh0 = s.shield, hp0 = s.hp;
  playerHit(c2, s, 1);
  assert.ok(s.shield < sh0 || s.hp === hp0, '傷害先吃護盾');

  const c3 = loadEliteEnv({ stage: 60 });
  tank(c3);
  const gd = c3.ELITE_AFFIXES.giant;
  const plain0 = makeElite(c3, []);
  const giant0 = makeElite(c3, ['giant']);
  assert.ok(Math.abs(giant0.maxHp / plain0.maxHp - gd.hp) < 0.6 * gd.hp, '巨像生命倍率（同一階不同 NPC 倍率，只看量級）');
  assert.equal(giant0._visScale, gd.scale);
  const plain = makeElite(c3, [], { hp: 1e9 });
  const giant = makeElite(c3, ['giant'], { hp: 1e9 });
  const p0 = plain.hp, g0 = giant.hp;
  c3.Math.random = () => 0.5;
  playerHit(c3, plain, 5000);
  playerHit(c3, giant, 5000);
  const lossPlain = p0 - plain.hp, lossGiant = g0 - giant.hp;
  assert.ok(lossGiant < lossPlain, '巨像受到的傷害較少');
  assert.ok(Math.abs(lossGiant / lossPlain - (1 - gd.red / 100)) < 0.02, '減傷比例照表');
});

test('ELITE-ENGINE-8 生命鏈結：傷害在鏈結成員間分攤，總量不變；沒有夥伴就不減傷', () => {
  const c = loadEliteEnv({ stage: 60 });
  tank(c);
  const a = makeElite(c, ['lifelink'], { hp: 1e9, gid: 7 });
  const b = makeElite(c, ['lifelink'], { hp: 1e9, gid: 7, x: 300 });
  const x = makeElite(c, ['lifelink'], { hp: 1e9, gid: 8, x: 340 });   // 別群：不分攤
  c.Math.random = () => 0.5;
  const sum0 = a.hp + b.hp;
  playerHit(c, a, 5000);
  const lossA = 1e9 - a.hp, lossB = 1e9 - b.hp;
  assert.ok(lossA > 0 && lossB > 0, '兩隻都受傷');
  assert.equal(x.hp, 1e9, '別群不受影響');
  const share = c.ELITE_AFFIXES.lifelink.share / 100;
  assert.ok(Math.abs(lossB / (lossA + lossB) - share) < 0.02, '分攤比例照表');
  // 只剩一隻 → 不減傷
  b.hp = 0;
  const lone = a.hp;
  playerHit(c, a, 5000);
  const loneLoss = lone - a.hp;
  assert.ok(loneLoss > lossA + lossB - 5 && loneLoss < lossA + lossB + 5, '沒有夥伴時吃全額傷害');
  assert.ok(sum0 > 0);
});

test('ELITE-ENGINE-9 鏈結分攤把夥伴打到 0 血時，下一個 tick 補結算死亡', () => {
  const c = loadEliteEnv({ stage: 60 });
  tank(c);
  const a = makeElite(c, ['lifelink'], { hp: 1e9, gid: 7 });
  const b = makeElite(c, ['lifelink'], { hp: 10, gid: 7, x: 300 });
  playerHit(c, a, 50000);
  assert.ok(b.hp <= 0, '夥伴被分攤打死');
  assert.ok(!b._rewarded, '還沒結算');
  stepElite(c, 0.2);
  assert.ok(b._rewarded, 'eliteTick 補上 onFieldKill');
});

test('ELITE-ENGINE-10 不死鳥只重生一次，重生那一刻不給獎勵；自爆倒數後才炸；分裂體不計配額不掉寶', () => {
  const c = loadEliteEnv({ stage: 60 });
  tank(c);
  const gold0 = c.G.player.gold;
  const ph = makeElite(c, ['phoenix'], { hp: 1000 });
  ph.hp = 0;
  c.onFieldKill(ph);
  assert.ok(ph.hp > 0 && !ph._rewarded, '第一次死亡：重生');
  assert.equal(c.G.player.gold, gold0, '重生不給獎勵');
  assert.ok(ph._el.invulnUntil > c.GT, '重生後短暫無敵');
  ph.hp = 0;
  c.onFieldKill(ph);
  assert.ok(ph._rewarded && ph.hp === 0, '第二次死亡：真的死');

  const b = loadEliteEnv({ stage: 60 });
  const pb = tank(b);
  const bomber = makeElite(b, ['bomber'], { hp: 100, x: 30 });
  const d = b.ELITE_AFFIXES.bomber;
  bomber.hp = 0;
  b.onFieldKill(bomber);
  const hp0 = pb.hp;
  stepElite(b, d.delay - 0.4);
  assert.equal(pb.hp, hp0, '倒數中不爆');
  stepElite(b, 0.8);
  assert.ok(pb.hp < hp0, '倒數完炸到站在圈裡的人');
  assert.ok(b.vfx.some((e) => e.variant === 'elite-burst'));

  const s = loadEliteEnv({ stage: 60 });
  tank(s);
  const sp = makeElite(s, ['splitter'], { hp: 1000 });
  const before = s.FIELD.monsters.length;
  sp.hp = 0;
  s.onFieldKill(sp);
  const kids = s.FIELD.monsters.slice(before);
  assert.equal(kids.length, s.ELITE_AFFIXES.splitter.n);
  kids.forEach((k) => {
    assert.equal(k._stage, -1, '不計入過關配額');
    assert.equal(k._noDrop, true);
    assert.equal(k.elite, false);
    assert.ok(k.maxHp < sp.maxHp);
  });
  assert.deepEqual(Array.from(s.rollFieldDrops(kids[0])), [], '分裂體不掉寶');
});

test('ELITE-ENGINE-11 召喚師：每次生 n 隻，終生上限由參數決定，達上限就不再施放', () => {
  const c = loadEliteEnv({ stage: 60 });
  tank(c);
  run(c, 'ELITE_GROUP.summonCap = 3;');
  const m = makeElite(c, ['summoner']);
  const d = c.ELITE_AFFIXES.summoner;
  assert.ok(c.eliteCanCast(m, d));
  cast(c, m, 'summoner');
  assert.equal(m._el.summoned, Math.min(d.n, 3));
  cast(c, m, 'summoner');
  assert.equal(m._el.summoned, 3, '不超過上限');
  assert.ok(!c.eliteCanCast(m, d), '達上限不再施放');
  const kids = c.FIELD.monsters.filter((e) => e._gRole === 'summon');
  assert.equal(kids.length, 3);
  kids.forEach((k) => assert.ok(k._stage === -1 && k._noDrop && k._gid === m._gid));
});

test('ELITE-ENGINE-12 嗜血回血、擊飛推開玩家、荊棘與反射只反彈玩家的直接攻擊', () => {
  const c = loadEliteEnv({ stage: 60 });
  const p = tank(c);
  const v = makeElite(c, ['vampiric'], { hp: 1e6 });
  v.hp = 1000;
  c.eliteOnAttackHit(v, p, { miss: false, invuln: false }, 5000);
  assert.ok(v.hp > 1000, '吸血回復');
  assert.ok(c.vfx.some((e) => e.variant === 'elite-drain'), '吸血要有光球飛回來');

  const k = makeElite(c, ['knockback'], { x: 100 });
  run(c, 'chance = function () { return true; };');
  const before = c.bfPlayerPos().x;
  c.eliteOnAttackHit(k, p, { miss: false, invuln: false }, 100);
  assert.ok(c.bfPlayerPos().x < before, '被往遠離敵人的方向推開');

  const t = makeElite(c, ['thorns'], { hp: 1e12 });
  const hp0 = p.hp;
  playerHit(c, t, 5000);
  assert.ok(p.hp < hp0, '直接攻擊會吃到荊棘');
  const hp1 = p.hp;
  c.applyEnemyHpDamage(t, 99999, 1);        // 持續傷害／衍生傷害：attacker 為 null，不反彈
  assert.equal(p.hp, hp1);
});

test('ELITE-ENGINE-13 狂暴：血量降到門檻才觸發，只觸發一次，攻擊與攻速提高', () => {
  const c = loadEliteEnv({ stage: 60 });
  tank(c);
  const m = makeElite(c, ['enrage'], { hp: 1e9 });
  const d = c.ELITE_AFFIXES.enrage;
  const aspd0 = m.aspd;
  const atk0 = c.monsterAtkCfg(m, 1).atk;
  c.Math.random = () => 0.5;
  playerHit(c, m, 1);
  assert.ok(!m._el.enraged, '血量還高不狂暴');
  // 先量一擊的傷害，再把血量擺在「這一擊會剛好跨過門檻」的位置
  const probe = playerHit(c, m, 5e7).dmg;
  m.hp = m.maxHp * d.hpPct / 100 + probe * 0.5;
  m._el.enraged = false;
  playerHit(c, m, 5e7);
  assert.ok(m._el.enraged, '低於門檻狂暴');
  assert.equal(m.aspd, aspd0 * d.aspd);
  assert.ok(Math.abs(c.monsterAtkCfg(m, 1).atk / atk0 - d.atk) < 1e-9, '攻擊倍率');
  m.hp = m.maxHp * 0.1;
  playerHit(c, m, 1);
  assert.equal(m.aspd, aspd0 * d.aspd, '不會重複疊');
});

test('ELITE-ENGINE-14 衰弱詛咒真的降低我方輸出與防禦；吸魔扣玩家法力、回補自身', () => {
  const c = loadEliteEnv({ stage: 60 });
  const p = tank(c);
  const atk0 = c.playerAtkCfg(p).atk, def0 = c.playerDefCfg(p).def;
  const m = makeElite(c, ['curse', 'manadrain'], { hp: 1e6 });
  cast(c, m, 'curse');
  stepElite(c, 0.6);
  assert.ok(c.buffVal(p, 'atkDown') > 0, '有詛咒狀態');
  assert.ok(c.playerAtkCfg(p).atk < atk0, '輸出降低');
  assert.ok(c.playerDefCfg(p).def < def0, '防禦降低');
  const d = c.ELITE_AFFIXES.curse;
  c.GT += d.dur + 1;
  assert.equal(c.playerAtkCfg(p).atk, atk0, '詛咒過期後恢復');

  p.mp = 1000;
  m.hp = 100;
  cast(c, m, 'manadrain');
  stepElite(c, 0.6);
  assert.ok(p.mp < 1000, '法力被抽走');
  assert.ok(m.hp > 100, '自身回復');
});

test('ELITE-ENGINE-15 eliteReset 清掉所有延遲事件、預警與場域；玩家死亡時自動重置', () => {
  const c = loadEliteEnv({ stage: 60 });
  tank(c);
  const m = makeElite(c, ['meteor']);
  cast(c, m, 'meteor');
  assert.ok(c.ELITE_RT.jobs.length > 0 && c.ELITE_RT.vis.length > 0);
  c.eliteReset();
  assert.equal(c.ELITE_RT.jobs.length + c.ELITE_RT.vis.length + c.ELITE_RT.zones.length, 0);

  // 玩家被技能打死：eliteTick 回 true、onPlayerFieldDeath 被呼叫（進入復活倒數）並順手重置
  const d = loadEliteEnv({ stage: 60 });
  const p = d.FIELD.player;
  p.hp = 1;
  const boss = makeElite(d, ['moltenblast']);
  cast(d, boss, 'moltenblast');
  const died = stepElite(d, d.ELITE_AFFIXES.moltenblast.warn + 1);
  assert.equal(died, true);
  assert.ok(d.FIELD.reviveCd > 0, '進入復活倒數');
  assert.equal(d.ELITE_RT.jobs.length, 0, '死亡後延遲事件清空');
});

test('ELITE-ENGINE-16 施法期間原地不動不普攻（詞條鎖）、被暈眩時不施放', () => {
  const c = loadEliteEnv({ stage: 60 });
  tank(c);
  const m = makeElite(c, ['quake']);
  cast(c, m, 'quake');
  assert.ok(c.eliteLocked(m), '自身為中心的技能施放中鎖住牠');
  const pos0 = { x: m.pos.x, y: m.pos.y };
  c.bfTickApproach(c.FIELD.monsters, 1);
  assert.deepEqual({ x: m.pos.x, y: m.pos.y }, pos0, '鎖住時不逼近');
  assert.equal(c.fieldMonsterAttack(m, c.FIELD.player), false, '鎖住時不普攻');

  const s = loadEliteEnv({ stage: 60 });
  tank(s);
  const st = makeElite(s, ['meteor']);
  st._el.cd.meteor = 0;
  s.applyEffect(st, 'stun', 5);
  stepElite(s, 1);
  assert.equal(s.vfx.filter((e) => e.variant === 'elite-rain').length, 0, '暈眩中不施放');
});

test('ELITE-ENGINE-17 同一個 tick 最多開 3 個新技能；同一隻施法忙碌中不會疊技能', () => {
  const c = loadEliteEnv({ stage: 60 });
  tank(c);
  const ms = [];
  for (let i = 0; i < 6; i++) ms.push(makeElite(c, ['shield', 'darkorbs'], { x: 200 + i * 5, y: i * 3 }));
  ms.forEach((m) => { m.shield = 0; m._el.cd.shield = 0; m._el.cd.darkorbs = 0; });
  c.GT += 0.1;
  c.eliteTick(0.1);
  const casts = c.floats.filter((f) => f.cls === 'elite-cast').length;
  assert.ok(casts <= 3, '單一 tick 的新施放數 ' + casts);
  const one = loadEliteEnv({ stage: 60 });
  tank(one);
  const m = makeElite(one, ['shield', 'darkorbs']);
  m._el.cd.shield = 0; m._el.cd.darkorbs = 0;
  one.GT += 0.1;
  one.eliteTick(0.1);
  assert.equal(one.floats.filter((f) => f.cls === 'elite-cast').length, 1, '同一隻一次只開一個技能');
});

test('ELITE-ENGINE-18 整合：真的跑 fieldTick（出怪、施放、結算）幾分鐘，不丟例外、狀態自洽', () => {
  const c = loadEliteEnv({ stage: 30 });
  const p = c.FIELD.player;
  p.hp = p.mp = 1e12;
  run(c, 'eliteNormalChanceFor = function () { return 100; };');
  let casts = 0;
  const originalCast = c.eliteCast;
  c.eliteCast = function () { casts++; return originalCast.apply(this, arguments); };
  for (let i = 0; i < 600; i++) {
    c.GT += 0.1;
    c.fieldTick(0.1);
    if (c.FIELD.reviveCd > 0) { c.FIELD.reviveCd = 0; c.FIELD.player.hp = 1e12; }
    p.hp = Math.max(p.hp, 1e12);
  }
  assert.equal(c.ELITE_RT.errors, 0, '詞條引擎丟過例外');
  assert.ok(c.FIELD.monsters.length > 0);
  assert.ok(casts > 5, '應該有施放過技能，實際 ' + casts);
  assert.ok(c.FIELD.monsters.every((e) => !e.affixes || (e._el && Array.isArray(e._fx))));
  assert.ok(c.ELITE_RT.zones.length <= c.ELITE_GROUP.maxZones, '場域數量不超過上限');
});
