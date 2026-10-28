const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, Math: Object.create(Math) };
  vm.createContext(context);
  for (const file of ['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/status.js', 'js/formula.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  return context;
}

test('混沌裝備是地圖掉落表中的 R9，不再使用特殊掉落常數', () => {
  const context = loadContext();

  assert.equal(context.fieldDropRatesFor(412, 1, 'god_battlefield')[9], 0);
  assert.equal(context.fieldDropRatesFor(413, 1, 'god_battlefield')[9], 1);
  assert.equal(context.fieldDropRatesFor(393, 1, 'god_chaos')[9], 1);
  assert.equal(context.fieldDropRatesFor(451, 1, 'god_sanctuary')[9], 1);
  assert.equal(typeof context.CHAOS_FIELD_DROP_PCT, 'undefined');
});

test('新版混沌神鑄基礎15%、每石5%，至100%不多收',()=>{
 const c=loadContext();
 for(const [n,total,used] of [[0,15,0],[1,20,1],[17,100,17],[99,100,17]]){
  const info=c.divineForgeRateInfo({operation:'equip',slots:[{rarity:9}],stones:n},100);
  assert.equal(info.total,total);assert.equal(info.stones,used);assert.equal(info.cost,5e8);
 }
 assert.equal(c.isForgeableEquipmentRarity(9),true);assert.equal(c.isGodforgedRarity(10),true);
});

test('chaos forge parameters are present in the CSV source of truth', () => {
  const csv = fs.readFileSync(path.resolve(__dirname, '..', 'config/CSV/game_parameters.csv'), 'utf8');

  assert.doesNotMatch(csv, /5-野外裝備掉落,混沌裝備/);
  assert.match(csv, /6-新版神鑄,裝備神鑄每石成功率/);
  assert.match(csv, /6-新版神鑄,裝備神鑄混沌成功率/);
  assert.match(csv, /6-新版神鑄,裝備神鑄混沌金幣/);
  assert.doesNotMatch(csv, /6-神鑄,/);
  assert.match(csv, /表-稀有度,混沌/);
  assert.match(csv, /表-稀有度,神鑄混沌/);
});
