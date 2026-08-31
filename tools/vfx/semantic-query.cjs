'use strict';
/* ============================================================
   semantic-query.cjs — 語意層 ＋ 事實層的聯合查詢與驗證

   這不是 Asset Browser，只是最小限度的查詢介面，
   用來驗證 metadata 真的能讓 Agent 選材。

   查詢一定同時吃兩層：
     語意層（AI 判斷）：kind / shape / usage / element / tags / confidence
     事實層（客觀量測）：blendMode、tintable、可平鋪、長寬比、尺寸
   後四項一律「推導」而不儲存，避免語意層複製事實資料。

   用法：
     node tools/vfx/semantic-query.cjs --usage ring --element neutral
     node tools/vfx/semantic-query.cjs --usage smoke --tintable
     node tools/vfx/semantic-query.cjs --shape streak --aspect tall
     node tools/vfx/semantic-query.cjs --usage noise --tileable
     node tools/vfx/semantic-query.cjs --validate
   ============================================================ */

const fs = require('fs');
const path = require('path');

const vocab = require('./vfx-semantic-vocab.cjs');
const libraryRoot = require('./vfx-library-root.cjs');

const EXIT = { OK: 0, FAILED: 1, PRECONDITION: 2 };

function load(relative) {
  const full = path.join(libraryRoot.REPO_ROOT, relative);
  if (!fs.existsSync(full)) {
    console.error('[ERROR] 找不到 ' + relative);
    process.exit(EXIT.PRECONDITION);
  }
  return JSON.parse(fs.readFileSync(full, 'utf8'));
}

/* 把兩層併成查詢用的視圖。事實欄位一律即時推導，不落地。 */
function joinLayers(index, semantics) {
  const factsById = new Map(index.assets.map(function (a) { return [a.assetId, a]; }));
  const rows = [];
  for (const record of semantics.records) {
    const asset = factsById.get(record.assetId);
    if (!asset) continue;
    const facts = asset.facts;
    const bounds = facts.contentBounds;
    rows.push({
      assetId: record.assetId,
      package: asset.package,
      semantic: record,
      derived: {
        blendMode: vocab.blendModeFromFacts(facts),
        tintable: vocab.tintableFromFacts(facts),
        tileable: vocab.tileableCandidateFromFacts(facts),
        backgroundVariant: facts.backgroundVariant || null,
        dimensions: facts.dimensions,
        aspect: (bounds && bounds.width && bounds.height)
          ? (bounds.height >= bounds.width * 1.6 ? 'tall'
            : bounds.width >= bounds.height * 1.6 ? 'wide' : 'square')
          : null
      }
    });
  }
  return rows;
}

function applyFilters(rows, filters) {
  return rows.filter(function (row) {
    const s = row.semantic;
    const d = row.derived;
    if (filters.kind && s.kind !== filters.kind) return false;
    if (!filters.kind && filters.vfxOnly !== false && s.kind !== 'vfx') return false;
    if (filters.shape && s.shape !== filters.shape) return false;
    if (filters.element && s.element !== filters.element) return false;
    if (filters.usage && (!s.usage || s.usage.indexOf(filters.usage) < 0)) return false;
    if (filters.tag && (!s.tags || s.tags.indexOf(filters.tag) < 0)) return false;
    if (filters.package && row.package !== filters.package) return false;
    if (filters.confidence === 'high' && s.confidence !== 'high') return false;
    if (filters.blend && d.blendMode !== filters.blend) return false;
    if (filters.tintable && d.tintable !== true) return false;
    if (filters.tileable && d.tileable !== true) return false;
    if (filters.aspect && d.aspect !== filters.aspect) return false;
    return true;
  });
}

/* 排序：先 high confidence，再 assetId。純決定性，沒有隨機或時間因素。 */
function rank(rows) {
  return rows.slice().sort(function (a, b) {
    const ca = a.semantic.confidence === 'high' ? 0 : 1;
    const cb = b.semantic.confidence === 'high' ? 0 : 1;
    if (ca !== cb) return ca - cb;
    return a.assetId < b.assetId ? -1 : 1;
  });
}

function query(index, semantics, filters) {
  return rank(applyFilters(joinLayers(index, semantics), filters));
}

/* ---------------- 驗證 ---------------- */

function validate(index, semantics) {
  const problems = [];
  const factIds = new Set(index.assets.map(function (a) { return a.assetId; }));
  const seen = new Set();

  for (const record of semantics.records) {
    if (!factIds.has(record.assetId)) {
      problems.push('語意 assetId 不存在於事實層：' + record.assetId);
    }
    if (seen.has(record.assetId)) problems.push('語意層有重複 assetId：' + record.assetId);
    seen.add(record.assetId);
    const errors = vocab.validateRecord(record);
    if (errors.length) problems.push(record.assetId + '：' + errors.join('；'));
  }

  // 不得含絕對路徑或時間戳
  const text = JSON.stringify(semantics);
  if (/[A-Za-z]:[\\/]/.test(text)) problems.push('語意層含磁碟機代號');
  if (text.indexOf('\\\\') >= 0) problems.push('語意層含反斜線路徑');
  if (/"(generatedAt|timestamp)"/.test(text)) problems.push('語意層含時間戳，會造成無意義 diff');

  // 灰階可染色素材不得被標成具體元素（可重用性的核心保證）
  const factsById = new Map(index.assets.map(function (a) { return [a.assetId, a]; }));
  for (const record of semantics.records) {
    if (record.kind !== 'vfx' || record.element === 'neutral') continue;
    const asset = factsById.get(record.assetId);
    if (!asset) continue;
    if (vocab.tintableFromFacts(asset.facts) === true) {
      problems.push('灰階可染色素材被標成 element=' + record.element +
        '（應為 neutral 以便跨元素重用）：' + record.assetId);
    }
  }
  return problems;
}

/* ---------------- 素材充分性評估 ----------------
   Semantic Search 不只要回答「有哪些素材可以用」，還要回答
   「現有素材是否足以完成這個 VFX」。缺口才能被具體指出，而不是硬做。

   判定：
     必要圖層無候選            → INSUFFICIENT
     全部有候選但有品質疑慮／
     只有 medium 信心／選用圖層缺 → SUFFICIENT_WITH_LIMITATIONS
     其餘                      → SUFFICIENT */
function validateCoverageSpec(spec) {
  const problems = [];
  if (!spec || typeof spec !== 'object') return ['spec 不是物件'];
  if (!Array.isArray(spec.layers) || spec.layers.length === 0) {
    // 空的 layers 會讓「什麼都沒查」得到 SUFFICIENT，是最危險的假陽性
    problems.push('spec.layers 不得為空——空清單會產生虛假的 SUFFICIENT');
    return problems;
  }
  spec.layers.forEach(function (layer, i) {
    const at = 'layers[' + i + ']';
    if (typeof layer.layer !== 'string' || !layer.layer) problems.push(at + ' 缺少 layer 名稱');
    if (layer.required !== undefined && typeof layer.required !== 'boolean') {
      problems.push(at + ' 的 required 必須是布林值');
    }
    if (!layer.query || typeof layer.query !== 'object' || !Object.keys(layer.query).length) {
      problems.push(at + ' 缺少查詢條件——沒有條件等於命中全部素材');
    } else {
      const allowed = ['kind', 'shape', 'element', 'usage', 'tag', 'package',
        'confidence', 'blend', 'tintable', 'tileable', 'aspect'];
      Object.keys(layer.query).forEach(function (k) {
        if (allowed.indexOf(k) < 0) problems.push(at + ' 未知查詢條件：' + k);
      });
      if (layer.query.shape && vocab.SHAPE.indexOf(layer.query.shape) < 0) {
        problems.push(at + ' shape 非法值：' + layer.query.shape);
      }
      if (layer.query.usage && vocab.USAGE.indexOf(layer.query.usage) < 0) {
        problems.push(at + ' usage 非法值：' + layer.query.usage);
      }
      if (layer.query.element && vocab.ELEMENT.indexOf(layer.query.element) < 0) {
        problems.push(at + ' element 非法值：' + layer.query.element);
      }
      if (layer.query.tag && vocab.TAG.indexOf(layer.query.tag) < 0) {
        problems.push(at + ' tag 非法值：' + layer.query.tag);
      }
    }
  });
  return problems;
}

function assessCoverage(index, semantics, spec) {
  const specProblems = validateCoverageSpec(spec);
  if (specProblems.length) {
    const err = new Error('coverage spec 不合法：' + specProblems.join('；'));
    err.problems = specProblems;
    throw err;
  }
  const layers = spec.layers.map(function (layer) {
    const hits = query(index, semantics, layer.query || {});
    const high = hits.filter(function (h) { return h.semantic.confidence === 'high'; });
    // 全部候選都待人工確認時，不能當成已完成的圖層
    const unreviewed = hits.length > 0 && hits.every(function (h) { return h.semantic.needsReview; });
    return {
      layer: layer.layer,
      required: layer.required !== false,
      query: layer.query,
      total: hits.length,
      highConfidence: high.length,
      allNeedReview: unreviewed,
      top: hits.slice(0, 3).map(function (h) { return h.assetId; }),
      qualityConcern: layer.qualityConcern || null
    };
  });

  const missingRequired = layers.filter(function (l) { return l.required && l.total === 0; });
  const limited = layers.filter(function (l) {
    return l.total > 0 && (l.qualityConcern || l.highConfidence === 0 || l.allNeedReview);
  });
  const missingOptional = layers.filter(function (l) { return !l.required && l.total === 0; });

  let verdict;
  if (missingRequired.length) verdict = 'INSUFFICIENT';
  else if (limited.length || missingOptional.length) verdict = 'SUFFICIENT_WITH_LIMITATIONS';
  else verdict = 'SUFFICIENT';

  return {
    name: spec.name,
    verdict: verdict,
    layers: layers,
    missingRequired: missingRequired,
    missingOptional: missingOptional,
    limited: limited
  };
}

/* ---------------- CLI ---------------- */

function parseArgs(argv) {
  const filters = {};
  let limit = 12;
  let validateOnly = false;
  let coverageSpec = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--validate') validateOnly = true;
    else if (a === '--tintable') filters.tintable = true;
    else if (a === '--tileable') filters.tileable = true;
    else if (a === '--high') filters.confidence = 'high';
    else if (a === '--usage') filters.usage = argv[++i];
    else if (a === '--shape') filters.shape = argv[++i];
    else if (a === '--element') filters.element = argv[++i];
    else if (a === '--tag') filters.tag = argv[++i];
    else if (a === '--kind') filters.kind = argv[++i];
    else if (a === '--blend') filters.blend = argv[++i];
    else if (a === '--aspect') filters.aspect = argv[++i];
    else if (a === '--package') filters.package = argv[++i];
    else if (a === '--limit') limit = Number(argv[++i]);
    else if (a === '--coverage') coverageSpec = argv[++i];
    else throw new Error('未知參數：' + a);
  }
  return { filters: filters, limit: limit, validateOnly: validateOnly, coverageSpec: coverageSpec };
}

function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (e) { console.error('[ERROR] ' + e.message); process.exit(EXIT.PRECONDITION); }

  const index = load('vfx/asset-index.json');
  const semantics = load('vfx/asset-semantics.json');

  if (args.validateOnly) {
    const problems = validate(index, semantics);
    if (problems.length) {
      console.error('[FAIL] 語意層驗證發現 ' + problems.length + ' 個問題：');
      problems.slice(0, 30).forEach(function (p) { console.error('  - ' + p); });
      process.exit(EXIT.FAILED);
    }
    console.log('[OK] 語意層驗證通過：' + semantics.records.length + ' 筆紀錄');
    console.log('  · assetId 全部存在於事實層且無重複');
    console.log('  · 受控詞彙表無非法值');
    console.log('  · 無絕對路徑、無時間戳');
    console.log('  · 無「灰階可染色素材被標成具體元素」的情況');
    process.exit(EXIT.OK);
  }

  if (args.coverageSpec) {
    const specPath = path.resolve(args.coverageSpec);
    if (!fs.existsSync(specPath)) {
      console.error('[ERROR] 找不到 coverage spec：' + specPath);
      process.exit(EXIT.PRECONDITION);
    }
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    let result;
    try {
      result = assessCoverage(index, semantics, spec);
    } catch (e) {
      console.error('[ERROR] ' + e.message);
      process.exit(EXIT.PRECONDITION);
    }
    console.log('素材充分性評估：' + result.name);
    console.log('='.repeat(58));
    result.layers.forEach(function (l) {
      const flag = l.total === 0 ? (l.required ? '✗ 缺（必要）' : '✗ 缺（選用）')
        : (l.qualityConcern || l.highConfidence === 0 || l.allNeedReview ? '△ 有但受限' : '✓ 足夠');
      console.log('  ' + flag.padEnd(14) + l.layer);
      console.log('      查詢 ' + JSON.stringify(l.query) +
        ' → ' + l.total + ' 筆（high ' + l.highConfidence + '）');
      if (l.top.length) console.log('      首選 ' + l.top[0].replace(/^kenney_/, ''));
      if (l.allNeedReview) console.log('      所有候選都待人工確認');
      if (l.qualityConcern) console.log('      品質疑慮：' + l.qualityConcern);
    });
    console.log('='.repeat(58));
    console.log('判定：' + result.verdict);
    process.exit(EXIT.OK);
  }

  const results = query(index, semantics, args.filters);
  console.log('查詢條件：' + JSON.stringify(args.filters));
  console.log('命中 ' + results.length + ' 筆，前 ' + Math.min(args.limit, results.length) + ' 筆：');
  results.slice(0, args.limit).forEach(function (r) {
    const s = r.semantic;
    const d = r.derived;
    console.log('  ' + r.assetId.replace(/^kenney_/, ''));
    console.log('      ' + s.shape + ' | ' + (s.usage || []).join(',') + ' | ' + s.element +
      ' | tags=' + (s.tags || []).join(',') +
      ' | ' + s.confidence + '(' + s.source + ')');
    console.log('      推導：blend=' + d.blendMode + ' tintable=' + d.tintable +
      ' aspect=' + d.aspect + ' tileable=' + d.tileable);
  });
  process.exit(EXIT.OK);
}

if (require.main === module) main();
else module.exports = { joinLayers: joinLayers, applyFilters: applyFilters, query: query, validate: validate, rank: rank, assessCoverage: assessCoverage, validateCoverageSpec: validateCoverageSpec };
