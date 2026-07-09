const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('equipment affix reroll buttons render in a fixed right action column', () => {
  const itemJs = fs.readFileSync(path.join(root, 'js/item.js'), 'utf8');

  assert.match(itemJs, /class="it-affix-row/);
  assert.match(itemJs, /class="it-affix-text/);
  assert.match(itemJs, /class="it-affix-action/);
  assert.match(itemJs, /class="btn affix-reroll-btn act-btn-tooltip"/);
  assert.doesNotMatch(itemJs, /var rrBtn = ' <button class="btn act-btn-tooltip" style=/);
});

test('equipment affix rows reserve a stable right-side button column', () => {
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');

  assert.match(css, /\.it-affixes\s*{[\s\S]*width:\s*100%/);
  assert.match(css, /\.it-affix-row\s*{[\s\S]*display:\s*grid/);
  assert.match(css, /\.it-affix-row\s*{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*32px/);
  assert.match(css, /\.it-affix-row\s*{[\s\S]*width:\s*100%/);
  assert.match(css, /\.it-affix-action\s*{[\s\S]*justify-content:\s*center/);
  assert.match(css, /\.affix-reroll-btn\s*{[\s\S]*width:\s*22px/);
  assert.match(css, /\.affix-reroll-btn\s*{[\s\S]*height:\s*22px/);
});
