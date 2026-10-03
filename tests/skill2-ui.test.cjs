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

function detail(c, gid, snap, tier, gold, focus) {
  c.UI.sgBrowse.tier = tier;
  c.UI.sgBrowse.ultFocus = null;
  c.UI.sgBrowse.focus = focus || 'tier';
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

test('點擊群組預設最高已學階，不跳下一個未學階；七階全滿選第七階', () => {
  const c = loadContext();
  for (const [levels, expected] of [
    [Array(7).fill(0), 0],
    [[10, 0, 0, 0, 0, 0, 0], 0],
    [[10, 10, 3, 0, 0, 0, 0], 2],
    [[10, 10, 10, 0, 0, 0, 0], 2],
    [Array(7).fill(10), 6]
  ]) {
    const snap = snapshot({ thrust: levels });
    c.sgbSelectGroup('thrust', snap);
    assert.equal(c.UI.sgBrowse.gid, 'thrust');
    assert.equal(c.UI.sgBrowse.tier, expected);
    assert.equal(c.UI.sgBrowse.focus, 'tier');
    const h = c.sgbDetailHTML('thrust', snap, { player: { gold: 1e15 } });
    assert.equal((h.match(/class="sgb-tier-detail"/g) || []).length, 1);
    assert.doesNotMatch(h, /sgb-ult-detail/);
  }
});

test('有效超神為最高已學階，預設展開已選項；失效保留的超神回普通最高階', () => {
  const c = loadContext();
  const snap = snapshot({ thrust: Array(7).fill(10) });
  snap.skills2.ult = { thrust: { pick: 1, lv: 3 } };
  c.UI.sgBrowse.tier = null;
  const initial = c.sgbDetailHTML('thrust', snap, { player: { gold: 1e15 } });
  assert.equal(c.UI.sgBrowse.focus, 'ult');
  assert.equal(c.UI.sgBrowse.ultFocus, 1);
  assert.match(initial, /sgb-ult-detail/);
  assert.doesNotMatch(initial, /class="sgb-tier-detail"/);
  snap.skills2.levels.thrust[6] = 9;
  c.sgbSelectGroup('thrust', snap);
  assert.equal(c.UI.sgBrowse.focus, 'tier');
  assert.equal(c.UI.sgBrowse.tier, 6);
  assert.equal(c.UI.sgBrowse.ultFocus, null);
});

test('一般重繪保留手動階級，再點相同群組回最高階與已選超神', () => {
  const c = loadContext();
  const snap = snapshot({ thrust: Array(7).fill(10) });
  snap.skills2.ult = { thrust: { pick: 2, lv: 10 } };
  c.sgbSelectGroup('thrust', snap);
  c.UI.sgBrowse.tier = 0;
  c.UI.sgBrowse.focus = 'tier';
  c.sgbDetailHTML('thrust', snap, { player: { gold: 42 } });
  assert.equal(c.UI.sgBrowse.tier, 0);
  assert.equal(c.UI.sgBrowse.focus, 'tier');
  c.UI.sgBrowse.ultFocus = 0;
  c.sgbSelectGroup('thrust', snap);
  assert.equal(c.UI.sgBrowse.focus, 'ult');
  assert.equal(c.UI.sgBrowse.ultFocus, 2);
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
  const locked = detail(c, 'thrust', snapshot({ thrust: [10, 10, 10, 10, 10, 10, 5] }), 0, undefined, 'ult');
  assert.match(locked, /前 7 階需全部滿級（目前 6／7 階已滿級）/);
  assert.doesNotMatch(locked, /data-skill2-ultpick/);

  const open = detail(c, 'thrust', snapshot({ thrust: Array(7).fill(10) }), 0, undefined, 'ult');
  assert.match(open, /data-skill2-ultpick="thrust:0"/);
  assert.equal((open.match(/class="sgb-ult-card[ "]/g) || []).length, 3);

  const snap = snapshot({ thrust: Array(7).fill(10) });
  snap.skills2.ult = { thrust: { pick: 1, lv: 3 } };
  const chosen = detail(c, 'thrust', snap, 0, undefined, 'ult');
  assert.match(chosen, new RegExp('data-skill2-learn="thrust:' + c.SG_ULT_SLOT + '"'));
  assert.match(chosen, /sgb-ult-card is-chosen/);
  assert.match(chosen, /sgb-fork-bar is-lit/);
  // 已選定時，點別的選項可直接付費切換。
  c.UI.sgBrowse.ultFocus = 0;
  const other = c.sgbDetailHTML('thrust', snap, { player: { gold: 1e15 } });
  assert.match(other, /data-skill2-ultswitch="thrust:0"/);
  assert.match(other, /切換 · .* 金幣/);
  assert.doesNotMatch(other, /data-skill2-delete|data-skill2-ultpick/);
  const poor = c.sgbDetailHTML('thrust', snap, { player: { gold: 0 } });
  assert.match(poor, /data-skill2-ultswitch="thrust:0"[^>]*disabled/);
  snap.skills2.levels.thrust[6] = 9;
  assert.doesNotMatch(c.sgbDetailHTML('thrust', snap, { player: { gold: 1e15 } }), /data-skill2-ultswitch/);
});

test('切換二次確認顯示完整費用；取消不送指令，確認只送原子切換', async () => {
  const c = loadContext();
  const snap = snapshot({ frostnova: Array(7).fill(10) });
  snap.skills2.progress = { level: 1000, reinc: 10 };
  snap.skills2.ult = { frostnova: { pick: 1, lv: 10 } };
  c.uiSkillsPanelSnapshot = () => snap;
  const elements = {};
  function element() {
    return {
      style: {}, children: [], text: '',
      set textContent(value) { this.text = value; this.children = []; },
      get textContent() { return this.text + this.children.map(child => child.textContent).join(''); },
      appendChild(child) { this.children.push(child); }
    };
  }
  for (const id of ['confirm-modal', 'confirm-message', 'confirm-ok', 'confirm-cancel', 'confirm-title']) {
    elements[id] = element();
  }
  c.document.createElement = () => element();
  c.document.createTextNode = (text) => ({ textContent: text });
  c.document.getElementById = (id) => elements[id] || null;
  const sent = [], errors = [];
  c.sendUiCommand = (...args) => { sent.push(args); return Promise.resolve(null); };
  c.reportUiCommandFailure = (...args) => errors.push(args);
  const cost = c.skills2UltCost('frostnova', 2, 0);
  c.runSkill2UltSwitch('frostnova', 2);
  assert.equal(elements['confirm-modal'].style.display, 'flex');
  assert.equal(elements['confirm-title'].textContent, '超神進化切換確認');
  assert.equal(elements['confirm-ok'].textContent, '確認切換');
  const highlight = elements['confirm-message'].children[0];
  assert.equal(highlight.className, 'confirm-highlight');
  assert.equal(highlight.textContent, '需支付 ' + cost.toLocaleString('en-US') + ' 金幣');
  assert.match(elements['confirm-message'].textContent, /極致之冰.*Lv\.10.*冰皇領域.*Lv\.1/);
  assert.ok(elements['confirm-message'].textContent.includes(cost.toLocaleString('en-US') + ' 金幣'));
  assert.match(elements['confirm-message'].textContent, /原技能與等級將清除.*金幣不退還/);
  assert.equal(sent.length, 0);
  elements['confirm-cancel'].onclick();
  assert.equal(sent.length, 0);
  assert.equal(elements['confirm-modal'].style.display, 'none');
  c.runSkill2UltSwitch('frostnova', 2);
  const confirm = elements['confirm-ok'].onclick;
  confirm();
  await Promise.resolve();
  assert.equal(elements['confirm-ok'].onclick, null);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], 'skill2.ultSwitch');
  assert.deepEqual(JSON.parse(JSON.stringify(sent[0][1])), { group: 'frostnova', opt: 2, fromOpt: 1, fromLv: 10, cost });
  assert.deepEqual(errors, []);
  c.sendUiCommand = () => Promise.resolve({ err: '金幣不足' });
  c.runSkill2UltSwitch('frostnova', 2);
  elements['confirm-ok'].onclick();
  await Promise.resolve();
  assert.equal(errors[0][1], '金幣不足');
});

test('同一時間只展開一段說明：看某一階時超神說明收起，看超神時各階收起', () => {
  const c = loadContext();
  const snap = snapshot({ thrust: Array(7).fill(10) });
  const tierView = detail(c, 'thrust', snap, 2, undefined, 'tier');
  assert.equal((tierView.match(/class="sgb-tier-detail"/g) || []).length, 1);
  assert.doesNotMatch(tierView, /sgb-ult-detail/);
  assert.match(tierView, /sgb-ult-cards/, '三張超神卡片仍然顯示');
  const ultView = detail(c, 'thrust', snap, 2, undefined, 'ult');
  assert.doesNotMatch(ultView, /class="sgb-tier-detail"/);
  assert.match(ultView, /sgb-ult-detail/);
});

test('降級保留的超神明確標示未生效，且不亮起選擇卡與連線', () => {
  const c = loadContext();
  const snap = snapshot({ thrust: [10, 10, 10, 10, 10, 10, 9] });
  snap.skills2.ult = { thrust: { pick: 1, lv: 10 } };
  const h = detail(c, 'thrust', snap, 0, undefined, 'ult');
  assert.match(h, /未生效 · 已保留 · Lv.10 \/ 10/);
  assert.doesNotMatch(h, /sgb-ult-card is-chosen|sgb-fork-bar is-lit|sgb-line-full is-lit/);
  assert.doesNotMatch(h, /data-skill2-learn="thrust:7"/);
});

test('舊重置殘留可從第 1 階保底再重置，清除後總級數與超神卡一致', () => {
  const c = loadContext();
  const snap = snapshot({ thrust: [1, 0, 0, 0, 0, 0, 0] });
  snap.skills2.ult = { thrust: { pick: 1, lv: 10 } };
  const residual = detail(c, 'thrust', snap, 0);
  assert.match(residual, /data-skill2-delete="thrust:0"/);
  assert.doesNotMatch(residual, /data-skill2-downgrade="thrust:0"/);
  delete snap.skills2.ult.thrust;
  const reset = detail(c, 'thrust', snap, 0);
  assert.equal(c.sgbTotals('thrust', snap.skills2.levels.thrust, snap).total, 1);
  assert.equal((reset.match(/未開放/g) || []).length, 3);
  assert.doesNotMatch(reset, /已選擇|已保留|sgb-ult-card is-chosen|data-skill2-delete="thrust:0"/);
});

test('篩選只有全部／物理／魔法三個，依傷害類型分類', () => {
  const c = loadContext();
  const chips = c.sgbFilterChipsHTML();
  assert.deepEqual([...chips.matchAll(/data-sgb-filter="(\w+)"/g)].map((m) => m[1]), ['all', 'phys', 'magic']);
  assert.equal(c.sgbCategoryOf('fireball'), 'magic');
  assert.equal(c.sgbCategoryOf('thrust'), 'phys');
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
