'use strict';
// 額外事件已由技能邏輯接線的角色；編表者在同一列看說明並填 Preset。
const columns = [['觸發特效','attack'],['觸發子彈','projectile'],['觸發命中特效','hit'],['觸發地板特效','ground'],['觸發持續場域特效','field']];
const noteColumn = '特效作用說明';
const events = {
  'windblade.4': {roles:['projectile','hit'],note:'額外直射小型風刃只讀本階觸發子彈及命中特效；保留主風刃的外觀、航向及各波發射時間。'},
  'windblade.5': {roles:['ground','hit'],note:'追跡小風刃只讀本階觸發地板與命中特效；沿權威位置及轉速持續播放，不另發射直線大風刃。'},
  'windblade.6': {roles:['attack','hit'],note:'大型風刃沿途脈衝只讀本階觸發與命中特效，匹配脈衝半徑；主刃及小風刃不繼承爆點。'},
  'windblade.stormMyriad': {roles:['ground','hit'],note:'追蹤大型風刃只讀本超神觸發地板與命中特效；小型追跡風刃仍讀第五階，不混入直射或沿途脈衝。'},
  'vacuumslash.2': {roles:['attack'],note:'前方真空斬的追加震波只讀本階觸發特效，沿施放方向；普通斬擊及迴旋斬外觀分開。'},
  'vacuumslash.7': {roles:['attack','projectile','hit','ground'],note:'額外虛空斬只讀本階觸發角色；環繞體與軌道依實際半徑及成長播放，接觸只播命中特效，不重新發射。虛空滅界與時空崩解共用本列。'},
  'vacuumslash.vacuumOmen': {roles:['ground','hit'],note:'命中觸發的靜止真空斬只讀本超神地板與命中特效，保持出生位置且按權威半徑成長；普通斬擊不繼承靜止場域。'},
  'stormbarrier.2': {roles:['ground','hit'],note:'屏障每拍撕裂只播本階觸發地板，跟隨玩家且匹配傷害半徑；命中特效另播在實際受害者，不播在玩家身上。'},
  'stormbarrier.3': {roles:['hit'],note:'每拍成功附加亂風切時，只對實際目標播放本階觸發命中特效；風切本身畫面由Status表提供。'},
  'stormbarrier.4': {roles:['projectile','hit'],note:'屏障受擊觸發的貫穿風刃只讀本階觸發子彈與命中特效，沿攻擊者方向；不套用其他技能或超神外觀。'},
  'stormbarrier.5': {roles:['projectile','hit'],note:'風切結束時，向每個實際受感染者各播一條來源到目標的觸發子彈與命中特效；不借播屏障反擊或虛空斬。'},
  'stormbarrier.skyfallStars': {roles:['attack','projectile','hit','ground'],note:'追加天降星體與屏障分離。火殞石讀本列觸發角色；雷殞石借雷球第七階觸發外觀；巨大風刃借風刃第一階子彈／命中與第六階爆點。三者都在固定落點落地後結算八米範圍，星體屬性各自為火／雷／風。'},
  'stormbarrier.myriadPhenomena': {roles:['attack','projectile','hit','ground'],note:'追加虛空斬讀本列觸發角色；追加四方向風刃借風刃第一階本體子彈／命中，不讀玩家在風刃樹的超神。屏障撕裂／反擊／擴散仍各讀自身階段。'},
  'icearrow.tearsOfIce': {roles:['projectile','hit'],note:'額外箭雨每波只讀本列觸發子彈與命中特效，從每個受害者上方落下；普通發射及追蹤冰箭不繼承箭雨角色。'},
  'waterball.4': {roles:['attack'],note:'水流彈每次落地在權威落點播放一次觸發爆散，匹配本次傷害半徑；起飛及寒霜擴散不播放爆散。'},
  'waterball.5': {roles:['projectile','hit'],note:'寒霜成功擴散時，由原敵人向每個實際受感染者分別播放觸發子彈與命中特效；普通水彈不繼承此冰晶外觀，搜敵距離不放大特效。'},
  'waterball.7': {roles:['field'],note:'額外水龍捲只播放本列觸發持續場域，每道沿權威位置與半徑續播；普通水彈起飛及落地不播放龍捲。'},
  'waterball.ragingTide': {roles:['ground'],note:'達到水龍捲數量門檻後，巨大水龍捲只播放本列觸發地板特效；不混入普通水彈或第七階龍捲。'},
  'waterball.abyssBurial': {roles:['hit'],note:'永久領域每拍施加寒霜時只播放本列觸發命中特效；領域外殼仍讀Status表，普通水彈命中不繼承領域每拍特效。'},
  'frostnova.7': {roles:['ground'],note:'額外暴風雪只播放本列觸發地板特效，矩形範圍及跟隨中心取權威場域；新星爆發、凍結、死亡新星及共鳴不播放暴風雪。'},
  'frostnova.crystalResonance': {roles:['projectile','hit'],note:'冰晶共鳴每條實際傷害連線各自讀本列觸發子彈及命中特效，從來源敵人到受害者；普通新星及暴風雪不繼承共鳴冰晶。'},
  'frostnova.iceKingDomain': {roles:['ground'],note:'每根額外冰錐只讀本列觸發地板特效，固定在生成位置並匹配傷害半徑；暴風雪仍用第七階觸發地板，不變為冰錐或水龍捲。'},
  'icearrow.7': {roles:['attack'],note:'追蹤冰箭本體沿用飛行子彈欄並沿權威移動航向連續播放；敵人凍結結束時，在該敵人的當下位置播放一次觸發特效，匹配冰爆傷害半徑。觸發特效不在冰箭發射、追蹤或普通命中時播放。'},
  'chainlightning.flyingThunderGod': {roles:['field'],note:'每波逐道生成全場貫穿雷電；每道出生時以隨機兩名不同敵人連線決定固定方向；只有一名敵人時改用玩家與該敵人連線，零敵人時才略過，寬度、長度及持續時間由權威事件傳入。觸發持續場域不覆蓋普通雷鏈。'},
  'chainlightning.eternalSuperconductor': {roles:['projectile','hit'],note:'額外維持一道自身與範圍內敵人往返的雷鏈；觸發子彈不覆蓋普通雷鏈，追蹤抵達敵人時播放觸發命中特效，回到自身才疊層；無目標立即終止。'},
  'thunderstrike.heavenTribulation': {roles:['attack','hit'],note:'額外兩道天劫雷電每次追擊時，各在落點播放觸發特效與觸發命中特效；不覆蓋普通落雷的本體外觀，雷柱維持原尺寸，命中特效對應八米傷害半徑。'},
  'thunderorb.7': {roles:['projectile','hit','ground'],note:'額外雷殞天落的觸發子彈從天而降，觸發地板特效標示落點，落地時播放觸發命中特效並按實際傷害半徑縮放；雷殞天地碎的永久追加落雷共用本列。這些觸發欄不覆蓋普通雷球、伴生雷球或環體電球的本體外觀。'},
  'thunderorb.thunderBurst': {roles:['projectile','hit'],note:'雷球每次命中各自判定；觸發後從命中位置發出連鎖閃電，使用普通連鎖閃電的素材與尺寸，按一般雷球速度的表定倍率逐段追蹤、抵達才傷害。彈射次數含原目標，30米搜尋範圍不放大特效；觸發角色不覆蓋普通雷球或環體電球。原目標被擊殺仍從原位置彈向其他敵人，結束或玩家死亡立即回收鏈段。'},
  'firepillar.infernoTempest': {roles:['projectile','attack'],note:'每道火龍捲每0.33秒向搜敵範圍內每次重新隨機選取1名敵人平射1顆火球；觸發子彈以36米／秒追蹤敵人，主目標必中，抵達後觸發特效匹配爆炸傷害半徑。'},
  'firepillar.dragonDevour': {roles:['attack'],note:'本體持續場域播放單一火漩渦，本體子彈隨機拋向地面、不搜敵；每顆落地播放一次匹配傷害半徑的觸發特效。'},
  'mire.abyssInferno': {roles:['attack'],note:'熔岩沼每秒向範圍內至多三名不同敵人的當下位置拋出火球；本體飛行子彈沿用融火之心，落地時觸發特效匹配六米爆炸半徑。'},
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
  'bloodblade.disintegrate': {roles:['attack','projectile','hit'], note:'每次中毒／流血結算後，在原敵人位置播放範圍爆炸；觸發子彈由此飛向各受害者，抵達後結算並播放命中特效。中心匹配爆炸半徑，單體抵達特效維持原尺寸。'},
  /* 伴生火狩的外觀：沒選超神讀第三階這一列，選了超神改讀該超神列（觸發欄不繼承，每列都要自己填）。
     母體仍是本體欄的飛行子彈，所以伴生不能放在本體欄——放了母體會沿階繼承到伴生的外觀。 */
  'firehunt.3': {roles:['projectile'], note:'伴生火狩（含第七階狩神之舞出生即帶的伴生）：觸發子彈沿母體的軌道跟在母體後方繞行，依火狩體積縮放。沒選超神時用本列；選了超神改用該超神列的觸發子彈。母體是本體欄的飛行子彈。'},
  'firehunt.solarRing': {roles:['projectile'], note:'選擇本超神時伴生火狩的外觀：觸發子彈跟在母體後方繞行，依火狩體積縮放。母體讀本列本體欄的飛行子彈（留白沿前階繼承）。'},
  'firehunt.infiniteRing': {roles:['projectile'], note:'選擇本超神時伴生火狩的外觀：觸發子彈跟在母體後方繞行，依火狩體積縮放。母體讀本列本體欄的飛行子彈（留白沿前階繼承）。'},
  'firehunt.fireGodDescend': {roles:['projectile'], note:'選擇本超神時伴生火狩的外觀：觸發子彈跟在母體後方繞行，依火狩體積縮放。本列本體欄的飛行子彈是普攻射出的火狩星環，環繞的母體因此維持第一階的外觀。'}
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
