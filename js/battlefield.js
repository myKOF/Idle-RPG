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
     - 敵人每個 tick 朝我方逼近，走到接觸距離就停，並與同伴互相推開。
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
/* 敵人跑速是獨立的值，不由我方換算——兩邊要能分開調。 */
function bfEnemySpeed() { return bfNum('BF_ENEMY_SPEED', 210); }
function bfMeleeRange() { return bfNum('BF_MELEE_RANGE', 50); }       // 近戰攻擊距離
function bfRangedRange() { return bfNum('BF_RANGED_RANGE', 320); }    // 魔法系敵人的攻擊距離
function bfBodyRadius() { return bfNum('BF_BODY_RADIUS', 20); }
function bfBossRadius() { return bfNum('BF_BOSS_RADIUS', 52); }

/* ---- 我方座標 ----
   全場座標的原點。這個物件會被就地改寫（不重新指派），
   讓 combat.js 把它掛進 FIELD 之後，面板每次序列化都拿到最新值。 */
var BF_PLAYER = { x: 0, y: 0 };
var BF_PLAYER_CHASING = false;     // 起步／停步的遲滯狀態（見 bfTickPlayer）
function bfPlayerPos() { return BF_PLAYER; }
function bfResetPlayer() { BF_PLAYER.x = 0; BF_PLAYER.y = 0; BF_PLAYER_CHASING = false; return BF_PLAYER; }

/* 體型半徑：BOSS 比較大，所以「邊緣」比中心更早進入接觸距離。 */
function bfEntityRadius(ent) {
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

/* 停止距離：走到這裡就不再前進（接觸距離 + 自己的體型）。 */
function bfStopDistance(ent) {
  return bfContactDist() + bfEntityRadius(ent);
}

/* 打不打得到。魔法系敵人是遠程，其餘要貼到近戰距離。
   ⚠️ 這是改造前完全不存在的判定——舊版任何位置都打得到。 */
function bfInAttackRange(ent) {
  if (!ent) return false;
  if (!bfPos(ent)) return true;                 // 沒有座標（高塔）＝沿用舊行為，不擋
  var range = (ent.magic ? bfRangedRange() : bfMeleeRange());
  return bfEntityDistance(ent) <= range;
}

/* 我方能不能打到這個目標（普攻是近戰）。 */
function bfPlayerCanReach(ent) {
  if (!ent) return false;
  if (!bfPos(ent)) return true;
  return bfEntityDistance(ent) <= bfMeleeRange();
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

/* ---- 逼近與推擠（每個 tick 呼叫一次）----
   敵人朝我方走，走到停止距離就不再前進；同伴之間互相推開，避免整群疊在一點。
   這是「要走到面前才打得到」得以成立的前提。 */
function bfTickApproach(enemies, dt) {
  var live = bfLiveList(enemies);
  var i, j;
  var speed = bfEnemySpeed();
  var home = bfPlayerPos();
  var justInRange = [];
  for (i = 0; i < live.length; i++) {
    var ent = live[i];
    var p = bfPos(ent);
    if (!p) continue;
    if (ent._enterCd > 0) continue;            // 還在進場：不參與逼近，也還不能被打
    /* 追的是我方**當前**座標，不是出生時的方位——我方跑走就得重新追。 */
    var dx0 = p.x - home.x, dy0 = p.y - home.y;
    var d = Math.sqrt(dx0 * dx0 + dy0 * dy0);
    var stop = bfStopDistance(ent);
    if (d > stop && d > 0.0001) {
      var step = Math.min(d - stop, speed * dt);
      p.x -= (dx0 / d) * step;
      p.y -= (dy0 / d) * step;
    }
    /* 剛踏進攻擊距離的那一刻記一筆。
       「新怪至少完成一次攻擊」的保證要綁在這裡：雙方射程相同、而玩家的回合在前，
       不特別處理的話高 DPS 玩家會在敵人進入射程的同一個 tick 先把牠秒掉，
       敵人永遠打不到人——波次串流「撐不住就會失敗」的壓力設計就失效了。 */
    var nowIn = bfInAttackRange(ent);
    if (nowIn && !ent._wasInRange) justInRange.push(ent);
    ent._wasInRange = nowIn;
  }
  /* 互斥推擠：兩隻靠太近就各退一半。只做一輪，靠每個 tick 累積收斂。 */
  for (i = 0; i < live.length; i++) {
    for (j = i + 1; j < live.length; j++) {
      var a = bfPos(live[i]), b = bfPos(live[j]);
      if (!a || !b) continue;
      var minD = bfEntityRadius(live[i]) + bfEntityRadius(live[j]);
      var dx = b.x - a.x, dy = b.y - a.y;
      var dd = Math.sqrt(dx * dx + dy * dy);
      if (dd >= minD || dd <= 0.0001) continue;
      var push = (minD - dd) * 0.5;
      var ux = dx / dd, uy = dy / dd;
      a.x -= ux * push; a.y -= uy * push;
      b.x += ux * push; b.y += uy * push;
    }
  }
  return justInRange;
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
  if (!(dt > 0)) return false;
  var home = bfPlayerPos();
  var live = bfLiveList(enemies).filter(function (e) { return !!bfPos(e); });
  if (!live.length) {
    /* 空場：往前方（+x）推進，地板會跟著往後捲，不會呆站著等下一波。 */
    home.x += bfPlayerSpeed() * dt;
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
  var startAt = bfMeleeRange() * 0.95;      // 快脫離射程才起步
  var stopAt = bfContactDist() * 0.8;       // 停在敵人站定的位置再往內一點＝真的貼上
  if (!BF_PLAYER_CHASING && d <= startAt) return false;   // 站著打
  if (d <= stopAt) { BF_PLAYER_CHASING = false; return false; }
  BF_PLAYER_CHASING = true;
  var gap = d - stopAt;
  var p = target.pos;
  var dx = p.x - home.x, dy = p.y - home.y;
  var len = Math.sqrt(dx * dx + dy * dy);
  if (len <= 0.0001) return false;
  var step = Math.min(gap, bfPlayerSpeed() * dt);
  home.x += (dx / len) * step;
  home.y += (dy / len) * step;
  /* 這一步就走到定位了：當下就解除追擊狀態，不要拖到下一個 tick——
     中間那一格空窗會讓「已經站定卻仍算在追」，遲滯就少了半拍。 */
  if (gap - step <= 0.0001) BF_PLAYER_CHASING = false;
  return step > 0.0001;
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

/* 連鎖的下一跳。 */
function bfChainNext(from, enemies) {
  var live = bfLiveList(enemies);
  if (!live.length) return null;
  if (!from) return bfPickPrimary(live, null);
  var other = bfNearestOther(from, live);
  if (other) return other;
  return live.indexOf(from) >= 0 ? from : bfPickPrimary(live, null);
}

/* 連鎖順序：從 from 出發，每一跳跳到「離上一個目標最近、且本輪還沒跳過」的敵人。 */
function bfChainOrder(from, enemies, count) {
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
      next = bfNearestOther(cur, pool) || pool[0];
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
   所以設計表中的 7 米就是 70 個系統距離單位。技能是否能起手仍由
   bfPlayerCanReach() 以普攻的近戰距離判定，技能本身的貫穿／範圍則可依表格延伸。
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

/* 以某實體為中心、半徑 rPx 的圓內所有存活敵人（含中心實體自己）。 */
function bfTargetsAround(center, enemies, rPx) {
  var p = bfPos(center);
  if (!p) return center && center.hp > 0 ? [center] : [];
  return bfEnemiesInArea({ x: p.x, y: p.y, r: Math.max(0, Number(rPx) || 0) }, bfLiveList(enemies));
}
