const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');

test('runtime uses T7 field, shares motion speed/turn, renews the same instance',()=>{
 const {c,m,f}=setup();const core=require('../js/vfx-core.js'),runtime=require('../js/vfx-runtime.js');
 const nodes=[];const backend={createNode(spec){const n={spec,t:[]};nodes.push(n);return n;},updateNode(n,t){n.t.push({...t});},destroyNode(){},destroy(){}};
 const adapter=runtime.create({core,resolver:{has:()=>true,resolve:id=>'/'+id},fxBackend:backend,zoneBackend:backend,ctx:{posOf:()=>({x:0,y:0}),playerPos:()=>({x:0,y:0})}});
 const preset={schemaVersion:1,id:'fire-tornado-infinite',duration:10,loop:true,layers:[{id:'body',type:'sprite',assetId:'test.png',scale:{x:1,y:1}}]};
 adapter.registerPresets([preset]);c.GT=.1;c.sgGroundMove(f,.1,[m]);
 const area=c.sgGroundArea(f);const spec={fxKind:'impact',variant:'pillar',dur:1,area,vfx:c.SKILLS2.firepillar.tiers[6].vfx};
 assert.equal(adapter.tryPlay(spec),true);adapter.update(.3);let a=nodes[0].t.at(-1);
 adapter.update(.01);let b=nodes[0].t.at(-1);
 assert.ok(Math.abs(Math.hypot(b.x-a.x,b.y-a.y)-.6)<.01);
 assert.equal(adapter.tryPlay(spec),true);assert.equal(adapter.stats().played,1);
 adapter.update(4);assert.equal(adapter.stats().fx.activeEffects,0);
});

function setup(level=1){
 const c={console,Math:Object.create(Math),setTimeout(){},clearTimeout(){},document:{addEventListener(){},getElementById(){return null;},querySelectorAll(){return[];}},UI:{dirty:{}},blog(){},floatText(){},trackDps(){},recordRunDamage(){}};
 c.window=c;vm.createContext(c);for(const f of ['util','data','status','formula','battlefield','combat','skills','skills2'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/'+f+'.js'),'utf8'),c);
 c.G={player:{skills2:{levels:{firepillar:[1,1,1,1,1,1,level]}},loadout:[]},stage:{current:1}};c.GT=0;c.chance=()=>false;c.sgLegend=()=>({});c.sgUlt=()=>null;c.Math.random=()=>0.3;
 const p={hp:1000,mp:10000,skillCds:{},buffs:{},effects:{},dots:[]};
 const m={hp:1e9,maxHp:1e9,pos:{x:200,y:0},effects:{},buffs:{},dots:[]};
 const st={matk:500,atk:1000};
 c.sgCastFirepillar(p,st,c.SKILLS2.firepillar,[1,1,1,1,1,1,level],[m],m,'mv-float',{});
 return {c,p,m,f:c.SKILL2_RT.grounds[0]};
}
test('T7 keeps two circular columns, adds six hits, scales damage and uses dark red field',()=>{
 const {c,f}=setup();assert.equal(c.SKILL2_RT.grounds.length,2);assert.equal(f.kind,'pillar');assert.equal(f.hits,12);assert.equal(f.gap,.5);assert.equal(f.dmgVal,660);assert.equal(f.length,0);assert.equal(f.width,0);assert.equal(f.radius,c.bfMeterPx(3)*1.12);assert.equal(f.speed,c.bfMeterPx(6));assert.equal(f.vfxTier,7);
 assert.equal(c.SKILLS2.firepillar.tiers[6].vfx.field,'fire-tornado-infinite');assert.equal(setup(10).f.dmgVal,1110);
});
test('single target never stops; motion event carries authoritative arc and no stopping destination',()=>{
 const {c,m,f}=setup();let length=0;
 for(let i=0;i<200;i++){const old={...f.pos};c.GT+=.01;c.sgGroundMove(f,.01,[m]);let d=Math.hypot(f.pos.x-old.x,f.pos.y-old.y);assert.ok(d>.59 && d<=.601);length+=d;const area=c.sgGroundArea(f);assert.equal(area.speed,60);assert.equal(area.turnRate,f.turnRate);assert.equal(area.destX,undefined);}
 assert.ok(length>119);assert.ok(Math.hypot(f.pos.x-m.pos.x,f.pos.y-m.pos.y)<100);
 m.hp=0;c.sgGroundMove(f,.01,[m]);assert.equal(f.huntTarget,null);
});
test('T7 respawns once, even if rebirth always succeeds; descendants retain movement',()=>{
 const {c,m,f}=setup();c.G.player.skills2.levels.firepillar[4]=0;c.chance=()=>true;c.SKILL2_RT.grounds=[];
 c.sgGroundExpire(f,[m],{});assert.equal(c.SKILL2_RT.grounds.length,1);
 const child=c.SKILL2_RT.grounds[0];assert.equal(child.respawnLeft,0);assert.equal(child.fireHunt,true);assert.equal(child.speed,60);assert.equal(child.hits,12);
 c.SKILL2_RT.grounds=[];c.sgGroundExpire(child,[m],{});assert.equal(c.SKILL2_RT.grounds.length,0);
});
test('lower tiers stay stationary and keep six hits; legend speed and hits remain additive',()=>{
 const {c,f}=setup(0);assert.equal(f.hits,6);assert.equal(f.fireHunt,false);assert.equal(f.speed,0);
 const x=setup();x.c.sgLegend=()=>({firepillarHitsAdd:{hits:3},firepillarChase:{mps:12,m:30}});x.c.SKILL2_RT.grounds=[];
 x.c.sgCastFirepillar(x.p,{matk:500},x.c.SKILLS2.firepillar,[1,1,1,1,1,1,1],[x.m],x.m,'mv-float',{});
 assert.equal(x.c.SKILL2_RT.grounds[0].hits,15);assert.equal(x.c.SKILL2_RT.grounds[0].speed,120);
});
test('infinite preset uses shared atlas without procedural generation',()=>{
 const p=JSON.parse(fs.readFileSync(path.join(__dirname,'../vfx/presets/fire-tornado-infinite.json')));
 assert.ok(require('../js/vfx-core.js').validatePreset(p).ok);
 assert.ok(!p.layers.some(l=>l.water));assert.equal(p.layers.find(l=>l.id==='baked-fire-column').tint,'#e85a48');
});
test('T7 sec is independently configurable and missing sec falls back to T1',()=>{
 const {c,p,m}=setup();
 const spawn=()=>{c.SKILL2_RT.grounds=[];c.sgCastFirepillar(p,{matk:500},c.SKILLS2.firepillar,[1,1,1,1,1,1,1],[m],m,'mv-float',{});return c.SKILL2_RT.grounds[0];};
 c.SKILLS2.firepillar.tiers[6].fx.sec=10;let f=spawn();assert.equal(f.hits*f.gap,10);
 delete c.SKILLS2.firepillar.tiers[6].fx.sec;f=spawn();assert.equal(f.hits*f.gap,3);
});
test('T1 and T7 durations and respawn duration are 3/6/6 seconds',()=>{
 const base=setup(0).f;assert.equal(base.hits*base.gap,3);
 const {c,m,f}=setup();assert.equal(f.hits*f.gap,6);c.G.player.skills2.levels.firepillar[4]=0;c.SKILL2_RT.grounds=[];
 c.sgGroundExpire(f,[m],{});const child=c.SKILL2_RT.grounds[0];assert.equal(child.hits*child.gap,6);
});
