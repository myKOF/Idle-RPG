# ANTIGRAVITY_CLI_CAPABILITIES.md

# Antigravity CLI 能力偵測紀錄

調查日期：2026-08-31
調查範圍：VFX 專用工作流（`docs/vfx/VFX_AGENT_WORKFLOW.md`）中 Antigravity 的
UI / Browser / UX QA 角色是否可由 Node 腳本自動呼叫。

本文件只記錄實測結果，不含任何未經驗證的參數。

---

# 1. `agy` 是否存在

**不存在。**

| 檢查方式 | 結果 |
|---|---|
| `agy --help` | `command not found` |
| `agy --version` | `command not found` |
| `which agy` / `command -v agy` | 無 |
| `find` 於兩個 Antigravity 安裝目錄（maxdepth 3）搜尋 `agy*` | 無 |
| npm 全域套件目錄 | 只有 `@anthropic-ai`、`@openai`，無 Antigravity 套件 |

本機沒有名為 `agy` 的任何可執行檔。

---

# 2. 實際存在的 Antigravity CLI

PATH 中有兩個 Antigravity 安裝，兩者都提供 VS Code 風格的 shim：

| 安裝路徑 | 提供的 shim | `--version` |
|---|---|---|
| `D:\Users\user\AppData\Local\Programs\Antigravity` | `antigravity`、`antigravity-ide`（含 `.cmd`） | 1.107.0 / `4e2e10a9285aefbdcb898ae5e50dde45e9c7f505` / x64 |
| `C:\Users\user\AppData\Local\Programs\Antigravity IDE` | `antigravity-ide`（含 `.cmd`） | 1.107.0 / `ecfbad74d93962fc8ca485d93ab9b4f3d4cb6cf8` / x64 |

`--help` 標頭：`Antigravity IDE 1.107.0`，用法列為 `antigravity-ide.exe [options] [paths...]`。

shim 內容顯示這是 **VS Code 1.107 的 launcher CLI**：
`ELECTRON_RUN_AS_NODE=1 "<安裝目錄>\Antigravity.exe" "<安裝目錄>\resources\app\out\cli.js" "$@"`
（shim 檔頭保留 `Copyright (c) Microsoft Corporation`、`VSCODE_WSL_DEBUG_INFO`、`SERVERDATAFOLDER=.antigravity-server`。）

---

# 3. 實際 help 顯示的相關命令

## 3.1 Subcommands（`antigravity --help` 末段原文）

```
Subcommands
  chat         Pass in a prompt to run in a chat session in the current working
               directory.
  serve-web    Run a server that displays the editor UI in browsers.
  tunnel       Make the current machine accessible from vscode.dev or other
               machines through a secure tunnel.
```

其中只有 `chat` 與 agent 自動化有關；`serve-web`／`tunnel` 是遠端存取編輯器 UI，
與 VFX QA 無關，依調查範圍未再深入。

## 3.2 `antigravity chat --help` 原文

```
Usage: antigravity-ide.exe chat [options] [prompt]

To read from stdin, append '-' (e.g. 'echo Hello World | antigravity-ide.exe chat <prompt> -')

Options
  -m --mode <mode>        The mode to use for the chat session. Available
                          options: 'ask', 'edit', 'agent', or the identifier of
                          a custom mode. Defaults to 'agent'.
  -a --add-file <path>    Add files as context to the chat session.
  --maximize              Maximize the chat session view.
  -r --reuse-window       Force to use the last active window for the chat
                          session.
  -n --new-window         Force to open an empty window for the chat session.
  --profile <profileName> Opens the provided folder or workspace with the given
                          profile and associates the profile with the
                          workspace. If the profile does not exist, a new empty
                          one is created.
```

`chat` 的全部選項都是**視窗行為**（maximize／reuse-window／new-window），
沒有任何輸出、格式、逾時或權限選項。

## 3.3 頂層 options 中與自動化沾邊者

- `-w --wait`：等待檔案被關閉才返回（用於編輯器等待，不是任務完成）
- `--user-data-dir <dir>`、`--profile`、`--transient`：資料隔離
- `--log <level>`、`--verbose`、`--telemetry`：診斷輸出
- `--add-mcp <json>`：新增 MCP server 定義到使用者 profile（**會寫入設定，本次未執行**）
- 擴充套件管理（`--install-extension` 等）：與 QA 無關

---

# 4. 已確認能力（依實測 help 逐項）

| # | 能力 | 結論 | 依據 |
|---|---|---|---|
| 1 | non-interactive / headless 執行 | **否** | 無任何 headless 旗標；`chat` 只有視窗選項，執行結果落在 GUI 視窗內 |
| 2 | 直接傳入 prompt | **是** | `chat [prompt]`，另支援結尾 `-` 由 stdin 讀取 |
| 3 | 指定 working directory | **間接** | 無 `--cd`；`chat` 說明為「in the current working directory」，即繼承行程 cwd |
| 4 | 指定 model / agent | **部分** | 有 `-m --mode`（`ask` / `edit` / `agent` / 自訂 mode），**無** model 選項 |
| 5 | read-only 模式 | **否** | 無任何權限旗標；預設 mode 為 `agent`，具備寫檔能力 |
| 6 | browser automation | **否**（CLI 層） | help 中無 browser 相關命令 |
| 7 | screenshot / visual inspection | **否**（CLI 層） | help 中無相關選項 |
| 8 | browser console / network / DOM inspection | **否**（CLI 層） | help 中無相關選項 |
| 9 | 結果輸出到 stdout | **否** | 無此選項；stdout 只有 launcher 訊息 |
| 10 | 最後回覆輸出到檔案 | **否** | 無 `--output`／`--output-last-message` 類選項 |
| 11 | JSON / machine-readable output | **否** | 無 `--json` 類選項 |
| 12 | 設定 timeout | **否** | 無此選項（呼叫端仍可自行以 child_process timeout 殺行程） |
| 13 | 限制不得修改檔案 | **否** | 無沙箱或權限旗標 |
| 14 | 可從 Node child_process 安全呼叫 | **可呼叫，但語意不安全** | shim 可由 `spawn` 執行；但預設 `agent` mode 無法限制寫檔，違反規範 §6.3 |
| 15 | 需要互動式登入或 TTY | **需要 GUI 互動** | 本次未執行 `chat`，無法確認登入狀態；但所有結果都在 IDE 視窗內，必然需要人操作 |

---

# 5. 未確認能力

以下項目本次**刻意未驗證**（調查範圍禁止啟動 GUI、建立 Agent Session、執行實際任務）：

- `antigravity chat` 實際執行時是否會開啟 IDE 視窗、是否需要登入、退出碼語意為何
- `chat` 的 stdin（結尾 `-`）在無 TTY 環境下的行為
- 自訂 mode（`-m <custom mode id>`）能否設定成唯讀或 QA 專用
- Antigravity IDE 內建的 browser / preview / agent 功能是否有 CLI 以外的程式化介面
  （例如擴充套件 API、MCP server、本機 port）
- `serve-web` / `tunnel` 是否可間接用於 QA（本次判定與 QA 無關，未深入）
- `--add-mcp` 反向整合的可行性（會寫入使用者 profile，未執行）

---

# 6. 自動化可行性判斷

## 結論：**C — 不適合 CLI 自動整合**

理由（全部依實測 help，非推測）：

1. **沒有回傳路徑。** CLI 無 stdout 結果、無輸出檔、無 JSON。QA 結論留在 IDE 視窗裡，
   Claude 無法取回，規範 §4.1 中「Antigravity QA → Claude 最終整合」這一段接不起來。
2. **沒有 headless。** `chat` 的選項全是視窗行為，本質是把 prompt 送進 GUI 工作階段。
3. **無法限制寫檔。** 預設 mode 是 `agent`，且無任何唯讀旗標，
   直接抵觸規範 §6.3「Antigravity 在 Claude worktree 執行 QA 時不得修改」。
   Codex 那條路能自動化，關鍵是 `--sandbox read-only` 這種可強制的權限旗標，Antigravity CLI 沒有對應物。
4. **CLI 層沒有 browser / screenshot / console / DOM 能力**，而這正是 Antigravity 在 §3.3 被賦予的職責。

唯一可自動化的部分是**單向派工**：從 Node 呼叫
`antigravity chat -m <mode> "<prompt>"` 把任務丟進 IDE。
但這只是「開視窗」，沒有結果回收、沒有寫入保護，
包成 wrapper 只會製造「已整合」的錯覺，因此不歸類為 B。

---

# 7. 建議下一步

依規範 §3.4，是否採用由使用者決定。以下為建議，未執行：

1. **不建立 `tools/vfx/review-with-antigravity.cjs`。**
   在沒有結果回傳與唯讀保護之前，wrapper 沒有可靠語意。
2. **Antigravity QA 維持人工流程。** Claude 產出「QA 指示書」（要測什麼、預期結果、
   邊界案例），由使用者在 Antigravity IDE 內執行，再把結論貼回給 Claude。
   這與規範 §4.4 的觸發條件相容，只是交付媒介是文件而非 CLI。
   專案已有先例：`docs/ANTIGRAVITY_VFX_UI_TEST_CASES.md`。
3. **VFX Editor 的可測性設計優先於工具整合。**
   若 VFX Editor 的 Preview 與 Runtime 共用同一份渲染核心、且狀態可由 URL 或 JSON 還原，
   多數 QA 可改由 Claude 自己用瀏覽器工具驗證，Antigravity 只需負責人類主觀的
   UX / usability 判斷——那正是它不可被自動化取代的部分。
4. **若之後仍要程式化整合**，該查的是 CLI 以外的介面（IDE 擴充 API、MCP server），
   而不是再嘗試 `chat` 的旗標組合。本文件第 5 節已列出未確認項目。

---

# 8. 本次調查的執行邊界

- 只執行了 `--version`、`--help`、`chat --help` 三種唯讀查詢，深入兩層 help 為止
- 未執行 `chat` 實際任務、未啟動 GUI、未建立 Agent Session
- 未登入、未更新、未安裝、未變更任何設定（含未執行 `--add-mcp`）
- 未使用 PowerShell、未使用 rg
- 未修改任何既有檔案、未變更 Git 狀態
