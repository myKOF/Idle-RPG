# CHAIN-TABLE-SPEED-20260929：連鎖閃電表定飛行速度

## 完成內容

Skills2 第 142 列（連鎖閃電第 1 階）的 AB142「飛行子彈速度（米／秒）」填入 73.770491803278688，保留原本 18 米／244 ms 的速度。AI142「攻擊特效」清空，原本的 `bolt-chain-travel-bluewhite` 移至 AJ142「飛行子彈」。Excel、CSV、編譯後的 SKILLS2 同步。

幾何欄位路由新增 `chainlightning/1` 的 speed／speedPer。每次施放從表格讀取世界速度，首擊、後續彈射及第七階衍生鏈共用。無座標模式的估時計算也使用表定速度。正常戰場仍逐幀追蹤移動目標，實際追上才結算，不以估計飛行時間提前命中。

Runtime 的 projectile 角色在雷鏈事件中走原本長電弧播放程式，保留固定長度、飛出／收入及尖端處理；命中事件只播放受擊。舊 attack 角色仍相容。未改傷害、超神機制或 Preset／素材。

## 檔案與範圍

- 修改：`config/Excel/Skills2.xlsx`、`config/CSV/Skills2.csv`、`js/skills2.js`、`js/vfx-runtime.js`、`tools/skills2-geometry.cjs`。
- 快取：`index.html`、`js/bridge.js`、`js/worker/sim.worker.js`、`tools/vfx/editor/index.html`。
- 測試：`tests/skill2-lightning.test.cjs`、`tests/skills2-geometry.test.cjs`、`tests/vfx-runtime.test.cjs`。
- 文件：本檔與 `docs/AI_TASKS.md`。
- 檢查但未修改：`tools/config_tables.cjs`、`tools/write-skills2-excel.ps1`、`js/battlefield.js`、`js/util.js`、`tests/enemy-attack-vfx.test.cjs`。

作業期間外部另有 Preset、shipped-assets 及 chain-travel.png 的修改／刪除，均未納入本次提交。

## 驗證

- 衝突預檢：本次檔案無其他分支／副本衝突。
- Excel 原生 COM：複本只修改三格，儲存並正常重開驗證；與來源比較只有 AB142、AI142、AJ142 的值變更。所有頁籤、儲存格格式、欄寬、視圖、物件、驗證及備註保留；Excel 僅正規化空白備註的預設 LTR 樣式。
- Artifact Tool 匯入既有空字串時誤顯示 shared-string 索引 923，試輸出被棄用；最終採原生 Excel 保存，預覽以實際讀值校正，未以該工具輸出覆蓋來源。
- `node tools/config_tables.cjs --apply Skills2 --write`：成功；再跑無語意差異。
- `node tools/apply_params.cjs`：554 個參數一致，0 變更、0 錨點問題。
- `node tools/apply_params.cjs --check-anchors`：擾動 504 個數值後，554 個錨點全部通過。
- `node --test --test-reporter=tap tests/skill2-lightning.test.cjs tests/vfx-runtime.test.cjs tests/skills2-geometry.test.cjs`：163 項，158 通過、5 失敗。這 5 項以 HEAD 的本次受改檔案覆蓋讀取後重跑亦失敗：殞石燃燒、FIELD、CATALOG-3、CHAIN 素材與作者腳本不一致、STARFALL-TAIL。外部正在修改的素材保留現況。
- 新增驗證：10／20 米每秒、每級增量、首擊與彈射速度一致、等待移動目標實際抵達、無座標估時、表格完整往返。原有追加次數測試固定亂數，避免 10% 額外一擊造成不穩定結果。
- `node --test --test-reporter=tap --test-name-pattern='CHAIN-(HOMING|ARRIVAL|LIFECYCLE)' tests/vfx-runtime.test.cjs`：3／3；飛行子彈角色不提前受擊、不在命中時重發、長電弧等速追蹤及指定鏈回收。
- `npm run build`：404 個檔案通過。
- `node --test --test-reporter=tap "tests/*.test.cjs"`：3,221 項，3,123 通過、96 失敗、2 略過，耗時約 613 秒。對所有失敗所屬檔案，以 HEAD 的本次受改檔案覆蓋讀取重跑，共 822 項、724 通過、97 失敗；完整回歸的 96 個失敗名稱全包含其中，無新增失敗。基準另外一次隨機失敗為「雙刀逐刀目標與傷害飄字共用 0.2 秒」。未回復工作區或改動外部素材以製作基準。

## 交接

本次修改可獨立整合，已知完整測試基準非全綠；不合併／推送 develop。重新載入遊戲以更新頁面與 Worker 快取，之後可在 Skills2 的 AB142 調整基礎雷鏈速度。超神自身的特殊攻擊機制未改；無額外實機視覺驗收宣稱。Commit 見本文件首次提交的 Git 紀錄；無本次範圍內未完成項目。
