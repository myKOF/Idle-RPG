# VFX_RUNTIME_ADAPTER.md

# VFX Preset 化：設計定案與交接（2026-09-03，進行中）

適用範圍：`docs/vfx/VFX_AGENT_WORKFLOW.md` §1.1（本任務套用 VFX 工作流；Claude＝Lead Engineer）。
本文件記錄「用 VFX 編輯器重做全部戰鬥特效」的架構決策、目前進度與尚未完成的工作，
讓換機器或換對話之後能直接接手。Core／Preset 規格見 `VFX_CORE_AND_PRESET_SCHEMA.md`。

---

# 0. 需求（使用者 2026-09-03）

1. 用現有的 VFX 特效編輯器重做遊戲現有的全部特效。
2. 技能表新增多個特效欄位（攻擊特效、飛行子彈、受擊特效、地板特效…），該技能用到的特效都寫上檔名，之後由使用者自行更換。
3. 狀態的特效也寫在 Status 表。

真正要解決的是：**特效的「長相」要變成資料（Preset 檔），且由表格決定哪個技能用哪個檔**；
行為與時序（飛多久、落在哪、跟著誰）仍由模擬層決定，兩層分離才不會改一個檔名就改動命中時序（AI_RULES 8.3）。

---

# 1. 架構

```
模擬層（Worker）                         主執行緒
skillVfxSpec / sgEmitVfx ──vfx 事件──▶ ui.js ──▶ BattleRenderer.onVfx
  spec.fxKind/variant/travelMs/area           │
  spec.vfx = { cast, attack, projectile,      ├─ 有 spec.vfx 且主要角色有 preset → VFXRuntime（新，js/vfx-runtime.js）
               hit, ground }                  │      VFXCore + VFXPixiBackend，掛在 S.layers.zone（ground）與 S.layers.fx（其餘）
   ↑ 值來自表格：                              └─ 否則 → 既有的程式畫法（js/battle-renderer.js 各 spawn*；不刪，作為退回）
   Skills.csv 五欄 → sk.vfx
   Skills2.csv 每列五欄 → tiers[i].vfx / ult[i].vfx
   Status.csv 三欄 → st.vfx
```

## 1.1 角色（欄位）語意

| 欄位 | 鍵 | 語意 | Runtime 怎麼放 |
| --- | --- | --- | --- |
| 施放特效 | `cast` | 施放當下在施法者身上（自身增益光環、施法閃光；`drain` 命中時的回流也走這格） | 玩家腳底，跟隨玩家 |
| 攻擊特效 | `attack` | 攻擊本體：斬擊弧、範圍爆發、光束、天降雷柱、敵身詛咒符文、自身護罩 | 依 fxKind：目標身上／範圍中心（scale＝area.r/100）／從玩家沿方向（scaleX＝距離/200）／著地點 |
| 飛行子彈 | `projectile` | 會移動的東西：投射物、連鎖跳段、天降落體、環繞體 | Runtime 用 `setTransform` 逐幀移動；朝 +X 繪製 |
| 受擊特效 | `hit` | 傷害落到目標那一刻的爆點 | 目標身體中心；強力版 scale 1.6 |
| 地板特效 | `ground` | 持續場域：泥沼、火牆、暴風雪、軌道環、落點預警 | zone 層（敵人之下）；圓形 scale＝area.r/100、矩形 scaleX＝w/200、scaleY＝h/100、rotation＝area.a；由 area.id 合併與延長 |
| 施加特效 | `apply` | 狀態第一次出現（狀態表） | 目標身上一次 |
| 持續特效 | `aura` | 狀態存在期間循環（狀態表） | 由 5Hz 快照 reconcile，跟隨實體 |
| 作用特效 | `tick` | 持續傷害每跳（狀態表） | 事件 `{ vfx: { hit } }`，同一拍合併 |

各 fxKind 的**主要角色**（沒有就整則退回舊畫法）：projectile→projectile、slash／strike→attack、burst→attack、
beam→attack、rain→projectile 否則 attack、aura→ground、selfBuff→cast、curse→attack、chain→projectile 否則 attack（拉長成段）、
impact→hit、enemy-attack→attack（近戰）／projectile（遠程）。
變體特例：impact/`pillar` 視為 ground 場域；impact 或 burst/`wind-burst` 用 attack 於 area；impact/`smite` 用 attack（天雷）於目標；`starfall-impact` 只做受擊回饋。

## 1.2 名目尺寸（Preset 以此繪製，Runtime 依實際幾何縮放）

hit／cast／curse：目標身高 60px、主體約 40px；burst／ground 圓形：半徑 100px；ground 矩形：200×100（火牆 200×40、雷幕 200×20）；
beam／chain 段：沿 +X 長 200px；projectile：朝 +X、主體約 40px（火球、隕石另註）；bolt：從 y=-500 落到原點；
orb（環繞體）：半徑 20px（scale＝area.orbR/20）；status aura：腳底原點、身高 60px。

## 1.3 Skills2 的「列」怎麼決定

每一發特效屬於表上的某一列。發送端在 `extra` 標明：

| 欄位 | 意義 |
| --- | --- |
| `vfxTier` 1..7 | 第幾階引入的畫面（留白＝第 1 階＝技能本體） |
| `vfxUlt` 超神 id | 超神選項那一列 |
| `vfxGid` | 借另一個群組的列（迴旋斬的傳奇【旋風劍舞】借真空斬 T4 的真空迴旋） |
| `vfxRoles` | 直接指定角色表（狀態每跳：`statusVfxRoles(sid, 'tick')`） |

`sgVfxRoles(gid, extra)` 解析成角色表；場域（`sgSpawnGround` cfg）、環繞（`sgSpawnOrbitField` cfg）、天降佇列（`sgQueueMeteor` extra）
把這三個標記存在各自的物件上，`sgGroundVfxSpec`／`sgOrbitEmitVfx`／`sgTickMeteors` 再帶出去。

---

# 2. 進度

## 已完成（已提交或本次提交）

- Core：`setTransform`、`play({scaleX, scaleY})`（commit 207138d）。
- 參數表：`tools/config_tables.cjs` Skills／Skills2 五欄、Status 三欄（回寫成 `vfx` 物件、整列留白不寫）；三張 CSV／xlsx 已重生並依目錄填值（Skills 80 列、Skills2 105 列、Status 80 列）；`--apply` 往返語意變更 0。
- 發送端：`skillVfxSpec` 帶 `sk.vfx`；`sgVfxRoles` ＋ `sgEmitVfx`／`sgEmitPlayerVfx` 帶 `spec.vfx`；場域／環繞／天降佇列帶列標記；`statusVfxRoles`。
- 協議 v26：VFX 事件可選欄位 `vfx`（protocol.js、WORKER_PROTOCOL.md、worker-protocol.test）。
- Preset：受擊家族 13 份（`hit-*`），素材已匯出（`images/vfx/assets`、`vfx/shipped-assets.json`）。
- 製作工具與盤點資料進 repo：`tools/vfx/authoring/`、`scratch/vfx-inventory/`。

## 尚未完成（依序）

1. **emit 點補列標記**（js/skills2.js，約 70 處）——對照表見第 3 節。沒補的話所有事件都讀第 1 階那一列。
2. **其餘 133 份 Preset**——目錄 `tools/vfx/authoring/vfx-catalog.cjs` 的 `PRESETS`（家族：slash 11、proj 22、bolt/beam/pillar 8、burst 16、ground/orb/aura/mark 32、cast/curse 11、status 36）。製作腳本範例 `author/hits.cjs`。做完跑 `node tools/vfx/export-assets.cjs`。
3. **目錄修正後重填表格**（第 4 節），然後 `node tools/vfx/authoring/fill-vfx-cells.cjs` → `node tools/config_tables.cjs --apply --write`。
4. **Runtime Adapter** `js/vfx-runtime.js`：兩個 Core runtime（zone／fx 各一）、production resolver＝`VFXCore.createIndexResolver(shippedAssets, 'images/vfx/assets')`、開機預載表格引用到的所有 preset（fetch `vfx/presets/<id>.json`）、`tryPlay(spec, ctx)`（依 1.1 的角色規則；缺主要角色回 false）、`update(dt)`（tickWorld 呼叫）、`syncStatuses(entities)`（aura reconcile）、`clear()`；`?vfx=legacy` 強制舊畫法。`battle-renderer.js`：`onVfx` 先問 `VFXRuntime.tryPlay`；`syncBattle` 對每個 `field.monsters[i]` 與 `field.player` 用 `statusEntries()` 算出 sid 集合交給 reconcile；`init` 掛容器與預載。預算：fx `{maxActiveEffects:160, maxParticles:2400}`、ground `{40, 1200}`（HARD_LIMITS 內）。
5. **狀態 tick 掛鉤**：`js/combat.js tickStatuses` 在 `seconds > 0 && d.dps > 0` 處收集 (targetId, sid)，每個模擬步驟合併成一則 `{ fxKind:'impact', variant:'status-tick', vfx: statusVfxRoles(sid,'tick'), targets }`（≤8 目標；skills2 自己的 sgTickBurn／sgTickFrost／sgTickBloodDots 已有 emit，改帶 `vfxRoles`，不重複）。
6. **普攻／敵方／潛力**：`js/data.js` 新增 `VFX_COMBAT_DEFAULTS`（值見 catalog `COMBAT_DEFAULTS`），`combat.js` 普攻／天罰／敵方攻擊事件帶 `vfx`；`legendary.js`／`potential.js` 的 chain 事件帶 `vfx`。
7. **載入與版號**：index.html 載入 `js/vfx-core.js`、`js/vfx-pixi-backend.js`、`js/vfx-runtime.js`（在 battle-renderer 之前），改到的 js 都 bump `?v=`。
8. **測試**：`tests/vfx-catalog.test.cjs`（表格引用的 preset 都存在、shipped-assets 最新）、`tests/vfx-runtime.test.cjs`（角色選擇／退回／移動／狀態 reconcile，以 NullBackend）、參數表往返含新欄位。
9. **文件**：`VFX_CORE_AND_PRESET_SCHEMA.md` §6／§8／§9（Adapter 已接上）、`VFX_AGENT_WORKFLOW.md` §2 現況表、AI_TASKS、PATCH。Editor 加 preset 下拉（server `/__presets` 路由 ＋ topbar `<select>`）方便使用者在 150 份 preset 間切換。
10. 目視 QA：以 Editor 抽樣截圖各家族，實機（8331）觀察普攻、火球、隕石、火牆、狀態光環。

已知範圍限制：高塔（DOM 路徑 `js/vfx.js`）沒有 Pixi，本輪不播 Preset，維持舊畫法；之後可在高塔 `.battle-scene` 疊一層透明 Pixi 畫布再接同一個 Adapter。

---

# 3. emit 點列標記對照表（js/skills2.js；行號為 2026-09-03 盤點時的位置，以函式名為準）

未列出的 emit＝第 1 階（不必標）。`vfxRoles` 的狀態每跳用 `statusVfxRoles(sid, 'tick')`。

| 函式／位置 | 變體 | 標記 |
| --- | --- | --- |
| sgCastThrust 1919 | thrust／-parallel／-pierce／-octagonal | `vfxTier: octagonal?7 : pierce?6 : parallel?4 : 1` |
| sgCastCleave 2144 | cleave／-shockwave／-cross-shockwave | `vfxTier: cross?7 : isFlying?6 : 1` |
| sgCleaveWhirlwind 2010 | wind-spin | `vfxGid:'vacuumslash', vfxTier:4` |
| sgSpawnGround 'cleave' 2022（windtornado） | — | cfg `vfxUlt:'windChaser'` |
| sgSpawnGround 'gale' 2519（windtornado，傳奇風捲殘雲） | — | cfg `vfxGid:'cleave', vfxUlt:'windChaser'` |
| sgKnifeBounceChain 2308 | knife-bounce／knife-soulhunter | bounce `vfxTier:3`；soulhunter `vfxUlt:'soulhunterBlade'` |
| sgKnifeSplit 2339 | knife-bounce | `vfxTier:3` |
| sgKnifeSoulhunter 2387／2398 | knife-soulhunter | `vfxUlt:'soulhunterBlade'` |
| sgSpawnOrbitField 'knife' 2354（輪舞刃 void-disc） | — | cfg `vfxGid:'vacuumslash', vfxTier:7` |
| sgGaleThunderBolt 2533 | thunder-strike | `vfxUlt:'thunderGodSlash'` |
| sgGaleThunderFlash 2658 | thunder-burst | `vfxUlt:'thunderFlash'` |
| sgBloodbladeSlash 2707 | curse/bleed | `vfxTier:2` |
| sgBloodbladeSlash 2712 | curse/poison | `vfxTier:4` |
| sgDisintegrate 1245 | blood-explosion | `vfxUlt:'disintegrate'` |
| sgCastDualdance 2761／2805 | dual-storm／cyclone | storm 分支 `vfxTier:7` |
| skills2TryDeathDefer 2891 | cyclone | `vfxTier:7` |
| sgTickAsuraFist 9508 | bloodrage-aura | `vfxUlt:'asuraFist'` |
| sgCounterOnPlayerDamaged 9137 | armor-break | `vfxTier:5` |
| sgCounterWindBlade 9370 | wind-blade-homing（projectile） | `vfxGid:'windblade', vfxTier:1` |
| sgCounterHolyOrb 9388 | burst | `vfxUlt:'holyBody'` |
| skills2TryLastStand 9421／9433 | burst earth／rock-armor | `vfxUlt:'indomitable'` |
| sgTickLastStand 9483 | rain/pillar | `vfxGid:'earthguard', vfxUlt:'worldRebirth'` |
| sgQueueFireballSplitProjectiles 3249／3253 | fireball-small／fire-explosion | `vfxTier:3` |
| sgBurnBlast 3079 | fire-blast | `vfxTier:5` |
| sgTickBurn 3136 | burn-tick | `vfxRoles: statusVfxRoles('sgBurn','tick')` |
| sgCastFireball 3422（rain meteor）＋ sgQueueMeteor 3438 | meteor | `vfxTier:7`（兩處） |
| sgFireballPhoenixBalls 3336／3340 | fireball-small rain＋queue | `vfxUlt:'phoenixPrairie'` |
| sgFirehuntLaunch 4706／4710 | fireball-small／fire-explosion | `vfxGid:'fireball', vfxTier:3` |
| sgTickStarfall 9627／9637、sgStarfallImpact 9674 | starfall-* | `vfxUlt:'starfallCataclysm'` |
| sgSpawnGround 'firepillar' 3541（pillar） | — | cfg `vfxTier:1`；wall（T7）`vfxTier:7`；firepool trail（永劫火獄）`vfxUlt:'eternalInferno'` |
| sgGroundExpire 4054 | firepillar-impact | `vfxTier:5` |
| sgFirehuntDetonate 4575 | firehunt-detonate | `vfxTier:1`（attack＝burst-fire） |
| sgTickFireGod 4746、skills2OnBasicAttack 4817 | follow-aura／firehunt-ring | `vfxUlt:'fireGodDescend'` |
| sgRockFieldAura 4939 | follow-aura | `vfxUlt: 選中的超神（superRockArt／gravityField）` |
| sgRockPetrifyApply 4956 | rock-petrify | `vfxUlt:'superRockArt'` |
| sgRockGravityApply 4972 | gravity-field | `vfxUlt:'gravityField'` |
| sgRockOnPlayerDamaged 5159 | rock-spike | `vfxTier:3` |
| sgMireGroundTick 5322 | mire 系列 | `vfxTier: lava?7 : poison?3 : 1`（sgSpawnGround 'mire' 5236／5385 的 cfg 同邏輯） |
| sgMireInfernoTick 5369（lavapillar） | pillar | cfg `vfxUlt:'abyssInferno'` |
| sgEarthguardReflect 5683 | earth-reflect | `vfxTier:6` |
| skills2TryRebirth 5781 | rain/pillar | `vfxTier:7` |
| sgEarthguardRebirthEnemy 5851 | rain/pillar | `vfxUlt:'worldRebirth'` |
| sgChainlightningBolt 5976 | thunder-burst | `vfxTier:5` |
| sgChainlightningBolt 5988 | lightning-relay | `vfxTier:6` |
| sgChainOverload 6023 | thunder-burst | `vfxTier:5` |
| sgChainSuperconductor 6056／6063 | lightning-relay／lightning-chain | `vfxUlt:'eternalSuperconductor'` |
| sgTickFlyingThunder 6131／6135 | lightning-chain／thunder-burst | `vfxUlt:'flyingThunderGod'` |
| sgTickHeavenTribulation 6424 | thunder-strike | `vfxUlt:'heavenTribulation'` |
| sgThunderMatrix 6372（thunderwall） | — | cfg `vfxUlt:'thunderMatrix'` |
| sgCastThunderorb 6534（orbit） | thunder-orbit | cfg `vfxTier:4` |
| sgDropThunderfall 6594／6598 | thunder-fall＋queue | `vfxTier:7` |
| sgThunderorbBurst 6671 | thunder-burst | `vfxUlt:'thunderBurst'` |
| sgSpawnThunderOrb 6715／sgSpawnStationaryThunderOrb 6727 | thunder-orb | cfg `vfxTier:1`／`vfxTier:6` |
| sgFreezeTarget 6914 | frost-freeze | `vfxGid:'frostnova', vfxTier:4` |
| sgTickFrost 7017、sgTickAbyssDomain 7747 | frost-tick | `vfxRoles: statusVfxRoles('sgFrostBite','tick')` |
| sgSpreadFrost 7040 | frost-spread | `vfxTier:5` |
| sgIceBlast 7059 | ice-blast | `vfxTier:7` |
| sgCastIcearrow 7201 | ice-arrow-pierce | `vfxTier:4` |
| sgCastIceTears 7325（icerain） | — | cfg `vfxUlt:'tearsOfIce'` |
| sgCastIcearrow 7341（homing ground） | — | cfg `vfxTier:5` |
| sgWaterballShot 7532／7550 | water-burst／frost-nova／water-bounce | `vfxTier:4` |
| sgSpawnWaterTornadoes 7593／7608 | tornado | cfg `vfxTier:7`；sgTickRagingTide 7701 `vfxUlt:'ragingTide'` |
| sgTickWaterPrison 7649 | follow-aura | `vfxUlt:'waterPrisonFall'` |
| sgTickAbyssDomain 7725 | follow-aura | `vfxUlt:'abyssBurial'` |
| sgSpawnIceSpike 7914 | icespike | cfg `vfxUlt:'iceKingDomain'` |
| sgSpawnBlizzard 7930 | blizzard | cfg `vfxTier:7` |
| sgFrostbodyOnPlayerDamaged 7980 | frost-body | `vfxTier:3` |
| sgTickCrystalResonance 8034 | frost-spread | `vfxUlt:'crystalResonance'` |
| sgLaunchWindBlade 8362 | wind-blade／-small | windblade：`vfxTier: cfg.small?4:1`；vacuumslash 傳奇小風刃：`vfxGid:'windblade', vfxTier:4`；stormbarrier T4：`vfxTier:4`；森羅萬象／天穹崩裂的風刃：`vfxGid:'windblade', vfxTier:1` |
| sgSpawnWindChaser 8392 | wind-blade-homing | cfg `vfxTier:5`（主刀走暴風萬刃時 `vfxUlt:'stormMyriad'`） |
| sgCastVacuumslash 8625 | wind-slash／wind-spin | `vfxTier: spin?4:1` |
| sgSpawnStaticVacuum 8687 | vacuumfield | cfg `vfxUlt:'vacuumOmen'` |
| sgSpawnVoidDiscs 8726 | void-disc | vacuumslash cfg `vfxTier:7`；stormbarrier `vfxUlt:'myriadPhenomena'` |
| sgTickSkyfallStars 8793／8800 | thunder-fall／meteor＋queue | `vfxUlt:'skyfallStars'` |
| sgCastStormbarrier 8865 | storm-god | `vfxTier:7` |
| sgStormBarrierPulse 8952／8978 | storm-rip／wind-rend | `vfxTier:2`／`vfxTier:3` |
| sgSpreadWindRend 9061 | wind-rend-spread | `vfxTier:5` |
| stormbarrier T4 風刃 9015 | wind-blade | `vfxTier:4` |
| sgTickBloodDots 9790／9805／9819 | poison-spread／bleed-tick／zero-infection | `vfxTier:5`／`vfxRoles: statusVfxRoles(sid,'tick')`／`vfxTier:7` |
| sgEmitBloodDomainAura 9880、sgVenomDomainPulse 9904 | mire／curse poison | `vfxUlt: poison?'venomDomain':'slayerDomain'`／`vfxUlt:'venomDomain'` |
| sgBloodFieldsOnDeath 9945／9955 | poisonmist／bloodmist | cfg `vfxGid:'mire', vfxTier:3`／`vfxGid:'mire', vfxTier:1` |
| sgDeathBoom 10040 | blood-explosion | `vfxTier:6`（另注意：targets 為空，需 preserveDeadTargets 才有錨點） |
| sgGroundPulse 4099、sgProjectilePulse 1604 | wind-burst | `vfxGid:'windblade', vfxTier:6` |

---

# 4. 目錄（vfx-catalog.cjs）待修正的對應

填表前先改目錄再重跑 `fill-vfx-cells.cjs`：

- bloodblade T1 改為 `{ attack:'slash-bloodblade', hit:'hit-bleed' }`（移除 cast）；T2 強化流血改為 `{ attack:'curse-bleed', hit:'hit-bleed' }`（流血詛咒走 T2 列）。
- fireball T3 火球爆裂補 `attack:'burst-fire'`（爆炸本體）。
- earthguard T7 天地共生改為 `{ attack:'pillar-light', hit:'hit-light' }`（rain 的主要角色是 attack，不是 cast）。
- counter ult indomitable 移除 `cast:'pillar-earth'`（復活光柱借 earthguard／worldRebirth 那一列）。
- `COMBAT_DEFAULTS` 補 `meteorSmall:'proj-meteor-small'`（隕石的小隕石由 Runtime 依 variant 取用）。

---

# 5. 驗證重點（給 Antigravity）

- 參數表往返：`node tools/config_tables.cjs --apply` 語意變更 0；Excel 開啟 Skills／Skills2／Status 可見新欄與說明頁。
- 舊版畫法零回歸：目前 Runtime Adapter 尚未接上，事件多帶 `vfx` 欄位不應改變任何畫面；實機 8331 普攻／技能／狀態顯示與前一版相同、console 無錯誤。
- Editor：`啟動VFX編輯器.bat hit-fire` 等 13 份受擊特效可開啟、可播放、存檔後 byte 不變。
