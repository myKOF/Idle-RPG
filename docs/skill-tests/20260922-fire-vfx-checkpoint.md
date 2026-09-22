# FIRE-VFX-CHECKPOINT-20260922

使用者要求將所有自行修改一併提交，供合併 Claude。保留 Skills2 Excel／CSV／JS 的星環設定：每秒24米、每秒0.5圈、射程50米；半徑8米。保存 hit-fire 與 proj-firehunt-ring 調整，同步主頁、Runtime 和 Worker 快取。

已核准的六顆實心火核與弧形尾焰概念圖見 firegod-star-concept.png。概念圖文字仍是原提案12米／秒、1.5圈／秒，不覆寫使用者最新配置。新造型尚未實作，本次只是交接存檔。

素材庫 commit：89f0793。遊戲 commit 為本文件所在提交。修改清單見 git show --stat；唯讀檢查配置生成工具、素材庫解析／匯出工具及協作規範。

驗證：node tools/config_tables.cjs --apply Skills2（語意變更0）；node tools/build_check.cjs（399檔通過）；node tools/vfx/export-assets.cjs --check（已最新）；node --test tests/vfx-projectile-perspective.test.cjs tests/battle-perspective.test.cjs tests/vfx-pixi-sheet.test.cjs tests/vfx-runtime-screen-space.test.cjs（22/22）；git diff --check。素材與概念圖雙倉庫內容一致。

限制：本次未進行實戰視覺驗證。可合併此檢查點；下一步依核准概念製作動態預覽。未合併或推送。
