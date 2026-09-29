# CHAIN-REBUILD-20260929

## 需求與完成

使用者要求消除中間大斷段、飛行速度降為 50%、來源敵人死亡仍繼續找目標；接著指定改以 bolt-thunderstrike-bluewhite 型態重做，顏色保持金黃。

- 保留表格原本引用 bolt-chain-travel-bluewhite 的名稱，內部改用 bolt-thunderstrike-bluewhite 的 blue-corona、white-core、side-fork 三層及原素材，旋轉成水平電弧、改金黃色。不帶落地爆點／噴濺，不再使用有透明斷段的舊 chain-travel 圖集。原落雷 Preset 不修改。
- Runtime 以連續前端／尾端控制電弧，頭部抵達 B 的時間完全採用 travelMs；保留原厚度。area 帶起點時仍走雷鏈飛行分派，不能先被範圍特效分派截走。已起飛的來源／終點離場時保留最後座標飛至落點；死亡目標不播放命中／光環。
- Skills2 的正常雷鏈每段從 183ms 改為 366ms（半速），抵達即選下一個目前範圍內的存活且未訪問目標，不預排整條鏈。前一隻被擊殺或飛行目標被另一條鏈先擊殺，都不會取消後續尋敵。找不到候選或達表定上限才結束；保留傷害、額外擊中、擴散、傳奇增傷與分支鏈上限。
- 後續起點透過既有 area.sourceX/Y、x/y 與 targets 傳遞，沒有新增協議欄位。保留 64 條分支／每鏈上限保護。

## 修改檔案

js/skills2.js（僅 7140 行附近邏輯，不含原有資料列編輯）、js/vfx-runtime.js、js/battle-renderer.js、js/bridge.js、js/worker/sim.worker.js、index.html；雷鏈 Preset／layout、tools/vfx/authoring/author/chainlightning-travel.cjs；四份相關測試及 AI_TASKS／本報告。

檢查未改：bolt-thunderstrike-bluewhite 原檔、vfx-core、vfx-pixi-backend、battlefield、worker/shim、protocol、資產索引與 spark_04/05 素材。使用者的 Skills2 Excel／CSV／資料列、beam-light、magic_03 刪除及 shipped-assets 均獨立保留未提交。

## 驗證

- `node --test --test-reporter=tap tests/skill2-lightning.test.cjs tests/skill2-chainlightning-thunder-legendary.test.cjs tests/vfx-runtime.test.cjs tests/lightning-vfx-lifecycle.test.cjs tests/vfx-preset-usage.test.cjs`：198 項、194 通過；4 項既有失敗：殞石落地、FIELD、CATALOG-3、STARFALL-TAIL（前幾輪已對照原 HEAD 重現）。
- 新案例：366ms 前不扣血、抵達當刻立即發下一段；每次致死仍依序打四隻；途中加入的新敵可選、出界敵不選；途中被其他鏈殺掉也續找；來源離場保留飛行；已投影斜線前端逐幀位置正確；原素材型態／金色／無圖集；起飛無命中光環。
- 超神時序測試先檢查自動施放停止，再等待仍在飛行的半速分支链結束，沒有用舊立即結算假設截斷驗收。
- `npm run build`：402 檔通過。`git diff --check` 通過。
- Edge 隔離存檔正式 Worker 單階雷鏈、8 隻弱怪：捕捉四段 chain 事件，各 travelMs=366；前段目標死亡後依序發出後段。完成後全部 Runtime activeEffects、pending、grounds=0，pageerror 空。
- 額外以正式 Pixi Backend／Core／Preset 凍結觀察早、中、晚三幀：金色主電弧與分岔连续前進，没有旧圖集中間大断口，未生成落地爆點。途中修正 area 優先分派造成電弧畫出界，補同座標事件測試後重跑。

## 提交與限制

素材庫 `8ff0bae`：codex-authored/lightning/presets 及 layouts 的新雷鏈版本；Preset 與遊戲檔 SHA256 一致。遊戲 Commit 見交付訊息。沒有新二進位素材，不動原落雷外觀。

無本任務未完成項目。每條鏈仍受技能表的彈射數與不重複目標規則限制；多鏈可同時播放。模擬 Tick 將 366ms 抵達量化到下一個 Tick，實戰間隔約 0.4 秒。尚未逐一實機驗收所有超神，但相關模擬回歸已跑。可整合；未合併／推送其他分支。請重新載入頁面套用主執行緒與 Worker 快取。
