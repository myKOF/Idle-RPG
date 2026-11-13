# BOSS5 鬼面（般若面具）3D 資產交接

任務 `BOSS5-ONI-MASK-20261113`，Claude。使用者提供未綁骨的 `BOSS5.glb`，要求補後腦、眼睛紅光、紅霧拖尾，並做移動／攻擊1～3／死亡五個動作。

- 成品與來源在素材庫 `Effects-Materials/claude-authored/boss5-oni-mask-20261113/`（`boss5.glb`、`boss5_skull.glb`、後腦貼圖、使用者原檔與 SHA-256，說明見該資料夾 `SOURCE.md`）。
- 重建工具在 `tools/boss5/`：`node tools/boss5/build_all.cjs <BOSS5.glb> <輸出資料夾> [--previews]`。Blender 腳本負責補後腦（`render_front.py`、`build_dome.py`）、綁骨與動作（`build_rig.py`）、綠色小骷髏（`build_skull.py`）；`viewer/`＋`capture.cjs`＋`gifenc.cjs` 用遊戲內建的 three.js 在無頭 Chrome 逐格渲染成 GIF 預覽（含眼睛紅光、紅霧、火焰、小骷髏、碎裂特效的預覽版實作）。
- 動作：`Walk`（循環 1.0 s）、`Attack1`（1.8 s，Body 位移 6 m）、`Attack2`（1.333 s，0.467 s 生成子彈）、`Attack3`（2.2 s，火焰 0.733～1.6 s）、`Die`（4.0 s，2.0 s 碎裂）。骨架 18 根：`Root`、`Body`、`Eye_L`、`Eye_R`、`Shard_01～14`；掛點 `Fx_Mouth`、`Fx_Back`。
- 已接為第5隻封魔塔BOSS（5／55／105 層，`tower_boss_5`）：`NPC.xlsx` 第486列 G:J 頭像 `sprites/boss/boss5_oni.png`、AB 模型 `images/models/npc3d/boss5.glb`、AC:AH 站立／移動 `Walk`、攻擊 `Attack1/2/3`、死亡 `Die`；名稱、屬性、技能、速度、距離、倍率沿用原列。遊戲版 GLB 由 `build_rig.py --game` 產生：與 BOSS3 相同，攻擊與走路固定水平根位移，死亡碎片散布限制在 NPC 畫布（6.2 m）內。
- 還沒做：眼睛紅光、紅霧、火焰、小骷髏、碎裂特效的遊戲內 VFX Preset（目前只有預覽版實作，戰鬥中沒有這些特效，只有模型動作）；`e_poisonspit` 等技能表現與模型動作無關聯。

## 單位說明（重要）

- 動作與預覽裡的「米」是**模型自己的座標**（1 單位＝1 m，面具高約 2 m），不是遊戲的「米」。
- 遊戲的「米」是 1 米＝10 座標單位（`js/battlefield.js` 的 `BF_SYSTEM_UNITS_PER_METER`、`js/elite_data.js` 的 `ELITE_METER`）；NPC 的攻擊距離、技能射程都以這個米由程式計算，而 3D 模型是依 NPC 表「縮放比」縮放上畫面（`Npc3D.scale`），兩者沒有 1:1 對應。
- 因此攻擊1 的 6 m、火焰 15 m、骷髏 60 m 只是動作／特效的設計意圖；接進遊戲時要以遊戲米重新換算（位移改由程式依攻擊距離驅動，或依縮放比等比換算）。
