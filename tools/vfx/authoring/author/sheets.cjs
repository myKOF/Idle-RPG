'use strict';
/* sheets.cjs — 序列幀（sprite sheet）Preset 製作腳本

   與其他家族腳本的差別：這裡的動畫**在素材裡**，不在曲線裡。
   一張圖集就是一整段動畫，程式只負責決定它多大、播多久、疊什麼。
   所以這些 preset 的圖層數會非常少（常常只有一層），與 hits/bursts 那種
   「用五六層靜圖疊出動態」的作法是兩種完全不同的路子。

   格線不從素材推：一張 3102×2585 的圖，Core 沒有辦法知道它是 6×5 還是 9×7。
   來源檔名把每格尺寸寫在後面（`..._517x517.png`），格數＝圖寬/格寬 × 圖高/格高。

   ⚠️ 60fps 版是 9×7＝63 格但只用 60 格（1 秒），尾端三格是空白——
   那正是 sheet.count 存在的理由。 */
const kit = require('../preset-kit.cjs');
const { A, sprite } = kit;

/* 素材：CodeManu「VFX Free Pack」（OpenGameArt，CC0，不需標註）。
   30fps 版：6×5＝30 格，正好 1 秒。60fps 版格數多一倍但畫面內容相同，
   在 Web 上 30fps 已經夠——多一倍的格數等於多一倍的 VRAM。 */
const EXPLOSION_30 = 'spritemancer-vfx/30fps/effect_explosion_1_517x517.png';

const P = {};

/* ---------- burst-explosion-sheet：序列幀爆炸 ----------
   對照組是 burst-fire（八層靜圖 ＋ 曲線 ＋ 子發射器）。這一份只有一層。

   duration 1.0＝素材本身的長度。改短會讓動畫加速播完（mode 'life' 是把整份
   序列攤在生命週期上），改長則變慢——這是這一類 preset 唯一的節奏旋鈕。

   blend 用 normal 不用 add：這張圖是有完整 alpha 的彩色畫，不是灰階遮罩。
   用 add 的話煙的灰色會變成發光的霧，白色核心會過曝成一片死白。 */
P['burst-explosion-sheet'] = () => ({
  id: 'burst-explosion-sheet', duration: 1,
  layers: [
    sprite({
      id: 'boom', asset: EXPLOSION_30, z: 0,
      /* 名目尺寸與 burst 家族一致（直徑 200px＝半徑 100）。
         素材裡的爆炸大約佔滿格子的七成，所以格子要開大一點才對得上名目半徑。 */
      size: 290, alpha: 1, blend: 'normal',
      sheet: { columns: 6, rows: 5, mode: 'life' },
      /* 尾端淡出：素材最後一格仍有淡煙，硬切會看到它突然消失。 */
      alphaOverLife: [[0, 1], [0.85, 1], [1, 0]]
    })
  ]
});

const written = [];
const probes = [];
Object.keys(P).forEach((id) => {
  const preset = P[id]();
  kit.write(preset);
  written.push(id);
  probes.push(kit.probe(id));
});
console.log(JSON.stringify({ written: written, probes: probes }, null, 1));
