# BOSS9 重型爪擊動作與判定預覽

任務 `BOSS9-MELEE-PREVIEW-20261123`。依使用者最新「純動作與判定邏輯」規格製作，先預覽確認再接入封魔塔。沿用已核准蜥蜴模型、手腳形態、暫代材質及直行 `Walk`，在新素材包追加 `Idle` 與 `BOSS9_Attack1`。本輪沒有修改遊戲程式、配置表、特效或音效；早先綠能版本需求由最新純動作規格取代。

## 時間軸

| 階段 | 秒數 | 動作及事件 |
| --- | --- | --- |
| Windup | 0–0.50 | 雙爪貼地，後腿彎曲下壓、重心後坐，頭部微仰並張口。水平位移及傷害判定關閉。 |
| Active 抬爪 | 0.50–1.12 | 後腿蹬地短距前撲，左爪維持原地支撐，肩胸帶動右臂舉過肩。開啟 Root Motion，尚無攻擊判定。 |
| Active 揮擊 | 1.12–1.50 | 右爪沿外側下落並弧形橫掃至左下，身體隨之扭轉。最高點 `HitboxOn`，最低點 `HitboxOff`、`RootMotionOff`。 |
| Recovery | 1.50–2.40 | 右爪先按地承重，左爪換到新的支撐位置，軀幹回正、右爪回到正常左右站位，雙爪及後腿回到半蹲 Idle。全程無傷害判定。 |

右爪從舉起到揮下正好 1 秒。揮擊時主要長指朝敵人、約向下 15 度；結束揮擊後才轉腕按地支撐，沒有把有效揮擊做成指尖插地。尾部延遲反向擺動協助平衡，頭頸、上下顎、腰胸、鎖骨與後腿都有連動。左爪於揮擊結束後才抬起換步。

動畫曲線以 240 Hz 取樣，共 577 姿勢；Blend 保持 24 FPS，保留原 Walk。爪群中心沿彎曲橢圓軌跡移動，以實際指尖蒙皮方向求手腕角度。雙臂為鎖骨跟隨及肩肘腕 IK，後腿保持原物理骨段長度；支撐目標使用世界座標避免隨前撲滑動。首尾姿勢一致，但結束位置保留向前移動，不拉回原地。

## 判定與位移

`tools/boss9-lizard/melee/spec.json` 是本預覽的唯一時間軸與參數來源。Blender、GLB animation extras、預覽頁及 controller 使用同一份 `AnimationNotifies`，精確時間以秒記錄；Blend pose marker 的整數影格僅供編輯時定位，不作傷害事件來源。

`controller.js` 提供可獨立使用的 `Boss9Melee.Attack`。`advanceTo(seconds)` 按事件邊界切分更新，最多每步 1/240 秒，跳幀也不漏開關事件；每次攻擊保存已命中 ID，單一目標只受一次物理傷害及擊退。回放／倒拖預覽會建立新的攻擊實例；持續中的實例拒絕時間倒退。

使用規格允許的前方 **120 度動態扇形**，有效區間為 `[1.12, 1.50)` 秒。射程隨爪子向前伸出，由 0.35 增到 1.5，於 1.42 秒達到最大值，避免剛舉到最高點便打中遠處玩家。包含玩家 Capsule 半徑、上下端及垂直範圍，背後或射程外不命中。右爪落地通知為 1.62 秒，此時 Hitbox 已關閉。

短距突進上限為 **0.35 模型單位**，僅 Active 前進；目前 GLB 匯出尺度視為米，正式接入若縮放角色，需同時換算位移、碰撞半徑與射程。BOSS 阻擋 Capsule 半徑 0.7、高 1.7，中心沿前方偏移 0.55，含 0.005 間隙；玩家測試 Capsule 半徑 0.18、高 0.95。前進採連續 Capsule 掃掠及最早碰撞時間，能擋住大步長穿透；被擋下的位移不會在玩家離開後補跳。預覽會同步抵銷動畫中超出實際可走距離的 root 平移，所以畫面與邏輯結果一致。

`previewOnly` 的 25 物理傷害、100 HP、0.24 單位／0.18 秒擊退只是測試靶參數，不是 NPC 數值配置。正式接入須接現有戰鬥傷害入口、玩家 Capsule 與既有世界碰撞／移動系統；目前沒有呼叫遊戲 Runtime，不代表封魔塔已具備此技能。純近戰測試不包含毒傷、粒子、發光控制或聲音。

## 檔案與操作

素材庫由 `tools/vfx/vfx-library-root.cjs` 解析，目前包為 `D:/MyGame/Asset/codex-authored/boss9-lizard-melee-20261123`。

- `source/boss9_lizard.glb`、`.blend`：已核准直行基底；GLB SHA256 `23319786f8663d55bbde4ee7ae48bd2259e7a493114994cb9407dd2d731dbf5d`。
- `source/tools/`：本輪九個製作、判定、預覽與封裝工具；另保存本文件與獨立測試。
- `exports/boss9_attack1.blend`、`.glb`：可編輯骨架與成品，包含 `Walk`、`Idle`、`BOSS9_Attack1`；`build.json`、`validation.json` 保存製作及驗證資料。
- `preview/BOSS9_Attack1.gif`：正面；`BOSS9_Attack1_Side.gif`：側面；`BOSS9_Attack1_Hitbox.gif`：有效幀／單次命中；`BOSS9_Attack1_Capsule.gif`：貼近目標阻擋。均為 900×600、120 張、50 FPS、2.4 秒，重播時從起點重設。
- `qa/`：四視圖實際擷取資料、聯絡圖、GIF 解碼資料及最終製作／驗證／單元測試紀錄；`manifest.json` 記錄所有必要檔案雜湊及對應專案路徑，文字以 LF 正規化比較。

可操作預覽：

```text
node tools/boss9-lizard/melee/capture.cjs . --serve
```

開啟輸出的 localhost 網址。可暫停、重播、拖時間軸，切換正面／側面／俯視，以及純動作、命中、膠囊阻擋、背後或遠距靶。橘色扇形僅為判定檢視，藍色線框為 BOSS 阻擋膠囊；測試靶受擊變色並移位。這些標記只存在獨立工具，沒有寫進遊戲。

重建步驟：

```text
blender -b --python-exit-code 1 -P tools/boss9-lizard/melee/author.py -- SOURCE.glb SOURCE.blend OUTPUT_DIR
blender -b --python-exit-code 1 -P tools/boss9-lizard/melee/verify.py -- SOURCE.glb OUTPUT_DIR/boss9_attack1.glb OUTPUT_DIR/boss9_attack1.blend OUTPUT_DIR/validation.json
node --test tests/boss9-melee-preview.test.cjs
node tools/boss9-lizard/melee/capture.cjs REVIEW_DIR/front --azimuth 0 --ui-test
node tools/boss9-lizard/melee/capture.cjs REVIEW_DIR/side --azimuth 75
node tools/boss9-lizard/melee/capture.cjs REVIEW_DIR/combat --azimuth 20 --scenario combat
node tools/boss9-lizard/melee/capture.cjs REVIEW_DIR/blocked --azimuth 75 --scenario blocked
python tools/boss9-lizard/melee/encode.py REVIEW_DIR
node tools/boss9-lizard/melee/export.cjs --stage REVIEW_DIR
node tools/boss9-lizard/melee/export.cjs
```

封裝前 `REVIEW_DIR` 需有通過的 `build.log`、`verify.log`、`unit.log`。所有瀏覽器透過專案 `launchHeadless()` 及 finally 關閉，不留測試程序。

## 驗證與限制

原 GLB 二進位、Walk、節點、73 骨、網格、權重、貼圖及材質逐位保留，只追加新動畫。原生 Blend 與重匯入 GLB 各檢查 1153 個時點（含錯相補間），驗證骨長、四肢實際關節段長、姿勢連續、雙爪蓄力鎖定、支撐手腳接地、root 曲線、收招 Idle、主要指尖方向，以及雙手／手腳／手頭／雙腳指定區域的三角形穿插。原生及 GLB 蒙皮頂點最大差約 0.0000012，支撐接地最大誤差約 0.0024。

14 項獨立測試涵蓋事件邊界與浮點累積、Windup／Recovery 無傷害、單次物理命中、擊退、30／60／144 FPS 與跨整段跳幀、扇形邊緣及垂直範圍、連續 Capsule 防穿透、斜向與端帽相撞、貼近阻擋、角色轉向及動態射程參數。四視圖共 480 張實際 GLB 擷取，另外驗證渲染 root 與阻擋後位移一致、膠囊間隙、收招停止位移、通知順序、動態弧掃、完整入鏡及無頁面錯誤／警告。互動測試實際點選暫停／播放／重播、正反拖曳、場景及視角切換。四個 GIF 逐張重開解碼並目視聯絡圖。

局部原自動蒙皮在大角度扭轉時仍有拉伸，邊長分布實測保存在 validation，未更換已核准權重或宣稱全模型無自我交疊。碰撞已驗獨立預覽的靜態玩家 Capsule 與受擊移動；正式多人／地形／牆體、玩家主動移動、遊戲速度與動畫混合仍屬接入階段。下一步由使用者驗收 GIF，再決定接入，不合併／推送 develop 或 main。
