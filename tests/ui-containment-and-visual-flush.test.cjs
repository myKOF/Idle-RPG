'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');

function functionBody(name) {
  const start = ui.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'missing function ' + name);
  const open = ui.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < ui.length; i++) {
    if (ui[i] === '{') depth++;
    if (ui[i] === '}' && --depth === 0) return ui.slice(start, i + 1);
  }
  assert.fail('unterminated function ' + name);
}

test('方案 A: flushWorkerVisualEvents 遵守時間預算並及時 break', () => {
  let currentTime = 1000;
  const calls = [];
  const battleSnapshot = { stats: {} };
  const context = {
    UI_WORKER_VISUAL_EVENT_QUEUE: [
      { kind: 'float', elId: 'mv-float-0', text: '1', cls: 'dmg', damageValue: 1 },
      { kind: 'float', elId: 'mv-float-0', text: '2', cls: 'dmg', damageValue: 2 },
      { kind: 'float', elId: 'mv-float-0', text: '3', cls: 'dmg', damageValue: 3 },
      { kind: 'float', elId: 'mv-float-0', text: '4', cls: 'dmg', damageValue: 4 }
    ],
    UI_WORKER_VISUAL_FLUSH_HANDLE: 0,
    UI_WORKER_VISUAL_QUEUE_MAX: 480,
    UI_WORKER_VISUAL_FRAME_MS: 4,
    UI_WORKER_VISUAL_FRAME_MAX: 800,
    uiNowMs: () => currentTime,
    uiBattlePanelSnapshot: () => battleSnapshot,
    scheduleWorkerVisualEventFlush: () => calls.push('scheduleWorkerVisualEventFlush'),
    floatText: (elId, text) => {
      calls.push(['floatText', text]);
      // 模擬每處理 1 件花費 3ms
      currentTime += 3;
    }
  };

  vm.runInNewContext([
    functionBody('flushWorkerVisualEvents')
  ].join('\n'), context);

  context.flushWorkerVisualEvents();

  // 處理第 1 件後耗時 3ms，未超時；處理第 2 件後耗時 6ms，超出 4ms 上限，立即中斷
  assert.equal(calls.filter(c => Array.isArray(c) && c[0] === 'floatText').length, 2);
  assert.equal(context.UI_WORKER_VISUAL_EVENT_QUEUE.length, 2);
  assert.ok(calls.includes('scheduleWorkerVisualEventFlush'));
});

test('方案 C: UIContainmentManager 具備獨立註冊、註銷與一鍵開關功能', () => {
  // 模擬簡易 DOM
  const classListMap = new Map();
  const mockElements = {
    '#skill-trees': {
      classList: {
        contains: (cls) => (classListMap.get('#skill-trees') || new Set()).has(cls),
        add: (cls) => {
          if (!classListMap.has('#skill-trees')) classListMap.set('#skill-trees', new Set());
          classListMap.get('#skill-trees').add(cls);
        },
        remove: (cls) => {
          if (classListMap.has('#skill-trees')) classListMap.get('#skill-trees').delete(cls);
        }
      }
    },
    '#custom-panel': {
      classList: {
        contains: (cls) => (classListMap.get('#custom-panel') || new Set()).has(cls),
        add: (cls) => {
          if (!classListMap.has('#custom-panel')) classListMap.set('#custom-panel', new Set());
          classListMap.get('#custom-panel').add(cls);
        },
        remove: (cls) => {
          if (classListMap.has('#custom-panel')) classListMap.get('#custom-panel').delete(cls);
        }
      }
    }
  };

  const context = {
    document: {
      querySelector: (sel) => mockElements[sel] || null
    },
    window: {}
  };

  // 提取 UIContainmentManager 定義
  const mgrStart = ui.indexOf('var UIContainmentManager = {');
  assert.notEqual(mgrStart, -1, 'missing UIContainmentManager');
  const mgrEnd = ui.indexOf('if (typeof window !== \'undefined\')', mgrStart);
  const mgrCode = ui.slice(mgrStart, mgrEnd);

  vm.runInNewContext(mgrCode, context);
  const mgr = context.UIContainmentManager;

  // 1. 初始化並套用預設的 skill-trees
  mgr.init();
  assert.equal(mgr.isContainerActive('skill-trees'), true);
  assert.equal(classListMap.get('#skill-trees').has('ui-contain-layout'), true);

  // 2. 動態擴充自訂容器
  mgr.register('custom-panel', { selector: '#custom-panel' });
  assert.equal(mgr.isContainerActive('custom-panel'), true);
  assert.equal(classListMap.get('#custom-panel').has('ui-contain-layout'), true);

  // 3. 一鍵關閉方案 C
  mgr.setEnabled(false);
  assert.equal(mgr.enabled, false);
  assert.equal(mgr.isContainerActive('skill-trees'), false);
  assert.equal(classListMap.get('#skill-trees').has('ui-contain-layout'), false);
  assert.equal(classListMap.get('#custom-panel').has('ui-contain-layout'), false);

  // 4. 一鍵重新開啟方案 C
  mgr.setEnabled(true);
  assert.equal(mgr.isContainerActive('skill-trees'), true);
  assert.equal(classListMap.get('#skill-trees').has('ui-contain-layout'), true);
  assert.equal(classListMap.get('#custom-panel').has('ui-contain-layout'), true);

  // 5. 縮小/註銷容器
  mgr.unregister('custom-panel');
  assert.equal(mgr.registry['custom-panel'], undefined);
  assert.equal(classListMap.get('#custom-panel').has('ui-contain-layout'), false);
});
