const test = require('node:test');
const assert = require('node:assert/strict');
const { createEngine } = require('../scripts/sim/engine');
const fs = require('node:fs');
const vm = require('node:vm');

function setup() {
  const e = createEngine({ seed: 42 }).boot(null), c = e.ctx;
  c.G.player.skills2.levels.counter = Array(7).fill(10);
  c.G.player.level = 1000;
  c.G.player.skills2.ult = {};
  c.G.player.skills2.ult.counter = { pick: c.sgUltIndexOfId('counter', 'indomitable'), lv: 10 };
  c.G.player.loadout = ['sg:counter'];
  c.G.stage.current = 121;
  c.G.stage.zone = 'swamp';
  c.G.stage.autoAdvance = false;
  c.markStatsDirty(); c.initFieldPlayer(); c.gmArenaSpawn(20, 'elite', 1000000);
  const hits = [], resolve = c.resolveHit;
  c.resolveHit = function(a,d,ac,dc) {
    if (ac.isSkill && ac.skillElem === 'earth' && a === c.FIELD.player) hits.push({ t:c.GT, atk:ac.atk, target:d });
    return resolve(a,d,ac,dc);
  };
  return { e,c,hits };
}

test('復甦完整戰鬥：零血攔截、十段總倍率、敵群保留、HP 線性回滿且不重設 MP', () => {
  const {e,c,hits}=setup(), p=c.FIELD.player, enemies=c.FIELD.monsters.slice(), st=c.getStats();
  p.hp=0; p.mp=7; c.onPlayerFieldDeath();
  assert.equal(p.hp,0); assert.ok(p._sgRevival);
  assert.equal(c.FIELD.reviveCd,0);
  assert.ok(c.buildPanel('battle').field.player._sgRevival, '畫面取得復甦狀態而非死亡倒數');
  c.onPlayerFieldDeath(); assert.equal(c.FIELD.reviveCd,0);
  c.healPlayer(p,1e12,st); assert.equal(p.hp,0);
  c.applyEnemyHpDamage(p,1e12); assert.equal(p.hp,0);
  e.stepSeconds(2.5);
  assert.ok(Math.abs(p.hp/st.hp-0.5)<1e-8);
  assert.equal(hits.length,100, '20 隻 × 5 跳');
  assert.equal(hits[0].t,0.5);
  assert.ok(hits.every(x=>Math.abs(x.atk-(st.atk+st.matk)*4)<1e-8));
  e.stepSeconds(2.5);
  assert.equal(hits.length,200, '20 隻 × 10 跳');
  assert.equal(p.hp,st.hp);
  assert.equal(p._sgRevival,undefined);
  assert.equal(c.FIELD.reviveCd,0); assert.equal(c.G.stage.current,121);
  assert.deepEqual(c.FIELD.monsters,enemies);
  p.hp=0; assert.equal(c.skills2TryLastStand(p),false, '冷卻期間不得再次復甦');
});

test('復甦呈現：站姿從地面逐漸升起，暫停進度不變，光束由配置表接線', () => {
  const src=fs.readFileSync(require.resolve('../js/battle-renderer.js'),'utf8');
  const start=src.indexOf('      if (p.revival) {',src.indexOf('function tickWorld('));
  const end=src.indexOf('      p.root.x = p.wx;',start);
  assert.ok(start>0 && end>start);
  let left=5;
  const p={revival:{startAt:10,endAt:15},revivalGt:10,bodyWrap:{x:1,y:0,rotation:1}};
  const ctx=vm.createContext({p,Math,uiCountdownRemain:()=>left});
  vm.runInContext(src.slice(start,end),ctx);assert.ok(Math.abs(p.bodyWrap.y)<1e-8);assert.equal(p.bodyWrap.rotation,0);
  left=2.5;vm.runInContext(src.slice(start,end),ctx);assert.equal(p.bodyWrap.y,-30);
  vm.runInContext(src.slice(start,end),ctx);assert.equal(p.bodyWrap.y,-30);
  left=0;vm.runInContext(src.slice(start,end),ctx);assert.equal(p.bodyWrap.y,-60);
  const {c}=setup();const roles=c.sgVfxRoles('counter',{vfxUlt:'indomitable'});
  assert.equal(roles.ground,'pillar-indomitable');
  const preset=JSON.parse(fs.readFileSync(require.resolve('../vfx/presets/pillar-indomitable.json'),'utf8'));
  assert.equal(preset.duration,5);assert.equal(preset.loop,false);
});

test('復甦時序：大步長不重複結算，空場照常完成，重置移除升空標記', () => {
  const {c,hits}=setup(),p=c.FIELD.player;
  p.hp=0;c.skills2TryLastStand(p);
  const ctx={pEnt:p,getEnemies:()=>c.FIELD.monsters,onDeaths(){}};
  c.GT=2.5;c.sgTickLastStand(ctx); assert.equal(hits.length,100);
  c.sgTickLastStand(ctx);assert.equal(hits.length,100);
  c.FIELD.monsters=[];c.GT=5;c.sgTickLastStand(ctx);
  assert.equal(p.hp,c.getStats().hp);assert.equal(p._sgRevival,undefined);
  p.skillCds['sg:counter']=0;p.hp=0;c.skills2TryLastStand(p);
  assert.ok(p._sgRevival);c.resetSkill2RT();assert.equal(p._sgRevival,undefined);
});
