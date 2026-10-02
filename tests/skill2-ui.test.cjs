'use strict';

/* 技能頁（2026-10 改版）：左清單＋右「進化之路」的技能瀏覽器，取代逐列方格與群組升級彈窗。
   守住：
     1. 未解鎖的階只能查看、不產生升級鈕；滿級只剩降級／重置；第 1 階不能降到 0
     2. 超神進化：未開放→顯示還差幾階；未選→三選一按鈕；已選→升級走 SG_ULT_SLOT
     3. 主動型被動仍有裝備鈕與類型標籤（需裝配才生效）
     4. 清單與詳情分開快取（金幣變動只重繪詳情，清單捲動位置不跳）
     5. 技能列移到分頁底部；舊方格列與彈窗的程式與樣式已移除
   沿用既有的 data-skill2-*／data-skill-equip 屬性，指令與確認流程由事件委派處理，這裡不重測。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
const theme = fs.readFileSync(path.join(root, 'css', 'ashen-forge.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function loadContext() {
  const context = {
    console,
    Math: Object.create(Math),
    setTimeout() {}, clearTimeout() {},
    document: { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } },
    UI: { dirty: {} },
    blog() {}, floatText() {}, trackDps() {}, recordRunDamage() {}
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/combat.js', 'js/skills.js', 'js/skills2.js', 'js/ui.js']
    .forEach((file) => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file }));
  context.pendingUiButtonAttributes = () => '';
  context.nodePendingKey = () => '';
  return context;
}

function snapshot(levels, extra) {
  return Object.assign({ skills2: { levels, progress: { level: 576, reinc: 0 } }, loadout: [] }, extra || {});
}

function detail(c, gid, snap, tier, gold) {
  c.UI.sgBrowse.tier = tier;
  c.UI.sgBrowse.ultFocus = null;
  return c.sgbDetailHTML(gid, snap, { player: { gold: gold === undefined ? 1e15 : gold } });
}

test('未解鎖的階只能查看，不產生升級鈕', () => {
  const c = loadContext();
  // 寒冰箭第 4 階要 Lv.600，角色 Lv.576 → 鎖住
  const snap = snapshot({ icearrow: [10, 10, 10, 0, 0, 0, 0] });
  const h = detail(c, 'icearrow', snap, 3);
  assert.doesNotMatch(h, /data-skill2-learn="icearrow:3"/);
  assert.doesNotMatch(h, /data-skill2-max="icearrow:3"/);
  assert.match(h, /🔒 需達到 .*才能解鎖；目前僅可查看/);
  assert.match(h, /sgb-tier sgb-tier-locked/);
});

test('投資中的階有升級與一鍵滿級；滿級只剩降級與重置', () => {
  const c = loadContext();
  const snap = snapshot({ thrust: [10, 4, 0, 0, 0, 0, 0] });
  const part = detail(c, 'thrust', snap, 1);
  assert.match(part, /data-skill2-learn="thrust:1"/);
  assert.match(part, /data-skill2-max="thrust:1"/);
  assert.match(part, /data-skill2-downgrade="thrust:1"/);
  assert.match(part, /data-skill2-delete="thrust:1"/);
  assert.match(part, /升級 · /);

  const full = detail(c, 'thrust', snap, 0);
  assert.doesNotMatch(full, /data-skill2-learn="thrust:0"/);
  assert.match(full, /已滿級/);
  assert.match(full, /data-skill2-downgrade="thrust:0"/);

  // 金幣不足時升級鈕停用
  const poor = detail(c, 'thrust', snap, 1, 0);
  assert.match(poor, /data-skill2-learn="thrust:1"[^>]*disabled/);
});

test('第 1 階恆為至少 Lv.1，不能降到 0', () => {
  const c = loadContext();
  const h = detail(c, 'thrust', snapshot({ thrust: [1, 0, 0, 0, 0, 0, 0] }), 0);
  assert.doesNotMatch(h, /data-skill2-downgrade="thrust:0"/);
  assert.doesNotMatch(h, /data-skill2-delete="thrust:0"/);
  assert.match(h, /學習|升級/);
});

test('超神進化：未開放顯示還差幾階，未選三選一，已選升級走 SG_ULT_SLOT', () => {
  const c = loadContext();
  const locked = detail(c, 'thrust', snapshot({ thrust: [10, 10, 10, 10, 10, 10, 5] }), 0);
  assert.match(locked, /前 7 階需全部滿級（目前 6／7 階已滿級）/);
  assert.doesNotMatch(locked, /data-skill2-ultpick/);

  const open = detail(c, 'thrust', snapshot({ thrust: Array(7).fill(10) }), 0);
  assert.match(open, /data-skill2-ultpick="thrust:0"/);
  assert.equal((open.match(/class="sgb-ult-card[ "]/g) || []).length, 3);

  const snap = snapshot({ thrust: Array(7).fill(10) });
  snap.skills2.ult = { thrust: { pick: 1, lv: 3 } };
  const chosen = detail(c, 'thrust', snap, 0);
  assert.match(chosen, new RegExp('data-skill2-learn="thrust:' + c.SG_ULT_SLOT + '"'));
  assert.match(chosen, /sgb-ult-card is-chosen/);
  assert.match(chosen, /sgb-fork-bar is-lit/);
  // 已選定時，點別的選項只預覽並提示要先重選
  c.UI.sgBrowse.ultFocus = 0;
  const other = c.sgbDetailHTML('thrust', snap, { player: { gold: 1e15 } });
  assert.match(other, /要改選需先按「重選」/);
});

test('主動型被動：有裝備鈕與類型標籤；已裝上改為卸下', () => {
  const c = loadContext();
  const snap = snapshot({ counter: [10, 10, 0, 0, 0, 0, 0] });
  const h = detail(c, 'counter', snap, 0);
  assert.match(h, /data-skill-equip="sg:counter"/);
  assert.match(h, /啟用被動/);
  assert.match(h, /skill-tag-passive/);
  assert.match(h, /主動型被動/);
  const eq = detail(c, 'counter', snapshot({ counter: [10, 10, 0, 0, 0, 0, 0] }, { loadout: ['sg:counter'] }), 0);
  assert.match(eq, /data-skill-unequip="sg:counter"/);
});

test('清單：鎖住的群組標出解鎖門檻，已裝上的標出已裝上', () => {
  const c = loadContext();
  const snap = snapshot({ windblade: [0, 0, 0, 0, 0, 0, 0], thrust: [10, 0, 0, 0, 0, 0, 0] });
  const locked = c.sgbListItemHTML('windblade', snap, [], false);
  assert.match(locked, /is-locked/);
  assert.match(locked, /解鎖/);
  const eq = c.sgbListItemHTML('thrust', snap, ['sg:thrust'], true);
  assert.match(eq, /已裝上/);
  assert.match(eq, /is-sel/);
});

test('清單與詳情分開快取，重繪詳情前先收掉其中的提示框', () => {
  const start = ui.indexOf('function renderSkillBrowser(');
  const block = ui.slice(start, ui.indexOf('\n}', start));
  assert.match(block, /items\._lastH !== itemsH/);
  assert.match(block, /detail\._lastH !== detailH/);
  assert.match(block, /if \(UI\.tooltipAnchor && detail\.contains\(UI\.tooltipAnchor\)\) hideTooltip\(\);/);
  assert.match(ui, /if \(typeof SKILLS2 !== 'undefined'\) renderSkillBrowser\(treesBox, skillsSnapshot, headerSnapshot\);/);
});

test('解鎖規則沿用 sgStageUnlocked：門檻＋前一階至少 Lv.1', () => {
  assert.match(ui, /function sgStageUnlocked\(gid, lvs, tierIndex, skillsSnapshot\)/);
  assert.match(ui, /tierIndex === 0 \|\| !!\(lvs && lvs\[tierIndex - 1\] >= 1\)/);
});

test('技能列移到分頁底部；舊方格列與群組升級彈窗已移除', () => {
  const tab = html.slice(html.indexOf('<section id="tab-skills"'), html.indexOf('</section>', html.indexOf('<section id="tab-skills"')));
  assert.ok(tab.indexOf('id="skill-trees"') < tab.indexOf('id="skill-loadout"'), '技能列應在技能瀏覽器下方');
  assert.match(tab, /class="sgb-loadout"/);
  assert.doesNotMatch(ui, /function sgSkillGroupRowHTML\(|function sgStageNodeHTML\(|function renderSkill2Modal\(|function renderSkill2UltModal\(/);
  assert.doesNotMatch(css, /\.sg-(group|stage|row)-/);
  assert.match(theme, /\.sgb\s*\{[\s\S]*?grid-template-columns:\s*270px minmax\(0, 1fr\)/);
  assert.match(theme, /#tab-skills #skill-trees\s*\{[\s\S]*?display:\s*block/);
  assert.match(theme, /\.sgb-line\.is-lit\s*\{[\s\S]*?background:\s*#c4282a/);
});

test('戰鬥快捷列：主動型被動帶 active-passive class，不套冷卻／無魔狀態', () => {
  const barStart = ui.indexOf('function renderBattleSkillBar(');
  const barEnd = ui.indexOf('function startBattleSkillBarAnimation(', barStart);
  const bar = ui.slice(barStart, barEnd);
  assert.match(bar, /isPassiveGroup = isSgE && \(typeof skills2IsPassive === 'function'\) && skills2IsPassive\(entry\.slice\(3\)\)/);
  assert.match(bar, /isActivePassive \? ' active-passive ready'/);
  assert.match(bar, /var isOnCd = !isActivePassive && cd > 0/);
  // 主動型被動的個別階可以有自己的內部冷卻（大地守護【天地共生】）：冷卻中要退回一般倒數呈現
  assert.match(bar, /var isPassiveOnCd = isPassiveGroup && cd > 0/);
  assert.match(bar, /var isActivePassive = isPassiveGroup && !isPassiveOnCd/);

  // CSS：旋轉流動外框（conic-gradient ＋ 無限旋轉動畫），並提供減少動態的替代呈現
  assert.match(css, /\.battle-skill-slot\.active-passive::before\s*\{[\s\S]*?conic-gradient/);
  assert.match(css, /\.battle-skill-slot\.active-passive::before\s*\{[\s\S]*?animation:\s*bss-passive-spin[\s\S]*?infinite/);
  assert.match(css, /@keyframes bss-passive-spin\s*\{[\s\S]*?rotate\(360deg\)/);
  assert.match(css, /\.battle-skill-slot\.active-passive::after\s*\{[\s\S]*?inset:\s*2px/);
  assert.match(css, /prefers-reduced-motion[\s\S]*?\.battle-skill-slot\.active-passive::before\s*\{[\s\S]*?animation:\s*none/);
});

test('資產版號存在', () => {
  assert.match(html, /css\/style\.css\?v=1\.0\.\d+/);
  assert.match(html, /js\/ui\.js\?v=1\.0\.\d+/);
});
