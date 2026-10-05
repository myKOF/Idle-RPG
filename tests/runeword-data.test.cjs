const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRuneEnv } = require('./helpers/runeword-env.cjs');

/* 符文之語資料表的完整性：拼字、引用、強度分級與可達性。
   這些都是「資料表打錯一個字就靜默失效」的類型，所以逐項釘死。 */
const c = loadRuneEnv({ noState: true });
const RUNES = c.RUNES, WORDS = c.RUNEWORDS;

test('符文 33 種，id 連號、階數遞增，兩側屬性都是合法且未鎖定的詞條', () => {
  assert.equal(RUNES.length, 33);
  RUNES.forEach((r, i) => {
    assert.equal(r.id, 'r' + String(i + 1).padStart(2, '0'));
    assert.equal(r.tier, i + 1);
    assert.ok(r.name && r.glyph && r.color, r.id + ' 缺名稱／字形／顏色');
    ['w', 'a'].forEach((side) => {
      const [key, mult] = r[side];
      assert.ok(c.AFFIX_POOL[key], `${r.id}.${side} 詞條 ${key} 不存在`);
      assert.ok(!c.affixIsAllLocked(key), `${r.id}.${side} 詞條 ${key} 已被鎖定（all_lock）`);
      assert.ok(mult > 0, `${r.id}.${side} mult 必須為正`);
    });
  });
  assert.equal(new Set(RUNES.map((r) => r.name)).size, 33, '符文名稱不得重複');
  assert.equal(new Set(RUNES.map((r) => r.glyph)).size, 33, '符文字形不得重複');
});

test('符文之語至少 40 組，四個強度級距數量接近，id／名稱／配方都唯一', () => {
  assert.ok(WORDS.length >= 40, '至少 40 組，實際 ' + WORDS.length);
  const byTier = [0, 0, 0, 0, 0];
  WORDS.forEach((w) => { byTier[w.tier]++; });
  for (let t = 1; t <= 4; t++) assert.ok(byTier[t] >= 10, `第 ${t} 級只有 ${byTier[t]} 組`);
  const spread = Math.max(...byTier.slice(1)) - Math.min(...byTier.slice(1));
  assert.ok(spread <= 2, '四級數量應大約平均：' + byTier.slice(1).join('/'));
  assert.equal(new Set(WORDS.map((w) => w.id)).size, WORDS.length);
  assert.equal(new Set(WORDS.map((w) => w.name)).size, WORDS.length);
  assert.equal(new Set(WORDS.map((w) => w.runes.join(','))).size, WORDS.length, '配方（符文序列）不得重複');
});

test('每組的符文數與強度級距相稱，且所有符文 id 存在', () => {
  const range = { 1: [2, 3], 2: [3, 4], 3: [4, 5], 4: [5, 6] };
  WORDS.forEach((w) => {
    const [lo, hi] = range[w.tier];
    assert.ok(w.runes.length >= lo && w.runes.length <= hi, `${w.id}（第 ${w.tier} 級）符文數 ${w.runes.length} 不在 ${lo}~${hi}`);
    w.runes.forEach((id) => assert.ok(c.RUNE_BY_ID[id], `${w.id} 引用不存在的符文 ${id}`));
  });
});

test('高級符文之語使用的符文階數不低於其級距的下限（越強越難做）', () => {
  const floor = { 1: 1, 2: 1, 3: 10, 4: 19 };
  const avg = (w) => w.runes.reduce((s, id) => s + c.RUNE_BY_ID[id].tier, 0) / w.runes.length;
  const byTier = {};
  WORDS.forEach((w) => { (byTier[w.tier] = byTier[w.tier] || []).push(avg(w)); });
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  assert.ok(mean(byTier[1]) < mean(byTier[2]));
  assert.ok(mean(byTier[2]) < mean(byTier[3]));
  assert.ok(mean(byTier[3]) < mean(byTier[4]));
  WORDS.forEach((w) => {
    const minTier = Math.min(...w.runes.map((id) => c.RUNE_BY_ID[id].tier));
    assert.ok(minTier >= 1);
    assert.ok(avg(w) >= floor[w.tier], `${w.id} 平均符文階 ${avg(w).toFixed(1)} 低於級距下限 ${floor[w.tier]}`);
  });
});

test('裝備類型標記只能是已知標記、欄位類型或武器類型', () => {
  const slots = new Set(['weapon', 'helmet', 'shoulder', 'chest', 'belt', 'gloves', 'wrist', 'legs', 'boots', 'ring', 'amulet']);
  WORDS.forEach((w) => {
    assert.ok(Array.isArray(w.bases) && w.bases.length, w.id + ' 缺 bases');
    w.bases.forEach((b) => {
      const ok = c.RW_BASE_TOKENS.includes(b) || slots.has(b) || !!c.WEAPON_TYPES[b];
      assert.ok(ok, `${w.id} 的 bases 含未知標記 ${b}`);
    });
  });
});

test('stats／passives／legend／fx／procs 只用已實作的詞彙', () => {
  const passiveKeys = new Set(['thorns', 'smite', 'undying', 'sunder', 'trueDmg', 'omniDrain', 'soulEater', 'annihilate', 'sanctuary', 'godWrath']);
  WORDS.forEach((w) => {
    (w.stats || []).forEach(([key, mult]) => {
      assert.ok(c.AFFIX_POOL[key], `${w.id} stats 詞條 ${key} 不存在`);
      assert.ok(!c.affixIsAllLocked(key), `${w.id} stats 詞條 ${key} 已被鎖定`);
      assert.equal(typeof mult, 'number');
    });
    Object.keys(w.passives || {}).forEach((k) => assert.ok(passiveKeys.has(k), `${w.id} 未知被動 ${k}`));
    (w.legend || []).forEach((k) => assert.ok(c.PASSIVE_POOL[k] && c.PASSIVE_POOL[k].legendary, `${w.id} 借用不存在的傳奇特效 ${k}`));
    Object.keys(w.fx || {}).forEach((k) => assert.ok(c.RW_FX_KEYS.includes(k), `${w.id} 未知 fx 鍵 ${k}`));
    (w.procs || []).forEach((p) => {
      assert.ok(c.RW_PROC_TRIGGERS.includes(p.on), `${w.id} 未知觸發 ${p.on}`);
      if (p.on === 'tick') assert.ok(p.every > 0, `${w.id} tick 缺 every`);
      if (p.on === 'lowhp') assert.ok(p.below > 0, `${w.id} lowhp 缺 below`);
      assert.ok(Array.isArray(p.acts) && p.acts.length, `${w.id} 觸發沒有動作`);
      p.acts.forEach((a) => {
        assert.ok(c.RW_ACTS.includes(a.act), `${w.id} 未知動作 ${a.act}`);
        if (a.act === 'dmg') assert.ok(a.pct > 0, `${w.id} dmg 缺 pct`);
        if (a.act === 'buff') assert.ok(a.sid && a.val && a.sec, `${w.id} buff 欄位不全`);
        if (a.sid) assert.ok(c.statusDef(a.sid), `${w.id} 狀態 ${a.sid} 不在狀態表`);
        (a.from || []).forEach((o) => assert.ok(c.statusDef(o.sid), `${w.id} 隨機增益 ${o.sid} 不在狀態表`));
      });
      if (p.on === 'cast') assert.ok(true);
    });
  });
});

test('每一組符文之語在遊戲裡都做得出來：存在稀有度的鑲孔數足夠（雙手武器 ×1.75）', () => {
  WORDS.forEach((w) => {
    const n = w.runes.length;
    const twoHandOnly = w.bases.every((b) => b === 'twoHand' || ['greatsword2h', 'axe2h', 'staff2h', 'magicSword2h'].includes(b));
    const max = Math.max(...c.RARITIES.map((r) => twoHandOnly ? Math.floor(r.sockets * c.TWO_HAND_SOCKET_MULT) : r.sockets));
    assert.ok(max >= n, `${w.id} 需要 ${n} 孔，最高稀有度也只有 ${max} 孔`);
  });
});

test('配方的說明文字能由資料產生，不含 undefined', () => {
  WORDS.forEach((w) => {
    const lines = c.rwDescribeLines(w);
    assert.ok(lines.length >= 1, w.id + ' 沒有任何說明');
    lines.concat([c.rwRecipeText(w), c.rwBasesText(w)]).forEach((l) => assert.doesNotMatch(l, /undefined|NaN/, w.id + '：' + l));
  });
});
