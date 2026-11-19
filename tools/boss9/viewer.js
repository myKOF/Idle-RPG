import * as THREE from 'three';
import { GLTFLoader } from '/three/loaders/GLTFLoader.js';
import { DragonFire } from './fire.js';
const q=new URLSearchParams(location.search);
const W=Number(q.get('w')||960),H=Number(q.get('h')||600),FPS=30;
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(1);renderer.setSize(W,H);renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
document.body.prepend(renderer.domElement);
if(q.has('capture'))document.body.classList.add('capture');
const scene=new THREE.Scene();scene.background=new THREE.Color(0x0e151f);
scene.add(new THREE.HemisphereLight(0xd9e8ff,0x73604a,1.3));
const key=new THREE.DirectionalLight(0xffdfb7,2.5);key.position.set(-8,14,10);scene.add(key);
const rim=new THREE.DirectionalLight(0x83b9f8,3.4);rim.position.set(8,9,-10);scene.add(rim);
const fill=new THREE.DirectionalLight(0xf5e6cd,.9);fill.position.set(4,4,14);scene.add(fill);
// An authored neutral environment gives the original metallic PBR something to reflect.
const envScene=new THREE.Scene();
const envMesh=new THREE.Mesh(new THREE.SphereGeometry(50,32,16),new THREE.ShaderMaterial({side:THREE.BackSide,
 vertexShader:'varying vec3 p;void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
 fragmentShader:'varying vec3 p;void main(){float h=normalize(p).y;vec3 c=mix(vec3(.18,.20,.25),vec3(.7,.78,.9),smoothstep(-.1,.7,h));gl_FragColor=vec4(c,1.);}'}));
envScene.add(envMesh);const pm=new THREE.PMREMGenerator(renderer);scene.environment=pm.fromScene(envScene).texture;pm.dispose();envMesh.geometry.dispose();envMesh.material.dispose();
const camera=new THREE.PerspectiveCamera(32,W/H,.1,250);
const detailCamera=new THREE.PerspectiveCamera(32,280/210,.1,250);detailCamera.position.set(-12,7.3,18);detailCamera.lookAt(0,4,0);
const detailLabel=document.createElement('div');detailLabel.textContent='動作近景';detailLabel.style.cssText='position:absolute;right:30px;top:24px;color:#e4d2b6;font-size:12px;text-shadow:0 1px 3px #000;pointer-events:none';document.body.append(detailLabel);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(250,250),new THREE.MeshStandardMaterial({color:0x111c28,roughness:1}));
ground.rotation.x=-Math.PI/2;ground.position.y=-.025;scene.add(ground);
const grid=new THREE.GridHelper(100,100,0x3c4b57,0x26333f);grid.material.transparent=true;grid.material.opacity=.35;scene.add(grid);
const c=document.createElement('canvas');c.width=c.height=128;const cx=c.getContext('2d');
const gradient=cx.createRadialGradient(64,64,0,64,64,64);gradient.addColorStop(0,'rgba(0,0,0,.64)');gradient.addColorStop(.4,'rgba(0,0,0,.38)');gradient.addColorStop(1,'rgba(0,0,0,0)');cx.fillStyle=gradient;cx.fillRect(0,0,128,128);
const shadow=new THREE.Mesh(new THREE.PlaneGeometry(8,7),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(c),transparent:true,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=.005;scene.add(shadow);

const gltf=await new GLTFLoader().loadAsync('/assets/boss9.glb');scene.add(gltf.scene);
const clips=Object.fromEntries(gltf.animations.map(a=>[a.name,a]));
const mixer=new THREE.AnimationMixer(gltf.scene);const actions=Object.fromEntries(gltf.animations.map(a=>[a.name,mixer.clipAction(a)]));
const config=await (await fetch('/fire.json')).json();
const nozzle=gltf.scene.getObjectByName(config.socket);if(!nozzle)throw Error('Missing mouth socket');
let clip=q.get('clip')||'Walk',elapsed=0,playing=true;
function pose(name,t){mixer.stopAllAction();const action=actions[name];action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();mixer.setTime(Math.min(t,clips[name].duration));gltf.scene.updateMatrixWorld(true);}
const mouthSamples=[];
for(let i=0;i<=360;i++){
 pose('Attack3',i/120);
 mouthSamples.push({position:nozzle.getWorldPosition(new THREE.Vector3()),direction:new THREE.Vector3(...config.socketForward).transformDirection(nozzle.matrixWorld)});
}
function mouthAt(t){const f=THREE.MathUtils.clamp(t*120,0,360),a=Math.floor(f),b=Math.min(360,a+1);return {
 position:mouthSamples[a].position.clone().lerp(mouthSamples[b].position,f-a),
 direction:mouthSamples[a].direction.clone().lerp(mouthSamples[b].direction,f-a).normalize()};}
const fire=new DragonFire(scene,config,mouthAt);
// A world-space ruler is visible in the fire review; it uses the particle config's meters.
const ruler=new THREE.Group();scene.add(ruler);
for(let z=0;z<=config.range;z+=5){
 const points=[new THREE.Vector3(-1.2,.015,z),new THREE.Vector3(-2,.015,z)];
 ruler.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:0x9e8159})));
 const canvas=document.createElement('canvas');canvas.width=256;canvas.height=96;const ctx=canvas.getContext('2d');ctx.font='40px Segoe UI';ctx.textAlign='center';ctx.fillStyle='#c9b495';ctx.fillText(z+' m',128,55);
 const label=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),transparent:true,depthTest:false}));label.position.set(-2.4,.15,z);label.scale.set(2,.75,1);ruler.add(label);
}
const labels={Walk:['飛行移動','1.60 秒 · 循環飛行'],Attack1:['攻擊 1 · 前伸咬擊','1.50 秒 · 後仰蓄勢 → 張嘴前咬 → 回復'],Attack2:['攻擊 2 · 右爪橫掃','1.20 秒 · 轉體蓄勢 → 弧線揮爪 → 回復'],Attack3:['攻擊 3 · 烈焰吐息','3.00 秒 · 粒子火芯／火團／火星／煙霧 · 射程 30 米'],Die:['死亡 · 掙扎墜地','2.50 秒 · 後仰振翼 → 失速落地 → 側躺停止']};
function select(name){clip=name;elapsed=0;document.querySelectorAll('[data-clip]').forEach(b=>b.classList.toggle('active',b.dataset.clip===name));
 document.getElementById('title').textContent=labels[name][0];document.getElementById('subtitle').textContent=labels[name][1];
 detailLabel.style.display=name==='Attack3'?'':'none';
 if(name==='Attack3') {camera.position.set(-43,12,13);camera.lookAt(0,4.5,13);ruler.visible=true;}
 else if(q.get('view')==='side') {camera.position.set(19,8,8);camera.lookAt(0,3.8,0);ruler.visible=false;}
 else {camera.position.set(-10,7,14);camera.lookAt(0,3.7,0);ruler.visible=false;}
}
for(const name of Object.keys(labels)){const button=document.createElement('button');button.textContent=labels[name][0];button.dataset.clip=name;button.onclick=()=>select(name);document.getElementById('bar').append(button);}
const pause=document.createElement('button');pause.textContent='暫停';pause.onclick=()=>{playing=!playing;pause.textContent=playing?'暫停':'播放';};document.getElementById('bar').append(pause);
const timeLabel=document.createElement('span');timeLabel.id='time';document.getElementById('bar').append(timeLabel);
function render(t){pose(clip,t);if(clip==='Attack3')fire.update(t);else fire.clear();
 const hip=gltf.scene.getObjectByName('Bone_000').getWorldPosition(new THREE.Vector3());shadow.position.set(hip.x,.005,hip.z);
 shadow.material.opacity=clip==='Die'?.85:.58;
 renderer.setViewport(0,0,W,H);renderer.setScissorTest(false);renderer.render(scene,camera);
 if(clip==='Attack3'){
   renderer.setScissor(W-304,H-244,280,210);renderer.setViewport(W-304,H-244,280,210);renderer.setScissorTest(true);
   renderer.clearDepth();renderer.render(scene,detailCamera);renderer.setScissorTest(false);
 }
 timeLabel.textContent=t.toFixed(2)+' / '+clips[clip].duration.toFixed(2)+' s';}
select(clip);render(0);
window.preview={select,render,clips:Object.fromEntries(Object.entries(clips).map(([n,c])=>[n,c.duration])),fire,mouthAt,scene,camera,renderer,model:gltf.scene,
 frame:(i)=>render(i/FPS),frames:()=>Math.ceil(clips[clip].duration*FPS),ready:true};
document.getElementById('ready').textContent='GLB loaded · 5 clips · original PBR · 1 unit = 1 m';
let previous=performance.now();
function tick(now){const dt=Math.min(.05,(now-previous)/1000);previous=now;
 if(!q.has('capture')){if(playing)elapsed+=dt;const duration=clips[clip].duration;let t=elapsed;
   if(clip==='Die')t=elapsed%(duration+1.0)>duration?duration:elapsed%(duration+1.0);
   else if(clip==='Walk')t=elapsed%duration;
   else t=elapsed%(duration+.4)>duration?duration:elapsed%(duration+.4);
   render(t);}
 requestAnimationFrame(tick);}
requestAnimationFrame(tick);
