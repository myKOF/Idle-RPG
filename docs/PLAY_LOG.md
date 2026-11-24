# 真人遊玩記錄（Play Log）

把「你自己實際怎麼玩」一邊玩一邊記到硬碟，拿來跟縮時模擬（`docs/SIM_HARNESS.md`）的策略對照，找出策略在哪些決策上比真人差、再改策略。

## 怎麼用

照平常開 **`啟動桌面版(內測).bat`** 玩就會自動記錄，不用另外開任何服務或 port。

- 記錄位置：`%APPDATA%\idle-rpg-internal\play_logs\`
- 確認有在記：遊戲主控台 `PlayLog.stats()`，或看 `%APPDATA%\idle-rpg-internal\logs\desktop.log` 的 `[playlog] 遊玩記錄啟用` 那一行
- 只有內測模式（`--internal`，原始碼執行）會記。網頁版、一般桌面版、打包版（正式與 demo）都不會記，也不會留下檔案。
- `--smoke --internal` 也會記，但寫在煙霧測試自己的 userData 裡，不會混進你的記錄。可以拿它來驗證記錄器。

## 和 `js/recorder.js`（真人操作錄製器）的差別

| | recorder（`?record=1`） | play log（本功能） |
|---|---|---|
| 用途 | 完全重播同一場 | 觀察、對照策略 |
| 亂數 | 必須固定（`?seed=N`） | 照常 |
| 存檔 | 錄製期間擋掉自動存檔 | 照常 |
| 落地 | 手動按「匯出」 | 自動，一邊玩一邊寫 |
| 能錄你真正在玩的那一局 | 不能 | 能 |

## 檔案

```
play_logs/
  play_YYYY-MM-DD.jsonl          一行一筆 JSON，依本機日期分檔
  saves/YYYYMMDD-HHMMSS_lvN.json 存檔副本（gzip，最多留 200 份，超過刪最舊的）
```

存檔副本可以直接拿來讓模擬器從同一個狀態起跑：

```
node scripts/run_sim.js --save=<存檔副本> --hours=1 --policy=scripts/sim/policy.extreme.json
```

`--save` 會看檔頭自動判斷 gzip，所以桌面版 `saves/` 裡的自動存檔也能直接讀。

## 每行的格式

每筆都有 `k`（種類）、`t`（現實時間毫秒）、`gt`（遊戲時間秒，取自最近一則 tick；開機前是 null）。

| k | 什麼時候 | 內容 |
|---|---|---|
| `session` | 每次開遊戲 | `protocol`（協議版本）、`edition` |
| `boot` | Worker 開機 | `offline`：離線結算摘要（超過 8 KB 只記大小） |
| `cmd` | 每個玩家操作 | `name`、`args`、`ok`；失敗時有 `err`（遊戲回的原因） |
| `log` | 遊戲日誌 | `kind`（log／flog／notice）、`cat`、`cls`、`msg`（已去掉 HTML） |
| `snap` | 每 60 遊戲秒 | `v`：tick 視圖（等級、經驗、金幣、資源、場景、關卡、生命、法力……）；`counts`：這段期間的計數；`casts`：各技能施放次數 |
| `save` | 每 15 分鐘（現實時間）一次 | `file`（saves/ 裡的檔名）、`level`、`zone`、`stage` |
| `persist` | 手動存檔、重新開局等非自動落地 | `kind`、`level`、`zone`、`stage`（不複製存檔） |
| `saveError` | 存檔副本寫入失敗 | `error` |

### 為什麼戰鬥訊息只計數

逐筆戰鬥訊息量太大：48 小時縮時模擬約 140 萬筆、200 MB，其中 74% 是命中與受擊。所以下列訊息不逐筆記，改成計數併進下一筆 `snap`：

| `counts` 鍵 | 來源 |
|---|---|
| `kill` | 擊敗敵人（`cls: log-kill`） |
| `hitTaken` | 敵人攻擊你（`cls: log-enemy-damage`） |
| `attack` | 你攻擊敵人（`cls: log-player-attack`） |
| `enemySkill` | 敵人施放技能（`cls: log-enemy-skill`） |
| `loot` | 戰利品（`cat: loot`） |
| `salvage` | 逐件分解（`⚒️ 分解 …`） |

技能施放（`你施放【X Lv.N】`）按技能名稱計入 `casts`。

其餘日誌全部逐筆保留，例如升級、推關、被擊倒、復活、強化成功或失敗、資源不足、BOSS、封魔塔、合成、背包已滿自動分解、離線收益、菁英群出現。估計每天約數 MB。

## 架構

```
js/bridge.js send()  ──(所有玩家操作的唯一出口)──┐
WorkerBridge: tick / ack / booted / persist ────┼─> js/play-log.js（緩衝，每 5 秒一批）
                                                 │
window.ApexHost.playLog（electron/preload.cjs） <─┘
        │ ipc: playlog:status / playlog:append / playlog:save
        ▼
electron/main.cjs setupPlayLogIpc()（只回應遊戲主視窗）
        ▼
electron/play-log.cjs：追加 jsonl、寫 gzip 存檔副本、限制大小與份數
```

- 遊戲頁面是不受信任的一端：檔名一律由主行程產生，每批最多 5000 行，單行超過 64 KB 會換成截斷說明，含換行的行會被拒收。
- 記錄失敗不影響遊戲：寫入錯誤只記到 `desktop.log`，遊戲照常運作。
- 測試：`tests/play-log.test.cjs`。

## 後續階段（未做）

2. **報告**：`scripts/play_log_report.js` 整理時間軸，包括推關、卡關、怎麼過的，以及各類操作的頻率，並和模擬在同等級時的狀態並排比較。
3. **決策對照**：把存檔副本載進模擬器，讓策略從同一狀態跑一段，再和你接下來實際做的操作逐項比對。
