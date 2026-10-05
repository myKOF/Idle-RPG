'use strict';

/* 傷害數字合併分級（js/ui.js UI_FLOAT_MERGE）的 vm 測試用具。
   ui.js 沒有 module.exports，測試靠「從原始碼抽出函式本體，丟進 vm」來執行；
   佇列相關的測試（queueWorkerVisualEvent、flushWorkerVisualEvents、uiNoteVisualDrop、
   uiVisualDiagText）都會碰到這組全域，所以把抽取方式放在這一處，免得每個測試檔各抄一份。 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
const util = fs.readFileSync(path.join(root, 'js', 'util.js'), 'utf8');

const MERGE_FUNCS = [
  'uiFloatMergeNoteDrop',
  'uiFloatMergeStep',
  'uiFloatMergeParts',
  'uiFloatMergeAbsorb',
  'uiFloatMergeRelease'
];

function balancedFrom(source, openAt, what) {
  let depth = 0;
  for (let i = openAt; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return i;
  }
  throw new Error('unterminated ' + what);
}

function functionSource(source, name) {
  const start = source.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('missing function ' + name);
  const open = source.indexOf('{', start);
  return source.slice(start, balancedFrom(source, open, name) + 1);
}

function varBlock(source, name) {
  const start = source.indexOf('var ' + name + ' = {');
  if (start === -1) throw new Error('missing var ' + name);
  const open = source.indexOf('{', start);
  const end = balancedFrom(source, open, name);
  return source.slice(start, end + 1) + ';';
}

/* 狀態物件＋全部合併函式＋fmt（util.js 的真本體，合併後重組文字要靠它）。 */
function floatMergeSource() {
  return [
    varBlock(ui, 'UI_FLOAT_MERGE'),
    functionSource(util, 'fmt'),
    ...MERGE_FUNCS.map((name) => functionSource(ui, name))
  ].join('\n');
}

module.exports = { floatMergeSource, functionSource, varBlock, MERGE_FUNCS };
