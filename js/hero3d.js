/* ============================================================
   hero3d.js — 內測用的 3D 主角（即時 3D 骨架動畫）

   戰鬥畫面仍是 Pixi 的 2D 場景。這支檔把一隻 3D 角色（GLB，three.js）畫進一張離屏畫布，
   再當成一張貼圖貼在主角的 Sprite 上，所以站位、鏡頭、陰影、特效層、血條全都沿用原本那一套。
   只換「角色身體怎麼畫」。

   - 只在內測版載入模型：Hero3D.enabled() 要同時滿足 isInternalServer() 與使用者開了開關（localStorage）。
     正式版即使 localStorage 被寫了也回傳 false，不會下載 three.js 或模型。
   - three.js 以 <script type="importmap"> 對應 'three'（見 index.html），第一次 create() 才動態 import，
     沒開 3D 模式就完全不下載。
   - 動畫名稱沿用 2D 序列幀的名稱（idle／walk／attack1／attack2／cast／die／rise），CLIP_FOR 把它們對到 GLB 裡的動畫。
   - 模型與製作方式見 images/models/hero3d/SOURCE.md；程式庫來源與授權見 js/vendor/three/README.md。

   座標：遊戲地面座標 x 向右、y 向畫面下方（朝向觀眾）。three 的地面是 XZ，所以地面 (x, y) 對到 three 的 (x, z)；
   模型的正面是 +Z，朝向地面向量 (dx, dy) 的轉角 = atan2(dx, dy)。
   ============================================================ */
(function (global) {
  'use strict';

  var STORE_KEY = 'idle-rpg.hero3d.v1';
  var MODEL_URL = 'images/models/hero3d/sunbrand-knight.glb?v=20261027-grips29';   // 改了動畫就換版號，避免瀏覽器用到舊快取
  var GLTF_URL = 'js/vendor/three/loaders/GLTFLoader.js';
  var CLOTH_URL = 'images/models/hero3d/sunbrand-cloth.json';   // 布料頂點清單（披風、腰前布襠、關節處的藍布）：和 tools/meshy-pipeline/src/fix-grips.mjs 共用

  /* 2D 動作名 → GLB 動畫。2D 沒有的情況（受擊）不需要；施法與第三招借用攻擊動作。
     rise（起身）把 Death 倒著播。 */
  /* 攻擊動作只播「有用的那一段」：Meshy 的揮劍動作前有約 0.9 秒蓄力、後有 1.3 秒以上的收招空檔，
     整段照播會比攻擊間隔長很多（Attack1 2.4 秒、Attack2 3.2 秒）。單位是動作內的秒數（原速）：
       start：從這裡開始播（跳過大半蓄力，只留看得出「舉劍」的 0.3 秒）
       hit：劍真正揮到的時刻（Attack2 有兩下，取第一下）
       end：動作到這裡就算播完（之後是回到待機的空檔）
     數值是從 GLB 的劍骨骼逐幀位移量出來的（見 images/models/hero3d/SOURCE.md）。 */
  var CLIP_FOR = {
    idle:    { clip: 'CombatIdle', loop: true },
    walk:    { clip: 'Run', loop: true },
    attack1: { clip: 'Attack1', loop: false, start: 0.10, hit: 0.78, end: 1.40 },   // 小跳躍→轉一圈→斜砍（Meshy 動作庫 Sword Judgment），見 fix-grips.mjs 的 CFG.Attack1.retarget
    attack2: { clip: 'Attack2', loop: false, start: 0.10, hit: 0.50, end: 1.65 },   // end：收招已平順回到 start 的姿勢（見 tools/meshy-pipeline/src/fix-grips.mjs 的 CFG.Attack2.recover）
    attack3: { clip: 'Attack2', loop: false, start: 1.72, hit: 2.34, end: 3.11 },   // 右上往左下斜砍再反著揮回（Meshy 動作 Double Combo Attack），與 attack2 放在同一條 Attack2 時間軸（1.74 秒起），見 fix-grips.mjs 的 CFG.Attack2.meshy
    cast:    { clip: 'Attack2', loop: false, start: 0.10, hit: 0.50, end: 0.95 },
    die:     { clip: 'Death', loop: false, hold: true },
    rise:    { clip: 'Death', loop: false, reverse: true }
  };

  /* 離屏畫布與鏡頭。畫布 SIZE 像素涵蓋 SPAN 公尺（揮劍、倒地躺平時劍會伸出去，留夠邊）。
     鏡頭仰角 ELEV_DEG：2D 場景的地面縱向壓縮 0.5＝sin(30°)，用同一個仰角 3D 角色的透視才與地面一致。 */
  var SIZE = 352;
  var SPAN = 4.4;
  var ELEV_DEG = 30;
  var TARGET_Y = 1.0;            // 鏡頭對準的高度（公尺）
  var YAW_TAU_SEC = 0.09;        // 轉向的時間常數：越小轉越快
  var FADE_SEC = 0.12;           // 動作之間的交叉淡入

  var EMISSIVE = 0x2a2418;       // 自發光底色（乘上貼圖）：暗處的金屬不死黑，又不蓋掉光照的明暗

  /* 貼圖調色：Meshy 出的金色偏暗偏灰、銀色邊飾不夠白，縮到遊戲裡的大小（約 100 像素高）就全糊成一片暗黃。
     金色調亮調飽和、銀色拉白、披風的藍略微提亮，讓三種顏色在小圖上分得開。 */
  function gradeTexture(THREE, src) {
    var img = src.image;
    var c = global.document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    var cx = c.getContext('2d');
    cx.drawImage(img, 0, 0);
    var d = cx.getImageData(0, 0, c.width, c.height), p = d.data;
    for (var i = 0; i < p.length; i += 4) {
      var r = p[i] / 255, g = p[i + 1] / 255, b = p[i + 2] / 255;
      var mx = Math.max(r, g, b), mn = Math.min(r, g, b), dl = mx - mn;
      var v = mx, s = mx ? dl / mx : 0, h = 0;
      if (dl) {
        if (mx === r) h = ((g - b) / dl) % 6; else if (mx === g) h = (b - r) / dl + 2; else h = (r - g) / dl + 4;
        h *= 60; if (h < 0) h += 360;
      }
      if (h > 25 && h < 65 && s > 0.25) { v = Math.min(1, v * 1.32 + 0.05); s = Math.min(1, s * 1.12); }        // 金
      else if (s < 0.22 && v > 0.45) { v = Math.min(1, v * 1.2 + 0.08); s *= 0.4; }                              // 銀
      else if (h > 190 && h < 260 && s > 0.25) { v = Math.min(1, v * 1.35); }                                    // 披風
      var C = v * s, X = C * (1 - Math.abs((h / 60) % 2 - 1)), m = v - C, R, G, B;
      if (h < 60) { R = C; G = X; B = 0; } else if (h < 120) { R = X; G = C; B = 0; }
      else if (h < 180) { R = 0; G = C; B = X; } else if (h < 240) { R = 0; G = X; B = C; }
      else if (h < 300) { R = X; G = 0; B = C; } else { R = C; G = 0; B = X; }
      p[i] = (R + m) * 255; p[i + 1] = (G + m) * 255; p[i + 2] = (B + m) * 255;
    }
    cx.putImageData(d, 0, 0);
    var t = new THREE.CanvasTexture(c);
    t.flipY = src.flipY;
    t.colorSpace = src.colorSpace;
    t.anisotropy = 4;
    return t;
  }

  function isInternal() {
    return typeof isInternalServer === 'function' && isInternalServer();
  }
  function stored() {
    try { return global.localStorage.getItem(STORE_KEY) === '1'; } catch (e) { return false; }
  }
  /* 是否使用 3D 主角：只有內測版、且使用者開了開關。 */
  function enabled() { return isInternal() && stored(); }
  function setEnabled(on) {
    try {
      if (on) global.localStorage.setItem(STORE_KEY, '1');
      else global.localStorage.removeItem(STORE_KEY);
    } catch (e) { /* 存不了就維持原狀 */ }
  }

  function absUrl(path) { return new URL(path, global.document.baseURI).href; }

  /* ---- 披風碰撞 ----
     披風是一片薄布，用骨骼蒙皮只會跟著髖部／脊椎轉，腿一跨步或身體一轉，它就穿進腿和身體（穿模）。
     穿模取決於當下的姿勢，沒辦法預先算進動畫資料，所以播放時處理：
       1. 把布料（披風、腰前布襠、關節處的藍布）的三角面拆成獨立網格，身體網格只畫盔甲；
       2. 每根骨骼用「剛性盔甲頂點」（盔甲內部是 100% 單一骨骼，見 fix-grips.mjs）量出一個膠囊碰撞體；
       3. 每幀把布料頂點用 CPU 蒙皮算出位置，穿進膠囊的推出來，再把推開的量在相鄰頂點間平滑，避免鋸齒。
     只推「綁定姿勢下本來就在碰撞體外面」的頂點：披風上緣貼著肩膀本來就在碰撞體附近，不能一開始就被推開。 */
  var CAPE_MARGIN = 0.008;        // 布料離盔甲表面的距離（公尺）
  var CAPE_SMOOTH = 2;            // 推開量的平滑次數
  var CAPE_RELAX = 3, CAPE_RELAX_K = 0.35;   // 布料鬆弛：往相鄰頂點平均位置拉的次數與力道（深蹲時披風被壓成尖角碎片，鬆弛讓它平順）
  var CAPE_PIN_Y = 1.18;          // 綁定姿勢下高於這個高度（公尺）的披風頂點貼著肩背，不鬆弛
  async function buildCape(THREE, skinned, material) {
    var res = await global.fetch(absUrl(CLOTH_URL));
    var data = await res.json();
    var geo0 = skinned.geometry, pos0 = geo0.attributes.position, n = pos0.count;
    if (data.vertexCount !== n) throw new Error('布料清單頂點數 ' + data.vertexCount + ' 與模型 ' + n + ' 不符');
    var cloth = new Uint8Array(n);
    data.groups.forEach(function (g) { g.forEach(function (v) { cloth[v] = 1; }); });
    var idx = geo0.index.array, clothTris = [], armorTris = [];
    for (var t = 0; t < idx.length; t += 3) {
      var a = idx[t], b = idx[t + 1], c = idx[t + 2];
      var arr = (cloth[a] || cloth[b] || cloth[c]) ? clothTris : armorTris;
      arr.push(a, b, c);
    }
    var armorGeo = geo0.clone();
    armorGeo.setIndex(armorTris);
    skinned.geometry = armorGeo;                       // 身體只畫盔甲

    var need = new Uint8Array(n);
    clothTris.forEach(function (v) { need[v] = 1; });
    var needList = []; for (var i = 0; i < n; i++) if (need[i]) needList.push(i);
    var clothList = []; for (var j = 0; j < n; j++) if (cloth[j]) clothList.push(j);

    var capeGeo = new THREE.BufferGeometry();
    var capePos = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    capePos.setUsage(THREE.DynamicDrawUsage);
    capeGeo.setAttribute('position', capePos);
    capeGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    capeGeo.setAttribute('uv', geo0.attributes.uv);
    capeGeo.setIndex(clothTris);
    var capeMesh = new THREE.Mesh(capeGeo, material);
    capeMesh.frustumCulled = false;
    capeMesh.matrixAutoUpdate = false;
    capeMesh.matrix.copy(skinned.matrix);
    skinned.parent.add(capeMesh);

    /* 位置完全重疊的頂點（貼圖接縫的重複頂點）視為同一組，共用推開量，否則接縫會裂開 */
    var rep = new Int32Array(n), seen = new Map();
    for (var k = 0; k < n; k++) {
      var key = Math.round(pos0.getX(k) * 1e4) + ',' + Math.round(pos0.getY(k) * 1e4) + ',' + Math.round(pos0.getZ(k) * 1e4);
      if (seen.has(key)) rep[k] = seen.get(key); else { seen.set(key, k); rep[k] = k; }
    }
    var neigh = new Map();
    for (var q = 0; q < clothTris.length; q += 3) {
      for (var e1 = 0; e1 < 3; e1++) {
        var ra = rep[clothTris[q + e1]], rb = rep[clothTris[q + (e1 + 1) % 3]];
        if (ra === rb) continue;
        if (!neigh.has(ra)) neigh.set(ra, new Set()); if (!neigh.has(rb)) neigh.set(rb, new Set());
        neigh.get(ra).add(rb); neigh.get(rb).add(ra);
      }
    }
    var clothReps = []; var repSeen = {}; clothList.forEach(function (v) { var r = rep[v]; if (!repSeen[r]) { repSeen[r] = 1; clothReps.push(r); } });

    /* 碰撞體：每根骨骼用以它為主（權重 ≥ 0.6）的盔甲頂點量出膠囊（骨頭起點到子骨頭起點，半徑取頂點離軸距離的 90 百分位） */
    var skel = skinned.skeleton, bones = skel.bones, nb = bones.length;
    var si = geo0.attributes.skinIndex, sw = geo0.attributes.skinWeight;
    var heads = bones.map(function (_, bi) { return new THREE.Vector3().applyMatrix4(skel.boneInverses[bi].clone().invert()); });
    var capsules = [], skipped = [];
    var segDist = function (p, A, B) {
      var ab = B.clone().sub(A), t2 = Math.max(0, Math.min(1, p.clone().sub(A).dot(ab) / ab.lengthSq()));
      return p.distanceTo(A.clone().addScaledVector(ab, t2));
    };
    for (var bi = 0; bi < nb; bi++) {
      var name = bones[bi].name;
      if (name === 'Sword') continue;
      var kids = bones[bi].children.filter(function (c) { return c.isBone; }).map(function (c) { return bones.indexOf(c); }).filter(function (x) { return x >= 0; });
      if (!kids.length) continue;
      var tail = new THREE.Vector3(); kids.forEach(function (ci) { tail.add(heads[ci]); }); tail.multiplyScalar(1 / kids.length);
      var A = heads[bi], B = tail;
      if (A.distanceTo(B) < 0.02) { skipped.push(name + ':長度' + A.distanceTo(B).toFixed(3)); continue; }
      var ds = [];
      for (var v = 0; v < n; v++) {
        if (cloth[v] || si.getX(v) !== bi || sw.getX(v) < 0.6) continue;
        ds.push(segDist(new THREE.Vector3().fromBufferAttribute(pos0, v).applyMatrix4(skinned.bindMatrix), A, B));
      }
      if (ds.length < 8) { skipped.push(name + ':樣本' + ds.length); continue; }
      ds.sort(function (x, y) { return x - y; });
      capsules.push({ bone: bi, name: name, A: A, B: B, r: ds[Math.floor(ds.length * 0.9)] });
    }
    /* 軀幹：盔甲頂點多半以 Spine02 或大腿為主，Hips／Spine01／Spine 上量不出膠囊，所以另外量骨盆與胸腔：
       取該高度範圍內、身體中線附近（|x| < 0.25，不含肩甲與手臂）的盔甲頂點，半徑取離軸距離的 90 百分位 */
    function torsoCapsule(name, boneName, fromName, toName, dropA) {
      var bi2 = bones.findIndex(function (b) { return b.name === boneName; });
      var fi = bones.findIndex(function (b) { return b.name === fromName; });
      var ti = bones.findIndex(function (b) { return b.name === toName; });
      if (bi2 < 0 || fi < 0 || ti < 0) return;
      var A2 = heads[fi].clone(); A2.y -= dropA || 0;
      var B2 = heads[ti].clone();
      var ds2 = [];
      for (var v2 = 0; v2 < n; v2++) {
        if (cloth[v2]) continue;
        var pb = new THREE.Vector3().fromBufferAttribute(pos0, v2).applyMatrix4(skinned.bindMatrix);
        if (Math.abs(pb.x) > 0.25 || pb.y < A2.y || pb.y > B2.y) continue;
        ds2.push(segDist(pb, A2, B2));
      }
      if (ds2.length < 8) { skipped.push(name + ':樣本' + ds2.length); return; }
      ds2.sort(function (x, y) { return x - y; });
      capsules.push({ bone: bi2, name: name, A: A2, B: B2, r: ds2[Math.floor(ds2.length * 0.9)] });
    }
    capsules = capsules.filter(function (c) { return c.name !== 'Spine02'; });
    torsoCapsule('Pelvis', 'Hips', 'Hips', 'Spine02', 0.08);
    torsoCapsule('Chest', 'Spine02', 'Spine02', 'Spine', 0);
    /* 綁定姿勢下已經在碰撞體裡面的布料頂點不跟那個碰撞體碰（披風上緣貼著肩膀本來就在附近） */
    var bindP = new Map();
    clothList.forEach(function (v) { bindP.set(v, new THREE.Vector3().fromBufferAttribute(pos0, v).applyMatrix4(skinned.bindMatrix)); });
    capsules.forEach(function (cp) {
      cp.skip = new Uint8Array(n);
      clothList.forEach(function (v) { if (segDist(bindP.get(v), cp.A, cp.B) < cp.r + CAPE_MARGIN) cp.skip[v] = 1; });
    });

    var stats = { pushed: 0, maxDepth: 0, skipped: skipped, capsules: capsules.map(function (c) { return c.name + ':' + c.r.toFixed(3); }) };
    var bm = new THREE.Matrix4(), mm = [], tmp = new THREE.Vector3(), cur = new THREE.Vector3();
    var skinPos = new Float32Array(n * 3), disp = new Float32Array(n * 3), work = new Float32Array(n * 3), relaxed = new Float32Array(n * 3);
    var pinned = new Uint8Array(n);       // 綁定姿勢下貼著肩背的上緣：不鬆弛
    clothList.forEach(function (v) { if (pos0.getY(v) > CAPE_PIN_Y) pinned[rep[v]] = 1; });
    function collide(v, px, py, pz, record) {
      var moved = false, p = tmp.set(px, py, pz);
      for (var ci = 0; ci < capsules.length; ci++) {
        var cp = capsules[ci];
        if (cp.skip[v]) continue;
        var A = cp.wA, B = cp.wB, ab = cp.ab, len2 = cp.len2;
        var tt = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - A.x) * ab.x + (p.y - A.y) * ab.y + (p.z - A.z) * ab.z) / len2)) : 0;
        var cx = A.x + ab.x * tt, cy = A.y + ab.y * tt, cz = A.z + ab.z * tt;
        var dx = p.x - cx, dy = p.y - cy, dz = p.z - cz, d = Math.sqrt(dx * dx + dy * dy + dz * dz), rr = cp.wr + CAPE_MARGIN * cp.unit;
        if (d < rr && d > 1e-9) {
          if (record) { stats.pushed++; stats.maxDepth = Math.max(stats.maxDepth, rr - d); }
          p.set(cx + dx / d * rr, cy + dy / d * rr, cz + dz / d * rr);
          moved = true;
        }
      }
      return moved ? p : null;
    }
    function update(root) {
      (root || skinned.parent).updateMatrixWorld(true);       // 骨骼與網格的世界矩陣要一致（bindMatrixInverse 是 attached 模式，跟著網格的世界矩陣走）
      skel.update();
      stats.pushed = 0; stats.maxDepth = 0;
      // 各骨骼這一幀的碰撞體位置：綁定空間 → 目前的網格局部空間（和 getVertexPosition 同一個空間）
      capsules.forEach(function (cp) {
        bm.fromArray(skel.boneMatrices, cp.bone * 16);
        bm.premultiply(skinned.bindMatrixInverse);
        cp.wA = cp.A.clone().applyMatrix4(bm); cp.wB = cp.B.clone().applyMatrix4(bm);
        cp.ab = cp.wB.clone().sub(cp.wA); cp.len2 = cp.ab.lengthSq(); cp.unit = bm.getMaxScaleOnAxis(); cp.wr = cp.r * cp.unit;     // 網格局部座標單位 = 公尺 × unit（這個模型是公分，unit≈100）
      });
      for (var i2 = 0; i2 < needList.length; i2++) {
        var vi = needList[i2];
        skinned.getVertexPosition(vi, cur);
        skinPos[vi * 3] = cur.x; skinPos[vi * 3 + 1] = cur.y; skinPos[vi * 3 + 2] = cur.z;
      }
      // 布料頂點：碰撞推出（同組取第一個成員的結果，共用）
      for (var g2 = 0; g2 < clothReps.length; g2++) {
        var r = clothReps[g2], o = r * 3;
        var out = collide(r, skinPos[o], skinPos[o + 1], skinPos[o + 2], true);
        if (out) { disp[o] = out.x - skinPos[o]; disp[o + 1] = out.y - skinPos[o + 1]; disp[o + 2] = out.z - skinPos[o + 2]; }
        else { disp[o] = 0; disp[o + 1] = 0; disp[o + 2] = 0; }
      }
      // 推開量在相鄰頂點間平滑（只讓推開量擴散出去，不把已推出來的拉回去）
      for (var it = 0; it < CAPE_SMOOTH; it++) {
        var nxt = new Float32Array(clothReps.length * 3);
        for (var g3 = 0; g3 < clothReps.length; g3++) {
          var rr3 = clothReps[g3], o3 = rr3 * 3, nb3 = neigh.get(rr3);
          var ax = disp[o3], ay = disp[o3 + 1], az = disp[o3 + 2];
          if (nb3 && nb3.size) {
            var sx = 0, sy = 0, sz = 0;
            nb3.forEach(function (x) { if (cloth[x]) { sx += disp[x * 3]; sy += disp[x * 3 + 1]; sz += disp[x * 3 + 2]; } });
            var cnt = nb3.size;
            ax = ax === 0 ? sx / cnt * 0.6 : ax * 0.6 + sx / cnt * 0.4;
            ay = ay === 0 ? sy / cnt * 0.6 : ay * 0.6 + sy / cnt * 0.4;
            az = az === 0 ? sz / cnt * 0.6 : az * 0.6 + sz / cnt * 0.4;
          }
          nxt[g3 * 3] = ax; nxt[g3 * 3 + 1] = ay; nxt[g3 * 3 + 2] = az;
        }
        for (var g4 = 0; g4 < clothReps.length; g4++) { var o4 = clothReps[g4] * 3; disp[o4] = nxt[g4 * 3]; disp[o4 + 1] = nxt[g4 * 3 + 1]; disp[o4 + 2] = nxt[g4 * 3 + 2]; }
      }
      // 布料頂點位置 = 蒙皮位置 + 推開量
      for (var g5 = 0; g5 < clothReps.length; g5++) {
        var o6 = clothReps[g5] * 3;
        work[o6] = skinPos[o6] + disp[o6]; work[o6 + 1] = skinPos[o6 + 1] + disp[o6 + 1]; work[o6 + 2] = skinPos[o6 + 2] + disp[o6 + 2];
      }
      // 鬆弛：往相鄰頂點的平均位置拉一點（貼著肩背的上緣不動），讓被壓成尖角的披風平順；每次鬆弛後再碰撞一次
      for (var rl = 0; rl < CAPE_RELAX; rl++) {
        for (var g6 = 0; g6 < clothReps.length; g6++) {
          var r6 = clothReps[g6], o7 = r6 * 3, nb6 = neigh.get(r6);
          if (pinned[r6] || !nb6 || !nb6.size) { relaxed[o7] = work[o7]; relaxed[o7 + 1] = work[o7 + 1]; relaxed[o7 + 2] = work[o7 + 2]; continue; }
          var mx = 0, my = 0, mz = 0, cn = 0;
          nb6.forEach(function (x) { if (cloth[x]) { mx += work[x * 3]; my += work[x * 3 + 1]; mz += work[x * 3 + 2]; cn++; } });
          if (!cn) { relaxed[o7] = work[o7]; relaxed[o7 + 1] = work[o7 + 1]; relaxed[o7 + 2] = work[o7 + 2]; continue; }
          relaxed[o7] = work[o7] + (mx / cn - work[o7]) * CAPE_RELAX_K;
          relaxed[o7 + 1] = work[o7 + 1] + (my / cn - work[o7 + 1]) * CAPE_RELAX_K;
          relaxed[o7 + 2] = work[o7 + 2] + (mz / cn - work[o7 + 2]) * CAPE_RELAX_K;
        }
        for (var g7 = 0; g7 < clothReps.length; g7++) {
          var r7 = clothReps[g7], o8 = r7 * 3;
          var cc = collide(r7, relaxed[o8], relaxed[o8 + 1], relaxed[o8 + 2], false);
          work[o8] = cc ? cc.x : relaxed[o8]; work[o8 + 1] = cc ? cc.y : relaxed[o8 + 1]; work[o8 + 2] = cc ? cc.z : relaxed[o8 + 2];
        }
      }
      // 寫進披風網格：布料頂點取鬆弛後的位置；其他（邊界上的盔甲頂點）= 蒙皮位置
      var arrP = capePos.array;
      for (var i3 = 0; i3 < needList.length; i3++) {
        var v3 = needList[i3], o5 = v3 * 3;
        var x = skinPos[o5], y = skinPos[o5 + 1], z = skinPos[o5 + 2];
        if (cloth[v3]) {
          var rp = rep[v3] * 3;
          x = work[rp]; y = work[rp + 1]; z = work[rp + 2];
        }
        arrP[o5] = x; arrP[o5 + 1] = y; arrP[o5 + 2] = z;
      }
      capePos.needsUpdate = true;
      capeGeo.computeVertexNormals();
    }
    return {
      update: update, stats: stats, mesh: capeMesh, capsules: capsules, skinPos: skinPos, needList: needList, clothList: clothList,
      dispose: function () { capeGeo.dispose(); armorGeo.dispose(); }
    };
  }

  async function create(opts) {
    opts = opts || {};
    var THREE = await import('three');
    var gltfMod = await import(absUrl(GLTF_URL));
    var gltf = await new gltfMod.GLTFLoader().loadAsync(absUrl(opts.model || MODEL_URL));

    var size = opts.size || SIZE, span = opts.span || SPAN;      // 預設與遊戲相同；opts 只給驗證時放大看細節用
    var canvas = global.document.createElement('canvas');
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(size, size, false);
    renderer.setClearColor(0x000000, 0);

    var scene = new THREE.Scene();
    /* 光照：環境光壓低一點、主光加強讓盔甲有明暗，背後再補一盞冷色邊緣光把人物從背景分出來
       （戰鬥畫面特效多、背景雜，只靠環境光整個人會糊成一片）。 */
    scene.add(new THREE.AmbientLight(0xffffff, 1.35));
    var sun = new THREE.DirectionalLight(0xfff4e0, 2.0);
    sun.position.set(-2, 4, 3);
    scene.add(sun);
    var rim = new THREE.DirectionalLight(0xbfe4ff, 1.7);
    rim.position.set(2.5, 2.5, -3);
    scene.add(rim);

    var pivot = new THREE.Group();     // 面向轉在這一層
    pivot.add(gltf.scene);
    scene.add(pivot);
    var gradedMap = null, skinnedMesh = null, bodyMaterial = null;
    gltf.scene.traverse(function (o) {
      if (o.isSkinnedMesh || o.isMesh) o.frustumCulled = false;  // 蒙皮網格的包圍盒不隨動畫更新，會被誤剔除
      if (o.isMesh && o.material && o.material.isMeshStandardMaterial) {
        /* 手繪貼圖：金屬度與粗糙度沒有貼圖，標準材質會因為缺環境光偏暗，用 Lambert 保持貼圖原色。
           貼圖先調色（見 gradeTexture），再把同一張當自發光貼圖，讓金屬在暗處也不會死黑。 */
        if (!gradedMap) gradedMap = gradeTexture(THREE, o.material.map);
        o.material = new THREE.MeshLambertMaterial({
          map: gradedMap, emissiveMap: gradedMap, emissive: new THREE.Color(EMISSIVE), transparent: false
        });
        if (o.isSkinnedMesh) { skinnedMesh = o; bodyMaterial = o.material; }
      }
    });
    var cape = null;
    if (skinnedMesh && opts.cape !== false) {
      try { cape = await buildCape(THREE, skinnedMesh, bodyMaterial); }
      catch (err) { global.console.warn('[hero3d] 披風碰撞載入失敗，披風照原本蒙皮畫：', err && err.message ? err.message : err); }
    }

    var cam = new THREE.OrthographicCamera(-span / 2, span / 2, span / 2, -span / 2, 0.1, 60);
    var e = ELEV_DEG * Math.PI / 180;
    cam.position.set(0, TARGET_Y + Math.sin(e) * 12, Math.cos(e) * 12);
    cam.lookAt(0, TARGET_Y, 0);

    var mixer = new THREE.AnimationMixer(gltf.scene);
    var actions = {};
    gltf.animations.forEach(function (c) { actions[c.name] = mixer.clipAction(c); });

    var ctrl = {
      canvas: canvas,
      size: size,
      /* 腳底在畫布裡的縱向位置（0＝上緣、1＝下緣）：正交鏡頭下，高度 h 的點離中心 (h − TARGET_Y)·cos(仰角) 公尺 */
      anchorY: 0.5 + TARGET_Y * Math.cos(e) / span,
      pxPerMeter: size / span,
      clip: '',
      onFinished: null,
      yaw: Math.PI / 2,              // 預設面向右（與 2D 的 defaultDirection 0 一致）
      yawTarget: Math.PI / 2,
      speed: 1
    };
    var current = null, currentCfg = null, finishedFired = false;

    /* 一次播放只通知一次「播完」：有 end 的動作在 end 就算完，不必等整段 clip 的 finished 事件 */
    function fireFinished() {
      if (finishedFired) return;
      finishedFired = true;
      if (typeof ctrl.onFinished === 'function') ctrl.onFinished(ctrl.clip);
    }
    mixer.addEventListener('finished', function (ev) {
      if (ev.action === current) fireFinished();
    });

    /* 播放一個動作；cfg 同 CLIP_FOR 的項目。同一個循環動作重複要求時不重來。 */
    ctrl.play = function (cfg, fade) {
      var next = actions[cfg.clip];
      if (!next) return false;
      if (next === current && cfg.loop) return true;
      var prev = current;
      next.reset();
      next.enabled = true;
      next.setLoop(cfg.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      next.clampWhenFinished = !cfg.loop;       // 放完停在最後一格，直到被換掉（死亡要停在躺下）
      next.timeScale = cfg.reverse ? -1 : 1;
      next.time = cfg.reverse ? next.getClip().duration : (cfg.start || 0);
      next.setEffectiveWeight(1);
      next.play();
      if (prev && prev !== next && fade !== 0) next.crossFadeFrom(prev, fade == null ? FADE_SEC : fade, false);
      else if (prev && prev !== next) prev.stop();
      current = next;
      currentCfg = cfg;
      finishedFired = false;
      ctrl.clip = cfg.clip;
      return true;
    };
    ctrl.duration = function (clip) {
      var a = actions[clip || ctrl.clip];
      return a ? a.getClip().duration : 0;
    };
    /* 目前這個動作原速要播多久（有 start／end 的只算那一段）與劍揮到的時刻（距離開始播的秒數） */
    ctrl.spanSec = function () {
      if (!currentCfg) return 0;
      return currentCfg.end ? currentCfg.end - (currentCfg.start || 0) : ctrl.duration();
    };
    ctrl.hitSec = function () {
      return currentCfg && currentCfg.hit ? currentCfg.hit - (currentCfg.start || 0) : 0;
    };
    /* 停在這個動作的某個位置（0..1）。倒著播的動作（起身）0 是「最後一格」：fraction 從 0 走到 1 就是倒著播。 */
    ctrl.seek = function (fraction) {
      if (!current) return;
      if (currentCfg && currentCfg.reverse) fraction = 1 - fraction;
      var d = current.getClip().duration;
      current.paused = false;
      current.time = Math.max(0, Math.min(1, fraction)) * d;
      current.paused = true;
      mixer.update(0);
    };
    ctrl.faceVector = function (dx, dy) {
      if (!dx && !dy) return;
      ctrl.yawTarget = Math.atan2(dx, dy);
    };
    ctrl.update = function (dt) {
      mixer.timeScale = ctrl.speed;
      mixer.update(dt);
      if (current && currentCfg && currentCfg.end && !currentCfg.reverse && current.time >= currentCfg.end) fireFinished();
      var d = ((ctrl.yawTarget - ctrl.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      ctrl.yaw += d * (1 - Math.exp(-dt / YAW_TAU_SEC));
      pivot.rotation.y = ctrl.yaw;
      if (cape) cape.update(pivot);
      renderer.render(scene, cam);
    };
    /* 驗證用：直接停在某個動作的某個時間（秒）並畫出來；不經過遊戲的播放流程 */
    ctrl.pose = function (clip, t) {
      var a = actions[clip];
      if (!a) return false;
      mixer.stopAllAction();
      a.reset(); a.enabled = true; a.play(); a.time = t; a.paused = true;
      current = a; currentCfg = { clip: clip }; ctrl.clip = clip;
      mixer.update(0);
      ctrl.update(0);
      return true;
    };
    ctrl.capeStats = cape ? cape.stats : null;
    ctrl.cape = cape;
    ctrl.dispose = function () {
      if (cape) cape.dispose();
      mixer.stopAllAction();
      renderer.dispose();
      gltf.scene.traverse(function (o) {
        if (o.geometry) o.geometry.dispose();
        if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
      });
    };
    ctrl.clips = Object.keys(actions);
    ctrl.update(0);
    global.Hero3D.instance = ctrl;   // 除錯與驗證用（在 console 看畫布、手動播動作）
    return ctrl;
  }

  /* 把 3D 角色包成一個長得像 AnimatedSprite 的 Pixi Sprite：battle-renderer 對主角身體用到的那幾個成員
     （playing／update／animationSpeed／loop／onComplete／gotoAndStop／totalFrames／tint）都有，
     其餘程式不必知道身體是 2D 還是 3D。
     animationSpeed 的語意與 2D 相同「某個動作的播放速度」，但 3D 動作有自己的長度，所以換算成相對「名目速度」的倍率。 */
  function makeBody(ctrl) {
    var PIXI = global.PIXI;
    var tex = PIXI.Texture.from(ctrl.canvas);
    tex.source.scaleMode = 'linear';
    var sp = new PIXI.Sprite(tex);
    sp.anchor.set(0.5, ctrl.anchorY);
    sp.hero3d = ctrl;
    /* 穿透式輪廓（battle-renderer 的 makeOutlineSprite／syncOutline 畫在特效層之上，讓人物被特效蓋住時還找得到）：
       2D 角色有逐幀的輪廓圖，3D 沒有，所以每幀從 3D 畫布的剪影即時算一圈——白色，顏色由輪廓精靈上色。 */
    var oc = global.document.createElement('canvas');
    oc.width = oc.height = ctrl.size;
    var ox = oc.getContext('2d');
    var otex = PIXI.Texture.from(oc);
    otex.source.scaleMode = 'linear';
    sp.hero3dOutlineTex = otex;
    var OUTLINE_R = 2;   // 畫布像素；畫布縮到遊戲裡約 0.7 倍，所以螢幕上約 1.4 像素寬
    function drawOutline() {
      ox.globalCompositeOperation = 'source-over';
      ox.clearRect(0, 0, oc.width, oc.height);
      for (var a = 0; a < 8; a++) {
        ox.drawImage(ctrl.canvas, Math.round(Math.cos(a * Math.PI / 4) * OUTLINE_R), Math.round(Math.sin(a * Math.PI / 4) * OUTLINE_R));
      }
      ox.globalCompositeOperation = 'source-in';
      ox.fillStyle = '#fff';
      ox.fillRect(0, 0, oc.width, oc.height);
      ox.globalCompositeOperation = 'destination-out';
      ox.drawImage(ctrl.canvas, 0, 0);       // 挖掉本體，只剩外圈
      ox.globalCompositeOperation = 'source-over';
      otex.source.update();
    }
    sp.playing = true;
    sp.loop = true;
    sp.onComplete = null;
    var nominal = 0.5, factor = 1;
    Object.defineProperty(sp, 'animationSpeed', {
      get: function () { return nominal * factor; },
      set: function (v) { factor = nominal > 0 && isFinite(v) ? v / nominal : 1; ctrl.speed = factor; }
    });
    Object.defineProperty(sp, 'textures', { get: function () { return [tex]; }, set: function () { /* 2D 專用，3D 不用 */ } });
    Object.defineProperty(sp, 'totalFrames', { get: function () { return Math.max(1, Math.round(ctrl.duration() * 24)); } });
    Object.defineProperty(sp, 'currentFrame', { get: function () { return 0; } });
    /* 這個動作原速播完要多少毫秒（攻擊動作以此算要加速多少才塞得進攻擊間隔）；有 start／end 的只算有用的那一段 */
    Object.defineProperty(sp, 'naturalMs', { get: function () { return ctrl.spanSec() * 1000; } });
    /* 劍揮到的時刻：原速下距離開始播多少毫秒（施法要讓它對上技能釋放的時刻） */
    Object.defineProperty(sp, 'hitMs', { get: function () { return ctrl.hitSec() * 1000; } });

    ctrl.onFinished = function () {
      if (typeof sp.onComplete === 'function') sp.onComplete();
    };
    /* 名目速度＝2D 那個動作的 animationSpeed，之後外部乘上的倍數就是 3D 的播放倍率 */
    sp.hero3dPlay = function (cfg, nominalSpeed) {
      nominal = nominalSpeed > 0 ? nominalSpeed : 0.5;
      factor = 1;
      ctrl.speed = 1;
      return ctrl.play(cfg);
    };
    sp.hero3dFace = function (dx, dy) { ctrl.faceVector(dx, dy); };
    sp.gotoAndStop = function (n) {
      var total = sp.totalFrames;
      ctrl.seek(total > 1 ? n / (total - 1) : 0);
      sp.update(null, 0);
    };
    sp.gotoAndPlay = function () { /* 3D 以 hero3dPlay 開始播放 */ };
    sp.update = function (ticker, dtOverride) {
      var dt = dtOverride != null ? dtOverride : Math.min(0.05, Math.max(0, (ticker && ticker.deltaMS) || 16.7) / 1000);
      ctrl.update(dt);
      tex.source.update();
      drawOutline();
    };
    return sp;
  }

  global.Hero3D = {
    enabled: enabled,
    setEnabled: setEnabled,
    create: create,
    makeBody: makeBody,
    CLIP_FOR: CLIP_FOR,
    /* 畫布像素 → 螢幕像素的縮放，使 1.8 公尺高的角色約等於 2D 騎士的畫面高度（約 100px） */
    displayScale: function (ctrl) { return 100 / 1.8 / ctrl.pxPerMeter; }
  };
})(typeof window !== 'undefined' ? window : this);
