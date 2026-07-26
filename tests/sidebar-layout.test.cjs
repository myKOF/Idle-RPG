const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.resolve(__dirname, '..', 'css', 'style.css'), 'utf8');

test('屬性側欄維持原佈局寬度並禁止橫向溢出，屬性列可在欄內排版', () => {
  assert.match(css, /#stats-sidebar\s*\{[\s\S]*?width:\s*236px;[\s\S]*?flex:\s*0 0 236px;[\s\S]*?overflow-x:\s*hidden;/);
  assert.match(css, /\.attr-group \.stat-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) max-content;[\s\S]*?min-width:\s*0;/);
  assert.match(css, /\.attr-group \.stat-row span,[\s\S]*?\.attr-group \.stat-row b\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?white-space:\s*normal;/);
  assert.match(css, /\.attr-group \.stat-row b\s*\{[\s\S]*?white-space:\s*nowrap;/);
});
