# 真空爆震特效（VACUUMSHOCK-VFX-20260913）
- Owner Codex；使用者核准接入與Commit，已完成。
- 來源：技能文件sheet10 I290，半月震波向外延伸10米。核准版本沿用使用者目前真空斬刃片，四道短命粒子前推並擴散，與原揮斬同時起播，不是原地加厚。
- 正式檔 burst-vacuum-shockwave.json；Skills2第二階attack接線同步Excel Z213、CSV、JS。每個原攻擊波次在同一delayMs發出震波，Runtime使用人物中心、模擬angle、preset尺寸。原傷害次數與目標結算不變，四階及以上原迴旋斬保留。
- 包含使用者對slash-wind-crescent.json的修改；素材皆已在素材庫與遊戲中，無新素材、素材庫工作区乾淨，不建立空Commit。
- 驗證：5項VACUUM/CATALOG＋21項風刃/真空傳奇測試通過；build342檔通過。既有美術偏移用正式圖層變換驗證，不再假設位置為零。
- Excel僅修改Z213：全部其他儲存格和ZIP項目與HEAD一致，保留原namespace宣告並解析驗證；未操作Excel桌面程式。
- 已更新主頁、Worker、Runtime快取版本；清理臨時預覽和生成腳本。未推送或合併develop。
