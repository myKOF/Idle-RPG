const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function uiSource() {
  return fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
}

test('敵人名稱版面量測只在敵人結構或視窗尺寸改變時執行', () => {
  const ui = uiSource();
  assert.match(ui, /battleLayoutDirty:\s*true/);
  assert.match(ui, /if \(party\.getAttribute\('data-enemy-signature'\) !== enemySignature\) \{[\s\S]*UI\.battleLayoutDirty = true;/);
  assert.match(ui, /if \(UI\.battleLayoutDirty\) \{[\s\S]*fitEnemyNames\(party\);[\s\S]*UI\.battleLayoutDirty = false;/);
  assert.match(ui, /addEventListener\('resize',[\s\S]*UI\.battleLayoutDirty = true/);
  assert.doesNotMatch(ui, /\}\n  fitEnemyNames\(party\);\n  var cards/);
});

test('高頻日誌先進入有上限的佇列，再由 UI tick 批次寫入', () => {
  const ui = uiSource();
  assert.match(ui, /var PENDING_LOG_DOM = \{\};/);
  assert.match(ui, /function enqueueLogDom\(elId, msg, cls, cat, cap\)/);
  assert.match(ui, /queue\.splice\(0, queue\.length - limit\)/);
  assert.match(ui, /function flushPendingLogDom\(\)/);
  assert.match(ui, /document\.createDocumentFragment\(\)/);
  assert.match(ui, /function uiTick\(\)[\s\S]*flushPendingLogDom\(\);/);

  const enqueue = ui.match(/function enqueueLogDom\(elId, msg, cls, cat, cap\) \{[\s\S]*?\n\}/);
  assert.ok(enqueue);
  const context = { PENDING_LOG_DOM: {} };
  vm.runInNewContext(enqueue[0], context);
  context.enqueueLogDom('battle-log', '一', '', 'combat', 2);
  context.enqueueLogDom('battle-log', '二', '', 'combat', 2);
  context.enqueueLogDom('battle-log', '三', '', 'combat', 2);
  assert.deepEqual(Array.from(context.PENDING_LOG_DOM['battle-log'], (entry) => entry.msg), ['二', '三']);
});

test('重建或清除熔爐日誌時會同步清空尚未寫入的佇列', () => {
  const ui = uiSource();
  assert.match(ui, /function clearPendingLogDom\(elId\)/);
  assert.match(ui, /function refreshNewForgeMainLog\(\) \{[\s\S]*clearPendingLogDom\('newforge-log'\)/);
  assert.match(ui, /NEWFORGE_LOG_HISTORY\.length = 0;[\s\S]*clearPendingLogDom\('newforge-log'\)/);
});

test('背景分頁跳過 UI 重繪，回到前景後標記並立即刷新', () => {
  const ui = uiSource();
  assert.match(ui, /function uiRenderingSuspended\(\)/);
  assert.match(ui, /function markVisibleUiDirty\(\)/);
  assert.match(ui, /function handleVisibilityChange\(\)/);
  assert.match(ui, /function uiTick\(\) \{\s*if \(uiRenderingSuspended\(\)\) return;/);
  assert.match(ui, /document\.addEventListener\('visibilitychange', handleVisibilityChange\)/);
  assert.match(ui, /handleVisibilityChange[\s\S]*markVisibleUiDirty\(\);[\s\S]*uiTick\(\);/);
});

test('熔爐消費背包 dirty 後會清旗標，切回裝備頁時再定向補標', () => {
  const ui = uiSource();
  assert.match(ui, /function markTabDirty\(name\)/);
  assert.match(ui, /function switchTab\(name\)[\s\S]*markTabDirty\(name\);/);
  assert.match(ui, /function switchTab\(name\)[\s\S]*if \(validUiPanelKey\(name\)\) requestPanelData\(name, true\);/);
  assert.match(ui, /name === 'equip'[\s\S]*UI\.dirty\.equip = true;[\s\S]*UI\.dirty\.inv = true;/);
  assert.match(ui, /name === 'newforge'[\s\S]*UI\.dirty\.newforge = true;/);
  assert.match(ui, /UI\.tab === 'newforge'\) \{ renderNewForge\(\); d\.newforge = false; d\.factory = false; d\.inv = false; \}/);
});

test('戰鬥與高塔技能列共用外層已取得的屬性，不重複呼叫 getStats', () => {
  const ui = uiSource();
  assert.match(ui, /function renderMpSkill\(pEnt, prefix, stats, snapshotGt\)/);
  const renderMpSkill = ui.match(/function renderMpSkill\(pEnt, prefix, stats, snapshotGt\) \{[\s\S]*?\n\}/);
  assert.ok(renderMpSkill);
  assert.match(renderMpSkill[0], /if \(!stats\) return;/);
  assert.match(renderMpSkill[0], /var maxMp = Math\.max\(1, Number\(stats\.mp\) \|\| 1\);/);
  assert.doesNotMatch(renderMpSkill[0], /getStats\(\)/);
  /* 第 4 個參數是快照時間：技能冷卻要扣掉「拍照到現在」才會是即時倒數，
     少傳就會退回顯示拍照當下的值，也就是使用者回報的「卡住幾秒再突然可放」。 */
  assert.match(ui, /function renderBattle\(\)[\s\S]*var st = headerSnapshot\.stats[\s\S]*renderMpSkill\(p, 'pv', st, battleSnapshot\.gt\);/);
  assert.match(ui, /function renderTowerFight\(\)[\s\S]*var st = headerSnapshot\.stats;[\s\S]*renderMpSkill\(p, 'tp', st, snapshot\.gt\);/);
  const towerFight = ui.match(/function renderTowerFight\(\) \{[\s\S]*?\n\}/);
  assert.ok(towerFight);
  assert.doesNotMatch(towerFight[0], /getStats\(\)/);
});

test('場景列以狀態簽章避免每個 UI tick 重寫', () => {
  const ui = uiSource();
  assert.match(ui, /zoneBarSignature:\s*null/);
  assert.match(ui, /function currentZoneBarSignature\(\)/);
  assert.match(ui, /function renderZoneBar\(\)[\s\S]*var signature = currentZoneBarSignature\(\)[\s\S]*if \(UI\.zoneBarSignature === signature\) return;[\s\S]*UI\.zoneBarSignature = signature;/);
});

test('高頻戰鬥欄位使用值變更才寫入的 DOM 輔助函式', () => {
  const ui = uiSource();
  assert.match(ui, /function setTextIfChanged\(el, value\)/);
  assert.match(ui, /function setHtmlIfChanged\(el, value\)/);
  assert.match(ui, /function setStyleIfChanged\(el, prop, value\)/);
  assert.match(ui, /function setCheckedIfChanged\(el, value\)/);
  assert.match(ui, /setStyleIfChanged\(mpFill, 'width'/);
  assert.match(ui, /setHtmlIfChanged\(skillEl, h\)/);
  assert.match(ui, /setTextIfChanged\(label, znd\.emoji/);
  assert.match(ui, /setCheckedIfChanged\(auto, stg\.autoAdvance\)/);
  assert.match(ui, /setStyleIfChanged\(fill, 'width'/);
  assert.match(ui, /setHtmlIfChanged\(hpText,/);
});

test('戰鬥浮字高峰會自動降載，避免每次命中反覆觸發 layout', () => {
  const ui = uiSource();
  assert.match(ui, /var UI_WORKER_VISUAL_EVENT_QUEUE = \[\];/);
  assert.match(ui, /function queueWorkerVisualEvent\(event\)/);
  assert.match(ui, /function flushWorkerVisualEvents\(\)/);
  assert.match(ui, /UI_WORKER_VISUAL_FRAME_BUDGET = 6/);
  assert.match(ui, /var ENEMY_FLOAT_LAYOUT_ENABLED = false;/);
  assert.match(ui, /var ENEMY_FLOAT_LAYOUT_LOAD_LIMIT = 24/);
  assert.match(ui, /var ENEMY_DAMAGE_FLOAT_AUTO_MERGE_THRESHOLD = 12/);
  assert.match(ui, /var ENEMY_DAMAGE_FLOAT_AUTO_MERGE_LIMIT = 4/);
  assert.match(ui, /function enemyDamageFloatActiveCount\(layer\)/);
  assert.match(ui, /function enemyDamageFloatMergeLimitForLayer\(battleSnapshot, layer\)/);
  assert.match(ui, /if \(!ENEMY_FLOAT_LAYOUT_ENABLED\) return;/);
  assert.match(ui, /var damageMergeLimit = enemyDamageFloatMergeLimitForLayer\(battleSnapshot, layer\);[\s\S]*if \(damageMergeLimit > 0\)/);
});

test('詳細日誌視窗每個 UI tick 最多完整重建一次', () => {
  const ui = uiSource();
  assert.match(ui, /var DETAIL_LOG_RENDER_DIRTY = false;/);
  assert.match(ui, /var NEWFORGE_DETAIL_LOG_RENDER_DIRTY = false;/);
  assert.match(ui, /function flushDirtyDetailLogs\(\)/);
  assert.match(ui, /function uiTick\(\)[\s\S]*flushPendingLogDom\(\);[\s\S]*flushDirtyDetailLogs\(\);/);
  const addLogStart = ui.indexOf('function addLog(elId, msg, cls, cap, cat)');
  const addLogEnd = ui.indexOf('\nfunction blog(', addLogStart);
  const addLogBody = ui.slice(addLogStart, addLogEnd);
  assert.doesNotMatch(addLogBody, /renderDetailLog\(\)/);
  assert.doesNotMatch(addLogBody, /renderNewForgeDetailLog\(\)/);
});

test('Worker panel subscriptions clear and Commands wait for post-ACK panel generations', () => {
  const ui = uiSource();
  const panelData = ui.match(/function panelData\(key\) \{[\s\S]*?\n\}/);
  assert.ok(panelData);
  assert.doesNotMatch(panelData[0], /panelSubscriptions\[key\]\s*=/);
  assert.match(ui, /function refreshUiPanelSubscriptions\(\)[\s\S]*delete UI_WORKER_STATE\.panelSubscriptions\[key\]/);
  assert.match(ui, /panelRequestSeq:\s*Object\.create\(null\)/);
  assert.match(ui, /panelResponseSeq:\s*Object\.create\(null\)/);
  assert.match(ui, /UI_WORKER_STATE\.panelQueued\[key\]\s*=\s*[\s\S]*mergeUiPanelParams\(UI_WORKER_STATE\.panelQueued\[key\], requestParams\)/);
  assert.match(ui, /WorkerBridge\.requestPanel\(key, requestParams\)/);
  assert.match(ui, /entry\.acknowledged = true;[\s\S]*entry\.waitPanels\[key\] = requestPanelData\(key, true\)/);
  assert.match(ui, /UI_WORKER_STATE\.panelResponseSeq\[key\][\s\S]*>= entry\.waitPanels\[key\]/);
});
