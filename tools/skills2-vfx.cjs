'use strict';
// 額外事件已由技能邏輯接線的角色；編表者在同一列看說明並填 Preset。
const columns = [['觸發特效','attack'],['觸發子彈','projectile'],['觸發命中特效','hit'],['觸發地板特效','ground'],['觸發持續場域特效','field']];
const noteColumn = '特效作用說明';
const events = {
  'firepillar.eternalInferno': {roles:['ground'],note:'沿龍捲移動軌跡產生的火池只播放本列觸發地板特效，範圍與存續時間依火池判定，不繼承龍捲本體。'},
  'fireball.starfallCataclysm': {roles:['attack'],note:'超巨型殞石落地時，在角色當下中心播放一次全場爆炸；小型受擊另讀本列本體命中特效，各自依 Preset 持續時間播放。'},
  'firepillar.5': {roles:['attack','hit'],note:'每道火龍捲消失時播放一次範圍爆炸及受擊；不隨平時傷害跳動播放，不重播龍捲場域。'},
  'bloodrage.7': {roles:['attack','hit'], note:'狂怒期間每次普攻在主目標位置播放一次範圍爆炸，匹配多目標普攻半徑；實際命中的敵人各播放原尺寸小型命中特效，追加目標同時結算與播放。'},
  'counter.holyBody': {roles:['attack','projectile'], note:'反擊滿計數後發射一顆光彈；觸發子彈飛到本次鎖定的目標位置，抵達時結算範圍傷害並在落點播放一次觸發特效。爆炸匹配傷害半徑，不在每個受害者身上重播。'},
  'counter.indomitable': {roles:['ground'], note:'復甦開始時於玩家位置播放天降光束，持續至復甦結束，不在每個敵人身上播放。'},
  'cleave.windChaser': {roles:['ground','field'], note:'每次迴旋斬命中，在敵人位置產生龍捲風；固定命中位置，依龍捲風傷害半徑縮放。'},
  'gale.thunderFlash': {roles:['attack'], note:'本體最後一擊後，按次數與間隔重新選敵並播放貫穿雷電；沿玩家與目標連線，匹配雷電長度及寬度。'},
  'gale.thunderGodSlash': {roles:['attack','hit'], note:'本體及爆散每次命中，在該敵人位置落雷；依落雷傷害範圍縮放。'},
  'bloodblade.5': {roles:['projectile','hit'], note:'中毒每次作用時機率感染；由中毒敵人向每個受感染者發射，抵達後感染並播放命中特效；單體維持原尺寸。'},
  'bloodblade.6': {roles:['attack'], note:'流血或中毒敵人死亡時，在死亡位置播放屍爆；選取周邊受害者的距離不是特效縮放範圍。'},
  'bloodblade.7': {roles:['attack'], note:'每次持續傷害機率提前結算剩餘傷害時，在該敵人位置播放；傳染搜尋距離不是傷害範圍，維持原尺寸。'},
  'bloodblade.venomDomain': {roles:['attack','hit'], note:'領域每拍對範圍內的敵人播放觸發／命中特效；領域本身（跟著玩家、依半徑縮放）的畫面是狀態表「萬毒血霧」的持續特效。'},
  'bloodblade.disintegrate': {roles:['attack','projectile','hit'], note:'每次中毒／流血結算後，在原敵人位置播放範圍爆炸；觸發子彈由此飛向各受害者，抵達後結算並播放命中特效。中心匹配爆炸半徑，單體抵達特效維持原尺寸。'}
};
for (const stage of ['1','2','3','4','5','6','7','slayerAdvent','warGodRoll','asuraFist']) {
  events['bloodrage.'+stage]={roles:['attack','hit'],note:'狂怒系列普攻事件：攻擊特效於主目標播放一次，命中特效於每個實際受傷敵人播放；第七階前單體維持原尺寸，多目標普攻依實際半徑縮放。阿修羅效果生效期間亦可播放。'};
}
function event(gid,stage){return events[gid+'.'+stage];}
function note(gid,stage){
  const e=event(gid,stage);
  if(gid==='bloodrage'&&e)return '本體欄與觸發欄獨立。觸發欄：'+e.note+' 觸發攻擊／命中特效逐階同角色繼承，超神非空欄覆寫；其他觸發角色未接線。狀態光殼仍由 Status 表決定。';
  return '本體欄：非空覆寫同角色，留白沿前階繼承；狀態畫面由 Status 表決定。'+
    (e ? '觸發欄：'+e.note+' 本列觸發欄留白不播放、不繼承本體或其他事件。可填：'+columns.filter(c=>e.roles.includes(c[1])).map(c=>c[0]).join('、')+'。'
    : '本列未接獨立觸發欄；特效沿用本體事件派送（包括使用本體外觀的追加攻擊）。')+
    ' 有傷害範圍時匹配傷害範圍；單體維持原尺寸，不以搜敵距離縮放。';
}
function validate(gid,stage,vfx){
  const e=event(gid,stage);
  for(const [label,key] of columns){
    if(!vfx||!vfx[key])continue;
    if(!e||!e.roles.includes(key))throw Error('Skills2 '+gid+'/'+stage+' 未接線「'+label+'」，不可填入而不生效');
    if(!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(vfx[key]))throw Error('Skills2 '+gid+'/'+stage+'「'+label+'」須填 Preset 名稱，不是用途標籤');
  }
}
const help=[
 ['本體特效與觸發特效在同一技能列分開填寫；「特效作用說明」為程式產生的唯讀說明。'],
 ['本體六欄留白沿前階同角色繼承；觸發五欄僅供同列已接線事件，留白不播放、不繼承。'],
 ['觸發特效填 Preset 名稱，不填「附加效果」。未支援的觸發角色填值會拒絕匯入。'],
 ['有傷害範圍的特效依實際傷害範圍縮放；單體維持原尺寸。搜尋／施放距離不能充當傷害範圍。'],
 ['狀態的施加、持續及作用特效只由 Status 表決定；Skills2 觸發特效不取代狀態畫面。']
];
module.exports={columns,noteColumn,events,event,note,validate,help};
