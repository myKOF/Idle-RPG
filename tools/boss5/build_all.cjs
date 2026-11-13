'use strict';
/* 重建 BOSS5（鬼面）模型、動作與預覽。
   node tools/boss5/build_all.cjs <BOSS5.glb 原始模型> <輸出資料夾> [--previews]
   產出：boss5.glb（綁骨 + 5 動作 Walk/Attack1/Attack2/Attack3/Die，含 6 m 衝撞位移）、boss5_game.glb（遊戲用：水平位移固定、碎片散布限制在 NPC 畫布內）、boss5_oni.png（頭像）、boss5_skull.glb（綠色小骷髏子彈）、
        boss5_dome_albedo.png（補上的後腦貼圖）；--previews 另外渲染五個預覽 GIF。
   需要 Blender 4.5+（環境變數 BLENDER_EXE 可指定）與 Chrome（預覽用，CHROME_EXE 可指定）。 */
const path = require('path'), fs = require('fs'), cp = require('child_process');
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const [src, outDir] = args;
if (!src || !outDir) { console.error('用法：node tools/boss5/build_all.cjs <BOSS5.glb> <輸出資料夾> [--previews]'); process.exit(2); }
const BLENDER = process.env.BLENDER_EXE || ['C:/Program Files/Blender Foundation/Blender 5.2/blender.exe', 'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe'].find(p => fs.existsSync(p));
if (!BLENDER) { console.error('找不到 Blender，請設定 BLENDER_EXE'); process.exit(2); }
const here = __dirname, out = path.resolve(outDir), tmp = path.join(out, '_work');
fs.mkdirSync(tmp, { recursive: true });
const run = (cmd, a) => { console.log('>', path.basename(cmd), a.join(' ').slice(0, 160)); const r = cp.spawnSync(cmd, a, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 1 << 28 }); const text = (r.stdout || '') + (r.stderr || ''); if (r.status !== 0 || /Traceback|Error: /.test(text)) { console.error(text.slice(-3000)); process.exit(1); } return text; };
const blender = (script, ...a) => run(BLENDER, ['-b', '-P', path.join(here, script), '--', ...a]);
const f = (p) => p.split(path.sep).join('/');
blender('render_front.py', f(path.resolve(src)), f(path.join(tmp, 'front_albedo.png')));
blender('build_dome.py', f(path.resolve(src)), f(path.join(tmp, 'front_albedo.png')), f(path.join(tmp, 's1')), '0.55');
fs.copyFileSync(path.join(tmp, 's1', 'boss5_dome_albedo.png'), path.join(out, 'boss5_dome_albedo.png'));
blender('build_rig.py', f(path.join(tmp, 's1', 'stage1.blend')), f(path.join(out, 'boss5.glb')));
blender('build_rig.py', f(path.join(tmp, 's1', 'stage1.blend')), f(path.join(out, 'boss5_game.glb')), '--game');
blender('render_portrait.py', f(path.join(out, 'boss5_game.glb')), f(path.join(out, 'boss5_oni.png')));
blender('build_skull.py', f(path.join(tmp, 's1', 'stage1.blend')), f(path.join(out, 'boss5_skull.glb')));
if (process.argv.includes('--previews')) {
  for (const [clip, gif] of [['Walk', 'boss5_walk.gif'], ['Attack1', 'boss5_attack1.gif'], ['Attack2', 'boss5_attack2.gif'], ['Attack3', 'boss5_attack3.gif'], ['Die', 'boss5_die.gif']]) {
    const r = cp.spawnSync(process.execPath, [path.join(here, 'capture.cjs'), clip, path.join(out, gif)], { stdio: 'inherit', env: { ...process.env, BOSS5_ASSETS: out, DITHER: '0' } });
    if (r.status !== 0) process.exit(r.status || 1);
  }
}
console.log('完成：', out);
