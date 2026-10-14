# 一鍵同步與自動解衝突

執行根目錄的 `sync_ai_worktrees.bat`，維持原本的素材庫同步、三個 AI 分支推送、develop 整合及回同步流程。develop 合併發生衝突時，現在會自動呼叫本機 Codex CLI，完成三方分析、必要修改與測試，不需要另開聊天輸入「1」。

## 本機條件

- Git、Node.js、Windows PowerShell 與 Codex CLI 可執行。
- Codex 已登入：可用 `codex login status` 檢查，必要時先執行 `codex login`。
- 可以連線使用 Codex，且帳號有可用額度；自動解衝突會使用帳號的 Codex 額度。
- 三個 AI 工作區必須乾淨。請先提交正在做的工作；腳本不會自動提交那些未完成內容。

自動程序以 `--ignore-user-config` 使用 CLI 自帶預設設定並沿用原登入，避免桌面 App 的模型別名與 CLI 不相容；不修改使用者設定檔。採 `workspace-write` sandbox 與 `never` approval policy，不跳出逐項確認，也不使用繞過 sandbox 的旗標。Git 共用目錄與已設定的素材庫列為必要的額外可寫路徑；帳號登入、權限限制或 Excel 鎖定等問題仍可能使這次處理失敗。

Windows sandbox 實作沿用既有 `config.toml` 的 `[windows].sandbox` 設定，只以本次啟動參數傳入；不會自動改換權限較寬的模式。若執行命令被 sandbox 政策拒絕，Codex 會直接停止，不反覆換 shell 嘗試。

## 自動處理流程

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

## 失敗後重跑

處理完登入、連線、額度或 Excel 鎖定等原因後，再執行同一個 BAT。若 develop 的單一 `MERGE_HEAD` 仍對應某個已知 AI 分支目前的本機或遠端提交，腳本會自動接續原合併。來源已移動、未知分支或其他 Git 操作的現場不會被自行猜測處理。

每次嘗試的提示、原父提交、衝突 index、Codex 輸出與結果都存於 develop 的 Git metadata 目錄：`sync-auto-conflicts/<時間與識別碼>/`。實際完整路徑會顯示在主控台，不進版控；日誌可能包含專案程式碼，僅在需要時分享。

自動程序使用 `--ephemeral`，不另外保存 Codex 聊天歷史；處理紀錄以以上本機日誌為準。

## 選項

```bat
sync_ai_worktrees.bat -ValidateOnly
sync_ai_worktrees.bat -NoAutoResolve
sync_ai_worktrees.bat -SkipAssetLibrary
sync_ai_worktrees.bat -CodexCommand "C:\path\to\codex.cmd"
```

`-ValidateOnly` 只預檢，不啟動 Codex、合併或推送；已有待完成合併時會回報。`-NoAutoResolve` 恢復遇衝突即停止的行為。`-SkipAssetLibrary` 保留原本的略過素材庫同步選項，並不取消必要素材的保存規範。

CLI 用法依據 [OpenAI 官方非互動模式文件](https://developers.openai.com/codex/noninteractive/)，並以本機 `codex exec --help` 核對參數。
