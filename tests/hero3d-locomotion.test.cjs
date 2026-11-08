'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const source=fs.readFileSync(require.resolve('../js/hero3d.js'),'utf8');
const context={};
vm.runInNewContext(source.slice(source.indexOf('  function measureLocomotion('),source.indexOf('  async function create(')),context);
test('native gait measures grounded foot travel, ignores fast lifted swing, and restores the loaded skeleton',async()=>{
 const THREE=await import(pathToFileURL(require.resolve('../js/vendor/three/three.module.min.js')));
 const model=new THREE.Group();
 const left=new THREE.Bone(),right=new THREE.Bone();
 left.name='mixamorigLeftToeBase';right.name='mixamorigRightToeBase';
 left.position.z=3;right.position.z=4;model.add(left,right);
 const times=[0,.5,.625,.875,1],tracks=[];
 for(const bone of [left,right]){
  const values=[];for(let i=0;i<times.length;i++)values.push(0,[0,0,1,1,0][i],[0,-1,-1,0,0][i]);
  tracks.push(new THREE.VectorKeyframeTrack(bone.name+'.position',times,values));
 }
 const clip=new THREE.AnimationClip('Walk',1,tracks);
 assert.ok(Math.abs(context.measureLocomotion(THREE,model,clip)-2)<1e-5);
 assert.equal(left.position.z,3);assert.equal(right.position.z,4);
 model.scale.setScalar(2);
 assert.ok(Math.abs(context.measureLocomotion(THREE,model,clip)-4)<1e-5);
 assert.equal(context.measureLocomotion(THREE,new THREE.Group(),clip),0);
});
