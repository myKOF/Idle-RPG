#!/usr/bin/env node
/**
 * 《神力之巔》序章前 30 秒 — 電影級復刻一鍵幀級精準合成腳本
 *
 * 使用方式：
 *   1. 將 4 支 Gemini 生成的影片放入 opening_animation/cinematic_30s_pack/clips_input/：
 *        - clip_01_shot1a.mp4
 *        - clip_02_shot1b.mp4
 *        - clip_03_shot2a.mp4
 *        - clip_04_shot2b.mp4
 *   2. 執行：node opening_animation/cinematic_30s_pack/assemble_30s.mjs
 *   3. 輸出：opening_animation/cinematic_30s_pack/output_30s_cinematic.mp4
 *      （1920×1080、30 fps、精準 900 幀 / 30.000 秒 + 原片前 30 秒 BGM 音軌）
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
const OUTPUT_VIDEO = path.join(__dirname, 'output_30s_cinematic.mp4');

const REQUIRED_CLIPS = [
  'clip_01_shot1a.mp4',
  'clip_02_shot1b.mp4',
  'clip_03_shot2a.mp4',
  'clip_04_shot2b.mp4',
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

  // 29 幀 @ 30fps = 0.966667s（對齊手冊 00:16.000–00:16.950 / 幀 480–508）
  const xfadeDur = (29 / 30).toFixed(6);
  const clip2Dur = (8 + 29 / 30).toFixed(6);

  const filterComplex = [
    `[0:v]${normFilter},tpad=stop_mode=clone:stop_duration=2,trim=duration=8.000,setpts=PTS-STARTPTS,settb=1/30[v0]`,
    `[1:v]${normFilter},tpad=stop_mode=clone:stop_duration=2,trim=duration=${clip2Dur},setpts=PTS-STARTPTS,settb=1/30[v1]`,
    `[2:v]${normFilter},tpad=stop_mode=clone:stop_duration=2,trim=duration=7.000,setpts=PTS-STARTPTS,settb=1/30[v2]`,
    `[3:v]${normFilter},tpad=stop_mode=clone:stop_duration=2,trim=duration=7.000,setpts=PTS-STARTPTS,settb=1/30[v3]`,
    `[v0][v1]concat=n=2:v=1:a=0,fps=30,settb=1/30[v01]`,
    `[v01][v2]xfade=transition=fade:duration=${xfadeDur}:offset=16.000,fps=30,settb=1/30[v012]`,
    `[v012][v3]concat=n=2:v=1:a=0,trim=duration=30.000,setpts=PTS-STARTPTS[vout]`,
    `[4:a]aresample=48000,atrim=duration=30.000,asetpts=PTS-STARTPTS,volume=1.0[asfx]`,
    `[5:a]aresample=48000,atrim=duration=30.000,asetpts=PTS-STARTPTS,volume=0.75[abgm]`,
    `[asfx][abgm]amix=inputs=2:duration=shortest:normalize=0,afade=t=out:st=29.5:d=0.5[aout]`,
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

  console.log('開始合成 30 秒電影級復刻版...');
  const result = spawnSync('ffmpeg', args, { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`[錯誤] ffmpeg 合成失敗（exit code ${result.status}）。`);
    process.exit(result.status ?? 1);
  }

  console.log(`合成完成：${OUTPUT_VIDEO}`);
}

main();
