const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const { decodePng } = require('../tools/vfx/vfx-raster.cjs');
const palette = require('../tools/gems/gem-palette.cjs');

function loadGame() {
  const context = { console, Math: Object.create(Math), UI: { dirty: {} } };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/item.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

const g = loadGame();
const keys = Array.from(vm.runInContext('Object.keys(GEM_TYPES)', g));
const maxLv = vm.runInContext('GEM_FORGE_MAX_LEVEL', g);
const dir = path.join(root, 'images', 'gems');

test('寶石圖檔：每種寶石 × 每一階各一張 80×80 透明 PNG，資料夾沒有多餘的檔', () => {
  const want = new Set();
  for (const k of keys) {
    for (let lv = 1; lv <= maxLv; lv++) {
      const name = 'gem-' + k + '-' + String(lv).padStart(2, '0') + '.png';
      want.add(name);
      const img = decodePng(fs.readFileSync(path.join(dir, name)));
      assert.equal(img.width, 80, name + ' 寬度');
      assert.equal(img.height, 80, name + ' 高度');
      assert.equal(img.rgba[3], 0, name + ' 左上角必須透明（不能是不透明底）');
      let body = 0;
      for (let i = 3; i < img.rgba.length; i += 4) if (img.rgba[i] > 250) body++;
      assert.ok(body > 80, name + ' 沒有實心的寶石本體');
    }
  }
  const have = fs.readdirSync(dir).filter((f) => /\.png$/.test(f));
  assert.deepEqual(have.filter((f) => !want.has(f)), [], '有圖檔對不到任何寶石種類／階級');
  assert.equal(have.length, keys.length * maxLv);
});

test('gemIconSrc：路徑與版本字尾，階級夾在 1～10，指到真的檔案', () => {
  assert.match(g.gemIconSrc('ruby', 5), /^images\/gems\/gem-ruby-05\.png\?v=\d+$/);
  assert.match(g.gemIconSrc('ruby', 10), /gem-ruby-10\.png/);
  assert.match(g.gemIconSrc('ruby', 0), /gem-ruby-01\.png/);
  assert.match(g.gemIconSrc('ruby', 99), /gem-ruby-10\.png/);
  for (const k of keys) {
    assert.ok(fs.existsSync(path.join(root, g.gemIconSrc(k, 7).split('?')[0])), k + ' 的圖檔不存在');
  }
});

test('gemIconHTML／fusedGemIconHTML：只定 class，未知種類不輸出，融合寶石兩顆斜疊', () => {
  assert.equal(g.gemIconHTML('nope', 3, 'gi-cell'), '');
  const h = g.gemIconHTML('sapphire', 4, 'gi-chip');
  assert.match(h, /^<img class="gem-ico gi-chip" src="images\/gems\/gem-sapphire-04\.png\?v=\d+" alt="" draggable="false"/);
  const pair = g.fusedGemIconHTML({ level: 5, stats: [{ type: 'ruby', mult: 1 }, { type: 'sapphire', mult: 1 }] }, 'gi-chip');
  assert.match(pair, /^<span class="gem-ico-fused is-pair gi-chip">/);
  assert.equal((pair.match(/<img /g) || []).length, 2);
  assert.match(pair, /gem-ruby-05\.png/);
  assert.match(pair, /gem-sapphire-05\.png/);
  const one = g.fusedGemIconHTML({ level: 5, stats: [{ type: 'emerald', mult: 2 }] }, 'gi-socket');
  assert.doesNotMatch(one, /is-pair/);
  assert.equal((one.match(/<img /g) || []).length, 1);
});

test('裝備詳情的鑲孔列用寶石圖（一般寶石與融合寶石），不再混 emoji', () => {
  const it = {
    sockets: [
      { type: 'ruby', level: 5 },
      { fused: { level: 5, stats: [{ type: 'ruby', mult: 1 }, { type: 'amethyst', mult: 1 }], fusions: 1 } },
      null
    ]
  };
  const html = g.itemSocketHTML(it, null);
  assert.match(html, /<img class="gem-ico gi-inline" src="images\/gems\/gem-ruby-05\.png/);
  assert.match(html, /gem-ico-fused is-pair gi-inline/);
  assert.match(html, /融合寶石（/);
  assert.doesNotMatch(html, /🔴|🟣|🧬/);
});

test('介面各處的寶石圖示改走 gemIconHTML；只剩純文字位置（提示、下拉、記錄）保留 emoji', () => {
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const stats = fs.readFileSync(path.join(root, 'js/stats.js'), 'utf8');
  /* 不是 grep 證明沒有遺漏：ui.js 裡還能直接取 GEM_TYPES[..].emoji 的地方，白名單釘死，
     新增一處圖示位置卻用回 emoji 時，這裡會紅，提醒要選：用圖，或確認它真的是純文字位置。 */
  const left = ui.split('\n').filter((l) => /GEM_TYPES\[[^\]]+\]\.emoji|\bgdef\.emoji|\bgt\.emoji/.test(l)).map((l) => l.trim());
  assert.equal(left.length, 2, '剩下的 emoji 位置：\n' + left.join('\n'));
  assert.ok(left.some((l) => /gemTip\.push/.test(l)), '資源列提示（純文字）');
  assert.ok(left.some((l) => /<option /.test(l)), '下拉選單選項（只能放文字）');
  for (const fn of ['gemIconHTML(gt, lv, \'gi-socket\')', 'fusedGemIconHTML(fg, \'gi-socket\')', 'gemIconHTML(it.type, it.level, \'gi-cell\')',
    'gemIconHTML(type, top || GEM_MAX_LEVEL, \'gi-lib\')', 'gemIconHTML(type, top || GEM_MAX_LEVEL, \'gi-focus\')', 'gemIconHTML(type, lv, \'gi-slot\')',
    'gemIconHTML(s.type, s.lv, \'gi-conv\')', 'gemIconHTML(item.type, item.lv, \'gi-shop\')']) {
    assert.ok(ui.includes(fn), 'ui.js 缺少 ' + fn);
  }
  assert.equal((ui.match(/fusedGemIconHTML\(fg, 'gi-chip'\)/g) || []).length, 3, '三處融合寶石小格');
  assert.match(stats, /gemIconHTML\(parts\[0\], \+parts\[1\], 'gi-inline'\)/);
});

test('CSS：gems.css 為每個 gi-* 尺寸 class 定義大小，並在 index.html 載入', () => {
  const css = fs.readFileSync(path.join(root, 'css/gems.css'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const used = new Set();
  for (const f of ['js/ui.js', 'js/item.js', 'js/stats.js']) {
    for (const m of fs.readFileSync(path.join(root, f), 'utf8').matchAll(/'(gi-[a-z]+)'/g)) used.add(m[1]);
  }
  assert.ok(used.size >= 9, '用到的尺寸 class：' + [...used].join(','));
  for (const c of used) assert.ok(new RegExp('\\.' + c + '\\b[^{]*\\{[^}]*(width|height)').test(css), 'gems.css 沒定義 .' + c);
  assert.match(html, /<link rel="stylesheet" href="css\/gems\.css\?v=[^"]+">/);
});

test('48 種寶石各有自己的顏色：實際打包的圖檔兩兩調色盤距離都夠遠', () => {
  /* 使用者規定「每種寶石都要不同顏色，顏色撞了就用雙色或三色混搭」。量法見 tools/gems/gem-palette.cjs；
     產生器端的 gem-audit.cjs 用 12 當門檻（256 母圖），這裡量的是 80px 實際檔，低階圖寶石本體小、數字會再低一些，故門檻 10。 */
  for (const tier of [3, 6, 8, 10]) {
    const sigs = {};
    for (const k of keys) {
      const img = decodePng(fs.readFileSync(path.join(dir, 'gem-' + k + '-' + String(tier).padStart(2, '0') + '.png')));
      sigs[k] = palette.signature(img.rgba, img.width);
    }
    const bad = palette.closestPairs(sigs).filter((p) => p.d < 10).map((p) => p.a + '~' + p.b + ' ' + p.d.toFixed(1));
    assert.deepEqual(bad, [], '第 ' + tier + ' 階有看起來一樣的寶石');
  }
});

test('光暈只看階數：1～5 階的圖外圍沒有柔光，6 階起淡淡出現並逐階加濃，10 階最濃', () => {
  /* 使用者規定：5 級寶石沒有光暈，6 級起輕微的淡淡光暈、隨等級加強、10 級最濃。
     量法：圖中半透明像素（alpha 7～234）的 alpha 總和——寶石邊緣抗鋸齒與星芒只有一點點，光暈才會讓它大幅上升。 */
  const soft = (k, lv) => {
    const img = decodePng(fs.readFileSync(path.join(dir, 'gem-' + k + '-' + String(lv).padStart(2, '0') + '.png')));
    let sum = 0;
    for (let i = 3; i < img.rgba.length; i += 4) if (img.rgba[i] > 6 && img.rgba[i] < 235) sum += img.rgba[i];
    return sum;
  };
  const LINE = 35000;
  for (const k of keys) {
    const v = [];
    for (let lv = 1; lv <= maxLv; lv++) v.push(soft(k, lv));
    v.slice(0, 5).forEach((x, i) => assert.ok(x < LINE, k + ' 第 ' + (i + 1) + ' 階不該有光暈（' + x + '）'));
    assert.ok(v[5] > LINE, k + ' 第 6 階要看得到淡淡的光暈（' + v[5] + '）');
    for (let i = 6; i < 10; i++) assert.ok(v[i] > v[i - 1], k + ' 第 ' + (i + 1) + ' 階的光暈要比上一階濃');
    assert.ok(v[9] > v[5] * 2, k + ' 第 10 階要明顯比第 6 階濃');
  }
});

test('產生器的外觀表與 GEM_TYPES 一一對應（新增寶石種類時，要先補外觀再出圖）', () => {
  const defs = require('../tools/gems/gem-defs.cjs');
  assert.deepEqual(Object.keys(defs).sort(), keys.slice().sort());
});
