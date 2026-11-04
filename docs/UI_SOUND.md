# UI音效（2026-11-04使用者核准範圍）

已接入三份核准的自製WAV（原觸碰、2026-11-05選定的H10點擊、原成功音）與一份使用者指定的第三方成就音效，皆保留原音色與音量；觸碰音保持。試聽檔與製作說明在audio/ui-preview；本文件記錄後續接入授權，優先於試聽時的歷史狀態。

| 使用音檔 | 播放時機 |
| --- | --- |
| audio/ui-preview/01-hover.wav | 所有可操作的UI（執行功能、開啟介面、選取／裝配等），有tips亦播放；包含熔爐升級／零件／紀錄詳情、背包裝備選取、寶石／符文操作、詞條／孔位選取、label開關與說明!／?／i。只有純查看而無操作功能的tips靜音；停用控制項也靜音。鍵盤焦點、觸控碰觸共用相同篩選。 |
| audio/ui-preview/hover-options-v5/H10.wav | 使用者選定的「上揚短啵」，0.06秒，取代C3作點擊音；在同一可操作目標的真實click事件播放，涵蓋滑鼠、觸控完成點擊、原生鍵盤啟動。不以pointerdown冒充點擊，取消碰觸不播點擊音；純tips、停用／右鍵／程式合成click及背景靜音。 |
| audio/ui-preview/05-success.wav | 玩家操作裝備強化且Worker回覆ok；洗煉詞條且Worker回覆成功null。只進入洗煉模式、選詞條不播成功音。 |
| audio/achievements/mixkit-game-level-completed-2059.wav | 成就Worker notice經AchievementUI驗證id後，隨達成提示實際顯示時播放一次；沿用既有提示佇列，間隔4秒，不截短約3.542秒的原檔。清單重繪、開啟成就頁及讀檔既有成就不播放。 |

原點擊02-click、C3、洗煉專用03-reroll、神鑄04-divine-forge、失敗06-failure與合輯皆未載入；神鑄結果、其他養成、任務、戰鬥與自動強化也不播放成功音。神鑄UI本身的觸碰／點擊使用核准音色；H6～H9仍只供試聽，H10用於點擊，沒有替換現行hover。

js/ui-sound.js只在主執行緒處理DOM事件與播放；js/ui.js的detailAction於確認無結果錯誤後傳遞成功結果。模擬、權威數值、存檔與Worker協議不變，不加聲音設定／玩家文字。事件委派涵蓋動態建立的節點；停在同格的圖示／文字、靜止游標底下重繪、捲動、拖曳不重複觸發。觸碰音有80ms節流，每種聲音最多一個播放來源，背景停止並丟棄尚未播出的聲音；音訊失敗不阻止原操作。

最終判定依使用者補充的「可操作」語意，取代上一版有tips即靜音的過度排除。以原生／ARIA控制項與既有事件委派的action標記識別，不以tips屬性、游標或單純卡片外觀推定功能。裝備背包格可選取所以有音，輸送帶裝備僅查看tips所以無音；熔爐升級金幣按鈕、零件卸下／開列表／解鎖／裝配、紀錄詳情均有音，熔爐圖與零件工坊左側純說明無音。可操作元件內的tips文字／圖示視為同一操作，純tips內若有實際按鈕則該按鈕仍有音。

瀏覽器限制：首次實際點擊／碰觸或按鍵後才建立及解鎖AudioContext。第一次互動前的純滑鼠懸停可能無聲；解鎖後正常播放。不排隊補播過期聲音，初次音檔尚在載入時可能略過該次觸碰。

來源及保存：原素材庫Commit4cfb1cc、遊戲試聽Commit3e697e1b，製作工具tools/audio/ui-preview.cjs可重產。01-hover SHA256為411211856bdcc43ec4c1d534f29720eac208278872aa1fc71eb8e27dcd3b453c，05-success為4821e4b49aad96afc57c3c9a9508dc7835c938b7d82a119fcc04e66cc9cd1a14。H10沿用素材庫d01e230／遊戲0eebd1ed原檔，SHA256 338a16bc9ce91a90b3b081e25e93306b5830eefa05fbba780c85d8f9f94b9f37，tools/audio/ui-hover-options.cjs可重產；主端URL均帶相同雜湊前綴避免舊快取。C3仍保留在原候選目錄，不再預載。

成就音效為使用者提供的Mixkit「Game level completed」（項目2059），非Codex自製。2026-11-05核對[官方來源](https://mixkit.co/free-sound-effects/game/)及[Sound Effects Free License](https://mixkit.co/license/modal/sfxFree/)可整合遊戲成品，保留第三方權利與禁止素材再散布限制。原檔44100Hz／16-bit立體聲、SHA256 8da83b49ceb580493ba7c7081ec3d176fe069d4505474b604f6fb08b339bd32a；未轉碼或調整音量。tools/audio/import-achievement-sound.cjs保存到素材庫third-party/mixkit/achievement-completed-2059後原樣匯出，雙庫附README／manifest。首次真實手勢預載4份核准音檔；成就音同樣遵守背景停止、短期過期與失敗略過，不在稍後解鎖音訊時補播。
