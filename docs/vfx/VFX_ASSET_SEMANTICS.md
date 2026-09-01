# VFX_ASSET_SEMANTICS.md

# VFX Asset Semantic Metadata（定版 v1）

狀態：`schemaVersion 1`。事實層規格見 `docs/vfx/VFX_ASSET_SCHEMA.md`。

---

# 0. 兩層永久分離

```
vfx/asset-index.json      Fact Layer      客觀量測，Scanner 產生，可重跑重建
vfx/asset-semantics.json  Semantic Layer  AI 判斷，看圖產生，Scanner 不會覆蓋
```

- 語意層以 `assetId` 關聯事實層，**不複製**任何事實欄位
  （dimensions／hash／path／alpha 統計一律不進語意檔）。
- Scanner 重跑只改事實層；語意層由 `semantic-build.cjs` 獨立產生。
- 兩層的併查在 `semantic-query.cjs`，事實衍生欄位一律**即時推導**。

---

# 1. 語意紀錄格式

```jsonc
{
  "assetId": "kenney_particle-pack/png-transparent/star_08.png",
  "kind": "vfx",                       // vfx | nonVfx | preview
  "shape": "star",
  "usage": ["spark", "glow", "impact"],
  "element": "neutral",
  "tags": ["radial", "symmetric", "sharp"],
  "confidence": "high",                // high | medium
  "source": "evidence",                // evidence | group | family
  "ruleId": "particle/star",
  "needsReview": true                  // 只有需要人工確認時才出現
}
```

`kind !== "vfx"` 時不需要 shape／usage／element（非特效素材沒有這些語意）。

---

# 2. 受控詞彙表

定義在 `tools/vfx/vfx-semantic-vocab.cjs`，封閉式；要加字必須改該檔並升版。
封閉的理由：開放標籤會長出 fiery／fire-like／hot-fire／burning 這種近義詞，讓搜尋失效。

| 欄位 | 值 |
|---|---|
| kind | vfx, nonVfx, preview |
| shape | disc, ring, cone, fan, star, streak, arc, filament, cloud, splat, polygon, caustics, silhouette, irregular |
| usage | core, particle, spark, ember, smoke, glow, ring, trail, beam, mask, impact, scorch, distortion, noise |
| element | neutral, fire, ice, water, lightning, poison, nature, dark, light |
| tags | soft, sharp, noisy, smooth, wispy, dense, radial, directional, swirl, symmetric, hollow, layered |
| confidence | high, medium |

## 2.1 刻意不放進語意層的欄位

這五項全部可由事實層推導，存進語意層就是複製事實資料：

| 欄位 | 推導規則（`vfx-semantic-vocab.cjs`） |
|---|---|
| `blendModeHint` | backgroundVariant：blackBackground→additive、transparent→alphaBlend、whiteBackground→multiply、opaqueOther→null |
| `tintable` | `saturation.mean ≤ 0.05` ＝ 灰階可染色（未另外提供 `visualStyle` 欄位，灰階／彩色的區分就是這一項） |
| `tileable` | `edgeContinuity.u/v > 0.97` **且** `backgroundVariant === 'opaqueOther'`（邊界非均勻）**且** trimmed |
| `aspect` | contentBounds 長寬比 ≥1.6 → tall／wide，否則 square |

`tileable` 為何要加「邊界非均勻」：全庫符合「對邊吻合」的有 320 筆，
但其中絕大多數是整圈黑邊的孤立圖案（對邊當然吻合）。加上邊界非均勻後只剩 **35 筆**，
即 `water_caustics_*` 與 `foliage_canopy_*`——這才是真正可平鋪的圖樣。

---

# 3. element 規則（可重用性的核心）

**灰階可染色素材一律 `neutral`，即使檔名或套件叫 fire。**

目的是讓同一份素材同時服務 Fire Tornado／Ice Tornado／Poison Tornado／Dark Tornado。
`particle-pack` 的 `fire_*`、`flame_*` 實測都是灰階湍流雲團，因此全部 `neutral`。

只有**圖片本身帶有不可忽略的元素色彩**才標實際元素，目前只有三組：

| 素材 | element | 飽和度 | 需人工確認 |
|---|---|---|---|
| `smoke-particles/explosion*` | fire | 0.67 | ✓ |
| `smoke-particles/fart*` | poison | 高（黃綠） | ✓（poison 或 nature） |
| `smoke-particles/flash*` | light | 高（黃白） | ✓（light 或 fire） |

`semantic-query.cjs --validate` 會強制檢查這條規則：
任何 `tintable === true` 卻被標成非 neutral 的紀錄都會讓驗證失敗。

---

# 4. 語意如何傳播（confidence 的來源）

標註輸入是 `vfx/semantic-rules.json`，每條規則都必須列出**實際看過的代表圖**。

| source | 意義 | confidence |
|---|---|---|
| `evidence` | 規則裡明列、AI 實際看過的圖 | high |
| `group` | 與 evidence 同一候選群組——**像素簽章證實是同一圖形的不同載體** | high |
| `family` | 只由命名樣式匹配到，未經像素確認 | medium |

`family` 傳播只在規則明示 `propagation: "family"` 時才發生。
沒有任何規則命中的素材**不收錄**，不硬猜（目前 2 筆）。
`low` 信心不存在於詞彙表——會落到 low 的一律不收錄。

## 4.1 候選分組不是靠檔名

`semantic-grouping.cjs` 先以 (package, 正規化檔名) **提出候選**，
再要求 16×16 形狀簽章的平均絕對差 ≤ 0.06 才成組；通不過的各自獨立。

簽章依載體正規化強度來源：有 alpha 用 alpha、白底用 (1−亮度)、其餘用亮度，
再做對比正規化，因此同一圖形的三種載體會得到幾乎相同的簽章。

實測：`ring_a` 的 Default／Inverted／Transparent 三個載體距離 **0**；
`fire_01` 的兩個載體距離 0.031。943 筆 → 550 組（269 單、169 對、112 三）。

---

# 5. 已知限制

1. **`aspect` 只對 alpha 載體有意義。** 不透明素材（黑底／白底）的 `contentBounds`
   必然是整張圖，`aspect` 恆為 square。
   要用形狀找素材就查 alpha 載體，找到後再用候選分組換成需要的混合載體
   （見 §6 的餘燼那一層）。
2. **排序是「信心 → assetId」，不是相關度排序。** 這是決定性的代價；
   真正的相關度排序屬於 Asset Browser 階段。
3. **`preview` 與 `nonVfx` 的判定不是看圖判定**（依位置＋命名＋格式），信心為 medium。
4. 未收錄：`flare_01`（2 個載體）——沒看過就不標。

---

# 6. Fire Tornado 選材驗證（純查詢，未寫死答案）

| 圖層 | 查詢條件 | 命中 | 首選 |
|---|---|---|---|
| 旋轉火焰主體 | `usage=core shape=cloud element=neutral tintable blend=additive` | 30 | `particle-pack/…/fire_01.png` |
| 渦流／螺旋感 | `tag=swirl blend=additive` | 3 | `particle-pack/…/twirl_01.png` |
| 龍捲體型 | `shape=cone usage=core blend=additive` | 8 | `light-masks/default/cone_composed_c_noise.png` |
| 火星 | `usage=spark shape=star blend=additive` | 9 | `particle-pack/…/star_02.png` |
| 餘燼拖尾 | `usage=ember aspect=tall blend=alphaBlend` | 7 | `particle-pack/…/trace_02.png` |
| 少量煙霧 | `usage=smoke shape=cloud tintable blend=alphaBlend` | 70 | `particle-pack/…/smoke_04.png` 等 |
| 地面火環 | `usage=ring shape=ring blend=additive` | 31 | `light-masks/default/ring_a.png` |
| Glow | `usage=glow shape=disc blend=additive` | 26 | `light-masks/default/circle_b.png` |
| 噪聲／扭曲 | `usage=noise tileable` | 28 | `light-masks/default/water_caustics_a.png` |

三個關鍵驗證點：

- **`spark_*` 沒有出現在「火星」結果裡**——它被標成 `shape=filament`，
  查 `shape=star` 自然排除。純檔名搜尋必然選錯。
- **每一層都拿到正確混合載體**：查 `blend=additive` 得到黑底版，
  不會拿到透明版疊出黑方塊。
- **`fire_*` 全部 `element=neutral`**，所以把查詢改成 `element=ice` 也能拿到同一批素材。

---

# 7. 演進規則

- 新增規則或補標未分類素材 → 重跑 `semantic-build.cjs`，`schemaVersion` 不變
- 詞彙表增刪字 → `schemaVersion` +1
- 事實層重掃 → 語意層不受影響（兩層唯一的連結是 assetId）
- 若 assetId 因素材搬移而改變 → 用事實層的 `contentHash` 重新對應，再更新規則
