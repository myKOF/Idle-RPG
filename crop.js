const Jimp = require('jimp');

const bossNames = [
  'boss_flame.png',
  'boss_ice.png',
  'boss_thunder.png',
  'boss_iron.png',
  'boss_poison.png',
  'boss_abyss.png',
  'boss_dragon.png',
  'boss_light.png',
  'boss_storm.png',
  'boss_chaos.png'
];

async function run() {
  try {
    const img = await Jimp.read('images/BOSS_avatar_10.png');
    const w = img.bitmap.width;
    const h = img.bitmap.height;
    console.log(`Image size: ${w}x${h}`);
    
    // User specified grid
    let cols = 5;
    let rows = 2;
    
    const cropW = Math.floor(w / cols);
    const cropH = Math.floor(h / rows);
    console.log(`Grid: ${cols}x${rows}, size per icon: ${cropW}x${cropH}`);
    
    let idx = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (idx >= bossNames.length) break;
        const x = c * cropW;
        const y = r * cropH;
        const outName = 'images/' + bossNames[idx];
        const clone = img.clone();
        clone.crop(x, y, cropW, cropH);
        await clone.writeAsync(outName);
        console.log('Saved', outName);
        idx++;
      }
    }
    console.log('Done.');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();
