const test = require('node:test');
const assert = require('node:assert/strict');
const { createEngine } = require('../scripts/sim/engine');

function setup(id) {
  const e=createEngine({seed:42}).boot(null),c=e.ctx;
  c.G.player.level=1000;
  for(const gid of ['rockarmor','stormbarrier','cleave']) c.G.player.skills2.levels[gid]=Array(7).fill(10);
  c.G.player.skills.manaBarrier=10;
  c.G.player.loadout=['sg:cleave',id];
  c.markStatsDirty();c.initFieldPlayer();c.FIELD.player.mp=100000;
  c.gmArenaSpawn(1,'elite',1000000);
  const m=c.FIELD.monsters[0];m.pos={x:1500,y:0};m._enterCd=1;
  return {e,c,m,p:c.FIELD.player};
}

test('防禦提前起手：敵人仍在遠處進場，岩甲／暴風屏障／魔法屏障優先準備',()=>{
  for(const id of ['sg:rockarmor','sg:stormbarrier','manaBarrier']) {
    const {e,c,p}=setup(id);
    e.stepSeconds(0.1);
    assert.equal(p._skillCastId,id.replace('sg:',''));
    assert.ok(p._skillCastRemaining>0,'保留施法時間');
    e.stepSeconds(0.6);
    assert.ok(p.skillCds[id]>0,'遠處目標不阻止完成施放');
    if(id==='sg:rockarmor')assert.ok(c.SKILL2_RT.rock && p.shield>0);
    if(id==='sg:stormbarrier')assert.ok(c.SKILL2_RT.barrier);
    if(id==='manaBarrier')assert.ok(p.shield>0);
    assert.equal(p.skillCds['sg:cleave']||0,0,'攻擊技能不能隔空起手');
  }
});

test('提前防禦仍遵守法力、冷卻與復甦行動限制，空場不施放',()=>{
  for(const mode of ['mp','cooldown','revival','empty']) {
    const {e,c,p}=setup('sg:rockarmor');
    if(mode==='mp')p.mp=0;
    if(mode==='cooldown')p.skillCds['sg:rockarmor']=10;
    if(mode==='revival'){
      c.G.player.skills2.levels.counter=Array(7).fill(10);
      c.G.player.skills2.ult={};
      c.G.player.skills2.ult.counter={pick:c.sgUltIndexOfId('counter','indomitable'),lv:10};
      c.G.player.loadout.push('sg:counter');
      p.hp=0;c.onPlayerFieldDeath();
      assert.ok(p._sgRevival);
    }
    if(mode==='empty'){c.FIELD.monsters=[];c.FIELD.monster=null;}
    e.stepSeconds(0.1);
    assert.ok(!p._skillCastId,mode);
  }
});

test('自然進場首擊前岩甲已施放；敵人的首擊仍保留',()=>{
  const {e,c,p,m}=setup('sg:rockarmor');
  m.pos={x:440,y:0};
  let first=null;
  const attack=c.fieldMonsterAttack;
  c.fieldMonsterAttack=function(enemy,player){
    if(!first)first={t:c.GT,shield:player.shield,rock:!!c.SKILL2_RT.rock};
    return attack(enemy,player);
  };
  e.stepSeconds(3);
  assert.ok(first,'敵人仍出手');assert.ok(first.rock && first.shield>0);
});
