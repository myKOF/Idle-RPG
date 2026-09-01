# VFX_ASSET_SCHEMA.md

# VFX Asset Metadata Schema（定版 v1）

狀態：**schemaVersion 1 已定版**，Scanner v1 依此實作。
適用範圍：`docs/vfx/VFX_AGENT_WORKFLOW.md` §1.1。
盤點依據：`docs/vfx/VFX_ASSET_LIBRARY_DESIGN.md`。

本文件是**規格**（契約），設計過程與素材庫盤點在 `VFX_ASSET_LIBRARY_DESIGN.md`。

---

# 0. 設計目標與非目標

目標（依序）：

1. Agent 能快速找到適合的 VFX 素材
2. VFX Editor Asset Browser 能搜尋／篩選
3. VFX Preset 能穩定引用素材
4. Scanner 可重複執行且結果一致
5. 換電腦不會失效
6. 未來可增加新素材
7. Metadata 不過度複雜

**非目標：** 這不是 DAM 系統。沒有版本控管、沒有審核流程、沒有縮圖、沒有權限模型。
「可能有用」不是保留欄位的理由——只保留有明確消費者的欄位。

---

# 1. 欄位分級

## A. Core — 必要且穩定，正式 index 必存

| 欄位 | 型別 | 說明 |
|---|---|---|
| `assetId` | string | 穩定識別碼，Preset 唯一應該引用的東西（§2） |
| `package` | string | 相對路徑第一段目錄，由結構推導，不硬編套件名 |
| `relativePath` | string | 相對 Library Root 的 POSIX 路徑 |
| `format` | string | `png` / `svg` |
| `fileSize` | number | 位元組 |
| `contentHash` | string | `sha256:…`，供搬移／改名後重新對應 |

索引層級：`schemaVersion`、`kind`、`libraryId`、`scanner`、`assetCount`。

## B. Derived — Scanner 可重算，不需人工維護

全部放在 `facts` 底下。**每一項都是量測值，沒有語意判斷。**

| 欄位 | 說明 |
|---|---|
| `facts.dimensions` | `{width,height}`；SVG 無尺寸屬性時為 `null` |
| `facts.dimensionsSource` | SVG 專用：`attributes` / `viewBox` / `null` |
| `facts.colorModel` | `gray`/`rgb`/`palette`/`grayAlpha`/`rgba` |
| `facts.bitDepth` | 1/2/4/8/16 |
| `facts.hasAlphaChannel` | 含 palette + tRNS |
| `facts.pixelsAnalyzed` | 是否真的解碼過像素（見 §4） |
| `facts.alpha` | `{mean, visibleRatio, borderMean}` |
| `facts.luminance` | `{mean, max, borderMean, borderNearBlackRatio, borderNearWhiteRatio}` |
| `facts.saturation` | `{mean, max}` — 區分灰階可染色 vs 預先上色 |
| `facts.contentBounds` | `{x,y,width,height}`，alpha>0 的外接矩形 |
| `facts.trimmed` | 內容是否貼齊四邊（＝已被裁邊） |
| `facts.edgeContinuity` | `{u,v}` 對邊吻合度量測（**不是** seamless 判定，見 §4） |
| `facts.backgroundVariant` | `transparent`/`blackBackground`/`whiteBackground`/`opaqueOther`（規則見 §3） |

## C. Semantic — 需要 AI／人工看圖才能判斷

**Scanner v1 完全不產生這些欄位。** 留待後續 AI 標註階段，屆時會以獨立檔案疊加，
不改寫 Scanner 產出的事實層。

`type`、`shape`、`visualStyle`、`tintable`、`element`、`blendModeHint`、
`recommendedUsage`、`tags`

## D. Optional — 延後，理由見 §5

`variantGroup`、`sequence`、`license`、`excluded`/`excludeReason`、
`fieldSources`/`reviewStatus`、`alpha.mode`（預乘判定）、`tileable.seamless`、
`luminance.centerBias`

---

# 2. assetId 策略

## 2.1 三種方案比較

| 方案 | 可讀性 | 搬移／改名 | 內容修改 | 同名檔 | 跨套件 | 判定 |
|---|---|---|---|---|---|---|
| **1. relativePath-based** | 高 | ✗ 斷鏈 | ✓ 不受影響 | ✓ 路徑天然唯一 | ✓ | 可用 |
| **2. hash-based** | **低**（除錯痛苦） | ✓ 免疫 | **✗ 一改就變新 id** | ✓ | ✗ 相同檔會合併 | 不採用 |
| **3. package + 相對路徑** | 高 | ✗ 斷鏈 | ✓ 不受影響 | ✓ | ✓ 明確分群 | **採用** |

不採用 hash 當主鍵的關鍵理由：**素材被重新輸出（調整、壓縮、換版本）是常態**，
hash 一變 Preset 就整批斷鏈，而這正是最該保護的東西。
且 `flame_04` 比 `a3f9c1d2…` 好除錯太多。

## 2.2 定案：可讀主鍵 ＋ 內容雜湊當修復鍵

```
assetId    = <package>/<套件內相對路徑>，全小寫 slug 化，保留副檔名
contentHash= 獨立欄位，不是主鍵
```

- 搬移／改名時，用 `contentHash` 比對即可寫出「舊 id → 新 id」的修復對照表，
  這正是 hash 方案的好處，但不必付出「內容一改就斷鏈」的代價。

**slug 規則**：轉小寫；`[a-z0-9._-]` 以外的字元換成 `-`；連續 `-` 收合；去頭尾 `-`。

```
kenney_particle-pack/PNG (Transparent)/flame_04.png
  → kenney_particle-pack/png-transparent/flame_04.png
```

**保留副檔名**：同目錄下 `foo.png` 與 `foo.svg` 才不會相撞。

**滿足的要求**：不含絕對路徑 ✓　跨電腦一致 ✓　重跑一致 ✓　與掃描順序無關 ✓
同名不同路徑不衝突 ✓　跨 package 不衝突 ✓　不依賴自增 ID ✓

**衝突處理**：產生後全表檢查，撞到就**直接失敗**並印出兩個來源路徑。
不靜默改名、不加序號——那會讓 id 依賴掃描順序。

---

# 3. 判定規則（可稽核）

Scanner 只有兩處做「分類」，兩處的規則都寫死在此，可被稽核與重算：

**`backgroundVariant`**

```
alpha.mean < 0.999                        → transparent      形狀由 alpha 承載
全不透明 ＋ 邊框近黑像素比例 ≥ 0.9        → blackBackground   加法混合可直接用
全不透明 ＋ 邊框近白像素比例 ≥ 0.9        → whiteBackground
其他                                      → opaqueOther
```

用「近黑像素**比例**」而不是「邊框平均亮度」：光錐之類的圖形會碰到其中一邊，
用平均值會把整張黑底圖誤判。近黑＝luma ≤ 0.02，近白＝luma ≥ 0.98。

**`trimmed`**

```
contentBounds 寬高 == 影像寬高  →  true（內容貼齊四邊，素材已被裁邊）
```

---

# 4. 刻意不做的判定（避免假精確）

| 不做的事 | 原因 |
|---|---|
| `tileable.seamless` 布林判定 | 只量 `edgeContinuity`。整圈透明的孤立素材對邊完全吻合會得到 1.0，但它並不是可平鋪紋理。要下判定還需要「邊界非空」等額外條件，v1 不猜 |
| `alpha.mode`（是否預乘） | 從像素無法可靠判定：RGB ≤ A 也可能只是圖本身偏暗 |
| 交錯（Adam7）PNG 的像素統計 | 不解碼，只給標頭事實並標記 `pixelsAnalyzed: false`。本素材庫 0 張，但不能因此產生假資料 |
| 任何語意欄位 | 需要看圖，屬 AI 階段 |

原則：**演算法不可靠時，寧可不產生欄位，也不要產生假精確的資料。**

## 4.1 解析失敗一律是硬錯誤

任何素材無法解析（CRC 不符、截斷、非法 colorType／bitDepth 組合、缺 IEND／IDAT／PLTE、
超過像素上限）時，Scanner **不寫出索引並以 exit 2 結束**。

理由：若只記錄警告仍照常寫出，該素材會從索引裡靜默消失，而 Scanner 回報成功；
之後 `--check` 還會把這份殘缺索引當成正確答案。「少一筆」比「壞一筆」更難發現。

PNG 驗證項目：chunk CRC、IEND 存在且長度為 0、IDAT 存在、
壓縮／濾波方法必須為 0、colorType／bitDepth 組合合法、
PLTE 長度為 3 的倍數且 ≤768、palette 索引不得越界、
tRNS 長度與 colorType 相符、解壓後 scanline 長度必須完全相等（不足不補 0、多出也算錯）、
像素數上限 64M（≈8192×8192，交錯 PNG 同樣受限）。

SVG 驗證項目：必須有 `<svg>` 根元素（否則視為解析失敗）。
尺寸取自 `width`/`height`（絕對單位依 1in = 96px 換算）或 `viewBox`；
百分比與 em/rem 等相對單位無從換算成像素，`dimensions` 回 `null` 而不是硬套數值。

---

# 5. 上一版 12 個增補欄位的重新檢查

使用者要求重新檢視，避免「可能有用」就永久保存。結果：**保留 4 個、延後 8 個。**

| 欄位 | 決定 | 理由 |
|---|---|---|
| `contentHash` | **保留**（升為 Core） | assetId 的修復鍵，有明確消費者 |
| `backgroundVariant` | **保留**（B） | 盤點證實是本庫最高頻的出錯來源（選錯變體＝黑方塊），且可由像素可靠判定 |
| `alpha`（coverage 等） | **保留**（B） | 決定取樣方式，且是 backgroundVariant 的輸入 |
| `trimmed` / `dimensions` | **保留**（B） | smoke pack 每張尺寸不同，錨點計算需要 |
| `tileable.seamless` | 延後 | 判定不可靠（§4）；只留 `edgeContinuity` 量測值 |
| `alpha.mode`（預乘） | 延後 | 無法可靠判定（§4） |
| `variantGroup` | 延後 | 消費者（Asset Browser）還不存在；且跨目錄同名分群可能誤併 |
| `sequence` | 延後 | 盤點已證實本庫的編號檔是變體不是動畫幀，目前無資料可填 |
| `license` | 延後 | 靜態且以 package 為單位，不需逐筆存；需要時再補 package 層級表 |
| `excluded` / `excludeReason` | 延後 | 「哪些該排除」（Preview.png、非 VFX）是語意判斷，不屬事實層 |
| `fieldSources` / `reviewStatus` | 延後 | v1 沒有語意欄位，沒有東西需要標註來源 |
| `luminance.centerBias` | 延後 | 形狀線索，屬語意階段 |

---

# 6. Asset Library Root

## 6.1 三層分離

```
進 Git ──────────────────────────────────────────
  vfx/asset-index.json           assetId → relativePath ＋ facts
  vfx/library.local.example.json 設定範本
  （未來）vfx/presets/*.json      只引用 assetId

不進 Git ────────────────────────────────────────
  vfx/library.local.json         本機絕對路徑（.gitignore 已排除）
```

## 6.2 解析順序（`tools/vfx/vfx-library-root.cjs`，Scanner 與未來 Editor 共用）

```
1. 呼叫端指定（Scanner 的 --root）
2. 環境變數 VFX_ASSET_ROOT_<LIBRARY_ID>      例：VFX_ASSET_ROOT_EFFECTS_MATERIALS
3. 環境變數 VFX_ASSET_LIBRARY_ROOT           （僅預設 library）
4. vfx/library.local.json
5. 都沒有 → 明確錯誤 ＋ 三種設定方式的指示，不靜默回退
```

**libraryId 格式**：`^[a-z0-9][a-z0-9-]*$`（小寫英數與連字號，英數開頭）。

限制成這樣是為了讓 `libraryId → 環境變數名稱` 一對一：
若同時允許 `-`、`_` 與空白，`a-b`／`a_b`／`a b` 會映射到同一個環境變數名稱，
多素材庫時可能解析到錯誤的 Root。不合法的 libraryId 直接拒絕。

## 6.3 可移植性是可執行檢查，不只是約定

Scanner 寫出索引**前**掃描整棵 JSON，出現下列任一情況即拒絕寫出：

- 磁碟機代號（`X:\` 或 `X:/`）
- 反斜線
- 以 `/` 開頭的絕對路徑
- 素材庫 Root 的絕對路徑字串

換電腦只需要重新指定 Root，索引與 Preset 完全不用改。

---

# 7. 決定性（Deterministic Output）

同樣的素材庫內容，重跑必須產生**位元相同**的 `asset-index.json`：

- **不含掃描時間**——時間戳會讓每次重掃都產生無意義 diff
- 目錄項目依名稱排序後遍歷，與檔案系統回傳順序無關
- 資產依 `assetId` 排序
- 所有浮點數四捨五入到小數 4 位
- 固定 2 空格縮排、結尾換行

驗證方式：`node tools/vfx/asset-scanner.cjs --check`（不同則 exit 1）。

---

# 8. 索引格式

```jsonc
{
  "schemaVersion": 1,
  "kind": "vfx-asset-index",
  "libraryId": "effects-materials",
  "scanner": { "name": "asset-scanner", "version": "1.0.0" },
  "assetCount": 943,
  "assets": [
    {
      "assetId": "kenney_particle-pack/png-transparent/fire_01.png",
      "package": "kenney_particle-pack",
      "relativePath": "kenney_particle-pack/PNG (Transparent)/fire_01.png",
      "format": "png",
      "fileSize": 41234,
      "contentHash": "sha256:…",
      "facts": { /* §1 B 區全部欄位 */ }
    }
  ]
}
```

---

# 9. 演進規則

- 新增 B 區欄位 → `schemaVersion` 不變（重掃即可補齊）
- 移除或改變既有欄位語意 → `schemaVersion` +1
- 新增 C 區語意欄位 → 以**獨立檔案**疊加（例如 `vfx/asset-semantics.json`），
  不寫回 `asset-index.json`。事實層與判斷層分離，重掃才不會覆蓋人工標註。
