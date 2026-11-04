'use strict';
// 保存使用者指定的第三方原檔與來源紀錄；不轉碼、不改音量。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { resolveLibraryRoot, REPO_ROOT } = require('../vfx/vfx-library-root.cjs');
const FILE = 'mixkit-game-level-completed-2059.wav';
const SHA = '8da83b49ceb580493ba7c7081ec3d176fe069d4505474b604f6fb08b339bd32a';
const GAME_REL = 'audio/achievements';
const LIBRARY_REL = 'third-party/mixkit/achievement-completed-2059';
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const args = process.argv.slice(2);
assert.equal(args.filter(a => a === '--apply' || a === '--check').length, 1, '使用 --apply 或 --check');
const library = path.join(resolveLibraryRoot().root, LIBRARY_REL);
const game = path.join(REPO_ROOT, GAME_REL);
const sourceAt = args.indexOf('--source');
const source = sourceAt >= 0 ? args[sourceAt + 1] : path.join(library, FILE);
assert.ok(source, '--source 必須指定音檔');
const bytes = fs.readFileSync(source);
assert.equal(digest(bytes), SHA, '原始檔SHA不符合使用者指定版本');
assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
assert.equal(bytes.readUInt16LE(20), 1);
assert.equal(bytes.readUInt16LE(22), 2);
assert.equal(bytes.readUInt32LE(24), 44100);
assert.equal(bytes.readUInt16LE(34), 16);
const manifest = {
  origin: 'User-supplied third-party Mixkit sound effect; not Codex-authored',
  title: 'Game level completed', itemId: 2059,
  sourceUrl: 'https://mixkit.co/free-sound-effects/game/',
  license: 'Mixkit Sound Effects Free License',
  licenseUrl: 'https://mixkit.co/license/modal/sfxFree/',
  licenseCheckedOn: '2026-11-05',
  permissions: 'Commercial and non-commercial game end-product integration',
  restrictions: 'No standalone, stock, template/tool or source-asset redistribution; no ownership claims or rights-management registration',
  userInstruction: 'Use the supplied sound for achievement completion',
  modification: 'None; original file copied byte-for-byte, original volume',
  usage: 'AchievementUI nextToast after validated achievementUnlocked notice',
  file: FILE, sha256: SHA, bytes: bytes.length,
  format: { codec: 'PCM', bits: 16, channels: 2, sampleRate: 44100, frames: 156213, seconds: 156213 / 44100 },
  libraryRelativePath: LIBRARY_REL, gameRelativePath: GAME_REL + '/' + FILE
};
const readme = '# 成就達成音效\n\n' +
  '使用者指定使用Mixkit的Game level completed（項目2059）。第三方原檔，非Codex自製；未改音色、音量或格式。\n\n' +
  '來源：https://mixkit.co/free-sound-effects/game/ （官方列表的項目id2059，2026-11-05核對）\n' +
  '授權：https://mixkit.co/license/modal/sfxFree/ （Mixkit Sound Effects Free License，2026-11-05核對）\n\n' +
  '允許整合於商業及非商業遊戲成品；不可單獨、當素材包、工具／範本或隨原始素材再散布，不可宣稱自製或登記權利管理。素材庫僅保存本專案內部製作原檔，不作公開素材庫發行。\n\n' +
  '成就notice經既有toast佇列實際顯示時播放一次；多項達成依提示逐則播放。讀檔既有成就與清單重繪不觸發。背景或尚未解鎖音訊時略過，不補播過期聲音。\n\n' +
  '匯入工具：tools/audio/import-achievement-sound.cjs --apply --source <使用者音檔>；後續--check核對兩庫與manifest。SHA256：' + SHA + '。\n';
const outputs = new Map([[FILE, bytes], ['manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n')], ['README.md', Buffer.from(readme)]]);
if (args.includes('--apply')) {
  fs.mkdirSync(library, { recursive: true });
  fs.mkdirSync(game, { recursive: true });
  for (const [name, data] of outputs) fs.writeFileSync(path.join(library, name), data);
  fs.writeFileSync(path.join(library, 'import-achievement-sound.cjs'), fs.readFileSync(__filename));
  for (const name of outputs.keys()) fs.copyFileSync(path.join(library, name), path.join(game, name));
}
for (const [name, data] of outputs) {
  assert.equal(digest(fs.readFileSync(path.join(library, name))), digest(data), '素材庫不一致：' + name);
  assert.equal(digest(fs.readFileSync(path.join(game, name))), digest(data), '遊戲匯出不一致：' + name);
}
assert.equal(digest(fs.readFileSync(path.join(library, 'import-achievement-sound.cjs'))), digest(fs.readFileSync(__filename)));
console.log('PASS: 成就原音檔／來源／授權／匯入工具與雙庫SHA一致；未轉碼或調整音量。');
