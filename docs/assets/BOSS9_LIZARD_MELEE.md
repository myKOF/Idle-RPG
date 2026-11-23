# BOSS9 重型爪擊動作與判定預覽

目前任務 `BOSS9-RESTORE-ARC-20261123`，基礎任務 `BOSS9-MELEE-PREVIEW-20261123`。使用者要求撤回前兩輪90度轉腕，並明確確認「讓手臂與手爪順著弧線連動」。先恢復至認可的4e31bb87／素材088f73d1版本，再以肩肘腕整條動作鏈、弧線切向及自然掌形重做右爪揮擊。先預覽確認再接入封魔塔；沿用核准蜥蜴模型、暫代材質及直行Walk，未改遊戲程式、配置表、特效或音效。

## 時間軸

| 階段 | 秒數 | 動作及事件 |
| --- | --- | --- |
| Windup | 0–0.50 | 雙爪貼地，後腿彎曲下壓、重心後坐，頭部微仰並張口。水平位移及傷害判定關閉。 |
| Active 抬爪 | 0.50–1.12 | 後腿蹬地短距前撲，左爪維持原地支撐，肩胸帶動右臂舉過肩。開啟 Root Motion，尚無攻擊判定。 |
| Active 揮擊 | 1.12–1.50 | 右爪沿外側下落並弧形橫掃至左下，身體隨之扭轉。最高點 `HitboxOn`，最低點 `HitboxOff`、`RootMotionOff`。 |
| Recovery | 1.50–2.40 | 右爪先按地承重，左爪換到新的支撐位置，軀幹回正、右爪回到正常左右站位，雙爪及後腿回到半蹲 Idle。全程無傷害判定。 |

右爪從舉起到揮下仍為1秒。1.12–1.50秒揮擊以弧線為主體：先沿外側下落，再穿過身前、末段向右掃出。肩、肘、腕與手爪共同跟隨弧線，指尖方向隨實際運動切向逐步轉變，手掌自然翻轉；取消固定／半程到位的90度朝向條件。結束揮擊後才轉回按地支撐，末段指尖不插地。尾部、頭頸、上下顎、腰胸及後腿沿用認可基底的連動，左爪維持原支撐／換步。

動畫曲線以240Hz取樣577姿勢，Blend保持24FPS與原Walk。爪群沿彎曲橢圓軌跡移動，用含root前撲的世界座標切向帶動掌形，起手與落地以四元數平順銜接。轉腕時補償爪群中心偏移，鎖骨與肩肘腕IK同步求解，保持骨段長度；可達極限的微調量記錄於build.json。支撐目標以世界座標固定，首尾姿勢一致、結束保留前進位置。與088f73d1逐通道核對，Idle及非右臂部位保持。

參考為使用者本輪的`codex-clipboard-31739921-c59b-4ae0-b0e5-ada5625d958b.png`（SHA256 `739a62ec17d2b0cf562532b4e64b3f112209c2904ffbf9868edb361b467c1e96`），只分析動作／弧線，沒有複製其像素、背景或綠色刀光。

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
- `preview/BOSS9_Attack1_Path.gif`：正面加三根長爪尖的實際路徑，細線由最終GLB蒙皮頂點量測，隨揮擊逐段顯示；不是貼上參考圖曲線，也不是遊戲刀光特效。
- `preview/BOSS9_Attack1_Arc_Slow.gif`：只取Path第56–75張（1.12–1.50秒），每張80ms、20張共1.6秒，供4倍慢放檢查弧線與手臂連動；正常技能時長不變。前兩輪錯誤掌形PNG／Wrist慢放已隨撤回移除，舊版仍可由Git歷史取得。
- `qa/`：五視圖實際擷取資料、聯絡圖、GIF解碼及最終製作／驗證／單元測試紀錄；`manifest.json`記錄所有必要檔案雜湊及對應專案路徑，文字以LF正規化比較。

可操作預覽：

```text
node tools/boss9-lizard/melee/capture.cjs . --serve
```

開啟輸出的 localhost 網址。可暫停、重播、拖時間軸，切換正面／側面／俯視，以及純動作、命中、膠囊阻擋、背後或遠距靶。橘色扇形僅為判定檢視，藍色線框為 BOSS 阻擋膠囊；測試靶受擊變色並移位。這些標記只存在獨立工具，沒有寫進遊戲。

重建步驟：

```text
blender -b --python-exit-code 1 -P tools/boss9-lizard/melee/author.py -- SOURCE.glb SOURCE.blend OUTPUT_DIR
blender -b --python-exit-code 1 -P tools/boss9-lizard/melee/verify.py -- SOURCE.glb OUTPUT_DIR/boss9_attack1.glb OUTPUT_DIR/boss9_attack1.blend OUTPUT_DIR/validation.json ACCEPTED_PRE_YAW.glb
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

`ACCEPTED_PRE_YAW.glb`為素材庫088f73d1的同路徑成品，SHA256 `743f2f705df8fe7e29485a47cfb5b06ae0349ab36461bc941976415506e755b4`，可從該Git版本取出。封裝前REVIEW_DIR需有通過的build.log／verify.log／unit.log。所有瀏覽器透過launchHeadless及finally關閉。

## 驗證與限制

原GLB二進位、Walk、節點、73骨、網格、權重、貼圖及材質保留。原生Blend與重匯入GLB各1153時點（含錯相補間），檢查骨長、四肢物理鏈、連續性、雙爪蓄力鎖定、支撐接地、root／Idle，以及雙手／手腳／手頭／雙腳指定區域三角形穿插。另逐通道比較認可基底，確保Idle及非右臂不受這次修改影響。

弧線驗證量測實際蒙皮爪群：橫向掃過、向下落幅、首尾連線的弓形偏差、上半段下降與末段橫掃比例；指尖方向與實際爪群速度的夾角須小於約35度，並限制逐步方向變化、末段指尖離地。這些條件取代先前強行固定掌向90度的驗收。Three.js再量測相同成品，Path的三條線取自三根長指末端群組。

14項判定測試涵蓋事件邊界、前後搖無傷害、單次命中／擊退、各FPS與跳幀、扇形／Capsule／轉向。五視圖共600張實際GLB擷取，另驗渲染root與阻擋後位移一致、膠囊間隙、收招停止、通知順序、動態弧掃與指尖跟隨、入鏡及無頁面錯誤警告；互動測試涵蓋暫停／播放／重播／正反拖曳／場景及視角切換。五份正常GIF及一份慢放逐張解碼、聯絡圖目視。

局部原自動蒙皮在大角度扭轉時仍有拉伸，邊長分布實測保存在 validation，未更換已核准權重或宣稱全模型無自我交疊。碰撞已驗獨立預覽的靜態玩家 Capsule 與受擊移動；正式多人／地形／牆體、玩家主動移動、遊戲速度與動畫混合仍屬接入階段。下一步由使用者驗收 GIF，再決定接入，不合併／推送 develop 或 main。
