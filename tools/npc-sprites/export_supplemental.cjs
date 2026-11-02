'use strict';
// Export the editable supplemental animations from the configured asset library.
const path=require('node:path');
const {resolveLibraryRoot}=require('../vfx/vfx-library-root.cjs');
const game=path.resolve(__dirname,'../..');
const libraryRoot=resolveLibraryRoot().root;
const stationary=require(path.join(libraryRoot,'codex-authored','npc-stationary-idles-20261102','export.cjs'));
stationary.verify();
for(const name of ['npc-actions-20261101','skeleton-four-20261101','desert-npc-batch1-20261101','desert-npc-batch2-20261101','npc-completion-20261101']){
  const packageRoot=path.join(libraryRoot,'codex-authored',name);
  require(path.join(libraryRoot,'codex-authored','npc-walk-cycles-20261102','verify.cjs')).verify(packageRoot);
  require(path.join(packageRoot,'export.cjs')).exportAssets(game,process.argv[2]||'--check');
}
stationary.exportAssets(game,process.argv[2]||'--check');
