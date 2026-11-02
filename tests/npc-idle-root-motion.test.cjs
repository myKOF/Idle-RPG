'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const png=require('../tools/vfx/vfx-image-facts.cjs')._internal;
const root=path.resolve(__dirname,'..');
test('半獸人待機腳點留在原地，呼吸姿勢仍變化且循環接點不滑步',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'images/sprites/npc/npc.json'))),meta=manifest.stems.desert_orc_idle,ch=manifest.chars[meta.char];
 assert.equal(meta.frames,6);assert.equal(meta.fps,6.25);assert.equal(meta.loop,true);assert.equal(meta.hold,false);
 const chunks=png.readPngChunks(fs.readFileSync(path.join(root,'images/sprites/npc/desert_orc_idle.png'))),header=png.parseIhdr(chunks.ihdr),data=png.decodeToRgba(header,chunks);
 const base=ch.anchorY*ch.cellH,points=[],centers=[],poses=new Set();
 for(let frame=0;frame<meta.frames;frame++){
  let l=ch.cellW,r=0,bottom=0,sx=0,n=0;const rgba=Buffer.alloc(ch.cellW*ch.cellH*4);
  for(let y=0;y<ch.cellH;y++)for(let x=0;x<ch.cellW;x++){
   const p=(y*header.width+frame*ch.cellW+x)*4;rgba.set(data.subarray(p,p+4),(y*ch.cellW+x)*4);
   if(data[p+3]<128)continue;sx+=x;n++;bottom=Math.max(bottom,y+1);
   if(y>=base-8){l=Math.min(l,x);r=Math.max(r,x);}
  }
  assert.equal(bottom,base,'feet keep their ground baseline');assert.ok(r>l,'full feet remain visible');
  points.push((l+r)/2);centers.push(sx/n);poses.add(crypto.createHash('sha256').update(rgba).digest('hex'));
 }
 assert.ok(Math.max(...points)-Math.min(...points)<=1,'idle cannot walk across its cell: '+points);
 assert.ok(Math.max(...centers)-Math.min(...centers)<=4,'torso stays near its resting position');
 for(let i=0;i<points.length;i++)assert.ok(Math.abs(points[(i+1)%points.length]-points[i])<=1,'including final to first frame');
 assert.equal(poses.size,6,'keep breathing/weapon poses instead of freezing one frame');
});
