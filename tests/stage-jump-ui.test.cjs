const test = require('node:test');
const { readExpanded } = require('./helpers/str-expand.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('階段列提供直達最高按鈕並將最高資訊放在其右側', () => {
  const html = readExpanded(path.join(root, 'index.html'));
  const ui = readExpanded(path.join(root, 'js/ui.js'));
  assert.match(html, /id="st-max"[^>]*>\s*<svg class="ui-ico ui-ico-last"/);
  assert.match(html, /id="stage-label"[^>]*>第 1 關<\/span>/);
  assert.match(html, /id="stage-best" class="dim-text"><\/span>/);
  assert.match(ui, /' 第 ' \+ displayStage \+ ' 關'/);
  assert.match(ui, /setTextIfChanged\(best, '最高' \+ stg\.best \+ '\/' \+ zoneMaxStage\(stg\.zone\) \+ '關'\)/);
  assert.match(ui, /\$id\('st-max'\)\.addEventListener\('click',[\s\S]*sendUiCommand\('stage\.goMax'/);
});

test('階段前進與後退按鈕提供提示並支援長按快速切換', () => {
  const html = readExpanded(path.join(root, 'index.html'));
  const ui = readExpanded(path.join(root, 'js/ui.js'));

  assert.match(html, /id="st-prev"[^>]*data-tt-title="後退關卡"[^>]*data-tt-desc="左鍵按住可以快速後退"/);
  assert.match(html, /id="st-next"[^>]*data-tt-title="前進關卡"[^>]*data-tt-desc="左鍵按住可以快速前進"/);
  assert.match(html, /id="st-prev"[^>]*data-tip-placement="stage-left"/);
  assert.match(html, /id="st-next"[^>]*data-tip-placement="stage-right"/);
  assert.match(ui, /var STAGE_HOLD_REPEAT_MS = 50;/);
  assert.match(ui, /function refreshStageDisplay\(stageOverride\)/);
  assert.match(ui, /function stepStageButton\(delta\)[\s\S]*sendUiCommand\('stage\.go'/);
  assert.match(ui, /btn\.addEventListener\('click',[\s\S]*stepStageButton\(delta\);/);
  assert.match(ui, /function bindStageHoldButton\(id, delta\)/);
  assert.match(ui, /bindStageHoldButton\('st-prev', -1\);/);
  assert.match(ui, /bindStageHoldButton\('st-next', 1\);/);
});

test('長按依實際經過時間計算目標，計時器延遲時仍會追上應有進度', () => {
  const ui = readExpanded(path.join(root, 'js/ui.js'));

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
  const ui = readExpanded(path.join(root, 'js/ui.js'));
  const previewStart = ui.indexOf('function updateStageHoldPreview(now)');
  const previewEnd = ui.indexOf('function tickStageHold()', previewStart);
  const previewBody = ui.slice(previewStart, previewEnd);

  assert.ok(previewStart >= 0 && previewEnd > previewStart);
  assert.doesNotMatch(previewBody, /stageGo\(/);
  assert.match(ui, /function finishStageHold\(btn\)[\s\S]*sendUiCommand\('stage\.go'/);
  assert.match(ui, /function finishStageHold\(btn\)[\s\S]*panels: \['battle', 'header'\]/);
  assert.match(ui, /UI\.stageHold\.active && typeof UI\.stageHold\.targetStage === 'number'/);

  const finishStart = ui.indexOf('function finishStageHold(btn)');
  const finishEnd = ui.indexOf('\nfunction stepStageButton', finishStart);
  const stageGoCalls = [];
  const pendingStages = [];
  let refreshCount = 0;
  const context = {
    UI: { stageHold: { startTimer: 1, repeatTimer: 2, suppressClick: true, suppressTimer: null, pointerId: 9, active: true, startedAt: 100, startStage: 10, targetStage: 25, delta: 1 } },
    uiHeaderPanelSnapshot() { return { stage: { current: 15 } }; },
    nodePendingKey(key) { return key; },
    sendUiCommand(name, args) { stageGoCalls.push({ name, args }); return Promise.resolve(); },
    clearTimeout() {},
    setTimeout() { return 3; },
    refreshStageDisplay() { refreshCount++; },
    setStagePendingStage(stage) { pendingStages.push(stage); refreshCount++; }
  };
  vm.runInNewContext(ui.slice(finishStart, finishEnd), context);
  context.finishStageHold(null);
  context.finishStageHold(null);
  assert.equal(stageGoCalls.length, 1);
  assert.equal(stageGoCalls[0].name, 'stage.go');
  assert.equal(stageGoCalls[0].args.delta, 10);
  assert.equal(refreshCount, 1);
  /* 放手後畫面必須停在玩家選定的關卡，等新的 header 面板回來才換。
     少了這一步，refreshStageDisplay 會用還沒更新的快照重畫，玩家看到的是
     「85 → 110 → 85」這種閃回舊值再跳回來的畫面。 */
  assert.deepEqual(pendingStages, [25]);
});

test('階段按鈕提示支援外側定位，避免蓋住階段文字', () => {
  const source = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const fn = source.match(/function positionSkTooltip\([^)]*\) \{[\s\S]*?\n\}/);
  assert.ok(fn);
  const rect = { left: 300, right: 340, top: 100, bottom: 130 };
  const c = { window: { UiCanvas: { width: 800, height: 600, rect: () => rect } } };
  vm.runInNewContext(fn[0], c);
  const tip = { offsetWidth: 100, offsetHeight: 60, style: {} };
  c.positionSkTooltip(tip, {}, 'stage-left');
  assert.equal(tip.style.left, '190px'); assert.equal(tip.style.top, '138px');
  c.positionSkTooltip(tip, {}, 'stage-right');
  assert.equal(tip.style.left, '350px'); assert.equal(tip.style.top, '138px');
  rect.top = 550; rect.bottom = 580;
  c.positionSkTooltip(tip, {}, 'stage-right');
  assert.equal(tip.style.top, '482px', '下緣空間不足時翻到上方');
});

test('最高資訊顯示最高到達／目前場景上限，換圖與改表同步且不受退關或長按預覽影響', () => {
  const source = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const nodes = { 'stage-label': {}, 'stage-best': {} };
  const header = { stage: { zone: 'desert', current: 1, best: 3 } };
  const c = { console, UI: { stageHold: { active: false } }, _stagePendingStage: null,
    peekUiPanelData: () => header, document: { getElementById: id => nodes[id] }, nodePendingKey: key => key,
    isUiCommandPending: () => false, zoneIconHtml: () => '', refreshStageAutoButton() {},
    setHtmlIfChanged: (node, html) => { node.innerHTML = html; },
    setTextIfChanged: (node, text) => { node.textContent = text; }
  };
  c.window = c; vm.createContext(c);
  for (const file of ['util', 'strings_data', 'strings', 'data']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'js', file + '.js'), 'utf8'), c);
  }
  for (const name of ['uiCurrentZoneDef', 'refreshStageDisplay']) {
    const fn = source.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}'));
    assert.ok(fn, name); vm.runInContext(fn[0], c);
  }
  for (const zone of c.ZONE_LIST) {
    header.stage.zone = zone;
    c.refreshStageDisplay();
    assert.equal(nodes['stage-best'].textContent, '最高3/' + c.ZONES[zone].maxStage + '關', zone);
  }
  header.stage = { zone: 'Icefield', current: 1, best: 42 };
  c.UI.stageHold = { active: true, targetStage: 75 };
  c.refreshStageDisplay();
  assert.equal(nodes['stage-best'].textContent, '最高42/150關');
  assert.match(nodes['stage-label'].innerHTML, /第 75 關/);
  c.ZONES.Icefield.maxStage = 175;
  const before = JSON.stringify(header);
  c.refreshStageDisplay(99);
  assert.equal(nodes['stage-best'].textContent, '最高42/175關');
  assert.match(nodes['stage-label'].innerHTML, /第 99 關/);
  assert.equal(JSON.stringify(header), before, '只更新顯示，不修改最高進度或目前關卡');
});
