# UI 音效

2026-11-06 起，所有介面的滑鼠懸停、鍵盤焦點及觸控按下都不播放觸碰音。日後依使用者新指示逐一接入指定位置。試聽素材保存在 `audio/ui-preview`。

| 使用音檔 | 播放時機 |
| --- | --- |
| audio/ui-preview/hover-options-v5/H10.wav | 使用者選定的「上揚短啵」，0.06秒，取代C3作點擊音；在同一可操作目標的真實click事件播放，涵蓋滑鼠、觸控完成點擊、原生鍵盤啟動。不以pointerdown冒充點擊，取消碰觸不播點擊音；純tips、停用／右鍵／程式合成click及背景靜音。 |
| audio/ui-preview/05-success.wav | 玩家操作裝備強化且Worker回覆ok；洗煉詞條且Worker回覆成功null。只進入洗煉模式、選詞條不播成功音。 |
| audio/achievements/mixkit-game-level-completed-2059.wav | 成就Worker notice經AchievementUI驗證id後，隨達成提示實際顯示時播放一次；沿用既有提示佇列，間隔4秒，不截短約3.542秒的原檔。清單重繪、開啟成就頁及讀檔既有成就不播放。 |

UI 音效模組只載入上表三份音檔。`js/ui-sound.js` 在主執行緒委派點擊事件，涵蓋動態建立的控制項。`js/ui.js` 的 `detailAction` 在確認 Worker 結果成功後交由音效模組播放。

首次真實按下或按鍵後，瀏覽器才建立及解鎖 AudioContext。點擊音以 80 ms 節流，每種音效最多一個播放來源。切至背景會停止播放並丟棄待播聲音，音訊失敗時仍可操作介面。

來源及保存：原素材庫Commit4cfb1cc、遊戲試聽Commit3e697e1b，製作工具tools/audio/ui-preview.cjs可重產。01-hover SHA256為411211856bdcc43ec4c1d534f29720eac208278872aa1fc71eb8e27dcd3b453c，05-success為4821e4b49aad96afc57c3c9a9508dc7835c938b7d82a119fcc04e66cc9cd1a14。H10沿用素材庫d01e230／遊戲0eebd1ed原檔，SHA256 338a16bc9ce91a90b3b081e25e93306b5830eefa05fbba780c85d8f9f94b9f37，tools/audio/ui-hover-options.cjs可重產；主端URL均帶相同雜湊前綴避免舊快取。C3仍保留在原候選目錄，不再預載。

成就音效為使用者提供的 Mixkit「Game level completed」（項目 2059）。原檔為 44100 Hz、16-bit 立體聲，SHA256 為 8da83b49ceb580493ba7c7081ec3d176fe069d4505474b604f6fb08b339bd32a。`tools/audio/import-achievement-sound.cjs` 保存至素材庫 `third-party/mixkit/achievement-completed-2059`，並原樣匯出，兩庫附 README 與 manifest。2026-11-05 核對授權可整合遊戲成品，須保留第三方權利及素材散布限制。[官方來源](https://mixkit.co/free-sound-effects/game/) · [Sound Effects Free License](https://mixkit.co/license/modal/sfxFree/)
