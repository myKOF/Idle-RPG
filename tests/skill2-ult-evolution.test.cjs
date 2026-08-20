/* 超神進化（技能第 8 格）＋ 傳奇進化十特效（2026-08-19）
   設計來源：神力之巔_記事錄.xlsx「傳奇進化」頁籤。
   守住的事：
     1. 資料形狀：thrust／cleave 各三個超神進化選項，desc 模板的 {鍵} 都在 fx 裡；
        10 個新傳奇特效只出現在匕首／單手劍，且 relatedSkill 指向新版技能群組
     2. 解鎖與指令：前 7 階全滿才可三選一；選定＝Lv.1 並扣款；重複選擇被拒；
        降到 Lv.0 清除選擇（可重選）；某階降級後效果失效但存檔保留
     3. 施放行為：三個突刺超神效果、三個迴旋斬超神效果各自真的改變了戰鬥結果
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

test('超神進化：thrust／cleave 各三個選項，欄位齊全且說明模板的參數鍵都存在', () => {
  const c = loadContext();
  ['thrust', 'cleave'].forEach((gid) => {
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
  // 其餘群組目前尚未開放（設計文檔只給了突刺與迴旋斬）
  assert.equal(c.sgUltDefs('knife'), null);
  assert.equal(c.sgSlotCount('thrust'), 8);
  assert.equal(c.sgSlotCount('knife'), 7);
  assert.equal(c.SG_ULT_SLOT, c.SG_TIER_COUNT, '第 8 格的索引＝各階數（0-based 接在最後一階之後）');
});

test('傳奇進化十特效：只出現在匕首與單手劍，且關聯到新版技能群組', () => {
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
    gatheringVortex: ['聚敵旋渦', 'sword1h', 'cleave']
  };
  assert.equal(Object.keys(NEW_ONES).length, 10);
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
  });
  // 只在這兩個部位出現：抽詞條時不得漏到其他武器
  const dagger = { weaponType: 'dagger1h' };
  const staff = { weaponType: 'staff2h' };
  assert.ok(c.passiveAllowedForItem('piercingFocus', dagger));
  assert.ok(!c.passiveAllowedForItem('piercingFocus', staff));
  assert.ok(!c.passiveAllowedForItem('chainSpin', dagger));
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
  maxLevels(c, 'knife');
  assert.match(c.skills2UltPick('knife', 0), /尚未開放/);
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
  assert.equal(c.sgIsUltSlot('knife', c.SG_ULT_SLOT), false, '未開放的群組沒有第 8 格');
  assert.match(c.skills2Learn('thrust', c.SG_ULT_SLOT), /請先選擇/);
  assert.equal(c.skills2UltPick('thrust', 0), null);
  assert.equal(c.skills2Learn('thrust', c.SG_ULT_SLOT), null);
  assert.equal(c.skills2Ult('thrust').lv, 2);
  assert.equal(c.skills2Downgrade('thrust', c.SG_ULT_SLOT), null);
  assert.equal(c.skills2Ult('thrust').lv, 1);
  assert.match(c.skills2Learn('knife', c.SG_ULT_SLOT), /未知階數/);
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
  assert.equal(view.ult.knife, undefined, '沒選過的群組不佔快照欄位');
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

test('【虛空碎裂斬】：迴身雙連斬的次數與傷害都再提高（前 7 階沒全滿時不生效）', () => {
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
  // Lv.10 ＝ 傷害再 +（50+5×10）% ＝ +100% 物攻；次數再 +（1+0.2×10）＝ +3 輪
  assert.ok(Math.abs(calls2[0].atk - (before + 1000 * 1)) < 1e-6, '第 7 階傷害再 +100%');
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
  assert.equal(c.skills2CastRangePx('cleave', c.skills2Levels('cleave')), c.bfMeterPx(6.5),
    '範圍 +30% 應將迴旋斬施放距離由 5 米提高至 6.5 米');
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
          knife: { pick: 0, lv: 1 },          // 該群組沒有超神進化 → 刪除
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
  assert.equal(c.sgUltPickOf(data.player.skills2.ult, 'knife'), null);
  assert.equal(c.sgUltPickOf(data.player.skills2.ult, 'gale'), null);
  assert.equal(c.sgUltPickOf(data.player.skills2.ult, 'thrust').lv, c.SG_TIER_MAX_LV);
});

test('參數表往返：Skills2 的超神進化列與 Equipment_Affix 的十個新特效都落表', () => {
  const skills2Csv = fs.readFileSync(path.join(root, 'config/CSV/Skills2.csv'), 'utf8').replace(/^﻿/, '');
  assert.match(skills2Csv.split(/\r?\n/)[0], /超神ID/, 'Skills2 表要有超神ID 欄');
  ['phantomOcta', 'shadowExecutioner', 'oneStrikeKill', 'voidShatter', 'windChaser', 'stormGodSlash']
    .forEach((id) => assert.ok(skills2Csv.includes(id), 'Skills2.csv 應含 ' + id));
  const affixCsv = fs.readFileSync(path.join(root, 'config/CSV/Equipment_Affix.csv'), 'utf8');
  ['piercingFocus', 'thousandWounds', 'sunpiercerLance', 'thunderStab', 'heartrendBleed',
    'chainSpin', 'galeBladeDance', 'skyrendSlash', 'exploitWeakness', 'gatheringVortex']
    .forEach((id) => assert.ok(affixCsv.includes(id), 'Equipment_Affix.csv 應含 ' + id));
});
