/* 離線擊殺速率上限。

   離線結算原本是固定費率「每 20 秒 1 隻菁英怪」，不看命中率、不看怪物血量、
   也不看玩家傷害。關卡數一旦跑贏傷害，這個費率就會發放玩家實際做不到的擊殺——
   實測角色停在關卡 188 時線上每分鐘殺 0～1 隻普通怪，離線同時段照發每分鐘 3 隻
   菁英怪（經驗是普通怪的 2 倍）。於是「推到推不動然後掛機」變成最佳解。

   修法是把實測擊殺速率當下限：離線間隔取 max(固定費率, 實際做得到的間隔)。
   下面測的是這個上限本身，以及它最容易出錯的三個邊界：暖機、空窗、離線回來。 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createEngine } = require('../scripts/sim/engine.js');

const ctx = createEngine({ seed: 1 }).ctx;
const { offlineKillIntervalFor, offlineKillCount, OFFLINE_KILL_INTERVAL, OFFLINE_PACE_TAU } = ctx;

/* 造一份「穩定每 T 秒殺一隻」的量測值：直接跑 recordFieldKillPace 的遞推式，
   免得測試自己另外抄一份公式——抄一份就會跟遊戲脫鉤。 */
function paceOf(intervalSec, kills, startMs) {
  const p = { kills: 1, sec: OFFLINE_KILL_INTERVAL, at: 0 };
  let now = startMs || 1000000;
  for (let i = 0; i < kills; i++) {
    if (p.at > 0) {
      const gap = (now - p.at) / 1000;
      const k = Math.exp(-gap / OFFLINE_PACE_TAU);
      p.kills = p.kills * k + 1;
      p.sec = p.sec * k + gap;
    }
    p.at = now;
    now += intervalSec * 1000;
  }
  return p;
}

test('沒有量測資料時沿用固定費率——舊存檔升級不能被靜默降收益', () => {
  assert.equal(offlineKillIntervalFor(null, Date.now()), OFFLINE_KILL_INTERVAL);
  assert.equal(offlineKillIntervalFor({}, Date.now()), OFFLINE_KILL_INTERVAL);
  assert.equal(offlineKillIntervalFor({ kills: 0, sec: 0, at: 0 }, Date.now()), OFFLINE_KILL_INTERVAL);
});

test('新角色的預設值就是固定費率，離線收益與改動前相同', () => {
  const fresh = ctx.newGameState();
  const p = fresh.stage.killPace;
  assert.equal(offlineKillIntervalFor(p, 0), OFFLINE_KILL_INTERVAL);
});

test('殺得比固定費率快時不會更快——這是下限，不是換算', () => {
  /* 每 2 秒一隻遠快於 20 秒。上限只該把慢的壓下去，不該把快的放大，
     否則就變成「線上愈猛、離線愈爽」的另一種失衡。 */
  const p = paceOf(2, 60);
  assert.equal(offlineKillIntervalFor(p, p.at), OFFLINE_KILL_INTERVAL);
});

test('殺得比固定費率慢時，離線間隔跟著變慢', () => {
  const p = paceOf(120, 30);                        // 每 2 分鐘一隻
  const iv = offlineKillIntervalFor(p, p.at);
  assert.ok(iv > 100 && iv < 140, `間隔應接近實測的 120 秒，實得 ${iv.toFixed(1)}`);

  /* 換算成 8 小時離線的擊殺數：固定費率 1,440 隻 → 實測後 240 隻。 */
  assert.equal(offlineKillCount(8 * 3600, 0), 1440);
  assert.equal(offlineKillCount(8 * 3600, 0, iv), Math.floor(8 * 3600 / iv));
});

test('剛開打就登出不會被低估——分子分母要分開衰減', () => {
  /* 只維護「速率的移動平均」的話，估計值要 tau（10 分鐘）才暖機完畢，
     開局 120 秒會低估 5 倍，等於平白砍掉剛上線就登出的玩家的離線收益。
     分母只累計真的觀測到的時間，第二隻怪之後就已經是正確的速率。 */
  const p = paceOf(12, 10);                         // 才打了約 2 分鐘
  assert.equal(offlineKillIntervalFor(p, p.at), OFFLINE_KILL_INTERVAL,
    '每 12 秒一隻快於固定費率，不該因為暖機不足被判成打不動');
});

test('存檔前的空窗期算進分母——停在打不動的關卡整晚，離線就該歸零', () => {
  /* 這是這次要修的那個行為。空窗期是「觀測到了、但一隻都沒殺」的時間，
     不算進去的話，離線會照著八小時前那個還殺得動的速率發獎。 */
  const p = paceOf(10, 60);                         // 曾經每 10 秒一隻，遠快於固定費率
  assert.equal(offlineKillIntervalFor(p, p.at), OFFLINE_KILL_INTERVAL, '前提：空窗前是達標的');

  const after8h = p.at + 8 * 3600 * 1000;
  const iv = offlineKillIntervalFor(p, after8h);
  assert.ok(iv === Infinity || iv > 3600,
    `八小時沒殺半隻之後間隔應該爆掉，實得 ${iv}`);
  assert.equal(offlineKillCount(8 * 3600, 0, iv), 0, '離線收益應歸零');
});

test('空窗只有幾分鐘時幾乎不受影響——正常遊玩不能被誤傷', () => {
  /* 過關空檔、切地圖、打 BOSS 都會有幾分鐘沒有野外擊殺。
     空窗一律重罰的話，正常遊玩也會掉收益。這裡要的是平滑退化，不是懸崖。 */
  const p = paceOf(10, 60);                         // 每 10 秒一隻，本來就快過固定費率
  const iv = offlineKillIntervalFor(p, p.at + 180 * 1000);
  assert.ok(iv < 60, `三分鐘空窗不該把間隔推爆，實得 ${iv}`);
  assert.ok(offlineKillCount(8 * 3600, 0, iv) > 0.5 * offlineKillCount(8 * 3600, 0),
    '三分鐘空窗仍應保有大部分離線收益');
});

/* ---- 端到端：真的跑一場遊戲 ---- */

test('實際跑一場：打得動的時候離線收益與改動前相同', () => {
  const eng = createEngine({ seed: 777 }).boot(null);
  eng.stepSeconds(300);
  const sum = eng.offlineFor(8 * 3600);
  assert.ok(sum, '打得動就該有離線收益');
  assert.equal(sum.kills, offlineKillCount(8 * 3600, 0),
    '第一關殺得比每 20 秒一隻還快，擊殺數應與固定費率相同');
});

test('實際跑一場：離線回來的第一隻怪不會把離線時間算成打不動', () => {
  /* applyOfflineProgress 結算完必須把速率量測的時間錨點移到當下。
     不移的話，回來打的第一隻怪會把整段離線時間算進分母，
     速率被灌成幾乎為零，於是「離線一次之後就再也領不到離線收益」。 */
  const eng = createEngine({ seed: 777 }).boot(null);
  eng.stepSeconds(300);
  const first = eng.offlineFor(8 * 3600);
  eng.stepSeconds(300);                              // 回來繼續打
  const second = eng.offlineFor(8 * 3600);
  assert.ok(second, '第二次離線仍應有收益');
  assert.equal(second.kills, first.kills, '兩次離線的擊殺數應相同');
});

test('實際跑一場：速率量測有寫進存檔', () => {
  /* 只存在記憶體的話，關掉分頁就沒了，而離線結算正是在下次開檔時跑。 */
  const eng = createEngine({ seed: 777 }).boot(null);
  eng.stepSeconds(300);
  const saved = JSON.parse(eng.saveJson());
  const p = saved.stage.killPace;
  assert.ok(p && typeof p === 'object', 'stage.killPace 應寫進存檔');
  assert.ok(p.kills > 1 && p.sec > 0 && p.at > 0,
    `應該累積到實測值，實得 ${JSON.stringify(p)}`);
});
