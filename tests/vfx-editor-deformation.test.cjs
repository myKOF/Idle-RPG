'use strict';
/* ============================================================
   vfx-editor-deformation.test.cjs — 勾「啟用整體變形」時自動帶入的隨機變形參數

   受測對象：tools/vfx/editor/deformation-model.js（純計算）與 editor.js 的接線。

   為什麼要有這一份：舊的預設（x 軸、0～200、振幅 0、不鏡射）勾了等於沒勾，
   使用者在兩份落雷上一個一個欄位調了半天，回報「還是一樣」（2026-10-21）。
   建議值錯了不會報錯，只會安靜地「沒效果」或「範圍沒對到素材」，所以要用數字釘住。
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');
const D = require('../tools/vfx/editor/deformation-model.js');
const VFXCore = require('../js/vfx-core.js');

const SQUARE = { width: 512, height: 512 };
const sizeOf = () => SQUARE;

function sprite(id, x, y, sx, sy, extra) {
  return Object.assign({ id, type: 'sprite', assetId: 'a/' + id + '.png',
    position: { x, y }, scale: { x: sx, y: sy }, perspective: false }, extra || {});
}
function preset(layers) {
  return { schemaVersion: 1, id: 'test-bolt', duration: 0.5, loop: false, layers };
}

/* 一道落雷：三段主幹從 -600 疊到 0、一條分岔、地面閃光，素材都是 512 正方形 */
function bolt() {
  return preset([
    sprite('seg-a', 0, -500, 0.5, 0.4),          // y -602.4 ~ -397.6
    sprite('seg-b', 6, -300, 0.5, 0.4),          // y -402.4 ~ -197.6
    sprite('seg-c', 0, -100, 0.5, 0.4),          // y -202.4 ~ 2.4
    sprite('branch', 60, -350, 0.3, 0.1, { rotation: 0.6 }),
    sprite('flash', 0, 0, 0.7, 0.05),
    { id: 'sparks', type: 'particle', assetId: 'a/p.png', position: { x: 0, y: 0 }, perspective: false,
      emission: { mode: 'burst', count: 3 }, maxParticles: 3, lifetime: [0.2, 0.3],
      spawn: { shape: 'point' }, speed: [10, 20], direction: -90, spread: 90, gravity: { x: 0, y: 0 },
      startScale: [0.1, 0.1] }
  ]);
}

test('DEF-1 落雷：沿 y、範圍蓋住整道（頂端到地面）、中心線落在主幹上', function () {
  const s = D.suggest(bolt(), sizeOf);
  assert.strictEqual(s.axis, 'y');
  /* 包絡在兩端為 0：範圍要剛好包住素材，頂端與落點才不被甩開，中段才彎得到 */
  assert.strictEqual(s.start, -603, 'start＝最頂端（往外取整）');
  assert.strictEqual(s.end, 13, 'end＝地面閃光的下緣（往外取整）');
  assert.ok(Math.abs(s.pivot) < 12, '中心線要落在主幹附近，鏡射才不會把閃電甩到旁邊：' + s.pivot);
  assert.strictEqual(s.amplitude, Math.round((s.end - s.start) * D.AMPLITUDE_RATIO * 10) / 10);
  assert.ok(s.amplitude <= (s.end - s.start) * 0.15, 'Core 上限是範圍的 15%');
});

test('DEF-1B 勾下去就會隨機：有振幅、有鏡射、一半機率翻面', function () {
  const s = D.suggest(bolt(), sizeOf);
  /* 這三個任何一個是 0／false，隨機相位與鏡射就沒有東西可以作用——舊預設正是這樣 */
  assert.ok(s.amplitude > 0);
  assert.strictEqual(s.mirror, true);
  assert.strictEqual(s.mirrorChance, 0.5);
  assert.ok(s.widthJitter > 0 && s.widthJitter <= 0.15);
  /* 彎曲強度刻意不動（見模組說明）：拉直會把分岔一起收進主幹 */
  assert.strictEqual(s.bendStrengthMin, undefined);
  /* 不同種子抽出不同形狀——這才是使用者要的「每次都不一樣」 */
  const shapes = [11, 22, 33, 44, 55, 66].map(function (seed) {
    const w = { config: s };
    VFXCore.deformPoint(w, 0, 0, {});            // 預熱：確認公式吃得下
    const rng = VFXCore.makeRng(seed);
    w.phase = rng() * Math.PI * 2; w.mirror = rng() < s.mirrorChance ? -1 : 1; w.width = 1;
    const mid = VFXCore.deformPoint(w, 0, (s.start + s.end) / 2, {});
    return Math.round(mid.x);
  });
  assert.ok(new Set(shapes).size >= 4, '中段的橫向位移要隨種子變：' + shapes);
});

test('DEF-2 橫向的電弧：沿 x', function () {
  const p = preset([sprite('arc-a', -200, 0, 0.6, 0.2), sprite('arc-b', 200, 0, 0.6, 0.2)]);
  const s = D.suggest(p, sizeOf);
  assert.strictEqual(s.axis, 'x');
  assert.strictEqual(s.start, Math.floor(-200 - 153.6));
  assert.strictEqual(s.end, Math.ceil(200 + 153.6));
});

test('DEF-3 只放 Core 驗證會收的圖層，建議值一套上去就合法', function () {
  const p = bolt();
  p.layers.push(sprite('ring', 0, 0, 0.5, 0.5, { radiusProfile: { centerScale: 1 } }));
  p.layers.push(sprite('face', 0, -50, 0.2, 0.2, { followDirection: false }));
  p.layers.push(sprite('off', 0, -50, 0.2, 0.2, { enabled: false }));
  const s = D.suggest(p, sizeOf);
  assert.deepStrictEqual(s.layers, ['seg-a', 'seg-b', 'seg-c', 'branch', 'flash'],
    '粒子、radiusProfile、followDirection:false、停用的圖層都不能放');
  p.deformation = s;
  const r = VFXCore.validatePreset(p);
  assert.ok(r.ok, JSON.stringify(r.errors));
});

test('DEF-3B 畫面透視只關了一部分時，那幾層不能放（Core 會擋）', function () {
  const p = bolt();
  p.layers[0].perspective = true;                // 整份不再全部是 billboard
  const s = D.suggest(p, sizeOf);
  assert.ok(s.layers.indexOf('seg-a') >= 0, '開著透視的那一層可以變形');
  assert.strictEqual(s.layers.indexOf('seg-b'), -1, '關了透視、但不是整份都關 → 不能放');
  p.deformation = s;
  assert.ok(VFXCore.validatePreset(p).ok);
});

test('DEF-3C 沒有任何 sprite 時回傳 null（編輯器據此提示，不寫入壞資料）', function () {
  const p = bolt();
  p.layers = p.layers.filter(function (l) { return l.type !== 'sprite'; });
  assert.strictEqual(D.suggest(p, sizeOf), null);
});

test('DEF-4 父物件底下的圖層用它在特效座標裡的位置', function () {
  const p = preset([sprite('seg', 0, -100, 0.2, 0.4)]);
  const moved = D.suggest(p, sizeOf, function () { return { a: 1, b: 0, c: 0, d: 1, tx: 300, ty: -200 }; });
  const plain = D.suggest(p, sizeOf);
  assert.strictEqual(moved.start, plain.start - 200);
  assert.strictEqual(moved.pivot, plain.pivot + 300);
});

test('DEF-4B 轉過的圖層用轉完之後的外框（直條轉 90° 就是橫的）', function () {
  const p = preset([sprite('seg', 0, 0, 0.2, 0.8, { rotation: Math.PI / 2 })]);
  const s = D.suggest(p, sizeOf);
  assert.strictEqual(s.axis, 'x');
  assert.strictEqual(s.start, -205);              // 512 × 0.8 / 2 = 204.8
  assert.strictEqual(s.end, 205);
});

test('DEF-5 每一份正式 Preset 套上建議值都通過 Core 驗證', function () {
  /* 不釘任何一份的內容（使用者會重編），只驗「建議值永遠合法」這個性質 */
  const idx = JSON.parse(fs.readFileSync(path.join(REPO, 'vfx/asset-index.json'), 'utf8'));
  const dims = {};
  (idx.assets || []).forEach(function (a) { const d = a.facts && a.facts.dimensions; if (d) dims[a.assetId] = d; });
  const dir = path.join(REPO, 'vfx/presets');
  let checked = 0;
  fs.readdirSync(dir).filter(function (f) { return /\.json$/.test(f); }).forEach(function (f) {
    const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const s = D.suggest(p, function (l) { return dims[l.assetId] || null; });
    if (!s) return;
    p.deformation = s;
    const r = VFXCore.validatePreset(p);
    assert.ok(r.ok, f + '：' + JSON.stringify(r.errors));
    checked++;
  });
  assert.ok(checked > 50, '至少要真的驗到一批：' + checked);
});

test('DEF-6 編輯器勾選時用建議值，沒有可變形圖層就不寫入', function () {
  const src = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  const at = src.indexOf("enabled.setAttribute('data-code-control', 'deformation.enabled')");
  const body = src.slice(at, src.indexOf("defBox.appendChild(makeField('啟用整體變形'", at));
  assert.ok(/VFXDeformationModel\.suggest\(p, sizeOf, spaceOf\)/.test(body), '用與 Gizmo 同一套尺寸與父層座標');
  assert.ok(/if \(!def\) \{[\s\S]*?enabled\.checked = false;[\s\S]*?return;/.test(body), '量不出來就退回未勾');
  assert.ok(!/amplitude:0/.test(body), '舊的「振幅 0」預設不能留著');

  const html = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/index.html'), 'utf8');
  const gizmo = html.indexOf('/tools/vfx/editor/gizmo-model.js');
  const model = html.indexOf('/tools/vfx/editor/deformation-model.js');
  const editor = html.indexOf('/tools/vfx/editor/editor.js');
  assert.ok(gizmo >= 0 && model > gizmo && editor > model, '載入順序：gizmo-model → deformation-model → editor');
});

/* ============================================================
   各圖層的「受程式變形影響」（2026-10-21 使用者：開了隨機鏡射，選到的圖層卻完全沒變——
   它沒有被勾進作用圖層，而變形參數放在 Inspector 裡看起來像那個圖層自己的設定）
   ============================================================ */

function extractFn(src, name) {
  const at = src.indexOf('function ' + name + '(');
  assert.ok(at >= 0, '找不到 function ' + name);
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error(name + ' 的大括號沒有配對');
}

function membershipSandbox(p) {
  const vm = require('node:vm');
  const calls = { commit: [], render: 0, validation: [] };
  const host = { children: [], appendChild(el) { this.children.push(el); } };
  const el = () => ({ attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, checked: false, indeterminate: false, disabled: false, title: '' });
  const ctx = {
    state: { preset: p }, VFXDeformationModel: D,
    document: { createElement: el },
    makeField: (label, control) => ({ label, control }),
    commitCodeControl: (path, v) => { calls.commit.push([path.join('.'), v]); p.deformation.layers = v; return true; },
    renderInspector: () => { calls.render++; },
    setValidation: (cls, text) => calls.validation.push(text)
  };
  vm.createContext(ctx);
  const src = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  vm.runInContext(extractFn(src, 'deformationBlockReason') + '\n' + extractFn(src, 'renderDeformationMembership'), ctx);
  return {
    calls,
    render(targets) { host.children.length = 0; ctx.renderDeformationMembership(host, targets); return host.children[0]; }
  };
}

test('DEF-7 選到沒加入的圖層：勾選框未勾，勾下去就加進作用圖層', function () {
  const p = bolt();
  p.deformation = D.suggest(p, sizeOf);
  p.deformation.layers = ['seg-a', 'seg-b', 'seg-c'];
  const sb = membershipSandbox(p);
  const branch = p.layers.find(l => l.id === 'branch');
  const field = sb.render([branch]);
  assert.strictEqual(field.label, '受程式變形影響');
  assert.strictEqual(field.control.checked, false);
  assert.strictEqual(field.control.disabled, false);
  field.control.checked = true;
  field.control.onchange();
  assert.deepStrictEqual(sb.calls.commit, [['deformation.layers', ['seg-a', 'seg-b', 'seg-c', 'branch']]]);
  assert.strictEqual(sb.calls.render, 1, '重畫，下方清單與這一格同步');
  assert.strictEqual(sb.render([branch]).control.checked, true);
});

test('DEF-7B 取消勾選就移出；最後一層不能拿掉（Core 不收空清單），改提示去上面關', function () {
  const p = bolt();
  p.deformation = D.suggest(p, sizeOf);
  p.deformation.layers = ['seg-a', 'branch'];
  const sb = membershipSandbox(p);
  const branch = p.layers.find(l => l.id === 'branch');
  let f = sb.render([branch]);
  f.control.checked = false; f.control.onchange();
  assert.deepStrictEqual(sb.calls.commit.pop(), ['deformation.layers', ['seg-a']]);
  const segA = p.layers.find(l => l.id === 'seg-a');
  f = sb.render([segA]);
  f.control.checked = false; f.control.onchange();
  assert.strictEqual(sb.calls.commit.length, 0, '不送出空清單');
  assert.strictEqual(f.control.checked, true, '勾選框回到勾著');
  assert.ok(/啟用整體變形/.test(sb.calls.validation[0]), '告訴使用者去哪裡關');
});

test('DEF-7C 多選：一半在裡面顯示半勾，勾下去把能變形的全部加進來、不能變形的不動', function () {
  const p = bolt();
  p.layers.push(sprite('ring', 0, 0, 0.5, 0.5, { radiusProfile: { centerScale: 1 } }));
  p.deformation = D.suggest(p, sizeOf);
  p.deformation.layers = ['seg-a', 'seg-b'];
  const sb = membershipSandbox(p);
  const pick = ids => p.layers.filter(l => ids.indexOf(l.id) >= 0);
  const f = sb.render(pick(['seg-b', 'branch', 'flash', 'ring', 'sparks']));
  assert.strictEqual(f.control.indeterminate, true);
  f.control.checked = true; f.control.onchange();
  const got = sb.calls.commit[0][1];
  assert.deepStrictEqual(got.slice().sort(), ['branch', 'flash', 'seg-a', 'seg-b'], '粒子與 radiusProfile 不加：' + got);
});

test('DEF-7D 不顯示／變灰：粒子層沒有這一格；還沒啟用變形時變灰並指路', function () {
  const p = bolt();
  const sb = membershipSandbox(p);
  assert.strictEqual(sb.render([p.layers.find(l => l.type === 'particle')]), undefined, '粒子層不顯示');
  const f = sb.render([p.layers[0]]);
  assert.strictEqual(f.control.disabled, true, '還沒啟用程式變形');
  assert.ok(/啟用整體變形/.test(f.control.title));
  p.layers.push(sprite('ring', 0, 0, 0.5, 0.5, { radiusProfile: { centerScale: 1 } }));
  p.deformation = D.suggest(p, sizeOf);
  const ring = sb.render([p.layers[p.layers.length - 1]]);
  assert.strictEqual(ring.control.disabled, true);
  assert.ok(/radiusProfile/.test(ring.control.title), '說明為什麼不能變形');
});

test('DEF-7E Inspector：參數區標明整份共用；圖層欄位前有分界標題與這一格', function () {
  const src = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  assert.ok(/section\('程式變形／隨機鏡射（整份特效共用）'/.test(src));
  const ins = extractFn(src, 'renderInspector');
  const header = ins.indexOf('renderLayerHeader(host, targets[0])');
  const member = ins.indexOf('renderDeformationMembership(host, targets)');
  const fields = ins.indexOf('inspectorFields(targets)');
  assert.ok(header > 0 && member > header && fields > member, '分界標題 → 受程式變形影響 → 圖層欄位');
  assert.ok(/layer-head/.test(extractFn(src, 'renderLayerHeader')));
  const css = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.css'), 'utf8');
  assert.ok(/\.group-title\.layer-head\s*\{[^}]*border-top/.test(css), '分界要看得出來');
});
