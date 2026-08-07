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

/* v18（2026-08-05 主線任務系統）：PANEL_KEYS 新增 task（任務總覽投影）；
   TICK_VIEW_KEYS 新增 taskIdx / taskProg / taskReady（戰鬥區任務快捷列用的三個純量，
   任務名稱與獎勵文字由主執行緒讀共載的 TASKS 表——js/data.js，不隨 tick 傳送）；
   新增指令 task.claim（領取當前任務獎勵並前進到下一個），87 → 88。
   v17（2026-08-04 戰鬥特效酷炫化）：VFX 事件新增 elem / cat / variant / delayMs 四個
   可選欄位（見 EVENT_KINDS.VFX 註解）；fxKind 新增 curse（敵身詛咒）、chain（連鎖雷鏈）、
   impact（純受擊）三種原型。普攻與天罰開始經由 VFX 事件送出特效。
   v16：新增 newforge.upgradePart（熔爐零件升級），86 → 87
   v15（2026-08-02 詞條規則外送）：equip 面板新增 affixRules（每種詞條的可用部位與
   品質門檻，取自 AFFIX_POOL）。任何「想洗出某條詞條」的一方不必再自己抄一份部位清單。 */
var WORKER_PROTOCOL_VERSION = 18;

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
  /* { hidden, at }
     v9 起隱藏不再改變模擬行為——分頁在背景就是在線掛機，只有整個遊戲被關掉才算離線。
     這則訊息剩下的唯一作用是讓 Worker 在切走時落地一次存檔。
     `pip`（v7 加入）已移除：它存在的唯一理由是「觀戰中要豁免背景休眠」，
     休眠機制沒了就沒有接收端；PiP 功能本身不受影響。 */
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
                  'factory', 'tower', 'gems', 'skills', 'talents', 'task'];

/* ---- 事件種類（隨 tick 合批送出，禁止一則一次 postMessage）---- */
var EVENT_KINDS = {
  LOG: 'log',       // { msg, cls, cat }        對應 blog()
  FLOG: 'flog',     // { msg, cls }             對應 flog()
  /* nflog() 不另設種類：它在模擬層是直接呼叫 addLog('newforge-log', ...)，
     shim 已統一歸到 FLOG，UI 端只需處理一種熔爐日誌事件。 */
  LOOT: 'loot',     // { kind, ...}             對應 window.recordLoot*
  NOTICE: 'notice', // { key, text, modal }     一次性公告／改版提示
  /* { elId, text, cls, damageValue, delayMs }  戰鬥飄字。
     elId 是目標圖層的元素 id（player 事件為 tp-float／tb-float，敵人為 mv-float-N），
     由 util.js 的 playerEventFloatTarget／enemyEventFloatTarget 在 Worker 內解析完成。
     ⚠️ 不帶 ent：主執行緒原本用物件識別比對，複本永遠不相等，請改以 elId 判斷目標。
     delayMs（v11 新增，可選）：顯示端延後多久才把這則浮字畫出來。
     模擬層是一瞬間把整段傷害結算完的，但畫面上投射物要飛、多段技一段一段打——
     不延後的話數字會在子彈還沒飛到時就跳出來，多段技也會擠成一團看起來像只打一下。
     這是純顯示時序，戰鬥結算（傷害、擊殺、觸發）完全不受影響。 */
  FLOAT: 'float',
  /* { fxKind, glyph, color, targets, cells, dur, count }  技能／增益特效（v10 新增）。
     模擬層只描述「發生了什麼」，不碰任何 DOM——實際畫法完全由主執行緒的 js/vfx.js 決定。

     fxKind  特效原型：projectile 投射物／slash 斬擊／burst 爆發／beam 貫穿／
             rain 天降／aura 領域／selfBuff 我方增益／curse 敵身詛咒（v17）／
             chain 連鎖雷鏈（v17，targets 順序即彈跳路徑）／impact 純受擊（v17）。
             由 skillVfxSpec() 依技能資料推導；普攻與天罰由 combat.js 直接組事件。
             （欄位不能叫 kind——shim 會把事件種類寫進 event.kind，會被蓋掉。）
     targets 目標圖層 id 陣列（mv-float-N／tb-float），定址方式與 FLOAT 一致——
             同樣不得帶實體參照，理由見上。
     cells   區域類特效覆蓋的棋盤格 [{col,row}]，供 aura／rain 定位；非區域類為 null。
     dur     持續秒數（aura 用實際領域持續時間，其餘為動畫長度）。
     count   投射物／斬擊段數（僅視覺，與實際命中次數無關，上限由 UI 端夾）。
     travelMs（v12 新增）：與 targets 同順序的飛行時間陣列（毫秒）。
             投射物是**等速**飛行，時間＝我方到該目標中心的距離÷速度，所以打第 4 行
             比打第 1 行慢。固定飛行時間會讓近的子彈慢吞吞、遠的又太快。
             同一組數字也拿去當 FLOAT 的 delayMs，子彈與傷害數字因此必定同時到。
     elem（v17，可選）：元素鍵 fire/ice/lightning/poison/light/dark/earth 或 null。
             顯示層據此挑選元素化畫法（火球拖焰／冰晶碎裂／電花／毒泡／聖光／暗渦）
             與命中時的受擊特效；null 時退回 color 單色畫法。
     cat（v17，可選）：技能分類（phys/magic/def/special/fusion/potential）或
             'basic'（普攻）／'enemy'（敵方動作），供顯示層微調風格。
     variant（v17，可選）：特效變體字串（meteor/pillar/chain/cyclone/…，清單見
             js/skills.js SKILL_VFX_OVERRIDE 註解）。顯示層不認得的 variant 一律
             退回該原型預設畫法，因此新增變體不需要動協議。
     delayMs（v17，可選）：整則特效的基礎延遲（毫秒）——追加劍氣、天罰神雷等
             「接在前一段動作之後」的特效用它錯開時刻。 */
  VFX: 'vfx'
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
   只允許小量純量。背包、技能樹、熔爐等大型結構一律走 PANEL，不得塞進 tick。

   ⚠️ 這裡有兩個時鐘，用途不同，不可互換：

     gt    遊戲時鐘（js/util.js 的 GT）。**戰鬥暫停時停住**，那是它的語意——
           它衡量的是「打了多久」，給玩家看的。
     simT  模擬時鐘（js/worker/sim.worker.js 的 SIM_T，v14 新增）。每一步都前進，
           暫停照走。它衡量的是「模擬跑了多久」。

   為什麼需要第二個：暫停期間 simStep 仍在跑 factoryTick / newForgeTick / forgeTick，
   狀態有在動，但 gt 完全不動。任何想用時間軸把兩次執行對齊的東西——真人軌跡重播
   （scripts/sim/trace.js）、瀏覽器↔headless 交叉驗證（scripts/cross_check.js）——
   拿 gt 當軸就會在暫停那一段整批錯開，而且分岔點會出現在暫停之後好幾秒，看起來像別的原因。 */
var TICK_VIEW_KEYS = ['gold', 'scrap', 'essence', 'dust', 'ancientEssence', 'soulOrigin',
                      'demonSeed', 'magicScroll', 'gems', 'books', 'level', 'xp', 'xpMax', 'hp', 'hpMax',
                      'mp', 'mpMax', 'shield', 'stage', 'zone', 'gt', 'simT', 'paused',
                      'towerActive', 'forgeBusy',
                      /* 任務快捷列（v18）：taskIdx = 目前任務索引（-1 = 全部完成）、
                         taskProg = 目前進度值、taskReady = 已達成可領取。
                         目標數量與文字由主執行緒讀共載 TASKS 表，不進高頻視圖。 */
                      'taskIdx', 'taskProg', 'taskReady'];

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
     newForgeInstallPart(furnaceId, partKey) 收零件「種類鍵」，
     不是零件實例 id；裝配直接使用 factory.partLevels 的目前等級。 */
  'newforge.addFurnace':      { fn: 'addNewForgeFurnace',      args: {},                          dirty: ['newforge'] },
  'newforge.removeFurnace':   { fn: 'removeNewForgeFurnace',   args: { furnaceId: 'int' },        dirty: ['newforge', 'inv'] },
  'newforge.installPart':     { fn: 'newForgeInstallPart',     args: { furnaceId: 'int', partKey: 'str' }, dirty: ['newforge', 'factory'] },
  'newforge.upgradePart':     { fn: 'newForgeUpgradePart',     args: { partKey: 'str' }, dirty: ['newforge', 'header'] },
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

  /* -- 主線任務（v18）--
     嚴格循序：只有 taskState.idx 那一筆可領。進度與達成判定都在 Worker 端
     （js/tasks.js taskClaim），未達成回 { err }。獎勵可能發金幣/碎片/精華（header）、
     裝備（inv）、寶石（gems）、技能經驗（skills），故髒面板涵蓋四者。 */
  'task.claim':            { fn: 'taskClaim',        args: {},                                    dirty: ['task', 'header', 'inv', 'gems', 'skills'] },

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

  /* -- 分頁交接（v8 新增）--
     多分頁互斥（js/tablock.js）用：另一個分頁按下「在此接管」時，正在遊玩的分頁必須
     先把進度落地再交出控制權，否則玩家會掉最多一次自動存檔間隔（15 秒）的進度。

     同時停止模擬迴圈：交接後這顆 Worker 通常會隨著 reload 一起消失，但「通常」不夠——
     只要落地與 reload 之間任何一步出錯，一顆不再持有鎖卻還在跑、還在存檔的 Worker
     就是這套鎖要防的多寫入問題本身。停迴圈是那條路徑的保險，不是效能考量。 */
  'app.handoff':           { fn: null,               args: {},                                    dirty: [] },

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
