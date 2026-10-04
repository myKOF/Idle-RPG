const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('equipment affix rows have no dice or action column', () => {
  const itemJs = fs.readFileSync(path.join(root, 'js/item.js'), 'utf8');

  assert.match(itemJs, /class="it-affix-row/);
  assert.match(itemJs, /class="it-affix-text/);
  assert.doesNotMatch(itemJs, /it-affix-action|affix-reroll-btn|🎲/);
});

test('equipment affix rows use full width and enlarge selected text without moving controls', () => {
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');

  assert.match(css, /--it-affix-gap:\s*2px/);
  assert.match(css, /\.it-affixes\s*{[\s\S]*width:\s*100%/);
  assert.match(css, /\.it-affix-row\s*{[\s\S]*display:\s*grid/);
  assert.match(css, /\.it-affix-row\s*{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  assert.match(css, /\.it-affix-row\s*{[\s\S]*width:\s*100%/);
  assert.match(css, /\.it-affix-row\s*{[\s\S]*min-height:\s*18px[\s\S]*height:\s*18px/);
  assert.match(css, /\.it-affix-text\s*{[\s\S]*white-space:\s*nowrap/);
  assert.doesNotMatch(css, /affix-reroll-btn|it-affix-action/);
  const skin = fs.readFileSync(path.join(root, 'css/ashen-forge.css'), 'utf8');
  assert.match(skin, /\.it-affixes\.is-reroll-mode\s*\{\s*gap:\s*8px/);
  assert.match(skin, /\.it-affix-row\.is-reroll-pickable\s*\{[^}]*min-height:\s*40px/);
  assert.match(skin, /\.it-affix-row\.is-reroll-selected \.afx-val\s*\{\s*font-size:\s*18px/);
  assert.doesNotMatch(skin, /affixRerollFlash|affix-reroll-btn/);
});

test('equipment effect text keeps a 2px wrapped-line gap', () => {
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');

  assert.match(css, /--it-effect-line-gap:\s*2px/);
  assert.match(css, /\.it-passive\s*{[\s\S]*line-height:\s*calc\(1em\s*\+\s*var\(--it-effect-line-gap\)\)/);
  assert.match(css, /\.it-godpassive\s*{[\s\S]*line-height:\s*calc\(1em\s*\+\s*var\(--it-effect-line-gap\)\)/);
});
