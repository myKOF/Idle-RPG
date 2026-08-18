const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const expected = {
  light: { c1: '#ffe47a', c2: '#fffef4', glow: '#fff3a3' },
  dark: { c1: '#6f2da8', c2: '#1a0c2e', glow: '#913dcc' },
  fire: { c1: '#e63924', c2: '#ffd447', glow: '#ff6a2a' },
  ice: { c1: '#4da6ff', c2: '#f2fbff', glow: '#79d8ff' },
  lightning: { c1: '#f2b705', c2: '#fff8b0', glow: '#ffd23f' },
  earth: { c1: '#ad7444', c2: '#5b3a27', glow: '#c48a55' },
  poison: { c1: '#4caf2b', c2: '#d8ff8a', glow: '#76d83b' },
  wind: { c1: '#86efac', c2: '#ffffff', glow: '#b9f6cf' }
};

function loadVfxContext() {
  const context = {
    console,
    Math: Object.create(Math),
    Date,
    Object,
    Infinity,
    document: {
      hidden: false,
      getElementById() { return null; },
      querySelectorAll() { return []; }
    },
    setTimeout() { return 1; },
    clearTimeout() {},
    requestAnimationFrame() { return 1; },
    cancelAnimationFrame() {}
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js', 'vfx.js'), 'utf8'), context,
    { filename: 'js/vfx.js' });
  return context;
}

test('八系戰鬥特效共用明確的屬性色票', () => {
  const c = loadVfxContext();
  assert.equal(JSON.stringify(c.VFX_ELEM_THEME), JSON.stringify(expected));
  for (const [elem, theme] of Object.entries(expected)) {
    assert.equal(JSON.stringify(c.vfxTheme({ elem })), JSON.stringify(theme),
      `${elem} 應使用自己的元素主題`);
  }
});

test('技能資料主色與 DOM／Pixi 特效主題一致', () => {
  const data = fs.readFileSync(path.join(root, 'js', 'data.js'), 'utf8');
  const vfx = fs.readFileSync(path.join(root, 'js', 'vfx.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'js', 'battle-renderer.js'), 'utf8');
  for (const [elem, theme] of Object.entries(expected)) {
    assert.match(data, new RegExp(`${elem}: \\{[^}]*color: '${theme.c1}'`));
    assert.match(vfx, new RegExp(`${elem}:\\s+\\{ c1: '${theme.c1}'`));
  }
  assert.match(renderer, /elem: spec\.elem \|\| null, cat: 'enemy'/,
    'Pixi 敵方投射物應依攻擊事件的敵人 attr 取色');
  assert.match(renderer, /function projectileCore\(spec, theme\)/);
  assert.match(renderer, /elem === 'lightning'/);
  assert.match(renderer, /theme\.c1, width: 5/);
  assert.match(renderer, /var glyphOnly = spec\.glyph && \(spec\.variant === 'glyph'/,
    '有元素的技能投射物應優先使用元素彈體，不被技能 emoji 蓋掉');
});

test('投射物與地板領域保留各元素的形狀辨識', () => {
  const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
  assert.match(css, /\.vfx-proj-lightning \.vfx-proj-core[\s\S]*clip-path:/,
    '雷電投射物應為折線');
  assert.match(css, /\.vfx-aura-ice \.vfx-aura-p[\s\S]*background: linear-gradient/,
    '冰地板應保留冰晶亮部');
  assert.match(css, /\.vfx-aura-lightning \.vfx-aura-p[\s\S]*clip-path:/,
    '雷電地板應保留折線');
  assert.match(css, /\.vfx-aura-earth \.vfx-aura-p[\s\S]*box-shadow:/,
    '土地板應保留方塊碎片');
  assert.match(css, /\.vfx-impact-claw::before[\s\S]*var\(--vfx-c1/,
    '敵方受擊回饋不得再固定使用紅色');
});

test('DOM 後備路徑的敵方攻擊事件讀取敵人屬性', () => {
  const combat = fs.readFileSync(path.join(root, 'js', 'combat.js'), 'utf8');
  assert.match(combat, /var enemyVfxElem = \(mEnt && mEnt\.attr/);
  assert.match(combat, /fxKind: 'enemy-attack'/);
  assert.match(combat, /variant: mEnt && mEnt\.magic \? 'enemy-projectile' : 'enemy-melee'/);
  assert.match(combat, /enemyVfxElem \? ELEM_INFO\[enemyVfxElem\]\.color[\s\S]*#ff6b6b/);
});
