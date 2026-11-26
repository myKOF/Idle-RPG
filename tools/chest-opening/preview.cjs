'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

// GIF players can stretch 10 ms frames. Drop intermediate samples, preserving
// elapsed time and the boundary where the completed lid/rewards first appear.
function coalesceShortFrames(frames) {
  const result = [];
  let pending = null;
  function finishShortRun() {
    if (!pending) return;
    if (!result.length) throw Error('Cannot represent a leading frame shorter than 20 ms');
    result[result.length - 1].duration += pending.duration;
    pending = null;
  }
  for (const frame of frames) {
    if (!frame.file || !Number.isInteger(frame.duration) || frame.duration <= 0 || frame.duration % 10) {
      throw Error('GIF frames require a file and a positive duration in 10 ms units');
    }
    if (frame.duration >= 20) {
      finishShortRun();
      result.push({ ...frame });
    } else {
      if (!pending) pending = { ...frame };
      else pending.duration += frame.duration;
      if (pending.duration >= 20) {
        result.push(pending);
        pending = null;
      }
    }
  }
  finishShortRun();
  if (!result.length) throw Error('No frames to encode');
  return result;
}

function encode(input, output) {
  const inputPath = path.resolve(input), outputPath = path.resolve(output);
  const frames = coalesceShortFrames(JSON.parse(fs.readFileSync(inputPath, 'utf8')));
  const lines = ['ffconcat version 1.0'];
  for (const frame of frames) {
    const file = path.resolve(path.dirname(inputPath), frame.file).replace(/\\/g, '/');
    if (/[\r\n']/.test(file)) throw Error('Unsupported frame path: ' + file);
    if (!fs.statSync(file).isFile()) throw Error('Missing frame: ' + file);
    lines.push("file '" + file + "'", 'option framerate 100', 'duration ' + frame.duration / 1000);
  }
  const concat = path.join(path.dirname(inputPath), 'preview-safe.ffconcat');
  fs.writeFileSync(concat, lines.join('\n') + '\n');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const encoded = cp.spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', concat,
    '-filter_complex', '[0:v]scale=720:480:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff:reserve_transparent=0[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
    '-fps_mode', 'vfr', '-loop', '0', '-final_delay', String(frames.at(-1).duration / 10), outputPath
  ], { stdio: 'inherit', windowsHide: true });
  if (encoded.error) throw encoded.error;
  if (encoded.status !== 0) throw Error('GIF encoding failed');
  const report = { frames: frames.length, durationMs: frames.reduce((sum, frame) => sum + frame.duration, 0), minDelayMs: Math.min(...frames.map(frame => frame.duration)) };
  fs.writeFileSync(outputPath + '.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  return report;
}

if (require.main === module) {
  if (process.argv.length !== 4) throw Error('Usage: node tools/chest-opening/preview.cjs CAPTURE_FRAMES_JSON OUTPUT_GIF');
  encode(process.argv[2], process.argv[3]);
}
module.exports = { coalesceShortFrames };
