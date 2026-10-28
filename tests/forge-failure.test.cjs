'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {loadRuneEnv}=require('./helpers/runeword-env.cjs');
function setup(){const c=loadRuneEnv();c.G.player.reincarnations=5;c.G.player.gold=1e12;c.G.player.dust=100;return c;}
function gear(c){const it=c.makeEquipment(100,{rarity:6});c.G.inventory.push(it);return it;}

test('新版失敗不再產生神性之石，隨機消耗3至4件',()=>{
 for(const lost of [3,4]){
  const c=setup(),items=Array.from({length:6},()=>gear(c));items.forEach(it=>c.forgePlaceItem(it.id));
  c.chance=()=>false;c.ri=(a,b)=>a===3?lost:a;
  assert.equal(c.doForge(),null);assert.equal(c.G.inventory.length,6-lost);
  assert.equal(c.G.player.dust,100);assert.equal(c.G.player.gold,1e12-2e7);
 }
});
test('精鑄失敗裝備與其內容消失，庫存中未投入物件保留',()=>{
 const c=setup(),a=gear(c),b=gear(c);a.sockets=[{type:'ruby',level:10}];c.forgeSetOperation('ancient');c.forgePlaceItem(a.id);c.chance=()=>false;
 assert.equal(c.doForge(),null);assert.deepEqual(Array.from(c.G.inventory,it=>it.id),[b.id]);
 assert.equal(c.gemCount('ruby',10),0);
});
