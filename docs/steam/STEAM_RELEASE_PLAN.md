# Steam 上市工程化計畫（架構分析版）

> 2026-11-17 Claude 依「Steam 上市前工程化與上架規範」盤點專案後撰寫。
> 規範的大方向（Electron、steamworks.js、SteamPipe、禁止自帶更新器、存檔遷移）全部採用；
> 但規範假設的技術棧與本專案不同，以下逐條列出**必須修正的地方**，再拆成可獨立提交的任務。

---

## 1. 規範假設 vs 專案實際

| 規範假設 | 專案實際 | 影響 |
|---|---|---|
| TypeScript / Phaser 2D / Vite | **零建置**原生 JS（93 支 `js/*.js`、`index.html` 直接 `<script>` 載入）、PixiJS v8 本地 vendor、three.js 動態 `import()`、模擬層在 **Web Worker**（`js/bridge.js` → `js/worker/sim.worker.js` 以 `importScripts` 載入） | 沒有 `dist/`、沒有 `vite.config.ts`，規範的 Vite 步驟全部不適用 |
| 打包後 `loadFile('dist/index.html')`（`file://`） | 大量 `fetch()`（配置、Preset、音效、圖集）、`new Worker()`、ES module `import()`、importmap | **在 `file://` 下這些全部會失敗**（Chromium 對 file 協議擋 Worker／module／fetch）。必須改用 Electron 自訂協議 `app://` 伺服本機檔案 |
| 開發環境載 `http://localhost:5123` | 內測服是 `tools/test_server_manager.cjs` 起的 5500 等本機伺服器；`isInternalServer()`／`isGMHost()` 以 `localhost`、`127.0.0.1`、**`file:`** 判定開放 GM 與內測工具 | 若正式版走 `file://` 或 localhost，**玩家會拿到 GM 指令與內測工具**。`app://` 主機名不在名單內，天然關閉；開發模式另以啟動參數打開 |
| 存檔只靠 `localStorage`，改用 `userData` JSON | 存檔已是三層：IndexedDB 自動存檔＋File System Access 資料夾（`showDirectoryPicker`）＋localStorage 小索引；`save_origin.js` 以 origin 標記防跨網址接手；`tablock.js` 以 `navigator.locks` 防多分頁 | 不是「從 localStorage 搬家」，而是**在既有落地層 `js/storage.js` 加一個 Electron 後端**，序列化與格式完全不動 |
| 需實作成就系統 | 遊戲內已有 **115 條成就**（`config/CSV/Achievement.csv` → `js/achievement_data.js`，Worker 判定） | Steam 成就是「把既有達成事件轉發出去」，不另建第二套判定 |
| 實作 `saveVersion` 與遷移腳本 | 已有 `migrateSave()`（`js/save.js:311`）＋冪等正規化＋具名一次性遷移旗標（`ONE_TIME_MIGRATIONS.md`）；存檔 `version` 恆為 1；目前政策是「上線前刪檔重來」 | 不新增平行機制；**上市前凍結一個基準版本**，之後所有結構變更沿用既有 migrateSave 規則並補一個遞增的 `schemaVersion` |

## 2. 必須修正的技術決策

### 2.1 不用 `file://`，改用自訂協議
- 主行程在 `app.whenReady()` 之前 `protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard, secure, supportFetchAPI, corsEnabled, stream } }])`，
  再以 `protocol.handle('app', …)` 把 `app://game/...` 對應到打包資源目錄（拒絕跳出根目錄的路徑）。
- 好處：Worker／fetch／import 全部照網頁版行為運作；origin 固定為 `app://game`，IndexedDB 與 localStorage 作用域穩定，換安裝路徑不會遺失（規範擔心的問題由此解決）。
- `?v=` 快取參數照留，協議處理器忽略 query 即可。

### 2.2 GM／內測工具的開關
- 正式版：`app://game` 不符合 `isInternalServer()`／`isGMHost()`，自動關閉。
- 開發版：Electron 以 `--url=http://127.0.0.1:<埠>/` 改載本機內測服（沿用現有判定，外殼只接受 localhost），**不在遊戲程式裡新增第三種判定**。
- `ai-key-setting.js`（Gemini 金鑰）在正式版不得出現：打包清單排除或維持現有主機判定，驗收時要實測。

### 2.3 存檔落地
- 新增 Electron 後端：`preload.js` 暴露 `desktopSave.read/write/list`，主行程寫入 `app.getPath('userData')/saves/*.json`（先寫暫存檔再 rename，避免斷電半寫）。
- `js/storage.js` 偵測到 `window.desktopSave` 時改走這條，沿用同一份 json 與 meta；IndexedDB 保留為快取。
- File System Access 資料夾功能在桌面版**隱藏**（userData 已是實體資料夾，功能重疊）。
- `tablock.js` 的多分頁鎖由主行程 `app.requestSingleInstanceLock()` 取代（雙開直接聚焦既有視窗）。
- Steam Cloud：後台 Auto-Cloud 指向 `%APPDATA%/<應用名>/saves/*.json`，零程式碼；由 2.3 保證檔案只在固定目錄。

### 2.4 Steam 成就
- Worker 已在達成時產生事件；主執行緒收到後經 `preload` 呼叫主行程 `steamworks` 的 `activate`。
- 對照表：遊戲成就 id → Steam API 名稱（`ACH_001`…），放進成就配置表的新欄位，**不寫死在程式**（遵守配置表規則）。
- 開機時把存檔內已達成者補發一次（離線達成、或先玩後裝 Steam 的情況）。
- 所有 Steam 呼叫包 `try/catch`；`steamworks.init` 失敗＝離線模式，遊戲照常。

### 2.5 打包內容清單
- 目前 `images/` 約 1.1 GB（`intro-parchment` 402 MB、`models` 302 MB），根目錄還有 `sim_*`、`scratch`、`tools`、`tests`、各種 `.py/.patch`。
- 需要一份**白名單**（`index.html`、`js/`、`css/`、`fonts/`、`audio/`、`config/` 中執行期讀取的檔、`vfx/` 執行期部分、實際引用的 `images/`），而非黑名單。
- 建議寫一支掃描工具列出執行期實際引用的資源，第一次就能看出可省多少；這直接影響玩家下載量與每次 SteamPipe 增量大小。

## 3. 需要使用者提供或在專案外完成（Agent 做不到）

| 項目 | 原因 |
|---|---|
| Steamworks 帳號、App 費用、正式 **AppID／DepotID** | 開發期可用測試 AppID `480`，正式值由你填入設定檔 |
| 下載 Steamworks SDK（`steam_api64.dll`、`ContentBuilder`） | 需登入 Steamworks 後台下載；steamworks.js 的 npm 套件已內含 dll，SDK 主要是要 ContentBuilder／SteamCMD |
| SteamCMD 首次登入與 Steam Guard 驗證 | 帳號密碼與驗證碼只能由你本人輸入；腳本只讀取環境變數中的帳號名，不存密碼 |
| 後台設定 Auto-Cloud 路徑、成就（名稱／圖示）、Set Build Live | 皆為 Steamworks 網頁操作 |
| 程式碼簽章（選配） | 降低 SmartScreen／防毒誤報，需購買憑證 |

## 4. 任務拆分（每項可獨立測試、獨立提交）

| 任務 | 內容 | 依賴 | 驗收 |
|---|---|---|---|
| **A. 桌面殼** | `electron/main.cjs`、`preload.cjs`；`app://` 協議；視窗（預設 1920×1080 無邊框、可切全螢幕）、隱藏選單；`in-process-gpu`；`--dev` 載內測服；`requestSingleInstanceLock`；`package.json` 加 `electron` 與 `npm run desktop` | 無 | 戰鬥、Worker、3D 主角、音效、VFX Preset 全部可用；GM 與內測工具在正式模式不可見 |
| **B. 打包白名單＋electron-builder** | 資源掃描工具、白名單、`win` `dir` 目標輸出 `win-unpacked`（x64） | A | 打包資料夾啟動正常；記錄打包前後大小 |
| **C. 桌面存檔後端** | `desktopSave` IPC、`storage.js` 分支、原子寫入、隱藏資料夾存檔 UI | A | 存讀、強制關閉後重開不壞檔、換安裝目錄存檔仍在；既有存檔相關測試不新增失敗 |
| **D. Steamworks 接入** | `steamworks.js`、`restartAppIfNecessary`、Overlay、成就轉發＋開機補發、配置表新欄位、`steam_appid.txt`（僅開發） | A（C 不必） | AppID 480 下 Shift+Tab 可呼出；離線／未開 Steam 不崩潰 |
| **E. SteamPipe 管線** | `steam/` 下 `app_build_*.vdf`、`depot_build_*.vdf` 範本、`deploy_steam.ps1`（build_check → test → 打包 → 刪 `steam_appid.txt` → `steamcmd +run_app_build`），憑證不進 Git | B | 用 `-preview` 模式跑過（不實際上傳） |
| **F. 存檔版本凍結** | 上市基準 `schemaVersion`、更新 `ONE_TIME_MIGRATIONS.md` 原則（上市後不再刪檔）、遷移測試範本 | 無 | 文件與一條遷移測試 |

建議順序：**A → B →（C、D 可並行）→ E**；F 可隨時做，但必須在第一次對外上傳之前完成。

### 4.1 任務 A 實作紀錄（2026-11-17，已完成）

| 檔案 | 內容 |
|---|---|
| `electron/main.cjs` | 主行程：`app://game` 協議（含 Range 206）、權限白名單、單一實例、關窗前 `WorkerBridge.saveAutoNow()`（12 秒保底）、F11／Alt+Enter 代按遊戲自己的網頁全螢幕、擋外部導覽、`userData` 固定為 `%APPDATA%/idle-rpg`、日誌 `userData/logs/desktop.log` |
| `electron/app-protocol.cjs` | 路徑解析（擋穿越與點開頭路徑）、MIME、Range 計算；`tests/desktop-app-protocol.test.cjs` |
| `electron/preload.cjs` | `window.ApexHost`（沿用 `js/ui.js` 既有約定）：`isDesktop`、`quit()`；`openSaveFolder` 留給任務 C |
| `electron/smoke.cjs` | 冒煙測試：開始選單 → 新遊戲／繼續 → 等揭幕 → 環境檢查、截圖、全螢幕往返、關窗存檔 |
| `js/start-menu.js` | 「離開遊戲」在桌面版呼叫 `ApexHost.quit()`（網頁版維持重新整理） |
| `package.json` | `electron@44.10.1`（精確版本）、`main`、三支指令 |

指令：

```
npm run desktop          # 正式模式（最大化後自動全螢幕）
npm run desktop:dev      # 視窗模式＋F12 開發者工具＋F5 重新整理
npm run desktop -- --dev --url=http://127.0.0.1:8124/   # 載本機內測服（GM 開放）
npm run desktop:smoke    # 冒煙測試，結果在 tmp/desktop-smoke/
```

實測結果（冒煙測試連跑兩次，第二次走「繼續」）：Worker 開機、Pixi 戰場、VFX Preset 302 份、IndexedDB、`navigator.locks`、fetch、影片 Range 206 均正常；
`isInternalServer()`／`isGMHost()` 皆為 false；全螢幕進出正常；關窗存檔回 ok，重開後「繼續」出現；頁面錯誤 0。

觀察到但未處理（列入後續任務）：
- 開機前頁面就讀 131 個檔、34 MB；冷磁碟快取時載入要 20～30 秒，熱快取 2.4 秒 → 任務 B 一併評估延後載入。
- 視窗被其他視窗完全遮住時 Chromium 會把頁面判成隱藏、停止畫格，Loading 會等到視窗露出才揭開（與瀏覽器分頁行為相同）。
- 全螢幕按鈕的提示文字寫的是「網頁全螢幕」，桌面版語意略不準，屬文字調整，未改。
- 3D 主角（three.js `import()`）在冒煙測試的存檔沒有開啟，未實測。

## 5. 明確不做

- `electron-updater` 或任何自行下載更新的機制（Steam 規範禁止，與原規範一致）。
- 遠端 JSON 覆寫數值：目前遊戲沒有聯網需求，引入會多一條「離線時用哪份數值」的分歧，上市後若真有需要再評估。
- 改寫成 TypeScript／Vite：與 Steam 上架無關，且違反零建置架構。

## 6. 技術風險

| 風險 | 說明 | 對策 |
|---|---|---|
| Steam Overlay 與 Pixi WebGL | Electron Overlay 需 `in-process-gpu` 與持續重繪，曾有黑屏／閃爍回報 | 任務 D 以 480 實測；不行再試 `electronEnableSteamOverlay(true)` 的強制重繪參數 |
| 首次 origin 改變 | 桌面版 origin 為 `app://game`，`save_origin.js` 會把網頁版留下的資料夾存檔視為外來而詢問 | 上市是新局，屬預期行為；若要讓內測玩家帶檔，另做匯入 |
| 下載量 | 1.1 GB 圖片若全帶，首裝與每次更新都重 | 任務 B 白名單 |
| 計時器餓死／效能 | 已知 rAF 飽和問題（見記憶與 `docs`），Electron 的 `disable-frame-rate-limit` 可能讓主執行緒更滿 | **預設不開** `disable-frame-rate-limit`，維持 vsync |
