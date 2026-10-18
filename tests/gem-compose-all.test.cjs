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

test('合成配方逐顆顯示原料與金幣箭頭，所有階級均可直接合成，十階是最高階', () => {
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

  for (let lv=1;lv<10;lv++) {
    const recipe=context.fuseRecipeHTML('ruby',lv),needed=lv<5?3:lv<9?4:6;
    assert.equal(count(recipe,/class="gx-socket(?: is-out)?"/g),needed+1,'source '+lv+' 原料＋成品');
    assert.match(recipe,/gx-recipe-arrow/);assert.ok(recipe.includes('>'+context.FUSE_GOLD_COST[lv]+'</span>'));
    assert.doesNotMatch(recipe,/gx-recipe-mult|神鑄/);
  }

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

test('寶石合成介面與紀錄使用共用逐階配方，寶石頁只保留四種工具', () => {
  const root = path.resolve(__dirname, '..');
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.match(ui, /Math\.floor\(gemsViewCount\(gemsSnapshot, allType, lv\) \/ needed\)/);
  assert.match(ui, /Math\.floor\(n \/ needed\)/);
  assert.match(ui, /gemComposeInputCount\(lv\)[\s\S]*sendGemUiCommand\(\s*['"]gem\.composeAll['"]/);
  assert.deepEqual([...index.matchAll(/data-gem-tool-btn="([^"]+)"/g)].map(m=>m[1]),['compose','convert','dismantle','resonance']);
  assert.match(index,/data-gem-panel="fusion" hidden/);assert.match(index,/data-gem-panel="shop" hidden/);
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
      GEM_TYPE_ALL: '__all__', GEM_NAMES: ['', '一級', '二級', '三級'], gemComposeInputCount: () => 3,
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

test('直接合成全部階級：不足素材／不足金幣不扣資源，恰足按配方扣款產出，最高階與非法階級拒絕',()=>{
 const c=loadGameContext();
 for(let lv=1;lv<10;lv++){
  const needed=lv<5?3:lv<9?4:6,cost=c.FUSE_GOLD_COST[lv];assert.ok(Number.isFinite(cost)&&cost>0);
  const gems=makeGemInventory(c.GEM_TYPES);gems.ruby[lv]=needed-1;c.G={player:{gold:cost,gems},factory:{stats:{}}};
  const before=JSON.stringify(c.G);assert.match(c.composeGems('ruby',lv),new RegExp('不足 '+needed+' 顆'));assert.equal(JSON.stringify(c.G),before);
  gems.ruby[lv]=needed;c.G.player.gold=cost-1;const poor=JSON.stringify(c.G);assert.match(c.composeGems('ruby',lv),/金幣不足/);assert.equal(JSON.stringify(c.G),poor);
  c.G.player.gold=cost;assert.equal(c.composeGems('ruby',lv),null);assert.equal(gems.ruby[lv],0);assert.equal(gems.ruby[lv+1],1);assert.equal(c.G.player.gold,0);assert.equal(c.G.factory.stats.gemComposed,1);
 }
 for(const lv of [0,-1,10,11,1.5,NaN,Infinity,'5']){const before=JSON.stringify(c.G);assert.equal(typeof c.composeGems('ruby',lv),'string');assert.equal(JSON.stringify(c.G),before);}
 assert.deepEqual(Array.from({length:10},(_,i)=>c.gemL1Worth(i+1)),[1,3,9,27,81,324,1296,5184,20736,124416]);
 for(let lv=2;lv<=10;lv++)assert.equal(c.gemDismantleYield(lv),Math.floor(c.gemL1Worth(lv)*.7));
 assert.equal(c.gemL1Worth(Infinity),0);
});

test('Worker高階全部合成與全部類型合成使用實際配方、保留餘數、正確紀錄並受金幣限制',()=>{
 const src=fs.readFileSync(path.resolve(__dirname,'../js/worker/sim.worker.js'),'utf8'),key="'gem.composeAll': ",start=src.indexOf(key)+key.length,end=src.indexOf('\n  },',start)+4;
 for(const lv of [5,6,7,8,9])for(const all of [false,true]){
  const c=loadGameContext(),gems=makeGemInventory(c.GEM_TYPES),needed=lv===9?6:4,cost=c.FUSE_GOLD_COST[lv],logs=[];
  gems.ruby[lv]=needed*2+1;gems.sapphire[lv]=needed;gems.emerald[lv]=needed-1;
  c.G={player:{gold:cost*2,gems}};c.blog=m=>logs.push(m);const batch=vm.runInContext('('+src.slice(start,end)+')',c);
  const result=batch({type:all?c.GEM_TYPE_ALL:'ruby',level:lv});assert.equal(result.made,2);assert.equal(result.err,null);assert.equal(c.G.player.gold,0);
  assert.equal(gems.ruby[lv],1);assert.equal(gems.ruby[lv+1],2);assert.equal(gems.sapphire[lv],needed);assert.equal(gems.emerald[lv],needed-1);
  assert.ok(logs[0].includes('×'+(needed*2)+' → '),logs[0]);
  c.G.player.gold=cost;const next=batch({type:all?c.GEM_TYPE_ALL:'ruby',level:lv});assert.equal(next.made,all?1:0);
  assert.equal(gems.sapphire[lv+1],all?1:0);
 }
});
