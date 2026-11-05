/* =============================================================================
   intro-data.js — 開頭動畫的時間軸資料（播放器見 js/intro-player.js）
   -----------------------------------------------------------------------------
   一條時間軸 = 一組圖層，每個圖層在 [at, at+dur) 期間出現，前後各自淡入淡出，
   期間由 from 移動到 to。全部轉成 Web Animations，只動 transform 與 opacity，
   由合成器執行——開機時主執行緒忙著 initUI／建場景，動畫也不會跟著卡。

   時間軸欄位：
     duration   總長（毫秒）；省略時取圖層最晚結束的時間
     skippable  可否略過（預設 true）
     skipDelay  略過按鈕延遲多久出現（毫秒，預設 500）
     holdAt     開機播放時的停格點（毫秒，選填）：播到這裡載入還沒好就停住等，好了才播完收尾。
                停格點之後只該剩淡出，停住的那一格就是玩家等載入時看到的畫面
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
var INTRO_TIMELINES = {
  /* 標題開場：每次啟動都播（js/intro-player.js chooseStartupTimeline）。
     與載入重疊進行：1.9 秒停格點時載入已好就直接淡出接遊戲，沒好就停在完整標題＋載入圓點。
     載入很快時總共 2.6 秒。所有圖層同在 2.6 秒結束，停格點之後只剩 0.5 秒淡出。 */
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

  /* 序章：新玩家第一次開機播一次（之後只播 title），設定「說明」頁可重播。28 秒、五個鏡頭：
       1  0.0–5.2s  黑幕星點與神光：世界之名
       2  4.4–16.6s 人界地圖推鏡：眾神秩序
       3 10.6–16.6s 暗紫霧氣從地圖四周侵蝕：魔物甦醒
       4 16.0–22.2s 主角肖像（遊戲內頭像 icon_avatar.png）與劍光：騎士登場
       5 21.4–28.0s 標題（同 title 的構圖）＋最後一句旁白；27.2 秒停格等載入
     旁白文字在 String 表 2414–2418。素材只用遊戲內已在使用的圖（世界地圖、主角頭像）。 */
  prologue: {
    duration: 28000,
    holdAt: 27200,
    skipDelay: 1200,
    layers: [
      // 鏡頭 1
      { kind: 'shape', cls: 'intro-shape-stars', at: 0, dur: 5200, fadeIn: 800, fadeOut: 800,
        from: { scale: 1 }, to: { scale: 1.06 } },
      { kind: 'shape', cls: 'intro-shape-glow', at: 500, dur: 4500, fadeIn: 1400, fadeOut: 800,
        from: { scale: 0.5 }, to: { scale: 1.1 }, easing: 'ease-out' },
      { kind: 'text', str: 2414, cls: 'intro-text-caption', place: 'caption', at: 900, dur: 3900, fadeIn: 700, fadeOut: 600,
        from: { y: 1 }, to: { y: 0 }, easing: 'ease-out' },
      // 鏡頭 2、3：地圖一路推到霧氣吞沒
      { kind: 'image', src: 'images/world-map/salvien.png?v=1', cls: 'intro-image-cover',
        at: 4400, dur: 12200, fadeIn: 1200, fadeOut: 1000,
        from: { x: 4, y: 2, scale: 1.32 }, to: { x: -2, y: -1, scale: 1.04 }, easing: 'linear' },
      { kind: 'text', str: 2415, cls: 'intro-text-caption', place: 'caption', at: 5400, dur: 5000, fadeIn: 700, fadeOut: 600,
        from: { y: 1 }, to: { y: 0 }, easing: 'ease-out' },
      { kind: 'shape', cls: 'intro-shape-shadow', at: 10600, dur: 6000, fadeIn: 2600, fadeOut: 1000 },
      { kind: 'shape', cls: 'intro-shape-fog', at: 10600, dur: 6000, fadeIn: 1600, fadeOut: 1000,
        from: { scale: 2.4 }, to: { scale: 1 }, easing: 'ease-in' },
      { kind: 'text', str: 2416, cls: 'intro-text-caption', place: 'caption', at: 11400, dur: 4600, fadeIn: 700, fadeOut: 600,
        from: { y: 1 }, to: { y: 0 }, easing: 'ease-out' },
      // 鏡頭 4
      { kind: 'image', src: 'images/icon_avatar.png', cls: 'intro-image-portrait', place: 'center',
        at: 16000, dur: 6200, fadeIn: 1400, fadeOut: 900,
        from: { y: 3, scale: 1.16 }, to: { y: 0, scale: 1.02 }, easing: 'ease-out' },
      { kind: 'shape', cls: 'intro-shape-slash', place: 'center', at: 19300, dur: 800, fadeIn: 80, fadeOut: 520,
        from: { sx: 0.05, sy: 1, rotate: -26 }, to: { sx: 1.25, sy: 1, rotate: -26 }, easing: 'ease-out' },
      { kind: 'text', str: 2417, cls: 'intro-text-caption', place: 'caption', at: 16800, dur: 4600, fadeIn: 700, fadeOut: 600,
        from: { y: 1 }, to: { y: 0 }, easing: 'ease-out' },
      // 鏡頭 5：標題（與 title 同構圖），停格點之後只剩淡出
      { kind: 'shape', cls: 'intro-shape-stars', at: 21400, dur: 6600, fadeIn: 1000, fadeOut: 600,
        from: { scale: 1 }, to: { scale: 1.04 } },
      { kind: 'shape', cls: 'intro-shape-glow', at: 21800, dur: 6200, fadeIn: 1000, fadeOut: 600,
        from: { scale: 0.7 }, to: { scale: 1.05 }, easing: 'ease-out' },
      { kind: 'text', str: 2411, cls: 'intro-text-logo', at: 22200, dur: 5800, fadeIn: 1000, fadeOut: 600,
        from: { y: -1, scale: 1.08 }, to: { y: -2.5, scale: 1 }, easing: 'ease-out' },
      { kind: 'shape', cls: 'intro-shape-rule', place: 'center', at: 22800, dur: 5200, fadeIn: 600, fadeOut: 600,
        from: { y: 4, sx: 0.1, sy: 1 }, to: { y: 4, sx: 1, sy: 1 }, easing: 'ease-out' },
      { kind: 'text', str: 2412, cls: 'intro-text-logo-sub', at: 23000, dur: 5000, fadeIn: 700, fadeOut: 600,
        from: { y: 8 }, to: { y: 7 }, easing: 'ease-out' },
      { kind: 'text', str: 2418, cls: 'intro-text-caption', place: 'caption', at: 24000, dur: 4000, fadeIn: 900, fadeOut: 600,
        from: { y: -5 }, to: { y: -6 }, easing: 'ease-out' }
    ]
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
