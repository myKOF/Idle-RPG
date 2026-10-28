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
    gripLocalOffset: null,
    /* 改用使用者在 Meshy 網頁重新綁骨架後套的動作庫動作 Sword Judgment（右手單手劍：小跳躍→轉一圈→斜砍），不改動作本身（不做 IK、不限手腕）：
       取樣檔 data/meshy-sword-judgment.json（來源 0.3～1.25 秒＝小跳、轉圈、斜砍到落地，後面的長時間跪姿不取；重新瞄準到遊戲骨架）放在 Attack1 的 0.10 秒起，收招 recover 回到起始姿勢，
       只動劍：Sword 旋轉設成模型原本的握法（fitSwordGrip），劍跟著手走，動作、骨骼、網格權重都不動。上面 refTime／rampIn 是舊的副手 IK，retarget 有值時不用。 */
    retarget: { name: 'judgment', file: 'meshy-sword-judgment.json', at: 0.10, recover: [0.90, 1.40], startTime: 0.10,
                /* 繞劍身軸翻轉（拳頭＋劍一起，刀刃指的方向不變）：掃 0～150° 找「劍尖移動方向落在劍面上的比例」最低的角度——用刃口砍而不是用劍面／刀背拍。
                   原本（0°）比例 0.83～0.94＝幾乎都在用劍面拍；90° 只降到 0.33～0.53；Attack1 最佳約 70°（0.11）、Attack2／3 約 62°（0.08～0.2）。 */
                gripRoll: 70 }
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
    path: { r0: -0.35, r1: 0.30, u0: 0.30, u1: -0.62, bulge: 0.05, f0: 1.0, fbulge: 0.15 },
    sKeys: [[1.20,0],[1.24,0],[1.28,0.10],[1.32,0.30],[1.36,0.55],[1.40,0.78],[1.44,0.93],[1.48,1],[1.52,1]],
    /* 收招：使用者要求最後一幀回到第一幀的動作（動作首尾相接，不要停在斜劈結束的姿勢多放幾幀）。
       從 recover[0] 到 recover[1]，全身所有骨骼（旋轉、位移）平順過渡回 startTime 那一幀的姿勢（smoothstep），之後保持。
       startTime 要和 hero3d.js 的 CLIP_FOR.attack2.start 一致；recover[1] 要和 CLIP_FOR.attack2.end 一致。 */
    recover: [1.15, 1.65],
    /* 改用 Meshy 動作庫的現成動作（使用者 2026-10-27 決定放棄手調軌跡）：Double Combo Attack（action 92）的第三下——
       右手由右上高舉、斜劈過敵人肩膀到腰下、劍落在左下。取樣檔 data/meshy-double-combo-attack.json（from 1.74～2.82 秒，原地、去掉前進位移），
       放在遊戲動作 Attack2 的 0.37 秒起，收招 recover 回到起始姿勢。上面的 path／sKeys／lunge 是舊的手調軌跡，meshy 有值時不用。 */
    meshy: [
             /* 斜砍（Attack2）：使用者上傳的 Meshy 網頁動作 Left Slash（名稱雖叫 Left，實際是右手在揮，左手護在身前）：
                右下往左上的上撩斜砍，再由左上往右下斜砍回到右下。不改動作本身（不做 IK、不限手腕、不轉落點、不加跨步），
                取來源 0.30～1.55 秒、重新瞄準到遊戲骨架，放在 Attack2 的 0.10 秒起，收招 recover 回到起始姿勢。 */
             { name: 'slash2', retarget: true, file: 'meshy-left-slash.json', at: 0.10 },
             /* 第三個攻擊（Attack3，放在同一條 Attack2 時間軸的 1.74 秒起，hero3d.js 的 CLIP_FOR.attack3）：使用者上傳的 Meshy 網頁動作
                Double Combo Attack（右手）：右上往左下斜砍，再反著揮回原位。不改動作本身；來源 0.10～1.32 秒（整段時間均勻壓縮 1.3 倍＝遊戲 1.72～2.66 秒，
                形狀與各段相對速度不變，遊戲本來就會依攻速縮放播放時間），收招 2.66～3.11 回到起始姿勢——收招必須在整段播完之後才開始，
                不能壓在動作上（否則會把後半段「反著揮回」往起始姿勢拉，與原動作不同）。 */
             { name: 'combo2', retarget: true, file: 'meshy-double-combo-2.json', at: 1.72, speed: 1.3, recover: [2.66, 3.11],
               aim: { deg: -70, ramp: [1.72, 2.05] } }],   // 這招原本邊揮邊往左轉約 45°，砍的方向不在起始朝向的正前方；轉 −70° 後劍穿過正前方 1.5 處敵人的肩到胸（高度 1.03～1.39）
    lunge: { dist: 0.6, hipsK: 0.6, rearK: 0.8, t0: 1.10, t1: 1.34, lift: 0.12 },   // 往前跨一大步劈下：髖部前移 0.36、前腳整步、後腳跟上
    startTime: 0.10,
    gripRoll: 62      // 同 Attack1.retarget.gripRoll 的說明
  },
  /* 倒地：改用使用者在 Meshy 網頁重新綁骨架後套的 Dead 動作（取樣檔 data/meshy-dead.json，來源 0～2.9667 秒，30 fps）。原 Death 動作長 2.75 秒、
     67 個關鍵幀，寫不下 2.967 秒，所以來源時間均勻壓縮 speed 倍（≈1.079）塞進去。不限手腕、不做 IK，動作與骨骼不動；Sword 旋轉設成模型原本的握法（fitSwordGrip），倒下途中劍脫手落地（dropSword）。 */
  Death: { retarget: { name: 'dead', file: 'meshy-dead.json', at: 0, speed: 2.9667 / 2.75 }, swing: { forwardDeg: 20, faceDown: -1, keys: [ { t: 1.6 }, { t: 1.7, pitch: -45 }, { t: 1.8, pitch: -10 }, { t: 1.9, lying: true } ] } }
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


/* ---- Attack2 踏步前進：敵人在一大步外，主角要跨步上前才砍得到 ----
   髖部往身體前方移 hipsK×dist，前腳（起始姿勢較前的那隻）整步 dist（途中抬腳）、後腳跟上 rearK×dist；
   兩腿各用兩段式 IK 接到新的腳位置，腳掌維持原本的世界朝向。收招時由 recoverToStart 把髖與腿平順帶回起始姿勢。 */
function fixLunge(rig, clip, cfg) {
  const L = cfg.lunge;
  if (!L) return { rot: {}, hips: {} };
  const id = (n) => rig.byName[n];
  const HIPS = id('Hips');
  const legs = ['Left', 'Right'].map((sd) => ({ sd, U: id(sd + 'UpLeg'), K: id(sd + 'Leg'), F: id(sd + 'Foot') }));
  const p0 = poseAt(rig, clip, cfg.startTime), W0 = worldMatrices(rig, p0), fr0 = bodyFrame(rig, W0);
  const fw = fr0.fwd, up = new Vector3(0, 1, 0);
  legs.sort((a, b) => wPos(W0(b.F)).dot(fw) - wPos(W0(a.F)).dot(fw));
  const [front, rear] = legs;
  const rot = {}, hips = {};
  for (let i = 0; i < clip.keyTimes.length; i++) {
    const t = clip.keyTimes[i];
    if (t < L.t0) continue;
    const lam = smooth((t - L.t0) / (L.t1 - L.t0)), lamR = smooth((t - L.t0 - 0.04) / (L.t1 - L.t0));
    if (lam <= 0 && t > L.t0) continue;
    if (t > (L.tEnd || cfg.recover[0])) continue;                        // 之後交給 recoverToStart（它從目前的值平順回起始姿勢）
    const pose = poseAt(rig, clip, t), W = worldMatrices(rig, pose);
    const dh = fw.clone().multiplyScalar(L.dist * L.hipsK * lam).addScaledVector(up, -(L.drop || 0) * lam);   // drop：髖部下沉（雙腳不動、膝蓋彎曲＝壓低重心）
    const par = W(rig.parent[HIPS]).clone().invert();
    const o = new Vector3().applyMatrix4(par);
    hips[i] = pose[HIPS].t.clone().add(dh.clone().applyMatrix4(par).sub(o));
    const hipsNew = pose.map((q) => ({ t: q.t.clone(), q: q.q.clone(), s: q.s.clone() }));
    hipsNew[HIPS].t.copy(hips[i]);
    const Wn = worldMatrices(rig, hipsNew);
    rot[i] = {};
    for (const lg of [front, rear]) {
      const isFront = lg === front;
      const stepK = isFront ? lam : lamR * L.rearK;
      const S = wPos(Wn(lg.U)), K0 = wPos(W(lg.K)).add(dh), F0 = wPos(W(lg.F));
      const T = F0.clone().addScaledVector(fw, L.dist * stepK);
      if (isFront) T.addScaledVector(up, L.lift * Math.sin(Math.PI * lam));
      const l1 = S.distanceTo(K0), l2 = K0.distanceTo(wPos(W(lg.F)).add(dh)), reach0 = S.distanceTo(T);
      const reach = Math.min(reach0, (l1 + l2) * 0.998), dir = T.clone().sub(S).normalize();
      const a = (l1 * l1 - l2 * l2 + reach * reach) / (2 * reach), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
      const ko = K0.clone().sub(S); let pole = ko.sub(dir.clone().multiplyScalar(ko.dot(dir)));
      if (pole.lengthSq() < 1e-8) pole = fw.clone();
      pole.normalize();
      const K2 = S.clone().addScaledVector(dir, a).addScaledVector(pole, h);
      const Tcl = S.clone().addScaledVector(dir, reach);
      const swing = (from, to) => new Quaternion().setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
      const uW0 = wRot(W(lg.U)), kW0 = wRot(W(lg.K)), fW0 = wRot(W(lg.F));
      const uW = swing(wPos(W(lg.K)).sub(wPos(W(lg.U))), K2.clone().sub(S)).multiply(uW0);
      const kW = swing(wPos(W(lg.F)).sub(wPos(W(lg.K))), Tcl.clone().sub(K2)).multiply(kW0);
      const hipsW = wRot(Wn(HIPS));
      const uL = hipsW.clone().invert().multiply(uW).normalize();
      const kL = uW.clone().invert().multiply(kW).normalize();
      const fL = kW.clone().invert().multiply(fW0).normalize();
      rot[i][lg.sd + 'UpLeg'] = uL; rot[i][lg.sd + 'Leg'] = kL; rot[i][lg.sd + 'Foot'] = fL;
    }
  }
  return { rot, hips };
}


/* ---- Meshy 網頁綁骨架（Mixamo 範本）的動作 → 遊戲骨架：重新瞄準（retarget） ----
   使用者在 Meshy 網頁上重新綁骨架（Mixamo 範本，骨骼名稱 mixamorig:*，帶手指與披風骨骼）再套動作庫，下載的 GLB 與遊戲骨架（24 根）名稱與層級都不同。
   做法：只用共同的 24 根身體骨骼，以「世界空間旋轉差」搬動作——來源骨骼在動作中的世界旋轉 × 來源靜止姿勢世界旋轉的反矩陣＝世界旋轉差 D，
   遊戲骨骼世界旋轉＝D × 遊戲靜止世界旋轉；四肢再補一個最小的擺動修正，讓「骨骼→子骨骼」的方向與來源完全一致（兩套靜止姿勢的手臂角度略有不同），扭轉保持來源的。
   髖部位移：高度＝遊戲靜止高度＋來源高度變化×尺寸比；水平位移相對片段起點（原地）。
   脊椎名稱順序相反：遊戲的 Spine 是最上面那節、Spine02 最下面（Mixamo 的 Spine 最下、Spine2 最上），所以依層級對應。 */
const RT_BONES = [   // [遊戲骨骼, 來源骨骼]
  ['Hips', 'Hips'], ['Spine02', 'Spine'], ['Spine01', 'Spine1'], ['Spine', 'Spine2'], ['neck', 'Neck'], ['Head', 'Head'],
  ...['Left', 'Right'].flatMap((sd) => [['Shoulder', 'Shoulder'], ['Arm', 'Arm'], ['ForeArm', 'ForeArm'], ['Hand', 'Hand'], ['UpLeg', 'UpLeg'], ['Leg', 'Leg'], ['Foot', 'Foot'], ['ToeBase', 'ToeBase']].map(([a, b]) => [sd + a, sd + b]))
];
const RT_DIR = { LeftArm: 'LeftForeArm', RightArm: 'RightForeArm', LeftForeArm: 'LeftHand', RightForeArm: 'RightHand', LeftUpLeg: 'LeftLeg', RightUpLeg: 'RightLeg', LeftLeg: 'LeftFoot', RightLeg: 'RightFoot' };   // 補擺動修正的骨骼 → 它指向的子骨骼
function restWorld(rig) { return worldMatrices(rig, rig.rest.map((r) => ({ t: r.t.clone(), q: r.q.clone(), s: r.s.clone() }))); }
function extractRetarget(glbFile, clipName, from, to, fps, outFile) {
  const g = readGlb(glbFile), rig = buildRig(g), clip = readClip(g, rig, clipName);
  const sid = (n) => rig.byName['mixamorig:' + n], R = restWorld(rig);
  const n = Math.round((to - from) * fps), rest = {}, rot = {}, dirs = {}, hips = [];
  for (const [, sn] of RT_BONES) { rest[sn] = wRot(R(sid(sn))).toArray(); rot[sn] = []; }
  const restHips = wPos(R(sid('Hips'))).toArray(), handDir = { LeftHand: [], RightHand: [] };
  for (let i = 0; i <= n; i++) {
    const W = worldMatrices(rig, poseAt(rig, clip, from + i / fps));
    for (const [, sn] of RT_BONES) rot[sn].push(wRot(W(sid(sn))).toArray().map((v) => +v.toFixed(6)));
    for (const [a, b] of Object.entries(RT_DIR)) (dirs[a] ||= []).push(wPos(W(sid(b))).sub(wPos(W(sid(a)))).normalize().toArray().map((v) => +v.toFixed(6)));
    hips.push(wPos(W(sid('Hips'))).toArray().map((v) => +v.toFixed(6)));
    for (const sd of ['Left', 'Right']) handDir[sd + 'Hand'].push(wPos(W(sid(sd + 'HandMiddle1'))).sub(wPos(W(sid(sd + 'Hand')))).normalize().toArray().map((v) => +v.toFixed(6)));
  }
  fs.writeFileSync(outFile, JSON.stringify({ format: 2, source: path.basename(glbFile), clip: clipName, from, to, fps, rest, restHips, rot, dirs, hips, handDir }));
  console.log('已取樣（重新瞄準用）', clipName, from + '～' + to, '→', outFile, '（' + (n + 1) + ' 格）');
}
function importRetarget(g, rig, clip, seg) {
  const data = JSON.parse(fs.readFileSync(path.join(here, 'data', seg.file), 'utf8'));
  const n = data.hips.length, len = data.to - data.from, speed = seg.speed || 1;   // speed：來源時間均勻壓縮的倍數
  const interp = (arr, u, kind) => {
    const f = Math.max(0, Math.min(n - 1, u * data.fps)), i = Math.floor(f), j = Math.min(n - 1, i + 1), k = f - i;
    if (kind === 'q') return new Quaternion(...arr[i]).slerp(new Quaternion(...arr[j]), k);
    return new Vector3(...arr[i]).lerp(new Vector3(...arr[j]), k);
  };
  const id = (nm) => rig.byName[nm], R0 = restWorld(rig);
  const rest0 = {};   // 遊戲靜止世界旋轉、關節位置
  for (const [gn] of RT_BONES) rest0[gn] = { q: wRot(R0(id(gn))), p: wPos(R0(id(gn))) };
  const srcName = Object.fromEntries(RT_BONES);
  const keyIdx = [];
  clip.keyTimes.forEach((t, i) => { if (t >= seg.at - 1e-6) keyIdx.push(i); });   // 片段之後到動作結束停在最後一格（不能留舊動作的資料，否則收招混合時在片段結束處跳格）
  const gameHipsH = rest0.Hips.p.y, srcHipsH = data.restHips[1], scale = gameHipsH / srcHipsH;
  const out = {}, hipsEd = {};
  const h0 = interp(data.hips, 0, 'v');
  for (const i of keyIdx) {
    const u = (clip.keyTimes[i] - seg.at) * speed;
    const pose = rig.rest.map((r) => ({ t: r.t.clone(), q: r.q.clone(), s: r.s.clone() }));
    // 髖部位移（世界）→ 髖部父節點區域座標
    const hp = interp(data.hips, u, 'v');
    const target = new Vector3(rest0.Hips.p.x + (hp.x - h0.x) * scale, gameHipsH + (hp.y - data.restHips[1]) * scale, rest0.Hips.p.z + (hp.z - h0.z) * scale);
    const parInv = restWorld(rig)(rig.parent[id('Hips')]).clone().invert();
    pose[id('Hips')].t.copy(target.applyMatrix4(parInv));
    const wantW = (gn) => interp(data.rot[srcName[gn]], u, 'q').multiply(new Quaternion(...data.rest[srcName[gn]]).invert()).multiply(rest0[gn].q);   // D × 遊戲靜止世界旋轉，D＝來源世界旋轉 × 來源靜止世界旋轉⁻¹
    for (const [gn] of RT_BONES) {
      if (!clip.tracks[gn + '.rotation'] || clip.tracks[gn + '.rotation'].times.length !== clip.keyTimes.length) {
        // 這個動作的這根骨骼只有常數軌跡（寫不進逐格的值）：保持原值，它的動作併進下方的脊椎（Spine01）——胸口朝向仍然正確
        const cq = pose[id(gn)].q = poseAt(rig, clip, 0)[id(gn)].q.clone();
        if (gn === 'Spine') pose[id('Spine01')].q.copy(wRot(worldMatrices(rig, pose)(id('Spine02'))).invert().multiply(wantW('Spine').multiply(cq.clone().invert())).normalize());
        continue;
      }
      let Wa = wantW(gn);
      const W = worldMatrices(rig, pose);
      if (gn === 'LeftHand' || gn === 'RightHand') {
        // 手：遊戲手骨骼局部 +Y（指尖方向）對齊來源動作的手方向（Hand→Middle1）：兩套骨架手的靜止朝向不同，只做旋轉差會讓手的絕對朝向和原動作不一樣
        const cand = new Vector3(0, 1, 0).applyQuaternion(Wa), want = interp(data.handDir[gn], u, 'v').normalize();
        Wa = new Quaternion().setFromUnitVectors(cand, want).multiply(Wa);
      }
      if (RT_DIR[gn]) {
        const child = RT_DIR[gn], dRest = rest0[child].p.clone().sub(rest0[gn].p).normalize();
        const cand = dRest.clone().applyQuaternion(rest0[gn].q.clone().invert()).applyQuaternion(Wa);
        const want = interp(data.dirs[gn], u, 'v').normalize();
        Wa = new Quaternion().setFromUnitVectors(cand, want).multiply(Wa);
      }
      const parentW = rig.parent[id(gn)] !== undefined ? wRot(W(rig.parent[id(gn)])) : new Quaternion();
      pose[id(gn)].q.copy(parentW.invert().multiply(Wa).normalize());
    }
    for (const [gn] of RT_BONES) if (clip.tracks[gn + '.rotation'] && clip.tracks[gn + '.rotation'].times.length === clip.keyTimes.length) (out[gn] ||= {})[i] = pose[id(gn)].q.clone();
    hipsEd[i] = pose[id('Hips')].t.clone();
  }
  // 瞄準：這個動作砍的方向偏離起始朝向（Double Combo 邊揮邊往左轉約 45°），敵人在起始朝向的正前方，整個身體（髖部連同腿）繞垂直軸轉 aim.deg，
  // yaw 由 0 在 aim.ramp 內漸入（動作起頭不受影響），收招段由 recoverToStart 帶回起始姿勢
  if (seg.aim && out.Hips) {
    const HIPS = id('Hips'), P = restWorld(rig)(rig.parent[HIPS]), Pr = wRot(P);
    for (const i of keyIdx) {
      const t = clip.keyTimes[i], k = smooth((t - seg.aim.ramp[0]) / (seg.aim.ramp[1] - seg.aim.ramp[0]));
      const yaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), seg.aim.deg * k * Math.PI / 180);
      if (out.Hips[i]) out.Hips[i] = Pr.clone().invert().multiply(yaw).multiply(Pr).multiply(out.Hips[i]);
    }
  }
  for (const [gn, ed] of Object.entries(out)) if (clip.tracks[gn + '.rotation']) writeQuats(g, clip, gn, ed);
  writeVecs(g, clip, 'Hips', hipsEd);
  console.log('匯入（重新瞄準）', seg.name, '：', data.clip, data.from + '～' + data.to, '→ 遊戲動作 t=' + seg.at + '～' + (seg.at + len / speed).toFixed(2), '（' + keyIdx.length + ' 格）');
}


/* ---- 劍的握姿：劍留在拳頭原本的握法裡 ----
   遊戲模型的手是一個固定的拳頭（沒有手指骨骼），劍是獨立的 Sword 骨骼（父骨＝右手），握柄穿過拳頭。拳頭與握柄之間在這片焊接網格裡有幾十個三角面連著，
   劍相對手只要轉離原本的握法（我曾把劍身轉 68° 對準前臂、再繞軸翻轉刀刃），手套就被拉成星形碎片、拳頭與握柄對不上（使用者回報「手部結構怪怪的」）。
   所以只做一件事：每個動作的 Sword 旋轉軌跡都設成模型原本的握法（Sword 靜止局部旋轉），整支劍就跟著手的朝向與揮動走，完全符合模型的握姿。
   舊動作留下的逐格劍旋轉資料（Attack2 原本有，會讓劍在手裡瞬間翻 164°）也一併蓋掉。動作、骨骼、網格權重一個都不動。 */
function fitSwordGrip(g, rig, clip) {
  const q0 = rig.rest[rig.byName.Sword].q.clone(), tr = clip.tracks['Sword.rotation'], ed = {};
  for (let i = 0; i < tr.times.length; i++) ed[i] = q0;
  writeQuats(g, clip, 'Sword', ed);
}


/* 偵察：列出 Mixamo 骨架動作各時間點兩手與髖部的世界位置（相對髖部起點，身體前方＝+z、角色左手＝+x），看哪隻手在揮、怎麼揮 */
function probeRetarget(glbFile, clipName, dt) {
  const g = readGlb(glbFile), rig = buildRig(g), clip = readClip(g, rig, clipName), sid = (n) => rig.byName['mixamorig:' + n];
  console.log(clipName, '長度', clip.duration.toFixed(2), '秒，關鍵幀', clip.keyTimes.length);
  const h0 = wPos(worldMatrices(rig, poseAt(rig, clip, 0))(sid('Hips')));
  for (let t = 0; t <= clip.duration + 1e-6; t += dt) {
    const W = worldMatrices(rig, poseAt(rig, clip, t)), P = (n) => wPos(W(sid(n))).sub(h0).toArray().map((v) => v.toFixed(2)).join(',');
    console.log(t.toFixed(2), 'hips', P('Hips'), '| 左手', P('LeftHand'), '| 右手', P('RightHand'));
  }
}


/* ---- 刀刃順著手的方向（拳頭＋劍當一個整體轉）----
   使用者指出：原動作裡手是沿著手臂方向伸出的，刀刃就該順著這個方向（刀刃＝手臂的延伸）。遊戲模型的拳頭是握著劍的，拳頭握柄軸與指尖方向（手骨骼 +Y）差約 44°，
   所以保持原本握法的話刀刃會偏離手的方向。把右手骨骼的局部旋轉右乘一個固定的校正 C（把劍身軸轉到手骨骼 +Y），拳頭與劍是一起轉的，
   劍與拳頭的相對位置不變（不會像單獨轉劍那樣把手套拉成碎片），刀刃就落在原動作手的方向上。這是兩套模型的手形狀不同所需的固定校正，不是改動作。 */
function alignGripToHand(g, rig, clip, rollDeg = 0) {
  const tr = clip.tracks['RightHand.rotation'];
  if (!tr || tr.times.length !== clip.keyTimes.length) return;
  const b0 = new Vector3(0, 1, 0).applyQuaternion(rig.rest[rig.byName.Sword].q), C = new Quaternion().setFromUnitVectors(b0, new Vector3(0, 1, 0)), ed = {};
  const roll = new Quaternion().setFromAxisAngle(b0.clone().normalize(), rollDeg * Math.PI / 180);   // 繞劍身軸翻轉（拳頭＋劍一起轉，刀刃指的方向不變，只是刃口朝哪邊）
  for (let i = 0; i < tr.times.length; i++) ed[i] = new Quaternion(tr.values[i * 4], tr.values[i * 4 + 1], tr.values[i * 4 + 2], tr.values[i * 4 + 3]).multiply(C).multiply(roll);
  writeQuats(g, clip, 'RightHand', ed);
  console.log(clip.name + ' 握姿校正：拳頭＋劍整體轉 ' + (b0.angleTo(new Vector3(0, 1, 0)) * 180 / Math.PI).toFixed(1) + '° 讓刀刃順著手的方向，再繞劍身軸翻 ' + rollDeg + '° 讓刃口朝砍的方向');
}

/* ---- 倒地：劍隨身體倒下甩出去，最後平放在地上，手握著 ----
   使用者逐幀指定（倒下動作的縮圖上畫箭頭）：1.6 秒以前劍照手的握法垂在身側；1.7 秒劍朝身體前方、斜下 45°；1.8 秒朝前、略向下；1.9 秒起劍平放在地上，
   伸向身體左側往前 20°、劍面朝地、刃口不朝地（之前的箭頭）。遊戲模型的手是固定的拳頭，所以是整隻手（拳頭＋劍）繞手腕轉：每個關鍵時刻決定「劍的世界朝向」，
   中間用球面內插，手腕的局部旋轉由這個朝向反推。1.7、1.8 秒的朝向是在「手原本握法的朝向」上做最小旋轉得到的（繞劍身軸的滾轉仍由手部動作決定）；
   1.6 秒以前不動。手臂與身體的動作一個都不動；不為了閃開身體而轉手腕（使用者：劍的軌跡要由手的動作決定，穿一點可以接受）。 */
function swingSword(g, rig, clip, cfg) {
  const id = (n) => rig.byName[n], tr = clip.tracks['RightHand.rotation'], q0 = rig.rest[id('Sword')].q.clone(), n = tr.times.length;
  const Wend = worldMatrices(rig, poseAt(rig, clip, tr.times[n - 1]));
  const fwd = wPos(Wend(id('Head'))).sub(wPos(Wend(id('Hips')))); fwd.y = 0; fwd.normalize();
  const left = new Vector3(0, 1, 0).cross(fwd), dir = (pitchDeg) => fwd.clone().multiplyScalar(Math.cos(pitchDeg * Math.PI / 180)).addScaledVector(new Vector3(0, 1, 0), Math.sin(pitchDeg * Math.PI / 180)).normalize();   // pitch：水平線以上為正、以下為負
  const th = cfg.forwardDeg * Math.PI / 180, ey = left.clone().multiplyScalar(Math.cos(th)).addScaledVector(fwd, Math.sin(th)).normalize(), ez = new Vector3(0, cfg.faceDown, 0), ex = new Vector3().crossVectors(ey, ez).normalize();
  const lying = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(ex, ey, ez));
  const natural = (t) => { const W = worldMatrices(rig, poseAt(rig, clip, t)); return wRot(W(id('RightHand'))).multiply(q0); };
  const toward = (t, d) => { const N = natural(t), s = new Vector3(0, 1, 0).applyQuaternion(N); return new Quaternion().setFromUnitVectors(s, d).multiply(N); };   // N 做最小旋轉讓劍身指向 d
  const keys = cfg.keys.map((k) => ({ t: k.t, q: k.lying ? lying : (k.pitch === undefined ? natural(k.t) : toward(k.t, dir(k.pitch))) }));
  const ed = {};
  for (let i = 0; i < n; i++) {
    const t = tr.times[i];
    if (t <= keys[0].t) continue;
    let q;
    if (t >= keys[keys.length - 1].t) q = keys[keys.length - 1].q;
    else {
      let j = 0; while (keys[j + 1].t < t) j++;
      const a = (t - keys[j].t) / (keys[j + 1].t - keys[j].t);
      q = (j === 0 ? natural(t) : keys[j].q).clone().slerp(keys[j + 1].q, a);      // 第一段從「手原本的朝向（隨時間變）」接到下一個關鍵朝向
    }
    const par = wRot(worldMatrices(rig, poseAt(rig, clip, t))(rig.parent[id('RightHand')]));
    ed[i] = par.clone().invert().multiply(q).multiply(q0.clone().invert()).normalize();
  }
  writeQuats(g, clip, 'RightHand', ed);
  console.log('倒地：' + cfg.keys.map((k) => k.t + (k.lying ? ' 平放' : k.pitch === undefined ? ' 原樣' : ' 前方' + k.pitch + '°')).join('→'));
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


/* ---- 護手右翼端錯綁在右手上 ----
   劍的護手（橫檔）右邊翼端的 11 個頂點（含貼圖接縫的重複頂點）在 Meshy 的權重裡 100% 綁在右手而不是劍：
   左翼跟著劍、右翼跟著手，劍相對手一轉（Attack1 把劍身對準前臂轉了 68°）護手就一邊歪掉。
   以劍骨骼的局部座標找出來（x 10.5～19、y 7～16、z 0～5.5，劍身軸為 y），全部改綁 100% 劍骨骼。 */
const GUARD_WING_EXPECT = 11;
function fixGuardWing(g, rig) {
  const sd = readSkinData(g), sj = sd.joints.indexOf('Sword'), rh = sd.joints.indexOf('RightHand');
  const inv = new Matrix4().fromArray(sd.invBind, sj * 16), v = new Vector3();
  const hit = [];
  for (let i = 0; i < sd.n; i++) {
    if (!(sd.jnt[i * 4] === rh && sd.wgt[i * 4] > 0.999)) continue;
    v.set(sd.pos[i * 3], sd.pos[i * 3 + 1], sd.pos[i * 3 + 2]).applyMatrix4(inv);
    if (v.x >= 10.5 && v.x <= 19 && v.y >= 7 && v.y <= 16 && v.z >= 0 && v.z <= 5.5) hit.push(i);
  }
  if (hit.length === 0) { console.log('護手：右翼端沒有錯綁頂點（已修過）'); return 0; }
  if (hit.length !== GUARD_WING_EXPECT) throw new Error('護手右翼端找到 ' + hit.length + ' 個錯綁頂點，預期 ' + GUARD_WING_EXPECT + '：不是這個模型，中止');
  for (const i of hit) {
    for (let k = 0; k < 4; k++) { g.buf[sd.ja.offset + i * 4 + k] = k === 0 ? sj : 0; g.buf.writeFloatLE(k === 0 ? 1 : 0, sd.wa.offset + (i * 4 + k) * 4); }
  }
  console.log('護手：右翼端 ' + hit.length + ' 個頂點改綁劍骨骼');
  return hit.length;
}



/* ---- 拉直劍身 ----
   Meshy 原網格的劍身是彎的：以劍骨骼局部座標（y＝劍身軸，柄頭 −24、護手約 0～23、劍尖 100）量，劍身中心線在 y≈55 有約 1.8 單位的錯位（約劍寬的四分之一），
   越往劍尖越偏向一邊（脊線 x：5.2@23、4.9@51、3.1@61、3.3@81、3.7@93）；把劍身軸轉成朝上、並排看不同係數：0.04 時劍尖正好在護手與握柄的同一條軸線上、最直（0.03 略偏，反向更糟）。對所有劍頂點（Sword 骨骼 100%）在 y>BLADE_Y0 的部分做一個只依 y 的剪切 x += BLADE_LEAN×(y−BLADE_Y0)，
   貼圖接縫的重複頂點位置相同、位移也相同，不會裂開；護手與握柄（y≤BLADE_Y0）不動。 */
const BLADE_Y0 = 23, BLADE_LEAN = 0.04;
function straightenBlade(g) {
  const sd = readSkinData(g), sj = sd.joints.indexOf('Sword');
  const inv = new Matrix4().fromArray(sd.invBind, sj * 16), bind = inv.clone().invert(), v = new Vector3();
  let n = 0;
  for (let i = 0; i < sd.n; i++) {
    if (!(sd.jnt[i * 4] === sj && sd.wgt[i * 4] > 0.999)) continue;
    v.set(sd.pos[i * 3], sd.pos[i * 3 + 1], sd.pos[i * 3 + 2]).applyMatrix4(inv);
    if (v.y <= BLADE_Y0) continue;
    v.x += BLADE_LEAN * (v.y - BLADE_Y0);
    v.applyMatrix4(bind);
    [v.x, v.y, v.z].forEach((x, k) => g.buf.writeFloatLE(x, sd.pa.offset + (i * 3 + k) * 4));
    n++;
  }
  console.log('劍身：拉直 ' + n + ' 個頂點（x += ' + BLADE_LEAN + '×(y−' + BLADE_Y0 + ')）');
  return n;
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
const STRETCH_MAX = 25;    // 披風三角面最長邊被拉長超過幾倍才算細絲。4 倍會連「站姿裡仍填著布面」的三角面一起刪，Attack1 舉劍時披風破洞（腿露出來）；25 只刪真正的細絲
function clothStretch(g, rig, sd, cloth) {
  const need = new Uint8Array(sd.n), tris = [];
  for (let t = 0; t < sd.idx.length / 3; t++) {
    const a = sd.idx[t * 3], b = sd.idx[t * 3 + 1], c = sd.idx[t * 3 + 2];
    if (cloth[a] || cloth[b] || cloth[c]) { tris.push(t); need[a] = need[b] = need[c] = 1; }
  }
  const edgeLen = (P, i, j) => Math.hypot(P[i * 3] - P[j * 3], P[i * 3 + 1] - P[j * 3 + 1], P[i * 3 + 2] - P[j * 3 + 2]);
  const restPose = rig.rest.map((r) => ({ t: r.t.clone(), q: r.q.clone(), s: r.s.clone() }));
  const rest = skinnedPositions(rig, sd, restPose, need);
  const worst = new Float32Array(sd.idx.length / 3), longest = new Float32Array(sd.idx.length / 3);
  for (const name of g.json.animations.map((a) => a.name)) {
    const clip = readClip(g, rig, name);
    for (let t = 0; t <= clip.duration + 1e-6; t += 1 / 12) {
      const P = skinnedPositions(rig, sd, poseAt(rig, clip, t), need);
      for (const tri of tris) {
        const a = sd.idx[tri * 3], b = sd.idx[tri * 3 + 1], c = sd.idx[tri * 3 + 2];
        for (const [i, j] of [[a, b], [b, c], [c, a]]) {
          const r = edgeLen(P, i, j) / (edgeLen(rest, i, j) + 1e-4);
          if (r > worst[tri]) worst[tri] = r;
          const L = edgeLen(P, i, j); if (L > longest[tri]) longest[tri] = L;
        }
      }
    }
  }
  return { worst, tris, longest };
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

/* ---- 披風下擺貼著腿的頂點：權重往髖部拉 ----
   被刪的 62 個細絲三角面全都是「髖部頂點接腿骨頂點」：披風髖部高度（y≈0.25）有一圈頂點 100% 綁在腿骨（LeftLeg／RightLeg＋UpLeg）上，腿一動披風就被拉成長條，
   刪掉之後披風出現破洞（Attack1 舉劍、倒地躺平都看得到）。與其刪三角面，不如把這些頂點的權重往髖部拉 cfg.toHips（0＝不動、1＝全給髖部），三角面就不會被扯長，也不用刪。 */
function softenCapeLegs(g, rig, toHips) {
  if (!(toHips > 0)) return 0;
  const sd = readSkinData(g), cloth = loadCloth(g, sd.n), { worst, tris } = clothStretch(g, rig, sd, cloth);
  const hips = sd.joints.indexOf('Hips'), legs = new Set(['LeftLeg', 'RightLeg', 'LeftUpLeg', 'RightUpLeg'].map((n) => sd.joints.indexOf(n)));
  const verts = new Set();
  for (const t of tris) if (worst[t] > STRETCH_MAX) for (let k = 0; k < 3; k++) { const v = sd.idx[t * 3 + k]; if (cloth[v] && legs.has(sd.jnt[v * 4])) verts.add(v); }
  for (const v of verts) {
    const w = new Map();
    for (let k = 0; k < 4; k++) if (sd.wgt[v * 4 + k] > 0) w.set(sd.jnt[v * 4 + k], (w.get(sd.jnt[v * 4 + k]) || 0) + sd.wgt[v * 4 + k] * (1 - toHips));
    w.set(hips, (w.get(hips) || 0) + toHips);
    const use = [...w.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4), tot = use.reduce((q, x) => q + x[1], 0);
    for (let k = 0; k < 4; k++) {
      g.buf[sd.ja.offset + v * 4 + k] = k < use.length ? use[k][0] : 0;
      g.buf.writeFloatLE(k < use.length ? use[k][1] / tot : 0, sd.wa.offset + (v * 4 + k) * 4);
    }
  }
  console.log('披風：' + verts.size + ' 個貼腿頂點權重往髖部拉 ' + toHips);
  return verts.size;
}

/* ---- 披風離身體遠一點 ----
   倒地躺平時披風被手臂護甲頂穿一個洞（金色從披風裡露出來）。披風（背後 z<−0.04 的布料頂點）整片往背後移 inflate 公尺，脖子附近（y 1.35→1.55）漸漸收到 0，領口不裂開。 */
function inflateCape(g, inflate) {
  if (!(inflate > 0)) return 0;
  const sd = readSkinData(g), cloth = loadCloth(g, sd.n); let n = 0;
  for (let i = 0; i < sd.n; i++) {
    if (!cloth[i] || sd.pos[i * 3 + 2] >= -0.04) continue;
    const y = sd.pos[i * 3 + 1], k = 1 - Math.max(0, Math.min(1, (y - 1.35) / 0.2));
    g.buf.writeFloatLE(sd.pos[i * 3 + 2] - inflate * k, sd.pa.offset + (i * 3 + 2) * 4); n++;
  }
  console.log('披風：' + n + ' 個頂點往背後移 ' + inflate + ' 公尺');
  return n;
}

/* ---- 披風細絲：刪掉被拉成細絲的布料三角面 ---- */
function removeClothSlivers(g, rig, analyze) {
  const sd = readSkinData(g), cloth = loadCloth(g, sd.n);
  const { worst, tris, longest } = clothStretch(g, rig, sd, cloth);
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
    if (name === 'Attack1' || name === 'Attack2' || name === 'Death') continue;   // Meshy 網頁動作：不動角色的動作與骨骼（使用者要求只調整劍）
    const clip = readClip(g, rig, name);
    let m = 0;
    for (const side of ['Right', 'Left']) m += limitWristTwist(g, rig, clip, side);
    if (m) console.log('關節限制：' + name + ' 把 ' + m + ' 個關鍵幀的手腕過量扭轉搬到前臂');
    total += m;
  }
  return total;
}
function wristLimits(g, rig, only) {
  // 量測：所有動作裡手腕扭轉與前臂扭轉的最大絕對值（連續展開後）
  let w = 0, f = 0;
  for (const name of g.json.animations.map((a) => a.name)) {
    if (only ? !only.includes(name) : (name === 'Attack1' || name === 'Attack2' || name === 'Death')) continue;
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

/* ---- 劍尖軌跡（除錯／驗證用）：回傳每個時間點劍尖在「人物身體座標」下的位置（以 Hips 為原點，單位＝模型單位），以及身體高度參考 ---- */
export function tipTrack(file, clipName, t0, t1, dt) {
  const g = readGlb(file), rig = buildRig(g), clip = readClip(g, rig, clipName);
  const id = (n) => rig.byName[n], rows = [];
  let ref = null;
  for (let t = t0; t <= t1 + 1e-9; t += dt) {
    const pose = poseAt(rig, clip, t), W = worldMatrices(rig, pose), fr = bodyFrame(rig, W);
    const tip = new Vector3(4.8, 100.18, 1.0).applyMatrix4(W(id('Sword')));
    const hips = wPos(W(id('Hips'))), rel = tip.clone().sub(hips);
    ref = { head: wPos(W(id('Head'))).y - hips.y, shoulder: wPos(W(id('RightShoulder'))).y - hips.y, hips: hips.y };
    rows.push({ t: +t.toFixed(3), fwd: rel.dot(fr.fwd), right: rel.dot(fr.right), up: rel.y, world: tip.toArray(), hips: hips.toArray(), fwdVec: fr.fwd.toArray() });
  }
  return { rows, ref };
}


/* 兩個姿勢的差（度）：看得到的姿勢。手腕限制只重新分配上臂／前臂／手繞骨骼軸的滾動：上臂與前臂的局部與世界旋轉都會變、手與劍的世界旋轉不變，
   所以上臂與前臂不比；手的世界旋轉相對於脊椎頂端（去掉身體整個轉圈的影響）比；其餘骨骼比局部旋轉。 */
const ROLL_SHARED = new Set(['LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm']);
function worldPoseDiffDeg(rig, a, b, localOnly) {
  const Wa = worldMatrices(rig, a), Wb = worldMatrices(rig, b), sp = rig.byName.Spine;
  const ang = (p, q) => 2 * Math.acos(Math.min(1, Math.abs(p.dot(q)))) * 180 / Math.PI;
  let worst = 0;
  for (let i = 0; i < rig.nodes.length; i++) {
    const nm = rig.nodes[i].name;
    if (ROLL_SHARED.has(nm)) continue;
    if (nm === 'LeftHand' || nm === 'RightHand') worst = Math.max(worst, ang(wRot(Wa(sp)).invert().multiply(wRot(Wa(i))), wRot(Wb(sp)).invert().multiply(wRot(Wb(i)))));
    else worst = Math.max(worst, ang(a[i].q, b[i].q));
  }
  return worst;
}

/* 相鄰兩個關鍵幀之間，任一骨骼旋轉變化的最大角度（度）：時間窗內有瞬間跳格（資料接不起來）就會很大 */
function maxKeyStep(g, rig, clipName, t0, t1) {
  const clip = readClip(g, rig, clipName);
  const keys = clip.keyTimes.filter((t) => t >= t0 && t <= t1);
  let worst = 0;
  for (let i = 1; i < keys.length; i++) {
    const a = poseAt(rig, clip, keys[i - 1]), b = poseAt(rig, clip, keys[i]);
    worst = Math.max(worst, worldPoseDiffDeg(rig, a, b));
  }
  return worst;
}


/* 驗證：遊戲動作裡四肢（上臂、前臂、大腿、小腿）方向與來源動作的差異（度），只看片段內「收招還沒開始」的格 */
export function retargetError(file, clipName, seg) {
  const g = readGlb(file), rig = buildRig(g), clip = readClip(g, rig, clipName);
  const data = JSON.parse(fs.readFileSync(path.join(here, 'data', seg.file), 'utf8')), speed = seg.speed || 1, n = data.hips.length;
  const worst = {};
  for (const t of clip.keyTimes) {
    const end = seg.recover ? seg.recover[0] : seg.at + (data.to - data.from) / speed;
    if (t < seg.at || t > end) continue;
    const u = (t - seg.at) * speed, f = Math.max(0, Math.min(n - 1, u * data.fps)), i = Math.floor(f), j = Math.min(n - 1, i + 1), k = f - i;
    const W = worldMatrices(rig, poseAt(rig, clip, t));
    for (const [a, b] of Object.entries(RT_DIR)) {
      const want = new Vector3(...data.dirs[a][i]).lerp(new Vector3(...data.dirs[a][j]), k).normalize();
      if (seg.aim) want.applyQuaternion(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), seg.aim.deg * smooth((t - seg.aim.ramp[0]) / (seg.aim.ramp[1] - seg.aim.ramp[0])) * Math.PI / 180));   // 瞄準偏轉算進去
      const got = wPos(W(rig.byName[b])).sub(wPos(W(rig.byName[a]))).normalize();
      worst[a] = Math.max(worst[a] || 0, got.angleTo(want) * 180 / Math.PI);
    }
  }
  return worst;
}








/* 偵察：某動作某時間，劍身（Sword 骨骼 100% 的頂點）蒙皮後偏離「刀尖到柄」直線的最大距離（模型單位）與劍長——直的劍應接近 0 */
export function swordBend(file, clipName, t) {
  const g = readGlb(file), rig = buildRig(g), clip = readClip(g, rig, clipName), sd = readSkinData(g), sj = sd.joints.indexOf('Sword');
  const need = new Uint8Array(sd.n); const ids = [];
  for (let i = 0; i < sd.n; i++) { if (sd.jnt[i * 4] === sj && sd.wgt[i * 4] > 0.999) { need[i] = 1; ids.push(i); } }
  const P = skinnedPositions(rig, sd, poseAt(rig, clip, t), need);
  const W = worldMatrices(rig, poseAt(rig, clip, t)), axis = new Vector3(0, 1, 0).applyQuaternion(wRot(W(rig.byName.Sword))).normalize(), o = wPos(W(rig.byName.Sword));
  let dev = 0, len = 0; const v = new Vector3();
  for (const i of ids) { v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).sub(o); const along = v.dot(axis); len = Math.max(len, along); }
  return { vertsOnSword: ids.length, bladeLength: +len.toFixed(3), scaleOfSwordBone: new Vector3().setFromMatrixScale(W(rig.byName.Sword)).toArray().map((x) => +x.toFixed(3)), handScale: new Vector3().setFromMatrixScale(W(rig.byName.RightHand)).toArray().map((x) => +x.toFixed(3)) };
}


/* 偵察：靜止姿勢下，遊戲的右手骨骼局部 +Y（指尖方向）、劍身軸、前臂方向（前臂→手）互相的夾角 */
export function handAxes(file) {
  const g = readGlb(file), rig = buildRig(g), W = restWorld(rig), id = (n) => rig.byName[n];
  const hq = wRot(W(id('RightHand'))), sq = wRot(W(id('Sword')));
  const hy = new Vector3(0, 1, 0).applyQuaternion(hq), blade = new Vector3(0, 1, 0).applyQuaternion(sq), fore = wPos(W(id('RightHand'))).sub(wPos(W(id('RightForeArm')))).normalize();
  const deg = (a, b) => +(a.angleTo(b) * 180 / Math.PI).toFixed(1);
  return { handY_vs_forearm: deg(hy, fore), blade_vs_forearm: deg(blade, fore), blade_vs_handY: deg(blade, hy), handY: hy.toArray().map((x) => +x.toFixed(2)), blade: blade.toArray().map((x) => +x.toFixed(2)), fore: fore.toArray().map((x) => +x.toFixed(2)) };
}


/* 驗證：能不能砍到站在正前方的敵人。敵人＝起始朝向正前方 D 處、半徑 0.28、高 0.35～1.6 的圓柱；
   回傳 [t0,t1] 內劍身（握柄上方到劍尖）進入圓柱的格數（每 0.02 秒一格）與進入時的高度範圍。 */
export function hitFrames(file, clipName, tStart, t0, t1, D) {
  const g = readGlb(file), rig = buildRig(g), clip = readClip(g, rig, clipName), id = (n) => rig.byName[n];
  const W0 = worldMatrices(rig, poseAt(rig, clip, tStart));
  const q = wRot(W0(id('Hips'))), f = new Vector3(0, 0, 1).applyQuaternion(q); f.y = 0; f.normalize();
  const hp0 = wPos(W0(id('Hips'))), ex = hp0.x + f.x * D, ez = hp0.z + f.z * D;
  let n = 0, hmin = 9, hmax = -9;
  for (let t = t0; t <= t1 + 1e-9; t += 0.02) {
    const W = worldMatrices(rig, poseAt(rig, clip, t)), sw = W(id('Sword')), a = new Vector3(4.8, 15, 1).applyMatrix4(sw), b = new Vector3(4.8, 100.18, 1).applyMatrix4(sw);
    let hit = null;
    for (let k = 0; k <= 40; k++) { const p = a.clone().lerp(b, k / 40); if (p.y >= 0.35 && p.y <= 1.6 && Math.hypot(p.x - ex, p.z - ez) < 0.28) { hit = hit || { ymin: p.y, ymax: p.y }; hit.ymin = Math.min(hit.ymin, p.y); hit.ymax = Math.max(hit.ymax, p.y); } }
    if (hit) { n++; hmin = Math.min(hmin, hit.ymin); hmax = Math.max(hmax, hit.ymax); }
  }
  return { frames: n, hmin: n ? +hmin.toFixed(2) : null, hmax: n ? +hmax.toFixed(2) : null };
}


/* 驗證：劍身軸（世界）與原動作手方向（取樣檔 handDir：Hand→Middle1）的最大夾角，只看收招開始前的格。刀刃要是手方向的延伸，應為 0。 */
export function bladeVsSourceHand(file, clipName, seg) {
  const g = readGlb(file), rig = buildRig(g), clip = readClip(g, rig, clipName);
  const data = JSON.parse(fs.readFileSync(path.join(here, 'data', seg.file), 'utf8')), speed = seg.speed || 1, n = data.hips.length;
  let worst = 0;
  for (const t of clip.keyTimes) {
    if (t < seg.at || t > seg.recover[0]) continue;
    const u = (t - seg.at) * speed, f = Math.max(0, Math.min(n - 1, u * data.fps)), i = Math.floor(f), j = Math.min(n - 1, i + 1), k = f - i;
    const want = new Vector3(...data.handDir.RightHand[i]).lerp(new Vector3(...data.handDir.RightHand[j]), k).normalize();
    if (seg.aim) want.applyQuaternion(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), seg.aim.deg * smooth((t - seg.aim.ramp[0]) / (seg.aim.ramp[1] - seg.aim.ramp[0])) * Math.PI / 180));   // 瞄準偏轉也要算進去
    const W = worldMatrices(rig, poseAt(rig, clip, t)), blade = new Vector3(0, 1, 0).applyQuaternion(wRot(W(rig.byName.Sword)));
    worst = Math.max(worst, blade.angleTo(want) * 180 / Math.PI);
    if (process.env.FIXGRIPS_DEBUG) console.log('bladeVsHand', clipName, t.toFixed(3), (blade.angleTo(want) * 180 / Math.PI).toFixed(1));
  }
  return worst;
}


/* 驗證：刀刃是不是朝著砍的方向。劍尖速度垂直於劍身的分量，投影到劍面法線（劍局部 Z）的比例（0＝完全用刃口砍、1＝完全用劍面／刀背拍），以速度加權平均；
   只算揮砍時段（各招 [t0,t1]）。 */
export function flatRatio(file, clipName, t0, t1) {
  const g = readGlb(file), rig = buildRig(g), clip = readClip(g, rig, clipName), id = (n) => rig.byName[n];
  let num = 0, den = 0, prev = null;
  for (let t = t0; t <= t1 + 1e-9; t += 0.02) {
    const W = worldMatrices(rig, poseAt(rig, clip, t)), sw = W(id('Sword')), tip = new Vector3(4.8, 100.18, 1).applyMatrix4(sw), q = wRot(sw);
    if (prev) {
      const v = tip.clone().sub(prev), bl = new Vector3(0, 1, 0).applyQuaternion(q), z = new Vector3(0, 0, 1).applyQuaternion(q);
      v.sub(bl.clone().multiplyScalar(v.dot(bl)));
      const sp = v.length(); if (sp > 1e-6) { num += sp * Math.abs(v.dot(z) / sp); den += sp; }
    }
    prev = tip;
  }
  return den ? num / den : 0;
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
      return worldPoseDiffDeg(rig, a, b);
    })(),
    maxWristTwistDeg: wristLimits(g, rig).wrist,                         // 所有動作裡手腕扭轉最大值（度）
    maxForearmTwistDeg: wristLimits(g, rig).forearm,
    attack12WristTwistDeg: wristLimits(g, rig, ['Attack1', 'Attack2']).wrist,   // Meshy 網頁動作（不改）自己的手腕扭轉最大值，僅供參考                     // 前臂（相對上臂）扭轉最大值（度）
    armorRigidRatio: armorSoftness(g, rig),                              // 盔甲頂點中完全剛性（100% 單一骨骼）的比例
    maxClothStretch: maxClothStretch(g, rig),                            // 披風三角面最長邊被拉長的最大倍數
    bladeVsHandDeg: Math.max(...[['Attack1', CFG.Attack1.retarget], ...CFG.Attack2.meshy.map((sg) => ['Attack2', { ...sg, recover: sg.recover || CFG.Attack2.recover }])].map(([c, sg]) => bladeVsSourceHand(file, c, sg))),   // 刀刃與「原動作手的方向」的最大夾角（收招開始前）：應為 0
    flat: {                                                              // 刀刃朝砍的方向：劍尖速度落在劍面（刀背拍）的比例，0＝刃口、1＝劍面
      attack1: flatRatio(file, 'Attack1', 0.62, 0.95), attack2a: flatRatio(file, 'Attack2', 0.40, 0.70),
      attack2b: flatRatio(file, 'Attack2', 1.00, 1.20), attack3: flatRatio(file, 'Attack2', 2.10, 2.55)
    },
    hits: {                                                              // 能不能砍到正前方 1.5 處的敵人（各招的揮砍時段）
      attack1: hitFrames(file, 'Attack1', CFG.Attack1.retarget.at, 0.70, 0.90, 1.5),
      attack2a: hitFrames(file, 'Attack2', CFG.Attack2.startTime, 0.40, 0.70, 1.5),
      attack2b: hitFrames(file, 'Attack2', CFG.Attack2.startTime, 1.00, 1.20, 1.5),
      attack3: hitFrames(file, 'Attack2', CFG.Attack2.meshy[1].at, 2.10, 2.60, 1.5)
    },
    bladeLean: (() => {                                                  // 劍身頂點 x 對 y 的迴歸斜率（劍骨骼局部座標）：直的劍接近 0，原模型約 −0.03
      const sd = readSkinData(g), sj = sd.joints.indexOf('Sword'), inv = new Matrix4().fromArray(sd.invBind, sj * 16), v = new Vector3(), xs = [], ys = [];
      for (let i = 0; i < sd.n; i++) { if (!(sd.jnt[i * 4] === sj && sd.wgt[i * 4] > 0.999)) continue; v.set(sd.pos[i * 3], sd.pos[i * 3 + 1], sd.pos[i * 3 + 2]).applyMatrix4(inv); if (v.y > BLADE_Y0) { xs.push(v.x); ys.push(v.y); } }
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
      let num = 0, den = 0; xs.forEach((x, k) => { num += (x - mx) * (ys[k] - my); den += (ys[k] - my) ** 2; });
      return num / den;
    })(),
    guardWingStray: (() => {                                             // 護手右翼端仍綁在右手的頂點數（應為 0）
      const sd = readSkinData(g), sj = sd.joints.indexOf('Sword'), rh = sd.joints.indexOf('RightHand'), inv = new Matrix4().fromArray(sd.invBind, sj * 16), v = new Vector3();
      let n = 0;
      for (let i = 0; i < sd.n; i++) { if (!(sd.jnt[i * 4] === rh && sd.wgt[i * 4] > 0.999)) continue; v.set(sd.pos[i * 3], sd.pos[i * 3 + 1], sd.pos[i * 3 + 2]).applyMatrix4(inv); if (v.x >= 10.5 && v.x <= 19 && v.y >= 7 && v.y <= 16 && v.z >= 0 && v.z <= 5.5) n++; }
      return n;
    })(),
    strayTriangles: strayTriangles(g, rig).stray.length,                // 錯綁的尖刺三角面數（應為 0）
    attack1OffHandMaxDist: CFG.Attack1.retarget ? 0 : Math.max(...m1.map((r) => r[1])),   // 舊雙手劈：副手離劍軸最遠多少（改用單手動作後不適用）
    deathSwordEnd: (() => {      // 倒地最後一格：劍面朝地（flat 法線的 y，應 ≤ −0.9）、劍身水平、朝身體左側（劍身 · 左方向）
      const g = readGlb(file), rig = buildRig(g), clip = readClip(g, rig, 'Death'), W = worldMatrices(rig, poseAt(rig, clip, clip.duration)), q = wRot(W(rig.byName.Sword));
      const fwd = wPos(W(rig.byName.Head)).sub(wPos(W(rig.byName.Hips))); fwd.y = 0; fwd.normalize();
      const blade = new Vector3(0, 1, 0).applyQuaternion(q);
      return { flatNormalY: new Vector3(0, 0, 1).applyQuaternion(q).y, bladeY: blade.y, bladeLeft: blade.dot(new Vector3(0, 1, 0).cross(fwd)) };
    })(),
    retargetMaxDeg: Math.max(...[['Attack1', CFG.Attack1.retarget], ['Death', CFG.Death.retarget], ...CFG.Attack2.meshy.map((sg) => ['Attack2', { ...sg, recover: sg.recover || CFG.Attack2.recover }])].flatMap(([c, sg]) => Object.values(retargetError(file, c, sg)))),   // 動作庫動作（收招開始前）四肢方向與來源的最大差：應為 0，代表沒有被改動
    swordGripMaxDeg: (() => {                                            // Attack1／Attack2 的 Sword 旋轉與模型原本握法（靜止局部旋轉）的最大差：應為 0
      const q0 = rig.rest[rig.byName.Sword].q;
      return Math.max(...['Attack1', 'Attack2'].map((c) => { const tr = readClip(g, rig, c).tracks['Sword.rotation']; let w = 0; for (let i = 0; i < tr.times.length; i++) w = Math.max(w, 2 * Math.acos(Math.min(1, Math.abs(q0.dot(new Quaternion(tr.values[i * 4], tr.values[i * 4 + 1], tr.values[i * 4 + 2], tr.values[i * 4 + 3]))))) * 180 / Math.PI); return w; }));
    })(),
    attack3BladeMaxAngleDeg: Math.max(...measure(rig, readClip(g, rig, 'Attack2'), 'Attack2').filter((r) => r[0] >= CFG.Attack2.meshy[1].at && r[0] <= CFG.Attack2.meshy[1].recover[1]).map((r) => r[1])),   // Attack3：劍身與前臂方向的夾角最大多少
    attack3LoopMaxDeg: (() => {                                          // Attack3 收招姿勢與起始姿勢全身骨骼旋轉最大差（度）
      const sg = CFG.Attack2.meshy[1], clip = readClip(g, rig, 'Attack2'), a = poseAt(rig, clip, sg.at), b = poseAt(rig, clip, sg.recover[1]);
      return worldPoseDiffDeg(rig, a, b);
    })(),
    attack1MaxStepDeg: maxKeyStep(g, rig, 'Attack1', CFG.Attack1.retarget.at, CFG.Attack1.retarget.recover[1]),   // 相鄰兩格之間任一骨骼轉動的最大角度（抓瞬移）
    attack2MaxStepDeg: Math.max(...(CFG.Attack2.meshy || [{ at: CFG.Attack2.startTime }]).map((sg) => maxKeyStep(g, rig, 'Attack2', sg.at, (sg.recover || CFG.Attack2.recover)[1]))),   // 每一招各自的播放區間
    attack1BladeMaxAngleDeg: (() => {                                    // 新 Attack1（單手）：劍身與前臂方向的夾角最大多少
      const seg = CFG.Attack1.retarget, clip = readClip(g, rig, 'Attack1'), len = JSON.parse(fs.readFileSync(path.join(here, 'data', seg.file), 'utf8'));
      return Math.max(...measure(rig, clip, 'Attack2').filter((r) => r[0] >= seg.at && r[0] <= seg.at + len.to - len.from).map((r) => r[1]));
    })(),
    attack1LoopMaxDeg: (() => {                                          // 新 Attack1 收招姿勢與起始姿勢全身骨骼旋轉最大差（度）
      const seg = CFG.Attack1.retarget, clip = readClip(g, rig, 'Attack1');
      const a = poseAt(rig, clip, seg.startTime), b = poseAt(rig, clip, seg.recover[1]);
      return worldPoseDiffDeg(rig, a, b);
    })(),
    attack2BladeMaxAngleDeg: Math.max(...m2.map((r) => r[1]))         // 劍與前臂方向的夾角最大多少
  };
}

/* ---- 主程式 ---- */
function main() {
const args = process.argv.slice(2);
if (args[0] === '--probe-retarget') { probeRetarget(args[1], args[2], Number(args[3] || 0.1)); return; }
if (args[0] === '--extract-retarget') { extractRetarget(args[1], args[2], Number(args[3]), Number(args[4]), Number(args[5]), args[6]); return; }
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
const e1 = CFG.Attack1.retarget ? {} : fixAttack1(rig, a1, CFG.Attack1), e2 = CFG.Attack2.meshy ? {} : fixAttack2Chop(rig, a2, CFG.Attack2);
if (process.env.FIXGRIPS_SEGS) CFG.Attack2.meshy = JSON.parse(process.env.FIXGRIPS_SEGS);   // 試做用：覆寫要匯入的片段
const regroup = (edits) => {
  const by = {};
  for (const [i, o] of Object.entries(edits)) for (const [nm, q] of Object.entries(o)) (by[nm] ||= {})[i] = q;
  return by;
};
if (!checkOnly) {
  for (const [nm, ed] of Object.entries(regroup(e1))) writeQuats(g, a1, nm, ed);
  for (const [nm, ed] of Object.entries(regroup(e2))) writeQuats(g, a2, nm, ed);
  if (CFG.Attack1.retarget) {
    const seg = CFG.Attack1.retarget;
    importRetarget(g, rig, a1, seg);
    recoverToStart(g, rig, a1, { startTime: seg.startTime, recover: seg.recover });
    fitSwordGrip(g, rig, a1);
    alignGripToHand(g, rig, a1, CFG.Attack1.retarget.gripRoll);
  }
  if (CFG.Attack2.meshy) {
    for (const seg of CFG.Attack2.meshy) {
      importRetarget(g, rig, a2, seg);
      if (seg.lunge) {
        const lg = fixLunge(rig, a2, { startTime: seg.at, recover: [seg.lunge.tEnd, 0], lunge: seg.lunge });
        for (const [nm, ed] of Object.entries(regroup(lg.rot))) writeQuats(g, a2, nm, ed);
        if (Object.keys(lg.hips).length) writeVecs(g, a2, 'Hips', lg.hips);
      }
      recoverToStart(g, rig, a2, { startTime: seg.at, recover: seg.recover || CFG.Attack2.recover });
    }
    fitSwordGrip(g, rig, a2);                                                  // 兩招共用同一個握姿（模型原本的握法）
    alignGripToHand(g, rig, a2, CFG.Attack2.gripRoll);
  } else {
    const lunge = fixLunge(rig, a2, CFG.Attack2);
    for (const [nm, ed] of Object.entries(regroup(lunge.rot))) writeQuats(g, a2, nm, ed);
    if (Object.keys(lunge.hips).length) writeVecs(g, a2, 'Hips', lunge.hips);
    recoverToStart(g, rig, a2, CFG.Attack2);
  }
  {
    const a3 = readClip(g, rig, 'Death');
    importRetarget(g, rig, a3, CFG.Death.retarget);
    fitSwordGrip(g, rig, a3);
  }
  limitWrists(g, rig);
  removeStrayTriangles(g, rig);
  hardenArmor(g, rig);
  straightenBlade(g);
  fixGuardWing(g, rig);                                                          // 要在 hardenArmor 之後：其中 3 個頂點原本是手＋前臂混合權重，被 hardenArmor 改成 100% 右手
  inflateCape(g, 0.02);
  softenCapeLegs(g, rig, 0.8);
  removeClothSlivers(g, rig, analyze);
  swingSword(g, rig, readClip(g, rig, 'Death'), CFG.Death.swing);
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
export { readGlb, buildRig, readClip, poseAt, worldMatrices, readSkinData, skinnedPositions, loadCloth, wPos, wRot, writeQuats };

