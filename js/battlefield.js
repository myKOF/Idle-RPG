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
     - 我方永遠在原點 (0,0)，敵人帶 ent.pos = { x, y }（單位≈像素）。
     - 敵人每個 tick 朝我方逼近，走到接觸距離就停，並與同伴互相推開。
     - 距離＝真正的歐幾里得距離；能不能攻擊要看距離（bfInAttackRange）。
     - 範圍技從「n×n 方框」改成以主目標為中心的圓（半徑由 n 換算）。
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
function bfEnemySpeed() { return bfNum('BF_ENEMY_SPEED', 150); }      // 逼近速度（單位/秒）
function bfMeleeRange() { return bfNum('BF_MELEE_RANGE', 62); }       // 近戰攻擊距離
function bfRangedRange() { return bfNum('BF_RANGED_RANGE', 320); }    // 魔法系敵人的攻擊距離
function bfBodyRadius() { return bfNum('BF_BODY_RADIUS', 20); }
function bfBossRadius() { return bfNum('BF_BOSS_RADIUS', 52); }

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
  return Math.max(0, Math.sqrt(p.x * p.x + p.y * p.y) - bfEntityRadius(ent));
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
  return Math.sqrt(p.x * p.x + p.y * p.y);
}
function bfTravelSeconds(ent) {
  var cellsPerSec = (typeof VFX_PROJECTILE_SPEED_CELLS === 'number' && VFX_PROJECTILE_SPEED_CELLS > 0)
    ? VFX_PROJECTILE_SPEED_CELLS : 14;
  var min = (typeof VFX_TRAVEL_MIN_SEC === 'number') ? VFX_TRAVEL_MIN_SEC : 0.06;
  var max = (typeof VFX_TRAVEL_MAX_SEC === 'number') ? VFX_TRAVEL_MAX_SEC : 0.45;
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
      var x = Math.cos(ang) * dist, y = Math.sin(ang) * dist;
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
    ent.pos = { x: Math.cos(bestAng) * dist, y: Math.sin(bestAng) * dist };
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
  var justInRange = [];
  for (i = 0; i < live.length; i++) {
    var ent = live[i];
    var p = bfPos(ent);
    if (!p) continue;
    if (ent._enterCd > 0) continue;            // 還在進場：不參與逼近，也還不能被打
    var d = Math.sqrt(p.x * p.x + p.y * p.y);
    var stop = bfStopDistance(ent);
    if (d > stop) {
      var step = Math.min(d - stop, speed * dt);
      p.x -= (p.x / d) * step;
      p.y -= (p.y / d) * step;
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
  if (sp.kind === 'all') return { area: { x: 0, y: 0, r: Infinity }, targets: live };
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
