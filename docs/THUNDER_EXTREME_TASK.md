# 殛道落雷紫白特效預覽
- Owner：Codex；狀態：預覽完成，等待使用者確認接入。
- 使用者只要求改色，其它不動。以目前正式落雷 preset 為基礎，僅將色調換為紫白，保留速度、大小、時間與圖層配置，不採文檔原有放大要求。
- 允許：新 author、bolt/hit-thunderstrike-purplewhite preset/layout、本記錄及暫存預覽；未授權接入。
- 衝突預檢乾淨；驗證顏色以外欄位一致、Core 動態預覽與既有驗證。
- 驗證：排除 preset ID 與 tint 後，兩組新舊 preset 深度比較完全一致；Core 動態預覽已檢視；`node --test tests/vfx-core.test.cjs tests/vfx-preset-layout.test.cjs` 136/136 通過；`npm run build` 332 個檔案通過。
- 2026-09-11 使用者批准 commit：保留兩組 preset/layout、正式 author 與本記錄，刪除暫存預覽。尚未接入遊戲；未修改 Excel、技能邏輯及既有落雷 preset。此提交可供合併，遊戲接入仍待確認。
