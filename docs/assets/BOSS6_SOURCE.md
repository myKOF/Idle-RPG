# BOSS6 黑暗騎士 3D 資產交接

任務 `BOSS6-DARK-KNIGHT-20261116`，Claude。使用者提供第6隻BOSS的五個動作（五個 GLB），並要求：頭轉向正前方、劍拆下重裝右手（單手正握、劍身朝上）、盾牌拆下重裝前臂。完整做法、SHA-256 與未完成事項在素材庫 `Effects-Materials/claude-authored/boss6-dark-knight-20261116/SOURCE.md`。

- 工具：`tools/boss6/build_boss6.py`（Blender：頭轉向、拆劍盾、補握把、新骨 Sword_R／Shield_L、合併五動作、匯出）、`lock-root.cjs`（攻擊1／2／3 的 Hips 水平位移固定，位移由遊戲驅動）、`render_portrait.py`（頭像）、`viewer/`＋`capture.cjs`＋`gifenc.cjs`（無頭 Chrome 預覽 GIF）。
- 成品：`images/models/npc3d/boss6.glb`（52 關節：Mixamo 50＋Sword_R＋Shield_L；Walk／Attack1／Attack2／Attack3／Die）、`images/sprites/boss/boss6_abyss.png`。
- 接入：`NPC.xlsx` 第487列（tower_boss_6，深淵領主）頭像、模型、動作、近戰三格（攻擊速度 0.4、距離 5 米、非魔法型，與鬼面一致）；名稱、屬性、技能、移動速度、倍率沿用原列。第6／56／106層使用。
- 尚未做：戰鬥特效（沿用一般敵方出手特效）；三個模型問題的修正只用截圖與預覽確認，沒有逐格檢查每個動作的劍盾穿插。
- 注意：使用者說盾「接到右前臂」，這隻BOSS的盾在角色左手（右手持劍），我接在持盾的左前臂；若要換手請告知。
