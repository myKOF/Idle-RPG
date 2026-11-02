'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { catalog, spec } = require('../tools/equipment-ui/export-equipment-art.cjs');
const root = path.resolve(__dirname, '..');
function context() {
  const c = { console, UI: { dirty: {} } };
  c.window = c;
  vm.createContext(c);
  for (const file of ['util', 'strings_data', 'strings', 'data', 'status', 'formula', 'item']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'js', file + '.js'), 'utf8'), c);
  }
  return c;
}

test('六套防具八部位、八戒指及六項鏈全部具獨立名稱與正式PNG', () => {
  const c = context();
  const items = catalog();
  assert.equal(items.length, 62);
  assert.equal(spec.sets.filter(s => s.material === 'cloth').length, 2);
  assert.equal(spec.sets.filter(s => s.material === 'leather').length, 2);
  assert.equal(spec.sets.filter(s => s.material === 'plate').length, 2);
  const hashes = new Set();
  for (const item of items) {
    assert.equal(c.STR(item.strId), item.name);
    assert.ok(c.SLOT_BASENAMES[item.slot].includes(item.name), item.name + ' 未進入掉落池');
    const file = c.equipIconFile({ slot: item.slot, name: item.name });
    assert.equal(file, 'equipment/icon_' + item.key + '.png');
    const png = fs.readFileSync(path.join(root, 'images', file));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), 512);
    assert.equal(png.readUInt32BE(20), 512);
    assert.equal(png[25], 6, item.name + ' 必須保留RGBA');
    hashes.add(crypto.createHash('sha256').update(png).digest('hex'));
  }
  assert.equal(hashes.size, 62, '不得用同一張圖冒充不同造型');
  for (const slot of spec.slots) assert.equal(c.SLOT_BASENAMES[slot].length, 6);
  assert.equal(c.SLOT_BASENAMES.ring.length, 8);
  assert.equal(c.SLOT_BASENAMES.amulet.length, 6);
});

test('真實裝備生成、各品質前綴及JSON往返仍讀取相同新圖', () => {
  const c = context();
  const originalPick = c.pick;
  for (const item of catalog()) {
    c.pick = list => list === c.SLOT_BASENAMES[item.slot] ? item.name : originalPick(list);
    for (let rarity = 0; rarity < c.RARITIES.length; rarity++) {
      const it = c.makeEquipment(200, { slot: item.slot, rarity, level: 200 });
      assert.equal(it.name, c.RARITY_PREFIX[rarity] + item.name);
      assert.equal(c.equipIconFile(JSON.parse(JSON.stringify(it))), 'equipment/icon_' + item.key + '.png');
      assert.ok(Array.isArray(it.affixes));
      assert.deepEqual(Array.from(c.equipSlotsForItem(it)), item.slot === 'ring' ? ['ring', 'ring2'] : [item.slot]);
    }
  }
});

test('舊存檔名稱、未知舊名稱與十二種武器均使用移入equipment的原圖', () => {
  const c = context();
  const old = { 938: 'helmet_leather', 946: 'chest_cloth', 969: 'ring_silver', 972: 'amulet_silver' };
  for (const [id, key] of Object.entries(old)) {
    assert.equal(c.equipIconFile({ slot: 'chest', name: '傳說的' + c.STR(+id) }), 'equipment/icon_' + key + '.png');
  }
  for (const [slot, info] of Object.entries(c.SLOT_INFO)) {
    assert.ok(info.icon.startsWith('equipment/'));
    assert.equal(c.equipIconFile({ slot, name: 'unknown-legacy-name' }), info.icon);
    assert.ok(fs.existsSync(path.join(root, 'images', info.icon)));
  }
  for (const type of Object.keys(c.WEAPON_TYPES)) {
    const icon = c.equipIconFile({ slot: 'weapon', weaponType: type, name: 'unknown-legacy-weapon' });
    assert.ok(icon.startsWith('equipment/'));
    assert.ok(fs.existsSync(path.join(root, 'images', icon)));
  }
  assert.equal(c.equipIconFile(null), '');
  assert.equal(fs.existsSync(path.join(root, 'images', 'icon_weapon.png')), false);
});
