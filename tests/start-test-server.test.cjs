const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('舊版命令列啟動器仍保留 port 驗證與關閉功能，批次檔改啟動網頁控制台', () => {
  const launcher = fs.readFileSync(path.join(root, 'tools/start_test_server.ps1'), 'utf8');
  const batch = fs.readFileSync(path.join(root, '啟動測試服.bat'), 'utf8');

  assert.match(launcher, /Port must be an integer from 1 to 65535/);
  assert.match(launcher, /Get-NetTCPConnection/);
  assert.match(launcher, /\.claude\\serve\.ps1/);
  assert.match(launcher, /Start-Process \$url/);
  assert.match(launcher, /Get-ManagedServers/);
  assert.match(launcher, /Stop-Process -Id/);
  assert.match(launcher, /server-\{0\}\.json/);
  assert.match(batch, /tools\\test_server_manager\.cjs/);
  assert.match(batch, /api\/servers/);
  assert.match(batch, /Stop-Process -Id/);
  assert.match(batch, /--quiet/);
});
