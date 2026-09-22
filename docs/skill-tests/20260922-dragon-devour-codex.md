# DRAGON-DEVOUR-20260922

狀態：使用者已確認動圖並指示接入，正式技能與素材已接線，完成驗證後提交至 ai/codex。未合併 develop、未推送。

## 正式接入交接

- 任務 DRAGON-DEVOUR-20260922 已完成，最終行為以本報告「行為」與「最新聚怪修正」為準；下方第二版段落保留修正背景。
- 素材庫 Commit：61ec669；遊戲 Commit 為包含本報告的提交（避免自引用雜湊）。
- 驗證：配置／技能24項、DEVOUR畫面3項全部通過；配置apply零語意變更、素材export-assets --check最新、build392檔通過、diff --check通過。完整Runtime兩項既有失敗、火系四項既有失敗的基線證據見下方。
- 刪除臨時HTML重播頁與本次tmp腳本／JSON；正式Preset作者工具與回歸測試保留。已交付的動圖留在使用者visualizations資料夾供回看。
- 工作區另有非本任務的 images/vfx/thrust_lance.png 刪除，保留且不納入本次提交；battle-renderer.js仍引用該檔。合併整個工作區前應由該刪除的操作者確認用途。
- 共用AI_TASKS有Claude未合併更新，本輪未再改它；其較早Review狀態由本段正式接入狀態取代。
- 無本任務未完成實作，可合併本次提交；未執行develop合併或推送，未做完整長時間實戰效能測試。

## 最新聚怪修正（使用者要求恢復原版手感）

- 原版bfPullEnemies在每拍直接改座標，沒有每秒速度；先前新增的pullSpeed=12並非原版設定。
- 已移除pullSpeed與每幀慢速位移，每0.35秒先將35米內的活敵人拉至漩渦中心附近，再計算15米傷害；仍跳過進場敵人，停在各自體型半徑，不改怪物普通移動程式。
- 測試涵蓋35米邊界、範圍外不動、玩家反向移動仍在下一拍拉回、先拉後打、死亡及新漩渦替換；24项配置／技能測試及build通過。
- 本輪修改skills2.js、Skills2.xlsx/CSV、dragon-devour.test.cjs、既有预覽頁、快取及本報告；唯讀檢查battlefield.js、combat.js、skills.js與原版歷史。未修改battlefield.js。
- Excel原生儲存重開，只改吞噬列JSON和用途說明兩格。配置回寫語意差異0；index.html沿使用者先前同意只改技能與bridge快取行。
- 最新動圖：C:/Users/user/.codex/visualizations/2026/09/22/01a0c708-48dc-74a0-af71-4df6a3cb13be/dragon-devour-pull.gif。
- 預覽已由使用者確認，交付狀態見最上方正式接入交接。

## 行為

- 吞噬替換整次火龍捲施放為單一固定地面漩渦，出生於施放位置；不再繼承舊火柱數量、追敵、重生、消散爆炸或段數加成。
- 半徑15米，持續8秒；第一拍在0.35秒，共22拍，最後0.3秒保持漩渦與噴射。火傷200%＋等級×20%，依專案規則1級220%、10級400%。
- 每秒隨機2～4顆火球，該秒內分散起飛；20米圓內按面積均勻取隨機落點（包含漩渦內），空場也照噴，不搜敵。每顆落地半徑6米400%火傷，固定不升級；8秒前起飛的火球可在場域結束後落地。
- 未指定的演出參數目前為飛行0.9秒、弧高12米；聚怪35米，每0.35秒傷害前立即拉至固定圓心附近，只保留敵人體型半徑，不再用6.6米近戰停止距離。這些數值保存在同一列配置中。
- 高塔沒有座標時，沿既有單目標退化規則打主目標。死亡不再噴射或造成傷害，戰鬥重置清除場域。
- 模擬傷害與畫面共用範圍、落點、飛行時間、弧高與壽命；爆炸只在落地播放。沿既有協議欄位，沒有新增協議格式。

## 修改檔案

- `config/Excel/Skills2.xlsx`、`config/CSV/Skills2.csv`：吞噬列數值、說明、特效角色。
- `js/skills2.js`：替換施放、逐步聚怪、隨機噴射、延後落地範圍伤害。
- `js/vfx-runtime.js`：任意表定彈體可使用既有arcM；吞噬一次性完整壽命不加逐拍續命緩衝。
- `tools/skills2-geometry.cjs`、`tools/skills2-vfx.cjs`：配置距離用途與落地觸發角色接線。
- `index.html`、`js/bridge.js`、`js/worker/sim.worker.js`：主執行緒與Worker快取。
- `vfx/presets/field-dragon-devour.json`、`vfx/layouts/field-dragon-devour.json`：單一根群組、單層疏紋亮外圈與少量火星，暗中心，半徑15米。
- `vfx/asset-index.json`、`vfx/shipped-assets.json`、`images/vfx/assets/codex-authored/dragon-devour/vortex.png`：新素材來源與正式匯出。
- `tools/vfx/authoring/author/dragon-devour.cjs`：可重建Preset；SVG火流原稿存於素材庫。
- 臨時重播HTML在驗證完成後已移除，不納入正式遊戲。
- `tests/dragon-devour.test.cjs`、`tests/vfx-runtime.test.cjs`：新行為與畫面回歸。
- `tests/firepillar-expire-vfx.test.cjs`、`tests/skill2-fire-legendary.test.cjs`：將舊吞噬規格斷言同步至新規格，保留其他分支測試。
- `docs/AI_TASKS.md`、本紀錄。

唯讀檢查：`js/battlefield.js`、`js/battle-renderer.js`、`js/vfx-core.js`、`js/vfx-pixi-backend.js`、`js/vfx.js`、Worker協議／shim、既有火球與爆炸Preset、配置工具及素材工具。

## 驗證

```text
node --test tests/dragon-devour.test.cjs tests/skills2-geometry.test.cjs tests/skills2-vfx-schema.test.cjs tests/skills2-mana-cost.test.cjs
node --test --test-name-pattern=DEVOUR tests/vfx-runtime.test.cjs
node --test tests/skill2-magic-fire.test.cjs tests/skill2-fire-legendary.test.cjs tests/skill2-infinite-fire-dragon.test.cjs tests/firepillar-expire-vfx.test.cjs
node --test tests/vfx-runtime.test.cjs
node tools/config_tables.cjs --apply Skills2
node tools/vfx/export-assets.cjs --check
node tools/build_check.cjs
git diff --check
```

- 配置／技能23/23，DEVOUR畫面3/3：單一場域、升級、壽命、22拍、逐步聚怪、每秒數量、落點不追蹤、落地範圍、耗魔與實際傷害、高塔、死亡／重置、拋物線中點、尺寸與畫面8秒回收。
- 火系52/56：既有失敗為地爆天星狀態倒數、地爆天星舊預警、烈焰暴風舊數量、烈焰衝擊舊6米數值。以HEAD版skills2.js重跑同4项失敗，無新失敗。
- Runtime101/103：既有CATALOG-3 layout根群組、STARFALL-TAIL舊尾焰斷言。以HEAD版Runtime與測試重跑同樣失敗。
- 配置apply零語意變更；素材匯出已是最新；build392檔通過。
- Artifact匯入原表時將空白誤讀為937，未回存該結果。改用Excel原生COM，僅吞噬列12格資料變更，所有其他儲存格內容不變；儲存後Excel正常重新開啟並逐格核對目標值。
- 預覽已於瀏覽器實際載入，確認橙金色漩渦、空心中央、飛行火球；Console無新增錯誤。不是完整遊戲操作驗收或效能基準。

## 第二版修正與預覽

- 新施放立即取消舊漩渦的傷害、聚怪、噴射與畫面；已飛出的火球完成原定飛行。
- 紋路減少，集中明亮外圈，越向內越稀疏；依追加要求加入三道漸層螺旋環帶與柔和環形光暈，向中心收窄變暗；每8秒整圈旋轉，跨循環角度連續。技能8秒壽命的最後0.3秒淡出，不把出生／消失動畫放入循环。
- 新增 proj-dragon-devour 與 burst-dragon-devour 的Preset／layout；火球不再用發光圓盤，火焰與火星沿世界座標保留弧線軌跡，落地後尾粒子自然消失。名目寬高6米改4.2米（縮小30%），爆炸傷害半徑仍6米。
- 落地事件由impact改burst；原本targets為空而hit路由略過attack，現在無敵人也在落點播放爆炸。
- 原生Excel再次儲存重開，修改吞噬列5格（含20米落點、兩項Preset及說明），其他儲存格逐格比對未變；apply零語意差異。
- 聚怪實測發現原先錯用近戰停止距離：普通敵人停在66世界單位。已改只留20世界單位體型，測試包含bfTickApproach與tickSkillSchedulers同時執行。
- 使用者同意index.html與Claude f00c2d94分行修改；未改Claude的battle-renderer快取行或鏡頭投影程式。預覽採0.5地面壓縮供視覺審視。
- 動圖使用正式Runtime/Core及素材離線渲染；混色取樣略異於Pixi，另有瀏覽器Pixi預覽，非完整戰鬥UI錄影。
- 圖檔：C:/Users/user/.codex/visualizations/2026/09/22/01a0c708-48dc-74a0-af71-4df6a3cb13be/dragon-devour-gradient.gif（完整技能）；同目錄dragon-devour-gradient-loop.gif（漩渦本體無縫循環）。
- 本輪23項配置／技能與3項DEVOUR畫面測試通過；Runtime101/103為先前確認的兩項既有失敗，無新增失敗。

## 素材與後續

素材庫位置依 `tools/vfx/vfx-library-root.cjs` 解析；新資產置於 `codex-authored/dragon-devour/`，包含SVG原稿、PNG、Preset與layout副本。Preset/layout已逐位元組核對。

無未完成的規格實作；外觀已確認，尚未做完整野外／高塔實機操作及長時間效能量測。雙倉庫提交後供使用者合併。
