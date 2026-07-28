const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
const targets = {
  currentZoneDef: 'js/data.js',
  reincarnationCount: 'js/formula.js',
  itemDetailHTML: 'js/item.js',
  skillLevel: 'js/skills.js',
  skillDef: 'js/skills.js',
  reincarnationCountSafe: 'js/talents.js',
  equipTargetSlot: 'js/player.js'
};

function functionBody(source, name) {
  const marker = 'function ' + name + '(';
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, '找不到 ' + name + ' 定義');
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error('無法解析 ' + name + ' 函式體');
}

test('Worker UI 不直接依賴內部讀 G 的模擬層顯示查詢', () => {
  const report = [];
  for (const [name, file] of Object.entries(targets)) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const hasG = /\bG\s*\./.test(functionBody(source, name));
    const directCall = new RegExp('(?<![\\w.])' + name + '\\s*\\(').test(ui);
    report.push(`${name}: bodyG=${hasG ? 1 : 0}, uiDirectCall=${directCall ? 1 : 0}`);
    assert.equal(directCall, false, `${name} 不得由 ui.js 直接呼叫`);
  }
  for (const name of ['restartGame', 'createManualSaveToFolderV2']) {
    const directCall = new RegExp('(?<![\\w.])' + name + '\\s*\\(').test(ui);
    report.push(`${name}: uiDirectCall=${directCall ? 1 : 0}`);
    assert.equal(directCall, false, `${name} 必須改走 Worker Command`);
  }
  console.log(report.join('\n'));
});
