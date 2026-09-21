'use strict';
// 表格用途到既有模擬欄位的明確接線；不依描述文字猜測用途。
const labels = {
 cast:'施放距離（米）', search:'搜敵範圍（米）', damage:'傷害範圍（米）',
 effect:'狀態／控制範圍（米）', trigger:'觸發偵測範圍（米）',
 body:'碰撞體尺寸（米；長*寬）', orbit:'環繞半徑（米）', travel:'飛行距離（米）',
 extend:'貫穿追加距離（米）', spacing:'生成／環間間距（米）',
 step:'每次施放追加半徑（米）', wander:'游走範圍（米）',
 placement:'生成位置範圍（米）', height:'拋物線高度（米）',
 grow:'每秒半徑擴張（米／秒）', curtain:'光幕寬度（米）',
 gap:'每段或每跳間隔（秒）', deg:'發射夾角（度）', speed:'飛行子彈速度（米／秒）',
 rangePct:'範圍增幅（%）'
};
const columns=Object.values(labels);
const routes={};
function route(kind,rows){rows.split(/\s+/).filter(Boolean).forEach(id=>{if(routes[id])throw Error('重複範圍用途 '+id);routes[id]=kind;});}
route('damage',`thrust/phantomOcta cleave/1 cleave/windChaser gale/1 gale/7 gale/thunderGodSlash
 bloodblade/venomDomain bloodblade/disintegrate counter/holyBody counter/indomitable bloodrage/slayerAdvent
 fireball/1 fireball/7 firepillar/1 firepillar/5 firehunt/fireGodDescend mire/abyssInferno
 thunderstrike/7 thunderorb/1 thunderorb/7 icearrow/7 icearrow/tearsOfIce waterball/1 waterball/4
 waterball/7 waterball/ragingTide frostnova/1 frostnova/2 frostnova/iceKingDomain windblade/6 vacuumslash/4 stormbarrier/2 stormbarrier/skyfallStars`);
route('search',`knife/3 knife/soulhunterBlade gale/4 gale/thunderFlash bloodblade/7 counter/7
 fireball/3 fireball/5 firepillar/3 firepillar/6 mire/4 earthguard/6 chainlightning/1 chainlightning/5
 chainlightning/eternalSuperconductor chainlightning/flyingThunderGod thunderstrike/heavenTribulation
 thunderorb/thunderBurst waterball/5 frostnova/crystalResonance vacuumslash/1 stormbarrier/5`);
route('effect',`dualdance/5 firepillar/dragonDevour rockarmor/superRockArt rockarmor/gravityField thunderstrike/5 waterball/waterPrisonFall waterball/abyssBurial`);
route('trigger',`bloodblade/slayerDomain bloodrage/6 fireball/6`);
route('travel',`cleave/6 icearrow/4 windblade/1`);
route('orbit',`firehunt/1 firehunt/infiniteRing thunderorb/4 vacuumslash/7 vacuumslash/spacetimeCollapse`);
route('extend','thrust/6');route('spacing','firehunt/3 firehunt/7');
route('step','frostnova/5 vacuumslash/5');route('wander','firepillar/eternalInferno');

const legacy=[['施放距離（米）','castM'],['施放距離每級增加（米）','castMPer'],
 ['作用距離（米；用途見說明）','m'],['作用距離每級增加（米）','mPer'],
 ['每段或每跳間隔（秒）','gap'],['間隔每級增減（秒）','gapPer'],
 ['矩形長度（米）','len'],['矩形長度每級增加（米）','lenPer'],
 ['矩形寬度（米）','wid'],['矩形寬度每級增加（米）','widPer'],
 ['扇形角度（度）','deg'],['角度每級增減（度）','degPer'],['飛行子彈速度（米／秒）','speed']];
const spatialKeys=['castM','m','len','wid','r','side','sideWidth','flyM','chaseM','bodyM','lenM','widthM','arcM','growM','range'];
const commonRoutes={
 gap:new Set(`cleave/windChaser gale/1 gale/thunderFlash bloodblade/venomDomain dualdance/5 dualdance/7 dualdance/flameKagura bloodrage/asuraFist fireball/4 fireball/starfallCataclysm firepillar/eternalInferno firehunt/fireGodDescend mire/plagueMire mire/abyssInferno chainlightning/skyThunderArray chainlightning/flyingThunderGod thunderstrike/1 thunderstrike/heavenTribulation thunderstrike/eternalThunderPrison thunderorb/1 thunderorb/thunderfallShatter icearrow/7 icearrow/tearsOfIce waterball/7 waterball/abyssBurial frostnova/7 frostnova/infiniteNova frostnova/crystalResonance frostnova/iceKingDomain windblade/5 windblade/6 windblade/7 vacuumslash/3 vacuumslash/vacuumOmen vacuumslash/voidAnnihilation stormbarrier/1 stormbarrier/skyfallStars`.split(' ')),
 deg:new Set('knife/1 icearrow/1 windblade/4'.split(' ')),
 speed:new Set('thrust/1 cleave/1 knife/1 bloodblade/5 bloodblade/disintegrate fireball/1 fireball/7 firepillar/7 firehunt/fireGodDescend thunderstrike/thunderMatrix thunderorb/1 icearrow/1 waterball/1 windblade/1'.split(' ')),
 rangePct:new Set('thrust/4 cleave/2 cleave/stormGodSlash'.split(' '))
};
function bindings(gid,stage){
 const id=gid+'/'+stage, b=[];
 if(id==='counter/warGodBody')b.push(['gap',['gap']]);
 if(/^[1-7]$/.test(stage))b.push(['cast',['castM']]);
 for(const kind of Object.keys(commonRoutes))if(commonRoutes[kind].has(id))b.push([kind,[kind==='rangePct'?'range':kind]]);
 if(routes[id])b.push([routes[id],['m']]);
 if(id==='gale/thunderFlash')b.push(['damage',['len','wid']]);
 if(id==='thunderstrike/thunderMatrix')b.push(['curtain',['wid']]);
 if(id==='chainlightning/flyingThunderGod')b.push(['damage',['r']]);
 if(id==='firehunt/fireGodDescend')b.push(['travel',['flyM']]);
 if(['icearrow/7','windblade/5','windblade/stormMyriad'].includes(id))b.push(['search',['chaseM']]);
 if(id==='waterball/1')b.push(['height',['arcM']]);
 if(id==='waterball/7')b.push(['placement',['side','sideWidth']]);
 if(id==='frostnova/7')b.push(['damage',['side','sideWidth']]);
 if(id==='windblade/4')b.push(['body',['lenM','widthM']]);
 if(['icearrow/7','vacuumslash/7'].includes(id))b.push(['body',['bodyM','bodyM']]);
 if(id==='vacuumslash/7')b.push(['grow',['growM']]);
 if(stage==='1'&&['thrust','mire','firehunt','thunderorb','windblade'].includes(gid))b.push([['thrust','mire'].includes(gid)?'damage':'body',['@range']]);
 return b;
}
function parse(text,rect=false){
 const s=String(text).trim();if(!s)return null;
 const number='(?:\\d+(?:\\.\\d+)?|\\.\\d+)';
 const dim=rect?'('+number+')\\s*\\*\\s*('+number+')':'('+number+')';
 const inc=rect?'([+-]?'+number+')\\s*\\*\\s*([+-]?'+number+')':'([+-]?'+number+')';
 const m=new RegExp('^'+dim+'(?:\\s*,\\s*'+inc+')?$').exec(s);
 if(!m)throw Error('格式錯誤「'+s+'」：請填 '+(rect?'10*10 或 10*10,1*1':'6 或 6,1'));
 const size=rect?2:1,base=m.slice(1,1+size).map(Number),per=m.slice(1+size).map(v=>v===undefined?0:Number(v));
 if(base.some(n=>!Number.isFinite(n)||n<0)||per.some(n=>!Number.isFinite(n)))throw Error('範圍數值不合法');
 if(base.some((n,i)=>n+per[i]*10<0))throw Error('升到10級後範圍不得為負數');
 return {base,per,hasGrowth:m[1+size]!==undefined};
}
function format(base,per){return base.join('*')+(per.some(v=>v!==undefined)?','+per.map(v=>v||0).join('*'):'');}
function extract(gid,stage,fx,range){
 const cells=Object.fromEntries(columns.map(c=>[c,'']));
 for(const [kind,keys] of bindings(gid,stage)){
  if(keys[0]==='@range'){if(range)cells[labels[kind]]=range;continue;}
  if(fx[keys[0]]===undefined)continue;
  const base=keys.map(k=>fx[k]===undefined?fx[keys[0]]:fx[k]),per=keys.map(k=>fx[k+'Per']);
  cells[labels[kind]]=format(base,per);
 }
 if(fx.m!==undefined&&!routes[gid+'/'+stage])throw Error('尚未分類 m：'+gid+'/'+stage);
 return cells;
}
function strip(fx){const out={...fx};for(const k of [...spatialKeys,'gap','deg','speed']){delete out[k];delete out[k+'Per'];}return out;}
function apply(gid,stage,fx,get){
 const out=strip(fx),used=new Set();let range;
 for(const [kind,keys] of bindings(gid,stage)){
  const label=labels[kind],raw=get(label);used.add(label);if(!String(raw||'').trim())continue;
  const v=parse(raw,keys.length===2||keys[0]==='@range');
  if(kind==='speed'&&v.base[0]<=0)throw Error('飛行速度必須大於零');
  if(keys[0]==='@range'){range=format(v.base,v.hasGrowth?v.per:[]);continue;}
  if(keys.length===2&&keys[0]===keys[1]&&(v.base[0]!==v.base[1]||v.per[0]!==v.per[1]))throw Error('此環繞體目前使用等徑碰撞，長寬及增量須相同');
  keys.forEach((k,i)=>{out[k]=v.base[i];if(v.hasGrowth)out[k+'Per']=v.per[i];});
 }
 for(const c of columns)if(!used.has(c)&&String(get(c)||'').trim())throw Error(gid+'/'+stage+' 未接線「'+c+'」，不可填入而不生效');
 return {fx:out,range};
}
const help=[
 ['範圍欄位 v2：用途分欄，基值與每級增量合併'],
 ['格式：6＝圓形半徑6米；6,1＝半徑底值6、每級+1。10*10,1*1＝矩形長寬底值各10、每級各+1。'],
 ['沿用既有公式：實際值＝底值＋每級增量×等級，Lv.1 已計入一次增量；沒有逗號表示不成長。'],
 ['距離、高度、間距及寬度欄是線性米數，不表示圓面積。只有範圍欄的單值表示半徑。'],
 ['施放距離只決定能否起手；搜敵範圍只選目標，不控制傷害範圍或特效尺寸。'],
 ['傷害範圍控制實際群體命中；碰撞體尺寸控制飛行／環繞物自身接觸判定。空白＝此階未設定，沿用技能既有繼承或單體邏輯，不是0。'],
 ['用途以各欄為準，中心／方向及疊加方式參照作用方式說明。範圍形狀沿用技能已實作的判定：圓形欄不能擅改矩形；未接線的欄位會拒絕匯入，不會靜默忽略。'],
 ['生成位置範圍只安排生成座標，不是傷害；環繞半徑與飛行距離只控制路徑。'],
 ['狀態／控制範圍：暈眩、減益、吸引等；觸發偵測範圍：計算死亡／受傷／燃燒事件，不造成額外範圍傷害。'],
 ['貫穿追加距離、每次施放追加半徑及生成／環間間距是增量用途，其逗號後仍為每級增量。'],
 ['間隔、發射夾角、飛行速度及範圍百分比也採底值,每級增量。發射夾角不是傷害扇形。'],
 ['效果JSON不再存放上述幾何鍵。舊資料可讀取遷移，但新版表格是唯一編輯入口。']
];
module.exports={labels,columns,legacy,bindings,parse,extract,strip,apply,help,spatialKeys};
