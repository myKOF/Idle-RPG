# GM 指令集（僅限本機開發）

> 本文件供開發、測試與除錯使用。GM 功能不是正式遊戲功能，請勿把指令寫入攻略、教學或對外版本說明。

## 1. 使用前提與安全限制

GM 指令只會在以下 hostname 初始化：

- `localhost`
- `127.0.0.1`
- `::1`

在其他環境（例如正式網域、測試網域或任何外部 IP）中：

1. 不會建立 GM 輸入框。
2. 不會監聽 Enter 開啟 GM 面板。
3. 即使程式被外部呼叫，執行函式仍會再次檢查 hostname 並拒絕指令。

這是前端本機開發工具的環境防護，不等同於伺服器端權限系統；若未來遊戲改為連線制，仍必須在伺服器端重新驗證所有資源變更。

## 2. 開啟與操作方式

在本機開發環境中：

1. 按 `Enter`：左下角開啟 GM 輸入框，游標會自動放入輸入欄。
2. 輸入指令後按 `Enter`：執行指令。
3. 指令執行後，輸入框與原文字會保留；再次按 `Enter` 可重複執行同一指令。
4. 輸入框為空時按 `Enter`：關閉輸入框。
5. 按 `Esc`：直接關閉輸入框，文字仍會保留到下次開啟。
6. 輸入 `help`：顯示文件提示。

指令參數以空白分隔，不需要輸入括號或逗號。金幣與材料的數量可輸入正負整數；寶石、附魔書、裝備與零件等物品數量仍只能輸入正整數。所有數量都不能輸入小數或帶逗號的文字。

## 3. 貨幣與材料

### 增加或扣除金幣

```text
gold 數量
```

別名：`g 數量`

範例：

```text
gold 1000000
g 50000
gold -10000
```

輸入負數會扣除金幣；扣除後最低為 0，不會變成負數。

### 增加或扣除碎片、附魔精華、魔塵

```text
scrap 數量
essence 數量
dust 數量
```

範例：

```text
scrap 5000
essence 100
dust 20
dust -5
```

`scrap`、`essence`、`dust` 同樣支援負數扣除，扣除後最低為 0。

也可以使用統一材料格式：

```text
mat gold 數量
mat scrap 數量
mat essence 數量
mat dust 數量
```

`mat` 的數量也可輸入負數，例如 `mat essence -10`。

GM 發放只會增加資源，不會覆蓋原有數量。

### 新熔爐材料（測試版）

```text
nfmat 材料key 數量
nfmat all 數量
```

材料 key（不分大小寫，共 15 種，定義於 `js/data.js` `NEW_FORGE_MATERIALS`）：
`slag`（爐渣）、`ironShard`（碎鐵塊）、`silverShard`（碎銀）、`goldShard`（碎金塊）、
`mithrilShard`（秘銀碎片）、`thoriumShard`（瑟銀碎片）、`arcaniteShard`（奧金碎片）、
`magisteelShard`（魔鋼碎片）、`ironIngot`（鐵錠）、`silverIngot`（銀錠）、`goldIngot`（金錠）、
`mithril`（秘銀）、`thorium`（瑟銀）、`arcanite`（奧金）、`magisteel`（魔鋼）。

範例：

```text
nfmat mithril 50
nfmat all 500
nfmat slag -100
```

`all` 會對全部 15 種材料一起加減；支援負數扣除，扣除後最低為 0。

## 4. 寶石

### 指令格式

```text
gem 寶石key 等級 數量
```

等級可輸入 `1`～`10`，包含一般寶石與神鑄寶石。

目前寶石 key（每行左側是指令要輸入的 key，右側是遊戲中的中文名稱）：

```text
ruby       = 紅寶石
sapphire   = 藍寶石
topaz      = 黃玉
emerald    = 綠寶石
diamond    = 鑽石
lapis      = 青金石
amethyst   = 紫水晶
garnet     = 石榴石
opal       = 蛋白石
onyx       = 黑曜石
moonstone  = 月光石
sunstone   = 太陽石
jade       = 翡翠
turquoise  = 綠松石
agate      = 瑪瑙
pearl      = 珍珠
malachite  = 孔雀石
fluorite   = 螢石
```

範例：

```text
gem garnet 6 10
gem ruby 5 100
gem fluorite 10 1
```

## 5. 附魔書

### 指令格式

```text
book 附魔key 數量
```

可用附魔 key（請逐行查看 key 與中文名稱）：

```text
fire         = 火焰附魔
ice          = 冰凍附魔
lightning    = 閃電附魔
poison       = 毒液附魔
light        = 聖光附魔
dark         = 暗影附魔
fireRes      = 火焰抗性
iceRes       = 冰霜抗性
lightningRes = 雷電抗性
poisonRes    = 劇毒抗性
lightRes     = 聖光抗性
darkRes      = 暗影抗性
ctrlRes      = 控制抵抗
loot         = 尋寶附魔
haste        = 疾行附魔
vigor        = 活力附魔
clarity      = 澄明附魔
focus        = 專注附魔
fortune      = 財運附魔
wisdom       = 智慧附魔
```

範例：

```text
book fire 10
book fireRes 5
book loot 20
```

## 6. 裝備

### 指令格式

```text
equip 稀有度 等級 [部位] [數量]
```

稀有度可以輸入數字索引或英文 key：

| 數字 | key | 品質 |
|---:|---|---|
| 0 | `common` | 普通 |
| 1 | `uncommon` | 精良 |
| 2 | `rare` | 稀有 |
| 3 | `unique` | 獨特 |
| 4 | `epic` | 史詩 |
| 5 | `legendary` | 傳說 |
| 6 | `mythic` | 神話 |
| 7 | `genesis` | 創世 |
| 8 | `godforged` | 神鑄創世 |

可指定部位；省略部位時由遊戲隨機選擇。部位 key 對照如下：

```text
weapon   = 主武器
weapon2  = 副武器
helmet   = 頭盔
shoulder = 肩甲
chest    = 胸甲
belt     = 腰帶
gloves   = 護手
wrist    = 手腕
legs     = 護腿
boots    = 靴子
ring     = 戒指
ring2    = 戒指Ⅱ
amulet   = 項鍊
```

範例：

```text
equip legendary 100 weapon
equip 6 200 helmet 3
equip godforged 1000 ring 2
```

裝備會直接加入背包，不走一般背包滿載時的自動分解流程；因此測試時若超過背包容量，背包可能暫時超出容量，請自行整理。

## 7. 自動機組零件

### 指令格式

```text
part 階級 [節點] [數量]
```

階級為 `1`～`5`。節點可省略，或指定：

- `salvage`：分解槽
- `synth`：合成節點

範例：

```text
part 5 salvage 3
part 3 5
```

第二個範例省略節點，會依目前啟用的節點隨機產生零件。

目前合成節點已關閉，因此 `part 5 synth 1` 會被拒絕，不會產生合成節點零件；這是刻意與遊戲系統開關保持一致。

## 8. 玩家等級與經驗

### 設定玩家等級

```text
level 等級
```

別名：`lv 等級`

這是「直接設定」而不是增加等級。範例：

```text
level 1000
```

### 增加經驗值

```text
xp 數量
```

範例：

```text
xp 5000000
```

若增加經驗觸發升級，會沿用遊戲原本的升級流程。

## 9. 寶石商店

### 直接設定商店等級

```text
shop 等級
```

等級限制為 `1`～`20`。設定後會立即依新等級重新刷出商品，不會扣除升級金幣。

範例：

```text
shop 20
```

## 10. 立即存檔

```text
save
```

這會呼叫遊戲目前的存檔函式。一般情況下遊戲仍會依原本的自動存檔機制保存進度。

## 10.5 套用參數表（Excel → CSV → 遊戲，雙擊 .bat 自動重載）

在 `config/Excel/game_parameters.xlsx`（工作表 `game_parameters`）調整數值後：

1. 在 Excel 按**存檔**（Ctrl+S）。此時遊戲**不會**刷新；Excel 可繼續開著，不必關。
2. **雙擊專案根目錄的「套用參數.bat」**，它會依序：
   - **[1/2]** 把 `config/Excel/game_parameters.xlsx` 轉成 `config/CSV/game_parameters.csv`（純 Node 讀 xlsx，Excel 開著也能轉）。
   - **[2/2]** 把 CSV 數值寫進遊戲並更新重載權杖 `params_version.txt`。
3. 開著的遊戲頁面（本機）約 2 秒內會**自動重新整理**，新數值即生效，不必手動 F5 或按任何按鈕。

（舊的 `reload game_parameters` GM 文字指令、左上角按鈕與套用伺服器皆已移除，改用此單一雙擊流程。詳見 `tools/參數表使用說明.md`。）

## 10.6 高塔一鍵通關

以下指令會把高塔最高通關層推進到指定塔區的最後一層，方便測試後續內容；不會補發歷層通關獎勵。若目前正在高塔戰鬥中，指令會拒絕執行。

```text
tower_trial_clear
tower_hell_clear
tower_purgatory_clear
```

### 清除指定塔區的已挑戰標記

這三個指令會重設指定塔區的通關進度，但保留前一塔區的進度：

```text
tower_trial_reset
tower_hell_reset
tower_purgatory_reset
```

### 指定下一個可挑戰的高塔樓層

```text
tower_jump 樓層
```

例如 `tower_jump 101` 會把第 1～100 層視為已挑戰成功，下一個可挑戰樓層為第 101 層。樓層限制為 `1`～`150`。

## 10.7 任意切換轉生次數

```text
reincarnation 轉生次數
```

轉生次數可輸入 `0`～`10`。別名：`reincarnate`、`turn`。此指令只切換轉生次數，不重置等級、經驗或資源；會立即刷新天賦解鎖、技能上限與屬性。高塔戰鬥中不可執行。

範例：

```text
reincarnation 0
reincarnation 5
turn 10
```

## 11. 常用測試流程範例

### 測試高階寶石與神鑄

```text
gem garnet 6 10
gem garnet 7 6
dust 100
```

### 測試高品質裝備

```text
equip legendary 100 weapon 3
equip mythic 200 helmet 3
equip godforged 1000 ring
```

### 測試高塔生存能力

```text
level 1000
gold 100000000000
gem fluorite 10 20
gem malachite 10 20
```

### 測試商店高等級商品

```text
shop 20
```

## 12. 不支援的情況

- 金幣與材料接受負數，例如 `gold -100` 代表扣除 100 金幣；扣除後最低為 0。
- 寶石、附魔書、裝備與零件等需要指定 key、等級或部位的物品不接受負數；輸入負數只會顯示格式錯誤，不會改變物品數量。
- 不接受小數，例如 `gem ruby 6 1.5`。
- 不接受未知的寶石、附魔、稀有度、部位或節點 key。
- 不提供刪除資源、扣除資源或清空背包指令，避免測試時誤刪資料。
- 非本機 hostname 不會執行任何 GM 指令。
