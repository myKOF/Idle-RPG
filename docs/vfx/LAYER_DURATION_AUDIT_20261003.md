# 技能特效圖層時長稽核（2026-10-03）

明確的時長誤填是生命反射之盾 `beam-light/glow`：原25秒，另外兩層各0.25秒，相差100倍。使用者已自行修正為0.25秒，根時長也已同步。其餘檔案未發現同樣明確的孤立長秒數誤填；以下把時長差較大、粒子尾段與長循環都列出，保留給美術判斷。本次不改其他特效。

## 範圍與判讀方式

- 掃描 `vfx/presets/*.json` 全243份、1,610層，包含尚未引用的83份。技能／狀態CSV及程式寫死用途登錄共引用160份，以 `tools/vfx/preset-usage.cjs` 追溯名稱。
- 檢查各層duration、省略duration時的根預設值、delay、父層限制、enabled、loop、粒子lifetime與發射方式；總演出時長按正式Core的 `derivePresetDuration` 推算。3層停用、1層為不繪圖空物件，排除實際畫面長度比較。
- 寬鬆篩選：最長啟用繪圖層至少是最短的2倍，且差至少0.5秒。共24份；另檢查所有粒子lifetime、≥10秒的層及≥1秒的延遲。這是候選清單，不能單憑比值就認定錯誤。
- 更接近「一層比大部分其他層長很多」的篩選（對比排序後下中位數、至少2倍且差≥0.5秒）只剩burst-earth與field-dragon-devour。其他候選通常是閃光很短、主體／尾段較長。
- duration是粒子**發射時間**，lifetime是每顆粒子的**存活時間**，兩者需分開；循環層duration通常是動畫週期，不能當成實際場域壽命。檢查未發現非有限數、負數或超過Core 60秒上限的圖層duration。
- 本次是配置與程式時間軸稽核，未逐份播放243個效果評估觀感。「合理」為用途與資料支持的判讀，並非企劃原意的保證；3秒飛刀尾跡尤其值得實機看密集射擊。

## 明確異常（已修正）

| 技能 | Preset／圖層 | 原設定 | 其他層 | 目前 |
|---|---|---:|---:|---:|
| 大地守護·生命反射之盾 | beam-light／glow | 25秒 | body、core各0.25秒 | 全三層0.25秒 |

此光暈可讓一次性反射長時間疊加。Runtime另補同源／同目標正在播放的反射合併、玩家或目標死亡／離場回收；設定換名仍依反射事件語意處理。這是演出保護，不變更每次反射的傷害。

## 相對大部分圖層較長的兩份

| 技能 | Preset／較長層 | 時長 | 其他層 | 判讀 |
|---|---|---:|---|---|
| 反擊·不屈鬥魂 | burst-earth／dust、rocks | 0.8秒 | rim 0.15秒、flash 0.2秒 | 塵土與碎石延續閃光之後，未見誤填；rocks一次噴出，粒子存活0.4～0.65秒 |
| 火龍捲·融火之心 | field-dragon-devour／dark-core | 8秒 | smoke兩層4秒；inflow／fire-ring 2秒；core-ember 1秒 | 根loop=true，其他層loop=true，以不同週期循環；核心是完整場域背景，不能把1秒循環當作只播1秒 |

## 全部24份寬鬆篩選候選

數值為圖層duration，粒子尾段另列；未引用表示當前表格及用途登錄都沒有引用。

| Preset | 使用技能／用途 | 較長圖層 | 最長／最短（秒） | 判讀 |
|---|---|---|---|---|
| bolt-sky-purple | 疾風迅雷·雷神之怒、落雷術·雷霆天劫 | glow | 0.65／0.08 | 0.08是短促噴出水滴，實際水滴還活0.45～0.75秒；雷光非孤立超長 |
| burst-earth | 反擊·不屈鬥魂 | dust、rocks | 0.8／0.15 | 塵土／碎石尾段，見上表 |
| burst-fire-shockwave-small | 未引用 | tongues、smoke | 0.9／0.25 | 火焰煙霧延續閃光，粒子最長2秒 |
| burst-fire-shockwave | 火球術·地爆天星、火龍捲·烈焰衝擊、暴風屏障·天穹崩裂 | glow、ball | 2／0.9 | 波浪1.8秒、flash 1秒，多層均約2秒；屬整體較長演出，非單層誤填 |
| burst-fire | 火球術、火龍捲·烈焰暴風、火狩 | tongues、ember-puff | 0.9／0.22 | 火焰與餘燼長於瞬間閃光 |
| cast-buff-dark | 未引用 | ring、ring-inner、glow、motes | 0.9／0.2 | 大部分層0.9秒，只有flash短 |
| cast-buff-def | 未引用 | ring、ring-inner、glow、motes | 0.9／0.2 | 同上 |
| cast-buff-light | 未引用 | ring、ring-inner、glow、motes | 0.9／0.2 | 同上 |
| cast-buff-phys | 未引用 | ring、ring-inner、glow、motes | 0.9／0.2 | 同上 |
| cast-buff-special | 未引用 | ring、ring-inner、glow、motes | 0.9／0.2 | 同上 |
| field-dragon-devour | 火龍捲·融火之心 | dark-core | 8／1 | 場域背景與循環週期不同，見上表 |
| fire-tornado-inferno | 火龍捲 | halo、spray、ground-flames、crown-flame-jets及copy、baked-fire-column | 3.846／1.8 | 根loop=true，主體／動畫週期不同 |
| fire-tornado-infinite | 火龍捲·無限火龍 | 同上六層 | 3.846／1.8 | 同上 |
| ground-storm-barrier | 暴風屏障 | floor-spiral兩層、ascending-light十二層 | 2／0.65 | 多數層2秒，循環屏障中含較短起始演出 |
| hit-bloodblade-burst | 血刃斬 | blood-droplets | 0.6／0.05 | 血滴長於瞬間核心閃光 |
| hit-thunderfall-impact | 雷球·雷殞天落 | pressure-wave | 0.85／0.25 | 壓力波擴散尾段 |
| hit-waterball-splash | 水流彈 | splash-droplets、foam-sparks、water-spray | 0.85／0.25 | 水滴／泡沫尾段 |
| orb-firehunt-companion | 火狩 | trail-glow、trail-core、trail-wisps、trail-sparks、head-licks、head-fire、head-core | 1／0.24 | 多數層1秒，循環火球的短週期細節 |
| orb-firehunt-firegod-companion | 火狩·火神降臨 | 同上七層 | 1／0.24 | 同上 |
| orb-firehunt-solar-companion | 火狩·烈陽星環 | 同上七層 | 1／0.24 | 同上 |
| orb-firehunt-solar | 火狩·烈陽星環 | 同上七層 | 1／0.24 | 同上 |
| orb-firehunt | 火狩 | 同上七層 | 1／0.24 | 同上 |
| pillar-earth | 大地守護·天地再造 | glow、body、core、motes、sprite-7、sprite-8 | 0.9／0.36 | 多數層0.9秒，較短環／光點細節 |
| pillar-light | 大地守護·天地共生 | 同上六層 | 0.9／0.36 | 同上 |

## 粒子尾段值得確認的項目

| 技能 | Preset／圖層 | 發射時間 | 每顆最長存活 | 判讀 |
|---|---|---:|---:|---|
| 飛刀·暴雨梨花 | proj-knife-gold-08-cri-rain／trail | 1.2秒（沿用根值） | 3秒 | rate=50，尾跡可比本體長；高頻飛刀可能累積，建議確認是否需要這麼長 |
| 飛刀·死亡收割者 | proj-knife-gold-09-die／trail | 1.2秒（沿用根值） | 3秒 | 同上 |
| 飛刀·無限追魂刃 | proj-knife-gold／trail | 1.2秒（沿用根值） | 3秒 | 同上 |
| 火球術·地爆天星、火龍捲·烈焰衝擊、暴風屏障·天穹崩裂 | burst-fire-shockwave／tongues、smoke | 0.9秒（沿用根值） | 2秒 | 煙與火舌尾段；主體本身已2秒，沒有100倍差距 |
| 未引用 | burst-fire-shockwave-small／tongues、smoke | 0.9秒（沿用根值） | 2秒 | 同類尾段 |
| 疾風迅雷·雷神之怒、落雷術·雷霆天劫 | bolt-sky-purple／blue-droplets、white-droplets | 0.08秒 | 0.75秒 | 短時間發射、粒子飛散，不等於整層只可見0.08秒 |
| 落雷術 | bolt-thunderstrike-bluewhite／blue-droplets、white-droplets | 0.08秒 | 0.75秒 | 同上 |
| 落雷命中 | hit-thunderstrike-bluewhite／blue-droplets、white-droplets | 0.08秒 | 0.75秒 | 同上 |

粒子實際尾段還受速度、透明度、父層、跟隨體回收與最後發射時刻影響；表列lifetime上限不代表每次都殘留該秒數。

## 長循環與延遲檢查

- `ground-storm-dance`（雙刀亂舞·暴風亂舞*暴風化身）：全部30層duration均24秒，根loop=true。不存在某一層比其他層長很多；粒子lifetime 1.2秒，最長delay 0.1秒，Core總時長24.1秒。這是整份長循環，不判作孤立誤填。
- `aura-earthguard-symbiosis`（未引用）：單一層16秒，根loop=true，沒有其他短層可比較。
- `ground-mire-lava`／`ground-mire-poison`／`ground-mire`：各層duration均2.1秒，ripple延遲0／0.7／1.4秒；總時長3.5秒。循環場域依次擴散，沒有長圖層誤填。
- `field-dragon-devour/inflow-b`延遲1秒，其餘較短延遲皆小於1秒；沒有另一個25秒延遲造成的殘留。

交付任務：REFLECT-THREAT-VFX-20261003。本報告只列現值，不代改使用者的美術設定。
