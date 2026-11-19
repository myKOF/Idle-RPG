# BOSS9 三攻擊與死亡動作審閱

任務 `BOSS9-COMBAT-APPROVED-20261120`，狀態 Review。使用者已確認移動動作，授權沿用核准模型、尾長及手腳形態製作其餘四招，先交 GIF 審閱。本輪另建素材包，未接入遊戲，未合併或推送。

## 動作

- `Attack1` 1.5 秒：軀幹和頭頸明顯後仰、張嘴，前衝約 5 米咬合，再退回原位。雙翼隨重心調整，短尾與四肢跟隨。
- `Attack2` 1.2 秒：向解剖右側轉體 90 度，右爪向右後上方蓄勢，再由右上向左下斜劈。肩、胸、腰、翼和尾巴共同轉動，揮爪路徑向前避開胸部，結尾回復飛行。
- `Attack3` 3 秒：頭身後仰蓄勢，再猛然前傾，張嘴持續噴射 20 米粒子火焰，收勢後回復飛行。沿用既有 `fire.json` 的火焰、亮芯、煙和餘燼四層及 `fire.js` 的程序材質，未加入外部火焰圖。預覽有完整射程刻度與動作近景。
- `Die` 2.5 秒：雙翼高舉、仰天張嘴長嘯，接著失衡下墜、翻轉側躺。高舉階段沒有振翼，落地時翼和四肢放鬆，尾巴沿身後伸展，最後姿勢保持。GIF 額外停留 0.8 秒以便審閱；未製作音效。

## 核准模型保持

依賴 `codex-authored/boss9-flight-limbs-20261120/exports/boss9_flight.blend`，SHA256 `c37fa124c488285508099f4634abe49b2fbf2102aaad9c797383ed264f19674c`。保存 70 骨、約 4.083 米的 60% 短尾、正面切左留右的單尾及上一輪手腳形態。未改模型頂點、拓撲、UV、自訂法線、權重、rest 骨架、材質及原三張 JPEG。

核准 `Walk` 的原生 FCurve 雜湊和導出的語意動畫通道逐項核對保持。四招從同一飛行姿態開始，三攻擊結尾回到該姿態；製作時只增加動作，不以動畫縮放拉長肢體。固定尾鰭比例沿用核准版。

本輪動作自製，過去使用者提供的飛龍 GIF 與圈圖只作姿勢參考，未將其像素放入模型、貼圖或成品。RPG Mote Studio 不適合編輯骨骼動畫，本輪沿用既有 Blender 製作與 Three.js 實際 GLB 預覽流程。

## 保存與重建

素材庫由 `tools/vfx/vfx-library-root.cjs` 解析；獨立包為 `codex-authored/boss9-combat-approved-20261120`。

- `exports/boss9.blend`：可編輯 5 動作來源；`boss9.glb`：Walk、三攻擊與 Die。
- `exports/combat-build.json`、`combat-validation.json`：來源雜湊、動作曲線、蒙皮及模型不變檢核。
- `preview/Attack1.gif`、`Attack2.gif`、`Attack3.gif`、`Die.gif`：實際 GLB 的 900×600、30 FPS 審閱；另保存位元組相同的核准 Walk GIF。
- `source/`：本輪製作、設定、檢核、擷取、編碼及打包工具，以及唯讀沿用的火焰工具和本文件。
- `qa/`：擷取紀錄、編碼報告、抽幀聯絡圖及必要製作日誌；`manifest.json` 核對素材包、依賴與專案工具 SHA。

```text
blender -b --python-exit-code 1 -P tools/boss9/combat_author.py -- APPROVED.blend OUTPUT_DIR
blender -b --python-exit-code 1 -P tools/boss9/combat_verify.py -- OUTPUT_DIR/boss9.blend APPROVED.blend OUTPUT_DIR/combat-validation.json
node tools/boss9/combat_capture.cjs REVIEW_DIR/frames
python tools/boss9/combat_encode.py REVIEW_DIR
node tools/boss9/combat_export.cjs --stage REVIEW_DIR
node tools/boss9/combat_export.cjs
```

預覽工具透過既有 `launchHeadless` 啟動並在 finally 關閉瀏覽器。`--serve` 可開啟本機審閱頁；`--quick`、`--clip Die` 僅用於製作中抽幀，不可取代正式完整擷取。

## 驗證與限制

重開原生 Blend，以 120 FPS 檢查四招實際蒙皮、骨長、有限值、攻擊離地及死亡接地；另檢查三攻擊的遠端雙手、雙腳和小腿下段對軀幹凸包，以及與翼膜和彼此之間的三角形穿插。肩髖等自然連接處、甲片及翼膜本身的接觸不屬於此檢核，不宣稱全模型所有自身接觸都已消失。

本輪共檢查 988 個時點，骨長最大誤差小於 0.0000004 來源單位；上述指定肢體區域的穿入／穿插計數均為 0。咬擊最大前移 4.9957 米，轉體右偏 90.0000 度，右爪重心由蓄勢至斜劈移向左約 2.761 米、向下 3.813 米、向前 4.957 米。死亡高舉翼的局部矩陣差小於 0.000001，證實保持階段未振翼；側躺末姿軀幹最低約 0.190 米、頭部最低約 0.276 米，整體最低約 0.035 米。這些是沿用原有硬質甲片與翼膜外形下的數值，不做落地物理布料模擬。

GLB 核對 5 個動作時長、三攻擊首尾、四元數正規化、原圖資料、材質和核准 Walk。四招正式擷取共 250 張，核對實際 GLB SHA、例外／警告及完整模型逐頂點投影。GIF 重開逐張解碼，核對循環及總時長，並抽幀目視檢查。粒子火焰由預覽程式即時計算，GLB 本身保存噴火動作和 MouthSocket；正式遊戲特效接入待使用者審閱後另行處理。

實際擷取的例外／警告均為 0，模型完整入鏡。粒子最遠 19.9991 米，3 秒結尾全部清除；四 GIF 分別 45／36／90／76 張，總時長 1.5／1.2／3.0／3.3 秒，死亡原動作維持 2.5 秒。

必要檢查包括 Python AST、Node 語法、`npm.cmd run build`、`combat_export.cjs`、本項 Git 差異及孤兒瀏覽器清理。只提交本輪工具、文件及 AI_TASKS 的本任務段落；同副本其他聊天的表格與遊戲程式修改保持。提交編號與實測結果記於 AI_TASKS 及交付回覆。
