const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');

test('玩家血條上方有不影響排版的護盾條', () => {
  assert.match(html, /<div class="hp-bar">\s*<div class="shield-bar" id="pv-shield"><\/div>\s*<div class="hp-fill player" id="pv-hp"><\/div>/);
  assert.match(html, /<div class="hp-bar">\s*<div class="shield-bar" id="tp-shield"><\/div>\s*<div class="hp-fill player" id="tp-hp"><\/div>/);

  const hpCss = css.match(/\.hp-bar\s*\{([\s\S]*?)\}/);
  assert.ok(hpCss, '找不到血條樣式');
  assert.match(hpCss[1], /overflow:\s*visible/);

  const shieldCss = css.match(/\.shield-bar\s*\{([\s\S]*?)\}/);
  assert.ok(shieldCss, '找不到護盾條樣式');
  assert.match(shieldCss[1], /position:\s*absolute/);
  assert.match(shieldCss[1], /top:\s*-5px/);
  assert.match(shieldCss[1], /height:\s*3px/);
  assert.match(shieldCss[1], /min-width:\s*10px/);
  assert.match(shieldCss[1], /#dff8ff/);
});

test('玩家護盾同時顯示獨立護盾條與血量文字數值', () => {
  assert.match(ui, /function renderPlayerShieldBar\(prefix,\s*entity,\s*stats\)/);
  assert.match(ui, /function playerShieldText\(entity\)/);
  assert.match(ui, /renderPlayerShieldBar\('pv',\s*p,\s*st\)/);
  assert.match(ui, /renderPlayerShieldBar\('tp',\s*p,\s*st\)/);
  assert.match(ui, /prefix \+ '-shield'/);
  assert.match(ui, /shieldBar\.style\.display = 'block'/);
  assert.match(ui, /shieldBar\.style\.display = 'none'/);
  assert.match(ui, /shieldBar\.style\.width = clamp\(shield \/ stats\.hp \* 100,\s*0,\s*100\) \+ '%'/);
  assert.match(ui, /pv-hptext'\)\.innerHTML = fmt\(Math\.max\(0,\s*p\.hp\)\) \+ playerShieldText\(p\) \+ ' \/ ' \+ fmt\(st\.hp\)/);
  assert.match(ui, /tp-hptext'\)\.innerHTML = fmt\(Math\.max\(0,\s*p\.hp\)\) \+ playerShieldText\(p\) \+ ' \/ ' \+ fmt\(st\.hp\)/);
});
