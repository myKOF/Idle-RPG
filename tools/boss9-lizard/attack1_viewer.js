import * as THREE from 'three';
import {GLTFLoader} from '/three/loaders/GLTFLoader.js';
const params=new URLSearchParams(location.search),W=900,H=600;
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setSize(W,H);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;document.body.append(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color(0x34434e);
scene.add(new THREE.HemisphereLight(0xeaf3ff,0x35312b,2));
for(const [c,i,p] of [[0xffe9cd,3,[-3,6,5]],[0xa9c9ff,2,[4,4,-3]]]){const l=new THREE.DirectionalLight(c,i);l.position.set(...p);if(i===3){l.castShadow=true;l.shadow.mapSize.set(2048,2048);Object.assign(l.shadow.camera,{left:-3,right:3,top:3,bottom:-3,near:.1,far:20});l.shadow.bias=-.0002;l.shadow.normalBias=.008;}scene.add(l);}
const env=new THREE.Scene(),sphere=new THREE.Mesh(new THREE.SphereGeometry(20,24,16),new THREE.ShaderMaterial({side:THREE.BackSide,vertexShader:'varying vec3 p;void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec3 p;void main(){float y=normalize(p).y;gl_FragColor=vec4(mix(vec3(.17,.20,.24),vec3(.7,.77,.83),smoothstep(-.3,.8,y)),1.);}'}));
env.add(sphere);const pm=new THREE.PMREMGenerator(renderer);scene.environment=pm.fromScene(env).texture;pm.dispose();sphere.geometry.dispose();sphere.material.dispose();
const gltf=await new GLTFLoader().loadAsync('/exports/boss9_attack1.glb');scene.add(gltf.scene);
gltf.scene.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
const profile=await(await fetch('/exports/build.json')).json();
let skin;gltf.scene.traverse(o=>{if(o.isSkinnedMesh)skin=o;});
function meanWorld(ids){const p=new THREE.Vector3(),mean=new THREE.Vector3();for(const i of ids){skin.getVertexPosition(i,p);mean.add(p.applyMatrix4(skin.matrixWorld));}return mean.multiplyScalar(1/ids.length);}
function clawCenter(){const mean=meanWorld(profile.clawIndices),s=mean.clone().project(camera),a=meanWorld(profile.fingerBaseIndices),b=meanWorld(profile.fingerTipIndices);return {clawWorld:mean.toArray(),clawScreen:[(s.x+1)*W/2,(1-s.y)*H/2],fingerBaseWorld:a.toArray(),fingerTipWorld:b.toArray(),fingerDirectionWorld:b.sub(a).normalize().toArray()};}
const clip=gltf.animations.find(c=>c.name==='Attack1');if(!clip)throw Error('Missing Attack1');
const mixer=new THREE.AnimationMixer(gltf.scene),action=mixer.clipAction(clip);
action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
function pose(t){action.paused=false;action.enabled=true;mixer.setTime(Math.max(0,Math.min(t,clip.duration)));gltf.scene.updateMatrixWorld(true);}
function vertices(fn){const p=new THREE.Vector3();gltf.scene.traverse(o=>{if(!o.isMesh)return;for(let i=0;i<o.geometry.attributes.position.count;i++){o.getVertexPosition(i,p);p.applyMatrix4(o.matrixWorld);fn(p);}});}
const az=Number(params.get('azimuth')??20)*Math.PI/180,top=params.has('top'),el=12*Math.PI/180;
const direction=top?new THREE.Vector3(0,1,.001).normalize():new THREE.Vector3(-Math.sin(az)*Math.cos(el),Math.sin(el),Math.cos(az)*Math.cos(el));
const camera=new THREE.OrthographicCamera(-2,2,1.5,-1.5,.01,100);if(top)camera.up.set(0,0,1);
const right=top?new THREE.Vector3(-1,0,0):new THREE.Vector3(Math.cos(az),0,Math.sin(az)),up=new THREE.Vector3().crossVectors(direction,right).normalize();
let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minD=Infinity,maxD=-Infinity;
for(let i=0;i<=90;i++){pose(clip.duration*i/90);vertices(p=>{const x=p.dot(right),y=p.dot(up),d=p.dot(direction);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);minD=Math.min(minD,d);maxD=Math.max(maxD,d);});}
const height=Math.max(maxY-minY,(maxX-minX)*H/W)*1.20;
const center=new THREE.Vector3().addScaledVector(right,(minX+maxX)/2).addScaledVector(up,(minY+maxY)/2).addScaledVector(direction,(minD+maxD)/2);
camera.left=-height*W/H/2;camera.right=height*W/H/2;camera.top=height/2;camera.bottom=-height/2;
camera.position.copy(center).addScaledVector(direction,10);camera.lookAt(center);camera.updateProjectionMatrix();
const ground=new THREE.Mesh(new THREE.PlaneGeometry(30,30),new THREE.MeshStandardMaterial({color:0x293944,roughness:1}));
ground.rotation.x=-Math.PI/2;ground.position.y=profile.ground;scene.add(ground);
ground.receiveShadow=true;
const grid=new THREE.GridHelper(30,60,0x81939f,0x50606c);grid.position.y=profile.ground+.001;grid.material.transparent=true;grid.material.opacity=.24;scene.add(grid);
const guided=params.has('guide'),guide=new THREE.Group();guide.visible=guided;scene.add(guide);
const path=[];
if(guided){
 for(let i=0;i<=60;i++){pose(profile.timing.sweepStart+(profile.timing.sweepEnd-profile.timing.sweepStart)*i/60);path.push(new THREE.Vector3(...clawCenter().clawWorld));}
 const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(path),new THREE.LineBasicMaterial({color:0xffaf61,depthTest:false,transparent:true,opacity:.95}));line.renderOrder=20;guide.add(line);
 const tangent=path.at(-1).clone().sub(path.at(-2)).normalize();const arrow=new THREE.ArrowHelper(tangent,path.at(-1).clone().addScaledVector(tangent,-.05),.18,0xffaf61,.07,.05);arrow.line.material.depthTest=false;arrow.cone.material.depthTest=false;arrow.renderOrder=21;guide.add(arrow);
 document.getElementById('subtitle').textContent='1秒抬爪＋弧形揮擊 · 橘線：實際蒙皮爪端軌跡';
}
const marker=new THREE.Mesh(new THREE.SphereGeometry(.018,12,8),new THREE.MeshBasicMaterial({color:0xffdc9a,depthTest:false}));marker.renderOrder=22;guide.add(marker);
function snapshot(){const nodes={};gltf.scene.traverse(o=>{if(o.isBone){const p=o.getWorldPosition(new THREE.Vector3()),s=p.clone().project(camera);nodes[o.name]={position:p.toArray(),screen:[(s.x+1)*W/2,(1-s.y)*H/2]};}});return nodes;}
function bounds(){const b={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity};vertices(p=>{const s=p.clone().project(camera);b.minX=Math.min(b.minX,(s.x+1)*W/2);b.maxX=Math.max(b.maxX,(s.x+1)*W/2);b.minY=Math.min(b.minY,(1-s.y)*H/2);b.maxY=Math.max(b.maxY,(1-s.y)*H/2);});return b;}
function render(t){pose(t);if(guided){marker.position.set(...clawCenter().clawWorld);marker.visible=t>=profile.timing.sweepStart&&t<=profile.timing.sweepEnd;}renderer.render(scene,camera);document.getElementById('time').textContent=t.toFixed(2)+' / '+clip.duration.toFixed(2)+' s';}
render(0);window.lizard={ready:true,render,snapshot,bounds,centers:clawCenter,duration:clip.duration,clipName:clip.name,model:gltf.scene,camera,renderer};
if(!params.has('capture')){const clock=new THREE.Clock();function tick(){render(clock.getElapsedTime()%clip.duration);requestAnimationFrame(tick);}requestAnimationFrame(tick);}
