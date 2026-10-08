/* 素材庫為程序美術母來源；--check 比對，--apply 匯出到遊戲。 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveLibraryRoot, REPO_ROOT } = require('../vfx/vfx-library-root.cjs');
const mode = process.argv[2] || '--check';
if (!['--check', '--apply', '--make-sprites'].includes(mode)) throw new Error('用法：node tools/scene-renewal/export-source.cjs [--check|--apply|--make-sprites]');
const sourceRoot = path.join(resolveLibraryRoot({ libraryId: 'effects-materials' }).root, 'codex-authored/scene-nature');
// 兩個倉庫的 core.autocrlf 可以不同，程序來源一律以 UTF-8／LF 核對。
const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const hash = (file, binary) => crypto.createHash('sha256').update(binary ? fs.readFileSync(file) : read(file)).digest('hex');
const sprites = {willow:'willow',burnt:'burnt-tree',pine:'snow-pine',bones:'beast-bones',cactus:'cactus',ice:'ice-cluster',void:'void-crystal',log:'fallen-log',stump:'swamp-stump',monolith:'rune-stele',pillar:'stone-column',arch:'ruined-arch',wall:'ruined-wall',rubble:'fallen-masonry',urn:'weathered-urn',grave:'old-gravestone',arenaGate:'arena-gate',arenaBrazier:'arena-brazier',arenaSpire:'arena-spire',arenaCandles:'arena-candles'};
async function main(){
  if(mode==='--make-sprites'){
    // 標準素材匯出：只裁透明留白／等比縮小，不重畫或修改AI素材的造型。
    const sharp=require('sharp');const records=[];fs.mkdirSync(path.join(sourceRoot,'sprites'),{recursive:true});
    for(const [key,name] of Object.entries(sprites)){
      const source=path.join(sourceRoot,'originals',key+'.png');
      const {data,info}=await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      if(info.width>1024||info.height>1024)throw new Error(key+' 母圖不得超過1024×1024');
      let left=info.width,top=info.height,right=-1,bottom=-1,transparent=0;
      for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){const a=data[(y*info.width+x)*4+3];if(a===0)transparent++;if(a>4){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}}
      if(!transparent||right<left)throw new Error(key+' 必須是真透明且非空的PNG');
      left=Math.max(0,left-3);top=Math.max(0,top-3);right=Math.min(info.width-1,right+3);bottom=Math.min(info.height-1,bottom+3);
      const target=path.join(sourceRoot,'sprites',name+'.png');
      await sharp(source).extract({left,top,width:right-left+1,height:bottom-top+1}).resize({width:512,height:512,fit:'inside',withoutEnlargement:true}).png().toFile(target);
      records.push({key,file:name+'.png',originalSha256:hash(source,true),exportSha256:hash(target,true),crop:{left,top,width:right-left+1,height:bottom-top+1},size:await sharp(target).metadata().then(m=>[m.width,m.height])});
    }
    fs.writeFileSync(path.join(sourceRoot,'sprite-exports.json'),JSON.stringify(records,null,2)+'\n');console.log(records.length+'份完整AI素材已縮小匯出，alpha保持透明。');return;
  }
  const files=[['decor-nature.js','js/decor-nature.js',false],['gen_ground_tiles.py','tools/gen_ground_tiles.py',false]];
  for(const name of Object.values(sprites))files.push(['sprites/'+name+'.png','images/scene/'+name+'.png',true]);
  for(const zone of ['default','desert','Icefield','swamp','undead_mountains','god_battlefield','god_chaos','god_sanctuary'])files.push(['ground/ground_'+zone+'.png','images/ground/ground_'+zone+'.png',true]);
  for(const [sourceRel,targetRel,binary] of files){const source=path.join(sourceRoot,sourceRel),target=path.join(REPO_ROOT,targetRel);
    if(mode==='--apply'){fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,binary?fs.readFileSync(source):read(source));}
    if(hash(source,binary)!==hash(target,binary))throw new Error(targetRel+' 母來源與遊戲匯出不同');
    console.log(targetRel+' SHA256 '+hash(target,binary));
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
