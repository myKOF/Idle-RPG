'use strict';
/* ============================================================
   vfx-preset-usage.test.cjs — 「這個 Preset 用在哪裡」的標註不得過期

   受測對象：
     tools/vfx/preset-usage.cjs                       掃表 ＋ 讀人工清單
     docs/vfx/VFX_PRESET_USAGE_OUTSIDE_TABLES.md      人工清單本身
     tools/vfx/editor-server.cjs                      把結果送給下拉

   這一份存在的理由只有一個：**人工清單一定會過期**。

   配置表那半邊是掃出來的，永遠是新的；但「普攻用哪個 preset」這種寫死在
   js/data.js 的對應沒有表格欄位可填，只能靠人記在文件裡。文件不會自己更新，
   而過期的後果是安靜的——下拉上少一個括號，看起來就像那份 preset 是孤兒，
   於是有人把還在用的東西當成廢棄品刪掉。

   所以這裡三面夾住那份清單：列了不存在的、列了已經不用的、用了卻沒列的，
   三種都轉紅。
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const U = require('../tools/vfx/preset-usage.cjs');
const REPO = path.resolve(__dirname, '..');

test('USAGE-1 人工清單裡的 preset 都真的存在', function () {
  const known = new Set(U.presetIds(REPO));
  const missing = U.readOutsideTables(REPO)
    .filter(function (r) { return !known.has(r.id); })
    .map(function (r) { return r.id; });
  assert.deepEqual(missing, [],
    '清單指到不存在的 preset（改名或刪檔之後忘了更新 ' + U.OUTSIDE_DOC_REL + '）');
});

test('USAGE-2 人工清單裡的 preset 都還在 js/ 裡被引用', function () {
  /* 反向的過期：功能被拿掉了，清單卻還留著那一行，於是下拉上標著一個
     根本沒人用的用途。grep 到不代表真的在用，但 grep 不到就一定沒在用。 */
  const inJs = U.presetIdsInJs(REPO);
  const stale = U.readOutsideTables(REPO)
    .filter(function (r) { return !inJs[r.id]; })
    .map(function (r) { return r.id; });
  assert.deepEqual(stale, [],
    '這幾個已經不在 js/ 裡了，請從 ' + U.OUTSIDE_DOC_REL + ' 移除');
});

test('USAGE-3 js/ 裡寫死、而表上沒有的 preset，都要登記在人工清單', function () {
  /* 這是最重要的一條：新增一個寫死的對應卻忘了登記，那份 preset 會在下拉上
     顯示成孤兒。反過來也擋得住「應該填表卻寫死在程式裡」——那時候正確的
     修法是去填表，不是往清單裡加一行（文件裡有寫）。 */
  const tables = U.scanTables(REPO);
  const listed = new Set(U.readOutsideTables(REPO).map(function (r) { return r.id; }));
  const inJs = U.presetIdsInJs(REPO);
  const unlisted = Object.keys(inJs)
    .filter(function (id) { return !tables[id] && !listed.has(id); })
    .sort();
  assert.deepEqual(unlisted, [],
    '這幾個在 js/ 裡被引用、表上卻沒有，請登記到 ' + U.OUTSIDE_DOC_REL +
    '（若它其實該填在技能表上，就去填表）');
});

test('USAGE-4 顯示標籤不得含括號或逗號，否則塞進「id（標籤）」會變成一團', function () {
  const bad = U.readOutsideTables(REPO)
    .filter(function (r) { return !r.label || /[(),，（）]/.test(r.label); })
    .map(function (r) { return r.id + '：' + r.label; });
  assert.deepEqual(bad, []);
});

test('USAGE-5 每一列表格都掃得到欄位（表頭改名要當場轉紅）', function () {
  /* 欄位名稱寫死在 preset-usage.cjs 裡。設計師把「攻擊特效」改成別的名字時，
     掃描會安靜地回空——整個下拉的括號一起消失，而且不會有人知道為什麼。 */
  U.TABLES.forEach(function (t) {
    const file = path.join(REPO, t.file);
    if (!fs.existsSync(file)) return;
    const header = U.csvParse(fs.readFileSync(file, 'utf8'))[0]
      .map(function (h) { return String(h).split('\n')[0].trim(); });
    assert.ok(header.indexOf(t.nameColumn) >= 0, t.file + ' 找不到名稱欄「' + t.nameColumn + '」');
    assert.ok(header.indexOf(t.keyColumn) >= 0, t.file + ' 找不到主鍵欄「' + t.keyColumn + '」');
    const hit = U.VFX_COLUMNS.filter(function (c) { return header.indexOf(c) >= 0; });
    assert.ok(hit.length >= 3, t.file + ' 只找到 ' + hit.length + ' 個特效欄位：' + hit.join('、'));
  });
});

test('USAGE-6 表上填的 preset 都真的存在', function () {
  const known = new Set(U.presetIds(REPO));
  const ghosts = Object.keys(U.scanTables(REPO))
    .filter(function (id) { return !known.has(id); }).sort();
  assert.deepEqual(ghosts, [],
    '技能表填了不存在的 preset id——遊戲跑到那一列時 Runtime 會退回舊畫法');
});

test('USAGE-7 每個有人用的 preset 都叫得出名字', function () {
  /* 名稱只填在群組的第一列，階段列與超神列是空的。少了「群組ID → 名稱」的
     回填，那些 preset 會被當成「有人用但沒有名字」而完全不標註。 */
  const tables = U.scanTables(REPO);
  const nameless = Object.keys(tables)
    .filter(function (id) { return !tables[id][0].name; }).sort();
  assert.deepEqual(nameless, [], '這幾個在表上被用到卻取不到名稱');
});

test('USAGE-8 下拉的標註跟著 preset 清單一起送，不另開端點', function () {
  /* 下拉只請求一次，多一趟往返只是讓選單晚一點填好。 */
  const src = fs.readFileSync(path.join(REPO, 'tools/vfx/editor-server.cjs'), 'utf8');
  assert.ok(/presetUsage\.usageLabels\(/.test(src), '伺服器要算用途');
  assert.ok(/usage: usage/.test(src), '要跟著 /__presets 一起回');
  /* 算不出來不能連 preset 清單都給不出來——標註是加分項，清單是必要功能。 */
  const route = src.slice(src.indexOf('if (pathname === PRESET_LIST_PATH)'));
  assert.ok(/try \{[\s\S]{0,200}usageLabels[\s\S]{0,200}catch/.test(route),
    '用途算不出來時要吞掉錯誤，不得讓整個清單失敗');

  const editor = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  const fn = editor.slice(editor.indexOf('function fillPresetPicker'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.ok(/data\.usage/.test(body), '下拉要讀 usage');
  assert.ok(/opt\.value = id;/.test(body),
    'option 的 value 必須維持純 id——它會被拿去組網址與比對目前這一份');
});

test('USAGE-9 現況記錄：有用途的與孤兒的數量', function () {
  /* 不是斷言某個數字，是讓這份報告在測試輸出裡看得到。
     孤兒數量突然暴增（例如有人改壞了掃描）會在這裡看得出來。 */
  const ids = U.presetIds(REPO);
  const labels = U.usageLabels(REPO);
  const used = ids.filter(function (id) { return labels[id]; });
  const orphans = ids.filter(function (id) { return !labels[id]; });
  assert.equal(used.length + orphans.length, ids.length);
  assert.ok(used.length > 0, '不可能一個都沒有人用——掃描壞了');
  console.log('    · preset ' + ids.length + ' 份：有用途 ' + used.length +
    '、孤兒 ' + orphans.length);
});
