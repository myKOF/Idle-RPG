import { loadConfig, ensureFolders } from './core/config.mjs';
import { getApiKey, maskKey } from './core/secrets.mjs';
import { MeshyClient } from './providers/meshy/client.mjs';

const cfg = loadConfig();
const [cmd, ...args] = process.argv.slice(2);

const commands = {
  async doctor() {
    ensureFolders(cfg);
    console.log('assetsRoot:', cfg.paths.assetsRoot);
    console.log('blender   :', cfg.paths.blender || 'NOT FOUND');
    console.log('ffmpeg    :', cfg.paths.ffmpeg || 'NOT FOUND');
    console.log('api key   :', maskKey(getApiKey(cfg.meshy.keyEnvVar)));
    console.log('polyBudget:', JSON.stringify(cfg.polyBudget));
  },

  async balance() {
    console.log(JSON.stringify(await new MeshyClient(cfg).balance(), null, 2));
  },

  // meshy-pipeline library [search] — free query
  async library() {
    const res = await new MeshyClient(cfg).animationLibrary({ search: args[0], page_size: 50 });
    const items = res.result ?? res.data ?? res;
    for (const a of Array.isArray(items) ? items : []) console.log(a.action_id, a.name, `[${a.category}/${a.sub_category}]`);
  },
};

if (!commands[cmd]) {
  console.log(`usage: node src/cli.mjs <${Object.keys(commands).join('|')}>`);
  process.exit(1);
}
commands[cmd]().catch((e) => {
  console.error('error:', e.message);
  process.exit(2);
});
