'use strict';
/* 符文真言測試共用環境：以 Worker 的載入順序把模擬層全部載進同一個 vm 上下文，
   再建立一份全新的遊戲狀態 G。測試可直接呼叫 computeStats／rwActiveWord／socketRune／doPlayerAttack…。 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const SIM_FILES = [
  'util.js', 'data.js', 'runeword_data.js', 'status.js', 'formula.js', 'battlefield.js', 'stats.js',
  'item.js', 'runeword.js', 'skills.js', 'skills2.js', 'talents.js', 'player.js', 'special_rules.js',
  'combat.js', 'legendary.js', 'potential.js', 'tower.js', 'factory.js', 'newforge.js', 'forge.js', 'save.js', 'tasks.js'
];

function loadRuneEnv(opts) {
  opts = opts || {};
  const logs = [];
  const context = {
    console,
    Math: Object.create(Math),            // 讓測試可以改 context.Math.random 來固定擲骰
    setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    UI: { dirty: {} },
    RUN_STATS: { skills: {} },
    blog(msg) { logs.push(String(msg)); },
    flog(msg) { logs.push(String(msg)); },
    floatText() {}, trackDps() {}, recordRunDamage() {},
    GT: 0
  };
  context.logs = logs;
  context.window = context;
  vm.createContext(context);
  (opts.files || SIM_FILES).forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, 'js', file), 'utf8'), context, { filename: 'js/' + file });
  });
  if (!opts.noState) {
    vm.runInContext('G = newGameState(); markStatsDirty();', context);
  }
  return context;
}

/* 建立一件可鑲嵌的測試裝備；rarity 預設 5（傳說，4 個符文孔）。 */
function makeItem(c, over) {
  const it = Object.assign({
    id: 'it-' + Math.random().toString(36).slice(2), name: '測試裝備', rarity: 5, slot: 'weapon',
    weaponType: 'sword1h', level: 100, upgrade: 0, locked: false, affixes: [], sockets: [], enchants: [], runes: []
  }, over || {});
  c.ensureSockets(it);
  return it;
}

/* 把指定符文依序塞進裝備的符文孔（直接寫入，不經庫存）。 */
function fillRunes(it, runes, start) {
  const s = start || 0;
  if (!Array.isArray(it.runes)) it.runes = [];
  while (it.runes.length < s + runes.length) it.runes.push(null);
  runes.forEach((id, i) => { it.runes[s + i] = id; });
  return it;
}

module.exports = { loadRuneEnv, makeItem, fillRunes, root, SIM_FILES };

/* 為指定符文真言建一件「剛好能成形」的裝備：挑 bases 裡第一個可行的裝備型態（預設傳說，符文孔足夠）。 */
function wordItem(c, id, over) {
  const w = c.RUNEWORD_BY_ID[id];
  const base = { slot: 'weapon', weaponType: 'sword1h', rarity: 5, level: 100 };
  const b = w.bases[0];
  if (['chest', 'helmet', 'boots', 'shoulder', 'belt', 'gloves', 'legs', 'wrist', 'ring', 'amulet'].includes(b)) { base.slot = b; delete base.weaponType; }
  if (b === 'jewelry') { base.slot = 'ring'; delete base.weaponType; }
  if (b === 'armor') { base.slot = 'chest'; delete base.weaponType; }
  if (b === 'caster') base.weaponType = 'wand1h';
  if (b === 'twoHand') base.weaponType = 'axe2h';
  if (['shield', 'focus', 'orb', 'spellbook', 'dagger1h', 'staff2h', 'greatsword2h', 'magicSword1h'].includes(b)) base.weaponType = b;
  const it = makeItem(c, Object.assign(base, over || {}));
  fillRunes(it, w.runes);
  return it;
}
/* 這件裝備該放進哪個裝備欄（副手類型走 weapon2）。 */
function slotFor(c, it) {
  if (it.slot !== 'weapon') return it.slot;
  const wd = c.weaponDef(it);
  return wd && wd.cat === 'offHand' ? 'weapon2' : 'weapon';
}
module.exports.wordItem = wordItem;
module.exports.slotFor = slotFor;
