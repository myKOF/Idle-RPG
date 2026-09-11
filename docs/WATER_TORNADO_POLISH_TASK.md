# 水龍捲外觀與效能改善

- 使用者要求保留本體，補上頂部斷面、透明度 70%、底部廣域旋轉水花，改善施放卡頓。
- Owner：Codex；狀態 In Progress。新 field-water-tornado-polished 用於確認，未替換正式接線。
- 水體逐像素生成採 2×2 共用取樣，保留 320 像素輸出尺寸與原水帶幾何；同相位的水帶幾何跨圖層共用，避免重複計算。火焰像素維持原精度。
- 使用者水流彈 preset/layout/shipped-assets 修改保留，不覆蓋。
- 原版 40 組完整水龍捲取樣約 473ms（本機 Node 單次測量）；改後重測並提供 Core 動態預覽與回歸結果，不將取樣耗時當成遊戲 FPS。
- 預覽完成：頂部泡沫環/水珠/薄霧，底部廣域水紋及受上限限制的旋轉水珠；既有圖層 alpha ×0.7（本體 1→0.7）。輸出 field-water-tornado-polished.json，未接入。
- 相同 40 組取樣改後約 240ms，比原473ms減少約49%；只代表生成計算，未量測實機 FPS/GPU 上傳。9 項水龍捲/火色盤相容與136項 Core/layout 通過，Build340檔通過。完整水龍捲測試另有既有 FIRE shipped effect 缺少 ground-flames 圖層的斷言失敗，與本次未修改的火焰 preset 不一致，未改斷言。
- 使用者回饋底部應為環狀水花：移除新增的同心圓貼圖與圓盤內隨機粒子，改為 16 個沿橢圓周邊的發射點，水珠沿切線甩出再受重力落下；前後分層形成圍繞底部的水花環。總發射率 96/秒、上限80顆，136項 Core/layout 測試通過，更新動態預覽，尚未接入。
- 依最新參考改用 slash_03 弧形水幕取代環狀圓珠，底部 8 點、頂部 6 點沿橢圓外緣噴起；搭配稀疏細碎飛沫，總新增粒子上限62顆（含薄霧），保持本體與70%透明度。Core動態預覽更新為 tornado-splash.gif，尚未接入；Core/layout 136項通過。
- 最新回饋要求氣旋：移除所有新增 slash 亮片與點狀發射器，改為 cyclone-rear/front 程序圖層。環帶出生的細水花沿角動量軌跡旋轉、向外散落，破碎螺旋泡沫與模糊水霧形成濃淡；頂部重用同組旋流。新增4個共享生成圖層，無新增序列幀素材。136項 Core/layout 通過，預覽 tornado-cyclone.gif；尚未接入。先前240ms效能測量不包含新增氣旋，整體實機效能待接入驗證。

- 已獲使用者核准接入：正式 field-water-tornado.json 使用核准氣旋，移除候選 preset/layout。原 author 透過共用 polish 函式重建，逐圖層 deepStrictEqual 與正式版本一致。快取版本更新。9項水龍捲相關＋136項 Core/layout、340檔 build 通過；實機 FPS 尚未量測。
- 包含使用者水流彈 preset/layout/shipped-assets 與 cone_composed_c.png；素材庫工作區乾淨，該貼圖 SHA-256 與遊戲版本一致，無需空提交。

## 水龍捲掉幀修正（2026-09-12）
- 使用者回報施放後約50 FPS降到5；先前僅生成函式量測不足。此次檢查包含真實 Canvas 路徑：過密水帶分段、逐水花 path draw、每幀 Canvas filter，以及 mist group 清掉 sharp commands。
- 後端將近似色階合併繪製、光霧小表面雙線性縮放，取消 native blur；overlay 不再清除水花。水帶96→24、細線130→32取樣、氣旋1100→350細節，保留原軌跡與20Hz動畫節奏。無新增圖檔或序列幀。
- 使用 @napi-rs/canvas 實際 Canvas＋正式後端繪製，四座同步水龍捲40次更新（含生成，Pixi texture/GPU為替身）：原版平均76.12ms／最大129.47ms，修正23.39ms／最大39.12ms，平均下降約69%。此數字不能換算成遊戲 FPS。
- 瀏覽器工具啟動／本機連線失敗，獨立 Chrome 程序啟動被自動審核以政策封鎖拒絕，未繞過；未完成真實戰鬥 GPU/FPS A/B，仍需使用者場景驗證。已檢視正式後端產生的修正圖像。
- 驗證：10項水龍捲/相容測試（含千筆細水花合併、禁止 native filter、mist 不清除 sharp commands）＋136項 Core/layout 通過；build340檔通過。先前既有 FIRE shipped ground-flames 斷言不在本次相關子集內。
- 素材庫無變更；測試產物清理，回到 ai/codex 提交，未推送。
