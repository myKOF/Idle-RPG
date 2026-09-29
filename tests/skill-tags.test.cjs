const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext() {
  const context = {
    console,
    Math: Object.create(Math),
    document: {
      getElementById() { return null; },
      querySelectorAll() { return []; },
      addEventListener() {}
    },
    UI: { dirty: {} }
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/skills.js', 'js/talents.js', 'js/ui.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.G = {
    player: {
      level: 1,
      reincarnations: 0,
      skills: {},
      talents: { levels: {}, potentialLevels: {} },
      loadout: []
    }
  };
  return context;
}

// 舊技能表（SKILLS）已移除：技能標籤產生器 skillTagsHTML 現在只服務潛力技能
// （POTENTIAL_TALENTS；新版技能群組走 renderSkill2Modal 自己的版面，不用這組標籤）。
function potentialById(c, id) {
  const def = c.POTENTIAL_TALENTS.find((d) => d.id === id);
  assert.ok(def, `找不到潛力技能 ${id}`);
  return def;
}

test('技能標籤會顯示技能類別與元素系別', () => {
  const c = loadContext();
  const tags = c.skillTagsHTML('sacredInversion', potentialById(c, 'sacredInversion'), 1);

  assert.match(tags, />潛力<\/span>/);
  // §3.5 技能詳情顯示元素圖示＋系別：徽章文字＝emoji＋「X系」
  assert.match(tags, /skill-tag-light[^>]*>✨聖系<\/span>/);
  assert.doesNotMatch(tags, /【|】/);
  assert.doesNotMatch(tags, />物理<\/span>/);
});

test('Skills 表標籤（tags）決定元素系別徽章', () => {
  const c = loadContext();
  const lightningTags = c.skillTagsHTML('lightningOverdrive', potentialById(c, 'lightningOverdrive'), 1);

  assert.match(lightningTags, /skill-tag-lightning[^>]*>⚡雷系<\/span>/);
  // 標籤欄支援字串（以分號分隔）與陣列兩種形式
  const multi = c.skillTagsHTML('x', { tags: 'fire;poison' }, 1);
  assert.match(multi, /skill-tag-fire[^>]*>[^<]*火系<\/span>/);
  assert.match(multi, /skill-tag-poison[^>]*>☠️毒系<\/span>/);
});

test('沒有元素的技能仍會顯示類別標籤', () => {
  const c = loadContext();
  const tags = c.skillTagsHTML('velocityForce', potentialById(c, 'velocityForce'), 1);

  assert.match(tags, />潛力<\/span>/);
  assert.doesNotMatch(tags, /【|】|聖系|火系|冰系|雷系|毒系|暗系/);
});

test('技能升級視窗與技能 Tooltip 都接上標籤產生器', () => {
  const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
  assert.match(ui, /h \+= skillTagsHTML\(id, sk, Math\.max\(1, lv\)\);/);
  assert.match(ui, /h \+= skillTagsHTML\(id, sk, lv\);/);
  assert.match(css, /\.skill-tag-light\s*\{/);
  assert.match(css, /\.skill-tag-fire\s*\{/);
});

test('Skills 配置表包含可編輯標籤欄與六系定義', () => {
  const config = fs.readFileSync(path.join(root, 'tools', 'config_tables.cjs'), 'utf8');
  const csv = fs.readFileSync(path.join(root, 'config', 'CSV', 'Skills.csv'), 'utf8');
  assert.match(config, /'標籤'/);
  assert.match(config, /fire＝火系/);
  assert.match(config, /poison＝毒系/);
  assert.match(config, /light＝聖系/);
  assert.match(csv.split(/\r?\n/, 1)[0], /標籤/);
});
