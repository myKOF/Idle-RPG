'use strict';
// Original seamless liquid, authored in the collision plane; no reference pixels.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const repo = path.resolve(__dirname, '../../../..');
const assetId = 'codex-authored/poison-trail/flow.svg';
const FRAMES = 64, COLUMNS = 8, WIDTH = 512, HEIGHT = 128;
const FPS = 16, FLOW_TILE = WIDTH, EDGE_RIPPLE = .22;
const GEOMETRY = { length: 100, radius: 100 / 9, duration: 16, growSec: 3 };
const n = v => +v.toFixed(3) || 0;
// 固定的短距離岸邊凹凸，兩岸各取自己的種子；不拿它彎曲水道主軸。
function roughBankAt(x, side) {
  function noise(step, salt) {
    const count=Math.round(WIDTH/step),p=((x%WIDTH)+WIDTH)%WIDTH/WIDTH*count, i=Math.floor(p), k=p-i, smooth=k*k*(3-2*k);
    function value(j) { const h=Math.sin((j%count)*127.1+side*311.7+salt)*43758.5453;return (h-Math.floor(h))*2-1; }
    return value(i)+(value(i+1)-value(i))*smooth;
  }
  return (noise(9,17)*2.8+noise(21,63)*1.7)*1.10;
}
// 固定水窪形狀。動畫只擾動邊界，不能讓中心與寬度跟著相位改變。
function surfaceAt(x, frame = 0) {
  const q=x/WIDTH*Math.PI*2;
  const center = 64 + 1.4 * Math.sin(q*2) + .5 * Math.sin(q*5);
  const cap = 1;
  const radius = 43 + 1.7 * Math.sin(q*2) + .8 * Math.sin(q*5);
  const phase = frame / FRAMES * Math.PI * 2;
  const smoothUpper=center-radius*(1+.018*Math.sin(q*36));
  const smoothLower=center+radius*(1+.022*Math.sin(q*25+2));
  return {center, radius, smoothUpper, smoothLower,
    upper: smoothUpper + roughBankAt(x,0)*cap + EDGE_RIPPLE * cap * Math.sin(q*10 + phase),
    lower: smoothLower + roughBankAt(x,1)*cap + EDGE_RIPPLE * cap * Math.sin(q*7 + phase + 2)};
}
function flowOffset(frame) { return ((frame % FRAMES) + FRAMES) % FRAMES / FRAMES * FLOW_TILE; }
function liquidSVG() {
  const hash = i => { const v = Math.sin(i * 127.1 + 31.7) * 43758.5453; return v - Math.floor(v); };
  const pathOf = points => points.map((p, i) => (i ? 'L' : 'M') + p.map(n).join(' ')).join(' ') + 'Z';
  const cells = [];
  for (let f = 0; f < FRAMES; f++) {
    const phase = f / FRAMES * Math.PI * 2;
    const upper = [], lower = [];
    for (let i = 0; i <= 288; i++) {
      const x = -32 + i * 2, surface = surfaceAt(x, f);
      upper.push([x, surface.upper]); lower.unshift([x, surface.lower]);
    }
    const outline = pathOf([...upper, ...lower]);
    const clouds = [], eddies = [], foam = [];
    // Overlapping irregular stains, rather than parallel strokes down the whole arm.
    const colors = ['#aacb1b', '#78a91a', '#c5df32', '#4b7914', '#253c08', '#c1eb49'];
    for (let tile=-2;tile<=1;tile++) for (let j = 0; j < 32; j++) {
      const x = tile*WIDTH + hash(j + 17) * WIDTH + flowOffset(f);
      const y = 64 + (hash(j + 419) - .5) * 68;
      const rx = 15 + hash(j + 98) * 38, ry = 5 + hash(j + 229) * 17;
      if(x+rx < -16 || x-rx > WIDTH+16)continue;
      const points = [];
      for (let k = 0; k < 18; k++) {
        const a = k / 18 * Math.PI * 2, ripple = .74 + hash(j * 37 + k) * .35;
        points.push([x + Math.cos(a) * rx * ripple, y + Math.sin(a) * ry * ripple]);
      }
      clouds.push(`<path d="${pathOf(points)}" fill="${colors[j % colors.length]}" opacity="${n(.3 + hash(j + 811) * .42)}"/>`);
    }
    // 內流材質沿固定水路向外緩移；平移一個週期後圖樣無縫銜接，不往返搖擺。
    for (let tile = -2; tile <= WIDTH / FLOW_TILE; tile++) {
      for (let j = 0; j < 22; j++) {
        const x = tile * FLOW_TILE + hash(j + 51) * FLOW_TILE + flowOffset(f);
        const y = 64 + (hash(j + 121) - .5) * 68;
        const dx = 10 + hash(j + 32) * 23, bend = (hash(j + 441) - .5) * 19;
        if(x+dx < -16 || x > WIDTH+16)continue;
        eddies.push(`<path d="M${n(x)} ${n(y)}q${n(dx * .4)} ${n(bend)} ${n(dx)} ${n(bend * .2)}t${n(-dx * .3)} ${n(-bend * .7)}" fill="none" stroke="${j % 3 ? '#cae943' : '#314e0a'}" stroke-width="${n(3 + hash(j + 33) * 6)}" stroke-linecap="round" opacity=".42"/>`);
      }
    }
    for (let tile=-2;tile<=1;tile++) for (let j = 0; j < 40; j++) {
      const x = tile*WIDTH + hash(j + 225) * WIDTH + flowOffset(f);
      if(x < -16 || x > WIDTH+16)continue;
      const y = 64 + (j % 2 ? -1 : 1) * 43 * (.65 + hash(j + 41) * .3);
      foam.push(`<ellipse cx="${n(x)}" cy="${n(y + Math.sin(phase + j) * .12)}" rx="${n(.8 + hash(j + 19) * 2)}" ry="${n(.6 + hash(j + 16) * 1.5)}" fill="#c1eb49" opacity="${n(.2 + hash(j + 819) * .45)}"/>`);
    }
    cells.push(`<g transform="translate(${f % COLUMNS * WIDTH} ${Math.floor(f / COLUMNS) * HEIGHT})" clip-path="url(#cell)"><defs><clipPath id="c${f}"><path d="${outline}"/></clipPath></defs><path d="${outline}" fill="#75af15" opacity=".28" filter="url(#mist)"/><path d="${outline}" fill="url(#liquid)" opacity=".8" filter="url(#bank)"/><g clip-path="url(#c${f})"><g filter="url(#soft)">${clouds.join('')}${eddies.join('')}</g>${foam.join('')}</g></g>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH * COLUMNS}" height="${HEIGHT * FRAMES / COLUMNS}" viewBox="0 0 ${WIDTH * COLUMNS} ${HEIGHT * FRAMES / COLUMNS}"><defs><clipPath id="cell"><rect width="512" height="128"/></clipPath><filter id="bank" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation=".7"/></filter><filter id="soft" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="1.5"/></filter><filter id="mist" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="4.5"/></filter><linearGradient id="liquid" x2="0" y2="1"><stop stop-color="#5e8115" stop-opacity=".3"/><stop offset=".3" stop-color="#8eaf22"/><stop offset=".65" stop-color="#527b0d"/><stop offset="1" stop-color="#385d0d" stop-opacity=".3"/></linearGradient></defs>${cells.join('')}</svg>\n`;
}
function make() {
  const { length, radius, duration, growSec } = GEOMETRY, layers = [];
  for (let arm = 0; arm < 4; arm++) {
    const a = arm * Math.PI / 2, t = growSec / duration, tileLength=4*radius;
    for(let tile=0;tile<Math.ceil((length+2*radius)/tileLength);tile++) {
    const start=-radius+tile*tileLength, center=start+tileLength/2;
    layers.push({ id: 'flow-' + arm + '-' + tile, type: 'sprite', assetId, zIndex: arm,
      position: { x: Math.cos(a)*center, y: Math.sin(a)*center }, rotation: a, anchor: { x: .5, y: .5 },
      scale: { x: tileLength / WIDTH, y: 2 * radius / HEIGHT },
      revealXOverLife: [[0,(radius-start)/tileLength],[t,(length+radius-start)/tileLength],[1,(length+radius-start)/tileLength]],
      revealRadius: radius/tileLength, revealStartRadius: tile===0?radius/tileLength:0,
      alpha: .95, blendMode: 'normal', duration,
      projection: { x: 1, y: .5 },
      sheet: { columns: COLUMNS, rows: FRAMES / COLUMNS, count: FRAMES, mode: 'fps', fps: FPS, loop: true }
    });
    }
  }
  return { schemaVersion: 1, id: 'en-poison-cross', duration, loop: false,
    sizing: { authored: { radius: length }, shape: 'circle' }, layers };
}
function writeSource() {
  const root = require('../../vfx-library-root.cjs').resolveLibraryRoot().root;
  const folder = path.join(root, 'codex-authored/poison-trail'), svg = liquidSVG();
  fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(path.join(root, assetId), svg);
  fs.writeFileSync(path.join(folder, 'SOURCE.md'), "# 毒素加持：無縫接段與表面內流\n\n2026-10-22 Codex 原創SVG，64格／16fps／4秒循環。附件僅用於觀察狹長水道、適度不平整岸邊與流動明暗，沒有複製／描摹／挪用參考像素。Mote Studio已確認PNG／sheet／GIF匯出，不支援此原生SVG；沿用專案向量作者。\n\n每臂3段固定比例貼圖，岸邊形狀／材質首尾週期相同；UV與網格頂點同步裁切顯露，已鋪部分不伸縮，前端延伸到下一段。前端／根部圓收，內部接縫無重疊透明度或重播閃爍。四臂共用一張16MiB RGBA圖集，12節點、零粒子。\n\n主要明暗團塊、流紋與細泡沫均單向平移；4秒流過一個完整短段（正式尺寸每秒40世界單位，伸展速度仍120）。整體水道近直線，兩岸固定細碎凹凸振幅依使用者要求較已認可接段版微增10%（乘1.10），空間頻率／種子不變；另加原有0.22材質像素微擾，沒有整條蛇行／呼吸。材質相位與前端生長獨立，續送事件不重播。\n\n表定長度／半寬／速度／壽命與判定保持，非正式素材未加入遊戲。重製：node tools/vfx/authoring/author/poison-trail.cjs；node tools/vfx/export-assets.cjs。\n");
  const scanner = require('../../asset-scanner.cjs'), file = path.join(repo, 'vfx/asset-index.json');
  const index = JSON.parse(fs.readFileSync(file)), bytes = Buffer.from(svg);
  const entry = { assetId, package: scanner.derivePackage(assetId), relativePath: assetId, format: 'svg',
    fileSize: bytes.length, contentHash: 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex'),
    facts: require('../../vfx-image-facts.cjs').svgFacts(bytes) };
  const at = index.assets.findIndex(a => a.assetId === assetId);
  if (at < 0) index.assets.push(entry); else index.assets[at] = entry;
  index.assets.sort((a, b) => a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0);
  index.assetCount = index.assets.length; fs.writeFileSync(file, scanner.serialise(index));
  return folder;
}
if (require.main === module) {
  const folder = writeSource(); require('../preset-kit.cjs').write(make());
  for (const kind of ['presets', 'layouts']) {
    fs.mkdirSync(path.join(folder, kind), { recursive: true });
    fs.copyFileSync(path.join(repo, 'vfx', kind, 'en-poison-cross.json'), path.join(folder, kind, 'en-poison-cross.json'));
  }
  console.log('en-poison-cross：原創連續毒水已保存，待正式匯出');
}
module.exports = { make, liquidSVG, surfaceAt, roughBankAt, flowOffset, assetId, GEOMETRY, FRAMES, COLUMNS, WIDTH, HEIGHT, FPS, FLOW_TILE, EDGE_RIPPLE };
