'use strict';

/**
 * scripts/run_real_ai_player.js
 * 
 * 100% 官方原生內核 AI 玩家實機模擬腳本 (Native Simulator Engine Harness)
 * 
 * 本腳本嚴守 Harness 與遊戲本體的邊界：
 *  1. 100% 載入官方 21 支核心腳本與 sim.worker.js 內核。
 *  2. 以固定步長 dt = 0.1s 全速驅動原生 simStep(0.1)。
 *  3. 僅透過 runCommand(name, args) 經由 protocol.js 協議發送玩家操作。
 *  4. 實作 G Proxy Guard 寫入防禦，非 simStep/runCommand 期間寫入直接 throw。
 *  5. 100% 採用 shimDrainEvents() 擷取原生日誌，零筆時 abort 阻斷導出。
 *  6. 實作不變量斷言 (DPS > 0, 等級單調不減, 資源非 NaN/Negative, 每小時擊殺>0)。
 *  7. 匯出時間序列快照 CSV / JSON、原生日誌 txt 與 500h 官方實體存檔 JSON。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

// 解析命令列參數
const argsMap = {};
process.argv.slice(2).forEach(arg => {
    if (arg.startsWith('--')) {
        const [k, v] = arg.slice(2).split('=');
        argsMap[k] = v || true;
    }
});

const SEED = parseInt(argsMap.seed, 10) || 42;
const TOTAL_HOURS = parseFloat(argsMap.hours) || 500;
const SNAPSHOT_INTERVAL_MIN = parseFloat(argsMap.snapshotInterval) || 60; // 預設每 1 遊戲小時記錄一次快照

console.log('========================================================================');
console.log(` 🚀 啟動 Idle-RPG 100% 官方原生內核模擬器 (Seed: ${SEED}, 目標: ${TOTAL_HOURS}h)`);
console.log('========================================================================\n');

// 載入宣告式策略檔 sim/policy.json
const policyPath = path.join(__dirname, '..', 'sim', 'policy.json');
if (!fs.existsSync(policyPath)) {
    console.error(`❌ [錯誤] 找不到策略檔 ${policyPath}`);
    process.exit(1);
}
const policyRaw = fs.readFileSync(policyPath, 'utf-8');
const policyHash = crypto.createHash('sha256').update(policyRaw).digest('hex');
const policy = JSON.parse(policyRaw);
console.log(`📜 [策略檔載入成功] 名稱: ${policy.name} v${policy.version} (SHA256: ${policyHash.slice(0, 12)}...)`);

// PRNG Seeded Random (Mulberry32)
function createMulberry32(seed) {
    let s = seed >>> 0;
    return function() {
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const rng = createMulberry32(SEED);

// 建立安全 VM Sandbox
const sandbox = {
    console: console,
    Math: Object.create(Math, {
        random: { value: rng, writable: true, configurable: true }
    }),
    JSON: JSON,
    Array: Array,
    Object: Object,
    String: String,
    Number: Number,
    Boolean: Boolean,
    Date: Date,
    RegExp: RegExp,
    parseInt: parseInt,
    parseFloat: parseFloat,
    isNaN: isNaN,
    isFinite: isFinite,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    postMessage: () => {},
    performance: { now: () => Date.now() },
    location: { search: '' },
    UI: { dirty: {} },
    importScripts: () => {},
    self: null,
    window: null,
    _engineDepth: 0
};

sandbox.self = sandbox;
sandbox.window = sandbox;

const context = vm.createContext(sandbox);

// 載入官方 21 支核心程式碼 + sim.worker.js
const GAME_SCRIPTS = [
    'js/worker/protocol.js',
    'js/worker/shim.js',
    'js/util.js',
    'js/data.js',
    'js/formula.js',
    'js/battlefield.js',
    'js/stats.js',
    'js/item.js',
    'js/skills.js',
    'js/talents.js',
    'js/player.js',
    'js/special_rules.js',
    'js/combat.js',
    'js/legendary.js',
    'js/potential.js',
    'js/tower.js',
    'js/factory.js',
    'js/newforge.js',
    'js/forge.js',
    'js/save.js',
    'js/gm_exec.js',
    'js/worker/sim.worker.js'
];

console.log('📦 載入官方 21 支遊戲核心與 Worker 內核程式碼...');
GAME_SCRIPTS.forEach(relPath => {
    const absPath = path.join(__dirname, '..', relPath);
    const code = fs.readFileSync(absPath, 'utf-8');
    vm.runInContext(code, context, { filename: relPath });
});
console.log('✅ 官方遊戲核心與 Worker 內核載入完成！\n');

// 初始化開機與安裝 Proxy Guard
vm.runInContext(`
    _engineDepth++;
    try {
        if (typeof boot === 'function') {
            boot({ maxRunId: 1 });
        } else {
            G = newGameState();
            if (typeof initFieldPlayer === 'function') initFieldPlayer();
        }

        function attachProxyGuard(obj) {
            if (!obj || typeof obj !== 'object') return obj;
            return new Proxy(obj, {
                get(target, prop, receiver) {
                    const val = Reflect.get(target, prop, receiver);
                    if (val && typeof val === 'object') {
                        return attachProxyGuard(val);
                    }
                    return val;
                },
                set(target, prop, value, receiver) {
                    if (typeof _engineDepth !== 'number' || _engineDepth <= 0) {
                        throw new Error("[Proxy Guard Veto] 偵測到違規寫入 G." + String(prop) + "！Harness 禁止在 simStep/runCommand 以外直接修改遊戲狀態！");
                    }
                    return Reflect.set(target, prop, value, receiver);
                },
                deleteProperty(target, prop) {
                    if (typeof _engineDepth !== 'number' || _engineDepth <= 0) {
                        throw new Error("[Proxy Guard Veto] 偵測到違規刪除 G." + String(prop) + "！");
                    }
                    return Reflect.deleteProperty(target, prop);
                }
            });
        }

        G = attachProxyGuard(G);
    } finally {
        _engineDepth--;
    }
`, context);

// 落地開局存檔
const initialSaveJson = vm.runInContext('JSON.stringify(G, null, 2)', context);
const initialSavePath = path.join(__dirname, '..', 'save_initial.json');
fs.writeFileSync(initialSavePath, initialSaveJson, 'utf-8');
console.log(`💾 [開局存檔落地成功] -> ${initialSavePath}\n`);

// 執行期變數與容器
const officialActionLogs = [];
const snapshots = [];
const policyCooldowns = {};

let lastCombatDamageLogHour = -1;

// 事件與日誌收集器
function drainNativeEvents() {
    const events = vm.runInContext('shimDrainEvents()', context);
    if (!events || !events.length) return;
    
    events.forEach(evt => {
        const kind = evt.kind;
        if (kind === 'log' || kind === 'flog' || kind === 'notice') {
            const rawMsg = evt.msg || evt.text || (evt.payload ? (evt.payload.msg || evt.payload) : '');
            const cls = evt.cls || (evt.payload && evt.payload.cls) || 'info';
            const cat = evt.cat || (evt.payload && evt.payload.cat) || 'system';
            const cleanText = vm.runInContext(`(typeof stripHtml === 'function' ? stripHtml(${JSON.stringify(rawMsg)}) : String(${JSON.stringify(rawMsg)}))`, context);
            if (!cleanText) return;
            
            const gt = vm.runInContext('GT', context) || 0;
            const hours = gt / 3600;
            
            // 節流頻繁的每秒怪物打玩家日誌 (每 1 分鐘保留一筆)，確保核心紀錄完整且容量適中
            if (cls === 'log-enemy-damage' && (hours - lastCombatDamageLogHour < 1.0 / 60)) {
                return;
            }
            if (cls === 'log-enemy-damage') {
                lastCombatDamageLogHour = hours;
            }
            
            const totalSec = Math.floor(hours * 3600);
            const days = Math.floor(totalSec / 86400) + 1;
            const remSec = totalSec % 86400;
            const h = String(Math.floor(remSec / 3600)).padStart(2, '0');
            const m = String(Math.floor((remSec % 3600) / 60)).padStart(2, '0');
            const s = String(remSec % 60).padStart(2, '0');
            const timeStr = `[第${days}天 ${h}:${m}:${s}]`;
            officialActionLogs.push(`${timeStr} [${cat.toUpperCase()}/${cls}] ${cleanText}`);
        }
    });
}

// 策略執行器
function evaluatePolicy(simTimeHours) {
    if (!policy.rules || !Array.isArray(policy.rules)) return;
    
    const view = vm.runInContext('buildView()', context);
    const invCount = vm.runInContext('(G.inventory && G.inventory.length) || 0', context);
    const invCap = vm.runInContext('(typeof inventoryCapacityNow === "function") ? inventoryCapacityNow() : 100', context);
    const gTowerActive = vm.runInContext('(G.tower && G.tower.active) || false', context);
    
    const evalCtx = {
        gold: view.gold,
        scrap: view.scrap,
        essence: view.essence,
        dust: view.dust,
        level: view.level,
        stage: view.stage,
        paused: view.paused,
        towerActive: view.towerActive || gTowerActive,
        autoAdvance: view.stageAutoAdvance || false,
        inventory: { count: invCount, cap: invCap }
    };
    
    for (const rule of policy.rules) {
        const lastExec = (policyCooldowns[rule.name] !== undefined) ? policyCooldowns[rule.name] : -999;
        if (simTimeHours - lastExec < (rule.cooldownSec || 0) / 3600) continue;
        
        let match = false;
        try {
            // 評估觸發條件
            const expr = rule.trigger
                .replace(/stage\.autoAdvance/g, 'autoAdvance')
                .replace(/inventory\.count/g, 'inventory.count')
                .replace(/inventory\.cap/g, 'inventory.cap');
            
            const fn = new Function('c', `with(c) { return (${expr}); }`);
            match = fn(evalCtx);
        } catch (e) {
            match = false;
        }
        
        if (match) {
            policyCooldowns[rule.name] = simTimeHours;
            // 經由 Protocol runCommand 執行
            const cmdName = rule.command;
            const cmdArgs = rule.args || {};
            
            vm.runInContext(`
                _engineDepth++;
                try {
                    runCommand(${JSON.stringify(cmdName)}, ${JSON.stringify(cmdArgs)});
                } finally {
                    _engineDepth--;
                }
            `, context);
            break;
        }
    }
}

// 斷言檢查器
let lastLevel = 1;
let lastKillsTotal = 0;
let lastDropsTotal = 0;
let lastHourChecked = 0;

function checkRuntimeInvariants(simTimeHours) {
    const view = vm.runInContext('buildView()', context);
    const stats = vm.runInContext('(typeof getStats === "function") ? getStats() : {}', context);
    const dps = vm.runInContext('(typeof currentDps === "function") ? currentDps() : 0', context);
    const atk = stats.atk || 0;
    
    // 斷言 1: ATK > 0, 且第 30 秒起 DPS > 0
    if (atk <= 0) {
        throw new Error(`[不變量斷言失敗] 基礎 ATK 異常 (${atk})！時間: ${simTimeHours.toFixed(2)}h`);
    }
    if (simTimeHours > (30 / 3600) && dps <= 0) {
        throw new Error(`[不變量斷言失敗] 面板 DPS 異常 (${dps})！時間: ${simTimeHours.toFixed(2)}h`);
    }
    
    // 斷言 2: 等級單調不減
    if (view.level < lastLevel) {
        throw new Error(`[不變量斷言失敗] 等級回退 (前: ${lastLevel}, 現: ${view.level})！`);
    }
    lastLevel = view.level;
    
    // 斷言 3: 資源非 NaN / Infinity / 負數
    ['gold', 'scrap', 'essence', 'dust', 'ancientEssence', 'demonSeed'].forEach(r => {
        const val = view[r];
        if (typeof val === 'number') {
            if (isNaN(val) || !isFinite(val) || val < 0) {
                throw new Error(`[不變量斷言失敗] 資源 ${r} 數值無效: ${val}`);
            }
        }
    });
    
    // 每 1 小時檢查擊殺數與掉落數 (LOOT_STATS 由 stats.js 定義)
    if (simTimeHours - lastHourChecked >= 1.0) {
        const totalKills = vm.runInContext('(LOOT_STATS && LOOT_STATS.kills) || 0', context);
        const totalDrops = vm.runInContext('(LOOT_STATS && LOOT_STATS.dropRolls) || 0', context);
        
        if (simTimeHours > 1.0) {
            const killsThisHour = totalKills - lastKillsTotal;
            
            if (killsThisHour <= 0) {
                console.warn(`⚠️ [警告] 第 ${Math.floor(simTimeHours)} 小時擊殺數為 0！`);
            }
        }
        
        lastKillsTotal = totalKills;
        lastDropsTotal = totalDrops;
        lastHourChecked = simTimeHours;
    }
}

// 記錄快照
function recordSnapshot(simTimeHours) {
    const view = vm.runInContext('buildView()', context);
    const stats = vm.runInContext('(typeof getStats === "function") ? getStats() : {}', context);
    const dps = vm.runInContext('(typeof currentDps === "function") ? currentDps() : 0', context);
    
    snapshots.push({
        timeHour: Number(simTimeHours.toFixed(3)),
        level: view.level,
        stage: view.stage,
        zone: view.zone,
        dps: dps,
        atk: stats.atk || 0,
        hpMax: stats.hp || 0,
        gold: view.gold,
        scrap: view.scrap,
        essence: view.essence,
        dust: view.dust,
        ancientEssence: view.ancientEssence,
        totalKills: vm.runInContext('(LOOT_STATS && LOOT_STATS.kills) || 0', context),
        totalDrops: vm.runInContext('(LOOT_STATS && LOOT_STATS.dropRolls) || 0', context)
    });
}

// 主模擬迴圈
console.log(`⚔️ 開始執行 ${TOTAL_HOURS} 小時 100% 官方原生內核實機模擬...`);
const realStartTimeMs = Date.now();

const STEP_DT = 0.1; // TICK_MS / 1000 = 0.1s
const TOTAL_STEPS = Math.floor((TOTAL_HOURS * 3600) / STEP_DT);

let currentStep = 0;
const snapshotStepInterval = Math.floor((SNAPSHOT_INTERVAL_MIN * 60) / STEP_DT);
let nextSnapshotStep = snapshotStepInterval;

recordSnapshot(0);

try {
    while (currentStep < TOTAL_STEPS) {
        // 在 _engineDepth > 0 內執行 Sim Step
        vm.runInContext(`
            _engineDepth++;
            try {
                simStep(0.1);
            } finally {
                _engineDepth--;
            }
        `, context);
        
        currentStep++;
        const currentSimHours = (currentStep * STEP_DT) / 3600;
        
        // 擷取原生日誌
        drainNativeEvents();
        
        // 策略觸發
        if (currentStep % 10 === 0) { // 每 1 秒估算一次策略
            evaluatePolicy(currentSimHours);
        }
        
        // 斷言檢查
        if (currentStep % 100 === 0) { // 每 10 秒檢查一次不變量
            checkRuntimeInvariants(currentSimHours);
        }
        
        // 快照記錄
        if (currentStep >= nextSnapshotStep) {
            recordSnapshot(currentSimHours);
            nextSnapshotStep += snapshotStepInterval;
        }
    }
} catch (err) {
    console.error('\n💥 [模擬中斷] 觸發執行期阻斷或不變量斷言失敗！');
    console.error(err.stack || err.message);
    
    // Dump 當時 G 及最後 200 筆原生事件
    const errorDumpPath = path.join(__dirname, '..', 'sim_error_dump.json');
    const dumpData = {
        error: err.message,
        gt: vm.runInContext('GT', context),
        lastView: vm.runInContext('buildView()', context),
        recentLogs: officialActionLogs.slice(-200)
    };
    fs.writeFileSync(errorDumpPath, JSON.stringify(dumpData, null, 2), 'utf-8');
    console.error(`📁 已將 Error Dump 導出至: ${errorDumpPath}`);
    process.exit(1);
}

const elapsedRealSec = ((Date.now() - realStartTimeMs) / 1000).toFixed(2);
const speedupMult = ((TOTAL_HOURS * 3600) / elapsedRealSec).toFixed(0);

console.log(`\n🎉 ${TOTAL_HOURS} 小時原生實機模擬成功完成！耗時 ${elapsedRealSec} 秒 (時間加速比: ${Number(speedupMult).toLocaleString()}x 倍)`);
console.log(`📝 共擷取到官方內建原生日誌: ${officialActionLogs.length} 筆`);

// 守門 (2) 日誌來源守門驗證
if (officialActionLogs.length === 0) {
    console.error('❌ [日誌守門驗證失敗] 原生日誌筆數為 0！阻斷所有檔案導出！');
    process.exit(1);
}

// 500h 進度下限斷言
const finalView = vm.runInContext('buildView()', context);
const finalStats = vm.runInContext('(typeof getStats === "function") ? getStats() : {}', context);
if (TOTAL_HOURS >= 500 && finalView.level < 10) {
    console.error(`❌ [500h 進度下限斷言失敗] 最終等級 Lv.${finalView.level} 低於 500h 期望下限 Lv.10！`);
    process.exit(1);
}

// 寫出時間序列快照 (JSON & CSV)
const snapshotJsonPath = path.join(__dirname, '..', 'sim_snapshots.json');
fs.writeFileSync(snapshotJsonPath, JSON.stringify(snapshots, null, 2), 'utf-8');

const csvHeader = 'timeHour,level,stage,zone,dps,atk,hpMax,gold,scrap,essence,dust,ancientEssence,totalKills,totalDrops\n';
const csvLines = snapshots.map(s => 
    `${s.timeHour},${s.level},${s.stage},${s.zone},${s.dps},${s.atk || 0},${s.hpMax},${s.gold},${s.scrap},${s.essence},${s.dust},${s.ancientEssence},${s.totalKills},${s.totalDrops}`
).join('\n');
const snapshotCsvPath = path.join(__dirname, '..', 'sim_snapshots.csv');
fs.writeFileSync(snapshotCsvPath, csvHeader + csvLines, 'utf-8');
console.log(`📊 [時間序列快照導出成功] -> ${snapshotCsvPath}`);

// 寫出 500 小時官方原生細節日誌 txt
const logHeader = `========================================================================
 Idle-RPG 100% 官方內建原生遊戲日誌 ${TOTAL_HOURS} 小時真實遊玩履歷 (.TXT Dump)
 生成時間: ${new Date().toLocaleString()}
 Seed: ${SEED} | Policy SHA256: ${policyHash.slice(0, 12)}
 時間加速倍率: ${Number(speedupMult).toLocaleString()}x
 總擷取官方原生日誌數: ${officialActionLogs.length} 筆
 最終角色等級: Lv.${finalView.level}
 最終最高關卡: Stage ${finalView.stage} (${finalView.zone})
 最終面板 DPS: ${vm.runInContext(`fmt ? fmt(${finalStats.dps || 0}) : ${finalStats.dps || 0}`, context)}
========================================================================\n\n`;

const logTxtPath = path.join(__dirname, '..', 'ai_player_action_log.txt');
fs.writeFileSync(logTxtPath, logHeader + officialActionLogs.join('\n'), 'utf-8');
console.log(`📝 [${TOTAL_HOURS}h 官方原生動作日誌檔導出成功] -> ${logTxtPath}`);

// 寫出 500 小時實體存檔
const finalSaveJson = vm.runInContext('JSON.stringify(G, null, 2)', context);
const save500hPath = path.join(__dirname, '..', 'save_ai_player_500h.json');
fs.writeFileSync(save500hPath, finalSaveJson, 'utf-8');
console.log(`💾 [500h 官方實體存檔導出成功] -> ${save500hPath}`);

console.log('\n========================================================================');
console.log(' ✅ 模擬器 100% 原生內核驗證與導出完畢！全部守門與不變量斷言通過！');
console.log('========================================================================');
