# 地圖配樂與使用者特效調整（2026-11-25）

- 使用者要求提交目前修改，包含自己新增的四個MP3，並補上配樂路徑的副檔名。月影沼澤使用 `swamp-pressure.mp3`／`swamp-pressure_2.mp3`；亡靈山脈使用 `undead-mountain-ascent.mp3`／`undead-mountain-ascent_2.mp3`，皆位於 `audio/zones/`。
- Excel是來源：只修改「地圖」D6、E6、D8、E8四格，補上 `.mp3`；正常儲存、兩次重開驗證，再匯出CSV並同步JS。逐格比對確認其他值／公式、有效格式、列高／欄寬、篩選／驗證及列印設定保持一致。
- 既有熔岩山第二首 `black-crust-breaks _2.mp3` 的檔名多一個空格，改為 `black-crust-breaks_2.mp3`，與原表格引用一致；音檔內容未變，原檔來自專案提交 `b3c84c35`。
- 四個新音檔是使用者已放入工作區的素材，依本輪明確提交指示原樣保存；Codex沒有下載、生成、選曲、轉碼或調整音量，不另行推定第三方授權條款。
- 素材庫保存於 `third-party/user-supplied/zone-music-20261125/`，包含上述四首及既有熔岩山兩首，`manifest.json`記錄原路徑、來源提交、位元組數與SHA256。遊戲與素材庫逐檔內容一致。
- 使用者的升級特效 `vortexCount` 由170改為20，保持原設定；經既有 `node tools/vfx/authoring/author/level-up.cjs --archive` 同步 `codex-authored/level-up/`，`--check`核對所有來源及SHA。

本次不改音樂播放器、地圖解鎖條件或特效來源。測試與雙倉庫提交結果見 `docs/AI_TASKS.md` 的 `COMMIT-USER-CHANGES-20261125`。
