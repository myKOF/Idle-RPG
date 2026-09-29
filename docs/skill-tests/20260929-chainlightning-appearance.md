# CHAIN-APPEARANCE-20260929

## 原因與修改

上一輪為飛行效果加上 35% 路徑／96px 長度上限，並把厚度一起縮小，導致原本閃電變成細小電線。本次恢復 Preset 原厚度，取消固定長度上限，電弧畫幅改用路徑 80%，保留本體平移與圖集前端前進。沒有更換圖集、Preset、顏色或技能數值。

提前出現的目標電光含第六階繼承的 ground 光環；前次 hit:false 只取消命中預播，沒有擋 ground。起飛事件現在只播放施法／飛行角色，ground 與 field 延至 lightning-chain-hit 權威命中事件才播放，死亡取消維持。

修改：js/vfx-runtime.js、index.html（Runtime 1.0.137）、tests/vfx-runtime.test.cjs、docs/AI_TASKS.md、本報告。檢查未改：skills2 抵達事件、aura-lightning-relay 與 bolt-chain-travel-bluewhite Preset。素材库無本次修改。另有使用者／外部正在修改 beam-light.json，保留未提交，不混入本次。

## 驗證

- `node --test --test-reporter=tap tests/vfx-runtime.test.cjs tests/skill2-lightning.test.cjs tests/lightning-vfx-lifecycle.test.cjs`：152 項、148 通過，4 項既有失敗（殞石、FIELD、CATALOG-3、STARFALL-TAIL；上一輪已對照修改前 HEAD 重現）。新測試檢查起飛無 hit/ground，飛行結束後仍等權威命中，抵達事件才出現二者；同步檢查原厚度、較長電弧、逐幀移動及抵達回收。
- `npm run build`：402 檔通過；`git diff --check` 通過。
- Edge 隔離存檔實戰：正式 WorkerBridge 設定七階滿級、沒有超神，8 隻高血怪。攔截真正 boot 完成的 Runtime：147 則雷鏈相關事件中，起飛新增光環 0、權威命中新增光環 8；pageerror 為空。首輪量測誤包裝 create（boot 使用內部 create），未收到數據；改包裝 boot 後重新驗證。

無本次未完成項目；仍保留原表定多鏈與原素材厚度，密集怪群時特效可能重疊。提交編號見交付訊息，可合併（交付前乾跑確認），未合併／推送。整合後重新載入頁面套用快取，請以原角色確認外觀體感。
