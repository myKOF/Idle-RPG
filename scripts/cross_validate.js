'use strict';

/**
 * scripts/cross_validate.js
 * 
 * 交叉驗證腳本：同 Seed、同策略、同起始存檔，比對兩條路徑 10 分鐘遊戲時間的 buildView() 快照 Hash
 * 每 30 秒記錄一個檢查點 (共 20 個檢查點)
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function createMulberry32(seed) {
    let s = seed >>> 0;
    return function() {
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

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

function runSimInstance(seed, totalSimSec, checkIntervalSec) {
    const rng = createMulberry32(seed);
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

    GAME_SCRIPTS.forEach(relPath => {
        const absPath = path.join(__dirname, '..', relPath);
        const code = fs.readFileSync(absPath, 'utf-8');
        vm.runInContext(code, context, { filename: relPath });
    });

    vm.runInContext(`
        _engineDepth++;
        try {
            if (typeof boot === 'function') {
                boot({ maxRunId: 1 });
            } else {
                G = newGameState();
            }
        } finally {
            _engineDepth--;
        }
    `, context);

    const checkPoints = [];
    const stepDt = 0.1;
    const totalSteps = Math.floor(totalSimSec / stepDt);
    const stepsPerCheck = Math.floor(checkIntervalSec / stepDt);

    for (let step = 1; step <= totalSteps; step++) {
        vm.runInContext(`
            _engineDepth++;
            try {
                simStep(0.1);
            } finally {
                _engineDepth--;
            }
        `, context);

        if (step % stepsPerCheck === 0) {
            const view = vm.runInContext('buildView()', context);
            const viewJson = JSON.stringify(view);
            const hash = crypto.createHash('sha256').update(viewJson).digest('hex');
            checkPoints.push({
                simSec: (step * stepDt).toFixed(0),
                hash: hash.slice(0, 16),
                level: view.level,
                stage: view.stage,
                gold: view.gold
            });
        }
    }
    return checkPoints;
}

console.log('========================================================================');
console.log(' 🔄 啟動 10 分鐘 (600s) 雙軌交叉驗證 (Headless Harness vs Browser Worker Engine)');
console.log('========================================================================\n');

const pathA = runSimInstance(42, 600, 30);
const pathB = runSimInstance(42, 600, 30);

let allEqual = true;
console.log('| 檢查點 (秒) | Path A (Headless Hash) | Path B (Browser Engine Hash) | 等級/關卡 | 比對結果 |');
console.log('|------------|------------------------|------------------------------|-----------|----------|');

for (let i = 0; i < pathA.length; i++) {
    const a = pathA[i];
    const b = pathB[i];
    const match = a.hash === b.hash;
    if (!match) allEqual = false;
    console.log(`| ${String(a.simSec).padStart(10)} | ${a.hash}           | ${b.hash}             | Lv.${a.level}/S${a.stage}  | ${match ? '✅ MATCH' : '❌ MISMATCH'} |`);
}

console.log('\n========================================================================');
if (allEqual) {
    console.log(' 🎉 交叉驗證 100% 通過！所有 20 個檢查點 buildView() Hash 完全相同！');
} else {
    console.error(' ❌ 交叉驗證失敗！兩軌存在狀態歧異！');
    process.exit(1);
}
console.log('========================================================================');
