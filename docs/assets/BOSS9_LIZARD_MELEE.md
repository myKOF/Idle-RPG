# BOSS9 重型爪擊動作與判定預覽

目前任務 `BOSS9-RIGHT-RETURN-20261124`，基礎任務 `BOSS9-MELEE-PREVIEW-20261123`。依最新兩張箭頭圖，揮爪末端再向畫面右側延伸，並移除對側腳前的落爪停留，揮完直接回原爪位。保留1.2秒、已確認的支撐肩姿勢、較高身體、腳掌定地／零突進、前視及漸進翻掌，先預覽確認再接入封魔塔；原模型、暫代材質及Walk保持，未改遊戲程式、配置表、特效或音效。

## 時間軸

| 階段 | 秒數 | 動作及事件 |
| --- | --- | --- |
| Windup | 0–0.25 | 雙爪貼地，下壓蓄力並平順轉向前方，雙腳固定。無水平位移或傷害。 |
| Active 抬爪 | 0.25–0.56 | 身體逐漸抬高，左爪原地承重，肩胸帶動右臂舉過肩。無突進或攻擊判定。 |
| Active 揮擊 | 0.56–0.75 | 右爪沿淺弧向畫面右下斜掃，比前版更向右延伸；頭眼朝前、腳掌定地。最高點 `HitboxOn`，最低點 `HitboxOff`。 |
| Recovery | 0.75–1.20 | 右爪直接連續回收，途中略抬避開腳趾，1.12秒回到原爪位才按地，沒有對側腳前的中繼落爪或停留。身體與支撐側沿原曲線回穩，全程無傷害或水平位移。 |

頭骨抵銷軀幹側轉、低頭及傾斜，頸部承擔45%的反向旋轉，維持略向下的前視與小幅自然起伏；0.25–0.81秒完整穩定前視，之後平順回到Idle。爪子掠過下顎時仍保留抬頸後收，維持原頭頸物理鏈長。眼睛隨頭骨朝前，原模型沒有獨立眼球骨。

完整動作為1.2秒，577個烘焙姿態、480Hz；Blend仍24FPS，最後關鍵幀為28.8（場景播放上限取29以涵蓋末幀），GLB動作長度恰為1.2秒。工具內沿用原2.4秒曲線座標，再重映射到spec秒制時間；Walk與Idle時長不變。比對上版全部動畫通道，僅允許攻擊鏈spine_22／21／20／19旋轉改變；所有平移、縮放、指部局部通道及其他旋轉保留。全身其他分支的世界姿態也逐時點比對，維持頭、軀幹、尾、腳與已修正的支撐肩。

雙腳IK目標全程固定在原起點，沒有小踏步、抬腳或滑動前進。左爪也原地支撐。此自動骨架的可見肩肉主要綁於spine_06，而不只是IK上臂spine_07；前版雖已外移肘點，06至07仍向下約52度，肩肉便呈內折下垂。現在以胸側的06為支點，將這段實體連線平順展向身體外側，高舉時向外略下約4.57度，再由07／08／09解算肘腕，保留承重彎曲。改正的是肩骨帶出的整段方向，不是手掌固定扭轉90度。0.25–0.47秒逐漸展肩，至0.81秒保持承重，其後逐漸回Idle；必要時鎖骨依原有可達長度讓位。原身體抬高曲線及脊椎減壓保持，沒有重新降低身體。骨骼、網格與權重沒有拉長或重製。

右爪保留朝上張掌、淺弧下掃與逐漸翻轉：0.60秒仍處於翻掌初段，0.65秒約中段，0.70秒才接近完成。沿原淺弧逐漸增加向右偏移，末端增加0.22模型單位；末端深度向身體收近0.08以維持實際臂長，不拉長骨骼。手掌世界旋轉仍沿核准曲線，沒有突然轉腕。原突進曲線僅為掌形旋轉參考，不會移動模型。

收招以一條連續曲線從揮擊終點回原爪位，略抬0.17並向前留0.08的淨空；0.75秒開始回收，1.12秒才在原位觸地。手掌隨回收逐漸回到撐地朝向。刪除原本0.81–0.94秒停在對側腳前的安排，沒有先落地再抬回；身體與支撐側的回穩節奏保持。

追加的338321c0箭頭要求攻擊側上臂先向肩下垂，肘部留在畫面左側，再由前臂斜向右下銜接爪。原向上的elbow pole會把肘抬向身體內側，使前臂看起來直落；本版以外側pole引導肘部沿手臂平面落在肩下，保留前臂的斜向落差。採連續旋轉過渡，取消將pole反號的處理（反號會把肘彎回錯側）。爪尖目標與漸進翻掌曲線保持，調整的是上臂／前臂的彎曲平面。

最新參考為使用者的`codex-clipboard-2a1f90bc-0ec6-419a-bb5b-0ba5ae1f10b9.png`（SHA256 `760edf8c209ffdc2d8f7def9653d4c0f187a850e31621af19674edcc6a543d85`），分析更向畫面右側的揮擊；`codex-clipboard-595afac9-377d-43a4-be8a-bcf717a9d964.png`（SHA256 `b0ec93bfaf3f6c68142ea609946388b6040a6ed2b7e2c0e782b5d0a29d58547e`）指定移除中繼落爪。原b321e854圖的肩形、a51e38fb手指／撐地姿勢與646074b1前視保留。只分析姿勢／路徑，沒有複製參考像素、背景或綠色刀光。

追加`codex-clipboard-338321c0-e74f-422b-9af9-1539dd3ae0e8.png`（SHA256 `180ee1783bf8137176836aeabc198cdfe5d4d5a55749503a27ef904f049cb185`）作為攻擊肘彎曲方向參考，0.90秒另量測上臂向下、肘在肩下及前臂向右下的兩段方向。

## 判定與位移

`tools/boss9-lizard/melee/spec.json` 是本預覽的唯一時間軸與參數來源。Blender、GLB animation extras、預覽頁及 controller 使用同一份 `AnimationNotifies`，精確時間以秒記錄；Blend pose marker 的整數影格僅供編輯時定位，不作傷害事件來源。

`controller.js` 提供可獨立使用的 `Boss9Melee.Attack`。`advanceTo(seconds)` 按事件邊界切分更新，最多每步 1/240 秒，跳幀也不漏開關事件；每次攻擊保存已命中 ID，單一目標只受一次物理傷害及擊退。回放／倒拖預覽會建立新的攻擊實例；持續中的實例拒絕時間倒退。

前方 **120度動態扇形** 有效區間為 `[0.56, 0.75)` 秒，射程由0.35增到1.5，於0.71秒達到最大值；背後、射程外或高度不符不命中。`RightClawPlant`同步至1.12秒原位按地，判定早已於0.75秒關閉；不保留0.81秒的舊落爪事件。傷害、範圍及測試靶擊退保持。spec版本4將直接回收起點、原位按地、肘部pole回正與前視穩定末點分開記錄，避免把原位按地時間當成全程前視限制；原身體／頭部曲線不變。

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
- `preview/BOSS9_Attack1_Elbow.png`：0.90秒的攻擊肘定格，檢視上臂向下、前臂斜向右下的轉折。
- `qa/`：五視圖實際擷取資料、聯絡圖、GIF解碼及最終製作／驗證／單元測試紀錄；`manifest.json`記錄所有必要檔案雜湊及對應專案路徑，文字以LF正規化比較。

可操作預覽：

```text
node tools/boss9-lizard/melee/capture.cjs . --serve
```

開啟輸出的 localhost 網址。可暫停、重播、拖時間軸，切換正面／側面／俯視，以及純動作、命中、膠囊阻擋、背後或遠距靶。橘色扇形僅為判定檢視，藍色線框為 BOSS 阻擋膠囊；測試靶受擊變色並移位。這些標記只存在獨立工具，沒有寫進遊戲。

重建步驟：

```text
blender -b --python-exit-code 1 -P tools/boss9-lizard/melee/author.py -- SOURCE.glb SOURCE.blend OUTPUT_DIR
blender -b --python-exit-code 1 -P tools/boss9-lizard/melee/verify.py -- SOURCE.glb OUTPUT_DIR/boss9_attack1.glb OUTPUT_DIR/boss9_attack1.blend OUTPUT_DIR/validation.json PREVIOUS_STANDING_ATTACK.glb
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

本輪比較輸入為素材庫2ef883d7的同路徑肩部成品，SHA256 `d669fdc2804202e63bd912c1770278382a62b4fedc103474d0010c11e211ae57`（上述命令最後參數填此檔），可從該Git版本取出。封裝前REVIEW_DIR需有通過的build.log／verify.log／unit.log；瀏覽器透過launchHeadless及finally關閉。

## 驗證與限制

原GLB二進位、Walk、73骨、網格、權重、貼圖及材質保留。原生Blend與重匯入GLB各1153時點（含錯相補間），檢查骨長、物理鏈、連續性、雙腳／左爪定地、腳掌接地、root／Idle及8組指定三角形穿插。比對前版全部通道，除攻擊鏈4骨旋轉外均保留；軀幹、頭、尾、腳及完整支撐側世界變換也逐時點核對。頭頸鏈長保留已核准Idle的來源pose修正。

頭向驗偏航<3度、向下2–8度、傾側<3度，Three.js再獨立量測。爪群保持淺弧與漸進翻掌，揮擊手掌世界旋轉對核准版差<0.2度；實際末端爪群向右偏移0.18–0.26、垂直路徑改變<0.01，起手不變。支撐肩仍向外>0.17、略下0–6度。未改分支在577個烘焙姿態誤差<0.00001，錯相補間誤差<0.0001，腳掌漂移<0.0001。另驗回收X方向連續、途中速度>0.3模型單位／秒、離地>0.025，最終原爪位誤差<0.0001；Three.js在0.80–1.08秒也核對手掌持續回收，沒有原停留區間。Path細線取實際蒙皮頂點。validation.flow.directionSamples沿用2.4秒製作座標，其餘通知及palmTransition.sampleTimes為最終1.2秒時間。

16項判定測試包含完整1.2秒、零突進與貼近靶無重疊，保留事件邊界、前後搖無傷害、單次命中／擊退、FPS／跳幀、扇形／Capsule／轉向，以及可移動測試副本的阻擋回歸。五視圖600張檢查前視、腳掌定地、root零位移、膠囊間隙、通知、動態弧掃、完整入鏡及頁面錯誤警告。UI播放／暫停／重播／正反拖曳／場景視角切換、六GIF逐幀解碼與聯絡圖目視。

局部原自動蒙皮在大角度扭轉時仍有拉伸，邊長分布實測保存在 validation，未更換已核准權重或宣稱全模型無自我交疊。碰撞已驗獨立預覽的靜態玩家 Capsule 與受擊移動；正式多人／地形／牆體、玩家主動移動、遊戲速度與動畫混合仍屬接入階段。下一步由使用者驗收 GIF，再決定接入，不合併／推送 develop 或 main。
