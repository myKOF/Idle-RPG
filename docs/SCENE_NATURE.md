# 原創場景與完整物件素材

任務：SCENE-REBUILD-ALL-20261007；前輪接入 SCENE-RENEWAL-INTEGRATION-20261007。

七種野外地貌的地表／地下，以及試煉、地獄、煉獄三座祭壇均使用改造後的場景。荒漠用仙人掌與砂岩廢墟，冰原用雪松與冰晶，沼澤用垂柳與腐木，亡靈山脈用殘碑与骨骸，太古戰場用焦木／殘旗／斷刃，混沌用紫晶與異界遺跡，聖域用大理石與花叢。中央保留交戰空間。

## 美術與尺寸

大型不規則物件使用內建 imagegen 完整繪製：柳樹、焦木、雪松、仙人掌、冰晶群、紫晶、巨獸骨骸、倒木、樹樁，加上符文碑、石柱、拱門、殘牆、崩塌石堆、陶甕、墓碑，共十六份透明 PNG。依使用者修正採較大的色塊、少量枝葉與切面，優先保留縮至遊戲尺寸時的辨識度。小花草、碎石、部分祭壇小擺件、接觸區與地板仍為原創 Canvas／Python 程序美術。

RPG Maker MV 的 Outside_B／Forest 僅唯讀觀察自然輪廓、左上光與根部覆蓋，不向生成工具提供參考圖；沒有匯入、裁切、描摹、改色或拼貼第三方素材。使用者明確指定 AI 完整繪製，此次工具選擇依此指示。

素材庫 codex-authored/scene-nature/ 是母來源：

- originals/*.png：選定 AI 原稿等比縮小保存，兩邊均不超過 1024 像素。工具原始候選不屬於正式素材。
- sprites/*.png：僅裁透明留白、等比縮小；兩邊均不超過 512 像素，保持 RGBA 真透明。
- imagegen-prompts.json、generation-records.json、sprite-exports.json：完整提示詞、生成來源雜湊與尺寸、匯出裁切框／尺寸／雜湊。
- decor-nature.js、gen_ground_tiles.py、ground/*.png：共用原創建圖來源與八張 256×256 無方格地板。

遊戲使用 images/scene/*.png，不直接讀取本機素材庫路徑。貼圖單次載入、建圖時畫入圖集；每幀不重畫物件、不產生新貼圖。

## 渲染與動態

DecorNature.loadImages() 去重非同步請求，失敗後允許補載缺圖；主端與 OffscreenCanvas Worker 使用相同完整素材與種子。本體等比縮放，底部腳點固定。BattleDecor 決定地貌配色／尺寸／固定種子。

每個直立物件有同圖集 foot_ 接觸區，在地面層以同腳點、倍率及翻面放置。本體沿用 billboard、深度排序與遮擋淡出；接觸區留在地面。根部泥土、碎石、雪緣讓物件與地板銜接。

草、蘆葦、垂柳、雪松與殘旗輕微隨風；根部保持固定。水窪有擴散泡紋與毒氣，焦木冒煙，冰晶有霜霧，紫晶有異界微光，混沌植被採暗紫褐毒草／暗紅花／褐色枯草，聖域花叢有花瓣。局部裝飾純視覺，不涉及傷害、碰撞、存檔或技能 Preset。

野外每次只選鏡頭附近最多六組局部來源、共十八個粒子；lite 模式最多兩組／兩個粒子且略過植物搖擺。三塔另有固定六團局部煙霧。原天氣系統保留，以上上限僅指新局部粒子。粒子池重用，隱藏／暫停／dt=0 時凍結，換圖與退出全部回收。

八張地板移除規則磚縫，低對比色斑與零星深色裂痕做無縫平鋪，所有野外裂紋取消彩色光暈與描邊；三塔也移除原規則石板方格。Renderer 無貼圖後備同樣移除格線。

## 匯出與驗證

先編輯母來源，再在遊戲根目錄執行；--make-sprites 使用工作區 Sharp，相依路徑依本機 runtime 配置。

```text
node tools/scene-renewal/export-source.cjs --make-sprites
node tools/scene-renewal/export-source.cjs --apply
node tools/scene-renewal/export-source.cjs --check
node --test tests/battle-decor.test.cjs tests/battle-arena.test.cjs tests/battle-perspective.test.cjs
npm run build
git diff --check
```

匯出器拒絕超過 1024×1024 的母圖；來源文字以 UTF-8／LF 核對，二進位素材核對原始 SHA256。繪圖模組、主頁、Worker 與工具版本一起更新，Worker Asset 快取同步但協議不變。

tools/scene-preview.html 使用正式 Renderer 與獨立角色，不讀取真人存檔，可選七地貌／地下及三塔，播放／停止動態、前進返回、保存 PNG、核對十四份圖集、測量場景同步 CPU 成本。tools/decor-preview.html 仍提供圖集物件檢視。臨時場景 PNG 不納入素材庫。

實測沼澤空場每輪150幀：動態開／關／開的同步提交CPU中位數均約0.10ms，P95約0.30／0.20／0.30ms。局部來源5組／15粒子，關閉時計時固定。此測量不包含GPU時間，也不能當作大量技能或真人長時間戰鬥FPS保證。

十六份正式PNG共5,052,744 bytes（約4.82MiB）；單份解碼RGBA像素總和13,432,832 bytes（約12.81MiB），不包含Worker副本、GPU圖集與原天氣。全部真透明，至少27.6%像素為alpha=0；十六份必要母圖均為1024×1024。十四份主端／Worker圖集逐像素比對alpha及預乘RGB差均為0。


## BOSS 祭壇擺件與屬性燈光（2026-10-08）

新增 arena-gate、arena-brazier、arena-spire、arena-candles 四份完整原創 AI 圖。母圖等比縮至不超過1024×1024，正式圖分別504×512、456×512、348×512、418×512；PNG共1,293,080 bytes，解碼RGBA共3,534,848 bytes，不含Worker副本與GPU圖集。生成候選保留在Codex generated_images，完整提示詞與SHA256記錄在素材庫，未使用或輸入第三方圖像。

完整石材本體在建圖時以source-atop漸層壓暗腳底，較寬的深色塵土／碎石接觸區留在地面平面；執行期乘色配合環境光，保留原圖透明輪廓與簡化筆觸。火盆與門光降低集中亮斑，火焰／燭火／眼光以匯出圖的正規化附著點跟隨本體及billboard。後排小尖柱縮小並內移，避免頂端截斷。

BossArena.elementOf使用正式BOSS elem，無已知elem時讀attr；火、冰、雷、毒、聖、暗、土及風各有光色，未知或無屬性保留原塔色。毒系綠光，聖系黃白光；法陣、門光、火焰、地面光暈、火星與畫面邊緣一致。Renderer直接接收既有Worker塔戰實體，不修改協議、模擬或存檔。中性物件跨塔／屬性共用，法陣仍只有三份塔別配置，每元素只額外缓存60×84火焰貼圖；不製作3×8套大型貼圖。十九件擺件、四盆火與十二道小燭火，六團局部霧及46個原環境粒子；換場全部回收，暫停沿用既有dt=0凍結。

預覽工具新增BOSS屬性選項及帶屬性後綴PNG匯出。
