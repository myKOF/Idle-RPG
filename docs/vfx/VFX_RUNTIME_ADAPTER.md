# VFX_RUNTIME_ADAPTER.md

## 重整時的載入空窗（2026-10-03）

Canvas 的 ready 不代表 Preset 已載入。BattleRenderer 在 VFXRuntime.boot 尚未完成時，先暫存已走完位置緩衝的事件，禁止直接落入 legacy 程序畫法；同一 variant／area.id 的 aura 更新合併成最新一則，待播佇列最多256則。終止訊號按原順序保留，就緒後交給原表定素材，不增加任何特效來源。

等待時間從剩餘壽命扣除，已過期事件丟棄；静止真空斬同步更新 growAge／當下半徑，環繞圓盤接續角度與外擴，詳細軌道接續 orbitAge。清場取消全部待播，死亡取消待播場域，背景不新增事件。只有 boot 確實失敗／回 null，或明確使用 ?vfx=legacy／未載入 Runtime，才沿用既有相容路徑。Preset JSON 與 shipped-assets 的 fetch 本來已採 cache:no-store；這次修正的是啟動先後順序。

## 冰之淚錯落箭雨（2026-10-01）

冰之淚每波由模擬層依 Excel `fx.count` 產生固定十則 `ice-rain` 事件，每則一支觸發子彈；以既有 `delayMs` 在波次間隔內分層並擾動起飛時間，`travelMs[0]` 決定落地時間。在我方30米內打散目標順序，每箭只帶自己的單一目標；不足十名時重複分配，無敵時仍有十支空箭。鎖定箭沿 Runtime 既有天降路徑追至目標當下位置，只有空箭以 `area.fixedLanding` 指定散落點。箭身維持製作尺寸與飛行切線方向。Runtime 延後起飛只推進本幀起飛後經過的時間，避免長幀令多箭一起提前落地。

各箭排程保存自己的目標與抵達時刻，只在抵達時對該目標結算完整 `tearsOfIce.fx.pct` 傷害，Lv.10 每支為魔攻400%，不按箭數分攤。這份傷害百分比只屬箭雨，不提高普通寒冰箭或追蹤冰箭。抵達重新核對原目標存活、正式敵人清單及我方範圍；離場／移出範圍不轉打其他敵人，成功命中才對同一目標派送 `ice-rain-hit`。2026-10-01 使用者確認此逐箭目標規則，取代上一版每箭同時打全範圍的錯誤解讀；不是將全場受擊加隨機顯示延遲。發射只含 projectile，命中只含 hit，不帶普通發射、追蹤、冰爆或新星角色。箭雨排程保留到最後一箭落地，倒地／切換戰鬥重置時取消未結算傷害。

## 風系方向與事件隔離（2026-09-30）

風刃的方向型 projectile 先於多目標 chain 判別，以事件 angle／lineLength 決定玩家起點的完整貫穿路徑。風刃、追擊刃、沿途脈衝、真空波次與撕裂的本體及實際命中分開；風切擴散每條配對只在目的地播命中。13列追加效果使用獨立 triggerVfx，不覆蓋主風刃、真空斬或屏障。

追跡風刃保留世界座標／速度／轉速，積分圓弧後才套 groundScale。風刃 Core 實例設 motionFacing，將根位置及航向傳至空中 Renderer，以 FOV 投影的切線方向整份轉向，保留作者圖層的局部角度、位置及鏡頭開關；未標記的其他事件維持原路由。真空斬／震波保存原 lineLength／angle，投影圖層只在世界平面旋轉及壓Y一次。

屏障天穹崩裂的風／雷／火星體皆走 rain，在 area.fixedLanding 預告座標落地結算；沒有明確 sourceX／sourceY 時依 Preset 出生高度落下。素材只取本超神或文件登記的表內借用，不繼承別棵技能的超神。完整30列、決策及驗證見 [WIND_SKILL_AUDIT.md](../WIND_SKILL_AUDIT.md)。

## 地面投影（2026-09-22）

明確標記 projection 的圖層改用地面座標，直立圖層維持螢幕座標；此規則補充下文舊版全 Preset 直立的描述。Adapter 以目前場景 groundScale 覆蓋註冊副本的 projection.y，不修改原 Preset；未提供場景比例時保留製作值 0.5。場景的透視後處理仍只執行一次。

screenSpaceSpec 保存原始 area.w／a，標記素材使用原始尺寸、方向計算，再投影一次；rotation 交由 projectionRotation 處理。未帶區域方向的事件沿用素材預設方向。圓形地面比例為 1:0.5；方形先旋轉 π/4 再壓缩，與地磚一致。泥沼與暴風雪的實際作用判定同步使用旋轉矩形及敵人體型邊緣接觸，牆型場域維持原判定。

83 份既有素材的地面層已標記，混合素材的龍捲、光柱、雪與上升粒子仍直立；沒有增加配置表以外的特效來源。清單與驗證見 [GROUND_PROJECTION_AUDIT.md](GROUND_PROJECTION_AUDIT.md)。

## 迴旋斬圓形刀波（2026-09-16）

使用者確認保留原本三組刀弧快速旋轉整圈的表現，不採用分段小刀弧。飛行 Preset 校正 authored.radius，避免已放大的造型再次被飛行距離倍率放大；降低 glow／edge／trail 的疊加亮度以保留內圈。保留原始旋轉、延遲與擴張曲線。迴旋斬專用 SG_CLEAVE_WAVE_GAP_SEC 同時控制傷害與事件 delayMs，維持 0.3 秒。

`cleave-ring` 使用事件 `area.x/y/r` 與 `travelMs[0]`，固定圓心向外擴張。
攻擊形態用 `attack`；第六階或裂空飛斬啟用時以 `projectile` 取代攻擊本體，避免繼承兩欄而重畫。
刀波曲線來源為 Skills2 第一階 `fx.radiusCurve`，製作工具從生成的技能表讀取，與模擬共用；測試釘住正式 Preset 與配置一致。
`delayMs` 與模擬的逐道起飛時間相同，獨立命中事件才播受擊特效。舊版 cleave 事件仍沿用既有處理。

> 2026-09-16 Skills2 新增「特效用途特效」：填「技能本體」或留白沿用逐欄繼承；填「附加效果」時寫入該列 `vfxUsage: 'effect'`，本體解析跳過此列，後續階段也不繼承它。附加事件必須以 `vfxTier`／`vfxUlt` 明確指定來源列（可配合 `vfxGid` 借用），只取該列的六個角色，空欄不繼承本體。用途設定不向後繼承，舊表缺欄相容留白；錯誤選項拒絕重建。這是特效歸屬，不新增觸發行為，也不決定傷害、位置或圖層。逐風者採附加效果，既有起手／地板特判已移除。
>
> 技能本體讀表規則：`cast / attack / projectile / hit / ground / field` 各欄獨立處理。本階有名稱就用本階；空白逐階向前找，跳過附加效果列，直到初階仍空就不播。技能本體用途的超神從第七階往前繼承，不跨互斥超神選項；已選超神的非空欄優先。獨立階級效果讀取事件指定階級，未指定則讀取目前生效最高階。配置名稱不得被 Runtime 換成另一份 Preset。
>
> 角色分派不再因主要欄缺值而整則略過：施放、攻擊、飛行物、持續本體與地板的非空欄分別播放；受擊仍在命中時播放，純命中事件不重新發射子彈。環繞事件由同一軌道機制播放 projectile / ground。空角色表也隨 Worker 事件傳遞，禁止補舊畫法；名稱載入失敗記入 skipped，不以其他特效替代。

# VFX Preset 化：設計定案與交接（2026-09-03，進行中）

> 2026-09-08：正式技能 Preset 已增加 `sizing` 米制本體契約。下文 §1.2 的舊名目像素只適用於未宣告 sizing 的相容檔；新尺寸權威與突刺規格見 [VFX_SIZE_STANDARD.md](VFX_SIZE_STANDARD.md)。

> 2026-09-09：Skills／Skills2 在「地板特效」右側新增「持續場域特效」`field`，Worker protocol v28。`aura` 與 `impact/pillar` 優先讀 field，留白相容舊 ground。field 本體位於 fx 層，ground 地面提示仍在 zone 層；可同時填寫，以各自的角色與 area.id 合併續命，沿用同一移動、範圍與回收機制。雷球與伴生雷球的 ground-thunder-orb 已移至新欄，其他既有設定不自動搬移。此欄只換外觀，不設定傷害、速度、持續時間或攻擊間隔。

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
  spec.vfx = { cast, attack, projectile,      ├─ 有 spec.vfx（含空表）→ VFXRuntime（js/vfx-runtime.js）
               hit, ground }                  │      VFXCore + VFXPixiBackend，掛在 S.layers.zone（ground）與 S.layers.fx（其餘）
   ↑ 值來自表格：                              └─ 舊事件缺少 vfx → 既有程式畫法（相容舊事件）
   Skills.csv 五欄 → sk.vfx
   Skills2.csv 每列六欄 → tiers[i].vfx / ult[i].vfx → 逐欄繼承
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

各 fxKind 的**主要角色**（只決定事件時序語意，不再阻止其他已配置欄播放）：projectile→projectile、slash／strike→attack、burst→attack、
beam→attack、rain→projectile 否則 attack、aura→ground、selfBuff→cast、curse→attack、chain→projectile 否則 attack（拉長成段）、
impact→hit、enemy-attack→attack（近戰）／projectile（遠程）。
變體特例：impact/`pillar` 視為 ground 場域；impact 或 burst/`wind-burst` 用 attack 於 area；impact/`smite` 用 attack（天雷）於目標；`starfall-impact` 只做受擊回饋。

## 1.2 名目尺寸（Preset 以此繪製，Runtime 依實際幾何縮放）

hit／cast／curse：目標身高 60px、主體約 40px；burst／ground 圓形：半徑 100px；ground 矩形：200×100（火牆 200×40、雷幕 200×20）；
beam／chain 段：沿 +X 長 200px；projectile：朝 +X、主體約 40px（火球、隕石另註）；bolt：從 y=-500 落到原點；
orb（環繞體）：半徑 20px（scale＝area.orbR/20）；status aura：腳底原點、身高 60px。

## 1.2.1 單一根群組（使用者規則 2026-09-03）

每份 Preset 的所有圖層一律收進**一個**群組，寫在 `vfx/layouts/<presetId>.json`（群組 id／name 都取 preset id）。
理由是 Editor 可以同時打開多份特效一起編輯（多視窗，2026-09-17），「一列＝一個特效」才分得開。
分組是 authoring metadata，不進 Preset／Runtime／shipped build，因此對畫面零影響。
`tools/vfx/authoring/preset-kit.cjs` 的 `kit.write()` 已自動產生；既有檔案用 `kit.writeRootGroupLayout()` 補。

## 1.2.2 表面尺寸規則（profile）

攻擊尺寸的優先判準：有指定傷害範圍時，無論 Preset 原尺寸大小，均縮放至該傷害範圍，不能再以特效倍率改變結果；沒有傷害範圍（單體攻擊）時維持原製作尺寸。選敵範圍不算傷害範圍。下方歷史 profile 規則不得覆寫此判準。

2026-09-17 修訂：單體目標攻擊保持 Preset 原製作尺寸，不套 `defaultSize` 正規化或 `profile.scale`，延遲播放亦同。帶實際傷害範圍的攻擊仍依事件半徑／長寬縮放；選敵半徑不是特效範圍。此規則優先於本節既有倍率說明，詳見 [尺寸標準](VFX_SIZE_STANDARD.md)。

Preset 是照**野外戰場**的名目尺寸畫的。換到別的版面就得整組縮放，而且不能用同一個數字：

| 係數 | 管什麼 | 名目基準 | 高塔取值 |
| --- | --- | --- | --- |
| `scale` | 角色身上（受擊／施放／狀態光環／目標身上的攻擊本體） | 身高 60px | 1（卡片人像 72px、BOSS 84px，本來就接近） |
| `areaScale` | 帶 `area` 的（範圍爆發、場域、環繞場域） | 半徑 100px（直徑 200） | 0.55（一張卡片只有 202px 寬） |
| `skyScale` | 天降（`fxKind: 'rain'`），同時縮體積與出生高度 | 從 y=-500 落到原點 | 0.28（卡片可用高度約 140px） |
| `groundR` | **沒有 `area`** 時場域改用的名目半徑 | — | 70（0＝不畫，亦不補舊畫法） |

野外全部是預設值（1／1／1／0），因此加入 profile 之前之後行為完全相同。

## 1.2.3 方向型飛行物：航向由模擬層決定，不從 targets 反推

有一類飛行物模擬層說的是「朝這個方位飛這麼遠」，而不是「飛向這個人」：
風刃（`wind-blade` / `wind-blade-small`）、貫穿冰箭（`ice-arrow-pierce`）、
火神星環（`firehunt-ring`）、單體冰箭（`ice-arrow`，`lineLength` 就是到目標的距離）。
判別條件：帶 `angle` 且 `lineLength > 0`，而且不是連鎖段（`targets.length < 2`）、
不是敵方出手（無 `sourceId`）、不是天降（`fxKind !== 'rain'`）。

這一類必須守兩條，兩條都是實機回報換來的：

1. **沒有目標也要接手。** `bfLineTargets` 在那條刀道上找不到人就回空陣列，
   四方向齊射時多半有幾道是空的。Adapter 若因為 `targets` 是空的就 `return false`，
   那幾道會退回舊畫法，於是**同一個技能在同一幀同時出現新舊兩種畫面**
   （2026-09-03 使用者截圖：風刃的大綠弧與 Preset 刀鋒並存）。
2. **有目標也不准追。** 終點一律是 `from + (cos/sin(angle)) * lineLength`，
   不走 `projectileTargetPoint` 的預判。追過去畫面就與判定的直線路徑分家（AI_RULES 8.3）。

由 `tests/vfx-runtime.test.cjs` 的 MOVE-4／MOVE-5 各釘住一條。

## 1.2.4 斜俯視：Runtime 在畫面空間工作（2026-09-22）

野外戰場改成輕度斜俯視：畫面 y ＝ 世界 y × `GROUND_Y_SCALE`（0.5，見 js/battle-renderer.js 檔頭）。

**Preset 本來就是照斜視畫面畫的。** 地面光圈在編輯器裡就壓扁成約 0.38～0.45 的橢圓（ring_a {0.42, 0.17}、
pillar-light 的 ring {0.18, 0.066}），往上（−y）是高度。以前完全俯視時世界座標＝畫面座標，Runtime 一直是在畫面空間工作。
所以斜俯視之後**不能把 Preset 整份壓扁**（地面光圈被壓兩次、火柱與龍捲變矮），而是：

- `presetZone`／`presetFx` 掛在不壓縮的直立空間；舊畫法的 `zone`／`fx` 仍在壓縮的地面平面（它們照世界尺寸畫）。
- `ctx` 的座標函式回傳**畫面座標**（battle-renderer 的 `screenPosOf`／`screenFootOf`／`screenMuzzle`；預判點算完再投影）。
- `VFXRuntime.boot({ groundScale })` → `tryPlay` 進來時由 `screenSpaceSpec` 把事件的世界座標換成畫面座標：
  - 點：`area.y／sourceY／destY／controlY` × k（x 不變）
  - 方向：`spec.angle`、`area.a`、`area.moveA` → `atan2(k·sinθ, cosθ)`
  - 沿方向的長度：`lineLength`（沿 angle）、`area.speed`（沿 moveA，沒有就沿 a）、`area.w`（沿 a）× √(cos²θ + k²·sin²θ)
  - 半徑與厚度不變：`area.r`、`orbR`、`orbitR`、`area.h`（Preset 的地面圖本身已經畫扁）
  - 延後播放的事件到期再進來只換一次（`_screenSpace` 標記）；傳進來的事件物件不改（舊畫法還要用世界座標）。
- 繞行軌道的壓扁比例（原本寫死 `ORBIT_FLAT` 0.62）改用 `groundScale`，與地板一致。
- 編輯器與測試不給 `groundScale`＝1，行為與以前完全相同。

**新增事件欄位時**：如果它是世界座標的點、方向或沿方向的長度，要加進 `screenSpaceSpec`，
否則那個特效在畫面上的縱向位置或角度會差一截。由 `tests/vfx-runtime-screen-space.test.cjs` 釘住換算規則。

### 每層的鏡頭開關（2026-09-24）

畫面透視（`PERSPECTIVE_TOP_SCALE` 的梯形網格）是**後製**：整個場景畫進離屏貼圖再變形貼回，
所以場景裡的東西沒辦法各自退出。圖層標了 `perspective: false`（Schema §每層的三個變形開關）時分兩條路：

| 情況 | 走法 | 為什麼 |
| --- | --- | --- |
| 整份 Preset 的 drawable 圖層都標了 | Adapter 播在 `rtBillboard`（`presetBillboard` 容器，在場景網格之外）：只投影落點、等比縮放 | 完全不變形。繪製順序改用空中層那一套（與玩家腳點比前後），所以只適合整份都要維持原樣的特效 |
| 只有幾層標了 | 留在場景層，由 `projectSceneTransform`（battle-renderer）就地左乘 diag(w, w²) 抵銷 | 前後遮擋不變。單應變換在圖層範圍內不完全均勻，離畫面中心越遠、圖越大，殘留的輕微傾斜越明顯 |

判斷來自 Preset 資料（`billboardPresets`），不是寫死的 preset 名字——2026-09-24 之前天地再造的光柱
是靠 `presetId === 'pillar-earth'` 走 billboard 層，現在那份 Preset 的每一層都標了 `perspective: false`，
行為相同但下一份特效不必再改程式。**幫這類特效加新圖層時，新的那層也要標**，否則整份會掉回場景層。

飛行物那條路（`rtAir`）本來就只投影錨點、等比縮放，不經過網格，所以 `perspective` 在那裡沒有作用；
`followDirection` 則與走哪一層無關，一律由 Core 處理。

**落雷（2026-09-24）**：`bolt-sky-lightning`、`bolt-sky-purple`、`bolt-thunderstrike-bluewhite`
三份都整份標了 `perspective: false`——使用者要求雷永遠筆直落下，而這三份都是變形圖層（沿路徑彎折），
只有 billboard 那條路才是直的（理由見 Schema §每層的三個變形開關）。落雷術走的是 `playThunderstrike`
（腳底錨定、跟著目標移動）這條獨立派送，它同樣改看 `billboardPresets`，不是寫死名字。

**變形圖層的投影**：`deformation.layers` 裡的圖層由後端的 `updateWarp` 用變形矩陣的
`originX／originY／rotation／scaleX／scaleY` **蓋掉**節點的 transform，所以 `rtAir`／`rtBillboard`
的投影掛勾（`projectAirTransform`／`projectBillboardTransform`）必須把投影一起套進那份矩陣
（`projectedWarp`），否則掛勾算完就被蓋掉，整道閃電會畫在沒投影的位置。矩陣是 Core 每幀重用的
同一個物件，只能複製、不能就地改。空中層每份矩陣用自己的原點取遠近；billboard 整張以錨點取一次，
柱身才不會被推歪。

**已知的差距**：Preset 的地面光圈手繪壓扁約 0.4，比地板的 0.5 略扁；原本就畫成正圓的地面特效仍是正圓。
要完全一致得逐份調整 Preset（內容工作）。

## 1.4 高塔：第二個表面

高塔與野外是兩種版面：野外是俯視戰場（實體有世界座標、事件帶 `area`），
高塔是 DOM 卡片版面（202px 玩家卡 ＋ VS ＋ BOSS 卡），實體**沒有座標**——
`bfPos` 回 null ⇒ `sgAreaAround` 回 null ⇒ **高塔的事件 `area` 一律是 null**。

因此 `js/vfx-tower.js` 只做兩件事：把卡片上的人像換算成座標（中心＝身體、下緣＝腳底），
以及套上表 §1.2.2 的高塔 profile。播放邏輯完全共用同一個 Adapter。

- 事件分流在 `js/ui.js`：野外（`BattleRenderer.wantsVfx`）→ 高塔疊層（`VFXTower.onVfx`）
  → `playCombatVfx` 的 DOM 舊畫法。疊層回 false 就換下一條，與野外「缺主要角色就退回」同規則。
- 疊層是懶啟動：第一則高塔事件觸發組裝（Pixi init ＋ 抓 preset），那一則本身走 DOM。
- **面板量不到尺寸就不接手**：分頁不在高塔時整塊是 `display:none`，DOM 矩形全是 0，
  接手等於把特效畫在原點又擋掉 DOM 退路。
- 狀態光環由 `renderTowerFight` 每次重繪時 `VFXTower.sync(player, boss)` reconcile；
  收起戰鬥區時 `VFXTower.stop()` 清乾淨，但保留 App 與已載入的 preset（下一場不必重抓）。
- 疊層 z-index 3，壓在 DOM 浮字（`.float-layer` z-index 5）之下——傷害數字必須看得見。

**沒有共用 battle-renderer 那個 Pixi Application**：它掛在野外棋盤景上、有自己的相機與
世界容器，而高塔是另一塊 DOM、另一套座標系；共用一個 stage 等於要在同一個相機底下
維護兩套互不相干的座標，比多開一個 App 更難維護。

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

## 已完成

- Core：`setTransform`、`play({scaleX, scaleY})`（commit 207138d）。
- 參數表：`tools/config_tables.cjs` Skills／Skills2 五欄、Status 三欄；三張 CSV／xlsx 已依目錄填值。
  §4 的目錄修正已套用並重填（血刃斬 T1／T2、火球 T3、大地守護 T7、不屈鬥魂、meteorSmall）。
- 發送端：`skillVfxSpec` 帶 `sk.vfx`；`sgVfxRoles` ＋ `sgEmitVfx`／`sgEmitPlayerVfx` 帶 `spec.vfx`；
  **§3 對照表的 119 個 emit 點列標記已全部補上**（含場域／環繞／天降佇列的傳遞與共用 helper）。
- 協議 v26：VFX 事件可選欄位 `vfx`。v27：可選旗標 `presetOnly`（只有 Preset 端畫得出來的事件）。
- **Preset：目錄上的 146 份全部完成**（受擊 13、斬擊 11、飛行子彈 20、天降／光柱／光束 8、
  範圍爆發 16、地板與環繞 33、施放 8、詛咒 3、狀態 34），另有三份原型（demo-basic／
  fire-tornado／black-hole）與電球兩份。每一份都帶一份單一根群組的 layout（§1.2.1）。
  素材已匯出：`images/vfx/assets` 85 個、`vfx/shipped-assets.json`。
- **Runtime Adapter `js/vfx-runtime.js` 已接上 `battle-renderer.js`**：
  `onVfx` 先問 `tryPlay`；`tickWorld` 推進；`syncBattle` 以 5Hz 快照 reconcile 狀態光環；
  節點掛在獨立的 `presetZone`／`presetFx` 容器（不能混進 `zone`／`fx`，會被 `sweepOrphanFxNodes` 清掉）；
  `clearAllFx` 一併清。預算 fx `{160, 2400}`、zone `{40, 1200}`。`?vfx=legacy` 強制舊畫法。
- 狀態每跳：`js/combat.js` 的 `statusTickVfxCollect`／`statusTickVfxFlush`，
  同一個模擬步驟裡同一個狀態合併成一則（≤8 目標）並標 `presetOnly`。
- 普攻／敵方／潛力：`js/data.js` 的 `VFX_COMBAT_DEFAULTS` ＋ `vfxCombatRoles()`／`vfxEnemyRoles()`；
  `combat.js` 普攻／天罰／敵方出手、`legendary.js`／`potential.js` 的連鎖電擊都已帶 `vfx`。
- 載入與版號：`index.html` 載入 vfx-core／vfx-pixi-backend／vfx-runtime（在 battle-renderer 之前），
  改到的 js 全部 bump `?v=`，Worker 端資產版號同步。
- 測試：`tests/vfx-runtime.test.cjs`（24 條：角色選擇、退回、擺位與縮放、飛行、場域合併、
  環繞場域交還舊畫法、天降落點預警、狀態 reconcile）。
  原本規劃的 `tests/vfx-catalog.test.cjs` 併進同一檔的 CATALOG 三條，
  不另開檔案——它們的前置（載入正式資料、Core 驗證）與 Adapter 測試完全相同：
  「表格引用的 preset 都存在且合法」「shipped 涵蓋所有 preset 用到的素材」
  「每份 preset 都有單一根群組的 layout」。
- Editor：topbar 加 Preset 下拉（server `/__presets` ＋ `<select>`），151 份可直接切換。
- **高塔疊層**（`js/vfx-tower.js`）：在 `#tower-fight .battle-scene` 上疊第二個 Pixi 表面，
  用同一個 Adapter，只換 `ctx`（DOM 卡片 → 座標）與 `profile`（尺寸規則）。見 §1.4。
- **環繞場域**（火狩星環、環體電球、虛空鋸刃）：軌道環走 zone 層、N 個環繞體走 fx 層，
  火狩自 v29 使用 `area.members` 的穩定 id 同步個體（生成／消耗不重建母體），
  母體讀第一階 projectile，伴生讀第三階 projectile 並透過 `area.companionPreset` 傳遞；
  Skills2.xlsx `AA104` 對應 `orb-firehunt-companion`，沿用表格收集器預載。
  `sampleOrbitMember` 由 Preset 與 legacy 共用：相位加角速度乘施放經過時間，
  伴生再依母體的當前體積直徑＋`companionGap` 換算落後弧度，反向外圈同理。
  新事件 `orbR` 始終是出生體積；`orbitAge` 支援晚加入，補送不重播成長；
  空 members 立即清圈。新火狩每次續命最多補 12 秒，施放總年齡不受此上限截斷。
  無 members 的舊事件維持下述均分及總時長上限，只有舊事件仍存在固定相位差。
  依 `area.id` 合併與續命、團數多退少補、到期整組收掉（上限 12 秒，與舊畫法同一個值）。
  幾何與四條成長曲線（環半徑 `grow`／`growMax`、螺旋 `spiral`／`spiralLag`、
  體積 `orbGrowTo`／`orbGrowSec`、圈距 `rGrowTo`／`rGrowSec`）逐項對齊
  `battle-renderer.spawnFireHunt`——那是模擬層實際判定接觸的那個圓，兩邊數字分家就會
  出現「切 `?vfx=legacy` 前後大小不一樣」。圓心逐幀讀玩家腳底（往上 12px），
  朝向取螢幕上的切線（橢圓壓扁 0.62 之後與 ang+90° 差得出來，拖尾會指錯邊）。
  沒有環繞體 preset 時仍然整則交還舊畫法：只畫軌道環等於把環繞體弄不見。
  ⚠️ 起始角吃 `area.startAng`（模擬層 `sgOrbitStep` 算接觸用的就是 `startAng + 2π·k/count`）。
  舊畫法的 `spawnFireHunt` 沒有讀它，`spawnVoidDisc` 有——統一成讀它是刻意的：
  虛空鋸刃是「一片盤一組環繞場域、靠 startAng 錯開」，忽略它四片會疊在一起。
  因此 `?vfx=legacy` 與 Preset 兩邊在火狩上會有一個固定的旋轉相位差，那不是 bug。

### 2026-09-06：退回舊畫法的殘餘全數清掉

實機回報「風刃同時看得到新舊兩種特效」之後，做了一次全面盤查——把
**每個群組七階全滿、每個超神進化、每個相關傳奇、以及舊技能表**逐一施放，
跑滿 12 秒 tick，收集到的每一則事件都餵給真正的 Adapter，看 `tryPlay` 回不回 false。
一共找到五類，全部修掉：

| 症狀 | 成因 | 修法 |
| --- | --- | --- |
| 風刃／貫穿冰箭／火神星環新舊並存 | `playProjectile` 開頭 `if (!toId) return false`；方向型飛行物的路徑上可能一個敵人都沒有 | §1.2.3 的 directed 分支 |
| 7 種自身增益光殼（暴風屏障／神體／撕裂、岩甲、狂血、暴風之舞、雷幻身）走舊畫法 | 這些事件沒有 `area`，而野外的 `profile.groundR` 是 0＝拒收 | 野外 `groundR` 改為名目半徑 100（＝照 Preset 原尺寸畫在腳底） |
| 狂血／暴風之舞的光殼畫到敵人身上 | 自身增益卻走了敵人定址的 `sgEmitVfx` | 改走 `sgEmitPlayerVfx`（同群組其他續命事件本來就是） |
| 森羅萬象的虛空鋸刃衝擊波 | 該列少了「攻擊特效」欄（虛空斬 T7 有，這一列漏抄） | 補進 `vfx-catalog.cjs` → CSV → `config_tables --apply --write` |
| 傳奇【火池】的那一灘火 | 掛在火球術／殞石術底下，那些列的地板欄是空的 | `vfxGid:'mire', vfxTier:7`（借熔岩沼那一列；超神【永劫火獄】自己有欄位，不借） |

守門測試：`tests/vfx-preset-coverage.test.cjs`（COVER-1…5，約 33 秒）。
靜態 grep 驗不了這件事——退不退回取決於事件內容（有沒有目標、有沒有 area、方位帶了沒），
不是取決於原始碼裡有沒有某個字串。

### 2026-09-06（第二輪）：混畫風的真正主因是 budget，不是缺件

第一輪把「缺 preset／缺角色」的退回路徑全部清掉之後，使用者仍然回報同一次風刃齊射裡
混著新舊兩種畫面。實機壓測（300 道風刃）重現：

| | 修正前 | 修正後 |
| --- | --- | --- |
| Core `droppedEffects`（超出 maxActiveEffects 160） | 75 | 142 |
| Adapter `skipped`（退回舊畫法） | 7 | 0 |
| legacy `fx` 圖層節點 | **21** | **0** |

成因：`VFXCore.play()` 超出 budget 時回 `null`，Adapter 的 `play()` 把它與
「沒有這份 preset」一視同仁地當成失敗，`tryPlay` 於是回 false ——
那一則就落到 `battle-renderer` 的 `drawWindCrescent`（厚實綠鐮刀），與 Preset 的
柔和細弧（`slash_03.png` 加色疊加）並排出現。峰值越高混得越明顯。

改法：`budgetDrops` 計數把兩種 `null` 分開。超出 budget ＝ **整則丟掉並回 true**
（少一道遠比多一種畫風不顯眼，也符合 Core「寧可少一個特效也不要掉幀」的原則）；
只有「沒有 preset」才退回舊畫法。`stats().dropped` 可以看到丟了幾則。
`tests/vfx-runtime.test.cjs` 的 FALLBACK-3／FALLBACK-4 各釘一面。

### 2026-09-06（第三輪）：效能節流整個拿掉，改由實機體感決定

使用者決策：**先不管畫面上同時有幾個特效**，把效能節流拿掉，之後依實機體感再決定數字。
理由是修掉「退回舊畫法」之後，超預算仍然會讓峰值少掉幾道特效，那一樣看得出來。

改動：`js/vfx-runtime.js` 的 `FX_BUDGET`／`ZONE_BUDGET` 改成不會綁住的值
（`maxActiveEffects 65536`、`maxParticles 64000`、`perEffectParticleLimit 2000`），
`js/vfx-core.js` 的 `HARD_LIMITS.budget.maxActiveEffects` 從 256 放寬到 65536——
那一條沒有正確性理由，註解本來就寫著「純粹是為了讓上限仍然是個上限」。
⚠️ `perEffectParticleLimit` 的硬上限**不能**再往上調：Core 的發射迴圈靠它保證終止
（`emitAccumulator -= 1` 在極大值下不再改變數值）。

要重新開啟節流：改 `FX_BUDGET`／`ZONE_BUDGET` 三個數字即可（單一控制點）。
`tests/vfx-runtime.test.cjs` 的 BUDGET-1 會因此變紅，那是刻意的提醒——
改了數字就要一併想清楚「被丟掉的那幾則會不會被看出來」。

**成本曲線**（同一台機器、同一個場景，`app.ticker.update` 同步計時含 render；
Browser 面板未顯示，所以這是 **CPU 側的下限**，實機還要再加 GPU 合成）：

| 同時特效數 | sprite | 粒子 | ms／幀 |
| --- | --- | --- | --- |
| 0 | 773 | 0 | 0.24 |
| 40 | 773 | 0 | 1.38 |
| 80 | 773 | 110 | 1.52 |
| 160（舊上限） | 773 | 212 | 2.30 |
| 240 | 1002 | 417 | 5.44 |
| 400 | 1380 | 611 | 8.80 |
| 540 | 2173 | 950 | 10.48 |
| 735 | 2789 | 1224 | 13.96 |

60fps 的一幀是 16.7 ms，而那是**整個遊戲**的預算不是只有特效。
若給特效三分之一（約 5 ms），對應大約 240 個同時特效；735 個會把整幀吃光。
舊的 160 只花 2.3 ms，確實偏保守。實際數字等體感測完再定。

成本是**超線性**的（160→240 只多 80 個特效卻多了 3 ms）。除了特效數本身，
另一個可能的來源是節點回收：`createRuntime` 的 `maxPooledPerKey` 是 256，
超出的節點在釋放時直接 destroy，下一波再重新 new 出來。峰值放大之後這條會開始咬。
若體感測出「峰值第一次爆、之後就順」，那就是它——調 `maxPooledPerKey`（用記憶體換
配置次數），而不是把特效數調回去。

### 2026-09-30（第四輪）：實機體感回來了——命中類的同目標併發上限與自適應密度

上一輪留下的問題「體感測完再定數字」有答案了。使用者回報敵人越多、寒冰箭「無限冰裂」
（每次命中回扣冷卻）連鎖越快，FPS 一路掉到 7。診斷疊層（`js/battle-perf.js`）的實機數字：

| 條件 | FPS | Pixi CPU 占比 | Core 更新 | 節點更新／幀 | 粒子 |
| --- | --- | --- | --- | --- | --- |
| `?fx=off` | 60 | 5% | 0 ms | 0 | 0 |
| 特效全開（`?res=0.5`） | 13 | 94% | 51 ms | 17,692 | 11,035 |

瓶頸是 CPU（解析度減半仍是 94%），且**成本正比於節點數**（每節點約 3.9 µs：Core 數學 0.64、
Pixi 後端寫入 1.1、Pixi 渲染約 2.1）。滾雪球的是 `burst-icearrow-crystal`：每秒 172 個，
單一爆點 19 層、約 74 個節點、活 1.05 秒，同屏約 180 個疊在同一批目標身上。

**為什麼不是把總預算調小**：那會整則丟掉，同一次齊射裡混出兩種畫風（第二輪的教訓）。
疊 4 份與疊 40 份的爆點輪廓一樣是一顆冰刺球（`tools/vfx/preset-render.cjs --stack` 比對），
多出來的幾乎全是重複的節點。所以只動「命中類」（表格 hit 欄）：

1. **同目標併發上限 K**（預設 4）：同一個目標、同一份命中 preset 同時最多 K 個，超過的不畫，
   傷害數字照常。K 是 preset 的 `playback.hitCap`（1～64），Editor 的執行期欄位可調。
   在 `playOnTargets` 的命中分支與「飛行物抵達後的延後受擊」兩處判斷（後者在真的要播的那一刻才數）。
   略過算「已處理」（`stats().capped`），**不能**回報失敗——失敗會讓顯示層退回舊畫法。
   循環 preset 沒有「播完」的時刻，不納入。
2. **自適應密度**（`createDensityGovernor`）：平滑後的幀時間 >22 ms（<45 FPS）才介入，
   每幀降 0.08，下限 0.25；<18.5 ms（>54 FPS）才每秒放回 0.25；中間是死區。
   密度乘上 K（四捨五入、至少 1），並以 `density` 參數傳給 Core：新播出的命中特效
   少發粒子（爆發顆數、持續速率、子發射器顆數；至少留 1 顆；sprite 層不變）。
   `play(density)` 預設 1，與加入之前逐位元相同；不合法的值直接丟錯。
   單一巨大 dt（分頁回前景）不足以觸發（dt 夾在 50 ms，平滑後仍 <22 ms）。

`stats()` 多了 `quality`、`hitCap`、`capped`、`thinned`，診斷疊層有一行「命中密度」顯示。
測試：`tests/vfx-hit-density.test.cjs`。

**實測（同一台機器，用 `scratch/_perf_replay.js` 把實機擷取的 `ice-arrow` 事件以每秒 388 個灌進
遊戲自己的事件佇列，走 flush 預算）**：

| | FPS | 特效 | 節點／幀 | Core |
| --- | --- | --- | --- | --- |
| 修改前 | 25～34 | 約 190 | 約 7,500 | 約 18～25 ms |
| 修改後 | 47～59 | 約 120 | 約 3,300～4,400 | 約 11 ms |

修改後密度在 0.25～0.69 之間自己擺盪（K 落在 1～3），每秒略過約 350 個爆點。

**沒解決的**：投射物本身（`proj-icearrow-frost` 每秒 388 支）不在這次範圍，壓力拉到每秒 700 時
成為主要成本（`moveRef`／`setTransform` 每幀逐支計算，tick 43.8 ms 而 Core 只有 18 ms）。
若實機仍不夠，下一步是把同樣的 `density` 套到投射物的粒子，或降低投射物的更新頻率。

### 2026-10-06（第五輪）：命中類早已到底，剩下的成本在飛行子彈拖尾與命中的「頻率」

第四輪之後使用者截圖（傷害數字關閉）FPS 仍只有 12；同一天先修掉了「事件卡在計時器隊伍」
（`battle-renderer.js` 的 `laterFrame`），所以特效不再被少畫，幀成本變成實際成本。
重負載穩態（32 隻敵人、6 個滿階技能）平均約 4,700 個特效節點，依 preset 歸屬：

| 類別 | 占比 | 代表 |
| --- | --- | --- |
| 飛行子彈 | ~36% | `proj-icearrow-frost` 同時 15 支、每支約 88 個節點（`world-ice-mist` 每秒 172 顆上限 96、`ice-grains` 每秒 72 顆上限 40，皆加亮混合） |
| 命中爆點 | ~33% | `burst-icearrow-crystal` 48、`burst-fire` 37；Core.play 每秒約 640 次，命中類約 340 次 |
| 持續場域 | ~27% | 火龍捲 7×96、雷球 94×7（不動：疏了等於換了技能） |

第一輪的密度只管命中類而且已壓在下限（密度 0.25、併發 1），併發上限擋的是「同時幾個」，擋不住
「一秒播幾次」（場域一秒好幾拍、每拍都想播一次）。所以密度小於 1 時另外降三件事（`SHED`）：

1. **飛行子彈拖尾**（含冰箭／風刃追蹤本體的 ground 路徑；敵方彈體不動）：新播出的實例帶 `density`，
   下限 `trailMin = 0.4`，隨吃緊程度線性回到 1。箭身、軌跡、命中位置不動，只是煙霧與星點發得少。
2. **命中爆點限頻**：同目標同種命中特效的最短間隔，吃緊程度（`(1-q)/(1-floor)`）到 `hitGapStart = 0.3`
   才開始、線性加到 `hitGapMax = 0.5` 秒。**必須有起點**：單幀 50 ms 就會讓密度從 1 掉到 0.92，
   那不該改變畫面（限頻會把「同一瞬間疊的 4 個爆點」砍成 1 個；`CAP-7` 抓到的）。
3. **全場命中特效同時上限**：`160 × 密度`（密度 0.25 → 40），滿了不疊，舊的播完才補。

密度回到 1 就三件事全部不介入，與沒有這些的版本逐位元相同（不帶 `density` 參數）。
被擋下的命中算「已處理」（`stats().capped`，其中 `throttled` 是限頻／全場上限擋的）；
`stats()` 另有 `trailThinned`（拖尾變疏的飛行子彈）、`hitLive`（全場存活的命中特效數），
診斷疊層多一行「降級」。

另有一項**無損**的：Pixi 後端 `updateNode` 看到 `alpha <= 0.01`（8 位元下最多差 2～3 階）就在投影之前
關掉節點、跳過投影與屬性寫入（只關 `visible`，不 `detachDepth`，免得深度群組逐幀拆建）。
實測約 4～7% 的精靈是這種。

**實測（真瀏覽器、真 GPU、同一台機器、同一個重負載情境、交錯兩輪）**：FPS 約 22 → 約 30（+35%）；
場景精靈約 −30～40%。畫面差異：箭身相同，拖尾由連續薄霧變成斷續小團、稍暗（離線出圖
`preset-render.cjs --density 1` 對 `--density 0.4` 並排看過）。

**沒做的**：場景精靈 85% 是加亮混合，另有平均 106 px 的大火焰圖（`flame_04` 約 740 個）——GPU 填充率
可能是另一半瓶頸，節點數少了不一定線性換成 FPS。要再提高得看填充率（縮小大圖、減少重疊），不是再砍節點。

## 尚未完成

1. **目視 QA**（本文件 §5）：Editor 抽樣截圖各家族、實機（8331）觀察普攻、火球、隕石、火牆、
   狀態光環。這一步需要人在瀏覽器前面看，Claude 只能備好流程。
   （本輪已在 8331 驗到：Runtime 接上 145 份 preset、每一則事件都帶 `vfx`、
   53／53 事件由 Adapter 接手、0 退回、0 丟棄；2026-09-06 再以 COVER-1…5 把
   全技能／全超神／全傳奇／舊技能表掃過一遍，退回數為 0。但 Browser 面板隱藏時
   rAF 不跑，畫面本身沒辦法看——那正是這一項要人做的原因。）
1b. **帶 `angle` 的方向型攻擊以突刺光槍的名目（100×36）換算**：
   目錄裡只有 `slash-thrust-lance` 是這個形狀。之後若有第二份方向型 attack preset
   而名目長度不同，要改成由 preset 自己宣告名目，而不是寫死在 Adapter。
3. 名目尺寸只以 `kit.probe` 的 bbox 核對過，anchor 不置中的圖層（天降柱、沿 +X 的光束與光槍、
   扇形）probe 量到的是「以中心計」的框，實際位置要靠目視確認。

高塔已於 2026-09-03 接上（§1.4）：`.battle-scene` 上疊第二個 Pixi 表面、共用同一個 Adapter，
只換座標來源與尺寸規則。組裝失敗、面板量不到尺寸、或這一則缺主要角色時，
仍然整則退回 `js/vfx.js` 的 DOM 畫法。

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


### 飛雷神持續貫穿雷電

`variant: flying-thunder` 使用 Skills2 超神列的 `triggerVfx.field`；`area.id` 每道獨立，
`area.x/y` 是出生時兩名不同敵人的中點（只剩一敵時改用玩家與該敵人的中點），`w/h/a` 為判定平面的完整長度、寬度與固定方向。
`dur` 是該道權威壽命，禁止套用一般場域逐拍續命緩衝；Preset 動畫時間同步此壽命。
`variant: flying-thunder-end` 搭配相同 `area.id` 在死亡、卸下或 reset 時立即回收。
沿用既有 aura／area／dur 協議欄位，不新增封包欄位。表格 interval、gap、tick 分別控制波次、逐道出生、傷害節拍。

飛雷神專用 Preset 的 motionSpeed 設為 0：每道出生形狀仍隨機，但播放期間不再重抽，僅依 alphaOverLife 漸淡；只有零敵人不生成；單敵時由玩家補足連線，重疊座標仍生成。

### 雷球球心投影

`variant: thunder-orb` 的持續雷球與 `variant: thunder-orbit` 的環繞電球使用 billboard 後端。
Core 將每顆球的中心放入各節點的 `sortY`；球體、光暈與電弧粒子共用這個深度的 FOV 遠近倍率，
其相對位置等比投影，避免逐粒子投影把整球輪廓拉成斜橢圓。沒有 billboard 後端時沿用空中後端的相容回退。
環繞地板環仍使用 zone，軌道平面、權威位置／半徑、成長、續命與回收邏輯不變。
此路由依遊戲事件 variant 選擇，不修改 Preset、不寫死新素材名稱，亦不改編輯器通用播放測試。

滿階／超神的本體欄位繼承也可能令 `thunder-orbit`／`thunder-fall` 另播 `field` 雷球，
這兩條事件的 `field` 同樣走球心投影；三種雷球事件的非環繞 `projectile` 亦使用 billboard。
`ground` 預警與雷殞衝擊的 `attack`／`hit` 保留原本場景／地板投影，避免貼地圈被改成立面。
