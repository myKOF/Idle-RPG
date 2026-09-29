# CHAIN-SHAPE-REFRESH-20260929

## 已完成的核心修改

出生與飛行現在共用sampleDeformationShape：同一套隨機相位、鏡像機率、寬度分布。啟用motionSpeed及motionAmplitude時，从出生起使用相同的完整形狀生成方式，按總時間每個節拍重新抽樣。金色與紫色已有12次／秒、40px設定，未修改Preset。

移除固定形狀上額外疊加、平滑滑動的兩組正弦相位。改為整個電弧形狀直接換新，鏡像僅為+1/-1，不插值穿越0；寬度維持配置的範圍。這是閃電形狀的瞬時重抽，飛行位置與追蹤仍沿原本連續路徑。原PNG素材不重新生成，原素材與分岔會一起隨鏡像／幾何變形改變。

重抽時重用既有變形物件，圖層共享，GPU只在形狀節拍或位置／裁切改變時更新。seed加時間節拍可重現，不依FPS；循環不重置。關閉動態參數維持原出生抽樣。頻率、鏡像機率、隨機寬度、相位範圍及幅度均來自現有編輯器共用欄位，未加入隱藏倍率。

## 檔案

修改：js/vfx-core.js、tests/vfx-deformation.test.cjs、tests/vfx-pixi-sheet.test.cjs、tools/vfx/editor/index.html（Core快取）、docs/AI_TASKS.md、本文件。

檢查未修改：js/vfx-pixi-backend.js、tools/vfx/editor/editor.js、tools/vfx/editor-server.cjs、index.html、js/vfx-runtime.js、金色／紫色Preset、AI_RULES.md、docs/AI_WORKFLOW.md、prompts/codex.md、Core與editor-code-controls測試。保留使用者配置表、NPC、skills2、beam-light修改。素材庫乾淨，未更動素材，因此無新素材提交。

## 驗證

- node --test tests/vfx-core.test.cjs tests/vfx-deformation.test.cjs tests/vfx-pixi-sheet.test.cjs tests/vfx-editor-code-controls.test.cjs：177通過、0失敗。
- 同一生成器測試逐節拍核對出生與飛行phase／mirror／width，出生幾何一致；完整一秒正式金色／紫色Core→Pixi測試確認鏡像兩方向、超過5種寬度、無零寬度。
- 原平滑相位測試更新為完整節拍換形狀與循環不重置語意；保留不同FPS、暫停、端點、回收重用、UV裁切與圖層同步檢查。
- npm run build：404檔通過。git diff --check通過。
- 未進行本輪瀏覽器實機視覺驗收；上列GPU測試為真實後端邏輯搭配Pixi物件替身。

## 明確待辦／限制

使用者要求editor.js、index.html、js/vfx-runtime.js等Claude改好並合併後才改。預檢仍有未提交重疊來源，未觸碰三檔。核心可獨立審查，但尚不能宣稱遊戲已載入新版本或整體交付完成。

Claude合併後：更新遊戲index.html的Core版本為20260929-shape-refresh、backend版本20260929-wave-mesh；補上前輪Runtime資料版本與引用快取。新增編輯器過期版本／外部檔案變更偵測、拒絕舊分頁覆寫，保留未存檔內容及重啟提示，再驗證舊分頁存檔情境與低速實戰。

已明確告知使用者重新載入VFX編輯器；未存檔內容先另存新名称保留，不要從舊分頁覆寫原檔。自動防護尚未實作，不能把提示當成防護完成。

本次提交僅已驗證的核心修改，不合併、不推送。待上述依賴解除再補齊交付。
