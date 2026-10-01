'use strict';
/* ============================================================
   vfx-preset-cost.test.cjs — 單一特效的效能成本估算

   受測對象：
     tools/vfx/preset-cost.cjs        估算本身（純函式）
     tools/vfx/editor/editor.js       每個預覽視窗右上角的顯示與快取
     tools/vfx/editor-server.cjs      這支 .cjs 要能被編輯器頁面載到

   這一份最重要的一條是 COST-1：**拿真的 Core 跑一遍對答案**。
   估算如果和實際的節點數對不上，顯示出來的數字只是裝飾，而且會誤導做特效的人
   往錯的方向改。所以不是驗「公式有沒有被改動」，是驗「它還準不準」。

   2026-10-01 使用者要求：在每個特效的預覽上方顯示效能參考值，超過門檻轉橘色。
   係數來自 2026-09-30 的實機量測（見 preset-cost.cjs 檔頭）。
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');
const Cost = require('../tools/vfx/preset-cost.cjs');
const Core = require('../js/vfx-core.js');

const PRESET_DIR = path.join(REPO, 'vfx/presets');
const ASSET_INDEX = JSON.parse(fs.readFileSync(path.join(REPO, 'vfx/asset-index.json'), 'utf8'));
const sizeOf = Cost.sizeLookup(ASSET_INDEX.assets);
const ALL = fs.readdirSync(PRESET_DIR).filter(function (f) { return f.slice(-5) === '.json'; });

function read(file) {
  return JSON.parse(fs.readFileSync(path.join(PRESET_DIR, file), 'utf8'));
}

/* 真的跑一次 Core，回傳「同時存在的節點數」的峰值。後端只數節點，不畫任何東西。 */
function peakNodesFromCore(preset) {
  const live = new Set();
  const backend = {
    createNode(spec) { const n = { spec: spec, visible: true }; live.add(n); return n; },
    updateNode(n, t) { n.visible = !t || t.visible !== false; },
    destroyNode(n) { live.delete(n); }
  };
  const rt = Core.createRuntime({
    backend: backend,
    resolver: { has: () => true, resolve: (id) => id },
    /* 與遊戲同一組上限（js/vfx-runtime.js 的 FX_BUDGET），否則測試會量到預設值的節流 */
    budget: { maxActiveEffects: 65536, maxParticles: 64000, perEffectParticleLimit: 2000 }
  });
  rt.registerPreset(preset);
  rt.play(preset.id, { position: { x: 0, y: 0 } });
  const dt = 1 / 60;
  const seconds = preset.loop ? Math.min(6, (preset.duration || 1) * 2) : (preset.duration || 1) + 0.3;
  let peak = 0;
  for (let t = 0; t < seconds; t += dt) {
    rt.update(dt);
    let visible = 0;
    live.forEach(function (n) { if (n.visible) visible++; });
    if (visible > peak) peak = visible;
  }
  rt.destroy();
  return peak;
}

test('COST-1 估算的節點數與真的跑一遍 Core 對得上（全部正式 preset）', function () {
  /* 容許範圍不是隨便訂的：模型用平均壽命算穩態顆數，而實際顆數是整數、會上下跳一顆，
     小特效（3～4 個節點）因此天生就有 ±25% 的量化誤差。節點多的那些反而最準。
     不寫死是哪幾份 preset——使用者隨時會改特效，這條驗的是「模型還準不準」。 */
  const bad = [];
  let exact = 0;
  ALL.forEach(function (file) {
    const preset = read(file);
    const est = Cost.estimate(preset, { assetSize: sizeOf }).nodes;
    const actual = peakNodesFromCore(preset);
    if (actual === 0) return;                       // 空特效：沒有東西可比
    const ratio = est / actual;
    if (est === actual) exact++;
    /* 絕對值差 1 個節點以內的一律放行：那是整數量化，不是模型錯 */
    if (Math.abs(est - actual) <= 1) return;
    if (ratio < 0.75 || ratio > 1.25) {
      bad.push(preset.id + '：估 ' + est + '、實際 ' + actual + '（×' + ratio.toFixed(2) + '）');
    }
  });
  assert.deepEqual(bad, [], '這幾份的估算與實際差太多，模型要修（不是改測試）');
  assert.ok(exact / ALL.length > 0.6,
    '應該有六成以上完全命中，實際 ' + exact + '/' + ALL.length + '——差太多代表模型走偏了');
});

test('COST-2 分數＝節點數 × 每節點成本 ＋ 填色，係數就是量測來的那幾個', function () {
  assert.equal(Cost.NODE_US, 3.9, '每個節點每幀 3.9µs：Core 0.64＋後端寫入 1.1＋渲染 2.1');
  assert.equal(Cost.WARN_US, 250, '門檻 0.25ms');
  /* 填色係數要真的有值：歸零的話大面積加色的那一類在畫面上完全沒有代價，
     而那正是 GPU 這一側唯一的訊號（2026-09-30：60 份疊在同處約 10ms）。 */
  assert.equal(Cost.FILL_US_PER_SCREEN, 21, '一個畫面的填色 21µs');

  /* 10 張圖、沒有素材尺寸可查 → 純 CPU 的部分就是 10 × 3.9µs */
  const flat = { schemaVersion: 1, id: 'cost-flat', duration: 1, layers: [] };
  for (let i = 0; i < 10; i++) flat.layers.push({ id: 'l' + i, type: 'sprite', assetId: 'a.png' });
  const c = Cost.estimate(flat, { assetSize: () => null });
  assert.equal(c.nodes, 10);
  assert.ok(Math.abs(c.cpuUs - 39) < 1e-6, 'CPU 成本＝節點數 × NODE_US');
  assert.deepEqual(c.byType, { sprite: 10, particle: 0, procedural: 0, empty: 0 });

  /* 變形圖層（閃電那種）是 Mesh：同樣一個節點要算得重一些 */
  const mesh = JSON.parse(JSON.stringify(flat));
  mesh.deformation = { axis: 'y', start: 0, end: 100, amplitude: 5, widthJitter: 0.05, mirror: false, layers: ['l0'] };
  const m = Cost.estimate(mesh, { assetSize: () => null });
  assert.ok(m.cpuUs > c.cpuUs, '變形圖層要比一般 sprite 貴');
  assert.ok(Math.abs(m.cpuUs - (9 + Cost.MESH_WEIGHT) * Cost.NODE_US) < 1e-6);

  /* 填色：覆蓋一個畫面就是 FILL_US_PER_SCREEN */
  const big = { schemaVersion: 1, id: 'cost-fill', duration: 1,
    layers: [{ id: 'l0', type: 'sprite', assetId: 'big.png' }] };
  const side = Math.sqrt(Cost.SCREEN_PX);
  const f = Cost.estimate(big, { assetSize: () => ({ width: side, height: side }) });
  assert.ok(Math.abs(f.coverage - 1) < 1e-6, '整個畫面那麼大的一張圖＝覆蓋 1 個畫面');
  assert.ok(Math.abs(f.fillUs - Cost.FILL_US_PER_SCREEN) < 1e-6);
  /* 序列幀要除掉格數：整張圖集不是一次畫出來的那個大小 */
  big.layers[0].sheet = { columns: 4, rows: 4 };
  const sheet = Cost.estimate(big, { assetSize: () => ({ width: side, height: side }) });
  assert.ok(Math.abs(sheet.coverage - 1 / 16) < 1e-6, '4×4 的圖集，一格只有十六分之一');

  /* 繪製批次：blendMode 換一次就斷一批（實測 hit-gale-burst 60 份 ＝ 181 次 draw）。
     照 zIndex 排，不是照寫在檔案裡的順序。 */
  const mixed = { schemaVersion: 1, id: 'cost-blend', duration: 1, layers: [
    { id: 'a', type: 'sprite', assetId: 'a.png', zIndex: 0, blendMode: 'add' },
    { id: 'b', type: 'sprite', assetId: 'a.png', zIndex: 1, blendMode: 'normal' },
    { id: 'c', type: 'sprite', assetId: 'a.png', zIndex: 2, blendMode: 'add' }
  ] };
  assert.equal(Cost.estimate(mixed, { assetSize: () => null }).batches, 3, '夾心排法要斷三批');
  mixed.layers[1].blendMode = 'add';
  assert.equal(Cost.estimate(mixed, { assetSize: () => null }).batches, 1, '全部同一種就只有一批');
  mixed.layers[2].zIndex = -1;
  assert.equal(Cost.estimate(mixed, { assetSize: () => null }).batches, 1);
});

test('COST-3 峰值取自時間軸：錯開的圖層不相加', function () {
  /* 兩張圖一前一後，從頭到尾同時最多只有一張。把各層峰值相加會算成 2。 */
  const relay = { schemaVersion: 1, id: 'cost-relay', duration: 2, layers: [
    { id: 'a', type: 'sprite', assetId: 'a.png', duration: 1 },
    { id: 'b', type: 'sprite', assetId: 'a.png', delay: 1.2, duration: 2 }
  ] };
  assert.equal(Cost.estimate(relay, { assetSize: () => null }).nodes, 1);

  const together = JSON.parse(JSON.stringify(relay));
  together.layers[1].delay = 0;
  assert.equal(Cost.estimate(together, { assetSize: () => null }).nodes, 2, '同時開著就要相加');

  /* 一次噴完的粒子：峰值是 count，之後逐漸死掉 */
  const burst = { schemaVersion: 1, id: 'cost-burst', duration: 1, layers: [
    { id: 'p', type: 'particle', assetId: 'a.png',
      emission: { mode: 'burst', count: 40 }, lifetime: [0.2, 0.4] }
  ] };
  assert.equal(Cost.estimate(burst, { assetSize: () => null }).nodes, 40);
  assert.equal(Cost.aliveAt(burst.layers[0], 0, burst, {}), 40, '剛噴出來全部都在');
  assert.equal(Cost.aliveAt(burst.layers[0], 0.5, burst, {}), 0, '最長壽命之後一顆都不剩');
  assert.ok(Cost.aliveAt(burst.layers[0], 0.3, burst, {}) < 40, '中間逐漸凋零');

  /* 持續發射：穩態＝發射率 × 平均壽命，而且吃得到 maxParticles 的上限 */
  const rate = { schemaVersion: 1, id: 'cost-rate', duration: 3, layers: [
    { id: 'p', type: 'particle', assetId: 'a.png',
      emission: { mode: 'rate', rate: 100 }, lifetime: [0.4, 0.6] }
  ] };
  assert.equal(Cost.estimate(rate, { assetSize: () => null }).nodes, 50, '100 顆／秒 × 平均 0.5 秒');
  rate.layers[0].maxParticles = 20;
  assert.equal(Cost.estimate(rate, { assetSize: () => null }).nodes, 20, 'maxParticles 要夾得住');
});

test('COST-4 子發射器：母層死了才出現，不與母層的峰值相加', function () {
  /* 母層的死亡散在 1.6 秒裡，餘燼只活 0.1 秒：同時存在的餘燼只有一兩顆，
     不是「母層總共死掉的 10 顆」。把累計數當成同時數會算成兩倍。 */
  const sub = { schemaVersion: 1, id: 'cost-sub', duration: 2.4, layers: [
    { id: 'seed', type: 'particle', assetId: 'a.png',
      emission: { mode: 'burst', count: 10 }, lifetime: [0.4, 2],
      subEmitter: { layer: 'puff', on: 'death', count: 1 } },
    { id: 'puff', type: 'particle', assetId: 'a.png',
      emission: { mode: 'sub' }, lifetime: [0.1, 0.1] }
  ] };
  const c = Cost.estimate(sub, { assetSize: () => null });
  assert.ok(c.nodes >= 10, '至少要算得出母層那 10 顆');
  assert.ok(c.nodes <= 11,
    '餘燼一次只有一兩顆（死亡散在 1.6 秒、每顆只活 0.1 秒），實際算成 ' + c.nodes);
  /* 一開始餘燼還沒出生 */
  assert.equal(Cost.aliveAt(sub.layers[1], 0, sub, {}), 0);

  /* 母層持續發射時更明顯：到第 3 秒總共死了 250 顆，但同時存在的餘燼永遠只有
     「最近 0.1 秒死的那些」。把累計數當成同時數會算成 300 個節點。 */
  const stream = { schemaVersion: 1, id: 'cost-sub-stream', duration: 3, layers: [
    { id: 'seed', type: 'particle', assetId: 'a.png',
      emission: { mode: 'rate', rate: 100 }, lifetime: [0.4, 0.6],
      subEmitter: { layer: 'puff', on: 'death', count: 1 } },
    { id: 'puff', type: 'particle', assetId: 'a.png',
      emission: { mode: 'sub' }, lifetime: [0.1, 0.1] }
  ] };
  const s = Cost.estimate(stream, { assetSize: () => null });
  assert.ok(s.nodes >= 55 && s.nodes <= 70,
    '母層 50 顆＋最近死掉的約 10 顆，實際算成 ' + s.nodes);
});

test('COST-5 門檻訂在「整個素材庫的少數幾份」，不是人人都橘色', function () {
  /* 會變橘的比例要落在一個合理的帶狀區間：全綠等於沒有提醒，全橘等於狼來了。
     不釘死某一份 preset 的分數——使用者會改特效，改重了本來就該變橘。 */
  const scores = ALL.map(function (f) { return Cost.estimate(read(f), { assetSize: sizeOf }); });
  const warn = scores.filter(function (c) { return c.level === 'warn'; }).length;
  const pct = warn / scores.length * 100;
  assert.ok(pct >= 2 && pct <= 25, '橘色佔 ' + pct.toFixed(0) + '%，門檻需要重新檢討');
  const ms = scores.map(function (c) { return c.ms; }).sort(function (a, b) { return a - b; });
  const median = ms[Math.floor(ms.length / 2)];
  assert.ok(median * 1000 < Cost.WARN_US, '中位數（' + median.toFixed(3) + 'ms）不該超過門檻');
  console.log('    · 成本中位 ' + median.toFixed(3) + 'ms、最重 ' + ms[ms.length - 1].toFixed(2) +
    'ms、橘色 ' + warn + '/' + scores.length);
});

test('COST-6 編輯器接線：每個視窗都有、改了才重算、滑過去看明細', function () {
  const editor = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  const bodyOf = function (name) {
    const fn = editor.slice(editor.indexOf('function ' + name + '('));
    return fn.slice(0, fn.indexOf('\n  }'));
  };
  assert.ok(/el\.appendChild\(buildPaneCost\(pane\)\)/.test(bodyOf('createPane')),
    '每個預覽視窗都要有一個（不是只有多視窗時才有的那條標籤）');
  assert.ok(/renderPaneCost\(pane\)/.test(bodyOf('renderPaneHead')), '跟著視窗標籤一起更新');
  assert.ok(/showCostTip\(pane, el\)/.test(bodyOf('buildPaneCost')), '滑過去看明細');

  /* 快取：refreshDirty 在拖曳時每幀都會進來，每幀把整條時間軸跑一遍會拖垮編輯器 */
  const cache = bodyOf('paneCost');
  assert.ok(/pane\.costCache\.doc !== doc \|\| pane\.costCache\.token !== token/.test(cache),
    '換 doc 或 token 變了才重算');
  assert.ok(/ctx\.costToken = \(ctx\.costToken \|\| 0\) \+ 1;/.test(bodyOf('onPresetChanged')),
    'preset 改了要讓快取失效');

  /* 算法只能有一份：編輯器不得自己抄一份係數 */
  assert.ok(/VFXPresetCost\.estimate\(/.test(editor), '編輯器用共用模組算');
  assert.ok(!/3\.9/.test(bodyOf('paneCost')) && !/NODE_US\s*=/.test(editor),
    '係數不得在編輯器裡再寫一份');

  const html = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/index.html'), 'utf8');
  const costAt = html.indexOf('/tools/vfx/preset-cost.cjs');
  assert.ok(costAt > 0, '頁面要載入成本模組');
  assert.ok(costAt < html.indexOf('/tools/vfx/editor/editor.js'), '要排在 editor.js 之前');

  /* 伺服器預設只開放 editor/ 底下的檔，這一支在 tools/vfx/ 根目錄，要單獨開放 */
  const server = fs.readFileSync(path.join(REPO, 'tools/vfx/editor-server.cjs'), 'utf8');
  assert.ok(/'\/tools\/vfx\/preset-cost\.cjs'/.test(server),
    '沒加進 REPO_ALLOWLIST 的話頁面會拿到 403，而且畫面上只會少一塊，沒有別的線索');

  const css = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.css'), 'utf8');
  const rule = css.slice(css.indexOf('.pane-cost {'), css.indexOf('.pane-cost.warn'));
  assert.ok(/position:\s*absolute/.test(rule) && /top:\s*6px/.test(rule), '貼在預覽的上方');
  assert.ok(/\.pane-cost\.warn \{[^}]*color:\s*#ffa63d/.test(css), '超過門檻是橘色');
});
