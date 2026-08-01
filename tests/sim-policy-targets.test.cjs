/* 目標與缺口驅動。

   策略原本寫的是「該做什麼」——一份靜態的詞條保留清單。問題是正確答案會隨關卡改變：
   實測怪物閃避在關卡 130 是 86.8%、關卡 150 是 103%，而命中公式會夾在 5%~100%。
   角色面板命中 100%、身上 65 條詞條一條命中率都沒有，有效命中觸底 5%——
   13,718 次出手只中 551 次，而策略完全不知道這件事。

   改成宣告「要達成什麼」：直譯器每個決策點算出缺口，規則據此行動，補滿自動讓位。

   這裡測的是機制本身，不開遊戲引擎——合成 state 直接驅動策略層。 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createPolicy } = require('../scripts/sim/policy.js');

/* 一份最小策略：宣告一個有效命中率目標，並用一條規則把缺口原樣回報成指令參數。 */
function makePolicy(extra, targetExtra) {
  return createPolicy(Object.assign({
    name: 'test',
    decideEveryGameSec: 60,
    needPanels: ['equip', 'battle'],
    track: { monster: 'panels.battle.field.monster', stage: 'view.stage' },
    targets: [Object.assign({
      id: 'hit',
      kind: 'selfMinusEnemy',
      self: 'panels.equip.stats.hit',
      enemy: 'ctx.enemyDodge',
      clampMin: 5,
      clampMax: 100,
      atLeast: 95,
      affixKey: 'hit'
    }, targetExtra || {})],
    rules: [{
      id: 'echo',
      cmd: 'debug.echo',
      args: {
        value: { $path: 'ctx.deficit.hit.value' },
        short: { $path: 'ctx.deficit.hit.short' },
        met: { $path: 'ctx.deficit.hit.met' }
      }
    }]
  }, extra || {}));
}

/* 合成觀測點。selfHit＝面板命鐘率，dodge＝當前怪物閃避。 */
function st(sec, selfHit, dodge, equipment) {
  return {
    gameTimeSec: sec,
    view: { stage: 100 },
    panels: {
      equip: {
        stats: { hit: selfHit },
        /* 遊戲送出來的詞條規則：命中率只能長在這些部位（協議 v15）。 */
        affixRules: { hit: { slots: ['helmet', 'gloves', 'wrist', 'legs', 'boots', 'ring', 'amulet'], minR: null } }
      },
      battle: { field: { monster: dodge === null ? null : { dodge: dodge, maxHp: 100, hp: 100, level: 100 } } },
      inv: { equipment: equipment || {} }
    }
  };
}

function echoOf(cmds) {
  const c = cmds.find((x) => x.name === 'debug.echo');
  return c ? c.args : null;
}

test('缺口＝目標減去當前值，補滿之後 met 為真', () => {
  const p = makePolicy();
  const low = echoOf(p.decide(st(1, 100, 60)));       // 有效命中 40
  assert.equal(low.value, 40);
  assert.equal(low.short, 55);
  assert.equal(low.met, false);

  const ok = echoOf(p.decide(st(2, 200, 60)));        // 有效命中 100（夾在上限）
  assert.equal(ok.value, 100);
  assert.equal(ok.short, 0);
  assert.equal(ok.met, true);
});

test('要套用遊戲的夾值，否則缺口大小會誤導優先序', () => {
  /* 命中 100 − 閃避 103 = −3，但遊戲夾在 5% 下限。不夾的話缺口會被算成 98
     而不是 90，這條目標會不合理地壓過其他目標。 */
  const p = makePolicy();
  const d = echoOf(p.decide(st(1, 100, 103)));
  assert.equal(d.value, 5);
  assert.equal(d.short, 90);
});

test('沒有觀測到怪物時回報 unknown 而不是假裝缺口為 0', () => {
  /* 開場還沒交戰、或剛過關的空檔。回 0 會讓規則以為「已達標」而不動作，
     回滿缺口又會讓它在資訊不足時亂洗。unknown 是第三種答案。 */
  const p = makePolicy();
  const cmds = p.decide(st(1, 100, null));
  const d = echoOf(cmds);
  assert.equal(d.value, null);
  assert.equal(d.met, true, 'unknown 視同不動作');
});

test('怪物閃避取自高頻觀測，決策點沒在交戰也讀得到', () => {
  /* 決策點是取樣式的，很可能落在怪物剛死的空檔。現讀會拿到 null，
     所以要用觀測記下來的最近一次。 */
  const p = makePolicy();
  p.observe(st(1, 100, 70));                          // 觀測時有怪
  const d = echoOf(p.decide(st(2, 100, null)));       // 決策時沒怪
  assert.equal(d.value, 30, '應沿用觀測到的閃避 70');
});

/* ---- 缺口洗煉挑哪個部位 ---- */

function deficitPolicy(targetExtra) {
  return createPolicy({
    name: 'test',
    decideEveryGameSec: 60,
    needPanels: ['equip', 'battle', 'inv'],
    track: { monster: 'panels.battle.field.monster', stage: 'view.stage' },
    targets: [Object.assign({
      id: 'hit', kind: 'selfMinusEnemy',
      self: 'panels.equip.stats.hit', enemy: 'ctx.enemyDodge',
      clampMin: 5, clampMax: 100, atLeast: 95, affixKey: 'hit', maxAffixes: 1
    }, targetExtra || {})],
    rules: [{
      id: 'fix', cmd: 'item.rerollAffix',
      rerollForDeficit: { equipment: 'panels.inv.equipment', minRarity: 0, keepAncient: true }
    }]
  });
}

const GEAR = {
  weapon: { id: 'w1', slot: 'weapon', rarity: 5, affixes: [{ key: 'atkPct' }] },
  amulet: { id: 'a1', slot: 'amulet', rarity: 5, affixes: [{ key: 'gemEff' }] },
  boots: { id: 'b1', slot: 'boots', rarity: 5, affixes: [{ key: 'defPct' }] },
  helmet: { id: 'h1', slot: 'helmet', rarity: 5, affixes: [{ key: 'hpPct' }] }
};

function rerollOf(cmds) {
  return cmds.filter((c) => c.name === 'item.rerollAffix');
}

test('只洗遊戲允許的部位——武器洗不出命中率就不該去洗它', () => {
  /* 手抄部位清單踩過的坑：策略寫了 weapon（命中率不能出現在武器上）
     與 bracers（遊戲的鍵是 wrist），375 次洗煉一條都沒洗出來。
     可用部位一律從 panels.equip.affixRules 讀。 */
  const p = deficitPolicy();
  const cmds = rerollOf(p.decide(st(1, 100, 60, GEAR)));
  assert.equal(cmds.length, 1);
  assert.notEqual(cmds[0].args.itemId, 'w1', '不該去洗武器');
});

test('avoidSlots 保護高價值部位，preferSlots 決定先犧牲哪一格', () => {
  /* player_strategy.md：項鏈戒指是關鍵（寶石鑲嵌率／掉寶率／經驗加成），
     命中率有 7 個部位可洗，不必用最貴的格子付帳。 */
  const p = deficitPolicy({ avoidSlots: ['ring', 'amulet'], preferSlots: ['boots', 'helmet'] });
  const cmds = rerollOf(p.decide(st(1, 100, 60, GEAR)));
  assert.equal(cmds.length, 1);
  assert.equal(cmds[0].args.itemId, 'b1', '應先犧牲 boots');
  assert.notEqual(cmds[0].args.affixKey, 'hit', '不該把目標詞條本身洗掉');
});

test('目標達成後就不再洗——這是「拿一兩格去換」，不是全身都洗成它', () => {
  const p = deficitPolicy();
  const gear = JSON.parse(JSON.stringify(GEAR));
  gear.boots.affixes = [{ key: 'hit' }];              // 已經有 1 條，maxAffixes 也是 1
  assert.equal(rerollOf(p.decide(st(1, 100, 60, gear))).length, 0);
});

test('缺口補滿後停手，就算身上一條目標詞條都沒有', () => {
  const p = deficitPolicy();
  assert.equal(rerollOf(p.decide(st(1, 200, 60, GEAR))).length, 0, '有效命中已達 100%，不該再洗');
});
