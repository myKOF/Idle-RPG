const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext(files) {
  const context = {
    console,
    Math: Object.create(Math),
    setTimeout() {},
    clearTimeout() {},
    document: {
      addEventListener() {},
      getElementById() { return null; },
      querySelectorAll() { return []; }
    },
    UI: { dirty: {} },
    RUN_STATS: { skills: {} },
    blog() {},
    floatText() {},
    trackDps() {},
    recordRunDamage() {}
  };
  context.window = context;
  vm.createContext(context);
  files.forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

function loadLegendaryContext() {
  const context = loadContext([
    'js/util.js',
    'js/data.js',
    'js/status.js', 'js/formula.js', 'js/battlefield.js',
    'js/combat.js',
    'js/skills.js',
    'js/legendary.js'
  ]);
  context.G = {
    player: {
      level: 1,
      reincarnations: 0,
      talents: { levels: {}, potentialLevels: {} },
      loadout: []
    },
    stage: { current: 1 },
    tower: { active: false }
  };
  return context;
}

/* 附檔的傳奇特效。原本 31 個，2026-09-29「全面移除舊版技能系統」刪掉其中 18 個
   舊技能專屬詞條（見 REMOVED_LEGACY_SKILL_LEGENDARIES），剩下這 13 個與技能系統無關
   （普攻、受擊、格擋、DOT、自動彈幕等），仍由 js/legendary.js 路由。 */
const IMPORTED_LEGENDARIES = {
  mountainSunderer: ['崩山裂地者', 'axe2h'],
  shadowTracker: ['影襲追蹤者', 'dagger1h'],
  whirlwindStab: ['旋風之刺', 'dagger1h'],
  doomProphet: ['末日預言者', 'dagger1h'],
  berserkBloodAxe: ['狂暴血斧', 'axe2h'],
  unyieldingGuard: ['不屈護衛', 'shield'],
  thunderShock: ['雷霆之震', 'focus'],
  burningLaw: ['燃燒法則', 'staff2h'],
  fireSpiritShield: ['火靈盾', 'spellbook'],
  magicLightShield: ['魔法光盾', 'orb'],
  lightCollision: ['光之碰撞', 'wand1h'],
  ghostLamp: ['幽冥神燈', 'focus'],
  magicRecoil: ['魔法反震', 'spellbook']
};

/* 隨舊技能系統一併刪除的 18 個詞條：它們的效果全部掛在已不存在的技能或施放流程上
   （旋風斬、隕石、法力燃燒、審判、虛空裂隙、血湧、雷紋…），不得復活成沒有效果的空殼。 */
const REMOVED_LEGACY_SKILL_LEGENDARIES = [
  'whirlwindRift', 'whirlwindBleed', 'frostSpike', 'stormSigilChain', 'skyfallMeteor', 'manaExplosion',
  'judgmentArrival', 'holyImpact', 'shadowAnnihilation', 'voidFate', 'shadowRipper', 'deathDomain',
  'lightningLeap', 'auroraStaff', 'iceShriek', 'venomMist', 'oathOfCondemnation', 'manaGuard'
];

test('附檔保留的 13 個效果皆進入傳奇特效池，並保留正確武器類型限制；18 個舊技能專屬詞條已移除', () => {
  const context = loadContext(['js/util.js', 'js/data.js']);
  assert.equal(Object.keys(IMPORTED_LEGENDARIES).length, 13);
  assert.equal(REMOVED_LEGACY_SKILL_LEGENDARIES.length, 18);
  Object.entries(IMPORTED_LEGENDARIES).forEach(([id, [name, weaponType]]) => {
    const def = context.PASSIVE_POOL[id];
    assert.ok(def, id + ' 必須存在');
    assert.equal(def.name, name);
    assert.equal(def.legendary, true);
    assert.deepEqual(Array.from(def.weaponTypes || []), [weaponType]);
    assert.equal(typeof def.desc, 'string');
    assert.ok(def.desc.length > 0);
  });
  REMOVED_LEGACY_SKILL_LEGENDARIES.forEach((id) => {
    assert.equal(context.PASSIVE_POOL[id], undefined, id + ' 屬於已刪除的舊技能，不得留在傳奇特效池');
  });
  assert.equal(Object.values(context.PASSIVE_POOL).filter((def) => def.name === '劇毒血霧').length, 0);
  Object.entries(context.PASSIVE_POOL).forEach(([id, def]) => {
    assert.equal(def.triggerSkill, undefined, id + ' 不應再有「觸發技能」（舊技能施放流程已刪除）');
  });
  /* 2026-08-19：「傳奇進化」10 個新版技能改寫型（突刺 5 ＋ 迴旋斬 5）
     2026-08-20：第二批 10 個（飛刀 5 ＋ 疾風斬 5）；第三批 10 個（血刃斬 5 ＋ 雙刀亂舞 5）；
     第四批 10 個（反擊 5 ＋ 嗜血狂怒 5）
     2026-08-24：第五批 10 個（火球術 5 ＋ 火龍捲 5）
     2026-08-25：第六批 10 個（火狩 5 ＋ 岩甲術 5）；第七批 10 個（泥沼術 5 ＋ 大地守護 5）
     2026-08-26：第八批 10 個（連鎖閃電 5 ＋ 落雷術 5）；第九批 10 個（雷球 5 ＋ 寒冰箭 5）
     2026-08-28：第十批 10 個（水流彈 5 ＋ 冰霜新星 5）；第十一批 10 個（風刃 5 ＋ 真空斬 5）；
     第十二批 5 個（暴風屏障 5，最後一組） */
  assert.equal(Object.keys(context.PASSIVE_POOL).length, 135,
    '既有 7 個效果 ＋ 附檔保留 13 個 ＋ 傳奇進化 115 個（153 − 舊技能專屬詞條 18）');
});

test('附檔保留的 13 個傳奇特效皆有執行期路由，戰鬥主流程已接線', () => {
  const engine = fs.readFileSync(path.join(root, 'js/legendary.js'), 'utf8');
  const combat = fs.readFileSync(path.join(root, 'js/combat.js'), 'utf8');
  const tower = fs.readFileSync(path.join(root, 'js/tower.js'), 'utf8');
  Object.keys(IMPORTED_LEGENDARIES).forEach((id) => {
    assert.ok(engine.includes("'" + id + "'"), id + ' 缺少傳奇執行期路由');
  });
  REMOVED_LEGACY_SKILL_LEGENDARIES.forEach((id) => {
    assert.ok(!engine.includes("'" + id + "'"), id + ' 已刪除，legendary.js 不該留著它的路由');
  });
  assert.match(combat, /tickLegendaryEffects\(dt,/);
  assert.match(combat, /legendaryChooseEnemyAttackTarget\(p\)/);
  assert.match(tower, /tickLegendaryEffects\(dt,/);
});

test('傳奇特效只會進入指定武器類型的隨機池', () => {
  const context = loadContext(['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/item.js']);
  const dagger = { kind: 'equip', slot: 'weapon', weaponType: 'dagger1h' };
  const axe = { kind: 'equip', slot: 'weapon', weaponType: 'axe2h' };
  const chest = { kind: 'equip', slot: 'chest' };
  const daggerKeys = context.passiveKeysForItem(dagger);
  const axeKeys = context.passiveKeysForItem(axe);
  const chestKeys = context.passiveKeysForItem(chest);
  assert.ok(daggerKeys.includes('shadowTracker'));
  assert.ok(!daggerKeys.includes('mountainSunderer'));
  assert.ok(axeKeys.includes('mountainSunderer'));
  assert.ok(!axeKeys.includes('shadowTracker'));
  assert.ok(!chestKeys.includes('shadowTracker'));
  assert.ok(!chestKeys.includes('mountainSunderer'));
  assert.ok(chestKeys.includes('sunder'), '無類型限制的既有效果仍可出現在非武器裝備');
});

test('控場增傷、低血增傷、無盾增傷與燃燒立即結算依資料參數生效', () => {
  const context = loadLegendaryContext();
  const player = { hp: 50, mp: 100, shield: 0, skillCds: {}, buffs: {}, effects: {} };
  const enemy = { hp: 1000, maxHp: 1000, effects: { stun: 10 }, buffs: {}, dots: [] };
  const st = {
    hp: 100,
    mp: 100,
    legendaryEffects: { mountainSunderer: true, doomProphet: true, burningLaw: true },
    passives: {},
    skillTriggers: {},
    elemDmgUp: {}
  };
  context.GT = 0;
  context.FIELD.player = player;
  context.getStats = () => st;

  assert.equal(context.legendaryControlDuration(enemy, 'stun', 2), 4);
  assert.equal(context.legendaryOutgoingDamageMultiplier(player, enemy, { isPlayer: true }), 9,
    '受控 ×4 ×無盾 1.5 ×低血（缺 50% → 5 段 × 10%）1.5');

  player.shield = 10;
  assert.equal(context.legendaryOutgoingDamageMultiplier(player, enemy, { isPlayer: true }), 6,
    '有護盾後不再取得無盾增傷，其餘乘區不變');

  const burn = context.legendaryInstantBurn(enemy, 10, 5, '燃燒');
  assert.equal(burn, 390, '有護盾時的燃燒：50 ×1.3×受控 4×低血 1.5');
  assert.equal(enemy.hp, 610);
});

test('不屈護衛以原始普攻最終傷害乘格擋減傷與 500% 反擊', () => {
  const context = loadLegendaryContext();
  context.GT = 0;
  context.rnd = () => 1;
  context.chance = (pct) => pct > 0;
  const player = { hp: 1000, mp: 0, shield: 0, buffs: {}, effects: {} };
  const enemy = {
    hp: 100000000, maxHp: 100000000, level: 1, def: 0, mdef: 0, pRes: 0,
    resist: {}, dodge: 0, effects: {}, buffs: {}, dots: []
  };
  const st = {
    level: 1, hp: 1000, atk: 6000000, matk: 0, hit: 100,
    critRate: 0, critDmg: 150, pPen: 0, mPen: 0, elemDmgPct: null,
    elemDmgUp: {}, eliteDmg: 0, bossDmg: 0, normalDmg: 0, totalDmgPct: 0,
    dmgVsElem: {}, blockDmgRed: 50,
    legendaryEffects: { unyieldingGuard: true }, passives: {}
  };
  context.getStats = () => st;

  context.legendaryOnPlayerDamaged(enemy, player, 0, true,
    { thorns: 0 }, 'pv-float');

  assert.equal(enemy.hp, 76000000,
    '6,000,000 普攻 × 80% 格擋減傷 × 500% 應反擊 24,000,000');
});

test('關聯技能都對應新版技能群組（SKILLS2），且不再有觸發技能欄位', () => {
  const context = loadLegendaryContext();
  /* 2026-09-29：舊技能表（SKILLS）已整個刪除，relatedSkill 只可能指向新版技能群組（SKILLS2）。
     「必須指到某一個真的存在的技能」這條不變式保留，否則傳奇進化那 115 個特效等於沒被檢查。 */
  const sg2 = loadContext(['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js',
    'js/battlefield.js', 'js/combat.js', 'js/skills.js', 'js/skills2.js']);
  const sg2Ids = new Set(Object.keys(sg2.SKILLS2));
  assert.ok(sg2Ids.has('thrust') && sg2Ids.has('cleave'), '應能載入 SKILLS2 的群組 id');
  let related = 0;
  Object.entries(context.PASSIVE_POOL).forEach(([id, def]) => {
    if (def.relatedSkill) {
      related++;
      assert.ok(sg2Ids.has(def.relatedSkill),
        id + ' 關聯技能不存在（SKILLS2 找不到 ' + def.relatedSkill + '）');
    }
    assert.equal(def.triggerSkill, undefined, id + ' 不應再有觸發技能');
  });
  assert.equal(related, 115, '傳奇進化 115 個特效都有關聯技能，且只有它們有');
  assert.equal(context.PASSIVE_POOL.piercingFocus.relatedSkill, 'thrust');
  assert.equal(context.PASSIVE_POOL.chainSpin.relatedSkill, 'cleave');
  assert.equal(context.PASSIVE_POOL.stormbarrierCore.relatedSkill, 'stormbarrier');
});

test('關聯技能改寫集中由 legendarySkill2Mods 提供：同鍵數字相加、其餘覆蓋，只收該群組且生效中的特效', () => {
  const context = loadLegendaryContext();
  const st = {
    hp: 1000,
    mp: 1000,
    legendaryEffects: { piercingFocus: true, sunpiercerLance: true, thousandWounds: true, chainSpin: true }
  };
  context.getStats = () => st;

  const mods = context.legendarySkill2Mods('thrust');
  assert.equal(mods.skillDamagePct, 130, '凝鋒穿刺 +30% 與貫日之刺 +100% 同鍵數字相加');
  assert.equal(mods.thrustLenPct, 30);
  assert.equal(mods.thrustWidthPct, -15);
  assert.equal(mods.thrustRangePct, 100);
  assert.equal(mods.octaToSingle, true);
  assert.deepEqual(JSON.parse(JSON.stringify(mods.thrustVuln)), { pct: 4, dur: 5, maxStacks: 10 });
  assert.equal(mods.cleaveSlashAdd, undefined, '迴旋斬群組的特效不會混進突刺');

  assert.equal(context.legendarySkill2Mods('gale'), null, '沒有任何生效特效的群組回傳 null');
  st.legendaryEffects = {};
  assert.equal(context.legendarySkill2Mods('thrust'), null, '特效未裝備時不改寫');
});

test('傳奇特效資料表與介面標籤統一使用「傳奇特效」', () => {
  const csv = fs.readFileSync(path.join(root, 'config/CSV/Equipment_Affix.csv'), 'utf8');
  const tool = fs.readFileSync(path.join(root, 'tools/config_tables.cjs'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const formulaDoc = fs.readFileSync(path.join(root, 'game_formula.md'), 'utf8');
  assert.match(csv, /^傳奇特效,/m);
  assert.doesNotMatch(csv, /^特殊被動,/m);
  assert.match(tool, /pool === '傳奇特效'/);
  assert.doesNotMatch(html, /特殊被動/);
  assert.doesNotMatch(formulaDoc, /特殊被動/);
});

test('迅雷穿刺的連鎖閃電：排程器依 tickSec 逐跳結算，並由 tickLegendaryEffects 消化排程佇列', () => {
  /* 迅雷穿刺（thrustChain）由 js/skills2.js sgThrustOnHit 以 typeof 守衛呼叫 legendaryScheduleChain；
     守衛會讓「函式被誤刪」變成靜默略過（2026-09-29 舊技能移除時真的發生過），所以這裡直接釘住它。 */
  const context = loadLegendaryContext();
  const st = { hp: 1000, mp: 1000, legendaryEffects: { thunderStab: true }, passives: {}, skillTriggers: {}, elemDmgUp: {} };
  context.getStats = () => st;
  context.GT = 0;
  const spec = context.legendarySkill2Mods('thrust').thrustChain;
  assert.equal(spec.bounces, 5);
  assert.equal(typeof context.legendaryScheduleChain, 'function', 'sgThrustOnHit 依賴它');

  const hits = [];
  context.legendaryDealDamage = (pEnt, target, powerPct, dmgType, elem, floatSel, label) => {
    hits.push({ target, powerPct, dmgType, elem, label });
    return { killed: false };
  };
  const enemies = [{ hp: 100, maxHp: 100 }, { hp: 100, maxHp: 100 }, { hp: 100, maxHp: 100 }];
  const ctx = { pEnt: { hp: 1, shield: 0 }, floatSel: 'pv-float', getEnemies: () => enemies };

  context.legendaryScheduleChain(ctx.pEnt, spec, 'pv-float');
  assert.equal(context.LEGENDARY_RT.queue.length, 5, '每一跳各排一筆');

  context.GT = spec.tickSec * 1.01;
  context.legendaryTickQueue(ctx);
  assert.equal(hits.length, 1, '第一個 tickSec 到期只結算第一跳');
  assert.equal(hits[0].label, '迅雷穿刺');
  assert.equal(hits[0].elem, 'lightning');
  assert.equal(hits[0].powerPct, 50);

  context.GT = spec.tickSec * 5.01;
  context.legendaryTickQueue(ctx);
  assert.equal(hits.length, 5, '五跳全數結算');
  assert.equal(context.LEGENDARY_RT.queue.length, 0, '佇列清空');
  for (let i = 1; i < hits.length; i++) {
    assert.notEqual(hits[i].target, hits[i - 1].target, '連鎖不會連續打同一個目標');
  }

  const src = fs.readFileSync(path.join(root, 'js/legendary.js'), 'utf8');
  const tickBody = src.slice(src.indexOf('function tickLegendaryEffects'));
  assert.match(tickBody, /legendaryTickQueue\(ctx\)/,'tickLegendaryEffects 必須每 tick 消化排程佇列');
});
