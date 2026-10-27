import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, ensureFolders } from '../core/config.mjs';
import { Ledger, checkBudget } from '../core/ledger.mjs';
import { MeshyClient } from '../providers/meshy/client.mjs';

// node src/jobs/retexture.mjs <conceptsFile> <key> --approved --max-credits <n>
// Retextures the image-to-3D mesh of <key>, using concept image <key> as the style reference (paid).
const args = process.argv.slice(2);
const [file, key] = args;
const approved = args.includes('--approved');
const maxCredits = Number(args[args.indexOf('--max-credits') + 1]);

if (!file || !key || !approved || !Number.isFinite(maxCredits)) {
  console.error('usage: retexture.mjs <concepts.json> <key> --approved --max-credits <n>  (paid; needs explicit user approval)');
  process.exit(1);
}

const cfg = loadConfig();
ensureFolders(cfg);
const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
const { estimatedCredits, ...params } = spec.retexture;
const ledger = new Ledger(cfg);
const client = new MeshyClient(cfg);
const cacheDir = path.join(cfg.paths.assetsRoot, 'Cache');
const readCache = (name) => JSON.parse(fs.readFileSync(path.join(cacheDir, `${spec.id}.${name}.${key}.json`), 'utf8'));
const cacheFile = path.join(cacheDir, `${spec.id}.retexture.${key}.json`);
const outDir = path.join(cfg.paths.assetsRoot, 'Models', spec.id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const before = (await client.balance()).balance;
let taskId;
if (fs.existsSync(cacheFile)) {
  taskId = JSON.parse(fs.readFileSync(cacheFile, 'utf8')).taskId;
  console.log('cache hit, reusing task', taskId);
} else {
  const gate = checkBudget(cfg, ledger, spec.id, estimatedCredits);
  if (!gate.ok || estimatedCredits > maxCredits || before < maxCredits) {
    console.error('budget gate refused:', gate.reason || `estimate ${estimatedCredits} vs max ${maxCredits}, balance ${before}`);
    process.exit(3);
  }
  const meshTaskId = readCache('image3d').taskId;
  const styleUrl = (await client.getTextToImage(readCache('concept').taskId)).image_urls?.[0];
  if (!styleUrl) throw new Error('concept image url not available (expired?)');
  taskId = (await client.createRetexture({ ...params, input_task_id: meshTaskId, image_style_url: styleUrl })).result;
  fs.writeFileSync(cacheFile, JSON.stringify({ taskId, meshTaskId, createdAt: new Date().toISOString() }, null, 2));
  console.log('created task', taskId);
}

let task;
for (let i = 0; i < 120; i++) {
  task = await client.getRetexture(taskId);
  if (i % 3 === 0 || task.status !== 'IN_PROGRESS') console.log(`status=${task.status} progress=${task.progress}`);
  if (['SUCCEEDED', 'FAILED', 'CANCELED'].includes(task.status)) break;
  await sleep(10000);
}
if (task.status !== 'SUCCEEDED') {
  ledger.record({ jobId: spec.id, stage: `retexture-${key}`, taskId, status: task.status, actualCredits: 0, error: task.task_error?.message });
  console.error('task did not succeed:', task.status, task.task_error?.message || '');
  process.exit(4);
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}
await download(task.model_urls.glb, path.join(outDir, `textured_${key}.glb`));
if (task.thumbnail_url) await download(task.thumbnail_url, path.join(outDir, `textured_${key}.thumbnail.png`));
const base = task.texture_urls?.[0]?.base_color;
if (base) await download(base, path.join(cfg.paths.assetsRoot, 'Textures', `${spec.id}_${key}_base_color.png`));

const after = (await client.balance()).balance;
const spent = before - after;
ledger.record({
  jobId: spec.id, stage: `retexture-${key}`, taskId, status: task.status, estimatedCredits,
  reportedCredits: task.consumed_credits, actualCredits: spent, balanceBefore: before, balanceAfter: after,
});
console.log(`done. consumed_credits=${task.consumed_credits} balance ${before} -> ${after} (spent ${spent})${spent > maxCredits ? ' EXCEEDS MAX' : ''}`);
