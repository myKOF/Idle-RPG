import * as THREE from 'three';
import {GLTFLoader} from '/three/loaders/GLTFLoader.js';
const params=new URLSearchParams(location.search),W=params.has('full')?800:640,H=params.has('full')?600:360;
const profile=await(await fetch('/flight_profile.json')).json();
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(W,H);renderer.setPixelRatio(1);
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;document.body.prepend(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color(0x7e9099);
const skyMaterial=new THREE.ShaderMaterial({depthWrite:false,depthTest:false,toneMapped:false,
 uniforms:{clock:{value:0}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,1.,1.);}',
 fragmentShader:`varying vec2 vUv;uniform float clock;
 float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
 float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<6;i++){v+=a*noise(p);p=p*2.04+vec2(4.7,1.2);a*=.5;}return v;}
 void main(){vec2 p=vUv*vec2(5.8,3.5)+vec2(clock*.035,0.);float n=fbm(p+fbm(p*1.5));float cloud=smoothstep(.40,.72,n);
 vec3 base=mix(vec3(.26,.37,.45),vec3(.60,.66,.68),vUv.y);vec3 c=mix(base,vec3(.80,.82,.80),cloud*.76);c-=vec3(.035)*(1.-cloud)*fbm(p*3.);gl_FragColor=vec4(c,1.);}`});
const sky=new THREE.Mesh(new THREE.PlaneGeometry(2,2),skyMaterial);sky.frustumCulled=false;sky.renderOrder=-1000;scene.add(sky);
scene.add(new THREE.HemisphereLight(0xdfe6e7,0x5b5142,1.1));
const key=new THREE.DirectionalLight(0xf8eee0,2.5);key.position.set(-8,16,8);scene.add(key);
const fill=new THREE.DirectionalLight(0xb6cbd6,.9);fill.position.set(6,5,-5);scene.add(fill);
const envScene=new THREE.Scene();
const envMesh=new THREE.Mesh(new THREE.SphereGeometry(50,24,12),new THREE.ShaderMaterial({side:THREE.BackSide,vertexShader:'varying vec3 p;void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec3 p;void main(){float h=normalize(p).y;vec3 c=mix(vec3(.15,.18,.21),vec3(.60,.65,.68),smoothstep(-.3,.8,h));gl_FragColor=vec4(c,1.);}'}));envScene.add(envMesh);
const pm=new THREE.PMREMGenerator(renderer);scene.environment=pm.fromScene(envScene).texture;pm.dispose();envMesh.geometry.dispose();envMesh.material.dispose();scene.environmentIntensity=.7;
const height=params.has('full')?12.6:profile.camera.heightMeters;
const camera=new THREE.OrthographicCamera(-height*W/H/2,height*W/H/2,height/2,-height/2,.1,300);
const gltf=await new GLTFLoader().loadAsync('/assets/boss9_flight.glb');scene.add(gltf.scene);
const clip=gltf.animations.find(c=>c.name==='Walk');if(!clip)throw Error('Walk missing');
const mixer=new THREE.AnimationMixer(gltf.scene),action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
function pose(t){action.reset().play();mixer.setTime(t%profile.period);gltf.scene.updateMatrixWorld(true);}
pose(0);
const root=gltf.scene.getObjectByName('Bone_000').getWorldPosition(new THREE.Vector3());
const az=profile.camera.azimuth*Math.PI/180,el=profile.camera.elevation*Math.PI/180;
const direction=new THREE.Vector3(-Math.sin(az)*Math.cos(el),Math.sin(el),Math.cos(az)*Math.cos(el));
const right=new THREE.Vector3(Math.cos(az),0,Math.sin(az));
const up=new THREE.Vector3().crossVectors(direction,right).normalize();
const hip=params.has('full')?[W/2,H*7/12]:profile.camera.hipPixel;
const center=root.clone().addScaledVector(right,(W/2-hip[0])*height/H).addScaledVector(up,(hip[1]-H/2)*height/H);
camera.position.copy(center).addScaledVector(direction,80);camera.lookAt(center);
function render(t){pose(t);skyMaterial.uniforms.clock.value=t;renderer.render(scene,camera);}
render(0);
function bounds(){const box={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity};const p=new THREE.Vector3();
 gltf.scene.traverse(o=>{if(!o.isMesh)return;const count=o.geometry.attributes.position.count;for(let i=0;i<count;i++){o.getVertexPosition(i,p);p.applyMatrix4(o.matrixWorld).project(camera);const x=(p.x+1)*W/2,y=(1-p.y)*H/2;box.minX=Math.min(box.minX,x);box.maxX=Math.max(box.maxX,x);box.minY=Math.min(box.minY,y);box.maxY=Math.max(box.maxY,y);}});return box;}
window.flight={ready:true,render,model:gltf.scene,camera,renderer,profile,period:clip.duration,bounds,
 snapshot:()=>{const result={};for(const n of ['Bone_000','Head','FlightWing_NearRoot','FlightWing_NearMiddle','FlightWing_NearTip','FlightWing_FarRoot','Bone_024','Bone_043','Bone_007'])result[n]=gltf.scene.getObjectByName(n).getWorldPosition(new THREE.Vector3()).toArray();return result;}};
if(!params.has('capture')){const clock=new THREE.Clock();function animate(){render(clock.getElapsedTime());requestAnimationFrame(animate);}requestAnimationFrame(animate);}
