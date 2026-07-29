const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function extractFunction(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing ${name}`);
  let brace = source.indexOf('{', start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail(`unterminated function ${name}`);
}

test('inventory command controls are disabled while their real pending key is active', () => {
  const uiSource = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const control = {
    disabled: false,
    attrs: {},
    setAttribute(name, value) {
      this.attrs[name] = value;
    }
  };
  const context = {
    UI_COMMAND_PENDING: { byKey: { 'node:inv-expand': {} } },
    document: {
      querySelectorAll(selector) {
        assert.equal(selector, '[data-ui-pending-key="node:inv-expand"]');
        return [control];
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(extractFunction(uiSource, 'uiPendingKey'), context);
  vm.runInContext(extractFunction(uiSource, 'nodePendingKey'), context);
  vm.runInContext(extractFunction(uiSource, 'isUiCommandPending'), context);
  const syncStart = uiSource.indexOf('function syncUiPendingControls(');
  const syncEnd = uiSource.indexOf('\nfunction bindUiPendingControl', syncStart);
  assert.ok(syncStart >= 0 && syncEnd > syncStart, 'missing syncUiPendingControls');
  vm.runInContext(uiSource.slice(syncStart, syncEnd), context);
  vm.runInContext(extractFunction(uiSource, 'bindUiPendingControl'), context);

  context.bindUiPendingControl(control, 'node:inv-expand');
  assert.equal(control.attrs['data-ui-pending-key'], 'node:inv-expand');

  context.syncUiPendingControls('node:inv-expand');
  assert.equal(control.disabled, true);
});
