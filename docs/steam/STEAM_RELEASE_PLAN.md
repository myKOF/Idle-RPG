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
- 目前 `images/` 約 1.1 GB，包含後來移至 `opening_animation` 的序章影片，以及 `models` 302 MB，根目錄還有 `sim_*`、`scratch`、`tools`、`tests`、各種 `.py/.patch`。
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
| `electron/main.cjs` | 主行程：`app://game` 協議（含 Range 206）、權限白名單、單一實例、關窗前 `WorkerBridge.saveAutoNow()`（12 秒保底）、原生視窗全螢幕與遊戲頂欄及 F11／Alt+Enter 同步、擋外部導覽、`userData` 固定為 `%APPDATA%/idle-rpg`、日誌 `userData/logs/desktop.log` |
| `electron/app-protocol.cjs` | 路徑解析（擋穿越與點開頭路徑）、MIME、Range 計算；`tests/desktop-app-protocol.test.cjs` |
| `electron/preload.cjs` | `window.ApexHost`（沿用 `js/ui.js` 既有約定）：`isDesktop`、`quit()`；`openSaveFolder` 留給任務 C |
| `electron/smoke.cjs` | 冒煙測試：開始選單 → 新遊戲／繼續 → 等揭幕 → 環境檢查、截圖、全螢幕往返、關窗存檔 |
| `js/start-menu.js` | 「離開遊戲」在桌面版呼叫 `ApexHost.quit()`（網頁版維持重新整理） |
| `package.json` | `electron@44.10.1`（精確版本）、`main`、三支指令 |

指令：

```
npm run desktop          # 正式模式（直接進入原生全螢幕）
npm run desktop:dev      # 視窗模式＋F12 開發者工具＋F5 重新整理（雙擊「啟動桌面版.bat」）
npm run desktop:internal # 內測模式（雙擊「啟動桌面版(內測).bat」），見下方說明
npm run desktop -- --dev --url=http://127.0.0.1:8124/   # 載本機內測服（GM 開放）
npm run desktop:smoke    # 冒煙測試，結果在 tmp/desktop-smoke/
```

Windows 標題列的「最大化」會進入原生全螢幕，退出時恢復原視窗的尺寸與位置。

**內測模式（`--internal`，2026-11-18 加）**：不需要另外開內測服。外殼改用 `app://localhost` 伺服同一個資料夾，
遊戲既有的 localhost 判定（`isGMHost()`／`isInternalServer()`、參數自動重載）就照網頁內測服的方式打開，
遊戲程式沒有改。三個隔離：
- 存檔另放 `%APPDATA%\idle-rpg-internal\saves`，GM 改過的存檔不會混進正式存檔與 Steam Cloud；兩種模式可以同時開。
- 一律不接 Steam：GM 能直接解鎖成就，會解到真正的帳號上。
- 只限從原始碼執行：打包版看到 `--internal` 直接忽略（記在 desktop.log），玩家不能用 Steam 啟動選項打開 GM。
協議一次只伺服一個主機名（正式模式拒絕 `app://localhost`、內測模式拒絕 `app://game`）；冒煙測試加 `--internal` 時改成檢查「GM 必須開、Steam 必須關」。

實測結果（冒煙測試連跑兩次，第二次走「繼續」）：Worker 開機、Pixi 戰場、VFX Preset 302 份、IndexedDB、`navigator.locks`、fetch、影片 Range 206 均正常；
`isInternalServer()`／`isGMHost()` 皆為 false；全螢幕進出正常；關窗存檔回 ok，重開後「繼續」出現；頁面錯誤 0。

**修正（同日，使用者回報雙擊 bat 只看到空白視窗）**：`in-process-gpu` 單獨開時，頁面正常執行、
`capturePage` 也截得到遊戲，但螢幕上是一片淡青色——合成結果送不上螢幕。已改為預設關閉、需要時加 `--in-process-gpu`；
Steam Overlay 需要它，任務 D 會和 `disable-direct-composition` 一起實測。
冒煙測試因此新增「螢幕實拍」檢查（截整個螢幕再裁視窗範圍，內側亮度標準差 < 6 即判空白），
並輸出 `ok`／`failures` 與結束碼；開 `--in-process-gpu` 跑冒煙測試會得到「螢幕上是空白畫面」、結束碼 1。

觀察到但未處理（列入後續任務）：
- 開機前頁面就讀 131 個檔、34 MB；冷磁碟快取時載入要 20～30 秒，熱快取 2.4 秒 → 任務 B 一併評估延後載入。
- 視窗被其他視窗完全遮住時 Chromium 會把頁面判成隱藏、停止畫格，Loading 會等到視窗露出才揭開（與瀏覽器分頁行為相同）。
- 3D 主角（three.js `import()`）在冒煙測試的存檔沒有開啟，未實測。

### 4.2 任務 B 實作紀錄（2026-11-17，已完成）

```
npm run desktop:pack                      # → dist/win-unpacked/IdleRPG.exe 與 dist/ship-report.json
node tools/desktop/build_desktop.cjs --stage-only   # 只產生出貨清單與報告，不打包
dist/win-unpacked/IdleRPG.exe --smoke=tmp/smoke-packaged   # 對打包版跑冒煙測試（背景、不顯示視窗）
```

| 檔案 | 內容 |
|---|---|
| `tools/desktop/ship-rules.cjs` | 出貨白名單：git 追蹤 ∩ 執行期根目錄 − 排除規則；授權檔一律保留 |
| `tools/desktop/build_desktop.cjs` | 硬連結暫存到 `build/desktop/app/` → electron-builder `dir` x64 → `dist/win-unpacked/`；寫出貨報告 |
| `tests/desktop-ship-rules.test.cjs` | index.html 引用全出貨、程式寫死的資源路徑全出貨、逐檔排除的檔沒被引用、授權檔保留 |
| `electron/smoke.cjs` | 新增 404 檢查（打包版少檔的直接訊號）；預設背景執行，`--smoke-onscreen` 才顯示視窗做螢幕實拍與全螢幕往返 |

結果：出貨 2479 個檔、754 MB（排除 418 MB，其中序章剪輯舊版影片 352 MB）；`win-unpacked` 共 1074 MB（Electron 本體約 320 MB）。
打包版冒煙測試連跑兩次通過：404 為 0、頁面錯誤 0、GM 關閉、關窗存檔 ok、第二次走「繼續」。
第一版打包時 404 檢查抓到 `index.html` 載入的 `tools/startup-diagnostics.js` 沒出貨，已加進白名單並由測試守住。

決策：
- **asar: false**：SteamPipe 以區塊比對，單一 asar 內任何檔案長度變動都會讓後面區塊位移，小更新也可能整包重下；asar 也不提供保護。
- **白名單以目錄為單位**：圖示、怪物圖、glb 外部貼圖（例如 `role5.glb` 引用 `role5/base.jpg`）大量用拼接或由資料引用，grep 證明不了沒被用到；沒把握的一律出貨。
- **只留繁中與英文的 Chromium 語系檔**；打包後刪除 Electron 的 `default_app.asar`。

待確認（目前用暫定值，不影響開發）：
- 產品名稱＝遊戲正式名稱，讀 String 表 2569（AI_RULES 8.11）：中文版「神力之巔」、英文版「Idle: Divine Apex」（`--lang=en`）。可打包 12 種語言（`--lang=zh-TW|zh-CN|en|ru|es|pt-BR|ja|ko|de|fr|pl|tr`），語言欄沒填時退回英文名稱，安裝程式介面跟著換語言。exe 檔名 `IdleRPG.exe`（刻意用 ASCII）、appId `com.idlerpg.desktop`——見 `tools/desktop/build_desktop.cjs` 開頭。
- **應用程式圖示**：目前是 Electron 預設圖示；需要一張 256×256 以上的正式圖（`images/icon_avatar.png` 其實是 JPEG，不能直接用）。
- `npm audit` 回報 electron-builder 相依的 minimatch 有 6 個中度 ReDoS，只在開發機打包時執行，不進遊戲。

未處理：
- 開機前讀 34 MB 的延後載入（任務 A 觀察到）沒有在這次動：它是遊戲載入流程的改動，不是打包問題，建議另開任務。
- `audio/ui-preview/`（15.8 MB）多數是音效試聽候選，但檔名可能被拼接使用，這次保留；確認哪些在用後可再瘦身。

### 4.3 任務 C 實作紀錄（2026-11-17，已完成）

**做法：給既有的資料夾存檔一個「桌面版目錄把手」，而不是另寫一套存檔。**
`js/save.js` 的資料夾存檔（自動存檔檔、手動存檔、清單、刪除、開機挑最新）全部建立在 File System Access 的目錄把手 `_saveDir` 上，
取得把手的唯一入口是 `idbGetDir()`。桌面版在那裡交出 `js/desktop-save-dir.js` 的替身把手，底層走 IPC 寫進 `userData/saves/`，
整套流程、存檔格式（gzip JSON）、檔名、開機挑最新的規則都與網頁版相同。

| 檔案 | 內容 |
|---|---|
| `electron/save-files.cjs` | 主行程端：檔名白名單（單層 `*.json`）、原子寫入（暫存檔＋fsync＋rename，Windows 檔案被占用時退避重試）、覆寫前留 `.bak`、同檔寫入依抵達順序排隊、開機清掉中斷的暫存檔 |
| `electron/main.cjs` | `saves:list/read/write/remove/open-folder` IPC；只回應主視窗、且頁面停在遊戲 origin 時 |
| `electron/preload.cjs` | `ApexHost.saves`、`ApexHost.openSaveFolder`（設定頁「開啟存檔資料夾」按鈕因此自動出現） |
| `js/desktop-save-dir.js` | File System Access 目錄／檔案把手的替身（網頁版為 `null`） |
| `js/save.js` | `idbGetDir()` 桌面版回傳替身；桌面版不叫出資料夾選擇器（資料夾固定） |
| `js/storage.js` | 桌面版每次 auto／autoNow（關窗）／shutdown／restart 寫完 IndexedDB 後接著寫自動存檔檔；手動存檔直接寫成檔案 |
| `tests/desktop-saves.test.cjs` | 檔名白名單、原子寫入與 `.bak`、寫入排隊、替身把手、端到端（真的 save.js／storage.js 寫檔並在下次開機讀回） |

**為什麼每次自動存檔都要寫檔**：Electron 的 IndexedDB 本來就在 userData 的硬碟上、origin 也固定，本機不會遺失；
但 IndexedDB 是資料庫檔，**Steam Cloud 只能同步一般檔案**。網頁版的資料夾每 10 分鐘才同步一次，
桌面版若照舊，玩家關遊戲時雲端拿到的可能是 10 分鐘前的進度。寫檔失敗不算存檔失敗（IndexedDB 已寫入，15 秒後會重試）。

**Steam Auto-Cloud 設定（任務 E 上傳前到 Steamworks 後台填）**：
- Root：`WinAppDataRoaming`
- Subdirectory：`idle-rpg/saves`
- Pattern：`*.json`（`.bak` 與暫存檔刻意不是 `.json`，不會被同步）
- 自動存檔檔名：`IC_autosave_app-game.json`；手動存檔：`IC_manual_*.json`

驗證：
- `tests/desktop-saves.test.cjs` 13 項通過；拿掉「自動存檔同步寫檔」的突變會讓其中 2 項變紅。
- 載入 save.js／storage.js 的 66 支既有測試：改動前後失敗名單完全相同（各 110 項，皆為既有失敗）。
- 背景冒煙測試：自動存檔檔寫進 `userData/saves`，第二次開機走「繼續」；**刪掉 IndexedDB 與 Local Storage、只留 `saves/` 的 JSON（模擬 Steam Cloud 拉到新電腦）仍能接回進度**。

踩坑：打包工具只打包 git 追蹤的檔案，新增的 `save-files.cjs` 未提交就打包，打包版一啟動就崩潰並跳出錯誤對話框。
已加兩道防線：打包前發現執行期目錄有未追蹤的檔案就中止並列出；冒煙模式下主行程例外改為印出並以結束碼 1 退出，不跳對話框。

未處理：
- 手動存檔超過 10 份時，清單索引會丟掉最舊的，但資料夾裡的檔案不會刪（網頁版既有行為）。雲端配額吃緊時再處理。
- 網頁版玩家的存檔無法自動搬進桌面版（origin 不同）；如需要，另做「匯入存檔」流程。

### 4.4 任務 D 實作紀錄（2026-11-17，程式完成；Steam 實機驗證待做）

| 檔案 | 內容 |
|---|---|
| `electron/steam.cjs` | steamworks.js 初始化、`restartAppIfNecessary`、Overlay、成就解鎖（已達成的不重送、整批只 `stats.store()` 一次）；任何失敗都只是「Steam 功能關閉」 |
| `electron/steam-config.json` | **正式 AppID 填這裡**（目前 0＝不接 Steam）；測試確保提交的值不是 480 |
| `electron/main.cjs` | app ready 前初始化 Steam（Overlay 的 GPU 參數只在 ready 前有效）；`steam:status`／`steam:activate-achievements` IPC |
| `js/desktop-steam.js` | 成就轉發：即時解鎖（`js/ui.js` 的 `achievementUnlocked` 通知）＋開機補發（`js/main.js` 的 `enterGame(save)` 讀 `achv.got`） |
| `tools/desktop/build_desktop.cjs` | 打包時只帶 win64 的 steamworks.js 到 `electron/vendor/`（不走 electron-builder 的 node_modules 收集） |
| `tools/desktop/steam_achievements.cjs` | 產生 `dist/steam-achievements.csv`：115 條成就的 API 名稱／顯示名稱／說明／圖示，供後台建立成就 |
| `tests/desktop-steam.test.cjs` | AppID 規則、各種失敗容錯、成就過濾、編號→API 名稱、轉發與接線（13 項） |

決策：
- **成就 API 名稱用命名規則 `ACH_` + 三位數編號，不在配置表加欄位**（計畫原本寫加欄位）。理由：不必動 Excel（欄位順序會被調整、寫回有錯位風險），115 條名稱永遠一致；日後某條需要特殊名稱再加欄位。
- **不需要 `steam_appid.txt`**：`init(appId)` 直接帶 AppID，也就沒有「上傳前忘了刪」的風險。開發測試用 `--steam-appid=480`。
- **`restartAppIfNecessary` 只在「打包版＋設定檔的正式 AppID＋非開發／冒煙」時呼叫**，開發跑 480 不會被踢掉。

已驗證（Steam 用戶端未執行的情況）：
- 沒設定 AppID：不載入 steamworks.js，遊戲照常。
- `--steam-appid=480`、Steam 沒開：原生模組與 `steam_api64.dll` 正常載入（開發與打包版皆是），回報「Steam 未連線」，遊戲照常、冒煙測試通過。

**Steam 實機（2026-11-17，Steam 用戶端已登入，`--steam-appid=480`）**：
- 連線成功（日誌「已連線，AppID 480」）。
- Steam 的 `gameoverlayrenderer64.dll` 已注入遊戲行程。
- 開著 Overlay 的兩個 GPU 參數（`in-process-gpu`＋`disable-direct-composition`），螢幕實拍是正常的開始選單，**沒有任務 A 的空白畫面**。

**待做**：
- 按 Shift+Tab 是否真的叫出 Overlay：實測時使用者正在用電腦，截圖被切到別的視窗，沒有拍到。只需要在 480 下手動按一次確認。
- 注意：用 `steam.exe -silent` 背景啟動 Steam 後，遊戲連線時 Steam 主視窗仍會跳到最前面；自動化測試送按鍵前必須確認遊戲在前景（否則會落到 Steam 用戶端）。
- 成就解鎖要等正式 AppID 的後台建好成就（480 的 Spacewar 沒有 `ACH_###`，送出會記為失敗，這是預期的）。
- 後台成就圖示：Steam 要 64×64 JPG（已達成／未達成灰階各一），由 `images/achievements/` 轉檔，任務 E 處理。

### 4.5 任務 F 實作紀錄（2026-11-17，已完成）

規則全文見 `ONE_TIME_MIGRATIONS.md` 最上方「上市後的存檔遷移」。

| 檔案 | 內容 |
|---|---|
| `js/save-schema.js` | `SAVE_SCHEMA_VERSION = 1`（上市基準）、`SAVE_SCHEMA_MIGRATIONS` 登錄表、執行器、登錄表自我檢查 |
| `js/player.js` | `newGameState()` 帶 `saveSchema` |
| `js/save.js` | `migrateSave()` 開頭（mergeDefaults 之前）取版本、比遊戲新就拒絕；結尾依序執行遷移並標版本 |
| `js/save_origin.js`／`js/start-menu.js` | 開機發現存檔比遊戲新：攔截畫面只能離開，不顯示開始選單 |
| String 表 2528～2530 | 攔截畫面標題、說明、讀檔失敗訊息（以 `excel-update-sheets.ps1` 寫入 String.xlsx） |
| `tests/save-schema.test.cjs` | 登錄表檢查、執行器、真的 migrateSave、開機攔截、接線，以及給上市後照抄的「遷移範本」（13 項） |

決策：
- **既有的具名旗標遷移不動**：它們處理上市前的存檔；上市後新增的結構變更一律走版本號。不是第二套系統，而是上市前後的分界。
- **遷移在 migrateSave 最後執行**：看到的是補齊預設值的存檔，靠版本號判斷新舊，不必再做「mergeDefaults 前偷看欄位」。
  版本號本身必須在 mergeDefaults 之前取得（否則上市前的存檔會被補成目前版本、遷移全部跳過）——有突變測試守住。
- **存檔比遊戲新時完全不給玩**：退回較舊的本機快取或開新遊戲，都會讓自動存檔把較新的雲端存檔覆寫掉。

### 4.6 任務 E 實作紀錄（2026-11-17，腳本完成；正式上傳待 AppID 與 SDK）

| 檔案 | 內容 |
|---|---|
| `tools/steam/steampipe.cjs` | 上傳流程：建置檢查 → 桌面版測試 → 打包 → 打包版背景冒煙 → 內容檢查 → 產生 VDF → SteamCMD；任何一步失敗就停 |
| `tools/steam/steampipe-vdf.cjs` | 設定解析與 VDF 產生（純函式）；`tests/steampipe.test.cjs` 10 項（含 demo 版 3 項） |
| `tools/steam/steampipe.json` | DepotID（0＝AppID+1）、上傳後自動上線的**非預設**分支、排除規則（可提交） |
| `tools/steam/steampipe.local.example.json` | 本機設定範本：SDK 的 ContentBuilder 路徑、帳號名稱（實際檔案 `steampipe.local.json` 已 gitignore） |
| `tools/steam/achievement_icons.cjs` | 後台成就圖示：`dist/steam-achievement-icons/ACH_###.jpg`＋`_locked.jpg`（64×64，115×2 張） |

決策：
- **VDF 由設定產生，不手寫範本**：AppID、DepotID、內容資料夾、建置描述（版本＋commit＋日期）單一來源，不會傳錯 Depot 或舊資料夾。
- **AppID 只有一個來源**：`electron/steam-config.json`。上傳前檢查打包版裡的 AppID 與設定相同（改了沒重新打包就擋下）。
- **腳本永遠不把建置設為 default 分支上線**：那一步到 Steamworks 網頁手動按，避免一個指令就把東西推給所有玩家。可設定自動上線到 `beta` 之類的非預設分支。
- **不碰帳號密碼**：SteamCMD 在終端機當場詢問；Steam Guard 驗證過一次後快取在這台電腦。
- `steam_appid.txt` 一律排除，且打包內容若出現就中止（我們本來就不產生它，見任務 D）。

已驗證：用演練 AppID（`--dry-appid`）完整跑過一次——建置檢查、82 項測試、打包、打包版冒煙、內容檢查、VDF 產生全部通過；
AppID 為 0、預覽或上傳時帶 `--dry-appid` 都會被擋下。**SteamCMD 登入與上傳本身尚未實測**（需要 AppID、SDK 與帳號）。

#### 任務 E：第一次上傳（使用者操作手冊）

1. **拿到 AppID**：Steamworks 完成登記、付 Steam Direct 費用、建立應用程式後，在「所有應用程式」看到的編號。
   填進 `electron/steam-config.json` 的 `appId`，提交。DepotID 若不是 AppID+1，填 `tools/steam/steampipe.json` 的 `depotId`。
2. **下載 SDK**：Steamworks 主控台右側「下載最新版 SDK」，解壓到專案外，例如 `C:\Steamworks\sdk`。
3. **本機設定**：複製 `tools/steam/steampipe.local.example.json` 成 `steampipe.local.json`，填
   `contentBuilderDir`（例如 `C:/Steamworks/sdk/tools/ContentBuilder`）與 `account`（有上傳權限的 Steam 帳號名稱）。
4. **預覽**（不上傳）：`npm.cmd run steam:preview`。第一次會要你在終端機輸入密碼與 Steam Guard 驗證碼。
   成功代表帳號、權限、VDF 都對。
5. **正式上傳**：`npm.cmd run steam:upload`（可加 `-- --note=說明`）。
6. **設為上線**：Steamworks → 你的應用程式 → SteamPipe → Builds，找到這次的建置描述，設為 default 分支上線。
7. **後台其他設定**（一次性）：
   - Steam Cloud：Auto-Cloud，Root `WinAppDataRoaming`、Subdirectory `idle-rpg/saves`、Pattern `*.json`（見 4.3）。
   - 成就：`npm.cmd run steam:achievements` 產生清單（API 名稱／名稱／說明），`npm.cmd run steam:icons` 產生圖示，逐條建立。
   - 啟動選項：執行檔 `IdleRPG.exe`、作業系統 Windows。

### 4.7 Demo 版（Steam 封測，2026-11-18）

**判定**：版本旗標 `GAME_EDITION`（`js/game-edition.js`，主執行緒與 Worker 共載）。提交的檔案永遠是 `'full'`；
demo 版由桌面外殼改寫這個檔的回應（`electron/main.cjs`）——從原始碼執行看 `--demo`，打包版看 `electron/edition.json`
（`npm.cmd run desktop:pack:demo` 只寫進暫存區，輸出 `dist/demo/win-unpacked/`）。遊戲程式、存檔格式只有一份，網頁版永遠是正式版。

**數值與限制**：常數在 `js/data.js`「Demo 版」區塊，來源 game_parameters「11-Demo版」（374～379），正式版一律不讀：

| 參數 | 預設 | 作用位置 |
|---|---|---|
| 敵人經驗倍率 a／b | 1.5／5 | `gainEnemyXp()`（野外擊殺、離線擊殺、封魔塔 BOSS）；熟練度乘在原值上，不吃 a |
| 技能升級金幣倍率 | 0.5 | `skills2UpgradeCost`／`skills2UltCost`（兩端共用，介面顯示與扣款一致） |
| 寶箱鍛造經驗倍率 | 2 | `chestGainSalvageXp` |
| 等級上限 a／轉生 b | 1000／0 | `playerMaxLevel()`；b=0 時轉生確認鈕置灰，Worker `reincarnate()` 也拒絕 |
| 開放場景數 | 2 | `demoZoneOpen()`：Zones 表順序前 N 張；`isZoneUnlocked` 與入口置灰（依進度已出現才顯示「未開放」） |
| 封魔塔開放樓層 | 50 | `towerOpenMaxFloor()`：`startTowerFight` 拒絕；地獄／煉獄頁籤與超過的樓層挑戰鈕置灰 |

提示文字「未開放」是 String 表 2531（`DEMO_NOT_OPEN_STR`）。

**隔離**：demo 存檔在 `%APPDATA%\idle-rpg-demo`（內測＋demo 為 `idle-rpg-demo-internal`），不會帶進正式版；
Steam 用 `electron/steam-config.json` 的 `demoAppId`（Steam 上的 Demo／Playtest 是獨立應用程式，有自己的 AppID 與 Cloud）。

**驗證**：`tests/demo-edition.test.cjs`（11 項，含正式版不變）；桌面冒煙測試核對頁面與 Worker 都讀到外殼決定的版本。
`SMOKE_EXTRA_SCRIPT` 可在冒煙測試裡跑情境腳本（例：GM 拉到 1000 級、打通冰原與試煉之塔，檢查置灰與提示）。

**上傳 demo（SteamPipe，流程已接好，等 demo 的 AppID）**：與任務 E 同一支腳本，加 `--edition=demo`：

| 指令 | 作用 |
|---|---|
| `npm.cmd run steam:vdf:demo` | 只驗證並產生 VDF（不登入）；AppID 未下來前可加 `-- --skip-pack --dry-appid=<假編號>` 演練 |
| `npm.cmd run steam:preview:demo` | SteamCMD 預覽，不上傳 |
| `npm.cmd run steam:upload:demo` | 正式上傳到 Demo 應用程式 |

與正式版不同的地方：

- AppID 讀 `electron/steam-config.json` 的 `demoAppId`。DepotID 讀 `tools/steam/steampipe.json` 的 `demoDepotId`，0 代表 demoAppId+1。上線分支讀 `demoSetLiveBranch`。
- 打包用 `--edition=demo`，內容是 `dist/demo/win-unpacked/`。VDF 與日誌放在 `build/steampipe/demo/`，冒煙暫存在 `tmp/steampipe-smoke-demo/`。
- 防呆，以下任一情況都會停下來不上傳：
  - demoAppId 或 demoDepotId 和正式版相同；
  - 要傳 demo 但打包版沒有 `edition.json`；
  - 要傳正式版但打包版帶著 `edition.json`；
  - 打包版執行起來的頁面或 Worker 版本不是要上傳的版本；
  - 打包版裡的 demoAppId 和設定不同（改了要提交並重新打包）。
- 建置描述會標出 `demo`（例：`v1.0.0 demo abc1234 2026-11-18`）。

第一次上傳 demo 的步驟：

1. 在 Steamworks 的正式遊戲頁面建立 Demo（或 Playtest）應用程式。
2. 把它的 AppID 填進 `demoAppId`，提交。
3. 到 Demo 應用程式的後台，照任務 E 的方式設定 Depot、Auto-Cloud（`saves/*.json`）與啟動選項（`IdleRPG.exe`）。
4. `npm.cmd run steam:preview:demo` 預覽，確認無誤後 `npm.cmd run steam:upload:demo`。
5. 到 Demo 應用程式的 Builds 把這次建置設為上線。

本機設定（`steampipe.local.json` 的 SDK 路徑與帳號）和正式版共用。

### 4.8 安裝包（Steam 以外的測試散佈，2026-11-19）

`npm.cmd run desktop:installer:demo`（正式版：`desktop:installer`）會打出 `dist/installer/<版本>/IdleRPG[-Demo]-Setup-<版號>.exe`（NSIS）。

- **不接 Steam**：暫存區拿掉 steamworks.js，打包版的 `steam-config.json` 換成 AppID 全 0。原因是接了 Steam 的版本如果不是從 Steam 啟動，會交給 Steam 重開、自己結束；AppID 填上之後，裝在 Steam 以外就打不開。
- **與上傳用的資料夾分開**：不會覆蓋 SteamPipe 上傳用的 `dist/win-unpacked`、`dist/demo/win-unpacked`。這份安裝包不能拿去上傳 Steam。
- **安裝方式**：裝在使用者資料夾（`%LOCALAPPDATA%\Programs\…`），不需要系統管理員權限；可以改安裝位置；會建立桌面與開始功能表捷徑。
- **兩個版本互不覆蓋**：demo 的 appId 是 `com.idlerpg.desktop.demo`，和正式版不同，兩個版本可以同時安裝。
- **存檔保留**：解除安裝不刪存檔。存檔位置和其他打包版相同：demo 在 `%APPDATA%\idle-rpg-demo`，正式版在 `%APPDATA%\idle-rpg`。
- **未簽章**：第一次執行時 Windows SmartScreen 會跳出警告，要按「其他資訊 → 仍要執行」。
- 測試：`tests/desktop-installer.test.cjs`。

**打包時縮模型貼圖**（2026-11-19）：

- **做什麼**：`build_desktop.cjs` 預設會在暫存區把 `images/models/` 的貼圖縮到最長邊 1024。工具是 `tools/desktop/shrink_models.cjs`，以 Electron 執行，不需要另外安裝套件。
  - `.glb` 內嵌貼圖：改存 JPEG（法線貼圖品質 95、其餘 90）。半透明材質的底色貼圖維持 PNG。
  - 外部貼圖（主角 role5～7）：只縮尺寸，格式不變。
- **效果**：模型 367 → 111 MB。原版與壓縮版用遊戲本身的繪製流程對照，PSNR 50 dB 以上，放大 3 倍也看不出差別。
- **原始檔不動**：專案裡的 2048 原檔保留，給 Meshy／Blender 流程使用。
- **快取**：結果存在 `build/desktop/model-cache/`，第二次打包直接取用。
- **要出原尺寸**：打包時加 `--full-textures`。
- 測試：`tests/desktop-shrink-models.test.cjs`。

**打包時 PNG 換成 WebP**（2026-11-19）：

- **做什麼**：`build_desktop.cjs` 預設在暫存區把 PNG 換成 WebP 內容，**檔名不變**。工具是 `tools/desktop/webp_images.py`，需要 Python 與 Pillow。
  - 角色序列幀（`images/sprites/`，以最近鄰放大）和長邊 256 以下的小圖：用**無損**，逐像素和原圖相同。
  - 其他圖：有損品質 90；透明度一律無損，透明區底下的顏色也保留。
  - 不處理 `electron/`（exe 圖示）與 `images/models/`（另由縮模型貼圖的工具處理）。
- **為什麼檔名不變**：程式、配置表、Preset 裡的路徑都寫 `.png`，而且 `images/vfx/assets` 會被 VFX 編輯器整棵換新，改副檔名不可行。改由 app:// 協議看檔頭回報 `image/webp`（`electron/app-protocol.cjs` 的 `sniffImageMime`），網頁版完全不受影響。
- **效果**：PNG 309 → 83 MB（1437 個轉換；省不到 10% 或 2 KB 的保留原檔）。
- **驗證**：
  - 無損的 1087 個逐像素相同；有損的 350 個透明度不變，PSNR 中位數 42 dB、最差 32.8 dB。
  - 在打包版裡 1550 張逐一以 fetch、createImageBitmap、`<img>`、Pixi 載入都正常。
- **快取**：`build/desktop/webp-cache/`。
- **要出原本的 PNG**：打包時加 `--keep-png`。
- 測試：`tests/desktop-webp-images.test.cjs`。
- **注意**：打包版資料夾裡的 `.png` 其實是 WebP。要從打包版取圖，請回專案取原檔。

**打包時重新編碼序章影片**（2026-11-19）：

- **做什麼**：`build_desktop.cjs` 預設在暫存區重壓 `.mp4`。工具是 `tools/desktop/reencode_video.cjs`，需要 ffmpeg（`winget install Gyan.FFmpeg`）。
- **編碼設定**：x264 slow、CRF 24、H.264 High、yuv420p、每 2 秒一個關鍵幀、faststart、不帶音軌。原檔本來就沒有音軌，有音軌的影片一律保留原檔。
- **為什麼維持 H.264**：所有顯示卡都有硬體解碼。AV1 更小，但不少電腦只能靠 CPU 解碼，序章又和遊戲載入同時進行，低階機可能卡頓。
- **試壓結果**（VMAF 對照原檔）：

  | CRF | 大小 | VMAF |
  |---|---|---|
  | 原檔 | 96 MB | — |
  | 20 | 77 MB | 95.1 |
  | 22 | 60 MB | 93.6 |
  | 24（採用） | 46 MB | 91.8 |

  採用 CRF 24：抽最暗的兩幀與差異最大的一幀局部放大 2 倍比對，看不出差別。
- **輸出驗證**：幀數、時長、解析度、幀率必須和原檔相同，否則保留原檔。序章的字幕與動畫依時間對齊，所以這幾項不能變。
- **快取**：`build/desktop/video-cache/`。
- **要出原檔**：打包時加 `--keep-video`。
- 測試：`tests/desktop-reencode-video.test.cjs`。

**應用程式圖示**（2026-11-19）：`electron/icons/app.ico`（16～256）與 `app.png`（1024 母圖）。

- **來源**：遊戲 logo 中間的劍，斜 45 度擺放，背景透明。
- **產生工具**：`python -I tools/desktop/make_app_icon.py [--preview]`，需要 Pillow。logo 改版後要重跑；如果摘出來的劍不對，先檢查工具檔頭的實測座標。
- **套用範圍**：exe、捷徑、工作列（`win.icon`），以及安裝包、解除安裝程式、安裝畫面（`nsis.*Icon`）都用它。
- **從原始碼執行時**：由 `electron/main.cjs` 的 BrowserWindow `icon` 帶上同一個圖示。
- **Steam 後台**：Steamworks 的應用程式圖示是另外上傳的，尺寸規格不同。

## 5. 明確不做

- `electron-updater` 或任何自行下載更新的機制（Steam 規範禁止，與原規範一致）。
- 遠端 JSON 覆寫數值：目前遊戲沒有聯網需求，引入會多一條「離線時用哪份數值」的分歧，上市後若真有需要再評估。
- 改寫成 TypeScript／Vite：與 Steam 上架無關，且違反零建置架構。

## 6. 技術風險

| 風險 | 說明 | 對策 |
|---|---|---|
| Steam Overlay 與 Pixi WebGL | Electron Overlay 需 `in-process-gpu`；本機實測單獨開它畫面全白（見 4.1） | 任務 D 以 480 實測 `in-process-gpu`＋`disable-direct-composition`，冒煙測試的螢幕實拍必須通過才改預設 |
| 首次 origin 改變 | 桌面版 origin 為 `app://game`，`save_origin.js` 會把網頁版留下的資料夾存檔視為外來而詢問 | 上市是新局，屬預期行為；若要讓內測玩家帶檔，另做匯入 |
| 下載量 | 1.1 GB 圖片若全帶，首裝與每次更新都重 | 任務 B 白名單 |
| 計時器餓死／效能 | 已知 rAF 飽和問題（見記憶與 `docs`），Electron 的 `disable-frame-rate-limit` 可能讓主執行緒更滿 | **預設不開** `disable-frame-rate-limit`，維持 vsync |
