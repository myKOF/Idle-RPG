const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('apply_params 的場景倍率錨點只搜尋 ZONES，避免神界 key 重複匹配', () => {
  const output = execFileSync(process.execPath, ['tools/apply_params.cjs'], {
    cwd: root,
    encoding: 'utf8'
  });
  assert.match(output, /錨點問題 0/);
  assert.match(output, /一致 554/);
});
