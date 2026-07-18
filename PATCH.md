# PATCH.md

## 變更紀錄：熔爐專屬佇列——各爐獨立佇列取代共用計數（2026-07-18）

- 問題：帶尾 +N 原為「共用總佇列中符合該爐品質的件數」——同設定多爐重複計數，10 座爐各顯示 +9999 但實際總量僅 1.4 萬，數字無法對帳。
- **設計改造**：每座熔爐新增**專屬佇列**（`fu.queue`，上限 `NEW_FORGE_FURNACE_QUEUE_CAP = 9999`/爐）。頂部「佇列」＝總佇列（未派發剩餘量，派發後遞減）；帶尾 +N＝該爐專屬佇列真實件數（各爐獨立；各爐加總＋總佇列＝全部待處理量）。
- **js/newforge.js**：派發（每 2 秒一輪、30×爐數件）自總佇列分派到「帶＋專屬佇列負載最少」的符合熔爐專屬佇列；傳送帶自專屬佇列隨時補位（`newForgeRefillBelt`）；品質取消勾選/停用 → `newForgeReturnUnroutable` 把不符項退回總佇列重新派發（帶上裝備視為已承諾不回退）；移除熔爐/轉生裁減 → 專屬佇列回總佇列、帶上裝備退回背包；intake 滿載改以「總量」計（`newForgeTotalQueued`，防存檔膨脹）；共用計數 `newForgePendingCounts` 移除。
- **js/ui.js**：+N 直讀 `fu.queue.length`（顯示封頂 +9999、tooltip「此熔爐專屬佇列：N 件」精確數）；品質/啟用變更事件掛健檢回退。
- **sanitize**：合併前存檔自動補建 `fu.queue`；壞項剔除、帶超量入專屬佇列前端、專屬佇列超量回總佇列、總量上限裁減。
- 測試：tests/new-forge.test.cjs 改版 23/23（派發進專屬佇列/補位/平均分流負載守恆/滿載留總佇列/健檢回退/總量 intake 上限/移除回退/sanitize 補建與超量）。
- 驗證：build 110 檔過；全套失敗數與基線一致（新增 7 項天賦/元素失敗經 stash 交叉驗證為使用者 WIP 所致，與本次無關）；隔離埠 8125 實測——3 座同設定爐＋總佇列 3,000 件：派發後總佇列遞減至 2,463、各爐 +149 獨立顯示、global＋Σ專屬＝總量守恆；UI 取消 2 號爐「普通」勾選 → 19 件普通退回總佇列；停用 3 號爐 → 466 件全退；save→migrate 往返專屬佇列完好；主控台 0 錯誤。
- 文件：game_formula.md §12/§12.1（專屬佇列/派發/一致性）、PLAN.md 同步。

## 變更紀錄：抗性改為等級衰減曲線（2026-07-18）

- 物理抗性、魔法抗性與六系元素抗性改用 `抗性總合^次方 / (抗性總合^次方 + 常數 + 敵人等級×等級係數)`；物理／魔法各自獨立參數，六系元素共用參數。
- 移除三項抗性的 `STAT_CAPS` 與參數表上限列；抗性僅保留下限 0。
- 抗性 tooltip 改為不列公式，使用黃色顯示「目前總減傷」至小數點後四位。
- CSV／XLSX 初始參數皆為 a=1.8、b=10、c=0.1；新增回歸測試 `tests/resistance-tooltip.test.cjs`。

## 變更紀錄：帶尾 +N 顯示上限 999 → 9999（四位數）

- **js/ui.js**：帶尾 +N 顯示封頂 `+999` → `+9999`。
- **js/newforge.js**：`newForgePendingCounts` 改全量精確計數（移除 1,000 件提前終止）——tooltip 恆為精確數（先前單爐破萬時會被截在 10,000）；實測滿佇列 20,000 件單次掃描 3.6ms、每 200ms 至多一次且僅熔爐分頁時執行，無感。
- **css/style.css**：`.nf-belt-more` 固定寬 44px → 52px（以 +9999 預留，數字增減版面不動）。
- 驗證：build 109 檔過；專屬測試 23/23；隔離埠 8125 實測——佇列 1,500 顯示 +1500、9,999 顯示 +9999、12,345 顯示 +9999（tooltip 精確「12,345 件」）、各狀態寬度恆 52px；主控台 0 錯誤。game_formula.md §12.1 同步。

## 變更紀錄：修正後面熔爐空帶卻顯示 +999（路由改平均分流）

- 問題：路由採「第一座有空位的熔爐優先」且每輪額度僅 5×熔爐數——多爐同設定時，前面的熔爐（尤其裝加速齒輪消化快者）把整輪額度吃光，後面的熔爐長期空帶，但佇列確實有 ≥999 件符合該爐的裝備在排隊（+999 為真實計數，非顯示錯誤）。
- **js/newforge.js**：`newForgeAcceptingFurnace` 改分派給符合品質且帶未滿中「**帶上件數最少**」的熔爐（平均分流）；全部帶滿才留佇列等待（FIFO 不變）。
- **js/data.js**：`NEW_FORGE_ROUTE_PER_TICK` 5 → `NEW_FORGE_BELT_CAP`(30)——單輪路由額度足以補滿全部空帶（最高速爐每輪僅消化約 19 件，30 足夠）。
- 測試：tests/new-forge.test.cjs +1（重現情境：1 號爐滿帶＋兩座空帶＋佇列 20 件 → 空帶各分 10；單輪 200 件 → 空帶一輪補滿 30/30、其餘留佇列），23/23 過。
- 驗證：build 109 檔過；隔離埠 8125 重現——5 座同設定熔爐、1 號滿帶其餘空、佇列 2,000 件 → 單輪路由後五帶皆 30/30；持續運轉 6 秒五帶穩定 29~30（邊消化邊補件）、佇列正常下降；主控台 0 錯誤。
- 文件：game_formula.md §12.1 路由規則同步（平均分流＋單輪額度）。

## 變更紀錄：零件列表點外部收起＋改版公告文字精簡

- **js/ui.js**：新增 document 層點擊監聽——零件選擇列表開啟時，點擊「零件界面外」任意處即收起全部列表；點擊列表本體（連續安裝晶片、收起鈕）與零件格列（卸下/解鎖/開啟）不收起，保留連續安裝操作。
- **index.html**：改版公告彈窗刪除整段規則說明，改為黃色（#ffd700）18px 粗體置中提示「熔爐系統已重新改造，請玩家重新佈置新熔爐！」；下方楬色（--accent）補充文字保留。
- 驗證：build 109 檔過；專屬測試 22/22（新增外部收起靜態斷言）；隔離埠 8125 實測——列表內點安裝晶片保持開啟、點熔爐大圖等外部即收起；彈窗僅剩黃色標語（18px/700）＋楬色補充兩段；主控台 0 錯誤。

## 變更紀錄：熔爐合併——新熔爐取代舊生產線（正式版，全服開放）

- **舊版熔爐系統關閉**：`#tab-factory`（輸送帶/篩選節點/分解槽/合成節點標記）整段移除，新熔爐頁籤改為正式「🏭 熔爐」頁籤；「附魔書庫存」「強化節點」兩面板搬入熔爐分頁保留。本地服限定解除（`newForgeHostAvailable` 移除），全服一體適用。
- **界面調整**：移除「導入新獲得的裝備」開關（`pushConveyor` 一律導入熔爐佇列，滿載丟棄）；佇列顯示完整數字（`fmtFull`，不簡寫）；移除「佇列退回舊輸送帶」按鈕；說明文字重寫；頂部新增「更強自動換裝」開關（原篩選節點功能，存於 `G.factory.autoEquip`）；`flog` 統一寫入熔爐紀錄。
- **拆解改回舊版規則**：專屬材料系統（15 種礦石、產出表、craft/smelt 配方、`forgeMats`、GM `nfmat`）全數刪除；入爐拆解改走 `doSalvage`（碎片/金幣/附魔精華/太古精華＋零件事件），`doSalvage(it, silent, bonus)` 新增零件加成來源參數——**全部 10 種分解零件以「該熔爐零件格」快照生效**；手動一鍵分解為無零件加成的基礎產出。
- **零件格上限 6 → 8**（`NEW_FORGE_PART_SLOTS_MAX=8`），解鎖公式不變。
- **存檔遷移**（`migrateSave`/`sanitizeNewForge`）：舊輸送帶滯留裝備自動併入熔爐佇列（不遺失）、舊分解槽零件安裝解除（零件釋回零件庫）、`intake`/`forgeMats` 欄位移除；合併前存檔（`noticeShown` 欄位不存在，於 mergeDefaults 前偵測）→ 載入後彈出改版公告 `#forge-rebuild-modal`（確認後不再顯示）＋熔爐頁籤 `.nf-glow` 高亮閃爍（切到該頁即消失）；新局不彈窗。
- 測試：tests/new-forge.test.cjs 全面改版（22 測試：全服導入/滿載丟棄、doSalvage 整合＋爐零件加成翻倍驗證、8 格解鎖、合併遷移＋公告旗標三態、V1/V2 相容、接線檢查）；factory-parts/synthesis-disabled 同步改版。offline-rewards/save-compression 等未載入 newforge 的測試由 `pushConveyor` 舊路徑後備維持不變。
- 驗證：build 109 檔過；全套 314＝295 過/19 失敗（皆為既有基線，無新增）；隔離埠 8125 實測合併前舊存檔——公告彈窗＋頁籤閃爍→確認→切頁閃爍消失、F5 不重彈；佇列顯示「1,500」完整數字；零件格 8 格（連續解鎖至 8、第 9 次拒絕）；拆解紀錄「⚒️ 分解 [史詩] … → 碎片x58」走舊規則；附魔書庫存/強化節點面板正常；主控台 0 錯誤。

## 變更紀錄：恢復普通敵人傷害詞條與太古數值

- `normalDmg` 新生成詞條由 `base=0.3/lv=0.035` 修正為 `base=3/lv=0.035`；只恢復基礎值 10 倍，避免 500 級成長被放大約 95 倍。
- 新增 V2/V3/V4 單次遷移：回復歷史低值、修復未帶標記的低值，並將先前錯誤放大的既有詞條除回 10，均不重複套用。
- 太古普通敵人傷害詞條沿用同一基準，套用既有太古倍率 `1.2 × 1.35`；非太古值約為太古值除以 `1.35`。
- 同步更新 `config/CSV/game_parameters.csv`、`game_formula.md` 與測試。

## 變更紀錄：修正帶尾 +N 只有第一座熔爐有數字

- 問題：`newForgePendingCounts` 採「第一座符合者獨佔歸屬」——多座熔爐品質設定相同時，佇列全數算給 1 號爐，其餘熔爐帶尾恆為空。
- 修正（js/newforge.js）：改為**各爐獨立計數**——熔爐啟用且勾選該品質即計入（同一件可同時計入多爐，語意＝「排隊等著能進此爐的件數」）；停用熔爐不計；全部熔爐達 999 顯示上限時提前結束掃描。
- 測試：tests/new-forge.test.cjs 計數測試改版（同品質多爐各自計數、停用不計），19/19 過。
- 驗證：build 109 檔過；隔離埠 8125 重現回報情境——3 座同設定熔爐＋1,500 件佇列 → 三爐帶尾皆 +999；改 2 號爐只收神話（佇列無神話）→ 該爐留空、其餘 +999；主控台 0 錯誤。

## 變更紀錄：帶尾 +N 改為固定預留空間（版面不隨數字變動）

- 需求：帶尾固定留出顯示 +999 的空間，數字出現/消失/增減都不變動版面。
- **js/ui.js**：+N 自帶內容流移出，改為帶尾獨立固定區 `.nf-belt-more`（`data-nf-more`，恆存在）；`nfUpdateBelts` 定點更新其文字（空/+N/+999）與 tooltip（精確件數）；`nfBeltChipsHTML` 回歸純批次圖示。
- **css/style.css**：`.nf-belt-more` 固定 44px（flex-basis/width/min-width 三重鎖定、靠右對齊）。
- 驗證：build 109 檔過；專屬測試 19/19；隔離埠 8125 實測——空/+9/+999 三態量測寬度恆 44px、帶區右緣零位移、tooltip 顯示精確 1,500 件、主控台 0 錯誤。

## 變更紀錄：新熔爐帶尾改「+N 待進帶數量」（移除「← 由右至左」文字）

- 需求：帶列不寫「由右至左」，改顯示尚未進輸送帶的數量（同原版輸送帶溢出樣式），每條最多顯示 +999。
- **js/newforge.js**：`newForgePendingCounts()`——單次掃描佇列，依路由規則（第一座啟用且勾選該品質的熔爐）把待處理件數歸屬到各熔爐；上鎖/神鑄創世/未勾品質不計。
- **js/ui.js**：帶列移除「← 由右至左」；`nfBeltChipsHTML(fu, pending)` 帶尾加 `.conv-more` 樣式的 +N（>999 顯示 +999，tooltip 顯示精確件數）；`nfUpdateBelts` 每輪共用一次計數、定點更新。
- **css**：移除未使用的 `.nf-belt-dir`。
- 測試：tests/new-forge.test.cjs +1（計數歸屬/排除規則/同品質歸第一座）＋靜態斷言（ui.js 無「由右至左」、含 newForgePendingCounts 與 999 上限），共 19 測試。
- 驗證：build 109 檔過；專屬測試 19/19；全套 308＝289 過/19 失敗（既有基線）；隔離埠 8125 實測——佇列 1,200 件時帶尾顯示 +999（tooltip「尚未進入輸送帶的裝備：1,200 件」）、佇列清空後 +N 即時消失、帶 30 件照常顯示、主控台 0 錯誤。

## 變更紀錄：新熔爐零件改「完全自由裝配」（取消各類型裝配數量限制）

- 需求：取消各類型零件的裝配數量限制——每個熔爐的零件完全自由裝配、不限數量（僅零件格數為上限）。
- **設計改為快照式**：依「類型」裝配，取玩家持有的該類型最高階零件、複製數值快照 `{key,tier,val,name}` 進零件格——**不佔用、不消耗**零件庫存；同類型可重複裝滿整爐、多座熔爐可共用同一批零件。
- **js/newforge.js**：`newForgeInstallPart(furnaceId, partKey)` 改依類型裝快照（`newForgeBestOwnedPart` 取最高階；檢查僅剩：格數/分解槽類型/是否持有）；`newForgeUninstallPart` 改依格位索引（快照直接丟棄，無需歸還）；`newForgeFurnaceSpeed` 直接讀快照堆疊；移除 `newForgePartInstalled`。sanitize：舊實例制 id 陣列→查零件池轉快照（失效剔除）、壞快照剔除、超量截斷。
- **js/factory.js**：還原 `isInstalled` 為原版（快照不佔用實例，掛勾不再需要；舊熔爐回到零改動狀態）。
- **js/ui.js**：零件列表改列出全部持有類型（不再過濾已安裝）、tip 改「同類型可重複裝配、不佔用零件庫」；晶片點擊改傳類型 key；卸下改傳格位索引。
- 邊界：快照為裝配當下數值——之後撿到更高階零件不會自動升級，重新點擊裝配即可換成新最高階。
- 測試：tests/new-forge.test.cjs 零件三測改版（同型重複裝滿/不佔用池/isInstalled 全 false/未持有類型拒絕/依索引卸下、快照堆疊速度、舊 id→快照遷移與壞項清理）；factory.js 靜態斷言改「掛勾必須移除」。
- 驗證：build 109 檔過；專屬測試 18/18；全套 307＝288 過/19 失敗（既有基線）；隔離埠 8125 實測——舊實例制存檔 3 件已裝零件自動轉快照（duplicator/scrapForge/ancientEssenceRate）、連點裝滿、零件池 14→14 不變、isInstalled 無殘留佔用、滿格警告、索引卸下、主控台 0 錯誤。

## 變更紀錄：新熔爐 UI 微調——零件格純圖示＋傳送帶容量/顯示加大

- 需求：①已裝零件只顯示正方形小 icon（不顯示全稱，完整說明保留在 tooltip）；②輸送帶裝備更多、帶滿時整條約 8 成滿。
- **js/data.js**：`NEW_FORGE_BELT_CAP` 10→**30**（在途件數 ×3）；新增 `NEW_FORGE_BELT_SHOW = 30`（顯示上限＝容量全顯，超出防禦性顯示 +N）。
- **js/ui.js**：已裝零件格改 `nf-part-ico` 正方形（34×34、僅 partIconHTML 圖示）；帶顯示 slice 改用 `NEW_FORGE_BELT_SHOW`。
- **css/style.css**：帶晶片縮至 20px/字 11px/間距 2px（30 件 ≈ 658px，以常見遊戲視窗帶區 ~760px 計約 87% ≈ 8 成滿）；`.nf-part-ico` 方格樣式。
- 驗證：build 109 檔過；專屬測試 18/18（BELT_CAP=30/BELT_SHOW=30/nf-part-ico/slice 常數斷言）；全套 307＝288 過/19 失敗（既有基線）；隔離埠 8125 實測——帶滿 30 件全顯、量測 658px（760px 帶區 87%）、已裝零件 34×34 純圖示零文字、主控台 0 錯誤。

## 變更紀錄：新熔爐零件安裝——點擊零件格開啟列表、連續安裝（與原零件操作相同）

- 需求：點擊零件格按鈕 → 零件列表出現在該熔爐下方；可連續點擊一次裝滿 6 格；操作與舊分解槽零件相同。
- **js/newforge.js**：`newForgePartInstalled`（掃描各熔爐已裝 id）、`newForgeInstallPart`（驗證：分解槽零件限定/未重複安裝/格數未滿）、`newForgeUninstallPart`、`newForgeFurnaceSpeed`（加速齒輪＝入爐速度倍率，計算同舊分解槽 speedUp）；tick 套用速度倍率；sanitize 補零件 id 清理（不存在於池/與舊節點或他爐重複/超過格數者剔除）。
- **js/factory.js**：`isInstalled` 加 3 行掛勾——新熔爐已裝者視同已安裝（防舊分解槽重複安裝；`trimFactoryParts` 收斂時保留；newforge.js 未載入時維持原行為）。共用同一零件池 `G.factory.parts`。
- **js/ui.js**：零件格三態——已裝＝零件晶片（點擊卸下）/空格＝零件N（點擊開關列表）/🔒解鎖；`nfPartsListHTML` 零件選擇列表（熔爐卡下方、依種類分組顯示最高階＋數量、點擊安裝最高階者到第一個空格、列表保持開啟可連裝、收起按鈕）；點擊委派補 span 晶片分支。
- **css/style.css**：+.nf-part-filled/.nf-parts-list（虛線框）。
- 零件效果：目前僅「加速齒輪」對新熔爐生效（入爐速度）；其他分解槽零件（碎片熔煉爐/淘金濾網/精粹透鏡等產量類效果對應舊產出物）待企劃定義後接上，UI 已註明。
- 測試：tests/new-forge.test.cjs +3（安裝/容量/類型/重複拒絕與 isInstalled 掛勾、加速齒輪倍率與收斂保護、sanitize 零件清理），共 18 測試。
- 驗證：`npm run build` 109 檔過；專屬測試 18/18；全套 307＝288 過/19 失敗（皆為使用者並行在途基線）；隔離埠 8125 實測——點空格開列表（7 組晶片）、連續點擊裝滿、列表保持開啟、已裝格顯示晶片可點卸、加速齒輪速度 1.75×生效、舊工廠 isInstalled 認得新熔爐已裝零件、主控台 0 錯誤。

## 變更紀錄：新熔爐 V3——品質勾選路由＋轉生熔爐數＋零件格（依企劃圖1/圖2）

- 需求：①界面只保留圖1功能（熔爐卡=左大圖＋單一傳送帶＋品質設定/啟用＋帶視覺＋零件格），多傳送帶/篩選器下拉/鍛造裝備/熔煉礦石/符文魔法熔爐/等級條件/分解保留下拉全部刪除；②品質設定＝圖2 勾選清單（勾選品質自動入帶拆解、未勾＝保留）；③熔爐數=轉生連動（0轉2座、每轉+1、上限12）；④零件格每爐初始3格、金幣逐格解鎖至6格；⑤大圖統一 furnace_LV1.png。
- **js/data.js**：V3 常數——`NEW_FORGE_MAX=12`、`NEW_FORGE_BASE_FURNACES=2`、`NEW_FORGE_FURNACE_PER_REINC=1`、`NEW_FORGE_PART_SLOTS_INITIAL=3/MAX=6`、`NEW_FORGE_SLOT_COST_REINC=50000/BASE=10000/EXP=4`、`NEW_FORGE_IMAGE`、`NEW_FORGE_ROUTE_PER_TICK=5`；刪 FILTERS/IMAGES/LINES_MAX/LINE_LOAD_PER_TICK/TYPES；CRAFT/SMELT 配方表保留僅供遷移退款（註記勿刪）。
- **js/formula.js**：`newForgeMaxFurnaces(轉生)=clamp(2+轉生,2,12)`；`newForgePartSlotCost(轉生,已解鎖,熔爐數)=50000×轉生²+10000×(已解鎖-1)^(4+熔爐數)`。
- **js/player.js**：熔爐改 `{id,enabled,qualities[9],belt[],timer,partSlots,parts[]}`（qualities 預設普通~傳說勾選、神鑄創世恆 false；belt 為純裝備陣列）。
- **js/newforge.js（重寫）**：全域路由 `newForgeRouteQueue`（每 2 秒一輪、每輪 ≤5×熔爐數件，FIFO：勾選品質→第一座啟用且帶未滿熔爐上帶；未勾/上鎖/神鑄創世→保留入包；勾選但帶滿→留佇列等待）；每爐 `newForgeConsumeOne` 每 2 秒拆解帶頭 1 件；`unlockNewForgePartSlot` 金幣解鎖零件格；移除熔爐/轉生上限裁減時帶上裝備退回。sanitizeNewForge 含 **V1（mode）/V2（lines）→V3 一次性形狀遷移**（品質承接拆解線 actions、帶上裝備回佇列重路由、craft/smelt 在途材料退款）＋V3 淨化（qualities 布林化與 idx8 鎖定、partSlots 夾 3~6、壞帶項剔除、熔爐超額裁減）。本地服限定閘門與外服歸還維持。零件效果企劃未定義→僅實作格位與解鎖。
- **js/ui.js（nf 區重寫）**：熔爐卡＝左 furnace_LV1 大圖＋右「傳送帶（⚙品質設定→圖2 勾選面板/啟用）＋分解摘要＋帶視覺＋零件格列（已解鎖空格/下一格🔒顯示金幣成本可點擊/其餘🔒）」；添加熔爐改單一按鈕（顯示 n/轉生上限）；焦點防衛與帶定點更新機制沿用。
- **css/style.css**：+.nf-qual-panel/.nf-qual-row/.nf-parts-row/.nf-part-slot；清除 V2 過時樣式（nf-line-cfg/nf-cond-lv/nf-cost-* 等 7 塊）。
- 文件：game_formula.md §12 改寫為 V3（品質路由/拆解產出/零件格三小節）。
- 測試：tests/new-forge.test.cjs 改版（15 測試：V3 常數與大圖存在、熔爐數公式、零件格成本公式（640,000/7,290,000 對照）、品質路由（勾選/未勾/上鎖/神鑄創世/帶滿等待/多爐分派/停用跳過）、入爐拆解與寶石取回、轉生上限增刪、零件格解鎖含金幣不足、V2→V3 遷移（品質承接/帶回佇列/材料退款/超額裁減）、V3 淨化、外服三閘與歸還、接線靜態檢查）。
- 多代理對抗式審查（路由資源安全＋遷移UI 兩維度）：1 發現經對抗驗證否決，0 確認缺陷。
- 驗證：`npm run build` 109 檔過；專屬測試 15/15；全套 304＝285 過/19 失敗（皆為既有基線與使用者並行在途工作，與本次無關）；隔離埠 8125 全新存檔實測——頁籤顯示、furnace_LV1 大圖載入（naturalWidth=2016）、圖2 品質面板 8 勾選格切換、0轉第2座熔爐成功/第3座正確拒絕（提示轉生規則）、零件格解鎖 640,000 金幣正確扣款（格數 3→4、鎖格顯示下一格成本）、品質路由鏈（未勾→保留入包、勾選→上帶→入爐產爐渣）、無篩選器/多帶殘留 UI、主控台 0 錯誤。

## 變更紀錄：控場效果隨戰鬥時間遞減（普通 1%/秒、菁英 3%/秒、BOSS 免疫不變）

- 需求：影響敵人攻擊頻率的控制（暈眩/減速/攻速類減益）隨「該敵人存活時間」遞減——普通敵人每秒 −1%（8 秒暈眩在戰鬥 50 秒時施放 → 4 秒；100 秒後完全無效）、菁英每秒 −3%（約 33 秒歸零）、BOSS 維持既有完全免疫；玩家受控不遞減。
- **`js/formula.js` §3**：新增 `CONTROL_DECAY_PER_SEC_NORMAL=1`、`CONTROL_DECAY_PER_SEC_ELITE=3` 與 `controlDurationFactor(ent) = max(0, 1 − (GT − ent._spawnAt) × 每秒遞減%/100)`（無 `_spawnAt` 的實體＝玩家 → 1）。
- **`js/combat.js`**：`spawnFieldMonster` 敵人加 `_spawnAt: GT`；`applyEffect`/`applyBuff` 對 `isAttackFrequencyControlKey`（stun/slow/aspdDown/attackSpeedDown）統一乘遞減倍率、歸零回傳 false——技能暈眩/減速、冰元素特效、暈眩被動、攻速類減益所有來源自動生效；成功時回傳「實際持續秒數」供顯示（原回傳 true）。暈眩被動 log 依實際結果顯示。
- **`js/formula.js` resolveHit**：冰元素減速 proc 改依 applyEffect 實際結果顯示（歸零/免疫不再誤報「減速」）。
- **`js/skills.js`**：castSkill 暈眩顯示實際秒數（fmt1），遞減歸零顯示「暈眩無效（控場遞減）」；減速同理。
- 文件：`game_formula.md` §3.4 新增控場遞減規則。
- **參數表**（追加）：「3-戰鬥核心／控場遞減」列（a=普通每秒遞減%＝1、b=菁英每秒遞減%＝3）寫入 CSV＋xlsx（xlsx 補丁以「系統分類＋名稱」定位插入點、冪等，保留使用者 Excel 中的並行改動；等待 Excel 關檔釋放鎖後執行，round-trip 驗證通過、編號連續）；`apply_params.cjs` 接上 `CONTROL_DECAY_PER_SEC_NORMAL/ELITE` 兩錨點（dry-run 698 錨點 0 問題）。※ 使用者調整中的「表-詞條池/對普通敵人傷害%」列 CSV 較 xlsx 新（b=0.035 與說明），維持不動、已回報。
- 測試：新增 `tests/control-decay.test.cjs`（8 測試，含參數表與錨點同步檢查：倍率曲線與 clamp、使用者範例 8→4 秒與 100 秒歸零、菁英 3.2 秒、applyBuff 攻速類遞減／非控制類與玩家不受影響、BOSS 免疫與非控制鍵不受影響、冰緩 proc 依實際結果、_spawnAt 接線）；`boss-control-immunity` 回傳值斷言同步（true → 實際秒數）；`offline-rewards` 上限測試改由 OFFLINE_MAX_HOURS 導出（使用者已調 24h，不再寫死）。
- 驗證：`npm run build` 107 檔過；控場遞減 7/7；全套 310＝294 過（16 個既有基線＋使用者並行在途的敵種傷害數值測試，無本次回歸）；隔離埠 8124 實測——普通怪 50 秒 8→4 秒、菁英 20 秒 8→3.2 秒、100 秒 false、BOSS false、攻速減益 6→3 秒、實戰怪物 `_spawnAt` 正常計時，主控台 0 錯誤。

## 變更紀錄：5 轉昇華天賦作用範圍補全（增益/減益/再生/詛咒/資源類＋融合技）

- 背景：五個昇華天賦（武技/法術/守護/奇策/被動）原本只作用於技能「直接傷害、治療、護盾、被動數值」；增益 buff、減益 debuff、持續再生 hot、死亡詛咒、金幣（點金手）、法力回復皆未吃倍率，且融合技（cat='fusion'）整類被排除——守護昇華 10 技中 4 個完全無效、奇策昇華 10 技中 6 個完全無效。
- **`js/skills.js`**：新增 `skillEffectTalentMultiplier(sk)`——一般類別直通 `talentSkillEffectMultiplier(sk.cat)`；**融合技 = 素材技能類別倍率的平均**（依 `components` 查素材現行定義；舊快照無素材記錄＝1）。`castSkill` 開頭統一計算 `fxMult` 並套用至：傷害基值（原有）、`goldPer`、`maxHpDotPct`（傷害/非傷害兩分支，維持 matk×6 上限後乘算）、`healPctMax`、`hotPct`、`shieldPctMax`、`mpRestore`（四捨五入）、`buff/buff2`、`applySkillDebuffs`（新增 mult 參數）。浮字與戰鬥日誌顯示同步套用倍率（`showPlayerBuffFloat`/`skillBuffDisplayValue` 增加 mult 參數）；技能面板說明維持顯示基礎值。
- 文件：`game_formula.md` §10 新增昇華天賦公式與作用範圍完整說明。
- 測試：新增 `tests/skill-talent-multiplier.test.cjs`（6 測試：增益（特殊/防禦）、減益、持續再生、死亡詛咒、法力回復＋金幣、融合技平均與舊快照=1）；`tests/player-event-float.test.cjs` 靜態簽名斷言同步新參數。
- 驗證：`npm run build` 106 檔過；技能/天賦相關測試 40/40；全套 302＝285 過（16 個失敗皆既有基線，無新增回歸）；隔離埠 8124 實測——奇策昇華 Lv.100 → ×2.5、5 轉全滿 ×2 → ×4、融合技（物理＋魔法素材）全滿平均 ×4、無素材快照 ×1，主控台 0 錯誤。

## 變更紀錄：菁英掉落倍率以程式值 1.3 為準（測試與文件對齊）

- 背景：程式實際值 1.3（現為 `ELITE_DROP_MULT`，參數表「野外菁英掉落倍率」列），但舊測試與文件仍寫 1.5，`elite-drop-multiplier` 測試長期失敗。使用者確認以程式 1.3 為準。
- **`tests/elite-drop-multiplier.test.cjs`**：期望值改由 `ELITE_DROP_MULT` 導出（裝備/寶石/附魔書/零件費率皆 ×倍率），並鎖定現值 1.3；測試名稱同步。
- 文件：`game_formula.md` §5 三處「菁英再 ×1.5」改為引用 `ELITE_DROP_MULT`（目前 1.3）。
- 驗證：`npm run build` 105 檔過；該測試由紅轉綠（全套既有失敗 −1）。

## 變更紀錄：離線收益改造——固定速率獵殺菁英怪＋逐殺掉落＋上線確認彈窗

- 需求：①計算基準＝「目前地圖最高階段 −10 再捨去個位數（下限 1）」等級的當前場景**菁英怪**（例：沼澤 256 → 240 級沼澤菁英）；②擊殺速率固定每 20 秒 1 隻（廢除 DPS 估算）；③每一隻菁英怪掉落**單獨擲骰**；④參數表 10-離線段清理＋新增參數；⑤上線彈出離線收益確認界面（經驗/金幣/擊殺數/掉落明細，裝備＝品質×數量）。
- **`js/formula.js` §10**：改為 `OFFLINE_MAX_HOURS=8`（保留）、`OFFLINE_LEVEL_REDUCE=10`、`OFFLINE_KILL_INTERVAL=20`＋`offlineStageFor(best)`／`offlineKillCount(elapsed, 離線預言%)`；刪除 `OFFLINE_EFFICIENCY`/`OFFLINE_MAX_KILLS`/`offlineKillEstimate`（8h÷20s 自然上限 1440 殺）。菁英掉落倍率抽出常數 `ELITE_DROP_MULT=1.3`（§5，`rollFieldDrops` 與離線共用 SSOT；combat.js 同步引用）。
- **`js/save.js`**：`applyOfflineProgress` 重寫——菁英怪 `monsterStatsFor(計算等級, true)`、金幣/經驗＝單殺值（×場景倍率×加成）×擊殺數；逐殺迴圈與野外同一套表與倍率單獨擲骰：裝備各品質獨立擲骰→`pushConveyor`（新熔爐開啟時自動走佇列；滿載折算碎片不丟失）、寶石 `addGem`、附魔書（階段 8+）、太古精華（250+）、魔塵（150+）、零件（階段 5+，`trimFactoryParts` 收斂）；彙整 summary 回傳並呼叫 `showOfflineSummary`（typeof 防衛）＋保留 blog 紀錄。潛力「離線預言」改乘在擊殺數。
- **`index.html`／`js/ui.js`／`css/style.css`**：新增 `#offline-modal` 確認彈窗（`showOfflineSummary`/`closeOfflineSummary`＋確認鈕/遮罩/X 關閉綁定；`.offline-sum-*` 樣式）；收益於計算時即入帳，彈窗為確認展示。
- **參數表**（CSV＋xlsx 同步，全表重編號 460→457 列）：10-離線段刪除「期望暴擊倍率/估算 DPS/單殺耗時/擊殺數/裝備收益」5 列，新增「計算等級（a=10）」「擊殺速率（a=20）」2 列；xlsx 以純 Node ZIP 補丁（sheet2 增刪列＋A 欄重建單段共用鏈、sheet1 同列鏡像修補＋A 快取校正、刪 calcChain＋fullCalcOnLoad），round-trip 驗證與新 CSV 100% 一致。`tools/apply_params.cjs` 錨點同步：刪 OFFLINE_EFFICIENCY/OFFLINE_MAX_KILLS、增 OFFLINE_LEVEL_REDUCE/OFFLINE_KILL_INTERVAL、「野外菁英掉落倍率」改錨 `ELITE_DROP_MULT`（dry-run 696 錨點 0 問題）；`tools/xlsx_annotate.cjs` 移除已刪列的註記引用。
- 文件：`game_formula.md` §11 全面改寫＋§5 零件列「離線不掉零件」修正。
- 測試：新增 `tests/offline-rewards.test.cjs`（7 測試：計算等級捨十位含 256→240 範例、每 20 秒擊殺＋離線預言加成、逐殺結算金幣/經驗/裝備計數、上線時經驗/金幣/掉寶加成套用驗證、8h 上限與 1 分鐘門檻、彈窗接線、參數表與錨點同步檢查）。
- 驗證：`npm run build` 105 檔過；專屬測試 6/6；全套 291＝272 過（17 個失敗與前次同名，皆為既有基線與使用者並行在途項目，無新增回歸；其中 `elite-drop-multiplier` 期望 1.5 vs 程式 1.3 為使用者調參中的既有差異，重構後行為不變）；隔離埠 8124 實測——沙盒模擬離線 2 小時：擊殺 Lv.240 沼澤菁英 ×360、金幣/經驗入帳一致、裝備 237/184/149/53/25/12（逐殺隨機分佈）、寶石/附魔書/魔塵/零件各自擲骰、彈窗完整顯示「離線 2 小時…傳說裝備×12…」、主控台 0 錯誤。

## 變更紀錄：傷害偏折效果減半＋物防/魔防天賦改獨立乘區（並修復魔防天賦無作用）

- 需求：①傷害偏折乘算改版後太強 → 每級數值減半；②物防鍛體/魔防鍛體的 +1% 應為「額外的加成」（與裝備物防%連乘的獨立乘區），不是加在原本加成上。
- 調查發現：**魔防鍛體（1 轉）與魔鎧共鳴（4 轉）原本完全無作用**——`computeStats` 只讀 `talent.defPct`（且併入物防%桶、連帶加到魔防），從未讀 `talent.mdefPct`。
- **`js/data.js`**：傷害偏折（t2_global）與絕對偏折（t4_global）`low: 1→0.5`、`high: 2→1`（滿級 75%、全滿 ×2 → 150%；例：裝備 214k → ×2.5 = 535k）。
- **`js/formula.js`**：移除 `A.defPct += talent.defPct`；物防/魔防派生各自新增獨立乘區——`物防 = (基礎+定值) × (1+物防%) × (1+天賦物防%)`、`魔防 = (基礎+定值) × (1+物防%共用) × (1+天賦魔防%)`；1/4 轉同屬性天賦百分比相加後乘算，物/魔分開、魔防天賦自此生效。
- **`js/ui.js`**：`talentEffectLabel` 一般分支改保留至多 2 位小數（傷害偏折每級 0.5% 原會被 `fmt` 捨成 0%）。
- 文件：`game_formula.md` §2 物防/魔防公式補天賦乘區、§10 兩則天賦說明更新數值與乘區語意。
- 測試：`tests/talents.test.cjs` 乘算測試改減半期望值（×1.75/×2.5/×2.75）＋新增防禦乘區測試（裝備×2 連乘天賦 ×1.1/×1.2、物魔分開、1+4 轉相加後乘算）＋傷害偏折 0.5% 顯示測試。
- 驗證：`npm run build` 104 檔過；天賦/全局減傷/附傷測試 28/28；全套 283＝266 過/17 失敗（同前基線，無新增）；隔離埠 8124 實測——214k＋2 轉全滿 → 535k（×2.5）；天賦開關比值 def ×1.102、mdef ×1.199（≈1.1/1.2，含四捨五入誤差）；標籤顯示「全局減傷額外提高0.5%」；主控台 0 錯誤。

## 變更紀錄：傷害偏折/絕對偏折改為乘算（全局減傷額外提高%）

- 需求：天賦文字「全局減傷額外提高300%」應為乘算——裝備全局減傷 214k → ×4 = 856k；舊實作是加定值 300，在高基數下完全無感（面板 fmt 顯示不變、實際減傷率只動小數第四位）。
- **`js/formula.js`**：`computeStats` 移除 `A.globalDmgRed += talent.globalDmgRed` 定值加總，改於派生段 `st.globalDmgRed = A.globalDmgRed × (1 + 天賦%/100)`。「傷害偏折」（2 轉）與「絕對偏折」（4 轉）同一屬性、百分比相加後乘算；沒有其他全局減傷來源時天賦不再憑空提供定值（低裝等時舊定值 +300 等於單獨 75% 減傷的行為消失，屬語意修正的預期結果）。
- 文件：`game_formula.md` §2 全局減傷列＋§10 天賦補乘算說明。
- 測試：`tests/talents.test.cjs` 新增乘算測試（裝備 1000＋傷害偏折 Lv.100 = ×2.5、2 轉全滿 = ×4、疊加絕對偏折 Lv.50 = ×4.5、無來源時為 0）。
- 驗證：`npm run build` 104 檔過；天賦＋全局減傷＋附傷測試 26/26；全套 281＝264 過/17 失敗（16 個同前基線＋新增 1 個為使用者並行在途的 `stage-jump-ui.test.cjs` 階段按鈕 data-tip 檢查，與本次無關）；隔離埠 8124 實測——模擬裝備 214k：無天賦 214k/99.9533%、2 轉全滿 856k（面板顯示 856k）/99.9883%，恰為 ×4，主控台 0 錯誤。

## 變更紀錄：2 轉元素天賦數值調整（每級 1%/2% → 0.25%/0.5%）

- 需求：依使用者企劃表，六個元素附傷天賦改為 Lv.1～50 每級 0.25%、Lv.51～100 每級 0.5%（滿級 37.5%、該轉全滿 ×2 → 75%）；第 7/8 節點（萬象抗性/傷害偏折）維持 1%/2% 不變。
- **`js/data.js`**：`TALENT_TREES[2]` 六個元素節點 `low: 1→0.25`、`high: 2→0.5`。
- **`js/ui.js`**：`talentEffectLabel` 元素天賦數值顯示改保留至多 2 位小數（原 `fmt()` 會捨去小數，0.25% 會顯示成 0%）。
- 文件：`game_formula.md` §10 補上六節點每級數值。
- 測試：`tests/talents.test.cjs` 補 low/high 與 Lv.50/100 累計值斷言、0.25%/12.5% 顯示斷言；`tests/talent-elem-attach.test.cjs` 期望值同步（10 級 = 2.5%、元素核心 ×1.1 = 2.75%）。
- 驗證：`npm run build` 104 檔過；天賦相關測試 20/20；全套 279＝263 過/16 失敗（15 個既有基線＋1 個為使用者並行在途的 `boss-display-state.test.cjs`——其 regex 以 LF 換行比對 CRLF 的 ui.js 高塔倒數區塊，與本次無關）；隔離埠 8124 實測——Lv.1 顯示「攻擊時額外附加0.25%火焰傷害」、Lv.50=12.5%、Lv.100=37.5%、全滿 ×2=75%，主控台 0 錯誤。

## 變更紀錄：2 轉元素天賦附傷改為「按當次傷害百分比」

- 需求：2 轉前六個天賦（烈焰/寒霜/雷霆/毒脈/聖輝/暗影共鳴）應為「攻擊時附加當次傷害 × 天賦% 的元素傷害」（1% 火附傷、當次傷害 10000 → 額外 100 火傷；六系並存各自附加）。舊實作是「面板物攻 × 天賦%」換算固定元素攻擊力——不吃當次傷害（防禦/暴擊/浮動/攻擊 buff 均不影響）、只算物攻不含魔攻、且只作用於普攻。
- **`js/formula.js`**：①`computeStats`——天賦六系%不再灌進固定值 `st.elemAtk`（該欄回歸純裝備附魔），改派生 `st.elemDmgPct[六系] = 天賦%（含全滿 ×2）× (1 + 元素核心%)`；潛力「元素核心」修正為說明寫的乘算提高（同時放大固定值附傷與附傷%），不再對未點元素憑空附加 `物攻 × 2%/級` 固定值。②`resolveHit`——aCfg 新增 `elemDmgPct`，元素附加段每系元素值 = `固定值元素攻擊 + 附傷基底 × 附傷%/100`，附傷基底＝元素附加前的當次傷害（防禦減傷/物魔抗性/±10% 浮動/暴擊之後），其後沿用既有流程（對應元素抗性減免＋元素特效觸發）。怪物/高塔 BOSS 的固定值附傷路徑不受影響。
- **`js/combat.js`／`js/skills.js`**：`playerAtkCfg`（普攻）與 `castSkill` 直接傷害段 aCfg 皆傳入 `elemDmgPct: st.elemDmgPct`——天賦附傷同時作用於普攻與技能攻擊（真實傷害技能走直接扣血路徑，維持不附加）。
- 文件：`game_formula.md` §2 衍生表（元素攻擊/新增元素附傷%）、§3.2 步驟 5、§10 天賦與潛力同步改寫。
- 測試：新增 `tests/talent-elem-attach.test.cjs`（8 測試：附傷=當次傷害×%、跟隨防禦減傷與暴擊縮放、六系並存各吃對應抗性＋暗影汲取、與固定值附傷疊加、computeStats 派生、元素核心乘算與不憑空附傷、普攻/技能接線靜態檢查）。
- 驗證：`npm run build` 104 檔過；專屬測試 8/8；全套 278＝263 過/15 失敗（皆為既有基線：UI 註冊/命中率/掉落表/寶石/存檔資料夾/XP 曲線，與本次無關；元素抗性與戰鬥相關測試全過）；隔離埠 8124 實測——頁面正常載入、主控台 0 錯誤、主迴圈運轉；`resolveHit` 合成實體驗證（100% 附傷 → 傷害 ×2、火抗 50% → 附傷減半）與沙盒 G 天賦派生鏈（t2_fire Lv.60=70%、元素核心 5 級 → 77%，未點元素 0）皆符合預期。

## 變更紀錄：新熔爐改為本地服限定（外服沿用舊熔爐、裝備引導切回舊輸送帶）

- 需求：新熔爐只在本地服開放；外服維持舊版熔爐並把裝備引導切回舊輸送帶，確保外部正常運行。
- **`js/newforge.js`**：新增 `newForgeHostAvailable()`（同 GM 指令安全邊界：只認 hostname `localhost / 127.0.0.1 / ::1`，不依賴可被覆寫的前端旗標）＋三道閘——①`newForgeTryIntake` 外服一律回 false（新掉落走 `pushConveyor` 舊路徑）；②`newForgeTick` 外服直接 return（傳送帶全停）；③`sanitizeNewForge` 末端外服歸還——滯留佇列與各傳送帶在途**裝備**推回舊輸送帶（`data.factory.conveyor`）、在途**材料批次**（鍛造/熔煉已扣資源）退回 `forgeMats`；熔爐配置/材料庫存/統計保留於存檔，回本地服自動恢復。
- **`index.html`／`js/ui.js`**：新熔爐頁籤按鈕預設 `display:none`，`initUI` 於本地服顯示（仿神鑄頁籤顯隱模式）。
- 文件：`game_formula.md` §12 標題與開頭補「本地服限定」說明（並校正子節編號 12.1~12.3）。
- 測試：`tests/new-forge.test.cjs` +4（本地/外部主機判定、外服 intake 拒收＋tick 停用、外服載入歸還（裝備進舊輸送帶/材料退回/配置保留）與本地服不歸還、頁籤顯隱接線），共 24 測試。
- 驗證：`npm run build` 101 檔過；專屬測試 24/24；全套 259＝239 過/20 失敗（17 個既有基線＋3 個為使用者並行在途的煉獄之塔/寶石九宮格測試，與本次無關）；隔離埠 8124 實測——本地服頁籤顯示、導入照常入新熔爐；console 模擬外服（覆寫判定函式）→ 頁籤隱藏、新裝備改進舊輸送帶、newForgeTick 不動作；還原本地服後全部恢復；主控台 0 錯誤。

## 變更紀錄：新熔爐 V2——熔爐大圖＋每爐最多三條傳送帶（企劃書：熔爐改造V2.xlsx）

- 需求：①熔爐卡片左方顯示熔爐大圖（Forging/Runes/Magic_Furnace.png）；②每爐最多 3 條傳送帶（生產線），設定篩選器後自動篩選相應原材料上帶、由右至左入爐（與原版輸送帶視覺一致）。
- **`js/data.js`**：新增 `NEW_FORGE_LINES_MAX=3`、`NEW_FORGE_BELT_CAP=10`（帶上在途批次上限）、`NEW_FORGE_LINE_LOAD_PER_TICK=5`、`NEW_FORGE_FILTERS`（各爐型篩選器：鍛造＝拆解/鍛造/熔煉；符文＝製作附魔卷軸/製作寶石、魔法＝製作裝備碎片/附魔精華/魔塵/太古精華，後兩爐企劃書未給配方→全部標 `wip` 僅顯示不可用）、`NEW_FORGE_IMAGES`；移除 `NEW_FORGE_MODES`。
- **`js/player.js`**：`newForgeDefaultLine(ftype, filterKey)`（拆解預設普通~傳說分解＋條件不限；craft.recipe/smelt.product/belt/timer/enabled）；熔爐改為 `{id, ftype, lines[]}`。
- **`js/newforge.js`（重寫）**：每線獨立計時，tick＝先入爐帶頭 1 批再裝載（**裝載時即扣資源**）——拆解線自佇列逐件判定（分解上帶、保留直接入包、帶滿放回佇列頭）；鍛造線材料＋佇列對應品質未上鎖裝備＋背包有空位才裝載，入爐產出品質+1（等級/部位同素材、寶石取回、直接入包）；熔煉線材料足夠自動扣料上帶、入爐產品+1。`newForgeLineRefund`：移除線/切篩選器/移除熔爐時在途批次全額退回（裝備→背包、材料→庫存）。`sanitizeNewForge` 含 **V1（furnace.mode 形狀）→V2（lines）一次性形狀遷移**（品質設定與熔煉產品搬移到線上、舊欄位清除）＋線/帶批次淨化。移除 V1 手動 `newForgeCraft`/`newForgeSmeltOnce`（由傳送帶自動化取代）。`newForgeAllQueuedItems(data)` 供存檔修正。
- **`js/save.js`**：fixSockets/fixName 改經 `newForgeAllQueuedItems`（佇列＋各帶在途裝備）。
- **`js/ui.js`（nf 區重寫）**：熔爐卡片＝左側大圖（`NEW_FORGE_IMAGES`）＋右側傳送帶清單；每線＝篩選器下拉（wip 選項 disabled）＋啟用勾選＋拆解「⚙ 品質設定」收合格（收合時顯示摘要）＋鍛造產物/熔煉產品下拉（皆 state 綁定 selected）＋帶視覺（爐口在左、`.conv-chip` 批次由右至左、+N 溢出）；「➕ 添加傳送帶 n/3」。事件委派改以 `data-nf-fid`＋`data-nf-li` 定位線。
- **`css/style.css`**：`.nf-*` 區塊改版（`.nf-furnace-body` 左右欄、`.nf-furnace-img`、`.nf-line`/`.nf-belt` 虛線帶槽、窄螢幕大圖上移）。
- 文件：`game_formula.md` §11 改寫為 V2 傳送帶模型；`index.html` 提示文案同步。
- 測試：`tests/new-forge.test.cjs` 改版（18 測試：V2 常數/篩選器/大圖、傳送帶增刪與退回、拆解線兩段式 tick、鍛造線裝載條件（材料/品質/上鎖/背包滿）、熔煉線自動上帶與停用、V1→V2 遷移、壞線淨化、接線與圖片存在檢查）。
- 多代理對抗式審查（3 維度 3 發現、2 確認）後修正：①帶批次視覺抽離熔爐清單快取字串——`nfLineHTML` 只輸出空的 `data-nf-belt` 容器、新增 `nfUpdateBelts` 每輪定點更新（批次流動不再每 2 秒擊穿快取整段重建）＋重建前焦點防衛（聚焦清單內 SELECT/INPUT 時延後重建，打字中的等級門檻與展開中的下拉不被銷毀）；②品質設定展開狀態鍵改用**穩定 line.id**（`newForgeDefaultLine` 產生 `uid()`、sanitize 補缺漏），移除傳送帶後不再錯位到別條線。
- 驗證：`npm run build` 97 檔過；專屬測試 20/20；全套 241＝224 過/17 失敗（既有基線）；隔離埠 8124 實測——V1 測試存檔自動遷移（craft 模式→鍛造線、rune→scroll、舊欄位清除、線補穩定 id）、三張大圖載入（naturalWidth>0）、拆解線持續運轉（實際掉落）、真實點擊添加傳送帶→切熔煉→自動扣料上帶（帶滿 10 批圖示）→入爐產出金錠、移除線退回在途材料（爐渣+20）、帶批次變動時清單節點不重建且帶圖示定點更新、主控台 0 錯誤。

## 變更紀錄：新熔爐（測試版）——主畫面新增「新熔爐」頁籤（企劃書：熔爐改造.xlsx）

- 需求：與舊熔爐（factory 生產線）**並行**的新熔爐測試系統；新獲得裝備導入新熔爐；舊機制零改動。
- **路由切換（無損搬移）**：`js/factory.js` `pushConveyor` 頂端 3 行掛勾 `newForgeTryIntake`——「導入新裝備」開啟（預設開）時新掉落改流入 `G.newForge.queue`；關閉或佇列滿載（20,000）回退舊輸送帶；`typeof` 防衛相容未載入 newforge.js 的測試環境。舊輸送帶既有積壓仍由舊生產線處理。
- **`js/data.js`**：`NEW_FORGE_MATERIALS`（15 種礦石/材料註冊表：爐渣~魔鋼碎片 8 種碎料＋鐵錠~魔鋼 7 種產物，含名稱/emoji/顏色）、`NEW_FORGE_SALVAGE_YIELD`（品質 0~7 拆解產出表，數值照企劃書）、`NEW_FORGE_CRAFT_RECIPES`（稀有/獨特/史詩/傳說 4 配方）、`NEW_FORGE_SMELT_RECIPES`（7 種熔煉配方）、`NEW_FORGE_MAX=10`、`NEW_FORGE_INTERVAL=2s`、`NEW_FORGE_QUEUE_CAP=20000`、`NEW_FORGE_TYPES`（鍛造/符文/魔法，後兩者尚未開放）、`NEW_FORGE_MODES`。
- **`js/formula.js`**：`newForgeRollAmount(v)`＝`rollDropCount(v×100)`（整數必得＋小數機率額外 1 件）。
- **`js/player.js`**：`newForgeDefaultFurnace(id, ftype)`（預設拆解模式；普通~傳說＝分解、神話+＝保留、條件不限，照企劃示意圖）；newGameState 加 `player.forgeMats`（15 種計數）與 `G.newForge`（intake/queue/furnaces/nextId/stats）。
- **`js/newforge.js`（新檔，載於 factory 之後、save 之前）**：路由攔截與 `_nfBypass` 防遞迴、`newForgeTick`（每座每 2 秒處理一次）、拆解判定 `newForgeDecide`（上鎖/神鑄創世一律保留；動作＋等級條件 lte/gte/any，**不符＝保留**）、佇列處理（沿用 `G.factory.autoEquip` 更強自動換裝；換下舊裝經 pushConveyor 自然回流）、`newForgeSalvage`（鑲嵌寶石先取回；產出僅企劃表碎料，不產碎片/金幣/精華）、`newForgeCraft`（手動；素材寶石取回；**產物直接入包不走滿載自動分解**，素材已移除故淨長度不增）、`newForgeSmeltOnce`（手動＋自動）、熔爐增刪（上限 10）、`newForgeReturnQueueToConveyor`（佇列退回舊輸送帶，滿載即停不丟失）、`sanitizeNewForge`（遷移淨化）。
- **`js/main.js`**：`stepGame` 加 `newForgeTick(dt)`（typeof 防衛）。
- **`js/save.js`**：migrateSave 呼叫 `sanitizeNewForge`（furnaces 夾限/補欄、queue 截斷、forgeMats 只留註冊 key 並補 0）；`newForge.queue` 納入 fixSockets/fixName 修正迴圈。舊存檔靠 mergeDefaults 自動補預設，無需一次性遷移旗標。
- **`index.html`**：頁籤鈕「🧪 新熔爐」（熔爐右側）＋`#tab-newforge` 面板（導入開關/佇列數/退回按鈕/材料庫存/熔爐清單/添加熔爐/新熔爐紀錄）＋`js/newforge.js` script。
- **`js/ui.js`**：`UI.dirty.newforge`＋uiTick 惰性渲染＋`renderNewForge`（材料棋格/熔爐卡片三模式切換/拆解 8 品質列「分解/保留＋等級條件＋數字輸入」/鍛造配方列含素材下拉/熔煉產品選單與×1×10；熔爐清單 HTML 比對後才覆寫，避免週期重繪關閉下拉）＋`bindNewForgeEvents` 容器事件委派。
- **`css/style.css`**：`.nf-*` 樣式（材料格、模式切換、條件輸入、配方列、成本紅綠）。
- **`js/gm.js`／`GM_command.md`**：新增 `nfmat 材料key|all 數量`（不分大小寫、負數扣除、下限 0）。
- 文件：`game_formula.md` 新增 §11 新熔爐（測試版）三小節＋目錄。
- 測試：新增 `tests/new-forge.test.cjs`（17 測試：資料表逐值、擲量、路由開關/滿載回退、拆解判定（條件/上鎖/神鑄創世/神話自選）、拆解產出與寶石取回、佇列處理、鍛造成功/失敗/滿載直入包、熔煉、熔爐上限、存檔遷移、接線靜態檢查）。
- 多代理對抗式審查（4 維度 7 發現、2 確認）後修正：①背包滿載時「保留」改依 `addToInventory` 回傳值計數（滿載被舊系統分解不再虛增 kept）；②鍛造素材下拉選取持久化到熔爐 state（`fu.craft.sel[配方]`，重繪後還原 selected、鍛造成功清除；sanitize 補舊存檔缺欄），修復「週期重繪清空選取→誤鍛第一件」的競態。
- 驗證：`npm run build` 97 檔過；專屬測試 19/19；全套 240＝223 過/17 失敗（既有基線，零新增退步）；隔離埠 8124 實測——舊存檔自動遷移（newForge 預設補齊）、實際掉落→佇列→自動拆解→爐渣/碎鐵入帳（舊輸送帶保持 0）、模式切換、熔煉×10 與自動熔煉、鍛造（精良→稀有，等級/部位相同、秘銀 −2）、添加符文熔爐顯示尚未開放、導入開關切換、GM `nfmat all 500` 生效、鍛造選取重繪後保留（state 儲存＋新 DOM 還原）、主控台 0 錯誤。

- 需求：切頁檢視某套裝備時（不需按「確定切換」），側欄屬性面板即顯示該套的 would-be 屬性，方便比較強度。
- `js/formula.js`：`computeStats(equipmentOverride)` 增加可選裝備套參數（省略＝穿著中 `G.equipment`，原路徑不變）。
- `js/player.js`：新增 `getViewStats()`（檢視套＝穿著套時回傳 `getStats()`；否則以 `computeStats(viewedEquipment())` 計算＋獨立快取 `_viewStatsCache`）；`markStatsDirty` 同步清兩份快取（洗煉/強化/裝卸檢視套後預覽即時更新）；`setEquipView` 清預覽快取＋標記 header 重繪（切頁立即生效）。
- `js/ui.js`：`renderHeader` 的 `renderAttrPanel` 改餵 `getViewStats()`（header 其餘區塊維持穿著中）；面板頂端新增 `#attr-preview-note`，檢視非穿著套時顯示「👁 屬性預覽：〈檢視套名〉（尚未穿上，戰鬥仍用〈穿著套名〉）」。
- `css/style.css`：`.attr-preview-note` 虛線框提示樣式。
- 邊界：戰鬥／回復／掉落等一切邏輯仍用 `getStats()`（穿著中），切頁完全不影響實際數值；tooltip（含敵種傷害抗性黃字減傷率）同步吃預覽屬性。
- 測試：新增 `tests/equip-set-preview-stats.test.cjs`（3 測試：覆寫計算、檢視/穿著分離、變動後即時更新）。
- 驗證：build 95 檔過；全套 221＝204 過/17 失敗（既有基線）；隔離埠實測——檢視非穿著套面板數值即變（155 vs 穿著 422）＋提示正確顯示套名、檢視穿著套提示隱藏、`getStats()` 全程不變、主控台 0 錯誤。

## 變更紀錄：敵種傷害抗性二次改名（普通敵人／菁英／BOSS）

- 依使用者最終命名：`eliteDmgRed`「普通菁英傷害抗性」→**菁英傷害抗性**、`bossDmgRed`「普通BOSS傷害抗性」→**BOSS傷害抗性**（`normalDmgRed`「普通敵人傷害抗性」不變）。
- 同步範圍：`AFFIX_POOL` name、屬性面板列（👑 菁英傷害抗性／😈 BOSS傷害抗性）、`apply_params.cjs` wKeyByName、參數表（表-詞條池／表-戰力權重 名稱欄、3-戰鬥核心「敵種傷害抗性」列的說明文字）、game_formula.md、測試斷言。
- 驗證：build 94 檔過；專屬測試 6/6；全套 218＝201 過/17 失敗（既有基線）；round-trip 逐列比對通過；apply_params dry-run 一致；隔離埠實測面板顯示新名稱、頁面無舊名殘留、主控台 0 錯誤。
- xlsx 換入完成（第二輪）：使用者關閉 Excel 前在表上把「敵種傷害抗性」a/b 調成 1000/0.5——改用「僅改名」最小補丁（rename_xlsx.cjs：sharedStrings/sheet1/sheet2 三檔 8 處字串替換，不動數值/公式/calcChain）直接套在使用者最新檔上，調參完整保留。換入後 round-trip 一致；dry-run 693 參數＝691 一致＋2 筆待套用（即使用者的 a/b 調參，依規則留給使用者跑套用參數.bat 生效）、0 錨點問題。

## 變更紀錄：敵種屬性改名＋9 種詞條升獨特級（下方兩則紀錄中的舊名稱以本則為準；抗性名稱再依上則二次改名）

- 改名（`AFFIX_POOL` name／屬性面板列／參數表 表-詞條池與表-戰力權重 名稱欄／game_formula.md 全同步；內部 key 不變）：
  - `normalDmg`：對普通傷害% → **對普通敵人傷害%**（面板「👤 對普通敵人傷害」）
  - `normalDmgRed`：對普通傷害減免 → **普通敵人傷害抗性**
  - `eliteDmgRed`：對菁英傷害減免 → **普通菁英傷害抗性**
  - `bossDmgRed`：對BOSS傷害減免 → **普通BOSS傷害抗性**
  - 參數表「3-戰鬥核心」公式列同步更名為「敵種傷害抗性」（apply_params 接線一併改）。
- 獨特級門檻（`minR: 3`，僅獨特含以上裝備出現）：對普通敵人傷害%、對菁英傷害%、對BOSS傷害%、三種敵種傷害抗性、掉寶率%、經驗加成%、金幣加成% 共 9 種（對菁英/對BOSS 原為稀有級、其餘原無門檻）；參數表 表-詞條池 對應 5 列的參數d 同步改「獨特」、4 條新列直接標「獨特」。
- 測試：enemy-type-damage.test.cjs 更新名稱斷言＋新增獨特級 minR 測試（6 測試全過；全套 218＝201 過/17 失敗＝既有基線）。
- 驗證：`npm run build` 94 檔過；apply_params dry-run 693 參數一致/0 錨點問題；round-trip 逐列比對通過（含 5 列參數d 變更檢查）；隔離埠 8124 實測——稀有(2)裝備 400 次擲骰 0 洩漏、獨特(3) 9 種詞條全部可出現（金幣/經驗僅飾品部位）、面板 4 列新名稱正確、主控台 0 錯誤。
- xlsx 換入完成：Excel 關閉後偵測到檔案被重存（內容比對無實質變更），改以「對最新檔重跑補丁」流程換入；換入後 xlsx→CSV round-trip 一致、apply_params dry-run 無變更無錨點問題。Excel 首次開啟會自動重算並重建 calcChain，屬正常。

## 變更紀錄：參數表加入敵種傷害屬性公式＋「刪除」標記處理

- 參數表新列（CSV+xlsx 同步，共 9 列）：「3-戰鬥核心/敵種傷害減免」（a=60、b=8，接 `ENEMY_TYPE_DMG_RED_A/B`）；「表-詞條池」對普通傷害%（3/0.35/9）與對普通/菁英/BOSS傷害減免（各 6/0.35/9）；「表-戰力權重」對普通傷害% 1.2、三減免各 1。位置緊接各自的全局減傷／對BOSS傷害%／防禦減傷率之後。
- 「刪除」標記（變動欄新語意，已寫入 AI_RULES.md）：移除 #58「2-屬性上限/全局減傷 上限」列（全局減傷已不設上限；該列原本即標注不生效、apply_params 無引用）。
- `tools/apply_params.cjs`：wKeyByName 補 4 個新詞條名稱；新增 ENEMY_TYPE_DMG_RED_A/B scalar 接線（表列缺席時自動跳過，相容舊表）。詞條池／戰力權重迴圈本身通用、自動接上。
- xlsx 編輯方式：純 Node 重壓 ZIP——sheet2（計算表）刪 1 插 9、全列重編號、A 欄重建為單段共用公式鏈 `A4:A458`（保留自動遞增；I11:I19 轉生 ×3 鏈原樣保留）；sheet1 全部資料列重生為同列 `=計算表!Xn` 鏡像＋快取值；刪 calcChain 並設 `fullCalcOnLoad` 讓 Excel 開檔重算。
- 驗證：round-trip（新 xlsx → xlsx_to_csv → CSV）與基線逐列比對通過——既有 448 列逐欄保留（含使用者在途數值）、新 9 列內容正確、刪除列移除、編號 1..457 連續；`apply_params` dry-run 693 參數全數一致、0 錨點問題；`npm run build` 94 檔通過。
- 註：套用當下 xlsx 正被 Excel 開啟（鎖檔存在），CSV 已先落地，xlsx 以監看器等 Excel 關閉後自動比對雜湊再換入（若期間使用者又存檔會改用重新套補丁流程，不會覆蓋使用者變更）。

## 變更紀錄：新增敵種傷害屬性（對普通傷害% + 對普通/菁英/BOSS傷害減免）

- 需求：新增 4 詞條——「對普通傷害%」（百分比，放出量同物理防禦詞條，公式同對菁英/BOSS加成、僅對非菁英非BOSS敵人生效）與「對普通/菁英/BOSS傷害減免」（定值，放出量約為物理防禦詞條 2 倍）；減免通用公式 `減免值總合/(減免值總合+a+b×攻擊者等級)`（a=60、b=8，同防禦減傷曲線基準），作用於傷害公式最末端（全局減傷之後、最低傷害之前）。
- `js/data.js`：`AFFIX_POOL` +4（normalDmg base3/lv0.35/pct；normalDmgRed/eliteDmgRed/bossDmgRed base6/lv0.35/定值）；`AFFIX_CATS` 歸類（off/def）；`STAT_GROUPS` 進攻 +「👤 對普通傷害」、防禦 +三個減免列；新增 `enemyTypeDmgRedDesc` tips 助手（黃字顯示「目前同級減傷率」，`pctStrFloor4` 截斷至小數四位）。
- `js/formula.js`：computeStats 聚合桶與 st 欄位 +4；§3 新增 `ENEMY_TYPE_DMG_RED_A/B` 與 `enemyTypeDamageReduction()`；`resolveHit` 加對普通傷害加成判定（非菁英且非BOSS）與末端敵種減免（依 aCfg.isElite/isBoss 選 dCfg 對應減免值）；`SCORE_WEIGHTS` +4（normalDmg 1.2、三減免 1.0）。
- `js/combat.js`：`playerAtkCfg` 帶 normalDmg；`playerDefCfg` 帶三減免；`monsterAtkCfg` 帶 `isElite/isBoss`（野外 `m.elite`、高塔 BOSS `isBoss:true` 旗標既存）。
- `js/skills.js`：`castSkill` 技能 aCfg 帶 normalDmg。
- 文件：`game_formula.md` §2.5（兩列）、§3.2（步驟 7 擴充＋新步驟 11 敵種減免、重排 12/13）、§6.4（兩則詞綴說明）。
- 測試：新增 `tests/enemy-type-damage.test.cjs`（5 測試：詞條放出量對照 defFlat、加成只打普通敵、減免公式、敵種選值與末端順序、面板 tips 黃字四位小數）。
- 驗證：`npm run build`（94 檔過）；`npm test` 217 測試＝200 過/17 失敗（與改動前基線完全相同，皆為使用者調參後的既有失敗）；隔離埠 8124 實測——主控台 0 錯誤、主迴圈運轉、面板 4 新列渲染、沙盒 resolveHit 200 次命中平均值符合 BOSS 減免期望（正確選 bossDmgRed 而非 normalDmgRed）、詞條擲值上下限恰為物理防禦 2 倍。

## 變更紀錄：恢復裝備切頁 CSS（三欄並排版面）

- 問題：`css/style.css` 中整段 `.eqset-*` 樣式（`#equip-set-tabs`／`.eqset-tabrow` 三欄 grid／`.eqset-tabwrap`／`.eqset-name`／`.eqset-rename`／`.eqset-tab`／`.eqset-badge`／`.eqset-confirm`）被整段刪除 → 三個切頁失去 grid 版面、退回預設 block 上下堆疊。渲染碼（ui.js `renderEquipSetTabs`）本身完整。
- 修正：於 `#equip-grid` 與 `.eq-slot` 之間補回完整 `.eqset-*` 樣式區塊（含名稱列與右上角改名鈕）。
- 驗證：`npm run build`（93 檔過）；隔離埠 8124 實測——`.eqset-tabrow` `display:grid`、三欄各 96px、三切頁同一列並排（y 相同、x 遞增）、名稱正常顯示於上方；主控台 0 錯誤。

## 變更紀錄：改名彈窗改用遊戲通用樣式（取代原生 prompt）

- 需求：裝備套改名原本用瀏覽器原生 `prompt()`，改為遊戲通用的確認彈窗。
- `index.html`：`#confirm-modal` 內於訊息與按鈕間加 `#confirm-input`（預設隱藏）。
- `js/ui.js`：`showConfirmDialog` 擴充可選 `options.input`（`{value,placeholder,maxLength}`）——顯示輸入框、自動聚焦全選、Enter 確定／Esc 取消，`onConfirm(值)` 帶回輸入內容；未指定 input 時維持原純是/否確認、輸入框隱藏。`renameEquipSet` 改呼叫此彈窗（不再用 `window.prompt`）。
- `css/style.css`：`.confirm-input` 深色輸入框樣式（聚焦 accent 邊框）。
- 驗證：`npm run build`（93 檔過）；隔離埠 8124 實測——改名開啟遊戲彈窗（標題「裝備套改名」、輸入框可見、maxLength 12），輸入後確定→名稱設定並顯示；**既有是/否確認框不受影響**（無 input 時輸入框隱藏、onConfirm 正常）；主控台 0 錯誤。

## 變更紀錄：裝備三套可自訂名稱（切頁上方顯示＋右上角改名鈕）

- 需求：每套切頁右上角加小按鈕，點擊改名；名稱顯示在切頁按鈕上方。
- `js/player.js`：newGameState 加 `equipSetNames: ['','','']`；新增 `equipSetLabel(i)`（有自訂名用之、否則預設「第X套」）。
- `js/save.js`：migrateSave 補齊 `equipSetNames` 為與套數等長的字串陣列（舊存檔全空＝用預設）。
- `js/ui.js`：`renderEquipSetTabs` 每套改為 `.eqset-tabwrap`（上方 `.eqset-name` 顯示自訂名＋`.eqset-tab`＋右上角 `.eqset-rename` ✏️）；確定切換鈕改用 `equipSetLabel(view)`；新增 `renameEquipSet(idx)`（`prompt` 輸入、上限 12 字、留空恢復預設）；全域 click 委派在切頁判斷「之前」接 `[data-eqset-rename]`（避免改名同時誤觸切換檢視），名稱以 `esc()` 防注入。
- `css/style.css`：`.eqset-tabwrap`/`.eqset-name`（空時保留高度對齊）/`.eqset-rename`（絕對定位切頁右上角）。
- 驗證：`npm run build`（93 檔過）；隔離埠 8124 實測——3 套各有名稱列＋改名鈕；改名「輸出套」正確顯示於該套上方、清空恢復預設；**改名不會誤觸切換檢視**（equipView 前後皆 0）；改名鈕位於切頁右上角；主控台 0 錯誤。

## 變更紀錄：修正「重新掃描」按鈕無反應

- 問題：存檔管理的「🔄 重新掃描」按鈕（`#btn-folder-refresh`）**完全沒有綁定點擊事件**（全專案無任何 handler）→ 點了沒反應。
- `js/ui.js`：於 `btn-folder` handler 附近補上 `#btn-folder-refresh` 的點擊事件——用**已授權的資料夾**呼叫 `openSaveFolder(cb, false)`（重新同步＋匯入新存檔、不重新彈出資料夾選擇器），再 `refreshSaveFolderFilesV2()`（無參數→重列資料夾檔案）＋`renderSaveList()`；未連接資料夾時提示先授權。
- 驗證：`npm run build`（93 檔過）；隔離埠 8124 實測——按鈕點擊有反應（未連接時顯示提示，證明不再是無反應），主控台 0 錯誤。

## 變更紀錄：裝備三套切換系統（切頁檢視＋確定切換）

- 需求：裝備欄下方 3 切頁（第一/二/三套），點切頁檢視該套並可操作（洗煉/強化/裝上/卸下/鎖定），點「確定切換」才正式換穿。
- 設計（最小侵入）：`G.equipmentSets`（3 套）＋`G.equipActive`（穿著）＋`G.equipView`（面板檢視）；**`G.equipment` 永遠 === `equipmentSets[equipActive]`**，故 computeStats／戰鬥／工廠自動換裝／存檔序列化全部零改動。只有面板層（renderEquip／findItemById／比較／裝上卸下）導向 `viewedEquipment()`；檢視＝使用中時行為完全等同現況。
- `js/player.js`：newGameState 建三套（emptyEquipmentSet×3，equipment=sets[0]）；新增 `viewedEquipment/activeEquipment/isViewingActiveSet/setEquipView/switchToEquipSet/equipSetName/equipmentSetAt`；`equipItem`/`equipTargetSlot` 加可選目標套參數（預設 G.equipment，非使用中套不重算屬性）。
- `js/save.js`：migrateSave 三套遷移——**在 mergeDefaults 前**記錄 `hadEquipmentSets`／`originalEquipment`（否則 mergeDefaults 會補空 sets 使舊存檔誤判、把真裝備孤立），舊存檔以真 equipment 為第一套、另補兩空套；載入一律 `equipment=sets[active]` 重導避免序列化參照脫鉤。
- `js/ui.js`：renderEquip 顯示檢視套＋`renderEquipSetTabs`（切頁＋確定切換，使用中徽章、檢視高亮、view==active 時停用）；findItemById／compare／detailAction(equip/unequip) 導向檢視套；全域 click 委派接 `[data-eqset]`（只切檢視）與 `#eqset-confirm`（換穿）。
- `index.html`：`#equip-grid` 下加 `#equip-set-tabs`。`css/style.css`：切頁/徽章/確定鈕樣式。`.claude/launch.json`：測試埠 8123→8124（8123 被殘留 node 佔用）。
- 驗證：`npm run build` 通過（93 檔）。隔離埠 8124 實測——(1) 資料模型 3 套、`equipment===sets[active]` 不變式成立；(2) 檢視切頁不改 active；(3) 裝入檢視第二套→物件進第二套不進第一套、active/屬性不變；(4) 確定切換→active=1、`equipment===set1`、屬性重算。**用真實存檔 node 測 migrateSave：13 件裝備全保留於第一套、二三套空、computeStats atk 169M 與原本一致、不當機。**

## 變更紀錄：新增修改後驗證協議（npm run build）＋建置檢查基礎設施

- `AI_RULES.md`：新增〔程式碼修改後驗證協議 (Post-Edit Verification)〕——(1) 每次改碼後必須 `npm run build` 且 0 Error；(2) 核心數值/機制修改須自主啟動隔離伺服器（8123/5501+，嚴禁 5500）驗證不當機；(3) 數值集中規則明確對應本專案 SSOT（`js/data.js`＋`js/formula.js`＋參數表管線），不另建第二數值來源。涉及核心修改時本協議優先於「按需自測」預設。
- 新增 `package.json`（scripts：`build`＝`node tools/build_check.cjs`、`test`＝`node --test tests/*.test.cjs`）。
- 新增 `tools/build_check.cjs`：對 `js/`、`tools/`、`tests/` 全檔 `node --check` 語法/編譯檢查，並偵測遊戲檔 0 bytes 空檔（防止 combat.js 被並行編輯工具清空這類事故再度造成卡 Loading）。
- 驗證：`npm run build` 實跑通過（93 檔全數 OK、無空檔）。

## 變更紀錄：野外敵人死亡清除延遲期間頭像與血條淡出

- 需求：敵人死亡後的清除延遲（`FIELD_ENEMY_DEATH_CLEAR_DELAY`，玩家可調，如 3 秒）期間，讓頭像與血條在該秒數內透明度由 100% 線性降至約 10%。
- `js/ui.js` `renderBattle` 就地更新迴圈：對每張卡片依 `liveEnemy.hp<=0` 判定，透明度＝`0.1 + 0.9 × clamp(_deathClearCd / FIELD_ENEMY_DEATH_CLEAR_DELAY, 0, 1)`（剛死＝1.0、清除前＝0.1），套用到頭像（`.cb-icon`／`.enemy-emoji-fallback`）與血條（`.enemy-hp`）；存活敵人清空 inline opacity（維持 100%）。以常數為基準，玩家改幾秒都對。
- `css/style.css`：`.enemy-card` 的頭像與血條加 `transition: opacity 0.2s linear`，平滑 renderBattle 每 tick（200ms）的逐幀更新。傷害/掉落浮字層不淡出。
- 純視覺，不改任何數值/戰鬥/清除時機邏輯。
- 驗證（隔離埠 8123）：暫停戰鬥、手動設死亡並給不同 `_deathClearCd` 強制 renderBattle，實測 cd=滿→100%、半程→0.55、快清除→0.118（≈10%），頭像與血條同步、transition＝`opacity 0.2s`；主控台 0 錯誤。

## 變更紀錄：野外敵人死亡後延遲清除戰鬥資訊

- `js/data.js`：新增可調整秒數 `FIELD_ENEMY_DEATH_CLEAR_DELAY = 1.5`，控制野外敵人死亡後保留敵方戰鬥資訊的時間。
- `js/combat.js`：`onFieldKill()` 改為先結算獎勵並標記 `_deathClearCd`，不立刻移除敵人；`tickFieldDeathClears()` 每 tick 倒數，時間到才移除；整波清空時等死亡資訊清除後才推進階段與開始下一波搜尋。
- `js/ui.js`：戰鬥畫面與敵方狀態 tooltip 改用 `visibleFieldEnemies()`，保留 HP 0 且尚在死亡倒數中的敵人卡片、狀態與浮字層。
- `js/tower.js`：切入高塔時同步清掉野外延遲清除旗標，避免殘留狀態。
- `tests/multi-enemy.test.cjs`：補回歸測試，鎖定死亡敵人保留 1.5 秒、活敵人仍可被戰鬥邏輯選取、整波完成延後到清除後。
- 驗證：`node --test tests\multi-enemy.test.cjs tests\field-death-retreat.test.cjs`、`node --check js\data.js js\combat.js js\ui.js js\tower.js tests\multi-enemy.test.cjs` 通過；`git diff --check` 僅有 CRLF/LF 提醒。

## 變更紀錄：連擊數 tooltip 移除括號補充

- `js/data.js`：連擊數 tooltip 刪除括號內的追加規則範例與持續傷害例子，只保留效果結論：「普攻與技能直接傷害會額外追加攻擊次數；持續傷害不受影響」。
- `tests/combo-hits.test.cjs`：補 tooltip 文案斷言，避免括號補充文字回流。

## 變更紀錄：技能命中改吃玩家命中率（修高閃避敵人大量 MISS）

- 問題：技能傷害段命中寫死 `100%`（`hit: fx.neverMiss ? 999 : 100`），不吃玩家命中率。野外敵人閃避＝`5 + 階段×2`（階段 430 → 865%，菁英再 +5 → 870%），使技能命中率被夾到下限 5% → 95% 被閃避；玩家命中率高達 2890% 卻用不到。連擊讓每次施放的傷害段重複 2~3 段、各自擲命中，把 MISS 放大成「一整排」。普攻不受影響（普攻本就吃 `st.hit`，2890% > 870% → 必中）。
- 修正（`js/skills.js` castSkill aCfg）：`hit: fx.neverMiss ? 999 : Math.max(100, st.hit)`。技能至少保有 100% 基礎命中（低命中前期不受影響），命中率 >100% 時可壓過高閃避敵人。純命中判定改動，不動傷害數值/連擊/持續傷害。
- `game_formula.md`：§3 補「技能命中率＝max(100%, 玩家命中率)」與野外高階敵人閃避說明。
- `tests/skill-hit.test.cjs`：新增 resolveHit 行為測試（命中 2890% vs 閃避 870% 必中；固定 100% vs 870% 夾到 5% 必 MISS）＋接線斷言。3/3 通過（連擊測試 10/10 併測共 13/13）。

## 變更紀錄：高塔 BOSS 大量 MISS 浮字修正

- `js/ui.js`：補回 `floatText()` 入口保護；若 `tb-float` 收到裸 `MISS` / `miss`，轉成玩家浮層 `tp-float` 的黃色 `閃避!`（`player-event defend`）。
- `js/combat.js`、`js/skills.js`：我方攻擊被敵方閃避時改用 `miss enemy-dodge`，保留敵方區顯示語意，但與玩家閃避 fallback 分流。
- `js/ui.js`：高塔 BOSS 浮層的 `enemy-dodge` MISS 加 300ms 節流，避免普攻連擊與多段技能在 BOSS 身上洗出大量紅色 MISS。
- `tests/player-event-float.test.cjs`：補回歸測試，鎖定 BOSS 浮層裸 MISS 轉玩家區，以及敵方閃避 MISS 節流。
- 驗證：`node --test tests\player-event-float.test.cjs`、`node --check js\ui.js js\combat.js js\skills.js tests\player-event-float.test.cjs` 通過。

## 變更紀錄：融合技能列表恢復每排 12 個

- `css/style.css`：新增 `#fusion-skill-list.tree-row` 覆蓋樣式，融合技能列表固定 `repeat(12, 52px)`，不再套用一般技能樹的 4 欄排列；窄寬度時允許水平捲動。
- `tests/skill-tree-layout.test.cjs`：補回歸測試，鎖定一般技能樹維持 4 欄、融合技能列表維持每排 12 個。
- 驗證：`node --test tests\skill-tree-layout.test.cjs`、`node --check tests\skill-tree-layout.test.cjs`、`git diff --check -- css/style.css tests/skill-tree-layout.test.cjs` 皆通過；`git diff --check` 僅有既有 CRLF/LF 提示。

## 變更紀錄：重做玩家/敵方即時增益 tooltip

- 修復玩家區 tooltip 消失：`js/ui.js` 補回 `activeBuffsHtml()`、`buffTooltipDesc()`、`showBuffTooltip(anchorEl)` 與 `[data-buff-tip]` hover/click/mouseout 事件。
- 敵方狀態列改走獨立 `data-enemy-buff-tip`：高塔 BOSS 讀 `TOWER.boss`，一般敵人用 `data-enemy-index` 對應目前存活敵人，不再覆蓋玩家 tooltip。
- `refreshBuffTooltip()` 會依目前 `UI.tooltipAnchor` 分流刷新玩家或敵方 `.skt-desc`，讓剩餘秒數與數值即時更新。
- `css/style.css` 補 `#active-buffs` 與 buff tooltip 相關顯示樣式。
- 驗證：`node --check js\ui.js`、`node --test tests\active-buffs-panel.test.cjs tests\enemy-buffs-tooltip.test.cjs`、`git diff --check -- js/ui.js css/style.css` 皆通過；`git diff --check` 僅有既有 CRLF/LF 提示。

## 變更紀錄：連擊數公式語意更正（暴擊率% 直接代入）＋面板移位＋tooltip

- 使用者澄清：公式中「暴擊率%」＝把暴擊率當比值**直接代入**（例：5000% → 代入 50，即 `暴擊率 ÷ 100`），**不做「減 100」**。先前實作採「暴擊率−100」會使高暴擊時線性項爆炸（暴擊 5000% → b×4900≈68 → +75 段），此更正把線性項壓回合理範圍（b×50≈0.69）。
- `js/formula.js` `comboHitsFor`：改為 `cr ≤ 100 → 0`；否則 `x = cr/100`，`n = a·ln(x) + b·x + c`，取 `max(0)`。對照：100%→0、200%→≈0.72、1380%→≈2.57（原範例 2.57 落於此暴擊率）、5000%→≈4.20。保留「=100% 完全爆擊、超過才觸發」閘門。
- `js/data.js`：「🔗 連擊數」面板列**移到暴擊率正下方**（暴擊率 → 連擊數 → 暴擊傷害）；補強暴擊率與連擊數 tooltip（暴擊率 tip 加註「100% 完全爆擊、超出衍生連擊數」；連擊數 tip 含「2.57＝固定 2 次＋57% 機率第 3 次」範例）。
- `game_formula.md`：§2 連擊數列公式改為 `a·ln(暴擊率%)+b·暴擊率%+c`，明註「暴擊率%＝÷100 直接代入、不減 100」。
- `tests/combo-hits.test.cjs`：更新預期值（100→0、101→≈0.1088、1380→≈2.574、200→≈0.7203、5000→≈4.2026）。10/10 通過。

## 變更紀錄：敵方狀態列顯示即時增減益詳情

- 需求：我方狀態列已有「目前技能增益」即時 tooltip；敵方區也要能查看目前狀態與增減益詳情。
- `index.html`：高塔 BOSS 狀態列 `#tb-status` 加 `data-enemy-buff-tip`。
- `js/ui.js`：新增 `currentCombatEnemyEntity(anchorEl)`、`enemyBuffTooltipDesc(anchorEl)`、`showEnemyBuffTooltip(anchorEl)`；高塔讀 `TOWER.boss`，野外依 `.enemy-status[data-enemy-index]` 讀目前存活敵人。
- `js/ui.js`：野外敵人 `.enemy-status` 生成時加 `data-enemy-buff-tip data-enemy-index`，重繪時同步 index；事件委派支援 hover/click 顯示，mouseout 收起；`refreshBuffTooltip()` 同時支援敵方 tooltip 即時刷新。
- 詳情涵蓋暈眩、減速、中毒、持續傷害（燃燒/流血/詛咒等）、buff/debuff（攻擊↓/防禦↓等），顯示數值與剩餘秒數。
- `css/style.css`：敵方狀態列 hover 顯示 pointer，提示該區可查看詳情。
- `tests/enemy-buffs-tooltip.test.cjs`：新增敵方 tooltip 接線與狀態類型覆蓋測試。
- 驗證：`node --test tests\active-buffs-panel.test.cjs tests\enemy-buffs-tooltip.test.cjs`（7/7）、`node --check js\ui.js tests\active-buffs-panel.test.cjs tests\enemy-buffs-tooltip.test.cjs` 通過。未啟動或操作 5500。

## 變更紀錄：新增屬性「連擊數」（暴擊率破 100% 衍生多段攻擊）

- 需求：暴擊率 100% 為完全爆擊；**超過** 100% 的部分衍生「連擊數」＝額外攻擊次數。公式 `連擊數 = a·LN(暴擊率%) + b·暴擊率% + c`（a=0.875、b=0.01387、c=0.0861），僅作用於普攻與技能直接傷害，持續傷害不計。小數為機率追加（例 2.57 → 固定 2 次＋57% 機率第 3 次）。使用者已在參數表加入公式（2-屬性派生／連擊數，變動＝新增）並明確指示實作。
- **公式輸入語意判斷**：採「超過 100% 的部分」＝`暴擊率−100` 為輸入。理由：設計語意須自 100% 平滑起步；常數零交叉點在超出 ≈0.9%（暴擊 100.9%）完美對齊；範例 2.57 反推輸入≈13.8→暴擊 113.8% 合理（若用原始暴擊率則零交叉在 0.9%，5% 暴擊就有 1.5 次連擊，明顯錯誤）。`暴擊率≤100%` 時為 0，結果再取 `max(0,…)`。
- `js/formula.js`：新增 `comboHitsFor(critRate)`（純函式）與 `rollComboHits(st)`（整數固定＋小數機率擲骰）；`computeStats` 派生 `st.comboHits = comboHitsFor(st.critRate)`。
- `js/data.js`：新增具名常數 `COMBO_HITS_COEF={a,b,c}`；`STAT_ROWS` 進攻屬性加「🔗 連擊數」顯示列（>0 顯示「N 次」，否則「—」）。
- `js/combat.js`：`doPlayerAttack` 主攻擊命中且未致死後，依 `rollComboHits` 追加整段普攻（`depth 0` 才觸發，遞迴段帶深度避免與「連擊被動」互相爆炸）。
- `js/skills.js`：`castSkill` 傷害段外層包 `for rep 0..comboReps`，僅重複「直接傷害段」；DoT／減益／吸血在段外一次結算 → 持續傷害不受影響。日誌加「（連擊數 ×N）」。
- `tools/apply_params.cjs`：接 `COMBO_HITS_COEF` a/b/c ←（2-屬性派生／連擊數）。dry-run：一致 675、將變更 0、錨點問題 0。
- `game_formula.md`：§2 衍生表加「連擊數」列；修正「暴擊率上限 100%→無上限」（程式 `STAT_CAPS.critRate=0` 與參數表「暴擊率 上限」a=0 早已無上限，僅文件殘留舊值，連擊機制正依賴此）；§3 補連擊數多段結算註記。
- 待回報疑點（未擅改）：`game_formula.md` §2 與 §2 敏捷表「暴擊率 敏捷×0.06」與程式/參數表 `agiCritRate=0.0001` 不一致，屬既有、與本任務無關且有歧義，依規則先回報不動。
- 驗證：`tests/combo-hits.test.cjs`（10/10）；`node --check` formula/data/combat/skills 皆通過；apply_params dry-run 一致。純機制新增，未動既有數值。

## 變更紀錄：技能樹分類卡片維持四個技能一排

- 問題：技能樹資料已在 `renderSkills()` 以每 4 個技能切列，但 `.tree-row` 使用 flex 且允許換行；分類卡片寬度略不足時會呈現 3+1。
- `css/style.css`：`#skill-trees` 分類卡片最小寬度 `280px → 288px`，外層 gap `12px → 10px`；`.tree-row` 改為 grid，固定 `repeat(4, 52px)`，gap `8px`，不再 flex-wrap。
- `tests/skill-tree-layout.test.cjs`：新增回歸測試，鎖定 JS 每 4 個切列、CSS 技能樹卡片最小寬度與 `.tree-row` 固定 4 欄。
- 驗證：`node --test tests\skill-tree-layout.test.cjs`（1/1）、`node --check js\ui.js tests\skill-tree-layout.test.cjs` 通過。未啟動或操作 5500。

## 變更紀錄：增益 tooltip 即時刷新＋面板增益數值改綠色

- **即時刷新（戰鬥區增益 tooltip）**：`js/ui.js` 抽出 `buffTooltipDesc()` 供顯示與刷新共用；新增 `refreshBuffTooltip()`——當 `#sk-tooltip` 開啟中且 `UI.tooltipAnchor` 為 `[data-buff-tip]` 元素時，每個 UI tick 只更新 `.skt-desc` 內容（數值與剩餘秒數同步倒數，不重新定位避免抖動）；於 `uiTick` 的 `renderBattle()` 後呼叫。
- **面板數值綠色**：並行工具先前把 `#active-buffs .buff-val`/`.buff-remain` 的 CSS 規則移除，導致面板數值失去綠色。改為在 `activeBuffsHtml` 直接內嵌 `style="color:var(--good)"`（數值）與 `color:var(--dim);font-size:0.9em`（秒數），與 tooltip 綠色一致、且不再倚賴易被移除的 CSS。
- 純顯示，不改任何數值/戰鬥邏輯。
- 驗證：`node --test tests/active-buffs-panel.test.cjs`（5/5，含刷新與內嵌綠色斷言）；`node -c js/ui.js`。預覽（isolated 8123）：面板數值 `getComputedStyle` = `rgb(95,158,83)`（=var(--good)）；tooltip 保持開啟且倒數即時更新（實測 26s→6s），`UI.tooltipAnchor` 確為 buff 錨點。

## 變更紀錄：戰鬥區可查看技能增益詳情（狀態列點擊＋增益按鈕）

- 承上一版「目前技能增益」面板清單保留；另在戰鬥場景加上查看入口（沿用敵人情報「!」的 tooltip 模式：懸停顯示、點擊切換、mouseout 收起）。
- `js/ui.js`：新增 `showBuffTooltip(anchorEl)`——由 `currentCombatPlayerEntity()` + `activePlayerBuffs()` 產出增益詳情（emoji＋名稱↑＋數值＋剩餘秒數；無增益顯示提示），走既有 `showStatTooltip`/`#sk-tooltip`。事件委派加 `[data-buff-tip]`：mouseover 顯示、click 切換（手機支援）、mouseout 收起。
- `index.html`：玩家戰鬥狀態列 `#tp-status`／`#pv-status` 加 `data-buff-tip`（整塊可點）；兩個玩家 combatant 各加一顆綠色 `.info-btn.buff-btn`（💪）作為小按鈕入口。
- `css/style.css`：`.buff-btn`（左上、綠色，與敵人情報「!」右上對稱）、`.cb-status[data-buff-tip]` 游標、`.buff-tip-row` 兩端對齊樣式。
- 純顯示，不改任何數值/戰鬥邏輯。
- 驗證：`node --test tests/active-buffs-panel.test.cjs`（4/4，含新 tooltip 接線斷言）；`node -c js/ui.js`。預覽（isolated 8123）：主控台 0 錯誤、野外場景增益按鈕 22px 綠圈可見、狀態列可點、注入增益後 tooltip 正確顯示「⚔️攻擊↑ +644% 4s／⚡攻速↑ +967%／💨閃避↑ +2588% 8s」。（截圖因持續動畫逾時，改以 DOM/JS 驗證。）

## 變更紀錄：屬性面板新增「目前技能增益」清單

- 問題：`computeStats()`（面板來源）不含戰鬥中的技能增益（evasionUp/atkUp… 於 playerAtkCfg/playerDefCfg 才以 buffVal 加上），面板只顯示裸值，玩家看不到當下生效的增益。使用者選「另列清單」方案。
- `js/combat.js`：新增純函式 `activePlayerBuffs(ent)`（＋`PLAYER_BUFF_ORDER`），依固定順序回傳目前生效的玩家增益 `{key,val,remain}`（只讀 `ent.buffs` 與 `GT`，過濾 `until<=GT`）。
- `js/ui.js`：`renderAttrPanel` 骨架於 DPS 後加 `#active-buffs` 容器；每 tick 讀取目前戰鬥實體（`currentCombatPlayerEntity`：高塔 `TOWER.player` 優先，否則 `FIELD.player`）的增益，產出「⏱️ 目前技能增益」清單（emoji＋`buffLabel`↑＋數值＋剩餘秒數）；無增益則隱藏。基礎數值完全不變。
- `css/style.css`：`#active-buffs` 的 `.buff-val`（綠）／`.buff-remain`（暗、縮小）小樣式；其餘沿用 `.attr-group/summary/.stat-row`。
- 純顯示，不改任何數值或戰鬥邏輯。
- 驗證：`node --test tests/active-buffs-panel.test.cjs`（3/3：過濾/排序/剩餘秒數、空實體、ui 接線）；`node -c js/combat.js js/ui.js`。預覽（isolated 8123）主控台 0 錯誤、`#active-buffs` 存在、空狀態隱藏、以假實體注入渲染出「⚔️攻擊↑ +1609% 6s／⚡攻速↑ +120% 3s／💨閃避↑ +2588% 8s」順序與數值皆正確。

## 變更紀錄：BOSS 攻擊玩家閃避浮字區域修正

- 問題：怪物/BOSS 攻擊玩家時，`doMonsterAttack()` 仍直接用傳入的 `floatSel` 顯示 `MISS` 與傷害；若呼叫端傳入敵方浮層，玩家閃避會出現在 BOSS 區域，且為紅色 MISS。
- `js/combat.js`：新增 `playerFloatSel = playerEventFloatTarget(floatSel)`；怪物/BOSS 對玩家造成的傷害字改畫到玩家浮層；玩家閃避時移除紅色 `MISS`，只保留玩家區黃色 `閃避!`（`player-event defend`）。
- `js/ui.js`：在 `floatText()` 入口加高塔保護；任何送到 BOSS 浮層 `tb-float` 的 `MISS/miss`，都會改送玩家浮層 `tp-float`，文字改 `閃避!`，class 改 `player-event defend`。這層保護只針對高塔 BOSS 浮層，不影響普通野怪 `mv-float-*`。
- `js/combat.js`、`js/skills.js`：玩家普攻或技能被敵方閃避時，恢復普通戰鬥規則，敵方區域顯示 `MISS`；避免把「敵方閃避我方攻擊」誤顯成玩家防禦閃避。
- 規則對齊：我方被敵方造成的效果（傷害、閃避、格擋、護盾吸收等）顯示在我方區域；反傷仍透過 `floatEnemyEvent()` 顯示在敵方區域。
- `tests/player-event-float.test.cjs`：鎖定 `doMonsterAttack()` 必須轉成玩家浮層，且不得直接 `floatText(floatSel, 'MISS', ...)` 或 `floatText(floatSel, dmgStr, ...)`；新增 VM 實際呼叫測試，驗證 `doMonsterAttack(..., 'tp-float')` 在 miss 時輸出 `{ id:'tp-float', text:'閃避!', cls:'player-event defend' }`；新增 `tb-float + MISS/miss` 轉向保護測試。
- 驗證：`node --test tests\player-event-float.test.cjs`（8/8）、`node --check js\ui.js js\combat.js tests\player-event-float.test.cjs` 通過。未啟動或操作 5500。

## 變更紀錄：太古精華洗煉消耗依裝備品質（實作使用者新增列）

- 需求：洗煉勾選太古精華模式時，改為依裝備稀有度消耗不同數量（原本固定 1 顆）。實作使用者於參數表新增的 `7-洗煉/太古精華洗煉消耗` 列（普通~傳說 1、神話 2、創世 3、神鑄創世 4）。
- `js/data.js`：新增 `REROLL_ANCIENT_ESSENCE_COST = [1,1,1,1,1,1,2,3,4]`（索引＝稀有度）。
- `js/formula.js` §7：新增 `rerollAncientEssenceCostFor(rarity)`（查表、越界夾在有效範圍）。
- `js/item.js`：`rerollAncientEssenceCost()` → `rerollAncientEssenceCost(it)`（依 `it.rarity`）；`rerollItemAffixes`／`rerollSingleAffix` 兩處呼叫改傳 `it`；單詞條洗煉 UI 由寫死「1」改為依品質顯示與判斷可負擔。
- `js/ui.js`：太古精華資源提示不再寫死「消耗 1 個」，改「依裝備品質消耗」，太古機率讀 `ANCIENT_REROLL_CHANCE`。
- `tools/apply_params.cjs`：`arrayContent('data','REROLL_ANCIENT_ESSENCE_COST', 該列 9 值)` 接入，使消耗量可由參數表調整。
- `game_formula.md` §7.2：更新「使用太古精華」說明為依品質消耗。
- 驗證：`node -c`（data/formula/item/ui/apply_params）；`node --test tests/reroll-ancient-cost.test.cjs`（3/3）；apply_params 試跑 670 一致／0 待變更／0 錨點問題。未執行 --write。
- 註：參數表該列變動欄仍為「新增」（使用者標記）；已依其明確指示接入系統，變動欄由使用者自行決定是否改標。

## 變更紀錄：全局減傷分母接入參數表

- 診斷：全局減傷 tooltip 已呼叫 `globalDamageReduction(st.globalDmgRed)`，所以顯示有參照公式；但該公式的分母 `20000` 仍硬編在 `js/formula.js`，`tools/apply_params.cjs` 只回寫「2-屬性派生/全局減傷」的參數 a（上限），沒有接參數 b（分母常數）。因此改 b 不會讓顯示或實戰變動。
- `js/formula.js`：新增 `GLOBAL_DMG_RED_DENOMINATOR = 20000`，`globalDamageReduction()` 改為 `total / (total + GLOBAL_DMG_RED_DENOMINATOR)`，並保護分母至少為 1。
- `tools/apply_params.cjs`：新增 `GLOBAL_DMG_RED_DENOMINATOR` 的回寫錨點，讀取 `2-屬性派生 / 全局減傷` 的參數 b。
- `tests/global-damage-reduction.test.cjs`：補上「分母常數會影響實際減傷率」測試；既有上限測試改為明確設定 `GLOBAL_DMG_RED_CAP = 85`。
- `game_formula.md`、`tools/參數表使用說明.md`：同步全局減傷公式與目前可回寫參數數量。
- 驗證：`node --test tests\global-damage-reduction.test.cjs tests\attribute-tooltip.test.cjs tests\stat-cap-unlimited.test.cjs`（13/13）、`node tools\apply_params.cjs`（669 一致、0 變更、0 錨點問題）、`node --check js\formula.js tools\apply_params.cjs` 通過。未執行 `--write`。

## 變更紀錄：玩家命中率／高塔BOSS閃避 公式結構調整（依參數表）

- 依參數表「調整」列做**結構性手改**（apply_params 只寫數值、無法改結構，故手動補結構）：
  - **玩家命中率**（2-屬性派生/命中率＝`敏捷×a+加成`）：`js/formula.js` `st.hit = 0.0001 + A.hit` → `st.hit = st.agi * 0.0001 + A.hit`；apply_params 錨點 `命中基底`（`st.hit = `）改為 `命中每敏`（`st.hit = st.agi * `）。
  - **高塔BOSS閃避**（4-高塔BOSS/閃避＝`min(a+樓層*c, b)`）：`bossStatsFor` `Math.min(20 + floor, 10000000)` → `Math.min(20 + floor * 20, 10000000)`；apply_params 新增 `boss閃避加乘`(c)、`boss閃避上`(b) 正則改含 `* [\d.]+`。
- **野外怪物閃避率**（4-野外怪物/閃避率，變動欄＝**新增**）：依「新增列不主動接系統」規約**未接入**（monsterStatsFor 仍 `dodge: 0`），僅留於參數表待明確指示。
- `game_formula.md`：§2.4 命中率改 `敏捷×0.0001 + 加成`、敏捷效果加註「命中 +0.0001%」；§4.3 BOSS 閃避改 `min(20 + f×20, 10000000)%`；`formula.js` §4 註解同步。
- 驗證：`node -c js/formula.js js/data.js tools/apply_params.cjs`；`node --test tests/stat-cap-unlimited.test.cjs tests/enemy-hit.test.cjs`（9/9）；apply_params 試跑 669 一致／0 待變更／0 錨點問題。未執行 --write。
- 註：本批檔案同時被並行 AI 工具（Antigravity）重構（`PRIMARY_STAT_EFFECTS`／`ASPD_CAP`／`blockDmgRedTotalCap`／`capText` 空字串），編輯前後皆以現況為準、以 apply_params 試跑「一致」交叉驗證。

## 變更紀錄：屬性 tooltip 改讀實際公式係數

- `js/data.js`：新增 `PRIMARY_STAT_EFFECTS`、`ASPD_*`、`BLOCK_DMG_RED_BASE` 與格擋減傷 helper；四維 tooltip 改由共用係數產生，係數為 0 的效果不再顯示。`capText` 改為 `cap <= 0` 回傳空字串，因此 tooltip 不再顯示「無上限」。
- `js/formula.js`：生命/法力/攻擊/防禦/暴擊/攻速/閃避/負重等派生公式改讀 `PRIMARY_STAT_EFFECTS`；格擋實戰結算改用 `STAT_CAPS.blockRate` 與 `blockDmgReduction()`，不再硬編 50/85。
- `tools/apply_params.cjs`：玩家屬性派生係數的回寫錨點改到 `PRIMARY_STAT_EFFECTS`/`ASPD_BASE`，保留 CSV 套用能力。
- `css/style.css`：左側屬性面板寬度 220px → 236px，屬性列 label/value 設為 nowrap，避免「對菁英傷害」等文字被拆行。
- `game_formula.md`：同步敏捷閃避係數、cap=0 tooltip 顯示語意、格擋與全局減傷上限來源。
- `tests/attribute-tooltip.test.cjs`：新增動態係數、0 值隱藏、cap=0 隱藏上限文字、格擋上限 helper 與 CSS nowrap 回歸測試；`tests/stat-cap-unlimited.test.cjs` 更新 `capText` 期待值。
- 驗證：`node --test tests\attribute-tooltip.test.cjs`、`node --test tests\stat-cap-unlimited.test.cjs tests\defense-tooltip.test.cjs`、`node tools\apply_params.cjs`（667 一致、0 變更、0 錨點問題）、`node --check js\data.js js\formula.js tools\apply_params.cjs` 通過。未執行 `--write`，未啟動或操作 5500。

## 變更紀錄：修復 apply_params 錨點（命中率／capValue 改動連帶）＋接上新命中率列

- 診斷「閃避率仍顯示上限 40%」：非程式錯誤——參數表（CSV/xlsx）閃避率上限已填 0，但遊戲讀取的 `data.js` `STAT_CAPS.evasion` 仍為 40（尚未經套用參數.bat 寫入）。套用＋重載後即成 0＝無上限。過程中發現先前變更破壞了 `tools/apply_params.cjs` 數個錨點，會在套用時報 ✗ 並略過對應參數，故一併修復：
  - 命中率任務連帶：`mob-aspd`（monsterStatsFor 於 `dodge: 0,` 與 `gold` 間插入了 `hit:` 行，改錨點正則收在 `dodge: 0,`）；`怪物-命中`（`hit: 100`→`hit: m.hit || 100`，錨點改為 `hit: m.hit || `）。
  - capValue 任務連帶：`暴擊率基底`／`暴擊率每敏`／`閃避每敏`（`st.critRate = clamp(`／`st.evasion = clamp(` → `capValue(`）。
  - 既有陳舊錨點：`boss閃避上`（程式為 `Math.min(10 + floor, 1000)`，錨點仍寫 `5 + floor`）改為對基底值容錯的正則。
  - 補接新列：`4-野外怪物/命中率`（`hit = a + 階段×b`）與 `4-高塔BOSS/命中率`（`hit = a + 樓層×b`）各 a/b 兩錨點，使新命中率公式可由參數表調整。
- 驗證：`node -c tools/apply_params.cjs`；試跑 `node tools/apply_params.cjs` → 錨點問題 0、對應參數 667（666 一致、待變更僅 `上限-閃避.evasion 40→0`）。未執行 --write（依規約，套用由使用者自行雙擊 bat）。

## 變更紀錄：屬性上限填 0 代表無上限

- `js/util.js`：新增 `capValue(v, cap)`——`cap > 0` 時夾在 `[0, cap]`，`cap <= 0`（即填 0）時視為無上限、僅保留下限 0。
- `js/formula.js`：`computeStats` 內所有 `clamp(值, 0, STAT_CAPS.X)` 與 `Math.min(值, STAT_CAPS.X)`（暴擊率/穿透/冷卻縮減/施法速度/吸血吸魔/格擋/閃避/韌性/物魔抗/元素抗/控制抵抗/控制時間縮減/移動速度/幸運/合成變異/狂暴閾值/詞條上限/連擊/暈眩）改用 `capValue`；`resolveHit` 的 pRes/mRes 減免同改；`globalDamageReduction` 於 `GLOBAL_DMG_RED_CAP` 為 0 時以 1.0（100%）為上限（即無上限）。
- `js/data.js`：`statFmt` 只在 `cap > 0 && val >= cap` 才做「達上限」金色標示（上限 0 不標金）；新增 `capText(cap, unit, plus)`（0 → 顯示「（無上限）」），屬性面板所有「（上限：…）」說明改用之（含全局減傷說明的無上限分支）。`capText` 不依賴 `fmt`（於 STAT_GROUPS 載入時即呼叫，須自足）。
- `game_formula.md`：§2.4 新增「上限通則（0 = 無上限）」說明，並註明六系元素抗性的 75% 戰鬥結算保護夾值為例外。
- 參數表：現有「2-屬性上限」各列填 0 即生效為無上限，屬純程式語意變更，未新增/改動任何參數列。
- `tests/stat-cap-unlimited.test.cjs`：新增 capValue/capText/statFmt/globalDamageReduction 與 formula.js 已改用 capValue 的回歸測試（5 項）。
- 驗證：`node --check js/util.js js/data.js js/formula.js`、`node --test tests/stat-cap-unlimited.test.cjs`（5/5）、`tests/rarity-colors.test.cjs`（修回 capText 對 fmt 的載入期相依後通過）。全庫 159 通過／14 失敗，該 14 項為既有失敗（使用者持續平衡與 UI/存檔類舊斷言），與本變更無關。

## 變更紀錄：普通敵人與 BOSS 新增命中率屬性

- `js/formula.js`：`monsterStatsFor` 產出 `hit = 100 + 敵人等級×1%`（敵人等級 = 階段）；`bossStatsFor` 產出 `hit = 200 + BOSS 階層×10%`（階層 = 樓層）。戰鬥核心 `resolveHit` 原已支援 `aCfg.hit`（命中率 = clamp(命中 − 玩家閃避, 5%, 100%)），本次改由敵人自身命中率驅動。
- `js/combat.js`：`spawnFieldMonster` 敵人物件帶入 `hit: base.hit`；`monsterAtkCfg` 由寫死 `hit: 100` 改為 `hit: m.hit || 100`（野外與高塔 BOSS 皆走此組態）。
- `js/tower.js`：`makeBoss` BOSS 物件帶入 `hit: bs.hit`。
- `game_formula.md`：§3.6 移除「命中 100%」的過時敘述；§4.1、§4.3 各補命中率公式。
- 參數表（手動加列，僅新增自己的兩列、未動其他列，未執行套用參數.bat）：`config/CSV/game_parameters.csv` 於 4-野外怪物段（攻擊速度後）、4-高塔BOSS段（BOSS 等級後）各加「命中率」列（編號 445／446、變動欄「調整」）；`config/Excel/game_parameters.xlsx` 同位置插入——game_parameters 鏡像分頁以自足字面值插入兩列並修正被下移列的 `=計算表!` 參照列號，計算表分頁（含串接編號公式）不動；移除失效的 calcChain.xml 交由 Excel 重建。以 `tools/xlsx_to_csv.cjs` round-trip 驗證：重生 CSV 與手改 CSV 僅差使用者自管的閃避率上限一列。
- `tests/enemy-hit.test.cjs`：新增怪物／BOSS 命中率公式與 combat／tower 命中率接入的回歸測試（4 項）。
- 驗證：`node --test tests/enemy-hit.test.cjs`（4/4 通過）、`node --check js/formula.js js/combat.js js/tower.js` 通過。全庫 `node --test "tests/*.test.cjs"` 為 152 通過／15 失敗，該 15 項為既有失敗（使用者持續平衡調整，如經驗 `^2.2` 與 BOSS 生命/攻擊倍率 ×30／×3 vs 舊斷言 ×22／×1.9），與本次命中率變更無關。

## 變更紀錄：高塔連續挑戰結算倒數

- `js/tower.js`：連續挑戰結束一場時不再直接跳過結算；會保留勝利/失敗結果，記錄連挑進度，等結果面板確認後才收場並啟動下一場。
- `index.html`、`js/ui.js`：高塔結果面板支援連挑倒數與「終止連續」按鈕；連挑時確定按鈕顯示 3 秒倒數並暫時禁用，倒數結束自動關閉；按下終止連續會取消倒數、停止後續連挑，單場挑戰維持普通「確定」按鈕。
- `tests/tower-auto-result.test.cjs`：新增連挑結果面板與倒數自動確認回歸測試。
- 驗證：`node --test tests\tower-auto-result.test.cjs tests\stats-panel.test.cjs tests\player-shield-bar.test.cjs`、`node --check js\tower.js`、`node --check js\ui.js` 通過。

## 變更紀錄：護盾條滿值重設

- `js/formula.js`：護盾被打空時清除 `shieldMax`；溢出治療新增護盾時用當前護盾重設滿條基準，且不再把既有高護盾壓回治療轉化上限。
- `js/skills.js`：技能護盾改為同一狀態刷新，不再用已被技能放大的護盾反覆乘算；同技能重放只刷新到護盾基準換算後的值。
- `js/ui.js`：護盾條分母移除舊版 `最大生命 × 50%` fallback，改為只看目前護盾層的 `shieldMax`；新增版本遷移，會把舊 runtime 產生的爆炸護盾壓回目前技能可建立的合理值。
- `game_formula.md`：同步補充護盾條滿值與溢出治療護盾上限規則。
- `tests/skill-gcd.test.cjs`、`tests/player-shield-bar.test.cjs`、`tests/shield-max.test.cjs`：補上舊分母重設、同技能不疊加、護盾打空清除、溢出治療不降低高護盾與 UI 分母 fallback 移除的回歸測試。
- 驗證：`node --test tests\shield-max.test.cjs tests\skill-gcd.test.cjs tests\player-shield-bar.test.cjs tests\defense-tooltip.test.cjs`、`node --check js\formula.js`、`node --check js\skills.js`、`node --check js\ui.js`、`node --check js\combat.js`、`node --check js\player.js`、`node --check js\data.js` 通過。

## 變更紀錄：護盾技能乘法加成與防禦減傷小數顯示

- `js/skills.js`：護盾技能改為依「目前護盾」做額外乘法加成；例如目前 10T、技能護盾 +500% 時，結果為 60T。若目前沒有護盾，改以最大生命作為起盾基礎。
- `js/ui.js`、`js/formula.js`、`js/combat.js`、`js/player.js`：新增並維護 `shieldMax`，讓護盾條可用本次護盾實際最高值作為滿條分母。
- `js/data.js`：防禦 tooltip 的同級減傷率改為固定小數 4 位並向下截斷，不會把接近 100% 的值四捨五入成 100%。
- `game_formula.md`：同步更新護盾技能公式說明。
- `tests/skill-gcd.test.cjs`、`tests/player-shield-bar.test.cjs`、`tests/defense-tooltip.test.cjs`：補上乘法護盾、動態護盾滿條、防禦減傷截斷顯示測試。
- 驗證：`node --test tests\skill-gcd.test.cjs`、`node --test tests\player-shield-bar.test.cjs`、`node --test tests\defense-tooltip.test.cjs`、`node --check js\skills.js`、`node --check js\ui.js`、`node --check js\data.js`、`node --check js\formula.js`、`node --check js\combat.js`、`node --check js\player.js` 通過。

## 變更紀錄：護盾條比例修正與防禦 tooltip 減傷率

- `js/ui.js`：護盾條寬度改用目前可達護盾上限作為分母，不再用最大生命值；高護盾剩餘少量時會正確顯示接近空條。
- `js/skills.js`：技能給予護盾時不再把既有高護盾壓低到技能護盾上限，避免高額溢出治療護盾被覆蓋成 50% 生命。
- `js/data.js`：物理防禦、魔法防禦 tooltip 底部新增黃色「目前同級減傷率」。
- `tests/player-shield-bar.test.cjs`、`tests/skill-gcd.test.cjs`、`tests/defense-tooltip.test.cjs`：補上護盾條分母、技能護盾不降值、防禦 tooltip 減傷率測試。
- 驗證：`node --test tests\player-shield-bar.test.cjs`、`node --test tests\skill-gcd.test.cjs`、`node --test tests\defense-tooltip.test.cjs`、`node --check js\ui.js`、`node --check js\skills.js`、`node --check js\data.js` 通過。

## 變更紀錄：統計面板加入死亡數

- `js/stats.js`：統計桶新增 `deaths`，加入 `recordLootDeath()`，基本統計在「殺敵數」下方顯示「死亡數」，來源統計也會列出死亡次數。
- `js/combat.js`：野外我方死亡時記錄 `field` 死亡數。
- `js/tower.js`：高塔挑戰因我方死亡失敗時記錄 `tower` 死亡數。
- `tests/stats-panel.test.cjs`：補上死亡數累計、重置、來源分桶、HTML 顯示與戰鬥掛勾測試。
- 驗證：`node --test tests\stats-panel.test.cjs`、`node --check js\stats.js`、`node --check js\combat.js`、`node --check js\tower.js` 通過。

## 本次變更摘要：尋寶直覺減半 + 技能點總預算接線 + xlsx 中文說明標註(batch 2c)

- 尋寶直覺(skills.js)效果減半：掉寶增益 base 30→15/per 10→5；4轉 45/12→22.5/6；8轉 goldPer 10→5（持續時間不變）。
- 技能點總預算：新增常數 `SKILL_POINT_BUDGET_CAP=10000`(data.js)取代 skills.js/save.js 4 處寫死；apply 接上初始(player.js)、每級(player.js)、上限(常數)。參數總數 660→663，錨點問題 0。
- 新增 `tools/xlsx_annotate.cjs`：處理本 xlsx 的雙表結構(計算表＝資料源共享字串、game_parameters＝=計算表!Fn 公式鏡像)，為 27 個結構/停用/重複/資訊列在「中文說明」附加標註（空白列直接以註記為說明、必要時於計算表插入 F 格並同步 sheet1 公式快取）；純 Node、store 重建 ZIP、zlib.crc32。
- 已對真實 xlsx 套用 27/27 標註（寫入前備份），重生 CSV 445×18，apply 錨點問題 0。註記僅動「中文說明」欄，不影響任何數值。

## 本次變更摘要：分散敵人傷害浮字並縮小字號

- `js/ui.js`：新增敵人傷害浮字判斷，只對 `mv-float-*` / `tb-float` 上的 `dmg`、`mdmg`、`crit`、`skill` 套用 `enemy-hit-float`；X 軸隨機範圍由 15%-85% 擴為 8%-92%，Y 軸改為 28%-72% 加少量抖動，避免集中在血條附近。
- `css/style.css`：敵人一般傷害字由 14px 降到 12px；暴擊/技能傷害由 20px 降到 18px；多人敵人版也同步各降 2px。
- `tests/player-event-float.test.cjs`：補上敵人傷害浮字大小與隨機範圍檢查。
- 驗證：`node --test tests\player-event-float.test.cjs`、`node --check js\ui.js`、`node --check js\combat.js`、`node --check js\skills.js` 通過。

## 本次變更摘要：batch 2b — 擴充 apply 涵蓋跨檔 + 補接 13 項（含護盾改 1%/10%）

- `apply_params` `FILES` 由 {data,formula} 擴充為含 combat/item/skills/player/save（src/備份/寫入/語法檢查皆依 FILES 迭代，自動涵蓋）。
- 補接：護盾（新增 formula.js 常數 SHIELD_OVERFLOW_PCT/SHIELD_HEAL_CAP_PCT，依使用者決定改為 1%/10%）、菁英倍率(formula.js 6 值，金幣/經驗共用 c)、怪物固定戰鬥值(combat.js 暴擊/暴傷/命中；玩家設定用 st.xxx 無數字故錨點只中怪物行)、野外菁英掉落倍率(combat.js)、寶石商店刷新週期(item.js 新增常數 GEM_SHOP_REFRESH_HOURS)。參數總數 647→660，dry-run 錨點問題 0。
- 驗證：實跑 --write 改菁英hp/怪物暴擊/商店刷新 → 正確寫入對應檔(formula/combat/item)，且玩家 critRate 與其他菁英倍率未被誤動。
- 修正流程疏失：先前 --write 測試（apply 會寫全部 FILES）誤把使用者待套用的掉落表值套進 data.js 未還原；已從 batch1 乾淨備份還原 data.js（保留 STAT_CAPS、回退使用者掉落值交其自行套用），3 個掉落表測試恢復通過。
- 未接（batch 2c/待議）：技能點總預算（跨 player/skills/save 多處、需常數化 10000 上限）；結構/停用/資訊/重複列改 xlsx 中文說明。

## 本次變更摘要：稽核參數表接線缺口 + 補接 formula.js 15 項（batch 2a）

- 以執行期實測稽核 apply_params 讀取涵蓋：全表 444 列，396 已讀，48 未接。分類：可接單值、結構、停用(合成)、資訊/指標列、重複、寫死分數。
- batch 2a 補接 formula.js 內漏接的可調單值（多值行用正規式避免相依錨點失配）：轉生經驗倍率、附魔書/自動機組零件掉率、高塔獎勵(零件階級/金幣/寶石/附魔精華/裝備等級 a+b)、戰力評分(神鑄每條 a/稀有度 b)、背包擴充費用、寶石轉換(格數/堆疊)、寶石拆解保留率。參數總數 632→647，dry-run 錨點問題 0。
- 驗證：實跑 --write 改附魔書/高塔金幣/寶石轉換/裝備等級 → 皆正確寫入，且 `gold: Math.round(` 的另外三處(分解/寶石金幣)未被誤動。
- 待辦（batch 2b/2c）：擴充 apply_params 涵蓋 combat.js/item.js/skills.js 以接菁英倍率、怪物固定戰鬥值、菁英掉落倍率、寶石商店刷新週期、技能點總預算；其餘結構/停用/資訊/重複列改寫 xlsx 中文說明標註。
- 待使用者確認（值不一致）：溢出治療轉護盾(CSV 1 vs 程式 50%)、護盾上限治療轉化(CSV 10 vs 程式 15%)、全局減傷上限(2-屬性上限 85 vs 已生效 GLOBAL_DMG_RED_CAP 95)。

## 本次變更摘要：加深 MISS 浮字紅色

- `css/style.css`：將 `.float-txt.miss` 從偏橘色改為較深紅 `#dc2626`，並增加深紅外光與黑色陰影，讓敵人身上的 MISS 更清楚。
- `tests/player-event-float.test.cjs`：補上 MISS 浮字顏色與陰影檢查。
- 驗證：`node --test tests\player-event-float.test.cjs`、`node --check js\combat.js`、`node --check js\skills.js` 通過。

## 本次變更摘要：補回玩家護盾條渲染

- `js/ui.js`：補回 `renderPlayerShieldBar()`，野外玩家 `pv-shield` 與高塔玩家 `tp-shield` 會依目前護盾值顯示/隱藏並更新寬度。
- `js/ui.js`：新增 `playerShieldText()`，血條文字仍保留原本的 `+護盾值` 顯示，避免護盾條與文字其中一邊被改丟。
- 驗證：`node --test tests\player-shield-bar.test.cjs`、`node --check js\ui.js` 通過。

## 本次變更摘要：屬性上限收斂為單一來源 STAT_CAPS（夾限/顯示/提示同步）+ apply 取代定位修正

- 問題：改上限只有 `computeStats` 的 clamp 生效，面板顯示與提示文字（`（上限：N%）`）仍是舊值——因為上限值散落在 clamp、statFmt、tip 文字（甚至傷害計算的抗性 clamp）各處，apply 只改了 clamp。
- 修法：新增單一來源 `STAT_CAPS`（data.js，23 項），`formula.js` 全部 clamp/Math.min（含傷害計算 pRes/mRes）改引用 `STAT_CAPS.X`；`data.js` STAT_GROUPS 面板顯示的 statFmt 上限與提示文字改由 `STAT_CAPS.X` 組出；全局減傷上限沿用既有 `GLOBAL_DMG_RED_CAP`（面板提示同步引用之）。`apply_params` §2 屬性上限的接線由「改 formula.js clamp 數字」改為「寫 data.js `STAT_CAPS.X`」（objFieldML）。
- 連帶修正 apply 取代定位 bug：`applyOne` 的套用順序改以「被取代群組的起點」排序（原為 match 起點）。同一行若有多筆同起點 edit（如 `gold-a` 改基底、`gold-c` 改冪次，皆自 `var gold =(` 起算），舊排序會讓前者的長度變化位移後者、寫壞成 `Math.pow(11.05 stage - 1)`；改以群組實際位置由後往前套用後正確。
- 驗證：改「冷卻縮減上限 60→70」套用後 `STAT_CAPS.cdr=70`、clamp 用 70、面板提示同步顯示「上限：70%」，且 gold 行正確 `(20 + stage) * Math.pow(1.05, stage - 1)`；apply dry-run 錨點問題 0。
- 註：全局減傷上限（2-屬性上限）為與「2-屬性派生/全局減傷」重複之列，未接（實由後者控制）；待中文說明批次標註。
- 測試：13 失敗均與本次無關（2 既有 CSS、2 使用者自行改值 xp次方2.2/全局減傷95、9 為使用者開發中 UI 功能測試如 renderPlayerShieldBar 尚未實作）。

## 本次變更摘要：修復階段前進/後退與提示位置

- `index.html`：將前進/後退關卡按鈕的 tooltip placement 改為 `stage-right` / `stage-left`，避免提示框蓋住中央關卡階段文字。
- `js/ui.js`：補回前進/後退按鈕的長按邏輯，按住 300ms 後以每 50ms 一次切換，等同每秒 20 關；一般點擊也會立即刷新階段顯示。
- `js/ui.js`：`showStatTooltip()` 新增階段按鈕外側定位，並保留視窗邊界夾取。
- `js/ui.js`：同控制列的暫停戰鬥按鈕補回 `toggleCombatPaused()` 綁定與 `aria-pressed` / 文案刷新。
- 驗證：`node --test tests\stage-jump-ui.test.cjs`、`node --test tests\combat-pause.test.cjs`、`node --check js\ui.js` 通過。

## 本次變更摘要：修正野外怪物成長錨點（gold-c 依賴 gold-a 值而失配）

- 現象：套用時 `gold-c 錨點匹配 0 次` 而中止（安全機制未寫壞檔）。與使用者「空白填 0」無關。
- 根因：`gold-c` 錨點寫死 `(5 + stage) * Math.pow(`，但先前套用已把 gold-a 由 5 改成 100（現為 `(100 + stage)`），錨點便找不到。同類脆弱錨點還有 hp-b/c、atk-b/c、def-b/c、xp2-c——它們都寫死了同一行的 a（與 b）值，使用者只要調 a/b 就會讓 b/c 錨點失配。
- 修法：把野外怪物成長 `var X = (a + stage [* b]) * Math.pow(c)` 的 b/c 錨點改為正規式、以 `[\d.]+` 萬用掉同行的 a（與 b），並以 `var X =` 定行確保唯一（`grp:2`，前綴成群組）。a 錨點本就穩健，不動。
- 驗證：dry-run 錨點問題 0；實跑 `apply --write` 套用 13 項（含掉落表/寶石表 0 值、hp-c、xp2-c、gold-c）通過 node --check，金幣行正確 `var gold = (100 + stage) * Math.pow(1.06 …)`，驗證後還原交使用者自行套用。
- 附註：使用者「空白格填 0」不影響——清單型表（掉落表/寶石/成對表）本就會略過補位 0，其餘尾端 0 也不被讀。

## 本次變更摘要：玩家事件浮字移到頭像區並補齊提示

- `util.js`：新增 `floatPlayerEvent()`，依野外/高塔自動把玩家事件提示送到 `pv-float` 或 `tp-float`。
- `css/style.css`：新增 `.float-txt.player-event`，將玩家閃避、格擋、護盾、buff/debuff 取得提示固定顯示在頭像區，不再和傷害/補血數字混在血條與狀態列附近；並依效果分類分色：護盾/法力藍、攻擊/攻速/爆傷橘、掉寶/特殊金、防禦/再生綠、負面紅。
- `combat.js`：怪物攻擊玩家時，閃避、格擋、護盾吸收、元素/不朽等 proc 會額外顯示玩家事件浮字；普攻吸血/吸魔提示也修正為依野外/高塔顯示在正確玩家浮層；我方攻擊被閃避的 `MISS` 改為固定顯示在敵方浮層。
- `skills.js`：技能獲得護盾、再生、淨化、回魔、buff 與 buff2 都會跳玩家事件浮字；原本只套用不顯示的第二 buff 也補進戰鬥日誌；技能傷害與技能 `MISS` 改用敵方浮字 helper，避免回落到我方面板。
- 驗證：`node --test tests\player-event-float.test.cjs tests\skill-gcd.test.cjs`、`node --test tests\player-shield-bar.test.cjs tests\tower-xp.test.cjs tests\combat-pause.test.cjs`、`node --check js\util.js`、`node --check js\combat.js`、`node --check js\skills.js`、`node --check js\ui.js` 通過。

## 本次變更摘要：修正 apply_params 兩個取代定位 bug（多筆同物件/同檔變更會寫壞數字）

- 現象：套用 `套用參數.bat` 時 node 語法檢查失敗（如 `hpMult: 1.25.2`、`rewardMul1.5: 3`），安全機制自動還原，未寫壞磁碟。
- **Bug1（群組定位）**：`objField`/`objFieldML` 以「整段 match 內第一個相同數字字串」定位要取代的數字（`grp:1`＋`whole.indexOf(gtext,0)`），導致 `rewardMult` 的 `2` 誤中前面 `hpMult: 2.2` 的 `2`。修法：把前綴（keyAnchor→field:）獨立成群組1、數字為群組2（`grp:2`），定位時從前綴之後才找數字（與 `scalar`/`inline` 一致）。此 bug 過去因該值未變（2→2 不觸發取代）而未爆。
- **Bug2（多筆取代位移）**：同檔多筆變更以「由前往後」順序套用，前面較長/較短的取代會位移後面尚未套用之錨點的絕對位置，使後者寫錯位（如 `rewardMult` 的 `t` 被覆蓋）。修法：在 result 記錄目標絕對位置 `pos`，套用時 `changes.sort((a,b)=>b.pos-a.pos)`「由後往前」套用。
- 驗證：實跑 `apply --write` 套用 12 項（含 荒漠/沼澤 rewardMult、MAX_LEVEL、次方、mob-aspd 等）→ 通過 node --check，場景行正確（`荒漠 …aspdMult:1.5, rewardMult:1.25`、`沼澤 …aspdMult:2, rewardMult:1.5`），驗證後還原檔案交由使用者自行套用。dry-run 錨點問題 0；測試 149/151（2 失敗為既有 CSS 測試）。

## 本次變更摘要：寶石合成選單預設全部類型

- `js/ui.js`：寶石合成的「全部類型寶石」選項改為下拉選單第一個，並以黃色粗體顯示、預設選中；轉換與拆解選單不受影響。
- `tests/gem-compose-all.test.cjs`：新增檢查全部類型寶石置頂、標黃、預設選中的測試。
- 驗證：`node --test tests\gem-compose-all.test.cjs`、`node --check js\ui.js` 通過。

## 本次變更摘要：場景倍率新增「攻速倍率」（與基礎攻速相乘）

- 使用者於參數表「4-場景倍率」在 c(防禦) 後插入 d=攻速倍率，欄位順序變為 a生命 b攻擊 c防禦 d攻速 e獎勵 f解鎖。
- `data.js` ZONES 各場景新增 `aspdMult`：草原 1、荒漠 1.5、沼澤 2。
- `combat.js`：野外怪 `aspd` 與初次 `atkCd` 改用 `mAspd = base.aspd × zn.aspdMult`（與基礎攻速相乘；對普通/菁英皆生效，因 base.aspd 已含菁英 1.25）。高塔 BOSS 走 tower.js，不受影響。
- `apply_params.cjs`：場景倍率接線新增 `aspdMult`(index 3)，並把 `rewardMult` 由 index 3 改為 index 4（因插欄位移）。參數總數 629→632。
- `game_formula.md` §4.1/§4.2 同步：野外攻速註明為「基礎，另乘場景攻速倍率」；場景表加入攻速欄與相乘說明。
- 驗證：apply aspdMult 一致、0 錨點問題；實測 荒漠普通怪 1.125/秒、沼澤菁英 2.5/秒；測試 148/150（2 失敗為既有 CSS 測試）。
- 註：未動使用者其他數值調整（apply 顯示 10 項待套用值，含 reward/等級上限/次方等，均由使用者自行雙擊 bat 套用）。

## 本次變更摘要：拿掉野外敵方初次出手的 +0.4 秒延遲

- 需求：戰鬥開始時敵方原有「1/攻速 + 0.4 秒」的初次出手延遲，拿掉那 0.4 秒的額外延遲；我方不變。
- `combat.js:76`：野外怪初次 `atkCd` 由 `1 / base.aspd + 0.4` 改為 `1 / base.aspd`（與玩家 combat.js:31 相同時機，雙方對等）。
- 未動：玩家（combat.js:31，照舊）；高塔 BOSS 初次 `atkCd` 為固定 `1.5`（tower.js:33，不是 0.4，非本次範圍）。
- `game_formula.md` §3.6 同步：野外怪初次出手延遲 `1/攻速`（無額外延遲）。
- 驗證：野外怪 aspd 0.75 → 初次出手 1.333 秒（原 1.733 秒）；測試 148/150（2 失敗為既有 CSS 測試）。

## 本次變更摘要：野外死亡改為退 10 關續打

- `data.js`：新增 `FIELD_DEATH_STAGE_RETREAT = 10`，作為野外死亡回退階段數。
- `combat.js`：玩家野外死亡後不再固定回第 1 階，而是退回 `目前階段 -10`，最低夾到第 1 階；歷史最高階段保留，敵人清空、擊殺數歸零、復活倒數維持 3 秒。
- `game_formula.md`：同步更新玩家死亡與每波推進規則描述。
- 驗證：`node --test tests\field-death-retreat.test.cjs`、`node --check js\combat.js`、`node --check js\data.js` 通過。

## 本次變更摘要：玩家護盾改為血條上方細藍條顯示

- `index.html`：野外玩家血條與高塔玩家血條內新增 `shield-bar` 層，直接疊在血條上方，不改動頭像、名稱、MP、技能或狀態資訊的位置。
- `css/style.css`：新增 `.shield-bar`，以絕對定位顯示 3px 淺藍護盾條，顏色比法力條更淡，且不佔排版高度；血條允許上方護盾條溢出顯示，並保留最小可視寬度。
- `js/ui.js`：新增 `renderPlayerShieldBar()`，依玩家護盾量更新護盾條寬度；原本血量文字中的 `+護盾值` 保留不變。
- 驗證：`node --test tests\player-shield-bar.test.cjs`、`node --check js\ui.js` 通過。

## 本次變更摘要：神鑄系統解鎖改為「等級 + 轉生次數」雙條件（編號7 調整）

- 編號7「神鑄系統解鎖等級」新增第二條件：需**同時**滿足 等級 ≥ 解鎖等級（a）**且** 轉生次數 ≥ 解鎖轉生次數（b）才開放；解鎖後仍永久保留。
- `data.js`：新增 `FORGE_UNLOCK_REINCARNATION`（＝b）；`FORGE_UNLOCK_LEVEL` 依 CSV 為 a。
- `forge.js`：`forgeUnlocked()` 條件由「`reincarnationCount()===0 && level>=FORGE_UNLOCK_LEVEL`」改為「`level>=FORGE_UNLOCK_LEVEL && reincarnationCount()>=FORGE_UNLOCK_REINCARNATION`」。
- `apply_params.cjs`：新增接線 `FORGE_UNLOCK_REINCARNATION`（神鑄系統解鎖等級 param b）。參數總數 628→629。
- `ui.js`：解鎖提示訊息補上「轉生 N 次」條件。
- `game_formula.md` §1.1 與 `tests/forge-unlock.test.cjs` 同步為雙條件邏輯（測試改以兩常數表述，不寫死數值）。
- 驗證：forgeUnlocked 實測「等級9999 轉生0→鎖定、等級5 轉生2→開放」；測試 142/144（2 失敗為既有 CSS 測試）。
- 註：本次未套用 CSV 中另外 3 個非本請求的值變更（MAX_LEVEL/可轉生等級 1000→9999、次方 3→2.2），留待使用者確認後由 套用參數.bat 套用。

## 本次變更摘要：實作參數表「調整」標記的公式（升級經驗基礎增加值 + 等級上限分離）

- 「變動」欄新增第三種標記 `調整`（＝要求修改現有公式），並把三態語意（空白/0＝原有、`新增`＝待命不接、`調整`＝依說明實作）寫入 `AI_RULES.md`、`tools/參數表使用說明.md` 與長期記憶。
- 依使用者確認實作 12 列「調整」：
  - **升級經驗基礎增加值**（轉生對照表新增 c 欄）：`xpForLevel` 改為括號外相加 `⌊(30×等級^b+40)×轉生經驗倍率 + 基礎增加值⌋`。新增 `REINCARNATION_EXP_BASE_ADD = [0,100000,300000,…,1968300000]`（轉生 0 次為 0；1~10 次＝`100000×3^(n-1)`）與 `reincarnationExpBaseAdd()`。轉生 0 次時基礎值為 0，故未轉生玩家的相對曲線不變。
  - **升級次方 b：2 → 3（立方成長）**：使用者於 xlsx 把 `升級所需經驗` 參數 b 由 2 改為 3，經 apply 套用為 `Math.pow(l, 3)`。連帶把 apply 的 xp-c（常數 40）錨點由寫死 `Math.pow(l, 2) + ` 改為以 `Math.pow(l, <任意次方>) + ` 比對（次方本身可被調整，錨點不得依賴其值）。`game_formula.md` 與 `tests/xp-formula.test.cjs` 同步為立方。
  - **等級上限與可轉生等級分離**：`升級所需經驗` 參數 d＝等級上限 → 新增 `MAX_LEVEL = 1000`（原本升級/存檔夾限都用 `REINCARNATION_LEVEL=9999` 兼作上限）。升級迴圈與存檔夾限（player.js:88/98、save.js:348）改用 `MAX_LEVEL`；轉生觸發條件（player.js:118、ui.js）仍用 `REINCARNATION_LEVEL`。兩者現皆為 1000（可轉生等級 9999→1000）。
- `apply_params.cjs` 新增兩處接線：`MAX_LEVEL`（升級所需經驗 param d）、`REINCARNATION_EXP_BASE_ADD`（轉生 1~10 param c，索引 0 固定 0）。參數總數 626→628。
- `game_formula.md` §1 同步：升級經驗公式、等級上限 9,999→1,000、可轉生等級說明。
- 驗證：apply 試跑 628 一致、0 錨點問題、0 變更；VM 實算 xpForLevel 各轉生數皆正確（轉生0 L1=70 不變、轉生1 L1=100700、轉生10 L1=701968300000）；測試 141/143（2 失敗為既有 CSS 同步測試）。
- 註：轉生 0 次列在 xlsx 仍為舊排版（名稱在 c 欄），已於接線時把索引 0 固定為 0 處理；階級名稱與技能上限本就不由 CSV 驅動（硬編碼於 data.js），值未變。

## 本次變更摘要：新增「變動」欄 + 讀取邏輯改為以表頭名稱定位（抗欄位位移）

- 使用者在 Excel 於「編號」後插入「變動」欄（空白=原有公式、新增=本次新增），使「系統分類/名稱/參數」整體右移一格。
- `apply_params.cjs`：讀取欄位改為**以表頭名稱動態定位**（`系統分類`/`名稱`/`參數a` 用 `header.indexOf` 找欄位),不再寫死 `r[1]/r[2]/r.slice(5)`。日後再插欄也不會錯位;`編號`、`變動`等註記欄一律忽略。找不到必要表頭欄會明確報錯。
- 修 Excel「空格自動填 0」造成的清單表破壞：使用者在 Excel 編輯後,原本留空的參數格被填成 `0`。單值列不受影響(依索引取值,不讀尾端補位格);但**成對表**(寶店刷出數量/階級)會把 `0` 誤當成 `數量=機率`。修法:`rebuildPairTable` 只取含 `=` 的格(空格與 `0` 補位一律略過);`parseTuple` 對空格/純數字 0 的「空 bracket」回傳 `0`(該區段 0% 掉落)。野外裝備/高塔/野外寶石掉落表經查讀取位置皆為有效值,不受影響。
- `xlsx_to_csv.cjs`：欄寬下限 17→18(6 基本欄 + 參數 a..l);表頭自動驅動,實際輸出 448 列×18 欄。
- 提醒:使用者新增的「轉生 11/12/13 次」列可被正確解析,但 `apply_params` 目前只接 `轉生 1~10 次`(迴圈上限 10),故這 3 列尚不會生效——需另行擴充遊戲端轉生上限程式才會作用。
- 驗證:xlsx→csv→apply 試跑 626 參數一致、錨點問題 0;測試 136/138 通過(2 失敗為既有 CSS 同步測試,與本次無關)。

## 本次變更摘要：改用 Excel 當來源（xlsx → CSV → 遊戲）

- 需求：使用者要用 Excel 高效調數值。新結構 `config/Excel/game_parameters.xlsx`（工作表 `game_parameters`）為主檔，`config/CSV/game_parameters.csv` 改為「自動產生」的中繼檔。
- 新增 `tools/xlsx_to_csv.cjs`（純 Node，用內建 zlib 解 xlsx 的 ZIP，不需任何套件；直接讀位元組，**Excel 開著也能轉**）：以工作表「名稱」定位 `game_parameters`，解析 sharedStrings/inlineStr/公式快取值，數字走 Number 最短往返洗掉 Excel 滿精度雜訊，輸出 UTF-8 BOM + CRLF + RFC-4180 引號。**產出與原手工 CSV byte-identical**（445 列×17 欄）。
- `套用參數.bat` 改為兩步：[1/2] `node tools/xlsx_to_csv.cjs`（xlsx→CSV）→ [2/2] `node tools/apply_params.cjs --write`（CSV→遊戲＋更新權杖）。任一步失敗即停並顯示原因。
- `apply_params.cjs` 預設讀取路徑改為 `config/CSV/game_parameters.csv`（原為根目錄）。`PARAMS_CSV` 環境變數覆寫不受影響。
- `.vscode/settings.json` 的 Live Server 忽略清單改為排除整個 `**/config/**`（xlsx 與 csv 存檔皆不觸發重整）。
- `.gitignore` 加入 Excel 鎖定暫存檔 `~$*.xlsx`。
- 文件同步：`tools/參數表使用說明.md`（改寫為 Excel 流程；移除已不適用的「Excel 破壞 CSV」警語，改提醒「別把格子設成百分比格式」與「套用前先存檔」）、`GM_command.md` §10.5。
- 驗證：xlsx→CSV byte-identical；apply_params 對 config/CSV 試跑 626 參數一致、錨點問題 0、變更 0（恆等）；缺檔時轉換 exit 2 讓 .bat 正確落到失敗分支；兩支 .cjs `node --check` 通過。

## 本次變更摘要：存檔 CSV 不再觸發重整（Live Server 忽略設定）

- 現象：存檔 game_parameters.csv 也會讓遊戲重整一次。根因是 VS Code Live Server 監看整個資料夾、任何檔案變動都重整（本專案的 param_autoreload.js 只監看 params_version.txt，不監看 CSV，並非它造成）。
- 修正：新增 `.vscode/settings.json` 的 `liveServer.settings.ignoreFiles`，排除 `game_parameters.csv`、`params_version.txt`、`js/data.js`、`js/formula.js`。如此 Live Server 在調參流程中不再自行重整，改由 param_autoreload.js（偵測 params_version.txt）在「套用時」重整「一次」。
- 效果：改 CSV 存檔 → 不重整；雙擊 套用參數.bat → 只重整一次。（Live Server 需停止再重啟才生效。）
- 另修 .gitignore：把先前誤接成 `test-results/params_version.txt` 的一行拆正，`params_version.txt` 正確被忽略。

## 本次變更摘要：簡化為「雙擊 套用參數.bat → 遊戲自動重載」

- 使用者只想雙擊一個 .bat 就套用並讓遊戲自動重整，不必再啟動伺服器＋按遊戲內按鈕。
- apply_params.cjs 成功寫入後更新根目錄 `params_version.txt`（時間戳權杖）。
- 新增 `js/param_autoreload.js`（僅 localhost）：每 2 秒讀 `params_version.txt`，內容一變即 `location.reload()`，套用後不必手動 F5。
- `套用參數.bat` 改為直接執行 `apply_params --write`（CRLF、正斜線、`where node` 檢查、成功自動關窗、失敗才 pause）。
- 移除上一版的左上角「套用參數」按鈕（js/apply_button.js）、本機套用伺服器（tools/apply_server.cjs）與「啟動套用伺服器.bat」——不再需要常駐伺服器。index.html 改載入 param_autoreload.js。
- `params_version.txt` 加入 .gitignore（避免每次套用造成 git 變動）。
- 實測：開著遊戲頁面→套用 c=1.05→1.2→遊戲約 2 秒內自動重載，怪物 stage50 HP 4,696→3,260,990；主控台 0 錯誤。

## 本次變更摘要：一鍵套用參數按鈕（取代 GM reload）+ 修復 Excel 破壞 CSV

- 修復 Excel 破壞：寶石商店「刷出數量/階級」表原用 `數量:機率`，Excel 存檔會把含冒號的格當「時間」轉成亂碼（如 `1:75`→`0.09375`）。改用 Excel 安全的 `=` 分隔（`1=75`）；apply_params 與載入器加數值防呆：偵測到無法解析為數字的格一律中止（不寫 NaN）／跳過。重生乾淨 CSV，round-trip 626 全一致。
- 新增本機「套用伺服器」`tools/apply_server.cjs`：綁 127.0.0.1:8790、只接受 localhost 來源、只代跑 `apply_params --write`；配 `啟動套用伺服器.bat`。瀏覽器無法寫檔，故由此伺服器代寫。
- 新增遊戲左上角「⚙️ 套用參數」按鈕 `js/apply_button.js`：僅 localhost 建立（外部玩家看不到用不到），插入 topbar 最左；按下呼叫伺服器套用，成功後自動 `location.reload()`，永久生效且涵蓋內嵌係數；伺服器未啟動時提示先雙擊 .bat。
- 移除舊的 GM `reload game_parameters` 文字指令與即時記憶體重載 `js/param_reload.js`（改由按鈕＋伺服器＋重載取代）。
- 另補 `套用參數.bat`（雙擊：試跑→確認→寫入）給不想用按鈕者。
- 實測：伺服器啟動→按鈕→寫入 data.js（RESPAWN_DELAY 0.8→0.9）→自動重載→值生效；伺服器關閉→按鈕顯示「連不到套用伺服器」提示並復原。測試 135/137（2 為既有 css 測試不同步）。
- 修正 .bat 一開就閃退：兩個 .bat 原為 LF 行尾（cmd.exe 會出錯閃退），改為 CRLF；node 路徑改用正斜線避免轉義掉字；加 `where node` 檢查與失敗時的清楚訊息＋always pause。以 Start-Process 直接執行 .bat 實測可正常啟動伺服器。按鈕失敗時另加 alert 彈窗避免使用者沒注意（例如忘了啟動伺服器）。

## 本次變更摘要：融合技效果改為「動態重算」（不存 fx 快照）

- **目的**：融合技原本把聚合後的 `fx` 直接快照存檔，事後調整素材技能（SKILLS/UNLOCKS）定義既有融合技不會跟著變。改為只存「素材 id＋融合時等級（凍結）＋變異」，`fx` 由 `skillDef()` 依素材技能**現行定義**即時重算。
- **`js/skills.js`**：
  - 抽出純函式 `fusionAggregateFx(comps)`（原 `fuseSkills` 內的 fx 聚合邏輯，供融合與重建共用）。
  - 新增 `applyFusionMutationByKey(fx,key)`（依 key 重套變異，`req(fx)` 通過才套，避免缺欄位崩潰）。
  - 新增 `buildFusionRuntimeDef(rec)`（以 `SKILLS[素材]` 現行定義 + 凍結 `componentLevels` + 已存 `mutation` 重算 fx；素材技能缺失回 null）。
  - 新增模組層快取 `_fusionRtCache` 與 `resolveFusionRecord(rec)`（依記錄物件同一性失效；不入存檔）。
  - `skillDef(id)` 對融合技改回傳 `resolveFusionRecord`；`fuseSkills` 改存**最小記錄（不含 fx）**。
- **`js/save.js`**：`migrateSave` 新增 `fusionFxDynamicV1` 正規化——對能以現行定義重建的融合技 `delete fs.fx`；素材缺失者保留快照後備。置於既有 `skillDmgV2`／`specialBuffTrimV1` 融合遷移之後；冪等、不寫旗標。
- **相依面**：UI／說明全走 `skillDef(id)`（只直接讀 `.id`），無破壞；`skillBaseManaCost` 本已從 components 動態計算。
- **文件**：`game_formula.md` §9.3 新增「效果儲存（動態重算）」列並更新舊存檔敘述；`ONE_TIME_MIGRATIONS.md` 登錄 `fusionFxDynamicV1`（永久冪等正規化，例外說明不寫旗標）。
- **驗證**：node sandbox 載入真實 `js/skills.js` 跑 12 項斷言全過——不存 fx／等級凍結 `[5,3]`／`skillDef` 重算含 lootUp／改素材 UNLOCK 定義後融合技 `buff.base` 45→? 動態跟變（→80）／快取同實例／遷移剝離且重建採現行定義（非 9999 舊值）／素材缺失退回快照；另驗變異重套（時空漣漪 `buff.dur` 12→24，符合玩家截圖「持續 24 秒」）與 `req` 不符安全略過。`node --check` 兩檔通過。
- **影響**：既有融合技效果數值由「凍結快照」改為「以現行 SKILLS 定義重算」；若某素材技能定義自融合後曾變動，重算後數值隨之改變（預期行為，即本需求目的）。素材技能等級仍凍結（素材在融合時已移除，無現行等級可取）。

## 本次變更摘要：接完剩餘公式參數 + 文件對齊程式

- 文件對齊（以程式為準）：修正 4 處不一致——formula.js 敵人數量註解改述 60/25/10/5；game_formula.md §5.2 野外零件菁英倍率 ×3→×1.5、§7.3 太古精華拆解傳說 2%→1%、§7.5 輸送帶容量「40+負重」→固定 20000。全庫掃描無殘留。
- 接完內嵌係數：tools/apply_params.cjs 新增 numCtx（前後文夾住數字的唯一錨點），把 formula.js 寫在算式中間的係數也接入回寫（不重構 formula.js、不動數學）。新增涵蓋：玩家屬性派生、22 項屬性上限、防禦減傷、元素特效機率、高塔 BOSS 各項倍率與挑戰金幣、稀有度擲骰權重與上限、強化/洗煉費用、附魔與分解數值、寶石/神鑄/商店費用、技能升級與裝載欄係數。可回寫參數由 495 → 626。
- 正確性：對未改動 CSV 試跑為「626 全一致、0 變更、0 錨點問題」；實測寫入玩家基底(120→130)/屬性上限(暴擊 100→120)/BOSS 生命倍率(×22→×25) 三型皆就地精準取代、過 node --check、預覽開機屬性正常；完整測試 132/134 通過（2 為既有 css/style.css 測試不同步）。
- 說明：內嵌算式係數僅由 node 檔案工具覆蓋，GM 即時重載（reload game_parameters）仍只涵蓋具名常數與資料表子集；未接清單（少數分數形式係數、combat.js 怪物固定值、公式結構）已記於 tools/參數表使用說明.md。

## 本次變更摘要：新增 GM 指令 reload game_parameters（即時重載參數）

- 新增 `js/param_reload.js`：fetch `game_parameters.csv` → 解析 → 即時套用到記憶體全域（資料表以 `.name` 比對設定、具名純量重新指派、物件/陣列就地改），提供 `window.reloadGameParameters([url])` 回傳 `{applied, skipped, error}`。
- `js/gm.js` 新增 `reload game_parameters` 指令（寬鬆別名 `reload game_parameter`）：立即回「讀取中…」，async 完成後在狀態列與日誌回報套用項數或錯誤。
- `index.html` 於 gm.js 之前載入 param_reload.js。
- 純記憶體覆蓋（重整頁面後還原）；永久生效仍用 `node tools/apply_params.cjs --write`。僅 localhost 生效、需以 http 開啟（file:// 或檔案被 Excel 鎖住時 fetch 失敗並提示）。
- 涵蓋範圍為檔案工具的「可重新指派子集」：data.js 全部資料表與具名常數 + formula.js 具名常數與戰力權重；不含 formula.js 內嵌算式係數。
- 預覽實測：以測試 CSV 即時改 3 值（RESPAWN_DELAY 0.8→0.9、神話 mult 5.2→7、物攻 base 4→88）成功，applied=539、0 錯誤、主控台 0 錯誤；GM 輸入框完整流程正常；`GM_command.md` 新增第 10.5 節說明。

## 本次變更摘要：新增 CSV → 程式碼參數回寫工具 tools/apply_params.cjs

- 新增 `tools/apply_params.cjs`：讀 game_parameters.csv，把數值以「唯一錨點就地取代／資料表陣列整段重建」寫回 js/data.js 與 js/formula.js。
- 用法：`node tools/apply_params.cjs`（試跑，只列變更）／`node tools/apply_params.cjs --write`（實寫）。可用 `PARAMS_CSV=路徑` 指定其他 CSV。
- 安全：預設 dry-run；--write 前記憶體備份、寫入後 `node --check` 驗證、失敗自動還原；錨點匹配非剛好 1 次一律中止不猜。
- 正確性：對未改動 CSV 試跑為「495 參數全一致、0 變更、0 錨點問題」（round-trip 恆等）；實測純量／物件欄／巢狀陣列三種寫入路徑皆正確且過語法檢查、預覽開機生效。
- 涵蓋：data.js 全部具名常數與資料表 + formula.js 具名常數 + 部分內嵌係數（升級經驗、基礎四維、野外怪物成長）。未涵蓋：formula.js 其餘內嵌係數（玩家屬性派生、BOSS 倍率、稀有度擲骰權重、強化/洗煉/技能費用公式等），詳見 tools/參數表使用說明.md。
- 新增 `tools/參數表使用說明.md`：非工程使用者的操作、安全機制與涵蓋範圍說明。

## 本次變更摘要：新增全遊戲公式參數總表 game_parameters.csv

- 新增專案根目錄 `game_parameters.csv`（444 列、UTF-8 with BOM、繁體中文），彙整 formula.js 全部公式與 data.js 全部數值資料表。
- 欄位：編號｜系統分類｜名稱｜參數化公式（以 a/b/c… 代號標示數值位置）｜中文說明｜參數a…參數l（12 欄）。
- 無法用單一公式描述者（野外/高塔掉落表、寶石商店刷出數量/階級表、稀有度表、詞條池、戰力權重表…）改為多列，一列一個品質/類別，元組用 `{下限~上限=機率}`、`階級:機率`、`數量:機率` 避免逗號破壞 CSV。
- 值一律以程式實際值為準；經 12 代理工作流逐區塊對照原始碼驗證，386 列 0 誤植，另補上完整性稽核找到的戰力權重表(SCORE_WEIGHTS 56 條)、詞條數硬上限(MAX_AFFIXES=8)、最低傷害下限(=1)，並於戰力評分公式補上神鑄特效乘區、高塔元素附傷補上地獄之塔×2。
- CSV 為權威可編輯目錄；因遊戲支援 file:// 雙擊開啟（fetch 本地檔會被 CORS 擋），本階段未接入執行期。

## 本次變更摘要：AI_RULES 核心協議加入公式與文件同步規則

- [核心運作與計畫協議] 新增「公式與文件同步」：調整任何公式、參數、數值或變數語意，必須同一任務內同步更新 `game_formula.md` 所有相關段落並檢查無矛盾殘留；程式與文件不一致時須先回報確認基準，禁止擅自擇一修改。

## 本次變更摘要：修正高塔太古機率誤用 BOSS 等級

- 根因：高塔太古公式設計以「樓層」為變數，程式卻把「BOSS 等級」（= 樓層×5+7）餵入，45 層起太古詞條機率即封頂 100%，造成 BOSS 掉落整批全太古詞條裝備（同等級、數件神話＋一件創世的批次）。
- `ancientBossAffixChanceForBoss` / `ancientEssenceDropChanceForBoss` 參數語意改為樓層；tower.js 裝備與太古精華掉落、ui.js 高塔提示改傳樓層，公式數值不變。
- 修正後（樓層計）：45 層每詞條 7.5%、56 層 13%、100 層 35%；太古精華 56 層 42%、85 層起 100%。模擬 200 件 56 層神話掉落：詞條太古率 11.4%、全太古 0 件。
- game_formula.md 同步：§4.3 與 §6.3 高塔公式統一為 `min(100%, 5% + (樓層-40)×0.5%)` 並註明以樓層計算；§6.3 野外公式修正為與程式一致的 `min(3%, 1% + (敵人等級-250)×0.1%)`。
- 既有已生成的全太古裝備屬玩家資產，未做存檔遷移。

## Detailed battle log window (2026-07-13)

- Added `📜 詳細日誌` beside the combined log. The tall popup shows up to 500 recent combat/BOSS entries with timestamps, category filtering, and an independent clear action.

## 本次變更摘要：修正菁英寶石掉落過量與統計來源混淆

- 普通與菁英波次均依既有 60%／25%／10%／5% 數量表生成 1～4 隻敵人。
- 野外每名敵人只結算一次掉落，270 級、958.4% 掉寶率的一級寶石單次結算上限為 15 顆，期望值約 14.29 顆。
- 統計總量仍包含野外、高塔、工廠拆解與技能產出，並新增來源明細與野外掉落結算數；工廠拆解不會記入寶石來源。

## 本次變更摘要：移除多敵人時戰鬥區的垂直捲軸

- 根因：敵方隊伍高度（2 隻直向堆疊約 406px）會把戰鬥場景撐得比我方面板（約 382px）高，戰鬥區內容因此超出可視高度而出現右側捲軸。
- 敵方隊伍 `.enemy-party` 改為絕對定位填滿敵方面板：戰鬥場景高度改由我方面板單獨決定，敵人數量不再影響整體高度，捲軸不再因多敵人出現。
- 敵人卡片改為縱向 flex，狀態列以 `flex: 0 1 標準高度` 允許收縮：空間不足時優先縮小狀態列，卡片之間永不重疊；隊伍列高以 `grid-auto-rows: minmax(0, 1fr)` 在固定高度內均分。
- 實測 1～4 隻敵人：戰鬥場景高度恆定（382px）、戰鬥區溢出量與單敵完全相同、卡片零重疊。

## 本次變更摘要：戰鬥區域固定我方寬度與敵人卡片等比縮放

- 我方戰鬥區域改為全模式固定 202px（單敵標準版型實測值），不再隨敵人數量變寬變窄。
- 敵人 3 隻以上（原本只有 4 隻）才套用 `multi-enemy-layout`：我方欄寬不變，只吃掉戰鬥區兩側 16px 內距讓整體左移、敵方區域加寬 32px；2 隻以上同時縮小敵方面板左右內距（14px→6px）讓卡片更大。
- 敵人卡片改為統一模板以 `--ec-scale` 等比縮放：1 隻 =1.0（標準）、2 隻 =0.75、3/4 隻 =0.7；圖示、字級、血條、狀態列全部依比例縮放（字級設 9px 下限），血條寬度 `min(100%, 200px×縮放)` 置中永不溢出。
- 移除舊有「多敵 240px 我方欄寬」「多敵固定 180px 血條」「單敵專屬放大」三組特例規則。
- 實測四種敵人數量：我方恆為 202px；1 隻卡片 151px、2 隻直向堆疊 167px、3/4 隻 2×2 等寬 95px，均無水平/垂直溢出。

## 本次變更摘要：傷害統計面板改造為統計面板

- 「傷害統計」彈窗與按鈕改名「統計面板」，內容分為基本統計、戰鬥傷害統計、掉落物統計三區，面板開啟期間每秒即時刷新。
- 基本統計：統計時間（X時X分X秒即時累加）、戰鬥場次（野外每清一波敵人＋每次高塔挑戰算一場）、殺敵數（野外敵人與高塔 BOSS）。
- 戰鬥傷害統計沿用原本的目前戰鬥即時卡片與死亡歷史卡片，改為開啟期間每秒同步刷新。
- 掉落物統計：各品質裝備逐行以品質色顯示件數；材料（裝備碎片／附魔精華／太古精華／魔塵／魔魂本源／附魔書／自動機組零件）與寶石（emoji＋階級＋名稱）各一行，有專用圖示者加圖示；金幣顯示完整數字不簡寫。
- 新增邏輯層 `js/stats.js`（統計累計與 HTML 產生），野外擊殺／掉落、高塔獎勵、分解產出與技能金幣以 `window.recordLootXxx` 安全掛勾；統計為工作階段資料，按「清理」歸零重計，不入存檔，離線收益不計入。

## 本次變更摘要：調整傳說裝備拆解太古精華機率

- 傳說裝備拆解取得太古精華的基礎機率由 2% 調整為 1%。
- 史詩 0.5%、神話 10%、創世與神鑄創世 100% 維持不變。

## 本次變更摘要：裝備詞條浮層與太古精華圖示統一

- 「可能出現的詞條」改為 body 層的獨立浮層，不再受裝備詳情面板捲軸裁切。
- 高塔 BOSS 掉落提示新增太古精華機率與圖示。
- BOSS、野外掉落、分解與離線收益中的太古精華顯示統一使用 `icon_ancient_essence.png`。

## 本次變更摘要：太古星標平均重疊

- 太古詞條超過四條時，星星改為每個相鄰間距平均小幅重疊。
- 避免第五顆以後集中壓在最後一顆星星上，最多七顆仍維持可辨識排列。

## 本次變更摘要：高塔戰鬥總傷害統計修正

- 結算中的我方／敵方傷害改以攻擊結果的實際輸出計算，不再使用生命值前後差額。
- 統計包含護盾吸收量與擊殺時超出生命值的溢出傷害，能反映雙方真正的輸出。

## 本次變更摘要：高塔倒計時改為平滑顯示

- 高塔戰鬥的秒數文字改用 `requestAnimationFrame` 逐幀更新，呈現連續的碼錶式倒數。
- 倒計時固定顯示一位小數（例如 `45.0s`），避免小數位消失造成文字位置變動。
- 實際戰鬥計時與超時判定維持原本邏輯，動畫只改善畫面顯示，不會改變戰鬥結果。

## 本次變更摘要：新增地獄之塔與魔魂本源

- 高塔分為試煉之塔 1～50 層、地獄之塔 51～100 層，100 層後暫未開放。
- 地獄之塔 BOSS 名稱使用黃色；攻擊力為同等級普通 BOSS ×2，生命值 ×5。
- 地獄之塔通關獨立判定魔魂本源：第 51 層 5%，每往上一層 +1%。
- 新增魔魂本源存檔欄位與右上角資源顯示，提示為「用於本源覺醒的道具」。

## 本次變更摘要：高塔 BOSS 增加經驗獎勵

- BOSS 通關經驗改為其建議野外階段普通怪物經驗的 2 倍。
- 經驗會再套用玩家的經驗加成，並顯示於通關獎勵。
- 失敗或撤退不會獲得經驗。

## 本次變更摘要：高塔戰鬥資訊列固定位置

- 倒數計時固定為 72px 寬並靠右對齊，避免秒數字數變化造成後方內容跳動。
- DPS／需求資訊向右增加 16px 間距，位置更加穩定。

## 本次變更摘要：神鑄產物套用太古詞條規則

- 神鑄成功產生的裝備現在會傳入一般敵人太古詞條機率。
- 判定仍逐詞條獨立進行，並沿用神鑄素材中的最高裝備等級；普通、精良、稀有產物仍不會出現太古詞條。

## 本次變更摘要：神力改為攻擊額外乘區

- 神鑄創世特效「神力」不再直接加到物理／魔法攻擊百分比。
- 改為在原有攻擊百分比完成後，額外乘上 `(1 + 神力% / 100)`；多件神力彼此相乘。
- 提示文字改為「物理與魔法攻擊額外提高 {v}%」。

## 本次變更摘要：太古星標依參考圖調整

- 星標改為黃色 18px，前 4 顆並排，第 5 顆起以 -9px 間距部分重疊。
- 星標增加 1px 內圈描邊與 1px 深色外圈描邊，提升深色裝備背景上的辨識度。

## 本次變更摘要：放大太古詞條星數標記

- 六角星改用亮橘黃色並放大至 16px，增加白色與橘色光暈提高辨識度。
- 星星採負間距重疊排列，7 顆星在小型裝備圖示上也能完整呈現。

## 本次變更摘要：裝備圖示顯示太古詞條星數

- 背包、已穿戴裝備與神鑄法陣中的裝備圖示，上緣會顯示太古詞條數量。
- 每條太古詞條顯示一顆橘色六角星，最多顯示 7 顆，並使用獨立小型標記避免遮住裝備圖示。

## 本次變更摘要：太古精華洗煉成功率提升

- 太古精華洗煉時，每個詞條獨立成為太古詞條的機率由 `20%` 提升至 `30%`。
- 資源消耗與原本規則不變；裝備重新洗煉時直接使用新機率。

## 本次變更摘要：高塔 BOSS 挑戰費用改為冪次公式

- 挑戰費用改為 `round(100,000 × 樓層^2.6)`。
- 介面提示、程式註解與公式文件同步更新；自動連挑沿用同一個 `towerChallengeCost()`。

## 本次變更摘要：補充高塔 BOSS 挑戰費用公式

- 高塔挑戰費用為 `100,000 + 樓層 × 200,000`。
- 開始挑戰前扣除，失敗或撤退不退回；與掉寶率、金幣加成及首通獎勵無關。
- 例：第 1 層 300,000；第 10 層 2,100,000；第 20 層 4,100,000。

## 本次變更摘要：加速齒輪固定增加 50 個百分點

- 加速齒輪 T1～T7 在原本 `25%～175%` 基礎上，各自固定增加 `50` 個百分點，成為 `75%～225%`。
- 既有零件不改寫存檔，安裝計算與零件提示會直接套用新值；例如既有 T7 `175%` 會以 `225%` 生效。

## 本次變更摘要：掉寶率相關效果全面減半

- 掉寶率來源統一套用 `50%` 效果倍率；既有裝備、附魔、神鑄貪婪與既有技能狀態在計算時直接生效。
- 裝備詳情、附魔、神鑄貪婪、零件提示與戰力評分同步顯示折半後的實際掉寶效果。
- 分解槽的精粹透鏡、太古精華萃取器、複製處理艙、幸運晶片、寶石篩選器、拓本回收臂、探礦核心等掉寶相關機率一併減半。
- 寶石目前沒有直接提高掉寶率的效果，因此不改動寶石能力；金幣／碎片產量、速度與寶石提純等非掉寶率效果維持原值。
- 驗證：完整測試 88 項全部通過。

## 本次變更摘要：資源提示開啟期間即時更新

- 頂欄資源 tooltip 記錄目前懸停的資源元素。
- 金幣或材料變動觸發頂欄重繪時，若提示框仍開啟，會同步重建完整最新數值。
- 滑出資源後清除提示狀態，不影響其他 tooltip。

## 本次變更摘要：多敵人不壓縮我方戰鬥區

- 外層戰鬥容器維持原本 500px，不因敵人數量改變整個戰鬥區寬度。
- 一般戰鬥區恢復我方與敵方左右等分；超過 3 隻敵人時，僅將戰鬥場景向兩側內距展開，我方欄位固定約 240px，只移動位置不改變尺寸，剩餘空間提供給敵方區域。
- 多敵人血條固定為 180px 並置中，維持單敵人時的視覺規格，不會隨右側區域拉長。
- 單敵人版面維持原本尺寸；小螢幕仍會恢復單欄排列。


## 本次變更摘要：自動放入選單點選不再刷回頂部

### js/ui.js
- 點選素材改為就地更新：新增 `famApplyPickHighlight()` 只切換 `.picked` 高亮與
  確定鈕啟用狀態，不再整個重建選單——清單卷軸位置不動，選了什麼一目了然。
- `renderForgeAutoMenu()` 重建時保留 `.fam-list` 卷軸位置——自動鑄造運行中
  （法陣紀錄/庫存變動觸發的同步重繪）不再把清單刷回最上層，選取高亮也保留。
- 選單維持「按下確定才關閉」：確定 → 放入 6 件並關閉；點選素材只改選取。
- 驗證：捲至中段點選 → 清單 DOM 未重建、卷軸不動、高亮正確、確定鈕亮起、
  選單未關閉；模擬自動鑄造同步重繪 → 卷軸與選取皆保留；確定 → 關閉並放入
  6 顆所選寶石；主控台零錯誤。

---

## 本次變更摘要：法陣上的物品顯示詳細 tips

### js/ui.js
- 寶石槽 data-tip 由「名稱（點擊取回）」擴充為與背包相同的效果格式：
  「🟦五級綠松石｜格擋率 +9%｜點擊取回」。
- 裝備槽移除簡易 data-tip，滑過改顯示**完整裝備詳情 tooltip**（品質色名稱、
  評分、全部詞條、特殊被動等，與背包/裝備欄一致的純資訊模式），
  底部附「點擊取回背包」提示——mouseover 委派新增 `.forge-slot.filled` 分支，
  直接讀取法陣槽位物件（不動 findItemById，維持先前防複製的範圍限制）。
- `showItemTooltip` 支援 `opts.hint` 附加提示行；mouseout 委派同步支援法陣槽位。
- 驗證：裝備槽滑過顯示完整詳情（名稱/◆詞條/評分/取回提示）並於移出隱藏；
  寶石槽 tips 含屬性效果；主控台零錯誤。

---

## 本次變更摘要：神鑄頁籤運行中旋轉小圖標

### index.html、css/style.css、js/ui.js
- 神鑄頁籤右上角新增淺藍色（#7dd3fc）旋轉小圖標（11px 圓環缺口 spinner，
  1 秒/圈 CSS 動畫）：鑄造進行中顯示，結束即消失。
- `.tab-btn` 補 `position: relative` 供圖標定位。
- uiTick 每 tick 依 `forgeIsBusy()` 切換顯示（不論玩家目前在哪個分頁都會更新），
  display 無變化時不觸碰 DOM。
- 驗證：開鑄前隱藏、鑄造中顯示於頁籤右上角並旋轉（11×11、淺藍、forgeRunSpin 1s）、
  切到裝備分頁仍顯示、鑄造結束即隱藏；主控台零錯誤。

---

## 本次變更摘要：鑄造進度列改顯示可再鑄造次數

### js/forge.js、js/ui.js
- 進度列剩餘欄由「剩餘 xN 顆/件」改為「可再鑄造 N 次」（剩餘庫存 ÷ 6 取整）。
- `forgeRemainInfo()` 移除不再使用的 unit 欄位。
- 驗證：寶石 285 顆放 6 開鑄 → 46 次；裝備剩 3 件 → 0 次、剩 7 件 → 1 次；
  主控台零錯誤。

---

## 本次變更摘要：鑄造進度列顯示素材剩餘數量

### js/forge.js
- 新增 `forgeRemainInfo()`：目前鑄造素材的剩餘庫存——優先取自動放入設定
  （連續鑄造素材），否則由法陣槽位推導；寶石回傳庫存顆數，裝備回傳
  「未上鎖、同品質」件數（與自動放入取件規則一致，不含法陣中 6 件）。

### index.html、js/ui.js、css/style.css
- 進度列「鑄造中....」右側新增剩餘數量欄（例：「🔴七級紅寶石 剩餘 x279 顆」／
  「傳說裝備 剩餘 x3 件」），倒數秒數維持靠右；文字無變化時不觸碰 DOM。
- 驗證：寶石模式 285 顆放 6 開鑄顯示 x279 顆；裝備模式 9 件放 6 顯示 x3 件；
  鑄造結束進度列連同剩餘欄一併隱藏；主控台零錯誤。

---

## 本次變更摘要：全螢幕按鈕往返切換確認與強化

### js/ui.js
- `exitFullscreen()` 補上 `.catch`，避免特殊情況下的未處理 promise 拒絕。
- 驗證往返切換：連按三次呼叫序列為 request → exit → request（按一次全屏、
  再按一次恢復、可反覆），第二次按下後按鈕亮起狀態與提示正確還原；主控台零錯誤。

---

## 本次變更摘要：頂欄新增全螢幕切換按鈕

### index.html、css/style.css
- 品牌標題「無限征途 合成之巔」右側新增 ⛶ 全螢幕按鈕（26×26，懸停提示
  「進入全螢幕（等同 F11）」）；全螢幕中按鈕亮金色並提示「離開全螢幕（Esc）」。

### js/ui.js
- 點擊以 Fullscreen API 切換：未全螢幕 → `documentElement.requestFullscreen()`；
  全螢幕中 → `exitFullscreen()`。瀏覽器拒絕時輸出系統日誌提示改用 F11。
- 監聽 `fullscreenchange` 同步按鈕亮起狀態與提示文字（含 Esc 離開的情況）。
- 驗證：按鈕位置/樣式正確；stub API 實測點擊觸發 request/exit、
  fullscreenchange 正確切換 active 與提示；主控台零錯誤。
  （測試用內嵌預覽視窗本身封鎖 Fullscreen API，實際效果需在正式瀏覽器確認。）

---

## 本次變更摘要：加寬裝備詳情並右移素材面板

### css/style.css、tests/equipment-detail-layout.test.cjs
- 裝備圖欄上限由 428px 調整為 400px，將空間讓給裝備詳情欄。
- 裝備詳情內的寶石插槽資訊改為單行顯示，避免長名稱與數值換行。
- 右側寶石／附魔素材面板向右移 14px，利用現有空間並保留原有操作位置邏輯。

## 本次變更摘要：傷害浮字面板邊界夾取（裁切修復二）

### js/ui.js
- 前次修復解除了敵人卡片的裁切，但外層戰鬥面板 `.combatant` 也是
  `overflow: hidden`，長數字在邊緣卡片仍會踩出面板內緣被切。
- `floatText` 改為：先隨機落點，掛載後量測實際文字寬度，把水平中心夾取在
  面板可視範圍（padding box）內——數字仍可跨出頭像卡片（維持前次需求），
  但不再超出面板被裁切；面板比文字窄時置中顯示。玩家側浮字同樣受惠。
- 不動 `.combatant` 的 overflow（保留華麗邊框的裁切行為，避免數字疊到框外）。
- 驗證（4 敵人小卡、強制極左/極右落點）：「爆擊 12.1T」「爆擊 999.9T」等
  全部完整顯示於面板內、仍跨出頭像卡片、無截斷；主控台零錯誤。

---

## 本次變更摘要：多人戰鬥傷害浮字等比縮小且不被裁切

### css/style.css
- `.enemy-card` 與其 `.float-layer` 由 `overflow: hidden` 改為 `overflow: visible`，
  讓傷害浮字可超出頭像卡片範圍，不再被小卡片裁掉。
- `.float-txt` 加 `white-space: nowrap`，避免數字被折成多行而看似被切斷。
- 多人戰鬥（`enemy-count` 非 0／1）時傷害浮字等比縮小：一般 14→11px、
  暴擊/技能 20→15px、格擋/反震 →12px；並把浮層 z-index 提高到 20，數字疊在最上層。
- 單人戰鬥維持原字級（14／20px）不受影響。

### 驗證（瀏覽器實測，4 敵人 56px 小卡）
- 卡片與浮層 overflow 皆 visible、浮層 z-index 20；大額傷害（5.23T／15.21T／8.88B）
  字級正確縮小、nowrap 不換行、`fullyRendered` 為 true（可見寬度＝內容寬度，完全未裁切），
  且允許超出卡片邊界。單人維持 14／20px。主控台零錯誤。

---

## 本次變更摘要：背包擴充費用改用金幣圖示

### index.html、js/ui.js、tests/inventory-expand-display.test.cjs
- 背包擴充按鈕不再顯示 `G` 字尾，改為金額後接 `icon_gold.png` 金幣圖示。
- 保留原本的擴充費用計算與金幣扣款邏輯，僅調整顯示格式。

## 本次變更摘要：切回神鑄時同步目前鑄造素材分頁

### js/ui.js、tests/forge-auto-menu.test.cjs
- 新增共用 `forgeInventoryTab()`：鑄造進行中依 `crafting.mode` 優先選擇裝備或寶石分頁。
- 神鑄背包與自動放入選單共用此判斷；沒有等待中的鑄造時仍沿用玩家上次選擇。

## 本次變更摘要：背包擴充費用改二次方＋上限 1000 格

### js/data.js、js/formula.js
- 新增常數 `INVENTORY_MAX = 1000`（背包擴充上限，含 60 基礎容量）。
- 新增 `inventoryExpandCost(upg) = 10000 × (upg+1)²`（購買次數＝本次為第幾次擴充）。
  取代原本線性費用 `10000 + 次數×1000`。第 1 次仍為 10000，第 2 次 40000、
  第 3 次 90000…第 940 次（達 1000 格）8.836B。

### js/ui.js
- `renderInventory` 與擴充按鈕改用 `inventoryExpandCost`，金額以 `fmt` 顯示。
- 達 1000 格時按鈕顯示「➕ 已達上限 (1000)」並停用；點擊擴充時再次防呆擋下。
- 既有存檔若已超過 1000 格（舊線性費用時代的超買）保留原格數不削減，只是不能再擴充。

### game_formula.md
- §7.5 補上「背包容量上限 1000 格」與「背包擴充費用 = 10000 × 購買次數²」。

### 驗證（瀏覽器實測）
- 費用表 10000/40000/90000/160000…8.836B 與公式一致；連續購買扣款與容量遞增正確。
- 999→1000 可買、1000 後按鈕停用且再點被擋（金幣與次數不變）；超量存檔（1260）保留不削減。
- 主控台零錯誤。

---

## 本次變更摘要：修正自動鑄造換輪後進度條停在 100%

### js/ui.js、tests/forge-duration.test.cjs
- 自動鑄造進入新一輪時，先以 `animationName = 'none'` 加一次性 reflow 清除上一輪的完成狀態。
- 新輪次重新套用正確的動畫時長與負延遲，避免進度條停在 100% 但倒數仍繼續。

## 本次變更摘要：神鑄進度條改用 compositor 動畫

### js/ui.js、css/style.css、tests/forge-duration.test.cjs
- 移除逐幀修改 `width` 的 JavaScript 動畫，改用 `transform: scaleX()` 的 CSS compositor 動畫，降低主執行緒重排造成的卡頓。
- 依 `startedAt` 設定負動畫延遲，支援重新載入或切回神鑄頁時從正確進度接續，且相同鑄造狀態不重置動畫。

## 本次變更摘要：神鑄時間進度條改為平滑更新

### js/ui.js、css/style.css、tests/forge-duration.test.cjs
- 進度條改由 `requestAnimationFrame` 依保存的鑄造開始時間與總時長逐幀計算，不再受 200ms UI 迴圈限制。
- 倒數文字與進度寬度同步刷新；鑄造完成或狀態消失時取消動畫 frame。
- 移除離散寬度更新使用的 CSS transition，避免進度追趕造成卡頓。

## 本次變更摘要：全局減傷 tooltip 移除計算公式

### js/data.js
- 屬性面板「全局減傷」說明不再顯示計算公式，改為只說明效果與上限：
  「在最終傷害階段降低受到的所有傷害（減傷上限 85%）」，並保留「目前實際減傷」數值。
- 驗證：37.4K→65.2%、達上限→85%，說明文字已無「÷」與「20000」等公式字樣。

---

## 本次變更摘要：修正全局減傷公式方向並加上 85% 上限

### js/formula.js
- 修正反向 bug：原 `globalDamageMultiplier` 直接把 `全局減傷/(全局減傷+20000)`
  當成「剩餘傷害倍率」，導致越堆全局減傷、實際減傷越低（100 萬點只剩 2% 減傷）。
- 改為：減傷率 = `min(85%, 全局減傷/(全局減傷+20000))`（新增 `globalDamageReduction`
  作為單一來源與常數 `GLOBAL_DMG_RED_CAP = 85`）；`globalDamageMultiplier` 回傳
  `1 − 減傷率` 作為剩餘傷害倍率。戰鬥與反震兩處呼叫端沿用同函式，方向即修正。

### js/data.js
- 屬性面板「全局減傷」tooltip 改用 `globalDamageReduction()` 顯示，並在說明中
  寫明「減傷率 = 全局減傷 ÷（全局減傷 + 20000），上限 85%」。
  （37.4K → 顯示 65.2%；達 85% 上限時顯示 85%。）

### game_formula.md
- §2 屬性表與 §3 傷害結算流程的全局減傷公式更正為
  `減傷率 = min(85%, 全局減傷/(全局減傷+20000))`、`傷害 × (1 − 減傷率)`，並註明 85% 上限。

### tests/global-damage-reduction.test.cjs
- 既有測試改鎖正確公式（10000 點 → 剩餘傷害 66667、減傷 33.3%）。
- 新增 85% 上限測試（`globalDamageReduction(200000) === 0.85`、200000 點承傷 15%）。

### 驗證（瀏覽器實測，固定亂數）
- 減傷率曲線單調遞增：0→0%、100→0.5%、20000→50%、37400→65.16%、113333→85%、200000→85%。
- 精確承傷：37400 → 剩 34.84%；113333／200000 → 剩 15%（皆夾在 85% 上限）。
- tooltip 文字 37.4K→65.2%、上限→85%、0→0%，主控台零錯誤。

---

## 本次變更摘要：神鑄自動控制項改為 checkbox

### index.html、css/style.css、tests/forge-footer-controls.test.cjs
- 「自動使用魔塵」與「自動鑄造」保留原本的 checkbox 語意與事件，改為可見的自訂勾選框。
- 移除容易被誤認為按鈕的 `✅` 文字，勾選狀態由 checkbox 外觀呈現。
- 補上回歸檢查，確認兩個控制項不是按鈕、可見且保留自動鑄造不會立即啟動的規則。

## 本次變更摘要：統一自動鑄造勾選外觀與啟動規則

### index.html、js/ui.js
- 「自動鑄造」改用與「自動使用魔塵」相同的 ✅ 勾選標記。
- 勾選只啟用自動接續，不會立即放入素材或開始鑄造；玩家仍須先手動按一次「鑄造」。

## 本次變更摘要：移除神鑄底部 checkbox 原生方框

### css/style.css、js/ui.js
- 僅在神鑄底部控制列隱藏兩個原生 checkbox 的視覺方框，保留 label 點擊與原有勾選事件。
- 啟用中的控制項改以文字顏色提示，避免隱藏方框後無法辨識狀態。

## 本次變更摘要：神鑄加入鑄造時間與自動鑄造

### js/data.js、js/forge.js、js/player.js、js/main.js
- 新增裝備與寶石神鑄時間規則；`doForge()` 改為建立可保存的 `crafting` 等待狀態，時間到期後才結算。
- 主迴圈呼叫 `forgeTick()`，支援重新載入後依 `startedAt` 繼續計時。
- 新增 `autoForge` 狀態；每輪完成後自動補足同類素材並開始下一輪，材料不足時停止。
- 鑄造期間鎖定放入、取回、卸下、魔塵與切換素材頁等操作，避免等待期間修改素材。

### index.html、css/style.css、js/ui.js
- 在神鑄法陣下方新增「鑄造中....」、剩餘秒數與進度條。
- 新增「自動鑄造」勾選框；勾選後可連續鑄造至材料不足。
- 鑄造期間按鈕與素材操作會停用，完成後恢復。

### game_formula.md、tests/forge-duration.test.cjs
- 記錄裝備／寶石鑄造時間與自動鑄造規則。
- 新增神鑄時間、可保存等待狀態、進度 UI 與主迴圈結算回歸檢查。

## 本次變更摘要：修正寶石清單塌縮為零高度

### js/ui.js、css/style.css
- 寶石選單先顯示再計算標題、footer 與內距，將剩餘高度明確配置給素材清單。
- 移除零高度 flex 規則，避免出現只有操作列、寶石內容消失的狀況。

## 本次變更摘要：修正寶石清單擠出固定操作列

### js/ui.js、css/style.css
- 寶石模式加入 `fam-gem-mode`，素材清單改用 `flex-basis: 0` 與 `height: 0` 分配剩餘高度。
- 清單內容超出時只在素材區出現捲軸，不再把「確定／取消自動放入／關閉」推到選單外。

## 本次變更摘要：改用滑鼠滾輪捲動並固定自動放入操作列

### js/ui.js、css/style.css
- 移除按住中鍵拖曳與中鍵自動捲動攔截，改比照裝備詳情使用滑鼠滾輪上下捲動素材清單。
- 「確定／取消自動放入／關閉」維持在 `.fam-list` 外，操作列不可縮小並保持在底部常駐顯示。

## 本次變更摘要：支援滑鼠中鍵捲動神鑄寶石清單

### js/ui.js、css/style.css
- 攔截寶石清單上的中鍵，避免瀏覽器原生自動捲動整個遊戲主畫面。
- 支援按住中鍵拖曳清單，以及中鍵點擊後移動滑鼠的自動捲動模式。
- 捲動狀態只作用於 `.fam-list`，並以專用游標提示目前中鍵捲動狀態。

## 本次變更摘要：修正神鑄寶石選單捲動

### js/ui.js、css/style.css
- 寶石模式為自動放入選單設定明確高度，讓 `.fam-list` 能正確取得獨立捲動空間。
- 清單強制保留垂直捲軸欄位，加入 overscroll containment，並隔離 wheel 事件，避免主畫面跟著下移。
- 裝備模式仍維持內容高度，不增加不必要的空白區域。

## 本次變更摘要：神鑄自動放入選單優化

### js/ui.js
- 將自動放入選單拆成固定標題、可捲動素材清單與固定操作列，確定／取消自動放入／關閉按鈕不再隨清單捲動消失。
- 寶石選項先依持有數是否達到六顆排序，可直接合成的寶石優先，再依階級由高到低排列。
- 保留原有裝備與寶石選取、確定、取消及關閉事件，並修正重構後裝備列的渲染目標。

### css/style.css
- 自動放入選單加寬至 400px，僅 `.fam-list` 負責垂直捲動。
- 素材資訊禁止換行，數量欄固定靠右，底部操作列固定在選單底部。

### tests/forge-auto-menu.test.cjs
- 新增選單區塊分離、可合成寶石排序、裝備列渲染與 CSS 捲動行為的回歸檢查。

## 本次變更摘要：神鑄「自動放入」系統

### js/player.js、js/forge.js（邏輯層）
- `G.forge.autoFill` 新狀態（隨存檔保存；舊檔由 forgeState() 補 null）：
  `{kind:'equip',rarity}` 或 `{kind:'gem',type,level}`。
- `forgeAutoFillApply()`：依設定放入 6 件——裝備取背包中該品質「未上鎖、
  評分最低」6 件（保留較強與上鎖者）；寶石自庫存扣 6 顆；不足回錯誤不動法陣。
- `forgeAutoRefill()`：doForge 成敗兩路徑收尾呼叫，自動補放下一輪；
  數量不足時停止並清除設定（法陣紀錄＋戰鬥日誌），補放後還原中央產物顯示。

### index.html、css/style.css
- 法陣按鈕列在「全卸下」與「鑄造」之間插入「自動放入」按鈕（鑄造下移一格），
  附選單容器；新增 `.forge-auto-menu`／`.fam-*` 選單樣式與啟用中亮綠按鈕樣式。

### js/ui.js（渲染層）
- `renderForgeAutoMenu()`：依目前背包切頁列出選項——裝備頁為傳說/神話/創世
  （品質色文字＋持有數）；寶石頁為所有持有的五～九階寶石（emoji 小圖示＋
  「N級寶石名（屬性 +數值）×持有數」）；持有 <6 者半透明不可選。
- 事件：選取→確定（先清空法陣再放入 6 件並啟用）、取消自動放入、關閉、
  外點關閉；按鈕啟用中亮起並顯示目前設定提示；選單開啟時隨 dirty 刷新同步。
- 驗證（強制成敗）：裝備模式放入/補放/不足停止（訊息正確）、寶石模式
  13 顆七級紅寶石連鑄兩輪至停止、中央產物保留、選單分色與 ×數量顯示、
  外點關閉、取消按鈕，主控台零錯誤。

---

## 本次變更摘要：右上資源與經驗條改用新版提示框
- 移除右上資源與角色經驗條的瀏覽器原生 title 提示。
- 改用遊戲內統一提示框，資源提示顯示目前持有量。
- 經驗條提示顯示「當前經驗值：X / 升級經驗值：Y」。

## 本次變更摘要：技能法力消耗隨等級增加
- 一般技能實際法力消耗改為原始消耗每升一級增加 10%，採非複利計算。
- 融合技能基礎法力消耗改為所有素材技能原始消耗直接加總，不再使用 0.65 折扣。
- 戰鬥施放、MP 判斷、技能頁與懸停提示統一使用共用法力消耗公式。

## 本次變更摘要：補齊公式文件與同步過期測試
- game_formula.md 補上 NPC、BOSS、掉落率與玩家 0～5 轉升級經驗公式。
- 回歸測試同步目前已採用的全局減傷公式，並補上 XP 測試所需的共用工具載入。

## 本次變更摘要：主字型改用微軟雅黑＋詞條加粗

### css/style.css
- `--font-main` 首位改為 "Microsoft YaHei"（微軟雅黑，最接近參考遊戲的粗壯黑體），
  微軟正黑／PingFang TC 保留為後備（無雅黑的系統自動退回）。
- `.it-affix` 加 `font-weight: bold`，比照參考遊戲的詞條粗體觀感。
- 驗證：雅黑字型存在且生效、詞條 700 粗體 15px、版面無破裂、主控台零錯誤。

---

## 本次變更摘要：UI 視覺優化改造工程（全站文字可讀性總改造）

### css/style.css（全站字型與基準）
- 全站字型由 Palatino 襯線改為無襯線 `--font-main`（微軟正黑體 / PingFang TC /
  Noto Sans TC），連同 `.log`、`#sk-tooltip` 的 Palatino 引用一併替換——
  舊字型中文以退回字混排是「字不清楚」的主因。
- body 基準 14→15px、行高 1.55；暗淡色 `--dim` 提亮（#8b7961 → #9c8a70）；
  `.hint` 取消中文假斜體。

### css/style.css（裝備 tips／詳情，比照參考遊戲）
- `#sk-tooltip`：加寬 300→400px、基準 13→14.5px、內距加大。
- `.it-name` 15→19px；`.it-sub`/`.it-score` 12→13px；`.it-affix` 13→15px、
  行距 2→4px；`.it-passive`（【破甲】等特殊被動）改橘色 #ffa940 粗體 15px；
  `.it-enchant` 12.5→14px；`.it-godpassive` 13→14.5px；`.socket` 12→13.5px；
  `.it-pool-box` 12.5→13.5px。
- 新增詞條分類分色（--afx-*）：基礎紫 #c9a0ff／進攻粉 #ff8fb8／
  防禦青 #7fdcf5／功能綠 #9ae6a0，整行同色、與參考遊戲同邏輯。

### css/style.css（通用元件）
- `.sec-title` 15→16px；`.skt-name` 13→15px、`.skt-meta` 11→12.5px、
  `.skt-hint` 10.5→12px；`.log` 13→14px；`.log-title` 12→13px；
  背包格等級徽章 `.ic-lv` 9→11px 並改亮色；`.ic-up` 10→11px；
  神鑄素材面板標題/副標/空狀態 12/11/11 → 13.5/12.5/12.5px。

### js/data.js、js/item.js
- data.js 新增 `AFFIX_CATS` 詞條顯示分類與 `affixCat()`（未列入者視為 util）。
- item.js 詞條列掛 `afx-<cat>` class；比較模式的紅綠差異 inline 色維持優先。
- 純渲染層改動，不影響任何遊戲數值與邏輯。
- 驗證：tooltip/詳情字型字級分色全數符合、四分類顏色正確、特殊被動橘色粗體、
  七個分頁切換無版面破裂、無水平卷軸、詳情框仍 500px 固定、背包位置不動、
  主控台零錯誤。

---

## 本次變更摘要：裝備滑過提示移除洗煉／詞條說明按鈕（回歸修復）

### js/ui.js
- `showItemTooltip` 改為呼叫 `itemDetailHTML(it, null, { showAffixReroll: false })`：
  滑過提示回到純資訊模式，不再顯示每條詞條的 🎲 洗煉按鈕與「!」可能詞條說明按鈕
  （僅裝備詳情介面保留可操作按鈕）。
- 此為先前「恢復裝備詳情操作按鈕」變更的回歸修復——itemDetailHTML 的
  showAffixReroll 開關仍在，但 tooltip 呼叫端在後續 ui.js 改動中遺失了參數。

---

## 本次變更摘要：背包區再上移

### css/style.css
- `.equip-top-layout` 底部間距 30px → 8px；`.equip-layout` 底部間距 14px → 0。
- 背包區整體上移 36px，頂端距操作按鈕列約 18px；選取/取消選取間位置仍固定不動。

---

## 本次變更摘要：選中外圈白框＋移除裝備標題＋裝備介面放大 10%

### css/style.css
- 選中標示改為「框外圈再畫一圈」：`.eq-slot.selected` 改為 3px 白色 outline、
  outline-offset 5px（與裝備框之間留空隙），與神話/創世/神鑄流光邊框明顯區隔；
  背包格 `.item-cell.selected` 維持較小的 2px/2px（格距僅 6px，避免壓到鄰格）。
- 裝備格欄位改為優先取滿：`.equip-layout` 第二欄（詳情）由 `minmax(250px,350px)`
  改為 `minmax(250px,1fr)` 彈性欄——原本兩欄按比例分配剩餘空間，裝備格永遠
  到不了上限。`#equip-grid` 上限以實際顯示尺寸（約 389px）放大 10% 設為 428px。
- `.equip-top-layout` 首欄上限 796px（428+8+360），超寬螢幕時詳情欄不會無限變寬。

### index.html
- 移除裝備格上方「已裝備（13 欄位…）」說明文字，裝備介面上移貼齊頂端。
- 驗證：428x562（比例 780/1024 正確）、與詳情欄間距 8px 無重疊、無水平卷軸、
  選中白圈在框外 5px、背包位置不動。

---

## 本次變更摘要：裝備詳情固定高度＋背包區位置固定

### css/style.css
- `#detail-pane` 由「內容撐高」改為固定 500px：`flex: 1`／`height: auto` 改為
  `flex: 0 0 auto`／`height: 500px`，內容超出時框內出現卷軸（overflow-y 原有）。
- 新增 `.equip-action-bar { min-height: 33px }`：未選取裝備時按鈕列保留高度不塌陷。

### js/ui.js
- `renderDetail` 未選取分支不再把按鈕列設為 `display: none`，改保持 `flex`，
  搭配 min-height 讓背包區在「未選取／選取任何裝備」間位置完全不動。
- 驗證：無選取／低品質短內容／神鑄創世滿插槽滿附魔長內容三種狀態，
  詳情框恆為 500px、背包區頂端位置恆定、長內容框內可捲動。

---

## 本次變更摘要：恢復右側小圖示化鑲嵌／附魔面板（回歸修復）

### js/ui.js
- 先前改造過的「裝備詳情右側素材面板」（`#equip-material-panel`）渲染程式在後續
  ui.js 改動中遺失，導致寶石／附魔書選擇退回舊版：以文字 chip 形式塞在裝備詳情
  下方，把詳情面板撐長、操作按鈕被推出畫面。
- `renderDetail` 重建面板輸出：可用寶石與可用附魔書改為右側 32px 小方塊圖示網格
  （「💎 可用寶石（點擊鑲嵌）」／「✨ 可用附魔書（點擊附魔）」兩區塊），完整名稱、
  數值、持有量與操作說明移到滑鼠提示（data-tip）。
- 沿用既有的 document 層級事件委派（data-gem-socket／data-gem-socket-fused／
  data-book-enchant），點擊行為（鑲嵌自動取最高等級、附魔消耗書＋精華）不變；
  已附魔的書以半透明（dim-chip）標示。
- 未選取裝備時清空面板（CSS `:empty` 自動隱藏）。index.html 的面板容器與
  css/style.css 的 `.equip-material-*` 樣式原本就在，未變動。

---

## 本次變更摘要：新增手動存檔成功提示
- 手動存檔成功後，在新存檔列顯示亮綠色「✅ 已新增存檔！」。
- 切換離開設定分頁時清除提示，返回設定頁後不再顯示。

## 本次變更摘要：等待讀檔快取寫入完成後再刷新
- IndexedDB 自動快取寫入新增完成回呼。
- 讀取本地存檔時，確認快取交易完成後才刷新頁面，避免讀檔資料尚未落地就被舊進度覆蓋。

## 本次變更摘要：修正本地讀檔被自動檔覆蓋與索引消失
- 讀取手動本地存檔後，將該內容寫入 IndexedDB 自動快取並更新時間，重新整理時不再被較新的舊 `IC_autosave.json` 覆蓋。
- 移除舊版 `localStorage` 大型完整快照，避免約 5 MB 配額阻塞手動存檔索引。
- 讀檔後保留本地手動檔案與最新 10 筆索引，不再因瀏覽器配額不足而從遊戲清單消失。

## 本次變更摘要：手動存檔改為複製瀏覽器快取至本地
- 設定頁「立即存檔」改用本地資料夾寫入，不再呼叫 `saveGameV2()` 增加瀏覽器快取內容。
- 手動存檔優先讀取現有 IndexedDB 自動快取，直接建立新的本地 `.json` 檔；沒有快取時才以目前記憶體狀態作後備。
- 移除舊版「儲存空間可能已滿」泛用流程，寫入失敗時顯示本地資料夾的實際錯誤。

## 本次變更摘要：防止選到遊戲專案根目錄
- 拒絕將 `C:\Users\alway\Idle-RPG` 這類遊戲專案根目錄當成存檔資料夾。
- 首次選擇 Documents 時建立／使用 `Documents\Idle_RPG\Save`。
- 啟動時若偵測到錯誤資料夾連線，顯示重新選擇提示，不讀取專案資料夾。

## 本次變更摘要：裝備欄位對齊新版角色底圖

### css/style.css
- 角色底圖 `character_UI .png` 已更換為 780x1024 新圖，但 13 個裝備槽仍沿用舊圖
  （1844x2304）量測的百分比座標，導致裝備 icon 與底圖格子錯位。
- `#equip-grid` 的 `aspect-ratio` 由 `1844 / 2304` 改為 `780 / 1024`。
- 以程式化像素分析實測新底圖 13 個羊皮紙內框的邊界，重寫全部 `.slot-*` 座標
  （中心點 left/top 與 width/height 百分比），實測誤差全數 ≤ 0.6px（底圖像素）。
- 武器格底圖與 icon 尺寸不一致者維持置中顯示（`object-fit: contain` 既有行為）。

---

## 本次變更摘要：存檔機制 V2 單一自動快取與本地手動歷史
- 自動存檔每 15 秒覆寫瀏覽器快取；每 10 分鐘覆寫本地 `IC_autosave.json`。
- 手動存檔直接建立本地 `.json`，舊檔保留；清單顯示自動存檔與最新 10 筆手動存檔。
- 移除下載按鈕；讀取／刪除改為操作本地存檔。
- 資料夾選擇改為純選定路徑，首次選擇 Documents 時建立 `Idle_RPG\Save`，並顯示唯讀檔案清單。

## 本次變更摘要：修復背包超量收納（嚴格維持容量上限）

### js/player.js
- `addToInventory` 修復漏洞：原本背包滿載且包內全為神話+（無低品質犧牲品）時，
  神話+新物品會「超量收納」直接塞入，背包無上限成長（例：632/501）。
- 改為**嚴格維持上限**：滿載時若包內全為受保護品質，與「未鎖定中評分最低者」捨弱留強——
  新品較強則分解最弱者收納新品；較弱（或包內全上鎖）則分解新品。數量恆不超過上限。
- 原行為保留：未受保護（傳說以下）新品滿載直接分解；包內有低品質犧牲品時優先分解騰位；
  上鎖裝備永不被自動分解。

### js/ui.js、js/main.js
- 背包計數（裝備分頁與神鑄分頁）超量時以紅字顯示。
- 讀檔時若背包超量（舊漏洞遺留），輸出提示：新掉落將維持上限，超出部分可用「分解設定」清理。

---

## 歷史變更摘要：刷新時優先載入本地最新存檔
- 啟動時掃描已授權資料夾內所有有效 `.json`，依 `savedAt` 選取最新快照。
- 若本地快照較新，啟動同步不再用舊 `localStorage` 主存檔反向覆蓋資料夾。
- 保留瀏覽器存檔作為未授權資料夾時的後備來源。

## 本次變更摘要：恢復裝備詳情中的已鑲嵌／已附魔效果
- 裝備本身已鑲嵌的寶石與已附魔效果恢復顯示在主裝備詳情區，呈現方式維持文字與效果列。
- 右側面板只顯示目前可選擇的寶石與附魔書，不再混入裝備既有內容。

## 本次變更摘要：明確標示裝備上的寶石與附魔
- 右側面板上方明確標示「裝備上的寶石」與「裝備上的附魔」。
- 已套用項目使用金色邊框，與下方可用庫存素材區分。

## 本次變更摘要：區分已鑲嵌與可用素材
- 右側面板拆分為已鑲嵌寶石、可用寶石、已附魔、可用附魔書四個區塊。
- 已套用的寶石／附魔 icon 使用金色邊框，滑鼠提示仍顯示完整效果與取下操作。

## 本次變更摘要：完成右側鑲嵌／附魔區域尺寸
- 右側面板調整為約 210px 寬、465px 高，與裝備詳情內容區對齊。
- 小圖示區改為固定高度容器內滾動，符合參考紅框範圍且不推移背包。

## 本次變更摘要：修復本地存檔三個操作按鈕
- 讀取、下載、刪除現在支援 `folderOnly` 本地資料夾存檔，不再只查 localStorage。
- 手動存檔在本地模式下直接保留 metadata，不會先寫完整快照而清空其他存檔索引。
- 刪除索引在配額不足時改用清理後重試，避免按鈕看似無作用。

## 本次變更摘要：配額不足時保留本地自動存檔
- 自動存檔的瀏覽器副本寫入失敗時，改直接寫入已授權資料夾的 `IC_autosave_run*.json`。
- 自動存檔清單只保存 metadata，不再因 5 MB 快照塞滿 localStorage 而消失。

## 本次變更摘要：修復存檔配額與 .crswap 暫存檔問題
- 儲存配額不足時先清理瀏覽器內的歷史完整快照副本，保留目前主存檔，避免自動存檔失敗造成回檔。
- 手動存檔在 localStorage 配額不足時改為直接寫入已授權的本地資料夾，再補回小型索引。
- 資料夾寫入失敗時呼叫 `abort()`，並在同步前清理已知的 0 KB `.crswap` 暫存檔。

## 本次變更摘要：右側小圖示化鑲嵌與附魔區
- 將裝備詳情中的寶石／附魔選擇與已套用項目移到詳情右側固定高度面板。
- 寶石與附魔書改為小型正方形 icon，完整名稱、數值、持有量與操作提示改由滑鼠 tips 顯示。
- 右側面板內部滾動，不再因鑲嵌／附魔清單把背包向下推移；點擊行為維持鑲嵌、附魔與取下功能。

## 本次變更摘要：調整新版裝備圖示融合效果
- 已裝備欄位改用較不透明的深色底，遮住新版底圖的淺色內襯。
- 已裝備圖示由欄位 80% 放大至 84%，減少黑色圖示與底圖之間的空隙。
- 空欄位不受影響，仍保留新版底圖的視覺效果。

## 本次變更摘要：修正裝備背景圖檔名路徑
- 實際檔名為 `images/character_UI .png`，CSS 原本的大小寫與檔名格式不一致。
- 修正 `#equip-grid` 背景圖引用，恢復裝備介面底圖與欄位框架。

## 本次變更摘要：增加護腿與靴子間距
- 腰帶上移約 1.3%，護腿上移約 3%。
- 護腿底部與靴子頂部增加空隙，避免中央欄位再次貼合。

## 本次變更摘要：依參考圖重排中央裝備欄位
- 中央欄位改為胸甲 → 腰帶 → 護腿 → 靴子的排列。
- 護腿恢復較高欄位，胸甲與靴子略縮短並分別調整上下位置。
- 在四個部位之間保留明顯間距，避免邊框與圖示互相擠壓。

## 本次變更摘要：修正中央裝備部位重疊
- 縮短胸甲欄位高度，降低胸甲圖示占用的垂直空間。
- 調整護腿與腰帶的位置及高度，讓胸甲、護腿、腰帶之間保留間距。
- 保持靴子位置不變，避免牽動左右武器與戒指排版。

## 本次變更摘要：手動存檔強制落地本地資料夾
- 「立即存檔」改為先確認／選擇本地資料夾，再建立手動存檔並強制寫出 `.json`。
- 只有本地資料夾寫入完成才顯示手動存檔成功；取消選擇或寫入失敗不再冒充本地存檔成功。
- 保留瀏覽器快取作為故障保護，但會明確標示未完成本地落地。

## 本次變更摘要：自動存檔同步至本地資料夾
- 已授權本地資料夾後，`saveGame()` 會同步寫出 `IC_autosave_run*.json`。
- 自動存檔不會自行跳出資料夾選擇器；首次授權仍由使用者手動完成，以符合瀏覽器安全限制。

## 本次變更摘要：修正存檔資料夾空白與同步數量誤判
- 寫出資料夾時不再靜默跳過缺少內容的索引記錄，回報實際寫出數量與跳過數量。
- 自動存檔內容遺失時使用目前存檔回填；索引為空但仍有目前存檔時寫出 `IC_current.json`。
- 修正引導 Banner 將取消選擇誤報為同步成功的訊息。

## 本次變更摘要：明確區分存檔同步與檔案下載
- 設定頁保留「打開／同步存檔資料夾」功能，主動點擊時每次叫出資料夾選擇視窗，選定後才同步寫入 .json 存檔。
- 新增「下載全部存檔」按鈕，方便從瀏覽器下載資料夾複製給其他本地遊戲。
- 更新說明文字，明確告知瀏覽器安全限制：網頁不能直接啟動 Windows 檔案總管。

## 本次變更摘要：加入本機測試連接埠隔離規則

### AI_RULES.md
- 明確禁止 Agent 使用使用者的 `127.0.0.1:5500`／`localhost:5500` 進行測試。
- 測試需改用其他 port 或獨立測試來源，避免干擾正式遊戲存檔。

## 本次變更摘要：修正存檔資料夾唯讀誤報

### js/save.js、js/ui.js
- 已連線資料夾先完成權限與同步，不再與新的資料夾選擇器並發。
- 取消資料夾選擇時不再顯示「已同步」，改為明確提示尚未寫入檔案。

## 本次變更摘要：修復自動存檔儲存空間恢復

### js/save.js
- 自動存檔寫入前清理索引外的孤兒資料與超出上限的舊記錄。
- localStorage 寫入失敗時，逐筆釋放最舊存檔並重試，避免「先寫入失敗、後清理無法執行」的死結。
- 自動存檔同時回報主存檔與本局記錄的寫入結果。

## 本次變更摘要：新增手腕欄位並重排護腿位置

### js/data.js、js/item.js、css/style.css、images/icon_wrist.png
- 裝備欄位由 12 格擴充為 13 格，新增手腕部位。
- 手腕採用與護手相近的攻擊類裝備與附魔分類，並加入新的腕甲圖示。
- 護腿由右側中段移到胸甲與腰帶之間，腰帶位置與護腿尺寸同步微調。
- 舊存檔缺少手腕欄位時，沿用既有存檔正規化流程自動補空槽。

## 本次變更摘要：修正全局減傷公式

### js/formula.js、js/data.js、game_formula.md
- 剩餘傷害倍率改為 `全局減傷 ÷（全局減傷 + 20000）`。
- 屬性 tooltip 的實際減傷百分比與戰鬥結算同步更新。

## 本次變更摘要：屬性提示直接顯示全局減傷結果

### js/data.js
- 移除「全局減傷」tooltip 中要求玩家自行代入的計算公式。
- 改為直接顯示目前實際減傷百分比，並以黃色標示。

## 本次變更摘要：恢復裝備詳情操作按鈕

### js/item.js、js/ui.js
- 裝備詳情恢復每條詞條的洗煉按鈕與可能詞條說明按鈕。
- 裝備滑過提示維持純資訊模式，不顯示可操作的按鈕。

## 本次變更摘要：修正護腿裝備圖示

### js/data.js、images/icon_legs_armor.png
- 新增獨立的黑鋼護腿圖示，讓護腿欄位不再錯誤使用靴子圖示。
- 護腿改用 `icon_legs_armor.png`；靴子仍維持使用原本的 `icon_legs.png`。

## 本次變更摘要：修復技能點遺失與回溯補回

### js/player.js、js/skills.js
- 技能點改以總預算 10000 點計算：初始兩個 1 級技能計入已使用 2 點。
- 轉生保留技能點總預算，轉生後升級不再增加；降級或刪除技能會依技能等級總和自動返還。

### js/save.js、js/main.js
- 舊 0 轉存檔依等級 +1 補建預算，已轉生存檔補建 10000 點。
- 移除技能投入超過轉生後目前等級就清空技能的錯誤邏輯，改為保留技能並安全限制可用點數。
- 讀檔時顯示技能點回溯修復通知。

## 本次變更摘要：恢復數值簡寫

### js/data.js
- 生命恢復與法力恢復改用統一大數字格式，顯示為 `K／M／B／T`，並保留 `/秒` 單位。

## 本次變更摘要：轉生法力倍率

### js/formula.js、js/player.js
- 法力總值改為與生命及四大屬性相同，於原始法力完成後套用轉生倍率。
- 轉生成功日誌加入法力倍率說明。

### js/ui.js、game_formula.md
- 轉生二次確認文字補充生命、法力與四大屬性皆會套用倍率。

## 本次變更摘要：轉生稱號顏色

### js/ui.js、css/style.css
- 1～4 轉稱號分別套用黃、藍、紫、紅色樣式。
- 5 轉稱號新增彩色漸層流動動畫。
- 側欄與戰鬥畫面的角色稱號同步套用轉生顏色。

## 本次變更摘要：修復轉生按鈕無作用

### js/ui.js
- 補回轉生按鈕的事件綁定與等級／轉生次數狀態更新。
- 9999 級且未達 5 轉時可開啟二次確認；確認後執行轉生並刷新角色、技能與戰鬥畫面。

## 本次變更摘要：技能一鍵滿級

### js/skills.js
- 新增 `maxUpgradeSkill`，逐級檢查技能點、金幣、技能樹鎖定與轉生後技能上限。
- 資源不足時停止在目前可達等級，避免超支或超過上限。

### js/ui.js、css/style.css
- 技能升級彈窗新增「⚡ 一鍵滿級」按鈕，放在「升級」右側。
- 技能操作列改為四欄，維持降級、裝備與融合按鈕的穩定排列。

## 本次變更摘要：轉生系統

### js/data.js、js/formula.js
- 新增 9999 級上限、最高 5 轉、角色階級、經驗倍率與生命／四維最終倍率。
- 一般技能每轉生增加 10 級上限，融合技能每轉生增加 20 級上限。

### js/player.js、js/save.js
- 新增轉生次數與轉生天賦點存檔欄位；舊存檔自動補值。
- 轉生後等級／經驗重置，保留裝備、技能、資源與關卡；升級改累加轉生天賦點。
- 等級達到 9999 後不再繼續升級。

### index.html、js/ui.js、css/style.css
- 角色側欄顯示階級與轉生次數，新增轉生按鈕與確認流程。
- 轉生按鈕未達條件時仍可懸停顯示提示，不使用禁止游標；天賦點僅保存不顯示。
- 轉生按鈕先顯示效果二次確認，確認後才執行；成功後再顯示目前轉生次數的恭喜彈窗。

## 本次變更摘要：技能升級彈窗固定按鈕排版

### js/ui.js
- 技能說明、下一級資訊、風味文字與解鎖提示統一放入固定高度的 `skill-modal-copy` 說明區。
- 技能點與操作按鈕改用獨立 class，避免上方文字高度變化推動按鈕位置。

### css/style.css
- 技能彈窗新增固定標題列、說明區、技能點列與按鈕區的 grid 排版。
- 說明過長時在說明區內捲動，技能名稱過長時以省略號顯示。
- 新樣式限定在 `#skill-modal`，不影響其他 `.detail-actions`。

## 本次變更摘要：BOSS 高塔連續挑戰

### js/tower.js
- `TOWER` 新增 `auto`（{ floor, total, done, wins }）與 `autoNextCd`；常數 `TOWER_AUTO_DELAY = 1 秒`、`TOWER_AUTO_MAX = 999`。
- 新增 `startTowerAuto(floor, count)`：驗證次數後啟動連挑（首場開場失敗即取消）。
- `towerTick`：場與場之間倒數 1 秒自動開始下一場；意外無法開場（金幣被其他系統消耗）則停止。
- `endTowerFight`：連挑模式下不彈結算視窗，直接 `finishTowerFight` 並判定——
  撤退 → 中止；次數用完 → 結束；金幣不足下一場 → 自動停止並回到野外；否則排程下一場。
  停止時皆輸出統計（共 X/Y 場，勝 W 敗 L）至 BOSS 戰日誌。

### index.html
- 高塔列表上方新增「🔁 連續挑戰次數」數字輸入列（預設 5，1~999）；
  戰鬥標頭新增 `#tw-auto-status`（連挑進度「第 X/Y 場（勝 N）」）。

### js/ui.js
- `renderTower`：每個已解鎖樓層新增「🔁 連挑」按鈕（含懸停說明）。
- 事件委派：`data-tower-auto` 讀取次數輸入並呼叫 `startTowerAuto`；
  手動「挑戰」會取消等待中的連挑。
- `renderTowerFight` 顯示連挑進度。

### css/style.css
- 新增 `.tower-auto-bar`、`#tw-auto-count`、`#tw-auto-status` 樣式。

---

## 歷史變更摘要：本機 GM 指令集

### 新增檔案
- `GM_command.md`：詳細記錄本機限制、鍵盤操作、貨幣／材料／寶石／附魔書／裝備／零件／等級／商店／存檔指令與範例。
- `js/gm.js`：獨立的 GM 指令解析與執行模組。
- `tests/gm-command.test.cjs`：驗證外部環境封鎖與本機 Enter/Escape 行為。

### 安全與 UI
- 只接受 `localhost`、`127.0.0.1`、`::1`；外部環境不建立輸入框、不註冊鍵盤事件，執行時再次檢查 hostname。
- 本機按 Enter 開啟左下角輸入框；指令執行後保留輸入文字，可重複按 Enter 執行；空白 Enter 或 Escape 關閉。
- 裝備 GM 發放直接加入背包，不觸發一般背包滿載自動分解。

### index.html / js/main.js / css/style.css
- 載入 GM 模組並於遊戲初始化後啟用本機 GM；新增左下角輸入框、狀態文字與錯誤樣式。

## 本次變更摘要：寶石商店等級與機率改造

### js/data.js / js/formula.js
- 新增商店 Lv.1～20 的刷出數量機率表與寶石階級機率表。
- 更新 1～10 階寶石購買價格：5,000～8,000,000,000 金幣。
- 新增商店升級費用公式：`10000 + 商店等級^3 × 4000000`，Lv.20 為滿級。

### js/item.js / js/player.js / js/save.js
- 商店狀態新增 `level`，舊存檔缺少時自動補為 Lv.1。
- 升級成功扣款、提升等級並立即依新等級重刷商品；金幣不足或已滿級時不變更狀態。

### index.html / js/ui.js / css/style.css
- 商店右上新增等級與升級按鈕。
- 商品格改為十欄排列並縮小 icon、文字與按鈕，提升單排可見數量。

## 本次變更摘要：顯示高階寶石與調整寶石庫存圖示

### js/ui.js
- 一般寶石總表與轉換庫存區由 1～5 階擴充為顯示 1～10 階，修正 6 級以上神鑄寶石不會顯示的問題。
- 庫存寶石項目改用方形 icon 結構：左上顯示數量、中央顯示 icon、底部顯示等級；完整名稱保留於 tooltip。
- 寶石融合素材池同步使用相同的方形 icon 結構。

### js/item.js / index.html
- 寶石拆解支援選取 6～10 階寶石，並補上對應等級選項。

### css/style.css
- 一般寶石轉換庫存與融合素材池改為 48×48 方形格，約比神鑄背包格縮小 30%。

## 本次變更摘要：固定元素攻擊的元素抗性減傷

### js/formula.js
- 抽出 `elementalResistanceMultiplier`，明確規定 `elemAtk` 只套用對應元素抗性（上限 75%），不重複套用魔法抗性。
- 新增元素抗性回歸測試，確認 50% 火焰抗性會將火焰附傷減半。

## 本次變更摘要：神鑄背包區補上金色外框

### index.html
- 神鑄分頁的背包容器加上 `id="forge-inv-box"`。

### css/style.css
- 金色外框樣式選擇器由 `#inv-section-box` 擴為 `#inv-section-box, #forge-inv-box`，
  神鑄背包區與裝備分頁背包區外觀一致（金色 1px 邊框、深色底、內距 12px）。

---

## 歷史變更摘要：將高塔 BOSS 戰日誌與一般戰鬥日誌分離

### index.html
- 在 `#battle-log` 下方新增一個獨立的 `#boss-log` 容器，專門用來存放高塔 BOSS 戰日誌。

### js/ui.js
- `blog`：當日誌分類為 `boss` 時，改寫入 `#boss-log` 容器，其他分類維持寫入 `#battle-log`，藉此將 BOSS 戰日誌與一般戰鬥日誌完全隔開，避免被高頻率的一般戰鬥日誌洗掉。
- `miniSnapshot`：若當前顯示的是高塔 BOSS 戰日誌，迷你監控視窗的日誌來源將自動切換為 `#boss-log`。
- 日誌篩選器事件監聽：當選擇「高塔BOSS戰」時，隱藏 `#battle-log` 並顯示 `#boss-log`；選擇其他類別時則隱藏 `#boss-log`、顯示 `#battle-log` 並套用對應的篩選樣式。

---

## 歷史變更摘要：修正 BOSS 魔塵掉落率改依「樓層」計算

### js/formula.js
- `bossDustRate` 參數由 BOSS 等級改為**樓層**：= min(30%, 2% + 樓層 × 0.2%)
  （第 1 層 2.2%、第 2 層 2.4%、第 140 層起封頂 30%；先前誤用 BOSS 顯示等級 Lv.7+5×樓層，導致第 1 層顯示 4.4%）。

### js/tower.js、js/ui.js、js/data.js
- 通關掉落判定與樓層懸停提示改傳入樓層；常數註解同步修正。

---

## 歷史變更摘要：寶石融合開放 5 階以上素材；明確融合寶石不可神鑄

### js/item.js
- `normalizeFuseMaterial`：plain 素材支援 `ref.lv`（5~10 階，省略視為 5 階向下相容）；
  數值取 `gemStatValue(type, lv)`；`leaves` 改以「5 階等值」計（2^(階級−5)），拆解成本換算維持一致。
- `consumeFuseMaterial` 依素材實際階級扣庫存；`fuseGemsV2` 的同種重複檢查改為「同種同階需 2 顆」。

### js/ui.js
- `renderGemFusion`：素材池列出 5~10 階全部一般寶石（含神鑄寶石，附階級色與能力值提示）；
  融合槽顯示實際階級；點擊委派 `data-gfuse-pick` 改帶階級參數。

### index.html
- 寶石融合面板標題改「5 階以上寶石均可，含神鑄寶石」；說明補「融合寶石無法用於神鑄法陣」。
- 神鑄面板說明補「融合寶石無法用於神鑄（可至寶石分頁進行融合）」
  （結構上本就不可：神鑄寶石頁僅列一般寶石庫存，融合寶石為獨立實體）。

---

## 歷史變更摘要：暫停合成節點與合成材料

### 功能調整
- 新增 `SYNTHESIS_ENABLED = false` 統一關閉合成節點執行、合成素材篩選與合成專用零件生成。
- 隱藏生產線合成節點與「合成素材」篩選選項；舊存檔中的合成篩選會轉為「保留」，既有資料不刪除。
- 野外、高塔及分解額外獎勵不再生成合成節點專用零件；其他分解零件與寶石、附魔書、附魔精華維持正常。
- 新增合成關閉回歸測試，並更新既有輸送帶測試以驗證掉落不會再進入合成暫存區。

## 本次變更摘要：神鑄系統支援寶石鑄造（6~10 階神鑄寶石）

### js/data.js
- 新增 `GEM_FORGE_MAX_LEVEL = 10`（6~10 階為神鑄寶石，僅能由神鑄法陣合成）；`GEM_NAMES` 擴充至十級。
- 新增 `FORGE_GEM_BASE_RATE`（五階 45%｜六階 35%｜七階 25%｜八階 15%｜九階 5%）與
  `FORGE_GEM_DUST_RATE = 3`（寶石鑄造每個魔塵 +3%）。

### js/formula.js
- `gemStatValue` 擴充：6 階起每高 1 階能力 ×2（例：五階紅寶石物攻 54 → 六階 108 → 十階 1728）。
- 新增 `forgeGemSuccessRateFor` 與 `forgeGemCost`（= 100 萬 +（階級 − 5）× 100 萬）。

### js/forge.js
- 新增法陣雙模式（裝備 / 寶石，不可混放）：`forgeMode`、`forgeGemFirst`、`forgePlaceGem`
  （限 5~9 階、六顆同種同階，放入時即自庫存扣除）；取回/全卸下歸還寶石庫存。
- `forgeRateInfo` 改回傳 `{ mode, base, dust, total, cost }`；`doForge` 增寶石分支：
  成功 → 同種高一階寶石 x1；失敗 → 損失 2 顆、退回 4 顆。

### js/item.js
- `totalGemsAll` 與 `socketGem`（自動取最高階）涵蓋 6~10 階。

### js/save.js
- 神鑄槽位遷移迴圈跳過寶石項目（`kind:'gem'` 無 name/sockets）。

### index.html
- 神鑄背包新增「🎒 裝備 / 💎 寶石」切頁按鈕；面板說明補寶石鑄造規則。

### js/ui.js
- `GEM_TIER_COLORS` 擴充 6~10 階配色；`renderForge` 支援寶石槽位/中央寶石產物/寶石費率行/
  寶石庫存網格（全部寶石列出，非 5~9 階灰階顯示，含能力值與持有數提示）。
- 事件委派新增 `data-forge-gem` 點擊放入；`initUI` 綁定切頁按鈕。
- 頂欄寶石總數/提示、裝備詳情鑲嵌選擇涵蓋 6~10 階。

### css/style.css
- 新增 `.forge-inv-tabs`（切頁按鈕，作用中金色）與 `.forge-gem-cell`（寶石格、數量角標）樣式。

---

## 歷史變更摘要：提高寶石轉換九宮格單次放入上限為 100 顆

### js/formula.js
- 將 `GEM_CONVERT_STACK` 常數的值從 `10` 提高至 `100`。

### js/item.js
- 更新 `convertGems` 函數的標頭註釋，將原上限「10 顆」文字同步修改為「100 顆」。

### index.html
- 更新寶石轉換區塊的提示說明文字，將「每格上限 10 顆」修改為「每格上限 100 顆」。

### game_formula.md
- 更新寶石轉換（九宮格）設計規格文檔，將每格上限改為 **100 顆**。

---

## 歷史變更摘要：修復裝備詳情懸停提示超出框線與裁剪問題

### js/item.js
- 將屬性洗煉按鈕 (🎲) 的懸停提示，由 CSS 內置的 `.btn-tip` 改為使用 `data-tip` 屬性，搭配 `esc()` 處理 HTML 跳脫。
- 將屬性條目 (如洗煉區間) 的懸停提示，由 CSS 內置的 `.btn-tip` 改為使用 `data-tip` 屬性。
- 以上調整使它們統一透過事件委派觸發全域的 `#sk-tooltip` (Diablo 風格懸浮框)，該懸浮框採用 `position: fixed` 與視窗邊緣溢出計算，徹底解決在滾動容器中被裁切與超出框線的問題。

### js/ui.js
- 將裝備詳情下方的「強化」按鈕懸停提示改為全域 `data-tip` 屬性，保持 UI 體驗一致性。

### css/style.css
- 移除不再使用的 `.act-btn-tooltip .btn-tip` 與 `.act-btn-tooltip:hover .btn-tip` 樣式規則，進行代碼洗滌。

---

## 歷史變更摘要：神鑄系統（Divine Forge）

### 新增檔案
- `js/forge.js`：神鑄邏輯層。六芒星槽位放入/取回、魔塵放置、成功率計算、鑄造判定
  （成功消耗 6 件產出下一品質；失敗隨機消耗 2 件、其餘退回背包；素材上的鑲嵌寶石一律先取回）。

### js/data.js
- `RARITIES` 新增第 9 階 `godforged`「神鑄創世」（`#f5c542`、mult 10.2 = 創世 × 1.5、salv 45）；
  `RARITY_PREFIX` 補「神鑄創世的」。
- 新增神鑄常數：`GODFORGED_IDX`、`FORGE_BASE_RATE`（傳說 55%｜神話 40%｜創世 25%）、
  `FORGE_GOLD_COST`（500 萬｜200 萬｜1 億）、`FORGE_DUST_RATE`（+5%/個）、魔塵掉落常數（野外 150 級+ 0.1%；BOSS 2% + 0.2%/級、上限 15%）。
- 新增 `GODFORGE_POOL`：12 種神鑄創世專屬特效（龍血/神力/神速/屠神/貪婪/神壁/天罰/破滅/聖佑/不朽/萬象汲取/神怒）。

### js/formula.js
- 新增 `towerChallengeCost`（100000 + BOSS等級 × 200000）、`bossDustRate`、`godforgePassiveValue`、`forgeSuccessRateFor`。
- `computeStats`：聚合裝備上的 `godPassives`（屬性型入聚合桶、觸發型入 passives）。
- `resolveHit`：掛入【破滅】（暴擊翻倍）、【聖佑】（受傷減免，上限 50%）、【不朽】（致命攻擊保命，60 秒一次）。
- `itemScore`：每條神鑄特效 ×1.15。

### js/item.js
- `makeEquipment`：品質為神鑄創世時必骰 2 條不重複專屬特效。
- `itemDetailHTML`：新增 `.it-godpassive` 專屬特效顯示區塊。

### js/factory.js
- 品質合成 / 混合合成大成功的品質上限鎖定在創世（`GODFORGED_IDX - 1`），神鑄創世僅能由神鑄系統產出。
- 名稱前綴剝除 regex 補「神鑄創世的」。

### js/combat.js
- `playerAtkCfg` 掛【神怒】與【破滅】；`playerDefCfg` 掛【聖佑】【不朽】。
- `doPlayerAttack` 掛【天罰】（250% 物攻真傷）與【萬象汲取】（生命/法力雙回復）。
- `rollFieldDrops`：敵人等級 ≥150 掉落魔塵 0.1%（150 以下不掉）。

### js/tower.js
- `startTowerFight`：挑戰前扣金幣（不足則阻擋並提示）。
- `endTowerFight`：勝利依 `bossDustRate(BOSS等級)` 掉落魔塵並列入獎勵。

### js/player.js
- `newGameState`：新增 `player.dust`、`forge` 狀態（slots/dust/autoDust/result/log）；篩選規則陣列擴至 9 格。

### js/save.js
- `migrateSave`：fixSockets / fixName 迴圈納入神鑄槽位；fixName regex 補「神鑄創世的」（置首防截半）。

### index.html
- 頂欄資源列新增 💫 魔塵；頁籤列新增「🔯 神鑄」；新增 `#tab-forge` 區塊（法陣/紀錄/按鈕/自動魔塵/背包）；
  載入 `js/forge.js`；玩法指南更新為品質 9 階並補神鑄說明。

### js/ui.js
- 新增 `renderForge`（槽位/魔塵符位/中央產物/成功率/紀錄/背包灰階過濾）與 `UI.dirty.forge` 驅動。
- 事件委派：法陣槽位點擊取回、魔塵符位點擊放置/取下、神鑄背包點擊放入；綁定鑄造/全卸下/自動魔塵。
- `itemCellHTML` 支援 extraClass 與 `eff-godforged`；`findItemById` 涵蓋神鑄槽位。
- `renderHeader` 顯示魔塵；高塔樓層列表與懸停提示顯示挑戰費用與魔塵掉落率。

### css/style.css
- 新增神鑄版面（`#forge-stage` 以 Hexagram.png 為底、百分比定位槽位/魔塵符位/中央產物/浮動紀錄/黃色按鈕）、
  `.eff-godforged` 耀金流光邊框、`.it-godpassive` 專屬特效金框樣式。

### 使用者調整（第五輪）
- 野外魔塵掉落率改為**成長制**：150 級 0.1%，敵人每高 1 級 +0.1%，上限 5%
  （新公式 `fieldDustRate` → formula.js §5；149 級以下仍不掉落）。
- 高塔 BOSS 魔塵掉落率上限 15% → **30%**（`DUST_BOSS_CAP`，約第 27 層起封頂）。

### 使用者調整（第四輪）
- 鑄造成功產物的等級由「六件素材平均」改為「**六件素材中的最高等級**」（js/forge.js doForge）。
- 魔塵符位由計數制改為**六格獨立**（`G.forge.dustSlots` 布林陣列）：點哪個角尖就在該位置放入/取下，
  不再從第 1 格順序填入；自動使用魔塵仍由第 1 格起補滿；舊存檔的計數值自動轉換為前 n 格點亮。

### 使用者調整（第三輪）
- 神話裝備鑄造費用 200 萬 → **2000 萬**（data.js `FORGE_GOLD_COST`）。
- 高塔挑戰費用改為 **100000 + 樓層 × 200000**（formula.js `towerChallengeCost`；魔塵掉落率仍依 BOSS 等級）。
- 神鑄頁籤移至「技能」之後；**角色 1000 級開放**（`FORGE_UNLOCK_LEVEL`），未達標前頁籤隱藏
  （index.html 預設 `display:none`、renderHeader 依 `forgeUnlocked()` 切換）；
  達標時彈出「神鑄系統已開啟！」確認彈窗（可直接前往神鑄分頁），
  以 `G.forge.unlockNotified` 旗標保證僅提示一次（涵蓋升級當下與讀檔已達標兩種情況）。

### 對抗式審查後的修復（第二輪）
- **裝備複製漏洞**（js/ui.js）：撤銷 `findItemById` 對神鑄槽位的搜尋擴充——`detailAction('equip')`
  只以 `indexOf` 防護背包，殘留的 `UI.sel` 原可將法陣內裝備再次穿上造成雙重引用；
  另在神鑄背包點擊放入成功後清除同 id 的選取狀態。
- **退回銷毀風險**（js/forge.js）：新增 `forgeReturnItem`，法陣取回/全卸下/失敗退回一律保證放回背包
  （滿載時允許暫時超出容量），不再走 `addToInventory` 的滿載自動分解路徑（傳說品質原可能被銷毀）。
- **高塔統計負值**（js/tower.js）：【不朽】觸發使血量回升時，`bossDmgDealt` 統計以 `Math.max(0, …)` 防倒扣。
- **神鑄特效接入技能**（js/skills.js）：【神怒】對技能傷害同步生效、【破滅】對技能暴擊同樣適用；
  【天罰】【萬象汲取】依特效描述「攻擊時」維持僅普攻觸發。
# 本次變更摘要：補充 GM 指令中文對照

- 更新 `GM_command.md`：寶石、附魔與裝備部位 key 改為逐行列出，並補上每個 key 的中文名稱。
- 保留原有指令格式、範例與 localhost 限制，僅改善文件可讀性。
# 本次變更摘要：GM 指令支援扣除金幣與材料

- `gold`、`g`、`scrap`、`essence`、`dust` 與 `mat` 支援輸入負整數扣除資源。
- 資源扣除後最低為 0，避免產生負資源。
- 寶石、附魔書、裝備與零件仍只接受正整數，負數輸入不會發放物品。
- 新增 GM 測試覆蓋正負資源數量與物品負數拒絕行為。
# 本次變更摘要：普通關卡多敵人與範圍技能

- 普通關卡依 `78% / 15% / 5% / 2%` 機率生成 1～4 隻敵人；菁英與高塔 BOSS 固定單一敵人。
- 野外戰鬥改用敵人集合管理；每名敵人的金幣、經驗與掉落獨立結算，全部擊殺後才推進階段。
- 普攻固定攻擊第一名存活敵人，該敵人死亡後才切換下一名。
- 多敵人時技能攻擊所有存活敵人，每名敵人傷害為 `技能基礎傷害 ×（1＋範圍傷害%）÷ 敵人數量`；普攻不套用範圍傷害。
- 敵方 UI 改為 2×2 響應式敵人卡片，縮小圖示、血條與狀態資訊，並為每名敵人保留獨立傷害浮字層。
- 新增 `tests/multi-enemy.test.cjs`，擴充技能測試覆蓋多目標傷害與普攻規則。
# 本次變更摘要：敵方排版依示意圖修正

- 移除多敵人卡片自身的外框與背景，不再為每隻敵人加額外框線。
- 單敵人恢復原本的大圖示、血條與狀態資訊尺寸。
- 雙敵人改為上下排列。
- 三敵人改為上方 1 隻、下方 2 隻；四敵人維持上下各 2 隻。
# 本次變更摘要：修正敵人圖像區與戰鬥狀態不同步

- 敵人圖像區改用戰鬥引擎相同的敵人集合來源。
- `FIELD.monsters` 暫時為空但 `FIELD.monster` 仍有有效目標時，不再錯誤顯示「搜尋敵人中」。
- 新增狀態同步回歸測試。
# 本次變更摘要：同步敵方 HTML 容器

- `index.html` 敵方區改用 `mv-party` 容器，與 `js/ui.js` 的多敵人渲染邏輯一致。
- 移除舊版 `mv-emoji`、`mv-hp`、`mv-name`、`mv-status` 等單敵人固定 DOM，避免舊血條殘留。
# 本次變更摘要：全局減傷詞綴與項鏈／鞋子附魔擴充

- 新增史詩以上、全部位可生成的定值詞綴 `全局減傷`，數值基準比照物防／魔防定值詞綴。
- 全局減傷在最終傷害階段套用 `原始傷害 × 1000 ÷（全局減傷總合 + 30000）`；沒有此詞綴時維持原傷害。
- 全局減傷涵蓋一般命中、元素傷害、持續傷害與反震傷害路徑，真實傷害仍沿用共用最終結算。
- 項鏈／鞋子附魔由 2 種擴充為 7 種，新增活力、澄明、專注、財運、智慧附魔並接入生命、法力、冷卻、金幣與經驗屬性。
- 新增全局減傷與功能附魔測試。
- GM 指令文件同步補上 5 種新附魔 key 的中文對照。
# 本次變更摘要：修正敵方傷害浮字過早消失

- 敵方戰鬥卡片不再每 0.2 秒整個重建，避免移除尚未完成動畫的傷害浮字。
- 敵人換波或數量變化時才重建卡片；一般戰鬥中只更新血條與狀態文字。
- 敵方浮字現在沿用與我方相同的約 0.95 秒顯示週期。
# 本次變更摘要：普通敵人 tips 補上魔塵掉落

- 野外普通敵人情報的「可能掉落」新增魔塵與對應掉落機率。
- 掉落率沿用 `fieldDustRate`，150 級以下不顯示，最高 5%。
- 高塔 BOSS tips 維持原本的魔塵顯示，不重複加入。
# 本次變更摘要：神鑄失敗補償魔塵

- 裝備神鑄與寶石神鑄失敗時，固定獲得魔塵 x1。
- 失敗日誌、神鑄成功率提示與遊戲說明均補上此規則。
- 新增神鑄失敗補償測試。
# 本次變更摘要：神鑄紀錄補上魔塵獲得訊息

- 裝備與寶石神鑄失敗時，法陣內部紀錄新增獨立的「獲得 魔塵*1」訊息。
- 保留原本一般系統日誌中的失敗補償訊息。
# 本次變更摘要：屏蔽遊戲畫面反白與一般 focus 外框

- 遊戲畫面預設禁止文字反白與拖曳選取。
- 輸入框、文字區、下拉選單與 GM 輸入框保留正常文字選取／輸入功能。
- 屏蔽非輸入元素的 `selectstart` 與一般按鈕／下拉選單 focus 外框。
- 保留遊戲自訂的裝備選取白框。
# 本次變更摘要：戰鬥結算改為即時傷害統計

- 結算彈窗開啟時新增並更新「目前戰鬥（即時統計）」卡片。
- 死亡時即時卡片會轉為歷史戰鬥紀錄，避免重複顯示。
- 按鈕、彈窗標題與說明統一改為「傷害統計」。

# 本次變更摘要：裝備圖示批次去背

- `images/icon_weapon.png`、`icon_helmet.png`、`icon_shoulder.png`、`icon_chest.png`、`icon_belt.png`、
  `icon_gloves.png`、`icon_wrist.png`、`icon_legs_armor.png`、`icon_legs.png`、`icon_ring.png` 改為 RGBA PNG。
- 透明度由裝備輪廓遮罩產生，RGB 仍取自原始圖示；去除黑色／藍灰色背景、保留裝備材質、光效與戒指內圈透明。
- 新增 `tests/equipment-background-removal.test.cjs`，檢查 10 組圖示均為帶透明通道的 PNG。

# 本次變更摘要：神鑄創世彩色流動外框

- `css/style.css` 的 `.eff-godforged` 改用彩虹色 `conic-gradient` 旋轉動畫，並加入粉藍外部光暈。
- 保留深色內襯，避免彩色動畫遮蓋裝備圖示；只影響神鑄創世類別，不改變其他品質外框。
- 補上 `prefers-reduced-motion` 支援與 `tests/godforged-border-effect.test.cjs` 回歸檢查。

# 本次變更摘要：加快神鑄創世外框並恢復創世級背景色

- 彩虹外框動畫週期由 `1.8s` 調整為 `0.9s`，流動速度加快一倍。
- 神鑄創世內襯改回與創世裝備一致的金色漸層，避免被深色特效內層壓暗。
- 更新 `tests/godforged-border-effect.test.cjs` 驗證動畫速度與金色內襯。

# 本次變更摘要：新增項鏈專用圖示

- 新增 `images/icon_amulet.png`：透明背景的暗黑風格項鏈圖示。
- `js/data.js` 的 `SLOT_INFO.amulet` 改用 `icon_amulet.png`，不再誤用 `icon_gems.png` 寶石資源圖。
- 新增 `tests/amulet-icon.test.cjs`，檢查項鏈圖檔存在、為 RGBA PNG 且不引用寶石圖。

# 本次變更摘要：神鑄創世加入半透明旋轉背景

- `.eff-godforged::after` 在創世級金色內襯上加入低透明度黑色旋轉 `conic-gradient`。
- 使用 `--godforged-inner-angle` 與 `godforgedInnerFlow` 動畫，不遮蓋裝備圖示與彩虹外框。
- 減少動態偏好時同步放慢內部旋轉效果；回歸檢查同步驗證內部動畫存在。

# 本次變更摘要：再次加快三倍彩色外框

- 神鑄創世彩色外框 `godforgedRainbowSpin` 週期由 `0.9s` 改為 `0.3s`。
- 只調整彩色外框速度，內部黑色旋轉背景維持原設定。
- 更新 `tests/godforged-border-effect.test.cjs` 並通過差異檢查。

# 本次變更摘要：依 game_formula.md 更新轉生設定

- 最高轉生次數由 5 轉提升至 10 轉，新增破世者、不朽者、大主宰、至高尊主、位面創世神階級名稱。
- 生命、法力與四維的轉生倍率擴充為 1～10 轉的 `10/20/40/80/160/320/640/1280/2560/5120`。
- 升級經驗倍率改為 `10^轉生次數`，符合「轉生後為上次轉生的 10 倍」規格。
- 初始側欄改顯示 `0/10`，公式表格同步補上新的經驗倍率說明。
- `tests/xp-formula.test.cjs` 新增 10 轉與倍率遞增回歸檢查。

# 本次變更摘要：補正最新 11 個轉生稱號

- 依最新版 `game_formula.md` 更新稱號順序：冒險者、勇者、大劍師、破世者、不朽者、王者、大主宰、神聖尊者、大聖王、至高主宰、位面創世神。
- `REINCARNATION_RANKS` 現在完整對應 0～10 轉，不再使用舊版「聖王／至高尊主」名稱。
- 回歸測試補上 11 個稱號的完整陣列比對。

# 本次變更摘要：神鑄 0 轉 1000 級永久解鎖

- 神鑄改為僅在 0 轉達到 1,000 級時首次解鎖，並保存 `G.forge.unlocked` 永久旗標。
- 轉生後即使等級回到 1 級，神鑄頁籤仍保持開放。
- 舊存檔已有 `unlockNotified` 時會自動遷移為永久開放。
- 新增 `tests/forge-unlock.test.cjs` 覆蓋首次解鎖、轉生後保持開放與未達門檻情況。

# 本次變更摘要：修正背景分頁自動鑄造少結算

- 原因：背景分頁計時器被瀏覽器降頻後，`gameTick` 將累積時間限制為 10 秒，超出時間直接遺失；`forgeTick` 也只結算一輪。
- `forgeTick` 現在依實際結束時間連續補算最多 200 輪自動鑄造。
- 下一輪鑄造時間接續上一輪 `endAt`，不再以背景喚醒當下重新計時。
- 更新 `game_formula.md` 的背景運行計時說明與 `tests/forge-duration.test.cjs` 回歸檢查。

# 本次變更摘要：神鑄失敗消耗調整為 3 個

- `FORGE_FAIL_CONSUME` 由 2 改為 3；裝備與寶石神鑄失敗均消耗 3 個素材、退回其餘 3 個。
- 同步神鑄介面提示、說明文字與 `game_formula.md` 規則表。
- 新增 `tests/forge-failure.test.cjs` 回歸檢查失敗消耗規則。

# 本次變更摘要：寶石合成加入全部類型選項

- 寶石合成類型選單新增「💎 全部類型寶石」。
- 單次與全部合成會逐種類處理可合成庫存，不會把不同種類寶石混合消耗。
- 同步合成資訊摘要、`game_formula.md` 規則說明，並新增 `tests/gem-compose-all.test.cjs`。

# 本次變更摘要：調整高階裝備洗煉精華消耗

- 神話裝洗煉消耗 9 個精華，創世裝消耗 14 個，神鑄創世消耗 20 個。
- 普通至傳說仍沿用 `1 + 稀有度` 的原本公式。
- 新增 `REROLL_ESSENCE_COST` 設定與 `tests/reroll-cost.test.cjs` 回歸測試，並同步 `game_formula.md`。

# 本次變更摘要：調整寶石商店手動刷新費用

- 手動刷新費用改為 `5000 ×（下一次重置序號^2.5）`。
- 第一次刷新為 5,000 金幣，之後依本週期刷新次數指數成長；每 8 小時重置次數。
- 更新 `tests/gem-shop.test.cjs`、`game_formula.md` 與商店費用常數。

# 本次變更摘要：擴充自動機組零件安裝與階級

- 分解槽由等級成長格數改為固定 10 格；同類未安裝零件最多保留 10 個。
- 零件最高階級由 T5 提升至 T7，野外與高塔掉落公式同步放寬上限。
- 可用零件改為每種類只顯示一行並附數量，點擊時優先安裝最高階級、同階最高數值的零件。
- 新增 `tests/factory-parts.test.cjs` 覆蓋 T7、10 格、彙總顯示與優先安裝行為。

# 本次變更摘要：修正 F11 與網頁全螢幕按鈕的狀態衝突

- 全螢幕按鈕現在明確使用網頁 Fullscreen API，進入後可由按鈕或 Esc 退出。
- 偵測到使用者透過瀏覽器 F11 進入的全螢幕時，不再重複呼叫 `requestFullscreen`，並提示按 F11 返回正常視窗。
- 新增 `tests/fullscreen-toggle.test.cjs`，同步修正按鈕提示文字。

# 本次變更摘要：太古詞條與太古精華系統

- 新增全新的 `images/icon_ancient_essence.png`，不再沿用附魔精華或融合技能圖示，並接入右上角資源列。
- 200 級以上自然掉落裝備逐詞條判定太古詞條；野外與高塔 BOSS 使用各自的獨立機率公式。
- 太古詞條固定為原洗煉上限 ×1.35，文字與六角星標記改用橘色顯示。
- 太古精華接入野外／高塔掉落、傳奇以上裝備拆解、離線收益與存檔；裝備詳情新增「使用太古精華」勾選。
- 勾選後每次洗煉消耗 1 顆太古精華，每個重骰詞條獨立以 20% 機率成為太古詞條，原太古詞條也可重骰回普通詞條。
- 新增 `tests/ancient-affix.test.cjs`，同步更新 `game_formula.md` 與 `PLAN.md`。

# 本次變更摘要：調整拆解太古精華機率

- 史詩裝備拆解取得太古精華機率調整為 0.5%。
- 傳說裝備拆解取得太古精華機率調整為 2%。
- 神話 10%、創世 100%、神鑄創世 100% 維持不變，並更新回歸測試與公式文件。

# 本次變更摘要：互換獨特與史詩品質顏色

- 獨特品質文字改用金色 `#ffd700`。
- 史詩品質文字改用紫色 `#c084fc`。
- 新增品質顏色回歸檢查，確保兩個稀有度的數值與顏色正確對換。

# 本次變更摘要：分解槽擴充與太古精華萃取零件

- 新增 T1～T7「太古精華萃取器」，加成為目前太古精華拆解機率的倍率：+25%～+175%。
- 每條太古詞條在拆解時另有獨立 50% 太古精華判定；任一判定成功時取得 1 顆。
- 分解槽改為初始 1 格、金幣逐格解鎖，最高 20 格；舊存檔沒有欄位時保留原有 10 格。
- 最後追加擴充分解槽按鈕，顯示目前解鎖數量與下一格金幣費用。
- 拆解設定介面的獨特／史詩文字顏色同步改為金色／紫色。

# 本次變更摘要：修正分解槽起始數量與擴充費用

- 分解槽固定從目前既有的 10 格開始，總上限 20 格。
- 下一次擴充以解鎖後的目標格數計費；10 格擴充至第 11 格時，費用為 590,490,000 金幣。
- 修正錯誤顯示為 `1/20` 與錯誤套用第 1 格費用的問題。

# 本次變更摘要：擴充分解槽立即更新

- 擴充分解槽沒有冷卻時間。
- 成功擴充後立即刷新槽位數量、下一格費用與金幣，不再等待 UI 更新週期。
- 擴充按鈕事件加入事件隔離，避免被其他全域點擊處理器干擾。

# 本次變更摘要：分解槽零件圖示統一

- 碎片、金幣、附魔精華、寶石、附魔書與太古精華相關零件，改用右上角資源列同款圖示。
- 同時影響已安裝與可用零件列表；不對應材料的速度、經驗、零件等能力保留原本圖示。
- 複製處理艙與幸運晶片會顯示其對應的多種材料圖示。

# 本次變更摘要：裝備評分位置調整

- 評分從裝備名稱列移到裝備等級列右側。
- 評分與裝備等級同列對齊，避免長裝備名稱或品質文字被遮住。

# 本次變更摘要：右上角資源提示完整數值

- 金幣、裝備碎片、附魔精華、魔塵與太古精華的提示改用完整逗號分隔數值。
- 提示內容沿用 `renderHeader` 的資源更新流程，資源變動後會同步更新。
- 寶石與附魔書提示格式維持原樣。

# 本次變更摘要：暫時強制關閉合成節點

- 合成節點目前維持 `SYNTHESIS_ENABLED = false`。
- 新增 `#synthesis-node { display: none !important; }`，避免 `.node-card` 樣式覆蓋 HTML 的 `hidden` 屬性。
- 合成相關邏輯與資料保留，待未來明確要求重新開放時再進行改造。

# 本次變更摘要：調整每波敵人數量機率

- 普通與菁英關卡共用數量表：1 隻 60%、2 隻 25%、3 隻 10%、4 隻 5%。
- 菁英不再固定只生成 1 隻，仍保留菁英屬性與原有菁英掉落／戰鬥加成。

# 本次變更摘要：調整菁英戰利品掉落倍率

- 菁英裝備掉落率由舊版 2 倍改為一般基礎的 1.5 倍。
- 菁英材料掉落率統一在原公式上乘 1.5（例如 10% → 15%），包含寶石、附魔書、精華、太古精華、魔塵與零件。
- 材料成功後的數量公式不變，菁英經驗、金幣與戰鬥屬性不因本次調整而改變。

# 本次變更摘要：擴大多敵人戰鬥顯示區

- 戰鬥區域寬度由 450px 調整為 500px。
- 敵方欄位提高配置比例並設定較大的最小寬度，多敵人卡片不再過度壓縮。
- 多敵人區域高度與敵人圖示同步放大；單敵人顯示尺寸維持原本規則。

# 本次變更摘要：太古詞條最低品質限制

- 太古詞條最低品質調整為史詩，只有史詩、傳說、神話、創世與神鑄創世裝備可出現。
- 普通、精良、稀有裝備即使達到等級與機率條件，也不會生成太古詞條。
- 洗煉時同步套用此品質限制，並新增回歸測試。

# 本次變更摘要：階段列新增直達最高

- 新增「直達最高」按鈕，一次跳至目前場景的最高紀錄階段。
- 跳轉時重置目前階段擊殺進度並清空當前敵人，沿用原本左右切換的安全流程。

# 本次變更摘要：更換直達最高按鈕圖示

- 「直達最高」按鈕改用 `⏭` 跳至末端圖示。
- 保留滑鼠提示與 `aria-label`，按鈕功能不變。

# 本次變更摘要：限制輸送帶並壓縮存檔

- 輸送帶固定上限為 20,000 件；達到上限後新掉落直接丟棄，不再自動分解或突破容量。
- 讀取舊存檔時保留輸送帶前 20,000 件，超出的尾端積壓直接移除。
- IndexedDB 與本地資料夾存檔使用瀏覽器原生 gzip；讀檔仍相容舊版純 JSON。
- 壓縮寫入採最新快照優先，避免壓縮耗時時排隊寫入大量過期快照。

# 本次變更摘要：重新整理 Loading 覆蓋層

- 頁面初始載入與重新整理前顯示全黑 Loading 覆蓋層，避免讀檔和 UI 建立期間露出半完成畫面。
- `Loading.`、`Loading..`、`Loading...` 每 350 毫秒循環一次。
- 遊戲初始化完成後自動隱藏；版本刷新、瀏覽器刷新與 F5 都會套用。

# 本次變更摘要：戰鬥暫停控制

- 戰鬥界面上方新增「暫停戰鬥」按鈕，可切換為「繼續戰鬥」。
- 暫停時凍結野外與高塔戰鬥及其倒數，不停止工廠、鑄造與存檔計時。
- 暫停狀態不寫入存檔，並同步按鈕的 `aria-pressed` 狀態。
# 本次變更摘要：天賦與潛力系統

- 完成 1 轉後開放天賦頁，目前提供 1～5 轉、每轉 8 個天賦節點，支援升級、升滿、降級與歸零退款。
- 天賦點依轉生後升級取得；節點成本為目標等級，單轉全滿時效果加倍。
- 潛力改為新的技能分類，與既有技能共用技能點，不新增潛力點；4／5 轉天賦負責逐批解鎖 10 個潛力節點。
- 接入存檔遷移、主要屬性、元素附傷、技能分類效果、背包容量、高塔限時、掉落收益與離線收益。

# 本次變更摘要：全局減傷數值顯示格式化

- 全局減傷的實際減傷百分比 tooltip 黃字部分顯示到小數點後四位（例如 99.9999%）。
- 套用無條件捨去（Floor）計算，並限制顯示的最高數值，防止其等於 100%（顯示上限為 99.9999%）。
- 新增 `pctStrFloor4GlobalDmgRed` 格式化函數，並在 `tests/global-damage-reduction.test.cjs` 中加入對應的單元測試。

# 本次變更摘要：降低普通敵人傷害詞條

- 「對普通敵人傷害%」詞條的 `base` 與 `lv` 成長值各降低為原值的 1/10：`3 → 0.3`、`0.35 → 0.035`。
- 僅調整普通敵人詞條數值；菁英、BOSS 詞條與敵種傷害計算公式不變。
- 已同步 `js/data.js`、`config/CSV/game_parameters.csv` 與 `game_formula.md`，並更新對應測試。

# 本次變更摘要：既有普通敵人傷害詞條一次性遷移與屬性側欄排版

- 新增 `normalDmgAffixScaleV1` 一次性存檔遷移，將既有裝備及各暫存容器中的 `normalDmg` 固定值縮放為 1/10，避免舊裝備仍顯示原數值。
- 屬性側欄佈局佔用寬度恢復為原本 236px，中央功能面板尺寸不受影響；屬性列改用可收縮欄位並隱藏橫向溢出，避免長數值產生底部橫向拉條。
# 本次變更摘要：天賦系統 1 轉解鎖與潛力天賦暫停

- 天賦頁籤與天賦系統改為完成 1 轉後才顯示／可進入。
- 4 轉「潛力啟示」與 5 轉「潛力覺醒」目前置灰並禁止升級；原本兩個潛力技能的暫停狀態保留。
- 完成第 1 次轉生的成功彈窗新增黃色提示：「已解鎖天賦系統！」。
## 2026-07-18 一次性外部金幣回收

- `js/player.js`：新帳號預先寫入 `externalGoldRecoveryV1: true`，排除新帳號。
- `js/save.js`：既有存檔首次刷新／讀取時，僅對 `gold > 10^16` 套用 `Math.sqrt(gold) * 10000`；其餘金額維持原值但仍寫入旗標，避免重複處理。
- `tests/external-gold-migration.test.cjs`：覆蓋首次回收、冪等性與新帳號排除。
- `ONE_TIME_MIGRATIONS.md`、`game_formula.md`、`PLAN.md`：同步記錄遷移規格與清理條件。
