import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, ensureFolders } from '../core/config.mjs';
import { Ledger } from '../core/ledger.mjs';
import { MeshyClient } from '../providers/meshy/client.mjs';

// node src/jobs/concept.mjs <conceptsFile> <key> --approved --max-credits <n>
// Runs ONE text-to-image task (paid). Reuses a cached task id instead of paying twice.
const args = process.argv.slice(2);
const [file, key] = args;
const approved = args.includes('--approved');
const maxCredits = Number(args[args.indexOf('--max-credits') + 1]);

if (!file || !key || !approved || !Number.isFinite(maxCredits)) {
  console.error('usage: concept.mjs <concepts.json> <key> --approved --max-credits <n>  (paid; needs explicit user approval)');
  process.exit(1);
}

const cfg = loadConfig();
ensureFolders(cfg);
const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
const concept = spec.concepts[key];
if (!concept) throw new Error(`unknown concept ${key}`);
const ledger = new Ledger(cfg);
const client = new MeshyClient(cfg);
const cacheFile = path.join(cfg.paths.assetsRoot, 'Cache', `${spec.id}.concept.${key}.json`);
const outDir = path.join(cfg.paths.assetsRoot, 'Models', spec.id);
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const before = (await client.balance()).balance;
if (before < maxCredits) throw new Error(`balance ${before} below max ${maxCredits}`);

let taskId;
if (fs.existsSync(cacheFile)) {
  taskId = JSON.parse(fs.readFileSync(cacheFile, 'utf8')).taskId;
  console.log('cache hit, reusing task', taskId);
} else {
  taskId = (await client.createTextToImage({ ...spec.common, prompt: concept.prompt })).result;
  fs.writeFileSync(cacheFile, JSON.stringify({ taskId, createdAt: new Date().toISOString() }, null, 2));
  console.log('created task', taskId);
}

let task;
for (let i = 0; i < 60; i++) {
  task = await client.getTextToImage(taskId);
  console.log(`status=${task.status} progress=${task.progress}`);
  if (['SUCCEEDED', 'FAILED', 'CANCELED'].includes(task.status)) break;
  await sleep(5000);
}
if (task.status !== 'SUCCEEDED') {
  ledger.record({ jobId: spec.id, stage: `concept-${key}`, taskId, status: task.status, actualCredits: 0, error: task.task_error?.message });
  console.error('task did not succeed:', task.status, task.task_error?.message || '');
  process.exit(4);
}

const res = await fetch(task.image_urls[0]);
if (!res.ok) throw new Error(`download ${res.status}`);
fs.writeFileSync(path.join(outDir, `concept_${key}.png`), Buffer.from(await res.arrayBuffer()));

const after = (await client.balance()).balance;
const spent = before - after;
ledger.record({
  jobId: spec.id, stage: `concept-${key}`, taskId, status: task.status, model: spec.common.ai_model,
  reportedCredits: task.consumed_credits, actualCredits: spent, balanceBefore: before, balanceAfter: after,
});
console.log(`done. consumed_credits=${task.consumed_credits} balance ${before} -> ${after} (spent ${spent})${spent > maxCredits ? ' EXCEEDS MAX' : ''}`);
