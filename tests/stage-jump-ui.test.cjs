const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('階段列提供直達最高按鈕並將最高資訊放在其右側', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  assert.match(html, /id="st-max"[^>]*>⏭/);
  assert.match(html, /id="st-max"[\s\S]*id="stage-best"/);
  assert.match(html, /id="stage-best"[^>]*>最高1關<\/span>/);
  assert.match(ui, /setTextIfChanged\(best, '最高' \+ stg\.best \+ '關'\)/);
  assert.match(ui, /\$id\('st-max'\)\.addEventListener\('click',[\s\S]*stageGoMax\(\)/);
});

test('階段前進與後退按鈕提供提示並支援長按快速切換', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

  assert.match(html, /id="st-prev"[^>]*data-tt-title="後退關卡"[^>]*data-tt-desc="滑鼠按住可以快速後退"/);
  assert.match(html, /id="st-next"[^>]*data-tt-title="前進關卡"[^>]*data-tt-desc="滑鼠按住可以快速前進"/);
  assert.match(html, /id="st-prev"[^>]*data-tip-placement="stage-left"/);
  assert.match(html, /id="st-next"[^>]*data-tip-placement="stage-right"/);
  assert.match(ui, /var STAGE_HOLD_REPEAT_MS = 50;/);
  assert.match(ui, /function refreshStageDisplay\(stageOverride\)/);
  assert.match(ui, /function stepStageButton\(delta\)[\s\S]*stageGo\(delta\);[\s\S]*refreshStageDisplay\(\);/);
  assert.match(ui, /btn\.addEventListener\('click',[\s\S]*stepStageButton\(delta\);/);
  assert.match(ui, /function bindStageHoldButton\(id, delta\)/);
  assert.match(ui, /bindStageHoldButton\('st-prev', -1\);/);
  assert.match(ui, /bindStageHoldButton\('st-next', 1\);/);
});

test('長按依實際經過時間計算目標，計時器延遲時仍會追上應有進度', () => {
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

  assert.match(ui, /function stageHoldStepCount\(now, startedAt\)/);
  assert.match(ui, /Math\.floor\(elapsed \/ STAGE_HOLD_REPEAT_MS\)/);
  assert.match(ui, /function updateStageHoldPreview\(now\)/);
  assert.match(ui, /UI\.stageHold\.startStage \+ UI\.stageHold\.delta \* steps/);
  assert.match(ui, /refreshStageDisplay\(targetStage\)/);
  assert.match(ui, /setTimeout\(tickStageHold, delay\)/);
  assert.doesNotMatch(ui, /UI\.stageHold\.repeatTimer = setInterval/);

  const source = ui.match(/function stageHoldStepCount\(now, startedAt\) \{[\s\S]*?\n\}/);
  assert.ok(source);
  const context = { Math, STAGE_HOLD_START_MS: 300, STAGE_HOLD_REPEAT_MS: 50 };
  vm.runInNewContext(source[0], context);
  assert.equal(context.stageHoldStepCount(300, 0), 1);
  assert.equal(context.stageHoldStepCount(350, 0), 2);
  assert.equal(context.stageHoldStepCount(3600, 0), 67);
});

test('長按期間只預覽關卡，停止後才提交一次戰鬥狀態', () => {
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const previewStart = ui.indexOf('function updateStageHoldPreview(now)');
  const previewEnd = ui.indexOf('function tickStageHold()', previewStart);
  const previewBody = ui.slice(previewStart, previewEnd);

  assert.ok(previewStart >= 0 && previewEnd > previewStart);
  assert.doesNotMatch(previewBody, /stageGo\(/);
  assert.match(ui, /function finishStageHold\(btn\)[\s\S]*stageGo\(targetStage - G\.stage\.current\);/);
  assert.match(ui, /function finishStageHold\(btn\)[\s\S]*refreshStageDisplay\(\);/);
  assert.match(ui, /UI\.stageHold\.active && typeof UI\.stageHold\.targetStage === 'number'/);

  const finishStart = ui.indexOf('function finishStageHold(btn)');
  const finishEnd = ui.indexOf('\nfunction stepStageButton', finishStart);
  const stageGoCalls = [];
  let refreshCount = 0;
  const context = {
    UI: { stageHold: { startTimer: 1, repeatTimer: 2, suppressClick: true, suppressTimer: null, pointerId: 9, active: true, startedAt: 100, startStage: 10, targetStage: 25, delta: 1 } },
    G: { stage: { current: 15 } },
    clearTimeout() {},
    setTimeout() { return 3; },
    stageGo(delta) { stageGoCalls.push(delta); },
    refreshStageDisplay() { refreshCount++; }
  };
  vm.runInNewContext(ui.slice(finishStart, finishEnd), context);
  context.finishStageHold(null);
  context.finishStageHold(null);
  assert.deepEqual(stageGoCalls, [10]);
  assert.equal(refreshCount, 1);
});

test('階段按鈕提示支援外側定位，避免蓋住階段文字', () => {
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  assert.match(ui, /var placement = anchorEl\.getAttribute\('data-tip-placement'\);/);
  assert.match(ui, /if \(placement === 'stage-left'\)[\s\S]*x = r\.left - tw - 10/);
  assert.match(ui, /else if \(placement === 'stage-right'\)[\s\S]*x = r\.right \+ 10/);
});
