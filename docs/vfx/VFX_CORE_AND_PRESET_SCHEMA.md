# VFX_CORE_AND_PRESET_SCHEMA.md

# VFX Core 架構 ＋ VFX Preset Schema v1

狀態：`schemaVersion 1`（Preset）。適用範圍見 `docs/vfx/VFX_AGENT_WORKFLOW.md` §1.1。
素材事實層／語意層規格見 `VFX_ASSET_SCHEMA.md`、`VFX_ASSET_SEMANTICS.md`。

---

# 0. 架構總覽

```
                  VFX Core（js/vfx-core.js）
                  純 JS：驗證＋模擬＋生命週期＋預算
                  不依賴 PixiJS、不碰 DOM、不認得 Idle-RPG
                              │
              ┌───────────────┴───────────────┐
              │                               │
    VFX Editor（tools/vfx/editor）      Game Runtime（未來）
              │                               │
              └── 同一個 backend：js/vfx-pixi-backend.js
              └── 同一個 Preset：vfx/presets/*.json
```

**為什麼 Editor 不可能長出第二套 renderer**：畫面上會動的一切——位置、縮放、旋轉、
透明度、粒子軌跡——全部在 `vfx-core.js` 算完，backend 只負責
「建節點／套 transform／回收節點」三件事，本身沒有任何動態邏輯。
Editor 端沒有節點 API 的呼叫（有測試強制），因此預覽 ＝ Runtime 之後會播的東西。

## 0.1 與 Idle-RPG 的界線

Core 不認得 `player`／`enemy`／`battleManager`／`skillManager`／傷害／等級。
對外只有泛用輸入：

```js
runtime.play('demo-basic', {
  position: { x, y }, rotation, scale, seed
});
```

Idle-RPG 之後只需要一層薄 Adapter（把技能事件翻成上面這個呼叫）。
Core 可以整包搬到其他 Web 遊戲。

---

# 1. Preset Schema v1

```jsonc
{
  "schemaVersion": 1,
  "id": "demo-basic",          // 小寫英數與連字號；與檔名一致
  "duration": 1.6,             // 秒，正數，上限 60
  "loop": false,
  "layers": [ /* 見 §2 */ ]
}
```

規則：JSON、決定性序列化、只用 `assetId` 引用素材、不含任何絕對路徑。

## 1.1 決定性序列化

`VFXCore.serialisePreset(preset)` 以固定欄位順序輸出，因此
**Editor 存檔 → 載入 → 再存檔 位元相同**（有測試）。
欄位順序固定也讓 Preset 的 git diff 只反映真正的內容變更。

`vfx/presets/*.json` 一律以 canonical 形式存放，由測試把關
（`tests/vfx-editor-save.test.cjs` 的「所有正式 preset 都是 canonical 形式」）。
手寫的緊湊寫法（例如把 `"position": { "x": 0, "y": 0 }` 排成一行）雖然合法，
但第一次從 Editor 存檔就會被展開成 canonical 形式；之後每次要看「這次到底改了什麼」
都得先跳過那一大段純格式差異，所以檔案本身先正規化。

## 1.2 Editor 存檔回寫（PUT）

Editor 的「儲存到 repo」把目前的 Preset 直接寫回 `vfx/presets/`：

```
PUT /vfx/presets/<presetId>.json     （tools/vfx/editor-server.cjs，只聽 127.0.0.1）
```

契約：

| 項目 | 內容 |
| --- | --- |
| 目的地 | 固定為 `vfx/presets/`（模組常數），呼叫端無法指定路徑 |
| presetId | 取自**未解碼**的 URL，規則見 `tools/vfx/editor/preset-id-policy.js` |
| 落檔內容 | `parse → validatePreset → serialisePreset` 的結果，不是 request body 原文 |
| 失敗 | 任一步失敗即回 4xx/5xx，原檔 byte-identical |
| 寫入方式 | 同目錄獨佔建立暫存檔 → 補寫至完整 → fsync → 驗大小 → rename；暫存檔不以 `.json` 結尾 |
| 來源 | 連線、Host、Origin 都必須是 loopback，Content-Type 必須是 `application/json` |

檔名規則（長度、Windows 裝置名）獨立成 `preset-id-policy.js`，
由伺服器與 Editor 頁面載入**同一份**實作。
Core 的 `validatePreset` 仍是 preset 合法性的單一來源；
「這個 id 能不能當檔名」是另一個問題，兩邊各寫一份遲早會變成
「Editor 說可以存、伺服器回 400」。

存檔目的地由 `preset.id` 決定，而不是由開場的 `?preset=` 決定，
因此之後要加 Save As，只要讓使用者能改 `preset.id` 就成立。
但 Editor 會記住「這份是以哪個 id 載進來的」，兩者不一致時**停用存檔**——
否則開著 `fire-tornado` 按存檔卻改掉 `black-hole.json`，而且畫面上看不出來。

存檔**不會**觸發 `tools/vfx/export-assets.cjs`。
把素材發佈綁進編輯動作，等於每按一次存檔就重寫一次 `images/vfx/assets/`；
正式匯出仍然是獨立的一步。

## 1.3 不變量：Editor 的 authoring 狀態不得改變 Runtime 輸出

```
EDITOR AUTHORING STATE MUST NOT CHANGE RUNTIME OUTPUT
```

以下全部屬於 Editor metadata，存在 `vfx/layouts/<presetId>.json` 或 localStorage：

| 項目 | 存放位置 |
| --- | --- |
| Group（成員與名稱） | `layout.groups` |
| Authoring order（頂層排列） | `layout.order` |
| Group 內排列 | `layout.groups[].layerIds` |
| Collapse | localStorage |
| Selection | 只在記憶體 |

它們**不得影響**：`preset.layers`、`zIndex`、RNG seed、繪製順序、粒子輸出、
任何 runtime 輸出——除非使用者執行的是明確修改 VFX 資料的操作
（改參數、換素材、新增／刪除圖層）。

### 為什麼這條要寫死成不變量

因為「看起來沒改到」是不夠的。實測結果：

```
拖一個圖層、zIndex 一個都沒動
拖曳前 transform 指紋: 42a3bfe57527218e (5726 筆)
拖曳後 transform 指紋: b9355597d29837b3 (5792 筆)   ← 不同
```

兩個原因都在 Core：

1. **粒子亂數種子綁在陣列索引上** —— `rng: makeRng(effect.seed + i * 0x9E3779B9)`，
   `i` 是 `preset.layers` 的索引。搬動一層，後面每一層的種子都變。
2. **相同 `zIndex` 的繪製順序由 child 加入順序決定** ——
   `lightning-orb-field` 有四組各 7 層共用同一個 `zIndex`。

修法刻意**不動 Core**：改 seed 推導會讓所有既有 preset 的粒子位置一次性改變。
改成把 authoring order 移出 `preset.layers`，讓這條不變量**結構上必然成立**，
而不是靠測試去追。

回歸保護在 `tests/vfx-editor-layers.test.cjs`：R1 先證明指紋抓得到重排
（有鑑別力），R2 才驗證整串 authoring 操作後指紋完全相同。
只比對欄位（zIndex/assetId/position/scale/alpha）是不夠的——
那正是先前漏掉這個 bug 的原因。

---

### 已知限制：符號連結檢查是 TOCTOU-racy

連結檢查通過之後，落檔仍然是用路徑呼叫 `openSync` / `renameSync`，
中間存在一段可以把 `vfx/presets` 換成 junction 的窗口。
要真正關掉它需要 `openat` / `O_NOFOLLOW` 這類對已開啟目錄 handle 操作的介面，
Node 的 `fs` 在 Windows 上沒有可攜的等價物。

接受的理由是威脅模型：能贏這場競態的人必須已經能在本機以同一個使用者身分
執行程式碼，而那種人本來就能直接改任何檔案，不需要來搶一台只聽 `127.0.0.1`
的開發伺服器。對「遠端」與「瀏覽器裡的其他分頁」這兩種真正要防的來源，
這條路走不通。實作上仍在 rename 前重新檢查一次，把窗口縮到最小。

---

# 2. 圖層型別（只有三種是真正不同的繪圖原語）

需求裡列了 Sprite / Mask / Particle / Ring / Glow / Procedural 六項，
實際評估後**只保留三種 layer type**，其餘是 sprite 的參數組合而非新的 renderer：

| 需求名稱 | 實作方式 | 為什麼不另立型別 |
|---|---|---|
| Sprite | `type: "sprite"` | — |
| **Ring** | sprite ＋ 環形素材 ＋ `scaleOverLife` | 繪圖行為與 sprite 完全相同，只是素材與參數不同 |
| **Glow** | sprite ＋ 光暈素材 ＋ `blendMode: "add"` | 同上 |
| **Mask** | **延後**（見 §6） | 真正的遮罩是「改變別的圖層怎麼被畫」，不是自己畫一張圖；MVP 不需要 |
| Particle | `type: "particle"` | 需要生成、模擬、池化，與 sprite 本質不同 |
| Procedural | `type: "procedural"` | 需要在 GPU 上持續變動 UV，與靜態 quad 不同 |

多做 `ring`／`glow` 兩個型別只會讓三份幾乎相同的 renderer 各自長歪，
之後改一個忘了改另外兩個。

## 2.1 共通欄位

`id`（同一 preset 內唯一）、`type`、`enabled`、`assetId`、`zIndex`、
`position{x,y}`、`rotation`（弧度）、`scale{x,y}`、`anchor{x,y}`、
`alpha`(0..1)、`tint`(`#rrggbb`)、`blendMode`(`normal|add|multiply|screen`)、
`delay`、`duration`（省略時吃 preset 的 duration）。

動畫：`alphaOverLife`、`scaleOverLife`、`rotationOverLife`，
格式一律 `[[t, value], …]`，`t` 為 0..1 的生命進度，線性內插，最多 16 點。
刻意不做貝茲／緩動曲線——MVP 用不到。

## 2.2 particle 專屬

`emission`（`{mode:"burst",count}` 或 `{mode:"rate",rate}`）、`maxParticles`、
`lifetime`、`spawn`（`point`／`circle{radius}`／`box{width,height}`）、
`speed`、`direction`(度)、`spread`(度)、`gravity{x,y}`、
`startScale`、`rotationStart`、`rotationSpeed`、
`alignToVelocity`、`velocityRotationOffset`。

數值欄位都接受「固定值」或 `[min,max]` 區間（區間取決定性亂數）。

### 2.2.1 alignToVelocity（粒子朝向對齊速度）

`alignToVelocity`（布林，預設 `false`）讓粒子的算繪朝向跟隨自己的速度向量；
`velocityRotationOffset`（弧度，預設 `0`）補償素材本身的繪製方向——
例如 `trace_02` 的條紋畫成朝上，要 `+π/2` 才會沿著行進方向躺平。
同一張素材只需要一個固定 offset，不必為每個方向各寫一個。

朝向是**加上去的一項，不是取代**：

```
renderRotation = effect.rotation + layer.rotation
               + velocityAngle + velocityRotationOffset    ← 僅在啟用且有有效速度時
               + rotationStart + 累積的 rotationSpeed
               + rotationOverLife 取樣值
```

`velocityAngle = atan2(vy, vx)`，於速度積分之後計算，因此 `gravity` 造成的
轉向當幀就會反映出來。`rotationStart` 仍是初始偏移、`rotationSpeed` 仍是
相對於行進方向的自轉、`rotationOverLife` 仍是疊加曲線，三者都不會被覆蓋。

**零速度**：速率必須**嚴格大於** `VFXCore.VELOCITY_EPSILON`（0.001 px/s）才算有效方向；
恰好等於門檻視為無效。低於門檻時**保留上一次的
有效角度**，不歸零——`atan2(0, 0)` 會回傳 0，會讓粒子在減速到靜止的瞬間彈回
0 弧度，甚至因為浮點負零而翻轉 180 度。若粒子從出生到現在**從未**有過有效
速度，則完全不加入這一項，行為與未啟用時相同。

`velocityRotationOffset` 在未啟用 `alignToVelocity` 時沒有作用，且**不會**被
驗證擋下——Editor 取消勾選時 offset 仍留在資料裡，若強制檢查會讓單純的開關
動作產生不合法的 preset。

關閉時（預設）算繪結果與加入本功能之前完全相同，既有 preset 不受影響。

刻意**不做**：子發射器、碰撞、貼圖動畫、噪聲場、trail renderer、
以及 Unity 那套完整曲線編輯——目前的火焰龍捲與一般 Web VFX 用不到。

## 2.3 procedural 專屬

`effect`（目前只有 `uvScroll`）、`size{x,y}`、`scrollSpeed{x,y}`。

`uvScroll` 用 Pixi 的 `TilingSprite` 捲動 `tilePosition` 實作——
不需要自訂 shader 就能可靠完成，而且只有**可平鋪**的素材才有意義（見 §7 Material Gap）。
未來要加 `distortion`／`dissolve`／`noise` 時，在 backend 的 `kind` 上擴充即可，
不必動 Core 的模擬迴圈。**本階段不建立 Shader Graph。**

---

# 3. Asset Resolver

```
assetId → Resolver → relativePath（來自事實層 asset-index.json）→ 實際 URL
```

Core 只認得 `assetId`，連 Asset Library Root 存不存在都不知道。

```js
VFXCore.createIndexResolver(assetIndex, baseUrl)   // 介面：resolve(assetId) -> URL
```

| 消費端 | baseUrl | 由誰提供實體檔案 |
|---|---|---|
| Editor（本機） | `/asset-library/<libraryId>` | `tools/vfx/editor-server.cjs` 把本機 Root 掛成 URL |
| Game Runtime（未來） | 打包後的 `images/vfx/…` | export 步驟複製被引用到的素材子集 |

Resolver 是介面，換一個實作就能換來源，**沒有任何 Windows 檔案系統相依**。
未知 `assetId` 一律丟錯，不 silent fallback 成空白貼圖。

---

# 4. 驗證（不 silent fallback）

`VFXCore.validatePreset(preset)` 回傳 `{ok, errors[]}`，會擋下：

未知 `schemaVersion`、未知 layer type、重複 layer id、缺少或非法 `assetId`、
**assetId 夾帶絕對路徑或 URL**、NaN／Infinity、負的 duration／delay、
非法 blendMode、非法顏色（非 `#rrggbb`）、粒子數超過硬上限、
曲線格式錯誤或 `t` 未遞增、`spawn.shape` 非法。

硬上限：圖層 32、單層粒子 2000、duration 60 秒、曲線 16 點。

Runtime 在 **註冊時** 就解析所有 `assetId`，未知素材當場失敗，
而不是播放時默默不顯示。

---

# 5. 效能預算

```js
VFXCore.createRuntime({ backend, resolver, budget: {
  maxActiveEffects: 24,        // 超過就不播新的，回傳 null 並計入 droppedEffects
  maxParticles: 1200,          // 全域粒子上限
  perEffectParticleLimit: 300  // 單一特效上限
}});
```

`runtime.stats()` 回報 `activeEffects / activeParticles / pooledNodes /
droppedEffects / droppedParticles`，Editor 直接顯示在工具列。

**節點池**：粒子生滅頻繁，每顆都 new 會讓 GC 在戰鬥中出現尖峰。
節點依 `(kind, assetUrl, blendMode)` 分池回收重用；
測試驗證「三輪各 10 顆粒子只建立 10 個節點」。

MVP 不做 adaptive quality；目標只是讓幾十個特效同時存在時
**有一個地方可以統一控制成本**。

---

# 6. 本階段刻意不做

- Mask layer（遮罩是「改變別人怎麼被畫」，需要先想清楚與 zIndex／群組的關係）
- Shader Graph、自訂 GLSL
- Timeline／Keyframe editor／Node graph
- Undo/Redo
- 子發射器、粒子碰撞、trail renderer
- Runtime 與 Idle-RPG 的 Adapter（下一階段）

---

# 7. Material Gap（依 `VFX_AGENT_WORKFLOW.md` §4.5）

`procedural/uvScroll` 已經可以動，但**只有可平鋪素材才有意義**。
語意層查詢 `usage=noise tileable` 的結果仍然只有水波焦散與葉隙光斑，
兩者都不是火焰湍流噪聲——這與上一階段回報的 Material Gap #1／#2 相同，
本階段沒有新增素材，也**沒有為了補素材缺口而寫複雜 shader**（§4.5.4）。

---

# 8. 已知限制

1. **`uvScroll` 目前只有平鋪捲動**，沒有扭曲；要做熱扭曲需要 flow map（Material Gap #2）。
2. **Runtime Adapter 尚未接上**：`js/vfx.js` 與 `js/battle-renderer.js` 仍是遊戲目前的特效路徑，
   本階段完全沒有改動它們（見 §9）。
3. Editor 沒有 Undo／多選／拖曳排序，屬 MVP 範圍外。

---

# 9. 與既有 VFX 的關係（沒有 regression）

本階段**沒有修改** `js/vfx.js`（DOM 特效）與 `js/battle-renderer.js`（PixiJS 戰鬥渲染器），
`index.html` 也沒有載入新的 Core。新舊兩套並存，遊戲行為零變化。

盤點結果：

| 既有能力 | 評估 |
|---|---|
| `js/vfx.js` 的品質裁切、事件佇列、節點上限、分頁隱藏停用 | **概念可重用**：Core 的 budget 已吸收「上限」與「丟棄計數」的想法 |
| `js/vfx.js` 的 `fxKind/elem/cat/variant` 分派 | **與 gameplay 耦合**：屬於未來 Adapter 的職責，不進 Core |
| `js/battle-renderer.js` 的貼圖快取、序列幀、批次化經驗 | **可重用**：Pixi backend 走同樣的「共用貼圖 ＋ Sprite 批次」策略 |
| `js/battle-renderer.js` 的 `onVfx`／`wantsVfx` 路由 | **留在 Adapter**：決定「哪些事件走 Canvas、哪些走 DOM」是遊戲側的事 |

遷移建議：先讓新 Core 服務**新做的特效**，舊特效維持原狀；
等 Adapter 與 export 流程穩定後再逐一搬移，不要一次重寫。
