const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const context = { console, Math };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'js/data.js'), 'utf8'), context);
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert.equal(context.RARITIES[3].key, 'unique');
assert.equal(context.RARITIES[3].color, '#ffd700');
assert.equal(context.RARITIES[4].key, 'epic');
assert.equal(context.RARITIES[4].color, '#c084fc');
assert.match(html, /style="color:#ffd700">獨特/);
assert.match(html, /style="color:#c084fc">史詩/);
console.log('✔ 獨特與史詩品質文字顏色已互換');
