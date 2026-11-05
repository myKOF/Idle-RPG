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
     layers     圖層陣列，依序疊放（後面的在上層）

   圖層欄位：
     kind      'text'（文字，讀 String 表）| 'image'（圖片）| 'shape'（純 CSS 圖形）
     str       kind=text：String 表編號；args＝STR 的參數陣列（選填）
     src       kind=image：圖片路徑（含 ?v=）
     cls       額外的 CSS class（外觀寫在 css/intro.css）
     place     'full'（滿版，image／shape 預設）| 'center'（置中，text 預設）
     at, dur   出現時間與持續時間（毫秒）
     fadeIn, fadeOut  淡入／淡出長度（毫秒，預設 400；0＝硬切）
     from, to  { x, y, scale, rotate }：x／y 單位為 vw／vh，rotate 單位為度；省略的欄位取預設 0／1
     easing    移動的緩動（預設 'ease-in-out'）

   顯示文字一律用 String 表編號（AI_RULES 8.10），不在這裡寫字。
   ============================================================================= */
var INTRO_TIMELINES = {
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
