# 原創場景物件與地面銜接

任務：SCENE-RENEWAL-INTEGRATION-20261007。

苔沼沿用核准的九種元素：苔岩、樹樁、倒木、蕨葉、蘆葦、菌群、苔草、水窪與根系。七張野外地圖的地表／地下均更新岩石風化、接觸陰影、地貌碎屑；沙地用砂石、冰原用雪緣，其他地圖沿用既有主題色與地標。封魔塔仍使用既有祭壇。

所有線條、切面、裂紋、苔蘚、木紋與泥岸由原創 Canvas 程序建圖，不載入第三方圖片。RPG Maker MV 僅用於觀察左上光、植物群落及根部覆蓋，沒有匯入、裁切、描摹或改色素材。

`DecorNature` 提供純繪圖函式；`BattleDecor` 決定地圖配色、尺寸與固定種子。每個直立物件的接觸區使用同圖集中的 `foot_` 貼圖，在地面層以同腳點、倍率與翻面放置。本體在實體層抵銷透視斜切、依深度排序及遮擋淡出；接觸區留在地面，不隨本體淡出。接觸區在建圖時縱向拉伸兩倍，再由既有地面平面壓至 0.5；不改 Renderer 或地面座標契約。

接觸區與一般地面貼片共用區塊回收／物件池。增加本體接觸區後，減少獨立貼片及小碎物密度，使可見節點仍受原上限約束。圖集由既有 OffscreenCanvas Worker 建造，主端後備亦讀同一份模組；沒有每幀重畫美術或新增圖片請求。

程序美術母來源保存在素材庫 `codex-authored/scene-nature/decor-nature.js`，遊戲的 `js/decor-nature.js` 是匯出副本。匯出使用 UTF-8／LF，SHA256 比對先正規化換行，避免兩庫的 autocrlf 差異。編輯母來源後執行：

```
node tools/scene-renewal/export-source.cjs --apply
node tools/scene-renewal/export-source.cjs --check
```

更新 `index.html`、圖集 Worker 與 `tools/decor-preview.html` 對應版本，並增加 Decor 的 Worker URL 版本；依專案規範同步 Worker Asset 快取。開發預覽 `/tools/decor-preview.html?kit=swamp` 共用正式圖集並顯示物件接觸區，不再維護第二套美術畫法。

驗證命令：

```
node --test tests/battle-decor.test.cjs tests/battle-arena.test.cjs tests/battle-perspective.test.cjs
npm run build
git diff --check
```

實際戰鬥大量技能時的 FPS 仍由原 Renderer／VFX 負載決定；隔離場景測量只能確認本次裝飾的渲染與回收成本。
