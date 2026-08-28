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
      skills: {},
      talents: { levels: {}, potentialLevels: {} },
      loadout: [],
      fusions: []
    },
    stage: { current: 1 },
    tower: { active: false }
  };
  return context;
}

const IMPORTED_LEGENDARIES = {
  whirlwindRift: ['旋風裂解', 'sword1h'],
  mountainSunderer: ['崩山裂地者', 'axe2h'],
  shadowTracker: ['影襲追蹤者', 'dagger1h'],
  whirlwindStab: ['旋風之刺', 'dagger1h'],
  shadowRipper: ['暗影撕裂者', 'dagger1h'],
  doomProphet: ['末日預言者', 'dagger1h'],
  berserkBloodAxe: ['狂暴血斧', 'axe2h'],
  manaGuard: ['法力防護', 'magicSword1h'],
  unyieldingGuard: ['不屈護衛', 'shield'],
  whirlwindBleed: ['旋風回旋斬', 'greatsword2h'],
  frostSpike: ['冰霜尖刺', 'focus'],
  auroraStaff: ['極光法杖', 'staff2h'],
  iceShriek: ['冰晶尖嘯', 'orb'],
  lightningLeap: ['閃電飛越', 'wand1h'],
  thunderShock: ['雷霆之震', 'focus'],
  stormSigilChain: ['雷紋連鎖', 'orb'],
  burningLaw: ['燃燒法則', 'staff2h'],
  fireSpiritShield: ['火靈盾', 'spellbook'],
  skyfallMeteor: ['神落天殞', 'staff2h'],
  manaExplosion: ['法力爆燃', 'orb'],
  magicLightShield: ['魔法光盾', 'orb'],
  lightCollision: ['光之碰撞', 'wand1h'],
  judgmentArrival: ['審判降臨', 'wand1h'],
  holyImpact: ['聖光衝擊', 'focus'],
  deathDomain: ['死亡領域', 'spellbook'],
  venomMist: ['劇毒血霧', 'wand1h'],
  ghostLamp: ['幽冥神燈', 'focus'],
  shadowAnnihilation: ['暗影滅寂', 'staff2h'],
  voidFate: ['虛無命運', 'orb'],
  oathOfCondemnation: ['天譴之誓', 'orb'],
  magicRecoil: ['魔法反震', 'spellbook']
};

test('附檔 31 個不重複效果皆進入傳奇特效池，並保留正確武器類型限制', () => {
  const context = loadContext(['js/util.js', 'js/data.js']);
  assert.equal(Object.keys(IMPORTED_LEGENDARIES).length, 31);
  Object.entries(IMPORTED_LEGENDARIES).forEach(([id, [name, weaponType]]) => {
    const def = context.PASSIVE_POOL[id];
    assert.ok(def, id + ' 必須存在');
    assert.equal(def.name, name);
    assert.equal(def.legendary, true);
    assert.deepEqual(Array.from(def.weaponTypes || []), [weaponType]);
    assert.equal(typeof def.desc, 'string');
    assert.ok(def.desc.length > 0);
  });
  assert.equal(Object.values(context.PASSIVE_POOL).filter((def) => def.name === '劇毒血霧').length, 1);
  /* 2026-08-19：「傳奇進化」10 個新版技能改寫型（突刺 5 ＋ 迴旋斬 5）
     2026-08-20：第二批 10 個（飛刀 5 ＋ 疾風斬 5）；第三批 10 個（血刃斬 5 ＋ 雙刀亂舞 5）；
     第四批 10 個（反擊 5 ＋ 嗜血狂怒 5）
     2026-08-24：第五批 10 個（火球術 5 ＋ 火龍捲 5）
     2026-08-25：第六批 10 個（火狩 5 ＋ 岩甲術 5）；第七批 10 個（泥沼術 5 ＋ 大地守護 5）
     2026-08-26：第八批 10 個（連鎖閃電 5 ＋ 落雷術 5）；第九批 10 個（雷球 5 ＋ 寒冰箭 5）
     2026-08-28：第十批 10 個（水流彈 5 ＋ 冰霜新星 5）；第十一批 10 個（風刃 5 ＋ 真空斬 5）；
     第十二批 5 個（暴風屏障 5，最後一組） */
  assert.equal(Object.keys(context.PASSIVE_POOL).length, 153, '既有 7 個效果 ＋ 附檔 31 個 ＋ 傳奇進化 115 個');
});

test('附檔 31 個傳奇特效皆有執行期路由，戰鬥與技能主流程已接線', () => {
  const engine = fs.readFileSync(path.join(root, 'js/legendary.js'), 'utf8');
  const combat = fs.readFileSync(path.join(root, 'js/combat.js'), 'utf8');
  const skills = fs.readFileSync(path.join(root, 'js/skills.js'), 'utf8');
  const tower = fs.readFileSync(path.join(root, 'js/tower.js'), 'utf8');
  Object.keys(IMPORTED_LEGENDARIES).forEach((id) => {
    assert.ok(engine.includes("'" + id + "'"), id + ' 缺少傳奇執行期路由');
  });
  assert.match(combat, /tickLegendaryEffects\(dt,/);
  assert.match(combat, /legendaryChooseEnemyAttackTarget\(p\)/);
  assert.match(skills, /legendaryPrepareSkillCast\(/);
  assert.match(skills, /legendaryOnSkillCast\(/);
  assert.match(tower, /tickLegendaryEffects\(dt,/);
});

test('傳奇特效只會進入指定武器類型的隨機池', () => {
  const context = loadContext(['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/item.js']);
  const sword = { kind: 'equip', slot: 'weapon', weaponType: 'sword1h' };
  const axe = { kind: 'equip', slot: 'weapon', weaponType: 'axe2h' };
  const chest = { kind: 'equip', slot: 'chest' };
  const swordKeys = context.passiveKeysForItem(sword);
  const axeKeys = context.passiveKeysForItem(axe);
  const chestKeys = context.passiveKeysForItem(chest);
  assert.ok(swordKeys.includes('whirlwindRift'));
  assert.ok(!swordKeys.includes('mountainSunderer'));
  assert.ok(axeKeys.includes('mountainSunderer'));
  assert.ok(!axeKeys.includes('whirlwindRift'));
  assert.ok(!chestKeys.includes('whirlwindRift'));
  assert.ok(chestKeys.includes('sunder'), '無類型限制的既有效果仍可出現在非武器裝備');
});

test('控場增傷、低血增傷、耗魔護盾與燃燒立即結算依資料參數生效', () => {
  const context = loadLegendaryContext();
  const player = { hp: 50, mp: 100, shield: 0, skillCds: {}, buffs: {}, effects: {} };
  const enemy = { hp: 1000, maxHp: 1000, effects: { stun: 10 }, buffs: {}, dots: [] };
  const st = {
    hp: 100,
    mp: 100,
    legendaryEffects: { mountainSunderer: true, doomProphet: true, manaGuard: true, burningLaw: true },
    passives: {},
    skillTriggers: {},
    elemDmgUp: {}
  };
  context.GT = 0;
  context.FIELD.player = player;
  context.getStats = () => st;

  assert.equal(context.legendaryControlDuration(enemy, 'stun', 2), 4);
  assert.equal(context.legendaryOutgoingDamageMultiplier(player, enemy, { isPlayer: true }), 9);

  context.legendaryOnManaSpent(player, 20, st, 'pv-float');
  assert.equal(player.shield, 10);

  const burn = context.legendaryInstantBurn(enemy, 10, 5, '燃燒');
  assert.equal(burn, 390, '護盾生成後不再取得無盾增傷；燃燒 50 ×1.3×受控 4×低血 1.5');
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

test('關聯技能與觸發技能都對應現有技能定義', () => {
  const context = loadLegendaryContext();
  /* 2026-08-19：relatedSkill 可以指向舊技能（SKILLS）或新版技能群組（SKILLS2）。
     兩套 id 不重疊，所以沿用同一個欄位不需要新增欄位——但「必須指到某一個真的存在的
     技能」這條不變式要一併涵蓋兩套，否則新版技能那 10 個特效等於沒被檢查。 */
  const sg2 = loadContext(['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js',
    'js/battlefield.js', 'js/combat.js', 'js/skills.js', 'js/skills2.js']);
  const sg2Ids = new Set(Object.keys(sg2.SKILLS2));
  assert.ok(sg2Ids.has('thrust') && sg2Ids.has('cleave'), '應能載入 SKILLS2 的群組 id');
  Object.entries(context.PASSIVE_POOL).forEach(([id, def]) => {
    if (def.relatedSkill) {
      assert.ok(context.SKILLS[def.relatedSkill] || sg2Ids.has(def.relatedSkill),
        id + ' 關聯技能不存在（SKILLS 與 SKILLS2 都找不到 ' + def.relatedSkill + '）');
    }
    if (def.triggerSkill) assert.ok(context.SKILLS[def.triggerSkill], id + ' 觸發技能不存在');
  });
  assert.equal(context.PASSIVE_POOL.whirlwindRift.triggerSkill, 'whirlwind');
  assert.equal(context.PASSIVE_POOL.shadowRipper.triggerSkill, 'rendWound');
  assert.equal(context.PASSIVE_POOL.whirlwindBleed.relatedSkill, 'whirlwind');
  assert.equal(context.PASSIVE_POOL.stormSigilChain.relatedSkill, 'stormSigil');
});

test('傳奇特效觸發未解鎖技能時使用至少一級，且不耗魔、不進冷卻與全域冷卻', () => {
  const context = loadLegendaryContext();
  const calls = [];
  context.castSkill = (pEnt, targets, id, lv, floatSel, statSlot, opts) => {
    calls.push({ id, lv, opts });
    return { killed: false, dmg: 1 };
  };
  context.chance = () => true;
  context.getStats = () => ({
    hp: 1000,
    mp: 1000,
    legendaryEffects: { whirlwindRift: true },
    passives: {},
    skillTriggers: {}
  });
  const player = { hp: 1000, mp: 1000, shield: 0, skillCds: {}, buffs: {}, effects: {} };
  const enemy = { hp: 1000, maxHp: 1000, effects: {}, buffs: {}, dots: [] };
  context.legendaryOnSkillCast(player, [enemy], 'powerSlash', context.SKILLS.powerSlash,
    context.SKILLS.powerSlash.fx, 1, context.getStats(), {}, 'mv-float', {});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, 'whirlwind');
  assert.equal(calls[0].lv, 1);
  assert.equal(calls[0].opts.free, true);
  assert.equal(calls[0].opts.noCooldown, true);
  assert.equal(calls[0].opts.noGcd, true);
  assert.equal(calls[0].opts.noLegendaryProcs, true);
});

test('關聯技能修改集中套用傷害、冷卻、法力與型態變化', () => {
  const context = loadLegendaryContext();
  const player = { hp: 1000, mp: 1000, shield: 0, skillCds: {}, buffs: {}, effects: {} };
  const target = { hp: 10000, maxHp: 10000, effects: {}, buffs: {}, dots: [] };
  const st = {
    hp: 1000,
    mp: 1000,
    legendaryEffects: {
      stormSigilChain: true,
      skyfallMeteor: true,
      manaExplosion: true,
      judgmentArrival: true,
      shadowAnnihilation: true,
      voidFate: true
    }
  };

  const storm = context.legendaryPrepareSkillCast(player, [target], 'stormSigil',
    context.SKILLS.stormSigil, context.SKILLS.stormSigil.fx, 1, st, {});
  assert.equal(storm.effectMult, 2);
  assert.equal(storm.fx.brand.maxStacks, context.SKILLS.stormSigil.fx.brand.maxStacks + 3);

  const meteor = context.legendaryPrepareSkillCast(player, [target], 'meteor',
    context.SKILLS.meteor, context.SKILLS.meteor.fx, 1, st, {});
  assert.equal(meteor.effectMult, 1.5);

  const burn = context.legendaryPrepareSkillCast(player, [target], 'manaBurn',
    context.SKILLS.manaBurn, context.SKILLS.manaBurn.fx, 1, st, {});
  assert.equal(burn.effectMult, 6);
  assert.equal(burn.manaCost, 500);

  const judgment = context.legendaryPrepareSkillCast(player, [target], 'holySmite',
    context.SKILLS.holySmite, context.SKILLS.holySmite.fx, 1, st, {});
  assert.equal(judgment.effectMult, 1.5);
  assert.equal(judgment.cdMult, 0.7);

  const rift = context.legendaryPrepareSkillCast(player, [target], 'voidRift',
    context.SKILLS.voidRift, context.SKILLS.voidRift.fx, 1, st, {});
  assert.equal(rift.effectMult, 11);
  assert.equal(rift.fx.execBelow, 20);

  const blood = context.legendaryPrepareSkillCast(player, [target], 'bloodSurge',
    context.SKILLS.bloodSurge, context.SKILLS.bloodSurge.fx, 1, st, {});
  assert.equal(blood.deferBloodSurgeSacrifice, true);
  assert.equal(blood.fx.hpSacrifice, undefined);

  context.resetLegendaryRT();
  st.legendaryEffects = { deathDomain: true };
  const domain = context.legendaryPrepareSkillCast(player, [target], 'powerSlash',
    context.SKILLS.powerSlash, context.SKILLS.powerSlash.fx, 1, st, {});
  assert.equal(domain.fx.dmgType, 'magic');
  assert.equal(domain.fx.elemOverride, 'poison'); // 技能屬性化：整段轉為毒屬性（特規優先於技能標籤）
  assert.equal(domain.effectMult, 1.5);
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
