# ICEARROW-T7-VFX-20260914

使用者已將 ground-icearrow-frost 從冰箭散射 T5 移至寒冰爆裂箭 T7，授權同步程式。

完成：sgSpawnIcearrowHoming 的 vfxTier 從 5 改為 7；同步 skills2、bridge 頁面版本及 Worker 資源版本。保留使用者 Skills2.csv、Skills2.xlsx 與 skills2.js 的配置調整，沒有重寫 Excel。T5 只增加箭數，T7 追蹤段取 T7 地板欄位，顯示仍共用正式飛行冰箭。

修改：js/skills2.js、js/bridge.js、index.html、tests/icearrow-vfx-integration.test.cjs；使用者配置一併提交。
檢查未修改：js/vfx-runtime.js、寒冰箭 presets、素材庫。Equipment_Affix.csv 與 Skills.csv 僅工作區換行差異，Git 正規化後無內容變更。

驗證：node --test tests/icearrow-vfx-integration.test.cjs，5 項通過，包含實際呼叫追蹤箭生成函式確認引用 T7 並解析正確特效；npm run build，348 檔通過；git diff --check 通過。

素材庫無新增／修改，不需建立空 commit。遊戲 commit 見本文件所屬提交。未進行實機畫面驗證，無本任務未完成項目；可供使用者合併，未合併或推送 develop。更新頁面後載入新 Worker。
