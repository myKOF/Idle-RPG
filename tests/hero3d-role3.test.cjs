'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
function glb(name){const b=fs.readFileSync(root+'/images/models/hero3d/'+name),n=b.readUInt32LE(12);return{json:JSON.parse(b.subarray(20,20+n)),buf:b,binStart:28+n};}
function array(g,i){const a=g.json.accessors[i],v=g.json.bufferViews[a.bufferView],k={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[a.type],size={5121:1,5123:2,5125:4,5126:4}[a.componentType],read={5121:'readUInt8',5123:'readUInt16LE',5125:'readUInt32LE',5126:'readFloatLE'}[a.componentType];return Array.from({length:a.count},(_,row)=>Array.from({length:k},(_,col)=>g.buf[read](g.binStart+(v.byteOffset||0)+(a.byteOffset||0)+row*(v.byteStride||k*size)+col*size)));}
const base=glb('role1.glb'),skin=glb('role3.glb');
test('3轉外觀保持原骨架、六段動畫取樣、正握手部及原劍模型',()=>{
 const a=base.json,b=skin.json;assert.ok(skin.buf.length<5_000_000);assert.deepEqual(b.nodes,a.nodes);assert.equal(b.animations.length,6);
 assert.deepEqual(array(skin,b.skins[0].inverseBindMatrices),array(base,a.skins[0].inverseBindMatrices));
 for(let i=0;i<6;i++){const x=a.animations[i],y=b.animations[i];assert.equal(y.name,x.name);assert.deepEqual(y.channels,x.channels);for(let k=0;k<x.samplers.length;k++){assert.equal(y.samplers[k].interpolation,x.samplers[k].interpolation);for(const n of ['input','output'])assert.deepEqual(array(skin,y.samplers[k][n]),array(base,x.samplers[k][n]));}}
 for(let i=2;i<6;i++){const x=a.meshes[0].primitives[i],y=b.meshes[0].primitives[i];for(const n of ['POSITION','NORMAL','JOINTS_0','WEIGHTS_0'])assert.deepEqual(array(skin,y.attributes[n]),array(base,x.attributes[n]));assert.deepEqual(array(skin,y.indices),array(base,x.indices));}
 assert.equal(b.asset.extras.appearance,'role3');assert.deepEqual(b.asset.extras.gripFrame,a.asset.extras.gripFrame);assert.equal(b.asset.extras.forwardGripVersion,1);
});
test('修復後手腿沒有跨骨骼橋面，網格索引／權重／手套頂點色有效',()=>{
 const j=skin.json,names=j.skins[0].joints.map(n=>j.nodes[n].name);
 for(const p of j.meshes[0].primitives){
  const ps=array(skin,p.attributes.POSITION),js=array(skin,p.attributes.JOINTS_0),ws=array(skin,p.attributes.WEIGHTS_0),idx=array(skin,p.indices).flat();
  assert.ok(ps.flat().every(Number.isFinite));assert.ok(idx.every(i=>i>=0&&i<ps.length));
  for(let i=0;i<ws.length;i++){assert.ok(Math.abs(ws[i].reduce((a,b)=>a+b,0)-1)<1e-5);assert.ok(js[i].every(n=>n<names.length));}
  if(p===j.meshes[0].primitives[0]||p===j.meshes[0].primitives[1])for(let i=0;i<idx.length;i+=3){
   const dominant=idx.slice(i,i+3).map(n=>names[js[n][ws[n].indexOf(Math.max(...ws[n]))]]);
   for(const side of ['Right','Left'])assert.ok(!(dominant.some(n=>new RegExp('^'+side+'(Arm|ForeArm|Hand)$').test(n))&&dominant.some(n=>new RegExp('^'+side+'(UpLeg|Leg|Foot|ToeBase)$').test(n))),'手臂與腿不能共用橋面：'+dominant);
  }
 }
 const hand=j.meshes[0].primitives.at(-1),colors=array(skin,hand.attributes.COLOR_0);
 assert.ok(colors.flat().every(v=>Number.isFinite(v)&&v>=0&&v<=1));assert.ok(colors.some(c=>c[0]<.15));assert.ok(colors.some(c=>c[0]>.65));
});
test('六段動作逐姿勢蒙皮沒有手腿拉成長三角面的缺陷',async()=>{
 const T=await import(pathToFileURL(root+'/js/vendor/three/three.module.min.js'));
 const {buildRig,readClip,poseAt,worldMatrices}=await import(pathToFileURL(root+'/tools/meshy-pipeline/src/fix-grips.mjs'));
 const j=skin.json,rig=buildRig(skin),sk=j.skins[0],bind=array(skin,sk.inverseBindMatrices).map(v=>new T.Matrix4().fromArray(v));
 const p=j.meshes[0].primitives[0],ps=array(skin,p.attributes.POSITION),js=array(skin,p.attributes.JOINTS_0),ws=array(skin,p.attributes.WEIGHTS_0),idx=j.meshes[0].primitives.slice(0,2).flatMap(p=>array(skin,p.indices).flat());
 let longest=0,where;
 for(const animation of j.animations){const clip=readClip(skin,rig,animation.name);for(let frame=0;frame<=60;frame++){
  const W=worldMatrices(rig,poseAt(rig,clip,clip.duration*frame/60)),mat=sk.joints.map((n,i)=>W(n).clone().multiply(bind[i]).elements),points=new Float32Array(ps.length*3);
  for(let i=0;i<ps.length;i++){const [x,y,z]=ps[i];for(let k=0;k<4;k++){const w=ws[i][k];if(!w)continue;const m=mat[js[i][k]];points[i*3]+=w*(m[0]*x+m[4]*y+m[8]*z+m[12]);points[i*3+1]+=w*(m[1]*x+m[5]*y+m[9]*z+m[13]);points[i*3+2]+=w*(m[2]*x+m[6]*y+m[10]*z+m[14]);}}
  for(let i=0;i<idx.length;i+=3)for(let e=0;e<3;e++){const a=idx[i+e]*3,b=idx[i+(e+1)%3]*3,d=Math.hypot(points[a]-points[b],points[a+1]-points[b+1],points[a+2]-points[b+2]);if(d>longest){longest=d;where={clip:clip.name,t:clip.duration*frame/60,triangle:i/3,vertices:[a/3,b/3],bind:[ps[a/3],ps[b/3]],weights:[ws[a/3],ws[b/3]],joints:[js[a/3],js[b/3]]};}}
 }}
 assert.ok(longest<.45,'骨架錯綁產生長三角面：'+longest+'m '+JSON.stringify(where));
});

test('雙手均無腿部權重，授權來源與修復報告可追溯',()=>{
 const j=skin.json,names=j.skins[0].joints.map(n=>j.nodes[n].name),counts={Left:0,Right:0};
 for(const p of j.meshes[0].primitives){const joints=array(skin,p.attributes.JOINTS_0),weights=array(skin,p.attributes.WEIGHTS_0),used=new Set(array(skin,p.indices).flat());
  for(const side of ['Left','Right'])for(const i of used){let arm=0,leg=0;for(let k=0;k<4;k++){const n=names[joints[i][k]],w=weights[i][k];if(new RegExp('^'+side+'(Arm|ForeArm|Hand)$').test(n))arm+=w;if(new RegExp('^'+side+'(UpLeg|Leg|Foot|ToeBase)$').test(n))leg+=w;}if(arm>.0001){counts[side]++;assert.equal(leg,0,side+'手臂不能受腿部骨骼拉動');}}
 }
 assert.ok(counts.Left>500&&counts.Right>500);
 const r=JSON.parse(fs.readFileSync(root+'/images/models/hero3d/role3.json','utf8'));
 assert.equal(r.sourceSha256,'d2c49d1bf12913203cbf082bbbb0b30aece20320a7ab2b5130bcbbee4c65ba67');assert.equal(r.finalBoundaryEdges,0);assert.ok(r.removedBackSwordTriangles>1000);assert.ok(r.removedLeftWebTriangles>0);assert.equal(r.sourceUnrigged,false);assert.deepEqual(r.sourceClips,['Running']);
});
