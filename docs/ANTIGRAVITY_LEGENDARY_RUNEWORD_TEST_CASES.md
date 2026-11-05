# Antigravity 測試指令：全部傳奇特效與符文真言回歸

> 由 `node tools/gen_legendary_runeword_test_cases.cjs` 依 `js/data.js`（`PASSIVE_POOL`）、`js/runeword_data.js` 與引擎產生，**請勿手改**；機制層的測試重點在 `tools/legendary_runeword_test_notes.cjs`。
> 符文與符文真言的完整數值對照（33 顆符文單顆數值、各配方在參考裝備上的屬性）沿用 `docs/RUNEWORD_TEST_MATRIX.md`，設計說明見 `docs/RUNEWORD_DESIGN.md`。

- 提出者：Claude｜測試分支：`ai/claude`（含 GM 指令 `legend`，見 `GM_command.md` 4.6 節）；不要在 develop 上測
- 報告：`docs/LEGENDARY_RUNEWORD_TEST_REPORT.md`（繁體中文；截圖放 `tmp/legend-rw-shots/`，報告內用相對路徑引用；`tmp/` 被 git 忽略，報告附檔名清單）
- 驗證模式：唯讀。發現問題只記錄（條目編號、重現步驟、預期／實際、截圖、Console 錯誤），不要改程式。

## 0. 範圍與條目數核對

| 類別 | 數量 | 條目編號 | 取得方式 |
| --- | --- | --- | --- |
| 傳奇特效：技能群組（23 群 × 5） | 115 | L001～L115 | 裝備隨機池；測試用 `legend 特效key` |
| 傳奇特效：符文真言專屬（`RUNEWORD_ONLY_LEGENDARY`） | 15 | L116～L130 | 只由符文真言借用；裝備上的同名詞條不生效 |
| 傳奇特效：停用（`LEGACY_LEGENDARY_DISABLED`） | 5 | L131～L135 | 不掉落、不生效；`legend 特效key 部位 force` 模擬舊存檔 |
| 傳奇特效：通用（不屬於技能群組） | 9 | L136～L144 | 裝備隨機池；`legend 特效key` |
| **傳奇特效合計**（`PASSIVE_POOL` 中 `legendary: true`） | **144** | L001～L144 | |
| 符文真言（14／14／14／23：普通／精良／史詩／傳說） | **65** | W01～W65 | `runeword 真言id` 發配方符文 |

符文真言借用的傳奇特效共 24 個（專屬 15 個＋技能傳奇 9 個），在兩邊的條目互相標註。
`PASSIVE_POOL` 另有 7 個非傳奇的被動（破甲、反震…），不在本文件範圍。

**核對方式**（三種都要對得上，任一不符就停止測試並回報）：

1. 文件是否最新：`node tools/gen_legendary_runeword_test_cases.cjs --check`（印出「已是最新」）；`node --test tests/legendary-runeword-test-cases.test.cjs` 會檢查每個傳奇特效鍵與真言 id 都在文件與註記裡各出現一次。
2. 遊戲內：GM `legend list` 回「144 個」、`legend list rwonly` 回「15 個」、`legend list disabled` 回「5 個」、`legend list general` 回「9 個」；`legend list 群組id` 每群 5 個；`runeword list` 列出 65 組。
3. 配置表：`config/CSV/Equipment_Affix.csv` 第一欄為「傳奇特效」的列數＝151（144 個傳奇特效＋7 個非傳奇被動）；`config/CSV/Runes.csv` 的符文真言列數＝65（來源分別是 `config/Excel/Equipment_Affix.xlsx`、`config/Excel/Runes.xlsx`）。

## 1. 環境與準備

- 用 `ai/claude` 的 worktree 啟動本機伺服器（`啟動測試服.bat`），Canvas 戰場（預設）。開遊戲先 `GameSettings.set('mute', true)` 靜音。
- **拋棄式測試存檔**：測試會改裝備、等級、技能；不要用正式存檔。面板隱藏時畫面不會前進，讓分頁保持在前景。
- 共通起手式：

```text
level 600                      先讓角色夠強
equipset legendary 100 0 0 wear 穿上整套傳說裝備（每件都帶 1 個隨機傳奇特效；不加 wear 只會放進背包）
legend clear all               清掉全身隨機帶的傳奇特效，避免干擾
legend knifeChain              把主手的傳奇特效設為待測的 key（預設部位 weapon）
sglv knife max                 技能群組全階滿級；再到技能頁把該技能裝上技能列
god 1                          鎖血（測死亡／扣血類特效時改 god 0 或 HP_lock）
spawn 8 small 1000             千倍血木樁看觸發率；真實血量用 spawn 8；單體用 spawn 1 boss 1000
elite 1 all 3 1000000          讓敵人持續打你（受擊、格擋、反擊類）
statset crit 0                 需要穩定比較浮字時關爆擊；測完 statset clear
spawn off                      收尾
```

- 機率型效果至少觀察 40 次觸發機會；觸發率落在「表定值 ±10 個百分點」內算通過，偏離時記錄樣本數。
- 比較數值時先記「沒有該特效」的基準（`legend clear`），再裝上比對；同一場景、同一敵人、同一屬性覆寫。
- 傷害來源名稱可在戰鬥紀錄／戰鬥統計看到（例如「迅雷穿刺」「符文真言·擴散」「天罰」）。

## 2. 共通檢查（每一類至少抽 3 個條目做完整一輪，並全部條目做 C1、C6）

| 編號 | 檢查 | 做法 | 通過標準 |
| --- | --- | --- | --- |
| C1 | 主執行緒畫面與 Worker 結果一致 | 裝備詳情（主執行緒依快照渲染）顯示的傳奇特效／符文真言效果行，與實際戰鬥行為（Worker 計算）比對；屬性面板數值與浮字一致 | 畫面寫的數字＝實際效果（AI_RULES 8.3）；沒有「畫面說有、戰鬥沒有」或反過來 |
| C2 | 存讀檔後仍生效 | `save` 立即存檔 → 重新整理頁面 → 同一件裝備的傳奇特效 key、符文孔與成形的真言仍在，效果照常觸發 | 存檔只存 `passive: { key }`；真言是當場判定的衍生狀態（不存檔），重載後自動恢復 |
| C3 | 顯示文字走 String 表 | 測試中看到的所有顯示文字（特效名、說明、狀態名、浮字、紀錄）都不是寫死字串；`node tools/string-table/build_string_csv.cjs --check` 回報「仍寫死 0 條」 | 特效名稱與說明來自 Equipment_Affix 表、真言來自 Runes 表、其餘來自 String 表（AI_RULES 8.10） |
| C4 | 同名不生效 | 兩件裝備設同一個 key（`legend bloodthirst weapon`＋`legend bloodthirst ring`） | 只有先穿上的那件生效，另一件說明後綴「(重覆)」且變灰；效果不疊兩次。符文真言借用＋裝備同名：也只生效一次（`legendaryEffects` 是布林集合） |
| C5 | 符文真言專屬與停用規則 | `legend 專屬key`（不加 force）應被拒絕；加 `force` 後裝備上有該詞條但**不生效**；同一個 key 由符文真言借用時才生效。停用的 5 個在任何來源都不生效 | 新掉落的裝備（`equip legendary 100 weapon 200` 等大量發放）不會出現專屬或停用特效 |
| C6 | Console 與效能 | 每個條目測試期間看 Console | 沒有 error；長時間（≥ 2 分鐘）觸發型效果不讓 FPS 持續下降、物件數不無限累積 |
| C7 | 野外與封魔塔 | 抽每類 3 個條目到封魔塔（`tower_jump 10` 後挑戰） | 戰鬥中照常生效；擊殺類（狂暴血斧、亡者時間、擊殺回復、kill 觸發）在高塔**不作用**屬已知設計（只有 BOSS，擊殺即結算） |
| C8 | 換裝與換技能即時生效 | 戰鬥中卸下／換上該裝備、拆掉一顆符文、把技能移出技能列 | 效果立即消失或恢復（屬性快取以 `legendaryEffects` 物件為版本印記） |
| C9 | 舊存檔 | `docs/fixtures/save_lategame.json` 等舊存檔載入 | 舊裝備上的停用／專屬詞條原樣保留、不報錯、不生效；舊附魔不生效 |
| C10 | 雙手武器與修羅亂舞 | 主手換雙手武器測一次技能群組特效；雙刀亂舞第 8 格修羅亂舞時副手雙手武器上的傳奇特效 | 技能傳奇的數值不因雙手武器改變（說明值即實際值）；修羅亂舞未生效時副手雙手武器的特效不計 |

## 3. 傳奇特效逐項（144 個）

每個條目都要：①依「前置」準備 ②照「步驟與預期」至少觀察 2 次觸發並截圖（觸發瞬間＋狀態／數值） ③逐條驗「邊界」 ④做 C1。各條目共通的 C4（同名不生效）抽測即可。

### 3.1 技能群組：飛刀 `knife`（5 個）

#### L001 `knifeChain`｜連鎖（飛刀）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：每把飛刀有 25% 機率再彈射 2 次。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend knifeChain`；`sglv knife max`，技能頁把飛刀裝上技能列
- 步驟與預期：`spawn 8 small 1000`；數 20 次施放內每把飛刀的命中目標數：約 25% 的飛刀比表定多彈射 2 次（多打 2 個不同目標）
- 邊界：每把飛刀各擲一次機率；場上只剩 1 隻敵人或彈射範圍內沒有下一個目標時不彈射；與第 6 階連鎖彈射的次數相加、不互相覆蓋；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：飛刀逐段飛行與到達命中（Worker 協議 v32）：命中、彈射、擊殺判定都在飛行到達時結算；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`knifeBounceProc`）

#### L002 `knifeSplitter`｜分裂者（飛刀）

- 狀態：可隨機掉落（裝備傳奇池）｜被符文真言借用：【武庫】W49
- 說明（遊戲內）：飛刀殺死敵人時會分裂出 2 把小型飛刀，每把造成 50% 傷害，且可彈射 2 次。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend knifeSplitter`；`sglv knife max`，技能頁把飛刀裝上技能列
- 步驟與預期：用真實血量 `spawn 8`；飛刀擊殺敵人時，從屍體位置分裂出 2 把小飛刀，各造成本體 50% 傷害並可再彈射 2 次
- 邊界：千倍血打不死＝不會分裂（屬正常）；小飛刀擊殺**不應**再分裂成無限連鎖（觀察數量與 FPS）；也由符文真言【武庫】借用，裝備與真言同時有時只生效一次；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：飛刀逐段飛行與到達命中（Worker 協議 v32）：命中、彈射、擊殺判定都在飛行到達時結算；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`knifeSplit`）

#### L003 `knifeExecutioner`｜處刑者（飛刀）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：飛刀會優先在生命值最高的目標間彈射，且對其造成的傷害 +30%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend knifeExecutioner`；`sglv knife max`，技能頁把飛刀裝上技能列
- 步驟與預期：`spawn 6 small 1000`，先用普攻把其中幾隻打殘；觀察彈射優先跳向生命值最高的目標，對它的浮字比其他目標高約 30%
- 邊界：同血量時隨機；只對「被選為生命最高者」的那一跳增傷；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：飛刀逐段飛行與到達命中（Worker 協議 v32）：命中、彈射、擊殺判定都在飛行到達時結算；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`knifeExecutor`）

#### L004 `knifeShadowblade`｜影刃（飛刀）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：射出的飛刀數量 +2 把。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend knifeShadowblade`；`sglv knife max`，技能頁把飛刀裝上技能列
- 步驟與預期：每次施放射出的飛刀數＝表定＋2（扇形型態數飛刀圖示，全圓形型態數方向）
- 邊界：超神改變鎖敵型態後仍 +2；與第 7 階的追加相加；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：飛刀逐段飛行與到達命中（Worker 協議 v32）：命中、彈射、擊殺判定都在飛行到達時結算；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`knifeCountAdd`）

#### L005 `knifeWaltzblade`｜輪舞刃（飛刀）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：射出的第 1 把飛刀不再彈射，改為圍繞在你周圍 10 米處旋轉，對路徑上的所有敵人造成傷害，持續 5 秒。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend knifeWaltzblade`；`sglv knife max`，技能頁把飛刀裝上技能列
- 步驟與預期：每次施放的第 1 把飛刀不飛出，改在身邊 10 米處繞行 5 秒，路徑上的敵人都會受傷；其餘飛刀照常彈射
- 邊界：連續施放時刀環同時存在的數量不無限累積（5 秒到期消失）；死亡、換場景、進出高塔刀環要消失；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：飛刀逐段飛行與到達命中（Worker 協議 v32）：命中、彈射、擊殺判定都在飛行到達時結算；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`knifeOrbit`）

### 3.2 技能群組：突刺 `thrust`（5 個）

#### L006 `piercingFocus`｜凝鋒穿刺（突刺）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：突刺的長度 +30%、寬度 -15%，且造成的傷害 +30%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend piercingFocus`；`sglv thrust max`，突刺裝上技能列
- 步驟與預期：比對裝前後：突刺判定線長度 +30%（遠處原本打不到的敵人會被命中）、寬度 -15%；傷害是在技能倍率上**加 30 個百分點**（不是整體 ×1.3）
- 邊界：寬度縮減後細長路徑上的目標仍選得到（下限 1px）；長度加成套在含【貫穿突刺】延長之後的總長；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：突刺命中掛勾 `sgThrustOnHit` 集中處理重傷／流血／落雷／易傷，任一欄位改名會讓其他幾個一起失效；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/legendary.js`（`thrustLenPct`）；`js/skills2.js`（`thrustLenPct`、`thrustWidthPct`、`skillDamagePct`）

#### L007 `thousandWounds`｜千瘡百孔（突刺）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：每次突刺命中使敵人受到的突刺傷害 +4%，持續 5 秒，最多疊加 10 層。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend thousandWounds`；`sglv thrust max`，突刺裝上技能列
- 步驟與預期：`spawn 1 boss 1000`，連續突刺同一目標：每次命中使該目標受到的突刺傷害 +4%，浮字逐步上升；停手 5 秒後回落
- 邊界：最多 10 層（+40%），第 11 次不再增加；只放大突刺，普攻與其他技能不變；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：突刺命中掛勾 `sgThrustOnHit` 集中處理重傷／流血／落雷／易傷，任一欄位改名會讓其他幾個一起失效；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`thrustVuln`）

#### L008 `sunpiercerLance`｜貫日之刺（突刺）

- 狀態：可隨機掉落（裝備傳奇池）｜被符文真言借用：【孤狼】W51
- 說明（遊戲內）：突刺有 25% 機率使敵人重傷，使其受到的傷害 +20%，持續 5 秒。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend sunpiercerLance`；`sglv thrust max`，突刺裝上技能列
- 步驟與預期：突刺命中約 25% 使敵人「重傷」：狀態列出現圖示，5 秒內受到的**所有**傷害 +20%（普攻也會變高）
- 邊界：重複觸發是刷新還是疊加請記錄；也由符文真言【孤狼】借用，裝備與真言同時有時只生效一次；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：突刺命中掛勾 `sgThrustOnHit` 集中處理重傷／流血／落雷／易傷，任一欄位改名會讓其他幾個一起失效；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`thrustWound`）

#### L009 `thunderStab`｜迅雷穿刺（突刺）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：每次突刺擊中敵人時有 15% 機率附加 1 道落雷。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend thunderStab`；`sglv thrust max`，突刺裝上技能列
- 步驟與預期：突刺命中約 15% 在目標身上降下 1 道落雷（落雷特效＋雷屬性浮字，傷害來源「迅雷穿刺」）
- 邊界：不需要學落雷術；落雷以魔攻計算，物理流數字偏低屬正常；2026-09-29 曾因連鎖排程器誤刪而靜默失效，必測；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：突刺命中掛勾 `sgThrustOnHit` 集中處理重傷／流血／落雷／易傷，任一欄位改名會讓其他幾個一起失效；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`thrustThunder`）

#### L010 `heartrendBleed`｜穿心裂血（突刺）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：突刺會附加流血，每 0.5 秒造成 50% 物理傷害，持續 5 秒。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend heartrendBleed`；`sglv thrust max`，突刺裝上技能列
- 步驟與預期：突刺命中附加流血：每 0.5 秒一跳、每跳 50% 物攻、持續 5 秒（狀態列有流血）
- 邊界：重複命中刷新持續時間；與通用傳奇【嗜血】同時裝備時，流血目標再 +20%；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：突刺命中掛勾 `sgThrustOnHit` 集中處理重傷／流血／落雷／易傷，任一欄位改名會讓其他幾個一起失效；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`thrustDot`）

### 3.3 技能群組：迴旋斬 `cleave`（5 個）

#### L011 `chainSpin`｜連環迴旋（迴旋斬）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：迴旋斬的斬擊次數 +2 次。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend chainSpin`；`sglv cleave max`，迴旋斬裝上技能列（第 8 格若選天霸風神斬會改為被動自動施放）
- 步驟與預期：每次施放的斬擊（刀波）次數＝表定＋2，浮字段數同步 +2
- 邊界：與第 4 階連斬、第 7 階迴身四方斬的次數相加；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：刀波間隔 `SG_CLEAVE_WAVE_GAP_SEC`；飛斬型態（第 6 階或裂空飛斬）會把攻擊角色改成投射物；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`cleaveSlashAdd`）

#### L012 `galeBladeDance`｜旋風劍舞（迴旋斬）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：迴旋斬命中時有 25% 機率產生 1 道風刃，造成 100% 風系傷害。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend galeBladeDance`；`sglv cleave max`，迴旋斬裝上技能列（第 8 格若選天霸風神斬會改為被動自動施放）
- 步驟與預期：迴旋斬命中約 25% 額外打出 1 道風刃（風屬性浮字、100% 傷害）
- 邊界：每次命中各擲一次；風刃不再觸發風刃（不遞迴）；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：刀波間隔 `SG_CLEAVE_WAVE_GAP_SEC`；飛斬型態（第 6 階或裂空飛斬）會把攻擊角色改成投射物；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`cleaveWindBlade`）

#### L013 `skyrendSlash`｜裂空飛斬（迴旋斬）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：迴旋斬的斬擊會向外飛出 60 米，命中路徑上的敵人。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend skyrendSlash`；`sglv cleave max`，迴旋斬裝上技能列（第 8 格若選天霸風神斬會改為被動自動施放）
- 步驟與預期：斬擊改為向外飛出 60 米的飛斬，遠處路徑上的敵人被命中
- 邊界：已學第 6 階震碎斬時取兩者較大的距離，不相加；飛斬型態下攻擊角色改為投射物（特效要跟著改）；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：刀波間隔 `SG_CLEAVE_WAVE_GAP_SEC`；飛斬型態（第 6 階或裂空飛斬）會把攻擊角色改成投射物；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/legendary.js`（`cleaveFlyM`）；`js/skills2.js`（`cleaveFlyM`）

#### L014 `exploitWeakness`｜乘虛之斬（迴旋斬）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：迴旋斬對暈眩中的敵人造成額外的 50% 傷害。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend exploitWeakness`；`sglv cleave max`，迴旋斬裝上技能列（第 8 格若選天霸風神斬會改為被動自動施放）
- 步驟與預期：需要暈眩來源（迴旋斬第 5 階暈眩擊，或符文真言凜冬使者／永凍）；對暈眩中的敵人浮字比未暈眩的高 50%
- 邊界：只認暈眩（凍結、石化走暈眩管線也算），減速不算；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：刀波間隔 `SG_CLEAVE_WAVE_GAP_SEC`；飛斬型態（第 6 階或裂空飛斬）會把攻擊角色改成投射物；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`cleaveStunnedDmgPct`）

#### L015 `gatheringVortex`｜聚敵旋渦（迴旋斬）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：迴旋斬會將 36 米內的 2 個敵人拉近至身邊 10 米範圍內。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend gatheringVortex`；`sglv cleave max`，迴旋斬裝上技能列（第 8 格若選天霸風神斬會改為被動自動施放）
- 步驟與預期：`spawn 8 small 1000` 讓敵人散開；每次施放把 36 米內隨機 2 個敵人拉到身邊 10 米內
- 邊界：每次只拉 2 個；BOSS／控制免疫的敵人是否被拉請記錄；不得把敵人拉進牆或地形外；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：刀波間隔 `SG_CLEAVE_WAVE_GAP_SEC`；飛斬型態（第 6 階或裂空飛斬）會把攻擊角色改成投射物；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`cleavePull`）

### 3.4 技能群組：疾風迅雷 `gale`（5 個）

#### L016 `galeWhirlwind`｜風捲殘雲（疾風迅雷）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：疾風斬命中時有 25% 機率在目標處形成 1 道真空斬，對周圍 6 米內的敵人造成 100% 風系傷害。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend galeWhirlwind`；`sglv gale max`，疾風迅雷（GM 與特效說明稱「疾風斬」）裝上技能列
- 步驟與預期：疾風斬命中約 25% 在目標處形成真空斬，對 6 米內的敵人造成 100% 風系傷害
- 邊界：真空斬範圍以目標為圓心；不遞迴觸發自己；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：命中設定 `hookCfg` 同時帶真空斬／雙影／斬殺／風切，改動任一欄位要四個一起回歸；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`galeVacuum`）

#### L017 `galeExecute`｜斬殺（疾風迅雷）

- 狀態：可隨機掉落（裝備傳奇池）｜被符文真言借用：【屠龍者】W54
- 說明（遊戲內）：疾風斬有 20% 機率可立即殺死生命值 10% 以下的非 BOSS 敵人。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend galeExecute`；`sglv gale max`，疾風迅雷（GM 與特效說明稱「疾風斬」）裝上技能列
- 步驟與預期：用真實血量 `spawn 8`；生命 10% 以下的非 BOSS 敵人被疾風斬命中時約 20% 直接死亡
- 邊界：`spawn 1 boss` 與封魔塔 BOSS 不可被斬殺；也由符文真言【屠龍者】借用；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：命中設定 `hookCfg` 同時帶真空斬／雙影／斬殺／風切，改動任一欄位要四個一起回歸；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`galeExecute`）

#### L018 `galeTwinShadow`｜雙影（疾風迅雷）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：疾風斬命中時有 50% 機率額外對附近 1 個敵人造成 50% 傷害。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend galeTwinShadow`；`sglv gale max`，疾風迅雷（GM 與特效說明稱「疾風斬」）裝上技能列
- 步驟與預期：疾風斬命中約 50% 對 10 米內另 1 個敵人額外造成 50% 傷害
- 邊界：場上只有 1 隻敵人時不觸發；不會選到同一個目標；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：命中設定 `hookCfg` 同時帶真空斬／雙影／斬殺／風切，改動任一欄位要四個一起回歸；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`galeTwin`）

#### L019 `galeWindwalker`｜風行者（疾風迅雷）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：疾風斬命中時附加風切狀態：移動速度 -80%、命中率 -50%，且每 0.5 秒受到 50% 風系傷害，持續 4 秒。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend galeWindwalker`；`sglv gale max`，疾風迅雷（GM 與特效說明稱「疾風斬」）裝上技能列
- 步驟與預期：疾風斬命中附加風切：移速 -80%、命中率 -50%、每 0.5 秒風系傷害（本體傷害 × 50%）、4 秒
- 邊界：風切的數值沿用 Status 表；重複命中刷新；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：命中設定 `hookCfg` 同時帶真空斬／雙影／斬殺／風切，改動任一欄位要四個一起回歸；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`galeWindRend`）

#### L020 `galeGodspeed`｜神速斬（疾風迅雷）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：疾風斬每次命中時，疾風斬的冷卻時間 -0.05 秒。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend galeGodspeed`；`sglv gale max`，疾風迅雷（GM 與特效說明稱「疾風斬」）裝上技能列
- 步驟與預期：每命中 1 個敵人，疾風斬的冷卻 -0.05 秒；8 隻敵人同時被打到時一次 -0.4 秒（看技能列冷卻）
- 邊界：冷卻不低於 0；多段命中每段都算；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：命中設定 `hookCfg` 同時帶真空斬／雙影／斬殺／風切，改動任一欄位要四個一起回歸；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`galeCdrSec`）

### 3.5 技能群組：血刃斬 `bloodblade`（5 個）

#### L021 `bloodPoisonBurst`｜毒爆（血刃斬）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：血刃斬造成中毒的敵人死亡後留下一灘毒霧，對範圍 6 米內的敵人每 0.5 秒造成 50% 中毒傷害，持續 3 秒。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend bloodPoisonBurst`；`sglv bloodblade max`，血刃斬裝上技能列；中毒需第 4 階血毒刃、流血為本體
- 步驟與預期：用真實血量 `spawn 8`；被血刃斬塗上中毒的敵人死亡後原地留下毒霧（6 米、每 0.5 秒 50% 中毒傷害、3 秒）
- 邊界：沒學第 4 階血毒刃＝沒有中毒＝不會有毒霧；死於其他技能但身上帶血刃斬中毒也要留霧；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：敵人死亡掛勾 `sgBloodFieldsOnDeath` 同時處理毒霧與血霧；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`bloodPoisonMist`）

#### L022 `bloodVenomRite`｜毒血祭（血刃斬）

- 狀態：可隨機掉落（裝備傳奇池）｜被符文真言借用：【血祭】W45
- 說明（遊戲內）：血刃斬的中毒每感染 1 個敵人就使自身生命值 -0.5%，但造成的中毒與流血傷害提高 50%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend bloodVenomRite`；`sglv bloodblade max`，血刃斬裝上技能列；中毒需第 4 階血毒刃、流血為本體
- 步驟與預期：血刃斬每讓 1 個敵人中毒，自身生命 -0.5%；中毒與流血傷害 +50%（與零日感染相乘）
- 邊界：`god 1` 下生命最低 1、`HP_lock` 下不扣；多目標同時中毒時扣血次數＝感染數；也由符文真言【血祭】借用；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：敵人死亡掛勾 `sgBloodFieldsOnDeath` 同時處理毒霧與血霧；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`bloodVenomRite`）

#### L023 `bloodMist`｜血霧（血刃斬）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：血刃斬造成流血的敵人死亡後留下一灘血霧，血霧內的敵人每次受傷都回復你 0.1% 生命值，持續 4 秒。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend bloodMist`；`sglv bloodblade max`，血刃斬裝上技能列；中毒需第 4 階血毒刃、流血為本體
- 步驟與預期：被血刃斬塗上流血的敵人死亡後留下血霧（6 米、4 秒）；霧內敵人每次受傷你回復 0.1% 生命（綠字）
- 邊界：血霧的回復比例在生成當下定版，之後換裝不改變已存在的血霧；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：敵人死亡掛勾 `sgBloodFieldsOnDeath` 同時處理毒霧與血霧；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`bloodMistField`）

#### L024 `bloodShadow`｜血影（血刃斬）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：血刃斬有 35% 機率揮出第 2 斬。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend bloodShadow`；`sglv bloodblade max`，血刃斬裝上技能列；中毒需第 4 階血毒刃、流血為本體
- 步驟與預期：血刃斬約 35% 揮出第 2 斬（同規格，含流血／中毒）
- 邊界：第 1 斬已殺死主目標時不揮第 2 斬；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：敵人死亡掛勾 `sgBloodFieldsOnDeath` 同時處理毒霧與血霧；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`bloodSecondSlash`）

#### L025 `bloodCleaver`｜切割（血刃斬）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：血刃斬的斬擊傷害 +100%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend bloodCleaver`；`sglv bloodblade max`，血刃斬裝上技能列；中毒需第 4 階血毒刃、流血為本體
- 步驟與預期：血刃斬的斬擊本體傷害 +100%（浮字約翻倍）
- 邊界：只放大斬擊本體：流血、中毒每跳不變；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：敵人死亡掛勾 `sgBloodFieldsOnDeath` 同時處理毒霧與血霧；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`bloodSlashPct`）

### 3.6 技能群組：雙刀亂舞 `dualdance`（5 個）

#### L026 `danceFrenzy`｜狂舞（雙刀亂舞）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：暴風之舞持續期間，每施放 1 次雙刀亂舞就使下一次的施放間隔縮短 6%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend danceFrenzy`；`sglv dualdance max`，雙刀亂舞裝上技能列；「暴風之舞」指第 7 階【暴風亂舞】、「鐵血之舞」指第 5 階
- 步驟與預期：暴風亂舞（第 7 階）期間，每施放 1 次雙刀亂舞，下一次的施放間隔縮短 6%（施放越來越快）
- 邊界：每次縮短上限 90%（不會一次歸零）；暴風亂舞結束後間隔恢復；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：暴風亂舞化身狀態 `SKILL2_RT.storm`；死亡延後與修羅亂舞（第 8 格）的裝備規則互不干擾；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`danceStormGap`）

#### L027 `danceBerserker`｜狂戰士（雙刀亂舞）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：鐵血之舞造成的自身生命損失 -25%，且造成的傷害 +25%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend danceBerserker`；`sglv dualdance max`，雙刀亂舞裝上技能列；「暴風之舞」指第 7 階【暴風亂舞】、「鐵血之舞」指第 5 階
- 步驟與預期：鐵血之舞（第 5 階）造成的自身生命損失 -25%、其流血傷害 +25%
- 邊界：自身損失降低夾在 100% 以內；沒學第 5 階無效；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：暴風亂舞化身狀態 `SKILL2_RT.storm`；死亡延後與修羅亂舞（第 8 格）的裝備規則互不干擾；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`danceIronAmp`）

#### L028 `danceUnyielding`｜不屈之誓（雙刀亂舞）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：暴風之舞持續期間你的死亡延後 8 秒才生效，且這 8 秒內你的傷害提高 50%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend danceUnyielding`；`sglv dualdance max`，雙刀亂舞裝上技能列；「暴風之舞」指第 7 階【暴風亂舞】、「鐵血之舞」指第 5 階
- 步驟與預期：`god 0`、`elite 1 all 3 1` 讓自己被打死：暴風亂舞期間的致死傷害延後 8 秒才結算，這 8 秒內傷害 +50%
- 邊界：暴風亂舞不在作用中時照常死亡；8 秒內回滿血是否取消死亡請記錄；死亡原因統計記為該特效；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：暴風亂舞化身狀態 `SKILL2_RT.storm`；死亡延後與修羅亂舞（第 8 格）的裝備規則互不干擾；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`danceDeathDefer`）

#### L029 `danceThousandCuts`｜殺千刀（雙刀亂舞）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：雙刀亂舞每殺死 1 個敵人就使暴風之舞的持續時間 +0.2 秒。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend danceThousandCuts`；`sglv dualdance max`，雙刀亂舞裝上技能列；「暴風之舞」指第 7 階【暴風亂舞】、「鐵血之舞」指第 5 階
- 步驟與預期：用真實血量 `spawn 12`；雙刀亂舞每殺 1 個敵人，暴風亂舞的持續時間 +0.2 秒
- 邊界：只在暴風亂舞作用中延長；高塔只有 BOSS，擊殺即結算；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：暴風亂舞化身狀態 `SKILL2_RT.storm`；死亡延後與修羅亂舞（第 8 格）的裝備規則互不干擾；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`danceStormKill`）

#### L030 `danceTwinBlades`｜雙生刃（雙刀亂舞）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：雙刀亂舞的擊中目標數量 +2 個。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend danceTwinBlades`；`sglv dualdance max`，雙刀亂舞裝上技能列；「暴風之舞」指第 7 階【暴風亂舞】、「鐵血之舞」指第 5 階
- 步驟與預期：雙刀亂舞每次擊中的目標數＝表定＋2
- 邊界：場上敵人不足時不重複打同一目標；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：暴風亂舞化身狀態 `SKILL2_RT.storm`；死亡延後與修羅亂舞（第 8 格）的裝備規則互不干擾；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`danceTargetAdd`）

### 3.7 技能群組：反擊 `counter`（5 個）

#### L031 `counterOath`｜堅韌誓言（反擊）

- 狀態：可隨機掉落（裝備傳奇池）｜被符文真言借用：【輪迴】W46
- 說明（遊戲內）：反擊 200 次後獲得無敵狀態，持續 3 秒。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend counterOath`；`sglv counter max`，**反擊必須裝上技能列**才會觸發（主動型被動，受擊觸發）；用 `elite 1 all 3 1000000` 讓敵人持續攻擊你、`god 1`
- 步驟與預期：累計反擊 200 次後獲得無敵 3 秒（狀態列無敵圖示、受擊不扣血）
- 邊界：計數在死亡、換場景、進出高塔時是否歸零請記錄；也由符文真言【輪迴】借用；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：反擊規格 `sgCounterLegendSpec`（`counterPerfect`／`counterBloodPay`／`counterFireball`／`counterOath`／`counterWrath` 同一處讀取）；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`counterOath`）

#### L032 `counterWrath`｜怒火（反擊）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：反擊 100 次後獲得怒火狀態，造成的傷害提高 30%，持續 4 秒。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend counterWrath`；`sglv counter max`，**反擊必須裝上技能列**才會觸發（主動型被動，受擊觸發）；用 `elite 1 all 3 1000000` 讓敵人持續攻擊你、`god 1`
- 步驟與預期：累計反擊 100 次後獲得「怒火」：傷害 +30%、4 秒
- 邊界：計數在死亡、換場景、進出高塔時是否歸零請記錄；怒火期間再滿 100 次是刷新還是不觸發；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：反擊規格 `sgCounterLegendSpec`（`counterPerfect`／`counterBloodPay`／`counterFireball`／`counterOath`／`counterWrath` 同一處讀取）；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`counterWrath`）

#### L033 `counterPerfect`｜完美姿態（反擊）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：每次反擊有 5% 機率造成完美反擊，該次反擊傷害提高 500%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend counterPerfect`；`sglv counter max`，**反擊必須裝上技能列**才會觸發（主動型被動，受擊觸發）；用 `elite 1 all 3 1000000` 讓敵人持續攻擊你、`god 1`
- 步驟與預期：每次反擊約 5% 打出完美反擊，該次傷害 ×6（+500%）
- 邊界：樣本量要大（至少 200 次反擊）才看得出機率；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：反擊規格 `sgCounterLegendSpec`（`counterPerfect`／`counterBloodPay`／`counterFireball`／`counterOath`／`counterWrath` 同一處讀取）；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`counterPerfect`）

#### L034 `counterBloodPay`｜以血還血（反擊）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：每次反擊損失自身 0.25% 生命值，但反擊傷害提高 100%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend counterBloodPay`；`sglv counter max`，**反擊必須裝上技能列**才會觸發（主動型被動，受擊觸發）；用 `elite 1 all 3 1000000` 讓敵人持續攻擊你、`god 1`
- 步驟與預期：每次反擊自身生命 -0.25%、反擊傷害 +100%
- 邊界：`HP_lock` 下不扣；死亡原因統計記為「以血還血」；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：反擊規格 `sgCounterLegendSpec`（`counterPerfect`／`counterBloodPay`／`counterFireball`／`counterOath`／`counterWrath` 同一處讀取）；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`counterBloodPay`）

#### L035 `counterWindBody`｜風之體（反擊）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：反擊有 20% 機率附加 1 顆火球射向目標，造成 100% 普攻傷害的火焰傷害。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend counterWindBody`；`sglv counter max`，**反擊必須裝上技能列**才會觸發（主動型被動，受擊觸發）；用 `elite 1 all 3 1000000` 讓敵人持續攻擊你、`god 1`
- 步驟與預期：反擊約 20% 附帶 1 顆火球射向目標，造成 100% 普攻傷害的火焰傷害
- 邊界：火球以普攻最終傷害為基準，不再過一次目標防禦；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：反擊規格 `sgCounterLegendSpec`（`counterPerfect`／`counterBloodPay`／`counterFireball`／`counterOath`／`counterWrath` 同一處讀取）；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`counterFireball`）

### 3.8 技能群組：嗜血狂怒 `bloodrage`（5 個）

#### L036 `rageValor`｜英勇氣概（嗜血狂怒）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：嗜血狂怒的攻速額外 +30%（與本體同為突破上限的乘算）。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend rageValor`；`sglv bloodrage max`，嗜血狂怒裝上技能列；血飲術＝第 6 階、狂血盛宴＝第 7 階、嗜血反震＝第 5 階
- 步驟與預期：先 `maxstats` 讓攻速頂到上限，再施放嗜血狂怒：攻速仍再提高 30%（與本體同為突破上限的乘算）
- 邊界：狂怒結束後攻速回落；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：每 tick 讀 `sgLegendTick` 快取（以 `legendaryEffects` 物件為版本印記，換裝立即失效）；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`rageAspdPct`）

#### L037 `rageBurnBlood`｜燃血（嗜血狂怒）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：血飲術每造成 1 次自身生命損失就使你造成的傷害 +1%，最多疊 50 層，持續 4 秒。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend rageBurnBlood`；`sglv bloodrage max`，嗜血狂怒裝上技能列；血飲術＝第 6 階、狂血盛宴＝第 7 階、嗜血反震＝第 5 階
- 步驟與預期：血飲術（第 6 階）每造成 1 次自身生命損失疊 1 層「燃血」：傷害 +1%、4 秒，最多 50 層
- 邊界：第 51 次不再增加；距離判定沒過、沒扣到血的那次不疊；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：每 tick 讀 `sgLegendTick` 快取（以 `legendaryEffects` 物件為版本印記，換裝立即失效）；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`rageBurnBlood`）

#### L038 `rageBloodDebt`｜血債償還（嗜血狂怒）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：血飲術造成的自身生命損失降低 25%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend rageBloodDebt`；`sglv bloodrage max`，嗜血狂怒裝上技能列；血飲術＝第 6 階、狂血盛宴＝第 7 階、嗜血反震＝第 5 階
- 步驟與預期：血飲術造成的自身生命損失 -25%（對照未裝時每次扣血量）
- 邊界：降低量刻意不吃雙手補償，不會變成 -100%；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：每 tick 讀 `sgLegendTick` 快取（以 `legendaryEffects` 物件為版本印記，換裝立即失效）；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`rageSelfCut`）

#### L039 `rageZealot`｜狂熱者（嗜血狂怒）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：每 0.5 連擊數使狂血盛宴的傷害加成再提高 10%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend rageZealot`；`sglv bloodrage max`，嗜血狂怒裝上技能列；血飲術＝第 6 階、狂血盛宴＝第 7 階、嗜血反震＝第 5 階
- 步驟與預期：狂血盛宴（第 7 階）的傷害加成隨連擊數提高：每 0.5 連擊數 +10%（每 1 連擊數 +20%）
- 邊界：連擊數＝面板值＋狂化連殺＋狂暴之舞，與普攻口徑一致；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：每 tick 讀 `sgLegendTick` 快取（以 `legendaryEffects` 物件為版本印記，換裝立即失效）；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`rageZealotPct`）

#### L040 `rageSlaughterer`｜屠戮者（嗜血狂怒）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：狂怒期間每殺死 1 個敵人使嗜血反震的效果提高 5%，最多疊 10 層，持續 4 秒。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend rageSlaughterer`；`sglv bloodrage max`，嗜血狂怒裝上技能列；血飲術＝第 6 階、狂血盛宴＝第 7 階、嗜血反震＝第 5 階
- 步驟與預期：狂怒期間每殺 1 個敵人疊 1 層：嗜血反震（第 5 階）效果 +5%、4 秒，最多 10 層
- 邊界：狂怒不在作用中時擊殺不疊；高塔無擊殺事件；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：每 tick 讀 `sgLegendTick` 快取（以 `legendaryEffects` 物件為版本印記，換裝立即失效）；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`rageThornsStack`）

### 3.9 技能群組：火球術 `fireball`（5 個）

#### L041 `fireballBeadShot`｜連珠火（火球術）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：每次發射火球數量 +1 個，且累計每發射 5 個火球會再額外發射 1 個火球。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend fireballBeadShot`；`sglv fireball max`，火球術裝上技能列；第 7 階起火球改為隕石（殞石）型態
- 步驟與預期：每次施放火球數 +1；累計每發射 5 顆再額外多 1 顆（第 5、10、15… 顆時多一顆）
- 邊界：額外的那顆不計入累計；計數是整場戰鬥的執行期狀態；隕石型態同樣 +1；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：火球與殞石兩條分支各自讀傳奇（一般火球是平射、殞石走 `sgTickMeteors`），兩種型態都要測；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`fireballCountAdd`）

#### L042 `fireballEmber`｜燃燼（火球術）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：火球術造成的燃燒效果傷害 +50%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend fireballEmber`；`sglv fireball max`，火球術裝上技能列；第 7 階起火球改為隕石（殞石）型態
- 步驟與預期：火球術塗上的燃燒每跳傷害 +50%
- 邊界：沒學第 2 階燃燒＝無效；只放大火球術這棵樹的燃燒，火龍捲的燃燒不變；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：火球與殞石兩條分支各自讀傳奇（一般火球是平射、殞石走 `sgTickMeteors`），兩種型態都要測；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`fireballBurnDmgPct`）

#### L043 `fireballPool`｜火池（火球術）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：火球及殞石爆炸後會在地上留下一團半徑 6 米的火池，每 0.5 秒對範圍內的敵人造成 50% 火焰傷害，持續 4 秒。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend fireballPool`；`sglv fireball max`，火球術裝上技能列；第 7 階起火球改為隕石（殞石）型態
- 步驟與預期：火球與隕石爆炸後地上留下半徑 6 米火池，每 0.5 秒 50% 火焰傷害、4 秒
- 邊界：火池傷害以施放當下的本體傷害定版；大量施放時火池數量不得讓 FPS 崩潰；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：火球與殞石兩條分支各自讀傳奇（一般火球是平射、殞石走 `sgTickMeteors`），兩種型態都要測；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`firePool`）

#### L044 `fireballHeart`｜烈焰之心（火球術）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：火球及殞石對燃燒狀態的敵人造成的傷害 +30%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend fireballHeart`；`sglv fireball max`，火球術裝上技能列；第 7 階起火球改為隕石（殞石）型態
- 步驟與預期：火球及隕石對燃燒中的敵人浮字 +30%
- 邊界：燃燒來源不限火球術（火龍捲的燃燒也算）；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：火球與殞石兩條分支各自讀傳奇（一般火球是平射、殞石走 `sgTickMeteors`），兩種型態都要測；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`fireballBurningDmgPct`）

#### L045 `fireballBurst`｜爆裂（火球術）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：火球爆裂會額外產生 3 個小火球。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend fireballBurst`；`sglv fireball max`，火球術裝上技能列；第 7 階起火球改為隕石（殞石）型態
- 步驟與預期：火球爆裂（第 3 階）的小火球數＝表定＋3
- 邊界：沒學第 3 階＝沒有爆裂可加；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：火球與殞石兩條分支各自讀傳奇（一般火球是平射、殞石走 `sgTickMeteors`），兩種型態都要測；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`fireballSplitAdd`）

### 3.10 技能群組：火龍捲 `firepillar`（5 個）

#### L046 `firepillarTracking`｜追蹤烈焰（火龍捲）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：火龍捲移動速度 +50%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend firepillarTracking`；`sglv firepillar max`，火龍捲裝上技能列；燃燒需第 4 階
- 步驟與預期：火龍捲游走速度 +50%（同壽命內走得更遠）
- 邊界：沒有游走半徑的型態（第 7 階火牆）不受影響；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：地面場域 `SKILL2_RT.grounds`：共鳴只數火龍捲本體，火池／毒霧不算；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`firepillarSpeedPct`）

#### L047 `firepillarSpread`｜火龍擴散（火龍捲）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：火龍捲的體積增加 30%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend firepillarSpread`；`sglv firepillar max`，火龍捲裝上技能列；燃燒需第 4 階
- 步驟與預期：火龍捲體積與判定範圍 +30%（與第 2 階強化相乘）
- 邊界：火牆型態長寬同步放大；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：地面場域 `SKILL2_RT.grounds`：共鳴只數火龍捲本體，火池／毒霧不算；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`firepillarScalePct`）

#### L048 `firepillarOutburst`｜火焰爆衝（火龍捲）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：火龍捲的傷害段數 +3 段。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend firepillarOutburst`；`sglv firepillar max`，火龍捲裝上技能列；燃燒需第 4 階
- 步驟與預期：火龍捲傷害段數＝表定＋3（同壽命內浮字段數 +3）
- 邊界：段數增加後每段間隔縮短（壽命 ÷ 段數）；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：地面場域 `SKILL2_RT.grounds`：共鳴只數火龍捲本體，火池／毒霧不算；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`firepillarHitsAdd`）

#### L049 `firepillarDeflagration`｜爆燃（火龍捲）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：火龍捲每造成 1 段傷害就使該敵人受到的燃燒傷害 +10%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend firepillarDeflagration`；`sglv firepillar max`，火龍捲裝上技能列；燃燒需第 4 階
- 步驟與預期：火龍捲每打 1 段，該敵人受到的燃燒傷害 +10%（燃燒每跳逐步變大）
- 邊界：需要燃燒（第 4 階）；放大量的持續時間＝燃燒持續時間；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：地面場域 `SKILL2_RT.grounds`：共鳴只數火龍捲本體，火池／毒霧不算；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`firepillarBurnAmp`）

#### L050 `firepillarResonance`｜火龍共鳴（火龍捲）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：場上每存在 1 道火龍捲，所有火龍捲造成的傷害 +10%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend firepillarResonance`；`sglv firepillar max`，火龍捲裝上技能列；燃燒需第 4 階
- 步驟與預期：場上每存在 1 道火龍捲，所有火龍捲傷害 +10%（同時 3 道＝+30%）
- 邊界：只數火龍捲本體，火池、毒霧等衍生場域不算；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：地面場域 `SKILL2_RT.grounds`：共鳴只數火龍捲本體，火池／毒霧不算；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`firepillarResonancePct`）

### 3.11 技能群組：火狩 `firehunt`（5 個）

#### L051 `firehuntAmplify`｜增焰（火狩）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：火狩的體積與環繞半徑 +25%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend firehuntAmplify`；`sglv firehunt max`，火狩裝上技能列；環繞半徑 8 米＝施法距離，敵人要靠近
- 步驟與預期：火狩體積與環繞半徑 +25%（8 米 → 10 米，與第 2 階相乘）
- 邊界：環繞半徑變大後施法距離跟著變大；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：環繞物上限 `SG_ORBIT_MAX_ORBS`；數量減半與增幅同時套用才是原本的交換；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`firehuntScalePct`）

#### L052 `firehuntConcurrent`｜伴生併發（火狩）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：每 1 秒，你的 1 團火狩會飛出攻擊半徑 36 米內的任意敵人，對目標 10 米內的所有敵人造成 300% 火焰傷害。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend firehuntConcurrent`；`sglv firehunt max`，火狩裝上技能列；環繞半徑 8 米＝施法距離，敵人要靠近
- 步驟與預期：火狩存在時每 1 秒有 1 團飛出攻擊 36 米內任一敵人，對其 10 米內所有敵人造成 300% 火焰傷害
- 邊界：沒有敵人在 36 米內時不飛出；飛出的那團是否回到環繞請記錄；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：環繞物上限 `SG_ORBIT_MAX_ORBS`；數量減半與增幅同時套用才是原本的交換；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`firehuntLaunch`）

#### L053 `firehuntBlaze`｜烈火狩（火狩）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：在火狩的持續時間內，每 1 秒你的火焰傷害提高 2%，最多 20 層（與火焰增幅各自計算層數，火狩全部消失後結束）。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend firehuntBlaze`；`sglv firehunt max`，火狩裝上技能列；環繞半徑 8 米＝施法距離，敵人要靠近
- 步驟與預期：火狩持續期間每 1 秒疊 1 層「烈火狩」：火焰傷害 +2%，最多 20 層；火狩全部消失後結束
- 邊界：與火球術【火焰增幅】的層數各自計算、不互佔；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：環繞物上限 `SG_ORBIT_MAX_ORBS`；數量減半與增幅同時套用才是原本的交換；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`firehuntFireAmp`）

#### L054 `firehuntDetonate`｜炎爆（火狩）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：一個敵人被火狩命中 10 次後會爆炸，對其周圍 6 米內的敵人造成 250% 火焰傷害。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend firehuntDetonate`；`sglv firehunt max`，火狩裝上技能列；環繞半徑 8 米＝施法距離，敵人要靠近
- 步驟與預期：同一個敵人被火狩命中 10 次後爆炸，對其周圍 6 米內造成 250% 火焰傷害
- 邊界：爆炸後計數重新累積；爆炸傷害在施放當下定版；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：環繞物上限 `SG_ORBIT_MAX_ORBS`；數量減半與增幅同時套用才是原本的交換；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`firehuntDetonate`）

#### L055 `firehuntHunter`｜狩獵者（火狩）

- 狀態：可隨機掉落（裝備傳奇池）｜被符文真言借用：【神罰】W62
- 說明（遊戲內）：你的火狩數量減半（無條件進位，至少 1 團），但造成的傷害額外 +150%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend firehuntHunter`；`sglv firehunt max`，火狩裝上技能列；環繞半徑 8 米＝施法距離，敵人要靠近
- 步驟與預期：火狩數量減半（無條件進位、至少 1 團），但每團傷害 +150%
- 邊界：1 團時仍是 1 團；也由符文真言【神罰】借用；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：環繞物上限 `SG_ORBIT_MAX_ORBS`；數量減半與增幅同時套用才是原本的交換；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`firehuntHunter`）

### 3.12 技能群組：岩甲術 `rockarmor`（5 個）

#### L056 `rockHeavyArmor`｜重岩甲（岩甲術）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：岩甲護盾效果 +30%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend rockHeavyArmor`；`sglv rockarmor max`，岩甲術裝上技能列；`elite 1 all 3 1000000` 讓敵人打你、`god 1`
- 步驟與預期：岩甲護盾量 +30%（看護盾條數值）
- 邊界：與超神【金剛不壞】相乘；第 4 階護盾增幅不放大這一份；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：護盾乘區：傳奇【重岩甲】與超神【金剛不壞】乘在同一個 pct，第 4 階【護盾增幅】只放大生命護盾效率；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`rockShieldPct`）

#### L057 `rockLightArmor`｜輕飛甲（岩甲術）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：岩甲護盾存在期間，你的移動速度 +30%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend rockLightArmor`；`sglv rockarmor max`，岩甲術裝上技能列；`elite 1 all 3 1000000` 讓敵人打你、`god 1`
- 步驟與預期：岩甲護盾存在期間移動速度 +30%，護盾破掉或到期後恢復
- 邊界：護盾量為 0 的瞬間就要恢復原速；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：護盾乘區：傳奇【重岩甲】與超神【金剛不壞】乘在同一個 pct，第 4 階【護盾增幅】只放大生命護盾效率；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`rockMoveSpeedPct`）

#### L058 `rockAmpBoost`｜巨岩增幅（岩甲術）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：岩甲增幅可疊加的層數 +10 層。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend rockAmpBoost`；`sglv rockarmor max`，岩甲術裝上技能列；`elite 1 all 3 1000000` 讓敵人打你、`god 1`
- 步驟與預期：岩甲增幅（第 6 階）可疊層數＝表定＋10
- 邊界：沒學第 6 階無效；層數不吃雙手補償；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：護盾乘區：傳奇【重岩甲】與超神【金剛不壞】乘在同一個 pct，第 4 階【護盾增幅】只放大生命護盾效率；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`rockAmpStacksAdd`）

#### L059 `rockSpikeArmor`｜尖刺甲（岩甲術）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：岩甲尖刺的效果提高 50%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend rockSpikeArmor`；`sglv rockarmor max`，岩甲術裝上技能列；`elite 1 all 3 1000000` 讓敵人打你、`god 1`
- 步驟與預期：岩甲尖刺（第 3 階）反傷 +50%
- 邊界：與超神【金剛不壞】的尖刺加成相加成一個乘區；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：護盾乘區：傳奇【重岩甲】與超神【金剛不壞】乘在同一個 pct，第 4 階【護盾增幅】只放大生命護盾效率；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`rockSpikePct`）

#### L060 `rockEarthHeart`｜大地之心（岩甲術）

- 狀態：可隨機掉落（裝備傳奇池）｜被符文真言借用：【地裂】W43
- 說明（遊戲內）：當你的生命護盾降至 0 時獲得無敵 3 秒；此效果每 60 秒只能觸發 1 次。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend rockEarthHeart`；`sglv rockarmor max`，岩甲術裝上技能列；`elite 1 all 3 1000000` 讓敵人打你、`god 1`
- 步驟與預期：生命護盾被打到 0 的那一下獲得無敵 3 秒
- 邊界：每 60 秒只觸發 1 次；護盾長時間為 0 不會反覆觸發（事件判定，不是輪詢）；也由符文真言【地裂】借用；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：護盾乘區：傳奇【重岩甲】與超神【金剛不壞】乘在同一個 pct，第 4 階【護盾增幅】只放大生命護盾效率；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`rockHeartInvuln`）

### 3.13 技能群組：泥沼術 `mire`（5 個）

#### L061 `mireSpread`｜蔓延（泥沼術）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：泥沼術的範圍 +25%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend mireSpread`；`sglv mire max`，泥沼術裝上技能列；熔岩沼＝第 7 階
- 步驟與預期：泥沼範圍邊長 +25%（看地面範圍與受影響敵人）
- 邊界：與第 5 階沼澤漫延的擴張相乘；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：泥沼內判定與控場判定沿用全專案口徑（暈眩／緩速；凍結、石化走暈眩管線）；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`mireScalePct`）

#### L062 `mireWeaken`｜削弱（泥沼術）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：在泥沼術範圍中的敵人造成的傷害 -20%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend mireWeaken`；`sglv mire max`，泥沼術裝上技能列；熔岩沼＝第 7 階
- 步驟與預期：`elite 1 all 3 1000000`；泥沼內敵人打你的傷害 -20%（對照圈外）
- 邊界：與第 2 階虛弱相乘；總減傷上限 95%；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：泥沼內判定與控場判定沿用全專案口徑（暈眩／緩速；凍結、石化走暈眩管線）；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`mireWeaken`）

#### L063 `mireCorrupt`｜腐化（泥沼術）

- 狀態：可隨機掉落（裝備傳奇池）｜被符文真言借用：【混沌之主】W53
- 說明（遊戲內）：在泥沼術範圍內所有受到控場的敵人，受到的傷害 +20%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend mireCorrupt`；`sglv mire max`，泥沼術裝上技能列；熔岩沼＝第 7 階
- 步驟與預期：泥沼內「暈眩或緩速中」的敵人受到的傷害 +20%
- 邊界：控場判定與【崩山裂地者】同口徑；也由符文真言【混沌之主】借用；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：泥沼內判定與控場判定沿用全專案口徑（暈眩／緩速；凍結、石化走暈眩管線）；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`mireCorruptPct`）

#### L064 `mireLavaBurn`｜熔火（泥沼術）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：熔岩沼的火焰傷害 +50%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend mireLavaBurn`；`sglv mire max`，泥沼術裝上技能列；熔岩沼＝第 7 階
- 步驟與預期：熔岩沼（第 7 階）的火焰每跳傷害 +50%
- 邊界：沒學第 7 階無效；與第 7 階自身每級成長相乘；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：泥沼內判定與控場判定沿用全專案口徑（暈眩／緩速；凍結、石化走暈眩管線）；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`mireLavaPct`）

#### L065 `mireErode`｜侵蝕（泥沼術）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：泥沼術會附加流血，每 0.5 秒造成 150% 物理傷害，持續 5 秒。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend mireErode`；`sglv mire max`，泥沼術裝上技能列；熔岩沼＝第 7 階
- 步驟與預期：泥沼附加流血：每 0.5 秒 150% **物攻**、5 秒
- 邊界：泥沼本體是魔法群組（吃魔攻），這段流血吃物攻；與【嗜血】互動；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：泥沼內判定與控場判定沿用全專案口徑（暈眩／緩速；凍結、石化走暈眩管線）；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`mireBleed`）

### 3.14 技能群組：大地守護 `earthguard`（5 個）

#### L066 `earthguardManaFeed`｜魔力滋養（大地守護）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：大地守護會使溢出法力的 50% 轉為你的生命護盾。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend earthguardManaFeed`；`sglv earthguard max`，大地守護裝上技能列；魔力再生＝第 4 階、生命反射之盾＝第 6 階、天地共生＝第 7 階
- 步驟與預期：`MP_lock` 關閉、讓法力回滿；溢出的法力 50% 轉為生命護盾（護盾條上升）
- 邊界：法力未滿時沒有溢出＝不轉換；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：天地共生的復甦期間 `skills2AutoCastBlocked` 為真：所有自動觸發暫停；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`egManaOverflowShield`）

#### L067 `earthguardLifeFeed`｜生命滋養（大地守護）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：大地守護會使你額外獲得魔力再生法力回復加成的 20% 作為吸魔效果加成。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend earthguardLifeFeed`；`sglv earthguard max`，大地守護裝上技能列；魔力再生＝第 4 階、生命反射之盾＝第 6 階、天地共生＝第 7 階
- 步驟與預期：額外獲得魔力再生（第 4 階）法力回復加成的 20% 作為吸魔加成（屬性面板吸魔）
- 邊界：沒學第 4 階就沒有可換算的加成；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：天地共生的復甦期間 `skills2AutoCastBlocked` 為真：所有自動觸發暫停；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`egManaDrainFromRegen`）

#### L068 `earthguardSoulLink`｜靈魂連結（大地守護）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：生命反射之盾可以額外對 1 個敵人產生作用。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend earthguardSoulLink`；`sglv earthguard max`，大地守護裝上技能列；魔力再生＝第 4 階、生命反射之盾＝第 6 階、天地共生＝第 7 階
- 步驟與預期：生命反射之盾（第 6 階）作用的敵人數＝表定＋1
- 邊界：只選 20 米內的敵人；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：天地共生的復甦期間 `skills2AutoCastBlocked` 為真：所有自動觸發暫停；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`egReflectAdd`）

#### L069 `earthguardHeartOfEarth`｜地之心（大地守護）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：每殺死 1 個敵人，天地共生的復活冷卻時間 -0.2 秒。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend earthguardHeartOfEarth`；`sglv earthguard max`，大地守護裝上技能列；魔力再生＝第 4 階、生命反射之盾＝第 6 階、天地共生＝第 7 階
- 步驟與預期：用真實血量；每殺 1 個敵人，天地共生（第 7 階）復活冷卻 -0.2 秒
- 邊界：沒學第 7 階無效；冷卻不低於 0；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：天地共生的復甦期間 `skills2AutoCastBlocked` 為真：所有自動觸發暫停；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`egKillCdr`）

#### L070 `earthguardUndyingWill`｜不滅意志（大地守護）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：天地共生復活後的減傷時間內，每殺死 1 個敵人則減傷時間 +0.5 秒。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend earthguardUndyingWill`；`sglv earthguard max`，大地守護裝上技能列；魔力再生＝第 4 階、生命反射之盾＝第 6 階、天地共生＝第 7 階
- 步驟與預期：天地共生復活後的減傷期間，每殺 1 個敵人減傷時間 +0.5 秒
- 邊界：只延長本次復活的減傷，不影響其他來源的保護；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：天地共生的復甦期間 `skills2AutoCastBlocked` 為真：所有自動觸發暫停；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`egKillInvuln`）

### 3.15 技能群組：連鎖閃電 `chainlightning`（5 個）

#### L071 `chainlightningSurge`｜電荷連鎖（連鎖閃電）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：連鎖閃電有 35% 機率再連鎖 2 次。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend chainlightningSurge`；`sglv chainlightning max`，連鎖閃電裝上技能列；`spawn 12 small 1000` 讓閃電有足夠的彈射目標
- 步驟與預期：每次施放約 35% 讓閃電鏈多連鎖 2 次
- 邊界：每次施放擲一次（不是每一跳）；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：閃電鏈的待命命中計數自我修復邏輯；超神單鏈型態會把道數退回 1；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`chainLinkProc`）

#### L072 `chainlightningVolley`｜電擊（連鎖閃電）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：連鎖閃電有 50% 機率額外發射 2 道連鎖閃電。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend chainlightningVolley`；`sglv chainlightning max`，連鎖閃電裝上技能列；`spawn 12 small 1000` 讓閃電有足夠的彈射目標
- 步驟與預期：每次施放約 50% 額外多發射 2 道閃電鏈
- 邊界：超神單鏈型態時道數仍退回 1；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：閃電鏈的待命命中計數自我修復邏輯；超神單鏈型態會把道數退回 1；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`chainBoltProc`）

#### L073 `chainlightningScatter`｜雷散落（連鎖閃電）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：電殛擴散額外對 1 個敵人造成傷害，且其傷害提高 50%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend chainlightningScatter`；`sglv chainlightning max`，連鎖閃電裝上技能列；`spawn 12 small 1000` 讓閃電有足夠的彈射目標
- 步驟與預期：擴散（第 5 階靜電）多打 1 個敵人，擴散傷害 +50%
- 邊界：沒學第 5 階時擴散比例為 0＝只有數量、沒有傷害；說明寫「電殛擴散」但擴散屬於第 5 階（見第 5 節待確認）；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：閃電鏈的待命命中計數自我修復邏輯；超神單鏈型態會把道數退回 1；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`chainSplashAdd`、`chainSplashPct`）

#### L074 `chainlightningSuper`｜超導（連鎖閃電）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：連鎖閃電每彈射 1 次，該道閃電鏈的傷害 +10%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend chainlightningSuper`；`sglv chainlightning max`，連鎖閃電裝上技能列；`spawn 12 small 1000` 讓閃電有足夠的彈射目標
- 步驟與預期：同一道閃電鏈每彈射 1 次，之後每擊傷害 +10%（加算、不複利）
- 邊界：每道鏈各自計算；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：閃電鏈的待命命中計數自我修復邏輯；超神單鏈型態會把道數退回 1；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`chainBouncePct`）

#### L075 `chainlightningOverload`｜過載（連鎖閃電）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：同一個敵人受到 10 次連鎖閃電的彈射後產生爆炸，對周圍 10 米內的敵人造成 400% 雷電傷害。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend chainlightningOverload`；`sglv chainlightning max`，連鎖閃電裝上技能列；`spawn 12 small 1000` 讓閃電有足夠的彈射目標
- 步驟與預期：同一個敵人累計被閃電鏈彈射 10 次後爆炸，對 10 米內造成 400% 雷電傷害
- 邊界：計數掛在敵人身上，敵人死亡即回收；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：閃電鏈的待命命中計數自我修復邏輯；超神單鏈型態會把道數退回 1；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`chainOverload`）

### 3.16 技能群組：落雷術 `thunderstrike`（5 個）

#### L076 `thunderstrikeTriple`｜三重雷（落雷術）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：雙重落雷的攻擊次數 +1 次。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend thunderstrikeTriple`；`sglv thunderstrike max`，落雷術裝上技能列；暈眩來源＝第 5 階雷電脈衝、迅雷重生＝第 6 階
- 步驟與預期：每次施放的落雷次數＝表定＋1
- 邊界：不需要學第 3 階雙重落雷也 +1（加的是計數本身）；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：落雷排程（落下時間後才結算）；雷池是地面場域；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`thunderHitAdd`）

#### L077 `thunderstrikeLock`｜雷鎖（落雷術）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：落雷術擊中時有 25% 機率在地上留下一個雷池，每 0.5 秒造成該道落雷 20% 的雷電傷害，持續 4 秒。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend thunderstrikeLock`；`sglv thunderstrike max`，落雷術裝上技能列；暈眩來源＝第 5 階雷電脈衝、迅雷重生＝第 6 階
- 步驟與預期：落雷擊中約 25% 留下雷池（6 米、每 0.5 秒該道落雷 20% 傷害、4 秒）
- 邊界：雷池以該道落雷的傷害定版；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：落雷排程（落下時間後才結算）；雷池是地面場域；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`thunderPool`）

#### L078 `thunderstrikeQuake`｜震雷（落雷術）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：被落雷術擊中的敵人暈眩時間 +1 秒，且其在暈眩狀態下受到的傷害 +25%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend thunderstrikeQuake`；`sglv thunderstrike max`，落雷術裝上技能列；暈眩來源＝第 5 階雷電脈衝、迅雷重生＝第 6 階
- 步驟與預期：被落雷擊中的敵人暈眩時間 +1 秒；暈眩中受到的傷害 +25%
- 邊界：沒學第 5 階雷電脈衝時暈眩時間只剩這 +1 秒、同時暈眩的顆數為 1；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：落雷排程（落下時間後才結算）；雷池是地面場域；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`thunderStunAdd`、`thunderStunnedVulnPct`）

#### L079 `thunderstrikeRebirth`｜雷之再生（落雷術）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：迅雷重生的機率提高至 100%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend thunderstrikeRebirth`；`sglv thunderstrike max`，落雷術裝上技能列；暈眩來源＝第 5 階雷電脈衝、迅雷重生＝第 6 階
- 步驟與預期：迅雷重生（第 6 階）的機率變為 100%
- 邊界：沒學第 6 階無效；重生次數上限仍為表定；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：落雷排程（落下時間後才結算）；雷池是地面場域；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`thunderRegenTo`）

#### L080 `thunderstrikeRod`｜引雷針（落雷術）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：落雷術會優先攻擊 24 米內生命值最低的敵人，且對其造成的傷害提高 20%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend thunderstrikeRod`；`sglv thunderstrike max`，落雷術裝上技能列；暈眩來源＝第 5 階雷電脈衝、迅雷重生＝第 6 階
- 步驟與預期：落雷優先打 24 米內生命值最低的敵人，對其傷害 +20%
- 邊界：24 米外的低血敵人不被優先；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：落雷排程（落下時間後才結算）；雷池是地面場域；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`thunderRod`）

### 3.17 技能群組：雷球 `thunderorb`（5 個）

#### L081 `thunderorbCore`｜雷核（雷球）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：雷球的體積增大 20%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend thunderorbCore`；`sglv thunderorb max`，雷球裝上技能列；伴生雷球＝第 6 階、雷隕天落＝第 7 階
- 步驟與預期：雷球體積與判定範圍 +20%（與第 2 階相乘）
- 邊界：伴生雷球也放大；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：場上雷球數讀 `SKILL2_RT.grounds`；超神【臨界雷劫】會改寫伴生雷球的持續時間；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`thunderorbScalePct`）

#### L082 `thunderorbOverload`｜超載（雷球）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：場上每擁有 1 個雷球，你的雷電傷害 +2%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend thunderorbOverload`；`sglv thunderorb max`，雷球裝上技能列；伴生雷球＝第 6 階、雷隕天落＝第 7 階
- 步驟與預期：場上每有 1 顆雷球，你的雷電傷害 +2%（屬性面板或浮字比較）
- 邊界：只數雷球本體；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：場上雷球數讀 `SKILL2_RT.grounds`；超神【臨界雷劫】會改寫伴生雷球的持續時間；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`thunderorbFieldAmpPct`）

#### L083 `thunderorbShockCore`｜感電核心（雷球）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：伴生雷球的持續時間增加 50%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend thunderorbShockCore`；`sglv thunderorb max`，雷球裝上技能列；伴生雷球＝第 6 階、雷隕天落＝第 7 階
- 步驟與預期：伴生雷球（第 6 階）持續時間 +50%
- 邊界：選超神【臨界雷劫】時伴生雷球持續改由超神決定；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：場上雷球數讀 `SKILL2_RT.grounds`；超神【臨界雷劫】會改寫伴生雷球的持續時間；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`thunderorbCompanionSecPct`）

#### L084 `thunderorbFallCount`｜雷殞落（雷球）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：雷殞天落降下的雷球數量 +1 顆。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend thunderorbFallCount`；`sglv thunderorb max`，雷球裝上技能列；伴生雷球＝第 6 階、雷隕天落＝第 7 階
- 步驟與預期：雷隕天落（第 7 階）降下的雷球數＝表定＋1
- 邊界：沒學第 7 階無效；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：場上雷球數讀 `SKILL2_RT.grounds`；超神【臨界雷劫】會改寫伴生雷球的持續時間；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`thunderorbFallAdd`）

#### L085 `thunderorbFallStun`｜雷殞震（雷球）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：被雷殞天落降下的雷球擊中的敵人會暈眩 4 秒。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend thunderorbFallStun`；`sglv thunderorb max`，雷球裝上技能列；伴生雷球＝第 6 階、雷隕天落＝第 7 階
- 步驟與預期：被雷隕天落雷球擊中的敵人暈眩 4 秒
- 邊界：表定暈眩更長時取較高者，不會變短；BOSS 控制免疫照規則；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：場上雷球數讀 `SKILL2_RT.grounds`；超神【臨界雷劫】會改寫伴生雷球的持續時間；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`thunderorbFallStunTo`）

### 3.18 技能群組：寒冰箭 `icearrow`（5 個）

#### L086 `icearrowVolley`｜連射（寒冰箭）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：寒冰箭射出數量 +2 支。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend icearrowVolley`；`sglv icearrow max`，寒冰箭裝上技能列
- 步驟與預期：每次射出的寒冰箭支數＝表定＋2
- 邊界：與第 5 階冰箭散射相加；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：寒霜規格 `sgFrostSpec`；凍結判定與暈眩同一條管線；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`icearrowCountAdd`）

#### L087 `icearrowSeal`｜冰封（寒冰箭）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：寒冰箭傷害 +30%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend icearrowSeal`；`sglv icearrow max`，寒冰箭裝上技能列
- 步驟與預期：寒冰箭傷害 ×1.3（乘在含第 3 階強化之後的傷害上）
- 邊界：寒霜每跳以本體傷害為基準，也一起變大；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：寒霜規格 `sgFrostSpec`；凍結判定與暈眩同一條管線；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`icearrowDamagePct`）

#### L088 `icearrowWinter`｜凜冬侵蝕（寒冰箭）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：寒冰箭造成的寒霜狀態傷害與持續時間 +30%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend icearrowWinter`；`sglv icearrow max`，寒冰箭裝上技能列
- 步驟與預期：寒冰箭塗上的寒霜每跳傷害與持續時間各 +30%
- 邊界：只放大寒冰箭這棵樹塗的寒霜；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：寒霜規格 `sgFrostSpec`；凍結判定與暈眩同一條管線；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`icearrowFrostPct`）

#### L089 `icearrowSplit`｜冰裂箭（寒冰箭）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：寒冰箭擊中敵人後會再分裂出 2 支小型寒冰箭，向前方的敵人造成 150% 寒冰傷害。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend icearrowSplit`；`sglv icearrow max`，寒冰箭裝上技能列
- 步驟與預期：寒冰箭擊中後分裂 2 支小寒冰箭射向前方敵人，各 150% 寒冰傷害
- 邊界：前方沒有敵人時不分裂；小箭不再分裂；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：寒霜規格 `sgFrostSpec`；凍結判定與暈眩同一條管線；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`icearrowSplit`）

#### L090 `icearrowDeepFreeze`｜深度凍結（寒冰箭）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：寒冰箭擊中暈眩或凍結的敵人造成的傷害 +30%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend icearrowDeepFreeze`；`sglv icearrow max`，寒冰箭裝上技能列
- 步驟與預期：寒冰箭對暈眩或凍結中的敵人傷害 +30%
- 邊界：減速不算；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：寒霜規格 `sgFrostSpec`；凍結判定與暈眩同一條管線；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`icearrowControlPct`）

### 3.19 技能群組：水流彈 `waterball`（5 個）

#### L091 `waterballVolley`｜水流連彈（水流彈）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：水流彈的發射數量 +2 顆。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend waterballVolley`；`sglv waterball max`，水流彈裝上技能列；寒流爆散＝第 4 階
- 步驟與預期：每次施放朝隨機目標額外多丟 2 顆
- 邊界：與第 6 階三重流水相加；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：水流彈拋物線（Worker 協議 v30）與彈射飛行時間；寒霜疊層上限是共用層；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`waterballShotAdd`）

#### L092 `waterballNovaBurst`｜冰霜擴散（水流彈）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：寒流爆散的擴散爆炸變成冰霜新星，且範圍增大 30%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend waterballNovaBurst`；`sglv waterball max`，水流彈裝上技能列；寒流爆散＝第 4 階
- 步驟與預期：寒流爆散（第 4 階）的擴散爆炸改為冰霜新星外觀與判定，範圍 +30%
- 邊界：傷害與統計仍歸水流彈；沒投資冰霜新星也有完整效果；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：水流彈拋物線（Worker 協議 v30）與彈射飛行時間；寒霜疊層上限是共用層；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`waterballBurstNova`）

#### L093 `waterballFrostSurge`｜寒霜湧動（水流彈）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：水流彈造成的寒霜狀態可在凍結後再疊加 5 層；寒霜凍傷依目前寒霜總層數計算。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend waterballFrostSurge`；`sglv waterball max`，水流彈裝上技能列；寒流爆散＝第 4 階
- 步驟與預期：水流彈的寒霜在敵人凍結後可再疊 5 層；凍傷依當下寒霜總層數計算
- 邊界：疊層上限是共用層，不分來源；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：水流彈拋物線（Worker 協議 v30）與彈射飛行時間；寒霜疊層上限是共用層；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`waterballFrostOver`）

#### L094 `waterballTorrent`｜激流（水流彈）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：水流彈的彈射次數 +2 次，且彈射速度 +30%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend waterballTorrent`；`sglv waterball max`，水流彈裝上技能列；寒流爆散＝第 4 階
- 步驟與預期：彈射次數＝表定＋2，彈射飛行速度 +30%
- 邊界：沒學第 4 階時從 0 次起算，仍有 2 次彈射；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：水流彈拋物線（Worker 協議 v30）與彈射飛行時間；寒霜疊層上限是共用層；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`waterballBounceAdd`、`waterballBounceSpeedPct`）

#### L095 `waterballTornado`｜水龍勢（水流彈）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：水流彈擊中時有 10% 機率在目標處形成 1 道水龍捲，造成 4 段 100% 寒冰傷害。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend waterballTornado`；`sglv waterball max`，水流彈裝上技能列；寒流爆散＝第 4 階
- 步驟與預期：水流彈擊中約 10% 在目標處形成水龍捲，4 段、每段 100% 寒冰傷害
- 邊界：水龍捲規格在施放當下定版；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：水流彈拋物線（Worker 協議 v30）與彈射飛行時間；寒霜疊層上限是共用層；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`waterballTornadoProc`）

### 3.20 技能群組：冰霜新星 `frostnova`（5 個）

#### L096 `frostnovaShatter`｜碎冰（冰霜新星）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：冰霜新星的攻擊範圍 +20%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend frostnovaShatter`；`sglv frostnova max`，冰霜新星裝上技能列；暴風雪＝第 7 階
- 步驟與預期：冰霜新星攻擊範圍 +20%（含逐次加大的那幾米）
- 邊界：雙冰爆／寒潮的再爆發範圍一起放大；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：再爆發（雙冰爆／寒潮）以 `depth` 防遞迴；冰錐在敵人死亡時生成；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`frostnovaScalePct`）

#### L097 `frostnovaTwinBurst`｜雙冰爆（冰霜新星）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：冰霜新星擊中帶有寒霜狀態的敵人時，有 35% 機率在目標處再爆發 1 次冰霜新星。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend frostnovaTwinBurst`；`sglv frostnova max`，冰霜新星裝上技能列；暴風雪＝第 7 階
- 步驟與預期：冰霜新星擊中帶寒霜的敵人約 35% 在目標處再爆發 1 次
- 邊界：與【寒潮】同時裝備時機率相加（55%）；再爆發不再遞迴觸發；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：再爆發（雙冰爆／寒潮）以 `depth` 防遞迴；冰錐在敵人死亡時生成；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`frostnovaTwinBurst`）

#### L098 `frostnovaIceSpike`｜寒冰衝擊（冰霜新星）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：冰霜新星殺死被凍結的敵人時，會在目標地面昇起 1 根冰錐，對周圍 8 米內的敵人造成 4 段 100% 寒冰傷害。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend frostnovaIceSpike`；`sglv frostnova max`，冰霜新星裝上技能列；暴風雪＝第 7 階
- 步驟與預期：用真實血量；冰霜新星殺死**凍結中**的敵人時，地面升起冰錐，對 8 米內 4 段 100% 寒冰傷害
- 邊界：殺死未凍結的敵人不升冰錐；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：再爆發（雙冰爆／寒潮）以 `depth` 防遞迴；冰錐在敵人死亡時生成；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`frostnovaKillSpike`）

#### L099 `frostnovaColdTide`｜寒潮（冰霜新星）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：冰霜新星擊中帶有寒霜狀態的敵人時，有 20% 機率在目標處再爆發 1 次冰霜新星。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend frostnovaColdTide`；`sglv frostnova max`，冰霜新星裝上技能列；暴風雪＝第 7 階
- 步驟與預期：同【雙冰爆】，機率 20%
- 邊界：兩者同時裝備時機率相加（55%）；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：再爆發（雙冰爆／寒潮）以 `depth` 防遞迴；冰錐在敵人死亡時生成；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`frostnovaColdTide`）

#### L100 `frostnovaWinterFrost`｜凜冬寒霜（冰霜新星）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：暴風雪對帶有寒霜狀態的敵人，每層寒霜傷害 +5%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend frostnovaWinterFrost`；`sglv frostnova max`，冰霜新星裝上技能列；暴風雪＝第 7 階
- 步驟與預期：暴風雪（第 7 階）對帶寒霜的敵人，每層寒霜傷害 +5%
- 邊界：沒有寒霜的敵人不加；沒學第 7 階無效；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：再爆發（雙冰爆／寒潮）以 `depth` 防遞迴；冰錐在敵人死亡時生成；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`frostnovaBlizzardLayer`）

### 3.21 技能群組：風刃 `windblade`（5 個）

#### L101 `windbladeRend`｜裂風（風刃）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：風刃每擊中敵人 1 次則傷害額外 +2%，最多疊加 20 層（最高 +40%）。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend windbladeRend`；`sglv windblade max`，風刃裝上技能列；亂披風＝第 4 階、暴風真空刃＝第 7 階
- 步驟與預期：風刃每擊中 1 次傷害 +2%，最多 20 層（+40%）
- 邊界：第 21 次不再增加；層數的重置時機請記錄；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：風刃本體傷害 `sgWindbladeBodyDamage` 同時被大／小風刃使用；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`windbladeRamp`）

#### L102 `windbladePressure`｜增壓（風刃）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：風刃的體積增大 25%，且飛行速度 +30%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend windbladePressure`；`sglv windblade max`，風刃裝上技能列；亂披風＝第 4 階、暴風真空刃＝第 7 階
- 步驟與預期：風刃體積 +25%（與第 2 階巨型風刃相乘）、飛行速度 +30%
- 邊界：判定半寬與特效寬度同步放大；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：風刃本體傷害 `sgWindbladeBodyDamage` 同時被大／小風刃使用；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`windbladeSizePct`、`windbladeSpeedPct`）

#### L103 `windbladeTrace`｜風之痕（風刃）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：亂披風會在風刃另一側額外射出 1 道小型風刃，且小型風刃傷害 +30%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend windbladeTrace`；`sglv windblade max`，風刃裝上技能列；亂披風＝第 4 階、暴風真空刃＝第 7 階
- 步驟與預期：亂披風（第 4 階）在風刃另一側再射出 1 道小風刃，小風刃傷害 +30%
- 邊界：沒學第 4 階無效；第 5 階追跡風刃時小風刃改為追擊；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：風刃本體傷害 `sgWindbladeBodyDamage` 同時被大／小風刃使用；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`windbladeSmallMirror`、`windbladeSmallDmgPct`）

#### L104 `windbladeErode`｜風蝕（風刃）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：風刃擊中敵人時會附加風蝕狀態，讓敵人受到的傷害 +25%，持續 4 秒。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend windbladeErode`；`sglv windblade max`，風刃裝上技能列；亂披風＝第 4 階、暴風真空刃＝第 7 階
- 步驟與預期：風刃擊中附加「風蝕」：受到的傷害 +25%、4 秒
- 邊界：重複命中刷新；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：風刃本體傷害 `sgWindbladeBodyDamage` 同時被大／小風刃使用；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`windbladeErode`）

#### L105 `windbladeVoidCut`｜斷空刃（風刃）

- 狀態：可隨機掉落（裝備傳奇池）｜被符文真言借用：【虛空行者】W58
- 說明（遊戲內）：暴風真空刃每個方向改為連續射出 3 道風刃，且風刃傷害額外 +30%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend windbladeVoidCut`；`sglv windblade max`，風刃裝上技能列；亂披風＝第 4 階、暴風真空刃＝第 7 階
- 步驟與預期：暴風真空刃（第 7 階）每個方向連續射出 3 道，風刃傷害 +30%
- 邊界：是「改寫至 3 道」（取較大），不是再加 3 道；也由符文真言【虛空行者】借用；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：風刃本體傷害 `sgWindbladeBodyDamage` 同時被大／小風刃使用；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`windbladeVolleyTo`、`windbladeDmgPct`）

### 3.22 技能群組：真空斬 `vacuumslash`（5 個）

#### L106 `vacuumResonance`｜共振（真空斬）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：真空爆震會額外多造成 1 次傷害。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend vacuumResonance`；`sglv vacuumslash max`，真空斬裝上技能列；真空爆震＝第 2 階、風切＝第 3 階、虛空斬＝第 7 階
- 步驟與預期：真空爆震多 1 次傷害
- 邊界：不需學第 2 階也 +1；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：風切疊層上限由 `sgWindRendSpec` 統一計算（暴風屏障的亂風切也走這裡）；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`vacuumBurstAdd`）

#### L107 `vacuumRift`｜裂痕（真空斬）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：真空斬造成的風切狀態疊加層數 +3 層。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend vacuumRift`；`sglv vacuumslash max`，真空斬裝上技能列；真空爆震＝第 2 階、風切＝第 3 階、虛空斬＝第 7 階
- 步驟與預期：真空斬塗上的風切疊層上限＝表定＋3
- 邊界：與第 6 階無限風切的疊層相加；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：風切疊層上限由 `sgWindRendSpec` 統一計算（暴風屏障的亂風切也走這裡）；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`vacuumRendStacks`）

#### L108 `vacuumWindBlade`｜真空風刃（真空斬）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：每次施放真空斬會額外射出 2 道小型風刃。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend vacuumWindBlade`；`sglv vacuumslash max`，真空斬裝上技能列；真空爆震＝第 2 階、風切＝第 3 階、虛空斬＝第 7 階
- 步驟與預期：每次施放真空斬額外射出 2 道小型風刃（以主目標方位為中軸向兩側）
- 邊界：不需學風刃；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：風切疊層上限由 `sgWindRendSpec` 統一計算（暴風屏障的亂風切也走這裡）；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`vacuumSmallBlades`）

#### L109 `vacuumExpand`｜空間澎脹（真空斬）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：真空斬的體積 +25%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend vacuumExpand`；`sglv vacuumslash max`，真空斬裝上技能列；真空爆震＝第 2 階、風切＝第 3 階、虛空斬＝第 7 階
- 步驟與預期：真空斬體積與判定半徑 +25%
- 邊界：特效尺寸同步；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：風切疊層上限由 `sgWindRendSpec` 統一計算（暴風屏障的亂風切也走這裡）；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`vacuumScalePct`）

#### L110 `vacuumFlux`｜虛空漲落（真空斬）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：虛空斬的持續時間 +3 秒。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend vacuumFlux`；`sglv vacuumslash max`，真空斬裝上技能列；真空爆震＝第 2 階、風切＝第 3 階、虛空斬＝第 7 階
- 步驟與預期：虛空斬（第 7 階）持續時間 +3 秒
- 邊界：與超神【時空崩解】的百分比加成相乘；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：風切疊層上限由 `sgWindRendSpec` 統一計算（暴風屏障的亂風切也走這裡）；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`vacuumVoidSec`）

### 3.23 技能群組：暴風屏障 `stormbarrier`（5 個）

#### L111 `stormbarrierAbsorb`｜吸收（暴風屏障）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：暴風屏障的傷害減免 +10%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend stormbarrierAbsorb`；`sglv stormbarrier max`，暴風屏障裝上技能列；亂風切＝第 3 階、暴風之刃＝第 4 階、暴風神體＝第 7 階；`elite 1 all 3 1000000` 讓敵人打你
- 步驟與預期：暴風屏障的傷害減免 +10 個百分點（受到的傷害下降）
- 邊界：與第 1 階同池加算、之後才整體乘算；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：屏障減免與神體減免在風系加總；`skill2DefFactor` 只在屏障作用中生效；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`stormbarrierRedPct`）

#### L112 `stormbarrierReflect`｜暴風反射（暴風屏障）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：暴風之刃射出風刃的機率 +10%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend stormbarrierReflect`；`sglv stormbarrier max`，暴風屏障裝上技能列；亂風切＝第 3 階、暴風之刃＝第 4 階、暴風神體＝第 7 階；`elite 1 all 3 1000000` 讓敵人打你
- 步驟與預期：暴風之刃（第 4 階）射出風刃的機率 +10 個百分點
- 邊界：沒學第 4 階時機率只剩 10%；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：屏障減免與神體減免在風系加總；`skill2DefFactor` 只在屏障作用中生效；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`stormbladeChanceAdd`）

#### L113 `stormbarrierCounterCut`｜逆風切（暴風屏障）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：亂風切所附加的風切狀態，每層傷害 +35%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend stormbarrierCounterCut`；`sglv stormbarrier max`，暴風屏障裝上技能列；亂風切＝第 3 階、暴風之刃＝第 4 階、暴風神體＝第 7 階；`elite 1 all 3 1000000` 讓敵人打你
- 步驟與預期：亂風切（第 3 階）的風切每層傷害 +35%
- 邊界：只放大暴風屏障塗的風切，真空斬的風切不變；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：屏障減免與神體減免在風系加總；`skill2DefFactor` 只在屏障作用中生效；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`stormRendDmgPct`）

#### L114 `stormbarrierWall`｜風之壁（暴風屏障）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：暴風屏障作用中，你的物理與魔法防禦額外 +20%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend stormbarrierWall`；`sglv stormbarrier max`，暴風屏障裝上技能列；亂風切＝第 3 階、暴風之刃＝第 4 階、暴風神體＝第 7 階；`elite 1 all 3 1000000` 讓敵人打你
- 步驟與預期：屏障作用中物理與魔法防禦 +20%（屬性面板）
- 邊界：屏障結束立即恢復；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：屏障減免與神體減免在風系加總；`skill2DefFactor` 只在屏障作用中生效；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`stormbarrierDefPct`）

#### L115 `stormbarrierCore`｜風暴核心（暴風屏障）

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：暴風神體的持續時間 +30%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend stormbarrierCore`；`sglv stormbarrier max`，暴風屏障裝上技能列；亂風切＝第 3 階、暴風之刃＝第 4 階、暴風神體＝第 7 階；`elite 1 all 3 1000000` 讓敵人打你
- 步驟與預期：暴風神體（第 7 階）持續時間 +30%
- 邊界：與超神【瓦爾格之力】相乘；同名兩件只生效一件（C4）；技能沒裝上技能列時不作用
- 回歸風險：屏障減免與神體減免在風系加總；`skill2DefFactor` 只在屏障作用中生效；`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋
- 生效位置：`js/skills2.js`（`stormGodSecPct`）

### 3.24 符文真言專屬（15 個）

#### L116 `mountainSunderer`｜崩山裂地者

- 狀態：**符文真言專屬**（裝備上不生效）｜被符文真言借用：【永凍】W63
- 說明（遊戲內）：當你對敵人造成暈眩或緩速效果時，該效果持續時間 +100%，且對處於該狀態的敵人造成的傷害提高 300%。
- 前置：`runeword rw_permafrost`，依 W63 做出符文真言並穿上
- 步驟與預期：永凍本身普攻 15% 暈眩 1.5 秒 → 實際暈眩 3 秒；對暈眩或緩速中的敵人傷害 +300%（浮字約 ×4）
- 邊界：只延長玩家施加的暈眩／緩速；BOSS 控制免疫照規則；`legend mountainSunderer weapon force` 放在裝備上：不生效（與穿上符文真言時比對），裝備詳情該行顯示灰字並加「(僅符文真言生效)」（見第 5 節 K1）
- 回歸風險：閘門在 `js/formula.js` 聚合（略過裝備上的專屬鍵）與 `js/runeword.js` `rwFinishAggregate`（真言借用寫回）
- 生效位置：`js/legendary.js`（`controlDurationMult`、`controlledTargetDamagePct`、`mountainSunderer`）

#### L117 `shadowTracker`｜影襲追蹤者

- 狀態：**符文真言專屬**（裝備上不生效）｜被符文真言借用：【劍舞者】W57
- 說明（遊戲內）：每隔 12 秒自動向敵人射出 3 枚飛刀，每枚造成 150% 物理傷害；飛刀技能傷害 +25%。
- 前置：`runeword rw_bladedancer`，依 W57 做出符文真言並穿上
- 步驟與預期：不需要任何技能：每 12 秒自動對最近的敵人射出 3 枚飛刀，各 150%×1.25 物理傷害（來源「影襲追蹤者」）；飛刀技能傷害另 +25%
- 邊界：倒地、天地共生復甦期間暫停計時；錯過的節拍不補發；`legend shadowTracker weapon force` 放在裝備上：不生效（與穿上符文真言時比對），裝備詳情該行顯示灰字並加「(僅符文真言生效)」（見第 5 節 K1）
- 回歸風險：閘門在 `js/formula.js` 聚合（略過裝備上的專屬鍵）與 `js/runeword.js` `rwFinishAggregate`（真言借用寫回）
- 生效位置：`js/legendary.js`（`autoKnives`、`knifeSkillDmgPct`、`shadowTracker`）

#### L118 `whirlwindStab`｜旋風之刺

- 狀態：**符文真言專屬**（裝備上不生效）｜被符文真言借用：【影殺】W35
- 說明（遊戲內）：裝備兩把單手匕首時攻速額外提高 50%；每使用 20 次普攻後打出 3 連擊，每擊造成 120% 物理傷害。
- 前置：`runeword rw_assassin`，依 W35 做出符文真言並穿上
- 步驟與預期：主手與副手都是單手匕首：攻速 ×1.5；每 20 次普攻後打出 3 連擊，各 120% 物理
- 邊界：副手不是匕首時兩個效果都不生效（影殺本身只要求匕首主手）；計數在戰鬥重置時歸零；`legend whirlwindStab weapon force` 放在裝備上：不生效（與穿上符文真言時比對），裝備詳情該行顯示灰字並加「(僅符文真言生效)」（見第 5 節 K1）
- 回歸風險：閘門在 `js/formula.js` 聚合（略過裝備上的專屬鍵）與 `js/runeword.js` `rwFinishAggregate`（真言借用寫回）
- 生效位置：`js/legendary.js`（`dualDaggerAspdPct`、`basicAttackThreshold`、`flurryHits`、`flurryPowerPct`、`whirlwindStab`）

#### L119 `doomProphet`｜末日預言者

- 狀態：**符文真言專屬**（裝備上不生效）｜被符文真言借用：【血月】W48
- 說明（遊戲內）：沒有生命護盾時傷害提高 50%；生命值每降低 10%，傷害再提高 10%。
- 前置：`runeword rw_bloodmoon`，依 W48 做出符文真言並穿上
- 步驟與預期：沒有生命護盾時傷害 +50%；生命每少 10% 再 +10%（50% 血量時 ×1.5×1.5）
- 邊界：有護盾時只剩生命段；血月本身會讓最大生命 -30%、每秒 -2%，測試時注意；`legend doomProphet weapon force` 放在裝備上：不生效（與穿上符文真言時比對），裝備詳情該行顯示灰字並加「(僅符文真言生效)」（見第 5 節 K1）
- 回歸風險：閘門在 `js/formula.js` 聚合（略過裝備上的專屬鍵）與 `js/runeword.js` `rwFinishAggregate`（真言借用寫回）
- 生效位置：`js/legendary.js`（`noShieldDamagePct`、`missingHpStepPct`、`damagePerStepPct`、`doomProphet`）

#### L120 `berserkBloodAxe`｜狂暴血斧

- 狀態：**符文真言專屬**（裝備上不生效）｜被符文真言借用：【萬軍】W56
- 說明（遊戲內）：擊殺敵人時獲得「狂暴」：攻速與攻擊提高 3%，持續 6 秒，最多疊加 20 層。
- 前置：`runeword rw_legion`，依 W56 做出符文真言並穿上
- 步驟與預期：用真實血量；每擊殺 1 隻疊 1 層「狂暴」：攻速與攻擊各 +3%、6 秒，最多 20 層
- 邊界：6 秒內沒有擊殺就整串歸零；高塔沒有擊殺事件＝無效；`legend berserkBloodAxe weapon force` 放在裝備上：不生效（與穿上符文真言時比對），裝備詳情該行顯示灰字並加「(僅符文真言生效)」（見第 5 節 K1）
- 回歸風險：閘門在 `js/formula.js` 聚合（略過裝備上的專屬鍵）與 `js/runeword.js` `rwFinishAggregate`（真言借用寫回）
- 生效位置：`js/legendary.js`（`onKillBuff`、`berserkBloodAxe`）

#### L121 `unyieldingGuard`｜不屈護衛

- 狀態：**符文真言專屬**（裝備上不生效）｜被符文真言借用：【不朽之軀】W55
- 說明（遊戲內）：格擋減傷率額外 +5%，且可突破格擋減傷率的上限。
- 前置：`runeword rw_immortalbody`，依 W55 做出符文真言並穿上
- 步驟與預期：`statset block 100` 與 `statset blockred` 拉到格擋減傷上限；受擊時減傷比上限再多 5%
- 邊界：加在上限之後（`resolveHit`），不被上限夾回；`legend unyieldingGuard weapon force` 放在裝備上：不生效（與穿上符文真言時比對），裝備詳情該行顯示灰字並加「(僅符文真言生效)」（見第 5 節 K1）
- 回歸風險：閘門在 `js/formula.js` 聚合（略過裝備上的專屬鍵）與 `js/runeword.js` `rwFinishAggregate`（真言借用寫回）
- 生效位置：`js/formula.js`（`blockDmgRedExtra`、`unyieldingGuard`）；`js/combat.js`（`blockDmgRedExtra`）

#### L122 `thunderShock`｜雷霆之震

- 狀態：**符文真言專屬**（裝備上不生效）｜被符文真言借用：【雷帝】W50
- 說明（遊戲內）：受到傷害時有 20% 機率對攻擊你的敵人反射 200% 雷電傷害。
- 前置：`runeword rw_thunderemperor`，依 W50 做出符文真言並穿上
- 步驟與預期：`elite 1 all 3 1000000`；受到傷害（含被護盾吸收）約 20% 對攻擊者反射 200% 雷電傷害（來源「雷霆之震」）
- 邊界：攻擊者已死亡時不反射；反射擊殺要正確結算掉落；`legend thunderShock weapon force` 放在裝備上：不生效（與穿上符文真言時比對），裝備詳情該行顯示灰字並加「(僅符文真言生效)」（見第 5 節 K1）
- 回歸風險：閘門在 `js/formula.js` 聚合（略過裝備上的專屬鍵）與 `js/runeword.js` `rwFinishAggregate`（真言借用寫回）
- 生效位置：`js/legendary.js`（`onHurtReflect`、`thunderShock`）

#### L123 `burningLaw`｜燃燒法則

- 狀態：**符文真言專屬**（裝備上不生效）｜被符文真言借用：【鐵匠之魂】W65
- 說明（遊戲內）：燃燒持續傷害每次作用時有 25% 機率將剩餘的作用次數立即用盡，且燃燒傷害提高 30%。
- 前置：`runeword rw_smith`，依 W65 做出符文真言並穿上
- 步驟與預期：需要燃燒來源（火球術第 2 階）；燃燒每跳 +30%，且每跳約 25% 把剩餘次數一次結算完（大數字一跳後狀態消失）
- 邊界：只處理敵人身上名稱為「燃燒」的持續傷害（程式以狀態名稱字面值比對）；`legend burningLaw weapon force` 放在裝備上：不生效（與穿上符文真言時比對），裝備詳情該行顯示灰字並加「(僅符文真言生效)」（見第 5 節 K1）
- 回歸風險：閘門在 `js/formula.js` 聚合（略過裝備上的專屬鍵）與 `js/runeword.js` `rwFinishAggregate`（真言借用寫回）
- 生效位置：`js/legendary.js`（`burnExhaustChance`、`burnDamagePct`、`burningLaw`）

#### L124 `thunderMark`｜雷紋刻印

- 狀態：**符文真言專屬**（裝備上不生效）｜被符文真言借用：【星門】W61
- 說明（遊戲內）：雷電技能命中時有 10% 機率留下雷紋刻印，使敵人受到的雷電傷害提高 35%，持續 6 秒。
- 前置：`runeword rw_stargate`，依 W61 做出符文真言並穿上
- 步驟與預期：雷屬性**技能**命中約 10% 讓敵人帶雷紋刻印 6 秒：受到的雷電傷害 +35%（依該擊的雷電比例）
- 邊界：普攻不觸發；非雷電傷害不加成；`legend thunderMark weapon force` 放在裝備上：不生效（與穿上符文真言時比對），裝備詳情該行顯示灰字並加「(僅符文真言生效)」（見第 5 節 K1）
- 回歸風險：閘門在 `js/formula.js` 聚合（略過裝備上的專屬鍵）與 `js/runeword.js` `rwFinishAggregate`（真言借用寫回）
- 生效位置：`js/legendary.js`（`onLightningSkillHit`、`thunderMark`）

#### L125 `iceSpikeBurst`｜冰霜尖刺

- 狀態：**符文真言專屬**（裝備上不生效）｜被符文真言借用：【冰川】W64
- 說明（遊戲內）：寒冰技能命中時有 10% 機率產生冰爆，對敵人造成 200% 寒冰傷害。
- 前置：`runeword rw_glacier`，依 W64 做出符文真言並穿上
- 步驟與預期：寒冰屬性技能命中約 10% 產生冰爆，造成 200% 寒冰傷害（下一 tick 結算）
- 邊界：冰爆不再觸發冰爆（不遞迴）；目標已死時取消；`legend iceSpikeBurst weapon force` 放在裝備上：不生效（與穿上符文真言時比對），裝備詳情該行顯示灰字並加「(僅符文真言生效)」（見第 5 節 K1）
- 回歸風險：閘門在 `js/formula.js` 聚合（略過裝備上的專屬鍵）與 `js/runeword.js` `rwFinishAggregate`（真言借用寫回）
- 生效位置：`js/legendary.js`（`onIceSkillHit`、`iceSpikeBurst`）

#### L126 `heavenlyVow`｜天譴之誓

- 狀態：**符文真言專屬**（裝備上不生效）｜被符文真言借用：【時之沙】W47
- 說明（遊戲內）：每 6 秒隨機讓 1 個冷卻中的技能立即冷卻完畢，且該技能下一次施放的傷害提高 50%。
- 前置：`runeword rw_timeloop`，依 W47 做出符文真言並穿上
- 步驟與預期：至少裝 2 個冷卻較長的技能；每 6 秒隨機讓 1 個冷卻中的新版技能冷卻歸零，它下一次施放的傷害 +50%（3 秒窗口涵蓋延遲命中）
- 邊界：沒有技能在冷卻時這次不作用；倒地期間暫停計時；`legend heavenlyVow weapon force` 放在裝備上：不生效（與穿上符文真言時比對），裝備詳情該行顯示灰字並加「(僅符文真言生效)」（見第 5 節 K1）
- 回歸風險：閘門在 `js/formula.js` 聚合（略過裝備上的專屬鍵）與 `js/runeword.js` `rwFinishAggregate`（真言借用寫回）
- 生效位置：`js/legendary.js`（`nextCastDmgPct`、`heavenlyVow`）

#### L127 `godfallMeteor`｜神落天殞

- 狀態：**符文真言專屬**（裝備上不生效）｜被符文真言借用：【星墜】W52
- 說明（遊戲內）：隕石類技能傷害 +25%。
- 前置：`runeword rw_starfall`，依 W52 做出符文真言並穿上
- 步驟與預期：`sglv fireball max`（第 7 階隕石術）；隕石落地傷害 +25%
- 邊界：不含超神【地爆天星】的固定百分比傷害；`legend godfallMeteor weapon force` 放在裝備上：不生效（與穿上符文真言時比對），裝備詳情該行顯示灰字並加「(僅符文真言生效)」（見第 5 節 K1）
- 回歸風險：閘門在 `js/formula.js` 聚合（略過裝備上的專屬鍵）與 `js/runeword.js` `rwFinishAggregate`（真言借用寫回）
- 生效位置：`js/legendary.js`（`meteorDmgPct`、`godfallMeteor`）

#### L128 `stormAndThunder`｜風起雷落

- 狀態：**符文真言專屬**（裝備上不生效）｜被符文真言借用：【風暴之眼】W44
- 說明（遊戲內）：風系與雷系傷害加成較高者，可額外獲得較低者 25% 的屬性傷害加成。
- 前置：`runeword rw_galeeye`，依 W44 做出符文真言並穿上
- 步驟與預期：屬性面板比較風系與雷系「屬性傷害提升」：較高者額外獲得較低者 25%
- 邊界：兩者相等時加給風系；較低者不變；`legend stormAndThunder weapon force` 放在裝備上：不生效（與穿上符文真言時比對），裝備詳情該行顯示灰字並加「(僅符文真言生效)」（見第 5 節 K1）
- 回歸風險：閘門在 `js/formula.js` 聚合（略過裝備上的專屬鍵）與 `js/runeword.js` `rwFinishAggregate`（真言借用寫回）
- 生效位置：`js/legendary.js`（`shareFromLowerPct`、`stormAndThunder`）

#### L129 `elementHeart`｜元素之心

- 狀態：**符文真言專屬**（裝備上不生效）｜被符文真言借用：【創世紀】W59
- 說明（遊戲內）：所有元素抗性 -50%，但所有屬性傷害加成額外提高 35%。
- 前置：`runeword rw_genesis`，依 W59 做出符文真言並穿上
- 步驟與預期：屬性面板：所有元素抗性 ×0.5；所有屬性傷害提升 +35（加算）
- 邊界：抗性在 `computeStats` 計算，傷害提升在 `legendaryElementDamageUp`；兩邊都要看；`legend elementHeart weapon force` 放在裝備上：不生效（與穿上符文真言時比對），裝備詳情該行顯示灰字並加「(僅符文真言生效)」（見第 5 節 K1）
- 回歸風險：閘門在 `js/formula.js` 聚合（略過裝備上的專屬鍵）與 `js/runeword.js` `rwFinishAggregate`（真言借用寫回）
- 生效位置：`js/formula.js`（`elemResMult`、`elementHeart`）；`js/legendary.js`（`elemDmgUpPct`、`elementHeart`）

#### L130 `deadTime`｜亡者時間

- 狀態：**符文真言專屬**（裝備上不生效）｜被符文真言借用：【滅世】W60
- 說明（遊戲內）：範圍 40 米內的敵人死亡，都會使你的物理技能冷卻時間 -0.05 秒。
- 前置：`runeword rw_worldend`，依 W60 做出符文真言並穿上
- 步驟與預期：用真實血量；40 米內每死 1 個敵人，所有冷卻中的**物理**新版技能冷卻 -0.05 秒
- 邊界：魔法群組（火球、雷系、冰系…）不受影響；40 米外的死亡不算；高塔無擊殺事件；`legend deadTime weapon force` 放在裝備上：不生效（與穿上符文真言時比對），裝備詳情該行顯示灰字並加「(僅符文真言生效)」（見第 5 節 K1）
- 回歸風險：閘門在 `js/formula.js` 聚合（略過裝備上的專屬鍵）與 `js/runeword.js` `rwFinishAggregate`（真言借用寫回）
- 生效位置：`js/legendary.js`（`physCdrSec`、`deadTime`）

### 3.25 停用（5 個）

#### L131 `fireSpiritShield`｜火靈盾

- 狀態：**停用**（任何來源都不生效）
- 說明（遊戲內）：身體永久被火焰包覆，每秒損失 1% 最大生命；攻擊你的敵人持續受到 20% 火焰灼燒傷害，最多疊加 10 層。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all`；先不加 force 輸入 `legend fireSpiritShield`，應被拒絕
- 步驟與預期：`legend fireSpiritShield weapon force`：不應每秒損失生命、攻擊者不應被灼燒
- 邊界：新掉落的裝備不會出現；舊存檔殘留不報錯；`legend fireSpiritShield weapon force` 放在裝備上：不生效，裝備詳情該行顯示灰字並加「(已停用)」（見第 5 節 K1）
- 回歸風險：閘門在 `js/legendary.js` `legendaryHas`；任何繞過它直接讀 `st.legendaryEffects` 的新程式都會讓停用失效
- 生效位置：`js/legendary.js`（`selfHpDrainPctPerSec`、`retaliateBurnPct`、`fireSpiritShield`）

#### L132 `magicLightShield`｜魔法光盾

- 狀態：**停用**（任何來源都不生效）
- 說明（遊戲內）：生命值低於 50% 時產生相當於最大生命的光盾；光盾期間受到的傷害降低 35%，持續 5 秒；內建冷卻 20 秒。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all`；先不加 force 輸入 `legend magicLightShield`，應被拒絕
- 步驟與預期：`legend magicLightShield weapon force`：生命低於 50% 時不應產生光盾
- 邊界：新掉落的裝備不會出現；舊存檔殘留不報錯；`legend magicLightShield weapon force` 放在裝備上：不生效，裝備詳情該行顯示灰字並加「(已停用)」（見第 5 節 K1）
- 回歸風險：閘門在 `js/legendary.js` `legendaryHas`；任何繞過它直接讀 `st.legendaryEffects` 的新程式都會讓停用失效
- 生效位置：`js/legendary.js`（`lowHpThresholdPct`、`shieldHpPct`、`magicLightShield`）

#### L133 `lightCollision`｜光之碰撞

- 狀態：**停用**（任何來源都不生效）
- 說明（遊戲內）：每隔 4 秒自動發射追蹤光彈尋找最近的目標，造成 250% 聖屬性傷害。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all`；先不加 force 輸入 `legend lightCollision`，應被拒絕
- 步驟與預期：`legend lightCollision weapon force`：不應每 4 秒自動發射光彈
- 邊界：新掉落的裝備不會出現；舊存檔殘留不報錯；`legend lightCollision weapon force` 放在裝備上：不生效，裝備詳情該行顯示灰字並加「(已停用)」（見第 5 節 K1）
- 回歸風險：閘門在 `js/legendary.js` `legendaryHas`；任何繞過它直接讀 `st.legendaryEffects` 的新程式都會讓停用失效
- 生效位置：`js/legendary.js`（`autoProjectile`、`lightCollision`）

#### L134 `ghostLamp`｜幽冥神燈

- 狀態：**停用**（任何來源都不生效）
- 說明（遊戲內）：召喚 2 個擁有你 20% 生命與攻擊力的鬼娃衝向敵人；敵人優先攻擊鬼娃，鬼娃死亡時對所有敵人造成 300% 暗影傷害。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all`；先不加 force 輸入 `legend ghostLamp`，應被拒絕
- 步驟與預期：`legend ghostLamp weapon force`：不應召喚鬼娃、敵人仍直接攻擊你
- 邊界：新掉落的裝備不會出現；舊存檔殘留不報錯；`legend ghostLamp weapon force` 放在裝備上：不生效，裝備詳情該行顯示灰字並加「(已停用)」（見第 5 節 K1）
- 回歸風險：閘門在 `js/legendary.js` `legendaryHas`；任何繞過它直接讀 `st.legendaryEffects` 的新程式都會讓停用失效
- 生效位置：`js/legendary.js`（`ghostLamp`）

#### L135 `magicRecoil`｜魔法反震

- 狀態：**停用**（任何來源都不生效）
- 說明（遊戲內）：反震敵人時消耗 10 點魔力，且該次反震傷害提高 100%。
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all`；先不加 force 輸入 `legend magicRecoil`，應被拒絕
- 步驟與預期：`legend magicRecoil weapon force`＋有反震：反震時不應扣 10 點法力、反震傷害不翻倍
- 邊界：新掉落的裝備不會出現；舊存檔殘留不報錯；`legend magicRecoil weapon force` 放在裝備上：不生效，裝備詳情該行顯示灰字並加「(已停用)」（見第 5 節 K1）
- 回歸風險：閘門在 `js/legendary.js` `legendaryHas`；任何繞過它直接讀 `st.legendaryEffects` 的新程式都會讓停用失效
- 生效位置：`js/legendary.js`（`thornsManaCost`、`thornsDamagePct`、`magicRecoil`）

### 3.26 通用（9 個）

#### L136 `bloodthirst`｜嗜血

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：對流血的敵人造成傷害額外+20%
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend bloodthirst`
- 步驟與預期：需要流血來源（突刺【穿心裂血】、血刃斬、泥沼【侵蝕】）；對流血中的敵人傷害 +20%
- 邊界：只認流血（id 含 bleed）；同名兩件只生效一件（C4）
- 回歸風險：數值讀 `passiveValueFor`（固定 base，不隨稀有度）
- 生效位置：`js/legendary.js`（`bloodthirst`）

#### L137 `chainReaction`｜連鎖反應

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：敵人每擁有1種異常狀態則受到傷害+10%，最多5種
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend chainReaction`
- 步驟與預期：對敵人身上的異常狀態**種類**計數：每 1 種 +10%，最多 5 種（+50%）
- 邊界：同一種疊多層只算 1 種；控場也算異常；同名兩件只生效一件（C4）
- 回歸風險：數值讀 `passiveValueFor`（固定 base，不隨稀有度）
- 生效位置：`js/legendary.js`（`debuffDamage`、`chainReaction`）

#### L138 `elation`｜激昂

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：在敵人疊加異常狀態效果時，最高疊加層數+1層
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend elation`
- 步驟與預期：敵人身上可疊層的異常狀態（寒霜、風切、千瘡百孔…）最高層數 +1
- 邊界：只影響疊層上限，不影響每層數值；同名兩件只生效一件（C4）
- 回歸風險：數值讀 `passiveValueFor`（固定 base，不隨稀有度）
- 生效位置：`js/status.js`（`elation`）

#### L139 `experienceTome`｜經驗寶典

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：獲得升級經驗值+20%
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend experienceTome`
- 步驟與預期：屬性面板經驗加成 +20%；擊殺經驗同步增加
- 邊界：計入 `A.xpBonus`，與其他經驗加成相加；同名兩件只生效一件（C4）
- 回歸風險：數值讀 `passiveValueFor`（固定 base，不隨稀有度）
- 生效位置：`js/formula.js`（`xpBonus`）；`js/combat.js`（`xpBonus`）；`js/tower.js`（`xpBonus`）

#### L140 `goldenTouch`｜點金手

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：獲得金幣+30%
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend goldenTouch`
- 步驟與預期：屬性面板金幣加成 +30%；擊殺金幣同步增加
- 邊界：計入 `A.goldBonus`；同名兩件只生效一件（C4）
- 回歸風險：數值讀 `passiveValueFor`（固定 base，不隨稀有度）
- 生效位置：`js/formula.js`（`goldBonus`）；`js/combat.js`（`goldBonus`）

#### L141 `fortify`｜強固

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：當你沒有護盾時，獲得15%額外傷害減免
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend fortify`
- 步驟與預期：沒有任何護盾時受到的傷害 -15%
- 邊界：只要有護盾（任何來源）就不生效；同名兩件只生效一件（C4）
- 回歸風險：數值讀 `passiveValueFor`（固定 base，不隨稀有度）
- 生效位置：`js/legendary.js`（`fortify`）

#### L142 `softenBlow`｜以柔剋剛

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：當你一次性受到超過生命上限的30%的傷害時，該次傷害會轉為接下來5秒內每秒-6%生命傷害
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend softenBlow`
- 步驟與預期：`elite 1 all 3 1` 用高傷敵人：單次受到超過最大生命 30% 的傷害時，該次歸 0，改為 5 秒內每秒損失 6% 生命
- 邊界：多次大傷可同時排隊；`god 1` 下最低留 1 血、`HP_lock` 下不扣；同名兩件只生效一件（C4）
- 回歸風險：數值讀 `passiveValueFor`（固定 base，不隨稀有度）
- 生效位置：`js/legendary.js`（`stagger`、`softenBlow`）

#### L143 `shieldWall`｜盾牆

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：格擋減傷率上限提升至80%
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend shieldWall`
- 步驟與預期：格擋減傷率上限提升至 80%（`statset blockred` 拉高後面板最多到 80%）
- 邊界：原本上限已高於 80% 時取較高者；同名兩件只生效一件（C4）
- 回歸風險：數值讀 `passiveValueFor`（固定 base，不隨稀有度）
- 生效位置：`js/formula.js`（`shieldWall`）

#### L144 `manaReflux`｜返哺

- 狀態：可隨機掉落（裝備傳奇池）
- 說明（遊戲內）：每次施放技能有25%機率回復該技能消耗的80%法力值，返還的法力將在5秒內緩慢回復
- 前置：`equipset legendary 100 0 0 wear` → `legend clear all` → `legend manaReflux`
- 步驟與預期：每次施放技能約 25% 返還該技能法力消耗的 80%，在 5 秒內慢慢回復（藍字）
- 邊界：`MP_lock` 下扣法力為 0 時不返還；同名兩件只生效一件（C4）
- 回歸風險：數值讀 `passiveValueFor`（固定 base，不隨稀有度）
- 生效位置：`js/legendary.js`（`manaRefund`、`manaReflux`）

## 4. 符文真言逐項（65 組）

共通流程：依「測試裝備」用 GM 發一件剛好放得下的最低品質裝備並穿上 → `runeword 真言id` 發配方符文 → 裝備頁選該裝備 →「符文」→ 依配方順序點孔鑲入 → 按「刻印」→ 孔列下方出現符文真言橫幅＝成形。
「預期」是遊戲引擎對該測試裝備（Lv100、強化 +0）算出的效果行，裝備詳情應逐字相同（C1）；用別的等級或稀有度時屬性數字會不同、機制行不變。

**每一組都要驗的成形邊界**（W 條目只寫個別差異）：

- 順序錯誤不成形；中間空一孔（不連續）不成形；前後的孔可以空著。
- 裝備類型不符不成形（例：法杖類真言放劍上）；孔數不足放不下。
- 同一件同時符合多組配方時取符文數最多者。
- 拆掉（抹除）任一顆即失效、放回原順序即恢復；抹除會消耗費用、符文不退還。
- 同一組真言穿在兩件裝備上：屬性各算，機制（fx／觸發／被動／借用傳奇）只算一次。
- 圖鑑：成形一次後永久揭露（`runewordSeen`），存讀檔與拆裝後仍在（詳見 `docs/RUNEWORD_DESIGN.md` 7.5 節）。

### 4.1 第 1 級　普通（14 組）

#### W01 `rw_firstcry`｜初啼

- 配方（依序）：微光 `r01` → 餘燼 `r02`（2 孔）｜適用：主手／雙手武器
- 測試裝備：`equip 6 100 sword1h`（最低品質 神話（`6`））→ 穿上 → `runeword rw_firstcry`
- 預期（裝備詳情的效果行）：
  - 物理攻擊 +577
  - 魔法攻擊 +577
  - 命中率 +9.7%
- 機制測試：
  - 只有屬性條目：逐條比對屬性面板增加量＝預期
- 邊界：見本節開頭的成形邊界
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）

#### W02 `rw_nightwatch`｜守夜

- 配方（依序）：餘燼 `r02` → 巖心 `r05`（2 孔）｜適用：胸甲
- 測試裝備：`equip 6 100 chest`（最低品質 神話（`6`））→ 穿上 → `runeword rw_nightwatch`
- 預期（裝備詳情的效果行）：
  - 物理防禦 +348
  - 生命值 +21.3K
  - 生命恢復/秒 +33
- 機制測試：
  - 只有屬性條目：逐條比對屬性面板增加量＝預期
- 邊界：見本節開頭的成形邊界
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）

#### W03 `rw_frostwhisper`｜霜語

- 配方（依序）：霜痕 `r03` → 風語 `r04`（2 孔）｜適用：施法類武器／副手
- 測試裝備：`equip 6 100 wand1h`（最低品質 神話（`6`））→ 穿上 → `runeword rw_frostwhisper`
- 預期（裝備詳情的效果行）：
  - 魔法攻擊 +721
  - 冰屬性傷害提升 +17.5%
  - 普通攻擊命中時有 10% 機率：目標緩速 2 秒
- 機制測試：
  - 觸發「普攻命中時」（10% 機率）：緩速目標 2 秒
- 邊界：見本節開頭的成形邊界
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

#### W04 `rw_windwalk`｜行雲

- 配方（依序）：風語 `r04` → 微光 `r01` → 暗影 `r08`（3 孔）｜適用：靴子
- 測試裝備：`equip 7 100 boots`（最低品質 創世（`7`））→ 穿上 → `runeword rw_windwalk`
- 預期（裝備詳情的效果行）：
  - 閃避率 +12.7%
  - 生命值 +21.0K
  - 命中率 +11.9%
- 機制測試：
  - 只有屬性條目：逐條比對屬性面板增加量＝預期
- 邊界：見本節開頭的成形邊界
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）

#### W05 `rw_stoneskin`｜石膚

- 配方（依序）：巖心 `r05` → 霜痕 `r03`（2 孔）｜適用：護肩、護腿
- 測試裝備：`equip 6 100 shoulder`（最低品質 神話（`6`））→ 穿上 → `runeword rw_stoneskin`
- 預期（裝備詳情的效果行）：
  - 物理防禦 +23.2%
  - 生命值 +21.7%
  - 物理抗性 +72.4%
  - 反震 1.5%
- 機制測試：
  - 被動「反震」+1.5：受擊時對攻擊者造成你最大生命 1.5% 的傷害（與裝備反震相加）
- 邊界：見本節開頭的成形邊界
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）

#### W06 `rw_viperkiss`｜蛇吻

- 配方（依序）：毒牙 `r06` → 暗影 `r08`（2 孔）｜適用：單手劍、單手匕首、單手魔劍
- 測試裝備：`equip 6 100 sword1h`（最低品質 神話（`6`））→ 穿上 → `runeword rw_viperkiss`
- 預期（裝備詳情的效果行）：
  - 物理攻擊 +18.6%
  - 毒屬性傷害提升 +17.5%
  - 暴擊率 +4.4%
  - 普通攻擊命中時有 15% 機率：對目標施加中毒（每秒 30% 攻擊力，4 秒）
- 機制測試：
  - 觸發「普攻命中時」（15% 機率）：附加中毒：每秒 30% 魔攻（沒有魔攻用物攻）、4 秒
- 邊界：只限劍／匕首／魔劍類單手武器；法杖不可成形
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

#### W07 `rw_minorthunder`｜輕雷

- 配方（依序）：雷鳴 `r07` → 風語 `r04`（2 孔）｜適用：單手武器
- 測試裝備：`equip 6 100 sword1h`（最低品質 神話（`6`））→ 穿上 → `runeword rw_minorthunder`
- 預期（裝備詳情的效果行）：
  - 魔法攻擊 +23.2%
  - 雷屬性傷害提升 +23.3%
  - 普通攻擊命中時有 8% 機率：對目標造成 45% 雷電傷害
- 機制測試：
  - 觸發「普攻命中時」（8% 機率）：造成 45% 雷屬性傷害（對象：當前目標；走完整傷害管線，吃抗性與爆擊）
- 邊界：見本節開頭的成形邊界
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

#### W08 `rw_lightguard`｜聖光之守

- 配方（依序）：微光 `r01` → 聖輝 `r09`（2 孔）｜適用：頭盔
- 測試裝備：`equip 6 100 helmet`（最低品質 神話（`6`））→ 穿上 → `runeword rw_lightguard`
- 預期（裝備詳情的效果行）：
  - 法力值 +3.11K
  - 聖光抗性 +197.5%
  - 生命值 +18.1%
  - 擊殺敵人時回復 0.5% 最大法力
- 機制測試：
  - 野外每擊殺 1 隻回復 0.5% 最大法力（高塔沒有擊殺事件）
- 邊界：高塔無擊殺事件
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；擊殺掛勾 `rwOnKill`（只有野外）

#### W09 `rw_bloodring`｜血誓之環

- 配方（依序）：血誓 `r10` → 暗影 `r08`（2 孔）｜適用：戒指
- 測試裝備：`equip 6 100 ring`（最低品質 神話（`6`））→ 穿上 → `runeword rw_bloodring`
- 預期（裝備詳情的效果行）：
  - 吸血 +19
  - 物理攻擊 +15.5%
  - 命中率 +9.7%
  - 擊殺敵人時回復 0.5% 最大生命
- 機制測試：
  - 野外每擊殺 1 隻回復 0.5% 最大生命（高塔沒有擊殺事件）
- 邊界：高塔無擊殺事件
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；擊殺掛勾 `rwOnKill`（只有野外）

#### W10 `rw_steelheart`｜鋼心

- 配方（依序）：巖心 `r05` → 血誓 `r10`（2 孔）｜適用：腰帶
- 測試裝備：`equip 6 100 belt`（最低品質 神話（`6`））→ 穿上 → `runeword rw_steelheart`
- 預期（裝備詳情的效果行）：
  - 生命值 +27.1%
  - 物理防禦 +23.2%
  - 韌性 +15.5%
- 機制測試：
  - 只有屬性條目：逐條比對屬性面板增加量＝預期
- 邊界：見本節開頭的成形邊界
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）

#### W11 `rw_springflow`｜泉湧

- 配方（依序）：微光 `r01` → 餘燼 `r02` → 暗影 `r08`（3 孔）｜適用：項鍊
- 測試裝備：`equip 7 100 amulet`（最低品質 創世（`7`））→ 穿上 → `runeword rw_springflow`
- 預期（裝備詳情的效果行）：
  - 法力恢復/秒 +10
  - 生命恢復/秒 +81
  - 法力值 +2.87K
  - 擊殺敵人時回復 1% 最大法力
- 機制測試：
  - 野外每擊殺 1 隻回復 1% 最大法力（高塔沒有擊殺事件）
- 邊界：高塔無擊殺事件
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；擊殺掛勾 `rwOnKill`（只有野外）

#### W12 `rw_scavenger`｜拾荒者

- 配方（依序）：微光 `r01` → 風語 `r04`（2 孔）｜適用：戒指／項鍊
- 測試裝備：`equip 6 100 ring`（最低品質 神話（`6`））→ 穿上 → `runeword rw_scavenger`
- 預期（裝備詳情的效果行）：
  - 金幣加成 +16.8%
  - 經驗加成 +4.9%
  - 掉寶率 +6.2%
  - 符文掉落率 +4%
- 機制測試：
  - 符文掉落率 ×(1+4%)（野外與封魔塔通關），以同場景長時間掉落數比較
- 邊界：見本節開頭的成形邊界
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）

#### W13 `rw_breaker`｜破軍

- 配方（依序）：餘燼 `r02` → 血誓 `r10` → 巖心 `r05`（3 孔）｜適用：雙手武器（只能放在雙手武器）
- 測試裝備：`equip 6 100 axe2h`（最低品質 神話（`6`），雙手武器）→ 穿上 → `runeword rw_breaker`
- 預期（裝備詳情的效果行）：
  - 物理攻擊 +18.6%
  - 暴擊傷害 +69.6%
  - 物理穿透 +6.4%
- 機制測試：
  - 只有屬性條目：逐條比對屬性面板增加量＝預期
- 邊界：雙手武器專用
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）

#### W14 `rw_burnstar`｜燃星

- 配方（依序）：餘燼 `r02` → 聖輝 `r09`（2 孔）｜適用：施法類武器／副手
- 測試裝備：`equip 6 100 wand1h`（最低品質 神話（`6`））→ 穿上 → `runeword rw_burnstar`
- 預期（裝備詳情的效果行）：
  - 魔法攻擊 +23.2%
  - 火屬性傷害提升 +17.5%
  - 法力值 +2.33K
  - 施放技能時有 15% 機率：回復 6% 最大法力
- 機制測試：
  - 觸發「施放技能時（免費施放不再觸發，不會無限連鎖）」（15% 機率）：回復 6% 最大法力
- 邊界：見本節開頭的成形邊界
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

### 4.2 第 2 級　精良（14 組）

#### W15 `rw_galeblade`｜疾風烈刃

- 配方（依序）：風語 `r04` → 疾影 `r13` → 磐石 `r14`（3 孔）｜適用：單手劍、單手匕首、單手魔劍
- 測試裝備：`equip 7 100 sword1h`（最低品質 創世（`7`））→ 穿上 → `runeword rw_galeblade`
- 預期（裝備詳情的效果行）：
  - 攻擊速度 +22.7%
  - 暴擊率 +7%
  - 物理攻擊 +24.8%
  - 攻擊速度額外乘算 +4%（突破攻速上限）
- 機制測試：
  - 攻速乘算 ×(1+4%)，可突破攻速上限：先 `maxstats`，鑲入後面板攻速仍上升
- 邊界：見本節開頭的成形邊界
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；攻速乘區 `rwAttackSpeedMultiplier`（經 `legendaryAttackSpeedMultiplier`）

#### W16 `rw_thundergod`｜雷神之怒

- 配方（依序）：雷鳴 `r07` → 血誓 `r10` → 鋼魄 `r11` → 夜幕 `r16`（4 孔）｜適用：主手／雙手武器
- 測試裝備：`equip 10 100 sword1h`（最低品質 混沌（`10`））→ 穿上 → `runeword rw_thundergod`
- 預期（裝備詳情的效果行）：
  - 物理攻擊 +49.6%
  - 雷屬性傷害提升 +61.9%
  - 暴擊傷害 +185.5%
  - 普通攻擊命中時有 15% 機率：對所有敵人造成 60% 雷電傷害
- 機制測試：
  - 觸發「普攻命中時」（15% 機率）：造成 60% 雷屬性傷害（對象：全部敵人；走完整傷害管線，吃抗性與爆擊）
- 邊界：見本節開頭的成形邊界
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

#### W17 `rw_winterherald`｜凜冬使者

- 配方（依序）：霜痕 `r03` → 霜痕 `r03` → 靈泉 `r12`（3 孔）｜適用：施法類武器／副手
- 測試裝備：`equip 7 100 wand1h`（最低品質 創世（`7`））→ 穿上 → `runeword rw_winterherald`
- 預期（裝備詳情的效果行）：
  - 魔法攻擊 +33.2%
  - 冰屬性傷害提升 +37.3%
  - 冷卻縮減 +1%
  - 對暈眩或緩速中的敵人傷害 +7.5%
  - 普通攻擊命中時有 20% 機率：目標暈眩 1.5 秒
- 機制測試：
  - 目標暈眩或緩速中時傷害 +7.5%
  - 觸發「普攻命中時」（20% 機率）：暈眩目標 1.5 秒（BOSS 控制免疫照規則；搭配【崩山裂地者】會延長）
- 邊界：暈眩觸發後對該目標的控場增傷立即生效
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；條件式增傷收斂在 `rwOutgoingMultiplier`（併入 `legendaryOutgoingDamageMultiplier`）；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

#### W18 `rw_bloodgulp`｜血飲者

- 配方（依序）：血誓 `r10` → 暗影 `r08` → 疾影 `r13`（3 孔）｜適用：主手／雙手武器
- 測試裝備：`equip 7 100 sword1h`（最低品質 創世（`7`））→ 穿上 → `runeword rw_bloodgulp`
- 預期（裝備詳情的效果行）：
  - 吸血 +31
  - 物理攻擊 +33.2%
  - 暴擊率 +4.6%
  - 擊殺敵人時回復 1.5% 最大生命
  - 生命低於 35% 時，傷害 +12.5%
- 機制測試：
  - 野外每擊殺 1 隻回復 1.5% 最大生命（高塔沒有擊殺事件）
  - 自身生命 ≤ 35% 時傷害 +12.5%
- 邊界：高塔無擊殺事件
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；條件式增傷收斂在 `rwOutgoingMultiplier`（併入 `legendaryOutgoingDamageMultiplier`）；擊殺掛勾 `rwOnKill`（只有野外）

#### W19 `rw_unmoving`｜不動山

- 配方（依序）：巖心 `r05` → 磐石 `r14` → 鋼魄 `r11`（3 孔）｜適用：胸甲
- 測試裝備：`equip 7 100 chest`（最低品質 創世（`7`））→ 穿上 → `runeword rw_unmoving`
- 預期（裝備詳情的效果行）：
  - 生命值 +57.8%
  - 物理防禦 +49.6%
  - 物理抗性 +95.8%
  - 單次受到的傷害最多只會是最大生命的 40%
- 機制測試：
  - 單次受到的傷害不超過最大生命的 40%（用 `elite 1 all 3 1` 高傷敵人驗證；多組時取最嚴格者）
- 邊界：見本節開頭的成形邊界
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；單次受傷上限經 `rwMaxHitPct` 進 `resolveHit`

#### W20 `rw_shadowstep`｜影步

- 配方（依序）：暗影 `r08` → 疾影 `r13` → 夜幕 `r16`（3 孔）｜適用：靴子、護腿
- 測試裝備：`equip 7 100 boots`（最低品質 創世（`7`））→ 穿上 → `runeword rw_shadowstep`
- 預期（裝備詳情的效果行）：
  - 閃避率 +19.4%
  - 命中率 +20.8%
  - 生命值 +28.9%
  - 受到傷害時有 15% 機率：無敵 1 秒（內建冷卻 10 秒）
- 機制測試：
  - 觸發「受到生命傷害時」（15% 機率、冷卻 10 秒）：無敵 1 秒（狀態列無敵圖示、受擊不扣血）
- 邊界：冷卻 10 秒內再受擊不觸發；冷卻內不再觸發
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

#### W21 `rw_dawncrown`｜旭日之冠

- 配方（依序）：曙光 `r15` → 聖輝 `r09` → 靈泉 `r12`（3 孔）｜適用：頭盔
- 測試裝備：`equip 7 100 helmet`（最低品質 創世（`7`））→ 穿上 → `runeword rw_dawncrown`
- 預期（裝備詳情的效果行）：
  - 生命值 +38.7%
  - 法力值 +4.98K
  - 全屬性抗性 +45.2%
  - 每 10 秒：回復 4% 最大生命，回復 4% 最大法力
- 機制測試：
  - 觸發「每隔固定秒數」（每 10 秒）：回復 4% 最大生命（綠字）；回復 4% 最大法力
- 邊界：見本節開頭的成形邊界
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

#### W22 `rw_poisoncloud`｜毒雲

- 配方（依序）：毒牙 `r06` → 毒牙 `r06` → 靈泉 `r12`（3 孔）｜適用：施法類武器／副手
- 測試裝備：`equip 7 100 wand1h`（最低品質 創世（`7`））→ 穿上 → `runeword rw_poisoncloud`
- 預期（裝備詳情的效果行）：
  - 魔法攻擊 +33.2%
  - 毒屬性傷害提升 +37.3%
  - 魔法穿透 +10.2%
  - 施放技能時有 25% 機率：對所有敵人施加中毒（每秒 30% 攻擊力，4 秒）
- 機制測試：
  - 觸發「施放技能時（免費施放不再觸發，不會無限連鎖）」（25% 機率）：附加中毒：每秒 30% 魔攻（沒有魔攻用物攻）、4 秒，對全部敵人
- 邊界：見本節開頭的成形邊界
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

#### W23 `rw_awakening`｜驚蟄

- 配方（依序）：風語 `r04` → 雷鳴 `r07` → 疾影 `r13`（3 孔）｜適用：手套
- 測試裝備：`equip 7 100 gloves`（最低品質 創世（`7`））→ 穿上 → `runeword rw_awakening`
- 預期（裝備詳情的效果行）：
  - 攻擊速度 +27.3%
  - 暴擊率 +9.4%
  - 物理攻擊 +24.8%
  - 普通攻擊暴擊時：獲得「攻速」+6%（3 秒，最多 3 層）
- 機制測試：
  - 觸發「普攻暴擊時」：獲得增益 `aspdUp` 6、3 秒，最多疊 3 層（以真言名稱分開存放，不與同名增益互相刷新）
- 邊界：疊層增益與其他來源的同名攻速增益分開計算
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

#### W24 `rw_ironoath`｜重甲鐵誓

- 配方（依序）：磐石 `r14` → 鋼魄 `r11` → 血誓 `r10`（3 孔）｜適用：護肩
- 測試裝備：`equip 7 100 shoulder`（最低品質 創世（`7`））→ 穿上 → `runeword rw_ironoath`
- 預期（裝備詳情的效果行）：
  - 生命值 +48%
  - 物理防禦 +33.2%
  - 物理抗性 +95.8%
  - 反震 6%
  - 受到傷害時有 20% 機率：對攻擊者造成 50% 物理傷害（內建冷卻 3 秒）
- 機制測試：
  - 被動「反震」+6：受擊時對攻擊者造成你最大生命 6% 的傷害（與裝備反震相加）
  - 觸發「受到生命傷害時」（20% 機率、冷卻 3 秒）：造成 50% 物理傷害（對象：攻擊你的敵人；走完整傷害管線，吃抗性與爆擊）
- 邊界：反擊傷害冷卻 3 秒；冷卻內不再觸發
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

#### W25 `rw_gambler`｜賭徒之戒

- 配方（依序）：微光 `r01` → 疾影 `r13` → 夜幕 `r16` → 鋼魄 `r11`（4 孔）｜適用：戒指
- 測試裝備：`equip 10 100 ring`（最低品質 混沌（`10`））→ 穿上 → `runeword rw_gambler`
- 預期（裝備詳情的效果行）：
  - 幸運值 +519
  - 暴擊率 +18.8%
  - 暴擊傷害 +308.3%
  - 掉寶率 +22.2%
  - 符文掉落率 +7.5%
- 機制測試：
  - 符文掉落率 ×(1+7.5%)（野外與封魔塔通關），以同場景長時間掉落數比較
- 邊界：見本節開頭的成形邊界
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）

#### W26 `rw_guardian`｜守護者之盾

- 配方（依序）：磐石 `r14` → 鋼魄 `r11` → 巖心 `r05` → 曙光 `r15`（4 孔）｜適用：盾牌
- 測試裝備：`equip 10 100 shield`（最低品質 混沌（`10`））→ 穿上 → `runeword rw_guardian`
- 預期（裝備詳情的效果行）：
  - 格擋率 +33%
  - 格擋減傷 +99.2%
  - 生命值 +77.4%
  - 格擋成功時有 40% 機率：對攻擊者造成 100% 物理傷害
- 機制測試：
  - 觸發「格擋時（先 `statset block 100`）」（40% 機率）：造成 100% 物理傷害（對象：攻擊你的敵人；走完整傷害管線，吃抗性與爆擊）
- 邊界：只限盾牌（副手欄）
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

#### W27 `rw_arcaneecho`｜奧術迴響

- 配方（依序）：靈泉 `r12` → 曙光 `r15` → 靈泉 `r12` → 聖輝 `r09`（4 孔）｜適用：法器、魔法書、水晶球
- 測試裝備：`equip 10 100 focus`（最低品質 混沌（`10`））→ 穿上 → `runeword rw_arcaneecho`
- 預期（裝備詳情的效果行）：
  - 魔法攻擊 +99.2%
  - 法力值 +9.96K
  - 冷卻縮減 +4.2%
  - 施放技能時有 20% 機率：所有技能冷卻縮短 0.75 秒
- 機制測試：
  - 觸發「施放技能時（免費施放不再觸發，不會無限連鎖）」（20% 機率）：所有冷卻中的技能冷卻 -0.75 秒
- 邊界：見本節開頭的成形邊界
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

#### W28 `rw_tidecall`｜潮汐

- 配方（依序）：暗影 `r08` → 靈泉 `r12` → 磐石 `r14`（3 孔）｜適用：戒指／項鍊
- 測試裝備：`equip 7 100 ring`（最低品質 創世（`7`））→ 穿上 → `runeword rw_tidecall`
- 預期（裝備詳情的效果行）：
  - 法力恢復/秒 +12
  - 生命恢復/秒 +105
  - 魔法攻擊 +33.2%
  - 擊殺敵人時回復 1% 最大法力
  - 技能法力消耗 -7.5%
  - 每 8 秒：回復 2% 最大生命，回復 3% 最大法力
- 機制測試：
  - 野外每擊殺 1 隻回復 1% 最大法力（高塔沒有擊殺事件）
  - 技能法力消耗 ×(1−7.5%)（看法力條扣量；技能列顯示仍是基礎值，已知限制）
  - 觸發「每隔固定秒數」（每 8 秒）：回復 2% 最大生命（綠字）；回復 3% 最大法力
- 邊界：高塔無擊殺事件
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；法力乘區 `rwManaCostFactor`（`js/skills.js`、`js/skills2.js` 多處扣法力）；擊殺掛勾 `rwOnKill`（只有野外）；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

### 4.3 第 3 級　史詩（14 組）

#### W29 `rw_apocalypse`｜天啟

- 配方（依序）：血誓 `r10` → 鋼魄 `r11` → 蒼穹 `r21` → 熔岩 `r23`（4 孔）｜適用：主手／雙手武器
- 測試裝備：`equip 10 100 sword1h`（最低品質 混沌（`10`））→ 穿上 → `runeword rw_apocalypse`
- 預期（裝備詳情的效果行）：
  - 物理攻擊 +83.9%
  - 魔法攻擊 +83.9%
  - 暴擊傷害 +314%
  - 對BOSS傷害 +69.8%
  - 造成的所有傷害 +9%
  - 攻擊速度額外乘算 +5%（突破攻速上限）
- 機制測試：
  - 所有輸出傷害 ×(1+9%)：普攻、技能、觸發傷害、持續傷害一起變化
  - 攻速乘算 ×(1+5%)，可突破攻速上限：先 `maxstats`，鑲入後面板攻速仍上升
- 邊界：見本節開頭的成形邊界
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；條件式增傷收斂在 `rwOutgoingMultiplier`（併入 `legendaryOutgoingDamageMultiplier`）；攻速乘區 `rwAttackSpeedMultiplier`（經 `legendaryAttackSpeedMultiplier`）

#### W30 `rw_soulcleaver`｜斷魂

- 配方（依序）：鋼魄 `r11` → 嵐 `r20` → 厚土 `r22`（3 孔）｜適用：雙手武器（只能放在雙手武器）
- 測試裝備：`equip 6 100 axe2h`（最低品質 神話（`6`），雙手武器）→ 穿上 → `runeword rw_soulcleaver`
- 預期（裝備詳情的效果行）：
  - 物理攻擊 +45.6%
  - 暴擊傷害 +170.5%
  - 對菁英傷害 +28.4%
  - 物理穿透 +11.4%
  - 對生命低於 30% 的敵人傷害 +30%
  - 普通攻擊命中時有 8% 機率：直接斬殺生命低於 7.5% 的非 BOSS 敵人
- 機制測試：
  - 目標生命 < 30% 時傷害 +30%
  - 觸發「普攻命中時」（8% 機率）：斬殺生命低於 7.5% 的非 BOSS 敵人（BOSS、塔 BOSS 不受影響）
- 邊界：見本節開頭的成形邊界
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；條件式增傷收斂在 `rwOutgoingMultiplier`（併入 `legendaryOutgoingDamageMultiplier`）；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

#### W31 `rw_chainstorm`｜連環雷暴

- 配方（依序）：雷鳴 `r07` → 疾影 `r13` → 雷鳴 `r07` → 烈陽 `r17`（4 孔）｜適用：施法類武器／副手
- 測試裝備：`equip 10 100 wand1h`（最低品質 混沌（`10`））→ 穿上 → `runeword rw_chainstorm`
- 預期（裝備詳情的效果行）：
  - 魔法攻擊 +83.9%
  - 雷屬性傷害提升 +63.1%
  - 風屬性傷害提升 +41.9%
  - 魔法穿透 +28.2%
  - 普通攻擊暴擊時有 30% 機率：對所有敵人造成 60% 雷電傷害
  - 施放技能時有 25% 機率：對隨機 3 名敵人造成 50% 雷電傷害
- 機制測試：
  - 觸發「普攻暴擊時」（30% 機率）：造成 60% 雷屬性傷害（對象：全部敵人；走完整傷害管線，吃抗性與爆擊）
  - 觸發「施放技能時（免費施放不再觸發，不會無限連鎖）」（25% 機率）：造成 50% 雷屬性傷害（對象：隨機 3 個；走完整傷害管線，吃抗性與爆擊）
- 邊界：見本節開頭的成形邊界
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

#### W32 `rw_timewarden`｜時之守望

- 配方（依序）：寒月 `r18` → 嵐 `r20` → 寒月 `r18` → 靈泉 `r12`（4 孔）｜適用：法器、魔法書、水晶球
- 測試裝備：`equip 10 100 focus`（最低品質 混沌（`10`））→ 穿上 → `runeword rw_timewarden`
- 預期（裝備詳情的效果行）：
  - 冷卻縮減 +7%
  - 魔法攻擊 +83.9%
  - 法力恢復/秒 +21
  - 生命值 +64.9%
  - 所有技能冷卻時間 -10%（乘算，突破冷卻縮減上限）
  - 擊殺敵人時：所有技能冷卻縮短 0.5 秒
- 機制測試：
  - 技能冷卻 ×(1−10%)，可突破冷卻縮減上限；多組相加，最低 ×0.2
  - 觸發「野外擊殺時（高塔沒有擊殺事件）」：所有冷卻中的技能冷卻 -0.5 秒
- 邊界：高塔無擊殺事件
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；冷卻乘區 `rwCooldownFactor`（`js/skills2.js` 冷卻計算）；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

#### W33 `rw_lastbreath`｜絕境

- 配方（依序）：磐石 `r14` → 厚土 `r22` → 寒月 `r18`（3 孔）｜適用：胸甲
- 測試裝備：`equip 7 100 chest`（最低品質 創世（`7`））→ 穿上 → `runeword rw_lastbreath`
- 預期（裝備詳情的效果行）：
  - 生命值 +65.4%
  - 物理防禦 +48.8%
  - 魔法防禦 +48.8%
  - 全局減傷 +250
  - 生命低於 30% 時：無敵 3 秒，回復 15% 最大生命，淨化負面狀態（內建冷卻 90 秒）
- 機制測試：
  - 觸發「生命低於門檻時」（生命 < 30%、冷卻 90 秒）：無敵 3 秒（狀態列無敵圖示、受擊不扣血）；回復 15% 最大生命（綠字）；淨化身上的負面狀態
- 邊界：冷卻 90 秒；觸發時連同淨化；冷卻內不再觸發
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

#### W34 `rw_swarmhunter`｜群獵

- 配方（依序）：疾影 `r13` → 驚蟄 `r19` → 熔岩 `r23` → 夜幕 `r16`（4 孔）｜適用：主手／雙手武器
- 測試裝備：`equip 10 100 sword1h`（最低品質 混沌（`10`））→ 穿上 → `runeword rw_swarmhunter`
- 預期（裝備詳情的效果行）：
  - 攻擊速度 +38.6%
  - 物理攻擊 +70.2%
  - 暴擊率 +11.9%
  - 範圍傷害 +11.7%
  - 場上每多一名敵人，傷害 +2.5%（最多計 10 名）
  - 普通攻擊同時對其他所有敵人造成 10% 的傷害
- 機制測試：
  - 每多 1 隻敵人傷害 +2.5%，最多算 10 隻（+25%）
  - 普攻命中時，對**其他所有**敵人造成該次普攻傷害 10% 的直接傷害（不再走防禦，來源「符文真言·擴散」）
- 邊界：見本節開頭的成形邊界
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；條件式增傷收斂在 `rwOutgoingMultiplier`（併入 `legendaryOutgoingDamageMultiplier`）

#### W35 `rw_assassin`｜影殺

- 配方（依序）：暗影 `r08` → 夜幕 `r16` → 疾影 `r13` → 厚土 `r22`（4 孔）｜適用：單手匕首
- 測試裝備：`equip 10 100 dagger1h`（最低品質 混沌（`10`））→ 穿上 → `runeword rw_assassin`
- 預期（裝備詳情的效果行）：
  - 暴擊率 +11.9%
  - 暴擊傷害 +208.4%
  - 物理攻擊 +55.7%
  - 閃避率 +14%
  - 對生命高於 70% 的敵人傷害 +10%
  - 傳奇特效【旋風之刺】：裝備兩把單手匕首時攻速額外提高 50%；每使用 20 次普攻後打出 3 連擊，每擊造成 120% 物理傷害。
- 機制測試：
  - 目標生命 > 70% 時傷害 +10%（滿血木樁有、打到 70% 以下消失）
  - 借用傳奇特效【旋風之刺】`whirlwindStab`：照 L118 的步驟驗證（符文真言專屬）
- 邊界：主手匕首即可成形，但借用的【旋風之刺】要主副手都是單手匕首才生效
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；條件式增傷收斂在 `rwOutgoingMultiplier`（併入 `legendaryOutgoingDamageMultiplier`）

#### W36 `rw_manafountain`｜魔泉

- 配方（依序）：靈泉 `r12` → 寒月 `r18` → 蒼穹 `r21`（3 孔）｜適用：頭盔、項鍊
- 測試裝備：`equip 7 100 helmet`（最低品質 創世（`7`））→ 穿上 → `runeword rw_manafountain`
- 預期（裝備詳情的效果行）：
  - 法力值 +5.63K
  - 法力恢復/秒 +14
  - 魔法攻擊 +35.1%
  - 技能法力消耗 -20%
  - 擊殺敵人時回復 1.5% 最大法力
- 機制測試：
  - 技能法力消耗 ×(1−20%)（看法力條扣量；技能列顯示仍是基礎值，已知限制）
  - 野外每擊殺 1 隻回復 1.5% 最大法力（高塔沒有擊殺事件）
- 邊界：高塔無擊殺事件
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；法力乘區 `rwManaCostFactor`（`js/skills.js`、`js/skills2.js` 多處扣法力）；擊殺掛勾 `rwOnKill`（只有野外）

#### W37 `rw_thornedfury`｜荊棘之怒

- 配方（依序）：磐石 `r14` → 熔岩 `r23` → 厚土 `r22` → 鋼魄 `r11`（4 孔）｜適用：胸甲、盾牌
- 測試裝備：`equip 10 100 chest`（最低品質 混沌（`10`））→ 穿上 → `runeword rw_thornedfury`
- 預期（裝備詳情的效果行）：
  - 生命值 +113.9%
  - 物理防禦 +97.6%
  - 物理抗性 +325.2%
  - 反震 17.5%
  - 受到傷害時有 25% 機率：對所有敵人造成 75% 物理傷害（內建冷卻 2 秒）
- 機制測試：
  - 被動「反震」+17.5：受擊時對攻擊者造成你最大生命 17.5% 的傷害（與裝備反震相加）
  - 觸發「受到生命傷害時」（25% 機率、冷卻 2 秒）：造成 75% 物理傷害（對象：全部敵人；走完整傷害管線，吃抗性與爆擊）
- 邊界：冷卻內不再觸發
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

#### W38 `rw_bossbane`｜弒王者

- 配方（依序）：蒼穹 `r21` → 血誓 `r10` → 鋼魄 `r11`（3 孔）｜適用：主手／雙手武器
- 測試裝備：`equip 7 100 sword1h`（最低品質 創世（`7`））→ 穿上 → `runeword rw_bossbane`
- 預期（裝備詳情的效果行）：
  - 對BOSS傷害 +58.1%
  - 對菁英傷害 +46.7%
  - 物理攻擊 +35.1%
  - 魔法攻擊 +35.1%
  - 對生命高於 70% 的敵人傷害 +20%
  - 場上只有一名敵人時，傷害 +20%
- 機制測試：
  - 目標生命 > 70% 時傷害 +20%（滿血木樁有、打到 70% 以下消失）
  - 場上只剩 1 隻敵人時傷害 +20%（`spawn 1 boss 1000` 有、`spawn 8` 沒有；高塔 BOSS 戰恆成立）
- 邊界：見本節開頭的成形邊界
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；條件式增傷收斂在 `rwOutgoingMultiplier`（併入 `legendaryOutgoingDamageMultiplier`）

#### W39 `rw_vitalpact`｜生命契約

- 配方（依序）：血誓 `r10` → 暗影 `r08` → 厚土 `r22`（3 孔）｜適用：戒指／項鍊
- 測試裝備：`equip 7 100 ring`（最低品質 創世（`7`））→ 穿上 → `runeword rw_vitalpact`
- 預期（裝備詳情的效果行）：
  - 生命值 +65.4%
  - 吸血 +35
  - 生命恢復/秒 +119
  - 擊殺敵人時回復 3% 最大生命
  - 生命高於 90% 時，傷害 +12.5%
- 機制測試：
  - 野外每擊殺 1 隻回復 3% 最大生命（高塔沒有擊殺事件）
  - 自身生命 ≥ 90% 時傷害 +12.5%
- 邊界：高塔無擊殺事件
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；條件式增傷收斂在 `rwOutgoingMultiplier`（併入 `legendaryOutgoingDamageMultiplier`）；擊殺掛勾 `rwOnKill`（只有野外）

#### W40 `rw_shieldwall`｜護盾牆

- 配方（依序）：蒼穹 `r21` → 磐石 `r14` → 蒼穹 `r21` → 厚土 `r22`（4 孔）｜適用：胸甲、護肩、頭盔
- 測試裝備：`equip 10 100 chest`（最低品質 混沌（`10`））→ 穿上 → `runeword rw_shieldwall`
- 預期（裝備詳情的效果行）：
  - 護盾效率 +93.3%
  - 生命值 +97.9%
  - 全局減傷 +630
  - 每 8 秒：獲得相當於 10% 最大生命的護盾（8 秒）
- 機制測試：
  - 觸發「每隔固定秒數」（每 8 秒）：獲得 10% 最大生命的護盾、8 秒
- 邊界：見本節開頭的成形邊界
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

#### W41 `rw_elemental`｜元素之環

- 配方（依序）：霜痕 `r03` → 烈陽 `r17` → 嵐 `r20`（3 孔）｜適用：戒指
- 測試裝備：`equip 7 100 ring`（最低品質 創世（`7`））→ 穿上 → `runeword rw_elemental`
- 預期（裝備詳情的效果行）：
  - 火屬性傷害提升 +18.9%
  - 冰屬性傷害提升 +18.9%
  - 雷屬性傷害提升 +18.9%
  - 風屬性傷害提升 +18.9%
  - 毒屬性傷害提升 +18.9%
  - 造成的所有傷害 +5%
- 機制測試：
  - 所有輸出傷害 ×(1+5%)：普攻、技能、觸發傷害、持續傷害一起變化
- 邊界：見本節開頭的成形邊界
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；條件式增傷收斂在 `rwOutgoingMultiplier`（併入 `legendaryOutgoingDamageMultiplier`）

#### W42 `rw_blitz`｜閃擊

- 配方（依序）：疾影 `r13` → 驚蟄 `r19` → 風語 `r04`（3 孔）｜適用：主手／雙手武器
- 測試裝備：`equip 7 100 sword1h`（最低品質 創世（`7`））→ 穿上 → `runeword rw_blitz`
- 預期（裝備詳情的效果行）：
  - 攻擊速度 +30.9%
  - 暴擊率 +11.9%
  - 命中率 +17.4%
  - 攻擊速度額外乘算 +7.5%（突破攻速上限）
  - 每 6 次普通攻擊命中：免費施放一個隨機的已裝配技能
- 機制測試：
  - 攻速乘算 ×(1+7.5%)，可突破攻速上限：先 `maxstats`，鑲入後面板攻速仍上升
  - 觸發「普攻命中時」（每第 6 次）：免費施放 1 個技能列上可施放的主動新版技能（技能列沒有主動技能時不作用）
- 邊界：技能列沒有主動技能時「每 6 下普攻」不會施放任何東西；免費施放不再觸發施放事件（巢狀上限 3），不得無限連鎖
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；攻速乘區 `rwAttackSpeedMultiplier`（經 `legendaryAttackSpeedMultiplier`）；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

### 4.4 第 4 級　傳說（23 組）

#### W43 `rw_quake`｜地裂

- 配方（依序）：巖心 `r05` → 磐石 `r14` → 厚土 `r22` → 雷霆 `r25` → 星辰 `r27`（5 孔）｜適用：雙手武器（只能放在雙手武器）
- 測試裝備：`equip 10 100 axe2h`（最低品質 混沌（`10`），雙手武器）→ 穿上 → `runeword rw_quake`
- 預期（裝備詳情的效果行）：
  - 物理攻擊 +91.5%
  - 對菁英傷害 +57.1%
  - 物理穿透 +28.2%
  - 暴擊傷害 +256.9%
  - 對生命高於 70% 的敵人傷害 +15%
  - 普通攻擊命中時有 8% 機率：對所有敵人造成 110% 物理傷害
  - 傳奇特效【大地之心】：當你的生命護盾降至 0 時獲得無敵 3 秒；此效果每 60 秒只能觸發 1 次。
- 機制測試：
  - 目標生命 > 70% 時傷害 +15%（滿血木樁有、打到 70% 以下消失）
  - 觸發「普攻命中時」（8% 機率）：造成 110% 物理傷害（對象：全部敵人；走完整傷害管線，吃抗性與爆擊）
  - 借用傳奇特效【大地之心】`rockEarthHeart`：照 L060 的步驟驗證（技能傳奇，需裝配 岩甲術）
- 邊界：見本節開頭的成形邊界
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；條件式增傷收斂在 `rwOutgoingMultiplier`（併入 `legendaryOutgoingDamageMultiplier`）；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

#### W44 `rw_galeeye`｜風暴之眼

- 配方（依序）：風語 `r04` → 驚蟄 `r19` → 嵐 `r20` → 虛空 `r26` → 命運 `r28`（5 孔）｜適用：雙手武器（只能放在雙手武器）
- 測試裝備：`equip 10 100 axe2h`（最低品質 混沌（`10`），雙手武器）→ 穿上 → `runeword rw_galeeye`
- 預期（裝備詳情的效果行）：
  - 攻擊速度 +56.7%
  - 暴擊率 +22.7%
  - 物理攻擊 +80.1%
  - 範圍傷害 +12%
  - 攻擊速度額外乘算 +9%（突破攻速上限）
  - 普通攻擊暴擊時：獲得「攻速」+6%（4 秒，最多 4 層）
  - 傳奇特效【風起雷落】：風系與雷系傷害加成較高者，可額外獲得較低者 25% 的屬性傷害加成。
- 機制測試：
  - 攻速乘算 ×(1+9%)，可突破攻速上限：先 `maxstats`，鑲入後面板攻速仍上升
  - 觸發「普攻暴擊時」：獲得增益 `aspdUp` 6、4 秒，最多疊 4 層（以真言名稱分開存放，不與同名增益互相刷新）
  - 借用傳奇特效【風起雷落】`stormAndThunder`：照 L128 的步驟驗證（符文真言專屬）
- 邊界：見本節開頭的成形邊界
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；攻速乘區 `rwAttackSpeedMultiplier`（經 `legendaryAttackSpeedMultiplier`）；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

#### W45 `rw_bloodrite`｜血祭

- 配方（依序）：血誓 `r10` → 暗影 `r08` → 厚土 `r22` → 冰魄 `r24` → 虛空 `r26`（5 孔）｜適用：雙手武器（只能放在雙手武器）
- 測試裝備：`equip 10 100 axe2h`（最低品質 混沌（`10`），雙手武器）→ 穿上 → `runeword rw_bloodrite`
- 預期（裝備詳情的效果行）：
  - 物理攻擊 +103%
  - 吸血 +64
  - 暴擊傷害 +385.3%
  - 生命值 +80.1%
  - 擊殺敵人時回復 4% 最大生命
  - 生命低於 35% 時，傷害 +30%
  - 造成的所有傷害 +15%
  - 傳奇特效【毒血祭】：血刃斬的中毒每感染 1 個敵人就使自身生命值 -0.5%，但造成的中毒與流血傷害提高 50%。
- 機制測試：
  - 野外每擊殺 1 隻回復 4% 最大生命（高塔沒有擊殺事件）
  - 自身生命 ≤ 35% 時傷害 +30%
  - 所有輸出傷害 ×(1+15%)：普攻、技能、觸發傷害、持續傷害一起變化
  - 借用傳奇特效【毒血祭】`bloodVenomRite`：照 L022 的步驟驗證（技能傳奇，需裝配 血刃斬）
- 邊界：借用的【毒血祭】需裝配血刃斬才有感；高塔無擊殺事件
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；條件式增傷收斂在 `rwOutgoingMultiplier`（併入 `legendaryOutgoingDamageMultiplier`）；擊殺掛勾 `rwOnKill`（只有野外）

#### W46 `rw_reincarnation`｜輪迴

- 配方（依序）：命運 `r28` → 輪迴 `r29` → 永恆 `r30` → 創生 `r32`（4 孔）｜適用：胸甲
- 測試裝備：`equip 10 100 chest`（最低品質 混沌（`10`））→ 穿上 → `runeword rw_reincarnation`
- 預期（裝備詳情的效果行）：
  - 生命值 +106.8%
  - 物理防禦 +91.5%
  - 魔法防禦 +91.5%
  - 死亡時以 30% 生命復活並淨化，無敵 3 秒，所有技能冷卻重置，之後 10 秒內傷害 +30%，冷卻 180 秒
  - 傳奇特效【堅韌誓言】：反擊 200 次後獲得無敵狀態，持續 3 秒。
- 機制測試：
  - 致死時復活：生命 30%、法力回滿、淨化、無敵 3 秒、全傷害 +30% 10 秒、所有冷卻重置；冷卻 180 秒，**進出高塔不重置**；野外與封魔塔都要測（塔戰致死不判負）
  - 借用傳奇特效【堅韌誓言】`counterOath`：照 L031 的步驟驗證（技能傳奇，需裝配 反擊）
- 邊界：借用的【堅韌誓言】需裝配反擊；復活冷卻跨戰鬥保留
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；條件式增傷收斂在 `rwOutgoingMultiplier`（併入 `legendaryOutgoingDamageMultiplier`）；死亡攔截 `rwTryRevive`（野外 `js/combat.js`、高塔 `js/tower.js` 兩個入口）

#### W47 `rw_timeloop`｜時之沙

- 配方（依序）：虛空 `r26` → 輪迴 `r29` → 永恆 `r30`（3 孔）｜適用：項鍊
- 測試裝備：`equip 7 100 amulet`（最低品質 創世（`7`））→ 穿上 → `runeword rw_timeloop`
- 預期（裝備詳情的效果行）：
  - 冷卻縮減 +3.6%
  - 法力恢復/秒 +14
  - 魔法攻擊 +34.3%
  - 所有技能冷卻時間 -22.5%（乘算，突破冷卻縮減上限）
  - 最大生命 -20%（乘算，代價）
  - 施放技能時有 25% 機率：免費再施放一次剛施放的技能
  - 傳奇特效【天譴之誓】：每 6 秒隨機讓 1 個冷卻中的技能立即冷卻完畢，且該技能下一次施放的傷害提高 50%。
- 機制測試：
  - 技能冷卻 ×(1−22.5%)，可突破冷卻縮減上限；多組相加，最低 ×0.2
  - 最大生命 -20%（屬性面板；代價，不隨稀有度放大）
  - 觸發「施放技能時（免費施放不再觸發，不會無限連鎖）」（25% 機率）：免費再施放一次剛放的技能（不扣法力、不再觸發施放事件）
  - 借用傳奇特效【天譴之誓】`heavenlyVow`：照 L126 的步驟驗證（符文真言專屬）
- 邊界：借用的【天譴之誓】與自身的重施放可能在同一次施放後連續出現；免費施放不再觸發施放事件（巢狀上限 3），不得無限連鎖
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；冷卻乘區 `rwCooldownFactor`（`js/skills2.js` 冷卻計算）；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

#### W48 `rw_bloodmoon`｜血月

- 配方（依序）：夜幕 `r16` → 熔岩 `r23` → 雷霆 `r25` → 命運 `r28`（4 孔）｜適用：主手／雙手武器
- 測試裝備：`equip 10 100 sword1h`（最低品質 混沌（`10`））→ 穿上 → `runeword rw_bloodmoon`
- 預期（裝備詳情的效果行）：
  - 物理攻擊 +68.7%
  - 魔法攻擊 +68.7%
  - 暴擊傷害 +256.9%
  - 吸血 +29
  - 造成的所有傷害 +30%
  - 代價：每秒損失 2% 最大生命（不會致死）
  - 擊殺敵人時回復 4% 最大生命
  - 最大生命 -30%（乘算，代價）
  - 傳奇特效【末日預言者】：沒有生命護盾時傷害提高 50%；生命值每降低 10%，傷害再提高 10%。
- 機制測試：
  - 所有輸出傷害 ×(1+30%)：普攻、技能、觸發傷害、持續傷害一起變化
  - 每秒損失最大生命的 2%，不會因此死亡（最低 1）；倒地、復甦期間暫停；`HP_lock` 時不扣
  - 野外每擊殺 1 隻回復 4% 最大生命（高塔沒有擊殺事件）
  - 最大生命 -30%（屬性面板；代價，不隨稀有度放大）
  - 借用傳奇特效【末日預言者】`doomProphet`：照 L119 的步驟驗證（符文真言專屬）
- 邊界：高塔無擊殺事件
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；條件式增傷收斂在 `rwOutgoingMultiplier`（併入 `legendaryOutgoingDamageMultiplier`）；擊殺掛勾 `rwOnKill`（只有野外）；每 tick 自損在 `rwTick`

#### W49 `rw_arsenal`｜武庫

- 配方（依序）：嵐 `r20` → 虛空 `r26` → 星辰 `r27`（3 孔）｜適用：主手／雙手武器
- 測試裝備：`equip 7 100 sword1h`（最低品質 創世（`7`））→ 穿上 → `runeword rw_arsenal`
- 預期（裝備詳情的效果行）：
  - 攻擊速度 +18.9%
  - 物理攻擊 +34.3%
  - 魔法攻擊 +34.3%
  - 技能傷害 +20%
  - 每 4 次普通攻擊命中：免費施放一個隨機的已裝配技能
  - 施放技能時有 15% 機率：免費再施放一次剛施放的技能
  - 傳奇特效【分裂者】：飛刀殺死敵人時會分裂出 2 把小型飛刀，每把造成 50% 傷害，且可彈射 2 次。
- 機制測試：
  - 技能傷害 +20%（乘算），普攻不變
  - 觸發「普攻命中時」（每第 4 次）：免費施放 1 個技能列上可施放的主動新版技能（技能列沒有主動技能時不作用）
  - 觸發「施放技能時（免費施放不再觸發，不會無限連鎖）」（15% 機率）：免費再施放一次剛放的技能（不扣法力、不再觸發施放事件）
  - 借用傳奇特效【分裂者】`knifeSplitter`：照 L002 的步驟驗證（技能傳奇，需裝配 飛刀）
- 邊界：借用的【分裂者】需裝配飛刀；每 4 下普攻免費施放與施放時 15% 重施放可能同時出現；免費施放不再觸發施放事件（巢狀上限 3），不得無限連鎖
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；條件式增傷收斂在 `rwOutgoingMultiplier`（併入 `legendaryOutgoingDamageMultiplier`）；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

#### W50 `rw_thunderemperor`｜雷帝

- 配方（依序）：雷霆 `r25` → 雷鳴 `r07` → 虛空 `r26` → 創生 `r32`（4 孔）｜適用：施法類武器／副手
- 測試裝備：`equip 10 100 wand1h`（最低品質 混沌（`10`））→ 穿上 → `runeword rw_thunderemperor`
- 預期（裝備詳情的效果行）：
  - 魔法攻擊 +68.7%
  - 雷屬性傷害提升 +60.2%
  - 暴擊率 +13%
  - 對暈眩或緩速中的敵人傷害 +5%
  - 每 3 秒：對隨機 3 名敵人造成 60% 雷電傷害
  - 普通攻擊暴擊時：所有敵人暈眩 1 秒
  - 傳奇特效【雷霆之震】：受到傷害時有 20% 機率對攻擊你的敵人反射 200% 雷電傷害。
- 機制測試：
  - 目標暈眩或緩速中時傷害 +5%
  - 觸發「每隔固定秒數」（每 3 秒）：造成 60% 雷屬性傷害（對象：隨機 3 個；走完整傷害管線，吃抗性與爆擊）
  - 觸發「普攻暴擊時」：暈眩全部敵人 1 秒（BOSS 控制免疫照規則；搭配【崩山裂地者】會延長）
  - 借用傳奇特效【雷霆之震】`thunderShock`：照 L122 的步驟驗證（符文真言專屬）
- 邊界：見本節開頭的成形邊界
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；條件式增傷收斂在 `rwOutgoingMultiplier`（併入 `legendaryOutgoingDamageMultiplier`）；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

#### W51 `rw_lonewolf`｜孤狼

- 配方（依序）：蒼穹 `r21` → 雷霆 `r25` → 星辰 `r27`（3 孔）｜適用：主手／雙手武器
- 測試裝備：`equip 7 100 sword1h`（最低品質 創世（`7`））→ 穿上 → `runeword rw_lonewolf`
- 預期（裝備詳情的效果行）：
  - 暴擊傷害 +149.9%
  - 物理攻擊 +34.3%
  - 對BOSS傷害 +33.3%
  - 場上只有一名敵人時，傷害 +40%
  - 對生命高於 70% 的敵人傷害 +20%
  - 所有技能冷卻時間 -7.5%（乘算，突破冷卻縮減上限）
  - 傳奇特效【貫日之刺】：突刺有 25% 機率使敵人重傷，使其受到的傷害 +20%，持續 5 秒。
- 機制測試：
  - 場上只剩 1 隻敵人時傷害 +40%（`spawn 1 boss 1000` 有、`spawn 8` 沒有；高塔 BOSS 戰恆成立）
  - 目標生命 > 70% 時傷害 +20%（滿血木樁有、打到 70% 以下消失）
  - 技能冷卻 ×(1−7.5%)，可突破冷卻縮減上限；多組相加，最低 ×0.2
  - 借用傳奇特效【貫日之刺】`sunpiercerLance`：照 L008 的步驟驗證（技能傳奇，需裝配 突刺）
- 邊界：借用的【貫日之刺】需裝配突刺
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；條件式增傷收斂在 `rwOutgoingMultiplier`（併入 `legendaryOutgoingDamageMultiplier`）；冷卻乘區 `rwCooldownFactor`（`js/skills2.js` 冷卻計算）

#### W52 `rw_starfall`｜星墜

- 配方（依序）：虛空 `r26` → 冰魄 `r24` → 星辰 `r27` → 輪迴 `r29`（4 孔）｜適用：雙手法杖（只能放在雙手武器）
- 測試裝備：`equip 7 100 staff2h`（最低品質 創世（`7`），雙手武器）→ 穿上 → `runeword rw_starfall`
- 預期（裝備詳情的效果行）：
  - 魔法攻擊 +40.1%
  - 火屬性傷害提升 +21.5%
  - 冰屬性傷害提升 +21.5%
  - 魔法穿透 +14.1%
  - 每 3 秒：對隨機 5 名敵人造成 75% 隨機元素傷害
  - 傳奇特效【神落天殞】：隕石類技能傷害 +25%。
- 機制測試：
  - 觸發「每隔固定秒數」（每 3 秒）：造成 75% 隨機屬性傷害（對象：隨機 5 個；走完整傷害管線，吃抗性與爆擊）
  - 借用傳奇特效【神落天殞】`godfallMeteor`：照 L127 的步驟驗證（符文真言專屬）
- 邊界：只限雙手法杖
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

#### W53 `rw_chaoslord`｜混沌之主

- 配方（依序）：虛空 `r26` → 永恆 `r30` → 混沌 `r31`（3 孔）｜適用：戒指／項鍊
- 測試裝備：`equip 7 100 ring`（最低品質 創世（`7`））→ 穿上 → `runeword rw_chaoslord`
- 預期（裝備詳情的效果行）：
  - 全屬性抗性 +94.5%
  - 幸運值 +240
  - 暴擊率 +9.7%
  - 技能傷害 +12.5%
  - 施放技能時：隨機獲得一種增益（攻擊／攻速／爆傷／防禦／閃避／所有傷害，8 秒）
  - 傳奇特效【腐化】：在泥沼術範圍內所有受到控場的敵人，受到的傷害 +20%。
- 機制測試：
  - 技能傷害 +12.5%（乘算），普攻不變
  - 觸發「施放技能時（免費施放不再觸發，不會無限連鎖）」：從 6 種增益隨機獲得 1 種、8 秒（atkUp 25／aspdUp 25／critDmgUp 60／defUp 40／evasionUp 30／allDmgUp 20）
  - 借用傳奇特效【腐化】`mireCorrupt`：照 L063 的步驟驗證（技能傳奇，需裝配 泥沼術）
- 邊界：借用的【腐化】需裝配泥沼術；每次施放都換一個隨機增益
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；條件式增傷收斂在 `rwOutgoingMultiplier`（併入 `legendaryOutgoingDamageMultiplier`）；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

#### W54 `rw_dragonslayer`｜屠龍者

- 配方（依序）：星辰 `r27` → 永恆 `r30` → 混沌 `r31`（3 孔）｜適用：雙手武器（只能放在雙手武器）
- 測試裝備：`equip 6 100 axe2h`（最低品質 神話（`6`），雙手武器）→ 穿上 → `runeword rw_dragonslayer`
- 預期（裝備詳情的效果行）：
  - 物理攻擊 +23.2%
  - 對BOSS傷害 +38.7%
  - 暴擊傷害 +87%
  - 物理穿透 +15.3%
  - 對生命高於 70% 的敵人傷害 +25%
  - 造成的所有傷害 +12.5%
  - 普通攻擊暴擊時有 20% 機率：對目標造成 125% 物理傷害
  - 傳奇特效【斬殺】：疾風斬有 20% 機率可立即殺死生命值 10% 以下的非 BOSS 敵人。
- 機制測試：
  - 目標生命 > 70% 時傷害 +25%（滿血木樁有、打到 70% 以下消失）
  - 所有輸出傷害 ×(1+12.5%)：普攻、技能、觸發傷害、持續傷害一起變化
  - 觸發「普攻暴擊時」（20% 機率）：造成 125% 物理傷害（對象：當前目標；走完整傷害管線，吃抗性與爆擊）
  - 借用傳奇特效【斬殺】`galeExecute`：照 L017 的步驟驗證（技能傳奇，需裝配 疾風迅雷）
- 邊界：借用的【斬殺】需裝配疾風迅雷
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；條件式增傷收斂在 `rwOutgoingMultiplier`（併入 `legendaryOutgoingDamageMultiplier`）；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

#### W55 `rw_immortalbody`｜不朽之軀

- 配方（依序）：永恆 `r30` → 終焉 `r33` → 輪迴 `r29` → 創生 `r32`（4 孔）｜適用：防具
- 測試裝備：`equip 10 100 chest`（最低品質 混沌（`10`））→ 穿上 → `runeword rw_immortalbody`
- 預期（裝備詳情的效果行）：
  - 生命值 +133.4%
  - 全局減傷 +616
  - 全屬性抗性 +189%
  - 單次受到的傷害最多只會是最大生命的 15%
  - 造成的所有傷害 -20%
  - 生命低於 40% 時：獲得相當於 20% 最大生命的護盾（6 秒），無敵 2 秒（內建冷卻 60 秒）
  - 傳奇特效【不屈護衛】：格擋減傷率額外 +5%，且可突破格擋減傷率的上限。
- 機制測試：
  - 單次受到的傷害不超過最大生命的 15%（用 `elite 1 all 3 1` 高傷敵人驗證；多組時取最嚴格者）
  - 所有輸出傷害 ×(1-20%)（代價）：普攻、技能、觸發傷害、持續傷害一起變化
  - 觸發「生命低於門檻時」（生命 < 40%、冷卻 60 秒）：獲得 20% 最大生命的護盾、6 秒；無敵 2 秒（狀態列無敵圖示、受擊不扣血）
  - 借用傳奇特效【不屈護衛】`unyieldingGuard`：照 L121 的步驟驗證（符文真言專屬）
- 邊界：單次傷害上限 15% 與低血護盾＋無敵可同時發生；冷卻內不再觸發
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；條件式增傷收斂在 `rwOutgoingMultiplier`（併入 `legendaryOutgoingDamageMultiplier`）；單次受傷上限經 `rwMaxHitPct` 進 `resolveHit`；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

#### W56 `rw_legion`｜萬軍

- 配方（依序）：嵐 `r20` → 虛空 `r26` → 命運 `r28` → 永恆 `r30`（4 孔）｜適用：雙手大劍、雙手斧（只能放在雙手武器）
- 測試裝備：`equip 7 100 greatsword2h`（最低品質 創世（`7`），雙手武器）→ 穿上 → `runeword rw_legion`
- 預期（裝備詳情的效果行）：
  - 物理攻擊 +34.3%
  - 攻擊速度 +18.9%
  - 範圍傷害 +4.8%
  - 普通攻擊同時對其他所有敵人造成 25% 的傷害
  - 場上每多一名敵人，傷害 +3%（最多計 10 名）
  - 傳奇特效【狂暴血斧】：擊殺敵人時獲得「狂暴」：攻速與攻擊提高 3%，持續 6 秒，最多疊加 20 層。
- 機制測試：
  - 普攻命中時，對**其他所有**敵人造成該次普攻傷害 25% 的直接傷害（不再走防禦，來源「符文真言·擴散」）
  - 每多 1 隻敵人傷害 +3%，最多算 10 隻（+30%）
  - 借用傳奇特效【狂暴血斧】`berserkBloodAxe`：照 L120 的步驟驗證（符文真言專屬）
- 邊界：只限雙手大劍／雙手斧
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；條件式增傷收斂在 `rwOutgoingMultiplier`（併入 `legendaryOutgoingDamageMultiplier`）

#### W57 `rw_bladedancer`｜劍舞者

- 配方（依序）：驚蟄 `r19` → 冰魄 `r24` → 虛空 `r26`（3 孔）｜適用：雙手武器（只能放在雙手武器）
- 測試裝備：`equip 6 100 axe2h`（最低品質 神話（`6`），雙手武器）→ 穿上 → `runeword rw_bladedancer`
- 預期（裝備詳情的效果行）：
  - 攻擊速度 +15.4%
  - 暴擊率 +7.9%
  - 物理攻擊 +27.9%
  - 攻擊速度額外乘算 +7.5%（突破攻速上限）
  - 傳奇特效【影襲追蹤者】：每隔 12 秒自動向敵人射出 3 枚飛刀，每枚造成 150% 物理傷害；飛刀技能傷害 +25%。
- 機制測試：
  - 攻速乘算 ×(1+7.5%)，可突破攻速上限：先 `maxstats`，鑲入後面板攻速仍上升
  - 借用傳奇特效【影襲追蹤者】`shadowTracker`：照 L117 的步驟驗證（符文真言專屬）
- 邊界：見本節開頭的成形邊界
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；攻速乘區 `rwAttackSpeedMultiplier`（經 `legendaryAttackSpeedMultiplier`）

#### W58 `rw_voidwalker`｜虛空行者

- 配方（依序）：虛空 `r26` → 命運 `r28` → 輪迴 `r29`（3 孔）｜適用：靴子
- 測試裝備：`equip 7 100 boots`（最低品質 創世（`7`））→ 穿上 → `runeword rw_voidwalker`
- 預期（裝備詳情的效果行）：
  - 閃避率 +22.9%
  - 命中率 +28.6%
  - 生命值 +40%
  - 造成的所有傷害 +12.5%
  - 受到傷害時有 30% 機率：無敵 1.5 秒，對所有敵人造成 75% 暗影傷害（內建冷卻 4 秒）
  - 傳奇特效【斷空刃】：暴風真空刃每個方向改為連續射出 3 道風刃，且風刃傷害額外 +30%。
- 機制測試：
  - 所有輸出傷害 ×(1+12.5%)：普攻、技能、觸發傷害、持續傷害一起變化
  - 觸發「受到生命傷害時」（30% 機率、冷卻 4 秒）：無敵 1.5 秒（狀態列無敵圖示、受擊不扣血）；造成 75% 暗屬性傷害（對象：全部敵人；走完整傷害管線，吃抗性與爆擊）
  - 借用傳奇特效【斷空刃】`windbladeVoidCut`：照 L105 的步驟驗證（技能傳奇，需裝配 風刃）
- 邊界：借用的【斷空刃】需裝配風刃（第 7 階）；冷卻內不再觸發
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；條件式增傷收斂在 `rwOutgoingMultiplier`（併入 `legendaryOutgoingDamageMultiplier`）；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

#### W59 `rw_genesis`｜創世紀

- 配方（依序）：永恆 `r30` → 混沌 `r31` → 創生 `r32` → 終焉 `r33`（4 孔）｜適用：任何裝備
- 測試裝備：`equip 10 100 sword1h`（最低品質 混沌（`10`））→ 穿上 → `runeword rw_genesis`
- 預期（裝備詳情的效果行）：
  - 物理攻擊 +68.7%
  - 魔法攻擊 +68.7%
  - 全屬性傷害提升 +25.8%
  - 造成的所有傷害 +25%
  - 所有技能冷卻時間 -10%（乘算，突破冷卻縮減上限）
  - 攻擊速度額外乘算 +7.5%（突破攻速上限）
  - 技能法力消耗 -15%
  - 傳奇特效【元素之心】：所有元素抗性 -50%，但所有屬性傷害加成額外提高 35%。
- 機制測試：
  - 所有輸出傷害 ×(1+25%)：普攻、技能、觸發傷害、持續傷害一起變化
  - 技能冷卻 ×(1−10%)，可突破冷卻縮減上限；多組相加，最低 ×0.2
  - 攻速乘算 ×(1+7.5%)，可突破攻速上限：先 `maxstats`，鑲入後面板攻速仍上升
  - 技能法力消耗 ×(1−15%)（看法力條扣量；技能列顯示仍是基礎值，已知限制）
  - 借用傳奇特效【元素之心】`elementHeart`：照 L129 的步驟驗證（符文真言專屬）
- 邊界：適用任何裝備；元素抗性減半是代價
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；條件式增傷收斂在 `rwOutgoingMultiplier`（併入 `legendaryOutgoingDamageMultiplier`）；攻速乘區 `rwAttackSpeedMultiplier`（經 `legendaryAttackSpeedMultiplier`）；冷卻乘區 `rwCooldownFactor`（`js/skills2.js` 冷卻計算）；法力乘區 `rwManaCostFactor`（`js/skills.js`、`js/skills2.js` 多處扣法力）

#### W60 `rw_worldend`｜滅世

- 配方（依序）：熔岩 `r23` → 虛空 `r26` → 命運 `r28` → 永恆 `r30` → 混沌 `r31`（5 孔）｜適用：雙手武器（只能放在雙手武器）
- 測試裝備：`equip 10 100 axe2h`（最低品質 混沌（`10`），雙手武器）→ 穿上 → `runeword rw_worldend`
- 預期（裝備詳情的效果行）：
  - 物理攻擊 +80.1%
  - 暴擊傷害 +299.7%
  - 對BOSS傷害 +66.7%
  - 範圍傷害 +9.6%
  - 造成的所有傷害 +9%
  - 普通攻擊同時對其他所有敵人造成 7.5% 的傷害
  - 普通攻擊暴擊時有 10% 機率：對所有敵人造成 125% 物理傷害
  - 傳奇特效【亡者時間】：範圍 40 米內的敵人死亡，都會使你的物理技能冷卻時間 -0.05 秒。
- 機制測試：
  - 所有輸出傷害 ×(1+9%)：普攻、技能、觸發傷害、持續傷害一起變化
  - 普攻命中時，對**其他所有**敵人造成該次普攻傷害 7.5% 的直接傷害（不再走防禦，來源「符文真言·擴散」）
  - 觸發「普攻暴擊時」（10% 機率）：造成 125% 物理傷害（對象：全部敵人；走完整傷害管線，吃抗性與爆擊）
  - 借用傳奇特效【亡者時間】`deadTime`：照 L130 的步驟驗證（符文真言專屬）
- 邊界：見本節開頭的成形邊界
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；條件式增傷收斂在 `rwOutgoingMultiplier`（併入 `legendaryOutgoingDamageMultiplier`）；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

#### W61 `rw_stargate`｜星門

- 配方（依序）：嵐 `r20` → 雷霆 `r25` → 星辰 `r27` → 輪迴 `r29` → 永恆 `r30`（5 孔）｜適用：雙手法杖（只能放在雙手武器）
- 測試裝備：`equip 10 100 staff2h`（最低品質 混沌（`10`），雙手武器）→ 穿上 → `runeword rw_stargate`
- 預期（裝備詳情的效果行）：
  - 魔法攻擊 +114.4%
  - 雷屬性傷害提升 +43%
  - 風屬性傷害提升 +43%
  - 冷卻縮減 +5%
  - 魔法穿透 +28.2%
  - 所有技能冷卻時間 -12.5%（乘算，突破冷卻縮減上限）
  - 技能傷害 +20%
  - 施放技能時有 20% 機率：免費再施放一次剛施放的技能
  - 傳奇特效【雷紋刻印】：雷電技能命中時有 10% 機率留下雷紋刻印，使敵人受到的雷電傷害提高 35%，持續 6 秒。
- 機制測試：
  - 技能冷卻 ×(1−12.5%)，可突破冷卻縮減上限；多組相加，最低 ×0.2
  - 技能傷害 +20%（乘算），普攻不變
  - 觸發「施放技能時（免費施放不再觸發，不會無限連鎖）」（20% 機率）：免費再施放一次剛放的技能（不扣法力、不再觸發施放事件）
  - 借用傳奇特效【雷紋刻印】`thunderMark`：照 L124 的步驟驗證（符文真言專屬）
- 邊界：只限雙手法杖；免費施放不再觸發施放事件（巢狀上限 3），不得無限連鎖
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；條件式增傷收斂在 `rwOutgoingMultiplier`（併入 `legendaryOutgoingDamageMultiplier`）；冷卻乘區 `rwCooldownFactor`（`js/skills2.js` 冷卻計算）；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

#### W62 `rw_divinewrath`｜神罰

- 配方（依序）：蒼穹 `r21` → 冰魄 `r24` → 輪迴 `r29` → 混沌 `r31` → 終焉 `r33`（5 孔）｜適用：雙手武器（只能放在雙手武器）
- 測試裝備：`equip 10 100 axe2h`（最低品質 混沌（`10`），雙手武器）→ 穿上 → `runeword rw_divinewrath`
- 預期（裝備詳情的效果行）：
  - 物理攻擊 +68.7%
  - 對BOSS傷害 +95.2%
  - 聖屬性傷害提升 +51.6%
  - 暴擊率 +13%
  - 天罰 10%
  - 對生命高於 70% 的敵人傷害 +20%
  - 普通攻擊暴擊時有 15% 機率：對目標造成 175% 聖光傷害
  - 傳奇特效【狩獵者】：你的火狩數量減半（無條件進位，至少 1 團），但造成的傷害額外 +150%。
- 機制測試：
  - 目標生命 > 70% 時傷害 +20%（滿血木樁有、打到 70% 以下消失）
  - 被動「天罰」10%：普攻命中有 10% 機率追加 250% 物攻的直接傷害（落雷外觀，來源「天罰」）
  - 觸發「普攻暴擊時」（15% 機率）：造成 175% 聖屬性傷害（對象：當前目標；走完整傷害管線，吃抗性與爆擊）
  - 借用傳奇特效【狩獵者】`firehuntHunter`：照 L055 的步驟驗證（技能傳奇，需裝配 火狩）
- 邊界：借用的【狩獵者】需裝配火狩
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；條件式增傷收斂在 `rwOutgoingMultiplier`（併入 `legendaryOutgoingDamageMultiplier`）；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

#### W63 `rw_permafrost`｜永凍

- 配方（依序）：寒月 `r18` → 冰魄 `r24` → 永恆 `r30`（3 孔）｜適用：施法類武器／副手
- 測試裝備：`equip 7 100 wand1h`（最低品質 創世（`7`））→ 穿上 → `runeword rw_permafrost`
- 預期（裝備詳情的效果行）：
  - 魔法攻擊 +51.5%
  - 冰屬性傷害提升 +43%
  - 冷卻縮減 +2.2%
  - 對暈眩或緩速中的敵人傷害 +22.5%
  - 普通攻擊命中時有 15% 機率：目標暈眩 1.5 秒
  - 傳奇特效【崩山裂地者】：當你對敵人造成暈眩或緩速效果時，該效果持續時間 +100%，且對處於該狀態的敵人造成的傷害提高 300%。
- 機制測試：
  - 目標暈眩或緩速中時傷害 +22.5%
  - 觸發「普攻命中時」（15% 機率）：暈眩目標 1.5 秒（BOSS 控制免疫照規則；搭配【崩山裂地者】會延長）
  - 借用傳奇特效【崩山裂地者】`mountainSunderer`：照 L116 的步驟驗證（符文真言專屬）
- 邊界：見本節開頭的成形邊界
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；條件式增傷收斂在 `rwOutgoingMultiplier`（併入 `legendaryOutgoingDamageMultiplier`）；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

#### W64 `rw_glacier`｜冰川

- 配方（依序）：霜痕 `r03` → 雷霆 `r25` → 命運 `r28`（3 孔）｜適用：施法類武器／副手
- 測試裝備：`equip 7 100 wand1h`（最低品質 創世（`7`））→ 穿上 → `runeword rw_glacier`
- 預期（裝備詳情的效果行）：
  - 魔法攻擊 +40.1%
  - 冰屬性傷害提升 +25.8%
  - 暴擊傷害 +128.4%
  - 對BOSS傷害 +28.6%
  - 對生命高於 70% 的敵人傷害 +20%
  - 對暈眩或緩速中的敵人傷害 +10%
  - 普通攻擊暴擊時有 25% 機率：對目標造成 100% 冰霜傷害
  - 傳奇特效【冰霜尖刺】：寒冰技能命中時有 10% 機率產生冰爆，對敵人造成 200% 寒冰傷害。
- 機制測試：
  - 目標生命 > 70% 時傷害 +20%（滿血木樁有、打到 70% 以下消失）
  - 目標暈眩或緩速中時傷害 +10%
  - 觸發「普攻暴擊時」（25% 機率）：造成 100% 冰屬性傷害（對象：當前目標；走完整傷害管線，吃抗性與爆擊）
  - 借用傳奇特效【冰霜尖刺】`iceSpikeBurst`：照 L125 的步驟驗證（符文真言專屬）
- 邊界：見本節開頭的成形邊界
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）；條件式增傷收斂在 `rwOutgoingMultiplier`（併入 `legendaryOutgoingDamageMultiplier`）；觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）

#### W65 `rw_smith`｜鐵匠之魂

- 配方（依序）：餘燼 `r02` → 鋼魄 `r11` → 熔岩 `r23` → 永恆 `r30`（4 孔）｜適用：項鍊
- 測試裝備：`equip 10 100 amulet`（最低品質 混沌（`10`））→ 穿上 → `runeword rw_smith`
- 預期（裝備詳情的效果行）：
  - 寶石鑲嵌效率 +99.2%
  - 詞條上限率 +58%
  - 強化成功率 +41.4%
  - 傳奇特效【燃燒法則】：燃燒持續傷害每次作用時有 25% 機率將剩餘的作用次數立即用盡，且燃燒傷害提高 30%。
- 機制測試：
  - 借用傳奇特效【燃燒法則】`burningLaw`：照 L123 的步驟驗證（符文真言專屬）
- 邊界：沒有屬性條目以外的機制，只有借用的【燃燒法則】
- 回歸風險：屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）

## 5. 已知差異與待確認（測到時請標註「已知」，不要當成新 Bug 重複開）

| 編號 | 項目 | 說明 |
| --- | --- | --- |
| K1 | 停用／專屬特效在舊裝備上的顯示（**已修正** 2026-11-06） | 原本 `js/item.js` 的裝備詳情只對「同名重覆」加「(重覆)」灰字，停用與符文真言專屬的詞條照一般傳奇特效顯示，畫面看不出它不生效（違反 AI_RULES 8.3）。已修正：裝備詳情（含神鑄烙印的傳奇特效）對停用的顯示灰字＋「(已停用)」、對符文真言專屬的顯示灰字＋「(僅符文真言生效)」（`passiveInactiveNote`，String 表 2419／2420）。回歸：`legend deadTime weapon force`、`legend ghostLamp weapon force` 後看裝備詳情；一般特效與「(重覆)」顯示不變 |
| K2 | 特效說明與技能階名稱不一致 | 雙刀亂舞的【狂舞】【不屈之誓】【殺千刀】寫「暴風之舞」，第 7 階實際名稱是【暴風亂舞】；疾風迅雷的 5 個特效寫「疾風斬」（GM 文件也這樣稱呼）；火球術／雷球特效寫「殞石」「雷殞天落」，技能階是「隕石術」「雷隕天落」。只是文字，請列出確認 |
| K3 | 【雷散落】的「電殛擴散」 | 擴散數值讀第 5 階【靜電】（`lvs[4]`），第 6 階才叫【電殛】；請確認說明要寫哪一階 |
| K4 | 【燃燒法則】以狀態名稱比對 | `legendaryBurnDot` 以持續傷害名稱字面值「燃燒」判定；若 Status 表改名，特效會靜默失效。測試時確認燃燒狀態名稱仍為「燃燒」 |
| K5 | 高塔沒有擊殺事件 | 狂暴血斧、亡者時間、擊殺回復、kill 觸發在高塔不作用（設計如此，`docs/RUNEWORD_DESIGN.md` 第 7 節） |
| K6 | 法力消耗顯示 | 符文真言的法力消耗降低只影響實際扣除；技能列顯示仍是基礎值（已知限制） |

## 6. 報告格式

`docs/LEGENDARY_RUNEWORD_TEST_REPORT.md`：

1. 環境：分支與 commit、瀏覽器、測試存檔來源、`--check` 結果與第 0 節三種核對的實際數字。
2. 總表：每個條目一列（L001～L144、W01～W65），欄位＝編號｜key／id｜結果（通過／失敗／無法測／已知 K#）｜觸發樣本數｜截圖檔名｜備註。
3. 失敗明細：編號、重現步驟（含 GM 指令）、預期、實際、截圖、Console 訊息。
4. 共通檢查 C1～C10 的結果與抽測了哪些條目。
