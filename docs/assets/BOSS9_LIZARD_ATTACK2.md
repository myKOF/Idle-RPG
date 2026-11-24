# BOSS9 第二招：依GIF重做雙爪下抓

任務 `BOSS9-ATTACK2-R2-20261124`。使用者否決前版的連動，改依新GIF重做；完整1.5秒，先交GIF驗收。沒有接入封魔塔實戰、傷害、特效或音效。模型、暫代材質、73骨與權重沿用核准版本，雙後腳固定地面，已核准第一招完全保留。

| 時間 | 動作 |
| --- | --- |
| 0–0.18秒 | 保持原四足半蹲。 |
| 0.18–0.68秒 | 骨盆、胸背逐節挺起，仰頭張口，上臂先向外展開。 |
| 0.34–0.78秒 | 前臂接續抬起，雙肘彎曲，手指張開並保留自然曲度。 |
| 0.78–0.98秒 | 挺胸仰吼蓄勢，上臂向外、前臂近乎朝上。 |
| 0.99–1.20秒 | 頭部先下收，1.02秒後胸背帶動雙臂往下抓。 |
| 1.04–1.35秒 | 雙爪同步往下、略向內抓，逐漸翻轉至掌背朝向敵人。 |
| 1.35–1.50秒 | 雙爪、胸背與尾部順勢回原待機。 |

肩膀位置跟隨胸背，上臂與前臂以分開的旋轉弧線控制，維持實體骨鏈長度；高舉時屈肘約85度。頭胸先發力，手臂接續，尾部配合平衡；後腿以固定足端三節解算配合抬身，沒有前撲或踏步。原左手指骨有neck1／head／frontToe等自動命名，按父子關係使用既有四條指鏈，沒有增加或改名骨頭。

上臂先外展、前臂後抬，形成屈肘高舉；不沿用前版直臂大V及單一抬手進度。抬手以分段旋轉控制，釋放時以高舉快照與雙節解算控制實際爪群下降，肘部彎曲平面仍由同一肩肘曲線提供。抬手初段以整條肩腕弧線小幅抬升避開地面，不伸長骨骼。雙爪下抓略向內收，不交叉到另一側；指節漸屈、手腕漸轉，保留先前掌背朝敵人的要求，沒有末幀突然翻面。

## 原始版本與參考

- 本次主要參考 `Gemini_Generated_Gif_4ji6ud4ji6ud4ji6.gif`，SHA256 `7de5ca3aa4573f80b0fae1d29b45437ed7fb48208670a18a9fcfd19bdec7d1a6`：640×360、30張各100ms、原長3秒。逐幀分析後按0.5倍時間映射為1.5秒；`reference.json`記錄人工判讀時點，並非動作捕捉資料。

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
- `preview/BOSS9_Attack2_Raised.png`、`_BackHands.png`：0.90秒高舉與1.35秒掌背朝前定格。
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

本版用參考中的挺胸直立、仰頭咆哮、屈肘／前臂朝上、頭先於雙爪下降及末段掌背朝敵人作為幾何檢查；不再用前版直臂V與近直線路徑當作驗收目標。保留雙爪同步、向內下降及雙手、腳與頭的8組指定三角形穿插檢查。關節連續性按每秒位移核對，粗略診斷不能代替480Hz完整驗證。

參考是單一正面影像，景深、遮蔽關節及骨架比例無法精確還原；依可見姿態與節奏製作，仍須使用者看GIF驗收。

三視圖共450張實際GLB畫面，核對完整入鏡、腳掌定地、零水平root、同步與掌背朝向、頁面錯誤警告、實際播放／暫停／重播及正反拖曳；四GIF逐幀解碼並核對雜湊。原自動蒙皮的局部拉伸及未涵蓋的甲片接觸仍可能存在，不宣稱全網格沒有任何交疊。正式世界碰撞、遊戲動畫混合、傷害與音效／VFX不在本次純動作預覽範圍內；下一步由使用者看GIF驗收。
