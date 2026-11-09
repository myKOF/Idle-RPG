# 角色頭像首批 0～3 轉（2026-11-09）

使用者要求將導覽列的頭圖、轉生與等級、角色頁入口整合，最終需要0～10轉共11張，本輪先交付0～3轉初稿供檢視。首批在Codex工作分支接入，尚未合併develop；4～10轉與更高階段暫用原有`images/icon_avatar.png`，不以其他轉數圖案冒充成品。

## 來源與製作

- 參考為本專案已獲使用者授權的Role／Role1／Role2／Role3 3D模型，授權紀錄見同目錄的角色模型來源文件。0轉參考由目前role.glb在Blender實際渲染，1～3轉參考使用該模型製作時的正面預覽。沒有引入第三方圖片。
- RPG Mote Studio網頁工具本輪無法存取，改用內建`image_gen`，每轉各一個生成請求。畫面為新生成的原創頭肩插畫，並非模型截圖直接充當頭像。
- 精確提示詞見[CHARACTER_PORTRAITS_PROMPTS.json](CHARACTER_PORTRAITS_PROMPTS.json)。統一暗背景、精緻半寫實畫風與清楚臉部構圖；0轉黑髮皮甲、1轉黑棕髮皮甲鎖甲、2轉棕髮銀甲深藍布、3轉白髮銀金重甲。
- 不變更原圖構圖或顏色，使用Sharp等比輸出256×256 WebP（quality 92、effort 6）；圓形裁切與金框由CSS呈現，原始大圖沒有內建圓框或文字。
- 素材庫獨立套件：`codex-authored/character-portraits-20261109`。保存四份生成原圖、四份模型參考、精確提示詞、WebP匯出、來源文件及SHA256 manifest；本機位置由`tools/vfx/vfx-library-root.cjs`解析。

## 遊戲接線

`js/ui.js`的`CHARACTER_PORTRAITS`依既有header快照轉生數選圖；側欄與角色頁頭像同步。轉生數／等級使用原有快照與String679，0轉也顯示。單一原生button沿用`data-tab="char"`與原有事件，具有String63的無障礙名稱；保留可轉生紅點、active／hover／focus及鍵盤操作。

```text
node tools/meshy-pipeline/src/export-character-portraits.cjs --apply
node tools/meshy-pipeline/src/export-character-portraits.cjs --check
```

`--apply`只複製manifest中明列的遊戲匯出，`--check`核對素材庫原圖／參考及遊戲輸出SHA。不改模型、數值、解鎖、存檔或Worker協議。4～10轉尚待使用者檢視首批畫風後製作。
