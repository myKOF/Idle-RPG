const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
function load(){
 const c=vm.createContext({console,Math,UI:{dirty:{}}});c.window=c;
 for(const name of ['util','data','status','formula','skills2'])vm.runInContext(fs.readFileSync('js/'+name+'.js','utf8'),c);
 c.G={player:{loadout:['sg:earthguard'],skills2:{levels:{earthguard:Array(7).fill(10)},ult:{}}}};
 return c;
}
const base=()=>({hp:10000,hpRegen:100,mp:1000,mpRegen:50,lifesteal:20,manaSteal:10,elemDmgUp:{fire:40},globalDmgRed:100});
test('裝配大地守護：回復三倍、汲取兩倍，展示等於戰鬥結算且不污染原值',()=>{
 const c=load(),st=base(),before=JSON.stringify(st),p=c.playerPanelStats(st).passivePanel;
 assert.equal(p.hpRegen,c.playerHpRegenBasePerSec(st)*3);assert.equal(p.mpRegen,150);
 assert.equal(p.lifesteal,40);assert.equal(p.manaSteal,20);
 assert.equal(p.hpDrain,c.lifestealHealAmount(st,20));assert.equal(p.mpDrain,c.manaStealAmount(st,10));
 assert.equal(p.elemPct,50);assert.ok(Math.abs(p.damageRed-20)<1e-9);
 assert.equal(JSON.stringify(st),before);
 assert.equal(c.playerHpRegenPerSec(st),p.hpRegen);
 const projected=c.playerPanelStats(st);assert.ok(Math.abs(c.passivePanelElement(projected,'fire')-110)<1e-9);
 assert.equal(c.playerPanelStats(projected).passivePanel.hpRegen,p.hpRegen,'重複投影不重複乘算');
});
test('卸下及未學習都移除加成；光耀之堂只額外放大回復，失效後退回',()=>{
 const c=load(),st=base();c.G.player.skills2.ult.earthguard={pick:0,lv:10};
 const p=c.playerPanelStats(st).passivePanel;
 assert.equal(p.mpRegen,900);assert.equal(p.manaSteal,20);
 c.G.player.skills2.levels.earthguard[6]=9;
 assert.equal(c.playerPanelStats(st).passivePanel.mpRegen,150);
 c.G.player.loadout=[];
 const off=c.playerPanelStats(st).passivePanel;assert.equal(off.mpRegen,50);assert.equal(off.manaSteal,10);assert.equal(off.damageRed,0);assert.equal(off.elemPct,0);
 c.G.player.loadout=['sg:earthguard'];c.G.player.skills2.levels.earthguard=Array(7).fill(0);
 assert.equal(c.playerPanelStats(st).passivePanel.mpRegen,50);
});
test('序列化後無 G 的 UI 仍顯示正確回復／汲取；預覽套使用自己的基準',()=>{
 const c=load(),st=base(),snap=JSON.parse(JSON.stringify(c.playerPanelStats(st)));
 const preview=c.playerPanelStats({...st,hp:20000,mpRegen:70});assert.equal(preview.passivePanel.mpRegen,210);
 const rows=c.STAT_GROUPS.flatMap(g=>g.rows),byName=name=>rows.find(r=>r[0].includes(name));
 delete c.G;
 assert.equal(byName('法力恢復')[1](snap),c.statFmt(150,null,'/s'));
 assert.equal(byName('吸魔')[1](snap),c.statFmt(20,c.STAT_CAPS.manaSteal,'%.1f'));
 assert.match(byName('吸魔')[2](snap),/汲取換算基準/);
 assert.equal(byName('火屬性傷害提升')[1](snap),c.statFmt(110,null,'%',true));
 assert.equal(byName('法力恢復')[1](st),c.statFmt(50,null,'/s'),'舊快照相容');
});
test('裝卸技能協議立即更新屬性與裝備預覽',()=>{
 const protocol=require('../js/worker/protocol.js');
 for(const action of ['equipLoadout','unequipLoadout']){
  const dirty=protocol.COMMANDS['skill.'+action].dirty;assert.ok(dirty.includes('header'));assert.ok(dirty.includes('equip'));
 }
});
test('正式 Worker header 快照在裝卸後重新投影，保留戰鬥與預覽原始物件',()=>{
 const c=load(),src=fs.readFileSync('js/worker/sim.worker.js','utf8');
 vm.runInContext(src.slice(src.indexOf('function buildPanel('),src.indexOf('/* ---- 存檔 ----')),c);
 const battle=base(),preview={...base(),mpRegen:80};c.getStats=()=>battle;c.getViewStats=()=>preview;
 const equipSrc=fs.readFileSync('js/skills.js','utf8');
 vm.runInContext(equipSrc.slice(equipSrc.indexOf('function equipSkillToLoadout('),equipSrc.indexOf('/* ---- 施放條件')),c);
 c.loadoutSize=()=>10;let dirty=0;c.markStatsDirty=()=>dirty++;
 assert.equal(c.buildPanel('header').viewStats.passivePanel.mpRegen,240);
 c.unequipSkillFromLoadout('sg:earthguard');
 assert.equal(c.buildPanel('header').stats.passivePanel.mpRegen,50);
 assert.equal(c.buildPanel('header').viewStats.passivePanel.mpRegen,80);
 assert.equal(c.equipSkillToLoadout('sg:earthguard'),null);
 assert.equal(c.buildPanel('header').stats.passivePanel.mpRegen,150);assert.equal(dirty,2);
 assert.equal(battle.passivePanel,undefined);assert.equal(preview.passivePanel,undefined);
});
