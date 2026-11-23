# BOSS9 重型爪擊動作與判定預覽

目前任務 `BOSS9-DURATION-12-20261123`，基礎任務 `BOSS9-MELEE-PREVIEW-20261123`。完整動作由1秒延長至1.2秒，依使用者追加要求抬高揮爪時的身體、撐地手臂減少約半彎曲、兩腳固定地面，並依明確回覆取消向前突進。保留前視與已核准的漸進翻掌，先預覽確認再接入封魔塔；原模型、暫代材質及Walk保持，未改遊戲程式、配置表、特效或音效。

## 時間軸

| 階段 | 秒數 | 動作及事件 |
| --- | --- | --- |
| Windup | 0–0.25 | 雙爪貼地，下壓蓄力並平順轉向前方，雙腳固定。無水平位移或傷害。 |
| Active 抬爪 | 0.25–0.56 | 身體逐漸抬高，左爪原地承重，肩胸帶動右臂舉過肩。無突進或攻擊判定。 |
| Active 揮擊 | 0.56–0.75 | 右爪沿核准淺弧斜掃，脊椎減少向下前壓，身體旋轉、左臂較為伸展；頭眼朝前、腳掌定地。最高點 `HitboxOn`，最低點 `HitboxOff`。 |
| Recovery | 0.75–1.20 | 右爪於0.81秒按地，身體逐漸回穩，雙腳與左爪仍固定原處。全程無傷害或水平位移。 |

頭骨抵銷軀幹側轉、低頭及傾斜，頸部承擔45%的反向旋轉，維持略向下的前視與小幅自然起伏；0.25–0.81秒完整穩定前視，之後平順回到Idle。爪子掠過下顎時仍保留抬頸後收，維持原頭頸物理鏈長。眼睛隨頭骨朝前，原模型沒有獨立眼球骨。

完整動作為1.2秒，577個烘焙姿態、480Hz；Blend仍24FPS，最後關鍵幀為28.8（場景播放上限取29以涵蓋末幀），GLB動作長度恰為1.2秒。工具內沿用原2.4秒曲線座標，再重映射到spec秒制時間；Walk與Idle時長不變。Idle及右爪各指動畫通道按相同動作進度逐值核對，身體與支撐姿態依本輪要求調整。

雙腳IK目標全程固定在原起點，沒有小踏步、抬腳或滑動前進。左爪也原地支撐。依最新紅箭頭，畫面右側（解剖左側）的鎖骨與上臂外開，肘部向外撐，前臂再向下銜接手掌與分開的原指爪。高舉瞬間保留約60度的支撐肘轉折，隨下揮逐漸過渡到約半的原過度彎曲；不把整條支撐臂拉直。揮下時正向脊椎前壓減少50%，以鏈長求出抬高量，最大約0.222模型單位；較高的起手姿態不再強加整體抬升，以保留圖示肘形。骨骼、網格與權重沒有拉長或重製。

右爪保留朝上張掌、淺弧下掃與逐漸翻轉：0.60秒仍處於翻掌初段，0.65秒約中段，0.70秒才接近完成；對應實際指尖正面投影方向仍約3／56／106度。肩肘腕IK配合較高的身體重新求解，手掌旋轉沿用核准軌跡；原突進曲線只作維持掌形旋轉的製作參考，不會移動模型。前版爪群路徑在比較時扣除已取消的突進。

最新支撐臂參考為使用者的`codex-clipboard-a51e38fb-a402-456a-97f5-fa6f997105f5.png`，SHA256 `060d7e5efa5bef5a81014d73abd34b8c8c930cfd45abbb4b08656a328eaf5023`，分析上臂外開、肘部與前臂向下承重的紅箭頭。前視沿用`codex-clipboard-646074b1-1b57-4c95-92ef-b370e9ca43a4.png`，SHA256 `e69411610ad8f89e556a07e814fbb5fcca5207690d6ea61864f6c94535f67b92`；另沿用先前核准的淺弧與張掌。只分析姿勢／路徑，沒有複製參考像素、背景或綠色刀光。

## 判定與位移

`tools/boss9-lizard/melee/spec.json` 是本預覽的唯一時間軸與參數來源。Blender、GLB animation extras、預覽頁及 controller 使用同一份 `AnimationNotifies`，精確時間以秒記錄；Blend pose marker 的整數影格僅供編輯時定位，不作傷害事件來源。

`controller.js` 提供可獨立使用的 `Boss9Melee.Attack`。`advanceTo(seconds)` 按事件邊界切分更新，最多每步 1/240 秒，跳幀也不漏開關事件；每次攻擊保存已命中 ID，單一目標只受一次物理傷害及擊退。回放／倒拖預覽會建立新的攻擊實例；持續中的實例拒絕時間倒退。

前方 **120度動態扇形** 有效區間為 `[0.56, 0.75)` 秒，射程由0.35增到1.5，於0.71秒達到最大值；背後、射程外或高度不符不命中。右爪於0.81秒按地，此時判定已關閉。通知、Hitbox與預覽拖曳範圍一起延長20%；傷害、範圍及測試靶擊退保持。

依使用者選擇，Root Motion距離為 **0**，整段固定站位，既有RootMotionOn／Off事件保留為階段邊界。BOSS阻擋Capsule仍半徑0.7、高1.7、前偏0.55、間隙0.005；玩家半徑0.18、高0.95。一般靶放於前方1.6、貼近靶1.435，後者初始間隙恰為0.005；測試靶距離配合取消突進調整，不是更動攻擊射程。控制器保留原連續掃掠能力，以測試副本啟用0.35移動驗證阻擋及不補跳，正式本預覽始終不移動。

`previewOnly` 的 25 物理傷害、100 HP、0.24 單位／0.18 秒擊退只是測試靶參數，不是 NPC 數值配置。正式接入須接現有戰鬥傷害入口、玩家 Capsule 與既有世界碰撞／移動系統；目前沒有呼叫遊戲 Runtime，不代表封魔塔已具備此技能。純近戰測試不包含毒傷、粒子、發光控制或聲音。

## 檔案與操作

素材庫由 `tools/vfx/vfx-library-root.cjs` 解析，目前包為 `D:/MyGame/Asset/codex-authored/boss9-lizard-melee-20261123`。

- `source/boss9_lizard.glb`、`.blend`：已核准直行基底；GLB SHA256 `23319786f8663d55bbde4ee7ae48bd2259e7a493114994cb9407dd2d731dbf5d`。
- `source/tools/`：本輪九個製作、判定、預覽與封裝工具；另保存本文件與獨立測試。
- `exports/boss9_attack1.blend`、`.glb`：可編輯骨架與成品，包含 `Walk`、`Idle`、`BOSS9_Attack1`；`build.json`、`validation.json` 保存製作及驗證資料。
- `preview/BOSS9_Attack1.gif`：正面；`BOSS9_Attack1_Side.gif`：側面；`BOSS9_Attack1_Hitbox.gif`：有效幀／單次命中；`BOSS9_Attack1_Capsule.gif`：貼近目標與原地膠囊接觸。均900×600、60張、每張20ms，解碼總長恰為1.2秒，取120張實際GLB擷取的偶數幀。
- `preview/BOSS9_Attack1_Path.gif`：正面加三根長爪尖的實際路徑，細線由最終GLB蒙皮頂點量測，隨揮擊逐段顯示；不是貼上參考圖曲線，也不是遊戲刀光特效。
- `preview/BOSS9_Attack1_Arc_Slow.gif`：完整4倍慢放，Path全部120張×40ms，共4.8秒，檢查腳掌定地、撐臂承重與全身連動。
- `preview/BOSS9_Attack1_OpenPalm.png`：0.55秒的高舉張掌定格，取預覽擷取第55張。
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

本輪比較輸入為素材庫a435f8d7的同路徑前視成品，SHA256 `60061ae341708209243d74595df101c760c730042d1172c970df2b169c80f853`（上述命令最後參數填此檔），可從該Git版本取出。封裝前REVIEW_DIR需有通過的build.log／verify.log／unit.log；瀏覽器透過launchHeadless及finally關閉。

## 驗證與限制

原GLB二進位、Walk、73骨、網格、權重、貼圖及材質保留。原生Blend與重匯入GLB各1153時點（含錯相補間），檢查骨長、物理鏈、連續性、雙腳／左爪定地、全程腳掌接地、root／Idle及8組指定三角形穿插。與前版核對Idle與指部通道，並量測胸口抬高與左肘角度比值。頭頸鏈長保留已核准Idle的來源pose修正。

頭向驗偏航<3度、向下2–8度、傾側<3度，Three.js再獨立量測。爪群淺弧、實際指尖轉向與漸進翻掌維持；整段手掌世界旋轉對核准版差<0.2度。相鄰前臂IK蒙皮使掌面法線約變1–3度，與掌骨旋轉分開限制<5度。原肘角大於80度的過度彎曲階段約減半；高舉時另驗上臂向外、前臂向下及45–80度肘形。胸口抬高檢查取原本下壓的0.62–0.75秒，腳掌漂移<0.0001。Path細線取實際蒙皮頂點。validation.flow.directionSamples沿用2.4秒製作座標，其餘通知及palmTransition.sampleTimes為最終1.2秒時間。

16項判定測試包含完整1.2秒、零突進與貼近靶無重疊，保留事件邊界、前後搖無傷害、單次命中／擊退、FPS／跳幀、扇形／Capsule／轉向，以及可移動測試副本的阻擋回歸。五視圖600張檢查前視、腳掌定地、root零位移、膠囊間隙、通知、動態弧掃、完整入鏡及頁面錯誤警告。UI播放／暫停／重播／正反拖曳／場景視角切換、六GIF逐幀解碼與聯絡圖目視。

局部原自動蒙皮在大角度扭轉時仍有拉伸，邊長分布實測保存在 validation，未更換已核准權重或宣稱全模型無自我交疊。碰撞已驗獨立預覽的靜態玩家 Capsule 與受擊移動；正式多人／地形／牆體、玩家主動移動、遊戲速度與動畫混合仍屬接入階段。下一步由使用者驗收 GIF，再決定接入，不合併／推送 develop 或 main。
