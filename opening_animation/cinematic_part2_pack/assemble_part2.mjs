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

  // 時間軸（全長 26.000s / 780 幀 @ 30fps）：
  // v0 (Clip 05): 僅取前 8.000s（0.6s 黑幕淡入，於 8.5s 光柱出現前切出，避免與 Clip 06 重複降下兩道光柱）
  // v1 (Clip 06): 9.500s（於 7.600s 處 0.400s 跨溶解 -> 累計 17.100s，降下唯一光柱並俯衝進入荒漠沙塵）
  // v2 (Clip 08): 9.500s（於 16.500s 處 0.600s 跨溶解直接由荒漠沙塵切進大天使長近景 -> 累計 26.000s）
  const filterComplex = [
    `[0:v]${normFilter},tpad=stop_mode=clone:stop_duration=2,trim=duration=8.000,setpts=PTS-STARTPTS,fade=t=in:st=0:d=0.6,settb=1/30[v0]`,
    `[1:v]${normFilter},tpad=stop_mode=clone:stop_duration=2,trim=duration=9.500,setpts=PTS-STARTPTS,settb=1/30[v1]`,
    `[2:v]${normFilter},tpad=stop_mode=clone:stop_duration=2,trim=duration=9.500,setpts=PTS-STARTPTS,settb=1/30[v2]`,
    `[v0][v1]xfade=transition=fade:duration=0.400:offset=7.600,fps=30,settb=1/30[v01]`,
    `[v01][v2]xfade=transition=fade:duration=0.600:offset=16.500,fps=30,trim=duration=26.000,setpts=PTS-STARTPTS[vout]`,
    `[3:a]aresample=48000,atrim=start=34.000:duration=26.000,asetpts=PTS-STARTPTS,volume=1.0[asfx]`,
    `[4:a]aresample=48000,atrim=start=34.000:duration=26.000,asetpts=PTS-STARTPTS,volume=0.75[abgm]`,
    `[asfx][abgm]amix=inputs=2:duration=shortest:normalize=0,afade=t=in:st=0:d=0.3,afade=t=out:st=25.5:d=0.5[aout]`,
  ].join(';');

  const args = [
    '-y',
    '-i', inputs[0],
    '-i', inputs[1],
    '-i', inputs[2],
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
