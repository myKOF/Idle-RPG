# 羊皮紙序章

本資產為使用者確認的分鏡成片。全長 30.30 秒，1920 × 1080，30 fps，H.264 與 AAC 立體聲。第一鏡從天使近景拉遠至天堂戰場，帶出地面與空中的惡魔大軍。第二鏡從 9.00 秒疊化時即開始運動，9.90 秒完全顯露。大天使長帶火仰面墜落，灰煙遮住大半下身，焦紙片沿氣流翻飛。18.90 秒收完群墜尾跡，19.40 秒深淵光點亮起並擴散。20.80 秒由白幕接入第三鏡。第三鏡長 9.50 秒，星點與神光在羊皮紙地圖浮現，暗紫霧從邊緣侵入。25.63 秒光束落在荒漠，紫霧停在圓形神光外緣。鏡頭於 25.98 秒俯衝，27.24 秒穿過沙塵接入地表，最後淡出。

遊戲專案的 `opening_animation/shot-01-03.mp4` 收錄前三鏡，前兩鏡獨立版為 `opening_animation/shot-01-02.mp4`。舊版遊戲重播的獨立演出音效封存為 `shot-01-03-sfx.mp3`。成片保留核准畫面及原混音供封存與預覽。

## 55 秒計畫的加長前兩鏡

使用者於 2026-11-13 核准〈天界失守〉魔軍增援版。`web/shot-01-extended.mp4` 保存獨立的 16 秒第一鏡，遊戲副本位於 `opening_animation/shot-01-extended.mp4`。大天使長聽見鐘聲抬頭，兩段拉遠揭露軍勢，11.72 秒塔樓遇襲，聖光熄滅，灰燼掠過前景。城前遠地有 2,673 個遠方剪影及 377 個過渡兵影，三處天空加密 1,213 個遠方翼影及 99 個振翼前鋒。本次核准版將兩側所有流光翼接到鏡頭可見的背甲，分別從脊柱兩側的肩胛位置向外展開。

- `extended-shot-one/` 保存鏡頭、突襲、遠近軍勢、字幕、音效與可重製預覽。畫面沿用同一資料夾下 `source/assets/` 的原創分件及 `source/shot-air.js`，本版新增動態合成。Noto Serif TC 沿用素材庫 `third-party/google-fonts/start-menu-20261106` 的授權來源。
- `extended-shot-one/assets/shot-one-effects.wav` 是獨立的 48 kHz 立體聲音效，供後續接鏡。`shot-one-preview.wav` 為含配樂的核准審片混音。配樂讀取素材庫 `third-party/user-supplied/desert-ascendant/desert-ascendant.mp3`。
- 在 `extended-shot-one/` 執行 `node build-audio.cjs` 可重建音效與混音。執行 `node render-shot-one.cjs` 可用 Windows Edge 與 FFmpeg 重製 1920 × 1080、30 fps 的影片，`--stills` 只輸出抽查畫格。可用 `PARCHMENT_FFMPEG` 指定 FFmpeg，`PARCHMENT_REVIEW_DIR` 指定輸出資料夾，預設為系統暫存目錄下的 `idle-rpg-extended-shot-one`。

使用者同日核准第二鏡〈大天使長與群翼墜落〉與前兩鏡 34 秒連播。

- `web/shots-01-02-34s.mp4` 保存核准連播，遊戲專案副本為 `opening_animation/shots-01-02-34s.mp4`。第 16 秒從新版第一鏡末格開始疊化，約第 16.95 秒完全進入墜落畫面。配樂 Desert Ascendant 連續播放。
- `web/shot-02-archangel-fall-18s.mp4` 保存第二鏡獨立成片。近景採用使用者明確授權直接使用的天使角色圖，沿原輪廓擷取，並以 ImageGen 局部修整兜帽下緣與金邊。角色原圖、修圖稿、焦羽與提示詞保存在 `extended-shot-two/`。墜落逐漸退入雲霧，焦羽在貼近鏡頭前翻面，最後的光點緩慢擴散並淡入黑幕。
- `extended-shot-two/assets/04-heavy-fire-roar.wav` 為使用者選定的第 4 款火焰音效「低沉轟然」。`shot-two-effects.wav` 保存獨立演出音效，`shots-one-two-preview.wav` 保存連播混音，`shot-two-preview.wav` 保存第二鏡獨立混音。
- 加長版前兩鏡已封存。

從本資料夾執行以下指令可重製。兩鏡共用 `PARCHMENT_REVIEW_DIR`，預設為系統暫存目錄下的 `idle-rpg-extended-shot-one`。可用 `PARCHMENT_FFMPEG` 指定 FFmpeg 路徑。

```powershell
node extended-shot-one/render-shot-one.cjs
node extended-shot-two/package-preview.cjs --tail
node extended-shot-two/render-shot-two.cjs
node extended-shot-two/package-preview.cjs
```

需要重建第二鏡的獨立演出音效與兩條混音時，執行 `node extended-shot-two/build-audio.cjs`。

## 加長第三鏡與 66 秒連播

使用者於 2026-11-14 核准第三鏡 v10。第三鏡 32 秒，自第二鏡黑幕接入。薩爾維恩地圖的紫霧被神光分開，鏡頭循光落入荒漠。光點熄滅後推鏡，煙塵逐漸散去，露出倒臥的大天使長。約 60° 斜俯遠景沿用同一角色分件，焦羽從接近滿幅開始飄落，切到胸前近照後觸甲亮起。羽毛入鏡到觸甲約 6.25 秒。角色保留象牙白與淡金，盔甲覆有沙塵且有損毀。左手只取 ImageGen 修整的拇指區域，沿用使用者指定原圖的其餘四指及掌指關節。近照用於拇指解剖參考。

- `web/shot-03-extended-32s.mp4` 為獨立第三鏡，`web/shots-01-03-66s.mp4` 為核准連播。遊戲專案封存連播為 `opening_animation/shots-01-03-66s.mp4`。
- `extended-shot-three/` 保存鏡頭、砂塵、羽毛、手部修整、提示詞及預覽頁。分層使用同一資料夾中的 ImageGen 角色及斜俯荒漠底圖，地圖、地表、煙霧、焦羽、字型沿用先前封存素材。
- `extended-shot-three/assets/` 保存 48 kHz 立體聲獨立音效與核准混音。Desert Ascendant 在連播時連續跨過第 34 秒。

在本資料夾執行以下指令可重製。輸出預設為系統暫存目錄下的 `idle-rpg-extended-shot-three`，可用 `PARCHMENT_REVIEW_DIR` 和 `PARCHMENT_FFMPEG` 覆寫。可先設 `PARCHMENT_AUDIO_DIR` 指向暫存資料夾，再執行 `node extended-shot-three/build-audio.cjs` 將混音重製到同一資料夾，供後續封裝讀取。

```powershell
node extended-shot-three/render-shot-three.cjs
node extended-shot-three/package-preview.cjs
```

## 第三鏡 33.5 秒與 67.5 秒連播（2026-11-16 核准）

第三鏡依核准稿加厚荒漠煙塵，左手與腕甲融入場景沙面。焦羽自約 60° 斜俯遠景飄落，切入胸甲特寫的第一格即從羽軸中央發出白色星芒。觸甲後白光接成金白放射光束與粒子，始終從同一羽軸錨點擴散。鏡頭隨光緩慢推進，約三秒後光及上半身並淡出。

- `web/shot-03-extended-33.5s.mp4` 保存獨立第三鏡，`web/shots-01-03-67.5s.mp4` 為核准連播。遊戲匯出為 `opening_animation/shots-01-03-67.5s.mp4`。
- `extended-shot-three/` 保存本版可編輯來源。左手修整沿用核准的沙掩分件，前景手腕由既有荒漠地表取樣合成。焦羽特效由專案 VFX 編輯器製作，preset、單一根群組 layout、原素材索引對照與 VFX Core 版本快照一併封存。光束參考使用者附圖的亮白核心和金色放射線，以專案既有 flare／star／trace 貼圖實作。
- `assets/shot-three-effects.wav` 為 33.5 秒獨立演出音效，`assets/shot-three-preview.wav` 與 `assets/opening-67.5s-preview.wav` 為核准混音，連播配樂接續跨過第 34 秒。第 34 秒前的影像封包與加長前兩鏡核准版一致。

重製方式沿用上方兩條 render／package 指令，使用本版 `extended-shot-three`。預覽頁須由 HTTP 提供，讓瀏覽器可載入 VFX preset JSON；離線渲染程式會自行啟動本機預覽伺服器。

## 第四鏡 32.2 秒與前四鏡 100.7 秒（2026-11-17 核准）

前四鏡在第 68.5 秒從胸口羽毛的金光接入第四鏡。金光逐格向外擴散，第 70.7 秒切至右手撐地。撐地近景 10 秒，最後 1.5 秒交疊淡入半跪，接續持劍與石拱門。持劍段維持原畫站姿，分層合成近地、人物、遠景與飛砂，劍刃落砂約兩秒，陣風自右向左。Desert Ascendant 沿用既有素材庫授權來源，連播配樂維持一條時間軸。

- `extended-shot-four/` 保存原創 ImageGen 分件、可編輯遮罩、布料、風沙、混音與渲染程式。使用者附圖用來標示修整區域和動作參考，人物去背取用同一張原創畫作。獨立演出音效與含配樂混音位於 `extended-shot-four/assets/`。
- `extended-shot-three-35.5s/` 保存前四鏡所用的第三鏡剪接版本。羽毛落胸前多飄兩秒，落定後金光延續原版節奏。渲染使用 `extended-shot-three/` 內既有背景、角色分件與羽毛 VFX preset。
- `web/shot-04-32.2s.mp4` 是獨立第四鏡，遊戲匯出為 `opening_animation/shot-04-32.2s.mp4`。前四鏡的核准 MP4 原始位元組保存在 `web/shots-01-04-100.7s.mp4.part01` 及 `part02`，同名 JSON 記錄長度、影格數和 SHA-256。以下指令可還原成一份可直接播放的 MP4。

```powershell
node extended-shot-four/restore-master.cjs shots-01-04-100.7s.mp4
```

重新渲染可執行 `node extended-shot-four/render-shot-four.cjs`。指定 `PARCHMENT_ARCHIVE` 為此序章素材目錄後，可用 `node extended-shot-four/build-audio.cjs` 重製第四鏡混音。預覽、渲染及混音支援既有 `PARCHMENT_FFMPEG`、`PARCHMENT_REVIEW_DIR` 設定。

## 遊戲重播（2026-11-17）

2026-11-18 調整第三鏡落地後的揭露煙塵。沙塵沿地勢鋪開，順同一風向散去，天使在原時點現身。正式連播替換第 1506 至 1711 幀。單獨重製可執行 `node extended-shot-three-35.5s/render-shot-three.cjs --frames 486 692`，完成的畫面封存於 `web/shot-03-valley-dust.mp4`。

2026-11-18 核准的第二鏡由第 16.0 秒接入，第 34.0 秒接第三鏡。大天使長沿用原立繪、墜落姿勢及鏡頭路徑，換上焦黑甲裂、反光、燃燒、煙塵碎屑與同向拖曳的流光翼。核准的 18 秒無字畫面保存在 `web/shot-02-effects-18s.mp4`。分層來源為 `extended-shot-two/index-effects.html`、`shot-two-effects.js` 和 `commander-impact.js`，共用原立繪及音效。`node extended-shot-two/render-shot-two.cjs --effects` 可重製單鏡。`--five-shots` 先還原無字連播，再以核准畫面替換第 480 至 1019 幀。

正式前五鏡的畫面與旁白分離。前三鏡使用原分層重製含舊字的畫面區段。字幕由遊戲工作區的 `opening_animation/旁白.md` 提供，修改文案或時間後，下次播放直接讀取。舊版母帶仍可供審片。重製前五鏡時，`--five-shots` 會執行 `export-clean-replay.cjs` 產生無字畫面，之後接上原本的獨立音效匯出流程。

設置說明頁播放 116.7 秒前五鏡。`web/shots-01-05-replay.mp4` 以 1080p／30 fps 接續前四鏡的核准畫面與第五鏡，第 100.7 秒進入荒漠終章。遊戲以同一個 Desert Ascendant 播放器全程播放配樂，並以 `web/shots-01-05-replay-sfx.mp3` 獨立播放演出音效，各自套用遊戲音量。第三鏡音效於第 68.5 秒接第四鏡，第五鏡於第 100.7 秒接入原始風沙音效。遊戲重播在 3 秒前收掉第一鏡鐘鳴的尾音，保留最初敲擊。第一鏡的持續環境風聲與立體聲氣流振幅減半，敵軍來襲、翼振、掠過與撞擊各分量維持原值。核准母帶保留審片混音。

還原核准 MP4 後，可在素材庫的序章目錄執行下列指令重製遊戲匯出。輸出目錄使用新資料夾，避免覆寫既有匯出。

```powershell
node extended-shot-four/export-replay.cjs shots-01-04-100.7s.mp4 replay-export
node extended-shot-four/export-replay.cjs --audio-only replay-audio-export
node extended-shot-four/export-replay.cjs --five-shots replay-five-export
```

## 第五鏡荒漠終章（2026-11-17）

目前成片長 16 秒。入鏡後第 3 秒，白光從劍柄、護手與整片劍身向外放射，光束緩慢順時針旋轉，並和光暈一同逐漸擴大。第一格直接呈現風沙、地面與飛行魔軍，天空和拱門分速左移，近地與人物右移，中景地表固定。白光在新增的尾段持續轉動，約第 14.9 秒和場景一起淡至黑幕。三類飛行惡魔各有 16 格拍翼週期。成片保存為 `web/shot-05-desert-finale-orbit.mp4`，遊戲匯出為 `opening_animation/shot-05-desert-finale-orbit.mp4`。

`extended-shot-five/` 保存分層程式、ImageGen 補景、提示詞、獨立音效與審片混音。重製和預覽方式見該目錄的 `SOURCE.md`。目前獨立成片用於審片，遊戲使用前五鏡連播。各工作區以自己的專案根目錄讀取及匯出素材。手動渲染時可把 PARCHMENT_REVIEW_DIR 設為該工作區 opening_animation/review 下的審片目錄。

## 可編輯來源

Asset 內的 `codex-authored/intro-parchment-shots-20261111` 保存核准成片、可編輯程式、透明分件、雲海和深淵背景、音軌、聲景產生器及提示詞。角色、流光翼、神殿、遠雲、地面敵軍、飛行敵軍、火焰、煙與粒子分開合成。大天使長的頭罩與右手由獨立透明圖接回角色。第二鏡大天使長沿用第一鏡流光翼分件。第三鏡的地圖、荒漠地表、星點、紫霧、光束、圓形神光及沙塵分開合成。

原 30.3 秒版本的入片繪圖均由 ImageGen 原創生成或修訂。使用者提供的天使立繪、姿勢與神殿截圖、指定影片、遊戲內薩爾維恩地圖及使用者圈選的荒漠位置，用於造型、地理與分鏡參考。音軌由本地程序合成。RPG Mote Studio 主要適合像素圖，本案採用適合高解析蝕刻圖與透明分件的 ImageGen。

## 檢視及同步

- 在素材庫開啟 `source/index.html` 可播放、暫停及拖曳時間軸。
- 在素材庫的 `source` 執行 `node build-score.cjs` 與 `node render-video.cjs` 可重製前三鏡有聲 MP4，輸出為 `opening-shots-01-03-desert-ground-dive.mp4`。影片輸出需要 Windows 版 Microsoft Edge 與 FFmpeg。
- `node build-score.cjs --sfx` 可重建遊戲的獨立演出音效。第一鏡依原時間軸重做風聲、翼動與戰聲，第二、三鏡沿用原音效合成並去掉背景音符。可用 `PARCHMENT_FFMPEG` 指定 FFmpeg 路徑。Desert Ascendant 沿用已授權的遊戲音檔與 `third-party/user-supplied/desert-ascendant/` 的來源紀錄。
- 遊戲專案可用 `node tools/intro/sync-parchment-shots.cjs --apply` 從素材庫匯出，並用 `--check` 驗證素材庫和遊戲端的 SHA-256。核准新成片後，更新素材庫的成片並執行 `--archive` 重建清單。
