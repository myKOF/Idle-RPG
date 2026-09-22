# FIREGOD-VFX-20260922

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
