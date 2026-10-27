# BATTLE-BIOMES-20261022 交付紀錄

Owner：Codex；單一開發者；分支 `ai/codex`。使用者於2026-10-22要求依附件新增三張場景、沼澤改名，以及調整NPC屬性／場景上限，並授權實作中採推薦方案持續完成。

## 完成內容

| 順序 | 地圖 | 怪物屬性 | 關卡上限 | 識別碼 |
|---|---|---|---:|---|
| 1 | 荒漠 | 火、水 | 100 | desert |
| 2 | 冰原 | 水、雷 | 150 | Icefield |
| 3 | 迷霧森林 | 風、地 | 200 | mist_forest |
| 4 | 熔岩山 | 火、地 | 250 | lava_mountain |
| 5 | 月影沼澤 | 毒、水 | 300 | swamp |
| 6 | 落雷峰 | 雷、風 | 350 | thunder_peak |
| 7 | 亡靈山脈 | 毒、暗 | 400 | undead_mountains |
| 8 | 太古戰場 | 火、聖 | 450 | god_battlefield |
| 9 | 混沌界 | 冰、毒、聖 | 500 | god_chaos |
| 10 | 永恒神域 | 雷、暗、聖 | 600 | god_sanctuary |

每張圖以前一圖最後一關實際通關解鎖；神界三圖保留既有11轉條件。主頁與舊入口共用REALMS名單，地圖提示讀取正式上限／獎勵倍率與NPC元素，不再列出過時固定倍率。

三張新圖都有地表／地下版本、原創大型物件、程序地面、小物件、接觸陰影與固定數量天氣。迷霧森林是青綠古樹、盤根、蕨葉、低霧；熔岩山是玄武岩簇、熔岩噴口、黑曜石碎岩、餘燼與煙；落雷峰是雷擊地標、風切松、風化小物、斜雨與冷霧。沿用正式Renderer的遮擋、玩家遮蔽淡化、透視補償、圖集Worker、區塊／物件池與兩份圖集快取。

新增36種NPC，每種都有normal／elite／elite_adv／boss四列；野外共120種NPC、另保留10列塔BOSS。新BOSS各有一個合法專屬技能；沒有另造技能、特效Preset或傷害公式。

## 已採用的決策

1. 附件「等級上限」對應既有地圖關卡／怪物進度上限，角色最高等級與轉生規則維持原設定。
2. 遊戲原有八種戰鬥元素，附件的「水」共用冰霜 `ice`，混沌界的「冰」也使用同一元素。沒有新增第九種抗性、裝備詞條、技能或特效類別；UI仍依既有元素顯示「冰」。這是需製作人知悉的語意解讀。
3. 保留七張舊圖及既有NPC識別碼；月影沼澤沿用swamp。舊存檔已到達後圖時，補通關插入的前圖；縮短上限先保留舊best推得的真實通關量，再夾限，避免最後一關少記一次。新存檔不贈送進度，重讀不重複遷移。
4. 新圖倍率安排在鄰近舊圖之間，既有地圖生命／攻擊／防禦／攻速／金幣經驗倍率未改。新圖使用既有通用菁英群組規則。
5. 原掉落區間按新上限等比例縮放，保留各列掉落率及重疊相加；新圖使用相近地圖的掉落結構。原高階裝備仍有可達成的掉落區間。
6. 任務順序、索引及獎勵保留；超出新上限的通關目標移到可達到該關的新路線。例如150→冰原、200→迷霧森林、250→熔岩山、300→月影沼澤、350→落雷峰、400→亡靈山脈、450→太古戰場、500→混沌界。
7. 符文最高階以十圖進度重新安排：Runes表的drop_progressPerTier由4.6改3.2，各圖末關最高階依序為4、7、10、13、17、20、23、26、29、33。保留稀有度分佈、合成／拆解及封魔塔掉落，避免第七圖提早滿階。
8. 本次有新增配置列，依使用者全權授權，直接使用專案原生Excel API完成結構及同批格位修改，未留下本次Pending patch。其他任務原有待套用內容未操作。六本Excel均正常模式儲存／重開兩次，沒有手改封裝XML。

## 原創素材與來源

六件獨立透明PNG由內建image_gen生成，沒有使用或描摹第三方素材，也未將附件表格像素作為美術參照。RPG Mote Studio已確認可用；本次需要完整手繪式有機物件及執行期浮雕，採內建image_gen與專案既有程序工具。

| 遊戲正式素材 | 內容 |
|---|---|
| images/scene/mist-elder.png | 古樹、碎葉、盤根及垂藤 |
| images/scene/root-arch.png | 自然盤根拱與樹洞 |
| images/scene/lava-outcrop.png | 黑玄武岩柱及熔縫 |
| images/scene/lava-vent.png | 火山岩噴口及熔岩內腔 |
| images/scene/storm-spire.png | 雷擊岩、玻璃尖端、繫繩與破旗 |
| images/scene/wind-pine.png | 風切松與碎針葉 |

母來源在Effects-Materials的`codex-authored/scene-nature/`：原始生成檔與完整提示在`biomes-20261022/`，原稿／出貨雜湊與尺寸在該目錄manifest.json及sprite-exports.json；標準母稿originals最大1024、出貨sprites最大512，保留RGBA。程序來源battle-decor.js／decor-nature.js也已保存。僅透過既有export-source.cjs匯出，不依賴本機素材庫絕對路徑。

## 修改檔案

- 配置：config/Excel及config/CSV內Zones、NPC、Task、Zone_Stage_Drops、Runes，共十檔。2026-10-27移除冗餘波次表；全部地圖關卡共用game_parameters的「出怪間隔」與「棋盤格數」，不再另查波次區間，Zones仍為實際關卡上限的來源。
- 遊戲：js/data.js、player.js、save.js、ui.js、battle-decor.js、battle-renderer.js、decor-nature.js、runeword_data.js。
- 快取：index.html、js/bridge.js、js/worker/sim.worker.js、js/worker/decor-atlas.worker.js；Protocol內容及版本未變。
- 工具：tools/config_tables.cjs新增Zones投影與新NPC表錨點，tools/apply_params.cjs改從Zones取得地圖名單；tools/scene-renewal/export-source.cjs支援六素材與局部重製；兩個場景預覽工具同步。
- 圖片：上表六檔；文件：LV_upgrade_system.md、docs/AI_TASKS.md、docs/RUNEWORD_DESIGN.md及本文件。Task.xlsx「參數定義」A47同步十張地圖識別碼／月影沼澤名稱，其餘輔助頁資料保留。
- 回歸：new-battle-zones、battle-decor、stage-rework、god-realm-zones、zone-attr-tooltip、npc-vision、npc-elite-skills、npc-move-attack、field-equipment-drop-table、task-system、multi-enemy、boss-single-challenge-verification、chaos-equipment、earth-element、sim-farm-park、runeword-engine。

## 驗證與限制

主要命令：

```text
node --test "tests/*.test.cjs"
node tools/apply_params.cjs
node tools/apply_params.cjs --check-anchors
node tools/config_tables.cjs --apply Zones
node tools/config_tables.cjs --apply NPC
node tools/config_tables.cjs --apply Task
node tools/config_tables.cjs --apply Runes
node tools/scene-renewal/export-source.cjs --check
npm.cmd run build
git diff --check
```

直接相關76項回歸全過；額外符文／最終修正240項中235通過，5項與HEAD基線相同（塔資訊解鎖及既有退階斷言）。參數共573錨點：一致573、將變更0、問題0，擾動後525個數值仍全部各命中一次；四張配置再套用皆語意變更0。六本Excel／CSV逐格一致；輔助工作表除Task參數定義A47同步地圖說明外，值／公式保持；凍結、篩選、合併、驗證、條件格式保持。NPC／Task共四個既有欄寬在原生Excel正常回存後有小於0.04字元的取整差異。

正式場景預覽不讀真人存檔，六種場景均sceneReady、Worker on；主執行緒與Worker二十份圖集逐像素比對一致。正式遊戲隔離入口已啟動Worker並正常戰鬥，七個凡人界地圖按鈕、元素／上限／解鎖提示正確，Console無新增warning／error。畫面與完整比對輸出保存在本聊天visualizations/battle-biomes；沒有將測試頁、截圖、日誌或臨時作者納入遊戲倉庫。

最終全庫4764項：4299通過、463失敗、2略過。使用HEAD原始碼／Excel／CSV及原測試的唯讀映射重跑基線，失敗名稱比對新增0；基線額外失敗的六項為本次新增功能專項，證明原版缺少新行為。最後純美術色階／形狀與快取調整另跑場景、七項新契約及Worker回歸57／57。未做真人存檔長戰、跨瀏覽器、手機GPU測量或新版符文取得時間模擬。全庫仍有既有紅燈，不能宣稱全庫全綠。原生Excel測試曾因暫存目錄清理EPERM失敗，隔離重跑7／7通過，未改測試斷言或產品去掩蓋。兩庫Commit編號由AI_TASKS與交付回覆記錄。

## 交接

素材庫已先提交03e1820（24檔），遊戲Commit為本文件所在「[Codex] feat: 新增三張戰鬥場景並更新十圖進度」，編號附在交付回覆。無本次未完成實作，可供Review／合併；沒有合併／推送develop或main。下一步由使用者Review本任務Commit，正常整合後重新整理遊戲驗收三張新圖；其他電腦需同時同步素材庫。

唯讀檢查未改：共通規範／Workflow／Agent／prompts/codex、衝突檢查器、素材庫解析與來源、battle主迴圈／區域解鎖、rune掉落／任務引擎、VFX Core／Runtime及既有Protocol、其餘Excel輔助頁與既有回歸。自我Review涵蓋舊NPC識別碼／技能、前圖最後一關、存檔夾限及幂等、掉落區間、地面無縫與圖集回收。

專用瀏覽器與測試服務已關閉，七份作者／稽核暫存腳本移存本任務Git中繼資料，不入遊戲Commit。自動核准審查拒絕包含暫存刪除的批次命令，只回覆「blocked by policy」，未提供細節；沒有重試刪除，測試Temp資料夾保留。Build最終566檔通過，兩庫diff檢查通過。
