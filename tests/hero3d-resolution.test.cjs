'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../js/hero3d.js'), 'utf8');

test('提高角色畫布解析度保持顯示大小、腳底錨點與輪廓寬度，逐幀標記仍更新', () => {
  const measurements = [];
  for (const size of [512, 1024, 1536]) {
    const draws = [], uploads = [];
    const context = { clearRect() {}, fillRect() {}, drawImage(canvas, x, y) { draws.push([x, y]); } };
    class Sprite {
      constructor(texture) {
        this.texture = texture;
        this.anchor = { set(x, y) { this.x = x; this.y = y; } };
      }
    }
    const sandbox = { document: { createElement: () => ({ getContext: () => context }) },
      PIXI: { Sprite, Texture: { from: canvas => ({ source: { update: () => uploads.push(canvas) } }) } } };
    vm.runInNewContext(source, sandbox);
    let updates = 0;
    const ctrl = { size, pxPerMeter: size / 4.4, anchorY: .6968239554055542,
      canvas: { width: size, height: size }, update() { updates++; } };
    const body = sandbox.Hero3D.makeBody(ctrl), scale = sandbox.Hero3D.displayScale(ctrl);
    assert.equal(body.hero3dFrame, 0);
    body.update(null, 0);
    assert.equal(updates, 1);
    assert.equal(body.hero3dFrame, 1, '共用3D光暈必須知道貼圖已更新');
    assert.equal(uploads.length, 2, '身體與輪廓皆更新');
    assert.equal(draws.length, 9, '八方向外擴後挖去本體');
    assert.equal(body.anchor.y, ctrl.anchorY);
    measurements.push({ width: size * scale, height: size * scale,
      foot: ctrl.anchorY * size * scale,
      radius: Math.max(...draws.map(([x, y]) => Math.hypot(x, y))) * scale });
  }
  for (const measurement of measurements.slice(1)) for (const key of ['width', 'height', 'foot', 'radius']) {
    assert.ok(Math.abs(measurement[key] - measurements[0][key]) < 1e-9, key + ' 不應隨內部解析度改變');
  }
});
