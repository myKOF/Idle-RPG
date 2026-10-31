/* 產生「依名稱區分」的裝備圖示（輕甲／布甲／皮甲／鎖甲等）。
   既有的重甲美術（images/icon_*.png）對應板甲、龍鱗等重型名稱；本腳本補的是布、皮、麻、鎖、草等輕型名稱。
   用法：node tools/equipment-ui/gen_equip_icons.cjs  → 輸出 images/equip/*.svg 與 _render.html
   PNG 由 Chrome headless 轉出（見 tools/equipment-ui/render_equip_icons.cjs）。 */
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', '..', 'images', 'equip');
fs.mkdirSync(OUT, { recursive: true });

const MATS = {
  cloth:   ['#a39a86', '#6b6250', '#2b261c'],
  clothD:  ['#7d6f8f', '#4d4260', '#211b2c'],
  leather: ['#a0683a', '#6a3f1f', '#26140a'],
  iron:    ['#b7c0c9', '#6b7580', '#1e242a'],
  mail:    ['#aeb7c0', '#5d6670', '#1a1f24'],
  rope:    ['#d2b878', '#9a7c43', '#3b2d12'],
  straw:   ['#d8c070', '#a38a3c', '#3b3010'],
  bronze:  ['#f0b068', '#b0702c', '#3a1d08'],
  silver:  ['#f2f6fa', '#9aa5b0', '#2c333a'],
  wood:    ['#a8764a', '#6e4527', '#2a1809'],
  wind:    ['#c8e8e0', '#5aa59a', '#10302c']
};
const defs = () => Object.entries(MATS).map(([k, c]) =>
  `<linearGradient id="g_${k}" x1="0" y1="0" x2="0.8" y2="1"><stop offset="0" stop-color="${c[0]}"/><stop offset="0.55" stop-color="${c[1]}"/><stop offset="1" stop-color="${c[2]}"/></linearGradient>`).join('') +
  `<filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#000" flood-opacity="0.55"/></filter>
   <pattern id="mailp" width="26" height="26" patternUnits="userSpaceOnUse"><circle cx="7" cy="7" r="6" fill="none" stroke="#10151a" stroke-width="3"/><circle cx="20" cy="20" r="6" fill="none" stroke="#10151a" stroke-width="3"/><circle cx="7" cy="7" r="4" fill="none" stroke="#e4eaf0" stroke-opacity=".35" stroke-width="1.5"/><circle cx="20" cy="20" r="4" fill="none" stroke="#e4eaf0" stroke-opacity=".35" stroke-width="1.5"/></pattern>`;

const OL = 'stroke="#120e0a" stroke-width="8" stroke-linejoin="round" stroke-linecap="round"';
const st = (d, extra = '') => `<path d="${d}" fill="none" stroke="#120e0a" stroke-opacity=".55" stroke-width="4" stroke-dasharray="12 10" stroke-linecap="round" ${extra}/>`; // 縫線
const rivet = (x, y, r = 7) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#c9d0d6" stroke="#120e0a" stroke-width="3"/><circle cx="${x - 2}" cy="${y - 2}" r="${r / 3}" fill="#fff" fill-opacity=".8"/>`;
const hi = (d) => `<path d="${d}" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="6" stroke-linecap="round"/>`;
const fold = (d) => `<path d="${d}" fill="none" stroke="#000" stroke-opacity=".28" stroke-width="5" stroke-linecap="round"/>`;
const body = (d, m, extra = '') => `<path d="${d}" fill="url(#g_${m})" ${OL} ${extra}/>`;

const icons = {};

/* ---------- 頭部 ---------- */
icons.helmet_leather = `
  ${body('M118 350 C104 200 170 108 256 108 C342 108 408 200 394 350 Z', 'leather')}
  ${body('M104 318 H408 V376 Q256 400 104 376 Z', 'clothD'.replace('clothD', 'leather'), 'fill-opacity=".9"')}
  ${fold('M256 112 V316')}${fold('M190 130 Q170 220 176 316')}${fold('M322 130 Q342 220 336 316')}
  ${st('M256 118 V312')}${st('M112 346 Q256 368 400 346')}
  ${body('M104 340 Q70 380 96 430 L150 410 L150 370 Z', 'leather')}${body('M408 340 Q442 380 416 430 L362 410 L362 370 Z', 'leather')}
  ${hi('M170 200 Q190 150 240 128')}${rivet(150, 340)}${rivet(362, 340)}${rivet(256, 350)}`;

icons.helmet_iron = `
  ${body('M108 330 C100 170 170 96 256 96 C342 96 412 170 404 330 Z', 'iron')}
  ${body('M108 300 H404 V344 H108 Z', 'iron')}
  <path d="M200 300 H312 V420 Q256 440 200 420 Z" fill="#0b0b0e" ${OL}/>
  ${body('M108 330 L196 330 L200 430 Q150 440 120 400 Z', 'iron')}${body('M404 330 L316 330 L312 430 Q362 440 392 400 Z', 'iron')}
  <path d="M232 300 V250 H280 V300" fill="url(#g_iron)" ${OL}/>
  ${fold('M256 100 V250')}${hi('M160 190 Q185 130 245 112')}
  ${rivet(130, 322)}${rivet(256, 322, 8)}${rivet(382, 322)}${rivet(150, 400, 6)}${rivet(362, 400, 6)}`;

/* ---------- 肩部 ---------- */
const pad = (cx, flip) => {
  const s = flip ? -1 : 1;
  const x = (v) => cx + s * v;
  return `
  ${body(`M${x(-80)} 340 Q${x(-100)} 190 ${x(0)} 160 Q${x(100)} 190 ${x(80)} 340 Q${x(0)} 372 ${x(-80)} 340 Z`, 'cloth')}
  ${fold(`M${x(-50)} 200 L${x(30)} 340`)}${fold(`M${x(0)} 180 L${x(60)} 330`)}${fold(`M${x(-80)} 270 L${x(-20)} 350`)}
  ${fold(`M${x(50)} 200 L${x(-30)} 340`)}${fold(`M${x(0)} 180 L${x(-60)} 330`)}
  ${st(`M${x(-72)} 328 Q${x(0)} 356 ${x(72)} 328`)}`;
};
icons.shoulder_cloth = `${pad(150, false)}${pad(362, true)}
  <path d="M150 170 Q256 80 362 170" fill="none" stroke="#120e0a" stroke-width="22" stroke-linecap="round"/>
  <path d="M150 170 Q256 80 362 170" fill="none" stroke="#8a7a5a" stroke-width="12" stroke-linecap="round"/>`;

const plates = (cx, flip) => {
  const s = flip ? -1 : 1;
  const x = (v) => cx + s * v;
  let o = '';
  [[0, 'M-95 250 Q-95 150 0 130 Q95 150 95 250 Q0 275 -95 250 Z'], [1, 'M-90 310 Q-95 235 0 215 Q95 235 90 310 Q0 335 -90 310 Z'], [2, 'M-80 370 Q-90 305 0 290 Q90 305 80 370 Q0 392 -80 370 Z']].forEach(([i, d]) => {
    const pts = d.replace(/-?\d+/g, (n, off, str) => n);
    o += body(d.replace(/(-?\d+) (-?\d+)/g, (m, a, b) => `${x(+a)} ${b}`), 'iron');
  });
  return o + hi(`M${x(-60)} 175 Q${x(-20)} 145 ${x(30)} 150`) + rivet(x(-50), 240) + rivet(x(50), 240) + rivet(x(-45), 305) + rivet(x(45), 305);
};
icons.shoulder_iron = `${plates(150, false)}${plates(362, true)}`;

/* ---------- 胸甲 ---------- */
const TUNIC = 'M178 84 L256 128 L334 84 L452 140 L476 296 L404 312 L388 250 L388 440 Q256 462 124 440 L124 250 L108 312 L36 296 L60 140 Z';
icons.chest_cloth = `
  ${body(TUNIC, 'cloth')}
  <path d="M178 84 L256 128 L334 84 L300 70 Q256 100 212 70 Z" fill="#14100c" ${OL}/>
  ${fold('M200 220 Q215 320 190 430')}${fold('M312 220 Q297 320 322 430')}${fold('M256 140 V430')}${fold('M90 200 Q110 250 100 290')}${fold('M422 200 Q402 250 412 290')}
  <path d="M124 396 Q256 420 388 396" fill="none" stroke="#120e0a" stroke-width="22"/><path d="M124 396 Q256 420 388 396" fill="none" stroke="url(#g_leather)" stroke-width="14"/>
  ${st('M126 432 Q256 452 386 432')}${st('M44 288 L108 304')}${st('M468 288 L404 304')}
  <path d="M256 128 L256 190 M236 150 L276 170 M276 150 L236 172" stroke="#3a2f20" stroke-width="5" fill="none" stroke-linecap="round"/>
  ${hi('M80 160 L120 180')}`;

icons.chest_mail = `
  ${body(TUNIC, 'mail')}
  <path d="${TUNIC}" fill="url(#mailp)" stroke="none"/>
  <path d="M178 84 L256 128 L334 84 L300 70 Q256 100 212 70 Z" fill="url(#g_leather)" ${OL}/>
  <path d="M124 408 Q256 432 388 408 V446 Q256 470 124 446 Z" fill="url(#g_leather)" ${OL}/>
  <path d="M36 296 L108 312 L112 330 L30 314 Z" fill="url(#g_leather)" ${OL}/><path d="M476 296 L404 312 L400 330 L482 314 Z" fill="url(#g_leather)" ${OL}/>
  ${fold('M256 128 V410')}${hi('M80 160 L120 180')}${rivet(150, 428, 6)}${rivet(256, 438, 6)}${rivet(362, 428, 6)}`;

/* ---------- 腰帶 ---------- */
const twist = (rx, ry, w) => `
  <ellipse cx="256" cy="270" rx="${rx}" ry="${ry}" fill="none" stroke="#120e0a" stroke-width="${w + 12}"/>
  <ellipse cx="256" cy="270" rx="${rx}" ry="${ry}" fill="none" stroke="url(#g_rope)" stroke-width="${w}"/>
  <ellipse cx="256" cy="270" rx="${rx}" ry="${ry}" fill="none" stroke="#3b2d12" stroke-opacity=".7" stroke-width="${w - 6}" stroke-dasharray="5 21"/>`;
icons.belt_rope = `
  ${twist(190, 110, 44)}
  <path d="M256 366 C230 400 220 440 200 468 M256 366 C282 400 296 440 318 466" fill="none" stroke="#120e0a" stroke-width="34" stroke-linecap="round"/>
  <path d="M256 366 C230 400 220 440 200 468 M256 366 C282 400 296 440 318 466" fill="none" stroke="url(#g_rope)" stroke-width="22" stroke-linecap="round"/>
  <path d="M256 366 C230 400 220 440 200 468 M256 366 C282 400 296 440 318 466" fill="none" stroke="#3b2d12" stroke-opacity=".7" stroke-width="16" stroke-dasharray="4 14"/>
  <circle cx="256" cy="372" r="34" fill="url(#g_rope)" ${OL}/><circle cx="256" cy="372" r="16" fill="#3b2d12" fill-opacity=".6"/>
  <path d="M200 468 l-14 18 M200 468 l6 20 M200 468 l18 14 M318 466 l-6 22 M318 466 l12 18 M318 466 l20 8" stroke="#9a7c43" stroke-width="5" stroke-linecap="round"/>`;

icons.belt_chain = `
  <ellipse cx="256" cy="262" rx="190" ry="112" fill="none" stroke="#120e0a" stroke-width="44" stroke-dasharray="40 4"/>
  <ellipse cx="256" cy="262" rx="190" ry="112" fill="none" stroke="url(#g_mail)" stroke-width="32" stroke-dasharray="36 8"/>
  <ellipse cx="256" cy="262" rx="190" ry="112" fill="none" stroke="#10151a" stroke-width="12" stroke-dasharray="14 30" stroke-dashoffset="8"/>
  <ellipse cx="256" cy="262" rx="190" ry="112" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="4" stroke-dasharray="20 24"/>
  <rect x="196" y="320" width="120" height="96" rx="14" fill="url(#g_iron)" ${OL}/>
  <rect x="220" y="342" width="72" height="52" rx="8" fill="none" stroke="#120e0a" stroke-width="8"/><rect x="246" y="336" width="20" height="64" rx="6" fill="url(#g_iron)" stroke="#120e0a" stroke-width="5"/>
  ${rivet(210, 332, 6)}${rivet(302, 332, 6)}${rivet(210, 404, 6)}${rivet(302, 404, 6)}`;

/* ---------- 手部 ---------- */
const glove = (m, cuff) => `
  <rect x="168" y="86" width="42" height="170" rx="21" fill="url(#g_${m})" ${OL}/>
  <rect x="214" y="58" width="42" height="196" rx="21" fill="url(#g_${m})" ${OL}/>
  <rect x="260" y="70" width="42" height="186" rx="21" fill="url(#g_${m})" ${OL}/>
  <rect x="306" y="110" width="40" height="150" rx="20" fill="url(#g_${m})" ${OL}/>
  <rect x="160" y="200" width="196" height="170" rx="36" fill="url(#g_${m})" ${OL}/>
  <path d="M170 280 Q104 250 92 188 Q100 162 124 170 Q150 230 176 244 Z" fill="url(#g_${m})" ${OL}/>
  ${fold('M212 150 V250')}${fold('M258 140 V250')}${fold('M304 160 V250')}${hi('M182 100 V200')}
  ${cuff}`;
icons.gloves_cloth = glove('cloth', `
  <path d="M150 360 H366 L378 452 H138 Z" fill="url(#g_clothD)" ${OL}/>${fold('M200 372 V446')}${fold('M258 372 V446')}${fold('M316 372 V446')}${st('M146 440 H370')}`);
icons.gloves_leather = glove('leather', `
  <path d="M150 360 H366 L378 452 H138 Z" fill="url(#g_leather)" ${OL}/>
  <rect x="150" y="392" width="216" height="26" fill="#26140a" ${OL}/><rect x="236" y="386" width="40" height="38" rx="6" fill="none" stroke="#d9c7a0" stroke-width="7"/>
  ${st('M146 440 H370')}${st('M180 215 Q258 235 336 215')}`);

const wrist = (m, extra) => `
  <path d="M146 112 Q256 82 366 112 L384 400 Q256 440 128 400 Z" fill="url(#g_${m})" ${OL}/>${extra}`;
icons.wrist_cloth = `
  <path d="M146 112 Q256 82 366 112 L384 400 Q256 440 128 400 Z" fill="url(#g_cloth)" ${OL}/>
  <clipPath id="cw"><path d="M146 112 Q256 82 366 112 L384 400 Q256 440 128 400 Z"/></clipPath>
  <g clip-path="url(#cw)" stroke="#2b261c" stroke-opacity=".45" stroke-width="6">${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => `<path d="M100 ${100 + i * 38} L420 ${150 + i * 38}"/>`).join('')}</g>
  <path d="M358 330 Q440 370 430 450 Q400 410 340 380 Z" fill="url(#g_cloth)" ${OL}/>
  ${hi('M170 140 Q160 250 168 340')}`;
icons.wrist_leather = wrist('leather', `
  ${[170, 256, 342].map(y => `<path d="M138 ${y} Q256 ${y + 22} 374 ${y} V${y + 34} Q256 ${y + 56} 138 ${y + 34} Z" fill="url(#g_leather)" ${OL}/><rect x="238" y="${y + 6}" width="36" height="40" rx="6" fill="none" stroke="#d9c7a0" stroke-width="7"/>`).join('')}
  ${st('M152 122 Q256 94 360 122')}${hi('M170 140 Q160 250 168 340')}`);

/* ---------- 腿部 ---------- */
icons.legs_cloth = `
  ${body('M138 70 H374 L420 448 H296 L256 214 L216 448 H92 Z', 'cloth')}
  <path d="M138 70 H374 V122 Q256 146 138 122 Z" fill="url(#g_clothD)" ${OL}/>
  <path d="M236 116 Q226 168 240 190 M276 116 Q286 168 272 190" stroke="#d9c7a0" stroke-width="7" fill="none" stroke-linecap="round"/>
  ${fold('M180 170 Q150 300 128 420')}${fold('M332 170 Q362 300 384 420')}${fold('M230 270 L216 410')}${fold('M282 270 L296 410')}
  <path d="M92 448 H216 L220 408 H98 Z" fill="url(#g_clothD)" ${OL}/><path d="M296 448 H420 L414 408 H292 Z" fill="url(#g_clothD)" ${OL}/>`;

/* ---------- 靴 ---------- */
icons.boots_straw = `
  ${[[110, 70, -6], [270, 90, 6]].map(([x, y, r]) => `<g transform="translate(${x} ${y}) rotate(${r} 60 190)">
    <path d="M30 70 Q60 20 100 70 L128 330 Q110 410 60 410 Q10 400 10 330 Z" fill="url(#g_straw)" ${OL}/>
    <clipPath id="sc${x}"><path d="M30 70 Q60 20 100 70 L128 330 Q110 410 60 410 Q10 400 10 330 Z"/></clipPath>
    <g clip-path="url(#sc${x})" stroke="#3b3010" stroke-opacity=".5" stroke-width="4">${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(i => `<path d="M0 ${60 + i * 28} L140 ${40 + i * 28}"/>`).join('')}</g>
    <path d="M24 110 Q60 190 56 150 Q60 190 96 110" fill="none" stroke="#120e0a" stroke-width="20" stroke-linecap="round"/>
    <path d="M24 110 Q58 200 96 110" fill="none" stroke="#8a6a2a" stroke-width="11" stroke-linecap="round"/>
    <path d="M60 180 V250" stroke="#8a6a2a" stroke-width="9"/></g>`).join('')}`;

const boot = (m, extra = '', under = '') => `${under}
  <path d="M158 70 H330 V300 Q430 316 452 384 V434 H130 V300 Z" fill="url(#g_${m})" ${OL}/>
  <path d="M130 410 H452 V448 H130 Z" fill="#1c130c" ${OL}/>
  <path d="M158 70 H330 V120 Q244 140 158 120 Z" fill="url(#g_${m})" ${OL} fill-opacity=".8"/>${fold('M158 120 Q244 142 330 120')}
  ${fold('M300 300 Q360 330 400 330')}${hi('M178 140 V280')}`;
icons.boots_leather = boot('leather', '', '') + `
  ${st('M244 130 V290')}
  ${[160, 200, 240].map(y => `<path d="M200 ${y} L290 ${y + 12}" stroke="#d9c7a0" stroke-width="7" stroke-linecap="round"/>`).join('')}
  <rect x="146" y="262" width="196" height="26" fill="#26140a" ${OL}/><rect x="226" y="258" width="34" height="34" rx="5" fill="none" stroke="#d9c7a0" stroke-width="6"/>`;
const wing = (flip) => {
  const s = flip ? -1 : 1, cx = flip ? 336 : 150;
  const X = (v) => cx + s * v;
  return `<path d="M${X(0)} 250 Q${X(-60)} 190 ${X(-110)} 140 Q${X(-70)} 190 ${X(-96)} 130 Q${X(-50)} 180 ${X(-62)} 112 Q${X(-24)} 170 ${X(0)} 200 Z" fill="#f2fffb" ${OL} transform="translate(${flip ? 0 : 0} 0)"/>`;
};
icons.boots_wind = boot('wind') + `
  ${[150, 200].map(y => `<path d="M200 ${y} L290 ${y + 10}" stroke="#10302c" stroke-width="7" stroke-linecap="round"/>`).join('')}
  ${wing(false)}
  <path d="M330 220 Q420 180 470 120 Q440 190 420 220 Q450 200 480 200 Q430 250 330 260 Z" fill="#f2fffb" ${OL}/>`;

/* ---------- 戒指 ---------- */
const ring = (m, gem) => `
  <ellipse cx="256" cy="290" rx="150" ry="140" fill="url(#g_${m})" ${OL}/>
  <ellipse cx="256" cy="290" rx="98" ry="92" fill="#0b0907" ${OL}/>
  <path d="M170 340 Q256 400 342 340 Q330 380 256 392 Q182 380 170 340Z" fill="#000" fill-opacity=".25"/>
  <ellipse cx="256" cy="290" rx="124" ry="116" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="5" stroke-dasharray="90 60"/>
  <ellipse cx="256" cy="290" rx="136" ry="128" fill="none" stroke="#000" stroke-opacity=".3" stroke-width="3" stroke-dasharray="6 14"/>${gem}`;
icons.ring_bronze = ring('bronze', '');
icons.ring_silver = ring('silver', `
  <path d="M256 128 L286 158 L256 188 L226 158 Z" fill="#9fd8ff" ${OL}/><path d="M256 128 L286 158 L256 158 Z" fill="#fff" fill-opacity=".7"/>`);

/* ---------- 項鍊 ---------- */
const loopPath = 'M120 70 C100 250 190 320 256 320 C322 320 412 250 392 70';
icons.amulet_wood = `
  <path d="${loopPath}" fill="none" stroke="#120e0a" stroke-width="18" stroke-linecap="round"/><path d="${loopPath}" fill="none" stroke="#9a7c43" stroke-width="9" stroke-linecap="round"/>
  <path d="M256 320 L256 340" stroke="#120e0a" stroke-width="14"/>
  <path d="M256 336 C320 336 352 380 340 430 C330 466 290 484 256 484 C222 484 182 466 172 430 C160 380 192 336 256 336 Z" fill="url(#g_wood)" ${OL}/>
  <path d="M256 370 C290 400 290 440 256 456 C222 440 222 400 256 370 Z" fill="none" stroke="#2a1809" stroke-width="8" stroke-linejoin="round"/><path d="M256 380 V448" stroke="#2a1809" stroke-width="6"/>
  ${hi('M200 392 Q210 366 236 354')}<circle cx="256" cy="344" r="9" fill="#120e0a"/>`;
icons.amulet_silver = `
  <path d="${loopPath}" fill="none" stroke="#120e0a" stroke-width="30" stroke-dasharray="26 3" stroke-linecap="round"/>
  <path d="${loopPath}" fill="none" stroke="url(#g_silver)" stroke-width="20" stroke-dasharray="22 7" stroke-linecap="round"/>
  <path d="${loopPath}" fill="none" stroke="#2c333a" stroke-width="7" stroke-dasharray="6 23" stroke-dashoffset="4"/>
  <circle cx="256" cy="352" r="16" fill="none" stroke="#120e0a" stroke-width="14"/><circle cx="256" cy="352" r="16" fill="none" stroke="url(#g_silver)" stroke-width="7"/>
  <circle cx="256" cy="420" r="62" fill="url(#g_silver)" ${OL}/><circle cx="256" cy="420" r="42" fill="#1c2128" ${OL}/>
  <path d="M256 388 L264 412 L288 420 L264 428 L256 452 L248 428 L224 420 L248 412 Z" fill="#9fd8ff" stroke="#120e0a" stroke-width="3"/>`;

const html = [];
for (const [name, g] of Object.entries(icons)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><defs>${defs()}</defs><g filter="url(#sh)">${g}</g></svg>`;
  fs.writeFileSync(path.join(OUT, 'icon_' + name + '.svg'), svg);
  html.push(name);
}
fs.writeFileSync(path.join(OUT, '_names.json'), JSON.stringify(html));
console.log('svg:', html.length);
