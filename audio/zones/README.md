# 地圖背景音樂

Zones.xlsx「地圖」的 BGM／BGM2 欄填寫專案相對路徑，按欄位順序播放後回到第一首。場景配樂等遊戲 Loading 結束、畫面揭幕後才起播；每首結束後等待約十秒再播放下一首，單曲亦等待後重播。空欄略過，兩欄皆空則沒有配樂。經 Excel → CSV → config_tables 套用至 ZONES.bgm／bgm2。場景依 Worker 的 zone／towerActive 權威快照切換；同地圖換關、切面板與靜音保留曲目及進度，離開該地圖或進入封魔塔即停止並取消舊曲間計時。沿用音樂音量及全體靜音，分頁隱藏時持續輪播與曲間等待，離開網頁時暫停，返回時接續。曲間等待不會被手勢、設定或同圖快照略過；靜音、Loading 或選單期間即使等待結束也不會搶播。瀏覽器限制自動播放時，在首次真實操作後起播。

## 封魔塔：Blades of the Rising Sun

使用者於2026-11-10指定專案既有 `audio/zones/blades-of-the-rising-sun.mp3` 為封魔塔BOSS戰配樂。原檔來自使用者提交 `6c84d97a`，本次僅接線，沒有下載、生成、轉碼或修改素材；既有素材庫 `third-party/user-supplied/zone-music-20261110/` 已保存相同原檔與來源manifest。本段不新增或推定原始授權條款。

手動與連續挑戰按鈕送出指令前立即切曲，不等登場演出。等待指令回覆時忽略舊野外快照；回覆後由權威塔戰狀態接管，拒絕／傳送失敗則回復野外配樂。塔戰與結算中的同曲快照不重播，離開塔戰回復所在野外配樂。沿用既有十秒曲間等待、音樂音量、靜音、Loading與選單互斥規則。

- SHA-256：`1fde84906a3c99253a95381b28ce01c565f8fc4f8026a7d9d4b545df35014119`

## Desert Ascendant

使用者提供的 `desert-ascendant.mp3`；2026-11-08 使用者明確確認「已取得授權」。來源／授權依使用者確認記錄，非 Codex 自製。音檔原樣保存，未轉碼或調整音量。

- 遊戲路徑：`audio/zones/desert-ascendant.mp3`
- 素材庫相對路徑：`third-party/user-supplied/desert-ascendant/`
- SHA-256：`c52558e7adc5c0d9ddb6e13100c445eaa0f23be6694a22e621b825fb2e6a1ba1`

## Desert Ascendant 2

使用者提供的 `desert-ascendant_2.mp3`；2026-11-08 使用者明確確認「第二首也已取得授權」。非 Codex 自製，原樣保存，未轉碼或調整音量。荒漠依 `desert-ascendant.mp3` → `desert-ascendant_2.mp3` → 第一首依序循環。

- 遊戲路徑：`audio/zones/desert-ascendant_2.mp3`
- 素材庫相對路徑：`third-party/user-supplied/desert-ascendant/`
- SHA-256：`e1f3515e0d13f097d727b24695022135afdc3d7758d40de7cfc25995951a6d69`
