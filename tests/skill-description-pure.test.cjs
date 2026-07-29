const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

/* describeSkill 必須能在「沒有 G」的環境執行（Worker 架構下的主執行緒就是這樣）。

   它一旦讀不到就用不了，而用不了的後果已經發生過：ui.js 的 skillViewDescription
   改用 `def.flavor || def.desc` 一行風味文字充當技能說明，於是**所有技能**的傷害數值、
   成長與「下一級」全部消失。真正需要 G 的只有融合技（靜態 SKILLS 表查不到的那種），
   而融合技記錄本來就在技能面板快照裡，傳進來即可。 */
function loadSkillContext() {
  const context = { console, UI: { dirty: {} } };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/battlefield.js', 'js/stats.js', 'js/item.js', 'js/skills.js']
    .forEach((file) => {
      vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
    });
  // 刻意不定義 G：讀到就是 ReferenceError，測試會直接失敗
  return context;
}

test('沒有 G 也能產生一般技能的完整說明', () => {
  const c = loadSkillContext();
  const ids = Object.keys(c.SKILLS);
  assert.ok(ids.length > 0);

  let described = 0;
  ids.forEach((id) => {
    const text = c.describeSkill(id, 1);
    assert.equal(typeof text, 'string', `${id} 應回傳字串`);
    if (text) described++;
  });
  assert.ok(described > ids.length * 0.9,
    `至少九成技能要有說明，實際 ${described}/${ids.length}`);
});

test('說明含實際數值，且會隨等級變動——不是固定的風味文字', () => {
  const c = loadSkillContext();
  const id = Object.keys(c.SKILLS).find((k) => c.SKILLS[k].name === '強力斬') ||
    Object.keys(c.SKILLS)[0];
  const def = c.SKILLS[id];
  const lv1 = c.describeSkill(id, 1);
  const lv2 = c.describeSkill(id, 2);

  assert.match(lv1, /\d/, '說明必須含數值');
  assert.notEqual(lv1, def.flavor,
    '回傳風味文字代表又退回簡化版，玩家看不到傷害數值');
  assert.notEqual(lv1, lv2,
    '不同等級的說明必須不同，否則「下一級」提示等於沒說');
});

test('融合技的定義可由參數傳入，不必存在 G', () => {
  const c = loadSkillContext();
  // 不傳 fusions 且沒有 G：查不到定義，回 null／空字串，不得拋 ReferenceError
  assert.equal(c.skillDef('fusion-test'), null);
  assert.equal(c.describeSkill('fusion-test', 1), '');

  /* 傳入既有記錄即可解析。這裡用「已預先組好 fx 的記錄」（沒有 components／
     componentLevels），resolveFusionRecord 會直接沿用，不必重建執行期定義——
     本測試要驗的是查表來源，不是融合技的組裝規則。 */
  const record = {
    id: 'fusion-test', name: '測試融合技', emoji: '🧬',
    cost: 10, cd: 5, maxLv: 10, flavor: '測試用',
    fx: { dmgType: 'phys', stat: 'atk', base: 100, per: 10, hits: 1 }
  };
  const def = c.skillDef('fusion-test', [record]);
  assert.ok(def, 'skillDef 應能從傳入的 fusions 解析出定義');
  assert.equal(def.name, '測試融合技');

  const text = c.describeSkill('fusion-test', 1, false, [record]);
  assert.equal(typeof text, 'string');
  assert.match(text, /\d/, '融合技說明同樣要含數值');
});

test('ui.js 的技能說明改用 describeSkill，不再回退成風味文字', () => {
  const uiSrc = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const fn = uiSrc.slice(uiSrc.indexOf('function skillViewDescription'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /describeSkill\s*\(\s*id\s*,/,
    'skillViewDescription 應呼叫 describeSkill');

  /* 兩個呼叫端都要把快照的 fusions 傳進來，否則融合技又會查不到定義。
     用切割而非正規表示式比對參數列：呼叫跨行且含巢狀括號，非貪婪比對會在第一個
     右括號就停住，把 fusions 切掉而誤判。 */
  const parts = uiSrc.split(/skillViewDescription\s*\(/).slice(1);
  const signature = parts.shift(); // 第一個出現處是函式定義本身
  assert.match(signature.slice(0, signature.indexOf(')')), /fusions/,
    '函式簽章應有 fusions 參數');
  assert.equal(parts.length, 2, '應有兩個呼叫端（技能面板與 tooltip）');
  parts.forEach((chunk, i) => {
    const call = chunk.slice(0, chunk.indexOf(';'));
    assert.match(call, /fusions/, `第 ${i + 1} 個呼叫端必須傳入 skillsSnapshot.fusions`);
  });
});
