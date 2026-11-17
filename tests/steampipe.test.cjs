'use strict';
/* SteamPipe 上傳設定與 VDF 產生（Steam 任務 E，tools/steam/steampipe-vdf.cjs）。
   上傳本身要 Steam 帳號，這裡守的是「送出去的設定一定對」：AppID／DepotID、內容資料夾、排除規則、分支。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../tools/steam/steampipe-vdf.cjs');

const root = path.resolve(__dirname, '..');

test('設定：AppID 0、480 一律拒絕；DepotID 0 時用 AppID + 1', () => {
  assert.match(P.resolveConfig({ steamConfig: { appId: 0 } }).errors.join(), /appId 還是 0/);
  assert.match(P.resolveConfig({ steamConfig: { appId: 480 } }).errors.join(), /480/);
  const c = P.resolveConfig({ steamConfig: { appId: 3000000 }, pipeConfig: { depotId: 0 } });
  assert.deepEqual(c.errors, []);
  assert.equal(c.depotId, 3000001);
  assert.equal(P.resolveConfig({ steamConfig: { appId: 3000000 }, pipeConfig: { depotId: 3000005 } }).depotId, 3000005);
});

test('設定：腳本不能把預設分支設為上線；分支名稱只能英數', () => {
  for (const b of ['default', 'Public']) {
    assert.match(P.resolveConfig({ steamConfig: { appId: 1 }, pipeConfig: { setLiveBranch: b } }).errors.join(), /預設分支/);
  }
  assert.ok(P.resolveConfig({ steamConfig: { appId: 1 }, pipeConfig: { setLiveBranch: 'beta"x' } }).errors.length > 0);
  assert.deepEqual(P.resolveConfig({ steamConfig: { appId: 1 }, pipeConfig: { setLiveBranch: 'beta' } }).errors, []);
});

test('設定：steam_appid.txt 一律排除，即使設定檔漏寫', () => {
  const c = P.resolveConfig({ steamConfig: { appId: 1 }, pipeConfig: { fileExclusions: ['*.pdb'] } });
  assert.ok(c.fileExclusions.includes('steam_appid.txt'));
});

test('VDF：AppBuild 指向正確的 AppID、Depot 檔名與絕對路徑；預覽模式不設上線分支', () => {
  const cfg = P.resolveConfig({ steamConfig: { appId: 1234560 }, pipeConfig: { setLiveBranch: 'beta' } });
  const out = P.buildVdfs(cfg, { desc: 'v1.0.0 abc1234', preview: false, contentRoot: 'dist/win-unpacked', buildOutput: 'build/steampipe/output' });
  assert.equal(out.appFile, 'app_build_1234560.vdf');
  assert.equal(out.depotFile, 'depot_build_1234561.vdf');
  assert.match(out.appVdf, /"AppID"\t"1234560"/);
  assert.match(out.appVdf, /"Preview"\t"0"/);
  assert.match(out.appVdf, /"SetLive"\t"beta"/);
  assert.match(out.appVdf, /"1234561"\t"depot_build_1234561\.vdf"/);
  assert.ok(out.appVdf.includes('"ContentRoot"\t"' + path.resolve('dist/win-unpacked') + '"'));
  const preview = P.buildVdfs(cfg, { desc: 'x', preview: true, contentRoot: 'a', buildOutput: 'b' });
  assert.match(preview.appVdf, /"Preview"\t"1"/);
  assert.doesNotMatch(preview.appVdf, /SetLive/, '預覽不能順手把建置設成上線');
});

test('VDF：DepotBuild 整個資料夾遞迴上傳，排除規則逐條成為重複的 FileExclusion', () => {
  const cfg = P.resolveConfig({ steamConfig: { appId: 10 }, pipeConfig: { fileExclusions: ['*.pdb', '*.bak'] } });
  const out = P.buildVdfs(cfg, { desc: 'd', contentRoot: 'a', buildOutput: 'b' });
  assert.match(out.depotVdf, /^"DepotBuild"\r\n\{/);
  assert.match(out.depotVdf, /"DepotID"\t"11"/);
  assert.match(out.depotVdf, /"LocalPath"\t"\*"/);
  assert.match(out.depotVdf, /"DepotPath"\t"\."/);
  assert.match(out.depotVdf, /"recursive"\t"1"/);
  assert.equal((out.depotVdf.match(/"FileExclusion"/g) || []).length, 3);
  assert.match(out.depotVdf, /"FileExclusion"\t"steam_appid\.txt"/);
});

test('VDF：值裡有雙引號或換行直接拒絕；建置描述會先清掉', () => {
  assert.throws(() => P.toVdf('A', { x: 'a"b' }), /雙引號/);
  const d = P.buildDescription({ version: '1.2.3', commit: 'abc1234', dirty: true, date: '2026-11-17', note: 'hot"fix\nline' });
  assert.equal(d, 'v1.2.3 abc1234+dirty 2026-11-17 hot fix line');
  assert.doesNotThrow(() => P.toVdf('A', { Desc: d }));
});

test('提交的設定檔：steampipe.json 不填 AppID、預設不設上線分支；本機設定檔已被 .gitignore 排除', () => {
  const pipe = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'steam', 'steampipe.json'), 'utf8'));
  assert.equal(pipe.appId, undefined, 'AppID 唯一來源是 electron/steam-config.json');
  assert.equal(pipe.setLiveBranch, '');
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.match(ignore, /tools\/steam\/steampipe\.local\.json/);
  assert.equal(fs.existsSync(path.join(root, 'tools', 'steam', 'steampipe.local.json')) &&
    require('node:child_process').execFileSync('git', ['ls-files', 'tools/steam/steampipe.local.json'], { cwd: root }).toString().trim() !== '', false,
    'steampipe.local.json 不可提交（含帳號名稱與本機路徑）');
});
