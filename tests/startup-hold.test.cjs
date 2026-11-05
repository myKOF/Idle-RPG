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
  // 揭幕收進 revealWhenIntroIdle（等開頭動畫播完，見 js/intro-player.js）：先收黑幕再放行
  const revealFn = /function revealWhenIntroIdle\(\) \{[\s\S]*?\n\}/.exec(main);
  assert.ok(revealFn && /hideLoadingScreen\(\);\s*WorkerBridge\.releaseStartupHold\(\)/.test(revealFn[0]), '揭幕後放行');
  assert.match(main, /finished = true;\s*revealWhenIntroIdle\(\);/, 'UI 首畫完成後走揭幕');
  assert.match(main, /finished = true;\s*WorkerBridge\.releaseStartupHold\(\);/, 'workerDead 也要放行');
});

test('開機等待：關閉選單不會提早放行（選單暫停只改自己的旗標）', () => {
  const bridge = read('js/bridge.js');
  const fn = /function setMenuPaused\(value\) \{[\s\S]*?\n  \}/.exec(bridge)[0];
  assert.doesNotMatch(fn, /_startupHold\s*=/);
});
