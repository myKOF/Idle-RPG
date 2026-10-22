'use strict';
/* 原創五片岩壁：同一組斜俯視幾何產生12朝向，保留既有畫布／錨點，短軸對應判定厚度。
   向量削角、逐面光照、礦物顆粒、斷層與裂隙；不使用第三方素材。
   node tools/vfx/authoring/author/rock-wall-slabs.cjs [輸出資料夾] */
const fs = require('node:fs');
const path = require('node:path');
const { resolveLibraryRoot } = require('../../vfx-library-root.cjs');
const W = 256, H = 200, OX = 128, OY = 140;
const LEN = 200, THICK = 43.55, BLOCKS = 5;
const HEIGHTS = [48, 64, 52, 58, 54];
const f = v => Math.round(v * 100) / 100;
const pts = a => a.map(p => p.map(f).join(',')).join(' ');
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const hex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
function rnd(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const LIT = [151, 150, 137], DARK = [53, 57, 53], TOP = [183, 181, 162];

function slab(deg) {
  const co = Math.cos(deg * Math.PI / 180), si = Math.sin(deg * Math.PI / 180);
  const scr = (u, v, h = 0) => [OX + u * co - v * si, OY + (u * si + v * co) * 0.5 - h];
  const R = rnd(7919); // 各角度共用同一批岩石的輪廓。
  let defs = `<filter id="mineral" x="-.02" y="-.02" width="1.04" height="1.04" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency=".075 .11" numOctaves="4" seed="38" result="grain"/>
    <feColorMatrix in="grain" type="saturate" values="0" result="grey"/>
    <feDiffuseLighting in="grey" surfaceScale="3.8" diffuseConstant="1" lighting-color="#ffffff" result="relief"><feDistantLight azimuth="235" elevation="62"/></feDiffuseLighting>
    <feComponentTransfer in="relief" result="soft"><feFuncR type="linear" slope=".6" intercept=".43"/><feFuncG type="linear" slope=".6" intercept=".43"/><feFuncB type="linear" slope=".6" intercept=".43"/></feComponentTransfer>
    <feBlend in="SourceGraphic" in2="soft" mode="multiply" result="rough"/>
    <feTurbulence type="fractalNoise" baseFrequency=".035 .07" numOctaves="3" seed="13" result="mottle"/>
    <feColorMatrix in="mottle" type="saturate" values="0" result="stone"/>
    <feComponentTransfer in="stone" result="tone"><feFuncR type="linear" slope=".55" intercept=".65"/><feFuncG type="linear" slope=".55" intercept=".65"/><feFuncB type="linear" slope=".55" intercept=".65"/></feComponentTransfer>
    <feBlend in="rough" in2="tone" mode="multiply" result="finish"/><feComposite in="finish" in2="SourceAlpha" operator="in"/>
  </filter>`, body = '';
  function face(poly, color, id, seed, top) {
    const r = rnd(seed), pstr = pts(poly);
    defs += `<clipPath id="${id}"><polygon points="${pstr}"/></clipPath>`;
    defs += `<linearGradient id="g-${id}" x1="0" y1="0" x2=".65" y2="1"><stop stop-color="${hex(mix(color, [220, 215, 192], .16))}"/><stop offset="1" stop-color="${hex(mix(color, DARK, .3))}"/></linearGradient>`;
    let art = `<polygon points="${pstr}" fill="url(#g-${id})"/>`;
    const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), width = Math.max(...xs) - x0, height = Math.max(...ys) - y0;
    // 大尺度礦物色斑讓石面有深淺與材質差異。
    for (let k = 0; k < (top ? 10 : 20); k++) {
      const x = x0 + r() * width, y = y0 + r() * height, sx = 3 + r() * 13, sy = 2 + r() * 8;
      const patch = [[x-sx,y], [x-sx*.4,y-sy], [x+sx*.6,y-sy*.65], [x+sx,y+sy*.4], [x,y+sy]];
      art += `<polygon points="${pts(patch)}" fill="${k % 3 ? '#d2c8ac' : '#303c38'}" opacity="${f(.035 + r() * .095)}"/>`;
    }
    // 細小石英／暗色礦物顆粒保持低對比。
    for (let k = 0; k < (top ? 24 : 65); k++) {
      const x = x0 + r() * width, y = y0 + r() * height;
      art += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(.12+r()*.52)}" ry="${f(.1+r()*.33)}" fill="${k % 3 ? '#e4ddc6' : '#172421'}" opacity="${f(.1+r()*.19)}"/>`;
    }
    // 斷層以暗槽與細亮邊表現深度，全部裁在各自的面內。
    for (let k = 0; k < 2; k++) {
      const y = y0 + height * (.2+k*.36+r()*.14), x = x0 + width * (.05+r()*.16);
      const line = [[x,y], [x+width*.24,y-1-r()*3], [x+width*.42,y+r()*4], [x+width*.7,y-r()*4], [x+width*.96,y-2]];
      art += `<polyline points="${pts(line)}" fill="none" stroke="#252c29" stroke-width="${top ? .55 : .75}" opacity=".36"/>`;
      art += `<polyline points="${pts(line.map(p => [p[0],p[1]+.65]))}" fill="none" stroke="#d8d0b9" stroke-width=".45" opacity=".38"/>`;
    }
    const cx = x0+width*(.3+r()*.4), cy = y0+height*.18;
    const crack = [[cx,cy], [cx-2,cy+height*.18], [cx+3,cy+height*.32], [cx-1,cy+height*.57], [cx+2,cy+height*.72]];
    art += `<polyline points="${pts(crack)}" fill="none" stroke="#202723" stroke-width=".85" opacity=".6" stroke-linejoin="bevel"/>`;
    art += `<polyline points="${pts(crack.map(p => [p[0]+.9,p[1]]))}" fill="none" stroke="#d5cbb1" stroke-width=".5" opacity=".45"/>`;
    art += `<path d="M${f(crack[2][0])} ${f(crack[2][1])} l${f(-width*.18)} ${f(height*.13)}" fill="none" stroke="#303630" stroke-width=".65" opacity=".65"/>`;
    return `<g clip-path="url(#${id})">${art}</g><polygon points="${pstr}" fill="none" stroke="#353b32" stroke-opacity=".5" stroke-width=".65" stroke-linejoin="round"/>`;
  }
  const blocks = Array.from({ length: BLOCKS }, (_, i) => {
    const u0 = -LEN/2+i*LEN/BLOCKS, u1 = u0+LEN/BLOCKS, v0 = -THICK/2, v1 = THICK/2;
    const span = u1-u0, mid = (u0+u1)/2;
    const ring = [[u0+5,v0+3], [u0+span*.32,v0], [u0+span*.7,v0+2], [u1-5,v0+1],
      [u1,v0+9], [u1-2,v1-9], [u1-7,v1-1], [u0+span*.58,v1-3],
      [u0+span*.23,v1], [u0+3,v1-5], [u0,v1-13], [u0+2,v0+12]];
    // 同一基座往上收成破碎斜肩；每個頂點獨立起伏，避免整排直立方柱。
    const shoulder = ring.map(p => [mid+(p[0]-mid)*(.9+R()*.1), p[1]*(.86+R()*.14), HEIGHTS[i]*(.48+R()*.15)]);
    const crown = ring.map(p => [mid+(p[0]-mid)*(.64+R()*.24)+(R()-.5)*4,
      p[1]*(.5+R()*.3)+(R()-.5)*3, HEIGHTS[i]*(.74+R()*.28)]);
    return { i, ring, shoulder, crown, mid, depth: scr(mid,0)[1] };
  }).sort((a,b) => a.depth-b.depth);
  for (const b of blocks) {
    let rock = '';
    const upper = b.crown.map(p => scr(...p));
    for (let j = 0; j < b.ring.length; j++) {
      const next = (j+1)%b.ring.length, a = b.ring[j], c = b.ring[next];
      const du = c[0]-a[0], dv = c[1]-a[1], mag = Math.hypot(du,dv);
      const nx = (dv*co+du*si)/mag, ny = (dv*si-du*co)/mag;
      if (ny <= .00001) continue;
      const light = Math.max(0,-nx*.65+ny*.4);
      const ma = scr(...b.shoulder[j]), mc = scr(...b.shoulder[next]);
      rock += face([scr(...a),scr(...c),mc,ma], mix(DARK,LIT,.36+light*.64), `r${b.i}s${j}`,211+b.i*37+j,false);
      rock += face([ma,mc,upper[next],upper[j]], mix(DARK,LIT,.43+light*.5), `r${b.i}shoulder${j}`,501+b.i*37+j,false);
      rock += `<polyline points="${pts([upper[j],upper[next]])}" fill="none" stroke="#c9c4ac" stroke-width="1.3" opacity=".32"/>`;
    }
    const ridge = scr(b.mid-4, -2, HEIGHTS[b.i]*1.07);
    for (let j = 0; j < upper.length; j += 3) {
      rock += face([upper[j],upper[j+1],upper[j+2],upper[(j+3)%upper.length],ridge],mix(TOP,LIT,.12+(j%4)*.1),`r${b.i}top${j}`,901+b.i*37+j,true);
    }
    for (let j = 0; j < upper.length; j += 2) {
      const a = upper[j], c = upper[(j+1)%upper.length];
      rock += `<polygon points="${pts([a,[a[0]+(c[0]-a[0])*.4,a[1]+(c[1]-a[1])*.4],[a[0]+2,a[1]+3]])}" fill="#e1d9bd" opacity=".3"/>`;
    }
    body += `<g data-rock="${b.i}">${rock}</g>`;
  }
  let back = '', front = '';
  const rubbleR = rnd(307);
  for (let i = 0; i < 28; i++) {
    const u = (rubbleR()-.5)*(LEN+10), v = (i%2 ? 1 : -1)*(THICK/2+1+rubbleR()*4);
    const p = scr(u,v), r = 1+rubbleR()*3;
    const stone = `<polygon points="${pts([[p[0]-r,p[1]],[p[0]-r*.4,p[1]-r],[p[0]+r*.7,p[1]-r*.7],[p[0]+r,p[1]+r*.3],[p[0],p[1]+r*.5]])}" fill="${hex(mix(DARK,LIT,rubbleR()))}" stroke="#333a30" stroke-width=".4"/>`;
    if (u*si+v*co > 0) front += stone; else back += stone;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" data-rock-count="${BLOCKS}" data-wall-length="${LEN}" data-wall-thickness="${THICK}"><!-- 原創五片岩壁，${deg}度；同一地面尺寸與錨點。 --><defs>${defs}</defs>${back}<g filter="url(#mineral)">${body}</g>${front}</svg>\n`;
}
function writeAll(out) {
  fs.mkdirSync(out,{recursive:true});
  for (let deg = 0; deg < 180; deg += 15) {
    const name = 'wall-slab-'+String(deg).padStart(3,'0')+'.svg', svg = slab(deg);
    fs.writeFileSync(path.join(out,name),svg); console.log(name,Buffer.byteLength(svg));
  }
}
if (require.main === module) writeAll(process.argv[2] || path.join(resolveLibraryRoot().root,'claude-authored/rock-wall'));
module.exports = { slab, writeAll };
