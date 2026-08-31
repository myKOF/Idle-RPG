# VFX_ASSET_LIBRARY_DESIGN.md

# VFX 素材庫盤點與 Asset Index / Metadata 架構設計

建立日期：2026-08-31
階段：VFX Editor 前置作業（盤點與設計，未實作）

適用範圍：`docs/vfx/VFX_AGENT_WORKFLOW.md` §1.1（VFX Asset loading / VFX Preset / VFX JSON・Schema）。

> **路徑聲明**
> 本文件第 1 節出現的 `D:\MyGame\effects-materials` 只是**本次盤點時，這台電腦上的素材庫位置**，
> 屬於調查紀錄，不是設定值。
> **禁止**把此路徑寫進 VFX Editor、Runtime、Preset、Schema 或任何正式程式碼。
> 路徑解析一律走第 4 節的 Asset Library Root 機制。

---

# 1. Inventory 摘要

## 1.1 總量

掃描根目錄（本機）：`D:\MyGame\effects-materials`

| 項目 | 數量 |
|---|---|
| 目錄下檔案總數 | 1,966 |
| 其中屬於 `.git/`（素材庫本身是一個 Git repo） | 1,011 |
| **實際素材檔案** | **955** |
| PNG | 904（扣除 7 張 Preview／Sample 後，**可用素材 897**） |
| SVG（向量原稿） | 39 |
| 其他（License.txt ×5、.url ×6、.unitypackage ×1） | 12 |

> 素材庫自己是 Git repo，`.git/` 佔了檔案總數的一半以上。
> 掃描器**必須**排除 `.git/`，否則索引會被 1,011 個無關檔案灌爆。

## 1.2 內容組成（五個 Kenney 套件，授權皆為 CC0）

| 套件 | 可用 PNG | 尺寸 | 內容 |
|---|---|---|---|
| `kenney_particle-pack` | 192 | 512×512 | **VFX 核心素材**。80 種 × 2 種背景（Transparent／Black background），另 16 張預旋轉版 |
| `kenney_light-masks-1.0` | 456 | 512×512 | **遮罩庫**。152 種 × 3 種變體（Default／Inverted／Transparent） |
| `kenney_smoke-particles` | 77 | 尺寸不一 | 煙霧與爆炸。Black smoke 25、White puff 25、Explosion 9、Flash 9、Fart 9 |
| `kenney_splat-pack` | 72 | 256²／512² | 潑濺、地面痕跡（另有 37 個 SVG 原稿） |
| `kenney_foliage-sprites` | 100 | 1024×1024 | 植物精靈圖，**非 VFX 素材** |

## 1.3 命名方式

- `particle-pack`：`<語意名>_<兩位序號>.png`（`flame_04.png`、`spark_06_rotated.png`）
- `light-masks`：`<形狀>_<字母>[_修飾詞].png`（`ring_a.png`、`cone_composed_c_noise.png`、`circle_a_streaks_noise.png`）
  修飾詞：`noise`（雜訊破碎）、`streaks`（放射條紋）、`blur`（柔化）、`gradient`（漸層）
- `smoke-particles`：`<類別><兩位序號>.png`（`blackSmoke12.png`）
- `splat-pack`：`splat<兩位序號>.png`

序號**不帶語意**：從 `flame_01`～`flame_06` 看不出哪個細長、哪個寬扁。

## 1.4 素材類型檢核（依實際圖像抽樣，非只看檔名）

| 類型 | 有無 | 實際狀況 |
|---|---|---|
| Sprite Sheet | **無** | 沒有任何圖集。全部是獨立單張 |
| Flipbook 序列幀 | **實質無** | `blackSmoke00～24` 等編號檔經抽樣比對（00 vs 12）是**互相獨立的變體**，不是同一動畫的連續幀 |
| Mask | **有（456）** | light-masks 全套：circle／ring／cone／fan／window／shape／streaks／water_caustics |
| Noise | **無** | ⚠️ 沒有任何**可平鋪（seamless）噪聲貼圖**。`_noise` 後綴指「這張遮罩帶雜訊破碎」，不是噪聲紋理 |
| Particle Texture | **有** | particle-pack 全套，512² 統一尺寸 |
| Glow / Light | **有** | `light_01～03`、`flare_01`、light-masks 的 `circle_a～d` |
| Smoke | **有** | `smoke_01～10`（灰階可染色）＋ smoke-particles 套件（尺寸不一） |
| Trail | **有** | `trace_01～07`（縱向條紋）、`slash_01～04`、`scratch_01` |
| Ring | **有** | `ring_a～c`、`circle_rings_a～d`（light-masks） |
| Beam | **無專用** | 可用 `trace_*`＋`cone_*`＋`window_*` 合成，但沒有現成光束貼圖 |
| Distortion 用素材 | **無** | 沒有 normal map、沒有 dudv、沒有可平鋪噪聲 |
| 其他值得納入 | 有 | `scorch_01～03`＋splat-pack（地面燒痕／殘跡）、`magic_01～05`（符文光環）、`muzzle_01～05`（爆閃）、`symbol_01～02` |

## 1.5 抽樣觀察到、光看檔名絕對得不到的事實

這五點直接決定 Metadata 要有哪些欄位：

1. **particle-pack 是灰階可染色遮罩，不是彩色美術。**
   `fire_01`、`flame_04`、`spark_04` 實測都是白／灰階圖形，顏色預期由 runtime tint。
   → 需要 `visualStyle` / `tintable` 欄位。

2. **smoke-particles 的 `explosion*` 是預先上色的橘黃火球。**
   同一個素材庫裡兩種美術風格並存，染色策略完全不同。
   → `tintable: false` 必須能區分出來，否則 Agent 會把橘色爆炸拿去染成藍色冰系。

3. **同一圖形有 2～3 種背景變體，選錯就是黑方塊。**
   - particle-pack：`PNG (Transparent)`（alpha 承載）vs `PNG (Black background)`（黑底，加法混合用）
   - light-masks：`Default`（黑底白形）／`Inverted`（白底黑形）／`Transparent`（alpha 承載）
   實測 `Default/ring_a.png` 是黑底白環，`Inverted/ring_a.png` 是白底黑環，`Transparent/ring_a.png` 在白底預覽器上完全看不見。
   → 需要 `backgroundVariant` ＋ `blendModeHint`，這是本庫**最容易出錯**的地方。

4. **檔名會說謊。** `spark_04` 實際是細絲狀電弧／裂紋，不是點狀火花；
   真正的星芒火花是 `star_08`（四芒星閃光）。`window_*` 是窗形投影光，與 UI 無關。
   → `shape` 與 `recommendedUsage` 必須由**圖像內容**決定，不能從檔名推。

5. **smoke-particles 每張尺寸都不同**（362×336、398×364、386×342…），已被裁切去邊。
   → 需要 `dimensions` 與 `trimmed` 資訊，否則粒子系統的錨點與縮放會亂掉。

---

# 2. 現有素材庫的問題

以「Agent 要自己找素材」為標準評估，目前的資料夾結構**不足以支撐**。

| # | 問題 | 後果 |
|---|---|---|
| 1 | 結構是**依套件來源**分類，不是依**功能用途** | Agent 想找「噪聲」必須先知道 Kenney 的套件慣例，等於要背下第三方目錄結構 |
| 2 | 檔名語意不可靠（見 §1.5 第 4 點） | 純檔名搜尋會選錯素材，而且錯得很有自信 |
| 3 | 背景變體混在檔名之外的資料夾層級 | 加法混合層誤用 `Transparent`、alpha 層誤用 `Default` → 黑方塊或發灰 |
| 4 | 序號無語意 | `flame_01`～`06` 無法排序或篩選 |
| 5 | Preview.png／Sample.png 混在素材裡（7 張） | 天真掃描會把套件宣傳圖當成素材索引進去 |
| 6 | foliage-sprites（100 張植物）與 VFX 無關 | 汙染搜尋結果 |
| 7 | 素材庫自身是 Git repo | 未排除 `.git/` 會多索引 1,011 個檔案 |
| 8 | 尺寸不一致（smoke pack） | 無法統一錨點與粒子縮放 |
| 9 | 缺 seamless noise / normal map | Distortion、UV Scroll 這兩項規範內的能力（§1.1）目前**無素材可用** |

## 2.1 「建立 Fire Tornado」情境測試（現況）

以現有資料夾結構，Agent 找九種圖層的實際難度：

| 需求層 | 現況可否找到 | 障礙 |
|---|---|---|
| Core | 勉強 | 要猜 `fire_*` 還是 `flame_*`，且看不出誰細誰寬 |
| Noise | **找不到** | 全庫沒有可平鋪噪聲；搜 `noise` 會撈到 162 個「帶雜訊的遮罩」，全部不能 UV scroll |
| Mask | 可以 | light-masks 命名尚稱一致 |
| Spark | **會選錯** | `spark_*` 是電弧細絲，真正的火花在 `star_*` |
| Ember | 找不到 | 沒有 ember 概念，需由 `star_*`／`trace_*` 代用 |
| Smoke | 可以但有陷阱 | 兩套風格混用（灰階 vs 彩色），尺寸不一 |
| Ring | 可以 | `ring_a～c` |
| Glow | 可以 | `light_*`、`flare_01` |
| Trail | 勉強 | `trace_*` 名稱不直觀 |

**結論：九項中只有三項可靠。** 這正是需要 Asset Index 的理由。

## 2.2 改善方案（本次不搬檔）

**不採用**「把檔案搬進 core／noise／mask 等功能資料夾」的做法，理由：

- 素材庫是第三方套件的 Git repo，搬檔等於與上游分叉，日後更新／新增套件會衝突
- 一個素材常同時屬於多種用途（`circle_b` 既是 glow 也是 mask），實體資料夾只能歸一類
- 搬檔會讓既有的相對路徑失效

**採用**：保持實體結構不動，改以 **Asset Index（索引層）** 提供功能面的檢索。
分類活在 metadata 的 `type` / `shape` / `recommendedUsage` / `tags`，不活在資料夾。
唯一建議的實體調整是**未來新增**自製素材時放進獨立目錄（例如 `_custom/`），與第三方套件分離。

---

# 3. Asset Metadata Schema

設計原則：泛用、可移植、不依賴 Idle-RPG、不含本機絕對路徑、適合 JSON、可承載數千筆。

## 3.1 索引檔結構

```jsonc
{
  "schemaVersion": "1.0.0",
  "libraryId": "effects-materials",     // 邏輯名稱，不是路徑
  "generatedAt": "2026-08-31T00:00:00Z",
  "scannerVersion": "1.0.0",
  "assets": [ /* 見 3.2 */ ]
}
```

`libraryId` 是**邏輯識別碼**。實體位置由第 4 節解析，索引檔本身完全不含絕對路徑。

## 3.2 單筆資產

```jsonc
{
  // ---- 身分（自動） ----
  "assetId": "effects-materials/particle-pack/transparent/flame_04",
  "relativePath": "kenney_particle-pack/PNG (Transparent)/flame_04.png",
  "contentHash": "sha256:…",          // 檔案改名或移動後可重新對應
  "format": "png",
  "fileSize": 24576,

  // ---- 影像事實（自動） ----
  "dimensions": { "width": 512, "height": 512 },
  "trimmed": false,                    // 是否已裁邊（影響錨點）
  "colorModel": "palette",             // palette | rgb | rgba | gray
  "alpha": {
    "carrier": "alphaChannel",         // alphaChannel | luminance | none
    "mode": "straight",                // straight | premultiplied | none
    "coverage": 0.34                   // 非透明像素比例
  },
  "backgroundVariant": "transparent",  // transparent | blackBackground | whiteBackground | inverted
  "luminance": { "mean": 0.21, "max": 1.0, "centerBias": 0.62 },
  "tileable": { "seamless": false, "axes": "none" },   // none | u | v | uv

  // ---- 語意分類（AI 建議 ＋ 人工確認） ----
  "type": "particle",                  // 見 3.3
  "shape": "blob",                     // 見 3.3
  "visualStyle": "grayscaleMask",      // grayscaleMask | coloredArt | lineArt
  "tintable": true,                    // 由 visualStyle 推導，可人工覆寫
  "element": "neutral",                // neutral 為預設；灰階遮罩一律 neutral
  "blendModeHint": "alphaBlend",       // additive | alphaBlend | multiply | screen
  "animationType": "static",           // static | frameSequence | spriteSheet | proceduralUV
  "recommendedUsage": ["core", "smoke"],
  "tags": ["flame", "soft", "billow", "organic"],

  // ---- 群組（自動偵測 ＋ 人工確認） ----
  "variantGroup": "particle-pack/flame_04",   // 同圖不同背景變體共用
  "sequence": null,                    // { "groupId": …, "frameIndex": 3, "frameCount": 25 }

  // ---- 治理 ----
  "license": { "id": "CC0-1.0", "author": "Kenney", "source": "kenney.nl" },
  "excluded": false,
  "excludeReason": null,               // "packPreview" | "nonVfx" | "duplicate"
  "fieldSources": {                    // 每個語意欄位的來源，見第 6 節
    "type": "ai", "shape": "ai", "recommendedUsage": "ai",
    "element": "auto", "visualStyle": "auto", "blendModeHint": "ai"
  },
  "reviewStatus": "aiSuggested"        // auto | aiSuggested | humanConfirmed
}
```

## 3.3 列舉值

**type**（這是什麼東西）
`particle` / `mask` / `decal` / `flipbookFrame` / `spriteSheet` / `noise` / `gradientRamp` /
`normalMap` / `vectorSource` / `preview` / `nonVfx`

**shape**（長什麼樣，由圖像判定）
`point` / `disc` / `ring` / `cone` / `fan` / `streak` / `arc` / `blob` /
`star` / `filament` / `polygon` / `irregular`

**recommendedUsage**（可以拿來當 VFX 的哪一層——泛用 VFX 語彙，不含任何遊戲概念）
`core` / `noise` / `mask` / `spark` / `ember` / `smoke` / `ring` / `shockwave` /
`glow` / `trail` / `beam` / `distortion` / `decal` / `impact` / `aura`

**element**
`neutral`（預設）/ `fire` / `ice` / `lightning` / `wind` / `earth` / `water` / `light` / `dark`
> 灰階可染色素材一律 `neutral`。只有**預先上色**的素材（如 `explosion*`）才標實際元素。
> 這一條防止「檔名叫 fire 就標成火系」而讓冰系特效搜不到本可染色的素材。

## 3.4 相對本次需求的欄位增補說明

使用者列出的 12 個欄位全部保留。我增補了下列欄位，各有明確用途：

| 增補欄位 | 為什麼非有不可 |
|---|---|
| `contentHash` | 素材改名／搬移後仍能重新對應，Preset 不會斷鏈 |
| `backgroundVariant` | §1.5 第 3 點的黑方塊陷阱，本庫最高頻的錯誤來源 |
| `alpha.carrier` / `alpha.mode` | 決定 shader 取樣方式（alpha vs luminance、是否預乘） |
| `tileable` | Distortion／UV Scroll 只能用 seamless 素材，非有不可 |
| `tintable` | 灰階遮罩與預上色美術的分野，決定能否染色 |
| `variantGroup` | 讓「同一張圖的另一種背景」可一鍵切換，而不是重新搜尋 |
| `sequence` | 未來若導入真正的 flipbook，索引結構不必改版 |
| `trimmed` / `dimensions` | smoke pack 尺寸不一，錨點計算需要 |
| `luminance` | 排序與挑選的量化依據（例如「最亮的環」） |
| `license` | CC0 需保留出處；未來混入非 CC0 素材時必須能區分 |
| `excluded` / `excludeReason` | Preview.png、foliage 等不該進搜尋結果，但仍要留在索引裡以免每次掃描重新判斷 |
| `fieldSources` / `reviewStatus` | 區分自動、AI、人工三種來源，見第 6 節 |

## 3.5 規模考量

897 筆 × 約 700 bytes ≈ 620 KB 單一 JSON，可直接載入。
若素材成長到萬筆，切分策略：`index.json`（輕量：assetId／path／type／shape／usage／tags）
＋ `details/<libraryId>.json`（完整欄位），Asset Browser 先載輕量索引再按需取詳細。
本階段不需要，但 Schema 已預留 `schemaVersion` 供演進。

---

# 4. Asset Library Root 機制

## 4.1 目標

同一份 VFX Preset，在下列兩台電腦都能正常開啟：

```
Computer A   D:\MyGame\effects-materials
Computer B   E:\Assets\effects-materials
```

## 4.2 三層分離

```
┌─ 進 Git ─────────────────────────────────────────┐
│ vfx/libraries.json    宣告需要哪些 library（只有 libraryId 與版本）│
│ vfx/asset-index.json  assetId → relativePath ＋ metadata          │
│ vfx/presets/*.json    只引用 assetId                              │
└──────────────────────────────────────────────────┘
┌─ 不進 Git（本機設定）─────────────────────────────┐
│ vfx.local.json  或  環境變數 VFX_ASSET_ROOT_<LIBRARYID>          │
│   { "roots": { "effects-materials": "D:/MyGame/effects-materials" } } │
└──────────────────────────────────────────────────┘
```

- **Preset 只存 `assetId`**，絕不存路徑。
- **索引只存 `relativePath`**（POSIX 斜線），絕不存磁碟機代號。
- **絕對路徑只存在於本機設定**，且該檔加入 `.gitignore`。

## 4.3 解析順序

```
resolve(assetId)
  → 查 asset-index 取得 { libraryId, relativePath }
  → 依序尋找 libraryId 的 root：
       1. 環境變數 VFX_ASSET_ROOT_EFFECTS_MATERIALS
       2. vfx.local.json 的 roots[libraryId]
       3. 專案內建預設（例如 ./assets/<libraryId>）
  → 找不到 → 明確錯誤：「library 'effects-materials' 未設定，請設定 X 或 Y」
  → 回傳 root + relativePath
```

失敗時**必須**給出可執行的修正指示，不得靜默回退成空白貼圖。

## 4.4 瀏覽器端的現實限制

網頁不能讀 `D:\`。因此 root 機制分兩種消費者：

| 情境 | 解析結果 |
|---|---|
| VFX Editor（本機開發） | 由本機 dev server 把 library root 掛成靜態路徑（例如 `/assets/effects-materials/…`），Editor 取得 URL |
| 正式遊戲（發佈） | 需要一道 **export 步驟**：把 Preset 實際引用到的素材子集複製進專案的 `images/vfx/`，並產生一份精簡索引 |

> 這代表 Preset 不能假設「所有素材永遠都在」。
> Export 只帶走被引用的素材，這也是 `assetId` 必須穩定的原因。
> 具體 export 工具屬於下一階段，本次僅定義約束。

## 4.5 不污染 Git 的具體做法

- `vfx.local.json` 加入 `.gitignore`（**本次未修改 `.gitignore`**，屬非 VFX 檔案，待使用者指示）
- 提供 `vfx.local.example.json` 進版控作為範本
- 索引產生器輸出時強制檢查：若任何欄位含 `:\`、`\\` 或以 `/` 開頭的絕對路徑 → 產生失敗

---

# 5. Agent 自動分類策略

## 5.1 匯入管線

```
素材庫（唯讀）
    ↓
[1] Asset Scanner          檔案層事實
    ↓
[2] Image Analysis         像素層事實（不需 AI）
    ↓
[3] AI Tag 建議            語意判斷（Claude 看圖）
    ↓
[4] 人工確認               只確認高風險欄位
    ↓
asset-index.json
```

**重點：AI 只在第 3 階段介入。** 前兩階段能自動算出的絕不問 AI——
既省成本，也讓結果可重現（同一份素材重掃結果一致）。

## 5.2 各階段產出

**[1] Scanner（純自動，可重現）**
排除 `.git/`；取得 relativePath、contentHash、fileSize、format、dimensions、colorModel；
由資料夾慣例推 `backgroundVariant`（`PNG (Transparent)` → transparent、`Default` → blackBackground…）；
由檔名編號推 `variantGroup` 與可能的 `sequence`；比對 hash 找重複檔。

**[2] Image Analysis（純自動，需解碼像素，仍不需 AI）**
- alpha coverage、是否預乘（檢查 RGB 是否 ≤ A）
- 飽和度統計 → `visualStyle`：灰階 → `grayscaleMask`，彩色 → `coloredArt`
- 徑向亮度剖面 → 區分 `disc`（中心亮）／`ring`（環帶亮）／`cone`（單向漸層）
- 邊緣接縫比對（上下、左右邊界差異）→ `tileable.seamless`
- 亮度統計、內容 bounding box → `trimmed`、`luminance`

**[3] AI 判斷（Claude 看實際圖像）**
`shape` 的最終判定、`recommendedUsage`、`tags`、檔名與內容不符的修正
（例：`spark_04` → shape `filament`、usage `["spark","impact"]`、tag `crackle`）、
`blendModeHint`。
AI **必須看圖**，不得只讀檔名——這是本庫最容易出錯的地方（§1.5 第 4 點）。

**[4] 人工確認（只針對高風險）**
預上色素材的 `element`、授權資訊、`excluded` 判定、
以及少量「代表性素材」的 usage 覆寫（人挑出的首選素材可加 `tags: ["preferred"]`）。

## 5.3 欄位來源對照表

| 欄位 | 完全自動 | 適合 AI | 建議人工確認 |
|---|:---:|:---:|:---:|
| assetId / relativePath / contentHash / fileSize / format | ● | | |
| dimensions / colorModel / trimmed | ● | | |
| alpha.* / luminance | ● | | |
| backgroundVariant | ●（資料夾慣例） | ○（無慣例時） | |
| tileable | ● | | |
| visualStyle / tintable | ● | | ○（邊界案例） |
| variantGroup / sequence | ● | | ○ |
| type | ○ | ● | |
| shape | ○（幾何可推） | ● | |
| recommendedUsage | | ● | ○ |
| tags | | ● | |
| blendModeHint | ○（由變體推） | ● | |
| element | ●（灰階→neutral） | ○ | ●（預上色素材） |
| excluded | ●（Preview 慣例） | ○ | ● |
| license | ●（讀 License.txt） | | ● |

● 主要來源　○ 次要／備援

## 5.4 規模與成本

897 張全部交給 AI 看圖不划算。建議策略：

1. 先跑 [1][2]，得到全部 897 筆的事實層
2. AI 只看 **變體群組的代表圖**（同一 `variantGroup` 只看一張），
   估計約 350 張（particle-pack 96、light-masks 152、smoke 77、splat 36 之代表）
3. 群組內其餘素材沿用代表圖的語意欄位，只換 `backgroundVariant` 與 `blendModeHint`

這把 AI 判讀量降到約四成，且不損失分類品質。

---

# 6. Fire Tornado 選材模擬（紙上驗證）

需求：大型火焰龍捲——旋轉火焰主體、火星、少量煙霧、底部火環、Glow。

假設 Asset Index 已建立，Agent 以 `recommendedUsage` ＋ `shape` ＋ `tintable` ＋ `backgroundVariant` 查詢。
以下為**實際掃描到的素材**，非虛構：

| 圖層 | 首選素材 | 次選 | 選它的理由（來自 metadata，非檔名） |
|---|---|---|---|
| 火焰主體（旋轉核心） | `kenney_particle-pack/PNG (Black background)/fire_01.png`<br>`fire_02.png` | `flame_01～03` | 抽樣確認為**湍流雲狀灰階**，`tintable: true` 可染成火色；黑底版供加法混合，疊三～四層不同轉速即成旋轉火柱 |
| 渦流輪廓 | `kenney_light-masks-1.0/Default/cone_composed_c_noise.png` | `cone_b_blur_noise`、`cone_a` | 實測為**倒錐形漸層**，正好是龍捲的體型；`_noise` 版邊緣破碎，比純錐更像火焰 |
| 旋轉感補強 | `PNG (Black background)/twirl_01.png`～`03` | `slash_01～04` | 實測為 **C 形弧帶**（不是完整螺旋），沿 Y 軸堆疊並反向旋轉可讀出「轉」的訊息 |
| 火焰舌 | `flame_05.png`／`flame_06.png` ＋ `Rotated/flame_05_rotated.png` | `fire_02` | 縱向火舌；預旋轉版省一次 runtime 旋轉 |
| 火星 | `star_08.png`（四芒星閃光） | `star_01～09`、`spark_05/06`＋rotated | ⚠️ **不選 `spark_04`**——抽樣顯示它是細絲狀電弧（`shape: filament`），適合雷系不適合火星。真正的星芒在 `star_*` |
| 餘燼拖尾 | `trace_02.png`（縱向細長條紋） | `trace_01～07`＋rotated | 實測為上下漸淡的縱向streak，正好是餘燼上升的拖尾 |
| 煙霧（少量） | `PNG (Transparent)/smoke_04.png`～`smoke_06` | `blackSmoke08～16` | 優先選 particle-pack 的灰階版：512² 尺寸統一、可染色成暗紅煙；smoke-particles 那套**尺寸不一**（每張都不同），錨點難統一 |
| 底部火環 | `kenney_light-masks-1.0/Default/ring_a.png` | `ring_b`、`circle_rings_a` | 抽樣確認為**黑底白色細環**，加法混合可直接用、不必去背；地面環用 `Inverted` 或 `Transparent` 版視混合模式而定 |
| Glow | `PNG (Black background)/light_02.png` | `light_01/03`、`flare_01`、light-masks `circle_b` | 實測為柔和圓形光暈，中心亮度平滑衰減，適合當整體輝光與地面照亮 |
| 地面燒痕（加分） | `scorch_01～03` | `kenney_splat-pack/PNG/Double (512px)/splat*` | 龍捲移動後留痕 |

## 6.1 這次模擬暴露的兩個素材缺口

| 缺口 | 影響 | 目前唯一替代 |
|---|---|---|
| **無 seamless noise** | UV Scroll 的火焰流動、Distortion 熱扭曲都做不了。`circle_a_noise` 之類不可平鋪，捲動會出現接縫 | 只能用多層不同轉速的 `fire_*` 疊加**模擬**流動，或改由 shader 程序噪聲生成 |
| **無 distortion 素材** | 規範 §1.1 列出的 Distortion 能力無素材支撐 | 同上，需程序生成或後續補素材 |

## 6.2 這次模擬證明了什麼

Metadata 設計是否有用，看它能不能擋掉錯誤選材。三個實際被擋下的錯誤：

1. `spark_04` 被 `shape: filament` 擋下——只看檔名必選它當火星。
2. 加法混合的火環自動選到 `Default`（黑底）而非 `Transparent`，靠的是 `backgroundVariant` ＋ `blendModeHint`；沒有這兩個欄位就會出黑方塊。
3. 煙霧優先 particle-pack 而非 smoke-particles，靠的是 `dimensions` 一致性與 `tintable`；`explosion*` 因 `tintable: false` 被排除在可染色需求外。

**若沒有 Asset Index，這三個錯誤都會發生。** 設計成立。

---

# 7. 下一階段建議

依 `VFX_AGENT_WORKFLOW.md` §3.4，是否執行由使用者決定。建議順序：

1. **先確認本文件的 Schema**（第 3 節）。Schema 定版前不產生 `asset-index.json`——
   欄位改動會讓已標註的資料作廢。
2. **實作 Asset Scanner（階段 1＋2）**，輸出不含語意欄位的事實層索引。
   這一步純程式、可重跑、無 AI 成本，屬於 §4.3「新 VFX Layer」等級，建議完成後送 Codex Review。
3. **AI 標註（階段 3）**，以變體群組代表圖為單位（§5.4），約 350 張。
4. **補素材缺口**：seamless noise 與 distortion 用貼圖。
   建議放進與第三方套件分離的獨立目錄，並在索引中以 `libraryId` 區分來源。
5. **Asset Browser 與 Editor** 再開始——屆時索引已可用，Editor 不必自己掃硬碟。

暫不建議的事：
- 不要為了分類而搬動第三方套件的檔案（§2.2）
- 不要在 Schema 定版前寫任何讀取索引的 Runtime 程式
- 不要把 library root 寫進任何 Preset 或程式碼
