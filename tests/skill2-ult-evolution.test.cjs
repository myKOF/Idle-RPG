/* 超神進化（技能第 8 格）＋ 傳奇進化特效（2026-08-19 第一批、2026-08-20 第二、三批）
   設計來源：神力之巔_記事錄.xlsx「傳奇進化」頁籤。
   守住的事：
     1. 資料形狀：thrust／cleave／knife／gale／bloodblade／dualdance 各三個超神進化選項，
        desc 模板的 {鍵} 都在 fx 裡；30 個新傳奇特效只出現在指定武器類型，relatedSkill 指向新版技能群組
     2. 解鎖與指令：前 7 階全滿才可三選一；選定＝Lv.1 並扣款；重複選擇被拒；
        降到 Lv.0 清除選擇（可重選）；某階降級後效果失效但存檔保留
     3. 施放行為：六個群組各三個超神效果、各五個傳奇特效都真的改變了戰鬥結果
     4. 傳奇特效：legendarySkill2Mods 只合併「同群組且已生效」的 fx，數字同鍵相加
     5. 存檔與快照：面板快照帶 ult；讀檔正規化會刪掉越界／非法的紀錄

   ⚠️ 本檔刻意不驗「數字調校得對不對」（那是參數表的事），只驗「機制有沒有接上」。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const M = 10; // 1 米 ＝ 10 個戰場單位（bfMeterPx）

function loadContext(extraFiles) {
  const logs = [];
  const context = {
    console,
    Math: Object.create(Math),
    setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    UI: { dirty: {} },
    blog(message) { logs.push(message); },
    floatText() {}, trackDps() {}, recordRunDamage() {},
    logs
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js',
    'js/skills.js', 'js/skills2.js'].concat(extraFiles || [])
    .forEach((file) => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file }));
  context.G = { player: { gold: 0, skills2: { levels: {}, ult: {} }, loadout: [] }, stage: { current: 1 } };
  context.getStats = () => ({
    atk: 1000, matk: 500, hp: 1000, mp: 200, level: 10, aspd: 2, cdr: 0,
    critRate: 0, critDmg: 150, hit: 100, tenacity: 0, shieldEff: 0,
    passives: {}, elemAtk: null, elemDmgPct: 0, elemDmgUp: {},
    eliteDmg: 0, bossDmg: 0, normalDmg: 0, totalDmgPct: 0, dmgVsElem: null,
    aoeDmg: 0, globalDmgRed: 0, legendaryEffects: {}, legendaryEffectMults: {}
  });
  context.GT = 0;
  /* combat.js 會以自己的定義覆蓋這兩支（它們要讀 DPS／RUN_STATS 全域），
     所以替身必須在載入之後再蓋一次。 */
  context.trackDps = () => {};
  context.recordRunDamage = () => {};
  return context;
}

function enemy(hp, x, y, name, kind) {
  return {
    name: name || '測試怪', maxHp: hp, hp, def: 0, mdef: 0, level: 1,
    effects: {}, buffs: {}, dots: [], resist: {}, ctrlRes: 0,
    elite: kind === 'elite', isBoss: kind === 'boss',
    pos: (x === undefined) ? undefined : { x, y }
  };
}
function playerEnt() {
  return { hp: 1000, mp: 200, shield: 0, shieldMax: 0, skillCds: {}, buffs: {}, dots: [], effects: {}, _lockTarget: null };
}
function stubHits(c, opts) {
  const calls = [];
  c.resolveHit = function (attacker, defender, aCfg) {
    calls.push({ ent: defender, aCfg: aCfg, atk: aCfg.atk, elem: aCfg.skillElem, total: aCfg.totalDmgPct });
    const dmg = (opts && opts.dmg) || 100;
    defender.hp = Math.max(0, defender.hp - dmg);
    return { dmg, crit: false, miss: false, blocked: false, killed: defender.hp <= 0 };
  };
  c.applySkillFinalDamageMultiplier = function () {};
  return calls;
}
function stubVfx(c) {
  const specs = [];
  c.playCombatVfx = (spec) => specs.push(spec);
  c.enemyEventFloatTarget = (ent) => ent.name;
  c.playerEventFloatTarget = (sel) => sel;
  return specs;
}
/* 衍生傷害（擴散、處決）不經 resolveHit，改由 applyEnemyHpDamage 直接扣血；
   要分辨「第 5 階擴散」與「幻影八方陣擴散」就得看這一層的實際扣血量。 */
function stubDerived(c) {
  const hits = [];
  c.applyEnemyHpDamage = function (ent, amount) {
    hits.push({ ent: ent, amount: amount });
    ent.hp = Math.max(0, ent.hp - amount);
    return amount;
  };
  return hits;
}
function tickCtx(c, p, enemies) {
  return { pEnt: p, getEnemies: () => enemies, floatSel: 'mv-float', onDeaths() {}, onDamage() {} };
}
function run(c, p, enemies, sec, step) {
  const dt = step || 0.05;
  for (let t = 0; t < sec - 1e-9; t += dt) {
    c.GT += dt;
    c.tickSkill2(dt, tickCtx(c, p, enemies));
  }
}
function setLevels(c, gid, levels) { c.G.player.skills2.levels[gid] = levels.slice(); }
function maxLevels(c, gid) { setLevels(c, gid, [10, 10, 10, 10, 10, 10, 10]); }
function setUlt(c, gid, id, lv) {
  c.G.player.skills2.ult[gid] = { pick: c.sgUltIndexOfId(gid, id), lv: lv === undefined ? 10 : lv };
}
function equip(c, gid) { c.G.player.loadout = [c.SG_PREFIX + gid]; }
function forceRolls(c, value) { c.Math.random = () => value; }
/* 傳奇特效生效：st.legendaryEffects[key] 為真即視為裝著（legendaryHas 的判定）。 */
function setLegendary(c, keys) {
  const base = c.getStats();
  const on = {};
  keys.forEach((k) => { on[k] = true; });
  c.getStats = () => Object.assign({}, base, { legendaryEffects: on, legendaryEffectMults: {} });
}

/* ---- 1) 資料形狀 ---- */

test('超神進化：六個已開放群組各三個選項，欄位齊全且說明模板的參數鍵都存在', () => {
  const c = loadContext();
  ['thrust', 'cleave', 'knife', 'gale', 'bloodblade', 'dualdance'].forEach((gid) => {
    const list = c.sgUltDefs(gid);
    assert.ok(list, gid + ' 應有超神進化');
    assert.equal(list.length, c.SG_ULT_OPTION_COUNT, gid + ' 超神進化必須剛好三選一');
    const ids = new Set();
    list.forEach((o, i) => {
      assert.ok(o.id, gid + ' 選項 ' + (i + 1) + ' 缺 id');
      assert.ok(!ids.has(o.id), gid + ' 選項 id 重複：' + o.id);
      ids.add(o.id);
      assert.ok(o.name && o.name.length >= 2 && o.name.length <= 5, gid + ' 選項名稱長度不合理');
      assert.ok(o.goldBase > 0 && o.goldGrow >= 1, gid + ' 選項 ' + o.id + ' 升級費用不合法');
      String(o.desc || '').replace(/\{(\w+)\}/g, (m, key) => {
        assert.ok(o.fx[key] !== undefined, gid + '/' + o.id + ' 說明模板引用了不存在的參數 {' + key + '}');
        return m;
      });
    });
  });
  // 其餘 17 個群組尚未開放；火球術當控制組（設計文檔尚未給它超神進化）
  assert.equal(c.sgUltDefs('fireball'), null);
  assert.equal(c.sgSlotCount('thrust'), 8);
  assert.equal(c.sgSlotCount('fireball'), 7);
  assert.equal(c.SG_ULT_SLOT, c.SG_TIER_COUNT, '第 8 格的索引＝各階數（0-based 接在最後一階之後）');
});

test('傳奇進化三十特效：各自只出現在指定武器類型，且關聯到新版技能群組', () => {
  const c = loadContext();
  const NEW_ONES = {
    piercingFocus: ['凝鋒穿刺', 'dagger1h', 'thrust'],
    thousandWounds: ['千瘡百孔', 'dagger1h', 'thrust'],
    sunpiercerLance: ['貫日之刺', 'dagger1h', 'thrust'],
    thunderStab: ['迅雷穿刺', 'dagger1h', 'thrust'],
    heartrendBleed: ['穿心裂血', 'dagger1h', 'thrust'],
    chainSpin: ['連環迴旋', 'sword1h', 'cleave'],
    galeBladeDance: ['旋風劍舞', 'sword1h', 'cleave'],
    skyrendSlash: ['裂空飛斬', 'sword1h', 'cleave'],
    exploitWeakness: ['乘虛之斬', 'sword1h', 'cleave'],
    gatheringVortex: ['聚敵旋渦', 'sword1h', 'cleave'],
    // 2026-08-20 第二批：飛刀（匕首）／疾風斬（單手魔劍）
    knifeChain: ['連鎖', 'dagger1h', 'knife'],
    knifeSplitter: ['分裂者', 'dagger1h', 'knife'],
    knifeExecutioner: ['處刑者', 'dagger1h', 'knife'],
    knifeShadowblade: ['影刃', 'dagger1h', 'knife'],
    knifeWaltzblade: ['輪舞刃', 'dagger1h', 'knife'],
    galeWhirlwind: ['風捲殘雲', 'magicSword1h', 'gale'],
    galeExecute: ['斬殺', 'magicSword1h', 'gale'],
    galeTwinShadow: ['雙影', 'magicSword1h', 'gale'],
    galeWindwalker: ['風行者', 'magicSword1h', 'gale'],
    galeGodspeed: ['神速斬', 'magicSword1h', 'gale'],
    // 2026-08-20 第三批：血刃斬（雙手魔劍）／雙刀亂舞（雙手大劍）
    bloodPoisonBurst: ['毒爆', 'magicSword2h', 'bloodblade'],
    bloodVenomRite: ['毒血祭', 'magicSword2h', 'bloodblade'],
    bloodMist: ['血霧', 'magicSword2h', 'bloodblade'],
    bloodShadow: ['血影', 'magicSword2h', 'bloodblade'],
    bloodCleaver: ['切割', 'magicSword2h', 'bloodblade'],
    danceFrenzy: ['狂舞', 'greatsword2h', 'dualdance'],
    danceBerserker: ['狂戰士', 'greatsword2h', 'dualdance'],
    danceUnyielding: ['不屈之誓', 'greatsword2h', 'dualdance'],
    danceThousandCuts: ['殺千刀', 'greatsword2h', 'dualdance'],
    danceTwinBlades: ['雙生刃', 'greatsword2h', 'dualdance']
  };
  assert.equal(Object.keys(NEW_ONES).length, 30);
  const names = new Set();
  Object.entries(NEW_ONES).forEach(([key, [name, weapon, gid]]) => {
    const def = c.PASSIVE_POOL[key];
    assert.ok(def, key + ' 必須存在於傳奇特效池');
    assert.equal(def.name, name);
    // 使用者規格：名稱介於 2~4 個中文字
    assert.ok(name.length >= 2 && name.length <= 4, name + ' 名稱長度必須是 2~4 字');
    assert.equal(def.legendary, true);
    assert.deepEqual(Array.from(def.weaponTypes), [weapon]);
    assert.equal(def.relatedSkill, gid, key + ' 應關聯到新版技能群組 ' + gid);
    assert.ok(c.SKILLS2[def.relatedSkill], key + ' 的關聯群組不存在');
    assert.ok(def.fx && Object.keys(def.fx).length > 0, key + ' 缺 fx 規格');
    names.add(name);
  });
  assert.equal(names.size, 30, '新特效之間不得同名');
  /* 顯示名稱在整個傳奇特效池裡也必須唯一：玩家只看得到名字，
     兩個效果同名等於裝備詞條無法分辨（設計上的【神速】改名為【神速斬】即為此）。 */
  const allNames = Object.keys(c.PASSIVE_POOL).map((k) => c.PASSIVE_POOL[k].name);
  assert.equal(new Set(allNames).size, allNames.length, '傳奇特效池出現同名詞條');
  // 只在指定部位出現：抽詞條時不得漏到其他武器
  const dagger = { weaponType: 'dagger1h' };
  const sword = { weaponType: 'sword1h' };
  const magic = { weaponType: 'magicSword1h' };
  const staff = { weaponType: 'staff2h' };
  assert.ok(c.passiveAllowedForItem('piercingFocus', dagger));
  assert.ok(!c.passiveAllowedForItem('piercingFocus', staff));
  assert.ok(!c.passiveAllowedForItem('chainSpin', dagger));
  assert.ok(c.passiveAllowedForItem('knifeChain', dagger));
  assert.ok(!c.passiveAllowedForItem('knifeChain', sword));
  assert.ok(!c.passiveAllowedForItem('knifeChain', magic));
  assert.ok(c.passiveAllowedForItem('galeWindwalker', magic));
  assert.ok(!c.passiveAllowedForItem('galeWindwalker', dagger));
  const great = { weaponType: 'greatsword2h' };
  const magic2h = { weaponType: 'magicSword2h' };
  assert.ok(c.passiveAllowedForItem('bloodCleaver', magic2h));
  assert.ok(!c.passiveAllowedForItem('bloodCleaver', magic), '雙手魔劍的效果不得漏到單手魔劍');
  assert.ok(c.passiveAllowedForItem('danceTwinBlades', great));
  assert.ok(!c.passiveAllowedForItem('danceTwinBlades', magic2h));
  assert.ok(!c.passiveAllowedForItem('galeWindwalker', magic2h));
});

/* ---- 2) 解鎖與指令 ---- */

test('超神進化的唯一解鎖條件＝前 7 階全滿；未滿級時不可選也不可投資', () => {
  const c = loadContext();
  setLevels(c, 'thrust', [10, 10, 10, 10, 10, 10, 9]);
  c.G.player.gold = 1e12;
  assert.equal(c.sgUltUnlockedBy('thrust', c.skills2Levels('thrust')), false);
  assert.match(c.skills2UltPick('thrust', 0), /全部練滿/);
  maxLevels(c, 'thrust');
  assert.equal(c.sgUltUnlockedBy('thrust', c.skills2Levels('thrust')), true);
  assert.equal(c.skills2UltPick('thrust', 0), null, '前 7 階全滿即可三選一');
  // 尚未開放超神進化的群組一律拒絕
  maxLevels(c, 'fireball');
  assert.match(c.skills2UltPick('fireball', 0), /尚未開放/);
});

test('三選一：選定＝Lv.1 並扣款；已選過不得改選；降到 Lv.0 才可重選', () => {
  const c = loadContext();
  maxLevels(c, 'thrust');
  const cost0 = c.skills2UltCost('thrust', 1, 0);
  c.G.player.gold = cost0 - 1;
  assert.match(c.skills2UltPick('thrust', 1), /金幣不足/);
  c.G.player.gold = cost0;
  assert.equal(c.skills2UltPick('thrust', 1), null);
  assert.equal(c.G.player.gold, 0, '選定要扣第 1 級的金幣');
  assert.deepEqual(JSON.parse(JSON.stringify(c.G.player.skills2.ult.thrust)), { pick: 1, lv: 1 });
  assert.match(c.skills2UltPick('thrust', 2), /已選擇/, '選定後不可直接改選');

  // 升級費用曲線＝基數 × 倍率^目前等級（與各階同一條規則）
  c.G.player.gold = c.skills2UltCost('thrust', 1, 1);
  assert.equal(c.skills2UltLearn('thrust'), null);
  assert.equal(c.G.player.gold, 0);
  assert.equal(c.skills2Ult('thrust').lv, 2);

  // 降級：降到 Lv.0 時整筆清除，之後才能重新三選一
  assert.equal(c.skills2UltDowngrade('thrust'), null);
  assert.equal(c.skills2Ult('thrust').lv, 1);
  assert.equal(c.skills2UltDowngrade('thrust'), null);
  assert.equal(c.G.player.skills2.ult.thrust, undefined, '降到 Lv.0 應清除選擇');
  c.G.player.gold = cost0;
  assert.equal(c.skills2UltPick('thrust', 2), null, '清除後可重新選別的');
});

test('第 8 格走 skills2Learn／skills2Downgrade 的同一個入口（UI 只認格位索引）', () => {
  const c = loadContext();
  maxLevels(c, 'thrust');
  c.G.player.gold = 1e12;
  assert.equal(c.sgIsUltSlot('thrust', c.SG_ULT_SLOT), true);
  assert.equal(c.sgIsUltSlot('fireball', c.SG_ULT_SLOT), false, '未開放的群組沒有第 8 格');
  assert.match(c.skills2Learn('thrust', c.SG_ULT_SLOT), /請先選擇/);
  assert.equal(c.skills2UltPick('thrust', 0), null);
  assert.equal(c.skills2Learn('thrust', c.SG_ULT_SLOT), null);
  assert.equal(c.skills2Ult('thrust').lv, 2);
  assert.equal(c.skills2Downgrade('thrust', c.SG_ULT_SLOT), null);
  assert.equal(c.skills2Ult('thrust').lv, 1);
  assert.match(c.skills2Learn('fireball', c.SG_ULT_SLOT), /未知階數/);
});

test('前 7 階任一階離開滿級：超神進化暫時失效，但存檔的選擇與等級原樣保留', () => {
  const c = loadContext();
  maxLevels(c, 'thrust');
  setUlt(c, 'thrust', 'oneStrikeKill', 5);
  assert.ok(c.skills2Ult('thrust'), '滿級時生效');
  setLevels(c, 'thrust', [10, 10, 10, 10, 10, 10, 9]);
  assert.equal(c.skills2Ult('thrust'), null, '不再滿級就失效');
  assert.deepEqual(JSON.parse(JSON.stringify(c.G.player.skills2.ult.thrust)).lv, 5, '存檔不得被清掉');
  maxLevels(c, 'thrust');
  assert.equal(c.skills2Ult('thrust').lv, 5, '練回滿級就原樣回來');
});

test('面板快照帶上超神進化的選擇（主執行緒沒有 G，只能靠快照）', () => {
  const c = loadContext();
  maxLevels(c, 'thrust');
  setUlt(c, 'thrust', 'phantomOcta', 3);
  const view = c.skills2PanelView();
  assert.deepEqual(JSON.parse(JSON.stringify(view.ult.thrust)), { pick: 0, lv: 3 });
  assert.equal(view.ult.fireball, undefined, '沒選過的群組不佔快照欄位');
  // UI 端以同一支純函式重算，確保「畫面說可以」＝「Worker 說可以」
  const pick = c.sgUltPickOf(view.ult, 'thrust');
  assert.equal(pick.id, 'phantomOcta');
  assert.equal(c.sgUltUnlockedBy('thrust', view.levels.thrust), true);
});

/* ---- 3) 突刺的三個超神進化 ---- */

test('【一擊必殺】：八方連刺改為前方 1 道、傷害 N 倍，且立即殺死普通敵人（精英不吃）', () => {
  const c = loadContext();
  const calls = stubHits(c); const specs = stubVfx(c); stubDerived(c);
  forceRolls(c, 0.999);                    // 連刺的機率段不觸發，命中數才可預期
  maxLevels(c, 'thrust'); equip(c, 'thrust');
  setUlt(c, 'thrust', 'oneStrikeKill', 10);
  const p = playerEnt(); c.FIELD = { player: p };
  const front = enemy(1e9, 3 * M, 0, '前');
  const elite = enemy(1e9, 4 * M, 0, '精英', 'elite');
  c.castSkill2(p, [front, elite], 'thrust', 'mv-float');
  const spec = specs.find((s) => s.fxKind === 'slash');
  assert.equal(spec.directionCount, 1, '八方連刺改為 1 道');
  assert.equal(spec.variant, 'thrust-pierce', '巨型單道沿用會讀 lineLength 的既有變體');
  /* 超神進化的前提是前 7 階全滿 → 突刺必定走「貫穿飛行物」路徑，
     傷害在 tick 裡才結算，所以要先讓時間走一段。 */
  run(c, p, [front, elite], 3);
  assert.ok(calls.length > 0, '應有命中');
  assert.equal(front.hp, 0, '普通敵人被立即殺死');
  assert.ok(elite.hp > 0, '精英不吃立即殺死');
  // 傷害倍率：Lv.10 ＝ 4 + 0.4×10 ＝ 8 倍（第 1／3／7 階的傷害%先相加，再乘倍率）
  const base = 1000 * (1.5 + 0.15 * 10 + 0.2 + 0.03 * 10 + 0.2 + 0.02 * 10);
  assert.ok(Math.abs(calls[0].atk - base * 8) < 1e-6, '整段傷害改為 8 倍');
});

test('【幻影八方陣】：命中擴散到周圍範圍內的敵人，並給予絕對閃避增益', () => {
  const c = loadContext();
  stubHits(c); stubVfx(c);
  const derived = stubDerived(c);
  forceRolls(c, 0.999);
  // 未滿級時不生效，先確認閘門
  setLevels(c, 'thrust', [10, 10, 10, 10, 10, 10, 9]); equip(c, 'thrust');
  setUlt(c, 'thrust', 'phantomOcta', 10);
  assert.equal(c.skills2Ult('thrust'), null);
  maxLevels(c, 'thrust');
  assert.ok(c.skills2Ult('thrust'));

  const p = playerEnt(); c.FIELD = { player: p };
  const hit = enemy(1e9, 3 * M, 0, '被刺中');
  const near = enemy(1e9, 3 * M, 2 * M, '旁邊');       // 距離 2 米，在 12 米擴散範圍內
  const far = enemy(1e9, 3 * M, 40 * M, '很遠');
  c.castSkill2(p, [hit, near, far], 'thrust', 'mv-float');
  // 絕對閃避只持續 2 秒，必須在推進時間之前檢查
  assert.equal(c.buffVal(p, 'sgPhantomDodge'), 30, '施放後獲得絕對閃避增益');
  run(c, p, [hit, near, far], 3);
  assert.equal(c.buffVal(p, 'sgPhantomDodge'), 0, '2 秒後就結束');
  /* 第 5 階【擴散】本來就會分一部分傷害給最近的敵人（100 × 40% ＝ 40），
     幻影八方陣則是「全額」擴散（100）。因此看衍生扣血的金額就能分辨是哪一個：
     只有範圍內的敵人會收到 100，範圍外的最多只拿得到第 5 階的 40。 */
  const fullNear = derived.filter((h) => h.ent === near && Math.abs(h.amount - 100) < 1e-9);
  const fullFar = derived.filter((h) => h.ent === far && Math.abs(h.amount - 100) < 1e-9);
  assert.ok(fullNear.length > 0, '範圍內的敵人吃到全額擴散');
  assert.equal(fullFar.length, 0, '範圍外的敵人不吃全額擴散');
  // 絕對閃避是獨立擲骰：走 playerDefCfg → resolveHit 的 absDodge
  const combat = fs.readFileSync(path.join(root, 'js/combat.js'), 'utf8');
  const formula = fs.readFileSync(path.join(root, 'js/formula.js'), 'utf8');
  assert.match(combat, /absDodge:[\s\S]*buffVal\(pEnt, 'sgPhantomDodge'\)/);
  assert.match(formula, /dCfg\.absDodge > 0 && chance\(dCfg\.absDodge\)/);
});

test('【暗影絕殺者】：命中堆疊靈魂撕裂，層數直接進入「受到的傷害提高」乘區', () => {
  const c = loadContext();
  stubHits(c); stubVfx(c);
  forceRolls(c, 0.999);
  maxLevels(c, 'thrust'); equip(c, 'thrust');
  setUlt(c, 'thrust', 'shadowExecutioner', 10);
  const p = playerEnt(); c.FIELD = { player: p };
  const e = enemy(1e12, 3 * M, 0);
  c.castSkill2(p, [e], 'thrust', 'mv-float');
  run(c, p, [e], 3);   // 全滿的突刺走飛行物路徑，命中在 tick 裡才發生
  const stacks = e.buffs.sgSoulRend;
  assert.ok(stacks, '應塗上靈魂撕裂');
  assert.ok(stacks.stacks >= 1);
  // 單層值 Lv.10 ＝ 1 + 0.2×10 ＝ 3%
  assert.ok(Math.abs(stacks.unit - 3) < 1e-9, '單層值隨等級成長');
  assert.ok(Math.abs(stacks.val - 3 * stacks.stacks) < 1e-9, '效果值＝單層 × 層數');
  const aCfg = c.skill2VulnACfg({ totalDmgPct: 0 }, e);
  assert.ok(Math.abs(aCfg.totalDmgPct - stacks.val) < 1e-9, '層數要加進 totalDmgPct');
  assert.equal(c.STATUS.sgSoulRend.stack, 'stack');
});

/* ---- 4) 迴旋斬的三個超神進化 ---- */

test('【虛空碎裂斬】：迴身四方斬的次數與傷害都再提高（前 7 階沒全滿時不生效）', () => {
  const c = loadContext();
  stubHits(c); stubVfx(c);
  setLevels(c, 'cleave', [10, 10, 10, 10, 10, 0, 10]);
  setUlt(c, 'cleave', 'voidShatter', 10);
  assert.equal(c.skills2Ult('cleave'), null, '第 6 階不滿級時整個超神進化失效');

  const c2 = loadContext();
  const calls2 = stubHits(c2); stubVfx(c2); stubDerived(c2);
  forceRolls(c2, 0.999);
  maxLevels(c2, 'cleave'); equip(c2, 'cleave');
  const p2 = playerEnt(); c2.FIELD = { player: p2 };
  const e2 = enemy(1e12, 2 * M, 0);
  c2.castSkill2(p2, [e2], 'cleave', 'mv-float');
  run(c2, p2, [e2], 3);           // 全滿＝震碎斬生效，斬擊改由飛行物命中
  const before = calls2[0].atk;
  const beforeHits = calls2.length;

  setUlt(c2, 'cleave', 'voidShatter', 10);
  calls2.length = 0;
  c2.SKILL2_RT.projectiles.length = 0;
  c2.castSkill2(p2, [e2], 'cleave', 'mv-float');
  run(c2, p2, [e2], 3);
  // Lv.10 的虛空碎裂斬先使原有百分比 +100%，再套用迴身四方斬的 2 倍乘區。
  assert.ok(Math.abs(calls2[0].atk - ((before / 2 + 1000) * 2)) < 1e-6,
    '虛空碎裂斬的加成應先併入原有傷害，再乘迴身四方斬倍率');
  assert.ok(calls2.length > beforeHits, '攻擊次數也要變多');
});

test('【逐風者】：每次命中在該處生成一道龍捲風，逐段造成風系傷害', () => {
  const c = loadContext();
  const calls = stubHits(c); const specs = stubVfx(c); stubDerived(c);
  forceRolls(c, 0.999);
  maxLevels(c, 'cleave'); equip(c, 'cleave');
  setUlt(c, 'cleave', 'windChaser', 10);
  const p = playerEnt(); c.FIELD = { player: p };
  const e = enemy(1e12, 2 * M, 0);
  c.castSkill2(p, [e], 'cleave', 'mv-float');
  run(c, p, [e], 0.4);            // 全滿＝震碎斬生效，命中在飛行物 tick 裡才發生
  assert.ok(c.SKILL2_RT.grounds.length > 0, '命中後應生成龍捲風場域');
  const g = c.SKILL2_RT.grounds[0];
  assert.equal(g.kind, 'windtornado');
  assert.equal(g.hitElem, 'wind', '龍捲風是風系段（物理群組打出風系傷害）');
  calls.length = 0;
  run(c, p, [e], 4);
  const windHits = calls.filter((x) => x.elem === 'wind');
  assert.ok(windHits.length > 0, '龍捲風應逐段結算為風系傷害');
  assert.ok(specs.some((s) => s.variant === 'wind-tornado'), '龍捲風要送出自己的特效變體');
  // 沒選逐風者時不得出現任何風系段（迴旋斬本體是無屬性物理）
  const c2 = loadContext();
  const calls2 = stubHits(c2); stubVfx(c2); stubDerived(c2);
  forceRolls(c2, 0.999);
  maxLevels(c2, 'cleave'); equip(c2, 'cleave');
  const p2 = playerEnt(); c2.FIELD = { player: p2 };
  const e2 = enemy(1e12, 2 * M, 0);
  c2.castSkill2(p2, [e2], 'cleave', 'mv-float');
  run(c2, p2, [e2], 4);
  assert.equal(c2.SKILL2_RT.grounds.length, 0, '沒選逐風者就不該有龍捲風');
  assert.ok(!calls2.some((x) => x.elem === 'wind'), '沒選逐風者就不該有風系段');
});

test('【天霸風神斬】：範圍 +30%、變成被動，且每級將自動施放間隔 -0.5 秒', () => {
  const c = loadContext();
  stubHits(c); stubVfx(c);
  forceRolls(c, 0.999);
  maxLevels(c, 'cleave'); equip(c, 'cleave');
  setUlt(c, 'cleave', 'stormGodSlash', 10);
  const ult = c.skills2Ult('cleave');
  assert.equal(ult.def.fx.range, 30, '天霸風神斬範圍倍率應為 30%');
  assert.equal(ult.def.fx.sec, 8, '天霸風神斬基礎間隔應為 8 秒');
  assert.equal(ult.def.fx.secPer, -0.5, '天霸風神斬每級間隔應減少 0.5 秒');
  assert.equal(c.sgUltVal(ult, 'sec'), 3, 'Lv.10 應為 8 − 0.5×10 ＝ 3 秒');
  assert.equal(c.skills2CastRangePx('cleave', c.skills2Levels('cleave')), c.bfMeterPx(8),
    '滿級強化斬 +30% 與天霸風神斬 +30% 應將迴旋斬施放距離由 5 米提高至 8 米');
  assert.equal(c.skills2ActsPassive('cleave'), true, '選了天霸風神斬就視為被動群組');
  assert.equal(c.skills2ActsPassive('thrust'), false);

  const p = playerEnt(); c.FIELD = { player: p };
  const e = enemy(1e12, 2 * M, 0);
  // Lv.10 ＝ 8 − 0.5×10 ＝ 每 3 秒一次
  run(c, p, [e], 2.5);
  assert.equal(e.hp, 1e12, '間隔還沒到就不該出手');
  run(c, p, [e], 1.0);
  assert.ok(e.hp < 1e12, '間隔到了自動施放一次');

  // 沒裝配在技能列就不生效（與其他主動型被動同一條代價）
  const c2 = loadContext();
  stubHits(c2); stubVfx(c2); forceRolls(c2, 0.999);
  maxLevels(c2, 'cleave'); c2.G.player.loadout = [];
  setUlt(c2, 'cleave', 'stormGodSlash', 10);
  const p2 = playerEnt(); c2.FIELD = { player: p2 };
  const e2 = enemy(1e12, 2 * M, 0);
  run(c2, p2, [e2], 10);
  assert.equal(e2.hp, 1e12, '未裝配時不自動施放');

  // 主動輪替的閘門讀的是 skills2ActsPassive（不是只認表定被動）
  const skills = fs.readFileSync(path.join(root, 'js/skills.js'), 'utf8');
  assert.match(skills, /skills2ActsPassive === 'function' \? skills2ActsPassive\(sgId\)/);
});

/* ---- 5) 傳奇特效 ---- */

test('legendarySkill2Mods：只合併「同群組且已生效」的 fx，同名數字鍵相加', () => {
  const c = loadContext(['js/legendary.js']);
  assert.equal(c.legendarySkill2Mods('thrust'), null, '沒裝任何傳奇特效時回 null');
  setLegendary(c, ['piercingFocus']);
  let mods = c.legendarySkill2Mods('thrust');
  assert.equal(mods.thrustLenPct, 30);
  assert.equal(mods.skillDamagePct, 30);
  assert.equal(c.legendarySkill2Mods('cleave'), null, '不同群組的不得混進來');
  // 兩個都改「技能傷害%」的特效同時生效時相加（30 + 100）
  setLegendary(c, ['piercingFocus', 'sunpiercerLance']);
  mods = c.legendarySkill2Mods('thrust');
  assert.equal(mods.skillDamagePct, 130);
  assert.equal(mods.octaToSingle, true);
  assert.equal(mods.thrustRangePct, 100);
});

test('突刺的五個傳奇特效：長寬與傷害改寫、命中疊易傷、流血、連鎖閃電、八方改單道', () => {
  const c = loadContext(['js/legendary.js']);
  const calls = stubHits(c); const specs = stubVfx(c);
  forceRolls(c, 0.999);
  setLevels(c, 'thrust', [10, 10, 10, 0, 0, 0, 0]); equip(c, 'thrust');
  const p = playerEnt(); c.FIELD = { player: p };
  const e = enemy(1e12, 3 * M, 0);

  // 基準：沒有任何傳奇特效
  c.castSkill2(p, [e], 'thrust', 'mv-float');
  const baseAtk = calls[0].atk;
  const baseSpec = specs.find((s) => s.fxKind === 'slash');

  // 凝鋒穿刺：長度 +30%、寬度 -15%、傷害 +30%
  setLegendary(c, ['piercingFocus']);
  calls.length = 0; specs.length = 0;
  c.castSkill2(p, [e], 'thrust', 'mv-float');
  const focusSpec = specs.find((s) => s.fxKind === 'slash');
  assert.ok(Math.abs(focusSpec.lineLength - baseSpec.lineLength * 1.3) < 1e-6, '長度 +30%');
  assert.ok(Math.abs(calls[0].atk - (baseAtk + 1000 * 0.3)) < 1e-6, '傷害 +30%（物攻百分比相加）');

  // 千瘡百孔：命中疊易傷
  setLegendary(c, ['thousandWounds']);
  const e2 = enemy(1e12, 3 * M, 0);
  c.castSkill2(p, [e2], 'thrust', 'mv-float');
  assert.ok(e2.buffs.sgThrustVuln, '命中應疊上千瘡百孔');
  assert.ok(Math.abs(e2.buffs.sgThrustVuln.unit - 4) < 1e-9, '單層 +4%');
  assert.ok(e2.buffs.sgThrustVuln.stacks >= 2, '一次施放多段命中要能疊多層');
  const aCfg = c.skill2VulnACfg({ totalDmgPct: 0 }, e2);
  assert.ok(aCfg.totalDmgPct > 0, '易傷要進 totalDmgPct');

  // 穿心裂血：附加流血
  setLegendary(c, ['heartrendBleed']);
  const e3 = enemy(1e12, 3 * M, 0);
  c.castSkill2(p, [e3], 'thrust', 'mv-float');
  const dot = c.sgFindDot(e3, 'sgThrustBleed');
  assert.ok(dot, '應附加穿心裂血的流血');
  assert.ok(Math.abs(dot.dps * 0.5 - 1000 * 0.5) < 1e-6, '每 0.5 秒 ＝ 50% 物攻');

  // 迅雷穿刺：機率附加連鎖閃電（機率擲骰吃 Math.random，設成必中）
  setLegendary(c, ['thunderStab']);
  forceRolls(c, 0);
  const e4 = enemy(1e12, 3 * M, 0);
  c.legendaryTick = c.legendaryTick || function () {};
  c.castSkill2(p, [e4], 'thrust', 'mv-float');
  assert.ok(c.LEGENDARY_RT.queue.length > 0, '應排入連鎖閃電');
  forceRolls(c, 0.999);

  // 貫日之刺：八方連刺改為前方 1 道
  setLegendary(c, ['sunpiercerLance']);
  maxLevels(c, 'thrust');
  specs.length = 0;
  c.castSkill2(p, [e], 'thrust', 'mv-float');
  assert.equal(specs.find((s) => s.fxKind === 'slash').directionCount, 1, '八方改單道');
});

test('迴旋斬的五個傳奇特效：斬擊次數、旋風、飛出距離、暈眩增傷、拉近敵人', () => {
  const c = loadContext(['js/legendary.js']);
  const calls = stubHits(c); const specs = stubVfx(c);
  forceRolls(c, 0.999);
  setLevels(c, 'cleave', [10, 0, 0, 0, 0, 0, 0]); equip(c, 'cleave');
  const p = playerEnt(); c.FIELD = { player: p };

  // 連環迴旋：斬擊次數 +2
  const e = enemy(1e12, 2 * M, 0);
  c.castSkill2(p, [e], 'cleave', 'mv-float');
  const baseHits = calls.length;
  setLegendary(c, ['chainSpin']);
  calls.length = 0;
  c.castSkill2(p, [e], 'cleave', 'mv-float');
  assert.equal(calls.length, baseHits + 2 * baseHits / 1, '每一次斬擊都多打 2 輪');

  // 旋風劍舞：每次斬擊對周圍造成風系傷害
  setLegendary(c, ['galeBladeDance']);
  calls.length = 0; specs.length = 0;
  const near = enemy(1e12, 5 * M, 0, '近');
  c.castSkill2(p, [near], 'cleave', 'mv-float');
  assert.ok(calls.some((x) => x.elem === 'wind'), '旋風是風系段');
  assert.ok(specs.some((s) => s.variant === 'wind-spin' && s.fxKind === 'slash'),
    '旋風沿用 wind-spin（掛在 slash 分派下，寫成 aura 會被風系守衛擋掉）');

  // 裂空飛斬：斬擊向外飛出（改走飛行物路徑）
  setLegendary(c, ['skyrendSlash']);
  c.SKILL2_RT.projectiles.length = 0;
  specs.length = 0;
  c.castSkill2(p, [e], 'cleave', 'mv-float');
  assert.ok(c.SKILL2_RT.projectiles.length > 0, '應改由飛行物命中');
  assert.ok(c.SKILL2_RT.projectiles[0].length >= c.bfMeterPx(60) - 1e-6, '飛出 60 米');

  // 乘虛之斬：對暈眩中的敵人增傷
  setLegendary(c, ['exploitWeakness']);
  const stunned = enemy(1e12, 2 * M, 0, '暈');
  c.applyStatus(stunned, 'stun', { dur: 5 });
  assert.equal(c.sgIsStunned(stunned), true);
  calls.length = 0;
  c.castSkill2(p, [stunned], 'cleave', 'mv-float');
  assert.ok(Math.abs(calls[0].total - 50) < 1e-9, '暈眩中的敵人吃到 +50% 總傷');

  /* 聚敵旋渦：拉近 60 米內的敵人。
     ⚠️ 技能本身仍要打得到人才會施放（castSkill2 的起手主目標必須在施法距離內），
     所以場上要有一個近戰距離內的敵人，遠方那一隻才會被拉過來。 */
  setLegendary(c, ['gatheringVortex']);
  const anchor = enemy(1e12, 2 * M, 0, '近身');
  const far = enemy(1e12, 40 * M, 0, '遠');
  c.castSkill2(p, [anchor, far], 'cleave', 'mv-float');
  assert.ok(far.pos.x <= 10 * M + 1e-6, '被拉到 10 米內');
  assert.ok(far.pos.x > 0, '不會被拉到玩家身上（保留停止距離）');
});

/* ---- 6) 存檔正規化 ---- */

test('讀檔正規化：越界／非法的超神進化紀錄一律刪除，合法的夾在 1..上限', () => {
  const c = loadContext(['js/save.js']);
  const data = {
    player: {
      skills2: {
        levels: { thrust: [10, 10, 10, 10, 10, 10, 10] },
        ult: {
          thrust: { pick: 0, lv: 99 },        // 超過上限 → 夾回
          cleave: { pick: 9, lv: 3 },         // 選項越界 → 刪除
          fireball: { pick: 0, lv: 1 },          // 該群組沒有超神進化 → 刪除
          gale: { pick: 0, lv: 0 }            // 等級不合法 → 刪除
        }
      },
      loadout: []
    }
  };
  // 只驗這一段：直接呼叫存檔正規化的整支函式成本太高，改用同一份規則的純函式再確認一次
  const norm = fs.readFileSync(path.join(root, 'js/save.js'), 'utf8');
  assert.match(norm, /超神進化（第 8 階；2026-08-19，冪等）/);
  assert.match(norm, /data\.player\.skills2\.ult/);
  // 純函式端：壞資料一律被視為「沒選」
  assert.equal(c.sgUltPickOf(data.player.skills2.ult, 'cleave'), null);
  assert.equal(c.sgUltPickOf(data.player.skills2.ult, 'fireball'), null);
  assert.equal(c.sgUltPickOf(data.player.skills2.ult, 'gale'), null);
  assert.equal(c.sgUltPickOf(data.player.skills2.ult, 'thrust').lv, c.SG_TIER_MAX_LV);
});

/* ---- 6) 飛刀的五個傳奇特效 ---- */

test('飛刀的五個傳奇特效：彈射數、擊殺分裂、優先高血量、飛刀數、刀環', () => {
  const c = loadContext(['js/legendary.js']);
  const calls = stubHits(c); const specs = stubVfx(c);
  forceRolls(c, 0.999);
  // 第 3 階＝彈射（傳奇【連鎖】要有彈射才看得出來）；第 5 階不點＝維持扇形鎖敵
  setLevels(c, 'knife', [10, 10, 10, 0, 0, 0, 0]); equip(c, 'knife');
  const p = playerEnt(); c.FIELD = { player: p };

  function cast(enemies) {
    calls.length = 0; specs.length = 0;
    c.castSkill2(p, enemies, 'knife', 'mv-float');
    return { calls: calls.slice(), specs: specs.slice() };
  }
  const knifeSpec = (list) => list.find((s) => s.fxKind === 'projectile' && s.variant === 'knife');

  // 基準：3 把飛刀（第 1 階 count），每把彈射 1 次
  const base = cast([enemy(1e12, 3 * M, 0), enemy(1e12, 3 * M, 1 * M)]);
  assert.equal(knifeSpec(base.specs).targets.length, 3, '第 1 階 count＝3 把飛刀，每把一個特效目標');
  const baseHits = base.calls.length;

  // 影刃：射出的飛刀數量 +2 把 → 命中次數必定增加
  setLegendary(c, ['knifeShadowblade']);
  const shadow = cast([enemy(1e12, 3 * M, 0), enemy(1e12, 3 * M, 1 * M)]);
  assert.ok(shadow.calls.length > baseHits, '飛刀數 +2 應打出更多段');

  // 連鎖：彈射數 +2 → 同樣的飛刀數但總段數更多
  setLegendary(c, ['knifeChain']);
  const chain = cast([enemy(1e12, 3 * M, 0), enemy(1e12, 3 * M, 1 * M)]);
  assert.ok(chain.calls.length > baseHits, '彈射數 +2 應打出更多段');

  // 處刑者：彈射優先跳向生命值最高的目標，且對其增傷 30%
  setLegendary(c, ['knifeExecutioner']);
  const weak = enemy(1e12, 3 * M, 0);
  const tough = enemy(9e12, 3 * M, 1 * M);
  const exec = cast([weak, tough]);
  const bounced = exec.calls.filter((k) => k.total === 30);
  assert.ok(bounced.length > 0, '彈射段應帶 +30% 總傷');
  assert.ok(bounced.some((k) => k.ent === tough), '彈射應跳向生命值最高的目標');

  // 分裂者：擊殺時分裂出小刀（小刀傷害＝本體的 50%）
  setLegendary(c, ['knifeSplitter']);
  const dying = enemy(100, 3 * M, 0);          // stubHits 每段固定 100 → 首擊必死
  const other = enemy(1e12, 3 * M, 1 * M);
  const split = cast([dying, other]);
  const body = Math.max.apply(null, split.calls.map((k) => k.atk));
  assert.ok(split.calls.some((k) => Math.abs(k.atk - body * 0.5) < 1e-6),
    '應出現 50% 傷害的分裂刃');

  // 輪舞刃：第 1 把飛刀不再射出，改為圍繞自身的刀環（環繞場域）
  setLegendary(c, ['knifeWaltzblade']);
  c.SKILL2_RT.orbits.length = 0;
  const waltz = cast([enemy(1e12, 3 * M, 0), enemy(1e12, 3 * M, 1 * M)]);
  assert.equal(c.SKILL2_RT.orbits.length, 1, '應生成一組刀環');
  assert.equal(c.SKILL2_RT.orbits[0].rings[0].r, 10 * M, '刀環半徑 10 米');
  assert.ok(c.SKILL2_RT.orbits[0].until > c.GT, '刀環要有存續時間');
  assert.equal(knifeSpec(waltz.specs).targets.length, 2, '第 1 把改成刀環，其餘 2 把照常射出');
});

/* ---- 7) 疾風斬的五個傳奇特效 ---- */

test('疾風斬的五個傳奇特效：龍捲風、斬殺、雙影、風切、冷卻縮減', () => {
  const c = loadContext(['js/legendary.js']);
  const calls = stubHits(c); stubVfx(c);
  const derived = stubDerived(c);
  setLevels(c, 'gale', [10, 0, 0, 0, 0, 0, 0]); equip(c, 'gale');
  const p = playerEnt(); c.FIELD = { player: p };

  /* 神速斬：每次命中使疾風斬的冷卻時間 -0.1 秒。
     castSkill2 會在施放時把冷卻重設為表定值，因此比較的是「同一次施放之後的剩餘冷卻」。 */
  forceRolls(c, 0.999);
  c.castSkill2(p, [enemy(1e12, 3 * M, 0)], 'gale', 'mv-float');
  const baseCd = p.skillCds[c.SG_PREFIX + 'gale'];
  assert.ok(baseCd > 0, '施放後應進入冷卻');
  setLegendary(c, ['galeGodspeed']);
  c.castSkill2(p, [enemy(1e12, 3 * M, 0)], 'gale', 'mv-float');
  assert.ok(p.skillCds[c.SG_PREFIX + 'gale'] < baseCd, '命中應縮短冷卻');

  // 風捲殘雲：命中時機率生成龍捲風（地板場域）
  setLegendary(c, ['galeWhirlwind']);
  forceRolls(c, 0.01);                      // chance() 一律通過
  c.SKILL2_RT.grounds.length = 0;
  c.castSkill2(p, [enemy(1e12, 3 * M, 0)], 'gale', 'mv-float');
  assert.ok(c.SKILL2_RT.grounds.length > 0, '應生成龍捲風場域');
  assert.equal(c.SKILL2_RT.grounds[0].kind, 'windtornado');
  assert.equal(c.SKILL2_RT.grounds[0].hitElem, 'wind', '龍捲風打的是風系傷害');

  // 風行者：附加風切狀態（移速／命中率折減 ＋ 風系持續傷害）
  setLegendary(c, ['galeWindwalker']);
  const wind = enemy(1e12, 3 * M, 0);
  c.castSkill2(p, [wind], 'gale', 'mv-float');
  assert.ok(wind.buffs.sgWindRend, '應掛上風切減益本體');
  assert.ok(c.sgFindDot(wind, 'sgWindCut'), '應附加風切割裂的持續傷害');
  assert.ok(c.skill2WindRendHitFactor(wind) < 1, '命中率必須被折減');

  // 雙影：機率額外對附近 1 個敵人造成 50% 傷害
  setLegendary(c, ['galeTwinShadow']);
  calls.length = 0;
  const main = enemy(1e12, 3 * M, 0);
  const side = enemy(1e12, 3 * M, 1 * M);
  c.castSkill2(p, [main, side], 'gale', 'mv-float');
  const body = Math.max.apply(null, calls.map((k) => k.atk));
  assert.ok(calls.some((k) => k.ent === side && Math.abs(k.atk - body * 0.5) < 1e-6),
    '應對附近敵人追加 50% 傷害');

  // 斬殺：機率立即殺死生命值 20% 以下的非 BOSS 敵人
  setLegendary(c, ['galeExecute']);
  derived.length = 0;
  const weak = enemy(1e6, 3 * M, 0); weak.hp = 1e5;                   // 10% ≤ 20%
  c.castSkill2(p, [weak], 'gale', 'mv-float');
  assert.equal(weak.hp, 0, '門檻以下的普通敵人應被斬殺');
  assert.ok(derived.length > 0, '斬殺走的是衍生傷害（不再過防禦）');
  // BOSS 不吃斬殺
  derived.length = 0;
  const boss = enemy(1e6, 3 * M, 0, 'BOSS', 'boss'); boss.hp = 1e5;   // 同樣在門檻內
  c.castSkill2(p, [boss], 'gale', 'mv-float');
  assert.ok(boss.hp > 0, 'BOSS 不得被斬殺');
});

/* ---- 8) 飛刀的三個超神進化 ---- */

test('【暴雨梨花】：飛行路徑上的敵人各吃一段（占本體技能傷害的比例）', () => {
  const c = loadContext(['js/legendary.js']);
  const calls = stubHits(c); stubVfx(c);
  forceRolls(c, 0.999);
  maxLevels(c, 'knife'); equip(c, 'knife');
  const p = playerEnt(); c.FIELD = { player: p };
  // 近的擋在遠的前面：飛向遠處那隻的路徑一定會穿過近處那隻
  const mk = () => [enemy(1e12, 3 * M, 0), enemy(1e12, 6 * M, 0)];

  c.castSkill2(p, mk(), 'knife', 'mv-float');
  const body = Math.max.apply(null, calls.map((k) => k.atk));
  const pathPct = c.sgVal(c.SKILLS2.knife.ult[0].fx, 'pct', c.SG_TIER_MAX_LV);
  assert.ok(!calls.some((k) => Math.abs(k.atk - body * pathPct / 100) < 1e-6),
    '沒選超神進化時不得有路徑傷害');

  setUlt(c, 'knife', 'petalStorm');
  calls.length = 0;
  c.castSkill2(p, mk(), 'knife', 'mv-float');
  assert.ok(calls.some((k) => Math.abs(k.atk - body * pathPct / 100) < 1e-6),
    '路徑上的敵人應吃到 ' + pathPct + '% 技能傷害');
});

test('【死亡收割者】：擊殺疊層，且層數直接進入「造成的所有傷害提高」乘區', () => {
  const c = loadContext(['js/legendary.js']);
  stubHits(c); stubVfx(c);
  forceRolls(c, 0.999);
  maxLevels(c, 'knife'); equip(c, 'knife');
  const p = playerEnt(); c.FIELD = { player: p };

  const alive = enemy(1e12, 3 * M, 0);
  c.castSkill2(p, [alive], 'knife', 'mv-float');
  assert.equal(p.buffs.sgDeathReaper, undefined, '沒選超神進化時不得疊層');

  setUlt(c, 'knife', 'deathReaper');
  const dying = enemy(100, 3 * M, 0);              // stubHits 每段 100 → 首擊必死
  c.castSkill2(p, [dying], 'knife', 'mv-float');
  const buff = p.buffs.sgDeathReaper;
  assert.ok(buff, '擊殺應疊上死亡收割');
  assert.ok(buff.stacks >= 1);
  const perStack = c.sgVal(c.SKILLS2.knife.ult[1].fx, 'pct', c.SG_TIER_MAX_LV);
  assert.ok(Math.abs(buff.unit - perStack) < 1e-9, '單層值＝技能參數');
  // 乘區：新版技能傷害（sgAtkCfg）與普攻（combat.js playerAtkCfg）讀的是同一個鍵
  const aCfg = c.sgAtkCfg(p, c.getStats(), 100, alive, 0, 'knife');
  assert.ok(aCfg.totalDmgPct > 0, '死亡收割必須進 totalDmgPct');
  const src = fs.readFileSync(path.join(root, 'js/combat.js'), 'utf8');
  assert.match(src, /totalDmgPct:[\s\S]{0,160}skills2AllDamageUpPct\(pEnt\)/, '普攻端要走同一個加總入口');
  const s2 = fs.readFileSync(path.join(root, 'js/skills2.js'), 'utf8');
  assert.match(s2, /function skills2AllDamageUpPct[\s\S]{0,320}sgDeathReaper/, '加總入口要含死亡收割');
});

test('【無限追魂刃】：額外射出 1 支高傷飛刀，且彈射到場上每個敵人', () => {
  const c = loadContext(['js/legendary.js']);
  const calls = stubHits(c); stubVfx(c);
  forceRolls(c, 0.999);
  maxLevels(c, 'knife'); equip(c, 'knife');
  const p = playerEnt(); c.FIELD = { player: p };
  const mk = () => [enemy(1e12, 3 * M, 0), enemy(1e12, 4 * M, 0)];
  const specs = [];
  c.playCombatVfx = (spec) => specs.push(spec);

  c.castSkill2(p, mk(), 'knife', 'mv-float');
  const body = Math.max.apply(null, calls.map((k) => k.atk));
  const baseHits = calls.length;

  setUlt(c, 'knife', 'soulhunterBlade');
  calls.length = 0;
  specs.length = 0;
  c.castSkill2(p, mk(), 'knife', 'mv-float');
  assert.ok(specs.some((s) => s.variant === 'knife-soulhunter' && s.fxKind === 'projectile'),
    'Soulhunter opening knife should use its dedicated VFX variant');
  assert.ok(specs.some((s) => s.variant === 'knife-soulhunter' && s.fxKind === 'chain'),
    'Soulhunter bounce chain should keep its dedicated VFX variant');
  const boostPct = c.sgVal(c.SKILLS2.knife.ult[2].fx, 'pct', c.SG_TIER_MAX_LV);
  assert.ok(calls.some((k) => Math.abs(k.atk - body * (1 + boostPct / 100)) < 1e-6),
    '追魂刃的傷害要比本體高 ' + boostPct + '%');
  assert.ok(calls.length > baseHits, '追魂刃是額外多出來的一支');
});

/* ---- 9) 疾風斬的三個超神進化 ---- */

test('【霹靂一閃】：最後一斬對周圍打出「單段 × 連擊數 × 倍率」的閃電傷害', () => {
  const c = loadContext(['js/legendary.js']);
  const calls = stubHits(c); stubVfx(c);
  forceRolls(c, 0.999);
  maxLevels(c, 'gale'); equip(c, 'gale');
  const p = playerEnt(); c.FIELD = { player: p };
  const mk = () => [enemy(1e12, 3 * M, 0), enemy(1e12, 3 * M, 1 * M)];

  c.castSkill2(p, mk(), 'gale', 'mv-float');
  assert.ok(!calls.some((k) => k.elem === 'lightning'), '沒選超神進化時不得有閃電段');
  const body = Math.max.apply(null, calls.map((k) => k.atk));

  setUlt(c, 'gale', 'thunderFlash');
  calls.length = 0;
  c.castSkill2(p, mk(), 'gale', 'mv-float');
  const bolts = calls.filter((k) => k.elem === 'lightning');
  assert.ok(bolts.length >= 2, '周圍範圍內的敵人都要吃到');
  assert.ok(bolts[0].atk > body, '倍率必須明顯高於單段傷害');
});

test('【雷神斬】：每次斬擊命中都附加一道落雷（閃電傷害）', () => {
  const c = loadContext(['js/legendary.js']);
  const calls = stubHits(c); const specs = stubVfx(c);
  forceRolls(c, 0.999);
  maxLevels(c, 'gale'); equip(c, 'gale');
  const p = playerEnt(); c.FIELD = { player: p };

  setUlt(c, 'gale', 'thunderGodSlash');
  c.castSkill2(p, [enemy(1e12, 3 * M, 0)], 'gale', 'mv-float');
  const bolts = calls.filter((k) => k.elem === 'lightning');
  assert.ok(bolts.length >= 2, '每次斬擊都要有落雷');
  assert.ok(specs.some((s) => s.variant === 'thunder-strike'), '落雷要有畫面');
});

test('【千鳥】：月牙斬不再均分傷害，每個敵人都吃完整傷害且再額外提高', () => {
  const c = loadContext(['js/legendary.js']);
  const calls = stubHits(c); stubVfx(c);
  forceRolls(c, 0.999);
  maxLevels(c, 'gale'); equip(c, 'gale');
  const p = playerEnt(); c.FIELD = { player: p };
  const mk = () => [enemy(1e12, 3 * M, 0), enemy(1e12, 3 * M, 1 * M)];

  c.castSkill2(p, mk(), 'gale', 'mv-float');
  const shared = Math.max.apply(null, calls.map((k) => k.atk));

  setUlt(c, 'gale', 'chidori');
  calls.length = 0;
  c.castSkill2(p, mk(), 'gale', 'mv-float');
  const full = Math.max.apply(null, calls.map((k) => k.atk));
  const bonus = 1 + c.sgVal(c.SKILLS2.gale.ult[2].fx, 'pct', c.SG_TIER_MAX_LV) / 100;
  // 均分（2 個敵人）取消 ＋ 額外加成
  assert.ok(Math.abs(full - shared * 2 * bonus) < 1e-6,
    '應為原本每人份的 ' + (2 * bonus) + ' 倍，實際 ' + (full / shared));
});

/* ---- 11) 血刃斬的五個傳奇特效（2026-08-20 第三批） ---- */

function bleedOf(ent) { return ent.dots.filter((d) => d.sid === 'sgBleed')[0] || null; }
function poisonOf(ent) { return ent.dots.filter((d) => d.sid === 'sgPoison')[0] || null; }

test('【切割】：只放大斬擊本體，流血／中毒的每跳量不變', () => {
  const c = loadContext(['js/legendary.js']);
  const calls = stubHits(c); stubVfx(c);
  forceRolls(c, 0.999);
  maxLevels(c, 'bloodblade'); equip(c, 'bloodblade');
  const p = playerEnt(); c.FIELD = { player: p };

  const plain = enemy(1e12, 3 * M, 0);
  c.castSkill2(p, [plain], 'bloodblade', 'mv-float');
  const plainTotal = calls[0].total;
  const plainBleed = bleedOf(plain).dps;

  setLegendary(c, ['bloodCleaver']);
  calls.length = 0;
  const cut = enemy(1e12, 3 * M, 0);
  p.mp = 200;
  c.castSkill2(p, [cut], 'bloodblade', 'mv-float');
  const add = c.PASSIVE_POOL.bloodCleaver.fx.bloodSlashPct;
  assert.ok(Math.abs(calls[0].total - (plainTotal + add)) < 1e-9, '斬擊本體要吃到 +' + add + '%');
  assert.ok(Math.abs(bleedOf(cut).dps - plainBleed) < 1e-9, '流血基準不吃斬擊加成');
});

test('【血影】：機率揮出第 2 斬，兩斬都是完整規格', () => {
  const c = loadContext(['js/legendary.js']);
  const calls = stubHits(c); stubVfx(c);
  maxLevels(c, 'bloodblade'); equip(c, 'bloodblade');
  setLegendary(c, ['bloodShadow']);
  const p = playerEnt(); c.FIELD = { player: p };

  forceRolls(c, 0.999);                              // 機率不觸發
  c.castSkill2(p, [enemy(1e12, 3 * M, 0)], 'bloodblade', 'mv-float');
  assert.equal(calls.length, 1, '沒觸發時只有 1 斬');

  forceRolls(c, 0);                                  // 機率必觸發
  calls.length = 0;
  p.mp = 200;
  c.castSkill2(p, [enemy(1e12, 3 * M, 0)], 'bloodblade', 'mv-float');
  assert.equal(calls.length, 2, '觸發時第 2 斬也要走完整命中');
});

test('【毒血祭】：中毒與流血傷害提高，但每感染 1 個敵人就付出自身生命（不會扣死）', () => {
  const c = loadContext(['js/legendary.js']);
  stubHits(c); stubVfx(c);
  forceRolls(c, 0.999);
  maxLevels(c, 'bloodblade'); equip(c, 'bloodblade');
  const p = playerEnt(); c.FIELD = { player: p };

  const plain = enemy(1e12, 3 * M, 0);
  c.castSkill2(p, [plain], 'bloodblade', 'mv-float');
  const basePoison = poisonOf(plain).dps;
  const baseBleed = bleedOf(plain).dps;

  setLegendary(c, ['bloodVenomRite']);
  const rite = c.PASSIVE_POOL.bloodVenomRite.fx.bloodVenomRite;
  const before = p.hp; p.mp = 200;
  const target = enemy(1e12, 3 * M, 0);
  c.castSkill2(p, [target], 'bloodblade', 'mv-float');
  const k = 1 + rite.pct / 100;
  assert.ok(Math.abs(poisonOf(target).dps - basePoison * k) < 1e-6, '中毒傷害要 ×' + k);
  assert.ok(Math.abs(bleedOf(target).dps - baseBleed * k) < 1e-6, '流血傷害也要 ×' + k);
  assert.ok(p.hp < before, '感染要付出自身生命');

  p.hp = 1;                                    // 生命見底時不得再扣（保底 1 點）
  p.mp = 200;
  c.castSkill2(p, [enemy(1e12, 3 * M, 0)], 'bloodblade', 'mv-float');
  assert.equal(p.hp, 1, '不得把自己扣死');
});

test('【毒爆】／【血霧】：中毒／流血的敵人死亡後才留下場域，且血霧本身不造成傷害', () => {
  const c = loadContext(['js/legendary.js']);
  stubHits(c); stubVfx(c);
  forceRolls(c, 0.999);
  maxLevels(c, 'bloodblade'); equip(c, 'bloodblade');
  setLegendary(c, ['bloodPoisonBurst', 'bloodMist']);
  const p = playerEnt(); c.FIELD = { player: p };

  const clean = enemy(1e12, 3 * M, 0);
  c.skills2OnEnemyDeath(clean, [clean]);
  assert.equal(c.SKILL2_RT.grounds.length, 0, '身上沒有中毒／流血就不留場域');

  const victim = enemy(1e12, 3 * M, 0);
  c.castSkill2(p, [victim], 'bloodblade', 'mv-float');
  victim.hp = 0;
  c.skills2OnEnemyDeath(victim, [victim]);
  const kinds = Array.from(c.SKILL2_RT.grounds).map((g) => g.kind).sort();
  assert.deepEqual(kinds, ['bloodmist', 'poisonmist']);
  const mist = c.SKILL2_RT.grounds.filter((g) => g.kind === 'bloodmist')[0];
  assert.equal(mist.dmgVal, 0, '血霧本身不造成傷害');
  const poison = c.SKILL2_RT.grounds.filter((g) => g.kind === 'poisonmist')[0];
  assert.ok(poison.dmgVal > 0);
  assert.equal(poison.hitElem, 'poison');
});

test('【血霧】：屍體留下場域 → 場域塗標記 → 站在裡面的敵人每次受傷都回復玩家生命', () => {
  /* 血霧的三段生效鏈都要走到，不能手動塗標記跳過中間那一步：
     ①帶流血的敵人死亡 → sgBloodFieldsOnDeath 生成場域
     ②sgGroundTick 的 bloodmist 分流 → sgBloodMistGroundTick 把標記塗到範圍內的敵人
     ③skills2OnEnemyDamaged → sgBloodMistDrain 吸血 */
  const c = loadContext(['js/legendary.js']);
  stubHits(c); stubVfx(c);
  forceRolls(c, 0.999);
  maxLevels(c, 'bloodblade'); equip(c, 'bloodblade');
  setLegendary(c, ['bloodMist']);
  const p = playerEnt(); c.FIELD = { player: p };

  // ① 讓一隻敵人帶著流血死亡
  const victim = enemy(1e12, 3 * M, 0);
  c.castSkill2(p, [victim], 'bloodblade', 'mv-float');
  victim.hp = 0;
  c.skills2OnEnemyDeath(victim, [victim]);
  const mist = c.SKILL2_RT.grounds.filter((g) => g.kind === 'bloodmist')[0];
  assert.ok(mist, '帶流血的敵人死亡後要留下血霧場域');

  // ② 場域推進一拍：範圍內的敵人被塗上標記，範圍外的沒有
  const inside = enemy(1e12, 3 * M, 0);
  const outside = enemy(1e12, 60 * M, 0);
  p.hp = 100;
  run(c, p, [inside, outside], 0.6);
  assert.ok(c.buffVal(inside, 'sgBloodMist') > 0, '場域內的敵人要被塗上血霧標記');
  assert.equal(c.buffVal(outside, 'sgBloodMist'), 0, '場域外的敵人不得被塗到');

  // ③ 受傷才吸血；標記的效果值＝血霧生成當下定版的回復比例
  const before = p.hp;
  c.skills2OnEnemyDamaged(outside, 50);
  assert.equal(p.hp, before, '沒被標記的敵人受傷不回血');
  c.skills2OnEnemyDamaged(inside, 50);
  const healPct = c.PASSIVE_POOL.bloodMist.fx.bloodMistField.healPct;
  assert.ok(Math.abs(p.hp - (before + c.getStats().hp * healPct / 100)) < 1e-6,
    '應回復最大生命的 ' + healPct + '%，實得 ' + (p.hp - before));
});

/* ---- 12) 血刃斬的三個超神進化 ---- */

test('【殺神領域】：領域內的敵人死亡才疊層並回血，領域外不算', () => {
  const c = loadContext(['js/legendary.js']);
  stubVfx(c);
  maxLevels(c, 'bloodblade'); equip(c, 'bloodblade');
  const p = playerEnt(); p.hp = 100; c.FIELD = { player: p };

  const near = enemy(1e12, 3 * M, 0);
  c.skills2OnEnemyDeath(near, [near]);
  assert.equal(p.buffs.sgSlayerMark, undefined, '沒選超神進化時不疊層');

  setUlt(c, 'bloodblade', 'slayerDomain');
  const ult = c.SKILLS2.bloodblade.ult[0];
  const far = enemy(1e12, 100 * M, 0);
  c.skills2OnEnemyDeath(far, [far]);
  assert.equal(p.buffs.sgSlayerMark, undefined, '領域外（>24 米）不算');

  c.skills2OnEnemyDeath(near, [near]);
  const buff = p.buffs.sgSlayerMark;
  assert.ok(buff, '領域內死亡要疊層');
  assert.ok(Math.abs(buff.unit - c.sgVal(ult.fx, 'pct', c.SG_TIER_MAX_LV)) < 1e-9);
  assert.ok(p.hp > 100, '疊層同時要回血');
  // 疊層直接進入「造成的所有傷害提高」乘區
  const aCfg = c.sgAtkCfg(p, c.getStats(), 100, near, 0, 'bloodblade');
  assert.ok(aCfg.totalDmgPct >= buff.val, '殺神層數必須進 totalDmgPct');
});

test('【萬毒血霧】：領域內每 0.5 秒疊一層萬毒侵蝕，且只作用在範圍內的敵人', () => {
  const c = loadContext(['js/legendary.js']);
  stubVfx(c);
  maxLevels(c, 'bloodblade'); equip(c, 'bloodblade');
  setUlt(c, 'bloodblade', 'venomDomain');
  const p = playerEnt(); c.FIELD = { player: p };
  const near = enemy(1e12, 3 * M, 0);
  const far = enemy(1e12, 100 * M, 0);

  run(c, p, [near, far], 1.6);
  const dot = near.dots.filter((d) => d.sid === 'sgVenomField')[0];
  assert.ok(dot, '領域內應被塗上萬毒侵蝕');
  assert.ok(dot.stacks >= 2, '每 0.5 秒疊一層，1.6 秒至少 2 層，實得 ' + dot.stacks);
  assert.ok(Math.abs(dot.dps - dot.unit * dot.stacks) < 1e-6, '每跳量＝單層 × 層數');
  assert.equal(far.dots.length, 0, '領域外不受影響');
});

test('【崩解】：中毒與流血當場結清、不留狀態，並對周圍爆炸', () => {
  const c = loadContext(['js/legendary.js']);
  stubHits(c); stubVfx(c);
  const hits = stubDerived(c);
  forceRolls(c, 0.999);
  maxLevels(c, 'bloodblade'); equip(c, 'bloodblade');
  const p = playerEnt(); c.FIELD = { player: p };

  const plain = enemy(1e12, 3 * M, 0);
  c.castSkill2(p, [plain], 'bloodblade', 'mv-float');
  const bleedTotal = bleedOf(plain).dps * bleedOf(plain).dur;

  setUlt(c, 'bloodblade', 'disintegrate');
  hits.length = 0; p.mp = 200;
  const main = enemy(1e12, 3 * M, 0);
  const bystander = enemy(1e12, 3 * M, 2 * M);      // 距離 2 米 < 6 米
  c.castSkill2(p, [main, bystander], 'bloodblade', 'mv-float');

  assert.equal(main.dots.length, 0, '崩解之後不得留下持續狀態');
  const onMain = hits.filter((h) => h.ent === main).map((h) => h.amount);
  assert.ok(onMain.some((a) => Math.abs(a - Math.round(bleedTotal)) <= 1),
    '主目標要一次吃掉整段流血傷害（' + Math.round(bleedTotal) + '），實得 ' + onMain.join('/'));
  const pct = c.sgVal(c.SKILLS2.bloodblade.ult[2].fx, 'pct', c.SG_TIER_MAX_LV);
  const onBystander = hits.filter((h) => h.ent === bystander).map((h) => h.amount);
  assert.ok(onBystander.length >= 1, '周圍的敵人要被爆炸波及');
  assert.ok(onBystander.some((a) => Math.abs(a - Math.round(bleedTotal * pct / 100)) <= 1),
    '爆炸傷害＝該效果的 ' + pct + '%，實得 ' + onBystander.join('/'));
});

/* ---- 13) 雙刀亂舞的五個傳奇特效 ---- */

test('【雙生刃】：擊中目標數量 +2', () => {
  const c = loadContext(['js/legendary.js']);
  const calls = stubHits(c); stubVfx(c);
  forceRolls(c, 0.999);
  maxLevels(c, 'dualdance'); equip(c, 'dualdance');
  const p = playerEnt(); c.FIELD = { player: p };
  const mk = () => [enemy(1e12, 3 * M, 0), enemy(1e12, 3 * M, 1 * M), enemy(1e12, 3 * M, 2 * M)];

  c.castSkill2(p, mk(), 'dualdance', 'mv-float');
  const base = calls.length;

  setLegendary(c, ['danceTwinBlades']);
  calls.length = 0; p.mp = 200;
  c.castSkill2(p, mk(), 'dualdance', 'mv-float');
  assert.equal(calls.length, base + c.PASSIVE_POOL.danceTwinBlades.fx.danceTargetAdd.count);
});

test('【狂戰士】：鐵血之舞的生命損失與敵人流血同步放大', () => {
  const c = loadContext(['js/legendary.js']);
  stubHits(c); stubVfx(c);
  forceRolls(c, 0.999);
  maxLevels(c, 'dualdance'); equip(c, 'dualdance');
  const p = playerEnt(); c.FIELD = { player: p };

  const e1 = enemy(1e12, 3 * M, 0);
  c.castSkill2(p, [e1], 'dualdance', 'mv-float');
  const baseEnemy = e1.dots.filter((d) => d.sid === 'sgIronBleed')[0].dps;
  const baseSelf = p.dots.filter((d) => d.sid === 'sgIronBleed')[0].dps;

  setLegendary(c, ['danceBerserker']);
  const k = 1 + c.PASSIVE_POOL.danceBerserker.fx.danceIronAmp.pct / 100;
  const e2 = enemy(1e12, 3 * M, 0);
  p.dots.length = 0; p.mp = 200;
  c.castSkill2(p, [e2], 'dualdance', 'mv-float');
  assert.ok(Math.abs(e2.dots.filter((d) => d.sid === 'sgIronBleed')[0].dps - baseEnemy * k) < 1e-6,
    '敵人流血要 ×' + k);
  assert.ok(Math.abs(p.dots.filter((d) => d.sid === 'sgIronBleed')[0].dps - baseSelf * k) < 1e-6,
    '自身生命損失也要 ×' + k);
});

test('【狂舞】與【殺千刀】：只在暴風之舞持續期間作用，分別縮短節拍與延長化身', () => {
  const c = loadContext(['js/legendary.js']);
  stubHits(c); stubVfx(c);
  forceRolls(c, 0.999);
  maxLevels(c, 'dualdance'); equip(c, 'dualdance');
  setLegendary(c, ['danceFrenzy', 'danceThousandCuts']);
  const p = playerEnt(); c.FIELD = { player: p };

  // 第一次施放會「開起」化身；依設計那一拍不算在持續期間內
  c.castSkill2(p, [enemy(1e12, 3 * M, 0)], 'dualdance', 'mv-float');
  const stm = c.SKILL2_RT.storm;
  assert.ok(stm, '應進入暴風之舞');
  const gap0 = stm.gap, until0 = stm.until;

  // 化身期間的自動施放：節拍縮短
  p.mp = 200;
  c.castSkill2(p, [enemy(1e12, 3 * M, 0)], 'dualdance', 'mv-float', { storm: true });
  const shrink = 1 - c.PASSIVE_POOL.danceFrenzy.fx.danceStormGap.pct / 100;
  assert.ok(Math.abs(c.SKILL2_RT.storm.gap - gap0 * shrink) < 1e-9,
    '每施放 1 次要把下一拍間隔乘 ' + shrink);
  assert.ok(Math.abs(c.SKILL2_RT.storm.until - until0) < 1e-9, '沒殺人就不延長');

  // 化身期間殺人：延長化身
  p.mp = 200;
  const dying = [enemy(100, 3 * M, 0), enemy(100, 3 * M, 1 * M)];
  c.castSkill2(p, dying, 'dualdance', 'mv-float', { storm: true });
  const per = c.PASSIVE_POOL.danceThousandCuts.fx.danceStormKill.sec;
  assert.ok(c.SKILL2_RT.storm.until >= until0 + per * 2 - 1e-9,
    '殺 2 個要延長 ' + (per * 2) + ' 秒，實得 ' + (c.SKILL2_RT.storm.until - until0));
});

test('【不屈之誓】：暴風之舞期間的死亡延後生效，期間傷害提高，時間到才真的死', () => {
  const c = loadContext(['js/legendary.js']);
  stubHits(c); stubVfx(c);
  forceRolls(c, 0.999);
  maxLevels(c, 'dualdance'); equip(c, 'dualdance');
  const p = playerEnt(); c.FIELD = { player: p };

  assert.equal(c.skills2TryDeathDefer(p), false, '沒進化身就不攔死亡');

  setLegendary(c, ['danceUnyielding']);
  c.castSkill2(p, [enemy(1e12, 3 * M, 0)], 'dualdance', 'mv-float');
  assert.ok(c.SKILL2_RT.storm, '應進入暴風之舞');

  p.hp = 0;
  assert.equal(c.skills2TryDeathDefer(p), true, '化身期間的死亡要被攔下');
  assert.ok(p.hp >= 1, '被攔下時生命夾回 1 點');
  const spec = c.PASSIVE_POOL.danceUnyielding.fx.danceDeathDefer;
  assert.ok(Math.abs(c.buffVal(p, 'sgDeathDefer') - spec.pct) < 1e-9, '期間要有傷害增益');
  assert.ok(c.skills2AllDamageUpPct(p) >= spec.pct, '增益必須進入所有傷害加總');

  p.hp = 0;
  assert.equal(c.skills2TryDeathDefer(p), true, '延後期間再死一次仍然被攔');

  c.GT += spec.sec + 0.1;                       // 延後期滿
  p.hp = 500;
  c.tickSkill2(0.05, tickCtx(c, p, []));
  assert.equal(p.hp, 0, '時間到要把生命歸零，讓原本的判死流程接手');
  assert.equal(c.skills2TryDeathDefer(p), false, '不得延後第二次');
});

/* ---- 14) 雙刀亂舞的三個超神進化 ---- */

test('【毀滅之舞】：每次施放付出當下生命（不致死），換來本次施放的總傷加成', () => {
  const c = loadContext(['js/legendary.js']);
  const calls = stubHits(c); stubVfx(c);
  forceRolls(c, 0.999);
  maxLevels(c, 'dualdance'); equip(c, 'dualdance');
  const p = playerEnt(); c.FIELD = { player: p };

  c.castSkill2(p, [enemy(1e12, 3 * M, 0)], 'dualdance', 'mv-float');
  const baseTotal = calls[0].total;
  const hpAfterPlain = p.hp;

  setUlt(c, 'dualdance', 'doomDance');
  const ult = c.SKILLS2.dualdance.ult[0];
  calls.length = 0; p.mp = 200;
  c.castSkill2(p, [enemy(1e12, 3 * M, 0)], 'dualdance', 'mv-float');
  assert.ok(p.hp < hpAfterPlain, '施放要付出生命');
  const bonus = c.sgVal(ult.fx, 'pct', c.SG_TIER_MAX_LV);
  assert.ok(Math.abs(calls[0].total - (baseTotal + bonus)) < 1e-9, '本次施放要 +' + bonus + '%');

  p.hp = 1; p.mp = 200;
  c.castSkill2(p, [enemy(1e12, 3 * M, 0)], 'dualdance', 'mv-float');
  assert.equal(p.hp, 1, '生命見底時不得把自己扣死');
});

test('【火之神樂】：每命中 1 次疊 1 層灼焰，每跳量＝單層 × 層數', () => {
  const c = loadContext(['js/legendary.js']);
  stubHits(c); stubVfx(c);
  forceRolls(c, 0.999);
  maxLevels(c, 'dualdance'); equip(c, 'dualdance');
  const p = playerEnt(); c.FIELD = { player: p };

  const plain = enemy(1e12, 3 * M, 0);
  c.castSkill2(p, [plain], 'dualdance', 'mv-float');
  assert.equal(plain.dots.filter((d) => d.sid === 'sgKagura').length, 0, '沒選超神進化時不附加火焰');

  setUlt(c, 'dualdance', 'flameKagura');
  const ult = c.SKILLS2.dualdance.ult[1];
  p.mp = 200;
  const target = enemy(1e12, 3 * M, 0);          // 只有 1 個敵人 → 所有斬擊都打它
  c.castSkill2(p, [target], 'dualdance', 'mv-float');
  const dot = target.dots.filter((d) => d.sid === 'sgKagura')[0];
  assert.ok(dot, '應附加神樂灼焰');
  assert.ok(dot.stacks >= 2, '同一次施放的多段命中要各疊 1 層，實得 ' + dot.stacks);
  assert.ok(dot.stacks <= c.sgVal(ult.fx, 'maxStacks', c.SG_TIER_MAX_LV), '不得超過層數上限');
  assert.ok(Math.abs(dot.dps - dot.unit * dot.stacks) < 1e-6, '每跳量＝單層 × 層數');
});

test('【修羅亂舞】：只有「選了它且雙刀亂舞裝配在技能列上」時，雙手武器才能進副手', () => {
  const c = loadContext();
  const twoHand = { slot: 'weapon', weaponType: 'greatsword2h' };
  const shield = { slot: 'weapon', weaponType: 'shield' };

  maxLevels(c, 'dualdance');
  assert.equal(c.skills2AsuraDualWield(), false, '沒選超神進化就不生效');
  setUlt(c, 'dualdance', 'asuraDance');
  assert.equal(c.skills2AsuraDualWield(), false, '沒裝配在技能列上也不生效');

  equip(c, 'dualdance');
  assert.equal(c.skills2AsuraDualWield(), true);
  assert.deepEqual(Array.from(c.equipSlotsForItem(twoHand)), ['weapon', 'weapon2'], '雙手武器可進副手');
  assert.deepEqual(Array.from(c.equipSlotsForItem(shield)), ['weapon2'], '副手武器的可裝欄位不受影響');
  assert.equal(c.slotBlockedByTwoHand({ weapon: twoHand }, 'weapon2'), false, '副手不再算被佔用');
  const pct = c.sgVal(c.SKILLS2.dualdance.ult[2].fx, 'pct', c.SG_TIER_MAX_LV);
  assert.ok(Math.abs(c.skills2AsuraAffixPct() - pct) < 1e-9);

  // 卸下技能：規則立刻恢復原樣
  c.G.player.loadout = [];
  assert.equal(c.skills2AsuraDualWield(), false);
  assert.deepEqual(Array.from(c.equipSlotsForItem(twoHand)), ['weapon']);
  assert.equal(c.slotBlockedByTwoHand({ weapon: twoHand }, 'weapon2'), true);
  assert.equal(c.skills2AsuraAffixPct(), 0);
  // 主執行緒沒有 G，改由面板快照算好後傳參覆寫
  assert.equal(c.slotBlockedByTwoHand({ weapon: twoHand }, 'weapon2', true), false);
  assert.deepEqual(Array.from(c.equipSlotsForItem(twoHand, true)), ['weapon', 'weapon2']);
});

/* ---- 10) 參數表往返 ---- */

test('參數表往返：Skills2 的超神進化列與 Equipment_Affix 的三十個新特效都落表', () => {
  const skills2Csv = fs.readFileSync(path.join(root, 'config/CSV/Skills2.csv'), 'utf8').replace(/^﻿/, '');
  assert.match(skills2Csv.split(/\r?\n/)[0], /超神ID/, 'Skills2 表要有超神ID 欄');
  ['phantomOcta', 'shadowExecutioner', 'oneStrikeKill', 'voidShatter', 'windChaser', 'stormGodSlash',
    'petalStorm', 'deathReaper', 'soulhunterBlade', 'thunderFlash', 'thunderGodSlash', 'chidori',
    'slayerDomain', 'venomDomain', 'disintegrate', 'doomDance', 'flameKagura', 'asuraDance']
    .forEach((id) => assert.ok(skills2Csv.includes(id), 'Skills2.csv 應含 ' + id));
  const affixCsv = fs.readFileSync(path.join(root, 'config/CSV/Equipment_Affix.csv'), 'utf8');
  ['piercingFocus', 'thousandWounds', 'sunpiercerLance', 'thunderStab', 'heartrendBleed',
    'chainSpin', 'galeBladeDance', 'skyrendSlash', 'exploitWeakness', 'gatheringVortex',
    'knifeChain', 'knifeSplitter', 'knifeExecutioner', 'knifeShadowblade', 'knifeWaltzblade',
    'galeWhirlwind', 'galeExecute', 'galeTwinShadow', 'galeWindwalker', 'galeGodspeed',
    'bloodPoisonBurst', 'bloodVenomRite', 'bloodMist', 'bloodShadow', 'bloodCleaver',
    'danceFrenzy', 'danceBerserker', 'danceUnyielding', 'danceThousandCuts', 'danceTwinBlades']
    .forEach((id) => assert.ok(affixCsv.includes(id), 'Equipment_Affix.csv 應含 ' + id));
  const statusCsv = fs.readFileSync(path.join(root, 'config/CSV/Status.csv'), 'utf8');
  ['sgWindRend', 'sgDeathReaper', 'sgKnifeWaltz',
    'sgSlayerMark', 'sgVenomField', 'sgKagura', 'sgDeathDefer', 'sgBloodMist']
    .forEach((id) => assert.ok(statusCsv.includes(id), 'Status.csv 應含 ' + id));
});
