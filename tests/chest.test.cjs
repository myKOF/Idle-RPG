/* 熔爐寶箱（2026-11-12，js/chest.js、js/chest_data.js、config/Excel/Chest.xlsx）
   1. 配置表：CSV 與 chest_data.js 語意一致；解析器擋下壞格；工具內的品質名稱／寶石上限與遊戲一致
   2. 經驗：拆解（doSalvage）依品質累積、首次得經驗才解鎖、滿額換寶箱、上限 9999、幸運寶箱倍率
   3. 升級：a ＋ b^目前等級、扣金幣、金幣不足／滿級不扣
   4. 開啟：數量扣除、每種掉落都能正確發放、雙開戒加倍、幸運符改遺物權重、裝備進熔爐佇列
   5. 存檔淨化、離線接線、文字編號
   數值從 CHESTS 讀或用測試自己注入的寶箱，不寫死表上的數字——設計者調表時測試不該跟著紅。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const { SCHEMAS, csvParse, evalLiteral, extractLiteral } = require('../tools/config_tables.cjs');

function loadGameContext() {
  const context = { console, UI: { dirty: {} }, GT: 0 };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/runeword_data.js', 'js/relic_data.js', 'js/relic.js',
   'js/chest_data.js', 'js/chest.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/item.js', 'js/runeword.js',
   'js/skills.js', 'js/talents.js', 'js/player.js', 'js/factory.js', 'js/newforge.js', 'js/save.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.blog = () => {};
  context.flog = () => {};
  context.addLog = () => {};
  context.FIELD = { player: null, monster: null, monsters: [] };
  context.G = context.newGameState();
  return context;
}
/* 注入一種測試用寶箱（不動表上的寶箱） */
function addTestChest(c, def) {
  const full = Object.assign({ id: 900 + c.CHESTS.length, name: '測試寶箱', quality: 'common', init: true, a: 100, b: 2 }, def);
  c.CHESTS.push(full);
  c.CHEST_BY_ID[full.id] = full;
  return full;
}
const xp12 = (v) => Array(12).fill(v);

function chestItemGroup(c, item, n = 1) {
  return { icon: c.equipIconFile(item), level: item.level, ancientCount: c.getItemAncientCount(item), n };
}

test('Chest 表：CSV 與 chest_data.js 語意一致', () => {
  const rows = csvParse(fs.readFileSync(path.join(root, 'config/CSV/Chest.csv'), 'utf8')).filter((r) => r.some((x) => String(x).trim() !== ''));
  const built = SCHEMAS.Chest.rebuild(rows.slice(1), rows[0]).CHESTS;
  const fromCsv = evalLiteral(extractLiteral(built, 'CHESTS').literal);
  const fromJs = evalLiteral(extractLiteral(fs.readFileSync(path.join(root, 'js/chest_data.js'), 'utf8'), 'CHESTS').literal);
  assert.deepStrictEqual(fromJs, fromCsv, '表改了卻沒跑「套用參數.bat」，或 chest_data.js 被手改');
});

test('Chest 表：五種品質、初始只解鎖普通、每種最多 20 級', () => {
  const c = loadGameContext();
  assert.deepStrictEqual(Array.from(c.CHESTS, (d) => d.quality), ['common', 'rare', 'epic', 'legendary', 'mythic']);
  assert.deepStrictEqual(Array.from(c.CHESTS, (d) => d.init), [true, false, false, false, false]);
  c.CHESTS.forEach((d) => {
    assert.ok(d.levels.length >= 1 && d.levels.length <= c.CHEST_MAX_LEVEL);
    d.levels.forEach((lv) => { assert.equal(lv.xp.length, c.RARITIES.length); assert.ok(lv.drops.length >= 1); });
  });
  assert.equal(c.CHEST_MAX_LEVEL, 20);
  assert.equal(c.CHEST_MAX_COUNT, 9999);
});

test('Chest 表：工具內的品質名稱與寶石上限和遊戲一致', () => {
  const c = loadGameContext();
  const tool = fs.readFileSync(path.join(root, 'tools/config_tables.cjs'), 'utf8');
  const names = evalLiteral(/const CHEST_RARITY_NAMES = (\[[^\]]*\]);/.exec(tool)[1]);
  assert.deepStrictEqual(names, Array.from(c.RARITIES, (r) => r.name));
  assert.equal(Number(/const CHEST_GEM_MAX_LEVEL = (\d+);/.exec(tool)[1]), c.GEM_FORGE_MAX_LEVEL);
});

test('Chest 表：解析器擋下壞格、範圍與名稱寫法正確', () => {
  const header = SCHEMAS.Chest.header;
  const base = (drops, over) => {
    const row = Array(header.length).fill('');
    const set = (col, v) => { row[header.findIndex((h) => h.split('\n')[0] === col)] = v; };
    set('編號', '1'); set('寶箱名稱', 'A'); set('寶箱品質', '普通'); set('初始解鎖', '是'); set('等級', '1');
    set('升級金幣a', '10'); set('升級金幣b', '2'); set('寶箱鍛造經驗', '5'); set('開啟掉落數', '1');
    for (let i = 0; i < 12; i++) set('拆解經驗R' + i, '1');
    drops.forEach((d, i) => set('掉落' + (i + 1), d));
    Object.entries(over || {}).forEach(([k, v]) => set(k, v));
    return row;
  };
  const parse = (rows) => evalLiteral(extractLiteral(SCHEMAS.Chest.rebuild(rows, header).CHESTS, 'CHESTS').literal);
  const ok = parse([base(['金幣×100~200=3', '寶石:2~3×2=1', '裝備:傳說:1~2=1', '裝備:3~神話=1', '遺物=0.5', '遺物:1=1', '符文:5=1'])]);
  assert.deepStrictEqual(ok[0].levels[0].drops, [
    { k: 'gold', q: [100, 200], w: 3 }, { k: 'gem', p: [2, 3], q: [2, 2], w: 1 },
    { k: 'equip', p: [5, 5], p2: [1, 2], q: [1, 1], w: 1 }, { k: 'equip', p: [3, 6], q: [1, 1], w: 1 },
    { k: 'relic', q: [1, 1], w: 0.5 }, { k: 'relic', p: [1, 1], q: [1, 1], w: 1 }, { k: 'rune', p: [5, 5], q: [1, 1], w: 1 }
  ]);
  // 第 2 級留白＝沿用第 1 級（含整組掉落）
  const two = parse([base(['金幣=1']), base([], { '寶箱名稱': '', '寶箱品質': '', '初始解鎖': '', '升級金幣a': '', '升級金幣b': '', '寶箱鍛造經驗': '', '開啟掉落數': '', '等級': '2' })]);
  assert.deepStrictEqual(two[0].levels[1], two[0].levels[0]);
  [['金幣'], ['鑽石=1'], ['寶石=1'], ['寶石:11=1'], ['金幣:3=1'], ['金幣=0'], ['裝備:12=1'], ['遺物:9999=1'], ['符文:999=1']].forEach((cells) => {
    assert.throws(() => parse([base(cells)]), undefined, '應拒絕：' + cells[0]);
  });
  assert.throws(() => parse([base(['金幣=1']), base(['金幣=1'], { '等級': '2', '寶箱名稱': 'B' })]), /一致/);
  assert.throws(() => parse([base(['金幣=1'], { '等級': '2' })]), /連續/);
});

test('經驗：拆解依品質累積，首次得到經驗才解鎖，滿額換寶箱', () => {
  const c = loadGameContext();
  const [bronze, blue] = c.CHESTS;
  assert.equal(c.chestState(bronze.id).on, true, '青銅開局解鎖');
  assert.equal(c.chestState(blue.id).on, false, '藍色開局未解鎖');
  const r0 = bronze.levels[0].xp.findIndex((v) => v > 0);
  const blueFirst = c.chestUnlockRarity(blue);
  assert.ok(blueFirst > 0);
  // 拆一件藍色寶箱不給經驗的品質：藍色仍鎖著
  for (let r = 0; r < blueFirst; r++) c.doSalvage(c.makeEquipment(1, { rarity: r }), true);
  assert.equal(c.chestState(blue.id).on, false);
  assert.ok(c.chestState(bronze.id).xp > 0 || c.chestState(bronze.id).n > 0, '青銅有拿到經驗');
  c.doSalvage(c.makeEquipment(1, { rarity: blueFirst }), true);
  assert.equal(c.chestState(blue.id).on, true, '第一次得到經驗就解鎖');
  // 換算：恰好補滿所需經驗＝ +1 個
  const st = c.chestState(bronze.id);
  st.xp = 0; st.n = 0;
  const per = bronze.levels[0].xp[r0];
  const need = bronze.levels[0].need;
  c.chestGainSalvageXp(r0, need / per);
  assert.equal(st.n, 1);
  assert.ok(st.xp < 1e-9);
});

test('經驗：每種上限 9999，存滿後經驗停在滿格；幸運寶箱放大經驗', () => {
  const c = loadGameContext();
  const def = addTestChest(c, { levels: [{ need: 10, xp: xp12(1), rolls: 1, drops: [{ k: 'gold', q: [1, 1], w: 1 }] }] });
  const st = c.chestState(def.id);
  st.n = c.CHEST_MAX_COUNT - 1;
  c.chestGainSalvageXp(0, 35);
  assert.equal(st.n, c.CHEST_MAX_COUNT);
  assert.equal(st.xp, 10, '存滿後經驗停在滿格');
  c.chestOpen(def.id, 1);
  c.chestGainSalvageXp(0, 1);
  assert.equal(st.n, c.CHEST_MAX_COUNT, '開掉一個後下一次拆解立刻補上');

  const speed = c.RELIC_BY_EFFECT.chestSpeed;
  c.G.player.relics[speed.id] = { lv: 1, n: 0 };
  st.n = 0; st.xp = 0;
  c.chestGainSalvageXp(0, 1);
  assert.ok(Math.abs(st.xp - (1 + speed.levels[0].value / 100)) < 1e-9, '幸運寶箱乘上經驗倍率');
});

test('升級：a ＋ b^目前等級、扣金幣；金幣不足與滿級不扣', () => {
  const c = loadGameContext();
  const def = c.CHESTS[0];
  const cost = c.chestUpgradeCost(def, 1);
  assert.equal(cost, Math.ceil(def.a + Math.pow(def.b, 1)));
  assert.equal(c.chestUpgradeCost(def, 7), Math.ceil(def.a + Math.pow(def.b, 7)));
  c.G.player.gold = cost - 1;
  assert.equal(c.chestUpgrade(def.id), c.STR(42, c.fmt(cost)));
  assert.equal(c.chestState(def.id).lv, 1);
  c.G.player.gold = cost + 5;
  assert.equal(c.chestUpgrade(def.id), null);
  assert.equal(c.chestState(def.id).lv, 2);
  assert.equal(c.G.player.gold, 5);
  c.chestState(def.id).lv = c.chestMaxLevel(def);
  c.G.player.gold = 1e300;
  assert.equal(c.chestUpgrade(def.id), c.STR(2489, def.name, c.chestMaxLevel(def)));
  assert.equal(c.chestUpgradeCost(def, c.chestMaxLevel(def)), null);
  // 未解鎖不能升級
  assert.equal(c.chestUpgrade(c.CHESTS[1].id), c.STR(2486, c.CHESTS[1].name));
});

test('開啟：扣數量、依抽取次數發放；沒有寶箱或未解鎖回錯誤', () => {
  const c = loadGameContext();
  const def = addTestChest(c, { levels: [{ need: 10, xp: xp12(0), rolls: 3, drops: [{ k: 'gold', q: [5, 5], w: 1 }] }] });
  assert.equal(c.chestOpen(def.id, 1), c.STR(2487, def.name));
  c.chestState(def.id).n = 4;
  const gold = c.G.player.gold;
  const res = c.chestOpen(def.id, 99);
  assert.equal(res.opened, 4, '超過持有數時開到持有數');
  assert.equal(c.chestState(def.id).n, 0);
  assert.equal(c.G.player.gold - gold, 4 * 3 * 5);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(res.rewards)), [{ k: 'gold', n: 60 }]);
  assert.equal(c.chestOpen(c.CHESTS[1].id, 1), c.STR(2486, c.CHESTS[1].name));
  assert.equal(c.chestOpen(12345, 1), c.STR(2485));
});

test('開啟：每一種掉落都能發放到正確的庫存', () => {
  const c = loadGameContext();
  const p = c.G.player;
  const rune = c.RUNES[4];
  const relic = c.RELICS[2];
  const cases = [
    [{ k: 'gold' }, () => p.gold], [{ k: 'scrap' }, () => p.scrap], [{ k: 'essence' }, () => p.essence],
    [{ k: 'ancientEssence' }, () => p.ancientEssence], [{ k: 'dust' }, () => p.dust], [{ k: 'soulOrigin' }, () => p.soulOrigin],
    [{ k: 'invitation' }, () => c.merchantInvitationCount(p)], [{ k: 'skillXp' }, () => p.skillMastery.xp + p.skillMastery.level * 1e9],
    [{ k: 'xp' }, () => p.xp + p.level * 1e12],
    [{ k: 'gem', p: [3, 3] }, () => Object.keys(p.gems).reduce((s, t) => s + (p.gems[t][3] || 0), 0)],
    [{ k: 'rune', p: [5, 5] }, () => p.runes[rune.id] || 0],
    [{ k: 'relic', p: [relic.id, relic.id] }, () => c.relicEntry(relic.id).lv + c.relicEntry(relic.id).n],
    [{ k: 'relic' }, () => Object.keys(p.relics).reduce((s, id) => s + p.relics[id].lv + p.relics[id].n, 0)],
    [{ k: 'equip', p: [4, 4] }, () => c.newForgeTotalQueued() + c.G.inventory.length]
  ];
  cases.forEach(([drop, read]) => {
    const def = addTestChest(c, { levels: [{ need: 10, xp: xp12(0), rolls: 1, drops: [Object.assign({ q: [2, 2], w: 1 }, drop)] }] });
    c.chestState(def.id).n = 1;
    const before = read();
    const res = c.chestOpen(def.id, 1);
    assert.equal(typeof res, 'object', drop.k + ' 開啟失敗：' + res);
    assert.ok(read() > before, drop.k + ' 沒有進庫存');
    assert.ok(res.rewards.length >= 1, drop.k + ' 沒有回報獎勵');
    res.rewards.forEach((rw) => assert.doesNotMatch(c.chestRewardLabel(rw), /\[#|undefined/, drop.k + ' 顯示名稱'));
  });
});

test('開啟：裝備進熔爐佇列；佇列滿改放背包，背包也滿直接拆解，不會遺失', () => {
  const c = loadGameContext();
  const def = addTestChest(c, { levels: [{ need: 10, xp: xp12(0), rolls: 1, drops: [{ k: 'equip', p: [6, 6], p2: [2, 2], q: [1, 1], w: 1 }] }] });
  c.chestState(def.id).n = 3;
  let res = c.chestOpen(def.id, 1);
  assert.equal(res.equip.forge, 1);
  const queued = c.G.newForge.queue[c.G.newForge.queue.length - 1];
  assert.equal(queued.rarity, 6);
  assert.equal(queued.affixes.filter((a) => a.ancient).length, 2, '指定太古條數');
  assert.deepStrictEqual(Array.from(res.rewards[0].items, item => ({ ...item })), [chestItemGroup(c, queued)]);
  c.newForgeTryIntake = () => false;   // 佇列已滿
  res = c.chestOpen(def.id, 1);
  assert.equal(res.equip.inv, 1);
  assert.deepStrictEqual(Array.from(res.rewards[0].items, item => ({ ...item })), [chestItemGroup(c, c.G.inventory.at(-1))]);
  c.inventoryCapacityWithTalents = () => c.G.inventory.length;   // 背包也滿
  const makeEquipment = c.makeEquipment;
  let salvaged;
  c.makeEquipment = (...args) => (salvaged = makeEquipment(...args));
  const scrap = c.G.player.scrap;
  res = c.chestOpen(def.id, 1);
  assert.equal(res.equip.salvaged, 1);
  assert.ok(c.G.player.scrap > scrap, '直接拆解照給產出');
  assert.deepStrictEqual(Array.from(res.rewards[0].items, item => ({ ...item })), [chestItemGroup(c, salvaged)]);
});

test('開啟：同品質同圖示的裝備依實際等級及太古星數分組', () => {
  const c = loadGameContext();
  const original = c.makeEquipment;
  const levels = [200, 200, 250, 200];
  const made = [];
  c.makeEquipment = (stage, opts) => {
    const item = original(stage, { ...opts, level: levels.shift(), slot: 'weapon', weaponType: 'sword1h' });
    made.push(item);
    return item;
  };
  const list = c.chestGrantBag({
    'equip:6:0': { k: 'equip', p: 6, ancient: 0, n: 3 },
    'equip:6:1': { k: 'equip', p: 6, ancient: 1, n: 1 }
  }, { forge: 0, inv: 0, salvaged: 0 });
  const icon = c.equipIconFile(made[0]);
  assert.ok(icon && fs.existsSync(path.join(root, 'images', icon)));
  assert.equal(list.length, 1);
  assert.equal(list[0].r, 6);
  assert.equal(list[0].n, 4);
  assert.deepStrictEqual(Array.from(list[0].items, item => ({ ...item })), [
    { icon, level: 200, ancientCount: 0, n: 2 },
    { icon, level: 250, ancientCount: 0, n: 1 },
    { icon, level: 200, ancientCount: 1, n: 1 }
  ]);
});

test('遺物：雙開戒讓獎勵加倍、幸運符放大遺物格權重', () => {
  const c = loadGameContext();
  const def = addTestChest(c, { levels: [{ need: 10, xp: xp12(0), rolls: 2, drops: [{ k: 'scrap', q: [3, 3], w: 1 }] }] });
  const dbl = c.RELIC_BY_EFFECT.chestDouble;
  c.G.player.relics[dbl.id] = { lv: 1, n: 0 };
  c.chance = (pct) => pct > 0;   // 必定觸發
  c.chestState(def.id).n = 2;
  const scrap = c.G.player.scrap;
  const res = c.chestOpen(def.id, 2);
  assert.equal(res.doubled, 2);
  assert.equal(c.G.player.scrap - scrap, 2 * 2 * 3 * 2);

  const row = { drops: [{ k: 'gold', q: [1, 1], w: 3 }, { k: 'relic', q: [1, 1], w: 1 }] };
  assert.ok(Math.abs(c.chestDropOdds(row)[1].pct - 25) < 1e-9);
  const luck = c.RELIC_BY_EFFECT.chestRelicChance;
  c.G.player.relics[luck.id] = { lv: 1, n: 0 };
  const w = 1 + luck.levels[0].value / 100;
  assert.ok(Math.abs(c.chestDropOdds(row)[1].pct - w / (3 + w) * 100) < 1e-9);
});

test('存檔淨化：壞值修正、未知編號保留、新局有空的 chests', () => {
  const c = loadGameContext();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(c.newGameState().player.chests)), {});
  const data = { player: { chests: { 1: { lv: 99, xp: -5, n: 1e9, on: 'x' }, 2: 'bad', 777: { lv: 3 } } } };
  c.sanitizeChests(data);
  const ch = data.player.chests;
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ch[1])), { lv: c.chestMaxLevel(c.CHESTS[0]), xp: 0, n: c.CHEST_MAX_COUNT, on: true });
  assert.equal(ch[2], undefined);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ch[777])), { lv: 3 });
  const bad = { player: { chests: [] } };
  c.sanitizeChests(bad);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(bad.player.chests)), {});
});

test('接線：拆解入口、離線結算、存檔遷移、Worker 面板與載入順序', () => {
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  assert.match(read('js/factory.js'), /chestGainSalvageXp\(it\.rarity\)/);
  const save = read('js/save.js');
  assert.equal((save.match(/chestGainSalvageXp\(r\)/g) || []).length, 2, '離線滿載折算的兩個分支都要給經驗');
  assert.match(save, /chestCountsSnapshot\(\)/);
  assert.match(save, /sanitizeChests\(data\)/);
  const worker = read('js/worker/sim.worker.js');
  assert.match(worker, /chests: typeof chestPanelView === 'function' \? chestPanelView\(\) : \{\}/);
  assert.ok(worker.indexOf("'../chest.js") > worker.indexOf("'../relic.js"), 'chest.js 要在 relic.js 之後載入');
  const html = read('index.html');
  ['src="js/chest_data.js', 'src="js/chest.js', 'src="js/ui-chest.js', 'href="css/chest.css', 'id="nf-chests"'].forEach((s) => assert.ok(html.includes(s), 'index.html 缺 ' + s));
  assert.ok(html.indexOf('src="js/chest.js') > html.indexOf('src="js/relic.js'));
  assert.ok(html.indexOf('src="js/ui-chest.js') > html.indexOf('src="js/ui-relic.js'), 'ui-chest 用到 ui-relic 的 relicIconPath');
  assert.ok(html.indexOf('id="nf-chests"') < html.indexOf('id="nf-furnaces"'), '寶箱區在熔爐清單上方');
});

test('文字：寶箱用到的 String 編號都存在', () => {
  const c = loadGameContext();
  const ids = new Set();
  ['js/chest.js', 'js/ui-chest.js'].forEach((f) => {
    for (const m of fs.readFileSync(path.join(root, f), 'utf8').matchAll(/STR\((\d+)/g)) ids.add(Number(m[1]));
  });
  ids.forEach((id) => assert.doesNotMatch(c.STR(id), /^\[#/, 'String 表缺 ' + id));
});
