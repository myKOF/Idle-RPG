'use strict';
/* ============================================================
   build_character_sprites.cjs — 角色序列幀：素材庫原圖 → 遊戲用圖集與幀定義

   用法：
     node tools/build_character_sprites.cjs knight          產生／更新 images/sprites/knight/
     node tools/build_character_sprites.cjs knight --check  只比對，輸出與磁碟不同就回 1（不寫檔）
     --root <素材庫路徑>                                     不走本機設定，直接指定素材庫

   ---- 為什麼要有這一步，而不是直接把原圖丟進遊戲 ----
   2026-09-22 主角換成「2D HD Character Knight」（素材庫 characters/knight-hd，說明見那裡的 README）。
   原圖是 8 方向 × 15 幀、每格 128×128，影子直接畫在圖裡。直接用有兩個問題：
     1. 穿透式角色輪廓（battle-renderer 的 PLAYER_OUTLINE）是從角色的 alpha 推出來的。
        影子也不透明，照原本的做法推，綠色輪廓會把地上的影子一起框起來。
        執行期在瀏覽器裡分不出影子（canvas 合成沒辦法看顏色，getImageData 在 file:// 會丟例外），
        所以輪廓在這裡先算好：影子＝純黑且透明度 < 240，本體一律是不透明的（2026-09-22 逐像素量過，
        本體的深色衣物也是 255），分得很乾淨。
     2. 大部分格子是空的（站立只用到 60×79）。每個動作各自裁到「所有方向、所有幀的聯集」，
        圖集小一半以上。裁掉的邊記在幀定義的 trim，執行期用 Pixi 的 trim 還原成 128×128 的邏輯格，
        所以所有動作共用同一個站立點（anchor），切換動作時角色不會跳。

   節奏（fps、從第幾幀開始、停在最後一幀）寫在下面的 CHARACTERS，改完重跑這支工具。
   不寫在圖裡、也不另外手改 JSON：幀定義整份由這裡產生，兩邊不會分家。
   ============================================================ */

const fs = require('fs');
const path = require('path');
const raster = require('./vfx/vfx-raster.cjs');
const libraryRoot = require('./vfx/vfx-library-root.cjs');

const REPO = path.resolve(__dirname, '..');

/* ---- 角色設定 ----
   anims 的鍵是遊戲裡的動作名（battle-renderer 認得的名字）：
     idle 站立、walk 移動、attack1～3 普攻（隨機、不連續兩下同一招）、cast 技能施法、die 死亡、rise 復活起身。
     attack3 借用特殊攻擊 1（與 cast 同一套幀），使用者要兩段普攻與特殊攻擊隨機混著出（2026-09-22）。
   first  從第幾幀開始播。普攻與施法的傷害數字、技能特效都在「事件到達的那一刻」出現，
          所以把架式砍短，讓出劍／釋放幀緊跟在那一刻之後（關鍵幀見素材庫 README）。
   release  施法「釋放」的那一幀（素材的原幀號）。技能開始施放時模擬層會說硬直多長（協議 v36 act:'cast'），
          硬直結束技能才放出去、特效才出現；執行期把 first→release 這段的播放速度調成剛好在那一刻播到 release。
          預設硬直 0.2 秒、first 2、release 8 ＝ 30 fps，與其他動作同速。
   hold   播完停在最後一幀（死亡）。
   strideSpeed  這個 fps 下腳步剛好對上的移動速度（px/s）：著地腳每幀往後滑約 7 px（原尺寸），
          ×1.4 倍 × 30 fps ≈ 300 px/s ＝ BF_PLAYER_SPEED。移動速度變了，執行期照比例調播放速度，腳不會打滑。
   from／reverse  不另外出圖，拿另一個動作的幀來播（起身＝倒地倒轉）。from 也可以帶 first
          （素材的原幀號，不能早於來源動作的 first）：同一套幀從不同的地方開始播。 */
const CHARACTERS = {
  knight: {
    library: 'characters/knight-hd',
    out: 'images/sprites/knight',
    manifest: 'knight.json',
    cell: 128, cols: 15, rows: 8,
    /* 列＝方向，從正右方開始順時針每 45°（螢幕座標，y 向下）。判定依據見素材庫 README。 */
    directions: ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'],
    defaultDirection: 0,          // 開場朝右：空場推進是往右跑
    pivot: { x: 64, y: 98 },      // 腳底在格內的位置
    /* 螢幕上的身高對齊舊主角（Clarice 25 px × 3.154 ≈ 79 px；騎士站姿約 56 px）：
       血條寬度、近戰距離、特效大小都是照那個身高調的。 */
    scale: 1.4,
    outlinePx: 2,                 // 輪廓粗細（原尺寸 px），× scale 就是螢幕上的粗細
    anims: {
      idle: { src: 'Idle.png', fps: 15, loop: true },
      walk: { src: 'Run.png', fps: 30, loop: true, strideSpeed: 300 },
      attack1: { src: 'Melee.png', fps: 30, loop: false, first: 3 },
      attack2: { src: 'Melee2.png', fps: 30, loop: false, first: 4 },
      cast: { src: 'Special1.png', fps: 30, loop: false, first: 2, release: 8 },
      /* 當普攻用：第 8～9 幀釋放，從第 5 幀開始＝與另外兩段一樣，出劍前只留 3 幀架式 */
      attack3: { from: 'cast', fps: 30, loop: false, first: 5 },
      die: { src: 'Die.png', fps: 15, loop: false, hold: true },
      rise: { from: 'die', reverse: true, fps: 30, loop: false }
    }
  }
};

/* ---- 影子與本體 ----
   影子是純黑的半透明；本體一律不透明。刀光拖影是半透明的淺灰，不算影子。 */
function isShadowPx(r, g, b, a) {
  return a > 0 && a < 240 && r < 24 && g < 24 && b < 24;
}
/* 輪廓要框的本體：角色本體一律是 255；刀光拖影再濃也是半透明，不框（框了滿身綠色弧線，2026-09-22 看預覽確認） */
function isBodyPx(r, g, b, a) {
  return a >= 250 && !isShadowPx(r, g, b, a);
}

/* 一個動作所有方向、所有幀的聯集範圍，外擴輪廓的寬度（輪廓在本體外面一圈，不能被裁掉） */
function unionTrim(img, ch) {
  const { width, rgba } = img;
  let x0 = ch.cell, y0 = ch.cell, x1 = -1, y1 = -1;
  for (let r = 0; r < ch.rows; r++) {
    for (let c = 0; c < ch.cols; c++) {
      for (let y = 0; y < ch.cell; y++) {
        const row = ((r * ch.cell + y) * width + c * ch.cell) * 4;
        for (let x = 0; x < ch.cell; x++) {
          if (rgba[row + x * 4 + 3] === 0) continue;
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
  }
  if (x1 < 0) throw new Error('整張圖是空的');
  const R = ch.outlinePx;
  x0 = Math.max(0, x0 - R); y0 = Math.max(0, y0 - R);
  x1 = Math.min(ch.cell - 1, x1 + R); y1 = Math.min(ch.cell - 1, y1 + R);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/* 裁好的圖集＋同樣版面的輪廓圖集（白色；顏色交給執行期的 tint） */
function buildSheets(img, ch, trim) {
  const { width, rgba } = img;
  const W = trim.w * ch.cols, H = trim.h * ch.rows;
  const body = new Uint8Array(W * H * 4);
  const ring = new Uint8Array(W * H * 4);
  const R = ch.outlinePx;
  const offs = [];
  for (let oy = -R; oy <= R; oy++) {
    for (let ox = -R; ox <= R; ox++) if ((ox || oy) && ox * ox + oy * oy <= R * R + 0.01) offs.push([ox, oy]);
  }
  const mask = new Uint8Array(trim.w * trim.h);
  const solid = new Uint8Array(trim.w * trim.h);
  for (let r = 0; r < ch.rows; r++) {
    for (let c = 0; c < ch.cols; c++) {
      mask.fill(0); solid.fill(0);
      for (let y = 0; y < trim.h; y++) {
        for (let x = 0; x < trim.w; x++) {
          const si = ((r * ch.cell + trim.y + y) * width + c * ch.cell + trim.x + x) * 4;
          const di = ((r * trim.h + y) * W + c * trim.w + x) * 4;
          const R8 = rgba[si], G8 = rgba[si + 1], B8 = rgba[si + 2], A8 = rgba[si + 3];
          body[di] = R8; body[di + 1] = G8; body[di + 2] = B8; body[di + 3] = A8;
          if (isBodyPx(R8, G8, B8, A8)) mask[y * trim.w + x] = 1;
          if (A8 > 0 && !isShadowPx(R8, G8, B8, A8)) solid[y * trim.w + x] = 1;
        }
      }
      /* 輪廓＝本體往外擴 R 的剪影，扣掉角色自己（含半透明的刀光），留下貼著外緣的一圈 */
      for (let y = 0; y < trim.h; y++) {
        for (let x = 0; x < trim.w; x++) {
          if (solid[y * trim.w + x]) continue;
          let hit = false;
          for (let k = 0; k < offs.length && !hit; k++) {
            const sx = x + offs[k][0], sy = y + offs[k][1];
            if (sx >= 0 && sy >= 0 && sx < trim.w && sy < trim.h && mask[sy * trim.w + sx]) hit = true;
          }
          if (!hit) continue;
          const di = ((r * trim.h + y) * W + c * trim.w + x) * 4;
          ring[di] = 255; ring[di + 1] = 255; ring[di + 2] = 255; ring[di + 3] = 255;
        }
      }
    }
  }
  return { W, H, body, ring };
}

function round4(v) { return Math.round(v * 10000) / 10000; }

function build(name, opts) {
  const ch = CHARACTERS[name];
  if (!ch) throw new Error('不認得的角色：' + name + '（可用：' + Object.keys(CHARACTERS).join('、') + '）');
  const lib = libraryRoot.resolveLibraryRoot({ root: opts.root, libraryId: opts.root ? 'effects-materials' : undefined });
  const srcDir = path.join(lib.root, ch.library);
  const outDir = path.join(REPO, ch.out);
  const files = {};                 // 相對 outDir 的檔名 → Buffer
  const manifest = {
    /* 這份檔由 tools/build_character_sprites.cjs 產生，不要手改；改節奏改那支工具的 CHARACTERS */
    generatedBy: 'tools/build_character_sprites.cjs ' + name,
    source: 'effects-materials/' + ch.library,
    frameWidth: ch.cell, frameHeight: ch.cell,
    directions: ch.directions,
    defaultDirection: ch.defaultDirection,
    scale: ch.scale,
    anchorX: round4(ch.pivot.x / ch.cell),
    anchorY: round4(ch.pivot.y / ch.cell),
    smooth: true,                   // 3D 算圖，不是像素畫：縮放用線性取樣
    bakedShadow: true,              // 影子在圖裡，不再另外畫腳下的橢圓
    outlinePx: ch.outlinePx,
    anims: {}
  };
  for (const key of Object.keys(ch.anims)) {
    const a = ch.anims[key];
    if (a.from) {
      manifest.anims[key] = { from: a.from, reverse: !!a.reverse, fps: a.fps, loop: !!a.loop };
      if (a.first) manifest.anims[key].first = a.first;
      continue;
    }
    const buf = fs.readFileSync(path.join(srcDir, a.src));
    const img = raster.decodePng(buf);
    if (img.width !== ch.cell * ch.cols || img.height !== ch.cell * ch.rows) {
      throw new Error(a.src + ' 是 ' + img.width + '×' + img.height + '，預期 ' +
        (ch.cell * ch.cols) + '×' + (ch.cell * ch.rows) + '（' + ch.cols + ' 幀 × ' + ch.rows + ' 方向）');
    }
    const trim = unionTrim(img, ch);
    const sheets = buildSheets(img, ch, trim);
    const imageName = key + '.png';
    const outlineName = key + '.outline.png';
    files[imageName] = raster.encodePng(sheets.body, sheets.W, sheets.H);
    files[outlineName] = raster.encodePng(sheets.ring, sheets.W, sheets.H);
    const entry = { image: imageName, outline: outlineName, source: a.src, trim: trim, frames: ch.cols, fps: a.fps, loop: !!a.loop };
    if (a.first) entry.first = a.first;
    if (a.release) {
      if (!(a.release > (a.first || 0) && a.release < ch.cols)) throw new Error(key + ' 的 release 要在 first 之後、幀數之內');
      entry.release = a.release;
    }
    if (a.hold) entry.hold = true;
    if (a.strideSpeed) entry.strideSpeed = a.strideSpeed;
    manifest.anims[key] = entry;
  }
  for (const key of Object.keys(manifest.anims)) {
    const from = manifest.anims[key].from;
    if (from && !(manifest.anims[from] && manifest.anims[from].image)) throw new Error(key + ' 的 from 指到不存在的動作：' + from);
    const first = manifest.anims[key].first;
    if (from && first && !(first >= (manifest.anims[from].first || 0) && first < manifest.anims[from].frames)) {
      throw new Error(key + ' 的 first 要在 ' + from + ' 的 first 之後、幀數之內');
    }
  }
  files[ch.manifest] = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  const changed = Object.keys(files).filter(function (f) {
    const p = path.join(outDir, f);
    return !fs.existsSync(p) || !fs.readFileSync(p).equals(files[f]);
  });
  if (opts.check) return { changed: changed, outDir: outDir };
  fs.mkdirSync(outDir, { recursive: true });
  changed.forEach(function (f) { fs.writeFileSync(path.join(outDir, f), files[f]); });
  return { changed: changed, outDir: outDir, manifest: manifest };
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const opts = { check: false, root: null };
  let name = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check') opts.check = true;
    else if (argv[i] === '--root') opts.root = argv[++i];
    else name = argv[i];
  }
  if (!name) {
    console.error('用法：node tools/build_character_sprites.cjs <角色> [--check] [--root <素材庫>]');
    console.error('角色：' + Object.keys(CHARACTERS).join('、'));
    process.exit(2);
  }
  try {
    const res = build(name, opts);
    if (opts.check) {
      if (res.changed.length) {
        console.error('與素材庫產生的結果不同：' + res.changed.join('、'));
        process.exit(1);
      }
      console.log('一致：' + path.relative(REPO, res.outDir));
    } else {
      console.log((res.changed.length ? '已更新：' + res.changed.join('、') : '沒有變動') + '（' + path.relative(REPO, res.outDir) + '）');
    }
  } catch (e) {
    console.error(e.hint ? e.message + '\n' + e.hint : (e && e.message || e));
    process.exit(1);
  }
}

module.exports = { CHARACTERS: CHARACTERS, build: build, isShadowPx: isShadowPx, isBodyPx: isBodyPx, unionTrim: unionTrim };
