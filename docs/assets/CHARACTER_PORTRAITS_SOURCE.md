# 核准角色頭像 0～6 轉（2026-11-09）

使用者要求將導覽列的頭圖、轉生與等級、角色頁入口整合，最終需要0～10轉共11張。使用者確認首批0～3轉畫風，繼續製作4～6轉後，已明確要求將全部七張接入側欄角色圖示及角色頁頭像。0～6轉已在Codex工作分支接入，尚未合併develop；7～10轉與更高階段暫用原有`images/icon_avatar.png`。

## 來源與製作

- 參考為本專案已獲使用者授權的Role／Role1～Role6 3D模型；0～5轉授權紀錄見角色模型來源文件，Role6見docs/AI_TASKS.md的HERO3D-ROLE6-20261109。0轉參考由role.glb在Blender實際渲染，1～6轉使用模型製作時的正面預覽；第二批另以已核准3轉插畫作畫風參考。沒有引入第三方圖片。Role6原始模型正面僅作造型參考，不改或接入另一聊天的在製3D候選。
- RPG Mote Studio網頁工具本輪無法存取，改用內建`image_gen`，每轉各一個生成請求。畫面為新生成的原創頭肩插畫，並非模型截圖直接充當頭像。
- 精確提示詞見[CHARACTER_PORTRAITS_PROMPTS.json](CHARACTER_PORTRAITS_PROMPTS.json)。統一暗背景、精緻半寫實畫風與清楚臉部構圖；0轉黑髮皮甲、1轉黑棕髮皮甲鎖甲、2轉棕髮銀甲深藍布、3轉白髮銀金重甲、4轉黑紅髮銀紅甲與紅圍巾、5轉黑紅髮金紅甲與紅圍巾、6轉棕髮金色騎士甲。
- 不變更原圖構圖或顏色，使用Sharp等比輸出256×256 WebP（quality 92、effort 6）；圓形裁切與金框由CSS呈現，原始大圖沒有內建圓框或文字。
- 素材庫獨立套件：`codex-authored/character-portraits-20261109`。保存七份生成原圖、七份模型參考、精確提示詞、WebP匯出、來源文件及SHA256 manifest；0～3轉原圖及匯出逐位元保持。本機位置由`tools/vfx/vfx-library-root.cjs`解析。

## 遊戲接線

`js/ui.js`的`CHARACTER_PORTRAITS`依既有header快照轉生數選圖；側欄與角色頁頭像同步。轉生數／等級使用原有快照與String679，0轉也顯示。單一原生button沿用`data-tab="char"`與原有事件，具有String63的無障礙名稱；保留可轉生紅點、active／hover／focus及鍵盤操作。

```text
node tools/meshy-pipeline/src/export-character-portraits.cjs --apply
node tools/meshy-pipeline/src/export-character-portraits.cjs --check
```

`--apply`只複製manifest中明列的遊戲匯出，`--check`核對素材庫原圖／參考及遊戲輸出SHA。不改模型、數值、解鎖、存檔或Worker協議。7～10轉四張尚未製作。
