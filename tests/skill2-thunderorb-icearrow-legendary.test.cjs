const table = require('./helpers/skill-table.cjs');
/* 傳奇進化第九批（2026-08-27）：雷球（水晶球）／寒冰箭（魔法書）
   設計來源：使用者提供的 Google 試算表〈傳奇進化〉頁籤的雷球、寒冰箭兩段。
   守住的事：
     1. 雷球五個傳奇：雷核（體積）、超載（場上雷球數 → 雷電傷害）、感電核心（伴生時間）、
        雷殞落（降下顆數）、雷殞震（暈眩秒數改寫至 4 秒）
     2. 雷球三個超神：臨界雷劫（外擴伴生／命中再生／傷害乘區）、雷爆（命中觸發彈射小球）、
        雷殞天地碎（永久節拍不斷降下雷殞石）
     3. 寒冰箭五個傳奇：連射（支數）、冰封（傷害乘區）、凜冬侵蝕（寒霜每跳量與時間）、
        冰裂箭（往前分裂）、深度凍結（控場中增傷）
     4. 寒冰箭三個超神：極寒冰爆（波數與間隔改寫）、無限冰裂（支數＋命中回扣冷卻）、
        冰之淚（跟隨我方的箭雨）

   ⚠️ 本檔只驗「機制有沒有接上」，不驗「數字調校得對不對」（那是參數表的事）。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const M = 10; // 1 米 ＝ 10 個戰場單位（bfMeterPx）

function loadContext() {
  const context = {
    console,
    Math: Object.create(Math),
    setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    UI: { dirty: {} },
    blog() {}, floatText() {}, trackDps() {}, recordRunDamage() {}
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js',
    'js/skills.js', 'js/skills2.js', 'js/legendary.js']
    .forEach((file) => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file }));
  context.G = { player: { gold: 0, skills2: { levels: {}, ult: {} }, loadout: [] }, stage: { current: 1 } };
  context.BASE_STATS = {
    atk: 1000, matk: 500, hp: 1000, mp: 500, level: 10, aspd: 2, cdr: 0,
    critRate: 0, critDmg: 150, hit: 100, tenacity: 0, shieldEff: 0,
    hpRegen: 0, mpRegen: 0, lifesteal: 0, manaSteal: 0,
    passives: {}, elemAtk: null, elemDmgPct: 0, elemDmgUp: {},
    eliteDmg: 0, bossDmg: 0, normalDmg: 0, totalDmgPct: 0, dmgVsElem: null,
    aoeDmg: 0, globalDmgRed: 0, legendaryEffects: {}, legendaryEffectMults: {}
  };
  context.getStats = () => context.BASE_STATS;
  context.GT = 0;
  context.markSkillReady = () => {};
  return context;
}

function enemy(hp, x, y, name) {
  return {
    name: name || '測試怪', maxHp: hp, hp, def: 0, mdef: 0, level: 1,
    effects: {}, buffs: {}, dots: [], resist: {}, ctrlRes: 0,
    elite: false, isBoss: false,
    pos: (x === undefined) ? undefined : { x, y }
  };
}
function playerEnt() {
  return { hp: 1000, mp: 500, shield: 0, shieldMax: 0, skillCds: {}, buffs: {}, dots: [], effects: {}, _lockTarget: null };
}
/* 命中紀錄：resolveHit 是所有「一次攻擊」的唯一出口，因此數這裡就等於數命中。 */
function stubHits(c) {
  const calls = [];
  c.resolveHit = function (attacker, defender, aCfg) {
    calls.push({ ent: defender, atk: aCfg.atk, total: aCfg.totalDmgPct || 0, elem: aCfg.skillElem });
    return { dmg: 100, crit: false, miss: false, blocked: false, killed: false };
  };
  c.applySkillFinalDamageMultiplier = function () {};
  return calls;
}
function stubVfx(c) {
  const specs = [];
  c.playCombatVfx = (spec) => specs.push(spec);
  c.enemyEventFloatTarget = (ent) => ent.name;
  c.playerEventFloatTarget = (sel) => sel;
  c.floatEnemyEvent = () => {};
  c.floatPlayerEvent = () => {};
  return specs;
}
function tickCtx(c, p, enemies) {
  return { pEnt: p, getEnemies: () => enemies, floatSel: 'mv-float', onDeaths() {}, onDamage() {} };
}
function advance(c, p, enemies, seconds, step) {
  const dt = step || 0.05;
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    c.GT = +(c.GT + dt).toFixed(4);
    c.tickSkill2(dt, tickCtx(c, p, enemies));
  }
}
function setLevels(c, gid, levels) { c.G.player.skills2.levels[gid] = levels.slice(); }
function maxLevels(c, gid) { setLevels(c, gid, [10, 10, 10, 10, 10, 10, 10]); }
function equip(c, gid) { c.G.player.loadout = [c.SG_PREFIX + gid]; }
function setUlt(c, gid, id, lv) {
  c.G.player.skills2.ult[gid] = { pick: c.sgUltIndexOfId(gid, id), lv: lv === undefined ? 1 : lv };
}
function setLegendary(c, keys) {
  const on = {};
  (keys || []).forEach((k) => { on[k] = true; });
  c.BASE_STATS = Object.assign({}, c.BASE_STATS, { legendaryEffects: on, legendaryEffectMults: {} });
}
function orbFields(c) {
  return c.SKILL2_RT.grounds.filter((f) => f.gid === 'thunderorb' && f.kind === 'orb');
}
function line(n, gap, start) {
  const es = [];
  for (let i = 0; i < n; i++) es.push(enemy(1e9, (start || 30) + i * gap, 0, 'e' + i));
  return es;
}

test('THUNDER-ORB-PATHS 正式滿階／雷爆事件繼承的雷球在每條路徑都以球心投影', () => {
  const Core = require('../js/vfx-core.js'), Runtime = require('../js/vfx-runtime.js');
  for (const ult of [false, true]) {
    const c = loadContext(), events = stubVfx(c); stubHits(c); maxLevels(c, 'thunderorb');
    if (ult) setUlt(c, 'thunderorb', 'thunderBurst');
    c.chance = () => true; c.bfPlayerPos = () => ({ x: 0, y: 0 });
    const p = playerEnt(), es = [enemy(1e9, 180, -80, 'a'), enemy(1e9, -200, 60, 'b')];
    c.castSkill2(p, es, 'thunderorb', 'mv-float'); advance(c, p, es, 2);
    assert.ok(events.some(e => e.variant === 'thunder-fall' && e.vfx.projectile), '天落只使用已配置觸發飛行物');
    const ids = [...new Set(events.flatMap(e => Object.values(e.vfx || {})))];
    const presets = ids.map(id => JSON.parse(fs.readFileSync(path.join(root, 'vfx/presets', id + '.json'), 'utf8')));
    // 雷殞衝擊也用 circle_b 貼圖；為 NullBackend 的素材引用加 Preset 前綴以辨識來源，幾何不變。
    presets.forEach(p => p.layers.forEach(l => { if (l.assetId) l.assetId = p.id + '/' + l.assetId; }));
    const records = [], resolver = { has: () => true, resolve: id => id };
    function backend(tag) { return { createNode(spec) { return { tag, spec }; },
      updateNode(n, t) { if (t && t.visible !== false) records.push(n); }, destroyNode() {}, destroy() {} }; }
    const adapter = Runtime.create({ core: Core, resolver, groundScale: .5,
      fxBackend: backend('fx'), zoneBackend: backend('zone'), airBackend: backend('air'), billboardBackend: backend('billboard'),
      ctx: { posOf: id => { const e = es.find(e => e.name === id); return e ? { ...e.pos, y: e.pos.y * .5 } : { x: 0, y: 0 }; },
        playerPos: () => ({ x: 0, y: 0 }) } });
    adapter.registerPresets(presets);
    // 逐則隔離播放，不能只看一般 thunder-orb 分支；漏掉天落事件就是少數球仍扭曲。
    for (const event of events.filter(e => ['thunder-orb', 'thunder-orbit', 'thunder-fall'].includes(e.variant))) {
      records.length = 0; adapter.tryPlay(event);
      for (let frame = 0; frame < Math.ceil((event.delayMs || 0) / 10) + 4; frame++) adapter.update(.01);
      const spheres = records.filter(n => n.spec.assetUrl.startsWith('lightning-orb-field/'));
      if (event.variant === 'thunder-fall') {
        assert.equal(spheres.length, 0, '天落不可另播普通雷球本體');
        assert.equal(event.vfx.field, undefined);
        assert.ok(records.some(n => n.spec.assetUrl.startsWith(event.vfx.projectile + '/') && n.tag === 'billboard'));
      } else assert.ok(spheres.length, event.variant + ' 的正式繼承雷球');
      assert.ok(spheres.every(n => n.tag === 'billboard'), event.variant + ' 不能經場景 FOV');
      adapter.clear();
    }
    // 真配置的飛行、預警與落地衝擊全部播過後，自然回收，不能靠 clear 掩蓋殘留。
    for (const event of events.filter(e => ['thunder-fall', 'thunder-fall-impact'].includes(e.variant))) adapter.tryPlay(event);
    for (let frame = 0; frame < 240; frame++) adapter.update(.05);
    const stats = adapter.stats();
    for (const tag of ['fx', 'zone', 'air', 'billboard']) assert.equal(stats[tag].activeEffects, 0, tag + ' 天落自然回收');
    assert.equal(stats.grounds, 0);
    adapter.destroy();
  }
});

test('雷殞觸發角色與普通／環繞雷球分離，所有超神及永久落雷共用第七階，空觸發欄不回退', () => {
  for (const ult of [null, 'criticalThunderbolt', 'thunderBurst', 'thunderfallShatter']) {
    const c = loadContext(), events = stubVfx(c), hits = stubHits(c); maxLevels(c, 'thunderorb'); equip(c, 'thunderorb');
    if (ult) setUlt(c, 'thunderorb', ult);
    c.chance = () => false; c.bfPlayerPos = () => ({ x: 0, y: 0 });
    const trigger = JSON.parse(JSON.stringify(c.SKILLS2.thunderorb.tiers[6].triggerVfx));
    assert.deepEqual(Object.keys(trigger).sort(), ['ground', 'hit', 'projectile']);
    const p = playerEnt(), es = [enemy(1e9, 180, 0, 'a')];
    c.castSkill2(p, es, 'thunderorb', 'mv-float'); advance(c, p, es, 4);
    const falls = events.filter(e => e.variant === 'thunder-fall'), impacts = events.filter(e => e.variant === 'thunder-fall-impact');
    assert.ok(falls.length >= 2); assert.ok(impacts.length >= 2); assert.ok(hits.length > 0);
    for (const e of [...falls, ...impacts]) assert.deepEqual(JSON.parse(JSON.stringify(e.vfx)), trigger);
    const ordinary = events.filter(e => ['thunder-orb', 'thunder-orbit'].includes(e.variant));
    assert.ok(ordinary.length); assert.ok(ordinary.some(e => e.vfx.projectile === 'orb-thunder'));
    for (const e of ordinary) for (const id of Object.values(e.vfx)) assert.ok(!Object.values(trigger).includes(id), e.variant + ' 不繼承天落外觀');
    if (ult === 'thunderfallShatter') assert.ok(falls.length > 2, '永久追加雷殞仍讀第七階');
    c.SKILLS2.thunderorb.tiers[6].triggerVfx = {};
    assert.deepEqual(JSON.parse(JSON.stringify(c.sgVfxRoles('thunderorb', { vfxTier: 7 }))), {});
  }
});

/* ===========================================================================
   1) 雷球的五個傳奇特效
   =========================================================================== */

test('【雷核】：雷球的體積 +30%（與第 2 階【擴增雷球】相乘）', () => {
  function radius(keys, levels) {
    const c = loadContext();
    stubVfx(c); stubHits(c);
    setLegendary(c, keys);
    setLevels(c, 'thunderorb', levels);
    c.castSkill2(playerEnt(), [enemy(1e9, 40, 0, 'a')], 'thunderorb', 'mv-float');
    return orbFields(c)[0].radius;
  }
  const solo = [1, 0, 0, 0, 0, 0, 0];
  const base = radius([], solo);
  assert.equal(base,table.number('thunderorb',1,'傷害範圍（米）',1)*M,'依表定傷害半徑');
  assert.equal(radius(['thunderorbCore'], solo), base * 1.3, '體積 ×1.3');
  // 與第 2 階相乘而不是相加：兩者都是「體積 +N%」
  const tier2 = radius([], [1, 1, 0, 0, 0, 0, 0]);
  assert.ok(tier2 > base);
  assert.equal(
    Math.round(radius(['thunderorbCore'], [1, 1, 0, 0, 0, 0, 0]) * 1e6),
    Math.round(tier2 * 1.3 * 1e6),
    '兩個體積%相乘'
  );
});

test('【超載】：場上每存在 1 個雷球，雷電傷害 +3%（雷球消失即歸零）', () => {
  const c = loadContext();
  stubVfx(c); stubHits(c);
  setLegendary(c, ['thunderorbOverload']);
  setLevels(c, 'thunderorb', [1, 0, 0, 0, 0, 0, 0]);
  const p = playerEnt();
  const es = [enemy(1e9, 40, 0, 'a')];
  assert.equal(c.skill2LightningDamageUpPct(p), 0, '沒有雷球就沒有加成');
  c.castSkill2(p, es, 'thunderorb', 'mv-float');
  const n = orbFields(c).length;
  assert.ok(n >= 2, '表定一次召喚 2 個雷球');
  assert.equal(c.skill2LightningDamageUpPct(p), 3 * n, '每個雷球各給一份');
  // 雷球打完就消失，加成同步歸零（沒有殘留的常駐增益）
  advance(c, p, es, 20);
  assert.equal(orbFields(c).length, 0);
  assert.equal(c.skill2LightningDamageUpPct(p), 0);
});

test('【超載】沒裝特效時完全不加成（場上有雷球也一樣）', () => {
  const c = loadContext();
  stubVfx(c); stubHits(c);
  setLevels(c, 'thunderorb', [1, 0, 0, 0, 0, 0, 0]);
  const p = playerEnt();
  c.castSkill2(p, [enemy(1e9, 40, 0, 'a')], 'thunderorb', 'mv-float');
  assert.ok(orbFields(c).length > 0);
  assert.equal(c.skill2LightningDamageUpPct(p), 0);
});

test('【感電核心】：伴生雷球的持續時間 ×2（作用拍數跟著加倍）', () => {
  function companionHits(keys) {
    const c = loadContext();
    stubVfx(c); stubHits(c);
    setLegendary(c, keys);
    c.chance = () => true;                       // 伴生一定觸發
    setLevels(c, 'thunderorb', [1, 1, 1, 1, 1, 1, 0]);
    const p = playerEnt();
    const es = [enemy(1e9, 40, 0, 'a')];
    c.castSkill2(p, es, 'thunderorb', 'mv-float');
    advance(c, p, es, 1.2);
    // 靜止（speed 0）的那些就是伴生雷球；飛行雷球一律有速度
    return orbFields(c).filter((f) => f.speed === 0).map((f) => f.hits);
  }
  const base = companionHits([]);
  const long = companionHits(['thunderorbShockCore']);
  assert.ok(base.length > 0 && long.length > 0, '應該生出伴生雷球');
  assert.equal(long[0], base[0] * 2, '持續時間 +100% ＝ 拍數 ×2');
});

test('雷殞降速一半，視覺飛行與傷害落地使用相同時間', () => {
 const c=loadContext();stubVfx(c);stubHits(c);setLegendary(c,[]);c.chance=()=>false;maxLevels(c,'thunderorb');
 const emitted=[];c.sgEmitVfx=(gid,targets,sel,spec)=>{if(spec.variant==='thunder-fall')emitted.push(spec);};
 const start=c.GT,expected=c.sgMeteorFallTiming().travelMs*2;
 c.castSkill2(playerEnt(),[enemy(1e9,40,0,'a')],'thunderorb','mv-float');
 assert.ok(emitted.length);assert.equal(emitted[0].travelMs[0],expected);
 assert.ok(Math.abs(c.SKILL2_RT.meteors[0].at-start-expected/1000)<1e-8);
});

test('【雷殞落】：雷殞天落降下的雷球數量 +1 顆', () => {
  function fallCount(keys) {
    const c = loadContext();
    stubVfx(c); stubHits(c);
    setLegendary(c, keys);
    c.chance = () => false;                      // 不足 1 次的擲骰一律失敗，顆數才數得準
    maxLevels(c, 'thunderorb');
    c.castSkill2(playerEnt(), [enemy(1e9, 40, 0, 'a')], 'thunderorb', 'mv-float');
    return c.SKILL2_RT.meteors.length;
  }
  assert.equal(fallCount([]), 2, '表定 2 顆');
  assert.equal(fallCount(['thunderorbFallCount']), 3, '+1 顆');
});

test('【雷殞震】：雷殞天落的暈眩改寫「至」4 秒（取高，不會反而變短）', () => {
  function stunSecs(keys) {
    const c = loadContext();
    stubVfx(c); stubHits(c);
    setLegendary(c, keys);
    c.chance = () => false;
    maxLevels(c, 'thunderorb');
    const seen = [];
    c.sgTryStun = (target, sec) => { seen.push(sec); return sec; };
    const p = playerEnt();
    const es = [enemy(1e9, 40, 0, 'a')];
    c.castSkill2(p, es, 'thunderorb', 'mv-float');
    advance(c, p, es, 3);
    return seen;
  }
  const base = stunSecs([]);
  assert.ok(base.length > 0 && base.every((s) => s === 3), '表定衝擊波暈 3 秒');
  assert.ok(stunSecs(['thunderorbFallStun']).every((s) => s === 4), '改寫至 4 秒');
});

/* ===========================================================================
   2) 雷球的三個超神進化
   =========================================================================== */

test('CRITICAL-THUNDER 首代每秒外擴3米、10秒壽命，逐受害者再生靜止雷球', () => {
  const c=loadContext(), events=stubVfx(c); stubHits(c); maxLevels(c,'thunderorb');
  setUlt(c,'thunderorb','criticalThunderbolt',1); c.bfPlayerPos=()=>({x:20,y:30});
  c.chance=()=>false; const p=playerEnt(), es=[enemy(1e9,80,110,'a'),enemy(1e9,80,110,'b')];
  c.castSkill2(p,es,'thunderorb','mv-float');
  const orbit=c.SKILL2_RT.orbits[0], before=orbFields(c).length;
  const rolls=[]; c.chance=pct=>{rolls.push(pct);return true;};
  orbit.onStrike(orbit,{}, {x:80,y:110});
  assert.equal(orbFields(c).length,before+1,'首代一次一顆，移除四顆');
  assert.equal(rolls[0],30,'伴生機率仍是15+1.5×10，移除翻倍');
  const first=orbFields(c).at(-1);
  assert.equal(first.speed,30); assert.equal(first.expiresAt-first.bornAt,10);
  assert.equal(first.dest.x,260); assert.equal(first.dest.y,350);
  c.sgGroundMove(first,1,es);
  assert.equal(first.pos.x,98); assert.equal(first.pos.y,134);
  const spec=c.sgGroundVfxSpec(first);
  assert.equal(spec.area.speed,30); assert.equal(spec.area.destX,260);
  assert.equal(spec.area.destY,350); assert.equal(spec.area.x,98); assert.equal(spec.area.y,134);
  assert.ok(Math.abs(spec.area.moveA-Math.atan2(4,3))<1e-12);
  rolls.length=0; const n=orbFields(c).length;
  c.sgGroundTick(first,es,tickCtx(c,p,es));
  assert.deepEqual(rolls,[11,11],'每個成功命中各判定10+1×1%');
  assert.equal(orbFields(c).length,n+2);
  const child=orbFields(c).at(-1), pos={...child.pos};
  assert.equal(child.speed,0); assert.equal(child.dest,null); assert.equal(child.expiresAt-child.bornAt,10);
  assert.equal(child.dmgVal,first.dmgVal); c.sgGroundMove(child,1,es);
  assert.deepEqual({...child.pos},pos); assert.equal(c.sgGroundVfxSpec(child).area.speed,undefined);
  const childCount=orbFields(c).length; child.onHit(child,es[0],es,{});
  assert.equal(orbFields(c).length,childCount+1,'衍生球仍可再生'); assert.equal(orbFields(c).at(-1).speed,0);
  c.resolveHit=()=>({dmg:0,miss:true}); const missCount=orbFields(c).length;
  c.sgGroundTick(first,es,tickCtx(c,p,es)); assert.equal(orbFields(c).length,missCount,'未命中不生成');
  c.GT=9.9; assert.ok(Math.abs(c.sgGroundVfxSpec(first).dur-.1)<1e-10,'末拍VFX不超過到期時間'); c.GT=0;
  assert.ok(events.some(e=>e.variant==='thunder-orb' && e.area.speed===30),'正式派送保留權威移動資訊');
  c.chance=()=>false; c.SKILL2_RT.orbits=[]; c.SKILL2_RT.grounds=[first];
  advance(c,p,[],9.95); assert.equal(c.SKILL2_RT.grounds.length,1);
  advance(c,p,[],.05); assert.equal(c.SKILL2_RT.grounds.length,0,'10秒到期');
});

test('CRITICAL-THUNDER 逐級機率與傷害、取代感電核心時間，未選超神保留原伴生', () => {
  function run(lv){
    const c=loadContext();stubVfx(c);stubHits(c);maxLevels(c,'thunderorb');
    c.bfPlayerPos=()=>({x:0,y:0}); c.chance=()=>false;
    if(lv)setUlt(c,'thunderorb','criticalThunderbolt',lv);
    setLegendary(c,['thunderorbShockCore']);
    const p=playerEnt(), es=[enemy(1e9,100,0,'a')];c.castSkill2(p,es,'thunderorb','mv-float');
    const damage=orbFields(c)[0].dmgVal;const orbit=c.SKILL2_RT.orbits[0];c.chance=()=>true;
    orbit.onStrike(orbit,{}, {x:100,y:0});const f=orbFields(c).at(-1);
    let probability; c.chance=pct=>{probability=pct;return false;}; if(f.onHit)f.onHit(f,es[0],es,{});
    return {damage,f,probability};
  }
  const base=run(0), one=run(1), ten=run(10);
  assert.equal(base.f.speed,0); assert.equal(base.f.hits,Math.ceil(4/.35));
  assert.equal(one.f.expiresAt-one.f.bornAt,10,'固定10秒不乘感電核心');
  assert.equal(one.probability,11);assert.equal(ten.probability,20);
  assert.equal(Math.round(one.damage/base.damage*100),155);
  assert.equal(Math.round(ten.damage/base.damage*100),200);
});

test('CRITICAL-THUNDER 正式雷球Preset逐幀外移，衍生球維持原地並自然回收', () => {
  const c=loadContext(), events=stubVfx(c); stubHits(c);maxLevels(c,'thunderorb');
  setUlt(c,'thunderorb','criticalThunderbolt');c.bfPlayerPos=()=>({x:0,y:0});c.chance=()=>false;
  const p=playerEnt(), es=[enemy(1e9,100,0,'a')];c.castSkill2(p,es,'thunderorb','mv-float');
  c.chance=()=>true;const orbit=c.SKILL2_RT.orbits[0];orbit.onStrike(orbit,{}, {x:100,y:0});
  const first=orbFields(c).at(-1); first.onHit(first,es[0],es,{});const child=orbFields(c).at(-1);
  events.length=0;c.chance=()=>false;c.sgGroundTick(first,es,tickCtx(c,p,es));c.sgGroundTick(child,es,tickCtx(c,p,es));
  const Core=require('../js/vfx-core.js'),Runtime=require('../js/vfx-runtime.js');
  const preset=JSON.parse(fs.readFileSync(path.join(root,'vfx/presets/lightning-orb-field.json'),'utf8'));
  const nodes=[];function backend(tag){return{createNode(spec){const n={tag,spec,t:[]};nodes.push(n);return n;},updateNode(n,t){n.t.push({...t})},destroyNode(){},destroy(){}};}
  const adapter=Runtime.create({core:Core,resolver:{has:()=>true,resolve:id=>id},groundScale:.5,
    fxBackend:backend('fx'),zoneBackend:backend('zone'),airBackend:backend('air'),billboardBackend:backend('billboard'),ctx:{posOf:()=>({x:100,y:0}),playerPos:()=>({x:0,y:0})}});
  adapter.registerPresets([preset]);for(const e of events)adapter.tryPlay(e);
  adapter.update(.01); const bodies=nodes.filter(n=>n.spec.assetUrl===preset.layers[0].assetId);
  assert.equal(bodies.length,2);assert.ok(bodies.every(n=>n.tag==='billboard'));
  const start=bodies.map(n=>n.t.at(-1).x);adapter.update(.1);
  assert.ok(bodies[0].t.at(-1).x>start[0]);assert.equal(bodies[1].t.at(-1).x,start[1]);
  for(let i=0;i<100;i++)adapter.update(.05);
  assert.equal(adapter.stats().grounds,0);assert.equal(adapter.stats().billboard.activeEffects,0);adapter.destroy();
});

test('【雷爆】：一道連鎖閃電在範圍內彈射，總共命中「彈射次數」次', () => {
  const c = loadContext();
  const events = stubVfx(c);
  const calls = stubHits(c);
  maxLevels(c, 'thunderorb');
  equip(c, 'thunderorb');
  setUlt(c, 'thunderorb', 'thunderBurst', 1);
  c.chance = () => true;
  const spec = c.sgThunderorbBurstSpec(c.SKILLS2.thunderorb, c.BASE_STATS);
  assert.ok(spec, '選了超神就該有規格');
  assert.equal(spec.bounces, 4, '表定彈射 4 次');
  assert.equal(spec.px, 30 * M, '表定 30 米');
  assert.equal(spec.speedPx, 24 * M, '一般雷球 6 米／秒的四倍');
  const es = line(6, 3 * M);
  const out = { killed: false, dmg: 0, crit: false };
  const p = playerEnt();
  c.sgThunderorbBurst(p, c.BASE_STATS, 'mv-float', spec, es[0], es, out);
  assert.equal(calls.length, 1, '出生時只有原目標受擊，不可先結算後續彈射');
  assert.equal(events.filter(e => e.variant === 'lightning-chain').length, 1);
  advance(c, p, es, 6);
  assert.equal(calls.length, 4, '4 次命中');
  assert.equal(calls[0].ent, es[0], '第一下就打在觸發它的敵人身上（單一 BOSS 也生效）');
  assert.ok(calls.every((h) => h.elem === 'lightning'));
  assert.equal(events.filter(e => e.variant === 'lightning-chain').length, 3);
  assert.equal(c.SKILL2_RT.meteors.length, 0);
});

test('雷爆按一般雷球四倍速度逐跳抵達，30米邊界與移動目標使用權威位置', () => {
  const c=loadContext(), events=stubVfx(c), hits=stubHits(c);maxLevels(c,'thunderorb');setUlt(c,'thunderorb','thunderBurst',10);
  c.chance=()=>true;
  c.bfRandomOther=(from,pool,gap,visited)=>pool.find(e=>e.hp>0&&!visited.includes(e))||null;
  c.SKILLS2.thunderorb.tiers[0].fx.speed=7;c.SKILLS2.thunderorb.tiers[0].fx.speedPer=1;
  const spec=c.sgThunderorbBurstSpec(c.SKILLS2.thunderorb,c.BASE_STATS);
  assert.equal(spec.speedPx,(7+10)*M*4,'倍率共用實際等級速度');
  const p=playerEnt(), es=[enemy(1e9,0,0,'a'),enemy(1e9,300,0,'b'),enemy(1e9,600.01,0,'outside')];
  c.sgThunderorbBurst(p,c.BASE_STATS,'mv-float',spec,es[0],es,{dmg:0,killed:false,crit:false});
  const flight=events.find(e=>e.variant==='lightning-chain');
  assert.deepEqual(Array.from(flight.targets),['a','b']);assert.equal(flight.area.sourceX,0);assert.equal(flight.area.homingSpeed,spec.speedPx);
  assert.ok(Math.abs(flight.travelMs[1]-300/spec.speedPx*1000)<1e-8);
  advance(c,p,es,.25);assert.equal(hits.length,1,'飛行途中不傷害');
  es[1].pos.x=400;
  advance(c,p,es,.2);assert.equal(hits.length,1,'移動目標不可按舊估時提前命中');
  advance(c,p,es,.15);assert.equal(hits.length,2,'追蹤抵達才命中');
  const next=events.filter(e=>e.variant==='lightning-chain')[1];assert.equal(next.area.sourceX,400,'續跳由實際抵達處出發');
  advance(c,p,es,2);assert.equal(hits.length,3);assert.equal(c.SKILL2_RT.meteors.length,0);
  // 搜敵每跳重新以當下落點為中心；邊界外不因怪物碰撞體半徑而納入。
  const c2=loadContext(), e2=stubVfx(c2);stubHits(c2);maxLevels(c2,'thunderorb');setUlt(c2,'thunderorb','thunderBurst');c2.chance=()=>true;
  c2.sgThunderorbBurst(playerEnt(),c2.BASE_STATS,'mv-float',c2.sgThunderorbBurstSpec(c2.SKILLS2.thunderorb,c2.BASE_STATS),es[0],[es[0],es[2]],{dmg:0,killed:false,crit:false});
  assert.equal(e2.filter(e=>e.variant==='lightning-chain').length,0,'600.01像素的敵人在出生點30米外');
});

test('雷爆原目標被擊殺仍判定；途中死亡不傷害並續跳，玩家死亡取消，單敵和零敵不殘留', () => {
  function make(){const c=loadContext(),events=stubVfx(c),hits=stubHits(c);maxLevels(c,'thunderorb');setUlt(c,'thunderorb','thunderBurst');c.chance=()=>true;c.bfRandomOther=(from,pool,gap,visited)=>pool.find(e=>e.hp>0&&!visited.includes(e))||null;return{c,events,hits,spec:c.sgThunderorbBurstSpec(c.SKILLS2.thunderorb,c.BASE_STATS),p:playerEnt(),out:{dmg:0,killed:false,crit:false}};}
  const a=make(), es=[enemy(0,0,0,'dead'),enemy(1e9,120,0,'b'),enemy(1e9,240,0,'c')];
  a.c.sgThunderorbBurst(a.p,a.c.BASE_STATS,'mv-float',a.spec,es[0],es,a.out);
  assert.equal(a.hits.length,0);assert.equal(a.events[0].area.sourceX,0,'從被殺死的雷球受害者位置出生');
  es[1].hp=0;advance(a.c,a.p,es,.55);assert.equal(a.hits.length,0);
  assert.equal(a.events.filter(e=>e.variant==='lightning-chain').length,2,'到死亡落點後繼續彈射');
  advance(a.c,a.p,es,1);assert.equal(a.hits.length,1);assert.equal(a.hits[0].ent,es[2]);
  const b=make(), pair=[enemy(1e9,0,0,'a'),enemy(1e9,120,0,'b')];b.c.sgThunderorbBurst(b.p,b.c.BASE_STATS,'mv-float',b.spec,pair[0],pair,b.out);b.p.hp=0;advance(b.c,b.p,pair,2);assert.equal(b.hits.length,1);assert.equal(b.c.SKILL2_RT.meteors.length,0);
  const single=make(), boss=enemy(1e9);single.c.sgThunderorbBurst(single.p,single.c.BASE_STATS,'mv-float',single.spec,boss,[boss],single.out);assert.equal(single.hits.length,1);assert.equal(single.c.SKILL2_RT.meteors.length,0);
  const empty=make();empty.c.sgThunderorbBurst(empty.p,empty.c.BASE_STATS,'mv-float',empty.spec,null,[],empty.out);assert.equal(empty.hits.length,0);assert.equal(empty.events.length,0);
});

test('【雷爆】沒選超神時規格為 null，雷球命中完全不進判定', () => {
  function hitsIn(withUlt) {
    const c = loadContext();
    stubVfx(c);
    const calls = stubHits(c);
    maxLevels(c, 'thunderorb');
    equip(c, 'thunderorb');
    if (withUlt) setUlt(c, 'thunderorb', 'thunderBurst', 1);
    c.chance = () => true;
    const p = playerEnt();
    const es = line(6, 3 * M);
    c.castSkill2(p, es, 'thunderorb', 'mv-float');
    const n0 = calls.length;
    advance(c, p, es, 0.5);
    return { delta: calls.length - n0, spec: c.sgThunderorbBurstSpec(c.SKILLS2.thunderorb, c.BASE_STATS) };
  }
  const base = hitsIn(false);
  const ult = hitsIn(true);
  assert.equal(base.spec, null, '沒選超神＝沒有規格');
  assert.ok(ult.spec);
  assert.ok(ult.delta > base.delta, '選了之後雷球命中會多帶出連鎖閃電的傷害');
});

test('雷爆使用普通連鎖閃電的同款素材與尺寸、逐段飛行並自然回收', () => {
  const c=loadContext(),events=stubVfx(c),hits=stubHits(c);maxLevels(c,'thunderorb');setUlt(c,'thunderorb','thunderBurst');c.chance=()=>true;
  const p=playerEnt(),es=[enemy(1e9,0,0,'a'),enemy(1e9,120,120,'b')],out={dmg:0,killed:false,crit:false};
  const trigger=JSON.parse(JSON.stringify(c.SKILLS2.thunderorb.ult.find(u=>u.id==='thunderBurst').triggerVfx));
  assert.deepEqual(trigger,JSON.parse(JSON.stringify(c.SKILLS2.chainlightning.tiers[0].vfx)));
  c.sgThunderorbBurst(p,c.BASE_STATS,'mv-float',c.sgThunderorbBurstSpec(c.SKILLS2.thunderorb,c.BASE_STATS),es[0],es,out);
  const Core=require('../js/vfx-core.js'),Runtime=require('../js/vfx-runtime.js');
  const ps=Object.values(trigger).map(id=>JSON.parse(fs.readFileSync(path.join(root,'vfx/presets',id+'.json'),'utf8')));
  ps.forEach(pr=>pr.layers.forEach(l=>{if(l.assetId)l.assetId=pr.id+'/'+l.assetId}));
  function make(){const nodes=[];function backend(tag){return{createNode(spec){const node={tag,spec,t:[]};nodes.push(node);return node},updateNode(n,t){n.t.push(t)},destroyNode(n){n.dead=true},destroy(){}};}
    const adapter=Runtime.create({core:Core,resolver:{has:()=>true,resolve:id=>id},groundScale:.5,
      fxBackend:backend('fx'),zoneBackend:backend('zone'),airBackend:backend('air'),billboardBackend:backend('billboard'),
      ctx:{posOf:id=>{const q=es.find(e=>e.name===id);return q?{x:q.pos.x,y:q.pos.y*.5}:{x:0,y:0}},playerPos:()=>({x:-999,y:-999})}});
    adapter.registerPresets(ps);return{nodes,adapter};}
  const {nodes,adapter}=make();let sent=0;function send(){for(;sent<events.length;sent++)adapter.tryPlay(events[sent]);}
  const flight=events.find(e=>e.variant==='lightning-chain');
  assert.equal(flight.fxKind,'chain');assert.equal(flight.lineWidth,undefined);assert.equal(flight.sizeMult,undefined);
  const ordinary=make();ordinary.adapter.tryPlay({...flight,gid:'chainlightning',vfx:c.SKILLS2.chainlightning.tiers[0].vfx});
  send();adapter.update(.05);ordinary.adapter.update(.05);
  const beam=nodes.find(n=>n.spec.assetUrl.startsWith(trigger.projectile+'/'));
  const normalBeam=ordinary.nodes.find(n=>n.spec.assetUrl===beam.spec.assetUrl);
  assert.ok(beam);assert.equal(beam.tag,'fx');
  assert.equal(beam.t.at(-1).scaleX,normalBeam.t.at(-1).scaleX,'與一般鏈段同尺寸');
  assert.equal(beam.t.at(-1).scaleY,normalBeam.t.at(-1).scaleY,'不套小雷球縮放');
  assert.equal(beam.t.at(-1).x,normalBeam.t.at(-1).x,'同一追蹤起點與速度');
  ordinary.adapter.destroy();
  for(let f=0;f<120;f++){advance(c,p,es,.05);send();adapter.update(.05);}
  assert.equal(hits.length,2);assert.equal(events.filter(e=>e.variant==='lightning-chain').length,1);
  assert.equal(events.filter(e=>e.variant==='lightning-chain-end').length,1);
  assert.equal(adapter.stats().projectiles,0);
  for(const tag of ['fx','zone','air','billboard'])assert.equal(adapter.stats()[tag].activeEffects,0,tag+'自然回收');
  // 死亡時立即終止正在追蹤的鏈段，不能讓 loop 素材留到復活。
  events.length=0;sent=0;c.sgThunderorbBurst(p,c.BASE_STATS,'mv-float',c.sgThunderorbBurstSpec(c.SKILLS2.thunderorb,c.BASE_STATS),es[0],es,{dmg:0,killed:false,crit:false});
  send();adapter.update(.05);p.hp=0;advance(c,p,es,.05);send();adapter.update(.05);
  assert.equal(events.filter(e=>e.variant==='lightning-chain-end').length,1);
  assert.ok(nodes.filter(n=>n.spec.assetUrl.startsWith(trigger.projectile+'/')).every(n=>n.dead||n.t.at(-1).visible===false),'死亡立即停止並隱藏鏈段');
  adapter.update(1); // 已造成的第一下命中閃光仍按其自然時長結束。
  for(const tag of ['fx','zone','air','billboard'])assert.equal(adapter.stats()[tag].activeEffects,0,tag+'死亡回收');
  adapter.destroy();
  c.SKILLS2.thunderorb.ult.find(u=>u.id==='thunderBurst').triggerVfx={};
  assert.deepEqual(JSON.parse(JSON.stringify(c.sgVfxRoles('thunderorb',{vfxUlt:'thunderBurst'}))),{},'空觸發不回退一般雷球外觀');
});

test('【雷殞天地碎】：雷殞石體積與傷害放大，並每 1 秒不斷再降下 1 顆', () => {
  const c = loadContext();
  const specs = stubVfx(c);
  stubHits(c);
  c.chance = () => false;
  maxLevels(c, 'thunderorb');
  equip(c, 'thunderorb');
  setUlt(c, 'thunderorb', 'thunderfallShatter', 1);
  const p = playerEnt();
  const es = [enemy(1e9, 40, 0, 'a')];
  // 施放時的那一批照常降下（設計沒寫「改為」＝追加）
  c.castSkill2(p, es, 'thunderorb', 'mv-float');
  const onCast = c.SKILL2_RT.meteors.length;
  assert.equal(onCast, 2, '施放時仍降下表定的 2 顆');
  const radius = c.SKILL2_RT.meteors[0].radius;
  assert.equal(radius, 15 * M * 1.5, '體積 +50%');
  const dropsBefore = specs.filter((s) => s.variant === 'thunder-fall').length;
  advance(c, p, es, 4);
  const dropsAfter = specs.filter((s) => s.variant === 'thunder-fall').length;
  assert.ok(dropsAfter - dropsBefore >= 3, '4 秒內至少再降下 3 顆（每 1 秒 1 顆）');
});

test('【雷殞天地碎】：沒裝配在技能列上就不運轉（節拍歸零）', () => {
  const c = loadContext();
  const specs = stubVfx(c);
  stubHits(c);
  c.chance = () => false;
  maxLevels(c, 'thunderorb');
  setUlt(c, 'thunderorb', 'thunderfallShatter', 1);   // 故意不 equip
  const p = playerEnt();
  const es = [enemy(1e9, 40, 0, 'a')];
  advance(c, p, es, 4);
  assert.equal(c.SKILL2_RT.thunderfallAt, 0);
  assert.equal(specs.filter((s) => s.variant === 'thunder-fall').length, 0);
});

/* ===========================================================================
   3) 寒冰箭的五個傳奇特效
   =========================================================================== */

test('【連射】：射出的寒冰箭 +2 支', () => {
  function arrows(keys) {
    const c = loadContext();
    stubVfx(c);
    const calls = stubHits(c);
    setLegendary(c, keys);
    c.chance = () => false;
    setLevels(c, 'icearrow', [1, 0, 0, 0, 0, 0, 0]);
    c.castSkill2(playerEnt(), line(8, 6 * M), 'icearrow', 'mv-float');
    return calls.length;
  }
  assert.equal(arrows([]), 2, '表定 2 支');
  assert.equal(arrows(['icearrowVolley']), 4, '+2 支');
});

test('【冰封】：寒冰箭傷害 ×1.5（乘在第 1 階＋冰系強化的加總之後）', () => {
  function atk(keys) {
    const c = loadContext();
    stubVfx(c);
    const calls = stubHits(c);
    setLegendary(c, keys);
    c.chance = () => false;
    setLevels(c, 'icearrow', [1, 0, 0, 0, 0, 0, 0]);
    c.castSkill2(playerEnt(), [enemy(1e9, 40, 0, 'a')], 'icearrow', 'mv-float');
    return calls[0].atk;
  }
  assert.equal(Math.round(atk(['icearrowSeal']) / atk([]) * 100), 150);
});

test('【凜冬侵蝕】：寒冰箭塗出來的寒霜，每跳量與持續時間各 ×1.5', () => {
  function frost(keys) {
    const c = loadContext();
    stubVfx(c);
    stubHits(c);
    setLegendary(c, keys);
    c.chance = () => false;
    setLevels(c, 'icearrow', [1, 1, 0, 0, 0, 0, 0]);
    const e = enemy(1e9, 40, 0, 'a');
    c.castSkill2(playerEnt(), [e], 'icearrow', 'mv-float');
    return c.sgFindDot(e, 'sgFrostBite');
  }
  const base = frost([]);
  const winter = frost(['icearrowWinter']);
  assert.ok(base && winter, '第 2 階【寒霜箭】應該塗上凍傷');
  assert.equal(Math.round(winter.dps / base.dps * 100), 150, '每跳量 ×1.5');
  assert.equal(Math.round(winter.until / base.until * 100), 150, '持續時間 ×1.5');
});

test('【冰裂箭】：命中後往前分裂 2 支小箭，打的是前方而不是身後的敵人', () => {
  const c = loadContext();
  stubVfx(c);
  const calls = stubHits(c);
  setLegendary(c, ['icearrowSplit']);
  c.chance = () => false;
  setLevels(c, 'icearrow', [1, 0, 0, 0, 0, 0, 0]);
  // 玩家在原點：behind 比 victim 近、ahead 在 victim 更遠處（同一條 +x 直線）
  const behind = enemy(1e9, 10 * M, 0, 'behind');
  const victim = enemy(1e9, 20 * M, 0, 'victim');
  const ahead = enemy(1e9, 28 * M, 0, 'ahead');
  c.castSkill2(playerEnt(), [victim, ahead, behind], 'icearrow', 'mv-float');
  const splitAtk = Math.min.apply(null, calls.map((h) => h.atk));
  const aheadHits = calls.filter((h) => h.ent === ahead && h.atk === splitAtk);
  assert.ok(aheadHits.length > 0, '前方的敵人吃得到分裂箭');
  assert.equal(calls.filter((h) => h.ent === behind && h.atk === splitAtk).length, 0, '身後的敵人吃不到');
  // 分裂箭是「群組基礎值的 150%」，不是本體那一箭的 150%
  const bodyAtk = Math.max.apply(null, calls.map((h) => h.atk));
  assert.ok(splitAtk < bodyAtk, '小箭比本體弱');
});

test('【深度凍結】：擊中暈眩或凍結中的敵人時 +50%，未控場則不加', () => {
  function bonus(keys, control) {
    const c = loadContext();
    stubVfx(c);
    const calls = stubHits(c);
    setLegendary(c, keys);
    c.chance = () => false;
    setLevels(c, 'icearrow', [1, 0, 0, 0, 0, 0, 0]);
    const e = enemy(1e9, 40, 0, 'a');
    if (control === 'stun') e.effects.stun = 999;
    if (control === 'frozen') e.buffs.sgFrozen = { until: 999, val: 0 };
    c.castSkill2(playerEnt(), [e], 'icearrow', 'mv-float');
    return calls[0].total;
  }
  assert.equal(bonus(['icearrowDeepFreeze'], null), 0, '沒有控場就沒有加成');
  assert.equal(bonus(['icearrowDeepFreeze'], 'stun'), 50, '暈眩中 +50%');
  assert.equal(bonus(['icearrowDeepFreeze'], 'frozen'), 50, '凍結中 +50%');
  assert.equal(bonus([], 'stun'), 0, '沒裝特效就不加');
});

test('【深度凍結】與【冰裂箭】在追擊冰箭（第 7 階）那一段同樣生效', () => {
  const c = loadContext();
  stubVfx(c);
  stubHits(c);
  setLegendary(c, ['icearrowDeepFreeze', 'icearrowSplit']);
  c.chance = () => false;
  maxLevels(c, 'icearrow');
  equip(c, 'icearrow');
  c.castSkill2(playerEnt(), line(4, 5 * M), 'icearrow', 'mv-float');
  const homing = c.SKILL2_RT.grounds.filter((f) => f.kind === 'icearrow');
  assert.ok(homing.length > 0, '第 7 階應該生出追擊場域');
  assert.equal(homing[0].ctrlPct, 50, '控場增傷帶進場域');
  assert.equal(typeof homing[0].onHit, 'function', '分裂箭掛在場域的命中後回呼');
});

/* ===========================================================================
   4) 寒冰箭的三個超神進化
   =========================================================================== */

test('【極寒冰爆】：連射改為 10 波／每 0.35 秒，且寒冰箭傷害 +50%', () => {
  function run(withUlt) {
    const c = loadContext();
    const specs = stubVfx(c);
    stubHits(c);
    c.chance = () => false;
    maxLevels(c, 'icearrow');
    equip(c, 'icearrow');
    if (withUlt) setUlt(c, 'icearrow', 'absoluteZeroBurst', 1);
    c.castSkill2(playerEnt(), [enemy(1e9, 40, 0, 'a')], 'icearrow', 'mv-float');
    const pierce = specs.filter((s) => s.variant === 'ice-arrow-pierce');
    const delays = Array.from(new Set(pierce.map((s) => s.delayMs || 0))).sort((a, b) => a - b);
    // 貫穿箭的傷害在施放當下定版在飛行物上（命中要等它飛完才發生）
    return { waves: delays.length, gap: delays[1] - delays[0], dmg: c.SKILL2_RT.projectiles[0].dmgVal };
  }
  const base = run(false);
  const ult = run(true);
  assert.equal(base.waves, 3, '表定 3 波');
  assert.equal(base.gap, 300, '表定間隔 0.3 秒');
  assert.equal(ult.waves, 10, '改為 10 波');
  assert.equal(ult.gap, 350, '改為 0.35 秒');
  // Lv.1 ＝ 50 + 5×1 ＝ 55%
  assert.equal(Math.round(ult.dmg / base.dmg * 100), 155, '寒冰箭傷害 ×1.55');
});

test('【無限冰裂】：發射支數 +4，且每造成 1 次傷害就回扣 0.1 秒冷卻', () => {
  function run(withUlt) {
    const c = loadContext();
    const specs = stubVfx(c);
    const calls = stubHits(c);
    c.chance = () => false;                       // 不足 1 支的部分一律不觸發
    maxLevels(c, 'icearrow');
    equip(c, 'icearrow');
    if (withUlt) setUlt(c, 'icearrow', 'infiniteIceRift', 1);
    const p = playerEnt();
    const es = line(6, 5 * M);
    c.castSkill2(p, es, 'icearrow', 'mv-float');
    const cdAtCast = p.skillCds[c.SG_PREFIX + 'icearrow'];
    advance(c, p, es, 1);
    return {
      lanes: specs.filter((s) => s.variant === 'ice-arrow-pierce' && !s.delayMs).length,
      cdAtCast, cdAfter: p.skillCds[c.SG_PREFIX + 'icearrow'], hits: calls.length
    };
  }
  const base = run(false);
  const ult = run(true);
  assert.equal(ult.lanes, base.lanes + 4, '每次發射 +4 支');
  assert.equal(base.cdAfter, base.cdAtCast, '沒選超神時冷卻不會被命中扣掉');
  assert.ok(ult.hits > 0);
  assert.ok(ult.cdAfter <= Math.max(0, ult.cdAtCast - ult.hits * 0.1) + 1e-6, '每次命中各扣 0.1 秒');
  assert.ok(ult.cdAfter < ult.cdAtCast);
});

test('【冰之淚】：施放時另外召喚跟隨我方的箭雨（10 波、我方 30 米內）', () => {
  const c = loadContext();
  stubVfx(c);
  const calls = stubHits(c);
  c.chance = () => false;
  maxLevels(c, 'icearrow');
  equip(c, 'icearrow');
  setUlt(c, 'icearrow', 'tearsOfIce', 1);
  const p = playerEnt();
  const es = [enemy(1e9, 40, 0, 'a'), enemy(1e9, 200, 100, 'b')];
  c.castSkill2(p, es, 'icearrow', 'mv-float');
  const rain = c.SKILL2_RT.grounds.filter((f) => f.kind === 'icerain');
  assert.equal(rain.length, 1, '一次施放一片箭雨');
  assert.equal(rain[0].hits, 10, '10 波');
  assert.equal(rain[0].radius, 30 * M, '我方 30 米');
  assert.equal(rain[0].follow, true, '圓心跟著我方走');
  const n0 = calls.length;
  advance(c, p, es, 4);
  assert.ok(calls.length > n0, '箭雨會逐波造成傷害');
});

test('【冰之淚】沒選超神就不會有箭雨場域', () => {
  const c = loadContext();
  stubVfx(c); stubHits(c);
  c.chance = () => false;
  maxLevels(c, 'icearrow');
  equip(c, 'icearrow');
  c.castSkill2(playerEnt(), [enemy(1e9, 40, 0, 'a')], 'icearrow', 'mv-float');
  assert.equal(c.SKILL2_RT.grounds.filter((f) => f.kind === 'icerain').length, 0);
});

/* ===========================================================================
   5) 資料表：十個傳奇特效與六個超神進化都落到參數表
   =========================================================================== */

test('十個新傳奇特效：武器類型與關聯群組正確，且都落在 Equipment_Affix 表', () => {
  const c = loadContext();
  const csv = fs.readFileSync(path.join(root, 'config/CSV/Equipment_Affix.csv'), 'utf8');
  const expect = {
    thunderorbCore: 'orb', thunderorbOverload: 'orb', thunderorbShockCore: 'orb',
    thunderorbFallCount: 'orb', thunderorbFallStun: 'orb',
    icearrowVolley: 'spellbook', icearrowSeal: 'spellbook', icearrowWinter: 'spellbook',
    icearrowSplit: 'spellbook', icearrowDeepFreeze: 'spellbook'
  };
  Object.keys(expect).forEach((key) => {
    const def = c.PASSIVE_POOL[key];
    assert.ok(def, key + ' 應在傳奇特效池內');
    assert.equal(def.legendary, true);
    // ⚠️ vm 沙盒的陣列與宿主不同 realm，deepStrictEqual 會因原型不同而誤判，故比字串
    assert.equal(def.weaponTypes.join('|'), expect[key], key + ' 的武器類型');
    assert.equal(def.relatedSkill, expect[key] === 'orb' ? 'thunderorb' : 'icearrow');
    assert.ok(def.fx && Object.keys(def.fx).length > 0, key + ' 缺 fx');
    assert.ok(csv.includes(',' + key + ','), key + ' 沒落到參數表');
  });
});

test('六個新超神進化：id 與參數表一致，說明模板的參數鍵都存在', () => {
  const c = loadContext();
  const csv = fs.readFileSync(path.join(root, 'config/CSV/Skills2.csv'), 'utf8');
  [['thunderorb', ['criticalThunderbolt', 'thunderBurst', 'thunderfallShatter']],
    ['icearrow', ['absoluteZeroBurst', 'infiniteIceRift', 'tearsOfIce']]].forEach(([gid, ids]) => {
    const list = c.sgUltDefs(gid);
    assert.ok(list, gid + ' 應已開放超神進化');
    assert.equal(list.map((o) => o.id).join('|'), ids.join('|'), gid + ' 的三個選項與順序');
    list.forEach((o) => {
      String(o.desc || '').replace(/\{(\w+)\}/g, (m, key) => {
        assert.ok(o.fx[key] !== undefined, gid + '/' + o.id + ' 說明引用了不存在的參數 {' + key + '}');
        return m;
      });
      assert.equal(table.row(gid,o.id)['超神ID'],o.id,'依欄名讀取超神ID，不假定它在CSV最後一欄');
    });
  });
});
