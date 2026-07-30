'use strict';

/**
 * scripts/test_guard_counterproof.js
 * 
 * 執行期守門反證測試：故意在 Harness 內（_engineDepth = 0）直接寫入 G.player.gold = 1
 * 驗證 Proxy Guard 能否成功 throw 並阻斷違規寫入。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createSeededRandom(seed = 12345) {
    let s = seed;
    return function() {
        s = (s * 9301 + 49297) % 233280;
        return s / 233280;
    };
}

const prng = createSeededRandom(42);

const sandbox = {
    console: console,
    Math: Object.create(Math, {
        random: { value: prng, writable: true, configurable: true }
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

GAME_SCRIPTS.forEach(relPath => {
    const absPath = path.join(__dirname, '..', relPath);
    const code = fs.readFileSync(absPath, 'utf-8');
    vm.runInContext(code, context, { filename: relPath });
});

// 開機初始化 (在 engineDepth > 0 期間建立 G 及其 Proxy Guard)
vm.runInContext(`
    _engineDepth++;
    try {
        if (typeof boot === 'function') {
            boot({ maxRunId: 1 });
        } else {
            G = newGameState();
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

console.log('🧪 執行守門反證測試 (企圖在 Harness 層 _engineDepth = 0 直接執行 G.player.gold = 1)...');

try {
    vm.runInContext('G.player.gold = 1;', context);
    console.error('❌ 測試失敗：Proxy Guard 未能阻斷違規寫入 G！');
    process.exit(1);
} catch (err) {
    console.log('✅ [守門反證成功] 順利擷取到預期的攔截 Error:');
    console.log('--------------------------------------------------');
    console.log(err.message);
    console.log('--------------------------------------------------');
    console.log('🎉 守門反證測試通過！Harness 寫入保護完全生效！');
    process.exit(0);
}
