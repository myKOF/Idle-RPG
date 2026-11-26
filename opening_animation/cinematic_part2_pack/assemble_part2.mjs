#!/usr/bin/env node
/**
 * 《神力之巔》序章第二段（00:34.00 – 01:09.50，35.5 秒 / Shot 03 完整段）— 一鍵幀級精準合成腳本
 *
 * 使用方式：
 *   1. 將 4 支 Gemini 生成的影片放入 opening_animation/cinematic_part2_pack/clips_input/：
 *        - clip_05_shot3a.mp4
 *        - clip_06_shot3b.mp4
 *        - clip_07_shot3c.mp4
 *        - clip_08_shot3d.mp4
 *   2. 執行：node opening_animation/cinematic_part2_pack/assemble_part2.mjs
 *   3. 輸出：opening_animation/cinematic_part2_pack/output_part2_cinematic.mp4
 *      （1920×1080、30 fps、精準 1065 幀 / 35.500 秒 + 原片 00:34.00–01:09.50 音效與 BGM）
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLIPS_DIR = path.join(__dirname, 'clips_input');
const ORIGINAL_SFX = path.resolve(__dirname, '..', 'shots-01-05-replay-sfx.mp3');
const ORIGINAL_BGM = path.resolve(__dirname, '..', '..', 'audio', 'zones', 'desert-ascendant.mp3');
const OUTPUT_VIDEO = path.join(__dirname, 'output_part2_cinematic.mp4');

const REQUIRED_CLIPS = [
  'clip_05_shot3a.mp4',
  'clip_06_shot3b.mp4',
  'clip_07_shot3c.mp4',
  'clip_08_shot3d.mp4',
];

function checkPrerequisites() {
  const ff = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  if (ff.error || ff.status !== 0) {
    console.error('[錯誤] 找不到 ffmpeg，請先安裝 ffmpeg 並確認已加入 PATH。');
    process.exit(1);
  }

  if (!fs.existsSync(ORIGINAL_SFX)) {
    console.error(`[錯誤] 找不到原片音效檔：${ORIGINAL_SFX}`);
    process.exit(1);
  }

  if (!fs.existsSync(ORIGINAL_BGM)) {
    console.error(`[錯誤] 找不到原片 BGM 檔：${ORIGINAL_BGM}`);
    process.exit(1);
  }

  const missing = REQUIRED_CLIPS.filter((name) => !fs.existsSync(path.join(CLIPS_DIR, name)));
  if (missing.length > 0) {
    console.error('[錯誤] clips_input 缺少以下影片檔案：');
    for (const name of missing) {
      console.error(`  - ${path.join(CLIPS_DIR, name)}`);
    }
    process.exit(1);
  }
}

function main() {
  checkPrerequisites();

  const inputs = REQUIRED_CLIPS.map((name) => path.join(CLIPS_DIR, name));
  const normFilter =
    'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30,format=yuv420p,setsar=1';

  // 時間軸（全長 29.200s / 876 幀 @ 30fps）：
  // v0 (Clip 05): 9.500s (0.6s 黑幕淡入)
  // v1 (Clip 06): 9.500s (於 9.000s 處 0.500s 跨溶解 -> 累計 18.500s)
  // v2 (Clip 07): 僅取前 2.200s 煙塵散去（於 18.000s 處 0.500s 跨溶解 -> 累計 20.200s），避免重複構圖與後段異常肢體
  // v3 (Clip 08): 9.500s 近景焦羽落胸與金光爆發（於 19.700s 處 0.500s 跨溶解 -> 累計 29.200s）
  const filterComplex = [
    `[0:v]${normFilter},tpad=stop_mode=clone:stop_duration=2,trim=duration=9.500,setpts=PTS-STARTPTS,fade=t=in:st=0:d=0.6,settb=1/30[v0]`,
    `[1:v]${normFilter},tpad=stop_mode=clone:stop_duration=2,trim=duration=9.500,setpts=PTS-STARTPTS,settb=1/30[v1]`,
    `[2:v]${normFilter},tpad=stop_mode=clone:stop_duration=2,trim=duration=2.200,setpts=PTS-STARTPTS,settb=1/30[v2]`,
    `[3:v]${normFilter},tpad=stop_mode=clone:stop_duration=2,trim=duration=9.500,setpts=PTS-STARTPTS,settb=1/30[v3]`,
    `[v0][v1]xfade=transition=fade:duration=0.500:offset=9.000,fps=30,settb=1/30[v01]`,
    `[v01][v2]xfade=transition=fade:duration=0.500:offset=18.000,fps=30,settb=1/30[v012]`,
    `[v012][v3]xfade=transition=fade:duration=0.500:offset=19.700,fps=30,trim=duration=29.200,setpts=PTS-STARTPTS[vout]`,
    `[4:a]aresample=48000,atrim=start=34.000:duration=29.200,asetpts=PTS-STARTPTS,volume=1.0[asfx]`,
    `[5:a]aresample=48000,atrim=start=34.000:duration=29.200,asetpts=PTS-STARTPTS,volume=0.75[abgm]`,
    `[asfx][abgm]amix=inputs=2:duration=shortest:normalize=0,afade=t=in:st=0:d=0.3,afade=t=out:st=28.7:d=0.5[aout]`,
  ].join(';');

  const args = [
    '-y',
    '-i', inputs[0],
    '-i', inputs[1],
    '-i', inputs[2],
    '-i', inputs[3],
    '-i', ORIGINAL_SFX,
    '-i', ORIGINAL_BGM,
    '-filter_complex', filterComplex,
    '-map', '[vout]',
    '-map', '[aout]',
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-r', '30',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    OUTPUT_VIDEO,
  ];

  console.log('開始合成第二段（00:34.00 – 01:09.50，35.5 秒）電影級復刻版...');
  const result = spawnSync('ffmpeg', args, { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`[錯誤] ffmpeg 合成失敗（exit code ${result.status}）。`);
    process.exit(result.status ?? 1);
  }

  console.log(`合成完成：${OUTPUT_VIDEO}`);
}

main();
