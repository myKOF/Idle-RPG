# AI_TASKS.md

## Codex｜血瓶護盾藍色辨識度（SHIELD-ORB-TINT-20260923）

- Owner：Codex；Done。使用者回報血瓶護盾偏粉紫；加深後又失去透明感。依參考圖保留紅色底層與半透明藍色；護盾仍以液面高度隨消耗縮短，撤回徑向整圈淡化方案。經驗條兩端距圓瓶約 3px，金屬質感與五等分淡刻線；血瓶 tooltip 生命、護盾分兩列。修改 CSS、UI、主頁快取、測試與本紀錄；未改血量／護盾數值與存檔。衝突預檢通過；瀏覽器實戰確認護盾 368/369 → 345/369 時液面 99.7% → 93.5%、提示分行、經驗條貼合、Console 無錯誤／警告。49 項相關測試、400 檔 build、diff check 通過。Commit 見本紀錄所在提交；可供使用者合併，未合併／推送。

## Codex｜戰鬥圓瓶資源列（BATTLE-ORBS-20260923）

- Owner Codex；Done。使用者要求左紅血瓶＋淡藍護盾覆蓋、右藍法力瓶、即時懸停資訊、六格技能上方經驗條與上移 buff。
- 依賴已完成：使用者已修改技能格參數上限為六。允許戰鬥 renderer、UI、HTML/CSS、必要快取與回歸測試、本紀錄；禁止變更戰鬥公式、技能數值、其他副本與素材。衝突預檢通過。
- 驗收：空／滿／部分血魔、超生命上限護盾、懸停數值即時更新、六格／窄版排版、經驗與 buff 不遮擋、相關測試、build、瀏覽器 Console。完成後由使用者整合，不合併／推送。
- 68 項相關測試通過，400 檔 build 通過；554 個配置參數一致，無待套用／錨點問題。桌面／窄版瀏覽器實戰檢查液面與 tooltip 即時更新，技能／經驗／buff 無重疊。一般測試伺服器曾暫時漏載腳本，改用較高連線佇列容量重測後正常、無新增 Console 錯誤／警告。
- 使用者要求舊存檔另行處理，沒有新增遷移；原第 7～10 格可能仍生效但不顯示於戰鬥列。一併保留使用者既有六格配置並更新快取；無素材變更。Commit 見本紀錄所在提交，可供使用者合併。完整清單與限制見 `docs/skill-tests/20260923-battle-orbs.md`。



## Codex｜火狩與受擊特效深度遮擋（VFX-DEPTH-20260923）

- Owner：Codex；Done。依使用者畫面修正火狩繞到角色後方仍蓋住角色、受擊效果（尤其普攻）不依前後位置遮擋。
- 飛行特效保留螢幕等比透視投影，按腳點切換角色前後；地面 Preset 特效與角色共用實體深度排序，目標受擊效果以目標腳點排序。舊畫法的受擊環與粒子也按受擊原點分組排序；不改傷害、軌跡、素材。
- 162 項相關測試通過、build 399 檔通過、diff check 通過。localhost 遊戲重新載入後沒有主控台警告或錯誤；該瀏覽器存檔未裝備火狩，待使用者實戰確認遮擋觀感。素材庫未改；詳細交接見 `docs/skill-tests/20260923-vfx-depth.md`。Commit 見本紀錄所在提交；未合併／推送。

## Claude｜融火之心漩渦依參考 GIF 重做（DEVOUR-VORTEX-20260922）

- Owner：Claude；Done。使用者需求：參考附上的火焰漩渦 GIF 改良融火之心（火龍捲超神 dragonDevour）的持續場域特效，還原度 90% 以上；不准用序列幀，只能畫 1～2 張 1024² 的圖做旋轉或扭曲，搭配現有 VFX 素材。先給動態預覽，使用者審閱核准後才寫入。
- 範圍：只改 `field-dragon-devour`（漩渦本體）；飛行小火球 `proj-dragon-devour`、落地爆炸 `burst-dragon-devour` 參考圖裡沒有，未動。技能數值、事件與判定都沒動。
- 修改：
  - 素材（素材庫 939a496）：`claude-authored/dragon-devour/vortex-ring.png`（火環、火絲、螺旋火臂）、`vortex-smoke.png`（煙暈、內部螺旋紅煙、中心紅光），由同目錄的 `generate-vortex.cjs` 程序化產生（seed 7 可逐位元重現），設計與量測寫在 SOURCE.md；PROVENANCE 登記新套件 `claude-authored`。
  - Preset（58756f38）：8 層 sprite、0 粒子。火環／煙渦各兩份同圖錯速旋轉＋交叉淡化；兩份煙渦縮小＋加速旋轉做向內吸；`shape_a` 壓暗地面、`circle_05` 當中心火星。轉速一律為負（逆時針，對應貼圖火臂捲向），且取 2π/8 的整數倍，8 秒循環接得起來。asset-index 只插入這兩筆（素材庫有別人未整理的變動，未整份重掃）；舊 `codex-authored/dragon-devour/vortex.png` 不再被引用，由匯出流程移出出貨目錄，素材庫保留。作者腳本 `author/dragon-devour.cjs` 同步改成新版，三份 preset 輸出與 repo 逐字相同。
  - 快取（本紀錄所在提交）：`DATA_VERSION` → `20260922-devour-vortex`、`vfx-runtime.js?v=1.0.122`。等 Codex 合併完才改，避免撞到它同時在改的同兩行。
- 決策：參考 GIF 傳到 Claude 這邊只有單張靜態畫格，動態（逆時針、火環 4 秒一圈、向內吸）是推測的，已向使用者說明。火環落在傷害半徑的 0.83 倍，煙暈淡淡延伸到約 1.27 倍，照參考圖比例。貼圖沒有 mipmap，縮到約 0.4 倍又被地面投影壓扁，產生器在最後做了 1.2～1.6px 模糊，避免細紋理旋轉時閃爍。使用者先前在 Editor 加的 circle_02 光圈、環上火花、兩個黑色圓盤由新圖層取代（壓暗中心保留成一層 shape_a）。
- 驗證：與參考圖的半徑亮度剖面，整段動畫平均誤差約 6%；火環峰值亮度 186（參考 187）、環寬 33px（參考 30.5）。Pixi（VFX Editor）實際渲染與離線預覽一致，console 0 錯誤；每幀 GPU 增加約 0.5ms（放大兩倍約 0.6～0.7ms），Core 更新 0.013ms。`DEVOUR 正式素材跨8秒循環不跳轉` 原本釘死 vortex.png 與 π/4 轉速，改為逐層從 preset 現讀（兩種突變都會轉紅）。受影響的 38 支測試 904 項中 22 項失敗，以 HEAD 版本比對失敗名稱，沒有新增失敗；build 399 檔、export-assets --check、diff check 通過。
- 待確認：遊戲內實戰觀感（斜俯視、重新施放取代、8 秒到期收尾、範圍增幅縮放、與小火球／爆炸同時出現的畫面密度）。

## Codex｜飛行特效透視保形（AIR-VFX-20260922）

- Done。飛行物移出整張場景 PerspectiveMesh，只投影位置並等比縮放；涵蓋 35 份 proj 素材、飛行斬擊／環繞彈體／尾粒子、持續場域維護的雷球與追蹤冰箭／風刃，以及 legacy 子彈路徑。地面仍維持原透視。
- 修改 battle-renderer、VFX Runtime／Pixi backend、快取與測試文件。預檢無衝突；使用者正在調整的技能表、skills2、hit-fire／星環 preset/layout 保留未提交，未修改素材庫。
- 22 項專項／透視／後端／投影測試與18項 Runtime 回歸通過；瀏覽器以實際 Pixi、目前星環素材做遠近九宮格比較，四角不再歪斜；build／diff check 通過。未完整戰鬥場景與 GPU 效能壓測；可合併，未合併／推送。Commit 見本紀錄所在提交，詳見 docs/skill-tests/20260922-air-vfx.md。


## Codex｜火神星環旋轉編隊（FIREGOD-FORMATION-20260922）

- Done。依附圖改為同波同時起飛、等距成環並順時針公轉。使用者最終數值：半徑 8 米、每秒 1.5 圈、中心每秒前進 12 米；中心射程 40 米。數量仍讀等級表（Lv.10 六枚），傷害與素材不變。
- 修改 Skills2 Excel／CSV／JS、幾何欄位、util 純軌跡函式、模擬弧線掃掠、Runtime、Worker v37／快取、測試與文件。預檢無衝突；表格第111列可調半徑、速度，JSON rps 可調旋轉。已先展示實際 Runtime 動圖。
- 專項／配置／Worker 28/28、Runtime 選定回歸 12/12、build 398 檔及 config_tables apply 語意差異 0、diff check 通過。未完整瀏覽器實戰；素材未變，不需素材庫提交。無未完成實作，可合併但未合併／推送；Commit 見本紀錄所在提交，完整交接見 docs/skill-tests/20260922-firegod-vfx.md。


## Codex｜火神降臨星環白光（FIREGOD-VFX-20260922）

- Done。前次 ca4fbe6c 只移除誤繼承爆炸，仍可用純星環重現白塊。本次修正漏填尺寸導致半徑 6 米放大及加法疊白；星環事件沿用實際碰撞半寬 8 世界單位，透明暖色 normal 混色，編輯器名目半徑 11 單位。
- 修改星環 preset／製作來源、skills2 尺寸事件、快取、渲染及命中測試與文件。預檢無衝突；保留傷害、數量、射程、速度和既有命中判定。素材庫保存 preset，Commit 49432e4；遊戲 Commit 見本紀錄所在提交。
- 實際 Runtime/Core／出貨貼圖以每秒 10 波 × 每波 6 枚壓測，1 秒時保留 50 枚，白色像素 0、圓環可見；已展示 4 秒動圖，未完整瀏覽器實戰。10/10 測試、build 398 檔、素材匯出檢查與 diff check 通過。無未完成實作，可合併，未合併／推送；完整交接見 docs/skill-tests/20260922-firegod-vfx.md。

## Codex｜火球等速預判追蹤（TEMPEST-INTERCEPT-20260922）

- Owner Codex；Done。修正移動敵人使火球剎車：以共用純函式依敵人位移預判攔截，火球每拍按速度推進，實際接觸才結算；同步模擬與 Runtime，不沿出生飛行秒數強迫到達。修改 util、skills2、Runtime、測試、快取與本紀錄；預檢無衝突。此項取代 TEMPEST-HOMING 的固定秒數飛行。
- 同一個世界座標純函式解相對運動攔截，每顆只讀既定目標，沒有逐幀掃怪或重選目標。Runtime 還原地面Y比例後計算再投影，跳過舊曲線／朝向計算；其他子彈不配置新追蹤狀態。沒有額外Timer、貼圖或粒子。無座標高塔保留原延後命中相容流程。
- `node --test tests/inferno-tempest.test.cjs tests/dragon-devour.test.cjs tests/vfx-runtime-screen-space.test.cjs tests/vfx-runtime.test.cjs`：125項，123通過、2項既有 CATALOG-3／STARFALL-TAIL 失敗，HEAD基準確認；新相關22/22。涵蓋迎面提前命中、横移等速、停步、移遠不隔空命中、投影後Runtime速度。`node tools/build_check.cjs` 396檔、diff check 通過。
- 效能微基準：300顆×60Hz×60秒×5輪，共用攔截數學每幀中位0.0202ms、最慢0.0214ms（Node／固定代表性輸入，不含GPU、整體場景與不同硬體差異，不視為實戰FPS保證）。唯讀檢查 battlefield 逼近與 battle-renderer 預判／座標取樣；未改素材或素材庫，未瀏覽器實戰。無未完成實作，可供使用者合併；建議整合後實戰觀察，Commit 見本紀錄所在提交，未合併／推送。

## Codex｜烈焰暴風射程36米（TEMPEST-RANGE-20260922）

- Owner Codex；Done。使用者指定火球射程36米，調整烈焰暴風 searchM 24→36；修改 Skills2 Excel／CSV／JS、快取、邊界測試與本紀錄。預檢無衝突，保留36米／秒速度、0.33秒單發與6米爆炸。
- 驗證 `node --test tests/inferno-tempest.test.cjs tests/skills2-vfx-schema.test.cjs` 13/13，包含36米可選／超界不可選；`node tools/build_check.cjs` 396檔、config_tables --apply Skills2 語意差異0、diff check 通過。唯讀檢查既有搜敵與表格綁定，未改素材／素材庫，未瀏覽器實戰。無未完成實作，可供使用者合併；Commit 見本紀錄所在提交，未合併／推送。

## Codex｜烈焰暴風追蹤必中（TEMPEST-HOMING-20260922）

- Owner Codex；Done。使用者指定火球追蹤必中與速度 +50%；烈焰暴風速度 24→36 米／秒，保留 0.33 秒隨機單發／6 米爆炸。修改 Skills2 表與程式、Runtime 追蹤起點、測試／快取與本紀錄，預檢無衝突。
- 沿既有追蹤飛行以初始距離／速度決定抵達時間，畫面逐幀追向目標；爆炸在抵達當下目標位置查詢傷害圈。主目標略過命中／閃避擲骰，防禦、抗性與無敵仍有效；範圍內其他敵人仍正常判定。目標死亡沿現有生命判斷不對屍體造成傷害，不另選新目標。
- `node --test tests/inferno-tempest.test.cjs tests/dragon-devour.test.cjs tests/skills2-vfx-schema.test.cjs` 22/22；涵蓋移動目標／爆炸位置、速度倍率、實際 Runtime 追蹤座標與必中設定。`node tools/build_check.cjs` 396 檔、config_tables --apply Skills2 語意差異 0、diff check 通過。唯讀檢查 formula 命中判定與既有飛行插值；无素材修改／素材庫提交。
- 未瀏覽器實戰驗證；無未完成實作，可合併，建議整合後確認追蹤觀感。Commit 見本紀錄所在提交，未合併／推送。

## Codex｜統一新版火球（FIREBALL-VISUAL-20260922）

- Owner Codex；Done。使用者指定所有火球改用融火之心 proj-dragon-devour；範圍含火球術、分裂火球、火鳳伴生火球、烈焰暴風與敵方火屬性投射物。修改配置 Excel／CSV／JS、data 普攻對照、Runtime 尾焰收尾、快取與來源登記／測試。預檢無衝突；保留軌跡／傷害／爆炸與火狩星環，無素材編輯及素材庫提交。
- 後續指示取代前項 TEMPEST-FIREBALL 舊節拍：每道火龍捲每 0.33 秒發射 1 顆，每顆從自身 24 米內重新隨機抽選敵人，不優先近敵、不保留上次鎖敵；允許連續抽中同一敵人。Excel 第 99 列 gap=0.33、count=1，描述與特效說明同步。
- 驗證：`node --test tests/inferno-tempest.test.cjs tests/dragon-devour.test.cjs tests/skills2-vfx-schema.test.cjs tests/vfx-preset-usage.test.cjs` 44/44；包含隨機樣本、0.33秒間隔、平射中點、命中爆炸、Excel/CSV一致與來源登记。`node tools/build_check.cjs`、`node tools/config_tables.cjs --apply Skills2`、`git diff --check`。唯讀盤點所有 CSV／JS 火球引用、既有新火球素材與尾焰；未瀏覽器實戰驗證。無未完成實作，可供使用者合併；Commit 見本紀錄所在提交，未合併或推送，建議整合後確認連發觀感。

## Codex｜烈焰暴風平射火球（TEMPEST-FIREBALL-20260922）

- Owner Codex；Done。使用者指定取代數量倍率：每道火龍捲每秒向 24 米內最多 3 名敵人平射火球，命中爆炸半徑 6 米，基礎 200% 火焰傷害，每級 +20 百分點（沿既有升級公式，Lv.1 為 220%）。修改 Skills2 Excel／CSV／JS、幾何與特效欄位工具、專項與舊規格測試、快取及本紀錄。預檢無衝突；不更動其他超神或素材。
- 每道龍捲出生後 1 秒開始，最近的不同目標優先，少怪不補射；以表定 24 米／秒飛向發射當下目標位置，直線無拋物線，抵達時依當下敵人位置查詢爆炸圈（含體型邊緣），逃離落點可避開。重生重新計時，離開龍捲的火球可完成飛行；死亡不結算傷害，重置清空。觸發子彈／特效讀本列 proj-fireball／burst-fire，正常龍捲本體維持原外觀。
- `node --test tests/inferno-tempest.test.cjs tests/firepillar-expire-vfx.test.cjs tests/dragon-devour.test.cjs tests/skills2-vfx-schema.test.cjs tests/skill2-fire-legendary.test.cjs tests/vfx-preset-usage.test.cjs`：69 項，67 通過、2 個既有地爆天星倒數／預警失敗（HEAD 基準同樣失敗）；本次專項 5/5，涵蓋模擬／事件與實際 Runtime 半程直線座標。舊烈焰暴風數量測試依本次新需求更新。
- `node tools/build_check.cjs` 396 檔、`node tools/config_tables.cjs --apply Skills2` 語意差異 0、`git diff --check` 通過。唯讀檢查 battlefield 搜敵／體型、VFX Runtime 飛行、既有火球／爆炸素材及場域重生／清除。素材無修改，無素材庫提交。
- Excel 工具匯入時把原空白格讀成 934，匯出比對攔下；改用原始 ZIP/XML 精準改第 99 列，逐格核對其餘值與原工作簿一致。預覽工具同樣受空白格問題影響，未宣稱完成原生 Excel 視覺驗收；未做瀏覽器實戰。無未完成實作，可供使用者合併，建議整合後確認火球速度與實戰觀感；Commit 見本紀錄所在提交，未合併／推送。

## Codex｜永劫火獄火池分離（ETERNAL-POOL-20260921）

- Owner Codex；Done。永劫火獄 ground 改觸發 ground，火池明確事件只讀觸發角色，本體繼承正常龍捲。允許配置工具、Skills2 表／程式、專項測試、快取與本紀錄；預檢乾淨，保留使用者素材及其他配置。
- Excel AL100 清空、AQ100=ground-mire-lava、AV100 說明更新；沿先前 artifact 匯入問題使用 ZIP/XML 精準編輯，CSV／JS 同步。未改數值／傷害程式及素材，無素材庫變更。唯讀檢查 sgSpawnFirePool、sgGroundVfxSpec、vfx-runtime 地板與場域圖層。
- 驗證 node --test tests/firepillar-expire-vfx.test.cjs tests/skills2-vfx-schema.test.cjs（11/11，火池只含地板、正常龍捲保留、火池傷害／半徑／壽命）；config_tables apply 語意變更 0；build_check 387 檔與 diff check 通過。未瀏覽器實機驗證；無未完成實作，可合併，未合併／推送。使用者素材留未提交，Commit 見本紀錄所在提交。

## Codex｜烈焰衝擊特效分離（FIREPILLAR-EXPIRE-20260921）

- Owner Codex；Done。使用者授權修正常態黃圈與消失時巨型龍捲。第五階爆炸移至觸發 attack／hit，正常場域只繼承本體；允許配置工具、Skills2 表與程式、專項測試、快取與本紀錄。預檢乾淨，保留使用者其他數值與素材修改。
- Excel AI96 清空、AN96／AP96 分別為 burst-fire-shockwave／hit-fire，更新 AV96；沿既有 artifact 匯入問題使用 ZIP/XML 精準編輯，CSV／JS 同步當前活頁簿（包含使用者已調整火鳳／烈焰暴風值）。既有 sgGroundExpire 的第五階事件透過角色登記只讀觸發欄，不再帶 field；普通 tick 不繼承 trigger。未修改傷害流程。
- 驗證 node --test tests/firepillar-expire-vfx.test.cjs tests/skills2-vfx-schema.test.cjs（10/10，含三超神、平時與消失事件、爆炸範圍和傷害）；config_tables --apply Skills2 語意變更 0；build_check 387 檔及 diff check 通過。唯讀檢查 skills2 場域流程與 vfx-runtime 角色派送；未瀏覽器實機驗證。無新增／修改素材、無素材庫變更；使用者素材留未提交。無未完成實作，可合併，未合併或推送，Commit 見本紀錄所在提交。

## Codex｜火鳳遼原主殞石特效（PHOENIX-METEOR-20260921）

- Owner Codex；Done。修正伴生火球的超神外觀覆蓋主殞石；主殞石起飛與落地讀第七階本體，伴生火球保留超神配置。允許 skills2、時序測試、快取與本紀錄；預檢乾淨，不修改使用者素材或數值表。
- 驗證：node --test tests/meteor-impact-timing.test.cjs tests/starfall-vfx.test.cjs（7/7）；node tools/build_check.cjs（386 檔通過）；git diff --check 通過。驗證四顆主殞石、每顆六個伴生火球、各自彈體／落地受擊及傷害時序；唯讀檢查特效選取與配置。無素材庫變更，使用者正在編輯素材保留未提交；未瀏覽器實機驗證。無未完成實作，可合併，未合併或推送；Commit 見本紀錄所在提交。

## Codex｜地爆天星爆炸與受擊分離（STARFALL-ROLES-20260921）

- Done。使用者指定大型 burst-fire-shockwave 改觸發 attack，小型本體 hit 改 burst-fire；維持預警與子彈讀本體，不受觸發欄干擾。允許 skills2、角色工具、表、測試、快取與本紀錄；預檢乾淨，保留使用者既有修改。
- Excel AI90 清空、AK90=burst-fire、AN90=burst-fire-shockwave、AV90 更新作用說明，CSV／JS 同步當前活頁簿；沿已確認的 artifact 匯入問題用 ZIP/XML 精準編輯。巨型落地觸發與各敵人受擊事件使用不同角色來源，不強制共用持續時間。
- 驗證 starfall-vfx／skills2-vfx-schema 11/11；config_tables apply 語意變更 0；build_check 386 檔、diff check 通過。唯讀檢查既有素材／狀態與配置讀取。沒有修改素材，使用者素材留未提交；未瀏覽器實機驗證。無未完成實作，可合併，未合併／推送，Commit 見本紀錄所在提交。

## Codex｜地爆天星火星拖尾（STARFALL-TAIL-20260921）

- Done。將大片橫向火焰改為短命細碎火星，粒子朝速度方向排列，從殞石後方逸出；保留使用者本體亮度。僅素材、專項測試、本紀錄；預檢乾淨，不修改使用者其他配置／素材。
- 尾焰改用已出貨 light_03，後方 -45 世界單位發射；0.45～0.85 秒壽命、窄角度、細長小粒子、alignToVelocity。既有 worldSpace 保留運動軌跡。未改傷害／飛行速度／數量。
- 測試：vfx-runtime 以 STARFALL-TAIL 篩選 1/1（真正下墜事件的粒子旋轉長軸近垂直、位於後方）；starfall-vfx 4/4；preset-render 已渲染並展示、export-assets --check 最新、diff check 通過。未做瀏覽器實機驗證；無未完成實作，可合併。素材庫 codex-authored/starfall 同步並位元組驗證，素材 Commit 見本次交付；未合併／推送。其他使用者 Excel、JS 與素材修改保留未提交。

## Codex｜地爆天星跟隨角色（STARFALL-FOLLOW-20260921）

- 完成實作。預警黑圈逐幀跟隨角色，落地依當下角色座標；保留既有全場敵人傷害結算及單顆節拍。允許 skills2、測試、快取、本紀錄，預檢乾淨；不修改使用者素材與 Excel。
- 沿既有 area.follow 與渲染場域跟隨，不重播／重置黑圈擴大曲線。殞石原有 player target 追蹤保留，爆點當下重讀玩家座標。唯讀檢查 vfx-runtime，無新增參數／素材。
- 驗證 starfall-vfx 4/4、vfx-runtime 以 STARFALL-FOLLOW 篩選 1/1：移動後黑圈立即貼齊且尺寸繼續增加、只建一個特效，落地爆點及全場傷害正確。diff check 通過。未完整瀏覽器實機驗證；使用者素材及 Excel 持續編輯保留未提交，無素材庫變更。可供使用者合併，未合併／推送。

## Codex｜地爆天星預警與落地（STARFALL-FEEDBACK-20260921）

- Done。補回缺失的落地 attack 爆炸，預警明確傳遞戰場半徑；受擊逐敵播放不受八目標上限。允許 skills2、測試、快取及本紀錄，預檢乾淨；不修改使用者 Excel／素材。
- 完成：黑圈與落地爆炸以玩家為中心，半徑至少涵蓋出怪距離並擴至存活敵人；玩家實體無 pos 時使用 battlefield 玩家座標。一次 attack 爆炸與逐目標 hit 分開派送，不帶 projectile。既有黑圈 Preset 曲線負責漸大，未新增素材。
- 驗證：starfall-vfx／meteor-impact-timing 4/4；vfx-runtime 以 STARFALL-FEEDBACK 篩選 1/1，實際 NullBackend 驗證黑圈尺寸隨時間增大、保持可見與爆炸獨立派送。build_check 386 檔通過，最後座標回退修改由專項測試驗證；diff check 通過。唯讀檢查 vfx-runtime／battlefield／素材及配置。未完整瀏覽器實機驗證，無未完成實作，可合併；無素材庫變更，使用者 Excel／素材保留未提交，未合併或推送。

## Codex｜地爆天星單顆與朝向（STARFALL-VFX-20260921）

- Done。修正普通多顆殞石誤繼承巨型特效、預警誤播彈體及素材前端方向。保留普通殞石傷害及地爆天星單顆週期。允許 skills2、proj-starfall 素材、測試、快取、本紀錄；預檢乾淨。
- 普通殞石起飛與落地明確讀第七階本體；地爆天星預警只播 ground、下墜只播 projectile。素材 bow 原在 +Y 改為 +X 並交換長短軸，與朝 -X 尾焰一致；保留使用者 rim 透明度修改與 layout。未修改其他特效／Excel。
- 驗證：`node --test tests/starfall-vfx.test.cjs tests/meteor-impact-timing.test.cjs` 3/3；build_check 386 檔通過；diff check 通過。素材時間序列已渲染、檢視與展示；未做瀏覽器 GPU 實機驗證。唯讀檢查 vfx-runtime、既有地爆天星傷害與排程。素材複製至素材庫 codex-authored/starfall 並核對位元組一致，素材提交見對應紀錄；其他使用者素材及 Excel 保留未提交。無未完成實作，可供使用者合併，未合併／推送。

## Codex｜殞石爆點時序（METEOR-IMPACT-TIMING-20260921）

- Owner Codex；Done。使用者回報未落地先播受擊。第七階 attack／hit 同填爆炸，起飛事件立即派送 attack；傷害原本落地才算。允許 skills2、時序測試、快取及本紀錄；預檢乾淨，保留使用者素材及 Excel 修改。
- 完成：殞石起飛事件僅派送 cast／projectile／ground／field 並禁止自動受擊；落地佇列播放 hit，擊殺仍保留目標。未修改素材或配置、傷害及飛行秒數。唯讀檢查 vfx-runtime、Skills2 配置及共用落地佇列。
- 驗證：meteor-impact-timing 專項通過；連同 vfx-runtime 測試僅 CATALOG-3 失敗（既有 bolt-sky-purple layout 有兩個根群組，該檔與 HEAD 無差異，本次未修改）。build_check 385 檔通過；diff check 通過。未做瀏覽器實機驗證；無本次未完成實作，可合併。無素材庫變更，使用者素材與 Excel 持續編輯保留未提交，下一步由使用者整合。

## Codex｜狂怒全系列特效接線（RAGE-SERIES-VFX-20260921）

- Owner Codex；Done。使用者授權全系列觸發攻擊／受擊特效；階級空白繼承同角色、超神覆寫；保留傷害選敵。戰神屠錄錯名已由使用者改為現有 dark-09，保留其設定。允許 skills2、觸發角色工具、Skills2 表、測試、快取、本紀錄與使用者必要素材雙倉庫提交。預檢僅 index 已知不同區段，依既有合併授權繼續。
- 完成：1～7 階與三超神支援 trigger attack／hit；空白角色逐階繼承。低階單體與非狂怒的阿修羅普攻維持原尺寸，多目標仍用實際半徑。使用者清空的受擊欄保留；狀態光殼仍由 Status 表處理。Excel 只更新十列作用說明，CSV／JS 同步使用者特效設定。
- 驗證：`node --test tests/bloodfeast-vfx.test.cjs tests/skills2-vfx-schema.test.cjs` 9/9（逐階、三超神、繼承、低階／多目標半徑、阿修羅独立生效、死亡目標、表格一致）；config_tables apply 語意變更 0；build_check 384 檔通過；export-assets --check 最新。唯讀檢查 combat／vfx-runtime、素材來源解析與貼圖。未做瀏覽器實機驗證，無未完成實作，可合併。
- 素材：使用者必要的五份 Preset 與 layout 保存至素材庫 codex-authored/bloodrage，逐檔位元組一致；新貼圖本來就在素材庫，正式 shipped 索引與匯出檢查通過。素材庫 Commit 30f5af3；遊戲 Commit 見本紀錄所在提交。未合併／推送，下一步使用者整合。

## Codex｜阿修羅霸王拳延長（ASURA-DURATION-20260921）

- Owner Codex；Done。依使用者最新指定：持續 1.5 秒＋等級×0.15 秒，生效期間每殺一敵延長 0.2 秒。允許 skills2、Skills2 表、測試、快取、本紀錄；index.html 既知不同快取行依正常合併授權繼續，其餘預檢乾淨。保留使用者爆炸素材。
- 完成：擊殺延時不依賴狂怒是否生效，僅延長仍有效的霸王拳狀態；跨週期重發動保留既有更長的剩餘時間。狀態持續特效與圖示共用更新後到期時間。Excel AU81／AW81／AX81、CSV／JS 同步；沿已確認 artifact 匯入問題使用 ZIP/XML 精準修改。
- 驗證：`node --test tests/asura-duration.test.cjs` 3/3，`node --test tests/skills2-vfx-schema.test.cjs` 6/6；超神進化測試以「嗜血狂怒的三個超神進化」篩選 1/1；build_check 384 檔通過，最後數值修改由 config_tables 語法檢查及上述測試驗證，apply 語意變更 0。唯讀檢查既有狀態及擊殺管線。無新增素材，無素材庫提交；未實機瀏覽器驗證。
- 無未完成實作，可供使用者合併；Commit 見本紀錄所在提交。保留使用者 burst-detonate-phys Preset／layout 未提交修改，未合併或推送。

## Codex｜戰神屠錄數值與吸血（WAR-GOD-ROLL-20260921）

- Owner Codex；Done。基礎擊殺增傷 2%、每級 +0.2%，固定最多 200 層；新增吸血效果基礎提升 100%、每級 +10%，乘算並持續到死亡。使用者確認 40% × (1+200%) =120%。允許 skills2、Skills2 表、測試、快取、本紀錄；保留使用者正在修改的爆炸素材。
- 預檢 index.html 僅既知 Claude 字體快取不同區段，沿既有正常合併授權；其他乾淨。驗證擊殺上限、升級、狂怒結束／死亡、吸血實值與面板及吸魔不變。
- 完成：施放狂怒建立持續吸血倍率，擊殺不累乘吸血，重施不倍增；透過既有 skill2DrainFactor 同步吸血計算與面板。沿既有 resetSkill2RT 死亡／戰鬥重置回收。Excel AU80／AW80／AX80 精準更新，CSV／JS 同步；沿本對話已確認 artifact 匯入錯讀，使用 ZIP/XML 保留其他元件。
- 測試：`node --test tests/war-god-roll.test.cjs tests/skill2-counter-bloodrage.test.cjs tests/skills2-vfx-schema.test.cjs` 34/34；`node --test --test-name-pattern="嗜血狂怒的三個超神進化" tests/skill2-ult-evolution.test.cjs` 1/1；build_check 383 檔通過，Excel／CSV 一致、config_tables 語意變更 0。唯讀檢查 formula.js、combat.js、status.js，沿既有技能列覆寫狀態層數及效果值。
- 無未完成實作，可合併。無新增素材；使用者的 burst-detonate-phys Preset／layout 修改留在工作區，不納入本次技能數值提交。未合併或推送，下一步由使用者整合；Commit 見本紀錄所在提交。

## Codex｜狂血盛宴範圍特效（BLOODFEAST-VFX-20260921）

- Owner Codex；Done。使用者指定普攻範圍爆炸及逐目標小型受擊；保留傷害與選敵。允許 combat／skills2、Skills2 Excel／CSV、觸發角色工具、測試、快取及本紀錄。預檢只有 index.html 他分支不同版本行，依使用者既有正常合併授權繼續。
- 驗收：一次範圍爆炸、實際命中才播放小型受擊、死亡目標保留、停用後恢復普攻、範圍及時序符合計算；預覽後交付。
- 完成：狂血盛宴觸發特效 burst-detonate-phys、命中特效 hit-bleed，Excel AN78／AP78／AV78 與 CSV／JS 同步。沿本對話已確認 artifact 匯入空白誤讀問題，以 ZIP/XML 精準修改三格，其他元件保留。追加目標移除原本 130ms 逐個視覺延遲，對齊原有同拍傷害；主目標連擊仍沿原本節奏。
- 測試：`node --test tests/bloodfeast-vfx.test.cjs tests/skill2-counter-bloodrage.test.cjs tests/skills2-vfx-schema.test.cjs` 34/34；`node tools/config_tables.cjs --apply Skills2` 語意變更 0；`node tools/build_check.cjs` 382 檔通過；diff check 通過。涵蓋超過八目標、閃避、擊殺、技能失效及表格一致。
- 唯讀檢查 vfx-runtime.js、既有 Preset、原多目標選敵；兩份素材時間序列已渲染並展示，沒有新增／修改素材，因此無素材庫提交。限制：未做瀏覽器 GPU 實機驗證。無未完成實作，可供使用者合併；未合併或推送，Commit 見本紀錄所在提交。

## Codex｜防禦技能提早施放（DEFENSE-PRECAST-20260921）

- Owner Codex；Done。使用者要求岩甲術等防禦技能在敵人出現時起手，不等敵方首擊。允許 skills／skills2／combat、專項測試與快取、本紀錄；禁止修改傷害數值、冷卻、耗魔及素材。衝突預檢通過，無前置依賴。
- 驗收：岩甲／暴風屏障與舊護盾技能在遠處敵人生成時起手、先於敵方首擊、攻擊技能仍受射程限制、MP／冷卻／死亡／復甦／施法鎖正常；完成後提交供使用者合併。
- 完成：敵方首擊前新增防禦優先選技；自身防禦不受敵方距離阻擋，附帶攻擊仍排除進場敵人。保留耗魔、冷卻、施法時間及行動限制；更新主頁與 Worker 快取。
- 測試：`node --test tests/defensive-precast.test.cjs tests/skills2-mana-cost.test.cjs tests/skill-mana-cost.test.cjs tests/indomitable-revival.test.cjs tests/enemy-projectile-retaliation.test.cjs`，14/14 通過；`node tools/build_check.cjs`。唯讀檢查 scripts/sim/engine.js、上述既有測試。限制：已在施法中或冷卻未到不會強行插入防禦，保留吟唱時間；未做瀏覽器人工驗證。無未完成實作，可供合併。

## Codex｜不屈鬥魂升空復甦（COUNTER-REVIVAL-20260921）

- Owner Codex；Done（使用者已確認特效並要求提交）。致死時保留戰場，站姿升空及天降光束，5 秒生命由 0 回滿；物攻＋魔攻為基礎，4000% 總地系傷害分 10 次（每 0.5 秒）結算。
- 允許：skills2／combat／formula／battle-renderer、Worker 協議與文件、Skills2 表、獨立光束素材、相關測試與快取、本紀錄。保留使用者 Excel 其他修改，不修改其他技能數值。衝突預檢通過，無依賴。
- 驗收：10 段總量、時序、HP 線性恢復與免死、無退關／敵群清除、冷卻、站姿升空、素材接線及建置；完成後提交，使用者合併。
- 實作：FIELD 玩家投影 _sgRevival 起迄 GT；Worker 協議 v35。復甦中攔截重複判死、傷害與外部治療，不走 reviveCd；每跳重新選取 30 米內存活敵人，最後一跳後回滿並解除保護。站姿上移 60 世界單位，保持原戰場位置與水平血條。原行動閘門保留；冷卻 60 秒，既有其他超神不變。
- 修改補充：tools/skills2-geometry.cjs／skills2-vfx.cjs 先預檢後登記 indomitable 的 gap 與觸發地板角色；tests/worker-protocol.test.cjs 同步協議。Skills2 Excel 僅更新 Z70／AQ70／AV70／AW70／AX70；保留使用者已清空 AL70 的本體地板特效，CSV／JS 同步該權威值。原工具誤讀空白，沿前輪已確認的 ZIP/XML 精準編輯方式保留其他內容。
- 驗證：node --test tests/indomitable-revival.test.cjs tests/skill2-counter-bloodrage.test.cjs tests/death-revive-restore.test.cjs tests/worker-protocol.test.cjs tests/skills2-vfx-schema.test.cjs tests/skills2-geometry.test.cjs tests/field-motion-smoothness.test.cjs（58/58）；node --test --test-name-pattern="不屈鬥魂|自動施放閘門" tests/skill2-ult-evolution.test.cjs（2/2）。包含正式 Worker 20 菁英戰鬥、零血、半程回血、10 跳總量、敵群身份保留、範圍、冷卻、重置、暫停升空位置與素材接線。Excel／CSV 逐格一致；config_tables apply 語意變更 0；build 380 檔通過，diff check 通過。
- 素材 pillar-indomitable.json：獨立 5 秒天降光束，沿用已出貨貼圖，渲染預覽已檢視，export-assets --check 通過。素材庫 Commit 922eb09，檔案 SHA256 一致；沒有額外素材匯出更新。
- 唯讀檢查：tower.js、既有復活／特效 Runtime 與素材解析、Worker 面板序列化。限制：本次沿既有不屈鬥魂野外入口，高塔原先未接該超神、不在本次範圍；未完整瀏覽器 GPU 實機驗證，渲染運動以原碼執行測試及光束離線預覽驗證。使用者已確認特效並授權提交；無未完成項目，可合併。遊戲 Commit 見本紀錄所在提交，素材 Commit 922eb09；未合併或推送，下一步由使用者整合。

## Codex｜不屈鬥魂反擊地屬性（COUNTER-EARTH-20260921）

- Owner Codex；Done。使用者要求保留不屈鬥魂原有效果，將反擊系列傷害轉為地屬性，包含本體、招架、二次反擊、狂化反殺與傳奇衍生段；死亡爆發原有地屬性保留。
- 允許：skills2.js、Skills2 Excel／CSV、反擊測試、index.html／bridge.js／Worker 快取、本紀錄。禁止修改其他技能數值及使用者素材。無前置依賴，衝突預檢通過。
- 驗收：地屬性增傷／抗性、全部追加反擊、其他超神與失效條件、原死亡爆發／復活回歸、配置同步與 build；完成後提交供使用者合併。
- 實作：反擊共用斬擊及群組衍生傷害入口使用既有 skillElem 轉換；保留攻擊基礎、倍率、耗魔、死亡爆發與復活。Excel／CSV／JS 同步說明，主頁與 Worker 更新快取。Artifact 讀取 Excel 將空白誤判為 948，改以 ZIP/XML 精準替換說明並逐元件驗證其餘內容完全不變。
- 測試：node --test tests/skill2-counter-bloodrage.test.cjs（26/26）；node --test --test-name-pattern="不屈鬥魂" tests/skill2-ult-evolution.test.cjs（1/1）；node tools/config_tables.cjs --apply Skills2（語意變更 0）；node tools/build_check.cjs（379 檔通過）；git diff --check 通過。
- 唯讀檢查：formula.js、combat.js、既有超神測試與配置工具。未修改素材，無素材庫提交；使用者另編輯的配置與素材留在工作區。本次提交僅包含任務變更。未實機畫面驗證，無未完成實作；可合併，未合併或推送。Commit 見本紀錄所在提交；下一步由使用者整合。

## Codex｜提交使用者雙刀配置與素材（USER-SNAPSHOT-20260921）

- Done。使用者要求先提交現有修改供合併，再繼續戰神體；戰神體尚未修改，等待使用者合併與返還公式確認。
- 提交 Skills2 Excel／CSV／JS 現有配置、slash-dual 與三種超神 Preset／layout，含火之神樂使用者調整值。Status.csv 僅換行差異，git add 後無內容變更。沒有新增臨時產物，沒有修改其他副本的 index.html。
- 素材庫 Commit 686ad91，8 份素材存於 codex-authored/dualdance，複製後逐檔雜湊一致；素材庫乾淨。node tools/vfx/export-assets.cjs --check 通過，匯出索引與貼圖無須變更。
- node tools/config_tables.cjs --apply Skills2：語意變更 0；雙刀針對性測試（skill2-ult-evolution／skill2-asura-dualwield，沿前次名稱篩選）13/13 通過；diff check 通過。唯讀檢查素材來源解析器、匯出工具、配置差異與既有引用。
- 已知限制：配置原已引用不存在的 proj-cleave-ring-tricolor-09，本次按使用者要求保存現況，未擅改引用；上一輪 build 379 檔通過，本次無新增程式邏輯，未實機驗證。交使用者合併，建議整合時處理缺失引用及統一快取版本；未合併或推送。遊戲 Commit 見本紀錄所在提交。

## Codex｜神聖之體獨立光彈與爆炸（COUNTER-HOLY-FLIGHT-20260921）

- Owner Codex；Done。使用者要求黃光改為獨立觸發特效，滿計數時發射一顆觸發光彈，抵達後爆炸一次。反擊計數方式、門檻及傷害數值不調整。
- 範圍：skills2.js、vfx-runtime.js、Skills2.xlsx／CSV、tools/skills2-vfx.cjs、對應技能／Runtime 測試、index.html／bridge.js 快取、本紀錄。既有觸發子彈欄可沿用，無新協議欄位；衝突預檢通過。
- 驗收：未滿門檻無神聖黃光、每滿門檻一顆光彈／一次爆炸、抵達時才結算範圍傷害、飛行與爆炸幾何同步、空觸發欄不繼承本體、死亡與高塔退化、既有計數與傷害數值不變。保留使用者配置及素材編輯。
- 實作：神聖之體改為獨立 triggerVfx（觸發子彈 proj-light-orb、觸發特效 burst-holy），移除本體 attack／hit 黃光。沿既有飛彈佇列飛往發射時的目標位置，抵達才結算並播放一次爆炸；保留原邊緣距離判定，光彈採素材製作尺寸。快取同步，無新素材或 Worker 協議欄位。
- 配置：Excel 僅改 AI69、AK69、AN69、AO69、AV69，原生 Excel 重開驗證內容與物件數；Artifact 匯出相容性問題沿用前次原生儲存方式，未覆蓋其他欄。Excel→CSV→JS apply 零語意差異。提交資料由 HEAD 加本次修改製作，使用者其餘配置與素材保留在工作區。
- 測試：node --test --test-name-pattern="神聖|HOLY-FLIGHT" tests/skill2-ult-evolution.test.cjs tests/vfx-runtime.test.cjs：5/5；提交資料以 staged-read.cjs 預載重跑並加入 CATALOG-1：6/6。node --test tests/skill2-counter-bloodrage.test.cjs tests/skill-vfx-inheritance.test.cjs tests/skills2-vfx-schema.test.cjs tests/waterball-vfx-integration.test.cjs tests/vfx-runtime.test.cjs：137/139，兩項失敗為工作區既有缺少 proj-cleave-ring-tricolor-09（提交資料 CATALOG-1 通過）及前次已確認的 bolt-sky-purple layout 頂層列數。node tools/build_check.cjs：379 檔通過；diff check 通過。
- 唯讀檢查：battlefield.js、既有飛彈／觸發欄解析、config_tables.cjs、proj-light-orb／burst-holy 素材與其他反擊測試。未實機畫面與 Console 驗證；飛行期間敵人移動可能離開落點，符合抵達後結算。無未完成實作，可合併；未合併或推送。Commit 見本紀錄所在提交，下一步由使用者整合並調整平衡數值。

## Codex｜雙刀亂舞隨機選敵與毀滅之舞追加（DUALDANCE-TARGETS-20260921）

- Owner Codex；Done。使用者授權全系列每刀從當前範圍內隨機選敵、允許重複；只有毀滅之舞追加 3 次攻擊，其餘階段／超神數量不變。
- 範圍：skills2.js、Skills2.xlsx／CSV、相關技能測試、index.html／bridge.js 快取、本紀錄。衝突預檢通過，無前置依賴；保留現有使用者配置／素材變更，不修改其他技能或傷害公式。
- 驗收：各階與三種超神、單目標／多目標／範圍外／死亡重新選敵、毀滅獨有 +3、傷害與 VFX 選敵／延遲一致、Excel／CSV／JS 同步。完成後提交並交使用者整合。
- 實作：每刀以 skills2CanReach 重新篩選存活目標後獨立抽取；無目標則停止。毀滅 fx.add=3，不隨等級成長，與既有疾風亂舞／雙生刃相加。保留原生命代價、增傷、神樂疊層與暴風自動施放，傷害及特效共用同一目標與浮字延遲。主頁與 Worker 快取同步。
- 配置：Excel 僅改 7 格（AU59、AW52:AX53、AW59:AX59），原生 Excel 正常重開逐值及物件數驗證；Artifact 匯出與既有讀表器／批註格式不相容，因此未用其完整匯出覆蓋來源。工作區 Excel→CSV→JS apply 後零語意差異。提交中的資料以 HEAD 加本次變更製作，使用者其他配置／特效引用與素材仍留在工作區；HEAD 既有 Excel AJ20 與 CSV 的差異未納入本次修正。
- 測試：node --test --test-name-pattern="雙刀選敵|雙生刃|狂戰士|狂舞|不屈之誓|毀滅之舞|火之神樂|修羅亂舞" tests/skill2-ult-evolution.test.cjs tests/skill2-asura-dualwield.test.cjs：13/13 通過，工作區與實際提交資料各驗一次。新增 4 案覆蓋 20 種階段／目標組合、界線、死亡／移出範圍、無座標高塔、毀滅低高等級及自動施放；替換回舊雙刀函式後 4 案均失敗。原雙刀測試夾具補足施法魔力，未放寬傷害斷言。
- 廣域回歸：node --test tests/skill2-ult-evolution.test.cjs tests/skill2-system.test.cjs tests/skill2-asura-dualwield.test.cjs tests/skills2-mana-cost.test.cjs tests/skills2-geometry.test.cjs：114 項、76 通過、38 失敗；同配置／測試替換回 HEAD 雙刀函式得到同樣 38 失敗外加上述 4 案，無新增回歸。node tools/build_check.cjs：379 檔通過；diff check 通過。
- 唯讀檢查：battlefield.js 距離／體型判定、combat.js、config_tables.cjs、其他雙刀系統／耗魔／裝備測試與素材。無素材修改或素材庫提交。風險／限制：未實機畫面與 Console 驗證；本次按需求讓多刀可集中同一敵人，範圍外不再被斬擊選中。可合併，未合併或推送；下一步由使用者整合後實機確認。

## Codex｜敵方飛彈原始尺寸（ENEMY-PROJECTILE-SIZE-20260921）

- Owner Codex；Done。使用者授權修正敵方飛彈在遊戲中被預設米制尺寸放大的問題。
- 範圍：js/vfx-runtime.js、tests/vfx-runtime.test.cjs、index.html、本紀錄。無前置依賴；衝突預檢通過。不修改素材、配置、傷害與命中邏輯；保留使用者 slash-dual preset/layout 修改。
- 未帶權威彈體尺寸的敵方遠程攻擊依製作尺寸播放；帶 lineWidth 的事件仍依判定尺寸。驗證正式暗影素材、各場景倍率、飛行時序與敵方傷害回歸。
- 驗證：node --test tests/vfx-runtime.test.cjs tests/enemy-projectile-retaliation.test.cjs，98 項中 97 通過；唯一 CATALOG-3（bolt-sky-purple 頂層兩列）以 HEAD Runtime 在記憶體執行確認同樣失敗。新增尺寸案例在舊 Runtime 會失敗，修正後通過。node tools/build_check.cjs：379 檔通過；git diff --check 通過。
- 唯讀檢查：combat.js、data.js、battlefield.js、Editor 播放、proj-dark-orb 與 asset-index。沒有素材修改／素材庫提交。未進行實機畫面與 Console 驗證；後續由使用者在整合後確認畫面。可合併本次修正；未合併或推送，使用者既有素材修改留在工作區。

## Codex｜圖層循環與旋轉速度（LAYER-SPIN-20260918）

- Owner Codex；Done。使用者要求圖層持續loop與Rotation內的可拖曳／輸入速度，取代手動整圈曲線。允許Core、Editor、Core測試、快取與本紀錄；衝突預檢通過。不修改使用者素材。sprite／procedural／empty支援圖層loop與每秒旋轉速度，既有particle速度語意保留。
- 修改：js/vfx-core.js、tools/vfx/editor/editor.js、tests/vfx-core.test.cjs、index.html、tools/vfx/editor/index.html、本紀錄及docs/vfx/VFX_CORE_AND_PRESET_SCHEMA.md（同樣預檢通過）。累積時鐘獨立於Preset循環，圖層loop保活、父層控制子層、finish仍回收；outerScale與父子矩陣均納入旋轉速度。Editor的Rotation提供滑桿及數字輸入，可多選批改、復原。
- 測試：node --test tests/vfx-core.test.cjs，140/140通過。node --test tests/vfx-core-hierarchy.test.cjs tests/vfx-editor-hierarchy.test.cjs tests/vfx-editor-history.test.cjs tests/vfx-editor-multi-edit.test.cjs，91/92通過；既有HISTORY-42因未修改的aura-rockarmor-stone.json 115.6KB推算100步45.1MB超過25MB失敗，未放寬。node tools/build_check.cjs，379檔通過。瀏覽器已驗證Rotation輸入-15、滑桿同步、復原回0、Schema合法、Console無error/warn；伺服器已重新啟動。
- 唯讀檢查：既有Editor歷史／階層／多選模型、使用者Preset；素材未修改，素材庫无需提交。Commit見本紀錄所在提交。未進行完整遊戲GPU驗證；其他曲線首尾仍須銜接。無未完成實作，可合併，未合併或推送。下一步使用者勾選圖層持續循環並在Rotation設定速度。

## Codex｜循環旋轉終點閃幀（VFX-LOOP-SEAM-20260918）

- Owner Codex；Done。使用者回報旋轉接縫跳幀。發現Core僅於時間大於週期時循環，但圖層於大於等於時隱藏；修正精確終點先循環。修改Core、Core測試、遊戲／編輯器快取與紀錄，預檢通過。使用者實際Preset未指定，另說明預覽重播與Preset loop差別。
- 驗證：`node --test tests/vfx-core.test.cjs` 138/138；`node tools/build_check.cjs` 379檔通過；diff check通過。覆蓋精確終點連續兩圈可見、旋轉相位與大dt跨界餘量。唯讀檢查editor.js的預覽重播邏輯，未修改素材或使用者Preset；素材庫無需提交。Commit見本紀錄所在提交。限制：尚未確認使用者目前旋轉圖的曲線端點與loop設定，本修正不能排除其餘接縫來源。修正可合併，未合併／推送；下一步重載編輯器並確認Preset loop與線性整圈曲線。

## Codex｜暴風光壁緩慢旋轉（STORM-WALL-ROTATE-20260918）

- Owner Codex；Done。保留使用者編輯器存檔的透明度、尺寸與位置，錐形光束沿地板橢圓24秒繞行一圈，底圈固定俯視投影。修改 `vfx/presets/ground-storm-dance.json`、`tools/vfx/authoring/author/storm-dance.cjs`、`tests/storm-dance.test.cjs` 與本紀錄；衝突預檢通過。沿用位移曲線，無Runtime或技能改動；author改為基於現有編輯器存檔更新，避免重製覆蓋手調外觀。
- 驗證：`node --test tests/storm-dance.test.cjs` 4/4；`node --test --test-name-pattern="STORM-DANCE|STATUS-" tests/vfx-runtime.test.cjs` 4/4；`node tools/build_check.cjs` 379檔通過。與修改前備份逐欄比較，僅8道光錐位移曲線和Preset週期不同。測試尺寸斷言改為使用者手調後的半徑／高度比例，保留名目20米寬與預算檢查。瀏覽器兩個時間點確認光錐位置變化、保持直立與俯視底圈，Console無error/warn。
- 檢查未修改 `js/vfx-core.js`、`tests/vfx-runtime.test.cjs`、layout。素材庫 `0d95504`，Preset逐位元一致；遊戲Commit見本紀錄所在提交。未重跑完整實機戰鬥；無未完成實作，可合併，未推送或合併。下一步使用者檢查旋轉速度。

## Codex｜暴風光壁俯視透明度（STORM-WALL-VIEW-20260918）

- Owner Codex；Done。使用者回報像仰視。將底圈與壁面拆成前後半圈，遠側更透明、近側加強；白光降亮避免底圈過曝像浮在上方。保持半徑10米／高3米與圓錐，僅改 `tools/vfx/authoring/author/storm-dance.cjs`、`vfx/presets/ground-storm-dance.json`、`vfx/layouts/ground-storm-dance.json`、`tests/storm-dance.test.cjs` 與本紀錄；衝突預檢通過。
- 驗證：`node --test tests/storm-dance.test.cjs`（3/3）、`node --test --test-name-pattern="STORM-DANCE|STATUS-" tests/vfx-runtime.test.cjs`（4/4）、`node tools/build_check.cjs`（379檔）通過。`node tools/vfx/preset-render.cjs ground-storm-dance --frames 4 --size 320` 與瀏覽器預覽確認前後亮度、尖端向上；Console 無 error/warn。
- 素材庫已同步且逐位元核對，Commit `47483b8`；遊戲提交見本紀錄所在 Commit。唯讀檢查 `tests/vfx-runtime.test.cjs` 與既有狀態接線。沒有新增特效來源或執行期 JS。已知限制：尚未重新跑完整實機戰鬥畫面；目前預覽與跟隨／回收自動測試通過。無未完成實作；可合併，未合併或推送。下一步由使用者確認遊戲中的視覺感受。

## Codex｜暴風光壁圓錐與底圈（STORM-WALL-CONES-20260918）

- Owner Codex；Done。使用者要求向上收尖的圓錐造型，地板光圈更突出。僅改storm-dance author／Preset／layout、尺寸預算測試與本紀錄，保留普攻與技能效果。衝突預檢通過；沿用既有貼圖。
- 8道寬底尖頂的綠白錐形光束，6層向上略收的光壁，新增高亮綠底圈／白色內圈；粒子隨上升縮小。半徑10米／高3米不變，32圖層、最多304顆粒子。檢查未修改Runtime、技能程式、Excel／CSV及貼圖，cone素材已出貨不需新增匯出。
- 驗證：`node --test tests/storm-dance.test.cjs` 3/3，`node --test --test-name-pattern="STORM-DANCE|STATUS-" tests/vfx-runtime.test.cjs` 4/4，`node tools/build_check.cjs` 379檔通過，diff check通過。VFX Editor實播已截圖，Console無error/warn；未進行完整遊戲GPU壓測。素材庫Commit `34bf928`，Preset/layout與遊戲逐位元核對相同。可合併，未推送；下一步使用者檢查外觀。

## Codex｜暴風亂舞普攻與綠白光圈（STORM-DANCE-20260918）

- Owner Codex；Done。使用者要求持續期間可普攻，新增隨身地板光圈：半徑10米、高3米、綠白粒子；後續要求取消祭壇式星芒，改成連續光壁。移除野外／高塔普攻閘門與化身計時器重置；保留自動施放節拍與傷害。
- 允許修改 combat.js、tower.js、skills2.js、Skills2／Status Excel與CSV、status.js生成資料、快取、獨立Preset／layout／author、相關測試及本紀錄。禁止變更傷害、持續時間、存檔與共用特效。無前置依賴；衝突預檢通過。
- 驗收：正式戰鬥迴圈普攻／自動施放共存、暈眩與到期、Excel原生重開與資料同步、Preset尺寸／狀態接線／動態預覽、build。完成後提交，交使用者檢查外觀；不合併或推送。
- 光壁：ground-storm-dance.json，地板半徑100世界單位，地板縱深投影0.38，壁高30世界單位；7層柔光帶＋24局部粒子發射器，上限312顆。沿用既有貼圖與狀態光環Runtime，未新增Timer或修改Runtime。Status的sgStorm持續特效接線，隨角色移動、快照移除即回收。素材庫保存Preset/layout，與遊戲檔逐位元相同，素材庫Commit `8431004`。
- Excel：Skills2／Status各改2格，Excel原生API更新、兩次正常重開逐格驗證，繪圖0→0。僅同步本次CSV列；Skills2原Excel第20列既有proj-cleave-ring-tricolor-09與CSV不同，保留原Excel、不將該無關差異帶進本次CSV／JS。兩張CSV apply dry-run均零語意變更。
- 測試：`node --test tests/storm-dance.test.cjs tests/skill2-review-fixes.test.cjs tests/basic-melee.test.cjs tests/skill2-status-slots.test.cjs tests/skills2-mana-cost.test.cjs` 29/29；`node --test --test-name-pattern="STORM-DANCE|STATUS-" tests/vfx-runtime.test.cjs` 4/4；`node tools/build_check.cjs` 379檔通過；diff check通過。舊審查測試補足新版耗魔所需MP，保留暈眩／DOT行為断言。
- 已在VFX Editor實播並截圖，schema合法、Console無error/warn。檢查未修改vfx-runtime.js、vfx-core.js、battlefield.js、原ground-cyclone-avatar及素材貼圖。未完整遊戲實機或GPU壓測；新增普攻按需求增加總輸出。可合併，未推送；下一步使用者檢查光壁外觀。

## Codex｜超神升級標籤高度（ULT-TAG-LAYOUT-20260918）

- Owner Codex；Done。修正主動超神耗魔獨占一列，使固定五列 Grid 的技能標籤被拉高、說明區縮小。依使用者正常畫面參考，耗魔移入標頭，標籤維持第二列，保留原有內容與操作。
- 允許修改 js/ui.js、index.html 與本紀錄；禁止修改技能數值、表格、存檔及特效。前置依賴無，衝突預檢通過。驗證技能耗魔／UI 相關測試、build 與 diff；完成提交後交使用者檢查畫面。
- 驗證：`node --test tests/skills2-mana-cost.test.cjs` 4/4 通過；`node tools/build_check.cjs` 378 檔通過；`git diff --check` 通過。檢查但未修改 css/style.css，無素材變更。未實機驗證畫面及 Console；建議重新整理後檢查千鳥升級彈窗，可合併程式修正，未合併或推送。

## Codex｜Skills2同列特效用途與觸發欄位（SKILLS2-VFX-EVENTS-20260918）

- Owner Codex；Done。使用者授權將 Claude 已提交分支合併到 ai/codex，再修改 Excel／CSV。已合併 fea2ce3c 及其狀態表格化前置提交，保留我方／敵方狀態與 Status 畫面權威；沒有修改 develop 或推送。
- 移除模糊特殊效果欄，增加五個觸發角色及同列唯讀作用說明。本次遷移逐風者、霹靂一閃、雷神之怒、毒霧感染、屍爆、零日感染、兩領域與崩解共九種事件。其他事件維持既有本體角色派送並於說明明示，未接線的觸發欄拒絕填寫。
- 範圍：Excel／CSV、skills2.js 解析與生成資料、vfx-runtime.js 預載、config_tables.cjs、preset-usage.cjs、原生 Excel 更新工具、新增遷移／契約模組、相關測試、快取及說明。禁止變更傷害、節奏與狀態機制；未新增素材。
- 230 列非特效資料與所有原有引用逐列核對一致；Excel 原生 API 寫入 260 格並插欄，兩次正常重開逐格驗證，圖形 0→0。CSV／JS dry-run 零語意差異。96 項契約／繼承／狀態／飛行／超神／範圍測試通過；node tools/build_check.cjs 374 檔通過。測試指令：node --test tests/skills2-vfx-usage.test.cjs tests/skills2-vfx-schema.test.cjs tests/skill-vfx-inheritance.test.cjs tests/skill2-status-slots.test.cjs tests/skills2-flight-speed.test.cjs tests/skill2-ult-evolution.test.cjs tests/skills2-geometry.test.cjs。
- Runtime 全檔 99 項有 1 項既有 CATALOG-3（bolt-sky-purple 頂層兩群組）；引用掃描有既有 hit-thunderstrike-bluewhite Runtime 特殊處理未登記問題，非本次新增，未改素材或放寬測試。另 skill2-vfx 的火球測試缺 VFX_PROJECTILE_SPEED_CELLS 初始化；本次未修改火球計畫或其測試。尚未實機畫面驗證；可交使用者檢查新欄位後合併。檢查未修改 Status Excel／CSV、combat.js、status.js、飛行佇列與素材；沒有素材庫變更。

## Codex｜血刃飛行速度欄位匯入（BLOOD-FLIGHT-SPEED-20260918）

- Owner Codex；Done。前次新增毒彈執行期接線後漏登記嚴格表格契約，導致使用者填速度時匯入被拒。新增bloodblade/5與bloodblade/disintegrate的speed／speedPer接線；維持其他未實作欄位拒絕匯入。
- 修改tools/skills2-geometry.cjs、tests/skills2-flight-speed.test.cjs、index.html／bridge.js快取及本紀錄。執行Skills2 apply成功，將使用者目前兩列100米／秒同步至本機skills2.js；使用者表格、生成資料與特效仍留在工作區，不混入工具修正提交。
- `node --test tests/skills2-flight-speed.test.cjs`4/4通過，直接從CSV重建配置後驗證毒霧感染與崩解20,2在Lv10為40米／秒，40米飛行及命中排程均1秒。apply後再dry-run零語意差異。檢查未修改Excel、CSV、飛行佇列與Preset。未推送或合併。

## Codex｜毒霧感染與崩解飛行結算（BLOOD-FLIGHT-20260918）

- Owner Codex；Done。毒霧感染未傳travelMs，Runtime以0.001秒播完；感染立即套用。崩解原本只在中心發出子彈事件並立即傷害周邊，沒有逐目標飛行。兩者改走共用血刃飛行佇列，填有子彈才延後至抵達結算，沒子彈保留即時路徑。
- 明確傳起點／終點與權威travelMs，速度取對應列配置，空值沿用現有通用飛行速度；不新增硬編碼Preset。崩解中心爆炸立即播放，各受影響目標分別收到子彈及抵達命中。毒霧感染抵達後才塗毒／播命中，同一目標已有在途感染則暫不重複選取。來源死亡保留發射座標、目標死亡或離場取消結算；使用現有逐幀佇列，沒有新增Timer。
- 修改skills2.js、vfx-runtime.js、index.html／bridge.js快取、skill2-system／skill2-ult-evolution／vfx-runtime測試及本紀錄。檢查CSV目前的子彈填值與proj-poison-drop Preset，未修改表格或素材。使用者原有表格／生成資料／VFX修改留在工作區，本次提交只包含程式修正。
- 驗證：技能超神＋Runtime共149項，148通過、1項既有CATALOG-3群組配置失敗；毒霧感染數量定向測試1/1通過；其餘定向飛行／崩解／連鎖10項通過。完整skill2-system另有3項既有迴旋斬／飛刀失敗，未放寬。Build370檔通過。覆蓋抵達前不扣血／塗毒、每跳多彈、來源座標、飛行中間位置、死亡目標取消、感染數量與真正雷電連線。
- 尚未遊戲實機驗證或密集子彈效能量測；崩解多目標多跳會增加在途子彈數，沿用既有VFX預算。未推送或合併。

## Codex｜崩解改為加速持續傷害及逐次爆炸（DISINTEGRATE-20260918）

- Owner Codex；Done。依使用者確認，爆炸基準是該狀態完整持續期間總傷害，不是單跳或剩餘傷害。保留中毒／流血狀態，間隔縮短40%＋每級4%，爆炸係數50%＋每級5%；沿用base＋per×lv及最低0.1秒。半徑保留表格6米，爆炸不重打來源目標。
- 正式DOT規格只縮短一次，維持每跳傷害與持續時間，因此加速增加總傷；傳染複製既有間隔，不再加速。tickStatuses在實際結算後觸發，每次作用各自爆炸；致死跳、到期餘額結算、零日感染提前結算也能爆炸。場上爆炸死亡走既有死亡結算，無敵不觸發。特效使用表格崩解角色與同一判定半徑，保留屍體位置事件。
- 修改 skills2.js、combat.js、Skills2.xlsx／CSV、index.html／bridge.js快取、skill2-ult-evolution測試及本紀錄。檢查status結算、Runtime範圍顯示、表格編譯器，未修改它們。Excel透過原生API只改崩解3格，正常模式重開、逐格比對、繪圖物件0→0；保留使用者其餘表格值並同步生成資料。使用者正在編輯的VFX與素材不納入本次提交。
- 驗證：`node --test tests/skill2-ult-evolution.test.cjs` 57/57；`node --test tests/combat-dot-log.test.cjs tests/status-system.test.cjs tests/skill2-counter-bloodrage.test.cjs` 49/49；`node tools/config_tables.cjs --apply Skills2`零語意差異；`node tools/build_check.cjs`370檔通過。覆盖持續狀態、間隔成長、總傷爆炸、多跳次數、傳染、致死跳、範圍、特效、無敵與非血毒狀態。
- 風險／未完成：未實機驗證密集戰鬥效能；加速且每跳爆炸會增加周邊判定及特效數，沿用現有特效預算。可合併；未推送或合併。

## Codex｜殺神領域跟隨玩家（BLOOD-DOMAIN-FOLLOW-20260918）

- Owner Codex；Done。使用者更正名稱為殺神領域。共用領域事件補上 area.follow，Runtime每幀取玩家顯示位置，不再停留在每秒續命事件的舊座標；萬毒血霧共用修正。傷害／死亡判定原本即採當前玩家位置，未改數值或判定。
- 修改 skills2.js領域事件、index.html與bridge.js快取、vfx-runtime回歸測試及本紀錄。測試直接取得正式領域事件，覆蓋兩種領域，確認無新事件時移動仍更新且不重建特效。定向1/1通過；使用既有跟隨機制，無新增Timer或事件頻率。尚未實機畫面驗證。
- 檢查未修改Runtime跟隨實作與技能表；使用者原有Excel／CSV、skills2生成資料、ground-mire Preset/layout變更保留不納入本次提交。未推送或合併。

## Codex｜毒霧感染毒咒朝向（POISON-FACING-20260918）

- Owner Codex；Done。毒霧感染繼承的攻擊角色原先因 chain 事件被拉成光束；改在傳染兩端的敵人位置保留作者尺寸與方向播放。子彈仍使用原本連鎖飛行路徑；技能傷害、表格、Preset與真正雷電連線不變。
- 修改 js/vfx-runtime.js、index.html快取、tests/vfx-runtime.test.cjs及本紀錄；檢查 skills2.js傳染事件／角色繼承、curse-poison與proj-poison-drop Preset、battle-renderer與Worker事件，未修改這些檔案。
- 定向回歸6/6通過：三種目標方位、原圖層旋轉／尺寸、子彈移動、單體尺寸、雷電連鎖及端點離場。完整Runtime／特效繼承測試另有既有CATALOG-3群組數失敗，與本次派送修改無關。未做遊戲實機畫面驗證。無新素材、無逐幀新增工作；未推送或合併。

## Codex｜過時技能與特效測試更新（TEST-CONTRACT-REFRESH-20260917）

- Owner Codex；Done。依使用者要求全局檢查舊數值、舊特效／程式文字／快取版本斷言、Skills2舊欄位測試。僅更新已確認過時的測試契約，不修改正式技能數值或掩蓋行為差異。
- 範圍：tests相關案例與測試輔助、任務紀錄。前置依賴：Skills2範圍欄位遷移已完成。禁止順帶修改遊戲程式、Excel、CSV及使用者VFX。
- 驗證：全套修改前基線、相關測試、全套修改後差異、具代表性的錯誤注入、build。剩餘非本次範圍失敗另列；完成後提交，交使用者決定合併。
- 修改：21份測試與 tests/helpers/skill-table.cjs；從原始CSV獨立取得配置期望值、驗證完整編譯結果及新幾何欄位；距離／速度使用合併成長格式。固定版本改驗證有效快取參數；純幾何測試使用明確素材夾具，正式素材合法性／繼承檢查保留。未增加跳過案例。
- 基線：`node --test --test-reporter=spec "tests/*.test.cjs"` 得2874項、2788通過、84失敗、2跳過，其中2項是卡住後終止的測試檔。最終全套排除確認卡住的 equip-no-duplicate.test.cjs、sim-evaluator.test.cjs，使用 `node --test --test-concurrency=4 --test-reporter=spec` 加其餘全部 tests/*.test.cjs，得2872項、2841通過、29失敗、2跳過；修復53項失敗，另2個卡住檔未完成，不能視為通過。
- 技能組：`node --test --test-reporter=spec "tests/skill2*.test.cjs" "tests/gale*.test.cjs"` 得546項、529通過、17失敗；加上已通過的 skills2-geometry.test.cjs 6項，對應前次552項為535通過、17失敗（原50項減少33項）。更正前次「50既有失敗」說法：包含本次已修的遷移漏更新測試；以最新表格跑舊邏輯的基線不能證明全部均為遷移前既有問題。
- 剩餘29項（保留原斷言，尚待獨立診斷，並非全部已證實是遊戲Bug）：skill2-ice 6、skill2-system 3、skill2-vfx 1、skill2-waterball-frostnova-legendary 5、skill2-wind 2、icearrow-vfx-integration 3；ui-worker-panels、vfx-asset-semantics、vfx-editor-gizmo、vfx-editor-history、vfx-editor-save、vfx-gradient-editor、vfx-preset-layout、vfx-preset-usage、vfx-runtime 各1。涉及命中時序／移動、缺少測試環境常數、UI環境、生成資料、粒子縮放契約、歷史快照記憶體、Preset正規化／群組與登記；未放寬檢查以消除紅燈。
- 錯誤注入7/7被抓到：錯誤冷卻、沼澤尺寸、雷電傷害、迴旋斬特效、震碎斬距離成長、水流彈弧高、缺少快取版本。僅記憶體注入，正式資料未修改。`node tools/build_check.cjs`：370檔通過；`git diff --check`通過。
- 檢查但未修改：正式技能程式、配置編譯器、Skills2.csv、index及Worker入口、VFX Core／Runtime與相關Preset。使用者4份bolt Preset/layout變更留在工作區不提交。可獨立合併本次測試更新，但整個專案仍非全綠；未推送或合併。

## Codex｜Skills2 範圍用途拆分與成長欄合併（SKILLS2-GEOMETRY-V2-20260917）

- Owner Codex；Done。使用者授權230列範圍重構：施放／搜敵／傷害／控制／偵測／碰撞／環繞／飛行等獨立用途，基值與增量以逗號同欄，矩形長寬以星號表示。
- 範圍：Skills2.xlsx／CSV、config_tables、用途接線模組／遷移工具／原生Excel保存工具、skills2.js幾何成長、頁面及Worker快取、新格式測試與說明文件。保留使用者正在編輯的技能表值與VFX素材。
- 原始230列與轉換後資料比對值相同；新增6項格式／幾何測試通過。Excel原檔殘留無法索引的hidden textbox，原生Excel只儲存就新增空白AutoShape；依使用者回報以Excel API複製儲存格至乾淨工作簿、排除舊繪圖物件，連續正常重開／儲存確認0個圖形且逐格一致。已正式同步Excel、CSV與JS；未手工修改工作簿XML。
- 全技能回歸552項：502通過、50既有失敗；隔離修改前邏輯＋相同最新Excel資料的基線為完全相同50項失敗，無新增失敗。保留使用者自行調整的倍率、搜敵距離及特效引用，未為迎合舊測試改回數值。build370檔通過；再次apply為0差異。新版表格引用的使用者千鳥Preset及layout作為資料依賴隨附，其餘使用者bolt修改不納入提交。未推送、未合併。

## Codex｜落雷藍白飛濺與死亡粒子移除（VFX-THUNDER-SPLASH-20260917）

- Owner Codex。移除battle-renderer死亡時額外生成圓點的呼叫，保留死亡動畫。hit-thunderstrike-bluewhite以既有VFX粒子重製：7藍5白圓點向上噴發、重力260、壽命0.45～0.75秒，搭配5道曲折雷電及短暫核心閃光，取代霧狀光環。沿用整組連續雷電變形。
- 僅使用既有素材與Core；8個圖層、每次最多12顆粒子，沒有持續發射／新Timer。WebGL實播無pageerror／backend錯誤，動態預覽直接擷取實際Pixi畫布。尚未量測完整遊戲GPU效能。
- 素材庫無修改；正式匯出索引移除不再使用的circle_rings_c，素材库原檔保留。使用者正在修改的技能表、雷神之怒及千鳥Preset不納入此任務。
- Done；node --test tests/vfx-core.test.cjs tests/vfx-preset-coverage.test.cjs tests/projectile-impact-size.test.cjs：144/144通過；battle-renderer語法、Preset schema及diff check通過。未推送或合併。

## Codex｜千鳥強化爆散（SKILL-CHIDORI-20260917）

- Owner Codex；Done。月牙閃每敵完整傷害；千鳥爆散加成同時乘上爆散傷害係數與目標數，再對小數目標數擲骰。額外傷害加成套用月牙閃與爆散各一次。兩項加成均配置基值50、每級5，沿用既有 base＋per×lv 計算。
- 修改 skills2.js、Skills2.xlsx／CSV、遊戲及Worker快取、gale-rework測試。本次Excel只替換AF41、AI41、AJ41儲存格，ZIP其餘項目完全保留，避免繪圖物件變形。使用者其他表格、bolt-sky-purple配置與布局修改保留。
- 驗證：gale-rework／gale-thunder-flash／skill-vfx-inheritance共25項通過；skill2-ult-evolution指定千鳥／霹靂一閃／雷神3項通過；配置apply dry-run零語意差異。覆蓋不同等級、獨立倍率、完整傷害、小數目標數、回打原目標及傷害／特效逐下同步。
- 無新增逐幀運算；實際追加命中與特效數依強化後目標數增加。未進行實機遊戲效能量測；未推送或合併。

## Codex｜雷電整組連續變形（VFX-LIGHTNING-DEFORMATION-20260918）

- Owner Codex；Done。使用者核准落雷鏡像、局部連續扭曲及輕微缩放，擴展22份適用Preset。Core統一種子／區域座標函數，Pixi85頂點網格；端點及拼接共用座標，不動傷害與飛行路徑。
- 修改Core、Pixi backend、Editor種子與快取、離線renderer、22份Preset、變形測試／瀏覽器驗證工具及規格文件。未接入使用者拒絕的hit-thunderstrike-bluewhite候選；未改素材。
- 303項回歸：296通過、1跳過、6既有失敗；獨立HEAD快照確認相同6項Runtime失敗。實際WebGL覆蓋22份／79網格無錯誤，40道密集施放平均多約1.36ms CPU更新及渲染提交；尚未實機遊戲GPU量測。詳見 docs/vfx/LIGHTNING_DEFORMATION.md。
- 保留使用者並行修改的技能表、skills2.js及bolt-sky-purple圖層/layout，留在工作區不混入本次提交。素材庫乾淨，無新素材提交。後續Editor定向22項全數通過；build367/367與diff check通過。可合併，未推送。

## Claude｜VFX 編輯器：預設空場景、點空白取消選取、方向鍵移動、Alpha 標題（VFX-EDITOR-NUDGE-20260917）

- Owner：Claude；Done。使用者需求：(1) 首次開啟編輯器預設打開雷球特效，應該是空場景；(2) 點擊預覽視窗空白處取消目前的圖層選取；(3) 方向鍵移動圖層，每次 1px；(4) 途中追加：Over-Life 的 Opacity 改成 Alpha（透明度）比較直覺。
- 範圍：tools/vfx/launch-editor.cjs、啟動VFX編輯器.bat（說明文字）、tools/vfx/editor 的 editor.js、gizmo-model.js、history.js，對應測試與 Antigravity QA 指示書。不動 Core、Runtime、preset。依賴 VFX-EDITOR-MULTI-PANE-20260917。
- 修改：
  - 預設空場景（a561e820）：啟動器原本寫死 DEFAULT_PRESET＝lightning-orb-field 並帶進網址，編輯器網址沒帶 preset 時開 demo-basic；兩邊都改成空場景（參數不合法也開空場景並說明）。空白特效的暫時名字不當成目前特效顯示（搜尋框留空、複製按鈕不動作、視窗標籤寫未命名特效）。
  - 點空白取消選取、方向鍵移動（aca0129f）：沒打中框、把手或圖層就取消選取；把焦點切到另一個視窗的那一下保留它的選取。方向鍵每按一下 1px、Shift 10px，方向是畫面上的方向（掛在轉過、放大的父物件底下也是畫面上的 1px），單選／多選／群組都能移；按住到放開算一步歷史。歷史模組加交易代號（begin 回傳代號、commit(代號) 只收自己那一筆），避免按住途中點了輸入框、放開時把輸入框的交易提早收掉；不帶代號的既有用法不變。
  - Alpha 標題（abdefc75）：只改區段標題與內部收合代號，資料仍是 alphaOverLife，數值與意義不變（0＝完全透明、1＝alpha 本身、大於 1 過曝）。
- 決策（使用者沒有指定、依慣例決定）：Shift＋方向鍵一次 10px（與拖曳時 Shift 對齊的格距相同）；Alt／Ctrl＋方向鍵不攔；方向鍵在輸入框、下拉、曲線編輯器、Spine 參考面板裡照原本的行為；點另一個視窗的空白處只換焦點不取消選取。
- 驗證：LAUNCH-2／5、PANE-30、NUDGE-1～5（NUDGE-3 在 vm 裡跑按住／放開與插入別的交易）、HISTORY-47、OL-ALPHA；WIRE-3 原本釘住收合代號 opacity，改成 alpha。13 個突變全部被抓到（原本漏抓一個：寬鬆的 assert.deepEqual 把 {x:0,y:0} 當成等於 null，改用 deepStrictEqual）。三個 commit 各自以 git checkout-index 匯出暫存區跑編輯器測試，都只有 3 條既有失敗。VFX 全套 862 項，失敗與基線清單相同。瀏覽器實測：無參數網址是空場景；→ 1px、Shift+↑ 10px、按住 ← 十下只記一步、Undo 回原位、Alt+→ 不攔；點空白取消選取、點另一格空白保留選取、群組整組移動；Alpha 標題。
- 待確認：無。

## Claude｜VFX 編輯器多視窗同時預覽與調整（VFX-EDITOR-MULTI-PANE-20260917）

- Owner：Claude；Done。使用者需求：預覽區上方「新增視窗」把預覽分割成多格（原本的在左、新的在右，最多四格十字切開）；點擊視窗焦點就移過去，可在那一格載入特效或新增圖層，同時操作多份特效；視窗之間的圖層可以互相複製貼上。開發途中追加：Ctrl+點擊多選視窗，開始／暫停與預覽循環同時套用到多選的全部視窗。
- 範圍：tools/vfx/editor（新增 pane-model.js；editor.js、layer-model.js、editor.css、index.html）、對應測試、VFX_AGENT_WORKFLOW §9.8／§9.11、VFX_RUNTIME_ADAPTER §1.2.1、新增 Antigravity QA 指示書。不動 Core、Runtime、preset、表格。無前置依賴。
- 修改：
  - 純邏輯（556fac9f）：pane-model.js——版面、點擊與 Ctrl 多選與關閉後的焦點、多選時的播放／循環顯示、網址格式、空白特效、跨特效剪貼簿（父物件沒一起複製就卸下並換算成畫面不動、子發射器目標沒一起複製就拿掉、群組攤成圖層貼進根群組）。layer-model 的 pasteClipboard 加 keepIds（跨特效貼上沿用原 id）。
  - 多視窗（be5b0e32）：每格各有 Pixi 畫布、runtime、鏡頭、播放狀態與一份編輯狀態；state 的每格欄位轉到「目前操作的視窗」，非同步回呼用 bindPane 綁回原本那一份，背景視窗不畫面板。切換特效改成就地換上全新的編輯狀態、另存新檔就地重開（不再整頁重新整理，否則會關掉其他視窗）；換特效時換一組 runtime 並收掉舊貼圖。同一份特效只開一格；網址記住每格的特效；新視窗是空白特效，第一次存檔走另存新檔。順手修正 ⟲ Restart（2026-09-02 起一直只是原地重建，現在真的從頭播）。
  - 跨視窗貼上（8501bf13）：複製當下同時備好貼到別份特效用的內容；貼上時依來源是不是眼前這一份決定走哪一份，並在狀態列說明。
  - 文件（本紀錄所在提交）：§9.8 補「網址帶多個 preset 並排比較」，§9.11／§1.2.1 的「之後要能同時編輯多份」改成現況；新增 docs/ANTIGRAVITY_VFX_EDITOR_MULTI_PANE_TEST_CASES.md。
- 決策（使用者沒有指定、依慣例決定）：三格時第三格橫跨下排；點擊已在多選裡的視窗只換焦點、不取消多選；Ctrl+點擊只管多選不動圖層；Restart 也跟著多選；背景色與格線全部視窗共用，縮放與平移各格獨立（滾輪縮放滑鼠底下那格）；只有焦點那格畫 gizmo 的框；同一份特效不能開兩格；跨視窗貼上沿用原 id（同一格貼上仍帶 -copy）。
- 驗證：PANE-1～29 全過；pane-model 20 個突變、編輯器接線 15 個突變全部被抓到；更新 10 條釘住「整頁重載／單一視窗」的測試並保留原意圖。VFX 全套 854 項，16 項失敗與合併前的基線清單逐條相同。瀏覽器實測（假 fetch、不寫檔，確認沒有產生檔案）：一到四格版面與上限、焦點與 Ctrl 多選、一起暫停／播放／Restart 歸零、循環混合狀態、滾輪只縮放滑鼠底下那格、各格 Undo 互不影響、存檔回應晚到時寫回原本那格、另存新檔就地重開、關閉未存檔視窗先問、網址還原兩格與焦點、瀏覽特效開進焦點格、跨格貼上掛在轉 90°／放大 2 倍父物件底下的圖層世界矩陣不變。
- 待確認：Antigravity QA 尚未執行（指示書已備）；背景色要不要改成每格各自設定（目前共用）；多格同時播放含大量粒子的特效時的效能只在四格空白＋兩份特效下實測過。

## Claude｜VFX 父子層級與空物件（VFX-HIERARCHY-20260917）

- Owner：Claude；Done。使用者需求：可將多個子物件掛在父物件底下，子物件繼承父物件的參數。使用者決定：繼承變換＋透明度＋顏色；時間軸跟著父物件（子物件的 delay 從父物件出現起算，父物件還沒出現、已結束或停用時子物件也不出現）；任何圖層都能當父物件，另加不畫東西的空物件；掛上時畫面位置不動。
- 範圍：js/vfx-core.js、tools/vfx/editor（新增 hierarchy-model.js；editor.js、layer-model.js、gizmo-model.js、editor.css、index.html）、tools/vfx/preset-render.cjs 與 preset-thumbs.cjs、根目錄 index.html 版號、VFX 文件與測試。不改任何 preset、表格、Runtime Adapter。無前置依賴。
- 修改：
  - Core（a8f1716）：圖層可填 `parent`，新增 `empty` 型別；世界矩陣＝特效·祖先…·自己（非等比父物件＋子物件旋轉會送出 skewX）；透明度、顏色相乘；驗證父物件存在、不是自己、不成環、最多 8 層、子發射器來源與目標同一個父物件；公開矩陣工具與 EMPTY_LAYER_FIELDS。粒子層當子物件／父物件的規則見 VFX_CORE_AND_PRESET_SCHEMA §2.5。沒有 parent 的圖層完全走原本的算式。
  - 離線出圖畫斜切（bd27d7f，縮圖快取版本升到 3）。
  - Editor（a890d22）：掛上／卸下時把位置、角度、縮放、外層縮放換算成父物件底下的區域值、delay 換算成從父物件出現起算（非等比父物件用外層縮放吸收；存不下的斜切取最接近的一組並在狀態列告知）；Inspector「父物件」下拉（可多選）；圖層面板樹狀縮排與收合；拖到圖層列中段＝掛上、上下緣＝成為兄弟、群組列＝回到根層級；複製／刪除父物件連子物件一起；改 id、貼上時父子與子發射器參照跟著改；空物件只列 Core 允許的欄位。
  - 預覽框（2de784d）：框、把手、點選、拖曳、多選、群組在父物件座標計算；父子同時被選或同在群組時只動最上層；預覽區點選不選空物件。
  - 文件（1744e1c）：VFX_CORE_AND_PRESET_SCHEMA §2.5.1、VFX_AGENT_WORKFLOW §9.11.1。
  - 合併 ai/codex 之後補上（本紀錄所在提交）：根目錄 index.html 的 vfx-core 版號（當時 ai/codex 對 index.html 有未合併修改，先不動）；重掃 Runtime Adapter，HIER-16 補上當初漏掉的 bolt-chain-travel-bluewhite（讀 travelling-electric-front 的 scale 推光束寬度）；CATALOG-2 放行空物件（原本會把沒有 assetId 的空物件報成「用到未匯出的素材：undefined」）。
  - 合併後相容性探測：以 git archive 匯出合併後的 HEAD，加一份測試用 preset（hit-fire 的圖層），分「平的」與「掛了空物件（attach 換算）」兩版，各跑 40 支會讀 preset 的測試（921 項）。平的版本與不加檔的基準失敗完全相同；掛了空物件的版本只多出 CATALOG-2，修正後在同一個複本重跑通過。原本就紅的 31 條在兩版的錯誤內容逐字相同，而且都只讀指定的 preset、沒有逐份掃資料夾，不會遮住新問題。遊戲與編輯器共用的 Pixi 後端本來就會套 skewX。
- 決策：刪除父物件時連子物件一起刪，與群組連成員一起刪一致（原規劃是把子物件交給祖父；要保留子物件先卸下）。
- 驗證：Core 修改前後以 209 份 preset × 3 種播放情境比對送到後端的每一個值，逐位元相同；HIER-1～16、SKEW-1～2、PARENT-1～34 全過；Editor 與 gizmo 共 28 個突變全部被抓到；VFX 全套 823 項，16 項失敗與基線清單逐條相同。瀏覽器實測（未存檔）：掛上前後三個時間點的 Runtime 輸出一致；子物件掛在轉 30°、放大 2 倍的空物件底下，預覽上拖框 20px，畫面上剛好移動 (20, 0)；父子一起拖、整組拖時子物件只移動一次；收合、拖曳、複製貼上、刪除、復原正常。
- 待確認：Runtime Adapter 有特殊處理的 6 份 preset 暫不得使用（HIER-16 守著）；粒子層掛上時只換算發射點位置；遊戲裡還沒有任何 preset 實際用到父子層級。

## Claude｜VFX 編輯器三個回報修正：工具列不換行、暫停中編輯預覽不消失、另存新檔後重新載入（VFX-EDITOR-FIXES-20260917）

- Owner：Claude；Done。使用者回報：(1) 按存檔後出現存檔訊息，「關閉編輯器」被擠到第二行，並要求拿掉 effects／particles 計數；(2) 暫停時改特效參數，預覽整個消失、只剩框；(3) 另存新檔後特效停止播放，要求改成清掉選單的篩選字、換成新名字、重新載入。
- 範圍：tools/vfx/editor 的 editor.js、editor.css 與對應測試；不動 Core、Runtime、preset。無前置依賴。
- 修改：(1) 3cf4ee0 拿掉計數、工具列改成不換行。該版為了不換行把工具列做成橫向捲動容器、關閉鈕 sticky，使用者接著回報「點了特效菜單後整個置頂區都壞了」——Preset 下拉掛在工具列裡被裁掉，選取時的 scrollIntoView 又把整條工具列捲走；d3ebfd3 拿掉捲動與 sticky，改成放不下時按鈕自己縮短（切尾），一行內全部留在畫面上。(2) e883077：改參數會重建預覽，Core 的 play() 只建立狀態、畫面物件要等 update 才生出來，而暫停時 ticker 不呼叫 update；重建後暫停中補一次 update(0)（不前進時間）。(3) b410f60：另存時 Core 裡註冊的仍是舊名字，預覽循環用新名字重播每幀丟錯；送出前先註冊新名字，另存成功後換掉選單篩選字串、等分組存完再以 ?preset=新名字 重新載入（分組沒存成就不重新載入並顯示原因）。
- 驗證：PAUSE-1／2（換回修改前的 editor.js 兩條都紅）、SA5。瀏覽器實測：1600／1280px 工具列固定 47px、存檔訊息出現前後不變、Preset 下拉 206 列完整展開、連按 ↓ 不捲動工具列；暫停後改 position.x，不經 ticker 就有 12 個節點可見；另存成暫時的 zz-saveas-probe（驗完已刪除），重新載入後根群組跟著改名、12 層都在，101 幀 0 個錯誤。
- 待確認：無。

## Codex｜霹靂一閃全場貫穿（GALE-THUNDER-FULLFIELD-20260917）

- Owner Codex；Done。以當前玩家為中心，沿玩家與目標連線貫穿長100米、寬10米（前後各50米）；傷害與特效共用矩形。基礎次數表定count=3，再加角色連擊數；維持0.2秒重選20米內敵人、無敵即停與0.08秒伸滿。
- 修改 skills2、Skills2.xlsx/CSV、三份測試、index/bridge/worker快取與本紀錄。Excel僅O39/AF39/AI39/AJ39四格改動，artifact-tool匯出且比對所有儲存格；移除back參數。沿用既有Preset依事件伸長，無素材修改。
- 驗證：gale-thunder-flash/gale-rework/skill-vfx-inheritance共22項、霹靂一閃/雷神斬/千鳥3項、Runtime THUNDER-FLASH 1項通過；build及diff check通過。原製作30米Preset正確拉長至100米，寬度不變。
- 效能：單道粒子數不增加，每次施放較前版多2道；未實機量測GPU負載。無未完成實作，可合併，未推送。

## Codex｜霹靂一閃角色連擊數修正（GALE-THUNDER-COMBO-20260917）

- Owner Codex；Done。修正誤以疾風破自身打擊次數增加雷電數量，改讀施放時角色 comboHits，加上狂化連殺／狂暴之舞期間加成；小數沿用 sgRollCount 機率。0 連擊只出 1 道，3 連擊出 4 道；本體追加打擊只影響最後一擊的觸發時間。
- 修改 skills2、兩份測試、index／bridge／worker 快取及本紀錄；檢查 formula 的連擊口徑，無需修改表格或特效。
- 驗證：node --test tests/gale-thunder-flash.test.cjs tests/gale-rework.test.cjs tests/skill-vfx-inheritance.test.cjs 共22項通過；node --test --test-name-pattern="霹靂一閃|雷神斬|千鳥" tests/skill2-ult-evolution.test.cjs 共3項通過。diff check通過。
- 無新增 Timer 或粒子；未進行遊戲實機驗證，無未完成實作，可合併，未推送。

## Codex｜霹靂一閃貫穿雷電改造（GALE-THUNDER-FLASH-20260917）

- Owner Codex；In Progress。最後一擊觸發 1＋連擊數道紫白雷電，每道間隔 0.2 秒重新選擇玩家 12 米內敵人；從玩家後方 6 米伸出，總長 20 米、寬 5 米，每道 200% 雷電傷害。
- 先製作 thunder-flash author、beam-gale-thunder-flash preset/layout 與動態預覽；依既有新特效預覽流程，確認後接入程式及 Excel/CSV。升級成長與無敵人行為已向使用者詢問，尚待回覆。不改使用者正在編輯的其他素材。
- 使用者已答覆：每級 +20% 雷電傷害；選敵改為玩家周圍 20 米，無敵人即停止。再次明確要求先看動態預覽，確認後接入。
- 預覽完成：4 道方向不同的雷電、0.2 秒間隔、每道約 0.08 秒伸至全長，綠色中心標記為玩家；重用既有素材，8 層／每道最多 18 粒子。Core／Editor save 測試 181 項，180 通過、1 項因 Windows 檔案 symlink 權限跳過；未進行遊戲效能量測。狀態 Review，未接入、未改表格、未提交，等候外觀確認。
- 第二版依使用者回饋：寬度加倍（製作 200×100，尺寸標示 20×10 米），纏繞電弧由 2 層增為 4 層並改用分岔電弧素材；粒子由 18 增為 36。10 層，仍維持 0.2 秒四連發；已看過實際 Core 渲染幀並輸出 v2 GIF。仍為預覽待確認，未接入／未提交，正式傷害寬度待依本版核准尺寸同步。
- 第三版：使用者認可第二版外觀並要求長度 +50%；改為長 30 米、寬 10 米，起點仍在玩家後方 6 米。只延長光束及粒子沿線分布，保留寬度、粒子數、單顆粒子大小及節奏；更新 v3 動態預覽，尚未接入／提交。
- 使用者核准正式接入：最後一擊後發射 1＋本次連擊數道，0.2 秒間隔；首道優先原目標、失效時改選候選，後續逐道隨機重選玩家20米內敵人，無敵人即終止。每道從當前玩家後方6米開始，沿目標方向伸至30米、寬10米；0.08秒伸滿，矩形碰撞隨伸展推進，單道只命中同敵一次。傷害用攻擊力×表定 pct（基值200、每級20，沿專案 base+per×lv 公式）。
- 接線：沿既有飛行物排程增加矩形伸展碰撞分支，無獨立 Timer；事件直接傳起點、長寬、方向和伸展時間，Runtime 不套場景特效倍率。霹靂一閃表記為附加效果，光束僅由該序列觸發，不覆寫本體打擊。主執行緒／Worker 快取同步，協議無新增欄位。
- 表格：artifact-tool 匯入、渲染前後、修改並匯出；全工作簿值差異核對仅 Skills2 第39列10格。Excel→CSV→JS 重建語意變更0，保留使用者其他數值及三份疾風破特效修改；必要 Preset/Layout/匯出素材同批保存，136份匯出素材與素材庫雜湊一致，素材庫乾淨無需空 Commit。
- 驗證：gale-thunder-flash/gale-rework/skill-vfx-inheritance 20/20；Runtime 定向4/4；三種疾風破超神3/3；cleave/knife/usage16/16，合計43項通過；build362/362、diff check通過。10組並行連發Core更新平均0.154ms，無丟棄（不含GPU）；尚未遊戲實機驗證。
- 狀態 Done，可合併，未推送；已授權效果與表格接入完成。
- 暫存 outputs/gale-thunder-flash 清理遭自動審核以 blocked by policy 拒絕，資料夾保留未提交，不影響正式檔案。

## Codex｜疾風月牙閃保留製作方向（GALE-MOON-DIRECTION-20260917）

- Owner Codex；In Progress。使用者回報垂直落下特效被轉向，原因是 Runtime 舊月牙邏輯依施法者方向加交替角差。
- 範圍：vfx-runtime、runtime 測試、index 快取與本紀錄；移除額外旋轉，保留 Preset 圖層方向／動畫及傷害範圍縮放；不改素材、表格、技能判定。驗收八方向、重複施放、原點与範圍尺寸；無前置依賴，完成供使用者合併。
- 使用者追加：隨機追加目標仍固定讀第四階，改為同主打擊逐欄讀當前進化配置。範圍增加 skills2、gale 測試與 bridge/sim.worker 快取；覆蓋本紀錄中舊 GALE-SCATTER-VFX 的固定第四階決策。單體尺寸、0.2 秒間隔及傷害不變。
- 驗證：GALE/SINGLE-SIZE 定向 3/3；gale-rework 與 skill-vfx-inheritance 16/16；主執行緒／Worker 快取同步。未作實機驗證，使用者編輯中的表格、生成配置與素材保留未提交；無本輪素材修改。
- build 361/361、diff check 通過；Done，可合併，未推送。

## Codex｜爆散每 0.2 秒逐下選敵（GALE-SCATTER-GAP-20260917）

- Owner Codex；In Progress。使用者確認爆散追加攻擊每隔 0.2 秒才重新選一個目標、結算傷害並播放特效；疾風破本體維持原節奏。
- 範圍：skills2、gale 測試、index/bridge/sim.worker 快取及本紀錄；不改使用者編輯中的表格及素材。採用既有多段攻擊 0.2 秒常數及 gale 模擬排程，不新增 Timer。
- 驗收：時間邊界、動態敵群／玩家位置、原目標回打、每下獨立特效、本體節奏與傷害次數。無前置依賴；完成後供使用者合併。
- 完成：本次施放各段的追加次數展開為獨立序列（0、0.2、0.4…秒），每次執行才查最新敵群／玩家位置並隨機選敵；本體保留 0.35 秒。原有每段其他目標不重複、無其他目標回打原目標的规则保留。命中與特效同時執行。
- 效能：沿用模擬排程，不新增實時計時器；只在施放新增排程時排序，非每 Tick 排序。未做額外效能量測。
- 驗證：`node --test tests/gale-rework.test.cjs tests/skill-vfx-inheritance.test.cjs` 16/16；`node tools/build_check.cjs` 361/361；diff check 通過。未另做遊戲實機驗證；Done，可合併，未推送。使用者數值／特效修改保留未提交，無本輪新增素材。

## Codex｜明確化傷害範圍尺寸規則（DAMAGE-SIZE-RULE-20260917）

- Owner Codex；使用者再次確認：有指定傷害範圍，無論原尺寸均縮放至該範圍；無傷害範圍的單體攻擊維持原尺寸。
- 範圍僅 VFX_SIZE_STANDARD、VFX_RUNTIME_ADAPTER 與本紀錄；無程式或素材變更、無前置依賴。衝突預檢與 diff check 通過，文件交叉核對完成；Done，可合併，未推送。

## Codex｜單體攻擊保持製作尺寸（SINGLE-ATTACK-SIZE-20260917）

- Owner Codex；In Progress；使用者指定單體攻擊原尺寸、指定範圍才縮放。範圍：vfx-runtime、runtime 測試、index 快取與本紀錄；不改技能配置、素材或判定。
- 驗收：同一 Preset 單體立即／延遲播放保持原尺寸，不受 sizing 正規化及場景特效倍率影響；範圍仍按事件半徑。無前置依賴，完成供使用者合併。
- 使用者追加：檢查並補充尺寸規範；已在 VFX_SIZE_STANDARD 與 VFX_RUNTIME_ADAPTER 明訂單體原尺寸、判定範圍縮放、選敵半徑不可縮放。
- 狀態 Done；build 361/361，diff check 通過；可合併、未推送，素材库無本輪新增或修改。
- 完成：一般單體 attack 立即／延遲路徑均改用原尺寸；不增加實例或粒子。定向 SINGLE-SIZE/GALE 3/3；Runtime 87 項 81 通過、6 項既有失敗，以 HEAD Runtime 重跑確認相同六項失敗，另新增尺寸測試在舊碼失敗、新碼通過。未實機驗證；使用者既有表格及素材保留未提交。

## Codex｜疾風破主打擊特效繼承（GALE-MAIN-VFX-20260917）

- Owner：Codex；狀態：In Progress；依賴：使用者確認有填用本階、空白繼承前階。
- 範圍：skills2 主打擊特效來源、gale 回歸測試、index/bridge/sim.worker 快取與本紀錄。不改表格、素材、傷害或選敵。
- 驗收：爆散主目標與追加目標使用第四階配置；未取得、空欄、後續階級與超神繼承測試。完成後供使用者合併。
- 完成：移除主打擊固定階級，沿用 sgVfxRoles；傷害、選敵、事件數量與範圍不變。主執行緒及 Worker 快取同步。
- 驗證：`node --test tests/gale-rework.test.cjs tests/skill-vfx-inheritance.test.cjs` 14/14；`node tools/build_check.cjs` 361/361；diff check 通過。未另作遊戲實機驗證。狀態 Done，可合併，未推送；使用者編輯中的表格／特效素材保留未提交，本輪無新增素材。

## Codex｜用途欄改名特殊效果（VFX-USAGE-LABEL-20260917）

- Owner：Codex；Done。使用者決定名稱為「特殊效果」，Excel／CSV 由使用者修改；本次不寫表格。config_tables 的輸出欄名、說明與錯誤訊息改用新名稱；讀入相容「特效用途特效」與「特殊用途特效」，有新欄時優先使用新欄，保留「技能本體／附加效果／留白」語意。
- 修改：tools/config_tables.cjs、tests/skills2-vfx-usage.test.cjs、本紀錄；未改但檢查 Excel／CSV。測試期間發現使用者以舊工具套用改名表格後 JS 遺失用途，已用新工具 --apply Skills2 --write 重新生成以恢復；工作區其他生成資料／素材調整保留未提交。
- 驗證：node --test tests/skills2-vfx-usage.test.cjs，2/2 通過，包含新舊三名稱往返、錯字拒絕及 Excel／CSV／JS 一致性；git diff --check 通過。Commit 為本紀錄所在提交；可合併，未合併／推送，無未完成項目。

## Codex｜爆散讀取第四階攻擊特效（GALE-SCATTER-VFX-20260917）

- Owner：Codex；Done。使用者已填 hit-gale-burst-diffusion，但事件仍指定 vfxTier:1，錯讀本體特效。本次改成 vfxTier:4、vfxBase:true，依第四階逐欄讀取配置，避免月牙／超神覆寫爆散獨立特效；不寫死 Preset 名稱。
- 修改：js/skills2.js 的爆散事件、js/bridge.js、js/worker/sim.worker.js、index.html 快取、tests/gale-rework.test.cjs、本紀錄。未修改但檢查：Excel／CSV 已套用的生成資料、特效繼承。使用者尚未提交的表格、生成資料與特效素材保留，js/skills2.js 僅提交本次事件修正，不混入使用者生成資料。
- 驗證：node --test tests/gale-rework.test.cjs tests/skill-vfx-inheritance.test.cjs，12/12 通過；涵蓋一般、月牙、超神與回打原目標事件讀第四階 attack／hit。git diff --check 通過。
- Commit 為本紀錄所在提交，可供合併；未合併／推送，無未完成程式項目，尚未遊戲內目視驗收。重新整理後使用目前工作區的第四階配置。

## Codex｜疾風破爆散逐段隨機目標（GALE-SCATTER-20260917）

- Owner：Codex；Done。爆散配置改為自身周圍 12 米隨機其他敵人，目標數基值 1／每級 +0.1，技能傷害基值 50%／每級 +5%；沿用 base + per × level 與小數機率取整。每段打擊重新抽樣，同段不重複候選；沒有其他候選時按本段追加次數回打原目標，死亡原目標不補打。有其他候選但不足數量時只打可用候選。
- 計算與特效：每段查最新敵群與玩家位置；每次追加攻擊各送一則特效，包含回打原目標及月牙模式。月牙主範圍已清空時仍可對玩家附近候選爆散。保留本體連擊節拍與傳奇／超神掛鉤，無新增特效來源。
- 修改：js/skills2.js、config/Excel/Skills2.xlsx、config/CSV/Skills2.csv、js/bridge.js、js/worker/sim.worker.js、index.html、tests/gale-rework.test.cjs、本紀錄。表格以 artifact-tool 修改 K35、AE35、AH35、AI35 並渲染檢查；Excel 曾鎖定，使用者關閉後已同步。另保留使用者關閉 Excel 時保存的 AH33／AH34／AI34「斬擊→打擊」文字修改並同步 CSV／JS。其餘儲存格值未改。
- 未修改但檢查：js/battlefield.js（隨機不重複取樣及玩家距離）、skills2 系統與超神測試、VFX 事件路徑。使用者正在調整的 hit-gale-burst Preset／layout／shipped-assets／素材保留未提交，不混入這次技能效果變更。無本次新增素材。
- 驗證：node --test tests/gale-rework.test.cjs tests/skill2-system.test.cjs tests/skill2-ult-evolution.test.cjs，共 95 項，91 通過／4 既有失敗；將 HEAD skills2.js 注入同一 system 測試確認仍有相同 4 項（突刺規格、迴身四方斬、神速飛刀、飛刀回跳），無新增失敗。疾風相關定向測試 12/12 通過。Excel／CSV 目標格逐值一致，config_tables --apply Skills2 無語意差異；Build、git diff --check 通過。
- Commit：本紀錄所在提交。無未完成實作，可供審查合併，未合併／推送。未遊戲內目視驗收，建議觀察每段爆散重新選敵及對應特效次數。

## Claude｜VFX 啟動器改成 Node：一律先關掉本副本的舊伺服器再重開，.bat 只留 ASCII（VFX-LAUNCHER-20260917）

- Owner：Claude；Done。使用者回報：(1) 啟動器判定伺服器過期那一段，說明文字被 cmd 拆碎當成指令執行（「'面上看不出原因。' is not recognized」），其中 `echo     taskkill /F /PID 那個PID` 的 echo 被吃掉、taskkill 真的跑了；(2) 叫使用者去關舊伺服器的視窗，但那台沒有視窗或已經當掉關不了。使用者提議：開新的時候自動關掉舊的再重開。
- 修改：新增 tools/vfx/launch-editor.cjs——找出本副本所有編輯器伺服器（有回應的看 /__whoami，當掉的看 node 命令列），有回應的走 POST /__shutdown，沒回應或關不掉的強制結束（連同伺服器視窗；強制結束前重新確認 PID，避免 PID 被重用時誤殺），再開新的伺服器視窗、等就緒、開頁面。啟動VFX編輯器.bat 與 tools/vfx/editor_server_window.bat 改成整個檔案純 ASCII（中文訊息由 Node 印；參數以 "%~1" 轉交；伺服器改用絕對路徑啟動，當掉的那台才認得出來）。editor-server.cjs 匯出啟動器要讀的常數，並在 VFX_EDITOR_WINDOW=1 時自己印視窗說明。W7／W7B／W8 改寫並從 vfx-editor-save.test.cjs 搬到新的 tests/vfx-editor-launcher.test.cjs，另加 LAUNCH-1～7。
- 驗證：launcher 測試 10 項全過；編輯器相關 386 項，失敗僅 CAP-2、SAFETY-3、HISTORY-42 三項既有基線。Windows 實機四個情境：沒有伺服器→直接開；已有伺服器→正常關閉後換新 PID；另有一台卡死（/__whoami 不回應）的伺服器→靠命令列認出並強制結束；直接執行 .bat（--no-browser）→沒有任何「is not recognized」。事後確認沒有殘留行程或視窗。
- 待確認：使用者需 merge ai/claude 才會在自己的副本生效（伺服器程式有改，但新啟動器會自動重開，不必手動重啟）。其餘含中文 echo 的 .bat（啟動數值模擬器.bat、tools/sim_server_window.bat、啟動測試服.bat、套用參數.bat）有同樣風險，已開獨立任務。

## Codex｜疾風破固定落點範圍連擊（GALE-AREA-20260917）

- Owner：Codex；Done。取代死亡轉移：死亡後留在原座標完成剩餘段數；第一階每段依 Excel 作用範圍（半徑 10 米）傷害全部敵人，各自完整傷害。範圍為 Skills2 配置同步、技能／測試、快取與本紀錄；前置依賴完成，衝突預檢乾淨。
- Excel 以原生 Excel COM 更新兩個技能說明欄，保留工作簿格式與驗證功能，正常儲存並重新開啟；無 XML 改寫。既有同步器將 Excel 設定（含使用者修改）同步 CSV／JS；同步器會讀取所有表，但其他表無語意差異。傷害與 VFX 共用固定座標／半徑；月牙保留原本均分及千鳥規則。
- 測試：疾風逐段／死亡固定落點／空場播放／後續進入範圍 2/2；超神、VFX 繼承、Excel／CSV／JS 一致性 64/64；build_check 359 檔通過；diff --check 通過。未遊戲目視驗證，既有其他技能 system 測試失敗見前任務。
- 檢查未修改：battlefield 範圍判定、vfx-runtime 區域播放。素材無本次變更，使用者 Preset／layout 保留未提交。Commit 為本紀錄所在提交，未合併／推送；可供 Review，建議重新整理後在多敵場景確認。候選敵群仍為本次施放時的敵群。

## Codex｜疾風破死亡轉移連擊（GALE-RETARGET-20260917）

- Owner：Codex；Done。使用者要求目標死亡後剩餘連擊轉向下一個敵人；沿用施法射程與連擊間隔，傷害／特效共同切換目標。前置依賴完成，衝突預檢乾淨。
- 範圍：js/skills2.js、主執行緒／Worker 快取、tests/skill2-system.test.cjs、本紀錄。保留使用者既有配置與素材修改；驗證存活不換目標、死亡接續、無有效目標與射程限制。
- 驗證：疾風定向測試 2/2、超神與特效繼承 62/62 通過；build_check 359 檔通過，diff --check 通過。既有逐段測試改讀表定間隔／月牙數值，避免鎖死舊配置。完整 system 測試另有突刺／迴身四方斬／飛刀既有失敗，移除本次轉移邏輯的記憶體基線仍重現，未改動這些技能。
- 未修改但檢查：選敵／射程 helper、配置表、Preset。無新素材，既有使用者表格及素材修改保留未提交。Commit 為本紀錄所在提交，未合併／推送。限制：候選為本次施放的敵群；尚未遊戲目視驗證。建議以連續擊殺弱敵確認換目標，可供 Review。

## Codex｜純演出特效尺寸所見即所得規則（VFX-VISUAL-SIZE-RULE-20260916）

- Owner：Codex；Done（規範更新）。使用者要求文檔、編輯器與遊戲的尺寸一致，並明確限定不牽涉實際傷害計算的純演出。新增 AI_RULES.md 8.3.2，更新 VFX_SIZE_STANDARD.md，保留涉及傷害／碰撞／彈體／場域範圍的權威尺寸換算。
- 修改：AI_RULES.md、docs/vfx/VFX_SIZE_STANDARD.md、本紀錄。未修改但檢查：vfx-runtime／core／tower、編輯器預覽與群組縮放、尺寸標準化工具、hit-gale-burst、疾風斬事件與 Runtime 測試。
- 區分純演出尺寸與「技能本體／附加效果」歸屬，不以檔名前綴自動分類。212% 編輯器縮放屬檢視倍率，驗收須同世界尺度比較。
- 衝突預檢乾淨，git diff --check 通過；純文件變更無需 Build／程式測試。Commit 為本紀錄所在提交，規範可合併，未合併／推送。尚未完成：既有 Runtime／Preset 的尺寸行為遷移，本次不宣稱已修正實際播放大小；後續須按用途盤點並驗證三端尺寸。

## Codex｜修復 Skills2 Excel 開啟空白（SKILLS2-REPAIR-20260916）

- Owner：Codex；Done。使用者要求修復 Skills2.xlsx，來源為前次手工 XML 合併造成的 Excel 修復／空白問題。修改 Skills2.xlsx 與本紀錄；保留 CSV／JS／Preset 既有設定。
- 以受支援試算表 API 匯入並完整重新匯出，不直接修改封裝 XML；保存原始損壞版本。驗證全表值、用途下拉與中文說明、實際 Microsoft Excel 開啟；衝突預檢乾淨。
- 使用 artifact-tool 整本匯出，再由 Microsoft Excel COM 正常模式開啟、逐格比對、SaveAs 成全新 xlsx，覆回正式路徑後再次正常開啟。未使用 Excel repair／extract 模式。匯入工具把原本三個空共享字串誤讀為「946」，已依既有 CSV 透過試算表 API 還原 AB82／AC92／AA142 空值，不修改 CSV 或 JS。
- 驗證：Excel 正常開啟及逐格比對 Skills2 231 列（含表頭）×37 欄、欄位定義 97 列；AK20 值與用途下拉均正常。`node --test tests/skills2-vfx-usage.test.cjs` 2/2 通過，Excel／CSV／JS 完整語意一致；`git diff --check` 通過。資料檔修復無程式變更，無需 Build。
- 未修改但檢查：config/CSV/Skills2.csv、js/skills2.js、讀表工具與正式回歸測試。原始損壞檔保存在忽略目錄 tmp/skills2-repair/damaged.xlsx，僅作診斷備份；其餘臨時輸出清除。岩甲修改保留未提交。Commit 為本紀錄所在提交，可合併，未合併／推送；無未完成修復項目。

## Codex｜禁止手工修改 Excel XML（EXCEL-NO-XML-20260916）

- Owner：Codex；Done。使用者回報 Skills2.xlsx 再次出現 Excel 修復提示，要求寫入規範。AI_RULES.md 新增第 8.5 節，禁止手工 XML 拼接、節點修改、ZIP 重打包與工具輸出 XML 搬回原檔，禁止以「保留格式」作例外。
- 修改：AI_RULES.md、本紀錄。未修改但檢查：Skills2.xlsx 工作表封裝、先前交付紀錄、Git 狀態。衝突預檢乾淨；文件檢查與 git diff --check 通過。純文件修改，無需程式測試／Build。
- 明確更正：VFX-USAGE-20260916 的自動化測試結果仍成立，但 Excel 開啟相容性已由使用者實測判定失敗；先前「可供合併」結論不適用於該 Excel 檔。XML 可解析並不代表 Excel 可正常開啟。
- 本次依要求只新增規範，尚未修復 Skills2.xlsx，需另以受支援試算表工具重新輸出並實際 Excel 驗收。岩甲修改保留不提交。Commit 為本紀錄所在提交，規範變更可合併，未合併／推送。

## Codex｜新增特效用途特效欄位（VFX-USAGE-20260916）

- Owner：Codex；Done。使用者要求新增用途欄並指定名稱「特效用途特效」，置頂中文說明須交代用途。Skills2 AK 欄以「技能本體／附加效果」下拉區分特效歸屬，留白相容技能本體；附加效果由明確指定該列的事件播放，空角色不繼承本體。
- 範圍：Skills2 Excel／CSV／JS、config_tables、角色解析、主執行緒／Worker 快取、正式測試與 Runtime 文件、本紀錄。逐風者標為附加效果，移除先前兩處技能特判；不改傷害、觸發條件、存檔與 Worker 協議。使用者目前新 Preset／layout 及配置一併保留納入交付。
- 前置依賴完成，衝突預檢乾淨。驗證：表格讀寫往返、錯字拒絕、繼承與獨立事件、迴旋斬／超神回歸、Excel 前後渲染與內容比對、Build；完成後供使用者審查合併。
- 完成驗證：`node --test tests/skills2-vfx-usage.test.cjs tests/skill-vfx-inheritance.test.cjs tests/cleave-rework.test.cjs tests/skill2-ult-evolution.test.cjs tests/vfx-preset-layout.test.cjs tests/vfx-preset-usage.test.cjs` 101/101；後續說明文字調整再跑表格測試 2/2。`node tools/build_check.cjs` 359 檔通過；`node tools/config_tables.cjs --apply Skills2` 語意差異 0；`node tools/vfx/export-assets.cjs --check` 最新；新 Preset Core 驗證通過。
- Excel 以 artifact-tool 編輯／渲染，將新欄與說明定點併回原封裝保留既有格式、共享字串及其他 ZIP 項。逐格比對既有 Skills2 值全數不變，只新增 AK1／AK20；「欄位定義」最上方新增七條中文說明與空行，修正兩條舊的留白／退回畫法說明。凍結窗格保留，篩選涵蓋新欄。
- 未修改但檢查：Runtime 場域角色派送、既有素材引用與素材庫。沒有新貼圖，素材庫乾淨無需空提交。使用者同時調整的 aura-rockarmor-stone.json 保留不提交；其餘本次相關表格與新 Preset／layout 納入。Commit 為本紀錄所在提交，未合併／推送，可供合併。無未完成實作；未遊戲內目視驗證，建議刷新後確認逐風者效果。

## Codex｜逐風者場域不在迴旋斬起手播放（WINDCHASER-CAST-VFX-20260916）

- Owner：Codex；Done。使用者更換地板 Preset 後發現玩家中心先出現放大的相同特效。根因為迴旋斬起手套用超神欄位，帶入命中後場域。
- 範圍：skills2 起手角色選取、快取、迴旋斬與繼承測試、本紀錄。逐風者啟用時，本體只讀一般階級特效，命中場域仍讀逐風者配置。無傷害與配置變更；使用者既有 Excel／CSV／JS 配置和新 Preset／layout 保留不納入本次程式提交。
- 前置依賴已完成，衝突預檢乾淨；驗證真實起手與命中場域事件、連斬、超神、Build；完成後供使用者合併。
- 驗證：`node --test tests/cleave-rework.test.cjs tests/skill-vfx-inheritance.test.cjs tests/skill2-ult-evolution.test.cjs` 74/74；`node tools/build_check.cjs` 358 檔通過；`git diff --check` 通過。新增近戰／飛行兩路真實起手、追加波與命中場域位置／半徑驗證；既有逐風者測試固定測試配置，避免使用者換 Preset 造成無關失敗。
- 未修改但檢查：使用者 CSV／Preset、Runtime 場域派送；無素材變更。Commit 為本紀錄所在提交，可合併，未合併／推送。使用者原有五個檔案變更留在工作區；未遊戲內目視驗證。使用者另提出觸發用途配置設計，已說明它與 ground／field 圖層分類不同，本次未擴充資料格式。

## Codex｜逐風者龍捲風排除繼承刀光（WINDCHASER-VFX-20260916）

- Owner：Codex；Done。使用者要求修正逐風者地面額外出現迴旋斬刀光。龍捲風事件只派送配置解析出的 ground 角色，不變更全域繼承規則與迴旋斬本體。
- 允許修改：js/skills2.js、主執行緒／Worker 快取、tests/skill-vfx-inheritance.test.cjs、本紀錄；禁止修改技能數值、配置表與素材。前置依賴已完成，衝突預檢乾淨。
- 驗證：`node --test tests/skill-vfx-inheritance.test.cjs tests/cleave-rework.test.cjs tests/skill2-ult-evolution.test.cjs` 73/73 通過；涵蓋實際場域事件、風系傷害參數、空場景／空配置與傳奇借用。`node tools/build_check.cjs` 358 檔通過；`git diff --check` 通過。
- 未修改但檢查：js/vfx-runtime.js、ground-tornado-wind／迴旋斬 Preset、Skills2 CSV。無素材變更，不需素材庫提交。Commit 為本紀錄所在提交；未合併／推送，可供合併。無未完成程式項目；尚未遊戲內目視驗證，建議重新整理後確認地面刀光已消除。

## Codex｜彈射換段保留尾跡（KNIFE-TAIL-LIFETIME-20260916）

- Owner：Codex；Done。使用者要求刀身換段後舊粒子自然消退並注意效能。Core 新增 finish／clearTails：移除刀身、停發射與子粒子，保留既有粒子及出生座標；最多剩餘 3 個實際秒，額外淡出乘區避免使用者 alpha 尾端非零造成硬切。重複 finish 不續命。普通飛刀到達、追魂刃飛行／環繞切換與自然到期沿用此路徑；換場 reset／clear 與死亡 clearFields 清空尾跡。無傷害／判定變更。
- 效能：不複製粒子，不新增 ticker／timer；尾跡沿既有更新／回收池執行。獨立上限 64 段／1,200 顆殘留粒子，超量先回收最舊段，不影響飛行中的刀。先行壓測 10 支金刀每 0.2 秒換段，無獨立粒子上限時 0.175→1.872 ms／幀、峰值 3,011 粒子，已向使用者提早回報後加上保護。最後同場景交錯 5 輪、暖機 300 幀、計時 600 幀：立即清除中位 0.180 ms／幀，保留尾跡 0.764 ms／幀，峰值 1,578 顆（含飛行中）；停止後 3 秒 activeParticles／activeEffects 均 0。Node 無繪圖後端數字不代表 GPU／實機 FPS。
- 修改：js/vfx-core.js、js/vfx-runtime.js、index.html、tools/vfx/editor/index.html、tests/vfx-core.test.cjs、tests/knife-flight.test.cjs、docs/vfx/VFX_CORE_AND_PRESET_SCHEMA.md、本紀錄。預檢無衝突，遊戲與編輯器 Core 快取同步。未修改但檢查：js/skills2.js、飛刀 Preset、追魂刃測試；無素材或表格變更。
- 驗證：node --test tests/vfx-core.test.cjs tests/knife-flight.test.cjs tests/soulhunter.test.cjs，155 項通過；驗證換段保留、刀身立即隱藏、不再生成粒子、子發射抑制、自然消退、慢速動畫期限、重複結束、粒子／段數上限、既有飛刀傷害時序與重置清理。Build 與 git diff --check 通過。
- Commit 為本紀錄所在提交，無未完成程式項目，可供審查合併；未合併／推送。尚未遊戲內 GPU／目視驗收，建議大量彈射情境觀察 FPS；極端超量時允許最舊尾跡提早消失，以限制成本。

## Codex｜提交使用者飛刀特效調整（KNIFE-VFX-COMMIT-20260916）

- Owner：Codex；Done。依使用者要求提交普通／金色飛刀 Preset 與 layout 的現有調整，包含刀身尺寸、配色、光暈、金色拖尾壽命／密度／阻力與額外光暈層。普通刀 layout 經 git add 正規化後若無內容差異則不產生提交差異。
- 修改：vfx/presets/proj-knife.json、vfx/presets/proj-knife-gold.json、vfx/layouts/proj-knife-gold.json；js/vfx-runtime.js 的資料快取版本與 index.html 載入版本同步更新；本紀錄。未修改但檢查：普通刀 layout、素材庫狀態、引用的既有素材。
- 驗證：node --test tests/soulhunter.test.cjs tests/knife-flight.test.cjs tests/vfx-preset-layout.test.cjs tests/vfx-preset-usage.test.cjs，41/41 通過；node tools/vfx/export-assets.cjs --check 已是最新；git diff --check 通過。素材庫乾淨且無素材內容變更，無需建立空素材提交。
- Commit：本紀錄所在提交，未合併／推送，可供使用者接著合併 Claude 分支；無未完成項目。使用者已自行調整外觀，本次保留其數值，未另做遊戲內目視驗收。

## Codex｜全域世界座標粒子（WORLD-PARTICLES-20260916）

- Owner：Codex；Done。使用者要求所有粒子保留經過位置，飛行轉彎形成歷史拖尾，並要求提早回報效能影響。盤點正式 Preset 共 290 粒子層，12 層明確 worldSpace:true，無 false；Core 預設改 true，因此現有與新建粒子層均生效，無需改寫素材庫／Preset。
- 修改：js/vfx-core.js、index.html、tests/vfx-core.test.cjs、docs/vfx/VFX_CORE_AND_PRESET_SCHEMA.md、本紀錄；tools/vfx/editor/index.html 第 249 行 Core 快取。預檢發現 ai/claude 的 e883077 改同檔第 264 行 editor.js 快取，使用者已確認允許，只修改 Core 快取，不碰對方 editor.js 的載入版本。
- 行為：粒子保留出生座標與朝向；子發射器沿用母粒子的出生座標，避免父特效移動後煙霧跳位。出生座標物件隨既有粒子池重用，降低 GC 配置；粒子數、壽命、發射率與預算均不增加。保留 API 的明確 worldSpace:false 相容選項，目前正式 Preset 無使用者。
- 驗證：node --test tests/vfx-core.test.cjs tests/soulhunter.test.cjs tests/knife-flight.test.cjs，150/150；涵蓋移動、旋轉、速度與尾長、子粒子出生位置、粒子池重用與局部模式。node --test tests/vfx-performance.test.cjs tests/vfx-runtime.test.cjs，95 項中 89 通過／6 既有 Runtime 失敗（雷落、龍捲兩項、泥沼、連鎖、虛空斬），與前次已知基線相同。
- 效能量測：Node 無繪圖後端，10 個移動發射器、1,180 顆活躍粒子、暖機 300 幀後計時 1,200 幀、交錯 7 輪中位數：局部 0.136 ms／幀、世界 0.152 ms／幀，增量約 0.016 ms。停止後 activeParticles=0。上限維持 1,200，粒子池上限維持 512；數字不代表 GPU／實機 FPS，尚需遊戲內目視與幀率觀察。
- 未修改但檢查：js/vfx-runtime.js、正式 Preset、tools/vfx/editor/editor.js（共用 Core）。使用者持續編輯的普通／金刀 Preset 與金刀 layout 保留，不納入本次提交，本次無素材變更。
- Build：node tools/build_check.cjs，357 檔通過；git diff --check 通過。Commit 為本紀錄所在提交，可供審查合併；未合併／推送。未完成：無程式待辦，實機 GPU 與畫面觀感尚未驗收，建議刷新遊戲與編輯器後觀察大量特效場景。

## Codex｜追魂刃待機環繞半徑（SOULHUNTER-ORBIT-20260916）

- Owner：Codex；Done。依使用者要求將待機環繞半徑由 3 米調為 12 米；沿用 SG_SOULHUNTER_ORBIT_M 與事件 orbitR，返回位置、再出發點及 Runtime 畫面共用半徑。前置追魂刃改造已完成，預檢無衝突。
- 範圍：js/skills2.js、js/worker/sim.worker.js、js/bridge.js、index.html、tests/soulhunter.test.cjs、本紀錄。既有金刀 Preset／layout 工作區修改保留，不納入本次提交。
- 未修改但檢查：js/vfx-runtime.js，已直接使用事件 orbitR；Excel／CSV 沒有待機半徑配置，沿用既有程式常數，無需改表或素材。快取版本已同步。
- 驗證：node --test tests/soulhunter.test.cjs tests/knife-flight.test.cjs，17/17 通過；node tools/build_check.cjs 通過；git diff --check 通過。既有測試改為驗證 120 單位半徑，並依實際到達時間檢查重新追擊傷害。
- Commit：本紀錄所在提交；無未完成實作，可供合併，未合併／推送。尚未遊戲內目視驗證，建議重新整理確認環繞距離。

## Codex｜無限追魂刃持續追擊與環繞（SOULHUNTER-20260916）

- Owner：Codex；Done。使用者確認無敵人環繞待機、單敵飛離折返。每次施放額外一支金刀，追擊玩家周圍 40 米敵人，生成後最多 10 秒；每次彈射傷害累加，配置基值 4%、每級 +0.4%（沿用全專案 base + per × level 公式）。首擊不吃彈射增傷；返回／環繞不造成命中；途中敵人死亡仍先抵達再尋敵。
- 修正金刀數量假象：普通刀及其彈射不再套用追魂刃金色特效，仍讀普通階級配置；其他超神繼承不變。每支追魂刃共用唯一身份與到期時間，飛行／返回／環繞互相替換，無目標時跟隨玩家環繞，出現敵人再追擊；單敵反覆折返。死亡與換場清除，命中仍由 Worker 到達時判定。
- 修改：config/Excel/Skills2.xlsx（K31、AE31、AH31、AI31）、config/CSV/Skills2.csv、js/skills2.js、js/vfx-runtime.js、js/worker/protocol.js、js/worker/sim.worker.js、js/bridge.js、index.html、tests/soulhunter.test.cjs、tests/skill2-ult-evolution.test.cjs、tests/worker-protocol.test.cjs、docs/WORKER_PROTOCOL.md、本紀錄。協議升 v33 並同步載入快取。未修改但檢查：js/worker/shim.js、js/battlefield.js、普通／金色刀 Preset、特效繼承與迴旋斬測試。沒有新增素材／Preset 或表外特效來源。
- 表格：artifact-tool 匯入、修改、渲染前後預覽後，保留原 XLSX 封裝內容僅替換四個儲存格。Excel 關閉前曾鎖定，待使用者關閉後成功同步；對 HEAD 比對只有四格值改動，其餘 Excel 儲存時的封裝／繪圖資訊保留。四格與 CSV、artifact 輸出逐值一致，config_tables --apply Skills2 dry-run 為 0 語意差異。
- 驗證：node --test tests/soulhunter.test.cjs tests/knife-flight.test.cjs tests/worker-protocol.test.cjs tests/skill-vfx-inheritance.test.cjs tests/skill2-knife-range.test.cjs，32/32；node --test tests/cleave-rework.test.cjs，12/12；skill2-ult-evolution 全 55 項通過。涵蓋實際多刀施放只有一支金刀、逐跳累加傷害、單敵持續折返、返回待機再出發、40 米排除、各次施放獨立期限、到期途中不命中、玩家死亡清理、Runtime 同身份替換與空目標返回。
- 廣域回歸：node --test tests/skill2-ult-evolution.test.cjs tests/vfx-runtime.test.cjs tests/skill2-vfx.test.cjs，共 180 項，165 通過／15 既有失敗。沿用前次基線注入再跑 VFX 125 項，仍為 110 通過／相同 15 失敗，無新增失敗。node tools/build_check.cjs：357 檔通過；git diff --check 通過。
- Commit：本紀錄所在提交；未合併、未推送。已完成程式／資料與自動化驗證，未做遊戲內目視驗收；可供審查合併。建議重新整理遊戲確認追魂刃折返與待機觀感。既有 VFX 測試失敗不在本次範圍。

## Codex｜迴旋斬逐刀取當前發射位置（CLEAVE-LAUNCH-ORIGIN-20260916）

- Owner：Codex；Done。依使用者補充：不是持續跟隨玩家，而是每次斬出時從玩家當下位置發射，發射後保持該刀自己的擴散中心。原本一次施放就固定所有追加刀波的圓心與延遲特效，導致玩家移動後仍在原地連斬。
- 完成：追加刀波在模擬佇列實際起飛時取 bfPlayerPos，同時設定傷害原點並發送無額外延遲的特效事件；動畫與傷害共用同一中心、完整擴散時長。首刀維持施放位置，已發射刀波不跟隨玩家；逐刀間隔維持 0.3 秒。傳奇旋風與無座標高塔在每刀開始時查詢當前敵群。沿用既有事件欄位，無協議變更。
- 修改：js/skills2.js、js/worker/sim.worker.js／js/bridge.js／index.html 快取、tests/cleave-rework.test.cjs、本紀錄。預檢乾淨。未修改但檢查：js/vfx-runtime.js（沿事件 area 固定中心）、技能配置、正式三色 Preset 與傳奇／超神測試。無素材與配置數值變更，不需 Excel／CSV 或素材庫提交。
- 驗證：node --test tests/cleave-rework.test.cjs tests/knife-flight.test.cjs，22/22；skill2-system 與 skill2-ult-evolution 的迴旋斬／虛空碎裂／逐風者／天霸風神定向測試 6/6；node tools/build_check.cjs 356 檔通過；git diff --check 通過。新增超神七連斬逐刀改變玩家座標、舊刀圓心固定、正式 Runtime 發射後不追蹤，以及新舊位置命中範圍的驗證。
- Commit 為本紀錄所在提交，未合併／未推送；無未完成實作，可供合併。尚未遊戲內目視驗證，建議重新整理後確認移動連斬觀感。

## Codex｜飛刀逐段到達命中與死亡目標續飛（KNIFE-FLIGHT-20260916）

- Owner：Codex；Done。使用者回報只見受擊、不見彈射，並要求目標途中死亡仍飛到最後座標再找下一跳，無目標才消失。根因為即時結算傷害、死亡起點被 sgEmitVfx 過濾使 travelMs 索引錯位，以及彈射時間錯用玩家到目標距離。
- 完成：普通刀、彈射、分裂刃與追魂刃共用既有飛行物佇列；每段到達才命中並選下一跳，起飛不預排受擊。死亡起點以座標保留；飛行途中目標死亡不取消飛行、不補傷害。按每段路徑長度／表定速度算時間，曲線控制點經 Worker 傳遞；動畫壽命同步延長。暴雨梨花沿飛行曲線掃描、每段每敵一次；保留彈射範圍、次數、分裂、收割、爆擊冷卻與高塔退化。死亡／換場沿既有佇列回收。
- 修改：js/skills2.js、js/vfx-runtime.js、js/worker/protocol.js（v32）、js/worker/sim.worker.js、js/bridge.js、index.html；tests/knife-flight.test.cjs、skill2-knife-range、skill2-ult-evolution、skill2-vfx、worker-protocol；docs/WORKER_PROTOCOL.md 與本紀錄。預檢乾淨。未修改但檢查：battlefield、formula、battle-renderer、vfx、Worker shim、正式飛刀 Preset、素材庫與技能配置。配置數值與素材不變，無 Excel／CSV 差異，素材庫乾淨無需新 Commit。使用者暖色刀波未提交修改保留、不納入本次提交。
- 驗證：node --test tests/knife-flight.test.cjs tests/skill2-knife-range.test.cjs tests/cleave-rework.test.cjs tests/worker-protocol.test.cjs tests/skills2-flight-speed.test.cjs tests/vfx-preset-usage.test.cjs：51/51。skill2-ult-evolution 的飛刀／暴雨梨花／死亡收割者／無限追魂刃／Soulhunter 定向測試 8/8。新增測試直接驅動模擬、Worker shim 與正式 Runtime，驗證死亡續飛、無目標停止、到達才傷害、路徑傷害、中點幾何與長時間刀身存活。
- 擴大回歸：skill2-vfx 與 vfx-runtime 共 125 項，110 通過、15 失敗；將 HEAD 原始程式與原測試注入後同樣 15 項失敗，涵蓋火球／火龍捲／迴旋斬／冰系舊斷言及既有 Runtime 問題，無新增失敗。飛刀舊即時排程字串斷言改由實際逐段模擬測試覆蓋，沒有放寬其他技能斷言。Build 354 檔與 git diff --check 通過。
- Commit：本紀錄所在提交；未合併／未推送。未做遊戲內目視驗證；無未完成實作，可供審查合併，建議重新整理遊戲確認實際彈射觀感。基線驗證暫存留在忽略目錄 tmp/knife-validation，不納入提交。

## Codex｜藍色與三色刀波沿用暖色圓環外形（CLEAVE-WARM-SHAPE-20260916）

- Owner：Codex；Done。依使用者圖 2 的目前暖色 Preset，套用 12 層 scale 比例並以原外框尺寸等比正規化至 slash-cleave-ring-blue 與 proj-cleave-ring-tricolor，消除非等比拉伸。逐欄比對確認只有 scale 改變，顏色、透明度、旋轉、時序、sizing 與飛行規則全部保留。
- 修改：上述兩份 Preset、js/vfx-runtime.js 資料快取、index.html 快取及本紀錄；預檢乾淨。未修改但檢查：暖色 Preset、製作工具與渲染器。使用者原有暖色 scale 修改保留在工作區，不混入提交。既有素材不變，素材庫無需新 Commit。
- 驗證：非 scale 欄位深度比對；cleave-rework、vfx-preset-layout、vfx-preset-usage 測試及 Build；Core 預覽目視確認。未遊戲內目視驗證。Commit 為本紀錄所在提交；可供合併，未合併／未推送。

## Codex｜核准硬邊氣旋刀光（CLEAVE-SHARP-CYCLONE-20260916）

- Owner：Codex；Done。使用者看過三份完成圖後授權「接入並 commit」。使用者核准加厚約三倍、帶不規則尖端與分離刀痕的單色素材；依先前要求，同步暖色、藍色、三色三份 Preset。保留三組原始旋轉、尺寸與延遲曲線，減低光暈；不更動技能規則與 0.3 秒間隔。
- 修改：三份 Preset、cleave-renew（保留已核准編輯結果，不在重跑時覆寫素材／亮度）、asset-index、shipped-assets、正式匯出 PNG、Runtime 快取、cleave-rework 測試、本紀錄。素材庫 codex-authored/cleave/sharp-cyclone.png 與 SOURCE.md 已提交 fa413a4；原始與匯出 SHA256 均為 1877cb744b4d05c9792376b9d8c08cc8f87aaae09dad88675031f85ac3e747b3。
- 驗證：cleave-rework、vfx-preset-layout、vfx-preset-usage 共 34/34；Build 353 檔通過。三份 Core 六幀預覽已檢查；素材經正式 export-assets 匯出。未遊戲內目視驗證。未修改但檢查：Skills2 Excel／CSV／JS 引用、layout、素材解析器、掃描器、匯出工具及 Antigravity 提交。
- 衝突確認：Antigravity b59de4f 修改 index.html 115–142 行裝備面板；本次只修改第 860 行 vfx-runtime.js 版本 1.0.91 → 1.0.92，內容不重疊。已告知使用者並取得接入與提交授權，其餘檔案預檢乾淨。遊戲 Commit 為本紀錄所在提交；素材庫 Commit fa413a4。無未完成實作，可供審查合併；建議重新整理遊戲確認戰場觀感，未合併／未推送。

## Codex｜旋斬修正版正式引用確認（CLEAVE-SPIN-LIVE-20260916）

- Owner：Codex；Done。使用者確認旋轉刀光預覽後要求接入。核對實際配置，發現第六階目前引用 slash-cleave-ring-blue，而非 proj-cleave-ring-blue；將相同尺寸基準與疊加光暈修正套到正式引用檔，第七階既有 tricolor 引用保持生效。保留原本旋轉整圈造型及 0.3 秒間隔。
- 修改：vfx/presets/slash-cleave-ring-blue.json、cleave-renew 製作工具、Runtime／index 快取、cleave-rework 測試、本紀錄。未修改但檢查：Skills2 CSV／JS 實際引用、第七階 Preset、Worker 間隔、layout。預檢乾淨，不變更配置表與技能規則，無素材變動。
- 驗證：cleave-rework、vfx-preset-layout、vfx-preset-usage 共 33/33；新增從第六階實際施放事件追到 Preset 的驗證，避免只測未使用的飛行檔。未遊戲內目視驗證；Commit 為本紀錄所在提交，未合併／未推送，可供審查合併。

## Codex｜還原原本旋轉刀光並校正尺寸（CLEAVE-SPIN-FIT-20260916）

- Owner：Codex；Done。使用者否定上一版小刀弧拼環，要求保留原本快速旋轉一圈的特效。還原藍色／三色各 12 層刀弧與旋轉、延遲曲線；校正 authored.radius 以反映造型尺寸，降低疊加光暈，避免造型放大後又被距離倍率放大。維持已確認的 0.3 秒逐道間隔。
- 修改：兩份 proj-cleave-ring Preset／layout、cleave-renew 製作工具、Runtime 與 index 快取、cleave-rework 測試、本紀錄及 VFX_RUNTIME_ADAPTER。未修改但檢查：skills2 排程、原本旋斬資料、Core 尺寸處理、素材庫。衝突預檢乾淨，無素材變動。
- 驗證：cleave-rework、vfx-preset-layout、vfx-preset-usage 共 32/32；Core 動態預覽已目視檢查（非遊戲實錄）。驗證原始旋轉整圈、12 層結構、半徑尺寸換算、0.3 秒排程與既有命中行為。未做遊戲內目視驗證。Commit 為本紀錄所在提交，未合併／未推送，可供使用者審查；動態預覽 cleave-spin-fit.gif 保留於 Codex visualizations，原始中間檔已移除。

## Codex｜震碎斬外移刀波與連斬間隔（CLEAVE-WAVEFRONT-20260916）

- Owner：Codex；Done。使用者以兩張遊戲截圖指出「向外飛出」不能把整張刀光放大填滿，並指定各道間隔 0.3 秒。改用既有 slash_03 刀弧分段，位置隨表定半徑曲線向外走；成形後徑向厚度固定，中央留空。藍色與三色飛行 Preset 同步，保持原技能引用。
- 修改：tools/vfx/authoring/author/cleave-renew.cjs；vfx/presets 與 vfx/layouts 的 proj-cleave-ring-blue.json、proj-cleave-ring-tricolor.json；js/skills2.js（迴旋斬專用間隔，傷害／視覺共用）；js/vfx-runtime.js、js/bridge.js、js/worker/sim.worker.js、index.html 快取；tests/cleave-rework.test.cjs、tests/skill2-system.test.cjs；docs/vfx/VFX_RUNTIME_ADAPTER.md 與本紀錄。衝突預檢乾淨。
- 未修改但檢查：Skills2 CSV 與生成配置、近戰暖色／藍色 Preset、Core 位移與分軸曲線、Pixi backend、preset-render、素材索引、素材庫。沿用既有素材，素材庫乾淨；沒有新圖檔或素材 Commit。未改技能傷害、距離或單道命中次數。Worker 事件格式不變，僅更新快取。
- 驗證：node --test tests/cleave-rework.test.cjs tests/vfx-preset-layout.test.cjs tests/vfx-preset-usage.test.cjs 32/32；技能／超神定向測試 15/15（新增中央無殘留傷害案例另於前述套件通過）；node tools/build_check.cjs 353 檔通過；node tools/vfx/export-assets.cjs --check 最新；git diff --check 通過。檢查正式 Runtime 在飛行中點的前緣位置對齊模擬曲線、後半段厚度不再長大、0.3 秒起飛排程與無座標高塔結算。
- Core 動態預覽已檢視：藍／三色並排、每 0.3 秒一波；交付 GIF 保留於 Codex visualizations，原始中間 RGBA 已清除。這是 Core 渲染合成預覽，非遊戲實錄；本輪未做 Pixi 遊戲實機驗證。無其他未完成實作，可供使用者審查合併；Commit 為本紀錄所在提交，未合併／未推送。

## Codex｜三色刀波套用藍色刀波形狀（CLEAVE-TRICOLOR-SHAPE-20260916）

- Owner：Codex；Done。依使用者要求直接覆蓋 proj-cleave-ring-tricolor，保留原本逐層配色，形狀、尺寸、旋轉、擴張與時序完整採用使用者目前修改後的 slash-cleave-ring-blue。12 層逐一比對，除 tint／colorOverLife 外與來源一致；特效 ID 與技能引用不變。
- 修改：vfx/presets/proj-cleave-ring-tricolor.json、tools/vfx/authoring/author/cleave-renew.cjs（重新製作優先保留編輯器調整，三色版依來源合成）、js/vfx-runtime.js 與 index.html 快取、本紀錄。預檢乾淨。未修改但檢查：來源藍色 Preset、既有 layout、Core 驗證器、技能回歸測試與素材庫。
- 驗證：12 層幾何／動態／原配色比對通過；Core validatePreset 通過；node --test tests/cleave-rework.test.cjs tests/vfx-preset-layout.test.cjs tests/vfx-preset-usage.test.cjs 全 31 項通過；Core 六幀渲染已目視檢查。遊戲傷害時長仍由事件控制。未做 Pixi 遊戲內目視驗證；無新素材，素材庫無需提交。
- Commit 為本紀錄所在提交；未合併／未推送，可供審查合併。使用者原有 Excel、藍色及黃紅刀波未提交修改保留，不混入本次提交。預覽作為交付附件保留於 Codex visualizations。

## Codex｜迴旋斬技能與圓形刀波改造（CLEAVE-REWORK-20260916）

- Owner：Codex；Done。使用者確認動態預覽後指示「正式接入」。來源為 Google 技能文檔 2026-09-16 更新版；初階自身周圍半徑 8 米完整圓形，快速劃一圈再向外擴張，六七階已移除四方向描述。
- 完成：名稱「擴增／強化」、20 秒冷卻、傷害與成長、固定額外連斬及小數機率、六階徑向飛行、七階追加三刀與乘法傷害。黃紅／藍／藍黃紫 Preset 正式讀表接線；刀波半徑、時間與傷害判定共用配置曲線，每道每敵只命中一次。保留傳奇與超神掛鉤，無座標高塔逐道結算。
- Excel → CSV → JS 同步；Excel 僅修改 31 個目標儲存格，其餘 ZIP 內容及格式保留。CSV 非本技能的浮點表示保留原文，生成工具確認語意差異 0。沿用專案 base + per × lv 計算慣例。
- 修改檔案：config/Excel/Skills2.xlsx、config/CSV/Skills2.csv、js/skills2.js、js/vfx-runtime.js、js/worker/protocol.js、js/worker/sim.worker.js、js/bridge.js、index.html；tests/cleave-rework.test.cjs、tests/skill2-system.test.cjs、tests/skill2-ult-evolution.test.cjs、tests/skill2-vfx.test.cjs、tests/worker-protocol.test.cjs；tools/vfx/authoring/author/cleave-renew.cjs；vfx/presets 與 vfx/layouts 各四份 cleave-ring 檔案；docs/vfx/VFX_RUNTIME_ADAPTER.md、本紀錄。
- 未修改但檢查：js/battlefield.js、js/vfx-core.js、js/worker/shim.js、tools/config_tables.cjs、tools/xlsx_to_csv.cjs、tools/vfx/export-assets.cjs、素材索引及素材庫。素材判定 SUFFICIENT，沿用既有刀弧貼圖；素材庫乾淨，無新增素材與素材 Commit。修改前衝突預檢乾淨。
- 驗證指令：node --test tests/cleave-rework.test.cjs（7/7）；cleave／迴旋斬／超神／Worker 定向執行上述技能與協議測試（23/23）；node --test tests/vfx-preset-usage.test.cjs（18/18）；node --test tests/vfx-preset-layout.test.cjs（6/6）；node tools/build_check.cjs（353 檔）；node tools/config_tables.cjs --apply Skills2（語意差異 0）；node tools/vfx/export-assets.cjs --check（最新）；git diff --check 通過。
- 擴大回歸：上述技能測試加 skill2-review-fixes、vfx-runtime 共 234 項，218 通過／16 失敗；16 項均在 HEAD 基線重現，涉及疾風斬、突刺、火球、火龍捲、冰系、舊連續座標斷言及既有 Runtime 雷擊／龍捲／熔岩／連鎖／真空旋回。未為其他技能放寬斷言；本技能的舊四向規格測試依使用者新規格更新。
- 視覺驗證：使用者已看過並核准 Core 實際渲染的動態 GIF；正式 Runtime 以真實 Preset 驗證圓心、半徑、時長及回收。本輪未另做遊戲內實機目視驗證，亦不宣稱全套測試全綠。無未完成實作；可供使用者審查合併，建議進遊戲確認實際戰場觀感。
- Commit：本紀錄所在提交。未合併／未推送。保留已交付 GIF 供使用者回看；提交前清除 tmp/cleave-integration 與預覽中間檔的操作被自動政策審核拒絕，暫存產物留在忽略目錄、不納入提交。

## Codex｜技能特效逐欄繼承（SKILL-VFX-INHERIT-20260914）

- Owner：Codex；Done。使用者要求所有技能特效有值必用，空欄逐階向前繼承；已確認超神從一般第七階繼承，不跨互斥超神選項。
- 範圍：skills2/skills 特效事件、vfx-runtime、主執行緒與 Worker 快取、正式回歸測試、VFX Runtime 文件與本紀錄；保留使用者既有配置與素材修改，不改傷害、技能條件、存檔或素材內容。
- 前置依賴已滿足；fetch 後衝突預檢乾淨。驗收逐欄覆寫／跨空階／超神分支、實際事件與 Runtime 播放、命中時序、無特效不退回舊畫法、Build；完成後由使用者審查合併。
- 完成：六欄獨立繼承，空白不清除前階值；超神從第七階继承且不跨選項。突刺改讀實際最高階與已選超神；火狩母體／伴生體保留各自來源階級。Runtime 分別派送已配置角色，移除寒冰箭地板名稱被替換成另一份 preset 的處理；空表也經 Worker 傳遞，禁止回補舊畫法。主執行緒、Worker 與 Preset 資料快取同步。
- 修改檔案：js/skills2.js、js/skills.js、js/vfx-runtime.js、js/bridge.js、js/worker/sim.worker.js、index.html、tests/skill-vfx-inheritance.test.cjs、tests/vfx-runtime.test.cjs、tests/vfx-preset-coverage.test.cjs、docs/vfx/VFX_RUNTIME_ADAPTER.md、本紀錄。使用者既有 Skills2 Excel/CSV/JS 的幻影八方陣藍色接線、藍色 preset/layout 及原突刺擴散圈縮放一併保留提交，未修改素材內容。
- 未修改但檢查：js/worker/shim.js（空角色表傳遞）、js/worker/protocol.js（沿用既有欄位，無協議變更）、tools/config_tables.cjs、VFX 素材索引與匯出工具、技能回歸測試。
- 驗證：node --test tests/skill-vfx-inheritance.test.cjs；Runtime TABLE/FALLBACK/ORBIT-1/RAIN-4/PROFILE-4、CATALOG 與 INHERIT-CAST 定向 14/14；幻影八方陣實際施放每波讀取藍色配置且 Adapter 建立特效。node --test tests/skill2-magic-firehunt.test.cjs 全通過。全 skill2 測試 527 項 485 通過／42 失敗，與 HEAD 程式注入同一測試環境逐項比對一致；Runtime 86 項 80 通過／6 失敗，與原 HEAD 的 83 項 77 通過／6 失敗名稱相同。全技能／超神／傳奇／舊技能 Preset 接手覆蓋與 worker-protocol 測試通過。既有失敗均未放寬斷言；僅依本次明確新規則更新「缺欄回舊畫法／地板填了不播」的舊測試。
- node tools/config_tables.cjs --apply：19 個字面值語意變更 0；node tools/vfx/export-assets.cjs --check：最新；node --test tests/vfx-preset-usage.test.cjs：18/18。素材庫乾淨、無新增或修改素材，無需素材庫 Commit。npm run build 通過，git diff --check 通過。
- 狀態：Done；Commit 為本紀錄所在提交。未實機目視驗證；無全套測試皆綠的宣稱，既有失敗如上述。無其他未完成實作，可供使用者審查合併；未合併／未推送。

## Claude｜VFX 編輯器瀏覽特效（縮圖）、檔名優先與名稱同步、存檔保底根群組、另存新檔 Windows 視窗（VFX-EDITOR-BROWSER-20260914）

- Owner：Claude；Done。使用者需求：(1) 要複製一個特效來改，希望用縮圖找；(2) 在檔案總管改名後重新載入，仍顯示 -copy 的舊名；(3) 載入 Preset 後下拉名稱要與預覽的特效一致；(4) 另存新檔出來的特效沒有群組；(5) 另存新檔不要用網頁輸入框，要跟「載入 Preset」一樣叫 Windows 視窗。
- 修改：瀏覽特效彈窗與伺服器縮圖路由 GET /__thumbs/<id>.png（tools/vfx/preset-thumbs.cjs，離線出圖先量外框再取景，記憶體＋系統暫存資料夾快取，f80a796）；載入時檔名優先於檔案內的 id、分組從舊名字搬來並改名、下拉名稱與網址同步、「已改用檔名」提示不被 refreshDirty 清掉、存檔時沒有群組就自動收成單一根群組（cb23283）；另存新檔改由編輯器伺服器開 Windows 存檔視窗（tools/vfx/save-as-dialog.cjs、POST /__save-as-dialog：WinForms SaveFileDialog 只回傳路徑、不碰檔案，選到既有檔案／不在 vfx\presets 這一層／檔名不能當 id 就跳訊息框並重開，伺服器太舊或非 Windows 時頁面退回輸入框，本紀錄所在提交）；bolt-chain-travel-bluewhite 登記進寫死清單（4d298af，Codex 38f2476 換掉表上的連鎖閃電特效後 USAGE-3 轉紅）；無限火龍根群組名稱改回 preset id（78dbbcc，合併後 LAYOUT-4 轉紅）。
- 原因（群組消失）：當時「載入 Preset」只換 preset、不載分組，接著另存新檔就存出沒有群組的檔案。現在載入會帶分組，存檔另有保底。
- 原因（另存新檔不用瀏覽器的存檔視窗 API）：Chrome 的 showSaveFilePicker 在使用者選到既有檔案時，交回檔案之前就先把它清空（Chromium issue 40717501），而且頁面拿不到路徑、無法確認存在 vfx/presets；由伺服器開 WinForms 視窗，兩個問題都沒有。
- 驗證：另存新檔視窗 SAVEAS-1～6 全過（SAVEAS-4 在 Windows 上以 dryRun 實際跑 PowerShell：冷啟動約 1.2 秒、中文來回無誤）；舊伺服器回 405 時頁面退回輸入框並說明要重啟伺服器；重啟後的新伺服器 text/plain 回 403、壞 JSON 回 400（都不會開視窗）；頁面以攔截的回應走完取消（連點兩次只送一次請求）、伺服器回報問題、選到既有特效、視窗已開著（409）、非 Windows（501，退回輸入框）五種情況，均未寫檔。tests/vfx-*.test.cjs 共 749 項、20 項失敗——CAP-2、SAFETY-3、HISTORY-42 為編輯器既有基線；其餘 17 項（vfx-runtime、vfx-size、vfx-preset-coverage、vfx-tower、vfx-water-tornado、vfx-asset-semantics）以 git archive 抽出改動前的 cc24367 重跑同樣失敗，與本次無關。新增 THUMB-1～7、NAME-1～6 全過；f80a796 單獨抽出重跑，除基線與抽出副本缺根目錄 .bat 造成的 W7／W7B／W8 之外沒有其他失敗。瀏覽器實測（28362，claude 副本）：199 張卡片，縮圖捲到才載入（160×160），搜尋「冰」剩 12 份，框可拉大小，Esc 關閉；在目前這份點「複製成新特效」會叫出另存新檔（對話框已攔截，未寫檔）；用 slash-thrust-scatter 的內容、檔名 slash-thrust-scatter-blue.json 載入：下拉顯示新名、根群組從舊名字搬來並改名（22 層）、「已改用檔名」提示與未存檔同時顯示。別份卡片的「複製成新特效」（換頁後自動另存）只有 THUMB-7 接線測試，未實機點擊，避免真的寫出檔案。
- 待確認：Windows 存檔視窗實際彈到桌面上的樣子（是否浮在最上層、焦點、高 DPI 是否清晰）沒有自動化測試，需使用者按一次「另存新檔」確認；使用者需 merge ai/claude 並重啟編輯器伺服器才看得到（伺服器程式有改）。

## Claude｜VFX 編輯器多選編輯與多選框、特效用途標註、特效來源規則（VFX-EDITOR-MULTISEL-20260914）

- Owner：Claude；Done。使用者需求：(1) Layers 多選後在 Inspector 一起改參數；(2) 預覽區多選時每個物件都要有框、一起縮放；(3) 下拉用途標註漏掉敵方冰片子彈等寫死在程式的特效；(4) 規則「特效只存在兩種來源：配置表填入的、程式碼寫死的（寫死的必須登記），不應存在第三種情況」寫入所有 AI 規範。
- 修改：Inspector 多選批次編輯（multi-edit-model.js，fcfccba）；預覽區多選每層一框、抓任一個一起做相對變形（gizmo-model 多選變形，aa46b2a）；用途標註改為配置表與寫死清單兩邊一起顯示並補登記 12 份（a1da952）；火牆改回清單、拿掉「不算用途」例外段落（0a44bab）；規則寫入 AI_RULES.md §8.4、AGENTS.md、.agents/AGENTS.md、CLAUDE.md §14、.cursorrules、prompts/codex.md、prompts/antigravity.md、docs/AI_WORKFLOW.md、docs/vfx/VFX_AGENT_WORKFLOW.md §9.12（本紀錄所在提交）。
- 驗證：編輯器相關測試失敗僅 CAP-2、SAFETY-3、HISTORY-42 三項，與修改前基線相同；新增 MULTI-1~14、MULTISEL-1~8、USAGE-3B／15 全過。瀏覽器實測（28362，claude 副本）：岩甲術選 6 層改 scale X＝0.8 只動那 6 層且為一筆歷史；混合值欄位清空還原各層原值；slash-thrust-scatter 三個擴散圈拖角把手一起變兩倍、位置不動、Ctrl+Z 全部復原；在多選的框（含把手）上點一下收斂成單選；下拉搜「敵」由 9 筆變 19 筆。
- 待確認：使用者需 merge ai/claude 並重啟編輯器伺服器才看得到（實測 28361 是 codex 副本的伺服器，尚未包含這些修改）；寒冰箭 ground-icearrow-frost 在 Runtime 被轉接為 proj-icearrow-frost（使用者自行確認）；火牆在 js/vfx-runtime.js 的舊處理是否刪除由使用者決定。

## Codex｜岩甲群組縮放同步軌跡（2026-09-14）

- 任務 ROCKARMOR-SCALE；Owner Codex；Done。群組縮放遺漏 Offset 曲線，造成岩石尺寸變了、環繞半徑不變。修改 gizmo-model 群組快照與縮放、編輯器快取及測試；不更動使用者素材與原特效。預檢乾淨。驗收等比／非等比、原快照不變、取消還原、既有 Gizmo 測試及 Build。

- 驗證：實際岩甲全部 Offset 曲線以 2 倍、半倍、X2/Y0.5 驗證；深拷貝快照不變、取消精確還原。Gizmo 測試 50/52，原 HEAD 測試 49/51、同兩項既有失敗（粒子 scale 舊斷言及 backend overlay 禁詞），無新增失敗。Build 347 檔通過、diff --check 通過；未實機 UI 驗證。使用方式：選岩甲根群組再縮放；單層大小調整仍只改該層。無素材變更，可供合併，Commit 為本紀錄所在提交，未推送。

## Codex｜技能升級與功能頁籤點擊延遲（UI-MODAL-20260914）

- Owner：Codex；Done／待使用者原 Chrome 驗收。使用者確認懸停問題已解決，另要求修正技能升級彈窗及功能頁籤點擊後 0.5–1 秒延遲與戰鬥卡頓。
- 範圍：UI CSS、必要 UI 修正與快取、效能對照工具、相關回歸測試及本紀錄；不改遊戲規則、存檔、Worker 協議或素材。已 fetch／預檢乾淨。
- 驗證：實際點擊處理／呈現時序，彈窗與功能頁籤 CSS 分項對照、功能回歸及 Build。後續由使用者原 Chrome 驗收，不自行合併／推送。
- 原因：技能開啟 handler 約 0.6–1.8ms，但 Event Timing 點擊到呈現為 104–400ms；只取消文字陰影仍為 96–424ms，只取消 backdrop-filter 則首次 112ms、後續 16–24ms。全螢幕背景模糊取樣動態戰鬥是主要成本。頁籤原呈現 72–360ms；取消工作區繼承文字陰影降為 40–144ms，再移除卡片框體陰影有額外改善。未修改事件／遊戲邏輯。
- 修改：css/ashen-forge.css 取消 #skill-modal 背景模糊及工作區文字／框體陰影；保留紋理、邊框、選取 outline、鎖定濾鏡與戰鬥效果。index.html 快取升為 1.0.5。tools/ui-render-benchmark.html 加入實際點擊 Event Timing 與原視窗模糊對照；不用 double-rAF 或 capture microtask 冒充呈現／handler 耗時。
- 正式版實測：獨立 localhost:8337、Codex Chromium、遊戲 1362×869、DPR 約 1。5 次技能開關，首次 click 72ms、後續回報 16–24ms；rAF 最長 69.3ms／1 次 >50ms。10 次頁籤切換（裝備／寶石／熔爐／技能／高塔／設定）呈現 32–160ms，相較基準 72–360ms 明顯改善；整段 rAF 仍曾達 312.4ms／8 次 >50ms，包含非點擊的遊戲工作，不能宣稱所有尖峰消失。天賦／神鑄尚未解鎖，未實際點擊驗收。
- 功能與風險：已確認各可用頁籤 active 狀態、技能已學習／未學習內容與關閉行為，截圖確認視窗／裝備工作區完整。工作區陰影變平是刻意視覺取捨。Console 僅有測試開始前既存的 MutationObserver observe 非 Node 錯誤（16:06:10.266Z），本輪重載／操作未新增；未擴大修正。原 Chrome 使用者驗收仍待進行。
- 測試：npm run build（347 檔通過）；node --test tests/tooltip-modal-close.test.cjs tests/panel-scroll-hover-suppress.test.cjs tests/tab-lock.test.cjs tests/skill2-ui.test.cjs tests/skill-tree-layout.test.cjs tests/newforge-panel-performance.test.cjs（25/25 通過）；git diff --check 通過。
- 未改但檢查：js/ui.js（switchTab／技能彈窗與點擊入口）、css/style.css、package.json 與上述測試。Commit 為本紀錄所在提交；無素材變動。可供審查合併，未自行合併／推送；下一步在使用者原 Chrome 重新整理後驗收這兩種操作。

## Codex｜UI 提示切換造成畫面提交停頓（UI-RASTER-20260913）

- Owner：Codex；Done／待使用者原 Chrome 驗收。使用者授權分析 Trace-20260913T223548.json 並修復 UI 操作／裝備提示切換時戰鬥定格。
- 前置：錄製約 14 秒，18 次 Commit >50ms，最長 197.351ms；同時 raster 執行緒忙於繪製，單層佔 RasterTask 69%。需以實際頁面對照測試定位，不能以縮短 tooltip handler 宣稱根治。
- 允許範圍：UI CSS、ui-scale/ui/lagprobe 的必要修正、index 快取、本紀錄及獨立效能驗證工具／回歸測試。禁止改存檔、Worker 協議、戰鬥數值及素材；不合併／推送。
- 預檢：目標檔無其他副本／分支修改，遠端已 fetch。驗收：逐項 UI 繪製對照、提示及定位功能、相關測試、Build、diff check；後續由使用者在原 Chrome 環境確認。
- 根因與修正：使用者確認 cheap 模式使卡頓完全消失；實際滑鼠跨圖標 A/B 顯示裝備受 hover filter 影響、技能提示受繼承的模糊文字陰影與框體陰影影響。Ashen Forge 改為沿用背景／邊框提供懸停回饋，不濾鏡化整個互動元件；#sk-tooltip 取消文字與框體陰影，卡片保留材質／邊框。未移除子圖像、技能鎖定狀態或戰鬥 VFX 的濾鏡。快取 ashen-forge 1.0.3 → 1.0.4。
- 驗證環境：Codex Chromium，遊戲 viewport 1362×869、DPR 1.25，獨立 8337 埠的新測試存檔。以實際指標拖移穿過圖標量測 mouseover/out；不是只用計時器換 tooltip HTML，後者無法重現。相同裝備路徑各 160 次圖標進出：原版 max 83.3ms、>50ms 9 次；候選 max 48.7ms、0 次。技能各 240 次：原版 max 701.4ms、23 次；候選 max 62.4ms、2 次。
- 正式 CSS 暖機後再反向 A/B：原陰影技能 max 548.7ms／17 次 >50ms → 目前版本 max 13.9ms／0 次；圖標有效事件 210／189（各採相同 16 趟路徑，暖機一秒不計）。裝備正式重測 max 34.7ms／0 次。不同階段的載入／戰鬥工作仍有偶發尖峰（首次裝備量測曾見 1000ms、技能 159.6ms），不可宣稱所有環境永無卡頓；此結論是連續懸停引起的重複停頓已顯著改善。外殼／tooltip 分層並無穩定額外收益，不納入。
- 工具：tools/ui-render-benchmark.html 保留目前版本／修正前的 CSS 對照、1 秒暖機、30 秒量測、影格／目標事件統計、背景分頁失效標記及停止時清理。只改測試頁呈現，不送遊戲命令；應在獨立測試埠使用。scratch 探索頁已刪除。
- 驗證：清理後 npm run build 347 檔通過；node --test tests/tooltip-modal-close.test.cjs tests/panel-scroll-hover-suppress.test.cjs tests/attribute-tooltip.test.cjs tests/boss-tooltip.test.cjs tests/gem-tooltip.test.cjs 共 15/15。實機技能提示文字／鎖定說明／定位、裝備單卡／雙卡比較均正常，雙卡 584px 未越出畫面；最後重載無 Console error/warning。仍待原 Chrome 使用者驗收。不改素材、無素材庫 Commit；未合併／推送。Commit 為本紀錄所在提交。
- 未改但檢查：js/ui.js 的顯示／定位、js/ui-scale.js、js/battle-renderer.js、js/lagprobe.js、css/style.css、相關測試與原始 Trace。交付僅 CSS／index／此任務紀錄與對照工具，可供使用者審查合併；完整測試套件未重跑，遊戲邏輯未修改。

## Claude｜捲動技能頁時戰鬥區定格：捲動中不做懸停提示（LAG-SCROLL-HOVER-20260913）

- 病因：捲動時游標不動，但格子在游標底下一路移過去，每經過一顆就送一次 mouseover／mouseout。每一則都走到 showSkillTooltip（使用者報告實測平均 6ms、最大 12.7ms），而 positionSkTooltip 為了定位要讀三次版面（getBoundingClientRect／offsetWidth／offsetHeight），每次都是一輪強制版面重算。整個 UI 外殼掛在 transform: scale() 底下（js/ui-scale.js:36），捲動本來就走主執行緒重繪，再疊這一串，Pixi 的 ticker 就搶不到 frame。使用者互動延遲表整排是 mouseout／mouseleave／mouseover／mouseenter，正是這個形狀。
- 先排除的：lagPaint('all')（關陰影濾鏡／離屏跳過渲染／canvas 獨立圖層）由使用者實測無效，因此不是繪製成本，方向改為事件量。
- 修正：js/ui.js 比照背包既有的 UI.inventoryScrolling，替主捲動區（#workspace-area main）加 UI.panelScrolling —— 捲動中掛旗標、最後一則捲動事件後 120ms 放掉、捲動開始時收起提示；mouseover 與 mouseout 在最前面就短路。抑制範圍以 workspaceScroller.contains(e.target) 限定在該捲動區內，戰鬥區與左側屬性列不受影響。
- 驗證：本機 8331 實測三段——未捲動 hover 1 次→提示 1 次；捲動中 hover 20 次→0 次；停止 220ms 後→恢復 1 次；捲動區外的 hover 在捲動中仍正常顯示（未誤擋）。新增 tests/panel-scroll-hover-suppress.test.cjs 3 項通過，並對「限定捲動區內」那條做過突變測試（改成無條件抑制會紅）。build 342 檔通過；npm test 2651 項 61 項失敗，與未修改 HEAD 的失敗集合逐項比對完全相同，0 新增失敗。快取版號 ui.js 1.0.61 → 1.0.62。
- 待確認：使用者實機快速捲動技能頁，確認戰鬥區不再定格。

## Codex｜大小風刃顯示比例（2026-09-12）

- 任務 WIND-SIZE；Owner Codex；Done。追蹤月牙用碰撞半徑除以 authored 半長，造成放大；改為半徑對應刃寬並以本體比例求長，與直射採相同 profile.scale。範圍 Runtime、快取、測試與本紀錄；不改數值及使用者 VFX。預檢乾淨；驗收正式大小風刃比例及 Build。
- 使用者要求包含自行修改的全部檔案，納入冰霜新星、暴風雪、大小風刃 preset/layout。5 項風刃整合測試通過（同一倍率下小型根縮放為大型 75%），所有修改 preset 的 Core 驗證通過；Build 342 檔及 git diff --check 通過；素材匯出最新、素材庫乾淨，無素材庫新 Commit。未實機目視測試；本紀錄所在提交可供合併，未推送。

## Codex｜追跡風刃抖動與停滯（2026-09-12）

- 任務 WIND-MOTION-SMOOTH；Owner Codex；Done。使用者要求消除轉彎抖動，且小風刃速度與大型一致。大小本來共用 geom.speedPx；修正追跡場域被 dest 停駐限制、快照航向跳變及位置修正速度突變。範圍 Runtime、skills2 運動事件、快取、風刃回歸測試、本紀錄；保留使用者冰系修改。預檢乾淨，驗收：速度來源與實際位移、跨目標不停駐、含快照修正的朝向及角速度連續性、Build。
- 完成：風刃不再送停駐終點，Runtime 相容舊事件亦不套用停止限制；快照航向殘差及位置修正速度共用收斂時間，旋轉仍取實際位移，正常無誤差圓弧保持精確積分。未更動傷害與速度數值。
- 驗證：windblade-vfx-integration 4/4（同源速度、一秒位移、跨目標不停、含交替誤差的快照每幀角變化、朝向及圓弧）；vfx-runtime 的 WINDBLADE／GROUND 7/7；Build 342 檔通過，git diff --check 通過。未實機測試，使用者冰系 VFX 保留未提交，無素材變更。Commit 為本紀錄所在提交，可供合併，未推送。

## Codex｜風刃朝向與圓弧轉彎（2026-09-12）

- 任務 WIND-BLADE-FACING；Owner Codex；Done。使用者回報風刃固定朝右，要求參考寒冰箭。追跡場域漏用 moveA、漏傳 turnRate 且模擬轉彎未採圓弧積分；沿用冰箭機制修正。範圍：skills2、Runtime、主頁／Worker 快取、測試、本紀錄；不改使用者冰系 VFX。預檢乾淨，驗收包含四向直射、追跡轉彎與朝向／位移一致、Build。
- 驗證：windblade-vfx-integration 2/2（快照修正、多方向、跨正負 π、零時間、模擬與六個顯示幀圓弧一致）；vfx-runtime 的 WINDBLADE 2/2（正式月牙四向旋轉、長距離壽命／回收）；icearrow-vfx-integration 的 homing arrow／continuous turning arc 2/2。Build 342 檔通過，git diff --check 通過。未實機目視測試。無素材變更；保留使用者冰霜新星／暴風雪修改未提交。本紀錄所在提交可供合併，未推送。

## Codex｜風刃月牙接入（2026-09-12）

- 任務 WIND-BLADE-VFX；Owner Codex；Done。使用者批准 moon-original-01 月牙、深綠外圈與中央白光。範圍：風刃／追跡風刃 preset/layout、Runtime 飛行壽命與快取、匯出、相關測試；不改技能數值及使用者冰系 VFX。預檢乾淨，前置預覽已確認。驗收：批准外觀、素材一致性、長距離飛行／回收、Build；使用者後續合併。
- 完成：一般風刃與批准 JSON 除 id 外一致；追跡版使用同一月牙配色、維持 3×6 米，持續本體不反覆淡出。原共用追跡 preset 的萬象風劫亦沿用新外觀。一般飛行動畫以 timeScale 對齊事件 travelMs，避免 1.5 秒後先消失，未更改速度／傷害。
- 驗證：node --test --test-name-pattern=WINDBLADE tests/vfx-runtime.test.cjs 1/1（1 秒與 5 秒飛行仍可見且抵達回收）；npm run build 341 檔通過；兩份 Core.validatePreset、批准 JSON 比對、素材雜湊及 export-assets --check 通過。素材庫乾淨無新 Commit；未實機測試。保留使用者冰霜新星／暴風雪修改未提交。本紀錄所在提交可供合併，未推送。

## Codex｜暴風雪霜地與飄雪接入（2026-09-12）

- 任務 BLIZZARD-VFX；Owner Codex；Done。使用者批准不規則藍色霜地、貼地冰霧、空中飄雪碎冰預覽，要求接入。
- 範圍：ground-blizzard preset/layout、Runtime／主頁快取、素材匯出與本紀錄；不修改技能數值、跟隨邏輯與其他 VFX。前置預覽已確認、預檢乾淨。驗收：批准 JSON 一致、素材雜湊、場域跟隨／縮放／回收測試、Build；完成由使用者測試合併。
- 完成：正式 JSON 除 id 外與批准 v2 預覽完全一致，沿用 T7 ground-blizzard 引用及權威矩形範圍；16 層、無即時程序生成。同步單一根群組與資料快取，新增正式 Runtime 回歸測試。
- 驗證：node --test --test-name-pattern='BLIZZARD|GROUND-' tests/vfx-runtime.test.cjs 6/6，覆蓋範圍加倍、移動續命不重播、到期清除；npm run build 341 檔通過；Core.validatePreset、批准 JSON 比對、素材庫／遊戲 SHA256、export-assets --check、git diff --check 均通過。素材皆已匯出且素材庫乾淨，無需素材庫 Commit。未實機目視測試；本紀錄所在 Commit 可供合併，未推送。

## Codex｜連鎖閃電彈射間隔（2026-09-12）

- 任務 CHAIN-HOP-300；Owner Codex；Done。使用者指定每次彈射間隔由 0.2 改為 0.3 秒，沿用首擊抵達時間，電弧排程與傷害顯示共同延後。
- 範圍：skills2、主頁／Worker 快取、既有 CHAIN 測試及本紀錄；不改使用者正在編輯的 VFX。前置依賴完整、預檢乾淨。驗收：逐跳視覺／命中延遲、Build；使用者後續合併。
- 驗證：node --test --test-name-pattern=CHAIN tests/skill2-lightning.test.cjs 1/1 通過，四跳播放為 0/300/600/900ms，命中顯示為 183/483/783/1083ms；npm run build 341 檔通過；git diff --check 通過。未實機測試，無素材變更。使用者自行修改的水龍捲／冰霜 VFX 與匯出保留未提交；本次只提交彈射間隔，可供合併，未推送。

## Codex｜冰霜新星冰錐震波接入（2026-09-12）

- 任務 FROST-NOVA-VFX；Owner Codex；Done。使用者批准新版冰錐、雙層震波及貼地冰霧預覽並要求接入。
- 範圍：burst-frost-nova／burst-frost-freeze preset/layout、素材匯出、Runtime 資料快取及 index、本紀錄。禁止修改傷害、範圍、Excel/CSV 及其他技能邏輯。前置預覽已批准，檔案衝突預檢乾淨。
- 驗收：正式 preset 與批准預覽一致、素材引用可解析、Core/layout 與冰系測試、Build。完成後使用者測試／合併。
- 完成：基本及第四階 attack 入口皆更新；維持既有共用 preset 引用（含水流彈的寒流爆散），不改數值與事件時序。32 層，新增震波素材由既有素材庫匯出；兩份正式 JSON 除 id 外與批准預覽完全一致，每個素材 SHA256 與素材庫一致。素材庫乾淨、無需新 Commit。
- 驗證：node --test tests/vfx-core.test.cjs tests/vfx-preset-layout.test.cjs tests/skill2-ice.test.cjs 為 162/174；以 HEAD 檔案重跑同為 162/174，失敗名稱完全相同（11 項既有冰系斷言、1 項使用者無限火龍群組名稱）。npm run build 341 檔通過；export-assets --check 最新；git diff --check 通過。未進行遊戲實機測試；遊戲 Commit 為本紀錄所在提交，可供合併，未推送。

## Codex｜火龍捲持續時間參數（2026-09-12）

- 任務 FIRE-DRAGON-DURATION；Owner Codex；Done。使用者指定本體 6 段／3 秒，T7 額外 6 段／6 秒，優先讀取 T7 sec，未填沿用 T1。同步 Excel/CSV、說明、快取與測試；不改 VFX 外觀與其他技能。預檢乾淨，完成後由使用者合併。
- 驗證：火系三檔測試 50 項通過；既有圖集測試硬編碼舊 tint，與 HEAD 中使用者自調色值不符，保留並以 test-skip-pattern 排除該項。新增 T7 sec=10、未填回退 T1、續召仍為6秒等檢查；Build 341 檔通過，config_tables --apply Skills2 零語意差異。Excel 只變更 AE92/AE98/AH98/AI98，既有樣式與其他 OOXML 部件未變、CSV 兩列一致。未實機測試。無新素材、素材庫無需提交；遊戲 Commit 為本紀錄所在提交，未推送。

## Codex｜第七階無限火龍（2026-09-12）

- 任務 INFINITE-FIRE-DRAGON；Owner Codex；Done。來源：使用者提供 Google 試算表「神力之巔_記事錄」技能 C142:I151（https://docs.google.com/spreadsheets/d/1RysqEzKOjr2oqHLdXapoTM28tlXpZ2wk/edit?gid=1687407583）；已讀效果、範圍、成長、其它與特效說明。
- 第七階改為原段數 +5、每段 100%／每級 +10%、持續追敵 6m/s、單敵附近也移動、保證再召喚一次、暗紅火焰；保留第 2~6 階與傳奇／超神相容。表中其他階段舊有數值差異不擴大修改。
- 範圍：skills2、Runtime／快取、Skills2 Excel/CSV、專用 VFX preset/layout、相關測試及本紀錄；不得改其他技能或使用者自調 VFX。前置依賴完整，主要檔案預檢乾淨。
- 驗收：段數／傷害／數量／續召上限、移動與畫面同步、Excel/CSV/JS 一致性、VFX 驗證、Build；完成由使用者合併。
- 完成：保留雙重龍捲數量，基礎 5+5 段；第 7 階自身 Lv.1 傷害為 110%（沿用底值＋每級增量），再疊第 3 階加成。再召喚後停止第 6／7 階連鎖，原階 6 仍保留機率重生；傳奇追蹤速度優先、額外段數及超神火池／數量／拉近仍生效。現有冷卻 15 秒未隨文件舊值 14 秒擴大修改。
- 驗證：node --test tests/skill2-infinite-fire-dragon.test.cjs tests/skill2-magic-fire.test.cjs tests/skill2-fire-legendary.test.cjs 共 49/49；包含實際 Runtime 速度／續播／回收。npm run build 341 檔通過；config_tables --apply Skills2 零語意差異；export-assets --check 最新。Excel 僅 13 儲存格變更、其他 OOXML 部件位元組未變，與 CSV 三個關聯列一致。Artifact Tool 匯出會誤改無關空字串，因此僅移植其授權儲存格至原包，保留既有格式與其他工作表。
- 暗紅 preset 使用共享圖集、未新增生成層。保留使用者同期自行儲存的 inferno preset/layout 與素材匯出。素材庫乾淨，必要素材已存在，無素材庫新 Commit。未實機測試；已渲染暗紅預覽。遊戲 Commit 為本紀錄所在提交，未推送，可供使用者合併與遊戲測試。

## Codex｜火龍捲尖頂接入（2026-09-12）

- 任務 FIRE-TORNADO-TIP；Owner Codex；Done。使用者批准尖頂預覽並要求接入，其他參數由使用者調整。
- 修改 fire-tornado-inferno 的圖集與頂部噴焰位置／範圍／數量，新增 fire-tornado-tip.cjs 可重烘焙同版 80 幀圖集；同步素材索引、遊戲匯出及快取版本。衝突預檢乾淨。
- 已檢查 skills2.js 的 firepillar.field 直接引用正式 preset；未修改技能邏輯、火牆或其他技能。圖集保持原幀數及尺寸，沒有新增即時程序生成。
- 驗證：Node assert 比對正式 preset 與批准 candidate 完全一致（僅替換素材 ID）、正式 PNG 與批准 PNG 位元組一致、Core.validatePreset 通過；node tools/vfx/export-assets.cjs --check 通過；npm run build 340 檔通過。未進行遊戲實機目視驗證。
- 素材庫 Commit：940f3b0；遊戲 Commit 為本紀錄所在提交；未推送。預覽暫存保留於 scratch/fire-taper-preview，未納入提交。可供使用者合併及遊戲驗收。

## Codex｜水龍捲圖集效能優化（2026-09-12）

- 任務 WATER-TORNADO-PERF；Owner Codex；Done。使用者回報四道水龍捲僅 10 FPS。
- 原因：水龍捲 12 層程序生成反覆計算形狀及 raster/texture upload，火龍捲已使用共享圖集。改為離線烘焙 80 幀、20fps，遊戲共享單一圖集，保留 halo/dust/spray、尺寸、外旋移動及傷害。
- 範圍：water-tornado-source/bake、preset/layout、素材索引／匯出、快取、測試、本紀錄；來源 JSON 保留於 author 目錄供重新製作。前置依賴具備、衝突預檢乾淨。驗收：四道實際 Core 無 generated 工作、前後 CPU 比較、圖集目視、Build／匯出一致性；使用者後續合併。
- 驗證：WATER 9/9，含正式 Runtime 四道播放／續命／回收；Build 340 檔通過；export-assets --check 最新，素材庫與遊戲 PNG SHA256 一致。四道錯開播放 240 幀，Core CPU 舊版 4724ms、新版 37ms，generated 更新 11640→0（不含 GPU，並非實機 FPS）；80 幀圖集已目視檢查。全檔測試另有既有 FIRE 測試要求目前已刪除的 dust 圖層，未改動火龍捲。尚未量測使用者遊戲 FPS。
- 編輯器可調圖集整體色調、亮度、縮放與播放速度；內部水流形狀從 water-tornado-source.json 修改後以 water-tornado-bake.cjs 重烘焙，再 export-assets.cjs。烘焙依賴 @napi-rs/canvas，可用 NODE_PATH 或 VFX_CANVAS_MODULE 指定。原始程序生成器及測試保留。
- 素材庫 Commit：eb55096；遊戲 Commit 為本紀錄所在提交，未推送。

## Codex｜水龍捲逆時針外旋（2026-09-12）

- 任務：WATER-TORNADO-SPIRAL；Owner：Codex；狀態：Done。
- 使用者指定水龍捲以每秒約 3 米緩慢逆時針向外移動。四道 T7 水龍捲從正方形頂點出發，以施放位置為固定中心，傷害與 VFX 共用位置、速度、航向及曲率。
- 範圍：skills2、vfx-runtime、主頁與 Worker 快取、冰系及 Runtime 測試、本紀錄。沿用素材，不改傷害、段數及其他技能。
- 前置依賴已具備，衝突預檢乾淨；驗收為路徑速度／逆時針／半徑遞增、事件與渲染、到期回收及 Build。後續由使用者合併。
- 驗證：新增兩項定向測試通過，使用 HEAD 舊版模組回放時兩項均失敗；Build 340 檔通過。冰系與 Runtime 的既有失敗以 HEAD 模組回放確認（包含水龍捲舊測試混入水彈傷害，及雷殞／岩甲／泥沼／電鏈設定差異），未更改既有斷言。尚未作遊戲實機目視驗證；高塔無世界座標維持原退化行為，傳奇命中生成與超神巨大龍捲不屬本次四角水龍捲的移動範圍。無素材變更，無素材庫 Commit。

## Claude｜技能頁點擊卡頓：關掉 Pixi 指標事件系統（LAG-PIXI-POINTER-20260912）

- 病因：PixiJS EventSystem 把 pointermove 掛在 **document** 上（捕獲階段），每一則都走 mapPositionToPoint → canvas.getBoundingClientRect()＝一次整份文件的強制版面重算。滑鼠在頁面任何地方移動都會觸發，與有沒有移到戰場上無關。使用者回報的探針報告：互動延遲 600ms 之中「等待」10ms、「處理」1ms、「呈現」590ms，而強制版面重算第一名正是這支（1263 次，第二名 21 次）。
- 修正：js/battle-renderer.js 的 app.init 加 `eventFeatures: { move:false, globalMove:false, click:false, wheel:false }`。戰場上沒有任何 display object 是互動的（全專案無 eventMode／hitArea／pointer 監聽），這套事件系統只有成本沒有用途。
- A/B 實測（本機 8331，同一段情境各跑一次）：200 則 pointermove ×「大文件（8929 節點）＋版面持續變髒」＝修正前 995.5ms／200 次強制重算，修正後 0.5ms／0 次。小文件乾淨版面為 6.5ms，可見成本是「次數 × 文件大小 × 版面髒不髒」三者相乘——戰鬥進行中三個條件同時成立。
- 驗證：console 無錯誤、渲染器正常啟動；build 339 檔通過；npm test 2604 項 33 項失敗，三個看似新增的失敗已在未修改的 HEAD 逐檔重跑並同樣失敗（屬既有／間歇性失敗），本次改動 0 新增失敗。快取版號 battle-renderer.js 1.6.120 → 1.6.121。
- 待確認：請使用者在自己的機器重測技能圖標點擊手感；若仍有殘留延遲，再以 ?lag=1 取一份報告看「呈現」是否已下降。

## Claude｜技能頁點擊卡頓：卡頓探針補上互動延遲與技能彈窗路徑（LAG-SKILL-MODAL-20260912）

- 回報：點技能圖標約 1 秒才彈出升級面板，面板內操作同樣延遲。已確認開窗路徑（openSkillModal → renderSkillModal）是同步的、不等 Worker，本機測試服（Lv.1000、23 群組全滿＋超神、冰原 227 階、演武場 24 隻千倍血）量到點擊→彈窗 <5ms，未能重現，因此改為補強診斷能力而非盲改程式。
- 修改：js/lagprobe.js 兩處。(1) 新增 Event Timing 觀測，把「按下去→畫面更新」拆成等待／處理／呈現三截——原本的長工作表與函式耗時表都看不到「等待」那一段，正是這次回報的形狀。(2) TARGETS 補上技能彈窗與提示這條路徑（openSkillModal、renderSkillModal、renderSkill2Modal、renderSkill2UltModal、showSkillTooltip、describeSkill2Group、describeSkill2Tier），原本一支都不在名單裡，依本檔開頭的警告會被讀成「這條路徑沒問題」。
- 驗證：本機 8331 以 ?lag=1 載入，八支包裝全部生效、lagReport() 無錯誤、__lagData.input 欄位存在、Event Timing 為瀏覽器支援；build 339 檔通過。
- 待處理：需使用者在自己的存檔與機器上以 `?lag=1` 重現後回報 `copy(__lagData)`，才能判定是主執行緒壅塞（等待）還是渲染成本（呈現）。

## Claude｜死亡重生補滿生命與法力（DEATH-REVIVE-MP-20260911）

- 使用者規則：死亡重生後生命與法力都要補滿。盤點四條復活路徑後，野外死亡復活（js/combat.js fieldTick 的 reviveCd 出口）本來就兩者都補；高塔戰敗（死亡）回野外的 finishTowerFight 只補生命，玩家一落地就沒法力放技能，本輪補上法力。經使用者決定，兩個技能復活（超神【不屈鬥魂】、傳奇【天地共生】）維持原設計不動——前者仍只補滿生命，後者仍照 {pct}% 生命復活。
- 驗證：新增 tests/death-revive-restore.test.cjs 同時釘住野外與高塔兩條路徑（2/2 通過）；build 337 檔通過；npm test 2595 項中 30 項失敗，與 HEAD 基準逐項比對為同一組既有失敗（VFX Preset／skill2 系列），本次改動 0 新增失敗。快取版號已同步（index.html tower.js 1.0.10、worker importScripts、bridge WORKER_ASSET_VERSION）。

## Codex｜必要素材雙倉庫提交流程（ASSET-DUAL-COMMIT-20260911）

- 完成：將所有 AI 的必要素材雙倉庫提交規則加入 AI_RULES，工作流程引用同一權威規則。補交素材庫中目前 10 張遊戲已使用的貼圖，逐檔對照 shipped-assets 雜湊全部相符；不推送、不切換分支。素材庫 Commit：`0f71558`；遊戲規範 Commit 見本紀錄所在提交。驗證：Node SHA-256 核對、兩倉庫 `git diff --check` 通過。本次未修改遊戲程式，無待處理項目。

## Codex｜雷殞橫飛修正（VFX-THUNDERFALL-ANGLE-20260911）

- 使用者追加速度降低一半：雷殞 travelMs 加倍，權威傷害落地採同一個時間（消除舊隕石倍率與 Preset 直接讀時間的落差）；預覽同步放慢。5 項角度／速度／傷害時機／素材測試通過，主頁與 Worker 快取更新。

- 修正：遊戲正規化未指定角度為 null，Runtime 的 num(null) 轉為 0 導致水平飛行；改成只接受有限 number，其餘回到 60 度。回歸測試採實際 angle:null，保留權威落地事件檢查。範圍 Runtime、測試、快取與本文件，衝突預檢乾淨。

## Codex｜雷殞天落預覽（VFX-THUNDERFALL-20260911）

- Done／接入：使用者核准強化版後，Excel Z168:AB168、CSV／JS 與製作目錄改為獨立雷殞投射物／衝擊。Runtime 以 60 度斜向起點播放，取消飛行事件的預排命中，改由權威落地事件播放一次範圍衝擊；半徑沿用 area。主頁與 Worker 快取同步；使用者雷球 preset 未修改。角度／不提前爆炸／單次落地及素材目錄 4 項測試通過。接手者：使用者實機測試與合併。
- 驗證補充：335 檔 build 通過；雷球／冰箭傳奇測試 21 通過、2 項既有配置落差（雷核 40 vs 30、criticalThunderbolt 參數表檢查），相關數值未修改；配置套用 dry-run 語意變更 0。

- In Progress：參考使用者雷球的配色與電弧，獨立製作巨大雷電核心、60 度斜落拖尾與落地分岔雷光／衝擊波。範圍新 author、preset/layout、預覽與素材匯出；不覆寫使用者雷球，不改技能數值。預覽確認後再接入，驗收素材合法、動態及 build，交由使用者確認。
- Review：已完成獨立雷核與五層長電流拖尾、藍紫外光、沿路徑殘留的電弧碎片，預覽單顆／兩顆 60 度斜落與落地衝擊，可定格檢視。素材目錄 3 項測試通過、335 檔 build 通過，預覽約 60 FPS。既有岩甲前後層 alpha、泥沼強度兩項測試與目前使用者配置不符（本次未改相關檔案）；未接入技能。補齊本機素材庫缺少的 10 張已提交素材，僅拷貝雜湊吻合且缺少的檔案。

## Codex｜毒沼與熔岩沼預覽（VFX-MIRE-EVOLUTIONS-20260910）

- Done／接入：使用者核准並指定透明度 30%，兩個 preset 整體 alpha 乘 0.3（泥地 0.3，熔岩火焰 0.216、火星 0.24），生命曲線與前版相同。Skills2.xlsx AC124／AC128、CSV／JS／catalog 分別接第三階 venom 與第七階 magma，保留原減益與成長數值；Runtime 延用權威長寬、續命及進退場，主頁與 Worker 快取更新。202 項 Runtime／Core／layout 加 1 項三階技能接線測試通過；build 332 檔通過、Excel 僅上述兩格改變、config_tables dry-run 語意差異 0。地系全組另有先前已證實的 2 項舊 10 米斷言失敗（配置為 12 米），未改測試接受現況。使用者基礎泥沼 alpha 0.3 修改一起保留提交；預覽及暫存脚本清除。接手者為使用者遊戲驗收，未合併或推送。

- Review／僅預覽：使用者要求第 3 階毒沼與第 7 階熔岩沼一起做。依最新文件 I183／J183 綠紫色及 I187 黃紅色＋火焰粒子，沿用核准泥沼的岸線、泥流時序與泡沫，製作 venom／magma 圖集、獨立 preset／layout／author 與 GIF。禁止先接入兩階，先給動態圖及檔名確認；不改數值、CSV／Excel 或 Runtime。
- 驗證：136 項 Core／layout 測試及 332 檔 build 通過，兩張圖集共 48 格的 alpha 輪廓逐像素與原版完全相同；並排 GIF 120 格，已目視檢查綠紫泥流、黃紅岩漿與火焰。預覽同尺寸方便比較，正式接入時熔岩沼擴增沿用技能權威面積，不能把預覽同尺寸當作修改數值。原始 PNG 格已刪除，GIF 與渲染腳本待核准接入時清除；此預覽未提交，接手者為使用者外觀審閱。

## Codex｜泥沼術預覽（VFX-MIRE-20260910）

- Done／接入：使用者核准第一階，Skills2.xlsx AC122／CSV／JS／catalog 改用 ground-mire-earth，仍讀權威面積縮放並沿用同一場域身份續命；加入預覽的進退場，主頁及 Worker 快取同步更新。201 項 Runtime／Core／layout 全通過，build 332 檔通過；Excel 僅 AC122 變更，config_tables dry-run 語意差異 0。提交同時保留使用者火龍捲本體 alpha 0.9→0.6 與素材匯出清理（舊整圈岩甲圖集已由前後圈取代）；清除臨時預覽與渲染腳本。實戰視覺仍由使用者驗收，未推送。

- Review／僅預覽：已讀最新技能文檔 I181 與 J181 參考圖，第一階為大致方形、不規則邊緣、土褐色流動泥漿。製作 ground-mire-earth author／preset／layout、48 格泥流圖集與 asset-index，固定岸線、內部緩慢流動並有少量泥泡。文檔為 10×10 米，現有程式基礎值為 120px；預覽先保留作者名目尺寸，正式接入再沿權威面積縮放，不修改技能數值。禁止本輪接線或覆蓋 ground-mire；動態預覽核准後才接入。
- 驗證：136 項 Core／layout 測試與 332 檔 build 通過，diff --check 通過。圖集 2048×1536、48 格／12 FPS／4 秒循環、約 2.50 MiB；GIF 120 格，展示放大泥流與角色比例、進退場。已目視檢查不規則岸線、泥泡及表面構圖，實際 Pixi 戰場驗收在接入後進行。原始 PNG 預覽格已清除，僅暫留 GIF 與重建腳本至使用者核准；尚未提交。本輪期間出現使用者火龍捲預設及匯出素材索引更新，完整保留。

## Codex｜天地逆返預覽（VFX-EARTH-REVERSAL-20260910）

- Done／接入：使用者核准藍紋後接入第七階 ground，Skills2.xlsx AC118／CSV／JS／製作目錄同步，Runtime 藍紋仍分前後圈、沿用尺寸及進退場，主頁與 Worker 快取更新。未投資第七階維持暗金，投資後施放改藍紋，與護盾量無關。119 項地系／Runtime／傳奇測試中 117 通過，2 項泥沼舊尺寸斷言（100 對現有 120）已用 HEAD 版本確認同樣失敗；新增接線與分層測試通過。build 332 檔通過，Excel 僅 AC118 改變，config_tables dry-run 語意差異 0。預覽與暫存腳本已清除，接手者為使用者實戰驗收；不合併或推送。

- Review／僅預覽：重新匯出線上最新文件，I175 明確寫「岩甲術的符文石碑上的紋理變為藍色」。使用者確認不隨護盾值變化，只在點選第七階後替換符文顏色。已撤銷先前依舊版文件製作的回流光圈提案；新版 aura-earth-reversal 完整沿用岩甲模型、尺寸、轉速及前後半圈，僅將甲片符文與其微光烘焙為藍色。不改遊戲接線、Runtime、護盾數值或表格；待使用者說「接入」才設定第七階替換。
- 製作檔案：earth-reversal author／preset／layout、blue-runes back／front 圖集與 asset-index；rockarmor author 新增可選符文配色參數，默认輸出保持原暗金。逐欄比較確認 preset 僅 ID／圖集引用不同，136 項 Core／layout 測試通過；96 格動態 GIF 展示原版與藍紋對照，已目視檢查。預覽與渲染腳本暫留 scratch 供審閱，提交時清除；本輪尚未接入或提交。

## Codex｜岩甲環繞遮擋修正（VFX-ROCKARMOR-DEPTH-20260910）

- Done：使用者回報放大後前半圈甲片被人物遮住。根因為整圈共用單張圖集且全部位於 zone。保留使用者甲片縮放，離線依軌道深度烘焙 back／front 圖集，Runtime 共用生命週期、跟隨錨點與尺寸，分別置於 zone／fx；前後甲片共同腳底上方中心、地面與塵土置中。修改 author／preset／layout／圖集與索引、Runtime／主頁快取、回歸測試及本記錄；不改護盾數值。
- 驗證：`node --test tests/vfx-runtime.test.cjs tests/vfx-core.test.cjs tests/vfx-pixi-sheet.test.cjs tests/vfx-preset-layout.test.cjs tests/vfx-preset-usage.test.cjs` 共 222 項全通過；`npm run build` 332 檔通過、兩張 shipped 圖集 SHA-256 與 diff --check 通過。回歸測試涵蓋前後分層、共用逐格時鐘、兩倍縮放、移動／續命及完整回收。以真正 Runtime／Core 與遊戲角色素材離線繪製 64 格確認人物遮擋，臨時圖片不提交並清除。未改但檢查：battle-renderer 的角色／zone／fx 層級與 footOf、vfx-tower 錨點、Pixi sheet 後端。實際 Pixi 戰鬥及高塔外觀仍待使用者驗收；未推送，可交付使用者合併。

## Codex｜跨電腦編輯器素材備援（VFX-ASSET-FALLBACK-20260910）

- In Progress：外部素材庫缺少已提交的岩甲貼圖時，Editor Server 由 shipped-assets 白名單查找專案素材，仍優先本機素材。範圍 server、HTTP 回歸測試與本文件；不修改使用者素材庫。驗證缺檔、優先序、未知素材與 libraryId 隔離；交由使用者更新另一台電腦後重啟編輯器。
- Done：缺檔 fallback 已完成，限相同 libraryId／manifest 路徑，拒絕連結路徑；HTTP 定向測試 40 通過、1 個既有平台測試略過，332 檔 build 通過。岩甲圖集雜湊與使用者失敗 URL 相同。此修正處理讀取，不同步或回填外部素材庫；部署需重啟 Editor Server。

## Codex｜伴生火狩預覽（VFX-FIREHUNT-COMPANION-20260910）

- Done／接入：依使用者核准 v2 接入紅藍 orb-firehunt-companion，沿母體後方保持體積直徑＋1 米的沿軌中心距；正反圈、體積成長、螺旋、出生與消耗皆傳遞逐團身份及相位，避免母體重排。第三階 projectile 與 CSV／Excel／JS 同步，Worker 協議升 v29、主頁與 Worker 快取更新；傷害、機率與持續時間數值不變。
- 接入驗證：`npm run build` 332 檔通過；`node --test` 火狩／傳奇／技能 VFX／Runtime／Core／Pixi sheet／preset coverage、layout、usage／tower／Worker protocol、crosscheck 共 325 項，318 通過、7 失敗。失敗為既有追蹤風刃靜態斷言、4 項其他技能 preset coverage、tower 舊版號斷言，以及本輪外部岩甲尺寸修改；以 HEAD 程式重跑失敗組核對，不調整測試接受現況。定向火狩／Runtime／傳奇／Worker 118 項中 117 通過，唯一失敗為岩甲。`config_tables --apply Skills2` dry-run 語意差異 0；Excel 僅 AA104／AH104／AI104 改變；`git diff --check` 通過。
- 交付檔案：skills2、vfx-runtime、battle-renderer、Worker protocol／sim／bridge、index、Skills2 CSV／Excel、author／catalog、companion preset／layout、3 支回歸測試及本記錄／協議／Adapter 文件。未修改但檢查：母體 preset、Core／Pixi backend、config_tables、preset coverage／layout／usage／tower 測試。動態預覽與 scratch 驗證產物僅保留本機，不提交；本輪外部岩甲 preset／layout／素材索引修改不納入提交。未完成：實際存檔戰鬥與大量特效 FPS 由使用者驗收；可交付審查，合併仍由使用者決定，不自動合併或推送。

- 接入 In Progress：使用者核准 v2 並要求 Commit。允許修改 Skills2 模擬／CSV／Excel 第三階飛行特效、VFX Runtime／legacy renderer、Worker Protocol 與快取、相關測試／文件／製作目錄。以逐團身份、相位及母子關係傳遞權威幾何，間距沿用核准的「體積直徑＋1 米」。禁止改傷害／機率／持續時間及其他技能；目標衝突預檢乾淨。完成回歸與 build 後提交，不合併或推送。
- 第二版位置修訂：使用者指出伴生應在原火狩後方。前版中心距僅 1 米造成火團重疊；本版預覽採母體直徑＋1 米空隙的沿軌中心距（基礎體積下 4 米），黃紅母體在前、紅藍伴生在後。左側也改成成對放大展示。只改 HTML／GIF 預覽與 scratch 渲染腳本，不改 preset 配色或遊戲模擬。v2 GIF 共 138 格；預覽語法、正反轉後方幾何與 diff --check 通過，瀏覽器完成載入。這個間距是對使用者外觀要求的預覽詮釋，接入時仍須同步模擬，不得只改顯示。
- Review／預覽完成：使用者指定沿用核准 orb-firehunt，依技能文檔 I159 製作紅藍色伴生火焰；母體後方 1 米同軌環繞、各母體僅伴生一次且共同消失。已讀技能頁特效文字與 31 張內嵌圖，火狩參考位於 J157／K157。
- 範圍：新增 author/firehunt-companion.cjs、orb-firehunt-companion preset/layout、editor/firehunt-companion-review.html、scratch/firehunt-companion-preview 的渲染脚本及 GIF 與本記錄。禁止修改遊戲接線、共用 Runtime、技能數值、CSV／Excel。前置：現有火狩弧形拖尾已接入；目標衝突預檢乾淨。
- 驗收：Preset／layout 驗證、動態 GIF 與 Pixi 瀏覽器目視、Console 及 build。接手者：使用者確認；說「接入」後才處理遊戲接線，本輪先不提交。
- 結果：僅 ID 與 tint 不同，其餘幾何及粒子時序逐欄相等；169 項 core／editor-save 測試通過、1 項 Windows 符號連結權限測試略過；build 332 檔通過，diff --check 通過。GIF 138 格／25 FPS／5.52 秒，使用現有 Core 與軟體後端；Pixi 預覽亦已目視且 Console 無錯誤。生成物放大展示單顆、正常比例展示成對環繞。
- 已檢查未修改：orb-firehunt preset／author、skills2 的 sgOrbitCompanion／sgOrbitEmitVfx、vfx-core、vfx-pixi-backend、preset-kit、preset-render、editor-server。接入注意：現有環繞事件只有總數，尚未逐顆傳出伴生身份與相位；正式接入需同步權威事件與顯示，不能只替換整圈配色。預覽固定示範成功生成，不代表改動機率或傷害。未合併、未 Commit；待使用者外觀核准。

## Codex｜岩甲術預覽（VFX-ROCKARMOR-20260910）

- 2026-09-10 補充提交：使用者要求將剩餘岩甲調整一起 Commit，並明確排除預覽檔。保留編輯器產生的甲片縮放 0.8724、Y -32.3478 及同步地面／塵土位置與尺寸；不改技能數值。此前 build 332 檔通過；舊 Runtime 岩甲測試仍斷言原縮放 0.27，已記錄為與新外觀不符，不為提交而改斷言。預覽 HTML、GIF、截圖、渲染腳本及測試日誌均不提交。實戰外觀待使用者確認，未合併或推送。

- Done／接入：經使用者核准，Skills2.xlsx AC112、CSV、JS 與製作目錄改用 aura-rockarmor-stone；不屈鬥魂仍使用 aura-rock-armor。新版保持預覽原尺寸，沿用 0.3 秒進退場與腳底跟隨；主頁及 Worker 快取同步更新。使用者同意修改與 Antigravity CSS/UI 版號不同位置的 index.html。89 項定向測試通過，Excel 僅替換指定 cell 且保留所有其他 ZIP 部件；未改護盾數值。接手者：使用者實機測試／合併。

- 環繞修訂：甲片與碎石的橢圓軌道雙軸半徑增加 20%，甲片尺寸保持不變；重新烘焙共享圖集、同步素材雜湊，語法及瀏覽器預覽確認通過。

- 外觀修訂：依使用者要求將甲片圖集縮放 0.6→0.27，中心下移至腳底上方 13.5px，完整岩甲高度約人物一半；地面微光與塵土同步縮小。Preset 驗證與 author 語法檢查通過，瀏覽器比例確認。

- In Progress：基礎自身護盾製作碎岩甲片、暗金裂縫與少量塵土；新增 author、動畫素材、獨立 preset/layout 與動態預覽。沿用現有 Runtime，禁止改技能數值與既有共用 aura-rock-armor 接線。前置依賴已滿足，衝突預檢乾淨。驗收格式／素材、實際動態與 build；交由使用者確認外觀後接入。
- Review：完成六片立體碎岩、暗金裂縫、環繞碎屑與每秒 5 粒塵土；64 格共用圖集約 0.94 MiB。瀏覽器兩組預覽約 60 FPS，190 項 VFX 測試及 332 檔 build 通過。預覽含放大與角色比例；0.3 秒施放縮放目前由預覽控制，正式接線待外觀確認。既有技能與共用岩甲特效未替換。

## Codex｜火狩弧形拖尾接入（VFX-FIREHUNT-20260910）

- Done：使用者確認後替換遊戲既有 orb-firehunt，保留技能配置 ID；加入 opt-in worldSpace 粒子出生座標，讓拖尾沿實際公轉路徑彎曲。保留 author、preset/layout 與回歸測試，移除臨時預覽頁。一併保留使用者火龍捲配置及素材修改。235 項相關測試通過；戰鬥大量特效下的實機 FPS 仍由使用者測試確認。本次不合併或推送。

## Codex｜特效場景深度排序（VFX-DEPTH-20260910）

- 完成：Preset 以 effect handle 建立排序容器，容器依 origin.y，內層沿用 zIndex；sprite／程序層／粒子一致，節點回收時解除群組並釋放空容器。Runtime fx／zone 開啟，Editor 預設仍維持圖層編輯語意。Legacy zone／fx 依節點 Y，世界座標光束與落雷使用目標 Y。既有 zone／entity／fx／HUD 及 legacy／preset 掛載層級保留，不跨層混排。
- 驗證：237 項相關測試通過、331 檔 build 通過；瀏覽器確認晚生成的後排火柱位於先生成的前排後方。仍需實戰多技能壓測；臨時驗證頁不提交。

- In Progress，使用者授權全體特效排序檢查：修正 Preset 跨實例圖層穿插，場景 Y 越大越靠前，保留特效內部 zIndex 與地面／角色／HUD 分層。範圍 Core、Pixi backend、Runtime、必要的 legacy renderer、測試及文件。驗收晚生成的後排、移動交錯、粒子及回收。

## Codex｜火系特效整合提交（VFX-COMMIT-20260910-FIRE）

- 完成：火球／殞石接線、斜向與速度調整；火龍捲圖集效能優化、100% 柱身與亮度／轉速 +30%；三柱火牆核准偏紅配色。保留使用者普攻受擊、物理受擊、敵方子彈、落點標記設定。
- 補齊先前 Excel 鎖定延後的 Z88／AA88／AB88 及 CSV 殞石映射，其他儲存格與 workbook 部件保留。最新狀態取代下方歷史中的「表格待關閉」。
- 驗證：279 項 VFX／火系回歸測試通過；build_check 331 檔通過；預覽及遊戲入口素材確認。移除四個臨時 review.html，保留正式 author、圖集、preset、layout。實際戰鬥 FPS 仍取決於怪物及其他特效負載。使用者自行合併，未推送。

## Codex｜新版三柱火牆（VFX-FIREWALL-20260910）

- 已完成新版接線及三柱預覽：共用最新火龍捲圖集，Runtime 由 authored 寬度拆出三柱，保持四方向直立與等比；60 項 Adapter 測試通過，單道三柱預覽約 60 FPS／0.5 ms。待使用者遊戲測試，未 commit。

- In Progress：依文件三柱並排、間距縮小 20%、各柱直立及 0.3 秒進退場，更新 author／preset／layout／Runtime 拆柱與預覽。沿用最新核准火龍捲圖集；禁止修改傷害與技能配置。驗證四方向定位、縮放、回收與實際預覽，接手者為使用者測試。

## Codex｜新版火龍捲預覽（VFX-FIRE-TORNADO-20260910）

- 最新外觀設定：旋轉速度 +30%（圖集 16→20.8 FPS）、柱身 alpha 1、烘焙 RGB 亮度乘 1.3（保留透明邊缘，亮色上限 255），即時層 tint 同步提亮；保留 20 組火焰片。修正烘焙重用 canvas 導致的柱身透明異常，採獨立畫布；素材 URL 加內容雜湊避免同名圖集快取。遊戲與預覽同步，未 commit。

- 性能修正：八座程序版實測 10.4 FPS／VFX 更新 95.7 ms，改為離線生成 80 格 256px 動畫圖集（約 3.2 MB PNG，共用約 20 MiB 原始 RGBA），保留即時火星、頂部噴焰、地面火焰煙塵。八座預覽實測 59 FPS／1.2 ms，遊戲入口同步替換；尚待實際戰鬥驗證，未 commit。
- 共用 backend 對等比程序圖層改用單張繪製，不等比 radiusProfile 仍保留切片；程序火版採共享相位。重新製作需先執行 fire-tornado-renew.cjs，再執行 fire-tornado-bake.cjs（@napi-rs/canvas，可用 VFX_CANVAS_MODULE 指定），最後 export-assets；遊戲不執行烘焙計算。

- 使用者核准接入：以新版覆寫 fire-tornado-inferno 的 preset／layout，保留 Excel／CSV 既有入口；field-fire-tornado 為相同內容的預覽名稱。更新 core／生成器快取版本，保留場域等比縮放及 0.3 秒進退場。68 項轉接／旋流測試通過；未 commit。火牆仍使用原有獨立預設。

- 第二版：依高度將亮度集中中段、壓暗兩端；頂部程序像素加入隨時間變化的不規則漸隱，旋流片同步淡出以消除平切。新增地面火焰粒子並提高煙塵可見度。137 項核心／旋流測試通過，已實際查看瀏覽器；仍待外觀確認，未接入。

- 使用者要求棄用舊外觀，改以水龍捲結構製作。新增 field-fire-tornado、製作腳本與 fire-tornado-review 預覽；尚未替換技能配置。
- 共用程序生成器新增可選 fire 配色，保留原水色預設；火版減少外部旋流密度，橙紅底層、金色焰邊、少量地面煙塵與上飄火星。獨立快取避免污染水版。
- 驗證：程序生成與核心測試、瀏覽器實際播放截圖；待使用者確認外觀後接入。未 commit。

## Codex｜火球術預覽（VFX-FIREBALL-20260910）

- 最新下墜調整：火殞石從左上向右下與水平成 60 度，保留路徑長度，畫面速度降為原來 70%；獨立火殞石時序函式讓實際落地與視覺 travelMs 一致，不修改其他雷系天降。預覽同步，140 項相關測試通過；Excel 鎖定仍待解除。

- 使用者核准接入殞石：第七階使用 proj-meteor-inferno／burst-meteor-inferno；飛行不預播受擊，落地事件只播一次範圍火焰波。139 項 VFX／火系測試通過，快取更新。Excel 因開啟鎖定等待關閉，待完成表格同步；未 commit。

- 光暈加濃：提高橘色火焰光暈不透明度並補償素材透明留白，增加金黃輪廓亮邊；截圖已確認岩石外圍清楚可見。格式及播放停止回收通過，仍為殞石預覽。

- 殞石改為火焰光暈：移除八組 enveloping-flames 定向包覆火舌，新增 meteor-flame-halo，名目寬高為岩石 sprite 的 1.2 倍；岩石縮小設定不變，原長尾／煙尾與落地波保留。格式及播放回收通過，仍為未接入預覽。

- 殞石最新微調：岩石 sprite 尺寸縮小 10%，不縮整體特效或傷害範圍；包覆層改為定向火舌，沿局部 -X（飛行反方向）拖曳，減少角度散射並取消任意旋轉。表面火舌同步向後流動；保留後方煙尾與落地火焰波，預覽待確認。

- 殞石依最新回饋改為簡化塊面岩石，保留不規則輪廓；八組包覆火焰、拉長焰尾與煙尾；落地新增十二方向橢圓火焰波，與中央爆破分開。新素材 meteor-stylized.png；格式及播放回收通過，預覽截圖待使用者確認，仍未接入殞石。

- 火球追加加速 30%：獨立倍率作用於本體及分裂共用計畫，travelMs 與模擬 speed 同步，快取更新；95 項 VFX／43 項火系測試通過。殞石改用參考圖衍生的粗岩塊／熔岩裂縫與凹凸輪廓素材，表面五組獨立火舌持續流動；岩石底圖固定，未宣稱裂縫貼圖本身變形。殞石仍預覽，未接入。

- 使用者核准接入火球並製作殞石：火球 T1／T3 特效欄同步 Excel／CSV／JS；T1 範圍爆破改為飛行命中回呼播放，避免發射時先爆炸。Excel ZIP 有效，僅六個指定儲存格改動，其他 ZIP 項目完全保留。94 項相關測試通過，快取及素材匯出同步。
- 新殞石 proj-meteor-inferno／burst-meteor-inferno 與 author／layout，暗色岩核、火焰煙尾、落地火團與震波，實際渲染截圖供確認；殞石尚未接入，火球已接入。Preset 格式及播放停止回收通過，未 commit。

- 製作基礎火球飛行拖尾與隨機火焰爆破，依說明本體半徑約 3 米；新 author／Preset／layout／暫時預覽，先截圖確認。不改技能映射或數值，殞石另案。驗證格式、播放回收與實際渲染，未 commit。

## Codex｜雙刀亂舞預覽（VFX-DUALDANCE-20260910）

- 使用者要求提交供合併：納入雙刀亂舞正式／預覽 Preset、author、透明刀光素材、逐刀事件與方向接線、快取及測試；預覽 HTML 不納入。93 項相關測試及 331 檔 build 通過。下方未提交敘述為歷史記錄；嗜血狂怒仍未接入，本次不提交其素材。未合併或推送。

- 已依使用者核准接入：正式 slash-dual 使用強化版內容，保留 Excel／CSV 原映射；author 同步輸出正式與預覽 ID。逐刀發送單目標事件，交替角差與傷害飄字共享 0.2 秒延遲；Adapter 依施法者方向加上角差。透明素材已正式匯出，主頁／Worker／Preset 快取已更新。相關 93/93 測試與 build 通過；待使用者遊戲實測，未 commit。

- 第二版依使用者要求強化：刀光拉長約 1.5 倍、加厚刀鋒，增加局部金色亮刃與接觸閃光，火花增加到 16 道，保留 0.2 秒交替與前刀殘影。Preset 格式與播放回收通過，已更新實際渲染截圖；仍為外觀預覽，未接入／未 commit。

- 使用者指派製作下一技能；依說明製作黄色單體斬擊，預覽兩目標與同目標交替斬擊，間隔 0.2 秒。範圍為新 author／Preset／layout／暫時預覽；不改技能數值或接線。先截圖確認，未 commit。第六階紅色與第七階四面揮掃後續處理。

## Codex｜嗜血狂怒試作（VFX-BLOODRAGE-20260910）

- 使用者要求清理剩餘檔案：提交已確認的 aura-bloodrage-fury／hit-bloodrage-glow／proj-bloodrage-drain、layout 與 author；刪除淘汰的 hit-bloodrage-rend 及嗜血狂怒／雙刀亂舞臨時預覽 HTML。三份 Preset 格式、播放與停止回收通過。僅保存可用特效，嗜血狂怒尚未接入技能映射；下方未提交敘述為歷史記錄。

- 紅光改版：新增 hit-bloodrage-glow，獨立製作緋紅光暈、縱向亮光與少量飄散光點，0.25 秒；預覽改用新命中，血珠仍是 proj-bloodrage-drain 飛行子彈。Schema／三次播放回收與 build 驗證；尚待外觀確認、未接入／未 commit。前版 rend 保留為被替換試作。

- 依技能說明第一階：buff 身體變紅／體積 +25%／普攻紅色受擊放大；第七階擊殺後小型紅色子彈從敵人飛回角色。先製作同場預覽，角色 tint／scale 為預览示範，尚未改遊戲角色與技能映射。
- 新增 aura-bloodrage-fury、hit-bloodrage-rend、proj-bloodrage-drain 與 author／layout。小量上升血霧與碎光、不加完整地面光環；受擊沿用隨機碎裂形狀並放大 25%；血珠向角色回流。待使用者外觀確認，未 commit。

## Codex｜水龍捲混合素材編輯（VFX-WATER-MATERIAL-20260910）

- 狀態：Done；程序層在 assetId 旁標註「程序生成」，光暈改 Sprite、水花與煙塵改原生粒子，可使用原有素材選擇器。保留水柱、變形水片／飄帶與泛光的程序外觀。
- 範圍：Editor、Preset／author、素材匯出、快取、相關測試與文件；技能表映射不變。預檢無衝突；驗收素材選擇／儲存重載、畫面及 build。暫存放 repo 外。
- 驗證：程序來源唯讀標示、素材選擇器換圖、存檔重載與還原均通過，瀏覽器無錯誤；138 項相關測試 137 通過／1 略過，build 331 檔通過。光暈／水花／煙塵由素材與粒子參數呈現，細節與原程序層略有差異；水柱主體與片狀旋流保留。未操作使用者存檔；未合併／推送。

## Codex｜水龍捲即時計算拆層（VFX-WATER-LAYERS-20260910）

- 狀態：Done；拆成 11 個獨立即時計算圖層，移除合併序列圖集與舊 Python 匯出入口，已先提供 Editor 實際截圖。
- 範圍：原製作公式移植至共用程序產生器；Core／Pixi／Editor 支援獨立程序圖層；Preset／author／素材索引及匯出清理、測試、快取與文件。多數層可獨立調整顯示、透明度、顏色、位置與尺寸，半徑參數保留。
- 預檢：相关目標無其他副本／分支衝突。遊戲技能映射與 Excel／CSV 已是 field-water-tornado，本輪核對但不更動數值或存檔。
- 驗收：無合併 atlas／sheet 依賴；11 層逐一開關、水花數量存檔／重載／還原實測通過；Editor 與遊戲共用渲染、四道共 44 個圖層同時播放，missing／dropped 皆 0，瀏覽器無錯誤。274 項測試：273 通過、1 略過；build 331 檔通過；表格語意變更 0，素材 export --check 已最新。
- 限制：水花／煙塵為程序粒子，可調數量、速度、外觀；細部水片拓撲由公式控制。泛光可獨立關閉，但其形狀由浪尖公式產生。不同於舊圖集的逐像素重播；未操作使用者存檔實戰。提交到 ai/codex，未合併／推送。

## Codex｜水龍捲第十版接入（VFX-WATER-TORNADO-20260910）

- 狀態：Done；已接入水流彈第七階、同步 Excel／CSV／JS、Editor 可改中央半徑與上下端比例（預設 1／2／2）。
- 範圍：新 field-water-tornado Preset／layout／透明序列素材與製作來源、sprite 半徑輪廓參數與共用 Core／Pixi／Editor、Skills2 第七階特效欄及快取、測試與 VFX 文件。
- 預檢：ai/codex 工作區乾淨，相關檔案無其他副本／分支衝突。前置：桌面第十版已核准。
- 不改：技能傷害、半徑判定、召喚數量／節拍、其他技能 Preset、使用者存檔。
- 驗收：Editor 實測三參數修改／存檔／重載與還原；隔離瀏覽器以遊戲 Runtime／Pixi 同時播放四道，透明背景正常、missing／dropped 皆 0。271 項相關測試：270 通過、1 略過。建置 330 檔通過。Excel 僅 AC188／AD188 變更，其餘儲存格及 ZIP 內容保留；表格重建語意變更 0，export --check 已最新。
- 基線限制：冰系測試 5 項及舊 SKILLS 覆蓋測試 1 項失敗，已用修改前 HEAD 重現同樣 6 項；未操作使用者存檔實戰。預覽／驗證腳本留在 scratch，不納入提交。提交在 ai/codex，未合併／推送。

## Codex｜不規則普攻受擊試作（BASIC-IRREGULAR-20260909）

- 使用者確認實戰後要求 commit 供合併：提交紅白隨機爆破 author／Preset／layout、兩張原創 SVG 與素材索引、普攻映射／快取／相關測試。素材 export dry-run 無待同步；本輪 basic-melee／skill2-vfx 36/36。臨時預覽頁移除、不提交。未合併／推送；下方未 commit 為歷史記錄。

- 使用者核准接入：basicAttack／basicAttackExtra 的 hit 改為 hit-basic-irregular；仍只播放受擊、不恢復半月攻擊光效。主頁 data／bridge 與 Worker 快取更新，兩張原創碎片素材正式匯出。basic-melee／skill2-vfx 36/36；先前三次播放／回收無 dropped，未固定遊戲 seed。未 commit，待使用者實戰測試。

- 使用者要求依不規則爆炸／每次不同輪廓做普攻預覽。新增 hit-basic-irregular：主體也採 particle burst，兩類碎裂素材隨機位置、旋轉、大小、壽命，配少量長短不同尖刺與碎屑；使用者追加指定參考圖同色同形，改為白色爆心、紅色不對稱尖角；原創兩種 SVG 碎裂素材隨機組合，0.25 秒。未替換已接入 hit-basic-burst，先展示同時點不同種子的三次播放；無固定圓環／光暈。
- 新增 author／Preset／layout 與暫時預覽 basic-irregular-review.html；未改配置或遊戲流程，未 commit。

## Codex｜普攻黃白小型爆破（BASIC-BURST-20260909）

- 使用者核准接入並 commit：最終 0.25 秒、兩倍大小的 hit-basic-burst 已供普通／追加普攻使用，攻擊刀光已取消。納入使用者同期 hit-enemy／hit-phys／slash-enemy-melee Preset／layout 修改；素材重新匯出同步。提交前 basic-melee／skill2-vfx 36/36、BASIC-HIT／ROLE 2/2；臨時 basic-hit-review.html 移除，不提交。未合併／推送；下方未 commit 為歷史記錄。

- 後續依使用者調整：總長延至 0.25 秒，增加錯開的金色碎裂層與 6 道飛散短火花；再將本體寬高、粒子尺寸／散射距離放大至 2 倍。Preset 與 author 同步，編輯器／遊戲使用相同尺寸；標準尺寸與 authored 同步調整，避免遊戲縮放抵消放大。預覽更新，未 commit。

- 使用者要求製作並取代普攻受擊。新增 hit-basic-burst Preset／layout／author，黃白碎裂亮點與 7 顆金色碎屑，主體 normal 混色，亮心僅 11px／0.045 秒，總長 0.14 秒；自訂小型基準 3×3 米。普攻／追加普攻 defaults 改用新特效，其他技能 hit-phys 保留。主頁與 Worker 快取同步；素材正式匯出 161 presets。
- Schema 通過，basic-melee／skill2-vfx 36/36；預覽 basic-hit-review.html 與截图供檢閱，不提交預覽。未改使用者 hit-enemy／slash-enemy-melee 調整。未 commit。

## Codex｜普攻僅保留受擊（BASIC-HIT-ONLY-20260909）

- 使用者要求取消普攻攻擊特效。basicAttack／basicAttackExtra 只保留 hit-phys；Runtime 對 basic 事件只播 hit，兼容舊 Worker 帶 attack 欄的事件；Canvas／DOM 後備分支同步只畫受擊。保留角色揮擊動作、傷害、連擊與浮字時序，未改共享斬擊素材。
- 主頁及 Worker／bridge 快取更新；BASIC-HIT／ROLE 2/2、basic-melee／skill2-vfx 36/36。未操作存檔實戰，未 commit；已完成可供使用者重新整理遊戲測試。

## Codex｜反擊特效試作（VFX-COUNTER-20260909）

- 提交整理：使用者要求包含自行修改一起 commit，納入目前配置表、Preset／layout 與反擊接線全部變更；臨時 counter-review.html 移除。提交前重跑 skill2-counter-bloodrage／skill2-vfx 57/57、COUNTER Adapter 1/1；素材 export dry-run 無待同步，先前 build 329 檔通過。未合併／推送；下方未 commit 為歷史記錄。

- 使用者核准並要求接入：Excel Z62 攻擊特效清空／AA62 飛行子彈填 proj-counter-ripple，CSV／JS／catalog 同步；逐格驗證只有兩格差異，儲存格依欄序排列。每次 sgCounterStrike 向實際目標發射，涵蓋追加反擊與反殺，替換舊彙總事件；0.2 秒發射間隔、飛行 0.2 秒，傷害公式不變。Runtime counter-riposte 依 projectile 欄分派；主頁／Worker 快取更新，素材正式匯出 160 presets。
- 驗證：COUNTER Adapter 飛行／延遲／回收 1/1；skill2-counter-bloodrage 與 skill2-vfx 57/57。未操作使用者存檔；未 commit。

- 依使用者指派進入下一技能。技能說明表反擊第一階指定「帶淡淡波紋的飛行子彈，半透明白色系」；先製作 proj-counter-ripple，白色氣勁前端與三道淡化波紋，圓形飛行物標準半徑 6 米。
- 本輪先提供編輯器相同 Core／Pixi 預覽與截圖，待外觀確認；尚未改 Excel／CSV、遊戲事件或反擊時序。新增 author／Preset／layout，預覽頁不提交。

## Codex｜血刃斬、火龍捲與火牆整合提交（VFX-COMMIT-20260909-B）

- 使用者要求 commit 供合併；包含核准血刃斬／火龍捲／三柱火牆、0.3 秒寬高進退場、火柱圓形命中修正、Excel 儲存格順序修復，以及使用者 Skills2／毒液彈／龍捲的調整。保留毒液彈拆散圖層與龍捲透明度 0.8。
- 驗證：node --test tests/vfx-core.test.cjs tests/vfx-runtime.test.cjs tests/skill2-vfx.test.cjs：218 項中 217 通過，唯一未通過為 CATALOG-3 要求所有 layout 單根群組，使用者 proj-poison-drop 現有四個頂層圖層；未修改使用者排列或放寬測試。build_check：328 檔通過；素材 exporter dry-run 無待同步。
- 臨時 editor 預覽頁移除、不提交；正式素材與 author 保留。未修改其他工作區，未合併／推送。可由使用者合併，需知悉上述編輯器群組規範檢查仍未通過。下方未 commit 均為歷史階段。

## Codex｜火龍捲本體試作（VFX-TORNADO-INFERNO-20260909）

- 進退場補充：依使用者要求，寬度也與高度同步由 0 展開／縮回；仍各 0.3 秒、底部固定，保留原有圖層寬高比例。補上進退場中點兩軸縮放斷言，Runtime 快取 1.0.27；火牆三柱同步適用。未 commit。

- 進退場：使用者指定各 0.3 秒；Runtime 以場域首次生成時間控制底部向上長高／淡入，到期前 0.3 秒收回／淡出，同 id 續命不重播。火龍捲與火牆三柱共用，未改傷害節奏。Core 增加泛用 opacity transform，同時作用於 sprite／particle；主頁 Core 1.0.11、Runtime 1.0.26。TORNADO／FIREWALL 3/3；預覽 tornado-rise-review.html 不提交。未 commit。

- 火牆接入：依使用者指定改成三道目前火龍捲並排，沿用其手動加寬主體設定；ground-firewall Preset／layout／author 及舊 grounds 生成入口同步。Runtime 將三柱各自立在火牆長軸上，只旋轉底部排列，保持各柱比例與直立，使用 fx 層並續命／回收。使用者追加間距縮小 20%，允許外緣重疊，已套用；傷害矩形與施放節奏不變。Runtime 主頁快取 1.0.25；素材正式匯出完成，FIREWALL／TORNADO／FIELD／GROUND 8/8 通過。預覽 firewall-review.html 不提交；未 commit。

- 壓扁修正：sgCastFirepillar 在第一至六階也無條件傳入第七階長寬，導致 sgGroundArea 與 sgGroundVictims 誤走矩形；改為只有 wall 傳長寬，pillar 僅用 radius。新增實際施法→場域幾何→等比例縮放及圓形命中回歸，保留第七階矩形。Skills2／Worker／bridge 快取同步更新；skill2-vfx 33/33 通過。未更改 Excel／CSV 或核准素材外觀；未 commit。

- 回報修正：新增 AD92 曾錯放在 AI92 後，造成原生 Excel 修復警告；已依欄序重新排列 OOXML 儲存格，逐格核對值完全不變、所有工作表欄序與唯一性檢查通過。使用者關閉 Excel 後已覆寫原檔，原檔另備份於系統暫存目錄。仍待使用者以原生 Excel 重開確認。
- 實戰落差：程式在第七階已學習時明確改用 wall／vfxTier 7，指向 ground-firewall；核准新本體只在 pillar／第一阶 fire-tornado-inferno 使用。截圖舊火牆與此分支相符，並非新本體素材被替換。尚未製作第七階火牆新版，不能宣稱整棵技能樹均已換新。聚焦 mapping／Adapter 測試 2/2 通過；本輪未改技能機制或第七階映射，未 commit。

- 接線完成：使用者核准中央金黃主螺旋版並要求接入。Skills2 Excel AC92 清空／AD92 填 fire-tornado-inferno，CSV／JS／catalog 同步；逐格核對只有這兩格變更，原視圖／格式保留。火牆與其他技能維持原設定。主頁、Worker 與 bridge 資料快取更新，正式素材 exporter 同步完成。
- 接線驗證：TORNADO Adapter 目標位置、等比例縮放、同 area.id 跨節拍沿用與到期回收 1/1；skill2-vfx 32/32；build 328 檔通過。未操作使用者存檔實戰。未 commit；保留使用者其他未提交配置與毒液彈修改。下方「尚未接入」為歷史階段。

- 中央聚光調整：依最新對照圖，頂／底旋渦降亮至原 45%，細流亮度由中央向兩端衰減、地面光暈降低；加一條連續金黃主螺旋，前後亮度與粗細漸變。保留細密底層火流，不採用先前被否定的整體疏環方案。schema、10 秒播放／回收通過，截图與動態預覽更新；尚未接入遊戲。

- 最新回調：使用者認為疏環粗線版過假，要求回到先前較真實版本。恢復第三版 47 組／5 條細流與較柔和亮度，移除粗火帶，僅保留 0.85～1.15 倍的小幅粗細差異。已重新生成並通過 schema，預覽截圖與動態已更新；第四版不再是目前候選。

- 第四版：依使用者要求降低環流密度，主體 47→17 組、每組細流 5→3 條；頂部／底部旋渦 26→16 條。加粗少數金黃主流與橙色輝光，保留環間空隙、局部起伏與地面煙塵。schema 與 10 秒播放／回收檢查通過，預覽截圖更新；尚未接入遊戲。

- 第三版（參考圖環流方向）：使用者要求以環狀火流構成主體並進一步復刻提供的參考圖。改為密集細橢圓流線、局部膨縮與不對稱腰部；上方新增寬大傾斜旋渦、底部新增向外鋪開旋渦，腰部提高金黃色層次。保留地面煙塵與低矮火舌，降低表面大火焰比重。64 幀／2.5 秒循環；schema、10 秒 Core 播放／回收檢查通過，Pixi 截圖與預覽更新。此版為目前候選，尚未接入遊戲。

- 第二版：依使用者回饋移除實心圓筒，改為多股帶空隙的曲折火舌；局部半徑與火流粗細不同步膨縮，減淡完整螺旋線。圖集 32→64 幀、循環放慢為 2.5 秒，外層粒子降低亮度並延長淡入淡出。依追加要求新增少量地面煙塵與低矮火焰（獨立可編輯 particle 層）。
- 第二版驗證：schema 通過；Core 10 秒播放無 dropped effects／particles，stopAll 後 activeEffects=0；窄畫面單體近看截圖與動態預覽更新。仍待外觀確認，未接入遊戲，未更改技能配置。

- 狀態：第一版預覽完成，待外觀確認，尚未接入遊戲。
- 規格：技能說明表 I145：中心火柱、外圈火焰粒子纏繞、上下扭曲、深黃紅色；基礎作用約 2.5 秒。先製作本體，未改火牆／重生／超神機制。
- 新增：fire-tornado-inferno author、Preset／單根 layout、32 幀原創 SVG 螺旋圖集與素材索引。分層火柱／前後盤旋火流／上升火舌／餘燼。自訂基準寬 6 米、高 12 米，原點在底部。圖集同步本機 effects-materials，repo 保留可重製素材。
- 驗證：製作工具 schema 通過；Core 連播 10 秒無 dropped particles／effects，stopAll 回收為 0；Pixi 三時點截圖與動態播放已檢查。預覽 tools/vfx/editor/tornado-review.html 不納入提交。
- 檢查未改：使用者 Skills2、proj-poison-drop 變更、既有 fire-tornado／ground-tornado-fire、遊戲 Runtime。Commit 尚未建立；未接線，待使用者確認外觀後處理持續場域欄與素材匯出。

## Codex｜血刃斬爆破試作（VFX-BLOODBLADE-20260909）

- 後續調整：使用者要求保留綠色中毒效果、加長紅色爆破。總長 0.28→0.6 秒；紅色主體 0.17→0.52 秒並延長中段停留，血珠壽命 0.35～0.6 秒；亮心仍 0.05 秒。author／Preset／catalog 同步，0.3 秒主體透明度仍高於 0.7 與結束回收測試通過，預覽截圖更新。未更改中毒特效或技能表。

- 狀態：使用者核准紅色單點爆破，已接入血刃斬第一階攻擊本體。
- 規格來源：技能說明試算表 I82「一個單點爆破並有濺射粒子的攻擊特效，紅色系」；I85 中毒為綠色半透明遮罩。
- 新增：author/bloodblade.cjs、hit-bloodblade-burst Preset 與單根 layout；圓形基準半徑 6 米，亮心 0.05 秒、整體 0.28 秒，血珠由命中點向外飛散。
- 驗證：製作工具的 Preset／layout schema 驗證通過；Editor 相同 Core＋Pixi 後端三個時點截圖及播放按鈕檢查。預覽 tools/vfx/editor/bloodblade-review.html 僅供檢閱，提交時排除。
- 檢查未改：原 slash-bloodblade、Skills2 配置／技能 JS、Core 與 Editor；製作期間使用者另有 Skills2 CSV／Excel／JS 變更，保留。
- 接線：Skills2 Excel Z42／CSV／JS 與 catalog 指向 hit-bloodblade-burst；主頁與 Worker 快取更新。Excel 逐格核對僅這一格改變，原始 OOXML 格式／視圖保留。素材 export dry-run 已最新，無缺圖。
- 驗證：BLOODBLADE Adapter 目標定位、無 fallback、到期回收 1/1；skill2-vfx 31/31。未操作使用者存檔實戰。未 commit。
- 未完成：中毒遮罩及高階感染／屍爆視覺屬後續改造；本次核准的第一階爆破已完成接線，其他技能機制與既有特效保留。

## Codex｜本輪整合提交（VFX-CONFIG-COMMIT-20260909）

- 使用者已授權連同自行調整的配置表一起 commit；本輪提交包含工作區現有 CSV／Excel、對應技能／狀態 JS、使用者雷球 Preset／layout、月牙修正、持續場域欄、Editor 儲存自動匯出及相關測試文件。
- 最終狀態以此段為準：下列各任務「尚未 commit」為當時紀錄，本輪統一提交；素材同步已自動化，舊段落的手動匯出限制已由 VFX-AUTO-SYNC 解決。Windows ownership 換行阻塞也已解決。
- 提交前驗證：editor-save／asset-export／skill2-vfx／worker-protocol 共 125 通過、2 環境限制跳過；GALE／FIELD／GROUND／ROLE／RAIN 共 16 通過；素材 export dry-run 已是最新、無待同步檔。先前 build 328 檔通過。
- 未納入：scratch 預覽、參考素材、臨時測試產物。未修改其他工作區，也未合併或推送。
- 未完成：素材選擇介面「已在遊戲」亮色標示仍待同檔分段修改授權，未包含在本次提交。現有已完成功能可合併；存檔實戰由使用者測試。

## Codex｜編輯器儲存自動同步素材（VFX-AUTO-SYNC-20260909）

- 狀態：Done；使用者要求按儲存時自動匯出，不另加手動匯出選項。
- 修改：editor-server 正式儲存 Preset 後執行既有 transactional exporter，完成才回 HTTP 200；失敗回 500 並明示設定已保存、素材未同步，可重試。既有安全寫入與匯出防護保留。遊戲 JSON 設定／素材索引改 no-store，主頁 Runtime 快取 1.0.24。
- 驗證：editor-save／asset-export／skill2-vfx 共 116 通過、2 跳過；build 328 檔通過；本機 8358 真實 PUT 儲存使用者雷球成功且內容未變。Codex 的 8358／28361 服務已重啟套用，其他工作區服務未動。
- 檢查未改：Editor 前端（Claude 複製按鈕提交佔用）、使用者 Preset／layout。Commit 未建立；工作區含其他任務與使用者修改。可整理提交後合併。
- 後續使用者新增「素材是否已在遊戲」視覺標示：editor.js／editor.css／index.html 有 Claude 75434ab 同檔未合併提交，已依 AI_RULES §3.2 詢問分段修改授權，等待回覆；此標示尚未實作。

## Codex｜雷球換素材後退回舊畫法（VFX-ORB-ASSETS-20260909）

- 狀態：Done。Skills2 已正確讀入 field: lightning-orb-field；Preset 新增的 light-masks-1.0/transparent/circle_b.png 未列入 shipped index，registerPresets 失敗令 boot 回 null，整體退回舊畫法。
- 修改：export-assets 的 ownership 精確比對僅容許 Windows CRLF 換行差異（其餘內容仍拒絕）；回歸測試；正式執行素材匯出至 99 張，補齊貼圖／索引並清除三張已無正式 Preset 引用的舊月牙素材；Runtime 資料快取與主頁 1.0.23、快取測試。本機素材來源保留。
- 檢查未修改：使用者 lightning-orb-field Preset／layout、Skills2 CSV／JS 欄位。未重新設計雷球。
- 驗證：asset-export／skill2-vfx 共 80 通過、1 跳過（環境無符號連結權限）；build 328 檔；使用正式 shipped index 與使用者 Preset 的 Adapter 截圖通過。尚未操作存檔實戰。
- 限制：Editor 儲存 Preset 本身不自動執行素材匯出；換用尚未匯出的貼圖仍需執行 tools/vfx/export-assets.cjs。此次已解除 Windows ownership 換行阻塞，未擴大改寫 Editor 儲存流程。Commit 未建立；工作區既有使用者修改保留，整理提交後可合併。

## Codex｜原版厚亮月牙與高不透明紫邊（VFX-MOON-OPAQUE-20260909）

- 狀態：Done；使用者核准試作並要求換入遊戲測試。
- 修改：正式 slash-gale-moon Preset／layout／gale author、三張素材與素材索引、Runtime 資料快取及主頁 1.0.22、快取測試。正式檔名不變；保留既有目標朝向、技能配置與傷害節奏。
- 驗證：Preset schema 通過；GALE 2/2、skill2-vfx 31/31、build 328 檔；正式 Adapter 左前方三連斬截圖通過。檢查未修改：技能表、技能事件、VFX Core／backend。
- 限制：保留大招白亮感，重疊中央仍可能連成亮面；舊匯出 ownership 問題未變，本次只增素材並更新 dry-run shipped index。尚待使用者實戰測試。
- Commit：尚未建立（沿用上一任務與使用者未提交變更）；預覽不提交。無接線未完成項，整理提交後可合併。

## Codex｜月牙斬目標朝向修正（VFX-MOON-FACING-20260909）

- 狀態：Done。原因：原本只套三連斬角差，漏掉施法者到目標的方位角，導致刃口固定朝向。
- 修改：vfx-runtime 月牙分支採 atan2（目標－施法者）加原有角差；index 快取 1.0.21；兩份既有測試及本文件。未改但檢查：正式月牙 Preset、技能事件及傷害範圍。特效仍以主目標為中心，未新增飛行或改變傷害。
- 驗證：GALE 2/2（八方位、指定來源、同座標及連斬重設）；skill2-vfx 31/31；build 328 檔通過。正式 Adapter 左前方目標三連斬截圖通過；未操作使用者存檔實戰。
- 交付：slash-gale-moon.json 檔名不變；重新整理遊戲後生效。Commit 未建立（工作區含上一任務及使用者未提交修改）；功能無未完成項，提交整理後可合併。scratch 驗證頁不提交。

## Codex｜持續場域特效欄（CONFIG-VFX-FIELD-20260909）

- 狀態：Done；使用者要求在 Excel／CSV「地板特效」後新增「持續場域特效」。
- 修改：Skills／Skills2 CSV／Excel、config_tables 六欄讀寫與中文說明、Skills2 雷球及伴生雷球欄位遷移、VFX Runtime field 分流、Worker protocol v28 與快取、三份既有測試及協議／VFX 文件。
- 行為：field 是持續本體（fx 層），ground 是地面提示（zone 層）；同一 area.id 可同時存在兩者並各自續命回收；舊 ground 仍相容。只移雷球與伴生雷球兩列，其他技能與所有傷害／速度／時間數值保留。
- 表格：Skills2 新欄 AD、Skills 新欄 S；新欄標題附用途說明，說明頁同步。逐格核對原值無額外差異，保留使用者欄序與原凍結位置；新版／舊 CSV、欄位重排、檔名帶 .json 的回寫檢查通過；兩表 apply dry-run 語意差異 0。
- 驗證：`node --test --test-name-pattern="FIELD|GROUND|ROLE|RAIN" tests/vfx-runtime.test.cjs` 14/14；`node --test tests/skill2-vfx.test.cjs tests/worker-protocol.test.cjs` 40/40；`node tools/build_check.cjs` 328 檔通過，表格欄位預覽已檢查。
- 檢查未改：VFX Core、既有雷球 Preset、Skills JS 與 Status；未操作使用者存檔實戰。
- Commit：未建立；Skills／Skills2 配置與技能 JS 內混有使用者原先未提交變更，本次保留，未將它們一起提交。沒有功能未完成項；可供審查，合併前需整理提交。臨時腳本與預覽不納入提交。

## Codex｜月牙斬重疊辨識成品（VFX-MOON-READABLE-20260909）

- 狀態：Done；使用者確認藍紫刃面、薄亮刃口、掠光星芒及碎晶版本，已正式接入。
- 範圍：替換既有 slash-gale-moon Preset／layout／author、三張原創 SVG 素材及索引、Runtime 小幅角度交替與快取；不動使用者正在修改的 Skills2 表格及 JS。
- 驗收：遊戲與編輯器共用正式 Preset；三連斬正常混色、亮度不相加成整塊白；依既有事件半徑等比縮放，傷害判定與攻擊節奏不變。
- 修改：slash-gale-moon Preset／layout、gale author、三張 SVG 及 asset-index／shipped-assets、vfx-runtime／index 快取、兩份既有測試及本文件。檢查但未修改：VFX Core／Pixi backend／Editor、config_tables 與使用者 Skills2 配置。
- 測試：`node --test tests/skill2-vfx.test.cjs` 31/31、`node --test --test-name-pattern=GALE tests/vfx-runtime.test.cjs` 1/1、`node tools/build_check.cjs` 328 檔通過、Preset schema 通過。CSV 既有測試改依中文欄名讀獨立距離欄，支援使用者換欄序。
- 畫面：正式遊戲 Adapter 三道刀光（0.08 秒壓力展示，未更動遊戲配置間隔）截圖通過；Editor 已載入四層正式 Preset 並通過驗證。未操作使用者存檔實戰。
- 限制：既有匯出目錄 ownership 標記與工具預期不符，整批匯出拒絕執行；本次僅新增三張素材並採工具 dry-run 生成的 shipped index，未更動其餘素材或標記。此工具既有問題另案處理。
- 交付：正式檔名 slash-gale-moon.json；可合併本次提交，未自行合併或推送。使用者未提交的表格／技能 JS 保留；scratch 預覽不提交。下一步重新載入遊戲確認實戰效果。

## Codex｜Skills2 獨立距離與間隔欄（CONFIG-SKILLS2-COLUMNS-20260909）

- 狀態：Done；使用者要求 Excel／CSV 獨立欄位及清楚的中文欄名。
- 範圍：config_tables Skills2 extract／rebuild、表格與欄位定義；既有 fx 數值不變，距離／間隔／長寬／角度及其每級增量移到獨立欄，JSON 保留其餘參數。
- 驗收：全表往返語意差異 0；獨立欄數值擾動、舊格式相容、空值刪除及非法數字驗證通過；技能測試 90/90，build 328 檔。Excel 核對 34 欄、凍結 D2、篩選 A1:AH231 及疾風斬預設值。
- 修改：config_tables、Skills2 CSV／Excel、本文件。無遊戲 JS 或技能數值修改；獨立欄於 V～AG，AH 為唯讀作用說明，JSON 不重複保留拆欄的鍵。無未完成項，可合併；未自行合併／推送。

## Codex｜縮短受擊特效（VFX-HIT-TIMING-20260909）

- 狀態：Done；使用者同意一般受擊 0.10～0.15 秒、重擊爆炸 0.18～0.25 秒、亮心在前 0.05 秒退去。
- 範圍：13 份既有受擊 Preset 的時間／淡出、製作腳本、快取、測試及比較預覽；不動技能本體與場域、使用者突刺與飛刀。
- 預檢：Antigravity 的受擊 JSON 被 Git 標示修改，但 git diff 無內容、13 份 JSON 逐一比對完全相同，無實際內容重疊。
- 驗收：一般總長 0.14 秒、爆炸／強雷擊 0.22 秒；序列與粒子同步縮時、亮心不超過 0.05 秒；相同 25 點密集場景前後截圖完成。定向檢查 33/33，build 327 檔，schema 全部通過。
- 修改：13 份受擊 Preset、hit-timing 製作轉換、hits author 接線、Runtime／主頁資料快取與既有快取測試。技能本體、傷害與 layout 不變；瞬間同時受擊仍可能亮，但餘光停留顯著縮短。可合併，未推送／合併 develop。
- 清理：使用者要求參考圖與臨時測試產物不提交；臨時驗證完成後清除，已核准的未接線飛刀試作移至 repo 外保留。

## Codex｜疾風斬可調距離與間隔（VFX-GALE-CONFIG-20260909）

- 狀態：Done；使用者要求把範圍參數列入 Skills2 表供自行調整。
- 範圍：Skills2 第一階明列 castM／gap、第七階明列 castM，既有四／七階 m 保留；JS 接線、CSV／Excel／說明、快取與定向測試。
- 禁止：不改 Antigravity 飛刀、使用者突刺檔與傷害倍率；沿用已授權的共享配置分段修改。
- 驗收：配置擾動測試確認施放距離 9／11 米、月牙半徑 8 米、間隔 0.35 秒的接線有效；正式值仍為 5／5 米、5 米、0.2 秒。相關測試 143/143；build 326 檔；表格往返語意差異 0；唯讀核對 Excel L32／L35／L38。
- 修改：Skills2 JS／CSV／Excel、config_tables 欄位說明、Worker／主頁快取、技能測試及本任務。未修改但檢查：Antigravity 飛刀與使用者突刺。無本次未完成項，可審查合併；未合併／推送 develop。

## Codex｜疾風斬特效改造（VFX-GALE-20260909）

- 狀態：Done；使用者確認月牙外形並明確要求先接入遊戲。
- 規格：前六階黃白單點爆破；七階由上往下藍紫月牙；未另訂間隔採 0.2 秒。先截圖確認外形再串接。
- 範圍：新 hit-gale-burst／slash-gale-moon Preset、layout、gale author、後續必要事件／表格／Runtime／測試／文件。
- 衝突：Antigravity 對舊 slash-gale-sector 有未提交修改；本次先用獨立新 Preset，不動舊檔。使用者突刺修改保留。
- 完成：前六階目標爆破、七階目標中心單一道月牙；半徑取七階 fx.m，等比縮放。傷害與 VFX 每 0.2 秒同拍，換場清除未完成波次；霹靂一閃等最後一斬才結算。
- 修改：Skills2 JS／CSV／Excel、VFX Runtime、Worker 快取、目錄／尺寸契約、兩份新 Preset 及 layout、gale author、相關測試及使用者預覽檔名偏好。
- 驗證：技能／魔法／超神定向測試 143/143；GALE Adapter 測試 1/1；build 326 檔；Skills2 apply dry-run 語意差異 0；遊戲 Adapter 獨立場景截圖通過。
- 限制：未在使用者現有存檔進行實戰操作；VFX Runtime 全集合的單一根群組檢查被使用者既有 slash-thrust-lance layout 三根群組修改擋住，本次不覆蓋。其餘 Adapter 測試通過。
- 接線授權：使用者知悉 Antigravity 有共享技能配置修改後要求先接入；只修改疾風斬設定，保留對方飛刀版本。未修改舊 slash-gale-sector、飛刀與使用者突刺檔。
- 合併：可審查合併本次疾風斬提交；未自行合併或推送 develop。飛刀仍為已核准獨立預覽，尚待正式化與接線。

## Codex｜迴旋斬多波間隔（VFX-CLEAVE-GAP-20260909）

- 狀態：Done；使用者要求每波 0.2 秒，並設為未特別指定時的多段攻擊預設。
- 完成：共用 SG_MULTI_ATTACK_GAP_SEC=0.2；突刺沿用，迴旋斬視覺／傷害起飛／近戰浮字同步，四方向同波齊發。規則已記入 prompts/codex.md。
- 修改：js/skills2.js、js/bridge.js、js/worker/sim.worker.js、index.html、兩份技能測試、本文件與 prompts/codex.md。檢查但未修改：使用者突刺 Preset／layout。
- 驗證：node --test tests/skill2-system.test.cjs tests/skill2-vfx.test.cjs（65/65）；npm.cmd run build（326 檔）；diff check；已更新預覽並截圖。
- 限制：未全域重寫其他技能既有專用節奏；後續技能無特別指定時使用 0.2 秒。碰撞／傷害數值／二次命中保留。無本次未完成項，可審查合併，未自行合併／推送 develop。
- 範圍：Skills2 共用預設常數／突刺及迴旋斬引用、快取、節奏測試與文件。
- 預檢顯示的 Antigravity 提交均為當前已包含的 Codex 提交；HEAD..ai/antigravity 的 Skills2 記錄與檔案 diff 均為空，無實際衝突。

## Codex｜迴旋斬特效改造（VFX-CLEAVE-20260909）

- 狀態：Done；Owner：Codex；使用者確認半月刀光外形，已串接遊戲。
- 使用者持續偏好：每次製作新特效，先截圖展示，再依回饋調整。
- 規格：技能表 J46／K46 參考圖；近半圓黃紅刀光，五階偏紅黃，六階變飛行，七階四方向連斬。
- 範圍：迴旋斬 author／Preset／layout、必要的 Runtime／技能事件／表格 VFX 欄位／快取／測試／文件。
- 保留：使用者尚未提交的突刺 Preset 與 layout，不覆寫或代為提交。
- 完成：一階黃紅半月刀光、五階紅黃版、六階前向飛行、七階四向連斬；每波各發一則事件並同步飛行傷害起飛時間，保持本體尺寸。
- 修改：迴旋斬 author／兩份 Preset／layout、Runtime、Skills2、CSV／Excel VFX 欄位、快取、catalog、相關測試與本文件。未修改但檢查：Worker shim、使用者突刺 Preset／layout。
- 測試：node --test tests/skill2-system.test.cjs tests/skill2-vfx.test.cjs tests/vfx-tower.test.cjs（70/70）；node --test --test-name-pattern=CLEAVE tests/vfx-runtime.test.cjs（1/1）；npm.cmd run build（326 檔通過）；Skills2 往返語意 0；diff check。
- 已知限制：廣泛 VFX 測試另有使用者突刺檔案缺 sizing／群組改動引起的失敗，未覆寫使用者修改。現有遊戲近戰選敵／七階 60 度扇形／六階前向飛行與表格部分描述不同，本輪不改傷害與碰撞；視覺本體依文檔六米半徑。既有飛行物二次命中保留，連斬傷害跟著波次錯開。
- 未完成：無本次迴旋斬視覺串接未完成項；上述規則差異留待企劃獨立調整。Commit 見本次迴旋斬提交，可交付審查，未合併／推送 develop。

## Codex｜突刺粗度與節奏調整（VFX-THRUST-TUNING-20260909）

- 狀態：Done；使用者授權視覺寬度 2 倍、前進速度 2 倍、每波 0.2 秒。
- 範圍：Skills2 突刺速度／波次、Runtime 視覺寬度、快取、相關測試與文件；碰撞寬度與傷害數值維持。
- 修改：js/skills2.js、js/vfx-runtime.js、js/bridge.js、js/worker/sim.worker.js、index.html、4 份相關測試、本文件及尺寸文檔。檢查但未修改：突刺 author／Presets、Core。
- 驗證：node --test tests/vfx-runtime.test.cjs tests/skill2-system.test.cjs tests/skill2-vfx.test.cjs tests/vfx-tower.test.cjs（118/118）；npm.cmd run build（326 檔通過）；git diff --check。預覽更新為每 0.2 秒一波三連刺。
- 已知影響：貫穿傷害飛行速度由 240 改為 480，間隔由 0.09 改為 0.2 秒；傷害與碰撞範圍維持。無未完成項。Commit 見本次調整提交，可審查／合併，未自行合併或推送 develop。

## Codex｜突刺向外貫穿動畫修正（VFX-FLIGHT-20260909）

- 狀態：Done；使用者要求槍形由中心向外行進，不以射程拉伸本體。
- 授權範圍：VFX Core／Runtime、Skills2 事件、突刺 author／Presets、快取版本、相關測試與文件。
- 完成方向：保持槍身比例，初段從中心伸出，之後固定長度行進；travelMs 使用模擬速度，保留三道與八方向。
- 驗證：node --test tests/vfx-runtime.test.cjs tests/vfx-size.test.cjs tests/skill2-vfx.test.cjs tests/skill2-system.test.cjs tests/vfx-core.test.cjs（249/249）；追加 system／tower（39/39）；npm.cmd run build（326 檔）；git diff --check。
- 修改：上述授權檔案與測試；未修改但檢查：Worker shim 已傳遞 bodyLength／travelMs，未更動協議。預覽可循環觀察移動。
- 限制：首三階既有直接傷害結算維持，貫穿階段維持模擬掃描；起始段是由零長度伸出至固定槍身，之後不再按射程拉長。
- 未完成：無本次修正未完成項；Commit 見本次 fix，可交付審查／使用者合併，不自行推送或合併 develop。

## Codex｜技能特效尺寸標準化與突刺改造（VFX-20260908）

- 狀態：Done（2026-09-09）；Owner：Codex；使用者確認採用突刺與五階穿槍圓環。
- 完成：148 份正式技能 Preset 建立尺寸契約；依明訂尺寸或預設米制尺寸正規化，再按實際範圍縮放；修正局部旋轉與非等比尺寸的矩陣組合。突刺依參考图 J34／K34 重製黃白／黃紅光槍、交錯光帶、飛濺與三枚朝右穿槍淡出圓環，支援平行／八方向／連段。
- 修改：js/vfx-core.js、js/vfx-pixi-backend.js、js/vfx-runtime.js、js/skills2.js、js/bridge.js、js/worker/sim.worker.js、index.html；vfx/presets、三份突刺 layouts；tools/vfx/authoring 製作與尺寸工具；Skills2 CSV／Excel；相關測試與 docs/vfx 文件。
- 未修改但檢查：js/battle-renderer.js、js/vfx-tower.js、js/vfx.js、js/worker/shim.js、js/battlefield.js、編輯器與素材索引、協作規範。
- 測試指令：node --test --test-concurrency=2 tests/vfx-*.test.cjs tests/skill2-system.test.cjs tests/skill2-vfx.test.cjs tests/worker-shim.test.cjs tests/basic-melee.test.cjs；npm.cmd run build；node tools/config_tables.cjs --apply Skills2；git diff --check。
- 結果：641 項中 637 pass／2 skip／2 原有 fail（vfx-editor-layers 的 L36 與 R3，已用 HEAD 獨立副本確認同樣失敗）；build 326 檔通過；Skills2 往返語意變更 0；diff check 通過。完整 npm test 曾因長時間停滯取消，未宣稱全套通過。
- 實機：本機 Pixi 預覽、VFX Editor 載入及播放合法；使用者確認輪廓、配色及五階圓環。每份突刺維持單一根群組；所有素材已在 shipped-assets。
- 已知限制：貫穿後續波次以相同 delayMs／beginSec 錯開實際起飛，傷害係數／波數／碰撞規則不變；legacy 除錯特效未重製；不規則形狀採個別尺寸；原有兩項編輯器測試失敗仍待其他任務處理。
- 未完成項目：本次尺寸標準化與突刺無；其他技能的外觀大改依序另行製作。
- Commit：見本次 [Codex] feat 提交；可交付 Review／使用者合併，未自行合併或推送 develop。

## Codex｜普攻近戰改造（MELEE-20260908）

- 狀態：Done；Owner：Codex；使用者授權直接實作並驗證。
- 內容：普攻取消飛行劍氣、沿用近戰距離；恢復既有角色揮砍動畫並依攻速縮放，追加連擊不重播主動作。
- 允許修改：`js/combat.js`、`js/battle-renderer.js`、`js/bridge.js`、`js/worker/sim.worker.js`、`index.html`、相關測試與本文件。
- 禁止修改：傷害公式、連擊數值、存檔格式、其它技能規則與其他工作副本。
- 前置依賴：無；本次目標檔案衝突預檢乾淨。
- 測試：近戰距離／VFX 事件／動畫分流定向回歸、build、瀏覽器實機與 diff check。
- 完成：普攻事件改為 slash／melee（追加 melee-extra），浮字取消飛行延遲；共用實際攻速倍率決定動畫週期，完整素材按影格比例加速；Preset 接手普攻後仍播放角色動作，其他技能分流維持原行為。
- 修改檔案：上述 5 個程式／快取檔、本文件、tests/basic-melee.test.cjs、tests/player-event-float.test.cjs、tests/skill2-vfx.test.cjs。
- 未修改但已檢查：js/battlefield.js、js/vfx-runtime.js、js/vfx.js、js/vfx-tower.js、js/data.js、images/sprites/player.json／player.png、js/worker/protocol.js、專案協作規範。
- 測試指令：node --test tests/basic-melee.test.cjs tests/player-event-float.test.cjs tests/battlefield.test.cjs tests/combo-hits.test.cjs tests/skill2-vfx.test.cjs tests/vfx-runtime.test.cjs tests/battlefield-rt.test.cjs tests/skill2-counter-bloodrage.test.cjs；npm.cmd run build；git diff --check。
- 結果：175/175 回歸通過、build 325 檔通過；新增 3 項測試覆蓋傷害與連擊分組、零飛行與近戰 Preset 選擇、Preset 接手仍播動畫、攻速縮放與死亡守門。
- 實機：隔離本機預覽 18 秒捕捉 7 次普攻，全部 slash／melee、travelMs=0，取樣到 idle／walk／attack1／attack2／attack3；正式遊戲頁開啟時 console 無 error／warning。取樣工具頁曾出現一筆 MutationObserver 非 Node 錯誤，遊戲內錯誤監聽為 0，未把工具頁的錯誤宣稱為遊戲回歸。
- 已知限制：傷害維持原本出手時結算，尚未改為特定揮刀影格扣血；低攻速沿用素材原速，高攻速縮短完整揮擊；高塔沿用卡片版面與近戰斬擊特效，沒有野外角色動畫。完整 npm test 本輪未執行。
- 未完成項目：無本次程式實作未完成項；高塔與極端攻速的人工體感可在整合前複查。
- Commit：見本次 [Codex] feat 提交。可交付 Review／由使用者合併。
- 後續接手者：使用者／主整合工作區；不自行合併 develop。

## Codex｜參考圖鍛鐵 UI 改造（UI-20260907）

- 狀態：Done（2026-09-08）
- Owner：Codex；使用者直接授權整體 UI 改造。
- 工作目錄：`D:\MyGames\Idle-RPG\codex`（使用者指定，本次及後續 Codex 任務使用）。
- 內容：依 200火花.png 重製高清鍛鐵九宮格邊框、灰黑石材面板、猩紅按鈕、角色展示與裝備欄、紫黑 tooltip；保留遊戲操作與資料流程。
- 允許修改：`index.html`、`css/ashen-forge.css`、`images/ui/ashen-forge/`、本文件、`prompts/codex.md`、`js/ui-scale.js`、`tests/ui-fixed-canvas.test.cjs`、UI 驗證與交接文件。
- 禁止修改：戰鬥規則、數值、存檔、Worker 協議與其他 AI worktree。
- 前置依賴：無；2026-09-07 衝突預檢乾淨。如發現其他 AI 同檔修改，依使用者授權另建分支隔離。
- 追加需求：邊框約放大兩倍、同步留足外側與內容間距；移除固定畫布上下留黑，依視窗填滿可用高度（含全螢幕）。
- 完成：使用乾淨灰鐵透明圖檔與比例平鋪，消除邊框雕飾拉伸；全部原生捲動條統一灰色。
- 驗證：build 324 檔通過、31 項相關測試通過；Edge 各主要分頁、裝備選取與 tooltip、窄視窗操作正常，console／資源錯誤為 0；Fullscreen API 下畫布完整填滿 1920×1080；16 個可捲動容器的計算樣式均為同一灰色。
- 交接：`docs/UI_ASHEN_FORGE.md`；預覽 `http://127.0.0.1:8347`。
- 後續接手者：使用者／主整合工作區；不自行合併 develop。

## Claude｜VFX Preset 化：用 VFX 編輯器重做全部戰鬥特效（2026-09-03）

- 狀態：Done（程式與資料全部完成；剩人工目視 QA）
- Owner：Claude（VFX 工作流：Lead Engineer；Codex／Antigravity 未呼叫）
- 任務分類：VFX（Preset／Runtime Adapter）＋ 參數表欄位（技能表、狀態表）
- 使用者需求：(1) 用現有 VFX 編輯器重做遊戲全部特效；(2) 技能表新增多個特效欄位，該技能用到的特效都寫上檔名、之後自己改；(3) 狀態的特效也寫在 Status。
- 追加規則（使用者 2026-09-03）：**每個特效做好之後，它的所有 LAYER 都組成一個群組**——之後 Editor 要能同時打開多個特效編輯。
- 設計與交接文件：`docs/vfx/VFX_RUNTIME_ADAPTER.md`（架構、角色語意、名目尺寸、進度、emit 點標記對照表、驗證重點）。
- 前置依賴：無。衝突預檢（.claude/check-conflicts.ps1）2026-09-03 對全部目標檔均為「可以直接改」。
- 允許修改：`js/vfx-core.js`、`js/vfx-pixi-backend.js`、`js/vfx-runtime.js`（新）、`js/battle-renderer.js`、`js/skills.js`、`js/skills2.js`、`js/status.js`、`js/combat.js`、`js/data.js`、`js/legendary.js`、`js/potential.js`、`js/tower.js`、`js/vfx.js`、`js/worker/protocol.js`、`js/worker/sim.worker.js`、`js/bridge.js`、`index.html`、`tools/config_tables.cjs`、`tools/vfx/**`、`config/CSV|Excel/{Skills,Skills2,Status}.*`、`vfx/presets/**`、`vfx/layouts/**`、`vfx/shipped-assets.json`、`images/vfx/assets/**`、`docs/vfx/**`、`docs/WORKER_PROTOCOL.md`、相關測試與本文件。
- 禁止修改：戰鬥數值、技能規則、存檔格式、高塔 DOM 路徑（`js/vfx.js` 維持舊畫法作為退回）。
- 已完成：
  1. Core 擴充：`setTransform(handle,…)`、`play({scaleX, scaleY})`（commit 207138d）。
  2. 參數表：Skills／Skills2 五欄、Status 三欄；§4 目錄修正後重填並回寫（Skills2 語意變更 1，Skills／Status 0），xlsx 一併重生。
  3. 發送端：`skillVfxSpec`／`sgVfxRoles`；**`js/skills2.js` 的 119 個 emit 點列標記全部補齊**（對照表 §3）。
  4. 協議 v26（`vfx` 欄位）與 **v27**（`presetOnly` 旗標，狀態每跳用）。
  5. **Preset 146 份全部完成**（受擊 13、斬擊 11、飛行子彈 20、天降／光柱／光束 8、範圍爆發 16、地板與環繞 33、施放 8、詛咒 3、狀態 34）；素材匯出 35 → 85 個。
  6. **每份 Preset 一個根群組**（`vfx/layouts/`），`kit.write()` 自動產生；規則寫進 README 與設計文件。
  7. **Runtime Adapter `js/vfx-runtime.js` 接進 `battle-renderer.js`**：`onVfx` 先問 `tryPlay`、`tickWorld` 推進、`syncBattle` reconcile 狀態光環、`clearAllFx` 一併清；獨立的 `presetZone`／`presetFx` 容器。
  8. 狀態每跳（`combat.js` 合併送出）、普攻／敵方／潛力（`data.js VFX_COMBAT_DEFAULTS`）。
  9. index.html 載入三支 VFX 檔並 bump 全部改動檔的 `?v=`；Worker 資產版號同步。
  10. `tests/vfx-runtime.test.cjs` 20 條；`tests/vfx-curve-editor.test.cjs` 的 AXIS-1 改為驗真正的不變量；文件（協議、Core Schema、Workflow、PATCH）更新；Editor 加 Preset 下拉。
  11. **環繞場域**（火狩星環／環體電球／虛空鋸刃）改由 Preset 播：軌道環＋沿環公轉的環繞體，
      幾何與四條成長曲線對齊舊畫法，起始角改吃 `area.startAng`（與模擬層的接觸判定同角度）。
  12. **高塔接上**（`js/vfx-tower.js`）：`.battle-scene` 疊第二個 Pixi 表面，共用同一個 Adapter，
      只換座標來源（DOM 卡片人像）與尺寸規則（`profile`：scale／areaScale／skyScale／groundR）。
      事件分流在 ui.js：野外 → 高塔疊層 → DOM 舊畫法。
- 未完成：
  1. **目視 QA**（人工）：Editor 抽樣截圖各家族、實機觀察普攻／火球／隕石／火牆／狀態光環，
     以及高塔那三個縮放係數看起來對不對（要調就改 `js/vfx-tower.js` 的 `TOWER_PROFILE`）。
  2. `cast-buff-poison` 尚未被任何一列引用。
- 驗證：`npm run build` 318 檔全過；`npm test` 與基線（2293 案例／12 條既有紅燈）比對；`config_tables --apply` 往返語意變更 0。
- 已知風險：shipped 素材 4.49 MB 進 git（不進去的話 preset 解析不到貼圖）；`fill-vfx-cells.cjs` 會覆寫三張表的特效欄，使用者手改過的格子會被蓋掉；高塔（DOM）本輪不播 Preset。
- Commit：見本次 Git 提交。

---

## Codex｜普攻動作與連擊傷害浮字分離（2026-08-28）

- 狀態：已完成
- Owner：Codex
- 任務分類：戰鬥顯示／普攻與連擊
- 使用者需求：普攻動作只受攻速影響；同一次主普攻所產生的連擊傷害，在畫面上合併為一個持續累加的傷害數字。攻速產生的不同主普攻，必須各自使用獨立的累加器。
- 前置依賴：無；已完成修改範圍衝突預檢，未發現其他副本或分支正在修改目標檔案。
- 允許修改：`js/combat.js`、`js/ui.js`、`js/battle-renderer.js`、`js/vfx.js`、`js/bridge.js`、`js/worker/sim.worker.js`、`index.html`、相關測試與本文件。
- 禁止修改：普攻傷害公式、`comboHits` 的計算語意、存檔格式與 Worker 浮字資料結構；本次以既有浮字 class 傳遞顯示群組識別。
- 技術內容：
  - `doPlayerAttack` 僅在主普攻（`depth === 0`）建立新的 `damageGroupId`；連擊／追加攻擊沿用同一組，攻速造成的下一次主普攻則取得下一組。
  - 主普攻使用 `swordwave`，追加劍氣使用 `swordwave-extra`；Canvas 顯示層只讓前者觸發玩家攻擊動作，DOM／Canvas 兩條路徑仍使用相同劍氣外觀。
  - 傷害浮字沿用既有 `cls` 傳遞 `damage-group-*`，DOM 與 Canvas 都以「目標＋主普攻群組」合併，依序將 100 顯示為 100 → 200 → 300；不同主普攻或不同敵人不共用累加器。
  - 不修改傷害結算、攻速冷卻、`comboHits` 公式、存檔與 Worker FLOAT 結構；同步更新主頁與 Worker 快取版號。
- 驗證：相關測試 85 案例全數通過；`npm.cmd test` 共 1873 案例，1863 通過、10 條既有失敗與修改前基線相同；`npm.cmd run build` 305 檔全數通過；另通過 `node --check`（5 個變更 JS）與 `git diff --check`。
- 已知風險：尚未做瀏覽器實機目視驗證。另沿用既有 `comboHits` 語意：`comboHits = 3` 代表主攻擊外追加 3 段，因此該次主普攻的浮字會累加 4 段；本次沒有改動這個傷害計算規則。
- 未完成項目：無程式未完成項；建議在遊戲中確認攻速 3 與連擊設定下，三次主普攻各自維持獨立的累加數字。
- Commit：見本次 Git 提交。

---

## Claude｜傳奇進化第十二批（暴風屏障五特效 ＋ 一組超神進化）（2026-08-28）

- 狀態：已完成
- Owner：Claude
- 任務分類：傳奇特效／超神進化（風系，設計文檔的最後一組）
- 使用者需求：實作「暴風屏障」的 5 個傳奇特效，與其 3 個超神進化效果。
- 設計來源：使用者提供的 Google 試算表〈傳奇進化〉頁籤（gid=1805975024）暴風屏障那一段。
- 前十一批的兩條收斂路徑（`legendarySkill2Mods` 傳奇橋、群組層 `ult` 超神進化）原封沿用。
- 技術內容：
  - PASSIVE_POOL 新增 5 個傳奇特效（池內共 153）：盾牌→暴風屏障＝吸收／暴風反射／
    逆風切／風之壁／風暴核心。盾牌是單手副手武器，不吃雙手 ×2 補償。
  - SKILLS2 新增 3 個超神進化（開放群組 22 → 23，**二十三個群組全部開放完畢**）：
    瓦爾格之力／天穹崩裂／森羅萬象。
  - 引擎層只多兩個掛點：
    ① `skill2DefFactor`：傳奇【風之壁】的唯一判定入口，掛在 `js/combat.js playerDefCfg`
       的 `defMul`（我方防禦的唯一出口）。刻意不走既有的 `defUp` 增益——那一格是
       「取代」規則的共用鍵（舊技能【鐵壁】也在用），每 0.5 秒重塗會把鐵壁的數值蓋掉；
    ② `SG_ULT_PASSIVE` 查表：把「被超神改為被動技能」的判定從「逐一比對選項 id」
       改成「群組 → 該群組那一個 id」。暴風屏障也有一個叫【天穹崩裂】的超神
       （設計文檔如此命名，id 是 `skyfallStars`），舊寫法遲早會讓它安靜地退出主動輪替。
  - `sgSpawnVoidDiscs` 另外接受「被借去的形態」（`opts.plain`／`opts.gid`／`opts.dmgVal`），
    供超神【森羅萬象】使用：借的是形態而不是玩家在真空斬上的投資（比照【暴風之刃】）。
  - 沒有新增狀態、沒有新增顯示層變體（一律沿用 `wind-blade`／`void-disc`／`meteor`／
    `thunder-fall`）。Worker 協議未變（仍是 v26）。
- 修改檔案：`js/data.js`、`js/skills2.js`、`js/combat.js`、`index.html`、`js/bridge.js`、
  `js/worker/sim.worker.js`、`config/CSV/Skills2.csv`／`Equipment_Affix.csv` 與對應的
  `config/Excel/*.xlsx`、`game_formula.md`、`GM_command.md`、`PATCH.md`、
  `tests/skill2-stormbarrier-legendary.test.cjs`（新增，13 案例）、
  `tests/skill2-ult-evolution.test.cjs`（開放群組 22 → 23；「尚未開放」那條路已無現成
  控制組，改成臨時拿掉某一組的 `ult` 來測）、`tests/legendary-affix.test.cjs`
  （池內總數 148 → 153）、`tests/skill2-vfx.test.cjs`（版號釘樁）、本文件。
- 驗證：`npm test` 1872 案例（1862 通過，新增 13 案例全過；10 條紅燈與上一批（HEAD）
  完整套件的紅燈逐字相同——該處是 1859 案例 1849 通過、同樣 10 條，確定為本批之前既有）、
  `node tools/build_check.cjs` 305 檔、`config_tables --gen／--sync／--apply` 往返
  （語意變更 0）、`apply_params` 試跑（將變更 0、錨點問題 0、對應參數總數 554 不變）與
  `--check-anchors`、快取版號同步、本機 8331 起頁面確認 console 無錯誤、Worker 存活且
  errors 0、三個超神說明字串在 Lv.1／Lv.10 都正確代入，並以 GM（`sglv`／`sgult`／`spawn`）
  實機輪過三個超神各一輪（皆無執行期錯誤）、`git diff --check`。
- 已知風險與待確認：設計文檔未指定而由我裁定的十二處，以及【吸收】撞到風系減免 99% 上限、
  【瓦爾格之力】的 +0.1% 減免量級可疑、【天穹崩裂】的永久輸出、【森羅萬象】的單次爆發量
  四項需要重估數值的風險，已列在 `PATCH.md` 的「待確認」與「建議重估的數值」兩段。
  ⚠️ 其中第 12 點請優先看：**風刃與暴風屏障各有一個叫【天穹崩裂】的超神**，效果完全不同，
  玩家在技能面板上會看到兩個同名選項；若不是刻意的，建議直接改設計文檔其中一個的名字。
- 未完成項目：已在本機 8331 確認頁面載入無 console 錯誤、Worker 存活且 errors 0、
  三個超神說明字串正確代入，並以 GM 指令輪過三個超神各一輪（皆無執行期錯誤）；
  尚未做實機目視（召喚星體的三種形態、森羅萬象的四方向風刃與虛空斬同時出場）
  與 DPS 基準測試（建議交由 Antigravity）。
- Commit：2d800cd。

---

## Claude｜傳奇進化第十一批（風刃／真空斬十特效 ＋ 兩組超神進化）（2026-08-28）

- 狀態：已完成
- Owner：Claude
- 任務分類：傳奇特效／超神進化（風系）
- 使用者需求：實作「風刃」與「真空斬」的 10 個傳奇特效，與其各 3 個超神進化效果。
- 設計來源：使用者提供的 Google 試算表〈傳奇進化〉頁籤（gid=1805975024）風刃、真空斬兩段。
- 前十批的兩條收斂路徑（`legendarySkill2Mods` 傳奇橋、群組層 `ult` 超神進化）原封沿用。
- 技術內容：
  - PASSIVE_POOL 新增 10 個傳奇特效（池內共 148）：單手魔杖→風刃＝裂風／增壓／風之痕／
    風蝕／斷空刃；雙手斧→真空斬＝共振／裂痕／真空風刃／空間澎脹／虛空漲落。
    `wand1h` 是單手武器，不吃雙手 ×2 補償；`axe2h` 吃，因此真空斬那五個的
    「次數／段數／層數／秒數」一律包在 `LEGENDARY_FX_NON_VALUE_KEYS` 的保護鍵裡
    （`count`／`hits`／`maxStacks`／`sec`），被放大的只有體積。
  - SKILLS2 新增 6 個超神進化（開放群組 20 → 22，只剩暴風屏障尚未開放）：
    風刃＝暴風萬刃／嵐之山／天穹崩裂；真空斬＝萬象風劫／虛空滅界／時空崩解。
  - 引擎層只多三個共用掛點：
    ① `sgRampPct` ＋每一道風刃自己的累加器：傳奇【裂風】的「每命中 1 次再 +5%」。
       加成在命中前讀、命中後才累加（比照連鎖閃電【超導】）；飛行物走既有的
       `bonusPctFn`、地板場域走新增的 `f.ramp`，兩條路都接才不會在追擊形態下失效；
    ② 地板場域的沿途脈衝（`sgGroundPulse` ＋與飛行物同名同義的 `pulse*`／`slowStatus`）：
       超神【暴風萬刃】把大型風刃改成追擊場域，第 6 階【狂風碎裂】的沿途爆炸與緩速
       得跟著換這條路走，選了超神不會少掉半個第 6 階；
    ③ `sgWindbladeBodyDamage`／`sgWindbladeDmgPct`：風刃本體傷害的唯一來源，
       施放、追擊、【嵐之山】的融合與【天穹崩裂】的被動射出都讀它。
  - 新增一筆狀態 `sgWindErode`（傳奇【風蝕】的受傷提高%，走 `skill2VulnACfg` 的同一個
    `totalDmgPct`）；`sgWindRend` 的狀態表 `maxStacks` 由 3 放寬到 6，**當下允許幾層仍由
    `sgWindRendMaxStacks` 決定**（沒有裝【裂痕】時行為完全不變）。Worker 協議未變（仍是 v26）。
  - 【天穹崩裂】把風刃改為被動：`skills2ActsPassive` 由「只認【天霸風神斬】」擴為
    「【天霸風神斬】∪【天穹崩裂】」，觸發時機掛在我方受擊收斂點 `skills2OnPlayerDamaged`。
  - 顯示層一律沿用既有變體：追擊與靜止的刃用 `wind-blade-homing`、巨型與融合風刃用
    `wind-blade`、沿途脈衝用 `wind-burst`、虛空斬用 `void-disc`；沒有新增兩個渲染器
    不認得的變體。
- 修改檔案：`js/data.js`、`js/status.js`、`js/skills2.js`、`index.html`、`js/bridge.js`、
  `js/worker/sim.worker.js`、
  `config/CSV/Skills2.csv`／`Equipment_Affix.csv`／`Status.csv` 與對應的 `config/Excel/*.xlsx`、
  `game_formula.md`、`GM_command.md`、`PATCH.md`、
  `tests/skill2-windblade-vacuum-legendary.test.cjs`（新增，20 案例）、
  `tests/skill2-ult-evolution.test.cjs`（開放群組 20 → 22；控制組由風刃改為暴風屏障）、
  `tests/legendary-affix.test.cjs`（池內總數 138 → 148）、
  `tests/skill2-vfx.test.cjs`（它釘住 index.html／bridge.js／sim.worker.js 的**目前版號**）、本文件。
- 驗證：`npm test` 1859 案例（1849 通過，新增 20 案例全過；10 條紅燈已用 HEAD 的暫時 worktree
  跑過完整套件對照——該處是 1839 案例 1829 通過、同樣 10 條紅燈，失敗訊息逐字相同，
  確定為本批之前既有）、`node tools/build_check.cjs` 304 檔、
  `config_tables --gen／--sync／--apply` 往返（語意變更 0）、`apply_params` 試跑（將變更 0、
  錨點問題 0、對應參數總數 554 不變）與 `--check-anchors`、快取版號同步、
  本機 8331 起頁面確認 console 無錯誤、Worker 存活且 errors 0、六個超神說明字串在 Lv.1／Lv.10
  都正確代入，並以 GM（`sglv`／`sgult`／`spawn`）實機輪過六個超神的三種組合各一輪、
  `git diff --check`。
- 已知風險與待確認：設計文檔未指定而由我裁定的十六處，以及【暴風萬刃】的場域量、
  【嵐之山】的命中次數取捨、【萬象風劫】的實際道數、【裂風】兩種形態的疊滿速度
  四項需要重估數值的風險，已列在 `PATCH.md` 的「待確認」與「建議重估的數值」兩段。
- 未完成項目：已在本機 8331 確認頁面載入無 console 錯誤、Worker 存活且 errors 0、
  六個超神說明字串正確代入，並以 GM 指令輪過六個超神的三種組合各一輪（皆無執行期錯誤）；
  尚未做實機目視（追擊型大型風刃、融合巨型風刃、靜止真空斬、固定環繞虛空斬的畫面）
  與 DPS 基準測試（建議交由 Antigravity）。
- Commit：a91fa9d（本體）。
- 後續修正（使用者澄清 2026-08-28）：超神【天穹崩裂】被動射出的那一道，原本只射出
  一道貫穿刃（傷害已吃完整加成，但形態不對）。改為**照當下的風刃進化情況完整施放一次**——
  走 `castSkill2` 的 `opts.repeat`（不扣法力、不進冷卻），因此七階全滿時射出的是
  【暴風真空刃】的四方向連射形態，小型追擊風刃與【狂風碎裂】的沿途脈衝也一起出來，
  並連帶吃到風刃自己的傳奇特效；「向目標發射」＝暫時把 `pEnt._lockTarget` 指向攻擊者，
  射完立刻還原。傷害的 +50% 一併收進 `sgWindbladeBodyDamage`（選了這個超神之後，
  風刃唯一的出手方式就是這一道）。本檔測試改寫 1 案例（共 20 案例）。

---

## Codex｜風刃兩項火力平衡調整（2026-08-28）

- Owner：Codex
- 狀態：已完成
- 目的：依使用者要求降低風刃第 4 階【亂披風】與第 7 階【暴風真空刃】的強度。
- 修改內容：
  - 【亂披風】每支主風刃由兩側各發射 1 道小型風刃，調整為固定只向一側發射 1 道。
  - 【暴風真空刃】每個方向的連射數由 3 道調整為 2 道，四方向總主風刃由 12 道降為 8 道。
  - 同步 Skills2 CSV／Excel／JS、遊戲與 Worker 快取版本，以及風系回歸測試。
- 修改檔案：`config/Excel/Skills2.xlsx`、`config/CSV/Skills2.csv`、`js/skills2.js`、
  `js/bridge.js`、`js/worker/sim.worker.js`、`index.html`、`tests/skill2-wind.test.cjs`、
  `tests/skill2-vfx.test.cjs`、本文件。
- 未修改但檢查過：`js/vfx.js`、`js/battle-renderer.js`（沿用既有 `wind-blade`／
  `wind-blade-small`／`wind-blade-homing` 變體，事件欄位與畫法不需調整）。
- 驗證結果：`node --test --test-name-pattern "亂披風|追跡風刃|暴風真空刃" tests/skill2-wind.test.cjs`
  4/4 通過；`node --test tests/skill2-wind.test.cjs tests/skill2-vfx.test.cjs` 60/61 通過，
  唯一失敗是既有的風刃冷卻 18 秒斷言（現行表定值為 15 秒）；三支 JavaScript 語法檢查、
  `node tools/config_tables.cjs --apply Skills2`（語意變更 0）、`node tools/build_check.cjs`
  （303 檔）與 `git diff --check` 皆通過。
- 已知風險：風系測試中既有的冷卻基準仍期待 18 秒，但目前表定冷卻為 15 秒，與本次數量調整無關。
- 未完成項目：無；尚未進行瀏覽器實機目視驗證。
- 建議下一步：使用者重新整理頁面後確認兩項技能的實際發射數量與傷害體感。
- 是否可以合併：可以。

---

## Codex｜寒霜總層數傷害與攻速累乘修正（2026-08-28）

- Owner：Codex
- 狀態：已完成
- 目的：依使用者新規格，讓寒霜凍傷使用目標身上所有來源的寒霜總層數，並讓寒霜攻速下降逐層相乘。
- 範圍：`js/skills2.js`、`js/combat.js`、`js/status.js`、`config/CSV/Status.csv`、`config/CSV/Skills2.csv`、`config/CSV/Equipment_Affix.csv`、`js/data.js`、`game_formula.md`、`PATCH.md` 與相關測試。
- 規格：凍傷每跳倍率＝`(50×目前寒霜總層數＋該來源寒霜階每級增量×該階等級)%`；水流彈【寒流彈】的每級增量為 20%。寒霜移速下降維持加總，攻速倍率＝`(1−單層下降%)^層數`，保留 5% 最低倍率。
- 驗收：海淵葬界 Lv.10 疊至 25 層時水流彈寒霜倍率為 1450%；10 層寒霜、單層攻速 −20% 時攻速倍率為 `0.8^10`；跨技能疊層共用。

## Claude｜傳奇進化第十批（水流彈／冰霜新星十特效 ＋ 兩組超神進化）（2026-08-28）

- 狀態：已完成
- Owner：Claude
- 任務分類：傳奇特效／超神進化（冰系第二批）
- 使用者需求：實作「水流彈」與「冰霜新星」的 10 個傳奇特效，與其各 3 個超神進化效果。
- 設計來源：使用者提供的 Google 試算表〈傳奇進化〉頁籤（gid=1805975024）水流彈、冰霜新星兩段。
- 前置依賴：無（`.claude/check-conflicts.ps1` 總覽模式回報退出碼 0，全部副本乾淨、
  `ai/antigravity` 與 `ai/codex` 都沒有未合併的 commit）。
- 前九批的兩條收斂路徑（`legendarySkill2Mods` 傳奇橋、群組層 `ult` 超神進化）原封沿用。
- 技術內容：
  - PASSIVE_POOL 新增 10 個傳奇特效（池內共 138）：法器→水流彈＝水流連彈／冰霜擴散／
    寒霜湧動／激流／水龍勢；雙手法杖→冰霜新星＝碎冰／雙冰爆／寒冰衝擊／寒潮／凜冬寒霜。
    `focus` 是單手副手武器，不吃雙手 ×2 補償；`staff2h` 吃，因此冰霜新星那五個的
    「數量／段數／機率」一律包在 `LEGENDARY_FX_NON_VALUE_KEYS` 的保護鍵裡。
  - SKILLS2 新增 6 個超神進化（開放群組 18 → 20）：水流彈＝水牢天瀑／怒海狂濤／海淵葬界；
    冰霜新星＝無限新星／極致之冰／冰皇領域。
  - 引擎層只多三個共用掛點：
    ① 寒霜的「疊層上限」與「凍結門檻」分家（`sgApplyFrost`）：門檻不變，上限可被
       傳奇【寒霜湧動】（只放寬水流彈那一份）與超神【海淵葬界】（放寬領域內的每一份）
       往上放寬，並以目前層數為地板，低上限的來源不會把層數壓回來；
    ② 冰錐 `sgSpawnIceSpike`／`kind: icespike`：傳奇【寒冰衝擊】與超神【冰皇領域】共用；
    ③ `skill2WaterPrisonBlocks`：超神【水牢天瀑】擋下圈外遠程攻擊的唯一判定入口，
       掛在 `js/combat.js fieldMonsterAttack`（野外敵人攻擊成不成立的唯一閘門）。
  - 冰霜新星那一棵樹的本體傷害／範圍／一次命中收斂成三支共用函式
    （`sgFrostnovaBodyDamage`／`sgFrostnovaBaseM`＋`sgFrostnovaScale`／`sgFrostnovaHit`），
    施放、死亡新星、【雙冰爆】的再爆發走的都是它們，超神的傷害乘區不會漏套在某一條路上。
  - 新增一筆狀態 `sgWaterPrison`（水牢的受傷提高%）；攻擊力下降沿用既有的 `atkDown`。
    Worker 協議未變（仍是 v26）。
  - 顯示層一律沿用既有變體：`follow-aura`（水牢／水之領域）、`water-tornado`
    （巨大水龍捲／冰錐）、`frost-nova`（爆散改為新星）、`frost-spread`（冰晶共鳴）。
- 修改檔案：`js/data.js`、`js/status.js`、`js/skills2.js`、`js/combat.js`、`index.html`、
  `js/bridge.js`、`js/worker/sim.worker.js`、
  `config/CSV/Skills2.csv`／`Equipment_Affix.csv`／`Status.csv` 與對應的 `config/Excel/*.xlsx`、
  `game_formula.md`、`GM_command.md`、`PATCH.md`、
  `tests/skill2-waterball-frostnova-legendary.test.cjs`（新增，20 案例）、
  `tests/skill2-ult-evolution.test.cjs`（開放群組 18 → 20；控制組由水流彈改為風刃）、
  `tests/legendary-affix.test.cjs`（池內總數 128 → 138）、
  `tests/skill2-vfx.test.cjs`（它釘住 index.html／bridge.js／sim.worker.js 的**目前版號**）、本文件。
- 驗證：`npm test` 1835 案例（1825 通過，新增 20 案例全過；10 條紅燈已用 HEAD 的暫時 worktree
  逐檔對照跑過，失敗訊息逐字相同，確定為本批之前既有）、`node tools/build_check.cjs` 303 檔、
  `config_tables --gen／--sync／--apply` 往返（語意變更 0）、`apply_params` 試跑（將變更 0、
  錨點問題 0、對應參數總數 554 不變）與 `--check-anchors`、快取版號同步、
  本機 8124 起頁面確認 console 無錯誤且六個超神說明字串在 Lv.1／Lv.10 都正確代入、`git diff --check`。
- 已知風險與待確認：設計文檔未指定而由我裁定的十四處，以及【無限新星】【水龍勢】
  【寒霜湧動】三項需要重估數值的風險，已列在 `PATCH.md` 的「待確認」與「建議重估的數值」兩段。
- 未完成項目：已在本機 8124 確認頁面載入無 console 錯誤、六個超神說明字串正確代入；
  尚未做實機目視（水牢圈、冰錐、冰晶共鳴的畫面）與 DPS 基準測試（建議交由 Antigravity）。
- Commit：4529e85。

---

## Claude｜傳奇進化第九批（雷球／寒冰箭十特效 ＋ 兩組超神進化）（2026-08-27）

- 狀態：已完成
- Owner：Claude
- 任務分類：傳奇特效／超神進化（雷系第二批 ＋ 冰系第一批）
- 使用者需求：實作「雷球」與「寒冰箭」的 10 個傳奇特效，與其各 3 個超神進化效果。
- 設計來源：使用者提供的 Google 試算表〈傳奇進化〉頁籤（gid=1805975024）雷球、寒冰箭兩段。
- 前置依賴：無（`.claude/check-conflicts.ps1` 總覽模式回報退出碼 0，全部副本乾淨、
  `ai/antigravity` 與 `ai/codex` 都沒有未合併的 commit）。
- 前八批的兩條收斂路徑（`legendarySkill2Mods` 傳奇橋、群組層 `ult` 超神進化）原封沿用。
- 技術內容：
  - PASSIVE_POOL 新增 10 個傳奇特效（池內共 128）：水晶球→雷球＝雷核／超載／感電核心／
    雷殞落／雷殞震；魔法書→寒冰箭＝連射／冰封／凜冬侵蝕／冰裂箭／深度凍結。
    `orb` 與 `spellbook` 都是單手副手武器，不吃雙手 ×2 補償。
  - SKILLS2 新增 6 個超神進化（開放群組 16 → 18）：雷球＝臨界雷劫／雷爆／雷殞天地碎；
    寒冰箭＝極寒冰爆／無限冰裂／冰之淚。
  - 引擎層只多兩個共用掛點（不是這兩個技能的特例）：
    ① 地板場域的 `onHit`（每個受害者各呼叫一次的命中後回呼，語意比照環繞場域既有的
       `onStrike`）與 `ctrlPct`（對暈眩或凍結中的敵人的額外傷害百分點）；
    ② `SG_ULT_HIT_CDR`／`sgUltHitCdr`：「每造成 1 次傷害就回扣自己冷卻」的查表式掛點，
       掛在 `sgHitOne`——那是寒冰箭所有形態唯一的共同結算點。
  - 【超載】的雷電傷害增幅掛在 `legendaryElementDamageUp`（屬性傷害提升% 的唯一收斂點），
    與【永恒超導體】【火焰增幅】同一條路；場上雷球數每拍重數（走 `sgLegendTick` 一拍快取）。
  - 【雷殞天地碎】新增 `SKILL2_RT.thunderfallAt` 的永久節拍（比照【雷霆天劫】），
    與施放時的降下共用 `sgThunderfallSpec`／`sgDropThunderfall`，兩條路徑不會漂移。
  - 沒有新增狀態（Status 表未動）。Worker 協議未變（仍是 v26）。
  - 顯示層一律沿用既有變體；只有【冰之淚】的箭雨新增 `kind: icerain`，
    但它對應的是既有的泛用 `rain` 畫法（Canvas 的 `spawnRain` 與 DOM 的範圍矩形都有分支）。
- 修改檔案：`js/data.js`、`js/skills2.js`、`index.html`、`js/bridge.js`、`js/worker/sim.worker.js`、
  `config/CSV/Skills2.csv`／`Equipment_Affix.csv` 與對應的 `config/Excel/*.xlsx`、
  `game_formula.md`、`GM_command.md`、`PATCH.md`、
  `tests/skill2-thunderorb-icearrow-legendary.test.cjs`（新增，23 案例）、
  `tests/skill2-ult-evolution.test.cjs`（開放群組 16 → 18；控制組由雷球改為水流彈）、
  `tests/legendary-affix.test.cjs`（池內總數 118 → 128）、
  `tests/skill2-vfx.test.cjs`（它釘住 index.html／bridge.js／sim.worker.js 的**目前版號**）、本文件。
- 未修改但檢查過：`js/legendary.js`（`skill2LightningDamageUpPct` 的掛點第八批就接好了，
  本批只是讓那一支多回傳一份）、`js/status.js`（本批沒有新狀態）、
  `js/gm_exec.js`（`sgult` 依 `sgUltDefs` 動態列舉，新群組自動納入）、
  `js/save.js`（第 8 格正規化與群組無關）、`js/ui.js`（格數走 `sgSlotCount`）、
  `js/battle-renderer.js`／`js/vfx.js`（本批只用既有變體與泛用 rain 分支）。
- 驗證方式：`npm test` 全量 1815 案例（1805 通過；新增的 23 案例全過）、
  `node tools/build_check.cjs`（302 檔）、`config_tables --gen <表>／--sync／--apply` 往返
  （語意變更 0）、`apply_params` 試跑（對應參數總數 554、將變更 0、錨點問題 0）與
  `--check-anchors`、快取版號同步、`git diff --check`。
- 已知風險：
  - **本批之前就存在的 10 條紅燈未處理**：泥沼術 2、冰系 5、雷系 1、風系 1（都是參數表調過
    冷卻／速度之後沒同步的表定斷言），以及 Canvas 投射物預判 1。已用 HEAD 的暫時 worktree
    對照跑過，失敗訊息逐字相同，確定非本次造成。要不要一併修屬另案。
  - 【無限冰裂】照設計文檔字面實作的結果實質等於「寒冰箭無冷卻」（滿級單次施放的命中
    次數是三位數 ×0.1 秒），【極寒冰爆】把波數 3 → 10 會讓追擊場域數量 ×3.3——
    兩者的 DPS 與場域上限都要重估，見 PATCH.md 的「建議重估的數值」。
  - 設計文檔未指定而由我取值的九處已列在 PATCH.md 的「待確認」段。
- 未完成項目：尚未進行瀏覽器實機目視驗證與 DPS 基準測試（建議交由 Antigravity）。
- Commit：f8f611c。

---

## Claude｜雷幕改用專屬的藍白落雷畫法（2026-08-26）

- 狀態：已完成
- Owner：Claude
- 任務分類：顯示層（雷系超神進化）
- 使用者需求：實機回報「橫掃的機制對了，但特效還是火系」，要藍白色系的雷電，
  且應該是落雷移動掃過的樣子。
- 技術內容：
  - 原因：雷幕原本沿用 `firewall` 的畫法，而 `spawnFireWall` 把火焰色寫死在多邊形裡
    （`themeOf` 只影響少數幾層），`elem` 換成 lightning 也還是一道火牆。
  - `js/battle-renderer.js` 新增 `spawnThunderCurtain` 與 variant `thunder-curtain`：
    一排從天而降的落雷沿判定矩形長軸排開（折線沿用既有的 `boltPath`），
    加一條貼地亮帶（長寬直接用判定矩形），整排隨矩形橫掃。
  - 配色是專屬的藍白電漿常數，**不動** `VFX_ELEM_THEME.lightning`（金黃色，
    是既有雷系特效的配色，改它會波及所有既有雷電畫面）。
  - `sgGroundArea` 比照追蹤冰箭／風刃，替 `thunderwall` 帶上 `destX`／`destY`／`speed`；
    顯示層據此等速自走並在收到權威座標時往回修正（事件成批送達，純跟事件走會停三幀跳一次）。
  - `js/vfx.js` 補一條明寫的 DOM 分支（高塔不會收到帶座標的雷幕，但漏掉會掉進泛用光環）。
- 修改檔案：`js/battle-renderer.js`、`js/vfx.js`、`js/skills2.js`、`index.html`、
  `js/bridge.js`、`js/worker/sim.worker.js`、`PATCH.md`、
  `tests/skill2-chainlightning-thunder-legendary.test.cjs`（新增「兩個渲染器都要有自己的
  雷電分支」與事件要帶足落點／速度的斷言）、`tests/skill2-vfx.test.cjs`（版號釘樁）、本文件。
- 驗證方式：`npm test` 全量、`node tools/build_check.cjs`、快取版號同步、`git diff --check`、
  瀏覽器實機確認 Worker 只送 `thunder-curtain`（425 則、`firewall` 0 則、帶 destX／destY／
  speed），並直接以真實事件呼叫 `BattleRenderer.onVfx` 兩次（建立與更新兩條路徑）無例外、
  Console 無錯誤。
- 已知風險：**畫面本身仍未目視確認**——Browser pane 未顯示時 rAF 凍結，特效佇列不流動、
  截圖取不到畫格，因此只驗到「事件正確、渲染函式被接上且不拋例外」。
  落雷密度（每 150 像素一道、上限 8 道）與亮帶透明度是我取的值，請實機看過後再調。
- 未完成項目：目視確認與 DPS 基準測試（建議交 Antigravity）。
- Commit：29c2880。

---

## Claude｜雷電矩陣改為「移動雷幕橫掃全場」（2026-08-26）

- 狀態：已完成
- Owner：Claude
- 任務分類：超神進化行為修正（雷系）
- 使用者需求：【雷電矩陣】的「橫掃全場」是真的掃過去——橫向與直向各 4 道雷幕，
  同一軸向的第 1／3 道順向、第 2／4 道逆向，相鄰兩道交錯而過（使用者附圖說明）。
- 設計來源：使用者 2026-08-26 的裁定與示意圖（原本實作為施放當下一次結算的靜態直線）。
- 前置依賴：接在第八批（5c975b8）之上；期間 develop 併入了火狩／火神降臨／岩甲的三項調整
  （087cf46、e6abb6f），兩者都沒有動到場域生成與場域特效分派，語意不衝突。
- 技術內容：
  - `sgThunderMatrix` 改走既有的移動場域（`sgSpawnGround` 的牆型場域 ＋ `dest`／`speed`），
    不再用 `bfSegmentTargets` 在施放當下算完。牆身垂直於行進方向、長度蓋滿全場，
    厚度＝表定的「每道寬」；顯示與傷害共用同一個場域實例（AI_RULES 8.3／8.3.1）。
  - 採**接觸判定**（`contact`）：同一道雷幕對每個敵人只結算一次。
  - `sgSpawnGround` 新增 `cfg.angle`（沿指定方位掃，沒有目標可以推算朝向）。
  - 新增 `kind: thunderwall`，沿用 `firewall` 的既有畫法只換屬性配色；
    不用 `wall` 是因為那會讓 `sgGroundExpire` 去跑火龍捲樹的第 5／6 階。
  - 新增可調參數 `mps`（掃描速度，米／秒，預設 30）與兩個節奏常數
    （`SG_MATRIX_SPAN_MULT`、`SG_MATRIX_STAGGER_SEC`）。
  - 掃描速度有一個由「每道寬」決定的天花板（`SG_SIM_MAX_STEP_SEC`，鏡射 Worker 的
    `TICK_MS`）：一個模擬步長最多前進一個牆厚，否則接觸判定會整個跳過站在中間的敵人。
  - 高塔（無座標）退化為「每一道各命中場上敵人一次」。
  - 順手修掉 `sgGroundRectAxis` 的陷阱：它同時決定傷害矩形與顯示矩形的牆身軸向，
    原本只認 `wall`，新的 `thunderwall` 會拿到軸向 0＝牆身沿行進方向躺平。
    瀏覽器實機比對 Worker 送出的 area 才抓到；已補回歸測試（四象限各一隻 ＋ 軸向釘樁）。
  - Worker 協議未變（仍是 v25）。
- 修改檔案：`js/skills2.js`、`config/CSV/Skills2.csv`、`config/Excel/Skills2.xlsx`、
  `index.html`、`js/bridge.js`、`js/worker/sim.worker.js`、`game_formula.md`、
  `GM_command.md`、`PATCH.md`、`tests/skill2-chainlightning-thunder-legendary.test.cjs`
  （雷電矩陣改為兩個案例：幾何／方向交錯，以及「每道只命中一次」）、
  `tests/skill2-vfx.test.cjs`（版號釘樁）、本文件。
- 驗證方式：`npm test` 全量、`node tools/build_check.cjs`、`config_tables --gen/--sync/--apply`
  往返（語意變更 0）、`apply_params` 試跑與 `--check-anchors`、快取版號同步、`git diff --check`、
  瀏覽器實機比對 Worker 送出的雷幕 area（8 道、牆身垂直於行進方向、同軸向兩兩反向、
  尺寸 1056×30 像素、每拍推進不超過一個牆厚），Console 無錯誤。
- 已知風險：四項待確認見 PATCH.md（每道都橫貫全場故練滿時每個敵人吃 8 次、速度天花板、
  起掃間隔、雷幕錨定在施放當下的我方位置）。
- 未完成項目：尚未目視確認畫面（Browser pane 未顯示，rAF 凍結、特效佇列不流動，
  取不到畫格）；已改以「攔截 Worker 送出的 area 事件」驗證幾何。目視與 DPS 建議交 Antigravity。
- Commit：94f8101。

---

## Claude｜火狩圈距、火神降臨跟隨領域與旋轉星環、岩甲兩超神改為持續領域（2026-08-26）

- 狀態：已完成
- Owner：Claude
- 任務分類：傳奇特效／超神進化（第六批的實機回饋調整）
- 使用者需求：① 火狩體積變大時內外兩圈的距離同步加大；② 火神降臨的傷害範圍要平滑實時跟隨玩家，
  射出的星環要畫成旋轉的圓環；③ 岩甲術兩個超神的控場要改成「施放當下作用 ＋ 之後進入範圍也立即作用」；
  ④ 星環改為貫穿型飛行道具、飛行距離 40 米。
- 前置依賴：無（`.claude/check-conflicts.ps1` 對三支目標檔案回報退出碼 0）。
- 技術內容：
  - 圈距：施放端乘 `ringGapPx`，成長端在 `sgOrbitStep` 逐幀拉開；顯示層以 `rGrowTo`／`rGrowSec`
    讀同一條曲線。環形事件改送「出生半徑」，避免補送時被當成另一道環而多畫一圈。
  - 新增 `follow-aura`（玩家錨定、逐幀跟隨的領域光環）與 `firehunt-ring`（翻轉中的火焰圓環）
    兩個變體，Canvas 與 DOM 兩套顯示層都接。
  - 星環改為貫穿型：拿掉 `targetOnly`、`length` 改取表定 `flyM`（40 米），
    顯示層帶 `angle`／`lineLength` 沿直線飛完整段（既有欄位，不必動協議）。
  - 岩甲領域：新增 `sgTickRockField`（進入偵測），施放期與 tick 共用
    `sgRockPetrifyApply`／`sgRockGravityApply`；`SKILL2_RT.rock` 多帶 `inside`／`vfxAt`。
  - Worker 協議 v24 → v25。
- 修改檔案：`js/skills2.js`、`js/battle-renderer.js`、`js/vfx.js`、`css/style.css`、`js/bridge.js`、
  `js/worker/protocol.js`、`js/worker/sim.worker.js`、`index.html`、
  `game_formula.md`、`PATCH.md`、`docs/WORKER_PROTOCOL.md`、
  `tests/skill2-firehunt-rock-legendary.test.cjs`、`tests/skill2-magic-firehunt.test.cjs`、
  `tests/skill2-vfx.test.cjs`、`tests/worker-protocol.test.cjs`、本文件。
- 驗證方式：`npm test` 全量 1788 案例（1778 通過；本檔測試 27/27）、
  `node tools/build_check.cjs`（301 檔）、快取版號同步、`git diff --check`。
- 已知風險：
  - **本次之前就存在的 10 條紅燈未處理**（改動前後完全相同，非本次造成）：泥沼術、冰系、
    雷系、風系四組的表定斷言與 1 條 Canvas 投射物預判測試。
  - 岩甲領域改為持續之後，控場覆蓋率明顯上升（尤其【超重力場】的僵化），DPS／存活基準要重新量。
  - 「站在領域裡不動的敵人只吃一次」是刻意的取捨（見 PATCH.md）；若希望改成持續壓制，
    要另外設計一套不會被控場遞減吃掉的重塗規則。
- 未完成項目：尚未進行瀏覽器實機目視驗證（建議交由 Antigravity；本次三項都是視覺為主的調整）。
- Commit：待建立。

---

## Claude｜傳奇進化第八批（連鎖閃電／落雷術十特效 ＋ 兩組超神進化）（2026-08-26）

- 狀態：已完成
- Owner：Claude
- 任務分類：傳奇特效／超神進化（雷系第一批）
- 使用者需求：實作「連鎖閃電」與「落雷術」的 10 個傳奇特效，與其各 3 個超神進化效果。
- 設計來源：使用者提供的 Google 試算表〈傳奇進化〉頁籤（gid=1805975024）連鎖閃電、落雷術兩段
  （使用者訊息寫「連鎖電電」，表上的正式名稱是「連鎖閃電」）。
- 前置依賴：無（`.claude/check-conflicts.ps1` 總覽模式回報退出碼 0，全部副本乾淨、
  `ai/antigravity` 與 `ai/codex` 都沒有未合併的 commit）。
- 前七批的兩條收斂路徑（`legendarySkill2Mods` 傳奇橋、群組層 `ult` 超神進化）原封沿用，沒有新增架構。
- 技術內容：
  - PASSIVE_POOL 新增 10 個傳奇特效（池內共 118）：單手劍→連鎖閃電＝電荷連鎖／電擊／雷散落／
    超導／過載；單手魔杖→落雷術＝三重雷／雷鎖／震雷／雷之再生／引雷針。兩者都是單手，
    不吃雙手 ×2 補償。
  - SKILLS2 新增 6 個超神進化（開放群組 14 → 16）：連鎖閃電＝天地雷鎖陣／永恒超導體／飛雷神；
    落雷術＝雷電矩陣／雷霆天劫／永恒雷獄。
  - 新增兩個狀態 `sgSuperconduct`（超導電荷，持續到死亡為止）／`sgThunderQuake`（震雷雷痕）。
  - 新增一個收斂點：`sgArmUltRepeat`／`sgTickUltRepeat` ＋ `SG_ULT_REPEAT_IDS`
    ＝「持續 N 秒內每 gap 秒自動再施放 1 次」的共用節拍（【天地雷鎖陣】與【永恒雷獄】共用）。
    `castSkill2` 新增 `opts.repeat`，與既有的 `opts.storm` 併成同一個 `freeCast` 分支
    （不扣魔、不進冷卻、不寫戰報與飄字），且重複施放不會再起算節拍。
  - 新增 `skill2LightningDamageUpPct`：【永恒超導體】的雷電傷害增幅掛在
    `legendaryElementDamageUp`（屬性傷害提升% 的唯一收斂點），與【火焰增幅】【超重力場】同一條路。
  - 新增 `sgLegendCount`：傳奇「次數／個數 +N」規格的統一取值（保護鍵 + 取整 + null 保護）。
  - Worker 協議未變（仍是 v25）：本批沒有新增需要顯示層重現的幾何欄位；
    顯示層一律沿用既有的雷系變體（`lightning-chain`／`thunder-burst`／`thunder-strike`／
    `lightning-relay`），兩個渲染器都已認得。
- 修改檔案：`js/data.js`、`js/skills2.js`、`js/status.js`、`js/legendary.js`、`index.html`、
  `js/bridge.js`、`js/worker/sim.worker.js`、`config/CSV/*` 與 `config/Excel/*`
  （Skills2／Status／Equipment_Affix）、`game_formula.md`、`GM_command.md`、`PATCH.md`、
  `tests/skill2-chainlightning-thunder-legendary.test.cjs`（新增，19 案例）、
  `tests/skill2-ult-evolution.test.cjs`（開放群組 14 → 16；控制組由連鎖閃電改為雷球）、
  `tests/legendary-affix.test.cjs`（池內總數 108 → 118）、
  `tests/skill2-vfx.test.cjs`（它釘住 index.html／bridge.js／sim.worker.js 的**目前版號**）、本文件。
- 未修改但檢查過：`js/gm_exec.js`（`sgult` 依 `sgUltDefs` 動態列舉，新群組自動納入）、
  `js/save.js`（第 8 格正規化與群組無關）、`js/ui.js`（格數走 `sgSlotCount`）、
  `js/battle-renderer.js`／`js/vfx.js`（本批只用既有雷系變體）、
  `js/combat.js`（震雷的增傷併進既有的 `skill2VulnACfg`，普攻端不必另接）。
- 驗證方式：`npm test` 全量（新增 19 案例全過，連跑 5 次無浮動）、`node tools/build_check.cjs`、
  `config_tables --gen <表>／--sync／--apply` 往返（語意變更 0）、`apply_params` 試跑
  （將變更 0、錨點問題 0、對應參數總數 554 不變）與 `--check-anchors`、快取版號同步、
  `git diff --check`。
- 已知風險：
  - **本批之前就存在的 10 條紅燈未處理**（改動前後完全相同，非本次造成）：`skill2-earth` 兩條、
    冰系五條、雷系一條與風系一條（都是 `調整技能CD` 之後沒同步的冷卻基準）、Canvas 投射物預判一條。
    要不要一併修屬另案。
  - 九個設計文檔未指定的取值與判斷見 PATCH.md 的「待確認」段（超導電荷的持續時間、
    三重雷／雷之再生的前提差異、引雷針加傷的範圍、過載計數跨施放…）。
- 未完成項目：尚未進行瀏覽器實機目視驗證與 DPS 基準測試（建議交由 Antigravity）。
- Commit：5c975b8。

---

## Claude｜傳奇進化第七批（泥沼術／大地守護十特效 ＋ 兩組超神進化）（2026-08-25）

- 狀態：已完成
- Owner：Claude
- 任務分類：傳奇特效／超神進化（地系第二批）
- 使用者需求：實作「泥沼術」與「大地守護」的 10 個傳奇特效，與其各 3 個超神進化效果。
- 設計來源：使用者提供的 Google 試算表〈傳奇進化〉頁籤（gid=1805975024）泥沼術、大地守護兩段。
- 前置依賴：無（`.claude/check-conflicts.ps1` 對全部 23 支目標檔案回報退出碼 0，磁碟上沒有衝突來源）。
- 前六批的兩條收斂路徑（`legendarySkill2Mods` 傳奇橋、群組層 `ult` 超神進化）原封沿用，沒有新增架構。
- 技術內容：
  - PASSIVE_POOL 新增 10 個傳奇特效（池內共 108）：魔劍→泥沼術＝蔓延／削弱／腐化／熔火／侵蝕；
    盾牌→大地守護＝魔力滋養／生命滋養／靈魂連結／地之心／不滅意志。兩者都不吃雙手 ×2 補償。
  - SKILLS2 新增 6 個超神進化（開放群組 12 → 14）：泥沼術＝惡疫魔沼／深淵火獄／黃泉沼；
    大地守護＝光耀之堂／天地再造／逆轉乾坤。
  - 新增三個狀態 `sgMireBleed`（泥沼裂傷）／`sgPlague`（惡疫）／`sgInferno`（火獄烙印）。
  - 新增兩個收斂點：`gainPlayerMana`（`js/formula.js`；法力入帳的唯一出口，比照 `healPlayer`，
    讓「溢出的法力」第一次有地方可以接）與 `skills2OnEnemyKill`（`js/combat.js onFieldKill` 尾端；
    新版技能的擊殺掛點）。另新增 `skill2DotElemFactor`（依狀態表傷害屬性分流的持續傷害乘區）。
  - 【黃泉沼】的斬殺刻意分兩段（受傷掛點只立旗標、`tickSkill2` 才結算），避免在
    `resolveHit`／`applyEnemyHpDamage` 中途遞迴且繞過致死分支。
  - Worker 協議未變（仍是 v25）：本批沒有新增需要顯示層重現的幾何欄位。
- 修改檔案：`js/data.js`、`js/skills2.js`、`js/status.js`、`js/formula.js`、`js/combat.js`、
  `js/skills.js`、`js/tower.js`、`js/bridge.js`、`js/worker/sim.worker.js`、`index.html`、
  `config/CSV/*` 與 `config/Excel/*`（Equipment_Affix／Skills2／Status）、
  `game_formula.md`、`GM_command.md`、`PATCH.md`、
  `tests/skill2-mire-earthguard-legendary.test.cjs`（新增，20 案例）、
  `tests/skill2-ult-evolution.test.cjs`、`tests/legendary-affix.test.cjs`、
  `tests/skill2-vfx.test.cjs`（它釘住 index.html／bridge.js／sim.worker.js 的**目前版號**，
  版號往上推時本來就要一起更新，見該檔的註釋）、本文件。
- 未修改但檢查過：`js/legendary.js`（傳奇橋不必改，這一批沒有屬性增傷型效果）、
  `js/gm_exec.js`（`sgult` 依 `sgUltDefs` 動態列舉，新群組自動納入）、
  `js/save.js`（第 8 格正規化與群組無關）、`js/ui.js`（格數走 `sgSlotCount`）、
  `js/battle-renderer.js`（垂死實體被活體資料頂替時已會砍掉重建，【天地再造】不必改顯示層）。
- 驗證方式：`npm test` 全量（新增 20 案例全過）、`node tools/build_check.cjs`（300 檔）、
  `config_tables --gen <表>／--sync／--apply` 往返（語意變更 0）、`apply_params` 試跑（將變更 0、
  錨點問題 0、對應參數總數 554 不變）、快取版號同步、`git diff --check`。
- 已知風險：
  - **本批之前就存在的 10 條紅燈未處理**（改動前後完全相同，非本次造成；已在 HEAD 的乾淨
    worktree 逐條比對確認）：`skill2-earth` 的兩條（泥沼術範圍由 10×10 改為 12×12 之後沒同步的
    斷言）、冰系四條、雷系一條、風系一條、Canvas 投射物預判一條。要不要一併修屬另案。
  - 七個設計文檔未指定的取值與判斷見 PATCH.md 的「待確認」段（天地再造是否再給獎勵、
    逆轉乾坤的取整、侵蝕的傷害基準…）。
- 未完成項目：尚未進行瀏覽器實機目視驗證與 DPS 基準測試（建議交由 Antigravity）。
- Commit：93ddd88。

---

## Codex｜調整大地守護「魔法盾」承擔法力降低（2026-08-25）

- 狀態：已完成
- Owner：Codex
- 任務分類：新版技能數值／戰鬥資源結算
- 使用者需求：生命減少時 30% 可由法力承擔，且承擔的法力降低 30%；每級分別 +3% 轉換承傷、+5% 承擔法力降低。
- 技術內容：`earthguard` 第 5 階新增 `manaRed`／`manaRedPer`；轉換的生命傷害量與實際扣除 MP 分開結算，法力不足時按降低後的 MP 成本反推可轉換傷害，直接扣血與 `resolveHit` 兩條路徑共用。
- 修改檔案：`config/Excel/Skills2.xlsx`、`config/CSV/Skills2.csv`、`js/skills2.js`、`js/formula.js`、`tests/skill2-earth.test.cjs`、`tests/skill2-vfx.test.cjs`、`game_formula.md`、`index.html`、`js/bridge.js`、`js/worker/sim.worker.js`、本文件。
- 驗證方式：魔法盾定向測試 2/2、`skill2-system` 33/33、`skill2-vfx` 31/31、`node --check`、`node tools/build_check.cjs`（等價建置檢查；PowerShell execution policy 阻擋 `npm run build` wrapper）、`git diff --check`、Skills2 xlsx/CSV/JS 往返語意檢查。
- 已知風險：完整測試仍有 2 項既有泥沼範圍基準失敗（`skill2-earth.test.cjs`）與 1 項既有風系冷卻基準失敗（`skill2-wind.test.cjs`），皆與本次魔法盾改動無關。
- 未完成項目：無。
- Commit：已建立（見 Git log）。

---

## Claude｜傳奇進化第六批（火狩／岩甲術十特效 ＋ 兩組超神進化）（2026-08-25）

- 狀態：已完成
- Owner：Claude
- 任務分類：傳奇特效／超神進化（魔法系第二批）
- 使用者需求：實作「火狩」與「岩甲術」的 10 個傳奇特效，與其各 3 個超神進化效果。
- 設計來源：使用者提供的 Google 試算表〈傳奇進化〉頁籤（gid=1805975024）火狩、岩甲術兩段。
- 前置依賴：無（`.claude/check-conflicts.ps1` 對 13 支目標檔案回報退出碼 0，磁碟上沒有衝突來源）。
- 前五批的兩條收斂路徑（`legendarySkill2Mods` 傳奇橋、群組層 `ult` 超神進化）原封沿用，沒有新增架構。
- 技術內容：
  - PASSIVE_POOL 新增 10 個傳奇特效（池內共 98）：水晶球→火狩＝增焰／伴生併發／烈火狩／炎爆／狩獵者；
    法器→岩甲術＝重岩甲／輕飛甲／巨岩增幅／尖刺甲／大地之心。兩者都是單手副手，不吃雙手 ×2 補償。
  - SKILLS2 新增 6 個超神進化（開放群組 10 → 12）：火狩＝烈陽星環／無限星環／火神降臨；
    岩甲術＝超重岩之術／金剛不壞／超重力場。
  - 環繞場域 `sgSpawnOrbitField` 新增兩個泛用能力：`bodyGrowTo`／`bodyGrowSec`（環繞體體積成長，
    刻意與既有的 `growPxPerSec` 環半徑成長分開）與 `spiral`／`spiralMaxPx`／`spawnLeft`／`spawnGap`
    （半徑改掛在每一團上、分批放出＝螺旋）。其他環繞群組沿用預設值，行為不變。
  - 新增狀態 `sgPetrify`（石化：行動限制交給暈眩，狀態只放大土系受傷）與
    `sgStiffen`（僵化：移動／攻速／傷害共用同一個下降值，接到三個既有收斂點）。
  - 新增兩個收斂點：`bfPlayerSpeedFactor`（我方移動速度的唯一乘區，比照 `bfEnemySpeedFactor`）與
    `skills2OnBasicAttack`（新版技能的普攻附加，掛在 `doPlayerAttack` 的 depth 0 段）。
  - Worker 協議 v23 → v24：環形 `area` 新增 `growMax`／`spiral`／`spiralLag`／`orbGrowTo`／`orbGrowSec`
    五個可選欄位（模擬與顯示共用的幾何，AI_RULES 8.3）。
- 修改檔案：`js/data.js`、`js/skills2.js`、`js/status.js`、`js/formula.js`、`js/legendary.js`、
  `js/battlefield.js`、`js/combat.js`、`js/vfx.js`、`js/battle-renderer.js`、`js/bridge.js`、
  `js/worker/protocol.js`、`js/worker/sim.worker.js`、`index.html`、
  `config/CSV/*` 與 `config/Excel/*`（Equipment_Affix／Skills2／Status）、
  `game_formula.md`、`GM_command.md`、`PATCH.md`、`docs/WORKER_PROTOCOL.md`、
  `tests/skill2-firehunt-rock-legendary.test.cjs`（新增，19 案例）、
  `tests/skill2-ult-evolution.test.cjs`、`tests/legendary-affix.test.cjs`、
  `tests/skill2-vfx.test.cjs`、`tests/worker-protocol.test.cjs`、本文件。
- 未修改但檢查過：`js/legendary.js` 的傳奇橋不需改（只加了土系增傷那一筆）、
  `js/gm_exec.js`（`sgult` 依 `sgUltDefs` 動態列舉，新群組自動納入）、
  `js/save.js`（第 8 格正規化與群組無關）、`js/ui.js`（格數走 `sgSlotCount`）。
- 驗證方式：`npm test` 全量 1741 案例（1729 通過）、`node tools/build_check.cjs`（298 檔）、
  `config_tables --gen <表>／--sync／--apply` 往返（語意變更 0）、快取版號同步、`git diff --check`。
- 使用者裁定（2026-08-25，設計文檔未指定之處，皆已落實並補測試）：
  【金剛不壞】生命上限與當前生命等比例一起漲；【伴生併發】改為消耗場上的一團火狩
  （優先伴生體）；【無限星環】外擴上限 20 → 40 米；【火神降臨】星環改為 24 米／秒的飛行
  投射物、威力取火狩第 6 階；【炎爆】無上限與【金剛不壞】99% 減傷維持不變。
- 已知風險：
  - **本批之前就存在的 12 條紅燈未處理**（改動前後完全相同，非本次造成）：
    多半是「所有技能 CD 統一為 15 秒」之後沒同步的斷言（`skill2-system` 的
    `earthguard 冷卻/消耗不合法`、地／冰／雷／風四組的「群組都在表上」等），
    另有 1 條 Canvas 投射物預判測試。要不要一併修屬另案，需使用者決定。
  - 【伴生併發】改為消耗環繞體之後，火狩的實際留場時間會被縮短（每秒少一團）：
    未投資第 3 階【伴生火狩】、也沒有第 7 階【狩神之舞】的自帶伴生時，
    2 團火狩約 2 秒就會被消耗光。這是使用者指定的交換，但 DPS 基準要重新量。
- 未完成項目：尚未進行瀏覽器實機目視驗證與 DPS 基準測試（建議交由 Antigravity）。
- Commit：待建立。

---

## Claude｜自動施放的技能在角色死亡／倒地時停止（2026-08-24）

- 狀態：已完成
- Owner：Claude
- 任務分類：戰鬥行動閘門（自動施放）
- 使用者需求：自動施放的技能（例如地爆天星每隔 N 秒自動出現），應該在角色死亡時停止施放。
- 技術內容：新增唯一判定入口 `skills2AutoCastBlocked(pEnt)`（死亡或【不屈鬥魂】倒地期），
  套用到 8 個自動發動的效果；採「排程往後推 dt」的暫停語意，而不是暈眩那種「跳過這一拍」。
- 修改檔案：`js/skills2.js`、`js/legendary.js`、`index.html`、`js/bridge.js`、
  `js/worker/sim.worker.js`、`game_formula.md`、`PATCH.md`、
  `tests/skill2-ult-evolution.test.cjs`、`tests/skill2-vfx.test.cjs`、
  `tests/worker-shim.test.cjs`、`tests/skill-special-vfx.test.cjs`、本文件。
- 未修改但檢查過：`js/combat.js`（真死亡與復活倒數本來就不跑排程器）、
  `js/tower.js`（死亡直接結束該場）、`js/skills.js`（排程器鏈結點不需改）。
- 已知風險：永久領域（【殺神領域】【萬毒血霧】）與已經生成的場域／飛行物**不在**本次範圍——
  它們不是「自動施放」，是已經打出去的效果；若使用者認為倒地期間也該停，再擴。
- 未完成項目：無。
- Commit：待建立。

---

## Claude｜地爆天星：倒數狀態、5 秒黑影預警、超巨型暗紅殞石（2026-08-24）

- 狀態：已完成
- Owner：Claude
- 任務分類：超神進化調整（表現層節奏 ＋ 狀態投影）
- 使用者需求：
  1. 地爆天星的下落間隔做成一個狀態，可由該狀態看出下次落下時間。
  2. 落下前 5 秒，地板出現一個黑色影子逐漸擴大到全場，然後一個比正常殞石體積大三倍的殞石
     垂直落下，落下速度比正常殞石減少一半。
  3. 地爆天星的殞石顏色調整得更偏暗紅色，並且前方帶有火焰衝擊波效果。
- 前置依賴：本批緊接在「傳奇進化第五批」之後，同一個超神進化。
- 技術內容：節奏由「時間到就結算」改為三段式（預警 → 下墜 → 落地），排程改記在
  `SKILL2_RT.starfall`；新增狀態 `sgStarfall` 投影倒數；Canvas 與 DOM 兩套顯示層各補
  黑影與超巨型殞石的專屬畫法，並新增暗紅火焰色票與前方衝擊波。
- 修改檔案：`js/skills2.js`、`js/status.js`、`js/battle-renderer.js`、`js/vfx.js`、
  `js/worker/shim.js`、`css/style.css`、`index.html`、`js/bridge.js`、`js/worker/sim.worker.js`、
  `config/CSV/Status.csv`、`config/Excel/Status.xlsx`、`game_formula.md`、`PATCH.md`、
  `tests/skill2-fire-legendary.test.cjs`、`tests/skill2-vfx.test.cjs`、本文件。
- 未修改但檢查過：`js/ui.js`（增益面板讀狀態表，不需列舉新狀態）、
  `docs/WORKER_PROTOCOL.md`（v17 明訂「加變體不用動協議」）。
- 驗證方式：`node --test` 全量、`node tools/build_check.cjs`、`config_tables --gen/--sync/--apply`
  往返（語意變更 0）、快取版號同步、瀏覽器實測 DOM 特效路徑、`git diff --check`。
- 已知風險：Canvas 路徑未目視（預覽面板無法顯示，不合成畫面）；黑影透明度上限 0.58，
  若實機覺得太暗或太淡請告知調整。
- 未完成項目：Canvas 實機目視與整體節奏手感（建議交由 Antigravity）。
- Commit：待建立。

---

## Claude｜傳奇進化第五批（火球術／火龍捲十特效 ＋ 兩組超神進化）（2026-08-24）

- 狀態：已完成
- Owner：Claude
- 任務分類：傳奇特效／超神進化（魔法系第一批）
- 使用者需求：實作「火球術」與「火龍捲」的 10 個傳奇特效，與其各 3 個超神進化效果。
- 設計來源：使用者提供的 Google 試算表〈傳奇進化〉頁籤（gid=1805975024）火球術、火龍捲兩段。
- 前置依賴：先合併 `ai/codex` 的「殞石術落地後觸發火球爆裂」與「調整所有技能CD為15秒」——
  兩者都改在 `sgCastFireball` 一帶（衝突預檢退出碼 2，已取得使用者同意後才動手）。
- 前三批的兩條收斂路徑（`legendarySkill2Mods` 傳奇橋、群組層 `ult` 超神進化）原封沿用，沒有新增架構。
- 技術內容：
  - PASSIVE_POOL 新增 10 個傳奇特效（池內共 88）：魔杖→火球術＝連珠火／燃燼／火池／烈焰之心／爆裂；
    雙手杖→火龍捲＝追蹤烈焰／火龍擴散／火焰爆衝／爆燃／火龍共鳴。
  - SKILLS2 新增 6 個超神進化：火球術＝火殞天落／地爆天星／火鳳遼原；
    火龍捲＝烈焰暴風／永劫火獄／火龍之吞噬。
  - 新增共用場域類型 `firepool`（傳奇【火池】與超神【永劫火獄】共用）與游走移動 `wanderM`；
    新增狀態 `sgBurnAmp`（【爆燃】的燃燒受傷放大，比照【火焰增幅】由引擎累加成單一數值）。
- 修改檔案：`js/data.js`、`js/skills2.js`、`js/status.js`、`index.html`、`js/bridge.js`、
  `js/worker/sim.worker.js`、`config/CSV/*` 與 `config/Excel/*`（Equipment_Affix／Skills2／Status）、
  `game_formula.md`、`GM_command.md`、`PATCH.md`、
  `tests/skill2-fire-legendary.test.cjs`（新增）、`tests/skill2-ult-evolution.test.cjs`、
  `tests/legendary-affix.test.cjs`、`tests/skill2-vfx.test.cjs`、本文件。
- 未修改但檢查過：`js/legendary.js`（傳奇橋不需改）、`js/gm_exec.js`（`sgult` 依 `sgUltDefs` 動態列舉，
  新群組自動納入）、`js/save.js`（第 8 格正規化與群組無關）、`js/ui.js`（格數走 `sgSlotCount`）。
- 驗證方式：`node --test` 全量（1714 案例）、`node tools/build_check.cjs`、
  `config_tables --gen/--sync/--apply` 往返（語意變更 0）、`apply_params` dry-run（554/554 一致）、
  快取版號同步、`git diff --check`。
- 已知風險：見 PATCH.md 的「待確認」段（火殞天落的增益範圍、烈焰暴風的倍率量級、爆燃無層數上限）。
- 未完成項目：尚未進行瀏覽器實機目視驗證與 DPS 基準測試（建議交由 Antigravity）。
- Commit：待建立。

---

## Codex｜殞石術落地後觸發火球爆裂（2026-08-24）

- 狀態：已完成
- Owner：Codex
- 使用者需求：火球術進化為殞石術後，第 3 階【火球爆裂】仍須在每顆殞石砸地後分裂 3 個小火球，射向附近目標。
- 修改內容：抽出一般火球共用的小火球投射佇列；殞石落地回呼於落點附近重新選取目標，再建立第 3 階數量與倍率的小火球。小火球沿用原有飛行、命中、燃燒與 VFX 流程。
- 修改檔案：`js/skills2.js`、`tests/skill2-magic-fire.test.cjs`、`index.html`、`js/bridge.js`、`js/worker/sim.worker.js`、`tests/skill2-vfx.test.cjs`、本文件。
- 未修改但檢查過：`js/battlefield.js` 的附近目標選擇與距離規則、`js/skills.js` 的新版技能排程、`js/worker/protocol.js`。
- 驗證方式：火系定向測試、殞石分裂落地後時序測試、JavaScript 語法檢查、建置檢查、快取版號檢查與 `git diff --check`。
- 已知風險：附近沒有其他存活目標時，小火球數量會少於 3 顆，與一般火球爆裂的既有目標選擇規則一致；尚未進行瀏覽器實機目視驗證。
- 未完成項目：無。
- Commit：待建立。

---

## Codex｜修正 HP_lock 後技能停止施放（2026-08-24）

- 狀態：已完成
- Owner：Codex
- 任務分類：GM 測試工具／戰鬥行動閘門回歸修正
- 使用者回報：啟用 `HP_lock` 後技能列沒有施放；畫面顯示技能已就緒，且 HP／MP 已凍結。
- 前置依賴：既有 `HP_lock`／`MP_lock` 執行期旗標與技能施法排程器。
- 允許修改：`js/combat.js`、`js/tower.js`、`tests/gm-skill-test-tools.test.cjs`、`index.html`、`js/bridge.js`、`js/worker/sim.worker.js`、本文件。
- 禁止修改：存檔格式、Worker Protocol、技能數值與非 GM 戰鬥行為。
- 技術內容：GM 鎖血啟用時，玩家行動閘門不得因既有暈眩／倒地狀態而永久阻擋技能自動施放；一般遊戲狀態維持原本的控制規則（高塔沿用原本僅檢查暈眩）。
- 驗收方式：鎖血下技能可從就緒列進入施法；未鎖血時暈眩／倒地仍會阻止行動；野外與高塔兩條戰鬥路徑同步；快取版號同步。
- 測試要求：GM 定向測試、技能排程測試、`node tools/build_check.cjs`、`git diff --check`。
- 實作結果：新增共用 `playerActionControlBlocked` 行動閘門；`HP_lock` 下略過殘留暈眩／倒地阻擋，野外與高塔技能路徑同步；更新戰鬥模組與 Worker 快取版號。
- 修改檔案：`js/combat.js`、`js/tower.js`、`tests/gm-skill-test-tools.test.cjs`、`index.html`、`js/bridge.js`、`js/worker/sim.worker.js`、本文件。
- 未修改但檢查過：`js/skills.js` 的就緒佇列與施法鎖、`js/skills2.js` 的新版技能施放入口、`js/formula.js` 的 HP／MP 鎖定結算。
- 已知風險：HP_lock 是 GM 測試例外；一般遊戲的暈眩、倒地與施法硬直規則不變。
- 未完成項目：無。

---

## Codex｜新增 HP_lock／MP_lock GM 指令（2026-08-23）

- 狀態：已完成
- Owner：Codex
- 任務分類：GM 測試工具／戰鬥資源鎖定
- 使用者需求：新增 `HP_lock` 與 `MP_lock` 指令；再次輸入同一指令即可解除。HP 鎖定後玩家不再扣血，MP 鎖定後玩家不再扣魔且技能可在沒有 MP 時使用。
- 前置依賴：既有 `GM_TEST` 執行期旗標、Worker GM 指令執行層與 HP/MP 結算流程。
- 允許修改：`js/gm_exec.js`、`js/formula.js`、`js/skills.js`、`js/skills2.js`、`js/legendary.js`、`js/combat.js`、`js/worker/sim.worker.js`、`js/bridge.js`、`index.html`、`tests/gm-skill-test-tools.test.cjs`、`tests/skill2-vfx.test.cjs`、`GM_command.md`、`docs/AI_TASKS.md`。
- 禁止修改：存檔格式、Worker Protocol／`js/worker/protocol.js`、技能與戰鬥數值、非本需求 UI。
- 技術內容：以 `GM_TEST.hpLock`／`GM_TEST.mpLock` 保存執行期狀態；在共用傷害結算、直接自傷、一般／新版技能耗魔、被動觸發耗魔、魔法盾與自動施放 MP 門檻接線，避免只攔單一路徑。
- 測試要求：GM 指令切換、一般與新版技能零 MP 施放、直接傷害／DoT／自傷不扣 HP、MP 消耗路徑不扣魔、`node --test tests/gm-skill-test-tools.test.cjs`、`node tools/build_check.cjs`、完整 `npm.cmd test`。
- 完成條件：兩個指令可重複切換；鎖定僅在執行期生效且不寫入存檔；HP／MP 相關路徑無新增迴歸；快取版本同步。
- 驗證結果：定向 GM／技能／Worker／VFX 測試 185/185 通過；`node tools/build_check.cjs` 通過（297 個檔案）；修改檔案語法檢查與 `git diff --check` 通過。完整 `npm.cmd test` 仍被既有技能規格測試（`skill2-earth`／`skill2-ice` 等）失敗阻擋，與本任務修改無關。
- 需要 Claude Review：否（範圍明確，沿用既有旗標與結算收斂點）。
- 需要 Antigravity 驗證：建議，確認瀏覽器 GM 面板實際輸入與 Worker 狀態同步。
- 完成後交給：使用者／主整合工作區。

---

## Antigravity｜全 8 大技能群組（24 招超神進化）標準化 DPS 基準測試與規範更新｜2026-08-21

- 狀態：已完成
- Owner：Antigravity
- 目的：修正舊測試腳本中因詞條池上限擠出核心暴傷詞條（`critDmg`）導致的屬性偏差問題。確立嚴格控制變因測試規範，保證全技能群組核心傷害詞條（`atkPct`, `atkFlat`, `critDmg` 5996%, `critRate`, `pPen`）完全一致，嚴禁替換影響 DPS 的傷害詞條。全面重測 8 大技能群組（突刺、迴旋斬、飛刀、疾風斬、血刃斬、雙刀亂舞、反擊、嗜血狂怒）共 32 種技能形態 × 3 大場景（共 96 場模擬）。
- 測試報告路徑：`docs/TASK238_ULT_SKILLS_DPS_REPORT.md`、`docs/ULT_EVOLUTION_DPS_COMPARISON_DATA.md`
- 驗證成果：
  1. 測試規範確立：明訂 DPS 基準量測必須嚴格控制傷害變因，僅有機制特殊需求（如反擊需 `blockRate`）時於副手替換防禦/次要詞條，絕不替換傷害核心詞條。
  2. 突刺【幻影八方陣】重測：在統一詞條下，小怪群戰 DPS 達 **3.10B（1.51x 成長）**，完全繼承 168 道八方貫穿彈幕並疊加 12 米全額二次擴散。
  3. 全 8 大群組 24 招超神進化標準化數據完成，全面同步至 `docs/ULT_EVOLUTION_DPS_COMPARISON_DATA.md` 與 `docs/TASK238_ULT_SKILLS_DPS_REPORT.md`。
- 測試指令：`node scratch/test_all_ult_standardized.cjs`、`node tools/build_check.cjs`。

## Antigravity｜傳奇進化第四批（反擊／嗜血狂怒）完整實機驗證與 DPS 基準測試｜2026-08-21

- 狀態：已完成
- Owner：Antigravity
- 目的：針對傳奇進化第四批新增之 10 個傳奇特效（反擊 5 盾牌特效、嗜血狂怒 5 雙手大劍特效）與 6 個超神進化分支（反擊：神聖之體、不屈鬥魂、戰神體；嗜血狂怒：殺神降臨、戰神屠錄、阿修羅霸王拳），進行全面機制回歸驗證、100 級傳奇裝備（強化 +40）冰原地圖 3 大情境（小怪 200 隻、菁英 25 隻、單體 BOSS）無頭高精度戰鬥模擬與進化前後 DPS 倍率量測。
- 測試報告路徑：`docs/skill-tests/20260821-b4-counter-bloodrage-antigravity.md`、`docs/ULT_EVOLUTION_DPS_COMPARISON_DATA.md`
- 驗證結果：
  1. 機制驗收：反擊 5 傳奇特效（堅韌誓言 100 斬 3s 無敵、怒火 100 斬 +30% 全傷、完美姿態 10% 4倍傷、以血還血 1% 扣血 1.5 倍傷、風之體 10% 風刃）與嗜血狂怒 5 傳奇特效（英勇氣概攻速 +30%、燃血 50 層增傷、血債償還自傷 -50% 不吃雙手補償、狂熱者連擊放大失血係數、屠戮者擊殺反震疊層）全數通過單元與實機驗證。
  2. 死亡攔截與護盾封鎖：不屈鬥魂倒地 5 秒鎖血 1 點且限制行動、原地滿血復活；戰神屠錄狂怒期間徹底封鎖一切護盾（含直接寫入 `pEnt.shield` 之來源）、擊殺疊層增傷持續至死亡。
  3. 戰鬥模擬與 DPS 矩陣：
     - 反擊：戰神體在單體 BOSS 輸出達到 **3.11B DPS（9.74x 成長）**；不屈鬥魂死亡 4000% 地系爆發秒殺單體 BOSS 達到 **2.47B DPS（7.73x 成長）**；神聖之體 8 米 AOE 光彈達成 200/200 小怪全清。
     - 嗜血狂怒：戰神屠錄在小怪群戰輸出躍升至 **5.85B DPS（2.58x 成長，峰值 22.13B）**；阿修羅霸王拳每 10 秒 +1000% 爆發（峰值 27.02B）；殺神降臨 8 米普攻使小怪通關時間縮短至 24.05 秒。
  4. 測試指令：`node --test tests/skill2-ult-evolution.test.cjs`（47/47 PASS）、`node tools/build_check.cjs`（296 檔全數通過）。
- 唯讀規範：未修改核心遊戲程式碼；僅產出測試報告、更新數據對比表與登錄任務追蹤。

## Codex｜疾風斬改為前方 180 度單一道弧形掃擊｜2026-08-20

- 狀態：已完成
- Owner：Codex
- 使用者需求：疾風斬應顯示以玩家為中心、前方 180 度的單一道弧形掃擊；不要在每個敵人身上重複建立掃擊特效，敵人位置只保留受擊反饋。
- 前置依賴：沿用既有 `gale-slashes` VFX 事件與傷害命中資料；不變更技能傷害、命中數量或目標選取。
- 允許修改：`js/vfx.js`、`js/battle-renderer.js`、`css/style.css`、`tests/skill2-vfx.test.cjs`、`index.html`、`docs/AI_TASKS.md`。
- 禁止修改：`config/`、`js/skills2.js`、Worker protocol、存檔格式與非本需求技能邏輯。
- 驗收方式：DOM／Canvas 都只建立一個玩家中心的 180 度掃擊；掃擊向外擴大並以 45 度／秒旋轉；每個命中目標仍有受擊反饋；既有測試與建置檢查通過。
- 實作結果：新增 `vfxGaleSweep`／`spawnGaleSweep`，掃擊由玩家位置沿第一目標方向呈現前方 180 度半圓；敵人只保留同步 `hitReact`。未修改 `js/skills2.js` 的傷害與目標邏輯。
- 修改檔案：`js/vfx.js`、`js/battle-renderer.js`、`css/style.css`、`tests/skill2-vfx.test.cjs`、`index.html`、`docs/AI_TASKS.md`。
- 測試指令：`node --test --test-name-pattern="疾風斬使用玩家中心" tests/skill2-vfx.test.cjs`、`npm.cmd run build`、`git diff --check`。
- 測試結果：疾風斬回歸測試 1/1；build 295/295；diff check 通過。完整 `skill2-vfx` 的既有毒霧感染鏡頭震動檢查仍為失敗，與本任務無關。
- 已知風險：目前 VFX 朝第一個事件目標方向取向；沒有目標時退回水平正向／Canvas 的玩家面向。
- 未完成項目：無。
- Commit：待建立 `[Codex] 疾風斬改為前方 180 度弧形掃擊`。

## Codex｜逐風者龍捲風改為淡綠白光特效｜2026-08-20

- 狀態：已完成
- Owner：Codex
- 使用者需求：逐風者生成的龍捲風特效使用風系淡綠色與白光，不得沿用冰系藍色特效。
- 前置依賴：沿用既有 `wind-tornado` VFX 事件與火柱／水龍捲共用的形狀繪製邏輯。
- 允許修改：`js/vfx.js`、`js/battle-renderer.js`、`css/style.css`、`tests/skill2-vfx.test.cjs`、`index.html`、本文件。
- 禁止修改：`config/Excel/Skills2.xlsx`、`config/CSV/Skills2.csv`、傷害計算、存檔格式、Worker Protocol、未列出的功能模組。
- 驗收方式：DOM／Canvas 的 `wind-tornado` 不再進入冰系藍色配色分支，兩條路徑皆使用淡綠與白光；水龍捲仍維持藍色；執行 VFX 測試、語法檢查、建置與 diff 檢查。
- 完成內容：DOM／Canvas 共用的火柱形狀保留不變，但 `wind-tornado` 改用獨立風系淡綠／白光色票；冰系 `water-tornado` 仍維持藍色；更新 CSS、快取版號與配色回歸測試。
- 修改檔案：`js/vfx.js`、`js/battle-renderer.js`、`css/style.css`、`tests/skill2-vfx.test.cjs`、`index.html`、本文件。
- 未修改但檢查過：`js/skills2.js` 的 `wind-tornado` 事件與 `game_formula.md` 的逐風者傷害規則；未變更技能傷害、存檔或 Worker Protocol。
- 驗證結果：`node --check` 通過；超神進化與 VFX 定向測試 46/47（1 項為既有毒霧鏡頭震動基準失敗）；build 295/295；`git diff --check` 通過。
- 已知風險：完整套件既有毒霧鏡頭震動基準失敗仍待另案處理；瀏覽器需重新整理以載入新版 CSS／VFX／Battle Renderer。
- 未完成項目：無。
- 是否可以合併：可以。
- Commit：完成後建立 `[Codex]` 前綴 commit。

## Codex｜迴身四方斬統一四向範圍、改為 60 度並加入旋轉｜2026-08-20

- 狀態：已完成
- Owner：Codex
- 使用者需求：修正目前只有前方套用長距離的問題，讓四個方向使用一致的攻擊範圍；每道斬擊的攻擊角度與特效改為 60°；特效向外飛出、逐步放大並以約 45°/秒旋轉。
- 前置依賴：沿用上一項迴身四方斬扇形擴張修改（commit 44eff56）。
- 允許修改：`js/skills2.js`、`js/vfx.js`、`js/battle-renderer.js`、`css/style.css`、`js/worker/shim.js`、`js/worker/protocol.js`、`tests/skill2-system.test.cjs`、`tests/skill2-vfx.test.cjs`、`game_formula.md`、`index.html`、本文件。
- 禁止修改：`config/Excel/Skills2.xlsx`、`config/CSV/Skills2.csv`、未列出的功能模組；不得降低既有測試要求。
- 驗收方式：四向範圍一致；每道扇形傷害判定與 DOM/Canvas 特效均為 60°；特效由中心向外飛出並逐步放大、以 45°/秒旋轉；執行語法檢查、技能與 VFX 測試、build_check、參數錨點與 diff 檢查。
- 完成內容：第 7 階四向斬統一使用 `max(前方飛行距離、側向飛行距離、近戰範圍)`；傷害判定與 Canvas 扇形改為每道 60°；DOM／Canvas 特效同步逐步放大、向外位移並以 45°/秒旋轉；補上遠距離四向命中與 VFX 靜態驗證。
- 修改檔案：`js/skills2.js`、`js/vfx.js`、`js/battle-renderer.js`、`css/style.css`、`tests/skill2-system.test.cjs`、`tests/skill2-vfx.test.cjs`、`game_formula.md`、`index.html`、本文件。
- 未修改但檢查過：`js/worker/shim.js`、`js/worker/protocol.js`（既有 `rangeScale`／`directionRanges` 傳遞已足夠）、`config/Excel/Skills2.xlsx`、`config/CSV/Skills2.csv`。
- 驗證結果：語法檢查通過；技能系統 33/33；VFX 定向檢查 28/29（1 項為既有毒霧鏡頭震動基準失敗）；Worker shim 6/6；build 295/295；`apply_params` 554/554；錨點 554/554；`git diff --check` 通過；全量測試 1648 項中 1638 通過，10 項為既有泥沼／冰系／毒霧鏡頭震動／風切基準失敗，本次新增測試未失敗。
- 已知風險：完整套件既有 10 項失敗需另案處理；四道中心仍相隔 90°，每道攻擊扇形為 60°，因此方向之間保留 30° 間隔；瀏覽器需重新整理以載入新版 CSS／VFX／Battle Renderer／Skills2。
- 未完成項目：無。
- 是否可以合併：可以。
- Commit：完成後使用 `[Codex]` 前綴。

## Codex｜迴身四方斬改為四向 90 度扇形擴張｜2026-08-20

- 狀態：已完成
- Owner：Codex
- 使用者需求：四個斬擊朝四個方向發出，每個方向覆蓋 90 度；特效從中心向外飛出並逐漸擴大，實際傷害範圍也必須使用同一個擴張扇形。
- 前置依賴：沿用已完成的迴身四方斬四向三連斬、迴旋斬範圍倍率與 DOM／Canvas VFX 事件；不變更存檔格式或 Worker Protocol。
- 允許修改：`js/skills2.js`、`js/vfx.js`、`js/battle-renderer.js`、`js/worker/shim.js`、`js/worker/protocol.js`、`css/style.css`、`tests/skill2-system.test.cjs`、`tests/skill2-vfx.test.cjs`、`game_formula.md`、`index.html`、本文件。
- 禁止修改：未列出的功能模組、存檔格式、Worker 控制／狀態協定、其他技能數值與特效；Worker 只追加本功能需要的可選 VFX 顯示欄位。
- 驗收方式：四向 90 度幾何命中測試、飛行物扇形擴張測試、DOM／Canvas 扇形 VFX 靜態檢查、語法檢查、全量測試、建置、`git diff --check`。
- 完成內容：迴身四方斬改為四道互不重疊的 90 度扇形，四個方向合計覆蓋完整圓周；第 7 階改走向外飛行的逐步擴張半徑，傷害每 tick 以當前半徑重新查詢；DOM／Canvas 皆改為藍色扇形由中心向外飛出並放大；補齊 Worker VFX 事件的 `rangeScale`／`directionRanges` 傳遞與快取版號。
- 修改檔案：`js/skills2.js`、`js/vfx.js`、`js/battle-renderer.js`、`js/worker/shim.js`、`js/worker/protocol.js`、`css/style.css`、`tests/skill2-system.test.cjs`、`tests/skill2-vfx.test.cjs`、`tests/worker-shim.test.cjs`、`game_formula.md`、`index.html`、本文件。
- 未修改但檢查過：`config/Excel/Skills2.xlsx`、`config/CSV/Skills2.csv`、`js/battlefield.js` 的 `bfConeTargets` 幾何、既有 `sgHitOne` 傷害管線。
- 驗證結果：Skills2 round-trip 語意變更 0、`apply_params` 554/554、錨點 554/554、定向技能系統 33/33、Worker shim 6/6、扇形 VFX 定向檢查通過、build 295/295、`git diff --check` 通過；全量測試 1648 項中 1638 通過、10 項為既有泥沼／冰系／毒霧鏡頭震動／風切基準失敗，本次新增測試未失敗。
- 已知風險：完整套件既有 10 項失敗需另案處理；瀏覽器需重新整理以載入新版 CSS／VFX／Battle Renderer／Skills2。
- 未完成項目：無。
- 是否可以合併：可以。
- Commit：完成後使用 `[Codex]` 前綴。

## Codex｜迴旋斬不限人數、強化斬範圍、藍色特效與迴身四方斬｜2026-08-20

- 狀態：已完成
- Owner：Codex
- 使用者需求：`cleave` 迴旋斬改為範圍內所有敵人、不再限制人數；「強化斬」改為斬擊範圍 +15%，每級再 +1.5%；迴旋斬特效改為藍色；第 7 階「迴身雙連斬」更名為「迴身四方斬」，四方向各斬 3 次，傷害額外 +50%，每級 +5%，並與原有傷害採乘法計算。
- 前置依賴：沿用 `cleave` 群組既有近戰範圍與 Canvas／DOM 斬擊事件，未變更存檔結構或 Worker Protocol。
- 允許修改：`config/Excel/Skills2.xlsx`、`config/CSV/Skills2.csv`、`js/skills2.js`、`js/vfx.js`、`js/battle-renderer.js`、`css/style.css`、`tests/skill2-system.test.cjs`、`tests/skill2-vfx.test.cjs`、`tests/skill2-ult-evolution.test.cjs`、`game_formula.md`、`index.html`、本文件。
- 禁止修改：未列出的功能模組、存檔格式、Worker Protocol、其他技能的數值與特效。
- 驗收方式：SSOT round-trip、`node --check`、技能系統與 VFX 測試、全量測試、`build_check`、`git diff --check`。
- 完成內容：迴旋斬改為範圍內不限人數；強化斬改為範圍 +15% 且每級 +1.5%；斬擊特效改為藍色並隨範圍倍率放大；迴身四方斬完成改名、四向三連斬與乘法傷害。
- 測試結果：技能系統與超神進化 50/50；本次 VFX 定向測試 3/3；參數 dry-run 554/554、錨點 554/554、build 295/295、`git diff --check` 通過。全量測試仍有既有 VFX／風切／泥沼／冰系基準失敗，本次相關測試未新增失敗。
- 已知風險：全量測試的既有失敗需另案處理；本次範圍內無未完成項目。
- 是否可以合併：可以。
- Commit：完成後使用 `[Codex]` 前綴。

## Codex｜調整天霸風神斬範圍與被動施放間隔｜2026-08-20

- 狀態：已完成
- Owner：Codex
- 使用者需求：迴旋斬範圍擴大 30%，改為被動技能，每 8 秒自動施放 1 次，且每級施放間隔減少 0.5 秒。
- 前置依賴：沿用現有天霸風神斬的超神進化與被動自動施放流程；不變更存檔格式、Worker Protocol 或其他技能。
- 允許修改：`config/Excel/Skills2.xlsx`、`config/CSV/Skills2.csv`、`js/skills2.js`、`tests/skill2-ult-evolution.test.cjs`、`game_formula.md`、`GM_command.md`、`index.html`、本文件。
- 禁止修改：其他技能數值、傷害公式、目標選擇、VFX 外觀與非本技能的載入流程。
- 驗證要求：Skills2 表格往返同步、天霸風神斬範圍／間隔／被動施放測試、語法檢查、建置、`git diff --check`。
- 修改內容：Skills2 超神進化 `stormGodSlash` 新增 `range:30`、間隔改為 `sec:8`／`secPer:-0.5`；迴旋斬施放距離、飛行斬擊與十字斬擊路徑套用 30% 倍率；同步遊戲公式、GM 指令說明、技能載入版號與回歸測試。
- 修改檔案：`config/Excel/Skills2.xlsx`、`config/CSV/Skills2.csv`、`js/skills2.js`、`tests/skill2-ult-evolution.test.cjs`、`game_formula.md`、`GM_command.md`、`index.html`、本文件。
- 未修改但檢查過：`js/skills.js` 的主動輪替被動閘門、`js/battlefield.js` 的米／系統距離換算與線段命中、`js/vfx.js`／`js/battle-renderer.js` 的既有迴旋斬特效路徑。
- 驗證結果：天霸風神斬／Skills2 系統定向測試 49/49、建置檢查 295/295、`node --check js/skills2.js`、Skills2 `--sync`／`--apply` 往返與 `apply_params` 554 錨點檢查通過、`git diff --check` 通過。完整測試 1644 項中 1633 通過、11 項為既有泥沼／寒冰／暴風雪參數、風切狀態與 VFX／快取基準失敗，未涉及本次天霸風神斬邏輯。
- 已知風險：VFX 定向測試仍有 2 項既有 DOM／快取基準失敗；完整套件的 11 項既有失敗需另案處理。瀏覽器需重新整理以載入 `js/skills2.js?v=1.0.53`。
- 未完成項目：無。
- 是否可以合併：可以。

## Codex｜寒冰箭 15 度分箭、三波追蹤與 30 米／秒｜2026-08-19

- 狀態：已完成
- Owner：Codex
- 使用者需求：寒冰箭每支箭夾角 15 度且不重疊；寒冰爆裂箭連射 3 波、每波間隔 0.3 秒，追蹤冰箭持續 6 秒並在凍結結束時造成 400% 冰爆；寒冰箭速度 30 米／秒。
- 修改內容：將寒冰箭 30 米／秒寫入技能表並換算成系統速度；箭道 VFX 使用以主目標為中心、相鄰 15 度的連續角度；T7 的貫穿投射物與追蹤場域均按 0／0.3／0.6 秒啟動；Worker／DOM／Canvas 同步傳遞箭道角度；同步 Excel、CSV、JS 與載入版號。
- 修改檔案：`config/Excel/Skills2.xlsx`、`config/CSV/Skills2.csv`、`js/skills2.js`、`js/vfx.js`、`js/battle-renderer.js`、`js/worker/shim.js`、`js/worker/protocol.js`、`js/worker/sim.worker.js`、`js/bridge.js`、`index.html`、`tests/skill2-ice.test.cjs`、`tests/skill2-vfx.test.cjs`、本文件。
- 未修改但檢查過：`js/battlefield.js` 的米／系統單位換算與路徑幾何、既有 `sgTickFrost`／`sgIceBlast` 的凍結結束冰爆邏輯。
- 驗證要求：冰系單元測試、VFX 測試、語法檢查、建置、`git diff --check`。
- 已知風險：完整冰系測試仍有一項既有暴風雪尺寸基準失敗，與本次寒冰箭修改無關；需重新載入頁面讓新版載入版號生效。
- 未完成項目：無。
- 是否可以合併：可以。

## Codex｜封鎖所有風系泛用方框回退｜2026-08-19

- 狀態：已完成
- Owner：Codex
- 使用者需求：修正後截圖仍出現綠色方塊；半月形風刃已顯示，但任何風刃／風系場域都不應退回綠色方框。
- 根因：Canvas `spawnAura` 只攔截缺 variant／追蹤風刃，仍允許其他有 variant 的風系事件進入泛用方框；DOM 後備 `vfxAura` 對暴風屏障等風系變體也會產生同樣矩形。
- 允許修改：`js/battle-renderer.js`、`js/vfx.js`、`index.html`、`tests/skill2-vfx.test.cjs`、本文件。
- 禁止修改：技能數值、傷害公式、命中／目標選擇、追蹤速度／範圍／命中間隔、存檔格式、Worker Protocol、半月風刃與風殼的專用外觀。
- 修改內容：Canvas／DOM 的泛用 aura 對所有 `elem: wind` 事件直接拒絕；保留追蹤風刃的 `spawnIceField`／`vfxIceField` 專用路徑；同步渲染器與 DOM VFX 版號。
- 驗證要求：風系泛用方框拒絕與專用路徑回歸測試、語法檢查、建置、`git diff --check`。
- 未修改但檢查過：`js/skills2.js`、`js/worker/shim.js`、`js/worker/sim.worker.js` 的 VFX 欄位傳遞與技能傷害路徑。
- 驗證結果：`tests/skill2-vfx.test.cjs` 25/25、相關檔案 `node --check` 通過、`node tools/build_check.cjs` 294/294、`git diff --check` 通過。
- 已知風險：DOM 後備路徑對沒有專用風殼畫法的風系 aura 會略過泛用方框；Canvas 路徑仍保留暴風屏障／暴風神體／暴風撕裂的專用風殼。
- 未完成項目：無；需重新載入頁面或使用 `Ctrl+F5`，讓新版渲染器與 DOM VFX 版號生效。
- 建議下一步：由使用者重新載入戰鬥畫面，確認所有綠色方塊消失，半月風刃仍正常平滑追蹤。
- 是否可以合併：可以。
- Commit 編號：`d99e35f`。

## Codex｜追蹤風刃移除殘留方塊與平滑轉向｜2026-08-19

- 狀態：已完成
- Owner：Codex
- 使用者需求：畫面仍出現綠色方塊，且半月形風刃會一格一格移動；修正後維持大型風刃直線飛行、小型風刃追蹤，並全面檢查所有技能的移動／範圍／轉彎表現。
- 根因：風系 aura 仍有泛用方框後備路徑；移動場域缺少穩定識別鍵時會以座標重建節點；Worker、技能、渲染器與 CSS 的快取版號未同步，瀏覽器可能持續執行舊路徑。
- 允許修改：`js/battle-renderer.js`、`js/vfx.js`、`css/style.css`、`js/bridge.js`、`js/worker/sim.worker.js`、`index.html`、`tests/skill2-vfx.test.cjs`、本文件。
- 禁止修改：技能數值、傷害公式、命中／目標選擇、追蹤速度／範圍／命中間隔、存檔格式、Worker Protocol、其他技能的傷害行為。
- 驗證要求：風刃方框禁止與穩定鍵回歸測試、全技能連續座標測試、完整測試、語法檢查、建置、快取版號檢查與 `git diff --check`。
- 修改內容：Canvas／DOM 均拒絕風刃泛用 aura；追蹤場域改用穩定 id 並在缺 id 時略過舊事件；位置補間保留最低連續時長，Canvas 半月刃轉向採角度平滑，DOM 半月刃加轉向過渡；同步所有相關資產版號。
- 未修改但檢查過：`js/battlefield.js`、`js/skills.js`、`js/skills2.js` 的技能移動／傷害幾何，以及所有新版技能與 VFX 定向測試。
- 驗證結果：`tests/skill2-vfx.test.cjs` 25/25、`node --check` 通過、`node tools/build_check.cjs` 294/294、完整 `npm.cmd test` 為 1609 項／1604 通過／5 項既有基準失敗、`git diff --check` 通過；載入路徑的 Worker、技能、渲染器與 CSS 版號已同步為本次修正版。
- 已知風險：完整測試的 5 項失敗均為既有技能參數基準差異（嗜血狂怒扣魔、泥沼範圍／擴大、暴風雪尺寸、技能欄位合法性），與本次風刃 VFX／平滑移動修正無關。
- 未完成項目：無；需重新載入頁面或使用 `Ctrl+F5`，讓瀏覽器與 Worker 捨棄舊快取後才能看到修正版。
- 建議下一步：由使用者重新載入戰鬥畫面，確認綠色方塊消失，半月形風刃連續追蹤與轉彎。
- 是否可以合併：可以。
- Commit 編號：`8a94a2d`。

## Codex｜全技能檢查連續移動與傷害範圍同步｜2026-08-18

- 狀態：已完成
- Owner：Codex
- 使用者需求：完成風刃修正後，全面檢查所有技能的特效與實際傷害觸發範圍，確認沒有一格一格移動的不平滑路徑。
- 審查範圍：新版 `SKILLS2` 23 個技能群組、`js/battlefield.js` 共用移動／範圍幾何、舊版 `SKILL_RT` 週期領域、Canvas `js/battle-renderer.js` 與 DOM `js/vfx.js` 的飛行物／移動場域／環繞場域路徑。
- 根因與修正：模擬層的投射物、移動場域、環繞場域與傷害幾何皆已使用連續座標；發現追蹤冰箭的 Canvas／DOM 曾各自沿 `destX/destY + speed` 追擊，現改為只以模擬層 `area.x/y` 快照補間，避免特效與實際判定範圍脫節。
- 未發現其他逐格路徑：`bfTick*`、`sgGroundMove`、`sgTickFlyingProjectiles`、`sgOrbitStep` 與 `bfSegmentTargets` 均未量化位置；舊版週期領域為固定範圍，不會逐格搬移。
- 允許修改：`js/battle-renderer.js`、`js/vfx.js`、`js/skills2.js`、`tests/skill2-vfx.test.cjs`、`index.html`、本文件。
- 禁止修改：技能數值、傷害公式、命中／目標選擇、追蹤速度／範圍／命中間隔、存檔格式、Worker Protocol、其他技能的傷害行為。
- 驗證要求：全技能連續座標回歸測試、冰／風／VFX 定向測試、語法檢查、建置、快取版本與 `git diff --check`。
- 修改檔案：`js/battle-renderer.js`、`js/vfx.js`、`js/skills2.js`（僅同步規則註釋）、`tests/skill2-vfx.test.cjs`、`index.html`、本文件。
- 未修改但檢查過：`js/battlefield.js`、`js/skills.js`、`css/style.css`、各新版技能傷害／命中測試與 Worker 路徑。
- 完成結果：追蹤冰箭 Canvas／DOM 均改為只補間模擬層 `area.x/y`，移除獨立 `destX/destY + speed` 追擊；全技能回歸測試新增連續座標、傷害幾何與 VFX 路徑檢查。未發現其他逐格移動或特效／判定範圍脫節路徑。
- 驗證結果：`tests/skill2-vfx.test.cjs` 24/24、風系測試 61/61；新版技能／投射物／VFX 定向合計 88/89，唯一失敗為既有暴風雪 20×20 測試與目前參數表 24×24 的基準差異；完整 `npm.cmd test` 為 1608 項、1603 通過、5 項既有參數基準失敗；`node --check`、`node tools/build_check.cjs`（294/294）、快取版號檢查與 `git diff --check` 通過。
- 已知風險：本次未改動傷害與命中結果；完整測試的另外 4 項既有失敗為嗜血狂怒扣魔、泥沼 10×10 範圍／擴大，以及技能欄位合法性，均與本次平滑移動修正無關。
- 未完成項目：無。
- 建議下一步：由使用者整合後，以瀏覽器實機確認追蹤冰箭與風刃轉彎時的外觀同步。
- 是否可以合併：可以。
- Commit 編號：`1717141`。

## Codex｜移除風刃傷害方塊並同步平滑追蹤｜2026-08-18

- 狀態：已完成
- Owner：Codex
- 使用者需求：追跡小型風刃不顯示綠色傷害範圍方塊；風刃的傷害位置移動與轉彎須平滑，且和小型風刃特效同步。
- 規則同步：依使用者要求，將所有飛行物／移動場域的移動、轉彎與範圍變化必須平滑呈現的規則寫入 `AI_RULES.md` §8.3.1。
- 根因：追跡風刃顯示層仍保留地面場域／棋盤矩形的退化入口，且 Canvas／DOM 的追蹤位置可能依自己的速度路徑追向未更新目標，未直接以模擬層的 `area.x/y` 快照補間。
- 允許修改：`AI_RULES.md`、`js/battle-renderer.js`、`js/vfx.js`、`css/style.css`、`index.html`、`tests/skill2-vfx.test.cjs`、本文件。
- 禁止修改：風刃傷害數值、命中與目標選擇、追蹤速度／範圍／命中間隔、技能資料、存檔格式、Worker Protocol、其他技能的 VFX 或傷害判定。
- 驗證要求：追跡風刃不得建立範圍方塊／矩形畫法；Canvas／DOM 以模擬 `area.x/y` 連續補間並同步轉向；大型直線風刃保持原行為；執行風系／VFX 定向測試、語法檢查、建置、快取版號與 `git diff --check`。
- 完成結果：Canvas 追跡風刃改以模擬 `area.x/y` 在快照間補間，DOM 路徑停用 `vfxFieldMotionHome` 的獨立追擊並同樣補間權威位置；兩條路徑都跳過棋盤格矩形，僅保留小型半月風刃與同步轉向。新增專案級平滑運動規則至 `AI_RULES.md` §8.3.1。
- 驗證結果：`tests/skill2-vfx.test.cjs` 23/23、`tests/skill2-wind.test.cjs` 28/28、`node tools/build_check.cjs` 294/294、語法檢查、快取版號檢查、`git diff --check` 均通過。
- 後續接手者：使用者／主整合工作區。

## Codex｜修正追跡小型風刃誤顯示為藍色球｜2026-08-18

- 狀態：已完成
- Owner：Codex
- 使用者需求：保留大型風刃的直線飛行；第 5 階後的小型風刃改為追蹤敵人的小型風刃特效，不得再顯示藍色球或其他冰系外觀。
- 根因：`wind-blade-homing` 雖然由模擬層正確建立為追蹤風刃場域，但 Canvas 與 DOM 顯示層沿用冰系場域的圓球／冰晶畫法。
- 允許修改：`js/battle-renderer.js`、`js/vfx.js`、`css/style.css`、`index.html`、`tests/skill2-vfx.test.cjs`、本文件。
- 禁止修改：風刃傷害、目標選擇、追蹤速度／範圍／命中間隔、技能資料、存檔格式、Worker Protocol、其他技能的 VFX。
- 驗證要求：Canvas／DOM 都必須驗證大型風刃仍走 `wind-blade` 直線投射、小型追蹤風刃只走 `wind-blade-homing` 小型風刃畫法；執行定向 VFX 測試、語法檢查、建置檢查、快取版號檢查與 `git diff --check`。
- 完成結果：Canvas 與 DOM 的 `wind-blade-homing` 均改為單一綠白小型半月風刃，移除藍色圓球、冰晶尖刺與冰系粒子；大型 `wind-blade` 直線投射路徑未變。定向測試 23/23 通過、相關風／雷回歸測試 58/58 通過、建置檢查 294 個檔案通過；完整套件另有 5 個既有技能參數／規格測試失敗，與本次修改檔案無關。
- 後續接手者：使用者／主整合工作區。

## Codex｜合併後恢復寒冰體狀態窗口｜2026-08-18

- 狀態：已完成
- 根因：合併後 `js/skills2.js` 的寒冰體 T3 與受擊判定回到舊機率欄位，`Status.xlsx` 缺少 `sgFrostbody`，`Skills2.xlsx` 也未同步 6 秒狀態規格。
- 修改：恢復 `sgFrostbody` 的 6 秒授予與有效期判定、25% 狀態值讀取，以及兩份 Excel 的寒冰體資料；保留合併後的風系內容。
- 驗證：冰系／火狩測試 50/51 通過；新增寒冰體案例通過。唯一失敗仍是既有暴風雪 20×20 米斷言，而參數表為 24×24；`node --check`、`node tools/build_check.cjs`（293/293）、兩份 `config_tables --apply` 語意變更 0、`git diff --check` 均通過。

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

## Codex｜統一鍛鐵外框直邊樣式（2026-09-08）

- 狀態：已撤銷（2026-09-08；誤改整套外框，已由後續最小修正回復）
- 任務分類：全域 UI／鍛鐵邊框修復
- 使用者需求：九宮格框圖的垂直切片產生毛刺；所有邊框改為與乾淨水平邊一致的連續鍛鐵樣式。
- 允許修改：`css/ashen-forge.css`、`docs/AI_TASKS.md`。
- 禁止修改：`index.html`、`js/**`、UI 版面尺寸、遊戲資料、互動行為、存檔、公式、Worker Protocol 與圖片素材。
- 實作：已撤銷；此作法移除使用裝飾九宮格圖的 `border-image`，超出使用者只修直邊毛刺的範圍。
- 驗證：1920×1080 實機檢查左右直邊、上下邊、背包與彈窗均無毛刺；執行 UI 定向測試、建置與 Console 檢查。
- 前置依賴：`f5f716a`；2026-09-08 衝突預檢無其他副本或分支來源。
- 後續接手者：使用者／主整合工作區。

## Codex｜補齊鐵框轉角並移除技能列 Buff 遮擋（2026-09-08）

- 狀態：已完成（2026-09-08）
- 任務分類：全域 UI／框圖接合與技能列遮擋修復
- 使用者需求：無角飾框圖的四角不可缺圖，需補上原有直線鐵條接合；主區角飾再縮小 30%；技能列鐵框不得遮住 Buff。
- 允許修改：`css/ashen-forge.css`、`images/ui/ashen-forge/iron-rail-frame.png`、`docs/AI_TASKS.md`。
- 禁止修改：`index.html`、`js/**`、遊戲資料、互動行為、存檔、公式、Worker Protocol 與既有素材。
- 實作：在無角飾鐵框的四個九宮格角片補入同源水平／垂直鐵條，維持每一側連續；角飾尺寸由 50px 再降 30% 至 35px；技能列移除向外擴張的偽元素框，改為本體內側雙層鐵框。
- 驗證：檢查主區與次級框圖四角皆有連續鐵條、三主區角飾為 35px，技能列頂部不跨入 Buff 區；執行 UI 定向測試、建置與差異空白檢查。
- 前置依賴：`dc715af`；2026-09-08 衝突預檢無其他副本或分支來源。
- 驗證結果：四個角格不再透明；直線鐵條可連續接至水平與垂直邊。技能列不再產生任何外擴的框圖節點，Buff 區不受覆蓋。
- 已知風險：無。
- 未完成項目：無。
- Commit：待建立 `[Codex] fix: 補齊鐵框轉角與技能列遮擋`。
- 後續接手者：使用者／主整合工作區。

## Codex｜擴展屬性區資訊面積（2026-09-08）

- 負責：Codex；使用者直接指派，前置為 `95d6af8`。
- 範圍：`css/ashen-forge.css`、本文件；保留原始圖片與遊戲功能。
- 實作：屬性面板透明邊界由 20px 減為 1px，框線外擴同步使用共用 12px，維持外框位置；內側 padding 為 8px 7px 10px，讓文字與捲動區擴展。
- 驗證：隔離瀏覽器量測修改前後外框相同、資訊區寬高增加；UI 定向測試、build、diff 檢查。
- 狀態：已完成；資訊區量測加寬 38px、可用高度增加 44px，外框矩形不變。

## Codex｜主區標題貼齊上框（2026-09-08）

- 負責：Codex；使用者追加需求，接續屬性資訊區擴展。
- 範圍：`css/ashen-forge.css`、本文件；不修改圖檔或互動邏輯。
- 實作：功能標題移除上方與左右 margin；屬性與戰鬥標題以負 margin 抵銷父容器 padding，底板填滿標題矩形。標題保留正常排版，下方內容隨之上移，戰鬥技能列維持場景底部定位。
- 驗證：瀏覽器量測標題對準框線內緣、下方內容上移及外框不變；UI 定向測試、build 與 diff 檢查。
- 狀態：已完成；隔離 Edge HTML/CSS 量測三區標題均貼齊上方及左右內框，功能內容上移 24px、戰鬥內容上移 21px；UI 測試 18/18，build 324 檔通過。限制：幾何驗證未執行遊戲存檔或戰鬥邏輯。

## Codex｜以三段素材重組主區框線（2026-09-08）

- 屬性外框對齊：屬性面板透明 border 為 20px，另外兩區為 1px；屬性框線外擴量須補償差額，由 20px 改為 31px。只向外擴展裝飾框，內容與捲動區保留。以隔離 HTML 的瀏覽器幾何量測驗證上下邊緣一致。

- 本輪修正：保留使用者最新的 12px 框線、60px 角飾、1.2 倍縮放及 x=29px／y=31px 校正。offset 定義為左上角素材座標，右側反轉水平位移，下側反轉垂直位移；直邊旋轉定位改由框線半高計算。框線與角飾共用外擴變數。只修改 CSS 與本文件；使用者原圖變更留在工作樹，不納入本次提交。
- 本輪驗證結果：Edge 無頭瀏覽器隔離載入 HTML/CSS（移除遊戲腳本），屬性區上下邊緣由 52／905 對齊為 41／916，另外兩區亦為 41／916；UI 定向測試 18/18、build 324 檔與 diff 空白檢查通過。此量測只驗證框線幾何，不代表完成遊戲互動或所有素材的目視驗收。

- 狀態：進行中
- 任務分類：全域 UI／主區框線素材重組
- 使用者需求：每一條橫邊與直邊只使用 `line-center` 圖檔，以連續平鋪方式拼接，不得沿長度拉伸原圖；線段在直角交叉點直接截斷。`iron-corner-tl` 的框線交叉點須作為縮放錨點，四角 offset 先設為 `0px`；戰鬥區技能列不可壓住 Buff。
- 允許修改：`index.html`、`css/ashen-forge.css`、`docs/AI_TASKS.md`；圖片素材僅可讀取，不可修改。
- 禁止修改：`js/**`、遊戲資料、互動行為、存檔、公式、Worker Protocol 與其他 UI 版面／功能。
- 實作：主區每一邊以原比例縮小至 20px 高的 `line-center`，用 `repeat-x` 沿邊連續平鋪；直邊旋轉同一張圖。不得沿長度拉伸原圖。線段端點止於面板的四個交叉點，不得向角飾外側伸出；角飾在上層覆蓋交點和內側線段，形成交疊。角飾交叉點固定使用其容器的 `50% / 50%` 縮放原點，並以相對於自身的 `translate()` 定位，因此修改 `--af-corner-size` 仍會固定交叉點。定位另扣除各框線容器的外擴量（主區 `12px`、屬性區 `20px`），使角飾與線段使用同一個交叉座標系；`--af-corner-scale` 等比例縮放，`--af-corner-offset-x` 與 `--af-corner-offset-y` 均設為 `0px`，供使用者後續微調。不得使用百分比作為 `top`／`left`／`right`／`bottom` 的絕對定位偏移，避免其相對於面板尺寸而將角飾推出畫面。
- 補充：屬性面板的角飾與線段放在可視捲動框內，避免被自身捲動裁切；戰鬥技能列只保留本體內側鐵框，內距回復貼齊技能圖示的 4px／8px。
- 校正：外框改放在屬性欄內容外側 20px，將捲動責任移至 `#attr-panel`，避免框線侵入數字；角飾由 35px 放大 15% 至 40px，延伸線段向四角多送入 10px，與角飾交疊。
- 縮放：框線素材統一以原圖約 29% 等比渲染（固定高 20px），以平鋪延展每一邊；不再產生拉伸變形或中心與延伸段接縫。
- 驗證：確認三主區四角、四條邊、16 個接點連續且同色，屬性面板角飾存在，背包與彈窗無角飾，戰鬥技能列無任何外擴框圖；執行 UI 定向測試、建置與差異空白檢查。
- 前置依賴：`ea36156`；2026-09-08 衝突預檢無其他副本或分支來源。

## Codex｜還原原框圖並消除直邊接縫（2026-09-08）

- 狀態：已完成（2026-09-08）
- 任務分類：全域 UI／九宮格框圖最小修正
- 使用者需求：回復原有 UI；只把直邊連續貼圖的拼接毛刺消除，其餘上、下橫邊、角落、材質、尺寸與排版不得改動。
- 允許修改：`css/ashen-forge.css`、`docs/AI_TASKS.md`。
- 禁止修改：`index.html`、`js/**`、UI 版面尺寸、遊戲資料、互動行為、存檔、公式、Worker Protocol 與圖片素材。
- 實作：還原原本的 `clean-iron-frame.png` 九宮格框圖與既有切片尺寸；只將 `border-image` 的第二個重複方向由 `round` 改成 `stretch`。水平邊仍用原本的 `round` 平鋪，四角和所有既有框圖材質不變；直邊不再有重複貼圖的接縫。
- 驗證：檢查所有套用框圖的主區、側欄、背包、戰鬥技能列與日誌／彈窗；執行 UI 定向測試、建置與差異空白檢查。
- 前置依賴：`f5f716a`；2026-09-08 衝突預檢無其他副本或分支來源。
- 驗證結果：原框圖、橫邊、角落、容器尺寸與所有互動程式均已還原；僅垂直框邊從重複拼接改為單段延展，避免出現毛刺接縫。
- 已知風險：直邊鐵條會隨容器高度等比延展；不會重複生成新的尖刺或改變容器幾何。
- 未完成項目：無。
- Commit：待建立 `[Codex] fix: 還原框圖並修正直邊接縫`。
- 後續接手者：使用者／主整合工作區。

## Codex｜拆分主區角飾並收斂技能列外框（2026-09-08）

- 狀態：已完成（2026-09-08）
- 任務分類：全域 UI／框圖裝飾範圍修正
- 使用者需求：四角裝飾獨立成圖並縮小 30%；只有屬性、功能、戰鬥三個主區保留角飾；背包、彈窗與技能列不保留角飾；技能列外框需貼齊本體且不得遮住 Buff。
- 允許修改：`index.html`、`css/ashen-forge.css`、`images/ui/ashen-forge/iron-rail-frame.png`、`images/ui/ashen-forge/iron-corner-tl.png`、`docs/AI_TASKS.md`。
- 禁止修改：`js/**`、遊戲資料、互動行為、存檔、公式、Worker Protocol 與既有素材。
- 實作：從既有框圖精確裁出左上角飾圖，透過 CSS 鏡射佈署四角；另抽出無角飾的鐵質邊條供所有次級框圖使用。主區角飾尺寸為原 72px 的 70%（50px）；技能列改為 14px 貼齊鐵框。
- 驗證：確認三個主區各有四個縮小角飾，背包／彈窗／技能列無角飾，技能列與 Buff 不重疊；執行 UI 定向測試、建置與差異空白檢查。
- 前置依賴：`cbb76f1`；2026-09-08 衝突預檢無其他副本或分支來源。
- 驗證結果：主區角飾使用單一的 `iron-corner-tl.png`，以 CSS `scaleX`／`scaleY` 鏡射成四個方向，尺寸由原框圖的 72px 降為 50px；次級框圖全部切換到沒有角飾的 `iron-rail-frame.png`。技能列外框由 28px／`inset: -10px` 收為 14px／`inset: -4px`，不再跨入上方 Buff 區。
- 已知風險：角飾與原框圖採相同來源，若日後替換 `clean-iron-frame.png`，應同步重新裁出這兩張衍生素材。
- 未完成項目：無。
- Commit：待建立 `[Codex] fix: 收斂主區角飾與技能列外框`。
- 後續接手者：使用者／主整合工作區。

## Codex｜精修人體輪廓裝備格尺寸與對位（2026-09-08）

- 狀態：已完成（2026-09-08）
- 任務分類：裝備 UI／精準格位校正
- 使用者需求：裝備格仍未準確貼合背景，且部分尺寸與原始 UI 框不一致；需依原圖金屬外框精修位置與大小。
- 允許修改：`css/ashen-forge.css`、`docs/AI_TASKS.md`。
- 禁止修改：`index.html`、`js/**`、裝備資料、穿戴／拖放事件、存檔、公式、Worker Protocol 與 UI 圖檔。
- 實作：以 `character_UI.png` 的 13 個羊皮內襯為基準，重設每格中心與尺寸，保留外部金屬框可見；不新增容器或變更裝備圖示的資料／載入方式。
- 驗證：本機逐格檢查框線、中央下方與雙武器長框比例；確認裝備點擊詳情、UI 定向測試、建置與 Console。
- 前置依賴：`37ce55b`；2026-09-08 衝突預檢無其他副本或分支來源。
- 驗證結果：以原始 PNG 的羊皮內襯色域逐格量得 13 組精確邊界，並換算為相對座標；中央褲／靴、兩把長武器、戒指與飾品不再沿用錯誤的外框尺寸。實機確認背景圖載入、13 格可見、Console 0 error／0 warning。`node --test tests/ui-fixed-canvas.test.cjs tests/sidebar-layout.test.cjs tests/ui-worker-panels.test.cjs` 18/18 通過；`npm run build` 324 檔通過。
- 已知風險：格位座標與目前 `character_UI.png` 的 1096×1440 畫素版面綁定；替換此背景圖必須再次量測。
- 未完成項目：無。
- Commit：待建立 `[Codex] fix: 精修裝備欄格位尺寸`。
- 後續接手者：使用者／主整合工作區。

## Codex｜校正人體輪廓裝備格對位（2026-09-08）

- 狀態：已完成（2026-09-08）
- 任務分類：裝備 UI／素材格位對位
- 使用者需求：已還原的人體輪廓裝備欄中，實際裝備格必須精確對齊背景圖的 13 個金屬框。
- 允許修改：`css/ashen-forge.css`、`docs/AI_TASKS.md`。
- 禁止修改：`index.html`、`js/**`、裝備資料、穿戴／拖放事件、存檔、公式、Worker Protocol 與 UI 圖檔。
- 實作：依 `images/ui/character_UI.png` 的內框位置重設 13 個 `.eq-slot` 的中心與尺寸；只覆寫視覺座標，保留既有 DOM、class、事件與品質框樣式。
- 驗證：本機畫面比對 13 格均在背景內框中，點擊已裝備格仍開啟詳情；執行 UI 定向測試與建置，檢查 Console。
- 前置依賴：`4c2bd11`；2026-09-08 衝突預檢無其他副本或分支來源。
- 驗證結果：本機畫面逐一確認 13 個裝備格均置於對應金屬框的內襯範圍，包含中央褲／靴與兩側武器的大型長框；格位數量仍為 13，Console 0 error／0 warning。`node --test tests/ui-fixed-canvas.test.cjs tests/sidebar-layout.test.cjs tests/ui-worker-panels.test.cjs` 18/18 通過；`npm run build` 通過。
- 已知風險：僅針對目前 `character_UI.png` 的 1096×1440 比例校正；日後替換背景圖時需重新量測格位。
- 未完成項目：無。
- Commit：待建立 `[Codex] fix: 校正裝備欄格位對齊`。
- 後續接手者：使用者／主整合工作區。

## Codex｜還原裝備欄人體輪廓舊版型（2026-09-08）

- 狀態：已完成（2026-09-08）
- 任務分類：裝備 UI／視覺版型還原
- 使用者需求：目前裝備欄應由騎士圖樣版型，改回使用者提供的舊版「人體輪廓＋固定 13 格」版型。
- 允許修改：`css/style.css`、`css/ashen-forge.css`、`docs/AI_TASKS.md`、`images/character_UI .png`、`images/ui/character_UI.png`、`images/ui_molten_iron_frame.png`。
- 禁止修改：`index.html`、`js/**`、裝備資料、穿戴／拖放事件、存檔、公式與 Worker Protocol。
- 實作：保留既有 `#equip-grid`、`.eq-slot` 與全部格位座標，只將背景素材切換為使用者放入 `images/ui/character_UI.png` 的舊版人體輪廓圖；同步納入使用者移置的 UI 圖檔，不生成或替換任何素材。
- 驗證：檢查 13 個格位仍存在、格位事件未變；執行建置與裝備 UI 定向測試，並以本機瀏覽器實看裝備頁、裝備／卸下操作與 Console。
- 前置依賴：無；2026-09-08 對 CSS、任務文件與素材路徑的衝突預檢無其他副本或分支來源。
- 驗證結果：本機 1920×1080 畫面確認背景為 `images/ui/character_UI.png`、13 個裝備格全數可見且座標回到人體輪廓版型；點擊已裝備格後詳情面板正常更新。`node --test tests/ui-fixed-canvas.test.cjs tests/sidebar-layout.test.cjs tests/ui-worker-panels.test.cjs` 18/18 通過；`npm run build` 通過；Console 0 error／0 warning。
- 已知風險：素材檔由使用者移入 `images/ui/`；本次一併提交舊路徑刪除與新路徑新增，合併時請保留這組素材路徑調整。
- 未完成項目：無。
- Commit：待建立 `[Codex] fix: 還原裝備欄舊版型`。
- 後續接手者：使用者／主整合工作區。

## 任務：全遊戲 UI 暗黑奇幻風格重製（2026-09-03）

任務狀態：已完成（2026-09-03）

任務分類：全域 UI／視覺設計／版面整理

負責 AI：Codex

使用者需求：以提供的暗黑奇幻遊戲介面為視覺參考，全面細緻化現有 UI 的邊框、按鈕、圖形與排版；
主畫面維持左側功能區、右側戰鬥場景區；只改 UI，不得改動任何遊戲功能或應用邏輯。

任務內容：在既有 DOM、事件與資料流完全不變的前提下，集中重製全域色彩、材質、面板、按鈕、
分頁、表單、捲軸、物品格、技能格、彈窗、提示框與戰鬥區外框；強化 1920px 桌面版的左右主次層級，
並保留窄螢幕的既有可用性。後續依使用者回饋補入原創石板、鑄鐵與透明熔鐵九宮格邊框圖片，
讓材質與邊角不只依賴 CSS 漸層；再依畫面回饋移除過度突出的角落插圖，收斂為細鑄鐵外框與局部熔紅，
避免裝飾壓過功能內容。後續修復樣式覆寫誤將戰鬥技能列改為正常文流的回歸，並驗證戰況抽屜／日誌介面
維持原有定位、顯示與開啟行為；移除可捲動內容與大量格子的重型材質疊圖，降低滾輪捲動重繪成本。
參考圖只作視覺方向，不把圖中文字或功能視為需求。

允許修改：

- `css/style.css`
- `index.html`（僅遞增 CSS 快取查詢版號）
- `docs/AI_TASKS.md`
- `images/ui_dark_slate_tile.png`
- `images/ui_cast_iron_tile.png`
- `images/ui_molten_iron_frame.png`

禁止修改：

- `js/**`
- 遊戲資料、公式、Worker Protocol、存檔格式與任何功能行為

前置依賴：無。2026-09-03 使用者確認各分支合併後，`docs/AI_TASKS.md`、`css/style.css` 與三個新增圖片
路徑的衝突預檢皆無來源；本任務仍明確避開 `index.html`。

測試要求：`npm run build`、UI 相關定向測試、`git diff --check`；以本機瀏覽器檢查主要分頁、彈窗、
左右分區、1920×1080 與窄螢幕排版，確認 Console 無新增錯誤。

完成條件：全遊戲 UI 形成一致的暗黑奇幻視覺語言，左側功能區與右側戰鬥場景層級清楚；
不新增、不刪除、不重新綁定任何功能控制項，現有功能與測試不退化。

驗證結果：

- `npm run build`：316 個檔案語法／編譯檢查全數通過。
- UI 定向測試：`sidebar-layout`、`ui-fixed-canvas`、`skill2-ui`、`tooltip-modal-close`、
  `tower-head-layout` 共 13/13 通過。
- 本機瀏覽器逐頁檢查裝備、熔爐、寶石、技能、高塔、設定與技能詳情彈窗；各功能頁無橫向溢位，
  1920×1080 與 1366×768 固定畫布皆完整保留左側功能區、右側戰鬥區，Console 0 error／0 warning。
- `git diff --check` 通過。
- 後續圖片材質優化：原創石板、鑄鐵與透明熔鐵九宮格邊框均由目前工作副本實際載入；
  1920×1080、1366×768 無橫向溢位，主框與隱藏彈窗的邊框圖片均套用成功，Console 0 error／0 warning。
- 後續建置與 UI 定向測試再次通過：`npm run build`；13/13 項 UI 測試通過。
- 外框視覺收斂：移除所有巨型熔鐵角圖；主三欄回到深色鑄鐵細框，僅在背包與戰鬥技能列的下緣保留
  極細熔紅提示。實機確認彈窗與主畫面無圖形壓迫或橫向溢位，Console 0 error／0 warning。
- 功能定位回歸修復：戰鬥技能列恢復原本 `position: absolute` 的場景底部定位（與戰鬥區底部相距 11px）；
  戰鬥資訊按鈕可開啟右側抽屜，日誌內容可見。未變更任何 JS 或事件綁定。
- 捲動效能修復：可捲動主內容與大量物品格改用純 CSS 漸層，移除重複的石板／鑄鐵 PNG 混色圖層；
  保留主要面板材質，降低滾輪捲動時的重繪負擔。修復後實機 Console 0 error／0 warning、無橫向溢位。

修改檔案：`css/style.css`、`index.html`、`docs/AI_TASKS.md`、`images/ui_dark_slate_tile.png`、
`images/ui_cast_iron_tile.png`、`images/ui_molten_iron_frame.png`。未修改但檢查過 `js/ui-scale.js`、
各主要 UI 定向測試與全分頁執行期 DOM；沒有修改任何 JS、遊戲資料、公式、存檔或 Worker Protocol。

已知風險：新增三張原創 PNG 圖片約 6.85 MB，會增加首次載入量；已將 CSS 查詢版號由 `1.0.59` 遞增為
`1.0.60`。本次外框收斂因另一工作副本正修改 `index.html`，無法安全遞增至 `1.0.61`；若瀏覽器快取舊的
`1.0.60` 樣式，需強制重新整理一次。專案強制快取版號規則只要求 JS 修改時遞增版本，本次未修改 JS。

未完成項目：無。

Commit：待建立 `[Codex] fix: 還原戰鬥 UI 定位與捲動效能`。

完成後交給：使用者／主整合工作區。

## 任務：調整殛道落電效果與紫色雷電特效（2026-08-19）

任務狀態：已完成（2026-08-19）

任務分類：技能效果調整／戰鬥計算／戰鬥 VFX

負責 AI：Codex

使用者需求：調整「殛道落電」（現有 Skills2 T7 `殛道落雷`）：落雷命中時對目標 6 米內的所有敵人造成傷害；
攻擊次數與攻擊目標數量各乘以 2；落雷命中暈眩中的敵人時，傷害額外提高 50%，且每級再提高 5%；
此增傷與原傷害採乘算；落雷的雷電特效改為紫色雷電。

允許修改：

- `config/Excel/Skills2.xlsx`
- `config/CSV/Skills2.csv`
- `js/skills2.js`
- `js/battle-renderer.js`
- `js/vfx.js`
- `tests/skill2-lightning.test.cjs`
- `index.html`
- `docs/AI_TASKS.md`

禁止修改：其他技能群組效果、存檔格式、Worker Protocol、無關技能數值、無關 UI／VFX。

前置依賴：雷系三大新版技能與既有落雷天降佇列已存在；衝突預檢於 2026-08-19 合併其他分支後通過。

測試要求：驗證 T7 6 米範圍內所有存活敵人均受傷、次數／目標數 ×2、暈眩增傷為原傷害的乘算倍率且每級 +5%；
驗證 Canvas／DOM 落雷本體與落地衝擊均使用紫色；執行雷系定向測試、完整 `npm test`、`npm run build`、
Skills2 Excel／CSV／JS round-trip、`git diff --check`。

完成條件：資料與程式同步、計算與雙路徑 VFX 回歸測試通過、更新前端快取版本並建立 `[Codex]` commit。

後續接手者：使用者／主整合工作區。

完成內容：T7 改為「殛道落電」，新增 6 米落點範圍傷害；攻擊次數與目標數量各乘 2；暈眩增傷採原傷害乘算，Lv.1 為 +55%（50% 基礎值＋每級 5%）；Canvas／DOM 落雷本體與地面衝擊改用紫色雷電。

驗證結果：`node --test tests/skill2-lightning.test.cjs tests/skill2-vfx.test.cjs` 59/59 通過；落雷生命週期與 VFX 定向測試 30/30 通過；`node tools/config_tables.cjs --apply Skills2` 語意變更 0；`npm run build` 通過 294 個檔案檢查；完整 `npm test` 共 1617 項，1612 通過，剩餘 5 項為既有基線失敗（嗜血狂怒、泥沼／熔岩沼、暴風雪、counter 欄位驗證），未涉及本任務修改。

資料備註：原 `config/Excel/Skills2.xlsx` 的 OpenXML 壓縮資料損壞，已依專案表格流程重建為可讀 workbook；Excel／CSV／JS round-trip dry-run 已確認無語意差異。

已知風險：完整套件仍有上述 5 項既有基線失敗，需由其他任務另行處理。

未完成項目：無。

Commit 編號：本次 `[Codex]` 功能提交（以 Git HEAD 為準）。

---

## 任務：虛空斬改為四道順時針向外擴張

任務編號：Codex-20260818-void-disc-quad-cw

任務狀態：已完成（2026-08-18）

任務分類：Skills2 參數／戰鬥 VFX／環繞場域

負責 AI：Codex

使用者需求：虛空斬從我方角色中心出現 4 個斬擊，四道剛好位於同一圓的 0／90／180／270 度位置，向外逐漸擴大，每秒擴大 4 米，4 道皆順時針旋轉。

允許修改：

- `config/Excel/Skills2.xlsx`
- `config/CSV/Skills2.csv`
- `js/skills2.js`
- `js/battle-renderer.js`
- `js/vfx.js`
- `tests/skill2-wind.test.cjs`
- `tests/skill2-vfx.test.cjs`
- `index.html`
- `docs/AI_TASKS.md`

禁止修改：虛空斬傷害、持續時間、命中判定以外的技能數值、存檔格式、Worker Protocol、無關技能／UI／VFX。

前置依賴：既有虛空斬 6 秒環繞場域、Canvas／DOM 特效與 Skills2 參數表同步流程已存在。

驗收方式：參數表與 JS 顯示 4 道、每秒 4 米、順時針；模擬層四個場域使用同一圓上相隔 90 度的獨立初始相位且同向旋轉；Canvas／DOM 各事件只畫一道並保留四道特效；定向測試與建置檢查通過。

完成條件：同步 CSV／Excel／JS、更新快取版號、補回歸測試、更新驗證結果並建立 `[Codex]` commit。

實作結果：Skills2 第七階改為 4 道虛空斬；四道初始相位固定為同一圓周上的 0／90／180／270 度，皆以每秒 1 圈順時針旋轉，半徑每秒平滑增加 4 米，持續時間維持 6 秒。Canvas 與 DOM 各事件只繪製一道，且保留四道獨立節點，不會因同向旋轉而合併。

驗證結果：`node --test tests/skill2-wind.test.cjs tests/skill2-vfx.test.cjs` 51/51 通過；`npm run build` 294/294 通過；`node tools/config_tables.cjs --apply Skills2` 顯示語意變更 0；完整 `npm test` 1602/1607 通過，5 個失敗均位於本任務未修改的反擊／地／冰技能既有測試。

已知風險：完整測試中的 5 個既有失敗仍需另立任務處理；不影響本次虛空斬定向測試與建置檢查。

未完成項目：無。

Commit 編號：`19325dc`（功能提交）。

---

## 任務：修正落雷無目標時仍向地面發射

任務編號：Codex-20260818-lightning-target

任務狀態：已完成（2026-08-18）

任務分類：戰鬥 VFX／目標生命週期

負責 AI：Codex

使用者需求：落雷偶爾沒有有效敵方目標，卻仍在玩家附近向地面發射；修正為只有解析到有效目標時才建立落雷，避免以預設座標誤播。

允許修改：

- `js/battle-renderer.js`
- `tests/lightning-vfx-lifecycle.test.cjs`
- `index.html`
- `docs/AI_TASKS.md`

禁止修改：技能數值與目標選擇規則、Worker Protocol、存檔格式、DOM 落雷畫法、無關 UI／VFX。

前置依賴：既有落雷／雷殞的延遲目標守門已存在；本任務只收緊 Canvas 顯示層對缺失目標的處理。

驗收方式：缺失或已離場的落雷目標不得通過 Canvas 目標守門，也不得退回玩家前方預設座標；一般普攻的尚未建立目標相容行為維持不變；定向測試與完整測試通過。

完成條件：完成程式與回歸測試、同步 `index.html` 快取版號、更新驗證結果與已知風險，建立 `[Codex]` commit。

驗證結果：`tests/lightning-vfx-lifecycle.test.cjs`、`tests/ui-worker-events.test.cjs`、
`tests/skill2-lightning.test.cjs` 共 44 項全通過；`node tools/build_check.cjs` 294/294 通過；
完整 `npm test` 共 1607 項、1602 通過、5 項失敗，失敗均為既有的 `counter/bloodrage`、
泥沼範圍、暴風雪範圍與技能系統參數漂移，未涉及本任務檔案邏輯。

已知風險：本次未修改技能數值與目標選擇；若目標尚未建立 Canvas 實體，落雷會被取消而不等待補播，
這是避免誤劈地面的安全取捨。實機畫面仍建議在混合技能與目標快速死亡情境下目視確認。

未完成項目：無。

完成後交給：使用者／主整合工作區。

---

## [Codex] 虛空斬持續特效與技能時間同步

任務狀態：Completed

任務分類：戰鬥 VFX／技能顯示修正

負責 AI：Codex

使用者需求：虛空斬技能說明為持續 6 秒，但實際觀察到螺旋特效約 2 秒就消失；
要求特效持續至技能時間結束，並持續旋轉、向外擴展至 6 秒結束。

允許修改：`js/battle-renderer.js`、`js/vfx.js`、`css/style.css`、
`tests/skill2-wind.test.cjs`、`tests/skill2-vfx.test.cjs`、`index.html`、`docs/AI_TASKS.md`。

禁止修改：技能傷害、命中判定、狀態數值、存檔格式、Worker Protocol 與無關技能效果。

驗收方式：確認虛空斬事件將技能實際 `dur` 傳給兩條顯示路徑；Canvas／DOM 特效均以該
`dur` 回收，且測試驗證施放後 5 秒仍存在、6 秒到期後才清除。

完成內容：Canvas 改為以事件 `dur` 作為硬性壽命，新增連續刃影形成向外擴展的螺旋；
DOM 後備路徑新增虛空斬專用螺旋，並以 `r + grow × dur` 計算結束半徑；更新兩支腳本
版號與回歸測試。

驗證結果：`node --test tests/skill2-wind.test.cjs tests/skill2-vfx.test.cjs
tests/skill-special-vfx.test.cjs` 52/52 通過；`node --check js/vfx.js`、
`node --check js/battle-renderer.js` 通過；`node tools/build_check.cjs` 294/294 通過；
完整 `npm test` 1606 項中 1601 通過、5 項失敗，失敗均為乾淨基準線既有的
counter 消耗／泥沼範圍／暴風雪範圍／參數漂移，未新增本任務相關失敗。

已知風險：尚未以實機瀏覽器逐幀目視確認 DOM 後備路徑的螺旋尺寸；Canvas 與 DOM
均保留現有特效節點上限，極端特效洪峰時仍可能依優先級淘汰視覺節點，但不影響技能判定。

完成後交給：使用者／主整合工作區。

## 任務：火狩與其他技能同時施放時特效遺失

任務狀態：已完成（2026-08-18）

任務分類：技能效果／戰鬥 VFX／特效排程與容量保護

負責 AI：Codex

使用者需求：火狩單獨施放時會出現環繞特效，但與其他技能同時施放時火狩特效不出現；需修正為混合技能場景也能穩定顯示。

任務內容：檢查 Canvas 與 DOM 兩條 VFX 路徑的事件佇列、特效容量上限與火狩環繞場域生命週期；讓火狩長駐環繞事件在特效洪峰時具有明確保護優先級，且事件被容量拒收後不殘留失效的環繞狀態，避免後續刷新永遠被錯誤合併。

允許修改：

- `js/battle-renderer.js`
- `js/vfx.js`
- `tests/skill2-vfx.test.cjs`
- `tests/vfx-performance.test.cjs`
- `index.html`
- `docs/AI_TASKS.md`

禁止修改：技能數值、傷害計算、技能施放時序、存檔格式、Worker Protocol、無關 UI／VFX。

前置依賴：既有火狩環繞場域與 Canvas／DOM VFX 路徑已存在；目標檔案衝突預檢無來源。

測試要求：執行火狩／VFX 定向測試、完整 `npm.cmd test`、`npm.cmd run build`、JavaScript 語法檢查與 `git diff --check`，並同步主頁快取版本。

完成條件：混合特效容量下火狩事件不被較低優先級事件淘汰；Canvas 拒收後可安全重建；DOM 事件洪峰保留火狩長駐事件；建立 Codex commit。

驗證結果：火狩／VFX 定向測試 49/49 通過；完整 `npm.cmd test` 為 1606 項、1601 通過、5 項既有失敗；`npm.cmd run build` 294/294 通過；`node --check js/battle-renderer.js`、`node --check js/vfx.js` 與 `git diff --check` 通過；`index.html` 的 `vfx.js`／`battle-renderer.js` 快取版號已同步。

已知風險：完整測試的 5 項失敗是既有參數表／測試斷言漂移（`counter`、`bloodrage`、泥沼尺寸 2 項、暴風雪範圍），與本次特效容量修改無關；尚未進行瀏覽器實機目視驗證。

未完成項目：無程式項目。

後續接手者：使用者／主整合工作區。

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

## 任務：修正風系三項顯示缺陷（綠色落雷／地板綠方塊／風刃逐格移動）（2026-08-19）

任務狀態：已完成（2026-08-19）

任務分類：戰鬥 VFX 分派／場域補間

負責 AI：Claude

使用者需求：（1）真空斬的進化階出現不存在於設計的「綠色落雷」；（2）風刃發射時地板出現綠色方塊；（3）追跡風刃是一格一格移動而不是平滑追擊。

任務內容：三項都在顯示層，模擬層事件本身正確。實機掛勾 `BattleRenderer.onVfx` 取得事件流後定位：
（1）`wind-rend-spread`（風切擴散，風切狀態來自真空斬 T3）走 `fxKind:'chain'`，但 `handleChainVfx`／`vfxChain` 沒有它的分支，掉進結尾的【潛能：連鎖閃電】天頂大雷＋折射電鏈，而 `spawnBolt` 以事件屬性著色 → 綠色落雷。
（2）狂風碎裂的沿途脈衝走 `fxKind:'burst'`＋`variant:'wind-burst'`，`case 'burst'` 沒有這個分支，範圍內沒有敵人時掉到結尾的 `spawnAreaFlash(rect)` → 以 `area.r` 換算的 120×120 綠色圓角方塊（實測 25 秒內 324 則）；既有的 `spawnWindBurst` 氣浪反而永遠不會被呼叫。
（3）場域快照每則代表模擬層一個 0.1 秒節拍，但訊息到達會抖動：實測前景多為 92～111 毫秒一批，每秒左右出現一次約 200 毫秒空窗、下一批一次帶兩則。每則都用固定 0.12 秒補間時，那一批會用一段的時間走兩段的距離再停住等下一批 → 逐格前進。

允許修改：

- `js/battle-renderer.js`
- `js/vfx.js`
- `index.html`
- `tests/skill2-vfx.test.cjs`
- `docs/AI_TASKS.md`

禁止修改：技能數值與判定幾何、模擬層事件格式、Worker Protocol、存檔格式、無關技能的特效。

前置依賴：`dc3c2a1`（封鎖風系泛用 aura 方框）只擋住 `spawnAura`／`vfxAura`，未涵蓋 `spawnAreaFlash` 與 chain 結尾兩條路徑；本次補齊。目標檔案衝突預檢無來源。

測試要求：`tests/skill2-vfx.test.cjs` 定向測試、完整 `npm test`、`npm run build`，以及實機（自建 preview server、GM 全滿風系三群組）事件流與場景樹驗證。

完成條件：風切擴散畫成小風刃掠過、雷鏈畫法只留給雷系；沿途脈衝畫氣浪且地板不再出現方塊；同一批帶兩個模擬步時補間時間同步加倍、畫面不再停頓。

驗證結果：`tests/skill2-vfx.test.cjs` 27 項全通過（新增 2 項）；完整 `npm test` 1611 項 / 1606 通過 / 5 既有失敗，與同 commit 乾淨基準線（1609 項 / 1604 通過 / 5 失敗）相比無新增失敗；`npm run build` 294/294 通過。實機驗證：
- `burst`＋`wind-burst`（0 目標）→ zone 層子節點維持 0（不再產生方框）、fx 層 +1（氣浪）。
- `chain`＋`wind-rend-spread`（3 目標）→ fx 層 +2（兩道小風刃），無高度 >150px 的節點（無天雷）；對照組 `variant:'chain'` 仍劈出 72×329 的天雷，既有雷鏈未受影響。
- 追跡場域以固定 16ms 步進 ticker 量測：同批兩則（36px）修正後為每幀 2.4px 連續走 240ms；單則對照組（修正前形狀）為每幀 4.8px 走 120ms 後停住 200ms 以上。

已知風險：
- 完整測試的 5 項失敗全部是既有的參數表漂移（嗜血狂怒施法消耗、泥沼術兩項、暴風雪場域、SKILLS2 群組數），與本任務無關，已於乾淨副本重現。
- 補間長度以 `FIELD_VFX_MIN_MOTION_SEC`（0.12 秒）為單步基準、依批次步數放大，比理想值（0.1 秒）略長；效果是永遠被下一批接手而不會停頓，代價是顯示位置比判定位置多落後約 20 毫秒。
- 雷球（`spawnThunderOrbField`）與泥沼／火牆同樣是成批到達，但節拍較長（0.35 秒）目前無回報；本次未一併改動。
- 高塔 DOM 路徑沒有 `wind-burst` 的專用畫法，沿途脈衝在高塔仍只有命中反饋（不會出現方塊）。

未完成項目：高塔（DOM 路徑）風切擴散的目視確認。

完成後交給：使用者／主整合工作區。

## 任務：追擊場域不再原地待命（小風刃逐格移動的根因）（2026-08-19）

任務狀態：已完成（2026-08-19）

任務分類：戰鬥模擬層／追擊場域移動

負責 AI：Claude

使用者需求：前一次修正後大風刃已正常，但小風刃仍是一格一格移動，且沒有敵人時會停留在原地；應該朝最後的方向直線移動就好。

任務內容：與前一次的顯示層問題不同，這次的根因在模擬層 `sgGroundMove`。以既有測試環境逐 tick 追蹤追擊場域的座標，確認兩件事：
（1）`sgGroundChaseDest` 會把「站在自己腳下的敵人」也挑成落點，距離幾乎為 0 →
`dist <= 0.5` 立刻判定抵達、又立刻挑到同一個 → 場域每個 tick 只跟著那個敵人抖幾個像素＝逐格移動；
（2）抵達分支直接 `return`，把該 tick 剩下的位移丟掉——換一次目標就少走一格；
（3）範圍內沒有敵人時 `sgGroundChaseDest` 回 null → `if (!f.dest) return;` → 完全停住。
接觸判定的場域停下來等於不再命中任何東西，因此這同時是傷害缺陷。
修正：落點候選排除「已在自己判定圈內」的敵人；抵達後在同一步內接著走完剩餘位移；
沒有可追的落點時沿最後的飛行方向（`f.moveAngle`）直線飛，下一個 tick 仍會重新找落點。
顯示層另補一項：補間長度除了依批次步數放大，再以到達間隔的指數平均為下限，
避免 Worker 送出零頭步（單則只帶 1～2 像素）時畫面走完又停著等下一批。

允許修改：

- `js/skills2.js`
- `js/battle-renderer.js`
- `index.html`、`js/bridge.js`、`js/worker/sim.worker.js`（快取版號）
- `tests/skill2-wind.test.cjs`、`tests/skill2-vfx.test.cjs`
- `docs/AI_TASKS.md`

禁止修改：技能數值與參數表、場域的判定半徑與節拍、雷球（`chaseM = 0`）的抵達停駐行為、存檔格式、Worker Protocol。

前置依賴：`c64be97`（風系三項顯示缺陷）。目標檔案衝突預檢無來源。

測試要求：`tests/skill2-wind.test.cjs`／`tests/skill2-vfx.test.cjs` 定向測試、完整 `npm test`、`npm run build`，並以實機事件流確認場域座標不再出現零位移。

完成條件：追擊場域每個 tick 都走滿 `speed × dt`；沒有敵人時沿最後方向直線飛；雷球維持抵達即停駐。

驗證結果：`skill2-wind` 29 項、`skill2-vfx` 27 項全通過（各新增 1 項）；完整 `npm test` 1607 通過 / 5 既有失敗（基準線 1604/5，無新增）；`npm run build` 294/294。
- 無頭追蹤：修正前追擊場域抵達後每 tick 位移 0.0 並永久停住；修正後每 tick 固定 18px（speed 180 × 0.1），三隻敵人叢集情境下 4 秒內來回穿梭並命中 11 次（修正前只有抵達前的少數幾次）。
- 實機（24 個追擊場域、14 秒）：600 筆座標增量中**零位移 0 筆**，平均速度 170px/s（表定 180）。
- 顯示層：單則事件在到達間隔約 200ms 時，補間由 120ms 拉長為 224ms，走完前即被下一批接手。

已知風險：
- 追擊場域從「抵達後停住」變成「持續穿梭」，`寒冰爆裂箭`（追蹤冰箭）與 `追跡風刃` 的實際命中次數會提高——這是設計文檔（「碰到才算一次命中」「來回穿梭追擊」）本來的意思，但等同於一次隱性增益，數值若需回調請調 `hits`／`gap`／`pct`。
- 沒有敵人時場域會一路飛出戰鬥區（生命週期到期才消失）；這是使用者指定的行為。
- 完整測試的 5 項失敗全部是既有的參數表漂移，與本任務無關。

未完成項目：無。

完成後交給：使用者／主整合工作區。

## 任務：追蹤場域改為指數跟隨（小風刃仍逐格移動的最後一段）（2026-08-19）

任務狀態：已完成（2026-08-19）

任務分類：戰鬥 VFX／追蹤場域補間

負責 AI：Claude

使用者需求：模擬層修好後小風刃仍是一格一格移動；另詢問畫面上新出現的綠色橢圓圈是什麼。

任務內容：把單一顆追擊場域的事件到達序列錄下來（實測：204ms 帶兩步 → 0ms 補一個 1.6px 的零頭步 →
94/110/118ms 各一步 → 178ms 兩步……），以這條真實序列回放既有的「固定時長補間」，
得到 13.9% 的畫格完全靜止、p95 速度是標稱值的 1.9 倍——事件早到就得衝刺、晚到就走完停住，
批次步數與到達間隔的估計都只能減輕、無法消除，因為問題出在「用時間去湊距離」這個模型本身。
改為指數跟隨：每幀速度 ＝ min(離權威座標的距離 / TAU, 模擬層速度 × 2)。目標暫停時自己平滑減速、
目標跳一大步時自己加速，不存在硬停頓。TAU 取 0.14 秒，平衡點落後距離 ≈ 速度 × TAU（180px/s 約 25px），
小於風刃自身體積，判定圈與畫面仍重疊。順帶移除上一版的 `fieldVfxStepSec`／批次量測欄位（已無使用者），
並把風刃朝向改由「畫面目前位置 → 權威座標」決定（跟隨模型沒有補間起點）。
綠色橢圓圈是【狂風碎裂】的沿途脈衝（`spawnWindBurst`，半徑＝參數表的 6 米判定範圍），
上一版之前它被錯畫成綠色方框，現在是設計中的氣浪環，屬正常顯示。

允許修改：

- `js/battle-renderer.js`
- `index.html`（快取版號）
- `tests/skill2-vfx.test.cjs`
- `docs/AI_TASKS.md`

禁止修改：模擬層的移動與判定、場域參數、其他技能的特效。

前置依賴：`055c2ec`（追擊場域不再原地待命）。目標檔案衝突預檢無來源。

測試要求：`tests/skill2-vfx.test.cjs`、完整 `npm test`、`npm run build`，並以實測到達序列在**實機渲染器**上回放比較。

完成條件：以同一條實測序列回放時不再出現靜止畫格，且速度分布明顯收斂。

驗證結果：實機渲染器（虛擬時鐘 + 手動推 ticker，60fps 回放同一條 6.8 秒實測序列）：
靜止畫格 13.9% → **4.9%**、最慢畫格 0 → **37px/s**（不再有完全靜止的畫格）、
p95 速度 338 → 262px/s、最大 341 → 318px/s；平均落後 17px、最大 39px。
剩下的 4.9% 慢速畫格是風刃真的在轉向（直線位移本來就會變短）。
`skill2-vfx` 27 項全通過；完整 `npm test` 1607 通過 / 5 既有失敗（基準線無新增）；`npm run build` 294/294。

已知風險：
- 畫面比判定位置落後約 17～25 像素（追跡風刃體積 96 像素、判定半徑 48 像素，兩者仍重疊）；
  要更貼齊可調小 `FIELD_VFX_FOLLOW_TAU_SEC`，代價是靜止畫格回升。
- 追蹤冰箭走同一條顯示路徑，因此一併變平滑；兩者的差別只剩體積（30px vs 96px）、
  數量（2～4 個 vs 最多 24 個）與「風刃會轉向、冰晶沒有朝向」。
- 雷球與火牆仍走固定時長補間（節拍 0.35 秒、目前無回報），未一併改。

未完成項目：無。

完成後交給：使用者／主整合工作區。

## 任務：追蹤子彈的飛行軌跡加入轉彎半徑（2026-08-19）

任務狀態：已完成（2026-08-19）

任務分類：戰鬥模擬層／追擊場域移動

負責 AI：Claude

使用者需求：追蹤類型的子彈不應該直來直往——例如向右水平飛出貫穿敵人後，不該直接水平折返，
而應該有轉彎半徑；半徑依子彈體積而定，體積越大轉得越開，一般落在 4～8 米，左轉右轉皆可。

任務內容：`sgGroundMove` 拆成三段：跟隨（暴風雪）／有轉彎半徑的追擊（`sgGroundChaseStep`）／
直線飛向落點後停駐（`sgGroundFlyStep`，雷球原本的行為完全不變）。
追擊改為「限制角速度」：每個 tick 能轉的角度＝這一步的弧長 ÷ 轉彎半徑，
因此方向是連續變化的，不再每個 tick 直接對準落點。
轉彎半徑由場域自己的判定半徑（＝子彈實際體積）線性映射到 4～8 米
（`SG_CHASE_TURN_MIN_M`／`MAX_M`／`BODY_REF_M = 5`）：追跡風刃體積 4.8 米 → 7.84 米，
追蹤冰箭體積 1.5 米 → 5.2 米。正後方（差 180 度）左右一樣近時交給出生時決定的
`turnSide`（依出生序號交替，不額外消耗亂數），同一批小風刃才不會整齊劃一往同一側轉。
另補一條放棄落點的規則：落點掉進自己的迴轉圈內又不在正前方時改挑下一個——
最小轉彎半徑限制下那種目標永遠繞不進去，硬追會變成繞著它打轉。

允許修改：

- `js/skills2.js`
- `index.html`、`js/bridge.js`、`js/worker/sim.worker.js`（快取版號）
- `tests/skill2-wind.test.cjs`、`tests/skill2-vfx.test.cjs`
- `docs/AI_TASKS.md`

禁止修改：技能數值與參數表、場域的判定半徑與節拍、雷球的直線飛行與抵達停駐、顯示層、存檔格式。

前置依賴：`8c5cd9b`（追蹤場域指數跟隨）。目標檔案衝突預檢無來源。

測試要求：`tests/skill2-wind.test.cjs`／`tests/skill2-vfx.test.cjs` 定向測試、完整 `npm test`、
`npm run build`，並以無頭軌跡與實機事件流確認轉角上限。

完成條件：追擊場域單一 tick 的轉角不超過「弧長 ÷ 轉彎半徑」；位移仍是完整的 speed × dt；
雷球維持原行為。

驗證結果：無頭軌跡（體積 4.8 米、速度 180px/s）每 tick 位移固定 18.00px、最大轉角 13.2°
＝理論上限，貫穿後畫出直徑約 15.7 米的迴轉弧再折返。
實機（追跡風刃 24 個＋追蹤冰箭，14 秒）：兩者的轉彎樣本占比 68%／83%，
轉彎半徑分別為 7.84／5.2 米。`skill2-wind` 30 項、`skill2-vfx` 27 項全通過（各新增 1 項）；
完整 `npm test` 1608 通過 / 5 既有失敗（基準線無新增）；`npm run build` 294/294。

已知風險：
- 軌跡變成弧線後，同樣的存活時間內覆蓋的路徑形狀改變，接觸命中的次數會與直線折返略有差異
  （方向性偏差，不是單向增益）；數值若要精算請以實機 DPS 量測為準。
- 轉彎半徑取自場域的判定半徑，因此【巨型風刃】把體積練大時轉彎半徑也會跟著變大
  （4.8 米體積已吃到 7.84 米，接近 8 米上限）。
- 完整測試的 5 項失敗全部是既有的參數表漂移，與本任務無關。

未完成項目：無。

完成後交給：使用者／主整合工作區。

## Antigravity：全 18 招「超神進化」技能全面 DPS 測試與進階對比（2026-08-20）

任務狀態：已完成（2026-08-20）

任務分類：技能數值測試／超神進化平衡性評估

負責 AI：Antigravity

使用者需求：
1. 對目前所有的「超神進化」技能做全面 DPS 測試，用全身 100 級的傳奇裝備測試強化 +40，測試 100 級的冰原地圖敵人。
   - 測試小怪 20 隻，每 2 秒出一波，連出 10 波的 DPS。
   - 測試菁英怪 5 隻，每 2 秒出一波，連出 5 波的 DPS。
   - 測試 BOSS 1 隻的 DPS。
   - 注意裝備詞條：若超神進化 1~8 階技能需要特定詞條或屬性支持（如連擊數、屬性傷、暴擊等），全身裝備至少帶有兩條相關詞條。
2. 加入每個技能群組尚未點出超神進化前（1~7 階滿級）的基礎 DPS，方便與超神進化後做前後倍率對比。

任務內容：
- 建立無頭戰鬥模擬腳本 `scratch/test_all_ult_dps.cjs` 與 `scratch/test_base_dps.cjs`。
- 完整建構全身 13 格 100 級傳奇（稀有度 5，強化 +40，3.0x 乘數）裝備面板，並按各技能機制適配專屬詞條。
- 測試 6 個技能群組（突刺、迴旋斬、飛刀、疾風斬、血刃斬、雙刀亂舞）共 18 個超神進化分支與 6 個基礎技能在 3 大情境下的輸出與成長倍率。
- 完整輸出數據與對比報告至 `docs/TASK238_ULT_SKILLS_DPS_REPORT.md` 及 `scratch/all_ult_dps_results.json`、`scratch/base_skills_dps_results.json`。

允許修改：
- `docs/AI_TASKS.md`
- `docs/TASK238_ULT_SKILLS_DPS_REPORT.md`
- `scratch/`

驗證結果：
- 54 項超神進化測試與 18 項基礎技能測試全數完成。
- **成長最高**：飛刀（死亡收割者，小怪 31.72x 成長至 8.89B DPS）、疾風斬（雷神斬 17.95x 成長至 38.94B DPS；霹靂一閃 12.97x 成長至 28.14B DPS）、突刺（一擊必殺，BOSS 10.02x 成長至 5.31B DPS）。
- **機制質變**：迴旋斬（天霸風神斬轉為被動 0 GCD 釋放，群怪 2.06x 成長至 7.91B DPS）、雙刀亂舞（修羅亂舞雙持雙手巨劍享受詞條 +40%，輸出穩定翻倍至 4.39B DPS）。
- 詳細數據見 `docs/TASK238_ULT_SKILLS_DPS_REPORT.md`。

完成後交給：使用者／主協調者。

## 任務：修正戰鬥統計把命中事件誤當施放次數（2026-08-24）

任務狀態：已完成（2026-08-24）

任務分類：戰鬥統計／技能施放可觀測性

負責 AI：Codex

使用者需求：HP_lock 啟用後畫面看似只有飛刀持續施放；統計表中的飛刀次數快速增加，
需要確認其它技能是否真的沒有施放，並讓統計表能直接區分施放次數與傷害命中事件。

任務內容：保留現有傷害總量與每次傷害事件統計，新增每個主動技能成功施放時的獨立計數；
統計表改以「施放次數」與「命中／傷害事件次數」分開顯示，涵蓋一般技能、新版技能群組與潛力技能。
DoT／追蹤／多段傷害不得被計入施放次數；不改技能冷卻、傷害公式或 HP_lock／MP_lock 行為。

允許修改：

- `js/combat.js`
- `js/skills.js`
- `js/skills2.js`
- `js/potential.js`
- `index.html`（快取版號）
- `tests/skill-stats-panel-comprehensive.test.cjs`
- `docs/AI_TASKS.md`

禁止修改：技能數值表、存檔格式、GM 指令語意、技能排程規則。

前置依賴：`ed592e5`（HP_lock 下解除技能行動卡死）。目標檔案衝突預檢無來源。

測試要求：統計面板定向測試、GM 技能回歸測試、`npm run build`、`git diff --check`。

完成條件：新版統計資料能顯示每個技能的成功施放次數與傷害事件次數；飛刀多段／追蹤命中不再冒充施放次數；
既有傷害與技能排程測試不退化。

驗證結果：新增統計測試與 HP_lock／技能輪轉回歸測試通過；本次相關定向集合 200 項中 194 項通過，
其餘 6 項為既有泥沼尺寸／寒冰速度與範圍的參數表漂移，與本次修改無關；`npm run build` 297/297，
`git diff --check` 通過；本機頁面重新載入後確認使用 `combat.js?v=1.0.39`、`skills.js?v=1.0.28`、
`skills2.js?v=1.0.66` 且 Worker 存活、錯誤數 0。完整 `npm test` 於既有高 CPU 的 `sim-evaluator`／
`equip-no-duplicate` 長跑超過 7 分鐘後中止，非測試失敗。

已知風險：舊版 Worker 快照若沒有 `casts` 欄位，統計表會保留舊的單一事件次數顯示；重新整理載入新版後，
新的戰鬥統計會顯示施放次數與命中／傷害事件次數。

未完成項目：無。

完成後交給：使用者／主整合工作區。

## 任務：修正固定關卡刷怪時新版技能只施放一次（2026-08-24）

任務狀態：已完成（2026-08-24）

任務分類：技能排程／就緒佇列

負責 AI：Codex

使用者需求：正常切換關卡時技能看似正常，但停在同一關重複刷怪後，其它新版技能不再施放，
只剩飛刀持續造成傷害。

任務內容：修正新版技能群組進入施法工作時，使用完整裝載鍵（`sg:<技能>`）解除就緒佇列；
補上同一關連續刷怪、技能冷卻歸零後仍能再次輪轉的回歸測試。不改技能數值、冷卻公式或固定關卡規則。

允許修改：

- `js/skills.js`
- `index.html`（快取版號）
- `tests/skill-gcd.test.cjs`
- `docs/AI_TASKS.md`

禁止修改：`js/skills2.js` 技能數值與效果、GM 指令、存檔格式、關卡刷怪規則。

前置依賴：`3d2286c`（技能統計分離施放次數與傷害事件）。目標檔案衝突預檢無來源。

測試要求：技能排程定向測試、GM 回歸測試、`npm run build`、`git diff --check`。

完成條件：同一個 `sg:<技能>` 在首次施放、冷卻歸零、再次施放的循環中都能重新入列；
固定關卡連續刷怪不再因就緒佇列卡死而只剩單一技能。

驗證結果：新增固定關卡連續刷怪回歸測試通過（`alpha → beta → alpha → beta`）；技能／GM／統計定向測試 25/25，
`npm run build` 297/297，`git diff --check` 通過；本機頁面重新載入後使用 `skills.js?v=1.0.29`，
Worker 存活且頁面正常完成載入。

已知風險：既有已卡住的瀏覽器 Worker 仍保留舊的就緒佇列狀態，必須重新整理頁面讓新版 Worker 重建執行期狀態。

未完成項目：無。

完成後交給：使用者／主整合工作區。

## Codex｜大地守護原創六芒星特效預覽（2026-09-10）

- 任務編號：VFX-EARTHGUARD-HEXAGRAM；負責 AI：Codex。
- 狀態：Review，僅特效預覽，等待使用者確認接入。
- 需求：依技能文檔製作白光、半徑 8 米、緩慢旋轉且跟隨角色的地面法陣。使用者授權現繪，不照抄圖庫實心六角星。
- 設計：原創雙三角、雙外環、分岔符文及內圈菱形；每 8 秒轉 60 度，以六向對稱連續循環，地面投影保持固定。
- 允許修改：earthguard-renew.cjs、aura-earthguard-hexagram preset/layout、hexagram-orbit.png、asset-index.json、本任務記錄與暫存預覽。
- 禁止修改：技能數值、遊戲接線、其他現有特效及使用者修改。
- 前置依賴：已讀取最新技能說明、完成圖庫盤點，使用者同意重新繪製。衝突預檢通過。
- 驗證要求：Core／layout 測試、build、動態預覽檢查；接入與 Commit 等使用者確認。
- 後續接手者：Codex 依使用者回饋調整，確認後接入遊戲。
- 驗證結果：Core／layout 136 項測試全過；build 332 檔全過；以實際 Core 播放 preset 渲染 96 幀跟隨移動預覽，檢查地面投影及循環。尚未接入遊戲，未 Commit。
- 2026-09-10 追加：使用者確認白光版本，開始接入 T1；另製作 T3 黃色、T4 藍色、T7 紅藍且放大 25% 的進化預覽。進化接線待預覽確認；T2、T5、T6 沿用前階顏色。允許追加修改 Skills2 Excel/CSV、skills2.js、vfx-catalog、shipped-assets、Worker/主頁快取與相關正式測試。
- 追加驗證：大地守護模擬／顯示 2 項定向測試通過；VFX 203 項中 202 項通過，唯一失敗是開始本任務前使用者將泥沼透明度調成 0.5，但既有測試仍要求 0.3，保留使用者修改。build 332 檔通過；Skills2 重建語意差異 0；Excel 全表比較僅 AC132 新增白光法陣接線。黃／藍 96 幀、紅藍 192 幀實際 Core 預覽完成，紅藍循環使用 120 度色彩對稱避免交界跳色。進化尚未接入，等待確認後一併提交並清除預覽。
- 2026-09-10 發光調整：使用者要求法陣有明顯對應色光；追加地面柔光、外環溢光及六個頂點光暈，以同一旋轉週期做輕微明暗起伏，保持紋樣和六向／三向色彩對稱。四版重新預覽，尚未確認進化接入。
- 發光版驗證：Core／layout 136 項通過，build 332 檔通過；四版使用實際 Core 與更新後圖集渲染動態預覽。未建立 Commit。
- 2026-09-10 最終接入：使用者批准全部接入。T1/T2 白光、T3 黃光、T4/T5/T6 藍光、T7 紅藍光；T7 半徑 10 米，其餘 8 米。常駐法陣穩定跟隨腳底並按階段替換，保留反射與復活光柱；Excel/CSV/JS/catalog、素材清單及快取同步。
- 最終驗證：大地守護定向 4/4；VFX 204 項中 203 通過，唯一既有差異為使用者泥沼 alpha=0.5 與測試 0.3 不符；build 332/332；Skills2 語意差異 0；Excel 僅 AC132、AC134、AC135、AC138 變更。未另作瀏覽器實機驗證。
- 提交包含使用者三種泥沼透明度調整。正式功能完成；預覽清理受工具政策阻擋（blocked by policy），scratch/earthguard-preview 保留未追蹤，不納入提交。未推送。

## Codex｜連鎖閃電藍白折線預覽（2026-09-10）

- 任務編號：VFX-CHAIN-BLUEWHITE；Owner：Codex；狀態：In Progress。
- 使用者要求應用圖庫閃電折線。最新技能文檔 I205：不規則藍白色閃電折線，在敵人間彈射；H205：每次間隔 0.2 秒。
- 素材已目視盤點：主電弧 spark_05_rotated.png，輔助電絲 spark_06_rotated.png。採新 preset，保留正式遊戲接線直到使用者確認。
- 允許修改：author/chainlightning-renew.cjs、bolt-chain-bluewhite preset/layout、本任務記錄及 scratch/chainlightning-preview；禁止修改技能數值與遊戲接線。
- 驗證：實際 VFXRuntime/Core 渲染四目標彈射 GIF、Core/layout 測試、build。衝突預檢乾淨。
- 前置依賴：圖庫素材與最新技能文檔已核對；後續由 Codex 依使用者確認接入。
- 預覽完成（Review）：使用 VFXRuntime 的 attack/chain 連線路徑播放新 preset；四段在第 12/18/24/30 幀起播（30fps，間隔 0.2 秒），白熱折線＋藍色電光，無缺失素材或丟棄效果；播放後全部回收。Core/layout 136/136，build 332/332 通過。
- 接入注意：現有 chainlightning 掛 projectile，會走飛行物流程；本次新版本預覽改用 attack/chain 才能直接連接兩目標，使用者確認後須同步表格/catalog 與事件時序。此輪未改遊戲接線、未 Commit。
- 使用者批准接入（2026-09-10）：允許並完成 Skills2 Excel/CSV/JS/catalog 接線、快取同步與正式測試。T1 改用 attack/chain 藍白連線，進化沿用；既有超神技能独立 projectile 配置保留。
- 起手直接連接目標，後續每段固定 200ms，既有傷害飄字延遲同步；不更動既有立即結算傷害架構。修正次數耗盡後仍多發一段電弧的問題。無新素材匯出需求，所用圖庫素材已在 shipped-assets。
- 驗證：連鎖閃電七階與新接線定向 12/12，傳奇回歸 22/22；VFX 205 項中 204 通過，唯一失敗為既有泥沼 alpha 設定差異。較廣雷系測試另有既有冷卻／雷球尺寸設定差異，未修改其斷言；build 332/332，Skills2 重建語意差異 0。未另作瀏覽器實機驗證。
- 正式接入完成；清理預覽仍受既有工具刪除政策阻擋，chainlightning-preview 與 earthguard-preview 不納入 Commit，保留為未追蹤檔。後續由主整合工作區合併，未推送。
- 使用者回饋：連線缺乏彈射感，改製作 bolt-chain-travel-bluewhite 預覽。保留圖庫折線形狀，電弧前端約 0.18 秒由起點推進到終點，尾部隨後淡出；不一次顯示整段。允許新增 author、圖集、asset-index、preset/layout 與預覽；尚未替換正式接線。
- 快速彈射預覽已輸出：使用實際 Core/Runtime 圖集播放，四段逐次推進，結束後零存活特效；Core/layout 136 項通過。待使用者確認新移動表現；接入時需將命中飄字對齊每段約 0.18 秒抵達時刻。
- 快速彈射版已獲使用者批准並接入（2026-09-10）：Excel/CSV/JS/catalog 改用 bolt-chain-travel-bluewhite；新增圖集加入 shipped-assets，主執行緒及 Worker 快取同步。每跳發射間隔 200ms，飄字在各段起飛後 183ms 顯示，對齊電弧前端抵達；既有立即傷害結算架構保持不變。
- 驗證：連鎖閃電七階／接線 12 項通過，新增圖集測試確認電弧亮度重心向終點推進並回收；VFX 206 項中 205 通過，唯一既有失敗為泥沼透明度設定差異；Skills2 重建語意變更 0；build 332 檔通過。未另作瀏覽器實機驗證。
- 功能完成待主整合工作區合併，未推送。預覽資料夾仍受先前工具刪除政策阻擋，未納入提交；保留正式圖集、製作工具和測試。

## Codex｜連鎖閃電追蹤移動目標（2026-09-10）
- 使用者要求：修正快速移動敵人離開閃電鎖定終點，必須追蹤至命中。
- 允許修改：vfx-runtime、index 快取、runtime 正式回歸測試、本任務記錄；不改技能傷害與排程。
- 實作：快速彈射電弧保存起終點實體 ID，每幀重新取渲染插值座標並更新位置、角度與長度；延遲段仍於真正起飛時取新座標；clear/destroy 清除追蹤引用。衝突預檢通過。
- 追加修正：目前使用者將電弧縮放設為 2 倍，追蹤長度改以圖集實際單格寬與 layer.scale.x 換算；保留粗細，避免超出目標。高塔 profile 只作用於粗細，不能再次放大端點距離。
- 完成驗證：CHAIN 定向 3/3，涵蓋快速移動、反向、延遲起飛與清場；VFX 207 項中 205 通過，另 2 項為使用者岩甲 alpha=0.75、泥沼 alpha=0.5 與既有斷言不同。build 332/332；未另作瀏覽器實機驗證。
- 使用者修改的岩甲透明度、電弧粗細及素材清單排序一併保留並提交。預覽資料夾仍因先前刪除政策拒絕而未清除，不納入 Commit。功能完成，可供主整合工作區合併，未推送。

## Codex｜連鎖閃電消失端點與無目標終止（2026-09-10）
- 使用者回報空位彈射，並明確要求沒有可彈射目標時自動終止。
- 根因：posOf 對離場實體使用 lastPos，過期後退回玩家前方，造成空位電弧。新增僅供電鏈使用的 chainPoint，端點已移除/隱藏時拒絕起飛；飛行中消失則回收，禁止退回 legacy。
- 依最新規則，找不到下一個敵人即停止，不再經 T6 自身中繼重啟；T6 增傷保留。同步 Skills2 Excel/CSV/JS 說明及主執行緒/Worker 快取。
- 修改範圍：battle-renderer、vfx-runtime、skills2、bridge、sim.worker、index、Skills2 表、相關正式測試；衝突預檢乾淨。
- 驗證：連鎖閃電與 CHAIN 定向 15/15，覆蓋消失起點、消失終點、延遲播放、飛行中回收、移動追蹤及無下一敵人停止；config_tables 語意變更 0；build 332/332。未另作實機驗證。正式功能完成，可供合併，未推送。
- 預覽仍受先前工具刪除拒絕而保留為未追蹤，不納入提交。

## Codex｜落雷術特效預覽（2026-09-10）
- Owner：Codex；任務：VFX-THUNDERSTRIKE；狀態：In Progress。
- 最新技能文檔 I217/H217 及 J/K/L217 三張參考圖已讀取：藍白雷柱、少量紫色、由上往下、落地電雷爆炸、每次落雷間隔 0.2 秒。T7 改紫白並放大 50%，本輪先製作 T1。
- 允許修改：thunderstrike-renew author、bolt/hit-thunderstrike-bluewhite preset/layout、本文件及暫存預覽。不改 Excel、技能數值與遊戲接線，確認後才接入。
- 驗證：Core 動態雙目標預覽、Core/layout 測試、Build；所有目標預檢無衝突。後續由 Codex 依使用者回饋接入。
- 預覽完成（Review）：兩個目標錯開 0.2 秒，約 0.17 秒雷柱伸展落地後觸發獨立 hit 爆炸；以實際 Core 渲染 90 幀，無丟棄效果，播放後全部回收。Core/layout 136/136，build 332/332 通過。未接入、未 Commit，等待使用者確認。
- 使用者確認並要求速度提高 30%：雷柱 duration 與支線 delay/duration 除以 1.3，落地時間 129ms，每道仍間隔 200ms。已接入 Excel/CSV/JS/catalog、素材清單與主執行緒/Worker 快取。
- Runtime 新雷柱立即播放並跟隨腳底，落地傷害事件才播放獨立爆炸，取消原本附帶 hit 的提前爆點；目標離場即停止。T1 新外觀由各階沿用，T7 專屬紫白放大版尚未製作，不屬本輪要求。
- 驗證：落雷/THUNDER 定向 10/10；VFX 209 項中 207 通過，其餘為既有岩甲/泥沼透明度設定差異；Build 332/332。Excel 以 XML 節點方式更新，保留樣式與命名空間，驗證全表儲存格順序及唯一性、Zip 完整性、全表值差異僅 Z152/AB152；Skills2 重建語意變更 0。未另作 Excel 桌面或遊戲實機驗證。
- 接入完成，清除本輪預覽，保留正式 author/preset/layout；待主整合工作區合併，未推送。

## Claude｜同步腳本納入 VFX 素材庫（SYNC-ASSET-LIBRARY-20260910）

- 使用者要求：執行 `sync_ai_worktrees.bat` 時，Effects-Materials 資料夾也要一起 fetch／pull／push。
- 架構判斷：素材庫是另一個 Git 儲存庫（單一分支、無 Worktree、不參與 develop 合併），與既有的多 Worktree 整合是兩件事，因此獨立成一段流程，不混進 `$agentBranches`。`.bat` 維持單純啟動器，行為寫在 `tools/sync_ai_worktrees.ps1`。
- 路徑不寫死：專案既有規定「素材庫絕對路徑只存在於本機設定，絕不進入 Git」。改為替 `tools/vfx/vfx-library-root.cjs` 加上 CLI（`node tools/vfx/vfx-library-root.cjs` 印出 Root），PowerShell 呼叫同一支模組，不在腳本裡重寫解析順序；預設 libraryId 取自 `vfx/asset-index.json`，與 export-assets、editor-server 一致。分支與 upstream 一律問 git，不寫死 master／origin。
- 失敗不中斷程式碼同步：素材庫是持續丟新圖的地方，「有未提交變更」是常態。做成致命錯誤等於加一張圖就不能同步程式碼。因此素材庫排在最前面執行（避免程式碼同步中止時它永遠輪不到），失敗只警告，最後才反映到結束碼。
- 行為：解析不到路徑／不是 Git repo／detached HEAD／沒有 upstream → 略過並說明；工作區髒 → 只 fetch，明列擋住的檔案；乾淨 → fetch → pull --rebase → push。新增 `-SkipAssetLibrary` 只同步程式碼。
- 驗證：`-ValidateOnly` 正確解析 `D:\MyGames\Effects-Materials`、`master → origin/master` 且不動作；實際執行在素材庫髒的狀態下只做 fetch 並列出 7 筆未提交變更，程式碼同步照常往下走；`-SkipAssetLibrary` 正確跳過。CLI 四種情境（預設／指定 id／不存在的 id／仍可被 require）皆正確。`.bat` 維持 CRLF、無單獨 LF、純 ASCII 註解（避免 chcp 65001 後非 echo 行被當指令解析）。
- 未推送，未合併。

## Claude｜codex-authored 素材納入語意層（VFX-SEMANTICS-CODEX-20260911）

- 問題：16 個 codex-authored PNG 沒有任何規則涵蓋，語意層沒有它們的紀錄。而 `editor.js` 的 `filterAssets` 是走 `state.semantics.records` 並以 `kind === 'vfx'` 過濾，沒有紀錄＝在 Asset Browser 與 Asset Picker 裡完全不存在。其中 14 個已經被 20 份 preset 使用，等於這些特效只能手改 JSON 維護。
- 判定方式：逐張看圖，不靠檔名猜。用 `tools/vfx/vfx-raster.cjs` 把 16 張（含圖集，依 preset 的 sheet 格線取代表格）縮成縮圖後人工判讀，因此 9 條規則全部列為 `evidence`，16 筆紀錄都是 `high` 信心，沒有一筆是 `family` 猜測。
- 新增規則：`codex/rockarmor-plate`（角面石板／nature）、`codex/mire-earth`／`-venom`／`-magma`（同形地面沼澤，元素分別為 nature／poison／fire）、`codex/earthguard-hexagram`（地面法陣，紅藍雙色仍維持 neutral 以便跨階重用）、`codex/tornado-fire-column`（火柱／fire）、`codex/meteor-molten-rock`（熔岩隕石／fire）、`codex/moon-crescent`（灰階月牙，依不變式必須 neutral）、`codex/chain-lightning-bolt`（藍白閃電折線／lightning，語意比照既有 `scifi/sheet-lightning`）。
- 連帶修正索引：專案有一條不變式「帶具體元素者必須有事實證明是預先上色，且需 `needsReview`」。這 16 個素材當初進索引時只有 `dimensions`／`hasAlpha`，`tintableFromFacts` 回 `null` 而非 `false`，因此重跑 `asset-scanner.cjs` 補齊事實（原本 60 筆事實不完整），並替 7 條非 neutral 規則加上 `needsReview`。補齊後的事實反過來印證判讀：兩張月牙確實 `tintable=true`（故必須 neutral），meteor 兩張確實是 `additive`（不透明黑底）。
- 索引重掃另有 42 筆 SVG 的 contentHash 變動，差值剛好等於 CR 位元組數——素材庫 repo 沒有 `.gitattributes`，SVG 被簽出成 CRLF，舊索引是 LF 時建的。已確認這 42 筆都沒有被任何 preset 引用，真正被引用的 3 個 SVG 在索引／素材庫／已發布三處雜湊一致，`export-assets --check` 仍為「已是最新」。
- 驗證：語意紀錄 2406/2422 未分類 16 → **2422/2422 未分類 0**；語意檔為純新增（新增 16 筆、既有 0 筆被改動、0 筆移除）；規則檔沿用原本 1 空格縮排，diff 為 251 行純新增。`asset-scanner --check`、`semantic-build --check`、`export-assets --check` 三道守門皆「已是最新」。VFX 全測試中僅餘合併帶進來的 5 個 Codex 既有失敗，數量與動手前完全相同。以實際編輯器開啟 Asset Picker 搜尋 `stone-guard`，5 筆全部出現並顯示縮圖。
- 未解決：`hit-basic-irregular` 與 `slash-gale-moon` 引用的 3 個 SVG 仍選不到——它們被既有的 `any/vector-source` 標為 `nonVfx`（理由是「runtime 不能直接使用」），但 preset 事實上正在用。該規則的前提與現況矛盾，影響 49 筆素材，未擅自改動，交由使用者決定。
- 未推送，未合併。

## Claude｜AI_TASKS.md 自動合併（MERGE-DRIVER-20260911）

- 使用者要求：AI_TASKS.md 太容易衝突，改成「只要修改的不是同一區就自動合併」。
- 架構判斷：修在 git 而不是同步腳本。`.gitattributes` 掛上自訂 merge driver 之後，`sync_ai_worktrees`、手動 `git merge`、`rebase`、`cherry-pick` 全都適用；塞進同步腳本的話只有跑那支 .bat 時才有效。
- 規則：以 `## ` 標題切區段做三方合併。只有一邊新增／只有一邊修改／兩邊改成一樣 → 自動合併；同一區兩邊改成不一樣、一邊刪除另一邊修改、標題重複、沒有任何區段 → 一律退回 `git merge-file` 標記衝突交給人。自動化的預設值是「不確定就交給人」。
- 安全底線：輸出前重新解析自己的產物，逐區比對內容是否與決策結果逐字元相同，對不上就當失敗不輸出。這支程式最危險的失敗不是合不起來，而是合起來了但少一段而沒人發現。另外把區段 key 的尾端 CR 正規化——兩側行尾不同時若拿整行當 key，同一區會被當成兩邊各自新增而重複出現，且沒有任何衝突標記提醒。
- 註冊：`.gitattributes` 只指定用哪個驅動程式，實際指令必須在本機 git config（git 刻意不從 repo 讀取要執行的命令）。`sync_ai_worktrees.ps1` 每次執行都會補上 `Register-AiTasksMergeDriver`，寫入 `--local` 讓所有 worktree 共用。未註冊時 git 退回預設行層級合併，不會壞掉。
- 驗證：8 項測試全通過，全部走真正的 `git merge` 而非直接呼叫驅動程式，以涵蓋 `.gitattributes`、driver 註冊與參數傳遞。涵蓋兩邊各自新增、單邊修改、同區雙改衝突、刪除 vs 修改、標題重複退回、行尾混用不重複、以及實際 AI_TASKS.md 可解析且標題唯一。行尾那條做過突變測試：拿掉 CR 正規化後該測試確實會紅。
- 真實回放：以本日實際衝突的三個版本（base 69120060、ours 673370fe、theirs 84ecfad5）直接餵給驅動程式，結束碼 0，自動產生 266 個區段，與人工解出的結果區段全同、零行遺失，僅新區段排序不同。也就是那次衝突本來不需要人介入。
- 已於本機註冊並確認三個 worktree 都讀得到。未推送。

## Claude｜同步腳本誤判素材庫失敗（SYNC-SOFTGIT-20260911）

- 症狀：程式碼同步全部成功，但每次都在最後回報「VFX 素材庫同步失敗」，而素材庫其實是乾淨且已同步的。
- 根因：`Invoke-GitSoft` 內 `& git ...` 的 stdout 落在管線上，PowerShell 會把函式內所有落在管線上的東西一起當成回傳值，於是回傳的是「git 的輸出行 ＋ 結束碼」的陣列。呼叫端 `if ((Invoke-GitSoft ...) -ne 0)`，而陣列 `-ne 0` 在 PowerShell 是「篩出不等於 0 的元素」，非空即為真——成功被判成失敗。`fetch` 沒事只是因為它把訊息寫在 stderr；素材庫已是最新時 `pull --rebase` 把「Already up to date.」印在 stdout 才觸發。
- 影響不只誤報：判失敗後會直接 return，**連帶跳過後面的 push**，真的有東西要推時推不出去。
- 修法：`& git ... | Out-Host`，輸出照樣顯示但不落在回傳值上。新增 `tests/sync-ai-worktrees.test.cjs` 釘住這條寫法，並做過突變測試（拿掉 Out-Host 該測試確實會紅）。同檔另釘三條：`Get-GitTextSoft` 必須用 finally 還原 ErrorActionPreference、素材庫同步排在程式碼之前且不得 throw、素材庫路徑與分支不得寫死。
- 驗證：修正後實際執行，素材庫回報「[完成] 素材庫 master 目前指向 2d4ef8c」；4 項測試通過。

## Claude｜Preset 搜尋框記住關鍵字（VFX-COMBO-RECALL-20260911）

- 使用者要求：輸入關鍵字搜尋後，再次點開菜單時要帶回剛才的關鍵字，且文字為全選狀態。
- 既有設計的前提：這個輸入框關閉時顯示「目前開著哪一份」，打開時才是搜尋框；「目前是哪一份」的真相是 `state.sourcePresetId`，不是輸入框文字。本次修改沿用這個前提，失焦與 Esc 仍把顯示文字放回去。
- 踩過的坑（程式碼裡原本就寫著）：前一版試過「focus 時全選、等它被覆蓋」而失敗，因為點進來的那一下 mouseup 會取消掉 focus 時做的選取，變成在既有文字中間插字。當時的結論是「不要全選」，但真正的原因是少擋一個事件。本次加上 mousedown 攔截（未聚焦時 preventDefault 並自行 focus），選取就留得住；已聚焦時不攔，第二次點擊仍可放游標，與網址列同一種手感。
- 存哪裡：`sessionStorage`（key `vfx-editor.presetSearch`）。選一份 preset 會整頁重載，只記在記憶體的話，「搜尋 → 開一個來看 → 回去看下一個」這個最常見的用法剛好享受不到。刻意不用 localStorage——那是長期偏好（格線、背景色）的位置，而「剛才在找什麼」是當下的工作方式，與 zoom／平移同一類，隔天還躺著昨天的關鍵字只會讓人以為清單壞了。storage 被關掉時退成空字串，不影響下拉運作。
- 一併修掉開啟路徑分歧：還原關鍵字→全選→依關鍵字開清單抽成 `openComboWithLastQuery()`，focus 與箭頭鈕共用。箭頭鈕原本補一次 `openCombo('')` 會把剛篩好的清單換成未篩選的全部；另外已聚焦時 `focus()` 不會再觸發事件，必須自行呼叫，否則「按箭頭收起、再按一次」會收得起來卻打不開。
- 驗證：以真實滑鼠事件在實際編輯器操作——打 bolt 後失焦再點回，內容還原為 bolt 且選取範圍 0-4，接著打字整段被取代成 hit（證明 mouseup 問題已解）；第二次點擊選取為 3-3（游標插入點，未再全選）；`?preset=` 整頁重載後點開仍是 hit、全選、清單已篩到 26 筆；箭頭鈕收起再打開正常；Esc 與失焦仍把「目前開著哪一份」放回輸入框。新增 VIEW-26／27／28 三條測試並做過突變測試（拿掉 mousedown 攔截、改用 localStorage 皆會紅）。編輯器五個測試檔共 236 項通過。

## Claude｜Inspector 欄位按 Enter 後無法復原（VFX-UNDO-ENTER-20260911）

- 使用者回報：部分參數（startScale、rotationStart、rotationSpeed）改完之後按 Ctrl+Z 回不到上一步。
- 根因：`wireFieldTransaction` 的交易收尾點寫在 keydown 的 Enter。Inspector 有兩種寫回 preset 的時機——數字／向量／角度用 `oninput`，打字時就寫回去；json、角度區間、assetId 用 `onchange`，要等到 change 才寫。瀏覽器的順序是 keydown 先、change 後，所以對後者而言 commit 早了一步：commit 當下 preset 還沒變，history 判定「前後沒有差別」而把整筆交易丟掉，緊接著 change 才把值寫進去，那次修改完全不在歷史裡。使用者看到的三個欄位剛好全是 onchange 型。
- 實際傷害比「Ctrl+Z 沒反應」更嚴重：那一步不在歷史裡，之後的 undo 會跳過它直接回到更早的狀態，值永遠回不去。實測：Enter 改 startScale 後 dirty 亮著但 undo 是「沒有可復原的動作」；接著改另一個欄位再按 Ctrl+Z，rotationStart 正確回復而 startScale 停在新值且 undo 已用完。
- 修法：收尾點改到 `change`——那才是「值真的寫回 preset」的那一刻，對兩種欄位都成立。Enter 的語意不變，因為瀏覽器會在 Enter 時派送 change。另外 change 收尾後若仍在焦點內就接著開下一筆交易，否則 Enter 之後繼續改會沒有交易可歸屬。
- 驗證：在實際編輯器以完整事件序列（focus → 打字 → keydown(Enter) → change）重現與驗證。修正前：值變了、dirty 亮起、undo 為「沒有可復原的動作」。修正後：undo 顯示「修改 startScale」，按下去值回到 `[0.0469,0.0742]`。新增 HISTORY-40 並做過突變測試。編輯器六個測試檔 286 項通過。
- 測試環境備註：瀏覽器窗格沒有 OS 焦點時，程式化 `.focus()` 只會改 activeElement 而不派送 focus 事件；自動化工具送的 `Return` 在頁面上是 `key=""`，要用 `Enter` 才是真的 Enter。這兩點都曾讓測試結果失真，記著以免下次再踩。

## Claude｜同步腳本不該 rebase 整合分支（SYNC-FFONLY-20260911）

- 症狀：`sync_ai_worktrees` 在 develop 上卡住，`js/bridge.js` 衝突，工作區停在 detached HEAD、rebase 進行到 7 步中的第 2 步。
- 根因：`SyncRemoteFirst` 那段對每個分支都跑 `pull --rebase`，包含 develop。develop 是整合分支，而三個 AI 分支在流程最後又被 fast-forward 回 develop，所以每一個分支都含有 merge commit。rebase 不帶 `--rebase-merges` 會把它們壓平，於是得把各 AI 分支的原始 commit 一筆筆重放到新基底——衝突就是這樣憑空冒出來的，而且改寫的是已經整合好的歷史。
- 實測當時 develop 領先遠端 9 筆、落後 0 筆，根本沒有分歧，純領先的分支只要 push；`pull --rebase` 仍然開始重放 7 筆並在第 2 筆卡住。先 `rebase --abort` 還原（9 筆一筆未掉），再修腳本。
- 修法：對齊步驟改用 `merge --ff-only "$Remote/$branch"`。三種情況都合理——遠端是祖先就 Already up to date、本地沒新東西就 fast-forward、真的分歧就停下來報錯交給人看。第三種正是該讓人知道的事；靜靜地改寫共用歷史比停下來糟得多。
- 這也解釋了先前 ai/claude 那次 rebase 為何會讓 AI_TASKS.md 出現重複區段：同樣是 merge 被壓平後重放造成的。
- 驗證：新增測試釘住「對齊用 ff-only、不得用 pull --rebase、fetch 要排在前面」並做過突變測試；`-ValidateOnly` 仍可正常執行。sync-ai-worktrees 5 項通過。

## Claude｜Skills2 我方／敵方狀態表格化與狀態畫面歸狀態表（STATUS-TABLE-20260918）

- 需求：施放技能時要能同時對我方與敵方施加狀態，且附加哪個狀態要由表格決定，不寫死在程式；中了狀態之後的畫面（上身、身上的持續特效、每跳）歸 Status 表，不填在 Skills2。
- Skills2 新增「我方狀態」「敵方狀態」兩欄（位於特殊效果與效果參數(JSON)之間）。格子語法：`狀態ID` 或 `狀態ID(參數=值, …)`，多個以 `;` 分隔；參數 val／dmg／dur／gap／max／chance／stacks，值可填數字或本列效果參數的鍵名（隨等級成長）。沒填的吃技能公式或狀態表。
- 技能原有的 50 個施加點登記在 `js/skills2.js` 的 `SKILL2_STATUS_SLOTS`（鍵＝群組.階或超神ID.方向，值＝各格的角色與型別限制）。施加點仍由技能決定觸發時機與數值公式，表格決定施加哪個狀態；後續各階與傳奇「對帶著某狀態的敵人」的判斷一律以角色查詢（`sgRoleSids`），換掉格子裡的狀態後續各階跟著換。超出登記格數的條目是通用附加：我方＝施放時（被動＝觸發），敵方＝本技能每次命中（`sgHitOne`；反擊另外接）。
- 狀態自己的效果（泥沼緩速的攻速／移速、寒冰逆轉的屬性改寫、寒霜的緩速）仍以效果鍵讀取，跟著狀態走；傳奇特效施加的狀態由裝備決定，不在 Skills2 上。
- 使用者原則（2026-09-18）：除了飛行子彈，有持續時間的效果都是狀態。火狩／環體電球／虛空斬／暴風化身／地爆天星／倒地無敵等計時狀態因此也在表上；火龍捲、雷球、泥沼這類在場上自己存在的場域物件維持原樣（使用者同意）。以玩家為中心的永久領域改成狀態是下一階段。
- 參數表：`tools/config_tables.cjs` 解析、驗證（狀態存在、參數名、鍵名存在、登記格型別、登記格不得用 dmg 覆寫）與往返；缺這兩欄的舊表整批拒絕。說明頁自動列出每個登記位置。
- Excel：`--gen` 仍是手寫 XML，違反 AI_RULES 8.5，因此新增 `tools/excel-update-sheets.ps1`（Excel COM：插入整欄、只寫與目標不同的格子、正常模式重開逐格驗證兩次、來源 hash 改變就停止）。Skills2.xlsx 與 Status.xlsx 都用它寫入；`--sync` 後 `--apply` 語意變更 0。
- 狀態畫面：Status 表的施加特效正式接上（`applyStatus` 在「施加前不在、施加後在」時收集，`statusTickVfxFlush` 一併送出）；每跳特效只由 `tickStatuses` 依狀態表送出，skills2 的燃燒／寒霜／流血毒節拍器不再自己畫（以前會退回技能列的受擊特效，換階畫面就跟著變）。狀態光環改用 Preset 世界尺寸、畫在地板層。
- 從 Skills2 搬到 Status 的畫面：火球 T2 st-tick-fire → sgBurn 作用；寒冰箭 T2 st-tick-ice → sgFrostBite 作用；血刃斬 T4 curse-poison → sgPoison 施加（另補 sgPoison 作用＝hit-poison）；狂怒 T1 與阿修羅 aura-bloodrage → sgBloodrage／sgAsuraFist 持續；雙刀 T7 ground-cyclone-avatar → sgStorm 與傳奇【不屈之誓】sgDeathDefer 持續；暴風屏障 T1 ground-storm-barrier／T7 ground-storm-god → sgStormBarrier／sgStormGod 持續。
- 刻意留在 Skills2 的：岩甲光殼（第 7 階會換外觀，狀態表無法表達「練到第幾階換樣子」）、雷幻身、不屈鬥魂倒地光殼（掛在共用的 invuln 上會讓所有無敵都長這樣）、各技能的場域與領域脈衝。
- 驗證：受影響測試 1603 項，失敗 25 項皆在 HEAD 基線內（以 git archive 抽出的乾淨副本對照）；新增 13 項（tests/skill2-status-slots.test.cjs、vfx-runtime STATUS-3）。實機確認狀態光環隨狀態出現／消失、console 無錯誤。可見差異：狂怒／暴風化身／暴風屏障／暴風神體的光殼由約 200px 改為 Preset 製作尺寸。Commit：1191100f、57708e93。

## Claude｜以玩家為中心的領域改成玩家身上的狀態（DOMAIN-STATUS-20260918）

- 需求：延續 STATUS-TABLE-20260918 的使用者原則（除了飛行子彈，有持續時間的效果都是狀態；永久領域＝持續時間永久的狀態）。把以玩家為中心的領域改成玩家身上的狀態，畫面由 Status 表的持續特效負責，依領域半徑縮放、跟著玩家。
- 範圍：血刃斬【殺神領域】【萬毒血霧】、火狩【火神降臨】、岩甲術【超重岩之術】【超重力場】、水流彈【水牢天瀑】【海淵葬界】共 7 個超神。Status 表新增 sgSlayerDomain／sgVenomDomain／sgFireGodBody／sgPetrifyDomain／sgGravityDomain／sgWaterPrisonDomain／sgAbyssDomain（buff／stat，效果鍵＝ID，本身不改任何數值）；Skills2 對應超神列的「我方狀態」填上這些狀態，原本畫領域範圍的地板／觸發地板特效清空（Preset 搬到狀態的持續特效）。
- 施加：`SKILL2_STATUS_SLOTS` 登記 7 個格子（角色 slayerDomain 等），技能端以 `sgSyncDomainStatus`／`sgEndDomainStatus` 跟著領域的權威（超神進化＋裝配、水牢與岩甲護盾的存續）掛上與撤掉；只撤自己掛上的那一份（`SKILL2_RT.domains`），格子換成通用增益時不會誤刪其他來源。永久領域的持續時間填 99999（UI 超過 3600 秒顯示 ∞）；水牢與岩甲領域的持續時間跟著水牢／護盾實際剩餘秒數。
- 顯示：狀態實例帶 `vfxR`（世界像素半徑，`applyStatus` 的 ctx.vfxR）→ `statusEntries` → 兩個顯示層的 `syncStatuses` 帶 `radii` → 光環比照地板事件以 `sizeOf(preset,{r, w:2r, h:2r})` 撐滿判定圓的外框（ground-mire 這類 200×100 的長方形素材只給半徑會只畫出一半高度）、每幀釘在實體腳下、半徑改變時以 τ=0.15 秒補間。水牢在玩家倒地時整段往後推，狀態的到期時刻也跟著推。技能不再每秒送 follow-aura 地板事件；`fireGodVfxAt`、`abyssVfxAt`、水牢／岩甲的 `vfxAt`、`sgEmitBloodDomainAura`、`sgRockFieldAura` 移除。
- 萬毒血霧在 Codex 觸發特效表（tools/skills2-vfx.cjs）保留 attack／hit 兩個觸發角色（毒霧脈衝與受擊），領域本身的畫面改由狀態負責；殺神領域的觸發地板特效角色移除。
- 合併檢查（Codex 觸發特效細分 × 施放時狀態）：兩邊的欄位與讀取路徑不衝突；修了 Codex 的逐風者測試夾具（`cleave-rework.test.cjs` 仍把觸發地板特效放在 def.vfx）；補登記 `hit-thunderstrike-bluewhite` 到 VFX_PRESET_USAGE_OUTSIDE_TABLES（USAGE-3）。
- 刻意沒動：岩甲光殼、雷幻身、不屈鬥魂倒地光殼、大地守護常駐法陣（都會隨階數換外觀）；暴風雪、冰之淚、火龍捲、雷球等場域物件。
- 可見差異：7 個領域的範圍圈改成狀態光環（依半徑縮放、半徑變化時平滑過渡，不再每秒重畫一次）；legacy 渲染模式沒有狀態光環，這 7 個領域在 legacy 下不再畫範圍圈；狀態列會多出這些領域的圖示。
- 後續清理：渲染器裡 follow-aura、bleed-tick、storm-barrier 等舊畫法分支已無發送端，屬於 dead code，另開任務移除。
- 驗證：受影響測試 686 項，失敗 20 項皆在 HEAD 基線內（git archive 抽出的乾淨副本對照，同一組檔案）；新增 DOMAIN-1..3（tests/skill2-status-slots.test.cjs，含倒地時水牢到期時刻，已做突變確認會紅）、BLOOD-DOMAIN-RECT（tests/vfx-runtime.test.cjs）。實機（GM 擺情境）：殺神領域／萬毒血霧／火神降臨掛上且帶半徑（240／240／60px）、換超神只剩一個、卸下就消失；水牢天瀑施放時掛上（200px）約 6 秒倒數後撤掉；光環外框約 545×567（直徑 480 的判定圓加素材外光）；console 無錯誤。

## Claude｜VFX Editor 旋轉曲線取消 ±360° 上下限（CURVE-ROT-UNBOUNDED-20260918）

- 需求：使用者回報 Rotation 曲線有點「超出上下限」卻拖不回來，且旋轉被限制在一圈內。原因是 2026-09-02 我把旋轉曲線釘成固定 ±360° 的軸並夾限拖曳；但既有 preset 有 109 條多圈旋轉（刀環 468°、黑洞 1440°、虛空盤 1080°…），界外的點畫在畫布外面，抓不到也就拖不回來。
- 當初固定的理由是「軸隨資料放大時，拖到頂軸就長高，值會一路暴衝」。改成在 `curve-editor.js` 拖曳期間凍結 Y 軸（`frozenRange`）：拖出框外照按下時的比例線性換算，放開後軸重新框住全部的點，可以再拖一次繼續往外。這也順帶修掉透明度／縮放／位移三種會自動放大的軸原本的同一個暴衝問題。
- 旋轉 policy：不設 min／max，Y 軸至少顯示 ±360°、資料超出就放大。刻度改在顯示單位裡挑（`curve-model.js` 的 `tickStep`／`tickValues`，旋轉用 15／30／45／90／180／360 度），不再出現 114.6°、229.2°、343.8° 這種以弧度取整的刻度。移除只剩旋轉在用的 `fixedRange` 與界外提示（`outOfRangeCount`）。拖出框外的點在框邊畫箭頭，曲線裁在框內。
- 驗證：tests/vfx-curve-editor.test.cjs 的 DEG-1..3 改寫，新增 DEG-4a／4b（用最小的假 DOM 實際驅動拖曳；4b 已做突變確認：拿掉凍結會出現 1662°→5323°→15608°→44504° 的暴衝）。編輯器相關 4 支測試檔的失敗項（CAP-2、HISTORY-42、WIRE-5）與 HEAD 基線相同。實機（VFX Editor 載入 proj-cleave-ring-blue）：刻度 -360°～540°、468° 的點在框內；拖到畫布上方時數值固定不暴衝，放開後軸變成 0°～2880°、點回到框內；未存檔。

## Claude｜VFX Editor 群組名稱雙擊改名失效（GROUP-RENAME-DBLCLICK-20260918）

- 需求：群組名稱提示「雙擊重新命名」，實際雙擊沒有反應。
- 原因（實機記錄事件確認）：整列的 mousedown 會處理選取並重畫整個圖層列表，第一下按住的名稱元素在放開前就被換掉，瀏覽器湊不出「兩下點在同一個元素上」——雙擊只收到 mousedown／mouseup，連 click 都沒有，dblclick 永遠不會發生；第二下還會被整列當成「再點一次＝取消選取」，所以雙擊的結果是群組被取消選取。
- 修正：`groupRow` 的名稱改在 mousedown 以 `e.detail >= 2`（作業系統算的連點次數，不受 DOM 重建影響）接手，擋掉冒泡與預設焦點轉移；新增 `renameGroupRow` 先選到群組、再對重畫後的名稱元素開輸入框。
- 驗證：新增 ROW-5b（結構守門）。實機真實雙擊：輸入框出現且取得焦點、原名全選；Enter 寫入 layout、Escape 取消；群組已選取時雙擊一樣可改；單擊行為不變；Ctrl+Z 可還原改名。未存檔。

## Claude｜主角換成 8 方向騎士序列幀＋技能施法動作（KNIGHT-SPRITE-20260922）

- 需求：用「2D HD Character Knight」包（D:\MyGame\2D HD Character Knight，29 個動作、每張 15 幀 × 8 方向、128×128）替換主角動作：站立、跑步、攻擊 1、攻擊 2、特殊攻擊 1、死亡；特殊攻擊 1 當作技能施法動作（原本技能沒有施法動作）。挑選後必要的收進 effects-materials。
- 方向對應：列＝方向，正右方順時針每 45°。兩種攻擊的刀光方向逐列量測（平均 −12°、23°、84°、156°、187°、208°、252°、317°）與跑步著地腳滑動方向交叉確認；站立點 (64, 98)。依據寫在素材庫 characters/knight-hd/README.md。
- A（592bde4e；素材庫 266c537）：
  - 素材庫收 6 張原圖（雜湊與來源一致）、README、PROVENANCE（無授權檔，標待確認）。
  - tools/build_character_sprites.cjs：原圖 → images/sprites/knight/。每個動作裁到所有方向與幀的聯集，Pixi trim 還原成 128 邏輯格（共用一個 anchor）；影子＝純黑且 alpha < 240（本體一律 255，逐像素量過），輪廓先算好只框 alpha ≥ 250 的本體（刀光拖影不框）；--check 比對與素材庫同步。
  - battle-renderer：loadDirectionalSheet；移動面向移動方向（10° 遲滯）、出手精準面向目標（腳底對腳底）、出手動作播完前不因移動轉走、換方向接著播同一幀；不翻面；影子在圖裡不另畫橢圓；普攻兩段輪流、不插隊施法；死亡播 die 停格不轉 90 度，復活倒放當起身；跑步播放速度跟實際移速（300 px/s ↔ 30 fps，實測著地腳每幀滑 7 px × 1.4 倍）。
  - 節奏：普攻 first 3／4（出劍第 6～7／7～8 幀），因為傷害數字在事件到達那一刻出現。
- B（5dea3230；測試字面斷言跟上在 e469ed11）：
  - 根因：技能特效大多交給 Preset，onVfx 在 Preset 接手後就 return，走不到角色動作；而從 vfx 事件猜「哪一則是施放」不可靠（一次施放送好幾則）。
  - 協議 v36：新增事件種類 act＝{ act:'cast', elId, target, lockMs }。js/skills.js beginSkillCast（施放硬直起點，新版／舊版／潛能共用；自動連發不經過這裡）經 shim.js emitPlayerAct 送出，走 visual 低延遲；ui.js 轉給 BattleRenderer.onAct。
  - 渲染器：延後 POS_BUFFER_MS、面向目標、播 cast；把 first→release（2→8）這段調成剛好在硬直內播完（預設 0.2 秒＝30 fps，夾在 12～60 fps），釋放幀對到特效出現的那一刻。onVfx 只有普攻帶動角色動作。
  - 快取：battle-renderer 1.6.131、skills.js 1.0.39、ui.js 1.0.75、protocol.js ?v=37、bridge.js 1.0.137、WORKER_ASSET_VERSION 20260922-cast-act、sim.worker 的 protocol／shim／skills token。
- 驗證：新增 player-directional-sprite（8 項，含與素材庫同步、影子上沒有輪廓）、player-cast-act（7 項，含突變：拿掉「只有普攻」條件 CAST-7 會紅）；basic-melee、hit-react-throttle、player-outline、worker-protocol 依新行為改寫。實機（claude 副本 8331，手動推幀＋抽圖）：8 方向與攻擊姿勢、血條位置、死亡停格與起身、施法 act 帶 lockMs 200 且以 30 fps 播放；console 無錯誤。全測試與 HEAD 比對見提交說明。
- C（本紀錄所在提交）：使用者確認 Clarice 的舊圖不要了。
  - 刪除 images/sprites/player.png／player.json（換騎士後已無人載入）。
  - tools/gen_placeholder_sprites.py 拿掉產生玩家佔位圖那段（重跑會把 player.png 生回來），只剩 BOSS；重跑後 boss_generic 逐像素與 JSON 皆與提交版相同。
  - 刪除 scratch/_outline_verify.html：那頁只抓 player.json 驗執行期現算的輪廓，檔案沒了就開不起來。
  - 未動：tools/pack_character_sheet.py（通用的 Aseprite 打包工具，說明裡以 Clarice 為例，留著給之後的角色或 BOSS 用）。
  - 待辦：battle-renderer 的 buildOutlineFrames（執行期現算輪廓）與 PLAYER_OUTLINE.radiusPx 自換騎士起已無人呼叫（騎士的輪廓是工具先算好的）；battle-renderer.js 第 100、788、6613 行與 tests/player-outline.test.cjs 開頭的註解仍提到 Clarice／player.json／_outline_verify。這兩支檔案在這次提交時正被同一副本的另一段工作修改中（未提交），所以沒有動。
- 風險／待確認：素材包授權未知；高塔仍走 DOM，沒有角色動作（設計如此）。

## Claude｜VFX Editor 重新命名：直接輸入新名字、可以取代既有特效（PRESET-RENAME-INLINE-20260921）

- 需求：使用者把 `proj-cleave-ring-tricolor-09` 改名成 `proj-cleave-ring-tricolor` 之後 `-09` 還在；問名字開的是 Windows 存檔視窗，看起來就是另存新檔。要求改名直接輸入新名字。
- 原因：`proj-cleave-ring-tricolor` 已經存在，而改名規則是「不蓋掉別的特效」——伺服器跳訊息框並重開存檔視窗，實際上什麼都沒改（codex 副本的檔案時間可證：tricolor 仍是 9/16 的原檔）。
- 編輯器：新增頁面上的改名視窗（`askRenameName`，`#rename-dialog`）：預填目前名字並全選、Enter 確定（明確接手，組字中不送出）、Esc／點外面取消；`renameTargetCheck` 邊打字邊說明（空白、與目前相同、名字規則、撞名）。撞名時說明會蓋掉誰與它的用途、確定鈕換成紅色「取代」，按下去才帶 `overwrite`；要取代的那份開在別的視窗就不給按，送出前再查一次。視窗開著時全域快捷鍵不作用（Ctrl+Z 會回滾整份、Ctrl+S 的存檔請求用舊名字）；改名進行中 `savePreset` 不送（落地比改名晚會把舊檔寫回來，原本就有的風險）。
- 伺服器：`/__rename-preset` 收 `overwrite`（必須正好是 true）。撞名沒帶就 409＋`exists: true`；帶了就取代：寫新名字途中失敗時把被取代那份的原始 bytes 寫回（`restore-old-target`），`<to>` 原本的分組檔同殘留分組檔處理；成功回 `replaced`。
- 死碼：存檔視窗的 rename 模式（`RENAME_TITLE`、`purpose`）整個拿掉，`/__save-as-dialog` 只給另存新檔。
- 驗證：vfx-editor-rename 19 項（新增 RENAME-17 取代、RENAME-18 取代途中失敗還原——拿掉還原會紅、RENAME-19 名字檢查；RENAME-5／12 改寫）、SAVEAS-6／7 改寫、S2 呼叫數 4→5。編輯器相關 18 支測試與 HEAD 比對無新增失敗。實機（HEAD 抽出的沙箱＋本次修改，埠 28366，不動 repo 的特效）：改成既有名字→黃色說明＋「取代」→ Enter 後舊名字兩個檔都消失、新名字換成來源內容與分組、黃色橫幅「已經被這份取代」；Esc 取消不改；大寫轉小寫；視窗開著時 Delete／Ctrl+Z／Ctrl+S 不動特效；console 無錯誤。
- 文件：VFX_CORE_AND_PRESET_SCHEMA 改名契約、ANTIGRAVITY_VFX_EDITOR_RENAME_TEST_CASES 依新流程改寫（新增 AG-VFXRN-009 取代）。

## Claude｜VFX Editor 特效重新命名：照使用者的三條規則改（PRESET-RENAME-RULES-20260918）

- 需求：特效要能直接改名。第一版（81ef55e2，另一個工作階段）採「有人用的不改、未存檔先問並存檔、改完重新開啟清空復原紀錄、途中任何失敗就還原」。使用者隨後定了三條規則，由我接手改（另一個工作階段已停）：
  1. 想改就改：配置表或程式用到舊名字的，改完那些地方會失去特效，使用者自己調整——不擋，改完用黃色提醒橫幅列出用到的地方（與下拉用途標註同一份來源 usageLabels）。
  2. 檔案被遊戲或其他程式鎖住也照改：新名字的檔寫好之後，舊檔刪不掉（EBUSY／EPERM／EACCES）就延後刪除，伺服器每 2 秒重試、佔用解除（例如重啟遊戲）後刪掉；只刪內容還是改名當下那一份的檔（sha 比對）；清單不列等待刪除的名字；改回那個名字也可以。
  3. 復原不包含改名：改名只換名字，不先存檔、不重新開啟；已存檔基準線換成伺服器寫出去的內容，沒存的修改仍然沒存；`history.js` 新增 `rewrite`，復原紀錄每一步都換成新名字，Ctrl+Z 能復原改名前的編輯但名字不會退回。
- 伺服器（`renamePresetFiles`）：寫新特效 → 寫新分組失敗才倒回；刪舊檔這一段不還原（其他原因刪不掉的列進 warnings 請使用者手動刪）。新名字只剩殘留分組檔時換掉它（有分組就覆寫、沒有就刪），不再擋下。移除 dryRun 與 `renameBlockers`（沒有呼叫端了）。唯一拒絕：新名字已經有另一份特效。
- 編輯器：`adoptRename` 就地換名字（根群組、選取與收合的 key、localStorage 收合狀態、預覽註冊、清單、網址）；新增 `showSaveNotice`（黃色橫幅），錯誤橫幅會清掉提醒樣式。
- 驗證：vfx-editor-rename 16 項（新增 RENAME-14 佔用延後刪除、RENAME-15 sha 保護與改回舊名、RENAME-16 history.rewrite；RENAME-15 已做突變確認會紅）；編輯器相關 473 項，4 項失敗（16b、CAP-2、HISTORY-42、WIRE-5）皆為既有基線。實機（claude 副本 28362，測試特效用完已刪）：改 alpha → 改名後仍未存檔、Ctrl+Z 退回 alpha 但名字不變、Ctrl+Y＋Ctrl+S 寫到新名字；PowerShell 鎖住舊檔時改名成功、黃色提醒列出舊檔、清單已不見舊名字，鎖解除後約 2 秒自動刪除；console 無錯誤。Windows 上被開著的檔案 unlink 回 EBUSY（實測）。
- 文件：VFX_CORE_AND_PRESET_SCHEMA 改名契約、ANTIGRAVITY_VFX_EDITOR_RENAME_TEST_CASES 依新規則改寫（新增 AG-VFXRN-008 佔用）。

## Claude｜VFX Editor 另存新檔：清單選到目前這份、可以覆寫既有特效（SAVEAS-SELECT-OVERWRITE-20260918）

- 需求：按另存新檔時，Windows 視窗的檔案清單要直接選到目前這份特效（兩百多份，找起來麻煩）；另存新檔時使用者常常直接蓋掉舊檔，要能覆寫。
- 清單選取：WinForms 的 SaveFileDialog 做不到，改用同一個 Windows 存檔視窗的原生介面 IFileDialog（`tools/vfx/native-save-dialog.cs`，開視窗時 Add-Type 編譯；放不進 -EncodedCommand，命令列有長度上限）。視窗打開後以 IShellBrowser → IShellView.SelectItem 選取並捲到可見，清單是非同步填入，用計時器重試；編不起來或開不起來就退回 SaveFileDialog。選取時 Windows 會把該檔名放進檔名框；開視窗後寫回檔名框在 Windows 11 做不到（SetFileName 只在開啟前有效、檔名欄位不是傳統控制項），只做焦點不選取則清單不反白——採用反白選取，檔名框＝目前名稱。
- 覆寫：另存新檔開 FOS_OVERWRITEPROMPT（Windows 問「要取代嗎？」），伺服器回 `{ id, overwrite: true }`；重新命名照舊不覆寫。Editor：選到目前這份＝一般存檔；覆寫前重抓清單，沒經過 Windows 問過的撞名用 confirm 補問；要覆寫的那份開在別的視窗就不蓋。伺服器 `/__save-as-dialog` 多收 `current`（照 id 規則驗證）。
- 驗證：實機以探測模式（VFX_SAVE_PROBE，視窗選好自己關掉）跑正式路徑：約 1.9 秒選到 `proj-cleave-ring-tricolor-08.json`，截圖確認清單反白並捲到可見；Windows 上 unlink 被開著的檔回 EBUSY 另見上一筆。頁面（攔下問名字的請求）：覆寫既有特效成功（內容與分組都換成新名字、原本那份不動）、選到自己＝一般存檔、未經確認的撞名補問並可取消；console 無錯誤。測試：SAVEAS-2／3／4／5／6、SA2、RENAME-12 依新行為改寫，新增 SAVEAS-4B（Windows 上實際編譯 C#）；相關三支測試檔只剩既有的 16b。

## Codex｜每次傷害觸發吸血吸魔（DAMAGE-DRAIN-20260918）

- Owner Codex；Done。使用者要求新版技能接上屬性汲取，按每名敵人每次傷害觸發；移除舊版專用施放後吸取，技能本體留待正式廢除。
- 範圍：formula.js 傷害掛點、combat.js 統一汲取與 DoT 合併跳數／反震、skills.js 移除重複路徑、data.js 說明、快取與回歸測試。基礎汲取量、大地守護乘區、資源溢出規則不變；沒有表格或素材變更。
- DoT 仍合併扣血，依同幀實際跳數一次結算回復，沒有新增 Timer／逐擊粒子。普攻、Skills2、直接衍生傷害、同步／延後反震共用入口；預覽、零傷害、死亡玩家不觸發。
- 驗證：node --test tests/damage-drain.test.cjs tests/attr-skill-rework-2026-07-30.test.cjs tests/combat-dot-log.test.cjs tests/enemy-projectile-retaliation.test.cjs tests/combo-hits.test.cjs tests/skill2-earth.test.cjs tests/skill2-counter-bloodrage.test.cjs tests/passive-stat-panel.test.cjs，102/102 通過。node tools/build_check.cjs，377 檔通過；git diff --check 通過。新增6項行為測試；檢查未修改 skills2.js／Excel／CSV。
- 風險：未實機畫面及大型戰場效能量測；逐目標逐傷害觸發會按設計提高群攻、多段與 DoT 的回復量。HP／MP 經既有實體快照顯示，屬性說明同步；不額外產生逐擊汲取浮字。可合併，未推送。

## Codex｜裝配被動加成屬性面板（PASSIVE-PANEL-20260918）

- Done。Worker 在 header／equip 快照提供 passivePanel：實際回復量、吸血／吸魔百分比與每次回復、元素增傷乘區、常駐技能減傷；不覆寫戰鬥基礎屬性。大地守護生命上限原已納入。面板透過快照顯示，無 G 亦可用；技能減傷獨立列，避免與全局減傷點數錯加。装卸技能協議刷新 header／equip，協議升至 v34。
- 修改 formula.js、skills2.js、data.js、Worker 協議／快照、index.html／bridge.js 快取、WORKER_PROTOCOL 文件與測試。未修改 Excel／CSV、player.js 快取、combat.js 回復或素材，沒有新增 Timer。
- 驗證：node --test tests/passive-stat-panel.test.cjs tests/stats-panel.test.cjs tests/equip-set-preview-stats.test.cjs tests/worker-protocol.test.cjs tests/ui-worker-panels.test.cjs，34 項中33通過；唯一既有失敗是 item.upgrade 測試未提供 UI（本次未改該函式）。大地守護／再生／回復／魔法盾定向7/7通過，涵蓋戰鬥結果不變；build 376 檔通過。新增5項回歸含正式裝卸函式、Worker header、序列化無G呈現、預覽與原物件不污染。
- 風險：尚未實機畫面驗證；暫時／有條件的戰鬥觸發不當成永久屬性加入。可合併，未推送。

## Codex｜進化階級耗魔（SKILLS2-MANA-20260918）

- Done。統一最高生效階／超神耗魔，非累加；階級預覽顯示該列成本，技能列以快照計算目前成本。同步 skills2.js 實際扣魔與自動迴旋斬、skills.js 起手門檻、ui.js 階級／超神提示與技能列及快取。免費追加施放及被動逐次觸發保持原規則；未修改 Excel／CSV。
- 新增 tests/skills2-mana-cost.test.cjs，覆蓋全部主動群組逐階／超神成本、超神失效回退、主執行緒快照、實際扣魔、不足魔力、GM 鎖魔、免費施放及正式自動施放佇列。嗜血狂怒舊測試提供足夠魔力並改驗第七階成本，保留全部技能行為斷言。
- 驗證：node --test tests/skills2-mana-cost.test.cjs tests/skill2-counter-bloodrage.test.cjs，28/28 通過；node tools/build_check.cjs，375 檔通過；git diff --check 通過。未實機檢查畫面；高階實際耗魔會依原設定提高。檢查未改 formula.js、combat.js 及魔法盾；沒有素材變更。可合併，未推送。

## Claude｜翻轉的圖層在預覽區點不到也拖不動（VFX-GIZMO-FLIP-20260918）

- 使用者回報：ground-storm-dance 的 floor-green-rim-front 無法用左鍵拖曳移動。
- 共同根因：`baseBounds` 的框寬高是有號的（素材尺寸 × scale），scale 為負（翻轉）時 w 或 h 就是負的，框的 x／y 也不再是左上角。gizmo 有兩處把正負號當成了大小關係：
  1. `insideBounds` 用 `y <= p.y <= y + h`，h 為負時等於要求「在下緣之下、又在上緣之上」，任何點都不成立。框看得到，但框內拖曳（`hitGizmoBody`）與點擊選取（`hitLayer`）都永遠落空。
  2. 旋轉把手放在 `bounds.y - ROTATE_OFFSET`，隱含 bounds.y 是上緣；翻轉時它其實是下緣，把手被放進框裡。這個框很扁，把手正好在中間，而命中順序是「先問把手、再問框內」——修好第 1 點之後實測從框中心往下拖，得到的是 -43° 的旋轉。使用者截圖中框中間的藍點就是它。
- 受影響範圍：目前正式 preset 中只有 ground-storm-dance 的五個 front 半圈（wall-front-0/1/2、floor-green-rim-front、floor-white-core-front），都是垂直翻轉的副本，好畫在角色前面。在預覽區這五層全部選不到也拖不動。
- 修法：`insideBounds` 改用兩個角圍出的範圍判定；旋轉把手改放在「畫面上的上緣」之外。刻意不在 `baseBounds` 把寬高轉成正值——縮放把手靠有號值知道圖層是翻過來的，轉正之後拖一下把手就會把翻轉拖正。把手位置只影響畫在哪、點不點得到，旋轉角度是用抓下去的點相對 pivot 算的，行為不變。
- 驗證：以實際資料確定性重現（框中心點被判定不在自己的框內）後修正，五個翻轉圖層全部點得到、遠處的點仍判定在框外。實際編輯器中從框中心拖曳：position 由 (0, -0.5405) 移到 (80, 59.46)、rotation 維持 0、scale 維持 (0.5505, -0.2092)，歷史記為「移動圖層」。新增 FLIP-1～7，其中 1/2/4/5/7 在原版會紅（突變驗證），3 與 6 是防止「修過頭」的守門（不得什麼都算框內、不得抹掉有號寬高）。
- 既有失敗（與本次無關，以原版 gizmo-model.js 跑同樣失敗）：vfx-editor-gizmo 的 CAP-2、vfx-editor-history 的 HISTORY-42、vfx-editor-save 的 16b、vfx-curve-editor 的 OUTER-7。

## Claude｜Preset 下拉的狀態標註冠上施加它的技能（VFX-USAGE-STATUS-OWNER-20260919）

- 使用者要求：掛在技能底下的 status，用途標註要加上主技能名稱，例如「暴風亂舞*暴風化身」，這樣才搜得到相關特效。
- 原本狀態列只寫「狀態名稱」：ground-storm-dance 標「暴風化身」，搜「暴風亂舞」找不到。
- 關聯方向：狀態表沒有指回技能的欄位；是技能表 Skills2 的「我方狀態／敵方狀態」填狀態 ID（可多個，分號分隔）。在 TABLES 的狀態表宣告 `ownerOf`，欄名與來源表只寫一處。
- 技能那一段沿用既有的 `stageLabel`（階段名與群組名不同時寫「群組·階段」），而不是只寫階段名。理由是實際資料：「燃燒」同時是火球術與火龍捲的一階，只寫階段名會變成「燃燒*烈焰燃燒」、搜「火球」找不到，正好違背需求的目的。所以使用者的例子實際呈現為「雙刀亂舞·暴風亂舞*暴風化身」，搜「暴風亂舞」「雙刀」「暴風化身」都找得到。
- 其他決定：分隔用使用者指定的 `*`（`·` 已經是「群組·階段」，混用會讀成「狀態是某技能的一階」）；多個施加者各成一筆而非串成一串（沿用下拉既有的多用途顯示）；狀態與施加它的那一階同名時不再重複寫（13 份裡 9 份是這種，「嗜血狂怒*嗜血狂怒」只是雜訊）；狀態 ID 拆開後完全比對，不做子字串比對（否則 sgStorm 會連 sgStormBarrier、sgStormGod 一起算進去）。
- 重構：把「讀表＋回補群組名稱」抽成 `readTable`，掃特效欄與找施加者共用；`rowLabel` 改用 `stageLabel`。回補規則與命名規則各只有一份。
- 驗證：改前改後完整比對 132 份 preset 的標註——120 份一字未動、12 份變動全是被狀態使用的特效、0 份新增或消失。實際編輯器下拉搜「暴風亂舞」「雙刀」皆找到 ground-storm-dance，「火球 燃燒」「火龍捲 燃燒」皆找到 st-tick-fire。新增 USAGE-16a～e 並做過突變測試（關掉冠名時 16a/16b/16c 轉紅）；USAGE-7C 的前提隨之調整（狀態來的用途是另一條使用路徑，不算收攏失敗）。vfx-preset-usage 23 項通過。
- 部署：preset-usage.cjs 在伺服器的 RESTART_REQUIRED_FILES 內，需重開編輯器才會看到新標註（伺服器會自動提示）。

## Codex｜反擊最高階耗魔（COUNTER-MANA-20260921）

- Done。使用者確認：每次基礎／招架反擊扣最高已學習階段的消耗（超神優先），不是累加；二次反擊、狂化反殺實際觸發時另扣各階消耗。強化、反擊盾、破甲包含在基本消耗內，不另收費。反擊衍生斬擊不重收基本消耗。
- 範圍：skills2.js、ui.js、反擊／耗魔測試、index.html／bridge.js／sim.worker.js 快取、本紀錄。預檢發現 Claude 39b21fb3 在 index.html 更新 battle-renderer 快取；使用者明確允許不同列且可正常合併時繼續。本次只改技能／UI／bridge 列，不覆蓋該渲染列。其他檔案預檢無衝突，保留使用者 Excel 與素材改名。
- 驗收：全七階與三超神、非累加、觸發／未觸發、MP 不足與恰好足夠、雙來源反擊、額外觸發消耗、空目標、GM 鎖魔、UI 快照耗魔一致。
- 完成模擬扣費與 UI 門檻／彈窗／提示同步，表中數值不變；工具產生的說明與 SKILL_TEST_SPEC 已更新，無新素材或 Worker 協議。index.html 以 merge-base／工作區版本／ai/claude 三方合併乾跑成功，保留双方快取版本，未實際合併。
- 測試：node --test tests/skill2-counter-bloodrage.test.cjs tests/skills2-mana-cost.test.cjs tests/skill2-ui.test.cjs：35/35。node --test --test-name-pattern="神聖|戰神體|反擊|不屈鬥魂" tests/skill2-ult-evolution.test.cjs：使用者工作區 Excel 重排列造成 1 項舊固定欄索引失敗，讀取 HEAD 工作簿重跑 10/10 通過，未修改使用者檔案。node tools/build_check.cjs：379 檔通過；Skills2 apply dry-run 零語意差異；diff check 通過。完整範圍報告見 docs/skill-tests/20260921-counter-codex.md。
- 唯讀檢查反擊超神／傳奇、吸魔與 UI 快照路徑，未修改 formula.js、Excel／CSV 或使用者素材。未實機畫面／Console 驗證；使用者的 Excel 與素材改名保留未提交。無未完成實作，可合併；Commit 見本紀錄所在提交，未合併或推送。下一步整合後觀察反擊耗魔與吸魔收支。

## Codex｜施法消耗數值驗證（SKILLS2-COST-VALIDATION-20260921）

- Done。修正 Skills2 工作簿殘留的「技能本體／附加效果」清單驗證，依「施法消耗」表頭定位，改為允許空白的非負數值驗證。預檢通過，保留使用者目前欄位排序及數值；僅修改工作表驗證 XML，不重建工作簿。
- 工作區目前為 J2:J231；提交以 HEAD 工作簿建立同一驗證修正，施法消耗位於 AG2:AG231，使用者既有重排及其他工作簿編輯留在工作區。所有儲存格內容與修改前逐格一致；Excel 原生重開正常，40／0／0.5／空白通過驗證，負數與文字不通過。git diff --check 通過；無程式／CSV／素材更動，無需 build。唯讀檢查 config_tables.cjs 與工作簿 XML。
- Commit 見本紀錄所在提交，可合併，未合併／推送。無未完成項目；使用者若已開啟舊版 Excel，須關閉且不覆蓋磁碟修正後再開啟。下一步以修正版工作簿繼續填寫數值。

## Codex｜戰神體定期失血與分段返還（WAR-GOD-BODY-20260921）

- Done。使用者合併後授權繼續：每 0.5 秒流失最大生命 1%，每 2 秒累計實際失血百分比，兩倍作為下一個 2 秒的反擊傷害加成；各段持續交替結算，固定參數不隨等級增加。護盾不計失血，回復不抵銷已記錄損失。
- 範圍：Skills2 Excel／CSV、skills2.js、formula.js、skills.js、legendary.js 的生命損失通知、combat.js／tower.js 排程後判死、skills2-geometry.cjs 間隔欄接線、技能測試、index.html／bridge.js／sim.worker.js 快取、本紀錄。各檔预檢無衝突，保留合併後其他配置。無新素材／協議。
- 驗收：半秒扣血、兩秒邊界、兩倍加成、受擊／DoT／自傷計數且不重複、GM 鎖血、失效與死亡重置、Excel／CSV／JS 與技能說明同步。
- 實作：第一段只收集，之後收集本段同時使用上段加成；段尾定期自傷歸入剛結束的段。每次實際生命損失按當時生命上限換算百分比；自傷繞過護盾且可致死，沿既有野外／高塔死亡流程。定期扣血及返還排程使用 GT，不新增 Timer 或畫面特效，HP 依既有快照呈現。
- 配置：Excel 原生儲存並重開驗證，與來源逐格比較只改 Z71、AU71、AW71、AX71，保留物件數。沿用已確認 Artifact 匯出不相容時的原生 Excel 流程。CSV／JS apply dry-run 零語意變更。Lv.1／Lv.10 說明相同，明示每 0.5 秒流失 1% 最大生命與兩倍返還，無未替換佔位符。
- 測試：node --test --test-name-pattern="戰神體" tests/skill2-ult-evolution.test.cjs：4/4，含野外／高塔排程、補拍、半秒與兩秒邊界、治療後再受傷、護盾、以血還血、鎖血與重置。node --test tests/death-revive-restore.test.cjs tests/field-death-retreat.test.cjs tests/skill-cooldown-death.test.cjs：5/5。
- 廣域：node --test tests/skill2-counter-bloodrage.test.cjs tests/skills2-geometry.test.cjs tests/enemy-projectile-retaliation.test.cjs tests/skill2-ult-evolution.test.cjs：當時 99 項 73 通過 26 失敗；以 HEAD 原程式／測試／配置預載重跑為 97 項 71 通過、相同 26 項失敗，無新增失敗（之後新增的野外／高塔戰神體案例另已通過）。node tools/build_check.cjs：379 檔通過；diff check 通過。
- 唯讀檢查 player.js／potential.js 生命變化、既有扣血與復活流程、配置工具及說明產生器。限制：未實機畫面與 Console 驗證，既有廣域失敗未在本次擴大修正；无未完成實作。Commit 見本紀錄所在提交，可合併，未合併或推送；下一步使用者整合後確認戰神體技能說明及自傷節拍。

## Claude｜戰鬥場景輕度斜俯視 2.5D（BATTLE-TILT-20260922）

- Owner：Claude；Done。使用者需求（附示意圖）：場景從完全俯視改成輕度斜俯視，地面與方格 Y 軸壓縮約 0.7；貼地特效與直立特效的處理交給 Codex，本任務只做場景；不改角色移動、碰撞、技能範圍與世界座標邏輯。
- 範圍：js/battle-renderer.js、index.html（快取版號）、對應測試。模擬層、Worker、協議、存檔、參數表、vfx-runtime／vfx-core／preset 都沒動。無前置依賴。
- 修改：
  - A（b48fac7f）：GROUND_Y_SCALE = 0.7 與換算函式。world 層直屬座標改為投影後的畫面座標（角色、血條、名字、飄字、HUD、輪廓，形狀不壓縮）；特效四層（zone／presetZone／fx／presetFx）包進 scale.y = 0.7 的 groundUnder／groundOver，沿用世界座標——落點與模擬層一致，貼地的圓自動成為 1:0.7 橢圓。posOf／footOf／playerMuzzle 回傳地面平面座標（離地高度 ÷ 0.7，畫面上維持原像素高度），飄字改用 screenPosOf。地磚 tileScale.y = 0.7、先在世界單位取餘數再投影；鏡頭縱向對準投影位置。面向改用世界向量（與移動轉向同一套）。
  - B（本紀錄所在提交之前的 dac332b8）：敵人進場淡入 0.3 秒。模擬層 440 的生成距離在畫面上下方只剩約 310px，比畫布半高短，會在畫面裡憑空冒出來；生成距離是遊戲節奏不為畫面改。
- 決策：投影只縱向縮放，不加斜切與近大遠小（加斜切會讓貼地的圓變成歪的橢圓，與「統一 1:0.7」衝突）。敵人腳下陰影、角色 8 方向素材維持原樣。一開始把示意圖的「菱形格子」當成概念圖而只做了縱向壓縮，使用者實機回報「似乎還沒調整」，C 段補上。
- 特效的現況（原本交給 Codex，2026-09-22 使用者改派給 Claude，見 G 段）：Preset 特效已在直立空間、不壓縮，Runtime 吃畫面座標；舊畫法（zone／fx，Preset 沒接手或 ?vfx=legacy）仍在地面平面，直立的會被壓扁，但實機所有技能都走 Preset、舊畫法圖層 0 個節點。一律引用 GROUND_Y_SCALE，不要寫死數字。E 段的透視是整張畫面的後製，特效照平行投影做即可。
- 驗證：新增 tests/battle-ground-projection.test.cjs（PROJ-1～6：真正跑 buildScene 看各層投影縮放與繪製順序、錨點投影後與畫面身體位置重合、目標消失退路、進場淡入）與 tests/helpers/battle-scene.cjs；player-outline、player-shield-bar 的圖層順序測試改看場景樹，basic-melee、player-cast-act 依新面向換算更新。7 個突變全部被抓到。受影響的 25 支測試 333 項：失敗與改動前基線相同，另有「雙刀逐刀目標」一條是隨機不穩（同一份程式重跑紅綠交替、與本次無關）。build_check 391 檔通過。實機（claude 副本 8331，手動推幀＋抽圖）：地磚 128×90、鏡頭與地板捲動數值吻合、角色與血條不壓縮、輪廓對齊、新敵人淡入。
- C（86d61df1）：使用者實機回報「似乎還沒調整」。只壓縮不轉，正方形地磚只會變成扁長方形，眼睛讀成平鋪的長方形地磚，沒有斜視感；示意圖寫的是「斜視的菱形格子（Y 軸壓縮）」。
  - 地板改掛 scale.y = 0.7 的地面平面容器，TilingSprite 轉 45°（GROUND_TILE_ROTATION）：先在世界平面裡轉、再由容器壓縮，畫面上是正的 1:0.7 菱形。轉的是地板圖樣不是投影，貼地特效仍是 1:0.7 橢圓。捲動抽成 syncGroundScroll，週期＝邊長 × √2（GROUND_TILE_PERIOD，貼圖必須是正方形）。
  - Pixi v8 的坑：TilingSprite 寬高不同時 tileRotation 會被長寬比拉歪（926×3023 轉 45° 變成一組細密、一組稀疏的陡斜線）。地板 sprite 在本地空間取兩邊較大者做成正方形。用純方格測試貼圖在頁面裡抽圖確認（只在記憶體裡換，不動檔案）。
  - 測試：PROJ-1 改驗菱形鋪法，新增 PROJ-7（世界上固定一點的貼圖座標跨週期邊界不跳格）、PROJ-8（地板 sprite 正方形且蓋滿畫布）；4 個突變全部被抓到。受影響測試 335 項，失敗與基線相同（加上同一條隨機不穩的雙刀測試）。
- D（f00c2d94）：使用者比對遊戲截圖與示意圖覺得不自然。量測：示意圖畫的光圈約 0.37～0.41、地磚菱形 0.46～0.52，與它自己標的「Y×0.7」不一致；0.7 ≒ 相機仰角 44°，仍接近正上方俯視，跟 3/4 視角畫的騎士對不起來。做了同一格畫面 0.7／0.5／0.4／0.5＋地磚縮半的並排比較（只在頁面記憶體裡換），使用者選 0.5。只改常數。快取 battle-renderer 1.6.137（1.6.136 已被同副本的普攻三招隨機 d8e60e6b 用掉）。
- E（f749f9a4）：使用者把示意圖上下兩塊地磚框出來比，寬差 5%、高差 18%——有輕微透視（我前一輪說「沒有 FOV」是沒量就下結論，錯了）。原型比較上緣 ×0.90／×0.82 後使用者選 0.82。
  - 後製單應變換：場景（地板＋world）照平行投影畫進離屏貼圖，PerspectiveMesh 貼回畫面；中心不動、水平線保持水平、橫向 1/w、縱向 1/w²。地面是世界平面的仿射像，再套單應變換＝真正的相機透視，地板與所有貼地特效自動一致；特效、站位、模擬層都不動。
  - 離屏範圍（perspectiveLayout）：上緣那一列要的寬度最大，上方與左右多畫、下方用不到的不畫；貼圖開 antialias、跟著解析度，尺寸變了重建；掛在 app.ticker 優先序 −10（tickWorld 之後、Application render 之前）。暗角留在地板與世界之間，改用預先反向變形的貼圖；復活倒數換到變形後的位置。?persp=0 或 PERSPECTIVE_TOP_SCALE = 1 完全回到無透視。
  - 效能（670×731、解析度 1、12 隻敵人、每幀讀回像素強制等 GPU）：1.0～1.1ms／幀，?persp=0 為 0.8ms。高解析度（DPR × UI 縮放最高 2.5）尚未實測，填充成本會隨像素數增加。
  - 取捨：畫面上下緣的直立角色跟著縮放（上緣約寬 82%、高 67%，稍微矮胖）；角色永遠在中心不受影響。
  - 測試：新增 tests/battle-perspective.test.cjs（PERSP-1～5：公式、畫布每點反推都在離屏範圍內、開關兩條路徑的場景結構與重建）；PROJ-8 加上透視時地板蓋滿離屏範圍；player-event-float 的死亡倒數位置斷言跟上。6 個突變全部被抓到。受影響 26 支測試 341 項，失敗與基線相同（加上雙刀那條隨機不穩）。
- F（26331649）：2bd16023 刪掉了 images/vfx/thrust_lance.png，但突刺舊畫法與高塔 CSS 還在用；使用者要求還原並放進 assets 底下合適的資料夾。
  - images/vfx/assets 由 tools/vfx/export-assets.cjs 整棵換新、只留 preset 引用的素材，直接放進去下次匯出就被刪。改走同一條管線：素材放進素材庫 codex-authored/thrust/（附 SOURCE.md），asset-index 只插入這一筆（素材庫另有 9 張新圖、42 個 SVG 雜湊變動未整理，整份重掃會夾帶），新增 vfx/runtime-assets.json 登記「程式直接引用的素材」，匯出工具一併收錄（不存在＝沒有；格式錯、沒寫 usedBy、重複一律失敗）。重新匯出只多這一張，其餘 146 張不變；renderer 與 CSS 改新路徑。
  - DEVOUR 循環測試：使用者調過漩渦的 alphaOverLife（頭 1.0、尾 0.965），循環邊界有約 0.03 的透明度落差；測試改驗跳動 ≤ 0.05，不再釘確切數值。要完全無縫得把曲線尾端改回 1.0（使用者的 preset，沒動）。
- G（400ee321）：直立特效不壓縮（使用者改派給 Claude）。盤點 229 份 preset 發現它們本來就是照斜視畫面畫的（地面光圈已壓扁約 0.38～0.45、往上是高度），先前放進地面平面等於壓兩次。
  - presetZone／presetFx 移到直立空間；VFX Runtime 改吃畫面座標：ctx 給 screen* 版本，boot 傳 groundScale，tryPlay 由 screenSpaceSpec 換事件座標（點 y×k、方向 atan2(k·sinθ,cosθ)、沿方向長度×投影比；半徑與厚度不變；延後事件只換一次；不改原物件）；繞行軌道壓扁由 0.62 改用 groundScale。編輯器與測試不給 groundScale＝行為不變。規則寫在 docs/vfx/VFX_RUNTIME_ADAPTER.md §1.2.4。
  - 實機（Lv.500、火龍捲／落雷／岩甲／火球）：落雷全高、龍捲底環扁而本體直立、火球是圓的、石塊直立；console 無錯誤。測試：新增 vfx-runtime-screen-space（SCREEN-1～4）、PROJ-9；42 支相關測試與 HEAD 比較沒有新增失敗。
  - 已知差距：preset 的地面光圈手繪約 0.4，比地板 0.5 略扁；原本就畫成正圓的地面特效仍是正圓——要完全一致得逐份調 preset（內容工作）。
- H（dcac82b6）：使用者回報傷害數字也被透視拉歪。浮字層與玩家 HUD 移出場景、掛在 stage 的螢幕層；浮字的位置記在 f.lx/f.ly，每幀用 worldToScreenPoint（鏡頭平移＋透視）換成螢幕位置，字本身大小照舊；重疊判斷改用 lx/ly；HUD 位置改在鏡頭算完後換算。敵人頭上的名字與血條仍在場景裡（會跟著透視，使用者沒提）。測試 PROJ-2／PROJ-10，三條圖層順序測試改看整個 stage。
- 待確認：高 DPI 下的透視效能；地面光圈扁度與地板的細微差距（是否要逐份調 preset）。

## Claude｜普攻次數跟不上面板攻速（ATKCD-CARRY-20260922）

- Owner：Claude。使用者回報：面板攻速 5 次/秒，目測只有 1 秒 3 下。
- 實測（claude 副本 8330，新存檔，GM：level 500、god 1、statset aspd 5、statset crit 0、spawn 12 small 1000，攔 queueWorkerVisualEvent 記 15 秒普攻事件）：每秒 3.97 下；59 次中間隔 0.2 秒 36 次、0.3 秒 19 次，其餘 0.4～0.8 秒是技能施放硬直。
- 根因：js/combat.js 每一步把 atkCd 夾在 0。出手只發生在步與步的交界（Worker 一步 0.1 秒，計時器抖動時切成整步加零頭），週期的尾巴落在步中間時，超出 0 的那一點整個丟掉，要多等一整步。攻速 4.9 在整齊步長下直接掉成 3.33（每刀 3 步）。高塔（js/tower.js）本來就不夾，沒有這個問題。
- A（本紀錄所在提交）：只在「這一步剛歸零」時保留超出的量（最多一步），出手後從週期扣掉；上一步已經是 0（等待中）的照樣夾在 0——2026-08-16「追擊累積負數冷卻、抵達後連續補攻」的修正照樣成立（既有兩條測試不動、仍通過）。
  - 快取：combat.js 1.0.58、bridge.js 1.0.138、WORKER_ASSET_VERSION 20260922-atkcd-carry、sim.worker 的 combat token。
  - 測試：multi-enemy 新增「普攻次數跟得上面板攻速」：照 Worker loop 切步（0.1 ± 0.01 秒切成整步加零頭）跑 60 秒，攻速 5／4.9／3.3／2.5 誤差 2% 內。突變：換回舊夾法時攻速 5 只剩 4.28、4.9 只剩 3.33，測試紅。
  - Node 照 loop 切步模擬 120 秒：修正後間隔幾乎都是 0.2 秒、每秒 5.00 下；舊版 0.2／0.3 秒混雜、每秒 4.21 下（與實機修正前一致）。實機重測（同一組 GM）：扣掉施法硬直後每秒 5.08 下。
  - 量測的坑：Browser 面板隱藏時，主執行緒大約每 0.2～0.3 秒才收到一批 Worker 訊息，同一批裡的兩刀會量成「同時到」；要看模擬層節奏用 Node 照 loop 切步跑，不要只看主執行緒到達時間。
- 影響：普攻實際次數提高到面板值，攻速 5 的普攻輸出約多 25%（原本 3.97 下）。數值平衡若是用舊的實際次數調的，要重新看。
- 不在這次範圍、實戰仍會讓普攻變稀的設計規則：普攻擊殺後換目標間隔 0.7 秒（TARGET_SWITCH_DELAY）、技能施放硬直 0.2 秒期間不普攻。
- 同樣的夾法也在技能冷卻（js/skills.js tickSkillCds 夾 0），短冷卻技能（最短間隔 0.4 秒）同樣會被多拖一步，沒有一起改。

## Claude｜普攻三招隨機混合（ATTACK-MIX-20260922）

- Owner：Claude。使用者要求：兩段攻擊動作（Melee／Melee2）與特殊攻擊 1（Special1）隨機混合出現，不要一直用同一招。
- 原本：普攻只有 attack1／attack2 固定輪流；Special1 只在技能施放（act:'cast'）時播。
- 修改（本紀錄所在提交；素材庫 1fa5ab1 只改 README）：
  - tools/build_character_sprites.cjs：新增 attack3＝{ from:'cast', first:5 }，不另外出圖（與 cast 同一套 Texture）；from 動作可帶 first（素材原幀號，不能早於來源的 first）。第 8～9 幀釋放，從第 5 幀開始＝與另外兩段一樣出劍前留 3 幀架式。重跑後只有 knight.json 多一段。
  - battle-renderer：loadDirectionalSheet 的 from 動作依 first 往後切；playerAttackAnim 普攻改成隨機、但不連續兩下同一招（純隨機會連抽同一段像卡住重播，固定輪流又太規律）。
  - 順手修：onVfx 只認主普攻的斬擊（variant melee）才帶動角色。神鑄【天罰】的落雷也是 cat basic、跟主普攻同一刻到，原本會把同一刀換成另一招而且不加速（duration 0），整段揮擊被下一刀攔腰切掉。
  - 快取：battle-renderer 1.6.136。
- 測試：basic-melee 改寫（300 下：三招都會出、次數相近、從不連續同一招、出現 A-B-A＝不是固定輪流、每招都照攻速加速；天罰落雷不帶動角色）；player-directional-sprite 新增 DIR-9（整支 loadDirectionalSheet 用假 PIXI 跑：attack3 是 cast 同一批 Texture 從第 5 幀切起、輪廓查得到、起身照舊整段倒轉）與 DIR-1 的 attack3 幀定義；skill2-vfx 的字面斷言跟上條件。
- 取捨：attack3 與施法動作是同一套圖，畫面上分不出「這一下是普攻還是技能」。

## Codex｜火龍之吞噬巨型火漩渦（DRAGON-DEVOUR-20260922）

- Owner Codex；Review（先提供預覽）。使用者合併 Claude 後授權繼續，重新預檢無衝突。
- 單一半徑15米火漩渦，持續8秒，每0.35秒200%火傷、每級+20%；持續聚攏35米敵人。每秒隨機2～4顆拋物線火球，20米內隨機地面落點（含漩渦內），落地半徑6米400%火傷，不搜敵。
- 允許 Skills2 Excel／CSV、skills2.js、必要VFX接線／新Preset與layout／素材庫同步、測試、快取與本紀錄；不修改其他技能規則。沿既有場域與排程，先交付預覽；不合併／推送。
- 驗證單一場域、固定節拍／壽命、升級、隨機落點／數量、落地傷害與畫面事件一致、聚怪、死亡清理、素材尺寸、配置往返及build。
- 已完成技能／表格／特效與快取同步，Excel原生儲存重開，僅12格資料改變；21項配置與技能測試通過、DEVOUR畫面測試通過。火系52/56、Runtime99/101，其餘6項以HEAD重跑確認既有失敗。build392檔通過；正式Preset在瀏覽器已顯示，Console無新增錯誤。
- 第二版：新漩渦取代舊漩渦、疏紋亮外圈暗中心、三道漸層螺旋環帶、整圈無縫旋轉；火球縮小30%、世界座標弧線尾焰及落地爆炸。修正聚怪錯用6.6米近戰停止線，只保留體型。23項配置／技能與3項DEVOUR畫面測試通過，Runtime101/103仍僅既有失敗。使用者同意index.html與Claude分行改快取。
- 素材已存入素材庫並同步Preset/layout，位元組一致。依「先給預覽」保留未提交，沒有合併／推送；完整交接與限制見 docs/skill-tests/20260922-dragon-devour-codex.md。

## Codex｜火漩渦範圍內停止聚攏（DEVOUR-PULL-20260922）

- Owner Codex；Done。使用者要求已在火漩渦範圍內的敵人不再聚攏。僅修改 skills2 聚攏判定、dragon-devour 測試、主頁／Worker 快取及本紀錄。沿實際傷害範圍含體型接觸判斷，圈外維持既有拉動。
- 衝突預檢僅 index.html／AI_TASKS 與 Claude 不同區段有修改，三方乾跑 exit 0，依既有「不會合併衝突即可改」授權執行。無素材變更。
- 驗證：`node --test tests/dragon-devour.test.cjs tests/firepillar-expire-vfx.test.cjs` 14/14；`node --test tests/skill2-fire-legendary.test.cjs` 18/21，3 個既有失敗（地爆天星倒數／預警、烈焰暴風數量）以 HEAD 基準重跑確認。`node tools/build_check.cjs` 395 檔、`git diff --check` 通過。測試包含圈內／邊界／Boss 體型、圈外拉入後傷害與移動排程，特效事件半徑與判定一致。
- 唯讀檢查 battlefield.js 範圍／體型與技能配置、VFX 範圍事件；未修改素材，無素材庫提交。未瀏覽器實戰驗證，無未完成實作；可供使用者合併，建議整合後確認實戰聚攏感受。未合併／推送，Commit 見本紀錄所在提交。

## Codex｜地面特效投影（VFX-GROUND-20260922）

- Owner Codex；Done。83 份 Preset／185 個地面圖層投影成橢圓或菱形，直立本體保留。使用者另同意方形作用判定同步旋轉，保留邊長／傷害／時序。Core／Runtime 與編輯器選取框一致。
- 範圍：VFX Core／Runtime、既有 Preset 與素材庫來源、skills2 方形場域方向、相關測試、主頁／Worker 快取與文件。禁止修改其他技能規則、配置數值及其他副本。
- 前置：場景 GROUND_Y_SCALE 與透視已具備。預檢 index.html／本紀錄與 Claude 修改不同區段，依使用者「不會合併衝突即可改」授權，git merge-file 乾跑兩檔皆 exit 0。
- 驗收：圓形旋轉過程維持地面橢圓、方形邊界與命中一致、混合特效直立層不壓縮、編輯器與遊戲外觀一致、素材雙倉庫同步、Build／Console。完成後交使用者整合，不自行合併或推送。
- 驗證：ground-plane／preset-usage 28/28；最終 10 檔回歸 404 項，399 通過／4 已基準確認的既有失敗／1 跳過；Build 395、素材 export --check 與 diff check 通過。83 份預覽檢查、GPU 編輯器 Console 無錯誤。未做全技能長時間實戰；既有失敗詳見交接。
- 素材庫提交 `987e2c4`，遊戲 Commit 見本紀錄所在提交。無未完成實作，可供使用者整合，未合併／推送；完整修改與唯讀檢查清單、測試指令、已知風險和素材來源見 [GROUND_PROJECTION_AUDIT.md](vfx/GROUND_PROJECTION_AUDIT.md)。建議下一步實戰確認視覺比例。

## Codex｜火神星環實心火核（STAR-CORE-20260922）

- Owner Codex；Done。使用者已確認修正後的環形拖尾動態預覽並授權接入。
- 移除空心圓圈與環形光暈，改為實心火焰核心、世界座標弧線尾焰及抵達後自然淡出；保留最新8米半徑／24米每秒／0.5圈每秒／50米射程。Preset、layout、製作來源、Runtime收尾／快取與相關測試同步。
- 19項相關測試及156項Core／階層測試通過，399檔build與素材匯出檢查通過；Pixi預覽頁已檢視。環形尾焰隨中心前進，只保留旋轉弧線。素材庫提交1f11546，遊戲提交見本紀錄所在Commit，可供使用者合併。詳細交接：docs/skill-tests/20260922-star-core.md。未合併／推送。

## Codex｜火神星環清晰化（FIREGOD-SHARP-20260923）

- Owner Codex；Done。使用者回報實戰星環火焰與尾焰過於模糊，確認遊戲尺寸預覽後要求接入。保留已確認的六枚軌道／半徑8米／前進24米每秒／旋轉0.5圈每秒／射程50米。
- 製作輪廓明確的金橙火焰素材 sharp-flame.png（素材庫源碼 generate-sharp-flame.py），火核與弧線尾焰改用此素材；舊柔邊火焰只留下低透明度底層。同步 Preset、layout、author 源、素材索引／出貨、快取與預覽頁。技能傷害／軌道／碰撞未更動。
- 相關測試38/38通過（高速連發、軌跡、碰撞、投影與Preset用途）；Pixi預覽頁使用遊戲大小確認。build399檔、素材匯出檢查通過。素材庫commit見報告，遊戲commit見本紀錄所在提交；可合併，未合併／推送。詳細交接：docs/skill-tests/20260923-firegod-sharp.md。
