'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const Core=require('../js/vfx-core.js'),Generator=require('../js/vfx-celebration.js'),Backend=require('../js/vfx-pixi-backend.js');
const Guard=require('../tools/vfx/editor-guard.cjs');
const {extractFunction}=require('./helpers/battle-scene.cjs');
const root=path.resolve(__dirname,'..'),preset=JSON.parse(fs.readFileSync(path.join(root,'vfx/presets/level-up.json')));
const source=fs.readFileSync(path.join(root,'js/battle-renderer.js'),'utf8');
const copy=x=>JSON.parse(JSON.stringify(x));
function normal(s){return [s.kind,...['x','y','alpha','visible','tint'].map(k=>typeof s[k]==='number'?Math.round(s[k]*1e8)/1e8:s[k]),Math.round(s.scale.x*1e8)/1e8,Math.round(s.scale.y*1e8)/1e8,s.children.map(normal)];}
function fakePixi(){
 const textures=[];
 class Container{
  constructor(){this.children=[];this.scale={x:1,y:1,set(x,y){this.x=x;this.y=y===undefined?x:y;}};this.skew={set(){}};this.visible=true;this.x=this.y=0;this.alpha=1;}
  addChild(...ns){for(const n of ns){if(n.parent)n.parent.removeChild(n);n.parent=this;this.children.push(n);}return ns[0];}
  removeChild(n){this.children=this.children.filter(x=>x!==n);n.parent=null;}
  removeChildren(){const ns=[...this.children];for(const n of ns)this.removeChild(n);return ns;}
  destroy(o){if(this.destroyed)throw Error('double node destroy');if(o&&o.children)for(const n of [...this.children])n.destroy(o);if(this.parent)this.parent.removeChild(this);this.destroyed=true;}
 }
 class Sprite extends Container{constructor(texture){super();this.texture=texture;this.anchor={set(){}};}}
 class Text extends Sprite{constructor(o){super();this.text=o.text;this.style=o.style;}get width(){return this.style.fontSize*4*this.scale.x;}}
 const Texture={EMPTY:{},from(){const t={disposed:0,destroy(){this.disposed++;}};textures.push(t);return t;}};
 return {Container,Sprite,Text,Texture,textures,Assets:{load(){throw Error('unexpected texture fetch');},unload(){}}};
}
function canvas(){return {getContext:()=>({createRadialGradient:()=>({addColorStop(){}}),fillRect(){},beginPath(){},arc(){},fill(){}})};}
function setup(p=preset){
 const P=fakePixi(),container=new P.Container();
 const backend=Backend.createBackend({PIXI:P,container,createCanvas:canvas,resolveText:key=>{assert.equal(key,'2314');return '等級提升';}});
 const runtime=Core.createRuntime({backend,resolver:{resolve(){throw Error('unexpected asset');}}});
 runtime.registerPreset(p);const handle=runtime.play(p.id,{seed:12345});return {P,container,backend,runtime,handle};
}
function find(node,predicate){if(predicate(node))return node;for(const c of node.children||[]){const result=find(c,predicate);if(result)return result;}return null;}

test('LEVELUP Preset validates/roundtrips, retains font55/stroke2/String2314 and editor label',()=>{
 assert.deepEqual(Core.validatePreset(preset),{ok:true,errors:[]});
 const serial=Core.serialisePreset(preset);assert.equal(Core.serialisePreset(JSON.parse(serial)),serial);
 assert.equal(fs.readFileSync(path.join(root,'vfx/presets/level-up.json'),'utf8'),serial);
 const c=preset.layers.find(l=>l.celebration.part==='text').celebration;
 assert.equal(c.style.fontSize,55);assert.equal(c.style.stroke.width,2);assert.equal(c.textKey,'2314');
 assert.equal(Core.derivePresetDuration(preset),3.2);
 assert.match(fs.readFileSync(path.join(root,'docs/vfx/VFX_PRESET_USAGE_OUTSIDE_TABLES.md'),'utf8'),/`level-up` \| 升級特效/);
 assert.doesNotMatch(source,/function spawnLevelUpAura\(|function spawnLevelUpText\(/);
});

test('LEVELUP exact legacy aura geometry/appearance at nine timestamps for normal and reduced modes',()=>{
 const baseline=require('./fixtures/levelup-legacy-samples.json');assert.equal(baseline.sourceCommit,'405279a2');
 for(const reduced of [false,true]){
  const sample=Generator.prepare(preset.layers[0].celebration,Core.makeRng(baseline.seed),reduced);
  for(const [time,expected] of Object.entries(baseline[reduced?'reduced':'normal'])){
   const actual=crypto.createHash('sha256').update(JSON.stringify(normal(sample(Number(time))))).digest('hex');
   assert.equal(actual,expected,`reduced=${reduced}, time=${time}`);
  }
 }
});

test('LEVELUP rejects invalid/unknown settings, excessive counts and incompatible procedural fields',()=>{
 for(const change of [p=>p.layers[0].celebration.vortexCount=Infinity,p=>p.layers[0].celebration.trailCount=2001,
  p=>p.layers[0].celebration.sparkCount=-1,p=>p.layers[0].celebration.gatherSec=0,p=>p.layers[0].celebration.typo=1,
  p=>p.layers[1].celebration.style.stroke.width=-1,p=>p.layers[1].celebration.style.dropShadow.blur=NaN,
  p=>p.layers[1].celebration.style.fontSize=10000,p=>p.layers[0].assetId='unwanted',p=>delete p.layers[0].celebration]){
  const p=copy(preset);change(p);assert.equal(Core.validatePreset(p).ok,false);
 }
});

test('LEVELUP actual backend applies edited text style/palette/counts, duration and common transforms after reload',()=>{
 const p=copy(preset);p.layers[0].celebration.gatherCount=3;p.layers[0].celebration.colors.core='#112233';
 p.layers[1].celebration.style.fontSize=48;p.layers[1].celebration.style.stroke.width=1;
 p.layers[1].position={x:30,y:20};p.layers[1].duration=2.5;
 const {runtime,container,P}=setup(JSON.parse(Core.serialisePreset(p)));
 runtime.update(.3);
 const core=find(container,n=>n.tint===0x112233);assert.ok(core);
 runtime.update(1.3);
 const label=find(container,n=>n instanceof P.Text);assert.ok(label);assert.equal(label.style.fontSize,48);assert.equal(label.style.stroke.width,1);assert.equal(label.text,'等級提升');
 const layer=container.children.find(n=>find(n,x=>x instanceof P.Text));assert.equal(layer.x,30);assert.equal(layer.y,20);
 const tree=Generator.prepare(p.layers[1].celebration,()=>.5,false,2.5)(2.2);assert.ok(tree.alpha>0);
 runtime.update(2.2);assert.equal(runtime.stats().activeEffects,1);
 runtime.update(.1);assert.equal(runtime.stats().activeEffects,0);
 runtime.destroy();assert.equal(container.children.length,0);assert.ok(P.textures.every(t=>t.disposed===1));
});

test('LEVELUP repeated, pooled and simultaneous instances reclaim generated textures exactly once',()=>{
 const {runtime,container,P}=setup();
 for(let i=0;i<12;i++){runtime.play(preset.id,{seed:i});runtime.update(.1);runtime.stopAll();}
 runtime.play(preset.id);runtime.play(preset.id);runtime.update(1.5);
 assert.ok(find(container,n=>n instanceof P.Text));assert.equal(P.textures.length,3,'shared three procedural textures');
 runtime.destroy();runtime.destroy();assert.equal(container.children.length,0);assert.ok(P.textures.every(t=>t.disposed===1));
});

function rendererContext(){
 const P=fakePixi();const S={ready:true,player:{root:{x:30,y:80}},cameraScale:2,layers:{float:new P.Container()},fx:[],levelUpResolver:{resolve(){throw Error('unused');}}};
 const c={S,PIXI:P,VFXCore:Core,VFXPixiBackend:{createBackend:o=>Backend.createBackend({...o,createCanvas:canvas})},REDUCED_MOTION:false,
  STR:()=> '等級提升',worldToScreenPoint:(x,y)=>({x,y}),Math,nowMs:()=>0,fxCap:()=>100,FX_HARD_LIFETIME_MS:6000};
 vm.createContext(c);for(const f of ['levelUpAnchor','spawnLevelUpPreset','addFx','killFx'])vm.runInContext(extractFunction(source,f),c);return {c,S,P};
}
test('LEVELUP game follows player, scales aura with camera but keeps text fixed, cleanup/dispose is idempotent',()=>{
 const {c,S,P}=rendererContext();c.spawnLevelUpPreset(preset);const fx=S.fx[0];fx.update(1.5);
 assert.equal(fx.node.x,30);assert.equal(fx.node.y,80);
 assert.equal(fx.node.children[0].scale.x,2);assert.equal(fx.node.children[1].scale.x,1);
 S.player.root.x=130;S.player.root.y=180;fx.update(.1);assert.equal(fx.node.x,130);assert.equal(fx.node.y,180);
 c.killFx(fx);c.killFx(fx);assert.ok(fx.dead);assert.equal(S.layers.float.children.length,0);assert.ok(P.textures.every(t=>t.disposed===1));
});

test('LEVELUP lazy load retries errors, bypasses browser cache and clear cancels pending playback',async()=>{
 let attempts=0;const c={S:{},VFXCore:Core,levelUpPresetPromise:null,fetch:async(url,o)=>{
  assert.equal(o.cache,'no-store');if(++attempts===1)throw Error('offline');
  return {ok:true,json:async()=>url.includes('level-up.json')?preset:{assets:[]}};
 }};
 vm.createContext(c);vm.runInContext(extractFunction(source,'loadLevelUpPreset'),c);
 await assert.rejects(c.loadLevelUpPreset(),/offline/);assert.equal(await c.loadLevelUpPreset(),preset);assert.equal(attempts,3);
 await c.loadLevelUpPreset();assert.equal(attempts,3);
 let resolve,played=0;const queued=new Promise(r=>{resolve=r;});
 Object.assign(c,{S:{ready:true,layers:{},player:{}},documentHidden:()=>false,loadLevelUpPreset:()=>queued,spawnLevelUpPreset:()=>{played++;},console});
 vm.runInContext(extractFunction(source,'onLevelUp'),c);c.onLevelUp({_buffered:true});c.S.levelUpGeneration=1;resolve(preset);
 await new Promise(setImmediate);assert.equal(played,0);
});

test('LEVELUP generator is included in stale-editor save protection',()=>{
 const os=require('node:os'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'levelup-guard-'));
 try{
  fs.mkdirSync(path.join(dir,'js'));fs.writeFileSync(path.join(dir,'js/vfx-celebration.js'),'old');
  const version=Guard.version(dir);fs.writeFileSync(path.join(dir,'js/vfx-celebration.js'),'new');
  assert.notEqual(Guard.version(dir),version);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
