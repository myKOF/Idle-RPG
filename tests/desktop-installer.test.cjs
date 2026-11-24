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

test('應用程式名稱讀 String 表 2569：中文「神力之巔」、英文「Divine Ascension: Idle RPG」；捷徑名拿掉檔名不允許的字元', () => {
  const { csvParse } = require('../tools/string-table/apply_strings.cjs');
  const rows = csvParse(fs.readFileSync(path.join(root, 'config', 'CSV', 'String.csv'), 'utf8'));
  const h = rows[0];
  const row = rows.find((r) => r[0] === '2569');
  assert.ok(row, 'String 表要有 2569（遊戲正式名稱）');
  assert.equal(row[h.indexOf('繁體中文')], '神力之巔');
  assert.equal(row[h.indexOf('英文')], 'Divine Ascension: Idle RPG');
  const zh = configFor(['--installer']);
  const demo = configFor(['--edition=demo', '--installer']);
  const en = configFor(['--lang=en', '--edition=demo', '--installer']);
  assert.equal(zh.productName, '神力之巔');
  assert.equal(demo.productName, '神力之巔 Demo');
  assert.equal(en.productName, 'Divine Ascension: Idle RPG Demo');
  assert.equal(en.nsis.shortcutName, 'Divine Ascension Idle RPG Demo', '捷徑是檔案，不能有冒號');
  assert.equal(en.nsis.uninstallDisplayName, 'Divine Ascension: Idle RPG Demo', '顯示用的地方保留完整名稱');
  assert.equal(en.nsis.language, '1033');
  assert.match(en.directories.output.replace(/\\/g, '/'), /dist\/installer\/demo\/en$/, '英文版不能蓋掉預設的中文版');
  // 名稱只能從表讀：打包設定裡不得寫死
  assert.doesNotMatch(source, /'神力之巔|Divine Ascension'/);
});

test('12 種打包語言：每種都對到 String 表的語言欄與 electron-builder 內建的安裝程式翻譯', () => {
  const B = require('../tools/desktop/build_desktop.cjs');
  const bundled = require('app-builder-lib/out/util/langs.js').bundledLanguages;
  const expected = { 'zh-TW': '繁體中文', 'zh-CN': '簡體中文', en: '英文', ru: '俄文', es: '西班牙文', 'pt-BR': '葡萄牙文',
    ja: '日文', ko: '韓文', de: '德文', fr: '法文', pl: '波蘭文', tr: '土耳其文' };
  assert.deepEqual(Object.fromEntries(Object.entries(B.LANGS).map(([k, v]) => [k, v.column])), expected);
  for (const k of Object.keys(B.LANGS)) {
    assert.ok(bundled.includes(B.LANGS[k].nsis), k + '：安裝程式沒有 ' + B.LANGS[k].nsis + ' 的翻譯');
    assert.match(B.nsisLanguageId(k), /^\d+$/);
  }
});

test('各語言的名稱：有填用自己的；沒填（或 CSV 還沒有這欄）簡中退繁中、其他退英文；英文不能空', () => {
  const B = require('../tools/desktop/build_desktop.cjs');
  const header = ['編號', '功能模塊', '用途說明', '替代字符參數說明', '繁體中文', '簡體中文', '英文', '日文'];
  const row = ['2569', '通用', '', '', '神力之巔', '', 'Divine Ascension: Idle RPG', 'ディバイン・アセンション'];
  assert.equal(B.gameNameFor(header, row, 'ja').name, 'ディバイン・アセンション');
  assert.equal(B.gameNameFor(header, row, 'zh-CN').name, '神力之巔');
  const ko = B.gameNameFor(header, row, 'ko');
  assert.equal(ko.name, 'Divine Ascension: Idle RPG');
  assert.equal(ko.columnMissing, true, 'CSV 沒有韓文欄要標出來（提醒先跑套用參數.bat）');
  assert.throws(() => B.gameNameFor(header, ['2569', '', '', '', '神力之巔', '', '', ''], 'en'), /英文/);
  assert.throws(() => B.gameNameFor(header, ['2569', '', '', '', '神力之巔', '', '', ''], 'de'), /英文/);
});

test('應用程式圖示：exe、安裝包、解除安裝程式與視窗都用 electron/icons/app.ico，且 ico 含 16～256 各尺寸', () => {
  const ico = path.join(root, 'electron', 'icons', 'app.ico');
  const demo = configFor(['--edition=demo', '--installer']);
  for (const v of [demo.win.icon, demo.nsis.installerIcon, demo.nsis.uninstallerIcon, demo.nsis.installerHeaderIcon]) {
    assert.equal(path.resolve(v), ico);
  }
  const dir = JSON.parse(execFileSync(process.execPath, ['-e',
    'console.log(JSON.stringify(require("./tools/desktop/build_desktop.cjs").builderConfig()))'], { cwd: root }).toString());
  assert.equal(path.resolve(dir.win.icon), ico, 'Steam 上傳用的資料夾版也要帶圖示');
  // ICO 檔頭：保留 0、類型 1、張數；每張 16 bytes 的目錄，寬高 0 代表 256
  const buf = fs.readFileSync(ico);
  assert.equal(buf.readUInt16LE(0), 0);
  assert.equal(buf.readUInt16LE(2), 1);
  const sizes = [];
  for (let i = 0; i < buf.readUInt16LE(4); i++) sizes.push(buf[6 + i * 16] || 256);
  assert.deepEqual(sizes.sort((a, b) => a - b), [16, 24, 32, 48, 64, 128, 256]);
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  assert.match(main, /icon: path\.join\(__dirname, 'icons', 'app\.ico'\)/);
  assert.equal(require('../tools/desktop/ship-rules.cjs').classify('electron/icons/app.ico').ship, true, '視窗圖示要出貨');
});
