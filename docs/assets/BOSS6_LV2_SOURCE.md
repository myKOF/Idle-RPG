# 深淵領主第二款貼圖 BOSS6_2

封魔塔第 16／66／116 層讀取 `NPC.xlsx` 第 497 列 `tower_boss_16`。G:J 為青紫版頭像及備援圖 `images/sprites/boss/boss6_abyss_lv2.png`，AB:AH 為 `images/models/npc3d/boss6_lv2.glb`、站姿 `Walk` 首幀、移動 `Walk`、三段攻擊 `Attack1/2/3`、死亡 `Die`。N:O 及 Q 採第一款的近戰設定，物理普攻每秒 0.4 次、射程 5 米。暗屬性與專屬技能 `e_darkzone`、`e_darkorbs` 沿用該列。

- 素材庫提交 `8249ad32` 的 `codex-authored/boss6-dark-knight-lv2-20261116/` 保存使用者原檔、五段動作驗收模型、封裝貼圖的 Blender 檔及遊戲資產。各檔 SHA-256 在該資料夾 `SOURCE.md`。
- 第二款沿用第一款修整後的網格、UV、骨架及五段動作。以使用者提供的青紫版底色、法線、金屬粗糙度貼圖替換對應的三張嵌入貼圖。
- 執行 `node tools/boss6/build-game-glb.cjs <boss6_lv2_approved.glb> <boss6_lv2.glb>` 可重製遊戲模型。輸出的幾何、武器掛點及五段動作資料與第一款遊戲檔完全一致。
