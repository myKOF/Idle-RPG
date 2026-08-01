/* 線上／離線班表的地基測試。

   班表本身（何時上線、何時下線）是 scripts/run_sim.js 主迴圈的控制流，
   不好單獨測；但它踩在兩塊積木上，而這兩塊都曾經是靜默失效的來源：

     scripts/sim/policy.js   有沒有把 dailyActiveHours 轉出來
     scripts/sim/engine.js   offlineFor() 有沒有真的走遊戲自己的離線結算

   第一塊正是 dailyActiveHours 之所以是死欄位的第二層原因：四份策略 JSON 都宣告了，
   但 createPolicy() 只挑特定欄位轉出，這個欄位從來沒有離開過 JSON。
   run_sim.js 就算讀了也只會讀到 undefined，而且不會有任何錯誤。 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createPolicy } = require('../scripts/sim/policy.js');
const { createEngine } = require('../scripts/sim/engine.js');

/* ---- 策略層：宣告值要能傳到驅動端 ---- */

test('createPolicy 會把 dailyActiveHours 轉出來', () => {
  const p = createPolicy({ name: 't', decideEveryGameSec: 10, dailyActiveHours: 2, rules: [] });
  assert.equal(p.dailyActiveHours, 2);
});

test('沒宣告 dailyActiveHours 時是 undefined，不給預設值', () => {
  /* 給 24 當預設看起來無害，但那會讓「沒宣告」與「宣告 24 小時」變成同一件事，
     摘要就分不出這一場是沒有班表、還是刻意全天在線。 */
  const p = createPolicy({ name: 't', decideEveryGameSec: 10, rules: [] });
  assert.equal(p.dailyActiveHours, undefined);
});

test('四份強度策略都宣告了 dailyActiveHours，且值互不相同', () => {
  /* 這四個值是四種玩家強度唯一的時間差異來源。有人把某一份的欄位刪掉或打錯，
     那份策略會安靜地退化成「全程在線」——與班表實作前一模一樣。 */
  const seen = new Map();
  for (const key of ['light', 'moderate', 'heavy', 'extreme']) {
    const raw = require(`../scripts/sim/policy.${key}.json`);
    assert.equal(typeof raw.dailyActiveHours, 'number', `policy.${key}.json 缺少 dailyActiveHours`);
    assert.ok(raw.dailyActiveHours > 0 && raw.dailyActiveHours <= 24,
      `policy.${key}.json 的 dailyActiveHours 超出 0~24：${raw.dailyActiveHours}`);
    assert.ok(!seen.has(raw.dailyActiveHours),
      `policy.${key}.json 與 policy.${seen.get(raw.dailyActiveHours)}.json 的 dailyActiveHours 相同（${raw.dailyActiveHours}），兩種強度分不開`);
    seen.set(raw.dailyActiveHours, key);
  }
});

/* ---- 引擎：離線一定要走遊戲自己的結算 ---- */

test('offlineFor 推進牆鐘但不推進 gt，收益由遊戲的 applyOfflineProgress 給', () => {
  const eng = createEngine({ seed: 777 }).boot(null);
  eng.stepSeconds(120);

  const before = eng.view();
  const wallBefore = eng.gameTimeSec();
  const sum = eng.offlineFor(8 * 3600);
  const after = eng.view();

  /* 離線期間遊戲根本沒在跑，gt（戰鬥時鐘）不該前進 */
  assert.equal(after.gt, before.gt, '離線時 gt 不該前進');
  /* 牆鐘要走完整段離線時間，下一次離線的 elapsed 才會正確 */
  assert.ok(Math.abs((eng.gameTimeSec() - wallBefore) - 8 * 3600) < 1,
    `牆鐘應前進 8 小時，實際 ${eng.gameTimeSec() - wallBefore} 秒`);

  /* 摘要是遊戲原生的物件，欄位名不由 harness 決定 */
  assert.ok(sum, '8 小時離線應該要有結算結果');
  assert.equal(sum.seconds, 8 * 3600);
  /* 每 OFFLINE_KILL_INTERVAL 秒一隻，這是遊戲的固定費率模型，與線上 DPS 無關。
     不在這裡寫死 20 秒——那會變成公式的第二份副本；改讀遊戲自己的常數。 */
  const interval = eng.ctx.OFFLINE_KILL_INTERVAL;
  assert.equal(sum.kills, Math.floor(8 * 3600 / interval));
  assert.ok(sum.gold > 0 && sum.xp > 0, '離線應該要有金幣與經驗');
  assert.ok(after.gold > before.gold, '金幣要真的入帳到 G，不是只出現在摘要裡');
});

test('離線不足一分鐘時由遊戲自己判定不計，harness 不預先過濾', () => {
  const eng = createEngine({ seed: 777 }).boot(null);
  eng.stepSeconds(120);
  const before = eng.view();
  const sum = eng.offlineFor(30);
  assert.equal(sum, null);
  assert.equal(eng.view().gold, before.gold, '不計的離線不該改變任何資源');
  /* 就算不計收益，牆鐘仍然要走——時間確實過去了 */
  assert.ok(eng.gameTimeSec() > 120);
});

test('連續兩次離線不會把同一段時間重算', () => {
  /* offlineFor 結算完必須把 savedAt 對到新的當下。沒對的話第二次的 elapsed
     會從第一次的起點算起，那一段收益就領兩次。 */
  const eng = createEngine({ seed: 777 }).boot(null);
  eng.stepSeconds(120);
  const a = eng.offlineFor(3600);
  const b = eng.offlineFor(3600);
  assert.ok(a && b);
  assert.equal(a.seconds, 3600);
  assert.equal(b.seconds, 3600, '第二次的 elapsed 應該只有 1 小時，不是累計的 2 小時');
});
