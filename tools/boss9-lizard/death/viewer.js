import * as THREE from 'three';
import {GLTFLoader} from '/three/loaders/GLTFLoader.js';
const params=new URLSearchParams(location.search),W=900,H=600;
const spec=await(await fetch('/spec.json')).json(),profile=await(await fetch('/exports/build.json')).json();
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(W,H);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;document.body.append(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color(0x34434e);scene.add(new THREE.HemisphereLight(0xeaf3ff,0x35312b,2));
for(const[c,i,p]of [[0xffe9cd,3,[-3,6,5]],[0xa9c9ff,2,[4,4,-3]]]){const l=new THREE.DirectionalLight(c,i);l.position.set(...p);if(i===3){l.castShadow=true;l.shadow.mapSize.set(2048,2048);Object.assign(l.shadow.camera,{left:-3,right:3,top:3,bottom:-3,near:.1,far:20});l.shadow.bias=-.0002;l.shadow.normalBias=.008;}scene.add(l);}
const env=new THREE.Scene(),sphere=new THREE.Mesh(new THREE.SphereGeometry(20,24,16),new THREE.ShaderMaterial({side:THREE.BackSide,vertexShader:'varying vec3 p;void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec3 p;void main(){float y=normalize(p).y;gl_FragColor=vec4(mix(vec3(.17,.20,.24),vec3(.7,.77,.83),smoothstep(-.3,.8,y)),1.);}'}));env.add(sphere);const pm=new THREE.PMREMGenerator(renderer);scene.environment=pm.fromScene(env).texture;pm.dispose();sphere.geometry.dispose();sphere.material.dispose();
const gltf=await new GLTFLoader().loadAsync('/exports/boss9_death.glb');scene.add(gltf.scene);let skin;gltf.scene.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}if(o.isSkinnedMesh)skin=o;});
const clip=gltf.animations.find(c=>c.name===spec.id);if(!clip)throw Error('Missing Death');
const mixer=new THREE.AnimationMixer(gltf.scene),action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
function pose(t){action.reset().play();mixer.setTime(t);gltf.scene.updateMatrixWorld(true);skin.skeleton.update();}
const mean=ids=>{const sum=new THREE.Vector3(),v=new THREE.Vector3();for(const i of ids){skin.getVertexPosition(i,v);sum.add(v.applyMatrix4(skin.matrixWorld));}return sum.multiplyScalar(1/ids.length);};
function geometry(){return Object.fromEntries(Object.entries(profile.hands).map(([s,h])=>{const normal=new THREE.Vector3();for(const tri of h.padTriangles){const p=tri.map(i=>skin.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(skin.matrixWorld));normal.add(p[1].sub(p[0]).cross(p[2].sub(p[0])));}normal.normalize();return [s,{claw:mean(h.clawIndices).toArray(),palmNormal:normal.toArray(),tips:h.tipGroups.map(ids=>mean(ids).toArray())}];}));}
function vertices(fn){const v=new THREE.Vector3();for(let i=0;i<skin.geometry.attributes.position.count;i++){skin.getVertexPosition(i,v);fn(v.clone().applyMatrix4(skin.matrixWorld));}}
const azimuth=Number(params.get('azimuth')||0)*Math.PI/180,forward=new THREE.Vector3(Math.sin(azimuth),0,Math.cos(azimuth)),right=new THREE.Vector3(forward.z,0,-forward.x);
let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity;
for(let i=0;i<=60;i++){pose(i*spec.duration/60);vertices(v=>{const x=v.dot(right),z=v.dot(forward);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,v.y);maxY=Math.max(maxY,v.y);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);});}
const center=right.clone().multiplyScalar((minX+maxX)/2).addScaledVector(forward,(minZ+maxZ)/2);center.y=(minY+maxY)/2;
const camera=new THREE.OrthographicCamera(-1,1,1,-1,.01,100);camera.position.copy(center).addScaledVector(forward,6);camera.position.y+=.65;camera.lookAt(center);camera.updateMatrixWorld();
let fitX=0,fitY=0;
for(let i=0;i<=60;i++){pose(i*spec.duration/60);vertices(v=>{v.applyMatrix4(camera.matrixWorldInverse);fitX=Math.max(fitX,Math.abs(v.x));fitY=Math.max(fitY,Math.abs(v.y));});}
const hh=Math.max(fitY,fitX/(W/H))*1.17;Object.assign(camera,{left:-hh*W/H,right:hh*W/H,top:hh,bottom:-hh});camera.updateProjectionMatrix();
const floor=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:0x425665,roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=spec.ground-.003;floor.receiveShadow=true;scene.add(floor);
const grid=new THREE.GridHelper(8,16,0x738791,0x526a77);grid.position.y=spec.ground+.001;grid.material.transparent=true;grid.material.opacity=.12;scene.add(grid);
const guides=[];let current=0;const phase=t=>[...spec.phases].reverse().find(p=>t>=p[0])?.[1]||spec.phases[0][1];
document.getElementById('scrub').max=spec.duration;
document.getElementById('subtitle').textContent='受創失衡 → 跪倒側翻 → 餘勢沉落';
function render(t){t=Math.max(0,Math.min(spec.duration,t));current=t;pose(t);for(const g of guides){const w=g.userData.window;g.geometry.setDrawRange(0,t<w.start?0:Math.min(97,1+Math.floor((t-w.start)/(w.end-w.start)*96)));}renderer.render(scene,camera);document.getElementById('phase').textContent=phase(t);document.getElementById('time').textContent=t.toFixed(2)+' / '+spec.duration.toFixed(2)+' s';document.getElementById('scrub').value=t;}
function snapshot(){const nodes={};gltf.scene.traverse(o=>{if(o.isBone)nodes[o.name]=o.getWorldPosition(new THREE.Vector3()).toArray();});return nodes;}
function bounds(){const b={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity};vertices(v=>{v.project(camera);const x=(v.x+1)*W/2,y=(1-v.y)*H/2;b.minX=Math.min(b.minX,x);b.maxX=Math.max(b.maxX,x);b.minY=Math.min(b.minY,y);b.maxY=Math.max(b.maxY,y);});return b;}
render(0);window.deathPreview={ready:true,render,geometry,snapshot,bounds,duration:spec.duration,clipName:clip.name,state:()=>({time:current,phase:phase(current)})};
if(params.has('capture'))document.getElementById('controls').style.display='none';
else{let running=true,time=0,last=performance.now();document.getElementById('play').onclick=()=>{running=!running;};document.getElementById('restart').onclick=()=>{time=0;running=true;render(0);};document.getElementById('scrub').oninput=e=>{running=false;time=Number(e.target.value);render(time);};function tick(now){if(running){time=Math.min(spec.duration,time+(now-last)/1000);render(time);}last=now;requestAnimationFrame(tick);}requestAnimationFrame(tick);}
