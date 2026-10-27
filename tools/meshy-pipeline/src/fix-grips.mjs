#!/usr/bin/env node
/* 修正黃金騎士兩個攻擊動作裡「手沒有握在劍上」的問題（直接改 GLB 內烘焙好的動畫關鍵幀，不需要 Blender）。

   問題（使用者 2026-10-27 在遊戲內測回報）：
     Attack1（雙手直劈）：舉劍時兩手都握劍，但劈下去那一刻副手鬆開、握拳甩到旁邊，劈完才回到劍上。
     Attack2：右臂前伸的那幾幀，劍和前臂不成一直線，握劍方向很怪。

   做法：
     Attack1：以「副手握得最好的那一幀」為準，記下副手手腕相對劍的位置與朝向；之後每一幀把副手的目標放在劍上同一個位置，
              用兩段式 IK（上臂＋前臂，保留原本手肘彎曲的方向）重新解出 LeftArm／LeftForeArm，再把 LeftHand 轉回握劍的朝向。
     Attack2：重新設計下劈那一段（t≈1.14～）右臂的軌跡：高舉 → 由左上往右下一路斜砍而下，劍沿手臂成一直線，
              停在斜下方。原動作在 t=1.24～1.30 手臂近乎水平（劍停在頭部高度＝平砍），之後往下再往後拉。
              用兩段式 IK 解右臂，手臂方向用「相對身體面向」的仰角／側偏曲線（chop）給定。
              手臂各段的「扭轉」用瞄準＋參考幀的固定偏移決定（不累積），手與劍相對前臂只保留繞軸的自然握法、沒有手腕彎折，
              所以手掌順著手臂延伸的朝向，不會像只做最小旋轉那樣把手掌轉好幾圈。
   兩者都用權重 0～1 漸入漸出，沒被修到的幀與原動作逐位元相同。

   披風下擺：下擺最末端的頂點整個綁在腿骨骼上（權重只有腿、沒有髖部），腿一跨步它們就被拖開，三角面被拉成一根根細絲
   （使用者回報披風末端的「細絲」）。把下擺（y<0.6）的頂點改成以髖部為主，越往下越多，y<0.3 全部跟髖部；
   頂點清單在 data/sunbrand-cape-hem.json。

   另外：劍的網格上有 8 個三角面，其中一個頂點被 Meshy 錯綁到右手 65%＋右腿 35%（本來該跟著劍走）。腿一動，那個頂點被拖走，
   三角面被拉成一根長長的尖刺（使用者回報：揮劍時劍旁邊有尖刺、會跟著軌跡變形）。這 8 個三角面在靜止姿勢是劍身上的一小塊，
   拿掉後靜止姿勢與揮動中的劍、護手都完整。做法：從索引緩衝區拿掉（只改索引，頂點資料不動）。

   用法：node tools/meshy-pipeline/src/fix-grips.mjs <輸入.glb> <輸出.glb> [--check]
     --check：只量測、不寫檔，輸出修正前後的數據。
   輸入必須是「原始」動作的 GLB；對已修過的檔再跑一次，會以已修過的動作當基準，結果不同。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const THREE = await import(pathToFileURL(path.join(repoRoot, 'js/vendor/three/three.module.min.js')).href);
const { Vector3, Quaternion, Matrix4 } = THREE;

/* ---- 參數（單位：動作內的秒數）---- */
const CFG = {
  Attack1: {
    refTime: 0.92,            // 副手握得最好的那一幀（量測：離劍軸約 0.1、位置約在劍身 0.18）
    rampIn: [0.90, 1.00],     // 權重 0 → 1
    rampOut: null,            // 之後一直保持到動作結束
    gripLocalOffset: null
  },
  Attack2: {
    rampIn: [1.14, 1.20],     // 原動作 → 下劈軌跡的漸入；之後一路保持到動作結束（落在斜下方，與待機姿勢接近）
    rampOut: null,
    refTime: 1.30,            // 手臂／手／劍「扭轉」的參考幀：原動作這一幀手臂前伸、握劍姿勢自然
    /* 右臂方向（肩→手）曲線：[時間, 仰角°, 側偏°]。仰角相對水平（+上／−下），側偏相對身體面向（+向角色右）。
       以「劍尖高度」設計（劍沿手臂成一直線，劍尖高 ≈ 肩高 1.35 + 1.7 × sin(仰角)）：
         起手 +24° → 劍尖約 1.95 m（高舉到頭上不遠）
         +5° → 約 1.5 m（敵人肩高）、−9° → 約 1.1 m（敵人腰高）：劈中的這一道「肩部斜向腰部」
         收招 −28° → 約 0.5 m（膝腰之間，與待機姿勢接近），不劈到地面。
       由左往右帶一點側偏（−32° → +10°）。
       使用者回報：+55° 起手的版本劍尖超過 2.5 m、像在砍空中單位；−46° 收招劍尖貼地。 */
    chop: [[1.20, 24, -32], [1.24, 17, -24], [1.28, 5, -14], [1.32, -9, -4], [1.36, -20, 4], [1.40, -26, 9], [1.46, -28, 10]]
  }
};

/* ---- GLB ---- */
function readGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('不是 GLB：' + file);
  const jl = buf.readUInt32LE(12);
  const json = JSON.parse(buf.slice(20, 20 + jl).toString('utf8'));
  const binStart = 20 + jl + 8;
  return { buf, json, binStart };
}
function accessorInfo(g, idx) {
  const a = g.json.accessors[idx], bv = g.json.bufferViews[a.bufferView];
  const comp = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
  return { count: a.count, comp, offset: g.binStart + (bv.byteOffset || 0) + (a.byteOffset || 0) };
}
function readFloats(g, idx) {
  const { count, comp, offset } = accessorInfo(g, idx);
  const out = new Float32Array(count * comp);
  for (let i = 0; i < out.length; i++) out[i] = g.buf.readFloatLE(offset + i * 4);
  return out;
}

/* ---- 骨架與動畫取樣 ---- */
function buildRig(g) {
  const nodes = g.json.nodes, parent = {};
  nodes.forEach((n, i) => (n.children || []).forEach((c) => { parent[c] = i; }));
  const byName = {};
  nodes.forEach((n, i) => { byName[n.name] = i; });
  const rest = nodes.map((n) => ({
    t: new Vector3(...(n.translation || [0, 0, 0])),
    q: new Quaternion(...(n.rotation || [0, 0, 0, 1])),
    s: new Vector3(...(n.scale || [1, 1, 1]))
  }));
  return { nodes, parent, byName, rest };
}
function readClip(g, rig, name) {
  const clip = g.json.animations.find((a) => a.name === name);
  if (!clip) throw new Error('找不到動作 ' + name);
  const tracks = {};   // nodeName.path → { times, values, comp, out }
  for (const ch of clip.channels) {
    const s = clip.samplers[ch.sampler];
    const key = rig.nodes[ch.target.node].name + '.' + ch.target.path;
    tracks[key] = {
      times: readFloats(g, s.input), values: readFloats(g, s.output),
      comp: ch.target.path === 'rotation' ? 4 : 3, out: accessorInfo(g, s.output)
    };
  }
  /* 時間基準：關鍵幀最多的那條旋轉軌（Attack1 的劍相對手固定，Sword 的旋轉軌只有頭尾 2 格，不能拿來當基準） */
  const keyTimes = Object.entries(tracks).filter(([k]) => k.endsWith('.rotation'))
    .map(([, v]) => v.times).sort((a, b) => b.length - a.length)[0];
  return { name, tracks, keyTimes, duration: keyTimes[keyTimes.length - 1] };
}
function sampleTrack(tr, t, isQuat, target) {
  const T = tr.times, n = T.length, c = tr.comp;
  let i = 0;
  if (t <= T[0]) i = 0;
  else if (t >= T[n - 1]) i = n - 1;
  else { while (T[i + 1] < t) i++; }
  const j = Math.min(n - 1, i + 1), span = T[j] - T[i], k = span > 1e-9 && t > T[i] ? (t - T[i]) / span : 0;
  if (isQuat) {
    const a = new Quaternion(tr.values[i * 4], tr.values[i * 4 + 1], tr.values[i * 4 + 2], tr.values[i * 4 + 3]);
    const b = new Quaternion(tr.values[j * 4], tr.values[j * 4 + 1], tr.values[j * 4 + 2], tr.values[j * 4 + 3]);
    return target.copy(a).slerp(b, k);
  }
  const a = new Vector3(tr.values[i * 3], tr.values[i * 3 + 1], tr.values[i * 3 + 2]);
  const b = new Vector3(tr.values[j * 3], tr.values[j * 3 + 1], tr.values[j * 3 + 2]);
  return target.copy(a).lerp(b, k);
}
function poseAt(rig, clip, t) {
  const pose = rig.rest.map((r) => ({ t: r.t.clone(), q: r.q.clone(), s: r.s.clone() }));
  for (const [key, tr] of Object.entries(clip.tracks)) {
    const [nm, p] = key.split('.');
    const idx = rig.byName[nm];
    if (p === 'rotation') sampleTrack(tr, t, true, pose[idx].q);
    else if (p === 'translation') sampleTrack(tr, t, false, pose[idx].t);
    else sampleTrack(tr, t, false, pose[idx].s);
  }
  return pose;
}
function worldMatrices(rig, pose) {
  const cache = new Map();
  const get = (i) => {
    if (cache.has(i)) return cache.get(i);
    const m = new Matrix4().compose(pose[i].t, pose[i].q, pose[i].s);
    const p = rig.parent[i];
    if (p !== undefined) m.premultiply(get(p));
    cache.set(i, m);
    return m;
  };
  return get;
}
const wPos = (m) => new Vector3().setFromMatrixPosition(m);
const wRot = (m) => { const q = new Quaternion(); m.decompose(new Vector3(), q, new Vector3()); return q; };
const smooth = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
function weightAt(t, c) {
  let w = 1;
  if (c.rampIn) w *= smooth((t - c.rampIn[0]) / (c.rampIn[1] - c.rampIn[0]));
  if (c.rampOut) w *= 1 - smooth((t - c.rampOut[0]) / (c.rampOut[1] - c.rampOut[0]));
  return w;
}

/* ---- Attack1：副手回到劍上（兩段式 IK） ---- */
function fixAttack1(rig, clip, cfg) {
  const id = (n) => rig.byName[n];
  const SW = id('Sword'), LS = id('LeftShoulder'), LA = id('LeftArm'), LF = id('LeftForeArm'), LH = id('LeftHand');
  // 參考幀：副手手腕相對劍的位置與朝向
  const refPose = poseAt(rig, clip, cfg.refTime), refW = worldMatrices(rig, refPose);
  const swInv = refW(SW).clone().invert();
  const pRef = wPos(refW(LH)).applyMatrix4(swInv);
  const rRef = wRot(refW(SW)).invert().multiply(wRot(refW(LH)));
  const result = {};
  for (let i = 0; i < clip.keyTimes.length; i++) {
    const t = clip.keyTimes[i], w = weightAt(t, cfg);
    if (w <= 0) continue;
    const pose = poseAt(rig, clip, t), W = worldMatrices(rig, pose);
    const S = wPos(W(LA)), E = wPos(W(LF)), Wr = wPos(W(LH));
    const L1 = S.distanceTo(E), L2 = E.distanceTo(Wr);
    const target = pRef.clone().applyMatrix4(W(SW));
    const T = Wr.clone().lerp(target, w);
    // 目標超出手臂長度時夾在可及範圍內
    const dist = S.distanceTo(T), maxD = (L1 + L2) * 0.999, minD = Math.abs(L1 - L2) * 1.001 + 1e-4;
    const d = Math.max(minD, Math.min(maxD, dist));
    const axis = T.clone().sub(S).normalize();
    const Tcl = S.clone().addScaledVector(axis, d);
    // 手肘新位置：沿軸 a、垂直軸 h；彎曲方向沿用原本手肘偏離軸的那一側
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const eo = E.clone().sub(S);
    let pole = eo.sub(axis.clone().multiplyScalar(eo.dot(axis)));
    if (pole.lengthSq() < 1e-8) pole.set(0, 0, -1).sub(axis.clone().multiplyScalar(-axis.z));
    pole.normalize();
    const E2 = S.clone().addScaledVector(axis, a).addScaledVector(pole, h);
    // 上臂：把 S→E 轉到 S→E2
    const laW = wRot(W(LA)), shW = wRot(W(LS));
    const arc1 = new Quaternion().setFromUnitVectors(E.clone().sub(S).normalize(), E2.clone().sub(S).normalize());
    const laW2 = arc1.clone().multiply(laW);
    const laLocal = shW.clone().invert().multiply(laW2).normalize();
    pose[LA].q.copy(laLocal);
    // 前臂：重算 FK 後，把 E→手腕 轉到 E→目標
    const W1 = worldMatrices(rig, pose);
    const E1 = wPos(W1(LF)), Wr1 = wPos(W1(LH));
    const arc2 = new Quaternion().setFromUnitVectors(Wr1.clone().sub(E1).normalize(), Tcl.clone().sub(E1).normalize());
    const faW2 = arc2.clone().multiply(wRot(W1(LF)));
    const faLocal = laW2.clone().invert().multiply(faW2).normalize();
    // 手：朝向回到握劍的方向（與原朝向依權重混合）
    const handTarget = wRot(W(SW)).multiply(rRef);
    const handW = wRot(W(LH)).slerp(handTarget, w);
    const handLocal = faW2.clone().invert().multiply(handW).normalize();
    result[i] = { LeftArm: laLocal, LeftForeArm: faLocal, LeftHand: handLocal };
  }
  return result;
}

/* ---- Attack2：高舉後由左上往右下斜砍而下 ---- */
function chopAt(keys, t) {
  // Catmull-Rom：曲線平順、經過每個關鍵點；範圍外取端點
  if (t <= keys[0][0]) return [keys[0][1], keys[0][2]];
  if (t >= keys[keys.length - 1][0]) { const k = keys[keys.length - 1]; return [k[1], k[2]]; }
  let i = 0; while (keys[i + 1][0] < t) i++;
  const p0 = keys[Math.max(0, i - 1)], p1 = keys[i], p2 = keys[i + 1], p3 = keys[Math.min(keys.length - 1, i + 2)];
  const u = (t - p1[0]) / (p2[0] - p1[0]);
  const cr = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
  return [cr(p0[1], p1[1], p2[1], p3[1]), cr(p0[2], p1[2], p2[2], p3[2])];
}
function bodyFrame(rig, W) {
  const id = (n) => rig.byName[n];
  const right = wPos(W(id('RightShoulder'))).sub(wPos(W(id('LeftShoulder')))); right.y = 0; right.normalize();
  const fwd = new Vector3().crossVectors(new Vector3(0, 1, 0), right).normalize();
  const hz = new Vector3(0, 0, 1).applyQuaternion(wRot(W(id('Hips')))); hz.y = 0; hz.normalize();   // Hips 局部 +Z＝模型正面，用來定前後方向的正負
  if (fwd.dot(hz) < 0) fwd.negate();
  return { fwd, right, up: new Vector3(0, 1, 0) };
}
/* 瞄準：局部 +Y 指向 dir，局部 +X 取 up × dir（扭轉固定相對於 up，不隨路徑累積） */
function aimQuat(dir, up) {
  const y = dir.clone().normalize();
  const x = new Vector3().crossVectors(up, y);
  if (x.lengthSq() < 1e-8) x.set(1, 0, 0);
  x.normalize();
  const z = new Vector3().crossVectors(x, y).normalize();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}
/* 只留繞局部 Y 軸的扭轉（swing-twist 的 twist 部分）：骨骼沿 Y 軸延伸，去掉彎折後只剩「手掌朝哪面」 */
function twistAboutY(q) {
  const len = Math.hypot(q.y, q.w);
  return len < 1e-9 ? new Quaternion() : new Quaternion(0, q.y / len, 0, q.w / len);
}
function fixAttack2Chop(rig, clip, cfg) {
  const id = (n) => rig.byName[n];
  const SW = id('Sword'), RS = id('RightShoulder'), RA = id('RightArm'), RF = id('RightForeArm'), RH = id('RightHand');
  const UP = new Vector3(0, 1, 0);
  // 參考幀：各段相對「瞄準」的固定偏移（＝原動作那一刻自然的扭轉）、手與劍的繞軸扭轉
  const refPose = poseAt(rig, clip, cfg.refTime), refW = worldMatrices(rig, refPose);
  const rS = wPos(refW(RA)), rE = wPos(refW(RF)), rWr = wPos(refW(RH));
  const offUA = aimQuat(rE.clone().sub(rS), UP).invert().multiply(wRot(refW(RA)));
  const offFA = aimQuat(rWr.clone().sub(rE), UP).invert().multiply(wRot(refW(RF)));
  const handLocal = twistAboutY(refPose[RH].q), swordLocal = twistAboutY(refPose[SW].q);
  const result = {};
  for (let i = 0; i < clip.keyTimes.length; i++) {
    const t = clip.keyTimes[i], w = weightAt(t, cfg);
    if (w <= 0) continue;
    const pose = poseAt(rig, clip, t), W = worldMatrices(rig, pose);
    const fr = bodyFrame(rig, W);
    const S = wPos(W(RA)), E = wPos(W(RF)), Wr = wPos(W(RH));
    const L1 = S.distanceTo(E), L2 = E.distanceTo(Wr), reach = Math.min(S.distanceTo(Wr), (L1 + L2) * 0.995);
    const [pitch, yaw] = chopAt(cfg.chop, t), pr = pitch * Math.PI / 180, yr = yaw * Math.PI / 180;
    const dir = new Vector3().addScaledVector(fr.fwd, Math.cos(pr) * Math.cos(yr)).addScaledVector(fr.right, Math.cos(pr) * Math.sin(yr)).addScaledVector(fr.up, Math.sin(pr)).normalize();
    const T = S.clone().addScaledVector(dir, reach);
    // 兩段式 IK：手肘位置（彎向沿用原本偏離肩→手軸的那一側）
    const a = (L1 * L1 - L2 * L2 + reach * reach) / (2 * reach), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const eo = E.clone().sub(S);
    let pole = eo.sub(dir.clone().multiplyScalar(eo.dot(dir)));
    if (pole.lengthSq() < 1e-8) pole = new Vector3(0, -1, 0).sub(dir.clone().multiplyScalar(-dir.y));
    pole.normalize();
    const E2 = S.clone().addScaledVector(dir, a).addScaledVector(pole, h);
    // 各段朝向＝瞄準 × 參考幀偏移（扭轉固定，不累積）
    const raW = aimQuat(E2.clone().sub(S), UP).multiply(offUA);
    const rfW = aimQuat(T.clone().sub(E2), UP).multiply(offFA);
    const shW = wRot(W(RS));
    const raL = shW.clone().invert().multiply(raW).normalize();
    const rfL = raW.clone().invert().multiply(rfW).normalize();
    // 與原動作依權重混合（漸入）
    const mix = (orig, nw) => orig.clone().slerp(nw, w);
    result[i] = {
      RightArm: mix(pose[RA].q, raL), RightForeArm: mix(pose[RF].q, rfL),
      RightHand: mix(pose[RH].q, handLocal), Sword: mix(pose[SW].q, swordLocal)
    };
  }
  return result;
}

/* ---- 量測 ---- */
function measure(rig, clip, which) {
  const id = (n) => rig.byName[n];
  const rows = [];
  for (let t = 0; t <= clip.duration + 1e-6; t += 0.05) {
    const pose = poseAt(rig, clip, t), W = worldMatrices(rig, pose);
    if (which === 'Attack1') {
      // 劍軸：Sword 骨骼局部 Y 方向，柄端 y=-24.23、劍尖 y=100.18（以劍頂點量得）
      const A = new Vector3(0, -24.23, 0).applyMatrix4(W(id('Sword'))), B = new Vector3(0, 100.18, 0).applyMatrix4(W(id('Sword')));
      const line = new THREE.Line3(A, B), c = new Vector3(), lh = wPos(W(id('LeftHand')));
      const p = line.closestPointToPointParameter(lh, false); line.closestPointToPoint(lh, false, c);
      rows.push([+t.toFixed(2), +c.distanceTo(lh).toFixed(3), +p.toFixed(2)]);
    } else {
      const dir = wPos(W(id('RightHand'))).sub(wPos(W(id('RightForeArm')))).normalize();
      const blade = new Vector3(0, 1, 0).applyQuaternion(wRot(W(id('Sword')))).normalize();
      rows.push([+t.toFixed(2), +(Math.acos(Math.max(-1, Math.min(1, dir.dot(blade)))) * 180 / Math.PI).toFixed(1)]);
    }
  }
  return rows;
}

/* ---- 拿掉錯綁的尖刺三角面 ---- */
const STRAY_EXPECT = 8;                                                 // 這個模型確定是 8 個；不是就中止，避免誤刪
const SWORD_SIDE = new Set(['Sword', 'RightHand', 'RightForeArm']);
const LOWER_BODY = /Leg|Hips|Foot/;
function strayTriangles(g, rig) {
  const prim = g.json.meshes[0].primitives[0];
  const joints = g.json.skins[0].joints.map((n) => g.json.nodes[n].name);
  const ia = accessorInfo(g, prim.indices), ja = accessorInfo(g, prim.attributes.JOINTS_0), wa = accessorInfo(g, prim.attributes.WEIGHTS_0);
  const idx = new Uint16Array(ia.count);
  for (let i = 0; i < ia.count; i++) idx[i] = g.buf.readUInt16LE(ia.offset + i * 2);
  const vertWeights = (v) => {
    let sword = 0, lower = 0;
    for (let k = 0; k < 4; k++) {
      const w = g.buf.readFloatLE(wa.offset + (v * 4 + k) * 4);
      if (w <= 0) continue;
      const name = joints[g.buf[ja.offset + v * 4 + k]];
      if (SWORD_SIDE.has(name)) sword += w; else if (LOWER_BODY.test(name)) lower += w;
    }
    return [sword, lower];
  };
  const stray = [];
  for (let t = 0; t < idx.length / 3; t++) {
    let s = 0, l = 0;
    for (let k = 0; k < 3; k++) { const [a, b] = vertWeights(idx[t * 3 + k]); s += a; l += b; }
    // 三個頂點平均：劍／手的權重 ≥ 0.25，且同時帶有 ≥ 0.05 的腿／髖權重（劍上不該有腿的權重）
    if (s / 3 >= 0.25 && l / 3 >= 0.05) stray.push(t);
  }
  return { prim, idx, ia, stray };
}
function removeStrayTriangles(g, rig) {
  const { prim, idx, ia, stray } = strayTriangles(g, rig);
  if (stray.length === 0) { console.log('網格：沒有錯綁的尖刺三角面（已清理過）'); return 0; }
  if (stray.length !== STRAY_EXPECT) throw new Error('找到 ' + stray.length + ' 個錯綁三角面，預期 ' + STRAY_EXPECT + '：不是這個模型，中止');
  const drop = new Set(stray), kept = [];
  for (let t = 0; t < idx.length / 3; t++) if (!drop.has(t)) kept.push(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]);
  for (let i = 0; i < idx.length; i++) g.buf.writeUInt16LE(i < kept.length ? kept[i] : 0, ia.offset + i * 2);
  // 索引數量就地改（位數相同，JSON 長度不變，不用搬動後面的二進位資料）
  const jl = g.buf.readUInt32LE(12), text = g.buf.slice(20, 20 + jl).toString('utf8');
  const needle = '"count":' + ia.count, repl = '"count":' + kept.length;
  const re = new RegExp('"componentType":5123,' + needle + ',', 'g');
  if ((text.match(re) || []).length !== 1 || String(kept.length).length !== String(ia.count).length)
    throw new Error('索引數量在 JSON 裡找不到唯一位置，或位數改變，中止');
  g.buf.write(text.replace(re, '"componentType":5123,' + repl + ','), 20, 'utf8');
  console.log('網格：拿掉 ' + stray.length + ' 個錯綁的尖刺三角面（索引 ' + ia.count + ' → ' + kept.length + '）');
  return stray.length;
}

/* ---- 披風下擺：細絲（下擺頂點整個綁在腿上，跨步時被拉成細絲）---- */
const HEM_FULL = 0.30, HEM_TOP = 0.60;      // y<0.30 全跟髖部；0.30~0.60 平順過渡到原權重
function fixCapeHem(g, rig) {
  const data = JSON.parse(fs.readFileSync(path.join(here, 'data/sunbrand-cape-hem.json'), 'utf8'));
  const prim = g.json.meshes[0].primitives[0];
  const joints = g.json.skins[0].joints.map((n) => g.json.nodes[n].name);
  const pa = accessorInfo(g, prim.attributes.POSITION), ja = accessorInfo(g, prim.attributes.JOINTS_0), wa = accessorInfo(g, prim.attributes.WEIGHTS_0);
  if (pa.count !== data.vertexCount) throw new Error('頂點數 ' + pa.count + ' 與清單 ' + data.vertexCount + ' 不符：不是這個模型，中止');
  const hips = joints.indexOf('Hips');
  const slot = (v, k) => ({ j: g.buf[ja.offset + v * 4 + k], w: g.buf.readFloatLE(wa.offset + (v * 4 + k) * 4) });
  const legW = (v) => { let t = 0; for (let k = 0; k < 4; k++) { const { j, w } = slot(v, k); if (w > 0 && /Leg|Foot/.test(joints[j])) t += w; } return t; };
  // 已經處理過：y<0.3 的下擺頂點不該還有腿的權重
  const low = data.groups.map((m) => m[0]).filter((v) => g.buf.readFloatLE(pa.offset + (v * 3 + 1) * 4) < HEM_FULL);
  if (low.every((v) => legW(v) === 0)) { console.log('披風下擺：已經處理過'); return 0; }
  let changed = 0;
  for (const mem of data.groups) {
    const f = mem[0], y = g.buf.readFloatLE(pa.offset + (f * 3 + 1) * 4);
    if (y >= HEM_TOP) continue;
    const t = Math.max(0, Math.min(1, (y - HEM_FULL) / (HEM_TOP - HEM_FULL))), s = t * t * (3 - 2 * t);   // 0 全髖部、1 原權重
    const m = new Map([[hips, 1 - s]]);
    for (let k = 0; k < 4; k++) { const { j, w } = slot(f, k); if (w > 0) m.set(j, (m.get(j) || 0) + w * s); }
    const use = [...m.entries()].filter((x) => x[1] > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const tot = use.reduce((a, x) => a + x[1], 0);
    for (const v of mem) for (let k = 0; k < 4; k++) {
      g.buf[ja.offset + v * 4 + k] = k < use.length ? use[k][0] : 0;
      g.buf.writeFloatLE(k < use.length ? use[k][1] / tot : 0, wa.offset + (v * 4 + k) * 4);
    }
    changed += mem.length;
  }
  console.log('披風下擺：重新配權重 ' + changed + ' 個頂點（' + data.groups.length + ' 組）');
  return changed;
}
function capeHemLegWeight(g) {
  const data = JSON.parse(fs.readFileSync(path.join(here, 'data/sunbrand-cape-hem.json'), 'utf8'));
  const prim = g.json.meshes[0].primitives[0];
  const joints = g.json.skins[0].joints.map((n) => g.json.nodes[n].name);
  const pa = accessorInfo(g, prim.attributes.POSITION), ja = accessorInfo(g, prim.attributes.JOINTS_0), wa = accessorInfo(g, prim.attributes.WEIGHTS_0);
  let worst = 0;
  for (const mem of data.groups) for (const v of mem) {
    if (g.buf.readFloatLE(pa.offset + (v * 3 + 1) * 4) >= HEM_FULL) continue;
    let t = 0;
    for (let k = 0; k < 4; k++) { const w = g.buf.readFloatLE(wa.offset + (v * 4 + k) * 4); if (w > 0 && /Leg|Foot/.test(joints[g.buf[ja.offset + v * 4 + k]])) t += w; }
    worst = Math.max(worst, t);
  }
  return worst;
}

/* ---- 寫回 ---- */
function writeQuats(g, clip, nodeName, edits) {
  const tr = clip.tracks[nodeName + '.rotation'];
  const { offset, count } = tr.out;
  const prev = (i) => new Quaternion(tr.values[i * 4], tr.values[i * 4 + 1], tr.values[i * 4 + 2], tr.values[i * 4 + 3]);
  const keys = Object.keys(edits).map(Number).sort((a, b) => a - b);
  let last = null;
  for (const i of keys) {
    const q = edits[i].clone().normalize();
    const ref = last || (i > 0 ? prev(i - 1) : prev(i));
    if (q.dot(ref) < 0) { q.x = -q.x; q.y = -q.y; q.z = -q.z; q.w = -q.w; }   // 同一個旋轉的兩種寫法，取與前一格同側的，避免插值繞遠路
    [q.x, q.y, q.z, q.w].forEach((v, k) => g.buf.writeFloatLE(v, offset + (i * 4 + k) * 4));
    tr.values.set([q.x, q.y, q.z, q.w], i * 4);
    last = q;
  }
  // 與下一個沒被修到的幀也要同側
  const lastKey = keys[keys.length - 1];
  if (lastKey !== undefined && lastKey + 1 < count) {
    const q = prev(lastKey + 1), ref = prev(lastKey);
    if (q.dot(ref) < 0) {
      [-q.x, -q.y, -q.z, -q.w].forEach((v, k) => g.buf.writeFloatLE(v, offset + ((lastKey + 1) * 4 + k) * 4));
    }
  }
}

/* ---- 驗證（給測試用）：量測某個 GLB 現在的握劍狀況 ---- */
export function verifyGrips(file) {
  const g = readGlb(file), rig = buildRig(g);
  const m1 = measure(rig, readClip(g, rig, 'Attack1'), 'Attack1').filter((r) => r[0] >= 1.0 && r[0] <= 1.5);
  const m2 = measure(rig, readClip(g, rig, 'Attack2'), 'Attack2').filter((r) => r[0] >= 1.25 && r[0] <= 1.40);
  return {
    capeHemMaxLegWeight: capeHemLegWeight(g),                           // 披風下擺最末端頂點的腿權重（應為 0）
    strayTriangles: strayTriangles(g, rig).stray.length,                // 錯綁的尖刺三角面數（應為 0）
    attack1OffHandMaxDist: Math.max(...m1.map((r) => r[1])),          // 劈下去那段副手離劍軸最遠多少
    attack2BladeMaxAngleDeg: Math.max(...m2.map((r) => r[1]))         // 劍與前臂方向的夾角最大多少
  };
}

/* ---- 主程式 ---- */
function main() {
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const [inFile, outFile] = args.filter((a) => !a.startsWith('--'));
if (!inFile || (!outFile && !checkOnly)) {
  console.error('用法：node fix-grips.mjs <輸入.glb> <輸出.glb> [--check]');
  process.exit(2);
}
const g = readGlb(inFile), rig = buildRig(g);
const a1 = readClip(g, rig, 'Attack1'), a2 = readClip(g, rig, 'Attack2');
const before1 = measure(rig, a1, 'Attack1'), before2 = measure(rig, a2, 'Attack2');
const e1 = fixAttack1(rig, a1, CFG.Attack1), e2 = fixAttack2Chop(rig, a2, CFG.Attack2);
const regroup = (edits) => {
  const by = {};
  for (const [i, o] of Object.entries(edits)) for (const [nm, q] of Object.entries(o)) (by[nm] ||= {})[i] = q;
  return by;
};
if (!checkOnly) {
  for (const [nm, ed] of Object.entries(regroup(e1))) writeQuats(g, a1, nm, ed);
  for (const [nm, ed] of Object.entries(regroup(e2))) writeQuats(g, a2, nm, ed);
  removeStrayTriangles(g, rig);
  fixCapeHem(g, rig);
  fs.writeFileSync(outFile, g.buf);
}
// 重新讀檔量測修正後（--check 時以記憶體中的結果量測不到，直接說明）
let after1 = null, after2 = null;
if (!checkOnly) {
  const g2 = readGlb(outFile), rig2 = buildRig(g2);
  after1 = measure(rig2, readClip(g2, rig2, 'Attack1'), 'Attack1');
  after2 = measure(rig2, readClip(g2, rig2, 'Attack2'), 'Attack2');
}
const fmt = (b, a, label, unit) => {
  console.log(label);
  b.forEach((r, i) => console.log('  t=' + r[0].toFixed(2) + '  修正前 ' + r.slice(1).join(' / ') + (a ? '   修正後 ' + a[i].slice(1).join(' / ') : '')));
  if (unit) console.log('  ' + unit);
};
fmt(before1, after1, 'Attack1 副手：離劍軸距離 / 沿劍位置（0 柄端 → 1 劍尖）', '目標：距離接近 0.1、位置約 0.2');
fmt(before2, after2, 'Attack2 劍身與前臂方向夾角（度）', '目標：1.25～1.45 附近接近 0');
console.log(checkOnly ? '（--check：未寫檔）' : '已寫出 ' + outFile);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
