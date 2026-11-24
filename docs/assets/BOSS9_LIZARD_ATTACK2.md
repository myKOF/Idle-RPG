# BOSS9 第二招：加大張臂、連續加速抓落地面

任務 `BOSS9-ATTACK2-R3-20261124`。在GIF重做版基礎上依新箭頭擴大張臂、取消高舉停頓，加速下抓至兩腳之間的地面。使用者明定0.8／0.3／0.4秒，合計1.5秒，先交GIF驗收；末句總共0.5秒按分段加總視為筆誤並已告知。沒有接入封魔塔實戰、傷害、特效或音效。模型、暫代材質、73骨與權重沿用核准版本，雙後腳固定地面，已核准第一招完全保留。

| 時間 | 動作 |
| --- | --- |
| 0–0.8秒 | 起身仰頭張口，肩臂向外展開，前臂接續抬起；雙手高舉至最高點。 |
| 0.8–1.1秒 | 高點直接接雙爪斜向內下抓，逐漸加速；手腕翻至掌背朝敵人，爪尖抓至兩腳之間的地面。 |
| 1.1–1.5秒 | 雙爪、胸背、膝蓋與尾部連續回原站姿。 |

肩膀位置跟隨胸背，上臂與前臂以分開的旋轉弧線控制，維持實體骨鏈長度。高舉時雙肘張至約106度，前臂向外傾約23度，腕距由前版約1.067加大到1.239模型單位；手指隨前臂向外張開。頭胸先發力，手臂接續，尾部配合平衡；後腿以固定足端三節解算配合抬身，沒有前撲或踏步。原左手指骨有neck1／head／frontToe等自動命名，按父子關係使用既有四條指鏈，沒有增加或改名骨頭。

上臂先外展、前臂後抬，0.8秒高點直接接下抓，沒有高舉保持區間。下抓進度用時間比例的1.7次方，加快後段下降並在落地時收力；翻掌同步漸進。釋放以實際蒙皮爪群與雙節解算控制窄弧軌跡，肩胛隨可達距離配合，肘部彎曲方向避開腕部移動軸線，避免加速中翻折；不伸長骨骼。

依綠箭頭將末端收至中線兩側各0.15模型單位，在雙腳之間。每隻手按實際爪面求落地高度，1.1秒爪尖接地，不以兩隻手的相同中心高度假裝接地。仍保留掌背朝敵人，沒有末幀突然翻面；雙手不交叉、不互撞。

## 原始版本與參考

- 基礎參考 `Gemini_Generated_Gif_4ji6ud4ji6ud4ji6.gif`，SHA256 `7de5ca3aa4573f80b0fae1d29b45437ed7fb48208670a18a9fcfd19bdec7d1a6`：640×360、30張各100ms、原長3秒。前版逐幀分析後按0.5倍時間映射；本版由使用者新指定的0.8／0.3／0.4秒及箭頭覆蓋原高舉保持與落點，`reference.json`記錄分析和修訂，並非動作捕捉資料。
- 本版 `codex-clipboard-e6b9ae60-51d7-49bd-9fc2-17b1c556e291.png`指定加大張臂；`codex-clipboard-b62699bc-b2b6-4cc0-a477-18d4201c51c0.png`指定紅色下抓軌跡與綠色落點。SHA256記於reference.json，不把參考像素帶入成品。

- 已核准第一招素材庫提交 `825b0ca8cb4e31e0f8776c077c303b6d8bc29b9b`，專案提交 `5cada1bc`；來源GLB SHA256 `7cc2450cdf682f287c35c291e843a8bff7315faeeaab4fa8d33e873abfe0f190`。
- 新包的`source/boss9_attack1.glb`與`.blend`保存該核准來源。原第一招素材包及製作工具沒有修改。
- 使用者`codex-clipboard-82063002-b80a-4438-a5c9-c7358f717eee.png`，SHA256 `f0b0a31e31c34475c86e6cdab636d6fea43b3038ff54c5acbf330c958a4a780f`：分析雙爪向內斜下的兩條箭頭。
- 使用者`codex-clipboard-89a466fd-7cc2-4e30-ab2b-6a1cf7e0d571.png`，SHA256 `e89d51690438f50bd9eb8925af8efdcbda5464d37d34c39c8ae9e8e1eb75dba5`：修正下抓時的掌背朝向。

僅分析使用者提供的動作／朝向，沒有複製參考圖片像素；動畫、曲線與預覽由既有模型自行製作。

## 檔案及重建

素材庫位置以`tools/vfx/vfx-library-root.cjs`解析；包的穩定相對路徑是`codex-authored/boss9-lizard-attack2-20261124`。

- `exports/boss9_attack2.blend`與`.glb`：包含Walk、Idle、BOSS9_Attack1及新增BOSS9_Attack2；721個姿態、480Hz，原生編輯場景24FPS，共36格。
- `preview/BOSS9_Attack2.gif`：正面正常速度，75張×20ms，解碼恰為1.5秒。
- `preview/BOSS9_Attack2_Side.gif`、`_Path.gif`：側面與雙爪實際路徑；路徑細線是工具檢視標記，不是遊戲特效。
- `preview/BOSS9_Attack2_Slow.gif`：完整4倍慢放，150張×40ms，共6秒。
- `preview/BOSS9_Attack2_Raised.png`、`_BackHands.png`：0.80秒高舉與1.10秒掌背朝前接地定格。
- `source/tools/`及本文件：必要製作、檢視與驗證來源；`qa/`保留三視圖擷取、聯絡圖、解碼與製作／驗證紀錄。manifest記錄必要檔案及專案來源雜湊。

在專案中執行：

```text
blender -b --python-exit-code 1 -P tools/boss9-lizard/attack2/author.py -- SOURCE/boss9_attack1.glb SOURCE/boss9_attack1.blend OUTPUT_DIR
blender -b --python-exit-code 1 -P tools/boss9-lizard/attack2/verify.py -- SOURCE/boss9_attack1.glb OUTPUT_DIR/boss9_attack2.glb OUTPUT_DIR/boss9_attack2.blend OUTPUT_DIR/validation.json
node tools/boss9-lizard/attack2/capture.cjs REVIEW_DIR/front --azimuth 0
node tools/boss9-lizard/attack2/capture.cjs REVIEW_DIR/side --azimuth 75
node tools/boss9-lizard/attack2/capture.cjs REVIEW_DIR/path --azimuth 0 --guide
python tools/boss9-lizard/attack2/encode.py REVIEW_DIR
node tools/boss9-lizard/attack2/export.cjs --stage REVIEW_DIR
```

封裝前REVIEW_DIR需有build.log、verify.log及project-build.log。`capture.cjs . --serve`輸出可操作預覽網址，可播放／暫停、重播及拖曳時間；預覽與自動擷取使用相同GLB。

## 驗證及限制

驗證GLB原二進位前綴、網格／材質／權重及原三個動作保持；原生Blend的Walk／Idle／Attack1動畫曲線另以雜湊核對。新動作逐通道驗時長、721鍵、四元數、首末接縫；原生與GLB各1441時點含錯相補間，核對所有父子實體鏈長、尺度、連續性、固定腳掌／接地、原Idle及頂點等價。

驗證挺胸仰頭、高舉屈肘角與腕距加大、前臂向外傾，並量測高點三維近靜止最長區間、下抓／抬手平均速率與後段／前段加速比例。末點核對實際爪面接地、兩腳之間落點及掌背朝敵人；保留同步、向內下降、骨長與雙手／腳／頭8組指定三角形穿插檢查。關節連續性按每秒位移核對，粗略診斷不能代替480Hz完整驗證。

參考是單一正面影像，景深、遮蔽關節及骨架比例無法精確還原；依可見姿態與節奏製作，仍須使用者看GIF驗收。

三視圖共450張實際GLB畫面，核對完整入鏡、腳掌定地、零水平root、同步與掌背朝向、頁面錯誤警告、實際播放／暫停／重播及正反拖曳；四GIF逐幀解碼並核對雜湊。原自動蒙皮的局部拉伸及未涵蓋的甲片接觸仍可能存在，不宣稱全網格沒有任何交疊。正式世界碰撞、遊戲動畫混合、傷害與音效／VFX不在本次純動作預覽範圍內；下一步由使用者看GIF驗收。
