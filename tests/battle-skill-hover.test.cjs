'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function sectionBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, '找不到區段：' + startMarker);
  return source.slice(start, end);
}

test('戰鬥技能列以每格 key 保留既有 DOM，只在技能或槽位種類改變時替換', () => {
  const render = sectionBetween(ui, 'function renderBattleSkillBar(', '/* 戰鬥區技能欄 60fps');
  assert.match(render, /data-battle-skill-key/);
  assert.match(render, /slot\.getAttribute\('data-battle-skill-key'\) !== state\.key/);
  assert.match(render, /bar\.replaceChild\(replacement, slot\)/);
  assert.doesNotMatch(render, /setHtmlIfChanged\(bar,\s*h\)/);
  assert.match(ui, /function syncBattleSkillSlot\(slot, state\)/);
});

test('技能列的動態冷卻資料不會進入 DOM 身分 key', () => {
  const keyFn = sectionBetween(ui, 'function battleSkillSlotKey(', 'function battleSkillSlotMarkup');
  assert.match(keyFn, /state\.kind,\s*state\.index,\s*state\.entry/);
  assert.doesNotMatch(keyFn, /snapshotGt|rawCdVal|cdText|cdDeg/);
  assert.match(ui, /slot\.setAttribute\('data-snap-gt', state\.snapshotGt \|\| 0\)/);
});

test('同一技能 tooltip 不會因重複 hover 事件重建或重新定位', () => {
  const tooltip = sectionBetween(ui, 'function showSkillTooltipHTML(', '/* ---- 技能懸停提示 ---- */');
  assert.match(tooltip, /UI\.tooltipAnchor === anchorEl/);
  assert.match(tooltip, /tip\.innerHTML === html/);
  assert.match(ui, /cell\.contains\(e\.relatedTarget\)/);
  assert.match(ui, /outTipCell\.contains\(e\.relatedTarget\)/);
});

test('ui.js 快取版號已同步更新', () => {
  // 2026-08-16 敵人死亡後清除未播放傷害浮字 → 1.0.45 → 1.0.46
  // 2026-08-17 新版技能「解鎖轉生/等級」門檻接進技能面板 → 1.0.46 → 1.0.47
  assert.match(html, /js\/ui\.js\?v=1\.0\.47/);
});
