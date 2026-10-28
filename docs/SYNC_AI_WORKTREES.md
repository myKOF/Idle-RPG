# 一鍵同步與自動解衝突

執行根目錄的 `sync_ai_worktrees.bat`，維持原本的素材庫同步、三個 AI 分支推送、develop 整合及回同步流程。develop 合併發生衝突時，現在會自動呼叫本機 Codex CLI，完成三方分析、必要修改與測試，不需要另開聊天輸入「1」。

## 本機條件

固定同步分支 `ai/antigravity`、`ai/claude`、`ai/codex` 與專用分支分開管理。若固定分支仍存在、但沒有簽出的工作區，工具會在 develop 所在目錄的上一層建立 `.ai-sync-worktrees/<AI名稱>` 固定副本，沿用該分支完整歷史；不切換原工作區、不重設分支，路徑已存在則停止而不覆蓋。

已簽出的 `codex/*`、`claude/*`、`antigravity/*` 與 `ai/*` 專用分支會一併參與同步：先確認乾淨、推送並整合至 develop，再快轉回各固定及專用分支。尚未推送的專用分支會建立同名遠端及 upstream。騎士專用分支仍保留原名稱，可繼續工作。任何參與副本有未提交修改仍會停止，需先完成／提交工作。

若本地與同名遠端各自有新提交（例如 `ai/codex` 領先1／落後42），不再因無法fast-forward而提前中止，也不強推。本輪固定兩端SHA，將兩邊交給develop依序整合；整合完成前不切換該工作區、不推送該分岔分支。內容衝突沿原自動解衝突／測試流程，失敗保留develop的合併現場；成功後由完整develop快轉回兩端並普通push。develop本身與遠端分岔亦使用相同合併驗證。推送前重新確認本地／遠端SHA及工作區狀態；同步中有新提交或未提交修改仍會停止。這讓其他AI的分岔不會使尚未輪到的Claude雲端來源一直無法整合。

使用者定義的「所有 AI 同步到最新」，是先完整整合可同步 AI 成果至主線 `develop`，再讓三個固定工作區取得這個整合結果。工具在 fetch 後掃描所有本地與指定遠端分支，包括沒有 worktree 的 `ai/claude-kpj271` 等雲端任務；辨識 `ai/*`、三個角色的 `角色/*`，也辨識任意名稱分支中尚未整合且具有 `[Codex]`／`[Claude]`／`[Antigravity]` 提交前綴或對應作者的成果。`main`、`develop` 與明確 hold 來源除外。hold 僅限明確設定的分支，不因同一 AI 作者或名稱前綴而擴張至其他任務來源；例如保留 `ai/claude` 不會連帶略過 `ai/claude-kpj271`。

2026-10-28 使用者再確認：圖中 `977e425` 等最新成果須完整納入 develop，再更新三個 AI 分支；最終 HEAD 可以是包含該提交的整合提交，不以提交時間挑一份檔案覆蓋其他成果。本機舊 `ai/claude` hold 已獲本次解除授權，其他明確隔離任務仍保留。預檢與執行結尾會逐筆列出「未同步保留來源」及 SHA；存在 hold 時標示「同步完成（有保留來源未同步）」，不能將這些排除項宣稱為已同步。

這些額外來源以固定提交 SHA 整合，未參與固定工作區流程的來源分支保留原指向，不額外建立 worktree／upstream 或回寫來源。已簽出的來源仍須乾淨。推送 develop 前再次 fetch 並確認來源沒有前進、沒有新待整合 AI 分支；若有變動則保留本地成果並停止，重跑後繼續。完成的依據是來源提交均已包含在主線歷史，並非只比較三個固定分支是否同 SHA。遠端在最後檢查之後才新增的提交，仍須下一輪同步。

`-ValidateOnly` 顯示將建立的固定副本及本機已知的待整合來源，不 fetch、不建立目錄、切分支、合併或推送。報告另列出所有本地／遠端分支 SHA 與 develop 包含關係，涵蓋未簽出的雲端來源；預檢的遠端資料是上次 fetch 的快照。

待使用者核准的試作可設定 `git config branch.<分支名>.codexSyncHold true`，工具會保留該工作區與分支，跳過其同步、推送和合併；其中未提交的試作也不阻擋其他AI同步。既有 `codex/knight3d-prototype`、`codex/knight-makehuman-motion`、`codex/knight-makehuman` 預設受保護。只有使用者明確說最終OK後，才可將對應設定改為 `false` 納入整合。這不會刪除或改名原 `ai/codex` 分支。

保留設定也適用於固定 `ai/*` 分支。例如使用者要求 Claude 本地提交暫不整合，可設定 `git config branch.ai/claude.codexSyncHold true`；該分支不會被當成缺少工作區而重建，也不參與預檢計畫、同步、推送或 develop 合併。其餘固定與專用分支照常處理。保留結束須先取得使用者授權，再將設定改為 `false`；原工作區、未提交內容與完整歷史持續保留。

- Git、Node.js、Windows PowerShell 與 Codex CLI 可執行。
- Codex 已登入：可用 `codex login status` 檢查，必要時先執行 `codex login`。
- 可以連線使用 Codex，且帳號有可用額度；自動解衝突會使用帳號的 Codex 額度。
- 三個 AI 工作區必須乾淨。請先提交正在做的工作；腳本不會自動提交那些未完成內容。

BAT 自動尋找已安裝的 CLI：先查 `PATH` 的 `codex.cmd`／`codex.exe`，再查 `%APPDATA%\npm\codex.cmd` 與 `%LOCALAPPDATA%\OpenAI\Codex\bin\<版本>\codex.exe`（版本目錄依更新時間排序）。雙擊 BAT 時即使 Explorer 的 PATH 尚未更新，也可直接使用 npm 或桌面 App 已有的安裝；不另外安裝 CLI、不修改系統 PATH。每個候選先執行 `--version` 與 `exec --help`，確認可啟動並支援既有自動處理所需參數；失效的 npm shim 會跳過並繼續找桌面版。主控台及報告記錄最終 CLI 路徑與版本。使用 `-CodexCommand` 明確指定完整路徑時，只使用指定程式；無效時保留合併並回報。

啟動 AI 前，控制器也會清除 Git 已回報的「新增檔尾空白行」，僅限已暫存、工作檔與 index 均完全等於本次來源提交的普通文字檔；有手動修改、合併後另有內容、符號連結或其他空白錯誤時不套用此整理。這讓 `.agents` 等受 AI 沙箱保護的指令檔不會因來源多帶空白行而卡住提交；不更改規範內容、不放寬沙箱與 Git diff 檢查。整理清單保存在本次 `controller-whitespace.txt`，控制器自行暫存這些明確檔案。AI 仍須以 `git diff HEAD --check` 檢查完整合併內容，包含原先已暫存的來源差異。

自動程序以 `--ignore-user-config` 使用 CLI 自帶預設設定並沿用原登入，避免桌面 App 的模型別名與 CLI 不相容；不修改使用者設定檔。採 `workspace-write` sandbox 與 `never` approval policy，不跳出逐項確認，也不使用繞過 sandbox 的旗標。Git 共用目錄與已設定的素材庫列為必要的額外可寫路徑；帳號登入、權限限制或 Excel 鎖定等問題仍可能使這次處理失敗。

Windows sandbox 實作沿用既有 `config.toml` 的 `[windows].sandbox` 設定，只以本次啟動參數傳入；不會自動改換權限較寬的模式。若執行命令被 sandbox 政策拒絕，Codex 會直接停止，不反覆換 shell 嘗試。

## 自動處理流程

控制器逐一處理回報的檔案，已不存在且確認在本次index暫存刪除的確切路徑，可安全重複回報；不再對它重跑會失敗的git add。尚未暫存的正常刪除仍會暫存；從未追蹤、也沒有暫存刪除紀錄的缺檔仍拒絕，原有路徑、完整變更、父提交及Build檢查維持。

1. 正常合併仍由 Git 處理。只有 develop 合併失敗且存在對應的 `MERGE_HEAD` 時才啟動 Codex。
2. Codex 讀取專案規範及 base／ours／theirs，保留雙方必要內容，同步配置來源、生成程式及快取版本，執行相關測試並回報修改檔案清單。它不得寫入遊戲 Git index、提交遊戲倉庫、推送、切分支、重設或中止合併。
3. 外層工具獨立確認分支與兩個合併父提交未變，僅暫存回報的工作區內檔案，確認衝突已清除、staged diff 無衝突標記、沒有漏報修改或臨時檔，再執行 `node tools/build_check.cjs`。
4. 驗證通過才建立 `[Codex] merge: ...` 提交，繼續合併其他 AI 分支。若處理時保存了必要素材，控制器會先提交明確回報的素材檔（已有他人 staged 工作或素材 HEAD 改動時停止），再完成遊戲提交並同步素材庫，然後才推送 develop 與回同步各 AI 分支。

腳本會嘗試自動解決程式、快取與 Excel 等衝突，但不能保證所有設計衝突都能無人裁決。當雙方意圖矛盾、必要測試不過、缺工具／額度／連線或檔案鎖住時，會保留現場並停止，不盲選一邊、不降低測試要求、不自動 `reset` 或 `merge --abort`。已成功整合的本機提交仍保留；develop 不會在這個失敗點繼續推送。

## 將小黑視窗問題傳給 Codex

每次執行 `sync_ai_worktrees.bat`，都會在**啟動 BAT 的工作區**產生 Markdown 報告，成功與失敗皆會保存。主控台最後會顯示完整路徑；直接將該 `.md` 檔傳給 Codex 即可，不用逐行複製或截圖。

- 最新一份：`logs/sync-ai-worktrees/latest.md`。
- 歷史報告：同資料夾內的 `sync-時間-識別碼.md`，重跑不覆蓋前一輪問題。
- 原始文字紀錄：同名 `.log`，輸出過程持續寫入。

報告包含結束碼、開始／結束時間、傳入參數、完整 stdout／stderr、工具版本，以及 develop、三個 AI 工作區和已設定素材庫的 Git 狀態、HEAD／upstream／MERGE_HEAD、未解衝突清單。本輪若呼叫自動解衝突，也會附上原合併父提交、初始衝突清單與 Codex 結果。報告不讀取登入設定或環境變數，但執行輸出可能包含程式碼與本機路徑。

`logs/` 已排除版控，不會讓同步因報告變成工作區不乾淨。工作區無法寫入時改存 Windows 暫存目錄的 `Idle-RPG-sync-reports`，實際位置仍會顯示。請等腳本結束再關閉視窗；強制關閉／斷電無法保證完成 Markdown 匯出，但已寫入的 `.log` 可供排查。

BAT 透過 `tools/invoke-sync-with-report.ps1` 包裝原同步程序，保留其非零結束碼及原同步流程。直接執行 `tools/sync_ai_worktrees.ps1` 不經報告包裝；需要報告時請使用 BAT，或執行 `powershell -NoProfile -ExecutionPolicy Bypass -File tools/invoke-sync-with-report.ps1 -ValidateOnly`。

## 自動修復 index 寫入失敗

BAT 已包含本次 `error: unable to write new index file` 的修復。適用於 develop 或 AI 工作區在 fast-forward 時，檔案已完整更新，但 Git index／分支仍停在原提交的情況，不會呼叫 Codex 或消耗模型額度。

1. 每次有實際更新的 fast-forward 前，先保存 index、原 HEAD、固定目標提交、分支、index 雜湊與執行紀錄。
2. 只有 Git 回報上述 index 寫入錯誤才接手。使用獨立 index 完整核對工作檔案（包含被 skip-worktree／assume-unchanged 隱藏的修改）及目標之外的未追蹤檔案。
3. 檔案完整符合固定目標、原 HEAD／目標／index 均未被其他工作改動，且沒有 index.lock、合併／rebase 等 Git 操作時，才重建正式 index，再以帶原值檢查的 `update-ref` 完成 fast-forward。工作檔不被重新簽出或覆蓋，既有 index 旗標保留；若另一程序移動分支，更新會失敗，不回退他人提交。
4. 成功後自動繼續其餘分支同步。失敗時保留備份與現場，下次執行同一個 BAT，會先接續已記錄的修復；不依工作檔外觀看起來相似就猜測修復來源。

備份、獨立驗證 index、原始 Git 輸出與 `record.json` 位於各工作區 Git metadata 的 `sync-index-recovery/<識別碼>/`，不進版控；主控台與 Markdown 報告會顯示路徑。尚未完成的修復另有 `pending.json`，成功後自動移除該待處理指標，歷史備份繼續保留。完整內容比對可能花幾分鐘，請等執行結束再關閉視窗。

持續被鎖定／權限不足、額外修改、分支或 index 已變、稀疏簽出、未知 Git 錯誤都會停止並匯出報告；不刪除鎖定檔、不調整權限、不執行 hard reset。`-ValidateOnly` 不執行修復，`-NoIndexRecovery` 可停用這項自動修復；此選項與 develop 的 `-NoAutoResolve` 各自獨立。

## 失敗後重跑

### Excel 衝突的原生交接

Windows 沙箱使用的登入工作階段可能無法啟動 Excel COM（`0x80070520`），即使桌面 Excel 正常也會發生。同步工具保留原本的 `workspace-write` 沙箱，改為最多兩輪處理：

1. 第一輪 Codex 唯讀比較工作簿來源，產生資料 JSON 計畫；不在沙箱啟動 Excel，也不直接改寫 XLSX。
2. 原桌面父程序只處理本次原始 Excel 衝突清單中的工作簿，核對來源 SHA、拒絕越界或連結路徑，執行啟動前載入記憶體的可信 Excel 更新工具。所有候選都通過儲存／正常重開後，才鎖住原檔再次核對 SHA、更新來源並保存原生驗證收據；不使用修復／資料擷取模式。
3. 第二輪仍在相同沙箱內，從實際更新後的 Excel 產生 CSV／JS，統一字串與快取並執行測試／Build。父程序再次確認工作簿與驗證收據的 SHA 相同後才暫存，保留既有合併父提交／推送檢查。

計畫資料放在忽略版控的 `logs/sync-excel-plans/<本次識別碼>/`；原檔、可信工具副本與收據放在本次 `sync-auto-conflicts/<識別碼>/native-excel/` 附近，作為復原紀錄保留。這個流程不允許任意主機腳本或放寬 CLI 權限。父程序沒有 Excel、檔案被占用、來源中途修改、資料衝突需人裁決或驗證失敗時，仍會保留合併現場並停止。

處理完登入、連線、額度或 Excel 鎖定等原因後，再執行同一個 BAT。若 develop 的單一 `MERGE_HEAD` 仍對應某個已知 AI 分支目前的本機或遠端提交，腳本會自動接續原合併。來源已移動、未知分支或其他 Git 操作的現場不會被自行猜測處理。

每次嘗試的提示、原父提交、衝突 index、Codex 輸出與結果都存於 develop 的 Git metadata 目錄：`sync-auto-conflicts/<時間與識別碼>/`。實際完整路徑會顯示在主控台，不進版控；日誌可能包含專案程式碼，僅在需要時分享。

自動程序使用 `--ephemeral`，不另外保存 Codex 聊天歷史；處理紀錄以以上本機日誌為準。

## 選項

```bat
sync_ai_worktrees.bat -ValidateOnly
sync_ai_worktrees.bat -NoAutoResolve
sync_ai_worktrees.bat -NoIndexRecovery
sync_ai_worktrees.bat -SkipAssetLibrary
sync_ai_worktrees.bat -CodexCommand "C:\path\to\codex.cmd"
```

`-ValidateOnly` 只預檢，不啟動 Codex、合併或推送；已有待完成合併時會回報。`-NoAutoResolve` 恢復遇衝突即停止的行為。`-SkipAssetLibrary` 保留原本的略過素材庫同步選項，並不取消必要素材的保存規範。

CLI 用法依據 [OpenAI 官方非互動模式文件](https://developers.openai.com/codex/noninteractive/)，並以本機 `codex exec --help` 核對參數。
