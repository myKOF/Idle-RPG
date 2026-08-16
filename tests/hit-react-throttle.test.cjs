const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadVfxContext(card) {
  const context = {
    console,
    Math: Object.create(Math),
    Date,
    Object,
    Infinity,
    document: {
      hidden: false,
      getElementById() { return { closest() { return card; } }; },
      querySelectorAll() { return []; }
    },
    setTimeout(callback) { callback(); return 1; },
    clearTimeout() {},
    requestAnimationFrame(callback) { callback(); return 1; },
    cancelAnimationFrame() {}
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js', 'vfx.js'), 'utf8'), context,
    { filename: 'js/vfx.js' });
  return context;
}

test('DOM 受擊震動在同一單位三秒內只接受一次', () => {
  const added = [];
  const removed = [];
  const card = {
    classList: {
      add(value) { added.push(value); },
      remove(value) { removed.push(value); }
    }
  };
  const context = loadVfxContext(card);

  context.vfxHitReact('mv-float-1', 'fire', 0, false);
  context.vfxHitReact('mv-float-1', 'fire', 0, true);

  assert.equal(card._vfxHitLastAt > 0, true);
  assert.equal(added.filter((value) => value === 'vfx-hit').length, 1);
  assert.equal(added.filter((value) => value === 'vfx-hit-strong').length, 0);
  assert.ok(removed.length > 0);
});

test('Canvas 與 DOM 受擊震動都使用三秒冷卻並降低幅度', () => {
  const renderer = fs.readFileSync(path.join(root, 'js', 'battle-renderer.js'), 'utf8');
  const vfx = fs.readFileSync(path.join(root, 'js', 'vfx.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');

  assert.match(renderer, /var HIT_JOLT_COOLDOWN_MS = 3000/);
  assert.match(renderer, /hitAt - ent\.lastJoltAt >= HIT_JOLT_COOLDOWN_MS/);
  assert.doesNotMatch(renderer, /if \(strong && canJolt\) addShake\(4\)/);
  assert.match(renderer, /if \(strong && isSpecialScreenShakeSpec\(spec\)\) addShake\(5\)/);
  assert.match(renderer, /\* \(e\.joltX \|\| HIT_JOLT_X\)/);
  assert.match(renderer, /\* \(e\.joltY \|\| HIT_JOLT_Y\)/);
  assert.match(vfx, /var VFX_HIT_COOLDOWN_MS = 3000/);
  assert.match(vfx, /hitAt - card\._vfxHitLastAt < VFX_HIT_COOLDOWN_MS/);
  assert.match(css, /translate\(-1\.5px, 0\.5px\)/);
  assert.match(css, /translate\(-2\.5px, 1\.5px\)/);
  assert.doesNotMatch(css, /translate\(-5px, 3px\)/);
});
