const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const combat = fs.readFileSync('js/combat.js', 'utf8');
const renderer = fs.readFileSync('js/battle-renderer.js', 'utf8');
function fn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  const open = src.indexOf('{', start);
  let depth = 1, end = open + 1;
  for (; depth; end++) { if (src[end] === '{') depth++; if (src[end] === '}') depth--; }
  return src.slice(start, end);
}
function loadAttack() {
  const events = [], floats = [];
  const st = { aspd: 4, passives: {}, comboHits: 2, lifesteal: 0, manaSteal: 0 };
  const c = { Math, BASIC_DAMAGE_FLOAT_GROUP_SEQ: 0, getStats: () => st,
    playerAtkCfg: () => ({}), monsterDefCfg: () => ({}), slowFactor: () => 0.5,
    buffVal: () => 100, potentialVelocityFactor: () => 1,
    legendaryAttackSpeedMultiplier: () => 1, skill2AspdFactor: () => 2,
    playCombatVfx: e => events.push(e), vfxCombatRoles: () => ({attack:'slash-phys',hit:'hit-phys'}),
    enemyEventFloatTarget: m => m.floatSel, playerEventFloatTarget: () => 'pv-float',
    floatEnemyEvent: (...args) => floats.push(args), fmt: String,
    combatDamageFloatClass: () => 'dmg', trackDps() {}, recordRunDamage() {}, blog() {},
    lifestealHealAmount: () => 0, rollComboHits: () => 2,
    resolveHit(p,m) { m.hp -= 100; return {dmg:100, procs:[], killed:m.hp<=0}; }
  };
  vm.createContext(c);
  for (const n of ['basicDamageFloatGroupClass','playerBasicAttackRate','doPlayerAttack']) vm.runInContext(fn(combat,n),c);
  return {c,events,floats};
}
test('近戰普攻立即傷害、零飛行，連擊延遲與浮字同步且攻速週期共用', () => {
  const {c,events,floats}=loadAttack();
  const m={hp:10000,floatSel:'mv-float-1'};
  c.doPlayerAttack({hp:1000},m,m.floatSel);
  assert.equal(m.hp,9700);
  assert.equal(events.length,3);
  assert.deepEqual(events.map(e=>e.variant),['melee','melee-extra','melee-extra']);
  assert.ok(events.every(e=>e.fxKind==='slash' && e.travelMs[0]===0 && e.dur===0.125));
  const runtime=require('../js/vfx-runtime.js');
  assert.ok(events.every(e=>runtime.primaryRoleOf(e,e.vfx)==='hit'));
  assert.deepEqual(events.map(e=>e.delayMs),[0,130,260]);
  assert.deepEqual(floats.map(e=>e[5]),[0,130,260]);
  assert.ok(floats.every(e=>e[3].includes('damage-group-basic-1')));
  c.doPlayerAttack({hp:1000},m,m.floatSel);
  assert.ok(floats[3][3].includes('damage-group-basic-2'));
});
test('Preset 接手仍播放主普攻，追加連擊不重播，面向目標', () => {
  const animations=[], turns=[]; let presets=0;
  const c={ S:{ready:true,player:{root:{x:0,y:0}},entities:{},vfxrt:{tryPlay(){presets++;return true;}}},
    areaRect:()=>null, documentHidden:()=>false, vfxTargetsLive:()=>true, posOf:()=>({x:-50,y:0}),
    turnToward:(ent,dx,dy,sticky)=>turns.push([dx,dy,sticky]),
    playerAttackAnim:(...args)=>animations.push(args) };
  vm.createContext(c);
  vm.runInContext(fn(renderer,'shouldAnimatePlayer')+';'+fn(renderer,'onVfx'),c);
  for(const variant of ['melee','melee-extra']) c.onVfx({_buffered:true,fxKind:'slash',cat:'basic',variant,targets:['enemy'],dur:0.125});
  assert.equal(presets,2);
  assert.deepEqual(animations,[['melee','enemy',0.125]]);
  assert.equal(c.S.player.facing,-1);
  /* 8 方向素材：精準面向目標（不帶遲滯），在出手動作之前轉好 */
  assert.deepEqual(turns,[[-50,0,false]]);
});
test('普攻輪流兩段、隨高攻速加快；施法不被普攻插隊；死亡不播放動作', () => {
  /* 2026-09-22 主角換成騎士：普攻兩段（Melee／Melee2）輪流，施法用 Special1。
     多方向素材從 first 開始播，加速倍率要用「實際會播的幀數」算，不能用整條 frames。 */
  const manifest=JSON.parse(fs.readFileSync('images/sprites/knight/knight.json','utf8'));
  const anims={};
  for (const [k,a] of Object.entries(manifest.anims)) if (a.frames) anims[k]=new Array(a.frames-(a.first||0)).fill(0);
  const p={sheetName:'player',body:{animationSpeed:1},dead:false,curAnim:'idle'};
  const played=[];
  const c={Math,S:{player:p,sheets:{player:{manifest,anims}}},
    playAnim(ent,name){played.push(name);ent.curAnim=name;p.body.animationSpeed=1;}};
  vm.createContext(c);
  vm.runInContext(fn(renderer,'playerAttackAnimNames')+';'+fn(renderer,'playerAttackAnim'),c);
  const natural=name=>anims[name].length/manifest.anims[name].fps*1000;
  c.playerAttackAnim('melee','enemy',0.125);
  assert.equal(played[0],'attack1');
  assert.ok(Math.abs(p.body.animationSpeed-natural('attack1')/125)<1e-9,'攻速週期比動作短：整段加速塞進一次普攻');
  p.curAnim='idle';
  c.playerAttackAnim('melee','enemy',2);
  assert.equal(played[1],'attack2','輪流，不是隨機');
  assert.equal(p.body.animationSpeed,1,'週期比動作長：照原速');
  c.playerAttackAnim('cast');
  assert.equal(played[2],'cast');
  c.playerAttackAnim('melee','enemy',0.125);
  assert.equal(played.length,3,'施法動作播完之前普攻不插隊');
  p.curAnim='idle'; p.dead=true;
  c.playerAttackAnim('melee','enemy',0.125);
  assert.equal(played.length,3,'死亡不播放動作');
});
