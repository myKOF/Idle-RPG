const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const protocol = require(path.join(root, 'js/worker/protocol.js'));

const VALID_ARG_TYPES = new Set([
  'int', 'num', 'bool', 'str', 'id', 'ids', 'ref', 'slots', 'obj', 'any'
]);
const EXPECTED_PANEL_KEYS = [
  'header', 'battle', 'equip', 'inv', 'factory', 'forge',
  'newforge', 'tower', 'gems', 'skills', 'talents'
];
const EXPECTED_COMMAND_COUNTS = {
  stage: 4,
  combat: 2,
  item: 9,
  gem: 12,
  player: 6,
  skill: 9,
  talent: 8,
  tower: 5,
  forge: 10,
  newforge: 9,
  factory: 2,
  settings: 1,
  save: 3,
  gm: 1
};
const SIMULATION_FILES = [
  'util.js', 'data.js', 'formula.js', 'stats.js', 'item.js', 'skills.js',
  'talents.js', 'player.js', 'special_rules.js', 'combat.js', 'legendary.js',
  'potential.js', 'tower.js', 'factory.js', 'newforge.js', 'forge.js', 'save.js'
];

function baseType(typeSpec) {
  return typeSpec.endsWith('?') ? typeSpec.slice(0, -1) : typeSpec;
}

function validValue(type, limit) {
  if (limit && limit.enum) return limit.enum[0];

  const value = {
    int: 1,
    num: 1.5,
    bool: true,
    str: 'value',
    id: 'id-1',
    ids: ['id-1', 'id-2'],
    ref: { kind: 'plain', type: 'red', lv: 1 },
    slots: [{ type: 'red', lv: 1, n: 1 }],
    obj: { key: 'value' },
    any: { structured: true }
  }[type];

  if (!limit || (type !== 'int' && type !== 'num')) return value;
  if (limit.min !== undefined && value < limit.min) return limit.min;
  if (limit.max !== undefined && value > limit.max) return limit.max;
  return value;
}

function invalidValue(type) {
  return {
    int: 1.5,
    num: Infinity,
    bool: 1,
    str: 1,
    id: '',
    ids: ['id-1', ''],
    ref: { kind: 'plain', type: 'red', lv: 1.5 },
    slots: [],
    obj: [],
    any: undefined
  }[type];
}

function validArgs(spec) {
  const args = {};
  for (const [name, typeSpec] of Object.entries(spec.args)) {
    if (!typeSpec.endsWith('?')) {
      args[name] = validValue(baseType(typeSpec), spec.limit && spec.limit[name]);
    }
  }
  return args;
}

test('凍結的 Worker 指令表有 81 條且分類數量固定', () => {
  assert.equal(protocol.WORKER_PROTOCOL_VERSION, 3);
  const names = Object.keys(protocol.COMMANDS);
  assert.equal(names.length, 81);

  const counts = {};
  for (const name of names) {
    const group = name.split('.')[0];
    counts[group] = (counts[group] || 0) + 1;
  }
  assert.deepEqual(counts, EXPECTED_COMMAND_COUNTS);
});

test('所有指令名稱、fn、args、resolve、limit 與 dirty metadata 格式合法', () => {
  const panelKeys = new Set(protocol.PANEL_KEYS);

  for (const [name, spec] of Object.entries(protocol.COMMANDS)) {
    assert.match(name, /^[a-z][a-z0-9]*\.[a-z][A-Za-z0-9]*$/, `非法指令名稱：${name}`);
    assert.ok(spec && typeof spec === 'object' && !Array.isArray(spec), `${name} spec 必須是物件`);
    assert.ok(spec.fn === null || (typeof spec.fn === 'string' && spec.fn.length > 0), `${name}.fn 非法`);
    assert.ok(spec.args && typeof spec.args === 'object' && !Array.isArray(spec.args), `${name}.args 非法`);
    assert.ok(Array.isArray(spec.dirty), `${name}.dirty 必須是陣列`);

    for (const [argName, typeSpec] of Object.entries(spec.args)) {
      assert.match(argName, /^[A-Za-z_$][A-Za-z0-9_$]*$/, `${name} 有非法參數名`);
      assert.equal(typeof typeSpec, 'string', `${name}.${argName} 型別必須是字串`);
      assert.ok(VALID_ARG_TYPES.has(baseType(typeSpec)), `${name}.${argName} 使用未知型別 ${typeSpec}`);
      assert.ok(!typeSpec.includes('?') || typeSpec.endsWith('?'), `${name}.${argName} 的 ? 只能放在結尾`);
    }

    if (spec.resolve !== undefined) {
      assert.ok(Array.isArray(spec.resolve), `${name}.resolve 必須是陣列`);
      assert.equal(new Set(spec.resolve).size, spec.resolve.length, `${name}.resolve 不得重複`);
      for (const argName of spec.resolve) {
        assert.equal(typeof argName, 'string', `${name}.resolve 的鍵必須是字串`);
        assert.ok(Object.hasOwn(spec.args, argName), `${name}.resolve.${argName} 必須存在於 args`);
      }
    }

    if (spec.limit !== undefined) {
      assert.ok(
        spec.limit && typeof spec.limit === 'object' && !Array.isArray(spec.limit),
        `${name}.limit 必須是物件`
      );
      for (const [argName, limits] of Object.entries(spec.limit)) {
        assert.ok(Object.hasOwn(spec.args, argName), `${name}.limit.${argName} 必須存在於 args`);
        assert.ok(
          limits && typeof limits === 'object' && !Array.isArray(limits),
          `${name}.limit.${argName} 必須是物件`
        );
        assert.ok(Object.keys(limits).length > 0, `${name}.limit.${argName} 不得為空`);
        for (const key of Object.keys(limits)) {
          assert.ok(['enum', 'min', 'max'].includes(key), `${name}.limit.${argName}.${key} 不合法`);
        }
        if (limits.enum !== undefined) {
          assert.ok(
            Array.isArray(limits.enum) && limits.enum.length > 0,
            `${name}.limit.${argName}.enum 必須是非空陣列`
          );
          assert.equal(
            new Set(limits.enum).size,
            limits.enum.length,
            `${name}.limit.${argName}.enum 不得重複`
          );
        }
        if (limits.min !== undefined) {
          assert.equal(typeof limits.min, 'number', `${name}.limit.${argName}.min 必須是數字`);
          assert.ok(Number.isFinite(limits.min), `${name}.limit.${argName}.min 必須有限`);
        }
        if (limits.max !== undefined) {
          assert.equal(typeof limits.max, 'number', `${name}.limit.${argName}.max 必須是數字`);
          assert.ok(Number.isFinite(limits.max), `${name}.limit.${argName}.max 必須有限`);
        }
        if (limits.min !== undefined && limits.max !== undefined) {
          assert.ok(limits.min <= limits.max, `${name}.limit.${argName} 的 min 不得大於 max`);
        }
      }
    }

    assert.equal(new Set(spec.dirty).size, spec.dirty.length, `${name}.dirty 不得重複`);
    for (const panel of spec.dirty) {
      assert.ok(panelKeys.has(panel), `${name}.dirty 含 PANEL_KEYS 以外的鍵 ${panel}`);
    }
  }
});

test('fn 非 null 的指令函式存在於模擬層原始碼', () => {
  const source = SIMULATION_FILES
    .map((file) => fs.readFileSync(path.join(root, 'js', file), 'utf8'))
    .join('\n');

  for (const [name, spec] of Object.entries(protocol.COMMANDS)) {
    if (spec.fn === null) continue;
    const escaped = spec.fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const declarations = [
      new RegExp(`function\\s+${escaped}\\s*\\(`),
      new RegExp(`(?:var|let|const)\\s+${escaped}\\s*=`),
      new RegExp(`(?:^|[^A-Za-z0-9_$])${escaped}\\s*=\\s*function\\s*\\(`)
    ];
    assert.ok(
      declarations.some((pattern) => pattern.test(source)),
      `${name}.fn 指向不存在的模擬層函式 ${spec.fn}`
    );
  }
});

test('一般寶石指令不使用不存在的 gemId 實例參數', () => {
  for (const [name, spec] of Object.entries(protocol.COMMANDS)) {
    if (!name.startsWith('gem.')) continue;
    assert.equal(Object.hasOwn(spec.args, 'gemId'), false, `${name} 不得使用 gemId`);
  }
});

test('validateCommand 接受合法參數與省略 optional 參數', () => {
  for (const [name, spec] of Object.entries(protocol.COMMANDS)) {
    assert.equal(protocol.validateCommand(name, validArgs(spec)), null, name);
  }
});

test('validateCommand 拒絕未知指令與缺少 required 參數', () => {
  assert.equal(protocol.validateCommand('missing.command', {}), 'unknown command: missing.command');
  assert.equal(
    protocol.validateCommand('combat.togglePaused', { extra: true }),
    'unexpected arg: combat.togglePaused.extra'
  );

  for (const [name, spec] of Object.entries(protocol.COMMANDS)) {
    const required = Object.entries(spec.args).find(([, typeSpec]) => !typeSpec.endsWith('?'));
    if (!required) continue;
    const [argName] = required;
    const args = validArgs(spec);
    delete args[argName];
    assert.equal(
      protocol.validateCommand(name, args),
      `missing arg: ${name}.${argName}`,
      `${name} 應拒絕缺少 ${argName}`
    );
  }
});

test('validateCommand 拒絕 required 與 optional 參數的錯誤型別', () => {
  for (const [name, spec] of Object.entries(protocol.COMMANDS)) {
    for (const [argName, typeSpec] of Object.entries(spec.args)) {
      const type = baseType(typeSpec);
      if (type === 'any') continue;
      const args = validArgs(spec);
      args[argName] = invalidValue(type);
      assert.equal(
        protocol.validateCommand(name, args),
        `bad arg type: ${name}.${argName} expected ${type}`,
        `${name} 應拒絕 ${argName}:${typeSpec} 的錯誤型別`
      );
    }
  }
});

test('PANEL_KEYS 與模擬層實際 UI.dirty 鍵完全一致', () => {
  const actual = new Set();
  const accessPattern = /UI\.dirty\.([A-Za-z_$][A-Za-z0-9_$]*)/g;

  for (const file of SIMULATION_FILES) {
    const source = fs.readFileSync(path.join(root, 'js', file), 'utf8');
    assert.doesNotMatch(source, /UI\.dirty\s*\[/, `${file} 使用動態 dirty 鍵，無法由協議完整列舉`);
    let match;
    while ((match = accessPattern.exec(source))) actual.add(match[1]);
  }

  assert.deepEqual([...actual].sort(), [...EXPECTED_PANEL_KEYS].sort());
  assert.deepEqual([...protocol.PANEL_KEYS].sort(), [...EXPECTED_PANEL_KEYS].sort());
  assert.equal(new Set(protocol.PANEL_KEYS).size, protocol.PANEL_KEYS.length, 'PANEL_KEYS 不得重複');
  for (const key of EXPECTED_PANEL_KEYS) assert.equal(protocol.isPanelKey(key), true, key);
  assert.equal(protocol.isPanelKey('unknown'), false);
});
