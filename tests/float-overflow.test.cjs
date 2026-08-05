const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');

test('foreground combat floats are not clipped by the combatant card', () => {
  const combatant = css.match(/\.combatant\s*\{([\s\S]*?)\n\}/);
  assert.ok(combatant, 'combatant style block should exist');
  assert.match(combatant[1], /overflow:\s*visible/);
  assert.match(css, /\.float-txt\.player-event\s*\{[\s\S]*?white-space:\s*nowrap/);
});
