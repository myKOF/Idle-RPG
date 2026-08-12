'use strict';
/* ============ 戰場格位（敵方棋盤 + 選敵 + 範圍展開） ============
   本檔是「誰站在哪一格、該打誰、範圍打到誰」的唯一真實來源。
   模擬層（combat.js／skills.js）與顯示層都只呼叫這裡，不得自行實作第二套距離或選敵規則。

   必須能在三種環境載入且行為一致：
     1. 主執行緒 <script src="js/battlefield.js">
     2. Worker    importScripts('../battlefield.js')
     3. Node 測試 vm.runInContext
   因此：只用 ES5 語法、只掛全域、不碰 DOM、不碰 UI。

   格位座標一律 1-based：col 1 = 最靠近我方那一行，row 1 = 最上面那一列。
   棋盤尺寸與距離係數 → js/data.js（BF_* 常數，可由參數表調整）。 */

/* ---- 尺寸與距離 ---- */
function bfCols() { return Math.max(1, Number(typeof BF_COLS !== 'undefined' ? BF_COLS : 4) || 4); }
function bfRows() { return Math.max(1, Number(typeof BF_ROWS !== 'undefined' ? BF_ROWS : 4) || 4); }
function bfCellCount() { return bfCols() * bfRows(); }

/* 中央列：我方站在棋盤左側正中，因此最靠近的是中間那一（兩）列。
   偶數列取中間兩列，奇數列取正中一列。 */
function bfIsCenterRow(row) {
  return Math.abs(Number(row) - (bfRows() + 1) / 2) <= 0.5;
}

/* 單一格子到我方的距離：越小越近（數值語意見 data.js 的距離表註解）。 */
function bfCellDistance(col, row) {
  var perCol = Number(typeof BF_DIST_PER_COL !== 'undefined' ? BF_DIST_PER_COL : 2) || 0;
  var center = Number(typeof BF_DIST_CENTER_ROW !== 'undefined' ? BF_DIST_CENTER_ROW : 1) || 0;
  var outer = Number(typeof BF_DIST_OUTER_ROW !== 'undefined' ? BF_DIST_OUTER_ROW : 2) || 0;
  return perCol * (Number(col) - 1) + (bfIsCenterRow(row) ? center : outer);
}

/* 佔格：BOSS 為 BF_BOSS_W×BF_BOSS_H，其餘（含菁英）為 1×1。
   已配好格的實體以 ent.cell 上的實際佔格為準（放不下時會退回 1×1）。 */
function bfEntitySize(ent) {
  if (ent && ent.cell && ent.cell.w > 0 && ent.cell.h > 0) return { w: ent.cell.w, h: ent.cell.h };
  if (ent && ent.isBoss) {
    return {
      w: Math.max(1, Number(typeof BF_BOSS_W !== 'undefined' ? BF_BOSS_W : 2) || 1),
      h: Math.max(1, Number(typeof BF_BOSS_H !== 'undefined' ? BF_BOSS_H : 2) || 1)
    };
  }
  return { w: 1, h: 1 };
}

/* 實體佔用的所有格子；未配格回傳空陣列。 */
function bfEntityCells(ent) {
  var out = [];
  if (!ent || !ent.cell) return out;
  var size = bfEntitySize(ent);
  for (var c = 0; c < size.w; c++) {
    for (var r = 0; r < size.h; r++) {
      out.push({ col: ent.cell.col + c, row: ent.cell.row + r });
    }
  }
  return out;
}

/* 實體距離＝所佔格子中最近的那一格（BOSS 以最靠前的格子算）。
   未配格的實體視為最遠，避免它插隊搶走普攻目標。 */
function bfEntityDistance(ent) {
  var cells = bfEntityCells(ent);
  if (!cells.length) return Infinity;
  var best = Infinity;
  for (var i = 0; i < cells.length; i++) {
    var d = bfCellDistance(cells[i].col, cells[i].row);
    if (d < best) best = d;
  }
  return best;
}

/* 我方到某個敵人「中心」的直線距離，單位是格。
   投射物的飛行時間＝這個距離 ÷ 速度，所以打第 1 行的敵人比打第 4 行快得多——
   固定飛行時間會讓近的子彈慢吞吞、遠的又太快，傷害數字自然對不上命中的那一刻。
   我方視為棋盤左側外一格、對齊中央列（與距離表的設定一致）。 */
function bfPlayerAnchor() {
  return { col: 0, row: (bfRows() + 1) / 2 };
}
function bfTravelDistance(ent) {
  if (!ent || !ent.cell) return bfCols();      // 無格位資訊（高塔 BOSS）：以整個棋盤寬度當距離
  var size = bfEntitySize(ent);
  var center = { col: ent.cell.col + (size.w - 1) / 2, row: ent.cell.row + (size.h - 1) / 2 };
  var me = bfPlayerAnchor();
  var dc = center.col - me.col;
  var dr = center.row - me.row;
  return Math.sqrt(dc * dc + dr * dr);
}

/* 投射物飛到該敵人所需的秒數（夾在上下限之間，避免太近瞬間到、太遠拖太久）。 */
function bfTravelSeconds(ent) {
  var speed = (typeof VFX_PROJECTILE_SPEED_CELLS === 'number' && VFX_PROJECTILE_SPEED_CELLS > 0)
    ? VFX_PROJECTILE_SPEED_CELLS : 14;
  var min = (typeof VFX_TRAVEL_MIN_SEC === 'number') ? VFX_TRAVEL_MIN_SEC : 0.06;
  var max = (typeof VFX_TRAVEL_MAX_SEC === 'number') ? VFX_TRAVEL_MAX_SEC : 0.45;
  var sec = bfTravelDistance(ent) / speed;
  return Math.min(max, Math.max(min, sec));
}

/* 格位序號（0-based，左上到右下逐列）；供顯示層對位與除錯用。 */
function bfCellIndex(cell) {
  if (!cell) return -1;
  return (cell.row - 1) * bfCols() + (cell.col - 1);
}

/* ---- 配格 ---- */
function bfCellKey(col, row) { return col + ',' + row; }

function bfBoxFree(occupied, col, row, w, h) {
  if (col < 1 || row < 1 || col + w - 1 > bfCols() || row + h - 1 > bfRows()) return false;
  for (var c = 0; c < w; c++) {
    for (var r = 0; r < h; r++) {
      if (occupied[bfCellKey(col + c, row + r)]) return false;
    }
  }
  return true;
}

function bfFreeAnchors(occupied, w, h) {
  var out = [];
  for (var col = 1; col + w - 1 <= bfCols(); col++) {
    for (var row = 1; row + h - 1 <= bfRows(); row++) {
      if (bfBoxFree(occupied, col, row, w, h)) out.push({ col: col, row: row });
    }
  }
  return out;
}

function bfMarkOccupied(occupied, cell) {
  for (var c = 0; c < cell.w; c++) {
    for (var r = 0; r < cell.h; r++) occupied[bfCellKey(cell.col + c, cell.row + r)] = true;
  }
}

function bfCenteredOrigin(total, size) {
  // When an even-sized boss is placed on an odd-sized board there is no
  // single exact center cell; choose the right/bottom of the two closest
  // origins so the entity's center stays nearest the battlefield center.
  return Math.max(1, Math.floor((total - size + 1) / 2) + 1);
}

/* 隨機配格：就地寫入 ent.cell = { col, row, w, h }，回傳「成功配到格」的實體（維持傳入順序）。
   - 佔格大的先配，否則小怪會把 BOSS 需要的 2×2 空間切碎。
   - BOSS 若真的放不下就退回 1×1（寧可縮小佔格，也不要讓敵人整隻消失）。
   - 棋盤塞滿後仍配不到格的實體不會被回傳，由呼叫端決定捨棄。 */
function bfPlaceEnemies(enemies, keepPlaced) {
  var list = (enemies || []).filter(function (e) { return !!e; });
  var order = list.slice().sort(function (a, b) {
    var sa = bfEntitySize(a), sb = bfEntitySize(b);
    return (sb.w * sb.h) - (sa.w * sa.h);
  });
  var occupied = {};
  /* keepPlaced（波次串流用）：已經站在場上的敵人不重新配格，只把它們佔的格子標成已用，
     新的一波填進剩下的空格。不傳＝維持原本「整批重配」的行為（換關、死亡重來、測試）。 */
  for (var ki = 0; ki < (keepPlaced || []).length; ki++) {
    var kept = keepPlaced[ki];
    if (kept && kept.cell) bfMarkOccupied(occupied, kept.cell);
  }
  var ok = [];

  // Outdoor boss waves currently contain one boss, but keep this as a
  // count-based rule so it remains correct if the wave table changes. A
  // single boss owns the center 2x2 position before other enemies are
  // packed around it; multiple-boss waves retain the normal random layout.
  var bosses = list.filter(function (e) { return !!e.isBoss; });
  if (bosses.length === 1) {
    var boss = bosses[0];
    boss.cell = null;
    var bossSize = bfEntitySize(boss);
    var centered = {
      col: bfCenteredOrigin(bfCols(), bossSize.w),
      row: bfCenteredOrigin(bfRows(), bossSize.h)
    };
    if (bfBoxFree(occupied, centered.col, centered.row, bossSize.w, bossSize.h)) {
      boss.cell = { col: centered.col, row: centered.row, w: bossSize.w, h: bossSize.h };
      bfMarkOccupied(occupied, boss.cell);
      ok.push(boss);
      order = order.filter(function (e) { return e !== boss; });
    }
  }

  for (var i = 0; i < order.length; i++) {
    var ent = order[i];
    ent.cell = null;
    var size = bfEntitySize(ent);
    var spots = bfFreeAnchors(occupied, size.w, size.h);
    if (!spots.length && (size.w > 1 || size.h > 1)) {
      size = { w: 1, h: 1 };
      spots = bfFreeAnchors(occupied, 1, 1);
    }
    if (!spots.length) continue;
    var at = spots[Math.floor(Math.random() * spots.length)];
    ent.cell = { col: at.col, row: at.row, w: size.w, h: size.h };
    bfMarkOccupied(occupied, ent.cell);
    ok.push(ent);
  }
  return list.filter(function (e) { return ok.indexOf(e) >= 0; });
}

/* 棋盤還剩幾格可用。波次串流一次不能生超過空格數——多生出來的會在配格時被丟掉，
   白白消耗浮字序號與擲骰。placed 傳「已經在場上、要保留站位」的實體。 */
function bfFreeCellCount(placed) {
  var occupied = {};
  var used = 0;
  for (var i = 0; i < (placed || []).length; i++) {
    var ent = placed[i];
    if (!ent || !ent.cell) continue;
    for (var c = 0; c < (ent.cell.w || 1); c++) {
      for (var r = 0; r < (ent.cell.h || 1); r++) {
        var key = bfCellKey(ent.cell.col + c, ent.cell.row + r);
        if (!occupied[key]) { occupied[key] = true; used++; }
      }
    }
  }
  return Math.max(0, bfCellCount() - used);
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

/* 依距離排序的存活敵人；距離相同者隨機排列（規格：同距離隨機選一個）。 */
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

/* 兩個實體之間的格距（Chebyshev，含斜角）：0＝重疊、1＝相鄰。
   用於連鎖／濺射這類「從某個敵人往旁邊擴散」的效果，與「離我方多遠」的 bfEntityDistance 不同。 */
function bfEntityGap(a, b) {
  var ca = bfEntityCells(a), cb = bfEntityCells(b);
  if (!ca.length || !cb.length) return Infinity;
  var best = Infinity;
  for (var i = 0; i < ca.length; i++) {
    for (var j = 0; j < cb.length; j++) {
      var d = Math.max(Math.abs(ca[i].col - cb[j].col), Math.abs(ca[i].row - cb[j].row));
      if (d < best) best = d;
    }
  }
  return best;
}
function bfIsAdjacent(a, b) { return bfEntityGap(a, b) === 1; }

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

/* 連鎖的下一跳（給「一次算一跳」的呼叫端用，例如排程式的傳奇連鎖）：
   離 from 最近的其他敵人；from 為空時取離我方最近的；場上只剩 from 自己時回傳 from。
   與 bfChainOrder 的差別：這支一定會往外跳，不會停在 from 身上。 */
function bfChainNext(from, enemies) {
  var live = bfLiveList(enemies);
  if (!live.length) return null;
  if (!from) return bfPickPrimary(live, null);
  var other = bfNearestOther(from, live);
  if (other) return other;
  return live.indexOf(from) >= 0 ? from : bfPickPrimary(live, null);
}

/* 連鎖順序：從 from 出發，每一跳跳到「離上一個目標最近、且本輪還沒跳過」的敵人。
   全部跳過之後重置（允許循環），因此場上只有一個敵人時會回傳同一個 count 次——
   與改造前「round-robin 打滿次數」的行為一致，只是多敵人時改為由近而遠擴散。 */
function bfChainOrder(from, enemies, count) {
  var live = bfLiveList(enemies);
  if (!live.length || !(count > 0)) return [];
  var order = [];
  var used = [];
  // from 只是幾何起點，不一定是候選（例如印記餘波由主目標往外彈，主目標自己不再挨一次）
  var cur = from || null;
  for (var i = 0; i < count; i++) {
    var pool = [];
    for (var j = 0; j < live.length; j++) if (used.indexOf(live[j]) < 0) pool.push(live[j]);
    if (!pool.length) {
      used = [];
      pool = live.slice();
      // 循環一輪之後別又原地打同一隻（場上只剩一隻時例外，維持打滿次數）
      if (pool.length > 1 && cur) pool = pool.filter(function (e) { return e !== cur; });
    }
    var next;
    if (!cur) {
      next = bfPickPrimary(pool, null);           // 起點：離我方最近的
    } else if (pool.indexOf(cur) >= 0) {
      next = cur;                                  // 起點本身還沒跳過：第一跳打在主目標身上
    } else {
      next = bfNearestOther(cur, pool) || pool[0]; // 之後往最近的鄰居擴散
    }
    if (!next) break;
    order.push(next);
    used.push(next);
    cur = next;
  }
  return order;
}

/* ---- 範圍 ---- */
/* 技能範圍設定值 → { kind: 'single' | 'box' | 'all', h 直向格數, w 橫向格數, n 相容用 }
   寫法「A*B」＝直向 A 格 × 橫向 B 格（第一個數字是直向、第二個是橫向）：
     1*3 ＝ 直向 1 格、橫向 3 格 → 由左往右貫穿的一直線
     3*1 ＝ 直向 3 格、橫向 1 格 → 擋在面前的一道橫牆
     3*3 ＝ 3×3 方框
   另接受：空值／'single'／'1x1'／'單體'（單體）、'all'／'全體'（全場）、單一數字 N（N×N）。 */
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

function bfEnemiesInBox(col, row, w, h, live) {
  var out = [];
  for (var i = 0; i < live.length; i++) {
    var cells = bfEntityCells(live[i]);
    for (var c = 0; c < cells.length; c++) {
      if (cells[c].col >= col && cells[c].col < col + w &&
          cells[c].row >= row && cells[c].row < row + h) {
        // 佔多格的單位（BOSS）受範圍傷害仍只算命中 1 次 → 以實體去重
        out.push(live[i]);
        break;
      }
    }
  }
  return out;
}

function bfBoxCells(col, row, w, h) {
  var out = [];
  for (var c = 0; c < w; c++) for (var r = 0; r < h; r++) out.push({ col: col + c, row: row + r });
  return out;
}
function bfAllCells() {
  var out = [];
  for (var col = 1; col <= bfCols(); col++) for (var row = 1; row <= bfRows(); row++) out.push({ col: col, row: row });
  return out;
}
/* 格子清單 → 查表用的集合；bfEntityInCells 判斷實體是否有任一格落在集合內。 */
function bfCellSet(cells) {
  var set = {};
  for (var i = 0; i < (cells || []).length; i++) set[bfCellKey(cells[i].col, cells[i].row)] = true;
  return set;
}
function bfEntityInCells(ent, cellSet) {
  if (!cellSet) return true;
  var cells = bfEntityCells(ent);
  for (var i = 0; i < cells.length; i++) if (cellSet[bfCellKey(cells[i].col, cells[i].row)]) return true;
  return false;
}

/* 範圍落點：回傳 { cells 覆蓋到的格子, targets 實際被命中的實體（已依實體去重）}。
   box：在所有「包含主目標任一格」的 n×n 方框中，取命中敵人最多的那一個；
        同樣多時取整體距離較近者，仍相同則隨機——偶數方框（2×2）沒有唯一中心，
        用這條規則統一決定落點，避免各呼叫端自己猜。
   cells 是「打在地上的那塊區域」：領域類效果要記住它，之後每跳都打站在那塊區域裡的敵人。 */
function bfAreaPlacement(primary, enemies, shape) {
  if (!primary || primary.hp <= 0) return { cells: [], targets: [] };
  var live = bfLiveList(enemies);
  if (live.indexOf(primary) < 0) live.push(primary);
  var sp = bfParseShape(shape);
  if (sp.kind === 'all') return { cells: bfAllCells(), targets: live };
  if (sp.kind !== 'box') return { cells: bfEntityCells(primary), targets: [primary] };
  var w = Math.min(sp.w, bfCols());   // 橫向格數
  var h = Math.min(sp.h, bfRows());   // 直向格數
  if (w <= 1 && h <= 1) return { cells: bfEntityCells(primary), targets: [primary] };
  var anchors = [];
  var cells = bfEntityCells(primary);
  var seen = {};
  for (var i = 0; i < cells.length; i++) {
    for (var dc = 0; dc < w; dc++) {
      for (var dr = 0; dr < h; dr++) {
        var col = Math.min(Math.max(cells[i].col - dc, 1), bfCols() - w + 1);
        var row = Math.min(Math.max(cells[i].row - dr, 1), bfRows() - h + 1);
        var key = bfCellKey(col, row);
        if (seen[key]) continue;
        seen[key] = true;
        anchors.push({ col: col, row: row });
      }
    }
  }
  if (!anchors.length) return { cells: bfEntityCells(primary), targets: [primary] };
  var best = null;
  for (var a = 0; a < anchors.length; a++) {
    var hit = bfEnemiesInBox(anchors[a].col, anchors[a].row, w, h, live);
    if (hit.indexOf(primary) < 0) continue; // 一定要蓋住主目標
    var dist = 0;
    for (var k = 0; k < hit.length; k++) dist += bfEntityDistance(hit[k]);
    var cand = { at: anchors[a], hit: hit, dist: dist, r: Math.random() };
    if (!best || cand.hit.length > best.hit.length ||
        (cand.hit.length === best.hit.length &&
          (cand.dist < best.dist || (cand.dist === best.dist && cand.r < best.r)))) {
      best = cand;
    }
  }
  if (!best) return { cells: bfEntityCells(primary), targets: [primary] };
  return { cells: bfBoxCells(best.at.col, best.at.row, w, h), targets: best.hit };
}

/* 範圍展開：只要命中清單時用這支（等同 bfAreaPlacement().targets）。 */
function bfAreaTargets(primary, enemies, shape) {
  return bfAreaPlacement(primary, enemies, shape).targets;
}

/* 全場技（規格：以 4×4 中心為目標施放，對所有敵人造成傷害）。 */
function bfAllTargets(enemies) { return bfLiveList(enemies); }
