'use strict';
/* ============================================================
   merge-ai-tasks.cjs — docs/AI_TASKS.md 的自訂合併驅動程式

   為什麼需要它
   ------------
   AI_TASKS.md 是「每個 AI 各自在檔尾追加一段任務記錄」的流水帳。三個 AI
   分支同時工作時，兩邊都在同一個位置（檔尾）新增內容，行層級的三方合併
   一定判定為衝突——即使兩段文字彼此毫不相干。實際踩到過不只一次，而每次
   的解法都一樣：兩塊都留著。

   這件事修在 git 而不是修在同步腳本裡：merge driver 是 git 自己在合併時
   呼叫的，所以 sync_ai_worktrees、手動 git merge、rebase、cherry-pick
   全都適用。塞進同步腳本的話，只有跑那支 .bat 時才有效。

   怎麼判斷「不是同一區」
   ----------------------
   以 `## ` 標題把檔案切成區段，用標題當 key 做「區段層級」的三方合併：

     只有一邊新增        → 收下
     只有一邊修改        → 收那一邊
     兩邊改成一樣        → 收下
     兩邊改成不一樣      → 這才是真衝突，交回 git 標記衝突
     一邊刪除、一邊沒動  → 刪除
     一邊刪除、一邊修改  → 真衝突

   也就是使用者要的「只要改的不是同一區就自動合併」。

   安全底線
   --------
   自動合併最危險的失敗不是「合不起來」，而是「合起來了但少了一段，而且
   沒有人發現」。所以輸出前一定會重新解析自己的產物，逐區比對內容是否與
   決策結果逐字元相同；只要對不上就當作失敗，不輸出。

   任何一種說不準的情況——標題重複、檔案沒有任何區段、解析結果對不上——
   一律退回 git 原本的行為（git merge-file 產生衝突標記），讓人來看。
   自動化的預設值必須是「不確定就交給人」，不是「猜一個」。

   git 的呼叫方式（見 .gitattributes 的 merge=ai-tasks）
     node tools/merge-ai-tasks.cjs %O %A %B %L %P
       %O 共同祖先   %A 我方（同時是輸出檔）   %B 對方
       %L 衝突標記長度   %P 真實路徑（僅供訊息使用）
     結束碼 0 = 已乾淨合併；非 0 = 衝突，由 git 標記。
   ============================================================ */

const fs = require('fs');
const { spawnSync } = require('child_process');

const HEADING = /^## /;

/* 比較用的行：去掉尾端的 CR。
   標題整行就是區段的 key，所以只要一邊是 CRLF、一邊是 LF，key 就對不上，
   同一個區段會被當成「兩邊各自新增」而在輸出裡出現兩次——自動合併最不該
   發生的那種錯。本 repo 的 .gitattributes 已經統一成 LF，但驅動程式不該
   把「輸入一定乾淨」當成前提。輸出仍寫回原始的行，不改動任何人的行尾。 */
function cmp(line) { return line.replace(/\r$/, ''); }

/* 退回 git 內建的三方合併：把衝突標記寫進 %A 並回報衝突。
   刻意不自己拼衝突標記——標記長度、內容格式都該由 git 決定，
   自己寫一份遲早會與 git 的輸出不一致。 */
function fallback(ancestor, current, other, markerSize, reason) {
  process.stderr.write('[merge-ai-tasks] 交回 git 標記衝突：' + reason + '\n');
  const args = ['merge-file'];
  if (markerSize) args.push('--marker-size=' + markerSize);
  args.push(current, ancestor, other);
  const r = spawnSync('git', args, { stdio: 'inherit' });
  /* git merge-file 的結束碼是衝突區塊數；負數代表它自己出錯。
     無論哪種，對 git 來說都是「這個檔沒有乾淨合併」。 */
  process.exit(r.status === 0 ? 1 : (r.status > 0 ? 1 : 2));
}

/* 切成「前言 ＋ 有序區段」。前言是第一個 `## ` 之前的內容（檔案標題）。
   每個區段連同它後面的空行一起保留，重組時才不會把排版擠掉。 */
function parse(text) {
  const lines = text.split('\n');
  const preamble = [];
  const sections = [];
  let cur = null;
  for (const line of lines) {
    if (HEADING.test(line)) {
      if (cur) sections.push(cur);
      cur = { key: cmp(line), lines: [line] };
    } else if (cur) {
      cur.lines.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (cur) sections.push(cur);
  return { preamble: preamble, sections: sections };
}

/* 區段內容以「去掉尾端空行」後的文字比較。只差幾個空行不該算成兩邊都改過，
   否則貼上一段記錄時多按一次 Enter 就會變成衝突。 */
function bodyOf(section) {
  const l = section.lines.slice();
  while (l.length && !l[l.length - 1].trim()) l.pop();
  return l.map(cmp).join('\n');
}

function indexOf(parsed) {
  const map = new Map();
  for (const s of parsed.sections) {
    if (map.has(s.key)) return null;            // 標題重複就無法用標題當 key
    map.set(s.key, s);
  }
  return map;
}

function main() {
  const [ancestorPath, currentPath, otherPath, markerSize, displayPath] = process.argv.slice(2);
  if (!ancestorPath || !currentPath || !otherPath) {
    process.stderr.write('[merge-ai-tasks] 參數不足，需要 %O %A %B\n');
    process.exit(2);
  }
  const label = displayPath || currentPath;

  let base, ours, theirs;
  try {
    base = fs.readFileSync(ancestorPath, 'utf8');
    ours = fs.readFileSync(currentPath, 'utf8');
    theirs = fs.readFileSync(otherPath, 'utf8');
  } catch (e) {
    fallback(ancestorPath, currentPath, otherPath, markerSize, '讀檔失敗：' + e.message);
  }

  const pb = parse(base), po = parse(ours), pt = parse(theirs);
  const bi = indexOf(pb), oi = indexOf(po), ti = indexOf(pt);
  if (!bi || !oi || !ti) {
    fallback(ancestorPath, currentPath, otherPath, markerSize, label + ' 有重複的 ## 標題，無法以標題辨識區段');
  }
  if (!po.sections.length && !pt.sections.length) {
    fallback(ancestorPath, currentPath, otherPath, markerSize, label + ' 沒有任何 ## 區段，不適用本驅動程式');
  }

  /* 前言：三方合併同一套規則。兩邊都改且改得不一樣就是真衝突。 */
  const j = function (a) { return a.map(cmp).join('\n'); };
  const pre = { b: j(pb.preamble), o: j(po.preamble), t: j(pt.preamble) };
  let preamble;
  if (pre.o === pre.t) preamble = po.preamble;
  else if (pre.o === pre.b) preamble = pt.preamble;
  else if (pre.t === pre.b) preamble = po.preamble;
  else fallback(ancestorPath, currentPath, otherPath, markerSize, label + ' 的檔頭兩邊都改過且不一致');

  /* 順序沿用我方：我方本來就保有祖先的順序＋自己的新增，
     對方獨有的區段接在最後。流水帳的先後不影響正確性，
     但「決策必須是確定的」——同樣的兩份輸入永遠得到同樣的輸出。 */
  const decided = [];                            // [{key, lines, from}]
  const conflicts = [];

  const decide = function (key) {
    const b = bi.get(key), o = oi.get(key), t = ti.get(key);
    const bb = b ? bodyOf(b) : null;
    const ob = o ? bodyOf(o) : null;
    const tb = t ? bodyOf(t) : null;

    if (o && t) {
      if (ob === tb) return { pick: o, from: 'both' };
      if (b && ob === bb) return { pick: t, from: 'theirs' };
      if (b && tb === bb) return { pick: o, from: 'ours' };
      conflicts.push(key);                       // 同一區兩邊都改且不一致
      return null;
    }
    if (o && !t) {
      if (!b) return { pick: o, from: 'ours-new' };
      if (ob === bb) return null;                // 對方刪除、我方沒動 → 刪除
      conflicts.push(key);                       // 對方刪除、我方修改
      return null;
    }
    if (!o && t) {
      if (!b) return { pick: t, from: 'theirs-new' };
      if (tb === bb) return null;                // 我方刪除、對方沒動 → 刪除
      conflicts.push(key);                       // 我方刪除、對方修改
      return null;
    }
    return null;                                 // 兩邊都刪除
  };

  const seen = new Set();
  for (const s of po.sections) {
    seen.add(s.key);
    const d = decide(s.key);
    if (d) decided.push({ key: s.key, lines: d.pick.lines, from: d.from });
  }
  for (const s of pt.sections) {
    if (seen.has(s.key)) continue;
    seen.add(s.key);
    const d = decide(s.key);
    if (d) decided.push({ key: s.key, lines: d.pick.lines, from: d.from });
  }
  /* 只存在於祖先、兩邊都刪掉的區段不需要處理；但若一邊刪一邊改，
     上面的 decide 已經記進 conflicts。 */
  for (const key of bi.keys()) {
    if (!seen.has(key)) { seen.add(key); decide(key); }
  }

  if (conflicts.length) {
    fallback(ancestorPath, currentPath, otherPath, markerSize,
      label + ' 有 ' + conflicts.length + ' 個區段兩邊都改過：' + conflicts.join('、'));
  }

  /* 組出結果。每個區段之間保證恰好一個空行，尾端一個換行。 */
  const out = [];
  const preText = preamble.join('\n').replace(/\s+$/, '');
  if (preText) out.push(preText);
  for (const d of decided) out.push(d.lines.join('\n').replace(/\s+$/, ''));
  const merged = out.join('\n\n') + '\n';

  /* 安全底線：重新解析自己的產物，確認每個區段都在、而且內容與決策結果
     逐字元相同。合併邏輯寫錯時，最可能的症狀是安靜地少一段——
     這一段就是專門用來讓那件事變成「合併失敗」而不是「悄悄發生」。 */
  const check = parse(merged);
  const ci = indexOf(check);
  if (!ci || ci.size !== decided.length) {
    fallback(ancestorPath, currentPath, otherPath, markerSize,
      '自我驗證失敗：預期 ' + decided.length + ' 個區段，產物有 ' + (ci ? ci.size : '重複標題'));
  }
  for (const d of decided) {
    const got = ci.get(d.key);
    if (!got || bodyOf(got) !== bodyOf({ lines: d.lines })) {
      fallback(ancestorPath, currentPath, otherPath, markerSize,
        '自我驗證失敗：區段內容對不上 → ' + d.key);
    }
  }

  fs.writeFileSync(currentPath, merged);
  process.stderr.write('[merge-ai-tasks] 自動合併 ' + label + '：共 ' + decided.length +
    ' 區（我方新增 ' + decided.filter(function (d) { return d.from === 'ours-new'; }).length +
    '，對方新增 ' + decided.filter(function (d) { return d.from === 'theirs-new'; }).length + '）\n');
  process.exit(0);
}

if (require.main === module) main();
else module.exports = { parse: parse, bodyOf: bodyOf };
