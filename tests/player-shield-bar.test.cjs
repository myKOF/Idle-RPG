const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildSceneTree, drawOrder } = require('./helpers/battle-scene.cjs');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'js', 'battle-renderer.js'), 'utf8');

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
  assert.match(ui, /setStyleIfChanged\(shieldBar,\s*'display',\s*'block'\)/);
  assert.match(ui, /setStyleIfChanged\(shieldBar,\s*'display',\s*'none'\)/);
  const shieldMaxHelper = ui.match(/function playerShieldMax\(entity\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(shieldMaxHelper, 'UI 應提供純讀取的護盾上限 helper');
  assert.match(shieldMaxHelper[1], /return Math\.max\(0,\s*entity\.shieldMax \|\| 0\)/);
  assert.doesNotMatch(shieldMaxHelper[1], /entity\.(?:shield|shieldMax|shieldMaxVersion)\s*=/);
  assert.doesNotMatch(ui, /function currentShieldSkillCap\(stats\)/);
  assert.match(ui, /var shieldMax = playerShieldMax\(entity\)/);
  assert.match(ui, /setStyleIfChanged\(shieldBar,\s*'width',\s*clamp\(shield \/ shieldMax \* 100,\s*0,\s*100\) \+ '%'\)/);
  assert.match(ui, /var panelPlayer = field\.player/);
  assert.match(ui, /if \(typeof view\.shield === 'number' && isFinite\(view\.shield\)\) p\.shield = view\.shield/);
  assert.doesNotMatch(ui, /shieldBar\.style\.width = clamp\(shield \/ stats\.hp \* 100/);
  assert.doesNotMatch(ui, /stats\.hp \* 0\.5/);
  assert.match(ui, /setHtmlIfChanged\(\$id\('pv-hptext'\),\s*fmt\(Math\.max\(0,\s*p\.hp\)\) \+ playerShieldText\(p\) \+ ' \/ ' \+ fmt\(st\.hp\)\)/);
  assert.match(ui, /setHtmlIfChanged\(\$id\('tp-hptext'\),\s*fmt\(Math\.max\(0,\s*p\.hp\)\) \+ playerShieldText\(p\) \+ ' \/ ' \+ fmt\(st\.hp\)\)/);
});

test('Canvas 玩家護盾條以護盾最大值為分母，不以最大生命鎖住滿格', () => {
  assert.match(renderer, /playerShieldMax:\s*0/);
  assert.match(renderer, /var shieldMax = S\.playerShieldMax > 0 \? S\.playerShieldMax : Math\.max\(0, v\.shield \|\| 0\)/);
  assert.match(renderer, /sh \/ Math\.max\(1, shieldMax\)/);
  assert.doesNotMatch(renderer, /sh \/ hpMax/);
});

test('Canvas 玩家血條、法力條與護盾條位於敵人及所有浮字之上', () => {
  /* 釘的是「相對順序」而不是那一行的字面：VFX Preset 的 presetZone／presetFx
     之後插在 zone 與 fx 後面，2026-09-22 特效層又包進斜俯視的地面平面容器，
     字面比對會因為無關的層而失效，但這條要驗的一直都是「玩家 HUD 在敵人與所有浮字之上」。
     所以看真正組出來的場景樹。 */
  const S = buildSceneTree(renderer);
  const L = S.layers;
  const drawn = drawOrder(L.world);
  const names = ['zone', 'presetZone', 'entity', 'fx', 'presetFx', 'float', 'playerHud'];
  const hudAt = drawn.indexOf(L.playerHud);
  assert.ok(hudAt >= 0, 'playerHud 不在 world 底下');
  names.slice(0, -1).forEach(function (name) {
    const at = drawn.indexOf(L[name]);
    assert.ok(at >= 0, name + ' 不在 world 底下');
    assert.ok(hudAt > at, '層順序不對：playerHud 必須畫在 ' + name + ' 之後');
  });
  assert.match(renderer, /playerHud:\s*playerHud/);
  assert.match(renderer, /S\.layers\.playerHud\.addChild\(vitals\)/);
  assert.match(renderer, /S\.layers\.playerHud\.addChild\(hpText\)/);
  assert.match(renderer, /S\.layers\.playerHud\.addChild\(mpText\)/);
  assert.match(renderer, /hud:\s*S\.layers\.playerHud/);
  assert.match(renderer, /if \(p\.hud\) \{\s*p\.hud\.x = p\.root\.x;\s*p\.hud\.y = p\.root\.y;/);
});
