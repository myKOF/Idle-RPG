import * as THREE from 'three';
import {GLTFLoader} from '/three/loaders/GLTFLoader.js';
import {DragonFire} from './fire.js';
const params=new URLSearchParams(location.search),W=900,H=600;
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(W,H);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;document.body.prepend(renderer.domElement);
if(params.has('capture'))document.body.classList.add('capture');
const scene=new THREE.Scene();scene.background=new THREE.Color(0x71818c);
scene.add(new THREE.HemisphereLight(0xdfe6e7,0x4f4336,1.2));
for(const [color,intensity,pos] of [[0xffe6c7,2.8,[-8,16,8]],[0xaac9e5,1.2,[7,8,-8]]]){const l=new THREE.DirectionalLight(color,intensity);l.position.set(...pos);scene.add(l);}
const envScene=new THREE.Scene();const envMesh=new THREE.Mesh(new THREE.SphereGeometry(50,24,12),new THREE.ShaderMaterial({side:THREE.BackSide,vertexShader:'varying vec3 p;void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec3 p;void main(){float h=normalize(p).y;vec3 c=mix(vec3(.15,.18,.21),vec3(.60,.65,.68),smoothstep(-.3,.8,h));gl_FragColor=vec4(c,1.);}'}));envScene.add(envMesh);const pm=new THREE.PMREMGenerator(renderer);scene.environment=pm.fromScene(envScene).texture;pm.dispose();envMesh.geometry.dispose();envMesh.material.dispose();
const ground=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:0x28363d,roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.025;scene.add(ground);
const grid=new THREE.GridHelper(120,60,0x6a7b83,0x41525c);grid.material.transparent=true;grid.material.opacity=.22;scene.add(grid);
const shadowCanvas=document.createElement('canvas');shadowCanvas.width=shadowCanvas.height=128;const ctx=shadowCanvas.getContext('2d');const gradient=ctx.createRadialGradient(64,64,0,64,64,64);gradient.addColorStop(0,'rgba(0,0,0,.62)');gradient.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);
const shadow=new THREE.Mesh(new THREE.PlaneGeometry(11,9),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(shadowCanvas),transparent:true,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=.004;scene.add(shadow);
const gltf=await new GLTFLoader().loadAsync('/assets/boss9.glb');scene.add(gltf.scene);
const clips=Object.fromEntries(gltf.animations.map(c=>[c.name,c]));const mixer=new THREE.AnimationMixer(gltf.scene);const actions=Object.fromEntries(gltf.animations.map(c=>[c.name,mixer.clipAction(c)]));
function pose(name,t){mixer.stopAllAction();const a=actions[name];a.setLoop(THREE.LoopOnce,1);a.clampWhenFinished=true;a.play();mixer.setTime(Math.max(0,Math.min(t,clips[name].duration)));gltf.scene.updateMatrixWorld(true);}
const config=await(await fetch('/fire.json')).json(),socket=gltf.scene.getObjectByName(config.socket),mouthSamples=[];
for(let i=0;i<=360;i++){pose('Attack3',i/120);mouthSamples.push({position:socket.getWorldPosition(new THREE.Vector3()),direction:new THREE.Vector3(...config.socketForward).transformDirection(socket.matrixWorld)});}
function mouthAt(t){const f=THREE.MathUtils.clamp(t*120,0,360),a=Math.floor(f),b=Math.min(360,a+1);return {position:mouthSamples[a].position.clone().lerp(mouthSamples[b].position,f-a),direction:mouthSamples[a].direction.clone().lerp(mouthSamples[b].direction,f-a).normalize()};}
const fire=new DragonFire(scene,config,mouthAt);
const camera=new THREE.OrthographicCamera(-10,10,8,-8,.1,250),detailCamera=new THREE.OrthographicCamera(-6.2,6.2,4.5,-4.5,.1,250);
const az=Number(params.get('azimuth')??65)*Math.PI/180,el=15*Math.PI/180;
const direction=new THREE.Vector3(-Math.sin(az)*Math.cos(el),Math.sin(el),Math.cos(az)*Math.cos(el));
const right=new THREE.Vector3(Math.cos(az),0,Math.sin(az)),up=new THREE.Vector3().crossVectors(direction,right).normalize();
function walkVertices(callback){const p=new THREE.Vector3();gltf.scene.traverse(o=>{if(!o.isMesh)return;for(let i=0;i<o.geometry.attributes.position.count;i++){o.getVertexPosition(i,p);p.applyMatrix4(o.matrixWorld);callback(p);}});}
const fits={};
for(const name of ['Walk','Attack1','Attack2','Attack3','Die']){
 let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minD=Infinity,maxD=-Infinity;
 const include=p=>{const x=p.dot(right),y=p.dot(up),d=p.dot(direction);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);minD=Math.min(minD,d);maxD=Math.max(maxD,d);};
 const count=Math.round(clips[name].duration*30);
 for(let i=0;i<=count;i++){pose(name,i/30);walkVertices(include);if(name==='Attack3'&&i/30>=config.emitStart&&i/30<=config.emitEnd){const m=mouthAt(i/30);for(const distance of [0,config.range]){const p=m.position.clone().addScaledVector(m.direction,distance);for(const x of [-2.7,2.7])for(const y of [-2.7,2.7])include(p.clone().addScaledVector(right,x).addScaledVector(up,y));}}}
 const height=Math.max(maxY-minY,(maxX-minX)*H/W)*1.16;
 const center=new THREE.Vector3().addScaledVector(right,(minX+maxX)/2).addScaledVector(up,(minY+maxY)/2).addScaledVector(direction,(minD+maxD)/2);
 fits[name]={height,center};
}
const ruler=new THREE.Group();scene.add(ruler);
ruler.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0),new THREE.Vector3(0,0,config.range)]),new THREE.LineBasicMaterial({color:0xe8c27d})));
for(let z=0;z<=config.range;z+=5){ruler.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-.3,0,z),new THREE.Vector3(.3,0,z)]),new THREE.LineBasicMaterial({color:0xe8c27d})));const c=document.createElement('canvas');c.width=192;c.height=80;const x=c.getContext('2d');x.font='38px Segoe UI';x.textAlign='center';x.fillStyle='#ffe1a4';x.fillText(z+' m',96,48);const s=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),transparent:true,depthTest:false}));s.scale.set(1.8,.75,1);s.position.set(0,-.45,z);ruler.add(s);}
const labels={Walk:['核准飛行移動','2.00 秒 · 短尾與胸前垂手'],Attack1:['攻擊 1 · 前衝咬擊','1.50 秒 · 後仰蓄勢 → 張嘴前衝 5 米 → 咬合回位'],Attack2:['攻擊 2 · 轉體斜劈','1.20 秒 · 向右轉體 90° → 右後上舉爪 → 右上至左下斜劈'],Attack3:['攻擊 3 · 烈焰吐息','3.00 秒 · 後仰蓄勢 → 猛然前傾 → 20 米粒子火焰'],Die:['死亡 · 仰天長嘯','2.50 秒 · 雙翼高舉 → 仰天長嘯 → 墜地側躺']};
let selected='Attack1',elapsed=0;
function select(name){selected=name;elapsed=0;const f=fits[name];camera.left=-f.height*W/H/2;camera.right=f.height*W/H/2;camera.top=f.height/2;camera.bottom=-f.height/2;camera.position.copy(f.center).addScaledVector(direction,80);camera.lookAt(f.center);camera.updateProjectionMatrix();document.getElementById('title').textContent=labels[name][0];document.getElementById('subtitle').textContent=labels[name][1];document.getElementById('detail').style.display=name==='Attack3'?'':'none';ruler.visible=name==='Attack3';}
function render(t){pose(selected,t);const root=gltf.scene.getObjectByName('Bone_000').getWorldPosition(new THREE.Vector3());shadow.position.set(root.x,.004,root.z);shadow.material.opacity=selected==='Die'?.85:.45;
 if(selected==='Attack3'){fire.update(t);const mouth=mouthAt(t);ruler.position.copy(mouth.position).addScaledVector(up,-1.6);ruler.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),mouth.direction);}else fire.clear();
 renderer.setViewport(0,0,W,H);renderer.setScissorTest(false);renderer.render(scene,camera);
 if(selected==='Attack3'){const head=gltf.scene.getObjectByName('Head').getWorldPosition(new THREE.Vector3()),center=head.clone().add(new THREE.Vector3(0,-1.5,0));detailCamera.position.copy(center).addScaledVector(direction,80);detailCamera.lookAt(center);renderer.setViewport(W-292,H-310,270,200);renderer.setScissor(W-292,H-310,270,200);renderer.setScissorTest(true);renderer.clearDepth();renderer.render(scene,detailCamera);renderer.setScissorTest(false);}
 document.getElementById('time').textContent=t.toFixed(2)+' / '+clips[selected].duration.toFixed(2)+' s';}
function snapshot(){const nodes={};for(const n of ['Bone_000','Head','Bone_043','Bone_044','Bone_024','FlightWing_NearTip']){const o=gltf.scene.getObjectByName(n);nodes[n]={position:o.getWorldPosition(new THREE.Vector3()).toArray(),direction:new THREE.Vector3(0,1,0).transformDirection(o.matrixWorld).toArray()};}return nodes;}
function bounds(){const b={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity};walkVertices(v=>{const p=v.clone().project(camera),x=(p.x+1)*W/2,y=(1-p.y)*H/2;b.minX=Math.min(b.minX,x);b.maxX=Math.max(b.maxX,x);b.minY=Math.min(b.minY,y);b.maxY=Math.max(b.maxY,y);});return b;}
for(const name of Object.keys(labels)){const button=document.createElement('button');button.textContent=labels[name][0];button.onclick=()=>select(name);document.getElementById('bar').append(button);}
select(params.get('clip')||'Attack1');render(0);
window.combat={ready:true,select,render,snapshot,bounds,model:gltf.scene,camera,renderer,fire,mouthAt,clips:Object.fromEntries(Object.entries(clips).map(([n,c])=>[n,c.duration]))};
if(!params.has('capture')){const clock=new THREE.Clock();let previous=0;function tick(){const now=clock.getElapsedTime();elapsed+=now-previous;previous=now;const d=clips[selected].duration,cycle=d+(selected==='Die'?.8:0);render(Math.min(d,elapsed%cycle));requestAnimationFrame(tick);}requestAnimationFrame(tick);}
