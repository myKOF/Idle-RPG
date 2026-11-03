'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
function array(g,index){
 const a=g.json.accessors[index],v=g.json.bufferViews[a.bufferView],k={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[a.type],width={5121:1,5123:2,5125:4,5126:4}[a.componentType],read={5121:'readUInt8',5123:'readUInt16LE',5125:'readUInt32LE',5126:'readFloatLE'}[a.componentType];
 return Array.from({length:a.count},(_,i)=>Array.from({length:k},(_,c)=>g.buf[read](g.binStart+(v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||k*width)+c*width)));
}
for(const name of ['role','role1'])test(name+'是右手正握：掌面、拇指與實際劍身同時符合；整段第四招刃口朝前',async()=>{
 const T=await import(pathToFileURL(root+'/js/vendor/three/three.module.min.js'));
 const {readGlb,buildRig,readClip,poseAt,worldMatrices}=await import(pathToFileURL(root+'/tools/meshy-pipeline/src/fix-grips.mjs'));
 const g=readGlb(root+'/images/models/hero3d/'+name+'.glb'),j=g.json,skin=j.skins[0],pr=j.meshes[0].primitives;
 const names=skin.joints.map(i=>j.nodes[i].name),ibm=array(g,skin.inverseBindMatrices).map(a=>new T.Matrix4().fromArray(a));
 const hi=names.indexOf('RightHand'),si=names.indexOf('Sword'),H=ibm[hi].clone().invert(),S=ibm[si].clone().invert();
 const center=new T.Vector3(...j.asset.extras.gripFrame.gripPointInSword).applyMatrix4(S);
 const blade=array(g,pr[2].attributes.POSITION).map(p=>new T.Vector3(...p));
 const local=blade.map(p=>p.clone().applyMatrix4(ibm[si]));
 const min=Math.min(...local.map(p=>p.y)),max=Math.max(...local.map(p=>p.y));
 const mean=ps=>ps.reduce((s,p)=>s.add(p),new T.Vector3()).multiplyScalar(1/ps.length);
 const axis=mean(blade.filter((_,i)=>local[i].y>max-.001)).sub(mean(blade.filter((_,i)=>local[i].y<min+.001))).normalize();
 const forward=new T.Vector3(0,1,0).transformDirection(H),x=forward.clone().addScaledVector(axis,-forward.dot(axis)).normalize(),z=new T.Vector3().crossVectors(x,axis).normalize();
 const points=array(g,pr.at(-1).attributes.POSITION).map(p=>new T.Vector3(...p));
 const q=points.map(p=>{const v=p.clone().sub(center);return {p,x:v.dot(x),y:v.dot(axis),z:v.dot(z)};});
 const palm=q.filter(v=>v.x>-.05&&v.x<-.015&&Math.abs(v.y)<.015),thumb=q.filter(v=>v.y>.045);
 assert.ok(palm.length>100&&thumb.length>50,'量測實際掌面及拇指網格，不能只用metadata');
 const palmDepth=palm.reduce((s,p)=>s+p.z,0)/palm.length;
 const thumbSide=axis.clone().multiplyScalar(Math.sign(thumb.reduce((s,p)=>s+p.y,0)));
 const palmNormal=z.clone().multiplyScalar(-Math.sign(palmDepth));
 assert.ok(new T.Vector3().crossVectors(x,palmNormal).dot(thumbSide)>.99,'右手的拇指側必須等於手指方向cross掌面法線，不能是左手形狀');
 assert.ok(axis.dot(thumbSide)>.99,'劍身必須由拇指／食指側伸出，不能由小指側反握');
 assert.ok(Math.abs(palmDepth)>.003,'掌面應明確位於柄的一側');
 const handFaces=array(g,pr.at(-1).indices).flat();let volume=0;
 for(let i=0;i<handFaces.length;i+=3)volume+=points[handFaces[i]].dot(new T.Vector3().crossVectors(points[handFaces[i+1]],points[handFaces[i+2]]))/6;
 assert.ok(volume>0,'修正後手部不能變成朝內的反面網格');
 const rig=buildRig(g),clip=readClip(g,rig,'Attack4'),digest=crypto.createHash('sha256'),anim=j.animations.find(a=>a.name==='Attack4');
 digest.update(JSON.stringify(anim.channels));
 for(const s of anim.samplers){digest.update(s.interpolation||'LINEAR');for(const k of ['input','output']){const v=j.bufferViews[j.accessors[s[k]].bufferView];digest.update(g.buf.subarray(g.binStart+(v.byteOffset||0),g.binStart+(v.byteOffset||0)+v.byteLength));}}
 assert.equal(digest.digest('hex'),'0a51a3c4a9becdae34ece8f193b57679cacb0cc7295d0bc50dacaeb0d9cf21a9','手部修正不能更動任何第四招取樣');
 for(const t of clip.keyTimes){
  const w=worldMatrices(rig,poseAt(rig,clip,t)),sw=w(rig.byName.Sword);
  const a=new T.Vector3(0,1,0).transformDirection(sw),edge=new T.Vector3(1,0,0).transformDirection(sw),face=new T.Vector3(0,0,1).transformDirection(sw);
  if(t>=.25&&t<=1.5){assert.ok(Math.abs(face.z)<1e-5);assert.ok(Math.abs(edge.z)/Math.sqrt(1-a.z*a.z)>.99999);}
  // Every grip-contact vertex is rigid on the right hand. Check the actual
  // shaft center remains fixed in that frame throughout the complete clip.
  const shaft=center.clone().applyMatrix4(ibm[si]).applyMatrix4(sw).applyMatrix4(w(rig.byName.RightHand).clone().invert());
  const rest=center.clone().applyMatrix4(ibm[hi]);
  assert.ok(shaft.distanceTo(rest)<1e-4,'整段揮擊劍柄不得離掌');
 }
});
