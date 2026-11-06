# 傳奇特效與符文真言回歸測試報告

> 測試規格依據：`docs/ANTIGRAVITY_LEGENDARY_RUNEWORD_TEST_CASES.md`
> 測試模式：唯讀驗證（僅記錄問題，不改動遊戲主程式碼）

---

## 進度說明
- **當前進度**：已完成 **批次 1**（第 0 節三種核對＋第 1 節環境＋共通檢查 C1～C10）。
- **待測批次**：
  - 批次 2：L001～L070
  - 批次 3：L071～L144（含 L116～L135 專屬與停用規則）
  - 批次 4：W01～W65

---

## 1. 測試環境與前置核對

### 1.1 環境資訊
- **測試分支**：`ai/antigravity`（HEAD 包含 `d6008d6a`，當前 SHA：`7e509d631eec8d0e2c510f5f9da1ea95a112e724`，與 `ai/claude` 同步）
- **運行環境**：Node.js v22.18.0 / PowerShell 7 (Windows) / 本機 HTTP 服務 (`.claude/serve.ps1`，Port 8123)
- **戰場顯示**：Canvas 戰場（預設模式），音效靜音 `GameSettings.set('mute', true)`
- **測試存檔**：拋棄式測試存檔（以 GM 指令初始化：`level 600`、`equipset legendary 100 0 0 wear`、`legend clear all`、`god 1`）與 `docs/fixtures/` 相容性測試存檔

### 1.2 第 0 節三種核對（實際數字）
1. **測試文件與程式對應（`--check`）**：
   - 執行 `node tools/gen_legendary_runeword_test_cases.cjs --check`：輸出 `docs/ANTIGRAVITY_LEGENDARY_RUNEWORD_TEST_CASES.md 已是最新`（一致）。
   - 執行 `node --test tests/legendary-runeword-test-cases.test.cjs`：**3 項全部通過**（每個傳奇特效皆有測試註記、每組符文真言皆有註記、文件條目與程式 144+65 一一對應）。
2. **遊戲內 GM 指令核對**：
   - `legend list`：回傳 **144 個**
   - `legend list rwonly`：回傳 **15 個**
   - `legend list disabled`：回傳 **5 個**
   - `legend list general`：回傳 **9 個**
   - `legend list <群組id>`：23 群技能（knife, thrust, cleave, gale, bloodblade, dualdance, counter, bloodrage, fireball, firepillar, firehunt, rockarmor, mire, earthguard, chainlightning, thunderstrike, thunderorb, icearrow, waterball, frostnova, windblade, vacuumslash, stormbarrier）每群各 **5 個**（共 115 個）
   - `runeword list`：列出 **65 組** 符文真言
3. **配置表列數核對**：
   - `config/CSV/Equipment_Affix.csv` 第一欄為「傳奇特效」之列數：**151 列**（144 個傳奇特效＋7 個非傳奇被動）
   - `config/CSV/Runes.csv` 第一欄為「符文真言」之列數：**65 列**

---

## 2. 共通檢查 C1～C10 結果

| 編號 | 檢查項目 | 抽測條目 | 驗證結果 | 判定 |
| --- | --- | --- | --- | --- |
| **C1** | 主執行緒畫面與 Worker 結果一致 | L001 `knifeChain`、L006 `piercingFocus`、W01 `rw_firstcry` | 裝備詳情效果行數值與 Worker `computeStats` / `legendarySkill2Mods` 完全一致，無「畫面有戰鬥無」情形。 | **通過** |
| **C2** | 存讀檔後仍生效 | L014 `exploitWeakness`、W02 `rw_nightwatch`、L136 `bloodthirst` | 存檔儲存 `passive: { key }` 與孔位符文，重啟載入後 `computeRuneWords` 自動恢復真言，效果維持不變。 | **通過** |
| **C3** | 顯示文字走 String 表 | 全系統顯示文字檢驗 | 執行 `node tools/string-table/build_string_csv.cjs --check`，回報「程式中仍寫死的顯示文字：0 條」。 | **通過** |
| **C4** | 同名不生效 | `bloodthirst`（主手+戒指）、W49 `rw_arsenal` 搭配裝備同名 `knifeSplitter` | 先穿戴者生效，第二件裝備顯示「(重覆)」且變灰（`#6b7280`）；布林集合 `legendaryEffects` 僅生效一次。 | **通過** |
| **C5** | 符文真言專屬與停用規則 | 專屬 `deadTime` (L130)、`mountainSunderer` (L116)；停用 `ghostLamp` (L134)、`fireSpiritShield` (L131) | 未加 force 時 GM 拒絕；加 force 後裝備詳情顯示灰字＋「(僅符文真言生效)」或「(已停用)」（符合 K1 修復），戰鬥不生效。隨機裝備池完全排除此 20 項。 | **通過** |
| **C6** | Console 與效能 | L002 `knifeSplitter`、L005 `knifeWaltzblade`、W58 `rw_voidwalker` | 連續高頻觸發 ≥ 2 分鐘，無 Console 報錯，投射物與刀環生命週期結束正確銷毀，物件無累積洩漏。 | **通過** |
| **C7** | 野外與封魔塔 | L006、L011、L041、W01、W15、W44；擊殺類 L002、L130、W49 | 封魔塔挑戰中屬性與真言正常生效；擊殺類因封魔塔無小怪故不觸發，符合 K5 已知規格設計。 | **通過** |
| **C8** | 換裝與換技能即時生效 | L001 `knifeChain`（移出技能列）、W01 `rw_firstcry`（卸裝/拔除符文） | 移出技能列後技能傳奇停止觸發；卸下裝備或拔下符文後真言即時瓦解，數值即刻重算。 | **通過** |
| **C9** | 舊存檔相容性 | `save_novice.json`、`save_midgame.json`、`save_lategame.json` | 舊存檔載入遷移均順利通過，舊裝備上的停用/專屬詞條保留但不生效，無錯誤發生。 | **通過** |
| **C10** | 雙手武器與修羅亂舞 | L011 `chainSpin`（主手雙手巨劍）、副手雙手武器搭配修羅亂舞 | 技能傳奇數值不因雙手武器而倍增（固定表定值）；副手雙手武器在未啟用修羅亂舞時傳奇特效不生效，啟用後正常生效。 | **通過** |

---

## 3. 回歸測試總表（共 209 條目）
*（條目將於批次 2～4 陸續更新填入）*

| 編號 | 條目 key / id | 測試結果 | 觸發樣本數 | 截圖檔名 | 備註說明 |
| :--- | :--- | :---: | :---: | :---: | :--- |
| *(待批次 2 填入 L001～L070)* | | | | | |

---

## 4. 失敗與異常明細
*（待後續批次填入）*
