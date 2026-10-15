/* 每一份策略實際跑一小段，策略引用的狀態路徑必須全部解析得到。

   策略指到不存在的面板欄位時不會報錯：條件永遠不成立、規則靜靜失效，
   報表上只多一行「失效路徑」，而且只有實際跑起來才看得到。
   這支測試實際跑每份策略，把那一行變成紅燈。
   （實際抓到過：批次替換路徑時 panels.gems.rune 是 panels.gems.runes 的前綴，
   後者被一起改壞，符文規則整場沒生效。） */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SIM = path.join(ROOT, 'scripts', 'sim');
const POLICIES = fs.readdirSync(SIM).filter((f) => /^policy\..*\.json$/.test(f));

function runOne(policyFile, outDir) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      '--max-semi-space-size=64',
      path.join(ROOT, 'scripts', 'run_sim.js'),
      '--hours=0.5', '--seed=1',
      '--policy=' + path.join('scripts', 'sim', policyFile),
      '--out=' + outDir
    ], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => resolve({ code, err }));
  });
}

test('每份策略實際跑 0.5 小時：退出正常、壞路徑為空、沒有不變式失敗', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-smoke-'));
  try {
    /* 平行跑：各自獨立行程，決定論不受影響。 */
    const results = await Promise.all(POLICIES.map(async (f) => {
      const out = path.join(base, f.replace(/\.json$/, ''));
      const r = await runOne(f, out);
      let summary = null;
      try { summary = JSON.parse(fs.readFileSync(path.join(out, 'run_summary.json'), 'utf8')); } catch (e) { /* 下面會報 */ }
      return { f, r, summary };
    }));

    for (const { f, r, summary } of results) {
      assert.equal(r.code, 0, f + ' 跑失敗：' + r.err.slice(0, 300));
      assert.ok(summary, f + ' 沒產出 run_summary.json');
      assert.deepEqual(Object.keys(summary.badStatePaths || {}), [],
        f + ' 有策略路徑解析不出值——那些規則整場靜靜失效：' + JSON.stringify(summary.badStatePaths));
      assert.deepEqual(summary.invariantFailures || [], [], f + ' 有不變式失敗');
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
