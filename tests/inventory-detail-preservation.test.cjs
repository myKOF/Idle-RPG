'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const uiSource = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
const workerSource = fs.readFileSync(path.join(root, 'js', 'worker', 'sim.worker.js'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'missing function ' + name);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail('unterminated function ' + name);
}

test('selected inventory item survives an ordinary panel refresh with detail data', () => {
  const item = {
    id: 'inv-1',
    rarity: 3,
    slot: 'weapon',
    level: 10,
    name: 'Test weapon',
    affixes: [{ key: 'atkFlat', val: 12 }]
  };

  const context = {
    G: { inventory: [item], settings: {}, equipment: {} },
    INV_CELL_FIELDS: ['id', 'rarity', 'slot', 'level', 'upgrade', 'synthesized',
      'locked', 'name', 'weaponType', 'enchant', 'enchants', 'kind'],
    INV_DETAIL_MAX: 200,
    getItemAncientCount: () => 0,
    inventoryCapacityNow: () => 100,
    viewedEquipment: () => ({}),
    UI: { sel: { id: item.id, source: 'inv' } },
    UI_WORKER_STATE: {
      panels: { inv: null, equip: { equipment: {} } },
      panelRequests: {},
      panelQueued: {},
      panelRequestSeq: {},
      panelResponseSeq: {}
    },
    document: { getElementById: () => null },
    isInternalServer: () => true,
    $id: () => null,
    validUiPanelKey: key => key === 'inv',
    hasOwnUiState: (object, key) => Object.prototype.hasOwnProperty.call(object, key),
    WorkerBridge: {
      requestPanel: (key, params) => {
        context.sentPanel = { key, params };
        return true;
      }
    },
    peekUiPanelData: key => context.UI_WORKER_STATE.panels[key],
    equipViewEquipment: snapshot => snapshot && snapshot.equipment ? snapshot.equipment : {}
  };
  vm.createContext(context);
  vm.runInContext([
    extractFunction(workerSource, 'inventoryCellView'),
    extractFunction(workerSource, 'buildInventoryPanel'),
    extractFunction(uiSource, 'inventoryViewItems'),
    extractFunction(uiSource, 'inventoryViewItem'),
    extractFunction(uiSource, 'mergeUiPanelParams'),
    extractFunction(uiSource, 'activeUiPanelParams'),
    extractFunction(uiSource, 'requestPanelData'),
    extractFunction(uiSource, 'findItemById'),
    extractFunction(uiSource, 'findSelItem')
  ].join('\n'), context);

  // This is the intentionally compact ordinary response: no details are sent.
  context.UI_WORKER_STATE.panels.inv = context.buildInventoryPanel({});
  assert.equal(context.UI_WORKER_STATE.panels.inv.details, null);
  assert.equal(context.findSelItem(), null);

  // Execute the real request path without passing detailIds explicitly.
  context.requestPanelData('inv', true);
  assert.equal(context.sentPanel.key, 'inv');
  assert.deepEqual(Array.from(context.sentPanel.params.detailIds), [item.id]);

  // Execute the real worker projection with the request params, then resolve the selection.
  context.UI_WORKER_STATE.panels.inv = context.buildInventoryPanel(context.sentPanel.params);
  assert.equal(context.UI_WORKER_STATE.panels.inv.details[item.id], item);
  assert.equal(context.findSelItem(), item);
  assert.equal(context.findSelItem().affixes[0].val, 12);
});
