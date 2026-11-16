import * as THREE from 'three';
import { GLTFLoader } from '/three/loaders/GLTFLoader.js';

const W = 640, H = 360, GIF_FPS = 25;
const params = new URLSearchParams(location.search);
const CLIP = params.get('clip') || 'Walk';
const ASSET = params.get('asset') || '/assets/boss6_game.glb';
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H); renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.8;
document.getElementById('wrap').prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x15111d);
const camera = new THREE.PerspectiveCamera(32, W / H, 0.1, 200);
{
  const pm = new THREE.PMREMGenerator(renderer), es = new THREE.Scene();
  es.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide,
    vertexShader: 'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
    fragmentShader: 'varying vec3 vP; void main(){ float h=normalize(vP).y; vec3 top=vec3(0.8,0.78,0.9); vec3 hor=vec3(0.4,0.32,0.45); vec3 bot=vec3(0.08,0.06,0.1); vec3 c = h>0.0 ? mix(hor,top,pow(h,0.6)) : mix(hor,bot,pow(-h,0.5)); float s=smoothstep(0.55,0.8,dot(normalize(vP),normalize(vec3(-0.5,0.7,0.6)))); c+=vec3(2.0,1.8,1.6)*s; gl_FragColor=vec4(c,1.0);} ' })));
  scene.environment = pm.fromScene(es, 0.04).texture;
}
scene.add(new THREE.HemisphereLight(0xffe6e0, 0x2a1c34, 0.9));
const key = new THREE.DirectionalLight(0xfff0e6, 1.8); key.position.set(-4, 7, 6); scene.add(key);
const rim = new THREE.DirectionalLight(0x8c9cff, 1.2); rim.position.set(4, 4, -7); scene.add(rim);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.ShaderMaterial({
  vertexShader: 'varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }',
  fragmentShader: 'varying vec3 vW; float gl(vec2 p,float s){ vec2 q=p/s; vec2 g=abs(fract(q-0.5)-0.5)/fwidth(q); return 1.0-min(min(g.x,g.y),1.0);} void main(){ vec3 base=vec3(0.075,0.06,0.105); float m1=gl(vW.xz,1.0), m5=gl(vW.xz,5.0); float fade=clamp(1.0-length(vW.xz-cameraPosition.xz)/60.0,0.0,1.0); vec3 c=base+vec3(0.16,0.14,0.22)*m1*0.30*fade+vec3(0.28,0.24,0.40)*m5*0.55*fade; gl_FragColor=vec4(c,1.0);} ' }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; scene.add(ground);
const shadowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(0,0,0,0.7)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.005; scene.add(shadow);
const boss = new THREE.Group(); scene.add(boss);
let mixer, action, nodes = {};
const hud = document.getElementById('hud');
const DUR = { Walk: 2.4, Attack1: 3.4, Attack2: 6.2, Attack3: 2.5, Die: 3.4 };
async function setup() {
  const gltf = await new Promise((res, rej) => new GLTFLoader().load(ASSET, res, undefined, rej));
  boss.add(gltf.scene);
  gltf.scene.traverse(o => { nodes[o.name] = o; if (o.isMesh || o.isSkinnedMesh) { o.frustumCulled = false; (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.envMapIntensity = 0.8; m.side = THREE.DoubleSide; }); } });
  mixer = new THREE.AnimationMixer(gltf.scene);
  const clip = THREE.AnimationClip.findByName(gltf.animations, CLIP);
  action = mixer.clipAction(clip); action.play();
  action.setLoop(CLIP === 'Walk' ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); action.clampWhenFinished = true;
  window.__ready = true;
}
window.frames = () => Math.round(DUR[CLIP] * GIF_FPS);
window.frame = (i) => {
  const t = i / GIF_FPS;
  action.time = CLIP === 'Walk' ? t % action.getClip().duration : Math.min(t, action.getClip().duration);
  mixer.update(0);
  const walkX = CLIP === 'Walk' ? 0 : 0, walkZ = CLIP === 'Walk' ? 3.2 * t : 0;     // the game drives travel: the preview just slides the model
  boss.position.set(walkX, 0, walkZ);
  boss.updateMatrixWorld(true);
  shadow.position.set(0, 0.005, walkZ);
  const b = boss.position;
  if (CLIP === 'Attack2') { camera.fov = 38; camera.position.set(-4.2, 2.2, 4.4); camera.lookAt(0, 1.3, 0.3); }
  else { camera.fov = 34; camera.position.set(b.x - 3.6, 1.9, b.z + 3.4); camera.lookAt(b.x, 1.05, b.z + 0.2); }
  camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  hud.textContent = CLIP + '   ' + t.toFixed(2) + ' s';
  renderer.render(scene, camera);
  return true;
};
setup().catch(e => { window.__err = String(e && e.stack || e); });
