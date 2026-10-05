'use strict';

/* 敵人身上的傷害數字前面不放圖示（2026-10-05 使用者要求：「把傷害數字前面的技能圖刪掉」）。

   原本 Worker 組字時會在數字前加 emoji：技能命中是該技能的圖（g.emoji）、衍生傷害是
   💥💀🧊☄️⚡🌍✨、潛力技是 def.emoji、傳奇詞條是 ✦／⚡。現在飄字只剩「（爆擊／格擋／反擊／必殺）＋數字」。
   這個前綴同時是傷害數字合併分級的合併鍵（ui.js uiFloatMergeParts），所以也不能混進圖示：
   不同技能的圖示不同，會讓同一目標的命中湊不成一組。

   保留的：我方頭頂「技能名稱＋總傷害」（floatPlayerSkillCast）——圖在技能名稱前，不是傷害數字前。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function setup() {
  const floats = [];
  const c = vm.createContext({
    console, Math: Object.create(Math), UI: { dirty: {} },
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    setTimeout() {}, clearTimeout() {}, blog() {}, trackDps() {}, recordRunDamage() {},
    floatText(elId, text, cls, damageValue) { floats.push({ elId, text, cls, damageValue }); }
  });
  c.window = c;
  for (const f of ['util', 'data', 'status', 'formula', 'battlefield', 'combat', 'skills', 'skills2', 'legendary']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'), c, { filename: f });
  }
  c.G = { player: { skills2: { levels: {} }, loadout: [] }, stage: { current: 1 } };
  c.GT = 0; c.Math.random = () => 0.5;
  const st = { hp: 100000, mp: 100000, hpRegen: 0, mpRegen: 50, lifesteal: 0, manaSteal: 0,
    atk: 100, matk: 100, level: 1, aspd: 1, hit: 100, critRate: 0, critDmg: 150,
    passives: {}, elemDmgUp: {}, elemAtk: null, elemDmgPct: 0, globalDmgRed: 0, shieldEff: 0 };
  c.getStats = () => st;
  const p = { hp: 1000, mp: 0, shield: 0, buffs: {}, effects: {}, dots: [], skillCds: {} };
  c.FIELD.player = p;
  return { c, p, st, floats };
}
const enemy = (hp = 1e9) => ({
  hp, maxHp: hp, def: 0, mdef: 0, level: 1, effects: {}, buffs: {}, dots: [], resist: {}, ctrlRes: 0
});

/* 文字以符號／表情開頭（排除 CJK 與 ASCII）：箭頭、雜項符號、Dingbats、補充符號與表情的代理對 */
const LEADING_ICON = /^[←-⯿️‍]|^[\uD800-\uDBFF]/;

test('FI-1 技能命中的傷害數字前沒有該技能的圖（每個技能群組都檢查）', () => {
  const { c, p, st, floats } = setup();
  const gids = Object.keys(c.SKILLS2);
  assert.ok(gids.length >= 20, '有一批技能可檢查');
  for (const gid of gids) {
    const g = c.SKILLS2[gid];
    floats.length = 0;
    const res = c.sgHitOne(p, st, enemy(), 100, gid, 'mv-float', { dmg: 0 });
    assert.ok(res && !res.miss, gid + ' 要打得中');
    assert.equal(floats.length >= 1, true, gid + ' 要有飄字');
    const f = floats[0];
    assert.equal(f.text, c.fmt(f.damageValue), gid + ' 的飄字只有數字：' + JSON.stringify(f.text));
    assert.ok(!f.text.includes(g.emoji), gid + ' 的圖示不在數字前');
    assert.ok(!LEADING_ICON.test(f.text), gid + ' 沒有任何前導圖示');
  }
});

test('FI-2 暴擊與格擋只有文字前綴，沒有圖示', () => {
  const { c, p, st, floats } = setup();
  st.critRate = 100;
  c.sgHitOne(p, st, enemy(), 100, 'cleave', 'mv-float', { dmg: 0 });
  assert.match(floats[0].text, /^爆擊 \S+$/);
  assert.match(floats[0].cls, /\bcrit\b/);

  floats.length = 0;
  const realResolve = c.resolveHit;
  c.resolveHit = function () { const r = realResolve.apply(this, arguments); r.blocked = true; return r; };
  c.sgHitOne(p, st, enemy(), 100, 'cleave', 'mv-float', { dmg: 0 });
  assert.match(floats[0].text, /^格擋 爆擊 \S+$/);
});

test('FI-3 衍生傷害（擴散、爆炸、斬殺…）不論傳什麼標記，飄字都只有數字', () => {
  const { c, floats } = setup();
  for (const label of ['💥', '💀', '🧊', '☄️', '⚡', c.SKILLS2.thrust.emoji, c.SKILLS2.fireball.emoji, '']) {
    floats.length = 0;
    const dealt = c.sgDerivedHit(enemy(), 1234, 'thrust', 'mv-float', { dmg: 0 }, label, 0);
    assert.ok(dealt > 0);
    assert.equal(floats.length, 1);
    assert.equal(floats[0].text, c.fmt(dealt), '標記 ' + JSON.stringify(label) + ' 不上飄字');
    assert.equal(floats[0].damageValue, dealt);
  }
});

test('FI-4 衍生傷害的統計子類型不受影響：沒給 subType 時仍退回技能名稱', () => {
  const { c } = setup();
  const seen = [];
  c.recordRunDamage = (name, dmg, key, lv, sub) => seen.push(sub);
  c.sgDerivedHit(enemy(), 500, 'thrust', 'mv-float', { dmg: 0 }, '💀', 0);
  c.sgDerivedHit(enemy(), 500, 'thrust', 'mv-float', { dmg: 0 }, '💀', 0, '指定子類型');
  assert.deepEqual(seen, [c.SKILLS2.thrust.name, '指定子類型']);
});

test('FI-5 傳奇詞條的元素傷害不再帶 ✦', () => {
  const { c, p, floats } = setup();
  const res = c.legendaryDealDamage(p, enemy(), 100, 'phys', 'fire', 'mv-float', '測試');
  assert.ok(res && !res.miss);
  assert.equal(floats.length, 1);
  assert.equal(floats[0].text, c.fmt(floats[0].damageValue));
});

/* ---------- 掃原始碼：所有 floatEnemyEvent 呼叫的「文字」參數 ---------- */

function callArgs(source, openParen) {
  const args = [];
  let depth = 0, quote = '', cur = '';
  for (let i = openParen + 1; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      cur += ch;
      if (ch === '\\') { cur += source[++i]; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) { args.push(cur.trim()); return args; }
      depth--;
    }
    if (ch === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  throw new Error('unterminated call');
}

const SCAN_FILES = ['js/skills2.js', 'js/potential.js', 'js/legendary.js', 'js/combat.js'];

test('FI-6 原始碼掃描：沒有任何一個 floatEnemyEvent 的文字參數以圖示開頭或帶入 emoji', () => {
  let calls = 0;
  for (const file of SCAN_FILES) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const re = /floatEnemyEvent\(/g;
    let m;
    while ((m = re.exec(source))) {
      const before = source.slice(Math.max(0, m.index - 9), m.index);
      if (/function\s$/.test(before)) continue;              // 定義本身不算
      const args = callArgs(source, m.index + m[0].length - 1);
      const text = args[2] || '';
      const where = file + ':' + source.slice(0, m.index).split('\n').length + ' → ' + text;
      calls++;
      assert.ok(!/^['"`]\s*[←-⯿️‍\uD800-\uDBFF]/.test(text), '字串開頭是圖示：' + where);
      assert.ok(!/\bemoji\b/.test(text), '引用了 emoji：' + where);
      assert.ok(!/^label\b/.test(text), '帶入了 label：' + where);
    }
  }
  assert.ok(calls >= 15, '掃到的呼叫數太少（' + calls + '），解析可能壞了');
});

test('FI-7 我方頭頂「技能名稱＋總傷害」的圖示維持原樣（圖在名稱前，不是傷害數字前）', () => {
  const util = fs.readFileSync(path.join(root, 'js', 'util.js'), 'utf8');
  assert.match(util, /var text = \(skill\.emoji \|\| '✨'\) \+ \(skill\.name \|\| ''\);/);
});
