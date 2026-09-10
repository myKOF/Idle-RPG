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

test('USAGE-7B 用的是階段名稱，不是群組名稱', function () {
  /* Skills2 一列＝一個階段，特效填在階段上。標成群組名稱會指到一個根本沒用
     這個特效的階段——水龍捲是水流彈的第 7 階，標「水流彈」就是錯的。

     群組名稱只當前綴補上下文：「傷害強化」「擴散」這種階段名稱在很多群組裡
     都有，單看認不出是誰的。 */
  const skills2 = U.TABLES.filter(function (t) { return /Skills2/.test(t.file); })[0];
  assert.ok(skills2, 'Skills2 必須在掃描清單裡');
  assert.equal(skills2.nameColumn, '階段名稱', '名字要取階段，不是群組');
  assert.equal(skills2.groupColumn, '群組名稱', '群組名稱只當前綴');

  /* 逐階的完整清單（all）一律是 群組·階段，同名時不重複成「突刺·突刺」。 */
  const tables = U.scanTables(REPO);
  const labels = U.usageLabels(REPO);
  Object.keys(labels).forEach(function (id) {
    (labels[id].all || []).forEach(function (full) {
      assert.ok(!/^(.+)·\1$/.test(full),
        id + ' 的「' + full + '」把同名的群組與階段寫了兩次');
    });
  });

  /* 一個群組只用到一個階段、而且階段名與群組名不同時，列上要寫到階段——
     這正是使用者指出的那個問題（水龍捲是水流彈的第 7 階）。 */
  const single = Object.keys(tables).filter(function (id) {
    if (!labels[id] || labels[id].all.length !== 1) return false;
    const f = tables[id][0];
    return f && f.group && f.name && f.group !== f.name;
  });
  assert.ok(single.length > 0, '應該找得到「只被一個階段使用、且不同名」的例子');
  const f = tables[single[0]][0];
  assert.equal(labels[single[0]].labels[0], f.group + '·' + f.name,
    single[0] + ' 只被一階使用，列上就該寫到階段');
});

test('USAGE-7C 用到多階時列上收攏成群組名，逐階的細節留給 tooltip', function () {
  /* 全部逐階攤開會撐爆：hit-wind 有 15 個階段，接起來 119 個字，而且同一個
     群組名重複六七次。收攏之後最長剩三十幾個字，一列放得下。 */
  const labels = U.usageLabels(REPO);

  const multi = Object.keys(labels).filter(function (id) {
    return labels[id].all.length > 3 && labels[id].labels.length < labels[id].all.length;
  });
  assert.ok(multi.length > 0, '應該找得到被多階共用而且有收攏的 preset');

  multi.forEach(function (id) {
    /* 收攏之後列上不該再出現同一個群組名兩次——那就是沒收攏 */
    const seen = Object.create(null);
    labels[id].labels.forEach(function (part) {
      const group = part.split('·')[0];
      assert.ok(!seen[group], id + ' 的列上「' + group + '」出現兩次，等於沒收攏');
      seen[group] = true;
    });
    /* all 一定比 labels 詳細，tooltip 才有東西可補；count 是逐階的總數 */
    assert.ok(labels[id].all.length >= labels[id].labels.length);
    assert.equal(labels[id].count, labels[id].all.length, 'count 要是逐階的總數');
  });

  /* 列上放得下：收攏後最長的一列不該再是一百多個字 */
  const longest = Object.keys(labels)
    .map(function (id) { return labels[id].labels.join('、').length; })
    .sort(function (a, b) { return b - a; })[0];
  assert.ok(longest <= 60, '收攏後最長的一列是 ' + longest + ' 字，太長就塞不進下拉');
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
  /* 每一列同時留著純 id 與顯示文字：id 拿去組網址與比對目前這一份，
     顯示文字只給人看。混成一個欄位的話，切換 preset 會帶著括號去打網址。 */
  assert.ok(/id: id,/.test(body), '每一列要保留純 id');
  assert.ok(/text:/.test(body), '顯示文字要另外存一欄');
});

test('USAGE-10 搜尋同時比對 id 與用途，否則打技能名等於找不到', function () {
  /* 用途標註最大的價值就是「打雷球找得到 lightning-orb-field」。
     只比對 id 的話，那個標註就只是裝飾。 */
  const editor = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  const fill = editor.slice(editor.indexOf('function fillPresetPicker'));
  const body = fill.slice(0, fill.indexOf('\n  }'));
  assert.ok(/search:/.test(body) && /label/.test(body),
    '搜尋字串要含 id 與用途標籤');

  const filter = editor.slice(editor.indexOf('function comboFilter'));
  const fbody = filter.slice(0, filter.indexOf('\n  }'));
  assert.ok(/toLowerCase\(\)/.test(fbody), 'id 是小寫，輸入要先轉小寫再比對');
  assert.ok(/split\(/.test(fbody),
    '空白分隔的多個關鍵字要全部命中，否則「ground fire」會被 fire 的一大堆結果淹掉');
});

test('USAGE-11 切換 Preset 走整頁重載，未存檔要先問', function () {
  /* preset、layout、歷史、選取、gizmo 全部要換成另一份，
     重載是唯一能保證不會混到上一份殘留的做法。 */
  const editor = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  const fn = editor.slice(editor.indexOf('function choosePreset'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.ok(/encodeURIComponent\(id\)/.test(body), '要整頁重載，而且 id 要編碼');
  assert.ok(/isDirty\(\)/.test(body), '未存檔要先問一聲');
});

test('USAGE-13 伺服器行程比磁碟舊的時候，畫面要說出來', function () {
  /* 2026-09-09 實測踩到並且花了一輪來回才查出來的：伺服器是常駐行程，
     require 進去的檔改了不會生效；但它服務的 editor.js／css／html 是每次請求
     才讀磁碟（no-store）。於是「頁面是新版、伺服器是舊版」同時成立——
     使用者看到可搜尋的清單出來了、用途標註一個都沒有，而且沒有任何線索。

     兩種偵測涵蓋不同的舊法，缺一不可：
       usage 欄位不存在  → 伺服器舊到還沒有這個功能。只有前端察覺得到，
                           因為舊程式沒辦法回報自己舊。
       staleFiles 非空   → 伺服器有這個功能，而且自己發現載入後檔案被改過。 */
  const src = fs.readFileSync(path.join(REPO, 'tools/vfx/editor-server.cjs'), 'utf8');
  assert.ok(/RESTART_REQUIRED_FILES/.test(src), '要列出「改了必須重啟」的檔');
  assert.ok(/staleFiles: staleServerFiles\(\)/.test(src), '要跟著 /__presets 一起回報');
  /* 用內容雜湊而不是 mtime：merge 與 checkout 會動 mtime 但內容可能一樣，
     那種誤報久了就沒人理。 */
  assert.ok(/createHash/.test(src), '要比對內容雜湊');
  assert.ok(!/mtimeMs/.test(src), '不得用 mtime 判斷——會誤報');
  /* 清單必須涵蓋每一個 require 進來的專案內檔案，漏一個就是一種偵測不到的舊法。 */
  const required = (src.match(/require\('(\.[^']+)'\)/g) || [])
    .map(function (m) { return m.match(/'(\.[^']+)'/)[1]; })
    .filter(function (p) { return p.indexOf('export-assets') < 0; });  // 那支是延遲載入的
  required.forEach(function (rel) {
    const base = rel.split('/').pop();
    assert.ok(src.indexOf("'" + base + "'") >= 0,
      base + ' 有被 require 卻沒列進 RESTART_REQUIRED_FILES');
  });

  const editor = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  assert.ok(/data\.usage === undefined/.test(editor),
    '前端要能認出「舊到沒有這個欄位」的伺服器');
  assert.ok(/staleFiles/.test(editor), '前端也要處理伺服器自己回報的過期');
  assert.ok(/啟動VFX編輯器\.bat/.test(editor),
    '提示要直接講怎麼修，不能只說「伺服器過期」');
});

test('USAGE-14 清單頂端多一行警告時，鍵盤高亮不得整個差一格', function () {
  /* 警告是插在清單最上面的一個 div。用 children[i] 取列會差一格——
     高亮在 A、捲到的卻是 B，而且只有在警告出現時才會發生。 */
  const editor = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  const fn = editor.slice(editor.indexOf('function scrollComboActive'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.ok(/querySelectorAll\('\.combo-row'\)/.test(body),
    '要用 class 查，不能用 children 的索引');
  assert.ok(!/host\.children\[/.test(body));
});

test('USAGE-12 清單用 mousedown 挑選，不是 click', function () {
  /* input 的 blur 會先關掉清單，click 永遠打不中——這是實測過的，
     不是理論：改成 click 之後整個清單會變成點不動。 */
  const editor = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  const fn = editor.slice(editor.indexOf('function renderComboList'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.ok(/addEventListener\('mousedown'/.test(body), '要用 mousedown');
  assert.ok(!/addEventListener\('click'/.test(body), '不得用 click');
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
