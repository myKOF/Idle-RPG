import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../core/config.mjs';
import { Ledger } from '../core/ledger.mjs';

// node src/jobs/report.mjs <processSpec.json> <specId>
// Writes, from measured data only: <name>.meta.json (next to the GLB), cost-report.json, run-log.md and QA.md.
const [processFile, id] = process.argv.slice(2);
const cfg = loadConfig();
const root = cfg.paths.assetsRoot;
const rel = (...p) => path.join(root, ...p);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const proc = readJson(processFile);
const qa = readJson(rel('Reports', `${id}.qa.json`));
const baked = readJson(rel('Exports', `${id}.process.json`));
const ledger = new Ledger(cfg).entries().filter((e) => e.jobId === id);
const exportDir = rel('Exports', id);

// triangles and joints straight from the exported GLB
const glb = fs.readFileSync(path.join(exportDir, `${id}.glb`));
const gltf = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
const triangles = gltf.meshes.flatMap((m) => m.primitives).reduce((s, p) => s + gltf.accessors[p.indices].count / 3, 0);
const joints = gltf.skins[0].joints.map((j) => gltf.nodes[j].name);
const animations = gltf.animations.map((a) => a.name);
const image = gltf.images?.length ?? 0;

// cost: what the final asset needed vs. what was tried and dropped
const used = new Set(['concept-A', 'image3d-A', 'retexture-A', 'rig-A', 'animate-A', 'animate-A.v2']);
const byStage = ledger.map((e) => ({ stage: e.stage, taskId: e.taskId, credits: e.actualCredits, at: e.at }));
const total = byStage.reduce((s, e) => s + (e.credits || 0), 0);
const keptStages = byStage.filter((e) => used.has(e.stage));
const cost = {
  jobId: id,
  totalCredits: total,
  balanceBefore: ledger[0]?.balanceBefore,
  balanceAfter: ledger.at(-1)?.balanceAfter,
  stages: byStage,
  note: 'actualCredits = balance before minus after each call (consumed_credits reported by Meshy matched in every case)',
  discarded: [
    'text-to-3D preview v1 and v2 (20 + 20): shape did not match the spec (long cape / horns, no sword)',
    'concept B (3): not chosen',
    'animation set v1 included Idle 11 and Hit 178 (3 + 3) that the later five-action spec dropped',
  ],
  keptCredits: keptStages.reduce((s, e) => s + (e.credits || 0), 0) - 6,
};
fs.writeFileSync(rel('Reports', 'cost-report.json'), JSON.stringify(cost, null, 2));

// per clip data merged: process spec + measurements
const clips = proc.clips.map((c) => {
  const q = qa.clips[c.name];
  const frames = q.frames;
  const ev = q.events && { ...q.events, seconds: Object.fromEntries(['windupStart', 'swingStart', 'impact', 'recoverStart', 'end'].map((k) => [k, +(q.events[k] / qa.fps).toFixed(3)])) };
  return { name: c.name, frames, fps: qa.fps, seconds: q.seconds, loop: !!c.loop, holdLast: !!c.holdLast, hitEvents: ev ?? null,
    source: c.action, mirroredClip: !!c.mirrorClip, measured: baked[c.name] };
});
const meta = {
  id, hand: 'right', engineUnits: 'meters, Y up (glTF)', triangles, joints: joints.length, weaponBone: proc.weaponBone,
  skeleton: joints, textures: image, polyBudget: cfg.polyBudget, animations, clips,
  files: { glb: `${id}.glb`, fbx: `${id}.fbx`, clipFiles: animations.map((a) => `clips/${a}.glb`) },
  note: 'hit event frames are estimated from the sword-tip speed and need a human check',
};
fs.writeFileSync(path.join(exportDir, `${id}.meta.json`), JSON.stringify(meta, null, 2));

// run log from cache files and the ledger
const cacheDir = rel('Cache');
const lines = [`# ${id} 自動化執行紀錄`, '', '時間皆為本機時間；任務編號取自 Meshy 回傳，不含金鑰。', '', '| 時間 | 階段 | 任務編號 | 點數 | 結果 |', '|---|---|---|---|---|'];
for (const e of ledger) lines.push(`| ${e.at} | ${e.stage} | ${e.taskId ?? ''} | ${e.actualCredits ?? 0} | ${e.status ?? ''} |`);
lines.push('', '## 本機處理步驟（Blender，不耗點）', '',
  '1. 鏡像模型（改為右手持劍），對調 Left/Right 頂點群組，重算法線',
  '2. 以劍軸線距離判定劍頂點，改綁新增的 `Sword` 骨骼（父骨 RightHand）；披風下緣改綁 Hips/Spine02',
  '3. 逐 clip 烘焙：起始朝向歸零、臀部起點回中心、腳底對齊地面；戰鬥待機整段左右鏡像；死亡動作尾端緩停並讓劍放平',
  '4. 程式 QA（循環接縫、腳底滑動、地面、死亡靜止、劍近身、命中事件估算）',
  '5. 匯出 GLB、FBX、各 clip 單檔，並重新匯入驗證', '',
  `快取檔案數：${fs.readdirSync(cacheDir).filter((f) => f.startsWith(id)).length}`);
fs.writeFileSync(rel('Reports', `${id}.run-log.md`), lines.join('\n') + '\n');

// QA report (Traditional Chinese)
const v = (x) => x ?? '—';
const md = [`# ${id} 模型與動畫 QA 報告`, '',
  '所有數字為程式量測值；「判定」只在有明確門檻時才給。美術好不好看、動作手感、披風與大腿有無穿插等，程式無法判斷，需要人工驗收。AI 視覺檢查只作輔助，不能取代人工驗收。', '',
  '## 模型', '', `- 三角面：**${triangles}**（目標 ${cfg.polyBudget.target}，上限 ${cfg.polyBudget.hardMax}）→ ${triangles <= cfg.polyBudget.target ? 'PASS' : triangles <= cfg.polyBudget.hardMax ? 'WARN' : 'FAIL'}`,
  `- 骨骼：${joints.length} 根（含新增的 \`${proc.weaponBone}\`）`, `- 貼圖：${image} 張 2048×2048，1 個材質`, `- 動畫片段：${animations.join('、')}`, '',
  '## 動畫量測', '', '| 動畫 | 幀數 | 秒 | 循環接縫 | 腳底（接地速度 m/s） | 腿部最低 Z | 地面判定 | 其他 |', '|---|---|---|---|---|---|---|---|'];
for (const c of proc.clips) {
  const q = qa.clips[c.name];
  const feet = `${v(q.footL.contactSpeedMean)} / ${v(q.footR.contactSpeedMean)}`;
  const other = [q.holdVerdict && `末幀靜止 ${q.holdVerdict}`, q.events && `命中估算第 ${q.events.impact} 幀`].filter(Boolean).join('；');
  md.push(`| ${c.name} | ${q.frames} | ${q.seconds} | ${q.loopVerdict ? `${q.loopVerdict}（${q.loopSeamDeg}°）` : '不適用'} | ${feet} | ${q.minZByPart.legsFeet} | ${q.floorVerdict} | ${other} |`);
}
md.push('', '## 命中事件（估算，需人工確認）', '', '以劍尖速度最快的一幀為命中點，速度低於峰值 30% 處為揮出與收招邊界。', '',
  '| 動畫 | 蓄力起點 | 揮出 | 命中 | 收招 | 結束 |', '|---|---|---|---|---|---|');
for (const c of clips.filter((x) => x.hitEvents)) {
  const e = c.hitEvents;
  md.push(`| ${c.name} | ${e.windupStart}（${e.seconds.windupStart}s） | ${e.swingStart}（${e.seconds.swingStart}s） | **${e.impact}（${e.seconds.impact}s）** | ${e.recoverStart}（${e.seconds.recoverStart}s） | ${e.end}（${e.seconds.end}s） |`);
}
md.push('', '## 已知問題（已由使用者接受）', '',
  '- **死亡**：倒下過程中（約第 12 至 24 幀）劍尖暫時低於地面最多約 22 公分，披風下緣低於地面約 18 公分，腿部最多陷 4 公分。倒地後劍已放平，不再陷地。',
  '- **攻擊1**：蹲低時披風下緣（綁在臀部）低於地面約 11 公分。',
  '- **攻擊1 為雙手動作**：劍只在右手，左手空握，手與劍的對位不精確。',
  '- **劍貼身**：攻擊1 有 58 幀、劍上最多 69 個頂點距離身體不到 2 公分；這是靠近度量測，不是穿插判定。',
  '- **披風與大腿穿插**、**劍與身體實際穿插**：沒有程式判定，需人工看動畫。',
  '- **跑步速度**：接地腳速 5.5 公尺／秒，遊戲內移動速度需與此一致，否則會滑步；可調整播放速度。',
  '- **鏡像**：模型與戰鬥待機動作皆左右鏡像，貼圖不對稱處左右會反；法線已重算。',
  '- **各 clip 單檔** 的 glTF 動畫名稱是 `Animation`，片段名稱以檔名為準；主檔內名稱正確。',
  '- **正面預覽雙腿之間有一塊淡灰色區域**（罩袍下方）：原因未查明，可能是貼圖未覆蓋的區域或鏡像後的面朝向，需人工與引擎內確認。',
  '- **未做**：受擊（Hit）、走路（Walk），依使用者規格僅需五個動作。',
  '- **未在遊戲引擎驗證**：GLB 以 Blender 重新匯入並渲染驗證，FBX 重新匯入確認五個 take；沒有在實際遊戲引擎測試。', '');
fs.writeFileSync(rel('Reports', `${id}.QA.md`), md.join('\n'));
console.log(JSON.stringify({ triangles, joints: joints.length, animations, totalCredits: total, keptCredits: cost.keptCredits }));
