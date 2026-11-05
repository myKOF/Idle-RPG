const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

/* Loading 黑幕期間 Worker 不能先打戰鬥：否則視覺事件堆在佇列，揭幕後一次播出（特效暴增、FPS 掉到個位數）。 */
test('開機等待：BOOT 訊息帶暫停、揭幕與 workerDead 兩條路徑都會放行、另有逾時保險', () => {
  const bridge = read('js/bridge.js');
  const main = read('js/main.js');
  assert.match(bridge, /var _startupHold = true/);
  assert.match(bridge, /menuPaused: effectivePaused\(\)/, 'BOOT 要帶開機等待旗標');
  assert.match(bridge, /function effectivePaused\(\) \{ return _menuPaused \|\| _startupHold; \}/, '選單暫停與開機等待是聯集，互不覆蓋');
  assert.match(bridge, /setTimeout\(releaseStartupHold, STARTUP_HOLD_MAX_MS\)/, '逾時保險');
  assert.match(bridge, /releaseStartupHold: releaseStartupHold/);
  const reveal = main.indexOf("hideLoadingScreen();\n            WorkerBridge.releaseStartupHold()".replace(/\n/g, main.includes('\r\n') ? '\r\n' : '\n'));
  assert.ok(reveal > 0, '揭幕後放行');
  assert.match(main, /finished = true;\s*WorkerBridge\.releaseStartupHold\(\);/, 'workerDead 也要放行');
});

test('開機等待：關閉選單不會提早放行（選單暫停只改自己的旗標）', () => {
  const bridge = read('js/bridge.js');
  const fn = /function setMenuPaused\(value\) \{[\s\S]*?\n  \}/.exec(bridge)[0];
  assert.doesNotMatch(fn, /_startupHold\s*=/);
});
