const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const protocol = fs.readFileSync(path.join(root, 'js/worker/protocol.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

test('P5a 協議 fn 不得在 UI 直接呼叫', () => {
  const names = [...protocol.matchAll(/fn:\s*'([^']+)'/g)].map(m => m[1]);
  const unique = [...new Set(names)];
  const direct = [];
  for (const name of unique) {
    const re = new RegExp(`(?<![\\w$])${name.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s*\\(`, 'g');
    if (re.test(ui)) direct.push(name);
  }
  assert.deepEqual(direct, []);
});
