# 既有測試失敗診斷

診斷日期：2026-07-27  
分支：`ai/codex`  
診斷基準：`67938fe`（P1 協議測試提交後）

## 1. 結論

目前可重現的基準不是 `AI_TASKS.md` 記載的 417 pass / 95 fail，而是：

- 473 tests
- 423 pass
- 47 fail
- 3 skipped
- 32 個失敗檔案

失敗檔案仍是原記錄的 32 個，但失敗案例已由 95 降為 47；以下只分類目前仍可重現的 47 筆。

| 分類 | 數量 | 處理原則 |
|---|---:|---|
| A：測試過時，來源碼符合目前權威資料或行為 | 32 | Claude 核可後改測試 |
| B：來源碼與測試／既有規格不一致 | 14 | `js/` 鎖定，不修，交 Claude 裁決 |
| C：環境／換行問題 | 1 | 個案處理 |

## 2. 逐筆分類

| # | 失敗位置 | 類別 | 判定依據與建議 |
|---:|---|:---:|---|
| 1 | `tests/attribute-tooltip.test.cjs:71` | A | 測試綁死 `.attr-group .stat-row` 的舊 `max-content max-content`；目前 `css/style.css:3201` 使用 `minmax(0, 1fr) max-content`，仍符合左欄可收縮、右欄不換行的版面目的。改測試驗證語意，不綁死舊欄寬字串。 |
| 2 | `tests/boss-display-state.test.cjs:21` | C | `js/ui.js:2895-2910` 已在暫停時凍結高塔計時；斷言只接受 LF，工作樹為 CRLF，故正規式跨行失敗。改成換行無關的來源檢查。 |
| 3 | `tests/boss-tooltip.test.cjs:24` | A | BOSS 閃避已改由 `segmentedLevelGrowth(FIELD_MONSTER_DODGE_BASE, stage, FIELD_MONSTER_DODGE_GROWTH)` 讀命名參數；測試仍找舊的行內算式。改測試驗證共用公式與參數接線。 |
| 4 | `tests/combat-log.test.cjs:8` | A | `js/combat.js:492-505` 先宣告 `hpDamage=0` 再於護盾結算後賦值；測試只接受「宣告與公式同一行」的舊寫法。改為驗證賦值公式與日誌使用同一變數。 |
| 5 | `tests/combo-hits.test.cjs:33` | A | Lv.101 預期值仍使用舊係數；目前 `COMBO_HITS_COEF={a:0.875,b:0.0025,c:0.05}` 與 `config/CSV/game_parameters.csv:37`、`game_formula.md:108` 一致。依權威參數重算期望值。 |
| 6 | `tests/combo-hits.test.cjs:40` | A | Lv.1380 預期值仍使用舊係數，來源與 CSV 一致。依目前係數重算近似值與容許誤差。 |
| 7 | `tests/combo-hits.test.cjs:46` | A | Lv.200 預期值仍使用舊係數，來源與 CSV 一致。依目前係數重算期望值。 |
| 8 | `tests/enchant-slot.test.cjs:22` | A | 測試假設附魔精華消耗為 5；目前權威參數與 `ENCHANT_ESSENCE_COST` 為 1，所以初始 5 後剩 4。更新測試初始資源或期望餘額。 |
| 9 | `tests/enemy-type-damage.test.cjs:47` | A | 測試仍要求六種單屬性抗性 `minR=4`；`js/data.js:502`、`PATCH.md:297`、`game_formula.md:682` 均明定單屬性抗性為獨特起 `minR=3`，只有 `resAll` 維持 4。更新清單分組。 |
| 10 | `tests/essence-salvage.test.cjs:39` | A | 拆解精華表仍期待舊值；目前 `ESSENCE_SALVAGE_CHANCE_BY_RARITY=[5,7.5,10,15,20,25,30,100,100]` 與 `config/CSV/game_parameters.csv:195` 一致。更新期望表。 |
| 11 | `tests/essence-salvage.test.cjs:57` | A | 傳說品質基礎率目前為 25%，加 1400% 透鏡後為 375%，餘數擲骰 75%；測試仍期待舊基礎率算出的 20%。依 CSV 新表更新擲骰與產量期望。 |
| 12 | `tests/field-equipment-drop-table.test.cjs:17` | A | 測試保存舊野外裝備掉落表；`js/data.js:1247` 已與 `config/CSV/game_parameters.csv:139-146` 一致。由 CSV 現值更新測試表。 |
| 13 | `tests/field-gem-drop-table.test.cjs:20` | A | 測試保存舊野外寶石掉落表；`js/data.js:1253` 已與 `config/CSV/game_parameters.csv:147-153` 一致。由 CSV 現值更新測試表與查表案例。 |
| 14 | `tests/forge-duration.test.cjs:9` | A | 寶石神鑄時間仍期待 `{5:2,6:3,7:4,8:5,9:6}`；目前 `{5:1,6:2,7:3,8:4,9:6}` 與 `config/CSV/game_parameters.csv:204` 一致。更新測試。 |
| 15 | `tests/gem-attr-dmg-base.test.cjs:71` | B | `PLAN.md:428`、`PATCH.md:322`、`ONE_TIME_MIGRATIONS.md:16-36` 均要求 `gemAttrDmgBaseV1`，但 `js/player.js` 沒有新帳號完成旗標，`js/save.js` 也沒有遷移區塊。來源缺少已登錄遷移；待 Worker 檔案鎖空檔由 Claude 排修。 |
| 16 | `tests/gem-attr-dmg-base.test.cjs:90` | B | 舊融合寶石快照沒有依規格乘 0.4，仍保留 2.5 而非 1。補回遷移時需掃描文件列出的所有容器。 |
| 17 | `tests/gem-attr-dmg-base.test.cjs:106` | B | 因遷移旗標與邏輯皆缺，冪等案例也失敗。應與前兩筆同一來源修復處理，不改測試。 |
| 18 | `tests/gem-compose-all.test.cjs:102` | B | `GEM_COMPOSE_INPUT_COUNT=3` 與運算已正確，但 `index.html:310` 仍寫「消耗 2 顆」，且 `index.html:352` 的拆解示例仍是 2 合 1 舊值；違反 `PATCH.md:163-165` 的 UI 同步規格。待解鎖後修正靜態提示，測試保留。 |
| 19 | `tests/gem-convert-shift.test.cjs:50` | B | `js/ui.js:5293` 只有事件內行內的 Shift 單顆放入，缺少可驗證且可共用的 `adjustGemConvertPool` 狀態操作。P3 搬 Worker 前應抽成模擬層操作。 |
| 20 | `tests/gem-convert-shift.test.cjs:68` | B | Shift 從九宮格取下一顆的 `removeGemConvertSlot` 不存在，目前點格子只會移除整槽。功能不對稱，保留測試並交 Claude 決定修復時點。 |
| 21 | `tests/gem-convert-shift.test.cjs:84` | B | `js/ui.js:4177-4179` 只提示「Shift+左鍵放入一顆」，未提供測試要求的「單顆放入／取下」。應隨前兩筆功能一起修正文案。 |
| 22 | `tests/gem-shop.test.cjs:22` | A | 測試仍期待 Lv.1 價格 5000；`js/data.js:1178` 與 `config/CSV/game_parameters.csv:238` 的目前權威值為 10000。更新測試價格表。 |
| 23 | `tests/global-damage-reduction.test.cjs:18` | B | `game_formula.md:482` 與 `PATCH.md:2394` 規定全局減傷不限制部位，但 `js/data.js:464` 仍設 `slots` 並排除武器、手套、腰帶等部位。移除部位限制前不得改測試。 |
| 24 | `tests/god-might.test.cjs:25` | A | 測試假設 Lv.1 基礎魔攻 16；目前 `DERIVED_COEF.matkBase=6` 與 `config/CSV/game_parameters.csv:33` 一致，實際基礎值為 11。保留神力獨立乘區檢查，以目前基礎值重算期望。 |
| 25 | `tests/godforged-border-effect.test.cjs:8` | B | `css/style.css:5167` 為 `2.0s`，但 `PATCH.md:2464`、`PLAN.md:2071` 與測試均要求 `0.3s`。這是來源回退；待 Claude 核可後修 CSS，不應把測試改成 2.0s。 |
| 26 | `tests/loot-event-accounting.test.cjs:83` | A | Lv.270 寶石掉落事件期望仍依舊表；目前計算使用已同步 CSV 的 `FIELD_GEM_DROP_TABLE`。依目前表與有效掉寶率重算期望。 |
| 27 | `tests/multi-enemy.test.cjs:72` | A | 測試自行建立的 `FIELD.player` 缺少正式 `newPlayerEntity()` 一定具備的 `effects:{}`，`fieldTick()` 因此在 `effectActive` 讀取時拋錯。測試應使用正式建構器或補齊實體契約。 |
| 28 | `tests/number-format.test.cjs:15` | B | 測試明定千位為小寫 `k`，來源改成大寫 `K`，未找到同步變更規格或測試更新。這是顯示契約衝突，請 Claude／產品先裁決大小寫；裁決前保留測試。 |
| 29 | `tests/number-format.test.cjs:28` | B | 測試要求 `Q/Qi/Sx/Sp/O/N/D/Ud`，來源改為 `P/E/Z/Y/R/Q` 的 SI 式序列，亦無同步規格。需先裁決遊戲採哪套大數字命名，再改單一來源與測試。 |
| 30 | `tests/player-shield-bar.test.cjs:28` | A | 功能仍完整，但 `js/ui.js:1395-1399` 已改用 `setStyleIfChanged` 避免重複 DOM 寫入；測試仍找直接 `shieldBar.style.*`。改測試接受共用 DOM helper 並保留寬度公式驗證。 |
| 31 | `tests/rarity-colors.test.cjs:1` | A | 整檔在 top-level 第一個斷言中止；`index.html` 已有正確稀有度顏色，但測試綁死無空格、無其他 style 的 `style="color:#ffd700"` 字串。改為解析 style 或容許空白與其他宣告，不能因 top-level 首錯掩蓋後續斷言。 |
| 32 | `tests/save-folder-ui.test.cjs:8` | B | 測試要求共用 `rescanSaveFolderView(showMessage)`、按鈕與視窗 focus 都走同一路徑；目前 `js/ui.js:6180-6198` 只有按鈕行內 handler，沒有 focus 重新掃描。功能規格未完整落地。 |
| 33 | `tests/save-folder-ui.test.cjs:18` | B | `js/ui.js:838-847` 的 `refreshSaveFolderFilesV2` 不回傳 Promise／檔案清單，使呼叫端無法等待重新掃描結果。依測試契約回傳 fresh files，勿把測試降為只看副作用。 |
| 34 | `tests/synthesis-disabled.test.cjs:55` | A | 合成關閉轉成 keep 的邏輯在 `js/factory.js:259-260` 正確；測試沿用 `newGameState()` 預設 `autoEquip=true`，物品先被自動穿上而非進背包，故 `inventory.length` 為 0。測試應關閉 auto-equip 或同時接受正式路由結果。 |
| 35 | `tests/talent-elem-attach.test.cjs:88` | A | 測試仍設定舊潛力 `p5_elementCore`；目前潛力 V3 已更換節點與生效接線，該 ID 不存在／不啟用。改成目前 V3 的元素核心節點與解鎖條件，或將此舊 V2 案例報廢交 Claude 決定。 |
| 36 | `tests/talent-respec-migration.test.cjs:32` | A | V1 遷移會清空舊 `potentialLevels`；測試仍要求已不存在的 `p1_time` 被補成 0。現在結果 `undefined` 才符合移除舊 ID 的淨化語意。更新期望並另外驗證目前潛力預設。 |
| 37 | `tests/talents.test.cjs:13` | A | 檔頭仍宣稱潛力解鎖天賦「整批鎖定置灰」，但潛力 V3 已實裝並移除 `disabled`。此測試屬舊 V2 規格，應改驗證滿級解鎖與目前可用性。 |
| 38 | `tests/talents.test.cjs:137` | A | 同一舊前提使 `t3_potential` 預期「暫不開放」，實際進入正常升級檢查並回報點數不足。依 V3 規格重寫案例。 |
| 39 | `tests/talents.test.cjs:196` | A | 測試期待舊 `talentStatBonuses().potentialCdr/potentialInvCap`；`js/talents.js:213-214` 明定 V3 潛力不再由該彙總提供，改由 `computeStats`／`potential.js` 生效。改測試走 V3 接線。 |
| 40 | `tests/talents.test.cjs:276` | A | 測試把 `t3_allres2` 誤算成元素抗性；`js/data.js:109` 與 `config/CSV/Talents.csv:25` 明定它是 `globalDmgRed`，所以火抗為 125 而非 130。修正測試註解與期望。 |
| 41 | `tests/talents.test.cjs:333` | A | GM 重置會清空目前 `POTENTIAL_TALENTS`，但測試塞入已淘汰 ID `p1_time`；遍歷現行節點不會建立／清除任意舊鍵。改用現行潛力 ID，舊 ID 清理由存檔 migration 測試負責。 |
| 42 | `tests/talents.test.cjs:351` | A | 效果文字仍比對潛力 V2 的復活／掉落等描述與舊 stat 分支；目前資料為潛力 V3。依 `config/CSV`／V3 資料逐節點驗證現在文案。 |
| 43 | `tests/talents.test.cjs:442` | A | `potentialNodeHTML(p1_time)` 因舊 ID 不存在而回空字串；正式 tooltip 機制仍存在。改用目前 V3 潛力 ID，再驗證 `data-talent-tip` 與無原生 title。 |
| 44 | `tests/tower-cost.test.cjs:9` | A | 測試仍期待一樓 100000；目前 `TOWER_CHALLENGE_COST_TIERS` 的基礎值 10000 與 `config/CSV/game_parameters.csv:112` 一致。依 CSV 更新期望。 |
| 45 | `tests/tower-xp.test.cjs:63` | A | `js/tower.js:215-240` 為支援攻擊目標轉移，先取 `bossTarget`／`bossSpecialTarget` 再呼叫 `doMonsterAttack`；傷害統計仍使用回傳 `dmg`。測試只接受舊的直接傳 `p` 字串，應改驗證新目標抽象後的統計接線。 |
| 46 | `tests/ui-performance.test.cjs:75` | B | 簽章 guard 存在於 `js/ui.js:1275-1277`，但 `renderZoneBar()` 在 guard 前已寫入 realm toggle 的 display/text/tooltip（`1259-1271`），未達「狀態未變就不重寫 DOM」目的。應把完整簽章判斷移到所有 DOM 寫入前，測試保留語意。 |
| 47 | `tests/unlock-thresholds.test.cjs:40` | A | 測試與 `game_formula.md:55` 還寫 Lv.2000；目前 `FORGE_UNLOCK_LEVEL=1` 與 `config/CSV/game_parameters.csv:7` 一致，來源在 1 轉 Lv.1 解鎖是當前參數結果。更新測試，並同步修正過時公式文件。 |

## 3. CSS 編碼異常（獨立 C 類風險）

`AI_TASKS.md:206-214` 記錄 `css/style.css` 有 2248 個無效 UTF-8 位元組，並預先列出 6 個受影響測試檔。以目前工作樹重新檢查：

- UTF-8 fatal decode 可通過；
- 檔案仍含 NUL byte，且部分中文註解已呈現亂碼；
- `index.html` 仍宣告 UTF-8。

因此目前版本仍有編碼污染，第二步應依既定方案把 CSS 正規化成無 BOM UTF-8。不過目前 6 個檔案的實際紅燈分別是欄寬、程式結構、神鑄時間、動畫速度、DOM helper 與 inline-style 正規式落差；單純轉碼不會讓這 6 筆全部通過。上表依「目前直接失敗根因」分類，另把 CSS 編碼列為跨案例 C 類工作，避免轉碼後誤以為其餘斷言自然會綠。

## 4. Claude 裁決清單

第二步開始前需先裁決：

1. 是否接受 32 筆 A 類測試依目前 CSV、潛力 V3 與重構後行為更新。
2. 14 筆 B 類的修復排程，尤其是存檔遷移、全局減傷部位、寶石 Shift 操作、存檔資料夾 Promise 契約與場景列效能 guard。
3. 大數字單位採測試的遊戲縮寫序列，或來源目前的 SI 式序列。
4. CSS 正規化後，神鑄彩框仍應依既有規格恢復為 `0.3s`。

本報告只做診斷，未修改任何 `js/`、`tests/` 或 CSS 檔案。
