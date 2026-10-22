const test=require('node:test'),assert=require('node:assert/strict');const {createEngine}=require('../scripts/sim/engine');
test('火鳳遼原主殞石保留殞石外觀與落地爆點，伴生火球獨立讀超神外觀',()=>{
  const c=createEngine({seed:42}).boot(null).ctx;
  c.G.player.level=1000;c.G.player.loadout=['sg:fireball'];
  c.G.player.skills2.levels.fireball=Array(7).fill(10);
  c.G.player.skills2.ult={fireball:{pick:c.sgUltIndexOfId('fireball','phoenixPrairie'),lv:10}};
  c.initFieldPlayer();c.gmArenaSpawn(1,'elite',1000000);
  const p=c.FIELD.player,m=c.FIELD.monsters[0];m.pos={x:10,y:0};m._enterCd=0;p.mp=1e9;
  const events=[];c.playCombatVfx=s=>events.push(s);const hp=m.hp;
  c.castSkill2(p,[m],'fireball','mv-float');
  const launches=events.filter(s=>s.variant==='meteor');
  assert.equal(launches.length,4);
  assert.ok(launches.every(s=>s.vfx.projectile==='proj-meteor-inferno'&&s.hit===false));
  assert.equal(m.hp,hp);
  c.GT=c.SKILL2_RT.meteors[0].at;c.sgTickMeteors({});
  assert.equal(events.find(s=>s.variant==='meteor-impact').vfx.hit,'burst-meteor-inferno');
  const balls=events.filter(s=>s.variant==='fireball-small');
  assert.equal(balls.length,6);assert.ok(balls.every(s=>s.vfx.projectile==='proj-fireball'));
  assert.ok(m.hp<hp);
  const queued=c.SKILL2_RT.meteors.filter(s=>s.vfxUlt==='phoenixPrairie');
  assert.equal(queued.length,6);
  c.GT=queued[0].at;c.sgTickMeteors({});
  assert.equal(events.find(s=>s.variant==='fire-explosion').vfx.hit,'hit-fire-explosion');
});
test('殞石起飛不播攻擊爆炸或受擊，落地才傷害與爆點；擊殺保留特效目標',()=>{const c=createEngine({seed:42}).boot(null).ctx;c.G.player.level=1000;c.G.player.loadout=['sg:fireball'];c.G.player.skills2.levels.fireball=Array(7).fill(10);c.initFieldPlayer();c.gmArenaSpawn(1,'elite',1000000);const p=c.FIELD.player,m=c.FIELD.monsters[0];m.pos={x:10,y:0};m._enterCd=0;p.mp=1e9;const events=[];c.playCombatVfx=s=>events.push(s);const hp=m.hp;c.castSkill2(p,[m],'fireball','mv-float');const launches=events.filter(s=>s.variant==='meteor');assert.ok(launches.length);assert.ok(launches.every(s=>s.hit===false&&!s.vfx.attack&&!s.vfx.hit&&s.vfx.projectile));assert.equal(m.hp,hp);const at=c.SKILL2_RT.meteors[0].at;c.GT=at-0.001;c.sgTickMeteors({});assert.equal(m.hp,hp);assert.equal(events.filter(s=>s.variant==='meteor-impact').length,0);m.hp=1;c.chance=x=>x>0;c.GT=at;c.sgTickMeteors({});assert.equal(m.hp,0);const impact=events.find(s=>s.variant==='meteor-impact');assert.ok(impact);assert.equal(impact.vfx.hit,'burst-meteor-inferno');assert.ok(impact.targets.length&&impact.preserveDeadTargets);});
test('殞石落地時目標已死，仍依落點範圍送落地特效（地裂不缺）',()=>{
  const c=createEngine({seed:42}).boot(null).ctx;
  c.G.player.level=1000;c.G.player.loadout=['sg:fireball'];
  c.G.player.skills2.levels.fireball=Array(7).fill(10);
  c.initFieldPlayer();c.gmArenaSpawn(1,'elite',1000000);
  const p=c.FIELD.player,m=c.FIELD.monsters[0];m.pos={x:10,y:0};m._enterCd=0;p.mp=1e9;
  const events=[];c.playCombatVfx=s=>events.push(s);
  c.castSkill2(p,[m],'fireball','mv-float');
  const queued=c.SKILL2_RT.meteors.filter(s=>s.variant==='meteor-impact');
  assert.ok(queued.length>=2);
  m.hp=0;
  c.GT=Math.max(...queued.map(s=>s.at));c.sgTickMeteors({});
  const impacts=events.filter(s=>s.variant==='meteor-impact');
  assert.equal(impacts.length,queued.length);
  assert.ok(impacts.every(s=>s.vfx.hit==='burst-meteor-inferno'&&s.area&&s.area.r>0&&s.targets.length===0));
});
test('隕石坑：落地後 4 秒內每 0.5 秒對坑上敵人打一次，坑外不受傷；火／雷各用自己的屬性',()=>{
  const c=createEngine({seed:42}).boot(null).ctx;
  c.G.player.level=1000;c.G.player.loadout=['sg:fireball'];
  c.G.player.skills2.levels.fireball=Array(7).fill(10);
  c.initFieldPlayer();c.gmArenaSpawn(2,'elite',1000000);
  const p=c.FIELD.player,[a,b]=c.FIELD.monsters;a.pos={x:10,y:0};a._enterCd=0;b.pos={x:900,y:900};b._enterCd=0;p.mp=1e9;
  a.hp=a.maxHp=1e15;b.hp=b.maxHp=1e15;
  const events=[];c.playCombatVfx=s=>events.push(s);
  c.castSkill2(p,[a],'fireball','mv-float');
  const queued=c.SKILL2_RT.meteors.filter(s=>s.variant==='meteor-impact');
  c.GT=queued[0].at;c.sgTickMeteors({});
  const craters=c.SKILL2_RT.grounds.filter(f=>f.kind==='meteorcrater');
  assert.ok(craters.length>=1);
  assert.ok(craters.every(f=>f.hitElem==='fire'&&f.hits===8&&f.gap===0.5&&f.radius>0));
  const ctx={getEnemies:()=>[a,b]};
  const hpA=a.hp,hpB=b.hp,start=c.GT;
  events.length=0;
  c.GT=start+0.49;c.sgTickGrounds(.49,ctx);assert.equal(a.hp,hpA);
  c.GT=start+0.5;c.sgTickGrounds(.01,ctx);assert.ok(a.hp<hpA);assert.equal(b.hp,hpB);
  assert.equal(events.filter(s=>s.fxKind==='aura').length,0);   // 坑痕由落地 Preset 自己播，不再補特效
  let t=start+0.5;for(let i=2;i<=8;i++){t=start+i*0.5;c.GT=t;c.sgTickGrounds(.5,ctx);}
  const afterLife=c.SKILL2_RT.grounds.filter(f=>f.kind==='meteorcrater').length;
  assert.equal(afterLife,0);
});
test('雷隕石坑：解析到 hit-thunderfall-impact 才生成雷電屬性的坑',()=>{
  const c=createEngine({seed:42}).boot(null).ctx;
  c.initFieldPlayer();c.gmArenaSpawn(1,'elite',1000000);
  const p=c.FIELD.player,m=c.FIELD.monsters[0];m.pos={x:10,y:0};m._enterCd=0;m.hp=m.maxHp=1e15;
  c.playCombatVfx=()=>{};
  const out={killed:false,dmg:0,crit:false};
  c.GT=1;
  for(const [hit,elem] of [['hit-thunderfall-impact','lightning'],['burst-meteor-inferno','fire'],['hit-fire','']]){
    c.SKILL2_RT.grounds.length=0;
    c.sgQueueMeteor(p,c.getStats(),1000,m,[m],150,null,'mv-float',out,1,{gid:'stormbarrier',variant:'meteor-impact',vfxRoles:{hit}});
    c.sgTickMeteors({});
    const f=c.SKILL2_RT.grounds.filter(g=>g.kind==='meteorcrater');
    if(elem){assert.equal(f.length,1);assert.equal(f[0].hitElem,elem);assert.equal(f[0].dmgVal,1000);}
    else assert.equal(f.length,0);
  }
});
