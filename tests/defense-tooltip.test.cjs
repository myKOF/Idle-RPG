const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext() {
  const context = { console, Math: Object.create(Math) };
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

function statRow(context, labelText) {
  const defense = context.STAT_GROUPS.find((group) => group.title === '防禦屬性');
  assert.ok(defense);
  return defense.rows.find((row) => row[0].includes(labelText));
}

/* 期望值一律由遊戲自己的 defReduction() 算出來，不在測試裡寫死百分比。

   寫死的話，防禦減傷曲線的係數（參數表「3-戰鬥核心／防禦減傷率」）一被調整，
   這裡就會紅——但紅的不是 bug，只是數值換了。實際發生過：2026-08-02 的參數套用把
   常數從 60 改成 10000，這兩個測試立刻失敗，而 tooltip 其實運作正常。

   要驗的是「tooltip 顯示的就是遊戲算出來的那個數，而且截斷到小數四位」，
   不是「那個數等於某個特定百分比」。 */
function expectedPct(context, def, level) {
  const pct = context.defReduction(def, level) * 100;
  /* 與 js/data.js 的 pctStrFloor4 同樣是截斷（不是四捨五入），見下一個測試。 */
  return (Math.floor(pct * 10000) / 10000).toFixed(4);
}

test('物理與魔法防禦 tooltip 底部以黃色顯示目前同級減傷率', () => {
  const context = loadContext();
  const st = {
    level: 10,
    def: 1000,
    mdef: 500,
    base: { def: 100, mdef: 50 },
    A: { defFlat: 0, mdefFlat: 0, defPct: 0 }
  };

  const physicalHtml = statRow(context, '物理防禦')[2](st);
  const magicHtml = statRow(context, '魔法防禦')[2](st);

  assert.match(physicalHtml, /color:#ffd700/);
  assert.ok(physicalHtml.includes('目前同級減傷率：' + expectedPct(context, st.def, st.level) + '%'),
    '物理防禦 tooltip 應顯示 defReduction() 算出的減傷率，實際：' + physicalHtml);
  assert.match(magicHtml, /color:#ffd700/);
  assert.ok(magicHtml.includes('目前同級減傷率：' + expectedPct(context, st.mdef, st.level) + '%'),
    '魔法防禦 tooltip 應顯示 defReduction() 算出的減傷率，實際：' + magicHtml);

  /* 防禦愈高減傷愈多，是這條曲線的定性性質；係數怎麼調都必須成立。 */
  assert.ok(context.defReduction(st.def, st.level) > context.defReduction(st.mdef, st.level),
    '防禦較高的一方減傷率應較高');
});

test('防禦 tooltip 減傷率截斷到小數四位且不會進位成 100%', () => {
  /* 防禦極高時減傷率無限逼近但永遠到不了 100%。若顯示層用四捨五入，
     99.99996% 會被寫成 100.0000%，玩家會以為自己免疫——必須截斷。

     ⚠️ 這裡不寫死 99.9995%。防禦值反而要**由曲線反推**：給定係數，
     算出「減傷率剛好落在 99.999x% 區間」需要多少防禦。這樣係數怎麼調，
     這個測試測到的都還是同一件事（截斷 vs 進位）。 */
  const context = loadContext();
  const level = 1174;
  /* defReduction = def / (def + K)，要讓它 ≥ target 需 def ≥ K × target / (1 - target)。
     K 由遊戲自己給：把 def 設成 1 反推分母。 */
  const r1 = context.defReduction(1, level);          // 1 / (1 + K)
  const K = (1 - r1) / r1;                            // ⇒ K
  const target = 0.9999951;                           // 落在會被四捨五入成 100% 的區間
  const def = Math.ceil(K * target / (1 - target));

  const st = {
    level: level, def: def, mdef: def,
    base: { def: def, mdef: def },
    A: { defFlat: 0, mdefFlat: 0, defPct: 0 }
  };
  const physicalHtml = statRow(context, '物理防禦')[2](st);

  const pct = context.defReduction(def, level) * 100;
  assert.ok(pct > 99.9995 && pct < 100, '前提沒建立：減傷率應落在 99.9995%~100% 之間，實際 ' + pct);
  assert.ok(physicalHtml.includes('目前同級減傷率：' + (Math.floor(pct * 10000) / 10000).toFixed(4) + '%'),
    'tooltip 應顯示截斷後的值，實際：' + physicalHtml);
  assert.doesNotMatch(physicalHtml, /目前同級減傷率：100(?:\.0000)?%/);
});
