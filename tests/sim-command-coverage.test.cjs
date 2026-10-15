/* 模擬器對遊戲指令的覆蓋哨兵。

   模擬器過期最常見的形態不是壞掉，而是「遊戲長出新系統、策略完全沒人理」：
   技能系統整個改版後，策略用到的技能指令是 0 條，模擬玩家全程只用普攻，
   而報表上只多一行「未測到指令」，沒人會看。

   做法：協議的每一條指令，要嘛被某份策略（或直譯器內部）送出過，
   要嘛在 scripts/sim/command_coverage.json 有明文類別與理由。
   遊戲新增指令而兩邊都沒登記，這支就會紅。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createEngine } = require('../scripts/sim/engine.js');

const ROOT = path.resolve(__dirname, '..');
const SIM = path.join(ROOT, 'scripts', 'sim');

const protocolSrc = fs.readFileSync(path.join(ROOT, 'js', 'worker', 'protocol.js'), 'utf8');
const COMMANDS = [...protocolSrc.matchAll(/^  '([a-z][\w.]*)':/gm)].map((m) => m[1]);
const COMMAND_SET = new Set(COMMANDS);

const coverage = JSON.parse(fs.readFileSync(path.join(SIM, 'command_coverage.json'), 'utf8'));
const classified = coverage['指令'];

/* 策略實際會送出的指令：JSON 裡任何一處的字串（含 retreatCmd、replaceWith 這類巢狀欄位，
   只看 rule.cmd 會漏掉它們），加上直譯器內部直接產生的（例如 planRunes 的 rune.compose）。 */
function referencedCommands() {
  const used = new Set();
  const walk = (v) => {
    if (typeof v === 'string') { if (COMMAND_SET.has(v)) used.add(v); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  for (const f of fs.readdirSync(SIM).filter((x) => /^policy\..*\.json$/.test(x))) {
    walk(JSON.parse(fs.readFileSync(path.join(SIM, f), 'utf8')));
  }
  const interp = fs.readFileSync(path.join(SIM, 'policy_interpreter.js'), 'utf8');
  for (const m of interp.matchAll(/'([a-z][\w.]*)'/g)) if (COMMAND_SET.has(m[1])) used.add(m[1]);
  return used;
}

test('協議的每一條指令：不是被策略用到，就是有明文理由', () => {
  const used = referencedCommands();
  const orphans = COMMANDS.filter((c) => !used.has(c) && !classified[c]);
  assert.deepEqual(orphans, [],
    '\n這些指令遊戲有、策略沒用、也沒在 scripts/sim/command_coverage.json 登記：\n  ' + orphans.join('\n  ') +
    '\n新增的遊戲系統要嘛補策略，要嘛登記為 never／redundant／noRule 並寫明理由——' +
    '\n沒人理的系統在模擬裡的貢獻是零，而且報表看不出來。');
});

test('登記表不得有過期項目', () => {
  const used = referencedCommands();
  const stale = Object.keys(classified).filter((c) => !COMMAND_SET.has(c));
  assert.deepEqual(stale, [], '登記了協議裡已不存在的指令（遊戲改名或刪除了）：' + stale.join(', '));

  const dup = Object.keys(classified).filter((c) => used.has(c) && classified[c]['類別'] !== 'disabled');
  assert.deepEqual(dup, [],
    '這些指令策略已經在用，卻還登記為「不用」——登記表與策略互相矛盾：' + dup.join(', '));
});

test('登記項目都有合法類別與理由', () => {
  const kinds = new Set(Object.keys(coverage['類別']));
  for (const [cmd, e] of Object.entries(classified)) {
    assert.ok(kinds.has(e['類別']), cmd + ' 的類別 ' + e['類別'] + ' 不合法');
    assert.ok(e['理由'] && e['理由'].length >= 4, cmd + ' 沒寫理由——沒有理由的登記只是把警告靜音');
  }
});

test('pending 只能是已排定的任務，做完必須移除', () => {
  /* 允許的 pending：技能系統（skill*、skill2*）與裝備組（player_strategy.md §7）。
     新增項目要改這裡並說明——pending 不能拿來暫時靜音其他系統。 */
  const ALLOWED = (c) => /^skill2?./.test(c) || c === 'player.switchEquipSet';
  const pending = Object.keys(classified).filter((c) => classified[c]['類別'] === 'pending');
  const bad = pending.filter((c) => !ALLOWED(c));
  assert.deepEqual(bad, [], 'pending 不能拿來暫時靜音其他系統：' + bad.join(', '));
});

test('disabled：對應功能重新開啟時，策略必須補上', () => {
  const ctx = createEngine({ seed: 1 }).ctx;
  const used = referencedCommands();
  for (const [cmd, e] of Object.entries(classified)) {
    if (e['類別'] !== 'disabled') continue;
    const flag = e['需要'];
    assert.ok(flag in ctx, cmd + ' 的開關 ' + flag + ' 在遊戲裡找不到（改名了？）');
    if (ctx[flag]) {
      assert.ok(used.has(cmd),
        flag + ' 已重新開啟，但沒有任何策略送出 ' + cmd + '——這個系統在模擬裡會整個空轉');
    }
  }
});
