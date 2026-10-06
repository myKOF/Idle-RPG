#!/usr/bin/env node
'use strict';
/* 由資料表（js/runeword_data.js）產生 docs/RUNEWORD_DESIGN.md 的「符文之語總表」。
   說明文件與實際資料同源——改了資料表就重跑本檔，文件不會漂移：

     node tools/gen_runeword_doc.cjs            # 寫入 docs/RUNEWORD_DESIGN.md 的自動段落
     node tools/gen_runeword_doc.cjs --check    # 只檢查文件是否已是最新（不寫檔）

   文件裡「<!-- GENERATED:BEGIN -->」到「<!-- GENERATED:END -->」之間由本檔覆寫，其餘文字手寫。 */
const fs = require('node:fs');
const path = require('node:path');
const { loadRuneEnv } = require('../tests/helpers/runeword-env.cjs');

const root = path.resolve(__dirname, '..');
const docPath = path.join(root, 'docs', 'RUNEWORD_DESIGN.md');
const c = loadRuneEnv({ noState: true });

function budget(w) {
  return (w.stats || []).reduce((s, x) => s + x[1], 0);
}
function table(rows, header) {
  const out = ['| ' + header.join(' | ') + ' |', '| ' + header.map(() => '---').join(' | ') + ' |'];
  rows.forEach((r) => out.push('| ' + r.join(' | ') + ' |'));
  return out.join('\n');
}

function generate() {
  const L = [];
  L.push('### 符文（33 種）');
  L.push('');
  L.push(table(c.RUNES.map((r) => {
    const side = (spec) => `${c.AFFIX_POOL[spec[0]].name.replace(/%$/, '')} ×${spec[1]}`;
    const uses = c.RUNEWORDS.filter((w) => w.runes.includes(r.id)).length;
    return [r.tier, r.id, `${r.glyph} ${r.name}`, side(r.w), side(r.a), uses,
      r.tier < c.RUNE_COMPOSE_MAX_TIER ? '可合成' : '只能掉落'];
  }), ['階', 'id', '符文', '武器側屬性（詞條基準倍數）', '防具／飾品／副手側屬性', '用於幾組', '取得']));
  L.push('');
  const counts = [0, 0, 0, 0, 0];
  c.RUNEWORDS.forEach((w) => counts[w.tier]++);
  L.push(`### 符文之語（${c.RUNEWORDS.length} 組：` + [1, 2, 3, 4].map((t) => `${c.RUNEWORD_TIER_NAMES[t]} ${counts[t]}`).join('／') + '）');
  L.push('');
  L.push('「屬性預算」＝ 該組 stats 的 mult 總和（負值＝代價會扣掉）；用來快速比較同級距內誰的屬性包比較肥。機制（fx／觸發）不計入預算，要看右邊的效果欄。');
  for (let t = 1; t <= 4; t++) {
    L.push('');
    L.push(`#### 第 ${t} 級　${c.RUNEWORD_TIER_NAMES[t]}`);
    L.push('');
    const rows = c.RUNEWORDS.filter((w) => w.tier === t).map((w) => {
      const lines = c.rwDescribeLines(w).filter((l) => !/詞條的份量|^傳奇特效/.test(l) || /代價/.test(l));
      const stats = (w.stats || []).map((s) => {
        const d = c.AFFIX_POOL[s[0]];
        return `${d.name.replace(/%$/, '')}${s[1] < 0 ? '（代價）' : ''}×${Math.abs(s[1])}`;
      }).join('、');
      const legend = (w.legend || []).map((k) => `借用傳奇【${c.PASSIVE_POOL[k].name}】`);
      const mech = c.rwDescribeLines(w).slice((w.stats || []).length);
      return [
        `**${w.name}**`,
        w.runes.map(c.runeName).join(' → '),
        c.rwBasesText(w),
        c.rwSocketNeedText(w).replace(/^需要 /, '') + '；最高階 ' + Math.max(...w.runes.map((id) => c.RUNE_BY_ID[id].tier)),
        `${stats}（預算 ${budget(w).toFixed(1)}）`,
        (mech.length ? mech.map((m) => m.replace(/\|/g, '/')).join('；') : '（純屬性）') + (legend.length && !mech.some((m) => /傳奇特效/.test(m)) ? '；' + legend.join('、') : '')
      ];
    });
    L.push(table(rows, ['名稱', '配方（依序）', '適用裝備', '符文孔／最高階', '屬性', '機制']));
  }
  return L.join('\n');
}

const BEGIN = '<!-- GENERATED:BEGIN -->';
const END = '<!-- GENERATED:END -->';
const generated = BEGIN + '\n' + generate() + '\n' + END;

if (!fs.existsSync(docPath)) {
  console.error('找不到 ' + docPath + '（先建立文件骨架，含 ' + BEGIN + ' 與 ' + END + '）');
  process.exit(1);
}
const cur = fs.readFileSync(docPath, 'utf8');
const i = cur.indexOf(BEGIN), j = cur.indexOf(END);
if (i < 0 || j < i) { console.error('文件缺少自動段落標記'); process.exit(1); }
const next = cur.slice(0, i) + generated + cur.slice(j + END.length);
if (process.argv.includes('--check')) {
  if (next !== cur) { console.error('docs/RUNEWORD_DESIGN.md 的總表已過期，請執行 node tools/gen_runeword_doc.cjs'); process.exit(1); }
  console.log('docs/RUNEWORD_DESIGN.md 總表是最新的');
} else {
  fs.writeFileSync(docPath, next);
  console.log('已更新 docs/RUNEWORD_DESIGN.md（' + c.RUNEWORDS.length + ' 組）');
}
