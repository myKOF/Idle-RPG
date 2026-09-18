'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const {createRequire}=require('module');
const root=path.resolve(__dirname,'..');
function schema(){
 const file=path.join(root,'tools/config_tables.cjs');
 const ctx={require:createRequire(file),__dirname:path.dirname(file),process,console};vm.createContext(ctx);
 vm.runInContext(fs.readFileSync(file,'utf8').split('/* ---- 進入點 ---- */')[0]+'\nthis.api={schema:SCHEMAS.Skills2,parse:csvParse,extractLiteral,evalLiteral};',ctx);
 return ctx.api;
}

test('bloodblade poison spread and disintegrate speed columns compile and drive flight timing',()=>{
 const a=schema(),rows=a.parse(fs.readFileSync(root+'/config/CSV/Skills2.csv','utf8')),h=rows[0];
 const col=h.indexOf('飛行子彈速度（米／秒）');
 for(const stage of ['5','10'])rows.find(r=>r[0]==='bloodblade'&&r[h.indexOf('階數')]===stage)[col]='20,2';
 const block=a.schema.rebuild(rows.slice(1),h).SKILLS2;
 const file=path.join(__dirname,'skill2-ult-evolution.test.cjs'),src=fs.readFileSync(file,'utf8');
 const ctx={require:createRequire(file),__dirname,console};vm.createContext(ctx);
 vm.runInContext(src.slice(0,src.indexOf('test('))+'\nthis.h={loadContext,maxLevels,equip,setUlt,stubVfx};',ctx);
 const c=ctx.h.loadContext();vm.runInContext(block,c);
 ctx.h.maxLevels(c,'bloodblade');ctx.h.equip(c,'bloodblade');ctx.h.stubVfx(c);
 for(const extra of [{vfxTier:5},{vfxUlt:'disintegrate'}]){
  if(extra.vfxUlt)ctx.h.setUlt(c,'bloodblade','disintegrate',10);
  const fx=extra.vfxUlt?c.SKILLS2.bloodblade.ult[2]:c.SKILLS2.bloodblade.tiers[4];
  fx.triggerVfx={projectile:'configured-blood-projectile'};
  assert.equal(fx.fx.speed,20);assert.equal(fx.fx.speedPer,2);
  c.sgQueueBloodFlight({hp:1,pos:{x:0,y:0}},{hp:1,pos:{x:400,y:0}},extra,{damage:1},{});
  assert.equal(c.SKILL2_RT.projectiles.at(-1).endAt,1,'(20+2×10)米/秒，40米需1秒');
 }
});
test('flight speed uses the merged column, rejects duplicate JSON and incomplete schemas',()=>{
 const a=schema(),rows=a.parse(fs.readFileSync(root+'/config/CSV/Skills2.csv','utf8')),header=rows[0];
 const i=header.indexOf('飛行子彈速度（米／秒）'),fi=header.indexOf('效果參數(JSON)');assert.ok(i>=0);
 const row=rows.slice(1).find(r=>r[0]==='icearrow'&&r[header.indexOf('階數')]==='1');
 assert.equal(Number(row[i]),58.5);assert.equal(JSON.parse(row[fi]).speed,undefined);
 const originalFx=row[fi];
 row[i]='72,2';row[fi]=JSON.stringify({...JSON.parse(originalFx),speed:1});
 assert.throws(()=>a.schema.rebuild(rows.slice(1),header),/不可重複填JSON.*speed/);
 row[fi]=originalFx;
 const block=a.schema.rebuild(rows.slice(1),header).SKILLS2;
 const groups=a.evalLiteral(a.extractLiteral(block,'SKILLS2').literal);
 assert.equal(groups.icearrow.tiers[0].fx.speed,72);assert.equal(groups.icearrow.tiers[0].fx.speedPer,2);assert.equal(groups.icearrow.tiers[0].fx.pct,250);
 assert.equal(groups.thunderorb.tiers[0].fx.speed,6);assert.equal(groups.windblade.tiers[0].fx.speed,18);
 row[i]='0';assert.throws(()=>a.schema.rebuild(rows.slice(1),header),/必須大於零/);
 row[i]='Infinity';assert.throws(()=>a.schema.rebuild(rows.slice(1),header),/格式錯誤/);
 const oldHeader=header.filter((_,n)=>n!==i),oldRows=rows.slice(1).map(r=>r.filter((_,n)=>n!==i));
 assert.throws(()=>a.schema.rebuild(oldRows,oldHeader),/缺少.*飛行子彈速度/,'新版欄位不可與舊格式混用');
});
test('edited flight speed drives projectile visuals and hit display delay together',()=>{
 const file=path.join(__dirname,'skill2-ice.test.cjs'),src=fs.readFileSync(file,'utf8');
 const context={require:createRequire(file),__dirname,console};vm.createContext(context);
 vm.runInContext(src.slice(0,src.indexOf("test("))+'\nthis.helpers={loadContext,stubHits,stubVfx,setLevels,equip,playerEnt,enemy};',context);
 const h=context.helpers;
 for(const speed of [58.5,72]){
  const c=h.loadContext(),calls=h.stubHits(c),specs=h.stubVfx(c);c.SKILLS2.icearrow.tiers[0].fx.speed=speed;
  const delays=[],hit=c.sgIcearrowHit;c.sgIcearrowHit=function(...args){delays.push(args[8]);return hit.apply(this,args);};
  h.setLevels(c,'icearrow',[1,0,0,0,0,0,0]);h.equip(c,'icearrow');const p=h.playerEnt();c.FIELD.player=p;
  const target=h.enemy(1e9,50,0,'target');c.castSkill2(p,[target],'icearrow','mv-float');
  const shot=specs.find(s=>s.variant==='ice-arrow');assert.ok(shot);assert.equal(c.sgIcearrowSpeed(),speed*10);
  assert.equal(shot.travelMs[0],Math.round(50/(speed*10)*1000));
  assert.equal(c.sgIcearrowTravelMs(target),shot.travelMs[0]);assert.ok(calls.length>0);
  assert.equal(delays[0],shot.travelMs[0]);
 }
});
test('migrated speed defaults preserve legacy travel and respond to edits',()=>{
 const file=path.join(__dirname,'skill2-ice.test.cjs'),src=fs.readFileSync(file,'utf8');
 const ctx={require:createRequire(file),__dirname,console};vm.createContext(ctx);
 vm.runInContext(src.slice(0,src.indexOf('test('))+'\nthis.c=loadContext();',ctx);const c=ctx.c;
 const target={hp:100,pos:{x:200,y:0}};
 for(const gid of ['knife','waterball']){
  const expected=c.bfTravelSeconds(target)/(gid==='waterball'?1.15:1);assert.ok(Math.abs(c.sgConfiguredTravelSeconds(gid,target)-expected)<1e-9);
  c.SKILLS2[gid].tiers[0].fx.speed*=2;
  assert.ok(Math.abs(c.sgConfiguredTravelSeconds(gid,target)-expected/2)<1e-9);
 }
 const original=c.sgFireballProjectilePlan(target);assert.equal(original.travelMs,Math.round(c.bfTravelSeconds(target)*1000/1.3));
 c.SKILLS2.fireball.tiers[0].fx.speed*=2;const faster=c.sgFireballProjectilePlan(target);
 assert.ok(Math.abs(faster.travelMs-original.travelMs/2)<=1);assert.equal(faster.speed,faster.length/(faster.travelMs/1000));
 const meteor=c.sgFireMeteorFallTiming();c.SKILLS2.fireball.tiers[6].fx.speed*=2;
 assert.ok(Math.abs(c.sgFireMeteorFallTiming().fallMs-meteor.fallMs/2)<=1);
 assert.equal(c.sgConfiguredFlightSpeed('thrust',1,0),480);assert.equal(c.sgConfiguredFlightSpeed('cleave',1,0),240);
 c.SKILLS2.cleave.tiers[0].fx.speed=48;assert.equal(c.sgConfiguredFlightSpeed('cleave',1,0),480);
});
