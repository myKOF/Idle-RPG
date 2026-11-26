'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const cfg=require('../tools/config_tables.cjs');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'js/data.js'),'utf8');
const bosses=cfg.evalLiteral(cfg.extractLiteral(source,'BOSS_LIST').literal);
const clips={idle:'Walk',walk:'Walk',attack1:'Attack1',attack2:'Attack2',attack3:'Attack3',die:'Die'};
const seconds={Walk:2/3,Attack1:1.2,Attack2:1.5,Attack3:1.5,Die:4};

test('all three BOSS9 appearances preserve the approved rig and five animation tracks, with final PBR materials',()=>{
  const expected=[
    ['',18622,'5c62fda4a16a033b97d7166cc968891d844b54870d0c7d6da69699a7e34a23d8','77c83731cb546c067252a77effa9a2cdcda7e5baaa0e8730b3b797bff423363e','6d176c75d8652240bc4478ad1274df67d2d99047282853a169f77eaca8e6e180'],
    ['_lv2',18581,'1ac5383fd404301c709325478c0495bebf4bd88892df6be7196036b4f4d9a8b4','f34a27f75e24c0d69fa1fe1952b1711bf091247b5106d2ae0afc573f714e3687','cee03770c8ef3a29f0494d44a078a56d257d6209abab8b318bbd70dcc7288d8c'],
    ['_lv3',18591,'7e7971e92ebb9ea2bdae569e787418588f602efe3a2c6c783a6c3d09a5804e40','8394ab9737116dcbbef28b52adfe0fafea644ba36fe1527aa3b2e8a999954d20','f1a3d8f435fdd01993ca46bc83764015d21552f46293f49e0a72c69db0a5df07']
  ];
  const materials=new Set();
  for(const [suffix,count,sourceSHA,posSHA,uvSHA] of expected){
  const bytes=fs.readFileSync(path.join(root,'images/models/npc3d/boss9'+suffix+'.glb'));
  const end=20+bytes.readUInt32LE(12),g=JSON.parse(bytes.subarray(20,end)),bin=bytes.subarray(end+8);
  const view=i=>{const a=g.accessors[i],v=g.bufferViews[a.bufferView];return bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength);};
  const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
  assert.equal(bytes.readUInt32LE(0),0x46546c67);assert.equal(bytes.readUInt32LE(8),bytes.length);
  assert.equal(g.skins[0].joints.length,73);assert.equal(g.meshes.length,1);
  assert.equal(g.asset.extras.approvedSourceSHA256,'3df3a9e486bb5e513eea3236212b2e61c316cd8a8cf52f1fab2bb5bf3a25cca0');
  assert.equal(g.asset.extras.pbrEmbedded,true);
  assert.equal(g.asset.extras.approvedAnimationSHA256,'e451d3ac591d5b08bffff618fbdf6d3c36cd543d73bc3896db9d0aab39240685');
  assert.equal(g.asset.extras.appearanceSourceSHA256,sourceSHA);
  assert.deepEqual(g.asset.extras.locomotion,{feet:['rearFoot.R','rearFoot.L'],hips:'hips'});
  const animHash=crypto.createHash('sha256');
  for(const a of g.animations){animHash.update(JSON.stringify(a));for(const s of a.samplers)for(const ai of [s.input,s.output])animHash.update(view(ai));}
  assert.equal(animHash.digest('hex'),'2deb56efc117b6caaec0b717e636f2517f974f4dedff8bb03969a164848c7fa3','all approved samplers, channels and raw animation samples remain byte-identical');
  const p=g.meshes[0].primitives[0];
  assert.equal(g.accessors[p.attributes.POSITION].count,count);assert.equal(g.accessors[p.indices].count,31269);
  assert.equal(hash(view(p.attributes.POSITION)),posSHA);assert.equal(hash(view(p.attributes.TEXCOORD_0)),uvSHA);
  assert.equal(g.accessors[p.attributes.WEIGHTS_0].count,count);assert.equal(g.accessors[p.attributes.JOINTS_0].count,count);
  assert.equal(g.images.length,3);assert.ok(g.images.every(i=>Number.isInteger(i.bufferView)));
  assert.ok(g.materials[0].normalTexture);assert.ok(g.materials[0].pbrMetallicRoughness.metallicRoughnessTexture);
  const color=g.images[g.textures[g.materials[0].pbrMetallicRoughness.baseColorTexture.index].source],v=g.bufferViews[color.bufferView];
  materials.add(hash(bin.subarray(v.byteOffset,v.byteOffset+v.byteLength)));
  for(const image of g.images){const v=g.bufferViews[image.bufferView],b=bin.subarray(v.byteOffset,v.byteOffset+v.byteLength);assert.equal(b.readUInt32BE(16),2048);assert.equal(b.readUInt32BE(20),2048);}
  const placement=g.nodes[g.scenes[g.scene||0].nodes[0]];
  assert.equal(placement.name,'BOSS9_GamePlacement');assert.deepEqual(placement.children,[0,74]);
  assert.equal(new Set(placement.scale).size,1);assert.ok(placement.scale[0]>1&&placement.scale[0]<1.5);
  assert.ok(placement.translation[1]>.9&&placement.translation[1]<1.1);
  assert.deepEqual(g.animations.map(a=>a.name),Object.keys(seconds));
  for(const a of g.animations){
    assert.ok(Math.abs(Math.max(...a.samplers.map(s=>g.accessors[s.input].max[0]))-seconds[a.name])<1e-6);
    assert.equal(a.channels.length,219);
    for(const c of a.channels){const s=a.samplers[c.sampler];assert.equal(g.accessors[s.input].count,g.accessors[s.output].count);}
  }
  assert.equal(g.animations.at(-1).extras.loop,false);assert.equal(g.animations.at(-1).extras.previewOnly,false);
  }
  assert.equal(materials.size,3,'each supplied appearance keeps its own material');
});

test('NPC workbook, CSV and generated BOSS9 bindings agree, without replacing other tower rows',()=>{
  const rows=cfg.csvParse(fs.readFileSync(path.join(root,'config/CSV/NPC.csv'),'utf8')).filter(r=>r.length>1);
  assert.deepEqual(cfg.readXlsxRows(path.join(root,'config/Excel/NPC.xlsx')),rows);
  const h=rows[0];
  for(const index of [8,18,28]){
  const suffix=index===8?'':'_lv'+(index===18?2:3),row=rows.find(r=>r[0]==='tower_boss_'+(index+1));
  const generated=cfg.SCHEMAS.NPC.extract(source).find(r=>r[0]==='tower_boss_'+(index+1));
  // Image diagnostics are generated by the table tool, not persisted source
  // data. All editable columns, including the portrait and six clips, match.
  for(let i=0;i<h.length;i++)if(h[i]!=='圖像備註')assert.equal(generated[i],row[i],h[i]);
  assert.equal(bosses[index].name,'風暴泰坦');assert.equal(bosses[index].attr,'lightning');
  assert.deepEqual(bosses[index].skills,{ex:['e_tornado','e_lightningspear'],rnd:[4,6]});
  assert.equal(bosses[index].atkSpeed,3);assert.equal(bosses[index].atkRange,32);assert.equal(bosses[index].runSpeed,21);
  assert.equal(row[h.indexOf('3D模型')],'images/models/npc3d/boss9'+suffix+'.glb');
  assert.deepEqual(bosses[index].model3d.clips,clips);
  const png=fs.readFileSync(path.join(root,'images/sprites/boss/boss9_lizard'+suffix+'.png'));
  assert.equal(png.readUInt32BE(16),1080);assert.equal(png.readUInt32BE(20),1080);assert.equal(png[25],6);
  }
  for(const index of [38,48])assert.equal(bosses[index].model3d,undefined);
});

test('makeBoss, ACT duration and Npc3D cycle all three clips at the existing attack rate; death keeps four seconds',async()=>{
  const c={STR:(_id,floor,name)=>floor+' '+name,BOSS_LIST:bosses,ELEMENTS:['lightning'],GT:0,
    towerBossDefFor:f=>bosses[(f-1)%50],bossStatsFor:()=>({level:10,hp:100,atk:10,def:5,mdef:5,aspd:3,dodge:0,hit:100,xp:5}),
    npcCombatProfile:b=>({aspd:b.atkSpeed,runSpeed:b.runSpeed,atkRange:b.atkRange,sightRange:b.sightRange})};
  vm.runInNewContext(fs.readFileSync(path.join(root,'js/tower.js'),'utf8'),c);
  for(const offset of [0,50,100])for(const [floor,suffix] of [[9,''],[19,'_lv2'],[29,'_lv3']])assert.equal(c.makeBoss(floor+offset).model3d.file,'images/models/npc3d/boss9'+suffix+'.glb');
  const boss=c.makeBoss(9),lock=c.towerBossActionDuration(boss);assert.ok(Math.abs(lock-.85/3)<1e-9);
  const ctrl={clips:Object.keys(seconds),pxPerMeter:100,locomotionMetersPerSecond:2,duration:n=>seconds[n],play:()=>{},update:()=>{}};
  const body={scale:{x:.5},hero3dPlay:()=>{body.animationSpeed=.5;}};
  const ctx={Hero3D:{create:async()=>ctrl,makeBody:()=>body}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'js/npc3d.js'),'utf8'),ctx);
  await ctx.Npc3D.create(boss.model3d);
  const idle=ctx.Npc3D.play(body,'idle');assert.equal(idle.clip,'Walk');assert.equal(idle.still,true);
  ctx.Npc3D.play(body,'walk');ctx.Npc3D.move(body,10,.1);assert.equal(body.animationSpeed,.5);
  for(const semantic of ['attack','cast','attack','attack']){
    const a=ctx.Npc3D.play(body,semantic,3,lock);
    assert.ok(Math.abs(seconds[a.clip]/(body.animationSpeed*2)-lock)<1e-9);
  }
  assert.equal(body.npc3d.attackKey,'attack1');
  const die=ctx.Npc3D.play(body,'die');assert.equal(die.clip,'Die');assert.equal(die.hold,true);assert.equal(body.animationSpeed,.5);
  assert.equal(ctrl.duration(die.clip)/(body.animationSpeed*2),4);
});

test('stalled corpse cleanup waits for a four-second death and fade, while short deaths retain the three-second fuse',()=>{
  const text=fs.readFileSync(path.join(root,'js/battle-renderer.js'),'utf8'),c={};
  vm.runInNewContext(text.slice(text.indexOf('  function deathCleanupTimeoutMs('),text.indexOf('  function startDeath(')),c);
  const boss={realDeath:true,sprDie:true,dieDur:4};
  assert.equal(c.deathCleanupTimeoutMs(boss),4800);
  assert.ok(c.deathCleanupTimeoutMs(boss)>4300);
  for(const e of [{realDeath:true,sprDie:true,dieDur:1},{realDeath:false,sprDie:true,dieDur:4},{realDeath:true,sprDie:false,dieDur:4},{realDeath:true,sprDie:true,dieDur:NaN}])assert.equal(c.deathCleanupTimeoutMs(e),3000);
  assert.match(text,/nowMs\(\) - e\.dieAt > deathCleanupTimeoutMs\(e\)/);
});

test('tower hp-zero snapshots trigger real death, while a live enemy removed for a switch still fades',()=>{
  const text=fs.readFileSync(path.join(root,'js/battle-renderer.js'),'utf8');
  const enemyPart=text.slice(text.indexOf('  function reconcileBattle('),text.indexOf('    /* 玩家：復活倒數'))+'\n}';
  for(const towerView of [true,false]){
    const d={name:'boss',level:1,hp:0,isBoss:true,towerBoss:true,floatSel:'tb-float'};
    const ent={data:{...d,hp:100},isBoss:true,isElite:false,state:'idle',nameText:{text:'boss'},statusText:{text:''}};
    const deaths=[],c={S:{entities:{'tb-float':ent},lastPos:{}},LASTPOS_KEEP_MS:1000,
      syncZone:()=>{},nowMs:()=>0,drawHpBar:()=>{},enemyNameText:x=>x.name,statusTextOf:()=>'',
      startDeath:(e,real)=>{deaths.push(real);e.state='dying';e.dieAt=0;},deathCleanupTimeoutMs:()=>4800};
    vm.runInNewContext(enemyPart,c);
    c.reconcileBattle({},{towerView,monsters:[d]});
    assert.deepEqual(deaths,[towerView]);
    assert.equal(ent.data.hp,towerView?0:100,'the tower defeat snapshot must reach the existing actor');
  }
});
