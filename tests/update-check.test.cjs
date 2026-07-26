const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'main.js'), 'utf8');
const start = mainSource.indexOf('function checkForUpdates');
const end = mainSource.indexOf('// 以實際經過時間切片模擬', start);
const updateChecker = mainSource.slice(start, end);

test('更新檢查以頁面內容指紋判斷，不使用 HTTP 標頭誤判', () => {
  assert.doesNotMatch(updateChecker, /method:\s*['"]HEAD['"]/);
  assert.doesNotMatch(updateChecker, /Last-Modified|ETag/);
  assert.match(updateChecker, /res\.text\(\)/);
  assert.match(updateChecker, /updateContentFingerprint/);
});
