'use strict';
/* ============ 戰鬥引擎（野外 + 共用攻擊邏輯 + 技能） ============ */

// 野外戰鬥狀態
var FIELD = {
    player: null,      // { hp, mp, shield, atkCd, skillCd, effects:{}, buffs:{}, dots:[] }
    monster: null,
    monsters: [],
    spawnCd: 0,
    reviveCd: 0,
    dpsWindow: []      // [ [GT, dmg], ... ] 供 DPS 顯示
};

var COMBAT_PAUSED = false;
var FIELD_ENEMY_FLOAT_SEQ = 0;

function isCombatPaused() {
    return COMBAT_PAUSED;
}

function setCombatPaused(paused) {
    COMBAT_PAUSED = !!paused;
    if (COMBAT_PAUSED && typeof clearTowerFloatLayers === 'function' &&
        typeof G !== 'undefined' && G && G.tower && G.tower.active) {
        clearTowerFloatLayers();
    }
    if (typeof UI !== 'undefined' && UI.dirty) UI.dirty.battle = true;
    return COMBAT_PAUSED;
}

function toggleCombatPaused() {
    return setCombatPaused(!COMBAT_PAUSED);
}

function newPlayerEntity(st) {
    return { hp: st.hp, mp: st.mp, shield: 0, shieldMax: 0, shieldMaxVersion: SHIELD_MAX_VERSION, atkCd: 1 / st.aspd, skillCds: {}, skillGcd: 0, buffs: {}, dots: [], effects: {}, _lastStandAt: 0 };
}

// 普攻擊殺後換目標的最短間隔沿用技能 GCD；attackRate 用來換算成 atkCd 計時器單位，
// 確保攻速增益或減速不會把實際的固定間隔縮短或意外延長。
function applyBasicAttackKillGap(pEnt, attackRate) {
    if (!pEnt) return;
    var gapSec = (typeof SKILL_GLOBAL_COOLDOWN === 'number') ? SKILL_GLOBAL_COOLDOWN : 0.4;
    var rate = (typeof attackRate === 'number' && attackRate > 0) ? attackRate : 1;
    pEnt.atkCd = Math.max(pEnt.atkCd || 0, gapSec * rate);
}

function initFieldPlayer() {
    FIELD.player = newPlayerEntity(getStats());
    // 45 新技能：野外玩家實體重建（開局/讀檔/死亡重生等）＝新一場戰鬥，清空技能執行期狀態
    if (typeof resetSkillRT === 'function') resetSkillRT();
}

function fieldEnemyList() {
    if (Array.isArray(FIELD.monsters) && (FIELD.monsters.length || !FIELD.monster)) return FIELD.monsters;
    return FIELD.monster ? [FIELD.monster] : [];
}

function syncFieldPrimary() {
    var enemies = Array.isArray(FIELD.monsters) ? FIELD.monsters : fieldEnemyList();
    var live = enemies.filter(function (m) { return m && m.hp > 0; });
    FIELD.monster = live.length ? live[0] : (enemies.length ? enemies[0] : null);
    FIELD.monsters = enemies;
}

function liveFieldEnemies() {
    return fieldEnemyList().filter(function (m) { return m && m.hp > 0; });
}

/* 「已經進場」＝走到定位、可以打人也可以被打。
   進場中的敵人仍然活著（liveFieldEnemies 看得到，所以它照樣佔格、照樣顯示、
   也算在補波的空格計算裡），只是還沒加入戰鬥。 */
function fieldEnemyEntering(m) {
    return !!(m && m._enterCd > 0);
}
function fieldCombatReady(m) {
    return !!(m && m.hp > 0 && !(m._enterCd > 0));
}
/* 可交戰的敵人：選目標、範圍展開、持續傷害、技能排程器一律只看這一份。 */
function combatFieldEnemies() {
    return fieldEnemyList().filter(fieldCombatReady);
}

/* 進場倒數，回傳「本輪剛走到定位」的敵人。
   抵達的當下 atkCd 歸零並立刻補一擊（由 fieldTick 在玩家行動之前執行）：
   原本「新怪至少完成一次攻擊、即使被秒殺也算數」的保證因此完整保留——
   只是從「生成當輪」移到「抵達當輪」。進場期間牠不會被打死，一定活得到那一刻。
   這條保證不能省：少了它，高 DPS 玩家會在每隻怪抵達的瞬間秒殺，永遠不吃傷害，
   波次串流「撐不住就會失敗」的壓力設計就整個失效。 */
function tickFieldEnterDelays(dt) {
    var enemies = fieldEnemyList();
    var arrived = [];
    for (var i = 0; i < enemies.length; i++) {
        var m = enemies[i];
        if (!m || !(m._enterCd > 0)) continue;
        m._enterCd -= dt;
        if (m._enterCd <= 0) {
            m._enterCd = 0;
            m.atkCd = 0;
            arrived.push(m);
        }
    }
    if (arrived.length) UI.dirty.battle = true;
    return arrived;
}

function isFieldEnemyVisible(m) {
    return !!(m && (m.hp > 0 || (m._rewarded && (m._deathClearCd || 0) > 0)));
}

function visibleFieldEnemies() {
    return fieldEnemyList().filter(isFieldEnemyVisible);
}

function hasFieldDeathHolds() {
    return fieldEnemyList().some(function (m) {
        return m && m.hp <= 0 && m._rewarded && (m._deathClearCd || 0) > 0;
    });
}

function tickFieldDeathClears(dt) {
    var enemies = fieldEnemyList();
    if (!enemies.length) return false;
    var kept = [];
    var changed = false;
    for (var i = 0; i < enemies.length; i++) {
        var m = enemies[i];
        if (m && m.hp <= 0 && m._rewarded) {
            if (m._deathClearCd === undefined || m._deathClearCd === null) m._deathClearCd = FIELD_ENEMY_DEATH_CLEAR_DELAY;
            m._deathClearCd -= dt;
            if (m._deathClearCd > 0) {
                kept.push(m);
            } else {
                changed = true;
            }
        } else {
            kept.push(m);
        }
    }
    if (!changed) return false;
    FIELD.monsters = kept;
    markFieldEnemyFloatTargets(kept);
    syncFieldPrimary();
    UI.dirty.battle = true;
    return true;
}

function markFieldEnemyFloatTargets(enemies) {
    for (var i = 0; i < enemies.length; i++) {
        var enemy = enemies[i];
        if (!enemy) continue;
        // 浮字圖層不能使用目前陣列索引：死敵清除後，剩餘敵人的索引會前移，
        // 延遲中的傷害事件便會落到錯誤卡片，且 UI 可能因此整批重建 DOM。
        if (!/^mv-float-\d+$/.test(enemy.floatSel || '')) {
            enemy.floatSel = 'mv-float-' + (FIELD_ENEMY_FLOAT_SEQ++);
        }
    }
}

/* 場上還有沒有活著的 BOSS。BOSS 關一關只有一隻，串流補波時要跳過，
   否則每隔幾秒就多冒一隻 BOSS（而且 isFieldBossDefeated 要通關才會標記）。 */
function hasLiveFieldBoss() {
    var live = liveFieldEnemies();
    for (var i = 0; i < live.length; i++) if (live[i].isBoss) return true;
    return false;
}

/* ---- 波次串流下的關卡推進 ----
   出怪改成「每隔幾秒補一波、不等清場」之後，場上幾乎不會空，
   原本「整波清空才算過關」的判定永遠不會成立、關卡會卡住不動。
   改用擊殺數：每關要殺的隻數＝該關原本一波的隻數（同一張權重表擲骰），殺滿即過關。
   單關的產出與推進節奏因此維持不變，多出來的敵人是壓力，不是額外的關卡進度。
   配額綁在關卡編號上：推關、換地圖、死亡退關都會讓編號改變，計數自動重置。 */
function fieldStageQuota() {
    if (FIELD.quotaStage !== G.stage.current || !(FIELD.stageQuota > 0)) {
        FIELD.quotaStage = G.stage.current;
        FIELD.stageKills = 0;
        var s = G.stage.current;
        var isBoss = isFieldBossStage(s) && !isFieldBossDefeated(G.stage.zone, s);
        var isElite = !isBoss && isEliteStage(s);
        FIELD.stageQuota = Math.max(1, rollFieldEnemyCount(
            isBoss ? 'boss' : (isElite ? 'elite' : 'normal'), s, G.stage.zone || 'desert'));
    }
    return FIELD.stageQuota;
}

/* append=true：波次串流補怪——保留場上既有敵人與站位，只把新的一波填進空格。
   不帶參數＝原本的「整批換波」行為（死亡重來、測試直接呼叫）。
   回傳這一波實際站上棋盤的敵人（沒有空位時回傳空陣列）。 */
function spawnFieldMonster(append) {
    if (FIELD.mapComplete) return [];
    if (!append) FIELD._waveClearPending = false;
    var s = G.stage.current;
    /* 野外 BOSS 規則 → formula.js §4（優先於菁英）；每個 BOSS 只能打一次，
       該關通關後 BOSS 不再出現（isFieldBossDefeated → data.js），退回菁英規則。 */
    var boss = isFieldBossStage(s) && !isFieldBossDefeated(G.stage.zone, s);
    var elite = !boss && isEliteStage(s); // 菁英規則 → formula.js §4（打過的 BOSS 階由此接手）
    var base = monsterStatsFor(s, elite, boss);
    var zn = currentZoneDef();
    // 數量依敵種各自擲骰（小怪／菁英／BOSS 三張權重表 → data.js）
    var count = rollFieldEnemyCount(boss ? 'boss' : (elite ? 'elite' : 'normal'), s, G.stage.zone || 'desert');
    /* 串流補波：一次最多只能生「棋盤剩幾格」那麼多隻，超過的在配格時會被丟掉，
       白白吃掉浮字序號與掉落擲骰。屍體不佔格（它們只是還在播淡出）。 */
    var standing = append ? liveFieldEnemies() : [];
    if (append) {
        var cellsEach = boss
            ? Math.max(1, Number(typeof BF_BOSS_W !== 'undefined' ? BF_BOSS_W : 2) || 1) *
              Math.max(1, Number(typeof BF_BOSS_H !== 'undefined' ? BF_BOSS_H : 2) || 1)
            : 1;
        var free = (typeof bfFreeCellCount === 'function') ? bfFreeCellCount(standing) : count;
        /* 同時上限（參數表可逐地圖／關卡調）：清不完的怪會一直堆，沒有煞車的話
           新角色前幾關就會被打死到推不動。棋盤格數是另一道硬上限。 */
        var room = fieldMaxLiveEnemiesFor(s, G.stage.zone) - standing.length;
        count = Math.min(count, room, Math.floor(free / cellsEach));
        if (count < 1) return [];   // 場上滿了：這一波跳過，下一個間隔再試
    }
    var enemies = [];
    for (var i = 0; i < count; i++) {
        var enemyTable = zn.enemyTable || [];
        var enemyPairs = enemyTable.map(function (entry) {
            return [NPC_CONFIG_TABLE && NPC_CONFIG_TABLE[entry.npcId], Number(entry.weight) || 0];
        }).filter(function (pair) { return pair[0] && pair[1] > 0; });
        var mtype = enemyPairs.length ? wpick(enemyPairs) : pick(zn.pool);
        var hpMult = Number(mtype.hpMult) > 0 ? Number(mtype.hpMult) : 1;
        var atkMult = Number(mtype.atkMult) > 0 ? Number(mtype.atkMult) : 1;
        var defMult = Number(mtype.defMult) > 0 ? Number(mtype.defMult) : 1;
        var npcAspdMult = Number(mtype.aspdMult) > 0 ? Number(mtype.aspdMult) : 1;
        var mAspd = base.aspd * zn.aspdMult * npcAspdMult; // 攻速 × 場景攻速倍率 × NPC 倍率
        enemies.push({
            // 名稱一律用 NPC 原名，不加「菁英・」前綴；階級改由圖示、名稱顏色與血條樣式表示。
            name: mtype.name, emoji: mtype.emoji, npcId: mtype.id || null, appearance: mtype.appearance || mtype.emoji || '',
            level: base.level,
            maxHp: base.hp * zn.hpMult * hpMult, hp: base.hp * zn.hpMult * hpMult,
            atk: base.atk * zn.atkMult * atkMult,
            def: base.def * zn.defMult * defMult, mdef: base.mdef * zn.defMult * defMult,
            magic: !!mtype.magic,          // 魔法系怪物：攻擊對玩家魔防
            attr: mtype.attr || null,      // 屬性標籤（六大屬性；對X屬性傷害加成與 tips 顯示）
            aspd: mAspd, dodge: base.dodge, hit: base.hit, // 命中率隨敵人等級成長 → formula.js §4
            elite: elite, isBoss: boss,
            gold: base.gold * zn.rewardMult, xp: base.xp * zn.rewardMult, // 金幣/經驗 x場景倍率
            atkCd: 1 / mAspd, effects: {}, ctrlRes: 0, _spawnAt: GT, // 控場遞減計時起點 → formula.js §3
            /* 進場倒數：走進畫面前不可攻擊也不可被攻擊（→ fieldCombatReady）。
               同一波逐隻錯開，避免整排同時抵達。 */
            _enterCd: FIELD_ENEMY_ENTER_DELAY + i * FIELD_ENEMY_ENTER_STAGGER,
            shield: 0, buffs: {}, dots: []
        });
    }
    // 站位：隨機配到 4×4 棋盤的空格（BOSS 佔 2×2）；棋盤放不下的敵人直接捨棄 → js/battlefield.js
    var placed = bfPlaceEnemies(enemies, standing);
    if (append) {
        // 串流補波：接在既有清單後面（含還在淡出的屍體），不動場上任何人的站位；
        // 也不清普攻鎖定——目標還活著，沒有理由因為旁邊來了新怪就改打別隻。
        FIELD.monsters = fieldEnemyList().concat(placed);
    } else {
        FIELD.monsters = placed;
        if (FIELD.player) FIELD.player._lockTarget = null; // 整批換波＝重新選目標，順便釋放上一波的實體參照
    }
    markFieldEnemyFloatTargets(FIELD.monsters);
    syncFieldPrimary();
    UI.dirty.battle = true;
    return placed;
}

/* 切換關卡／地圖之後，下一波要隔一段時間才出現——場上既有的敵人留著，
   新的一波不要在切換的瞬間憑空冒出來（設計要求：不突然出現、也不突然消失）。
   出怪只看 FIELD.spawnCd 一個計時器：一波出完就填「同關內間隔」（參數 a），
   切換關卡則填「換關間隔」（參數 b）。 */
function holdFieldSpawn(sec) {
    FIELD.spawnCd = Math.max(0, Number(sec) || 0);
}

/* 陣亡後場上的敵人不會立刻消失：定格 FIELD_DEATH_DESPAWN_DELAY 秒後整批移除，
   顯示層看到牠們從清單裡不見（且不是被打死）就會播淡出。 */
function tickFieldDeathDespawn(dt) {
    if (!(FIELD.despawnCd > 0)) return;
    FIELD.despawnCd -= dt;
    if (FIELD.despawnCd > 0) return;
    FIELD.despawnCd = 0;
    FIELD.monster = null;
    FIELD.monsters = [];
    if (FIELD.player) FIELD.player._lockTarget = null;
    UI.dirty.battle = true;
}

/* ---- 場景切換：各場景獨立保存進度與最高階段 ---- */
function switchZone(zoneKey) {
    if (!ZONES[zoneKey] || G.stage.zone === zoneKey) return;
    var zd = ZONES[zoneKey];
    if (!isZoneUnlocked(zoneKey)) return;
    if (zd.reqZone) {
        var cleared = zoneClearedStage(zd.reqZone);
        if (cleared < zd.reqStage) return;
    }
    // 保存目前場景進度（cleared 只住在 zoneProgress，整包覆寫時必須帶著走）
    if (!G.zoneProgress) G.zoneProgress = {};
    var fromKey = G.stage.zone || 'desert';
    var fromZp = G.zoneProgress[fromKey] || {};
    G.zoneProgress[fromKey] = { current: G.stage.current, best: G.stage.best, cleared: Math.max(0, Math.floor(Number(fromZp.cleared) || 0)) };
    // 載入目標場景進度
    var zp = G.zoneProgress[zoneKey] || { current: 1, best: 1 };
    G.stage.zone = zoneKey;
    G.stage.current = zp.current || 1;
    G.stage.best = zp.best || 1;
    G.stage.kills = 0;
    /* 場上既有的敵人留著，不因換圖而憑空消失（只有陣亡才會清場）。 */
    FIELD._waveClearPending = false;
    FIELD.mapComplete = false;
    holdFieldSpawn(FIELD_STAGE_SWITCH_DELAY);
    var zn = ZONES[zoneKey];
    blog(zn.emoji + ' 前往【' + zn.name + '】！第 ' + G.stage.current + ' 階段（歷史最高 ' + G.stage.best +
        (zn.rewardMult > 1 ? '，非裝備掉落 x' + zn.rewardMult : '') + '）', 'info');
    UI.dirty.battle = true;
}

/* 自動推進到下一張已解鎖且上限更高的地圖；順序以 ZONE_LIST 為準，
   讓場景配置與自動切圖共用同一份設計順序。 */
function nextAutoAdvanceZone(zoneKey) {
    if (typeof ZONE_LIST === 'undefined' || !Array.isArray(ZONE_LIST)) return null;
    var currentMax = zoneMaxStage(zoneKey);
    if (typeof zoneClearedStage === 'function' && zoneClearedStage(zoneKey) < currentMax) return null;
    var index = ZONE_LIST.indexOf(zoneKey);
    if (index < 0) return null;
    for (var i = index + 1; i < ZONE_LIST.length; i++) {
        var candidate = ZONE_LIST[i];
        if (zoneMaxStage(candidate) <= currentMax) continue;
        if (typeof isZoneUnlocked === 'function' && !isZoneUnlocked(candidate)) continue;
        return candidate;
    }
    return null;
}

/* 是否還有更後面的地圖配置。下一張可能因前置關卡或轉生條件尚未解鎖，
   但這不代表目前地圖已經是整個推圖流程的終點。 */
function hasConfiguredHigherZone(zoneKey) {
    if (typeof ZONE_LIST === 'undefined' || !Array.isArray(ZONE_LIST)) return false;
    var currentMax = zoneMaxStage(zoneKey);
    var index = ZONE_LIST.indexOf(zoneKey);
    if (index < 0) return false;
    for (var i = index + 1; i < ZONE_LIST.length; i++) {
        if (zoneMaxStage(ZONE_LIST[i]) > currentMax) return true;
    }
    return false;
}

/* ---- 持續型效果的低階寫入器（控場 / 持續傷害 / 增益減益） ----
   授權入口是 js/status.js 的 applyStatus（狀態表是唯一的狀態定義來源）；
   本節只負責「戰鬥規則」——控場遞減、BOSS 控制免疫、無敵免疫、同名取高——
   以及把實例寫進 effects／dots／buffs 三個索引。每筆實例都帶 sid 指回狀態表，
   舊呼叫點沒帶 sid 時由鍵值／名稱反查補上（statusIdByKey／statusIdByName）。 */

/* 攻擊頻率控制類套用「控場遞減」（controlDurationFactor → formula.js §3）；
   成功回傳實際持續秒數（供顯示），遞減歸零或 BOSS 免疫回傳 false。 */
function applyEffect(ent, key, dur) {
    if (key !== 'invuln' && effectActive(ent, 'invuln')) return false; // 無敵：免疫負面效果（暈眩/減速等）
    if (isBossControlImmune(ent) && isAttackFrequencyControlKey(key)) return false;
    if (typeof legendaryControlDuration === 'function') dur = legendaryControlDuration(ent, key, dur);
    if (isAttackFrequencyControlKey(key)) {
        dur *= controlDurationFactor(ent);
        if (dur <= 0) return false;
    }
    ent.effects[key] = GT + dur;
    return dur;
}
function effectActive(ent, key) { return (ent.effects[key] || 0) > GT; }
// 減速攻速倍率公式 slowFactor → js/formula.js §3

/* 中毒不再自成一套（原 poisonDps／poisonUntil 已移除）：它就是狀態表的 poison，
   與其他持續傷害走同一條 dots 索引、同一支 tickStatuses。 */
function applyPoison(ent, dps, dur) {
    return applyDot(ent, dps, dur, '中毒', 'poison');
}
function poisonActive(ent) { return statusActive(ent, 'poison'); }
// 直接扣血的持續傷害原本只更新 HP，沒有留下戰鬥日誌，導致敵人可能在沒有任何
// 傷害行的情況下死亡。只對敵方實體記錄，避免把玩家承受的 DoT 誤報成玩家輸出。
function logEnemyDirectDamage(ent, source, damage, killed) {
    if (!ent || !ent.maxHp || !(damage > 0) || typeof blog !== 'function') return;
    var target = ent.name || '敵人';
    var shown = typeof fmt === 'function' ? fmt(damage) : String(Math.round(damage));
    blog('☠️ ' + target + ' 受到' + (source || '直接傷害') + '，' + shown +
        ' 傷害' + (killed ? '（擊殺）' : '') + '。', 'log-player-skill', 'combat');
}
/* 淨化：只清除負面狀態（狀態表 kind＝debuff／ctrl），不誤傷自身增益。
   改造前是把 effects 整包清空，連潛力技能的「無敵」也會被自己的聖光淨化打掉。 */
function cleanse(ent) {
    if (!ent) return;
    var k;
    if (ent.effects) {
        for (k in ent.effects) {
            if (statusIsDebuff(statusIdByKey(k)) || k === 'stun' || k === 'slow') ent.effects[k] = 0;
        }
    }
    if (ent.buffs) {
        for (k in ent.buffs) {
            var cb = ent.buffs[k];
            if (cb && statusIsDebuff(cb.sid || statusIdByKey(k))) cb.until = 0;
        }
    }
    ent.dots = [];
}

/* ---- 增益 / 減益（技能系統用） ----
   攻速類減益同樣套用「控場遞減」；成功回傳實際持續秒數，歸零/免疫回傳 false。 */
function applyBuff(ent, key, val, dur, sid, stackCfg) {
    if ((key === 'atkDown' || key === 'defDown') && effectActive(ent, 'invuln')) return false; // 無敵：免疫敵方減益
    if (isBossControlImmune(ent) && isAttackFrequencyControlKey(key)) return false;
    if (isAttackFrequencyControlKey(key)) {
        dur *= controlDurationFactor(ent);
        if (dur <= 0) return false;
    }
    if (!ent.buffs) ent.buffs = {};
    var prev = ent.buffs[key];
    var st = stackStep(stackCfg, prev && prev.until > GT ? prev : null, val);
    // 45 新技能基建（buffExtend 族）：補存原始持續 dur 與累計延長 ext（累計延長 ≤ dur × BUFF_EXTEND_CAP_PCT%）；
    // 重新施放＝全新一筆，ext 歸零；既有讀取（val/until）不受影響。
    // sid＝狀態表 ID（未帶時由增益鍵反查），供 UI 取狀態圖標與名稱。
    // unit／stacks＝疊層規則用（單層值與層數；val 恆為 unit × stacks）。
    ent.buffs[key] = { val: st.value, until: GT + dur, dur: dur, ext: 0, sid: sid || statusIdByKey(key),
        unit: st.unit, stacks: st.stacks };
    return dur;
}
function buffVal(ent, key) {
    if (!ent || !ent.buffs) return 0;
    var b = ent.buffs[key];
    return (b && b.until > GT) ? b.val : 0;
}
function activeBuffKeys(ent) {
    var out = [];
    if (ent && ent.buffs) for (var k in ent.buffs) if (ent.buffs[k].until > GT) out.push(k);
    return out;
}

/* ---- 疊加規則（狀態表 stack 欄）----
   refresh   ＝ 後蓋前（增益的預設）
   strongest ＝ 單層值取高並重新計時（持續傷害的預設）
   stack     ＝ 單層值取高、層數 +1 至上限；實際效果值＝單層值 × 層數
   prev＝目前生效中的同一筆（沒有就傳 null）；回傳 { value, unit, stacks }。 */
function stackStep(cfg, prev, incoming) {
    var rule = (cfg && cfg.rule) || 'refresh';
    if (rule === 'stack') {
        var max = Math.max(1, Math.floor((cfg && cfg.max) || 1));
        var unit = prev ? Math.max(prev.unit || prev.val || prev.dps || 0, incoming) : incoming;
        var stacks = Math.min(max, (prev ? (prev.stacks || 1) : 0) + 1);
        return { value: unit * stacks, unit: unit, stacks: stacks };
    }
    if (rule === 'strongest' && prev) {
        var keep = Math.max(prev.unit || prev.val || prev.dps || 0, incoming);
        return { value: keep, unit: keep, stacks: 1 };
    }
    return { value: incoming, unit: incoming, stacks: 1 };
}

/* ---- 吸收護盾（狀態表 shield）----
   護盾量＝施法者最大生命 × pctOfMaxHp%，吃護盾效率並受技能護盾上限限制（→ formula.js §3）。
   取 max 而非累加：同一護盾技能重放只把護盾補回該比例，不疊高。
   granted 記在 ent.buffs.shield.val，到期時由 tickStatuses 回收「還沒被打掉的部分」。 */
function applyShield(ent, pctOfMaxHp, dur, sid, stats, stackCfg) {
    if (!ent || !(dur > 0)) return false;
    var maxHp = (stats && stats.hp) || ent.maxHp || 0;
    if (!(maxHp > 0) || !(pctOfMaxHp > 0)) return false;
    var before = Math.max(0, ent.shield || 0);
    var prev = ent.buffs && ent.buffs.shield && ent.buffs.shield.until > GT ? ent.buffs.shield : null;
    var step = stackStep(stackCfg, prev, pctOfMaxHp);
    var pct = step.value * (1 + ((stats && stats.shieldEff) || 0) / 100);
    var target = Math.min(maxHp * (pct / 100), maxHp * (SHIELD_SKILL_CAP_PCT / 100));
    ent.shield = Math.max(before, target);
    refreshShieldMaxAfterGain(ent, before);
    if (!ent.buffs) ent.buffs = {};
    ent.buffs.shield = { val: Math.max(0, ent.shield), until: GT + dur, dur: dur, ext: 0, sid: sid || 'shield',
        unit: step.unit, stacks: step.stacks };
    return dur;
}

/* ---- 持續傷害（流血/燃燒/中毒/詛咒…；疊加規則見 stackStep） ----
   dps＝每秒傷害；interval＝作用間隔（秒，來自狀態表；0＝不分段連續結算）。
   儲存採 dps 而非「每跳量」，既有的 DoT 引爆（剩餘總值＝dps×剩餘秒數）、轉移與延長
   機制才不必改算法；每跳實際傷害＝dps×interval，由 tickStatuses 結算。 */
function applyDot(ent, dps, dur, name, sid, interval, stackCfg) {
    if (effectActive(ent, 'invuln')) return; // 無敵：免疫持續傷害
    if (typeof legendaryInstantBurn === 'function') {
        var instantBurn = legendaryInstantBurn(ent, dps, dur, name);
        if (instantBurn !== null) return instantBurn;
    }
    sid = sid || statusIdByName(name);
    // 未指定間隔就吃狀態表；表上查不到（融合技隨機命名的 DoT）採連續結算，行為與改造前相同
    if (interval === undefined || interval === null) {
        var sdef = statusDef(sid);
        interval = sdef ? sdef.interval : 0;
    }
    if (stackCfg === undefined || stackCfg === null) {
        var sdef2 = statusDef(sid);
        stackCfg = sdef2 ? { rule: sdef2.stack, max: sdef2.maxStacks } : { rule: 'strongest' };
    }
    if (!ent.dots) ent.dots = [];
    for (var i = 0; i < ent.dots.length; i++) {
        if (ent.dots[i].name === name) {
            var cur = ent.dots[i];
            var step2 = stackStep(stackCfg, cur.until > GT ? cur : null, dps);
            cur.dps = step2.value;
            cur.unit = step2.unit;
            cur.stacks = step2.stacks;
            cur.until = GT + dur;
            // 45 新技能基建（buffExtend 族）：重新塗抹＝原始持續刷新、累計延長歸零
            cur.dur = dur;
            cur.ext = 0;
            cur.sid = sid;
            cur.interval = interval;
            return;
        }
    }
    // 45 新技能基建（buffExtend 族）：補存原始持續 dur 與累計延長 ext（延長上限依據）
    // acc＝距離下次作用已累積的秒數；unit／stacks＝疊層規則用
    var step3 = stackStep(stackCfg, null, dps);
    ent.dots.push({ dps: step3.value, until: GT + dur, name: name, dur: dur, ext: 0, sid: sid,
        interval: interval, acc: 0, unit: step3.unit, stacks: step3.stacks });
}
function hasDots(ent) {
    if (!ent || !ent.dots) return false;
    for (var i = 0; i < ent.dots.length; i++) if (ent.dots[i].until > GT) return true;
    return false;
}
/* 持續傷害結算：依各狀態的「作用間隔」分段跳傷；回傳是否致死。
   間隔 0＝連續結算。到期時把不足一次間隔的餘額補跳，總傷害維持 dps×持續時間
   （＝改造前的總量，只是改成一跳一跳給），本次改造對數值平衡因此是中性的。 */
function tickStatuses(ent, dt) {
    tickShieldExpiry(ent);
    if (effectActive(ent, 'invuln')) return false; // 無敵：持續傷害不生效
    if (!ent.dots || !ent.dots.length) return false;
    // 45 新技能（dotSynergy 族）：DoT 跳動加速——僅對敵方實體生效（以 maxHp 欄位辨識敵人；
    // 玩家實體無 maxHp，所受 DoT 不受影響）。dotHaste＝目標旗標（時戳自然過期）、
    // passiveDotHaste（蝕骨頻率）＝全域倍率；持續時間不變，跳得更密＝等效總傷提高。
    var dtEff = dt;
    if (ent.maxHp) {
        if ((ent._dotHasteUntil || 0) > GT && ent._dotHasteMult > 0) dtEff *= ent._dotHasteMult;
        var _dotTrig = (typeof getStats === 'function') ? getStats().skillTriggers : null;
        if (_dotTrig && _dotTrig.passiveDotHaste && _dotTrig.passiveDotHaste.mult > 0) {
            dtEff *= _dotTrig.passiveDotHaste.mult;
        }
    }
    var total = 0;
    var dotNames = [];
    var live = [];
    for (var i = 0; i < ent.dots.length; i++) {
        var d = ent.dots[i];
        var expired = !(d.until > GT);
        var seconds = 0; // 本幀實際結算的秒數
        if (expired) {
            // 到期：只補「存續期間已累積、還沒跳出來」的餘額，不多算本幀
            seconds = d.acc || 0;
            d.acc = 0;
        } else if (!(d.interval > 0)) {
            seconds = dtEff;                            // 不分段：連續結算
            d.acc = 0;
        } else {
            var elapsed = (d.acc || 0) + dtEff;
            while (elapsed >= d.interval) { seconds += d.interval; elapsed -= d.interval; }
            d.acc = elapsed;
        }
        if (seconds > 0 && d.dps > 0) {
            total += d.dps * seconds;
            if (d.name && dotNames.indexOf(d.name) < 0) dotNames.push(d.name);
        }
        if (!expired) live.push(d);
    }
    ent.dots = live;
    if (total > 0) {
        var legendaryDotMult = (ent.maxHp && typeof legendaryDotDamageMultiplier === 'function')
            ? legendaryDotDamageMultiplier(ent) : 1;
        var dotDealt = total * globalDamageMultiplierForEntity(ent) * legendaryDotMult;
        dotDealt = applyEnemyHpDamage(ent, dotDealt);
        // 單一狀態直接報狀態名（例：「受到中毒」），多個才合併報「持續傷害（流血、燃燒）」
        logEnemyDirectDamage(ent, dotNames.length === 1 ? dotNames[0]
            : '持續傷害' + (dotNames.length ? '（' + dotNames.join('、') + '）' : ''), dotDealt, ent.hp <= 0);
        // 45 新技能（echo 族）：dmgWindow「窗內玩家全部傷害」含你的 DoT 跳動——
        // 僅敵方實體計入（玩家所受 DoT 非玩家輸出，不計）
        if (ent.maxHp && typeof skillRtAccWindowDamage === 'function') skillRtAccWindowDamage(dotDealt);
        if (ent.hp <= 0) { ent.hp = 0; return true; }
    }
    return false;
}

/* 護盾到期：回收「當初給的量裡還沒被打掉的部分」。
   其他來源（岩甲、聖痕等）另外加上來的護盾若已被吸收，回收量會相應變少——
   與傳奇【聖盾】既有的回收寫法一致（js/legendary.js）。 */
function tickShieldExpiry(ent) {
    if (!ent || !ent.buffs || !ent.buffs.shield) return;
    var sb = ent.buffs.shield;
    if (sb.until > GT) return;
    var remove = Math.min(Math.max(0, ent.shield || 0), Math.max(0, sb.val || 0));
    delete ent.buffs.shield;
    if (remove <= 0) return;
    ent.shield = Math.max(0, (ent.shield || 0) - remove);
    if (ent.shield <= 0) { ent.shieldMax = 0; ent.shieldMaxVersion = SHIELD_MAX_VERSION; }
    if (typeof UI !== 'undefined' && UI.dirty) UI.dirty.battle = true;
}

function globalDamageMultiplierForEntity(ent) {
    var total = ent && ent.globalDmgRed || 0;
    if (ent === FIELD.player && typeof getStats === 'function') {
        var st = getStats();
        total = st.globalDmgRed || 0;
    }
    return globalDamageMultiplier(total);
}

/* ---- 共用攻擊流程 ----
   傷害結算總公式 resolveHit 與控制抵抗判定 resistCtrl → js/formula.js §3 */

/* ---- 攻防組態（pEnt 可帶入戰鬥實體以套用技能增益） ---- */
function playerAtkCfg(pEnt) {
    var st = getStats();
    var atkMul = 1 + buffVal(pEnt, 'atkUp') / 100;
    // 神鑄特效【神怒】：生命低於門檻時，造成的傷害提高
    if (pEnt && (st.passives.godWrath || 0) > 0 && pEnt.hp < st.hp * 0.3) {
        atkMul *= 1 + st.passives.godWrath / 100;
    }
    return {
        atk: st.atk * atkMul, matk: st.matk * atkMul, dmgType: 'both', level: st.level,
        critRate: st.critRate, critDmg: st.critDmg + buffVal(pEnt, 'critDmgUp'), hit: st.hit,
        sunder: st.passives.sunder || 0, pen: effectivePPen(st, pEnt), mPen: effectiveMPen(st, pEnt),
        trueDmgPct: st.passives.trueDmg || 0, elemAtk: st.elemAtk, elemDmgPct: st.elemDmgPct,
        elemDmgUp: (typeof legendaryElementDamageUp === 'function') ? legendaryElementDamageUp(st, pEnt) : st.elemDmgUp,
        globalDmgRed: st.globalDmgRed,
        annihilate: st.passives.annihilate || 0,
        eliteDmg: st.eliteDmg, bossDmg: st.bossDmg, normalDmg: st.normalDmg,
        totalDmgPct: (st.totalDmgPct || 0) + buffVal(pEnt, 'allDmgUp'), // 潛力【時空凝滯】：所有傷害提高
        dmgVsElem: st.dmgVsElem,
        isPlayer: true
    };
}
function playerDefCfg(pEnt) {
    var st = getStats();
    var defMul = 1 + buffVal(pEnt, 'defUp') / 100;
    return {
        def: st.def * defMul, mdef: st.mdef * defMul, level: st.level,
        dodge: st.evasion + buffVal(pEnt, 'evasionUp'),
        blockRate: st.blockRate + buffVal(pEnt, 'blockUp'), blockDmgRed: st.blockDmgRed,
        pRes: st.pRes, mRes: st.mRes, resist: st.resist, ctrlRes: st.resist.ctrl,
        // 韌性：控場持續時間縮短（ccFactor）＋ 控場機率與被爆擊機率折減（resistCtrl／resolveHit 暴擊段）
        ccFactor: (1 - st.tenacity / 100) * (1 - st.ccRed / 100),
        tenacity: st.tenacity,
        dmgRed: (st.passives.sanctuary || 0) + buffVal(pEnt, 'legendaryGuardRed') +
            buffVal(pEnt, 'legendaryLightShieldRed'),
        globalDmgRed: st.globalDmgRed, undying: st.passives.undying || 0,
        invuln: !!effectActive(pEnt, 'invuln'), // 潛力【絕對領域】／【不屈意志】無敵
        undyingGuard: (typeof potentialSkillActive === 'function' && potentialSkillActive('lastStandUndying')),
        undyingGuardCd: (typeof potentialUndyingCd === 'function' ? potentialUndyingCd() : 90),
        normalDmgRed: st.normalDmgRed, eliteDmgRed: st.eliteDmgRed, bossDmgRed: st.bossDmgRed, // 敵種傷害抗性 → formula.js §3
        resVsElem: st.resVsElem, // 對屬性敵人抗性（8 轉天賦）→ formula.js §3
        thornsPct: (st.passives.thorns || 0) + buffVal(pEnt, 'thornsUp'), maxHp: st.hp, isPlayer: true
    };
}
function monsterAtkCfg(m, mult) {
    mult = mult || 1;
    var ea = m.elemAtk || null;
    if (ea && mult !== 1) { // 狂暴/重擊倍率也要套用到元素傷害
        var scaled = {};
        for (var i = 0; i < ELEMENTS.length; i++) scaled[ELEMENTS[i]] = (ea[ELEMENTS[i]] || 0) * mult;
        ea = scaled;
    }
    return {
        atk: m.atk * mult * (1 - buffVal(m, 'atkDown') / 100),
        dmgType: m.magic ? 'magic' : 'phys', level: m.level,
        // 敵人爆擊：爆擊率依敵種（普通/菁英/BOSS）、爆傷共用，數值 → formula.js §4 ENEMY_CRIT_*
        critRate: enemyCritRateFor(m), critDmg: ENEMY_CRIT_DMG_PCT,
        hit: m.hit || MONSTER_DEFAULT_HIT, elemAtk: ea, globalDmgRed: m.globalDmgRed || 0,
        isElite: !!m.elite, isBoss: !!m.isBoss, // 攻擊者敵種：供玩家的敵種傷害抗性選值
        attr: m.attr || null // 攻擊者屬性標籤：供玩家的對屬性敵人抗性選值
    };
}
function monsterDefCfg(m) {
    var defMul = 1 - buffVal(m, 'defDown') / 100;
    return {
        def: m.def * defMul, mdef: (m.mdef || m.def * 0.75) * defMul, level: m.level, dodge: m.dodge || 0,
        resist: m.resist || {}, ctrlRes: m.ctrlRes || 0, maxHp: m.maxHp,
        isElite: !!m.elite, isBoss: !!m.isBoss, towerBoss: !!m.towerBoss, attr: m.attr || null, globalDmgRed: m.globalDmgRed || 0
    };
}

/* ---- 治療公式 healPlayer → js/formula.js §3 ----
   戰鬥端的回復（吸血／汲取／過關回復／吸魂）皆為非技能來源，一律以 { noShield: true } 呼叫，
   溢出不再轉護盾，因此不需要「溢出轉護盾」的浮動字提示（技能路徑用 skills.js 的
   showPlayerShieldGainAfterHeal）。 */

// 完整的一次玩家普攻（含連擊/暈眩/減速/吸血/吸魔/暗影汲取）
// 45 新技能基建：可選末參 opts（不影響既有呼叫、回傳值不變）——
//   forceCrit：該次攻擊必定暴擊（殺陣反射 M4 等引動攻擊用）；
//   noProc：不再觸發連擊/連擊數等後續追加攻擊（procCast 族引動的免費普攻防遞迴用）。
function doPlayerAttack(pEnt, mEnt, floatSel, depth, opts) {
    var st = getStats();
    var aCfg = playerAtkCfg(pEnt);
    // 45 新技能（periodicField 族）：領域內敵人受指定類型傷害增幅（普攻端；elemAtk 於函式內先淺拷貝防污染）
    if (typeof skillRtFieldAmpACfg === 'function') aCfg = skillRtFieldAmpACfg(aCfg, mEnt);
    if (opts && opts.forceCrit) aCfg.critRate = Math.max(100, aCfg.critRate || 0); // 必定暴擊
    /* 普攻特效（協議 v17）：不再原地出手——發射一道「劍氣」飛向目標，命中時的受擊反饋
       由顯示層（js/vfx.js）處理。浮字延遲與劍氣飛行共用同一個數字（比照技能 travelMs），
       追加攻擊（連擊／連擊數／引動攻擊）的第 N 波劍氣以 opts.vfxDelayMs 依序錯開。
       純顯示時序：傷害在本函式內當下結算完畢，戰鬥結果不受影響。 */
    var atkTravelMs = (typeof bfTravelSeconds === 'function') ? Math.round(bfTravelSeconds(mEnt) * 1000) : 0;
    var atkWaveDelayMs = (opts && opts.vfxDelayMs > 0) ? opts.vfxDelayMs : 0;
    var atkHitDelayMs = atkWaveDelayMs + atkTravelMs;
    if (typeof playCombatVfx === 'function') {
        playCombatVfx({
            fxKind: 'projectile', variant: 'swordwave', cat: 'basic', elem: null,
            glyph: '⚔️', color: '#e6ddc8',
            targets: [enemyEventFloatTarget(mEnt, floatSel)],
            travelMs: [atkTravelMs], delayMs: atkWaveDelayMs, dur: 0.5, count: 1
        });
    }
    var res = resolveHit(pEnt, mEnt, aCfg, monsterDefCfg(mEnt));
    var mName = mEnt.name || '怪物';
    var logMsg = (depth ? '' : '你攻擊 ' + mName + '，');
    var playerFloatSel = playerEventFloatTarget(floatSel);
    if (res.miss) {
        floatEnemyEvent(mEnt, floatSel, 'MISS', 'miss enemy-dodge', undefined, atkHitDelayMs);
        logMsg += (depth ? '<span class="log-hl-bad">攻擊被閃避了！</span>' : '<span class="log-hl-bad">被閃避了！</span>');
    } else {
        var dmgStr = fmt(res.dmg);
        if (res.crit) dmgStr = '爆擊 ' + dmgStr;
        if (res.blocked) dmgStr = '格擋 ' + dmgStr;
        floatEnemyEvent(mEnt, floatSel, dmgStr, combatDamageFloatClass('enemy-attack', res), res.dmg, atkHitDelayMs);
        trackDps(res.dmg);
        recordRunDamage('普攻', res.dmg);
        logMsg += (res.crit ? '<span class="log-hl-good">爆擊</span> ' : '造成 ') + fmt(res.dmg) + ' 傷害。';
        if (res.blocked) logMsg += '<span class="log-hl-bad">（被格擋）</span>';
        if (res.procs.length) logMsg += '<span class="log-hl-good">［' + res.procs.join('・') + '］</span>';
        if (res.thorns) logMsg += '<span class="log-hl-bad">遭到反震 ' + fmt(res.thorns) + ' 傷害。</span>';
        // 吸血 / 暗影汲取 / 吸魔（神鑄特效【萬象汲取】同時加成生命與法力回復）
        // 吸血/吸魔改由「每秒生命回復／法力恢復 × %」決定（formula.js §3），與造成的傷害無關；
        // 三者皆非技能效果，溢出不轉護盾（noShield）。
        var omni = st.passives.omniDrain || 0;
        var healAmt = lifestealHealAmount(st, st.lifesteal + omni) + (res.heal || 0);
        if (healAmt > 0) {
            healPlayer(pEnt, healAmt, st, { noShield: true });
            floatText(playerFloatSel, '+' + fmt(Math.round(healAmt)), 'heal', Math.round(healAmt));
            if (st.lifesteal > 0 || omni > 0 || res.heal) logMsg += '<span class="log-hl-good">汲取回復 ' + fmt(healAmt) + '。</span>';
        }
        // 大地元素特效【岩甲】：附加的地屬性傷害有機率轉為護盾（resolveHit 只回報數值，實際給盾在這裡）
        if (res.shield > 0) {
            var shieldGain = grantShield(pEnt, res.shield, st);
            if (shieldGain > 0) floatText(playerFloatSel, '🛡️+' + fmt(Math.round(shieldGain)), 'shield');
        }
        if (st.manaSteal + omni > 0) {
            var mpGain = manaStealAmount(st, st.manaSteal + omni);
            pEnt.mp = Math.min(st.mp, pEnt.mp + mpGain);
            floatText(playerFloatSel, '+' + fmt(Math.round(mpGain)) + ' MP', 'mp', Math.round(mpGain));
        }
        // 被動：暈眩 / 減速
        if (!res.killed) {
            if ((st.passives.stun || 0) > 0 && !isBossControlImmune(mEnt) && chance(st.passives.stun) && !resistCtrl(monsterDefCfg(mEnt))) {
                if (applyEffect(mEnt, 'stun', 1)) logMsg += '<span class="log-hl-good">將其擊暈！</span>'; // 控場遞減歸零時不誤報
            }
            if ((st.passives.slowHit || 0) > 0 && !isBossControlImmune(mEnt) && chance(st.passives.slowHit) && !resistCtrl(monsterDefCfg(mEnt))) {
                applyEffect(mEnt, 'slow', 3);
                logMsg += '<span class="log-hl-good">附加減速！</span>';
            }
            // 神鑄特效【天罰】：機率降下神雷，造成物理攻擊倍數的真實傷害（無視防禦）
            if ((st.passives.smite || 0) > 0 && chance(st.passives.smite)) {
                var smiteDmg = Math.max(1, Math.round(st.atk * 2.5));
                smiteDmg = applyEnemyHpDamage(mEnt, smiteDmg);
                trackDps(smiteDmg);
                recordRunDamage('天罰', smiteDmg);
                // 天罰特效：劍氣命中那一刻，一道神雷從天頂劈在目標身上
                if (typeof playCombatVfx === 'function') {
                    playCombatVfx({
                        fxKind: 'rain', variant: 'smite', elem: 'lightning', cat: 'basic',
                        glyph: '⚡', color: '#ffd93d',
                        targets: [enemyEventFloatTarget(mEnt, floatSel)],
                        travelMs: [0], delayMs: atkHitDelayMs, dur: 0.4, count: 1
                    });
                }
                floatEnemyEvent(mEnt, floatSel, '⚡' + fmt(smiteDmg), 'crit enemy-attack', smiteDmg, atkHitDelayMs + 90);
                logMsg += '<span class="log-hl-good">天罰降臨，追加 ' + fmt(smiteDmg) + ' 真實傷害！</span>';
                if (mEnt.hp <= 0) { mEnt.hp = 0; res.killed = true; res.dmg += smiteDmg; }
            }
        }
    }
    // 連擊（僅一層）；補刀擊殺必須回報給呼叫端（opts.noProc：引動攻擊不再觸發追加攻擊）
    // 追加攻擊的劍氣以固定間隔錯開（vfxDelayMs），看起來是一波接一波追出去的
    var atkWaveStepMs = 130;
    if (!res.killed && !depth && !(opts && opts.noProc) && (st.passives.doubleHit || 0) > 0 && chance(st.passives.doubleHit)) {
        var res2 = doPlayerAttack(pEnt, mEnt, floatSel, 1, { vfxDelayMs: atkWaveDelayMs + atkWaveStepMs });
        logMsg += ' <span class="log-hl-good">觸發連擊！</span>追加' + res2.logText;
        if (res2 && res2.killed) { res.killed = true; res.dmg += res2.dmg; }
    }
    // 連擊數（暴擊率破 100% 衍生）：主攻擊命中後追加整段普攻；僅主攻擊（depth 0）觸發，遞迴帶深度避免再觸連擊/連擊被動
    if (!depth && !(opts && opts.noProc) && !res.miss && !res.killed) {
        var comboN = rollComboHits(st);
        for (var cbi = 0; cbi < comboN && !res.killed; cbi++) {
            var resc = doPlayerAttack(pEnt, mEnt, floatSel, 1, { vfxDelayMs: atkWaveDelayMs + atkWaveStepMs * (cbi + 1) });
            if (resc) { res.dmg += resc.dmg; if (resc.killed) res.killed = true; }
        }
        if (comboN > 0) logMsg += ' <span class="log-hl-good">連擊數 ×' + comboN + '</span>';
    }
    // 45 新技能：普攻命中/擊殺觸發（僅主攻擊 depth 0 分發；追加攻擊遞迴不重複觸發）——
    // stackCharge source:'attackHit' 疊層（鬥氣輪轉，含暴擊 addCrit）；
    // passiveKillCd inclBasic（死神節拍 M8）：普攻擊殺也扣其他技冷卻（與技能擊殺共用 icd）
    if (!depth) {
        if (typeof legendaryOnBasicAttack === 'function') {
            var legendaryBasic = legendaryOnBasicAttack(pEnt, mEnt, res, floatSel, st);
            if (legendaryBasic) {
                res.dmg += legendaryBasic.dmg || 0;
                if (legendaryBasic.killed) res.killed = true;
                logMsg += ' <span class="log-hl-good">傳奇特效追加 ' + fmt(legendaryBasic.dmg || 0) + ' 傷害</span>';
            }
        }
        if (!res.miss && typeof skillRtChargeInput === 'function') {
            skillRtChargeInput('attackHit', res.crit ? 'crit' : 'hit');
        }
        // 45 新技能（echo 族）：dmgWindow 快照窗累計——普攻總傷害（含連擊/連擊數/天罰折入值）一次寫入
        if (!res.miss && typeof skillRtAccWindowDamage === 'function') {
            skillRtAccWindowDamage(res.dmg || 0);
        }
        if (res.killed && typeof skillRtOnKillTriggers === 'function') {
            skillRtOnKillTriggers(pEnt, null, null, 0, st);
        }
    }
    res.logText = logMsg;
    if (!depth) {
        blog('⚔️ ' + logMsg, 'log-player-attack', 'combat');
    }
    return res;
}

// 怪物攻擊玩家
var THORN_FLOAT_MAP = { 'pv-float': 'mv-float', 'tp-float': 'tb-float' };
function doMonsterAttack(mEnt, pEnt, floatSel, mult, skillName) {
    if (pEnt && pEnt._legendaryDoll && typeof legendaryMonsterAttackDoll === 'function') {
        return legendaryMonsterAttackDoll(mEnt, pEnt, floatSel, mult, skillName);
    }
    var dCfg = playerDefCfg(pEnt);
    var res = resolveHit(mEnt, pEnt, monsterAtkCfg(mEnt, mult), dCfg);
    var skillLabel = skillName ? ' 使用【' + skillName + '】' : '';
    var logMsg = (mEnt.name || '怪物') + skillLabel + (mult && mult > 1 ? ' <span class="log-hl-bad">重擊</span>你，' : ' 攻擊你，');
    var playerFloatSel = playerEventFloatTarget(floatSel);
    var hpDamage = 0;
    if (res.invuln) {
        floatPlayerEvent(playerFloatSel, '無敵!', 'defend');
        logMsg += '<span class="log-hl-good">你處於無敵狀態，免疫了傷害！</span>';
    } else if (res.miss) {
        floatPlayerEvent(playerFloatSel, '閃避!', 'dodge defend');
        logMsg += '<span class="log-hl-good">被你閃避了！</span>';
    } else {
        // 敵人爆擊（res.crit，敵種爆擊率 × (1-玩家韌性)）與重擊/狂暴倍率（mult>1）共用爆擊樣式；
        // 但只有 res.crit 是真正的爆擊，才標「爆擊」字樣。
        var isCrit = !!res.crit || !!(mult && mult > 1);
        var dmgStr = fmt(res.dmg);
        if (res.crit) dmgStr = '爆擊 ' + dmgStr;
        floatText(playerFloatSel, dmgStr, isCrit ? 'crit' : 'mdmg');
        // 我方受擊反饋（協議 v17）：爪痕閃過我方卡片＋卡片震動，由顯示層畫
        if (typeof playCombatVfx === 'function') {
            playCombatVfx({
                fxKind: 'impact', variant: 'claw', elem: null, cat: 'enemy',
                glyph: '💢', color: '#ff6b6b',
                targets: [playerFloatSel], travelMs: null, dur: 0.35, count: 1
            });
        }
        if (res.blocked) floatPlayerEvent(playerFloatSel, '格擋!', 'defend');
        hpDamage = Math.max(0, res.dmg - (res.absorbed || 0));
        logMsg += (res.crit ? '<span class="log-hl-bad">爆擊</span> ' : '造成 ') + fmt(res.dmg) + (mEnt.magic ? ' 魔法' : '') + ' 傷害。';
        if (res.blocked) logMsg += '<span class="log-hl-good">你格擋了部分傷害！</span>';
        if (res.absorbed) {
            floatPlayerEvent(playerFloatSel, '🛡️護盾吸收 ' + fmt(res.absorbed), 'shield');
            logMsg += '<span class="log-hl-good">生命減少 ' + fmt(hpDamage) + '，護盾吸收 ' + fmt(res.absorbed) + '。</span>';
        }
        if (res.procs.length) {
            res.procs.forEach(function (proc) {
                floatPlayerEvent(playerFloatSel, proc + '!', proc === '不朽' ? 'buff' : 'debuff');
            });
            logMsg += '<span class="log-hl-bad">［' + res.procs.join('・') + '］</span>';
        }
    }
    if (typeof legendaryOnPlayerDamaged === 'function') {
        legendaryOnPlayerDamaged(mEnt, pEnt, hpDamage, !!res.blocked, res, floatSel);
    }
    if (res.thorns) {
        floatEnemyEvent(mEnt, THORN_FLOAT_MAP[floatSel] || floatSel, '反傷 ' + fmt(res.thorns), 'defend');
        logMsg += '<span class="log-hl-good">並遭到荊棘反震 ' + fmt(res.thorns) + ' 傷害！</span>';
    }
    var cls = 'log-enemy-damage';
    if (mult && mult > 1) { cls = 'log-enemy-skill'; }
    if (skillName) { cls = 'log-enemy-skill'; }
    var hasDebuff = res.procs && res.procs.length > 0;
    if (hasDebuff) { cls = 'log-enemy-buff'; }
    var logCat = mEnt && mEnt.isBoss ? 'boss' : 'combat';
    blog('🛡️ ' + logMsg, cls, logCat);
    return res;
}

// 執行一次野外敵人攻擊。新波生成時也會走這個入口，讓首次攻擊不必等下一個 tick。
function fieldMonsterAttack(m, p) {
    if (!m || m.hp <= 0 || effectActive(m, 'stun')) return false;
    /* 打不到就不打。座標制改版前這裡沒有任何距離判定——站在戰場最遠端的敵人
       照樣打得到玩家，畫面上就是隔空互毆。魔法系是遠程，其餘要貼到近戰距離。 */
    if (typeof bfInAttackRange === 'function' && !bfInAttackRange(m)) return false;
    var attackTarget = (typeof legendaryChooseEnemyAttackTarget === 'function')
        ? legendaryChooseEnemyAttackTarget(p) : p;
    var mres = doMonsterAttack(m, attackTarget, 'pv-float');
    // 45 新技能：受擊觸發統一入口（野外；閃避/無敵不計，格擋計入並帶旗標；absorbed 供破盾判定）
    if (attackTarget === p && typeof onPlayerHitTaken === 'function' && mres && !mres.miss && !mres.invuln) {
        onPlayerHitTaken(mres.dmg || 0, !!mres.blocked, p, 'pv-float', mres.absorbed || 0);
    }
    // 潛力【時間結界】：敵攻速降低 → 拉長攻擊間隔（降低後攻速 = 原攻速/(1+降低%)）
    m.atkCd += (1 / m.aspd) * (1 + buffVal(m, 'enemyAspdDown') / 100);
    if (p.hp <= 0) { onPlayerFieldDeath(); return true; }
    if (m.hp <= 0) onFieldKill(m); // 反震擊殺
    return false;
}

function trackDps(dmg) {
    FIELD.dpsWindow.push([GT, dmg]);
    while (FIELD.dpsWindow.length && FIELD.dpsWindow[0][0] < GT - 10) FIELD.dpsWindow.shift();
}
function currentDps() {
    var sum = 0;
    for (var i = 0; i < FIELD.dpsWindow.length; i++) sum += FIELD.dpsWindow[i][1];
    var span = Math.min(10, Math.max(1, GT - (G._startGT || 0)));
    return sum / Math.min(10, span);
}

// Combat anomaly diagnostics: only log when two or more enemies die in one field tick.
function combatDebugFieldSnapshot(enemies) {
    var entries = [];
    for (var i = 0; i < (enemies || []).length; i++) {
        var ent = enemies[i];
        if (ent && ent.hp > 0) entries.push({ ent: ent, hp: ent.hp, damageHp: ent.hp });
    }
    return { entries: entries, reported: false };
}
function combatDebugAuditFieldDeaths(snapshot, phase) {
    if (!snapshot || snapshot.reported || typeof blog !== 'function') return;
    var dead = [];
    for (var i = 0; i < snapshot.entries.length; i++) {
        var item = snapshot.entries[i];
        if (item.ent && item.hp > 0 && item.ent.hp <= 0) {
            dead.push((item.ent.name || 'enemy') + ' ' + fmt(item.hp) + '->0');
        }
    }
    if (dead.length < 2) return;
    snapshot.reported = true;
    var stage = G && G.stage ? G.stage.current : '?';
    var alive = liveFieldEnemies().length;
    blog('DEBUG: stage ' + stage + ', same tick phase [' + phase + '] killed ' + dead.length +
        ' enemies: ' + dead.join(', ') + '; alive=' + alive, 'info', 'combat');
}
/* ---- 野外主迴圈 ---- */
function fieldTick(dt) {
    if (G.tower.active) return; // 高塔戰鬥期間野外暫停
    var st = getStats();
    if (!FIELD.player) initFieldPlayer();
    var p = FIELD.player;

    // 死亡復活
    if (FIELD.reviveCd > 0) {
        tickFieldDeathDespawn(dt);   // 陣亡定格中的敵人：時間到就整批淡出
        FIELD.reviveCd -= dt;
        if (FIELD.reviveCd <= 0) {
            p.hp = st.hp; p.mp = st.mp; p.shield = 0; p.shieldMax = 0; p.shieldMaxVersion = SHIELD_MAX_VERSION;
            cleanse(p);
            blog('💫 你已復活，繼續征途！', 'info');
            UI.dirty.battle = true;
        }
        return;
    }

    // 回復：每秒生命回復（基礎 BASE_HP_REGEN_PCT% + 生命恢復屬性；formula.js §3）+ 再生增益；法力恢復；技能冷卻
    // 生命回復本身不會溢出（Math.min 夾在生命上限），與改版後「回復不轉護盾」一致。
    var hot = buffVal(p, 'hot');
    if (p.hp < st.hp) p.hp = Math.min(st.hp, p.hp + (playerHpRegenPerSec(st) + st.hp * hot / 100) * dt);
    p.mp = Math.min(st.mp, p.mp + playerMpRegenPerSec(st) * dt);
    tickSkillCds(p, dt); // 潛力技能冷卻共用 skillCds（鍵 'potential:<id>'），一併在此遞減

    // 持續傷害（玩家：中毒 / 詛咒等）
    if (tickStatuses(p, dt)) { onPlayerFieldDeath(); return; }

    tickFieldDeathClears(dt);
    var arrivedEnemies = tickFieldEnterDelays(dt);   // 進場倒數：走到定位才加入戰鬥
    /* 我方移動：朝鎖定目標跑，進到近戰距離就停下來打（→ js/battlefield.js）。
       位移一律由模擬層產生，顯示層只負責畫。顯示層若自己讓角色跑，敵人的座標
       卻是模擬層算的，兩邊就會脫節——那正是「我方一動、整群敵人跟著平移」的成因。
       FIELD.playerPos 是 bfPlayerPos() 本人的參照（就地改寫），面板序列化時自然帶到最新值。 */
    if (typeof bfPlayerPos === 'function' && FIELD.playerPos !== bfPlayerPos()) FIELD.playerPos = bfPlayerPos();
    if (typeof bfTickPlayer === 'function') bfTickPlayer(fieldEnemyList(), dt, p._lockTarget);
    /* 逼近與推擠：敵人朝我方走、走到接觸距離就停，同伴之間互相推開。
       這是「要走到面前才打得到」的前提（→ js/battlefield.js 座標制）。
       回傳「本輪剛踏進攻擊距離」的敵人，牠們稍後會先出手（見下方首擊保證）。 */
    var reachedEnemies = (typeof bfTickApproach === 'function')
      ? bfTickApproach(fieldEnemyList(), dt) : [];
    var debugFieldTick = combatDebugFieldSnapshot(fieldEnemyList());

    // 45 新技能共用排程器（echo／periodicField／dmgWindow／healWindow／聖痕到期結算；tower.js 塔戰 tick 鏡射）——
    // 必須在「出怪」空場早退之「前」執行：整波清空到下一波出怪的間隙 GT 照常前進，若排程器停擺，
    // 領域補跳 while 迴圈會在新一波出怪的第一個 tick 把間隙內漏掉的每跳一次性全灌到新敵人身上（等效免費爆發）。
    // 空場時回響/領域跳傷/快照窗轟出自然落空（fizzle）、聖痕期滿仍照時給盾，行為與高塔恆有 BOSS 一致。
    if (typeof tickSkillSchedulers === 'function') {
        tickSkillSchedulers(dt, { pEnt: p, getEnemies: combatFieldEnemies, floatSel: 'mv-float', onDeaths: onFieldDeaths });
        combatDebugAuditFieldDeaths(debugFieldTick, 'skill scheduler');
    }
    if (typeof tickLegendaryEffects === 'function') {
        var legendaryTick = tickLegendaryEffects(dt, {
            pEnt: p,
            getEnemies: combatFieldEnemies,
            floatSel: 'mv-float',
            onDeaths: onFieldDeaths
        });
        combatDebugAuditFieldDeaths(debugFieldTick, 'legendary effects');
        if (legendaryTick && legendaryTick.playerKilled) { onPlayerFieldDeath(); return; }
    }

    /* 過關結算：改由「這一關殺滿配額」觸發（見 fieldStageQuota），不再等場上清空——
       波次串流之下場面幾乎不會空，等清空等於永遠不推進。 */
    if (FIELD._waveClearPending) completeFieldWave(st);

    /* 出怪：波次串流。每隔 fieldWaveIntervalFor（地圖 × 關卡，可調參數表）補一波，
       不管上一波清了沒——敵人會愈積愈多，撐不住被打死就退關（設計如此）。
       BOSS 還活著時不補波：BOSS 一關只有一隻，補下去會變成每幾秒多一隻 BOSS。
       新波在本輪繼續往下走，讓敵人能在生成當下完成首次攻擊。 */
    var spawnedEnemies = null;
    if (!FIELD.mapComplete && !hasLiveFieldBoss()) {
        FIELD.spawnCd = (typeof FIELD.spawnCd === 'number') ? FIELD.spawnCd - dt : 0;
        if (FIELD.spawnCd <= 0) {
            var added = spawnFieldMonster(true);
            FIELD.spawnCd = fieldWaveIntervalFor(G.stage.current, G.stage.zone);
            if (added && added.length) spawnedEnemies = added;
        }
    }
    /* 以下所有戰鬥行為都只認「已經走進畫面」的敵人（→ fieldCombatReady）：
       選目標、範圍展開、持續傷害、敵人出手全部排除進場中的那些。
       新怪不再於生成當輪先出手——牠這時還在螢幕外；改成走到定位當下把
       atkCd 歸零立刻補一擊（見 tickFieldEnterDelays），保證仍不會漏掉首擊。 */
    var enemies = combatFieldEnemies();
    if (!enemies.length) return;

    /* 首擊保證：剛走進攻擊距離（或剛結束進場）的敵人先出手一次，再輪到玩家。
       即使玩家隨後在同一輪把牠秒殺，這一擊也已經完成。
       少了這條，雙方射程相同又是玩家先動，高 DPS 玩家會永遠不吃傷害。 */
    var firstStrikers = (arrivedEnemies || []).concat(reachedEnemies || []);
    if (firstStrikers.length) {
        var struck = [];
        for (var ai = 0; ai < firstStrikers.length; ai++) {
            var fs = firstStrikers[ai];
            if (!fs || fs.hp <= 0 || struck.indexOf(fs) >= 0) continue;
            struck.push(fs);
            if (fieldMonsterAttack(fs, p)) return;
        }
        firstStrikers = struck;
        enemies = combatFieldEnemies();
        if (!enemies.length) return;
    }

    // 持續傷害（怪物：中毒 / 流血 / 燃燒 / 詛咒）
    for (var di = 0; di < enemies.length; di++) {
        if (tickStatuses(enemies[di], dt)) onFieldKill(enemies[di]);
    }
    combatDebugAuditFieldDeaths(debugFieldTick, 'poison/dots');
    enemies = combatFieldEnemies();
    if (!enemies.length) return;

    // 潛力【聖療逆轉】溢出傷害（持續效果，不受暈眩影響）
    var regenKilled = false;
    if (typeof tickPotentialRegen === 'function') {
        regenKilled = tickPotentialRegen(p, st, dt, enemies, 'mv-float');
        combatDebugAuditFieldDeaths(debugFieldTick, 'potential overheal damage');
        if (regenKilled) { onFieldDeaths(); enemies = combatFieldEnemies(); if (!enemies.length) return; }
    }
    // 潛力【雷霆過載】持續轟擊（增益期間依固定間隔一輪；持續效果，不受暈眩影響）
    if (typeof tickPotentialOverdrive === 'function') {
        var odRes = tickPotentialOverdrive(p, enemies, 'mv-float');
        combatDebugAuditFieldDeaths(debugFieldTick, 'potential overdrive');
        if (odRes && odRes.killed) { onFieldDeaths(); enemies = combatFieldEnemies(); if (!enemies.length) return; }
    }
    // 玩家行動（受減速時依減速比例放慢；時間扭曲等攻速增益加速）
    //（45 新技能共用排程器已上移至「出怪」空場檢查之前，避免波次間隙排程停擺）
    if (!effectActive(p, 'stun')) {
        // 技能優先（依裝載順序；含裝載的潛力技能）
        var sres = pickAndCastSkill(p, enemies, 'mv-float');
        combatDebugAuditFieldDeaths(debugFieldTick, 'skill cast');
        if (sres && sres.killed) {
            onFieldDeaths();
            enemies = combatFieldEnemies();
            if (!enemies.length) return;
        }
        if (p.hp <= 0) { onPlayerFieldDeath(); return; } // 狂暴打擊等自傷技能
        // 潛力【極速之力】：施放期間以倍率放大攻擊頻率（突破一般攻速上限）
        var playerAttackRate = slowFactor(p) * (1 + buffVal(p, 'aspdUp') / 100) *
            (typeof potentialVelocityFactor === 'function' ? potentialVelocityFactor(p, st) : 1) *
            (typeof legendaryAttackSpeedMultiplier === 'function' ? legendaryAttackSpeedMultiplier(p, st) : 1);
        p.atkCd -= dt * playerAttackRate;
        if (p.atkCd <= 0) {
            // 普攻打離我方最近的敵人（同距離隨機挑一個）；鎖定後直到該目標死亡才換 → js/battlefield.js
            var primary = bfPickPrimary(combatFieldEnemies(), p._lockTarget);
            /* 普攻是近戰：目標還沒走到面前就不出手，也不進入冷卻——
               等牠走進距離的那一刻立刻補上這一擊。
               （座標制改版前只挑「最近的」而完全不看距離，所以會隔空砍人） */
            var inReach = primary && (typeof bfPlayerCanReach !== 'function' || bfPlayerCanReach(primary));
            if (primary && inReach) {
                p.atkCd += 1 / st.aspd;
                p._lockTarget = primary;
                var res = doPlayerAttack(p, primary, primary.floatSel || 'mv-float');
                combatDebugAuditFieldDeaths(debugFieldTick, 'basic attack');
                if (res.killed) {
                    applyBasicAttackKillGap(p, playerAttackRate);
                    onFieldDeaths();
                }
                if (!combatFieldEnemies().length) return;
            }
        }
    }
    // 怪物攻擊
    enemies = combatFieldEnemies();
    for (var mi = 0; mi < enemies.length; mi++) {
        var m = enemies[mi];
        /* 本輪剛抵達的敵人已經在上面出過手，不要用同一個 dt 再算一次
           （高攻速敵人會同輪連攻兩下）。本輪剛「生成」的還在進場，
           combatFieldEnemies 已經篩掉，這裡一併防呆。 */
        if (firstStrikers.length && firstStrikers.indexOf(m) >= 0) continue;
        if (spawnedEnemies && spawnedEnemies.indexOf(m) >= 0) continue;
        if (!effectActive(m, 'stun')) {
            m.atkCd -= dt * slowFactor(m);
            if (m.atkCd <= 0 && fieldMonsterAttack(m, p)) return;
        }
    }
    combatDebugAuditFieldDeaths(debugFieldTick, 'enemy attack/thorns');
}

function completeFieldWave(st) {
    if (!FIELD._waveClearPending) return;
    FIELD._waveClearPending = false;
    /* 過關回復：整波敵人清空時回復 WAVE_CLEAR_HEAL_PCT% 最大生命。
       非技能來源，溢出直接捨棄不轉護盾（與每秒回復／吸血同一類）。

       綁在「清空整波」而不是「stage.current++」：自動推進關閉時關卡不會前進，
       綁在推進上會變成「關掉自動推進就永遠不回血」，那不是玩家預期的行為。
       高塔走另一條結算路徑，不經過這裡，維持零回復的爆發戰設計。 */
    if (FIELD.player) {
        healPlayer(FIELD.player, st.hp * WAVE_CLEAR_HEAL_PCT / 100, st, { noShield: true });
    }
    G.stage.kills++;
    if (window.recordLootBattle) window.recordLootBattle('field'); // 整波敵人清空 = 一場戰鬥
    var maxStage = zoneMaxStage(G.stage.zone);
    var nextStage = Math.min(G.stage.current + 1, maxStage);
    // 完成戰鬥即解鎖下一關；自動推進只控制目前是否立刻切換。
    G.stage.best = Math.max(Number(G.stage.best) || 1, nextStage);
    /* 已通關關卡另外記一筆：best 在最後一關會被 maxStage 夾住，光看 best 無法分辨
       「打贏最後一關」與「只打到倒數第二關」。任務的 stageClear 讀這一欄。 */
    markZoneCleared(G.stage.zone, G.stage.current);
    var switchedZone = false;
    if (G.stage.autoAdvance) {
        if (G.stage.current >= maxStage) {
            var nextZone = nextAutoAdvanceZone(G.stage.zone);
            if (nextZone) {
                blog('🏆 已通關【' + currentZoneDef().name + '】全部 ' + maxStage + ' 關！', 'good');
                switchZone(nextZone);
                switchedZone = true;
                blog('🚩 自動推進至【' + currentZoneDef().name + '】第 ' + G.stage.current + ' 關！', 'good');
            } else if (hasConfiguredHigherZone(G.stage.zone)) {
                /* 後續地圖存在但尚未解鎖（例如未達 11 轉）：留在地圖上限，
                   讓玩家繼續重打最後一關，而不是將整張地圖標成完成後停怪。 */
                G.stage.current = maxStage;
                G.stage.best = Math.max(G.stage.best || 1, maxStage);
                FIELD.mapComplete = false;
                blog('🔒 後續地圖尚未解鎖，暫留第 ' + maxStage + ' 關重複挑戰。', 'info');
            } else {
                G.stage.current = maxStage;
                G.stage.best = Math.max(G.stage.best || 1, maxStage);
                FIELD.mapComplete = true;
                FIELD.spawnCd = Infinity;
                blog('🏆 已通關【' + currentZoneDef().name + '】全部 ' + maxStage + ' 關！', 'good');
            }
        } else {
            G.stage.current++;
            if (G.stage.current > G.stage.best) G.stage.best = G.stage.current;
        }
        if (!switchedZone && !FIELD.mapComplete && G.stage.current < maxStage) {
            blog('🚩 推進至第 ' + G.stage.current + ' 階段！', 'good');
        }
    }
    /* 推進到下一關之後，下一波隔幾秒才出現（場上還沒打完的敵人照樣留著）。 */
    if (!FIELD.mapComplete) holdFieldSpawn(FIELD_STAGE_SWITCH_DELAY);
    /* 這一關的擊殺配額重新起算。自動推進關掉時關卡編號不變，
       只靠 fieldStageQuota 的關卡比對不會重置，必須在這裡明確歸零。 */
    FIELD.stageKills = 0;
    FIELD.quotaStage = null;
    UI.dirty.battle = true; UI.dirty.header = true;
}

function onFieldKill(m) {
    if (!m || m._rewarded) return;
    // 45 新技能（dotSynergy 族）：dotSplashOnKill（蝕骨頻率 M8）——敵人死亡時，
    // 其身上 DoT 剩餘的一部分濺射到隨機另一存活敵人（須在清理死亡實體前結算）
    if (typeof skillRtOnEnemyDeath === 'function') skillRtOnEnemyDeath(m, combatFieldEnemies());
    m.hp = 0;
    m._rewarded = true;
    // 普攻鎖定的目標死了就解鎖，下一次出手重新挑最近的（順便別把死掉的實體參照留在快照裡）
    if (FIELD.player && FIELD.player._lockTarget === m) FIELD.player._lockTarget = null;
    if (typeof legendaryOnEnemyKill === 'function') legendaryOnEnemyKill(FIELD.player);
    m._deathClearCd = FIELD_ENEMY_DEATH_CLEAR_DELAY;
    var st = getStats();
    /* 2026-08：擊殺回復（每殺一隻回 12%）已移除，改為整波清空回復一次
       （見 completeFieldWave 的 WAVE_CLEAR_HEAL_PCT）。 */
    // 吸魂（神鑄特效；非技能效果：溢出不轉護盾）
    if ((st.passives.soulEater || 0) > 0) {
        healPlayer(FIELD.player, st.hp * st.passives.soulEater / 100, st, { noShield: true });
    }
    var goldGain = Math.round(m.gold * (1 + st.goldBonus / 100));
    var xpGain = Math.round(m.xp * (1 + st.xpBonus / 100));
    G.player.gold += goldGain;
    gainXp(xpGain);
    // 技能熟練度經驗（2026-07-30）：擊殺給怪物經驗 × SKILL_MASTERY_XP_RATE%
    if (typeof gainSkillMasteryXp === 'function') gainSkillMasteryXp(Math.round(xpGain * SKILL_MASTERY_XP_RATE / 100));
    if (window.recordLootGold) window.recordLootGold(goldGain, 'field');
    if (window.recordLootKill) window.recordLootKill(undefined, 'field');

    var drops = rollFieldDrops(m);
    blog('💀 擊敗 ' + m.name, 'log-kill', 'combat');
    var lootMsg = '📦 戰利品：💰' + fmt(goldGain) + ' 💡' + fmt(xpGain);
    if (drops.length) lootMsg += ' ' + drops.join('、');
    blog(lootMsg, 'good', 'loot');
    // 進程一次性特規保底獎勵（30~33 級獨特、50~60 級史詩）；在 gainXp 之後呼叫，等級為最新。
    // 傳入被擊殺的怪物 m：窗口門檻看玩家等級，發放裝備等級看怪物等級。
    if (typeof specialGrantsOnKill === 'function') specialGrantsOnKill(m);
    var enemies = fieldEnemyList();
    FIELD.monsters = enemies;
    markFieldEnemyFloatTargets(enemies);
    syncFieldPrimary();
    /* 過關進度：波次串流之下不能再用「場上清空」判定（場面幾乎不會空），
       改成累計擊殺數達到本關配額。先讀一次配額，讓它在關卡剛換過時把計數歸零，
       否則這一刀的擊殺會被隨後的重置吃掉。 */
    var quota = fieldStageQuota();
    FIELD.stageKills = (Number(FIELD.stageKills) || 0) + 1;
    if (FIELD.stageKills >= quota) FIELD._waveClearPending = true;
    UI.dirty.battle = true; UI.dirty.header = true;
}

function onFieldDeaths() {
    var enemies = fieldEnemyList().slice();
    for (var i = 0; i < enemies.length; i++) {
        if (enemies[i].hp <= 0) onFieldKill(enemies[i]);
    }
}

function fieldDeathRetreatStage(currentStage) {
    return Math.max(1, (currentStage || 1) - FIELD_DEATH_STAGE_RETREAT);
}

function onPlayerFieldDeath() {
    // 45 新技能：死亡＝該場戰鬥結束——比照 finishTowerFight 清空 SKILL_RT 執行期狀態，
    // 避免死前入列的回響/領域/聖痕/快照窗（帶死前傷害快照）在復活後對退階新波次集中結算
    if (typeof resetSkillRT === 'function') resetSkillRT();
    var retreatStage = fieldDeathRetreatStage(G.stage.current);
    blog('☠️ 你被擊倒了…退回第 ' + retreatStage + ' 階段繼續挑戰（' + REVIVE_DELAY + ' 秒後復活）', 'bad');
    if (window.recordLootDeath) window.recordLootDeath('field');
    flushRunSummary(retreatStage);
    /* 場上的敵人不立刻消失：定格幾秒後才整批淡出（見 tickFieldDeathDespawn）。
       這是唯一會清場的情況——切關、換圖都不清。 */
    FIELD.despawnCd = FIELD_DEATH_DESPAWN_DELAY;
    FIELD._waveClearPending = false;
    FIELD.reviveCd = REVIVE_DELAY;
    G.stage.kills = 0;
    G.stage.current = retreatStage;
    UI.dirty.battle = true;
    UI.dirty.header = true;
}

/* ---- 掉落 ---- */
function rollFieldDrops(m) {
    var st = getStats();
    var s = G.stage.current;
    var lootBonus = st.loot + effectiveDropRateEffect(buffVal(FIELD.player, 'lootUp')); // 尋寶直覺增益已減半
    var drops = [];
    if (window.recordLootDrop) window.recordLootDrop('field');
    // 菁英掉落：裝備與材料都在一般基礎上乘 ELITE_DROP_MULT（→ formula.js §5，與離線收益共用）。
    var zoneDrop = fieldMaterialConfigFor(G.stage.zone, s);
    var rates = fieldDropRatesFor(s, m.level, G.stage.zone);
    // 敵種掉落倍率：BOSS ＞ 菁英 ＞ 普通（BOSS 倍率 → data.js FIELD_BOSS_DROP_MULT）
    var eliteDropMult = m.isBoss ? FIELD_BOSS_DROP_MULT : (m.elite ? ELITE_DROP_MULT : 1);
    var dropMult = (1 + lootBonus / 100) * eliteDropMult;
    for (var r = 0; r < rates.length; r++) {
        if (!rates[r]) continue;
        var n = rollDropCount(rates[r] * dropMult);
        for (var k = 0; k < n; k++) {
            var it = makeEquipment(s, { rarity: r });
            pushConveyor(it);
            if (window.recordLootEquip) window.recordLootEquip(r, 1, 'field');
            drops.push('裝備[' + rarityTag(it) + ']');
        }
    }
    // ===== 材料掉落：場景倍率由地圖表提供；>100% 依必掉+餘數規則
    //       基礎機率與寶石等級公式 → formula.js §5 =====
    var rw = currentZoneDef().rewardMult;
    // 寶石：依地圖／關卡區間查表，各階級獨立判定
    var gemRates = Array.isArray(zoneDrop.gemRates) ? zoneDrop.gemRates : [];
    for (var glv = 0; glv < gemRates.length; glv++) {
        if (!gemRates[glv]) continue;
        var gemN = rollDropCount(gemRates[glv] * (1 + lootBonus / 100) * rw * eliteDropMult);
        for (var gi = 0; gi < gemN; gi++) {
            var lv = glv + 1;
            var gtype = randomGemType();
            addGem(gtype, lv, 1);
            if (window.recordLootGem) window.recordLootGem(gtype, lv, 1, 'field');
            drops.push('💎' + gemLabel(gtype, lv));
        }
    }
    // 附魔書：基礎率由地圖／關卡掉落表提供
    if (s >= 8 || zoneDrop.bookRate !== undefined) {
        var bookBaseRate = Number(zoneDrop.bookRate || 0);
        var bookN = rollDropCount(bookBaseRate * (1 + lootBonus / 100) * rw * eliteDropMult);
        for (var bi = 0; bi < bookN; bi++) {
            var bk = pick(Object.keys(ENCHANTS));
            G.player.books[bk]++;
            if (window.recordLootMat) window.recordLootMat('book', 1, 'field');
            drops.push('📖' + ENCHANTS[bk].name + '書');
        }
    }
    // 太古精華：基礎機率由地圖／關卡掉落表提供，不受掉寶率與場景倍率影響。
    var ancientEssenceRate = Number(zoneDrop.ancientEssenceRate || 0) * eliteDropMult;
    if (ancientEssenceRate > 0 && chance(ancientEssenceRate)) {
        G.player.ancientEssence = (G.player.ancientEssence || 0) + 1;
        if (window.recordLootMat) window.recordLootMat('ancientEssence', 1, 'field');
        drops.push('<img src="images/icon_ancient_essence.png" class="res-icon" alt="太古精華">太古精華');
        UI.dirty.header = true;
    }
    // 魔塵（神鑄材料）：基礎機率由地圖／關卡掉落表提供。
    var dustRate = Number(zoneDrop.dustRate || 0) * eliteDropMult;
    if (dustRate > 0 && chance(dustRate)) {
        G.player.dust = (G.player.dust || 0) + 1;
        if (window.recordLootMat) window.recordLootMat('dust', 1, 'field');
        drops.push('💫魔塵');
        blog('💫 敵人掉落神鑄材料：魔塵 x1（持有 ' + fmt(G.player.dust) + '）', 'loot', 'loot');
        UI.dirty.forge = true;
    }
    return drops;
}

/* ---- 手動階段控制 ---- */
function stageGo(delta) {
    var t = G.stage.current + delta;
    if (t < 1 || t > Math.min(G.stage.best, zoneMaxStage(G.stage.zone))) return;
    G.stage.current = t;
    G.stage.kills = 0;
    /* 手動切關同樣不清場：已經出現的敵人打完為止。 */
    FIELD._waveClearPending = false;
    FIELD.mapComplete = false;
    holdFieldSpawn(FIELD_STAGE_SWITCH_DELAY);
    UI.dirty.battle = true;
}
function stageGoMax() {
    var target = Math.min(G.stage.best, zoneMaxStage(G.stage.zone));
    stageGo(target - G.stage.current);
}
/* ---- 塔戰相關邏輯省略 ---- */

window.RUN_STATS = { runCount: 1, maxStage: 1, skills: {} };
function recordRunDamage(skillName, dmg, statKey, skillLevel) {
    var key = statKey || skillName;
    if (!RUN_STATS.skills[key]) {
        RUN_STATS.skills[key] = { count: 0, damage: 0 };
    }
    var stat = RUN_STATS.skills[key];
    // Keep the display metadata on the bucket so same-name skills remain independent.
    if (!stat.name) stat.name = skillName;
    if (typeof skillLevel === 'number') stat.level = skillLevel;
    stat.count++;
    stat.damage += (dmg || 0);
    RUN_STATS.maxStage = Math.max(RUN_STATS.maxStage, G.stage.current);
}

function generateSummaryHtml(current) {
    var totalDmg = 0;
    var displayNames = {};
    var nameCounts = {};
    var nameSeen = {};
    for (var key in RUN_STATS.skills) {
        var stat = RUN_STATS.skills[key];
        totalDmg += stat.damage;
        if (typeof stat.level === 'number') {
            var rawName = stat.name || key;
            nameCounts[rawName] = (nameCounts[rawName] || 0) + 1;
        }
    }
    for (var key in RUN_STATS.skills) {
        var stat = RUN_STATS.skills[key];
        var displayName = key;
        if (typeof stat.level === 'number') {
            var rawName = stat.name || key;
            displayName = rawName + '(' + stat.level + '級)';
            if (nameCounts[rawName] > 1) {
                nameSeen[rawName] = (nameSeen[rawName] || 0) + 1;
                displayName += nameSeen[rawName];
            }
        }
        displayNames[key] = displayName;
    }
    if (totalDmg === 0) return '';
    var html = '<div class="summary-card"' + (current ? ' data-summary-current="true"' : '') + '>';
    html += '<div class="summary-card-title">------------' + (current ? '目前戰鬥（即時統計）' : '第 ' + RUN_STATS.runCount + ' 場戰鬥') + '--------------</div>';
    html += '<div class="summary-card-row"><span style="color:var(--accent)">最高關數</span>：' + RUN_STATS.maxStage + '</div>';
    var skillList = [];
    for (var k in RUN_STATS.skills) {
        var sk = RUN_STATS.skills[k];
        skillList.push({
            name: displayNames[k] || k,
            count: sk.count,
            damage: sk.damage
        });
    }
    skillList.sort(function (a, b) {
        return b.damage - a.damage;
    });

    for (var i = 0; i < skillList.length; i++) {
        var item = skillList[i];
        var pct = totalDmg > 0 ? (item.damage / totalDmg * 100).toFixed(1) : 0;
        html += '<div class="summary-card-row"><span style="color:var(--accent)">' + item.name + '</span>：' + fmt(item.count) + '次，傷害 ' + fmt(item.damage) + ' (' + pct + '%)</div>';
    }
    html += '</div>';
    return html;
}

function flushRunSummary(nextMaxStage) {
    var list = $id('battle-summary-list');
    if (list) {
        var current = list.querySelector('[data-summary-current]');
        if (current) current.remove();
    }
    var html = generateSummaryHtml();
    if (list && html) {
        var d = document.createElement('div');
        d.innerHTML = html;
        list.insertBefore(d.firstChild, list.firstChild);
    }
    RUN_STATS.runCount++;
    RUN_STATS.maxStage = Math.max(1, nextMaxStage || (G.stage.current > 1 ? 1 : G.stage.current));
    RUN_STATS.skills = {};
}

/* ---- 玩家技能增益取得 ---- */
var PLAYER_BUFF_ORDER = ['atkUp', 'defUp', 'aspdUp', 'evasionUp', 'critDmgUp', 'blockUp', 'thornsUp', 'lootUp', 'hot',
    // 潛力技能增益（極速之力/雷霆過載/時間坍縮/聖療逆轉/時空凝滯）
    'velocitySurge', 'lightningOverload', 'chronoCdr', 'sacredInvert', 'allDmgUp'];

function activePlayerBuffs(ent) {
    if (!ent) return [];
    var list = [];
    if (ent.buffs) {
        for (var i = 0; i < PLAYER_BUFF_ORDER.length; i++) {
            var key = PLAYER_BUFF_ORDER[i];
            var b = ent.buffs[key];
            if (b && typeof b.until === 'number' && b.until > GT) {
                list.push({
                    key: key,
                    val: b.val || 0,
                    remain: Math.ceil(b.until - GT)
                });
            }
        }
    }
    // 無敵（絕對領域／不屈意志）存於 effects.invuln 時戳而非 buffs，補列為無數值狀態
    if (ent.effects && typeof ent.effects.invuln === 'number' && ent.effects.invuln > GT) {
        list.push({ key: 'invuln', val: 0, noVal: true, remain: Math.ceil(ent.effects.invuln - GT) });
    }
    return list;
}
