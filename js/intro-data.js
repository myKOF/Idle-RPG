/* =============================================================================
   intro-data.js — 開頭動畫的時間軸資料（播放器見 js/intro-player.js）
   -----------------------------------------------------------------------------
   一條時間軸 = 一組圖層，每個圖層在 [at, at+dur) 期間出現，前後各自淡入淡出，
   期間由 from 移動到 to。全部轉成 Web Animations，只動 transform 與 opacity，
   由合成器執行。

   時間軸欄位：
     duration   總長（毫秒）；省略時取圖層最晚結束的時間
     skippable  可否略過（預設 true）
     skipDelay  略過按鈕延遲多久出現（毫秒，預設 500）
     holdAt     啟用停格時等待 release() 的時間點（毫秒，選填）。停格點之後只該剩淡出。
     layers     圖層陣列，依序疊放（後面的在上層）

   圖層欄位：
     kind      'text'（文字，讀 String 表）| 'image'（圖片）| 'shape'（純 CSS 圖形）
     str       kind=text：String 表編號；args＝STR 的參數陣列（選填）
     src       kind=image：圖片路徑（含 ?v=）
     cls       額外的 CSS class（外觀寫在 css/intro.css）
     place     'full'（滿版，image／shape 預設）| 'center'（置中，text 預設）| 'caption'（下方旁白區，可換行）
     at, dur   出現時間與持續時間（毫秒）
     fadeIn, fadeOut  淡入／淡出長度（毫秒，預設 400；0＝硬切）
     from, to  { x, y, scale, sx, sy, rotate }：x／y 單位為 vw／vh，rotate 單位為度；
               sx／sy 分別縮放寬高（省略時取 scale）；省略的欄位取預設 0／1
     easing    移動的緩動（預設 'ease-in-out'）

   設置重播的成片以 video 指定來源，duration 提供載入或播放卡住時的保底時間。
   顯示文字一律用 String 表編號（AI_RULES 8.10），不在這裡寫字。
   ============================================================================= */
var INTRO_REPLAY_TIMELINE = {
  video: 'images/intro-parchment/shot-01-03.mp4?v=1',
  duration: 30300
};

var INTRO_PROLOGUE_CAPTIONS = [
  {
    "str": 2414,
    "at": 350,
    "dur": 5250
  },
  {
    "str": 2415,
    "at": 6250,
    "dur": 6200
  },
  {
    "str": 2416,
    "at": 13300,
    "dur": 7200
  },
  {
    "str": 2417,
    "at": 21100,
    "dur": 7800
  }
];
var INTRO_TIMELINES = {
  /* 短標題預覽。所有圖層同在 2.6 秒結束。 */
  title: {
    duration: 2600,
    holdAt: 1900,
    skipDelay: 400,
    layers: [
      { kind: 'shape', cls: 'intro-shape-stars', at: 0, dur: 2600, fadeIn: 600, fadeOut: 500,
        from: { scale: 1 }, to: { scale: 1.04 } },
      { kind: 'shape', cls: 'intro-shape-glow', at: 150, dur: 2450, fadeIn: 800, fadeOut: 500,
        from: { scale: 0.7 }, to: { scale: 1.05 }, easing: 'ease-out' },
      { kind: 'text', str: 2411, cls: 'intro-text-logo', at: 250, dur: 2350, fadeIn: 800, fadeOut: 500,
        from: { y: -1, scale: 1.08 }, to: { y: -2.5, scale: 1 }, easing: 'ease-out' },
      { kind: 'shape', cls: 'intro-shape-rule', place: 'center', at: 700, dur: 1900, fadeIn: 500, fadeOut: 500,
        from: { y: 4, sx: 0.1, sy: 1 }, to: { y: 4, sx: 1, sy: 1 }, easing: 'ease-out' },
      { kind: 'text', str: 2412, cls: 'intro-text-logo-sub', at: 800, dur: 1800, fadeIn: 600, fadeOut: 500,
        from: { y: 8 }, to: { y: 7 }, easing: 'ease-out' }
    ]
  },

  /* 依 docs/dark_fantasy_opening_animation_script_v2.md：30 秒、四幕。
     原創繪景＋合成器推鏡／沙塵／羽芒，最後一幕由掌心拉遠、起身迎敵。
     使用者修訂：殘破銀白聖甲、縮小人物、三對巨大六翼；全幅保留羽翼。
     依使用者續修只保留四句字幕，沒有語音／人聲；字幕共用String與時序；2D分件與粒子共用播放器時鐘。
     29秒待UI，最後1秒淡入實際HUD。 */
  prologue: {
    duration: 30000,
    holdAt: 29000,
    skipDelay: 1200,
    cinematic: true,
    revealDuration: 1000,
    audio: { music: 'audio/intro/prologue-music.wav?v=1', sfx: 'audio/intro/prologue-sfx.wav?v=1' },
    scenes: [
      { id: 'heaven_collapse', at: 0, dur: 6000, camera: 'pan_down_from_sky' },
      { id: 'angel_fall', at: 6000, dur: 7000, camera: 'fast_tracking_shot_following_meteor' },
      { id: 'desolate_human_world', at: 13000, dur: 8000, camera: 'slow_dolly_forward' },
      { id: 'rise_and_quest', at: 21000, dur: 9000, camera: 'push_out_to_gameplay_perspective' }
    ],
    layers: [
      // 0–6：鏡頭下移，神殿碎裂、裂隙吞噬聖光。
      { kind: 'image', src: 'images/intro/heaven-collapse.webp?v=1', cls: 'intro-image-cinema',
        at: 0, dur: 6600, fadeIn: 900, fadeOut: 600,
        from: { y: -1.5, scale: 1 }, to: { y: 1.5, scale: 1 }, easing: 'linear' },
      { kind: 'shape', cls: 'intro-infernal-glow', at: 1400, dur: 4800, fadeIn: 1600, fadeOut: 500,
        from: { scale: 0.65 }, to: { scale: 1.3 } },
      { kind: 'shape', cls: 'intro-embers', at: 1700, dur: 4400, fadeIn: 700, fadeOut: 600,
        from: { y: -6, x: -2 }, to: { y: 9, x: 3 }, easing: 'linear' },
      { kind: 'motion', motion: 'heaven', at: 0, dur: 6600, fadeIn: 900, fadeOut: 600, from: { y: -1.5 }, to: { y: 1.5 }, easing: 'linear' },
      // 6–13：跟隨負傷六翼天使墜下；羽芒掠過，落地揚塵。
      { kind: 'image', src: 'images/intro-v2/angel-fall-background.webp?v=1', cls: 'intro-image-cinema',
        at: 6000, dur: 7500, fadeIn: 600, fadeOut: 500,
        from: { y: -2 }, to: { y: 2 }, easing: 'cubic-bezier(.32,.1,.72,1)' },
      { kind: 'motion', motion: 'fall', src: 'images/intro-v2/angel-fall-angel.webp?v=1', at: 6000, dur: 7500, fadeIn: 600, fadeOut: 500, from: { y: -2 }, to: { y: 2 }, easing: 'cubic-bezier(.32,.1,.72,1)' },
      { kind: 'shape', cls: 'intro-feather-trails', at: 6500, dur: 5700, fadeIn: 900, fadeOut: 800,
        from: { x: -6, y: 12 }, to: { x: 6, y: -18 }, easing: 'ease-in' },
      { kind: 'shape', cls: 'intro-impact', at: 12200, dur: 1300, fadeIn: 180, fadeOut: 1000,
        from: { scale: 0.2, y: 15 }, to: { scale: 2.6, y: 0 }, easing: 'ease-out' },
      // 13–21：平視慢推荒漠，骨骸、廢拱門與幽火。
      { kind: 'image', src: 'images/intro/desolate-human-world.webp?v=1', cls: 'intro-image-cinema',
        at: 13000, dur: 8500, fadeIn: 650, fadeOut: 500,
        from: { scale: 0.94 }, to: { scale: 1 }, easing: 'linear' },
      { kind: 'motion', motion: 'wasteland', at: 13000, dur: 8500, fadeIn: 650, fadeOut: 500, from: { scale: .94 }, to: { scale: 1 }, easing: 'linear' },
      { kind: 'shape', cls: 'intro-sand-haze', at: 13000, dur: 8500, fadeIn: 900, fadeOut: 600,
        from: { x: -9 }, to: { x: 9 }, easing: 'linear' },
      { kind: 'shape', cls: 'intro-ghost-lights', at: 14200, dur: 6900, fadeIn: 1400, fadeOut: 900,
        from: { y: 2, scale: 0.96 }, to: { y: -2, scale: 1.02 }, easing: 'linear' },
      // 21–26：掌心聖光特寫拉遠，顯出殘破銀白聖甲與巨大六翼。
      { kind: 'image', src: 'images/intro-v2/awakening-background.webp?v=1', cls: 'intro-image-cinema intro-image-awakening',
        at: 21000, dur: 5700, fadeIn: 650, fadeOut: 700,
        from: { y: -6, scale: 2.25 }, to: { y: 0, scale: 1 }, easing: 'ease-out' },
      { kind: 'motion', motion: 'awakening', src: 'images/intro-v2/awakening-angel.webp?v=1', at: 21000, dur: 4100, fadeIn: 650, fadeOut: 700, from: { y: -6, scale: 2.25 }, to: { y: 0, scale: 1 }, easing: 'ease-out' },
      { kind: 'shape', cls: 'intro-sacred-light', at: 21300, dur: 5200, fadeIn: 1100, fadeOut: 1000,
        from: { scale: 0.18 }, to: { scale: 1.1 }, easing: 'ease-out' },
      { kind: 'motion', motion: 'rising', src: 'images/intro-v2/rising-angel.webp?v=1', at: 24400, dur: 2300, fadeIn: 700, fadeOut: 700 },
      // 26–30：拾劍站起，面對幽靈；整層淡出露出已準備好的真正UI。
      { kind: 'image', src: 'images/intro-v2/rise-and-quest-background.webp?v=1', cls: 'intro-image-cinema',
        at: 26000, dur: 4000, fadeIn: 700, fadeOut: 0,
        from: { scale: 1 }, to: { scale: 0.96 }, easing: 'ease-out' },
      { kind: 'motion', motion: 'standing', src: 'images/intro-v2/rise-and-quest-angel.webp?v=1', at: 26000, dur: 4000, fadeIn: 700, fadeOut: 0, from: { scale: 1 }, to: { scale: .96 }, easing: 'ease-out' },
      { kind: 'shape', cls: 'intro-dawn-rays', at: 26400, dur: 3600, fadeIn: 1200, fadeOut: 0,
        from: { scale: 0.85 }, to: { scale: 1.1 }, easing: 'ease-out' },
      { kind: 'shape', cls: 'intro-cinema-vignette', at: 0, dur: 30000, fadeIn: 600, fadeOut: 0 }
    ].concat(INTRO_PROLOGUE_CAPTIONS.map(function (cue) { return { kind: 'text', str: cue.str, cls: 'intro-text-caption intro-v2-caption', place: 'caption', at: cue.at, dur: cue.dur, fadeIn: 300, fadeOut: 350 }; }))
  },

  /* 框架驗證用佔位鏡頭：網址帶 ?intro=test 才會播，玩家不會看到。
     驗證四件事：圖片推鏡、純 CSS 圖形、String 表文字、前後疊層與淡入淡出。 */
  test: {
    duration: 7000,
    layers: [
      { kind: 'shape', cls: 'intro-shape-stars', at: 0, dur: 7000, fadeIn: 600, fadeOut: 600,
        from: { scale: 1 }, to: { scale: 1.08 } },
      { kind: 'image', src: 'images/world-map/salvien.png?v=1', cls: 'intro-image-cover',
        at: 0, dur: 4600, fadeIn: 900, fadeOut: 900,
        from: { x: -3, y: 1, scale: 1.25 }, to: { x: 3, y: -1, scale: 1.08 } },
      { kind: 'shape', cls: 'intro-shape-glow', at: 3600, dur: 3400, fadeIn: 700, fadeOut: 500,
        from: { scale: 0.6 }, to: { scale: 1.4 }, easing: 'ease-out' },
      { kind: 'text', str: 48, cls: 'intro-text-title', at: 4000, dur: 3000, fadeIn: 800, fadeOut: 500,
        from: { y: 2 }, to: { y: 0 }, easing: 'ease-out' }
    ]
  },

  /* 繪本式序章（重製中，目前只有第一鏡，待使用者確認後再往下做；GM：intro storybook）。
     舊書頁上的墨線插畫，背景各層與天使各部位拆開控制（js/intro-scene.js）：
       鏡頭：整頁由近拉遠
       背景：天光放射線慢轉＋呼吸、遠／中／近三層雲帶不同速度、反方向視差漂移
       天使：整體由上降下再緩緩浮動；兩對翅膀由收合展開後以肩胛為軸各自擺動（上下翼相位錯開）；
             披風以肩線為軸搖曳、劍微幅晃動、劍光沿劍刃滑過、光環浮動、背後光暈呼吸
       前景：金色微塵上飄、書頁焦邊與墨線邊框
     素材：images/intro-storybook/（tools/intro/storybook-paper.py、storybook-art.cjs 原創程序生成）。
     座標：1920×1080 設計座標；天使群組內座標以 600×840 的本體圖為準（上翼肩胛約在 (262, 190)／(338, 190)，下翼約在 (275, 300)／(325, 300)，握劍的拳在 (185, 478)）。 */
  storybook: {
    duration: 10000,
    skipDelay: 800,
    layers: [
      { kind: 'scene', at: 0, dur: 10000, fadeIn: 1200, fadeOut: 900,
        camera: { origin: '50% 45%', easing: 'cubic-bezier(.25,.1,.25,1)',
          path: [{ t: 0, scale: 1.1, y: 30 }, { t: 1, scale: 1, y: 0 }] },
        parts: [
          { id: 'paper', src: 'images/intro-storybook/paper.webp?v=1', cls: 'sb-paper', box: [-60, -40, 2040, 1160] },
          { id: 'rays', src: 'images/intro-storybook/rays.svg?v=3', box: [260, -270, 1400, 1400], at: 300, fadeIn: 1800,
            path: [{ rotate: 0 }, { rotate: 7 }], easing: 'linear',
            loop: { frames: [{ scale: 0.97 }, { scale: 1.03 }], dur: 3200, alternate: true, alpha: [0.72, 1] } },
          { id: 'clouds-far', src: 'images/intro-storybook/clouds-far.svg?v=3', box: [-240, 560, 2400, 360], at: 200, fadeIn: 1600,
            path: [{ x: 0 }, { x: -90 }], easing: 'linear' },
          { id: 'angel', kind: 'group', box: [660, 190, 600, 840], origin: '50% 30%', at: 900, fadeIn: 1500,
            path: [{ t: 0, y: -130, scale: 0.86 }, { t: 0.55, y: 0, scale: 0.9 }, { t: 1, y: 10, scale: 0.9 }], easing: 'ease-out',
            loop: { frames: [{ y: 0 }, { y: -12 }], dur: 2800, alternate: true },
            children: [
              { id: 'aura', kind: 'shape', cls: 'sb-aura', box: [-100, -140, 800, 800],
                loop: { frames: [{ scale: 0.94 }, { scale: 1.06 }], dur: 2600, alternate: true, alpha: [0.45, 0.7] } },
              { id: 'wing-upper-l', src: 'images/intro-storybook/wing-upper.svg?v=3', box: [-578, -280, 900, 780], origin: '93.3% 60.3%',
                path: [{ t: 0, rotate: 32 }, { t: 0.42, rotate: -5 }, { t: 0.6, rotate: 0 }], easing: 'ease-out',
                loop: { frames: [{ rotate: 0 }, { rotate: -4 }], dur: 3000, alternate: true } },
              { id: 'wing-upper-r', src: 'images/intro-storybook/wing-upper.svg?v=3', flip: true, box: [278, -280, 900, 780], origin: '6.7% 60.3%',
                path: [{ t: 0, rotate: -32 }, { t: 0.42, rotate: 5 }, { t: 0.6, rotate: 0 }], easing: 'ease-out',
                loop: { frames: [{ rotate: 0 }, { rotate: 4 }], dur: 3000, alternate: true } },
              { id: 'wing-lower-l', src: 'images/intro-storybook/wing-lower.svg?v=3', box: [-375, 210, 700, 620], origin: '92.9% 14.5%',
                path: [{ t: 0, rotate: -26 }, { t: 0.5, rotate: 3 }, { t: 0.66, rotate: 0 }], easing: 'ease-out',
                loop: { frames: [{ rotate: 0 }, { rotate: 5 }], dur: 3400, alternate: true, phase: 0.5 } },
              { id: 'wing-lower-r', src: 'images/intro-storybook/wing-lower.svg?v=3', flip: true, box: [275, 210, 700, 620], origin: '7.1% 14.5%',
                path: [{ t: 0, rotate: 26 }, { t: 0.5, rotate: -3 }, { t: 0.66, rotate: 0 }], easing: 'ease-out',
                loop: { frames: [{ rotate: 0 }, { rotate: -5 }], dur: 3400, alternate: true, phase: 0.5 } },
              { id: 'cape', src: 'images/intro-storybook/cape.svg?v=3', box: [0, 0, 600, 840], origin: '50% 28%',
                loop: { frames: [{ rotate: -1.4 }, { rotate: 1.4 }], dur: 3600, alternate: true } },
              { id: 'sword', src: 'images/intro-storybook/sword.svg?v=3', box: [-65, 438, 300, 460], origin: '83.3% 8.7%',
                loop: { frames: [{ rotate: -1.2 }, { rotate: 1.2 }], dur: 4200, alternate: true, phase: 0.3 } },
              { id: 'body', src: 'images/intro-storybook/body.svg?v=3', box: [0, 0, 600, 840] },
              { id: 'halo', src: 'images/intro-storybook/halo.svg?v=3', box: [180, -20, 240, 80],
                loop: { frames: [{ y: 0 }, { y: -5 }], dur: 2200, alternate: true, phase: 0.3, alpha: [0.8, 1] } },
              { id: 'glint', kind: 'shape', cls: 'sb-glint', box: [121, 521, 60, 60], at: 3700, dur: 900, fadeIn: 150, fadeOut: 350,
                path: [{ x: 0, y: 0, scale: 0.6 }, { x: -134, y: 291, scale: 1.2 }] }
            ] },
          { id: 'clouds-mid', src: 'images/intro-storybook/clouds-mid.svg?v=3', box: [-240, 760, 2400, 400], at: 500, fadeIn: 1600,
            path: [{ x: 0 }, { x: 130 }], easing: 'linear' },
          { id: 'clouds-near', src: 'images/intro-storybook/clouds-near.svg?v=3', box: [-340, 880, 2600, 460], at: 300, fadeIn: 1400,
            path: [{ x: 0 }, { x: -240 }], easing: 'linear' },
          { id: 'motes', kind: 'particles', cls: 'sb-mote', box: [360, 160, 1200, 820], at: 1400, fadeIn: 1200,
            count: 26, seed: 7, size: [4, 11], rise: [180, 380], drift: [20, 70], dur: [4500, 8000] },
          { id: 'frame', src: 'images/intro-storybook/frame.svg?v=3', box: [0, 0, 1920, 1080] },
          { id: 'paper-edge', src: 'images/intro-storybook/paper-edge.webp?v=1', box: [-60, -40, 2040, 1160] },
          { id: 'caption', kind: 'text', str: 2482, cls: 'sb-ink-text', box: [260, 885, 1400, 150], at: 2600, dur: 6300, fadeIn: 900, fadeOut: 700,
            path: [{ y: 6 }, { y: 0 }], easing: 'ease-out' }
        ] }
    ]
  }
};
