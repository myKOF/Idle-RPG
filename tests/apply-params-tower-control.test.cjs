'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

function fixture(t, rows) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'params-tower-control-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(tmp, 'tools'));
  fs.mkdirSync(path.join(tmp, 'js'));
  fs.cpSync(path.join(root, 'config/CSV'), path.join(tmp, 'config/CSV'), { recursive: true });
  for (const name of ['data', 'formula', 'combat', 'item', 'player', 'save', 'battle-renderer']) {
    fs.copyFileSync(path.join(root, 'js', name + '.js'), path.join(tmp, 'js', name + '.js'));
  }
  fs.copyFileSync(path.join(root, 'tools/apply_params.cjs'), path.join(tmp, 'tools/apply_params.cjs'));
  const csv = path.join(tmp, 'config/CSV/game_parameters.csv');
  const source = fs.readFileSync(csv, 'utf8').split(/\r?\n/).filter(line =>
    !/^\d+,[^,]*,4-高塔BOSS,(?:控制抵抗|攻速 \/ 控制抵抗),/.test(line));
  source.push(...rows.map(([name, ...values], i) => [9000 + i, 0, '4-高塔BOSS', name, '', '', ...values].join(',')));
  fs.writeFileSync(csv, source.join('\n'));
  return {
    tmp,
    run: (...args) => spawnSync(process.execPath, ['tools/apply_params.cjs', ...args], {
      cwd: tmp, encoding: 'utf8', env: { ...process.env, PARAMS_CSV: csv }
    }),
    data: () => fs.readFileSync(path.join(tmp, 'js/data.js'), 'utf8')
  };
}

function towers(source) {
  const context = vm.createContext({});
  for (const name of ['TOWER_BOSS_TRIAL', 'TOWER_BOSS_HELL', 'TOWER_BOSS_PURGATORY']) {
    const declaration = new RegExp('var ' + name + ' = \\{[\\s\\S]*?\\n\\};').exec(source);
    assert.ok(declaration, name);
    vm.runInContext(declaration[0], context);
  }
  return ['TOWER_BOSS_TRIAL', 'TOWER_BOSS_HELL', 'TOWER_BOSS_PURGATORY'].map(name => context[name]);
}

for (const legacy of [false, true]) {
  test((legacy ? '舊版交錯列' : '新版獨立列') + '正確套用三塔控制抵抗且不覆蓋NPC攻速', t => {
    const f = fixture(t, legacy
      ? [['攻速 / 控制抵抗', 91, 61, 92, 72, 93, 83]]
      : [['控制抵抗', 61, 72, 83]]);
    const bossList = source => /var BOSS_LIST = \[[\s\S]*?\n\];/.exec(source)[0];
    const before = bossList(f.data());
    assert.match(before, /atkSpeed:/, 'fixture 必須包含實際 NPC 攻速');
    const result = f.run('--write');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(result.stdout.includes('[舊版參數表相容]'), legacy);
    const after = towers(f.data());
    assert.deepEqual(after.map(x => x.ctrlRes), [61, 72, 83]);
    assert.equal(bossList(f.data()), before, '不得覆寫 NPC 的 BOSS_LIST／攻速');
    after.forEach(x => assert.equal(Object.hasOwn(x, 'aspd'), false));
    const second = f.run('--write');
    assert.equal(second.status, 0, second.stdout + second.stderr);
    assert.match(second.stdout, /將變更 0、錨點問題 0/);
    assert.match(f.run('--check-anchors').stdout, /所有錨點仍剛好命中一次/);
  });
}

test('兩列並存時新版優先，不受舊版值影響', t => {
  const f = fixture(t, [['控制抵抗', 11, 22, 33], ['攻速 / 控制抵抗', 91, 61, 92, 72, 93, 83]]);
  const result = f.run('--write');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(towers(f.data()).map(x => x.ctrlRes), [11, 22, 33]);
  assert.doesNotMatch(result.stdout, /舊版參數表相容/);
});

for (const rows of [[], [['控制抵抗', 11, '', 33], ['攻速 / 控制抵抗', 91, 61, 92, 72, 93, 83]], [['攻速 / 控制抵抗', 91, 61, 92, '', 93, 83]]]) {
  test('缺列或缺控制抵抗值應中止，不能回退掩蓋錯誤：' + JSON.stringify(rows), t => {
    const f = fixture(t, rows);
    const before = f.data();
    const result = f.run('--write');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CSV 缺少(?:列|參數)：4-高塔BOSS \/ (?:控制抵抗|攻速 \/ 控制抵抗)/);
    assert.equal(f.data(), before);
  });
}
