#!/usr/bin/env node
/* 修正黃金騎士兩個攻擊動作裡「手沒有握在劍上」的問題（直接改 GLB 內烘焙好的動畫關鍵幀，不需要 Blender）。

   問題（使用者 2026-10-27 在遊戲內測回報）：
     Attack1（雙手直劈）：舉劍時兩手都握劍，但劈下去那一刻副手鬆開、握拳甩到旁邊，劈完才回到劍上。
     Attack2：右臂前伸的那幾幀，劍和前臂不成一直線，握劍方向很怪。

   做法：
     Attack1：以「副手握得最好的那一幀」為準，記下副手手腕相對劍的位置與朝向；之後每一幀把副手的目標放在劍上同一個位置，
              用兩段式 IK（上臂＋前臂，保留原本手肘彎曲的方向）重新解出 LeftArm／LeftForeArm，再把 LeftHand 轉回握劍的朝向。
     Attack2：重新設計斜劈那一段（t≈1.14～）右臂的軌跡：高舉在左上 → 橫跨身體前方由左上掃到右下（從背後看的斜線），
              劍沿手臂成一直線，停在右下。原動作在 t=1.24～1.30 手臂近乎水平（劍停在頭部高度＝平砍），之後往下再往後拉。
              用兩段式 IK 解右臂，手臂方向用身體座標系的（前、右、上）路徑（path／sKeys）給定。
              手臂各段的「扭轉」用瞄準＋參考幀的固定偏移決定（不累積），手與劍相對前臂只保留繞軸的自然握法、沒有手腕彎折，
              所以手掌順著手臂延伸的朝向，不會像只做最小旋轉那樣把手掌轉好幾圈。
   兩者都用權重 0～1 漸入漸出，沒被修到的幀與原動作逐位元相同。

   關節限制：Meshy 的原動作右手腕扭轉最大 158°（Attack1）、176°（Attack2）、180°（Death），遠超人體手腕（左右約 90°，
   多數時候不需要轉）。人的前臂和手腕合起來才轉得出這麼大的角度，但這副骨架把扭轉全塞在手腕上、前臂只用了 20～40°。
   所以把超過手腕上限（WRIST_MAX）的扭轉搬到前臂（上限 FOREARM_MAX）：手的最終朝向、劍的方向都不變，只是改由前臂來轉。

   盔甲必須是剛性的：整套盔甲是硬質的，不該有任何形變；能變形的只有披風和腰前的布襠，而且只能小幅伸縮。
   Meshy 的權重是柔性的（一個頂點同時受好幾根骨骼影響），骨骼一轉，盔甲就被拉扯、壓扁（前臂護甲被壓成一片楔形）。
   做法：不屬於布料的頂點，如果它自己和所有相鄰頂點都以同一根骨骼為主，就改成 100% 綁那根骨骼（完全剛性）；
   只有不同骨骼的交界那一圈保留原權重（盔甲連成一整片，整塊綁死會在關節處撕成長條）。布料頂點清單在 images/models/hero3d/sunbrand-cloth.json（遊戲播放時的披風碰撞也用同一份）。
   披風下擺的細絲：下擺最末端的頂點整個綁在腿骨骼上，跨步時三角面被拉成一根根細絲。不重新綁權重（那樣披風會黏在腿上），
   而是逐幀量測所有動作裡披風三角面被拉長的倍數，只刪除被拉成細絲（超過 STRETCH_MAX 倍）的那幾個。

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
    /* 右臂方向（肩→手；劍沿手臂成一直線）：使用者畫的示意圖（從人物背後看，2026-10-27）——
         高舉：手臂舉在身體左上方，劍沿手臂往左上斜 45°（不是垂直向上、也不是往前）
         斜砍：由左上到右下的一道斜線（橫跨身體前方），劍最後指向右下 45°；劍尖軌跡從左上拱過去再落到右下
       所以是「左右＋上下」平面上的斜線，不是往前往下的垂直劈（前幾版的錯誤理解）。
       用身體座標系的三個分量（前、右、上）描述方向，路徑參數 s：0＝高舉（左上）、1＝收在右下；
         右分量 −0.58 → +0.58、上分量 +0.58 → −0.58（直線），中間再加一點往上的拱（bulge，對應示意圖的弧），
         前分量 0.45 並在中段多一點（劍要伸到身體前方才砍得到敵人）。
       s(t) 前慢後快（揮劍加速）。 */
    path: { r0: -0.58, r1: 0.58, u0: 0.58, u1: -0.58, bulge: 0.30, f0: 0.45, fbulge: 0.20 },
    sKeys: [[1.20, 0], [1.24, 0], [1.27, 0.10], [1.30, 0.28], [1.33, 0.52], [1.36, 0.76], [1.39, 0.92], [1.42, 1], [1.46, 1]],
    /* 收招：使用者要求最後一幀回到第一幀的動作（動作首尾相接，不要停在斜劈結束的姿勢多放幾幀）。
       從 recover[0] 到 recover[1]，全身所有骨骼（旋轉、位移）平順過渡回 startTime 那一幀的姿勢（smoothstep），之後保持。
       startTime 要和 hero3d.js 的 CLIP_FOR.attack2.start 一致；recover[1] 要和 CLIP_FOR.attack2.end 一致。 */
    recover: [1.46, 1.70],
    startTime: 0.37
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
  const comp = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
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
function sAt(keys, t) {
  // Catmull-Rom（經過每個關鍵點、平順），範圍外取端點，夾在 [0,1]
  let v;
  if (t <= keys[0][0]) v = keys[0][1];
  else if (t >= keys[keys.length - 1][0]) v = keys[keys.length - 1][1];
  else {
    let i = 0; while (keys[i + 1][0] < t) i++;
    const p0 = keys[Math.max(0, i - 1)][1], p1 = keys[i][1], p2 = keys[i + 1][1], p3 = keys[Math.min(keys.length - 1, i + 2)][1];
    const u = (t - keys[i][0]) / (keys[i + 1][0] - keys[i][0]);
    v = 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
  }
  return Math.max(0, Math.min(1, v));
}
/* 路徑參數 s → 身體座標系的方向分量（前、右、上），未正規化 */
function pathDir(path, s) {
  const bulge = Math.sin(Math.PI * s);
  return {
    f: path.f0 + path.fbulge * bulge,
    r: path.r0 + (path.r1 - path.r0) * s,
    u: path.u0 + (path.u1 - path.u0) * s + path.bulge * bulge
  };
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
  // 劍：局部 Y＝劍身方向、局部 X＝刃口方向（兩側開刃）、局部 Z＝劍面法線（量自劍網格）。手與劍在參考幀的相對關係照舊
  const swordRefW = wRot(refW(SW)), handOff = swordRefW.clone().invert().multiply(wRot(refW(RH)));
  const swordLocal = refPose[SW].q.clone();
  const edgeSign = cfg.edgeSign || 1;
  const result = {};
  for (let i = 0; i < clip.keyTimes.length; i++) {
    const t = clip.keyTimes[i], w = weightAt(t, cfg);
    if (w <= 0) continue;
    const pose = poseAt(rig, clip, t), W = worldMatrices(rig, pose);
    const fr = bodyFrame(rig, W);
    const S = wPos(W(RA)), E = wPos(W(RF)), Wr = wPos(W(RH));
    const L1 = S.distanceTo(E), L2 = E.distanceTo(Wr), reach = Math.min(S.distanceTo(Wr), (L1 + L2) * 0.995);
    const pd = pathDir(cfg.path, sAt(cfg.sKeys, t));
    const dir = new Vector3().addScaledVector(fr.fwd, pd.f).addScaledVector(fr.right, pd.r).addScaledVector(fr.up, pd.u).normalize();
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
    // 刀刃永遠朝揮砍前進的方向：局部 X（刃口）＝路徑切線垂直於劍身的分量，劍面法線因此垂直於砍向、不會用刀背去拍
    const sv = sAt(cfg.sKeys, t), bulgeD = Math.PI * Math.cos(Math.PI * sv), P = cfg.path;
    const tan = new Vector3().addScaledVector(fr.fwd, P.fbulge * bulgeD).addScaledVector(fr.right, P.r1 - P.r0).addScaledVector(fr.up, P.u1 - P.u0 + P.bulge * bulgeD);
    const bl = T.clone().sub(E2).normalize();
    const ex = tan.sub(bl.clone().multiplyScalar(tan.dot(bl))).normalize().multiplyScalar(edgeSign);
    const ez = new Vector3().crossVectors(ex, bl).normalize();
    const swordW = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(ex, bl, ez));
    const handW = swordW.clone().multiply(handOff);
    const handLocal = rfW.clone().invert().multiply(handW).normalize();
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

/* ---- 收招：全身平順回到起始姿勢（讓動作首尾相接） ---- */
function recoverToStart(g, rig, clip, cfg) {
  if (!cfg.recover) return;
  const [t0, t1] = cfg.recover;
  // 起始姿勢：所有骨骼在 startTime 的局部旋轉與位移
  const startPose = poseAt(rig, clip, cfg.startTime);
  const edits = {};
  for (const [key, tr] of Object.entries(clip.tracks)) {
    const [nm, p] = key.split('.');
    if (p === 'scale' || tr.times.length !== clip.keyTimes.length) continue;      // 常數軌（2 個關鍵幀）不用動
    const idx = rig.byName[nm];
    for (let i = 0; i < clip.keyTimes.length; i++) {
      const t = clip.keyTimes[i];
      if (t < t0) continue;
      const sm = smooth((t - t0) / (t1 - t0));
      if (p === 'rotation') {
        const cur = new Quaternion(tr.values[i * 4], tr.values[i * 4 + 1], tr.values[i * 4 + 2], tr.values[i * 4 + 3]);
        (edits[key] ||= {})[i] = cur.slerp(startPose[idx].q, sm);
      } else {
        const cur = new Vector3(tr.values[i * 3], tr.values[i * 3 + 1], tr.values[i * 3 + 2]);
        (edits[key] ||= {})[i] = cur.lerp(startPose[idx].t, sm);
      }
    }
  }
  for (const [key, ed] of Object.entries(edits)) {
    const [nm, p] = key.split('.');
    if (p === 'rotation') writeQuats(g, clip, nm, ed); else writeVecs(g, clip, nm, ed);
  }
}
function writeVecs(g, clip, nodeName, edits) {
  const tr = clip.tracks[nodeName + '.translation'];
  for (const [i, v] of Object.entries(edits)) {
    [v.x, v.y, v.z].forEach((x, k) => g.buf.writeFloatLE(x, tr.out.offset + (Number(i) * 3 + k) * 4));
    tr.values.set([v.x, v.y, v.z], Number(i) * 3);
  }
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
  g.json.accessors[prim.indices].count = kept.length;
  console.log('網格：拿掉 ' + stray.length + ' 個錯綁的尖刺三角面（索引 ' + ia.count + ' → ' + kept.length + '）');
  return stray.length;
}

/* ---- 蒙皮與拉伸量測 ---- */
function readSkinData(g) {
  const prim = g.json.meshes[0].primitives[0];
  const skin = g.json.skins[0];
  const joints = skin.joints.map((n) => g.json.nodes[n].name);
  const pa = accessorInfo(g, prim.attributes.POSITION), ja = accessorInfo(g, prim.attributes.JOINTS_0), wa = accessorInfo(g, prim.attributes.WEIGHTS_0), ia = accessorInfo(g, prim.indices);
  const invBind = readFloats(g, skin.inverseBindMatrices);
  const n = pa.count;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) pos[i] = g.buf.readFloatLE(pa.offset + i * 4);
  const jnt = new Uint8Array(n * 4), wgt = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) { jnt[i] = g.buf[ja.offset + i]; wgt[i] = g.buf.readFloatLE(wa.offset + i * 4); }
  const idx = new Uint16Array(ia.count);
  for (let i = 0; i < ia.count; i++) idx[i] = g.buf.readUInt16LE(ia.offset + i * 2);
  return { prim, skin, joints, pa, ja, wa, ia, invBind, n, pos, jnt, wgt, idx };
}
function loadCloth(g, n) {
  const data = JSON.parse(fs.readFileSync(path.join(here, '../../../images/models/hero3d/sunbrand-cloth.json'), 'utf8'));
  if (data.vertexCount !== n) throw new Error('頂點數 ' + n + ' 與布料清單 ' + data.vertexCount + ' 不符：不是這個模型，中止');
  const cloth = new Uint8Array(n);
  for (const grp of data.groups) for (const v of grp) cloth[v] = 1;
  return cloth;
}
/* 位置完全重疊的頂點（貼圖接縫的重複頂點）視為同一個：回傳每個頂點所屬組的代表編號 */
function weldRep(pos, n) {
  const rep = new Int32Array(n), seen = new Map();
  for (let i = 0; i < n; i++) {
    const k = Math.round(pos[i * 3] * 1e4) + ',' + Math.round(pos[i * 3 + 1] * 1e4) + ',' + Math.round(pos[i * 3 + 2] * 1e4);
    if (seen.has(k)) rep[i] = seen.get(k); else { seen.set(k, i); rep[i] = i; }
  }
  return rep;
}
/* 某個姿勢下每個頂點（只算 need 標記的）的蒙皮後位置 */
function skinnedPositions(rig, sd, pose, need) {
  const W = worldMatrices(rig, pose);
  const jm = sd.skin.joints.map((nodeIdx, j) => W(nodeIdx).clone().multiply(new Matrix4().fromArray(sd.invBind, j * 16)));
  const out = new Float32Array(sd.n * 3), v = new Vector3(), a = new Vector3();
  for (let i = 0; i < sd.n; i++) {
    if (!need[i]) continue;
    v.set(sd.pos[i * 3], sd.pos[i * 3 + 1], sd.pos[i * 3 + 2]);
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 4; k++) {
      const w = sd.wgt[i * 4 + k];
      if (w <= 0) continue;
      a.copy(v).applyMatrix4(jm[sd.jnt[i * 4 + k]]);
      x += a.x * w; y += a.y * w; z += a.z * w;
    }
    out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
  }
  return out;
}
const STRETCH_MAX = 4;     // 披風三角面最長邊被拉長超過幾倍就算細絲（布料只准小幅伸縮）
function clothStretch(g, rig, sd, cloth) {
  const need = new Uint8Array(sd.n), tris = [];
  for (let t = 0; t < sd.idx.length / 3; t++) {
    const a = sd.idx[t * 3], b = sd.idx[t * 3 + 1], c = sd.idx[t * 3 + 2];
    if (cloth[a] || cloth[b] || cloth[c]) { tris.push(t); need[a] = need[b] = need[c] = 1; }
  }
  const edgeLen = (P, i, j) => Math.hypot(P[i * 3] - P[j * 3], P[i * 3 + 1] - P[j * 3 + 1], P[i * 3 + 2] - P[j * 3 + 2]);
  const restPose = rig.rest.map((r) => ({ t: r.t.clone(), q: r.q.clone(), s: r.s.clone() }));
  const rest = skinnedPositions(rig, sd, restPose, need);
  const worst = new Float32Array(sd.idx.length / 3);
  for (const name of g.json.animations.map((a) => a.name)) {
    const clip = readClip(g, rig, name);
    for (let t = 0; t <= clip.duration + 1e-6; t += 1 / 12) {
      const P = skinnedPositions(rig, sd, poseAt(rig, clip, t), need);
      for (const tri of tris) {
        const a = sd.idx[tri * 3], b = sd.idx[tri * 3 + 1], c = sd.idx[tri * 3 + 2];
        for (const [i, j] of [[a, b], [b, c], [c, a]]) {
          const r = edgeLen(P, i, j) / (edgeLen(rest, i, j) + 1e-4);
          if (r > worst[tri]) worst[tri] = r;
        }
      }
    }
  }
  return { worst, tris };
}

/* ---- 重寫索引緩衝區（拿掉指定三角形）；索引數量就地改，JSON 長度不變 ---- */
function dropTriangles(g, sd, dropSet) {
  const kept = [];
  for (let t = 0; t < sd.idx.length / 3; t++) if (!dropSet.has(t)) kept.push(sd.idx[t * 3], sd.idx[t * 3 + 1], sd.idx[t * 3 + 2]);
  for (let i = 0; i < sd.idx.length; i++) g.buf.writeUInt16LE(i < kept.length ? kept[i] : 0, sd.ia.offset + i * 2);
  const jl = g.buf.readUInt32LE(12), text = g.buf.slice(20, 20 + jl).toString('utf8');
  const re = new RegExp('"componentType":5123,"count":' + sd.idx.length + ',', 'g');
  if ((text.match(re) || []).length !== 1 || String(kept.length).length !== String(sd.idx.length).length)
    throw new Error('索引數量在 JSON 裡找不到唯一位置，或位數改變，中止');
  g.buf.write(text.replace(re, '"componentType":5123,"count":' + kept.length + ','), 20, 'utf8');
  g.json.accessors[sd.prim.indices].count = kept.length;     // 記憶體裡的 JSON 也要同步，後面的步驟會再讀
  return kept.length;
}

/* ---- 盔甲剛性化：內部頂點 100% 綁單一骨骼，只有骨骼交界那一圈保留原權重 ---- */
function hardenArmor(g, rig) {
  const sd = readSkinData(g), cloth = loadCloth(g, sd.n), rep = weldRep(sd.pos, sd.n);
  // 以「組」為單位：組內各頂點的權重平均，找主要骨骼與其權重
  const members = new Map();
  for (let i = 0; i < sd.n; i++) { const r = rep[i]; (members.get(r) || members.set(r, []).get(r)).push(i); }
  const dom = new Map();     // 組代表 → { bone, w }
  for (const [r, mem] of members) {
    const sum = new Map();
    for (const v of mem) for (let k = 0; k < 4; k++) { const w = sd.wgt[v * 4 + k]; if (w > 0) sum.set(sd.jnt[v * 4 + k], (sum.get(sd.jnt[v * 4 + k]) || 0) + w / mem.length); }
    let best = -1, bw = 0;
    for (const [j, w] of sum) if (w > bw) { best = j; bw = w; }
    dom.set(r, { bone: best, w: bw });
  }
  const neigh = new Map();
  for (let t = 0; t < sd.idx.length / 3; t++) {
    const r = [0, 1, 2].map((k) => rep[sd.idx[t * 3 + k]]);
    for (let k = 0; k < 3; k++) for (const o of [r[(k + 1) % 3], r[(k + 2) % 3]]) if (o !== r[k]) (neigh.get(r[k]) || neigh.set(r[k], new Set()).get(r[k])).add(o);
  }
  const isClothGroup = (r) => members.get(r).some((v) => cloth[v]);
  let changed = 0, boundary = 0, armor = 0;
  for (const [r, mem] of members) {
    if (isClothGroup(r)) continue;
    armor += mem.length;
    const d = dom.get(r);
    let interior = d.w >= 0.5;
    for (const o of neigh.get(r) || []) { if (isClothGroup(o) || dom.get(o).bone !== d.bone) { interior = false; break; } }
    if (!interior) { boundary += mem.length; continue; }
    for (const v of mem) {
      const already = sd.jnt[v * 4] === d.bone && sd.wgt[v * 4] > 0.9999 && sd.wgt[v * 4 + 1] === 0;
      if (already) continue;
      for (let k = 0; k < 4; k++) {
        g.buf[sd.ja.offset + v * 4 + k] = k === 0 ? d.bone : 0;
        g.buf.writeFloatLE(k === 0 ? 1 : 0, sd.wa.offset + (v * 4 + k) * 4);
      }
      changed++;
    }
  }
  console.log('盔甲：' + armor + ' 個頂點中，改成剛性（100% 單一骨骼）' + changed + ' 個，保留原權重的交界 ' + boundary + ' 個');
  return changed;
}
function armorSoftness(g, rig) {
  const sd = readSkinData(g), cloth = loadCloth(g, sd.n);
  let armor = 0, rigid = 0;
  for (let i = 0; i < sd.n; i++) { if (cloth[i]) continue; armor++; if (sd.wgt[i * 4] > 0.9999) rigid++; }
  return rigid / armor;      // 剛性頂點占盔甲頂點的比例
}

/* ---- 披風細絲：刪掉被拉成細絲的布料三角面 ---- */
function removeClothSlivers(g, rig, analyze) {
  const sd = readSkinData(g), cloth = loadCloth(g, sd.n);
  const { worst, tris } = clothStretch(g, rig, sd, cloth);
  if (analyze) {
    const th = [1.5, 2, 3, 4, 6, 10, 30];
    console.log('披風三角面（共 ' + tris.length + ' 個）最長邊被拉長倍數分佈：' + th.map((x) => '>' + x + '倍 ' + tris.filter((t) => worst[t] > x).length + ' 個').join('，'));
  }
  const drop = new Set(tris.filter((t) => worst[t] > STRETCH_MAX));
  if (drop.size === 0) { console.log('披風：沒有被拉成細絲的三角面'); return 0; }
  const left = dropTriangles(g, sd, drop);
  console.log('披風：刪除 ' + drop.size + ' 個被拉長超過 ' + STRETCH_MAX + ' 倍的細絲三角面（索引 ' + sd.idx.length + ' → ' + left + '）');
  return drop.size;
}
function maxClothStretch(g, rig) {
  const sd = readSkinData(g), cloth = loadCloth(g, sd.n);
  const { worst, tris } = clothStretch(g, rig, sd, cloth);
  const kept = new Set(); for (let t = 0; t < sd.idx.length / 3; t++) kept.add(t);
  return Math.max(...tris.map((t) => worst[t]));
}

/* ---- 關節限制：手腕扭轉過量 → 搬到前臂 ---- */
const WRIST_MAX = 60, FOREARM_MAX = 90;      // 度。手腕（骨架上的 Hand）與前臂（相對上臂）繞自己軸的扭轉上限
const twistQuat = (deg) => new Quaternion(0, Math.sin(deg * Math.PI / 360), 0, Math.cos(deg * Math.PI / 360));
function twistDegOf(q) {
  const len = Math.hypot(q.y, q.w);
  return len < 1e-9 ? 0 : 2 * Math.atan2(q.y / len, q.w / len) * 180 / Math.PI;      // (−180, 180]
}
function unwrapSeries(vals) {
  const out = [];
  for (let i = 0; i < vals.length; i++) {
    let v = vals[i];
    if (i > 0) { while (v - out[i - 1] > 180) v -= 360; while (v - out[i - 1] < -180) v += 360; }
    out.push(v);
  }
  return out;
}
const clampTo = (x, m) => Math.max(-m, Math.min(m, x));
function limitWristTwist(g, rig, clip, side) {
  const th = clip.tracks[side + 'Hand.rotation'], tf = clip.tracks[side + 'ForeArm.rotation'];
  if (!th || !tf || th.times.length !== tf.times.length) return 0;
  const n = th.times.length;
  const qh = [], qf = [];
  for (let i = 0; i < n; i++) {
    qh.push(new Quaternion(th.values[i * 4], th.values[i * 4 + 1], th.values[i * 4 + 2], th.values[i * 4 + 3]));
    qf.push(new Quaternion(tf.values[i * 4], tf.values[i * 4 + 1], tf.values[i * 4 + 2], tf.values[i * 4 + 3]));
  }
  const h = unwrapSeries(qh.map(twistDegOf)), f = unwrapSeries(qf.map(twistDegOf));
  const editH = {}, editF = {};
  let moved = 0;
  for (let i = 0; i < n; i++) {
    const excess = h[i] - clampTo(h[i], WRIST_MAX);
    if (Math.abs(excess) < 0.5) continue;
    const absorbed = clampTo(f[i] + excess, FOREARM_MAX) - f[i];       // 前臂還能多轉多少（不超過上限）
    if (Math.abs(absorbed) < 0.5) continue;
    // 前臂多轉 absorbed，手相對前臂就少轉 absorbed：手的世界朝向不變
    editF[i] = qf[i].clone().multiply(twistQuat(absorbed));
    editH[i] = twistQuat(-absorbed).multiply(qh[i]);
    moved++;
  }
  if (moved) { writeQuats(g, clip, side + 'Hand', editH); writeQuats(g, clip, side + 'ForeArm', editF); }
  return moved;
}
function limitWrists(g, rig) {
  let total = 0;
  for (const name of g.json.animations.map((a) => a.name)) {
    const clip = readClip(g, rig, name);
    let m = 0;
    for (const side of ['Right', 'Left']) m += limitWristTwist(g, rig, clip, side);
    if (m) console.log('關節限制：' + name + ' 把 ' + m + ' 個關鍵幀的手腕過量扭轉搬到前臂');
    total += m;
  }
  return total;
}
function wristLimits(g, rig) {
  // 量測：所有動作裡手腕扭轉與前臂扭轉的最大絕對值（連續展開後）
  let w = 0, f = 0;
  for (const name of g.json.animations.map((a) => a.name)) {
    const clip = readClip(g, rig, name);
    for (const side of ['Right', 'Left']) {
      const th = clip.tracks[side + 'Hand.rotation'], tf = clip.tracks[side + 'ForeArm.rotation'];
      const q = (tr, i) => new Quaternion(tr.values[i * 4], tr.values[i * 4 + 1], tr.values[i * 4 + 2], tr.values[i * 4 + 3]);
      const hs = unwrapSeries(Array.from({ length: th.times.length }, (_, i) => twistDegOf(q(th, i))));
      const fs_ = unwrapSeries(Array.from({ length: tf.times.length }, (_, i) => twistDegOf(q(tf, i))));
      w = Math.max(w, ...hs.map(Math.abs)); f = Math.max(f, ...fs_.map(Math.abs));
    }
  }
  return { wrist: w, forearm: f };
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
    attack2LoopMaxDeg: (() => {                                          // Attack2 收招姿勢與起始姿勢全身骨骼旋轉最大差（度）：首尾相接
      const clip = readClip(g, rig, 'Attack2');
      const a = poseAt(rig, clip, CFG.Attack2.startTime), b = poseAt(rig, clip, CFG.Attack2.recover[1]);
      return Math.max(...rig.nodes.map((_, i) => 2 * Math.acos(Math.min(1, Math.abs(a[i].q.dot(b[i].q)))) * 180 / Math.PI));
    })(),
    maxWristTwistDeg: wristLimits(g, rig).wrist,                         // 所有動作裡手腕扭轉最大值（度）
    maxForearmTwistDeg: wristLimits(g, rig).forearm,                     // 前臂（相對上臂）扭轉最大值（度）
    armorRigidRatio: armorSoftness(g, rig),                              // 盔甲頂點中完全剛性（100% 單一骨骼）的比例
    maxClothStretch: maxClothStretch(g, rig),                            // 披風三角面最長邊被拉長的最大倍數
    strayTriangles: strayTriangles(g, rig).stray.length,                // 錯綁的尖刺三角面數（應為 0）
    attack1OffHandMaxDist: Math.max(...m1.map((r) => r[1])),          // 劈下去那段副手離劍軸最遠多少
    attack2BladeMaxAngleDeg: Math.max(...m2.map((r) => r[1]))         // 劍與前臂方向的夾角最大多少
  };
}

/* ---- 主程式 ---- */
function main() {
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const analyze = args.includes('--analyze');
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
  recoverToStart(g, rig, a2, CFG.Attack2);
  limitWrists(g, rig);
  removeStrayTriangles(g, rig);
  hardenArmor(g, rig);
  removeClothSlivers(g, rig, analyze);
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
