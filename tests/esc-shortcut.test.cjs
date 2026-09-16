'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('全域 Esc 快捷鍵關閉界面功能測試', () => {
  const uiCode = fs.readFileSync(path.join(__dirname, '../js/ui.js'), 'utf8');

  // 驗證 ui.js 中包含 closeTopmostModalOrOverlay 與 keydown Escape 事件監聽
  assert.match(uiCode, /function closeTopmostModalOrOverlay\(\)/);
  assert.match(uiCode, /e\.key === 'Escape'/);
  assert.match(uiCode, /window\.closeTopmostModalOrOverlay\s*=/);

  // 模擬 DOM 環境測試 closeTopmostModalOrOverlay 邏輯
  const elements = {};
  function mockEl(id, isClassList) {
    const el = {
      id: id,
      style: { display: 'none' },
      classList: {
        _classes: new Set(),
        contains(c) { return this._classes.has(c); },
        add(c) { this._classes.add(c); },
        remove(c) { this._classes.delete(c); }
      },
      clickCount: 0,
      click() { this.clickCount++; }
    };
    elements[id] = el;
    return el;
  }

  const skillModal = mockEl('skill-modal');
  const talentModal = mockEl('talent-modal');
  const questModal = mockEl('quest-modal');
  const summaryModal = mockEl('summary-modal');
  const confirmModal = mockEl('confirm-modal');
  const confirmCancel = mockEl('confirm-cancel');
  const equipSetTabs = mockEl('equip-set-tabs');
  const salvagePanel = mockEl('salvage-settings-panel');
  const affixOverlay = mockEl('affix-pool-overlay');

  const fakeWindow = {
    getComputedStyle: (el) => el.style
  };
  const fakeDoc = {
    querySelector: () => null,
    querySelectorAll: () => []
  };

  // 抽出函式並執行
  const fnMatch = uiCode.match(/function closeTopmostModalOrOverlay\(\)\s*\{([\s\S]*?)\n\}\s*\nif \(typeof window/);
  assert.ok(fnMatch, 'closeTopmostModalOrOverlay 函式可被成功提取');

  const closeFn = new Function('$id', 'document', 'window', 'UI', 'closeSkillModal', 'closeTalentModal', 'closeQuestModal', 'closeStatsPanel', 'closeOfflineSummary', fnMatch[1]);

  const $id = (id) => elements[id] || null;
  const UI = { affixPoolItemId: 123 };
  let skillClosed = 0;
  let talentClosed = 0;
  let questClosed = 0;
  let statsClosed = 0;

  const closeSkillModal = () => { skillClosed++; skillModal.style.display = 'none'; };
  const closeTalentModal = () => { talentClosed++; talentModal.style.display = 'none'; };
  const closeQuestModal = () => { questClosed++; questModal.style.display = 'none'; };
  const closeStatsPanel = () => { statsClosed++; summaryModal.style.display = 'none'; };

  // 1. 無任何界面開啟時，回傳 false
  assert.equal(closeFn($id, fakeDoc, fakeWindow, UI, closeSkillModal, closeTalentModal, closeQuestModal, closeStatsPanel), false);

  // 2. 技能升級彈窗開啟時，Esc 關閉它
  skillModal.style.display = 'flex';
  assert.equal(closeFn($id, fakeDoc, fakeWindow, UI, closeSkillModal, closeTalentModal, closeQuestModal, closeStatsPanel), true);
  assert.equal(skillClosed, 1);
  assert.equal(skillModal.style.display, 'none');

  // 3. 天賦彈窗開啟時，Esc 關閉它
  talentModal.style.display = 'flex';
  assert.equal(closeFn($id, fakeDoc, fakeWindow, UI, closeSkillModal, closeTalentModal, closeQuestModal, closeStatsPanel), true);
  assert.equal(talentClosed, 1);
  assert.equal(talentModal.style.display, 'none');

  // 4. 任務總覽彈窗開啟時，Esc 關閉它
  questModal.style.display = 'flex';
  assert.equal(closeFn($id, fakeDoc, fakeWindow, UI, closeSkillModal, closeTalentModal, closeQuestModal, closeStatsPanel), true);
  assert.equal(questClosed, 1);
  assert.equal(questModal.style.display, 'none');

  // 5. 統計面板開啟時，Esc 關閉它
  summaryModal.style.display = 'flex';
  assert.equal(closeFn($id, fakeDoc, fakeWindow, UI, closeSkillModal, closeTalentModal, closeQuestModal, closeStatsPanel), true);
  assert.equal(statsClosed, 1);
  assert.equal(summaryModal.style.display, 'none');

  // 6. 裝備套裝浮層開啟時，Esc 關閉它
  equipSetTabs.classList.add('open');
  assert.equal(closeFn($id, fakeDoc, fakeWindow, UI, closeSkillModal, closeTalentModal, closeQuestModal, closeStatsPanel), true);
  assert.equal(equipSetTabs.classList.contains('open'), false);

  // 7. 分解設定浮層開啟時，Esc 關閉它
  salvagePanel.style.display = 'block';
  assert.equal(closeFn($id, fakeDoc, fakeWindow, UI, closeSkillModal, closeTalentModal, closeQuestModal, closeStatsPanel), true);
  assert.equal(salvagePanel.style.display, 'none');

  // 8. 詞條池浮層開啟時，Esc 關閉它
  affixOverlay.style.display = 'block';
  assert.equal(closeFn($id, fakeDoc, fakeWindow, UI, closeSkillModal, closeTalentModal, closeQuestModal, closeStatsPanel), true);
  assert.equal(affixOverlay.style.display, 'none');
  assert.equal(UI.affixPoolItemId, null);

  // 9. 確認彈窗開啟時（高優先級），觸發取消按鈕點擊
  confirmModal.style.display = 'flex';
  skillModal.style.display = 'flex'; // 同時存在技能彈窗
  assert.equal(closeFn($id, fakeDoc, fakeWindow, UI, closeSkillModal, closeTalentModal, closeQuestModal, closeStatsPanel), true);
  assert.equal(confirmCancel.clickCount, 1);
  // 技能彈窗應尚未被關閉（第一下先關確認彈窗）
  assert.equal(skillClosed, 1);
});
