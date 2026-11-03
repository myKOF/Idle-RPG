'use strict';
/* 解鎖提示的共載索引。只讀傳入狀態與既有配置，不寫入 G 或顯示層狀態。 */
function systemUnlockEntries(state) {
  state = state || {};
  var p = state.player || {}, level = Number(p.level) || 0, turn = Number(p.reincarnations) || 0;
  var entries = [];
  function add(id, tab, selector, unlocked, initiallyOpen) {
    entries.push({ id: id, tab: tab, selector: selector, unlocked: !!unlocked, notify: !initiallyOpen });
  }
  var forgeOpen = !!(state.forge && (state.forge.unlocked || state.forge.unlockNotified)) ||
    progressReached(level, turn, FORGE_UNLOCK_LEVEL, FORGE_UNLOCK_REINCARNATION);
  Object.keys(DIVINE_FORGE_MODES).forEach(function (mode) {
    var requiredTurn = divineForgeUnlock(mode);
    add('forge.' + mode, 'forge', '#forge-mode-' + mode,
      forgeOpen && turn >= requiredTurn,
      progressReached(1, 0, FORGE_UNLOCK_LEVEL, FORGE_UNLOCK_REINCARNATION) && requiredTurn <= 0);
  });
  add('gems.resonance', 'gems', '[data-gem-tool-btn="resonance"]',
    progressReached(level, turn, GEM_RESONANCE_UNLOCK_LEVEL, GEM_RESONANCE_UNLOCK_REINCARNATION),
    progressReached(1, 0, GEM_RESONANCE_UNLOCK_LEVEL, GEM_RESONANCE_UNLOCK_REINCARNATION));
  Object.keys(TALENT_TREES).forEach(function (key) {
    var requiredTurn = Number(key);
    add('talents.' + key, 'talents', '[data-talent-turn="' + key + '"]',
      turn >= requiredTurn && progressReached(level, turn, TALENT_UNLOCK_LEVEL, TALENT_UNLOCK_REINCARNATION), false);
  });
  EQUIP_SET_UNLOCK_LEVELS.forEach(function (requiredLevel, index) {
    var requiredTurn = EQUIP_SET_UNLOCK_REINCARNATIONS[index];
    add('equip.set.' + index, 'equip', '[data-eqset="' + index + '"]',
      progressReached(level, turn, requiredLevel, requiredTurn), progressReached(1, 0, requiredLevel, requiredTurn));
  });
  var highest = Number(state.tower && state.tower.highest) || 0;
  add('tower.hell', 'tower', '[data-tower-tier="hell"]', highest >= TOWER_TRIAL_MAX_FLOOR, false);
  add('tower.purgatory', 'tower', '[data-tower-tier="purgatory"]', highest >= TOWER_HELL_MAX_FLOOR, false);
  return entries;
}

function systemUnlockSnapshot(state) {
  var entries = systemUnlockEntries(state), saved = state && state.uiUnlockSeen || {};
  return {
    available: entries.filter(function (entry) { return entry.notify && entry.unlocked; }).map(function (entry) { return entry.id; }),
    seen: entries.filter(function (entry) { return saved[entry.id] === true; }).map(function (entry) { return entry.id; })
  };
}
