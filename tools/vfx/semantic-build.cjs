'use strict';
/* ============================================================
   semantic-build.cjs — 由標註規則產生 vfx/asset-semantics.json

   輸入：
     vfx/asset-index.json      事實層（唯讀，本工具絕不修改）
     vfx/asset-groups.json     候選分組（像素簽章證實的同形載體）
     vfx/semantic-rules.json   AI 標註規則，每條都列出實際看過的代表圖

   語意如何傳播（決定 confidence，也決定能不能傳）：
     evidence  規則裡明列、實際看過的圖            → high
     group     與 evidence 同組（像素簽章證實同形）→ high
     family    只由命名樣式匹配到                  → medium（規則需明示 propagation=family）

   沒有任何一條規則命中的素材，**不收錄**——寧可留白也不硬猜。

   用法：
     node tools/vfx/semantic-build.cjs
     node tools/vfx/semantic-build.cjs --check      只比對不寫入（不同則 exit 1）
     node tools/vfx/semantic-build.cjs --report     列出未分類素材
   ============================================================ */

const fs = require('fs');
const path = require('path');

const vocab = require('./vfx-semantic-vocab.cjs');
const grouping = require('./semantic-grouping.cjs');
const libraryRoot = require('./vfx-library-root.cjs');

const SCHEMA_VERSION = 1;
const BUILDER_VERSION = '1.0.0';
const EXIT = { OK: 0, DIFFERENT: 1, PRECONDITION: 2 };

function readJson(relative) {
  const full = path.join(libraryRoot.REPO_ROOT, relative);
  if (!fs.existsSync(full)) {
    console.error('[ERROR] 找不到 ' + relative);
    process.exit(EXIT.PRECONDITION);
  }
  return JSON.parse(fs.readFileSync(full, 'utf8'));
}

function matchesRule(asset, rule) {
  const select = rule.select || {};
  if (select.package && asset.package !== select.package) return false;
  if (select.format && asset.format !== select.format) return false;
  if (select.maxDepth !== undefined) {
    const depth = asset.relativePath.split('/').length - 1;
    if (depth > select.maxDepth) return false;
  }
  if (select.namePattern) {
    const name = grouping.normalizedName(asset.relativePath);
    if (!new RegExp(select.namePattern).test(name)) return false;
  }
  /* 依相對路徑選取。Kenney 那幾包的分類藏在檔名裡（fire_01、smoke_04…），
     所以原本只有 namePattern 就夠；但經過 Import 分類的素材，
     **資料夾本身就是分類**（new_materials/muzzle-flash/…），
     這時用路徑選比用檔名選可靠得多——檔名可能是錯的，資料夾是我們判定的。 */
  if (select.pathPattern) {
    if (!new RegExp(select.pathPattern).test(asset.relativePath)) return false;
  }
  return true;
}

/* group manifest 不能無條件信任：過期或被手改的檔案會把錯誤素材
   提升成 source=group／confidence=high，違反「同組必須有像素證據」的前提。
   這裡做不需要讀圖的結構驗證；像素層級的重驗證請重跑 semantic-grouping.cjs。 */
function validateGroups(groups, assetsById) {
  const problems = [];
  if (!groups || !Array.isArray(groups.groups)) return ['asset-groups.json 缺少 groups 陣列'];
  if (groups.threshold === undefined || groups.threshold > grouping.SAME_SHAPE_THRESHOLD) {
    problems.push('分組門檻 ' + groups.threshold + ' 高於目前允許的 ' + grouping.SAME_SHAPE_THRESHOLD);
  }
  const seen = new Map();
  for (const group of groups.groups) {
    if (!Array.isArray(group.members) || !group.members.length) {
      problems.push(group.groupId + '：成員清單空白');
      continue;
    }
    if (typeof group.maxDistance !== 'number' || group.maxDistance > grouping.SAME_SHAPE_THRESHOLD) {
      problems.push(group.groupId + '：maxDistance=' + group.maxDistance + ' 超過門檻');
    }
    for (const member of group.members) {
      if (!assetsById.has(member)) problems.push(group.groupId + '：成員不存在於事實層 → ' + member);
      if (seen.has(member)) {
        problems.push('素材同時屬於多個群組：' + member +
          '（' + seen.get(member) + ' 與 ' + group.groupId + '）');
      }
      seen.set(member, group.groupId);
    }
  }
  return problems;
}

function build(index, groups, rulesDoc) {
  const assetsById = new Map(index.assets.map(function (a) { return [a.assetId, a]; }));

  const problems = validateGroups(groups, assetsById);

  // assetId → 同組的所有成員（像素簽章證實為同一圖形的不同載體）
  const groupOf = new Map();
  for (const group of groups.groups) {
    for (const member of group.members) groupOf.set(member, group.members);
  }

  // 規則重疊必須在指派前先查，結果才不會依賴規則檔的順序
  const claimedBy = new Map();
  for (const rule of rulesDoc.rules) {
    for (const asset of index.assets) {
      if (!matchesRule(asset, rule)) continue;
      if (claimedBy.has(asset.assetId)) {
        problems.push('素材被多條規則命中：' + asset.assetId +
          '（' + claimedBy.get(asset.assetId) + ' 與 ' + rule.ruleId + '）');
      } else {
        claimedBy.set(asset.assetId, rule.ruleId);
      }
    }
  }

  const records = new Map();
  const ruleStats = [];

  for (const rule of rulesDoc.rules) {
    const evidenceIds = rule.evidence || [];
    for (const id of evidenceIds) {
      if (!assetsById.has(id)) {
        problems.push(rule.ruleId + '：evidence 指向不存在的 assetId → ' + id);
      }
    }
    // 與 evidence 同組的成員：像素證實同形，可比照 evidence 對待
    const verified = new Set(evidenceIds);
    for (const id of evidenceIds) {
      const members = groupOf.get(id);
      if (members) members.forEach(function (m) { verified.add(m); });
    }

    const matched = index.assets.filter(function (a) { return matchesRule(a, rule); });
    const counts = { evidence: 0, group: 0, family: 0, skipped: 0 };

    for (const asset of matched) {
      let source;
      if (evidenceIds.indexOf(asset.assetId) >= 0) source = 'evidence';
      else if (verified.has(asset.assetId)) source = 'group';
      else if (rule.propagation === 'family') source = 'family';
      else { counts.skipped++; continue; }

      const confidence = source === 'family' ? 'medium' : 'high';
      const record = Object.assign({ assetId: asset.assetId }, rule.semantics, {
        confidence: confidence,
        source: source,
        ruleId: rule.ruleId
      });
      if (rule.needsReview) record.needsReview = true;

      if (records.has(asset.assetId)) continue;   // 重疊已於前置檢查回報
      records.set(asset.assetId, record);
      counts[source]++;
    }
    ruleStats.push({ ruleId: rule.ruleId, matched: matched.length, counts: counts });
  }

  // 詞彙表 ＋ 事實不變量驗證：兩者都必須在寫檔前擋下，
  // 不能只靠事後的 query --validate 才發現
  for (const record of records.values()) {
    const errors = vocab.validateRecord(record)
      .concat(vocab.validateAgainstFacts(record, (assetsById.get(record.assetId) || {}).facts));
    if (errors.length) problems.push(record.assetId + '：' + errors.join('；'));
  }

  const sorted = Array.from(records.values()).sort(function (a, b) {
    return a.assetId < b.assetId ? -1 : 1;
  });
  const unclassified = index.assets
    .filter(function (a) { return !records.has(a.assetId); })
    .map(function (a) { return a.assetId; })
    .sort();

  return { records: sorted, unclassified: unclassified, ruleStats: ruleStats, problems: problems };
}

function serialise(index, result) {
  // 刻意不含產生時間：同樣輸入必須產生位元相同的檔案
  const byConfidence = { high: 0, medium: 0 };
  result.records.forEach(function (r) { byConfidence[r.confidence]++; });
  return JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    kind: 'vfx-asset-semantics',
    note: '語意層＝AI 判斷。事實層在 vfx/asset-index.json，兩者永久分離；Scanner 重跑不會覆蓋本檔。',
    libraryId: index.libraryId,
    builder: { name: 'semantic-build', version: BUILDER_VERSION },
    vocabulary: vocab.VOCAB,
    recordCount: result.records.length,
    confidenceCounts: byConfidence,
    needsReviewCount: result.records.filter(function (r) { return r.needsReview; }).length,
    unclassifiedCount: result.unclassified.length,
    records: result.records
  }, null, 2) + '\n';
}

function main() {
  const argv = process.argv.slice(2);
  const check = argv.indexOf('--check') >= 0;
  const report = argv.indexOf('--report') >= 0;
  const unknown = argv.filter(function (a) { return ['--check', '--report'].indexOf(a) < 0; });
  if (unknown.length) {
    console.error('[ERROR] 未知參數：' + unknown.join(' '));
    process.exit(EXIT.PRECONDITION);
  }

  const index = readJson('vfx/asset-index.json');
  const groups = readJson('vfx/asset-groups.json');
  const rulesDoc = readJson('vfx/semantic-rules.json');

  const result = build(index, groups, rulesDoc);

  if (result.problems.length) {
    console.error('\n[ERROR] 標註有問題，不產生語意檔：');
    result.problems.slice(0, 30).forEach(function (p) { console.error('  - ' + p); });
    process.exit(EXIT.PRECONDITION);
  }

  const text = serialise(index, result);
  const outPath = path.join(libraryRoot.REPO_ROOT, 'vfx', 'asset-semantics.json');

  console.log('規則命中統計：');
  result.ruleStats.forEach(function (s) {
    console.log('  ' + s.ruleId.padEnd(30) +
      ' 命中 ' + String(s.matched).padStart(4) +
      '  evidence=' + s.counts.evidence + ' group=' + s.counts.group +
      ' family=' + s.counts.family + (s.counts.skipped ? ' 略過=' + s.counts.skipped : ''));
  });
  console.log('\n語意紀錄：' + result.records.length + ' / ' + index.assets.length +
    '　未分類：' + result.unclassified.length);

  if (report && result.unclassified.length) {
    console.log('\n未分類素材（不硬猜，留待下一批）：');
    result.unclassified.forEach(function (id) { console.log('  ' + id); });
  }

  if (check) {
    if (!fs.existsSync(outPath)) {
      console.error('\n[ERROR] --check：找不到現有語意檔');
      process.exit(EXIT.DIFFERENT);
    }
    if (fs.readFileSync(outPath, 'utf8') === text) {
      console.log('\n--check：與現有語意檔完全相同。');
      process.exit(EXIT.OK);
    }
    console.error('\n[ERROR] --check：語意檔內容不同。');
    process.exit(EXIT.DIFFERENT);
  }

  fs.writeFileSync(outPath, text, 'utf8');
  console.log('已寫入 vfx/asset-semantics.json（' + text.length + ' bytes）');
  process.exit(EXIT.OK);
}

if (require.main === module) main();
else module.exports = { build: build, serialise: serialise, matchesRule: matchesRule, validateGroups: validateGroups };
