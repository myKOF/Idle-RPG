'use strict';
/* NPC 序列幀圖像（2026-10-31）：NPC 配置表的圖像欄位、images/sprites/npc/npc.json 與遊戲資料三者一致。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'images', 'sprites', 'npc');
const man = JSON.parse(fs.readFileSync(path.join(dir, 'npc.json'), 'utf8'));
const cfg = require(path.join(root, 'tools', 'config_tables.cjs'));

function pngSize(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.toString('latin1', 1, 4), 'PNG', file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
function loadData() {
  const ctx = { console };
  vm.createContext(ctx);
  ['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f }));
  return ctx;
}

test('NPC-SPRITE-1 npc.json 的每個檔都存在，且圖寬＝格寬×幀數、圖高＝格高', () => {
  const stems = Object.keys(man.stems);
  assert.ok(stems.length > 0);
  stems.forEach((stem) => {
    const s = man.stems[stem], c = man.chars[s.char];
    assert.ok(c, stem + ' 的角色不在 chars');
    const size = pngSize(path.join(dir, stem + '.png'));
    assert.equal(size.w, s.frames * c.cellW, stem + ' 圖寬');
    assert.equal(size.h, c.cellH, stem + ' 圖高');
    assert.ok(stem.startsWith(s.char + '_'), stem + ' 檔名要以角色名開頭');
  });
  Object.keys(man.chars).forEach((k) => assert.ok(man.stems[k + '_idle'], k + ' 缺站立圖'));
});

test('NPC-SPRITE-2 遊戲資料：每個 NPC 的 sprite 都指到 npc.json 裡的檔，且一定有站立圖', () => {
  const c = loadData();
  let withSprite = 0;
  Object.keys(c.NPC_CONFIG_TABLE).forEach((id) => {
    const sp = c.NPC_CONFIG_TABLE[id].sprite;
    if (!sp) return;
    withSprite++;
    assert.ok(sp.idle, id + ' 有 sprite 卻沒有站立圖');
    Object.keys(sp).forEach((a) => assert.ok(man.stems[sp[a]], id + ' 的 ' + a + ' 圖不在 npc.json：' + sp[a]));
  });
  assert.ok(withSprite >= 25, '已套用新圖的 NPC 數量：' + withSprite);
});

test('NPC-SPRITE-3 素材庫那兩包的角色全部都有人使用（沒有白花錢的圖）', () => {
  const c = loadData();
  const used = new Set();
  Object.keys(c.NPC_CONFIG_TABLE).forEach((id) => {
    const sp = c.NPC_CONFIG_TABLE[id].sprite;
    if (sp) used.add(man.stems[sp.idle].char);
  });
  const unused = Object.keys(man.chars).filter((k) => !used.has(k));
  assert.deepEqual(unused, [], '沒有 NPC 使用的角色：' + unused.join('、'));
});

test('NPC-SPRITE-4 NPC 表：每一列都有四個動作圖像欄與圖像備註，舊版圖像明確標示', () => {
  const rows = cfg.csvParse(fs.readFileSync(path.join(root, 'config/CSV/NPC.csv'), 'utf8')).filter((r) => r.length > 1);
  const h = rows[0];
  const ix = (n) => { const i = h.indexOf(n); assert.ok(i >= 0, '缺欄位 ' + n); return i; };
  const cols = ['站立圖像', '移動圖像', '攻擊圖像', '死亡圖像'].map(ix), note = ix('圖像備註'), type = ix('類型'), id = ix('NPC識別碼');
  const c = loadData();
  rows.slice(1).forEach((r) => {
    assert.ok(r[note], r[id] + ' ' + r[type] + ' 缺圖像備註');
    cols.forEach((k) => assert.ok(r[k], r[id] + ' ' + r[type] + ' 的圖像欄不可留空（缺圖請寫「（缺）」）'));
    const entry = c.NPC_CONFIG_TABLE[r[id]];
    if (entry && entry.sprite) {
      assert.ok(r[note].startsWith('新版正式圖像'), r[id] + ' 已換新圖，備註要標「新版正式圖像」');
      assert.equal(r[cols[0]], entry.sprite.idle);
    } else if (r[type] !== 'tower_boss') {
      assert.ok(r[note].startsWith('舊版圖像'), r[id] + ' 還是舊圖，備註要標「舊版圖像」');
    }
  });
});

test('NPC-SPRITE-5 縮放比：NPC 表每列都有大於 0 的數字，寫進遊戲資料；改成 1.5 套用後 NPC_CONFIG_TABLE 與 pool 都會變', () => {
  const rows = cfg.csvParse(fs.readFileSync(path.join(root, 'config/CSV/NPC.csv'), 'utf8')).filter((r) => r.length > 1);
  const k = rows[0].indexOf('縮放比');
  assert.ok(k >= 0, '缺欄位 縮放比');
  rows.slice(1).forEach((r) => assert.ok(Number(r[k]) > 0, r[0] + ' 縮放比要大於 0：' + r[k]));
  const src = fs.readFileSync(path.join(root, 'js/data.js'), 'utf8');
  const sc = cfg.SCHEMAS.NPC, iType = sc.header.indexOf('類型'), iId = sc.header.indexOf('NPC識別碼'), iScale = sc.header.indexOf('縮放比');
  const data = sc.extract(src);
  const target = data.find((r) => r[iId] === 'desert_1' && r[iType] === 'normal');
  target[iScale] = '1.5';
  const out = sc.rebuild(data, sc.header, src);
  assert.match(out.DESERT_POOL, /id: 'desert_1'[^\n]*scale: 1\.5/);
  assert.doesNotMatch(out.DESERT_POOL.split('\n')[2], /scale:/);   // 其他 NPC 維持 1 時不寫入
  const c = loadData();
  assert.equal(c.NPC_CONFIG_TABLE.desert_1.scale, 1);
});
