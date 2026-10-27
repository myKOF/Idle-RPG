import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, ensureFolders } from '../core/config.mjs';
import { Ledger, checkBudget } from '../core/ledger.mjs';
import { MeshyClient } from '../providers/meshy/client.mjs';

// node src/jobs/animate.mjs <conceptsFile> <key> --approved --max-credits <n>
// ONE animation task with several library actions merged into one file, clips in array order (paid).
const args = process.argv.slice(2);
const [file, key] = args;
const approved = args.includes('--approved');
const maxCredits = Number(args[args.indexOf('--max-credits') + 1]);
const tag = args.includes('--tag') ? '.' + args[args.indexOf('--tag') + 1] : ''; // separate task per clip set

if (!file || !key || !approved || !Number.isFinite(maxCredits)) {
  console.error('usage: animate.mjs <concepts.json> <key> --approved --max-credits <n>  (paid; needs explicit user approval)');
  process.exit(1);
}

const cfg = loadConfig();
ensureFolders(cfg);
const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
const { clips, estimatedCredits } = tag ? spec.animate.sets[tag.slice(1)] : spec.animate.sets.v1;
const ledger = new Ledger(cfg);
const client = new MeshyClient(cfg);
const cacheDir = path.join(cfg.paths.assetsRoot, 'Cache');
const cacheFile = path.join(cacheDir, `${spec.id}.animate.${key}${tag}.json`);
const rigTaskId = JSON.parse(fs.readFileSync(path.join(cacheDir, `${spec.id}.rig.${key}.json`), 'utf8')).taskId;
const outDir = path.join(cfg.paths.assetsRoot, 'Animations', spec.id);
fs.mkdirSync(outDir, { recursive: true });
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
  taskId = (await client.createAnimation({ rig_task_id: rigTaskId, action_ids: clips.map((c) => c.action_id) })).result;
  fs.writeFileSync(cacheFile, JSON.stringify({ taskId, rigTaskId, clips, createdAt: new Date().toISOString() }, null, 2));
  console.log('created task', taskId);
}

let task;
for (let i = 0; i < 120; i++) {
  task = await client.getAnimation(taskId);
  if (i % 3 === 0 || task.status !== 'IN_PROGRESS') console.log(`status=${task.status} progress=${task.progress}`);
  if (['SUCCEEDED', 'FAILED', 'CANCELED'].includes(task.status)) break;
  await sleep(10000);
}
if (task.status !== 'SUCCEEDED') {
  ledger.record({ jobId: spec.id, stage: `animate-${key}${tag}`, taskId, status: task.status, actualCredits: 0, error: task.task_error?.message });
  console.error('task did not succeed:', task.status, task.task_error?.message || '');
  process.exit(4);
}

fs.writeFileSync(path.join(cacheDir, `${spec.id}.animate.${key}${tag}.result.json`), JSON.stringify(task.result, null, 2));
async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}
if (task.result.animation_glb_url) await download(task.result.animation_glb_url, path.join(outDir, `clips_${key}${tag}.glb`));
if (task.result.animation_fbx_url) await download(task.result.animation_fbx_url, path.join(outDir, `clips_${key}${tag}.fbx`));

const after = (await client.balance()).balance;
const spent = before - after;
ledger.record({
  jobId: spec.id, stage: `animate-${key}${tag}`, taskId, status: task.status, estimatedCredits,
  reportedCredits: task.consumed_credits, actualCredits: spent, balanceBefore: before, balanceAfter: after,
});
console.log(`done. consumed_credits=${task.consumed_credits} balance ${before} -> ${after} (spent ${spent})${spent > maxCredits ? ' EXCEEDS MAX' : ''}`);
console.log('files:', fs.readdirSync(outDir).join(', '));
