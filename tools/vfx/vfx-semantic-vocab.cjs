'use strict';
/* ============================================================
   vfx-semantic-vocab.cjs — Semantic Layer 的受控詞彙表（VFX 專用）

   語意層是「AI 判斷」，不是客觀事實；事實層在 vfx/asset-index.json。
   兩層永久分離：Scanner 重跑不會覆蓋語意，語意也不得複製事實欄位
   （dimensions／hash／path／alpha 統計一律不進語意檔）。

   詞彙表刻意小而封閉：開放式標籤會產生 fiery／fire-like／hot-fire
   這類近義詞爆炸，讓搜尋失效。要新增字彙必須改這裡並提高 schemaVersion。
   ============================================================ */

/* 這是什麼東西。preview／nonVfx 讓搜尋能乾淨地排除套件宣傳圖與非特效素材。 */
const KIND = ['vfx', 'nonVfx', 'preview'];

/* 圖形長什麼樣。依實際素材庫決定，不預先塞用不到的字。 */
const SHAPE = [
  'disc',        // 實心圓、柔邊光點
  'ring',        // 環帶
  'cone',        // 錐狀／扇形投影
  'fan',         // 放射扇葉
  'star',        // 星芒、閃光十字
  'streak',      // 單向長條
  'arc',         // 弧形帶（含 C 形旋轉帶）
  'filament',    // 細絲、裂紋、電弧
  'cloud',       // 團塊、煙霧、湍流
  'splat',       // 潑濺
  'polygon',     // 幾何塊面
  'caustics',    // 水波焦散
  'silhouette',  // 實體剪影（植物等）
  'irregular'    // 以上皆非
];

/* 可以拿來當 VFX 的哪一層。泛用 VFX 語彙，不含任何遊戲概念。 */
const USAGE = [
  'core',        // 特效主體
  'particle',    // 通用粒子
  'spark',       // 火花、閃光點
  'ember',       // 餘燼、上升碎屑
  'smoke',       // 煙霧
  'glow',        // 輝光、光暈
  'ring',        // 環狀擴散、地面環
  'trail',       // 拖尾
  'beam',        // 光束
  'mask',        // 遮罩、形狀裁切
  'impact',      // 命中、爆閃
  'scorch',      // 地面殘留痕跡
  'distortion',  // 扭曲來源
  'noise'        // 噪聲來源
];

/* 元素。預設 neutral——灰階可染色素材一律 neutral，
   讓同一份素材能同時被火／冰／毒／暗系特效重用。
   只有圖片本身帶有不可忽略的元素色彩／外觀才標實際元素。 */
const ELEMENT = ['neutral', 'fire', 'ice', 'water', 'lightning', 'poison', 'nature', 'dark', 'light'];

/* 補充屬性。只收「shape／usage／element 表達不了、又真的會影響選材」的字。
   刻意不收 tintable／preColored／trimmedEdge／variantCarrier／tileable——
   那四項全部可由事實層推導（見下方 derive* 函式），存進語意層就是複製事實資料。 */
const TAG = [
  'soft',          // 邊緣柔和
  'sharp',         // 邊緣銳利
  'noisy',         // 帶雜訊破碎
  'smooth',        // 均勻無雜訊
  'wispy',         // 稀薄飄散
  'dense',         // 濃實
  'radial',        // 由中心向外
  'directional',   // 有明確方向性
  'swirl',         // 旋轉感
  'symmetric',     // 對稱
  'hollow',        // 中空
  'layered'        // 多層結構
];

const CONFIDENCE = ['high', 'medium'];   // low 一律不收錄，見 schema 文件

const VOCAB = {
  kind: KIND, shape: SHAPE, usage: USAGE, element: ELEMENT, tag: TAG, confidence: CONFIDENCE
};


/* blendModeHint 不存進語意檔——它可以由事實層的 backgroundVariant 推導，
   存下來就是複製事實資料。這裡提供唯一的推導規則，查詢端共用。 */
function blendModeFromFacts(facts) {
  if (!facts) return null;
  switch (facts.backgroundVariant) {
    case 'blackBackground': return 'additive';
    case 'transparent': return 'alphaBlend';
    case 'whiteBackground': return 'multiply';
    default: return null;                 // opaqueOther：無法可靠推導
  }
}

/* tintable 同樣由事實層推導：飽和度接近 0 ＝ 灰階，可安全染色。 */
function tintableFromFacts(facts) {
  if (!facts || !facts.saturation) return null;
  return facts.saturation.mean <= 0.05;
}

/* 可平鋪候選也由事實層推導，而且必須同時滿足兩個條件：
     1. 對邊吻合（edgeContinuity 高）
     2. 邊界本身非均勻（backgroundVariant === 'opaqueOther'）
   只看第 1 點會被騙：整圈黑邊的孤立素材對邊完全吻合會得到 1.0，
   但它是單一圖案，不是平鋪紋理。實測全庫符合第 1 點的有 320 筆，
   同時符合兩點的只有 35 筆（water_caustics 與 foliage_canopy 為主）。 */
function tileableCandidateFromFacts(facts) {
  if (!facts || !facts.edgeContinuity || !facts.trimmed) return false;
  if (facts.backgroundVariant !== 'opaqueOther') return false;
  return facts.edgeContinuity.u > 0.97 && facts.edgeContinuity.v > 0.97;
}

const SOURCE = ['evidence', 'group', 'family'];

/* 語意紀錄的封閉式 schema：只允許這些欄位。
   用 allowlist 而不是 denylist——denylist 擋不掉沒想到的欄位，
   也擋不掉「nonVfx 紀錄夾帶非法 shape」這種漏網情況。 */
const ALLOWED_FIELDS = {
  common: ['assetId', 'kind', 'confidence', 'source', 'ruleId', 'needsReview'],
  vfxOnly: ['shape', 'usage', 'element', 'tags']
};

function validateRecord(record) {
  const errors = [];
  const check = function (field, value, list) {
    if (list.indexOf(value) < 0) errors.push(field + ' 非法值：' + JSON.stringify(value));
  };
  if (!record || typeof record !== 'object') return ['紀錄不是物件'];
  if (!record.assetId || typeof record.assetId !== 'string') errors.push('缺少 assetId');
  check('kind', record.kind, KIND);
  check('confidence', record.confidence, CONFIDENCE);
  check('source', record.source, SOURCE);
  if (typeof record.ruleId !== 'string' || !record.ruleId) errors.push('缺少 ruleId');
  if (record.needsReview !== undefined && record.needsReview !== true) {
    errors.push('needsReview 只能是 true 或不存在');
  }
  // 未經像素確認的傳播不得宣稱高信心
  if (record.source === 'family' && record.confidence !== 'medium') {
    errors.push('source=family 的信心必須是 medium');
  }
  if ((record.source === 'evidence' || record.source === 'group') && record.confidence !== 'high') {
    errors.push('source=' + record.source + ' 的信心必須是 high');
  }

  if (record.kind === 'vfx') {
    check('shape', record.shape, SHAPE);
    check('element', record.element, ELEMENT);
    if (!Array.isArray(record.usage) || !record.usage.length) errors.push('vfx 素材必須有至少一個 usage');
    else record.usage.forEach(function (u) { check('usage', u, USAGE); });
    if (record.tags !== undefined) {
      if (!Array.isArray(record.tags)) errors.push('tags 必須是陣列');
      else record.tags.forEach(function (t) { check('tag', t, TAG); });
    }
  } else {
    // 非 VFX 素材不該帶 VFX 語意欄位，否則會被搜尋條件誤中
    ALLOWED_FIELDS.vfxOnly.forEach(function (field) {
      if (record[field] !== undefined) {
        errors.push('kind=' + record.kind + ' 不得帶 ' + field);
      }
    });
  }

  // 封閉式欄位檢查：任何未列出的欄位都是錯誤（含被複製過來的事實層欄位）
  const allowed = ALLOWED_FIELDS.common.concat(record.kind === 'vfx' ? ALLOWED_FIELDS.vfxOnly : []);
  Object.keys(record).forEach(function (key) {
    if (allowed.indexOf(key) < 0) errors.push('不允許的欄位：' + key);
  });
  return errors;
}

/* 需要事實層才能驗證的不變量。build 與 query 共用同一份，
   避免「只有查詢端會擋、建置端照樣寫出非法資料」。 */
function validateAgainstFacts(record, facts) {
  const errors = [];
  if (!facts) return errors;
  if (record.kind === 'vfx' && record.element !== 'neutral' && tintableFromFacts(facts) === true) {
    errors.push('灰階可染色素材被標成 element=' + record.element + '（應為 neutral 以便跨元素重用）');
  }
  return errors;
}

module.exports = {
  VOCAB: VOCAB,
  KIND: KIND, SHAPE: SHAPE, USAGE: USAGE, ELEMENT: ELEMENT, TAG: TAG,
  CONFIDENCE: CONFIDENCE, SOURCE: SOURCE,
  blendModeFromFacts: blendModeFromFacts,
  tintableFromFacts: tintableFromFacts,
  tileableCandidateFromFacts: tileableCandidateFromFacts,
  validateRecord: validateRecord,
  validateAgainstFacts: validateAgainstFacts
};
