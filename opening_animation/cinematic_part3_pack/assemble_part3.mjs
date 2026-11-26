#!/usr/bin/env node
/**
 * 《神力之巔》序章第三部終章（01:09.50 – 01:54.40 / Shot 04 + Shot 05）— 一鍵幀級精準合成腳本
 *
 * 使用方式：
 *   1. 將 4 支 Gemini 生成的影片放入 opening_animation/cinematic_part3_pack/clips_input/：
 *        - clip_09_shot4a.mp4
 *        - clip_10_shot4b.mp4
 *        - clip_11_shot4c.mp4
 *        - clip_12_shot5.mp4
 *   2. 執行：node opening_animation/cinematic_part3_pack/assemble_part3.mjs
 *   3. 輸出：opening_animation/cinematic_part3_pack/output_part3_cinematic.mp4
 *      （1920×1080、30 fps、精準 34.000 秒 / 1020 幀 + 原片終章音效與 BGM，尾段 3 秒同步淡黑淡出）
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
const OUTPUT_VIDEO = path.join(__dirname, 'output_part3_cinematic.mp4');

const REQUIRED_CLIPS = [
  'clip_09_shot4a.mp4',
  'clip_10_shot4b.mp4',
  'clip_11_shot4c.mp4',
  'clip_12_shot5.mp4',
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

  // 時間軸（全長 34.000s / 1020 幀 @ 30fps）：
  // v0 (Clip 09): 8.500s（0.5s 白金柔光淡入，銜接 Part 2 結尾金光）
  // v1 (Clip 10): 8.500s（於 8.000s 處 0.500s 跨溶解 -> 累計 16.500s）
  // v2 (Clip 11): 8.500s（於 16.000s 處 0.500s 跨溶解 -> 累計 24.500s）
  // v3 (Clip 12): 10.000s（於 24.000s 處 0.500s 跨溶解 -> 累計 34.000s，最後 3.0s 淡出至全黑）
  const filterComplex = [
    `[0:v]${normFilter},tpad=stop_mode=clone:stop_duration=2,trim=duration=8.500,setpts=PTS-STARTPTS,fade=t=in:st=0:d=0.5:color=white,settb=1/30[v0]`,
    `[1:v]${normFilter},tpad=stop_mode=clone:stop_duration=2,trim=duration=8.500,setpts=PTS-STARTPTS,settb=1/30[v1]`,
    `[2:v]${normFilter},tpad=stop_mode=clone:stop_duration=2,trim=duration=8.500,setpts=PTS-STARTPTS,settb=1/30[v2]`,
    `[3:v]${normFilter},tpad=stop_mode=clone:stop_duration=2,trim=duration=10.000,setpts=PTS-STARTPTS,settb=1/30[v3]`,
    `[v0][v1]xfade=transition=fade:duration=0.500:offset=8.000,fps=30,settb=1/30[v01]`,
    `[v01][v2]xfade=transition=fade:duration=0.500:offset=16.000,fps=30,settb=1/30[v012]`,
    `[v012][v3]xfade=transition=fade:duration=0.500:offset=24.000,fps=30,trim=duration=34.000,setpts=PTS-STARTPTS,fade=t=out:st=31.0:d=3.0[vout]`,
    `[4:a]aresample=48000,atrim=start=70.500:duration=34.000,asetpts=PTS-STARTPTS,volume=1.0[asfx]`,
    `[5:a]aresample=48000,atrim=start=70.500:duration=34.000,asetpts=PTS-STARTPTS,volume=0.75[abgm]`,
    `[asfx][abgm]amix=inputs=2:duration=shortest:normalize=0,afade=t=in:st=0:d=0.3,afade=t=out:st=31.0:d=3.0[aout]`,
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

  console.log('開始合成第三部終章（Shot 04 + Shot 05，34.0 秒）電影級復刻版...');
  const result = spawnSync('ffmpeg', args, { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`[錯誤] ffmpeg 合成失敗（exit code ${result.status}）。`);
    process.exit(result.status ?? 1);
  }

  console.log(`合成完成：${OUTPUT_VIDEO}`);
}

main();
