/* 新版戰鬥 P6：技能／增益特效
   規格要求「所有技能或 buff 都要有簡易特效」。特效不逐一手寫，而是由技能既有資料推導，
   所以這裡驗的是「推導規則正確」＋「全表覆蓋率 100%」，而不是逐支技能的畫面。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext() {
  const context = {
    console, Math: Object.create(Math), UI: { dirty: {} }, GT: 0,
    RUN_STATS: { skills: {} },
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    blog() {}, floatText() {}, trackDps() {}, recordRunDamage() {}
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js', 'js/skills.js']
    .forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), context, { filename: f }));
  context.G = { player: { level: 1, skills: {}, loadout: [], fusions: [], talents: { levels: {}, potentialLevels: {} } }, stage: { current: 1 }, tower: { active: false } };
  return context;
}

test('特效原型由傷害範圍推導：單體/方框/直線/全場各走各的', () => {
  const c = loadContext();
  const phys = { id: 'x', name: '測試', emoji: '🗡️', cat: 'phys', tags: [] };
  const magic = { id: 'y', name: '測試', emoji: '🔮', cat: 'magic', tags: [] };
  const dmg = { dmgType: 'phys', stat: 'atk' };
  const mdmg = { dmgType: 'magic', stat: 'matk' };

  assert.equal(c.skillVfxKind(phys, dmg, ''), 'slash', '物理單體＝斬擊');
  assert.equal(c.skillVfxKind(magic, mdmg, ''), 'projectile', '魔法單體＝投射物');
  assert.equal(c.skillVfxKind(phys, dmg, '3*3'), 'burst', '方框＝爆發');
  assert.equal(c.skillVfxKind(phys, dmg, '2*2'), 'burst');
  assert.equal(c.skillVfxKind(phys, dmg, '1*3'), 'beam', '一直線＝貫穿');
  assert.equal(c.skillVfxKind(phys, dmg, '3*1'), 'beam');
  assert.equal(c.skillVfxKind(magic, mdmg, 'all'), 'rain', '全場＝天降');
});

test('沒有傷害段的技能（增益／治療／護盾）走我方光暈', () => {
  const c = loadContext();
  const def = { id: 'z', name: '護體', emoji: '🛡️', cat: 'def', tags: [] };
  assert.equal(c.skillVfxKind(def, { shieldPctMax: 10 }, ''), 'selfBuff');
  assert.equal(c.skillVfxKind(def, { buff: { key: 'atkUp' } }, '3*3'), 'selfBuff', '沒傷害就不看範圍');
  assert.equal(c.skillVfxKind(def, {}, ''), 'selfBuff');
});

test('顏色：帶屬性取屬性色，無屬性取系統分類色', () => {
  const c = loadContext();
  const fire = { id: 'a', name: '火', emoji: '🔥', cat: 'magic', tags: ['fire'] };
  assert.equal(c.skillVfxColor(fire, { dmgType: 'magic' }), c.ELEM_INFO.fire.color);
  const plain = { id: 'b', name: '斬', emoji: '🗡️', cat: 'phys', tags: [] };
  assert.equal(c.skillVfxColor(plain, { dmgType: 'phys' }), c.VFX_CAT_COLORS.phys);
  const heal = { id: 'c', name: '療', emoji: '💚', cat: 'def', tags: [] };
  assert.equal(c.skillVfxColor(heal, {}), c.VFX_CAT_COLORS.def);
});

test('特效事件是純資料：不含實體參照，欄位齊全且可 JSON 化', () => {
  const c = loadContext();
  const sk = { id: 'a', name: '火球', emoji: '🔥', cat: 'magic', tags: ['fire'] };
  const spec = c.skillVfxSpec(sk, { dmgType: 'magic', hits: 2 }, '', ['mv-float-0', 'mv-float-2'],
    [{ col: 1, row: 2 }]);
  assert.equal(spec.fxKind, 'projectile');
  assert.equal(spec.glyph, '🔥');
  assert.equal(spec.color, c.ELEM_INFO.fire.color);
  assert.deepEqual(JSON.parse(JSON.stringify(spec.targets)), ['mv-float-0', 'mv-float-2']);
  assert.equal(spec.count, 2, 'count 取技能段數');
  assert.ok(spec.dur > 0);
  // 整包必須能 structured clone（協議要求），JSON 化不丟東西即可視為純資料
  assert.doesNotThrow(() => JSON.stringify(spec));
});

test('count 夾在 1~5：段數再多也不會生成一堆節點', () => {
  const c = loadContext();
  const sk = { id: 'a', name: '亂舞', emoji: '⚔️', cat: 'phys', tags: [] };
  assert.equal(c.skillVfxSpec(sk, { dmgType: 'phys', hits: 99 }, '', [], null).count, 5);
  assert.equal(c.skillVfxSpec(sk, { dmgType: 'phys' }, '', [], null).count, 1);
});

test('個別技能可用 SKILL_VFX_OVERRIDE 特規，不必改推導規則', () => {
  const c = loadContext();
  const meteor = c.SKILLS.meteor;
  assert.ok(meteor, '隕石術應存在');
  const spec = c.skillVfxSpec(meteor, c.effectiveFx('meteor', meteor, 1), meteor.shape, ['mv-float-0'], null);
  assert.equal(spec.fxKind, 'rain', '隕石術被覆寫為天降');
});

test('全表覆蓋：每一支主動技與潛力技都推得出特效，且欄位合法', () => {
  const c = loadContext();
  // v17 新增 curse（純詛咒／減益畫在敵人身上）；chain/impact 由 combat.js/potential.js 直接組事件，不經推導
  const KINDS = ['projectile', 'slash', 'burst', 'beam', 'rain', 'aura', 'selfBuff', 'curse'];
  const ids = Object.keys(c.SKILLS);
  assert.ok(ids.length >= 90, '技能表應有 90 支以上');
  const seen = {};
  ids.forEach((id) => {
    const sk = c.SKILLS[id];
    if (sk.cat === 'passive') return; // 被動沒有施放時機
    const fx = c.effectiveFx(id, sk, 1);
    const spec = c.skillVfxSpec(sk, fx, fx.shape || sk.shape, ['mv-float-0'], null);
    assert.ok(KINDS.indexOf(spec.fxKind) >= 0, id + ' 的特效原型不合法：' + spec.fxKind);
    assert.ok(typeof spec.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(spec.color), id + ' 顏色不合法：' + spec.color);
    assert.ok(typeof spec.glyph === 'string' && spec.glyph.length > 0, id + ' 缺少圖案');
    assert.ok(spec.dur > 0 && spec.count >= 1, id + ' 時長或段數不合法');
    seen[spec.fxKind] = (seen[spec.fxKind] || 0) + 1;
  });
  // 推導不能退化成「全部都同一種」——至少要用到斬擊、投射物與我方光暈三種
  assert.ok(seen.slash > 0 && seen.projectile > 0 && seen.selfBuff > 0,
    '特效原型分布過於單一：' + JSON.stringify(seen));
});

test('潛力技能也有特效（不經 castSkill，另一條路徑）', () => {
  const c = loadContext();
  assert.ok(c.POTENTIAL_TALENTS.length > 0);
  c.POTENTIAL_TALENTS.forEach((t) => {
    const sk = { id: t.id, name: t.name, emoji: t.emoji, cat: 'potential', tags: t.tags || [] };
    const spec = c.skillVfxSpec(sk, { dmgType: t.dmgType || null }, null, ['mv-float-0'], null);
    assert.ok(spec.fxKind, t.id + ' 沒有特效原型');
    assert.ok(spec.color, t.id + ' 沒有顏色');
  });
});

test('高塔領域特效保留 BOSS 錨點，不退回玩家或野外場景', () => {
  const c = loadContext();
  let emitted = null;
  c.playCombatVfx = (spec) => { emitted = spec; };
  c.resetSkillRT();

  const pEnt = { hp: 1000, mp: 1000, buffs: {}, dots: [], effects: {}, skillCds: {} };
  const sk = { id: 'towerField', name: '高塔領域', emoji: '🌋', cat: 'magic', tags: ['fire'] };
  const fx = { dmgType: 'magic', stat: 'matk', field: { name: '高塔領域', dur: 6, tickSec: 1, tickPct: 25 } };
  const st = {
    level: 1, critRate: 0, critDmg: 150, hit: 100, passives: {},
    elemDmgPct: {}, elemDmgUp: {}, eliteDmg: 0, bossDmg: 0, normalDmg: 0,
    totalDmgPct: 0, dmgVsElem: {}
  };

  c.skillRtOpenField(pEnt, sk, fx, 'towerField', 1, st, {
    baseVal: 1000, areaCells: null, vfxTargets: ['tb-float']
  });

  assert.ok(emitted, '領域應送出特效事件');
  assert.deepEqual(emitted.targets, ['tb-float'], '高塔領域應以 BOSS 圖層作為特效錨點');
  assert.equal(emitted.cells, null, '高塔領域仍維持無棋盤格資料');
});
