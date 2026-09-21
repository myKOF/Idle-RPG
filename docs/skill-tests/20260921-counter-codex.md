# 技能測試報告：反擊最高階耗魔

- 日期：2026-09-21；Agent：Codex；分支：ai/codex，提交見本報告所在 Commit。
- 範圍：本次耗魔規則與顯示回歸，不進行完整技能平衡或 DPS 掃描。
- 環境：Node VM，固定角色攻擊 1000、生命 1000；傷害替身用於隔離耗魔，不載入使用者存檔。UI 使用正式渲染函式驗證 HTML。

| 項目 | 結果 | 證據 |
|---|---|---|
| 七階基本消耗 | PASS | 每階使用本列費用，強化亦生效；恰好足額可反擊，非逐階加總 |
| 三超神費用 | PASS | 尚未觸發超神效果也付基本 300；失效退回七階 |
| 反擊／招架 | PASS | 各付一次基本費；不足時不退回便宜階段 |
| 破甲／反擊盾 | PASS | 包含基本費，沒有額外扣費；無成功反擊不套用 |
| 二次反擊／狂化反殺 | PASS | 觸發另收 80／100；追加斬擊不再收基本費；無目標不收追加費 |
| 超神＋兩種追加 | PASS | 300＋80＋100＝480；不足後續追加費不影響已付款的本體 |
| 失效／鎖魔 | PASS | 卸下、死目標、不觸發不收費；GM 鎖魔可觸發且 MP 不減 |
| UI 快照／彈窗 | PASS | 快照包含超神，彈窗顯示 300 MP／次反擊；T3／T6 費用及追加說明一致 |
| 神聖／戰神／不屈／傳奇 | PASS | 使用 HEAD 工作簿，相關回歸 10/10 |
| 實機畫面／Console／DPS | 未測 | 非本次自動化驗證範圍 |

執行命令：

```text
node --test tests/skill2-counter-bloodrage.test.cjs tests/skills2-mana-cost.test.cjs tests/skill2-ui.test.cjs
node --test --test-name-pattern="神聖|戰神體|反擊|不屈鬥魂" tests/skill2-ult-evolution.test.cjs
node tools/build_check.cjs
node tools/config_tables.cjs --apply Skills2
git diff --check
```

第一組 35/35；第二組在使用者重排過的工作簿上有 1 項固定欄索引失敗，僅以暫存預載替換為 HEAD 工作簿後 10/10，未更動原檔。Build 379 檔通過，配置重建零語意差異。index.html 三方合併乾跑無衝突，雙方快取版本均保留。
