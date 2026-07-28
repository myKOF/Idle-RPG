'use strict';
/* ============ Worker 協議（單一資料來源） ============
   主執行緒與模擬 Worker 之間的唯一契約。三方協作期間，任何人不得在此檔以外
   自行定義訊息型別或指令名稱；需要新增一律由 Claude 改本檔並同步 docs/WORKER_PROTOCOL.md。

   本檔必須能在三種環境載入且行為一致：
     1. 主執行緒 <script src="js/worker/protocol.js">
     2. Worker    importScripts('protocol.js')
     3. Node 測試 vm.runInContext / require

   因此：只用 ES5 語法、只掛全域、不碰 DOM、不碰 localStorage。
   說明文件：docs/WORKER_PROTOCOL.md（與本檔同步，衝突時以本檔為準）。 */

var WORKER_PROTOCOL_VERSION = 7;

/* ---- 訊息型別：主執行緒 → Worker ---- */
var MSG_IN = {
  /* { save: <存檔物件|null>, now, maxRunId, safeMode? }
     maxRunId 供重新開局編號用。
     safeMode（v6 新增）：跳過離線結算直接開機。離線結算是開機流程裡最容易因為
     異常存檔資料而拋錯的一段，安全模式讓玩家至少能進到遊戲裡把存檔匯出。 */
  BOOT: 'boot',
  LOAD: 'load',              // { save }  執行中讀檔：替換整份狀態（v2 新增）
  CMD: 'cmd',                // { id, name, args }
  /* { name, params? }  索取面板資料。
     params 由各面板自行定義，目前只有 inv 使用（v5 新增）：
       inv: { detailIds?: [id, ...] }
     背包預設只回傳格子需要的欄位投影，不含 affixes——實測後期存檔 800 件，
     完整資料 305 KB，其中詞條就佔了六成。明細改為按 id 索取，
     由 UI 決定要哪幾件（例如可見範圍或選取項）。 */
  PANEL: 'panel',
  /* { hidden, pip, at }
     pip（v7 新增）：迷你監控視窗是否開著。開著時 Worker 不休眠也不落地 SHUTDOWN——
     玩家是刻意開它來邊做別的事邊看戰鬥的，分頁雖然隱藏但畫面確實在被觀看。 */
  VISIBILITY: 'visibility',
  SAVE_RESULT: 'saveResult', // { token, ok, error }
  PING: 'ping'               // { t }  存活探測
};

/* ---- 訊息型別：Worker → 主執行緒 ---- */
var MSG_OUT = {
  BOOTED: 'booted',   // { snapshot, offlineSummary, notices, protocolVersion }
  TICK: 'tick',       // { view, dirty, events }
  PANEL: 'panel',     // { name, data }
  FULL: 'full',       // { snapshot }
  /* { token, kind, payload: { json, meta } }  請主執行緒落地存檔。
     meta 由 Worker 端以既有的 saveRecMeta() 產生（它只讀 G、不碰儲存），
     主執行緒因此不需要、也不應該再去讀自己那份可能過期的 G。 */
  PERSIST: 'persist',
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
  /* nflog() 不另設種類：它在模擬層是直接呼叫 addLog('newforge-log', ...)，
     shim 已統一歸到 FLOG，UI 端只需處理一種熔爐日誌事件。 */
  LOOT: 'loot',     // { kind, ...}             對應 window.recordLoot*
  NOTICE: 'notice', // { key, text, modal }     一次性公告／改版提示
  /* { elId, text, cls, damageValue }  戰鬥飄字。
     elId 是目標圖層的元素 id（player 事件為 tp-float／tb-float，敵人為 mv-float-N），
     由 util.js 的 playerEventFloatTarget／enemyEventFloatTarget 在 Worker 內解析完成。
     ⚠️ 不帶 ent：主執行緒原本用物件識別比對，複本永遠不相等，請改以 elId 判斷目標。 */
  FLOAT: 'float'
};

/* ---- 存檔落地種類（PERSIST.kind）---- */
var PERSIST_KINDS = {
  AUTO: 'auto',        // 自動存檔（每 15 秒）
  MANUAL: 'manual',    // 手動存檔：優先寫瀏覽器存檔記錄，未連接資料夾時仍會落地
  MANUAL_FOLDER: 'manualFolder', // 明確「另存到資料夾」：未連接資料夾即視為失敗
  FOLDER: 'folder',    // 存檔資料夾同步（每 10 分鐘）
  SHUTDOWN: 'shutdown',// beforeunload / 分頁隱藏
  RESTART: 'restart'   // 重新開局：主執行緒寫入新局狀態後 reload（v2 新增）
};

/* ---- tick 高頻視圖欄位 ----
   只允許小量純量。背包、技能樹、熔爐等大型結構一律走 PANEL，不得塞進 tick。 */
var TICK_VIEW_KEYS = ['gold', 'scrap', 'essence', 'dust', 'ancientEssence', 'soulOrigin',
                      'demonSeed', 'gems', 'books', 'level', 'xp', 'xpMax', 'hp', 'hpMax',
                      'mp', 'mpMax', 'shield', 'stage', 'zone', 'gt', 'paused',
                      'towerActive', 'forgeBusy'];

/* ---- 指令表 ----
   fn      ：Worker 內實際呼叫的既有函式（沿用現有實作，禁止另寫平行版本）
             null 表示沒有可直接呼叫的既有函式，由 Worker 的 COMMAND_IMPL 實作
   args    ：參數型別。'?' 結尾表示可省略。
             int/num/bool/str/id/ids/ref（寶石素材參考）/slots（寶石轉換槽陣列）/obj/any
   resolve ：需要由 id 解析成**物件**再傳給 fn 的參數名清單。
             v3 起改為逐指令白名單——v1「參數名叫 itemId 就自動解析」的慣例是錯的：
             forgePlaceItem(id) 收的是字串 id，自動解析會傳錯型別進去。
   limit   ：參數約束（enum / min / max）。型別檢查擋不住 settings key 這種列舉值，
             也擋不住負數樓層。
   dirty   ：執行後預期會髒的面板（僅供 P4 驗證與除錯，實際仍以 UI.dirty 為準）

   ---- 物件識別（v3 修正）----
   跨執行緒不能傳物件參考，對象一律用識別字串表達。但**識別方式因物件而異**，
   v1 把「一律傳 item.id」套到所有東西上是錯的：
     - 裝備、零件、融合寶石：有實例 id（`uid()` 產生）
     - 一般寶石：是 { type, level } 的計數，**根本沒有 id** → 必須傳 type + level
     - 技能、天賦、附魔書：用定義鍵（definition key），不是實例 id
     - 熔爐：id 由 nf.nextId++ 產生，是**數字**不是字串
   寶石融合素材（fuseGemsV2 的 ref）另有結構：
     { kind:'plain', type, lv } 或 { kind:'fused', id } */
var COMMANDS = {
  /* -- 關卡與戰鬥 -- */
  'stage.go':              { fn: 'stageGo',          args: { delta: 'int' },                      dirty: ['battle', 'header'] },
  /* 一鍵衝到最高關：必須由 Worker 端判定。主執行緒用可能落後的鏡像算 best-current
     再送 delta 會有競態，玩家連點時尤其容易算錯。 */
  'stage.goMax':           { fn: 'stageGoMax',       args: {},                                    dirty: ['battle', 'header'] },
  'stage.switchZone':      { fn: 'switchZone',       args: { zoneKey: 'str' },                    dirty: ['battle', 'header'] },
  'stage.setAutoAdvance':  { fn: null,               args: { on: 'bool' },                        dirty: ['battle'] },
  'combat.setPaused':      { fn: 'setCombatPaused',  args: { paused: 'bool' },                    dirty: ['battle'] },
  'combat.togglePaused':   { fn: 'toggleCombatPaused', args: {},                                  dirty: ['battle'] },

  /* -- 背包與裝備 --
     equip / unequip / salvage 都是 fn:null：UI 現行流程除了呼叫模擬層函式，還包含
     「從背包移除、替換下來的裝備退回背包」等狀態轉移。只呼叫 equipItem / doSalvage
     會複製出第二件物品。P3 必須在 Worker 端實作成單一原子操作。 */
  'item.equip':            { fn: null,               args: { itemId: 'id', slotKey: 'str?', setIndex: 'int?' }, dirty: ['equip', 'inv', 'header'] },
  'item.unequip':          { fn: null,               args: { itemId: 'id', slotKey: 'str?' },     dirty: ['equip', 'inv', 'header'] },
  'item.setLock':          { fn: null,               args: { itemId: 'id', locked: 'bool' },      dirty: ['inv', 'equip'] },
  'item.salvage':          { fn: null,               args: { itemId: 'id' },                      dirty: ['inv', 'factory', 'header', 'gems'] },
  'item.salvageBulk':      { fn: null,               args: { maxRarity: 'int?', maxLevel: 'int?', maxAncient: 'int?' }, dirty: ['inv', 'factory', 'header', 'gems'] },
  'item.upgrade':          { fn: 'manualUpgrade',    args: { itemId: 'id' }, resolve: ['itemId'],  dirty: ['inv', 'equip', 'header'] },
  'item.enchant':          { fn: 'manualEnchant',    args: { itemId: 'id', bookKey: 'str' }, resolve: ['itemId'], dirty: ['inv', 'equip', 'header'] },
  'item.removeEnchant':    { fn: 'removeEnchantAt',  args: { itemId: 'id', index: 'int' }, resolve: ['itemId'], dirty: ['inv', 'equip'] },
  /* rerollSingleAffix(it, affixKey) 是用詞條鍵定位，不是索引。
     用索引會在詞條順序變動時洗到別條。 */
  'item.rerollAffix':      { fn: 'rerollSingleAffix', args: { itemId: 'id', affixKey: 'str' }, resolve: ['itemId'], dirty: ['inv', 'equip', 'header'] },

  /* -- 寶石 --
     一般寶石沒有實例 id（是 { type, level } 計數），只有融合寶石有 id。
     v1 對所有寶石指令都要求 gemId 是錯的，這裡依實際函式簽章修正。 */
  'gem.socket':            { fn: 'socketGem',        args: { itemId: 'id', type: 'str' }, resolve: ['itemId'], dirty: ['inv', 'equip', 'gems', 'header'] },
  'gem.socketFused':       { fn: 'socketFusedGem',   args: { itemId: 'id', fusedId: 'id' }, resolve: ['itemId'], dirty: ['inv', 'equip', 'gems', 'header'] },
  'gem.unsocket':          { fn: 'unsocketGem',      args: { itemId: 'id', index: 'int' }, resolve: ['itemId'], dirty: ['inv', 'equip', 'gems', 'header'] },
  'gem.dismantle':         { fn: 'dismantleGem',     args: { type: 'str', level: 'int' },         dirty: ['gems', 'header'] },
  'gem.dismantleFused':    { fn: 'dismantleFusedGem', args: { fusedId: 'id' },                    dirty: ['gems', 'header'] },
  'gem.convert':           { fn: 'convertGems',      args: { slots: 'slots', targetType: 'str' }, dirty: ['gems'] },
  'gem.compose':           { fn: 'composeGems',      args: { type: 'str', level: 'int' },         dirty: ['gems'] },
  /* 全部合成／全部拆解：現行 UI 是同步 while 迴圈（最多 2500 與 999 次）。
     逐次跨執行緒往返不可行，必須在 Worker 內一次跑完再回報結果。 */
  'gem.composeAll':        { fn: null,               args: { type: 'str', level: 'int' },         dirty: ['gems', 'header'] },
  'gem.dismantleAll':      { fn: null,               args: { type: 'str', level: 'int' },         dirty: ['gems', 'header'] },
  'gem.fuse':              { fn: 'fuseGemsV2',       args: { ref1: 'ref', ref2: 'ref' },          dirty: ['gems'] },
  'gem.shopBuy':           { fn: 'buyShopGem',       args: { index: 'int' },                      dirty: ['gems', 'header'] },
  'gem.shopBuyAll':        { fn: 'buyAllShopGems',   args: {},                                    dirty: ['gems', 'header'] },
  'gem.shopRefresh':       { fn: 'refreshGemShop',   args: {},                                    dirty: ['gems', 'header'] },
  'gem.shopUpgrade':       { fn: 'upgradeGemShop',   args: {},                                    dirty: ['gems', 'header'] },

  /* -- 角色 -- */
  'player.reincarnate':      { fn: 'reincarnate',       args: {},                                 dirty: ['header', 'equip', 'inv', 'skills', 'talents'] },
  'player.switchEquipSet':   { fn: 'switchToEquipSet',  args: { index: 'int' },                   dirty: ['equip', 'inv', 'header'] },
  /* 只換「檢視中」的套組，不換穿。與 switchEquipSet 是兩件事，v1 漏了這條，
     導致預覽屬性只能靠實際換穿才做得到。 */
  'player.setEquipView':     { fn: 'setEquipView',      args: { index: 'int' },                   dirty: ['equip', 'inv'] },
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

  /* -- 天賦與潛能 --
     id 是天賦定義鍵（def.id），不是實例 id，不需要解析成物件。 */
  'talent.upgrade':        { fn: 'talentUpgrade',    args: { id: 'str' },                         dirty: ['talents', 'header'] },
  'talent.max':            { fn: 'talentMax',        args: { id: 'str' },                         dirty: ['talents', 'header'] },
  'talent.downgrade':      { fn: 'talentDowngrade',  args: { id: 'str' },                         dirty: ['talents', 'header'] },
  'talent.delete':         { fn: 'talentDelete',     args: { id: 'str' },                         dirty: ['talents', 'header'] },
  'talent.potentialUpgrade':   { fn: 'potentialUpgrade',   args: { id: 'str' },                   dirty: ['talents', 'header'] },
  'talent.potentialMax':       { fn: 'potentialMax',       args: { id: 'str' },                   dirty: ['talents', 'header'] },
  'talent.potentialDowngrade': { fn: 'potentialDowngrade', args: { id: 'str' },                   dirty: ['talents', 'header'] },
  'talent.potentialDelete':    { fn: 'potentialDelete',    args: { id: 'str' },                   dirty: ['talents', 'header'] },

  /* -- 煉獄之塔 -- */
  /* fn:null：手動挑戰同時代表「取消等待中的連挑」（ui.js 現行是先清 TOWER.auto 再開打）。
     這個狀態轉移必須與開打同一個原子操作，否則清除與開打之間的 tick 會看到中間狀態。 */
  'tower.start':           { fn: null,               args: { floor: 'int' }, limit: { floor: { min: 1 } }, dirty: ['tower', 'battle'] },
  'tower.startAuto':       { fn: 'startTowerAuto',   args: { floor: 'int', count: 'int' }, limit: { floor: { min: 1 }, count: { min: 1 } }, dirty: ['tower', 'battle'] },
  'tower.finish':          { fn: 'finishTowerFight', args: {},                                    dirty: ['tower', 'battle'] },
  /* 結算確認：含連挑續場判定，語意比 finish 大，不能用 finish 取代 */
  'tower.confirmResult':   { fn: 'confirmTowerResult', args: {},                                  dirty: ['tower', 'battle', 'header'] },
  'tower.flee':            { fn: 'fleeTower',        args: {},                                    dirty: ['tower', 'battle'] },
  'tower.stopAuto':        { fn: 'stopTowerAutoFromResult', args: {},                             dirty: ['tower'] },

  /* -- 神鑄（forge）--
     forgePlaceItem(id) 收字串 id，所以沒有 resolve；forgePlaceGem(type, level)
     收一般寶石的 type+level；forgeToggleDust(idx) 需要索引，v1 宣告成無參數是錯的。 */
  'forge.placeItem':       { fn: 'forgePlaceItem',   args: { itemId: 'id' },                      dirty: ['forge', 'inv'] },
  'forge.removeItem':      { fn: 'forgeRemoveItem',  args: { slotIndex: 'int' }, limit: { slotIndex: { min: 0 } }, dirty: ['forge', 'inv'] },
  'forge.placeGem':        { fn: 'forgePlaceGem',    args: { type: 'str', level: 'int' },         dirty: ['forge', 'gems'] },
  'forge.unloadAll':       { fn: 'forgeUnloadAll',   args: {},                                    dirty: ['forge', 'inv', 'gems'] },
  'forge.toggleDust':      { fn: 'forgeToggleDust',  args: { index: 'int' }, limit: { index: { min: 0 } }, dirty: ['forge'] },
  'forge.autoFillDust':    { fn: 'forgeAutoFillDust', args: {},                                   dirty: ['forge'] },
  'forge.start':           { fn: 'doForge',          args: {},                                    dirty: ['forge', 'inv', 'gems'] },
  'forge.cancel':          { fn: 'cancelForge',      args: {},                                    dirty: ['forge', 'inv', 'gems'] },
  'forge.setAuto':         { fn: null,               args: { key: 'str', on: 'bool' },
                             limit: { key: { enum: ['autoDust', 'autoForge'] } },                 dirty: ['forge'] },
  /* 自動放入設定：kind='equip' 帶 rarity，kind='gem' 帶 gemType+gemLevel，
     兩者皆省略表示清除該設定。 */
  'forge.setAutoFill':     { fn: null,               args: { kind: 'str', rarity: 'int?', gemType: 'str?', gemLevel: 'int?' },
                             limit: { kind: { enum: ['equip', 'gem', 'clear'] } },                dirty: ['forge'] },

  /* -- 熔爐（newforge）--
     furnaceId 由 nf.nextId++ 產生，是數字。
     newForgeInstallPart(furnaceId, partKey) 收零件「種類鍵」並自動挑同類最高階，
     不是零件實例 id——沿用現行選料規則，不在遷移期間改變行為。 */
  'newforge.addFurnace':      { fn: 'addNewForgeFurnace',      args: {},                          dirty: ['newforge'] },
  'newforge.removeFurnace':   { fn: 'removeNewForgeFurnace',   args: { furnaceId: 'int' },        dirty: ['newforge', 'inv'] },
  'newforge.installPart':     { fn: 'newForgeInstallPart',     args: { furnaceId: 'int', partKey: 'str' }, dirty: ['newforge', 'factory'] },
  'newforge.uninstallPart':   { fn: 'newForgeUninstallPart',   args: { furnaceId: 'int', slotIndex: 'int' }, limit: { slotIndex: { min: 0 } }, dirty: ['newforge', 'factory'] },
  'newforge.unlockPartSlot':  { fn: 'unlockNewForgePartSlot',  args: { furnaceId: 'int' },        dirty: ['newforge', 'header'] },
  /* 品質勾選與啟用開關：UI 現行做法是直接改 fu.qualities[] / fu.enabled 再呼叫
     內部函式 newForgeReturnUnroutable。改成指令後由 Worker 內部完成退回佇列，
     INTERNAL_ONLY 不對外開放。 */
  'newforge.setQuality':      { fn: null,  args: { furnaceId: 'int', rarity: 'int', on: 'bool' }, limit: { rarity: { min: 0 } }, dirty: ['newforge'] },
  'newforge.setEnabled':      { fn: null,  args: { furnaceId: 'int', on: 'bool' },                dirty: ['newforge'] },
  'newforge.markTabSeen':     { fn: null,                      args: {},                          dirty: ['header'] },
  'newforge.markNoticeShown': { fn: null,                      args: {},                          dirty: [] },

  /* -- 熔爐設定 / 拆解設定 -- */
  'factory.setSalvageSettings': { fn: null, args: { maxRarity: 'int?', maxLevel: 'int?', maxAncient: 'int?' }, dirty: ['factory'] },
  'factory.setAutoEquip':       { fn: null, args: { on: 'bool' },                                 dirty: ['factory'] },

  /* -- 統計 --
     RUN_STATS 與 LOOT_STATS 都建立在 Worker 內（combat.js / stats.js），
     主執行緒拿到的只是投影，清除必須由 Worker 執行。 */
  'stats.reset':           { fn: null,               args: {},                                    dirty: ['battle'] },

  /* -- 設定 --
     任意 key/value 等於開一個可以寫進任何狀態的後門，改為白名單。 */
  'settings.set':          { fn: null,               args: { key: 'str', value: 'bool' },
                             limit: { key: { enum: ['compareEq'] } },                             dirty: ['header', 'inv', 'equip'] },

  /* -- 存檔 --
     v2 修正：這三條原本宣告直接呼叫 manualSave / createManualSaveToFolderV2 / restartGame，
     但那些函式會碰 localStorage、IndexedDB、File System Access 與 location.reload，
     Worker 一律不能碰，與「I/O 留主執行緒」的決策衝突。
     改為 fn:null，由 Worker 端產生 payload 後發 persist，主執行緒完成落地與 reload。 */
  'save.manual':           { fn: null,               args: { label: 'str?' },                     dirty: [] },
  'save.toFolder':         { fn: null,               args: { label: 'str?' },                     dirty: [] },
  'save.restart':          { fn: null,               args: {},                                    dirty: PANEL_KEYS },

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

function _isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }

/* 寶石融合素材：{ kind:'plain', type, lv } 或 { kind:'fused', id } */
function _isGemRef(v) {
  if (!v || typeof v !== 'object') return false;
  if (v.kind === 'plain') return typeof v.type === 'string' && (v.lv === undefined || _isInt(v.lv));
  if (v.kind === 'fused') return typeof v.id === 'string' && v.id.length > 0;
  return false;
}

/* 寶石轉換槽：[{ type, lv, n }, ...] */
function _isGemSlots(v) {
  return Array.isArray(v) && v.length > 0 && v.every(function (s) {
    return s && typeof s === 'object' && typeof s.type === 'string' && _isInt(s.lv) && _isInt(s.n) && s.n > 0;
  });
}

function _typeOk(type, v) {
  switch (type) {
    case 'int': return _isInt(v);
    case 'num': return typeof v === 'number' && isFinite(v);
    case 'bool': return typeof v === 'boolean';
    case 'str': return typeof v === 'string';
    case 'id': return typeof v === 'string' && v.length > 0;
    case 'ids': return Array.isArray(v) && v.every(function (x) { return typeof x === 'string' && x.length > 0; });
    case 'ref': return _isGemRef(v);
    case 'slots': return _isGemSlots(v);
    case 'obj': return !!v && typeof v === 'object' && !Array.isArray(v);
    case 'any': return true;
    default: return false;
  }
}

/* 驗證指令參數。通過回傳 null，否則回傳錯誤字串（供 ACK.error 使用）。
   v3 起：多餘欄位一律拒絕。放行未宣告的欄位會讓「主執行緒與 Worker 版本不一致」
   靜靜通過——指令看起來成功了，但多送的參數根本沒被讀取。 */
function validateCommand(name, args) {
  var spec = commandSpec(name);
  if (!spec) return 'unknown command: ' + name;
  var a = args || {};
  var key, v;

  for (key in a) {
    if (!Object.prototype.hasOwnProperty.call(a, key)) continue;
    if (!Object.prototype.hasOwnProperty.call(spec.args, key)) {
      return 'unexpected arg: ' + name + '.' + key;
    }
  }

  for (key in spec.args) {
    if (!Object.prototype.hasOwnProperty.call(spec.args, key)) continue;
    var type = spec.args[key];
    var optional = type.charAt(type.length - 1) === '?';
    if (optional) type = type.slice(0, -1);
    v = a[key];
    if (v === undefined || v === null) {
      if (optional) continue;
      return 'missing arg: ' + name + '.' + key;
    }
    if (!_typeOk(type, v)) return 'bad arg type: ' + name + '.' + key + ' expected ' + type;

    var lim = spec.limit && spec.limit[key];
    if (lim) {
      if (lim.enum && lim.enum.indexOf(v) === -1) {
        return 'bad arg value: ' + name + '.' + key + ' must be one of ' + lim.enum.join('/');
      }
      if (lim.min !== undefined && v < lim.min) return 'bad arg value: ' + name + '.' + key + ' < ' + lim.min;
      if (lim.max !== undefined && v > lim.max) return 'bad arg value: ' + name + '.' + key + ' > ' + lim.max;
    }
  }
  return null;
}

/* 這條指令有哪些參數要由 id 解析成物件再傳給 fn */
function resolveKeys(name) {
  var spec = commandSpec(name);
  return (spec && spec.resolve) ? spec.resolve : [];
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
    resolveKeys: resolveKeys,
    isPanelKey: isPanelKey
  };
}
