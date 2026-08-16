const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { isRelevantEndpoint } = require(path.join(root, 'tools', 'test_server_manager.cjs'));

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
  assert.match(manager, /REGISTRY_FILE/);
  assert.match(manager, /persistRegistry/);
  assert.match(manager, /spawn\(process\.execPath/);
  assert.match(manager, /detached: true/);
  assert.match(manager, /--server/);
  assert.match(manager, /launchDetachedManager/);
  assert.match(manager, /Get-NetTCPConnection/);
  assert.match(manager, /httpListenerProcesses/);
  assert.match(manager, /serve\\\.ps1/);
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
  assert.match(html, /Idle-RPG 測試服（PowerShell）/);
  assert.match(html, /前往/);
  assert.match(html, /function serverWindowName\(port\)/);
  assert.match(html, /target="\$\{escapeHtml\(targetName\)\}"/);
  assert.match(html, /window\.open\(url, serverWindowName\(port\)\)/);
  assert.doesNotMatch(html, /target="_blank"/);
  assert.match(html, /開啟瀏覽器/);
  assert.match(batch, /test_server_manager\.cjs/);
  assert.match(batch, /--launch-manager/);
  assert.match(batch, /Invoke-RestMethod -Uri \('http:\/\/127\.0\.0\.1:' \+ \$port \+ '\/api\/servers'\)/);
  assert.doesNotMatch(batch, /Get-CimInstance Win32_Process[\s\S]*test_server_manager\\\.cjs/);
});

test('刷新時會保留 HttpListener / HTTP.sys 啟動的測試服', () => {
  assert.equal(isRelevantEndpoint({
    processName: 'powershell',
    commandLine: 'powershell.exe -File .claude\\serve.ps1 -Port 8321',
  }), true);
  assert.equal(isRelevantEndpoint({ processName: 'System' }), true);
});
