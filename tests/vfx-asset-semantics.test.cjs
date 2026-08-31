'use strict';
/* VFX Asset Semantic Layer v1 — 語意層與事實層的分離、受控詞彙、傳播規則與查詢
   使用專案實際產出的 vfx/asset-index.json 與 vfx/asset-semantics.json；
   兩者缺一時跳過（例如尚未產生索引的環境），不讓測試假性失敗。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const vocab = require('../tools/vfx/vfx-semantic-vocab.cjs');
const queryTool = require('../tools/vfx/semantic-query.cjs');
const builder = require('../tools/vfx/semantic-build.cjs');
const grouping = require('../tools/vfx/semantic-grouping.cjs');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'vfx', 'asset-index.json');
const semanticsPath = path.join(root, 'vfx', 'asset-semantics.json');
const groupsPath = path.join(root, 'vfx', 'asset-groups.json');
const rulesPath = path.join(root, 'vfx', 'semantic-rules.json');
const ready = fs.existsSync(indexPath) && fs.existsSync(semanticsPath);

const index = ready ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : null;
const semantics = ready ? JSON.parse(fs.readFileSync(semanticsPath, 'utf8')) : null;

test('每筆語意紀錄的 assetId 都存在於事實層，且不重複', { skip: !ready }, function () {
  const factIds = new Set(index.assets.map(function (a) { return a.assetId; }));
  const seen = new Set();
  for (const record of semantics.records) {
    assert.ok(factIds.has(record.assetId), '語意層出現事實層沒有的 assetId：' + record.assetId);
    assert.equal(seen.has(record.assetId), false, '重複 assetId：' + record.assetId);
    seen.add(record.assetId);
  }
});

test('語意層不含絕對路徑、不含時間戳', { skip: !ready }, function () {
  const text = fs.readFileSync(semanticsPath, 'utf8');
  assert.equal(/[A-Za-z]:[\\/]/.test(text), false, '不得含磁碟機代號');
  assert.equal(text.indexOf('\\\\') >= 0, false, '不得含反斜線路徑');
  assert.equal(/"(generatedAt|timestamp)"\s*:/.test(text), false,
    '不得含時間戳，否則每次重建都產生無意義 diff');
});

test('語意層不複製事實層欄位', { skip: !ready }, function () {
  const forbidden = ['dimensions', 'contentHash', 'relativePath', 'fileSize',
    'alpha', 'luminance', 'saturation', 'facts', 'format', 'blendModeHint', 'tintable'];
  for (const record of semantics.records) {
    for (const field of forbidden) {
      assert.equal(record[field], undefined,
        record.assetId + ' 不該有事實層欄位 ' + field);
    }
  }
});

test('受控詞彙表無非法值', { skip: !ready }, function () {
  for (const record of semantics.records) {
    const errors = vocab.validateRecord(record);
    assert.deepEqual(errors, [], record.assetId + '：' + errors.join('；'));
  }
});

test('灰階可染色素材不得因檔名被標成具體元素', { skip: !ready }, function () {
  const factsById = new Map(index.assets.map(function (a) { return [a.assetId, a]; }));
  const offenders = [];
  for (const record of semantics.records) {
    if (record.kind !== 'vfx' || record.element === 'neutral') continue;
    const asset = factsById.get(record.assetId);
    if (asset && vocab.tintableFromFacts(asset.facts) === true) offenders.push(record.assetId);
  }
  assert.deepEqual(offenders, [], '灰階素材必須維持 neutral 才能跨元素重用');

  // 具體回歸：檔名含 fire/flame 的素材必須是 neutral
  const fireNamed = semantics.records.filter(function (r) {
    return /\/(fire|flame)_\d+/.test(r.assetId);
  });
  assert.ok(fireNamed.length > 0, '應該找得到 fire/flame 命名的素材');
  fireNamed.forEach(function (r) {
    assert.equal(r.element, 'neutral', r.assetId + ' 是灰階遮罩，不該被檔名帶成 fire');
  });
});

test('預先上色的素材才允許帶具體元素，且標記需人工確認', { skip: !ready }, function () {
  const colored = semantics.records.filter(function (r) {
    return r.kind === 'vfx' && r.element !== 'neutral';
  });
  assert.ok(colored.length > 0);
  const factsById = new Map(index.assets.map(function (a) { return [a.assetId, a]; }));
  colored.forEach(function (r) {
    const asset = factsById.get(r.assetId);
    assert.equal(vocab.tintableFromFacts(asset.facts), false,
      r.assetId + ' 應為預先上色才可標具體元素');
    assert.equal(r.needsReview, true, r.assetId + ' 預上色素材的 element 需人工確認');
  });
});

test('語意傳播不跨錯誤群組：group 來源必須與 evidence 同組', { skip: !ready || !fs.existsSync(groupsPath) }, function () {
  const groups = JSON.parse(fs.readFileSync(groupsPath, 'utf8'));
  const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  const groupOf = new Map();
  groups.groups.forEach(function (g) {
    g.members.forEach(function (m) { groupOf.set(m, g.groupId); });
  });
  const evidenceByRule = new Map(rules.rules.map(function (r) { return [r.ruleId, r.evidence || []]; }));

  for (const record of semantics.records) {
    if (record.source !== 'group') continue;
    const evidence = evidenceByRule.get(record.ruleId) || [];
    const sameGroup = evidence.some(function (id) {
      return groupOf.get(id) && groupOf.get(id) === groupOf.get(record.assetId);
    });
    assert.ok(sameGroup, record.assetId + ' 標為 group 來源，卻與該規則的 evidence 不同組');
  }
});

test('候選分組必須有像素證據：同組成員的簽章距離在門檻內', { skip: !fs.existsSync(groupsPath) }, function () {
  const groups = JSON.parse(fs.readFileSync(groupsPath, 'utf8'));
  for (const group of groups.groups) {
    assert.ok(group.maxDistance <= grouping.SAME_SHAPE_THRESHOLD,
      group.groupId + ' 的成員簽章距離 ' + group.maxDistance + ' 超過門檻');
  }
  // 已知同一圖形的三個載體必須被合併
  const ringGroup = groups.groups.find(function (g) {
    return g.groupId === 'kenney_light-masks-1.0/default/ring_a.png';
  });
  if (ringGroup) {
    assert.equal(ringGroup.members.length, 3, 'ring_a 的 Default/Inverted/Transparent 應合併為同一組');
  }
});

test('confidence 只有 high/medium，且 family 傳播一定是 medium', { skip: !ready }, function () {
  for (const record of semantics.records) {
    assert.ok(['high', 'medium'].indexOf(record.confidence) >= 0);
    if (record.source === 'family') {
      assert.equal(record.confidence, 'medium', '未經像素確認的傳播不得標成 high');
    } else {
      assert.equal(record.confidence, 'high');
    }
  }
});

test('事實衍生欄位由事實推導，且推導規則正確', function () {
  assert.equal(vocab.blendModeFromFacts({ backgroundVariant: 'blackBackground' }), 'additive');
  assert.equal(vocab.blendModeFromFacts({ backgroundVariant: 'transparent' }), 'alphaBlend');
  assert.equal(vocab.blendModeFromFacts({ backgroundVariant: 'whiteBackground' }), 'multiply');
  assert.equal(vocab.blendModeFromFacts({ backgroundVariant: 'opaqueOther' }), null);
  assert.equal(vocab.tintableFromFacts({ saturation: { mean: 0.01 } }), true);
  assert.equal(vocab.tintableFromFacts({ saturation: { mean: 0.6 } }), false);

  // 可平鋪必須同時要求「對邊吻合」與「邊界非均勻」
  assert.equal(vocab.tileableCandidateFromFacts({
    trimmed: true, backgroundVariant: 'blackBackground', edgeContinuity: { u: 1, v: 1 }
  }), false, '整圈黑邊的孤立素材對邊必然吻合，不能因此判為可平鋪');
  assert.equal(vocab.tileableCandidateFromFacts({
    trimmed: true, backgroundVariant: 'opaqueOther', edgeContinuity: { u: 0.99, v: 0.99 }
  }), true);
});

test('Fire Tornado 查詢能得到合理候選，且不會選到誤導性素材', { skip: !ready }, function () {
  const sparkStars = queryTool.query(index, semantics,
    { usage: 'spark', shape: 'star', blend: 'additive' });
  assert.ok(sparkStars.length > 0, '應找得到星芒型火花');
  // spark_* 實際是電弧細絲，不該出現在 shape=star 的結果裡
  sparkStars.forEach(function (r) {
    assert.equal(/\/spark_\d+/.test(r.assetId), false,
      'spark_* 是 filament，不該被當成星芒火花：' + r.assetId);
  });

  const core = queryTool.query(index, semantics,
    { usage: 'core', shape: 'cloud', element: 'neutral', tintable: true, blend: 'additive' });
  assert.ok(core.length > 0, '應找得到可染色的火焰主體');
  core.forEach(function (r) {
    assert.equal(r.derived.blendMode, 'additive', '查加法混合不該拿到透明載體');
  });

  const ring = queryTool.query(index, semantics, { usage: 'ring', shape: 'ring', blend: 'additive' });
  assert.ok(ring.length > 0, '應找得到地面環');

  // 同一批主體素材必須也能被冰系取用（neutral 的重用性保證）
  const iceReuse = queryTool.query(index, semantics,
    { usage: 'core', shape: 'cloud', element: 'neutral', tintable: true, blend: 'additive' });
  assert.deepEqual(iceReuse.map(function (r) { return r.assetId; }),
    core.map(function (r) { return r.assetId; }),
    '中性素材必須能同時服務不同元素的特效');
});

test('素材充分性評估會指出缺口而不是硬給 SUFFICIENT', { skip: !ready }, function () {
  const specPath = path.join(root, 'vfx', 'coverage-specs', 'fire-tornado.json');
  if (!fs.existsSync(specPath)) return;
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const result = queryTool.assessCoverage(index, semantics, spec);
  assert.ok(['SUFFICIENT', 'SUFFICIENT_WITH_LIMITATIONS', 'INSUFFICIENT']
    .indexOf(result.verdict) >= 0);
  // 有品質疑慮的圖層必須被列進 limited，不能被吞掉
  const concerned = result.layers.filter(function (l) { return l.qualityConcern && l.total > 0; });
  concerned.forEach(function (l) {
    assert.ok(result.limited.indexOf(l) >= 0, l.layer + ' 有品質疑慮卻沒被列為受限');
  });
  if (concerned.length) {
    assert.notEqual(result.verdict, 'SUFFICIENT', '存在品質疑慮時不得判為 SUFFICIENT');
  }
});

test('語意建置具決定性：同樣輸入產生位元相同的輸出', { skip: !ready || !fs.existsSync(groupsPath) }, function () {
  const groups = JSON.parse(fs.readFileSync(groupsPath, 'utf8'));
  const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  const a = builder.serialise(index, builder.build(index, groups, rules));
  const b = builder.serialise(index, builder.build(index, groups, rules));
  assert.equal(a, b);
  assert.equal(a, fs.readFileSync(semanticsPath, 'utf8'),
    '磁碟上的語意檔應與重新建置的結果一致（未被手改）');
});

test('語意建置不修改事實層', { skip: !ready || !fs.existsSync(groupsPath) }, function () {
  const before = fs.readFileSync(indexPath, 'utf8');
  const groups = JSON.parse(fs.readFileSync(groupsPath, 'utf8'));
  const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  builder.build(JSON.parse(before), groups, rules);
  assert.equal(fs.readFileSync(indexPath, 'utf8'), before, '事實層必須原封不動');
});

/* ---- 驗證器的負向測試（Codex Review 指出的漏洞，修正後回歸保護）---- */

test('封閉式 schema：非 VFX 紀錄不得夾帶 VFX 語意欄位', function () {
  const errors = vocab.validateRecord({
    assetId: 'x/y.png', kind: 'preview', confidence: 'medium', source: 'family',
    ruleId: 'r', shape: 'disc', usage: ['core'], element: 'fire'
  });
  assert.ok(errors.some(function (e) { return /不得帶 shape/.test(e); }), errors.join('；'));
  assert.ok(errors.some(function (e) { return /不得帶 usage/.test(e); }));
  assert.ok(errors.some(function (e) { return /不得帶 element/.test(e); }));
});

test('封閉式 schema：未知欄位與非法 source 都要被擋', function () {
  const errors = vocab.validateRecord({
    assetId: 'x/y.png', kind: 'vfx', confidence: 'high', source: 'unknown',
    ruleId: 'r', shape: 'disc', usage: ['core'], element: 'neutral', hotness: 9
  });
  assert.ok(errors.some(function (e) { return /source 非法值/.test(e); }), errors.join('；'));
  assert.ok(errors.some(function (e) { return /不允許的欄位：hotness/.test(e); }));
});

test('source 與 confidence 必須對應：family 不得宣稱 high', function () {
  const bad = vocab.validateRecord({
    assetId: 'x/y.png', kind: 'vfx', confidence: 'high', source: 'family',
    ruleId: 'r', shape: 'disc', usage: ['core'], element: 'neutral'
  });
  assert.ok(bad.some(function (e) { return /family 的信心必須是 medium/.test(e); }), bad.join('；'));
  const good = vocab.validateRecord({
    assetId: 'x/y.png', kind: 'vfx', confidence: 'medium', source: 'family',
    ruleId: 'r', shape: 'disc', usage: ['core'], element: 'neutral'
  });
  assert.deepEqual(good, []);
});

test('事實不變量由共用函式驗證：灰階素材標具體元素會被擋', function () {
  const record = { assetId: 'x/y.png', kind: 'vfx', element: 'fire' };
  assert.equal(vocab.validateAgainstFacts(record, { saturation: { mean: 0.01 } }).length, 1);
  assert.equal(vocab.validateAgainstFacts(record, { saturation: { mean: 0.7 } }).length, 0);
});

test('group manifest 被竄改時 build 會回報問題', { skip: !ready }, function () {
  const assetsById = new Map(index.assets.map(function (a) { return [a.assetId, a]; }));
  const tampered = {
    threshold: 0.06,
    groups: [{ groupId: 'g1', members: [index.assets[0].assetId, 'does-not-exist.png'], maxDistance: 0 }]
  };
  const problems = builder.validateGroups(tampered, assetsById);
  assert.ok(problems.some(function (p) { return /不存在於事實層/.test(p); }), problems.join('；'));

  const tooFar = {
    threshold: 0.06,
    groups: [{ groupId: 'g1', members: [index.assets[0].assetId], maxDistance: 0.9 }]
  };
  assert.ok(builder.validateGroups(tooFar, assetsById).some(function (p) {
    return /maxDistance/.test(p);
  }), '距離超過門檻的群組必須被擋');

  const duplicated = {
    threshold: 0.06,
    groups: [
      { groupId: 'g1', members: [index.assets[0].assetId], maxDistance: 0 },
      { groupId: 'g2', members: [index.assets[0].assetId], maxDistance: 0 }
    ]
  };
  assert.ok(builder.validateGroups(duplicated, assetsById).some(function (p) {
    return /同時屬於多個群組/.test(p);
  }));
});

test('coverage spec 驗證：空 layers 不得產生 SUFFICIENT', { skip: !ready }, function () {
  assert.throws(function () {
    queryTool.assessCoverage(index, semantics, { name: 'empty', layers: [] });
  }, /不得為空/);

  assert.throws(function () {
    queryTool.assessCoverage(index, semantics, {
      name: 'bad', layers: [{ layer: 'x', query: { usage: 'not-a-usage' } }]
    });
  }, /usage 非法值/);

  assert.throws(function () {
    queryTool.assessCoverage(index, semantics, { name: 'noQuery', layers: [{ layer: 'x', query: {} }] });
  }, /缺少查詢條件/);
});

test('候選分組的 maxDistance 是真正的成對最大距離', function () {
  const sigs = new Map([
    ['a', [0, 0, 0, 0]],
    ['b', [0.05, 0.05, 0.05, 0.05]],
    ['c', [0.1, 0.1, 0.1, 0.1]]
  ]);
  const members = [{ assetId: 'a' }, { assetId: 'b' }, { assetId: 'c' }];
  // a↔c 距離 0.1，比 a↔b 的 0.05 大；必須回報 0.1 而不是與 seed 的距離
  assert.equal(grouping.maxPairwiseDistance(members, sigs), 0.1);
});
