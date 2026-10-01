# 任務提示詞：吸血／吸魔改為定值（與每秒回復脫鉤）——數值與實機驗證

指派對象：Antigravity（Integration & QA Engineer）
規格提供：Claude（Architecture Engineer）
本文件為單次任務規格，共通規範見 AI_RULES.md、AGENTS.md、prompts/antigravity.md。
實作紀錄：docs/AI_TASKS.md 檔頭「Claude｜吸血／吸魔改為定值，與每秒回復脫鉤（DRAIN-FLAT-20261001）」。

---

## 0. 交付方式（先看這節）

**請開新對話執行。** 本任務與先前任何驗證沒有延續關係，開新的不損失脈絡。

**請先 merge。** 沒有這次的 commit，下面所有項目都不存在：

```bash
git -C D:/MyGame/Idle-RPG/antigravity merge --ff-only ai/claude
git -C D:/MyGame/Idle-RPG/antigravity merge-base --is-ancestor 42f3245f HEAD && echo OK
```

`ai/antigravity` 目前沒有自己的改動，是單純快轉。第二行必須印 `OK`（`42f3245f`＝「[Claude] feat: 吸血／吸魔改為定值，與每秒回復脫鉤」）。
**沒印 OK 就停下來回報，不要硬做。** 工作區不乾淨時不要同步（AGENTS 第 11 節）。

**工作副本與測試服**：在你自己的 `D:/MyGame/Idle-RPG/antigravity` 操作，測試服自己挑一個沒人用的 port。
**不要用 5500** —— 那個 port 服務的是 `develop`，`develop` 還沒有這次的改動，你會測到「修改沒生效」的假結果。
判斷服務來源最快的方法（console 執行，要印 `true`）：

```js
fetch('js/formula.js?bust=' + Math.random()).then(r => r.text()).then(t => console.log(t.includes('function lifestealHealAmount(value)')))
```

**唯讀模式。** 本任務不授權修改 `js/`、`css/`、`config/`、`tools/`、`tests/`、`scripts/`。發現問題請回報，不要自行修正。
允許新增的只有：驗證報告 `docs/skill-tests/20261001-drain-flat-antigravity.md`，以及 `docs/AI_TASKS.md` 檔頭的任務紀錄；可自行 commit。
**不要跑會寫檔的指令**：`node tools/config_tables.cjs --sync`、`--gen`、`--apply --write`、`node tools/apply_params.cjs --write`、`node tools/xlsx_to_csv.cjs` 都會改 `config/` 或 `js/data.js`，本任務一律不跑；只准用 dry-run。
**不要用 Excel 開 `config/Excel/*.xlsx` 並存檔。**

**優先級**：中高。吸血／吸魔掛在「敵人受傷」這條全遊戲最熱的路徑上，也是 Worker 面板投影與協議的一部分。

---

## 1. 這次改了什麼（驗證前先讀）

**需求**：吸血、吸魔由百分比轉為**定值**，轉換公式 **1% = 1**（舊吸血 50% → 吸血 50，每觸發 1 次回復 50 點生命）；並且**單獨計算，不再與生命／法力回復相關聯**。

**新公式**（`js/formula.js` §3）：

```
每次吸血 = 吸血值 × 吸血倍率     每次吸魔 = 吸魔值 × 吸魔倍率
吸血值 / 吸魔值 = st.lifesteal / st.manaSteal（裝備詞條 + 寶石黑曜石 的聚合，強化倍率與寶石效率照舊）
倍率 = skill2DrainFactor（大地守護第 3／4 階、戰神屠錄）；沒有這些技能時是 1
```

舊算法是「每秒生命回復 × 吸血%」，現在**完全不讀**每秒回復、最大生命、造成的傷害。觸發時機沒變：每對一名敵人造成一次傷害算一次（範圍技能對 N 隻 = N 次、持續傷害每跳、反震都算；MISS／無敵／零傷害／已死目標／預覽不觸發）；溢出不轉護盾。

| 模組 | 處理 |
|---|---|
| 裝備詞條 吸血／吸魔 | **已改**：名稱不再帶 `%`、不再是百分比；**數字沿用舊百分比**（base／成長／權重一個都沒動）；進位由一位小數改為**整數**（與生命恢復等定值詞條一致） |
| 寶石 黑曜石（吸血） | **已改**：名稱「吸血」不帶 `%`；數值沿用 |
| 神鑄特效 萬象汲取 | **已改**：每次傷害額外回復 `{v}` 點生命**與**法力（5% → 5），與吸血／吸魔值相加後套倍率 |
| 屬性面板「🧛 吸血」「🌊 吸魔」 | **已改**：顯示定值（一位小數以內、不帶 `%`），提示改為「單獨計算，與每秒回復、造成的傷害皆無關」 |
| Worker 面板投影／協議 | **已改**：協議 v40 → **v41**，`passivePanel` 移除 `hpDrain`／`mpDrain`／`hpDrainBase`／`mpDrainBase`；`lifesteal`／`manaSteal` 改為帶倍率的定值 |
| 大地守護 T3／T4、戰神屠錄 | **語意不變**：它們本來就是「額外乘算」，現在乘在定值上；說明文字沒改 |
| 傳奇【血霧】、暗影元素汲取、潛力【聖療逆轉】 | **刻意不改**：它們不是吸血屬性（血霧＝占最大生命%的技能治療；暗影汲取＝攻擊者當前生命×係數；聖療逆轉吃每秒回復） |
| 天賦、附魔 | 沒有吸血類節點，沒改 |
| 存檔 | 不需遷移（詞條存強度值 roll，數字沿用）；舊裝備的吸血／吸魔值會在讀取時取整 |

---

## 2. 驗證項目

驗證原則：**至少要有實際執行的數值驗證，不能只靠「畫面沒報錯」或 grep**。下面 A 是最重要的一項，請先做。

### A. 無畫面數值驗證（必做、先做）

把下面整支腳本存成**專案外**的檔案（例如 `C:\tmp\drain-verify.cjs`；不要放進 repo，也不要 commit），執行：

```bash
node C:\tmp\drain-verify.cjs D:\MyGame\Idle-RPG\antigravity
```

**預期輸出：六項全 PASS、最後印「全部通過」、退出碼 0。** 若第 1 項就 FAIL 且吸血值為 0，是腳本前置失敗，先回報。
（Claude 已確認：這支腳本在舊版 `0a644957` 上會紅 5 項，在新版全綠，所以它確實分得出新舊。）
括號內的數值依目前參數表而定，之後調參會變，**以 PASS／FAIL 為準，不要拿數字當驗收**。

```js
// 吸血／吸魔定值：無畫面數值驗證（只讀，不改任何專案檔）
const path = require('path');
const root = path.resolve(process.argv[2] || process.cwd());
process.chdir(root);
const { createEngine } = require(path.join(root, 'scripts/sim/engine'));

function fresh() {
  const c = createEngine({ seed: 11 }).boot(null).ctx;
  c.G.player.level = 500;
  const gear = (affixes, extra) => Object.assign(
    { id: 'g' + Math.random(), slot: 'chest', level: 100, rarity: 6, upgrade: 0, affixes, sockets: [], enchants: [] }, extra || {});
  return { c, gear };
}
// 讓玩家站在一隻打不死的敵人旁邊，只出一次普攻，量 HP／MP 的變化量（時間不前進＝沒有每秒回復混進來）
function oneHit(c) {
  c.markStatsDirty();            // 裝備是直接塞進去的，要讓屬性快取失效才會重算
  c.initFieldPlayer();
  c.gmArenaSpawn(1, 'elite', 1e9);
  const p = c.FIELD.player, m = c.FIELD.monsters[0];
  m.pos = { x: 10, y: 0 }; m._enterCd = 0;
  const st = c.getStats();
  p.hp = Math.max(1, st.hp * 0.1); p.mp = 0;
  const hp0 = p.hp, mp0 = p.mp;
  c.doPlayerAttack(p, m, 'mv-float', 0);
  return { st, dHp: p.hp - hp0, dMp: p.mp - mp0 };
}
const near = (a, b) => Math.abs(a - b) < 1e-6;
let bad = 0;
const check = (label, ok, detail) => { if (!ok) bad++; console.log((ok ? 'PASS ' : 'FAIL ') + label + '  ' + detail); };

// [1] 詞條：單次回復＝吸血／吸魔值本身
let base;
{
  const { c, gear } = fresh();
  c.G.equipment.chest = gear([{ key: 'lifesteal', roll: 500 }, { key: 'manaSteal', roll: 500 }]);
  const r = oneHit(c); base = r;
  const wantHp = c.affixValueFromStrength('lifesteal', 100, 6, 500), wantMp = c.affixValueFromStrength('manaSteal', 100, 6, 500);
  check('[1] 單次吸血＝吸血值、單次吸魔＝吸魔值', near(r.dHp, wantHp) && near(r.dMp, wantMp),
    `吸血值 ${r.st.lifesteal}／吸魔值 ${r.st.manaSteal} → +HP ${r.dHp}／+MP ${r.dMp}`);
}
if (!(base.dHp > 0 && base.dMp > 0)) { console.log('前置失敗：基準單次回復為 0，後面的比對會變成 0 對 0 的假通過，中止'); process.exit(2); }
// [2] 再疊一件超高「生命恢復／法力恢復」：單次回復必須與 [1] 完全相同（證明已與回復脫鉤）
{
  const { c, gear } = fresh();
  c.G.equipment.chest = gear([{ key: 'lifesteal', roll: 500 }, { key: 'manaSteal', roll: 500 }]);
  c.G.equipment.amulet = gear([{ key: 'hpRegen', roll: 1000 }, { key: 'mpRegen', roll: 1000 }], { slot: 'amulet', level: 500, rarity: 8 });
  const r = oneHit(c);
  check('[2] 每秒回復暴增後單次吸血／吸魔不變', near(r.dHp, base.dHp) && near(r.dMp, base.dMp),
    `每秒生命回復 ${Math.round(c.playerHpRegenPerSec(r.st))}／每秒法力恢復 ${Math.round(c.playerMpRegenPerSec(r.st))} → +HP ${r.dHp}／+MP ${r.dMp}（應為 ${base.dHp}／${base.dMp}）`);
}
// [3] 強化 +10 → 詞條 ×1.5
{
  const { c, gear } = fresh();
  c.G.equipment.chest = gear([{ key: 'lifesteal', roll: 500 }], { upgrade: 10 });
  const r = oneHit(c);
  check('[3] 強化+10：吸血值 ×1.5', near(r.dHp, base.dHp * 1.5), `+HP ${r.dHp}（應為 ${base.dHp * 1.5}）`);
}
// [4] 黑曜石 3 級
{
  const { c, gear } = fresh();
  c.G.equipment.chest = gear([], { sockets: [{ type: 'onyx', level: 3 }] });
  const r = oneHit(c);
  check('[4] 黑曜石 3 級＝寶石數值', near(r.dHp, c.gemStatValue('onyx', 3)), `gemStatValue ${c.gemStatValue('onyx', 3)} → +HP ${r.dHp}`);
}
// [5] 神鑄【萬象汲取】：生命與法力各額外 + omniDrain 值，與吸血／吸魔值相加
{
  const { c, gear } = fresh();
  c.G.equipment.chest = gear([{ key: 'lifesteal', roll: 500 }, { key: 'manaSteal', roll: 500 }],
    { godPassives: [{ key: 'omniDrain', roll: 500 }] });
  const r = oneHit(c);
  const omni = c.godPassiveValue({ key: 'omniDrain', roll: 500 }, null);
  check('[5] 萬象汲取：HP／MP 各再 +omniDrain', near(r.dHp, base.dHp + omni) && near(r.dMp, base.dMp + omni),
    `omniDrain ${omni} → +HP ${r.dHp}／+MP ${r.dMp}（應為 ${base.dHp + omni}／${base.dMp + omni}）`);
}
// [6] 大地守護 T3／T4 的吸血倍率仍乘在定值上（倍率讀表，不寫死）
{
  const { c, gear } = fresh();
  c.G.equipment.chest = gear([{ key: 'lifesteal', roll: 500 }, { key: 'manaSteal', roll: 500 }]);
  c.G.player.loadout = ['sg:earthguard'];
  c.G.player.skills2.levels.earthguard = [10, 10, 10, 10, 0, 0, 0];
  const r = oneHit(c);
  const fh = c.skill2DrainFactor('hp'), fm = c.skill2DrainFactor('mp');
  check('[6] 大地守護：單次＝定值 × skill2DrainFactor', near(r.dHp, base.dHp * fh) && near(r.dMp, base.dMp * fm),
    `倍率 hp×${fh}／mp×${fm} → +HP ${r.dHp}／+MP ${r.dMp}`);
}
console.log(bad ? `\n共 ${bad} 項失敗` : '\n全部通過');
process.exit(bad ? 1 : 0);
```

### B. 自動化測試與一致性檢查（必做）

```bash
node --test tests/drain-flat-value.test.cjs tests/damage-drain.test.cjs tests/attr-skill-rework-2026-07-30.test.cjs tests/war-god-roll.test.cjs tests/worker-protocol.test.cjs
node tools/build_check.cjs
node tools/config_tables.cjs --apply      # 只准 dry-run；必須回報「語意變更 0」
node tools/apply_params.cjs               # 只准 dry-run；必須回報「將變更 0、錨點問題 0」
```

- 第一行必須**全綠、0 失敗**。
- **既有紅燈（不算本次回歸）**：`tests/passive-stat-panel.test.cjs` 4 項、`tests/skill2-earth.test.cjs` 2 項在 `0a644957` 就是紅的（測試還釘著大地守護舊倍率）。
  共 6 項，名稱：「裝配大地守護：回復三倍、汲取兩倍…」「卸下及未學習都移除加成…」「序列化後無 G 的 UI…」「正式 Worker header 快照在裝卸後重新投影…」「生命／法力再生（T3／T4）…」「天地逆返只由第七階選用藍紋岩甲…」。
  **這 6 項以外的任何紅燈都要回報。** 全庫 `node --test "tests/*.test.cjs"`（務必帶引號，8～15 分鐘）基線本來就有約 90 項紅，**不要比數量，比失敗名稱**；有需要時用 `git archive 0a644957` 抽一份舊版到暫存目錄對照。

### C. 實機驗證（必做；在瀏覽器實際操作，不是讀程式碼）

開自己的測試服，用**全新存檔**（開發伺服器的 origin 本來就是拋棄式狀態）。GM 指令用 console 下：

```js
await WorkerBridge.send('gm.exec', { line: 'level 300' })   // 回 { ok, message }
```

指令表見 GM_command.md（`equip 品質 等級 [部位] [數量]`、`gem 寶石key 等級 數量`、`spawn`、`god`、`sglv`）。

| # | 項目 | 做法 | 預期 |
|---|---|---|---|
| C1 | 載入與協議 | 開頁後看 Console | 無錯誤、無「協議版本不符」；Console 執行 `WORKER_PROTOCOL_VERSION` 得 **41** |
| C2 | 面板空狀態 | 打開屬性面板「進攻屬性」，看 🧛 吸血、🌊 吸魔；滑鼠移上去 | 顯示 `0`（**不帶 %**）；提示含「單獨計算」，**不含**「汲取換算基準」「每秒…回復」的換算數字 |
| C3 | 裝備詞條顯示 | `equip epic 100 chest 40`、再各發 `ring`、`amulet`、`wrist` 各數十件；用背包**關鍵字篩選**搜「吸血」「吸魔」找出帶詞條的裝備 | 詞條列顯示「吸血 +N」「吸魔 +N」，**N 是整數、全程不出現 `%`**（詳情、比較提示 ↑↓、詞條可洗煉範圍、重洗介面都要看）。吸魔詞條最低要史詩品質、部位限 chest／wrist／ring／amulet |
| C4 | 穿上後面板 | 穿上其中一件，再穿第二件 | 面板吸血／吸魔＝**已穿裝備該詞條值的加總**（可用背包詳情逐件相加）；強化該裝備後該詞條 ×(1+5%×強化等級) 並反映到面板 |
| C5 | 黑曜石 | `gem onyx 3 1`，鑲到裝備上；也看寶石背包、合成、融合、商店、轉換各介面 | 寶石名稱「吸血 +N」**不帶 %**；鑲上後面板吸血值增加。⚠️ 寶石數值有一位小數（例：4.2），介面用 `fmt` 會捨去小數顯示成 4，面板則顯示一位小數——這是既有的定值寶石顯示行為，不算本次缺陷 |
| C6 | 萬象汲取 | `equip godforged 100 chest 30` 多發幾件，找帶【萬象汲取】的（每件隨機 2 條、共 12 種，要多試） | 說明寫「每次對敵人造成傷害時，額外回復 N 點生命與法力」，**不是**「造成傷害 N%」 |
| C7 | 戰鬥煙霧 | `spawn 12 small 1000`（千倍血木樁）穿上吸血＋吸魔裝備，野外戰鬥至少 60 秒；再切到**高塔**打 60 秒 | 無 Console 錯誤、無 NaN／Infinity 出現在 HP／MP／面板；HP／MP 不超過上限；滿血時護盾**不增加**（吸血溢出不轉護盾）。⚠️ 只看「沒報錯」不算通過，請同時記錄「穿／不穿吸魔裝備」各 10 秒的 MP 淨增量，穿上後應明顯較多 |
| C8 | 技能倍率 | `sglv earthguard max`，裝配【大地守護】（`await sendUiCommand('skill.equipLoadout', { id: 'sg:earthguard' }, { silentResultError: true })`） | 面板吸血／吸魔數值 ＝ 裝備加總 × 該技能第 3／4 階的 drain 倍率（倍率以技能說明為準，不要用記憶中的數字）；卸下後立刻回到裝備加總 |
| C9 | 舊存檔 | Console 執行 `await WorkerBridge.loadSave(await (await fetch('docs/fixtures/save_lategame.json')).json())`（Claude 實測過：回 `true`、頁面變 Lv.100、Console 無錯誤；先確認你用的是拋棄式 origin，不要在使用者的存檔 origin 上做）。該存檔**已穿的裝備沒有吸血／吸魔**，所以面板吸血／吸魔顯示 0 是正常的；要看詞條請到背包，用「關鍵字篩選」搜「吸血」「吸魔」（背包裡有約 20 件、多為 Lv.500、帶這兩種詞條的裝備） | 載入無錯誤；背包裡這些裝備的吸血／吸魔詞條數值皆為**有限整數、不帶 %**；穿上其中一件後面板出現對應數值、無 NaN |
| C10 | 重新整理後 | F5 重新整理，再看 C4 的面板 | 數值與重整前一致（詞條由 roll 當場算，不應飄動） |

C7 的 MP 對照量測沒有現成工具，請自行設計（例如讀 `#` 面板／血藍條的實體值或 `BattleRenderer._debug().player`），並在報告寫明方法。

### D. 回歸與邊界（A、B 已用腳本／測試覆蓋，實機只需抽查）

下列行為**已由 A／B 自動化覆蓋**，不必在實機逐項重做；若你在 C7 戰鬥中看到任何一項異常再回報：
MISS／無敵／零傷害／已死目標不吸取；DoT 依實際跳數吸取；反震計一次；玩家自己受持續傷害不吸取；預覽不吸取；溢出不轉護盾；吸魔不超過法力上限。

### E. 已知、不屬於本次缺陷（請勿回報成 bug）

- **平衡尚未調整**：單次回復量級改變——每秒回復基準 = 100 時新舊相等；基準更高（高等級生命端）新版較弱，基準遠小於 100（魔力端）新版明顯較強。**請只記錄觀察到的數字，不要自行建議改數值**（使用者會到 Excel 調）。
- `ui.js` 側欄硬編碼屬性區塊（`$id('s-hp')` 守衛內，index.html 不存在該元素）是既有死碼。
- `monte_carlo_sim.py` 是獨立的舊版模擬器，詞條表本來就與遊戲不同步。
- 傳奇【血霧】、暗影汲取不隨本次改動——見 §1 表格。
- 詞條進位改為整數是設計取捨，不是缺陷。

---

## 3. Commit 要求

- 只 commit 驗證報告（與選擇性的 `docs/AI_TASKS.md` 任務紀錄）。修改前依 AI_RULES 3.2 跑 `powershell -NoProfile -ExecutionPolicy Bypass -File .claude/check-conflicts.ps1 <檔案>`。
- 標題格式 `[Antigravity] test: 吸血吸魔定值化驗證報告`，繁體中文。
- **不要 push，不要合併或推送 `develop`。**
- commit 後工作區必須乾淨（腳本放專案外、暫存檔不留在 repo）。

## 4. 回報格式

依 AGENTS 第 10 節，並附一張結論表：

| 項目 | 結果（PASS／FAIL／N/A） | 證據（指令輸出摘要／截圖／數字） |
|---|---|---|
| A-1 … A-6 | | |
| B 測試／build／config／apply_params | | |
| C1 … C10 | | |

另外必須寫明：
1. 實際合併到的 commit（`git log -1`）與 `merge-base --is-ancestor` 的結果。
2. 驗證用的 port、以及你怎麼確認它服務的是自己的工作副本。
3. C7 的 MP 對照量測方法與數字（穿／不穿吸魔裝備）。
4. 任何與「§1 表格」不符的現象（含畫面上殘留的 `%`、NaN、舊提示文字）——附上位置與重現步驟。
5. 是否可以合併。
