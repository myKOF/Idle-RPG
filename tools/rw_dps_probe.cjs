#!/usr/bin/env node
'use strict';
/* 符文之語「武器類」的邊際輸出探針（平衡校準用，不是測試）。

     node tools/rw_dps_probe.cjs [稀有度索引=5] [模擬秒數=120] [種子數=3]

   做法：整套裝備用固定種子產生的同稀有度、100 級隨機詞條裝備當基準（等於「一般玩家的整身裝備」），
   比較「同一把武器」鑲上符文之語前後的普攻輸出（含擴散、命中／暴擊觸發、週期觸發、各種乘區），
   對 4 隻高血量木樁計總傷害。輸出每組的倍率 ＝ 鑲上後 ÷ 鑲上前，按級距排序。

   ⚠️ 只量「普攻＋符文之語自己的傷害」：技能沒有裝配，所以依賴技能的機制（武庫的免費施放、時之沙的重施放、
   借用的傳奇特效、冷卻縮減）在這裡被低估；防具／飾品類的生存向符文之語完全不在量測範圍。
   四隻木樁會放大範圍類（擴散、全體觸發）；木樁血量恆在 70% 以上，所以「對高血敵人增傷」恆成立、
   「只有一隻敵人」增傷恆不成立。因此倍率只適合拿來比較「同級距內有沒有離群」，不是真實的戰力倍數。

   本檔載入的是 tests/helpers 的完整模擬層環境（與測試共用），不碰任何存檔。 */
const path = require('node:path');
const { loadRuneEnv, wordItem, fillRunes } = require(path.join(__dirname, '..', 'tests', 'helpers', 'runeword-env.cjs'));

const RAR = Number(process.argv[2] || 5);
const SECONDS = Number(process.argv[3] || 120);
const SEEDS = Array.from({ length: Number(process.argv[4] || 3) }, (_, i) => i + 1);
const WEAPON_BASES = ['mainHand', 'twoHand', 'caster', 'oneHand', 'melee', 'sword1h', 'dagger1h', 'magicSword1h', 'staff2h', 'greatsword2h', 'axe2h'];

function foe() {
  return { name: '木樁', hp: 1e15, maxHp: 1e15, atk: 1, def: 300, mdef: 300, level: 100, dodge: 0, resist: {}, buffs: {}, effects: {},
    dots: [], ctrlRes: 0, shield: 0, atkCd: 99, elite: false };
}
function seeded(c, seed) {
  let s = seed;
  c.Math.random = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}
function build(c, seed, wordId, weaponType) {
  seeded(c, seed);
  ['helmet', 'shoulder', 'chest', 'belt', 'gloves', 'wrist', 'legs', 'boots', 'ring', 'amulet'].forEach((s) => {
    c.G.equipment[s] = c.makeEquipment(100, { slot: s, rarity: RAR, level: 100 });
  });
  c.G.equipment.ring2 = c.makeEquipment(100, { slot: 'ring', rarity: RAR, level: 100 });
  const weapon = c.makeEquipment(100, { slot: 'weapon', rarity: RAR, level: 100, weaponType: weaponType });
  c.ensureSockets(weapon);
  if (wordId) {
    const w = c.RUNEWORD_BY_ID[wordId];
    while (weapon.sockets.length < w.runes.length) weapon.sockets.push(null);   // 孔數不夠就補（只看效果強度，不看取得難度）
    fillRunes(weapon, w.runes);
  }
  c.G.equipment.weapon = weapon;
  c.G.player.level = 100;
  c.markStatsDirty();
}
function measure(c) {
  const st = c.getStats();
  const foes = [foe(), foe(), foe(), foe()];
  c.FIELD.monsters = foes; c.FIELD.monster = foes[0];
  const p = c.FIELD.player = c.newPlayerEntity(st);
  seeded(c, 777);
  c.GT = 0; c.rwResetRT();
  const ctx = { pEnt: p, getEnemies: () => foes, floatSel: 'mv-float', onDeaths() {} };
  const total0 = foes.reduce((s, f) => s + f.hp, 0);
  const dt = 0.1;
  let atkCd = 0;
  p.hp = st.hp;
  for (let t = 0; t < SECONDS / dt; t++) {
    c.GT += dt;
    atkCd -= dt * c.playerBasicAttackRate(p, st);
    if (atkCd <= 0) { c.doPlayerAttack(p, foes[0], 'mv-float', 0); atkCd += 1 / st.aspd; }
    c.tickStatuses(foes[0], dt, { enemies: foes, floatSel: 'mv-float', out: { killed: false, dmg: 0, crit: false } });
    c.rwTick(dt, ctx);
    p.hp = Math.max(p.hp, 1);
  }
  return (total0 - foes.reduce((s, f) => s + f.hp, 0)) / SECONDS;
}

const probe = loadRuneEnv({ noState: true });
const rows = [];
probe.RUNEWORDS.forEach((w) => {
  if (!w.bases.some((b) => WEAPON_BASES.includes(b))) return;
  const weaponType = wordItem(loadRuneEnv(), w.id).weaponType;
  let sum = 0;
  SEEDS.forEach((seed) => {
    const a = loadRuneEnv(); build(a, seed, null, weaponType);
    const b = loadRuneEnv(); build(b, seed, w.id, weaponType);
    sum += measure(b) / measure(a);
  });
  rows.push({ tier: w.tier, name: w.name, weaponType, mult: sum / SEEDS.length });
});
rows.sort((x, y) => x.tier - y.tier || x.mult - y.mult);
console.log(`稀有度 ${RAR}（${probe.RARITIES[RAR].name}）｜${SECONDS} 秒｜${SEEDS.length} 組種子｜4 隻木樁`);
rows.forEach((r) => console.log(`第${r.tier}級 ${r.name.padEnd(6, '　')} ${r.weaponType.padEnd(13)} ×${r.mult.toFixed(2)}`));
