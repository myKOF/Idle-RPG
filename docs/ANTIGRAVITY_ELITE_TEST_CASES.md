# Antigravity 測試指令：菁英群組與 47 個菁英技能

- 提出者：Claude｜對應提交：`baa648c6`（菁英群組＋47 詞條）、`NPC 表加技能欄` 那一筆（固定技能）
- 測試分支：`ai/claude`（請先確認 `git log` 看得到上述兩筆；不要在 develop 上測）
- 報告：`docs/ELITE_TEST_REPORT.md`（請用繁體中文；截圖放 `tmp/elite-shots/`，報告內用相對路徑引用；`tmp/` 已被 git 忽略，截圖不進版控，但請在報告附上檔名清單）

## 0. 給你的任務

1. 逐一測試下列 **47 個菁英技能**，每個技能都要：
   - 在報告寫一段**中文技能說明**（你實際看到的行為，不是照抄下表；若與下表「設計說明」不符要標出）
   - 附**至少 2 張特效截圖**：①預警／施放瞬間（頭上浮字、地面預警圈或彈體出現）②結算瞬間（爆發、命中、傷害或狀態出現）。持續型技能（領域、護盾、光環）改附「出現」與「持續中」。被動型附光環／圖示可見的一張＋觸發瞬間一張。
   - 判定「**看得出他放了什麼**」：玩家不看日誌，只看畫面，能不能分辨這是什麼技能、哪裡會被打到。分三級回報：清楚／勉強／看不出。
2. 再測**群組與 NPC 表**（第 3、4 節）。
3. 發現問題寫進報告「問題清單」，每筆含：技能 id、重現步驟、預期、實際、截圖檔名。**不要自己改程式。**

## 1. 環境與準備

- 用 `ai/claude` 的 worktree 啟動本機伺服器（埠被占用就換一個），開 **Canvas 戰場**（預設即是；`?canvas=0` 的舊 DOM 戰場不畫菁英技能特效，已知，不用測）。
- 用拋棄式測試存檔，不要動真人存檔。
- 瀏覽器面板若被隱藏（`document.hidden`），畫面不會前進：請讓分頁在前景，或沿用既有的「隱藏面板驗證法」（手動推幀＋截圖，見 AGENTS／專案記憶 `hidden-pane-canvas-verification`）。
- 玩家要有足夠的血量與防禦能撐過 5～10 秒，或先用 GM 指令讓自己不死：
  - 在遊戲內開 GM 輸入框，或在 console 下 `WorkerBridge.send('gm.exec', { cmd: '...' })`（見 `GM_command.md`）。
  - 無敵／加屬性的指令請以 `GM_command.md` 為準。

### GM 指令（菁英專用）

```
elite list                         列出 47 個詞條的 id 與名稱
elite 1 meteor 2 1000000           1 群、2 隻、隕石雨、血量 100 萬倍（打不死，方便慢慢看）
elite 2 firewall,regen 3 1000000   2 群、每群 3 隻、火焰鎖鏈＋再生
elite 3 all 3                      3 群、每群 3 隻、隨機詞條、正常血量
```

> `elite 群數 [詞條,詞條…|all] [每群隻數] [血量倍率]`。每個技能請用「1 群 1～2 隻、血量 1000000」單獨測，才看得清楚。需要打得死的技能（不死鳥、自爆、分裂、召喚、血祭、生命鏈結）改用正常血量，並把玩家傷害調高。

## 2. 逐技能測試（47 項）

每項流程：`elite 1 <id> 1 1000000` → 站在原地或走位，觀察至少 2 次施放 → 截圖 → 寫說明。
「設計說明」是我寫的預期；**預警圈亮起後離開範圍應該不受傷**，這條對所有「範圍預警」類技能都要實測一次（站在圈內受傷、走出圈外不受傷）。

| # | id | 技能 | 類型 | 使用的特效 Preset | 設計說明 |
|---|---|---|---|---|---|
| 1 | `meteor` | ☄️ 隕石雨 | 主動 | mark-red、proj-meteor-small、burst-fire-shockwave-small | 在你身邊降下數顆隕石，落點先出現紅圈預警，倒數結束後爆炸並使你燃燒。 |
| 2 | `lightningstorm` | ⛈️ 雷霆風暴 | 主動 | mark-blue、bolt-sky-lightning、burst-detonate | 連續降下數道落雷，每道落點先出現藍圈預警；被雷劈中會短暫麻痺。 |
| 3 | `moltenblast` | 🌋 熔岩爆裂 | 主動 | ground-domain-fire、burst-fire-shockwave | 鎖定你腳下的位置，火紅魔法陣亮起後爆發烈焰；離開圈外即可躲開。 |
| 4 | `frostnova` | ❄️ 冰霜新星 | 主動 | ground-domain-ice、burst-frost-nova | 以自身為中心展開冰藍魔法陣，倒數結束後釋放寒冰新星，傷害並使你減速。 |
| 5 | `quake` | 🌍 地裂震擊 | 主動 | ground-domain-earth、burst-earth、burst-rock-petrify | 重擊大地，以自身為中心震裂出大範圍衝擊，被波及者會被震暈。 |
| 6 | `petrify` | 🗿 石化凝視 | 主動 | mark-blue、burst-rock-petrify | 凝視你所在的位置，倒數結束後將範圍內的目標石化，無法行動片刻。 |
| 7 | `shockwave` | 💥 震地衝擊 | 主動 | mark-red、burst-detonate-phys | 以自身為中心炸出環形衝擊波，被波及者會被推開一大段距離。 |
| 8 | `plaguecloud` | ☠️ 瘟疫毒雲 | 主動 | mark-red、ground-mire-venom | 在你腳下釋放長時間的毒霧，站在裡面會持續受傷並中毒。 |
| 9 | `blizzard` | 🌨️ 暴風雪 | 主動 | mark-blue、ground-blizzard | 召來一片暴風雪籠罩你的位置，區域內持續受到寒冰傷害並被減速。 |
| 10 | `darkzone` | 🌑 褻瀆領域 | 主動 | mark-red、ground-mire-magma-10 | 在你腳下鋪開暗影領域，持續吞噬站在其中的生命。 |
| 11 | `moltenpool` | 🔥 熔岩足跡 | 被動 | ground-mire-lava | 走過的地方會留下熔岩池，持續灼燒踩在上面的人。 |
| 12 | `tornado` | 🌪️ 追獵龍捲 | 主動 | ground-tornado-wind | 放出一道緩緩追向你的龍捲風，碰到會持續受傷並被拖慢。 |
| 13 | `thunderorb` | 🔵 雷光球 | 主動 | ground-thunder-orb | 釋放一顆追著你跑的雷光球，靠近就會被電擊並麻痺。 |
| 14 | `firewall` | 🔗 火焰鎖鏈 | 主動 | mark-red、ground-firewall | 兩端先亮起紅圈，隨後燃起一道橫跨你身側的火牆，接觸會被灼傷。 |
| 15 | `thunderwall` | 🚧 電磁牆 | 主動 | mark-blue、bolt-curtain-lightning | 在你與它之間豎起一道電牆，穿過去會被電擊麻痺。 |
| 16 | `waterprison` | 🫧 水牢 | 主動 | mark-blue、field-water-prison-dome | 以水幕罩住你所在的位置，困在水牢中會持續受傷並被嚴重拖慢。 |
| 17 | `darkorbs` | 🔮 暗影彈幕 | 主動 | proj-dark-orb、hit-dark | 連續射出數顆暗影彈，逐發追向你。 |
| 18 | `poisonspit` | 🧪 劇毒吐息 | 主動 | proj-poison-drop、hit-poison | 吐出數團毒液，命中的目標會中毒。 |
| 19 | `iceshards` | 🧊 冰錐齊射 | 主動 | proj-ice-shard、hit-ice | 一口氣射出大量冰錐，命中使你減速。 |
| 20 | `fireball` | 🔥 烈焰火球 | 主動 | proj-fireball、hit-fire、burst-fire | 丟出一顆巨大的火球，落地炸開並點燃目標。 |
| 21 | `windblades` | 🌀 旋風刃 | 主動 | proj-wind-crescent、hit-wind | 連續擲出數道風刃，速度很快。 |
| 22 | `lightningspear` | 🗡️ 閃電矛 | 主動 | proj-lightning、hit-lightning | 射出疾速的閃電矛，命中有機會麻痺。 |
| 23 | `arcanebeam` | 🔆 秘法光束 | 主動 | mark-red、beam-light | 先在地面劃出一條光線預警，隨後沿該直線射出貫穿光束。 |
| 24 | `chainlightning` | ⚡ 連鎖閃電 | 主動 | bolt-chain-lightning、hit-lightning | 一道電弧瞬間連到你身上，傷害並使你麻痺片刻。 |
| 25 | `charge` | 🐗 野蠻衝鋒 | 主動 | mark-red、slash-phys-big、burst-detonate-phys | 先在你身上標出紅圈，隨後高速衝撞過來，撞上會被擊退並短暫暈眩。 |
| 26 | `blink` | 🌀 瞬影突襲 | 主動 | mark-red、burst-detonate-dark | 消失後瞬間出現在你身旁，並在落點炸出暗影衝擊。 |
| 27 | `whirlwind` | ⚔️ 旋風斬 | 主動 | mark-red、slash-wind-spin | 原地高速旋轉連斬數次，身邊一圈都在攻擊範圍內。 |
| 28 | `vortex` | 🕳️ 虛空漩渦 | 主動 | mark-blue、black-hole、burst-gravity | 在附近撕開黑洞，把你往中心拖拽，結束時整個坍縮爆發。 |
| 29 | `shield` | 🛡️ 魔法護盾 | 主動 | burst-holy | 為自己展開一層護盾（最大生命的一部分），先打破護盾才能傷到本體。 |
| 30 | `reflectshield` | 🪞 反射護罩 | 主動 | burst-detonate-phys | 短時間內將受到傷害的一部分反彈給你，罩子亮起時別硬打。 |
| 31 | `invulnaura` | 🔰 庇護光環 | 主動 | burst-holy | 讓整個群體短暫進入無敵，這幾秒打不傷任何成員。 |
| 32 | `heal` | ✨ 神聖治癒 | 主動 | pillar-light | 呼喚光柱治療整個群體（包含自己）一部分生命。 |
| 33 | `summoner` | 👥 召喚師 | 主動 | burst-detonate-dark | 召喚小兵協助戰鬥，數量有上限。 |
| 34 | `bloodsac` | 🩸 血祭 | 主動 | burst-blood | 獻祭身邊一名同伴，自己回復生命並提高攻擊力。 |
| 35 | `curse` | 🧿 衰弱詛咒 | 主動 | curse-dark | 詛咒你，使你的攻擊力與防禦力降低一段時間。 |
| 36 | `manadrain` | 💧 魔力吸取 | 主動 | proj-light-orb | 抽走你一部分法力，並用來治療自己。 |
| 37 | `regen` | 💚 再生 | 被動 | burst-holy | 持續回復自身生命，不盡快擊殺就會越打越久。 |
| 38 | `haste` | 💨 迅捷 | 被動 | （無，靠光環／數值） | 攻擊速度與移動速度大幅提高。 |
| 39 | `giant` | 🗿 巨像 | 被動 | （無，靠光環／數值） | 體型與生命大幅提升，並額外減少受到的傷害。 |
| 40 | `enrage` | 😡 狂暴 | 被動 | burst-blood | 生命降到一定比例時進入狂暴，攻擊力與攻擊速度大幅提升。 |
| 41 | `vampiric` | 🧛 嗜血 | 被動 | proj-bloodrage-drain | 每次擊中你都會把造成傷害的一部分吸成自己的生命。 |
| 42 | `thorns` | 🌵 荊棘 | 被動 | hit-phys | 你打到它時會受到一部分反震傷害。 |
| 43 | `knockback` | 🥊 擊飛 | 被動 | burst-wind | 普通攻擊有機會把你擊退一段距離並使你踉蹌。 |
| 44 | `lifelink` | ⛓️ 生命鏈結 | 被動 | （無，靠光環／數值） | 與群體中其他有鏈結的成員分攤傷害，只打一隻很難打死，要集火或打斷鏈結。 |
| 45 | `phoenix` | 🕊️ 不死鳥 | 被動 | burst-fire、pillar-light | 第一次死亡時會浴火重生，帶著一部分生命站起來。 |
| 46 | `bomber` | 💣 自爆 | 被動 | mark-red、burst-explosion-sheet | 死亡後原地留下紅圈，倒數結束就爆炸，擊殺後要馬上走開。 |
| 47 | `splitter` | 🧬 分裂 | 被動 | burst-zero-infection | 死亡時分裂成數隻較弱的分身。 |
### 每項都要檢查的共通項目

- [ ] 施放時頭上浮出「圖示＋技能名」，戰鬥日誌有一行
- [ ] 菁英頭頂常駐詞條圖示；同一群腳下有同色群組環
- [ ] 範圍技能有地面預警，倒數結束才結算；預警範圍與實際傷害範圍一致（站在邊緣內外各試一次）
- [ ] 特效沒有大小錯誤（巨球、細到看不見、位置偏離施放者／目標）
- [ ] 沒有 Console error／warning（`read_console_messages`）
- [ ] 玩家死亡或切換地圖後，場上沒有殘留的預警圈、場域或彈體

### 需要特別驗證的行為

| id | 驗證重點 |
|---|---|
| `chainlightning` | 電弧要「一段一段」飛到你身上，長度與起訖點對得上，不穿透；上次我在實機沒看到完整長度（敵人貼身），請拉開距離再測 |
| `thunderwall`／`firewall` | 牆／鎖鏈要看得見；穿過去才受傷，不是靠近就受傷 |
| `arcanebeam` | 光束預警是一串紅點沿路徑；結算時沿線的傷害範圍與預警一致 |
| `lifelink` | 同群成員之間有粉紅連線；打一隻，傷害會分攤；連線隨成員死亡消失 |
| `shield`／`reflectshield`／`invulnaura` | 有明顯顏色光環；護盾期間打不穿／反射傷害／免疫有飄字提示；結束後光環消失 |
| `summoner`／`bloodsac` | 召喚出的小兵不掉寶、不計過關配額；血祭的獻祭對象與增益看得出來 |
| `phoenix`／`bomber`／`splitter` | 死亡瞬間的重生／自爆／分裂有明顯特效；分裂體、召喚物不再分裂／不掉寶 |
| `curse` | 中詛咒後玩家攻擊與防禦**真的下降**（舊版這個狀態沒作用，現在會生效，下限 10%），狀態圖示可見 |
| `manadrain` | MP 下降且畫面有吸取線或特效 |
| `knockback`／`charge`／`whirlwind`／`blink` | 位移方向正確、不穿牆出界、衝鋒前有紅圈標示 |
| `giant` | 體型放大一次，不會每幀累加 |
| `moltenpool` | 熔岩足跡在菁英走過的位置留下，持續一段時間後消失，不會無限堆積 |

### 這批我沒在實機看過（請優先、仔細測）

被動類畫面：`bomber`、`splitter`、`phoenix`、`vampiric`（嗜血回血）、`knockback`、`thorns`，以及 `summoner`、`bloodsac`、`curse`、`manadrain`、`quake`、`shockwave`、`petrify`、`reflectshield`。這些只有單元測試。

## 3. 群組出怪測試

- [ ] **菁英關（每 10 關）**：每一波都是菁英群；每群 2～4 隻；全員菁英，或前幾隻菁英帶小兵（小兵沒有詞條圖示、血量與攻擊較低）。
- [ ] **普通關**：連續推進 30 關以上，會遇到菁英群（機率依「game_parameters → 4-菁英群組」）。記錄遇到的次數與關卡。
- [ ] 群組環：同群腳下同色環，不同群顏色不同；群成員死光後環消失。
- [ ] 改 `config/Excel/game_parameters.xlsx` 的「普通關菁英機率」為 100% 後執行「套用參數.bat」，普通關每一波都出菁英群；改回原值後恢復。（測完請還原 Excel，不要提交。）
- [ ] 改「菁英技能全域設定」的技能傷害％與冷卻％，確認傷害與施放頻率跟著變。
- [ ] 戰鬥日誌出現「菁英群出現：N 隻（全員菁英／菁英帶小兵）｜詞條…」，日誌的詞條與場上實際圖示一致。
- [ ] 場上敵人很多（約 100 隻）時，FPS 與特效是否仍可接受（已知互斥推擠迴圈是既有效能熱點，另有任務處理；記錄 FPS 即可）。

## 4. NPC 表固定技能測試

`config/Excel/NPC.xlsx` 現在是 3 列一組（normal／elite／boss）。elite 列的「技能」欄是該種菁英**固定使用**的詞條。

- [ ] 在荒漠菁英關找到「牛頭人」（`desert_11`）：它身上的詞條圖示應為衝鋒、地裂震擊、狂暴（表中順序以 NPC.xlsx 為準）；其他 NPC 各自吃自己表中的技能。
- [ ] 同一群裡出現不同 NPC 時，各自技能不同（預期行為，不是 bug）。
- [ ] 把某個 elite 列的「技能」清空 → 套用參數 → 該 NPC 的菁英改為同群隨機詞條。
- [ ] 技能欄填不存在的 id（如 `nosuchskill`）→ 套用參數必須**中止並指出第幾列**，且不能改到 `js/data.js`。
- [ ] 技能欄填 4 個，或重複填同一個 → 同樣中止。
- [ ] boss 列填技能 → 套用時只提示「已忽略」，不影響遊戲。
- [ ] 每個 elite 列的「技能特效」「備註」欄內容與實際看到的特效相符；不符的列記到問題清單（這兩欄是自動產生的唯讀說明）。
- 測完請**還原 NPC.xlsx**（`git checkout config/Excel/NPC.xlsx config/CSV/NPC.csv js/data.js`），不要提交測試用的修改。

## 5. 回歸

- [ ] `node --test "tests/*.test.cjs"` 的失敗名稱與乾淨 HEAD 比對，新增失敗應為 0（基線約 260 項既有紅燈，glob 一定要加引號）。
- [ ] 新增測試全綠：`node --test tests/elite-data.test.cjs tests/elite-groups.test.cjs tests/elite-engine.test.cjs tests/elite-params.test.cjs tests/battle-elite.test.cjs tests/npc-elite-skills.test.cjs`
- [ ] `npm run build` 通過。
- [ ] 玩家死亡→復活、切換地圖、關閉演武場後，不殘留菁英預警或場域。
- [ ] 存檔載入後不報錯（本功能不寫入存檔，預期完全無影響）。

## 6. 報告格式

`docs/ELITE_TEST_REPORT.md`：

1. 測試環境（分支、提交、瀏覽器、解析度）
2. 總表：47 列，欄位＝id／技能名／預警清楚度（清楚/勉強/看不出）／結算清楚度／截圖檔名／是否通過／備註
3. 每個技能一小節：技能說明（中文，你觀察到的）＋兩張以上截圖＋與設計說明的差異
4. 群組與 NPC 表測試結果
5. 回歸結果
6. 問題清單（必須修／建議改善），每筆附重現步驟與截圖

## 附：已知限制（不是 bug）

- 所有傷害、冷卻、半徑、機率都是我先訂的預設值，**沒有做數值平衡**；平衡問題請記在「建議改善」，不算失敗。
- `?canvas=0` 舊 DOM 戰場不畫菁英技能特效。
- 固定技能不檢查最低出現關卡（高階技能可能配給低階地圖的 NPC，是設計如此）。
- 敵人互斥推擠的 O(n²) 效能熱點是既有問題，已另開任務。
