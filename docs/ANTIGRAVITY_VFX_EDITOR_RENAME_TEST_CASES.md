# Antigravity 測試用例：VFX 編輯器的「重新命名」

## Feature

2026-09-18 使用者需求：Layer 可以改名了，特效本身（preset）也要能改名，不能只靠「另存新檔」。

工具列「另存新檔」旁邊有「重新命名」按鈕。使用者定的規則：

1. **想改就改。** 配置表或程式用到舊名字的也照改——那些技能會失去特效，使用者自己調整。
   改完用黃色提醒橫幅列出「哪些地方還寫著舊名字」，不擋。
2. **檔案被鎖住也照改。** 新名字的檔寫好之後，舊檔被遊戲或其他程式佔用刪不掉的，
   伺服器會在佔用解除後（例如重啟遊戲）自動刪掉；清單上立刻看不到舊名字。
3. **復原不包含改名。** 改名不是復原紀錄裡的一步：Ctrl+Z 還能復原改名前的編輯，但名字不會被退回。
   沒存的修改改完仍然是沒存的（不先存檔、不重新開啟）。

流程：按「重新命名」→ Windows 存檔視窗（標題「重新命名（輸入新名字，存在 vfx\presets）」，預填目前的名字）
→ 伺服器把 `vfx/presets/<舊>.json` 與 `vfx/layouts/<舊>.json` 換成新名字，檔案裡的 `id`、分組的 `presetId`、
根群組的 id／名稱跟著換 → 這一格就地換成新名字。唯一會拒絕的是新名字已經有另一份特效。

對應 commit：`2a9fb7c9`（前置）、`81ef55e2`（第一版：有人用的不改）與改成上面三條規則的那一個 commit。

## Test Goal

- **改名只動兩個檔，而且兩個都改對。** 特效檔與分組檔都要換成新名字、裡面的名字也要換；
  少換一個的話，下次開啟會分組全失，或測試 LAYOUT-2／LAYOUT-4 變紅。
- **有人用也照改，而且講得出誰會受影響。** 提醒裡的技能名稱要與下拉清單的用途標註一致。
- **沒存的修改與復原紀錄都還在，名字不會被復原退回。**
- **舊檔被佔用不會讓改名失敗，佔用解除後舊檔自己消失。**

其餘是迴歸：另存新檔、一般存檔照舊。

## Preconditions

### 分支

在 `ai/claude`，Antigravity 的 worktree 沒有。**先合併再測**，不要直接開 claude 那份工作副本
（`VFX_AGENT_WORKFLOW §3.3`）：

```bash
git -C D:/MyGame/Idle-RPG/antigravity merge --no-ff ai/claude
```

### 啟動編輯器

**改了伺服器程式，一定要重開伺服器**（關掉「VFX 編輯器伺服器」視窗，再執行一次 `啟動VFX編輯器.bat`）。
沒重開的話，編輯器上方會提示伺服器是舊版，重新命名的行為會是舊的——那不是 bug。

在 **`D:\MyGame\Idle-RPG\antigravity`** 執行 `啟動VFX編輯器.bat`，並確認連到的是自己那份：

```bash
curl -s http://127.0.0.1:<實際開啟的埠>/__whoami
```

必須回 `idle-rpg-vfx-editor D:\MyGame\Idle-RPG\antigravity`，否則這次結果全部作廢。

### 測試用特效

除了 AG-VFXRN-002，**不要拿 repo 裡既有的特效來改名。** 先用「另存新檔」做一份沒人用的：
開 `demo-basic` → 另存新檔 → 名字 `qa-rename-src`。之後的案例都拿它改。

### 收尾

會寫檔。做完用 `git -C D:/MyGame/Idle-RPG/antigravity status` 看改到哪些檔，
刪掉 `vfx/presets/qa-rename-*.json` 與 `vfx/layouts/qa-rename-*.json`，
其餘有改到的用 `git checkout -- <檔案>` 還原。回報時附上收尾前的 `git status`。

## Test Steps / Expected Result

### AG-VFXRN-001：沒人用的特效改名（最重要）

操作：

1. 開 `qa-rename-src`，按「重新命名」。
2. 在 Windows 視窗把檔名改成 `qa-rename-a.json`，按存檔。
3. 用文字編輯器打開 `vfx/presets/qa-rename-a.json` 與 `vfx/layouts/qa-rename-a.json`。

預期：

- 步驟 1：視窗標題是「重新命名（輸入新名字，存在 vfx\presets）」，檔名預填 `qa-rename-src.json`，
  資料夾是 repo 的 `vfx\presets`。
- 步驟 2：狀態列顯示「已重新命名為 qa-rename-a」（黃色），沒有提醒橫幅（沒人用、也沒被佔用）。
  搜尋框、網址（`?preset=qa-rename-a`）、Layers 的群組名稱都是 `qa-rename-a`；預覽照常播放；
  沒有出現「● 未存檔」。
- 步驟 3：`"id": "qa-rename-a"`；分組檔的 `presetId`、`groups[0].id`、`groups[0].name` 都是 `qa-rename-a`，
  `order` 是 `["group:qa-rename-a"]`。
- `vfx/presets/qa-rename-src.json` 與 `vfx/layouts/qa-rename-src.json` 都不見了。
- 下拉清單裡找不到 `qa-rename-src`，找得到 `qa-rename-a`。
- 重新整理頁面，開的是 `qa-rename-a`。

### AG-VFXRN-002：有人用的特效也照改（最重要）

操作：

1. 開 `proj-cleave-ring-tricolor-08`（下拉上標著「迴旋斬·虛空碎裂斬」），按「重新命名」，名字打 `qa-rename-used.json`。
2. 讀提醒橫幅。
3. 再按一次「重新命名」，名字打回 `proj-cleave-ring-tricolor-08.json`。

預期：

- 步驟 1：**會**跳出 Windows 視窗，改名成功。
- 步驟 2：工具列下方是**黃色**橫幅（不是紅色錯誤），寫「已重新命名為「qa-rename-used」：這些地方還寫著舊名字
  「proj-cleave-ring-tricolor-08」，會失去特效…」，列出的名稱與下拉清單原本的用途標註一致。
- 步驟 3：改回原名成功；`git status` 裡 `vfx/presets/proj-cleave-ring-tricolor-08.json` 與它的分組檔沒有變動
  （內容本來就是 canonical 形式的話）。有變動就用 `git checkout` 還原並回報差異。

### AG-VFXRN-003：沒存的修改與復原

操作：

1. 開 `qa-rename-a`，把第一個圖層的 `alpha` 改成 `0.37`，點別的地方讓它寫進去（出現「● 未存檔」）。
2. 按「重新命名」，名字打 `qa-rename-b.json`，按存檔。
3. 按 Ctrl+Z。
4. 按 Ctrl+Y，再按「儲存到 repo」。
5. 打開 `vfx/presets/qa-rename-b.json` 看第一個圖層的 `alpha`。

預期：

- 步驟 2：**不會**跳確認框，直接改名；改完「● 未存檔」**還在**，`alpha` 還是 `0.37`。
  滑鼠移到狀態列「已重新命名為 qa-rename-b」上，提示寫「改名前沒存的修改仍然沒存」。
- 步驟 3：`alpha` 回到改之前的值，**名字仍然是 `qa-rename-b`**（搜尋框、Layers 群組名稱都沒變回 `qa-rename-a`）；
  「● 未存檔」消失（回到磁碟上的內容）。
- 步驟 4：存檔寫到 `qa-rename-b.json`，沒有長出 `qa-rename-a.json`。
- 步驟 5：`alpha` 是 `0.37`。

### AG-VFXRN-004：視窗裡選了不能用的名字

操作（對 `qa-rename-b`）：

1. 按「重新命名」，不改檔名直接按存檔。
2. 視窗重開後，選 `demo-basic.json`，按存檔。
3. 視窗重開後按取消。

預期：

- 步驟 1：先跳訊息「「qa-rename-b」就是目前的名字。請輸入新的名字。」，按確定後視窗重開。
- 步驟 2：訊息「已經有一份「demo-basic」了。重新命名不會蓋掉別的特效，請換一個名字。」，視窗重開。
  `demo-basic.json` 一個 byte 都沒變。
- 步驟 3：什麼都沒改，狀態列清空。

### AG-VFXRN-005：還沒存進 repo 的特效不能改名

操作：

1. 「＋ 新增視窗」開一格空白的，按「重新命名」。
2. 在那一格用「載入 Preset」從本機選一個檔案匯入，按「重新命名」。

預期：

- 步驟 1：橫幅「無法重新命名：這是還沒存檔的新特效…按「儲存到 repo」時就會問名字。」
- 步驟 2：橫幅「…這份是用「載入 Preset」從檔案匯入的，編輯器不知道它對應 repo 裡的哪個檔。
  先按「儲存到 repo」存進去，再改名。」
- 兩步都不會跳出 Windows 視窗。

### AG-VFXRN-006：多視窗

操作：

1. 兩格：左邊開 `hit-fire`，右邊開 `qa-rename-b`。點右邊那格，按「重新命名」。
2. Windows 視窗開著的時候，點左邊那一格。
3. 回到 Windows 視窗，名字打 `qa-rename-c.json`，按存檔。

預期：

- 右邊那格就地換成 `qa-rename-c`；左邊的 `hit-fire` 完全沒動（選取、未存檔狀態都一樣）。
- 網址是 `?preset=hit-fire&preset=qa-rename-c`（焦點在第一格時不帶 `focus`）。
- 點回右邊那格，狀態列是「已重新命名為 qa-rename-c」。

### AG-VFXRN-008：舊檔被佔用

操作（PowerShell，路徑換成自己的 worktree）：

1. 開 `qa-rename-c`。在 PowerShell 佔住它的檔案（不允許別人刪除）：
   ```powershell
   $f = [System.IO.File]::Open('D:\MyGame\Idle-RPG\antigravity\vfx\presets\qa-rename-c.json', 'Open', 'Read', 'Read')
   ```
2. 在編輯器把它改名成 `qa-rename-d.json`。
3. 看下拉清單與資料夾。
4. 在 PowerShell 執行 `$f.Close()`，等 3 秒，再看資料夾。

預期：

- 步驟 2：改名成功，黃色提醒寫「舊檔被其他程式佔用，暫時刪不掉：vfx/presets/qa-rename-c.json。
  伺服器會在佔用解除後自動刪掉…」；伺服器視窗有一行「重新命名：qa-rename-c → qa-rename-d…稍後自動刪除…」。
- 步驟 3：下拉清單**已經沒有** `qa-rename-c`、有 `qa-rename-d`；資料夾裡 `qa-rename-c.json` 暫時還在。
- 步驟 4：`qa-rename-c.json` 自動消失，伺服器視窗出現「已刪除改名後被佔用的舊檔：vfx/presets/qa-rename-c.json」。

### AG-VFXRN-007：迴歸

- 「另存新檔」：視窗標題仍是「另存新檔（存到 vfx\presets）」，另存後原本那份不變。
- 「儲存到 repo」、Ctrl+S 照舊。
- 「重新命名」的 Windows 視窗開著時再按一次「另存新檔」或「重新命名」：不會疊出第二個視窗。

## Edge Cases

- 伺服器沒重開（舊版）：行為會是舊版的，先照 Preconditions 重開伺服器再測。
- 改名後 `git status` 會顯示舊檔刪除、新檔未追蹤（兩個檔各一組）；這是預期的，不是多出來的檔。
- 新名字只剩殘留的分組檔（`vfx/layouts/<新名字>.json` 在、特效檔不在）：照樣改名，殘留的分組檔被換掉或刪掉。

## Visual / UX checks

- 「重新命名」按鈕緊接在「另存新檔」右邊，樣式與旁邊的按鈕一致。
- 滑鼠移到按鈕上的說明：「幫目前這份特效換名字（特效檔與分組檔一起改）。用到舊名字的技能會失去特效，改完會列出來」。
- 提醒橫幅是黃色、錯誤橫幅是紅色；提醒之後再出錯，橫幅要變回紅色。

## 回報格式

每個案例寫：編號、通過／失敗、實際看到的現象（失敗時附截圖與 Console 內容）。
最後附上收尾前的 `git status`。
