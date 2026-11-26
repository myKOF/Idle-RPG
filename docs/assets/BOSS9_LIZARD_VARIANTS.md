# BOSS9 三套正式模型與五動作

任務BOSS9-VARIANTS-20261127。使用者提供BOSS9.glb、BOSS9_2.glb、BOSS9_3.glb三套正式模型與材質，授權共用已核准五段動畫並接入封魔塔。本包取代遊戲中的暫代材質版；先前製作與接入包保留歷史來源。

| 模型 | NPC列／識別碼 | 樓層 | 頭像 |
|---|---|---|---|
| boss9.glb | 490／tower_boss_9 | 9／59／109 | boss9_lizard.png |
| boss9_lv2.glb | 500／tower_boss_19 | 19／69／119 | boss9_lizard_lv2.png |
| boss9_lv3.glb | 510／tower_boss_29 | 29／79／129 | boss9_lizard_lv3.png |

三者未綁骨，幾何位置與10423個三角形可精確對應核准版；UV／法線接縫拆分數不同。保留各自POSITION／NORMAL／TEXCOORD及索引，按完全相同的頂點位置轉移已修正的權重。重複位置的來源權重必須完全一致，否則製作直接停止；不使用近鄰模糊蒙皮。73骨靜止矩陣、階層、五動畫的全部sampler／channel及二進位曲線不變，三者保留同一靜態遊戲縮放／接地。

標準名稱Walk／Attack1／Attack2／Attack3／Die，素材時長依序2/3、1.2、1.5、1.5、4秒。待機保持Walk首幀；依使用者先前選擇保留NPC表攻速3次／秒，三招由既有ACT依攻速加速，死亡原速。原名稱／屬性／數值／專屬及隨機技能保持，沒有新增毒素、音效或VFX。

材質保留使用者完整PBR的base color、normal、metallic-roughness三張貼圖；原始8K／4K模型封存於素材庫，Blender縮為遊戲2K貼圖後內嵌，保留獨立PNG供編輯。頭像以同一正式模型在Blender渲染1080透明面部／上半身特寫；製作Idle僅暫用於頭像，正式GLB及可編輯Blend均只有五個標準動作。非人形採Blender流程，無MakeHuman人體或外部美術。

素材庫由tools/vfx/vfx-library-root.cjs解析，包為codex-authored/boss9-lizard-variants-20261127。source/inputs.json記錄三個完整原檔，以及核准五動畫與頭像姿勢來源的相對路徑／SHA。保存三個可編輯且貼圖打包的Blend、正式GLB／頭像、2K材質、工具、必要QA及manifest。

三份原始GLB各超過100MB，僅source/original內的三檔使用素材庫現有Git LFS。另一台電腦需先在素材庫執行`git lfs pull --include="codex-authored/boss9-lizard-variants-20261127/source/original/*.glb"`取得完整原檔，再執行製作／來源檢查；遊戲內正式GLB均小於33MB，維持一般Git檔案。

```text
node tools/boss9-lizard/variants/export.cjs --ingest INPUT1.glb INPUT2.glb INPUT3.glb
blender -b --python-exit-code 1 -P tools/boss9-lizard/variants/build.py -- PACKAGE
blender -b --python-exit-code 1 -P tools/boss9-lizard/variants/verify.py -- PACKAGE
node tools/boss9-lizard/variants/export.cjs --stage
node tools/boss9-lizard/variants/export.cjs --apply
node tools/boss9-lizard/variants/verify-runtime.cjs
node tools/boss9-lizard/variants/export.cjs --stage
node tools/boss9-lizard/variants/export.cjs --check
```

驗證涵蓋各套正式GLB／Blend45姿態的實際蒙皮與核准版表面誤差、完整幾何／UV／法線及動畫原始資料，renderer每套180個姿態與獨立Walk首幀待機、三招輪替／原速死亡，及9／19／29層真正塔戰與兩種頭像顯示。測試使用隔離靜音Chrome、seed9新局、既有GM基準與測試局關閉自動續層；不讀寫使用者存檔。NPC來源透過Excel原生API編修並正常重開，再匯出CSV與runtime，對照三列以外的內容和格式。

首幀檢查另比較Npc3D.create交付後的待機畫面、下一張零時間畫面及直接Walk0三者的逐像素alpha。冷啟動首繪曾有GPU拉線而骨矩陣一致，Npc3D現於Pixi接手畫布之前完成兩次零時間待機繪製，不推進步態或消耗攻擊輪次。`verify-runtime.cjs --idle-check`可單獨重驗；正式完整實機QA亦必須三者alpha完全一致。

單獨idle-check輸出為專案tmp下的暫時診斷，不納入素材manifest。開發期間留在qa的四個早期idle-check檔清理曾遭自動核准審查拒絕，原檔旁留且未納Git；完整首幀驗收仍保存在正式runtime.json與三張runtime-contact，不以暫存檔代替必要QA。
