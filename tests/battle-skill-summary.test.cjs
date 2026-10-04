const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function mount() {
  const tip={innerHTML:'',style:{},classList:{add(){}}};
  const c={console,document:{addEventListener(){},querySelectorAll(){return[];},getElementById:id=>id==='sk-tooltip'?tip:null}};c.window=c;vm.createContext(c);
  for(const file of ['util','data','status','formula','battlefield','skills','skills2','ui'])vm.runInContext(fs.readFileSync(path.join(root,'js',file+'.js'),'utf8'),c,{filename:file});
  c.tip=tip;c.snap={skills2:{levels:{earthguard:Array(7).fill(10)},progress:{level:2000,reinc:20},ult:{earthguard:{pick:0,lv:10}}}};
  c.uiSkillsPanelSnapshot=()=>c.snap;c.uiTalentPanelSnapshot=()=>({});c.uiHeaderPanelSnapshot=()=>({player:{}});c.positionSkTooltip=()=>{};
  return c;
}
test('快捷列超神滿級總80，只顯示第八階效果；其他技能群組提示保留完整進化',()=>{
  const c=mount();c.showSkillTooltip('sg:earthguard',{closest:s=>s==='#battle-skill-bar'?{}:null});
  assert.match(c.tip.innerHTML,/總 Lv\.80 \/ 80/);assert.match(c.tip.innerHTML,/第8階【超神進化】/);
  assert.doesNotMatch(c.tip.innerHTML,/第[1-7]階|sg-tier-list/);
  c.showSkillTooltip('sg:earthguard',{closest:()=>null});assert.match(c.tip.innerHTML,/總 Lv\.80/);assert.match(c.tip.innerHTML,/第1階/);assert.match(c.tip.innerHTML,/第8階/);
});
test('未選超神及失效超神回到最高已學普通階，未學沒有虛構效果',()=>{
  const c=mount();delete c.snap.skills2.ult.earthguard;
  let h=c.battleSkillGroupTooltipHTML('earthguard',Array(7).fill(10),c.snap);assert.match(h,/總 Lv\.70 \/ 80/);assert.match(h,/第7階/);assert.doesNotMatch(h,/第[1-6]階/);
  c.snap.skills2.ult.earthguard={pick:0,lv:3};const lvs=[10,10,3,0,0,0,0];h=c.battleSkillGroupTooltipHTML('earthguard',lvs,c.snap);assert.match(h,/總 Lv\.26 \/ 80/);assert.match(h,/第3階/);assert.doesNotMatch(h,/第8階|第1階|第2階/);
  delete c.snap.skills2.ult.earthguard;h=c.battleSkillGroupTooltipHTML('earthguard',Array(7).fill(0),c.snap);assert.match(h,/尚未學習/);assert.match(h,/總 Lv\.0 \/ 80/);
});
test('不同超神等級加入總等級，未開放超神的群組保留原上限',()=>{
  const c=mount();c.snap.skills2.ult.earthguard.lv=4;let h=c.battleSkillGroupTooltipHTML('earthguard',Array(7).fill(10),c.snap);assert.match(h,/總 Lv\.74 \/ 80/);assert.match(h,/Lv\.4/);
  // 現有群組皆已開放超神；以未開放的定義 fixture 驗證舊群組上限。
  const gid='earthguard';c.SKILLS2[gid].ult=null;const count=c.SKILLS2[gid].tiers.length;h=c.battleSkillGroupTooltipHTML(gid,Array(count).fill(10),c.snap);assert.match(h,new RegExp('總 Lv\\.'+(count*10)+' / '+count*10));
});
