const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('uiTick 可在 Worker Snapshot 存在時完成一次渲染派發', () => {
  const context = {
    console,
    window: { location: { hostname: 'example.test' } },
    document: { getElementById: () => null, querySelectorAll: () => [] },
    $id: () => null,
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    fmt: (value) => String(value),
    UI: {
      dirty: { header: false, battle: false, equip: false, inv: false, factory: false,
        newforge: false, forge: false, tower: false, gems: false, skills: false, talents: false },
      tab: 'equip',
      statsPanelOpen: false,
      battleLayoutDirty: false
    },
    WorkerBridge: { status: () => ({ booted: true }) },
    GT: 0
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8'), context, { filename: 'js/ui.js' });

  const battle = { field: { player: null, monsters: [] }, tower: null };
  context.panelData = (key) => key === 'battle' ? battle : {};
  context.viewState = () => ({ hp: 1, hpMax: 1, mp: 1, mpMax: 1, towerActive: false });
  context.$id = () => null;
  context.flushPendingLogDom = () => {};
  context.flushDirtyDetailLogs = () => {};
  context.updateLiveTitle = () => {};
  context.refreshBuffTooltip = () => {};
  context.uiRenderingSuspended = () => false;
  context.renderZoneBar = () => {};
  context.refreshStageDisplay = () => {};
  context.refreshCombatPauseButton = () => {};
  context.entStatus = () => '';

  assert.doesNotThrow(() => context.uiTick());
});
