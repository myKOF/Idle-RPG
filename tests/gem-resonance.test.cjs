/* 寶石共鳴：版面與最低階、屬性算法（自身＋相鄰加成）、鑲嵌／取下／升級指令、存檔整理、協議與配置表接線。
   規格來源：寶石共鳴系統說明（7 區 × 7 孔；孔等級每級 +3% 相鄰孔寶石能力，上限 30%）。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

function load(files) {
  const c = { console, Math, Date, UI: { dirty: {} }, blog() {},
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {}, key() { return null; }, length: 0 } };
  c.window = c;
  vm.createContext(c);
  files.forEach((f) => vm.runInContext(read(f), c, { filename: f }));
  return c;
}
const LOGIC = ['js/util.js', 'js/data.js', 'js/status.js', 'js/gem_resonance_data.js', 'js/formula.js', 'js/item.js', 'js/gem_resonance.js'];

function game(gems) {
  const c = load(LOGIC);
  let dirty = 0;
  c.markStatsDirty = () => { dirty++; };
  c.G = { player: { gold: 1e12, level: 1, reincarnations: 0, skills: {}, gems: gems || {}, resonance: { holes: {} } } };
  c.dirtyCount = () => dirty;
  return c;
}
const plain = (v) => JSON.parse(JSON.stringify(v));

test('版面：7 區 × 7 孔，外圍區環繞中央區；相鄰＝中心與外圈互連、外圈左右相鄰', () => {
  const c = game();
  assert.equal(c.resonanceRegionCount(), 7);
  assert.equal(c.RESONANCE_HOLE_COUNT, 7);
  assert.deepEqual(plain(c.resonanceNeighbors(0)), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(plain(c.resonanceNeighbors(1)), [0, 6, 2]);
  assert.deepEqual(plain(c.resonanceNeighbors(6)), [0, 5, 1]);
  assert.equal(c.resonanceHoleCap(0, 0), 2);
  assert.equal(c.resonanceHoleCap(0, 3), 1);
  assert.equal(c.resonanceHoleCap(6, 0), 6);
});

test('最低階：外圍區朝外三孔 4 階、朝內三孔 5 階、中心 6 階（圖 2 防禦區）；中央區外圈 8、中心 10', () => {
  const c = game();
  const defense = c.GEM_RESONANCE_REGIONS.findIndex((r) => r.id === 'defense');
  assert.deepEqual(plain(c.GEM_RESONANCE_REGIONS[defense].minLv), [6, 4, 4, 4, 5, 5, 5]);
  c.GEM_RESONANCE_REGIONS.slice(0, 6).forEach((reg, d) => {
    assert.equal(reg.minLv[0], 6, reg.id);
    for (let i = 0; i < 6; i++) {
      const outward = [d - 1, d, d + 1].map((n) => (n + 6) % 6).includes(i);
      assert.equal(reg.minLv[i + 1], outward ? 4 : 5, reg.id + ' 外圈' + (i + 1));
    }
  });
  const core = c.GEM_RESONANCE_REGIONS[6];
  assert.equal(core.types, null);
  assert.deepEqual(plain(core.minLv), [10, 8, 8, 8, 8, 8, 8]);
});

test('每個外圍區的種類限制：種類都存在於 GEM_TYPES，且各區互不重疊', () => {
  const c = game();
  const seen = {};
  c.GEM_RESONANCE_REGIONS.slice(0, 6).forEach((reg) => {
    reg.types.forEach((t) => {
      assert.ok(c.GEM_TYPES[t], t);
      assert.ok(!seen[t], t + ' 同時出現在 ' + seen[t] + ' 與 ' + reg.id);
      seen[t] = reg.id;
    });
  });
});

test('屬性：自身能力＋孔等級 × 3% 的相鄰寶石能力，上限 30%', () => {
  const c = game();
  const state = { holes: {
    '0:0': { gems: [{ type: 'sapphire', level: 6 }], lv: 0 },
    '0:1': { gems: [{ type: 'pierceMagic', level: 4 }], lv: 5 }
  } };
  const e = plain(c.resonanceEntries(state));
  const sum = (type) => e.filter((x) => x.type === type).map((x) => x.mult);
  assert.deepEqual(sum('sapphire'), [1, 0.15]);   // 自己 ×1；孔 1 等級 5 → 相鄰中心的寶石 +15%
  assert.deepEqual(sum('pierceMagic'), [1]);       // 中心孔等級 0 → 外圈寶石沒有加成
  assert.equal(c.resonanceBonusMult(10), 0.3);
  assert.equal(c.resonanceBonusMult(99), 0.3);
  assert.equal(c.resonanceBonusMult(0), 0);
});

test('相鄰不跨區域，也不含自己孔的寶石', () => {
  const c = game();
  const e = plain(c.resonanceEntries({ holes: {
    '0:1': { gems: [{ type: 'sapphire', level: 4 }], lv: 10 },
    '1:2': { gems: [{ type: 'diamond', level: 4 }], lv: 0 },
    '0:3': { gems: [{ type: 'iolite', level: 5 }], lv: 0 }
  } }));
  assert.deepEqual(e.map((x) => x.type + ':' + x.mult), ['sapphire:1', 'iolite:1', 'diamond:1']);
});

test('computeStats 把共鳴能力併入屬性（並受鑲嵌效率放大）', () => {
  const c = game({});
  c.G.equipment = c.SLOT_LIST.reduce((m, s) => { m[s] = null; return m; }, {});
  const base = c.computeStats().hit;
  c.G.player.resonance = { holes: {
    '5:0': { gems: [{ type: 'catseye', level: 6 }], lv: 0 },
    '5:1': { gems: [{ type: 'catseye', level: 4 }], lv: 10 }
  } };
  const value = (lv) => c.gemStatValue('catseye', lv);
  const got = c.computeStats().hit - base;
  assert.ok(Math.abs(got - (value(6) + value(4) + value(6) * 0.3)) < 1e-6, String(got));
});

test('鑲嵌：種類限制、最低階、容量、庫存扣除與取下退回', () => {
  const c = game({ sapphire: { 1: 0, 2: 0, 3: 0, 4: 3, 5: 1, 6: 2 }, ruby: { 4: 2 } });
  const magic = c.GEM_RESONANCE_REGIONS.findIndex((r) => r.id === 'magic');
  assert.match(c.socketResonanceGem(magic, 1, 'ruby', 4), /不能鑲/);
  assert.match(c.socketResonanceGem(magic, 4, 'sapphire', 4), /需要.*以上/);    // 內側孔要 5 階
  assert.match(c.socketResonanceGem(99, 1, 'sapphire', 4), /無效/);
  assert.equal(c.socketResonanceGem(magic, 1, 'sapphire', 4), null);
  assert.equal(c.gemCount('sapphire', 4), 2);
  assert.match(c.socketResonanceGem(magic, 1, 'sapphire', 4), /已滿/);          // 外圈孔只容 1 顆
  assert.equal(c.socketResonanceGem(magic, 0, 'sapphire', 6), null);            // 中心孔容 2 顆
  assert.equal(c.socketResonanceGem(magic, 0, 'sapphire'), null);               // 省略階級：取最低可用（6 階）
  assert.match(c.socketResonanceGem(magic, 0, 'sapphire', 6), /沒有符合|已滿/);
  assert.equal(c.gemCount('sapphire', 6), 0);
  assert.ok(c.dirtyCount() >= 3);
  assert.equal(c.unsocketResonanceGem(magic, 0, 0), null);
  assert.equal(c.gemCount('sapphire', 6), 1);
  assert.match(c.unsocketResonanceGem(magic, 0, 5), /沒有寶石/);
});

test('升級：需先鑲寶石；扣金幣與同種寶石；孔等級上限；取下寶石不掉孔等級', () => {
  const c = game({ sapphire: { 1: 10, 2: 10, 3: 10, 4: 10, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0 } });
  const magic = c.GEM_RESONANCE_REGIONS.findIndex((r) => r.id === 'magic');
  assert.match(c.upgradeResonanceHole(magic, 1), /先在此孔鑲入/);
  c.socketResonanceGem(magic, 1, 'sapphire', 4);
  const cost = c.GEM_RESONANCE_UPGRADES[0];
  const gold = c.G.player.gold;
  assert.equal(c.upgradeResonanceHole(magic, 1), null);
  assert.equal(c.G.player.gold, gold - cost.gold);
  assert.equal(c.gemCount('sapphire', cost.gemLv), 10 - cost.gemCount);
  assert.equal(c.G.player.resonance.holes[magic + ':1'].lv, 1);
  c.G.player.gold = 0;
  assert.match(c.upgradeResonanceHole(magic, 1), /金幣不足/);
  c.G.player.gold = 1e12;
  c.G.player.resonance.holes[magic + ':1'].lv = c.resonanceMaxHoleLevel();
  assert.match(c.upgradeResonanceHole(magic, 1), /上限/);
  c.G.player.resonance.holes[magic + ':1'].lv = 3;
  c.unsocketResonanceGem(magic, 1, 0);
  assert.equal(c.G.player.resonance.holes[magic + ':1'].lv, 3);
});

test('存檔整理：未知種類丟掉、不符規則的寶石退回庫存、等級夾在上限內', () => {
  const c = load([...LOGIC, 'js/skills.js', 'js/talents.js', 'js/player.js', 'js/save.js']);
  const def = c.newGameState();
  assert.deepEqual(plain(def.player.resonance), { holes: {} });
  const magic = c.GEM_RESONANCE_REGIONS.findIndex((r) => r.id === 'magic');
  def.player.resonance = { holes: {
    [magic + ':1']: { gems: [{ type: 'sapphire', level: 4 }, { type: 'sapphire', level: 4 }], lv: 99 },
    [magic + ':4']: { gems: [{ type: 'sapphire', level: 4 }], lv: 0 },     // 內側孔需 5 階
    [magic + ':2']: { gems: [{ type: 'nope', level: 4 }], lv: 0 },
    '9:9': { gems: [{ type: 'sapphire', level: 9 }], lv: 1 }
  } };
  const before = def.player.gems.sapphire[4];
  const out = c.migrateSave(JSON.parse(JSON.stringify(def)));
  const holes = out.player.resonance.holes;
  assert.deepEqual(Object.keys(holes), [magic + ':1']);
  assert.equal(holes[magic + ':1'].gems.length, 1);
  assert.equal(holes[magic + ':1'].lv, c.resonanceMaxHoleLevel());
  assert.equal(out.player.gems.sapphire[4], before + 2);
});

test('協議：三條指令、版本、BOSS 配置鎖與 gems 面板欄位', () => {
  const proto = require(path.join(root, 'js/worker/protocol.js'));
  ['gem.resonanceSocket', 'gem.resonanceUnsocket', 'gem.resonanceUpgrade'].forEach((n) => assert.ok(proto.COMMANDS[n], n));
  assert.equal(proto.validateCommand('gem.resonanceSocket', { region: 0, hole: 1, type: 'sapphire' }), null);
  assert.ok(proto.validateCommand('gem.resonanceSocket', { region: -1, hole: 1, type: 'sapphire' }));
  assert.equal(proto.bossFightBlocksCommand('gem.resonanceSocket'), true);
  assert.equal(proto.bossFightBlocksCommand('gem.resonanceUnsocket'), true);
  assert.match(read('js/worker/sim.worker.js'), /resonance: p\.resonance/);
  assert.match(read('js/worker/sim.worker.js'), /gem_resonance_data\.js/);
  assert.match(read('js/worker/sim.worker.js'), /'\.\.\/gem_resonance\.js/);
});

test('接線：index.html 載入順序、共鳴分頁與存檔整理', () => {
  const html = read('index.html');
  const at = (s) => html.indexOf(s);
  assert.ok(at('js/gem_resonance_data.js?v=') > at('js/data.js?v=') && at('js/gem_resonance_data.js?v=') < at('js/formula.js?v='));
  assert.ok(at('js/gem_resonance.js?v=') > at('js/item.js?v='));
  assert.ok(at('js/ui-gem-resonance.js?v=') > at('js/ui.js?v='));
  assert.match(html, /data-gem-tool-btn="resonance"/);
  assert.match(html, /data-gem-panel="resonance"/);
  assert.match(read('css/ashen-forge.css'), /data-gem-tool="resonance"\] \.gx-panel\[data-gem-panel="resonance"\]/);
  assert.match(read('js/formula.js'), /resonanceEntries\(p\.resonance\)/);
  assert.match(read('js/save.js'), /data\.player\.resonance = \{ holes: resHoles \}/);
});

test('配置表：CSV 與 js/gem_resonance_data.js 語意一致、非法內容整次中止', () => {
  const src = read('tools/config_tables.cjs');
  assert.match(src, /gemRes: path\.join\(ROOT, 'js', 'gem_resonance_data\.js'\)/);
  assert.match(src, /TABLE_ORDER = \[[^\]]*'Gem_resonance'\]/);
  const out = require('node:child_process').execFileSync(process.execPath, ['tools/config_tables.cjs', '--apply', 'Gem_resonance'], { cwd: root, encoding: 'utf8' });
  assert.match(out, /語意變更 0/);
  assert.ok(fs.existsSync(path.join(root, 'config/Excel/Gem_resonance.xlsx')));
  const c = {};
  vm.createContext(c);
  const prefix = src.slice(0, src.indexOf('/* ---- Skills'));
  const schemaSrc = src.slice(src.indexOf('/* ---- Gem_resonance'), src.indexOf('const TABLE_ORDER'));
  const tool = { require, __dirname: path.join(root, 'tools'), process, console };
  vm.createContext(tool);
  vm.runInContext(prefix.slice(0, prefix.indexOf('SCHEMAS.Skills')) + '\n' + schemaSrc + '\nthis.schema = SCHEMAS.Gem_resonance;', tool);
  const rows = tool.schema.extract(read('js/gem_resonance_data.js'));
  const h = tool.schema.header;
  const bad = (mutate) => { const r = rows.map((x) => x.slice()); mutate(r); return () => tool.schema.rebuild(r, h); };
  assert.doesNotThrow(() => tool.schema.rebuild(rows, h));
  const regionRow = rows.findIndex((r) => r[0] === '區域');
  assert.throws(bad((r) => { r[regionRow][3] = 'ruby;notAGem'; }), /不在 Gems 表/);
  assert.throws(bad((r) => { r[regionRow][5] = '6;4;4'; }), /7 個/);
  assert.throws(bad((r) => { r.splice(regionRow, 1); }), /7 列區域/);
  const upRow = rows.findIndex((r) => r[0] === '升級');
  assert.throws(bad((r) => { r[upRow][1] = '5'; }), /從 1 起連續/);
});
