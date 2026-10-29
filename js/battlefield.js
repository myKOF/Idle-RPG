'use strict';
/* ============ 戰場座標（站位 + 逼近 + 選敵 + 範圍展開） ============
   本檔是「誰站在哪、該打誰、打不打得到、範圍打到誰」的唯一真實來源。
   模擬層（combat.js／skills.js）與顯示層都只呼叫這裡，不得自行實作第二套距離或選敵規則。

   必須能在三種環境載入且行為一致：
     1. 主執行緒 <script src="js/battlefield.js">
     2. Worker    importScripts('../battlefield.js')
     3. Node 測試 vm.runInContext
   因此：只用 ES5 語法、只掛全域、不碰 DOM、不碰 UI。

   ---- 2026-08-12：格子 → 連續座標 ----
   舊版把戰場切成 BF_COLS×BF_ROWS 的棋盤，敵人配到一格就站著不動，
   距離只有「第幾行」這種粗顆粒，而且**完全沒有攻擊距離的概念**：
   站在最後一行的敵人照樣打得到玩家。畫面上就是雙方隔空互毆。

   現在改成連續座標：
     - 我方與敵人都有絕對座標 { x, y }（單位≈像素），玩家起點是原點。
     - 我方會自己朝目標跑（bfTickPlayer），敵人各自追我方的**當前**位置。
     - 敵人在配置視野內發現我方後，每個 tick 朝我方逼近，走到停止距離就停，並與同伴互相推開。
     - 距離＝真正的歐幾里得距離；能不能攻擊要看距離（bfInAttackRange）。
     - 範圍技從「n×n 方框」改成以主目標為中心的圓（半徑由 n 換算）。

   ---- 2026-08-13：我方也有座標 ----
   前一版我方恆在原點、敵人存的是「相對我方」的座標，於是我方一移動，
   整群敵人就跟著平移，像黏在身上。現在我方是場上的一個實體：
   自己跑向目標，敵人追的是他當下的位置——跑得慢的自然被拉開，再逐一追上來。
   棋盤常數 BF_COLS/BF_ROWS 只剩一個用途：兩者相乘＝**場上同時容納的敵人上限**。 */

/* ---- 容量（BF_COLS×BF_ROWS 的唯一剩餘用途）---- */
function bfCols() { return Math.max(1, Number(typeof BF_COLS !== 'undefined' ? BF_COLS : 4) || 4); }
function bfRows() { return Math.max(1, Number(typeof BF_ROWS !== 'undefined' ? BF_ROWS : 4) || 4); }
function bfCellCount() { return bfCols() * bfRows(); }

/* ---- 座標常數（→ js/data.js，可由參數表調整）---- */
function bfNum(name, fallback) {
  var v = (typeof self !== 'undefined' && self && self[name] !== undefined) ? self[name]
    : (typeof globalThis !== 'undefined' && globalThis[name] !== undefined) ? globalThis[name] : undefined;
  v = Number(v);
  return isFinite(v) && v > 0 ? v : fallback;
}
function bfUnit() { return bfNum('BF_UNIT', 60); }                    // 一個「身位」
function bfSpawnDist() { return bfNum('BF_SPAWN_DIST', 440); }        // 生成時離我方多遠
function bfContactDist() { return bfNum('BF_CONTACT_DIST', 46); }     // 走到這麼近就停
/* 我方只有一種速度：不是在移動就是站著。追擊與空場推進共用同一個值——
   兩段速度會讓畫面看起來忽快忽慢，像一下走路一下跑步。 */
function bfPlayerSpeed() { return bfNum('BF_PLAYER_SPEED', 300); }
/* 我方跑速的乘區：來源是新版技能的增益（岩甲術傳奇【輕飛甲】，
   收斂在 js/skills2.js 的 skill2PlayerMoveFactor）。
   本檔不認識任何技能，只認得「有沒有人提供倍率」——沒載入就恆為 1。 */
function bfPlayerSpeedFactor(pEnt) {
  if (typeof skill2PlayerMoveFactor !== 'function') return 1;
  var f = Number(skill2PlayerMoveFactor(pEnt));
  return (isFinite(f) && f > 0) ? f : 1;
}
/* 敵人跑速是獨立的值，不由我方換算——兩邊要能分開調。
   這是「沒有個別設定」時的預設；NPC 表有填移動速度的敵人用自己的 ent.runSpeed（bfEnemyRunSpeed）。 */
function bfEnemySpeed() { return bfNum('BF_ENEMY_SPEED', 210); }
function bfEnemyRunSpeed(ent) {
  var v = Number(ent && ent.runSpeed);
  return v > 0 ? v : bfEnemySpeed();
}
/* 單一敵人的跑速倍率：來源是新版技能的場域型緩速（泥沼術×冰系寒霜，
   收斂在 js/skills2.js 的 skill2SlowMoveFactor）。
   本檔不認識任何技能，只認得「有沒有人提供倍率」——沒載入就恆為 1。 */
function bfEnemySpeedFactor(ent) {
  // 移速降低類的控場只在「移速控場」生效期間作用（狀態還掛著但控場遞減掉了＝不減速）→ combat.js ccLockOn
  if (typeof ccLockOn === 'function' && !ccLockOn(ent, 'move')) return 1;
  var src = (typeof skill2SlowMoveFactor === 'function') ? skill2SlowMoveFactor
    : ((typeof skill2MoveSlowFactor === 'function') ? skill2MoveSlowFactor : null);
  if (!src) return 1;
  var f = Number(src(ent));
  return (isFinite(f) && f > 0) ? Math.min(1, f) : 1;
}
function bfMeleeRange() { return bfNum('BF_MELEE_RANGE', 50); }       // 近戰攻擊距離
function bfRangedRange() { return bfNum('BF_RANGED_RANGE', 320); }    // 沒有 NPC 表攻擊距離時，魔法系敵人的預設攻擊距離
/* 遠程敵人停在射程的這個比例處開火（近戰的 46/50 也是同一個比例）。
   不貼滿射程邊界，是為了同伴互相推擠時不會一直跨在射程線上來回補步。 */
function bfRangedStopRatio() { return bfNum('BF_RANGED_STOP_RATIO', 0.92); }
function bfBodyRadius() { return bfNum('BF_BODY_RADIUS', 20); }
function bfBossRadius() { return bfNum('BF_BOSS_RADIUS', 52); }

/* ---- 我方座標 ----
   全場座標的原點。這個物件會被就地改寫（不重新指派），
   讓 combat.js 把它掛進 FIELD 之後，面板每次序列化都拿到最新值。 */
var BF_PLAYER = { x: 0, y: 0 };
var BF_PLAYER_CHASING = false;     // 起步／停步的遲滯狀態（見 bfTickPlayer）
function bfPlayerPos() { return BF_PLAYER; }
function bfResetPlayer() { BF_PLAYER.x = 0; BF_PLAYER.y = 0; BF_PLAYER_CHASING = false; BF_PLAYER_OBS.id = 0; BF_PLAYER_OBS.side = 0; return BF_PLAYER; }

/* ---- 地形障礙（js/battle-terrain.js）----
   野外大型擺件（底座寬 ≥ BF_OBSTACLE_MIN_M 米，預設 12）是障礙：走路被擋住時沿邊緣滑開，
   隔著障礙不能近戰普攻；技能、投射物、範圍判定一律不受影響。封魔塔沒有野外地形，不啟用。
   位置與顯示層用的是同一份純函式（BattleTerrain.layoutChunk），所以看到的岩石就是擋路的岩石。
   沒載入 BattleTerrain 或沒有 G（多數單元測試）＝恆為沒有障礙。 */
var BF_PLAYER_OBS = { id: 0, side: 0 };     // 我方繞障礙的方向記憶（見 BattleTerrain.pushOut）
var BF_TERRAIN_ACTIVE = false;
/* 每個 tick 開頭呼叫一次（bfTickPlayer／bfTickApproach）：同步場景、門檻，並記下這個 tick 有沒有地形。 */
function bfTerrainSync() {
  var on = typeof BattleTerrain !== 'undefined' && typeof G !== 'undefined' && !!G && !!G.stage && !(G.tower && G.tower.active);
  if (on) {
    BattleTerrain.setScene(G.stage.zone || '', G.stage.current);
    BattleTerrain.setMinWidth(bfNum('BF_OBSTACLE_MIN_M', 12) * BF_SYSTEM_UNITS_PER_METER);
  }
  BF_TERRAIN_ACTIVE = on;
  return on;
}
/* 兩點之間有沒有障礙擋著（近戰判定用）。 */
function bfTerrainBlocks(ax, ay, bx, by) {
  return BF_TERRAIN_ACTIVE && BattleTerrain.segmentBlocked(ax, ay, bx, by);
}
/* 把一個實體從障礙裡推出來（goal＝牠想去的點，決定繞哪一側）。回傳是否被推動。 */
function bfTerrainPushOut(pos, radius, goalX, goalY, state) {
  return BF_TERRAIN_ACTIVE && BattleTerrain.pushOut(pos, radius, goalX, goalY, state);
}
function bfPlayerBodyRadius() { return (typeof ELITE_PLAYER_BODY_R === 'number' && ELITE_PLAYER_BODY_R > 0) ? ELITE_PLAYER_BODY_R : 18; }

/* 體型半徑：BOSS 比較大，所以「邊緣」比中心更早進入接觸距離。 */
function bfEntityRadius(ent) {
  if (ent && ent._bodyR > 0) return ent._bodyR;      // 菁英以上：體型倍率換算好的半徑（js/elite.js eliteEquip）
  return (ent && ent.isBoss) ? bfBossRadius() : bfBodyRadius();
}

function bfPos(ent) {
  if (ent && ent.pos && isFinite(ent.pos.x) && isFinite(ent.pos.y)) return ent.pos;
  return null;
}

/* 實體到我方的距離（扣掉體型：大隻的邊緣先碰到我方）。
   沒有座標的實體（高塔 BOSS 走另一條路徑）視為最遠，不會搶走普攻目標。 */
function bfEntityDistance(ent) {
  var p = bfPos(ent);
  if (!p) return Infinity;
  var c = bfPlayerPos();
  var dx = p.x - c.x, dy = p.y - c.y;
  return Math.max(0, Math.sqrt(dx * dx + dy * dy) - bfEntityRadius(ent));
}

/* 敵人的攻擊距離（座標單位、算到身體邊緣）。
   NPC 表有填攻擊距離的敵人用自己的 ent.atkRange；沒有的（高塔 BOSS、測試替身）
   維持改版前的規則：魔法系是遠程、其餘貼到近戰距離。 */
function bfEnemyAttackRange(ent) {
  var v = Number(ent && ent.atkRange);
  if (v > 0) return v;
  return (ent && ent.magic) ? bfRangedRange() : bfMeleeRange();
}
/* 圓形視野以雙方中心距離判定；發現一次便持續追擊。
   沒有視野欄位的舊實體／測試替身保留原行為。進場倒數期間不索敵。
   普攻、技能與移動共用這個入口，不能用攻擊射程繞過視野。 */
function bfAlertEnemy(ent) {
  if (!ent || ent._alerted) return;
  ent._alerted = true;
  if (ent._encounterKey && typeof GT === 'number') ent._frenzyStartAt = GT;
  if (ent._roam) ent._roam = null;
}
function bfEnemyAlerted(ent) {
  if (!ent || ent._enterCd > 0) return false;
  if (ent._alerted) return true;
  var range = Number(ent.sightRange);
  if (!(range > 0) || !isFinite(range)) return true;
  var p = bfPos(ent), c = bfPlayerPos();
  if (!p) return false;
  var dx = p.x - c.x, dy = p.y - c.y;
  if (dx * dx + dy * dy > range * range) return false;
  bfAlertEnemy(ent);
  return true;
}
/* 遠程敵人＝射程超過近戰距離兩倍。攻擊畫面（投射物 vs 近戰撲擊）與停步位置都看這個，
   不看 magic——魔法型只代表傷害類型，跟射程是兩件事。 */
function bfEnemyIsRanged(ent) {
  return bfEnemyAttackRange(ent) > bfMeleeRange() * 2;
}

/* 身體停步距離（接觸距離 + 自己的體型）。貼身類敵人的停步點，
   也是「拉近」類技能不能把敵人推進的最小距離。 */
function bfBodyStopDistance(ent) {
  return bfContactDist() + bfEntityRadius(ent);
}

/* 停止距離：走到這裡就不再前進。
   NPC 表有填攻擊距離的敵人：遠程停在射程內側（bfRangedStopRatio），站樁開火；
   近戰仍貼到接觸距離（射程比接觸距離短的，停在射程內側）。 */
function bfStopDistance(ent) {
  var range = Number(ent && ent.atkRange);
  if (!(range > 0)) return bfBodyStopDistance(ent);
  var inside = range * bfRangedStopRatio();
  var edge = bfEnemyIsRanged(ent) ? inside : Math.min(bfContactDist(), inside);
  return edge + bfEntityRadius(ent);
}

/* 打不打得到。打得到的距離由 bfEnemyAttackRange 決定。
   ⚠️ 這是改造前完全不存在的判定——舊版任何位置都打得到。 */
function bfInAttackRange(ent) {
  if (!ent) return false;
  if (!bfEnemyAlerted(ent)) return false;
  if (!bfPos(ent)) return true;                 // 沒有座標（高塔）＝沿用舊行為，不擋
  if (bfEntityDistance(ent) > bfEnemyAttackRange(ent)) return false;
  return !bfWallBlocksMelee(ent);
}
/* 築牆：近戰攻擊不能隔著牆（遠程不受影響）。js/elite.js eliteWallBlocks 沒載入就恆為不擋。 */
function bfWallBlocksMelee(ent) {
  if (bfEnemyIsRanged(ent)) return false;
  var p = bfPos(ent), c = bfPlayerPos();
  if (!p) return false;
  if (typeof eliteWallBlocks === 'function' && eliteWallBlocks(p.x, p.y, c.x, c.y)) return true;
  return bfTerrainBlocks(p.x, p.y, c.x, c.y);     // 地形障礙：近戰一樣不能隔著打
}

/* 我方能不能打到這個目標（普攻是近戰）。 */
function bfPlayerCanReach(ent) {
  if (!ent) return false;
  if (!bfPos(ent)) return true;
  if (bfEntityDistance(ent) > bfMeleeRange()) return false;
  if (typeof eliteWallBlocks === 'function') {      // 築牆：我方普攻也是近戰，隔著牆打不到
    var p = bfPos(ent), c = bfPlayerPos();
    if (eliteWallBlocks(p.x, p.y, c.x, c.y)) return false;
  }
  var q = bfPos(ent), h = bfPlayerPos();
  if (bfTerrainBlocks(q.x, q.y, h.x, h.y)) return false;   // 地形障礙：隔著岩塊打不到
  return true;
}

/* 投射物飛行距離／時間。速度沿用參數表的「每秒幾格」，換算成座標單位。 */
function bfTravelDistance(ent) {
  var p = bfPos(ent);
  if (!p) return bfSpawnDist();
  var c = bfPlayerPos();
  var dx = p.x - c.x, dy = p.y - c.y;
  return Math.sqrt(dx * dx + dy * dy);
}
function bfTravelSeconds(ent) {
  var cellsPerSec = (typeof VFX_PROJECTILE_SPEED_CELLS === 'number' && VFX_PROJECTILE_SPEED_CELLS > 0)
    ? VFX_PROJECTILE_SPEED_CELLS : 8.4;
  var min = (typeof VFX_TRAVEL_MIN_SEC === 'number') ? VFX_TRAVEL_MIN_SEC : 0.1;
  var max = (typeof VFX_TRAVEL_MAX_SEC === 'number') ? VFX_TRAVEL_MAX_SEC : 0.75;
  var sec = bfTravelDistance(ent) / (cellsPerSec * bfUnit());
  return Math.min(max, Math.max(min, sec));
}

/* ---- 生成站位 ---- */
/* 在離我方 bfSpawnDist() 的圓周上找一個角度，盡量與已在場的同伴錯開。
   就地寫入 ent.pos，回傳成功站上場的實體（超過容量的不回傳，由呼叫端捨棄）。 */
function bfPlaceEnemies(enemies, keepPlaced) {
  var list = (enemies || []).filter(function (e) { return !!e; });
  var standing = (keepPlaced || []).filter(function (e) { return !!e && bfPos(e); });
  var capacity = bfCellCount();
  var room = Math.max(0, capacity - standing.length);
  var ok = [];
  var placedNow = standing.slice();

  for (var i = 0; i < list.length && ok.length < room; i++) {
    var ent = list[i];
    var dist = bfSpawnDist() * (0.94 + Math.random() * 0.14);
    /* 挑一個「離現有同伴最遠」的角度：連抽幾個候選取最好的，
       比純亂數不容易整群擠在同一側，也不必做完整的碰撞解算。 */
    var bestAng = Math.random() * Math.PI * 2, bestScore = -Infinity;
    for (var t = 0; t < 6; t++) {
      var ang = Math.random() * Math.PI * 2;
      var c0 = bfPlayerPos();
      var x = c0.x + Math.cos(ang) * dist, y = c0.y + Math.sin(ang) * dist;
      var worst = Infinity;
      for (var j = 0; j < placedNow.length; j++) {
        var q = bfPos(placedNow[j]);
        if (!q) continue;
        var dx = q.x - x, dy = q.y - y;
        var d = dx * dx + dy * dy;
        if (d < worst) worst = d;
      }
      if (worst > bestScore) { bestScore = worst; bestAng = ang; }
    }
    var home = bfPlayerPos();
    ent.pos = { x: home.x + Math.cos(bestAng) * dist, y: home.y + Math.sin(bestAng) * dist };
    ok.push(ent);
    placedNow.push(ent);
  }
  return ok;
}

/* 還能再放幾隻（波次串流用）。座標制沒有格子，容量就是 BF_COLS×BF_ROWS。 */
function bfFreeCellCount(placed) {
  var n = 0;
  for (var i = 0; i < (placed || []).length; i++) if (placed[i]) n++;
  return Math.max(0, bfCellCount() - n);
}

/* 遠方怪群的遊走錨點是生成完成後的世界座標，不能跟著玩家平移。
   沒有 _roam 的普通波次／塔 BOSS 保留原待機行為。 */
function bfInitRoam(ent) {
  var p = bfPos(ent);
  if (!p || typeof FIELD_ENCOUNTER === 'undefined') return;
  ent._roam = { x: p.x, y: p.y, tx: p.x, ty: p.y, wait: 0 };
}
function bfTickRoam(ent, dt) {
  var r = ent && ent._roam, p = bfPos(ent);
  if (!r || !p || !(dt > 0) || typeof FIELD_ENCOUNTER === 'undefined') return;
  if (typeof ccActionLocked === 'function' && ccActionLocked(ent)) return;
  if (typeof eliteLocked === 'function' && eliteLocked(ent)) return;
  var cfg = FIELD_ENCOUNTER;
  var radius = bfMeterPx(Math.max(0, Number(cfg.roamRadiusM) || 0));
  if (!(radius > 0)) return;
  if (r.wait > 0) { r.wait = Math.max(0, r.wait - dt); return; }
  var dx = r.tx - p.x, dy = r.ty - p.y;
  var len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) {
    var angle = Math.random() * Math.PI * 2;
    var reach = radius * Math.sqrt(Math.random());
    r.tx = r.x + Math.cos(angle) * reach;
    r.ty = r.y + Math.sin(angle) * reach;
    dx = r.tx - p.x; dy = r.ty - p.y;
    len = Math.sqrt(dx * dx + dy * dy);
  }
  if (!(len > 0)) return;
  var step = Math.min(len, bfEnemyRunSpeed(ent) * bfEnemySpeedFactor(ent) * Math.max(0, Number(cfg.roamSpeedRatio) || 0) * dt);
  var ox = p.x, oy = p.y;
  p.x += dx / len * step; p.y += dy / len * step;
  if (typeof eliteClampMove === 'function' && eliteClampMove(ox, oy, p, bfEntityRadius(ent) * 0.6)) return;
  if (step >= len) {
    var lo = Math.max(0, Number(cfg.roamWaitMin) || 0), hi = Math.max(lo, Number(cfg.roamWaitMax) || 0);
    r.wait = lo + Math.random() * (hi - lo);
  }
}

/* ---- 逼近與推擠（每個 tick 呼叫一次）----
   敵人朝我方走，走到停止距離就不再前進；同伴之間互相推開，避免整群疊在一點。
   這是「要走到面前才打得到」得以成立的前提。 */
function bfTickApproach(enemies, dt) {
  var live = bfLiveList(enemies);
  var i, j;
  var home = bfPlayerPos();
  bfTerrainSync();
  var justInRange = [];
  for (i = 0; i < live.length; i++) {
    var ent = live[i];
    var p = bfPos(ent);
    if (!p) continue;
    if (bfTickKnockback(ent)) continue;
    if (ent._enterCd > 0) continue;            // 還在進場：不參與逼近，也還不能被打
    if (!bfEnemyAlerted(ent)) {
      bfTickRoam(ent, dt);                     // 尚未發現玩家：只在預置的世界位置附近遊走
      bfEnemyAlerted(ent);                     // 遊走途中進入視野，本輪立即記住發現狀態
      continue;
    }
    // 菁英詞條施法／衝鋒中：原地不動（衝鋒的位移由 js/elite.js 自己推進）
    if (typeof eliteLocked === 'function' && eliteLocked(ent)) continue;
    var ox = p.x, oy = p.y;
    /* 追的是我方**當前**座標，不是出生時的方位——我方跑走就得重新追。 */
    var dx0 = p.x - home.x, dy0 = p.y - home.y;
    var d = Math.sqrt(dx0 * dx0 + dy0 * dy0);
    var stop = bfStopDistance(ent);
    var rp = ent._rp;
    if (rp) {
      /* 跑位（菁英以上，js/elite.js eliteRepoPick）：目標點是「相對我方的角度＋距離」，我方跑動時目標點跟著走。
         到了就清掉並通知技能引擎（_rpDone），由它排下一次。 */
      var tx = home.x + Math.cos(rp.ang) * rp.dist, ty = home.y + Math.sin(rp.ang) * rp.dist;
      var rdx = tx - p.x, rdy = ty - p.y, rd = Math.sqrt(rdx * rdx + rdy * rdy);
      if (rd <= 8) { ent._rp = null; ent._rpDone = true; }
      else {
        /* 跑位時加速（ELITE_GROUP.repoSpeed）：我方一直在動，目標點跟著走，用平常的跑速追不上就會跑到一半被甩開、等於沒跑位 */
        var rsp = (typeof ELITE_GROUP !== 'undefined' && ELITE_GROUP && ELITE_GROUP.repoSpeed > 0) ? ELITE_GROUP.repoSpeed : 1;
        bfMoveToward(p, { x: tx, y: ty }, bfEnemyRunSpeed(ent) * bfEnemySpeedFactor(ent) * rsp * dt, bfEntityRadius(ent) * 0.6);
      }
    } else if ((d > (ent._hover > 0 ? Math.max(stop, ent._hover) : stop) || bfWallBlocksMelee(ent)) && d > 0.0001) {
      var hoverStop = ent._hover > 0 ? Math.max(stop, ent._hover) : stop;   // 帶火鏈的怪守在 hover 距離，不貼臉
      bfMoveToward(p, home, bfEnemyRunSpeed(ent) * bfEnemySpeedFactor(ent) * dt, bfEntityRadius(ent) * 0.6, hoverStop);
    }
    if (typeof eliteClampMove === 'function') eliteClampMove(ox, oy, p, bfEntityRadius(ent) * 0.6);
    /* 剛踏進攻擊距離的那一刻記一筆。
       「新怪至少完成一次攻擊」的保證要綁在這裡：雙方射程相同、而玩家的回合在前，
       不特別處理的話高 DPS 玩家會在敵人進入射程的同一個 tick 先把牠秒掉，
       敵人永遠打不到人——波次串流「撐不住就會失敗」的壓力設計就失效了。 */
    var nowIn = bfInAttackRange(ent);
    if (nowIn && !ent._wasInRange) justInRange.push(ent);
    ent._wasInRange = nowIn;
  }
  /* 互斥推擠：兩隻靠太近就各退一半。只做一輪，靠每個 tick 累積收斂。
     座標物件與半徑在迴圈外只取一次（推擠只改 x／y，不會讓座標失效，半徑也不變）；
     內層先用 |dx|、|dy| 是否已 >= 兩半徑和做便宜的剔除——距離恆不小於任一軸分量，
     所以被剔除的配對在原本的判斷裡也一定會被略過，結果與逐對 sqrt 完全一致。 */
  var ps = [], rs = [], ms = [];
  for (i = 0; i < live.length; i++) {
    var pp = bfPos(live[i]);
    if (!pp) continue;
    ps.push(pp);
    rs.push(bfEntityRadius(live[i]));
    /* 推擠的「重量」：高級敵人（跑位中更重）擠得開小兵，小兵擠不動牠；不然跑位一遇到人堆就被卡住 */
    ms.push(live[i]._rp ? 8 : (live[i]._tier ? 3 : 1));
  }
  var cnt = ps.length;
  for (i = 0; i < cnt; i++) {
    var a = ps[i], ra = rs[i];
    for (j = i + 1; j < cnt; j++) {
      var b = ps[j];
      var minD = ra + rs[j];
      var dx = b.x - a.x, dy = b.y - a.y;
      if (dx >= minD || -dx >= minD || dy >= minD || -dy >= minD) continue;
      var dd = Math.sqrt(dx * dx + dy * dy);
      if (dd >= minD || dd <= 0.0001) continue;
      var push = (minD - dd);
      var ux = dx / dd, uy = dy / dd;
      var wa = ms[j] / (ms[i] + ms[j]), wb = ms[i] / (ms[i] + ms[j]);   // 輕的那一方退得多（同重量時各退一半，與舊行為一致）
      var ax = a.x, ay = a.y, bx = b.x, by = b.y;
      a.x -= ux * push * wa; a.y -= uy * push * wa;
      b.x += ux * push * wb; b.y += uy * push * wb;
      if (typeof eliteClampMove === 'function') {
        eliteClampMove(ax, ay, a, ra * 0.6);
        eliteClampMove(bx, by, b, rs[j] * 0.6);
      }
    }
  }
  /* 地形障礙：走路、擊退、推擠之後統一把人推出岩塊（沿邊滑開，不會卡死）。
     放在最後一道，才不會被同伴推擠又擠回岩塊裡。 */
  if (BF_TERRAIN_ACTIVE) {
    for (i = 0; i < live.length; i++) {
      var te = live[i], tp = bfPos(te);
      if (!tp) continue;
      if (!te._obs) te._obs = { id: 0, side: 0 };
      BattleTerrain.pushOut(tp, bfEntityRadius(te), home.x, home.y, te._obs);
    }
  }
  return justInRange;
}

/* 普通走路才繞牆；擊退／衝鋒等強制位移只碰撞，不自行改技能路線。 */
function bfMoveToward(p, target, budget, pad, stop) {
  var next = typeof eliteWallWaypoint === 'function' ? eliteWallWaypoint(p, target, pad) : target;
  if (!next) return false;
  var dx = next.x - p.x, dy = next.y - p.y, len = Math.hypot(dx, dy);
  var gap = Math.max(0, len - (next === target || next.wallGoal ? (stop || 0) : 0));
  if (!(gap > 0.0001)) return false;
  var step = Math.min(gap, budget), ox = p.x, oy = p.y;
  p.x += dx / len * step; p.y += dy / len * step;
  if (typeof eliteClampMove === 'function' && eliteClampMove(ox, oy, p, pad)) return false;
  return step > 0.0001;
}

/* ---- 我方移動（每個 tick 呼叫一次）----
   朝目標跑，進到近戰距離就停下來打；場上一個敵人都沒有時繼續往前推進。
   ⚠️ 我方的位移必須由這裡產生，顯示層不得自己讓角色跑：
   顯示層一旦自作主張，敵人的座標又是模擬層算的，兩邊就會對不起來——
   2026-08-13 之前「我方一動，整群敵人跟著平移」正是這樣來的。
   回傳 true 表示這個 tick 有在移動（顯示層據此切走路動畫）。 */
function bfTickPlayer(enemies, dt, preferred, pEnt) {
  if (pEnt && Number(pEnt._skillCastRemaining) > 0) {
    BF_PLAYER_CHASING = false;
    return false;
  }
  /* 技能放出之後的站定（js/skills.js skillCastHoldStart）：3D 技能動作播完才繼續移動 */
  if (pEnt && Number(pEnt._skillHold) > 0) {
    pEnt._skillHold = Math.max(0, pEnt._skillHold - (dt > 0 ? dt : 0));
    BF_PLAYER_CHASING = false;
    return false;
  }
  if (!(dt > 0)) return false;
  if (typeof elitePlayerLocked === 'function' && elitePlayerLocked()) { BF_PLAYER_CHASING = false; return false; }   // 被漩渦拉扯中
  var home = bfPlayerPos();
  bfTerrainSync();
  bfTerrainPushOut(home, bfPlayerBodyRadius(), home.x + 1000, home.y, null);   // 站在障礙裡（地圖起點、換階段帶新長出來的）：站著不動也要先推出來
  var ox0 = home.x, oy0 = home.y;
  var live = bfLiveList(enemies).filter(function (e) { return !!bfPos(e); });
  if (!live.length) {
    /* 空場：往前方（+x）推進，地板會跟著往後捲，不會呆站著等下一波。 */
    home.x += bfPlayerSpeed() * bfPlayerSpeedFactor(pEnt) * dt;
    if (typeof eliteClampMove === 'function' && eliteClampMove(ox0, oy0, home)) { BF_PLAYER_CHASING = false; return false; }
    bfTerrainPushOut(home, bfPlayerBodyRadius(), home.x + 1000, home.y, BF_PLAYER_OBS);
    BF_PLAYER_CHASING = true;
    return true;
  }
  /* 追的目標要與「這一刀實際打誰」一致（combat.js 的鎖定目標），
     否則會出現跑向 A 卻在打 B 的隔空攻擊。 */
  var target = (preferred && preferred.hp > 0 && bfPos(preferred) && live.indexOf(preferred) >= 0)
    ? preferred : bfPickPrimary(live, null);
  if (!target) return false;

  /* 起步與停步用兩個不同的門檻（遲滯）。只用一個門檻的話，敵人被推擠而
     來回跨過那條線時，我方就會每個 tick 補一小步——畫面上是持續的微小抽動，
     速度看起來忽快忽慢。改成：站著時要真的快脫離射程才起步，一旦起步就
     一路跑進內側才停。 */
  var d = bfEntityDistance(target);
  var wallBlocked = typeof eliteWallBlocks === 'function' && eliteWallBlocks(home.x, home.y, target.pos.x, target.pos.y);
  var startAt = bfMeleeRange() * 0.95;      // 快脫離射程才起步
  var stopAt = bfContactDist() * 0.8;       // 停在敵人站定的位置再往內一點＝真的貼上
  if (!wallBlocked && !BF_PLAYER_CHASING && d <= startAt) return false;   // 站著打
  if (!wallBlocked && d <= stopAt) { BF_PLAYER_CHASING = false; return false; }
  BF_PLAYER_CHASING = true;
  var moved = bfMoveToward(home, target.pos, bfPlayerSpeed() * bfPlayerSpeedFactor(pEnt) * dt,
    (typeof ELITE_PLAYER_BODY_R === 'number' ? ELITE_PLAYER_BODY_R : bfBodyRadius()) * 0.6, stopAt + bfEntityRadius(target));
  bfTerrainPushOut(home, bfPlayerBodyRadius(), target.pos.x, target.pos.y, BF_PLAYER_OBS);   // 地形障礙：沿邊滑開
  /* 這一步就走到定位了：當下就解除追擊狀態，不要拖到下一個 tick——
     中間那一格空窗會讓「已經站定卻仍算在追」，遲滯就少了半拍。 */
  if (!moved || bfEntityDistance(target) <= stopAt) BF_PLAYER_CHASING = false;
  return moved;
}

/* ---- 選敵 ---- */
function bfLiveList(enemies) {
  var out = [];
  for (var i = 0; i < (enemies || []).length; i++) {
    var e = enemies[i];
    if (e && e.hp > 0) out.push(e);
  }
  return out;
}

/* 依距離排序的存活敵人；距離相同者隨機排列。 */
function bfSortedTargets(enemies) {
  var deco = bfLiveList(enemies).map(function (ent) {
    return { ent: ent, d: bfEntityDistance(ent), r: Math.random() };
  });
  deco.sort(function (a, b) { return (a.d - b.d) || (a.r - b.r); });
  return deco.map(function (x) { return x.ent; });
}

/* 主目標：鎖定中的目標只要還活著就不換（規格：鎖定後直到目標死亡）。 */
function bfPickPrimary(enemies, locked) {
  if (locked && locked.hp > 0 && bfLiveList(enemies).indexOf(locked) >= 0) return locked;
  var sorted = bfSortedTargets(enemies);
  return sorted.length ? sorted[0] : null;
}

/* 兩個實體之間的邊緣距離（連鎖／濺射用；與「離我方多遠」的 bfEntityDistance 不同）。 */
function bfEntityGap(a, b) {
  var pa = bfPos(a), pb = bfPos(b);
  if (!pa || !pb) return Infinity;
  var dx = pa.x - pb.x, dy = pa.y - pb.y;
  return Math.max(0, Math.sqrt(dx * dx + dy * dy) - bfEntityRadius(a) - bfEntityRadius(b));
}
function bfIsAdjacent(a, b) { return bfEntityGap(a, b) <= bfContactDist(); }

/* 離 from 最近的「其他」存活敵人；同距離隨機。from 為空時退回離我方最近的那一個。 */
function bfNearestOther(from, enemies) {
  var live = bfLiveList(enemies);
  var cands = [];
  for (var i = 0; i < live.length; i++) if (live[i] !== from) cands.push(live[i]);
  if (!cands.length) return null;
  if (!from) return bfPickPrimary(cands, null);
  var deco = cands.map(function (ent) { return { ent: ent, d: bfEntityGap(from, ent), r: Math.random() }; });
  deco.sort(function (x, y) { return (x.d - y.d) || (x.r - y.r); });
  return deco[0].ent;
}

/* ---- 彈射／連鎖的目標選法（唯一權威）----
   使用者定調（2026-08-21）：彈射型飛行物除非技能敘述特別寫明「找最近的敵人」
   （例：疾風斬【擴散】的「{m} 米內最近的 1 個」、傳奇【處刑者】的「生命值最高」），
   否則一律在「規定的範圍內隨機」挑目標——全部跳向最近的鄰居會讓整條鏈黏在
   同一小撮敵人身上，範圍再大也擴散不出去。
   maxGapPx <= 0＝技能沒有規定彈射範圍（飛刀、寒流爆散、傳奇連鎖閃電…）＝整個戰場都算範圍。
   候選集合與 bfNearestOthers 完全相同（同樣以邊緣距離 bfEntityGap 過濾、
   同樣讓沒有座標的高塔實體在「有規定範圍」時落在範圍外），
   改的只有「從候選裡挑誰」：由最近改為等機率隨機。
   visited＝本輪已經跳過的名單（不重複跳；呼叫端負責在跳完後補進去）。 */
function bfRandomOthers(from, enemies, count, maxGapPx, visited) {
  var live = bfLiveList(enemies);
  if (!(count > 0)) return [];
  var useGap = from && bfPos(from);
  var cands = [];
  /* 距離與體型半徑在迴圈外取一次：每個候選各查一次全域常數（bfNum）佔了連鎖技能單步成本的一成多。
     算式與 bfEntityGap／bfEntityDistance 逐項相同（先減第一個半徑再減第二個），結果逐位元一致。 */
  var bodyR = 0, bossR = 0, fromR = 0, fromPos = null, cPos = null;
  if (maxGapPx > 0) {
    // 半徑只取決於是不是 BOSS（bfEntityRadius 的定義），所以每種體型各問一次；仍經過 bfEntityRadius，測試與外部可照常替換它。
    bodyR = bfEntityRadius(null); bossR = bfEntityRadius({ isBoss: true });
    if (useGap) { fromPos = bfPos(from); fromR = bfEntityRadius(from); }
    else cPos = bfPlayerPos();
  }
  for (var i = 0; i < live.length; i++) {
    var ent = live[i];
    if (ent === from) continue;
    if (visited && visited.indexOf(ent) >= 0) continue;
    if (maxGapPx > 0) {
      var pe = bfPos(ent), d;
      if (useGap) {
        if (!pe) d = Infinity;
        else { var gx = fromPos.x - pe.x, gy = fromPos.y - pe.y; d = Math.max(0, Math.sqrt(gx * gx + gy * gy) - fromR - (ent.isBoss ? bossR : bodyR)); }
      } else if (!pe) d = Infinity;
      else { var dx = pe.x - cPos.x, dy = pe.y - cPos.y; d = Math.max(0, Math.sqrt(dx * dx + dy * dy) - (ent.isBoss ? bossR : bodyR)); }
      if (d > maxGapPx) continue;
    }
    cands.push(ent);
  }
  if (!cands.length) return [];
  for (var x = cands.length - 1; x > 0; x--) {   // 洗牌後取前 count 個＝不重複的隨機取樣
    var j = Math.floor(Math.random() * (x + 1));
    var tmp = cands[x]; cands[x] = cands[j]; cands[j] = tmp;
  }
  return cands.slice(0, count);
}

/* 範圍內隨機一個「其他」存活敵人（規則說明見 bfRandomOthers）。 */
function bfRandomOther(from, enemies, maxGapPx, visited) {
  var picked = bfRandomOthers(from, enemies, 1, maxGapPx, visited);
  return picked.length ? picked[0] : null;
}

/* 連鎖的下一跳：範圍內隨機一個其他敵人（沒有規定範圍＝整個戰場）。 */
function bfChainNext(from, enemies) {
  var live = bfLiveList(enemies);
  if (!live.length) return null;
  if (!from) return bfPickPrimary(live, null);
  var other = bfRandomOther(from, live, 0, null);
  if (other) return other;
  return live.indexOf(from) >= 0 ? from : bfPickPrimary(live, null);
}

/* 連鎖順序：從 from 出發，每一跳跳到「本輪還沒跳過、且在 maxGapPx 內」的隨機敵人。
   maxGapPx 省略（或 <= 0）＝技能沒有規定彈射範圍，整個戰場都是候選。
   全部跳過一輪之後清空紀錄重來（單體時因此仍能打滿次數）。 */
function bfChainOrder(from, enemies, count, maxGapPx) {
  var live = bfLiveList(enemies);
  if (!live.length || !(count > 0)) return [];
  var order = [];
  var used = [];
  var cur = from || null;
  for (var i = 0; i < count; i++) {
    var pool = [];
    for (var j = 0; j < live.length; j++) if (used.indexOf(live[j]) < 0) pool.push(live[j]);
    if (!pool.length) {
      used = [];
      pool = live.slice();
      if (pool.length > 1 && cur) pool = pool.filter(function (e) { return e !== cur; });
    }
    var next;
    if (!cur) {
      next = bfPickPrimary(pool, null);
    } else if (pool.indexOf(cur) >= 0) {
      next = cur;
    } else {
      /* 有規定彈射範圍時，範圍內沒人就是「跳不到了」——不得退回 pool[0]
         把鏈硬接到範圍外的敵人身上（沒有規定範圍時維持原本的保底）。 */
      next = bfRandomOther(cur, pool, maxGapPx, null) || (maxGapPx > 0 ? null : pool[0]);
    }
    if (!next) break;
    order.push(next);
    used.push(next);
    cur = next;
  }
  return order;
}

/* ---- 範圍 ---- */
/* 技能範圍設定值 → { kind: 'single' | 'box' | 'all', h, w, n }
   沿用既有寫法（'3*3'、'1*3'、'all'、單一數字 N），資料表不必改。
   座標制下 n×n 會換算成「半徑 = n × 身位 ÷ 2」的圓（見 bfShapeRadius）。 */
function bfParseShape(raw) {
  var single = { kind: 'single', h: 1, w: 1, n: 1 };
  if (raw === null || raw === undefined || raw === '') return single;
  if (typeof raw === 'number') {
    var num = Math.floor(raw);
    return num > 1 ? { kind: 'box', h: num, w: num, n: num } : single;
  }
  var s = String(raw).trim().toLowerCase();
  if (s === '' || s === 'single' || s === '單體') return single;
  if (s === 'all' || s === '全體' || s === '全场' || s === '全場') return { kind: 'all', h: 0, w: 0, n: 0 };
  var m = /^(?:box)?(\d+)(?:\s*[x*×]\s*(\d+))?$/.exec(s);
  if (m) {
    var h = Math.max(1, Math.floor(Number(m[1])));
    var w = m[2] === undefined ? h : Math.max(1, Math.floor(Number(m[2])));
    if (h <= 1 && w <= 1) return single;
    return { kind: 'box', h: h, w: w, n: Math.max(h, w) };
  }
  return single;
}

/* n×n 方框 → 圓的半徑。取長邊，換算成身位再取一半。 */
function bfShapeRadius(sp) {
  if (!sp || sp.kind !== 'box') return 0;
  return Math.max(sp.w, sp.h) * bfUnit() / 2;
}

/* 實體是否落在某個圓形區域內（領域類效果每跳都要重問一次）。 */
function bfEntityInArea(ent, area) {
  if (!area) return true;
  var p = bfPos(ent);
  if (!p) return false;
  var dx = p.x - area.x, dy = p.y - area.y;
  return Math.sqrt(dx * dx + dy * dy) - bfEntityRadius(ent) <= area.r;
}

function bfEnemiesInArea(area, live) {
  var out = [];
  for (var i = 0; i < live.length; i++) if (bfEntityInArea(live[i], area)) out.push(live[i]);
  return out;
}

/* 範圍落點：回傳 { area: { x, y, r } | null, targets }。
   圓心取「以主目標為中心」——座標制下不再需要舊版那套「找命中最多的方框錨點」，
   主目標本來就是圓心，周圍的敵人自然被涵蓋。
   area 是「打在地上的那塊區域」：領域類效果要記住它，之後每跳都打站在裡面的敵人。 */
function bfAreaPlacement(primary, enemies, shape) {
  if (!primary || primary.hp <= 0) return { area: null, targets: [] };
  var live = bfLiveList(enemies);
  if (live.indexOf(primary) < 0) live.push(primary);
  var sp = bfParseShape(shape);
  if (sp.kind === 'all') {
    var home2 = bfPlayerPos();
    return { area: { x: home2.x, y: home2.y, r: Infinity }, targets: live };
  }
  if (sp.kind !== 'box') return { area: null, targets: [primary] };
  var p = bfPos(primary);
  if (!p) return { area: null, targets: [primary] };
  var area = { x: p.x, y: p.y, r: bfShapeRadius(sp) };
  var hit = bfEnemiesInArea(area, live);
  if (hit.indexOf(primary) < 0) hit.push(primary);
  return { area: area, targets: hit };
}

/* 範圍展開：只要命中清單時用這支。 */
function bfAreaTargets(primary, enemies, shape) {
  return bfAreaPlacement(primary, enemies, shape).targets;
}

/* 全場技。 */
function bfAllTargets(enemies) { return bfLiveList(enemies); }

/* ---- 新版技能幾何（2026-08-13 技能改造）----
   新版技能以「米」描述距離；系統距離單位固定以 10 單位代表 1 米，
   所以設計表中的 7 米就是 70 個系統距離單位。技能依自己的施放距離／範圍判定，
   不套普攻專用的bfPlayerCanReach／牆體視線限制。
   ⚠️ 所有查詢對「沒有座標的實體」（高塔 BOSS）一律退化為單體語意：
   由呼叫端先以 bfPos(primary) 判斷幾何是否可用，不可用時只打主目標。 */
var BF_MELEE_METERS = 5; // 設計文檔的近戰距離假設（米）
var BF_SYSTEM_UNITS_PER_METER = 10;
function bfMeterPx(m) { return (Number(m) || 0) * BF_SYSTEM_UNITS_PER_METER; }

/* 我方指向某實體的方位角（弧度）；無座標回傳 null。 */
function bfAngleTo(ent) {
  var p = bfPos(ent);
  if (!p) return null;
  var c = bfPlayerPos();
  var dx = p.x - c.x, dy = p.y - c.y;
  if (dx * dx + dy * dy < 0.000001) return 0;
  return Math.atan2(dy, dx);
}

/* 線段命中：從我方出發、沿 angle 方向的 [fromLen, toLen] 路徑，
   命中「身體圓與線段相交」的所有存活敵人，依線上投影距離由近到遠回傳。
   halfWidthPx 為線的半寬（預設 0＝細線，僅靠敵人體型半徑判定）。 */
function bfSegmentTargets(origin, angle, fromLen, toLen, enemies, halfWidthPx) {
  if (!origin || angle === null || angle === undefined) return [];
  var start = Math.max(0, Number(fromLen) || 0);
  var end = Math.max(start, Number(toLen) || 0);
  var hw = Math.max(0, Number(halfWidthPx) || 0);
  var c = origin;
  var ux = Math.cos(angle), uy = Math.sin(angle);
  var deco = [];
  var live = bfLiveList(enemies);
  for (var i = 0; i < live.length; i++) {
    var p = bfPos(live[i]);
    if (!p) continue;
    var dx = p.x - c.x, dy = p.y - c.y;
    var along = dx * ux + dy * uy;                    // 線上投影距離
    var r = bfEntityRadius(live[i]) + hw;
    if (along < start - r || along > end + r) continue; // 線段前後範圍外
    var clamped = Math.max(start, Math.min(end, along));
    var cx = c.x + ux * clamped, cy = c.y + uy * clamped;
    var ox = p.x - cx, oy = p.y - cy;
    if (Math.sqrt(ox * ox + oy * oy) > r) continue;   // 離線段最近點太遠
    deco.push({ ent: live[i], d: along });
  }
  deco.sort(function (a, b) { return a.d - b.d; });
  return deco.map(function (x) { return x.ent; });
}

/* 直線（貫穿）命中：從 origin（省略時為我方）出發、沿 angle 方向長 lenPx 的線段。
   origin 讓同一技能可以建立多道平行貫穿路徑，而不把偏移寫死在技能層。 */
function bfLineTargets(angle, lenPx, enemies, halfWidthPx, origin) {
  if (!(lenPx > 0)) return [];
  return bfSegmentTargets(origin || bfPlayerPos(), angle, 0, lenPx, enemies, halfWidthPx);
}

/* 扇形命中：以我方為圓心、centerAngle 為中軸、全張角 spreadDeg（度）、半徑 rangePx，
   回傳扇形內的存活敵人（依距離由近到遠）。 */
function bfConeTargets(centerAngle, spreadDeg, rangePx, enemies) {
  if (centerAngle === null || centerAngle === undefined) return [];
  var half = Math.max(0, Number(spreadDeg) || 0) * Math.PI / 360; // 全張角的一半（弧度）
  var deco = [];
  var live = bfLiveList(enemies);
  for (var i = 0; i < live.length; i++) {
    var ent = live[i];
    var ang = bfAngleTo(ent);
    if (ang === null) continue;
    var diff = Math.abs(ang - centerAngle);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    if (diff > half) continue;
    var d = bfEntityDistance(ent);
    if (rangePx > 0 && d > rangePx) continue;
    deco.push({ ent: ent, d: d });
  }
  deco.sort(function (a, b) { return a.d - b.d; });
  return deco.map(function (x) { return x.ent; });
}

/* 離 from（實體）最近的至多 count 個「其他」存活敵人（依邊緣距離）；
   maxGapPx > 0 時只收在該距離內的。from 無座標時退化為「離我方最近」排序。 */
function bfNearestOthers(from, enemies, count, maxGapPx) {
  var live = bfLiveList(enemies);
  var cands = [];
  for (var i = 0; i < live.length; i++) if (live[i] !== from) cands.push(live[i]);
  if (!cands.length || !(count > 0)) return [];
  var useGap = from && bfPos(from);
  var deco = cands.map(function (ent) {
    return { ent: ent, d: useGap ? bfEntityGap(from, ent) : bfEntityDistance(ent), r: Math.random() };
  });
  deco.sort(function (a, b) { return (a.d - b.d) || (a.r - b.r); });
  var out = [];
  for (var j = 0; j < deco.length && out.length < count; j++) {
    if (maxGapPx > 0 && deco[j].d > maxGapPx) break; // 已依距離排序，超出即可停
    out.push(deco[j].ent);
  }
  return out;
}

/* 擊退沿遠離玩家的方向排程；沒有座標或免控的BOSS維持原位置。 */
function bfKnockbackEnemies(enemies, distancePx, durationSec) {
  var moved = [], home = bfPlayerPos();
  if (!(distancePx > 0) || !(durationSec > 0)) return moved;
  var live = bfLiveList(enemies);
  for (var i = 0; i < live.length; i++) {
    var ent = live[i], p = bfPos(ent);
    if (!p || (typeof isBossControlImmune === 'function' && isBossControlImmune(ent))) continue;
    var dx = p.x - home.x, dy = p.y - home.y, d = Math.sqrt(dx * dx + dy * dy);
    if (!(d > 0)) { dx = 1; dy = 0; d = 1; }
    ent._bfKnockback = { x: p.x, y: p.y, toX: p.x + dx / d * distancePx,
      toY: p.y + dy / d * distancePx, startAt: GT, endAt: GT + durationSec };
    moved.push(ent);
  }
  return moved;
}

/* 強制位移先於暈眩／逼近判定，逐Tick更新權威座標，畫面沿既有快照補間。 */
function bfTickKnockback(ent) {
  var k = ent && ent._bfKnockback, p = bfPos(ent);
  if (!k || !p) return false;
  var ox = p.x, oy = p.y;
  var q = Math.max(0, Math.min(1, (GT - k.startAt) / (k.endAt - k.startAt)));
  p.x = k.x + (k.toX - k.x) * q;
  p.y = k.y + (k.toY - k.y) * q;
  if (typeof eliteClampMove === 'function' && eliteClampMove(ox, oy, p, bfEntityRadius(ent) * 0.6)) delete ent._bfKnockback;
  if (q >= 1) delete ent._bfKnockback;
  return true;
}

/* ---- 拉近（傳奇特效【聚敵旋渦】）----
   把離我方 fromPx 以內、但比 toPx 還遠的敵人，沿原本的方位角拉到 toPx 的圓周上。
   座標改寫一律走本檔（幾何唯一權威）：呼叫端只給「多遠以內的拉、拉到多近」。
   不會把敵人拉進身體停步距離內（否則會直接疊在玩家身上，逼近推擠那一段還要再推開一次）；
   沒有座標的實體（高塔 BOSS）一律略過。回傳實際被拉動的實體陣列。 */
function bfPullEnemies(enemies, fromPx, toPx, maxStepPx) {
  var moved = [];
  if (!(fromPx > 0)) return moved;
  /* 可選慢速模式：射程按體型邊緣計算，逐步拉近；路徑被同伴佔用就停，
     不改寫同伴位置，也不依賴下一輪互斥推擠來清出空間。原有瞬間拉近維持原語意。 */
  var slow = maxStepPx !== undefined;
  if (slow && (!(maxStepPx > 0) || !isFinite(maxStepPx))) return moved;
  var live = bfLiveList(enemies);
  var c = bfPlayerPos();
  for (var i = 0; i < live.length; i++) {
    var ent = live[i];
    var p = bfPos(ent);
    if (!p || (slow && ent._enterCd > 0)) continue;
    var dx = p.x - c.x, dy = p.y - c.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    var body = bfEntityRadius(ent);
    if (!(d > 0) || d - (slow ? body : 0) > fromPx) continue;
    /* 用身體停步距離而不是射程停步點：遠程敵人站在射程邊緣，
       拉近技能要能把牠拉到玩家身邊，不能被牠自己的站樁位置擋住。 */
    var want = Math.max(bfBodyStopDistance(ent), Math.max(0, Number(toPx) || 0) + (slow ? body : 0));
    if (d <= want) continue;
    if (slow) {
      var step = Math.min(d - want, maxStepPx);
      var ux = -dx / d, uy = -dy / d;
      for (var j = 0; j < live.length && step > 0.0001; j++) {
        if (live[j] === ent) continue;
        var other = bfPos(live[j]);
        if (!other) continue;
        var rx = p.x - other.x, ry = p.y - other.y;
        var minD = body + bfEntityRadius(live[j]);
        var along = -(rx * ux + ry * uy);
        // 先以投影篩掉路徑之外的同伴，只有可能碰撞才計算圓形路徑交點。
        if (along + minD <= 0 || along - minD >= step) continue;
        var distSq = rx * rx + ry * ry;
        if (distSq < minD * minD) {
          if (along > 0) step = 0;
          continue; // 已重疊時只允許遠離，不再加深重疊。
        }
        var sideSq = Math.max(0, distSq - along * along);
        if (sideSq >= minD * minD) continue;
        var contact = along - Math.sqrt(minD * minD - sideSq);
        if (contact >= -0.0001) step = Math.min(step, Math.max(0, contact - 0.0001));
      }
      if (step <= 0.0001) continue;
      want = d - step;
    }
    var ox = p.x, oy = p.y;
    p.x = c.x + dx / d * want;
    p.y = c.y + dy / d * want;
    if (typeof eliteClampMove === 'function' && eliteClampMove(ox, oy, p, body * 0.6)) continue;
    moved.push(ent);
  }
  return moved;
}

/* 以某實體為中心、半徑 rPx 的圓內所有存活敵人（含中心實體自己）。 */
function bfTargetsAround(center, enemies, rPx) {
  var p = bfPos(center);
  if (!p) return center && center.hp > 0 ? [center] : [];
  return bfEnemiesInArea({ x: p.x, y: p.y, r: Math.max(0, Number(rPx) || 0) }, bfLiveList(enemies));
}
