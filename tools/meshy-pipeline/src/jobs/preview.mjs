import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, ensureFolders } from '../core/config.mjs';
import { Ledger, checkBudget } from '../core/ledger.mjs';
import { MeshyClient } from '../providers/meshy/client.mjs';

// node src/jobs/preview.mjs <specFile> --approved --max-credits <n>
// Runs ONE text-to-3d preview task (paid). Reuses a cached task id instead of paying twice.
const args = process.argv.slice(2);
const specFile = args[0];
const approved = args.includes('--approved');
const maxCredits = Number(args[args.indexOf('--max-credits') + 1]);

if (!specFile || !approved || !Number.isFinite(maxCredits)) {
  console.error('usage: preview.mjs <spec.json> --approved --max-credits <n>  (paid; needs explicit user approval)');
  process.exit(1);
}

const cfg = loadConfig();
ensureFolders(cfg);
const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
const ledger = new Ledger(cfg);
const client = new MeshyClient(cfg);
const cacheFile = path.join(cfg.paths.assetsRoot, 'Cache', `${spec.id}.preview.json`);
const outDir = path.join(cfg.paths.assetsRoot, 'Models', spec.id);
fs.mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const estimate = Math.min(spec.meshy.estimatedCredits.preview, maxCredits);

let taskId;
const before = (await client.balance()).balance;
if (fs.existsSync(cacheFile)) {
  taskId = JSON.parse(fs.readFileSync(cacheFile, 'utf8')).taskId;
  console.log('cache hit, reusing task', taskId);
} else {
  const gate = checkBudget(cfg, ledger, spec.id, spec.meshy.estimatedCredits.preview);
  if (!gate.ok || spec.meshy.estimatedCredits.preview > maxCredits) {
    console.error('budget gate refused:', gate.reason || `estimate exceeds --max-credits ${maxCredits}`);
    process.exit(3);
  }
  taskId = (await client.createTextTo3d(spec.meshy.preview)).result;
  fs.writeFileSync(cacheFile, JSON.stringify({ taskId, createdAt: new Date().toISOString() }, null, 2));
  console.log('created task', taskId);
}

let task;
for (let i = 0; i < 120; i++) {
  task = await client.getTextTo3d(taskId);
  console.log(`status=${task.status} progress=${task.progress}`);
  if (['SUCCEEDED', 'FAILED', 'CANCELED'].includes(task.status)) break;
  await sleep(10000);
}
if (task.status !== 'SUCCEEDED') {
  ledger.record({ jobId: spec.id, stage: 'preview', taskId, status: task.status, actualCredits: 0, error: task.task_error?.message });
  console.error('task did not succeed:', task.status, task.task_error?.message || '');
  process.exit(4);
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}
await download(task.model_urls.glb, path.join(outDir, 'preview.glb'));
if (task.thumbnail_url) await download(task.thumbnail_url, path.join(outDir, 'preview.thumbnail.png'));

const after = (await client.balance()).balance;
ledger.record({
  jobId: spec.id, stage: 'preview', taskId, status: task.status,
  estimatedCredits: spec.meshy.estimatedCredits.preview,
  reportedCredits: task.consumed_credits, actualCredits: before - after, balanceBefore: before, balanceAfter: after,
});
console.log(`done. consumed_credits=${task.consumed_credits} balance ${before} -> ${after}`);
