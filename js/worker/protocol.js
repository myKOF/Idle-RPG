'use strict';
/* ============ Worker 協議（單一資料來源） ============
   主執行緒與模擬 Worker 之間的唯一契約。三方協作期間，任何人不得在此檔以外
   自行定義訊息型別或指令名稱；需要新增請走 docs/WORKER_MIGRATION_PLAN.md 第 7 節。

   本檔必須能在三種環境載入且行為一致：
     1. 主執行緒 <script src="js/worker/protocol.js">
     2. Worker    importScripts('protocol.js')
     3. Node 測試 vm.runInContext / require

   因此：只用 ES5 語法、只掛全域、不碰 DOM、不碰 localStorage。
   說明文件：docs/WORKER_PROTOCOL.md（與本檔同步，衝突時以本檔為準）。 */

var WORKER_PROTOCOL_VERSION = 1;

/* ---- 訊息型別：主執行緒 → Worker ---- */
var MSG_IN = {
  BOOT: 'boot',              // { save: <存檔物件|null>, now: <Date.now()> }
  CMD: 'cmd',                // { id, name, args }
  PANEL: 'panel',            // { name }  索取面板完整資料
  VISIBILITY: 'visibility',  // { hidden, at }
  SAVE_RESULT: 'saveResult', // { token, ok, error }
  PING: 'ping'               // { t }  存活探測
};

/* ---- 訊息型別：Worker → 主執行緒 ---- */
var MSG_OUT = {
  BOOTED: 'booted',   // { snapshot, offlineSummary, notices, protocolVersion }
  TICK: 'tick',       // { view, dirty, events }
  PANEL: 'panel',     // { name, data }
  FULL: 'full',       // { snapshot }
  PERSIST: 'persist', // { token, kind, payload }  請主執行緒落地存檔
  ACK: 'ack',         // { id, ok, result, error }
  ERROR: 'error',     // { where, message, stack }
  PONG: 'pong'        // { t }
};

/* ---- 面板鍵 ----
   沿用既有 UI.dirty 的命名，不得新增別名。模擬層現有 158 處 UI.dirty.* 標記
   即為髒區來源，Worker 端據此決定 tick 要附帶哪些面板資料。 */
var PANEL_KEYS = ['header', 'battle', 'equip', 'inv', 'forge', 'newforge',
                  'factory', 'tower', 'gems', 'skills', 'talents'];

/* ---- 事件種類（隨 tick 合批送出，禁止一則一次 postMessage）---- */
var EVENT_KINDS = {
  LOG: 'log',       // { msg, cls, cat }        對應 blog()
  FLOG: 'flog',     // { msg, cls }             對應 flog()
  NFLOG: 'nflog',   // { msg, cls }             對應 nflog()
  LOOT: 'loot',     // { kind, ...}             對應 window.recordLoot*
  NOTICE: 'notice', // { key, text, modal }     一次性公告／改版提示
  FLOAT: 'float'    // { target, text, cls }    戰鬥飄字
};

/* ---- 存檔落地種類（PERSIST.kind）---- */
var PERSIST_KINDS = {
  AUTO: 'auto',       // 自動存檔（每 15 秒）
  MANUAL: 'manual',   // 手動存檔
  FOLDER: 'folder',   // 存檔資料夾同步（每 10 分鐘）
  SHUTDOWN: 'shutdown' // beforeunload / 分頁隱藏
};

/* ---- tick 高頻視圖欄位 ----
   只允許小量純量。背包、技能樹、熔爐等大型結構一律走 PANEL，不得塞進 tick。 */
var TICK_VIEW_KEYS = ['gold', 'scrap', 'essence', 'dust', 'ancientEssence', 'soulOrigin',
                      'demonSeed', 'gems', 'books', 'level', 'xp', 'xpMax', 'hp', 'hpMax',
                      'mp', 'mpMax', 'shield', 'stage', 'zone', 'gt', 'paused',
                      'towerActive', 'forgeBusy'];

/* ---- 指令表 ----
   fn    ：Worker 內實際呼叫的既有函式（沿用現有實作，禁止另寫平行版本）
   args  ：參數型別。'?' 結尾表示可省略。
           int/num/bool/str/id（物件識別字串）/ids（字串陣列）/obj/any
   dirty ：執行後預期會髒的面板（僅供 P4 驗證與除錯，實際仍以 UI.dirty 為準）

   注意：跨執行緒不能傳物件參考。既有實作中吃 item 物件的函式
   （doSalvage / manualEnchant / removeEnchantAt / unsocketGem / equipItem ...），
   一律改為傳 item.id，由 Worker 端解析成物件後再呼叫原函式。 */
var COMMANDS = {
  /* -- 關卡與戰鬥 -- */
  'stage.go':              { fn: 'stageGo',          args: { delta: 'int' },                      dirty: ['battle', 'header'] },
  'stage.switchZone':      { fn: 'switchZone',       args: { zoneKey: 'str' },                    dirty: ['battle', 'header'] },
  'stage.setAutoAdvance':  { fn: null,               args: { on: 'bool' },                        dirty: ['battle'] },
  'combat.setPaused':      { fn: 'setCombatPaused',  args: { paused: 'bool' },                    dirty: ['battle'] },
  'combat.togglePaused':   { fn: 'toggleCombatPaused', args: {},                                  dirty: ['battle'] },

  /* -- 背包與裝備 -- */
  'item.equip':            { fn: 'equipItem',        args: { itemId: 'id', slotKey: 'str?', setIndex: 'int?' }, dirty: ['equip', 'inv'] },
  'item.setLock':          { fn: null,               args: { itemId: 'id', locked: 'bool' },      dirty: ['inv'] },
  'item.salvage':          { fn: 'doSalvage',        args: { itemId: 'id' },                      dirty: ['inv', 'factory'] },
  'item.salvageBulk':      { fn: null,               args: { maxRarity: 'int?', maxLevel: 'int?', maxAncient: 'int?' }, dirty: ['inv', 'factory'] },
  'item.enchant':          { fn: 'manualEnchant',    args: { itemId: 'id', bookKey: 'str' },      dirty: ['inv', 'equip'] },
  'item.removeEnchant':    { fn: 'removeEnchantAt',  args: { itemId: 'id', index: 'int' },        dirty: ['inv', 'equip'] },
  'item.rerollAffix':      { fn: 'rerollSingleAffix', args: { itemId: 'id', index: 'int' },       dirty: ['inv', 'equip'] },

  /* -- 寶石 -- */
  'gem.socket':            { fn: 'socketGem',        args: { itemId: 'id', gemId: 'id', socketIndex: 'int' }, dirty: ['inv', 'equip', 'gems'] },
  'gem.socketFused':       { fn: 'socketFusedGem',   args: { itemId: 'id', gemId: 'id', socketIndex: 'int' }, dirty: ['inv', 'equip', 'gems'] },
  'gem.unsocket':          { fn: 'unsocketGem',      args: { itemId: 'id', index: 'int' },        dirty: ['inv', 'equip', 'gems'] },
  'gem.dismantle':         { fn: 'dismantleGem',     args: { gemId: 'id' },                       dirty: ['gems'] },
  'gem.dismantleFused':    { fn: 'dismantleFusedGem', args: { gemId: 'id' },                      dirty: ['gems'] },
  'gem.convert':           { fn: 'convertGems',      args: { type: 'str', level: 'int', count: 'int?' }, dirty: ['gems'] },
  'gem.compose':           { fn: 'composeGems',      args: { type: 'str', level: 'int' },         dirty: ['gems'] },
  'gem.fuse':              { fn: 'fuseGemsV2',       args: { gemId1: 'id', gemId2: 'id' },        dirty: ['gems'] },
  'gem.shopBuy':           { fn: 'buyShopGem',       args: { index: 'int' },                      dirty: ['gems', 'header'] },
  'gem.shopBuyAll':        { fn: 'buyAllShopGems',   args: {},                                    dirty: ['gems', 'header'] },
  'gem.shopRefresh':       { fn: 'refreshGemShop',   args: {},                                    dirty: ['gems', 'header'] },
  'gem.shopUpgrade':       { fn: 'upgradeGemShop',   args: {},                                    dirty: ['gems', 'header'] },

  /* -- 角色 -- */
  'player.reincarnate':      { fn: 'reincarnate',       args: {},                                 dirty: ['header', 'equip', 'inv', 'skills', 'talents'] },
  'player.switchEquipSet':   { fn: 'switchToEquipSet',  args: { index: 'int' },                   dirty: ['equip', 'inv'] },
  'player.renameEquipSet':   { fn: null,                args: { index: 'int', name: 'str' },      dirty: ['equip'] },
  'player.buyInvUpgrade':    { fn: null,                args: {},                                 dirty: ['inv', 'header'] },
  'player.setInvSort':       { fn: null,                args: { index: 'int' },                   dirty: ['inv'] },

  /* -- 技能 -- */
  'skill.learn':           { fn: 'learnOrUpgradeSkill', args: { id: 'str' },                      dirty: ['skills', 'header'] },
  'skill.maxUpgrade':      { fn: 'maxUpgradeSkill',     args: { id: 'str' },                      dirty: ['skills', 'header'] },
  'skill.downgrade':       { fn: 'downgradeSkill',      args: { id: 'str' },                      dirty: ['skills', 'header'] },
  'skill.delete':          { fn: 'deleteSkill',         args: { id: 'str' },                      dirty: ['skills'] },
  'skill.fuse':            { fn: 'fuseSkills',          args: { ids: 'ids' },                     dirty: ['skills'] },
  'skill.deleteFusion':    { fn: 'deleteFusion',        args: { id: 'str' },                      dirty: ['skills'] },
  'skill.equipLoadout':    { fn: 'equipSkillToLoadout', args: { id: 'str' },                      dirty: ['skills', 'battle'] },
  'skill.unequipLoadout':  { fn: 'unequipSkillFromLoadout', args: { id: 'str' },                  dirty: ['skills', 'battle'] },
  'skill.reorderLoadout':  { fn: null,                  args: { from: 'int', to: 'int' },         dirty: ['skills', 'battle'] },

  /* -- 天賦與潛能 -- */
  'talent.upgrade':        { fn: 'talentUpgrade',    args: { id: 'str' },                         dirty: ['talents', 'header'] },
  'talent.downgrade':      { fn: 'talentDowngrade',  args: { id: 'str' },                         dirty: ['talents', 'header'] },
  'talent.delete':         { fn: 'talentDelete',     args: { id: 'str' },                         dirty: ['talents', 'header'] },
  'talent.potentialUpgrade': { fn: 'potentialUpgrade', args: { id: 'str' },                       dirty: ['talents', 'header'] },

  /* -- 煉獄之塔 -- */
  'tower.start':           { fn: 'startTowerFight',  args: { floor: 'int' },                      dirty: ['tower', 'battle'] },
  'tower.finish':          { fn: 'finishTowerFight', args: {},                                    dirty: ['tower', 'battle'] },

  /* -- 神鑄（forge）-- */
  'forge.placeItem':       { fn: 'forgePlaceItem',   args: { itemId: 'id', slotIndex: 'int?' },   dirty: ['forge', 'inv'] },
  'forge.removeItem':      { fn: 'forgeRemoveItem',  args: { slotIndex: 'int' },                  dirty: ['forge', 'inv'] },
  'forge.placeGem':        { fn: 'forgePlaceGem',    args: { gemId: 'id' },                       dirty: ['forge', 'gems'] },
  'forge.unloadAll':       { fn: 'forgeUnloadAll',   args: {},                                    dirty: ['forge', 'inv', 'gems'] },
  'forge.toggleDust':      { fn: 'forgeToggleDust',  args: {},                                    dirty: ['forge'] },
  'forge.autoFillDust':    { fn: 'forgeAutoFillDust', args: {},                                   dirty: ['forge'] },
  'forge.start':           { fn: 'doForge',          args: {},                                    dirty: ['forge'] },
  'forge.cancel':          { fn: 'cancelForge',      args: {},                                    dirty: ['forge', 'inv'] },
  'forge.setAuto':         { fn: null,               args: { key: 'str', on: 'bool' },            dirty: ['forge'] },

  /* -- 熔爐（newforge）-- */
  'newforge.addFurnace':      { fn: 'addNewForgeFurnace',      args: {},                          dirty: ['newforge'] },
  'newforge.removeFurnace':   { fn: 'removeNewForgeFurnace',   args: { furnaceId: 'str' },        dirty: ['newforge'] },
  'newforge.installPart':     { fn: 'newForgeInstallPart',     args: { furnaceId: 'str', partId: 'id', slotIndex: 'int?' }, dirty: ['newforge'] },
  'newforge.uninstallPart':   { fn: 'newForgeUninstallPart',   args: { furnaceId: 'str', slotIndex: 'int' }, dirty: ['newforge'] },
  'newforge.unlockPartSlot':  { fn: 'unlockNewForgePartSlot',  args: { furnaceId: 'str' },        dirty: ['newforge', 'header'] },
  'newforge.markTabSeen':     { fn: null,                      args: {},                          dirty: ['header'] },
  'newforge.markNoticeShown': { fn: null,                      args: {},                          dirty: [] },

  /* -- 熔爐設定 / 拆解設定 -- */
  'factory.setSalvageSettings': { fn: null, args: { maxRarity: 'int?', maxLevel: 'int?', maxAncient: 'int?' }, dirty: ['factory'] },
  'factory.setAutoEquip':       { fn: null, args: { on: 'bool' },                                 dirty: ['factory'] },

  /* -- 設定 -- */
  'settings.set':          { fn: null,               args: { key: 'str', value: 'any' },          dirty: ['header'] },

  /* -- 存檔 -- */
  'save.manual':           { fn: 'manualSave',       args: { label: 'str?' },                     dirty: [] },
  'save.toFolder':         { fn: 'createManualSaveToFolderV2', args: { label: 'str?' },           dirty: [] },
  'save.restart':          { fn: 'restartGame',      args: {},                                    dirty: PANEL_KEYS },

  /* -- GM（僅本機測試服可用，Worker 端仍需自行檢查 host）-- */
  'gm.exec':               { fn: null,               args: { line: 'str' },                       dirty: PANEL_KEYS }
};

/* ---- Worker 內部函式，禁止列為指令 ----
   這些是模擬層的內部流程，目前被 ui.js 直接呼叫，屬於 UI 越界驅動模擬內部。
   P3 必須把這些呼叫點移除或改成正式指令，不得為它們新增指令通道。 */
var INTERNAL_ONLY = ['addToInventory', 'rollGemShop', 'shopHourlyReset', 'forgeLog',
                     'newForgeReturnUnroutable'];

/* ---- 查詢函式（惰性初始化，不是指令）----
   forgeState / gemShop 會在第一次呼叫時建立子狀態；它們只能在 Worker 端執行，
   主執行緒改由 snapshot 取得結果。 */
var LAZY_QUERIES = ['forgeState', 'gemShop', 'skillLevel', 'availableSkillPoints'];

function commandSpec(name) {
  return Object.prototype.hasOwnProperty.call(COMMANDS, name) ? COMMANDS[name] : null;
}

function isValidCommand(name) {
  return !!commandSpec(name);
}

function _typeOk(type, v) {
  switch (type) {
    case 'int': return typeof v === 'number' && isFinite(v) && Math.floor(v) === v;
    case 'num': return typeof v === 'number' && isFinite(v);
    case 'bool': return typeof v === 'boolean';
    case 'str': return typeof v === 'string';
    case 'id': return typeof v === 'string' && v.length > 0;
    case 'ids': return Array.isArray(v) && v.every(function (x) { return typeof x === 'string' && x.length > 0; });
    case 'obj': return !!v && typeof v === 'object' && !Array.isArray(v);
    case 'any': return true;
    default: return false;
  }
}

/* 驗證指令參數。通過回傳 null，否則回傳錯誤字串（供 ACK.error 使用）。 */
function validateCommand(name, args) {
  var spec = commandSpec(name);
  if (!spec) return 'unknown command: ' + name;
  var a = args || {};
  for (var key in spec.args) {
    if (!Object.prototype.hasOwnProperty.call(spec.args, key)) continue;
    var type = spec.args[key];
    var optional = type.charAt(type.length - 1) === '?';
    if (optional) type = type.slice(0, -1);
    var v = a[key];
    if (v === undefined || v === null) {
      if (optional) continue;
      return 'missing arg: ' + name + '.' + key;
    }
    if (!_typeOk(type, v)) return 'bad arg type: ' + name + '.' + key + ' expected ' + type;
  }
  return null;
}

function isPanelKey(name) {
  return PANEL_KEYS.indexOf(name) !== -1;
}

/* Node 測試用；瀏覽器與 Worker 端不會進入此分支。 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    WORKER_PROTOCOL_VERSION: WORKER_PROTOCOL_VERSION,
    MSG_IN: MSG_IN,
    MSG_OUT: MSG_OUT,
    PANEL_KEYS: PANEL_KEYS,
    EVENT_KINDS: EVENT_KINDS,
    PERSIST_KINDS: PERSIST_KINDS,
    TICK_VIEW_KEYS: TICK_VIEW_KEYS,
    COMMANDS: COMMANDS,
    INTERNAL_ONLY: INTERNAL_ONLY,
    LAZY_QUERIES: LAZY_QUERIES,
    commandSpec: commandSpec,
    isValidCommand: isValidCommand,
    validateCommand: validateCommand,
    isPanelKey: isPanelKey
  };
}
