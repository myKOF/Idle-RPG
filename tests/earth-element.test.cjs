const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

/* 大地屬性（2026-08-07 新增的第七系）。
   這一批測試的重點不是「earth 這個字串存在」，而是「新元素有沒有真的走完整條管線」——
   歷史教訓：NPC 表早就有兩列填了 earth，但 earth 不在 ELEMENTS 裡，
   那兩隻的屬性標籤不會顯示、對地屬性傷害也永遠打不到人，卻沒有任何測試會紅。
   所以下面一律拿 ELEMENTS 當基準逐系檢查，而不是單獨挑 earth 斷言。 */

function loadContext(files) {
  const context = { console, UI: { dirty: {} } };
  context.window = context;
  vm.createContext(context);
  files.forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.chance = (p) => p >= 100;
  context.rnd = () => 1;
  return context;
}

function loadFormulaContext() {
  return loadContext(['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js']);
}

function loadStatsContext() {
  const context = loadContext(['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/talents.js']);
  context.G = {
    player: { level: 1, reincarnations: 10, skills: {}, talents: { levels: {}, potentialLevels: {} } },
    equipment: context.SLOT_LIST.reduce((eq, slot) => { eq[slot] = null; return eq; }, {})
  };
  return context;
}

function hit(context, aCfg, dCfg) {
  const defender = { hp: 1e9, shield: 0, effects: {}, dots: [] };
  return context.resolveHit({}, defender, Object.assign({
    atk: 10000, dmgType: 'magic', level: 1, hit: 100
  }, aCfg), Object.assign({ dodge: 0, mdef: 0, mRes: 0, resist: {} }, dCfg));
}

const cap = (e) => e.charAt(0).toUpperCase() + e.slice(1);

test('earth 是 ELEMENTS 的正式成員，且 ELEM_INFO 每系齊全', () => {
  const c = loadFormulaContext();
  assert.ok(c.ELEMENTS.includes('earth'));
  assert.equal(c.ELEMENTS.length, 7);
  for (const e of c.ELEMENTS) {
    const info = c.ELEM_INFO[e];
    assert.ok(info, `${e} 缺少 ELEM_INFO`);
    assert.ok(info.name && info.short && info.emoji && info.color, `${e} 的 ELEM_INFO 欄位不齊`);
  }
});

test('每一系元素都有詞條、寶石與附魔三種取得管道', () => {
  const c = loadFormulaContext();
  const gemStats = new Set(Object.values(c.GEM_TYPES).map((g) => g.stat));
  for (const e of c.ELEMENTS) {
    for (const key of ['dmgVs' + cap(e), 'elemDmg' + cap(e), 'res' + cap(e)]) {
      assert.ok(c.AFFIX_POOL[key], `缺少詞條 ${key}`);
      assert.ok(c.SCORE_WEIGHTS[key] > 0, `缺少戰力權重 ${key}`);
      assert.ok(gemStats.has(key), `缺少對應 ${key} 的寶石`);
    }
    assert.ok(c.ENCHANTS[e] && c.ENCHANTS[e].elem === e, `缺少 ${e} 攻擊附魔`);
    assert.ok(c.ENCHANTS[e + 'Res'], `缺少 ${e} 抗性附魔`);
    assert.equal(c.ENCHANT_RES_MAP[e + 'Res'], e, `${e} 抗性附魔未對應到元素`);
  }
});

test('computeStats 的元素表全部依 ELEMENTS 生成，不會漏鍵', () => {
  const c = loadStatsContext();
  const st = c.computeStats();
  for (const bucket of ['resist', 'elemAtk', 'enchantRes', 'dmgVsElem', 'elemDmgUp', 'resVsElem', 'elemDmgPct']) {
    for (const e of c.ELEMENTS) {
      assert.equal(typeof st[bucket][e], 'number', `st.${bucket} 缺少 ${e}`);
    }
  }
  assert.equal(typeof st.resist.ctrl, 'number', 'resist.ctrl 不該被元素表覆蓋掉');
});

test('地屬性天賦有接進 computeStats：附傷、對地敵傷害、對地敵抗性', () => {
  const c = loadStatsContext();
  c.G.player.talents.levels.t5_earth = 10;   // 5 轉：10 × 0.5% = 5%
  c.G.player.talents.levels.t9_earth = 10;   // 9 轉：10 × 2% = 20%（同元素相加）
  c.G.player.talents.levels.t6_vsearth = 10; // 6 轉：10 × 2% = 20%
  c.G.player.talents.levels.t8_rvsearth = 10;// 8 轉：10 × 3% = 30%
  const st = c.computeStats();
  assert.equal(st.elemDmgPct.earth, 25);
  assert.equal(st.dmgVsElem.earth, 20);
  assert.equal(st.resVsElem.earth, 30);
  assert.equal(st.elemDmgPct.fire, 0, '只點地屬性不該連帶灌到其他系');
});

test('大地抗性減免地屬性附傷，且與其他系互不相干', () => {
  const c = loadFormulaContext();
  const base = hit(c, { atk: 0, elemAtk: { earth: 100 } }, {}).dmg;
  assert.equal(base, 100);
  const expected = Math.round(100 * (1 - c.elementalResistanceReduction(50, 1)));
  assert.equal(hit(c, { atk: 0, elemAtk: { earth: 100 } }, { resist: { earth: 50 } }).dmg, expected);
  assert.equal(hit(c, { atk: 0, elemAtk: { earth: 100 } }, { resist: { fire: 50 } }).dmg, 100,
    '火抗不該擋地傷');
});

test('地屬性傷害提升% 放大自身地屬性輸出', () => {
  const c = loadFormulaContext();
  const r = hit(c, { atk: 0, elemAtk: { earth: 100 }, elemDmgUp: { earth: 50 } }, {});
  assert.equal(r.dmg, 150);
});

test('對地屬性敵人傷害% 只對帶 earth 標籤的敵人生效', () => {
  const c = loadFormulaContext();
  const aCfg = { atk: 1000, dmgVsElem: { earth: 100 } };
  assert.equal(hit(c, aCfg, { attr: 'earth' }).dmg, 2000);
  assert.equal(hit(c, aCfg, { attr: 'dark' }).dmg, 1000);
  assert.equal(hit(c, aCfg, {}).dmg, 1000);
});

test('元素特效【岩甲】：地屬性傷害有機率轉為護盾，只回報不直接給盾', () => {
  const c = loadFormulaContext();
  // chance 樁只在 ≥100 時成立 → 先確認預設機率下不會誤觸發
  assert.equal(hit(c, { atk: 0, elemAtk: { earth: 200 } }, {}).shield, 0);
  c.ELEM_PROC.earthShieldChance = 100;
  const r = hit(c, { atk: 0, elemAtk: { earth: 200 } }, {});
  assert.equal(r.shield, 200 * c.ELEM_PROC.earthShieldMult);
  assert.ok(r.procs.includes('岩甲'));
  // resolveHit 不該就地改動任何實體的護盾（給盾在 js/combat.js）
  assert.match(fs.readFileSync(path.join(root, 'js/combat.js'), 'utf8'), /grantShield\(pEnt, res\.shield, st\)/);
});

test('grantShield 吃護盾效率%，且不超過技能護盾上限', () => {
  const c = loadFormulaContext();
  const pEnt = { hp: 100, shield: 0 };
  assert.equal(c.grantShield(pEnt, 100, { hp: 1000, shieldEff: 50 }), 150);
  const capped = { hp: 100, shield: 0 };
  const cap100 = 100 * (c.SHIELD_SKILL_CAP_PCT / 100);
  c.grantShield(capped, 1e12, { hp: 100, shieldEff: 0 });
  assert.equal(capped.shield, cap100);
});

test('NPC 表有實際帶地屬性標籤的敵人，且 attr 一律是合法元素', () => {
  const c = loadContext(['js/util.js', 'js/data.js']);
  const attrs = Object.values(c.NPC_CONFIG_TABLE).map((n) => n.attr).filter(Boolean);
  assert.ok(attrs.filter((a) => a === 'earth').length >= 4, '地屬性 NPC 太少，該屬性等同沒有作用對象');
  for (const a of new Set(attrs)) {
    assert.ok(c.ELEMENTS.includes(a), `NPC 的屬性標籤 ${a} 不在 ELEMENTS 內`);
  }
  for (const b of c.BOSS_LIST) {
    assert.ok(c.ELEMENTS.includes(b.attr), `BOSS ${b.name} 的屬性標籤 ${b.attr} 不在 ELEMENTS 內`);
  }
  // CSV 是給人看的鏡像，與 JS 的 attr 必須一致（xlsx 才是來源，CSV 由它產生）
  const csv = fs.readFileSync(path.join(root, 'config/CSV/NPC.csv'), 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/);
  const csvAttr = new Map(csv.slice(1).map((line) => { const f = line.split(','); return [f[0], f[3]]; }));
  for (const [id, npc] of Object.entries(c.NPC_CONFIG_TABLE)) {
    assert.equal(csvAttr.get(id), npc.attr, `NPC.csv 的 ${id} 屬性與 js/data.js 不一致`);
  }
});

test('NPC 表已接入套用參數流程，且同步後 dry-run 不再有 JS 差異', () => {
  const result = spawnSync(process.execPath, ['tools/config_tables.cjs', '--apply', 'NPC'], {
    cwd: root, encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /重建字面值 7 個（語意變更 0）/);
  const c = loadContext(['js/util.js', 'js/data.js']);
  assert.equal(c.NPC_CONFIG_TABLE.undead_1.hpMult, 1.05);
  assert.equal(c.NPC_CONFIG_TABLE.undead_3.aspdMult, 1.2);
  const batch = fs.readFileSync(path.join(root, '套用參數.bat'), 'utf8');
  assert.match(batch, /NPC\.xlsx/);
  assert.match(batch, /%~2"=="NPC" exit \/b 0/);
});

test('特效層每一系元素都有主題色與受擊類別', () => {
  const c = loadContext(['js/util.js', 'js/data.js']);
  const vfx = fs.readFileSync(path.join(root, 'js/vfx.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  const themeBlock = /var VFX_ELEM_THEME = \{([\s\S]*?)\n\};/.exec(vfx)[1];
  const hitBlock = /var VFX_HIT_CLASSES = \[([\s\S]*?)\];/.exec(vfx)[1];
  for (const e of c.ELEMENTS) {
    assert.match(themeBlock, new RegExp('\\b' + e + '\\s*:'), `VFX_ELEM_THEME 缺少 ${e}`);
    assert.ok(hitBlock.includes(`'vfx-hit-${e}'`), `VFX_HIT_CLASSES 缺少 vfx-hit-${e}`);
    assert.ok(css.includes(`.vfx-hit-${e}`), `style.css 缺少 .vfx-hit-${e}`);
    assert.ok(css.includes(`.skill-tag-${e}`), `style.css 缺少 .skill-tag-${e}`);
  }
});
