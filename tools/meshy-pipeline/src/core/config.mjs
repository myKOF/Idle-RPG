import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function findBlender() {
  const base = 'C:\\Program Files\\Blender Foundation';
  if (!fs.existsSync(base)) return null;
  const dirs = fs.readdirSync(base).filter((d) => d.startsWith('Blender')).sort();
  for (const d of dirs.reverse()) {
    const exe = path.join(base, d, 'blender.exe');
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

function findFfmpeg() {
  const pkgs = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  if (!fs.existsSync(pkgs)) return null;
  for (const d of fs.readdirSync(pkgs).filter((n) => n.startsWith('Gyan.FFmpeg'))) {
    const root = path.join(pkgs, d);
    for (const sub of fs.readdirSync(root)) {
      const exe = path.join(root, sub, 'bin', 'ffmpeg.exe');
      if (fs.existsSync(exe)) return exe;
    }
  }
  return null;
}

export function loadConfig(file = path.join(ROOT, 'config', 'pipeline.config.json')) {
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const baseDir = path.dirname(file);
  const resolve = (p) => (path.isAbsolute(p) ? p : path.resolve(baseDir, p));
  cfg.root = ROOT;
  cfg.paths.assetsRoot = resolve(process.env.PIPELINE_ASSETS_ROOT || cfg.paths.assetsRoot);
  cfg.paths.blender = process.env.BLENDER_EXE || (cfg.paths.blender === 'auto' ? findBlender() : resolve(cfg.paths.blender));
  cfg.paths.ffmpeg = process.env.FFMPEG_EXE || (cfg.paths.ffmpeg === 'auto' ? findFfmpeg() : resolve(cfg.paths.ffmpeg));
  return cfg;
}

export function ensureFolders(cfg) {
  for (const f of cfg.folders) fs.mkdirSync(path.join(cfg.paths.assetsRoot, f), { recursive: true });
}
