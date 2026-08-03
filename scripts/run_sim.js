'use strict';
/* ============ AI 玩家模擬（原生內核） ============

   驅動迴圈只做三件事：推進時間、在決策點問策略、把策略回的指令送進遊戲。
   所有數值——傷害、掉落、經驗、成本、機率、日誌文字——都由遊戲本體算。
   本檔沒有任何遊戲公式或常數，也不寫 G（唯一例外是匯出前對齊 savedAt，見 engine.stampSavedAt）。

   用法：
     node --max-semi-space-size=64 scripts/run_sim.js --hours=100 --seed=20260730
   選項：
     --hours=N        模擬遊戲小時數（預設 1；--trace 時預設為軌跡長度）
                      ⚠️ 策略有宣告 dailyActiveHours 時，這是**牆鐘時間（含離線）**
     --ignore-schedule 忽略策略的 dailyActiveHours，全程在線（重現班表實作前的行為）
     --seed=N         PRNG 種子（預設 20260730；--trace 時預設為錄製當下的種子）
     --policy=path    策略檔（預設 scripts/sim/policy.default.json）
     --trace=path     改用真人錄製軌跡當決策來源（js/recorder.js 匯出的檔），與 --policy 互斥
     --save=path      從既有存檔開局（預設 null＝全新角色；--trace 時預設為錄製檔內的起始存檔）
     --out=dir        輸出目錄（預設 sim_out）
     --snap-min=N     每 N 遊戲分鐘取一次快照（預設 10）
     --keep-visual    連飄字/特效事件也寫進日誌（預設丟棄，只留 log/flog/loot/notice）

   --trace 走的是同一條驅動迴圈、同一組快照欄位、同一份 run_summary 格式，
   所以「真人那一場」與「AI 那一場」的輸出可以直接相減（見 scripts/compare_runs.js）。
*/

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createEngine } = require('./sim/engine');
const { createPolicy } = require('./sim/policy');
const { createTraceSource } = require('./sim/trace');
const { stateHash } = require('./sim/hash');

const ROOT = path.resolve(__dirname, '..');

function arg(name, dflt) {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  if (hit) return hit.slice(name.length + 3);
  return process.argv.includes('--' + name) ? true : dflt;
}

const TRACE_PATH = arg('trace', null);
const OUT_DIR = path.resolve(ROOT, String(arg('out', 'sim_out')));
/* 這一次模擬的開機時間（本機牆鐘）。在載入遊戲之前先取，才不會被虛擬時鐘影響——
   引擎會把 Date 換成虛擬的（js/item.js 的寶石商店與 js/forge.js 都讀牆鐘）。 */
const START_WALL_CLOCK = new Date().toISOString();
const SNAP_MIN = Number(arg('snap-min', 10));
const KEEP_VISUAL = !!arg('keep-visual', false);
/* 忽略策略宣告的 dailyActiveHours，全程在線。用來重現「班表實作之前」的行為，
   或單獨觀察線上那一段。 */
const IGNORE_SCHEDULE = !!arg('ignore-schedule', false);
/* 覆蓋策略宣告的觀測間隔。設成與 decideEveryGameSec 相同即可還原「觀測與行動未分離」
   的舊行為，用來比對這項改動造成的差異。 */
const OBSERVE_EVERY = process.argv.some((a) => a.startsWith('--observe-every='))
  ? Number(arg('observe-every')) : null;

if (TRACE_PATH && process.argv.some((a) => a.startsWith('--policy='))) {
  console.error('--trace 與 --policy 互斥：一場模擬只能有一個決策來源。');
  process.exit(1);
}

/* ---- 決策來源載入（含雜湊，執行期不得改動）----
   策略與真人軌跡走同一個介面（name / decideEveryGameSec / needPanels / bootstrap /
   decide / badPaths），下面整條驅動迴圈因此不需要知道自己在跑哪一種。 */
const POLICY_PATH = path.resolve(ROOT, String(arg('policy',
  TRACE_PATH ? String(TRACE_PATH) : 'scripts/sim/policy.default.json')));
const policySrc = fs.readFileSync(POLICY_PATH, 'utf8');
const policyHash = crypto.createHash('sha256').update(policySrc).digest('hex');
const policy = TRACE_PATH
  ? createTraceSource(JSON.parse(policySrc))
  : createPolicy(JSON.parse(policySrc));

/* seed 與起始存檔：軌跡自帶錄製當下的值，命令列給了就以命令列為準。
   ⚠️ 用不同的 seed 重播真人軌跡是合法的（看「同樣的操作換一組運氣會怎樣」），
   但那就不再是「重現那一場」，逐點比對必然失敗。摘要會記下實際用的值。 */
const SEED = process.argv.some((a) => a.startsWith('--seed='))
  ? Number(arg('seed'))
  : (TRACE_PATH && policy.seed !== null ? policy.seed : 20260730);
const SAVE_PATH = arg('save', null);

if (TRACE_PATH && policy.seed === null) {
  console.warn('⚠️ 錄製檔沒有記錄 seed，改用預設值 ' + SEED + '。這場重播不會重現原本那一場。');
}

/* 軌跡預設跑滿整段錄製。GT 只在戰鬥沒暫停時前進，所以牆鐘時間必定 ≥ GT，
   多給 5% 與 60 秒的餘裕；真的還是沒跑完，摘要的 trace.remaining 會非 0。 */
const HOURS = process.argv.some((a) => a.startsWith('--hours='))
  ? Number(arg('hours'))
  : (TRACE_PATH ? traceHours(policy) : 1);

function traceHours(src) {
  const rows = src.rows || [];
  const lastRowGt = rows.length ? (rows[rows.length - 1].gt || 0) : 0;
  const endGt = Math.max(src.report().traceEndGt, lastRowGt);
  return +((endGt * 1.05 + 60) / 3600).toFixed(4);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

/* ---- 原生日誌收集 ----
   日誌一律來自 shim 的事件佇列（js/worker/shim.js 的 blog/flog/addLog → shimPushEvent），
   harness 不自己組任何一句訊息、不自己排時間戳格式。
   丟棄的事件會計數並回報，不做無聲截斷。 */
const KEEP_KINDS = KEEP_VISUAL ? null : { log: 1, flog: 1, loot: 1, notice: 1 };

/* ---- 有界的同步落地 ----

   ⚠️ 這兩個檔案在深局會來到 588 MB（native_events.jsonl）與 294 MB
   （ai_player_action_log.txt）。策略修好、角色打得深之後，5 個 seed 有 2 個
   被 V8 直接打死（Windows 退出碼 0xC0000409，不留 stderr）。兩個原因：

     1. 動作日誌原本整場 push 進 readableLogs 陣列，最後 join 成一整個字串——
        兩百多萬個字串的陣列**加上** join 出來的整份字串同時在堆上。
     2. createWriteStream 是非同步的，寫得比磁碟快時就在記憶體裡積，
        而這裡從來沒有等過 drain。

   改成 writeSync + 固定大小的字串緩衝：記憶體上限就是 FLUSH_BYTES，
   而且同步寫完才回來，不會有沒沖掉的尾巴。 */
const FLUSH_BYTES = 1 << 20;   // 1 MB

function makeSink(filePath) {
  const fd = fs.openSync(filePath, 'w');
  let buf = '';
  return {
    write(s) {
      buf += s;
      if (buf.length >= FLUSH_BYTES) { fs.writeSync(fd, buf); buf = ''; }
    },
    close() {
      if (buf) { fs.writeSync(fd, buf); buf = ''; }
      fs.closeSync(fd);
    }
  };
}

const logSink = makeSink(path.join(OUT_DIR, 'native_events.jsonl'));
const eventCounts = Object.create(null);
let eventsKept = 0;
let eventsDropped = 0;

let engine = null;   // onEvents 會用到，先宣告

let lastCombatDamageLogHour = -1;

/* 動作日誌的標頭要帶最終等級與總筆數，只有跑完才知道，
   所以本文先寫到 .part，收尾時開正式檔寫標頭再把 .part 搬進去。
   陣列只留最後 200 筆給 run_summary 的 recentLogs。 */
const ACTION_LOG = path.join(OUT_DIR, 'ai_player_action_log.txt');
const ACTION_LOG_PART = ACTION_LOG + '.part';
const actionSink = makeSink(ACTION_LOG_PART);
const RECENT_LOG_KEEP = 200;
const recentLogTail = [];
let readableLogCount = 0;

function pushReadableLog(line) {
  actionSink.write(line + '\n');
  readableLogCount++;
  recentLogTail.push(line);
  if (recentLogTail.length > RECENT_LOG_KEEP) recentLogTail.shift();
}

function onEvents(events) {
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    eventCounts[ev.kind] = (eventCounts[ev.kind] || 0) + 1;
    if (KEEP_KINDS && !KEEP_KINDS[ev.kind]) { eventsDropped++; continue; }
    ev.gt = engine ? engine.gameTimeSec() : 0;
    logSink.write(JSON.stringify(ev) + '\n');
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
        pushReadableLog(`${timeStr} [${cat.toUpperCase()}/${cls}] ${cleanText}`);
      }
    }
  }
}

/* ---- 開機 ---- */
console.log(`${TRACE_PATH ? '真人軌跡' : '策略'} ${path.relative(ROOT, POLICY_PATH)}  sha256 ${policyHash.slice(0, 16)}`);
if (TRACE_PATH) {
  const r = policy.report();
  console.log(`  錄於 ${r.recordedAt}　指令 ${r.commands} 道　錄製端 seed ${r.seed}`);
  if (r.recorderTruncated) console.warn('  ⚠️ 錄製檔自報已截斷，這份軌跡不完整。');
  if (r.recorderUnacked) console.warn(`  ⚠️ 錄製時有 ${r.recorderUnacked} 道指令沒等到 ACK，軌跡有缺口。`);
  console.log(`  對齊軸 ${r.axis}` + (r.axis === 'gt' ? '（協議 v14 之前的舊錄製檔）' : ''));
  /* 暫停只有在退回 gt 對齊時才是問題；以 simT 對齊時它照走，不必警告。 */
  if (r.recorderPauseWindows && r.axis === 'gt') {
    console.warn(`  ⚠️ 錄製期間暫停過戰鬥 ${r.recorderPauseWindows} 次（${r.recorderPausedTicks} 則 tick），而這份是以 gt 對齊的舊錄製檔。`);
    console.warn('     暫停期間 gt 不前進，重播無從得知燒掉幾步——這一場重現不出原本那一場，不可拿去比對。');
  }
  /* 同一個 tick 內連送也會共用 gt，但那會被完整重現，不是風險——只警告暫停期間那一種。
     細節見 scripts/sim/trace.js 檔頭的「已知限制」。 */
  if (r.sharedGtWhilePaused) {
    console.warn(`  ⚠️ ${r.sharedGtWhilePaused} 道指令是在戰鬥暫停期間送出且與前一道共用 gt，重播會壓成同一步，亂數序列可能偏移。`);
  } else if (r.sharedGtCommands) {
    console.log(`  註：${r.sharedGtCommands} 道指令與前一道共用 gt（同一個 tick 內連送），重播會在同一步依序送出，可完整重現。`);
  }
}
console.log(`seed ${SEED}  時數 ${HOURS}h  快照每 ${SNAP_MIN} 遊戲分鐘\n`);

/* 起始存檔：--save 優先，其次是軌跡自帶的錄製起點。
   兩者都沒有就是全新角色——對軌跡而言那幾乎一定是錯的（真人不會從零開始錄），
   所以明白警告，不要讓人拿一場從頭開始的重播去比對。 */
const startSave = SAVE_PATH
  ? JSON.parse(fs.readFileSync(path.resolve(ROOT, String(SAVE_PATH)), 'utf8'))
  : (TRACE_PATH ? policy.startSave : null);
if (startSave) {
  console.log(`起始存檔 ${SAVE_PATH || '（來自錄製檔）'}`);
} else if (TRACE_PATH) {
  /* startSave 是 null 有兩種意思，只有第二種是問題——見 js/recorder.js 的 startSaveCaptured。
     全新角色開局其實是最常見的錄製情境，把它一律報成警告只會讓人學會忽略警告。 */
  const captured = policy.report().startSaveCaptured;
  if (captured === true) console.log('起始存檔 無（錄製時就是全新角色，重播從全新角色開始是正確的）');
  else if (captured === false) console.warn('⚠️ 錄製器沒有接到開機事件，起點不明——這一場重現不出原本那一場。');
  else console.warn('⚠️ 錄製檔沒有起始存檔，也沒記錄原因（舊版錄製器）。若當時不是全新角色，這一場不可比。');
}

engine = createEngine({ seed: SEED, onEvents });
engine.boot(startSave);

/* 軌跡是逐步對齊的：決策間隔必須剛好是一步，否則真人落在步與步之間的指令會被
   擠到格點上，亂數序列跟著錯開。這裡把假設寫成斷言，而不是靠 trace.js 猜對步長。 */
if (TRACE_PATH && Math.abs(policy.decideEveryGameSec - engine.dt) > 1e-9) {
  console.error(`軌跡重播的決策間隔必須等於引擎步長：${policy.decideEveryGameSec} ≠ ${engine.dt}`);
  process.exit(1);
}

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
/* 累計在線秒數。宣告在這裡而不是主迴圈那一段，是因為 snapshot() 要用它做每小時的
   擊殺檢查——放在下面的話，任何人在主迴圈之前多加一次 snapshot() 就會踩到 TDZ。 */
let onlineSec = 0;

function snapshot() {
  const view = engine.view();
  const stats = engine.ctx.getStats();
  const G = engine.state();
  
  /* 每一「在線小時」檢查擊殺數是否為 0，用來抓「戰鬥根本沒在跑」這種 harness 故障。

     ⚠️ 這裡量的必須是**在線時數**，不是牆鐘。啟用班表後牆鐘的第 24 小時裡有 22 小時
     是離線的，線上擊殺本來就會是 0——用牆鐘算會讓每一個離線日都噴一次假警報，
     而假警報多了之後真正的故障就不會有人看。離線期間的收益走的是另一套結算，
     由 schedule.offlineSettlements 各自回報，不歸這個檢查管。 */
  const onlineHoursNow = onlineSec / 3600;
  if (onlineHoursNow - lastHourChecked >= 1.0) {
    const totalKills = (engine.ctx.LOOT_STATS && engine.ctx.LOOT_STATS.kills) || 0;
    if (onlineHoursNow > 1.0) {
      const killsThisHour = totalKills - lastKillsTotal;
      if (killsThisHour <= 0) {
        console.warn(`⚠️ [警告] 第 ${Math.floor(onlineHoursNow)} 個在線小時擊殺數為 0！`);
      }
    }
    lastKillsTotal = totalKills;
    lastHourChecked = onlineHoursNow;
  }

  const lootStats = engine.ctx.LOOT_STATS || {};
  const row = {
    gameHours: +(engine.gameTimeSec() / 3600).toFixed(4),
    reincarnations: G.player.reincarnations || 0,
    invCount: (G.inventory || []).length,
    /* ⚠️ G.tower.floor 不存在——狀態裡是 highest（已通關的最高樓層，js/player.js）。
       讀錯欄位的話這一欄與儀表板的高塔卡片都恆為 0，實際已經打到 27~30 層。
       TOWER.floor 是「當前這一場打的是第幾層」的執行期值，不是進度。 */
    towerFloor: (G.tower && (G.tower.highest || G.tower.floor)) || 0,
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

/* ---- 線上／離線班表 ----

   策略以 dailyActiveHours 宣告「每日遊玩幾小時」。在這之前這個欄位四份策略都寫了、
   卻沒有任何一行程式讀它——四種強度全部被當成 24 小時不間斷在線，只有決策頻率不同。
   輕度玩家（2 小時／日）因此被模擬成一個永不睡覺、每 60 秒操作一次的人。

   差別不只是「操作次數少」。玩家關掉遊戲的那 22 小時走的是**完全不同的一套模型**
   （js/save.js 的 applyOfflineProgress：固定每 20 秒殺一隻比最高關卡低十幾關的菁英，
   與實際 DPS 無關，且上限 24 小時），寶石商店的每小時刷新也只會經歷 2 次而不是 24 次。

   班表的形狀：每個 24 小時週期，先連續在線 dailyActiveHours 小時，其餘時間離線。
   真人可能拆成好幾段，但離線收益是線性且未達上限，拆不拆對離線那一側幾乎沒差；
   對線上那一側才有差（回來時變強了多少）。先用單一區塊，這個假設寫在這裡。

   ⚠️ 啟用班表後 --hours 的語意是**牆鐘時間（含離線）**，不是線上時數。
   輕度玩家跑 --hours=100 就是「100 小時的日子」，其中約 8.3 小時在線。 */
const DAILY_HOURS = 24;
const scheduleDeclared = typeof policy.dailyActiveHours === 'number' &&
                         policy.dailyActiveHours > 0 &&
                         policy.dailyActiveHours < DAILY_HOURS;
const scheduleOn = scheduleDeclared && !IGNORE_SCHEDULE;
/* 沒有班表時線上區塊是無限長——整場就是一個區塊，迴圈結構退化成原本那一個 while，
   不另外寫一條路徑。兩條路徑會長歪，而長歪的那一刻沒有人會發現。 */
const ONLINE_BLOCK_SEC = scheduleOn ? policy.dailyActiveHours * 3600 : Infinity;
const OFFLINE_BLOCK_SEC = scheduleOn ? (DAILY_HOURS - policy.dailyActiveHours) * 3600 : 0;

if (scheduleDeclared && IGNORE_SCHEDULE) {
  console.log(`班表 已宣告 ${policy.dailyActiveHours}h/日，但 --ignore-schedule 要求忽略，本場全程在線。`);
} else if (scheduleOn) {
  console.log(`班表 每日在線 ${policy.dailyActiveHours}h、離線 ${DAILY_HOURS - policy.dailyActiveHours}h（--hours 是牆鐘時間，含離線）`);
} else if (typeof policy.dailyActiveHours === 'number') {
  console.log(`班表 dailyActiveHours=${policy.dailyActiveHours}，等同全程在線，不做離線結算。`);
}

/* ---- 觀測與行動的兩種節奏 ----

   decideEveryGameSec 是「玩家多久做一次後勤」，會因玩家強度而異（輕度 60 秒、極限 5 秒）。
   observeEverySec 是「玩家多仔細看戰鬥」，預設 1 秒且**不因強度而異**。

   兩者原本是同一個旋鈕，於是玩得少的人連戰鬥觀測都變粗：最後一次取樣可能落在死前
   60 秒，那時 BOSS 還有八成血，而重試間隔正是「殘血百分比當分鐘數」。玩得少的人因此
   被系統性地多罰一次。真人盯著螢幕看到的戰鬥細節不會因為他今天只上線兩小時就變粗。

   詳見 scripts/sim/policy_interpreter.js 的「觀測與行動是兩件事」。
   --observe-every 可覆蓋；設成與 decideEveryGameSec 相同即還原拆分前的行為。 */
const observeEvery = OBSERVE_EVERY !== null ? OBSERVE_EVERY : (policy.observeEverySec || 1);
const observePanels = policy.observePanels || [];

/* 邊際效益評估器的參數（要評估哪些詞條、每個部位精算幾個候選）。
   由策略宣告、引擎執行——策略拿不到遊戲函式，算不了 ROI；引擎不該決定要算什麼。
   沒宣告就是空的，panels.eval 仍然會建，只是 affixRoi 是空表。 */
if (policy.evalConfig) engine.setEvalParams(policy.evalConfig);
/* 軌跡重播不做觀測：它不判斷任何事，只是照時間表送出真人當初送過的指令。
   多跑一層觀測只會白花時間，也不會改變結果。 */
const observeOn = !TRACE_PATH && observeEvery > 0 && observeEvery < policy.decideEveryGameSec;
if (observeOn) {
  console.log(`節奏 觀測每 ${observeEvery}s（與強度無關）、行動每 ${policy.decideEveryGameSec}s`);
} else if (!TRACE_PATH) {
  console.log(`節奏 觀測與行動同為每 ${policy.decideEveryGameSec}s（未分離）`);
}

/* ---- 主迴圈 ---- */
const decideEvery = policy.decideEveryGameSec;
const stepsPerDecision = Math.max(1, Math.round(decideEvery / engine.dt));
const stepsPerObserve = Math.max(1, Math.round(observeEvery / engine.dt));
const totalWallSec = HOURS * 3600;
const totalSteps = Math.round(totalWallSec / engine.dt);   // 全程在線時的步數，進度條與摘要用
const snapEverySec = SNAP_MIN * 60;
let nextSnapAt = 0;
let decisions = 0;
let observations = 0;
let stepsDone = 0;
const offlineLog = [];

const t0 = process.hrtime.bigint();
let lastReport = t0;

function progressLine(row) {
  const pct = (100 * engine.gameTimeSec() / totalWallSec).toFixed(1);
  process.stdout.write(`[PROGRESS] ${pct}% ${row.gameHours.toFixed(1)}h / ${HOURS}h Lv.${row.level}\n`);
  try {
    fs.writeFileSync(path.join(OUT_DIR, 'sim_progress.json'), JSON.stringify({
      /* 批次模式下這份檔案是「這個 seed 跑到哪」的唯一來源，
         所以要自報 seed——否則讀的人只能從目錄名反推命名規則，推錯了不會有徵兆。 */
      seed: SEED,
      percent: parseFloat(pct),
      currentHour: row.gameHours,
      totalHours: HOURS,
      level: row.level,
      stage: row.stage
    }));
  } catch (e) {}
}

try {
  while (engine.gameTimeSec() < totalWallSec - 1e-9) {
    /* ---- 在線區塊 ---- */
    const onlineUntil = Math.min(engine.gameTimeSec() + ONLINE_BLOCK_SEC, totalWallSec);
    while (engine.gameTimeSec() < onlineUntil - 1e-9) {
      const remain = Math.round((onlineUntil - engine.gameTimeSec()) / engine.dt);
      const n = Math.min(stepsPerDecision, remain);

      if (!observeOn) {
        engine.step(n);
      } else {
        /* 把一個行動間隔切成若干個觀測間隔。每一段之間問一次觀測——它只讀
           view.stage 與 track.monster 指到的那個面板，不碰背包。 */
        let left = n;
        while (left > 0) {
          const chunk = Math.min(stepsPerObserve, left);
          engine.step(chunk);
          left -= chunk;
          const oPanels = {};
          for (const p of observePanels) oPanels[p] = engine.panel(p);
          policy.observe({ view: engine.view(), panels: oPanels, gameTimeSec: engine.gameTimeSec() });
          observations++;
        }
      }
      stepsDone += n;
      onlineSec += n * engine.dt;

      /* 決策點：策略只拿到 view / panels 的深拷貝（policy.decide 內再 round-trip 一次）。
         它沒有 G、沒有 FIELD、沒有任何遊戲函式，改不了狀態也讀不到內部值。
         面板只建策略宣告要的那幾個——背包面板很大，每次都建會白付序列化成本。 */
      const panels = {};
      for (const p of policy.needPanels) panels[p] = engine.panel(p);
      dispatch(policy.decide({ view: engine.view(), panels, gameTimeSec: engine.gameTimeSec() }));
      decisions++;

      if (engine.gameTimeSec() >= nextSnapAt) {
        progressLine(snapshot());
        nextSnapAt += snapEverySec;
      }
    }

    if (!scheduleOn || engine.gameTimeSec() >= totalWallSec - 1e-9) break;

    /* ---- 離線區塊 ----
       收益全部由遊戲的 applyOfflineProgress 算（見 sim/engine.js 的 offlineFor）。 */
    const offlineSec = Math.min(OFFLINE_BLOCK_SEC, totalWallSec - engine.gameTimeSec());
    const atHour = engine.gameTimeSec() / 3600;
    const sum = engine.offlineFor(offlineSec);
    offlineLog.push({
      atHour: +atHour.toFixed(3),
      hours: +(offlineSec / 3600).toFixed(3),
      /* 遊戲回的原始摘要欄位，不改名也不再計算。null 代表遊戲判定這段不計
         （未滿一分鐘，或算出來的擊殺數不足 1）。 */
      settled: sum ? {
        seconds: sum.seconds, stage: sum.stage, kills: sum.kills,
        gold: sum.gold, xp: sum.xp, scrap: sum.scrap
      } : null
    });

    /* 離線是曲線上的一個跳點，結算完立刻取樣，否則圖上會看到一條直接飛上去的斜線，
       看不出那是離線收益一次入帳。同時把取樣格點重新對齊到現在。 */
    progressLine(snapshot());
    nextSnapAt = engine.gameTimeSec() + snapEverySec;
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
    recentLogs: recentLogTail.slice()
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
logSink.close();

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
 總擷取官方原生日誌數: ${readableLogCount} 筆
 最終角色等級: Lv.${finalView.level}
 最終最高關卡: Stage ${finalView.stage}
 最終面板 DPS: ${(() => { const d = engine.ctx.currentDps ? engine.ctx.currentDps() : 0; return engine.ctx.fmt ? engine.ctx.fmt(d) : d; })()}
========================================================================\n\n`;

/* 標頭寫進正式檔，再把 .part 的本文串接進來。
   用 64 KB 的固定緩衝逐段搬，檔案 300 MB 也只佔 64 KB 記憶體。 */
actionSink.close();
fs.writeFileSync(ACTION_LOG, logHeader, 'utf8');
if (fs.existsSync(ACTION_LOG_PART)) {
  const src = fs.openSync(ACTION_LOG_PART, 'r');
  const dst = fs.openSync(ACTION_LOG, 'a');
  const buf = Buffer.allocUnsafe(64 * 1024);
  for (;;) {
    const n = fs.readSync(src, buf, 0, buf.length, null);
    if (n <= 0) break;
    fs.writeSync(dst, buf, 0, n);
  }
  fs.closeSync(src);
  fs.closeSync(dst);
  fs.unlinkSync(ACTION_LOG_PART);
}
console.log(`📝 [${HOURS}h 官方原生動作日誌檔導出成功] -> ${ACTION_LOG}`);

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
    towerFloor: 'G.tower.highest（已通關的最高樓層；G.tower.floor 不存在）',
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
  /* 這份資料是什麼時候跑出來的（本機時間，秒級）。
     沒有這個欄位的話，儀表板讀到的快照究竟是剛跑完的還是幾小時前的完全分不出來——
     實際發生過拿三小時前的 sim_out 當成新結果去判斷 bug，查了半天才發現資料是舊的。 */
  startedAt: START_WALL_CLOCK,
  finishedAt: new Date().toISOString(),
  startSave: SAVE_PATH ? String(SAVE_PATH) : null,
  policy: { file: path.relative(ROOT, POLICY_PATH), name: policy.name, sha256: policyHash },

  /* ---- 線上／離線班表 ----
     gameHours 是牆鐘時間；onlineHours 才是實際跑了模擬的時數。兩者混用會把
     「輕度玩家 100 小時只在線 8.3 小時」讀成「跑了 100 小時的模擬」。
     offlineSettlements 逐筆記錄遊戲原生的離線結算結果，欄位是它自己的，不改名。 */
  schedule: {
    declaredDailyActiveHours: (typeof policy.dailyActiveHours === 'number') ? policy.dailyActiveHours : null,
    enabled: scheduleOn,
    ignoredByFlag: !!(scheduleDeclared && IGNORE_SCHEDULE),
    wallHours: HOURS,
    onlineHours: +(onlineSec / 3600).toFixed(3),
    offlineHours: +((HOURS * 3600 - onlineSec) / 3600).toFixed(3),
    offlineSettlements: offlineLog
  },
  /* 真人軌跡重播才有。remaining 非 0 代表軌跡沒跑完（--hours 太短，或重播提早分岔
     讓 GT 停住），此時這場的曲線不能拿去跟 AI 比。 */
  trace: TRACE_PATH ? policy.report() : null,
  /* GM 前置一律揭露：讀報告的人要看得出哪些狀態是模擬出來的、哪些是墊出來的。 */
  gmBootstrap: bootstrapLog,

  /* ---- 邊際效益評估器一律揭露 ----

     ⚠️ 這是本 harness 唯一帶有「模型」的地方，所以它的假設必須跟結果一起出現。

     評估器算的 DPS **只含普攻**，不含技能、連擊、範圍攻擊——實測會低估實際輸出
     約 5 倍。這對 ROI 排序無害（ROI 是比值，常數倍率會約掉），但任何人拿
     panels.eval.power 當「這隻角色的 DPS」都會錯得很離譜。

     model 裡的兩個係數（命中夾值、探針強度）在遊戲裡是內嵌在 resolveHit 的字面值，
     沒有具名函式可呼叫，只能宣告在評估器裡。tests/sim-evaluator.test.cjs 有哨兵
     比對 resolveHit 的原始碼，但那個哨兵盯的是「有沒有同步」，
     不是「這個模型準不準」——後者要靠這裡的揭露讓讀報告的人自己判斷。 */
  evaluator: policy.evalConfig ? {
    enabled: true,
    config: policy.evalConfig,
    model: (function () { try { return engine.panel('eval').model; } catch (e) { return null; } })(),
    警告: 'panels.eval.power 是模型尺度，只含普攻，不是實際 DPS；絕對時間一律經 currentDps() 校正'
  } : { enabled: false },
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
    /* 實際跑掉的步數。啟用班表時它會少於 wallHours × 36000——離線那一段沒有跑 simStep，
       用 totalSteps 會把吞吐量灌水成好幾倍。 */
    steps: stepsDone,
    stepSeconds: engine.dt,
    elapsedSec: +elapsedSec.toFixed(2),
    stepsPerSec: Math.round(stepsDone / elapsedSec),
    /* 縮時倍率照牆鐘算：使用者關心的是「一場 100 小時的日子要跑多久」。 */
    speedupX: Math.round((HOURS * 3600) / elapsedSec),
    projected100hSec: +(360000 / ((HOURS * 3600) / elapsedSec)).toFixed(1)
  },
  events: { counts: eventCounts, kept: eventsKept, dropped: eventsDropped, keptKinds: KEEP_KINDS ? Object.keys(KEEP_KINDS) : 'all' },
  decisions,
  /* 觀測與行動的節奏。observeEverySec < actEverySec 代表兩者已分離；相同則是未分離
     （＝2026-08-01 之前的行為，玩得少的人連戰鬥觀測都變粗）。 */
  cadence: {
    actEverySec: policy.decideEveryGameSec,
    observeEverySec: observeOn ? observeEvery : policy.decideEveryGameSec,
    separated: observeOn,
    observations: observations
  },
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

if (summary.schedule.enabled) {
  const s = summary.schedule;
  const settled = s.offlineSettlements.filter((o) => o.settled);
  const kills = settled.reduce((a, o) => a + o.settled.kills, 0);
  console.log(`班表        牆鐘 ${s.wallHours}h ＝ 在線 ${s.onlineHours}h ＋ 離線 ${s.offlineHours}h（每日在線 ${s.declaredDailyActiveHours}h）`);
  console.log(`離線結算    ${settled.length}/${s.offlineSettlements.length} 次生效，累計離線擊殺 ${kills.toLocaleString()}（遊戲原生固定費率，與線上 DPS 無關）`);
} else if (summary.schedule.ignoredByFlag) {
  console.log(`班表        已宣告 ${summary.schedule.declaredDailyActiveHours}h/日但被 --ignore-schedule 忽略，全程在線`);
}

if (summary.trace) {
  const t = summary.trace;
  console.log(`真人軌跡    送出 ${t.fired}/${t.commands} 道（錄製時就失敗的 ${t.failedWhenRecorded} 道也照送）`);
  if (t.remaining) {
    console.log(`⚠️ 還有 ${t.remaining} 道指令沒送出：重播只走到 gt=${t.lastGt}s，軌跡到 gt=${t.traceEndGt}s。`);
    console.log(`            加大 --hours，或先用 scripts/verify_trace.js 查是不是提早分岔了。`);
  }
}

const badPaths = Object.keys(summary.badStatePaths);
if (badPaths.length) {
  console.log(`⚠️ 失效路徑  ${badPaths.length} 條策略路徑解析不出值（面板欄位可能改名了）：`);
  badPaths.slice(0, 8).forEach((p) => console.log(`            ${p}（${summary.badStatePaths[p]} 次）`));
}
console.log(`未測到指令  ${summary.untestedCommands.length}/${Object.keys(engine.ctx.COMMANDS).length} 條協議指令從未被送出（清單見 run_summary.json）`);
console.log(`最終        Lv.${summary.final.level} stage ${summary.final.stage} 轉生 ${summary.final.reincarnations} 背包 ${summary.final.inventory}`);
console.log(`存檔雜湊    ${summary.determinism.finalStateHash.slice(0, 16)}`);
console.log(`輸出        ${path.relative(ROOT, OUT_DIR)}/  (save_final.json, snapshots.csv, native_events.jsonl, run_summary.json)`);
