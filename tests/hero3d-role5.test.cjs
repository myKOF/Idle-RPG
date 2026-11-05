'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
function glb(name){const b=fs.readFileSync(root+'/images/models/hero3d/'+name),n=b.readUInt32LE(12);return{json:JSON.parse(b.subarray(20,20+n)),buf:b,binStart:28+n};}
function array(g,i){const a=g.json.accessors[i],v=g.json.bufferViews[a.bufferView],k={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[a.type],size={5121:1,5123:2,5125:4,5126:4}[a.componentType],read={5121:'readUInt8',5123:'readUInt16LE',5125:'readUInt32LE',5126:'readFloatLE'}[a.componentType];return Array.from({length:a.count},(_,row)=>Array.from({length:k},(_,col)=>g.buf[read](g.binStart+(v.byteOffset||0)+(a.byteOffset||0)+row*(v.byteStride||k*size)+col*size)));}
const base=glb('role1.glb'),skin=glb('role5.glb');
test('5轉外觀保持原骨架、六段動畫取樣、正握手部及核准新劍',()=>{
 const a=base.json,b=skin.json;assert.ok(skin.buf.length<5_000_000);assert.deepEqual(b.nodes,a.nodes);assert.equal(b.animations.length,6);
 assert.deepEqual(array(skin,b.skins[0].inverseBindMatrices),array(base,a.skins[0].inverseBindMatrices));
 for(let i=0;i<6;i++){const x=a.animations[i],y=b.animations[i];assert.equal(y.name,x.name);assert.deepEqual(y.channels,x.channels);for(let k=0;k<x.samplers.length;k++){assert.equal(y.samplers[k].interpolation,x.samplers[k].interpolation);for(const n of ['input','output'])assert.deepEqual(array(skin,y.samplers[k][n]),array(base,x.samplers[k][n]));}}
 for(const i of [a.meshes[0].primitives.length-1]){const x=a.meshes[0].primitives[i],y=b.meshes[0].primitives.at(-1);for(const n of ['POSITION','NORMAL','JOINTS_0','WEIGHTS_0'])assert.deepEqual(array(skin,y.attributes[n]),array(base,x.attributes[n]));assert.deepEqual(array(skin,y.indices),array(base,x.indices));}
 assert.equal(b.asset.extras.appearance,'role5');assert.deepEqual(b.asset.extras.gripFrame.gripPointInSword,a.asset.extras.gripFrame.gripPointInSword);assert.deepEqual(b.asset.extras.gripFrame.handedness,a.asset.extras.gripFrame.handedness);for(const key of ['bladeAxisInSword','edgeAxisInSword','normalAxisInSword','orientation','shaftRadiusX','shaftRadiusZ'])assert.deepEqual(b.asset.extras.gripFrame[key],a.asset.extras.gripFrame[key]);assert.equal(b.asset.extras.forwardGripVersion,1);
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
 const r=JSON.parse(fs.readFileSync(root+'/images/models/hero3d/role5.json','utf8'));
 assert.equal(r.sourceSha256,'8f9dba13df728c8a87f22e149e5fa44e8d28ec3f7c5125ede08c91c69089f6c5');assert.equal(r.finalBoundaryEdges,0);assert.ok(r.removedBackSwordTriangles>500);assert.ok(r.removedLeftWebTriangles>0);assert.equal(r.sourceUnrigged,false);assert.deepEqual(r.sourceClips,['Running']);
});

test('新劍沿原握點／刃向剛性綁Sword，頭部中立朝前且原始PBR完整保留',async()=>{
 const T=await import(pathToFileURL(root+'/js/vendor/three/three.module.min.js')),j=skin.json,r=JSON.parse(fs.readFileSync(root+'/images/models/hero3d/role5.json','utf8'));
 assert.equal(r.approvedSwordSha256,'9be98b40aee20fde05a3c5af928f64f5c22b0b51961668ce0eeae411c9334ea0');assert.deepEqual(r.weaponPrimitiveRange,[2,11]);
 const names=j.skins[0].joints.map(n=>j.nodes[n].name),sw=names.indexOf('Sword'),bind=array(skin,j.skins[0].inverseBindMatrices),S=new T.Matrix4().fromArray(bind[sw]);
 let low=Infinity,high=-Infinity;const grip=j.asset.extras.gripFrame.gripPointInSword;
 for(const p of j.meshes[0].primitives.slice(2,11)){
  const ps=array(skin,p.attributes.POSITION),js=array(skin,p.attributes.JOINTS_0),ws=array(skin,p.attributes.WEIGHTS_0);
  for(let i=0;i<ps.length;i++){assert.equal(js[i][0],sw);assert.deepEqual(ws[i],[1,0,0,0]);const v=new T.Vector3(...ps[i]).applyMatrix4(S);low=Math.min(low,(v.y-grip[1])*.01);high=Math.max(high,(v.y-grip[1])*.01);}
 }
 assert.ok(Math.abs(low+.136)<.002);assert.ok(Math.abs(high-.806)<.002);
 const hp=array(skin,j.meshes[0].primitives[0].attributes.POSITION)[r.headForwardVertexIndex],H=new T.Matrix4().fromArray(bind[names.indexOf('Head')]).invert(),center=new T.Vector3().setFromMatrixPosition(H),dx=hp[0]-center.x,dz=hp[2]-center.z;
 assert.ok(Math.abs(Math.atan2(dx,dz))*180/Math.PI<4,'中立頭部需直視正前方');
 assert.equal(j.asset.extras.pbrExternal,true);const body=j.materials[0];assert.ok(body.normalTexture);assert.ok(body.pbrMetallicRoughness.metallicRoughnessTexture);
 for(const im of j.images){if(im.uri){assert.match(im.uri,/^role5\/(base\.jpg|normal\.png|mr\.jpg)\?v=20261105-role5-v1$/);assert.ok(fs.statSync(root+'/images/models/hero3d/'+im.uri.split('?')[0]).size>1000);}else{assert.ok(Number.isInteger(im.bufferView));assert.ok(j.bufferViews[im.bufferView].byteLength>100);}}
});

test('實際GLB補面無單邊／奇數幾何邊且成品SHA與修復紀錄一致',()=>{
 const j=skin.json,ps=array(skin,j.meshes[0].primitives[0].attributes.POSITION),ids=ps.map(p=>p.map(v=>Math.round(v*1e6)).join(',')),edges=new Map();
 for(const p of j.meshes[0].primitives.slice(0,2)){
  const ix=array(skin,p.indices).flat();for(let i=0;i<ix.length;i+=3)for(let k=0;k<3;k++){const a=ids[ix[i+k]],b=ids[ix[i+(k+1)%3]];if(a===b)continue;const key=[a,b].sort().join('|');edges.set(key,(edges.get(key)||0)+1);}
 }
 assert.ok(edges.size>10000);assert.equal([...edges.values()].filter(n=>n%2).length,0,'獨立封閉殼層不可留下單邊或奇數邊');
 const r=JSON.parse(fs.readFileSync(root+'/images/models/hero3d/role5.json','utf8'));
 assert.equal(require('node:crypto').createHash('sha256').update(skin.buf).digest('hex'),r.outputSha256);
});

function imageSize(b){
 if(b.subarray(0,4).equals(Buffer.from([137,80,78,71])))return[b.readUInt32BE(16),b.readUInt32BE(20)];
 assert.equal(b.readUInt16BE(0),0xffd8);for(let p=2;p<b.length;){if(b[p]!==255){p++;continue;}const marker=b[p+1];if(marker===216||marker===217){p+=2;continue;}const n=b.readUInt16BE(p+2);if([192,193,194].includes(marker))return[b.readUInt16BE(p+7),b.readUInt16BE(p+5)];p+=n+2;}throw Error('Missing image size');
}
test('原圖三貼圖2048px逐位保留；補面使用原甲片UV及原PBR貼圖',()=>{
 const crypto=require('node:crypto'),j=skin.json,expected={base:'cc2955255eb4bda37cd39121deb4a1aee111423e11dbd07d19d6be6ef81c5e8d',normal:'266b2a175593fddab63fdbe0faed1a64aa99dcc8844ddd5a54f833e91ea0bd70',mr:'90734bb124d5f0905022be3aefb2733d75981f4665cf9c5296c8864dc1d9b9f7'},r=JSON.parse(fs.readFileSync(root+'/images/models/hero3d/role5.json','utf8'));
 for(const [kind,hash]of Object.entries(expected)){const t=r.originalTextures[kind],b=fs.readFileSync(root+'/images/models/hero3d/'+t.file);assert.equal(crypto.createHash('sha256').update(b).digest('hex'),hash);assert.equal(t.sha256,hash);assert.deepEqual(imageSize(b),[2048,2048]);}
 const a=j.materials[0],b=j.materials[1];assert.deepEqual(b.pbrMetallicRoughness,a.pbrMetallicRoughness);assert.deepEqual(b.normalTexture,a.normalTexture);assert.equal(b.pbrMetallicRoughness.baseColorFactor,undefined);
 const p=j.meshes[0].primitives[1],uv=array(skin,p.attributes.TEXCOORD_0),used=array(skin,p.indices).flat();assert.ok(new Set(used.map(i=>uv[i].map(v=>v.toFixed(5)).join(','))).size>300);assert.ok(used.every(i=>uv[i].every(Number.isFinite)));
 assert.equal(r.repairUvTransfer,'mirrored-nearest-surviving-surface-per-triangle');
});

test('旁載貼圖缺失時拒絕換模並去重清理，完整材質不受影響',()=>{
 const src=fs.readFileSync(root+'/js/hero3d.js','utf8'),a=src.indexOf('  function validateExternalPbr('),b=src.indexOf('  function makeStudioEnvironment(',a),ctx=require('node:vm').createContext({});assert.ok(a>=0&&b>a);require('node:vm').runInContext(src.slice(a,b),ctx);
 let t=0,m=0,g=0;const tex={isTexture:true,dispose(){t++;}},geo={dispose(){g++;}},mat={map:tex,normalMap:tex,metalnessMap:tex,roughnessMap:tex,dispose(){m++;}},mesh={isMesh:true,geometry:geo,material:mat},model={scene:{traverse(fn){fn(mesh);fn(mesh);}},parser:{associations:new Map([[mat,{materials:0}]]),json:{materials:[{normalTexture:{index:0},pbrMetallicRoughness:{baseColorTexture:{index:0},metallicRoughnessTexture:{index:0}}}]}}};
 ctx.validateExternalPbr(model);assert.deepEqual([t,m,g],[0,0,0]);mat.map=null;assert.throws(()=>ctx.validateExternalPbr(model),/Incomplete external PBR textures: baseColor/);assert.deepEqual([t,m,g],[1,1,1]);
 assert.match(src,/if \(modelStyle\.pbrExternal === true\) validateExternalPbr\(gltf\)/);
});
