# 真空斬特效（VACUUMSLASH-VFX-20260912）
- Owner Codex；預覽待確認，未接入、未提交。
- 已下載並唯讀核對使用者 Google 文件：sheet10 I289「多個刀刃構成，藍綠色系，外藍內綠」，J/K289兩張半月刃／環形風刃參考；基礎版先做前方半月斬，迴旋與七階不在本次接線範圍。
- 5組藍外刃／綠內面、1道亮芯、22顆短命風屑；使用既有slash_03與spark_01貼圖，無程序逐像素生成、無新增序列幀。
- 候選 slash-vacuum-multiblade.json；正式 slash-wind-crescent 與Excel不改。
- 使用者否決分散刀刃的形狀；第二版改為3道同心交疊的新月刃，共用揮斬角度與縮放，外藍／中青／內綠，另加細內緣與16顆風屑。維持5圖層、無程序生成；格式驗證通過，vacuum-v2.gif待確認，未接入。
- 已核准接入：正式 slash-wind-crescent.json 改用共用人物支點、右上向右下掃弧；Runtime 朝目標方位播放一次，尺寸使用事件 lineLength，未改技能傷害或Excel。author家族改呼叫同一make，移除候選檔。
- 驗證：Core130項通過；Runtime80項中74通過、6項既有失敗（THUNDERFALL/ROCKARMOR/TORNADO兩項/MIRE/CHAIN），用HEAD原Runtime回放同樣六項失敗，新增VACUUM測試在舊版失敗、新版通過。素材完整性通過，build342檔通過。slash_03由素材庫既有檔增量匯出，SHA256與索引一致；素材庫無變更。
