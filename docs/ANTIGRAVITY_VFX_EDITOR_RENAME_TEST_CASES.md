# Antigravity 測試用例：VFX 編輯器的「重新命名」

## Feature

2026-09-18 使用者需求：Layer 可以改名了，特效本身（preset）也要能改名，不能只靠「另存新檔」。

工具列「另存新檔」旁邊新增「重新命名」按鈕：

1. 先檢查這份特效有沒有被用到（配置表、寫死特效的登記清單、`js/`／`tests/`／`tools/` 的程式碼、
   同名的覆蓋規格）。有的話不改名，直接列出用在哪裡，不開問名字的視窗。
2. 沒人用的才問新名字：跳出 Windows 存檔視窗（標題「重新命名（輸入新名字，存在 vfx\presets）」），
   預填目前的名字。
3. 有未存檔的修改時先確認：確定＝先存檔再改名；取消＝不改名，修改留著。
4. 伺服器把 `vfx/presets/<舊>.json` 與 `vfx/layouts/<舊>.json` 換成新名字，
   檔案裡的 `id`、分組的 `presetId`、根群組的 id／名稱跟著換。途中失敗就還原。
5. 改完這一格用新名字重新開啟：下拉、網址、Layers 的群組名稱都換成新名字，復原紀錄清空。

對應 commit：`2a9fb7c9`（前置：根群組改名規則共用、改名前的引用檢查）與本次的重新命名 commit。

## Test Goal

這次 QA 要證明三件事：

- **有人用的特效改不了。** 改了之後配置表、程式碼找不到它，遊戲裡的特效會直接消失，而且不會報錯。
- **改名只動兩個檔，而且兩個都改對。** 特效檔與分組檔都要換成新名字、裡面的名字也要換；
  少換一個的話，下次開啟會分組全失，或測試 LAYOUT-2／LAYOUT-4 變紅。
- **未存檔的修改不會丟。** 選「確定」要帶到新名字；選「取消」要原封不動留在畫面上。

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
沒重開的話，按「重新命名」會顯示「編輯器伺服器是舊版，還沒有重新命名」——那不是 bug。

在 **`D:\MyGame\Idle-RPG\antigravity`** 執行 `啟動VFX編輯器.bat`，並確認連到的是自己那份：

```bash
curl -s http://127.0.0.1:<實際開啟的埠>/__whoami
```

必須回 `idle-rpg-vfx-editor D:\MyGame\Idle-RPG\antigravity`，否則這次結果全部作廢。

### 測試用特效

**不要拿 repo 裡既有的特效來改名。** 先用「另存新檔」做一份沒人用的：
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
- 步驟 2：狀態列顯示「已重新命名為 qa-rename-a」（綠色），滑鼠移上去的提示寫「原本的「qa-rename-src」已不存在…」。
  搜尋框、網址（`?preset=qa-rename-a`）、Layers 的群組名稱都是 `qa-rename-a`；預覽照常播放；
  復原按鈕是停用的。
- 步驟 3：`"id": "qa-rename-a"`；分組檔的 `presetId`、`groups[0].id`、`groups[0].name` 都是 `qa-rename-a`，
  `order` 是 `["group:qa-rename-a"]`。
- `vfx/presets/qa-rename-src.json` 與 `vfx/layouts/qa-rename-src.json` 都不見了。
- 下拉清單裡找不到 `qa-rename-src`，找得到 `qa-rename-a`。
- 重新整理頁面，開的是 `qa-rename-a`。

### AG-VFXRN-002：有人用的特效不能改（最重要）

操作：

1. 開 `lightning-orb-field`（雷球），按「重新命名」。
2. 再開 `black-hole`，按「重新命名」。

預期：

- **不會跳出 Windows 視窗。**
- 工具列下方的紅色橫幅寫「無法重新命名「lightning-orb-field」：下面這些地方用到它…」，
  列出配置表與程式碼的位置；`black-hole` 要列出 `覆蓋規格 vfx/coverage-specs/black-hole.json`。
- `git status` 沒有任何變動。

### AG-VFXRN-003：未存檔的修改

操作：

1. 開 `qa-rename-a`，把第一個圖層的 `alpha` 改成 `0.37`，點別的地方讓它寫進去（出現「● 未存檔」）。
2. 按「重新命名」，名字打 `qa-rename-b.json`，按存檔。確認框出現時按**取消**。
3. 再按一次「重新命名」，名字打 `qa-rename-b.json`，這次按**確定**。
4. 打開 `vfx/presets/qa-rename-b.json` 看第一個圖層的 `alpha`。

預期：

- 步驟 2：確認框寫「「qa-rename-a」有未存檔的修改…確定：先存檔，再改名為「qa-rename-b」…」。
  按取消之後：沒有改名（檔案還叫 `qa-rename-a`），`alpha` 還是 `0.37`、「● 未存檔」還在，
  狀態列顯示「已取消重新命名」。
- 步驟 3：改名成功，「● 未存檔」消失。
- 步驟 4：`alpha` 是 `0.37`。

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

- 右邊那格重新開啟成 `qa-rename-c`；左邊的 `hit-fire` 完全沒動（選取、未存檔狀態都一樣）。
- 網址是 `?preset=hit-fire&preset=qa-rename-c`（焦點在第一格時不帶 `focus`）。
- 點回右邊那格，狀態列是「已重新命名為 qa-rename-c…」。

### AG-VFXRN-007：迴歸

- 「另存新檔」：視窗標題仍是「另存新檔（存到 vfx\presets）」，預填 `<目前的名字>-copy.json`，
  另存後原本那份不變。
- 「儲存到 repo」、Ctrl+S 照舊。
- 「重新命名」的 Windows 視窗開著時再按一次「另存新檔」或「重新命名」：不會疊出第二個視窗。

## Edge Cases

- 伺服器沒重開（舊版）：按「重新命名」顯示「編輯器伺服器是舊版，還沒有重新命名…」，什麼都不會改。
- 改名後 `git status` 會顯示舊檔刪除、新檔未追蹤（兩個檔各一組）；這是預期的，不是多出來的檔。
- 被擋下的特效要改名的正確做法：先改掉那些引用（配置表要改 Excel），或另存新檔再把引用換過去。

## Visual / UX checks

- 「重新命名」按鈕緊接在「另存新檔」右邊，樣式與旁邊的按鈕一致。
- 滑鼠移到按鈕上的說明：「幫目前這份特效換名字（特效檔與分組檔一起改）。遊戲或程式有用到的特效不能改」。
- 被擋下時橫幅的清單一行一個位置，讀得出是哪張表的哪個技能。

## 回報格式

每個案例寫：編號、通過／失敗、實際看到的現象（失敗時附截圖與 Console 內容）。
最後附上收尾前的 `git status`。
