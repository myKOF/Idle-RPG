# FIREGOD-FORMATION-20260922／FIREGOD-VFX-20260922

## 後續：旋轉編隊（目前規格）

使用者附圖指定六枚等距成環、整組移動，後續指定半徑 8 米、中心前進 12 米／秒、順時針每秒 1.5 圈。取代前次排成一線／80ms 延遲；數量繼續依等級計算（Lv.10 六枚）。中心沿目標起始方向走 40 米，約 3.333 秒，成員在中心外 8 米公轉。

- Skills2 Excel／CSV 第 111 列同步速度、環繞半徑、JSON rps 與描述；新增 orbitM 專用欄位綁定，沒有第二份數值來源。工作簿只改五個儲存格並保留原樣式，其餘內容未改。
- util.projectileOrbitPoint 純函式供模擬與 Runtime 共用；事件透過既有 area 白名單傳完整未投影軌跡，協議升 v37、主執行緒與 Worker 快取同步。
- 模擬每拍掃過公轉弧線（每段最多 7.5 度，8 米半徑的弦誤差 <0.18 世界單位），逐枚沿用一次命中／貫穿邏輯，不能以共同中心直線代替。無座標高塔維持抵達後命中相容行為。
- Runtime 逐幀計算位置與切線朝向，最後才投影地面 Y；動畫壽命依權威飛行時間延長，六枚不在 1.5 秒提前消失。未修改 preset、貼圖或傷害倍率；素材庫無變更，不建立空提交。
- 修改檔案：config/Excel/Skills2.xlsx、config/CSV/Skills2.csv、tools/skills2-geometry.cjs、js/skills2.js、js/util.js、js/vfx-runtime.js、js/bridge.js、js/worker/sim.worker.js、js/worker/protocol.js、index.html、tests/firegod-vfx.test.cjs、tests/firegod-render.test.cjs、tests/worker-protocol.test.cjs、docs/WORKER_PROTOCOL.md、docs/AI_TASKS.md、本報告。
- 唯讀檢查：battlefield 線段碰撞、Worker shim area 透傳、既有星環 preset 與貼圖、battle-renderer 投影入口。
- node --test tests/firegod-vfx.test.cjs tests/firegod-render.test.cjs tests/skills2-vfx-schema.test.cjs tests/worker-shim.test.cjs tests/worker-protocol.test.cjs：28/28。涵蓋同時起飛／六枚等距、共同中心速度／旋向、低 tick 弧線命中與中心直線不誤中、兩種投影比例逐幀位置、完整飛行壽命、高塔與致死命中、連發不疊白、Excel／CSV 一致及 Worker 協議。
- node --test --test-name-pattern='尺寸|sizing|projectile|PROJECTILE|THRUST|DEVOUR' tests/vfx-runtime.test.cjs：12/12。
- node tools/build_check.cjs：398 檔通過；node tools/config_tables.cjs --apply Skills2：語意變更 0；git diff --check 通過。
- 已展示實際 Runtime 的單波六枚 GIF（先預覽）；未完整瀏覽器／GPU 實戰驗證，後續可重新載入 8123 確認觀感。無未完成實作，可合併；遊戲 Commit 為本紀錄所在提交，未合併／推送。

以下保留前次白光修正紀錄；其中速度與節拍已由本節取代。


## 本次完成

使用者確認 http://127.0.0.1:8123/ 指向 codex；HTTP 檔案包含前次修正，不能歸因於開錯版本。
前次 ca4fbe6c 移除了發射事件誤繼承的 burst-fire／地板，但不足以解決整片白光。

只使用 proj-firehunt-ring 與實際 Runtime/Core 即可重現：缺少 radiusM 使製作半徑 11 世界單位被預設半徑 6 米放大 5.45 倍，多層加法混色在連發時疊白。

- 發射事件沿現有 lineWidth 傳遞碰撞直徑 16 世界單位，與 SG_FLYING_PROJECTILE_HALF_WIDTH 共用。碰撞仍是原有半寬 8，不改傷害、40 米射程、24 米／秒、數量或 80ms 間隔。
- Preset 明訂編輯器半徑 1.1 米；四層改用既有出貨透明素材與 normal 混色，降低外暈並將白色高光改暖橙。
- 同步製作來源、目錄說明與主執行緒／Worker／Preset 快取版本。
- 保留前次實際貫穿命中才派送 hit、未命中不播、致死保留受擊及高塔延後結算修正。

## 修改與檢查

修改：vfx/presets/proj-firehunt-ring.json、tools/vfx/authoring/author/projectiles.cjs、tools/vfx/authoring/vfx-catalog.cjs、js/skills2.js、js/vfx-runtime.js（圓形彈體直徑與資料快取）、js/bridge.js、js/worker/sim.worker.js、index.html、tests/firegod-vfx.test.cjs、tests/firegod-render.test.cjs、docs/AI_TASKS.md、本報告。

唯讀：Core、Runtime 尺寸／派送、sgEmitVfx 幾何透傳、飛行物碰撞、出貨貼圖、Skills2／Status 配置與本機伺服器根目錄。

## 驗證

- node --test tests/firegod-render.test.cjs tests/firegod-vfx.test.cjs tests/skills2-vfx-schema.test.cjs：10/10。
- 渲染測試事件先通過實際 Worker shim 白名單，再使用 Runtime/Core、出貨貼圖及專案 CPU renderer：每秒 10 次普攻、每次 6 枚，1 秒時 50 枚仍在飛行，白色像素為 0，且圓環可見；避免用刪減子彈掩蓋問題。另測預設尺寸不再放大。
- node --test --test-name-pattern="尺寸|sizing|projectile|PROJECTILE" tests/vfx-runtime.test.cjs：9/9 尺寸與投射物回歸通過。
- 模擬測試釘住畫面尺寸與碰撞半寬、飛行時間、貫穿兩敵及高塔命中。
- node tools/build_check.cjs：398 檔通過。
- node tools/vfx/export-assets.cjs --check：最新；git diff --check 通過。
- 初次嘗試新增透明貼圖時，Windows 鎖定匯出樹導致 rename EPERM，工具完整回復。改沿用已出貨透明 slash_02／fire_01，無需重新匯出或更動貼圖索引。
- 已向使用者展示 4 秒實際 Runtime 連發動圖。未進行完整遊戲／GPU 實戰驗證，不能據此保證整體 FPS 或其他技能混合場景。

## 交付

素材庫由 vfx-library-root 解析，保存 codex-authored/firegod/proj-firehunt-ring.json，與遊戲版逐位元組一致；素材 Commit 49432e4。遊戲 Commit 為本報告所在提交。無新點陣貼圖。

無未完成實作，可供使用者合併；未合併／推送。下一步重新載入 8123 後確認實戰觀感。
