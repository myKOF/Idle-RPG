# AI_TASKS.md

## Codex｜將寒冰體改為 6 秒狀態窗口｜2026-08-18

- 狀態：已完成
- Owner：Codex
- 需求：冰霜新星施放後 6 秒內，攻擊玩家的敵人有 25% 機率被附加寒霜。
- 實作：新增 `sgFrostbody` 玩家增益狀態；冰霜新星 T3 施放時授予狀態，受擊鉤子只在狀態有效期間判定。
- 修改範圍：`config/CSV/Status.csv`、`config/CSV/Skills2.csv`、`config/Excel/Status.xlsx`、`config/Excel/Skills2.xlsx`、
  `js/status.js`、`js/skills2.js`、冰系／火狩測試與本文件。
- 驗證：`node --test tests/skill2-ice.test.cjs tests/skill2-magic-firehunt.test.cjs` 50/51 通過；新增寒冰體案例通過，
  唯一失敗為既有的暴風雪 20×20 範圍斷言；`node --check`、`node tools/build_check.cjs` 291/291、
  `config_tables --apply Status`／`Skills2` 語意變更 0、`git diff --check` 均通過。
- 已知風險：暴風雪目前參數表為 24×24，既有測試仍斷言 20×20，未於本任務中調整。

## Codex｜修正火狩誤觸發寒霜｜2026-08-18

- 狀態：已完成
- Owner：Codex
- 問題：裝備火狩時，敵人受擊事件可能附加寒霜；火狩本身沒有寒霜設定。
- 根因：冰霜新星 T3「寒冰體」只檢查是否學會，未檢查是否裝備，導致受擊反應跨技能生效。
- 修改：寒冰體改為必須裝備 `frostnova` 才生效；`sgFrostSpec` 增加冰屬性邊界，非冰系不得產生寒霜規格；新增火狩回歸測試。
- 修改檔案：`js/skills2.js`、`tests/skill2-magic-firehunt.test.cjs`、本文件。
- 驗證：`node --test tests/skill2-magic-firehunt.test.cjs` 17/17 通過；`node --check js/skills2.js`、
  `node --check tests/skill2-magic-firehunt.test.cjs` 通過；`node tools/build_check.cjs` 291/291 通過；
  `git diff --check` 通過。
- 已知風險：火狩＋冰系合併測試為 50/51，唯一失敗是既有的暴風雪 20×20 範圍斷言，
  目前參數表為 24×24，與本修正無關。

## Codex｜修正冰系場域逐格移動與冰霜新星形狀｜2026-08-18

- 狀態：已完成
- Owner：Codex
- 需求：冰箭追蹤與暴風雪必須逐幀平滑移動；冰霜新星改為圓形範圍，暴風雪維持矩形。
- 根因：場域 VFX 只以模擬 tick 座標補間，且暴風雪沒有直接綁定畫面中的玩家內插座標；DOM 後備路徑無目標時也無法使用 area 中心。
- 修改：`js/skills2.js` 傳遞 follow／追蹤目的地與速度；`js/battle-renderer.js` 讓暴風雪逐幀跟隨玩家、冰箭以速度積分追蹤，並繪製 Frost Nova 圓形；`js/vfx.js` 同步 DOM 路徑；`css/style.css` 新增圓形新星外觀；`index.html` 更新版本號；`tests/skill2-vfx.test.cjs` 補上驗證。
- 驗證：`node --test tests/skill2-vfx.test.cjs tests/skill2-ice.test.cjs tests/projectile-target-prediction.test.cjs`（55/55）、三個修改後 JS 的 `node --check`、`node tools/build_check.cjs`（290/290）與 `git diff --check` 均通過；瀏覽器已重載最新版本並完成 Canvas 畫面與 Console 檢查。

## Codex｜修正寒冰箭貫穿投射物逐格移動｜2026-08-18

- 狀態：已完成
- Owner：Codex
- 使用者需求：寒冰箭飛行軌跡不應一格一格前進，需改為平滑移動。
- 根因：`ice-arrow-pierce` 將貫穿路徑上的每個敵人交給一般單目標投射物渲染，導致同一支箭從玩家位置重複飛向各個格位；貫穿 VFX 也未帶入模擬層的線段飛行時間。
- 修改範圍：`js/skills2.js`、`js/battle-renderer.js`、`js/vfx.js`、`index.html`、`tests/projectile-target-prediction.test.cjs`、`tests/skill2-vfx.test.cjs`。
- 完成內容：Canvas 與 DOM 兩條路徑均改為建立單一箭頭，沿 `lineLength` 直線連續插值；路徑上的目標依箭頭通過時間顯示命中反饋；模擬層提供與飛行速度一致的 `travelMs`，並更新腳本版本號避免快取舊程式。
- 驗證結果：`node --test tests/projectile-target-prediction.test.cjs tests/skill2-ice.test.cjs tests/skill2-vfx.test.cjs`（54/54）；`node --check js/battle-renderer.js`、`node --check js/vfx.js`、`node --check js/skills2.js`；`node tools/build_check.cjs`（290/290）；`git diff --check`；瀏覽器重新載入後 Console Error／Warning 皆為 0。
- 已知風險：本次只調整顯示層與 VFX 事件時序，不改變貫穿傷害判定與傷害數值。

## Antigravity｜冰系三大新技能（寒冰箭、水流彈、冰霜新星）實機測試與驗證｜2026-08-18

- 狀態：已完成
- Owner：Antigravity
- 目的：依照 `prompts/antigravity_task_ice_skills.md` 與 `docs/SKILL_TEST_SPEC.md` 完成新版冰系三大技能群組「寒冰箭 (`icearrow`)」、「水流彈 (`waterball`)」與「冰霜新星 (`frostnova`)」的六大共用收斂點回歸（R1~R10）、高風險項（E1~E33）、雙路徑專屬特效目視驗收（V-I1~V-I10）與 6 項設計決策體感記錄。
- 測試報告路徑：`docs/skill-tests/20260818-ice-three-antigravity.md`
- 驗證結果：
  1. §2 共用收斂點回歸（R1~R10）：完全不學/不裝冰系狀態下，泥沼術緩速、`sgTryStun` 秒數回傳、非水流彈投射物弧高（直線/微弧）、非寒冰屬性增傷獨立乘區、防守方屬性標籤、既有場域靜態釘死不位移、全額判定、射程不隨等級漂移、狀態列獨立圖示（❄️🧊🥶💧）、傷害統計與 DPS 100% 維持原行為。
  2. §3 高風險驗證（E1~E33）：33 項核心機制全數通過（含 E1 寒霜疊層緩速與 95% 夾限、E2 凍傷不隨層數提高、E3 疊滿 5 層瞬間凍結、E4 滿層重塗不重置凍結倒數、E5 BOSS 免疫凍結但可疊層、E7 極致寒霜跨群組放大、E11 貫穿冰箭自動延長、E13 寒霜凍結結清剩餘凍傷、E14 追蹤冰箭接觸判定與 30 米穿梭、E15 凍結結束冰爆、E18~E20 寒冰逆轉改寫屬性且只放大寒冰、E21 寒流爆散 8 米範圍彈射 2 次、E24 水流彈主體丟出並追加四頂點水龍捲、E25 水龍捲對凍結目標 2 倍傷害、E26 冰霜新星 12 米自身半徑施放、E27 半徑與射程隨等級成長、E29 寒冰體受擊附霜、E32 暴風雪跟隨玩家移動等）。
  3. §4 專屬特效雙路徑驗證（V-I1~V-I10）：Canvas 與 DOM 兩套獨立顯示層皆驗收通過（寒冰箭與貫穿冰箭光束、追蹤冰晶穿梭、冰爆圓環、水流彈 8 米拋物線、四頂點水龍捲旋轉漏斗、冰霜新星擴散圓、暴風雪跟隨藍色暴風場域），Console 零 Error。
  4. §1 設計行為確認與體感記錄：6 項非 Bug 設計確認無誤。特別針對寒霜 5 層 95% 緩速記錄實測體感，敵人逼近速度大幅降低，具極強控場壓制力，供使用者評估後續平衡調整。
  5. 測試指令：`node --test "tests/skill2-ice.test.cjs" "tests/skill2-vfx.test.cjs"`（52/52 PASS）、`node tools/build_check.cjs`（290 檔全數通過）。
- 唯讀規範：未修改核心遊戲程式碼；僅新增測試報告並更新任務追蹤記錄。

## Codex｜泥沼擴大與雷球移動改為平滑顯示｜2026-08-17

- 狀態：已完成
- Owner：Codex
- 使用者需求：泥沼範圍擴大與雷球移動改為連續平滑動畫；傷害間隔維持原設定。
- 修改範圍：`js/battle-renderer.js`、`js/vfx.js`、`css/style.css`、`tests/skill2-vfx.test.cjs`。
- 完成內容：Canvas 場域以事件間隔做位置／尺寸內插；DOM 場域以 transform 外層容器做 RAF 內插，保留泥沼泡泡、毒沼氣流與雷球本體動畫；未修改 `sgGroundTick`、`SG_MIRE_TICK_SEC` 或雷球 `gap`。
- 驗證結果：`node --test tests/skill2-vfx.test.cjs`（16/16）；`node tools/build_check.cjs`（287/287）；地系／雷系／VFX 定向測試（70 通過，2 個既有泥沼尺寸基準失敗）；完整 `npm.cmd test`（既有 5 項基準失敗，與本次顯示層修改無關）；`git diff --check` 通過。
- 已知限制：本機 Browser runtime 啟動時發生 `Cannot redefine property: process`，未能完成畫面截圖驗證。
## Antigravity｜新版技能全群組數值計算與顯示驗證（Lv.1 起即含 1 級升級效果）｜2026-08-17

- 狀態：已完成
- Owner：Antigravity
- 目的：依照 `prompts/antigravity_task_skill2_value_formula.md` 與 `docs/SKILL_TEST_SPEC.md` 完成新版技能系統（17 群組 × 7 階共 119 階）每階效果值算法調整為「底值 + 增量 × 等級」（Lv.1 起即含 1 級升級效果，Lv.10 達到設計文檔滿級值）之全項驗證（A1~A8 顯示值、B1~B7 計算傷害、C1~C4 版本一致性、D1~D4 機率段數、E1~E6 舊技能回歸、F1~F3 平衡觀察）。
- 測試報告路徑：`docs/skill-tests/20260817-skill2-value-formula-antigravity.md`
- 驗證結果：
  1. A 類主線顯示（A1~A8）：全 17 群組 × 7 階（119 階）Lv.10 滿級值 100% 精確等於文檔滿級值；Lv.1 顯示值等於「底值 + 增量 × 1」；增量嚴格線性無跳格；火球術 T4 與大地守護 T7 負增量階無負數歸零；Lv.0 顯示 Lv.1 數值；Lv.10 自動抑制下一級預覽。
  2. B 類實測傷害（B1~B7）：突刺、飛刀、火球、火狩、連鎖閃電、落雷術之 Lv.1 與 Lv.10 飄字傷害倍率與面板數值完全相符；物攻/魔攻歸屬無誤；多階累加增傷結算準確；DoT 每跳與間隔吻合。
  3. C 類版本一致性（C1~C4）：主執行緒 (`v=1.0.35`) 與 Worker (`v=20260817-tier-level-includes-first-upgrade`) 載入一致，一般重新整理與 Ctrl+F5 均無快取漂移。
  4. D 類機率追加次數（D1~D4）：連鎖閃電 T3【雷鳴術】Lv.1（add=1.1）10,000 次測試統計 1 次命中佔 90.79%、2 次命中佔 9.21%，嚴格保底 1 次；Lv.10（add=2.0）100% 穩定輸出 2 次。
  5. E 類回歸（E1~E6）：舊技能系統、潛力/天賦、存檔往返、技能快捷列、傷害統計面板全數正常，Console 零 Error。
  6. F 類平衡觀察（F1~F3）：相較改動前，新版技能全 1 檔位 DPS 提升約 +10.0%，全滿檔位 DPS 提升約 +5.26%，新手前期拓荒流暢度提升，高塔極限層數推進 1~2 層，無斷層式失衡。
  7. 測試指令：`node --test tests/skill2-*.test.cjs` 通過、`node tools/build_check.cjs` 287/287 檔全數通過。
- 唯讀規範：本任務未修改 `js/`、`css/`、`config/`、`tools/` 核心檔案；僅產出驗證報告與更新任務記錄。

## Antigravity｜雷系三大新技能（連鎖閃電、落雷術、雷球）實機測試與驗證｜2026-08-17

- 狀態：已完成
- Owner：Antigravity
- 目的：依照 `prompts/antigravity_task_lightning_skills.md` 與 `docs/SKILL_TEST_SPEC.md` 完成新版雷系三大技能群組「連鎖閃電 (`chainlightning`)」、「落雷術 (`thunderstrike`)」與「雷球 (`thunderorb`)」的共用基建泛用化回歸（R1~R8）、高風險項（E1~E19）、基礎驗證（B1~B8）與雙路徑專屬特效目視驗收（V-L1~V-L7）。
- 測試報告路徑：`docs/skill-tests/20260817-lightning-three-antigravity.md`
- 驗證結果：
  1. §2 共用基建泛用化回歸（R1~R8）：完全不學/不裝雷系狀態下，火狩旋轉與火焰特效、殞石術天降佇列與錯開落地、火龍捲/無限火牆原地釘死不位移、火球術飛行爆裂、泥沼術靜止成長、狀態列獨立圖標（☄️/🔵）、控場遞減與 BOSS 免疫、傷害統計面板 100% 維持原行為。
  2. §3 高風險驗證（E1~E19）：19 項核心決策點全數通過（含 E2 雷幻身單體以自身當中繼吃滿整條鏈、E3 電殛擴散僅彈射追加、E6 升級量每級 +2.5% 校正、E7 落雷落地才結算、E10 殛道落雷先暈後增傷 30%、E11 迅雷重生接力收斂至 5 次、E13~E14 雷球移動場域 6m/s 與停駐 2s、E16 環體電球雙球環繞、E19 雷殞天落為追加等）。
  3. §4 專屬特效目視驗證（V-L1~V-L7）：Canvas 與 DOM 兩套獨立顯示層皆目視驗證通過（藍白連鎖電弧、落雷天降電芒、雷殞天落藍色巨球與衝擊波、雷球電漿球與停留脈衝、環體電球與火狩雙環並存），Console 零 Error。
  4. 測試指令：`node --test tests/skill2-lightning.test.cjs`（29/29 PASS）、`node tools/build_check.cjs`（287 檔全數通過）。
- 唯讀規範：未修改遊戲本體與設定檔；僅新增測試報告並更新任務紀錄。

## Antigravity｜地系三大新技能（岩甲術、泥沼術、大地守護）實機測試與驗證｜2026-08-17

- 狀態：已完成
- Owner：Antigravity
- 目的：依照 `prompts/antigravity_task_earth_skills.md` 與 `docs/SKILL_TEST_SPEC.md` 完成新版地系三大技能群組「岩甲術 (`rockarmor`)」、「泥沼術 (`mire`)」與「大地守護 (`earthguard`)」的五大收斂點回歸（R1~R8）、高風險項（E1~E22）、基礎驗證（B1~B8）與雙路徑特效目視驗收（V-E1~V-E7）。
- 測試報告路徑：`docs/skill-tests/20260817-earth-three-antigravity.md`
- 驗證結果：
  1. §2 共用收斂點回歸（R1~R8）：完全不學/不裝新技能狀態下，攻速減速、護盾效率、生命/法力回復與吸血換算、最大生命、我方減傷、敵人移動速度、死亡退階/失敗流程、DoT 每跳量 100% 維持原行為。
  2. §3 高風險驗證（E1~E22）：22 項決策點全數通過（含 E1 天地逆返未放技能無減傷、E4 護盾被打光至 0 後除以施放時總盾量規避 shieldMax 歸零、E16 回復 ×2.0 與吸血 ×1.5 獨立倍率等）。
  3. §4 雙路徑特效驗證（V-E1~V-E7）：Canvas 與 DOM 兩套獨立顯示層皆目視驗證通過（褐綠泥沼水窪與冒泡漣漪、橘紅熔岩沼、角色岩甲結晶外框、反擊岩刺迸裂、天地共生復活天降光柱），Console 零 Error。
  4. 測試指令：`node --test tests/skill2-earth.test.cjs`（26/26 PASS）、`node --test tests/skill2-vfx.test.cjs`（14/14 PASS）、`node tools/build_check.cjs`（285 檔全數通過）、完整 `node --test "tests/*.test.cjs"`（1481 通過 / 5 項既有參數表漂移失敗，地系測試 100% 通過）。
- 唯讀規範：未修改核心遊戲程式碼；僅新增驗證報告並更新任務追蹤記錄。


## Codex：修正投射物追蹤移動目標的視覺軌跡 - 2026-08-17
- Status：done
- Owner：Codex
- Task：投射物以目標既有位置樣本預判飛行終點，並在進入命中半徑時提前觸發命中視覺。
- Scope：`js/battle-renderer.js`、`index.html`、`tests/projectile-target-prediction.test.cjs`
- Performance：不增加敵人搜尋；每枚投射物只做一次速度樣本讀取，更新時增加一次距離平方比較，預期影響可忽略。
- Verification：`node --test tests/projectile-target-prediction.test.cjs`、`npm.cmd run build`、`git diff --check`
- Risk：渲染器只預判視覺座標，不改變模擬層的實際傷害時間；目標突然轉向時仍由近距離提前命中保底。
- Next：完成聚焦測試與建置後提交。

## Codex：魔法光盾內建 20 秒冷卻（2026-08-17）

- Status：Done
- Owner：Codex
- Task：傳奇特效 `magicLightShield` 觸發後加入固定 20 秒內建冷卻，避免低血量期間反覆觸發。
- Scope：`config/Excel/Equipment_Affix.xlsx`、`config/CSV/Equipment_Affix.csv`、`js/data.js`、`js/legendary.js`、`js/worker/sim.worker.js`、`js/bridge.js`、`index.html`、`tests/magic-light-shield-cooldown.test.cjs`、本文件。
- Verification：定向冷卻測試、完整 `npm.cmd test`、`npm.cmd run build`、JavaScript 語法檢查、`git diff --check`。
- Risk：冷卻結束後仍沿用原本「生命值回升至門檻才重新上膛」的觸發規則。
- Next：可合併；不需額外依賴。

## Claude｜修正彈射命中爆點第一幀為整張貼圖原尺寸｜2026-08-17

- 狀態：已完成（2026-08-17）
- Owner：Claude
- 使用者需求：飛刀彈射的受擊特效在畫面上是一圈大橘紅圈，先前多次調整尺寸都無效；彈射命中改為與一般命中同尺寸。
- 根因：`spawnImpact()` 建立環形 Sprite 時只設 anchor／tint／座標，尺寸寫在 `addFx` 的 `update()` 內。特效主迴圈反向走訪 `S.fx`，而投射物命中的爆點是在別的特效 `update()`（`spawnProjectile` 的 `onArrive`）裡生出來的，新 fx push 到陣列尾端時迴圈已走過該索引，這一幀必定不會被 update；PIXI 的 render 又排在 ticker 低優先級。結果命中的第一幀以 `scale = 1` 畫出整張 128px 環形貼圖（alpha 1、染成技能色），且不受 `maxR`／`impactScale` 影響——這就是先前四次調整都無效的原因。
- 實測（本機 PixiJS 逐幀量測）：修正前第 3 幀 `scale=1`／寬 128px／`tint=#ff3850`，第 4 幀起 2→7px；修正後 2.8→20.5px，與一般投射物命中的序列完全一致。
- 允許修改：`js/battle-renderer.js`、`js/vfx.js`、`css/style.css`、`index.html`、`tests/projectile-impact-size.test.cjs`、本文件。
- 禁止修改：技能數值、傷害公式、目標選擇、彈射時序、Worker Protocol、存檔格式。
- 完成內容：ring 在建立時即設好起始尺寸（`1.3 / RING_TEX_RADIUS`）並加註為何不能只寫在 `update()`；移除 Canvas／DOM 兩路徑的彈射專用 1/3 縮放（`BOUNCE_HIT_RADIUS_SCALE`、`VFX_BOUNCE_HIT_RADIUS_SCALE`、`--vfx-hit-scale`），彈射命中與一般命中同尺寸；改寫定向測試改為鎖「起始尺寸存在」與「無彈射專用縮放」。
- 驗證結果：定向測試 1/1；完整 `npm.cmd test` 1450/1456（6 項失敗為火系技能數值既有失敗，`git stash` 後同樣失敗，與本次修改無關）；`npm.cmd run build` 282/282；JavaScript 語法檢查與 `git diff --check` 通過；瀏覽器逐幀量測如上。
- 已知風險：所有經由投射物 `onArrive` 產生的命中爆點（火球術、彈幕、彈射）第一幀行為都跟著改變，屬預期修正；同類「只在 update 設初值」的寫法若日後再出現仍會復發，建議未來在 `addFx()` 統一補一次初始化。
- 完成後交給：使用者／主整合工作區。

## Antigravity｜魔法系三大新技能（火球術、火龍捲、火狩）完整測試｜2026-08-17

- 狀態：已完成
- Owner：Antigravity
- 目的：依照 `docs/SKILL_TEST_SPEC.md` 標準測試流程（含 MP 常態充足、排除普攻傷害干擾）完成新版魔法系三大技能群組「火球術 (`fireball`)」、「火龍捲 (`firepillar`)」與「火狩 (`firehunt`)」的 B1~B8 基礎、N1~N10 數值、V1~V7 專屬特效與 120 秒純技能 DPS 矩陣量測。
- 測試報告路徑：`docs/skill-tests/20260817-magic-fire-three-antigravity.md`
- 驗證結果：
  1. 基礎驗證（B1~B8）：解鎖、升降級、金幣消耗、高低階效果疊加、裝載/卸下、存檔往返與非法指令邊界 100% 通過。
  2. 數值驗證（N1~N10）：吃魔攻（MATK）與魔穿（MPEN）、射程與法算半徑（火球 30m/爆炸 6m、火龍捲 30m/3m 連續 5~8 段/無限火牆 3 道 18×6m、火狩 8m 環繞/狩神之舞雙圈反向旋轉）皆符合表定。
  3. 特效驗證（V1~V7）：`variant: fireball` / `meteor` / `fire-explosion` / `pillar` / `firewall` / `aura/firehunt` 專屬特效於 Canvas／DOM 雙路徑正常渲染，Console 零 Error。
  4. 平衡矩陣：120 秒純技能 DPS 量測完成。單體輸出以火龍捲最高（75k~85k DPS），多敵包圍時火狩與火球術表現最突出（火狩全滿達 963k DPS、火球術全滿達 658k DPS）。
  5. 測試指令：`node --test "tests/skill2-*.test.cjs"`（106 項 PASS）、`node --test "tests/*.test.cjs"`（1,456 項全數 PASS）、`node tools/build_check.cjs`（282 檔編譯全數通過）。
- 唯讀規範：未修改核心遊戲程式碼；僅更新測試規範、輸出測試報告與更新任務記錄。

## Codex｜同步火狩畫面特效旋轉速度｜2026-08-17

- 狀態：已完成（2026-08-17）
- Owner：Codex
- 使用者需求：修正火狩已降低模擬旋轉速度，但畫面特效仍以固定每秒 1 圈播放的問題。
- 允許修改：`AI_RULES.md`、`js/skills2.js`、`js/battle-renderer.js`、`js/worker/protocol.js`、`js/worker/sim.worker.js`、`js/bridge.js`、`index.html`、`docs/WORKER_PROTOCOL.md`、`tests/skill2-magic-firehunt.test.cjs`、`tests/skill2-vfx.test.cjs`、`tests/worker-protocol.test.cjs`、本文件。
- 禁止修改：技能傷害、存檔格式、其他技能 VFX 與無關 UI。
- 前置依賴：火狩基礎 `rps=0.455` 已完成；衝突預檢已通過。
- 完成內容：VFX 事件新增 `spinRate` 傳遞實際角速度，Canvas 以該角速度旋轉；舊事件仍可用方向欄位退化；同步 Worker Protocol、主頁／Worker 快取版本；將「實際計算與視覺表現必須一致」寫入 `AI_RULES.md`。
- 驗證結果：火狩／VFX／Worker Protocol 定向測試 37/37；完整 `npm.cmd test` 1456/1456；`npm.cmd run build` 282/282；JavaScript 語法檢查與 `git diff --check` 通過。
- 完成後交給：使用者／主整合工作區。

## Codex｜調整「火狩」技能旋轉速度 -30%｜2026-08-17

- 狀態：已完成（2026-08-17）
- Owner：Codex
- 使用者需求：將「火狩」技能的旋轉速度降低 30%。
- 允許修改：`config/Excel/Skills2.xlsx`、`config/CSV/Skills2.csv`、`js/skills2.js`、`index.html`、`js/worker/sim.worker.js`、`tests/skill2-magic-firehunt.test.cjs`、本文件。
- 禁止修改：其他技能數值、傷害公式、存檔格式、Worker Protocol 與無關 UI。
- 前置依賴：既有火狩環繞場域與 Skills2 參數表同步流程；衝突預檢已通過。
- 完成內容：基礎 `rps` 由 0.65 調為 0.455（原值的 70%），第 5 階加成仍照既有規則疊加；同步 Excel／CSV／JS 與主頁、Worker 快取版本，新增基礎轉速回歸斷言。
- 驗證結果：火狩／Skills2 定向測試 47/47；完整 `npm.cmd test` 1455/1455；`npm.cmd run build` 282/282；`node tools/config_tables.cjs --apply Skills2` dry-run 語意變更 0；JavaScript 語法檢查與 `git diff --check` 通過。
- 已知風險：無；未變更存檔格式、Worker Protocol 或其他技能效果。
- 完成後交給：使用者／主整合工作區。

## Claude｜新版技能「解鎖轉生/等級」門檻｜2026-08-17

- 狀態：已完成（2026-08-17）
- Owner：Claude
- 目的：使用者在 Skills2 參數表新增「解鎖轉生/等級」欄（格式 轉生次數|等級，例如 0|100），要求解鎖後才可升級。
- 使用者決策（2026-08-16）：
  1. 進度比較「轉生數優先，同轉生數才比等級」——達到 1 轉即視為 0 轉的門檻全部通過，以此類推。
     轉生會把等級打回 1，用 AND 比較會讓每次轉生都把整份技能表重新鎖上。
  2. 未解鎖的階一律視為 Lv.0，**含第 1 階的預設開啟**＝技能本身也不能施放
     （否則表上「突刺 0|1、火狩 0|100」沒有意義）。
- 修改內容：
  - `tools/config_tables.cjs`：SCHEMAS.Skills2 增欄（extract／rebuild／欄位定義頁），
    留白＝無門檻不寫進字面值；格式錯誤直接報錯。
  - `js/skills2.js`：`sgTierUnlockedBy`／`sgUnlockText`／`sgUnlockProgress`；
    `sgEffectiveLevels(raw, gid, prog)` 套門檻；`skills2Learn` 增閘門；
    `skills2PanelView` 送出 progress（主執行緒沒有 G，只能靠這一份）。
  - `js/worker/sim.worker.js`：`skill2.max` 一鍵滿級不經過 skills2Learn，自己補一道相同閘門。
  - `js/ui.js`：`sgUiLevels` 改吃快照 progress；`sgStageUnlocked` 加門檻判定；
    新增 `sgStageLockReason`，升級彈窗與 tooltip 顯示實際原因（門檻未到就報門檻）。
- 未解鎖只是「視為 Lv.0」，存檔裡已投入的等級原封不動，達標就原樣回來。
- 測試要求：門檻判定、轉生比較、正規化、投資閘門；受影響的既有測試改成不寫死欄位位置。
- 驗證結果：`npm.cmd test` 1454/1454、`npm.cmd run build` 282 檔通過、`git diff --check` 通過。
- 已知風險：`sgUnlockProgress` 取不到等級／轉生數時不套門檻（維持接線前行為），
  避免面板快照缺欄位時把整份技能表鎖死。
- 後續接手者：Antigravity 驗證技能面板的鎖定呈現與升級阻擋；使用者確認各技能的開放節奏。

## Claude｜修正普攻不出手與擊殺無動作｜2026-08-16

- 狀態：已完成（2026-08-16）
- Owner：Claude
- 目的：使用者回報「轉頭後不會馬上普攻、常常站在原地好幾秒也不會普攻」，且不確定是動畫問題還是沒算傷害。
- 根因（兩個各自獨立的缺陷）：
  1. 模擬層：`fieldTick` 把 `p.atkCd` 的遞減放在「場上沒有可交戰敵人就 return」與「施放技能中」兩道閘門之後，
     整波清空的空窗、新怪還在進場、施放硬直期間冷卻整個停住。敵人走到面前後還要再等一整個攻擊週期才出手。
     `4be1b10` 把負數欠債夾成 0 之後，原本被欠債抵掉的這段等待就浮上檯面。
  2. 顯示層：`vfxTargetsLive` 把「垂死（dying／hp<=0）」也當成失效，而普攻事件延後 `POS_BUFFER_MS` 才播，
     面板同步早已把被殺的敵人標成垂死＝**擊殺的那一刀必定丟掉自己的劍氣與出手動作**。
     傷害飄字走的是另一條判定（只擋已離場），所以數字照跳、動作沒播——這就是「像是沒出手」的來源。
     `53541e4` 才剛把普攻的角色動畫打開，但被這條擋住，等於白開。
- 允許修改：`js/combat.js`、`js/battle-renderer.js`、`index.html`、`tests/multi-enemy.test.cjs`、
  `tests/ui-worker-events.test.cjs`、`tests/skill2-vfx.test.cjs`、本文件。
- 禁止修改：Worker Protocol、存檔格式、攻擊公式、目標選擇、技能數值。
- 修改內容：
  - `js/combat.js`：`playerAttackRate` 與 `atkCd` 遞減移到 `fieldTick` 前段，每個 tick 固定跑一次；
    保留 `Math.max(0, ...)`（`4be1b10` 的負債修正不變），暈眩期間仍停住。
  - `js/battle-renderer.js`：`vfxTargetsLive` 的失效條件收斂成「已離場（gone／實體已移除）」，
    與飄字 `enemyFloatTargetAvailable` 同一條線；`e0fb728`「戰鬥結束後不殘留動作」的原始意圖不變。
- 測試要求：普攻節奏與 VFX 守門的回歸測試；`npm.cmd run build`、完整 `npm.cmd test`、`git diff --check`。
- 完成條件：空窗期冷卻照樣倒數到 ready、敵人一可交戰就出手；擊殺的那一刀仍播出手動作與劍氣。
- 驗證結果：見 commit。
- 已知風險：施放硬直期間冷卻改成照走，技能後銜接普攻變順，DPS 略升（符合 `SKILL_CAST_LOCK`
  「技能不改動 atkCd」的既有設計註記）。暈眩維持凍結，不動控場強度。
- 後續接手者：Antigravity 驗證實機出手節奏與擊殺動作；使用者確認手感。


## Claude｜新版技能第四批：魔法系「火狩」（環繞場域）｜2026-08-16

- 狀態：已完成（2026-08-16）
- Owner：Claude
- 需求來源：設計文檔（Google 試算表「技能」頁籤）〈魔法〉區塊新增技能群組「火狩」，7 階、冷卻 26 秒。
- 目的：實作火狩群組，並把它需要的「環繞場域」做成群組共用能力（不是這個技能的特例）。
- 架構決策：新增第四種場域型態 `SKILL2_RT.orbits`（環繞場域）。與既有 `grounds`（地板場域）的差別只在錨點與命中判定：
  地板場域釘在座標上、按節拍反覆作用；環繞場域釘在玩家身上、以接觸判定命中（進入才算一次），
  因此「碰到敵人即命中一次」不需要另設再命中間隔，命中頻率就是旋轉速度本身。
- 允許修改：`js/skills2.js`、`js/battle-renderer.js`、`js/worker/protocol.js`、`js/worker/sim.worker.js`、
  `js/bridge.js`、`index.html`、`config/CSV/Skills2.csv`、`config/Excel/Skills2.xlsx`、`tools/config_tables.cjs`、
  `tests/skill2-magic-firehunt.test.cjs`（新增）、`tests/skill2-system.test.cjs`、`GM_command.md`、`PATCH.md`、本文件。
- 禁止修改：既有技能數值、傷害公式、存檔格式、Worker 協議欄位（本次只補 `area` 的環形形狀說明，不新增欄位）。
- 前置依賴：第三批（魔法群組 `dmgType`／`elem`、施法距離 `castM`、地板場域）已存在；衝突預檢 12 支檔案全乾淨。
- 實作範圍：
  - 參數表新增 `firehunt` 群組 7 階（群組 `range` 欄＝火狩體積 3*3 米；新鍵 `rps` 每秒圈數、`rings` 道數）。
  - 引擎：`sgCastFirehunt`／`sgSpawnOrbitField`／`sgOrbitStep`／`sgTickOrbits` 等，接在既有 `tickSkill2` 節拍上。
  - 特效：協議 `area` 補環形形狀 `{x,y,r,orbR,orbs,spin}`；`js/battle-renderer.js` 新增 `aura/firehunt` 畫法，
    圓心逐幀取玩家座標（火狩跟著玩家跑），同一道只保留一個節點以支援【再生】延長時的補送事件。
- 待使用者確認的數值：第 4 階【三重火狩】設計表的升級效果寫「每級+5%機率」，但該階沒有機率參數；
  暫定為每級 +15% 火屬性傷害（與第 1 階同樣的 10%／級成長），可直接在參數表調整。
  另外設計表未定義的施法消耗（50）與施法距離（8 米＝環繞半徑）也已填入參數表待調。
- 驗證結果：新增 `tests/skill2-magic-firehunt.test.cjs` 14 項全過；完整 `node --test "tests/*.test.cjs"` 1448/1448；
  `node tools/build_check.cjs` 282/282；參數表往返 `--apply Skills2` 語意變更 0；
  本機實機（8331 埠）以 GM `sglv firehunt max` 實測：`skill2:firehunt` 191 次命中／327,649 傷害，
  VFX 事件為兩道反向環（r=102.8／162.8、orbR=19.275），Canvas 畫法執行無 Console 錯誤。
- 已知限制：瀏覽器分頁未顯示，無法截圖確認環繞特效的實際外觀，需由使用者或 Antigravity 目視確認。
- 後續接手者：Antigravity 實機驗證（見 PATCH.md 的驗證重點）。

## Codex｜修正近戰普攻冷卻負數累積｜2026-08-16

- 狀態：已完成（2026-08-16）
- Owner：Codex
- 目的：修正玩家追擊遠方敵人時普攻 `atkCd` 持續扣成負數，抵達近戰距離後在多個 Tick 連續觸發十幾次普攻的問題。
- 根因：普攻距離閘門只阻止攻擊，沒有阻止冷卻計時器累積負債；抵達後每 Tick 都因 `atkCd <= 0` 重複出手。
- 允許修改：`js/combat.js`、`index.html`、`tests/multi-enemy.test.cjs`、本文件。
- 禁止修改：Worker Protocol、存檔格式、攻擊公式、目標選擇、戰鬥 VFX 與其他 AI／使用者進行中的檔案。
- 前置依賴：既有連續座標近戰距離判定與普攻冷卻流程已存在；目標檔案衝突預檢無其他副本來源。
- 測試要求：新增遠距離等待後抵達只觸發一發普攻的回歸測試；執行多敵人／戰鬥相關測試、JavaScript 語法檢查、`npm.cmd run build`、完整 `npm.cmd test` 與 `git diff --check`。
- 完成條件：`atkCd` 不得低於 0；遠距離等待只保留 ready 狀態，抵達後正常依攻速倒數，不再出現連續補攻；建立 `[Codex]` 前綴 commit。
- 驗證結果：`node --test tests/multi-enemy.test.cjs` 17/17；普攻／戰鬥相關定向測試 57/57；`node --check js/combat.js` 通過；`npm.cmd run build` 281/281；`git diff --check` 通過。完整 `npm.cmd test` 僅有既有未提交火球修改造成的 `tests/projectile-impact-size.test.cjs` 字串回歸失敗，本任務範圍內測試無失敗。
- 後續接手者：Claude Code 唯讀 Review；使用者確認實機攻擊節奏穩定且不再長時間停頓後爆發連打。

## Codex｜恢復近戰普攻角色動畫｜2026-08-16

- 狀態：已完成（2026-08-16）
- Owner：Codex
- 目的：修正玩家走到敵人近戰距離後雖已進行普攻結算，角色卻不播放 `attack1~3` 動畫的問題。
- 根因：`js/battle-renderer.js` 的 `shouldAnimatePlayer()` 將 `cat === 'basic'` 排除，導致普攻 VFX 只畫命中效果而不觸發玩家揮擊。
- 允許修改：`js/battle-renderer.js`、`index.html`、`tests/skill2-vfx.test.cjs`、本文件。
- 禁止修改：戰鬥公式、目標選擇、攻擊距離、Worker Protocol、存檔格式及其他 AI 進行中的檔案。
- 前置依賴：既有 `doPlayerAttack()` 普攻 VFX 事件與 Canvas 角色動畫管線已存在；目標檔案衝突預檢無來源。
- 測試要求：補上普攻可觸發角色動畫、飛刀彈射／連鎖不觸發角色動畫的回歸斷言；執行相關測試、JavaScript 語法檢查、`npm.cmd run build`、完整 `npm.cmd test` 與 `git diff --check`。
- 完成條件：普攻事件恢復播放角色近戰動畫；飛刀彈射、連鎖與已離場目標的延遲事件行為不回歸；快取版號同步並建立 `[Codex]` 前綴 commit。
- 驗證結果：`node --test tests/skill2-vfx.test.cjs` 11/11；`node --check js/battle-renderer.js`、`node --check js/combat.js` 通過；`npm.cmd run build` 281/281；完整 `npm.cmd test` 1433/1433；`git diff --check` 通過。
- 已知風險：尚未在瀏覽器實機重新確認角色揮擊畫面，需由使用者確認走到敵人面前後的實際動畫與持續普攻體感。
- 後續接手者：Claude Code 唯讀 Review；使用者確認實機走到敵人面前後會揮擊並持續普攻。

## Codex｜縮小目標投射物受擊特效半徑｜2026-08-16

- 狀態：已完成（2026-08-16；已修正畫面中央大型圓環）
- Owner：Codex
- 目的：將飛刀與血刃斬彈射目標的命中爆點縮為目前半徑的 1/3，改善彈射命中時遮住敵群與傷害飄字的問題；一般受擊維持原尺寸。
- 需求修訂：除殞石術等明確特殊技能外，一般受擊不再觸發鏡頭震動；一般命中改由目標角色圖片晃動呈現，並保留同一單位每 3 秒最多 1 次的冷卻。
- 再次修訂：一般受擊爆點不套用 1/3 半徑；只有飛刀 `knife-bounce` 與血刃斬 `poison-spread` 的彈射目標命中爆點保留 1/3 半徑。另將截圖中實際造成大白環的 `cleave-arc` 斬擊弧光本體縮為 1/3，不改一般 `vfx-impact`。
- 追加需求：所有飛行子彈速度在目前值上再降低 20%，DOM／Canvas 顯示路徑與彈射段同步延長飛行時間。
- 追加診斷：最新畫面的大型白色圓環不是 `knife-bounce`／`poison-spread` 的 `vfx-impact`，而是 `cleave` 斬擊波的 DOM／Canvas `cleave-arc`；需縮小實際可見的大圓環，同時維持一般 `vfx-impact` 原尺寸。
- 前置依賴：既有 DOM／PixiJS VFX 雙路徑、飛刀 `knife`／`knife-bounce` 與血刃斬 `poison-spread` 共用命中回饋已存在；另一分支僅修改無關的 `lagprobe.js` 快取版號，已保留。
- 允許修改：`js/data.js`、`js/battlefield.js`、`js/bridge.js`、`js/worker/sim.worker.js`、`js/battle-renderer.js`、`js/vfx.js`、`css/style.css`、`index.html`、`tests/hit-react-throttle.test.cjs`、`tests/projectile-impact-size.test.cjs`、`tests/skill-hit-timing.test.cjs`、`tests/skill2-vfx.test.cjs`、本文件。
- 禁止修改：技能數值、傷害公式、目標選擇、彈射距離與時序、Worker Protocol、存檔格式及其他任務內容。
- 驗收：DOM／Canvas 一般目標命中回饋維持原尺寸，僅飛刀／血刃斬彈射目標爆點縮為 1/3；截圖中的 `cleave-arc` 大白環在 DOM／Canvas 都縮為 1/3；一般命中只有角色圖片晃動且同一單位 3 秒最多 1 次；殞石術等特殊技能仍可觸發鏡頭震動；所有飛行子彈速度為原目前值的 80%；執行定向測試、JavaScript `--check`、`npm.cmd run build`、完整 `npm.cmd test` 與 `git diff --check`。
- 驗證結果：本次大圓環／尺寸定向測試 12/12（前一輪尺寸／速度／戰鬥 VFX 定向測試 53/53）、JavaScript `--check` 通過、`npm.cmd run build` 280/280、完整 `npm.cmd test` 1413/1413、`git diff --check` 通過；本地頁面實際載入 `.vfx-cleave-arc` 尺寸 52×52px。
- 已知風險：本地頁面已確認縮小後 CSS 實際載入，但未在高密度彈射技能戰鬥中重現完整截圖；一般受擊與彈射受擊仍在 DOM／Canvas 事件入口分流尺寸，速度調整沿用既有共用倍率。
- 交接：完成後回報修改檔案、測試指令與結果；建立 `[Codex]` 前綴 commit，不合併或推送其他分支。

## Codex｜敵人死亡後清除未播放傷害浮字｜2026-08-16

- 狀態：已完成
- Owner：Codex
- 目的：敵人死亡並從戰場消失後，取消該敵人尚未播放的延遲傷害浮字。
- 允許修改：`js/battle-renderer.js`、`js/ui.js`、`index.html`、`tests/battle-skill-hover.test.cjs`、`tests/damage-float-regression.test.cjs`、`tests/ui-worker-events.test.cjs`、本文件。
- 實作範圍：Canvas 與 DOM 浮字延遲回呼在目標消失後直接丟棄；已顯示中的浮字維持原本生命週期。
- 驗收：相關浮字回歸測試、`node --check`、`npm.cmd run build`、`npm.cmd test`、`git diff --check`。
- 交接：完成後回報修改檔案、測試指令與結果；建立 `[Codex]` 前綴 commit，不合併或推送其他分支。

## Codex｜雙刀亂舞三項技能效果調整｜2026-08-16

- 狀態：已完成
- Owner：Codex
- 目的：依使用者需求更新「狂暴之舞」「鐵血之舞」「嗜血狂化」的設定數值、說明文字與戰鬥行為。
- 允許修改：`config/Excel/Skills2.xlsx`、`config/CSV/Skills2.csv`、`js/skills2.js`、`js/formula.js`、`js/skills.js`、`js/worker/sim.worker.js`、`js/bridge.js`、`index.html`、`tests/skill2-system.test.cjs`、本文件。
- 實作範圍：狂暴之舞提供暴擊率與連擊數並持續 6 秒；鐵血之舞讓自身及 5 米內敵人依最大生命流血；嗜血狂化在 6 秒內依生命／護盾損失提高技能傷害。
- 依賴與風險：需同步 Excel、CSV、`SKILLS2` literal 與前端／Worker 資源版本；不得覆寫其他技能既有設定。
- 驗收：`node --check`、`npm.cmd run build`、相關 Node 測試、`git diff --check`；確認三個技能的 Lv.1 與每級增量及持續時間正確。
- 交接：完成後回報修改檔案、測試指令與結果；預設建立 `[Codex]` 前綴 commit，未自行合併或推送 `develop`。

## Codex：修正飛刀彈射與戰鬥結束後的角色動作殘留（2026-08-16）

- 狀態：已完成（2026-08-16）
- 任務分類：戰鬥 VFX／角色動作時序
- 負責 AI：Codex
- 任務內容：飛刀彈射是子彈自身行為，不得因 `knife-bounce` 事件重播角色普攻動作；戰鬥結束或目標消失後，已排程的普攻 VFX 不得繼續觸發角色動作。
- 前置依賴：既有 Canvas VFX `playerAttackAnim` 與延遲 `setTimeout` 管線；目標檔案衝突預檢無來源。
- 允許修改：`js/battle-renderer.js`、`index.html`、`tests/skill2-vfx.test.cjs`、`docs/AI_TASKS.md`
- 禁止修改：技能數值、傷害公式、目標選擇規則、Worker Protocol、存檔格式及其他技能效果。
- 測試要求：新增飛刀彈射不觸發角色動作與延遲事件失效回歸斷言；執行相關技能測試、JavaScript 語法檢查、`npm.cmd run build`、完整 `npm.cmd test` 與 `git diff --check`。
- 完成條件：只有技能施放事件能觸發角色動作；`knife-bounce` 與已失效目標的延遲 VFX 不得觸發動作；快取版號同步。
- 驗證結果：定向 VFX 測試 11/11 通過；`js/battle-renderer.js` 語法檢查通過；`npm.cmd run build` 278/278 通過；完整 `npm.cmd test` 1404/1404 通過；`git diff --check` 通過。
- 已知風險：尚未進行瀏覽器實機操作驗證，需由使用者確認戰鬥結束後畫面不再播放普攻動作。
- 完成後交給：Claude Code 唯讀 Review；使用者確認戰鬥結束後畫面不再播放普攻動作。

## Codex：修正飛刀彈射必須逐段命中後再出發（2026-08-16）

- 狀態：已完成（2026-08-16）
- 任務分類：新版技能 VFX／飛刀彈射時序
- 負責 AI：Codex
- 任務內容：修正飛刀首發與後續彈射的顯示時序，讓飛刀先抵達 A，再由 A 飛往 B，再由 B 飛往 C；每一段必須以前一段實際飛行時間完成為下一段起點，不得在前一段飛行中提前播放後續彈射。
- 前置依賴：既有 `knife`／`knife-bounce` DOM 與 Canvas VFX 管線、`travelMs` 飛行時間欄位已存在；目標檔案衝突預檢無來源。
- 允許修改：`js/skills2.js`、`js/vfx.js`、`js/battle-renderer.js`、`js/worker/sim.worker.js`、`js/bridge.js`、`index.html`、`tests/skill2-system.test.cjs`、`tests/skill2-vfx.test.cjs`、`docs/AI_TASKS.md`
- 禁止修改：技能數值、傷害公式、目標選擇規則、Worker Protocol、存檔格式及其他技能效果。
- 測試要求：新增飛刀首發／彈射時序回歸斷言；執行相關技能測試、JavaScript 語法檢查、`npm.cmd run build`、完整 `npm.cmd test` 與 `git diff --check`。
- 完成條件：DOM 與 Canvas 均以首發抵達時間作為第一段彈射起點，後續段落依前一段飛行時間串行開始；不改變命中目標與傷害結算規則；快取版號同步。
- 驗證結果：定向技能／VFX 測試 35/35 通過；JavaScript 語法檢查通過；`npm.cmd run build` 278/278 通過；完整 `npm.cmd test` 1403/1403 通過；`git diff --check` 通過。
- 已知風險：尚未進行瀏覽器實機操作驗證，需由 Claude Code／使用者確認飛刀 A→B→C 畫面。
- 完成後交給：Claude Code 唯讀 Review；使用者確認實機飛刀 A→B→C 畫面。

## Codex：技能視覺事件低延遲傳遞（2026-08-15）

- 狀態：已完成（2026-08-15）
- 任務分類：Worker／UI 事件時序與技能施放體感
- 負責 AI：Codex
- 任務內容：保留 Worker 單一遊戲時鐘與每技能獨立 CD；新增技能施放飄字／重要 VFX 的低延遲訊息通道，避免等待一般 0.2 秒 tick 批次。一般日誌、資源與面板資料仍維持批次傳送。
- 允許修改：`docs/AI_TASKS.md`、`docs/WORKER_PROTOCOL.md`、`js/worker/protocol.js`、`js/worker/shim.js`、`js/worker/sim.worker.js`、`js/bridge.js`、`js/ui.js`、`index.html`、`tests/worker-shim.test.cjs`、`tests/worker-protocol.test.cjs`、`tests/p5a-protocol-crosscheck.test.cjs`、`tests/ui-worker-events.test.cjs`
- 禁止修改：技能數值、技能 CD／施放硬直規則、傷害公式、存檔格式與非視覺 Worker 事件語意。
- 前置依賴：現有 `skillCds`／ready queue 已分技能獨立運作；`shimPushEvent` 已集中收集 Worker UI 事件；主執行緒已有視覺事件 frame budget。
- 測試要求：Worker protocol／shim／UI 事件路徑定向測試、相關 JavaScript 語法檢查、`npm.cmd run build`、完整 `npm.cmd test`、`git diff --check`。
- 完成條件：技能施放浮字與重要 VFX 不再等待一般 tick；同一模擬步驟內的視覺事件最多合併成一則低延遲訊息；背景分頁與事件上限行為不回歸；協議版本與快取版號同步。
- 驗證結果：定向 Worker／UI 事件測試 40/40；`node --check`（protocol、shim、sim.worker、bridge、ui）通過；`npm.cmd run build` 278/278；完整 `npm.cmd test` 1400/1400；`git diff --check` 通過。
- 已知風險：尚未進行瀏覽器實機長時間戰鬥觀察；低延遲訊息仍受主執行緒 frame budget 與瀏覽器排程影響。
- 完成後交給：使用者確認技能施放體感。

## Codex：替換突刺光槍為窄版透明素材（2026-08-15）

- 狀態：已完成（2026-08-15）
- 任務分類：突刺 VFX／PNG 素材／透明背景
- 負責 AI：Codex
- 任務內容：使用者確認的窄版光槍圖，中央裁切為原圖約 50% 寬度、保留完整長度，去除洋紅背景並輸出透明 PNG，替換 `images/vfx/thrust_lance.png`。
- 快取：Pixi 素材 URL 使用 `20260815-narrow-rect` 版本參數，避免瀏覽器沿用舊圖。
- 驗證：PNG 為 RGBA 且透明像素約 85%；突刺／VFX 測試、語法檢查、build 與 `git diff --check` 通過。

## Codex：Skills2 新增 range 初始涵蓋範圍欄位（2026-08-15）

- 狀態：已完成（2026-08-15）
- 任務分類：Skills2 配置表／初始幾何範圍
- 負責 AI：Codex
- 任務內容：在 `Skills2.xlsx`／`Skills2.csv` 新增 `range` 欄位，使用「長*寬」（米）格式；突刺填入 `6*2`。程式從群組層 `range` 讀取初始長寬，再由技能程式套用升級倍率與追加距離；範圍欄不代入遊戲說明。
- 其他技能：目前沒有明確矩形初始範圍者留白，不臆填資料。
- 驗證：`config_tables --apply Skills2` 往返語意一致；Skills2 系統測試、語法檢查、build 與 `git diff --check` 通過。

## Codex：調整突刺光槍為沿路徑透明度漸進顯現（2026-08-15）

- 狀態：已完成（2026-08-15）
- 任務分類：突刺 VFX／透明度遮罩／動畫時序
- 負責 AI：Codex
- 任務內容：突刺光槍由我方位置向前飛出；非最後一次使用短光槍沿路徑飛行並淡出，最後一次才完整顯現後淡出，單次突刺直接使用最後一次收尾型態。連段視覺間隔約 220ms，7 次約 1.62 秒播完；單次光槍週期仍依 `spec.dur` 約 0.3 秒運作。
- 允許修改：`css/style.css`、`js/battle-renderer.js`、`js/vfx.js`、`js/skills2.js`、`tests/skill2-vfx.test.cjs`、`docs/AI_TASKS.md`
- 禁止修改：其它技能數值與特效、傷害公式、存檔格式。
- 驗收條件：DOM 與 Canvas 都能看到由我方端向前飛出的連段；最後一次完整顯現並淡出；連續多段突刺在可辨識的節奏內完成。
- 驗證結果：突刺／Worker shim 相關測試 37/37 通過；`npm.cmd run build` 278/278 通過；`git diff --check` 通過。非最後段以飛行距離與淡出比例播放，最後段以顯現／完整／淡出比例播放。
- 完成後交給：使用者確認實機畫面。

## Codex：修正突刺光槍長度傳遞與多段特效次數（2026-08-15）

- 狀態：已完成（2026-08-15）
- 任務分類：突刺 VFX／Worker 事件欄位／多段次數
- 負責 AI：Codex
- 任務內容：修正 Worker shim 遺漏突刺光槍長度、寬度、平行道、方向數與飛行物欄位的問題；依使用者要求讓突刺說明中的多段次數逐項累加並同步播放。
- 允許修改：`js/worker/shim.js`、`js/worker/sim.worker.js`、`js/worker/protocol.js`、`js/skills2.js`、`js/vfx.js`、`js/battle-renderer.js`、`index.html`、`tests/worker-shim.test.cjs`、`tests/skill2-system.test.cjs`、`tests/skill2-vfx.test.cjs`、`docs/AI_TASKS.md`
- 禁止修改：其它技能數值與特效、傷害公式、存檔格式。
- 驗收條件：全滿突刺的光槍長度依實際 6 米×範圍倍率＋貫穿追加距離傳到 DOM／Canvas；第 1 階 2 次、第 7 階追加 3 次、第 2 階觸發時追加 2 次，特效段數與命中段數一致。
- 驗證結果：突刺／Worker shim 相關測試 36/36 通過；`npm.cmd run build` 278/278 通過；`git diff --check` 通過。完整測試僅保留既有的 `battle-skill-hover.test.cjs` 快取版號失敗（要求 `js/ui.js?v=1.0.43`，與本任務無關）。
- 完成後交給：使用者確認實機畫面。

## Codex：依公開技能規格表調整突刺與套用光槍圖片特效（2026-08-15）

- 狀態：已完成（2026-08-15）
- 任務分類：突刺技能規格／命中幾何／DOM 與 Canvas VFX
- 負責 AI：Codex
- 任務內容：只依使用者提供的「技能」分頁調整突刺 1～7 階效果；將突刺本體改為前方 6 米×寬 2 米、兩段 300% 物理傷害，更新連刺、超連刺、擴散、貫穿突刺與八方突刺規則，並以使用者確認的光槍 PNG 作為突刺表現素材。
- 允許修改：`docs/AI_TASKS.md`、`config/CSV/Skills2.csv`、`js/skills2.js`、`js/battlefield.js`、`js/vfx.js`、`js/battle-renderer.js`、`css/style.css`、`index.html`、`images/vfx/thrust_lance.png`、`tests/skill2-system.test.cjs`、`tests/skill2-vfx.test.cjs`
- 禁止修改：其它技能數值與特效、Worker Protocol、存檔格式、與本任務無關的 UI／戰鬥公式。
- 前置依賴：使用者已將 Google 試算表設為知道連結者可檢視；突刺飛行物週期命中與既有 DOM／Canvas VFX 管線已完成。
- 測試要求：突刺技能數值／範圍／八方向命中回歸測試、突刺 VFX 圖片載入測試、相關 JavaScript 語法檢查、`node tools/config_tables.cjs --apply Skills2`、`npm.cmd run build`、`git diff --check`。
- 完成條件：只改突刺；試算表規格完整反映於 CSV／JS／命中幾何；DOM 與 Canvas 均播放指定光槍圖片；飛行物仍依路徑命中並在 0.5 秒追加命中後消失；測試與建置完成。
- 驗證結果：突刺／VFX 相關測試 31/31 通過；`npm.cmd run build` 278/278 通過；`node tools/config_tables.cjs --apply Skills2 --write` 顯示 CSV 與 JS 一致；`git diff --check` 通過。完整測試另有既有的 `battle-skill-hover.test.cjs` 快取版號失敗（要求 `js/ui.js?v=1.0.43`，與本任務無關）。
- 已知風險：試算表「超連刺」與「八方突刺」同時解鎖時採累積解讀（八方方向與超連刺平行路徑）；實機畫面仍需使用者確認圖片尺寸與八方向視覺密度。
- 完成後交給：使用者確認。

## Codex：依參考圖重製突刺光槍特效（2026-08-15）

- 狀態：已完成（待使用者確認）
- 任務分類：突刺 VFX／DOM 與 Canvas 雙路徑
- 負責 AI：Codex
- 任務內容：依使用者提供的窄長白金光槍參考圖，調整突刺飛行特效的中央高亮、金褐色晶刃輪廓、外暈與尖端收束；不改變飛行物實際命中模型。
- 允許修改：`docs/AI_TASKS.md`、`css/style.css`、`js/vfx.js`、`js/battle-renderer.js`、`index.html`、`tests/skill2-vfx.test.cjs`
- 禁止修改：技能傷害、飛行物碰撞、Worker Protocol、存檔格式及其他 AI 進行中任務內容。
- 前置依賴：突刺飛行物與 DOM／Canvas 特效管線已完成；目標檔案衝突預檢無來源。
- 測試要求：突刺 VFX 結構回歸測試、相關 JavaScript 語法檢查、`npm.cmd run build`、`git diff --check`。
- 完成條件：DOM 與 Canvas 突刺均呈現參考圖風格，突刺方向與三向突刺仍正確旋轉，命中邏輯不變。
- 驗證結果：`tests/skill2-vfx.test.cjs` 8/8；`node --check js/vfx.js`、`node --check js/battle-renderer.js` 通過；`npm.cmd run build` 278/278；`git diff --check` 通過。
- 已知風險：瀏覽器實機預覽因瀏覽器控制執行環境初始化錯誤未完成；未改變飛行物實際命中邏輯。
- 完成後交給：使用者確認。

## Codex：將飛出斬擊與貫穿突刺改為週期命中的飛行物（2026-08-15）

- 狀態：已完成（待使用者確認）
- 任務分類：新版技能命中模型／飛行物碰撞
- 負責 AI：Codex
- 任務內容：將會飛出的斬擊與「貫穿突刺」改為具備路徑碰撞的飛行物；飛行物沿路對範圍內敵人命中一次，之後每 0.5 秒再命中一次並立即消失，並使貫穿突刺的特效範圍內目標全部納入命中。
- 允許修改：`docs/AI_TASKS.md`、`js/skills2.js`、`js/battlefield.js`、`js/vfx.js`、`js/battle-renderer.js`、`index.html`、`tests/skill2-system.test.cjs`、`tests/skill2-vfx.test.cjs`
- 禁止修改：其他技能數值、Worker Protocol、存檔格式及其他 AI 進行中任務內容。
- 前置依賴：Antigravity 的迴旋斬基礎目標數調整已合併；既有技能模擬時間與 DOM／Canvas VFX 管線可用；目標檔案衝突預檢無來源。
- 測試要求：飛行物路徑／週期命中與貫穿突刺目標回歸測試、相關 JavaScript 語法檢查、`npm.cmd run build`、完整 `npm.cmd test`、`git diff --check`。
- 完成條件：飛出斬擊與貫穿突刺具備實際路徑命中、每個目標首次命中後每 0.5 秒追加一次並消失、VFX 與命中時序一致、快取版號同步。
- 驗證結果：`tests/skill2-system.test.cjs` 與 `tests/skill2-vfx.test.cjs` 29/29；`node --check`（4 個修改 JavaScript）通過；`npm.cmd run build` 278/278；`git diff --check` 通過。完整 `npm.cmd test` 的既有 `ui.js` 快取版號測試仍要求 `1.0.43`，與本任務無關且未修改該檔案。
- 已知風險：尚未進行瀏覽器實機畫面驗證；無座標的高塔實體沿用主目標退化路徑。
- 完成後交給：使用者確認。

## Codex：技能名稱與傷害飄字左右偏移（2026-08-15）

- 狀態：已完成（待使用者確認）
- 任務分類：戰鬥飄字顯示／可讀性修正
- 負責 AI：Codex
- 任務內容：技能名稱與技能傷害合併飄字不再從人物中心出現；依既有隨機左右方向，初始向左／右偏移約 120px（相當於再外移一個戰鬥大格），並保留小幅向外漂移；總傷害字顯示時間固定為一般技能名稱／傷害字 1.05 秒的 2 倍，即 2.1 秒；延遲飛行物技能必須等實際傷害結算後顯示總數字，Canvas 初始化期間不得遺失浮字。
- 允許修改：`docs/AI_TASKS.md`、`js/battle-renderer.js`、`js/skills2.js`、`js/ui.js`、`index.html`、`tests/battle-skill-hover.test.cjs`、`tests/player-event-float.test.cjs`、`tests/skill2-system.test.cjs`
- 禁止修改：技能數值、技能排程、Worker Protocol、存檔格式與其他 AI 進行中任務內容。
- 前置依賴：既有 `floatPlayerSkillCast` 方向 class、DOM／Canvas 雙路徑與玩家飄字碰撞定位已存在；新版技能飛行物以 `out.dmg` 聚合命中傷害；目標檔案衝突預檢無來源。
- 測試要求：玩家技能飄字定向測試、相關 JavaScript 語法檢查、`npm.cmd run build`、`git diff --check`。
- 完成條件：DOM 與 Canvas 技能名稱／傷害飄字皆以人物中心左右約 120px 為起點，且左右方向一致；總傷害字在所有顯示路徑皆維持一般字的 2 倍時長；延遲命中技能顯示最終總傷害，Canvas 初始化期間的浮字不遺失。
- 驗證結果：`tests/player-event-float.test.cjs` 23/23、`tests/skill2-system.test.cjs` 24/24、`tests/skill2-vfx.test.cjs` 8/8；`node --check js/battle-renderer.js`、`node --check js/skills2.js`、`node --check js/ui.js` 通過；`npm.cmd run build` 278/278；完整 `npm.cmd test` 1398/1398；`git diff --check` 通過。
- 需要 Claude Review：否，屬顯示位置局部修正。
- 需要 Antigravity 驗證：建議，確認不同技能名稱長度與傷害數字不再遮住人物中心或互相重疊。
- 已知風險：尚未進行瀏覽器實機畫面驗證。
- 完成後交給：使用者確認。

## Codex：將迴身雙連斬擴充為十字四向迴旋斬（2026-08-15）

- 狀態：已完成
- 任務分類：新版技能效果／迴旋斬方向表現
- 負責 AI：Codex
- 任務內容：將迴身雙連斬由前後兩向調整為前、後、左、右四個方向各施放 3 次迴旋斬，保留物理傷害額外 +10%。
- 允許修改：`docs/AI_TASKS.md`、`config/Excel/Skills2.xlsx`、`config/CSV/Skills2.csv`、`js/skills2.js`、`js/vfx.js`、`js/battle-renderer.js`、`index.html`、`tests/skill2-system.test.cjs`、`tests/skill2-vfx.test.cjs`
- 禁止修改：其他技能數值、Worker Protocol、存檔格式及其他 AI 進行中任務內容。
- 前置依賴：既有迴旋斬前／後方向與 DOM／Canvas 共用弧光實作；目標檔案衝突預檢無來源。
- 測試要求：新版技能系統／VFX 定向測試、相關 JavaScript 語法檢查、`npm.cmd run build`、完整 `npm.cmd test`、`git diff --check`，並核對 Skills2 Excel／CSV／JS 資料同步。
- 完成條件：十字四方向各 3 次迴旋斬、物理傷害額外 +10%、DOM 與 Canvas 特效一致、快取版號同步。
- 驗證結果：新版技能系統／VFX 定向測試 27/27；`node --check js/skills2.js`、`node --check js/vfx.js`、`node --check js/battle-renderer.js` 通過；`npm.cmd run build` 278/278；完整 `npm.cmd test` 1391/1391；`git diff --check` 通過；Skills2 Excel／CSV／JS 已同步。
- 已知風險：尚未進行瀏覽器實機畫面驗證。
- 完成後交給：使用者確認。

## Codex：調整迴旋斬刀光與迴身雙連斬效果（2026-08-15）

- 狀態：已完成
- 任務分類：新版技能 VFX／刀光可讀性
- 負責 AI：Codex
- 任務內容：將迴旋斬既有刀光的線寬提高 30%，並使迴身雙連斬在前後兩個方向各使出 3 次迴旋斬，物理傷害額外 +10%；DOM 與 Canvas 渲染保持一致。
- 允許修改：`docs/AI_TASKS.md`、`config/Excel/Skills2.xlsx`、`config/CSV/Skills2.csv`、`js/skills2.js`、`css/style.css`、`js/battle-renderer.js`、`index.html`、`tests/skill2-system.test.cjs`、`tests/skill2-vfx.test.cjs`
- 禁止修改：其他技能數值、Worker Protocol、存檔格式及其他 AI 進行中任務內容。
- 前置依賴：既有迴旋斬 DOM／Canvas 弧光、前後方向共用實作與 Skills2 Excel／CSV／JS 同步流程；目標檔案衝突預檢無來源。
- 測試要求：新版技能系統／VFX 定向測試、相關 JavaScript 語法檢查、`npm.cmd run build`、完整 `npm.cmd test`（記錄其他進行中任務失敗）、`git diff --check`，並核對 Skills2 Excel／CSV／JS 資料同步。
- 完成條件：迴旋斬弧光線寬在兩條渲染路徑均提高 30%；迴身雙連斬每方向 3 次且物理傷害額外 +10%；快取版號同步，測試與差異檢查完成。
- 驗證結果：新版技能系統／VFX 定向測試 27/27；`node --check js/skills2.js`、`node --check js/vfx.js`、`node --check js/battle-renderer.js` 通過；`npm.cmd run build` 278/278；完整 `npm.cmd test` 1385/1388，3 個失敗均來自其他進行中 `js/skills.js` 任務；`git diff --check` 通過；Skills2 Excel／CSV／JS 已同步。
- 已知風險：完整回歸中的 3 個 `js/skills.js` 相關失敗不屬本次修改；尚未進行瀏覽器實機畫面驗證。
- 完成後交給：使用者確認。

## Codex：加速技能列就緒監視與自動施放（2026-08-15）

- 狀態：已完成（待使用者確認）
- 任務分類：技能排程／戰鬥效能修正
- 負責 AI：Codex
- 任務內容：修正技能冷卻完成後仍因裝載欄逐次掃描而延遲施放的問題；每個技能在冷卻歸零時加入獨立就緒佇列，符合法力、目標與 AI 條件時立即進入施放。預設施放硬直與每技能最短施放間隔均由參數表讀取，目前配置值皆為 0.2 秒。
- 技術影響：調整 `js/skills.js` 的技能就緒排程與配置驅動的預設施放硬直；保留每技能自身最短施放間隔與明確 `castTime` 技能的施法時間，不修改技能數值、戰鬥公式、存檔格式或 Worker Protocol。
- 允許修改：`docs/AI_TASKS.md`、`js/skills.js`、`js/formula.js`、`config/CSV/game_parameters.csv`、`game_formula.md`、`js/worker/sim.worker.js`、`index.html`、`js/bridge.js`、`tests/skill-gcd.test.cjs`、`tests/skill2-system.test.cjs`
- 禁止修改：技能數值與公式、存檔格式、Worker Protocol、UI 顯示邏輯及其他 AI 進行中任務檔案。
- 前置依賴：既有 `skillCds` 冷卻、`markSkillReady` 與單一玩家戰鬥實體已存在；目標檔案衝突預檢無來源。
- 測試要求：技能就緒佇列／大量裝載技能延遲回歸測試、`node --check js/skills.js`、`npm.cmd run build`、相關技能測試、`git diff --check`。
- 完成條件：技能 CD 歸零後立即由獨立就緒佇列處理，不依裝載欄長度累積掃描延遲；條件不符的技能不阻塞其他已就緒技能；施放硬直與每技能最短間隔皆讀配置表；主頁與 Worker 快取版號同步。
- 驗證結果：技能就緒佇列定向測試 34/34；`node --check js/skills.js`、`node --check js/formula.js`、`node --check js/bridge.js`、`node --check js/worker/sim.worker.js` 通過；`npm.cmd run build` 278/278；完整 `npm.cmd test` 1391/1391；`git diff --check` 通過。
- 已知風險：尚未進行瀏覽器實機畫面驗證；明確 `castTime` 技能仍沿用單一玩家的施放硬直流程。
- 需要 Claude Review：否，屬既有技能排程的局部修正；若驗證發現跨模組語意風險再回報。
- 需要 Antigravity 驗證：建議，確認多技能裝載時 CD 歸零、法力不足、治療條件與目標距離條件的實機施放節奏。
- 完成後交給：使用者確認後合併至整合分支。


## Codex：調整震碎斬與迴身雙連斬的共用迴旋斬特效（2026-08-15）

- 狀態：已完成
- 任務分類：新版技能 VFX／迴旋斬方向表現
- 負責 AI：Codex
- 任務內容：震碎斬向前飛出的刀光改用既有迴旋斬弧光；迴身雙連斬加持時，同次產生前後兩道既有弧光並分別向前後方位移，移除額外圓形震波刀光。
- 允許修改：`docs/AI_TASKS.md`、`js/skills2.js`、`js/vfx.js`、`js/battle-renderer.js`、`css/style.css`、`index.html`、`tests/skill2-vfx.test.cjs`
- 禁止修改：傷害與目標選擇、Worker Protocol、存檔格式、其他技能效果與其他 AI 進行中任務檔案。
- 前置依賴：既有迴旋斬弧光與前／後方命中集合；目標檔案衝突預檢無來源。
- 測試要求：新版技能 VFX 定向測試、相關 JavaScript 語法檢查、`npm.cmd run build`、完整 `npm.cmd test`、`git diff --check`。
- 完成條件：DOM 與 Canvas 均以共用迴旋斬弧光呈現前／後向斬擊，且傷害數字延遲與刀光抵達一致；快取版號同步。
- 驗證結果：新版技能 VFX 定向測試 5/5；`node --check js/vfx.js`、`node --check js/battle-renderer.js` 通過；`npm.cmd run build` 278/278；完整 `npm.cmd test` 1387/1387；`git diff --check` 通過。
- 已知風險：尚未進行瀏覽器實機畫面驗證；Phaser 4 `actions` 範例僅作為方向位移參考，實際刀光仍使用專案既有 DOM／Canvas 弧光。
- 完成後交給：使用者確認。

## Codex：調整血刃斬「死亡屍爆／零日感染」效果（2026-08-15）

- 狀態：已完成
- 任務分類：新版技能效果與 DoT 傳染機制
- 負責 AI：Codex
- 任務內容：死亡屍爆命中附近 2 個敵人後傳染中毒；零日感染在流血／中毒作用時依機率立即結算剩餘傷害，結束後將兩種狀態傳染給 80 米內隨機 1 個敵人，並使兩種 DoT 傷害提高表定倍率。
- 允許修改：`docs/AI_TASKS.md`、`config/Excel/Skills2.xlsx`、`config/CSV/Skills2.csv`、`js/skills2.js`、`index.html`、`tests/skill2-system.test.cjs`、`tests/skill2-review-fixes.test.cjs`
- 禁止修改：Worker Protocol、存檔格式、其他技能效果與其他 AI 進行中任務檔案。
- 前置依賴：既有血刃斬 DoT、毒霧感染、死亡回呼與戰場距離工具；目標檔案衝突預檢無來源。
- 測試要求：新版技能定向測試、`node --check js/skills2.js`、`npm.cmd run build`、完整 `npm.cmd test`（記錄既有失敗）、`git diff --check`，並核對 Skills2 Excel／CSV／JS 資料同步。
- 完成條件：兩項新效果符合需求且有回歸測試；快取版號同步；測試與差異檢查完成。
- 驗證結果：新版技能定向測試 23/23、`npm.cmd run build` 278/278、完整 `npm.cmd test` 1386/1386、`git diff --check` 全部通過；Skills2 Excel／CSV／JS 已同步。
- 已知風險：尚未進行瀏覽器實機畫面驗證；本次狀態與傷害邏輯已由單元測試覆蓋。
- 完成後交給：使用者確認後合併至整合分支。

## Codex：以 Phaser emitter 規則重製火球與殞石粒子（2026-08-14）

- 狀態：已完成
- 任務分類：戰鬥技能 VFX／DOM 與 Canvas 粒子系統
- 負責 AI：Codex
- 任務內容：依使用者提供的 Phaser 範例，移植 `white` flare 粒子的 `color`、`quad.out`、`lifespan: 2400`、`scale: 0.70→0`、`speed: 100`、`advance: 2000` 與 ADD 混合規則；火球與殞石只保留技能需求的方向、數量、尺寸與速度差異。
- 允許修改：`js/vfx.js`、`js/battle-renderer.js`、`css/style.css`、`index.html`、`tests/skill-special-vfx.test.cjs`、`docs/AI_TASKS.md`
- 禁止修改：戰鬥傷害、目標選擇、Worker Protocol、存檔格式與技能數值。
- 前置依賴：Phaser 的 `flares.png`／`flares.json` 已納入專案；DOM 與 PixiJS 已有共用 white frame 載入方式。
- 驗收方式：DOM 與 PixiJS 皆使用逐顆粒子 emitter，命中後仍保留 2.4 秒完整淡出；火球維持直線，殞石維持 60°、1 大＋4 小與慢 30%；語法檢查、定向測試、Build 與 `git diff --check` 通過。
- 驗證結果：定向測試 29/29 通過；`node --check` 檢查 `js/vfx.js`、`js/battle-renderer.js`、`js/skills.js` 通過；`npm.cmd run build` 通過（278 個檔案）；`git diff --check` 通過。
- 已知風險：本機瀏覽器先前無法載入 localhost；實機仍需確認粒子密度與螢幕縮放下的視覺比例。
- 完成後交給：使用者確認。

## Codex：延長殞石拖尾、重做落地震波並縮小火球（2026-08-14）

- 狀態：已完成
- 任務分類：戰鬥技能 VFX／DOM 與 Canvas 視覺微調
- 負責 AI：Codex
- 任務內容：殞石術拖尾延長 35%；參考 Phaser Particle Fountain 的徑向粒子爆散與淡出方式重做落地震波；火球術整體縮小 35%。
- 允許修改：`js/vfx.js`、`js/battle-renderer.js`、`css/style.css`、`index.html`、`tests/skill-special-vfx.test.cjs`、`docs/AI_TASKS.md`
- 禁止修改：戰鬥傷害、目標選擇、Worker Protocol、存檔格式與技能數值。
- 前置依賴：Phaser flare 粒子已納入專案；DOM／Canvas 皆已使用同一套火焰素材。
- 驗收方式：殞石尾焰長度為原本 1.35 倍；火球 flare 群與 Canvas 光暈為原本 0.65 倍；落地顯示多層橢圓震波、徑向火星與塵土；測試、語法檢查、Build 與 `git diff --check` 通過。
- 驗證結果：定向測試 29/29 通過；`node --check` 檢查 `js/vfx.js`、`js/battle-renderer.js`、`js/skills.js` 通過；`npm.cmd run build` 通過（278 個檔案）；`git diff --check` 通過。
- 已知風險：本機瀏覽器先前無法載入 localhost 進行畫面驗證；仍需由使用者確認實機的震波密度與尺寸。
- 完成後交給：使用者確認。

## Codex：以 Phaser flares 粒子重製火球與殞石外觀（2026-08-14）

- 狀態：已完成
- 任務分類：戰鬥技能 VFX／DOM 與 Canvas 視覺重製
- 負責 AI：Codex
- 任務內容：納入 Phaser 範例實際使用的 `flares.png`／`flares.json`，以 white frame 的多層 flare 粒子重做火球術與殞石術；保留火球直線與殞石 60°、1 大＋4 小、慢 30% 的既有時序。
- 允許修改：`images/flares.png`、`images/flares.json`、`js/vfx.js`、`js/battle-renderer.js`、`css/style.css`、`index.html`、`tests/skill-special-vfx.test.cjs`、`docs/AI_TASKS.md`
- 禁止修改：戰鬥傷害、目標選擇、Worker Protocol、存檔格式與技能數值。
- 前置依賴：使用者提供的 Phaser 範例原始碼已確認；前一版僅使用圓形漸層，與範例的 flare 粒子外觀不一致。
- 驗收方式：DOM 與 PixiJS 皆使用同一張 `flares.png` white frame；火球具有白芯／黃身／橙紅外焰與後方火星；殞石維持 60° 路徑與 1 大＋4 小伴隨；相關測試、語法檢查、Build 與 `git diff --check` 通過。
- 驗證結果：`node --check` 檢查 `js/skills.js`、`js/vfx.js`、`js/battle-renderer.js` 通過；定向測試 29/29 通過；`npm.cmd run build` 通過（278 個檔案）；`git diff --check` 通過。
- 已知風險：本機瀏覽器先前無法載入 localhost 進行畫面驗證；仍需由使用者在實機確認最終尺寸與粒子密度。
- 完成後交給：使用者確認。

## Codex：放大火球與殞石群並強化色彩差異（2026-08-14）

- 狀態：已完成
- 任務分類：戰鬥技能 VFX／尺寸與可讀性調整
- 負責 AI：Codex
- 任務內容：將火球與大殞石本體放大約一倍；殞石由 1 顆大殞石加 4 顆小殞石組成，小殞石改用偏橙紅色以提高辨識度與氣勢；殞石飛行速度再降低 30%，並同步延後傷害數字。
- 允許修改：`js/vfx.js`、`js/battle-renderer.js`、`css/style.css`、`index.html`、`tests/skill-special-vfx.test.cjs`、`docs/AI_TASKS.md`
- 禁止修改：戰鬥傷害、目標選擇、Worker Protocol、存檔格式與技能數值。
- 前置依賴：上一版 Phaser 火球／殞石 VFX 已完成；本次目標檔案衝突預檢未發現其他副本或分支修改。
- 驗收方式：DOM 與 PixiJS 的火球／大殞石尺寸約為上一版 2 倍；殞石事件可見 1 大＋4 小，且大小殞石有明顯色差；殞石飛行時間為原本的約 1/0.7 倍，傷害數字同步；相關測試、語法檢查、Build 與 `git diff --check` 通過。
- 驗證結果：技能／VFX 定向測試 29/29 通過；`node --check` 檢查 `js/skills.js`、`js/vfx.js`、`js/battle-renderer.js` 通過；`npm.cmd run build` 通過（278 個檔案）；`git diff --check` 通過。
- 已知風險：本機瀏覽器先前無法載入 localhost 進行畫面驗證；目前依靜態檢查與單元測試完成，實機視覺仍建議使用者確認。
- 完成後交給：使用者確認。

## Codex：依 Phaser 粒子範例調整火球與殞石 VFX（2026-08-14）

- 狀態：已完成
- 任務分類：戰鬥技能 VFX／DOM 與 Canvas
- 負責 AI：Codex
- 任務內容：參考 Phaser `createFlameRegion` 的粒子設定（黃／橙／紅火焰色票、短命火星、ADD 光暈、縮放淡出），將火球術改為單顆直線火球，將殞石術改為右上方 60° 大火球搭配 4 顆小火球斜向砸向目標。
- 允許修改：`js/skills.js`、`js/vfx.js`、`js/battle-renderer.js`、`css/style.css`、`index.html`、`tests/skill-special-vfx.test.cjs`、`docs/AI_TASKS.md`
- 禁止修改：戰鬥傷害、目標選擇、Worker Protocol、存檔格式與技能數值。
- 前置依賴：Phaser 範例原始碼已由使用者提供的網址確認；DOM／PixiJS 技能 VFX 分流已存在；目標檔案衝突預檢未發現其他副本或分支修改。
- 驗收方式：火球術只建立一顆我方→敵方直線火球；殞石術建立一顆大火球與 4 顆小火球，均以 60° 右上→左下路徑進場；相關測試、語法檢查、Build 與 `git diff --check` 通過。
- 驗證結果：技能／VFX 定向測試 33/33 通過；`node --check` 檢查 `js/skills.js`、`js/vfx.js`、`js/battle-renderer.js` 通過；`npm.cmd run build` 通過（278 個檔案）；`git diff --check` 通過。
- 已知風險：本機瀏覽器因環境限制無法載入 localhost 進行畫面驗證；目前依 Phaser 原始碼與既有渲染器的靜態／單元驗證完成，實機視覺仍建議使用者確認。
- 完成後交給：使用者確認。

## Codex：依影片調整傷害飄字動畫（2026-08-14）

- 狀態：已完成
- 任務分類：戰鬥 UI／DOM 與 Canvas 傷害數字 VFX
- 負責 AI：Codex
- 任務內容：參考使用者提供的《吸血鬼倖存者》影片，調整傷害數字的彈出、縮放回彈、上浮與淡出節奏；不改變傷害數值、事件時序或合併規則。
- 允許修改：`css/style.css`、`js/battle-renderer.js`、`index.html`、`tests/player-event-float.test.cjs`、`docs/AI_TASKS.md`
- 禁止修改：戰鬥公式、Worker Protocol、存檔格式、傷害合併／目標選擇邏輯及其他 AI 進行中的檔案。
- 前置依賴：既有 DOM／PixiJS 飄字路徑與影片參考畫面已確認；目標檔案衝突預檢無來源。
- 驗收方式：DOM 與 Canvas 的一般傷害數字都具備快速縮放回彈、短距離上浮及尾段淡出；相關測試、語法檢查、Build 與 `git diff --check` 通過。
- 驗證結果：`node --check js/battle-renderer.js` 通過；傷害／浮字／UI 定向測試 49/49 通過；`npm.cmd run build` 通過（278 個檔案）；`git diff --check` 通過。
- 已知風險：影片沒有提供逐幀特效規格，這版依可觀察畫面做近似還原；字型沿用專案既有字型，未加入像素字型資源。
- 完成後交給：使用者確認。

## Codex：補充戰鬥特效模組註釋（2026-08-14）

- 狀態：已完成
- 任務分類：程式碼可讀性／VFX 維護文件
- 負責 AI：Codex
- 任務內容：在不改變執行行為的前提下，補充 `js/vfx.js` 各主要區塊、事件分派、品質降載、節點生命週期與閃電鏈彈射流程的詳細註釋。
- 允許修改：`docs/AI_TASKS.md`、`js/vfx.js`
- 禁止修改：VFX 執行邏輯、Worker Protocol、戰鬥公式、數值配置、存檔格式及其他 AI 進行中的檔案。
- 前置依賴：已完成 `js/vfx.js` 與 `docs/AI_TASKS.md` 的衝突預檢，未發現其他副本或分支的修改來源。
- 測試要求：`node --check js/vfx.js`、VFX／技能相關定向測試、`git diff --check`。
- 完成條件：主要函式責任、DOM 座標／節點生命週期、閃電鏈第一跳與後續彈射、Canvas／DOM 事件入口及 Full／Reduced／Off 行為均有清楚註釋，且功能測試結果不變。
- 驗證結果：`node --check js/vfx.js` 通過；VFX／技能定向測試 28/28 通過；`npm.cmd run build` 通過（278 個檔案）；`git diff --check` 通過。
- 已知風險：未修改執行邏輯；瀏覽器實機畫面仍沿用既有 VFX 行為，沒有新增視覺回歸風險。
- 完成後交給：使用者確認。

## Antigravity：新版主動技能系統全群組完整測試（2026-08-14）

- 狀態：已完成
- 負責 AI：Antigravity
- 任務內容：依 `docs/SKILL_TEST_SPEC.md` 規範完成 6 個技能群組（thrust／cleave／knife／gale／bloodblade／dualdance）之 §1 基礎、§2 數值、§3 特效與 §4 平衡（DPS 矩陣）全套驗證。
- 測試報告路徑：`docs/skill-tests/20260814-all-antigravity.md`
- 驗證結果：全群組 6 組 B1~B8 基礎功能 100% 通過、N1~N10 數值與機制符合表定、V1~V7 專屬特效無共用借用。**已嚴格排除普攻傷害，僅統計純技能自身輸出（`skill2:<gid>` 獨立紀錄）**，180 檔位 120s 純技能 DPS 矩陣完整輸出（單體 BOSS 戰由 213k 至 459k 呈現明確技能特色分化）。本機測試服 Console 零新增 Error/Warning；測試後環境已依 §0 步驟 7 完整還原（`spawn off`、`statset clear`、`god 0`）。
- 唯讀規範：未修改任何核心或遊戲程式碼；僅輸出測試報告與更新 `docs/AI_TASKS.md`。


## Codex：戰鬥技能格 tooltip 重複觸發與重繪（2026-08-14）

- 狀態：已完成（待使用者確認）
- 任務分類：戰鬥 UI／tooltip 與 DOM 更新修正
- 負責 AI：Codex
- 任務內容：修正滑鼠停在戰鬥技能格時，技能格因戰鬥刷新被反覆替換、tooltip 被重複觸發與閃動的問題；保留同一技能格 DOM 節點，只更新冷卻與狀態內容，並忽略同一錨點的重複 hover 事件。
- 技術影響：只調整戰鬥技能列 DOM 更新與技能 tooltip hover 防抖；不修改戰鬥結果、技能冷卻公式、存檔格式或 Worker Protocol。
- 允許修改：`docs/AI_TASKS.md`、`js/ui.js`、`index.html`、`tests/battle-skill-hover.test.cjs`
- 禁止修改：戰鬥數值與公式、存檔格式、Worker Protocol、非本次 tooltip／技能列範圍的程式，以及其他 AI 進行中任務檔案。
- 前置依賴：既有 `renderBattleSkillBar`、技能 tooltip 事件委派與 RAF 冷卻更新流程已存在；目標檔案衝突預檢無來源。
- 測試要求：技能列 tooltip／DOM 保留回歸測試、相關 JS `node --check`、`npm.cmd run build`、完整 `npm.cmd test`、`git diff --check`。
- 完成條件：滑鼠停留在同一技能格時 tooltip 維持顯示且不反覆重建；冷卻數字仍持續更新；真正換技能或槽位狀態改變時仍能正確更新。
- 需要 Claude Review：否，屬單一 UI DOM／事件小修正；若驗證發現跨模組風險再回報。
- 需要 Antigravity 驗證：建議，確認戰鬥中 hover 技能格時 tooltip 與技能格不閃動。
- 完成後交給：使用者確認後合併至整合分支。
- 驗證結果：新增技能格 hover／DOM 保留回歸測試 4/4；相關 UI／tooltip 測試 28/28；node --check js/ui.js 通過；npm.cmd run build 通過（277/277）；git diff --check 通過。npm.cmd test 已執行約 31 分鐘，未見 assertion failure 但未輸出最終統計，為避免無限等待已中止，不能視為完整測試通過。
- 已知風險：尚未完成瀏覽器實機 hover 驗證；完整測試未取得最終統計。
- 未完成項目：無程式實作未完成；完整全量測試需另行在可接受時間內重跑。

## Codex：角色死亡期間技能列冷卻持續倒數（2026-08-14）

- 狀態：已完成（待使用者確認）
- 任務分類：戰鬥 UI／技能冷卻 Timer 修正
- 負責 AI：Codex
- 任務內容：修正角色死亡復活倒數期間技能列冷卻反覆回到舊值的問題；死亡期間沿用既有 `tickSkillCds` 持續扣減技能冷卻，讓 Worker 快照與 UI 倒數一致。
- 技術影響：只調整野外死亡分支的技能冷卻計時；不修改技能冷卻公式、施放規則、存檔格式或 Worker Protocol。
- 允許修改：`docs/AI_TASKS.md`、`js/combat.js`、`js/worker/sim.worker.js`、`js/bridge.js`、`index.html`、`tests/skill-cooldown-death.test.cjs`
- 禁止修改：`js/worker/protocol.js`、技能數值與公式、存檔格式、其他 AI 進行中任務檔案。
- 前置依賴：既有 `FIELD.reviveCd` 死亡復活流程與 `tickSkillCds` 已存在；目標檔案衝突預檢無來源。
- 測試要求：死亡期間技能冷卻回歸測試、`node --check js/combat.js`、`npm.cmd run build`、相關完整測試、`git diff --check`。
- 完成條件：死亡期間技能冷卻持續遞減並在復活時保留已經過的倒數，不再由快照反覆帶回死亡瞬間的舊值。
- 需要 Claude Review：否，屬單一戰鬥 Timer 小修正；若測試發現跨模組風險再回報。
- 需要 Antigravity 驗證：建議，確認角色死亡後技能列數字持續下降且不跳回舊值。
- 完成後交給：使用者確認後合併至整合分支。
- 驗證結果：新增死亡冷卻回歸測試 1/1；相關死亡／技能／UI 測試 32/32；`npm.cmd run build` 276/276；完整 `npm.cmd test` 1363/1364，唯一失敗為既有 `tests/multi-enemy.test.cjs` 菁英數量表單調性斷言，與本任務無關；相關 JS `node --check` 與 `git diff --check` 通過。
- 已知風險：尚未由瀏覽器實機確認死亡畫面上的技能列體感；邏輯回歸已覆蓋死亡 5 秒期間的冷卻遞減與復活銜接。
- 未完成項目：無。

## Claude：技能檢驗流程規範＋GM 測試指令（2026-08-14）

- Status: Review（規範與指令完成；index.html／sim.worker.js 的快取版號因 Codex 特效工程佔用檔案，待使用者裁決後補）
- Verification: 定向測試 tests/gm-skill-test-tools.test.cjs 4/4；相關回歸 74/75（唯一失敗為既有
  multi-enemy 菁英數量表，與本次無關）；build 274/274；瀏覽器實測（localhost:8330）五指令端到端全部生效
  （god／maxstats／statset atk／sglv max／spawn 20×1000，演武場不補怪不推關，測後已還原）。
- Owner: Claude
- Task: 建立給各 Agent 的技能測試規範 `docs/SKILL_TEST_SPEC.md`（基礎／數值／特效／平衡／環境五類驗證＋
  md 表格報告模板），並補齊規範可執行所需的 GM 測試指令：`god`（鎖血）、`statset`／`maxstats`
  （屬性基準覆寫）、`spawn`（演武場出怪：暫停自然出怪與過關結算、指定數量/敵種/血量倍率）、
  `sglv`（新版技能等級直設）。
- Scope: `docs/SKILL_TEST_SPEC.md`（新增）、`js/gm_exec.js`、`js/combat.js`（演武場出怪與閘門）、
  `js/formula.js`（鎖血下限與屬性覆寫掛點）、`GM_command.md`、`tests/gm-skill-test-tools.test.cjs`（新增）、
  `docs/AI_TASKS.md`
- Forbidden: `index.html`／`js/worker/sim.worker.js`／`js/skills2.js`（Codex 特效工程未提交修改佔用中，
  快取版號更新待使用者裁決後補）；存檔格式；Worker Protocol。
- Verification: 新增 GM 測試工具定向測試；`npm.cmd run build`；`git diff --check`。
- Handoff: 各 Agent 依 `docs/SKILL_TEST_SPEC.md` 執行技能測試並輸出報告至 `docs/skill-tests/`。


## Codex：毒霧感染新增傳染數量參數（2026-08-14）
- 狀態：已完成
- 任務內容：毒霧感染新增 `count` 參數，血毒刃毒作用時依參數傳染附近敵人；同步 Excel／CSV／JS 與測試。
- 允許修改：`config/Excel/Skills2.xlsx`、`config/CSV/Skills2.csv`、`js/skills2.js`、`index.html`、`js/worker/sim.worker.js`、`tests/skill2-system.test.cjs`、`docs/AI_TASKS.md`。
- 驗證：技能相關測試 28/28、Build 通過、Skills2 config apply dry-run 語意變更 0。
- 禁止修改：Worker Protocol、存檔格式及本需求以外的技能邏輯。

## Codex | Cleave VFX follow-up | 2026-08-14
- Status: Completed
- Scope: Large cast-point cleave arcs in DOM/Pixi paths; normal impact-only target feedback; 震碎斬 12 m (120 units) slow wave at 30% projectile speed with path-hit timing; 迴身雙連斬 front/back arcs.
- Files: `config/Excel/Skills2.xlsx`, `config/CSV/Skills2.csv`, `js/skills2.js`, `js/vfx.js`, `js/battle-renderer.js`, `css/style.css`, `index.html`, `js/worker/sim.worker.js`, `tests/skill2-vfx.test.cjs`, `tests/skill2-ui.test.cjs`.
- Verification: targeted tests 37/37; build 273/273; full suite 1356/1357 with the existing unrelated elite quantity monotonicity failure in `tests/multi-enemy.test.cjs`.
- Known risk: browser visual pass is still recommended for final tuning of arc size and wave readability.

## Codex：調整戰鬥飄字與飛行子彈速度（2026-08-14）

- 狀態：已完成（待 Claude Review／Antigravity 驗證）
- 任務分類：戰鬥 UI／VFX 顯示節奏調整
- 負責 AI：Codex
- 任務內容：普攻／普攻暴擊白色傷害字的消失速度提高 35%；技能／技能暴擊黃色傷害字的消失速度提高 20%；技能名稱加數字的施放提示消失速度降低 30%；所有飛行子彈速度降低 25%。
- 技術影響：只調整 DOM／Canvas 浮字顯示壽命、技能施放提示動畫及投射物飛行時間；不修改戰鬥結果、傷害公式、存檔格式或 Worker Protocol。
- 允許修改：`docs/AI_TASKS.md`、`css/style.css`、`js/ui.js`、`js/data.js`、`js/battlefield.js`、`js/vfx.js`、`js/battle-renderer.js`、`index.html`、`tests/player-event-float.test.cjs`、`tests/battlefield.test.cjs`、`tests/skill-hit-timing.test.cjs`、`tests/skill2-ui.test.cjs`。
- 禁止修改：戰鬥數值與傷害公式、存檔格式、Worker Protocol、非本次顯示／VFX 節奏範圍的程式，以及其他 AI 進行中任務檔案。
- 前置依賴：既有四類敵方傷害浮字分類、DOM／Canvas 渲染路徑與 `bfTravelSeconds` 投射物時間計算已完成；目標檔案衝突預檢無來源。
- 測試要求：浮字分類與技能施放動畫定向測試、投射物飛行時間測試、相關 JS `node --check`、`npm.cmd run build`、完整 `npm.cmd test`（記錄既有失敗）、`git diff --check`。
- 完成條件：四類傷害字與技能名稱加數字的視覺／移除時間符合倍率；DOM 與 Canvas 投射物都套用 25% 減速；快取版號同步；測試、Build 與風險回報完成。
- 需要 Claude Review：是，確認 DOM／Canvas 兩條顯示路徑的倍率一致且未改動戰鬥結果。
- 需要 Antigravity 驗證：建議，確認白／黃傷害字、技能名稱加數字與各類飛行子彈的實機體感。
- 完成後交給：Claude Code 唯讀 Review，之後由使用者合併至整合分支。
- 驗證結果：定向測試 62/62 通過；資產版號同步測試 5/5 通過；`npm.cmd run build` 通過（273 個檔案）；完整 `npm.cmd test` 為 1355/1356 通過，唯一失敗為既有 `tests/multi-enemy.test.cjs` 的菁英數量表回歸，與本次修改無關；相關 JS `node --check` 與 `git diff --check` 通過。
- 已知風險：未具備瀏覽器實機操作環境，DOM／Canvas 的最終視覺體感需由使用者或 Antigravity 確認。
- 未完成項目：無。

## Codex：修正換目標間隔計時起點（2026-08-14）

- 狀態：已完成，等待使用者確認
- 任務分類：戰鬥目標切換／Timer 行為修正
- 負責 AI：Codex
- 任務內容：修正 `config/CSV/game_parameters.csv` 的「換目標間隔」在擊殺目標後的計時語意；擊殺後應先等待參數指定秒數，再重新選取、轉向並追擊下一個敵人。
- 技術影響：只調整野外戰鬥玩家目標切換與移動閘門；保留既有普攻冷卻、技能冷卻、傷害公式、Worker Protocol 與存檔格式。
- 允許修改：`docs/AI_TASKS.md`、`js/combat.js`、`index.html`、`tests/multi-enemy.test.cjs`
- 禁止修改：`config/CSV/game_parameters.csv` 的數值、戰鬥公式、存檔格式、Worker Protocol、其他 AI 進行中的檔案。
- 前置依賴：既有 `TARGET_SWITCH_DELAY` 參數與普攻擊殺換目標流程已存在；目標檔案衝突預檢無來源。
- 測試要求：換目標 Timer 回歸測試、相關 JS `node --check`、`npm.cmd run build`、完整 `npm.cmd test`、`git diff --check`。
- 完成條件：擊殺後在等待時間內不移動／不重新選目標；等待結束後才可轉向下一個敵人；既有攻擊與技能流程不回歸。
- 需要 Claude Review：否，屬單一戰鬥 Timer 小修正；如測試發現跨模組風險再回報。
- 需要 Antigravity 驗證：建議，確認實機體感為「擊殺→原地等待→轉向」。
- 驗證結果：新增換目標回歸測試通過；`node --check js/combat.js` 通過；`npm.cmd run build` 通過（272 個檔案）；完整 `npm.cmd test` 為 1349/1350，唯一失敗是既有 `tests/multi-enemy.test.cjs` 菁英數量表單調性斷言，與本次修改無關；`git diff --check` 通過。
- 已知風險：技能仍依自己的冷卻規則運作；本次修正的是普攻鎖定目標的移動／重新選取時機，尚未完成瀏覽器實機體感驗證。
- 未完成項目：無。
- 後續接手者：使用者確認「擊殺→等待→轉向」體感後合併至整合分支。


## Codex：新版技能近戰距離與技能特效優化（2026-08-14）

- 狀態：已完成
- 任務分類：新版主動技能戰鬥特效與攻擊距離調整
- 負責 AI：Codex
- 任務內容：依 `C:/Users/user/OneDrive/Desktop/神力之巔_記事錄.xlsx` 的「技能」工作表，將 6 組新版主動技能統一限制為普攻近戰距離，並補齊突刺貫穿／三向刀光、迴旋斬飛出斬擊、飛刀扇形與彈射、連續斬擊、流血中毒、屍爆及暴風之舞等肉眼可辨識的戰鬥特效。
- 技術影響：只調整新版技能的目標距離與 VFX 事件／DOM／PixiJS 畫法；沿用既有 Worker Protocol `variant` 欄位，不改存檔格式、技能數值、傷害公式或舊技能系統。
- 允許修改：`docs/AI_TASKS.md`、`js/skills.js`、`js/skills2.js`、`js/battlefield.js`、`js/vfx.js`、`js/battle-renderer.js`、`css/style.css`、`index.html`、`tests/skill2-vfx.test.cjs`
- 禁止修改：`js/worker/protocol.js`、存檔格式、舊技能數值與融合規則、新版技能數值 SSOT、其他 AI 進行中任務檔案。
- 前置依賴：新版主動技能系統、連續座標戰場、DOM／PixiJS VFX 管線已完成；Excel「技能」工作表已讀取並完成視覺檢查；目標檔案衝突預檢無來源。
- 測試要求：新版技能 VFX／近戰距離定向測試、相關 JS `node --check`、`npm.cmd run build`、完整 `npm.cmd test`（記錄既有失敗）、`git diff --check`；可行時以測試服確認 DOM 與 Canvas 兩種渲染路徑。
- 完成條件：所有新版技能的目標選取不再使用遠程射程；表格明示的貫穿、三向、飛出、旋轉、連段、彈射、流血／中毒／屍爆等效果具有對應可辨識特效；測試與建置完成並回報風險。
- 需要 Claude Review：是，確認技能特效與攻擊距離沒有改動數值規則。
- 需要 Antigravity 驗證：是，實機確認近戰距離、突刺刀光、彈射路徑、旋風與 DoT／屍爆畫面。
- 完成後交給：Claude Code 唯讀 Review，之後由使用者合併至整合分支。
- 驗證結果：新版技能相關測試 29/29 通過；`npm.cmd run build` 通過（272 個檔案）；完整 `npm.cmd test` 僅剩既有 `tests/multi-enemy.test.cjs` 的菁英數量表回歸失敗，與本次技能／特效修改無關；`git diff --check` 無錯誤。
- 已知風險：低畫質或 Canvas fallback 會依特效預算裁減粒子；沒有座標的高塔 BOSS 仍依既有架構退化為單體命中，無法呈現真實路徑幾何。

## Codex：移除新版技能經驗刷新時的節點放大效果（2026-08-14）

- 狀態：已完成（待 Claude Review／Antigravity 驗證）
- 任務分類：新版技能 UI 視覺修正
- 負責 AI：Codex
- 任務內容：移除新版技能階段節點因滑鼠 hover 產生的放大／縮小效果，避免技能經驗更新重繪時呈現被點擊的視覺誤感。
- 技術影響：只調整新版技能節點 CSS 與樣式版號，不改技能經驗、升級規則、解鎖狀態、Worker Protocol 或存檔格式。
- 允許修改：`docs/AI_TASKS.md`、`css/style.css`、`index.html`、`tests/skill2-ui.test.cjs`。
- 禁止修改：`js/skills2.js` 的技能數值與引擎邏輯、`js/ui.js`、Worker Protocol、存檔格式、戰鬥公式、其他 AI 進行中的檔案。
- 前置依賴：新版技能樹橫向階段 UI 已完成，節點樣式位於 `css/style.css` 的 `.sg-stage-node` 區段。
- 測試要求／結果：新版 UI 定向測試 5/5 通過；`npm.cmd run build` 通過；瀏覽器實測技能頁節點 `transform: none`、畫面正常；Console error/warning 0；`git diff --check` 通過。
- 完成條件：技能節點 hover 與技能經驗刷新不再造成 scale 變化，其餘互動與狀態樣式維持正常。
- 完成後交給：Claude Code 唯讀 Review，之後由使用者合併至整合分支。
- 已知風險：本次未修改技能經驗、升級或解鎖邏輯；完整回歸的既有 `multi-enemy` 失敗與本任務無關。


## Codex：新版技能樹橫向階段與舊版升級彈窗（2026-08-14）

- 狀態：已完成（待 Claude Review／Antigravity 驗證）
- 任務分類：新版技能 UI 版面與互動改造
- 負責 AI：Codex
- 任務內容：將新版主動技能由六個群組圖示改為每個群組一列、七階由左至右排列，階段間加入進階箭頭；已解鎖階段高亮，未解鎖階段置灰但可查看；新版階段點擊後沿用舊版技能的單技能升級彈窗樣式，未解鎖階段不得升級。
- 技術影響：只調整技能面板的 DOM/CSS 顯示與新版階段彈窗的 UI 行為，不改新版技能數值、升級規則、Worker Protocol、存檔格式或舊技能引擎。
- 允許修改：`docs/AI_TASKS.md`、`js/ui.js`、`css/style.css`、`index.html`、`tests/skill2-ui.test.cjs`。
- 禁止修改：`js/skills2.js` 的技能數值與引擎邏輯、Worker Protocol、存檔格式、戰鬥公式、其他 AI 進行中的檔案。
- 前置依賴：新版主動技能系統已完成並提供 `SKILLS2`、`sgEffectiveLevels`、`describeSkill2Tier` 與既有 `skill2.learn`／`skill2.downgrade` 指令。
- 測試要求／結果：新版 UI 與技能定向測試 27/27 通過；`node --check js/ui.js` 通過；`npm.cmd run build` 271/271 通過；瀏覽器實測 6 群組橫向七階鏈、箭頭、亮灰狀態與未解鎖查看流程；Console error/warning 0；`git diff --check` 通過；完整 `npm.cmd test` 1343/1344 通過，唯一失敗為既有 `tests/multi-enemy.test.cjs` 菁英數量表單調性斷言。
- 完成條件：六個群組各自呈現七階橫向箭頭鏈；階段亮／灰狀態符合解鎖規則；點擊未解鎖階段可查看但無升級按鈕；已解鎖階段可在舊版彈窗樣式升級／降級；現有舊技能 UI 不回歸。
- 需要 Claude Review：是，確認新版階段解鎖狀態與舊版彈窗共用行為。
- 需要 Antigravity 驗證：是，實機確認 6 群組橫向排列、箭頭、亮灰狀態及彈窗互動。
- 完成後交給：Claude Code 唯讀 Review，之後由使用者合併至整合分支。
- 已知風險：完整回歸仍有與本任務無關的既有 `multi-enemy` 失敗；新版技能列已在 1280×720 實測收斂為不需水平捲軸，窄視窗則保留水平捲動能力。


## Claude：新版主動技能系統（技能改造第一批）（2026-08-13）

- Status: Done（實作、Review、Antigravity 實機驗證完成且已合併 develop；後續為使用者的 Excel 數值調教）
- Verification: 定向測試 tests/skill2-system.test.cjs 18/18、審查修正測試 tests/skill2-review-fixes.test.cjs 3/3、協議契約 tests/worker-protocol.test.cjs 8/8；
  合計 unit test 29/29 pass、`npm.cmd run build` 270/270 通過；
  Antigravity 實機與邏輯驗證 15/15 全數通過（含 UI 7 階彈窗、循序解鎖/降級保底、裝備 Pending 鍵防重送、
  6 群組野外/高塔自動施放與機制、暴風之舞欠帳夾回與暈眩暫停、存檔與舊技能並行零干擾、Console 無新增 Error/Warning）。
- 調教入口: `config/Excel/Skills2.xlsx`（每階一列；第二頁「欄位定義」有完整參數說明）→ 雙擊「套用參數.bat」。
  雙刀亂舞的冷卻時間設計文檔未給值，暫定 20 秒（表內可調）。
- Owner: Claude
- Task: 依「神力之巔_記事錄.xlsx／技能」頁籤實作新版主動技能系統：6 個技能群組 × 7 階
  （突刺／迴旋斬／飛刀／疾風斬／血刃斬／雙刀亂舞）。同群組在前端顯示為同一個技能持續進化；
  每階上限 10 級且不隨轉生提高；前一階至少 1 級才可投資下一階，第 1 階預設開啟。
  舊技能系統完全不動（並行運作，裝載欄鍵前綴 `sg:`），待使用者調教完畢後另案刪除舊技能。
- Dependencies: 戰場連續座標改版（2026-08-13）已完成；衝突預檢（check-conflicts.ps1）全部副本乾淨。
- Scope: `js/skills2.js`（新增）、`js/battlefield.js`（直線／扇形／最近 N 敵幾何查詢）、
  `js/skills.js`（pickAndCastSkill／equipSkillToLoadout／resetSkillRT／tickSkillSchedulers 的 `sg:` 分支與鏈結）、
  `js/combat.js`（普攻暫停閘門、攻速乘算、虛弱增傷、playerAtkCfg 新增益鍵）、`js/tower.js`（同鏡射）、
  `js/status.js`（新狀態列）、`js/player.js`（`player.skills2` 預設）、`js/save.js`（結構常態化）、
  `js/worker/protocol.js`（v19：skill2.learn／skill2.downgrade）、`js/worker/sim.worker.js`（skills 面板投影＋importScripts）、
  `js/bridge.js`（Worker 資產版號）、`js/ui.js`、`index.html`、`css/style.css`、
  `tools/config_tables.cjs`（SCHEMAS.Skills2）、`套用參數.bat`、`config/Excel/Skills2.xlsx`（新增）、
  `config/CSV/Skills2.csv`（新增）、`config/Excel/Status.xlsx`、`config/CSV/Status.csv`、
  `docs/WORKER_PROTOCOL.md`、`tools/參數表使用說明.md`、`game_formula.md`、`tests/skill2-*.test.cjs`、`docs/AI_TASKS.md`
- Forbidden: 舊技能資料與行為（SKILLS／UNLOCKS／融合／潛力）、存檔格式版本、Worker 職責邊界、其他 AI 進行中任務檔案。
- Verification: 新增 skill2 定向測試（幾何、階層解鎖、施放機制、DoT／屍爆／感染、存檔常態化、協議契約）；
  完整 `npm.cmd test`（不得新增失敗）；`npm.cmd run build`；`node tools/apply_params.cjs` 三項檢查；`git diff --check`。
- Handoff: 使用者以 Excel（config/Excel/Skills2.xlsx）調參後執行「套用參數.bat」；Antigravity 實機驗證施放與特效。

## Codex：戰鬥飄字分區與技能施放名稱顯示（2026-08-13）

- Status: Completed
- Completion: Implemented player damage/benefit float zones, shield text "吸收", and directional yellow skill-cast labels.
- Verification: Targeted float/VFX tests 39/39 passed; build 266/266 passed; full suite 1312/1313 passed with one unrelated existing multi-enemy regression.
- Known risk: Browser/Pixi visual placement should receive a final manual confirmation in the running game.
- Handoff: Ready for review and merge; do not merge or push develop without user approval.
- Owner: Codex
- Task: 將我方承傷數字固定在角色身體附近的紅色區域隨機顯示；護盾吸收、回血、回魔與其他對我方有益的數字移到角色上方藍色區域隨機顯示；護盾吸收文字改為「吸收」；一般技能與潛力技能施放時，以技能圖示加黃色技能名稱從角色中心向左或右隨機平移後消失。
- Dependencies: 既有 DOM 戰鬥飄字、PixiJS Canvas 戰鬥渲染器與 Worker visual event 流程；不需變更 Worker Protocol 欄位、存檔格式或戰鬥公式。
- Scope: `js/util.js`、`js/ui.js`、`js/combat.js`、`js/skills.js`、`js/potential.js`、`js/battle-renderer.js`、`css/style.css`、`index.html`、`tests/player-event-float.test.cjs`、`docs/AI_TASKS.md`
- Forbidden: Worker Protocol、存檔格式、戰鬥數值與其他 AI 進行中任務檔案。
- Verification: 定向玩家事件／技能測試、相關 JS 語法檢查、`npm.cmd run build`、完整回歸測試（記錄既有失敗）、`git diff --check`；必要時以 DOM 與 Canvas 兩種模式實機確認位置及動畫。
- Handoff: Claude Code 唯讀 Review；使用者合併前以瀏覽器確認紅／藍區域與技能名稱動畫。

## Codex：修正 Canvas 護盾條以最大生命為分母（2026-08-13）

- Status: Completed
- Owner: Codex
- Task: Canvas 戰鬥 HUD 的護盾條改用本次護盾 `shieldMax` 計算比例，避免護盾高於最大生命時被 clamp 在滿格。
- Scope: `js/battle-renderer.js`、`index.html`、`tests/player-shield-bar.test.cjs`、`docs/AI_TASKS.md`
- Forbidden: 護盾計算、戰鬥公式、存檔格式與其他非 UI 規則。
- Verification: `node --test tests/player-shield-bar.test.cjs tests/shield-max.test.cjs` 5/5；`node --check js/battle-renderer.js` 通過；build 266/266。
- Known risk: `shieldMax` 由 battle panel 提供，護盾目前值仍由 TICK 高頻視圖提供；未新增 Worker Protocol 欄位。
- Handoff: Claude Code 唯讀 Review；使用者確認護盾高於最大生命時，受到部分傷害也會立即縮短護盾條。

## Codex：修正我方護盾條未隨高頻數值扣減（2026-08-13）

- Status: Completed
- Owner: Codex
- Task: 戰鬥 HUD 優先讀取 TICK 高頻視圖中的玩家血量、魔力與護盾，避免低頻 battle panel 快照讓護盾條寬度停留在舊值。
- Scope: `js/ui.js`、`index.html`、`tests/player-shield-bar.test.cjs`、`docs/AI_TASKS.md`
- Forbidden: 護盾計算、戰鬥公式、Worker Protocol、存檔格式與其他非 UI 規則。
- Verification: `node --test tests/player-shield-bar.test.cjs tests/shield-max.test.cjs tests/skill-gcd.test.cjs tests/skill-mechanics.test.cjs tests/status-system.test.cjs` 50/50；`node --check js/ui.js` 通過；build 266/266。
- Known risk: `shieldMax` 仍沿用 battle panel 快照，僅即時覆寫目前護盾值；本次不改變護盾上限規則。
- Handoff: Claude Code 唯讀 Review；使用者確認戰鬥中護盾條會隨受擊逐步縮短。

## Codex：戰鬥特效七系色票與敵方屬性區分（2026-08-13）

- Status: Completed
- Owner: Codex
- Task: 統一我方技能與地板特效的七系顏色；敵方魔法投射物與受擊回饋依敵人 `attr` 區分。聖為黃白光球、暗為深紫光球、火為紅黃火球、冰為藍白冰晶、電為金黃折線、地為土色方塊、毒為綠色液滴。
- Scope: `js/vfx.js`、`js/data.js`、`js/battle-renderer.js`、`js/combat.js`、`js/potential.js`、`css/style.css`、`index.html`、`tests/vfx-element-colors.test.cjs`、`docs/AI_TASKS.md`
- Forbidden: Worker Protocol、戰鬥公式、傷害數值、存檔格式與其他非特效規則。
- Verification: 目標 VFX 測試 23/23；完整 `npm.cmd test` 已執行且未見失敗；相關 JS `node --check` 通過；`npm.cmd run build` 266/266。
- Known risk: 本次未新增敵方技能事件；Pixi 野外魔法攻擊沿用既有 `enemy.attr` 來源，DOM 後備路徑則將敵方受擊爪痕改為同屬性色。
- Handoff: Claude Code 唯讀 Review；使用者以瀏覽器確認七系投射物、命中特效與地板領域的實際色彩辨識。

## Codex：岩甲護盾改為當前生命值比例（2026-08-13）

- Status: Completed
- Owner: Codex
- Task: 元素特效回復不再以造成傷害值計算；暗影汲取保留 25% 比例但改以攻擊者當前生命值為基準，岩甲將舊有 200% 傷害倍率換算為當前生命值 2% 護盾。
- Dependencies: 使用者補充的新公式；已完成目標檔案衝突預檢且無其他修改來源。
- Scope: `js/formula.js`、`js/data.js`、`js/worker/sim.worker.js`、`js/bridge.js`、`index.html`、`tests/earth-element.test.cjs`、`tests/skill-element-damage.test.cjs`、`tests/talent-elem-attach.test.cjs`、`game_formula.md`、`docs/AI_TASKS.md`
- Forbidden: 獨立技能表中明確命名的 `healPctOfDmg`／`dmgToShieldPct` 規則、Worker Protocol、存檔格式，以及其他 AI 進行中任務檔案。
- Verification: 定向元素測試 29/29；完整測試 1304/1305（唯一失敗為既有 `tests/multi-enemy.test.cjs` 菁英數量表單調性斷言）；build 265/265；`node --check`、`node tools/apply_params.cjs --check-anchors` 554/554、`git diff --check` 通過；主頁與 Worker 快取版本已同步更新。
- Known risk: `js/skills.js` 中明確命名的 `healPctOfDmg`／`dmgToShieldPct` 與聖痕盾仍保留原本的獨立技能設計；若要將所有獨立技能也改成當前生命值比例，需要另行確認各技能的新百分比。
- Handoff: Claude Code 唯讀 Review；重新整理測試服頁面後以新版本載入元素公式，確認岩甲數值符合當前生命值 2%。


## Codex：死亡紅色視野迷霧降至 10% 透明度（2026-08-13）

- Status: Completed
- Owner: Codex
- Task: 將死亡狀態紅色視野迷霧的最高不透明度調整為 10%，保留中心收縮動畫與死亡倒計時。
- Dependencies: 既有死亡倒地、倒數與紅色視野收縮功能已完成；已完成目標檔案衝突預檢。
- Scope: `js/battle-renderer.js`、`index.html`、`tests/player-event-float.test.cjs`、`docs/AI_TASKS.md`
- Verification: 定向測試 21/21；build 265/265；瀏覽器 `canvas=1` 實測已由鮮紅降為淡紅，倒計時與人物仍清楚；不修改 Worker Protocol、存檔格式或戰鬥數值。
- Known risk: 完整測試未重跑；本次僅涉及 PixiJS canvas 視覺透明度。
- Handoff: Claude Code 唯讀 Review；使用者確認淡紅色死亡畫面後合併。

## Codex：修正刷新時遺漏 PowerShell HttpListener 測試服（2026-08-13）

- Status: Completed
- Owner: Codex
- Task: 修正測試服控制台重新整理後遺漏 `8321` 這類由 `.claude/serve.ps1` 啟動的本機測試服。
- 原因: Windows `System.Net.HttpListener` 的 TCP 監聽由 HTTP.sys 以 System PID 4 持有，原掃描器只依 TCP 擁有程序判斷，因而把可正常回應的測試服排除。
- Scope: `tools/test_server_manager.cjs`、`tools/test_server_manager.html`、`tests/test-server-manager.test.cjs`、`docs/AI_TASKS.md`
- Verification: 定向測試 3/3；`node --check tools/test_server_manager.cjs` 通過；`npm.cmd run build` 265/265；`git diff --check` 通過。完整 `npm.cmd test` 為 1302/1303，唯一失敗是既有 `tests/multi-enemy.test.cjs` 菁英數量表單調性回歸，與本次測試服控制台修改無關。
- Known risk: 未修改 HTTP.sys 本身；若其他非遊戲服務也使用 System PID 4 且可回應 HTTP，控制台可能將其列為外部服務，但不會允許關閉系統 PID。
- Handoff: 使用者重新開啟控制台並按「重新整理」，確認 `8321` 顯示；必要時以列表的「關閉」測試該 PowerShell 服務可被定向停止。

## Codex：死亡 UI 間距與倒數字級調整（2026-08-13）

- Status: Completed
- Owner: Codex
- Task: 血條與人物增加 2px 間距；死亡復活倒計時移至人物頭頂上方並放大為 24px。
- Dependencies: 前一項死亡倒地、倒數與紅色視野收縮功能已完成；已完成目標檔案衝突預檢。
- Scope: `js/battle-renderer.js`、`index.html`、`tests/player-event-float.test.cjs`、`docs/AI_TASKS.md`
- Verification: 定向測試 21/21；build 265/265；瀏覽器 `canvas=1` 實測看到放大倒數位於倒地人物頭頂，無需修改 Worker Protocol、存檔格式或戰鬥數值。
- Known risk: 完整測試 1301 通過、1 失敗，仍是既有且與本次 UI 修改無關的 `tests/multi-enemy.test.cjs` 菁英數量回歸。
- Handoff: Claude Code 唯讀 Review；使用者確認死亡畫面後合併。

## Codex：玩家死亡倒地、復活倒計時與紅色視野收縮（2026-08-13）

- Status: Completed
- Verification result: 定向測試 20/20；build 265/265；完整測試 1300/1301，唯一失敗為既有且與本任務無關的 `tests/multi-enemy.test.cjs` 菁英數量回歸。瀏覽器 `canvas=1` 實測無 console 錯誤，確認死亡倒數、紅色中心收縮迷霧與水平血條。
- Known risk: 本次只調整 PixiJS canvas 戰鬥渲染路徑；`?canvas=0` 的 DOM fallback 未變更。既有完整測試失敗仍需另案處理。
- Owner: Codex
- Task: 玩家死亡後播放倒地動作時，血條／法力條維持水平；在死亡狀態顯示整數復活倒計時 `5`～`1`，直到復活完成；死亡期間將戰鬥畫面的黑色視野暗角轉為紅色，並逐漸收縮至中心。
- Dependencies: 既有 `FIELD.reviveCd` 復活倒數與 PixiJS 戰鬥渲染器；已完成目標檔案衝突預檢且沒有其他修改來源。
- Scope: `js/battle-renderer.js`、`index.html`、`tests/player-event-float.test.cjs`、`docs/AI_TASKS.md`
- Forbidden: Worker Protocol、存檔格式、戰鬥數值與復活規則、使用者既有的 `config/Excel/game_parameters.xlsx` 修改，以及其他非本次需求檔案。
- Verification: 新增倒地血條固定、整數倒計時與死亡視野動畫的靜態回歸斷言；執行定向測試、完整測試、build、`git diff --check`。
- Handoff: Claude Code 唯讀 Review；使用者合併前以瀏覽器確認死亡畫面與復活瞬間。

## Codex：我方承傷改為先扣防禦再套減傷（2026-08-13）

- Status: Completed
- Owner: Codex
- Task: 我方承受物理／魔法攻擊時，先以 `max(0, 同類型攻擊 - 有效防禦)` 計算傷害基底，再套用原本的防禦減傷率；敵方承傷維持舊公式。
- Dependencies: 使用者補充規則；已完成目標檔案衝突預檢且無其他修改來源。
- Scope: `js/formula.js`、`scripts/sim/evaluator.js`、`game_formula.md`、`config/CSV/game_parameters.csv`、`index.html`、`tests/defense-reduction.test.cjs`、`docs/AI_TASKS.md`
- Verification: 新增先扣防禦與雙向回歸測試；執行定向測試、完整測試、建置與參數同步檢查。
- Handoff: Claude Code 唯讀 Review；使用者確認承傷數值符合預期。

## Codex：修正防禦減傷公式僅作用於我方（2026-08-13）

- Status: Completed
- Owner: Codex
- Task: 敵人承受玩家攻擊時維持舊版防禦減傷公式；僅我方承受敵人攻擊時套用物理／魔法同類型攻防差值公式。
- Dependencies: 使用者補充規則；上一版公式已合併，已完成衝突預檢且無其他修改來源。
- Scope: `js/formula.js`、`scripts/sim/evaluator.js`、`game_formula.md`、`config/CSV/game_parameters.csv`、`index.html`、`tests/defense-reduction.test.cjs`、`tests/attr-skill-rework-2026-07-30.test.cjs`、`docs/AI_TASKS.md`
- Verification: 新增我方／敵方雙向回歸測試；執行定向測試、完整測試、建置與參數同步檢查。
- Handoff: Claude Code 唯讀 Review；使用者確認敵人可恢復正常受傷。

## Codex：調整物理／魔法防禦減傷公式（2026-08-13）

- Status: Completed
- Owner: Codex
- Task: 將防禦減傷改為 `(1 + max(0, 敵方同類型攻擊 - 我方同類型防禦)) × 我方同類型防禦 / (我方同類型防禦 + a + b × 攻擊者等級)`；物理攻擊使用物防，魔法攻擊使用魔防，`both` 攻擊分別計算兩段。
- Dependencies: Claude 已完成 `index.html` 戰場移動相關合併；本次已重新完成目標檔案衝突預檢且無衝突來源。
- Scope: `js/formula.js`、`scripts/sim/evaluator.js`、`config/CSV/game_parameters.csv`、`game_formula.md`、`index.html`、`tests/defense-reduction.test.cjs`、`tests/attr-skill-rework-2026-07-30.test.cjs`、`docs/AI_TASKS.md`
- Forbidden: Worker Protocol、存檔格式、其他 AI 進行中任務檔案，以及未相關的戰鬥規則或參數。
- Verification: 新增物理／魔法差值與下限回歸測試；執行定向測試、完整 `npm.cmd test`、`npm.cmd run build`、`git diff --check`。
- Known risk: 新公式未額外封頂減傷率；實戰仍由最低傷害下限避免負傷害。完整測試另有既有 `tests/multi-enemy.test.cjs` 菁英數量表失敗，與本任務無關。
- Handoff: Claude Code 唯讀 Review；使用者合併前確認戰鬥承傷與輸出行為。

## Codex：戰鬥改版後裝備詳情與寶石鑲嵌版面修正（2026-08-12）

- Status: Completed
- Owner: Codex
- Task: 加寬裝備功能區，縮減裝備詳情卡與右側寶石素材欄，避免兩者在新版戰鬥版面重疊；裝備詳情文字縮小 1 號，寶石素材固定每列 4 顆。
- Dependencies: 無；已完成 `css/style.css`、`tests/equipment-detail-layout.test.cjs` 與本任務紀錄的衝突預檢。
- Scope: `css/style.css`、`tests/equipment-detail-layout.test.cjs`、`tests/ui-fixed-canvas.test.cjs`、`docs/AI_TASKS.md`
- Forbidden: Worker Protocol、存檔格式、戰鬥公式、數值配置與其他非本次 UI 版面檔案。
- Verification: 版面 CSS 回歸測試 5/5 通過、`npm.cmd run build` 264 個檔案通過、1920×900 瀏覽器實測詳情與素材欄不重疊且寶石每列 4 顆；`git diff --check` 通過。
- Known risk: 完整回歸測試 1275/1276 通過；唯一失敗為既有 `tests/multi-enemy.test.cjs` 菁英數量表單調性測試，與本次版面修改無關。
- Handoff: Claude Code Review；使用者合併前以瀏覽器確認 1920×900 戰鬥畫布中的裝備頁不重疊。

## Codex：熔爐零件分解槽解鎖費用與不足提示（2026-08-11）

- Status: Completed
- Owner: Codex
- Task: 將熔爐零件格解鎖費用改為 `⌊(a + b × 零件解鎖數量^c) × 熔爐數量^d⌋`；前 3 格免費，解鎖第 4 格時零件解鎖數量為 4。金幣不足時在解鎖按鈕上方顯示「金幣不足」浮字。
- 參數：`a=10000`、`b=10000`、`c=2`、`d=3`，來源為「7-分解槽／分解槽解鎖費用」。
- Scope: `config/Excel/game_parameters.xlsx`、`config/CSV/game_parameters.csv`、`js/data.js`、`js/formula.js`、`js/newforge.js`、`js/ui.js`、`tools/apply_params.cjs`、`tests/new-forge.test.cjs`、`tests/sim-forge-parts.test.cjs`、`tests/ui-worker-panels.test.cjs`、`game_formula.md`、`docs/AI_TASKS.md`
- Verification: `node --test tests/new-forge.test.cjs tests/sim-forge-parts.test.cjs tests/ui-worker-panels.test.cjs` 64/64；`npm.cmd test` 1256/1256；`npm.cmd run build` 262/262；`node tools/apply_params.cjs --check-anchors` 551/551；dry-run 0 變更；`git diff --check` 通過。

## Codex：洗煉附魔精華費用依裝備等級縮放（2026-08-11）

- Status: Completed
- Owner: Codex
- Task: 將洗煉附魔精華費用改為「基礎精華費用 × 裝備等級 / d」，結果無條件捨去；目前參數表 `d=50`。
- 前置依賴: 使用者已更新 `config/Excel/game_parameters.xlsx` 與 `config/CSV/game_parameters.csv` 的「7-洗煉／精華費用」第 4 個參數為 50。
- 允許修改: `js/data.js`、`js/formula.js`、`tools/apply_params.cjs`、`tests/reroll-cost.test.cjs`、`game_formula.md`、`docs/AI_TASKS.md`；保留使用者既有參數表變更。
- 禁止修改: Worker Protocol、存檔格式、其他 AI 進行中任務檔案。
- 驗收方式: 普通～傳說、神話／創世／神鑄與混沌系列均依裝備等級縮放；非整數結果無條件捨去；參數錨點與既有功能測試通過。
- 測試要求: `node --test tests/reroll-cost.test.cjs`、完整 `npm.cmd test`、`npm.cmd run build`、`node tools/apply_params.cjs --check-anchors` 與 `git diff --check`。
- Verification: `node --test tests/reroll-cost.test.cjs` 3/3；完整 `npm.cmd test` 1255/1255；`npm.cmd run build` 262/262；`node tools/apply_params.cjs --check-anchors` 547/547；dry-run 變更 0；`git diff --check` 通過。
- 完成內容: 新增 `REROLL_ESSENCE_LEVEL_DIVISOR` 參數並接入 `apply_params`；`rerollCost` 對所有基礎精華費用套用 `Math.floor(基礎費用 × 裝備等級 / d)`；同步更新測試與公式文件。
- 已知風險: `d=50` 時 1～49 級普通裝備的精華費用會依無條件捨去結果為 0，這是目前指定公式的直接結果。
- 未完成項目: 無。
- 後續接手者: 使用者合併至整合分支；必要時以瀏覽器確認低等級裝備顯示 0 精華且可正常執行洗煉。

## Codex：敵人生成後首次攻擊延遲（2026-08-11）

- Status: Completed
- Owner: Codex
- Task: 敵人生成當下即與玩家進行首次攻擊；即使玩家在同一輪立即擊殺敵人，敵人仍至少完成一次攻擊判定。
- 前置依賴: 無；沿用既有 `fieldTick()` 戰鬥順序與 Worker 載入的 `js/combat.js`。
- 允許修改: `js/combat.js`、`tests/multi-enemy.test.cjs`、`docs/AI_TASKS.md`
- 禁止修改: Worker Protocol、戰鬥數值配置、存檔格式、其他 AI 進行中任務檔案。
- 驗收方式: 新波生成後同一個 field tick 內完成首次敵方攻擊；玩家可在該輪擊殺敵人時，仍可觀察到至少一次敵方傷害；既有多敵人與完整測試、build 通過。
- 測試要求: 新增首次攻擊時序回歸測試，執行定向測試、`npm.cmd test`、`npm.cmd run build` 與 `git diff --check`。
- Verification: `node --test tests/multi-enemy.test.cjs` 15/15；`npm.cmd run build` 260/260；`git diff --check` 通過。完整 `npm.cmd test` 1242 項中 1241 通過，唯一失敗為既有 `tests/stage-rework.test.cjs` 場景倍率斷言（期待 5.5、目前資料為 10），與本任務無關。
- 完成內容: `fieldTick()` 出怪後不再立即返回；新波敵人同一輪先完成一次攻擊，再進入玩家行動。首次攻擊與既有週期攻擊共用 `fieldMonsterAttack()`，並避免生成輪的高攻速敵人重複攻擊。
- 已知風險: 尚未進行瀏覽器實機長時間掛機驗證；Worker 會載入相同的 `js/combat.js`，建置與測試已確認載入語法正常。
- 未完成項目: 無。
- 後續接手者: Claude Code 唯讀 Review；必要時以瀏覽器確認敵人生成瞬間的實際傷害飄字與玩家血量。


## Codex：修正測試服控制台重開時誤關閉其他 AI 測試服（2026-08-11）

- Status: Completed
- Owner: Codex
- Task: 重新開啟測試服控制台時，只關閉舊控制台程序，不得因掃描 `test_server_manager.cjs` 而連帶終止 Claude、Codex、Antigravity 已啟動的測試服。
- 允許修改: `啟動測試服.bat`、`tests/test-server-manager.test.cjs`、`docs/AI_TASKS.md`
- 禁止修改: 遊戲核心、測試服服務端實作與其他 AI 進行中任務檔案。
- 驗收方式: 啟動器保留以 `/api/servers` 辨識並關閉舊控制台；移除廣泛終止 `test_server_manager.cjs` 程序的行為；定向測試與 build 通過。
- 前置依賴: 無。
- Verification: `node --test tests/test-server-manager.test.cjs tests/start-test-server.test.cjs` 2/2；`node --check tools/test_server_manager.cjs`；`npm.cmd run build` 259/259。完整 `npm.cmd test` 1236/1239，3 項為本次範圍外既存失敗。
- 完成內容: 移除批次檔依命令列廣泛終止 `test_server_manager.cjs` 的程序掃描，只保留以控制台 API 辨識舊控制台並關閉的流程；補上回歸斷言，確保不會恢復誤殺行為。
- 已知風險: 尚未以三個 AI 同時開啟測試服後實際重跑批次檔；需在使用者環境重開控制台確認舊版與新版測試服都仍列出。
- 後續接手者: 使用者合併至整合分支；必要時進行實機重開控制台驗證。

## Claude：菁英每波數量改為逐張地圖設定（2026-08-10）

- Status: 已完成
- Owner: Claude
- Scope: `config/CSV/game_parameters.csv`（由 xlsx 重新產生）、`tools/apply_params.cjs`、`js/data.js`、`js/formula.js`、`js/bridge.js`、`js/worker/sim.worker.js`、`index.html`、`tests/multi-enemy.test.cjs`、`game_formula.md`、`tools/參數表使用說明.md`、`docs/AI_TASKS.md`
- Task: 使用者在 `game_parameters.xlsx` 把「菁英 數量權重」拆成荒漠／冰原／沼澤／亡靈山脈四列＋「500關之後」一列，並把「小怪 數量權重」改名為「小怪 數量權重100關之後」。接線讓菁英每波數量依地圖選表。
- 技術決策: 新增 `FIELD_ELITE_COUNT_TABLE_BY_ZONE`（鍵為地圖識別碼），未列出的地圖沿用 `FIELD_ELITE_COUNT_TABLE`＝「500關之後」那一列；列名與地圖識別碼的對應集中在 `apply_params.cjs` 的 `ELITE_COUNT_ZONE_ROWS`。同時移除 `fieldCountTableFor` 裡「荒漠前 100 關菁英固定 1 隻」的寫死規則——該區間已由荒漠那一列涵蓋。
- Acceptance: 四張具名地圖各用自己的表、神界三圖走 500 關之後那張；小怪分段與 BOSS 表不變；`apply_params` 試跑 0 變更 0 錨點問題且總數 545→546；`--check-anchors` 全數命中一次；回歸測試與 build 通過。
- Dependencies: 使用者已更新 `config/Excel/game_parameters.xlsx`（CSV 以 `tools/xlsx_to_csv.cjs` 從 xlsx 重新產生，未手改）
- 順帶修正: `tests/sim-evaluator.test.cjs` 4 項對「取樣時機」敏感的斷言。`stepSeconds(600)` 可能剛好落在波次間隔（場上 0 隻敵人），評估器整包回空；出怪節奏一改就換一組 seed 中獎。改為跑到場上有敵人再取樣，並只挑評估器真的探到的部位。太古探針那條的上限（數值倍率 +0.02）本來就是錯的——敵人防禦讓攻擊力回報超線性，實測一直是 1.68，只因為過去每次都落在間隙、斷言被 early return 跳過才沒被發現；改成夾在數值倍率的同一量級（±20%）。
- 已知風險: 神界三圖的菁英數量上限由 3 提高到 8，配合棋盤 4×4 上限；荒漠 1~100 關菁英由固定 1 隻改為 1~3 隻，早期難度會上升。

## Claude：野外 BOSS 每張地圖只能打一次（2026-08-10）

- Status: 已完成
- Owner: Claude
- Scope: `js/data.js`、`js/combat.js`、`js/gm_exec.js`、`js/formula.js`（註釋）、`js/bridge.js`、`js/worker/sim.worker.js`、`index.html`、`tests/stage-rework.test.cjs`、`game_formula.md`、`docs/AI_TASKS.md`
- Task: 野外每 `FIELD_BOSS_STAGE_INTERVAL` 階的 BOSS 改為只能打一次；該關通關後不再出 BOSS，同一階退回菁英規則（菁英規則不變）。
- 技術決策: 「打過了沒」直接讀既有的 `zoneProgress[zone].cleared`（`zoneClearedStage`），不新增存檔欄位、不需 Migration——推關逐關前進，「已通關第 N 關」與「打贏第 N 關的 BOSS」是同一件事。
- Acceptance: 未通關的 BOSS 階照常出 BOSS；通關後同一階出菁英；判定逐張地圖獨立；非 BOSS 的菁英階行為不變；GM 連殺的敵種判定與出怪同規格；回歸測試與 build 通過。
- Dependencies: 無
- Verification: `node --test tests/stage-rework.test.cjs` 10/10；`npm.cmd test`；`npm.cmd run build`。
- 已知風險: 轉生保留關卡進度，因此打過的 BOSS 轉生後也不會回來（經使用者確認的一次性語意）；地圖最後一關若是 BOSS 階，通關後重複挑戰的收益由 BOSS 降為菁英。

## Codex：修正強化成功／失敗浮字消失（2026-08-10）
- Status: Completed
- Owner: Codex
- Scope: `js/ui.js`, `index.html`, `tests/ui-worker-panels.test.cjs`, `docs/AI_TASKS.md`
- Task: 修正 Worker `item.upgrade` 回傳的 `ok`／`fail`／`poor` 被 UI 共用錯誤判定誤當成錯誤，導致強化結果浮字不再顯示。
- Acceptance: 強化成功、失敗與材料不足都能正常顯示按鈕上方浮字；其他 UI 指令的字串錯誤判定不受影響；回歸測試與 build 通過。
- Dependencies: 無
- Verification: `node --test tests/ui-worker-panels.test.cjs --test-name-pattern "Worker panel|item\\.upgrade"` 通過 7/7；`npm.cmd run build` 通過 254 個檔案檢查。
- Full test note: `npm.cmd test` 通過 1205 項，另有既存 `tests/stage-rework.test.cjs` 1 項倍率期待值失敗，與本次修改無關。

## Codex：修正 NPC 表套用後未回寫 `js/data.js`（2026-08-09）

- Status: Completed
- Owner: Codex
- Task: 讓 `config/Excel/NPC.xlsx`／`config/CSV/NPC.csv` 進入既有「套用參數」流程，修改 NPC 名稱、屬性、外觀、魔法型與出現權重後能同步回寫 `js/data.js`，避免刷新後仍使用舊敵人資料。
- 前置依賴: 無；沿用既有 `config_tables.cjs` 的 xlsx／CSV／JS 字面值回寫架構。
- 允許修改: `tools/config_tables.cjs`、`套用參數.bat`、`tools/參數表使用說明.md`、`js/data.js`、`js/bridge.js`、`js/worker/sim.worker.js`、`tests/earth-element.test.cjs`、`docs/AI_TASKS.md`。
- 禁止修改: 戰鬥公式、Worker Protocol、NPC 倍率等非 NPC 表欄位、使用者未要求的其他參數表。
- 驗收方式: NPC 表 dry-run 能偵測 CSV 與 JS 差異；正式套用後 NPC 屬性與權重一致；NPC 倍率等未列入 CSV 的既有欄位保留；定向測試、`npm.cmd test`、`npm.cmd run build` 通過。
- 完成內容: 新增 `NPC` schema 與六表套用順序；`套用參數.bat` 會同步 NPC xlsx/CSV 並回寫七張地圖的 NPC pool；套用時保留未列入 NPC 表的戰鬥倍率；更新 Worker 快取版本。
- 測試結果: NPC／地圖定向測試 23/23、完整測試 1191/1191、`node tools/config_tables.cjs --apply` 語意變更 0、`npm.cmd run build` 252 個檔案全數通過。
- 已知風險: 使用者需先在 Excel 儲存 `NPC.xlsx` 再執行「套用參數.bat」；已開啟的遊戲頁面需等待自動重載或重新整理，才會取得新 Worker 資產版本。
- 未完成項目: 無。
- 後續接手者: Claude Code 唯讀 Review；必要時 Antigravity 實機驗證。

## Codex：修正 GM 關卡修改後地圖進度不同步（2026-08-07）

- Status: Completed
- Owner: Codex
- Task: 修正使用 `stage_jump`／`stage` 等 GM 指令回退場景後，重新推進時前置地圖顯示倒退或與已解鎖後圖不一致的問題。
- 前置依賴: 無；沿用既有有限關卡、`zoneProgress` 與 Worker 存檔架構。
- 允許修改: `js/gm_exec.js`、`js/save.js`、`js/worker/sim.worker.js`、`js/bridge.js`、`tests/gm-command.test.cjs`、`tests/task-system.test.cjs`、`PATCH.md`、`docs/AI_TASKS.md`。
- 禁止修改: Worker Protocol、關卡／掉落權威資料、其他進行中任務檔案。
- 驗收方式: 舊地圖鍵名存檔遷移後，荒漠／冰原／沼澤／亡靈山脈的進度與當前場景一致；GM 回退後既有前置地圖不倒退；Worker 快取版本更新；定向測試、`npm.cmd test`、`npm.cmd run build` 通過。
- 完成內容: `migrateSave` 冪等搬移舊 `plains`／`desert` 進度；GM 數字場景固定依 `ZONE_LIST`；同步更新 Worker 資產快取版本；補上遷移與場景順序回歸測試。
- 測試結果: 定向測試 50/50、完整測試 1190/1190、`npm.cmd run build` 252 個檔案全數通過。
- 已知風險: 尚未做瀏覽器實機操作驗證；舊瀏覽器頁面需重新載入，才會取得新的 Worker 快取版本並套用舊存檔遷移。
- 未完成項目: 無。
- 後續接手者: Claude Code 唯讀 Review；必要時 Antigravity 實機驗證。

## Codex: combat UI input latency follow-up (2026-08-07)

- Status: Completed
- Owner: Codex
- Scope: `js/ui.js`, combat visual-event scheduling, enemy damage-float placement, tower float routing, VFX quality
- Acceptance: visual Worker events are frame-budgeted; enemy damage floats do not force synchronous collision layout; tower damage stays in `tb-float`; `npm.cmd test` and `npm.cmd run build` pass

> **地圖改名（2026-08-07）**：本文件以下內容寫於改名前。第 1 張地圖「草原 `plains`」現為「荒漠 `desert`」，
> 第 2 張「荒漠 `desert`」現為「冰原 `Icefield`」。**`desert` 換了指涉對象**，閱讀舊紀錄時請據此對照（見 PATCH.md）。

本文件記錄 Idle-RPG 專案目前的 AI 任務分配。

每次開始新任務前，先更新本文件。

任務完成並合併後，可以將該任務移到「已完成任務」。

# 使用方式

使用者只需要提供：

- 想完成的功能
- 遊戲規則
- 預期結果
- 已知問題
- 優先級

收到任務的 AI 負責補充：

- 任務分類
- 技術影響
- 負責 AI
- 修改範圍
- 前置依賴
- 測試要求
- Review 與驗證流程



---

# 1. 全域狀態

目前整合分支：

develop

主整合工作區：

D:\MyGame\Idle-RPG\main

目前是否允許合併：

否

目前是否有衝突：

無

目前鎖定中的核心檔案：

無。P0～P5 遷移期的鎖定條件都是「P5 完成」，已全部依其自身條件解除（見第 5 節）。

下方第 5 節與 AGENTS.md 的所有權慣例只用來降低同時修改的機率，
**不是承接任務的門檻**——使用者指派給誰就由誰做完整件事（`AI_RULES.md` 第 3.1 節）。

進行中的大型工程：

~~Web Worker 架構遷移~~ **✅ P0～P5 已完成（2026-07-28）**。

Worker 是模擬與存檔的唯一權威，主執行緒不再持有 `G`，舊單執行緒路徑已移除。
遷移期的計劃書 `docs/WORKER_MIGRATION_PLAN.md` 已刪除——關鍵設計決策與效能基準
已移入 `docs/WORKER_PROTOCOL.md` 第 9、10 節。

長期文件：`docs/WORKER_PROTOCOL.md` + `js/worker/protocol.js`（v9，唯一資料來源）。
**動到 Worker、bridge、面板投影或指令之前必須先讀。**

驗收記錄：`docs/P3_FULL_REGRESSION_REPORT.md`、`docs/P4_BACKPACK_VIRTUAL_SCROLL_REPORT.md`、
`docs/P4_WORKER_AUTO_RESTART_REPORT.md`、`docs/P5_FINAL_ACCEPTANCE_REPORT.md`。

目前階段：

Web Worker 遷移全部完成，無進行中的大型工程。

## Codex：戰鬥中傷害浮字 layout 負載造成操作延遲（2026-08-07）

狀態：已完成（待 Claude Review／Antigravity 驗證）

任務分類：戰鬥 UI 效能／傷害浮字降載／主執行緒輸入延遲

任務目的：處理戰鬥開始後傷害浮字與碰撞避讓造成的同步 layout 負載，讓裝備、洗煉與強化操作維持即時反應；不修改 Worker 戰鬥計算、傷害結果、存檔格式或 Worker Protocol。

負責 AI：Codex

前置依賴：既有 VFX 品質分級、VFX 事件佇列與背景分頁清理流程已完成。

允許修改：`docs/AI_TASKS.md`、`js/ui.js`、`tests/ui-performance.test.cjs`、`tests/player-event-float.test.cjs`、`tests/damage-float-regression.test.cjs`、`tests/ui-worker-events.test.cjs`。

禁止修改：`js/worker/protocol.js`、`js/worker/sim.worker.js`、`js/bridge.js`、戰鬥公式、數值配置、存檔格式，以及其他 AI 進行中的檔案。

具體內容：

- 保留低負載下的多段傷害顯示；浮字數量達到壓力門檻時，自動合併同一目標／來源的視覺數字。
- 高負載時跳過昂貴的浮字碰撞 layout 量測，改用已設定的快速位置，避免每個命中觸發多次 `getBoundingClientRect()`。
- 增加效能契約測試，確認降載只影響視覺層，不改變戰鬥事件與數值流程。

驗證方式：執行指定 UI／飄字測試、`npm.cmd run build`，並檢查 `git diff --check`；必要時依 `docs/ANTIGRAVITY_VFX_UI_TEST_CASES.md` 的長時間戰鬥案例實機驗證。

完成內容：低負載維持多段傷害浮字；同一敵人浮字達 12 個時啟用最多 4 段的視覺合併；浮字超過 24 個時跳過碰撞避讓的同步 layout 量測。Worker 事件、戰鬥數值、時序與存檔流程均未修改。

驗證結果：指定測試 52/52 通過；完整測試 1155 通過、2 個既存失敗（魔塵卸下流程、區域提示文字）；`npm.cmd run build` 通過 250 個檔案；`git diff --check` 通過。

完成後交給：Claude Review，之後由使用者合併至整合分支。

## Codex：隕石特效長時間運行後延遲殘留（2026-08-07）

狀態：已完成（待 Claude Review／Antigravity 驗證）

任務分類：VFX 生命週期／過期事件清理／長時間運行穩定性

任務目的：修正遊戲運行約一小時後隕石特效可能延遲出現、殘留約數秒並與飄字重疊的問題；不修改戰鬥結果、傷害時序或 Worker Protocol。

負責 AI：Codex

任務內容：

- 對隕石特效的延遲與飛行時間做安全上限。
- VFX 佇列中的過期事件不再補播。
- 增加特效節點生命週期看門狗，清理已脫離 DOM 或超過硬期限的節點。
- 補長時間運行與隕石特效回歸測試。

允許修改：`docs/AI_TASKS.md`、`js/vfx.js`、`tests/vfx-performance.test.cjs`。

禁止修改：`js/worker/protocol.js`、`js/worker/sim.worker.js`、`js/bridge.js`、戰鬥公式、數值配置、存檔格式，以及其他 AI 進行中的檔案。

前置依賴：既有 VFX 品質分級、事件佇列與背景分頁清理流程。

完成條件：隕石特效不因佇列延遲而在數秒後集中補播；過期或脫離 DOM 的 VFX 節點可被清理；自動化測試與 Build 通過。

實作與測試結果：已完成隕石延遲／飛行時間上限、過期 VFX 事件跳過、隕石節點硬期限與節點看門狗；指定 VFX／背景清理／技能測試共 17 項通過；`npm.cmd run build` 通過 250 個檔案檢查。完整 `npm.cmd test` 為 1153 通過、1 項既有 `tests/zone-attr-tooltip.test.cjs` class 正則失敗，與本任務修改檔案無關。

需要 Claude Review：是，檢查 Timer、事件佇列與節點生命週期。

需要 Antigravity 驗證：是，依 `docs/ANTIGRAVITY_VFX_UI_TEST_CASES.md` 的 `AG-VFX-007` 與新增 `AG-VFX-009` 長時間穩定性案例觀察隕石特效。

完成後交給：Claude Review，之後由使用者合併至整合分支。

已知風險：若實機仍持續出現大量飄字，可能還需要針對 Worker 事件批次與傷害浮字佇列另行降載；本批先限制 VFX 顯示層，不改戰鬥權威資料。

## Codex：戰鬥特效造成裝備／強化操作延遲（2026-08-06）

狀態：已完成（待 Claude Review／Antigravity 驗證）

任務分類：戰鬥 UI 效能／VFX 降載／裝備操作可靠性

任務目的：戰鬥特效加強後，降低主執行緒在戰鬥期間對裝備、洗煉與強化操作造成的輸入延遲；保留戰鬥計算與操作結果的權威性，不修改戰鬥公式、存檔格式或 Worker Protocol。

負責 AI：Codex

任務內容：

- 新增 VFX 品質分級與裝備／強化互動期間的降級策略。
- 對純視覺 VFX 事件做限流、合併與低優先級丟棄。
- 快取戰場特效錨點座標，避免每個特效重複量測 DOM。
- 降低裝備／背包操作期間不必要的戰鬥與面板重繪。
- 新增自動化效能契約測試與 Antigravity 唯讀瀏覽器測試用例 Markdown。

技術影響：僅影響主執行緒 VFX 顯示、UI 重繪與純視覺事件排程；Worker 模擬結果、Command ACK、面板權威資料與存檔行為維持不變。

允許修改：`docs/AI_TASKS.md`、`js/vfx.js`、`js/ui.js`、`tests/vfx-performance.test.cjs`、`docs/ANTIGRAVITY_VFX_UI_TEST_CASES.md`。

禁止修改：`js/worker/protocol.js`、`js/worker/sim.worker.js`、`js/bridge.js`、戰鬥公式、數值配置、存檔格式，以及其他 AI 進行中的檔案。

前置依賴：既有 Worker UI／VFX 協議與背景分頁清理流程已完成。

測試要求：執行新增 VFX 效能契約測試、既有 `tests/ui-performance.test.cjs`、`tests/vfx-background.test.cjs`、`tests/skill-vfx.test.cjs`，並執行 `npm.cmd run build`；Antigravity 依新增 Markdown 實際操作驗證戰鬥中切換裝備頁、洗煉、強化、連續操作與 VFX 降級恢復。

實作與測試結果：已完成 VFX Full／Reduced／Off 分級、事件佇列每幀預算、短窗合併、佇列上限、座標快取與版面失效通知；裝備／非戰鬥頁降低戰鬥重繪頻率並加入輸入保護。指定效能／UI／VFX 測試共 26 項通過；完整 `npm.cmd test` 共 1151 項通過；`npm.cmd run build` 通過 250 個檔案檢查。

完成條件：特效高峰期間不阻塞裝備 Command 的輸入處理；Reduced 模式可保留主要命中回饋；VFX 純視覺事件不影響戰鬥結果；自動化測試、Build 與 Antigravity 測試用例文件完成。

需要 Claude Review：是，檢查 Timer／Event 生命週期、UI 狀態一致性與效能回歸。

需要 Antigravity 驗證：是，依 `docs/ANTIGRAVITY_VFX_UI_TEST_CASES.md` 執行唯讀瀏覽器驗證。

完成後交給：Claude Review，之後由使用者合併至整合分支。

已知風險：Canvas／WebGL 遷移不納入本批；若實機效能仍不足，下一批再評估 Canvas VFX 層。不同瀏覽器與 GPU 對 CSS filter／box-shadow 的成本可能不同。

## Codex：高塔 BOSS 單次傷害上限 20%（2026-08-06）

狀態：已完成

任務分類：高塔戰鬥規則／BOSS 生存機制

任務目的：高塔 BOSS 每次實際扣除生命的傷害不得超過最大生命 20%，使其至少承受五次命中才會死亡；護盾吸收不計入生命傷害上限。

負責 AI：Codex

允許修改：`docs/AI_TASKS.md`、`js/formula.js`、`js/combat.js`、`js/skills.js`、`js/potential.js`、`js/legendary.js`、`js/tower.js`、`tests/tower-xp.test.cjs`

禁止修改：BOSS 基礎數值、掉落資料、存檔格式、Worker Protocol 契約與其他 AI 進行中的檔案。

前置依賴：高塔既有 BOSS 傷害結算流程已完成。

驗收方式：高塔 BOSS 的普通攻擊、技能、真傷、DoT 與傳奇直接傷害單次實際扣血均不超過最大生命 20%；連續五次達到上限可擊殺；一般地圖 BOSS 不受此規則影響。

完成結果：高塔 BOSS 加入專用旗標，普通命中與所有直接扣血路徑統一套用最大生命 20% 的單次生命傷害上限；護盾吸收先行結算，融合技同一次命中合併計算上限；一般地圖 BOSS 維持原傷害行為。

測試結果：高塔／技能回歸測試 33/33 通過；完整 `npm.cmd test` 1127/1127 通過；`npm.cmd run build` 245/245 通過。

## Claude：新增主線任務系統（2026-08-05）

狀態：已完成（待 Antigravity 驗證）

任務分類：新系統／任務與獎勵

任務目的：新增 22 個循序主線任務（設計文檔：神力之巔_記事錄.xlsx「任務」頁籤）。
戰鬥區上方顯示任務快捷列（進行中黃點／可領取綠點；點擊領獎或開啟任務總覽彈窗）；
任務參數與文字撥離為第五張配置表（`config/Excel/Task.xlsx` → `config/CSV/Task.csv` → `js/data.js` 的 `TASKS`）。

負責 AI：Claude

修改範圍：`config/Excel/Task.xlsx`、`config/CSV/Task.csv`（新增）、`tools/config_tables.cjs`（Task schema）、
`套用參數.bat`、`tools/參數表使用說明.md`、`js/tasks.js`（新增，Worker 端）、`js/data.js`（`TASKS`）、
`js/item.js`（洗煉/合成計數掛勾、`makeEquipment` 支援指定太古條數）、`js/player.js`（`taskState` 與
`factory.stats.rerolled/gemComposed`）、`js/save.js`（遷移夾限）、`js/worker/protocol.js`（v18：`task` 面板、
tick 三純量、`task.claim` 指令）、`js/worker/sim.worker.js`、`docs/WORKER_PROTOCOL.md`、`js/bridge.js`（資產版號）、
`index.html`、`css/style.css`、`js/ui.js`（快捷列與總覽彈窗）、`tests/task-system.test.cjs`（新增）、
`tests/worker-protocol.test.cjs`（契約同步 v18）。

測試結果：`tests/task-system.test.cjs` 10/10 通過；完整 `npm test` 1057/1057 通過；`npm run build` 238/238 通過。

完成後交給：Antigravity 驗證（驗證重點見任務回報）。

## Codex：地圖自動推進必須擊敗最後 Boss（2026-08-06）

狀態：已完成

任務分類：地圖解鎖／自動推進規則

任務目的：只有實際擊敗目前地圖最高關卡的 Boss，才允許自動推進切換至下一張地圖第 1 關；僅抵達最高關卡不可解鎖下一張地圖。

負責 AI：Codex

允許修改：`docs/AI_TASKS.md`、`js/data.js`、`js/combat.js`、`js/worker/sim.worker.js`、`js/bridge.js`、`tests/multi-enemy.test.cjs`、`tests/stage-rework.test.cjs`、`tests/god-realm-zones.test.cjs`

禁止修改：戰鬥數值、掉落資料、Worker Protocol 契約與其他 AI 進行中的檔案。

前置依賴：既有自動推進跨地圖功能已完成。

驗收方式：驗證抵達最高關卡但 `cleared` 尚未達上限時不可解鎖／跨圖；擊敗最後 Boss 後可切換至下一張地圖第 1 關。

完成結果：地圖解鎖、手動切圖與自動跨圖均改用前一張地圖實際擊敗的最高關卡 `cleared` 判定；自動推進跨圖另加來源地圖上限檢查。同步更新 Worker 快取版號與相關測試資料。

測試結果：地圖／戰鬥回歸測試 21/21 通過；完整 `npm test` 1125/1125 通過；`npm run build` 245/245 通過。

## Codex：魔法屏障提前至護盾 20% 門檻施放（2026-08-06）

狀態：已完成

任務分類：技能自動施放／護盾保命

任務目的：魔法屏障在目前護盾低於或等於最大生命的 20% 時即可施放，避免等到護盾完全消失才補盾而導致玩家死亡。

負責 AI：Codex

允許修改：`docs/AI_TASKS.md`、`js/skills.js`、`js/worker/sim.worker.js`、`js/bridge.js`、`tests/skill-gcd.test.cjs`

禁止修改：技能數值、存檔格式、Worker Protocol 契約與其他 AI 進行中的檔案。

前置依賴：既有 `ai:shield` 技能自動施放條件已完成。

驗收方式：護盾高於最大生命 20% 時不施放；護盾等於最大生命 20%、低於該門檻或已歸零時允許施放。

完成結果：`ai:shield` 施放條件由最大生命 5% 提高為 20%，護盾消失前會更早重施魔法屏障；同步更新 Worker 快取版號，避免瀏覽器沿用舊技能邏輯。

測試結果：技能回歸測試 25/25 通過；完整 `npm test` 1126/1126 通過；`npm run build` 245/245 通過。

## Codex：大量拆解後零件升級點擊延遲（2026-08-06）

狀態：已完成

任務分類：熔爐 UI／Worker 面板效能／點擊可靠性

任務目的：大量裝備快速拆解後，避免數千件佇列裝備完整複製到主執行緒，並避免熔爐頁重建零件升級按鈕造成 pending 狀態看似失效。

負責 AI：Codex

允許修改：`docs/AI_TASKS.md`、`js/worker/sim.worker.js`、`js/ui.js`、`tests/new-forge.test.cjs`、`tests/newforge-panel-performance.test.cjs`

禁止修改：Worker Protocol、戰鬥數值、掉落資料、其他 AI 進行中的檔案。

前置依賴：無。

完成結果：新增熔爐輕量面板投影，只傳佇列數量、傳送帶摘要與零件設定；零件升級區改用內容變更檢查，保留 pending 按鈕的 disabled 狀態。

測試結果：熔爐／UI／Worker 回歸測試 58/58 通過；`npm run build` 244/244 通過。

## Codex：修正零件升級後面板仍顯示 T1（2026-08-06）

狀態：已完成

任務分類：熔爐 UI 投影／零件等級顯示

任務目的：修正熔爐輕量面板投影中的空 `partLevels` 優先於 `factory.partLevels`，導致實際已扣除高階升級費用但畫面仍顯示 T1。

負責 AI：Codex

允許修改：`docs/AI_TASKS.md`、`js/worker/sim.worker.js`、`tests/newforge-panel-performance.test.cjs`

禁止修改：存檔格式、戰鬥數值、升級公式與其他 AI 進行中的檔案。

前置依賴：前一項熔爐面板效能修正已完成。

完成結果：移除 `newForgePanelView` 中錯誤的空零件等級欄位，讓 UI 正確回退使用 `factory.partLevels`；補上回歸斷言。

測試結果：熔爐／零件升級回歸測試 55/55 通過；`npm run build` 244/244 通過。

## Codex：關閉自動推進時仍解鎖下一關（2026-08-05）

狀態：已完成

任務分類：關卡流程／最高關卡進度

任務目的：關卡完成後，不論是否勾選「自動推進」，都將最高關卡推進一關；關閉自動推進時維持目前關卡不變，繼續重複挑戰該關。

負責 AI：Codex

允許修改：`docs/AI_TASKS.md`、`js/combat.js`、`tests/multi-enemy.test.cjs`

禁止修改：Worker Protocol、關卡／掉落資料、其他 AI 進行中的檔案。

前置依賴：無。

測試要求／結果：新增自動推進開／關兩種情境的關卡完成測試；定向測試 2/2 通過；`npm run build` 235/235 通過；完整 `npm test` 1026/1034 通過，8 項為既有失敗，未涉及本次關卡邏輯。

完成條件：關閉自動推進時，完成第 40 關後 `stage.best` 為 41 且 `stage.current` 仍為 40；開啟時維持既有自動切換行為。

完成結果：`completeFieldWave()` 在每次野外戰鬥完成後，先將 `stage.best` 推進至下一關（受地圖上限限制），再依 `autoAdvance` 決定是否更新 `stage.current`。

## Codex：自動推進打通地圖後切換下一張場景（2026-08-06）

狀態：已完成

任務分類：關卡流程／場景自動切換

任務目的：勾選「自動推進」時，打通目前地圖最高關卡後，自動切換至下一張已解鎖場景並從第 1 關開始；沒有下一張可用場景時維持地圖完成狀態。

負責 AI：Codex

允許修改：`docs/AI_TASKS.md`、`js/combat.js`、`tests/multi-enemy.test.cjs`、`tests/stage-rework.test.cjs`

禁止修改：Worker Protocol、關卡／掉落資料、其他 AI 進行中的檔案。

前置依賴：無。

測試結果：定向測試 19/19 通過；`npm run build` 242/242 通過；完整 `npm test` 1088/1088 通過。

完成結果：`completeFieldWave()` 在自動推進打通目前地圖上限時，依 `ZONE_LIST` 找到下一張已解鎖且上限更高的場景並呼叫 `switchZone()`；無下一張可用場景時才維持 `mapComplete` 停止出怪。

## Codex：死亡敵人淡出期間避免血條重繪（2026-08-06）

狀態：已完成

任務分類：戰鬥 UI／死亡動畫

任務目的：敵人進入死亡漸隱至延遲清除期間，後續 Worker 快照不得再次把血條與血量文字重設為 0，也不得重播致死血條動畫。

負責 AI：Codex

允許修改：`docs/AI_TASKS.md`、`js/ui.js`、`tests/damage-float-regression.test.cjs`

禁止修改：Worker Protocol、戰鬥數值、掉落資料、其他 AI 進行中的檔案。

前置依賴：無。

測試結果：定向測試 32/32 通過；`npm run build` 242/242 通過；完整 `npm test` 1089/1089 通過。

完成結果：`renderBattle()` 對已套用 `.is-dead` 且生命值為 0 的卡片直接保留現有死亡淡出視覺，直到卡片被清除或新一波重建。

## Codex：背景切回後清理過期戰鬥特效（2026-08-06）

狀態：已完成

任務分類：戰鬥 UI／背景分頁恢復

任務目的：玩家切到背景分頁一段時間再回來時，不因瀏覽器暫停 CSS animation 與 timer，讓過期的領域、光束、粒子與受擊閃光堆積在戰鬥畫面。

負責 AI：Codex

允許修改：`docs/AI_TASKS.md`、`js/ui.js`、`js/vfx.js`、`tests/vfx-background.test.cjs`

禁止修改：Worker Protocol、戰鬥數值、掉落資料、其他 AI 進行中的檔案。

前置依賴：無。

完成結果：切入背景時停用並清除 VFX 節點、受擊閃光與場景震動，並以 generation 使已排程的延遲 callback 失效；回到前景後重新啟用特效。

測試結果：定向測試 31/31 通過；`npm run build` 243/243 通過；完整 `npm test` 有 1 項與本任務無關的既有裝備欄樣式測試失敗（測試仍期待 `brightness(1.2)`，目前樣式為 `brightness(1.7)`）。

## Codex：第三套裝備改為 1 轉 Lv.500 開放（2026-08-05）

狀態：已完成

任務分類：裝備套裝解鎖／轉生條件

任務目的：將第三套裝備的開放條件由角色 Lv.2000 改為完成 1 轉且角色 Lv.500。

負責 AI：Codex

允許修改：`docs/AI_TASKS.md`、`js/data.js`、`js/player.js`、`js/save.js`、`js/ui.js`、`tests/unlock-thresholds.test.cjs`、`game_formula.md`

禁止修改：Worker Protocol、其他遊戲規則與掉落資料、其他 AI 進行中的檔案。

前置依賴：無。

測試結果：`node --test tests/unlock-thresholds.test.cjs` 3/3 通過；`npm.cmd run build` 235/235 通過。

## Codex：寶石融合改為 3 轉 Lv.1 開放（2026-08-05）

狀態：已完成

任務目的：雙屬性寶石融合（`gem.fuse`／`fuseGemsV2`）改為角色至少 3 轉且 Lv.1 才能使用。

允許修改：`js/data.js`、`js/item.js`、`js/ui.js`、`tests/unlock-thresholds.test.cjs`、`tests/gem-tooltip.test.cjs`、`tests/part-fused-value-storage.test.cjs`、`game_formula.md`

測試結果：解鎖與融合回歸測試通過；`npm.cmd run build` 235/235 通過；完整測試 1027/1035 通過，剩餘 8 項為既有失敗。

## Codex：同步 8 項既有失敗測試至新版規格（2026-08-05）

狀態：已完成

任務目的：將洗煉、太古詞條、敵人傷害、飄字、初始資源、零件升級與 Worker/UI 靜態檢查測試，對齊目前已採用的新版程式與參數契約。

允許修改：`tests/affix-reroll-bias.test.cjs`、`tests/ancient-affix.test.cjs`、`tests/boss-display-state.test.cjs`、`tests/enemy-type-damage.test.cjs`、`tests/multi-enemy.test.cjs`、`tests/new-game-default-resources.test.cjs`、`tests/part-upgrade.test.cjs`、`tests/player-event-float.test.cjs`、`css/style.css`、`game_formula.md`、必要的 `docs/AI_TASKS.md`。

測試結果：8 個原失敗測試已以新版行為重新驗證；完整測試 1035/1035 通過；`npm.cmd run build` 235/235 通過。

## Codex：修正野外關卡敵人資訊提示失效（2026-08-04）

狀態：已完成

任務分類：UI 回歸修復／Worker 面板快照

任務目的：修正野外關卡的敵人資訊提示在 Worker 模式下因讀取已不存在的主執行緒 `G.stage` 而失效。

負責 AI：Codex

允許修改：`js/ui.js`、`tests/boss-tooltip.test.cjs`、本任務記錄。

禁止修改：Worker Protocol、遊戲規則與掉落資料、其他 AI 進行中的檔案。

前置依賴：無。

測試要求／結果：`node --test tests/boss-tooltip.test.cjs` 3/3 通過；`npm run build` 235/235 通過；完整 `npm test` 1021/1029 通過，8 項為既存失敗，未涉及本次提示修復。

完成條件：敵人提示改讀 header panel snapshot 的關卡／地圖資料，且不再依賴主執行緒 `G`；測試與建置通過。

完成結果：`showEnemyTooltip()` 改由 `uiHeaderPanelSnapshot()` 取得目前地圖與關卡，Worker 模式下不再因 `G.stage` 未定義而中斷提示內容組裝。

完成後交給：Claude Review，之後由使用者合併至整合分支。

## Codex：有限關卡與自訂地圖內容改造（2026-08-04）

狀態：已完成，待 Claude Review／使用者合併

任務分類：關卡流程、地圖解鎖、NPC 配置、分段掉落、存檔相容性

任務目的：

- 將七張地圖改為有限關卡，依序加入亡靈山脈，關卡上限為 200～800。
- 以前一張地圖通關解鎖下一張；太古戰場、混沌界、永恒神域另需 11 轉。
- 建立 NPC 基本配置與地圖加權敵人表，並支援地圖／關卡區間掉落配置。

負責 AI：Codex

修改範圍：`js/data.js`、`js/formula.js`、`js/combat.js`、`js/save.js`、`js/player.js`、`js/ui.js`、`config/CSV/Zones.csv`、`config/CSV/NPC.csv`、`config/CSV/Zone_Stage_Drops.csv`，以及相關測試。

驗收方式／結果：關卡改造相關測試 26/27 通過；唯一失敗為既有 `multi-enemy` 樣式斷言。`npm run build` 通過（233/233）。完整 `npm test` 為 1001/1009 通過，8 項失敗皆為既有詞條、傷害公式、UI/CSS 或初始參數測試，未涉及本任務新增邏輯。

已知風險：目前未進行瀏覽器長時間掛機與實際離線跨地圖操作驗證；God 地圖的分段掉落資料由 `js/data.js` 依上限程式化產生，CSV 主要提供人類地圖的可編輯範例與權威地圖順序／上限表。

完成後交給：Claude Review，之後由使用者合併至整合分支。

## Codex：修正角色經驗溢出未即時升級（2026-08-04）

狀態：已完成

任務分類：角色成長／存檔相容性／升級回歸測試

任務目的：

- 讀取存檔時若 `player.xp` 已達目前等級需求，立即依現行公式連續升級。
- 一次獲得大量經驗時，完整消化溢出經驗，直到達到最高等級或不足下一級經驗。
- 對無效或非有限經驗值做安全正規化，避免升級判定永久失效。

負責 AI：Codex

允許修改檔案：`docs/AI_TASKS.md`、`js/player.js`、`js/save.js`、`js/worker/sim.worker.js`、`tests/xp-levelup-overflow.test.cjs`

禁止修改：Worker Protocol、公式參數、UI 顯示、其他 AI 進行中的檔案，以及未經授權的存檔欄位改名或格式變更。Worker 只增加既有讀檔流程的狀態結算，不變更訊息契約。

前置依賴：無；已完成 `js/player.js`、`js/save.js` 與測試檔的衝突預檢，未發現其他副本或分支修改。

測試要求／結果：新增與相關測試 39/39 通過；完整 `npm test` 為 3 個既有失敗（`affix-reroll-bias`、`boss-display-state`、`enemy-type-damage`），無經驗／存檔相關失敗；`npm run build` 228/228 通過。

完成結果：`gainXp()` 與讀檔後的 `settlePlayerXp()` 共用完整升級迴圈；合法溢出經驗會連續升級至不足下一級或 `MAX_LEVEL`，最高等級經驗歸零；非數字／負數經驗會正規化為安全值。存檔格式與 Worker 協議未變更。

已知風險：完整測試的 3 個失敗與本任務無關，分別是既有洗煉偏向、Boss 傷害浮字與敵方傷害參數測試；未進行瀏覽器長時間掛機驗證。

完成後交給：Claude Review，之後由使用者合併至整合分支。

## Codex：技能頁面板刷新與 Lv.51 裝載欄（2026-08-02）

狀態：已完成

任務分類：技能 UI 狀態同步、技能裝載欄公式修正

任務目的：

- 切換到技能頁時，立即取得最新技能點與技能面板快照，不需等待熟練度經驗再次變動。
- 修正未轉生玩家技能裝載欄的等級分段，使 Lv.1～49 維持 4 格、Lv.50 起增加第 5 格。

允許修改檔案：`docs/AI_TASKS.md`、`js/ui.js`、`js/formula.js`、`tools/apply_params.cjs`、
`tests/skill-loadout.test.cjs`、`tests/ui-performance.test.cjs`、`tests/init-ui-smoke.test.cjs`、`game_formula.md`。

前置依賴：無。衝突檢查已完成，未發現其他副本或分支修改。

驗收方式：技能頁切換會強制請求 `skills` 面板；Lv.51 的 `loadoutSize()` 為 5；相關 Node 測試與參數錨點檢查通過。

完成結果：定向測試 17/17、完整測試 839/839、build 214/214 通過。

## Codex：修正快速切換目標時傷害浮字被清除／裁切（2026-08-03）

狀態：已完成

任務分類：戰鬥 UI 浮字生命週期與目標識別修正

任務目的：

- 快速連續擊殺、切換目標時，保留仍在播放的傷害浮字。
- 避免浮字數量上限直接刪除尚未播完的數字。
- 避免敵人陣列重排後，延遲浮字送到錯誤目標或因 DOM 重建消失。
- 修正長傷害文字定位時受 `translate(-50%)` 影響而只顯示半截的問題。
- Worker 事件佇列、待建立圖層佇列與戰鬥狀態切換均不得丟棄正在播放的傷害浮字。
- 敵方傷害浮字從建立起就掛到持久保留層；敵人卡片只提供定位，直到浮字自然淡出。
- 持久保留層掛在 `mv-party` 外部，批次死亡造成棋盤重建時也不會被清除。
- 大量同 tick 浮字時只停用昂貴的碰撞避讓量測，不限制建立數量或刪除仍在播放的數字。

允許修改檔案：`docs/AI_TASKS.md`、`js/ui.js`、`js/combat.js`、`js/worker/shim.js`、
`css/style.css`、`index.html`、`tests/damage-float-regression.test.cjs`、`tests/ui-worker-events.test.cjs`

禁止修改：Worker Protocol／存檔格式／戰鬥數值公式，以及其他 AI 進行中的檔案。

前置依賴：無；衝突預檢已通過。

測試要求／結果：大量敵人死亡與浮字相關定向測試 26/26；完整測試 899/899；build 217/217 通過。瀏覽器實際驗證受本機 Browser runtime 路徑限制未完成。

完成條件：浮字不因固定數量上限、敵人索引重排、待建立佇列、Worker 事件佇列、狀態切換或死亡卡片移除而提前消失；只由自然淡出計時器移除。

完成後交給：Claude Review，之後由 Antigravity 進行快速擊殺／切換目標的瀏覽器驗證。

## Codex：修正背景分頁累積傷害浮字（2026-08-03）

狀態：已完成

任務分類：背景分頁 UI 效能與傷害浮字生命週期修正

任務目的：

- 背景分頁不建立或播放累積中的傷害浮字，只保留最新一筆可在切回時顯示。
- 切回前景時清理背景期間殘留的敵方傷害浮字，避免一次跳出整批歷史數字。
- Worker 背景事件佇列也只保留最新 float，避免背景掛機過久造成事件／DOM／記憶體累積。
- 不改變背景在線掛機、欠帳補進度與戰鬥結算結果。

負責 AI：Codex

允許修改檔案：`docs/AI_TASKS.md`、`js/ui.js`、`js/worker/shim.js`、`js/worker/sim.worker.js`、
`tests/background-idle.test.cjs`、`tests/ui-worker-events.test.cjs`、`tests/damage-float-regression.test.cjs`

禁止修改：Worker Protocol／存檔格式／戰鬥數值公式，以及其他 AI 進行中的檔案。

前置依賴：無；已完成上述允許檔案的衝突預檢，未發現其他副本或分支修改。

驗收方式：背景期間敵方傷害浮字不建立且 Worker 事件佇列不累積歷史 float；切回前景只顯示最新一筆傷害數字；背景模擬與存檔行為維持既有測試結果；相關測試、完整測試與 build 通過。

完成結果：UI 與 Worker shim 均在背景抑制歷史 float；切回時清理既有敵方傷害節點並補播最新一筆；新增背景 UI、Worker 事件佇列與切回回歸測試。定向測試 19/19 通過；完整測試 971 項中 969 通過，2 項既有失敗（`affix-reroll-bias`、`enemy-type-damage`）與本次無關；build 226/226 通過。瀏覽器實機驗證因 in-app Browser runtime 初始化失敗未完成。

完成條件：完成最小範圍修正，補上背景／切回／事件佇列回歸測試，並回報瀏覽器實機驗證限制與已知風險。

完成後交給：Claude Review，之後由 Antigravity 進行長時間背景掛機與切回驗證。

## Codex：移除詞條上限率 100% 硬上限（2026-08-03）

狀態：已完成

任務分類：裝備洗煉公式／屬性上限調整

任務目的：

- 依使用者要求移除詞條上限率的 100% 硬上限。
- 保留現有洗煉高值偏向公式，讓超過 100% 的詞條上限率可以繼續提高高值段權重。
- 同步參數表、程式單一來源、公式文件與回歸測試。

負責 AI：Codex

允許修改檔案：`docs/AI_TASKS.md`、`js/data.js`、`config/CSV/game_parameters.csv`、
`game_formula.md`、`tests/stat-cap-unlimited.test.cjs`

禁止修改：裝備存檔格式、洗煉區間與分段權重公式、其他 AI 進行中的檔案。

前置依賴：無；已完成上述檔案衝突預檢，未發現其他副本或分支修改。

測試要求／結果：詞條上限率無上限回歸測試 6/6 通過；`apply_params --check-anchors` 的 555 個錨點通過；build 226/226 通過；完整測試 972 項中 970 通過，2 項既有失敗（`affix-reroll-bias`、`enemy-type-damage`）與本次無關。

完成結果：`STAT_CAPS.affixCap = 0`、參數表對應值為 0、面板不再將詞條上限率夾在 100%；洗煉分段權重公式維持不變，超過 100% 的詞條上限率可繼續提高高值段權重。

完成條件：`STAT_CAPS.affixCap = 0`、參數表對應值為 0、面板不再將詞條上限率夾在 100%，且公式與既有洗煉行為通過驗證。

完成後交給：Claude Review，之後由使用者確認洗煉體感。

P5 之後的檔案所有權慣例（沿用即可，非硬性）：
- `js/worker/*`、`js/bridge.js`、`js/storage.js`、`js/main.js`、`js/worker/protocol.js`：Claude
- `js/ui.js`：Codex
- 協議變更一律由 Claude 改 `protocol.js` 並同步 `docs/WORKER_PROTOCOL.md`、遞增版本號

`npm test` 現況 **642 項／642 通過／0 失敗**（2026-07-30）。
先前記錄的 35 條既有失敗（`docs/TEST_FAILURE_TRIAGE.md`）已全部清掉。

驗收標準仍是「不得新增失敗」，並以結尾的 `ℹ fail N` 為準——
⚠️ 不要用 `grep -c '^✖'`，node test runner 會在結尾的失敗摘要區把每筆再列一次，
得到的是兩倍數字。

---

# 2. Claude Code 任務

## 2.-14 修正武器圖示去背過度導致本體變黑（2026-08-01）

狀態：已完成，等待使用者合併

任務分類：UI 素材 Bug 修正／武器圖示透明度

任務內容：修正前次去背將接近黑色的武器本體與陰影誤判為背景的問題，改以圖片邊緣相連的黑色區域作為背景遮罩，保留武器內部暗色材質與細節。

負責 AI：Codex

允許修改：`docs/AI_TASKS.md`、`images/icon_weapon_*.png`、`tests/equipment-weapon-transparency.test.cjs`

禁止修改：其他 AI 進行中的檔案、Worker 協議、存檔格式與遊戲數值。

前置依賴：12 個武器圖示已完成透明化；使用者已回報畫面異常並授權修正。

測試要求／結果：武器透明素材定向測試 3/3 通過；完整測試 791/791 通過；建置通過（205 個檔案）。12 個圖示均已以邊緣連通背景遮罩重新輸出。

完成條件：武器本體深色區域保持可見，只有圖片邊緣相連的黑色背景透明化，裝備欄不再整團變黑。

後續接手者：使用者確認畫面後合併至整合分支。

## 2.-13 裝備成功後顯示裝備欄白色選取外框（2026-08-01）

狀態：已完成，等待使用者合併

任務分類：UI Bug 修正／裝備成功後選取狀態

任務內容：裝備背包物品成功後，將 UI 選取狀態切換為實際裝備欄來源，並保留實際穿戴欄位，讓裝備欄顯示既有白色選取外框。

負責 AI：Codex

允許修改：`docs/AI_TASKS.md`、`js/ui.js`、`tests/equipment-slot-selection.test.cjs`

禁止修改：其他 AI 進行中的檔案、Worker 協議、存檔格式與遊戲數值。

前置依賴：裝備欄／背包選取來源樣式已完成；使用者已授權修改。

測試要求／結果：裝備選取定向測試 11/11 通過；完整測試 791/791 通過；建置通過（205 個檔案）。

完成條件：裝備成功回呼後 `UI.sel.source` 為 `equip` 且包含實際 `slot`，裝備欄可正確顯示既有白色選取外框。

後續接手者：使用者確認畫面後合併至整合分支。

## 2.-12 雙手武器選取雙欄亮起與武器圖示去背（2026-08-01）

狀態：已完成，等待使用者合併

任務分類：UI Bug 修正／武器選取與素材透明化

任務內容：背包選取雙手武器時，同時亮起裝備欄的主手與副手武器欄；將 12 個武器圖示的黑色背景移除為透明，避免裝備欄出現黑色色塊。

負責 AI：Codex

允許修改：`docs/AI_TASKS.md`、`js/ui.js`、`tests/equipment-slot-selection.test.cjs`、`tests/equipment-weapon-transparency.test.cjs`、`images/icon_weapon_*.png`

禁止修改：其他 AI 進行中的檔案、Worker 協議、存檔格式與遊戲數值。

前置依賴：武器類型圖示已完成；使用者已授權修改。

測試要求／結果：武器選取與透明素材定向測試 14/14 通過；完整測試 791/791 通過；建置通過（205 個檔案）。

完成條件：雙手武器選取時 `weapon`／`weapon2` 都套用裝備欄亮起樣式；12 個武器 PNG 均為 RGBA 且四角透明，裝備欄不再顯示黑色色塊。

後續接手者：使用者確認畫面後合併至整合分支。

## 2.-11 背包選取對應裝備欄外框向外加粗（2026-08-01）

狀態：已完成，等待使用者合併

任務分類：UI Bug 修正／裝備選取外框

任務內容：背包選取裝備時，對應裝備欄維持原本 2px 內部邊框，將加粗效果改為向外的 outline，避免因 `box-sizing: border-box` 壓縮裝備圖示與內容區域。

負責 AI：Codex

允許修改：`docs/AI_TASKS.md`、`css/style.css`、`js/ui.js`、`tests/equipment-selection-border.test.cjs`、`tests/equipment-slot-selection.test.cjs`

禁止修改：其他 AI 進行中的檔案、Worker 協議、存檔格式與遊戲數值。

前置依賴：既有裝備欄／背包選取來源視覺已完成；使用者已授權修改。

測試要求／結果：外框定向測試 9/9 通過；完整測試 789/789 通過；建置通過（204 個檔案）。

完成條件：對應裝備欄的粗框改為向外延伸，不再因 `box-sizing: border-box` 壓縮裝備圖示，且 outline 顏色跟隨裝備稀有度。

後續接手者：使用者確認畫面後合併至整合分支。

## 2.-10 武器類型圖示區分（2026-08-01）

狀態：已完成，等待使用者合併

任務分類：UI 素材／裝備顯示修正

任務內容：為 12 種武器類型建立獨立暗黑奇幻圖示，並依 `weaponType` 套用於裝備欄、背包與神鑄素材槽；沒有類型的舊存檔沿用單手劍 fallback。

負責 AI：Codex

允許修改：`docs/AI_TASKS.md`、`js/data.js`、`js/ui.js`、`tests/equipment-weapon-icons.test.cjs`、`tests/equipment-two-hand-display.test.cjs`、`images/icon_weapon_*.png`

禁止修改：其他 AI 進行中的檔案、Worker 協議、存檔格式與遊戲數值。

前置依賴：使用者已授權；武器類型資料已存在；圖示板已生成待裁切。

測試要求／結果：武器圖示定向測試 5/5 通過；完整測試 787/787 通過；建置通過（203 個檔案）；12 個 PNG 圖示與各渲染路徑映射均已檢查。

完成條件：單手劍、匕首、魔杖、魔劍、雙手武器、盾牌、法器、魔法書、水晶球等類型不再共用單手劍圖示，且舊存檔 fallback 正常。

後續接手者：使用者合併至整合分支。

## 2.-9 背包選取亮起改用裝備欄 hover 樣式（2026-08-01）

狀態：已完成，等待使用者合併

任務分類：UI 樣式修正

任務內容：背包選取裝備時，對應裝備欄直接沿用 `.eq-slot.filled:hover` 的背景與亮度效果，不再疊加白色背景或額外白色外發光。

負責 AI：Codex

允許修改：`docs/AI_TASKS.md`、`css/style.css`、`tests/equipment-slot-selection.test.cjs`

禁止修改：其他 AI 進行中的檔案、Worker 協議、存檔格式與遊戲數值。

前置依賴：使用者已授權；衝突預檢通過。

測試要求／結果：裝備欄／背包選取定向測試 7/7 通過；完整測試 785/785 通過；建置通過（202 個檔案）。

完成條件：對應裝備欄的亮起效果與鼠標 hover 一致，且不再泛白。

後續接手者：使用者合併至整合分支。

## 2.-8 背包選取對應裝備欄亮度微調（2026-08-01）

狀態：已完成，等待使用者合併

任務分類：UI 樣式微調

任務內容：降低背包選取時對應裝備欄的亮底、濾鏡與外發光強度，保留輕微亮起與粗框辨識效果，避免裝備圖示整體變白。

負責 AI：Codex

允許修改：`docs/AI_TASKS.md`、`css/style.css`、`tests/equipment-slot-selection.test.cjs`

禁止修改：其他 AI 進行中的檔案、Worker 協議、存檔格式與遊戲數值。

前置依賴：使用者已授權繼續；上一輪同 commit 的跨 worktree 預檢衝突已確認無語意差異。

測試要求／結果：裝備欄／背包選取定向測試 7/7 通過；完整測試 785/785 通過；建置通過（202 個檔案）。

完成條件：對應裝備欄只輕微發亮、不洗白圖示，定向測試與建置通過。

後續接手者：使用者合併至整合分支。

## 2.-7 裝備欄／背包選取來源視覺區分（2026-08-01）

狀態：已完成，等待使用者合併

任務分類：UI Bug 修正／裝備與背包選取狀態

任務內容：區分點擊裝備欄與點擊背包的選取視覺。裝備欄來源只在被點擊的裝備欄顯示白框，背包同部位不加白框；背包來源在被點擊的背包格顯示白框，對應裝備欄改以亮底、加粗外框與加亮顏色呈現，不額外加白框，且背包不同部位置灰。

負責 AI：Codex

允許修改：`docs/AI_TASKS.md`、`js/ui.js`、`css/style.css`、`tests/equipment-slot-selection.test.cjs`

禁止修改：其他 AI 進行中的檔案、Worker 協議、存檔格式與遊戲數值。

前置依賴：無；目標檔案衝突預檢已通過。

測試要求／結果：裝備欄／背包選取定向測試 7/7 通過；完整測試 785/785 通過；`npm run build` 通過（202 個檔案）。

完成條件：兩種點擊來源的白框、置灰與裝備欄亮起樣式符合需求，回歸測試通過，且無新增建置／測試錯誤。

後續接手者：Claude Review，使用者合併至整合分支。

## 2.-6 apply_params 場景倍率錨點修正（2026-07-31）

狀態：已完成，等待使用者合併

任務內容：修正 `tools/apply_params.cjs` 對神界場景倍率的跨行錨點搜尋，避免同名 key 同時出現在 `CHAOS_FIELD_DROP_ZONES` 與 `ZONES` 時被誤判為 2 次匹配；補上套用工具回歸測試。

允許修改：`docs/AI_TASKS.md`、`tools/apply_params.cjs`、`tests/apply-params.test.cjs`。

禁止修改：其餘檔案。

驗收方式：`node tools/apply_params.cjs` 顯示 554 一致、0 變更、0 錨點問題；`npm test` 672/672、`npm run build` 192 檔全數通過。

後續接手者：Codex 完成後由使用者合併至整合分支。

---

## 2.-5 草原前 100 關敵人數量調整（2026-07-31）

狀態：已完成，等待使用者合併

任務內容：依 `config/Excel/game_parameters.xlsx` 新增的五列參數，讓草原第 1～100 關每 20 關套用一組小怪出怪數量權重；草原第 100 關之後恢復一般小怪數量。草原前 100 關菁英固定出現 1 隻；BOSS 規則維持原狀。

允許修改：`docs/AI_TASKS.md`、`config/CSV/game_parameters.csv`、`js/data.js`、`js/formula.js`、`js/combat.js`、`tools/apply_params.cjs`、`tests/multi-enemy.test.cjs`。

禁止修改：其餘檔案（`config/Excel/game_parameters.xlsx` 保留使用者既有修改）。

前置依賴：參數表五列已由使用者合併至最新版本。

驗收方式：新增分段權重與階段／場景選擇測試；`npm test` 671/671、`npm run build` 191 檔全數通過；`node tools/apply_params.cjs` 顯示本次新增參數 0 變更，僅保留既有 15 個場景錨點問題。

後續接手者：Codex 完成後由使用者合併至整合分支。

---

## 2.-4 技能融合系統改造（2026-07-30）

狀態：已完成，等待驗證（細節見 PATCH.md「技能融合系統改造（2026-07-30）」）

任務分類：技能系統／融合演算法全面改造（使用者指派給 Claude 整件完成，含慣例上屬於 Codex 的
`js/ui.js`／`index.html` 介面調整）。需求來源：`神力之巔_記事錄.xlsx` 第二頁「技能融合」。

需求（Excel 方案十點）：
1. 一個技能只能投入一個融合技（佔用制）；被融合技能不可裝備、圖標標示；刪除融合技才釋放。
2. 移除 4／8 級里程碑解鎖，效果從 Lv.1 全附加。
3. 所有技能（含融合技、被動技、潛力技）等級上限 10；轉生後上限 +5（=15）。
4. 融合技剛產生為未學習（Lv.0），升至 Lv.1 才算學會、才可裝備。
5. 技能點改由「技能熟練度」提供：打怪／道具給技能經驗，滿級升 1 級給 1 點，0~1000 級，
   經驗需求走參數表（先沿用玩家經驗公式 30×L³+40）。
6. 融合花費金幣＋新道具「魔法卷軸」；卷軸取得比照附魔精華（拆解＋高塔）、數量為其 1/10。
7. 融合演算法改造：物理/魔法/雙屬性 45/45/10（依素材數量權重調整）；攻擊力＝素材滿級平均
   切 75/100/125/150 四檔（20/30/30/20）；同屬性每多 1 個素材該屬性傷害 +25%（折入權重與總值）；
   buff/debuff 數量常態分佈取 1~N、數值由「一半~上限」均分 4 檔隨機；屬性組合 C(n,k) 多重集
   全枚舉（物理算一種屬性、佔 2 份）；特效正常取一個素材的特效包、5% 機率融合兩個（最多 2）；
   素材數值一律以素材「最高等級」計算（未學習但已解鎖即可融合）。
8. 融合結果只存種子（seed），由素材現行定義＋種子確定性重算；原生技能改數值後直接重算生效。
9. 潛力技能不能融合（維持既有結構性排除＋UI 防呆）。
10. 融合技等級成長設計：所有隨機結果值為滿級（10 級）值，Lv.1 為其 60% 線性成長至滿級 100%。

修改範圍：`js/skills.js`（融合演算法／佔用／熟練度／castSkill both 與 buffList）、`js/formula.js`
（上限／熟練度經驗／融合參數）、`js/data.js`（轉生對照表）、`js/player.js`（newGameState／gainXp）、
`js/save.js`（遷移／離線熟練度）、`js/combat.js`、`js/tower.js`、`js/factory.js`（熟練度經驗與卷軸）、
`js/worker/protocol.js`＋`js/worker/sim.worker.js`（協議 v13：magicScroll／mastery 投影）、
`js/ui.js`＋`index.html`＋`css/style.css`（佔用標示／熟練度條／卷軸資源／融合面板）、
`js/gm_exec.js`（scroll／skillxp／masterylv）、`js/stats.js`、`config/CSV+Excel`（game_parameters）、
`tools/apply_params.cjs`（新錨點）、`game_formula.md`、`LV_upgrade_system.md`、`GM_command.md`、
`PATCH.md`、`ONE_TIME_MIGRATIONS.md`、`docs/WORKER_PROTOCOL.md`、新測試 `tests/skill-fusion-rework.test.cjs`。

前置依賴：`git pull` 已最新（451c083）；`check-conflicts.ps1` 通過（antigravity 僅動模擬腳本，
與目標檔案零重疊；codex／develop 乾淨）。

存檔遷移（冪等、欄位存在性判斷）：舊 `skillPointBudget` → `skillMastery.level`（扣除基礎 2 點、
保底已花費、夾 0~1000）並刪除舊欄位；全技能等級夾回新上限（等級推導制自動退點）；舊融合記錄補
`seed`＋`algo:2` 以新演算法重算（凍結欄位 componentLevels/mutation/maxLv 保留但不再參與重算）；
裝載欄清出被佔用素材。

測試要求／結果：新增 `tests/skill-fusion-rework.test.cjs`（20 項：種子確定性／物魔權重／四檔攻擊力
／屬性組合枚舉 23 例／同屬性折算／buff 取數與 4 檔／效果融合／佔用閘門／未學習融合技／上限 10+5
／熟練度／卷軸換算／遷移兩案）；既有 7 檔測試依新規則修正（里程碑全附加／buff 清單化／協議 v13
／點數制）；`npm test` 664／664、`npm run build` 178 檔零錯誤；參數表 round-trip（apply_params
將變更 0；15 個場景錨點重複為既有問題，已另立背景任務）。

待 Antigravity 驗證重點：見交付回報「建議驗證項目」（實機融合流程／佔用標示／熟練度條／卷軸
掉落與花費／舊檔遷移／both 傷害／效果融合 5%）。

## 2.-3 屬性及技能效果五項改造（2026-07-30）

狀態：已完成，等待驗證

任務分類：戰鬥核心／屬性派生改造（使用者指派給 Claude，含慣例上屬於 Codex 的 `js/ui.js` 一行圖示對照）。

需求（使用者原文五點）：取消生命回復／吸血的溢出轉護盾（技能效果除外）、吸血／吸魔改由生命回復／
法力恢復決定且不擋上限、韌性上限 80% 並兼含控場時間與被爆擊機率、敵人對玩家爆擊（8／6／4%、
爆傷 300%，需參數化）、技能降防改為穿透且穿透不擋上限並改用 `a×(穿透%×b)^c` 曲線（超過 100% 轉增傷）。

修改範圍：`js/formula.js`（核心公式）、`js/data.js`（`STAT_CAPS` 與面板 tips）、`js/combat.js`、
`js/skills.js`、`js/legendary.js`、`js/potential.js`、`js/ui.js`（buff 圖示）、
`config/CSV+Excel` 的 `game_parameters` 與 `Skills`、`tools/apply_params.cjs`、`tools/config_tables.cjs`、
`game_formula.md`、`PATCH.md`。細節見 PATCH.md「屬性及技能效果五項改造（2026-07-30）」。

前置依賴：已先 fast-forward 合併 `develop`（含 `ai/codex` 的混沌裝備兩筆），在合併後基礎上施工。
衝突預檢：`js/*` 與 codex 變更區塊不重疊；參數表以合併後的 CSV 重生 xlsx，順帶把 codex 只改 CSV
未同步 xlsx 的 9 列補回 xlsx（原本下次套用參數會被吃掉）。

測試要求／結果：新增 `tests/attr-skill-rework-2026-07-30.test.cjs`（20 項）；`npm test` 642／642、
`npm run build` 177 檔零錯誤；參數表 round-trip（`config_tables --apply` 語意變更 0、
`apply_params` 將變更 0）。

待 Antigravity 驗證重點：見 PATCH.md 條目與交付回報的「建議驗證項目」（穿透曲線實機值、
敵人爆擊頻率與韌性折減、吸血回復量、破甲擊改穿透後的 DPS 與施放頻率、護盾不再由吸血成長）。

## 2.-2 技能提示退化成風味文字（回報：技能的正確 tips 消失）

狀態：已完成，等待驗證

本次由 Claude 直接修改 `js/ui.js`。**使用者指派給誰就由誰改，優先於檔案歸屬慣例**——
第 1 節的所有權清單是基本原則，不是分工的門檻；為了遵守它把一個小功能拆成多個協作者，
成本高於收益。

現象：技能卡與技能面板都只顯示一行風味文字（例：強力斬顯示「蓄力揮出沉重的一擊。」），
傷害數值、成長與附加效果全部消失；「下一級」顯示的字串與本級完全相同。

根因：`ui.js` 的 `skillViewDescription` 回傳 `def.flavor || def.desc`，並註明
「不要呼叫 describeSkill，該模擬層查詢會再回讀主執行緒 `G.player.fusions`」。
那個顧慮只對**融合技**成立——`skillDef(id)` 僅在靜態 `SKILLS` 表查不到時才讀 G
（`js/skills.js:1573`），而主執行緒的 `G` 是 `null`，所以當時確實會拋 TypeError。
結果是為了一種技能，讓**所有技能**的說明都退化。與 `itemDetailHTML` 是同一類問題。

已完成（Claude，模擬層）：

- `skillDef(id, fusions)`：融合技記錄可由呼叫端傳入，省略才回頭讀 G（保留後備，
  模擬層既有呼叫點與既有測試不受影響）
- `describeSkill(id, lv, skipFusionDetail, fusions)`：透傳
- `tests/skill-description-pure.test.cjs`（新增 4 項，含一條標 todo 的 ui.js 接線檢查）

實機驗證（localhost:8330）：主執行緒呼叫 `describeSkill('powerSlash', 1)` 回傳
「造成 360% 物攻 的物理傷害。⭐ Lv.4 解鎖／強化附加效果」，Lv.2 為 440%，未拋錯；
`panelData('skills')` 確認含 `fusions` 欄位。

已完成（`js/ui.js`）：`skillViewDescription` 改呼叫
`describeSkill(id, level, skipFusionDetail, fusions)`，兩個呼叫端（技能面板與 tooltip）
都傳入 `skillsSnapshot.fusions`；融合技的「（融合自：…）」附註改為疊加在完整說明之後。
`describeSkill` 回傳的是 HTML，呼叫端不得再 `esc`。

`tests/ui-worker-g-dependency.test.cjs` 的已審核名單新增 `describeSkill`，
並註明它唯一的 G 路徑已由 `fusions` 參數與 `typeof G` 守衛處理。
那支測試是審核閘門，新增交集必須附證據，不得只改數字。

實測（localhost:8330，技能面板與樹狀 tooltip 皆檢查渲染後的 DOM）：

| 位置 | 修復前 | 修復後 |
|---|---|---|
| 說明 | 蓄力揮出沉重的一擊。 | 造成 360% 物攻 的物理傷害。⭐ Lv.4 解鎖／強化附加效果 |
| 下一級 | 蓄力揮出沉重的一擊。 | 造成 440% 物攻 的物理傷害。⭐ Lv.4 解鎖／強化附加效果 |
| 風味（斜體） | 蓄力揮出沉重的一擊。 | 不變（本來就該在這行） |

Console 無錯誤。`npm test` 509 項全通過。

建議 Antigravity 驗證：融合技的說明與「（融合自：…）」附註、潛力技能說明、
高等級技能的附加效果段落、以及各技能的「下一級」是否確實顯示差異。

---

## 2.-1 背景掛機、404 噪音、itemDetailHTML 純函式化

狀態：等待測試

### 背景分頁改為在線掛機（`118764e`，協議 v9）

遊戲規則（使用者定案）：**分頁在背景＝仍在線上掛機，只有整個遊戲被關掉才算離線。**

移除 `BG_SUSPEND_AFTER_MS` 與 `backgroundSuspended()`；`onVisibility` 只剩「切走時落地
一次」，切回前景不再重設 `_lastTickAt`；`applyOfflineProgress` 只在 `boot` 執行。
降頻補償改為「欠帳 `_catchupDebt` + 每次 loop 花 30ms CPU 分次補完」，上限取
`OFFLINE_MAX_HOURS`。協議移除 `visibility.pip`（休眠沒了就沒有接收端）。

移除舊機制的理由（三項，見 `docs/WORKER_PROTOCOL.md` 第 8 節 v9 列）：離線收益是另一套
固定費率模型；休眠門檻與離線結算門檻的基準不同，背景 60～120 秒收益是 0；與掛機遊戲直覺相反。

量測：模擬 1 小時遊戲時間＝新手 1.5 秒、後期存檔（Lv.260／背包 800）2.4 秒 CPU。
實測（localhost:8330）：隱藏 5.9 分鐘，遊戲時間推進率 100.0%、tick 4.08/秒、0 錯誤。

✅ 使用者已在真實瀏覽器驗證（2026-07-28）：背景掛機 15 分鐘正常，離線流程亦正常。
先前擔心的「內嵌瀏覽器未必觸發 Chrome intensive throttling」已排除。

附帶佐證：查洗煉問題時在同一個長時間隱藏的分頁量到，主執行緒的 `uiTick` 被降頻到
約每分鐘一次（`renderBattle` 3.5 秒內 0 次），但同一時間 Worker 的遊戲時間仍是 100%。
**降頻確實存在，欠帳補償確實把時間補回來了**——這正是這套設計要處理的情況。

### 參數自動重載退避（`e1e3bd9`）

`params_version.txt` 被 `.gitignore` 排除，只有跑過「套用參數.bat」的副本才有
（codex／antigravity／production 三個副本目前都沒有），固定 2 秒輪詢會讓 console
每 2 秒被記一筆 404。改為讀不到時退避成 30 秒探測並提示一次，檔案出現後自動恢復。

### `itemDetailHTML` 純函式化（`ba11ca9`）

該函式是裝備詳情的完整實作卻**零呼叫者**——因為它讀 `G`，主執行緒用不了；`ui.js` 因此
另寫了簡化版 `uiItemDetailHTML`，兩套分歧後產生數值顯示錯誤（掉寶率未換算，20% 的詞條
顯示 20%、實際生效 10%）。改為餘額由 `opts.gold`／`opts.essence` 傳入，並移除渲染路徑裡的
`ensureSockets` 副作用。

後續交給 Codex：把 `ui.js` 的 4 處呼叫改回 `itemDetailHTML` 並刪除 `uiItemDetailHTML`
（`tests/item-detail-html.test.cjs` 有一條 todo 標記此事）。提示詞已備妥，**待使用者指示才發出**。

---

## 2.0 多分頁互斥（Web Worker 重構收尾）

狀態：等待測試

任務名稱：多分頁同時開啟時互相覆蓋存檔

問題：全專案沒有任何多分頁防護。開兩個分頁就是兩顆 Worker 各自模擬、各自每 15 秒
把整份狀態寫進同一個 `auto_current`，後寫的整份蓋掉先寫的。實測兩個分頁跑 50 秒後
分別是 Lv.3／金 3,445／第 1 關與 Lv.4／金 4,935／第 7 關，關掉一個再重載另一個，
那幾十秒的進度就沒了。

決策（使用者選定）：擋下後開的分頁，並提供「在此分頁接管」。

交付內容：

- `js/tablock.js`（新增）：`navigator.locks` 具名獨佔鎖為唯一權威，
  `BroadcastChannel` 只負責通知讓位。拿不到鎖的分頁**完全不初始化遊戲**
- `js/worker/protocol.js`：協議升 v8，新增 `app.handoff`（落地 + 停模擬），85 → 86 條
- `js/worker/sim.worker.js`：`app.handoff` 實作
- `js/bridge.js`：`handoff()`——等 `persist` 真的落地完成才放手；開機改由 TabLock 觸發
- `js/main.js`：`initUI` 改由 TabLock 觸發
- `index.html`：載入 `js/tablock.js`（早於 bridge 與 main）
- `docs/WORKER_PROTOCOL.md`：v8 版本列與關鍵設計決策第 7 條
- `tests/tab-lock.test.cjs`（新增，10 項）

允許修改：`js/tablock.js`、`js/bridge.js`、`js/main.js`、`js/worker/`、`index.html`、`docs/`、`tests/`

禁止修改：`js/ui.js`（Codex 持有）

實測結果（localhost:8330，指向 claude 工作副本）：

- 單分頁正常開機；第二分頁被擋下且 `WorkerBridge.status().started === false`（沒有第二顆 Worker）
- 接管來回三次，金幣單調遞增 1606 → 2004 → 2572 → 3350 → 5460 → 5605 → 5750，無回檔
- 持有者分頁直接關閉（模擬當掉）→ 鎖由瀏覽器自動釋出，其他分頁接管成功
- `errors` / `persistErrors` 全程 0，兩個分頁 console 皆無錯誤
- 渲染實測：解除 `uiRenderingSuspended` 閘門後 `#r-gold` 顯示 5.46K，與 view 的 5460 一致
- `npm test`：487 tests / 487 pass / 0 fail（基準線 477／477／0，未新增失敗）

已知限制：

- 遮罩底下的遊戲按鈕仍在 DOM 中可被鍵盤 focus（視覺上完全被蓋住）
- 若持有者分頁被瀏覽器凍結（bfcache）而收不到讓位廣播，接管會在 10 秒後
  顯示「另一個分頁沒有回應」，需玩家自行關閉該分頁

建議 Antigravity 驗證：多分頁接管、關閉持有者分頁、存檔資料夾模式下的接管、
高塔挑戰進行中接管、離線結算與接管的交互

---

## 2.1 Web Worker 遷移 P1／P2（歷史記錄）

狀態：

等待測試（P1、P2 已交付，待 Antigravity 驗證）

任務名稱：

Web Worker 遷移 P2：存檔搬遷（P1 Worker 骨架已完成）

P2 交付內容：

- `js/storage.js`（新增）：主執行緒唯一落地端。接收 Worker 給的 json 與 meta，
  底層重用 save.js 既有的 `idbSetAutoV2` / `writeRawToFolder` / `writeAutoMetaV2` /
  `saveFolderMetaV2`，**存檔格式與檔名規則完全不變**
- `js/worker/sim.worker.js`：新增 `installStorageGuards()`，載入後就地換掉
  `saveGame` / `syncSaveFolder` / `manualSave` / `createManualSaveToFolderV2` /
  `restartGame` / `loadGame` / `loadLatestFolderSave`，讓模擬層照常呼叫、落地端換人。
  **未修改 save.js**（那 17 支是既有測試的受測對象）
- `js/worker/shim.js`：localStorage 由記憶體替身改為**會拋錯的陷阱**，漏網路徑大聲失敗
- `js/worker/protocol.js`：協議升 v2（`load` 訊息、`restart` 落地種類、
  `persist` 帶 `meta`、`boot` 帶 `maxRunId`、`save.*` 三條改 `fn:null`）
- `js/bridge.js`：接上真實存檔讀寫；補送初始 visibility 狀態
- `js/main.js`：worker 模式下關閉舊迴圈並設 `_saveSuppressed`，讓出存檔權

⚠️ 行為變更：`?worker=1` 現在以**玩家真實存檔**開機，且 Worker 是存檔權威。
P3 之前 UI 尚未接上 Worker，所以此模式下**畫面不會更新（等同凍結）**，屬預期中的中間狀態。
要正常玩遊戲請拿掉網址參數走舊路徑。

實測結果（localhost:8125）：

- 以真實存檔開機：等級 6、金幣 21130，migrate 與離線結算正常，0 錯誤
- 自動存檔實際落地 IndexedDB，Worker 與落地內容一致（15 秒差值符合節奏）
- **跨路徑相容**：Worker 寫的存檔，舊路徑重開後正確讀入（金幣 18154、背包 13 件、runId 1）
- `save.manual` 未連接資料夾時**誠實回報失敗**（persistErrors +1，訊息「尚未選擇本地存檔資料夾」），
  不會假裝成功
- 執行中讀檔：帶標記值的存檔送進去後狀態確實被替換
- `SHIM_DIAG.storage` 全程為空 → Worker 內沒有任何一次 localStorage 呼叫
- `npm test`：473 tests / 426 pass / 47 fail，失敗清單與基準線**逐條相同**

P1 交付內容：

- `js/worker/sim.worker.js`：主迴圈與 G 的所在地，importScripts 載入 17 支模擬層（未改動任何一支）
- `js/worker/shim.js`：window / document / UI.dirty / blog / flog / recordLoot* 替身，並統計相依次數
- `js/bridge.js`：主執行緒橋接，指令 Promise 配對、面板索取、分頁狀態轉發
- `index.html`：僅新增 protocol.js 與 bridge.js 兩個 script 標籤（見下方範圍調整）

範圍調整（需知悉）：

原計劃把 `index.html` 排在 P5，但 feature flag 必須在 P1 就能接線，
故 Claude 於 P1 提前接手該檔（僅加 2 個 script 標籤，未動其他內容）。
`index.html` 自即日起由 Claude 持有至 P5，其他 AI 不得修改。

實測結果（localhost:8125）：

- `?worker=1`：Worker 開機、模擬推進（10 秒推進到 stage 2~3）、tick 5Hz、persist 往返正常、0 錯誤
- 不帶參數：舊單執行緒路徑完全不受影響，Console 無錯誤
- `npm test`：失敗清單與基準線**完全相同**（47 fail，未新增任何失敗）

任務內容：

- 建立 `js/worker/sim.worker.js`，以 `importScripts` 載入 17 支模擬層檔案（不改寫模擬層）
- 建立 `js/worker/shim.js`：`blog` / `flog` / `nflog` / `window.recordLoot*` 改為事件佇列，隨 tick 合批送出
- 建立 `js/bridge.js`：主執行緒側 send / on，含指令 id 配對與 ack 處理
- 主迴圈搬進 Worker，保留 `_lastTickAt` 經過時間補償與背景休眠語意
- 以 `?worker=1` feature flag 與舊單執行緒路徑並存，舊路徑維持可用

工作區：

D:\MyGame\Idle-RPG\claude

分支：

ai/claude

允許修改：

- js/worker/sim.worker.js（新增）
- js/worker/shim.js（新增）
- js/bridge.js（新增）
- js/worker/protocol.js（協議唯一維護者）
- index.html（僅 feature flag 接線；P1 起由 Claude 持有至 P5）
- docs/WORKER_PROTOCOL.md

禁止修改：

- js/ui.js（P3 起專屬 Codex；需要改動一律以 Code Review 意見交付）
- tests/worker-*.test.cjs（Codex 所有）
- 其他 AI 正在處理的檔案
- 任務範圍外檔案
- develop 分支

前置依賴：

P0 協議凍結（已完成）

測試要求：

- `npm test` **不得新增失敗案例**。開工前基準線：426 pass / 47 fail（既有問題，與遷移無關）
- Worker 空跑不得出現 Console 錯誤

完成後交給：

Antigravity 驗證 `?worker=1` 空跑；Codex 依協議撰寫協議測試

---

# 3. Codex 任務

狀態：

進行中（P1 協議測試已交付並合併；下列為 P2 期間任務）

## 3.9 Codex：首次可轉生前隱藏轉生資訊

狀態：

已完成，等待使用者合併

任務名稱：

首次可轉生前隱藏轉生資訊

任務內容：

角色尚未達到第一次可轉生條件時，隱藏側欄的轉生次數與轉生按鈕；達到可轉生等級或已有轉生紀錄後顯示，並永久保持顯示。

允許修改：

- `index.html`
- `js/ui.js`
- `css/style.css`
- `docs/AI_TASKS.md`

禁止修改：

- `tests/`（目前有其他分支未合併修改）
- 遊戲轉生公式、存檔格式與 Worker 協議

前置依賴：

無

測試要求：

轉生相關既有測試 1/1 通過；`npm run build` 193 檔通過；完整 `npm test` 677 項中 674 項通過，3 項既有敵人爆擊參數／神力測試失敗，與本任務無關；靜態檢查確認初始隱藏及首次可轉生／已轉生兩條顯示路徑。

完成後交給：

使用者合併至整合分支。

## 3.10 Codex：野外裝備掉落區間對齊配置表

狀態：

已完成，等待使用者合併

任務名稱：

野外裝備掉落區間對齊配置表

任務內容：

讓野外裝備掉落率依 `config/CSV/game_parameters.csv` 的實際怪物等級區間判定；裝備等級套裝分段（1、50、100、150…）只決定裝備等級，不得取代掉落率區間。21 級必須讀取 `20~99` 區間的獨特裝備機率。

允許修改：

- `js/data.js`
- `tools/apply_params.cjs`
- `tests/field-equipment-drop-table.test.cjs`
- `tests/apply-params.test.cjs`
- `game_formula.md`
- `docs/AI_TASKS.md`

禁止修改：

- `js/item.js` 的裝備等級套裝公式
- 掉寶率加成、菁英倍率與存檔格式
- 其他未相關檔案

前置依賴：

使用者已處理 `js/data.js` 的既有分支衝突；Claude 的寶石資料修改需保留。

測試要求：

驗證 19、20、21、49、50、99、100 等邊界；野外掉落與 `apply_params` 定向測試 2/2 通過；`apply_params` 顯示 550 一致、0 變更、0 錨點錯誤；`npm run build` 193 檔通過；完整 `npm test` 677 項中 674 項通過，3 項既有敵人爆擊參數／神力測試失敗，與本任務無關。

完成後交給：

使用者合併至整合分支。

## 3.4 Codex P0：uiTick 移除主執行緒模擬層屬性計算

狀態：

等待 Review（實作與驗收完成）

任務名稱：

修正 `ui.js` 呼叫 `getStats()`／`talentLevel()` 打斷 `uiTick`，恢復戰鬥飄字與面板即時渲染

任務內容：

- 敵人傷害飄字合併上限只讀協議 v8 的 `battle.stats.comboHits`／`battle.stats.aspd`
- Worker float 事件與待處理飄字路徑都把 battle snapshot 傳入 `floatText`
- `renderMpSkill` 缺少 stats 時安全返回，不在主執行緒重算屬性
- 天賦與潛能渲染缺少 snapshot 時使用安全預設值，不呼叫會讀取 `G` 的模擬層後備
- 全檔確認 `ui.js` 不含 `getStats(`／`computeStats(` 呼叫

允許修改：

- `js/ui.js`
- `docs/AI_TASKS.md`
- 與本問題直接相關的 `tests/*.test.cjs`（如需補回歸測試）

禁止修改：

- `js/worker/*`（協議層由 Claude 維護）
- 任務範圍外檔案
- `develop` 分支

前置依賴：

協議 v8（已於開工前 merge `origin/develop`，`battle` 面板已含 `stats`）

測試要求：

- `npm test` 不得新增失敗
- 使用 `docs/fixtures/save_midgame.json` 實機戰鬥至少 60 秒，Console 0 error／0 warning
- 敵人傷害飄字可見且連擊會合併；戰鬥中切裝備頁立即渲染
- 完整展開天賦頁（含潛能節點）不得拋錯
- 記錄 Console 截圖與 `WorkerBridge.status()` 的 `errors`／`restarts`／`pendingCommands`

驗收結果：

- 定向測試 34/34 通過；`npm.cmd test` 471/471 通過
- Lv.514／10 轉實機：天賦 1～10 轉共 80 個節點完整展開，技能頁 10 個潛能節點全部可見
- 連擊數 1.9 的第 20 層高塔戰鬥完整跑滿 60 秒，敵方傷害飄字持續可見
- 戰鬥中切換裝備頁 361ms 完成，背包計數 56/100、DOM 已渲染 25 個可視格
- Browser Console 程式化擷取：0 error、0 warning
- 驗收工具限制：IAB 的隔離執行環境無法存取頁面主世界的 `WorkerBridge`，
  因此未直接取得 `WorkerBridge.status()` 三項值；未觀察到 Worker restart 訊息，
  UI pending 狀態亦已清除，不以此推定結果取代實測值

完成後交給：

Claude Review

## 3.5 Codex：敵方傷害飄字可讀性修正

狀態：

等待 Review（第二版實作與驗收完成）

任務名稱：

恢復單一敵人的標準傷害字號，並提高多敵場景的最小可讀字號

任務內容：

- 單一敵人時，普通傷害使用 18px、爆擊／技能使用 22px
- 多敵場景仍可縮小飄字，但普通傷害不得低於 14px、爆擊／技能不得低於 18px
- 更新既有飄字 CSS 回歸測試，鎖定單敵與多敵的字號

允許修改：

- `css/style.css`
- `tests/player-event-float.test.cjs`
- `docs/AI_TASKS.md`

禁止修改：

- `js/worker/*`
- 戰鬥公式與傷害數值
- 任務範圍外檔案

測試要求：

- `tests/player-event-float.test.cjs` 通過
- `npm test` 不得新增失敗
- 實機確認單敵與多敵傷害飄字均可辨識

驗收結果：

- 定向測試 15/15 通過；`npm.cmd test` 487/487 通過
- 實機實際戰鬥 computed style：單敵普通傷害 18px、多敵普通傷害 14px
- 單敵爆擊／技能設定為 22px，多敵爆擊／技能設定為 18px
- Browser Console：0 error、0 warning
- 未修改傷害公式、戰鬥數值與 `js/worker/*`

完成後交給：

Claude Review

## 3.6 Codex：恢復敵人死亡淡出與完整傷害飄字

狀態：

等待 Review（實作與驗收完成）

任務名稱：

修正死亡敵人在 UI 被立即過濾，並讓擊殺傷害飄字完整播放

任務內容：

- 戰鬥畫面保留 Worker Snapshot 中仍處於死亡清除倒數的敵人
- 死亡敵人的視覺內容漸隱，但傷害飄字圖層維持可見
- 死亡保留時間不得短於傷害飄字動畫時間，避免最後一段淡出被 DOM 重建切掉
- 補回歸測試鎖定上述行為

允許修改：

- `js/ui.js`
- `js/data.js`（僅調整野外敵人死亡清除時間）
- `css/style.css`（僅新增敵人死亡淡出動畫）
- `tests/multi-enemy.test.cjs`
- `docs/AI_TASKS.md`

禁止修改：

- `js/worker/*`
- 傷害公式、掉落公式、存檔格式
- 任務範圍外檔案
- `develop` 分支

前置依賴：

無

測試要求：

- 定向測試與 `npm test` 不得新增失敗
- 實機確認敵人死亡後漸隱、擊殺傷害飄字完整播放
- Browser Console 0 error／0 warning

驗收結果：

- 定向測試 18/18 通過；`npm.cmd test` 487/487 通過
- `npm.cmd run build`：152 個檔案語法／編譯檢查全數通過
- 實機死亡淡出透明度：死亡瞬間 0.95，0.5／1.0／1.5／1.9 秒後分別為
  0.71／0.47／0.23／0.10，約 2.15 秒後移除敵人卡片
- 擊殺傷害飄字未跟隨敵人本體淡出，完整播放至自身 opacity 0 後移除
- Browser Console：0 error／0 warning

完成後交給：

Claude Review

## 3.7 Codex：多 Worktree 分支整合腳本

狀態：

等待 Review（實作與驗證完成）

任務名稱：

自動推送三個 AI 分支、整合至 develop，再將 develop 同步回三個 AI 分支

任務內容：

- 自動探索 `ai/antigravity`、`ai/claude`、`ai/codex`、`develop` 所在 Worktree
- 提供專案根目錄 `sync_ai_worktrees.bat`，可直接雙擊執行完整流程
- BAT 與 PowerShell 腳本的步驟、結果及錯誤提示使用繁體中文
- 執行前確認所有 Worktree 分支正確且工作區乾淨
- 提供 `-ValidateOnly` 唯讀預檢模式
- 先 fast-forward 同步並推送三個 AI 分支
- 在 develop Worktree 依序合併三個遠端 AI 分支並推送 develop
- 將遠端 develop fast-forward 回三個 AI 分支並推送
- 任一步驟失敗立即停止，不自動 reset、abort 或覆蓋衝突

允許修改：

- `sync_ai_worktrees.bat`
- `tools/sync_ai_worktrees.ps1`
- `docs/AI_TASKS.md`

禁止修改：

- 遊戲程式、資料、公式與測試
- `develop` 分支

前置依賴：

無

測試要求：

- PowerShell Parser 語法檢查通過
- BAT 可正確找到並啟動 PowerShell 腳本，結束後保留執行結果
- Windows PowerShell 5.1 與 BAT 顯示繁體中文時不得出現亂碼
- 唯讀驗證目前 Worktree 探索結果包含四個目標分支
- 不對實際專案執行 push 或 merge
- 使用本機臨時 bare remote 完整演練 push、merge 與三分支回灌

驗收結果：

- PowerShell Parser 語法檢查通過
- BAT 以 `-ValidateOnly` 實測可正確啟動 PowerShell 腳本並回傳其結束碼
- BAT 與 PowerShell 腳本的繁體中文訊息實測顯示正常
- 實際專案 `-ValidateOnly` 找到四個目標 Worktree，並因 Claude Worktree
  的 `.claude/launch.json` 未提交而依預期安全停止
- 本機臨時 remote 完整流程通過，`develop` 與三個 AI 遠端分支最終收斂至同一 commit
- 未對實際專案執行 pull、push 或 merge

完成後交給：

使用者執行；發生衝突時交由整合者人工處理

## 3.7.1 Codex：整合前先同步所有遠端分支（2026-08-04）

狀態：

進行中

任務名稱：

在一鍵整合流程前先同步所有必要的遠端分支

任務內容：

- `sync_ai_worktrees.bat` 預設要求先執行遠端同步步驟。
- 先從所有 remote `fetch --all --prune`。
- 在原本的推送與合併流程前，對 `develop`、`ai/antigravity`、`ai/claude`、`ai/codex` 各自執行 `pull --rebase`。
- 遠端同步發生衝突時立即停止，不自動 reset 或 abort。

允許修改：

- `sync_ai_worktrees.bat`
- `tools/sync_ai_worktrees.ps1`
- `docs/AI_TASKS.md`

禁止修改：

- 遊戲程式、資料、公式與測試
- `develop` 分支

測試要求：

- PowerShell Parser 語法檢查。
- `sync_ai_worktrees.bat -ValidateOnly` 不執行 fetch、pull、push 或 merge。
- 以臨時 Git 環境驗證遠端同步步驟後才進入原本流程。

完成後交給：

使用者執行；發生 rebase 衝突時交由整合者人工處理

## 3.7.2 Codex：修正寶石轉換選單導致庫存清空顯示（2026-08-04）

狀態：

已完成

任務名稱：

修正選擇寶石轉換目標後庫存池誤顯示為空

任務內容：

- 修正寶石渲染器把 DOM `Event` 物件誤當成 `gems` Snapshot 的問題。
- 檢查同一寶石頁面中直接綁定渲染器的 `change` 事件，避免同類回歸。
- 新增回歸測試，確認事件參數不會使有效寶石庫存被渲染成 0。

允許修改：

- `js/ui.js`
- `tests/gem-convert-shift.test.cjs`
- `docs/AI_TASKS.md`

禁止修改：

- Worker 寶石資料模型與轉換規則
- 其他遊戲程式、資料、公式與測試
- `develop` 分支

測試要求：

- 執行寶石轉換回歸測試。
- 執行完整測試與建置檢查。
- 實際確認選擇轉換目標後庫存池仍保留寶石，排序後結果不變。

完成後交給：

使用者執行；必要時進行瀏覽器回歸驗證

## 3.8 Codex：裝備詳情統一使用 itemDetailHTML

狀態：

等待 Review（實作與主要驗收完成）

任務名稱：

刪除 `uiItemDetailHTML` 重複實作，三個裝備詳情呼叫點統一使用 `itemDetailHTML`

前置依賴：

- `ba11ca9 refactor: itemDetailHTML 改為純函式，供主執行緒直接呼叫`
- 開工前 `git pull --ff-only` 已完成，並以 `git merge-base --is-ancestor ba11ca9 HEAD`
  確認依賴存在

完成內容：

- `renderDetail()` 改呼叫 `itemDetailHTML(it, null, opts)`
- 裝備格 tooltip 的目前裝備與比較裝備兩張卡片改呼叫 `itemDetailHTML`
- 三個呼叫點皆由 header Snapshot 傳入 `gold`、`essence`
- 保留 `showAffixReroll`、`isEquipped` 原有語意
- 刪除 `uiItemDetailHTML` 簡化重寫
- 將原本的 todo 接線測試改成正式回歸測試，鎖定三個呼叫點、`cmp = null`
  及資源欄位

修改檔案：

- `js/ui.js`
- `tests/item-detail-html.test.cjs`
- `docs/AI_TASKS.md`

禁止修改且未修改：

- `js/item.js`、`js/formula.js`、`js/data.js`
- `js/worker/*`、`js/bridge.js`、`js/main.js`
- `index.html`、`develop` 分支

測試結果：

- `node --test tests/item-detail-html.test.cjs`：7/7 通過，todo 0
- `npm.cmd test`：504/504 通過，結尾 `ℹ fail 0`
- `npm.cmd run build`：154 個檔案全數通過
- `git diff --check`：通過

實機驗收：

- 使用 `codex` 工作副本的獨立 preview server 與
  `docs/fixtures/save_lategame.json`，未使用 develop 的 5500 服務
- 詳情實際顯示詞條池按鈕、分類色、評分、洗煉區間資料、空附魔欄及寶石數值
- 詞條池浮層：`display:block`、父層為 `BODY`、不在 `#detail-pane` 內且完整位於 viewport
- 掉寶率實例：原值 `176.5`、強化 `0`、預期／顯示 `88.25`，
  `displayedExpected:true`、`displayedRaw:false`
- fixture 不含同 key 重複詞條；以 fixture 裝備複本建立 `10 + 5` 測例，
  實際輸出一行且顯示 `15`
- 太古滿值實例：金色 `#fbbf24`、粗體及太古專屬洗煉文案皆存在
- 金幣歸零後，洗煉花費 tooltip 的金幣 span 實際帶 `#fca5a5`
- 透過正式 UI 鑲入四級紅寶石、附上火焰抗性附魔後，六項檢查全為 `true`
- 實際點擊詳情內寶石與附魔後均成功取下，面板恢復空插槽／空附魔欄
- Console：0 error、0 warning
- `WorkerBridge.status()`：`errors:0`、`persistErrors:0`、`pendingCommands:0`

已知驗收素材限制：

- fixture 原始第一件裝備是空插槽、空附魔欄，因此未先鑲嵌／附魔時，
  原提示詞六項指令的 `socketRm`、`enchantRm` 必然為 `false`
- fixture 800 件裝備中沒有同 key 重複詞條，故該項使用同一 fixture 裝備複本
  建立確定性測例
- in-app browser 的指標移動未觸發 `mouseover`；已在實際 DOM 驗證詞條與 🎲
  的 `data-tip` 內容、太古專屬文案及不足資源紅色樣式，人工滑過浮層仍建議 Review 時補看

完成後交給：

Claude Review

任務名稱：

既有測試失敗修復（A 類與 C 類）

已完成：

- `tests/worker-protocol.test.cjs`、`tests/worker-shim.test.cjs`（commit 67938fe）
- `docs/TEST_FAILURE_TRIAGE.md` 診斷報告（commit 48b4ca9），分類 A 32／B 14／C 1
- 協議審查：22 條待決事項（commit fcb3a6a），品質高，已由 Claude 接手裁決

任務內容（Claude 裁決結果）：

**核可：A 類與 C 類，即刻可動手。B 類 14 條一律不動。**

分兩批 commit，不得混在一起：

批次一 — 純測試斷言過時（低風險，直接改測試）：
`#1 attribute-tooltip`、`#3 boss-tooltip`、`#4 combat-log`、`#8 enchant-slot`、
`#9 enemy-type-damage`、`#26 loot-event-accounting`、`#27 multi-enemy`、
`#30 player-shield-bar`、`#31 rarity-colors`，以及 `#2 boss-display-state`（C 類，換行字元）。

批次二 — 數值爭議。**使用者已裁決（2026-07-27），可以動手了。**

### 權威順序（使用者裁決）

```
1. config/CSV/game_parameters.csv          ← 最高
2. 程式碼寫死值（公式／常數）
3. 公式文檔說明（game_formula.md / PLAN.md / PATCH.md）  ← 最低
```

- 有 CSV 就以 CSV 為準
- 沒有 CSV 就以程式碼為準
- 代碼未讀 CSV → 補進參數套用流程
- 文檔沒寫或寫錯 → 修正文檔

### Claude 執行裁決後的實況（已查證，可直接用）

跑過 `node tools/apply_params.cjs`（試跑）：

```
對應參數總數：496（一致 492、將變更 0、錨點問題 4）
（無數值變更：CSV 與程式目前一致）
```

意思是——**程式碼已經完全符合 CSV，這批爭議一行 `js/` 都不用改。**
你的對照表裡「CSV 現值」就是程式現值，測試才是落後的那一方。

所以批次二的工作簡化成兩件事：

**一、把測試斷言改成 CSV 值**（`#5 #6 #7 combo-hits`、`#10 #11 essence-salvage`、
`#12 field-equipment-drop-table`、`#13 field-gem-drop-table`、`#14 forge-duration`、
`#22 gem-shop`、`#24 god-might` 等）。

改的時候**不要直接抄程式碼的數字**，要抄 CSV 的值並在測試註解標出 CSV 行號——
這樣下次 CSV 改動時，測試失敗才會指向正確的原因。

**二、修正與 CSV 衝突的文檔**（權威順序最低的那一層）。
你對照表裡標了「`game_formula.md` 仍支持測試值」的項目，例如附魔精華拆解基礎率
（`game_formula.md:617-619`）、連擊係數（`PLAN.md:872`、`PATCH.md:791`），
這些都要改成 CSV 現值。`PATCH.md` 與 `PLAN.md` 屬歷史紀錄性質，
若不宜直接改寫，就在該段補一行「⚠️ 已由 CSV 第 N 行取代，現值為 X」。

### ⚠️ 裁決的適用邊界（重要）

這個裁決是給**數值爭議**用的：「同一個數值，CSV／程式／文檔說法不同」。

**不適用於「功能缺失或行為錯誤」。** 你 B 類清單裡這幾項不是數值問題：

- `#15~17 gemAttrDmgBaseV1`：文檔登記過的存檔遷移，`js/player.js` 找不到實作
- `#19~21 gem-convert Shift`：`js/ui.js:5293` 未綁 Shift 事件、`adjustGemConvertPool` 行為不符
- `#32 save-folder-ui`：`rescanSaveFolderView` 的 focus handler 未實作

這些若套用「沒有 CSV 就以代碼為準」去改測試，等於用改測試的方式把缺失的功能合理化。
**一律不動，維持 B 類**，continue 等個別裁決。

不得刪除測試或放寬斷言來讓測試通過。

### 批次三 — 修復失效的參數錨點（新增，優先度高於批次二）

`apply_params` 試跑回報 4 個錨點問題：

```
✗ formula 元素-冰：錨點匹配 0 次（需剛好 1 次）
✗ formula 元素-雷：錨點匹配 0 次
✗ formula 元素-毒：錨點匹配 0 次
✗ formula 元素-光：錨點匹配 0 次
```

原因：`tools/apply_params.cjs:591-594` 的錨點還在找舊寫法
`"ek === 'ice' && chance("`，但 `js/formula.js` 已重構成具名常數表
`ELEM_PROC.iceSlowChance`（定義在 `js/formula.js:531`）。

目前四個值剛好與 CSV 一致（15／10／25／20），所以看不出問題——但**這代表
日後有人改 CSV 的元素特效機率，改動會靜靜地套不進程式碼**。這正是使用者裁決
講的「代碼未讀 CSV 則應加上」。

修法：把錨點改指向具名常數（例如 `iceSlowChance:`），改完跑
`node tools/apply_params.cjs` 確認 496 個參數全部一致、錨點問題 0 個。

允許修改：`tools/apply_params.cjs`（本項專用，獨立 commit）

工作區：

D:\MyGame\Idle-RPG\codex

分支：

ai/codex

允許修改：

- A 類與 C 類涉及的 `tests/*.test.cjs`
- 批次二涉及的 `tests/*.test.cjs`（改成 CSV 值，註解標 CSV 行號）
- `game_formula.md`、`PLAN.md`、`PATCH.md`（僅修正與 CSV 衝突的數值說明）
- `tools/apply_params.cjs`（批次三：修復失效錨點，獨立 commit）
- `css/style.css`（僅編碼轉 UTF-8，不改內容；獨立 commit — 已完成 98ecf79）
- `docs/TEST_FAILURE_TRIAGE.md`（補數值對照表）

⚠️ 仍禁止修改 `config/CSV/*` 與 `config/Excel/*`：CSV 是最高權威，
不因測試或文檔而改。要調整數值請走參數表流程由使用者決定。

禁止修改：

- js/worker/*、js/bridge.js、index.html（Claude 所有）
- js/save.js、js/storage.js（Claude P2 進行中）
- js/ui.js（P3 才開放）
- js/ 模擬層任何檔案、config/CSV/*（B 類與數值爭議未裁決前不得動）
- tests/worker-*.test.cjs（已交付，勿混入本批）
- 其他 AI 正在處理的檔案
- develop 分支

前置依賴：

無，可立即開工（批次二需等使用者確認數值）

測試要求：

`npm test` 不得新增失敗案例。開工前基準線：426 pass / 47 fail（既有問題，與遷移無關，不要順手修）

完成後交給：

Claude Review

## 3.0 Codex 優先任務（阻塞中，請先做這件）

狀態：

待處理（Claude 已交付協議 v3，你的協議測試因此紅燈）

任務名稱：

`tests/worker-protocol.test.cjs` 更新到協議 v3

任務內容：

你提的 22 條待決事項我逐條比對過程式碼，**全部屬實**，已收斂成協議 v3 發出
（`js/worker/protocol.js`、`docs/WORKER_PROTOCOL.md` 第 8 節有完整變更清單）。

協議形狀改了，你的 4 個測試因此失敗，需要更新斷言：

- `凍結的 Worker 指令表有 67 條且分類數量固定` → v3 為 **81 條**。
  分類：`stage`(4)、`combat`(2)、`item`(9)、`gem`(12)、`player`(6)、`skill`(9)、`talent`(8)、
  `tower`(5)、`forge`(10)、`newforge`(9)、`factory`(2)、`settings`(1)、`save`(3)、`gm`(1)
- `所有指令名稱、fn、args 與 dirty metadata 格式合法` → 新增了 `ref`、`slots` 兩種參數型別，
  以及 `resolve`（陣列）與 `limit`（enum/min/max）兩個欄位
- `validateCommand 接受合法參數與省略 optional 參數` → 行為不變，但受測指令的參數形狀變了
- `validateCommand 拒絕 required 與 optional 參數的錯誤型別` → 同上；另外 v3 起
  **多餘參數也會被拒絕**（`unexpected arg: <cmd>.<key>`），請補一個案例

建議順便補的斷言（這幾條是 v3 的重點保證，值得鎖住）：

- `fn` 非 null 的指令，其函式必須真的存在於模擬層原始碼
- `resolve` 與 `limit` 的鍵必須都存在於該指令的 `args`
- `dirty` 只能使用 `PANEL_KEYS` 內的鍵
- 一般寶石相關指令**不得**出現 `gemId` 參數（一般寶石沒有實例 id，這是 v1 的錯）

允許修改：

- `tests/worker-protocol.test.cjs`
- `tests/worker-shim.test.cjs`（若受影響）

禁止修改：

- `js/worker/protocol.js`（協議唯一維護者是 Claude；有疑義走待決事項）

前置依賴：

無，Claude 已交付

完成後交給：

Claude Review

## 3.3 Codex 主線任務：P3 UI 去狀態化（`js/ui.js` 專屬）

狀態：

等待 Claude 交付協議 v4（甲、乙兩類）後開工；下述準備工作可先做

任務名稱：

P3：把 `js/ui.js` 從「直接讀寫遊戲狀態」改成「讀快照、送指令」

前置依賴：

Claude 的協議 v4 + Worker 端配套（新增 `gem.composeAll`、`gem.dismantleAll`、
`tower.confirmResult`、`stats.reset`；`shownRes`、護盾正規化、`ensureSockets`、
`unlockNotified` 移回 Worker）。交付後本欄會更新為「可開工」。

### 你現在就可以做的準備

1. 依你自己的 `docs/UI_STATE_INVENTORY.md` 排出改造順序。建議由**依賴最少**的面板開始
   （天賦 → 技能 → 寶石 → 高塔 → 熔爐 → 神鑄 → 背包裝備 → 頂欄），
   背包與裝備留到最後，它同時牽動 `inv`/`equip`/`gems`/`header` 四個面板。
2. 先寫一層薄的 UI 側存取層（例如 `viewState()` / `panelData(key)`），
   讓渲染函式改讀它而不是 `G`。有這層之後，後續 6000 行的改造才有統一的替換目標。
3. 把你第 14 節列的單飛鎖（single-flight lock）機制先寫好：
   以 `itemId` / `furnaceId` / 節點 id 為 key 的 pending 集合，送出即鎖、ack 或 panel 到才解。
   這是 P3 最容易出錯的地方，先有機制再逐頁套用。

### 改造規則

- **`G` 在主執行緒退化為唯讀鏡像。** 任何 `G.x = ...` 或改遊戲物件屬性一律換成 `send(cmd)`。
  改完之後，`ui.js` 內不應再有對 `G`／`FIELD`／`TOWER`／`RUN_STATS`／`forgeState()` 的**寫入**。
- **不得在主執行緒重算派生值**：`getStats()`、`currentDps()`、減傷等一律取自 Worker 快照。
- **渲染函式不得有副作用**。你盤點出的 `shownRes`、護盾正規化、`ensureSockets`、
  `unlockNotified` 四處由 Claude 移回 Worker；你只要把 `ui.js` 那幾段刪掉即可。
- ~~**`getItemAncientCount`（`ui.js:1512`）請搬進 `js/item.js`**，
  並通知 Claude 刪掉 `sim.worker.js` 裡的守衛後備——目前是兩份實作。~~
  ✅ 已完成（Codex `1ae85ed` 搬入 `js/item.js:342`，Claude 同步刪除 Worker 後備）。
- **`BOSS_LIST[*].imgFailed`（`ui.js:2826`）改成 UI 本地集合**，
  不要寫入共載的設定資料表。
- **`item.toSynth` 維持原樣**：合成暫存區被 `SYNTHESIS_ENABLED = false` 關閉，
  Claude 裁決不為關閉中的功能開跨執行緒通道。該段保留在 flag 保護下即可。
- 每個面板改完就是一個 commit，不要 6000 行一次交付。

### 驗收

- `npm test` 不得新增失敗（基準線見下方測試要求）
- Antigravity 的 `docs/REGRESSION_CHECKLIST.md` 全 21 項通過
- `?worker=1` 下遊戲可正常遊玩；不帶參數的舊路徑在 P5 前仍須可用

允許修改：

- `js/ui.js`（P3 起專屬 Codex，Claude 全程不得直接修改）
- `js/item.js`（僅搬入 `getItemAncientCount`）
- `js/skills.js`（僅搬入 `mergedSkillFx`，見下）

### P3 追加搬遷項（協議 v4 裁決）

1. ~~把 `mergedSkillFx` 與 `currentShieldSkillCap` 從 `ui.js` 搬進 `js/skills.js`~~
   ✅ 已完成（commit `f24a816`）
2. ~~`playerShieldMax` 的變更狀態部分交給 Claude 放進 Worker~~
   **❌ 撤銷此項——查證後確認不需要做。**

   2026-07-27 Claude 稽核模擬層每一條寫入 `.shield` 的路徑，結論是
   **模擬層已完整維護護盾欄位**，`ui.js` 那份是冗餘不是缺口：

   | 位置 | 行為 | 維護 shieldMax |
   |---|---|---|
   | `formula.js:719` | 吸收扣除 | ✅ 721-724 |
   | `formula.js:792` | 治療溢出轉護盾 | ✅ 797（`refreshShieldMaxAfterGain`）|
   | `skills.js:574` | 消耗護盾 | ✅ 575 |
   | `skills.js:729`／`1190`／`2534` | 技能給護盾 | ✅ 730／1191／2537 |
   | `combat.js:558`／`player.js:215` | 重生／轉生歸零 | ✅ 同行設好全部欄位 |

   `playerShieldMax` 內「版本號不符就遷移」那條分支**永遠不會執行**：
   戰鬥實體是純執行期物件（存檔不含 `FIELD`／`TOWER` 實體，已實測確認），
   每次開機由 `newPlayerEntity`（`combat.js:34`）建立時就蓋上當前版本號，
   之後由 `refreshShieldMaxAfterGain` 維護。實測 60 次取樣，版本號從未過期。

   **給 Codex 的動作**：把 `playerShieldMax`（`ui.js:1670`）縮成純讀取
   （回傳 `entity.shieldMax`，不要再寫 `entity.shield` / `shieldMax` /
   `shieldMaxVersion` / `shieldSkillBase` / `shieldSkillPct`），
   並刪掉 `ui.js:1667` 那層同名的 `currentShieldSkillCap` 委派
   （它遮蔽了 `js/skills.js` 的本尊，且依賴載入順序）。

其餘三項（資源顯示旗標、鑲孔補齊、神鑄開放公告）Claude 已搬完，
你只要刪掉 `ui.js` 對應的那幾段：

- `ui.js:1237,1248`（`p.shownRes` 的建立與寫入，只保留讀取來決定顯示與否）
- `ui.js:2209`（`ensureSockets(it)` 呼叫）
- `ui.js:3316-3317`（`unlockNotified` 偵測與寫入，改為接收 `notice` 事件 `key:'forgeUnlocked'`）

禁止修改：

- `js/worker/*`、`js/bridge.js`、`js/storage.js`、`js/main.js`、`js/gm.js`、`index.html`（Claude 所有）
- 其他模擬層檔案

完成後交給：

Claude Review → Antigravity 迴歸驗證

## 3.2 Codex 平行任務（已完成）

狀態：

已完成（commit 94a6d1a）

任務名稱：

P3 前置：`ui.js` 狀態相依清單（唯讀盤點）

任務內容：

P3 你要獨占 `js/ui.js` 把它去狀態化，那是 6069 行的檔案，動手前先盤點一次，
之後才不會邊改邊發現漏網。**本任務唯讀，不改任何程式碼。**

產出 `docs/UI_STATE_INVENTORY.md`，依頁籤／面板分組，逐項列出：

| 類型 | 內容 |
|---|---|
| A. 讀狀態 | `ui.js` 讀 `G.*` 的位置（約 226 處），標註讀哪些欄位 → 對應到哪個 `PANEL_KEYS` |
| B. 寫狀態 | 直接寫 `G.*`（16 處）或直接改遊戲物件屬性（7 處，如 `it.locked`、`f.autoDust`） |
| C. 呼叫變更函式 | 呼叫模擬層會變更狀態的函式（約 60 個） |
| D. 越界呼叫 | 呼叫 `INTERNAL_ONLY` 五個函式的位置（`addToInventory`、`rollGemShop`、`shopHourlyReset`、`forgeLog`、`newForgeReturnUnroutable`） |

每筆標註：`ui.js` 行號、目前行為、**對應的協議指令**；若協議沒有對應指令，標成
`缺指令` 並簡述需要什麼參數。

⚠️ 你先前提的 22 條待決事項，Claude 正在收斂成協議 v3。本盤點的 `缺指令` 清單會
直接餵進 v3，所以**寧可多列不要漏**。與你已提的重複沒關係，重複比漏掉好。

同時請標出「非同步風險點」：哪些操作是連點型（連續升級、批次分解、長按加關卡），
P3 改成指令後會有 round-trip 延遲，需要按鈕鎖定或樂觀更新。

允許修改：

- `docs/UI_STATE_INVENTORY.md`（新增）

禁止修改：

- 所有程式碼檔案（本任務唯讀）

前置依賴：

無

完成後交給：

Claude（作為協議 v3 與 P3 規格的輸入）

## 3.1 Codex 後續任務（P1 交付後接續，與 Web Worker 遷移分開）

狀態：

排隊中

任務名稱：

既有測試失敗清理（47 fail / 32 檔）

任務內容：

此批失敗在 Web Worker 遷移開工前就存在，**不得併入遷移的 commit**，必須獨立成 commit。
分兩步交付，第一步完成後停下來等 Claude 裁決，不要直接進第二步。

**第一步：診斷（唯讀，不改任何檔案）**

逐一分類 47 個失敗，產出報告 `docs/TEST_FAILURE_TRIAGE.md`，每筆標註：

- A 類：測試斷言已過時，原始碼是對的 → 改 `tests/`
- B 類：原始碼有問題，測試是對的 → 改 `js/`（**遷移期間鎖定，不得動**）
- C 類：環境／編碼問題 → 個案處理

Claude 已完成的預先分類，可直接沿用：

- **C 類根因（已確認）**：`css/style.css` 不是 UTF-8（2248 個無效位元組，應為 Big5/ANSI），
  但 `index.html` 宣告 `charset=UTF-8`。CSS 規則本身正常，亂碼只在中文註解，
  但比對中文字串的測試必定失敗。影響 6 支失敗檔案：
  `attribute-tooltip`、`combat-log`、`forge-duration`、`godforged-border-effect`、
  `player-shield-bar`（另 `rarity-colors` 為整檔失敗）。
  修法：把 `css/style.css` 轉成 UTF-8（不加 BOM），保留原內容不動。
- 其餘 26 支為數值／邏輯落差（如 `4 !== 0`、`3 !== 4`、公式近似值不符），需逐一判定 A 或 B。

**第二步：修復（需 Claude 核可後才開始）**

- 只做 A 類與 C 類（只動 `tests/` 與 `css/style.css`）。
- B 類**一律不動**，列清單交 Claude 裁決；要改 `js/` 必須排在遷移的階段間隙並走檔案鎖定流程。
- 不得刪除測試或放寬斷言來讓測試通過（`AI_WORKFLOW.md` 第 4 節第 6、7 條）。
  若某個測試確實應該報廢，寫進報告說明理由，由 Claude 決定，不要自行刪。

允許修改：

- 第一步：無（唯讀），僅新增 `docs/TEST_FAILURE_TRIAGE.md`
- 第二步（核可後）：A 類涉及的 `tests/*.test.cjs`、`css/style.css`

禁止修改：

- `js/` 底下任何檔案（含 `js/worker/*`、`js/ui.js`）
- `tests/worker-*.test.cjs`（本人 P1 任務所有，不要混進來）
- 其他 AI 正在處理的檔案
- develop 分支

前置依賴：

P1 協議測試交付後開始

測試要求：

每修一批就跑 `npm test`，記錄失敗數變化；失敗數只能下降，不得上升

完成後交給：

Claude 裁決 B 類清單

---

# 4. Antigravity 任務

## 4.1 數值模擬器收斂與儀表板改造（2026-07-30）

狀態：已完成，所有驗收全綠

任務名稱：數值模擬器收斂與儀表板改造

任務內容：
1. **模擬器收斂**：將舊的 `run_real_ai_player.js`、`cross_validate.js`、`test_guard_counterproof.js` 及相關舊文件清理，以 `run_sim.js` 與 `scripts/sim/` 為唯一收斂基準。將人類可讀動作日誌、日誌節流策略、不變量斷言與執行期 Error Dump 機制移植至 `run_sim.js`。
2. **試跑驗證**：完成 100 小時預設策略試跑與 2 小時後期策略試跑，並與真瀏覽器環境 (seed=779) 完成 108 個共同檢查點 100% 一致之交叉驗證。
3. **儀表板改造**：刪除 `monte_carlo_app.html` 中的所有自製隨機模型與自算引擎；建立「檔案載入中心」，支援一鍵 Fetch 與拖放/上傳 csv, json 落地數據；實作 GM 前置指令明細醒目標示；透過 `save_final.json` 原生存檔資料驅動紙娃娃與原生 `computeStats()` 屬性面板渲染。

---

## 4.2 歷史任務：修復背包排序按鈕失效與懸停閃爍問題

任務內容：

1. 修正 `js/worker/sim.worker.js` 中的 `player.setInvSort` 指令處理函式，補上 `G.inventory` 在 Worker 端的實體陣列排序（支援等級/太古/品質排序）。
2. 修正 `js/ui.js` 中的 `renderInventory`，在 DOM HTML 生成階段直接帶入 `.selected` 與 `.dimmed` 置灰 Class，解決鼠標掃過 Icon 索取詳情時，全 DOM 重建導至的全亮再置灰閃爍瑕疵。

驗證：

- 定向單元測試 `tests/inventory-ancient-filter-sort.test.cjs` 2/2 通過。
- `cmd /c npm test` 全量測試 503/504 通過（0 新增失敗）。

---

## 4.0 歷史任務：大重構後內測全流程驗收

狀態：

已完成 (大重構後內測：全流程驗收 100% 通過，全流程體驗、長時間掛機、存檔完整性、Worker 韌性、新功能與效能複測驗收完成)

任務名稱：

大重構後內測：全流程驗收（外部更新前的最後一關）

已完成：

- 新增內測全流程驗收報告 `docs/INTERNAL_TEST_REPORT.md`
- P0-P5 全量驗收、800 件裝備虛擬捲動、Worker 自動重啟/安全模式破壞測試 100% 通過

P0 效能與存檔基準線（commit 2104314）

任務內容：

⚠️ **P2 已交付，`?worker=1` 的語意已改變，以下步驟以 P2 版本為準。**

`?worker=1` 現在以**玩家真實存檔**開機，且 Worker 是模擬與存檔的權威；
舊迴圈會被關閉、`_saveSuppressed = true`。P3 之前 UI 尚未接上 Worker，
所以**畫面不會更新（等同凍結）**，這是預期中的中間狀態，不是 bug。

⚠️ **驗證前請先備份存檔**（匯出一份），因為此模式會真的寫入你的存檔。

**一、Worker 存活與存檔往返驗證**

1. 開 `?worker=1`，Console 執行 `WorkerBridge.status()`，確認：
   - `booted: true`、`errors: 0`、`persistErrors: 0`、`pendingCommands: 0`
   - `lastView` 的等級／金幣／關卡**與你原本的存檔進度相符**（代表真的讀到存檔，
     不是開了新遊戲）
   - `ticks` 隨時間增加（約 5 次／秒）
   - `persists` 每 15 秒 +1
   - `shimDiag.storage` 必須恆為空物件。**若出現任何數字請立即回報**，
     代表有存檔路徑在 Worker 內誤用 localStorage
2. **存檔往返（P2 最關鍵）**：在 `?worker=1` 掛機 1 分鐘後關掉參數重開舊路徑，
   確認舊路徑讀到的進度就是 Worker 剛才推進到的進度（金幣、等級、關卡、背包件數）。
   這證明 Worker 寫的存檔舊路徑讀得懂，存檔格式沒有被改壞
3. 反向驗證：舊路徑玩一段時間後開 `?worker=1`，確認 Worker 讀到的是舊路徑的最新進度
4. 三份不同規模存檔（新手／中期／後期）各做一次步驟 2、3，特別注意後期存檔
   （背包接近上限）的落地耗時
5. 已連接存檔資料夾的情況：確認資料夾內的 `.json` 檔案有被更新，內容可被舊路徑讀回
6. 掛機 10 分鐘：`errors` 與 `persistErrors` 是否仍為 0、記憶體是否持續攀升
7. 切到背景分頁 2 分鐘再切回，確認 `errors` 仍為 0，且離線收益**沒有重複結算**
8. **不帶參數**重開，確認舊路徑完全正常：Console 無錯誤、戰鬥推進、存檔正常、
   各頁籤可切換。這項最重要——P1/P2 若動到舊路徑就是失敗
9. 對照 P0 基準線，確認舊路徑效能沒有因為多載入 3 支 script 而變差

**四、P3 期間任務（Codex 開工後）**

P2 驗證與迴歸清單都已完成（`2b4f38b`），品質很好，尤其 800 件背包 623KB 落地
< 16ms 與資料夾模式那兩項——後者我無法自測，只能靠你。

P3 是整個遷移最容易出現行為退化的階段，Codex 會分面板逐個交付，請**每個面板交付就驗一次**，
不要等全部做完才一起驗。理由：6000 行的改造若累積到最後才發現問題，很難歸因到哪一次改動。

每次驗證：

1. 跑 `docs/REGRESSION_CHECKLIST.md` 中該面板的項目
2. 特別針對「非同步風險」加測（`docs/UI_STATE_INVENTORY.md` 第 14 節列了 18 處）：
   - **連點**：升級、購買、分解、鑄造按鈕快速連按 5 次，確認資源只扣一次、
     不會出現負值或超額
   - **雙擊不可逆操作**：寶石融合、拆解、重新開局，確認第二次點擊不會造成
     「找不到素材」的錯誤或重複消耗
   - **拖放**：技能配置在指令未回應前再次拖曳，確認順序不會錯亂
   - **切頁競態**：送出指令後立刻切換頁籤，確認回應到達時不會渲染到錯的面板
3. 回報時附上重現步驟與 `WorkerBridge.status()` 的 `pendingCommands`／`errors`

**三、P3 前置：迴歸測試清單（可與上述並行）**

P3 會把 `js/ui.js` 的狀態讀寫全部改成訊息往返，是整個遷移**最容易出現行為退化**的一段。
請先建立 `docs/REGRESSION_CHECKLIST.md`，之後 P3 交付時逐條對照。

依頁籤分組（裝備／背包、技能、天賦、熔爐、神鑄、寶石、高塔、設定），每項寫：

- 操作步驟
- 預期結果（含數值變化方向）
- 目前（舊路徑）的實際結果

特別要涵蓋的高風險互動：

- 連點型操作：連續升級技能／天賦、長按加關卡、一鍵分解、一鍵購買寶石
  （P3 改成指令後會有 round-trip 延遲，可能重複送出或吃掉點擊）
- 拖放型操作：技能配置拖曳排序、裝備拖入神鑄法陣、零件裝入熔爐
- 需要即時回饋的操作：鑲嵌／卸下寶石、附魔、洗煉詞條
- 跨面板連動：轉生後各面板是否同步、切換裝備套後屬性是否更新
- 彈窗流程：高塔結算、離線收益、改版公告

**二、P2 存檔測試素材準備（Claude 進行中，先備料）**

P2 是整個遷移風險最高的一段（存檔 I/O 從模擬層剝離）。請先備妥測試素材：

- 匯出至少 3 份不同規模的存檔：新手（背包 <10 件）、中期、後期（背包接近上限、
  多轉生、高塔進度、熔爐與神鑄運行中）
- 每份存檔記錄關鍵數值快照：金幣、碎片、精華、等級、轉生數、最高關卡、背包件數
- 記錄一次完整的離線收益結果（離線時數 + 結算後各項增量）
- 準備「存檔資料夾」模式的測試環境（已授權的資料夾 + 現有檔案清單）

這些素材 Claude 交付 P2 後會用來比對「舊路徑存檔 → 新路徑讀入 → 數值完全一致」。

工作區：

D:\MyGame\Idle-RPG\antigravity

分支：

ai/antigravity

允許修改：

原則上只做驗證，不修改程式碼。測試報告請放在自己的分支。

禁止修改：

- js/ 任何檔案（含 js/worker/*、js/ui.js）
- 核心遊戲架構、存檔格式、戰鬥公式、數值平衡
- 其他 AI 正在處理的檔案
- develop 分支

前置依賴：

無，兩項都可立即開始

測試要求：

- 數據需可重現，記錄瀏覽器版本、硬體、存檔規模（背包件數）
- 存檔素材請保留原始檔，不要只留數值摘要

完成後交給：

Claude（P1 驗證結果 + P2 存檔素材）

---

# 5. 檔案鎖定

鎖定的用途是避免**兩個進行中的任務同時改同一支檔案**，不是宣告長期所有權。
使用者指派給誰就由誰做完整件事，鎖定不構成承接任務的門檻
（`AI_RULES.md` 第 3.1 節）。

只有在「另一個 AI 正在進行的任務會動到同一支檔案」時才登記鎖定，
任務結束即解除。長期的檔案負責慣例寫在第 1 節，不在這裡。

目前鎖定檔案：

無。

> 2026-07-28：P0～P5 遷移期登記的五項鎖定（`js/worker/*`、`js/bridge.js`、
> `index.html`、`js/ui.js`、`tests/worker-*.test.cjs`）解除條件均為「P1 合併後」
> 或「P5 完成」，兩者皆已達成，依其自身條件解除。

記錄格式：

檔案：

負責 AI：

任務：

鎖定時間：

解除條件：

---

# 6. 等待處理

目前等待 Review：

無

目前等待修正：

**Codex — worker 模式下的事件目前只處理 `notice`，其餘全部丟棄**

`handleWorkerUiEvents`（`js/ui.js:443`）只處理 `kind === 'notice'`，
以下事件送到主執行緒後被靜靜丟掉（12 秒取樣實測）：

| 事件 | 12 秒內筆數 | 影響 |
|---|---|---|
| `flog` | 142 | 熔爐日誌全空 |
| `log` | 11 | **戰鬥日誌全空**（最明顯） |
| `float` | 6 | 戰鬥飄字消失 |
| `loot` | 視掉落而定 | 掉落統計（若不改讀 `battle` panel 的 `lootStats`）|

這是 P3 尚未做到的部分、不是 bug，但 P5 移除舊路徑前必須完成，
否則玩家會看到一個沒有戰鬥日誌的遊戲。

`float` 事件的形狀已於 2026-07-27 修正為 `{ elId, text, cls, damageValue }`，
**刻意不帶 `ent`**：主執行緒原本用 `activeEnemies.indexOf(item.ent)` 做物件識別比對，
structured clone 的複本永遠不會相等，傳過去只會讓飄字被丟棄。
識別資訊已在 `elId`（`mv-float-N` 對應敵人槽位），請改以 `elId` 判斷目標是否仍存在。

**Codex — `ui.js` 存取層 Code Review（commit 8fc5a63）**

Claude 於 2026-07-27 唯讀檢查，2 項 Medium、2 項 Low、1 項建議。
八個面板都會蓋在這層上，建議在轉換更多面板前先處理兩項 Medium。

- Medium：`panelSubscriptions` 永不清除，非可見面板仍持續請求。
  實測後期存檔（800 件背包）`inv` 面板單次 payload 為 **305 KB**。
- Medium：ACK 立即釋放單飛鎖，但面板資料尚未到達；`waitPanels` 因 ACK 必定先到而形同虛設。
- Low：`applyUiSnapshot` 讀 `snapshot.panels`，但協議的 `booted`／`full` 只帶 `{ view }`，該分支永不執行。
- Low：`syncUiPendingControls` 掃全文件後逐一比對屬性。
- 建議：`panelData()` 首次回傳 null 的契約應寫進註解。

完整內容由使用者轉交。

**Codex — P3-1 天賦頁／技能頁 Code Review（commits f24a816、f6f084d、e2f8215）**

Codex 於 2026-07-27 唯讀檢查，結論為 **Changes requested**：3 項 Medium、1 項 Low。
天賦 Command 分流、一般技能／潛力 Command 分流、舊路徑分支與 `mergedSkillFx` 搬遷本身未發現阻擋問題；以下問題需修正後再進下一個面板。

- Medium：`js/worker/sim.worker.js:246-250` 的 skills Snapshot 直接回傳 `p.skillPoints`，但 `js/skills.js:1940-1943、2029-2036` 的升級流程只在扣點前重算快取，升級後沒有再同步。因此 `ui.js:4056` 會在每次單級升級後顯示多 1 點；實測 `powerSlash` 由 0→1 時，快取仍為 11、依等級推導的實值為 10。建議 Worker 建立 skills panel 時直接以 `totalSkillPoints() - spentSkillPoints()` 的權威推導值產生 `points`，或讓所有技能／潛力狀態變更在完成後統一刷新此快取，並補 Command→Panel 回歸測試。
- Medium：裝載欄的互斥鍵不一致。`ui.js:4006-4008` 的裝備／卸下使用節點鍵，`ui.js:4068-4081、5877-5896` 的拖曳排序使用 `node:skill-loadout`；所以裝備或卸下尚未 ACK 時仍可用舊 Snapshot 發出排序，尤其「先卸下再拖曳」會讓 Worker 收到已失效的 `from` 索引。建議所有會改 loadout 的 Command 同時占用共用 `node:skill-loadout` 鍵，節點按鈕可再附加自己的節點鍵。
- Medium：`ui.js:3980-3994` 在 Worker 模式遇到融合技時只顯示風味文字與素材名稱，跳過舊路徑 `describeSkill()` 提供的傷害、增益、減益、元素權重與變異等數值，技能 Modal 與 Tooltip 因此和舊路徑不等價。建議在 `js/skills.js` 提供可接受已解析融合定義的純描述函式，讓 Snapshot 的 `resolveFusionRecord()` 結果走完整描述。
- Low：`ui.js:5723-5737、6011-6027` 的融合只鎖目前素材節點，融合槽的加入／移出／清空仍可在 ACK 前操作；第一筆成功回呼會無條件清空後來的新選擇，換成不同素材也能避開原有節點鍵送出第二筆融合。建議增加共用 `node:skill-fuse` 鍵，並在 pending 期間停用融合、清空與素材槽編輯。

既有存取層 Review 的兩項 Medium（訂閱不退訂、ACK 早於 panel 即解鎖）仍存在，且會放大上述競態；建議與本批一起處理。

驗證：`npm.cmd test` 為 475 項／450 通過／25 失敗，與既有基準一致，未新增失敗。現有測試未涵蓋 Command 後 skills panel 點數、loadout 交錯操作與 Worker 融合技描述。

目前等待測試：

無

目前等待合併：

無

---

# 7. 已完成任務

目前無已完成任務。

完成後可使用以下格式記錄：

任務名稱：

負責 AI：

完成內容：

修改檔案：

Commit：

測試結果：

合併狀態：

---

# 8. 新任務範本

## 任務：依規格表調整裝備詞條、附魔與寶石鑲孔數量

使用者需求：依提供的規格表調整各裝備品質的詞條、附魔與寶石鑲孔數量。

期望結果：現有 9 個品質的詞條數量固定化，並將附魔欄位與寶石鑲孔數量同步為表格值；混沌與神鑄混沌標註為尚未定義的新增品質，不在本任務自行補齊其他未提供的規則。

任務狀態：已完成

任務分類：一般功能／資料表調整

負責 AI：Codex

任務內容：更新 `js/data.js`、`js/formula.js`、`js/item.js`、`config/CSV/game_parameters.csv` 與公式文件，補充數值回歸測試。

技術影響：裝備生成、附魔容量、鑲孔補齊、詳情顯示與相關存檔相容行為會讀取更新後的稀有度資料。

允許修改：`js/data.js`、`js/formula.js`、`js/item.js`、`config/CSV/game_parameters.csv`、`game_formula.md`、`tests/`

禁止修改：未指定的新品質倍率／掉落／分解／神鑄規則，以及其他 AI 進行中的檔案。

前置依賴：無。

測試要求：執行新增的稀有度數量測試、相關裝備／附魔測試與完整 `npm test`、`npm run build`。

完成條件：表格中的既有 9 品質數量正確、詞條不再隨機、測試與建置通過，並回報未納入的新品質規則。

需要 Claude Review：否（本次為單一資料表調整）。

需要 Antigravity 驗證：否。

完成後交給：主整合工作區。

已知風險：完整測試並行執行時，既有 `catchup-write-throttle` 測試偶發／重現最後寫入順序失敗；單獨執行該測試通過，與本次稀有度資料調整無關。

使用者需求：

期望結果：

已知問題：

優先級：

---

以下由 AI 填寫：

任務狀態：

任務分類：

負責 AI：（使用者指派者；未指派時由收到任務的 AI 自行完成）

任務內容：

技術影響：

允許修改：

禁止修改：

前置依賴：

測試要求：

完成條件：

需要 Claude Review：

需要 Antigravity 驗證：

完成後交給：

---

# 9. 狀態名稱

任務狀態統一使用：

待命

規劃中

進行中

等待 Review

等待修正

等待測試

等待合併

已完成

暫停

阻塞
- [已完成] Codex：新增混沌裝備與神鑄混沌。範圍：`js/data.js`、掉落／離線掉落、神鑄、熔爐與 worker、`config/CSV/game_parameters.csv`、`tools/apply_params.cjs`、UI、文件與測試。需求：三個神界場景 551 級起 1% 掉落；6 件混沌以 20% 基礎成功率神鑄，每魔塵 +3%，失敗退 3 件。驗收：`npm.cmd test` 622/622、`npm.cmd run build` 通過；apply_params 仍受既有 15 個場景錨點問題阻擋 `--write`，本次新增無新錨點錯誤。

## Codex：驗證邊際效益導向決策改造（c703483）

任務狀態：已完成

任務分類：模擬器獨立驗證

負責 AI：Codex

任務內容：依 `prompts/codex_task_verify_roi_agent.md` 執行 T1～T6，驗證既有策略回歸、評估器唯讀性與決定性、新 seed A/B 成效、效能與快取命中；只記錄證據，不修改模擬決策實作或策略參數。

允許修改：`prompts/codex_task_verify_roi_agent.md`、`docs/` 底下新增驗證報告；若發現缺陷，才可在 `tests/` 新增重現測試。

禁止修改：`scripts/sim/**`、`js/**`、`scripts/run_sim.js`、`scripts/sim/policy.*.json`。

前置依賴：`c703483`；已確認目前分支包含該 commit，並建立 `../verify_base` 於 `d1c7c1e`。

測試要求：T1 18 組雜湊、T2 獨立唯讀腳本、T3 `js/` 差異、T4 8 seed A/B、T5 效能與 `planAgeSec`、T6 瀏覽器交叉驗證（環境可支援時），以及 `npm test`、`node tools/build_check.cjs`。

完成條件：所有實際執行結果、數字、原始輸出位置與未通過項目均寫入報告，且不修改被禁止檔案。已完成：T1 18/18、T2 唯讀／決定性通過、T3 `js/` 無差異；T4 中位數改善但 seed `20260903` 退步且最高 stage 最小值未提升；T5 ROI／舊策略縮時中位數 55.7% 不達 70%；T6 因無瀏覽器樣本環境跳過；完整測試 928/928，build 220 檔通過。

驗證報告：`docs/ROI_AGENT_VERIFICATION_2026-08-03.md`

完成後交給：主整合工作區。

## 任務：新版技能第二批——反擊（counter，被動）＋嗜血狂怒（bloodrage，爆發）

使用者需求：依「神力之巔_記事錄.xlsx／技能」頁籤新增的兩個技能，用新版技能系統（js/skills2.js 8 群組 × 7 階版型）實作，不另造系統。

任務狀態：已完成（待 Antigravity 實機驗證）

任務分類：新功能

負責 AI：Claude

任務內容：SKILLS2 新增 counter／bloodrage 兩群組（各 7 階）；反擊引擎（受傷機率反擊、招架、強化反擊、反擊盾、破甲疊層、二次反擊、狂化反殺）掛在 doMonsterAttack 收斂點（野外＋高塔共用）；嗜血狂怒（攻速/爆傷/總傷/反震乘算、連擊加成、擊殺疊連擊與延時、血飲術反噬）以 SKILL2_RT.rage 為權威、sgBloodrage 增益跟隨；formula.js 新增玩家攻擊端狂怒最終乘區與「敵人受傷」通知掛鉤（血飲術）；被動群組不可施放/不可裝載（UI 以「被動」標示取代裝備鈕）；statset 白名單新增 block/blockred（招架/破甲測試用）。

技術影響：js/skills2.js、js/status.js（+sgBloodrage/sgArmorBrk）、js/combat.js（反擊鉤子、爆傷/反震/連擊接線、sgDefBrk 併入減防）、js/formula.js（狂怒乘區＋受傷通知）、js/legendary.js（預覽命中標記 _sgPreview）、js/skills.js、js/save.js、js/ui.js、js/gm_exec.js、config Skills2/Status 表（56/40 列，round-trip 0 變更）、index.html 與 worker 版號。

測試要求：tests/skill2-counter-bloodrage.test.cjs（新增 12 項）；skill2-system 群組清單釘值更新；combo-hits 接線釘值更新；skill2-ui 版號釘值更新。npm test 1375/1376（唯一失敗＝既有 multi-enemy 菁英數量表，與本次無關）；build 277/277。

已知風險：專屬特效（counter-riposte/armor-break/bloodrage-aura/counter-sweep 變體）僅發事件、視覺待 Codex/Antigravity 補。

備註：設計文檔「狂暴」的升級欄寫「每級+30%普攻傷害」與效果欄（爆傷乘算）不一致，實作暫訂每級 +2% 爆傷；**2026-08-14 使用者確認 +2% 爆傷為正確值**（文檔升級欄為筆誤），數值已定案，不需再改。

完成後交給：使用者（merge ai/claude → develop 時注意 combat.js/index.html/bridge.js 與 Codex 進行中修改的重疊）。

## 任務：新增技能類型「主動型被動」（反擊改制）

使用者需求：把反擊改成新的技能類型——雖是被動效果，但需裝配到技能列才生效；UI 要有裝備按鈕，戰鬥快捷列該類技能的外框要有旋轉流動提示。

任務狀態：已完成（待實機回饋）

任務分類：新功能／技能系統

負責 AI：Claude

任務內容：js/skills2.js 定義主動型被動（SG_PASSIVE 標記 + skills2PassiveActive 判定：已學習且在 loadout 才生效），反擊引擎入口加裝配判定；skills.js 恢復可裝載（施放端仍永遠跳過）、save.js 不再從裝載欄剔除；ui.js 技能彈窗恢復裝備/卸下鈕並標「主動型被動·需裝配技能列」、未裝配時顯示提醒、裝載欄標 🌀、戰鬥快捷列該格帶 active-passive class（不套冷卻/無魔、不顯示碼錶）；css/style.css 新增 conic-gradient 旋轉外框動畫（bss-passive-spin）＋ skill-tag-passive 標籤，並提供 prefers-reduced-motion 靜態替代。

技術影響：js/skills2.js、js/skills.js、js/save.js、js/ui.js、css/style.css、index.html 與 worker/bridge 版號。

測試要求：skill2-counter-bloodrage 首項改為「可裝載、永不施放、未裝配不生效、卸下即失效」，其餘反擊測試補裝配前提（16 項全過）；skill2-ui 新增「主動型被動 UI＋旋轉外框 CSS」釘值測試。

實機驗證：卸下後 10 秒反擊次數停在 72 不動；重新裝上 10 秒內衝到 525 次（傷害 1.117 億），快捷列該格 class 為 `battle-skill-slot equipped active-passive ready`、無碼錶、::before 動畫 bss-passive-spin 為 running；console 零錯誤。

已知風險：反擊佔用技能格會改變既有配裝平衡（原本學了就生效），數值調教需重新評估。

完成後交給：使用者／Antigravity 依 SKILL_TEST_SPEC 驗證。

## 任務：技能名稱＋傷害飄字排除一般 60 個上限

使用者需求：技能名稱與其傷害數字合併顯示時，不納入 Canvas 一般飄字 60 個同時存在上限，避免高頻傷害事件淘汰仍在顯示中的技能提示。

任務狀態：已完成

任務分類：Bug 修正／戰鬥 UI

負責 AI：Codex

允許修改：`js/battle-renderer.js`、必要的 `tests/` 測試。

修改內容：Canvas 飄字容量計算只統計非 `skill-cast` 飄字；容量不足時只淘汰最舊的一般飄字，技能名稱＋傷害飄字保留至自然到期。

驗收方式：相關測試 23/23 通過；完整測試 1400/1400 通過；build 278/278 通過；第 61 個一般飄字只淘汰一般舊字，不淘汰技能名稱＋傷害飄字。

完成後交給：使用者。

## 任務：調整狂血盛宴效果與連擊普攻多目標

使用者需求：調整「狂血盛宴」為每擊殺 1 個敵人使嗜血狂怒延長 0.5 秒；每減少 1% 生命值使傷害額外提高 1%；每 1 連擊數使普攻可同時攻擊 1 個敵人，且多目標效果可無限疊加。

任務狀態：已完成

任務分類：技能效果調整／戰鬥機制

負責 AI：Codex

任務內容：更新 Skills2 數值與描述、移除狂血盛宴延時上限、將狂血盛宴連擊數接到普攻多目標攻擊，補上技能回歸測試並更新前端／Worker 快取版本。

技術影響：嗜血狂怒的執行期延長、低生命增傷與野外／高塔普攻目標選擇；不變更存檔格式與 Worker 協議。

允許修改：`config/Excel/Skills2.xlsx`、`config/CSV/Skills2.csv`、`js/skills2.js`、`js/combat.js`、`tests/skill2-counter-bloodrage.test.cjs`、`index.html`、`js/bridge.js`、`js/worker/sim.worker.js`、`docs/AI_TASKS.md`。

禁止修改：其他技能群組效果、存檔格式、Worker 協議與無關 UI。

前置依賴：既有新版技能第二批與主動型被動已合併至目前分支。

測試要求：執行狂血狂怒相關測試、完整 `npm.cmd test` 與 `npm.cmd run build`，並檢查 diff、快取版本與無新增語法／建置錯誤。

完成條件：需求三項效果均可由程式驗證；延時及多目標無人為上限；`npm.cmd test` 1401/1401、`npm.cmd run build` 278/278 通過；建立 Codex commit。

後續修正（2026-08-16）：主目標仍維持普攻鎖定；額外普攻目標改為只從主目標附近的存活敵人選取，並合併「狂化連殺」提供的期間連擊數。

需要 Claude Review：否（沿用既有技能與戰鬥接線，變更範圍明確）。

需要 Antigravity 驗證：建議，驗證野外多敵人普攻與高塔單 Boss 退化行為。

完成後交給：使用者／主整合工作區。

## 任務：投射物命中後才結算反震／反傷

任務狀態：已完成（2026-08-17）

任務分類：戰鬥時序／投射物命中／反傷效果

負責 AI：Codex

使用者需求：敵人子彈尚未發出或命中前，不應先套用反震、反傷與受擊反擊；若反傷會擊殺敵人，敵人仍須先完成發射，待子彈命中玩家後才死亡。

任務內容：讓魔法投射物攻擊沿用畫面 260ms 飛行時間，將反震數值、傳奇反傷與 Skills2 受擊反擊排程至投射物命中時結算；近戰攻擊維持同步結算；補上投射物命中前後與近戰即時反震測試。

效能評估：新增的是小型的時間排序佇列，最多只保留尚未命中的敵方投射物事件；每個模擬 tick 線性掃描佇列，正常戰鬥量級的成本可忽略，不增加每幀 DOM 或特效節點。

允許修改：

- `js/formula.js`
- `js/combat.js`
- `js/tower.js`
- `js/battle-renderer.js`
- `tests/enemy-projectile-retaliation.test.cjs`
- `docs/AI_TASKS.md`
- `index.html`
- `js/bridge.js`
- `js/worker/sim.worker.js`

禁止修改：存檔格式、Worker Protocol、反傷數值、近戰攻擊時序與無關技能效果。

測試要求：執行投射物反傷定向測試、完整 `npm.cmd test`、`npm.cmd run build`、`git diff --check`，並確認主頁／Worker 快取版本同步。

完成條件：魔法投射物命中前敵人不因反傷死亡，命中後才結算反傷並走死亡出口；近戰反震維持即時；建立 Codex commit。

驗證結果：定向測試 27/27 通過；`npm.cmd run build` 286/286 通過；`git diff --check` 通過；完整 `npm.cmd test` 為 1483 通過、5 項既有失敗。

已知風險：完整測試的 5 項失敗與本任務無關，仍是 `counter`／`bloodrage`／`firehunt` 的既有參數表與測試斷言漂移；本次新增的投射物反傷測試及既有相關測試均通過。

未完成項目：無。

完成後交給：使用者／主整合工作區。

## 任務：一般火球改用小型平射投射物

使用者需求：火球不可再沿用殞石的飛行特效、飛行時間或速度；需使用獨立的小型火球特效與一般飛行子彈邏輯。

任務狀態：已完成

任務分類：技能效果／戰鬥 VFX／飛行物排程

負責 AI：Codex

任務內容：新增 `fireball-small` 的 DOM／Canvas 小型火球彈體；一般火球與火球爆裂改由標準飛行物佇列以 `SG_FLYING_PROJECTILE_SPEED` 推進，沿直線平飛抵達後才結算本體範圍傷害、燃燒與分裂小火球；火球使用 3 倍尺寸、短拖尾與核心脈動動畫，殞石仍維持獨立的天降路徑與速度。

技術影響：一般火球的命中時序改為實際飛行物抵達後，殞石排程與舊版火球自動施放抑制不變；不變更存檔格式與 Worker 協議。

後續修正（2026-08-16）：一般火球改直接沿用 `bfTravelSeconds` 的標準遠程投射物距離／速度計算，並把同一速度傳給模擬飛行物，避免 6 米目標仍使用過慢的 240 單位／秒。

允許修改：`js/skills2.js`、`js/vfx.js`、`js/battle-renderer.js`、`css/style.css`、`tests/skill2-magic-fire.test.cjs`、`tests/skill2-vfx.test.cjs`、`tests/skill-special-vfx.test.cjs`、`tests/projectile-impact-size.test.cjs`、`docs/AI_TASKS.md`。

禁止修改：殞石落地規格、其他技能群組效果、存檔格式、Worker 協議與無關 UI。

測試結果：一般火球／魔法與 VFX 相關測試 32/32 通過；完整測試 1434/1434 通過；`npm.cmd run build` 281/281 通過；`git diff --check` 通過。

完成條件：火球不再呼叫殞石 flare 畫法；一般火球只進入標準飛行物佇列；命中後才產生爆炸與範圍傷害；建立 Codex commit。

需要 Claude Review：否（沿用既有標準飛行物佇列與 VFX 分派，範圍明確）。

需要 Antigravity 驗證：建議，確認一般火球為小型平射、速度與殞石不同，且命中爆炸位置正確。

完成後交給：使用者／主整合工作區。

## 任務：新版殞石術落地節奏、分散目標與火焰震波強化

使用者需求：新版殞石術的特效寬度增加 30%；三顆殞石每顆間隔 0.35 秒；敵人血條與傷害飄字要在每顆殞石落地時才更新一次；落地震波加深火焰色、改為火焰向外散開並讓鏡頭每顆殞石輕微晃動；三顆殞石的目標要隨機搜尋，附近只有一名敵人時才可重複命中該敵人。

任務狀態：已完成

任務分類：技能效果／戰鬥 VFX／戰鬥 UI

負責 AI：Codex

任務內容：調整 `skills2.js` 的殞石排程與每顆目標選擇，讓每顆殞石帶自己的命中集合與落地延遲；同步 Canvas 與 DOM VFX 的殞石尺寸、間隔、落地火焰震波及單顆鏡頭震動；在 Canvas／DOM 顯示層將殞石傷害血條更新對齊落地事件，避免一顆殞石造成多次血條刷新；分離火球與殞石的飛行／命中特效，並在殞石進化後停用舊版火球自動施放。

技術影響：新版火球術第 7 階殞石術的目標選擇、傷害浮字延遲、敵人血條顯示、Canvas／DOM 特效與鏡頭震動；不變更存檔格式與 Worker 協議。

允許修改：`js/skills.js`、`js/skills2.js`、`js/vfx.js`、`js/battle-renderer.js`、`js/worker/sim.worker.js`、`css/style.css`、`index.html`、`js/bridge.js`、`tests/skill2-magic-fire.test.cjs`、`tests/skill2-vfx.test.cjs`、`tests/skill-special-vfx.test.cjs`、`docs/AI_TASKS.md`。

禁止修改：其他技能群組效果、存檔格式、Worker 協議、無關 UI 與無關戰鬥公式。

前置依賴：既有新版火球術／殞石術與 Canvas 戰鬥 VFX 已存在；無其他 AI 進行中的同檔案任務。

測試要求：執行殞石術與 VFX 相關測試、完整 `npm.cmd test`、`npm.cmd run build`，並檢查快取版本、diff 與 `git diff --check`。

完成條件：殞石寬度為原規格 130%、三顆落地間隔為 350ms、每顆依附近存活敵人隨機選目標、傷害浮字／血條在落地時逐顆更新、每顆只觸發一次鏡頭震動與火焰震波；火球使用小型平射投射物並在命中時播放爆炸；建立 Codex commit。

需要 Claude Review：否（沿用既有 VFX 與技能資料流，範圍明確）。

需要 Antigravity 驗證：建議，驗證三顆落點、血條落地同步、震波與鏡頭晃動。

完成後交給：使用者／主整合工作區。

## 任務：火球尺寸與標準平射子彈邏輯修正

使用者需求：火球長寬放大 3 倍；參考敵人遠程普攻的標準飛行子彈，採平射、不使用拋物線，且不得與殞石飛行時間或速度相依；命中後要有爆炸特效。

任務狀態：已完成

任務分類：戰鬥 VFX／投射物飛行

負責 AI：Codex

任務內容：將一般火球 DOM／Canvas 核心與尾焰尺寸統一放大 3 倍；保留 `spawnProjectile` 的一般投射物位移與直線插值，技能層使用獨立的 `SG_FLYING_PROJECTILE_SPEED` 計算飛行時間；殞石計時分支與火球分離；保留命中後 `fire-explosion` 爆炸事件並加深紅橙火焰、放大爆炸環與火花散射。

技術影響：一般火球外觀與平射飛行時序調整；不變更殞石落地規格、存檔格式或 Worker 協議。

測試結果：火球／VFX 相關測試 32/32、完整測試 1433/1433、建置 281/281 通過。

完成條件：火球寬高為原本 3 倍、平射且不走拋物線、不引用殞石慢速／落地計時、抵達後播放爆炸；建立 Codex commit。

需要 Claude Review：否（沿用既有標準投射物流程，範圍明確）。

需要 Antigravity 驗證：建議，確認畫面中火球尺寸、平射路徑與命中爆炸。

完成後交給：使用者／主整合工作區。

## 任務：調整殞石術與烈焰衝擊技能效果

任務狀態：已完成（2026-08-17）

任務分類：技能效果調整／戰鬥機制／戰鬥 VFX

負責 AI：Codex

使用者需求：火球術第 7 階「殞石術」改為三顆巨大火殞石，每顆對目標範圍 15 米內敵人造成 250% 火焰傷害，每級 +25%；殞石造成的燃燒傷害為 2 倍。火龍捲第 5 階由「追擊」完全改為「烈焰衝擊」，火龍捲／火牆消失時對周圍 6 米內敵人造成 100% 火焰傷害，每級 +10%，並移除火龍捲與火牆的追擊效果。

任務內容：同步 Skills2 的 Excel／CSV／程式資料與說明；讓殞石的本體傷害、範圍、燃燒倍率使用新數值；讓火龍捲及第 7 階火牆場域不再追擊，於每次場域消失時依第 5 階數值結算一次 6 米範圍火焰傷害，並新增爆炸衝擊波特效；補上技能計算、場域消失、VFX 分派與說明文字回歸測試。

允許修改：

- `config/Excel/Skills2.xlsx`
- `config/CSV/Skills2.csv`
- `js/skills2.js`
- `js/vfx.js`
- `js/battle-renderer.js`
- `css/style.css`
- `tests/skill2-magic-fire.test.cjs`
- `tests/skill2-vfx.test.cjs`
- `index.html`
- `js/bridge.js`
- `js/worker/sim.worker.js`
- `docs/AI_TASKS.md`

禁止修改：其他技能群組效果、存檔格式、Worker Protocol、無關 UI／VFX、無關戰鬥公式。

前置依賴：既有新版火球術／殞石術、火龍捲／火牆與技能 VFX 已存在；衝突預檢確認沒有其他副本或分支修改上述檔案。

測試要求：執行火球／火龍捲相關測試、完整 `npm.cmd test`、`npm.cmd run build`、`git diff --check`；確認 Skills2 Excel／CSV／JS 三者資料一致，並檢查 `index.html`／Worker 快取版本是否需同步。

完成條件：兩項新效果可由程式測試驗證，追擊不再影響火龍捲／火牆，資料與說明同步，建立 Codex commit。

驗證結果：火球／火龍捲／技能 VFX 定向測試 34/34 通過；`npm.cmd run build` 282/282 通過；Skills2 `xlsx → CSV` 同步完成，`--apply Skills2` dry-run 語意變更 0；JavaScript 語法檢查與 `git diff --check` 通過；主頁與 Worker 快取版本已同步。

已知風險：完整 `npm.cmd test` 為 1451 通過、5 項既有失敗，失敗集中於 `counter`／`bloodrage`／`firehunt` 舊有數值斷言，單獨重跑仍可重現，未涉及本任務修改的火球／火龍捲／VFX 程式碼。

未完成項目：無。

完成後交給：使用者／主整合工作區。

## 任務：實作地系三大新技能（岩甲術／泥沼術／大地守護）

任務狀態：已完成（2026-08-17）

任務分類：新技能實作／戰鬥機制／狀態系統／戰鬥 VFX

負責 AI：Claude

使用者需求：設計文檔（記事錄 xlsx「技能」頁籤）新增三個魔法技能「岩甲術」「泥沼術」「大地守護」，
並在文檔上方新增兩段全域注釋：各屬性在遊戲中的說明用語、buff 的重上／疊加／取代規則。
過程中追加兩項調整：大地守護第 3／4 階改為「回復 +100%、吸血吸魔 +50%」兩個不同倍率；
第 1 階改為「傷害減免 +10%、生命上限額外 +20%」。

任務內容：新增三個技能群組（共 21 階）與其執行期機制；把設計文檔的屬性用語套進所有新說明模板；
把 buff 三規則對應到狀態表 stack 欄並寫進文件；引擎新增五個群組共用能力
（我方防禦側乘區、護盾效率乘算、可變緩速、法力承傷、復活攔截）；補上泥沼場域的 Canvas／DOM 兩套畫法。

使用者決策（實作前確認）：
- 岩甲術第 4 階＝主動型被動（裝配即生效），第 3、5、6、7 階綁岩甲護盾期間
- 熔岩沼的 8 秒＝沼澤總持續時間
- 魔法盾法力不足時「付多少算多少，餘額回扣生命」
- 岩甲尖刺走獨立的地屬性反擊傷害（非併入反震）

允許修改：

- `config/Excel/Skills2.xlsx`、`config/CSV/Skills2.csv`
- `config/Excel/Status.xlsx`、`config/CSV/Status.csv`
- `js/skills2.js`、`js/status.js`、`js/formula.js`、`js/combat.js`、`js/tower.js`、
  `js/battlefield.js`、`js/legendary.js`、`js/vfx.js`、`js/battle-renderer.js`、`js/ui.js`
- `css/style.css`、`index.html`、`js/worker/sim.worker.js`
- `tools/config_tables.cjs`（`--gen Skills2` 會蓋掉人工註記欄的修正）
- `tests/skill2-earth.test.cjs`（新增）、`tests/skill2-system.test.cjs`、`tests/skill2-ui.test.cjs`、
  `tests/skill2-vfx.test.cjs`、`tests/battle-skill-hover.test.cjs`
- `docs/AI_TASKS.md`、`PATCH.md`

禁止修改：既有技能群組的數值與效果、存檔格式、Worker Protocol、無關 UI／VFX、無關戰鬥公式。

前置依賴：新版技能系統（SKILLS2）與其地板場域／環繞場域基建已存在；
衝突預檢確認 antigravity／codex／develop 三個副本皆為乾淨工作區且與本副本同一 commit。

測試要求：新增技能定向測試、完整 `npm test`、`npm run build`、
`config_tables --apply` dry-run 語意變更 0、`index.html` 與 Worker 快取版號同步。

完成條件：三個群組可由程式測試驗證、資料與說明同步、建立 Claude commit。

驗證結果：新增 `tests/skill2-earth.test.cjs` 26 項全通過；`tests/skill2-vfx.test.cjs` 14 項全通過；
完整 `npm test` 1477 通過 / 5 既有失敗（與乾淨基準線 `develop` 逐項相同，見下）；
`npm run build` 283/283 通過；`config_tables --apply` dry-run 語意變更 0；
瀏覽器實機載入無 Console 錯誤，`SKILLS2` 14 個群組與 5 個新狀態皆正確註冊。

已知風險：
- 完整測試的 5 項失敗全部是**既有**的「參數表 vs. 測試斷言」漂移，與本任務無關，
  且在乾淨副本上逐項可重現：`counter` 施法消耗（表 25／測試期望 0）、
  `bloodrage` 施法消耗（表 25／測試期望 50）、
  `firehunt` 第 1／4／7 階傷害%（表 100/120/150／測試與設計文檔為 120/150/200）。
  這些是設計數值，需使用者裁決哪一邊為準，未擅自更動。
- 泥沼場域的視覺（Canvas 水窪與 DOM 版）尚未在實機畫面上目視確認：驗證當下瀏覽器面板未顯示，
  顯示層不合成畫面，`playCombatVfx` 不會產生節點。程式面已由原始碼定向測試守住兩條路徑的接線。

未完成項目：泥沼／熔岩沼水窪與岩甲護盾光殼的實機目視確認（建議交由 Antigravity 依 SKILL_TEST_SPEC 執行）。

完成後交給：使用者／主整合工作區。

## 任務：實作雷系三大新技能（連鎖閃電／落雷術／雷球）

任務狀態：已完成（2026-08-17）

任務分類：新技能實作／戰鬥機制／狀態系統／戰鬥 VFX

負責 AI：Claude

使用者需求：設計文檔（線上試算表「技能」頁籤〈魔法〉區塊）新增三個魔法技能
「連鎖閃電」「落雷術」「雷球」，共 21 階，全部為魔法傷害／雷屬性。

任務內容：新增三個技能群組與其執行期機制；引擎新增三個群組共用能力
（移動場域、天降打擊佇列泛用化、環繞場域泛用化）；新增環體電球的剩餘時間狀態；
補上連鎖電弧、天雷、球體場域三種特效的 Canvas／DOM 兩套畫法。

使用者決策（實作前確認）：
- 【電殛擴散】（連鎖閃電 T5）升級量以每級 +2.5% 實作（文檔的 +25% 判定為少一位小數）
- 【雷幻身】（連鎖閃電 T6）的 +50% ＝整道鏈恆時生效，另外附帶自身中繼機制
- 【雷殞天落】（雷球 T7）＝追加而非「改為」：飛行雷球照常召喚

允許修改：

- `config/Excel/Skills2.xlsx`、`config/CSV/Skills2.csv`
- `config/Excel/Status.xlsx`、`config/CSV/Status.csv`
- `js/skills2.js`、`js/status.js`、`js/vfx.js`、`js/battle-renderer.js`
- `css/style.css`、`index.html`、`js/worker/sim.worker.js`
- `tests/skill2-lightning.test.cjs`（新增）、`tests/skill2-system.test.cjs`、`tests/skill2-vfx.test.cjs`
- `docs/AI_TASKS.md`、`PATCH.md`

禁止修改：既有技能群組的數值與效果、存檔格式、Worker Protocol、無關 UI／VFX、無關戰鬥公式。

前置依賴：新版技能系統（SKILLS2）與其地板場域／環繞場域／天降佇列基建已存在；
衝突預檢一開始為退出碼 2（codex 未提交、antigravity 未合併），使用者確認 codex 已合併後重跑為 0。

測試要求：新增技能定向測試、完整 `npm test`、`npm run build`、
`config_tables --apply` dry-run 語意變更 0、`index.html` 與 Worker 快取版號同步。

完成條件：三個群組可由程式測試驗證、資料與說明同步、建立 Claude commit。

驗證結果：新增 `tests/skill2-lightning.test.cjs` 29 項全通過；`tests/skill2-vfx.test.cjs` 15 項全通過；
完整 `npm test` 1519 項 / 1513 通過 / 6 項失敗，與同一 commit 的乾淨基準線（1489 項 / 1483 通過 / 6 項失敗）
**逐項相同**；`npm run build` 287/287 通過；`config_tables --sync` + `--apply` dry-run 語意變更 0。

已知風險：
- 完整測試的 6 項失敗全部是**既有**的參數表漂移（火狩三項、`counter` 施法消耗、`bloodrage`、
  `ui.js` 快取版號），與本任務無關，已於乾淨副本逐項重現。
- 三種新特效（連鎖電弧、天雷、球體場域）尚未實機目視確認：程式面已由原始碼定向測試守住
  Canvas 與 DOM 兩條路徑的接線，但畫面表現需實機檢查。
- 【電殛擴散】的每級 +2.5% 與設計文檔字面值不同（使用者決策），改回請調
  `config/Excel/Skills2.xlsx` 的 `chainlightning` 第 5 階 `pctPer`。

未完成項目：三種雷系特效的實機目視確認（建議交由 Antigravity 依 SKILL_TEST_SPEC 執行）。

完成後交給：使用者／主整合工作區。

---

## 任務：新版技能各階數值改為「Lv.1 已含 1 級升級效果」

任務狀態：已完成（2026-08-17）

任務分類：全域數值算法修正／新版主動技能系統

負責 AI：Claude

使用者需求：設計文檔的技能表把「效果」與「升級效果」分成兩欄，原本實作把「效果」欄
當成 Lv.1 的值、升級效果從 Lv.2 才開始給，導致練滿 10 級只拿到 9 級的升級量。
使用者指出正確設計是**技能 1 級時就已包含 1 級升級效果**，練滿 10 級剛好等於文檔的滿級值。

任務內容：把 `sgVal()`（新版技能系統唯一的取值收斂點）的算式由
`底值 + 增量 ×（等級−1）` 改為 `底值 + 增量 × 等級`；同步更新「`<鍵>` 是 Lv.1 基準值」
這個說法出現的所有註釋與文件；更新所有把舊算式釘死的技能測試期望值。

允許修改：

- `js/skills2.js`、`index.html`（快取版號）
- `tools/config_tables.cjs`（Skills2 欄位定義說明頁）、`tools/參數表使用說明.md`
- `game_formula.md`、`docs/SKILL_TEST_SPEC.md`、`docs/AI_TASKS.md`
- `tests/skill2-*.test.cjs`

禁止修改：`config/Excel/Skills2.xlsx`／`config/CSV/Skills2.csv` 的任何數值
（表值本來就是依「底值 + 增量×10 ＝ 滿級值」設計的，本次只修正引擎的讀法）、
舊技能系統（`js/skills.js`）、存檔格式、Worker Protocol。

前置依賴：無（`sgVal` 是唯一收斂點，引擎與說明文字共用同一支）。

測試要求：完整 `npm test`、`npm run build`；技能測試的期望值需逐項改成新算式下的值，
不得改用公式重算（AI_RULES §9.1 例外條款：測試的職責就是把數值釘住）。

完成條件：面板說明與實際傷害在 Lv.1／Lv.10 都對得上設計文檔。

驗證結果：`npm run build` 287/287 通過；完整 `npm test` 1520 項 / 1517 通過 / 3 項失敗，
3 項均為既有失敗（`counter` 施法消耗、`bloodrage` 施法消耗、`ui.js` 快取版號），
已於同一 commit 的乾淨副本逐項重現。抽驗顯示：連鎖閃電第 1 階 Lv.1＝165%、Lv.10＝300%。

已知風險：
- **所有新版技能在 Lv.1 就變強一級**（例如 165% 取代 150%），是刻意的平衡調整，
  既有存檔不需 Migration，但整體 DPS 會上升；需要重跑數值模擬確認曲線。
- 「追加次數／目標數」類參數（`add`）在 Lv.1 起帶小數（例如 1.1），小數部分以機率觸發，
  因此這類技能的段數從 Lv.1 起就有隨機性——先前 Lv.1 是整數、行為是確定的。
- 3 項既有失敗中的兩項是參數表漂移（`counter` 應為主動型被動、施法消耗須為 0；
  `bloodrage` 施法消耗表值 25 與測試期望 50 不符），修正處在
  `config/Excel/Skills2.xlsx`，不在程式碼。

未完成項目：實機目視確認技能面板的「目前級／下一級」文字，以及重跑數值模擬。

完成後交給：使用者／主整合工作區。

---

## 任務：泥沼場域由正方形顯示為橫向長方形（2026-08-17）

任務狀態：已完成（2026-08-17）

任務分類：技能效果／戰鬥 VFX／泥沼場域幾何

負責 AI：Codex

使用者需求：泥沼仍維持方形範圍，只將畫面上的場域壓成橫向長方形，不改成圓形或橢圓。

任務內容：DOM 與 Pixi Canvas 的泥沼本體保留場域中心、寬度與實際 `area.w／area.h`，僅將顯示高度壓為 52%；保留場域成長、平滑移動、泡泡、熔岩色與毒沼深紫色氣流。不得修改傷害／減益判定、傷害間隔或場域資料。

允許修改：

- `js/vfx.js`
- `js/battle-renderer.js`
- `tests/skill2-vfx.test.cjs`
- `docs/AI_TASKS.md`

禁止修改：模擬層範圍判定、技能數值、傷害／減益公式、存檔格式、Worker Protocol、`css/style.css`（目前有 Antigravity 未合併修改來源）與無關 UI。

前置依賴：既有泥沼矩形場域與每 tick 更新的 DOM／Canvas 長駐 VFX 已完成；目標檔案衝突預檢顯示 `css/style.css` 有 Antigravity 未合併 commit `4ffe382`，本任務避開該檔案。

測試要求：執行泥沼 VFX 定向測試、完整 `npm.cmd test`、`npm.cmd run build`、JavaScript 語法檢查與 `git diff --check`。

完成條件：泥沼在 DOM／Canvas 顯示為橫向直角長方形；實際範圍與傷害／減益行為不變；建立 Codex commit。

驗證結果：泥沼／技能 VFX 定向測試 16/16 通過；完整 `npm.cmd test` 為 1526 項、1521 通過、5 項既有失敗；`npm.cmd run build` 為 289/289 通過；`node --check js/vfx.js`、`node --check js/battle-renderer.js` 與 `git diff --check` 通過。

已知風險：完整測試的 5 項失敗為既有基準線問題（`ui.js` 快取版號、嗜血狂怒消耗、泥沼尺寸／技能欄位與 SKILLS2 欄位），與本任務的顯示層比例修改無關。`css/style.css` 仍有 Antigravity 未合併 commit `4ffe382` 的修改來源，本任務未觸碰該檔案；`index.html` 快取版號仍待主整合時依既有協作流程處理。

未完成項目：無程式項目；尚未進行瀏覽器實機目視驗證。

完成後交給：使用者／主整合工作區。

---

## 任務：落雷與雷殞目標死亡後停止殘留特效（2026-08-17）

任務狀態：已完成（2026-08-17）

任務分類：技能效果／戰鬥 VFX／生命週期清理

負責 AI：Codex

使用者需求：落雷常在敵人死亡後仍繼續播放，角色自身死亡後也會留下雷電特效；需要停止這些失效的落雷視覺，但保留原本傷害間隔與傷害結算。

任務內容：在 Canvas 與 DOM 兩條落雷／雷殞顯示路徑加入目標存活守門。目標進入 `dying`／`gone`、敵人卡片進入 `is-dead`，或玩家進入復活倒數時，取消尚未開始及正在播放的雷柱、落點提示、爆點、衝擊波與粒子；一般普攻仍保留垂死目標的致死一擊視覺。不得改動傷害公式、傷害間隔、存檔格式或 Worker Protocol。

修改檔案：

- `js/battle-renderer.js`
- `js/vfx.js`
- `tests/lightning-vfx-lifecycle.test.cjs`
- `docs/AI_TASKS.md`

驗證結果：新增落雷生命週期回歸測試 2/2 通過；受影響的技能／Worker／投射物測試 30/30 通過；完整 `npm.cmd test` 為 1523 項、1518 通過、5 項既有失敗；`node --check js/battle-renderer.js`、`node --check js/vfx.js`、`npm.cmd run build`（288/288）與 `git diff --check` 通過。

已知風險：完整測試的 5 項失敗為既有基準線問題（UI 快取版號、counter／bloodrage 消耗斷言、泥沼 100／120 尺寸斷言），與本次落雷生命週期修改無關。DOM 路徑使用既有敵卡 `is-dead` 與玩家復活狀態列作為顯示層死亡訊號；本機瀏覽器目視驗證仍可能受既有 browser runtime 初始化問題影響。

未完成項目：無程式項目。

完成後交給：使用者／主整合工作區。

---

## 任務：泥沼術改為方形咖啡色場域並新增毒沼紫色氣流泡泡（2026-08-17）

任務狀態：已完成（2026-08-17）

任務分類：技能效果／戰鬥 VFX／場域視覺

負責 AI：Codex

使用者需求：泥沼術的範圍由目前的圓／橢圓視覺改為方形；一般泥沼使用咖啡色，並在場域上顯示冒泡粒子。
點出第 3 階「毒沼術」後，泥沼維持咖啡色底，額外顯示深紫色氣流與深紫色泡泡。

追加需求：殞石術與雷殞天落的落點提示保留半透明填色與最外側邊框，但移除所有內嵌同心圈，只顯示一圈。

任務內容：沿用既有矩形 `area.w/h` 與場域生命週期，在 DOM 與 Pixi Canvas 兩條顯示路徑將泥沼本體改為方形；
新增毒沼 VFX variant，讓紫色氣流／泡泡只在毒沼效果啟用時出現；不改範圍判定、傷害計算、技能數值、存檔格式或 Worker Protocol。

允許修改：

- `js/skills2.js`
- `js/vfx.js`
- `js/battle-renderer.js`
- `css/style.css`
- `index.html`
- `tests/skill2-vfx.test.cjs`
- `docs/AI_TASKS.md`

禁止修改：技能數值與傷害公式、存檔格式、Worker Protocol、無關技能效果與 UI。

前置依賴：既有泥沼場域已傳出 `area.w/h` 並在 DOM／Pixi 兩套顯示層接線；目標檔案衝突預檢無來源。

測試要求：執行泥沼／地系 VFX 定向測試、完整 `npm.cmd test`、`npm.cmd run build`、JavaScript 語法檢查與 `git diff --check`，並同步主頁快取版本。

完成條件：泥沼 DOM／Pixi 皆為方形咖啡色場域並持續冒泡；毒沼啟用時疊加深紫色氣流與深紫色泡泡；建立 Codex commit。

驗證結果：`tests/skill2-vfx.test.cjs` 16/16 通過；地系／雷系／VFX 定向合併測試 70/72 通過，
其中 2 項為既有泥沼尺寸斷言（測試期望 100、現行資料為 120），未涉及本次顯示層修改；
完整 `npm.cmd test` 為 1521 項、1516 通過、5 項既有失敗；`npm.cmd run build` 287/287 通過；
`node --check js/skills2.js`、`node --check js/vfx.js`、`node --check js/battle-renderer.js` 與 `git diff --check` 通過；
主頁 CSS、DOM VFX、Pixi Renderer 與 Skills2 快取版號已同步。

已知風險：完整測試的 5 項失敗為既有基準線問題（`ui.js` 快取版號、嗜血狂怒消耗、泥沼 100／120 尺寸斷言、
`counter` 消耗／資料斷言），與本任務的 VFX 變更無關；本機 Browser runtime 初始化仍受
`Cannot redefine property: process` 阻擋，未能完成實機畫面目視驗證。

未完成項目：無程式項目；建議後續由 Antigravity 在實機戰場確認方形咖啡泥沼、毒沼紫色氣流／泡泡，
以及殞石／雷殞只剩一圈的視覺尺寸與時序。

完成後交給：使用者／主整合工作區。

---

## 任務：殞石術與雷殞天落新增落點目標提示圈（2026-08-17）

任務狀態：已完成（2026-08-17）

任務分類：技能效果／戰鬥 VFX／落點提示

負責 AI：Codex

使用者需求：殞石術的每個落下座標顯示紅色半透明目標提示圈；雷殞天落的每個落下座標顯示藍色半透明目標提示圈，視覺上類似附件參考圖。

任務內容：沿用既有 `meteor`／`thunder-fall` 事件與 `area.r` 範圍資料，在 DOM 與 Pixi Canvas 兩條顯示路徑新增落地前提示圈；提示圈於各自的落下延遲期間保持可見，落地時淡出。不得改動傷害計算、技能數值、存檔格式或 Worker Protocol。

允許修改：

- `js/vfx.js`
- `js/battle-renderer.js`
- `css/style.css`
- `index.html`
- `tests/skill2-vfx.test.cjs`
- `tests/skill2-lightning.test.cjs`
- `docs/AI_TASKS.md`

禁止修改：技能數值與傷害公式、`js/skills2.js`、存檔格式、Worker Protocol、無關技能效果與 UI。

前置依賴：既有殞石術／雷殞天落已送出帶 `area.r` 的天降事件；目標檔案衝突預檢無來源。

測試要求：執行殞石／雷殞天落 VFX 定向測試、完整 `npm.cmd test`、`npm.cmd run build`、`git diff --check`，並同步主頁快取版本。

完成條件：殞石術落點顯示紅色半透明圈、雷殞天落落點顯示藍色半透明圈；DOM／Pixi 兩條路徑皆接線；提示圈尺寸沿用 `area.r`；建立 Codex commit。

驗證結果：定向技能／VFX 測試 46/46 通過；完整 `npm.cmd test` 為 1521 項、1518 通過、3 項既有失敗；`npm.cmd run build` 287/287 通過；`node --check js/vfx.js`、`node --check js/battle-renderer.js` 與 `git diff --check` 通過；主頁 CSS／DOM VFX／Pixi Renderer 快取版本已同步。

已知風險：完整測試的 3 項失敗均為既有基準線問題（`ui.js` 快取版號、`counter` 消耗、`bloodrage` 消耗），與本任務修改範圍無關；本機瀏覽器目視驗證受 browser runtime 初始化錯誤 `Cannot redefine property: process` 阻擋，未能完成實機畫面確認。

未完成項目：無程式項目；建議後續由 Antigravity 在實機戰場確認紅／藍提示圈的視覺尺寸與落地時序。

完成後交給：使用者／主整合工作區。

---

## 任務：反傷秒殺時仍播放敵人攻擊與普攻子彈（2026-08-17）

任務狀態：已完成（2026-08-17）

任務分類：戰鬥時序／敵人攻擊 VFX／反傷生命週期

負責 AI：Codex

使用者需求：敵人被反傷秒殺時，敵人仍應先完成攻擊動作；若是遠程攻擊，必須先看到普攻子彈命中玩家，再套用反傷讓敵人死亡。敵人與玩家死亡時都不得留下不合理的攻擊視覺。

任務內容：移除 Canvas 只依 5Hz 戰鬥快照中的 `atkCd` 猜測敵人出手的單一路徑，改由 `doMonsterAttack` 在攻擊結算時送出含來源、類型與命中資訊的敵人攻擊 VFX 事件。魔法敵人的反傷仍延後至既有投射物飛行時間，傷害間隔與傷害數值不變；Canvas／DOM／Worker shim 需同步處理新事件欄位。

允許修改：

- `js/combat.js`
- `js/worker/shim.js`
- `js/battle-renderer.js`
- `js/vfx.js`
- `tests/enemy-projectile-retaliation.test.cjs`
- `tests/worker-shim.test.cjs`
- `tests/enemy-attack-vfx.test.cjs`
- `tests/vfx-element-colors.test.cjs`
- `docs/AI_TASKS.md`

禁止修改：反傷傷害公式、反傷數值與間隔、存檔格式、技能數值、無關技能效果、戰鬥結算結果與高塔勝負規則。

前置依賴：既有魔法投射物反傷延後結算已完成；目標檔案衝突預檢無來源。

測試要求：執行反傷／敵人攻擊 VFX／Worker shim 定向測試、完整 `npm.cmd test`、`npm.cmd run build`、JavaScript 語法檢查與 `git diff --check`。

完成條件：反傷秒殺的近戰敵人仍出現攻擊／命中視覺；魔法敵人先發出子彈並於命中後才視覺上死亡；既有反傷時序測試保持通過；建立 Codex commit。

驗證結果：反傷／敵人攻擊 VFX／Worker shim／元素色彩定向測試 14/14 通過；完整 `npm.cmd test` 為 1526 項、1521 通過、5 項既有失敗；`npm.cmd run build` 289/289 通過；四個 JavaScript 語法檢查與 `git diff --check` 通過。

已知風險：完整測試的 5 項失敗為既有基準線問題（`ui.js` 快取版號、嗜血狂怒消耗、泥沼尺寸／技能欄位），與本任務修改無關。`index.html` 有 Antigravity 未合併 commit `4ffe382` 的修改來源，依協作規範未直接改動該檔案；主整合時請一併把 `vfx.js`、`battle-renderer.js`、`combat.js` 的快取版本升版。

未完成項目：無程式項目；待主整合處理 `index.html` 快取版本與 Antigravity 修改的合併。

完成後交給：使用者／主整合工作區。
## 任務：實作冰系三大新技能（寒冰箭／水流彈／冰霜新星）

任務狀態：已完成（2026-08-17）

任務分類：新技能實作／戰鬥機制／狀態系統／戰鬥 VFX

負責 AI：Claude

使用者需求：設計文檔（線上試算表「技能」頁籤〈魔法〉區塊）新增三個魔法技能
「寒冰箭」「水流彈」「冰霜新星」，共 21 階，全部為魔法傷害／寒冰屬性。

任務內容：新增三個技能群組與其執行期機制；引擎新增四個群組共用能力
（寒霜狀態與通用緩速收斂點、敵人屬性標籤強制改寫與單一屬性受傷增幅、
跟隨我方的地板場域、追擊場域＋接觸判定）；新增寒霜／寒霜凍傷／凍結／寒冰逆轉
四筆狀態；補上暴風雪、水龍捲、追蹤冰箭三種場域與水流彈拋物線的 Canvas／DOM 兩套畫法。

使用者決策（實作前確認）：
- 【寒霜狀態】的持續傷害不隨層數提高：層數只累積移動與攻速下降，疊滿才凍結
  （因此寒霜拆成 sgFrost 層數／緩速 與 sgFrostBite 傷害 兩筆狀態）
- 【凍結】走既有控場管線：BOSS 控場免疫、韌性折減、控場遞減全部適用

實作判斷（文檔未明寫，依既有先例決定）：
- 【水龍捲】【暴風雪】文檔未寫「改為」→ 為追加（比照雷殞天落的既有決策）
- 【貫穿冰箭】的貫穿長度以「打得到主目標」為地板（比照泥沼術持續時間取 max，
  避免升級變成降級）
- 【冰霜衝擊】的 13 米同樣以 max 為地板
- 設計文檔筆誤：【寒流彈】與【寒流爆散】都標 3 階、其後跳到 5 階
  → 判定【寒流爆散】為第 4 階

允許修改：

- `config/Excel/Skills2.xlsx`、`config/CSV/Skills2.csv`
- `config/Excel/Status.xlsx`、`config/CSV/Status.csv`
- `js/skills2.js`、`js/status.js`、`js/combat.js`、`js/formula.js`、`js/battlefield.js`
- `js/vfx.js`、`js/battle-renderer.js`、`css/style.css`
- `index.html`、`js/bridge.js`、`js/worker/sim.worker.js`
- `tests/skill2-ice.test.cjs`（新增）、`tests/skill2-vfx.test.cjs`、`tests/skill2-system.test.cjs`
- `docs/AI_TASKS.md`、`PATCH.md`

禁止修改：既有技能群組的數值與效果、存檔格式、Worker Protocol、無關 UI／VFX、無關戰鬥公式。

前置依賴：新版技能系統（SKILLS2）與其地板場域／環繞場域／天降佇列／移動場域基建已存在；
衝突預檢（`.claude/check-conflicts.ps1`）對 13 支目標檔案退出碼 0，無其他副本或分支的修改。

測試要求：新增技能定向測試、完整 `npm test` 與乾淨基準線逐項比對、`npm run build`、
`config_tables --apply` dry-run 語意變更 0、`apply_params` 三項檢查、
`index.html` 與 Worker 快取版號同步。

完成條件：三個群組可由程式測試驗證、資料與說明同步、建立 Claude commit。

驗證結果：新增 `tests/skill2-ice.test.cjs` 34 項全通過；`tests/skill2-vfx.test.cjs` 18 項全通過
（新增 2 項冰系特效接線）；完整 `npm test` 1562 項 / 1558 通過 / 4 失敗，
與同一 commit 的乾淨基準線（1526 項 / 1522 通過 / 4 失敗）**失敗項目與原因逐字相同**；
`node tools/build_check.cjs` 290/290 通過；`config_tables --apply` 對 Skills2 與 Status
皆語意變更 0；`apply_params` 試跑「將變更 0、錨點問題 0」、對應參數總數 554 與基準線一致、
`--check-anchors` 554 個錨點各命中一次。

已知風險：
- 完整測試的 4 項失敗全部是**既有**的參數表漂移（`counter` 施法消耗、`bloodrage`、
  泥沼術範圍兩項），與本任務無關，已於乾淨副本逐項重現並比對失敗訊息。
- 寒霜疊滿 5 層＝緩速 100%，沿用既有 95% 夾限（與泥沼同一條規則），
  等於 BOSS 也會被壓到 -95% 攻速與移速。這是文檔字面值（每層 -20% × 5 層）的直接結果；
  要調整只需改 `config/Excel/Status.xlsx` 的 `sgFrost` 單層值（引擎不寫死）。
- 三種新特效與水流彈拋物線尚未實機目視確認：程式面已由原始碼定向測試守住
  Canvas 與 DOM 兩條路徑的接線與參數傳遞，但畫面表現需實機檢查。

未完成項目：暴風雪、水龍捲、追蹤冰箭三種場域與水流彈拋物線的實機目視確認
（建議交由 Antigravity 依 SKILL_TEST_SPEC 執行）。

完成後交給：使用者／主整合工作區。

## 任務：實作風系三大新技能（風刃／真空斬／暴風屏障）＋風屬性成為第八元素

任務狀態：已完成（2026-08-18）

任務分類：新技能實作／戰鬥機制／狀態系統／元素系統／戰鬥 VFX

負責 AI：Claude

使用者需求：設計文檔（線上試算表「技能」頁籤〈魔法〉區塊）新增三個魔法技能
「風刃」「真空斬」「暴風屏障」，共 21 階，全部為魔法傷害／風系屬性；
並特別要求依文檔標註的特效作法實作。

任務內容：新增三個技能群組與其執行期機制；引擎新增四個群組共用能力
（飛行物的延遲發射與沿途脈衝、命中率減益收斂點、環繞場域的半徑成長與起始角、
我方減免的風系來源）；新增風切／風切割裂／狂風緩速／暴風屏障／暴風神體／虛空斬
六筆狀態；風屬性 wind 成為 ELEMENTS 的第八系並補齊詞條／寶石／附魔／天賦四條取得管道；
補上七種風系特效在 Canvas 與 DOM 兩條路徑的畫法。

使用者決策（實作中確認）：
- 風做成**完整第八系元素**（而不是只當技能傷害標籤）：否則風系技能吃不到
  裝備／寶石／天賦／【大地祝福】等所有「屬性傷害提升」乘區，會天生比其他系弱一截。
  代價是掉落池多 3 詞條 3 寶石 2 附魔書、天賦元素轉由 9 個節點變 10 個
  （全滿加倍門檻 900 → 1000 級）。

實作判斷（文檔未明寫，依既有先例決定）：
- 【虛空斬】文檔未寫「改為」→ 為追加（比照雷殞天落／水龍捲／暴風雪的既有決策）
- 【暴風之刃】射出的貫穿風刃固定取風刃第 1 階的 Lv.1 表定值，不隨玩家的風刃投資變動
  （文檔只寫「限於風刃第 1 階、沒有後續進化」，未寫等級來源）
- 【狂風碎裂】沿途脈衝的傷害% 與半徑、【追跡風刃】的追擊範圍、【風切擴散】的擴散範圍
  文檔皆未給數值 → 由引擎補上並**寫進參數表**（pct 50／m 6／chaseM 30／m 10），使用者可在 Excel 調
- 【風切狀態】的命中率下降% 放在技能表 fx.hit（狀態表只有一個 val 欄，已用於移速下降%）
- 設計文檔筆誤：【風切】與【迴旋斬】都標 3 階、其後跳到 5 階 → 判定【迴旋斬】為第 4 階
- 暴風屏障與暴風神體的減免依文檔註記「只與風系類型的減免相加總」→ 先在風系內相加、
  再整體乘算（夾 99%），與岩甲／大地守護各自的乘區互不吃空間

允許修改：

- `config/Excel/Skills2.xlsx`、`config/CSV/Skills2.csv`
- `config/Excel/Status.xlsx`、`config/CSV/Status.csv`
- `config/Excel/Gems.xlsx`、`config/Excel/Talents.xlsx`、`config/Excel/Equipment_Affix.xlsx` 與對應 CSV
- `js/skills2.js`、`js/status.js`、`js/combat.js`、`js/data.js`
- `js/vfx.js`、`js/battle-renderer.js`、`css/style.css`
- `index.html`、`js/worker/sim.worker.js`
- `tests/skill2-wind.test.cjs`（新增）與以元素數／群組數寫死期望值的既有測試
- `docs/AI_TASKS.md`、`PATCH.md`

禁止修改：既有技能群組的數值與效果、既有元素的詞條／寶石／天賦數值、存檔格式、
Worker Protocol、無關 UI／VFX、無關戰鬥公式。

驗證結果：新增 `tests/skill2-wind.test.cjs` 28 項全通過；`tests/skill2-vfx.test.cjs` 22 項
全通過（新增 1 項風系特效接線）；完整 `npm test` 1596 項 / 1591 通過 / 5 失敗，
與同一 commit 的乾淨基準線（1567 項 / 1561 通過 / 6 失敗）相比**沒有新增失敗項目**
（基準線的「殞石術落點提示圈」因版本號釘死而長期紅燈，本次改為驗格式後恢復通過）；
`node tools/build_check.cjs` 292/292 通過；`config_tables --apply` 全表語意變更 0；
`apply_params` 試跑「將變更 0、錨點問題 0」、對應參數總數 554 與基準線一致。
實機（自建 preview server）確認：三個群組都會自動施放、風切／風切割裂／狂風緩速
三種狀態都掛得上敵人、風切滿 3 層時每跳傷害為單層的 3 倍；Canvas 逐一抽格確認
半月風刃、迴旋整圈、鋸齒虛空圓盤、暴風屏障風殼都畫得出來。

已知風險：
- 完整測試的 5 項失敗全部是**既有**的參數表漂移（`counter` 施法消耗、`bloodrage`、
  泥沼術範圍兩項、暴風雪場域），與本任務無關，已於乾淨副本逐項重現並比對失敗訊息。
- 目前**沒有風屬性怪物**，因此「對風屬性敵人傷害％」與「疾風抗性％」暫時是空詞條
  （比照 earth 剛加入時的狀態）；要啟用需由使用者在 NPC 表把幾隻怪改為 wind。
- 【暴風真空刃】滿階＋【亂披風】＋【追跡風刃】時，一次施放會產生 12 道主風刃
  與 24 個追擊場域；數量是設計文檔的直接結果，但高怪量時的效能需實機確認。
- 高塔（DOM 路徑）的風系特效以既有畫法承接（風刃走貫穿冰箭的直線飛行、
  屏障與虛空斬退化為通用光環），外形不如 Canvas 精確。

未完成項目：高塔實戰的目視確認、以及大量敵人情境下的效能量測
（建議交由 Antigravity 依 SKILL_TEST_SPEC 執行）。

完成後交給：使用者／主整合工作區。
