/* 新版戰鬥 P3：連鎖的空間化（bfChainOrder／bfChainNext，js/battlefield.js）
   連鎖對象在剩下的存活敵人之間隨機擴散，不重複、不原地打同一隻。
   舊版領域圓、領域受傷增幅、DoT 濺射與印記轉移（skillRt* 45 機制族）已於 2026-09-29 隨舊技能系統移除，
   對應測試一併刪除。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadGameContext() {
  const context = {
    console,
    Math: Object.create(Math),
    setTimeout() {},
    clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    UI: { dirty: {} },
    RUN_STATS: { skills: {} },
    blog() {},
    floatText() {},
    trackDps() {},
    recordRunDamage() {}
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js', 'js/skills.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.G = {
    player: { level: 1, reincarnations: 0, talents: { levels: {}, potentialLevels: {} }, loadout: [] },
    stage: { current: 1 },
    tower: { active: false }
  };
  context.getStats = () => ({
    cdr: 0, castSpeed: 0, hp: 1000, mp: 1000, atk: 100, matk: 100,
    aoeDmg: 0, critRate: 0, critDmg: 150, pPen: 0, mPen: 0, hit: 100, level: 1,
    passives: {}, lifesteal: 0, manaSteal: 0, shieldEff: 0, skillTriggers: {}
  });
  return context;
}

/* 座標制（2026-08-12）：敵人帶 pos={x,y}，我方在原點。
   原本的 (col,row) 參數保留成「大致方位」，換算成座標即可，測試語意不變。 */
function enemy(x, y, extra) {
  return Object.assign({
    hp: 100000, maxHp: 100000, def: 0, mdef: 0, dodge: 0, resist: {}, ctrlRes: 0,
    elite: false, isBoss: false, buffs: {}, dots: [], effects: {}, shield: 0,
    pos: { x: x, y: y }
  }, extra || {});
}

test('連鎖隨機擴散：第一跳打主目標，之後在剩下的敵人之間隨機挑', () => {
  const c = loadGameContext();
  const a = enemy(100, 0);   // 主目標（離我方最近）
  const b = enemy(180, 0);   // 就在 a 旁邊
  const far = enemy(700, 0); // 最遠
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const order = c.bfChainOrder(a, [a, b, far], 3);
    assert.equal(order.length, 3);
    assert.equal(order[0], a, '第一跳打主目標');
    assert.equal(new Set(order).size, 3, '同一輪內不得重複跳同一隻');
    seen.add(order[1]);
  }
  assert.equal(seen.size, 2, '最遠的敵人也要有機會被跳到（不是固定跳最近的）');
});

test('連鎖的下一跳一定往外跳，不會停在原地', () => {
  const c = loadGameContext();
  const a = enemy(100, 0);
  const b = enemy(180, 0);
  assert.equal(c.bfChainNext(a, [a, b]), b, '有其他敵人時必須跳走');
  assert.equal(c.bfChainNext(a, [a]), a, '場上只剩自己時仍打自己（維持打滿次數）');
  assert.equal(c.bfChainNext(null, [b, a]), a, '沒有起點時從離我方最近的開始（起手不是彈射）');
});

test('場上只有一個敵人時連鎖仍打滿次數（與改造前行為一致）', () => {
  const c = loadGameContext();
  const only = enemy(2, 2);
  const order = c.bfChainOrder(only, [only], 4);
  assert.equal(order.length, 4);
  order.forEach((e) => assert.equal(e, only));
});
