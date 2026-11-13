import * as THREE from 'three';
import { GLTFLoader } from '/three/loaders/GLTFLoader.js';

const W = 640, H = 360, GIF_FPS = 25, SUB = 0.02;
const params = new URLSearchParams(location.search);
const CLIP = params.get('clip') || 'Walk';
const ASSET = params.get('asset') || '/assets/boss5.glb';

let _seed = 1234567;
const rnd = () => { _seed |= 0; _seed = _seed + 0x6D2B79F5 | 0; let t = Math.imul(_seed ^ _seed >>> 15, 1 | _seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const rr = (a, b) => a + (b - a) * rnd();
const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) / 0.58;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('wrap').prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x120e1a);
const camera = new THREE.PerspectiveCamera(32, W / H, 0.5, 400);

// ---- soft environment so the glossy lacquer has something to reflect
{
  const pm = new THREE.PMREMGenerator(renderer);
  const es = new THREE.Scene();
  const g = new THREE.SphereGeometry(50, 32, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
    fragmentShader: 'varying vec3 vP; void main(){ float h=normalize(vP).y; vec3 top=vec3(0.75,0.7,0.85); vec3 hor=vec3(0.35,0.28,0.4); vec3 bot=vec3(0.08,0.06,0.1); vec3 c = h>0.0 ? mix(hor,top,pow(h,0.6)) : mix(hor,bot,pow(-h,0.5)); float s=smoothstep(0.55,0.8,dot(normalize(vP),normalize(vec3(-0.5,0.7,0.6)))); c+=vec3(2.0,1.8,1.6)*s; gl_FragColor=vec4(c,1.0);} '
  });
  es.add(new THREE.Mesh(g, m));
  scene.environment = pm.fromScene(es, 0.04).texture;
}
scene.add(new THREE.HemisphereLight(0xffe6e0, 0x2a1c34, 0.9));
const key = new THREE.DirectionalLight(0xfff0e6, 2.2); key.position.set(-5, 8, 6); scene.add(key);
const rim = new THREE.DirectionalLight(0x7f8cff, 1.1); rim.position.set(4, 4, -7); scene.add(rim);
const fireLight = new THREE.PointLight(0xff7a20, 0, 14, 1.6); scene.add(fireLight);

// ---- ground + metre grid
const groundMat = new THREE.ShaderMaterial({
  vertexShader: 'varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }',
  fragmentShader: 'varying vec3 vW; float gl(vec2 p,float s){ vec2 q=p/s; vec2 g=abs(fract(q-0.5)-0.5)/fwidth(q); return 1.0-min(min(g.x,g.y),1.0);} void main(){ vec3 base=vec3(0.075,0.06,0.105); float m1=gl(vW.xz,1.0), m5=gl(vW.xz,5.0), m20=gl(vW.xz,20.0); float dist=length(vW.xz-cameraPosition.xz); float fade=clamp(1.0-dist/220.0,0.0,1.0); vec3 c=base+vec3(0.16,0.14,0.22)*m1*0.30*fade+vec3(0.28,0.24,0.40)*m5*0.55*fade+vec3(0.30,0.26,0.44)*m20*0.6; gl_FragColor=vec4(c,1.0);} '
});
const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), groundMat);
ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; scene.add(ground);
function radialTex(stops) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'); const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [o, col] of stops) g.addColorStop(o, col);
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const shadowTex = radialTex([[0, 'rgba(0,0,0,0.65)'], [0.6, 'rgba(0,0,0,0.25)'], [1, 'rgba(0,0,0,0)']]);
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.01; scene.add(shadow);

// ---- billboard particle system (instanced quads)
class PS {
  constructor(max, additive, noise) {
    this.max = max; this.n = 0;
    this.P = new Float32Array(max * 3); this.V = new Float32Array(max * 3);
    this.A = new Float32Array(max); this.L = new Float32Array(max);
    this.S0 = new Float32Array(max); this.S1 = new Float32Array(max);
    this.C0 = new Float32Array(max * 4); this.C1 = new Float32Array(max * 4);
    this.G = new Float32Array(max); this.D = new Float32Array(max);
    this.R = new Float32Array(max); this.SP = new Float32Array(max); this.FI = new Float32Array(max);
    const base = new THREE.PlaneGeometry(2, 2);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.setAttribute('position', base.getAttribute('position'));
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3); this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(max), 1); this.aSize.setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); this.aCol.setUsage(THREE.DynamicDrawUsage);
    this.aRot = new THREE.InstancedBufferAttribute(new Float32Array(max), 1); this.aRot.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iSize', this.aSize); g.setAttribute('iCol', this.aCol); g.setAttribute('iRot', this.aRot);
    g.instanceCount = 0;
    const NOISE = 'float h(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); } float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1.0,0.0)),f.x),mix(h(i+vec2(0.0,1.0)),h(i+vec2(1.0,1.0)),f.x),f.y); } float fbm(vec2 p){ return vn(p)*0.5+vn(p*2.1)*0.3+vn(p*4.3)*0.2; }';
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: true,
      uniforms: { uNoise: { value: noise } },
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: 'attribute vec3 iPos; attribute float iSize; attribute vec4 iCol; attribute float iRot; varying vec2 vUv; varying vec4 vC; varying float vR; void main(){ vUv=position.xy; vC=iCol; vR=iRot; float c=cos(iRot), s=sin(iRot); vec2 p=vec2(c*position.x-s*position.y, s*position.x+c*position.y)*iSize; vec4 mv=viewMatrix*vec4(iPos,1.0); mv.xy+=p; gl_Position=projectionMatrix*mv; }',
      fragmentShader: 'uniform float uNoise; varying vec2 vUv; varying vec4 vC; varying float vR; ' + NOISE + ' void main(){ float d=length(vUv); float a=clamp(1.0-d,0.0,1.0); float n=fbm(vUv*1.7+vec2(vR*3.1,vR*1.7)); a=clamp(a*1.5-(1.0-n)*uNoise*0.9,0.0,1.0); a=a*a*(3.0-2.0*a); ' + (additive ? 'gl_FragColor=vec4(vC.rgb*a*vC.a,1.0);' : 'gl_FragColor=vec4(vC.rgb,a*vC.a);') + ' }'
    });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = additive ? 11 : 10;
    scene.add(this.mesh); this.geo = g;
  }
  emit(p, v, life, s0, s1, c0, c1, o = {}) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.P.set(p, i * 3); this.V.set(v, i * 3); this.A[i] = 0; this.L[i] = life; this.S0[i] = s0; this.S1[i] = s1;
    this.C0.set(c0, i * 4); this.C1.set(c1, i * 4);
    this.G[i] = o.grav || 0; this.D[i] = o.drag || 0; this.R[i] = o.rot !== undefined ? o.rot : rnd() * 6.28; this.SP[i] = o.spin || 0; this.FI[i] = o.fadeIn !== undefined ? o.fadeIn : 0.1;
  }
  update(dt) {
    for (let i = 0; i < this.n;) {
      this.A[i] += dt;
      if (this.A[i] >= this.L[i]) { this.remove(i); continue; }
      const k = Math.exp(-this.D[i] * dt);
      this.V[i * 3] *= k; this.V[i * 3 + 1] = this.V[i * 3 + 1] * k - this.G[i] * dt; this.V[i * 3 + 2] *= k;
      this.P[i * 3] += this.V[i * 3] * dt; this.P[i * 3 + 1] += this.V[i * 3 + 1] * dt; this.P[i * 3 + 2] += this.V[i * 3 + 2] * dt;
      this.R[i] += this.SP[i] * dt;
      i++;
    }
  }
  remove(i) {
    const j = --this.n; if (i === j) return;
    const cp = (a, s) => { for (let k = 0; k < s; k++) a[i * s + k] = a[j * s + k]; };
    cp(this.P, 3); cp(this.V, 3); cp(this.C0, 4); cp(this.C1, 4);
    for (const a of [this.A, this.L, this.S0, this.S1, this.G, this.D, this.R, this.SP, this.FI]) a[i] = a[j];
  }
  upload() {
    for (let i = 0; i < this.n; i++) {
      const u = this.A[i] / this.L[i];
      this.aPos.array[i * 3] = this.P[i * 3]; this.aPos.array[i * 3 + 1] = this.P[i * 3 + 1]; this.aPos.array[i * 3 + 2] = this.P[i * 3 + 2];
      this.aSize.array[i] = this.S0[i] + (this.S1[i] - this.S0[i]) * u;
      const fi = this.FI[i] > 0 ? Math.min(1, u / this.FI[i]) : 1;
      for (let k = 0; k < 3; k++) this.aCol.array[i * 4 + k] = this.C0[i * 4 + k] + (this.C1[i * 4 + k] - this.C0[i * 4 + k]) * u;
      this.aCol.array[i * 4 + 3] = (this.C0[i * 4 + 3] + (this.C1[i * 4 + 3] - this.C0[i * 4 + 3]) * u) * fi;
      this.aRot.array[i] = this.R[i];
    }
    this.aPos.needsUpdate = this.aSize.needsUpdate = this.aCol.needsUpdate = this.aRot.needsUpdate = true;
    this.geo.instanceCount = this.n;
  }
}
const smoke = new PS(4000, false, 1.0);   // normal blended: mist, dust, smoke
const add = new PS(6000, true, 0.5);      // additive: sparks, fire, glow

// ---- load
const loader = new GLTFLoader();
const load = (u) => new Promise((res, rej) => loader.load(u, res, undefined, rej));
const boss = new THREE.Group(); scene.add(boss);
let gltf, mixer, action, skullGltf;
const nodes = {};
const wp = (o) => o.getWorldPosition(new THREE.Vector3());
const hud = document.getElementById('hud');
const labels = [];
function addLabel(text, world, big) {
  const d = document.createElement('div'); d.className = 'lbl' + (big ? ' big' : ''); d.textContent = text;
  document.getElementById('wrap').appendChild(d); labels.push({ d, world: new THREE.Vector3(...world) });
}
function placeLabels() {
  for (const l of labels) {
    const v = l.world.clone().project(camera);
    l.d.style.left = ((v.x * 0.5 + 0.5) * W) + 'px'; l.d.style.top = ((-v.y * 0.5 + 0.5) * H + 3) + 'px';
    l.d.style.display = (v.z > 1 || v.z < -1) ? 'none' : 'block';
  }
}

// ---- scenario state
let scn = null, simT = 0, prev = {};
const glowTex = radialTex([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,0)']]);
const mkSprite = (col, depthTest) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: col, blending: THREE.AdditiveBlending, depthWrite: false, depthTest, transparent: true })); s.renderOrder = 12; scene.add(s); return s; };
const eyeCore = [mkSprite(0xff3010, true), mkSprite(0xff3010, true)];
const eyeHalo = [mkSprite(0xff2008, false), mkSprite(0xff2008, false)];
eyeHalo.forEach(s => s.material.opacity = 0.35);
const RED = [1.0, 0.12, 0.05], DRED = [0.55, 0.02, 0.04];

function sceneInfo() {
  scene.updateMatrixWorld(true);
  return {
    eyeL: wp(nodes.Eye_L), eyeR: wp(nodes.Eye_R), back: wp(nodes.Fx_Back), mouth: wp(nodes.Fx_Mouth), body: wp(nodes.Body),
    es: nodes.Eye_L.scale.x
  };
}
function emitLine(ps, a, b, n, fn) { for (let i = 0; i < n; i++) { const t = (i + rnd()) / n; fn(new THREE.Vector3().lerpVectors(a, b, t)); } }

function commonStep(t, dt, info, opt) {
  // eyes: glow sprites + sparks
  const alive = !(opt && opt.eyesOff);
  [info.eyeL, info.eyeR].forEach((p, k) => {
    const on = alive ? 1 : 0;
    const s = info.es * on;
    eyeCore[k].position.copy(p); eyeCore[k].scale.setScalar(0.32 * s); eyeCore[k].material.opacity = 0.85 * Math.min(1, s);
    eyeHalo[k].position.copy(p); eyeHalo[k].scale.setScalar(0.85 * s);
    if (alive) {
      const n = Math.floor(dt * 30 * s + rnd());
      for (let i = 0; i < n; i++) {
        add.emit([p.x + gauss() * 0.04, p.y + gauss() * 0.03, p.z + 0.05], [gauss() * 0.35, rr(0.1, 0.6), gauss() * 0.35 + rr(0.2, 0.7)], rr(0.35, 0.8), 0.07, 0.0, [1, 0.45, 0.1, 0.9], [0.9, 0.05, 0.02, 0], { drag: 1.5 });
      }
    }
  });
  // red mist trail from the back of the head, thicker the faster it moves
  const pb = prev.back || info.back; const spd = info.back.distanceTo(pb) / dt;
  const rate = (opt && opt.mist === 0) ? 0 : 30 + 5.0 * Math.min(spd, 40);
  const n = Math.min(14, Math.floor(rate * dt + rnd()));
  for (let i = 0; i < n; i++) {
    const p = new THREE.Vector3().lerpVectors(pb, info.back, (i + rnd()) / Math.max(1, n));
    p.x += gauss() * 0.28; p.y += gauss() * 0.30 - 0.1; p.z += gauss() * 0.22;
    smoke.emit([p.x, p.y, p.z], [gauss() * 0.25, 0.25 + rnd() * 0.3, gauss() * 0.25], rr(1.1, 1.7), rr(0.3, 0.5), rr(1.0, 1.6), [0.78, 0.04, 0.07, 0.48], [0.30, 0.0, 0.06, 0.0], { drag: 0.6, spin: gauss() * 0.4, fadeIn: 0.3 });
    if (rnd() < 0.18) add.emit([p.x, p.y, p.z], [gauss() * 0.2, 0.2, gauss() * 0.2], rr(0.7, 1.1), rr(0.2, 0.35), 0.8, [1, 0.12, 0.04, 0.10], [0.5, 0, 0.02, 0], { drag: 0.8 });
  }
  prev.back = info.back.clone();
}

// scenario definitions ------------------------------------------------------------------
const SCN = {
  Walk: {
    dur: 2.0, prewarm: 3.0, loop: true,
    anim: (t) => ((t % 1.0) + 1.0) % 1.0,
    boss: (t) => new THREE.Vector3(0, 0, 3.0 * t),
    camera: (t, b) => { camera.fov = 38; camera.position.set(b.x - 6.4, b.y + 2.0, b.z + 1.6); camera.lookAt(b.x, b.y + 1.3, b.z - 1.0); },
    step: (t, dt, info) => commonStep(t, dt, info),
    setup: () => { for (let z = -2; z < 60; z += 1) { if (z % 5 === 0) addLabel(z + ' m', [-1.2, 0, z]); } }
  },
  Attack1: {
    dur: 2.2, anim: (t) => Math.min(t, 1.8),
    boss: () => new THREE.Vector3(),
    camera: () => { camera.fov = 32; camera.position.set(-13, 3.0, 3.2); camera.lookAt(0, 1.4, 3.2); },
    step: (t, dt, info) => {
      commonStep(t, dt, info);
      if (!scn.hit && t >= 19.5 / 30) {
        scn.hit = true;
        const m = info.mouth;
        for (let i = 0; i < 60; i++) { const a = rnd() * 6.28, sp = rr(3, 11); add.emit([m.x, m.y + 0.2, m.z + 0.3], [Math.cos(a) * sp * 0.5, Math.sin(a) * sp * 0.8 + 2, rr(0.5, 1.0) * sp * 0.8], rr(0.3, 0.8), rr(0.1, 0.22), 0, [1, 0.9, 0.5, 1], [1, 0.2, 0.02, 0], { grav: 8, drag: 0.6 }); }
        add.emit([m.x, m.y + 0.2, m.z + 0.5], [0, 0, 0], 0.28, 1.2, 5.5, [1, 0.85, 0.65, 1], [1, 0.15, 0.05, 0], { fadeIn: 0.05, rot: 0 });
        for (let i = 0; i < 26; i++) { const a = rnd() * 6.28, sp = rr(1.5, 5); smoke.emit([m.x + gauss() * 0.4, 0.15, m.z + gauss() * 0.4], [Math.cos(a) * sp * 0.5, rr(0.2, 0.8), Math.sin(a) * sp], rr(0.8, 1.5), 0.4, 1.6, [0.45, 0.25, 0.22, 0.38], [0.2, 0.1, 0.1, 0], { drag: 1.4 }); }
      }
    },
    setup: () => { for (const z of [0, 2, 4, 6]) addLabel(z + ' m', [-0.6, 0, z], z === 6); }
  },
  Attack3: {
    dur: 3.0, anim: (t) => Math.min(t, 2.2),
    boss: () => new THREE.Vector3(),
    camera: () => { camera.fov = 34; camera.position.set(-19, 3.8, 7.3); camera.lookAt(0, 1.3, 7.3); },
    step: (t, dt, info) => {
      commonStep(t, dt, info);
      const on = t >= 22 / 30 && t <= 48 / 30;
      const m = info.mouth.clone();
      fireLight.position.set(m.x, m.y + 0.5, m.z + 2.5);
      fireLight.intensity = on ? 14 + 6 * Math.sin(t * 60) : 0;
      if (on) {
        const f = Math.min(1, (t - 22 / 30) / 0.12) * Math.min(1, (48 / 30 - t) / 0.12 + 0.2);
        const N = Math.floor(f * 6 + rnd());
        for (let i = 0; i < N; i++) {
          const sp = rr(19.5, 21.5), ay = gauss() * 0.045, ax = gauss() * 0.04;
          const v = [Math.sin(ay) * sp, Math.sin(ax) * sp, Math.cos(ay) * sp];
          const p = [m.x + gauss() * 0.06, m.y + gauss() * 0.05, m.z + 0.1];
          add.emit(p, v, rr(0.72, 0.78), 0.3, 2.2, [1.0, 0.55, 0.12, 0.55], [0.85, 0.12, 0.02, 0.0], { fadeIn: 0.04 });
          if (rnd() < 0.55) add.emit(p, [v[0] * 0.95, v[1] * 0.95, v[2] * 0.95], rr(0.45, 0.55), 0.2, 0.75, [1.0, 0.92, 0.6, 0.55], [1.0, 0.45, 0.08, 0.0], { fadeIn: 0.03 });
          if (rnd() < 0.5) smoke.emit(p, [v[0] * 0.55, v[1] * 0.55 + 0.6, v[2] * 0.55], rr(0.9, 1.3), 0.5, 2.8, [0.25, 0.04, 0.03, 0.30], [0.05, 0.02, 0.02, 0.0], { fadeIn: 0.2, drag: 0.4 });
          if (rnd() < 0.12) add.emit(p, [v[0] * 0.6 + gauss(), v[1] * 0.6 + rr(0, 2), v[2] * 0.7 + gauss()], rr(0.6, 1.1), 0.1, 0.0, [1, 0.8, 0.3, 1], [1, 0.2, 0.0, 0], { grav: 6 });
        }
      }
    },
    setup: () => { for (const z of [0, 5, 10, 15]) addLabel(z + ' m', [-0.8, 0, z], z === 15); }
  },
  Attack2: {
    dur: 3.8, anim: (t) => Math.min(t, 1.33),
    boss: () => new THREE.Vector3(),
    camera: (t) => {
      const near = { p: new THREE.Vector3(-6.0, 2.0, 3.6), l: new THREE.Vector3(0, 1.4, 2.8), f: 38 };
      const far = { p: new THREE.Vector3(-30, 44, -22), l: new THREE.Vector3(0, 0, 26), f: 42 };
      const k = Math.min(1, Math.max(0, (t - 0.65) / 1.2)); const s = k * k * (3 - 2 * k);
      const p = near.p.clone().lerp(far.p, s), l = near.l.clone().lerp(far.l, s);
      camera.fov = near.f + (far.f - near.f) * s; camera.position.copy(p); camera.lookAt(l);
      scn.kv = 1 + 4.0 * s;
    },
    step: (t, dt, info) => {
      commonStep(t, dt, info);
      const T0 = 14 / 30, KV = scn.kv || 1, SPD = 26.0;
      if (!scn.skulls && t >= T0) {
        scn.skulls = [];
        const m = info.mouth.clone();
        for (const yaw of [0, Math.PI / 6, -Math.PI / 6]) {
          const o = skullGltf.scene.clone(true); scene.add(o);
          const gl = mkSprite(0x30ff50, false); gl.material.opacity = 0.55; scn.skulls.push({ o, gl, yaw, pos: m.clone(), dist: 0, dead: -1 });
        }
        for (let i = 0; i < 26; i++) add.emit([m.x + gauss() * 0.1, m.y + gauss() * 0.1, m.z + 0.2], [gauss() * 1.6, gauss() * 1.2, rr(2, 8)], rr(0.35, 0.7), 0.2, 0.45, [0.3, 1, 0.3, 0.55], [0.05, 0.7, 0.15, 0], { drag: 1.6 });
      }
      if (scn.skulls) for (const s of scn.skulls) {
        if (s.dead >= 0) { s.dead += dt; s.o.visible = false; s.gl.visible = false; continue; }
        const dir = new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw));
        const a = s.pos.clone();
        s.pos.addScaledVector(dir, SPD * dt); s.dist += SPD * dt;
        s.o.position.copy(s.pos); s.o.rotation.set(0, s.yaw, 0); s.o.rotateZ(Math.sin(t * 9 + s.yaw * 3) * 0.12); s.o.position.y += Math.sin(t * 11 + s.yaw) * 0.05;
        s.gl.position.copy(s.o.position); s.gl.scale.setScalar(1.5 * KV); s.gl.material.opacity = 0.5;
        const n = 5;
        for (let i = 0; i < n; i++) {
          const p = new THREE.Vector3().lerpVectors(a, s.pos, (i + rnd()) / n);
          add.emit([p.x + gauss() * 0.1 * KV, p.y + gauss() * 0.1 * KV, p.z + gauss() * 0.1 * KV], [gauss() * 0.3, gauss() * 0.3 + 0.2, gauss() * 0.3], rr(0.35, 0.6), rr(0.3, 0.45) * KV, 0.05, [0.35, 1, 0.35, 0.5], [0.05, 0.6, 0.15, 0], { drag: 1.0 });
          if (rnd() < 0.5) smoke.emit([p.x, p.y, p.z], [gauss() * 0.2, 0.2, gauss() * 0.2], rr(0.6, 1.0), 0.3 * KV, 0.9 * KV, [0.2, 0.75, 0.25, 0.22], [0.04, 0.3, 0.1, 0], { drag: 1.0 });
        }
        if (s.dist >= 60) {
          s.dead = 0; s.o.visible = false;
          for (let i = 0; i < 40; i++) add.emit([s.pos.x, s.pos.y, s.pos.z], [gauss() * 5, rr(0, 6), gauss() * 5], rr(0.4, 0.9), 0.4 * KV, 0.1, [0.5, 1, 0.45, 0.8], [0.1, 0.7, 0.2, 0], { grav: 8, drag: 1.0 });
          add.emit([s.pos.x, s.pos.y, s.pos.z], [0, 0, 0], 0.35, 2.0 * KV, 5.5 * KV, [0.6, 1, 0.5, 0.8], [0.1, 0.8, 0.3, 0], { fadeIn: 0.05, rot: 0 });
        }
      }
    },
    setup: () => { for (const z of [20, 40, 60]) addLabel(z + ' m', [-1, 0, z], z === 60); },
    extra: () => {
      // range rings + 30deg fan guide lines on the ground
      const mat = new THREE.LineBasicMaterial({ color: 0x8a6fb0, transparent: true, opacity: 0.55 });
      for (const r of [20, 40, 60]) { const pts = []; for (let i = 0; i <= 128; i++) { const a = i / 128 * Math.PI * 2; pts.push(new THREE.Vector3(Math.sin(a) * r, 0.05, Math.cos(a) * r)); } scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat)); }
      const m2 = new THREE.LineBasicMaterial({ color: 0x70c070, transparent: true, opacity: 0.4 });
      for (const yaw of [0, 30, -30]) { const a = yaw * Math.PI / 180; scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.06, 0), new THREE.Vector3(Math.sin(a) * 60, 0.06, Math.cos(a) * 60)]), m2)); }
    }
  },
  Die: {
    dur: 4.6, anim: (t) => Math.min(t, 4.0),
    boss: () => new THREE.Vector3(),
    camera: () => { camera.fov = 44; camera.position.set(-7.0, 3.8, 7.0); camera.lookAt(0, 1.7, 0.4); },
    step: (t, dt, info) => {
      const shattered = t >= 2.0;
      commonStep(t, dt, info, { eyesOff: shattered, mist: shattered ? 0 : 1 });
      if (!shattered && t > 0.5) {
        const k = (t - 0.5) / 1.5; const n = Math.floor(dt * (20 + 140 * k * k) + rnd());
        for (let i = 0; i < n; i++) add.emit([info.body.x + gauss() * 0.45, info.body.y + gauss() * 0.5, info.body.z + gauss() * 0.4], [gauss() * 0.6, rr(-0.2, 0.8), gauss() * 0.6], rr(0.25, 0.6), 0.09, 0.0, [1, 0.5, 0.15, 0.95], [1, 0.1, 0.02, 0], { drag: 1.5 });
      }
      if (!scn.burst && shattered) {
        scn.burst = true;
        const c = info.body;
        for (let i = 0; i < 46; i++) { const d = new THREE.Vector3(gauss(), gauss() * 0.7, gauss()).normalize(); const s = rr(2, 6); smoke.emit([c.x + d.x * 0.3, c.y + d.y * 0.3, c.z + d.z * 0.3], [d.x * s, d.y * s, d.z * s], rr(1.2, 2.0), rr(0.5, 0.9), rr(2.0, 3.0), [0.75, 0.05, 0.07, 0.24], [0.2, 0, 0.04, 0], { drag: 1.8, spin: gauss() * 0.5 }); }
        for (let i = 0; i < 110; i++) { const d = new THREE.Vector3(gauss(), gauss() * 0.6 + 0.3, gauss()).normalize(); const s = rr(3, 10); add.emit([c.x, c.y, c.z], [d.x * s, d.y * s, d.z * s], rr(0.7, 1.4), rr(0.1, 0.22), 0.0, [1, 0.85, 0.35, 1], [1, 0.12, 0.02, 0], { grav: 9, drag: 0.5 }); }
        add.emit([c.x, c.y, c.z], [0, 0, 0], 0.22, 1.2, 4.2, [1, 0.8, 0.6, 0.8], [1, 0.1, 0.05, 0], { fadeIn: 0.05, rot: 0 });
      }
      if (shattered) {
        scn.sp = scn.sp || {};
        for (let i = 1; i <= 14; i++) {
          const n = nodes['Shard_' + String(i).padStart(2, '0')]; if (!n) continue;
          const p = wp(n); const q = scn.sp[i]; scn.sp[i] = p.clone();
          if (!q) continue;
          const spd = p.distanceTo(q) / dt;
          if (p.y < 0.45 && spd > 1.5 && rnd() < 0.5) smoke.emit([p.x + gauss() * 0.1, 0.12, p.z + gauss() * 0.1], [gauss() * 0.6, rr(0.3, 0.9), gauss() * 0.6], rr(0.8, 1.4), 0.3, 1.1, [0.5, 0.2, 0.2, 0.35], [0.2, 0.1, 0.1, 0], { drag: 1.2 });
        }
      }
    },
    setup: () => { }
  }
};

function applyAnim(t) {
  action.time = Math.min(scn.def.anim(t), action.getClip().duration - 1e-4 * 0);
  mixer.update(0);
  const b = scn.def.boss(t); boss.position.copy(b);
  scene.updateMatrixWorld(true);
}
function tick(t) {
  applyAnim(t);
  const info = sceneInfo();
  scn.def.step(t, SUB, info);
  smoke.update(SUB); add.update(SUB);
  // soft contact shadow under the mask
  const sy = Math.max(0.2, 1 - info.body.y / 5);
  shadow.position.set(info.body.x, 0.02, info.body.z); shadow.scale.setScalar(2.2 * sy + 0.5); shadow.material.opacity = 0.9 * sy;
  shadow.visible = !(CLIP === 'Die' && t >= 2.0);
}
async function setup() {
  gltf = await load(ASSET);
  boss.add(gltf.scene);
  gltf.scene.traverse(o => { nodes[o.name] = o; if (o.isMesh || o.isSkinnedMesh) { o.frustumCulled = false; (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.envMapIntensity = 0.7; m.side = THREE.DoubleSide; }); } });
  mixer = new THREE.AnimationMixer(gltf.scene);
  const clip = THREE.AnimationClip.findByName(gltf.animations, CLIP);
  action = mixer.clipAction(clip); action.play(); action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true;
  if (CLIP === 'Attack2') {
    skullGltf = await load('/assets/boss5_skull.glb');
    skullGltf.scene.traverse(o => { if (o.isMesh) { o.frustumCulled = false; (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { m.side = THREE.DoubleSide; }); } });
  }
  const def = SCN[CLIP]; scn = { def };
  def.setup(); if (def.extra) def.extra();
  _seed = 1234567;
  // pre-warm (walk only) so the trail is already long on frame 0
  if (def.prewarm) { for (let t = -def.prewarm; t < 0; t += SUB) tick(t); }
  simT = 0;
  window.__ready = true;
}
window.frame = (i) => {
  const t = i / GIF_FPS;
  while (simT < t - 1e-6) { simT += SUB; tick(simT); }
  applyAnim(t);
  const b = scn.def.boss(t); scn.def.camera(t, b);
  smoke.upload(); add.upload();
  const info = sceneInfo();
  const flick = 0.85 + 0.15 * Math.sin(t * 40);
  hud.textContent = CLIP + '   ' + t.toFixed(2) + ' s';
  camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
  placeLabels();
  renderer.render(scene, camera);
  return true;
};
window.__scene = scene; window.__cam = camera;
window.frames = () => Math.round(SCN[CLIP].dur * GIF_FPS);
setup().catch(e => { window.__err = String(e && e.stack || e); console.error(e); });
