#!/usr/bin/env node
'use strict';
/* 由資料表（js/runeword_data.js）與引擎產生 docs/RUNEWORD_TEST_MATRIX.md——給驗證者（Antigravity）逐項勾選用的測試對照表：
   符文孔數表、33 顆符文的預期單顆數值、65 組符文真言的配方／孔數／適用裝備／預期效果、各機制（fx／被動／觸發／傳奇特效）的覆蓋對照。
   預期數值直接由遊戲引擎算（與畫面同一份公式），改了資料表重跑本檔就不會漂移：

     node tools/gen_runeword_test_matrix.cjs            # 寫入文件
     node tools/gen_runeword_test_matrix.cjs --check    # 只檢查文件是否已是最新（不寫檔）

   參考裝備：Lv100、傳說（稀有度 5）、強化 +0；單手＝sword1h、雙手＝axe2h、防具＝chest。 */
const fs = require('node:fs');
const path = require('node:path');
const { loadRuneEnv, makeItem, fillRunes, wordItem } = require('../tests/helpers/runeword-env.cjs');

const root = path.resolve(__dirname, '..');
const docPath = path.join(root, 'docs', 'RUNEWORD_TEST_MATRIX.md');
const c = loadRuneEnv({ noState: true });

const esc = (s) => String(s).replace(/\|/g, '／').replace(/\n/g, ' ');
const affixName = (k) => { const d = c.AFFIX_POOL[k]; return d ? d.name.replace(/%$/, '') : k; };
const mk = (over) => makeItem(c, Object.assign({ rarity: 5, level: 100 }, over));
const one = mk({ weaponType: 'sword1h' });
const two = mk({ weaponType: 'axe2h' });
const chest = mk({ slot: 'chest', weaponType: undefined });
const ring = mk({ slot: 'ring', weaponType: undefined });
const num = (v) => (c.AFFIX_POOL ? String(v) : String(v));

function table(header, rows) {
  const out = ['| ' + header.join(' | ') + ' |', '| ' + header.map(() => '---').join(' | ') + ' |'];
  rows.forEach((r) => out.push('| ' + r.map(esc).join(' | ') + ' |'));
  return out.join('\n');
}
const rarityName = (i) => (i < 0 ? '—' : c.RARITIES[i].name);
/* 剛好放得下 n 顆符文的最低稀有度（沒有就回 -1）。 */
function minRarityFor(n, twoHand) {
  for (let i = 0; i < c.RARITIES.length; i++) if (c.rwSlotCountAt(i, twoHand) >= n) return i;
  return -1;
}
const runeName = (id) => c.RUNE_BY_ID[id].name;

function generate() {
  const L = [];
  const S = c.RUNE_SETTINGS;
  L.push('# 符文系統測試對照表（自動產生）');
  L.push('');
  L.push('> 由 `node tools/gen_runeword_test_matrix.cjs` 依 `js/runeword_data.js` 與引擎產生，**請勿手改**。預期數值是遊戲引擎對「參考裝備」算出的值，與畫面同一份公式。');
  L.push('> 參考裝備：Lv100、傳說（稀有度 5）、強化 +0。單手＝劍（sword1h）、雙手＝斧（axe2h）、防具＝胸甲（chest）、飾品＝戒指（ring）。實際測試其他等級、稀有度時，請改用「詞條提示下限 × 倍率」自行換算（符文倍率 ×1 ＝ 裝備詳情「可能出現的詞條」的下限）。');
  L.push('');

  /* ---- 孔數 ---- */
  L.push('## 1. 符文孔數');
  L.push('');
  L.push('設定：`maxSlots = ' + S.maxSlots + '`、`twoHandBonusSlots = ' + S.twoHandBonusSlots + '`（雙手武器在「本來就有孔」的稀有度上再加這麼多孔）。孔數由稀有度決定（`RUNE_SETTINGS.slotsByRarity`，表來源 `game_parameters.xlsx` 的「表-稀有度」）。');
  L.push('');
  L.push(table(['稀有度（索引）', '一般裝備孔數', '雙手武器孔數'], c.RARITIES.map((r, i) => [r.name + '（' + i + '）', c.rwSlotCountAt(i, false), c.rwSlotCountAt(i, true)])));
  L.push('');

  /* ---- 符文 ---- */
  L.push('## 2. 符文（33 顆）預期單顆數值');
  L.push('');
  L.push('符文系統 V2 的三個部位：**武器**（主手、副手、雙手；讀 `w`）、**防具**（頭肩胸腰手腕腿靴八件；讀 `a`）、**飾品**（戒指、項鍊；讀 `j`）。副手（盾、法器、魔法書、水晶球）算武器部位。雙手武器的單顆符文數值是單手的 2 倍（`TWO_HAND_AFFIX_VALUE_MULT`），防具與飾品沒有這個倍數。');
  L.push('');
  const runeRows = c.RUNES.map((r, i) => [
    i + 1, r.id, r.name,
    affixName(r.w[0]) + ' ×' + r.w[1], c.rwRuneStatValue(one, r.w[0], r.w[1]), c.rwRuneStatValue(two, r.w[0], r.w[1]),
    affixName(r.a[0]) + ' ×' + r.a[1], c.rwRuneStatValue(chest, r.a[0], r.a[1]),
    affixName(r.j[0]) + ' ×' + r.j[1], c.rwRuneStatValue(ring, r.j[0], r.j[1]),
    r.flavor || ''
  ]);
  L.push(table(['階', 'id', '名稱', '武器側', '單手劍預期', '雙手斧預期', '防具側', '胸甲預期', '飾品側', '戒指預期', '形容文字'], runeRows));
  L.push('');
  L.push('合成：' + S.composeCount + ' 顆同階 → 1 顆高一階（最高合成到第 ' + S.composeMaxTier + ' 階）；拆解：1 顆 → ' + S.dismantleYield + ' 顆低一階（第 1 階不可拆解）。');
  L.push('');

  /* ---- 符文真言 ---- */
  L.push('## 3. 符文真言（' + c.RUNEWORDS.length + ' 組）');
  L.push('');
  L.push('「效果（預期）」的屬性行已用參考裝備算好實際數值；機制行（被動、事件觸發、傳奇特效…）是遊戲內顯示的文字。真言屬性**不乘雙手倍率**，所以雙手武器上的屬性行數字與單手相同。');
  L.push('「最低品質」＝剛好放得下這組配方的最低裝備稀有度；「—」＝該類裝備做不出這組（例如 5 顆真言只給雙手武器，防具類真言沒有雙手武器版）。孔數隨「表-稀有度」的設定改變，這張表會跟著重產。');
  L.push('');
  const tierName = c.RUNEWORD_TIER_NAMES;
  [1, 2, 3, 4].forEach((tier) => {
    const words = c.RUNEWORDS.filter((w) => w.tier === tier);
    L.push('### 第 ' + tier + ' 級　' + tierName[tier] + '（' + words.length + ' 組）');
    L.push('');
    const rows = words.map((w) => {
      const ref = wordItem(c, w.id);
      const lines = c.rwDescribeLines(w, ref);
      const refText = (ref.slot === 'weapon' ? ref.weaponType : ref.slot);
      const n = w.runes.length;
      const canOne = !c.rwWordTwoHandOnly(w);
      const canTwo = c.rwItemMatches(mk({ weaponType: 'axe2h' }), w.bases);
      return [
        w.id, w.name, w.runes.map(runeName).join('→'), w.runes.length,
        c.rwBasesText(w), refText,
        canOne ? rarityName(minRarityFor(n, false)) : '—',
        canTwo ? rarityName(minRarityFor(n, true)) : '—',
        lines.join('<br>')
      ];
    });
    L.push(table(['id', '名稱', '配方（依序）', '孔數', '適用裝備', '參考裝備', '最低品質（一般裝備）', '最低品質（雙手武器）', '效果（預期）'], rows).replace(/／<br>／/g, '<br>'));
    L.push('');
  });

  /* ---- 機制覆蓋 ---- */
  L.push('## 4. 機制覆蓋對照（每個機制至少挑一組真言實測）');
  L.push('');
  const uses = (pick) => {
    const m = {};
    c.RUNEWORDS.forEach((w) => pick(w).forEach((k) => { (m[k] = m[k] || []).push(w.name); }));
    return m;
  };
  const sect = (title, m, label) => {
    L.push('### ' + title);
    L.push('');
    L.push(table([label, '用到它的真言'], Object.keys(m).sort().map((k) => [k, m[k].join('、')])));
    L.push('');
  };
  sect('4.1 靜態效果 fx', uses((w) => Object.keys(w.fx || {})), 'fx 鍵');
  sect('4.2 被動 passives', uses((w) => Object.keys(w.passives || {})), '被動鍵');
  sect('4.3 事件觸發（on）', uses((w) => (w.procs || []).map((p) => p.on)), '觸發 on');
  sect('4.4 事件動作（act）', uses((w) => [].concat.apply([], (w.procs || []).map((p) => p.acts.map((a) => a.act)))), '動作 act');
  sect('4.5 借用的傳奇特效 legend', uses((w) => w.legend || []), '傳奇特效鍵');
  sect('4.6 屬性詞條（stats）', uses((w) => (w.stats || []).map((s) => s[0])), '詞條鍵');

  /* ---- 傳說級對照 ---- */
  L.push('## 5. 傳說級：23 個主技能各一組傳奇特效');
  L.push('');
  const rows5 = [];
  c.RUNEWORDS.filter((w) => w.tier === 4).forEach((w) => {
    (w.legend || []).forEach((k) => {
      const pd = c.PASSIVE_POOL[k];
      rows5.push([pd && pd.relatedSkill ? pd.relatedSkill : '?', w.name, pd ? pd.name : k, w.runes.length]);
    });
  });
  rows5.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  L.push(table(['主技能（relatedSkill）', '真言', '傳奇特效', '配方孔數'], rows5));
  L.push('');
  return L.join('\n');
}

const text = generate();
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(docPath) ? fs.readFileSync(docPath, 'utf8').replace(/\r\n/g, '\n') : '';
  if (cur !== text) { console.error('docs/RUNEWORD_TEST_MATRIX.md 不是最新，請執行 node tools/gen_runeword_test_matrix.cjs'); process.exit(1); }
  console.log('docs/RUNEWORD_TEST_MATRIX.md 已是最新');
} else {
  fs.writeFileSync(docPath, text);
  console.log('已更新 docs/RUNEWORD_TEST_MATRIX.md（' + c.RUNEWORDS.length + ' 組真言、' + c.RUNES.length + ' 顆符文）');
}
