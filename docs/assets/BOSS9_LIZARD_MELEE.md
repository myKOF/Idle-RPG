# BOSS9 重型爪擊動作與判定預覽

目前任務 `BOSS9-HEAD-ONE-SECOND-20261123`，基礎任務 `BOSS9-MELEE-PREVIEW-20261123`。使用者已核准漸進翻掌及轉向，本輪只改頭頸前視，並把完整蓄力、揮爪及收招由2.4秒等比例加速至1秒。先預覽確認再接入封魔塔；沿用核准蜥蜴模型、暫代材質及Walk，未改遊戲程式、配置表、特效或音效。

## 時間軸

| 階段 | 秒數 | 動作及事件 |
| --- | --- | --- |
| Windup | 0–0.2083 | 雙爪貼地，後腿彎曲下壓、重心後坐，張口蓄力並平順轉向前方。水平位移及傷害判定關閉。 |
| Active 抬爪 | 0.2083–0.4667 | 後腿蹬地短距前撲，左爪維持原地支撐，肩胸帶動右臂舉過肩。開啟 Root Motion，尚無攻擊判定。 |
| Active 揮擊 | 0.4667–0.6250 | 右爪沿核准淺弧斜向橫掃，身體隨之扭轉，頭與眼睛持續朝前。最高點 `HitboxOn`，最低點 `HitboxOff`、`RootMotionOff`。 |
| Recovery | 0.6250–1.0000 | 右爪於0.675秒按地承重，左爪換到新的支撐位置，軀幹回正，雙爪與後腿回到半蹲 Idle。全程無傷害判定。 |

頭骨抵銷軀幹的側轉、低頭及傾斜，頸部先承擔45%的反向旋轉，再由頭骨完成剩餘部分，維持略向下的前視方向，保留小幅點頭與側擺。0.2083–0.675秒完整穩定前視，之後平順回到原Idle；沒有把頭的位置固定在世界座標。爪子掠過下顎時頸部稍微抬起、後收，繞原關節旋轉並保持已核准姿態的頸部鏈長，避免碰到下顎。眼睛隨頭骨朝前，原模型沒有可獨立轉動的眼球骨。

完整動作等比例加速2.4倍，保留原577個姿態，烘焙密度為576Hz；Blend仍為24FPS，動作範圍0–24影格，GLB秒制長度恰為1秒。製作工具內保留原2.4秒的曲線座標，只在輸出時重映射至spec的時間軸，避免重採樣改變已核准的手部連動。Walk與Idle時長不變；所有非頭頸動畫通道按相同動作進度逐值核對，包含完整肩肘腕、手指、身體、尾巴、雙腿、左爪與root。

手部保持已核准的朝上張掌、淺弧下掃與逐漸翻轉：0.50秒掌面仍向上，首尾姿態角差進度約13%；0.5417秒約54%，0.5833秒約91%，對應指尖正面投影方向約3／56／106度。肩肘腕IK、指節張開與爪群補償沿用前版，不新增手指、骨骼或更改權重。起手與收尾姿態也保留。

本輪參考為使用者的`codex-clipboard-646074b1-1b57-4c95-92ef-b370e9ca43a4.png`，SHA256 `e69411610ad8f89e556a07e814fbb5fcca5207690d6ea61864f6c94535f67b92`，只觀察揮爪時頭與眼睛朝向前方；沿用先前淺弧、張掌圖與已核准的手部成品。只分析姿勢與路徑，沒有複製參考像素、背景或綠色刀光。

## 判定與位移

`tools/boss9-lizard/melee/spec.json` 是本預覽的唯一時間軸與參數來源。Blender、GLB animation extras、預覽頁及 controller 使用同一份 `AnimationNotifies`，精確時間以秒記錄；Blend pose marker 的整數影格僅供編輯時定位，不作傷害事件來源。

`controller.js` 提供可獨立使用的 `Boss9Melee.Attack`。`advanceTo(seconds)` 按事件邊界切分更新，最多每步 1/240 秒，跳幀也不漏開關事件；每次攻擊保存已命中 ID，單一目標只受一次物理傷害及擊退。回放／倒拖預覽會建立新的攻擊實例；持續中的實例拒絕時間倒退。

使用規格允許的前方 **120 度動態扇形**，有效區間為 `[0.4666667, 0.625)` 秒，精確值以spec為準。射程隨爪子向前伸出，由 0.35 增到 1.5，於0.5916667秒達到最大值。包含玩家 Capsule 半徑、上下端及垂直範圍，背後或射程外不命中。右爪落地通知為0.675秒，此時 Hitbox 已關閉。突進、通知、Hitbox及預覽拖曳範圍一起加速；距離、傷害與測試靶擊退參數保持。

短距突進上限為 **0.35 模型單位**，僅 Active 前進；目前 GLB 匯出尺度視為米，正式接入若縮放角色，需同時換算位移、碰撞半徑與射程。BOSS 阻擋 Capsule 半徑 0.7、高 1.7，中心沿前方偏移 0.55，含 0.005 間隙；玩家測試 Capsule 半徑 0.18、高 0.95。前進採連續 Capsule 掃掠及最早碰撞時間，能擋住大步長穿透；被擋下的位移不會在玩家離開後補跳。預覽會同步抵銷動畫中超出實際可走距離的 root 平移，所以畫面與邏輯結果一致。

`previewOnly` 的 25 物理傷害、100 HP、0.24 單位／0.18 秒擊退只是測試靶參數，不是 NPC 數值配置。正式接入須接現有戰鬥傷害入口、玩家 Capsule 與既有世界碰撞／移動系統；目前沒有呼叫遊戲 Runtime，不代表封魔塔已具備此技能。純近戰測試不包含毒傷、粒子、發光控制或聲音。

## 檔案與操作

素材庫由 `tools/vfx/vfx-library-root.cjs` 解析，目前包為 `D:/MyGame/Asset/codex-authored/boss9-lizard-melee-20261123`。

- `source/boss9_lizard.glb`、`.blend`：已核准直行基底；GLB SHA256 `23319786f8663d55bbde4ee7ae48bd2259e7a493114994cb9407dd2d731dbf5d`。
- `source/tools/`：本輪九個製作、判定、預覽與封裝工具；另保存本文件與獨立測試。
- `exports/boss9_attack1.blend`、`.glb`：可編輯骨架與成品，包含 `Walk`、`Idle`、`BOSS9_Attack1`；`build.json`、`validation.json` 保存製作及驗證資料。
- `preview/BOSS9_Attack1.gif`：正面；`BOSS9_Attack1_Side.gif`：側面；`BOSS9_Attack1_Hitbox.gif`：有效幀／單次命中；`BOSS9_Attack1_Capsule.gif`：貼近目標阻擋。均為900×600、50張、每張20ms，解碼總長恰為1秒，重播時從起點重設。由120張實際GLB擷取選最近時點，時差不超過1/240秒。
- `preview/BOSS9_Attack1_Path.gif`：正面加三根長爪尖的實際路徑，細線由最終GLB蒙皮頂點量測，隨揮擊逐段顯示；不是貼上參考圖曲線，也不是遊戲刀光特效。
- `preview/BOSS9_Attack1_Arc_Slow.gif`：沿用既有檔名，本輪擴為完整動作的4倍慢放，包含Path全部120張，30／40ms交替、解碼共4秒，方便檢查頭部前視與手部連動；正常技能仍為1秒。
- `preview/BOSS9_Attack1_OpenPalm.png`：約0.4583秒的高舉張掌定格，直接取正常預覽擷取第55張。
- `qa/`：五視圖實際擷取資料、聯絡圖、GIF解碼及最終製作／驗證／單元測試紀錄；`manifest.json`記錄所有必要檔案雜湊及對應專案路徑，文字以LF正規化比較。

可操作預覽：

```text
node tools/boss9-lizard/melee/capture.cjs . --serve
```

開啟輸出的 localhost 網址。可暫停、重播、拖時間軸，切換正面／側面／俯視，以及純動作、命中、膠囊阻擋、背後或遠距靶。橘色扇形僅為判定檢視，藍色線框為 BOSS 阻擋膠囊；測試靶受擊變色並移位。這些標記只存在獨立工具，沒有寫進遊戲。

重建步驟：

```text
blender -b --python-exit-code 1 -P tools/boss9-lizard/melee/author.py -- SOURCE.glb SOURCE.blend OUTPUT_DIR
blender -b --python-exit-code 1 -P tools/boss9-lizard/melee/verify.py -- SOURCE.glb OUTPUT_DIR/boss9_attack1.glb OUTPUT_DIR/boss9_attack1.blend OUTPUT_DIR/validation.json APPROVED_GRADUAL_PALM.glb
node --test tests/boss9-melee-preview.test.cjs
node tools/boss9-lizard/melee/capture.cjs REVIEW_DIR/front --azimuth 0 --ui-test
node tools/boss9-lizard/melee/capture.cjs REVIEW_DIR/side --azimuth 75
node tools/boss9-lizard/melee/capture.cjs REVIEW_DIR/combat --azimuth 20 --scenario combat
node tools/boss9-lizard/melee/capture.cjs REVIEW_DIR/blocked --azimuth 75 --scenario blocked
node tools/boss9-lizard/melee/capture.cjs REVIEW_DIR/path --azimuth 0 --guide
python tools/boss9-lizard/melee/encode.py REVIEW_DIR
node tools/boss9-lizard/melee/export.cjs --stage REVIEW_DIR
node tools/boss9-lizard/melee/export.cjs
```

本輪比較輸入為素材庫165cb773的同路徑已核准手部成品，SHA256 `d74d1b2e95418e620a34d2d7fd33eb56818b5a0bcae7a7e0c9655561b98b1723`（上述命令最後參數填此檔），可從該Git版本取出。封裝前REVIEW_DIR需有通過的build.log／verify.log／unit.log。所有瀏覽器透過launchHeadless及finally關閉。

## 驗證與限制

原GLB二進位、Walk、73骨、網格、權重、貼圖及材質保留。原生Blend與重匯入GLB各1153時點（含錯相補間），檢查骨長、四肢、指節及頭頸物理鏈、連續性、雙爪蓄力鎖定、接地、root／Idle及8組指定三角形穿插；按相同進度逐通道比較前版Idle及全部非頭頸姿態。頭頸鏈長採已核准Idle姿態並與前版核對，保留來源既有的pose位移，沒有用未修正的edit-bone間距取代它。

頭骨前向與上向從實際蒙皮變換計算，抬爪至右爪按地期間驗偏航小於3度、俯角在向下2–8度、傾側小於3度，並由Three.js再次獨立量測；實測最大偏航約1.34度、下俯4.00–4.78度、最大傾側約2.12度。非頭頸與Idle通道對前版最大差約0.000000477，Blend與GLB頂點差小於0.00000167。弧線、張掌及漸進翻掌驗收保持：爪群弓形偏差0.08–0.28、維持上版90–110%，初段仍向上、中段為過渡掌形、末段沿軌跡掃出。高舉最低朝上分量約0.675、各指伸展率約0.995、指尖高於掌部約0.290模型單位。Path細線直接來自蒙皮頂點。validation.flow.directionSamples保留原曲線的2.4秒製作座標；palmTransition.sampleTimes及GLB／spec通知則是最終1秒時間軸。

15項判定測試包含新增的完整1秒契約，並涵蓋事件邊界、前後搖無傷害、單次命中／擊退、各FPS與跳幀、扇形／Capsule／轉向。五視圖共600張實際GLB擷取，另驗前視角度、渲染root與阻擋後位移一致、膠囊間隙、收招停止、通知順序、動態弧掃與指尖跟隨、入鏡及無頁面錯誤警告；互動測試涵蓋暫停／播放／重播／正反拖曳／場景及視角切換。五份正常GIF及一份完整慢放逐張解碼、聯絡圖目視。

局部原自動蒙皮在大角度扭轉時仍有拉伸，邊長分布實測保存在 validation，未更換已核准權重或宣稱全模型無自我交疊。碰撞已驗獨立預覽的靜態玩家 Capsule 與受擊移動；正式多人／地形／牆體、玩家主動移動、遊戲速度與動畫混合仍屬接入階段。下一步由使用者驗收 GIF，再決定接入，不合併／推送 develop 或 main。
