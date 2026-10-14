'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../js/ui.js'), 'utf8');
function body(name) {
  const start = source.indexOf('function ' + name + '('), open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(name);
}
const key = 'idle-rpg.equipmentSelection.v1';
function setup(store = new Map(), eq = {}) {
  const ctx = { UI: { sel: null }, SLOT_LIST: ['weapon', 'weapon2', 'helmet', 'ring', 'ring2', 'amulet'],
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k,v) => store.set(k,v) },
    peekUiPanelData: () => ctx.snapshot, uiAsuraDualWield: () => !!ctx.asura,
    isTwoHandItem: item => !!item && item.twoHand,
    findItemById: id => ctx.inventory?.[id] || null, snapshot: { equipment: eq } };
  vm.createContext(ctx);
  for (const name of ['equipViewEquipment', 'findSelItem', 'equipmentSelectionChoice', 'equipmentSelectionMemory',
    'rememberEquipmentSelection', 'syncEquipmentSelectionMemory', 'selectFilledCell']) vm.runInContext(body(name), ctx);
  ctx.sync = () => ctx.syncEquipmentSelectionMemory(ctx.snapshot);
  ctx.click = (slot, id, src = 'equip') => ctx.selectFilledCell({getAttribute: k => ({'data-slot':slot,'data-id':id,'data-src':src})[k]});
  return ctx;
}
test('沒有裝備先等待，首件穿上只自動選一次，之後不跳到其他部位', () => {
  const c = setup(); c.sync(); assert.equal(c.UI.sel, null);
  c.snapshot.equipment.amulet = {id:'first'}; c.sync(); assert.equal(c.UI.sel.slot, 'amulet');
  c.snapshot.equipment.weapon = {id:'later'}; c.sync(); assert.equal(c.UI.sel.slot, 'amulet');
});
test('刷新記住第二枚戒指部位，換裝後查新物品而不是背包裡的舊戒指', () => {
  const store = new Map(); let c = setup(store, {ring:{id:'a'},ring2:{id:'b'}});
  c.sync(); c.click('ring2','b');
  c = setup(store, {ring:{id:'a'},ring2:{id:'new'}}); c.inventory = {b:{id:'b'}}; c.sync();
  assert.equal(c.UI.sel.slot,'ring2'); assert.equal(c.findSelItem().id,'new');
});
test('自行取消後刷新及之後新裝備到達，都保持未選取', () => {
  const store = new Map(); let c = setup(store, {weapon:{id:'a'}}); c.sync(); c.click('weapon','a');
  assert.equal(c.UI.sel,null); c = setup(store, {weapon:{id:'b'}}); c.sync(); assert.equal(c.UI.sel,null);
  c.snapshot.equipment.helmet={id:'c'}; c.sync(); assert.equal(c.UI.sel,null);
});
test('記住空部位，裝備移除／重新穿上與換預覽套裝皆不丟失部位', () => {
  const store = new Map(); let c=setup(store); c.UI.sel={source:'equip-slot',slot:'ring2'}; c.rememberEquipmentSelection();
  c=setup(store); c.sync(); assert.equal(c.findSelItem(),null); assert.equal(c.UI.sel.slot,'ring2');
  c.snapshot={sets:[{}, {ring2:{id:'other-set'}}],equipView:1}; c.sync(); assert.equal(c.findSelItem().id,'other-set');
  c.snapshot.equipView=0; assert.equal(c.findSelItem(),null); assert.equal(c.UI.sel.slot,'ring2');
});
test('雙手武器副格刷新仍選副格，修羅副手獨立時不誤指主手', () => {
  const store=new Map(); let c=setup(store,{weapon:{id:'two',twoHand:true}}); c.sync(); c.click('weapon2','two');
  c=setup(store,{weapon:{id:'two',twoHand:true}}); c.sync(); assert.equal(c.findSelItem().id,'two');
  assert.equal(c.UI.sel.slot,'weapon2'); c.asura=true; assert.equal(c.findSelItem(),null);
});
test('背包選取以ID恢復，不被自動選第一件穿裝取代', () => {
  const store=new Map(); let c=setup(store,{weapon:{id:'w'}}); c.sync(); c.click('ring','inventory','inv');
  c=setup(store,{weapon:{id:'w'}}); c.inventory={inventory:{id:'inventory'}}; c.sync();
  assert.equal(c.UI.sel.source,'inv'); assert.equal(c.findSelItem().id,'inventory');
});
test('損壞或不合法偏好忽略，不能選神鑄來源或任意部位', () => {
  for(const raw of ['{',JSON.stringify({selection:{source:'equip',slot:'fake'}}),JSON.stringify({selection:{source:'forgeinv',id:'x'}})]) {
    const c=setup(new Map([[key,raw]]),{helmet:{id:'h'}}); c.sync(); assert.equal(c.UI.sel.slot,'helmet');
  }
});
test('面板未到達不過早決定；localStorage拒絕存取時仍可正常選取與取消', () => {
  const c=setup(); c.localStorage={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}};
  c.syncEquipmentSelectionMemory(null); assert.equal(c.UI.equipmentSelectionMemory,undefined);
  c.snapshot.equipment.weapon={id:'a'}; c.sync(); assert.equal(c.findSelItem().id,'a');
  c.click('weapon','a'); c.sync(); assert.equal(c.UI.sel,null);
});
