'use strict';
/* ============ AI 玩家模擬（原生內核） ============

   驅動迴圈只做三件事：推進時間、在決策點問策略、把策略回的指令送進遊戲。
   所有數值——傷害、掉落、經驗、成本、機率、日誌文字——都由遊戲本體算。
   本檔沒有任何遊戲公式或常數，也不寫 G（唯一例外是匯出前對齊 savedAt，見 engine.stampSavedAt）。

   用法：
     node --max-semi-space-size=64 scripts/run_sim.js --hours=100 --seed=20260730
   選項：
     --hours=N        模擬遊戲小時數（預設 1）
     --seed=N         PRNG 種子（預設 20260730）
     --policy=path    策略檔（預設 scripts/sim/policy.default.json）
     --save=path      從既有存檔開局（預設 null＝全新角色）
     --out=dir        輸出目錄（預設 sim_out）
     --snap-min=N     每 N 遊戲分鐘取一次快照（預設 10）
     --keep-visual    連飄字/特效事件也寫進日誌（預設丟棄，只留 log/flog/loot/notice）
*/

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createEngine } = require('./sim/engine');
const { createPolicy } = require('./sim/policy');
const { stateHash } = require('./sim/hash');

const ROOT = path.resolve(__dirname, '..');

function arg(name, dflt) {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  if (hit) return hit.slice(name.length + 3);
  return process.argv.includes('--' + name) ? true : dflt;
}

const HOURS = Number(arg('hours', 1));
const SEED = Number(arg('seed', 20260730));
const POLICY_PATH = path.resolve(ROOT, String(arg('policy', 'scripts/sim/policy.default.json')));
const OUT_DIR = path.resolve(ROOT, String(arg('out', 'sim_out')));
const SNAP_MIN = Number(arg('snap-min', 10));
const KEEP_VISUAL = !!arg('keep-visual', false);
const SAVE_PATH = arg('save', null);

/* ---- 策略載入（含雜湊，執行期不得改動）---- */
const policySrc = fs.readFileSync(POLICY_PATH, 'utf8');
const policyHash = crypto.createHash('sha256').update(policySrc).digest('hex');
const policy = createPolicy(JSON.parse(policySrc));

fs.mkdirSync(OUT_DIR, { recursive: true });

/* ---- 原生日誌收集 ----
   日誌一律來自 shim 的事件佇列（js/worker/shim.js 的 blog/flog/addLog → shimPushEvent），
   harness 不自己組任何一句訊息、不自己排時間戳格式。
   丟棄的事件會計數並回報，不做無聲截斷。 */
const KEEP_KINDS = KEEP_VISUAL ? null : { log: 1, flog: 1, loot: 1, notice: 1 };
const logStream = fs.createWriteStream(path.join(OUT_DIR, 'native_events.jsonl'));
const eventCounts = Object.create(null);
let eventsKept = 0;
let eventsDropped = 0;

let engine = null;   // onEvents 會用到，先宣告

let lastCombatDamageLogHour = -1;
const readableLogs = [];

function onEvents(events) {
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    eventCounts[ev.kind] = (eventCounts[ev.kind] || 0) + 1;
    if (KEEP_KINDS && !KEEP_KINDS[ev.kind]) { eventsDropped++; continue; }
    ev.gt = engine ? engine.gameTimeSec() : 0;
    logStream.write(JSON.stringify(ev) + '\n');
    eventsKept++;

    // 移植：人類可讀日誌與戰鬥日誌節流 (每分鐘保留一筆)
    if (ev.kind === 'log' || ev.kind === 'flog' || ev.kind === 'notice') {
      const cls = ev.cls || (ev.payload && ev.payload.cls) || 'info';
      const cat = ev.cat || (ev.payload && ev.payload.cat) || 'system';
      const hours = ev.gt / 3600;

      if (cls === 'log-enemy-damage' && (hours - lastCombatDamageLogHour < 1.0 / 60)) {
        continue;
      }
      if (cls === 'log-enemy-damage') {
        lastCombatDamageLogHour = hours;
      }

      const rawMsg = ev.msg || ev.text || (ev.payload ? (ev.payload.msg || ev.payload) : '');
      const stripHtml = engine && engine.ctx && engine.ctx.stripHtml;
      const cleanText = stripHtml ? stripHtml(rawMsg) : String(rawMsg);
      if (cleanText) {
        const totalSec = Math.floor(hours * 3600);
        const days = Math.floor(totalSec / 86400) + 1;
        const remSec = totalSec % 86400;
        const h = String(Math.floor(remSec / 3600)).padStart(2, '0');
        const m = String(Math.floor((remSec % 3600) / 60)).padStart(2, '0');
        const s = String(remSec % 60).padStart(2, '0');
        const timeStr = `[第${days}天 ${h}:${m}:${s}]`;
        readableLogs.push(`${timeStr} [${cat.toUpperCase()}/${cls}] ${cleanText}`);
      }
    }
  }
}

/* ---- 開機 ---- */
console.log(`策略 ${path.relative(ROOT, POLICY_PATH)}  sha256 ${policyHash.slice(0, 16)}`);
console.log(`seed ${SEED}  時數 ${HOURS}h  快照每 ${SNAP_MIN} 遊戲分鐘\n`);

const startSave = SAVE_PATH ? JSON.parse(fs.readFileSync(path.resolve(ROOT, String(SAVE_PATH)), 'utf8')) : null;
if (startSave) console.log(`起始存檔 ${SAVE_PATH}`);

engine = createEngine({ seed: SEED, onEvents });
engine.boot(startSave);

/* ---- GM 前置 ----
   只能用來「建立測試前提」（例如把角色墊到已轉生，才測得到天賦與神鑄），
   不得用來推進遊戲進度。每一條都原文寫進 run_summary.json，公開揭露。 */
const bootstrapLog = [];
for (const line of policy.bootstrap) {
  const r = engine.cmd('gm.exec', { line });
  bootstrapLog.push({ line, ok: !!(r && r.ok), result: r && r.result });
  console.log(`  GM 前置：${line} → ${r && r.ok ? 'ok' : 'FAIL ' + (r && r.error)}`);
}

/* ---- 指令統計 ----
   ⚠️ runCommand 的 ok 只代表「執行時沒有拋錯」，不代表「這個操作真的發生了」。
   而「做到了沒有」這件事，模擬層**沒有統一的表達方式**：

     js/skills.js:2129   learnOrUpgradeSkill  成功回 null，失敗回 '技能點不足'
     js/factory.js:457   manualUpgrade        成功回 'ok'，資源不足回 'poor'，失敗回 'fail'
     js/tower.js:95      startTowerAuto       成敗都無回傳值
     gem.composeAll                           回 { made, err }

   注意 learnOrUpgradeSkill 與 manualUpgrade **完全相反**：一個字串代表失敗，
   另一個字串代表成功。所以**不能用型別猜語意**——這個坑踩過兩次了：
   第一次把「字串＝失敗」寫死，於是 learnOrUpgradeSkill 的成功被算成失敗；
   第二次沿用同一條規則，於是 manualUpgrade 回的 'ok' 又被算成失敗，
   報表顯示「強化 231 次全部無效」，實際上武器已經 +6。

   所以只在語意明確時分類，字串一律歸到 gameReply 並保留原文直方圖，交給人判讀——
   遊戲回的字串本來就是講給人看的（'poor' / 'ok' / '技能點不足'），呈現原文比猜測有用。 */
const cmdStats = Object.create(null);
function bump(bucket, key) { bucket[key] = (bucket[key] || 0) + 1; }

function dispatch(cmds) {
  for (const c of cmds) {
    const r = engine.cmd(c.name, c.args);
    const key = c.ruleId + ' → ' + c.name;
    const s = cmdStats[key] || (cmdStats[key] = {
      sent: 0, ok: 0, failed: 0, gameReply: 0, noReturn: 0, rejected: 0, replies: Object.create(null)
    });
    s.sent++;
    const res = r && r.result;
    if (!r || !r.ok) {
      /* 協議層就擋下了：指令名或參數不合法。這一類與遊戲無關，是策略寫錯。 */
      s.rejected++;
      bump(s.replies, '[協議拒絕] ' + ((r && r.error) || 'unknown'));
    } else if (typeof res === 'string') {
      /* 語意不明確：字串在不同指令代表相反的事。保留原文供判讀，不猜。 */
      s.gameReply++;
      bump(s.replies, res);
    } else if (res && typeof res === 'object' && res.err) {
      s.failed++;
      bump(s.replies, String(res.err));
    } else if (res === false) {
      s.failed++;
      bump(s.replies, '[回傳 false]');
    } else if (res === undefined) {
      /* 沒有回傳值就是沒有證據（js/tower.js:95）。要判斷成敗只能看原生日誌。 */
      s.noReturn++;
    } else {
      /* null（js/skills.js:2129 的成功慣例）、true、或有內容的物件 */
      s.ok++;
    }
  }
}

/* ---- 不變量斷言：任一失敗立即停止，不產出「看起來完成」的檔案 ---- */
const problems = [];
let lastLevel = 0;
function assertInvariants(view, stats) {
  const bad = [];
  if (view.level < lastLevel) bad.push(`等級倒退 ${lastLevel} → ${view.level}`);
  lastLevel = view.level;
  for (const k of ['gold', 'scrap', 'dust', 'essence', 'ancientEssence', 'level', 'stage']) {
    const v = view[k];
    if (typeof v === 'number' && !Number.isFinite(v)) bad.push(`${k} 不是有限數：${v}`);
    if (typeof v === 'number' && v < 0) bad.push(`${k} 為負：${v}`);
  }
  if (stats && !(stats.atk > 0 || stats.matk > 0)) bad.push('面板攻擊力為 0');
  
  // 移植：第 30 秒起 DPS 必須大於 0
  const dps = engine.ctx.currentDps ? engine.ctx.currentDps() : 0;
  if (engine.gameTimeSec() > 30 && dps <= 0) {
    bad.push(`面板 DPS 異常：${dps}`);
  }

  if (bad.length) {
    problems.push({ atGameSec: engine.gameTimeSec(), bad });
    console.error(`\n❌ 不變量失敗 @ 遊戲 ${(engine.gameTimeSec() / 3600).toFixed(2)}h`);
    bad.forEach((b) => console.error('   ' + b));
    fs.writeFileSync(path.join(OUT_DIR, 'failure_state.json'), engine.saveJson());
    console.error(`   當時存檔已寫出：${path.relative(ROOT, path.join(OUT_DIR, 'failure_state.json'))}`);
    process.exit(2);
  }
}

/* ---- 快照（圖表資料來源）----
   每一欄都是遊戲原生的值，harness 不做任何再計算、外插或平滑。
   來源欄位記在 snapshots.meta.json，供圖表標註。 */
/* gems / magicScroll / soulOrigin 也是 buildView() 既有欄位（見 protocol.js 的
   TICK_VIEW_KEYS）。先前沒放進來，導致儀表板拿不到寶石數量只能顯示 0。 */
const SNAP_VIEW_KEYS = ['level', 'stage', 'gold', 'scrap', 'dust', 'essence',
  'ancientEssence', 'demonSeed', 'gems', 'magicScroll', 'soulOrigin',
  'hp', 'hpMax', 'mp', 'mpMax', 'xp', 'xpMax'];
const snapRows = [];

let lastKillsTotal = 0;
let lastHourChecked = 0;

function snapshot() {
  const view = engine.view();
  const stats = engine.ctx.getStats();
  const G = engine.state();
  
  // 移植：每 1 小時檢查擊殺數是否為 0
  const simTimeHours = engine.gameTimeSec() / 3600;
  if (simTimeHours - lastHourChecked >= 1.0) {
    const totalKills = (engine.ctx.LOOT_STATS && engine.ctx.LOOT_STATS.kills) || 0;
    if (simTimeHours > 1.0) {
      const killsThisHour = totalKills - lastKillsTotal;
      if (killsThisHour <= 0) {
        console.warn(`⚠️ [警告] 第 ${Math.floor(simTimeHours)} 小時擊殺數為 0！`);
      }
    }
    lastKillsTotal = totalKills;
    lastHourChecked = simTimeHours;
  }

  const lootStats = engine.ctx.LOOT_STATS || {};
  const row = {
    gameHours: +(engine.gameTimeSec() / 3600).toFixed(4),
    reincarnations: G.player.reincarnations || 0,
    invCount: (G.inventory || []).length,
    towerFloor: (G.tower && G.tower.floor) || 0,
    /* ⚠️ DPS 必須取 currentDps()（js/combat.js:575，10 秒視窗，UI 顯示的就是它）。
       getStats() **沒有** dps 這個欄位，寫 stats.dps 會恆為 0——儀表板的 DPS 曲線
       之所以是一條貼著 0 的直線就是這個原因。同一支檔案的不變量檢查用的是對的來源，
       只有這裡寫錯，兩邊不一致反而讓問題更難發現。 */
    dps: engine.ctx.currentDps ? engine.ctx.currentDps() : 0,
    atk: stats.atk || 0, matk: stats.matk || 0, def: stats.def || 0,
    critRate: stats.critRate || 0, critDmg: stats.critDmg || 0,
    /* LOOT_STATS 的欄位名是 dropRolls（js/stats.js:20），不是 drops；
       寫錯的話恆為 0，而且不會有任何錯誤訊息。 */
    totalKills: lootStats.kills || 0,
    totalDrops: lootStats.dropRolls || 0,
    totalBattles: lootStats.battles || 0,
    totalDeaths: lootStats.deaths || 0,
    cumGold: lootStats.gold || 0
  };
  for (const k of SNAP_VIEW_KEYS) row[k] = view[k];
  snapRows.push(row);
  assertInvariants(view, stats);
  return row;
}

/* ---- 主迴圈 ---- */
const decideEvery = policy.decideEveryGameSec;
const stepsPerDecision = Math.max(1, Math.round(decideEvery / engine.dt));
const totalSteps = Math.round((HOURS * 3600) / engine.dt);
const snapEverySec = SNAP_MIN * 60;
let nextSnapAt = 0;
let decisions = 0;
let stepsDone = 0;

const t0 = process.hrtime.bigint();
let lastReport = t0;

try {
  while (stepsDone < totalSteps) {
    const n = Math.min(stepsPerDecision, totalSteps - stepsDone);
    engine.step(n);
    stepsDone += n;

    /* 決策點：策略只拿到 view / panels 的深拷貝（policy.decide 內再 round-trip 一次）。
       它沒有 G、沒有 FIELD、沒有任何遊戲函式，改不了狀態也讀不到內部值。
       面板只建策略宣告要的那幾個——背包面板很大，每次都建會白付序列化成本。 */
    const panels = {};
    for (const p of policy.needPanels) panels[p] = engine.panel(p);
    dispatch(policy.decide({ view: engine.view(), panels, gameTimeSec: engine.gameTimeSec() }));
    decisions++;

    if (engine.gameTimeSec() >= nextSnapAt) {
      const row = snapshot();
      nextSnapAt += snapEverySec;
      const pct = (100 * stepsDone / totalSteps).toFixed(1);
      process.stdout.write(`[PROGRESS] ${pct}% ${row.gameHours.toFixed(1)}h / ${HOURS}h Lv.${row.level}\n`);
      try {
        fs.writeFileSync(path.join(OUT_DIR, 'sim_progress.json'), JSON.stringify({
          percent: parseFloat(pct),
          currentHour: row.gameHours,
          totalHours: HOURS,
          level: row.level,
          stage: row.stage
        }));
      } catch (e) {}
    }
  }
} catch (err) {
  console.error('\n💥 [模擬中斷] 觸發執行期阻斷或未處理錯誤！');
  console.error(err.stack || err.message);
  
  // Dump 當時 G 及最後 200 筆原生事件
  const errorDumpPath = path.join(OUT_DIR, 'sim_error_dump.json');
  const dumpData = {
    error: err.message,
    gt: engine ? engine.gameTimeSec() : 0,
    lastView: engine ? engine.view() : null,
    recentLogs: readableLogs.slice(-200)
  };
  fs.writeFileSync(errorDumpPath, JSON.stringify(dumpData, null, 2), 'utf-8');
  console.error(`📁 已將 Error Dump 導出至: ${errorDumpPath}`);
  
  // 同時寫出當時的 failure 存檔
  if (engine) {
    fs.writeFileSync(path.join(OUT_DIR, 'failure_state.json'), engine.saveJson());
  }
  process.exit(1);
}

snapshot();

const elapsedSec = Number(process.hrtime.bigint() - t0) / 1e9;

/* ---- 落地 ---- */
logStream.end();

const saveJson = engine.stampSavedAt().saveJson();
fs.writeFileSync(path.join(OUT_DIR, 'save_final.json'), saveJson);

const finalView = engine.view();
const finalStats = engine.ctx.getStats();

// 移植：500h 進度下限斷言
if (HOURS >= 500 && finalView.level < 10) {
  console.error(`❌ [500h 進度下限斷言失敗] 最終等級 Lv.${finalView.level} 低於 500h 期望下限 Lv.10！`);
  process.exit(1);
}

// 移植：寫出人類可讀日誌 (.TXT Dump)
const speedupMult = ((HOURS * 3600) / elapsedSec).toFixed(0);
const logHeader = `========================================================================
 Idle-RPG 100% 官方內建原生遊戲日誌 ${HOURS} 小時真實遊玩履歷 (.TXT Dump)
 生成時間: ${new Date().toLocaleString()}
 Seed: ${SEED} | Policy SHA256: ${policyHash.slice(0, 12)}
 時間加速倍率: ${Number(speedupMult).toLocaleString()}x
 總擷取官方原生日誌數: ${readableLogs.length} 筆
 最終角色等級: Lv.${finalView.level}
 最終最高關卡: Stage ${finalView.stage}
 最終面板 DPS: ${(() => { const d = engine.ctx.currentDps ? engine.ctx.currentDps() : 0; return engine.ctx.fmt ? engine.ctx.fmt(d) : d; })()}
========================================================================\n\n`;

fs.writeFileSync(path.join(OUT_DIR, 'ai_player_action_log.txt'), logHeader + readableLogs.join('\n'), 'utf8');
console.log(`📝 [${HOURS}h 官方原生動作日誌檔導出成功] -> ${path.join(OUT_DIR, 'ai_player_action_log.txt')}`);

const cols = Object.keys(snapRows[0]);
fs.writeFileSync(
  path.join(OUT_DIR, 'snapshots.csv'),
  cols.join(',') + '\n' + snapRows.map((r) => cols.map((c) => r[c]).join(',')).join('\n')
);

fs.writeFileSync(path.join(OUT_DIR, 'snapshots.meta.json'), JSON.stringify({
  說明: '每一欄的來源。圖表只能畫這些欄位，不得在繪圖層再計算任何衍生值。',
  來源: {
    gameHours: 'harness 模擬時間（步數 × 0.1s）',
    reincarnations: 'G.player.reincarnations',
    invCount: 'G.inventory.length',
    towerFloor: 'G.tower.floor',
    dps: 'currentDps()（js/combat.js:575，10 秒視窗；getStats() 沒有 dps 欄位）',
    atk: 'getStats().atk', matk: 'getStats().matk', def: 'getStats().def',
    critRate: 'getStats().critRate', critDmg: 'getStats().critDmg',
    totalKills: 'LOOT_STATS.kills（累積）',
    totalDrops: 'LOOT_STATS.dropRolls（累積掉落擲骰次數）',
    totalBattles: 'LOOT_STATS.battles（累積）',
    totalDeaths: 'LOOT_STATS.deaths（累積）',
    cumGold: 'LOOT_STATS.gold（累積獲得，非持有）',
    ...Object.fromEntries(SNAP_VIEW_KEYS.map((k) => [k, `buildView().${k}（目前持有，非累積）`]))
  },
  提醒: [
    'CSV 裡的資源欄位（gold/scrap/essence/gems…）是「目前持有」，會因為消耗而下降。',
    '要顯示「累積總獲得」請讀 run_summary.json 的 lootStats（遊戲原生 LOOT_STATS）。',
    '兩者混用會得到嚴重偏低的數字——這是先前儀表板數據對不上的主因之一。'
  ]
}, null, 2));

const summary = {
  seed: SEED,
  gameHours: HOURS,
  startSave: SAVE_PATH ? String(SAVE_PATH) : null,
  policy: { file: path.relative(ROOT, POLICY_PATH), name: policy.name, sha256: policyHash },
  /* GM 前置一律揭露：讀報告的人要看得出哪些狀態是模擬出來的、哪些是墊出來的。 */
  gmBootstrap: bootstrapLog,
  determinism: { finalStateHash: stateHash(saveJson) },

  /* ---- 累積掉落統計（遊戲原生 LOOT_STATS，js/stats.js）----
     ⚠️ 這是「整場累積獲得」，與存檔裡的「目前持有」是兩回事：
     東西會被拆解、賣掉、消耗，所以持有量必定遠小於累積獲得量。
     儀表板的「累積總獲得」卡片必須讀這裡，讀存檔會得到偏低到不合理的數字。

     欄位（原生定義，不要改名）：
       battles/kills/deaths/dropRolls/gold  純量
       equip  { 稀有度index: 件數 }   稀有度對照見 js/data.js 的 RARITIES
       mats   { 素材key: 數量 }
       gems   { '種類:等級': 數量 }
       sources{ 來源: 同上結構 }      野外／高塔／工廠拆解／技能 各自分開 */
  lootStats: (() => {
    const ls = engine.ctx.LOOT_STATS;
    return ls ? JSON.parse(JSON.stringify(ls)) : null;
  })(),

  /* 稀有度索引 → 名稱對照，直接取自遊戲的 RARITIES，讓儀表板不必自己維護一份。
     先前儀表板把 R3 標成「史詩」（實際是獨特）、R4/R5 標成「傳奇」，就是自己抄名字抄錯。 */
  rarityNames: (() => {
    const R = engine.ctx.RARITIES || [];
    return R.map((r, i) => ({ index: i, key: r.key, name: r.name }));
  })(),
  performance: {
    steps: totalSteps,
    stepSeconds: engine.dt,
    elapsedSec: +elapsedSec.toFixed(2),
    stepsPerSec: Math.round(totalSteps / elapsedSec),
    speedupX: Math.round((HOURS * 3600) / elapsedSec),
    projected100hSec: +(360000 / ((HOURS * 3600) / elapsedSec)).toFixed(1)
  },
  events: { counts: eventCounts, kept: eventsKept, dropped: eventsDropped, keptKinds: KEEP_KINDS ? Object.keys(KEEP_KINDS) : 'all' },
  decisions,
  commands: cmdStats,

  /* ---- 哨兵：策略靜靜失效的兩種情況 ----
     遊戲改版時不必把改了什麼同步給模擬器（數值、公式、常數都是從遊戲讀的），
     但有兩件事改了會讓策略無聲失準，所以主動報出來。 */

  /* (1) 指到解析不出值的狀態路徑＝面板欄位改名了，而策略還指著舊路徑。
         條件永遠不成立，那條規則就此不再送出任何指令，且沒有任何錯誤。 */
  badStatePaths: policy.badPaths(),

  /* (2) 協議指令表裡從未被送出過的指令＝從未被測到的玩家操作。
         這不一定是問題（有些指令本來就不該由 AI 用），但它是「策略還沒覆蓋什麼」的
         客觀清單——遊戲新增系統時，新指令會自動出現在這裡。 */
  untestedCommands: (() => {
    const sent = new Set(Object.keys(cmdStats).map((k) => k.split(' → ')[1]));
    return Object.keys(engine.ctx.COMMANDS).filter((name) => !sent.has(name));
  })(),
  invariantFailures: problems,
  final: (() => { const v = engine.view(); const s = engine.ctx.getStats(); const st = engine.state().stage || {}; return {
    level: v.level, stage: st.best || v.stage, stageCurrent: st.current || v.stage, gold: v.gold, reincarnations: engine.state().player.reincarnations || 0,
    atk: s.atk, matk: s.matk, inventory: (engine.state().inventory || []).length }; })()
};
fs.writeFileSync(path.join(OUT_DIR, 'run_summary.json'), JSON.stringify(summary, null, 2));

/* ---- 收尾檢查：日誌一則都沒有 = harness 壞了，不是「這局很安靜」---- */
if (eventsKept === 0) {
  console.error('\n❌ 原生事件 0 則。日誌管線壞了（shimDrainEvents 沒接上），不是遊戲很安靜。');
  process.exit(3);
}

console.log('\n──────── 完成 ────────');
console.log(`耗時        ${elapsedSec.toFixed(1)}s（${summary.performance.stepsPerSec.toLocaleString()} 步/秒，${summary.performance.speedupX.toLocaleString()}x）`);
console.log(`100h 推估   ${summary.performance.projected100hSec}s`);
console.log(`原生事件    保留 ${eventsKept.toLocaleString()} 則／丟棄 ${eventsDropped.toLocaleString()} 則（種類：${JSON.stringify(eventCounts)}）`);
console.log(`決策點      ${decisions.toLocaleString()} 次`);

const badPaths = Object.keys(summary.badStatePaths);
if (badPaths.length) {
  console.log(`⚠️ 失效路徑  ${badPaths.length} 條策略路徑解析不出值（面板欄位可能改名了）：`);
  badPaths.slice(0, 8).forEach((p) => console.log(`            ${p}（${summary.badStatePaths[p]} 次）`));
}
console.log(`未測到指令  ${summary.untestedCommands.length}/${Object.keys(engine.ctx.COMMANDS).length} 條協議指令從未被送出（清單見 run_summary.json）`);
console.log(`最終        Lv.${summary.final.level} stage ${summary.final.stage} 轉生 ${summary.final.reincarnations} 背包 ${summary.final.inventory}`);
console.log(`存檔雜湊    ${summary.determinism.finalStateHash.slice(0, 16)}`);
console.log(`輸出        ${path.relative(ROOT, OUT_DIR)}/  (save_final.json, snapshots.csv, native_events.jsonl, run_summary.json)`);
