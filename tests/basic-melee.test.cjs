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
/* 斜俯視投影：面向用世界向量，畫面縱向差要除以壓縮比（見 battle-renderer 的 GROUND_Y_SCALE） */
function groundScale() { return 'var GROUND_Y_SCALE = ' + /var GROUND_Y_SCALE = ([0-9.]+);/.exec(renderer)[1] + ';'; }
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
    areaRect:()=>null, documentHidden:()=>false, vfxTargetsLive:()=>true, screenPosOf:()=>({x:-50,y:0}),
    turnToward:(ent,dx,dy,sticky)=>turns.push([dx,dy,sticky]),
    playerAttackAnim:(...args)=>animations.push(args) };
  vm.createContext(c);
  vm.runInContext(groundScale()+fn(renderer,'screenToGroundY')+';'+fn(renderer,'shouldAnimatePlayer')+';'+fn(renderer,'onVfx'),c);
  for(const variant of ['melee','melee-extra']) c.onVfx({_buffered:true,fxKind:'slash',cat:'basic',variant,targets:['enemy'],dur:0.125});
  /* 神鑄【天罰】的落雷也是 basic、跟主普攻同一刻到：帶動的話同一刀會換成另一招而且不加速 */
  c.onVfx({_buffered:true,fxKind:'rain',cat:'basic',variant:'smite',targets:['enemy'],dur:0.4});
  assert.equal(presets,3);
  assert.deepEqual(animations,[['melee','enemy',0.125]]);
  assert.equal(c.S.player.facing,-1);
  /* 8 方向素材：精準面向目標（不帶遲滯），在出手動作之前轉好 */
  assert.deepEqual(turns,[[-50,0,false]]);
});
test('普攻三招隨機、不連續兩下同一招、隨高攻速加快；施法不被普攻插隊；死亡不播放動作', () => {
  /* 2026-09-22 主角換成騎士：普攻 Melee／Melee2＋借用特殊攻擊 1 的 attack3，隨機混著出（使用者要求）；
     施法用 Special1。多方向素材從 first 開始播，加速倍率要用「實際會播的幀數」算，不能用整條 frames。 */
  const manifest=JSON.parse(fs.readFileSync('images/sprites/knight/knight.json','utf8'));
  const anims={};
  for (const [k,a] of Object.entries(manifest.anims)) {
    if (a.frames) anims[k]=new Array(a.frames-(a.first||0)).fill(0);
  }
  for (const [k,a] of Object.entries(manifest.anims)) {
    const src=a.from&&manifest.anims[a.from];
    if (src) anims[k]=new Array(src.frames-Math.max(a.first||0,src.first||0)).fill(0);
  }
  assert.deepEqual(['attack1','attack2','attack3'].map(n=>!!anims[n]),[true,true,true]);
  const p={sheetName:'player',body:{animationSpeed:1},dead:false,curAnim:'idle'};
  const played=[];
  let seed=7;
  const rnd=()=>{ seed=(seed*1103515245+12345)%2147483648; return seed/2147483648; };
  const c={Math:Object.assign(Object.create(Math),{random:rnd}),S:{player:p,sheets:{player:{manifest,anims}}},
    playAnim(ent,name){played.push(name);ent.curAnim=name;p.body.animationSpeed=1;}};
  vm.createContext(c);
  vm.runInContext(fn(renderer,'playerAttackAnimNames')+';'+fn(renderer,'playerAttackAnim'),c);
  const natural=name=>anims[name].length/manifest.anims[name].fps*1000;
  for (let i=0;i<300;i++) {
    p.curAnim='idle';
    c.playerAttackAnim('melee','enemy',0.125);
    const name=played[played.length-1];
    assert.ok(Math.abs(p.body.animationSpeed-natural(name)/125)<1e-9,'攻速週期比動作短：整段加速塞進一次普攻（'+name+'）');
  }
  const count={};
  played.forEach(n=>{ count[n]=(count[n]||0)+1; });
  assert.deepEqual(Object.keys(count).sort(),['attack1','attack2','attack3'],'三招都會出');
  Object.values(count).forEach(n=>assert.ok(n>60,'三招出現次數差不多：'+JSON.stringify(count)));
  for (let i=1;i<played.length;i++) assert.notEqual(played[i],played[i-1],'不連續兩下同一招（第 '+i+' 下）');
  /* 固定輪流（1→2→3→1…）永遠不會出現「A、B、A」；隨機會 */
  assert.ok(played.some((n,i)=>i>=2&&n===played[i-2]),'不是固定輪流');
  p.curAnim='idle';
  c.playerAttackAnim('melee','enemy',2);
  assert.equal(p.body.animationSpeed,1,'週期比動作長：照原速');
  const before=played.length;
  c.playerAttackAnim('cast');
  assert.equal(played[before],'cast');
  c.playerAttackAnim('melee','enemy',0.125);
  assert.equal(played.length,before+1,'施法動作播完之前普攻不插隊');
  p.curAnim='idle'; p.dead=true;
  c.playerAttackAnim('melee','enemy',0.125);
  assert.equal(played.length,before+1,'死亡不播放動作');
});
