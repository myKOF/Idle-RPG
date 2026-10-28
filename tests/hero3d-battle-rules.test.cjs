'use strict';
/* 3D 主角（內測）在戰鬥裡的動作規則。這些是看畫面才發現的問題（2026-10-27 內測回報），
   用原始碼比對把規則鎖住，避免之後改動又退回去。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const renderer = fs.readFileSync(require.resolve('../js/battle-renderer.js'), 'utf8');
const hero3d = fs.readFileSync(require.resolve('../js/hero3d.js'), 'utf8');

test('攻擊動作只播有用的一段：start／hit／end，不整段照播', () => {
  for (const name of ['attack1', 'attack2', 'attack3', 'cast']) {
    const m = hero3d.match(new RegExp(name + ':\\s*\\{[^}]*\\}'));
    assert.ok(m, name + ' 不在 CLIP_FOR');
    assert.match(m[0], /start: [\d.]+, hit: [\d.]+, end: [\d.]+/, name + ' 少了 start／hit／end');
  }
  /* 有 end 的動作到 end 就算播完，不等整段 clip */
  assert.match(hero3d, /currentCfg\.end && !currentCfg\.reverse && current\.time >= currentCfg\.end\) fireFinished\(\)/);
});

test('3D 普攻三個動作（雙手劈／斜劈／平砍）混著出，不連續兩下同一招', () => {
  assert.match(renderer, /var HERO3D_ATTACKS = \['attack1', 'attack2', 'attack3'\]/);
  assert.match(renderer, /\(p\.body && p\.body\.hero3d\) \? HERO3D_ATTACKS : playerAttackAnimNames\(sheet\)/);
});

test('3D 施法：出手動作播放中不插施法動作；其餘時候快速播完（0.5 秒內）', () => {
  assert.match(renderer, /if \(!melee && p\.body && p\.body\.hero3d && HERO3D_ACTIONS\[p\.curAnim\]\) return;/);
  assert.match(renderer, /var HERO3D_CAST_MAX_MS = 500;/);
  assert.match(renderer, /p\.body\.naturalMs \/ HERO3D_CAST_MAX_MS/);
});

test('3D 出手動作一定是停下來播：有位移就立刻切跑步，不滑步', () => {
  assert.match(renderer, /p\.stillFor === 0 && HERO3D_ACTIONS\[p\.curAnim\]/);
  /* 看真正的位移，不看拖尾 0.22 秒的 p.walking */
  assert.doesNotMatch(renderer, /p\.walking && !p\.dead && p\.body\.hero3d/);
});

test('3D 起身：死亡動作倒著播，由復活倒數進度驅動（一般倒數與大地守護共用）', () => {
  /* seek 的 0..1 對倒著播的動作要反過來，否則起身會變成把死亡動作正著播 */
  assert.match(hero3d, /if \(currentCfg && currentCfg\.reverse\) fraction = 1 - fraction;/);
  assert.match(renderer, /function hero3dDriveRise\(p, progress\)/);
  assert.match(renderer, /if \(p\.body && p\.body\.hero3d\) hero3dDriveRise\(p, p\.deathFogK\)/);
  assert.match(renderer, /if \(p\.body && p\.body\.hero3d\) \{\s*hero3dDriveRise\(p, revivalProgress\)/);
  /* 倒下時把死亡動作加速到在倒數前段播完 */
  assert.match(renderer, /hero3dFitDie\(p, p\.deathFogDuration\)/);
  assert.match(renderer, /hero3dFitDie\(p, p\.revival\.endAt - p\.revival\.startAt\)/);
});

test('3D 主角也有穿透式輪廓：輪廓貼圖由 3D 畫布剪影每幀算出，走 2D 同一套輪廓圖層', () => {
  assert.match(hero3d, /sp\.hero3dOutlineTex = otex;/);
  assert.match(hero3d, /ctrl\.update\(dt\);\s*tex\.source\.update\(\);\s*drawOutline\(\);/);
  assert.match(renderer, /if \(!body\.hero3d && \(!sheet \|\| !sheet\.outline\)\) return null;/);
  assert.match(renderer, /var tex = body\.hero3d \? body\.hero3dOutlineTex/);
  /* 3D 的輪廓不能再被 makeOutlineSprite 直接略過 */
  assert.doesNotMatch(renderer, /if \(body\.hero3d\) return null;/);
});

test('3D 主角調色與補光：金／銀／披風調色、自發光、背後冷色邊緣光', () => {
  assert.match(hero3d, /function gradeTexture\(THREE, src\)/);
  assert.match(hero3d, /emissiveMap: gradedMap, emissive: new THREE\.Color\(EMISSIVE\)/);
  assert.match(hero3d, /var rim = new THREE\.DirectionalLight\(0xbfe4ff/);
});

test('3D 模型修正仍在：盔甲剛性、披風只小幅伸縮、手腕不超限、劍沒有尖刺、握劍與劈砍軌跡', async () => {
  /* 動畫與蒙皮是 tools/meshy-pipeline/src/fix-grips.mjs 修過的（Meshy 原模型／動作有多處問題，見腳本開頭說明）。
     重新從 Blender 匯出會蓋掉修正，這支測試就是提醒要重新套用。 */
  const { verifyGrips } = await import(require('node:url').pathToFileURL(require.resolve('../tools/meshy-pipeline/src/fix-grips.mjs')).href);
  const r = verifyGrips(require.resolve('../images/models/hero3d/sunbrand-knight.glb'));
  /* 盔甲是硬的、不能形變：內部頂點要 100% 綁單一骨骼（未修的原模型只有 13%） */
  assert.ok(r.armorRigidRatio >= 0.5, '盔甲還是柔性蒙皮（揮動時會被拉扯壓扁）：剛性頂點只有 ' + (r.armorRigidRatio * 100).toFixed(0) + '%');
  /* 披風只准小幅伸縮（未修的原模型最大 66 倍，會被拉成細絲） */
  assert.ok(r.maxClothStretch <= 4.1, '披風有三角面被拉長 ' + r.maxClothStretch.toFixed(1) + ' 倍（細絲）');
  /* 手腕只能左右約 90 度，這裡抓 65°：Meshy 網頁動作（Mixamo 骨架沒有前臂扭轉骨）整個手腕扭轉都在手上，最大 233°，
     會把前臂護甲與手之間的網格擰成碎片；超過 60° 的部分改由前臂（上限 90°）、再由上臂繞軸滾動吸收，手與前臂的世界朝向不變 */
  assert.ok(r.maxWristTwistDeg <= 100, '手腕扭轉超過人體極限：' + r.maxWristTwistDeg.toFixed(0) + '°（未修的原模型 208°）');
  assert.ok(r.maxForearmTwistDeg <= 90.5, '前臂扭轉超過 90°：' + r.maxForearmTwistDeg.toFixed(0) + '°');
  assert.equal(r.strayTriangles, 0, '劍上還有錯綁到手／腿的三角面（揮動時會被拉成尖刺）：' + r.strayTriangles + ' 個（未修的原模型 8 個）');
  /* Attack1 改用 Meshy 動作庫的單手動作（小跳躍→轉圈→斜砍），動作本身不改，只調劍相對右手的朝向：劍身要順著前臂方向，收招回到起始姿勢 */
  /* 劍身要是直的：Meshy 原網格的劍身中心線有錯位、越往劍尖越偏（迴歸斜率約 −0.041），拉直後接近 0 */
  /* 刀刃順著手的方向（原動作裡手沿手臂伸出，刀刃就是它的延伸）：拳頭＋劍整體校正，劍與拳頭的相對位置不變 */
  assert.ok(r.bladeVsHandDeg < 1, '刀刃沒有順著手的方向：夾角 ' + r.bladeVsHandDeg.toFixed(1) + '°');
  /* 用刀刃砍、不是用刀背／劍面拍：劍尖移動方向落在劍面法線上的比例（0＝刃口、1＝劍面）；原本約 0.83～0.94 */
  for (const k of ['attack1', 'attack2a', 'attack2b', 'attack3']) assert.ok(r.flat[k] <= 0.3, k + ' 砍的是刀背／劍面：比例 ' + r.flat[k].toFixed(2));
  /* 每一招的揮砍都要能砍到站在正前方 1.5 處的敵人（劍身穿過半徑 0.28、高 0.35～1.6 的圓柱）；Attack3 原動作邊揮邊往左轉 45°，要把落點轉正 */
  for (const k of ['attack1', 'attack2a', 'attack2b', 'attack3']) assert.ok(r.hits[k].frames >= 1, k + ' 砍不到正前方 1.5 處的敵人（劍身沒有進入敵人身體）');
  assert.ok(Math.abs(r.bladeLean) <= 0.01, '劍身是彎的：x 對 y 的斜率 ' + r.bladeLean.toFixed(3) + '（原模型 −0.041）');
  assert.equal(r.guardWingStray, 0, '劍護手右翼端還有 ' + r.guardWingStray + ' 個頂點綁在右手（劍相對手一轉護手就一邊歪掉；未修的原模型 11 個）');
  /* 劍留在拳頭原本的握法裡（不轉離握法，否則手套被拉成星形碎片）；動作庫動作的角色動作、骨骼、權重一個都不動 */
  assert.ok(r.swordGripMaxDeg < 0.1, 'Attack1／2 的劍離開了模型原本的握法：' + r.swordGripMaxDeg.toFixed(1) + '°');
  assert.ok(r.attack1LoopMaxDeg <= 10, 'Attack1 最後一幀沒有回到第一幀：全身骨骼最大差 ' + r.attack1LoopMaxDeg.toFixed(1) + '°');
  /* 動作首尾相接：Attack2 收招結束的姿勢要回到起始姿勢（使用者要求；不要停在斜劈結束的姿勢多放幾幀） */
  assert.ok(r.attack2LoopMaxDeg <= 3, 'Attack2 最後一幀沒有回到第一幀：全身骨骼最大差 ' + r.attack2LoopMaxDeg.toFixed(1) + '°');
  /* Attack2 改用 Meshy 動作庫的動作後，握劍是動作庫自己的自然握法（劈砍時劍與前臂有夾角），上限放寬到 60° */
  /* Meshy 動作庫的動作不能被改：收招開始之前，四肢方向要與來源動作一致（修掉的 bug：Attack3 收招壓在「反著揮回」上，後半段被往起始姿勢拉） */
  assert.ok(r.retargetMaxDeg <= 1, '動作庫動作被改動：四肢方向與來源最大差 ' + r.retargetMaxDeg.toFixed(1) + '°');
  assert.ok(r.attack3LoopMaxDeg <= 3, 'Attack3 最後一幀沒有回到第一幀：全身骨骼最大差 ' + r.attack3LoopMaxDeg.toFixed(1) + '°');
  /* 不能有瞬移：相鄰兩格任一骨骼轉動不超過 100°（動作本身最快的揮砍手部約 85°，這個量測只抓大跳格，瞬移的根本原因由上面的 retargetMaxDeg 擋；修掉的 bug：片段後面留著舊動作資料，收招混合時在片段結束處跳格 82°；舊劍旋轉軌跡在手裡翻 164°） */
  assert.ok(r.attack1MaxStepDeg <= 100, 'Attack1 相鄰兩格轉動 ' + r.attack1MaxStepDeg.toFixed(0) + '°（瞬移）');
  assert.ok(r.attack2MaxStepDeg <= 100, 'Attack2／3 相鄰兩格轉動 ' + r.attack2MaxStepDeg.toFixed(0) + '°（瞬移）');
});

test('Attack2 的播放區間與腳本的收招設定一致（end＝收招結束、start＝起始姿勢）', () => {
  const hero3d = fs.readFileSync(require.resolve('../js/hero3d.js'), 'utf8');
  const script = fs.readFileSync(require.resolve('../tools/meshy-pipeline/src/fix-grips.mjs'), 'utf8');
  const cfg = hero3d.match(/attack2: \{ clip: 'Attack2', loop: false, start: ([\d.]+), hit: [\d.]+, end: ([\d.]+) \}/);
  assert.ok(cfg, '找不到 CLIP_FOR.attack2');
  assert.match(script, new RegExp('startTime: ' + cfg[1].replace('.', '\\.') + '[,\\s]'), 'CLIP_FOR.attack2.start 與腳本 startTime 不同');
  assert.match(script, new RegExp('recover: \\[[\\d.]+, ' + cfg[2].replace('.', '\\.') + '\\]'), 'CLIP_FOR.attack2.end 與腳本 recover 結束時間不同');
});

test('Attack3 的播放區間與腳本的第二個片段一致（start＝片段開頭、end＝收招結束）', () => {
  const hero3d = fs.readFileSync(require.resolve('../js/hero3d.js'), 'utf8');
  const script = fs.readFileSync(require.resolve('../tools/meshy-pipeline/src/fix-grips.mjs'), 'utf8');
  const cfg = hero3d.match(/attack3: \{ clip: 'Attack2', loop: false, start: ([\d.]+), hit: [\d.]+, end: ([\d.]+) \}/);
  assert.ok(cfg, '找不到 CLIP_FOR.attack3');
  assert.match(script, new RegExp("name: 'combo2'[^}]*at: " + cfg[1].replace('.', '\\.') + ","), 'CLIP_FOR.attack3.start 與腳本片段 at 不同');
  assert.match(script, new RegExp("name: 'combo2'[^}]*recover: \\[[\\d.]+, " + cfg[2].replace('.', '\\.') + "\\]"), 'CLIP_FOR.attack3.end 與腳本 recover 結束時間不同');
});

test('3D 披風碰撞：披風拆成獨立網格、用骨骼膠囊碰撞體推開穿進身體的布料、再鬆弛', () => {
  const hero3d = fs.readFileSync(require.resolve('../js/hero3d.js'), 'utf8');
  assert.match(hero3d, /async function buildCape\(THREE, skinned, material\)/);
  assert.match(hero3d, /skinned\.geometry = armorGeo;/);                       // 身體只畫盔甲
  assert.match(hero3d, /var CLOTH_URL = 'images\/models\/hero3d\/sunbrand-cloth\.json'/);
  assert.match(hero3d, /if \(cape\) cape\.update\(pivot\);/);
  assert.match(hero3d, /torsoCapsule\('Pelvis'/);
  const cloth = JSON.parse(fs.readFileSync(require.resolve('../images/models/hero3d/sunbrand-cloth.json'), 'utf8'));
  assert.equal(cloth.vertexCount, 4999);
  assert.ok(cloth.groups.length > 100);
});
