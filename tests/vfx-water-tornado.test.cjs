'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const core=require('../js/vfx-core.js');
const pixiBackend=require('../js/vfx-pixi-backend.js');
const runtime=require('../js/vfx-runtime.js');
const preset=JSON.parse(fs.readFileSync(path.join(__dirname,'../tools/vfx/authoring/author/water-tornado-source.json'),'utf8'));

test('WATER shipped animation has no procedural work for four concurrent tornadoes',()=>{
 const p=JSON.parse(fs.readFileSync(path.join(__dirname,'../vfx/presets/field-water-tornado.json')));
 assert.ok(p.layers.every(l=>l.type!=='procedural'));
 const atlas=p.layers.find(l=>l.sheet);assert.equal(atlas.sheet.count,80);assert.equal(atlas.sheet.fps,20);
 assert.deepEqual(p.sizing,preset.sizing);
 const r=core.createRuntime({resolver:{resolve:id=>id},backend:{createNode(s){assert.notEqual(s.kind,'generated');return{}},updateNode(n,t){assert.equal(t.generated,undefined)},destroyNode(){}}});
 r.registerPreset(p);for(let i=0;i<4;i++){r.play(p.id);r.update(.05);}
 for(let i=0;i<240;i++)r.update(1/60);
 r.destroy();
 assert.ok(fs.existsSync(path.join(__dirname,'../images/vfx/assets',atlas.assetId)));
});

test('FIRE shipped effect uses one shared atlas and live particles, with no procedural CPU work',()=>{
 const p=JSON.parse(fs.readFileSync(path.join(__dirname,'../vfx/presets/fire-tornado-inferno.json')));
 assert.ok(p.layers.every(l=>l.type!=='procedural'));
 const frames=p.layers.filter(l=>l.sheet);assert.equal(frames.length,1);
 assert.equal(frames[0].sheet.count,80);assert.equal(frames[0].sheet.fps,20.8);
 for(const id of ['crown-flame-jets','ground-flames','dust'])assert.equal(p.layers.find(l=>l.id===id).duration,p.duration);
 assert.ok(fs.existsSync(path.join(__dirname,'../images/vfx/assets',frames[0].assetId)));
});

test('FIRE palette animates without mutating cached water geometry or pixels',()=>{
 const gen=require('../js/vfx-water-tornado.js');
 for(const part of ['body','front-sheets','bloom']) {
  const water=gen.sample(part,.8);const before=structuredClone(water);
  const fire=gen.sample(part,.8,1,'fire');
  assert.notEqual(fire.key,water.key);
  assert.deepEqual(water,before);
  assert.notDeepEqual(fire,gen.sample(part,1.2,1,'fire'));
 }
 const p=structuredClone(preset);p.layers.filter(l=>l.water).forEach(l=>l.water.palette='fire');
 assert.equal(core.validatePreset(p).ok,true);
 const round=JSON.parse(core.serialisePreset(p));
 assert.equal(round.layers.find(l=>l.water).water.palette,'fire');
 round.layers.find(l=>l.water).water.palette='invalid';
 assert.equal(core.validatePreset(round).ok,false);
});

test('WATER radius profile independently controls ends and center; default is an identity',()=>{
 const p=preset.layers.find(l=>l.id==='body').radiusProfile;
 for(let y=0;y<=1;y+=.01) assert.equal(core.radiusProfileScale(p,y),1);
 assert.equal(core.radiusProfileScale({...p,topRatio:4},p.topY),2);
 assert.equal(core.radiusProfileScale({...p,topRatio:4},p.centerY),1);
 assert.equal(core.radiusProfileScale({...p,topRatio:4},p.bottomY),1);
 assert.equal(core.radiusProfileScale({...p,bottomRatio:1},p.bottomY),.5);
 assert.equal(core.radiusProfileScale({...p,centerScale:1.5},p.centerY),1.5);
});

test('WATER profile schema rejects invalid or unsupported input and roundtrips',()=>{
 assert.equal(core.validatePreset(preset).ok,true);
 assert.equal(core.serialisePreset(JSON.parse(core.serialisePreset(preset))),core.serialisePreset(preset));
 for(const change of [{topRatio:0},{bottomRatio:Infinity},{centerScale:9},{centerY:1},{topRatio:NaN},{typo:2}]){
  const p=structuredClone(preset); Object.assign(p.layers.find(l=>l.id==='body').radiusProfile,change);
  assert.equal(core.validatePreset(p).ok,false,JSON.stringify(change));
 }
 const p=structuredClone(preset);p.layers.find(l=>l.id==='body').type='particle';assert.equal(core.validatePreset(p).ok,false);
});

function fakePixi(){
 const textures=[];
 class Rectangle {constructor(x,y,width,height){Object.assign(this,{x,y,width,height});}}
 class Texture {constructor(o={}){this.source=o.source||{};this.frame=o.frame||new Rectangle(0,0,640,640);textures.push(this);}destroy(){this.destroyed=true;}}
 Texture.EMPTY=new Texture();
 class Container {
  constructor(){this.children=[];this.scale={set:(x,y)=>{this.sx=x;this.sy=y;}};}
  addChild(n){this.children.push(n);n.parent=this;}removeChild(n){this.children=this.children.filter(v=>v!==n);}
  removeChildren(){this.children=[];}destroy(o){this.destroyed=true;if(o&&o.children)this.children.forEach(c=>c.destroy());}
 }
 class Sprite extends Container {constructor(t){super();this.texture=t;}}
 const source=new Texture();
 return {Rectangle,Texture,Container,Sprite,Assets:{load:()=>Promise.resolve(source),unload:()=>Promise.resolve()},textures,source};
}

test('Scene depth groups preserve layer order, update Y and detach pooled nodes',()=>{
 const P=fakePixi(),root=new P.Container();
 const b=pixiBackend.createBackend({PIXI:P,container:root,depthSort:true});
 const front=b.createNode({kind:'sprite',assetUrl:'/a'}),rear=b.createNode({kind:'sprite',assetUrl:'/a'}),detail=b.createNode({kind:'sprite',assetUrl:'/a'});
 b.updateNode(front,{sortGroup:1,sortY:200,zIndex:0});
 b.updateNode(rear,{sortGroup:2,sortY:100,zIndex:99});
 b.updateNode(detail,{sortGroup:1,sortY:200,zIndex:10});
 assert.equal(front.parent,detail.parent);assert.notEqual(front.parent,rear.parent);
 assert.ok(front.parent.zIndex>rear.parent.zIndex,'late rear effect stays behind front effect');
 assert.equal(detail.zIndex,10);assert.equal(rear.zIndex,99);
 const old=front.parent;b.updateNode(front,{sortGroup:1,sortY:50,zIndex:0});assert.equal(old.zIndex,50);
 b.updateNode(front,{visible:false});assert.equal(old.children.length,1);
 b.updateNode(detail,{visible:false});assert.equal(old.destroyed,true);
 b.updateNode(front,{sortGroup:3,sortY:300,zIndex:0});assert.equal(front.parent.zIndex,300);
 b.destroyNode(front);b.destroyNode(rear);b.destroyNode(detail);b.destroy();
});
test('WATER async profile strips preserve frames, anchors, tint and shared texture lifetime',async()=>{
 const P=fakePixi();const b=pixiBackend.createBackend({PIXI:P,container:new P.Container()});
 const spec={kind:'profiled',assetUrl:'/water.png',blendMode:'normal',sheet:{columns:2,rows:1},profileScales:Array(64).fill(1.5)};
 const a=b.createNode(spec),other=b.createNode({...spec,profileScales:Array(64).fill(1)});
 b.updateNode(a,{visible:true,frame:1,anchorX:.5,anchorY:1,tint:0xabcdef});
 await Promise.resolve();await Promise.resolve();await Promise.resolve();
 assert.equal(a.children.length,64);assert.equal(a.children[0].texture.frame.x,320);
 assert.equal(a.children[0].x,-240);assert.equal(a.children[0].y,-640);
 assert.equal(a.children[0].tint,0xabcdef);assert.equal(a.children[0].sx,1.5);
 assert.equal(other.children[0].texture.frame.x,0);
 assert.equal(a.__profileFrames,other.__profileFrames);
 const tex=a.children[0].texture;
 b.destroyNode(a);assert.equal(a.children[0].destroyed,true);assert.ok(!tex.destroyed);
 b.destroyNode(other);b.destroy();assert.equal(tex.destroyed,true);
});

test('WATER four tier-7 fields use fx layer, retain phase between hits and expire',()=>{
 const preset=JSON.parse(fs.readFileSync(path.join(__dirname,'../vfx/presets/field-water-tornado.json')));
 const nodes=[];
 function backend(tag){return {createNode(spec){const n={spec,tag};nodes.push(n);return n;},updateNode(n,t){n.t={...t};},destroyNode(){},destroy(){}};}
 const a=runtime.create({core,resolver:{has:()=>true,resolve:id=>id},fxBackend:backend('fx'),zoneBackend:backend('zone'),ctx:{posOf:()=>({x:0,y:0}),playerPos:()=>({x:0,y:0})}});
 a.registerPresets([preset]);
 const specs=Array.from({length:4},(_,i)=>({fxKind:'aura',variant:'water-tornado',dur:.35,
  area:{id:'water-'+i,x:i*100,y:80,r:50},vfx:{field:preset.id}}));
 specs.forEach(s=>assert.equal(a.tryPlay(s),true));a.update(.2);
 assert.equal(nodes.filter(n=>n.spec.kind==='generated').length,0);assert.ok(nodes.every(n=>n.tag==='fx'));
 const column=nodes.find(n=>n.spec.assetUrl?.includes('water-flow.png'));
 assert.equal(column.t.frame,4);assert.equal(column.t.x,0);assert.equal(column.t.y,80);
 assert.equal(column.t.scaleX,column.t.scaleY);
 specs.forEach(s=>a.tryPlay(s));a.update(.2);
 assert.equal(nodes.filter(n=>n.spec.kind==='generated').length,0);assert.equal(column.t.frame,8);assert.equal(a.stats().played,4);
 a.update(3);assert.equal(a.stats().grounds,0);a.clear();
});

const generator=require('../js/vfx-water-tornado.js');
test('WATER independent procedural parts have no atlas and retain deterministic motion',()=>{
 assert.equal(preset.layers.length,15);
 const polished=preset;
 const extraParts=polished.layers.filter(l=>l.water && l.water.part.startsWith('cyclone-')).map(l=>l.water.part);
 assert.deepEqual([...new Set([...preset.layers.filter(l=>!l.id.includes('cyclone-')).map(l=>l.id),...extraParts])],generator.PARTS);
 for(const part of new Set(extraParts)) {
  const a=generator.sample(part,0.1),b=generator.sample(part,0.5);
  assert(a.commands.length>100); assert.notDeepEqual(a.commands,b.commands);
  assert.strictEqual(a,generator.sample(part,0.1));
 }
 for(const l of preset.layers){assert.equal(l.sheet,undefined);if(l.effect==='waterTornado')assert.equal(l.assetId,undefined);else assert.ok(l.assetId);}
 assert.equal(preset.layers.find(l=>l.id==='halo').type,'sprite');
 for(const id of ['dust','spray']){const l=preset.layers.find(l=>l.id===id);assert.equal(l.type,'particle');assert.equal(l.direction,-90);assert.equal(l.spread,180);}
 const index=JSON.parse(fs.readFileSync(path.join(__dirname,'../vfx/asset-index.json')));
 assert.ok(!index.assets.some(a=>a.assetId==='codex-authored/water-tornado/water-tornado-v10.png'));
 assert.ok(!fs.existsSync(path.join(__dirname,'../images/vfx/assets/codex-authored/water-tornado/water-tornado-v10.png')));
 const a=generator.sample('white-crests',.5),b=generator.sample('white-crests',.7);
 assert.notDeepEqual(a.commands,b.commands);assert.equal(a,generator.sample('white-crests',4.5));
 assert.equal(generator.sample('spray',0,0).commands.length,0);
 assert.equal(generator.sample('spray',0,2).commands.length,240);
 const body=generator.sample('body',.5).pixels;
 const k=(150*320+160)*4;assert.ok(body[k+2]>100&&body[k+3]>220,'central volume is blue and filled');
 for(const change of [{part:'unknown'},{speed:-1},{density:Infinity},{speed:NaN}]){
  const invalid=structuredClone(preset);Object.assign(invalid.layers.find(l=>l.id==='body').water,change);assert.equal(core.validatePreset(invalid).ok,false);
 }
});

test('WATER disabled parts do not generate nodes, and per-layer color/scale remain editable',()=>{
 const p=structuredClone(preset);p.layers.forEach(l=>{l.enabled=l.id==='body'});
 const body=p.layers.find(l=>l.id==='body');body.tint='#ff0000';body.alpha=.4;body.scale={x:.7,y:.3};
 const nodes=[];const r=core.createRuntime({resolver:{resolve:id=>id},backend:{createNode(s){const n={s};nodes.push(n);return n},updateNode(n,t){n.t={...t}},destroyNode(){}}});
 r.registerPreset(p);r.play(p.id);r.update(.5);
 assert.equal(nodes.length,1);assert.equal(nodes[0].s.generated,'body');const column=nodes[0];assert.equal(column.t.tint,0xff0000);assert.equal(column.t.alpha,.4);assert.equal(column.t.scaleX,.7);
 r.destroy();
});

test('WATER generated surfaces share equal phases, isolate different phases and recycle',()=>{
 const P=fakePixi();P.Texture.from=()=>{const tex=new P.Texture();tex.source.update=()=>{};return tex;};
 const ctx={resetTransform(){},clearRect(){},save(){},restore(){},scale(){},beginPath(){},lineTo(){},moveTo(){},ellipse(){},closePath(){},fill(){},stroke(){},drawImage(){},createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)})};
 const canvasFactory=()=>({getContext:()=>ctx});
 const b=pixiBackend.createBackend({PIXI:P,container:new P.Container(),canvasFactory});
 const spec={kind:'generated',generated:'spray',profileScales:Array(64).fill(1)};
 const a=b.createNode(spec),other=b.createNode(spec);
 assert.equal(a.children.length,1,'uniform generated layer uses a single quad');
 b.updateNode(a,{generated:generator.sample('spray',0),anchorX:.5,anchorY:1});
 b.updateNode(other,{generated:generator.sample('spray',0)});
 assert.equal(a.__generatedEntry,other.__generatedEntry);
 const old=other.__generatedEntry;
 b.updateNode(a,{generated:generator.sample('spray',.1)});assert.notEqual(a.__generatedEntry,old);assert.equal(other.__generatedEntry,old);
 for(let i=2;i<20;i++){b.updateNode(a,{generated:generator.sample('spray',i/20)});b.updateNode(other,{generated:generator.sample('spray',i/20)});}
 assert.ok(P.textures.length<200,'two reusable surfaces, no growing image sequence');
 const tex=a.children[0].texture;b.destroyNode(a);assert.ok(!tex.destroyed);b.destroyNode(other);b.destroy();assert.equal(tex.destroyed,true);
});

test('FIRE eight staggered casts share procedural samples without sharing lifetimes',()=>{
 const p=structuredClone(preset);p.layers.filter(l=>l.water).forEach(l=>l.water.palette='fire');
 const nodes=[];const r=core.createRuntime({resolver:{resolve:id=>id},backend:{createNode(s){const n={s};nodes.push(n);return n},updateNode(n,t){n.t={...t}},destroyNode(){}}});
 r.registerPreset(p);
 for(let i=0;i<8;i++){r.play(p.id);r.update(.037);}
 const bodies=nodes.filter(n=>n.s.generated==='body');assert.equal(bodies.length,8);
 assert.equal(new Set(bodies.map(n=>n.t.generated)).size,1);
 r.destroy();
});


test('WATER raster batches spray strokes and preserves sharp spray under soft mist',()=>{
 const P=fakePixi();P.Texture.from=()=>{const tex=new P.Texture();tex.source.update=()=>{};return tex;};
 const contexts=[];
 const canvasFactory=()=>{const ctx={clears:0,strokes:0,resetTransform(){},clearRect(){this.clears++},save(){},restore(){},scale(){},beginPath(){},lineTo(){},moveTo(){},ellipse(){},closePath(){},fill(){},stroke(){this.strokes++},drawImage(){}};
  Object.defineProperty(ctx,'filter',{set(){throw Error('per-frame native blur must not return')}});contexts.push(ctx);return {width:320,height:320,getContext:()=>ctx};};
 const b=pixiBackend.createBackend({PIXI:P,container:new P.Container(),canvasFactory});
 const n=b.createNode({kind:'generated',generated:'cyclone-front',profileScales:Array(64).fill(1)});
 const commands=Array.from({length:1000},(_,i)=>({points:[[i%100,0],[i%100,2]],color:[100,220,255,180],line:1}));
 b.updateNode(n,{generated:{key:'batch-test',commands,groups:[{commands:[{ellipse:[50,50,5,3],color:[80,190,220,100]}],blur:5,alpha:.7}]}});
 assert.equal(contexts[0].strokes,1,'same-color spray is one draw, not one thousand');
 assert.equal(contexts[0].clears,1,'mist overlay must not erase sharp water droplets');
 assert(n.__generatedEntry.temp.width<320,'soft pass uses a smaller surface');
 b.destroy();
});
