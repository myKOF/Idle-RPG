# 技能特效尺寸標準與突刺（VFX-20260908）

來源：使用者 2026-09-08 指示與[技能特效表](https://docs.google.com/spreadsheets/d/1RysqEzKOjr2oqHLdXapoTM28tlXpZ2wk/edit?gid=1687407583)。

## 尺寸契約

| 形狀 | 未指定尺寸時的本體基準 |
| --- | --- |
| circle | 半徑 6 米 |
| square | 長寬 6 × 6 米 |
| rectangle | 長寬 6 × 3 米 |
| projectile-circle | 半徑 6 米 |
| projectile-square | 長寬 6 × 6 米 |
| custom | 必須各自定義；用於閃電、龍捲、斬弧、箭形、人物附著效果 |

單一權威預設為 `js/vfx-runtime.js` 的 `SIZE_DEFAULTS`。尺寸換算沿用 `bfMeterPx`，目前一米為十個世界座標單位。
技能範圍、子彈本體、飛行距離是三種不同數值；不得以飛行距離當成子彈長度。

每份正式技能 Preset 的 `sizing` 保存形狀、明訂米制尺寸（可省略以套預設），以及 `authored` 本體座標。
例如突刺 `widthM:12, heightM:3, authored:{width:120,height:30}`。
`authored` 記錄現有素材製作座標，允許不用重採樣貼圖而統一米制尺寸。編輯器中的圖層座標仍使用此製作座標。

換算順序：

1. 根據形狀取預設尺寸，有明訂尺寸則覆寫。
2. 把製作座標中的本體正規化到該米制基準。
3. 若事件帶實際半徑／長寬，依「實際尺寸 ÷ 基準尺寸」縮放。
4. 最後才套野外／高塔的顯示倍率。

例如基準半徑六米、事件半徑十米，成長比例為 10/6；Runtime 合併矩陣後的最終比例為 `實際世界半徑 / authored.radius`。
圓形均勻缩放，矩形沿長寬兩軸縮放。光暈、短暫閃光與飛濺粒子可超出本體，不作為碰撞範圍。
移動場域續報與環繞體的逐幀更新都使用各自的本體尺寸，避免初次播放與後續更新使用不同分母。

人物附著／狀態效果沿用個別身形座標；非完整圓形的斬弧、箭形和直立閃電使用 custom。
火／水／風龍捲的個別本體定義為寬十米、高二十一米，底部半徑由事件覆寫；它是本輪對不規則形狀的製作定義，不是新增傷害範圍。
雷球使用表上半徑三米；暴風雪使用表上二十米正方形；風刃使用表上四乘八米且優先讀取事件的 `bodyLength`／`lineWidth`。
各檔對照由 `tools/vfx/authoring/standardize-sizes.cjs` 管理，`kit.write` 會保留／補齊契約；Editor 儲存時由 Core 驗證並保留。
未宣告 sizing 的外部／示範 Preset 保留原行為。遊戲採 Preset；`?vfx=legacy` 是相容除錯路徑，仍使用原有程式特效，未重製該路徑的素材。

## 突刺

- `slash-thrust-lance`：黃白光長槍，依技能表 J34／K34 參考圖重製：外暈、長光尾、白熱錐形尖端、交錯能量光帶。
- `slash-thrust-empowered`：三階以上轉黃紅光。
- `slash-thrust-scatter`：五階以上增加沿槍身飛濺的短碎光，以及三枚槍身穿過環心的直立窄橢圓光環，依序擴張淡出至 0.48 秒；不另外產生傷害。使用者於 2026-09-09 確認採用。
- 每份特效全部圖層收進自己的單一根群組，可在 VFX Editor 直接修改。
- 程式按已學階數選擇技能表的第三／第五階外觀；四、六、七階幾何仍取模擬層實際參數。
- 平行三道各使用三分之一線寬，中心偏移沿用事件的 `laneOffsets`；八方向使用 `directionCount`，不依目標數量猜測。
- 每波各發一則事件，避免舊 count 上限截掉最後兩波；波次間隔沿用 `sgStaggerMs(1)`。
- 貫穿飛行物的 `beginSec` 和每波 VFX 的 `delayMs` 取同一間隔。這使後續波次實際起飛時間跟著連刺畫面錯開；傷害係數、波數、路徑與二次命中規則不變。
- 貫穿型不在施放時預播命中爆點。高塔無世界方位時，從卡片位置推得顯示朝向。

Google 表內部分傷害、追加距離文字與現行技能數值不同。本輪是特效改造，保留配置表的傷害與距離數值；畫面讀實際事件，不另造一套數值。

## 重生與驗證

```text
node tools/vfx/authoring/author/thrust.cjs
node tools/vfx/authoring/standardize-sizes.cjs
node tools/config_tables.cjs --apply Skills2
node --test --test-concurrency=2 tests/vfx-*.test.cjs tests/skill2-system.test.cjs tests/skill2-vfx.test.cjs tests/worker-shim.test.cjs tests/basic-melee.test.cjs
npm.cmd run build
git diff --check
```

製作透過既有 preset-kit 腳本完成，使用 VFX Editor 相同的 Core／Pixi 後端。已在 Editor 實際載入、按 Play 並確認合法／單一根群組；不是以操作 Editor 介面製作每一層。

圖層旋轉後才套整體長寬縮放；Core 輸出 skewX，由 Pixi 後端還原矩陣，避免風刃等旋轉素材在非等比尺寸下交換長寬。未宣告 sizing 的舊 Preset 維持原行為。

## 2026-09-09 貫穿動作修正

突刺的 lineLength 只表示行進路徑，bodyLength 表示固定槍身長度（維持每道寬度的四倍）。槍尖由中心向外，起始段從中心伸出，槍身完全伸出後以固定尺寸沿直線移動。travelMs 與模擬層的 length / SG_FLYING_PROJECTILE_SPEED 一致；VFX Core 的播放 timeScale 使各層生命週期覆蓋飛行時間，不改傷害結算與碰撞。三道平行仍各自沿既有 laneOffsets 移動。首三階原有直接傷害結算維持不變；貫穿階段的傷害由飛行物掃過路徑觸發。
