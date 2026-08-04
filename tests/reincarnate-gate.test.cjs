/* 轉生閘門。

   背景：實測 100 小時 × 5 個 seed，有 4 個停在 Lv.1000／0 轉。策略裡根本沒有
   player.reincarnate 這條規則，而等級一到上限之後每一點經驗都會被丟掉
   （js/player.js settlePlayerXp 的 `if (p.level >= MAX_LEVEL) p.xp = 0`）。

   這裡釘住四件事：
     1. canReincarnateAt 與 player.js reincarnate() 的真正閘門必須同進同出。
        兩者讀同一組參數表常數，卻寫在不同檔案裡，會漂。
     2. talents 面板要把答案投影出去——AI 靠它決定何時轉生。
     3. 「不必等」這個決策的前提：到得了可轉生等級時，經驗確實已經在浪費。
     4. 策略真的有那條規則，而且門檻不是自己抄的數字。

   全程不在測試裡抄任何參數表的值（可轉生等級、轉生次數上限），
   一律從遊戲的行為反推——抄一份進來的話，使用者改 Excel 之後
   測試會跟著錯誤的期望值一起綠燈。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { createEngine } = require(path.join(ROOT, 'scripts/sim/engine.js'));

function boot() {
  return createEngine({ seed: 20260805 }).boot(null);
}

/* 可轉生等級：把等級一路往上推，第一個讓面板翻 true 的就是門檻。 */
function findReincLevel(e) {
  const G = e.state();
  const keep = G.player.reincarnations;
  G.player.reincarnations = 0;
  for (let lv = 1; lv <= 20000; lv++) {
    G.player.level = lv;
    if (e.panel('talents').canReincarnate) { G.player.reincarnations = keep; return lv; }
  }
  G.player.reincarnations = keep;
  return null;
}

test('canReincarnateAt 與 reincarnate() 的真正閘門一致', () => {
  const e = boot();
  const G = e.state();
  const gate = findReincLevel(e);
  assert.ok(gate, '應該找得到可轉生等級');

  /* 掃過門檻附近與次數上限附近。上限值一樣不寫死：往上掃到某個轉生數會開始
     全部失敗，那就是上限，交給下面的 sawTrue/sawFalse 確認兩側都掃到了。 */
  const levels = [1, gate - 1, gate, gate + 1, gate * 5];
  const reincs = [0, 1, 9, 19, 20, 21, 50];

  let sawTrue = false, sawFalse = false;
  for (const lv of levels) {
    for (const rc of reincs) {
      G.player.level = lv;
      G.player.reincarnations = rc;
      G.player.xp = 0;
      const said = !!e.panel('talents').canReincarnate;

      const res = e.cmd('player.reincarnate');
      /* reincarnate() 成功回 null、失敗回一句中文訊息——兩種都是 ok:true。 */
      assert.equal(res.ok, true, `指令本身不該爆炸：${JSON.stringify(res)}`);
      const succeeded = res.result === null;

      assert.equal(succeeded, said,
        `Lv.${lv} / ${rc} 轉：面板說 ${said}，實際 ${succeeded}（${JSON.stringify(res.result)}）`);

      if (succeeded) {
        assert.equal(G.player.reincarnations, rc + 1, '成功時轉生次數必須 +1');
        assert.equal(G.player.level, 1, '成功時等級必須歸 1');
        sawTrue = true;
      } else {
        assert.equal(G.player.reincarnations, rc, '失敗時不得改動狀態');
        assert.equal(G.player.level, lv, '失敗時不得改動狀態');
        sawFalse = true;
      }
    }
  }
  /* 掃描範圍必須同時涵蓋兩種結果，否則這支測試可能只是在比 false === false。 */
  assert.ok(sawTrue, '掃描範圍要涵蓋得到「可以轉生」的情形');
  assert.ok(sawFalse, '掃描範圍要涵蓋得到「不能轉生」的情形');
});

test('talents 面板投影 canReincarnate（AI 的判斷依據）', () => {
  const e = boot();
  const p0 = e.panel('talents');
  assert.equal(typeof p0.canReincarnate, 'boolean', 'talents 面板必須有 canReincarnate 布林欄位');
  assert.equal(p0.canReincarnate, false, '新角色不該可以轉生');
  assert.ok(findReincLevel(e) > 1, '等級拉高之後 canReincarnate 必須翻成 true');
});

test('可轉生等級上經驗已經在浪費——這是「不必等」的前提', () => {
  /* 立刻轉生之所以沒有機會成本，是因為等級到上限之後經驗直接歸零。
     哪天可轉生等級被調到低於等級上限（例如 800 對 1000），這條前提就不成立、
     策略要重新評估要不要多留一會——所以讓這支測試在那時候紅。 */
  const e = boot();
  const G = e.state();
  const gate = findReincLevel(e);
  G.player.reincarnations = 0;
  G.player.level = gate;
  G.player.xp = 0;

  const res = e.cmd('gm.exec', { line: 'xp 1000000000000' });
  assert.equal(res.ok, true, 'GM 加經驗指令要送得出去');
  assert.equal(G.player.level, gate, '已在上限，等級不該再動');
  assert.equal(G.player.xp, 0, '可轉生等級上灌進去的經驗必須是被丟掉的');
});

test('策略有轉生規則，而且門檻讀面板不是自己抄的數字', () => {
  const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/sim/policy.extreme.roi.json'), 'utf8'));
  const rule = policy.rules.find((r) => r.cmd === 'player.reincarnate');
  assert.ok(rule, 'policy.extreme.roi.json 必須有一條送 player.reincarnate 的規則');
  assert.ok(policy.needPanels.includes('talents'), '規則讀 talents 面板，needPanels 就要宣告');

  const conds = JSON.stringify(rule.if || []);
  assert.match(conds, /panels\.talents\.canReincarnate/,
    '轉生條件必須讀遊戲投影的 canReincarnate');
  /* 可轉生等級是參數表的值。條件裡出現自己比對等級的寫法，
     在使用者改 Excel 之後就會靜靜地失效。 */
  assert.doesNotMatch(conds, /\blevel\b/,
    '不得改用自己比對等級的條件（門檻是參數表的值，會被改）');
});

test('ui.js 的轉生按鈕與 AI 共用同一支判斷', () => {
  /* 主執行緒沒有 G，它讀的是 header 面板快照；共用只能靠純函式。
     這裡防的是有人把條件重新內聯回 ui.js，讓兩邊各走各的。 */
  const ui = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8');
  assert.match(ui, /var canReincarnate = canReincarnateAt\(/,
    'ui.js 應呼叫 canReincarnateAt，而不是自己比 REINCARNATION_LEVEL');

  const formula = fs.readFileSync(path.join(ROOT, 'js/formula.js'), 'utf8');
  assert.match(formula, /function canReincarnateAt\(level, reincarnations\)/,
    'canReincarnateAt 要收參數而不是讀 G——ui.js 那端沒有 G');
});
