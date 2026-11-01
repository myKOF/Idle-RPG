'use strict';
// Export the editable supplemental animations from the configured asset library.
const path=require('node:path');
const {resolveLibraryRoot}=require('../vfx/vfx-library-root.cjs');
const game=path.resolve(__dirname,'../..');
const libraryRoot=resolveLibraryRoot().root;
for(const name of ['npc-actions-20261101','skeleton-four-20261101']){
  const packageRoot=path.join(libraryRoot,'codex-authored',name);
  require(path.join(packageRoot,'export.cjs')).exportAssets(game,process.argv[2]||'--check');
}
