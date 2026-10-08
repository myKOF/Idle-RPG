const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadGameContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, UI: { dirty: {} } };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/item.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

function makeGemInventory(gemTypes) {
  const gems = {};
  Object.keys(gemTypes).forEach((type) => {
    gems[type] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0 };
  });
  return gems;
}

test('全部類型合成：逐種類處理、不會混合不同種類；合成頁改用獨立的「全部類型合成」按鈕', () => {
  const root = path.resolve(__dirname, '..');
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(index, /id="fuse-alltypes-btn"/);
  assert.match(ui, /\$id\('fuse-alltypes-btn'\)[\s\S]*?gem\.composeAll[\s\S]*?type: GEM_TYPE_ALL/);

  const context = loadGameContext();
  const gems = makeGemInventory(context.GEM_TYPES);
  gems.ruby[1] = 3;
  gems.sapphire[1] = 3;
  context.G = { player: { gold: context.FUSE_GOLD_COST[1], gems } };

  assert.equal(context.composeGems(context.GEM_TYPE_ALL, 1), null);
  assert.equal(gems.ruby[1], 0);
  assert.equal(gems.ruby[2], 1);
  assert.equal(gems.sapphire[1], 3);
  assert.equal(gems.sapphire[2], 0);
});

test('寶石合成改為 3 合 1，兩顆不足且不扣除資源', () => {
  const context = loadGameContext();
  const gems = makeGemInventory(context.GEM_TYPES);
  gems.ruby[1] = 2;
  context.G = { player: { gold: context.FUSE_GOLD_COST[1], gems } };

  assert.equal(context.GEM_COMPOSE_INPUT_COUNT, 3);
  assert.equal(context.composeGems('ruby', 1), '「一級紅寶石」不足 3 顆');
  assert.equal(gems.ruby[1], 2);
  assert.equal(gems.ruby[2], 0);
  assert.equal(context.G.player.gold, context.FUSE_GOLD_COST[1]);
});

test('合成頁沒有種類與等級下拉：種類取自寶石庫的選擇，階級取自十階列的點擊', () => {
  const root = path.resolve(__dirname, '..');
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(index, /id="fuse-type"|id="fuse-level"/, '合成頁不該再有種類／等級下拉');
  assert.doesNotMatch(ui, /\$id\('fuse-type'\)|\$id\('fuse-level'\)/);
  // 下拉選單的「全部類型寶石」選項已移除（轉換目標與拆解的種類下拉不需要它）
  const fillBody = ui.match(/function fillGemTypeSelect\(sel\) \{([\s\S]*?)\n\}/);
  assert.ok(fillBody, '找不到 fillGemTypeSelect');
  assert.doesNotMatch(fillBody[1], /GEM_TYPE_ALL/);
  // 十階列：每階一個按鈕，附這一階的寶石圖；點了呼叫 setGemFuseLevel
  assert.match(ui, /data-gem-lv="' \+ lv \+ '"/);
  assert.match(ui, /gemIconHTML\(type, lv, 'gi-curve'\)/);
  assert.match(ui, /t\.closest\('\[data-gem-lv\]'\)[\s\S]*?setGemFuseLevel\(/);
  // 合成指令取自 UI.gemBrowse.sel／fuseLv
  assert.match(ui, /function fuseTarget\(\) \{ return \{ t: UI\.gemBrowse\.sel, lv: UI\.gemBrowse\.fuseLv \|\| 1 \}; \}/);
});

test('合成配方：1～4 階 3 合 1，五階以上顯示「×6 神鑄」並升到下一階，十階是最高階', () => {
  const root = path.resolve(__dirname, '..');
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const context = loadGameContext();
  context.esc = (v) => String(v);
  context.fmt = (v) => String(v);
  context.GEM_TIER_COLORS = { 1: '#9aa5b1', 2: '#4ade80', 3: '#38bdf8', 4: '#c084fc', 5: '#ffd700', 6: '#fb923c', 7: '#f87171', 8: '#b8860b', 9: '#f5c542', 10: '#7df9ff' };
  const grab = (name) => {
    const m = ui.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}'));
    assert.ok(m, '找不到 ' + name);
    return m[0];
  };
  vm.runInContext(grab('gemSocketHTML') + '\n' + grab('fuseRecipeHTML'), context);
  const count = (h, re) => (h.match(re) || []).length;

  const r1 = context.fuseRecipeHTML('ruby', 1);
  assert.equal(count(r1, /gx-socket"/g) + count(r1, /gx-socket /g), 4, '3 顆原料＋1 顆成品');
  assert.match(r1, /gem-ruby-01\.png/);
  assert.match(r1, /gem-ruby-02\.png/);
  assert.match(r1, /gx-recipe-cost"><img[^>]*>100/, '一級升二級的金幣');

  const r5 = context.fuseRecipeHTML('ruby', 5);
  assert.match(r5, /gem-ruby-05\.png/);
  assert.match(r5, /gem-ruby-06\.png/, '五級升六級');
  assert.match(r5, /gx-recipe-mult">×6</, '神鑄要 6 顆');
  assert.match(r5, /gx-recipe-cost">神鑄</);

  const r10 = context.fuseRecipeHTML('ruby', 10);
  assert.match(r10, /gem-ruby-10\.png/);
  assert.match(r10, /已是最高階/);
  assert.doesNotMatch(r10, /gx-recipe-arrow|gx-recipe-mult/, '十級不能再鑄，沒有箭頭也沒有 ×6');
});

test('全部類型寶石全部合成時會逐種類處理可合成庫存', () => {
  const context = loadGameContext();
  const gems = makeGemInventory(context.GEM_TYPES);
  gems.ruby[1] = 7;
  gems.sapphire[1] = 3;
  context.G = { player: { gold: context.FUSE_GOLD_COST[1] * 3, gems } };

  let made = 0;
  let err = null;
  while (made < 500 && !(err = context.composeGems(context.GEM_TYPE_ALL, 1))) made++;

  assert.equal(err, '沒有任何種類的寶石足夠合成');
  assert.equal(made, 3);
  assert.equal(gems.ruby[1], 1);
  assert.equal(gems.ruby[2], 2);
  assert.equal(gems.sapphire[1], 0);
  assert.equal(gems.sapphire[2], 1);
});

test('合成鏈與拆解返還依 3:1 比例換算', () => {
  const context = loadGameContext();
  assert.deepEqual([1, 2, 3, 4, 5].map(context.gemL1Worth), [1, 3, 9, 27, 81]);
  assert.deepEqual([2, 3, 4, 5].map(context.gemDismantleYield), [2, 6, 18, 56]);
  assert.equal(context.fusedGemL1Worth({ leaves: 2 }), 162);
  assert.equal(context.fusedGemDismantleYield({ leaves: 2 }), 113);
});

test('寶石合成介面與紀錄使用共用 3 合 1參數', () => {
  const root = path.resolve(__dirname, '..');
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.match(ui, /Math\.floor\(gemsViewCount\(gemsSnapshot, allType, lv\) \/ GEM_COMPOSE_INPUT_COUNT\)/);
  assert.match(ui, /Math\.floor\(n \/ GEM_COMPOSE_INPUT_COUNT\)/);
  assert.match(ui, /GEM_COMPOSE_INPUT_COUNT[\s\S]*sendGemUiCommand\(\s*['"]gem\.composeAll['"]/);
  assert.match(index, /消耗 3 顆「同種類、同等級」寶石/);
});

test('Worker 全部合成選「全部類型寶石」時，紀錄文字不查 GEM_TYPES（合成完成卻拋例外）', () => {
  const root = path.resolve(__dirname, '..');
  const worker = fs.readFileSync(path.join(root, 'js/worker/sim.worker.js'), 'utf8');
  const key = "'gem.composeAll': ";
  const fnStart = worker.indexOf(key) + key.length;
  const fnEnd = worker.indexOf('\n  },', fnStart) + 4;
  assert.ok(fnStart > key.length && fnEnd > fnStart, '找不到 gem.composeAll');
  const run = (type) => {
    const logs = [];
    let calls = 0;
    const ctx = {
      GEM_TYPE_ALL: '__all__', GEM_NAMES: ['', '一級', '二級', '三級'], GEM_COMPOSE_INPUT_COUNT: 3,
      GEM_TYPES: { ruby: { emoji: '🔴', name: '紅寶石' } },
      gemLabel(t, lv) {
        if (!ctx.GEM_TYPES[t]) throw new TypeError('unknown gem ' + t);
        return ctx.GEM_NAMES[lv] + ctx.GEM_TYPES[t].name;
      },
      composeGems: () => (calls++ < 2 ? null : '庫存不足'),
      blog: (msg) => logs.push(msg),
      UI: { dirty: {} }
    };
    const fn = vm.runInNewContext('(' + worker.slice(fnStart, fnEnd) + ')', ctx);
    return { result: fn({ type, level: 1 }), logs };
  };
  const all = run('__all__');
  assert.equal(all.result.made, 2);
  assert.equal(all.result.err, null);
  assert.match(all.logs[0], /一級全部類型寶石 ×6 → 二級同類型寶石 ×2/);
  const ruby = run('ruby');
  assert.match(ruby.logs[0], /一級紅寶石 ×6 → 二級紅寶石 ×2/);
});
