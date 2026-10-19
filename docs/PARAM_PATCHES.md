# Excel 開啟時暫存 Agent 修改

你可以繼續在 Excel 編輯。所有 Agent 預設將既有配置格位的修改記成各自的待套用差異；你按儲存、關閉相關 Excel 後，照常雙擊根目錄「套用參數.bat」。工具先合併差異，成功才繼續 Excel→CSV→遊戲。共同規範唯一來源是 AI_RULES.md 第8.5節，適用 Claude、Codex 與 Antigravity。

- 改不同格：保留雙方內容。
- 同一格，Excel 仍為 Agent 記錄的原值：套用 Agent 新值。
- 同一格，Excel 現值與原值不同（包含已等於 Agent 新值）：停止並詢問使用者，確認保留哪一方。只有寫入收據證明同一請求已寫入同一工作簿，才自動略過並安全重跑。
- 同一格有兩份 Agent 差異：即使填入相同值，仍停止並詢問使用者，確認保留哪一方。
- 主鍵不存在／重複、欄位不存在／重複：整批停止。上述停止均不寫入來源 Excel、CSV 或遊戲。畫面與 archive 中的 decision.json 顯示原值／Excel現值／各Agent提案；定位失敗則保留 failure.json 與 manifest。
- Excel 仍開著：停止，保留請求；請先儲存並關閉再執行。

合併有待套用內容時需要 Windows 與 Microsoft Excel。沒有待套用內容時不啟動 Excel，原本流程不變。

## Agent 產生差異

先讀取已儲存的工作簿，確認真實工作表名、表頭列、主鍵及原值。下例欄名僅為示例，必須換成目標工作簿實際欄名，不能直接照抄：

```json
{
  "version": 1,
  "agent": "Codex",
  "task": "任務編號／調整原因",
  "changes": [
    {
      "workbook": "Skills2.xlsx",
      "sheet": "Skills2",
      "headerRow": 1,
      "key": { "技能ID": "mire", "階級": 1 },
      "column": "效果JSON",
      "before": "{\"pct\":10}",
      "after": "{\"pct\":12}"
    }
  ]
}
```

將內容保存為 request.json，再執行：

```powershell
node tools/param-patches.cjs --stage request.json
```

命令不讀寫 Excel，會以唯一檔名保存於 config/param-patches 根目錄。確認成功後可刪除自己的臨時 request.json，必要差異檔須保留並納入任務 Commit。BAT 僅處理目前副本的差異；其他 AI 分支的請求須先正常整合至使用者要執行 BAT 的副本。

值型別要與 Excel 原值一致：文字、數字、布林、null（清空）。公式用 `{"formula":"=A1*2"}` 表示；一般字串即使以等號開頭仍視為文字，不會自動執行為公式。空字串與真正空格視為同值，數字與文字不互換。JSON 內容是完整儲存格文字，不做 JSON 內部欄位自動合併。

主鍵以多欄共同定位，必須唯一，支援重排／插入其他資料列後定位；不允許更改主鍵欄、合併儲存格、新增／刪除資料列或欄。這類結構調整仍需另行安排原生 Excel 編修。不要使用易變的數值或說明作為主鍵。

原值必須是 Agent 開始修改時看到的磁碟資料，不代表使用者 Excel 尚未儲存的狀態。使用者之後儲存的修改會在合併時比較。不要重寫 before 消除保護。要取消某個請求，先保留紀錄再由使用者授權移出待套用目錄。無法從最終檔案辨識「改過後又改回原值」的編輯歷史；比較依據為磁碟資料、待套用提案及工具收據。

暫存完成只能回報「待套用」，不能宣稱遊戲參數已變更。依賴它的功能需標示未完成驗收；不要先寫正式 CSV／JS。可在隔離副本套用測試。

## 同格衝突必須取得使用者決定

Agent 讀取本次 archive/執行編號/decision.json，列出 workbook、sheet、address、key、column、before、current 及 proposals，詢問使用者要保留 Excel 現值或哪一份 Agent 提案。使用者沒有回答就保持停止；按 BAT 不構成同意。

取得明確同意後，僅在衝突涉及的每份待套用 JSON、該項 changes 內加入 approval。例如使用者選擇 Agent 的12，當時 Excel 為99：

```json
"approval": {
  "by": "user",
  "reason": "使用者本輪明確回覆：保留 Agent 的12",
  "current": 99,
  "selected": 12,
  "proposals": [{ "agent": "Codex", "task": "任務編號／調整原因", "before": 10, "after": 12 }]
}
```

proposals 必須使用 decision.json 中該衝突的完整 proposals，不能省略其他提案。每份涉及同格的請求都須記錄同一選擇與明確同意來源；保留 Excel 時 selected 填 current。工具只允許選擇 Excel 現值或既有提案；若使用者指定另一個全新值，須建立新提案並重新核對。不要捏造使用者同意。

之後重跑 BAT。若現值或任何提案改變，舊同意失效，工具再次停止詢問。批准紀錄與所有提案隨成功請求移入 archive，不刪除另一方的原始提案。

## 備份與失敗復原

每次合併的 config/param-patches/archive/<執行編號>/ 保留原 Excel（original-）、候選 Excel（merged-）、manifest.json、snapshot.json、decision.json、寫回前保存的 commit-started.json 收據及成功後移入的請求。此目錄被 Git 忽略，是本機復原資料，不能當成測試垃圾清除。

工具在副本以原生 Excel API 精準改格，正常模式重新開啟並核對改值後，重新獨占鎖定所有來源，核對來源雜湊未變才寫回。任一本被鎖定或準備期間改變，整批不寫回。寫入錯誤會嘗試使用持有的鎖回復原檔。多本檔案無法保證斷電時的跨檔案原子性；備份與請求可用於檢查／復原。收據同時保存請求內容雜湊、原請求路徑與輸出工作簿雜湊，僅全部完整吻合時可自動續跑（包含已按使用者決定保留的值），其他情況保持詢問。

已合併 Excel 但後續 CSV／遊戲檢查失敗時，Excel 的合併保留；修正後重跑原 BAT 即可，不能誤認 Excel 已自動還原。工具只保證合併檢查失敗時不進入後續管線。

一般請使用 BAT。只需要手動合併 Excel、暫不匯出時可執行：

```powershell
node tools/param-patches.cjs --merge
```
