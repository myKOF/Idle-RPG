'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const { validate, same, decide } = require('../tools/param-patches.cjs');
const tool = path.resolve(__dirname, '../tools/param-patches.cjs');
const fixture = path.resolve(__dirname, 'fixtures/param-patches-excel.ps1');
const change = (extra = {}) => ({ workbook: 'Test.xlsx', sheet: 'Data', headerRow: 1,
  key: { ID: 'alpha', Tier: 1 }, column: 'Value', before: 10, after: 12, ...extra });
const patch = changes => ({ version: 1, agent: 'Codex', task: 'TEST', changes });
const record = (extra = {}) => ({ ...change(), agent: 'Codex', address: '$C$3', current: 10, ...extra });
function approve(records, selected) {
  const approval = { by: 'user', reason: '測試：使用者明確同意採用此值', current: records[0].current, selected,
    proposals: records.map(r => ({ agent: r.agent, task: r.task, before: r.before, after: r.after })) };
  return records.map(r => ({ ...r, approval }));
}
function run(args) { return spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8', windowsHide: true }); }
function ps(root, mode) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', fixture,
    '-Root', root, '-Mode', mode], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return r.stdout.trim();
}
function stage(root, changes) {
  const request = path.join(root, 'request.json');
  fs.writeFileSync(request, JSON.stringify(patch(changes)));
  const r = run(['--stage', request, root]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
}
function pending(root) { return fs.readdirSync(path.join(root, 'config/param-patches')).filter(n => n.endsWith('.json')); }
function hash(file) { return require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function removeFixture(root) {
  const resolved = path.resolve(root);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.match(path.basename(resolved), /^(param-patches-|param patches excel-)/);
  assert.equal(fs.lstatSync(resolved).isSymbolicLink(), false);
  fs.rmSync(resolved, { recursive: true, force: true });
}

test('request validation rejects paths, missing before, mutable keys and invalid values', () => {
  assert.equal(validate(patch([change()])).version, 1);
  for (const workbook of ['../a.xlsx', 'D:\\a.xlsx', 'a/b.xlsx', '~$Test.xlsx']) {
    assert.throws(() => validate(patch([change({ workbook })])));
  }
  const missing = change(); delete missing.before;
  for (const c of [missing, change({ after: [] }), change({ key: {} }), change({ column: 'ID' }),
    change({ headerRow: 0 }), change({ after: { formula: 'bad' } }), change({ key: { ID: null } })]) {
    assert.throws(() => validate(patch([c])));
  }
});
test('three-way merge preserves unrelated cells; only a receipt permits an automatic retry', () => {
  assert.equal(decide([record()]).actions.length, 1);
  assert.equal(decide([record({ current: 12 })]).conflicts.length, 1);
  assert.deepEqual(decide([record({ current: 12, recovered: true })]), { actions: [], conflicts: [] });
  assert.equal(decide([record({ current: 99 })]).conflicts.length, 1);
  assert.equal(decide([record(), record({ address: '$D$3', current: 'text', before: 'text', after: '=literal' })]).actions.length, 2);
  assert.equal(same(null, ''), true);
  assert.equal(same(0, ''), false);
  assert.equal(same(1, '1'), false);
  assert.equal(same({ formula: '=A1' }, '=A1'), false);
});
test('any same-cell overlap requires user approval, even identical Agent intentions', () => {
  assert.equal(decide([record(), record()]).conflicts.length, 1);
  for (const other of [record(), record({ after: 13 }), record({ before: 8 })]) {
    const result = decide([record(), other, record({ address: '$C$4' })]);
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.actions.length, 0);
  }
});
test('explicit approval chooses user or Agent values and expires when current/proposals change', () => {
  const group = [record({ current: 99 }), record({ current: 99, after: 13 })];
  assert.equal(decide(approve(group, 13)).actions[0].after, 13);
  assert.deepEqual(decide(approve(group, 99)), { actions: [], conflicts: [] });
  assert.equal(decide(approve(group, 88)).conflicts.length, 1);
  const approved = approve(group, 13);
  assert.equal(decide(approved.map(r => ({ ...r, current: 98 }))).conflicts.length, 1);
  assert.equal(decide([approved[0], { ...approved[1], after: 14 }]).conflicts.length, 1);
  assert.equal(decide([approved[0], group[1]]).conflicts.length, 1);
  // Receipt authenticates the selected output even when another proposal had a different after.
  assert.deepEqual(decide(approved.map(r => ({ ...r, current: 13, recovered: true }))), { actions: [], conflicts: [] });
});
test('staging needs no Excel and no changes to the source; each request survives independently', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'param-patches-'));
  try {
    stage(root, [change()]); stage(root, [change({ after: 13 })]);
    assert.equal(pending(root).length, 2);
    assert.equal(fs.existsSync(path.join(root, 'config/Excel')), false);
  } finally { removeFixture(root); }
});
test('BAT merges before exporting or applying configuration, and stops on failure', () => {
  const bat = fs.readFileSync(path.resolve(__dirname, '../套用參數.bat'), 'utf8');
  const merge = bat.indexOf('node tools/param-patches.cjs --merge');
  assert.ok(merge >= 0 && merge < bat.indexOf('node tools/config_tables.cjs --sync'));
  assert.match(bat.slice(merge), /^node tools\/param-patches\.cjs --merge\r?\nif errorlevel 1 goto patchfail/);
  assert.match(bat, /:patchfail[\s\S]*?goto end/);
});
test('native Excel: keyed merge, formatting, conflicts, locked source and retry', { skip: process.platform !== 'win32', timeout: 300000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'param patches excel-'));
  const file = path.join(root, 'config/Excel/Test.xlsx');
  let holder;
  try {
    ps(root, 'init');
    const baseline = JSON.parse(ps(root, 'inspect'));
    stage(root, [change(), change({ column: 'Text', before: 'original', after: '=literal text' })]);
    const isolatedTools = path.join(root, 'tools'); fs.mkdirSync(isolatedTools);
    fs.copyFileSync(tool, path.join(isolatedTools, 'param-patches.cjs'));
    fs.copyFileSync(path.resolve(__dirname, '../tools/merge-param-patches.ps1'), path.join(isolatedTools, 'merge-param-patches.ps1'));
    fs.copyFileSync(path.resolve(__dirname, '../套用參數.bat'), path.join(root, '套用參數.bat'));
    fs.writeFileSync(path.join(isolatedTools, 'config_tables.cjs'), "require('fs').writeFileSync('unexpected-export', 'called');");
    // A source held by Excel/another writer blocks the complete batch.
    const beforeLock = hash(file);
    for (const mode of ['lock', 'open']) {
      holder = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', fixture,
        '-Root', root, '-Mode', mode], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      await new Promise((resolve, reject) => {
        let out = '';
        holder.stdout.on('data', b => { out += b; if (out.includes('LOCKED')) resolve(); });
        holder.on('error', reject);
        holder.on('exit', code => { if (!out.includes('LOCKED')) reject(Error('lock helper exited ' + code)); });
      });
      const result = run(['--merge', root]);
      assert.notEqual(result.status, 0);
      if (mode === 'open') assert.match(result.stdout, /請先儲存並關閉 Excel/);
      assert.equal(pending(root).length, 1);
      if (mode === 'open') {
        const bat = spawnSync('cmd.exe', ['/d', '/c', 'call', '套用參數.bat'],
          { cwd: root, input: '\r\n', encoding: 'utf8', windowsHide: true, timeout: 30000 });
        assert.match(bat.stdout, /\[合併未完成\]/, bat.stdout + bat.stderr);
        assert.equal(fs.existsSync(path.join(root, 'unexpected-export')), false);
      }
      const closed = new Promise(resolve => holder.once('exit', resolve));
      holder.stdin.end('\n'); await closed; holder = null;
      assert.equal(hash(file), beforeLock);
    }
    // A COM snapshot finds alpha on row 3, not the first data row (beta).
    let result = run(['--merge', root]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const after = JSON.parse(ps(root, 'inspect'));
    assert.equal(after.alpha, 12); assert.equal(after.beta, 20);
    assert.equal(after.text, '=literal text'); assert.equal(after.textFormula, false);
    assert.equal(after.calculated, 24);
    for (const key of ['format', 'color', 'note', 'validation', 'rowHeight', 'columnWidth', 'wrap', 'filter', 'hidden', 'sheetCount', 'formula', 'saved', 'repair']) {
      assert.deepEqual(after[key], baseline[key], key + ' changed');
    }
    assert.equal(after.saved, true); assert.equal(after.repair, false);
    assert.equal(pending(root).length, 0);
    // Restore the exact consumed request to simulate an interruption before moving it.
    const queue = path.join(root, 'config/param-patches');
    const archive = path.join(queue, 'archive');
    const completed = fs.readdirSync(archive).map(n => path.join(archive, n))
      .find(dir => fs.existsSync(path.join(dir, 'commit-started.json')));
    const consumedName = fs.readdirSync(completed).find(n => /^[a-f0-9-]+\.json$/.test(n));
    fs.copyFileSync(path.join(completed, consumedName), path.join(queue, consumedName));
    const appliedHash = hash(file);
    result = run(['--merge', root]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(hash(file), appliedHash); assert.equal(pending(root).length, 0);
    // Two independent requests targeting the same cell stop even with identical after values.
    stage(root, [change({ before: 12, after: 14 })]); stage(root, [change({ before: 12, after: 14 })]);
    result = run(['--merge', root]);
    assert.notEqual(result.status, 0); assert.equal(hash(file), appliedHash); assert.equal(pending(root).length, 2);
    // This test's user grants a recorded approval; both requests must carry it.
    const overlapRecords = [record({ before: 12, after: 14, current: 12, task: 'TEST' }), record({ before: 12, after: 14, current: 12, task: 'TEST' })];
    const approved = approve(overlapRecords, 14);
    pending(root).forEach((n, i) => {
      const p = path.join(queue, n), request = JSON.parse(fs.readFileSync(p, 'utf8'));
      request.changes[0].approval = approved[i].approval;
      fs.writeFileSync(p, JSON.stringify(request));
    });
    result = run(['--merge', root]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(ps(root, 'inspect')).alpha, 14); assert.equal(pending(root).length, 0);
    // User saves a conflicting value; neither original nor queue is consumed.
    ps(root, 'edit'); stage(root, [change(), change({ key: { ID: 'beta', Tier: 1 }, before: 20, after: 25 })]);
    stage(root, [change({ workbook: 'Second.xlsx' })]);
    const secondFile = path.join(root, 'config/Excel/Second.xlsx'), secondHash = hash(secondFile);
    const conflictHash = hash(file);
    result = run(['--merge', root]);
    assert.notEqual(result.status, 0); assert.match(result.stdout, /\[衝突\]/);
    assert.equal(hash(file), conflictHash); assert.equal(hash(secondFile), secondHash); assert.equal(pending(root).length, 2);
    // User chooses to keep Excel's current value; independent cells still merge.
    for (const n of pending(root)) {
      const p = path.join(queue, n), request = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (request.changes[0].workbook !== 'Test.xlsx') continue;
      request.changes[0].approval = approve([record({ current: 99, task: 'TEST' })], 99)[0].approval;
      fs.writeFileSync(p, JSON.stringify(request));
    }
    result = run(['--merge', root]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const chosen = JSON.parse(ps(root, 'inspect'));
    assert.equal(chosen.alpha, 99); assert.equal(chosen.beta, 25);
    assert.notEqual(hash(secondFile), secondHash); assert.equal(pending(root).length, 0);
    stage(root, [change()]);
    ps(root, 'duplicate');
    const duplicateHash = hash(file);
    result = run(['--merge', root]);
    assert.notEqual(result.status, 0); assert.match(result.stdout, /主鍵必須只命中一列/);
    assert.equal(hash(file), duplicateHash); assert.equal(pending(root).length, 1);
  } finally {
    if (holder && holder.exitCode === null) {
      const closed = new Promise(resolve => holder.once('exit', resolve));
      holder.stdin.end('\n'); await closed;
    }
    removeFixture(root);
  }
});
