'use strict';
// 來源為使用者指定背景原檔，匯出時只複製位元組，不重編碼或加工。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {resolveLibraryRoot, REPO_ROOT} = require('../vfx/vfx-library-root.cjs');
const mode = process.argv[2] || '--check';
if (!['--apply','--check'].includes(mode)) throw new Error('Usage: sync-library.cjs [--apply|--check]');
const sourceDir = path.join(resolveLibraryRoot({libraryId:'effects-materials'}).root,'codex-authored/divine-forge-background');
const record = JSON.parse(fs.readFileSync(path.join(sourceDir,'source.json'),'utf8'));
const source = path.join(sourceDir,'divine-forge-background.jpg');
const target = path.join(REPO_ROOT,'images/ui/divine-forge-background.jpg');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if (hash(source) !== record.sha256) throw new Error('Background source differs from its provenance record');
if (mode === '--apply') fs.copyFileSync(source,target);
if (hash(target) !== record.sha256) throw new Error('Background export differs from library source');
console.log('Divine forge background: library, provenance and game SHA256 match.');
