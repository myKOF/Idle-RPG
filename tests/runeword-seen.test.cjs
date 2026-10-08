const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRuneEnv, makeItem, fillRunes } = require('./helpers/runeword-env.cjs');

/* 符文真言「已激活」記錄（G.player.runewordSeen，js/runeword.js §2）：
   圖鑑要靠它決定配方與效果顯示或問號，所以規則必須固定：
     ・成形的那一刻記下；只放了一部分、順序錯、裝備不符都不記
     ・只增不減：拆掉符文、換掉裝備都不會讓記錄消失
     ・存檔：欄位整理（丟掉未知 id）、記錄功能上線前就已成形的裝備讀檔時補記 */
const seenIds = (c) => Object.keys(c.G.player.runewordSeen || {}).sort();

test('新遊戲：runewordSeen 是空表', () => {
  const c = loadRuneEnv();
  assert.deepEqual(JSON.parse(JSON.stringify(c.G.player.runewordSeen)), {});
  assert.equal(c.rwHasSeen('rw_viperkiss'), false);
});

test('成形的那一刻記下；之後拆掉符文記錄仍在', () => {
  const c = loadRuneEnv();
  const it = makeItem(c, { slot: 'weapon', weaponType: 'sword1h' });
  c.addRune('r06', 1); c.addRune('r08', 1);
  assert.equal(c.socketRune(it, 'r06'), null);
  assert.deepEqual(seenIds(c), [], '只放了第一顆還沒成形，不算');
  assert.equal(c.socketRune(it, 'r08'), null);
  assert.deepEqual(seenIds(c), ['rw_viperkiss']);
  assert.equal(c.rwHasSeen('rw_viperkiss'), true);
  it.runes[1] = null;
  assert.equal(c.rwActiveWord(it), null, '拆掉就不再成形');
  assert.deepEqual(seenIds(c), ['rw_viperkiss'], '記錄只增不減');
});

test('順序錯、裝備類型不符都不會成形，也就不記', () => {
  const c = loadRuneEnv();
  const sword = makeItem(c, { slot: 'weapon', weaponType: 'sword1h' });
  c.addRune('r08', 1); c.addRune('r06', 1);
  c.socketRune(sword, 'r08'); c.socketRune(sword, 'r06');   // 暗影→毒牙：順序顛倒
  assert.equal(c.rwActiveWord(sword), null);
  const boots = makeItem(c, { slot: 'boots', weaponType: undefined });
  c.addRune('r06', 1); c.addRune('r08', 1);
  c.socketRune(boots, 'r06'); c.socketRune(boots, 'r08');   // 蛇吻只能用在單手劍／匕首／魔劍
  assert.equal(c.rwActiveWord(boots), null);
  assert.deepEqual(seenIds(c), []);
});

test('不同裝備上的多組符文真言各自記錄，互不影響', () => {
  const c = loadRuneEnv();
  const it = makeItem(c, { slot: 'weapon', weaponType: 'wand1h' });   // 施法武器：霜語（霜痕→風語）
  ['r03', 'r04'].forEach((id) => { c.addRune(id, 1); c.socketRune(it, id); });
  assert.deepEqual(seenIds(c), ['rw_frostwhisper']);
  const dawn = makeItem(c, { slot: 'helmet', weaponType: undefined });   // 旭日之冠：曙光→聖輝→靈泉
  ['r15', 'r09', 'r12'].forEach((id) => { c.addRune(id, 1); c.socketRune(dawn, id); });
  assert.deepEqual(seenIds(c), ['rw_dawncrown', 'rw_frostwhisper']);
});

test('rwMarkSeen：未知 id 不記、重複不重複寫入、回傳是否新記', () => {
  const c = loadRuneEnv();
  assert.equal(c.rwMarkSeen('rw_nope'), false);
  assert.equal(c.rwMarkSeen('rw_viperkiss'), true);
  assert.equal(c.rwMarkSeen('rw_viperkiss'), false);
  assert.deepEqual(seenIds(c), ['rw_viperkiss']);
  // 欄位被弄壞（舊版或手改存檔）時自己重建
  c.G.player.runewordSeen = null;
  assert.equal(c.rwMarkSeen('rw_firstcry'), true);
  assert.deepEqual(seenIds(c), ['rw_firstcry']);
});

test('讀檔：缺欄位＝空表；未知 id 與假值丟掉；格式不對整個重建', () => {
  const c = loadRuneEnv();
  const base = () => ({ version: 2, player: { level: 10 }, equipment: {}, inventory: [] });
  let out = c.migrateSave(base());
  assert.deepEqual(JSON.parse(JSON.stringify(out.player.runewordSeen)), {});
  const dirty = base();
  dirty.player.runewordSeen = { rw_viperkiss: 1, rw_deleted_long_ago: 1, rw_firstcry: 0, rw_nightwatch: true };
  out = c.migrateSave(dirty);
  assert.deepEqual(Object.keys(out.player.runewordSeen).sort(), ['rw_nightwatch', 'rw_viperkiss']);
  assert.equal(out.player.runewordSeen.rw_nightwatch, 1, '值一律整理成 1');
  [[], 'x', 7].forEach((bad) => {
    const d = base(); d.player.runewordSeen = bad;
    assert.deepEqual(JSON.parse(JSON.stringify(c.migrateSave(d).player.runewordSeen)), {});
  });
});

test('讀檔補記：記錄功能上線前就已成形的裝備（身上、備用套裝、背包）讀檔時補記進去', () => {
  const c = loadRuneEnv();
  const formed = (slot, weaponType, runes) => {
    const it = makeItem(c, { slot, weaponType });
    fillRunes(it, runes);
    return JSON.parse(JSON.stringify(it));
  };
  const raw = {
    version: 2,
    player: { level: 100 },
    equipment: { weapon: formed('weapon', 'sword1h', ['r06', 'r08']) },
    equipmentSets: [
      { weapon: formed('weapon', 'sword1h', ['r06', 'r08']) },
      { chest: formed('chest', undefined, ['r02', 'r05']) },
      {}
    ],
    inventory: [formed('boots', undefined, ['r04', 'r01', 'r08']), formed('ring', undefined, ['r10', null])]
  };
  const out = c.migrateSave(raw);
  assert.deepEqual(Object.keys(out.player.runewordSeen).sort(), ['rw_nightwatch', 'rw_viperkiss', 'rw_windwalk']);
  // 半成品（只有第一顆）與沒成形的不補
  assert.equal(out.player.runewordSeen.rw_bloodring, undefined);
  // 冪等：再整理一次結果不變
  const again = c.migrateSave(JSON.parse(JSON.stringify(out)));
  assert.deepEqual(Object.keys(again.player.runewordSeen).sort(), Object.keys(out.player.runewordSeen).sort());
});

test('Worker 的 gems 面板快照帶 runewordSeen（主執行緒圖鑑的資料來源）', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'worker', 'sim.worker.js'), 'utf8');
  const at = src.indexOf("case 'gems':");
  assert.ok(at > 0);
  const block = src.slice(at, src.indexOf("case 'skills':", at));
  assert.match(block, /runes: p\.runes \|\| \{\}/);
  assert.match(block, /runewordSeen: p\.runewordSeen \|\| \{\}/);
});
