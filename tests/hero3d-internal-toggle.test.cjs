'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function setup(internal,stored='0'){
 const values=new Map([['idle-rpg.hero3d.v1',stored]]),listeners={},button={hidden:true,setAttribute(k,v){this[k]=v;},addEventListener(k,v){listeners[k]=v;}};
 let reloads=0,imports=0;
 const c=vm.createContext({isInternalServer:()=>internal,localStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},$id:()=>button,location:{reload(){reloads++;}}});
 vm.runInContext(fs.readFileSync(root+'/js/strings_data.js','utf8'),c);
 c.STR=(id,...args)=>String(c.STRING_DATA[id]?.[0]||'').replace(/\{(\d+)\}/g,(_,i)=>args[+i]);
 vm.runInContext(fs.readFileSync(root+'/js/hero3d.js','utf8'),c,{importModuleDynamically(){imports++;throw Error('Unexpected download');}});
 const ui=fs.readFileSync(root+'/js/ui.js','utf8');const start=ui.indexOf('function initHero3dToggle()');const end=ui.indexOf('\nfunction initUI()',start);
 assert(start>=0&&end>start);vm.runInContext(ui.slice(start,end),c);c.initHero3dToggle();
 return {c,button,listeners,reloads:()=>reloads,imports:()=>imports};
}
test('正式環境即使留有3D偏好，也不啟用、不顯示控制或下載模型',()=>{
 const t=setup(false,'1');assert.equal(t.c.Hero3D.enabled(),false);assert.equal(t.button.hidden,true);assert.equal(t.listeners.click,undefined);assert.equal(t.imports(),0);
});
test('內測兩種按鈕與提示用新編號，轉生及傳奇字串保持原意',()=>{
 for(const state of ['0','1']){const t=setup(true,state);assert.equal(t.button.hidden,false);assert.equal(t.button.textContent,state==='1'?'動畫：3D 骨架（內測）':'動畫：2D 序列幀（內測）');t.listeners.click();assert.equal(t.c.Hero3D.enabled(),state!=='1');assert.equal(t.reloads(),1);assert.equal(t.imports(),0);assert.match(t.c.STR(2146,'轉生',250,'轉生'),/250/);assert.match(t.c.STR(2153),/內測專用/);}
 assert.match(fs.readFileSync(root+'/index.html','utf8'),/id="btn-hero3d"[^>]*data-tip:2153/);
});
test('GLB保留來源的五個動畫、綁定與嵌入貼圖',()=>{
 const bytes=fs.readFileSync(root+'/images/models/hero3d/sunbrand-knight.glb');assert.equal(bytes.readUInt32LE(0),0x46546c67);assert.equal(bytes.readUInt32LE(4),2);assert.equal(bytes.readUInt32LE(8),bytes.length);
 const data=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString('utf8').trim());
 assert.deepEqual(data.animations.map(a=>a.name).sort(),['Attack1','Attack2','CombatIdle','Death','Run']);assert(data.skins[0].joints.length>=20);assert(data.images.every(i=>i.bufferView!==undefined&&!i.uri));
});
