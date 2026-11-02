'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{extractFunction}=require('./helpers/battle-scene.cjs'),png=require('../tools/vfx/vfx-image-facts.cjs')._internal;
const root=path.resolve(__dirname,'..'),src=fs.readFileSync(path.join(root,'js/battle-renderer.js'),'utf8');
test('所有NPC四動作與通用BOSS均有黑描邊，線寬設定最多2px',()=>{
 const m=JSON.parse(fs.readFileSync(path.join(root,'images/sprites/npc/npc.json'))),o=JSON.parse(fs.readFileSync(path.join(root,'images/sprites/npc/outline.json'))),boss=JSON.parse(fs.readFileSync(path.join(root,'images/sprites/boss_generic.json')));
 assert.equal(o.radius,2);assert.equal(o.color,'#000000');assert.equal(o.files.length,Object.keys(m.stems).length+1);assert.equal(new Set(o.files).size,o.files.length);
 for(const [stem,meta]of Object.entries(m.stems)){
  assert.ok(o.files.includes('npc/'+stem+'.png'),stem+' outline export missing');const c=m.chars[meta.char],chunks=png.readPngChunks(fs.readFileSync(path.join(root,'images/sprites/npc',stem+'.png'))),h=png.parseIhdr(chunks.ihdr),pixels=png.decodeToRgba(h,chunks);assert.equal(h.width,c.cellW*meta.frames);assert.equal(h.height,c.cellH);
  for(let f=0;f<meta.frames;f++){let opaque=0,black=0;for(let y=0;y<c.cellH;y++)for(let x=0;x<c.cellW;x++){const p=(y*h.width+f*c.cellW+x)*4;if(pixels[p+3]<128)continue;opaque++;if(pixels[p]===0&&pixels[p+1]===0&&pixels[p+2]===0)black++;}if(opaque)assert.ok(black>0,stem+' frame '+f+' missing black contour');}
 }
 assert.ok(o.files.includes('boss_generic.png'));assert.equal(boss.frameWidth,144);assert.equal(boss.frameHeight,144);
});
test('菁英與BOSS的內部混色略過黑色邊線，其他本體色彩及透明度仍可混色',()=>{
 const c={};vm.createContext(c);vm.runInContext(extractFunction(src,'whitenNpcBlendPixels'),c);const pixels=new Uint8ClampedArray([0,0,0,255,8,8,8,128,20,50,90,201,255,140,20,255,200,80,20,0]);c.whitenNpcBlendPixels(pixels);assert.deepEqual([...pixels],[255,255,255,0,255,255,255,0,255,255,255,201,255,255,255,255,255,255,255,0]);
});
test('通用BOSS圖使用與NPC相同的描邊快取版號，保留原動作幀數',async()=>{
 const urls=[],m=JSON.parse(fs.readFileSync(path.join(root,'images/sprites/boss_generic.json'))),c={S:{sheets:{}},fetch:async u=>{urls.push(u);return{ok:true,json:async()=>m};},PIXI:{Assets:{load:async u=>{urls.push(u);return{source:{}};}},Texture:class{constructor(v){Object.assign(this,v);}},Rectangle:class{constructor(x,y,width,height){Object.assign(this,{x,y,width,height});}}},buildNpcRankMasks(){},Date};vm.createContext(c);vm.runInContext(extractFunction(src,'loadSheet'),c);await c.loadSheet('boss','images/sprites/boss_generic',{assetVersion:'black-outline-test'});assert.equal(urls[1],'images/sprites/boss_generic.png?v=black-outline-test');assert.deepEqual(Object.fromEntries(Object.entries(c.S.sheets.boss.anims).map(([k,v])=>[k,v.length])),{idle:4,attack:5,hurt:2});
});
