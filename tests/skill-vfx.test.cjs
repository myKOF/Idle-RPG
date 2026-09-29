/* 新版戰鬥 P6：技能／增益特效（潛力技能使用的 skillVfxSpec／skillVfxKind／skillVfxColor，js/skills.js）
   特效不逐一手寫，而是由技能既有資料推導，所以這裡驗的是「推導規則正確」＋「潛力技能表覆蓋率 100%」，
   而不是逐支技能的畫面。

   2026-09-29 舊技能系統整批移除：SKILL_VFX_OVERRIDE 特規、隕石專用特效、舊技能表全表覆蓋隨之刪除
   （全表覆蓋改為只掃潛力技能表）；高塔領域特效錨點原本用舊 skillRtOpenField 驗，改用新版火柱驗同一個約定。
   新版技能（skills2.js）自己組特效事件、Preset 來自表格欄位。 */
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
  context.G = { player: { level: 1, loadout: [], talents: { levels: {}, potentialLevels: {} } }, stage: { current: 1 }, tower: { active: false } };
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

test('潛力技能也有特效（castPotentialSkill 自己組事件），全表覆蓋且欄位合法', () => {
  const c = loadContext();
  // v17 新增 curse（純詛咒／減益畫在敵人身上）；chain/impact 由 potential.js 直接組事件，不經推導
  const KINDS = ['projectile', 'slash', 'burst', 'beam', 'rain', 'aura', 'selfBuff', 'curse'];
  assert.ok(c.POTENTIAL_TALENTS.length > 0);
  c.POTENTIAL_TALENTS.forEach((t) => {
    // 與 castPotentialSkill 相同的組法：系統分類固定 potential、傷害類型取表上的 dmgType
    const sk = { id: t.id, name: t.name, emoji: t.emoji, cat: 'potential', tags: t.tags || [] };
    const spec = c.skillVfxSpec(sk, { dmgType: t.dmgType || null }, null, ['mv-float-0'], null);
    assert.ok(KINDS.indexOf(spec.fxKind) >= 0, t.id + ' 的特效原型不合法：' + spec.fxKind);
    assert.ok(typeof spec.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(spec.color), t.id + ' 顏色不合法：' + spec.color);
    assert.ok(typeof spec.glyph === 'string' && spec.glyph.length > 0, t.id + ' 缺少圖案');
    assert.ok(spec.dur > 0 && spec.count >= 1, t.id + ' 時長或段數不合法');
  });
});

test('沒有配置 Preset 的技能特效事件帶空表，不讓顯示層自行補畫法', () => {
  const c = loadContext();
  const sk = { id: 'a', name: '火球', emoji: '🔥', cat: 'magic', tags: ['fire'] };
  assert.deepEqual(JSON.parse(JSON.stringify(c.skillVfxSpec(sk, { dmgType: 'magic' }, '', [], null).vfx)), {});
  const configured = { id: 'b', name: '斬', emoji: '🗡️', cat: 'phys', tags: [], vfx: { cast: 'preset-a', hit: 'preset-b' } };
  assert.deepEqual(JSON.parse(JSON.stringify(c.skillVfxSpec(configured, { dmgType: 'phys' }, '', [], null).vfx)),
    { cast: 'preset-a', hit: 'preset-b' });
});

/* 高塔（單體 BOSS、無座標）：新版技能的場域特效仍要以 BOSS 圖層 'tb-float' 為錨點，
   不能退回玩家或野外場景（原本用舊「領域」機制驗，改用新版火柱驗同一個約定）。 */
test('高塔場域特效保留 BOSS 錨點，不退回玩家或野外場景', () => {
  const context = {
    console, Math: Object.create(Math), setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    UI: { dirty: {} }, blog() {}, floatText() {}, trackDps() {}, recordRunDamage() {}
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js', 'js/skills.js', 'js/skills2.js']
    .forEach((f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), context, { filename: f }));
  context.G = { player: { gold: 0, skills2: { levels: { firepillar: [1, 0, 0, 0, 0, 0, 0] } }, loadout: [] }, stage: { current: 1 } };
  context.getStats = () => ({
    atk: 1000, matk: 1000, hp: 1000, mp: 100, level: 10, aspd: 2, cdr: 0,
    critRate: 0, critDmg: 150, hit: 100, tenacity: 0,
    passives: {}, elemAtk: null, elemDmgPct: 0, elemDmgUp: 0,
    eliteDmg: 0, bossDmg: 0, normalDmg: 0, totalDmgPct: 0, dmgVsElem: null,
    aoeDmg: 0, globalDmgRed: 0
  });
  const emitted = [];
  context.playCombatVfx = (spec) => emitted.push(JSON.parse(JSON.stringify(spec)));
  context.resetSkillRT();

  const pEnt = { hp: 1000, mp: 100, shield: 0, shieldMax: 0, skillCds: {}, buffs: {}, dots: [], effects: {}, _lockTarget: null };
  // 高塔 BOSS：沒有 pos（無座標）、沒有 floatSel，錨點完全由 floatSel 參數決定
  const boss = { name: 'boss', maxHp: 1e9, hp: 1e9, def: 0, mdef: 0, level: 1, effects: {}, buffs: {}, dots: [], resist: {}, ctrlRes: 0, isBoss: true };

  assert.ok(context.castSkill2(pEnt, boss, 'firepillar', 'tb-float'), '火柱應可對高塔 BOSS 施放');
  for (let i = 1; i <= 4; i++) {
    context.GT = i * 0.5;
    context.tickSkill2(0.5, { pEnt, getEnemies: () => [boss], floatSel: 'tb-float', onDeaths() {} });
  }

  assert.ok(emitted.length > 0, '場域跳傷時應送出特效事件');
  emitted.forEach((spec) => {
    assert.deepEqual(spec.targets, ['tb-float'], '高塔場域應以 BOSS 圖層作為特效錨點');
    assert.equal(spec.area, null, '高塔仍維持無區域資料（座標制：area）');
  });
});
