const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const geo=require('../tools/skills2-geometry.cjs'),tables=require('../tools/config_tables.cjs');
test('範圍格式：空格、矩形各軸增量、圓形半徑、未填增量',()=>{
 assert.deepEqual(geo.parse('10 * 10 , 1 * 1',true),{base:[10,10],per:[1,1],hasGrowth:true});
 assert.deepEqual(geo.parse('6,1'),{base:[6],per:[1],hasGrowth:true});
 assert.deepEqual(geo.parse('6'),{base:[6],per:[0],hasGrowth:false});
 assert.equal(geo.parse(' '),null);
 assert.deepEqual(geo.parse('20*5,2*0.5',true).per,[2,.5]);
});
test('拒絕混用形狀、半套增量、非有限值及負範圍',()=>{
 for(const raw of ['6*6','6,','6,1,2','-6','NaN','Infinity','6,-1'])assert.throws(()=>geo.parse(raw));
 for(const raw of ['6','10*10,1','10*10,1*','10*10*10'])assert.throws(()=>geo.parse(raw,true));
});
test('搜敵、傷害、路徑、碰撞用途不能互相覆蓋；未接線拒絕輸入',()=>{
 const values={[geo.labels.search]:'20,1',[geo.labels.damage]:'100*10,2*1'};
 assert.deepEqual(geo.apply('gale','thunderFlash',{},c=>values[c]).fx,{m:20,mPer:1,len:100,lenPer:2,wid:10,widPer:1});
 assert.throws(()=>geo.apply('gale','4',{},c=>c===geo.labels.damage?'12':''));
 assert.equal(geo.extract('gale','4',{m:12},'')[geo.labels.search],'12');
 assert.equal(geo.extract('windblade','1',{m:80},'4*8')[geo.labels.body],'4*8');
 assert.equal(geo.extract('windblade','1',{m:80},'4*8')[geo.labels.travel],'80');
 assert.deepEqual(geo.apply('waterball','7',{},c=>c===geo.labels.placement?'10*12,1*2':'').fx,{side:10,sidePer:1,sideWidth:12,sideWidthPer:2});
});
test('新版匯出往返不遺失230列技能、特效與範圍資料',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../js/skills2.js'),'utf8'),schema=tables.SCHEMAS.Skills2;
 const before=tables.evalLiteral(tables.extractLiteral(source,'SKILLS2').literal);
 const rows=schema.extract(source);assert.equal(rows.length,230);
 const after=tables.evalLiteral(tables.extractLiteral(schema.rebuild(rows,schema.header).SKILLS2,'SKILLS2').literal);
 // 舊正方形升級為獨立長寬時，寬度明列，數值不變。
 for(const g of Object.values(before))for(const t of [...g.tiers,...g.ult])if(t.fx.side!==undefined){t.fx.sideWidth??=t.fx.side;if(t.fx.sidePer!==undefined)t.fx.sideWidthPer??=t.fx.sidePer;}
 assert.deepEqual(after,before);
});
function context(){
 const {createRequire}=require('node:module'),f=path.join(__dirname,'skill2-knife-range.test.cjs'),s=fs.readFileSync(f,'utf8');
 const scope={require:createRequire(f),__dirname,console};vm.createContext(scope);vm.runInContext(s.slice(0,s.indexOf('test('))+'\nthis.load=loadContext;',scope);return scope.load();
}
test('距離與矩形長寬依目前等級成長，升級後不使用過期值',()=>{
 const c=context();assert.deepEqual(JSON.parse(JSON.stringify(c.sgRange('10*10,1*1',3))),{length:13,width:13});
 const fx=c.SKILLS2.knife.tiers[2].fx;fx.m=6;fx.mPer=1;
 let lv=2;c.skills2Levels=()=>[1,1,lv];assert.equal(c.sgGeometryNumber(fx,'m'),8);
 lv=5;assert.equal(c.sgGeometryNumber(fx,'m'),11);
 assert.equal(c.sgGeometryNumber({m:11,mPer:1},'m'),11,'已解析的事件副本不得再加一次');
 const u=c.SKILLS2.gale.ult.find(x=>x.id==='thunderFlash');u.fx.widPer=2;c.skills2Ult=()=>({def:u,lv:3});
 assert.equal(c.sgGeometryNumber(u.fx,'wid'),16);
});
test('矩形沼澤長寬獨立傳遞，沒有把長度當成寬度',()=>{
 const c=context(),g=c.SKILLS2.mire;g.range='10*20,1*2';
 const src=fs.readFileSync(path.join(__dirname,'../js/skills2.js'),'utf8');
 // 本例同時執行真正場域生成入口，核對傷害與VFX共用的幾何資料。
 let spec;c.sgSpawnGround=(p,st,gid,s)=>{spec=s;};c.sgLegend=()=>({});c.sgMireSpec=()=>({});
 c.sgCastMire({}, {matk:100,atk:100},g,[3,0,0,0,0,0,0],[],{hp:1,pos:{x:0,y:0}},'mv-float',{});
 assert.ok(spec);assert.equal(spec.width/spec.length,2);
});
