# VFX 程式控制參數稽核與編輯

任務：VFX-CODE-CONTROLS-20260929。檢查範圍為目前 238 份 Preset、1,589 個圖層，以及 Core、Pixi Backend、Runtime Adapter、野外／高塔轉接與編輯器存檔管線。未改寫任何既有素材或 Preset 的預設外觀。

## 操作

雙擊「啟動VFX編輯器.bat」後，伺服器在背景執行；頁面開啟後啟動器黑窗會關閉。右上「重啟」也會啟動新的背景伺服器，再重新載入網頁。編輯器需要伺服器程序持續運行才能載入素材、存檔及預覽，但不需要黑窗。請用「關閉編輯器」停止伺服器；直接關閉網頁不會停止它，重新執行啟動器會清理本副本舊伺服器並重新啟動。

各工作副本的伺服器輸出保存於系統暫存目錄 `idle-rpg-vfx-<副本路徑雜湊>.log`。初次啟動重設日誌，重啟追加；啟動失敗時啟動器顯示錯誤與日誌位置，並保留視窗。手動執行舊的 `editor_server_window.bat` 仍是前景除錯模式，關閉該黑窗可能停止伺服器，與正常背景啟動不同。

重新啟動 VFX 編輯器伺服器後開啟特效。這次增加 Core 支援的欄位，僅重新整理舊伺服器頁面會讓伺服器仍以舊 schema 驗證，必須重啟一次。

- **程式變形／隨機鏡射**：開關、軸、起訖、振幅、寬度變化、鏡射機率與中心、主／細波頻率、細波比例、相位及作用圖層。修改直接反映在素材預覽。
- **遊戲播放控制**：程式額外施加的視覺值，依播放情境適用。數值存在同一份 Preset 的 `playback`，未填值使用 `VFXCore.PLAYBACK_FIELDS` 的共用預設；不維護第三份設定。
- **遊戲播放測試**：使用未存檔設定與正式 Runtime，可測試目標本體、受擊、天降、雷鏈、投射物、場域、環繞及雷光閃，可移動目標、暫停或重播。測試事件不改遊戲技能表。素材預覽本身沒有戰鬥事件，不能展示遊戲端的追蹤／裁切／續命。
- **本體尺寸／程式縮放基準**：現有米制與 authored 本體可直接輸入；完整 JSON 可調形狀或新增尺寸欄位。
- 粒子補上 **世界座標** 開關（預設 true）。程序旋風補上組件、配色、旋風前後粒子密度；半徑輪廓補上來源比例及上／中／下取樣位置。

例如 `aura-lightning-relay` 的 `web` 在 y=-30，原本 mirror=true 會以整體原點鏡射成 y=+30。取消「每次播放隨機鏡射」可以固定上下；保留鏡射但將中心設 -30，則會繞圖層原來的高度翻轉。

編輯使用既有 undo/redo；先驗證再提交，非法值不進入預覽或存檔。作用圖層改名時同步更新 deformation.layers。移除全部作用層會拒絕，停用整體變形請用開關。

### 每道落雷的隨機彎曲強度（2026-09-30）

「程式變形／隨機鏡射」新增 **隨機彎曲強度下限／上限**（`bendStrengthMin`／`bendStrengthMax`），範圍 0～1，下限不可大於上限。每次出生及完整形狀重抽時均勻抽取，同一道雷的所有作用圖層共用；不同雷各自抽取，固定 seed 可重現。未填兩者都視為 1，保留既有外觀。

`bolt-sky-purple.json` 可試下限 **0.1**、上限 **1**：接近 0 的中心線接近直線，1 保留原本的曲折。0／0 固定拉直，1／1 固定原形；貼圖亮部中心線與額外正弦位移一起減弱，保留距中心線的粗細，並非把整張 PNG 壓成零寬。鏡射機率、寬度變化與振幅仍分別作用。若只要出生時決定，重抽頻率維持 0；若要播放中變化，設定正頻率，強度範圍不同時即使重抽振幅為 0 也能重抽。

拉直使用貼圖亮部中心線，分叉及非線狀光團保留局部形狀，不保證變成完美幾何直線。新模式每層 98 頂點，貼圖中心線每張／每個方向只讀取一次並快取；舊模式維持 85 頂點，兩者均保留小網格批次預算。讀取失敗會明確回報，保留可見圖像，不將電柱壓成不可見。

本次只加入可調參數，不覆寫正在編輯的紫色 Preset。Core／後端為全局變更，舊編輯器應先備份未儲存內容，再按右上「重啟」，讓伺服器與頁面載入新 schema。

## 程式額外控制對照

| 路徑／適用情境 | 原本額外控制 | 公開參數 |
|---|---|---|
| 全部地面投影層 | projection.y 被場景傾角覆蓋 | sceneProjection；取消後保留圖層 projection.y |
| 範圍／天降受擊 | 受擊放大 1.6 倍 | hitScale |
| 天降投射物 | 起點高度 500px | fallHeight |
| proj-meteor-inferno、proj-thunderfall-sky | 無事件角度時固定 60 度 | fallAngle；有權威角度時仍採事件 |
| bolt-chain-travel-bluewhite | 尖端比例 12%、完整電弧取事件長度 | tipTaper、chainLengthM（0 採事件）；不改命中速度 |
| 連鎖投射物 | 進場曲線角度 120 度、控制點 0.55 | curveAngle、curveHandle；事件有控制點或權威 homing 時不覆寫 |
| 投射物 | 朝向平滑 0.05 秒 | facingTau |
| 突刺／飛行迴旋斬 | 動畫對齊時額外 0.08 秒 | projectileTail；仍在權威抵達時回收 |
| 持續場域 | 位置／尺寸／角度平滑 0.14 秒，位置修正上限為速度 0.3 倍 | groundTau、groundCorrection |
| ground-homing-wind-crescent | 航向／位置修正平滑 0.12 秒 | windTau |
| 狀態光環 | 尺寸平滑 0.15 秒 | auraTau |
| 岩甲、泥沼、火龍捲、火牆柱 | 出場／退場縮放各 0.3 秒 | fieldEnter、fieldExit |
| 吞噬場域 | 淡入 0.2 秒、淡出 0.3 秒 | devourEnter、devourExit |
| 環繞 | 整組中心向上 12px | orbitLift，設在環繞本體；整組共享中心 |
| ground-firewall | 三柱起點間距 0.8 | wallSpacing 控制世界排列；wallSourceSpacing 描述原圖拆柱間距，兩者分開避免互相抵銷 |
| 雷光閃 | 預設在生命週期 2/7 處伸滿 | flashArrival；配合素材的伸展曲線調整，抵達秒數仍採事件 |
| aura-earth-reversal | 複製岩甲幾何並強制換色 | inheritGeometry、runeTint、glowTint |
| burst-vacuum-shockwave | 複製 slash-wind-crescent 幾何及 sizing | inheritGeometry；取消後使用本身的圖層／尺寸 |
| 岩甲石碑家族 | 依前後位置拆層，覆寫前後透明度 | splitRockDepth；關閉後保留原圖層透明度 |
| 24 份 deformation Preset | 每次隨機相位、鏡射、寬度及正弦形變 | deformation 的完整參數區 |

地面世界位置、目標追蹤、命中／死亡／鏈結束、實際判定半徑、飛行速度、弧高、環繞半徑／角速度／團數、續命期限由戰鬥事件提供。這些不是一份素材可以獨立改掉的視覺值；Editor 顯示來源說明，測試場景提供模擬事件，不讓調外觀造成假命中或已死亡仍播放。

其他已存在的圖層控制：position／rotation／scale／outerScale／anchor、alpha／tint／blendMode、delay／duration／loop、全部 over-life 曲線、sprite sheet、projection、perspective／followDirection／followStretch、粒子發射／壽命／出生形狀／速度／方向／重力／阻力／徑向與環繞速度／noise／subEmitter、procedural scrollSpeed。這些直接使用 Preset，不另加替代值。

後端網格細分、貼圖快取、池大小、抗鋸齒等是渲染實作／效能機制，不當作美術參數。程序組件內的造形公式是組件實作，透過速度、密度、配色、輪廓、變換等參數調整。貼圖或圖集中本來畫出的形變仍須改素材或序列幀，不能用 offset 設定消除。

`js/vfx.js` 與 renderer 的 legacy fallback 是未採 Preset 時的另一套畫法，沒有可保存的 Preset；這次不把它包成第三種特效來源。正常配置特效走表格／已登記的 Preset 路徑；手動 `?vfx=legacy` 的舊畫法不受本編輯器參數控制。

## 驗證與交接

- 新增 `tests/vfx-editor-code-controls.test.cjs`：全目錄驗證／序列化、參數邊界、舊變形公式相容、鏡射中心、圖層改名、受擊縮放、天降、雷鏈長度與尖端、停止鏈、繼承色彩、編輯資料參照、正式儲存／重載、零時間出場、火牆間距不被拆柱抵銷。13／13 通過。
- 真實 Edge 編輯器：參數變更、dirty、undo／redo、正式 Runtime 移動目標雷鏈預覽、暫停／關閉，無 pageerror。另起測試伺服器讀目前程式，未關閉使用者的編輯器，也未寫入使用者 Preset。
- Build：404 個檔案通過。
- 未變更素材／Preset／layout，因此素材庫不需空提交。使用者期間修改的 `config/Excel/Skills2.xlsx` 保留，未納入本任務。
- index.html 與 Claude 未提交的 renderer 快取修改已做三方合併乾跑，無文字衝突；未實際合併、推送或修改其他副本。

綜合回歸：538 項，531 通過、1 跳過、6 項既有失敗（最後另補火牆測試，新增組目前 13 項通過）。

執行指令：

```powershell
node --test tests/vfx-editor-code-controls.test.cjs
node --test tests/vfx-editor-code-controls.test.cjs tests/vfx-core.test.cjs tests/vfx-pixi-sheet.test.cjs tests/vfx-editor-history.test.cjs tests/vfx-editor-save.test.cjs tests/vfx-editor-multi-edit.test.cjs tests/vfx-editor-paused-preview.test.cjs tests/vfx-editor-layers.test.cjs tests/vfx-preset-usage.test.cjs tests/vfx-runtime.test.cjs tests/lightning-vfx-lifecycle.test.cjs tests/skill2-lightning.test.cjs tests/skill2-chainlightning-thunder-legendary.test.cjs tests/worker-protocol.test.cjs
npm run build
```

6 項失敗均將 Core／Runtime 換為 HEAD 原版後重現：殞石燃燒、HISTORY-42 快照記憶體上限、16b 雷鏈非 canonical JSON、FIELD 分層、CATALOG-3 bolt-sky-purple 兩個根群組、STARFALL-TAIL 素材參數。未降低測試要求，未順手改素材。

未修改但檢查：js/vfx-pixi-backend.js、js/vfx-water-tornado.js、js/battle-renderer.js、js/vfx-tower.js、js/vfx.js、js/skills2.js、238 份 Preset、tools/vfx/editor-server.cjs、docs/vfx/VFX_PRESET_USAGE_OUTSIDE_TABLES.md 及現有測試。

交付範圍：正常 Preset 路徑的編輯控制已完成；legacy 強制模式仍為舊程式畫法，不受這些設定控制。可交整合，無新增測試失敗；未發布／推送。使用者可先以 aura-lightning-relay 驗看鏡射，再以遊戲播放測試檢查情境參數。
