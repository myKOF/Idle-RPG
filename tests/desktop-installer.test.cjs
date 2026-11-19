'use strict';
/* 桌面版安裝包（tools/desktop/build_desktop.cjs --installer）：給 Steam 以外的測試散佈用。
   守三件事：
   1. 安裝包版不接 Steam——接了 Steam 的版本若不是從 Steam 啟動，會交給 Steam 重開、自己結束（electron/steam.cjs），
      等 AppID 填上之後，裝在 Steam 以外的安裝包就會打不開
   2. 暫存區是原始碼的硬連結：改寫 steam-config.json 之前一定要先 unlink，否則會改到原始碼
   3. demo 與正式版的安裝包 appId 不同（Windows 以 appId 認程式，相同會互相覆蓋）；輸出不蓋到 Steam 上傳用的資料夾 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'tools', 'desktop', 'build_desktop.cjs'), 'utf8');

function configFor(args) {
  const code = 'process.argv.push(' + args.map((a) => JSON.stringify(a)).join(',') + ');' +
    'console.log(JSON.stringify(require("./tools/desktop/build_desktop.cjs").installerConfig()));';
  return JSON.parse(execFileSync(process.execPath, ['-e', code], { cwd: root }).toString());
}

test('安裝包版拿掉 steamworks.js、AppID 歸 0，而且先 unlink 再寫（不改到原始碼）', () => {
  const body = /function detachSteam\(\) \{([\s\S]*?)\n\}/.exec(source);
  assert.ok(body, '找不到 detachSteam');
  assert.match(body[1], /rmrf\(path\.join\(STAGE, 'electron', 'vendor', 'steamworks\.js'\)\)/);
  assert.ok(body[1].indexOf('fs.unlinkSync(cfg)') >= 0 && body[1].indexOf('fs.unlinkSync(cfg)') < body[1].indexOf('fs.writeFileSync(cfg'),
    '要先 unlink 硬連結再寫新檔');
  assert.match(body[1], /appId: 0,\s*demoAppId: 0/);
  assert.match(source, /if \(INSTALLER\) \{\s*detachSteam\(\);/);
  // 遊戲端：AppID 0 時根本不載入 steamworks.js，所以拿掉它不會出錯
  const steam = fs.readFileSync(path.join(root, 'electron', 'steam.cjs'), 'utf8');
  assert.match(steam, /if \(!pick\.appId\) \{\s*state\.reason = '未設定 AppID';\s*return api\(\);\s*\}\s*try \{\s*lib = /);
});

test('安裝包輸出到 dist/installer/<版本>，不蓋到 Steam 上傳用的 dist/win-unpacked、dist/demo/win-unpacked', () => {
  assert.match(source, /var OUT = INSTALLER \? path\.join\(REPO, 'dist', 'installer', EDITION\)/);
});

test('demo 與正式版安裝包的 appId、檔名不同；裝在使用者資料夾、解除安裝不刪存檔', () => {
  const demo = configFor(['--edition=demo', '--installer']);
  const full = configFor(['--installer']);
  assert.notEqual(demo.appId, full.appId);
  assert.match(demo.appId, /\.demo$/);
  assert.match(demo.nsis.artifactName, /^IdleRPG-Demo-Setup-/);
  assert.match(full.nsis.artifactName, /^IdleRPG-Setup-/);
  assert.match(demo.productName, / Demo$/);
  assert.equal(demo.nsis.perMachine, false);
  assert.equal(demo.nsis.deleteAppDataOnUninstall, false);
  assert.deepEqual(demo.win.target, [{ target: 'nsis', arch: ['x64'] }]);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
  assert.match(pkg['desktop:installer:demo'], /--edition=demo --installer/);
});
