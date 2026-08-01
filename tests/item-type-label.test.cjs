'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext() {
  const context = { console, Math: Object.create(Math) };
  context.window = context;
  vm.createContext(context);

  for (const file of ['js/util.js', 'js/data.js', 'js/formula.js']) {
    vm.runInContext(
      fs.readFileSync(path.join(root, file), 'utf8'),
      context,
      { filename: file },
    );
  }

  return context;
}

test('weapon item labels show only the specific weapon type', () => {
  const context = loadContext();

  assert.equal(
    context.itemTypeLabel({ slot: 'weapon', weaponType: 'dagger1h' }),
    '單手匕首',
  );
  assert.equal(
    context.itemTypeLabel({ slot: 'weapon', weaponType: 'greatsword2h' }),
    '雙手大劍',
  );
});

test('non-weapon item labels still use the equipment slot name', () => {
  const context = loadContext();

  assert.equal(
    context.itemTypeLabel({ slot: 'helmet' }),
    context.SLOT_INFO.helmet.name,
  );
});
