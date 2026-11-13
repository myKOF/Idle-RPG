# BOSS5 鬼面（般若面具）3D 資產交接

任務 `BOSS5-ONI-MASK-20261113`，Claude。使用者提供未綁骨的 `BOSS5.glb`，要求補後腦、眼睛紅光、紅霧拖尾，並做移動／攻擊1～3／死亡五個動作。

- 成品與來源在素材庫 `Effects-Materials/claude-authored/boss5-oni-mask-20261113/`（`boss5.glb`、`boss5_skull.glb`、後腦貼圖、使用者原檔與 SHA-256，說明見該資料夾 `SOURCE.md`）。
- 重建工具在 `tools/boss5/`：`node tools/boss5/build_all.cjs <BOSS5.glb> <輸出資料夾> [--previews]`。Blender 腳本負責補後腦（`render_front.py`、`build_dome.py`）、綁骨與動作（`build_rig.py`）、綠色小骷髏（`build_skull.py`）；`viewer/`＋`capture.cjs`＋`gifenc.cjs` 用遊戲內建的 three.js 在無頭 Chrome 逐格渲染成 GIF 預覽（含眼睛紅光、紅霧、火焰、小骷髏、碎裂特效的預覽版實作）。
- 動作：`Walk`（循環 1.0 s）、`Attack1`（1.8 s，Body 位移 6 m）、`Attack2`（1.333 s，0.467 s 生成子彈）、`Attack3`（2.2 s，火焰 0.733～1.6 s）、`Die`（4.0 s，2.0 s 碎裂）。骨架 18 根：`Root`、`Body`、`Eye_L`、`Eye_R`、`Shard_01～14`；掛點 `Fx_Mouth`、`Fx_Back`。
- 已接為第5隻封魔塔BOSS（5／55／105 層，`tower_boss_5`）：`NPC.xlsx` 第486列 G:J 頭像 `sprites/boss/boss5_oni.png`、AB 模型 `images/models/npc3d/boss5.glb`、AC:AH 站立／移動 `Walk`、攻擊 `Attack1/2/3`、死亡 `Die`；名稱、屬性、技能、速度、距離、倍率沿用原列。遊戲版 GLB 由 `build_rig.py --game` 產生：與 BOSS3 相同，攻擊與走路固定水平根位移，死亡碎片散布限制在 NPC 畫布（6.2 m）內。

## 單位說明（重要）

- 動作與預覽裡的「米」是**模型自己的座標**（1 單位＝1 m，面具高約 2 m），不是遊戲的「米」。
- 遊戲的「米」是 1 米＝10 座標單位（`js/battlefield.js` 的 `BF_SYSTEM_UNITS_PER_METER`、`js/elite_data.js` 的 `ELITE_METER`）；NPC 的攻擊距離、技能射程都以這個米由程式計算，而 3D 模型是依 NPC 表「縮放比」縮放上畫面（`Npc3D.scale`），兩者沒有 1:1 對應。
- 因此攻擊1 的 6 m、火焰 15 m、骷髏 60 m 只是動作／特效的設計意圖；接進遊戲時要以遊戲米重新換算（位移改由程式依攻擊距離驅動，或依縮放比等比換算）。

## 戰鬥特效與近戰（2026-11-13）

- **改為近戰**：NPC.xlsx 第486列「攻擊速度」3→0.4（次/秒）、「攻擊距離」32→5（米）、「魔法型」1→0（原值是上一隻BOSS的佔位數值，整段動作會被壓進 0.28 秒）。因此攻擊1「臉部衝撞」不需要衝出 6 米：遊戲版 GLB 只保留 0.9 m 的前撲，撞擊爆點由特效打在目標身上。名稱「劇毒之母」、屬性、技能、移動速度與倍率仍沿用原列。
- **特效**（只做畫面，命中與傷害仍由模擬層決定）：`js/boss-oni-fx.js` 在「敵人出手」事件後，依 BOSS 實際播放的動作把特效接到動作關鍵格——Attack1 撞擊爆點（0.633 s）、Attack2 嘴前吐氣＋三顆綠色小骷髏（0.467 s 放出；一顆射向目標、兩顆左右各偏 30°、各飛 60 米，速度 34 m/s）、Attack3 噴火（0.733～1.6 s，沿目標方向、長度＝到目標的距離、最長 15 米）；常駐兩眼紅光與腦後紅霧拖尾；死亡第 2 秒碎裂。八份 Preset 見 `vfx/presets/boss-oni-*.json`，id 在 `VFX_COMBAT_DEFAULTS.bossOni`，已登記於 `docs/vfx/VFX_PRESET_USAGE_OUTSIDE_TABLES.md`。
- 時間按實際動作長度換算：動作被壓縮到攻擊間隔內時，關鍵格時間同比例縮放（`npc3d.js` 記錄實際播放的攻擊鍵 `attackKey`，`hero3d.js` 新增 `ctrl.anchorPoint(name)` 取模型上 Eye_L／Eye_R／Fx_Mouth／Fx_Back 的畫面座標，`vfx-runtime.js` 新增 `playFree`）。
- 驗證：`tests/boss-oni-fx.test.cjs` 7 項（Preset 檔存在、眼睛在身體前／紅霧在身體後、三骷髏的 0／±30°／60 m 與命中、火焰 15 m 上限與時窗、撞擊與落空、碎裂、接線）；實機用 `node tools/boss5/capture-ingame.cjs` 在無頭 Chrome 跑真正的第5層塔戰並逐幀截圖，看到小骷髏扇形飛行與紅霧；眼睛紅光與噴火在混亂的實戰畫面裡不易辨認，另以放大的除錯標記確認位置與圖層正確。
- 尚未驗證：Preset 在 VFX Editor 的實際手感、各特效的尺寸與強度（只看過程式截圖與預覽）；沒有跑完整局到 BOSS 死亡碎裂的實機畫面。

## 三個貼圖版本與普攻輪替（2026-11-13）

- 版本：朱紅（原版）＝ `tower_boss_5`（5／55／105 層）、藍 `BOSS5_2` ＝ `tower_boss_15`（15／65／115 層，模型 `boss5_lv2.glb`、頭像 `boss5_oni_lv2.png`）、紫 `BOSS5_3` ＝ `tower_boss_25`（25／75／125 層，`boss5_lv3.glb`、`boss5_oni_lv3.png`）。三版動作、骨架、掛點完全相同；NPC.xlsx 第496、506列只改頭像、模型、動作與近戰三格（攻擊速度 0.4、距離 5 米、非魔法型，與第486列一致），名稱「劇毒之母」、屬性、技能、倍率沿用原列。戰鬥特效對三版都生效（`js/boss-oni-fx.js` 的 `NPC_IDS`）。
- **噴火普攻看不到的原因**：塔BOSS每次出手（普攻、普攻重擊、每個技能施放）都會播一個攻擊動作，`Npc3D.play` 把三個動作輪流（撞擊→吐骷髏→噴火）給所有出手，而特效只掛在「有普攻事件」的那一次。實測技能施放約占動作的八成，所以輪到噴火動作的多半是技能施放、沒有特效，普攻剛好輪到噴火的機率很低。現在動作在播放前決定：有普攻事件的出手固定依 撞擊→吐骷髏→噴火 輪替，技能施放一律用撞擊動作（不佔輪替）。普攻 0.4 次/秒，噴火約每 7.5 秒一次。
- 注意：技能施放（e_poisonspit 等）因此會看到「臉部衝撞」動作但沒有衝撞爆點；要不要讓施放用別的動作或加專屬特效，等使用者決定。
