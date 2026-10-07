'use strict';
/* ============================================================
   elite-data.test.cjs — 菁英詞條表（js/elite_data.js）與引擎（js/elite.js）的接線

   受測：ELITE_AFFIXES 每一列都要接得上引擎、特效 preset 都真的存在、數字欄位齊全。
   這條在表上多一列、改名一個欄位時最先紅——引擎讀不到欄位只會安靜地算出 NaN，畫面上看不出哪裡壞。
   ============================================================ */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadEliteEnv } = require('./helpers/elite-env.cjs');

const root = path.resolve(__dirname, '..');
const presetIds = new Set(fs.readdirSync(path.join(root, 'vfx', 'presets')).map((f) => f.replace(/\.json$/, '')));

/* 各原型必備的數字欄位：缺一個引擎就會讀到 undefined。 */
const NEED = {
  spots: ['n', 'spread', 'warn', 'step', 'r', 'dmg', 'warnPreset', 'burst'],
  spot: ['r', 'warn', 'warnPreset', 'burst', 'dmg', 'at'],
  zone: ['at', 'life', 'tick', 'preset', 'dmg'],
  volley: ['n', 'gap', 'travel', 'proj', 'hit', 'dmg', 'hitR'],
  beam: ['len', 'width', 'warn', 'warnPreset', 'beamPreset', 'dmg'],
  bolt: ['bolt', 'hit', 'dmg'],
  dash: ['warn', 'warnPreset', 'speed', 'hitR', 'impact', 'burst', 'dmg'],
  blink: ['dist', 'warn', 'warnPreset', 'burst', 'r', 'dmg'],
  spin: ['r', 'ticks', 'gap', 'warn', 'warnPreset', 'burst', 'dmg'],
  vortex: ['r', 'life', 'pull', 'warn', 'warnPreset', 'preset', 'burst', 'dmg'],
  shield: ['pct', 'dur', 'vfx'],
  reflect: ['dur', 'pct', 'vfx'],
  invuln: ['dur', 'vfx'],
  heal: ['pct', 'vfx'],
  summon: ['n', 'vfx'],
  bloodsac: ['heal', 'atk', 'dur', 'vfx'],
  curse: ['atkDown', 'defDown', 'dur', 'vfx', 'dmg'],
  drain: ['mp', 'heal', 'proj', 'dmg'],
  regen: ['pct', 'vfx'],
  haste: ['aspd', 'run'],
  giant: ['hp', 'red', 'scale'],
  enrage: ['hpPct', 'atk', 'aspd', 'vfx'],
  vampiric: ['pct', 'proj'],
  thorns: ['pct', 'cap', 'hit'],
  knockback: ['chance', 'dist', 'stun', 'vfx'],
  lifelink: ['share'],
  phoenix: ['hp', 'vfx', 'vfx2'],
  bomber: ['delay', 'r', 'dmg', 'warnPreset', 'burst'],
  splitter: ['n', 'hp', 'atk', 'vfx']
};

test('ELITE-DATA-1 詞條總數至少 30 個，id 不重複', () => {
  const c = loadEliteEnv();
  const ids = c.ELITE_AFFIX_ORDER;
  assert.ok(ids.length >= 30, '詞條只有 ' + ids.length + ' 個');
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(Array.from(ids), Object.keys(c.ELITE_AFFIXES));
});

test('ELITE-DATA-2 每個詞條都有名稱、圖示、顏色、說明，且原型接得上引擎', () => {
  const c = loadEliteEnv();
  c.ELITE_AFFIX_ORDER.forEach((id) => {
    const d = c.ELITE_AFFIXES[id];
    assert.ok(d.name && d.emoji && d.desc, id + ' 缺顯示欄位');
    assert.match(d.color, /^#[0-9a-f]{6}$/i, id + ' 顏色格式');
    assert.ok(d.kind === 'active' || d.kind === 'passive', id + ' kind');
    if (d.kind === 'active') {
      assert.equal(typeof c.ELITE_CASTERS[d.arch], 'function', id + ' 的原型 ' + d.arch + ' 沒有施放函式');
      assert.ok(Array.isArray(d.cd) && d.cd.length === 2 && d.cd[0] > 0 && d.cd[1] >= d.cd[0], id + ' 冷卻 cd');
    } else {
      assert.ok(c.ELITE_PASSIVE_ARCHS.indexOf(d.arch) >= 0, id + ' 的被動原型 ' + d.arch + ' 沒有登記');
    }
    assert.ok(NEED[d.arch], '測試的必備欄位表缺原型 ' + d.arch);
    NEED[d.arch].forEach((k) => assert.ok(d[k] !== undefined && d[k] !== null && d[k] !== '', id + ' 缺欄位 ' + k));
    assert.ok(d.w === undefined || d.w > 0, id + ' 權重');
  });
});

test('ELITE-DATA-3 表裡用到的 preset 全部存在，而且都在預載清單裡', () => {
  const c = loadEliteEnv();
  const preload = new Set(c.ELITE_VFX_PRESETS);
  const skip = { name: 1, emoji: 1, color: 1, kind: 1, arch: 1, grp: 1, desc: 1, elem: 1, at: 1 };
  c.ELITE_AFFIX_ORDER.forEach((id) => {
    const d = c.ELITE_AFFIXES[id];
    Object.keys(d).forEach((k) => {
      const v = d[k];
      if (typeof v !== 'string' || skip[k] || !/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(v)) return;
      assert.ok(presetIds.has(v), id + '.' + k + ' 指到不存在的 preset ' + v);
      assert.ok(preload.has(v), id + '.' + k + ' 的 ' + v + ' 沒進 ELITE_VFX_PRESETS（顯示層不會預載）');
    });
  });
  c.ELITE_VFX_PRESETS.forEach((id) => assert.ok(presetIds.has(id), '預載清單裡的 ' + id + ' 不存在'));
});

test('ELITE-DATA-4 每個預載 preset 都登記在 VFX_PRESET_USAGE_OUTSIDE_TABLES（AI_RULES 8.4）', () => {
  const c = loadEliteEnv();
  const doc = fs.readFileSync(path.join(root, 'docs', 'vfx', 'VFX_PRESET_USAGE_OUTSIDE_TABLES.md'), 'utf8');
  c.ELITE_VFX_PRESETS.forEach((id) => {
    const re = new RegExp('^\\| `' + id.replace(/[-]/g, '\\-') + '` \\| 菁英', 'm');
    assert.ok(re.test(doc), id + ' 沒有「菁英…」開頭的登記列');
  });
});

test('ELITE-DATA-5 互斥組：沒有任何詞條組合在抽取時會同時出現同一組', () => {
  const c = loadEliteEnv();
  for (let i = 0; i < 400; i++) {
    const stage = 1 + Math.floor(Math.random() * 400);
    const picked = c.eliteRollAffixes(stage, 3);
    assert.ok(picked.length >= 1 && picked.length <= 3);
    assert.equal(new Set(picked).size, picked.length, '同一個詞條不得重複');
    const groups = picked.map((id) => c.ELITE_AFFIXES[id].grp).filter(Boolean);
    assert.equal(new Set(groups).size, groups.length, '同一互斥組只能取一個：' + picked.join());
    picked.forEach((id) => {
      const d = c.ELITE_AFFIXES[id];
      assert.ok(!d.minStage || stage >= d.minStage, id + ' 在第 ' + stage + ' 關不該出現（minStage ' + d.minStage + '）');
    });
  }
});

test('ELITE-DATA-6 每個主動詞條在全新環境下都能施放、不丟例外、至少送出一則 elite-* 特效事件', () => {
  const c = loadEliteEnv({ stage: 120 });
  const { makeElite, makeMinion, stepElite } = require('./helpers/elite-env.cjs');
  c.ELITE_AFFIX_ORDER.filter((id) => c.ELITE_AFFIXES[id].kind === 'active').forEach((id) => {
    c.vfx.length = 0;
    c.vm = null;
    require('node:vm').runInContext("FIELD.monsters = []; FIELD.reviveCd = 0; G.stage.current = 120; FIELD.player = newPlayerEntity(getStats()); bfResetPlayer(); eliteReset();", c);
    const m = makeElite(c, [id]);
    makeMinion(c, 1);                 // 血祭、治療、召喚需要同伴
    m.hp = m.maxHp * 0.5;             // 治療需要有人受傷
    const d = c.ELITE_AFFIXES[id];
    m._el.cd[id] = 0;
    stepElite(c, 0.2);
    stepElite(c, 6);
    const elite = c.vfx.filter((e) => /^elite-/.test(e.variant || ''));
    assert.ok(elite.length >= 1, id + ' 沒有送出任何 elite-* 特效事件');
    elite.forEach((e) => {
      assert.equal(e.presetOnly, true, id + ' 的事件必須是 presetOnly');
      assert.ok(e.vfx && typeof e.vfx === 'object', id + ' 的事件缺 vfx 角色表');
    });
    assert.ok(d.name);
    assert.equal(c.ELITE_RT.errors, 0, id + ' 的施放過程丟了例外（eliteGuard 會吞掉，這裡看計數）');
  });
});

test('ELITE-DATA-7 docs/ELITE_AFFIXES.md 的詞條總表與資料表同步（改了表就重跑 tools/gen_elite_doc.cjs）', () => {
  const r = require('node:child_process').spawnSync(process.execPath,
    [path.join(root, 'tools', 'gen_elite_doc.cjs'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, (r.stdout || '') + (r.stderr || ''));
});
