const test=require('node:test'),assert=require('node:assert/strict');
const {createEngine}=require('../scripts/sim/engine');
for(const ult of [null,'infernoTempest','eternalInferno','dragonDevour']) {
  test('烈焰衝擊只在消失播放，無龍捲場域繼承：'+ult,()=>{
    const c=createEngine({seed:42}).boot(null).ctx;
    c.G.player.level=1000;c.G.player.loadout=['sg:firepillar'];
    c.G.player.skills2.levels.firepillar=Array(7).fill(10);
    if(ult)c.G.player.skills2.ult={firepillar:{pick:c.sgUltIndexOfId('firepillar',ult),lv:10}};
    c.initFieldPlayer();c.gmArenaSpawn(1,'elite',1000000);
    const p=c.FIELD.player,m=c.FIELD.monsters[0];m.pos={x:10,y:0};m._enterCd=0;p.mp=1e9;
    const events=[];c.playCombatVfx=s=>events.push(s);
    c.castSkill2(p,[m],'firepillar','mv-float');
    const f=c.SKILL2_RT.grounds.find(f=>f.kind==='pillar');assert.ok(f);
    const ctx={getEnemies:()=>[m]};
    c.sgGroundTick(f,[m],ctx);
    assert.ok(events.length);
    assert.ok(events.every(s=>!s.vfx.attack),'平時不播放爆炸');
    assert.ok(events.some(s=>s.vfx.field==='fire-tornado-infinite'));
    const hp=m.hp;events.length=0;
    c.sgGroundExpire(f,[m],ctx);
    const explosions=events.filter(s=>s.variant==='firepillar-impact');
    assert.equal(explosions.length,1);
    assert.deepEqual(Object.keys(explosions[0].vfx).sort(),['attack','hit']);
    assert.equal(explosions[0].vfx.attack,'burst-fire-shockwave');
    assert.equal(explosions[0].vfx.hit,'hit-fire');
    assert.equal(explosions[0].area.r,c.bfMeterPx(c.sgVal(c.SKILLS2.firepillar.tiers[4].fx,'m',10)));
    assert.ok(m.hp<hp);
  });
}
