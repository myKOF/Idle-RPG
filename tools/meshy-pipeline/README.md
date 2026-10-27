# Meshy 3D 角色生產管線

用文字描述產生一個可在遊戲引擎使用的 3D 角色：模型、貼圖、骨架、動畫、預覽、QA 報告與成本紀錄。
付費生成走 Meshy API，其餘（修權重、改動作、檢查、渲染、匯出）全部在本機用 Blender 與 Node 完成。

第一個角色是「黃金騎士」（`sunbrand-knight`），整個流程與踩過的坑都來自這個案例。

## 原則

- **不綁定特定遊戲專案**：所有路徑可設定，輸出在 `assets/`，要不要匯入遊戲由人決定。
- **付費前先批准**：每個會消耗 Meshy 點數的指令都要 `--approved --max-credits <n>`，沒有就拒絕執行。
- **金鑰不進版本庫**：只從環境變數 `MESHY_API_KEY` 讀，輸出一律遮罩（只顯示前 4 碼與長度）。
- **先免費、後付費**：能用免費查詢、本機 Blender 修的，就不要重新生成。
- **不假裝成功**：QA 只報告量測值；程式判斷不了的（好不好看、手感、披風與腿穿插）明確標示需人工驗收。

## 需求

| 項目 | 版本／說明 |
|---|---|
| Node.js | 24（用了原生 `fetch`、ESM） |
| Blender | 4.5 LTS，背景模式執行（`winget install BlenderFoundation.Blender.LTS.4.5`） |
| ffmpeg | 做 GIF 與 MP4（`winget install Gyan.FFmpeg`） |
| Meshy 帳號 | 需 Pro 以上方案才能建立 API Key；點數由使用者自己購買 |
| `MESHY_API_KEY` | 設成**使用者層級環境變數**，不要貼進對話或檔案 |

Blender 與 ffmpeg 路徑會自動偵測，也可用環境變數 `BLENDER_EXE`、`FFMPEG_EXE` 指定。
管線用的是 REST 客戶端（`src/providers/meshy/client.mjs`），**不依賴 MCP**；MCP 伺服器另外註冊在 Claude Code 供對話使用。

先檢查環境（免費）：

```bash
node src/cli.mjs doctor      # 路徑、Blender、ffmpeg、金鑰遮罩、面數規則
node src/cli.mjs balance     # 查 Meshy 餘額
```

## 資料夾

```
tools/meshy-pipeline/
├─ config/pipeline.config.json   路徑、面數規則、預算、重試
├─ specs/                        每個角色的規格檔（見下）
├─ src/
│  ├─ cli.mjs                    doctor / balance / library
│  ├─ core/                      設定、金鑰、成本帳本與預算閘門
│  ├─ providers/meshy/client.mjs Meshy REST 客戶端
│  └─ jobs/                      各階段工作（付費的都要批准旗標）
├─ blender/                      背景模式腳本（處理、QA、渲染、匯出）
└─ assets/        （.gitignore） Models Textures Rigs Animations Previews Exports Reports Cache
```

## 設定

`config/pipeline.config.json`：

| 欄位 | 預設 | 說明 |
|---|---|---|
| `paths.assetsRoot` | `../assets` | 所有輸出的根目錄，可用 `PIPELINE_ASSETS_ROOT` 覆寫 |
| `polyBudget` | 目標 5000／軟上限 5000／硬上限 6000 | 超過目標只警告，超過硬上限不合格 |
| `budget.perTaskCredits` | 130 | 單一角色累計上限，超過就停下來問人 |
| `budget.perBatchCredits` | 200 | 全部角色累計上限 |
| `retry.maxAttempts` | 1 | 付費呼叫不自動重試 |

## 流程

下表依序執行。標「付費」的會消耗點數，需使用者先批准。範例都以黃金騎士的規格檔為例。

| # | 階段 | 指令 | 費用 |
|---|---|---|---|
| 1 | 概念圖（文字生圖） | `node src/jobs/concept.mjs specs/X.concepts.json A --approved --max-credits 12` | 付費，約 3 點／張 |
| 2 | 圖生 3D（無貼圖網格） | `node src/jobs/image3d.mjs specs/X.concepts.json A --approved --max-credits 25` | 付費，約 20 點 |
| 3 | 貼圖（Retexture，風格取自概念圖） | `node src/jobs/retexture.mjs specs/X.concepts.json A --approved --max-credits 15` | 付費，約 10 點 |
| 4 | 綁骨架（附贈走路與跑步動畫） | `node src/jobs/rig.mjs specs/X.concepts.json A --approved --max-credits 8` | 付費，約 5 點 |
| 5 | 查動作庫、下載預覽 GIF | `node src/cli.mjs library 關鍵字`、`node src/jobs/library-previews.mjs 0,11,12` | 免費 |
| 6 | 動作庫動畫（多個動作合併一次呼叫） | `node src/jobs/animate.mjs specs/X.concepts.json A --tag v2 --approved --max-credits 8` | 付費，每個動作 3 點 |
| 7 | Blender 處理（本機） | `blender --background --python blender/process_character.py -- specs/X.process.json <assetsRoot> <out.blend>` | 免費 |
| 8 | 程式 QA | `blender --background --python blender/qa_clips.py -- <blend> <qa.json> specs/X.process.json` | 免費 |
| 9 | 渲染預覽圖與動畫 | `blender --background --python blender/render_clips.py -- <blend> <outDir> 480` | 免費 |
| 10 | 匯出 GLB／FBX／各 clip | `blender --background --python blender/export_assets.py -- <blend> <outDir> <名稱>` | 免費 |
| 11 | 產生報告 | `node src/jobs/report.mjs specs/X.process.json <角色 id>` | 免費 |

`animate.mjs` 的 `--tag` 用來區分不同動作組（對應規格檔 `animate.sets` 的名稱），各組各自快取。
`preview.mjs`（文字直接生 3D）仍在，但黃金騎士的經驗是命中率低，**建議走概念圖路線**。

### 成本控管機制

- **預算閘門**：每個付費工作先估算點數，加上帳本已花的超過 `perTaskCredits` 或 `perBatchCredits` 就拒絕。
- **快取**：每個階段把任務編號寫進 `assets/Cache/`，重跑時直接重用，不會重複扣點。
- **帳本**：`assets/Reports/ledger.jsonl`，每筆記任務編號、估算、Meshy 回報的點數、以及**餘額前後差**（以差額為準）。
- **不自動重試**，也不購買點數或升級訂閱。
- 檔案在 Meshy 只保留 3 天，任務完成後立即下載。

黃金騎士的實際花費是 99 點，其中最終成品用到 50 點，其餘 49 點是試錯（兩次文字直生 3D 不合格、沒選的概念圖、後來規格取消的動作）。

## 角色規格檔（`specs/`）

| 檔案 | 內容 |
|---|---|
| `X.spec.json` | 原始設計：外觀描述、與參考圖的差異清單、面數規則、最初的文字生 3D 參數 |
| `X.concepts.json` | 概念圖提示詞，以及圖生 3D、貼圖、綁骨架、動畫的參數與估算點數 |
| `X.process.json` | Blender 處理規格（下一節） |

## Blender 處理規格（`X.process.json`）

`process_character.py` 讀這份規格，把原始 Meshy 檔烘焙成單一 `.blend`，每個動作一個獨立 clip。

頂層欄位：

| 欄位 | 說明 |
|---|---|
| `base` | 提供網格與骨架的檔案（相對於 assetsRoot） |
| `mirrorModel` | 左右鏡像整個模型並對調 Left／Right 頂點群組名稱 |
| `weaponBone` | 新增獨立武器骨骼（父骨為持武器手），並把武器頂點改綁到它 |
| `fist` | 手指折成拳頭（見下） |
| `clips[]` | 要輸出的動作，順序即輸出順序 |

每個 clip 的欄位：

| 欄位 | 說明 |
|---|---|
| `file`、`action` | 來源檔與其中的動作名 |
| `loop`、`hit` | 是否循環、是否產生命中事件 |
| `mirrorClip` | 整段動作左右鏡像（用於左手持武器的動作） |
| `alignGround` | 兩階段量測，把最低的腿部頂點對齊地面；倒地動作設 `false` |
| `cuts` | 把來源某一段壓縮成較少幀，用來刪除停頓而不產生跳動 |
| `easeTail`、`holdLast` | 結尾緩停到速度為零，再多停幾幀（死亡） |
| `weaponLay` | 倒地時劍逐步放平，劍尖貼地 |
| `handRoll` | 倒地時持武器手繞前臂滾轉，使手背朝下 |
| `finalStrike` | 砍擊結束的姿勢：胸口與頭轉正、持劍臂伸直、劍尖朝前（用正向運動學逐幀編輯，淡入／保持／淡出） |
| `weaponEdgeAlign` | 依劍尖速度繞劍軸滾轉，讓鋒口領先揮擊 |
| `avoidLegs` | 逐幀量測劍與腿的距離，繞握把以最小角度向外擺並平滑 |
| `handPose` | 某隻手相對前臂的旋轉，改用另一個動作的平均值 |
| `handInward` | 每幀重算「朝身體中線」的方向，把手繞手腕往內傾指定角度 |

所有動作都會自動：起始朝向歸零（面向前方）、臀部起點回到中心；骨架姿勢全部在「骨架空間」烘焙，所以鏡像、轉向、位移都不必碰骨骼階層。

### 權重與網格修正（`blender/skin_fix.py`）

Meshy 的自動綁定有幾個固定問題，這支腳本以**靜止姿勢的頂點位置**修正（整個模型是一整片焊接網格，無法靠連通性分離）：

- 劍被一半綁到小腿骨 → 以劍軸線距離判定，改為 100% 綁劍骨。
- 劍柄頂端的柄與圓盤綁在前臂 → 以沿劍軸延伸的半徑判定，再多取一圈相鄰頂點。
- 披風下緣綁在雙腿 → 改綁臀部與脊椎，披風才不會被兩腿拉開。
- 左手是張開的手、沒有手指骨 → 以**剛性分節**折成拳頭：關節位置取自原手頂點環的量測，只有關節範圍內的頂點轉動，金屬板片不變形；再整隻手在手腕向手掌側彎。

**這些門檻（半徑、關節位置、彎曲角度）是對黃金騎士量出來的，換角色一定要重新量測**，不能直接套用。

## QA

`qa_clips.py` 輸出 JSON，`report.mjs` 轉成報告。量測項目：

| 項目 | 判定？ |
|---|---|
| 三角面數 | 有（對照 `polyBudget`） |
| 循環接縫（首尾差 vs. 正常一幀的差） | 有（循環動作） |
| 地面（腿部最低點） | 有 |
| 死亡末幀是否靜止 | 有 |
| 腳底接地速度與變異（滑步） | 只報數字（遊戲內移動速度要與它一致） |
| 劍近身（2 公分內的頂點數） | 只報數字，**是靠近度，不是穿插判定** |
| 命中事件（以劍尖最快一幀為命中點） | 估算，需人工確認 |

程式判斷不了：整體好不好看、動作手感、披風與大腿穿插、手與劍是否自然。AI 視覺檢查只作輔助，**不能取代人工驗收**。

## 輸出

`assets/Exports/<角色>/`：

- `<角色>.glb`：模型、骨架、貼圖與所有動畫（各自獨立的 clip）
- `<角色>.fbx`：同上，每個動作一個 take
- `clips/*.glb`：各動畫單檔（骨架加該動畫，不含模型）
- `<角色>.meta.json`：片段名稱、幀數、循環、命中事件時間點、骨骼清單、面數

`assets/Previews/`：五方向預覽圖、各動作 GIF 與 MP4。
`assets/Reports/`：`<角色>.QA.md`、`cost-report.json`、`<角色>.run-log.md`、`ledger.jsonl`。

匯出後務必重新讀回驗證（動畫數、骨骼數、面數、貼圖），並渲染匯出檔確認動作沒走樣。

## 黃金騎士目前的成品與限制

- 4911 個三角面、25 根骨骼（含 `Sword`）、一張 2048 貼圖。
- 五個動作：戰鬥待機（41 幀）、跑步（16）、攻擊1（58）、攻擊2（77）、死亡（67），24 fps。
- 右手持單手劍；左手是拳頭。

已知限制（QA 報告有完整列表）：

- 死亡倒下過程中劍尖與披風暫時低於地面；攻擊1 蹲低時披風下緣低於地面約 11 公分。
- 攻擊1 是雙手動作，劍只在右手。
- 手與劍柄因為劍骨骼獨立旋轉，倒地時拳頭與劍柄之間有一小段距離。
- 沒有在實際遊戲引擎測試；匯出檔是在 Blender 重新匯入並渲染驗證。
- 未做受擊與走路（依規格只要五個動作）。NPC 的動作規範另外訂。

## 經驗與踩坑

- **文字直接生 3D 不要用否定句**：「no horns」反而長出角，「cape 到小腿」仍然拖地。先用文字生圖（約 3 點）篩選，滿意再圖生 3D，省點又好控制。
- **別假設動作庫的動作方向**：庫的人偶多為右手持武器，但個別動作（戰鬥待機）是持盾的左手。鏡像整個模型後，要逐一檢查每個動作的持劍手與手腕姿態。
- **Blender 的 glTF 匯出器會跳過「目前指派在骨架上」的動作**（ACTIONS 模式），導致少一個 clip。匯出前要先取消指派，並用讀回的 GLB 確認動畫數。
- **骨架空間單位是公分**（armature 物件縮放 0.01），而網格是公尺，量測與位移要分清楚。
- **glTF 匯入器會多出骨骼顯示用的小球網格**（無蒙皮權重），不在檔案裡；計算面數與包圍盒時要排除。
- **金屬護套不能變形**：折手指要用剛性分節，不能平滑彎曲，否則板片被拉歪。
- **改完要量測再說修好**：有一次「手掌朝向對齊」量測前後完全相同，等於沒做；先量、再給使用者看對照圖。
- 付費步驟一律先報成本、等批准；試錯成本要記進帳本與報告。

## 擴充

- **新增服務（Tripo、DeepMotion 等）**：在 `src/providers/<名稱>/` 實作與 `meshy/client.mjs` 相同形狀的客戶端，並新增對應的 `jobs/`；階段之間以任務編號與快取檔溝通，不依賴具體服務。目前 `pipeline.config.json` 的 `provider` 欄位只是標記，**尚未用來切換服務**，換服務時要一併加上這個切換。
- **新角色**：複製三份規格檔改名，先做概念圖；Blender 處理規格的門檻要重新量測（見上）。
- **之後可做**：Hit 與 Walk；NPC 動作規範；用動作庫動畫替代手動編輯（如果有更合適的動作）；為手指加骨頭以取代網格折拳。

## 不要做的事

- 不要把 API Key 寫進任何檔案、對話或報告。
- 不要在沒有使用者批准下執行付費工作，也不要自行購買點數或升級訂閱。
- 不要因為任務回傳成功就當作品質合格；一定要渲染、量測、給人看。
- 不要修改既有遊戲專案；成品放在 `assets/`，由人決定如何匯入。
