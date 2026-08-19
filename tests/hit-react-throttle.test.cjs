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
  const cardAdded = [];
  const removed = [];
  const visual = {
    classList: {
      add(...values) { added.push(...values); },
      remove(value) { removed.push(value); }
    }
  };
  const card = {
    classList: {
      add(...values) { cardAdded.push(...values); },
      remove(value) { removed.push(value); }
    },
    querySelector() { return visual; }
  };
  const context = loadVfxContext(card);

  context.vfxHitReact('mv-float-1', 'fire', 0, false);
  context.vfxHitReact('mv-float-1', 'fire', 0, true);

  assert.equal(card._vfxHitLastAt > 0, true);
  assert.equal(added.filter((value) => value === 'vfx-hit').length, 1);
  assert.equal(added.filter((value) => value === 'vfx-hit-strong').length, 0);
  assert.equal(cardAdded.length, 0);
  assert.ok(removed.length > 0);
});

test('Canvas 與 DOM 受擊震動都使用三秒冷卻並降低幅度', () => {
  const renderer = fs.readFileSync(path.join(root, 'js', 'battle-renderer.js'), 'utf8');
  const vfx = fs.readFileSync(path.join(root, 'js', 'vfx.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');

  assert.match(renderer, /var HIT_JOLT_COOLDOWN_MS = 3000/);
  assert.match(renderer, /hitAt - ent\.lastJoltAt >= HIT_JOLT_COOLDOWN_MS/);
  assert.doesNotMatch(renderer, /if \(strong && canJolt\) addShake\(4\)/);
  assert.match(renderer, /function addMeteorCameraShake\(\)/);
  assert.match(renderer, /S\.shake = Math\.min\(18, Math\.max\(S\.shake, 14\)\)/);
  assert.match(renderer, /function addShake\(px, spec\)[\s\S]*?if \(!isSpecialScreenShakeSpec\(spec\)\) return;/);
  assert.match(renderer, /if \(strong\) addShake\(5, spec\)/);
  assert.match(renderer, /if \(isMega \|\| isPurple\) \{[\s\S]*?addShake\(isPurple \? 5 : 3, spec\)/);
  assert.doesNotMatch(renderer, /if \(isMega \|\| isPurple\) addShake\(/);
  assert.match(renderer, /e\.bodyWrap\.x = e\.jolt > 0/);
  assert.match(renderer, /e\.bodyWrap\.y = e\.jolt > 0/);
  assert.match(renderer, /p\.bodyWrap\.x \+= p\.jolt > 0/);
  assert.match(vfx, /var VFX_HIT_COOLDOWN_MS = 3000/);
  assert.match(vfx, /hitAt - card\._vfxHitLastAt < VFX_HIT_COOLDOWN_MS/);
  assert.match(vfx, /function vfxHitVisualTarget\(elId, card\)/);
  assert.match(vfx, /visual\.classList\.add\('vfx-hit-target'\)/);
  assert.match(vfx, /if \(!suppressShake\) visual\.classList\.add\('vfx-hit'\)/);
  assert.match(vfx, /function vfxAllowsSceneShake\(spec\)/);
  assert.match(vfx, /vfx-scene-shake-meteor/);
  assert.match(vfx, /vfxSceneShake\(layer, delayMs, false, spec\)/);
  assert.match(css, /translate\(-1\.5px, 0\.5px\)/);
  assert.match(css, /translate\(-2\.5px, 1\.5px\)/);
  assert.match(css, /\.vfx-hit-target\.vfx-hit\s*\{/);
  assert.doesNotMatch(css, /\.enemy-card\.vfx-hit|\.combatant\.vfx-hit/);
  assert.doesNotMatch(css, /translate\(-5px, 3px\)/);
});
