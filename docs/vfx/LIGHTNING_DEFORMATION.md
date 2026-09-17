# 整組雷電／折線特效變形

任務：VFX-LIGHTNING-DEFORMATION-20260918，Owner Codex。

每次施放以種子產生一組連續橫向位移、鏡像與±7%橫向縮放。使用既有貼圖，固定軸線的起終點，不逐張獨立平移。接縫相同區域座標共用同一變形函數；GPU以低解析網格近似。不更動模擬傷害、飛行路徑與範圍。

## 正式套用（22份）

- aura-lightning-relay
- beam-gale-thunder-flash
- bolt-chain-bluewhite
- bolt-chain-lightning
- bolt-chain-travel-bluewhite
- bolt-curtain-lightning
- bolt-sky-lightning
- bolt-sky-purple
- bolt-thunderstrike-bluewhite
- bolt-thunderstrike-purplewhite
- ground-thunder-orb
- hit-gale-burst-07-moon
- hit-gale-burst-diffusion
- hit-gale-burst
- hit-lightning
- hit-thunder-purple
- hit-thunderfall-impact
- hit-thunderstrike-purplewhite
- orb-thunder
- proj-lightning
- proj-thunder-orb-fall
- proj-thunderfall-sky

## 保留範圍

- hit-thunderstrike-bluewhite：使用者明確拒絕上一版受擊預覽，不接入該候選，也不修改此Preset。
- 純粒子電弧（如 st-lightning、lightning-orb-field）沿用原本的隨機角度／尺寸／運動；不將大量小粒子換成網格。
- 火焰、風刃的火花素材、柔光、圓環及非折線主体保留。混合特效只明列折線sprite圖層，非依檔名在Runtime猜測。
- 舊版無Preset事件的歷史程序雷電保留原隨機繪製；本次新增欄位不是第三種Preset來源。
- 未新增或修改素材二進位檔；素材庫status乾淨，無需空Commit。
- 保留使用者同時編輯的技能表、skills2.js與bolt-sky-purple圖層／layout。正式雷電Preset只追加變形設定。

## 驗證

- 核心、階層、Pixi序列幀、變形、Editor存檔／暫停、離線斜切渲染及Runtime共303項：296通過、1項Windows symlink權限跳過，6項既有失敗。
- 在獨立HEAD快照重跑Runtime 88項，82通過，完全相同6項失敗：THUNDERFALL斜落、TORNADO定位與升起（2項）、MIRE進化強度、CHAIN移動端點、VACUUMSPIN尺寸。本次不降低斷言或改寫不相關技能。
- 實際Edge/Pixi 8.6.6 WebGL：22份Preset／79個當幀網格均成功播放；無載入／JavaScript錯誤、無非有限頂點。
- 三道落雷各3層共9個網格，85頂點／層；相同seed可重現、不同seed不同，靜止時不更新vertex buffer。回收重播不殘留前一次形狀。
- 驗證工具：先啟動 `node tools/vfx/editor-server.cjs --port 18765`，再以可解析Playwright的環境執行 `node tools/vfx/verify-deformation.cjs`。可設VFX_TEST_URL及VFX_SCREENSHOT。

## 效能

40道落雷同時播放（120個網格）的Headless Edge測試，90幀：
- 原版CPU更新平均0.19ms，渲染提交平均0.12ms。
- 變形CPU更新平均1.24ms（P95 1.8ms），渲染提交平均0.43ms（P95 0.8ms）。
- 平均增加約1.36ms；未量測完整遊戲／實際GPU完成時間，不能解讀為遊戲FPS保證。
- 不增加粒子數、不每幀配置頂點陣列、不新增獨立Timer；較少同時施放時成本隨活躍圖層降低。
