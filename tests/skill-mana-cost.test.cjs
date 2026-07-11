const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadGameContext() {
  const root = path.resolve(__dirname, '..');
  const context = {
    console,
    Math: Object.create(Math),
    document: { addEventListener() {} },
    UI: { dirty: {} },
    blog() {},
    floatText() {}
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/skills.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.G = {
    player: { level: 1, skills: {}, fusions: [] },
    stage: { current: 1 }
  };
  return context;
}

test('一般技能法力消耗按原始值每級增加 10%', () => {
  const context = loadGameContext();
  const skill = { cat: 'magic', cost: 50 };
  assert.equal(context.skillManaCost(skill, 1), 50);
  assert.equal(context.skillManaCost(skill, 2), 55);
  assert.equal(context.skillManaCost(skill, 3), 60);
});

test('融合技能法力消耗為素材原始消耗總和，並按融合技能等級增加 10%', () => {
  const context = loadGameContext();
  const fusion = { cat: 'fusion', cost: 999, components: ['powerSlash', 'fireball'] };
  assert.equal(context.skillBaseManaCost(fusion), 40);
  assert.equal(context.skillManaCost(fusion, 1), 40);
  assert.equal(context.skillManaCost(fusion, 2), 44);
});
