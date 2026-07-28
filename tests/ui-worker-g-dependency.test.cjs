const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const uiSource = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
const simulationFiles = [
  'util.js', 'data.js', 'formula.js', 'stats.js', 'item.js', 'skills.js',
  'talents.js', 'player.js', 'special_rules.js', 'combat.js', 'legendary.js',
  'potential.js', 'tower.js', 'factory.js', 'newforge.js', 'forge.js', 'save.js'
];

function codeMask(source) {
  const chars = source.split('');
  let state = 'code';
  let escaped = false;
  let regexCharClass = false;
  function canStartRegex(at) {
    let i = at - 1;
    while (i >= 0 && /\s/.test(source[i])) i--;
    if (i < 0 || /[([{=:;,!?&|+\-*%^~<>]/.test(source[i])) return true;
    if (!/[A-Za-z_$]/.test(source[i])) return false;
    const end = i + 1;
    while (i >= 0 && /[\w$]/.test(source[i])) i--;
    return /^(?:return|case|throw|else|do|typeof|instanceof|in|of|yield|await)$/
      .test(source.slice(i + 1, end));
  }
  for (let i = 0; i < chars.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (state === 'line-comment') {
      if (char === '\n') state = 'code';
      else chars[i] = ' ';
      continue;
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        chars[i] = chars[i + 1] = ' ';
        i++;
        state = 'code';
      } else if (char !== '\n') chars[i] = ' ';
      continue;
    }
    if (state !== 'code') {
      if (state === 'regex') {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '[') regexCharClass = true;
        else if (char === ']') regexCharClass = false;
        else if (char === '/' && !regexCharClass) state = 'code';
      } else if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if ((state === 'single' && char === "'") ||
        (state === 'double' && char === '"') ||
        (state === 'template' && char === '`')) state = 'code';
      if (char !== '\n') chars[i] = ' ';
      continue;
    }
    if (char === '/' && next === '/') {
      chars[i] = chars[i + 1] = ' ';
      i++;
      state = 'line-comment';
    } else if (char === '/' && next === '*') {
      chars[i] = chars[i + 1] = ' ';
      i++;
      state = 'block-comment';
    } else if (char === "'") {
      chars[i] = ' ';
      state = 'single';
    } else if (char === '"') {
      chars[i] = ' ';
      state = 'double';
    } else if (char === '`') {
      chars[i] = ' ';
      state = 'template';
    } else if (char === '/' && canStartRegex(i)) {
      chars[i] = ' ';
      state = 'regex';
      regexCharClass = false;
    }
  }
  return chars.join('');
}

function findMatching(source, open, openChar, closeChar) {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === openChar) depth++;
    else if (source[i] === closeChar && --depth === 0) return i;
  }
  throw new Error(`無法配對 ${openChar}${closeChar}，位置 ${open}`);
}

function topLevelDepths(masked) {
  const depths = new Uint16Array(masked.length);
  let depth = 0;
  for (let i = 0; i < masked.length; i++) {
    depths[i] = depth;
    if (masked[i] === '{') depth++;
    else if (masked[i] === '}') depth = Math.max(0, depth - 1);
  }
  return depths;
}

function collectTopLevelFunctions(file) {
  const source = fs.readFileSync(path.join(root, 'js', file), 'utf8');
  const masked = codeMask(source);
  const depths = topLevelDepths(masked);
  const functions = [];
  const declaration = /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g;
  let match;
  while ((match = declaration.exec(masked))) {
    if (depths[match.index] !== 0) continue;
    const paramsOpen = masked.indexOf('(', match.index);
    const paramsClose = findMatching(masked, paramsOpen, '(', ')');
    const bodyOpen = masked.indexOf('{', paramsClose);
    assert.notEqual(bodyOpen, -1, `${file}:${match[1]} 找不到函式本體`);
    const bodyClose = findMatching(masked, bodyOpen, '{', '}');
    functions.push({
      name: match[1],
      file,
      body: masked.slice(bodyOpen + 1, bodyClose)
    });
    declaration.lastIndex = bodyClose + 1;
  }
  return functions;
}

function calledNames(source) {
  const calls = new Set();
  const call = /(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g;
  const excluded = new Set([
    'if', 'for', 'while', 'switch', 'catch', 'function', 'return',
    'typeof', 'new', 'delete', 'void'
  ]);
  let match;
  while ((match = call.exec(source))) {
    if (!excluded.has(match[1])) calls.add(match[1]);
  }
  return calls;
}

function dependencyPath(start, directTargets, functions) {
  const queue = [[start]];
  const visited = new Set();
  while (queue.length) {
    const pathSoFar = queue.shift();
    const current = pathSoFar[pathSoFar.length - 1];
    if (directTargets.has(current)) return pathSoFar;
    if (visited.has(current)) continue;
    visited.add(current);
    const record = functions.get(current);
    if (!record) continue;
    for (const called of record.calls) {
      if (functions.has(called)) queue.push(pathSoFar.concat(called));
    }
  }
  return null;
}

test('遞迴掃描 UI 呼叫的模擬層 G 相依，無未守衛路徑', () => {
  const definitions = simulationFiles.flatMap(collectTopLevelFunctions);
  const functions = new Map();
  for (const definition of definitions) functions.set(definition.name, definition);
  for (const record of functions.values()) record.calls = calledNames(record.body);

  const directG = new Set(
    [...functions.values()].filter((record) => /\bG\s*\./.test(record.body)).map((record) => record.name)
  );
  const transitiveG = new Set(directG);
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of functions.values()) {
      if (!transitiveG.has(record.name) &&
        [...record.calls].some((called) => transitiveG.has(called))) {
        transitiveG.add(record.name);
        changed = true;
      }
    }
  }

  const uiCalls = calledNames(codeMask(uiSource));
  const uiGDependencies = [...uiCalls].filter((name) => transitiveG.has(name)).sort();
  // 這些交集已逐一在 G=null 下驗證過：存檔路徑由 _saveSuppressed／typeof G
  // 保護，天賦查詢則傳入明確等級或經 reincarnationCount 的 typeof G 保護。
  // 新增任何未審核交集都會讓測試失敗，不能靠更新數量掩蓋。
  //
  // describeSkill：唯一的 G 路徑是 skillDef(id) 在靜態 SKILLS 表查不到時去找融合技
  // 記錄，該處已改為 `fusions || (typeof G !== 'undefined' && G && G.player ? ... )`，
  // 且 ui.js 兩個呼叫端都傳入技能面板快照的 fusions。
  // 證據：tests/skill-description-pure.test.cjs 在**完全沒有 G** 的 context 跑遍
  // 每一個 SKILLS 條目；主執行緒實測（G === null）亦正常回傳完整說明。
  const reviewedSafeUiDependencies = new Set([
    'autoSaveMetaV2',
    'describeSkill',
    'findSaveRecordV2',
    'loadSaveRecord',
    'openSaveFolder',
    'potentialSkillMaxLv',
    'potentialSkillValue',
    'reincarnationRankName',
    'reincarnationTotalMultiplier',
    'talentSystemUnlocked',
    'talentUnlocked',
    'xpForLevel'
  ]);
  const uiThrowers = uiGDependencies.filter((name) => !reviewedSafeUiDependencies.has(name));
  const report = uiGDependencies.map((name) => {
    const pathToG = dependencyPath(name, directG, functions);
    return `  ${name}: ${pathToG.join(' -> ')} [reviewed safe]`;
  });

  const getStatsPath = dependencyPath('getStats', directG, functions);
  assert.ok(getStatsPath && getStatsPath.length > 1,
    '掃描器必須遞迴找出 getStats 間接呼叫讀 G 的函式');
  assert.equal(getStatsPath.at(-1), 'computeStats');
  for (const name of ['getStats', 'talentLevel', 'potentialUnlocked', 'talentCompleteMultiplier']) {
    assert.equal(uiCalls.has(name), false, `ui.js 不得呼叫 ${name}`);
  }

  console.log([
    '[recursive G-dependency scan]',
    `simulation files: ${simulationFiles.length}`,
    `top-level function definitions: ${definitions.length} (${functions.size} unique)`,
    `direct G readers: ${directG.size}`,
    `transitive G readers: ${transitiveG.size}`,
    `ui.js intersections: ${uiGDependencies.length}`,
    ...report,
    `would throw with G=null: ${uiThrowers.length}`
  ].join('\n'));
  assert.deepEqual(uiThrowers, []);
});
