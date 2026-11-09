# 地圖背景音樂

Zones.xlsx「地圖」的 BGM／BGM2 欄填寫專案相對路徑，按欄位順序播放後回到第一首。場景配樂等遊戲 Loading 結束、畫面揭幕後才起播；每首結束後等待約十秒再播放下一首，單曲亦等待後重播。空欄略過，兩欄皆空則沒有配樂。經 Excel → CSV → config_tables 套用至 ZONES.bgm／bgm2。場景依 Worker 的 zone／towerActive 權威快照切換；同地圖換關、切面板與靜音保留曲目及進度，離開該地圖或進入封魔塔即停止並取消舊曲間計時。沿用音樂音量及全體靜音，分頁隱藏時持續輪播與曲間等待，離開網頁時暫停，返回時接續。曲間等待不會被手勢、設定或同圖快照略過；靜音、Loading 或選單期間即使等待結束也不會搶播。瀏覽器限制自動播放時，在首次真實操作後起播。

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
