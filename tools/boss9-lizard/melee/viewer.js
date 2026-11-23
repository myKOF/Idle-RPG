import * as THREE from 'three';
import {GLTFLoader} from '/three/loaders/GLTFLoader.js';
const params=new URLSearchParams(location.search),W=900,H=600;
const spec=await(await fetch('/spec.json')).json(),profile=await(await fetch('/exports/build.json')).json();
const API=window.Boss9Melee,scenario=params.get('scenario')||'clean',debug=scenario!=='clean';
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(W,H);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;document.body.append(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color(0x34434e);scene.add(new THREE.HemisphereLight(0xeaf3ff,0x35312b,2));
for(const[c,i,p]of [[0xffe9cd,3,[-3,6,5]],[0xa9c9ff,2,[4,4,-3]]]){const l=new THREE.DirectionalLight(c,i);l.position.set(...p);if(i===3){l.castShadow=true;l.shadow.mapSize.set(2048,2048);Object.assign(l.shadow.camera,{left:-3,right:3,top:3,bottom:-3,near:.1,far:20});l.shadow.bias=-.0002;l.shadow.normalBias=.008;}scene.add(l);}
const env=new THREE.Scene(),sphere=new THREE.Mesh(new THREE.SphereGeometry(20,24,16),new THREE.ShaderMaterial({side:THREE.BackSide,vertexShader:'varying vec3 p;void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec3 p;void main(){float y=normalize(p).y;gl_FragColor=vec4(mix(vec3(.17,.20,.24),vec3(.7,.77,.83),smoothstep(-.3,.8,y)),1.);}'}));env.add(sphere);const pm=new THREE.PMREMGenerator(renderer);scene.environment=pm.fromScene(env).texture;pm.dispose();sphere.geometry.dispose();sphere.material.dispose();
const gltf=await new GLTFLoader().loadAsync('/exports/boss9_attack1.glb'),container=new THREE.Group();container.add(gltf.scene);scene.add(container);
gltf.scene.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
const clip=gltf.animations.find(c=>c.name===spec.id);if(!clip)throw Error('Missing '+spec.id);
const extras=gltf.parser.json.animations.find(a=>a.name===spec.id).extras;
if(JSON.stringify(extras.AnimationNotifies)!==JSON.stringify(spec.notifies))throw Error('Animation notify mismatch');
const mixer=new THREE.AnimationMixer(gltf.scene),action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
const targetZ={combat:1.8,blocked:1.57,behind:-1,far:2.4};
function sample(t){return new API.Attack(spec,{targets:debug?[{id:'player',x:spec.axisX,z:targetZ[scenario]??1.8,y:spec.ground,radius:.18,height:.95}]:[]}).advanceTo(t);}
let state;
function pose(t){state=sample(t);action.paused=false;action.enabled=true;mixer.setTime(Math.max(0,Math.min(t,clip.duration)));container.position.set(state.position.x-spec.axisX,0,state.position.z-state.authoredDistance);container.updateMatrixWorld(true);}
function vertices(fn){const p=new THREE.Vector3();gltf.scene.traverse(o=>{if(!o.isMesh)return;for(let i=0;i<o.geometry.attributes.position.count;i++){o.getVertexPosition(i,p);p.applyMatrix4(o.matrixWorld);fn(p);}});}
const az=Number(params.get('azimuth')??0)*Math.PI/180,top=params.has('top'),el=12*Math.PI/180;
const direction=top?new THREE.Vector3(0,1,.001).normalize():new THREE.Vector3(-Math.sin(az)*Math.cos(el),Math.sin(el),Math.cos(az)*Math.cos(el));
const camera=new THREE.OrthographicCamera(-2,2,1.5,-1.5,.01,100);if(top)camera.up.set(0,0,1);
const right=top?new THREE.Vector3(-1,0,0):new THREE.Vector3(Math.cos(az),0,Math.sin(az)),up=new THREE.Vector3().crossVectors(direction,right).normalize();
let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minD=Infinity,maxD=-Infinity;
function include(p){const x=p.dot(right),y=p.dot(up),d=p.dot(direction);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);minD=Math.min(minD,d);maxD=Math.max(maxD,d);}
for(let i=0;i<=120;i++){pose(spec.duration*i/120);vertices(include);if(debug){for(const t of state.targets){for(const x of [t.x-t.radius,t.x+t.radius])for(const y of [t.y,t.y+t.height])for(const z of [t.z-t.radius,t.z+t.radius])include(new THREE.Vector3(x,y,z));}}}
if(debug)for(const x of [-1.35,1.5])for(const y of [spec.ground,.8])for(const z of [0,1.9])include(new THREE.Vector3(x,y,z));
const height=Math.max(maxY-minY,(maxX-minX)*H/W)*1.22,center=new THREE.Vector3().addScaledVector(right,(minX+maxX)/2).addScaledVector(up,(minY+maxY)/2).addScaledVector(direction,(minD+maxD)/2);
camera.left=-height*W/H/2;camera.right=height*W/H/2;camera.top=height/2;camera.bottom=-height/2;camera.position.copy(center).addScaledVector(direction,10);camera.lookAt(center);camera.updateProjectionMatrix();
const ground=new THREE.Mesh(new THREE.PlaneGeometry(30,30),new THREE.MeshStandardMaterial({color:0x293944,roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=spec.ground;ground.receiveShadow=true;scene.add(ground);
const grid=new THREE.GridHelper(30,60,0x81939f,0x50606c);grid.position.y=spec.ground+.001;grid.material.transparent=true;grid.material.opacity=.24;scene.add(grid);
const bodyCapsule=new THREE.Mesh(new THREE.CapsuleGeometry(spec.bossCapsule.radius,spec.bossCapsule.height-2*spec.bossCapsule.radius,6,12),new THREE.MeshBasicMaterial({color:0x7ccbdc,wireframe:true,transparent:true,opacity:.45}));bodyCapsule.visible=debug;scene.add(bodyCapsule);
const avatar=new THREE.Mesh(new THREE.CapsuleGeometry(.18,.95-.36,8,16),new THREE.MeshStandardMaterial({color:0x78d4f5,transparent:true,opacity:.6,roughness:.5}));avatar.visible=debug;avatar.castShadow=true;scene.add(avatar);
const fanPoints=[];for(let i=0;i<32;i++){const a=(-60+i*120/32)*Math.PI/180,b=(-60+(i+1)*120/32)*Math.PI/180;fanPoints.push(0,0,0,Math.sin(a)*spec.hitbox.range,0,Math.cos(a)*spec.hitbox.range,Math.sin(b)*spec.hitbox.range,0,Math.cos(b)*spec.hitbox.range);}
const fanGeometry=new THREE.BufferGeometry();fanGeometry.setAttribute('position',new THREE.Float32BufferAttribute(fanPoints,3));const fan=new THREE.Mesh(fanGeometry,new THREE.MeshBasicMaterial({color:0xff654b,transparent:true,opacity:.26,side:THREE.DoubleSide,depthWrite:false}));scene.add(fan);
let skin,rootBone;gltf.scene.traverse(o=>{if(o.isSkinnedMesh)skin=o;if(o.isBone&&o.name==='root')rootBone=o;});
pose(0);const rootStart=rootBone.getWorldPosition(new THREE.Vector3());
function geometry(){const p=new THREE.Vector3(),mean=ids=>{const q=new THREE.Vector3();for(const i of ids){skin.getVertexPosition(i,p);q.add(p.applyMatrix4(skin.matrixWorld));}return q.multiplyScalar(1/ids.length);};const claw=mean(profile.clawIndices),base=mean(profile.fingerBaseIndices),tip=mean(profile.fingerTipIndices),finger=tip.clone().sub(base).normalize(),root=rootBone.getWorldPosition(new THREE.Vector3());return {claw:claw.toArray(),fingerDirection:finger.toArray(),fingerTips:profile.fingerTipGroups.map(ids=>mean(ids).toArray()),rootHead:root.toArray(),rootAdvance:root.z-rootStart.z,minimumCapsuleGap:state.targets.length?Math.min(...state.targets.map(t=>API.capsuleGap(state.bodyCapsule,t))):null};}
function bounds(){const b={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity};vertices(p=>{const s=p.clone().project(camera);b.minX=Math.min(b.minX,(s.x+1)*W/2);b.maxX=Math.max(b.maxX,(s.x+1)*W/2);b.minY=Math.min(b.minY,(1-s.y)*H/2);b.maxY=Math.max(b.maxY,(1-s.y)*H/2);});return b;}
function snapshot(){const nodes={};gltf.scene.traverse(o=>{if(o.isBone)nodes[o.name]=o.getWorldPosition(new THREE.Vector3()).toArray();});return nodes;}
const labels={Windup:'前搖蓄力',Active:'抬爪／揮擊',Recovery:'收招回穩',Idle:'待機'},colors={Windup:'#786a32',Active:'#9c4934',Recovery:'#365e83',Idle:'#435d69'};
const guides=[];
if(params.has('guide')){
 const tracks=[[],[],[]],steps=96;
 for(let i=0;i<=steps;i++){pose(spec.hitbox.on+(spec.hitbox.off-spec.hitbox.on)*i/steps);geometry().fingerTips.forEach((p,j)=>tracks[j].push(new THREE.Vector3(...p)));}
 for(let j=0;j<3;j++){const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(tracks[j]),new THREE.LineBasicMaterial({color:[0xffd67f,0xa5e6ef,0xffffff][j],transparent:true,opacity:.8,depthTest:false}));line.renderOrder=10;scene.add(line);guides.push(line);}
 document.getElementById('subtitle').textContent='實際三根爪尖的移動軌跡（檢視標記）';
}
function render(t){
 pose(t);bodyCapsule.position.set(state.bodyCapsule.x,spec.ground+spec.bossCapsule.height/2,state.bodyCapsule.z);fan.visible=debug&&state.hitbox;fan.scale.setScalar(state.hitboxRange/spec.hitbox.range);fan.position.set(state.position.x,spec.ground+.015,state.position.z);
 if(debug){const target=state.targets[0];avatar.position.set(target.x,target.y+target.height/2,target.z);avatar.material.color.set(state.hits.length?0xff8e74:0x78d4f5);}
 for(const line of guides)line.geometry.setDrawRange(0,t<spec.hitbox.on?0:Math.min(97,1+Math.floor((t-spec.hitbox.on)/(spec.hitbox.off-spec.hitbox.on)*96)));
 renderer.render(scene,camera);document.getElementById('phase').textContent=labels[state.phase];document.getElementById('phase').style.background=colors[state.phase];document.getElementById('time').textContent=t.toFixed(2)+' / '+spec.duration.toFixed(2)+' s';
 document.getElementById('detail').style.display=debug?'block':'none';document.getElementById('detail').textContent=`Hitbox: ${state.hitbox?'ON':'OFF'}   命中: ${state.hits.length}   HP: ${state.targets[0]?.hp??100}\n前移: ${state.actualDistance.toFixed(3)} / ${spec.rootMotion.distance.toFixed(3)}   阻擋: ${state.blockedDistance.toFixed(3)}`;
 document.getElementById('scrub').value=String(t);
}
render(0);window.lizard={ready:true,render,snapshot,bounds,centers:geometry,state:()=>state,duration:spec.duration,clipName:clip.name,scenario,model:gltf.scene};
if(params.has('capture'))document.getElementById('controls').style.display='none';
else{
 let running=true,time=0,last=performance.now();document.getElementById('scenario').value=scenario;document.getElementById('view').value=top?'top':String(Number(params.get('azimuth')??0));
 document.getElementById('play').onclick=()=>{running=!running;};document.getElementById('restart').onclick=()=>{time=0;render(0);};document.getElementById('scrub').oninput=e=>{running=false;time=Number(e.target.value);render(time);};
 document.getElementById('scenario').onchange=e=>{params.set('scenario',e.target.value);location.search=params.toString();};document.getElementById('view').onchange=e=>{params.delete('top');if(e.target.value==='top')params.set('top','1');else params.set('azimuth',e.target.value);location.search=params.toString();};
 function tick(){const now=performance.now();if(running){time+=Math.max(0,(now-last)/1000);if(time>spec.duration+.3)time=0;render(Math.min(time,spec.duration));}last=now;requestAnimationFrame(tick);}requestAnimationFrame(tick);
}
