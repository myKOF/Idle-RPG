// 把 js/battle-renderer.js 的 buildScene 挖出來，用一份假的 PIXI 跑，回傳真正組出來的場景樹。
// 用途：驗圖層的相對順序與各層的投影縮放——這兩件事壞掉時畫面不會報錯，只會安靜地畫錯。
const assert = require('node:assert/strict');
const vm = require('node:vm');

/* 從原始碼挖出 `function NAME(...) { ... }` 整段（大括號配對）。 */
function extractFunction(src, name) {
  const head = src.indexOf('function ' + name + '(');
  assert.notEqual(head, -1, '找不到函式 ' + name + '——改名了就要同步更新測試');
  let i = src.indexOf('{', head);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(head, i + 1);
    }
  }
  throw new Error(name + ' 的大括號沒有配對');
}

/* 斜俯視投影的壓縮比，讀原始碼裡的實際值。 */
function groundYScale(renderer) {
  const m = /var GROUND_Y_SCALE = ([0-9.]+);/.exec(renderer);
  assert.ok(m, '找不到 var GROUND_Y_SCALE');
  return Number(m[1]);
}
/* 斜俯視相關常數（var GROUND_* = …;）整行搬進 vm，值與原始碼一致。 */
function groundDecls(renderer) {
  const lines = renderer.match(/^ *var GROUND_[A-Z_]+ = [^;\n]+;/gm);
  assert.ok(lines && lines.length, '找不到 var GROUND_* 常數');
  return lines.join('\n') + '\n';
}

function point(x, y) {
  return { x, y, set(a, b) { this.x = a; this.y = (b === undefined ? a : b); } };
}
class Container {
  constructor() {
    this.children = []; this.parent = null;
    this.x = 0; this.y = 0; this.scale = point(1, 1); this.visible = true;
  }
  addChild(c) { if (c.parent) c.parent.removeChild(c); this.children.push(c); c.parent = this; return c; }
  addChildAt(c, i) { if (c.parent) c.parent.removeChild(c); this.children.splice(i, 0, c); c.parent = this; return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parent = null; return c; }
  get position() { const self = this; return { set(x, y) { self.x = x; self.y = y; } }; }
  destroy() { if (this.parent) this.parent.removeChild(this); this.destroyed = true; }
}
class PerspectiveMesh extends Container {
  constructor(o) { super(); this.texture = o.texture; this.corners = null; }
  setCorners(...c) { this.corners = c; }
}
const RenderTexture = {
  create(o) { return { width: o.width, height: o.height, resolution: o.resolution, antialias: o.antialias, destroy() { this.destroyed = true; } }; }
};
class TilingSprite extends Container {
  constructor(o) {
    super();
    this.texture = o && o.texture; this.width = o && o.width; this.height = o && o.height;
    this.tileScale = point(1, 1); this.tilePosition = point(0, 0); this.tileRotation = 0;
  }
}
class Sprite extends Container {
  constructor(tex) { super(); this.texture = tex; this.anchor = point(0, 0); }
}
class Graphics extends Container {
  rect() { return this; } fill() { return this; } clear() { return this; } ellipse() { return this; }
}
class Text extends Container {
  constructor(o) { super(); this.text = o && o.text; this.anchor = point(0, 0); }
}

function buildSceneTree(renderer) {
  const S = { app: { stage: new Container() }, W: 800, H: 500 };
  const ctx = {
    S, Math,
    PIXI: { Container, TilingSprite, Sprite, Graphics, Text, PerspectiveMesh, RenderTexture, Texture: { from: () => ({}) } },
    document: { createElement: () => ({ width: 0, height: 0, getContext: () => ({}) }) },
    groundFallbackTexture: () => ({}), loadGroundTexture() {}, vignetteTexture: () => ({}),
    drawDeathFog() {}, layoutScene() {}
  };
  vm.createContext(ctx);
  vm.runInContext(groundDecls(renderer) + extractFunction(renderer, 'buildScene'), ctx);
  ctx.buildScene();
  return S;
}

/* node 相對於 world 的縱向／橫向總縮放（node 自己算進去、world 不算）。 */
function scaleToWorld(node, world) {
  let sx = 1, sy = 1;
  for (let n = node; n && n !== world; n = n.parent) { sx *= n.scale.x; sy *= n.scale.y; }
  return { x: sx, y: sy };
}

/* world 底下的繪製順序（深度優先，先畫的在前）。 */
function drawOrder(world) {
  const out = [];
  (function walk(n) { for (const c of n.children) { out.push(c); walk(c); } })(world);
  return out;
}

module.exports = {
  extractFunction, groundYScale, groundDecls, buildSceneTree, scaleToWorld, drawOrder,
  fakePixi: { Container, TilingSprite, Sprite, Graphics, Text, PerspectiveMesh, RenderTexture }
};
