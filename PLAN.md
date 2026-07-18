# PLAN.md — 開發計畫

## 當前任務：熔爐專屬佇列——各爐獨立佇列取代共用計數

### 需求（使用者指示）
- 目前 +N 為「共用總佇列中符合該爐品質的件數」——同設定多爐會重複計數（10 爐各顯示 +9999，實際總量僅 1.4 萬）。
- 正確設計：頂部「佇列」＝總佇列（真正剩餘總量），派發到各熔爐後遞減；**每座熔爐有自己的專屬佇列**，帶尾 +N＝該爐專屬佇列真實件數，各爐加總不超過總量。

### 設計
- 資料：熔爐新增 `queue: []`（專屬佇列，上限 `NEW_FORGE_FURNACE_QUEUE_CAP = 9999`/爐）；佇列總量上限改以「總佇列＋各爐專屬合計」計（`NEW_FORGE_QUEUE_CAP = 20000`，intake 超過即丟棄——避免存檔膨脹）。
- 派發（每 2 秒一輪、每輪 30×爐數件）：總佇列逐件 → 符合品質中「帶＋專屬佇列負載最少」的熔爐**專屬佇列**；無符合→保留入包；符合者皆滿→留總佇列（FIFO）。傳送帶自該爐專屬佇列隨時補位。
- 一致性：品質取消勾選/停用熔爐 → 專屬佇列中不符項退回總佇列重新派發（帶上裝備視為已承諾不回退）；移除熔爐/轉生裁減 → 專屬佇列回總佇列、帶上裝備退回背包。
- UI：+N 直讀 `fu.queue.length`（顯示封頂 +9999、tooltip 精確）；刪除共用掃描 `newForgePendingCounts`。
- sanitize：fu.queue 補建/驗證/超量回總佇列；帶超量入專屬佇列前端；總量上限裁減（先總佇列尾端）。

### 微型任務
1. [DONE] tests：派發進專屬佇列/補位/平均分流（負載=帶+佇列）/滿載留總佇列/健檢回退/總量 intake 上限/sanitize/移除熔爐回退。
2. [DONE] data.js/player.js/newforge.js 邏輯層；ui.js +N 直讀＋品質變更健檢。
3. [DONE] build＋全套測試；隔離埠 8125 實測（總佇列遞減、各爐 +N 獨立、加總守恆）。
4. [DONE] game_formula.md §12.1／PATCH.md／本檔同步。

## 當前任務：熔爐合併——新熔爐取代舊生產線（正式版）

### 需求（使用者指示）
1. 關閉舊版熔爐系統；新熔爐頁籤取代原「🏭 熔爐」頁籤（本地服限定解除，全服開放）。
2. 界面調整：移除「導入新獲得的裝備」開關（一律導入、不可更改）；佇列顯示完整數字不簡寫；移除「佇列退回舊輸送帶」按鈕；說明文字重寫。
3. 專屬材料（爐渣/碎鐵塊…15 種）全部清除、界面不再顯示；拆解規則改以舊版熔爐為主（裝備碎片、附魔精華…等既有資源）。
4. 每熔爐零件格上限 6 → **8**。
5. 更新後玩家 F5 載入需彈出「熔爐系統已重新改造，請重新佈置」公告；熔爐頁籤高亮閃爍，切到該頁後消失。

### 設計
- **factory.js**：`pushConveyor` 一律導入熔爐佇列（滿載丟棄，同舊輸送帶規則；newforge 未載入的測試環境保留舊路徑後備）。`doSalvage(it, silent, bonus)` 增加零件加成來源參數——熔爐拆解傳入該爐零件格快照加成（全部 10 種分解零件生效）；手動一鍵分解無零件加成。舊輸送帶處理迴圈保留但永遠空轉（遷移後無新件）。
- **newforge.js**：移除本地服閘門（`newForgeHostAvailable`）、導入開關、退回輸送帶功能與專屬材料拆解；`newForgeSalvage(it, fu)` 改走 `doSalvage`＋`newForgePartBonus(fu, key)`。sanitize：舊輸送帶滯留裝備併入佇列、`forgeMats`/`intake` 欄位刪除、舊分解槽安裝解除、V1/V2 形狀轉換保留（不再退款材料）、公告旗標（`noticeShown`/`tabSeen`）正規化。
- **save.js**：mergeDefaults 前偵測合併前存檔（`newForge.noticeShown` 不存在）→ sanitize 後設 `noticeShown=false`、`tabSeen=false`。
- **index.html/ui.js**：舊 `#tab-factory` 區段刪除（附魔書庫存、強化節點兩面板搬入熔爐分頁）；熔爐頁頂部＝佇列完整數字（`fmtFull`）＋「更強自動換裝」開關（`G.factory.autoEquip`）；`flog` 統一寫入熔爐紀錄；改版公告彈窗 `#forge-rebuild-modal`＋頁籤 `.nf-glow` 閃爍（切頁清除）。
- **data.js**：`NEW_FORGE_PART_SLOTS_MAX=8`；刪 `NEW_FORGE_MATERIALS`/`NEW_FORGE_SALVAGE_YIELD`/`NEW_FORGE_CRAFT_RECIPES`/`NEW_FORGE_SMELT_RECIPES`。gm.js 刪 `nfmat`。

### 微型任務
1. [DONE] tests/new-forge.test.cjs 改版（22 測試：全服導入/滿載丟棄、doSalvage 整合＋爐零件加成、8 格解鎖、遷移＋公告旗標、接線檢查）；factory-parts/synthesis-disabled 測試同步。
2. [DONE] data.js/formula.js/player.js/factory.js/newforge.js/save.js 邏輯層。
3. [DONE] index.html/ui.js/main.js/css 界面＋公告彈窗＋頁籤閃爍；gm.js 移除 nfmat。
4. [DONE] build 109 檔過；全套 314＝295 過/19 失敗（既有基線，無新增）。
5. [DONE] game_formula.md §7.3/§12／GM_command.md／PATCH.md／本檔同步。
6. [DONE] 隔離埠 8125 實測（新局＋合併前舊存檔遷移）。

## 當前任務：新熔爐 V3——單傳送帶品質勾選＋轉生熔爐數＋零件格（依圖1/圖2）

### 需求
1. 界面只保留圖1功能：熔爐卡（大圖＋移除）＋單一傳送帶（⚙品質設定/啟用/帶視覺）＋分解摘要＋零件置入格；其餘（多傳送帶、篩選器選擇、鍛造裝備、熔煉礦石、符文/魔法熔爐、等級條件、分解/保留下拉）全部刪除。
2. 品質設定＝圖2 勾選清單（普通~創世 8 格）：勾選品質的裝備自動進入該熔爐傳送帶拆解；不勾選＝保留。神鑄創世不入帶。
3. 熔爐數量＝轉生連動：0 轉可設 2 座、每 1 轉 +1 座、上限 12（`2+轉生`，cap 12）。
4. 零件格：每爐初始 3 格、金幣逐格解鎖至 6 格；成本＝`50000×轉生²＋10000×(該爐已解鎖格數-1)^(4＋熔爐數量)`（公式進 formula.js、係數進 data.js）。零件效果企劃未定義→本次僅實作格位與解鎖，安裝待後續指示。
5. 熔爐圖片統一 `images/furnace_LV1.png`（已存在）。

### 設計
- 資料：熔爐 `{id, enabled, qualities[9]（bool，idx8 恆 false）, belt[]（純裝備陣列）, timer, partSlots(3~6), parts[]}`；刪 lines/ftype。
- 邏輯：全域路由（每 2 秒一輪、上限 5×熔爐數件）——佇列逐件：上鎖/神鑄創世/品質未勾→保留入包；勾選→第一座啟用且帶未滿的對應熔爐上帶；勾選但帶全滿→留佇列等待。每爐每 2 秒入爐 1 件產材料（沿用拆解產出表）。
- 遷移（sanitizeNewForge）：V1（mode）/V2（lines）→ V3——qualities 取第一條拆解線 actions（salvage=勾）；V2 帶上裝備與佇列合併回佇列、craft/smelt 在途材料退回庫存；熔爐數依轉生上限裁減（帶回佇列）。本地服限定閘門與外服歸還維持。
- data.js：`NEW_FORGE_MAX=12`、`NEW_FORGE_BASE_FURNACES=2`、`NEW_FORGE_FURNACE_PER_REINC=1`、`NEW_FORGE_PART_SLOTS_INITIAL=3`、`NEW_FORGE_PART_SLOTS_MAX=6`、`NEW_FORGE_SLOT_COST_REINC=50000`、`NEW_FORGE_SLOT_COST_BASE=10000`、`NEW_FORGE_SLOT_COST_EXP=4`、`NEW_FORGE_IMAGE`、`NEW_FORGE_ROUTE_PER_TICK=5`；刪 FILTERS/IMAGES/LINES_MAX/LINE_LOAD_PER_TICK 與 rune/magic 爐型；CRAFT/SMELT 配方表保留僅供遷移退款。
- formula.js：`newForgeMaxFurnaces(reinc)`、`newForgePartSlotCost(reinc, unlocked, furnaceCount)`。
- UI：熔爐卡＝左 furnace_LV1 大圖＋右「傳送帶＋⚙品質設定（圖2 勾選面板）＋啟用＋摘要＋帶視覺＋零件格列（6 格：空格/🔒解鎖含金額/🔒）」；頂部添加熔爐單一按鈕顯示 n/上限（含轉生說明）。

### 微型任務
1. [DONE] 重寫 tests（品質路由、轉生熔爐上限、零件格解鎖公式、V2→V3 遷移、外服維持）。
2. [DONE] data.js/formula.js/player.js 資料層。
3. [DONE] newforge.js 路由與零件格＋sanitize 遷移。
4. [DONE] ui.js/index.html/css 界面。
5. [DONE] build＋測試＋隔離埠實測（8125 全新存檔）。
6. [DONE] game_formula.md §12／PATCH.md／本檔同步。

## 當前任務：控場效果隨戰鬥時間遞減

### 需求
- 影響敵人攻擊頻率的控制（暈眩/減速/攻速降低）持續時間隨「該敵人存活時間」遞減：普通敵人每秒 −1%（例：8 秒暈眩在戰鬥 50 秒時施放 → 4 秒；100 秒後完全無效）、菁英每秒 −3%（約 33 秒歸零）、BOSS 維持既有完全免疫。玩家受控不遞減。

### 設計
- **formula.js §3**：`CONTROL_DECAY_PER_SEC_NORMAL=1`、`CONTROL_DECAY_PER_SEC_ELITE=3`；`controlDurationFactor(ent) = max(0, 1 − (GT − ent._spawnAt) × 每秒遞減%/100)`；無 `_spawnAt` 的實體（玩家等）回傳 1。
- **combat.js**：`spawnFieldMonster` 敵人加 `_spawnAt: GT`；`applyEffect`/`applyBuff` 對 `isAttackFrequencyControlKey` 的效果統一乘遞減倍率，歸零回傳 false（所有來源——技能暈眩/減速、冰元素特效、暈眩被動、攻速類減益——自動吃到），成功時回傳實際秒數供顯示。
- **顯示**：resolveHit 冰減速 proc、castSkill 暈眩/減速文字、暈眩被動 log 改依實際結果顯示（失效不再誤報）。
- 高塔 BOSS 免疫規則不變；FIELD 不入存檔、無遷移。

### 微型任務
1. [DONE] tests/control-decay.test.cjs（倍率曲線、8→4 秒範例、100 秒歸零、菁英 3%、applyBuff 攻速類、玩家不遞減、BOSS 免疫、冰減速 proc 依實際結果）。
2. [DONE] formula.js 常數＋公式；combat.js 接線＋顯示；skills.js 顯示（applyEffect/applyBuff 改回傳實際秒數，boss-control-immunity 斷言同步）。
3. [DONE] build＋全套測試＋隔離埠 8124 實測（4/3.2/false/BOSS false/實戰 _spawnAt）；game_formula.md §3.4／PATCH.md／本檔同步。
4. [DONE] 參數表寫入：CSV＋xlsx「3-戰鬥核心/控場遞減」（a=1、b=3）＋ apply_params 錨點（名稱定位補丁、等 Excel 關檔後執行、round-trip 驗證過）。

## 當前任務：5 轉昇華天賦作用範圍補全

### 需求
- 五個昇華天賦要真正作用於「本來的技能效果」全部：增益/減益/持續再生/死亡詛咒/金幣/法力回復補上倍率；融合技納入（＝素材類別倍率平均）。

### 微型任務
1. [DONE] tests/skill-talent-multiplier.test.cjs（增益/減益/hot/死亡詛咒/資源類/融合平均）。
2. [DONE] skills.js：`skillEffectTalentMultiplier(sk)` ＋ castSkill 全效果套用 fxMult＋浮字/日誌顯示同步（applySkillDebuffs/showPlayerBuffFloat/skillBuffDisplayValue 增 mult 參數）。
3. [DONE] build＋全套測試（player-event-float 簽名斷言同步）＋隔離埠 8124 實測（×2.5/×4/融合平均）。
4. [DONE] game_formula.md §10／PATCH.md／本檔同步。

## 當前任務：離線收益改造——固定速率獵殺菁英怪＋逐殺掉落＋上線確認彈窗

### 需求（使用者指示）
1. 計算基準＝「目前地圖最高階段 − 10 再捨去個位數（下限 1）」等級的**當前場景菁英怪**（例：沼澤最高 256 → 240 級沼澤菁英）。
2. 擊殺速率固定：每 20 秒 1 隻菁英怪（不再依 DPS 估算）。
3. 上線時依離線時間算出擊殺數，**每一隻菁英怪的掉落單獨擲骰**（裝備/寶石/附魔書/太古精華/魔塵/零件與野外擊殺同一套掉落表與倍率）。
4. 參數表 10-離線段清理：刪除期望暴擊倍率/估算DPS/單殺耗時/擊殺數/裝備收益；保留有效離線時間（8 小時、1 分鐘內不計）；新增「計算等級（扣減 a=10）」「擊殺速率（每 a=20 秒 1 隻）」兩列，CSV/xlsx 同步。
5. 上線彈出離線收益確認界面：離線時長、擊殺數、經驗、金幣、掉落詳細列表（裝備＝品質×數量，如 傳說裝備×100）。

### 設計
- **formula.js §10**：`OFFLINE_MAX_HOURS=8`（保留）、新增 `OFFLINE_LEVEL_REDUCE=10`、`OFFLINE_KILL_INTERVAL=20`；`offlineStageFor(best)=max(1,⌊(best−10)/10⌋×10)`、`offlineKillCount(elapsed,潛力%)=⌊有效秒數/20×(1+離線預言%/100)⌋`；刪除 OFFLINE_EFFICIENCY/OFFLINE_MAX_KILLS/offlineKillEstimate。菁英掉落倍率抽出 `ELITE_DROP_MULT=1.3`（rollFieldDrops 與離線共用 SSOT）。
- **save.js applyOfflineProgress**：等級=offlineStageFor(G.stage.best)、怪=monsterStatsFor(stage,true)、場景=currentZoneDef()（金幣/經驗/材料 × rewardMult）；逐殺迴圈按野外掉落表單獨擲骰：裝備→pushConveyor（品質計數）、寶石 addGem、附魔書、太古精華、魔塵、零件（trimFactoryParts 收斂）；金幣/經驗＝單殺值×擊殺數；離線預言潛力乘在擊殺數。彙整 summary 後呼叫 `showOfflineSummary`（typeof 防衛）＋保留 blog 紀錄。
- **UI**：index.html 新增 `#offline-modal`（仿現有 modal 樣式）；ui.js `showOfflineSummary(summary)` 渲染＋確認鈕關閉；css 微調。收益於計算時即入帳，彈窗為確認展示。
- **參數表**：CSV 以 Node 腳本改寫（刪 5 列、插 2 列、編號重排）；xlsx 依記憶的純 Node ZIP 補丁流程同步（sheet2 增刪＋sheet1 同列鏡像重生＋驗證閘門）；apply_params.cjs 錨點刪 OFFLINE_EFFICIENCY/OFFLINE_MAX_KILLS、增 OFFLINE_LEVEL_REDUCE/OFFLINE_KILL_INTERVAL。
- 舊存檔無格式變動，無需一次性遷移。

### 微型任務
1. [DONE] tests/offline-rewards.test.cjs（等級捨十位、每 20 秒擊殺、8h 上限、逐殺掉落計數、彈窗接線）。
2. [DONE] formula.js §10 改寫＋ELITE_DROP_MULT 抽出（combat.js 同步引用；「野外菁英掉落倍率」參數列改錨此常數）。
3. [DONE] save.js 逐殺結算＋summary。
4. [DONE] index.html/ui.js/css 彈窗。
5. [DONE] 參數表 CSV＋xlsx（Node ZIP 補丁，round-trip 100% 一致）＋apply_params 錨點（696 錨點 0 問題）。
6. [DONE] build＋全套測試＋隔離埠 8124 實測（沙盒離線 2 小時：Lv.240 沼澤菁英 ×360、彈窗明細正確）；game_formula.md §11／PATCH.md／本檔同步。

## 當前任務：2 轉元素天賦附傷改為「按當次傷害百分比」

### 需求（使用者確認的正確行為）
- 2 轉前六個天賦（烈焰/寒霜/雷霆/毒脈/聖輝/暗影共鳴）＝攻擊時附加「當次傷害 × 天賦%」的對應元素傷害（例：1% 火附傷、當次原始傷害 10000 → 額外 100 火傷）；六個都點＝一次攻擊附加六種屬性傷害。
- 舊實作是「面板物攻 × 天賦%」換算成固定元素攻擊力，不吃當次傷害（防禦/暴擊/浮動/buff 都不影響）→ 廢除。
- 潛力「元素核心」（potentialElemAtk）同步修正為說明寫的「使所有元素附加傷害額外提高 %」（乘算），不再對六系憑空附加固定值。

### 設計
- **computeStats（formula.js §2）**：`st.elemAtk` 只含裝備附魔固定值（× 元素核心倍率）；新增 `st.elemDmgPct[六系] = 天賦%（含全滿×2）× (1 + potentialElemAtk/100)`。
- **resolveHit（formula.js §3）**：aCfg 新增 `elemDmgPct`；元素附加段每系元素值 = `固定附傷 + 附傷基底 × 附傷%/100`，附傷基底＝元素附加前的當次傷害（防禦/抗性/±10% 浮動/暴擊之後）；其後沿用既有流程（對應元素抗性減免＋元素特效）。
- **接線**：`playerAtkCfg`（combat.js 普攻）與 `castSkill` 直接傷害段（skills.js）皆傳 `elemDmgPct: st.elemDmgPct`；怪物/高塔 BOSS 維持固定值 elemAtk 不變。真實傷害技能走直接扣血路徑，不吃附傷（既有行為）。

### 微型任務
1. [DONE] 新增 `tests/talent-elem-attach.test.cjs`（附傷按當次傷害、吃防禦/暴擊縮放、元素抗性減免、六系並存＋暗影汲取、與固定值附傷疊加、computeStats 派生、元素核心乘算、普攻/技能接線）。
2. [DONE] formula.js：computeStats 派生 `elemDmgPct` ＋ resolveHit 元素附加段改版。
3. [DONE] combat.js / skills.js 接線。
4. [DONE] build＋全套測試＋隔離埠 8124 實測。
5. [DONE] game_formula.md（§2 表、§3.2 步驟 5、§10）／PATCH.md／本檔同步。

### 追加（使用者企劃表數值）
6. [DONE] 六節點每級數值 1%/2% → 0.25%/0.5%（data.js），滿級 37.5%、全滿 ×2 → 75%；ui.js 天賦數值顯示保留至多 2 位小數（fmt 會把 0.25 捨成 0）；測試與 game_formula.md §10 同步。

### 追加（傷害偏折語意修正）
7. [DONE] 傷害偏折/絕對偏折（globalDmgRed 天賦）由「加定值」改為文字語意的「乘算提高%」：st.globalDmgRed = 來源加總 × (1 + 天賦%合計/100)；214k + 全滿 ×2（+300%）→ 856k。測試／game_formula.md／PATCH.md 同步。

### 追加（平衡與防禦天賦乘區）
8. [DONE] 傷害偏折/絕對偏折每級數值減半（0.5%/1%，滿級 75%、全滿 ×2 → 150%）。
9. [DONE] 物防鍛體/魔防鍛體（含 4 轉重甲/魔鎧共鳴）改獨立乘區：與裝備物防%連乘、物魔分開；修復魔防天賦（mdefPct）從未被 computeStats 讀取的無作用 bug；talentEffectLabel 顯示保留小數。

## 當前任務：新熔爐改為本地服限定（外服沿用舊熔爐）

### 需求
- 新熔爐只在**本地服**開放；**外服**維持舊版熔爐，裝備引導切回舊輸送帶，外部能正常運行。

### 設計
- **主機判定** `newForgeHostAvailable()`（newforge.js）：與 GM 同一安全邊界——只認 hostname `localhost / 127.0.0.1 / ::1`，不依賴可被覆寫的前端旗標。
- **三道閘**：
  1. `newForgeTryIntake` 非本地一律回 false → `pushConveyor` 走舊路徑（裝備引導切回舊版）。
  2. `newForgeTick` 非本地直接 return（傳送帶全停）。
  3. 頁籤按鈕 `index.html` 預設 `display:none`，`initUI` 於本地服顯示（仿神鑄頁籤顯隱模式）。
- **滯留資產歸還**（sanitizeNewForge 末端，非本地才執行）：佇列與各傳送帶在途**裝備**→ 舊輸送帶（`data.factory.conveyor`）、在途**材料批次**→ 退回 `forgeMats`；熔爐配置/材料庫存/統計保留在存檔，回本地服自動恢復。
- 存檔結構不變；純資料層轉移，不動舊熔爐程式。

### 微型任務
1. [DONE] 測試：外服 intake 拒收/ tick 停用/滯留歸還；本地服行為不變；頁籤顯隱接線。
2. [DONE] newforge.js 閘門＋歸還；index.html/ui.js 頁籤顯隱。
3. [DONE] build＋全套測試＋隔離埠實測（本地）＋模擬外服驗證。
4. [DONE] game_formula.md／PATCH.md／本檔同步。

## 當前任務：新熔爐 V2——熔爐大圖＋每爐最多三條傳送帶（企劃書：熔爐改造V2.xlsx）

### 需求（相對 V1 的變更）
1. 每個熔爐卡片**左方顯示熔爐大圖**：鍛造=images/Forging_Furnace.png、符文=Runes_Furnace.png、魔法=Magic_Furnace.png。
2. **每爐最多 3 條傳送帶（生產線）**：每條傳送帶各自設定篩選器後，自動篩選相應原材料放入輸送帶（例：熔煉金錠→爐渣×2＋碎金塊×2 足夠時自動送帶）；輸送帶與原版一致，物品由右至左流入熔爐後消失。
3. 各熔爐可選篩選器：鍛造＝拆解裝備/鍛造裝備/熔煉礦石；符文＝製作附魔卷軸/製作寶石；魔法＝製作裝備碎片/附魔精華/魔塵/太古精華（符文/魔法企劃書仍未給配方→顯示選項但標示尚未開放）。

### 設計
- **資料**：熔爐 `{id, ftype, lines[≤3]}`；傳送帶 `{filter, enabled, salvage:{actions,conds}, craft:{recipe}, smelt:{product}, belt[], timer}`。`data.js` 新增 `NEW_FORGE_LINES_MAX=3`、`NEW_FORGE_BELT_CAP=10`、`NEW_FORGE_LINE_LOAD_PER_TICK=5`、`NEW_FORGE_FILTERS`（各爐型篩選器清單，wip 標記）、`NEW_FORGE_IMAGES`；移除 `NEW_FORGE_MODES`。
- **傳送帶運作**（每條線每 2 秒 tick：先入爐 1 批、再裝載）：
  - 拆解線：自佇列掃描（每 tick ≤5 件）——更強自動換裝→判定：分解→上帶（帶滿則放回佇列頭），保留→直接入包（不佔帶位）。
  - 鍛造線：材料足夠＋佇列有對應品質未上鎖裝備＋背包有空位→扣材料、取件上帶；入爐時產出品質+1 裝備（直接入包）。**素材來源＝導入佇列**（不動背包既有裝備）。
  - 熔煉線：材料足夠→扣料上帶（一批＝一次配方）；入爐時產品 +1。
  - 帶上物品＝已扣資源的「在途批次」：移除線/改篩選器/移除熔爐時**全額退回**（裝備→背包、材料→庫存）。
- **V1→V2 存檔遷移**（sanitizeNewForge 內做形狀偵測）：舊熔爐 `mode/salvage/craft/smelt` → 轉為 1 條對應篩選器的傳送帶（保留品質設定與熔煉產品），刪除舊欄位；帶內容驗證，壞批次剔除。V1 手動鍛造/手動熔煉/craft.sel 機制移除（由傳送帶自動化取代）。
- **UI**：熔爐卡片＝左大圖＋右傳送帶清單；每線＝篩選器下拉（rune/magic 選項 disabled）＋啟用勾選＋設定（拆解品質格自動收合）＋移除；帶視覺＝爐口圖示在左、`.conv-chip` 由右至左排列；「➕ 添加傳送帶 n/3」。
- 存檔 fixSockets/fixName 改用 `newForgeAllQueuedItems(data)`（佇列＋各線帶上裝備）。

### 微型任務（全部完成；審查修正：帶視覺定點更新＋焦點防衛、展開狀態改穩定 line.id）
1. [DONE] 重寫 `tests/new-forge.test.cjs`（傳送帶裝載/入爐/退回、V1→V2 遷移、大圖靜態檢查）。
2. [DONE] `data.js` 常數改版＋`player.js` 預設線工廠。
3. [DONE] `newforge.js` 傳送帶邏輯重寫＋`save.js` 帶內容修正接線。
4. [DONE] `ui.js`/`css` 大圖＋傳送帶界面。
5. [DONE] build＋全套測試＋隔離埠 8124 實測。
6. [DONE] `game_formula.md` §11／`PATCH.md`／本檔同步。

## 當前任務：新熔爐（測試版）——主畫面新增「新熔爐」頁籤

### 需求（企劃書：`熔爐改造.xlsx`，內容已解析）
- 主畫面上方頁籤新增「新熔爐」切頁測試，**不改動舊熔爐（factory 生產線）機制**。
- 新獲得的裝備導入新熔爐進行測試（掉落路由切換，可開關）。
- 熔爐類型共 3 種：鍛造熔爐（裝備＋礦石）／符文熔爐（附魔書＋寶石，尚未開放）／魔法熔爐（強化洗煉材料，尚未開放）；可持續添加熔爐，**最多 10 座**。
- 鍛造熔爐三種模式（篩選器）：
  1. **拆解裝備**：各品質獨立選「分解/保留」（同舊篩選節點形式）＋自訂等級條件（例：[普通][分解][200級以下]）；拆解依品質產出 8 種碎料（爐渣/碎鐵塊/碎銀/碎金塊/秘銀碎片/瑟銀碎片/奧金碎片/魔鋼碎片），小數值＝機率性額外 1 件。
  2. **鍛造裝備**：稀有=秘銀×2+任1精良；獨特=秘銀×5+任1稀有；史詩=秘銀×10+任1獨特；傳說=秘銀×10+瑟銀×5+任1史詩。產物等級與部位同素材裝備。
  3. **熔煉礦石**：鐵錠=爐渣2+碎鐵2；銀錠=爐渣2+碎銀2；金錠=爐渣2+碎金2；秘銀=爐渣3+秘銀碎片2+鐵錠2+銀錠3；瑟銀=爐渣4+瑟銀碎片2+鐵錠2+銀錠3；奧金=爐渣5+奧金碎片2+金錠2+秘銀2；魔鋼=爐渣10+魔鋼碎片2+鐵錠10+瑟銀4+奧金4。

### 設計（無損搬移：並行建置＋路由切換，舊機制零改動）
- **路由**：`pushConveyor()` 頂端加 3 行掛勾 `newForgeTryIntake(item)`——「導入新裝備」開啟時新掉落改入 `G.newForge.queue`（佇列滿載即回退舊輸送帶）；關閉時行為與舊版完全一致。舊輸送帶既有積壓仍由舊生產線處理。
- **資料（SSOT＝data.js）**：`NEW_FORGE_MATERIALS`（15 種材料註冊表）、`NEW_FORGE_SALVAGE_YIELD`（品質 0~7 產出表）、`NEW_FORGE_CRAFT_RECIPES`、`NEW_FORGE_SMELT_RECIPES`、`NEW_FORGE_MAX=10`、`NEW_FORGE_INTERVAL=2s`、`NEW_FORGE_QUEUE_CAP=20000`、`NEW_FORGE_TYPES`。
- **狀態**：`G.player.forgeMats`（15 種材料計數）；`G.newForge = { intake, queue, furnaces[], nextId, stats }`；熔爐＝`{ id, ftype, mode, salvage:{actions[9], conds[9]}, smelt:{product, auto}, timer }`。預設 1 座鍛造熔爐（拆解模式；依企劃示意普通~傳說=分解、神話/創世=保留；神鑄創世一律保留不入表）。
- **邏輯層 `js/newforge.js`**（新檔，載於 forge.js 之後、save.js 之前）：`newForgeTryIntake`／`newForgeTick`（每座 2 秒處理 1 件/次）／拆解（沿用 `tryAutoEquip` 更強自動換裝與鑲嵌寶石取回；等級條件不符＝保留）／`newForgeCraft`（手動）／`newForgeSmeltOnce`（自動＋手動）／熔爐增刪／`sanitizeNewForge`（存檔遷移淨化）／佇列退回舊輸送帶。
- **公式**：`formula.js` 新增 `newForgeRollAmount(v)`＝`rollDropCount(v×100)`（整數必得＋小數機率加 1）。
- **UI**：`index.html` 頁籤鈕（熔爐右側）＋`#tab-newforge` 區塊＋`js/newforge.js` script；`ui.js` `UI.dirty.newforge`＋uiTick 惰性渲染＋`renderNewForge()`＋容器事件委派；`css` 新增 `.nf-*` 樣式。
- **拆解產出僅企劃表 8 種碎料**（不產碎片/金幣/精華——以企劃表為準）；神話/創世可由玩家自選分解（新系統設計），預設保留；上鎖一律保留。
- **存檔**：`mergeDefaults` 自動補新欄位；`migrateSave` 加 1 行 `sanitizeNewForge(data)`（furnaces 夾限/補欄、queue 截斷、forgeMats 淨化）＋佇列裝備納入 fixSockets/fixName 修正。
- **GM**：`nfmat 材料key|all 數量` 測試指令＋`GM_command.md` 同步。

### 微型任務
1. [DONE] `tests/new-forge.test.cjs`（TDD：資料表/擲量/路由/拆解判定與產出/鍛造/熔煉/遷移/接線靜態檢查）。
2. [DONE] `data.js` 常數＋`formula.js` 擲量公式。
3. [DONE] `player.js` 狀態（forgeMats/newForge/newForgeDefaultFurnace）。
4. [DONE] `js/newforge.js` 邏輯層＋`factory.js` 路由掛勾＋`main.js` tick。
5. [DONE] `save.js` sanitize＋佇列 fixSockets。
6. [DONE] `index.html`/`ui.js`/`css` 新頁籤與渲染。
7. [DONE] `gm.js` nfmat＋`GM_command.md`。
8. [DONE] `npm run build`＋`npm test`（新測試全過、既有基線不退步）＋隔離埠 8124 實測。
9. [DONE] `game_formula.md`／`PATCH.md`／本檔同步。

## 當前任務：裝備三套切換系統（切頁檢視＋確定切換）

### 需求
- 裝備欄下方新增 3 個切頁（第一/二/三套），目前身上為第一套。
- 點切頁：切到該套「檢視」其裝備，並可對其執行洗煉/強化/裝上/卸下/鎖定等操作。
- 點「確定切換」按鈕後才正式換穿該套（屬性/戰鬥才改變）。

### 設計（最小侵入＋遷移安全）
- 資料：`G.equipmentSets`＝3 套裝備物件（各 `{slot:item|null}`）、`G.equipActive`＝穿著中索引、`G.equipView`＝面板檢視索引。
- **`G.equipment` 永遠 === `equipmentSets[equipActive]`（同參照）** → `computeStats`／戰鬥／工廠自動換裝／存檔序列化全部維持原樣、零改動。
- 面板層才分離：`renderEquip`／`findItemById`／面板「裝上・卸下」／比較裝備 → 導向 `viewedEquipment()`＝`equipmentSets[equipView]`。檢視索引＝穿著索引時（常態）行為完全等同現況。
- 洗煉/強化/鎖定本就對 `findItemById` 取得的物件參照原地修改 → 只要 findItemById 也搜檢視套即可，無需改各操作本身。
- 「確定切換」：`equipActive = equipView` → `G.equipment = equipmentSets[equipActive]` → `markStatsDirty()`。
- 背包共用（同一個 `G.inventory`）；一件裝備只會在背包或某一套的某欄，不重複。

### 遷移（save.js migrateSave）
- 無 `equipmentSets` 舊存檔：`equipmentSets=[既有 equipment, 空套, 空套]`、`equipActive=0`；每套補齊 SLOT_LIST 欄位；`equipment=equipmentSets[0]`。
- 有則夾限 equipActive/View、補齊欄位、重導 `equipment`。存檔序列化會冗餘寫出 `equipment`，載入時一律以 `equipmentSets[equipActive]` 重導，避免參照複製後脫鉤。

### 檔案
- `player.js`：newGameState 資料、helpers（viewedEquipment/switchToEquipSet/setEquipView/equipSetName）、`equipItem`/`equipTargetSlot` 加可選目標套參數（預設 G.equipment）。
- `save.js`：migrateSave 遷移＋載入重導。
- `ui.js`：renderEquip 用檢視套＋renderEquipSetTabs；findItemById/compare/detailAction(equip/unequip) 導向檢視套；全域 click 委派接 `[data-eqset]`／`#eqset-confirm`。
- `index.html`：`#equip-grid` 下方加 `#equip-set-tabs`。
- `css/style.css`：切頁與確定切換按鈕樣式。

### 微型任務
1. [DONE] player.js 資料模型＋helpers＋equipItem/equipTargetSlot 參數化。
2. [DONE] save.js 遷移＋重導（修正 mergeDefaults 補空 sets 導致舊裝備孤立的 bug）。
3. [DONE] index.html 容器；css 樣式。
4. [DONE] ui.js renderEquip/tabs/findItemById/detailAction/click 委派。
5. [DONE] `npm run build`（93 檔過）＋隔離埠 8124 實測（資料模型/切頁/裝入/確定切換）＋真實存檔 migrateSave 驗證（13 件全保留、computeStats 一致、不當機）。
6. [DONE] PATCH.md／（本檔）同步。


## 本次任務：野外敵人死亡後延遲清除戰鬥資訊

### 目標
- 敵人 HP 歸零後先保留敵方卡片、狀態列與浮字層 1.5 秒。
- 1.5 秒後才從野外敵人集合移除；整波清空時，移除完成後才推進階段並開始下一波搜尋。
- 戰鬥邏輯仍只鎖定 HP > 0 的敵人，避免繼續攻擊已死亡目標。

### 驗證
1. [DONE] 補 `tests/multi-enemy.test.cjs` 回歸測試。
2. [DONE] `js/combat.js` 加死亡保留倒數與延遲移除。
3. [DONE] `js/ui.js` 改用可見敵人列表渲染與 tooltip 對應。
4. [DONE] 執行相關測試與語法檢查。

## 本次任務：連擊數 tooltip 移除括號補充

### 目標
- 刪除連擊數 tooltip 中括號內的補充規則與例子。
- 不改連擊公式與戰鬥結算，只調整屬性說明文字。

### 驗證
1. [DONE] `tests/combo-hits.test.cjs` 補 tooltip 文案斷言。
2. [DONE] `js/data.js` 連擊數 tooltip 改為無括號版本。

## 本次任務：高塔 BOSS 大量 MISS 浮字修正

### 目標
- 補回 BOSS 浮層收到裸 `MISS/miss` 時轉玩家區黃色 `閃避!` 的保護。
- 我方攻擊被 BOSS 閃避時仍屬敵方效果，但加上 `enemy-dodge` 來源標記並在 `tb-float` 節流，避免連擊/多段技能洗出大量紅色 MISS。
- 不改命中、閃避或任何戰鬥公式。

### 驗證
1. [DONE] `tests/player-event-float.test.cjs` 補 `enemy-dodge` 與 BOSS MISS 節流斷言。
2. [DONE] `node --test tests\player-event-float.test.cjs`
3. [DONE] `node --check js\ui.js js\combat.js js\skills.js tests\player-event-float.test.cjs`

## 本次任務：融合技能列表恢復每排 12 個

### 目標
- 保留一般技能樹每排 4 個技能格。
- 融合技能置頂列表不套用 4 欄排版，恢復每排 12 個技能格。

### 驗證
1. [DONE] `tests/skill-tree-layout.test.cjs` 補融合列表 12 欄回歸測試。
2. [DONE] `node --test tests\skill-tree-layout.test.cjs`
3. [DONE] `node --check tests\skill-tree-layout.test.cjs`
4. [DONE] `git diff --check -- css/style.css tests/skill-tree-layout.test.cjs`

## 本次任務：重做玩家/敵方即時增益 tooltip

### 目標
- 修復玩家區 `data-buff-tip` 失效，恢復玩家 buff 按鈕與狀態列 hover/click 顯示。
- 敵方區使用獨立 `data-enemy-buff-tip`，BOSS 讀 `TOWER.boss`，一般敵人用 `data-enemy-index` 對應當前敵人。
- tooltip 開啟期間每個 UI tick 只刷新目前 anchor 的內容，避免玩家與敵方狀態互相覆蓋。

### 驗證
1. [DONE] `node --check js\ui.js`
2. [DONE] `node --test tests\active-buffs-panel.test.cjs tests\enemy-buffs-tooltip.test.cjs`
3. [DONE] `git diff --check -- js/ui.js css/style.css`

## 當前任務：敵方狀態列顯示即時增減益詳情

### 設計
- 需求：我方狀態列已有即時技能增益 tooltip；敵方區也要能顯示目前狀態與增減益詳情。
- 高塔 BOSS：`#tb-status` 加 `data-enemy-buff-tip`，tooltip 讀 `TOWER.boss`。
- 野外敵人：每張 `.enemy-card` 的 `.enemy-status` 加 `data-enemy-buff-tip` 與 `data-enemy-index`，tooltip 依 index 讀目前存活敵人。
- 詳情內容涵蓋控制（暈眩/減速）、中毒、持續傷害（燃燒/流血/詛咒等）、buff/debuff（攻擊↓/防禦↓等），並顯示數值與剩餘秒數。
- 純顯示，不改任何戰鬥公式或效果。

### 微型任務
1. [DONE] 補 `tests/enemy-buffs-tooltip.test.cjs` 鎖定敵方狀態 tooltip 接線與狀態類型覆蓋。
2. [DONE] `index.html` / `js/ui.js` 接上高塔 BOSS 與野外敵人狀態列 tooltip。
3. [DONE] `refreshBuffTooltip()` 支援敵方 tooltip 開啟時即時刷新。
4. [DONE] `css/style.css` 補敵方狀態列可點擊游標。
5. [DONE] `node --test tests\active-buffs-panel.test.cjs tests\enemy-buffs-tooltip.test.cjs` 與語法檢查通過。

## 當前任務：新增屬性「連擊數」（暴擊率破百衍生多段攻擊）

### 需求
- 暴擊率 = 100% 為「完全爆擊」；**超過** 100% 的部分衍生「連擊數」＝額外攻擊次數。
- 公式（參數表 2-屬性派生／連擊數，變動＝新增，使用者已明確指示實作）：
  `連擊數 = a·LN(暴擊率%) + b·暴擊率% + c`，a=0.875、b=0.01387、c=0.0861。
- 僅作用於**普攻**與**技能直接傷害**；**持續傷害（DoT/中毒/詛咒）不作用**。
- 小數為機率追加：例 2.57 → 固定額外 2 次 ＋ 57% 機率第 3 次。

### 設計判斷（公式輸入語意）
- 公式輸入採「**超過 100% 的部分**」＝ `暴擊率% − 100`，理由：
  1. 設計語意「破 100% 才觸發」，曲線須自 100% 平滑起步；
  2. 常數零交叉點：用超出量時落在超出 ≈0.9%（暴擊 100.9%），完美對齊；用原始暴擊率則落在 0.9%（表示 5% 暴擊就有 1.5 次連擊，明顯錯誤）；
  3. 範例反推：連擊數 2.57 → 輸入≈13.8 → 暴擊率 113.8%，合理。
- `暴擊率 ≤ 100%` 時連擊數 = 0；結果再取 `max(0, …)`（超出 0~0.9% 區間公式為負，夾為 0）。

### 做法
- `formula.js`：新增純函式 `comboHitsFor(critRate)`（§3 前）與 `rollComboHits(st)`（擲骰整數＋小數機率）；`computeStats` 內 `st.comboHits = comboHitsFor(st.critRate)`。
- `combat.js` `doPlayerAttack`：主攻擊命中且非補刀擊殺後，依 `rollComboHits` 追加整段普攻（`depth+1` 遞迴，避免再觸連擊/連擊被動爆炸；僅主攻擊 depth 0 觸發）。
- `skills.js` `castSkill`：傷害段外層包 `for rep 0..comboReps`，重複直接傷害段；DoT/減益/吸血仍在段外一次結算（＝持續傷害不受連擊）。
- `data.js`：新增具名常數 `COMBO_HITS_COEF={a,b,c}`；`STAT_ROWS` 進攻屬性加「🔗 連擊數」顯示列。
- `apply_params.cjs`：接 `COMBO_HITS_COEF` a/b/c ←（2-屬性派生／連擊數）。
- 文件同步：`game_formula.md` §2 衍生表加「連擊數」列、修正「暴擊率上限 100%→無上限」（程式與參數表早已 0＝無上限，僅文件殘留舊值）、§3 補連擊數多段結算註記；`PATCH.md` 記錄。

### 微型任務
1. [DONE] TDD：`tests/combo-hits.test.cjs`（comboHitsFor 邊界/範例、rollComboHits 期望值、skills/combat 接線斷言）10/10。
2. [DONE] formula.js comboHitsFor/rollComboHits/st.comboHits。
3. [DONE] combat.js 普攻連擊段。
4. [DONE] skills.js 技能連擊段（僅直接傷害）。
5. [DONE] data.js 常數＋面板列；apply_params 接線＋ round-trip 一致（675 一致、0 錨點問題）。
6. [DONE] game_formula.md／PATCH.md 同步。
7. [DONE] node --check、node --test、apply_params dry-run 驗證。

## 當前任務：技能樹分類卡片維持四個技能一排

### 設計
- 問題：技能資料已由 `renderSkills()` 每 4 個切成一列，但 `.tree-row` 使用 flex 且允許換行，分類卡片寬度不足時會顯示成 3+1。
- 修正：技能分類卡片最小寬度 `280px → 288px`，外層間距略收斂；`.tree-row` 改為固定 `repeat(4, 52px)` grid，讓每列穩定四格。
- 純 CSS 版面調整，不改技能點、技能效果、解鎖階層或裝載邏輯。

### 微型任務
1. [DONE] 補 `tests/skill-tree-layout.test.cjs` 鎖定 JS 每 4 個切列與 CSS 固定 4 欄。
2. [DONE] `css/style.css` 調整技能樹卡片寬度、間距與 `.tree-row` 版面。
3. [DONE] `node --test tests\skill-tree-layout.test.cjs` 與 `node --check js\ui.js tests\skill-tree-layout.test.cjs` 通過。

## 當前任務：屬性面板顯示「目前技能增益」清單

### 設計
- 問題：`computeStats()`（面板來源）不含戰鬥中的技能增益（evasionUp/atkUp… 於 playerAtkCfg/playerDefCfg 才以 buffVal 加上），面板只顯示裸值。使用者選「另列清單」方案。
- 做法（不動基礎數值，另加一區）：
  - `combat.js`：純函式 `activePlayerBuffs(ent)` 依固定順序回傳目前生效的玩家增益 `{key,val,remain}`（只讀 ent.buffs 與 GT）。
  - `ui.js`：`renderAttrPanel` 骨架加 `#active-buffs` 容器（置於 DPS 之後）；每 tick 讀取目前戰鬥實體（tower→TOWER.player／否則 FIELD.player）的增益，產出「⏱️ 目前技能增益」清單（emoji＋buffLabel↑＋數值＋剩餘秒數）；無增益則隱藏。
  - 沿用 .attr-group/summary/.stat-row 樣式。
- 純顯示，不改任何數值/戰鬥邏輯。

### 微型任務
1. [DONE] combat.js activePlayerBuffs（純函式）。
2. [DONE] ui.js 面板容器＋每 tick 產清單＋取戰鬥實體。
3. [DONE] TDD：activePlayerBuffs 過濾/排序/剩餘秒數；ui 接線 source 斷言。
4. [DONE] node --test、PATCH.md。

## 當前任務：BOSS 攻擊玩家閃避浮字區域修正

### 設計
- 規則：我方區域顯示我方施放的效果，以及我方被敵方造成的效果（傷害字、閃避、格擋）。
- `doMonsterAttack()` 內先以 `playerEventFloatTarget(floatSel)` 取得玩家浮字層，避免 BOSS 戰或其他呼叫端傳入錯誤層時把玩家承受結果畫到敵方區域。
- 玩家閃避怪物/BOSS 攻擊時，只顯示玩家事件浮字 `閃避!`（黃色 `defend`），不再額外顯示紅色 `MISS`。
- 玩家普攻或技能被敵方閃避時，維持普通戰鬥規則：敵方區域顯示 `MISS`；這不是玩家閃避，不應混用黃色玩家防禦字。
- 高塔 BOSS 浮層 `tb-float` 若收到 `MISS/miss`，在 `floatText()` 入口一律轉成玩家浮層 `tp-float` 的 `閃避!`／`player-event defend`，防止 BOSS 攻擊 miss 仍落在 BOSS 區。

### 微型任務
1. [DONE] 補 `tests/player-event-float.test.cjs` 鎖定怪物攻擊玩家時不得直接用傳入浮層顯示 MISS/傷害。
2. [DONE] `js/combat.js` 怪物/BOSS 傷害字改用玩家浮層；閃避保留玩家區黃色事件字。
3. [DONE] 補實際執行 `doMonsterAttack(..., 'tp-float')` 的回歸測試，驗證 BOSS 攻擊被玩家閃避輸出到 `tp-float`、class 為 `player-event defend`。
4. [DONE] `js/ui.js` 在 `floatText()` 入口保護 `tb-float + MISS/miss`，轉為玩家區黃色閃避字。
5. [DONE] `node --test tests\player-event-float.test.cjs` 與 `node --check js\ui.js js\combat.js tests\player-event-float.test.cjs` 通過。

## 當前任務：太古精華洗煉消耗依裝備品質（新增，使用者指示實作）

### 設計
- 現況：洗煉勾選太古精華模式時，固定每次消耗 1 顆（`rerollAncientEssenceCost()` 回傳 1）。
- 需求：改為依裝備品質（稀有度 0~8）不同消耗量。使用者已於參數表加列
  `7-洗煉/太古精華洗煉消耗`（變動＝新增），值：普通~傳說=1、神話=2、創世=3、神鑄創世=4。
- 仿照既有 `ESSENCE_SALVAGE_CHANCE_BY_RARITY`（依稀有度陣列）做法：
  - `data.js`：新增 `REROLL_ANCIENT_ESSENCE_COST = [1,1,1,1,1,1,2,3,4]`（索引＝稀有度）。
  - `formula.js §7`：`rerollAncientEssenceCostFor(rarity)` 取表值（含邊界防呆）。
  - `item.js`：`rerollAncientEssenceCost(it)` = 開啟模式 ? `rerollAncientEssenceCostFor(it.rarity)` : 0；
    兩處呼叫（rerollItemAffixes / rerollSingleAffix）改傳 `it`；單詞條洗煉 UI 顯示改為依品質。
  - `ui.js`：太古精華資源提示不再寫死「1 個」。
  - `apply_params`：`arrayContent('data','REROLL_ANCIENT_ESSENCE_COST', 該列9值)` 接入。
  - `game_formula.md §7`：補說明。

### 微型任務
1. [DONE] TDD：rerollAncientEssenceCostFor 各稀有度值、item.js 傳 it、UI 依品質。
2. [DONE] data.js 陣列 + formula.js 函式。
3. [DONE] item.js 消耗/呼叫/UI；ui.js 提示。
4. [DONE] apply_params arrayContent；game_formula.md §7.2。
5. [DONE] node --test（3/3）、apply_params 試跑 670 一致、PATCH.md。

## 當前任務：全局減傷分母接入參數

### 設計
- 問題：tooltip 已讀 `globalDamageReduction(st.globalDmgRed)`，但公式分母 `20000` 硬編在 `js/formula.js`，`tools/apply_params.cjs` 只回寫「全局減傷」列的參數 a（上限），沒有回寫參數 b（分母常數）。
- 修正：新增 `GLOBAL_DMG_RED_DENOMINATOR`，`globalDamageReduction()` 改用此常數；`apply_params` 將 `2-屬性派生/全局減傷` 的參數 b 回寫到該常數。

### 微型任務
1. [DONE] `js/formula.js` 抽出 `GLOBAL_DMG_RED_DENOMINATOR` 並套入公式。
2. [DONE] `tools/apply_params.cjs` 接上參數 b；dry-run 顯示 669 一致、0 錨點問題。
3. [DONE] `tests/global-damage-reduction.test.cjs` 補「分母改變會影響實際減傷」回歸測試。
4. [DONE] 同步 `game_formula.md` 與 `tools/參數表使用說明.md`。
5. [DONE] 相關測試與語法檢查通過；PATCH.md 記錄。

## 當前任務：屬性 tooltip 由實際公式值產生

### 設計
- 將四維主屬性的派生係數集中到 `PRIMARY_STAT_EFFECTS`，`computeStats` 與屬性 tooltip 共用同一來源。
- tooltip 只列出係數不為 0 的效果；若某效果係數改為 0，不再顯示該效果文字。
- 上限文字改為 `cap > 0` 才顯示；`cap <= 0` 仍代表無上限，但 tooltip 不顯示「上限」或「無上限」。
- 格擋率與格擋減傷實戰結算改用 `STAT_CAPS`/helper，避免 tooltip 與實際結算上限分離。
- 側欄屬性列加寬並固定不換行，避免長屬性名稱被拆行。

### 微型任務
1. [DONE] 補 `tests/attribute-tooltip.test.cjs` 覆蓋動態係數、0 值隱藏、cap=0 隱藏上限文字、格擋上限 helper 與 CSS nowrap。
2. [DONE] `js/data.js` 新增共用係數與 tooltip 生成 helper，調整 `capText` 與格擋減傷顯示。
3. [DONE] `js/formula.js` 改用共用係數，格擋結算移除硬編 50/85。
4. [DONE] `tools/apply_params.cjs` 回寫目標改到共用係數，dry-run 667/667 一致、0 錨點問題。
5. [DONE] `game_formula.md` 同步敏捷係數、cap=0 顯示語意與格擋/全局減傷上限來源。
6. [DONE] 相關測試與語法檢查通過；PATCH.md 記錄。

## 當前任務：屬性上限填 0 = 無上限

### 設計
- 規則：所有「有上限的屬性」（程式 `STAT_CAPS`／參數表「2-屬性上限」段），上限值填 0 代表無上限。
- 以 `capValue(v, cap)`（util.js）統一實作：`cap > 0 ? clamp(v,0,cap) : max(0,v)`；取代 formula.js 內所有 `clamp(.,0,STAT_CAPS.X)` 與 `Math.min(.,STAT_CAPS.X)`，以及 resolveHit 的 pRes/mRes、globalDamageReduction 的上限。
- 顯示：statFmt 只在 `cap>0 && val>=cap` 標金；新增 capText（0→「無上限」）供屬性面板說明；capText 不可依賴後載入的 fmt。
- 參數表：現有上限列填 0 即生效，屬純語意變更，不新增列。

### 微型任務
1. [DONE] util.js 加 capValue。
2. [DONE] formula.js 全數改用 capValue（computeStats + resolveHit + globalDamageReduction）。
3. [DONE] data.js statFmt 標金條件 + capText + 所有（上限：…）說明改用 capText。
4. [DONE] game_formula.md §2.4 上限通則（0=無上限）與元素抗性 75% 例外註記。
5. [DONE] tests/stat-cap-unlimited.test.cjs（5 項）；修回 capText 對 fmt 的載入期相依（rarity-colors 通過）。
6. [DONE] 全庫測試確認無新增回歸（159 pass／14 既有 fail）；PATCH.md。

## 當前任務：普通敵人與 BOSS 新增「命中率」屬性

### 一、需求與設計
- 普通敵人命中率 = `100% + 敵人等級 × 1%`（敵人等級 = 階段）。
- BOSS 命中率 = `200% + BOSS 階層 × 10%`（BOSS 階層 = 樓層）。
- 戰鬥核心 `resolveHit`（formula.js §3）已支援 `aCfg.hit`（命中率 = clamp(攻擊者命中 − 防守者閃避, 5, 100)）；
  但 `monsterAtkCfg`（combat.js）寫死 `hit: 100`、`monsterStatsFor`／`bossStatsFor` 無 `hit` 欄位 → 敵人命中恆 100%。
- ⚠️ xlsx 與 CSV 有使用者未指定的在途數值差異（閃避率上限 xlsx=0 / CSV=40），依 AI_RULES「不干預使用者自行調數值」：
  只手動新增自己的兩列、不重生成 CSV、不執行套用參數.bat、不碰其他任何列。

### 二、微型任務拆解
1. [DONE] 先寫 TDD：`tests/enemy-hit.test.cjs`（怪物/ BOSS hit 公式 + combat/tower 帶入命中）。
2. [DONE] `js/formula.js`：`monsterStatsFor` 加 `hit = 100 + stage`；`bossStatsFor` 加 `hit = 200 + floor×10`。
3. [DONE] `js/combat.js`：`spawnFieldMonster` 敵人物件加 `hit: base.hit`；`monsterAtkCfg` 改 `hit: m.hit || 100`。
4. [DONE] `js/tower.js`：`makeBoss` BOSS 物件加 `hit: bs.hit`。
5. [DONE] 同步 `game_formula.md` §4 敵方屬性（普通怪／BOSS 各補命中率一行）。
6. [DONE] 參數表手動加列：CSV 4-野外怪物段（攻擊速度後）與 4-高塔BOSS段（BOSS 等級後）各加「命中率」；
   xlsx 同位置以 openpyxl 插入；變動欄標「調整」、編號用未占用的 445／446。
7. [DONE] 執行 `node --test tests/`、更新 PATCH.md。

## 當前任務：融合技效果改為「動態重算」（不存 fx 快照）

### 一、設計方案（腦力激盪）

**問題**：融合技把聚合後的 `fx`（效果與數值）直接快照存進 `G.player.fusions[]`，
所以事後調整素材技能（SKILLS）的定義，既有融合技不會跟著變動。

**目標**：融合技只存「融了哪些技能 `components`、當時等級 `componentLevels`、變異 `mutation`」，
`fx` 改為由 `skillDef()` 依素材技能的**現行定義** + **凍結的素材等級** + **已存變異**即時重算。
如此日後改 SKILLS 定義（如削弱尋寶直覺 lootUp 的 base/per），融合技自動跟著變。

**關鍵設計**：
- 素材技能在融合時已從 `G.player.skills` 移除，其「當時等級」必須凍結（沿用 `componentLevels`）；
  故「定義變動會傳導、等級不會」——正是使用者要的語意（效果隨定義變）。
- 抽出 `fuseSkills` 內的 fx 聚合邏輯為純函式 `fusionAggregateFx(comps)`；`fuseSkills` 與重建共用。
- 變異在融合時只擲一次、存 `{key,name,desc}`；重建時以 `applyFusionMutationByKey` 依 key 重套（`req(fx)` 通過才套，避免崩潰）。
- `skillDef(id)` 對融合技回傳重建後的 def（含即時 fx），並以模組層 `_fusionRtCache`（不入存檔）依記錄物件同一性快取。
- `fuseSkills` 只存最小記錄（**不含 fx**）；結構欄位（name/cost/cd/maxLv/emoji/flavor）沿用（非「效果數值」）。
- 相依面乾淨：UI／說明全走 `skillDef(id)`（只直接讀 `.id`）；存檔遷移直接讀 `fs.fx` 者皆一次性旗標保護。

**存檔遷移（idempotent 常態正規化，非旗標一次性）**：讀檔時對「可用現行定義重建」的融合技移除 `fx` 快照；
無法重建（素材技能已不存在）者保留快照作後備。登錄於 ONE_TIME_MIGRATIONS.md 的 `fusionFxDynamicV1`。

### 二、微型任務拆解

1. [DONE] 調查融合資料結構、fuseSkills、skillDef、effectiveFx、相依面（依賴爆炸檢查）。
2. [DONE] skills.js：抽 `fusionAggregateFx`、加 `applyFusionMutationByKey`、`buildFusionRuntimeDef`＋`_fusionRtCache`／`resolveFusionRecord`、改 `skillDef`、改 `fuseSkills` 存最小記錄（不含 fx）。
3. [DONE] save.js：讀檔時對可重建的融合技移除 fx 快照（置於既有融合遷移之後；冪等）。
4. [DONE] ONE_TIME_MIGRATIONS.md 登錄 `fusionFxDynamicV1`；game_formula.md §9.3 同步敘述。
5. [DONE] 驗證：node sandbox 載入真實 skills.js 跑 12 項斷言全過——不存 fx／等級凍結／skillDef 重算／改素材定義動態跟變／快取同實例／遷移剝離＋重建採現行定義／素材缺失退回快照；另驗變異重套（時空漣漪 buff.dur 12→24）與 req 不符安全略過。node --check 兩檔通過。

## 當前任務：簡化為「雙擊 .bat 套用＋遊戲自動重載」

### 設計與驗證

使用者要「雙擊一個 .bat 就套用並讓遊戲自動重整，不用再按遊戲內按鈕」。
- apply_params.cjs 成功寫入後更新根目錄 `params_version.txt`（Date.now 權杖）。
- 新增 `js/param_autoreload.js`（僅本機）：每 2 秒讀權杖，內容一變即 location.reload()。
- `套用參數.bat` 改為直接 `apply_params --write`（CRLF、正斜線、node 檢查、失敗才 pause），成功自動關窗。
- 移除上一版的左上角按鈕（apply_button.js）、套用伺服器（apply_server.cjs）、啟動套用伺服器.bat（不再需要常駐伺服器）。
- 順修 .bat 閃退主因：LF→CRLF；路徑 `\`→`/` 避免掉字。
- `params_version.txt` 加入 .gitignore（避免每次套用的 git churn）。

1. [DONE] apply_params 寫權杖；param_autoreload 輪詢重載；套用參數.bat 直接套用。
2. [DONE] 刪除按鈕/伺服器/舊 bat；index.html 換載入 param_autoreload.js；補 .gitignore。
3. [DONE] 預覽實測：開著遊戲→終端跑 --write→遊戲約 2 秒內自動重載，怪物 stage50 HP 4696→3,260,990（c=1.05→1.2）；主控台 0 錯誤。
4. [DONE] 更新 tools/參數表使用說明.md、GM_command.md §10.5、PATCH.md。

## 已完成任務：一鍵套用參數按鈕（取代 GM reload）+ 修復 Excel 破壞

### 一、設計方案（腦力激盪）

使用者要「遊戲左上角一鍵按鈕，按下就套用 CSV 並重載；僅本機；刪掉 GM reload 指令」。
瀏覽器不能寫檔，故：新增本機小伺服器 tools/apply_server.cjs（綁 127.0.0.1、只接受 localhost 來源、
只代跑 apply_params --write），左上角按鈕（僅 localhost 建立）呼叫它、成功後 location.reload()。
- 另修：Excel 存檔把含冒號的寶石表格轉成時間值破壞資料 → 分隔符 `:`→`=`（Excel 安全）；
  工具與載入器加防呆：偵測被破壞的值一律中止／跳過，絕不寫入 NaN。
- 刪除 GM `reload game_parameters` 指令與 js/param_reload.js（改用按鈕＋伺服器＋重載，永久生效、覆蓋內嵌係數）。

### 二、微型任務拆解

1. [DONE] 修復 CSV：產生器改 `=` 分隔、工具/載入器加數值防呆；重生乾淨 CSV（round-trip 626/0）。
2. [DONE] tools/apply_server.cjs（本機 127.0.0.1:8790、CORS 限 localhost、代跑 --write）＋ 啟動套用伺服器.bat。
3. [DONE] js/apply_button.js（localhost 限定、插入 topbar 左上、呼叫伺服器後自動重載）；index.html 載入。
4. [DONE] 刪除 GM reload 指令、param_reload.js、其 script 與文件段落。
5. [DONE] 預覽實測：伺服器啟動→按鈕→寫入 data.js→自動重載→值生效；伺服器關閉→按鈕顯示提示。還原乾淨。
6. [DONE] 更新 tools/參數表使用說明.md、GM_command.md、PATCH.md。

## 已完成任務：接完剩餘公式參數 + 文件對齊程式

### 一、設計方案（腦力激盪）

- Part B（文件對齊，以程式為準）：修正 4 處文件/註解與程式不一致——敵人數量註解、
  野外零件菁英倍率 ×3→×1.5、太古精華拆解傳說 2%→1%、輸送帶容量 40+負重→固定 20000。
- Part A（接完內嵌係數）：把 formula.js 寫在算式中間的係數也接進 node 回寫工具，
  用「前後文夾住數字」的唯一錨點就地取代（不重構 formula.js、不動數學）。以 round-trip 恆等為正確性閘門。
  涵蓋：玩家屬性派生、屬性上限、戰鬥核心、高塔 BOSS 倍率與挑戰金幣、稀有度擲骰權重、
  強化/洗煉費用、附魔/分解、寶石/神鑄/商店費用、技能升級與裝載欄。參數數由 495 → 626。
- 內嵌係數只由 node 檔案工具覆蓋（GM 即時重載無法重新指派內嵌字面量）；仍未接者明列。

### 二、微型任務拆解

1. [DONE] Part B：formula.js 註解與 game_formula.md §5.2/§7.3/§7.5 對齊程式；全庫掃描無殘留。
2. [DONE] Part A：新增 numCtx 前後文錨點；補 131 個內嵌係數錨點（含 22 個屬性上限）。
3. [DONE] round-trip 恆等：626 全一致、0 變更、0 錨點問題（修正攻速名稱、boss 攻速跨行、寶石神鑄金幣誤指 CSV 列）。
4. [DONE] 實測寫入三型（玩家基底/屬性上限/BOSS 倍率）→ 過語法檢查 → 預覽開機屬性正常 → git 還原；完整測試 132/134（2 為既有 CSS 失敗）。
5. [DONE] 更新 tools/參數表使用說明.md、apply_params 標頭、PATCH.md。

## 已完成任務：GM 指令 reload game_parameters（即時重載參數）

### 一、設計方案（腦力激盪）

GM 指令在瀏覽器執行，無法跑 node 或寫檔，但可 fetch game_parameters.csv 並即時套用到記憶體全域。
- 新增 js/param_reload.js：fetch CSV → 解析 → 套用到可重新指派的全域（資料表以 .name 比對、純量重新指派、
  物件/陣列就地改），回傳 {applied, skipped, error}。
- gm.js 新增 `reload game_parameters`（寬鬆別名 game_parameter）：呼叫 reloadGameParameters()，
  立即回「讀取中…」，async 完成後更新狀態列與日誌。
- 純記憶體覆蓋（重整還原）；永久生效仍走 node tools/apply_params.cjs --write。
- 涵蓋 = 檔案工具的可重新指派子集（不含 formula.js 內嵌算式係數，因無變數可指派）。
- 僅 localhost 生效（沿用 GM host 限制）；需 http 開啟（file:// 無法 fetch）。

### 二、微型任務拆解

1. [DONE] js/param_reload.js：CSV 解析 + 全域套用 + Promise API（含可選 url）。
2. [DONE] gm.js 接 reload 指令；index.html 載入 param_reload.js（gm.js 之前）。
3. [DONE] 預覽實測：以測試 CSV 即時改 3 值（純量/稀有度/詞條池）成功，applied=539、0 錯誤；GM 輸入框走完整流程；鎖檔時走失敗訊息。
4. [DONE] 更新 GM_command.md、PATCH.md；確認真實 CSV 未受測試影響。

## 已完成任務：CSV → 程式碼參數回寫工具（tools/apply_params.cjs）

### 一、設計方案（腦力激盪）

使用者已選「轉換腳本回寫程式碼」：改完 game_parameters.csv → 執行 node 指令 → 把數值寫回 data.js/formula.js。
- 只作用於「數值參數」，不重塑公式形狀。
- 以「錨點取代」為核心：每個參數用唯一錨點正則(單一擷取群組)定位程式中的數字；資料表陣列則整段重建。
- 安全機制：預設 dry-run 只列印變更；--write 才寫入；寫入前備份、寫入後 node --check 驗證語法，失敗自動還原；
  錨點若匹配 0 或 >1 次一律中止(不猜)。
- 正確性閘門：對「未修改的 CSV」跑 dry-run 必須回報 0 變更(round-trip 恆等)，藉此證明每個錨點都讀到正確的值。
- 涵蓋範圍以能安全錨定者為主(data.js 全部具名常數與資料表 + formula.js 具名常數與關鍵內嵌係數)；
  無法安全錨定者明列，仍由人工修改。

### 二、微型任務拆解

1. [DONE] 撰寫 tools/apply_params.cjs：CSV 解析、錨點/重建映射、dry-run/--write、備份與 node --check 還原。
2. [DONE] round-trip 恆等測試：對未改動 CSV dry-run → 495 一致 / 0 變更 / 0 錨點問題（修正欄位冒號、掉落表 min:1 跨表衝突、陣列重建的數值序列比較）。
3. [DONE] 實測三種寫入路徑（純量 RESPAWN_DELAY、物件欄 topaz.base、巢狀陣列 BOSS min31）→ --write → 程式碼正確變更且過 node --check → 預覽開機三值皆生效、主控台 0 錯誤 → git 還原。
4. [DONE] 撰寫 tools/參數表使用說明.md、更新 PATCH.md、回報涵蓋範圍與未涵蓋清單。

## 已完成任務：全遊戲公式與參數表單化（game_parameters.csv）

### 一、設計方案與架構規劃（腦力激盪）

把 formula.js（公式）與 data.js（資料表）的所有數值參數彙整成單一可編輯的 CSV。
欄位：編號｜系統分類｜名稱｜參數化公式（以 a/b/c… 代號標示數值位置）｜中文說明｜參數a…參數l。
- 一般公式：一列一條，參數格填實際數值（例：升級經驗 a=30 b=2 c=40）。
- 無法一條公式描述者（掉落表、寶石商店表、稀有度表、詞條池…）：轉為多列，
  一列代表一個品質/類別，參數格填 `{下限~上限=值}` 或 `階級:機率` 之類的元組，避免逗號破壞 CSV。
- 編碼：UTF-8 with BOM（讓 Excel 正確顯示繁中）；全部說明用繁體中文。
- 值以「程式實際值」為準（formula.js / data.js）；發現與 game_formula.md 不一致者另行回報，不擅改文件。
- 產生方式：以 scratchpad 的 node 產生器腳本輸出 CSV 至專案根目錄（純資料、不讀遊戲狀態）。
- 執行期是否讓遊戲讀 CSV：因遊戲支援 file:// 雙擊開啟，fetch 本地 CSV 會被 CORS 擋，故本階段 CSV 為
  「權威可編輯目錄」，不接入執行期；接入方式列為後續選項供使用者決定。

### 二、微型任務拆解

1. [DONE] 通讀 game_formula.md／formula.js／data.js，蒐集所有公式與常數。
2. [DONE] 撰寫產生器，輸出 game_parameters.csv（444 列、含 BOM、繁中、多列元組）。
3. [DONE] 以 12 個代理的工作流逐區塊對照原始碼驗證：386 列 0 誤植；補上完整性稽核找到的
   戰力權重表(56)、詞條數硬上限、最低傷害下限，並修正戰力評分/元素附傷公式。
4. [DONE] CSV 結構驗證（445 行全為 17 欄、編號連續）、回報 md 與程式不一致處、PATCH.md 記錄。

## 已完成任務：修正高塔太古機率誤用 BOSS 等級

### 一、設計方案與架構規劃（腦力激盪）

高塔 BOSS 的太古詞條與太古精華機率公式，設計以「樓層」為變數（`min(100%, 5% + (樓層-40)×0.5%)`
與 `min(100%, 10% + (樓層-40)×2%)`），但程式把「BOSS 等級」（= 樓層×5+7）餵進公式，
45 層起太古詞條機率即封頂 100%，造成 BOSS 掉落整批全太古詞條裝備。

修正：`ancientBossAffixChanceForBoss` / `ancientEssenceDropChanceForBoss` 參數語意改為樓層，
tower.js 兩處掉落與 ui.js 高塔提示改傳 `floor`／`fl`；公式數值不變。同步修正 game_formula.md：
§4.3 與 §6.3 的高塔公式改以樓層敘述並統一為 5%+0.5% 版本，§6.3 野外公式修正為與程式一致
（基礎 1%、上限 3%）。既有已生成的全太古裝備屬玩家資產，不做存檔遷移。

### 二、微型任務拆解

1. [DONE] 補上「高塔太古機率以樓層計算」的回歸測試並更新舊斷言。
2. [DONE] formula.js 參數語意改為樓層；tower.js／ui.js 呼叫端改傳樓層。
3. [DONE] 同步 game_formula.md §4.3／§6.3。
4. [DONE] 執行測試、預覽驗證機率數值、PATCH.md 記錄。

## Detailed battle log window (2026-07-13)

- [DONE] Added a button beside the combined combat log and an independent tall log window.
- [DONE] Retain up to 500 recent combat/BOSS entries with timestamp and category filters; clearing this view does not affect game state or loot statistics.

## 本次修正：野外掉落來源與菁英敵人數量統計

### 架構決策

- 統計面板的總掉落量仍包含野外、高塔、工廠拆解與技能產出，符合玩家實際資源增量。
- `LOOT_STATS.sources` 額外保存來源分項；野外寶石只由 `field` 來源記錄，工廠拆解不會產生寶石。
- 野外統計另外記錄 `dropRolls`，用來核對擊殺數與實際掉落結算次數，避免把波次數、敵人數與資源來源混為一談。

### 實作與驗證

1. [DONE] 普通與菁英波次均依既有 1～4 隻數量表生成敵人。
2. [DONE] 野外、高塔、工廠與技能掉落事件加入來源標記，總量仍照常累加。
3. [DONE] 統計面板新增來源分項與野外掉落結算數。
4. [DONE] 新增來源隔離、菁英單體生成與統計面板回歸測試。

## 當前任務：戰鬥區域固定我方寬度與敵人卡片等比縮放

### 一、設計方案與架構規劃（腦力激盪）

現況問題：`.battle-scene` 預設 `1fr auto 1fr`（我方寬度隨敵方浮動），4 隻敵人才套
`multi-enemy-layout` 改我方 240px 並加寬場景，造成「多敵時我方變寬、單敵反而較窄」。

改造（以單敵標準版型實測我方欄寬 202px 為唯一基準）：
1. `.battle-scene` 全模式固定 `202px auto minmax(0, 1fr)`：我方寬度永不變動。
2. 敵人 3 隻以上（ui.js 條件 >3 改 >2）套 `multi-enemy-layout`：只吃兩側 16px 內距
  （width +32px、margin-left -16px）讓我方左移、敵方區域加寬，我方寬度不變。
3. 敵人卡片統一模板：以 `--ec-scale` 等比縮放（1 隻 =1、2 隻 =0.75、3/4 隻 =0.7），
   圖示、字級、血條、狀態列全部 calc 縮放（字級以 max() 保 9px 下限），血條
   `min(100%, calc(200px × scale))` 置中防溢出；刪除 count-1 專屬放大與多敵固定 180px 血條特例。
   排列維持：1 隻置中、2 隻直向堆疊、3 隻第一張置中上列、4 隻 2×2。

### 二、微型任務拆解

1. [DONE] 改寫 multi-enemy-layout 版型回歸測試為新設計。
2. [DONE] CSS：固定我方欄寬、multi-enemy-layout 只平移加寬、敵卡等比縮放模板。
3. [DONE] ui.js：multi-enemy-layout 觸發改為敵人 >2。
4. [DONE] 預覽實測 1～4 隻敵人版型、執行測試與自我審查、PATCH.md 記錄。

### 三、追加修正：多敵人出現垂直捲軸

敵方隊伍內容會把戰鬥場景撐高（高於我方面板），導致 #combat-area 溢出出現捲軸。
`.enemy-party` 改為絕對定位填滿面板（場景高度只由我方面板決定），卡片改縱向 flex、
狀態列可收縮吸收空間不足，列高以 grid-auto-rows minmax(0,1fr) 均分。

1. [DONE] 版型測試補上絕對定位與狀態列收縮斷言。
2. [DONE] CSS：隊伍絕對定位、卡片 flex 化、狀態列彈性收縮。
3. [DONE] 預覽實測 1～4 隻：場景高度恆定、溢出量與單敵相同、卡片零重疊。

## 已完成任務：傷害統計面板改造為統計面板

### 一、設計方案與架構規劃（腦力激盪）

將「傷害統計」彈窗改名「統計面板」，內容分三區：
1. 基本統計：統計時間（開啟面板時每秒即時更新）、戰鬥場次（野外每清一波敵人＋每次高塔挑戰算一場）、殺敵數（野外敵人與高塔 BOSS）。
2. 戰鬥傷害統計：沿用現有 `RUN_STATS` 目前戰鬥即時卡片與死亡歷史卡片，不變。
3. 掉落物統計：各品質裝備件數（每品質一行、文字用品質色）、材料與寶石（每類型一行，有專用圖示者加圖示，寶石用 emoji＋階級＋名稱）、總獲得金幣（完整數字不簡寫）。

架構（職責分離）：新增邏輯層 `js/stats.js` 保存 `LOOT_STATS` 並提供 `recordLootXxx` 累計函式與
`statsBasicHtml()`／`statsLootHtml()` 純字串產生器；掉落點（combat／tower／factory／skills）以
`window.recordLootXxx &&` 安全掛勾（不影響既有 vm 測試）；ui.js 只負責 DOM 寫入與開啟期間的每秒定時器。
統計為工作階段內記憶體資料，按「清理」歸零重計，不入存檔；離線收益不計入。

### 二、微型任務拆解

1. [DONE] 新增統計累計、時間格式與統計 HTML 的 TDD 回歸測試。
2. [DONE] 建立 `js/stats.js` 邏輯層並接入 index.html 載入順序。
3. [DONE] 掛勾野外擊殺／掉落、高塔獎勵、分解產出與技能金幣。
4. [DONE] 改造彈窗結構、標題與 ui.js 即時更新、清理歸零。
5. [DONE] 執行測試、語法檢查、自我審查與 PATCH.md 記錄。

## 當前任務：統一神鑄自動控制項的勾選外觀

### 一、設計方案與架構規劃（腦力激盪）

「自動使用魔塵」與「自動鑄造」都維持 checkbox 與原有事件，只統一兩個 label 的視覺標記，
讓玩家看到相同的勾選規則，不改變自動鑄造的狀態或流程。

### 二、微型任務拆解

1. [DONE] 新增兩個控制項使用相同勾選標記的回歸檢查。
2. [DONE] 將自動鑄造的循環圖示替換為與自動使用魔塵相同的勾選標記，並保留手動首次按鑄造。
3. [DONE] 執行測試與自我審查。

## 當前任務：加寬裝備詳情並右移素材面板

### 設計與驗證

調整裝備頁內部欄位比例，將裝備圖欄上限由 428px 調整為 400px，釋放空間給詳情欄；寶石插槽文字使用
單行顯示避免長資訊換行。右側寶石／附魔素材面板向右偏移 14px 並同步縮減自身寬度，利用現有空白而不改變操作邏輯。

### 微型任務拆解

1. [DONE] 新增裝備詳情與素材面板版面回歸檢查。
2. [DONE] 調整詳情欄寬度、寶石單行樣式與素材面板右移。
3. [DONE] 執行測試與自我審查。

## 當前任務：背包擴充費用改用金幣圖示

### 設計與驗證

背包擴充按鈕沿用既有 `fmt(inventoryExpandCost(...))` 數值格式，只移除尾端 `G` 字樣，改在金額後插入
`images/icon_gold.png`；實際擴充費用與扣款邏輯不變。

### 微型任務拆解

1. [DONE] 新增擴充按鈕顯示格式回歸檢查。
2. [DONE] 將動態按鈕與初始 HTML 改為金額後接金幣圖示。
3. [DONE] 執行測試與自我審查。

## 當前任務：切回神鑄時同步目前鑄造素材分頁

### 設計與驗證

神鑄中的 `crafting.mode` 是目前等待鑄造內容的唯一來源；鑄造進行中優先依此模式選擇裝備／寶石分頁，
沒有等待狀態時才沿用玩家上次選擇的 `UI.forgeInvTab`。渲染背包與自動放入選單共用同一個分頁判斷。

### 微型任務拆解

1. [DONE] 新增目前鑄造模式決定分頁的回歸檢查。
2. [DONE] 接入神鑄背包與自動放入選單渲染。
3. [DONE] 執行測試與自我審查。

## 當前任務：修正自動鑄造換輪後進度條停在 100%

### 設計與驗證

自動鑄造會在同一次 `forgeTick` 中完成上一輪並建立下一輪，進度條 DOM 元素不會被重建，導致相同的
CSS animation 名稱沿用上一輪的完成狀態。切換 `startedAt/durationMs` 時只重置一次 animation，再套用新輪次的
負延遲；倒數與實際 `crafting` 狀態仍由既有主迴圈決定。

### 微型任務拆解

1. [DONE] 新增自動換輪時重置 CSS animation 的回歸檢查。
2. [DONE] 在新鑄造輪次強制重新播放進度動畫。
3. [DONE] 執行測試與自我審查。

## 當前任務：神鑄進度條改用 compositor 動畫

### 設計與驗證

上一版雖以 `requestAnimationFrame` 更新，仍會因主執行緒重繪而短暫停頓。改由 CSS compositor 以
`transform: scaleX()` 執行整段動畫，JavaScript 僅在鑄造開始／重新載入時設定負延遲，並以既有 UI 迴圈更新倒數。

### 微型任務拆解

1. [DONE] 新增 compositor 動畫與不重置動畫的回歸檢查。
2. [DONE] 移除逐幀 JavaScript 寬度更新，改用 CSS 動畫。
3. [DONE] 執行測試與自我審查。

## 當前任務：移除神鑄底部原生 checkbox 視覺框

### 一、設計方案與架構規劃（腦力激盪）

保留兩個 checkbox 的實際輸入、事件與狀態保存，只在神鑄底部控制列隱藏瀏覽器原生方框，
避免與現有文字／圖示重複顯示。控制項仍透過 label 可點擊，且不改變其他頁面的 checkbox 外觀。

### 二、微型任務拆解

1. [DONE] 新增神鑄底部控制項的樣式回歸檢查。
2. [DONE] 僅隱藏神鑄底部兩個原生 checkbox 的視覺框，保留操作功能。
3. [DONE] 執行測試與自我審查。

## 當前任務：神鑄加入鑄造時間、進度條與自動鑄造

### 一、設計方案與架構規劃（腦力激盪）

神鑄採可保存的非同步狀態：開始時建立 `G.forge.crafting`，完成時間到達後才結算成功／失敗，
因此刷新或重新載入不會把等待中的鑄造變成瞬間完成。UI 以進度條、剩餘秒數與「鑄造中....」
顯示進度；鑄造期間鎖定素材操作。新增 `autoForge` 勾選後，每輪結算、補足材料成功才自動開始下一輪，
材料不足時自動停止。

### 二、微型任務拆解

1. [DONE] 新增鑄造時間與非同步狀態的回歸檢查。
2. [DONE] 實作神鑄延遲結算、進度 UI 與狀態保存。
3. [DONE] 實作自動鑄造連續流程與材料不足停止。
4. [DONE] 更新公式文件、執行完整測試與自我審查。

## 當前任務：修正寶石清單塌縮為零高度

### 一、設計方案與架構規劃（腦力激盪）

寶石選單顯示後，依選單實際高度、標題高度、固定 footer 高度與內距計算 `.fam-list` 的明確高度；
素材清單保留捲軸，footer 保持固定，避免再出現「按鈕消失」或「寶石內容消失」兩種極端狀況。

### 二、微型任務拆解

1. [DONE] 新增清單實際高度與 footer 共同佈局的回歸檢查。
2. [DONE] 實作顯示後的清單高度計算，並移除零高度塌縮規則。
3. [DONE] 執行完整測試與自我審查。

## 當前任務：修正寶石清單把固定操作列擠出選單

### 一、設計方案與架構規劃（腦力激盪）

寶石模式啟用專用 `fam-gem-mode`，讓素材清單採 `flex-basis: 0` 並以零高度基準分配剩餘空間；
標題與 footer 保持固定，不再由寶石列的內容高度把「確定／取消自動放入／關閉」推到選單外。

### 二、微型任務拆解

1. [DONE] 新增寶石模式 flex 高度與固定 footer 的回歸檢查。
2. [DONE] 實作寶石模式專用清單高度分配。
3. [DONE] 執行完整測試與自我審查。

## 當前任務：改用滑鼠滾輪捲動寶石清單並固定操作列

### 一、設計方案與架構規劃（腦力激盪）

操作方式比照裝備詳情：只在 `.fam-list` 上處理滑鼠滾輪上下捲動，不實作按住中鍵拖曳。
選單底部的「確定／取消自動放入／關閉」保持在素材清單之外，並設定不可縮小，確保始終可見。

### 二、微型任務拆解

1. [DONE] 補上滾輪捲動與固定操作列的回歸檢查。
2. [DONE] 移除中鍵拖曳攔截，恢復純滾輪捲動並強化操作列固定樣式。
3. [DONE] 執行完整測試與自我審查。

## 當前任務：支援滑鼠中鍵捲動神鑄寶石清單

### 一、設計方案與架構規劃（腦力激盪）

攔截寶石清單上的中鍵事件，避免瀏覽器原生中鍵自動捲動接管畫面。支援按住中鍵拖曳清單，
也支援中鍵點擊後移動滑鼠的自動捲動模式；捲動狀態只作用於 `.fam-list`，不影響主畫面。

### 二、微型任務拆解

1. [DONE] 補上中鍵事件與清單專用捲動的回歸檢查。
2. [DONE] 實作中鍵拖曳與點擊後自動捲動。
3. [DONE] 執行完整測試與自我審查。

## 當前任務：修正神鑄寶石選單捲動區域

### 一、設計方案與架構規劃（腦力激盪）

寶石模式的選單使用法陣可用高度，讓素材清單擁有明確的可捲動空間；選單底部操作列仍固定。
清單強制保留垂直捲軸欄位，並使用 overscroll containment 與 wheel 事件隔離，避免滾輪冒泡到主畫面。

### 二、微型任務拆解

1. [DONE] 新增寶石清單高度與滾輪隔離的回歸檢查。
2. [DONE] 實作寶石模式明確高度、捲軸與滾輪隔離。
3. [DONE] 執行完整測試與自我審查。

## 當前任務：神鑄自動放入選單的固定操作列與寶石排序

### 一、設計方案與架構規劃（腦力激盪）

將自動放入選單拆成三個垂直區塊：標題、只負責顯示素材的可捲動清單、固定在底部的操作列。
選單本體不再捲動，確定／取消自動放入／關閉三個按鈕始終可見。寶石資料先依「持有數達到
六顆、可直接合成」排序，再依階級由高到低排列；選單加寬並禁止素材資訊換行。

### 二、微型任務拆解

1. [DONE] 補上自動放入選單結構與排序的靜態回歸檢查。
2. [DONE] 拆分固定標題、可捲動清單與固定操作列，並加入可合成寶石優先排序。
3. [DONE] 加寬選單、調整單行排版並執行測試與自我審查。

## 當前任務：神鑄「自動放入」系統

### 一、設計方案與架構規劃（腦力激盪）

法陣按鈕列（全卸下／鑄造）中間插入「自動放入」按鈕（鑄造因此下移一格）。
點擊開啟選單，依目前背包切頁顯示選項：
- 裝備頁：傳說／神話／創世裝備，文字用品質色（RARITIES[5..7].color）。
- 寶石頁：所有持有的五～九階寶石（十階不可鑄造），每列「emoji 小圖示＋
  N級寶石名（屬性 +數值）×持有數」；持有 <6 者半透明不可選。
選定按「確定」→ 立即自動放入 6 件並回到法陣；之後每次鑄造（成敗皆然）
自動補放同一設定，直到數量不足為止（停止並清除設定、寫入法陣紀錄）。

架構（邏輯/渲染分離）：
- 狀態：`G.forge.autoFill = null | {kind:'equip',rarity} | {kind:'gem',type,level}`
  （隨存檔保存；forgeState() 補預設值）。
- 邏輯層 forge.js：`forgeAutoFillLabel()`、`forgeAutoFillApply()`（裝備取
  「未上鎖、評分最低」6 件保留強者；寶石自庫存扣 6）、`forgeAutoRefill()`
  （doForge 成敗兩路徑收尾呼叫；不足→清設定＋紀錄）。
- 渲染層 ui.js：自動放入按鈕狀態（已設定時亮起＋提示）、選單建構與
  選取/確定/取消事件；index.html 插入按鈕與選單容器；style.css 選單樣式。

### 二、微型任務拆解

1. [DONE] player.js/forge.js：autoFill 狀態、apply/refill 邏輯、doForge 掛勾。
2. [DONE] index.html/css：按鈕列插入自動放入＋選單容器與樣式。
3. [DONE] ui.js：按鈕狀態渲染、選單建構、事件委派（選取/確定/取消/外點關閉）。
4. [DONE] Preview 驗證：裝備/寶石兩模式選單、自動放入、鑄後補放、不足停止。
5. [DONE] PATCH.md 記錄。

## 當前任務：技能法力消耗隨等級成長

### 設計方案

- 一般技能與融合技能共用 skillManaCost。
- 一般技能基礎值取技能定義的 cost；融合技能基礎值取所有素材技能原始 cost 總和。
- 等級倍率採非複利公式：1 + 10% ×（等級 - 1）。
- 戰鬥施放、MP 不足判斷、技能頁、技能懸停提示與融合建立流程全部改用同一公式。

### 微型任務拆解

1. [DONE] 新增一般／融合技能法力消耗回歸測試。
2. [DONE] 實作共用法力消耗公式並接入戰鬥與 UI。
3. [DONE] 更新融合技能基礎消耗與公式文件，並補充 NPC、BOSS、玩家 0～5 轉經驗公式。
4. [DONE] 執行測試、語法檢查與自我審查。

## 當前任務：UI 視覺優化改造工程（全站文字可讀性總改造）

### 一、設計方案與架構規劃（腦力激盪）

參考目標（使用者提供的他遊戲裝備 tips）：大字號、粗體、依詞條類別分色、
特殊效果橘色段落、層級分明。現況問題：全站字型為 Palatino 襯線（中文以微軟
正黑退回混排，觀感模糊）、tooltip 與裝備詳情 12-13px 過小、暗淡色 `--dim`
對比不足、`.hint` 斜體（中文假斜模糊）。

改造分三層：

1. **全站字型與基準**：`:root` 新增 `--font-main`（微軟正黑/PingFang/Noto Sans TC
   無襯線堆疊），body 與所有 Palatino 引用（`.log`、`#sk-tooltip`）改用之；
   body 14→15px；`--dim` 提亮 `#8b7961 → #9c8a70`；`.hint` 取消斜體。
2. **裝備 tips／詳情重造（比照參考圖）**：`#sk-tooltip` 加寬 300→400px、基準
   14.5px；`.it-name` 15→19px；`.it-affix` 13→15px 並依詞條類別分色——
   基礎=紫、進攻=粉紅、防禦/抗性=青、功能=綠（新增 `AFFIX_CATS` 於 data.js，
   item.js 詞條列加 `afx-<cat>` class，SSOT 單一來源）；特殊被動
   `.it-passive`【破甲】等改橘色粗體 15px；附魔 14px；插槽/空欄 13px+。
3. **通用元件字級**：`.sec-title` 16px、`.btn` 14px、`.log` 13→14px、
   `.skt-*` 提級、`.ic-lv` 徽章 9→11px、`.socket` 12→13.5px、
   `.stat-row` 14→14.5px、`.it-pool-box` 13.5px。

不動任何遊戲數值與邏輯；純渲染層（CSS + 詞條分類資料 + 詳情 HTML class）。

### 二、微型任務拆解

1. [DONE] data.js 新增 `AFFIX_CATS` 分類與 `affixCat()`；item.js 詞條列掛 class。
2. [DONE] style.css：字型堆疊、基準字級、`--dim`、tooltip/詳情全套字級與分色。
3. [DONE] style.css：通用元件（標題/按鈕/日誌/徽章/插槽）字級調整。
4. [DONE] Preview 驗證：tooltip 與詳情視覺、各分頁無版面破裂、主控台零錯誤。
5. [DONE] PATCH.md 記錄。

## 當前任務：存檔機制優化（單一自動快取＋本地手動歷史）

### 設計方案

- 瀏覽器端只保留一份最新自動存檔，15 秒覆寫一次；大型內容優先放 IndexedDB，localStorage 僅保留相容副本與 metadata。
- 本地資料夾只保留一份固定檔名 `IC_autosave.json` 作為 10 分鐘自動存檔，手動存檔則每次建立新 `.json` 並保留舊檔。
- 存檔清單固定顯示自動存檔第一列，手動存檔依新到舊最多 10 列；按鈕只保留讀取與刪除。
- 資料夾按鈕只負責選擇／更新資料夾連線，不執行同步或匯入；首次選擇 Documents 時嘗試建立 `Idle_RPG\Save` 子資料夾。

### 微型任務拆解

1. [DONE] 重構瀏覽器自動快取與本地資料夾 API。
2. [DONE] 改造 15 秒／10 分鐘定時保存與手動存檔。
3. [DONE] 改造存檔清單、讀取／刪除按鈕及資料夾選擇行為。
4. [DONE] 靜態語法、差異與回溯風險檢查。

## 當前任務：修復轉生後技能點與技能刪除返還

### 一、設計方案與架構規劃（腦力激盪）

新增玩家技能點總預算 `skillPointBudget`，以「所有技能等級總和」作為已使用點數：初始兩個 1 級技能即使用 2 點，9999 級總預算為 10000 點。可用技能點統一由總預算減去所有技能等級總和；轉生時保留 10000 點總預算，轉生後不再增加，刪除或降級技能則透過投入點數下降自動返還。舊存檔缺少總預算時，0 轉以目前等級 + 1 補建，已轉生角色以 10000 點補建；不再因轉生後目前等級較低而清除技能。

### 二、微型任務拆解

1. [DONE] 盤點技能點、降級、融合刪除與存檔遷移的現行計算。
2. [DONE] 新增技能點總預算並接入升級與轉生流程。
3. [DONE] 修正刪除／降級返還及舊存檔補建，移除破壞性技能清除。
4. [DONE] 完成技能點回溯計算、語法與回歸驗證。

### 三、驗證要點（自我審查清單）

- 初始兩個 1 級技能計入已使用 2 點，9999 級總預算固定為 10000 點。
- 轉生前未使用技能點會保留到轉生後。
- 轉生後升級不增加技能點總預算。
- 刪除或降級任何已投入技能會正確返還點數。
- 舊 0 轉與已轉生存檔都能補建技能點預算。
- 舊遷移流程不再因技能投入量清除玩家技能。

## 當前任務：轉生稱號顏色

### 一、設計方案與架構規劃（腦力激盪）

依轉生次數套用稱號 class，1～4 轉使用固定顏色，5 轉使用 CSS 彩色漸層流動動畫；由同一個 UI helper 同步更新側欄與戰鬥角色名稱。

### 二、微型任務拆解

1. [DONE] 新增轉生稱號 class 套用函式。
2. [DONE] 新增 1～5 轉顏色與彩色動畫樣式。
3. [DONE] 完成結構與語法驗證。

## 當前任務：技能一鍵滿級

### 一、設計方案與架構規劃（腦力激盪）

在技能升級按鈕右側新增一鍵滿級按鈕，沿用現有技能上限、技能點、金幣與技能樹鎖定規則；逐級升級並在資源不足時安全停止，不跨越技能上限。

### 二、微型任務拆解

1. [DONE] 建立一鍵滿級缺少時的預期驗證。
2. [DONE] 新增批量升級邏輯與技能彈窗按鈕。
3. [DONE] 調整技能操作列為四欄，完成核心與語法驗證。

### 三、驗證要點（自我審查清單）

- 一鍵滿級按鈕緊接在升級按鈕右側。
- 只消耗實際需要的技能點與金幣，不超過目前技能上限。
- 金幣或技能點不足時停在可達等級。
- 轉生後沒有技能點時不可使用，已滿級技能不可重複升級。

## 當前任務：轉生系統

### 一、設計方案與架構規劃（腦力激盪）

新增 `reincarnations`、`reincarnationTalentPoints` 兩個玩家狀態欄位，透過統一公式查詢等級上限、轉生上限、階級名稱、經驗倍率與額外屬性倍率。角色最高 9999 級，達到 9999 級後可由側欄按鈕執行轉生；保留裝備、技能、資源、關卡與其他進度，只重置等級與當前經驗。轉生後每次升級不再增加技能點，改累加 1 點轉生天賦點。

四維與生命在原始總值完成後套用最終倍率：1～5 轉為 ×10、×20、×40、×80、×160。四維放大後重新參與攻擊、防禦、法力等派生計算，生命則按原始生命總值放大一次。一般技能每轉生增加 10 級上限，融合技能每轉生增加 20 級上限。

### 二、微型任務拆解

1. [DONE] 更新計畫並建立缺少轉生狀態、公式與操作入口的預期驗證。
2. [DONE] 新增轉生常數、經驗倍率、階級、技能上限與存檔相容欄位。
3. [DONE] 接入升級計數、技能點／天賦點與四維／生命屬性計算。
4. [DONE] 新增轉生操作函式、側欄顯示、二次確認、成功提示與按鈕樣式。
5. [DONE] 更新公式文件並完成語法、回歸與自我審查。

### 三、驗證要點（自我審查清單）

- 未達 9999 級、已達最高 5 轉時不可轉生。
- 人物等級不可超過 9999，滿級後多餘經驗不再推進等級。
- 轉生後等級為 1、經驗為 0，轉生次數只增加 1 次。
- 轉生保留裝備與其他資源；生命、法力與四維依最終 10／20／40／80／160 倍計算。
- 轉生後經驗需求倍率依 2 的轉生次方增加。
- 轉生後升級只增加天賦點，不再增加技能點。
- 一般技能上限每轉生 +10，融合技能上限每轉生 +20。
- 按下轉生後必須二次確認；成功後顯示目前轉生次數，確認即可關閉。
- 既有存檔缺少新欄位時能正常補預設值。

## 當前任務：技能升級彈窗按鈕固定排版

### 一、設計方案與架構規劃（腦力激盪）

將技能彈窗拆成固定標題列、固定高度說明區、技能點列與固定按鈕區。技能描述過長時只在說明區內捲動，避免內容高度變化推動下方按鈕；技能名稱過長則在標題列省略顯示。

### 二、微型任務拆解

1. [DONE] 先確認現有彈窗結構與建立固定排版的失敗驗證。
2. [DONE] 將說明與操作區分離，新增固定列高與溢出捲動樣式。
3. [DONE] 完成靜態結構、語法檢查與自我審查。

### 三、驗證要點（自我審查清單）

- 上方描述文字變長時，按鈕區的列高與位置不變。
- 描述超出預留空間時，只在說明區顯示捲軸，不會覆蓋技能點或按鈕。
- 技能彈窗以外的 `.detail-actions` 不受新樣式影響。

## 當前任務：戰鬥結算日誌即時統計

### 一、設計方案與架構規劃（腦力激盪）

保留死亡時產生的歷史結算卡片，另在結算彈窗開啟時依目前 `RUN_STATS` 產生一張「目前戰鬥（即時統計）」卡片。死亡結算時移除這張即時卡片並將同一份統計轉成歷史紀錄，避免重複顯示或重複計算。

### 二、微型任務拆解

1. [DONE] 先新增目前戰鬥摘要產生與開啟刷新測試。
2. [DONE] 更新結算 HTML 產生器與死亡結算卡片分流。
3. [DONE] 接入結算彈窗開啟事件並執行完整測試。


## 當前任務：全局減傷詞綴

### 一、設計方案與架構規劃（腦力激盪）

新增定值詞綴 `globalDmgRed`，不限制裝備部位，最低史詩稀有度；數值基準與物理／魔法防禦定值詞綴相同。詞綴由 `computeStats` 聚合到玩家防禦設定，`resolveHit` 在既有傷害倍率全部完成後、護盾吸收與扣血前套用 `原始傷害 × 1000 ÷（全局減傷總合 + 30000）`。持續傷害與反震也經由同一個最終減傷倍率處理；未有全局減傷時維持既有傷害流程。

### 二、微型任務拆解

1. [DONE] 新增詞綴資料、屬性聚合、屬性面板與戰力評分。
2. [DONE] 新增全局減傷公式與物理／魔法／元素／真實／持續／反震傷害掛勾。
3. [DONE] 先建立詞綴限制與傷害結算單元測試。
4. [DONE] 執行完整測試、語法檢查與自我審查。

### 三、驗證要點（自我審查清單）

- `全局減傷` 為定值，不顯示百分比，所有部位均可骰出。
- 最低稀有度為史詩，普通／精良／稀有／獨特裝備不可生成此詞綴。
- 全局減傷在最終傷害階段套用，不取代物防、魔防、元素抗性、格擋或護盾。
- 沒有全局減傷詞綴時，既有傷害數值不變。

## 當前任務：普通關卡多敵人與範圍技能

### 一、設計方案與架構規劃（腦力激盪）

普通關卡以固定機率表決定 1～4 名敵人，菁英階段固定單一敵人；`FIELD.monsters` 保存目前敵人集合，`FIELD.monster` 保留為目前第一目標的相容別名。普攻永遠只選集合中的第一名存活敵人，技能則對全部存活敵人套用「技能基礎傷害 ×（1＋範圍傷害%）÷ 敵人數」。每名敵人死亡時獨立結算金幣、經驗與掉落，全部擊殺後才推進階段。UI 以敵方區域內的響應式卡片網格呈現 2～4 名敵人。

### 二、微型任務拆解

1. [DONE] 先新增敵人數量機率、範圍傷害分攤與普攻鎖定目標測試。
2. [DONE] 將野外戰鬥狀態改為敵人集合，加入普通／菁英生成規則與逐敵人結算。
3. [DONE] 讓技能攻擊全體存活敵人，普攻維持單一目標並加入範圍傷害公式。
4. [DONE] 更新敵方 UI 排版、尺寸、血條與浮動傷害顯示。
5. [DONE] 執行完整測試、語法檢查與自我審查。

### 三、驗證要點（自我審查清單）

- 普通關卡機率為 1 隻 78%、2 隻 15%、3 隻 5%、4 隻 2%。
- 菁英與 BOSS 維持單一敵人，不套用普通關卡多敵人機率。
- 普攻一次只傷害一名敵人，該敵人死亡後才切換下一名。
- 多敵人時所有技能都攻擊存活敵人，且每名敵人依範圍傷害公式分攤。
- 每名敵人的金幣、經驗、裝備、寶石、附魔書、材料與零件掉落獨立擲骰。
- 全部敵人死亡後才算擊殺、推進階段並生成下一波。

## 當前任務：本機 GM 指令集

### 一、設計方案與架構規劃（腦力激盪）

建立獨立 `js/gm.js`，GM 功能只在 `localhost`、`127.0.0.1` 或 `::1` 初始化；初始化與執行路徑雙重檢查，外部環境不建立輸入框、不綁定鍵盤事件、不執行指令。指令採短指令格式，支援貨幣、材料、寶石、附魔書、裝備、零件、等級與說明。

### 二、微型任務拆解

1. [DONE] 測試外部環境完全不註冊 GM，以及本機 Enter/Escape 行為。
2. [DONE] 新增 `js/gm.js` 指令解析與遊戲狀態寫入。
3. [DONE] 接入 `index.html`／`js/main.js`／`css/style.css`，新增 `GM_command.md` 詳細說明。
4. [DONE] 執行完整測試、語法檢查與自我審查。

### 三、驗證要點（自我審查清單）

- 外部 hostname 不會建立 GM 輸入框或監聽 Enter。
- 本機輸入指令後保留面板與文字，重複 Enter 可重複執行；空白 Enter／Escape 關閉。
- 資源、寶石、附魔書、裝備與零件指令有參數驗證，不接受負數或未知 key。
- 裝備發放不透過背包滿載自動分解，避免 GM 發放造成意外損失。
- 指令文件完整記錄格式、範例、限制與本機安全邊界。

## 當前任務：寶石商店等級與機率改造

### 一、設計方案與架構規劃（腦力激盪）

以 `GEM_SHOP_COUNT_TABLE`、`GEM_SHOP_TIER_TABLE` 與 `GEM_SHOP_TABLE` 作為寶石商店單一資料來源；`gemShop.level` 保存商店等級，升級公式集中於 `gemShopUpgradeCost`。商店升級後立即重刷商品，購買、手動刷新與每小時刷新沿用同一套等級機率。

### 二、微型任務拆解

1. [DONE] 測試商店等級、升級費用、機率表總和、刷出數量與價格。
2. [DONE] 更新商店資料表、狀態初始化、升級流程與存檔相容。
3. [DONE] 更新商店 UI：Lv.1～20 升級按鈕、十格橫列、縮小商品 icon。
4. [DONE] 執行完整測試、語法與差異檢查。

### 三、驗證要點（自我審查清單）

- 商店等級不低於 1、不高於 20，Lv.20 不可再升級。
- 每個等級的刷出數量與寶石階級機率總和均為 100%。
- 升級金幣不足時不改變等級、不扣金幣。
- 舊存檔缺少商店等級時自動補為 Lv.1。
- 商品價格符合 1～10 級價格表，既有購買與刷新流程維持正常。

## 當前任務：暫停合成節點與合成材料

### 一、設計方案與架構規劃（腦力激盪）

以 `SYNTHESIS_ENABLED = false` 作為單一來源，從資料層同步控管合成節點執行、合成素材篩選、合成專用零件顯示與零件掉落。既有存檔資料不刪除，但關閉期間不再使用或產生新的合成材料；其他系統仍使用的寶石、附魔書與附魔精華維持正常。

### 二、微型任務拆解

1. [DONE] 新增合成關閉狀態的回歸測試。
2. [DONE] 加入全域合成開關，阻止節點執行、合成路由與合成零件生成。
3. [DONE] 隱藏合成節點與「合成素材」篩選選項，將舊存檔的合成篩選改為保留。
4. [DONE] 執行 Node 測試、靜態檢索與自我審查。

### 三、驗證要點（自我審查清單）

- 合成節點不會執行混合合成、品質合成或寶石升階。
- 掉落裝備不會再被送入合成暫存區。
- 野外、高塔與分解額外獎勵不會生成合成節點專用零件。
- 既有合成材料不被刪除，且 UI 不再提供合成節點或合成素材入口。
- 寶石、附魔書、附魔精華等其他系統材料仍可正常運作。

## 當前任務：神鑄系統（Divine Forge）

### 一、設計方案與架構規劃（腦力激盪）

**核心機制**：新增「神鑄」頁籤。六芒星法陣六角放入 6 件同品質裝備（限傳說/神話/創世），
消耗金幣按「鑄造」：成功獲得下一品質隨機部位裝備 1 件；失敗隨機消耗 2 件、其餘退回背包。
六個角尖可放「魔塵」（新材料）各 +5% 成功率，最多 6 個。

**新品質「神鑄創世」（第 9 階，暗金）**：
- 在 `RARITIES` 末端新增 `godforged`（index 8），`mult = 10.2`（創世 6.8 × 1.5）。
  → 詞條數值與洗煉上限（`rollAffixValue` / `getAffixLimits` 皆由 mult 推導）自動達成「1.5 倍上限」需求。
- 必帶 2 條專屬特效（`godPassives`），特效池 `GODFORGE_POOL` 共 12 條（≥10 要求），
  分兩類：純屬性型（併入 `computeStats` 聚合桶）與戰鬥觸發型（掛入 `resolveHit`/`doPlayerAttack`）。
- 僅能由「6 件創世 + 鑄造成功」產生：`rollRarity` 上限 7 不變；
  熔爐品質合成/混合合成大成功之品質上限鎖定在創世（防止繞過神鑄取得）。

**數值表**：
| 素材品質 | 基礎成功率 | 金幣消耗 | 產物 |
|---|---|---|---|
| 傳說 x6 | 55% | 500 萬 | 神話 x1 |
| 神話 x6 | 40% | 200 萬 | 創世 x1 |
| 創世 x6 | 25% | 1 億 | 神鑄創世 x1 |

**魔塵掉落**：野外敵人等級 ≥150：0.1%；<150 不掉。高塔 BOSS：min(15%, 2% + BOSS等級 × 0.2%)。

**高塔挑戰金幣消耗**：100000 + BOSS等級 × 200000（BOSS等級 = 樓層對應之 BOSS 顯示等級 `bossStatsFor(floor).level`）。

**架構解耦**：鑄造邏輯獨立於新檔 `js/forge.js`（邏輯層），渲染集中於 `ui.js` 的 `renderForge`
（透過 `UI.dirty.forge` 驅動），狀態封裝於 `G.forge`，不在邏輯層直接操作 DOM。

### 二、微型任務拆解

1. [MODIFY] `js/data.js`：RARITIES 新增第 9 階；RARITY_PREFIX 補「神鑄創世的」；
   新增 `GODFORGED_IDX`、`GODFORGE_POOL`（12 條專屬特效）、神鑄常數（成功率/金幣/魔塵掉落率）。
2. [MODIFY] `js/formula.js`：新增 `godforgePassiveValue`、`towerChallengeCost`、`forgeSuccessRate` 等公式；
   `computeStats` 聚合 `godPassives`；`resolveHit` 掛入破滅/聖佑/不朽三個觸發點。
3. [MODIFY] `js/item.js`：`makeEquipment` 於 godforged 品質時骰 2 條專屬特效；
   `itemDetailHTML` 顯示專屬特效區塊；`itemScore` 計入特效加成。
4. [MODIFY] `js/factory.js`：品質合成/混合合成之「品質+1」上限鎖定創世。
5. [MODIFY] `js/combat.js`：`doPlayerAttack` 掛入天罰/萬象汲取/神怒；`rollFieldDrops` 加魔塵掉落。
6. [MODIFY] `js/tower.js`：`startTowerFight` 加金幣消耗；`endTowerFight` 勝利加魔塵掉落。
7. [ADD] `js/forge.js`：神鑄邏輯層（放入/取出/魔塵/鑄造/全卸下/成功率計算），狀態存於 `G.forge`。
8. [MODIFY] `js/player.js`：`newGameState` 增加 `player.dust` 與 `forge` 狀態。
9. [MODIFY] `js/save.js`：`migrateSave` 對 forge.slots 內裝備套用名稱/插槽修正。
10. [MODIFY] `index.html`：新增「🔯 神鑄」頁籤與 `tab-forge` 區塊（六芒星容器/按鈕/背包）；載入 `js/forge.js`；頂欄加魔塵資源顯示。
11. [MODIFY] `js/ui.js`：`renderForge`（法陣/槽位/魔塵/成功率/紀錄/背包）、`uiTick`/`switchTab` 掛 dirty、
    事件委派處理 forge 槽位/魔塵/按鈕點擊；`renderHeader` 顯示魔塵；`renderTower` 顯示挑戰費用；
    `itemCellHTML`/`renderEquip` 支援 `eff-godforged` 特效框。
12. [MODIFY] `css/style.css`：六芒星版面（背景圖/絕對定位槽位/魔塵圓鈕/中央產物/紀錄浮層/黃色按鈕）、
    `.eff-godforged` 暗金流光邊框、`.it-godpassive` 特效文字樣式。
13. [VERIFY] 以 preview 開啟頁面檢查主控台無錯誤、神鑄頁籤渲染與互動流程正確；驗證後清理除錯輸出。

### 三、驗證要點（自我審查清單）

- 舊存檔讀取：`mergeDefaults` 自動補 `player.dust` / `G.forge`；filter.actions 自動補到 9 格。
- 神鑄創世不可再入爐（品質過濾只允許 5/6/7）。
- 失敗只消耗 2 件並退回其餘 4 件；被消耗裝備上的寶石自動取回。
- 熔爐合成無法產出神鑄創世；掉落表（欄位僅 0~7）不受影響。
- 金幣不足 / 裝備不足 / 品質不符時給出明確錯誤提示且不扣資源。

## 已完成任務：裝備欄位改造

### 設計與驗證

- [DONE] 將護腿移至胸甲與腰帶之間，原護腿位置改為手腕。
- [DONE] 新增 wrist 裝備種類、掉落、攻擊類附魔與黑鋼腕甲圖示。
- [DONE] 使用既有存檔正規化流程補齊舊存檔缺少的手腕欄位。
- [DONE] 完成欄位引用、CSS 座標、圖示檔案與差異檢查。

## 當前任務：修復自動存檔儲存空間問題

### 設計與驗證

- [DONE] 確認自動存檔每 15 秒更新同一本局記錄，不是每次新增一筆。
- [DONE] 修正寫入前清理、孤兒記錄清理與寫入失敗重試流程。
- [DONE] 檢查 `SAVE_KEY`、自動存檔與手動存檔共用同一套容量恢復機制。

## 已完成任務：修正存檔資料夾唯讀誤報

- [DONE] 已連線資料夾使用單一路徑完成權限、同步與寫入。
- [DONE] 取消選擇時顯示未寫入，不再誤報同步成功。
## 已完成任務：明確區分存檔同步與檔案下載
- [DONE] 主動點擊資料夾按鈕時固定叫出資料夾選擇器，選定後同步寫出存檔。
- [DONE] 新增下載全部存檔按鈕，支援跨本地遊戲複製 .json 存檔。
- [DONE] 修正介面說明，區分瀏覽器資料夾選擇與 Windows 檔案總管。

## 已完成任務：手動存檔強制落地本地資料夾
- [DONE] 手動存檔前先確認本地資料夾權限與連線。
- [DONE] 手動存檔後強制寫出 `.json`，成功後才顯示本地存檔成功。
- [DONE] 取消或寫入失敗時明確提示，避免把瀏覽器快取誤稱為本地存檔。

## 已完成任務：自動存檔同步至本地資料夾
- [DONE] 已授權資料夾後，自動存檔同步寫出 `IC_autosave_run*.json`。
- [DONE] 說明首次授權需由使用者手動完成，避免自動計時器觸發瀏覽器選擇器限制。

## 已完成任務：修正中央裝備部位重疊
- [DONE] 縮短胸甲欄位高度，降低胸甲圖示高度。
- [DONE] 調整護腿與腰帶的上下位置及尺寸，保留部位間距。

## 已完成任務：依參考圖重排中央裝備欄位
- [DONE] 中央排列調整為胸甲、腰帶、護腿、靴子。
- [DONE] 護腿恢復較高欄位，並重新分配四個部位的上下間距。

## 已完成任務：增加護腿與靴子間距
- [DONE] 腰帶與護腿上移，讓護腿和靴子之間保留清楚空隙。

## 已完成任務：修正存檔資料夾空白與同步數量誤判
- [DONE] 同步結果顯示實際寫出數量、總數與跳過數量。
- [DONE] 自動存檔遺失時以目前存檔回填，索引為空時保留 `IC_current.json`。
- [DONE] 修正引導 Banner 的取消／成功訊息。
## 已完成任務：修正裝備背景圖檔名路徑
- [DONE] 將裝備介面 CSS 引用修正為實際存在的 `character_UI .png`。
- [DONE] 恢復裝備介面底圖、框架與各欄位背景。
## 已完成任務：調整新版裝備圖示融合效果
- [DONE] 加深已裝備欄位底色，讓裝備圖示與新版背景一致。
- [DONE] 略微放大已裝備圖示，減少淺色底圖露出。
## 已完成任務：右側小圖示化鑲嵌與附魔區
- [DONE] 將寶石與附魔物品移至裝備詳情右側固定高度區域。
- [DONE] 改為小型正方形 icon，效果與操作說明透過滑鼠 tips 顯示。
- [DONE] 保留鑲嵌、取下與手動附魔操作，避免背包區域被推移。
## 已完成任務：修復存檔配額與 .crswap 暫存檔問題
- [DONE] 配額不足時清理瀏覽器歷史快照副本並保留目前主存檔。
- [DONE] 手動存檔可直接落地已授權的本地資料夾，不被 localStorage 配額阻斷。
- [DONE] 寫入失敗時中止暫存檔，並清理已知 `.crswap` 檔案。
## 已完成任務：配額不足時保留本地自動存檔
- [DONE] 自動存檔瀏覽器副本失敗時，改直接寫入本地資料夾。
- [DONE] 自動存檔清單改以小型 metadata 保留，避免因配額不足不顯示。
## 已完成任務：修復本地存檔三個操作按鈕
- [DONE] 讀取與下載可直接從本地資料夾讀取 `folderOnly` 存檔。
- [DONE] 刪除可同步移除 metadata 與本地檔案。
- [DONE] 手動存檔改用小型 metadata 索引，保留多筆本地存檔。
## 已完成任務：完成右側鑲嵌／附魔區域尺寸
- [DONE] 右側面板調整為約 210px × 465px，對齊裝備詳情內容區。
- [DONE] 保持固定高度與內部滾動，避免推移背包區域。
## 已完成任務：區分已鑲嵌與可用素材
- [DONE] 右側素材面板拆分為四個清楚區塊。
- [DONE] 已套用素材以金色邊框標示，效果透過滑鼠 tips 顯示。
## 已完成任務：明確標示裝備上的寶石與附魔
- [DONE] 右側面板上方改用「裝備上的寶石／裝備上的附魔」標題。
- [DONE] 已套用 icon 使用金色邊框，與可用素材區分。
## 已完成任務：恢復裝備詳情中的已鑲嵌／已附魔效果
- [DONE] 已套用寶石與附魔回到主裝備詳情區，保留完整效果文字。
- [DONE] 右側區域僅保留可供選擇的寶石與附魔書。
## 已完成任務：刷新時優先載入本地最新存檔
- [DONE] 啟動時掃描本地資料夾有效 `.json` 並依 `savedAt` 選最新檔案。
- [DONE] 避免啟動同步用舊瀏覽器快照覆蓋較新的本地快照。
- [DONE] 未授權資料夾時仍保留瀏覽器存檔後備流程。

## 已完成任務：神鑄自動控制項改為可見 checkbox

### 設計與驗證

- [DONE] 先以回歸檢查要求兩個控制項使用可見 `input type="checkbox"`，不再用文字 emoji 模擬勾選。
- [DONE] 神鑄 footer 的「自動使用魔塵」與「自動鑄造」改為可見自訂 checkbox，保留既有狀態、鍵盤 focus、disabled 與 change 事件。
- [DONE] 完成神鑄控制項回歸測試與語法檢查。

## 當前任務：神鑄時間進度條平滑更新

### 設計與驗證

進度狀態仍以 `startedAt` 與 `durationMs` 為唯一來源；將視覺更新從 200ms 主 UI 迴圈獨立為
`requestAnimationFrame`，每幀重算進度與倒數，鑄造結束或狀態消失時取消動畫。移除依賴離散寬度變化的
CSS transition，避免出現追趕式跳動。

### 微型任務拆解

1. [DONE] 新增平滑更新與動畫生命週期的回歸檢查。
2. [DONE] 以 requestAnimationFrame 更新進度寬度與倒數。
3. [DONE] 執行測試與自我審查。

## 已完成任務：裝備圖示批次去背

### 設計與驗證

僅處理 `js/data.js` 實際引用的 10 組裝備圖示：武器、頭盔、肩甲、胸甲、腰帶、手套、護腕、護腿、靴子與戒指。
先以純色遮罩來源判斷物件輪廓，再將透明度套回原始 RGB 像素，避免影像模型重繪裝備細節；寶石、金幣、魔塵、背景與角色圖不處理。

### 微型任務拆解

1. [DONE] 新增 RGBA PNG 與透明角落的裝備圖示驗證。
2. [DONE] 建立 10 組原始像素保留式透明遮罩並寫回 `images`。
3. [DONE] 完成逐張棋盤格預覽、尺寸、格式與透明度自我審查。

## 已完成任務：神鑄創世彩色流動外框

### 設計與驗證

沿用既有 `eff-godforged` 類別，僅將神鑄創世裝備的單色耀金框升級為彩虹 `conic-gradient` 旋轉外框，
加入粉藍外部光暈與深色內襯；神話、創世及其他品質的選擇器維持原樣。

### 微型任務拆解

1. [DONE] 新增神鑄創世彩色動畫外框回歸檢查。
2. [DONE] 加入彩色流動、光暈與減少動態偏好支援。
3. [DONE] 執行完整測試、CSS 差異檢查與自我審查。

## 已完成任務：修正神鑄創世外框速度與背景色

### 微型任務拆解

1. [DONE] 將彩色外框旋轉週期由 1.8 秒縮短為 0.9 秒。
2. [DONE] 將內襯由深色漸層恢復為創世級金色漸層。
3. [DONE] 更新回歸檢查並完成完整測試。

## 已完成任務：新增項鏈專用圖示

### 設計與驗證

項鏈原本錯誤共用寶石資源圖 `icon_gems.png`，且 `images` 沒有項鏈素材；新增透明背景的暗黑風格項鏈圖示，
並將資料來源改為 `icon_amulet.png`，不影響寶石資源圖。

### 微型任務拆解

1. [DONE] 追查項鏈圖示引用與確認缺少專用檔案。
2. [DONE] 新增 `images/icon_amulet.png` 並完成透明背景檢查。
3. [DONE] 更新 `SLOT_INFO.amulet`、補測試並完成完整驗證。

## 已完成任務：神鑄創世加入半透明旋轉背景

### 設計與驗證

在既有創世級金色內襯上疊加低透明度黑色 `conic-gradient`，透過可動畫化角度變數旋轉，讓神鑄創世與其它品質保持一致的背景動態，
同時保留彩虹外框與裝備圖示可讀性。

### 微型任務拆解

1. [DONE] 新增內部旋轉背景效果的回歸檢查。
2. [DONE] 加入半透明黑色旋轉層與減少動態偏好支援。
3. [DONE] 執行完整測試、語法檢查與差異檢查。

## 當前任務：太古詞條與太古精華系統

### 設計與驗證

自然掉落的高等級裝備逐詞條獨立判定太古詞條；洗煉勾選太古精華後，每次消耗 1 顆，並讓每個重骰詞條獨立以 20% 機率成為太古詞條。
太古精華同時接入野外／高塔掉落、傳奇以上裝備拆解、存檔資源與右上角資源列。太古詞條以橘色與六角星顯示，並使用獨立的新圖示 `images/icon_ancient_essence.png`。

### 微型任務拆解

1. [DONE] 新增太古機率、數值、掉落與拆解規則及 TDD 回歸測試。
2. [DONE] 接入自然掉落、BOSS 掉落、離線收益、存檔與洗煉資源消耗。
3. [DONE] 新增全新的太古精華圖示、右上角資源顯示、勾選控制與太古詞條樣式。
4. [DONE] 更新 `game_formula.md`、執行針對性與完整測試、語法及差異檢查。

## 已完成任務：神鑄失敗消耗調整為 3 個

### 微型任務拆解

1. [DONE] 將裝備與寶石共用的 `FORGE_FAIL_CONSUME` 由 2 改為 3。
2. [DONE] 同步失敗退回數量、神鑄介面提示與 `game_formula.md`。
3. [DONE] 新增回歸檢查，確認兩種神鑄模式均消耗 3 個並退回其餘 3 個。

## 已完成任務：寶石合成加入全部類型選項

### 微型任務拆解

1. [DONE] 新增「全部類型寶石」選項，只套用於寶石合成選單。
2. [DONE] 讓單次與全部合成依序處理各種類，禁止跨種類混合。
3. [DONE] 更新合成資訊、公式文件並新增回歸測試。

## 已完成任務：調整高階裝備洗煉精華消耗

### 微型任務拆解

1. [DONE] 確認洗煉精華消耗由 `rerollCost` 統一計算。
2. [DONE] 神話／創世／神鑄創世改為消耗 9／14／20 個精華。
3. [DONE] 保留其他品質原公式，並同步公式文件與回歸測試。

## 已完成任務：調整寶石商店手動刷新費用

### 微型任務拆解

1. [DONE] 確認 `refreshCount` 代表本週期已完成刷新次數，第一次刷新序號採 1。
2. [DONE] 將手動刷新費用改為 `5000 × 下一次重置序號^2.5`，並四捨五入為整數。
3. [DONE] 同步商店說明、公式文件與回歸測試。

## 已完成任務：擴充自動機組零件安裝與階級

### 微型任務拆解

1. [DONE] 分解槽改為固定 10 格，零件階級上限提升至 T7，同類未安裝庫存保留上限改為 10 個。
2. [DONE] 可用零件改為每種類彙總一行，顯示數量並按最高階級／數值優先安裝。
3. [DONE] 同步 `game_formula.md`、互動事件與回歸測試。

## 已完成任務：修正 F11 與網頁全螢幕按鈕的狀態衝突

### 微型任務拆解

1. [DONE] 區分 Fullscreen API 全螢幕與瀏覽器 F11 全螢幕。
2. [DONE] 網頁全螢幕由按鈕可正常退出；偵測到外部 F11 時避免重複 requestFullscreen 並提示按 F11 返回。
3. [DONE] 同步按鈕提示、resize 狀態更新與回歸測試。

## 已完成任務：再次加快三倍彩色外框

- [DONE] 彩色外框旋轉週期由 `0.9s` 調整為 `0.3s`。
- [DONE] 保持內部半透明黑色背景旋轉速度不變，避免視覺過度混亂。
- [DONE] 更新回歸檢查並完成差異驗證。

## 已完成任務：依 game_formula.md 更新轉生設定

### 設計與驗證

以 `game_formula.md` 的最新規格為唯一依據：最高 10 轉；生命、法力與四維倍率擴充至
`10/20/40/80/160/320/640/1280/2560/5120`；升級經驗倍率改為每次轉生是上一次的 10 倍。
保留舊存檔相容性，轉生次數仍由同一個上限常數統一限制。

### 微型任務拆解

1. [DONE] 新增 10 轉、屬性倍率與十倍遞增經驗倍率回歸測試。
2. [DONE] 同步 `data.js`、`formula.js`、初始 UI 與公式表格。
3. [DONE] 檢查舊 5 轉設定殘留並執行完整測試。

## 已完成任務：補正最新 11 個轉生稱號

- [DONE] 重新讀取 `game_formula.md`，確認「冒險者」包含在內共 11 個稱號。
- [DONE] 將 `REINCARNATION_RANKS[0..10]` 完整同步為文件順序。
- [DONE] 回歸測試補上 11 個稱號的完整比對。

## 已完成任務：神鑄 0 轉 1000 級永久解鎖

### 設計與驗證

神鑄只在 0 轉達到 1,000 級時首次開放，寫入 `G.forge.unlocked`；之後轉生不再依目前等級重新判斷。
舊存檔若已有 `unlockNotified`，讀取時會相容遷移為永久開放。

### 微型任務拆解

1. [DONE] 新增永久解鎖旗標與 0 轉門檻判斷。
2. [DONE] 補上舊存檔 `unlockNotified` 遷移。
3. [DONE] 新增解鎖、轉生後保持開放與未達門檻鎖定測試。

## 已完成任務：修正背景分頁自動鑄造少結算

### 設計與驗證

瀏覽器背景分頁會降低計時器頻率，原本 `gameTick` 的 10 秒上限會丟失超出的實際時間，且 `forgeTick` 每次只處理一輪。
改為使用實際 `startedAt + durationMs` 判定，背景喚醒時最多連續補算 200 輪；自動鑄造下一輪沿用上一輪的結束時間，避免背景延遲造成額外等待。

### 微型任務拆解

1. [DONE] 新增背景補算與排程接續的回歸檢查。
2. [DONE] 讓 `forgeTick` 依實際時間連續結算自動鑄造輪次。
3. [DONE] 執行完整測試、語法檢查與差異檢查。

## 已完成任務：限制輸送帶並壓縮存檔

### 設計與驗證

輸送帶改為固定 20,000 件硬上限；新裝備在滿載時直接丟棄，舊存檔載入時保留前 20,000 件並裁掉尾端積壓。大型快照改用瀏覽器原生 gzip 寫入 IndexedDB 與本地存檔資料夾，讀取時同時相容 gzip 與舊版純 JSON。

### 微型任務拆解

1. [DONE] 固定輸送帶容量並新增滿載直接丟棄規則。
2. [DONE] 補上舊存檔輸送帶溢出資料的遷移裁切。
3. [DONE] 新增 gzip 編解碼、舊 JSON 相容與最新快照寫入保護。
4. [DONE] 新增容量、遷移與壓縮往返測試。

## 已完成任務：重新整理期間的 Loading 覆蓋層

### 設計與驗證

頁面載入初期先顯示全黑固定覆蓋層，遮住存檔讀取、資料遷移與初始 UI 建立期間的半完成畫面；初始化流程完成後才隱藏。重新整理前也會先啟用覆蓋層，文字以 `Loading.`、`Loading..`、`Loading...` 循環。

### 微型任務拆解

1. [DONE] 新增全黑 Loading 覆蓋層與 1~3 點循環動畫。
2. [DONE] 接上版本刷新、瀏覽器重新整理與 F5 的卸載前顯示流程。
3. [DONE] 初始化完成後隱藏覆蓋層並新增 UI 回歸測試。

## 已完成任務：戰鬥暫停控制

戰鬥界面上方新增暫停按鈕。暫停時停止野外與高塔戰鬥的攻防、技能、狀態效果、復活與戰鬥倒數，並凍結戰鬥用遊戲時鐘；工廠處理、鑄造與存檔計時維持運作。狀態只存在當前頁面，不寫入存檔。

### 微型任務拆解

1. [DONE] 新增可切換的戰鬥暫停狀態與主迴圈凍結邏輯。
2. [DONE] 在戰鬥界面上方加入暫停／繼續按鈕及 `aria-pressed` 狀態同步。
3. [DONE] 新增暫停行為測試並完成語法與回歸驗證。

## 當前任務：修復玩家技能增益函式缺失、日誌過濾與詳細日誌 UI 優化（關閉上移與暫停按鈕同步）

### 設計與驗證
1. 修復介面崩潰：先前修改屬性面板顯示「目前技能增益」時，遺漏在 `js/combat.js` 中實現 `activePlayerBuffs(ent)`。將在 `js/combat.js` 實現並導出此純函式，根據 `PLAYER_BUFF_ORDER` 排序，過濾過期（until <= GT）的增益，並提供剩餘秒數 `Math.ceil(until - GT)`，恢復裝備欄與戰鬥區正常顯示。
2. 過濾綜合紀錄中的神鑄日誌：修改 `css/style.css`，在主畫面綜合紀錄下拉選單選「全部」時，預設隱藏工坊與神鑄（`factory`）相關的日誌，避免非戰鬥日誌洗版，但當下拉選單切換至「裝備與強化」時仍能正常檢視。
3. 過濾詳細日誌中的神鑄日誌：修改 `js/ui.js` 的 `renderDetailLog()`，當篩選器選擇為「全部」（`all`）時，排除 `cat === 'factory'` 的日誌，使詳細日誌與主日誌面板同步。
4. 同步詳細日誌面板色彩：修改 `css/style.css`，為 `.detail-log-line` 也套用與 `.log-line` 相同的戰鬥色彩類別定義（例如 `log-player-attack` 等），確保其普攻文字顏色等為正確的白色。
5. 詳細日誌關閉按鈕防壓線：修改 `css/style.css`，將 `.detail-log-head .modal-x` 的 `top` 設為 `2px`，使其上移避免壓線。
6. 詳細日誌工具列新增暫停按鈕：於 `index.html` 中加入暫停按鈕，並在 `js/ui.js` 中同步 `refreshCombatPauseButton()` 及 click 事件綁定，實現雙向同步。

### 微型任務拆解
1. [DONE] 在 `js/combat.js` 末尾實現 `activePlayerBuffs` 與 `PLAYER_BUFF_ORDER`。
2. [DONE] 在 `css/style.css` 中，新增樣式隱藏非 `filter-factory` 狀態下的 `[data-cat="factory"]` 日誌。
3. [DONE] 在 `js/ui.js` 中修改 `renderDetailLog` 以在全部模式下隱藏 factory 日誌。
4. [DONE] 修改 `css/style.css` 新增詳細日誌特定戰鬥色彩樣式。
5. [ ] 修改 `css/style.css`，將詳細日誌關閉按鈕上移。
6. [ ] 修改 `index.html` 與 `js/ui.js`，在詳細日誌工具列新增暫停按鈕並與主界面暫停雙向同步。
7. [ ] 執行單元測試 `node --test tests/active-buffs-panel.test.cjs` 驗證 `activePlayerBuffs` 行為。
8. [ ] 執行所有測試 `node --test tests/` 確保遊戲核心與 UI 的完整性。

## 當前任務（2026-07-16）：新增對普通/菁英/BOSS 敵種傷害屬性（1 加成 + 3 減免）

### 需求
- 新詞條「對普通傷害%」（百分比）：放出量與物理防禦詞條相同（base/lv 同 defFlat），公式同對菁英/BOSS 傷害加成、僅對非菁英且非 BOSS 的普通敵人生效。
- 新詞條「對普通/菁英/BOSS傷害減免」（定值）：放出量約為物理防禦詞條的 2 倍（base×2、lv 係數同 defFlat）。
- 減免通用公式：減傷率 = 減免值總合 / (減免值總合 + a + b×攻擊者等級)，a=60、b=8（同防禦減傷曲線基準），於 resolveHit 全局減傷之後、最低傷害之前的最末端套用；依攻擊者敵種（普通/菁英/BOSS）選用對應減免值。
- 屬性面板：進攻加「對普通傷害」，防禦加三個減免列；tips 黃字顯示「目前同級減傷率」截斷至小數點後四位（pctStrFloor4）。

### 設計
- data.js：AFFIX_POOL +4 詞條、AFFIX_CATS 歸類（off/def）、STAT_GROUPS +4 列、enemyTypeDmgRedDesc tips 助手。
- formula.js：computeStats 聚合桶與 st 欄位 +4；§3 新增 ENEMY_TYPE_DMG_RED_A/B 與 enemyTypeDamageReduction()；resolveHit 加「對普通傷害加成」判定與末端敵種減免；SCORE_WEIGHTS +4。
- combat.js：playerAtkCfg 帶 normalDmg、playerDefCfg 帶三減免、monsterAtkCfg 帶 isElite/isBoss（高塔 BOSS 實體已有 isBoss 旗標）。
- skills.js：castSkill 的 aCfg 帶 normalDmg。
- 文件：game_formula.md §2.5／§3.2／§6.4 同步。

### 微型任務
1. [DONE] tests/enemy-type-damage.test.cjs（TDD：詞條定義、加成只打普通敵、減免公式與末端套用順序、面板 tips 黃字四位小數）。
2. [DONE] data.js 詞條池／分類／面板／tips。
3. [DONE] formula.js 聚合、公式、resolveHit、評分權重。
4. [DONE] combat.js / skills.js 攻防組態接線。
5. [DONE] game_formula.md 同步。
6. [DONE] npm run build ＋ npm test（不新增失敗）＋ 隔離埠實測（頁面載入、主控台 0 錯誤、面板顯示）。

## 當前任務（2026-07-16 續）：參數表加入敵種傷害屬性公式＋「刪除」標記處理

### 需求
- game_parameters.xlsx／CSV 加入上一任務的新公式列（敵種傷害減免 a/b、4 條新詞條放出量、4 條戰力權重）。
- 變動欄新定義「刪除」＝把該列公式從參數表移除；本次：#58「2-屬性上限/全局減傷 上限」（全局減傷已不設上限、該列本就不生效）。

### 設計
- xlsx 現況：sheet1(game_parameters) 全表為 `=計算表!Xn` 同列鏡像；sheet2(計算表) 為實際值，A 欄多段共用公式遞增、I11:I19 為轉生經驗 ×3 鏈（列位不受本次變動影響、原樣保留）。CSV 與 xlsx 目前 100% 同步（已 round-trip 驗證）。
- 編輯策略（純 Node 重壓 ZIP）：sheet2 刪 1 列、插 9 列（字面值、inlineStr）、全列重編號；A 欄重建為單一共用公式鏈 A4:A{end}（保留使用者的自動遞增行為）；sheet1 資料列全部重生為同列鏡像＋快取值；刪 calcChain 並在 calcPr 加 fullCalcOnLoad 讓 Excel 開檔重算。
- 新列位置：3-戰鬥核心「敵種傷害減免」(a=60,b=8) 接在防禦減傷率後；表-詞條池 3 條減免接在全局減傷後、對普通傷害% 接在對BOSS傷害% 後；表-戰力權重同樣對位。
- apply_params.cjs：scalar 接 ENEMY_TYPE_DMG_RED_A/B；wKeyByName 補 4 個新詞條名稱（詞條池迴圈本身通用、自動接上）。
- AI_RULES.md 變動欄語意補「刪除」定義。

### 微型任務
1. [DONE] 轉換腳本（scratchpad）：讀 zip → sheet2 增刪列＋重編號＋A 鏈重建 → sheet1 鏡像重生 → 重壓 ZIP。
2. [DONE] 驗證閘門：xlsx_to_csv round-trip，與「基線 CSV＋預期變更」逐列比對（忽略編號欄後全等）。
3. [DONE]（Excel 關閉後以重跑補丁流程換入，內容比對無使用者變更遺失） 覆寫 config/Excel/xlsx 與 config/CSV（以重生輸出為準，保證兩者同步）。
4. [DONE] apply_params.cjs 接線＋dry-run 無錯誤。
5. [DONE] AI_RULES.md「刪除」定義；PLAN/PATCH/記憶同步。

## 當前任務（2026-07-16 續2）：屬性面板跟隨「檢視中」裝備套即時預覽

### 需求
- 切到某套裝備「檢視」時（不需按確定切換），側欄屬性面板即顯示該套的would-be屬性，方便比較強度。
- 戰鬥／生命法力／掉落等一切遊戲邏輯仍以「穿著中」那套為準（getStats 不變）。

### 設計
- formula.js `computeStats(equipmentOverride)`：裝備聚合迴圈改讀傳入的裝備套（預設 G.equipment），其餘不動。
- player.js：`markStatsDirty` 同步清空新增的 `_viewStatsCache`；新增 `getViewStats()`＝檢視套==穿著套時回傳 getStats()，否則以 `computeStats(viewedEquipment())` 計算＋快取；`setEquipView` 清預覽快取並標記 header 重繪。
- ui.js `renderHeader`：attr-panel 改餵 `getViewStats()`（header 其他區塊維持穿著中 st）；`renderAttrPanel` 骨架頂端加 `#attr-preview-note`，檢視非穿著套時顯示「👁 屬性預覽：第X套（尚未穿上）」。
- css：`.attr-preview-note` 樣式。
- 測試：computeStats 覆寫裝備套產生不同數值；getViewStats 於 equipView≠equipActive 時回傳檢視套數值、切回後與 getStats 相同。

### 微型任務
1. [DONE] 測試 tests/equip-set-preview-stats.test.cjs。
2. [DONE] formula.js / player.js / ui.js / css 實作。
3. [DONE] npm run build＋npm test（不新增失敗）＋隔離埠實測（切頁面板數值即變、預覽提示出現、切回一致、主控台 0 錯誤）。
4. [DONE] game_formula.md（§2 註記面板預覽語意）＋PATCH.md。

## 當前任務：新增 1 轉後開放的天賦系統

### 需求
- 依桌面企劃書《天賦.xlsx》新增天賦系統。
- 天賦系統於玩家完成 1 轉後開放，包含企劃書定義的天賦樹、點數、解鎖條件與效果。

### 微型任務拆解
1. [ ] 解析《天賦.xlsx》並對照現有轉生、屬性、技能、存檔架構。
2. [ ] TDD：先補天賦資料、解鎖條件、點數與效果計算測試。
3. [ ] 實作天賦資料模型、公式、存檔遷移與解鎖流程。
4. [ ] 接上天賦頁面 UI、互動、參數表與 `game_formula.md`。
5. [ ] 完成 build、相關測試、隔離埠運行驗證與自我審查。
