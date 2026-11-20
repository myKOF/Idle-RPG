'use strict';
/* ============ 決策點的面板按需建立（驅動端） ============

   ---- 為什麼要有這一層 ----

   決策點每 5 遊戲秒一次。原本每次都把策略宣告的面板全部建好再交給策略：
   extreme 策略 18 個面板，後期一次約 18ms（三套裝備評估 8.7ms、背包 5.3ms、技能 1.7ms…），
   而同一段 5 秒遊戲本體只跑約 84ms——AI 這一層吃掉兩成以上的時間。
   但大多數規則 15~7200 秒才到期一次，那些面板在大部分決策點沒有人讀。

   ---- 做法 ----

   1. 每輪先建「預期會讀」的面板：連續 STREAK 輪都被讀過的，直接建完整版。
   2. 其餘不建；有 lite 版的（PARTIAL）先建便宜的 lite 版。
   3. 策略讀到沒建的面板（或 lite 版沒有的欄位），直譯器丟 NeedPanel、還原 memo，
      這裡補建完整版後重跑同一輪。
   重跑看到的資料與「一開始就全建」完全相同，決策逐位相同——
   tests/sim-lazy-panels.test.cjs 以最終存檔雜湊反證（全建與按需兩種跑法雜湊必須相同）。

   ⚠️ 這個保證有一個前提：**建面板不會改變遊戲狀態**（不擲骰、不寫 G）。
   評估器面板本來就是唯讀的（tests/sim-evaluator.test.cjs 盯著）；若日後有面板違反，
   上面那支雜湊測試會紅燈，而不是讓模擬結果靜靜漂移。

   ⚠️ 已知的一個例外在休眠中：itemEnchants（js/item.js）會把舊格式的 {enchant} 就地
   正規化成 {enchants: []}，而背包面板的 itemScore 會走到它（docs/SIM_HARNESS.md ④）。
   現在 ENCHANT_ENABLED=false，那段直接 return、不改物件，所以兩種跑法存檔逐位相同。
   重新開啟附魔後，背包面板建得少會讓這個正規化晚一點發生——讀到的值一樣（讀的人都會先正規化），
   但存檔雜湊會不同，等價測試會紅燈。那時正解是讓 itemEnchants 不改物件（或在掉落時就建好 enchants），
   不是回頭全建面板。 */

/* lite 版：params 由原本的參數加上一個旗標得到；exclude 是 lite 版裡**不正確**的欄位
   （inv 的 items 在 lite 版是空陣列，不是不存在，所以要明列）。 */
const DEFAULT_PARTIAL = {
  inv: { flag: { items: false }, exclude: ['items'] },
  equipSets: { flag: { lite: true }, exclude: ['sets', 'candidates'] }
};

/* 連續幾輪被讀過才預先建完整版。1 的話「每 15 秒才讀一次」的面板會在讀完的下一輪白建一次；
   2 讓那種面板每次到期只多付一次重跑（約 3ms），而每一輪都讀的面板在第 3 輪起就不必重跑。 */
const STREAK = 2;

function keysExcept(obj, exclude) {
  return Object.keys(obj || {}).filter((k) => exclude.indexOf(k) < 0);
}

/* names：策略宣告的 needPanels。build(name, params)：engine.panel。paramsFor(name)：策略宣告的 panelParams。 */
function createPanelSupplier(opts) {
  const names = opts.names || [];
  const build = opts.build;
  const paramsFor = opts.paramsFor || (() => undefined);
  const partial = opts.partial || DEFAULT_PARTIAL;
  const streak = (typeof opts.streak === 'number') ? opts.streak : STREAK;
  const run = Object.create(null);           // 連續被讀的輪數
  const stats = { decisions: 0, retries: 0, fullBuilds: 0, liteBuilds: 0, skipped: 0, eagerEquivalentBuilds: 0 };

  function buildFull(n) { stats.fullBuilds++; return build(n, paramsFor(n)); }
  function buildLite(n) {
    stats.liteBuilds++;
    return build(n, Object.assign({}, paramsFor(n) || {}, partial[n].flag));
  }

  /* makeState(panels)：回傳這一輪要交給策略的 state（view、gameTimeSec…），panels 由這裡填。 */
  function decide(policy, makeState) {
    stats.decisions++;
    stats.eagerEquivalentBuilds += names.length;
    const panels = {}, skip = {}, part = {};
    for (const n of names) {
      const pz = partial[n];
      if ((run[n] || 0) >= streak) {
        panels[n] = buildFull(n);
        if (pz) part[n] = keysExcept(panels[n], pz.exclude);
      } else if (pz) {
        panels[n] = buildLite(n);
        skip[n] = keysExcept(panels[n], pz.exclude);
      } else {
        skip[n] = null;
      }
    }
    const state = makeState(panels);
    /* 這一輪的序列化快取：重跑之間只有新補建的面板要重新序列化（見 policy.js stateJson）。
       面板物件在這一輪內不會被改動（建好就只讀），所以以物件識別當鍵是安全的；
       下一輪的面板都是新建的物件，快取自然作廢。 */
    const jsonCache = new WeakMap();
    let r;
    for (let guard = 0; ; guard++) {
      if (guard > names.length + 1) throw new Error('面板按需建立：重跑次數超過面板數，直譯器的 LAZY 判斷可能有誤');
      r = policy.decideLazy(state, { skip, part }, jsonCache);
      if (!r.needPanel) break;
      const n = r.needPanel;
      if (!(n in skip)) throw new Error('面板按需建立：策略要求的面板「' + n + '」不在待建清單裡');
      stats.retries++;
      panels[n] = buildFull(n);
      delete skip[n];
      if (partial[n]) part[n] = keysExcept(panels[n], partial[n].exclude);
    }
    for (const k in skip) stats.skipped++;
    const used = new Set(r.used || []);
    for (const n of names) run[n] = used.has(n) ? (run[n] || 0) + 1 : 0;
    return r.cmds;
  }

  return { decide, stats };
}

module.exports = { createPanelSupplier, DEFAULT_PARTIAL, STREAK };
