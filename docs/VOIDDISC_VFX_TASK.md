# 虛空斬特效接入

- 使用者核准方向修正版：正式檔 orb-void-disc.json，六層綠白氣旋加少量藍色，保留核准旋轉方向及輕微不規則輪廓。
- 既有第七階 projectile 接線沿用；未改飛行數量、方向、半徑成長、傷害或 Excel。素材使用既有 twirl_02/03。
- 生成工具同步，更新 Runtime 與主頁快取版本。
- 驗證：11項環繞/CATALOG、22項風刃真空技能測試全部通過；build343檔通過。兩張素材的遊戲與素材庫SHA256相同；素材庫乾淨無需空提交。預覽preset/layout已清理。

- 輪廓清晰化：圓盤外緣加一圈細亮邊（light-masks-1.0/default/ring_a，scale 0.55 對齊 spiky_15 外緣），圓盤本體 alpha 0.5 → 0.8；外圍氣旋各層降低（outer-green-flow 0.7→0.646、return-green-flow 0.6→0.51、藍色兩層 0.28→0.238、energyball_5 0.3→0.17）。原因是各層全為 add，疊在一起亮度蓋過圓盤；降太多會失去旋風感，故只降到仍保留氣旋的程度。共 10 層。
- 生成工具 voiddisc.cjs 原本只有 6 層、與 Editor 手調後的 JSON 不一致，改為與 JSON 逐層一致（含手調的角度／寬窄），重新生成與目前 JSON 內容相同。所有圖層皆 add，繪製順序不影響畫面，zIndex 改為依序排列。
