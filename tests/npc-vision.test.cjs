'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const cfg = require('../tools/config_tables.cjs');
const { loadEliteEnv, makeElite, stepElite } = require('./helpers/elite-env.cjs');
const root = path.resolve(__dirname, '..');
function geometry() {
  const c = vm.createContext({console});
  vm.runInContext(fs.readFileSync(path.join(root,'js/battlefield.js'),'utf8'),c);
  return c;
}
function enemy(x,y,extra) {
  return Object.assign({hp:100,pos:{x,y},sightRange:500,runSpeed:120,atkRange:60,_alerted:false},extra);
}
test('視野外維持站位；邊界內發現玩家後開始追擊',()=>{
  const c=geometry(),m=enemy(501,0);
  c.bfTickApproach([m],1);
  assert.equal(m.pos.x,501); assert.equal(m._alerted,false);
  c.BF_PLAYER.x=1;
  c.bfTickApproach([m],1);
  assert.equal(m._alerted,true); assert.equal(m.pos.x,381);
});
test('全方向圓形視野依中心距離，BOSS 體型不延長視野',()=>{
  const c=geometry();
  for (const [x,y] of [[500,0],[-500,0],[0,500],[0,-500],[300,400]]) assert.equal(c.bfEnemyAlerted(enemy(x,y)),true);
  assert.equal(c.bfEnemyAlerted(enemy(400,400)),false);
  assert.equal(c.bfEnemyAlerted(enemy(501,0,{_bodyR:300,isBoss:true})),false);
});
test('發現狀態各自獨立；離開視野後仍追玩家當前位置',()=>{
  const c=geometry(),a=enemy(400,0),b=enemy(1500,0);
  c.bfTickApproach([a,b],.1);
  assert.equal(a._alerted,true); assert.equal(b._alerted,false);
  c.BF_PLAYER.x=-2000;
  const before=a.pos.x;
  c.bfTickApproach([a,b],1);
  assert.equal(a.pos.x,before-120); assert.equal(b.pos.x,1500);
});
test('進場倒數期間不發現、不移動、不普攻；進場後再檢查',()=>{
  const c=geometry(),m=enemy(100,0,{_enterCd:1,atkRange:300});
  assert.equal(c.bfInAttackRange(m),false);
  c.bfTickApproach([m],1);
  assert.equal(m.pos.x,100); assert.equal(m._alerted,false);
  m._enterCd=0;
  assert.equal(c.bfInAttackRange(m),true); assert.equal(m._alerted,true);
});
test('射程超出視野的遠程怪也不能提前攻擊；發現後仍須進入射程',()=>{
  const c=geometry(),m=enemy(600,0,{atkRange:1000});
  assert.equal(c.bfInAttackRange(m),false);
  m.pos.x=500;
  assert.equal(c.bfInAttackRange(m),true);
  m.pos.x=2000;
  assert.equal(c.bfEnemyAlerted(m),true); assert.equal(c.bfInAttackRange(m),false);
});
test('新敵人未發現狀態重置；沒有視野欄位的舊替身保留行為',()=>{
  const c=loadEliteEnv(),mt=c.NPC_CONFIG_TABLE.desert_1,zn=c.currentZoneDef(),base=c.monsterStatsFor(1,false,false);
  const a=c.makeFieldEnemy(mt,base,zn,1,{enterCd:0}); a.pos={x:100,y:0}; c.bfEnemyAlerted(a);
  const b=c.makeFieldEnemy(mt,base,zn,1,{enterCd:0});
  assert.equal(a._alerted,true); assert.equal(b._alerted,false); assert.equal(b.sightRange,500);
  const legacy={hp:100,pos:{x:10000,y:0},runSpeed:120}; c.bfTickApproach([legacy],1);
  assert.equal(legacy.pos.x,9880);
});
test('NPC 配置 346 列全部預填 50 米，CSV／JS 各階級與塔 BOSS 一致',()=>{
  const c=loadEliteEnv(),rows=cfg.csvParse(fs.readFileSync(path.join(root,'config/CSV/NPC.csv'),'utf8'));
  const h=rows.shift(),i=n=>h.indexOf(n);
  assert.equal(rows.length,346);
  for(const r of rows){
    const id=r[i('NPC識別碼')],tier=r[i('類型')];
    assert.equal(r[i('視野範圍(米)')],'50',id+' '+tier);
    if(tier==='tower_boss') assert.equal(c.BOSS_LIST.find(b=>b.id===id).sightRange,50);
    else assert.equal(c.NPC_CONFIG_TABLE[id].sightRanges[tier],50);
  }
});
test('配置各階級獨立、留白預設；非法視野中止',()=>{
  const src=fs.readFileSync(path.join(root,'js/data.js'),'utf8'),sc=cfg.SCHEMAS.NPC;
  const rows=sc.extract(src),idx=sc.header.indexOf('視野範圍(米)');
  rows[0][idx]='12';rows[1][idx]='25';rows[2][idx]='35';rows[3][idx]='45'; rows[rows.length-1][idx]='17';
  const out=sc.rebuild(rows,sc.header,src),c=geometry();
  Object.values(out).forEach(s=>vm.runInContext(s,c));
  assert.deepEqual(JSON.parse(JSON.stringify(c.DESERT_POOL[0].sightRanges)),{normal:12,elite:25,elite_adv:35,boss:45});
  assert.equal(c.BOSS_LIST.at(-1).sightRange,17);
  let rebuilt=src;
  for(const [name,code] of Object.entries(out)) {
    const found=cfg.extractLiteral(rebuilt,name);
    rebuilt=rebuilt.slice(0,found.declStart)+code+rebuilt.slice(found.end);
  }
  assert.deepEqual(sc.extract(rebuilt).map(r=>r[idx]),rows.map(r=>r[idx]),'每一階級與塔 BOSS 的自訂視野能完整往返');
  const sim=loadEliteEnv();vm.runInContext(rebuilt,sim);
  const mt=sim.NPC_CONFIG_TABLE.desert_1;
  assert.equal(sim.npcSightRange(mt,'normal'),120);
  assert.equal(sim.npcSightRange(mt,'elite_adv'),350);
  for(const invalid of ['0','-1','oops','Infinity','1e309']){
    rows[0][idx]=invalid; assert.throws(()=>sc.rebuild(rows,sc.header,src),/視野範圍/);
  }
  rows[0][idx]='';
  const blank=sc.rebuild(rows,sc.header,src);vm.runInContext(blank.DESERT_POOL,c);
  assert.equal(c.DESERT_POOL[0].sightRanges.normal,50);
});
test('生成普通／菁英／高級菁英／BOSS 使用各列視野並換算為座標',()=>{
  const c=loadEliteEnv(),mt=Object.assign({},c.NPC_CONFIG_TABLE.desert_1,{sightRanges:{normal:12,elite:25,elite_adv:35,boss:45}});
  const zn=c.currentZoneDef(),base=c.monsterStatsFor(1,false,false);
  const normal=c.makeFieldEnemy(mt,base,zn,1,{enterCd:0});assert.equal(normal.sightRange,120);
  const elite=c.makeFieldEnemy(mt,base,zn,1,{elite:true,enterCd:0});assert.equal(elite.sightRange,250);
  c.equipEliteEnemy(elite,mt,'elite_adv',1,{ids:[]});assert.equal(elite.sightRange,350);
  const boss=c.makeFieldEnemy(mt,base,zn,1,{boss:true,enterCd:0});assert.equal(boss.sightRange,450);
});
test('菁英視野外不跑位不主動施法；進入後才施放',()=>{
  const c=loadEliteEnv(),id=Object.keys(c.ELITE_AFFIXES).find(id=>c.ELITE_AFFIXES[id].kind==='active'&&!c.ELITE_AFFIXES[id].repo);
  assert.ok(id);
  const m=makeElite(c,[id],{x:600});m.sightRange=500;
  m._el.cd[id]=0; m._el.repoAt=c.GT;
  let casts=0;c.eliteCast=()=>casts++;
  stepElite(c,2);
  assert.equal(casts,0); assert.equal(m._rp,undefined); assert.equal(m._alerted,false);
  c.BF_PLAYER.x=101;
  stepElite(c,.1);
  assert.equal(m._alerted,true); assert.ok(casts>0);
});
test('野外普攻不得繞過視野；發現後依原傷害管線出手',()=>{
  const c=loadEliteEnv(),m=makeElite(c,[],{x:600});m.sightRange=500;m.atkRange=1000;
  let attacks=0;c.doMonsterAttack=()=>{attacks++;return {};};
  c.fieldMonsterAttack(m,c.FIELD.player);assert.equal(attacks,0);
  c.BF_PLAYER.x=100;
  c.fieldMonsterAttack(m,c.FIELD.player);assert.equal(attacks,1);
});
test('封魔塔 BOSS 使用自己的配置視野、發現前技能與攻擊受同一判定',()=>{
  const c=loadEliteEnv();c.BOSS_LIST[0].sightRange=12;
  const b=c.makeBoss(1);b.pos={x:260,y:0};
  c.TOWER.boss=b;c.TOWER.player=c.FIELD.player;c.TOWER.introCd=0;c.G.tower.active=true;
  assert.equal(b.sightRange,120);assert.equal(b._alerted,false);
  assert.equal(c.eliteReady(b),false);assert.equal(c.bfInAttackRange(b),false);
  c.BF_PLAYER.x=140;
  assert.equal(c.eliteReady(b),true);assert.equal(b._alerted,true);
});
test('正式 Worker 載入配置並將視野前後的權威位置傳入 battle 面板',()=>{
  const engine=require('../scripts/sim/engine').createEngine({seed:161050}).boot(null),c=engine.ctx;
  const mt=c.NPC_CONFIG_TABLE.desert_2,zn=c.currentZoneDef(),base=c.monsterStatsFor(1,false,false);
  const m=c.makeFieldEnemy(mt,base,zn,1,{enterCd:0});m.pos={x:600,y:0};
  c.FIELD.monsters=[m];c.FIELD.monster=m;c.FIELD.playerPos=c.bfPlayerPos();c.bfResetPlayer();
  c.bfTickApproach([m],1);
  let panel=c.buildPanel('battle');
  assert.equal(panel.field.monsters[0].sightRange,500);
  assert.equal(panel.field.monsters[0].pos.x,600);assert.equal(m._alerted,false);
  c.BF_PLAYER.x=100;c.bfTickApproach([m],1);
  panel=c.buildPanel('battle');
  assert.equal(m._alerted,true);assert.ok(m.pos.x<600);
  assert.equal(panel.field.monsters[0].pos.x,m.pos.x);
  assert.equal(panel.field.playerPos.x,100);
  assert.equal(engine.outbox().filter(msg=>msg.type===c.MSG_OUT.ERROR).length,0);
});
