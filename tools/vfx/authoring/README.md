# VFX Preset 製作工具（authoring）

這個目錄是 **製作階段** 的工具，不是 Runtime 的一部分；遊戲與 Editor 都不載入它。
設計與交接說明在 `docs/vfx/VFX_RUNTIME_ADAPTER.md`。

| 檔案 | 用途 |
| --- | --- |
| `vfx-catalog.cjs` | 特效目錄：`PRESETS`（每個 preset 的 id／家族／製作簡述／名目尺寸）、技能表與狀態表每一列的角色對應（`skillRoles`／`SKILLS2_VFX`／`STATUS_VFX`）、普攻／敵方／潛力的固定對應 `COMBAT_DEFAULTS` |
| `preset-kit.cjs` | 製作工具箱：`kit.sprite / particle / procedural` 建圖層、`kit.write` 驗證（`VFXCore.validatePreset`＋assetId 存在性）後以 canonical 形式寫到 `vfx/presets/<id>.json`、`kit.probe` 無畫面模擬回報尺寸與粒子數；`kit.A` 已驗證存在的素材捷徑、`kit.T` 色票、`kit.C` 常用曲線、`kit.px(n)`＝讓 512px 素材顯示約 n px |
| `author/<family>.cjs` | 各家族的製作腳本（目前只有 `hits.cjs`：13 份受擊特效）。新家族照同樣寫法：`node tools/vfx/authoring/author/<family>.cjs` |
| `fill-vfx-cells.cjs` | 依目錄把特效欄位填進 `config/CSV/Skills.csv`、`Skills2.csv`、`Status.csv`（前置：`node tools/config_tables.cjs --gen` 已產生欄位；之後 `--apply --write` 回寫 JS） |
| `skills-vfx-facts.json` | 舊技能表（SKILLS）逐技能推導出的 fxKind／variant／elem，`fill-vfx-cells.cjs` 用它決定舊技能的角色 |

## 製作一個新家族

```
node -e "const c=require('./tools/vfx/authoring/vfx-catalog.cjs');for(const [id,p] of Object.entries(c.PRESETS)) if(p.family==='slash') console.log(id,'|',p.nominal,'|',p.brief)"
```

1. 讀簡述與名目尺寸（`nominal`），對照 `scratch/vfx-inventory/asset-palette.txt` 挑素材（描述是實際看圖寫的，檔名會騙人）。
2. 寫 `author/<family>.cjs`，用 `kit.write({ id, duration, loop, layers: [...] })`
   （`kit.write` 會一併寫出 `vfx/layouts/<id>.json`，見下方「單一根群組」）。
3. `kit.probe(id)` 核對 bbox 與名目尺寸（受擊≈±40px、爆發／地板半徑 100px、天降 y∈[-500,0]、狀態 y∈[-70,10]）。
4. `node tools/vfx/export-assets.cjs` 匯出素材、`node --test tests/vfx-core.test.cjs tests/vfx-editor-save.test.cjs` 驗證合法且 canonical。
5. 開 Editor 目視：`啟動VFX編輯器.bat <preset-id>`。

## 單一根群組（使用者規則 2026-09-03）

**每份 Preset 做好之後，它的所有圖層一律收進「一個」群組。**

原因：Editor 之後要能同時打開多份特效一起編輯，那時候「一列＝一個特效」才分得開；
散在根層級的圖層會和別的特效混成一鍋。

- 分組資料在 `vfx/layouts/<presetId>.json`（authoring metadata），**不進 Preset、不進 Runtime、不進 shipped build**，
  因此這條規則對畫面零影響（設計理由見 `tools/vfx/editor/layout-schema.js` 檔頭）。
- `kit.write()` 已自動照做：群組 `id` 與 `name` 都取 preset id（多份同時打開時要一眼看得出這一組是誰的）。
- 手動補既有 preset：`kit.writeRootGroupLayout(presetJson)`。
- Layout schema 目前沒有巢狀群組，因此「一個特效一個群組」就是扁平的一層；
  真的需要再細分時，請在 Editor 裡自己拆，不要改這條預設規則。

慣例（Runtime 依此縮放，做錯尺寸整批都會播錯）：+X 向右、+Y 向下、原點＝錨點；
飛行物朝 +X 飛；光束／連鎖段沿 +X 長 200px；天降從 y≈-500 落到原點；
地板為俯視、縱向壓 0.5～0.62；狀態光環原點在腳底、身高 60px；
黑底素材（`png-black-background`、`light-masks-1.0/default`）一律 `add` 混合。
