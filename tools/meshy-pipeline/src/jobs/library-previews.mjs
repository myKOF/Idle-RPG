import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, ensureFolders } from '../core/config.mjs';
import { MeshyClient } from '../providers/meshy/client.mjs';

// node src/jobs/library-previews.mjs <id,id,...>
// Free: downloads the library preview GIFs of the given action ids into Animations/library-previews.
const ids = (process.argv[2] || '').split(',').map(Number).filter((n) => Number.isFinite(n));
if (!ids.length) {
  console.error('usage: library-previews.mjs <actionId,actionId,...>');
  process.exit(1);
}

const cfg = loadConfig();
ensureFolders(cfg);
const client = new MeshyClient(cfg);
const outDir = path.join(cfg.paths.assetsRoot, 'Animations', 'library-previews');
fs.mkdirSync(outDir, { recursive: true });

const found = new Map();
for (let page = 1; page <= 12 && found.size < ids.length; page++) {
  const res = await client.animationLibrary({ page_num: page, page_size: 100 });
  const items = res.result ?? res.data ?? res;
  if (!Array.isArray(items) || !items.length) break;
  for (const a of items) if (ids.includes(a.action_id) && !found.has(a.action_id)) found.set(a.action_id, a);
}

for (const id of ids) {
  const a = found.get(id);
  if (!a) {
    console.log(id, 'NOT FOUND');
    continue;
  }
  const res = await fetch(a.preview_url);
  fs.writeFileSync(path.join(outDir, `${id}.gif`), Buffer.from(await res.arrayBuffer()));
  console.log(id, a.name, `[${a.category}/${a.sub_category}]`, `${(fs.statSync(path.join(outDir, `${id}.gif`)).size / 1024) | 0} KB`);
}
