const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRuneEnv, wordItem, slotFor } = require('./helpers/runeword-env.cjs');

/* 56 組逐一煙霧測試：每組都能在對應裝備上成形、聚合進 st.rw、並且它宣告的每個觸發都能真的跑完
   （沒有例外、有傷害動作的觸發確實打到敵人）。資料表打錯參數、動作缺欄位會在這裡現形。 */
function enemy() {
  return { name: '木樁', hp: 1e12, maxHp: 1e12, atk: 1, def: 0, mdef: 0, level: 1, dodge: 0,
    resist: {}, buffs: {}, effects: {}, dots: [], ctrlRes: 0, shield: 0, atkCd: 99 };
}

const ids = loadRuneEnv({ noState: true }).RUNEWORDS.map((w) => w.id);

for (const id of ids) {
  test(`符文真言【${id}】：成形、聚合、全部觸發可執行`, () => {
    const c = loadRuneEnv();
    const w = c.RUNEWORD_BY_ID[id];
    const it = wordItem(c, id);
    assert.equal(c.rwActiveWord(it).word.id, id, '配方在對應裝備上成形');
    c.G.equipment[slotFor(c, it)] = it;
    c.markStatsDirty();
    const st = c.getStats();
    assert.ok(st.rw.words.includes(id), '聚合進 st.rw');
    Object.keys(w.fx || {}).forEach((k) => assert.equal(st.rw.fx[k], w.fx[k], 'fx ' + k));
    assert.equal(st.rw.procs.length, (w.procs || []).length);
    (w.legend || []).forEach((k) => assert.equal(st.legendaryEffects[k], true, '借用傳奇 ' + k));
    Object.keys(w.passives || {}).forEach((k) => assert.ok(st.passives[k] >= w.passives[k]));
    assert.ok(Number.isFinite(st.hp) && st.hp > 0 && Number.isFinite(st.atk), '屬性有限且生命為正');
    assert.ok(c.itemScore(it) > 0);
    assert.ok(c.itemRuneHTML(it, null).includes(w.name), '符文孔橫幅顯示名稱');
    assert.ok(c.rwSlots(it).length >= w.runes.length && w.runes.length <= c.RUNE_SETTINGS.maxSlots, '配方放得進符文孔');

    // ---- 觸發：逐一執行 ----
    const foes = [enemy(), enemy(), enemy()];
    c.G.tower.active = false;
    const p = c.FIELD.player = c.newPlayerEntity(st);
    c.FIELD.monsters = foes; c.FIELD.monster = foes[0];
    c.castSkill2 = () => ({ dmg: 1, killed: false });
    c.G.player.loadout = ['sg:thrust'];
    c.G.player.skills2 = { levels: { thrust: [1, 0, 0, 0, 0, 0, 0] } };
    c.Math.random = () => 0;                 // 機率一律擲中
    p.skillCds = { 'sg:thrust': 5 };
    const hpBefore = () => foes.map((f) => f.hp);
    const lost = (before) => foes.some((f, i) => f.hp < before[i]);
    (w.procs || []).forEach((proc) => {
      const dmgAct = proc.acts.some((a) => a.act === 'dmg');
      const before = hpBefore();
      p.hp = st.hp * 0.1;                    // 讓 lowhp 條件成立
      c.GT += 1000;                          // 跳過內建冷卻
      c.rwResetRT();
      const everyN = proc.every && proc.on !== 'tick' ? proc.every : 1;
      for (let n = 0; n < everyN; n++) {
        switch (proc.on) {
          case 'hit': c.rwOnBasicAttack(p, foes[0], { miss: false, dmg: 1000, crit: false }, 'mv-float', st); break;
          case 'crit': c.rwOnBasicAttack(p, foes[0], { miss: false, dmg: 1000, crit: true }, 'mv-float', st); break;
          case 'kill': c.rwOnKill(p, enemy()); break;
          case 'hurt': c.rwOnPlayerDamaged(foes[0], p, 100, false, {}, 'pv-float'); break;
          case 'block': c.rwOnPlayerDamaged(foes[0], p, 100, true, {}, 'pv-float'); break;
          case 'cast': c.rwOnSkillCast(p, 'thrust', { dmg: 0, killed: false }, 'mv-float', foes); break;
          case 'tick': {
            const ctx = { pEnt: p, getEnemies: () => foes, floatSel: 'mv-float', onDeaths() {} };
            c.rwTick(0.1, ctx);               // 建立排程
            c.GT += proc.every + 0.1;
            c.rwTick(0.1, ctx);
            break;
          }
          case 'lowhp': c.rwCheckLowHp(p, st, 'mv-float'); break;
          default: assert.fail('未知觸發 ' + proc.on);
        }
      }
      if (dmgAct) assert.ok(lost(before), `${proc.on} 觸發的傷害動作沒有打到任何敵人`);
    });
    // 復活類
    if (w.fx && w.fx.reviveHpPct) { p.hp = 0; c.GT += 1000; assert.equal(c.rwTryRevive(p), true); assert.ok(p.hp > 0); }
    // 條件式增傷乘區可算且為正有限數
    const mult = c.rwOutgoingMultiplier(p, foes[0], { atk: 1, isPlayer: true });
    assert.ok(Number.isFinite(mult) && mult > 0);
  });
}
