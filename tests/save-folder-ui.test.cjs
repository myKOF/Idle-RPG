const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('存檔資料夾唯讀區提供重新掃描並會在回到視窗時刷新', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

  assert.match(html, /id="btn-folder-refresh"[^>]*>🔄 重新掃描/);
  assert.match(ui, /function rescanSaveFolderView\(showMessage\)/);
  assert.match(ui, /btnFolderRefresh\.addEventListener\('click'[\s\S]*rescanSaveFolderView\(true\)/);
  assert.match(ui, /window\.addEventListener\('focus'[\s\S]*UI\.tab === 'settings'[\s\S]*rescanSaveFolderView\(false\)/);
});

test('refreshSaveFolderFilesV2 回傳重新掃描到的檔案清單', () => {
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

  assert.match(ui, /function refreshSaveFolderFilesV2\(files\)/);
  assert.match(ui, /return Promise\.resolve\(files\);/);
  assert.match(ui, /return listSaveFolderFilesV2\(\)\.then\(function \(freshFiles\)/);
  assert.match(ui, /renderSaveFolderFilesV2\(freshFiles\);[\s\S]*return freshFiles;/);
});
