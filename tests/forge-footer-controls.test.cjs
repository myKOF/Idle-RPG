'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {loadRuneEnv}=require('./helpers/runeword-env.cjs');
function setup(){const c=loadRuneEnv();c.G.player.reincarnations=5;c.G.player.gold=1e12;c.G.player.dust=100;return c;}
function gear(c){const it=c.makeEquipment(100,{rarity:6});c.G.inventory.push(it);return it;}

const fs=require('node:fs');
test('中央石頭數量可超過舊六格上限，按配方與持有量限制',()=>{
 const c=setup();c.forgeSetOperation('imprint');c.forgePlaceItem(gear(c).id);
 c.forgeSetStones(100);assert.equal(c.forgeDustCount(),60);
 c.G.player.dust=7;c.forgeSetStones(100);assert.equal(c.forgeDustCount(),7);
 assert.ok(c.forgeSetStones(-1));assert.ok(c.forgeSetStones(1.2));
});
test('介面提供中央數量、至100%與金幣費用，移除舊自動控制',()=>{
 const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
 for(const id of ['forge-stone-count','forge-stone-max','forge-cost'])assert.ok(html.includes('id="'+id+'"'));
 assert.doesNotMatch(html,/id="forge-autodust"|id="forge-autoforge"|id="forge-progress"/);
});
