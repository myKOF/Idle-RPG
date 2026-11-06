const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../js/start-menu-background.js'), 'utf8');
const noop = () => {};

test('減少動態時背景緩慢前進，分頁隱藏後才停播', () => {
  const pending = new Map();
  let nextFrame = 0, observeVisibility, pageVisibilityChanged;
  const motion = { matches: true, addEventListener: noop, removeEventListener: noop };
  function element() {
    const xOffsets = [];
    const context = new Proxy({
      clearRect() { xOffsets.length = 0; },
      translate(x) { xOffsets.push(x); },
      createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
      createRadialGradient() { return { addColorStop: noop }; },
      createLinearGradient() { return { addColorStop: noop }; }
    }, { get: (target, name) => target[name] ?? noop });
    return {
      style: {}, children: [], isConnected: true, xOffsets,
      getContext: () => context, setAttribute: noop, remove: noop,
      appendChild(child) { this.children.push(child); }
    };
  }
  const document = {
    currentScript: { src: 'http://localhost/js/start-menu-background.js' },
    hidden: false, createElement: element, removeEventListener: noop,
    addEventListener(event, fn) { if (event === 'visibilitychange') pageVisibilityChanged = fn; }
  };
  const browser = {
    URL, document, window: { matchMedia: () => motion },
    Image: function () { return { ...element(), decode: () => Promise.reject(new Error('No image in fixture')) }; },
    Path2D: class {},
    ResizeObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class {
      constructor(fn) { observeVisibility = fn; }
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame(fn) {
      pending.set(++nextFrame, fn);
      return nextFrame;
    },
    cancelAnimationFrame(id) { pending.delete(id); }
  };
  vm.runInNewContext(source, browser);
  const host = element();
  const backdrop = browser.StartMenuBackground.mount(host);
  const surface = host.children[0].children[1];
  function next(timestamp) {
    assert.equal(pending.size, 1);
    const [[id, draw]] = pending;
    pending.delete(id);
    draw(timestamp);
    return surface.xOffsets[0];
  }

  observeVisibility([{ isIntersecting: true }]);
  const first = next(1000);
  const reduced = next(1100) - first;
  assert.ok(reduced > 0, '減少動態時地平雲仍向右移動');

  motion.matches = false;
  const normal = next(1200) - (first + reduced);
  assert.ok(normal > reduced, '切換偏好後恢復一般速度');

  document.hidden = true;
  pageVisibilityChanged();
  assert.equal(pending.size, 0);
  document.hidden = false;
  pageVisibilityChanged();
  const resumed = next(5000);
  assert.ok(Math.abs(resumed - (first + reduced + normal)) < .001, '恢復時不跳過暫停區間');

  backdrop.destroy();
  assert.equal(pending.size, 0);
});
