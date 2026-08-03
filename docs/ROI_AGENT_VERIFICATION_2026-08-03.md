# 邊際效益導向決策改造獨立驗證

驗證日期：2026-08-03
驗證 commit：`c703483`（目前分支 `0927b4c`）
基準 commit：`d1c7c1e`
原始輸出根目錄：`D:\MyGame\Idle-RPG\verify_outputs`

## 結論摘要

| 項目 | 結論 | 實際結果 |
|---|---|---|
| T1 既有策略回歸 | 通過 | 6 策略 × 3 seed = 18/18 完整存檔雜湊相同 |
| T2 evaluator 唯讀／決定性 | 通過 | 80 次面板呼叫；存檔 SHA-256 相同；面板 JSON 相同；0 名稱碰撞 |
| T3 遊戲本體未被動到 | 通過 | `git diff --stat d1c7c1e..c703483 -- js/` 無輸出 |
| T4 新 seed A/B | 嚴格條件不通過 | 中位數全面改善，但 seed `20260903` 四項遊戲指標退步；最高關卡最小值未改善 |
| T5 效能 | 不通過 | ROI 中位縮時 165×／舊策略 296× = 55.7%，低於 70% |
| T6 瀏覽器交叉驗證 | 跳過 | 本環境沒有瀏覽器樣本收集器／`browser_rows.json`，未以靜態檢查冒充 |

因此：宣稱 A 成立；宣稱 C 只在整體中位數與多數 seed 上成立，不成立為「每場全面優於」。沒有確認到第三個「把局部限制寫成全體開關」的具體位置。

## T1 — 既有策略回歸

基準以 `git worktree add ..\verify_base d1c7c1e` 建立，兩邊各執行：

```text
node scripts/run_batch.js --hours=2 --seeds=4242,777,20260803 \
  --policy=scripts/sim/policy.default.json,scripts/sim/policy.light.json,
  scripts/sim/policy.moderate.json,scripts/sim/policy.heavy.json,
  scripts/sim/policy.extreme.json,scripts/sim/policy.lategame.json
```

`base` 輸出：`D:\MyGame\Idle-RPG\verify_outputs\t1_base`
`current` 輸出：`D:\MyGame\Idle-RPG\verify_outputs\t1_current`

下表是 current 的完整 `determinism.finalStateHash`；base 逐列完全相同。

| policy | seed | finalStateHash |
|---|---:|---|
| baseline-idle-v2 | 4242 | `28f0e31c7cd502e9dda3f19d72bede0f3e93788386e3306520bd53d8b19119bf` |
| baseline-idle-v2 | 777 | `f0fe33824749af69f9b1ebf8fe12563963e630b1592fd8d64d7b73db1b7c1978` |
| baseline-idle-v2 | 20260803 | `416415568236a243d9c024c4da2c6502d0c4922c00677748a6e6269f909c3518` |
| policy-light | 4242 | `db49fbac61044a8bfd5ad508ce44ea418c602535ef4630be8ce9a471e6d40da2` |
| policy-light | 777 | `b0627c748f3555d3dff66c0b10d69667414a333ec4e9f1db4bf1e480417dc4d3` |
| policy-light | 20260803 | `b077c89b40c21b09fca106814d48e44fb6cb6505f6b52e226a6e3e4098ad5d5c` |
| policy-moderate | 4242 | `a034617410dc388d77455cb8b23db87ee231abfded96f0ce5826f30f58972a1b` |
| policy-moderate | 777 | `9a2e0f45ea19241ae6261f2f0f30ef0e66a5eada323cc756e187b09d74aab95b` |
| policy-moderate | 20260803 | `baa416df617dc755f566d067d65ab135e112449e144046aa74f9c5e6dc49bf66` |
| policy-heavy | 4242 | `e8455ff9355143dc5d5defecbb49eb2da49e48d0a4bbe33710e980d63f4a9dec` |
| policy-heavy | 777 | `5749dab433e6f5d28ff50be731f8de1e5b3e7c3d3ddcb3566f31ece5952dca81` |
| policy-heavy | 20260803 | `37007e853fa615567576d58c28772c23175b0cf358e89f6f31e9bd48c8e5cf69` |
| policy-extreme | 4242 | `ff20246cab3dde76571f2510415e8ee133d9d2ff44fc9beb82dfc943a179255b` |
| policy-extreme | 777 | `6e59d646c392af204a3b794886746dd5876dacc5a41f390999003309aecc3496` |
| policy-extreme | 20260803 | `4abcc11436583453c5d8a6176b54183586475396a2c219ef0ed1862b7069ee76` |
| lategame-systems-v1 | 4242 | `c00672317c9616d54039405351b78c05180620dbe072c38a343f294326efa6f7` |
| lategame-systems-v1 | 777 | `60bdab25dd4e12b0a0050798d4fdd6b72ea022d7f55ece2413ee7e99db06b101` |
| lategame-systems-v1 | 20260803 | `c02853871d6105e9ad3b6606fc4b412fff1339276bedbf5009c607e1525573a0` |

## T2 — evaluator 獨立唯讀／決定性驗證

執行：

```text
node t2_readonly_verify.cjs
```

腳本：`D:\MyGame\Idle-RPG\verify_outputs\t2_readonly_verify.cjs`
輸出：`D:\MyGame\Idle-RPG\verify_outputs\t2_readonly_verify.output.json`

實際結果：seed 4242，40 次 × 30 秒；有 evaluator 的完整存檔與無 evaluator 的完整存檔均為：

```text
063c448e55bfe972765e7ad9907efe84a602e2716de91a0e0f1117d9c6481c60
```

兩次獨立面板序列的 JSON 相同。`evaluator.js` 的 23 個頂層宣告逐一列出並與 `js/worker/*.js` 的頂層遊戲宣告比對，碰撞數為 0。

獨立腳本原始碼如下：

```js
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', 'codex');
const { createEngine } = require(path.join(ROOT, 'scripts', 'sim', 'engine.js'));
const EVAL_CFG = {
  affixKeys: ['atkFlat', 'atkPct', 'critRate', 'critDmg', 'hpFlat', 'hpPct', 'hit'],
  slotUpgrades: { candidatesPerSlot: 2 }, probeEquippedAffixes: true,
  probeTopSlots: 3, refreshSec: 15
};
function sha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function run(withEval) {
  const engine = createEngine({ seed: 4242 }).boot(null);
  engine.setEvalParams(EVAL_CFG);
  const panels = [];
  for (let i = 0; i < 40; i++) {
    engine.stepSeconds(30);
    if (withEval) panels.push({ at: engine.gameTimeSec(), eval: engine.panel('eval'), evalCombat: engine.panel('evalCombat') });
  }
  return { save: engine.saveJson(), panels };
}
const withEval = run(true), withoutEval = run(false);
assert.equal(withEval.save, withoutEval.save);
const panelRunA = JSON.stringify(run(true).panels);
const panelRunB = JSON.stringify(run(true).panels);
assert.equal(panelRunA, panelRunB);
const evaluatorSource = fs.readFileSync(path.join(ROOT, 'scripts', 'sim', 'evaluator.js'), 'utf8');
const evaluatorNames = [...evaluatorSource.matchAll(/^(?:function|var|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);
const gameNames = new Set();
for (const file of fs.readdirSync(path.join(ROOT, 'js', 'worker'))) {
  if (!file.endsWith('.js')) continue;
  const source = fs.readFileSync(path.join(ROOT, 'js', 'worker', file), 'utf8');
  for (const m of source.matchAll(/^(?:function|var|const|let)\s+([A-Za-z_$][\w$]*)/gm)) gameNames.add(m[1]);
}
const collisions = evaluatorNames.filter((name, i, all) => all.indexOf(name) === i && gameNames.has(name));
assert.deepEqual(collisions, []);
console.log(JSON.stringify({ seed: 4242, steps: 40, evalCalls: 80,
  withEvalSha256: sha(withEval.save), withoutEvalSha256: sha(withoutEval.save),
  saveEqual: true, panelRunsEqual: true,
  evaluatorTopLevelDeclarations: evaluatorNames,
  gameGlobalDeclarationCollisions: collisions }, null, 2));
```

## T3 — `js/` 差異

實際執行 `git diff --stat d1c7c1e..c703483 -- js/`，無任何輸出。

## T4 — 新 seed A/B

seed 在執行前固定選為連號 `20260901`–`20260908`，沒有依結果重挑。執行：

```text
node scripts/run_batch.js --hours=20 \
  --seeds=20260901,20260902,20260903,20260904,20260905,20260906,20260907,20260908 \
  --policy=scripts/sim/policy.extreme.json,scripts/sim/policy.extreme.roi.json \
  --out=D:\MyGame\Idle-RPG\verify_outputs\sim_ab_verify
```

逐 seed 結果（`level`、`stage` 為最高值，`stop` 為最終停留關卡）：

| seed | old level/stage/stop/atk | ROI level/stage/stop/atk | old speedup× | ROI speedup× |
|---:|---|---|---:|---:|
| 20260901 | 54 / 70 / 25 / 500 | 154 / 150 / 135 / 42562 | 295 | 147 |
| 20260902 | 148 / 140 / 125 / 71165 | 268 / 183 / 171 / 75130 | 265 | 122 |
| 20260903 | 86 / 100 / 95 / 4653 | 57 / 50 / 50 / 477 | 257 | 172 |
| 20260904 | 56 / 50 / 41 / 302 | 145 / 149 / 121 / 31371 | 269 | 163 |
| 20260905 | 85 / 100 / 91 / 8370 | 156 / 150 / 150 / 47585 | 297 | 165 |
| 20260906 | 73 / 100 / 85 / 3781 | 109 / 109 / 92 / 14463 | 304 | 173 |
| 20260907 | 99 / 100 / 91 / 10016 | 102 / 124 / 123 / 15013 | 311 | 165 |
| 20260908 | 76 / 100 / 94 / 19557 | 120 / 147 / 147 / 48210 | 332 | 172 |

彙總 min / median / max：

| 指標 | 舊策略 | ROI 策略 |
|---|---:|---:|
| level | 54 / 80.5 / 148 | 57 / 132.5 / 268 |
| 最高 stage | 50 / 100 / 140 | 50 / 148 / 183 |
| 最終停留 stage | 25 / 91 / 125 | 50 / 129 / 171 |
| atk | 302 / 6511.5 / 71165 | 477 / 36966.5 / 75130 |

嚴格驗收未通過的原因是 seed `20260903` 四項遊戲指標都退步，且最高 stage 最小值仍為 50，沒有提升。該 seed 的逐 2 小時證據如下；`dust` 是碎片欄位：

| 小時 | old stage/level/atk/dust | ROI stage/level/atk/dust |
|---:|---|---|
| 0 | 2 / 2 / 40 / 0 | 2 / 2 / 40 / 0 |
| 2 | 25 / 23 / 298 / 0 | 32 / 22 / 282 / 0 |
| 4 | 25 / 30 / 392 / 0 | 39 / 30 / 374 / 0 |
| 6 | 42 / 38 / 588 / 0 | 45 / 36 / 410 / 0 |
| 8 | 41 / 44 / 705 / 0 | 40 / 40 / 429 / 1 |
| 10 | 41 / 49 / 648 / 0 | 50 / 44 / 452 / 2 |
| 12 | 90 / 54 / 674 / 21 | 47 / 47 / 466 / 6 |
| 14 | 85 / 70 / 849 / 121 | 50 / 50 / 510 / 10 |
| 16 | 85 / 77 / 699 / 191 | 50 / 52 / 460 / 11 |
| 18 | 85 / 82 / 346 / 257 | 46 / 55 / 471 / 13 |
| 20 | 95 / 86 / 4653 / 296 | 50 / 57 / 477 / 18 |

完整原始資料：`D:\MyGame\Idle-RPG\verify_outputs\sim_ab_verify\batch_summary.json`；退步 seed 的 `snapshots.csv` 位於其 old／ROI 子目錄。

## T5 — 效能與快取

T4 的 `performance.speedupX` 中位數：舊策略 `296×`，ROI `165×`，ROI／舊策略 `0.5574`（55.7%），低於要求的 70%，故不通過。

因為低於門檻，另用暫時載入包裝器收集代表性退步 seed `20260903` 的實際 `panels.eval.planAgeSec`：

```text
samples=11646
min=0
p50=5.00000000001819
p95=14.999999999781721
max=14.999999999999162
```

將浮點誤差歸併到最近的 5 秒後，分佈為 `0s: 3697`、`5s: 2963`、`10s: 2992`、`15s: 1994`。這表示快取確實命中，並非完全失效；效能問題是 ROI 評估本身的成本仍使縮時倍率降到 55.7%。原始輸出：`D:\MyGame\Idle-RPG\verify_outputs\t5_plan_age_verify.json`。

## T6 — 瀏覽器交叉驗證

跳過。`scripts/cross_check.js` 需要由真瀏覽器收集 `browser_rows.json` 後才能執行；本次執行環境沒有可用的瀏覽器樣本收集流程，因此沒有把靜態檢查當成交叉驗證。

## 完整回歸驗證

```text
npm.cmd test
```

結果：928 tests、928 pass、0 fail、0 skipped。

```text
node tools/build_check.cjs
```

結果：220 個檔案語法／編譯檢查全數通過，無空檔。

## 三個交付問題

1. 宣稱 A 成立：18/18 組完整存檔雜湊逐字串相同。
2. 宣稱 C 在新 seed 不成立為「全面優於」：8 組中 7 組主要遊戲指標改善，seed `20260903` 退步；中位數改善但屬於整體分佈改善，不是每場保證。
3. 沒有看到第三個已被證據確認的「局部限制寫成全體開關」。已知兩個坑仍是文件記載的舊問題；本次新增的具體問題是 `20260903` 的退步與 evaluator 效能，不足以在不修改程式的前提下判定第三個同形 bug。另觀察到 `panels.eval.equippedAffixes` 有 167 次失效路徑計數，應列為後續調查項目，但本次沒有把它誤判成第三個全體開關。
