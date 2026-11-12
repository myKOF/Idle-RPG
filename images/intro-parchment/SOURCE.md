# 羊皮紙序章前三鏡

本資產為使用者確認的分鏡成片。全長 30.30 秒，1920 × 1080，30 fps，H.264 與 AAC 立體聲。第一鏡從天使近景拉遠至天堂戰場，帶出地面與空中的惡魔大軍。第二鏡從 9.00 秒疊化時即開始運動，9.90 秒完全顯露。大天使長帶火仰面墜落，灰煙遮住大半下身，焦紙片沿氣流翻飛。18.90 秒收完群墜尾跡，19.40 秒深淵光點亮起並擴散。20.80 秒由白幕接入第三鏡。第三鏡長 9.50 秒，星點與神光在羊皮紙地圖浮現，暗紫霧從邊緣侵入。25.63 秒光束落在荒漠，紫霧停在圓形神光外緣。鏡頭於 25.98 秒俯衝，27.24 秒穿過沙塵接入地表，最後淡出。

遊戲專案的 `images/intro-parchment/shot-01-03.mp4` 收錄前三鏡，前兩鏡獨立版為 `images/intro-parchment/shot-01-02.mp4`。設定頁重播前三鏡時，配樂共用荒漠第一首 Desert Ascendant，使用獨立演出音效 `shot-01-03-sfx.mp3`。成片保留核准畫面及原混音供封存與預覽。

## 55 秒計畫的加長第一鏡

使用者於 2026-11-13 核准〈天界失守〉魔軍增援版。`web/shot-01-extended.mp4` 保存獨立的 16 秒第一鏡，遊戲副本位於 `images/intro-parchment/shot-01-extended.mp4`。大天使長聽見鐘聲抬頭，兩段拉遠揭露軍勢，11.72 秒塔樓遇襲，聖光熄滅，灰燼掠過前景。城前遠地有 2,673 個遠方剪影及 377 個過渡兵影，三處天空加密 1,213 個遠方翼影及 99 個振翼前鋒。尾畫作為加長第二鏡的疊化接點。

- `extended-shot-one/` 保存鏡頭、突襲、遠近軍勢、字幕、音效與可重製預覽。畫面沿用同一資料夾下 `source/assets/` 的原創分件及 `source/shot-air.js`，本版新增動態合成。Noto Serif TC 沿用素材庫 `third-party/google-fonts/start-menu-20261106` 的授權來源。
- `extended-shot-one/assets/shot-one-effects.wav` 是獨立的 48 kHz 立體聲音效，供後續接鏡。`shot-one-preview.wav` 為含配樂的核准審片混音。配樂讀取素材庫 `third-party/user-supplied/desert-ascendant/desert-ascendant.mp3`。
- 在 `extended-shot-one/` 執行 `node build-audio.cjs` 可重建音效與混音。執行 `node render-shot-one.cjs` 可用 Windows Edge 與 FFmpeg 重製 1920 × 1080、30 fps 的影片，`--stills` 只輸出抽查畫格。可用 `PARCHMENT_FFMPEG` 指定 FFmpeg，`PARCHMENT_REVIEW_DIR` 指定輸出資料夾，預設為系統暫存目錄下的 `idle-rpg-extended-shot-one`。

## 可編輯來源

Effects-Materials 內的 `codex-authored/intro-parchment-shots-20261111` 保存核准成片、可編輯程式、透明分件、雲海和深淵背景、音軌、聲景產生器及提示詞。角色、流光翼、神殿、遠雲、地面敵軍、飛行敵軍、火焰、煙與粒子分開合成。大天使長的頭罩與右手由獨立透明圖接回角色。第二鏡大天使長沿用第一鏡流光翼分件。第三鏡的地圖、荒漠地表、星點、紫霧、光束、圓形神光及沙塵分開合成。

所有入片繪圖均由 ImageGen 原創生成或修訂。使用者提供的天使立繪、姿勢與神殿截圖、指定影片、遊戲內薩爾維恩地圖及使用者圈選的荒漠位置，用於造型、地理與分鏡參考。音軌由本地程序合成。RPG Mote Studio 主要適合像素圖，本案採用適合高解析蝕刻圖與透明分件的 ImageGen。

## 檢視及同步

- 在素材庫開啟 `source/index.html` 可播放、暫停及拖曳時間軸。
- 在素材庫的 `source` 執行 `node build-score.cjs` 與 `node render-video.cjs` 可重製前三鏡有聲 MP4，輸出為 `opening-shots-01-03-desert-ground-dive.mp4`。影片輸出需要 Windows 版 Microsoft Edge 與 FFmpeg。
- `node build-score.cjs --sfx` 可重建遊戲的獨立演出音效。第一鏡依原時間軸重做風聲、翼動與戰聲，第二、三鏡沿用原音效合成並去掉背景音符。可用 `PARCHMENT_FFMPEG` 指定 FFmpeg 路徑。Desert Ascendant 沿用已授權的遊戲音檔與 `third-party/user-supplied/desert-ascendant/` 的來源紀錄。
- 遊戲專案可用 `node tools/intro/sync-parchment-shots.cjs --apply` 從素材庫匯出，並用 `--check` 驗證素材庫和遊戲端的 SHA-256。核准新成片後，更新素材庫的成片並執行 `--archive` 重建清單。
