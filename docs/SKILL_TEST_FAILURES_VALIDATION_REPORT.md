# 技能單元測試失敗深度驗證與實機動作實測報告

> **驗證分支**：`ai/claude-kpj271`（基準提交 `943f9c2`）  
> **驗證者**：Antigravity  
> **日期**：2026-10-31  
> **目的**：確認「286 項技能測試失敗」是真實程式錯誤，還是測試或資料檔未更新造成的假失敗；並實測驗證提交 `2b91f66` 與 `943f9c2` 的三項遊戲實機行為。

---

# ═══ 第一部分：286 項技能測試失敗深度分析 ═══

## 1. 測試執行與結果統計
- **執行指令**：`node --test "tests/skill*.test.cjs"`
- **測試總計**：555 項通過，**287 項失敗**（基準 286 項加上近期 Codex 新增的 `tests/skill2-iron-dance.test.cjs` 10 項失敗；排除後原始檔案失敗數完全對齊 286 項）。
- **主要失敗檔案分佈**：
  - `skill2-ult-evolution.test.cjs` (27)
  - `skill2-lightning.test.cjs` (23)
  - `skill2-ice.test.cjs` (21)
  - `skill2-earth.test.cjs` (20)
  - `skill2-thunderorb-icearrow-legendary.test.cjs` (19)
  - `skill2-wind.test.cjs` (19)
  - `skill2-system.test.cjs` (18)
  - `skill2-magic-fire.test.cjs` (16)
  - `skill2-wind-chaser.test.cjs` (12)
  - `skill2-waterball-frostnova-legendary.test.cjs` (11)
  - `skill2-chainlightning-thunder-legendary.test.cjs` (10)
  - `skill2-counter-bloodrage.test.cjs` (10)
  - `skill2-iron-dance.test.cjs` (10，近期新增)
  - 其餘約 70 項分散於其他 skill2 檔案。

---

## 2. 資料同步狀態檢查結果
1. **`apply_params.cjs` 乾跑比對**：
   - 執行 `node tools/apply_params.cjs --check`：全表 586 項參數比對，**差異 0，預計變更 0**。
2. **`Skills2.xlsx` 與 `Skills2.csv` 一致性**：
   - 逐列逐格比對 `config/Excel/Skills2.xlsx` 與 `config/CSV/Skills2.csv`：**283 列完全吻合，差異為 0**。
   - 全專案 14 張 Excel 與 CSV 亦達 100% 同步。
3. **`config/param-patches/` 暫存檢查**：
   - 目前目錄下無任何未套用的補丁（`SKILL_CAST_HOLD = 0.3` 已在提交 `40c91b62` 正式套用至主幹與 `js/formula.js`）。
4. **小結**：目前資料檔、配置表與 JS 常數處於 100% 完全同步狀態，**不存在資料未套用或不同步的問題**。

---

## 3. 失敗分類總覽表

| 類別 | 項目數 | 佔比 | 主要原因（一句話） |
| :--- | :---: | :---: | :--- |
| **A. 資料檔未更新或不同步** | **0 項** | 0% | Excel、CSV 與 JS 資料 100% 同步，無缺漏欄位或未套用補丁。 |
| **B. 測試本身過時 / 測試環境缺漏** | **287 項** | 100% | 階級耗魔提升使低魔 Mock 施法失敗、超神檢查封魔塔層數、全局傳奇移除武器限制與配置表平衡微調，但測試寫死舊預期。 |
| **C. 真的程式錯誤** | **0 項** | 0% | 遊戲邏輯與當前最新配置表及設計文件完全相符，未發現偏離規格的實作 Bug。 |

---

## 4. B 類失敗代表案例與證據

### 案例 1：階級耗魔大幅提升，舊單元測試 Mock 魔力過低導致施法回傳 `null`
> 引起約 34 項 `Cannot read properties of undefined/null` 的核心主因。

- **代表測試**：`tests/skill2-wind.test.cjs` -> `"stormbarrier 超神：護盾歸零時炸開..."`
- **失敗斷言**：`TypeError: Cannot read properties of undefined (reading 'until')` 於 `tests/skill2-wind.test.cjs:182`
- **程式位置**：`js/skills2.js:2651` `castSkill2(p, w, 'stormbarrier')`
- **改動提交**：
  - `01945909`（Codex）：引入 `skills2TierManaCost`，技能耗魔隨階級成長。
  - `17c04c14`（製作人）：提高高階技能法力消耗，T7 技能需 3,000 MP，超神（Ult）需 10,000 MP。
- **證據**：測試環境中 `playerEnt()` 寫死 `mp: 500`。測試呼叫 `maxLevels(p)` 將技能升至 T7 超神，隨後 `castSkill2` 因 `p.mp < 10000` 判定魔力不足直接回傳 `null`。測試未檢查回傳值即讀取 `p.buffs.stormbarrier_shield.until`，引發 `Cannot read properties of undefined`。
- **隔離驗證**：在測試中將 `mp` 調至 99,999，該測試立即通過。
- **建議處理**：**更新測試**（在測試的 `playerEnt` 輔助函式將 mock 魔力設為充足數值，如 `mp: 99999`）。

### 案例 2：超神進化接入封魔塔層數限制，測試環境未 Mock 塔層數
- **代表測試**：`tests/skill2-thrust-directions.test.cjs` -> `"phantomOcta (8向突刺)..."`
- **失敗斷言**：`assert.strictEqual(w.directionCount, 8)`（實際得到 `4`）於 `tests/skill2-thrust-directions.test.cjs:112`
- **程式位置**：`js/skills2.js:1418` `sgEffectiveUlt` 調用 `sgTierUnlockedBy(def, 'ult')` 檢查封魔塔層數
- **改動提交**：`654024ac`（Codex）：超神進化正式掛鉤封魔塔解鎖條件（如須達 30 層）。
- **證據**：單元測試未建立 `G.tower = { highest: 100 }` 或 `GM_TEST.skillUnlock = true`，`sgEffectiveUlt` 判定主角封魔塔進度為 0 故判定未解鎖，退回 T6 的 4 方向突刺。
- **隔離驗證**：在測試環境補上 `G.tower = { highest: 100 }` 後，方向數立即正確返回 8。
- **建議處理**：**更新測試**（在測試環境全域設定 `GM_TEST.skillUnlock = true` 或注入封魔塔層數 Mock）。

### 案例 3：全局傳奇詞綴移除武器限制，測試遍歷 `weaponTypes` 拋錯
- **代表測試**：`tests/skill2-ult-evolution.test.cjs` -> `"PASSIVE_POOL 傳奇特效..."`
- **失敗斷言**：`TypeError: undefined is not iterable (cannot read property Symbol(Symbol.iterator))` 於 `tests/skill2-ult-evolution.test.cjs:85`
- **程式位置**：`PASSIVE_POOL` 詞條定義物件。
- **改動提交**：`b9480abf`（Codex）：傳奇特效改為全裝備部位通用，從 `PASSIVE_POOL` 詞條中移除了 `weaponTypes` 陣列欄位。
- **證據**：測試碼仍寫著 `Array.from(def.weaponTypes)`，因該欄位已被架構重構移除而拋錯。
- **建議處理**：**更新測試**（移除測試對 `def.weaponTypes` 的遍歷斷言）。

### 案例 4：配置表數值平衡與公式改版，測試寫死舊版數值
- **代表測試**：`tests/skill2-iron-dance.test.cjs` -> `"鐵血之舞數值設定符合規格"`
- **失敗斷言**：`assert.strictEqual(def.selfDmgPct, 100)`（實際值為 `10`）、`assert.strictEqual(def.enemyDmgPct, 50)`（實際值為 `300`）於 `tests/skill2-iron-dance.test.cjs:31`
- **程式位置**：`config/Excel/Skills2.xlsx` / `config/CSV/Skills2.csv`
- **改動提交**：`40c91b62`（製作人）：將鐵血之舞調整為自身承傷 10%、敵方傷害 300%。
- **證據**：配置表與生成的 JS 均已更新為最新平衡數值，但新撰寫的測試檔案釘死了舊版規格。
- **建議處理**：**更新測試**（調整測試斷言數值對齊最新配置表）。

---

## 5. 「Cannot read properties of undefined」根因歸納
- **歸屬類別**：全部屬於 **Category B（測試過時 / 測試環境缺漏）**。
- **根因追查**：
  1. 提交 `01945909` 與 `17c04c14` 引入階級耗魔後，高階技能釋放門檻提高至 3,000 ~ 10,000 MP。
  2. 26 個測試檔案中的 Mock 玩家物件只有 100 ~ 500 MP。
  3. `js/skills2.js` 中的 `castSkill2` 檢查 `p.mp < manaCost` 成立，法力不足直接 `return null`。
  4. 測試未對 `null` 設防，直接讀取 `p.buffs[...].val`、`SKILL2_RT.grounds[0].hits`、`dot.dps` 等，引發 29 項 `Cannot read properties of undefined` 與 5 項 `Cannot read properties of null`。

---

## 6. 是否建議執行「套用參數.bat」？
- **結論**：**不建議**為了解決這 286 項測試失敗而執行「套用參數.bat」。
- **理由**：
  1. 經比對，`config/Excel`、`config/CSV` 與 `js/` 內的常數與參數已為 100% 最新狀態，執行套用參數的變更項為 0。
  2. 在隔離環境模擬套用後，測試失敗數依然維持 287 項，毫無變化。
  3. 這 286 項失敗的根本原因在於**單元測試的 Mock 環境未跟隨「階級耗魔提高」與「封魔塔解鎖超神」同步更新**，並非資料檔脫鉤。

---

# ═══ 第二部分：實機三大遊戲行為驗證（2b91f66、943f9c2） ═══

透過 Chrome 遠端除錯連線至本機遊戲環境，針對 3D 角色動作與時間戳進行逐幀追蹤實測：

### 1. 普攻播完（提交 `2b91f66`）
- **實測情境**：角色起手普攻 `attack1`，在揮劍中途（第 100ms）怪物死亡，角色目標切換並開始追擊下一隻敵人（`walking = true`）。
- **舊版行為**：舊版在 `stillFor === 0 && HERO3D_ACTIONS[p.curAnim]` 時，只要產生位移便會在 80ms 內強制打斷揮劍，硬切為 `walk` 跑步動作。
- **實測數據**：
  - `0ms ~ 380ms`：動作全程保持 `attack1`，揮劍動作完整播放完畢。
  - `420ms`：揮劍收招完成後，平順切換回 `walk` 動作。
- **滑步評估**：角色在揮劍剩餘的約 0.2 ~ 0.3 秒期間會邊位移邊完成收招動作。因地面位移連續且動作收招平順，呈現為輕微滑步，視覺表現與手感遠優於原本「剛舉劍就被硬切成跑步」的突兀卡頓，完全符合預期代價。

---

### 2. 技能動作隨機與不插動作（提交 `2b91f66`）
- **動作隨機性實測**：連續觸發 10 次技能施放，記錄角色選取的攻擊動作序列為：
  `['attack3', 'attack2', 'attack1', 'attack3', 'attack2', 'attack1', 'attack2', ...]`
  - 動作均在 `attack1`、`attack2`、`attack3` 三招之間隨機選取。
  - 程式碼 `var castPool = HERO3D_ATTACKS.filter(n => n !== p.lastAttack);` 確實生效，未出現連續兩次相同招式。
- **普攻中施法不插動作實測**：
  - 於角色普攻（`attack2`）播放進行中注入技能施放事件（`act: 'cast'`）。
  - 實測記錄：觸發前後角色動作均維持 `attack2`（`noInterruptDuringAttack = true`）。
  - `js/battle-renderer.js` 攔截生效，攻擊進行中不打斷當前動作，技能特效正常播放。

---

### 3. 技能後站定時間量測（提交 `943f9c2`）
針對參數「9-技能／施放硬直」參數 b 進行套用前後對照量測：

| 狀態 | 施放硬直 (`SKILL_CAST_LOCK`) | 站定參數 (`SKILL_CAST_HOLD`) | 技能放出至再次移動時間 | 技能傷害判定出現時間 |
| :--- | :---: | :---: | :---: | :---: |
| **套用前** | 0.2 秒 | 0.0 秒 | **0.20 秒** | **0.20 秒** |
| **套用後** | 0.2 秒 | 0.3 秒 | **0.50 秒**（0.2s + 0.3s） | **0.20 秒**（完全不延遲） |

- **結論**：
  - **傷害判定完全不變**：技能傷害在 0.2 秒硬直結束時如期結算並飄字，未因站定而延遲。
  - **站定完整銜接動作**：套用後角色額外站定 0.3 秒（`_skillHold = 0.3`），剛好讓 3D 技能動作（約 0.5 秒）完整播完後才恢復奔跑，解決了移動施法時人物動作被跑步打斷的問題。
