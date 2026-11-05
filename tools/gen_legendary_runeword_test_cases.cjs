#!/usr/bin/env node
'use strict';
/* 產生 docs/ANTIGRAVITY_LEGENDARY_RUNEWORD_TEST_CASES.md——給驗證者（Antigravity）的「全部傳奇特效＋全部符文真言」回歸測試用例。
   條目、名稱、說明、配方、孔數、最低品質與預期屬性一律從資料表與引擎讀（js/data.js PASSIVE_POOL、js/runeword_data.js），
   機制層的測試重點寫在 tools/legendary_runeword_test_notes.cjs。改了資料表或註記重跑本檔：

     node tools/gen_legendary_runeword_test_cases.cjs            # 寫入文件
     node tools/gen_legendary_runeword_test_cases.cjs --check    # 只檢查文件是否已是最新（不寫檔）

   符文與符文真言的完整數值對照沿用 docs/RUNEWORD_TEST_MATRIX.md（tools/gen_runeword_test_matrix.cjs），本檔不另算第二份。 */
const fs = require('node:fs');
const path = require('node:path');
const { loadRuneEnv, makeItem, wordItem } = require('../tests/helpers/runeword-env.cjs');
const NOTES = require('./legendary_runeword_test_notes.cjs');

const root = path.resolve(__dirname, '..');
const docPath = path.join(root, 'docs', 'ANTIGRAVITY_LEGENDARY_RUNEWORD_TEST_CASES.md');
const c = loadRuneEnv({ noState: true });
const P = c.PASSIVE_POOL;
const RW_ONLY = c.RUNEWORD_ONLY_LEGENDARY;
const DISABLED = c.LEGACY_LEGENDARY_DISABLED;

/* 生效位置：列出含該 fx 鍵的程式檔（不列行號，避免程式一改文件就過期）。 */
const CODE_FILES = ['legendary.js', 'formula.js', 'combat.js', 'skills2.js', 'skills.js', 'runeword.js', 'tower.js', 'status.js', 'player.js'];
const CODE = {};
CODE_FILES.forEach((f) => { CODE[f] = fs.readFileSync(path.join(root, 'js', f), 'utf8'); });
/* 通用參數名（maxStacks、dur…）到處都有，不拿來定位生效位置。 */
const GENERIC_FX_KEYS = ['maxStacks', 'dur', 'sec', 'chance', 'pct', 'count', 'hits', 'gap', 'm', 'cooldownSec', 'dmgRedPct', 'rangeM', 'summons'];
function filesWith(word) {
  if (GENERIC_FX_KEYS.indexOf(word) >= 0) return [];
  const re = new RegExp('\\b' + word + '\\b');
  return CODE_FILES.filter((f) => re.test(CODE[f]));
}

const legendKeys = Object.keys(P).filter((k) => P[k].legendary);
const groupIds = [];
legendKeys.forEach((k) => { const g = P[k].relatedSkill; if (g && groupIds.indexOf(g) < 0) groupIds.push(g); });
const cat = (k) => (RW_ONLY[k] ? 'rwonly' : DISABLED[k] ? 'disabled' : P[k].relatedSkill ? 'skill' : 'general');
const byCat = { skill: [], rwonly: [], disabled: [], general: [] };
legendKeys.forEach((k) => byCat[cat(k)].push(k));

/* 被哪些符文真言借用 */
const borrowedBy = {};
c.RUNEWORDS.forEach((w) => (w.legend || []).forEach((k) => { (borrowedBy[k] = borrowedBy[k] || []).push(w); }));

const groupName = (g) => (c.SKILLS2[g] ? c.SKILLS2[g].name : g);
function legendDesc(k) {
  const d = P[k];
  const v = c.passiveValueFor(k);
  let s = d.desc.replace(/\{v\}/g, String(v));
  if (d.fx && d.fx.stagger) s = s.replace('{tick}', String(v / d.fx.stagger.sec));
  return s;
}

/* 編號：L001～ 依「技能群組（依 PASSIVE_POOL 出現順序）→ 符文真言專屬 → 停用 → 通用」 */
const legendOrder = [];
groupIds.forEach((g) => byCat.skill.filter((k) => P[k].relatedSkill === g).forEach((k) => legendOrder.push(k)));
['rwonly', 'disabled', 'general'].forEach((ct) => byCat[ct].forEach((k) => legendOrder.push(k)));
const LID = {};
legendOrder.forEach((k, i) => { LID[k] = 'L' + String(i + 1).padStart(3, '0'); });
const WID = {};
c.RUNEWORDS.forEach((w, i) => { WID[w.id] = 'W' + String(i + 1).padStart(2, '0'); });

const runeName = (id) => c.RUNE_BY_ID[id].name;
const rarityLabel = (i) => c.RARITIES[i].name + '（`' + i + '`）';
function minRarityFor(n, twoHand) {
  for (let i = 0; i < c.RARITIES.length; i++) if (c.rwSlotCountAt(i, twoHand) >= n) return i;
  return -1;
}
/* 測試用裝備：取 bases 第一個可行型態（同 tests/helpers/runeword-env.cjs wordItem），稀有度取剛好放得下的最低品質。 */
function testItemFor(w) {
  const ref = wordItem(c, w.id);
  const twoHand = c.isTwoHandItem(ref);
  const rarity = minRarityFor(w.runes.length, twoHand);
  const it = rarity < 0 ? null : makeItem(c, { slot: ref.slot, weaponType: ref.weaponType, rarity, level: 100 });
  const gmSlot = ref.slot === 'weapon' ? ref.weaponType : ref.slot;
  return { ref, it, rarity, twoHand, gmSlot };
}

function procLine(pr) {
  const cond = [];
  if (pr.chance) cond.push(pr.chance + '% 機率');
  if (pr.every) cond.push(pr.on === 'tick' ? '每 ' + pr.every + ' 秒' : '每第 ' + pr.every + ' 次');
  if (pr.below) cond.push('生命 < ' + pr.below + '%');
  if (pr.cd) cond.push('冷卻 ' + pr.cd + ' 秒');
  const acts = (pr.acts || []).map((a) => (NOTES.ACT[a.act] ? NOTES.ACT[a.act](a) : '`' + a.act + '`'));
  return '觸發「' + NOTES.TRIGGER[pr.on] + '」' + (cond.length ? '（' + cond.join('、') + '）' : '') + '：' + acts.join('；');
}

function generate() {
  const L = [];
  const push = (s) => L.push(s === undefined ? '' : s);
  const tierCount = [1, 2, 3, 4].map((t) => c.RUNEWORDS.filter((w) => w.tier === t).length);

  push('# Antigravity 測試指令：全部傳奇特效與符文真言回歸');
  push();
  push('> 由 `node tools/gen_legendary_runeword_test_cases.cjs` 依 `js/data.js`（`PASSIVE_POOL`）、`js/runeword_data.js` 與引擎產生，**請勿手改**；機制層的測試重點在 `tools/legendary_runeword_test_notes.cjs`。');
  push('> 符文與符文真言的完整數值對照（33 顆符文單顆數值、各配方在參考裝備上的屬性）沿用 `docs/RUNEWORD_TEST_MATRIX.md`，設計說明見 `docs/RUNEWORD_DESIGN.md`。');
  push();
  push('- 提出者：Claude｜測試分支：`ai/claude`（含 GM 指令 `legend`，見 `GM_command.md` 4.6 節）；不要在 develop 上測');
  push('- 報告：`docs/LEGENDARY_RUNEWORD_TEST_REPORT.md`（繁體中文；截圖放 `tmp/legend-rw-shots/`，報告內用相對路徑引用；`tmp/` 被 git 忽略，報告附檔名清單）');
  push('- 驗證模式：唯讀。發現問題只記錄（條目編號、重現步驟、預期／實際、截圖、Console 錯誤），不要改程式。');
  push();

  /* ---- 0. 條目數核對 ---- */
  push('## 0. 範圍與條目數核對');
  push();
  push('| 類別 | 數量 | 條目編號 | 取得方式 |');
  push('| --- | --- | --- | --- |');
  const range = (keys) => (keys.length ? LID[keys[0]] + '～' + LID[keys[keys.length - 1]] : '—');
  const skillKeys = legendOrder.filter((k) => cat(k) === 'skill');
  push('| 傳奇特效：技能群組（' + groupIds.length + ' 群 × 5） | ' + skillKeys.length + ' | ' + range(skillKeys) + ' | 裝備隨機池；測試用 `legend 特效key` |');
  push('| 傳奇特效：符文真言專屬（`RUNEWORD_ONLY_LEGENDARY`） | ' + byCat.rwonly.length + ' | ' + range(byCat.rwonly) + ' | 只由符文真言借用；裝備上的同名詞條不生效 |');
  push('| 傳奇特效：停用（`LEGACY_LEGENDARY_DISABLED`） | ' + byCat.disabled.length + ' | ' + range(byCat.disabled) + ' | 不掉落、不生效；`legend 特效key 部位 force` 模擬舊存檔 |');
  push('| 傳奇特效：通用（不屬於技能群組） | ' + byCat.general.length + ' | ' + range(byCat.general) + ' | 裝備隨機池；`legend 特效key` |');
  push('| **傳奇特效合計**（`PASSIVE_POOL` 中 `legendary: true`） | **' + legendKeys.length + '** | L001～' + LID[legendOrder[legendOrder.length - 1]] + ' | |');
  push('| 符文真言（' + tierCount.join('／') + '：普通／精良／史詩／傳說） | **' + c.RUNEWORDS.length + '** | W01～' + WID[c.RUNEWORDS[c.RUNEWORDS.length - 1].id] + ' | `runeword 真言id` 發配方符文 |');
  push();
  const borrowedCount = Object.keys(borrowedBy).length;
  push('符文真言借用的傳奇特效共 ' + borrowedCount + ' 個（專屬 ' + byCat.rwonly.filter((k) => borrowedBy[k]).length + ' 個＋技能傳奇 ' + Object.keys(borrowedBy).filter((k) => !RW_ONLY[k]).length + ' 個），在兩邊的條目互相標註。');
  push('`PASSIVE_POOL` 另有 ' + (Object.keys(P).length - legendKeys.length) + ' 個非傳奇的被動（破甲、反震…），不在本文件範圍。');
  push();
  push('**核對方式**（三種都要對得上，任一不符就停止測試並回報）：');
  push();
  push('1. 文件是否最新：`node tools/gen_legendary_runeword_test_cases.cjs --check`（印出「已是最新」）；`node --test tests/legendary-runeword-test-cases.test.cjs` 會檢查每個傳奇特效鍵與真言 id 都在文件與註記裡各出現一次。');
  push('2. 遊戲內：GM `legend list` 回「' + legendKeys.length + ' 個」、`legend list rwonly` 回「' + byCat.rwonly.length + ' 個」、`legend list disabled` 回「' + byCat.disabled.length + ' 個」、`legend list general` 回「' + byCat.general.length + ' 個」；`legend list 群組id` 每群 5 個；`runeword list` 列出 ' + c.RUNEWORDS.length + ' 組。');
  push('3. 配置表：`config/CSV/Equipment_Affix.csv` 第一欄為「傳奇特效」的列數＝' + Object.keys(P).length + '（' + legendKeys.length + ' 個傳奇特效＋' + (Object.keys(P).length - legendKeys.length) + ' 個非傳奇被動）；`config/CSV/Runes.csv` 的符文真言列數＝' + c.RUNEWORDS.length + '（來源分別是 `config/Excel/Equipment_Affix.xlsx`、`config/Excel/Runes.xlsx`）。');
  push();

  /* ---- 1. 環境 ---- */
  push('## 1. 環境與準備');
  push();
  push('- 用 `ai/claude` 的 worktree 啟動本機伺服器（`啟動測試服.bat`），Canvas 戰場（預設）。開遊戲先 `GameSettings.set(\'mute\', true)` 靜音。');
  push('- **拋棄式測試存檔**：測試會改裝備、等級、技能；不要用正式存檔。面板隱藏時畫面不會前進，讓分頁保持在前景。');
  push('- 共通起手式：');
  push();
  push('```text');
  push('level 600                      先讓角色夠強');
  push('equipset legendary 100 0 0 wear 穿上整套傳說裝備（每件都帶 1 個隨機傳奇特效；不加 wear 只會放進背包）');
  push('legend clear all               清掉全身隨機帶的傳奇特效，避免干擾');
  push('legend knifeChain              把主手的傳奇特效設為待測的 key（預設部位 weapon）');
  push('sglv knife max                 技能群組全階滿級；再到技能頁把該技能裝上技能列');
  push('god 1                          鎖血（測死亡／扣血類特效時改 god 0 或 HP_lock）');
  push('spawn 8 small 1000             千倍血木樁看觸發率；真實血量用 spawn 8；單體用 spawn 1 boss 1000');
  push('elite 1 all 3 1000000          讓敵人持續打你（受擊、格擋、反擊類）');
  push('statset crit 0                 需要穩定比較浮字時關爆擊；測完 statset clear');
  push('spawn off                      收尾');
  push('```');
  push();
  push('- 機率型效果至少觀察 40 次觸發機會；觸發率落在「表定值 ±10 個百分點」內算通過，偏離時記錄樣本數。');
  push('- 比較數值時先記「沒有該特效」的基準（`legend clear`），再裝上比對；同一場景、同一敵人、同一屬性覆寫。');
  push('- 傷害來源名稱可在戰鬥紀錄／戰鬥統計看到（例如「迅雷穿刺」「符文真言·擴散」「天罰」）。');
  push();

  /* ---- 2. 共通檢查 ---- */
  push('## 2. 共通檢查（每一類至少抽 3 個條目做完整一輪，並全部條目做 C1、C6）');
  push();
  push('| 編號 | 檢查 | 做法 | 通過標準 |');
  push('| --- | --- | --- | --- |');
  const C = [
    ['C1', '主執行緒畫面與 Worker 結果一致', '裝備詳情（主執行緒依快照渲染）顯示的傳奇特效／符文真言效果行，與實際戰鬥行為（Worker 計算）比對；屬性面板數值與浮字一致', '畫面寫的數字＝實際效果（AI_RULES 8.3）；沒有「畫面說有、戰鬥沒有」或反過來'],
    ['C2', '存讀檔後仍生效', '`save` 立即存檔 → 重新整理頁面 → 同一件裝備的傳奇特效 key、符文孔與成形的真言仍在，效果照常觸發', '存檔只存 `passive: { key }`；真言是當場判定的衍生狀態（不存檔），重載後自動恢復'],
    ['C3', '顯示文字走 String 表', '測試中看到的所有顯示文字（特效名、說明、狀態名、浮字、紀錄）都不是寫死字串；`node tools/string-table/build_string_csv.cjs --check` 回報「仍寫死 0 條」', '特效名稱與說明來自 Equipment_Affix 表、真言來自 Runes 表、其餘來自 String 表（AI_RULES 8.10）'],
    ['C4', '同名不生效', '兩件裝備設同一個 key（`legend bloodthirst weapon`＋`legend bloodthirst ring`）', '只有先穿上的那件生效，另一件說明後綴「(重覆)」且變灰；效果不疊兩次。符文真言借用＋裝備同名：也只生效一次（`legendaryEffects` 是布林集合）'],
    ['C5', '符文真言專屬與停用規則', '`legend 專屬key`（不加 force）應被拒絕；加 `force` 後裝備上有該詞條但**不生效**；同一個 key 由符文真言借用時才生效。停用的 5 個在任何來源都不生效', '新掉落的裝備（`equip legendary 100 weapon 200` 等大量發放）不會出現專屬或停用特效'],
    ['C6', 'Console 與效能', '每個條目測試期間看 Console', '沒有 error；長時間（≥ 2 分鐘）觸發型效果不讓 FPS 持續下降、物件數不無限累積'],
    ['C7', '野外與封魔塔', '抽每類 3 個條目到封魔塔（`tower_jump 10` 後挑戰）', '戰鬥中照常生效；擊殺類（狂暴血斧、亡者時間、擊殺回復、kill 觸發）在高塔**不作用**屬已知設計（只有 BOSS，擊殺即結算）'],
    ['C8', '換裝與換技能即時生效', '戰鬥中卸下／換上該裝備、拆掉一顆符文、把技能移出技能列', '效果立即消失或恢復（屬性快取以 `legendaryEffects` 物件為版本印記）'],
    ['C9', '舊存檔', '`docs/fixtures/save_lategame.json` 等舊存檔載入', '舊裝備上的停用／專屬詞條原樣保留、不報錯、不生效；舊附魔不生效'],
    ['C10', '雙手武器與修羅亂舞', '主手換雙手武器測一次技能群組特效；雙刀亂舞第 8 格修羅亂舞時副手雙手武器上的傳奇特效', '技能傳奇的數值不因雙手武器改變（說明值即實際值）；修羅亂舞未生效時副手雙手武器的特效不計']
  ];
  C.forEach((r) => push('| ' + r.join(' | ') + ' |'));
  push();

  /* ---- 3. 傳奇特效 ---- */
  push('## 3. 傳奇特效逐項（' + legendKeys.length + ' 個）');
  push();
  push('每個條目都要：①依「前置」準備 ②照「步驟與預期」至少觀察 2 次觸發並截圖（觸發瞬間＋狀態／數值） ③逐條驗「邊界」 ④做 C1。各條目共通的 C4（同名不生效）抽測即可。');
  push();
  let sec = 0;
  const legendBlock = (k) => {
    const d = P[k], n = NOTES.LEGEND[k] || {};
    const ct = cat(k);
    const status = { skill: '可隨機掉落（裝備傳奇池）', general: '可隨機掉落（裝備傳奇池）', rwonly: '**符文真言專屬**（裝備上不生效）', disabled: '**停用**（任何來源都不生效）' }[ct];
    const bw = borrowedBy[k] ? '｜被符文真言借用：' + borrowedBy[k].map((w) => '【' + w.name + '】' + WID[w.id]).join('、') : '';
    push('#### ' + LID[k] + ' `' + k + '`｜' + d.name + (d.relatedSkill ? '（' + groupName(d.relatedSkill) + '）' : ''));
    push();
    push('- 狀態：' + status + bw);
    push('- 說明（遊戲內）：' + legendDesc(k));
    let pre;
    if (ct === 'rwonly') pre = '`' + (borrowedBy[k] ? 'runeword ' + borrowedBy[k][0].id : '') + '`，依 ' + (borrowedBy[k] ? WID[borrowedBy[k][0].id] : '') + ' 做出符文真言並穿上';
    else if (ct === 'disabled') pre = '`equipset legendary 100 0 0 wear` → `legend clear all`；先不加 force 輸入 `legend ' + k + '`，應被拒絕';
    else pre = '`equipset legendary 100 0 0 wear` → `legend clear all` → `legend ' + k + '`' + (d.relatedSkill ? '；' + NOTES.GROUPS[d.relatedSkill].pre : '');
    push('- 前置：' + pre);
    push('- 步驟與預期：' + (n.s || '（缺註記）'));
    const edges = [];
    if (n.e) edges.push(n.e);
    if (ct === 'rwonly') edges.push('`legend ' + k + ' weapon force` 放在裝備上：不生效（與穿上符文真言時比對），裝備詳情該行顯示灰字並加「(僅符文真言生效)」（見第 5 節 K1）');
    if (ct === 'disabled') edges.push('`legend ' + k + ' weapon force` 放在裝備上：不生效，裝備詳情該行顯示灰字並加「(已停用)」（見第 5 節 K1）');
    if (ct === 'skill' || ct === 'general') edges.push('同名兩件只生效一件（C4）');
    if (d.relatedSkill) edges.push('技能沒裝上技能列時不作用');
    push('- 邊界：' + edges.join('；'));
    const risks = [];
    if (d.relatedSkill) risks.push(NOTES.GROUPS[d.relatedSkill].risk);
    if (d.relatedSkill) risks.push('`legendarySkill2Mods` 把同群組生效中的 fx 平坦合併：數字相加、物件後者覆蓋');
    if (n.r) risks.push(n.r);
    if (ct === 'rwonly') risks.push('閘門在 `js/formula.js` 聚合（略過裝備上的專屬鍵）與 `js/runeword.js` `rwFinishAggregate`（真言借用寫回）');
    if (ct === 'disabled') risks.push('閘門在 `js/legendary.js` `legendaryHas`；任何繞過它直接讀 `st.legendaryEffects` 的新程式都會讓停用失效');
    if (!risks.length) risks.push('數值讀 `passiveValueFor`（固定 base，不隨稀有度）');
    push('- 回歸風險：' + risks.join('；'));
    const fxKeys = Object.keys(d.fx || {});
    const where = {};
    fxKeys.concat([k]).forEach((fk) => filesWith(fk).forEach((f) => { (where[f] = where[f] || []).push(fk); }));
    const whereText = Object.keys(where).map((f) => '`js/' + f + '`（' + Array.from(new Set(where[f])).map((x) => '`' + x + '`').join('、') + '）').join('；');
    push('- 生效位置：' + (whereText || '（找不到，請回報）'));
    push();
  };
  groupIds.forEach((g) => {
    sec++;
    const keys = byCat.skill.filter((k) => P[k].relatedSkill === g);
    push('### 3.' + sec + ' 技能群組：' + groupName(g) + ' `' + g + '`（' + keys.length + ' 個）');
    push();
    keys.forEach(legendBlock);
  });
  [['rwonly', '符文真言專屬'], ['disabled', '停用'], ['general', '通用']].forEach(([ct, title]) => {
    sec++;
    push('### 3.' + sec + ' ' + title + '（' + byCat[ct].length + ' 個）');
    push();
    byCat[ct].forEach(legendBlock);
  });

  /* ---- 4. 符文真言 ---- */
  push('## 4. 符文真言逐項（' + c.RUNEWORDS.length + ' 組）');
  push();
  push('共通流程：依「測試裝備」用 GM 發一件剛好放得下的最低品質裝備並穿上 → `runeword 真言id` 發配方符文 → 裝備頁選該裝備 →「符文」→ 依配方順序點孔鑲入 → 按「刻印」→ 孔列下方出現符文真言橫幅＝成形。');
  push('「預期」是遊戲引擎對該測試裝備（Lv100、強化 +0）算出的效果行，裝備詳情應逐字相同（C1）；用別的等級或稀有度時屬性數字會不同、機制行不變。');
  push();
  push('**每一組都要驗的成形邊界**（W 條目只寫個別差異）：');
  push();
  push('- 順序錯誤不成形；中間空一孔（不連續）不成形；前後的孔可以空著。');
  push('- 裝備類型不符不成形（例：法杖類真言放劍上）；孔數不足放不下。');
  push('- 同一件同時符合多組配方時取符文數最多者。');
  push('- 拆掉（抹除）任一顆即失效、放回原順序即恢復；抹除會消耗費用、符文不退還。');
  push('- 同一組真言穿在兩件裝備上：屬性各算，機制（fx／觸發／被動／借用傳奇）只算一次。');
  push('- 圖鑑：成形一次後永久揭露（`runewordSeen`），存讀檔與拆裝後仍在（詳見 `docs/RUNEWORD_DESIGN.md` 7.5 節）。');
  push();
  [1, 2, 3, 4].forEach((tier) => {
    const words = c.RUNEWORDS.filter((w) => w.tier === tier);
    push('### 4.' + tier + ' 第 ' + tier + ' 級　' + c.RUNEWORD_TIER_NAMES[tier] + '（' + words.length + ' 組）');
    push();
    words.forEach((w) => {
      const t = testItemFor(w);
      const n = NOTES.RUNEWORD[w.id] || {};
      push('#### ' + WID[w.id] + ' `' + w.id + '`｜' + w.name);
      push();
      push('- 配方（依序）：' + w.runes.map((id) => runeName(id) + ' `' + id + '`').join(' → ') + '（' + w.runes.length + ' 孔）｜適用：' + c.rwBasesText(w) + (c.rwWordTwoHandOnly(w) ? '（只能放在雙手武器）' : ''));
      if (t.rarity < 0) {
        push('- 測試裝備：**目前沒有任何裝備有 ' + w.runes.length + ' 個符文孔**，無法成形——請回報');
      } else {
        push('- 測試裝備：`equip ' + t.rarity + ' 100 ' + t.gmSlot + '`（最低品質 ' + rarityLabel(t.rarity) + (t.twoHand ? '，雙手武器' : '') + '）→ 穿上 → `runeword ' + w.id + '`');
        const lines = c.rwDescribeLines(w, t.it);
        push('- 預期（裝備詳情的效果行）：');
        lines.forEach((ln) => push('  - ' + String(ln).replace(/\n/g, ' ')));
      }
      const mech = [];
      Object.keys(w.fx || {}).forEach((k) => { const f = NOTES.FX[k]; if (f) mech.push(f(w.fx[k], w.fx)); else if (f === undefined) mech.push('fx `' + k + '`（缺模板，請回報）'); });
      Object.keys(w.passives || {}).forEach((k) => mech.push(NOTES.PASSIVE[k] ? NOTES.PASSIVE[k](w.passives[k]) : '被動 `' + k + '`'));
      (w.procs || []).forEach((pr) => mech.push(procLine(pr)));
      (w.legend || []).forEach((k) => mech.push('借用傳奇特效【' + P[k].name + '】`' + k + '`：照 ' + LID[k] + ' 的步驟驗證' + (RW_ONLY[k] ? '（符文真言專屬）' : '（技能傳奇，需裝配 ' + groupName(P[k].relatedSkill) + '）')));
      if (!mech.length) mech.push('只有屬性條目：逐條比對屬性面板增加量＝預期');
      push('- 機制測試：');
      mech.forEach((m) => push('  - ' + m));
      const edges = [];
      if (n.e) edges.push(n.e);
      if ((w.procs || []).some((p) => p.cd)) edges.push('冷卻內不再觸發');
      if ((w.procs || []).some((p) => p.on === 'kill') || (w.fx && (w.fx.killHealPct || w.fx.killManaPct))) edges.push('高塔無擊殺事件');
      if ((w.procs || []).some((p) => p.acts.some((a) => a.act === 'recast' || a.act === 'castRandom'))) edges.push('免費施放不再觸發施放事件（巢狀上限 ' + c.RUNE_SETTINGS.combat.depthLimit + '），不得無限連鎖');
      push('- 邊界：' + (edges.length ? edges.join('；') : '見本節開頭的成形邊界'));
      const risks = ['屬性走與詞條同一套公式（`rwStatValue`，不乘雙手倍率）'];
      const fxk = Object.keys(w.fx || {});
      if (fxk.some((k) => /^dmg|DmgPct$/.test(k))) risks.push('條件式增傷收斂在 `rwOutgoingMultiplier`（併入 `legendaryOutgoingDamageMultiplier`）');
      if (fxk.indexOf('aspdMult') >= 0) risks.push('攻速乘區 `rwAttackSpeedMultiplier`（經 `legendaryAttackSpeedMultiplier`）');
      if (fxk.indexOf('cdPct') >= 0) risks.push('冷卻乘區 `rwCooldownFactor`（`js/skills2.js` 冷卻計算）');
      if (fxk.indexOf('manaCostRedPct') >= 0) risks.push('法力乘區 `rwManaCostFactor`（`js/skills.js`、`js/skills2.js` 多處扣法力）');
      if (fxk.indexOf('maxHitPct') >= 0) risks.push('單次受傷上限經 `rwMaxHitPct` 進 `resolveHit`');
      if (fxk.indexOf('reviveHpPct') >= 0) risks.push('死亡攔截 `rwTryRevive`（野外 `js/combat.js`、高塔 `js/tower.js` 兩個入口）');
      if (fxk.some((k) => /^kill/.test(k))) risks.push('擊殺掛勾 `rwOnKill`（只有野外）');
      if (fxk.indexOf('selfDrainPct') >= 0) risks.push('每 tick 自損在 `rwTick`');
      if ((w.procs || []).length) risks.push('觸發引擎 `rwFire`（`every`／`cd`／`chance` 計數存在 `RW_RT.procs`，戰鬥重置清空）');
      push('- 回歸風險：' + risks.join('；'));
      push();
    });
  });

  /* ---- 5. 待確認 ---- */
  push('## 5. 已知差異與待確認（測到時請標註「已知」，不要當成新 Bug 重複開）');
  push();
  push('| 編號 | 項目 | 說明 |');
  push('| --- | --- | --- |');
  push('| K1 | 停用／專屬特效在舊裝備上的顯示（**已修正** 2026-11-06） | 原本 `js/item.js` 的裝備詳情只對「同名重覆」加「(重覆)」灰字，停用與符文真言專屬的詞條照一般傳奇特效顯示，畫面看不出它不生效（違反 AI_RULES 8.3）。已修正：裝備詳情（含神鑄烙印的傳奇特效）對停用的顯示灰字＋「(已停用)」、對符文真言專屬的顯示灰字＋「(僅符文真言生效)」（`passiveInactiveNote`，String 表 2419／2420）。回歸：`legend deadTime weapon force`、`legend ghostLamp weapon force` 後看裝備詳情；一般特效與「(重覆)」顯示不變 |');
  push('| K2 | 特效說明與技能階名稱不一致 | 雙刀亂舞的【狂舞】【不屈之誓】【殺千刀】寫「暴風之舞」，第 7 階實際名稱是【暴風亂舞】；疾風迅雷的 5 個特效寫「疾風斬」（GM 文件也這樣稱呼）；火球術／雷球特效寫「殞石」「雷殞天落」，技能階是「隕石術」「雷隕天落」。只是文字，請列出確認 |');
  push('| K3 | 【雷散落】的「電殛擴散」 | 擴散數值讀第 5 階【靜電】（`lvs[4]`），第 6 階才叫【電殛】；請確認說明要寫哪一階 |');
  push('| K4 | 【燃燒法則】以狀態名稱比對 | `legendaryBurnDot` 以持續傷害名稱字面值「燃燒」判定；若 Status 表改名，特效會靜默失效。測試時確認燃燒狀態名稱仍為「燃燒」 |');
  push('| K5 | 高塔沒有擊殺事件 | 狂暴血斧、亡者時間、擊殺回復、kill 觸發在高塔不作用（設計如此，`docs/RUNEWORD_DESIGN.md` 第 7 節） |');
  push('| K6 | 法力消耗顯示 | 符文真言的法力消耗降低只影響實際扣除；技能列顯示仍是基礎值（已知限制） |');
  push();

  /* ---- 6. 報告格式 ---- */
  push('## 6. 報告格式');
  push();
  push('`docs/LEGENDARY_RUNEWORD_TEST_REPORT.md`：');
  push();
  push('1. 環境：分支與 commit、瀏覽器、測試存檔來源、`--check` 結果與第 0 節三種核對的實際數字。');
  push('2. 總表：每個條目一列（L001～' + LID[legendOrder[legendOrder.length - 1]] + '、W01～' + WID[c.RUNEWORDS[c.RUNEWORDS.length - 1].id] + '），欄位＝編號｜key／id｜結果（通過／失敗／無法測／已知 K#）｜觸發樣本數｜截圖檔名｜備註。');
  push('3. 失敗明細：編號、重現步驟（含 GM 指令）、預期、實際、截圖、Console 訊息。');
  push('4. 共通檢查 C1～C10 的結果與抽測了哪些條目。');
  push();
  return L.join('\n');
}

const text = generate();
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(docPath) ? fs.readFileSync(docPath, 'utf8').replace(/\r\n/g, '\n') : '';
  if (cur !== text) { console.error('docs/ANTIGRAVITY_LEGENDARY_RUNEWORD_TEST_CASES.md 不是最新，請執行 node tools/gen_legendary_runeword_test_cases.cjs'); process.exit(1); }
  console.log('docs/ANTIGRAVITY_LEGENDARY_RUNEWORD_TEST_CASES.md 已是最新');
} else {
  fs.writeFileSync(docPath, text);
  console.log('已更新 docs/ANTIGRAVITY_LEGENDARY_RUNEWORD_TEST_CASES.md（傳奇特效 ' + legendKeys.length + ' 個、符文真言 ' + c.RUNEWORDS.length + ' 組）');
}
