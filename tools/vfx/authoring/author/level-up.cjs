'use strict';
/* Preserve the current editable preset, layout and procedural source in the configured
   material repository. The editor's repo preset is authoritative; this tool never rewrites it. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {resolveLibraryRoot}=require('../../vfx-library-root.cjs');
const Core=require('../../../../js/vfx-core.js');
const repo=path.resolve(__dirname,'../../../..');
const files=['vfx/presets/level-up.json','vfx/layouts/level-up.json','js/vfx-celebration.js','tests/fixtures/levelup-legacy-samples.json'];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const archive=path.join(resolveLibraryRoot().root,'codex-authored','level-up');
function main(){
 if(!process.argv.includes('--archive')&&!process.argv.includes('--check'))throw Error('Use --archive or --check');
 const preset=JSON.parse(fs.readFileSync(path.join(repo,files[0]),'utf8'));
 const checked=Core.validatePreset(preset);if(!checked.ok)throw Error(checked.errors.join('; '));
 const manifest={schemaVersion:1,kind:'level-up-source',source:'Self-authored procedural celebration migrated from renderer commit 405279a2; no third-party artwork.',
  editing:'Edit level-up in VFX Editor, save to repo, reload game. Use --archive to preserve the edited source; --check verifies the archive. This tool does not regenerate or overwrite the repo preset.',files:{}};
 for(const rel of files){
  const bytes=fs.readFileSync(path.join(repo,rel)),target=path.join(archive,rel);
  manifest.files[rel]=hash(bytes);
  if(process.argv.includes('--archive')){fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);}
  else if(!fs.existsSync(target)||hash(fs.readFileSync(target))!==hash(bytes))throw Error('Archive mismatch: '+rel);
 }
 const target=path.join(archive,'source.json'),body=JSON.stringify(manifest,null,2)+'\n';
 if(process.argv.includes('--archive'))fs.writeFileSync(target,body);
 else if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==body)throw Error('Archive manifest mismatch');
 console.log((process.argv.includes('--archive')?'Archived':'Verified')+' level-up editable source: '+files.length+' files and SHA manifest');
}
if(require.main===module){try{main();}catch(e){console.error(e.message);process.exitCode=1;}}
