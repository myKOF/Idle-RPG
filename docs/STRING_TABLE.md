# String 表（顯示文字）使用說明

規範：`AI_RULES.md` 第 8.10 節。所有顯示給玩家的文字（不屬於其他配置表的）都登記在 `config/Excel/String.xlsx`，程式用編號取字。

## 資料流

```
config/Excel/String.xlsx   ← 唯一來源（人工編輯；AI 一律用 tools/excel-update-sheets.ps1 寫入）
   │  套用參數.bat 第 2 步（xlsx_to_csv）
   ▼
config/CSV/String.csv
   │  套用參數.bat 第 2b 步（tools/string-table/apply_strings.cjs）
   ▼
js/strings_data.js         ← 自動產生，勿手改；index.html 的 ?v= 同步更新
   │  index.html <script>／Worker importScripts
   ▼
js/strings.js              ← STR(編號, 參數…)、Strings.*、HTML data-str 綁定
```

- Worker 載入同一份資料檔：版本字串由 `bridge.js` 以網址 `sv=` 傳入，語言以 `lang=` 傳入，所以改文字不必動 `sim.worker.js`。
- `apply_strings.cjs` 會檢查：編號為不重複的正整數、繁體中文不得空白、簡體／英文有填時 `{N}`／`{名稱}` 必須與繁體中文相同。有錯就不寫檔。

## 在程式碼裡取字

```js
STR(1912)                           // 直接取字
STR(1919, prog, def.count)          // 位置參數：表格內的 {0}、{1}…
STR(1920, { name: n, reward: r })   // 具名參數：表格內的 {name}、{reward}
```

- 代入的值原樣放進字串，**不做 HTML 跳脫**；要放進 `innerHTML` 的使用者可控值照舊先 `esc()`。
- 缺少的參數保留 `{N}` 原樣，找不到編號回傳 `[#編號]`（並在 console 警告一次）。
- 簡體／英文欄空白時退回繁體中文。語言來源：網址 `?lang=zh-TW|zh-CN|en`，其次 `localStorage.ir_lang`；`Strings.setLang()` 會存起來，重新整理後生效。

## 在 index.html 取字

```html
<div data-str="1912"></div>                          <!-- 文字 -->
<div data-str-html="1924"></div>                     <!-- innerHTML（字串含標記時） -->
<button data-str-attr="data-tt-desc:1926;aria-label:1915"></button>   <!-- 屬性 -->
```

元素內不再放中文。動態產生的元素呼叫 `Strings.applyDom(root)`。

## 新增或修改一條文字

1. 用 `node tools/string-table/find_id.cjs 關鍵字`（或 `模塊:戰鬥`）找有沒有現成的；沒有就用 `tools/excel-update-sheets.ps1` 在 Excel 新增一列（編號接續最大值，填功能模塊、用途說明、替代字符參數說明、繁體中文）。
2. 跑 `套用參數.bat`（或 `node tools/xlsx_to_csv.cjs`＋`node tools/string-table/apply_strings.cjs`）。
3. 程式改用 `STR(編號, …)`。
4. 檢查：`node tools/string-table/build_string_csv.cjs --check` 列出仍寫死的字串；「未登記」必須是 0（有就是新寫死又沒進表）。

## 測試

用 `vm` 載入會呼叫 `STR()` 的檔案（`ui.js`、`tasks.js`…）時，要在 `util.js` 之後載入 `js/strings_data.js` 與 `js/strings.js`，否則出現 `STR is not defined`。

## 遷移現況（2026-10-23）

- 「任務」模塊已全部改為讀表（`tasks.js`、`ui.js` 的任務條與總覽、`index.html` 任務總覽標題）。
- 其餘模塊的字串都已登記，程式仍寫死，待依序遷移；進度看 `--check` 輸出的「待遷移」數。
- 注意：表格裡的 `{0}` 對應原程式 `+` 串接中第 N 個非字面值，遷移時照 `替代字符參數說明` 欄的運算式順序傳入。
