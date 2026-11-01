'use strict';
// Export the editable supplemental animations from the configured asset library.
const path=require('node:path');
const {resolveLibraryRoot}=require('../vfx/vfx-library-root.cjs');
const game=path.resolve(__dirname,'../..');
const packageRoot=path.join(resolveLibraryRoot().root,'codex-authored/npc-actions-20261101');
require(path.join(packageRoot,'export.cjs')).exportAssets(game,process.argv[2]||'--check');
