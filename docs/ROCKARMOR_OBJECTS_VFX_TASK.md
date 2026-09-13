# ROCKARMOR-OBJECTS-20260913

使用者核准六塊獨立岩甲物件的動態預覽後接入。

- 岩甲術與天地逆返使用同一組 plate、rune、glow 三張 256×256 PNG，共 17,979 bytes；六組物件各自環繞角色，後者僅改藍色符文與光效。
- 正式 preset 各 18 層，遊戲端分成同步的前後繪製層，在軌道中線切換遮擋；重複狀態事件只續命，不重播。
- 四張舊圖集移出遊戲出貨，素材庫保留歷史素材及既有語意分類／編輯器測試引用。基礎 RGBA 貼圖由兩種配色共 36 MiB 改為共用 0.75 MiB，不含 GPU 額外開銷，未宣稱實機 FPS 測量。
- 保留並提交使用者目前對 ground-storm-barrier 的縮放及位置調整。

修改：js/vfx-runtime.js、index.html、兩份岩甲 preset/layout、authoring 三份腳本、asset-index、shipped-assets、出貨貼圖及 runtime 回歸測試。
檢查未修改：js/skills2.js、js/skills.js、js/util.js、js/data.js、js/status.js、js/formula.js、js/battlefield.js、js/combat.js、技能配置。

驗證：
- node --test --test-name-pattern="ROCKARMOR|CATALOG" tests/vfx-runtime.test.cjs：4 項通過。
- node --test --test-name-pattern="岩甲|天地逆返|重岩|巨岩|尖刺甲|大地之心|金剛|超重" tests/skill2-earth.test.cjs tests/skill2-firehunt-rock-legendary.test.cjs：19 項通過。
- 額外執行上述兩份技能測試完整集：57 通過、2 項泥沼數值斷言失敗；其測試與所有載入的技能程式均未變更，屬既有問題。
- npm run build：344 個檔案通過。
- node tools/vfx/export-assets.cjs --check：最新；三張新素材兩個倉庫逐位元相同。
- git diff --check：通過。

素材庫 commit：5ec8731。遊戲 commit 見本文件所屬提交。
未完成：無本任務項目。未進行實機遊戲 FPS 驗證。
下一步：Ctrl+F5 後觀察岩甲環繞；可供使用者合併，未合併或推送 develop。

## 地面底光補回

重做時遺漏原有 earth-shadow 與 amber-underlight，現恢復原本貼圖、土色、縮放及呼吸亮度；兩種岩甲配色共用土色底光。地面兩層只送 zone，保持跟隨腳下且不蓋過人物。作者腳本同步補回，避免重新產生時再遺漏。

驗證：ROCKARMOR|CATALOG 4 項通過（新增底光只存在地面層、跟隨人物及非零透明度檢查）；build 345 檔通過；export-assets --check 最新。沒有新素材，素材庫無變更。本次未進行實機畫面驗證。
