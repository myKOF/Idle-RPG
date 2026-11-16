# 第6位首領深淵領主 3D 資產

使用者提供移動、三段攻擊與死亡五份 GLB，並驗收正面朝向、右手正握尖刃劍、左前臂短支架佩盾、三段斬擊及死亡近身落劍。正式接入時依使用者補充增加站姿、跑步及三段攻擊的披風骨骼姿勢，使披風隨動作下垂。死亡沿用原先驗收的動畫資料。

- `NPC.xlsx` 第487列 `tower_boss_6` 對應封魔塔第6／56／106層。G:J 為頭像與備援圖，N:O 為攻速與射程，Q 為普攻是否使用魔法，AB:AH 為模型與動作名。配置採物理近戰普攻，每秒 0.4 次，射程 5 米；專屬技能為 `e_darkzone` 與 `e_darkorbs`。
- 遊戲檔為 `images/models/npc3d/boss6.glb` 與 `images/sprites/boss/boss6_abyss.png`。動作為 `Walk`、`Attack1`、`Attack2`、`Attack3`、`Die`。站姿取 `Walk` 首幀。遊戲會依實際跑速調節步幅，依出手時間播放完整斬擊，死亡以原速播放。
- 素材庫提交 `f7753ec7` 的 `codex-authored/boss6-dark-knight-approved-20261116/` 保存可編輯的 `boss6.blend`、合成後的 `boss6_approved.glb` 及遊戲模型與頭像。原始五檔的路徑與 SHA-256 記於素材庫的 `SOURCE.md`。
- 重製遊戲模型可執行 `node tools/boss6/build-game-glb.cjs <boss6_approved.glb> <boss6.glb>`。輸出將三段攻擊的骨盆水平根位移交給遊戲，並同步抵銷獨立劍骨的位移，保留跳躍高度及劍柄相對右拳的位置。
