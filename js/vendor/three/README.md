# three.js（第三方程式庫）

- 版本：three@0.160.0（npm 官方套件，2026-10-27 以 `npm pack three@0.160.0` 取得）
- 授權：MIT（全文在同資料夾 `LICENSE`，版權 © 2010-2023 three.js authors）
- 只用於內測的 3D 主角表現（`js/hero3d.js`），正式版不載入。

## 收錄的檔案（原封不動，未修改）

| 本資料夾 | 來源（套件內路徑） |
|---|---|
| `three.module.min.js` | `build/three.module.min.js` |
| `loaders/GLTFLoader.js` | `examples/jsm/loaders/GLTFLoader.js` |
| `utils/BufferGeometryUtils.js` | `examples/jsm/utils/BufferGeometryUtils.js` |

`GLTFLoader.js` 與 `BufferGeometryUtils.js` 用裸模組名稱 `'three'` 匯入，所以 `index.html` 有一段 `importmap` 把 `three` 對到 `js/vendor/three/three.module.min.js`；
載入只發生在 `Hero3D` 第一次 `create()`（動態 `import()`），不開 3D 模式就不會下載。

升級時整組一起換，並更新本檔的版本與日期。
