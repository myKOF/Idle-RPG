# BOSS9 蜥蜴獸正式接入

任務`BOSS9-GAME-20261127`，命名修正`BOSS9-NAMES-20261127`。使用者2026-11-27核准死亡v2後，授權將模型、移動、三攻擊與死亡接入封魔塔；另明確選擇保留表定每秒3次攻速，動作隨攻速加快。正式模型與NPC欄位統一其他塔王的五動作命名，待機亦保持Walk首幀；角色名稱、屬性、戰鬥數值與技能配置沿用NPC來源表。

來源為素材庫`codex-authored/boss9-lizard-death-20261126/exports/boss9_death.glb`及原生Blend，GLB SHA256為`3df3a9e486bb5e513eea3236212b2e61c316cd8a8cf52f1fab2bb5bf3a25cca0`。保留使用者模型、暫代材質、73骨及已核准六動畫；自製的死亡編排已包含在來源。頭像以同一模型在Blender渲染，沒有新增外部美術、特效或音效。

`tools/boss9-lizard/game/build.py`以Blender建立遊戲用父節點，沿用製作待機高1.8米的尺度、後腳支撐區置中與地面歸零；正式GLB附加相同的靜態父節點，將三攻擊／死亡改為標準名稱、只匯出五段，保留完整二進位、模型／權重／材質與動畫通道，不重新烘焙或縮短核准曲線。原製作Idle仍保存在唯讀來源包，正式待機依其他BOSS規則使用Walk首幀，並非把Idle更名為Walk取代移動。來源初幀低趾尖差異隨原動作保留。正式原生Blend亦保留標準五Action及頭像攝影機／燈光。

NPC.xlsx第490列（tower_boss_9）指定模型`images/models/npc3d/boss9.glb`與透明頭像`sprites/boss/boss9_lizard.png`；僅套用第9／59／109層，19／29／39／49等獨立配置列保持。

| 語意 | 正式動畫 | 素材時長 |
|---|---|---|
| 待機 | Walk（首幀保持） | 不推進 |
| 移動 | Walk（循環） | 2/3秒 |
| 攻擊1 | Attack1 | 1.2秒 |
| 攻擊2 | Attack2 | 1.5秒 |
| 攻擊3 | Attack3 | 1.5秒 |
| 死亡 | Die（播完保持） | 4秒 |

沿用塔王ACT／Npc3D輪替三招，攻擊／施法按現有動作鎖與表定攻速調整播放時間；不將預覽工具的碰撞判定、毒素、刀光或音效另接入遊戲。GLB的locomotion資料指定rearFoot.R／L及hips，Hero3D先依GLTFLoader規則處理骨名，再用原有接地步幅演算法量測（本版約2.44678米／秒）；原Mixamo角色維持原路徑。行走按實際世界位移及步幅調速。

死亡保持原4秒，播完側躺後由既有退場流程淡出。塔王死亡快照不帶野外專用的獎勵清除倒數，現已明確處理該hp=0資料，避免被當成換場快速淡出；清理保險延至足夠播放片長、0.3秒淡出及0.5秒排程餘裕，短死亡仍至少3秒。手動確認／撤退／自動續層換場依原流程可中止演出，不為動畫延遲挑戰與獎勵。

素材庫位置由`tools/vfx/vfx-library-root.cjs`解析。正式包`codex-authored/boss9-lizard-game-20261127`保留可編輯Blend、GLB、1080 RGBA頭像、工具、來源SHA及manifest。`export.cjs --stage`只歸檔，`--apply`同步兩個遊戲圖像檔，`--check`核對來源／工具／遊戲資產雜湊。

```text
blender -b --python-exit-code 1 -P tools/boss9-lizard/game/build.py -- APPROVED.glb APPROVED.blend PACKAGE/exports
blender -b --python-exit-code 1 -P tools/boss9-lizard/game/verify.py -- APPROVED.glb PACKAGE/exports/boss9.glb PACKAGE/exports/boss9.blend PACKAGE/qa/placement.json
node tools/boss9-lizard/game/export.cjs --stage
node tools/boss9-lizard/game/export.cjs --apply
node tools/boss9-lizard/game/verify-runtime.cjs
node tools/boss9-lizard/game/export.cjs --stage
node tools/boss9-lizard/game/export.cjs --check
node --test tests/boss9-character-asset.test.cjs tests/npc3d-runtime.test.cjs tests/npc3d-locomotion.test.cjs tests/npc3d-config.test.cjs
```

verify.py重播來源、正式GLB及正式Blend各45個姿態，依build.json命名對應比對唯一靜態座標轉換後的實際蒙皮。verify-runtime.cjs以專案管理的隔離Chrome開啟真正遊戲：五動畫×四方向×九姿態共180張，另確認待機停在Walk首幀；檢查可見區域／播放完成時點／4秒死亡保持，再以本機seed=9、固定模擬步的新局及GM測試命令挑戰第9層，記錄移動、三招與死亡後回收。只在該測試局開啟遊戲靜音、關閉自動續層，三招觀察完成後才以既有maxstats／damage命令確保命中並擊殺，不驗音效或改正式設定。qa保存必要證據；測試瀏覽器由既有看門狗與finally關閉。
