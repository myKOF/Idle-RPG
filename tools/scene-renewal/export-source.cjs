/* 素材庫為程序美術母來源；--check 比對，--apply 匯出到遊戲。 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveLibraryRoot, REPO_ROOT } = require('../vfx/vfx-library-root.cjs');
const mode = process.argv[2] || '--check';
if (!['--check', '--apply'].includes(mode)) throw new Error('用法：node tools/scene-renewal/export-source.cjs [--check|--apply]');
const source = path.join(resolveLibraryRoot({ libraryId: 'effects-materials' }).root, 'codex-authored/scene-nature/decor-nature.js');
const target = path.join(REPO_ROOT, 'js/decor-nature.js');
// 兩個倉庫的 core.autocrlf 可以不同，程序來源一律以 UTF-8／LF 核對。
const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const hash = file => crypto.createHash('sha256').update(read(file)).digest('hex');
if (mode === '--apply') fs.writeFileSync(target, read(source), 'utf8');
if (hash(source) !== hash(target)) throw new Error('程序美術母來源與遊戲匯出不同，請確認修改後再 --apply');
console.log('DecorNature 來源與匯出 SHA256 一致：' + hash(target));
