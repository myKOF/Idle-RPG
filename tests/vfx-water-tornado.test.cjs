'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const core=require('../js/vfx-core.js');
const pixiBackend=require('../js/vfx-pixi-backend.js');
const runtime=require('../js/vfx-runtime.js');
const preset=JSON.parse(fs.readFileSync(path.join(__dirname,'../vfx/presets/field-water-tornado.json'),'utf8'));

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
 const nodes=[];
 function backend(tag){return {createNode(spec){const n={spec,tag};nodes.push(n);return n;},updateNode(n,t){n.t={...t};},destroyNode(){},destroy(){}};}
 const a=runtime.create({core,resolver:{has:()=>true,resolve:id=>id},fxBackend:backend('fx'),zoneBackend:backend('zone'),ctx:{posOf:()=>({x:0,y:0}),playerPos:()=>({x:0,y:0})}});
 a.registerPresets([preset]);
 const specs=Array.from({length:4},(_,i)=>({fxKind:'aura',variant:'water-tornado',dur:.35,
  area:{id:'water-'+i,x:i*100,y:80,r:50},vfx:{field:preset.id}}));
 specs.forEach(s=>assert.equal(a.tryPlay(s),true));a.update(.2);
 assert.equal(nodes.filter(n=>n.spec.kind==='generated').length,32);assert.ok(nodes.every(n=>n.tag==='fx'));
 const column=nodes.find(n=>n.spec.generated==='body');
 assert.match(column.t.generated.key, /^body:4:/);assert.equal(column.t.x,0);assert.equal(column.t.y,80);
 assert.equal(column.t.scaleX,column.t.scaleY);
 specs.forEach(s=>a.tryPlay(s));a.update(.2);
 assert.equal(nodes.filter(n=>n.spec.kind==='generated').length,32);assert.match(column.t.generated.key, /^body:8:/);assert.equal(a.stats().played,4);
 a.update(3);assert.equal(a.stats().grounds,0);a.clear();
});

const generator=require('../js/vfx-water-tornado.js');
test('WATER independent procedural parts have no atlas and retain deterministic motion',()=>{
 assert.equal(preset.layers.length,11);
 assert.deepEqual(preset.layers.map(l=>l.id),generator.PARTS);
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
 b.updateNode(a,{generated:generator.sample('spray',0),anchorX:.5,anchorY:1});
 b.updateNode(other,{generated:generator.sample('spray',0)});
 assert.equal(a.__generatedEntry,other.__generatedEntry);
 const old=other.__generatedEntry;
 b.updateNode(a,{generated:generator.sample('spray',.1)});assert.notEqual(a.__generatedEntry,old);assert.equal(other.__generatedEntry,old);
 for(let i=2;i<20;i++){b.updateNode(a,{generated:generator.sample('spray',i/20)});b.updateNode(other,{generated:generator.sample('spray',i/20)});}
 assert.ok(P.textures.length<200,'two reusable surfaces, no growing image sequence');
 const tex=a.children[0].texture;b.destroyNode(a);assert.ok(!tex.destroyed);b.destroyNode(other);b.destroy();assert.equal(tex.destroyed,true);
});
