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

   顯示文字一律用 String 表編號（AI_RULES 8.10），不在這裡寫字。
   ============================================================================= */
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
  }
};
