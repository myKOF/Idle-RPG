'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const png=require('../tools/vfx/vfx-image-facts.cjs')._internal,root=path.resolve(__dirname,'..'),dir=path.join(root,'images/sprites/npc');
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'npc.json'))),locks=JSON.parse(fs.readFileSync(path.join(dir,'idle-locks.json')));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
test('落地人形與指定四足待機均納入腳部固定驗證',()=>{
 assert.equal(locks.length,65);assert.equal(new Set(locks.map(r=>r.key)).size,65);
 for(const key of ['desert_tree_spirit','npc_lava_mountain_2','npc_lava_mountain_3','desert_orc','npc_icefield_9','npc_icefield_11','old_demon','male_damned','female_damned','twisted_damned','skeleton_warrior_sword','skeleton_warrior_axe','skeleton_mage_staff','skeleton_mage_book'])assert.ok(locks.some(r=>r.key===key),key);
});
for(const {key,lockY} of locks)test(key+' 待機下肢逐像素固定，只有上身微幅呼吸，含尾幀接首幀',()=>{
 const meta=manifest.stems[key+'_idle'],ch=manifest.chars[key],chunks=png.readPngChunks(fs.readFileSync(path.join(dir,key+'_idle.png'))),header=png.parseIhdr(chunks.ihdr),data=png.decodeToRgba(header,chunks),w=ch.cellW,h=ch.cellH;
 assert.equal(header.width,w*meta.frames);assert.equal(header.height,h);assert.equal(meta.loop,true);assert.equal(meta.hold,false);
 const frames=[],tops=[],bottoms=[],centers=[];
 for(let i=0;i<meta.frames;i++){
  const frame=Buffer.alloc(w*h*4);let top=h,bottom=0,sx=0,sy=0,n=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const p=(y*header.width+i*w+x)*4;frame.set(data.subarray(p,p+4),(y*w+x)*4);
   if(data[p+3]<128)continue;top=Math.min(top,y);bottom=Math.max(bottom,y+1);sx+=x;sy+=y;n++;
  }
  assert.ok(n>0,key+' full visible character');frames.push(frame);tops.push(top);bottoms.push(bottom);centers.push({x:sx/n,y:sy/n});
 }
 assert.ok(lockY<=tops[0]+(bottoms[0]-tops[0])*.68,'lock must cover legs, not just one ground row');
 assert.ok(lockY>tops[0]+(bottoms[0]-tops[0])*.4,'upper body remains free to breathe');
 for(let i=0;i<frames.length;i++){
  const next=frames[(i+1)%frames.length];assert.deepEqual(frames[i].subarray(lockY*w*4),next.subarray(lockY*w*4),key+' legs/feet cannot shift, change stance, or step '+i+'→'+((i+1)%frames.length));
  assert.equal(bottoms[i],bottoms[0],'ground contact stays fixed');
 }
 assert.ok(new Set(frames.map(sha)).size>=2,'keep subtle breathing instead of freezing the entire character');
 assert.ok(Math.max(...tops)-Math.min(...tops)<=2,'breathing height limited to two source pixels');
 for(const axis of ['x','y'])assert.ok(Math.max(...centers.map(c=>c[axis]))-Math.min(...centers.map(c=>c[axis]))<=1.5,'no whole-body displacement on '+axis);
});
