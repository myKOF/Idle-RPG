# 不在配置表、但遊戲中有用到的 Preset

VFX Editor 的 Preset 下拉會在每個 id 後面標出「它被用在哪裡」，這樣挑 preset 時
一眼就看得出哪個特效被誰使用、哪些還是孤兒。

用途來源有兩個：

1. **配置表**（自動掃描，不必維護）
   `config/CSV/Skills2.csv`、`Status.csv` 的特效欄位。
   只要任一欄填了某個 preset id，就算那一列的技能／狀態有在用它。
2. **本檔**（人工維護）
   **程式裡寫死的** preset：普攻、天罰、敵方出手這類不屬於任何一列技能的固定對應
   （`js/data.js` 的 `VFX_COMBAT_DEFAULTS`），以及 Runtime 裡寫死的特殊處理。

**兩邊都有的時候兩邊一起顯示**：表上的技能排前面，本檔的用途接在後面。
例如 `proj-ice-shard` 會標成「水流彈·寒霜擴散、冰霜新星·極致之冰、敵方遠程·冰」。

## 規則

- 特效只存在兩種情況：**配置表填入的**，或**程式裡寫死的**。不應存在第三種情況。
- 程式裡寫死、配置表沒有用到的 preset，**一律登記**在這份清單，標出是誰在用。
- 寫死的對應**表上也有人用**時同樣要登記，否則寫死的那一邊在下拉上是隱形的。
- 不必另外標註「沒有被使用」：下拉上**沒有任何顯示**，就代表它沒有被任何地方使用。

這條規則同時寫在 `AI_RULES.md` 與各 AI 的規範檔裡。

## 為什麼要人工維護一份清單

grep 找得到「哪裡寫死了這個 id」，寫不出「是誰在用」：下拉上要顯示的是「天罰」
「冰屬性敵人的遠程攻擊」這種人看得懂的用途，只有人寫得出來。

但人工清單會過期，所以有 `tests/vfx-preset-usage.test.cjs` 夾住：

- 本檔列的每一個 id 都必須真的存在於 `vfx/presets/`（USAGE-1）
- 本檔列的每一個 id 都必須真的還在 `js/` 裡被引用（刪掉功能卻忘了刪這一列 → 轉紅，USAGE-2）
- `js/` 裡寫死、而配置表沒有的 preset，都必須列在本檔（新增寫死對應卻忘了登記 → 轉紅，USAGE-3）
- `VFX_COMBAT_DEFAULTS` 裡的每一份都必須列在本檔，**表上也有人用的一樣要列**（USAGE-3B）

也就是說：**這份清單不會靜靜地過期**，它只會在你改動的當下轉紅一次。

## 清單

「顯示標籤」就是下拉上接在 id 後面的那串字。要短——太長會把選單撐爆。
同一個 id 有不同用途時各寫一列。

| preset id | 顯示標籤 | 用在哪裡 |
| --- | --- | --- |
| `field-water-prison-dome` | 水牢天瀑罩子分層 | Status 表的水牢持續特效；`js/vfx-runtime.js` 將同一份 Preset 的地板和透明罩子拆為前後子部件播放，共用權威半徑及位置。 |
| `hit-basic-irregular` | 普攻 | 我方普通攻擊的命中爆點（含連擊的額外段） |
| `bolt-sky-lightning` | 天罰 | 神鑄特效【天罰】追加的落雷（`js/combat.js`） |
| `bolt-sky-lightning` | 雷霆過載 | 潛力技能【雷霆過載】的本體雷擊（`js/potential.js`） |
| `bolt-chain-lightning` | 雷霆過載 | 潛力技能【雷霆過載】在敵人之間跳躍的電弧 |
| `bolt-chain-lightning` | 迅雷穿刺 | 傳奇特效【迅雷穿刺】突刺命中時附加的連鎖閃電（`js/skills2.js` 呼叫 `js/legendary.js` 的 `legendaryScheduleChain`） |
| `hit-lightning` | 天罰 | 天罰落雷的命中爆點 |
| `hit-lightning` | 雷霆過載 | 潛力技能【雷霆過載】的命中爆點 |
| `hit-lightning` | 迅雷穿刺 | 傳奇特效【迅雷穿刺】連鎖的命中爆點 |
| `proj-meteor-small` | 小隕石 | 由 Runtime 依 variant 取用的小隕石投射物 |
| `hit-fire-explosion` | 小隕石 | 小隕石落地的爆點 |
| `slash-enemy-melee` | 敵方近戰 | 敵人近身攻擊的斬擊 |
| `proj-enemy-bolt` | 敵方遠程 | 無屬性敵人的遠程投射物 |
| `hit-enemy` | 敵方命中 | 無屬性敵人打中我方的爆點（近戰與遠程共用） |
| `proj-dragon-devour` | 敵方遠程·火 | 火屬性敵人的遠程投射物 |
| `proj-ice-shard` | 敵方遠程·冰 | 冰屬性敵人的遠程投射物 |
| `proj-lightning` | 敵方遠程·雷 | 雷屬性敵人的遠程投射物 |
| `proj-poison-drop` | 敵方遠程·毒 | 毒屬性敵人的遠程投射物 |
| `proj-light-orb` | 敵方遠程·光 | 光屬性敵人的遠程投射物 |
| `proj-dark-orb` | 敵方遠程·暗 | 暗屬性敵人的遠程投射物 |
| `proj-earth-rock` | 敵方遠程·地 | 地屬性敵人的遠程投射物 |
| `proj-wind-crescent` | 敵方遠程·風 | 風屬性敵人的遠程投射物 |
| `hit-fire` | 敵方命中·火 | 火屬性敵人打中我方的爆點（近戰與遠程共用） |
| `hit-ice` | 敵方命中·冰 | 冰屬性敵人打中我方的爆點 |
| `hit-lightning` | 敵方命中·雷 | 雷屬性敵人打中我方的爆點 |
| `hit-poison` | 敵方命中·毒 | 毒屬性敵人打中我方的爆點 |
| `hit-light` | 敵方命中·光 | 光屬性敵人打中我方的爆點 |
| `hit-dark` | 敵方命中·暗 | 暗屬性敵人打中我方的爆點 |
| `hit-earth` | 敵方命中·地 | 地屬性敵人打中我方的爆點 |
| `hit-wind` | 敵方命中·風 | 風屬性敵人打中我方的爆點 |
| `ground-firewall` | 火牆 | `js/vfx-runtime.js` 寫死的火牆三柱播放處理（火龍捲第 7 階在 2026-09-12 由無限火牆改成無限火龍後，技能表已經沒有任何一列填它） |
| `bolt-chain-travel-bluewhite` | 連鎖閃電彈射 | Skills2 第 1 階攻擊特效指定；`js/vfx-runtime.js` 另有此 Preset 的圖集寬度及移動端點追蹤處理 |
| `hit-thunderstrike-bluewhite` | 落雷命中 | `js/vfx-runtime.js` playRole 的受擊角色：填這份時改走 playThunderstrike（腳底錨定、跟著目標走的落雷擺法）。2026-09-18 補登記——Codex 15942105 起程式寫死了它，目前沒有任何表格填入（落雷術第 1 階的攻擊特效是 `bolt-thunderstrike-bluewhite`）。 |
| `beam-light` | 菁英秘法光束 | 菁英詞條【秘法光束】的光束本體（`js/elite_data.js` 的 arcanebeam.beamPreset，由 `js/elite.js` 播放） |
| `black-hole` | 菁英虛空漩渦 | 菁英詞條【虛空漩渦】的場域本體（`js/elite_data.js` 的 vortex.preset，由 `js/elite.js` 播放） |
| `bolt-chain-lightning` | 菁英連鎖閃電 | 菁英詞條【連鎖閃電】的落雷（`js/elite_data.js` 的 chainlightning.bolt，由 `js/elite.js` 播放） |
| `bolt-curtain-lightning` | 菁英電磁牆 | 菁英詞條【電磁牆】的場域本體（`js/elite_data.js` 的 thunderwall.preset，由 `js/elite.js` 播放） |
| `bolt-sky-lightning` | 菁英雷霆風暴 | 菁英詞條【雷霆風暴】的落雷（`js/elite_data.js` 的 lightningstorm.bolt，由 `js/elite.js` 播放） |
| `burst-blood` | 菁英血祭 | 菁英詞條【血祭】的施放光（`js/elite_data.js` 的 bloodsac.vfx，由 `js/elite.js` 播放） |
| `burst-blood` | 菁英狂暴 | 菁英詞條【狂暴】的施放光（`js/elite_data.js` 的 enrage.vfx，由 `js/elite.js` 播放） |
| `burst-detonate` | 菁英雷霆風暴 | 菁英詞條【雷霆風暴】的爆發（`js/elite_data.js` 的 lightningstorm.burst，由 `js/elite.js` 播放） |
| `burst-detonate-dark` | 菁英瞬影突襲 | 菁英詞條【瞬影突襲】的爆發（`js/elite_data.js` 的 blink.burst，由 `js/elite.js` 播放） |
| `burst-detonate-dark` | 菁英召喚師 | 菁英詞條【召喚師】的施放光（`js/elite_data.js` 的 summoner.vfx，由 `js/elite.js` 播放） |
| `burst-detonate-phys` | 菁英共用 | 3 個菁英詞條共用（震地衝擊、野蠻衝鋒、反射護罩）的爆發，見 `js/elite_data.js`，由 `js/elite.js` 播放 |
| `burst-earth` | 菁英地裂震擊 | 菁英詞條【地裂震擊】的爆發（`js/elite_data.js` 的 quake.burst，由 `js/elite.js` 播放） |
| `burst-explosion-sheet` | 菁英自爆 | 菁英詞條【自爆】的爆發（`js/elite_data.js` 的 bomber.burst，由 `js/elite.js` 播放） |
| `burst-fire` | 菁英烈焰火球 | 菁英詞條【烈焰火球】的爆發（`js/elite_data.js` 的 fireball.burst，由 `js/elite.js` 播放） |
| `burst-fire` | 菁英不死鳥 | 菁英詞條【不死鳥】的施放光（`js/elite_data.js` 的 phoenix.vfx，由 `js/elite.js` 播放） |
| `burst-fire-shockwave` | 菁英熔岩爆裂 | 菁英詞條【熔岩爆裂】的爆發（`js/elite_data.js` 的 moltenblast.burst，由 `js/elite.js` 播放） |
| `burst-fire-shockwave-small` | 菁英隕石雨 | 菁英詞條【隕石雨】的爆發（`js/elite_data.js` 的 meteor.burst，由 `js/elite.js` 播放） |
| `burst-frost-nova` | 菁英冰霜新星 | 菁英詞條【冰霜新星】的爆發（`js/elite_data.js` 的 frostnova.burst，由 `js/elite.js` 播放） |
| `burst-gravity` | 菁英虛空漩渦 | 菁英詞條【虛空漩渦】的爆發（`js/elite_data.js` 的 vortex.burst，由 `js/elite.js` 播放） |
| `burst-holy` | 菁英共用 | 3 個菁英詞條共用（魔法護盾、庇護光環、再生）的施放光，見 `js/elite_data.js`，由 `js/elite.js` 播放 |
| `burst-rock-petrify` | 菁英地裂震擊 | 菁英詞條【地裂震擊】的爆發（第二層）（`js/elite_data.js` 的 quake.burst2，由 `js/elite.js` 播放） |
| `burst-rock-petrify` | 菁英石化凝視 | 菁英詞條【石化凝視】的爆發（`js/elite_data.js` 的 petrify.burst，由 `js/elite.js` 播放） |
| `burst-wind` | 菁英擊飛 | 菁英詞條【擊飛】的施放光（`js/elite_data.js` 的 knockback.vfx，由 `js/elite.js` 播放） |
| `burst-zero-infection` | 菁英分裂 | 菁英詞條【分裂】的施放光（`js/elite_data.js` 的 splitter.vfx，由 `js/elite.js` 播放） |
| `curse-dark` | 菁英衰弱詛咒 | 菁英詞條【衰弱詛咒】的施放光（`js/elite_data.js` 的 curse.vfx，由 `js/elite.js` 播放） |
| `field-water-prison-dome` | 菁英水牢 | 菁英詞條【水牢】的場域本體（`js/elite_data.js` 的 waterprison.preset，由 `js/elite.js` 播放） |
| `ground-blizzard` | 菁英暴風雪 | 菁英詞條【暴風雪】的場域本體（`js/elite_data.js` 的 blizzard.preset，由 `js/elite.js` 播放） |
| `ground-domain-earth` | 菁英地裂震擊 | 菁英詞條【地裂震擊】的預警圈（`js/elite_data.js` 的 quake.warnPreset，由 `js/elite.js` 播放） |
| `ground-domain-fire` | 菁英熔岩爆裂 | 菁英詞條【熔岩爆裂】的預警圈（`js/elite_data.js` 的 moltenblast.warnPreset，由 `js/elite.js` 播放） |
| `ground-domain-ice` | 菁英冰霜新星 | 菁英詞條【冰霜新星】的預警圈（`js/elite_data.js` 的 frostnova.warnPreset，由 `js/elite.js` 播放） |
| `ground-firewall` | 菁英火焰鎖鏈 | 菁英詞條【火焰鎖鏈】的場域本體（`js/elite_data.js` 的 firewall.preset，由 `js/elite.js` 播放） |
| `ground-mire-lava` | 菁英熔岩足跡 | 菁英詞條【熔岩足跡】的場域本體（`js/elite_data.js` 的 moltenpool.preset，由 `js/elite.js` 播放） |
| `ground-mire-magma-10` | 菁英褻瀆領域 | 菁英詞條【褻瀆領域】的場域本體（`js/elite_data.js` 的 darkzone.preset，由 `js/elite.js` 播放） |
| `ground-mire-venom` | 菁英瘟疫毒雲 | 菁英詞條【瘟疫毒雲】的場域本體（`js/elite_data.js` 的 plaguecloud.preset，由 `js/elite.js` 播放） |
| `ground-thunder-orb` | 菁英雷光球 | 菁英詞條【雷光球】的場域本體（`js/elite_data.js` 的 thunderorb.preset，由 `js/elite.js` 播放） |
| `ground-tornado-wind` | 菁英追獵龍捲 | 菁英詞條【追獵龍捲】的場域本體（`js/elite_data.js` 的 tornado.preset，由 `js/elite.js` 播放） |
| `hit-dark` | 菁英暗影彈幕 | 菁英詞條【暗影彈幕】的命中爆點（`js/elite_data.js` 的 darkorbs.hit，由 `js/elite.js` 播放） |
| `hit-fire` | 菁英烈焰火球 | 菁英詞條【烈焰火球】的命中爆點（`js/elite_data.js` 的 fireball.hit，由 `js/elite.js` 播放） |
| `hit-ice` | 菁英冰錐齊射 | 菁英詞條【冰錐齊射】的命中爆點（`js/elite_data.js` 的 iceshards.hit，由 `js/elite.js` 播放） |
| `hit-lightning` | 菁英閃電矛 | 菁英詞條【閃電矛】的命中爆點（`js/elite_data.js` 的 lightningspear.hit，由 `js/elite.js` 播放） |
| `hit-lightning` | 菁英連鎖閃電 | 菁英詞條【連鎖閃電】的命中爆點（`js/elite_data.js` 的 chainlightning.hit，由 `js/elite.js` 播放） |
| `hit-phys` | 菁英荊棘 | 菁英詞條【荊棘】的命中爆點（`js/elite_data.js` 的 thorns.hit，由 `js/elite.js` 播放） |
| `hit-poison` | 菁英劇毒吐息 | 菁英詞條【劇毒吐息】的命中爆點（`js/elite_data.js` 的 poisonspit.hit，由 `js/elite.js` 播放） |
| `hit-wind` | 菁英旋風刃 | 菁英詞條【旋風刃】的命中爆點（`js/elite_data.js` 的 windblades.hit，由 `js/elite.js` 播放） |
| `mark-blue` | 菁英共用 | 6 個菁英詞條共用（雷霆風暴、石化凝視、暴風雪、電磁牆、水牢、虛空漩渦）的預警圈，見 `js/elite_data.js`，由 `js/elite.js` 播放 |
| `mark-red` | 菁英共用 | 10 個菁英詞條共用（隕石雨、震地衝擊、瘟疫毒雲、褻瀆領域、火焰鎖鏈、秘法光束、野蠻衝鋒、瞬影突襲、旋風斬、自爆）的預警圈，見 `js/elite_data.js`，由 `js/elite.js` 播放 |
| `pillar-light` | 菁英神聖治癒 | 菁英詞條【神聖治癒】的施放光（`js/elite_data.js` 的 heal.vfx，由 `js/elite.js` 播放） |
| `pillar-light` | 菁英不死鳥 | 菁英詞條【不死鳥】的施放光（第二層）（`js/elite_data.js` 的 phoenix.vfx2，由 `js/elite.js` 播放） |
| `proj-bloodrage-drain` | 菁英嗜血 | 菁英詞條【嗜血】的彈體（`js/elite_data.js` 的 vampiric.proj，由 `js/elite.js` 播放） |
| `proj-dark-orb` | 菁英暗影彈幕 | 菁英詞條【暗影彈幕】的彈體（`js/elite_data.js` 的 darkorbs.proj，由 `js/elite.js` 播放） |
| `proj-fireball` | 菁英烈焰火球 | 菁英詞條【烈焰火球】的彈體（`js/elite_data.js` 的 fireball.proj，由 `js/elite.js` 播放） |
| `proj-ice-shard` | 菁英冰錐齊射 | 菁英詞條【冰錐齊射】的彈體（`js/elite_data.js` 的 iceshards.proj，由 `js/elite.js` 播放） |
| `proj-light-orb` | 菁英魔力吸取 | 菁英詞條【魔力吸取】的彈體（`js/elite_data.js` 的 manadrain.proj，由 `js/elite.js` 播放） |
| `proj-lightning` | 菁英閃電矛 | 菁英詞條【閃電矛】的彈體（`js/elite_data.js` 的 lightningspear.proj，由 `js/elite.js` 播放） |
| `proj-meteor-small` | 菁英隕石雨 | 菁英詞條【隕石雨】的落下的彈體（`js/elite_data.js` 的 meteor.fall，由 `js/elite.js` 播放） |
| `proj-poison-drop` | 菁英劇毒吐息 | 菁英詞條【劇毒吐息】的彈體（`js/elite_data.js` 的 poisonspit.proj，由 `js/elite.js` 播放） |
| `proj-wind-crescent` | 菁英旋風刃 | 菁英詞條【旋風刃】的彈體（`js/elite_data.js` 的 windblades.proj，由 `js/elite.js` 播放） |
| `slash-phys-big` | 菁英野蠻衝鋒 | 菁英詞條【野蠻衝鋒】的撞擊命中（`js/elite_data.js` 的 charge.impact，由 `js/elite.js` 播放） |
| `slash-wind-spin` | 菁英旋風斬 | 菁英詞條【旋風斬】的爆發（`js/elite_data.js` 的 whirlwind.burst，由 `js/elite.js` 播放） |
| `cast-buff-dark` | 菁英施法光 | 菁英每次施放詞條時自身的施法光（`js/elite.js` eliteSelfPulse 預設） |

菁英詞條（2026-10-07）：上面接在最後的 `菁英…` 列全部來自 `js/elite_data.js` 的 `ELITE_AFFIXES`（預警圈、爆發、彈體、場域、命中爆點、光束），由 `js/elite.js` 以 `variant: elite-*` 的事件送出，`js/vfx-runtime.js` 的 `collectPresetIds` 靠 `ELITE_VFX_PRESETS` 預載。新增或改掉詞條的特效時，同一個 Commit 內更新這幾列。

除了 `js/vfx-runtime.js` 那三列與 `菁英…` 各列，上面全部來自 `js/data.js` 的
`VFX_COMBAT_DEFAULTS`（2026-09-03 建立，目錄來源是 `tools/vfx/authoring/vfx-catalog.cjs` 的
`COMBAT_DEFAULTS`）。各組是誰在用：`basicAttack` 在 `js/combat.js`（普攻）、`smite` 在
`js/combat.js`（神鑄特效天罰）、`chainLightning` 在 `js/potential.js`（雷霆過載）、
`legendaryLightningChain` 在 `js/legendary.js`（傳奇【迅雷穿刺】的連鎖閃電）、敵方的幾組經由 `vfxEnemyRoles()` 在 `js/combat.js`、
`meteorSmall` 由 Runtime 依 variant 取用。

### 更新紀錄

- **2026-09-09**：普攻原本掛 `slash-phys-big`（斬擊本體）＋ `proj-swordwave`（飛出的劍氣）＋
  `hit-phys`，後來整組換成單一的命中爆點，爆點本身又從 `hit-basic-burst` 換成
  `hit-basic-irregular`（兩次都是 USAGE-2／3 抓到的）。`slash-phys-big` 與 `proj-swordwave`
  因此變成孤兒——preset 檔還在，但遊戲裡已經沒有人用。
- **2026-09-14**：使用者回報敵方的冰片子彈在遊戲裡到處都是，下拉上卻沒標。原因是舊規則
  「表上有人用就不必登記，而且表上有的就不顯示本檔」——`proj-ice-shard` 被水流彈與冰霜新星的
  階段用到，冰屬性敵人那一邊就整個隱形。同樣被吃掉的還有毒／風的敵方投射物、七種屬性的
  敵方爆點、小隕石的爆點與兩種連鎖電擊。規則改成兩邊一起顯示，這些全部補登記，由 USAGE-3B 守住。
  同時把 `bolt-sky-lightning` 的「天罰／連鎖閃電」更正為「天罰／雷霆過載」：
  `chainLightning` 那一組是潛力技能雷霆過載在用，不是技能表上的【連鎖閃電】。
- **2026-09-14 補充**：同一天一度把 `ground-firewall` 放進另一段「程式有引用、但不算用途」，
  讓它在下拉上顯示成孤兒。使用者指正：特效只存在兩種情況——配置表填入的、程式裡寫死的，
  寫死的都必須寫在清單裡，才能一眼看出哪個特效被誰使用。已改回清單並拿掉那一段。
  使用者並說明：不必另外標註「沒有被使用」，下拉上沒有任何顯示就代表沒有被使用。
- **2026-09-29**：使用者回報下拉上標著「傳說連鎖閃電」，但遊戲裡查遍特效也沒有這個名字——
  那不是任何東西的名稱，是當初在文件上取的描述。實際在用的是兩個**傳奇特效**：
  【閃電飛越】（施放魔法技能時觸發）與【迅雷穿刺】（突刺命中時附加），兩者走同一條
  `legendaryScheduleChain`（2026-09-29 舊版技能移除後【閃電飛越】已刪，只剩【迅雷穿刺】）。使用者要求「用在傳說特效就顯示傳說特效的名稱」，因此
  `bolt-sky-lightning`／`bolt-chain-lightning`／`hit-lightning` 三列拆成一個使用者一列，
  標籤一律採 `Equipment_Affix.csv`（傳奇／神鑄特效）與 `Skills.csv`（潛力技能）上的名稱。
  由 USAGE-17 守住：「用在哪裡」講了是哪一種來源，標籤就必須是那張表上的名稱本身，
  設計師改名時當場轉紅。

## 格式規定（測試會檢查）

- 表格只有三欄，順序固定：id、顯示標籤、用在哪裡。
- id 一律用反引號包起來，不加副檔名。
- 顯示標籤不得含有括號（半形或全形）或逗號——它會被塞進 `「<id>（<標籤>）」` 這個字串裡。
- 同一個 id 有不同用途時各寫一列，兩列的標籤不要一樣。

## 新增一筆的時機

在 `js/` 裡新增一個「寫死的 preset」的時候——**不管表上是不是也有人在用**。
如果那個對應**應該**填在表上，正確的做法是去填表，不是登記到這裡；
本檔是給「結構上沒有欄位可填」的情況用的，不是給偷懶用的。
