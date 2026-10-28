'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {loadRuneEnv}=require('./helpers/runeword-env.cjs');
function setup(){const c=loadRuneEnv();c.G.player.reincarnations=5;c.G.player.gold=1e12;c.G.player.dust=100;return c;}
function gear(c){const it=c.makeEquipment(100,{rarity:6});c.G.inventory.push(it);return it;}

test('新版操作即時結算，不留計時、自動補料或重複結算',()=>{
 const c=setup(),a=gear(c);c.forgeSetOperation('ancient');c.forgePlaceItem(a.id);c.forgeSetStones(60);
 assert.equal(c.doForge(),null);assert.equal(c.G.inventory.length,1);
 assert.equal(c.G.forge.crafting,undefined);assert.equal(c.G.forge.autoForge,undefined);
 const after=JSON.stringify(c.G);c.forgeTick(Date.now()+1e9);assert.equal(JSON.stringify(c.G),after);
 assert.ok(c.doForge());assert.equal(JSON.stringify(c.G),after);
});
test('缺錢在執行前拒絕，金幣、素材、預選神性之石都保留',()=>{
 const c=setup(),it=gear(c);c.forgeSetOperation('imprint');c.forgePlaceItem(it.id);c.forgeSetStones(60);c.G.player.gold=1;
 const before=JSON.stringify(c.G);assert.ok(c.doForge());assert.equal(JSON.stringify(c.G),before);
});
