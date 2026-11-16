# 深淵領主第三款貼圖 BOSS6_3

封魔塔第 26／76／126 層讀取 `NPC.xlsx` 第 507 列 `tower_boss_26`。G:J 為深紅版頭像與備援圖 `images/sprites/boss/boss6_abyss_lv3.png`，AB:AH 為 `images/models/npc3d/boss6_lv3.glb` 與站姿 `Walk` 首幀、移動 `Walk`、攻擊 `Attack1/2/3`、死亡 `Die`。N:O 及 Q 採用前兩款的近戰設定，物理普攻每秒 0.4 次、射程 5 米。暗屬性與專屬技能 `e_darkzone`、`e_darkorbs` 沿用該列。

- 素材庫提交 `74b48bd4` 的 `codex-authored/boss6-dark-knight-lv3-20261116/` 保存使用者原檔、五段動作、可編輯的 Blender 檔及遊戲資產。各檔 SHA-256 見資料夾 `SOURCE.md`。
- 第三款使用提交原檔的底色、法線、金屬粗糙度貼圖，沿用第一款修整後的網格、骨架、劍盾掛點及五段動作。
- 執行 `node tools/boss6/build-game-glb.cjs <boss6_lv3_approved.glb> <boss6_lv3.glb>` 可重製遊戲模型。三款遊戲模型的幾何、骨架與動畫資料完全一致。
