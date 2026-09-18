/* Skills2「我方狀態／敵方狀態」欄（2026-09-18 狀態表格化，js/skills2.js SKILL2_STATUS_SLOTS）
   守住三件事：
     1. 表格與登記表一致：每個登記位置都對得到一列、目前填的狀態型別符合限制
     2. 換掉格子裡的狀態，施加點與後續各階跟著換（角色查詢）
     3. 超出登記數量的條目＝通用附加：我方在施放時、敵方在本技能每次命中時；參數可引用效果參數鍵名
   另外守住 tools/config_tables.cjs 的格子語法：解析、往返與錯誤訊息。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const table = require(path.join(root, 'tools/config_tables.cjs'));

function loadContext() {
  const context = {
    console,
    Math: Object.create(Math),
    setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    UI: { dirty: {} },
    blog() {}, floatText() {}, trackDps() {}, recordRunDamage() {}
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js',
    'js/skills.js', 'js/skills2.js']
    .forEach((file) => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file }));
  context.G = { player: { gold: 0, skills2: { levels: {} }, loadout: [] }, stage: { current: 1 } };
  context.getStats = () => ({
    atk: 1000, matk: 500, hp: 1000, mp: 100, level: 10, aspd: 2, cdr: 0,
    critRate: 0, critDmg: 150, hit: 100, tenacity: 0,
    passives: {}, elemAtk: null, elemDmgPct: 0, elemDmgUp: {},
    eliteDmg: 0, bossDmg: 0, normalDmg: 0, totalDmgPct: 0, dmgVsElem: null,
    aoeDmg: 0, globalDmgRed: 0
  });
  context.GT = 0;
  context.chance = () => true;
  context.resolveHit = function (attacker, defender) {
    defender.hp = Math.max(0, defender.hp - 100);
    return { dmg: 100, crit: false, miss: false, blocked: false, killed: defender.hp <= 0 };
  };
  context.applySkillFinalDamageMultiplier = function () {};
  return context;
}
function enemy(hp) {
  return { name: '測試怪', maxHp: hp, hp, def: 0, mdef: 0, level: 1,
    effects: {}, buffs: {}, dots: [], resist: {}, ctrlRes: 0 };
}
function playerEnt() {
  return { hp: 1000, mp: 500, shield: 0, shieldMax: 0, skillCds: {}, buffs: {}, dots: [], effects: {}, _lockTarget: null };
}
function setLevels(c, gid, levels) { c.G.player.skills2.levels[gid] = levels.slice(); }
/* 就地改表：改完要清掉角色快取（正式遊戲改表會整頁重載）。 */
function setStatus(c, gid, tierKey, side, list) {
  const row = c.sgStatusRow(gid, tierKey);
  row.status = Object.assign({}, row.status || {});
  row.status[side] = list;
  c.sgStatusSlotsReset();
}
function dotSids(ent) { return (ent.dots || []).map(d => d.sid); }

/* ---- 1) 表格與登記表一致 ---- */

test('STATUS-SLOT-1 每個登記位置都對得到一列，且目前填的狀態符合型別限制', () => {
  const c = loadContext();
  const slots = c.SKILL2_STATUS_SLOTS;
  assert.ok(Object.keys(slots).length >= 50, '登記位置不應少於改造時的 50 個');
  for (const key of Object.keys(slots)) {
    const [gid, tier, side] = key.split('.');
    assert.ok(c.sgStatusRow(gid, tier), key + ' 對得到 Skills2 的一列');
    assert.ok(side === 'self' || side === 'enemy', key + ' 的方向');
    slots[key].forEach((s, i) => {
      const sid = c.sgSlotSid(gid, tier, side, i);
      assert.ok(sid, key + ' 第 ' + (i + 1) + ' 格有填狀態（預設即改造前寫死的那一個）');
      if (s.effect) assert.equal(c.statusDef(sid).effect, s.effect, key + ' 第 ' + (i + 1) + ' 格的型別');
    });
  }
});

test('STATUS-SLOT-2 預設表格重現改造前寫死的狀態（代表性抽查）', () => {
  const c = loadContext();
  assert.deepStrictEqual(Array.from(c.sgRoleSids('bleed')), ['sgBleed']);
  assert.deepStrictEqual(Array.from(c.sgRoleSids('burn')), ['sgBurn'], '火球與火龍捲共用同一份燃燒');
  assert.deepStrictEqual(Array.from(c.sgRoleSids('frost')), ['sgFrost'], '三棵樹的寒霜共用同一個層數狀態');
  assert.equal(c.sgSlotSid('rockarmor', '1', 'self', 0), 'shield');
  assert.equal(c.sgSlotSid('rockarmor', 'superRockArt', 'enemy', 0), 'stun');
  assert.equal(c.sgSlotSid('dualdance', '7', 'self', 0), 'sgStorm', '計時類狀態也在表上');
});

/* ---- 2) 換狀態：施加點與後續各階跟著換 ---- */

test('STATUS-SLOT-3 血刃斬的流血換成燃燒：施加的是燃燒，【虛弱】也改認燃燒', () => {
  const c = loadContext();
  setLevels(c, 'bloodblade', [1, 1, 1, 0, 0, 0, 0]);   // 前一階至少 Lv.1 才算後一階
  const p = playerEnt(), m = enemy(1e9);
  c.castSkill2(p, [m], 'bloodblade', 'mv-float');
  assert.ok(dotSids(m).includes('sgBleed'), '預設塗流血');
  assert.ok(c.skill2VulnPct(m) > 0, '流血中的敵人吃【虛弱】');

  setStatus(c, 'bloodblade', '1', 'enemy', [{ id: 'burn' }]);
  const m2 = enemy(1e9);
  c.castSkill2(Object.assign(playerEnt(), {}), [m2], 'bloodblade', 'mv-float');
  assert.ok(!dotSids(m2).includes('sgBleed'), '換掉之後不再塗流血');
  assert.ok(dotSids(m2).includes('burn'), '改塗表格上填的狀態');
  const bleed = c.sgBloodbladeDotSpec(c.getStats(), c.skills2Levels('bloodblade'), c.SKILLS2.bloodblade.tiers, 'bleed');
  assert.ok(Math.abs(m2.dots.find(d => d.sid === 'burn').dps - bleed.dps) < 1e-9, '數值仍由技能公式決定');
  assert.ok(c.skill2VulnPct(m2) > 0, '【虛弱】跟著角色走，認的是新填的狀態');
});

test('STATUS-SLOT-4 格子留空＝不施加；登記位置的參數覆寫技能公式的同名欄位', () => {
  const c = loadContext();
  setLevels(c, 'gale', [1, 1, 1, 1, 1, 0, 0]);
  setStatus(c, 'gale', '5', 'self', [{ id: 'sgGale', dur: 10 }]);
  const p = playerEnt();
  c.sgApplySlot(p, 'gale', '5', 'self', 0, { val: 20, dur: 5 });
  assert.equal(p.buffs.sgGale.until - c.GT, 10, 'dur=10 覆寫公式給的 5 秒');
  assert.equal(p.buffs.sgGale.val, 20, '沒覆寫的欄位仍用公式值');

  setStatus(c, 'gale', '5', 'self', []);
  const p2 = playerEnt();
  assert.equal(c.sgApplySlot(p2, 'gale', '5', 'self', 0, { val: 20, dur: 5 }), false);
  assert.ok(!p2.buffs.sgGale, '留空的格子不施加任何狀態');
});

test('STATUS-SLOT-5 敵方控場一律吃 BOSS 控場免疫（暈眩換成別的控場也一樣）', () => {
  const c = loadContext();
  c.isBossControlImmune = (e) => !!e.isBoss;
  setStatus(c, 'thunderstrike', '5', 'enemy', [{ id: 'slow' }]);
  const boss = Object.assign(enemy(1e9), { isBoss: true });
  assert.equal(c.sgTryStun(boss, 2, { gid: 'thunderstrike', tier: '5' }), 0, 'BOSS 擋掉');
  const mob = enemy(1e9);
  assert.ok(c.sgTryStun(mob, 2, { gid: 'thunderstrike', tier: '5' }) > 0);
  assert.ok(mob.effects.slow > c.GT, '塗的是表格上填的 slow');
  assert.ok(!(mob.effects.stun > c.GT), '不再塗 stun');
});

/* ---- 3) 附加條目 ---- */

test('STATUS-SLOT-6 敵方附加條目：本技能每次命中都附加，參數可引用效果參數鍵名', () => {
  const c = loadContext();
  setLevels(c, 'thrust', [1, 0, 0, 0, 0, 0, 0]);
  setStatus(c, 'thrust', '1', 'enemy', [{ id: 'atkDown', val: 'count', dur: 3 }]);
  const m = enemy(1e9);
  c.castSkill2(playerEnt(), [m], 'thrust', 'mv-float');
  assert.ok(m.buffs.atkDown, '突刺命中後附加 atkDown');
  const want = c.sgVal(c.SKILLS2.thrust.tiers[0].fx, 'count', 1);
  assert.equal(m.buffs.atkDown.val, want, 'val=count 以本列效果參數 count 在 Lv.1 的值換算');
  assert.equal(m.buffs.atkDown.until - c.GT, 3);
});

test('STATUS-SLOT-7 我方附加條目在施放時套在自己身上；登記列的附加條目排在登記格數之後', () => {
  const c = loadContext();
  setLevels(c, 'gale', [1, 1, 1, 1, 1, 0, 0]);
  setStatus(c, 'gale', '5', 'self', [{ id: 'sgGale' }, { id: 'defUp', val: 7, dur: 4 }]);
  const p = playerEnt();
  c.castSkill2(p, [enemy(1e9)], 'gale', 'mv-float');
  assert.ok(p.buffs.sgGale, '第一格仍是技能原有的施加點');
  assert.equal(p.buffs.defUp && p.buffs.defUp.val, 7, '第二格是附加條目，施放時套上');
});

test('STATUS-SLOT-8 沒學的階不附加；超神列只在選中時附加', () => {
  const c = loadContext();
  setLevels(c, 'thrust', [1, 0, 0, 0, 0, 0, 0]);
  setStatus(c, 'thrust', '2', 'enemy', [{ id: 'atkDown' }]);
  const m = enemy(1e9);
  c.castSkill2(playerEnt(), [m], 'thrust', 'mv-float');
  assert.ok(!m.buffs.atkDown, '第 2 階 Lv.0：不附加');
});

/* ---- 4) 參數表語法 ---- */

test('STATUS-SLOT-9 參數表：格子語法可往返，錯誤要擋在同步時', () => {
  const src = fs.readFileSync(path.join(root, 'js/skills2.js'), 'utf8');
  const rows = table.SCHEMAS.Skills2.extract(src);
  const header = table.SCHEMAS.Skills2.header;
  const iSelf = header.indexOf('我方狀態'), iEnemy = header.indexOf('敵方狀態');
  assert.ok(iSelf >= 0 && iEnemy >= 0, '表頭有兩個狀態欄');
  const rebuilt = table.SCHEMAS.Skills2.rebuild(rows, header).SKILLS2;
  const before = table.evalLiteral(table.extractLiteral(src, 'SKILLS2').literal);
  const after = table.evalLiteral(rebuilt.replace(/^var SKILLS2 = /, '').replace(/;$/, ''));
  assert.deepStrictEqual(after.gale.tiers[4].status, before.gale.tiers[4].status, '往返不失真');

  const at = (gid, tier) => rows.findIndex(r => r[0] === gid && r[header.indexOf('階數')] === tier);
  const withCell = (gid, tier, col, value) => {
    const copy = rows.map(r => r.slice());
    copy[at(gid, tier)][col] = value;
    return () => table.SCHEMAS.Skills2.rebuild(copy, header);
  };
  // 參數引用鍵名、全形標點
  const ok = withCell('gale', '1', iSelf, 'defUp（val＝pct，dur=3）；atkUp')();
  const galeRow = table.evalLiteral(ok.SKILLS2.replace(/^var SKILLS2 = /, '').replace(/;$/, '')).gale.tiers[0];
  assert.deepStrictEqual(galeRow.status.self, [{ id: 'defUp', val: 'pct', dur: 3 }, { id: 'atkUp' }]);
  assert.throws(withCell('gale', '1', iSelf, 'noSuchStatus'), /狀態表沒有/);
  assert.throws(withCell('gale', '1', iSelf, 'defUp(foo=1)'), /沒有參數「foo」/);
  assert.throws(withCell('gale', '1', iSelf, 'defUp(val=noSuchKey)'), /本列效果參數沒有/);
  assert.throws(withCell('bloodblade', '1', iEnemy, 'atkDown'), /必須填持續傷害/, '流血格限 dot');
  assert.throws(withCell('bloodblade', '1', iEnemy, 'sgBleed(dmg=50)'), /不能用 dmg 覆寫/);
  // 舊格式（沒有狀態欄）整批拒絕，避免把所有技能附加的狀態清空
  const oldHeader = header.filter(h => h !== '我方狀態' && h !== '敵方狀態');
  const oldRows = rows.map(r => r.filter((_, i) => i !== iSelf && i !== iEnemy));
  assert.throws(() => table.SCHEMAS.Skills2.rebuild(oldRows, oldHeader), /缺少「我方狀態」「敵方狀態」欄/);
});
