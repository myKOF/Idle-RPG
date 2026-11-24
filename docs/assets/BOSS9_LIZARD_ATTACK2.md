# BOSS9 第二招：雙手高舉、同步斜向下抓

任務 `BOSS9-ATTACK2-20261124`。使用者已驗收第一招，本輪另製作約1.5秒的第二招，完成先交GIF；沒有接入封魔塔實戰、傷害、特效或音效。模型、暫代材質、73骨與權重沿用核准版本，雙後腳固定地面。

| 時間 | 動作 |
| --- | --- |
| 0–0.10秒 | 膝蓋短暫下壓蓄力。 |
| 0.10–0.64秒 | 胸背向後仰起，肩膀帶動雙臂高舉，雙掌逐漸張開。 |
| 0.64–0.70秒 | 高舉蓄勢，雙手指尖位於頭頂上方。 |
| 0.70–1.02秒 | 雙爪同時沿兩條向內斜下線抓下；手腕逐漸轉到掌背朝向前方敵人。 |
| 1.02–1.40秒 | 雙手收回原爪位，胸背、膝蓋與尾部回穩。 |
| 1.40–1.50秒 | 原待機姿勢，完整動作總長1.5秒。 |

第一招的上半身朝向、姿態與手腳造型作為基底。第二招使用獨立的肩肘腕與雙側指鏈，胸背後仰、膝蓋伸縮與尾部波動一起配合；肘部平面選在抬手軸線外側，避免手臂升起時突然翻折。原左手指骨有neck1／head／frontToe等自動命名，本輪按實際父子關係辨認，使用既有指節，沒有增加或改名骨頭。

雙爪實際蒙皮中心以左右對應目標控制，從中線外側約0.62下降到0.27模型單位，下降約1.47；路線略有自然弧度，不交叉到另一側。指節保持實體鏈長，高舉時伸展張開，下抓時逐漸彎指。下抓末段掌背朝前，由整段旋轉過渡到位，沒有末幀突然翻掌。抬手時IK會對超出臂長的目標作小幅可達修正，最大值記於build.json；骨長與縮放不改變。

## 原始版本與參考

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
- `preview/BOSS9_Attack2_Raised.png`、`_BackHands.png`：0.68秒高舉與1.02秒掌背朝前定格。
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

動作檢查涵蓋胸口抬高／後收、上半身仰起、指尖高過頭頂、張掌與指節伸展、雙爪同步內斜下軌跡及末段掌背朝前；檢查雙手、腳與頭的8組指定三角形穿插。關節連續性按每秒位移核對，使粗略診斷和480Hz完整驗證使用同一速度標準；不能用粗略取樣宣稱完整驗證。

三視圖共450張實際GLB畫面，核對完整入鏡、腳掌定地、零水平root、同步與掌背朝向、頁面錯誤警告、實際播放／暫停／重播及正反拖曳；四GIF逐幀解碼並核對雜湊。原自動蒙皮的局部拉伸及未涵蓋的甲片接觸仍可能存在，不宣稱全網格沒有任何交疊。正式世界碰撞、遊戲動畫混合、傷害與音效／VFX不在本次純動作預覽範圍內；下一步由使用者看GIF驗收。
