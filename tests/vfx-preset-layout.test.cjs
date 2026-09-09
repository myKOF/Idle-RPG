'use strict';
/* ============================================================
   vfx-preset-layout.test.cjs — 單一根群組規則的驗收

   規則本身寫在 docs/vfx/VFX_AGENT_WORKFLOW.md §9.11：
   每份 Preset 的所有圖層一律收進「一個」群組，群組 id／name 取 preset id。

   為什麼要用測試守而不是只寫在文件裡：分組是 authoring metadata，漏掉它
   **畫面完全正常**——不會報錯、不會變醜，只有等到 Editor 能同時打開多份
   特效的那一天，才會發現圖層混成一鍋而且分不出誰是誰。沒有立即症狀的規則
   靠人記是記不住的。

   這一份走過整個 vfx/presets/，所以新增 Preset 不必再補測試。
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const LS = require('../tools/vfx/editor/layout-schema.js');

const REPO = path.resolve(__dirname, '..');
const PRESET_DIR = path.join(REPO, 'vfx', 'presets');
const LAYOUT_DIR = path.join(REPO, 'vfx', 'layouts');

function presetIds() {
  return fs.readdirSync(PRESET_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.slice(0, -5))
    .sort();
}
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

test('LAYOUT-1 每份 Preset 都有對應的 layout 檔', function () {
  const missing = presetIds().filter(
    id => !fs.existsSync(path.join(LAYOUT_DIR, id + '.json')));
  assert.deepEqual(missing, [],
    '缺 layout 的 preset（用 preset-kit 的 writeRootGroupLayout 補）');
});

test('LAYOUT-2 每份 layout 本身合法，且 presetId 對得上檔名', function () {
  const bad = [];
  presetIds().forEach(function (id) {
    const file = path.join(LAYOUT_DIR, id + '.json');
    if (!fs.existsSync(file)) return;
    const layout = readJson(file);
    const res = LS.validateLayout(layout);
    if (!res.ok) bad.push(id + '：' + res.errors.join('；'));
    else if (layout.presetId !== id) bad.push(id + '：presetId 是 ' + layout.presetId);
  });
  assert.deepEqual(bad, []);
});

test('LAYOUT-3 單一根群組：一份 Preset 一個群組，且收滿全部圖層', function () {
  /* 三種都算違規，而且各自的症狀不一樣：
       群組數 ≠ 1     多份特效同時打開時，一個特效佔好幾列
       有圖層沒收進去  那幾層會和別份特效的圖層混在同一個根層級
       群組收了不存在的 id  reconcile 會忽略，於是實際上等於沒收 */
  const problems = [];
  presetIds().forEach(function (id) {
    const file = path.join(LAYOUT_DIR, id + '.json');
    if (!fs.existsSync(file)) return;
    const preset = readJson(path.join(PRESET_DIR, id + '.json'));
    const layout = readJson(file);
    const layerIds = preset.layers.map(l => l.id);

    if (layout.groups.length !== 1) {
      problems.push(id + '：有 ' + layout.groups.length + ' 個群組，應該只有 1 個');
      return;
    }
    const g = layout.groups[0];
    const missing = layerIds.filter(x => g.layerIds.indexOf(x) < 0);
    if (missing.length) problems.push(id + '：這些圖層沒收進群組 → ' + missing.join('、'));
    const stray = g.layerIds.filter(x => layerIds.indexOf(x) < 0);
    if (stray.length) problems.push(id + '：群組指到不存在的圖層 → ' + stray.join('、'));
  });
  assert.deepEqual(problems, []);
});

test('LAYOUT-4 群組 id 與 name 取 preset id', function () {
  /* 多份特效同時打開時，列表上要一眼看出這一組是誰的。 */
  const bad = [];
  presetIds().forEach(function (id) {
    const file = path.join(LAYOUT_DIR, id + '.json');
    if (!fs.existsSync(file)) return;
    const g = readJson(file).groups[0];
    if (!g) return;
    if (g.id !== id || g.name !== id) bad.push(id + '：群組是 ' + g.id + '／' + g.name);
  });
  assert.deepEqual(bad, []);
});

test('LAYOUT-5 頂層排列就是那一個群組，沒有任何散在根層級的圖層', function () {
  const bad = [];
  presetIds().forEach(function (id) {
    const file = path.join(LAYOUT_DIR, id + '.json');
    if (!fs.existsSync(file)) return;
    const layout = readJson(file);
    const order = layout.order || [];
    const roots = order.filter(k => k.indexOf('layer:') === 0);
    if (roots.length) bad.push(id + '：order 裡還有根層級圖層 → ' + roots.join('、'));
  });
  assert.deepEqual(bad, []);
});

test('LAYOUT-6 preset-kit 的 write() 一定會產生 layout（規則要在源頭就成立）', function () {
  /* 只靠上面幾條事後檢查的話，做完一批 Preset 才會發現漏了，那時要回頭補。
     write() 自己就叫 writeRootGroupLayout，所以照流程做就不可能漏。 */
  const src = fs.readFileSync(path.join(REPO, 'tools/vfx/authoring/preset-kit.cjs'), 'utf8');
  const fn = src.slice(src.indexOf('function write(preset)'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.ok(/writeRootGroupLayout\(/.test(body),
    'preset-kit 的 write() 必須連 layout 一起寫出來');
});
