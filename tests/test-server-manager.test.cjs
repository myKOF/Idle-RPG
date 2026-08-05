const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('測試服控制台提供啟動、列表、開啟與關閉介面', () => {
  const manager = fs.readFileSync(path.join(root, 'tools/test_server_manager.cjs'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'tools/test_server_manager.html'), 'utf8');
  const batch = fs.readFileSync(path.join(root, '啟動測試服.bat'), 'utf8');

  assert.match(manager, /\/api\/servers\/start/);
  assert.match(manager, /\/api\/sources/);
  assert.match(manager, /getSourceRoots/);
  assert.match(manager, /sourceKey/);
  assert.match(manager, /\/api\/servers\/stop/);
  assert.match(manager, /createStaticServer/);
  assert.match(manager, /server\.close/);
  assert.match(manager, /Get-NetTCPConnection/);
  assert.match(manager, /discoverLocalServers/);
  assert.match(manager, /isRelevantEndpoint/);
  assert.match(manager, /managed: false/);
  assert.match(manager, /taskkill\.exe/);
  assert.match(manager, /stopExternalServerByPid/);
  assert.match(manager, /payload\.pid/);
  assert.match(html, /id="start"/);
  assert.match(html, /id="sourceRoot"/);
  assert.match(html, /\/api\/sources/);
  assert.match(html, /id="refresh"/);
  assert.match(html, /data-stop/);
  assert.match(html, /data-external/);
  assert.match(html, /前往/);
  assert.match(html, /開啟瀏覽器/);
  assert.match(batch, /test_server_manager\.cjs/);
});
