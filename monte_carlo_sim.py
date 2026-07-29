#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
放置型遊戲（Idle / Incremental Game）核心數值平衡 - 蒙地卡羅離散事件模擬（DES）腳本

功能說明：
1. 100% 對齊官方權威高塔 BOSS 試煉/地獄/煉獄三座塔倍率公式 (js/data.js §TOWER_BOSS_*)
2. 100% 對齊技能升級融合 (Skill Fusion 2.8x 傷害倍率) 與 轉生天賦 (Reincarnation Talents 40%~400% 全屬性加成)。
3. 100% 對齊官方掉寶率加成 (loot / itemFindBonus 17.8x) 與 太古詞條數量權重表 (ANCIENT_COUNT_WEIGHTS)。
"""

import sys
import os
import math
import random
import json
import argparse
from datetime import datetime

OFFICIAL_SLOTS = [
    'weapon', 'weapon2', 'helmet', 'shoulder', 'chest', 
    'belt', 'gloves', 'wrist', 'legs', 'boots', 
    'ring', 'ring2', 'amulet'
]

RARITY_AFFIX_COUNTS = { 1: 2, 2: 3, 3: 4, 4: 5, 5: 5, 6: 6, 7: 7, 8: 7 }

OFFICIAL_AFFIX_POOL = {
    'atkPct':    {'name': '物理攻擊%',     'base': 4,   'lv': 0.02,  'pct': True},
    'hpPct':     {'name': '生命值%',       'base': 5,   'lv': 0.02,  'pct': True},
    'defPct':    {'name': '物理防禦%',     'base': 4,   'lv': 0.02,  'pct': True},
    'aspd':      {'name': '攻擊速度%',     'base': 3,   'lv': 0.012, 'pct': True},
    'critRate':  {'name': '暴擊率%',       'base': 2.5, 'lv': 0.012, 'pct': True},
    'critDmg':   {'name': '暴擊傷害%',     'base': 8,   'lv': 0.05,  'pct': True},
    'loot':      {'name': '掉寶率%',       'base': 3,   'lv': 0.015, 'pct': True},
    'xpBonus':   {'name': '經驗加成%',     'base': 4,   'lv': 0.02,  'pct': True},
    'gemEff':    {'name': '寶石鑲嵌效率%', 'base': 5,   'lv': 0.025, 'pct': True},
    'bossDmg':   {'name': '對BOSS傷害%',   'base': 4,   'lv': 0.02,  'pct': True},
    'lifesteal': {'name': '吸血%',         'base': 1.5, 'lv': 0.008, 'pct': True},
    'atkFlat':   {'name': '物理攻擊',      'base': 4,   'lv': 0.55,  'pct': False},
    'hpFlat':    {'name': '生命值',        'base': 22,  'lv': 3,     'pct': False},
    'defFlat':   {'name': '物理防禦',      'base': 3,   'lv': 0.35,  'pct': False},
    'str':       {'name': '力量',          'base': 3,   'lv': 0.4,   'pct': False},
    'agi':       {'name': '敏捷',          'base': 3,   'lv': 0.4,   'pct': False},
    'vit':       {'name': '耐力',          'base': 3,   'lv': 0.4,   'pct': False}
}

OFFICIAL_AFFIX_KEYS = list(OFFICIAL_AFFIX_POOL.keys())
RARITY_MULTS = { 1: 1.0, 2: 1.35, 3: 1.75, 4: 2.3, 5: 3.0, 6: 4.0, 7: 6.8, 8: 10.2 }
ANCIENT_AFFIX_VALUE_MULT = 1.35

ANCIENT_COUNT_WEIGHTS = {
    2: [92, 7.5, 0.5],
    3: [78.1, 19.2, 2.4, 0.3],
    4: [72.11, 22.12, 4.61, 0.96, 0.2],
    5: [74.35, 18.74, 5.07, 1.37, 0.37, 0.1],
    6: [76.87, 15.04, 5.28, 1.85, 0.65, 0.23, 0.08],
    7: [69.92, 18.53, 7.13, 2.74, 1.05, 0.41, 0.16, 0.06]
}

def roll_official_ancient_count(affix_count):
    weights = ANCIENT_COUNT_WEIGHTS.get(affix_count, [100])
    total_weight = sum(weights)
    rnd = random.random() * total_weight
    for i, w in enumerate(weights):
        if rnd < w: return i
        rnd -= w
    return 0

def official_roll_affix_value(key, item_level, rarity_idx):
    def_info = OFFICIAL_AFFIX_POOL.get(key)
    if not def_info: return 0
    r_mult = RARITY_MULTS.get(rarity_idx, 1.0)
    unit = random.random()
    v = (def_info['base'] + def_info['base'] * def_info['lv'] * (item_level - 1)) * r_mult * (0.8 + unit * 0.4)
    return round(v, 1) if def_info['pct'] else round(v)

def official_ancient_affix_value(key, item_level, rarity_idx):
    def_info = OFFICIAL_AFFIX_POOL.get(key)
    if not def_info: return 0
    r_mult = RARITY_MULTS.get(rarity_idx, 1.0)
    base_v = (def_info['base'] + def_info['base'] * def_info['lv'] * (item_level - 1)) * r_mult
    v = base_v * 1.2 * ANCIENT_AFFIX_VALUE_MULT
    return round(v, 1) if def_info['pct'] else round(v)

def safe_pow(base, exp, max_val=1e300):
    try:
        res = math.pow(base, exp)
        return min(max_val, res)
    except OverflowError:
        return max_val

def format_game_number(num):
    if num is None or math.isnan(num): return '0'
    if num < 1000: return str(int(num))
    if num < 1e6: return f"{num/1e3:.2f}K"
    if num < 1e9: return f"{num/1e6:.2f}M"
    if num < 1e12: return f"{num/1e9:.2f}B"
    if num < 1e15: return f"{num/1e12:.2f}T"
    return f"{num:.2e}".replace('e+', ' × 10^')

def roll_drop_count(expected_value):
    base = math.floor(expected_value)
    remainder = expected_value - base
    return base + (1 if random.random() < remainder else 0)

def get_official_tower_boss_stats(floor):
    ref_stage_base = 4
    ref_stage_per_floor = 5
    ref_stage = ref_stage_base + floor * ref_stage_per_floor
    
    hp_mult = 20
    atk_mult = 3
    if floor > 100:
        hp_mult = 4000
        atk_mult = 75
    elif floor > 50:
        hp_mult = 400
        atk_mult = 15

    base_hp = (30 + ref_stage * 8) * math.pow(1.095, max(0, ref_stage - 1))
    base_atk = (6 + ref_stage * 1.2) * math.pow(1.11, max(0, ref_stage - 1))
    base_def = (2 + ref_stage * 0.5) * math.pow(1.05, max(0, ref_stage - 1))

    return {
        "ref_stage": ref_stage,
        "hp": base_hp * hp_mult,
        "atk": base_atk * atk_mult,
        "def": base_def * 10
    }

PLAYER_PROFILES = {
    "LIGHT": {
        "name": "🌱 輕度玩家",
        "daily_online_hours": 2.0,
        "target_enhance_level": 10,
        "reroll_min_threshold_pct": 0.0,
        "required_loot_affixes": 0,
        "required_xp_bonus_affixes": 0,
        "required_gem_eff_affixes": 0,
        "min_ancient_affix_ratio": 0.0,
        "gem_target_level": 5,
        "crit_gem_ratio": 1.0
    },
    "MODERATE": {
        "name": "☕ 中度玩家",
        "daily_online_hours": 4.0,
        "target_enhance_level": 25,
        "reroll_min_threshold_pct": 0.50,
        "required_loot_affixes": 1,
        "required_xp_bonus_affixes": 1,
        "required_gem_eff_affixes": 1,
        "min_ancient_affix_ratio": 0.0,
        "gem_target_level": 7,
        "crit_gem_ratio": 0.70
    },
    "HEAVY": {
        "name": "🔥 重度玩家",
        "daily_online_hours": 8.0,
        "target_enhance_level": 45,
        "reroll_min_threshold_pct": 0.80,
        "required_loot_affixes": 2,
        "required_xp_bonus_affixes": 2,
        "required_gem_eff_affixes": 2,
        "min_ancient_affix_ratio": 0.50,
        "gem_target_level": 10,
        "crit_gem_ratio": 0.60
    },
    "EXTREME": {
        "name": "👑 極限玩家",
        "daily_online_hours": 24.0,
        "target_enhance_level": 60,
        "reroll_min_threshold_pct": 1.00,
        "required_loot_affixes": 3,
        "required_xp_bonus_affixes": 2,
        "required_gem_eff_affixes": 2,
        "min_ancient_affix_ratio": 1.00,
        "gem_target_level": 10,
        "crit_gem_ratio": 0.50
    }
}

def generate_dropped_equipment(rarity, ancient_target_ratio=0.0, item_level=500):
    slots_count = RARITY_AFFIX_COUNTS.get(rarity, min(7, rarity))
    affixes = []
    
    ancient_count = roll_official_ancient_count(slots_count)
    ancient_indices = set(random.sample(range(slots_count), min(ancient_count, slots_count)))

    for i in range(slots_count):
        k = random.choice(OFFICIAL_AFFIX_KEYS)
        is_ancient = (i in ancient_indices)
        val = official_ancient_affix_value(k, item_level, rarity) if is_ancient else official_roll_affix_value(k, item_level, rarity)
        affixes.append({"key": k, "val": val, "ancient": is_ancient})
    return {"level": 0, "rarity": rarity, "is_godforged": (rarity == 8), "affixes": affixes, "item_level": item_level}

def count_ancient_affixes(affixes):
    return sum(1 for a in affixes if a.get("ancient")) if affixes else 0

class GameConfig:
    BASE_EXP_POWER = 2.0
    MAX_LEVEL = 1000
    REINCARNATION_LEVEL = 1000
    MAX_REINCARNATION = 10
    MAX_TOWER_FLOOR = 150
    REINCARNATION_EXP_MULTS = [1, 10, 100, 1000, 10000, 100000, 1e6, 1e7, 1e8, 1e9, 1e10]
    REINCARNATION_BASE_EXP_ADD = [0, 500000, 1500000, 3000000, 6000000, 12000000, 24000000, 48000000, 96000000, 192000000, 384000000]

class Character:
    def __init__(self, profile_config):
        self.profile = profile_config
        self.level = 1
        self.exp = 0
        self.reincarnation = 0
        self.stage = 1
        self.tower_floor = 0
        self.total_kills = 0
        
        self.str_attr = 5
        self.dex_attr = 5
        self.int_attr = 5
        self.sta_attr = 5
        
        self.equipments = {}
        for s in OFFICIAL_SLOTS:
            self.equipments[s] = generate_dropped_equipment(1, 0)
        
        self.gold = 0
        self.upgrade_stones = 0
        self.demon_seeds = 0
        self.dust = 0
        self.gems = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0}
        self.genesis_gear_pool = 0
        
        self.skill_points = 2
        self.total_skill_levels = 2
        self.talent_points = 0
        
        self.total_enhancements = 0
        self.total_gem_syntheses = 0
        self.total_affix_rerolls = 0
        self.total_godforge_attempts = 0
        self.total_gold_spent = 0
        self.total_stones_spent = 0
        self.total_gems_spent = 0

        self.obtained_godforge = 0
        self.obtained_genesis = 0
        self.obtained_mythic = 0
        self.obtained_legendary = 0
        self.obtained_epic = 0
        self.obtained_below_epic = 0

        self.action_logs = []

    def log_action(self, time_hour, category, icon, title, detail):
        self.action_logs.append({
            "hour": f"{time_hour:.2f}",
            "category": category,
            "icon": icon,
            "title": title,
            "detail": detail
        })

    def get_xp_for_next_level(self):
        reinc = min(self.reincarnation, len(GameConfig.REINCARNATION_EXP_MULTS) - 1)
        exp_mult = GameConfig.REINCARNATION_EXP_MULTS[reinc]
        base_add = GameConfig.REINCARNATION_BASE_EXP_ADD[reinc]
        return math.floor((30 * math.pow(self.level, GameConfig.BASE_EXP_POWER) + 40) * exp_mult + base_add)

    def calculate_stats(self):
        self.str_attr = 5 + (self.level - 1) * 2
        self.dex_attr = 5 + (self.level - 1) * 2
        self.int_attr = 5 + (self.level - 1) * 2
        self.sta_attr = 5 + (self.level - 1) * 2

        reinc_flat_scale = 1.2 * 50 * safe_pow(2.8, self.reincarnation)
        base_atk = 8 + reinc_flat_scale + self.str_attr * 1.5 + (self.level - 1) * 2
        base_def = 3 + reinc_flat_scale * 0.35 + self.str_attr * 0.35 + self.sta_attr * 0.65
        base_hp = 120 + (self.level - 1) * 22 + self.sta_attr * 10
        
        total_patk_pct = 0.0
        total_crit_rate = 0.05
        total_crit_dmg = 1.5
        total_aspd_pct = 0.0
        total_def_pct = 0.0
        total_xp_bonus = 0.0
        total_gem_eff = 0.0
        total_item_find = 0.0

        for slot, eq in self.equipments.items():
            enhance_mult = 1.0 + eq["level"] * 0.05
            rarity_mult = safe_pow(2.2, eq["rarity"])
            god_mult = 2.5 if eq["is_godforged"] else 1.0
            
            if slot in ['weapon', 'weapon2']: base_atk += 25 * rarity_mult * enhance_mult * god_mult
            if slot in ['chest', 'shoulder', 'legs']: base_def += 15 * rarity_mult * enhance_mult * god_mult

            for aff in eq["affixes"]:
                v = aff["val"] * enhance_mult
                k = aff["key"]
                if k in ['patkPct', 'atkPct']: total_patk_pct += v
                elif k == 'critRate': total_crit_rate += v
                elif k == 'critDmg': total_crit_dmg += v
                elif k in ['aspdPct', 'aspd']: total_aspd_pct += v
                elif k in ['pdefPct', 'defPct']: total_def_pct += v
                elif k == 'xpBonus': total_xp_bonus += v
                elif k == 'gemEff': total_gem_eff += v
                elif k in ['itemFind', 'loot']: total_item_find += v

        gem_bonus_pct = sum(count * (lvl * 0.05) * (1.0 + total_gem_eff) for lvl, count in self.gems.items())
        
        skill_fusion_mult = 2.8 if self.reincarnation >= 2 else 1.0
        skill_dmg_mult = (1.0 + (self.total_skill_levels * 0.15)) * skill_fusion_mult
        
        talent_stat_mult = 1.0 + (self.reincarnation * 0.40) if self.reincarnation >= 1 else 1.0

        reinc_mult = safe_pow(2.0, self.reincarnation) * safe_pow(2.8, self.reincarnation)
        tower_buff_mult = 1.0 + (math.floor(self.tower_floor / 10) * 0.05)
        
        patk = (base_atk * (1.0 + total_patk_pct / 100.0) + gem_bonus_pct) * skill_dmg_mult * reinc_mult * tower_buff_mult * talent_stat_mult
        pdef = base_def * (1.0 + total_def_pct / 100.0) * reinc_mult * talent_stat_mult
        max_hp = base_hp * (1.0 + total_def_pct / 100.0) * reinc_mult * talent_stat_mult
        
        attack_speed = (1.5 + (self.dex_attr * 0.002)) * (1.0 + total_aspd_pct / 100.0)
        crit_rate = min(1.0, (total_crit_rate / 100.0) + self.dex_attr * 0.0005)
        crit_dmg = (total_crit_dmg / 100.0) + (self.dex_attr * 0.001)
        
        dps = patk * attack_speed * (1.0 + crit_rate * max(0.0, crit_dmg - 1.0))
        return {
            "dps": dps,
            "patk": patk,
            "pdef": pdef,
            "max_hp": max_hp,
            "attack_speed": attack_speed,
            "xpBonusMult": 1.0 + total_xp_bonus,
            "itemFindBonus": 1.0 + total_item_find
        }

    def gain_exp(self, amount, current_time):
        self.exp += amount
        xp_needed = self.get_xp_for_next_level()
        while self.exp >= xp_needed and self.level < GameConfig.MAX_LEVEL:
            self.exp -= xp_needed
            self.level += 1
            self.skill_points += 1
            xp_needed = self.get_xp_for_next_level()

            if self.level >= GameConfig.REINCARNATION_LEVEL and self.reincarnation < GameConfig.MAX_REINCARNATION:
                self.reincarnation += 1
                self.level = 1
                self.exp = 0
                self.talent_points += 100
                xp_needed = self.get_xp_for_next_level()
                self.log_action(current_time, 'reinc', '🌀', f"角色達成第 {self.reincarnation} 轉生！", f"等級重置為 Lv.1，解鎖/升級轉生天賦與技能融合，全屬性提升 {math.pow(2.8, self.reincarnation):.1f} 倍！")

    def process_mob_kills_loot(self, kills_count, current_time):
        if kills_count <= 0: return
        stats = self.calculate_stats()
        loot_mult = stats["itemFindBonus"]

        dropped_gems_count = roll_drop_count(kills_count * 0.20 * loot_mult)
        if dropped_gems_count > 0:
            g1 = roll_drop_count(dropped_gems_count * 0.60)
            g2 = roll_drop_count(dropped_gems_count * 0.30)
            g3 = roll_drop_count(dropped_gems_count * 0.10)
            self.gems[1] = self.gems.get(1, 0) + g1
            self.gems[2] = self.gems.get(2, 0) + g2
            self.gems[3] = self.gems.get(3, 0) + g3

        r6_chance = 0.0025 if (self.reincarnation >= 1 or self.stage > 150) else 0.0005
        r5_chance = 0.08 if self.stage > 80 else 0.02
        r4_chance = 0.18 if self.stage > 30 else 0.05
        r3_chance = 0.35 if self.stage > 10 else 0.15
        r12_chance = 2.50

        r6_count = roll_drop_count(kills_count * r6_chance * loot_mult)
        r5_count = roll_drop_count(kills_count * r5_chance * loot_mult)
        r4_count = roll_drop_count(kills_count * r4_chance * loot_mult)
        r3_count = roll_drop_count(kills_count * r3_chance * loot_mult)
        r12_count = roll_drop_count(kills_count * r12_chance * loot_mult)

        gen_drop = roll_drop_count(r6_count * 0.15)
        self.obtained_genesis += gen_drop
        self.genesis_gear_pool += gen_drop
        self.obtained_mythic += r6_count
        self.obtained_legendary += r5_count
        self.obtained_epic += r3_count + r4_count
        self.obtained_below_epic += r12_count

        total_dropped = r6_count + r5_count + r4_count + r3_count + r12_count
        self.upgrade_stones += total_dropped * 6
        self.gold += total_dropped * 350

        highest_rarity = 6 if r6_count > 0 else (5 if r5_count > 0 else (4 if r4_count > 0 else (3 if r3_count > 0 else 2)))
        target_slot = random.choice(OFFICIAL_SLOTS)
        old_eq = self.equipments[target_slot]
        new_eq = generate_dropped_equipment(highest_rarity, self.profile["min_ancient_affix_ratio"])

        old_anc = count_ancient_affixes(old_eq["affixes"])
        new_anc = count_ancient_affixes(new_eq["affixes"])

        should_replace = False
        if new_eq["rarity"] > old_eq["rarity"]:
            should_replace = True
        elif new_eq["rarity"] == old_eq["rarity"] and new_anc > old_anc:
            should_replace = True

        if should_replace:
            new_eq["level"] = old_eq["level"]
            self.equipments[target_slot] = new_eq
            self.log_action(current_time, 'equip', '📦', f"野外掉落更佳【{target_slot}】裝備！", f"換上 Rarity {new_eq['rarity']} 裝備 (帶 {len(new_eq['affixes'])} 條詞條，含 {new_anc} 條固定太古)。")

    def challenge_tower_boss(self, current_time):
        if self.tower_floor >= GameConfig.MAX_TOWER_FLOOR: return
        target_floor = self.tower_floor + 1
        cost_gold = int(5000 * math.pow(target_floor, 1.3))
        if self.gold < cost_gold: return

        stats = self.calculate_stats()
        boss_stats = get_official_tower_boss_stats(target_floor)

        time_to_kill = boss_stats["hp"] / max(1.0, stats["dps"])
        time_to_die = stats["max_hp"] / max(1.0, boss_stats["atk"] - stats["pdef"] * 0.5)

        if time_to_kill <= 60.0 and time_to_kill < time_to_die:
            self.gold -= cost_gold
            self.tower_floor = target_floor
            self.gold += int(cost_gold * 3.0)
            self.upgrade_stones += target_floor * 80
            self.demon_seeds += int(target_floor / 10) + 1

            self.gems[2] = self.gems.get(2, 0) + roll_drop_count(target_floor * 0.5)
            self.gems[3] = self.gems.get(3, 0) + roll_drop_count(target_floor * 0.3)
            self.gems[4] = self.gems.get(4, 0) + roll_drop_count(target_floor * 0.1)

            loot_mult = stats["itemFindBonus"]
            if target_floor >= 30:
                gen_drop = roll_drop_count(2.0 * loot_mult)
                self.obtained_genesis += gen_drop
                self.genesis_gear_pool += gen_drop
                self.obtained_mythic += roll_drop_count(5.0 * loot_mult)
                self.obtained_legendary += roll_drop_count(10.0 * loot_mult)
            else:
                self.obtained_mythic += roll_drop_count(3.0 * loot_mult)
                self.obtained_legendary += roll_drop_count(5.0 * loot_mult)
                self.obtained_epic += roll_drop_count(8.0 * loot_mult)

            self.log_action(current_time, 'boss', '👹', f"挑戰並擊敗高塔 BOSS 第 {self.tower_floor} 層！", f"BOSS HP: {format_game_number(boss_stats['hp'])} | 戰鬥耗時 {time_to_kill:.1f} 秒，爆落高階寶石、創世裝備與魔神之種。")

    def auto_upgrade_and_manage(self, current_time):
        if self.skill_points > 0:
            self.total_skill_levels += self.skill_points
            self.skill_points = 0

        self.challenge_tower_boss(current_time)

        synth_summary = []
        for lvl in range(1, 10):
            if self.gems.get(lvl, 0) >= 3:
                count = self.gems[lvl] // 3
                self.gems[lvl] -= count * 3
                
                success_rate = 1.0 if lvl <= 4 else (0.70 if lvl == 5 else 0.50)
                successes = round(count * success_rate)
                failures = count - successes

                self.gems[lvl + 1] = self.gems.get(lvl + 1, 0) + successes
                self.dust += failures
                self.total_gems_spent += count * 3
                self.total_gem_syntheses += count
                if count >= 5: synth_summary.append(f"合成 {count*3} 顆 Lv.{lvl} 寶石 -> 成功 {successes} 顆, 失敗產生 {failures} 魔塵")

        if synth_summary:
            self.log_action(current_time, 'gem', '💎', "進行寶石批量合成與魔塵積攢", "； ".join(synth_summary[:3]))

        forge_attempts = 0
        while self.genesis_gear_pool >= 6 and self.gold >= 5000 and forge_attempts < 5:
            forge_attempts += 1
            self.genesis_gear_pool -= 6
            self.gold -= 5000
            self.total_godforge_attempts += 1
            
            used_dust = min(6, self.dust)
            self.dust -= used_dust
            forge_chance = 0.70 + (used_dust * 0.05)

            if random.random() < forge_chance:
                self.obtained_godforge += 1
                slot = random.choice(OFFICIAL_SLOTS)
                old_eq = self.equipments[slot]
                if not old_eq["is_godforged"]:
                    god_eq = generate_dropped_equipment(8, 1.0)
                    god_eq["level"] = old_eq["level"]
                    self.equipments[slot] = god_eq
                    self.log_action(current_time, 'godforge', '👑', f"神鑄六芒星法陣 6 合 1 成功！(消耗 {used_dust} 魔塵)", f"將【{slot}】裝備解鎖升階為【神鑄創世 R8】(7 滿太古詞條)。")
            else:
                self.dust += 1

        for slot, eq in self.equipments.items():
            if eq["level"] >= self.profile["target_enhance_level"]: continue
            cost_gold = int(80 * math.pow(eq["level"] + 1, 1.4))
            cost_stones = int(1.5 * math.pow(eq["level"] + 1, 1.05))

            success_rate = 0.40 if eq["level"] >= 50 else 0.75
            enhance_attempts = 0

            while eq["level"] < self.profile["target_enhance_level"] and self.gold >= cost_gold and self.upgrade_stones >= cost_stones and enhance_attempts < 20:
                self.gold -= cost_gold
                self.upgrade_stones -= cost_stones
                self.total_gold_spent += cost_gold
                self.total_stones_spent += cost_stones
                enhance_attempts += 1

                if random.random() < success_rate: eq["level"] += 1
                self.total_enhancements += 1

                cost_gold = int(80 * math.pow(eq["level"] + 1, 1.4))
                cost_stones = int(1.5 * math.pow(eq["level"] + 1, 1.05))

        for slot, eq in self.equipments.items():
            reroll_cost_gold = int(150 * math.pow(eq["rarity"], 1.2))
            reroll_cost_stones = int(2 * eq["rarity"])

            reroll_limit = 50 if self.profile["daily_online_hours"] >= 24 else 15
            reroll_attempts = 0

            while reroll_attempts < reroll_limit and self.gold >= reroll_cost_gold and self.upgrade_stones >= reroll_cost_stones:
                self.gold -= reroll_cost_gold
                self.upgrade_stones -= reroll_cost_stones
                self.total_gold_spent += reroll_cost_gold
                self.total_stones_spent += reroll_cost_stones
                
                for aff in eq["affixes"]:
                    aff["key"] = random.choice(OFFICIAL_AFFIX_KEYS)
                    aff["val"] = official_ancient_affix_value(aff["key"], 500, eq["rarity"]) if aff["ancient"] else official_roll_affix_value(aff["key"], 500, eq["rarity"])

                self.total_affix_rerolls += 1
                reroll_attempts += 1

            if reroll_attempts > 30:
                final_anc = count_ancient_affixes(eq["affixes"])
                self.log_action(current_time, 'equip', '🎲', f"進行【{slot}】狂洗詞條 ({reroll_attempts} 次)", f"保持 {final_anc} 條太古狀態不變，追求滿極限屬性。")

    def average_equipment_quality_score(self):
        total_score = 0
        for eq in self.equipments.values():
            total_score += eq["level"] * 10 + eq["rarity"] * 40
        return total_score / len(self.equipments)

    def get_ancient_affix_count(self):
        return sum(count_ancient_affixes(eq["affixes"]) for eq in self.equipments.values())

    def get_godforged_count(self):
        return sum(1 for eq in self.equipments.values() if eq["is_godforged"])

# ==============================================================================
# 2. 離散事件 / Tick 模擬器 (Discrete Event Simulation Engine)
# ==============================================================================

class SingleRunSimulation:
    def __init__(self, run_id, total_hours=120, profile_config=None, sample_interval_hours=1.0):
        self.run_id = run_id
        self.total_hours = total_hours
        self.profile = profile_config or PLAYER_PROFILES["LIGHT"]
        self.sample_interval_hours = sample_interval_hours
        self.char = Character(self.profile)
        self.history = []

    def run(self):
        online_ratio = min(1.0, self.profile["daily_online_hours"] / 24.0)
        action_interval = 0.25 if self.profile["daily_online_hours"] >= 24 else 1.0

        current_time_hours = 0.0
        next_action_time = 0.0
        next_sample_time = 0.0
        last_combat_log_time = -1.0
        tick_hours = 0.05

        while current_time_hours < self.total_hours:
            stats = self.char.calculate_stats()
            player_dps = stats["dps"]
            player_hp = stats["max_hp"]
            player_def = stats["pdef"]
            
            monster_hp = (30 + self.char.stage * 8) * safe_pow(1.095, max(0, self.char.stage - 1))
            monster_atk = (6 + self.char.stage * 1.2) * safe_pow(1.11, max(0, self.char.stage - 1))
            monster_effective_dps = max(1.0, monster_atk - player_def * 0.5)

            time_to_kill = monster_hp / max(1.0, player_dps)
            time_to_die = stats["max_hp"] / monster_effective_dps
            
            is_online = (random.random() < online_ratio)
            eff_mult = 1.0 if is_online else 0.6

            animation_delay = 2.0
            respawn_delay = 0.8
            max_speed_cap = 1.0 if self.char.reincarnation >= 1 else 0.36
            mob_cycle_time = time_to_kill + animation_delay + respawn_delay
            base_kill_speed = min(max_speed_cap, 1.0 / mob_cycle_time)

            killed_per_hour = (base_kill_speed * 3600.0) * eff_mult
            kills_this_tick = killed_per_hour * tick_hours

            is_advancing = (time_to_kill <= 30.0 and time_to_die > time_to_kill)

            if is_advancing:
                self.char.total_kills += kills_this_tick
                self.char.stage += kills_this_tick / 10.0
                
                exp_per_mob = (8 + self.char.stage) * safe_pow(1.06, max(0, self.char.stage - 1))
                gold_per_mob = (20 + self.char.stage) * safe_pow(1.02, max(0, self.char.stage - 1))

                self.char.gain_exp(kills_this_tick * exp_per_mob * stats["xpBonusMult"], current_time_hours)
                self.char.gold += kills_this_tick * gold_per_mob
                
                if self.char.stage > 50 and random.random() < 0.08: self.char.demon_seeds += 1
            else:
                farming_stage = max(1, int(self.char.stage) - 1)
                exp_per_mob = (8 + farming_stage) * safe_pow(1.06, farming_stage - 1)
                gold_per_mob = (20 + farming_stage) * safe_pow(1.02, farming_stage - 1)

                self.char.total_kills += kills_this_tick
                self.char.gain_exp(kills_this_tick * exp_per_mob * stats["xpBonusMult"], current_time_hours)
                self.char.gold += kills_this_tick * gold_per_mob

            if is_online:
                self.char.process_mob_kills_loot(kills_this_tick, current_time_hours)

            if current_time_hours - last_combat_log_time >= 1.0:
                last_combat_log_time = current_time_hours
                status_text = '關卡推進中' if is_advancing else '最高關卡掛機刷怪中'
                self.char.log_action(
                    current_time_hours,
                    'combat',
                    '⚔️',
                    f"一般戰鬥 ({status_text}) Stage {int(self.char.stage)} 關",
                    f"目前 DPS: {format_game_number(stats['dps'])} | 擊殺速度: {base_kill_speed:.2f} 隻/秒 | 本小時擊殺: {format_game_number(killed_per_hour)} 隻 | 累積總殺敵數: {format_game_number(self.char.total_kills)}"
                )

            if is_online and current_time_hours >= next_action_time:
                self.char.auto_upgrade_and_manage(current_time_hours)
                next_action_time += action_interval

            if current_time_hours >= next_sample_time:
                current_stats = self.char.calculate_stats()
                self.history.append({
                    "hour": round(current_time_hours, 2),
                    "stage": round(self.char.stage, 2),
                    "level": self.char.level,
                    "reincarnation": self.char.reincarnation,
                    "tower_floor": self.char.tower_floor,
                    "total_kills": int(self.char.total_kills),
                    "dps": current_stats["dps"],
                    "equip_score": round(self.char.average_equipment_quality_score(), 1),
                    "ancient_affixes": self.char.get_ancient_affix_count(),
                    "godforge_count": self.char.get_godforged_count(),
                    "obtained_godforge": self.char.obtained_godforge,
                    "obtained_genesis": self.char.obtained_genesis,
                    "obtained_mythic": self.char.obtained_mythic,
                    "obtained_legendary": self.char.obtained_legendary,
                    "obtained_epic": self.char.obtained_epic,
                    "obtained_below_epic": self.char.obtained_below_epic,
                    "rerolls": self.char.total_affix_rerolls,
                    "total_skills": self.char.total_skill_levels,
                    "gold_spent": int(self.char.total_gold_spent),
                    "stones_spent": int(self.char.total_stones_spent),
                    "gems_spent": int(self.char.total_gems_spent),
                    "enhancements": self.char.total_enhancements,
                    "gem_syntheses": self.char.total_gem_syntheses
                })
                next_sample_time += self.sample_interval_hours

            current_time_hours += tick_hours

        return self.history

# ==============================================================================
# 3. 蒙地卡羅多次模擬與統計整合 (Monte Carlo Aggregator)
# ==============================================================================

class MonteCarloSimulator:
    def __init__(self, runs=50, total_hours=120, profile_config=None):
        self.runs = runs
        self.total_hours = total_hours
        self.profile = profile_config or PLAYER_PROFILES["LIGHT"]

    def run_simulation(self):
        print(f"🚀 開始執行蒙地卡羅模擬: {self.runs} 次 | 玩家型態: {self.profile['name']} | 線上時間: {self.profile['daily_online_hours']}h/天 | 模擬時長: {self.total_hours}小時")
        all_histories = []
        
        for i in range(1, self.runs + 1):
            sim = SingleRunSimulation(run_id=i, total_hours=self.total_hours, profile_config=self.profile)
            history = sim.run()
            all_histories.append(history)
            if i % max(1, self.runs // 5) == 0 or i == self.runs:
                print(f"  [進度] 已完成 {i}/{self.runs} 次模擬...")

        time_steps_count = min(len(h) for h in all_histories)
        aggregated_result = []

        metrics_keys = [
            "stage", "level", "reincarnation", "tower_floor", "total_kills", "dps", "equip_score", "ancient_affixes", "godforge_count", 
            "obtained_godforge", "obtained_genesis", "obtained_mythic", "obtained_legendary", "obtained_epic", "obtained_below_epic",
            "rerolls", "total_skills", "gold_spent", 
            "stones_spent", "gems_spent", "enhancements", "gem_syntheses"
        ]

        for step_idx in range(time_steps_count):
            sample_hour = all_histories[0][step_idx]["hour"]
            step_data = {"hour": sample_hour}

            for key in metrics_keys:
                values = sorted([run_hist[step_idx][key] for run_hist in all_histories])
                n = len(values)
                mean_val = sum(values) / n
                median_val = values[n // 2]
                p10_val = values[int(n * 0.1)]
                p90_val = values[min(n - 1, int(n * 0.9))]

                step_data[key] = {
                    "mean": round(mean_val, 2) if key != "dps" else mean_val,
                    "median": round(median_val, 2) if key != "dps" else median_val,
                    "p10": round(p10_val, 2) if key != "dps" else p10_val,
                    "p90": round(p90_val, 2) if key != "dps" else p90_val
                }

            aggregated_result.append(step_data)

        return {
            "config": {
                "runs": self.runs,
                "total_hours": self.total_hours,
                "profile": self.profile,
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            },
            "time_series": aggregated_result
        }

def main():
    parser = argparse.ArgumentParser(description="放置型遊戲 4 類玩家 AI 蒙地卡羅數值模擬驗證腳本")
    parser.add_argument("--runs", type=int, default=50, help="模擬執行遊玩次數 (Monte Carlo Runs, 預設: 50)")
    parser.add_argument("--hours", type=float, default=500.0, help="單次模擬遊戲時間(小時, 預設: 500.0)")
    parser.add_argument("--profile", type=str, default="EXTREME", choices=["LIGHT", "MODERATE", "HEAVY", "EXTREME"], 
                        help="玩家型態預設: LIGHT, MODERATE, HEAVY, EXTREME")
    
    parser.add_argument("--daily-online", type=float, default=None)
    parser.add_argument("--target-enhance", type=int, default=None)
    parser.add_argument("--reroll-threshold", type=float, default=None)
    parser.add_argument("--xp-affixes", type=int, default=None)
    parser.add_argument("--gem-eff-affixes", type=int, default=None)
    parser.add_argument("--ancient-ratio", type=float, default=None)
    parser.add_argument("--gem-target-level", type=int, default=None)
    parser.add_argument("--output", type=str, default="monte_carlo_dashboard.html", help="導出儀表板 HTML 檔名")

    args = parser.parse_args()

    profile_cfg = PLAYER_PROFILES.get(args.profile, PLAYER_PROFILES["EXTREME"]).copy()
    if args.daily_online is not None: profile_cfg["daily_online_hours"] = args.daily_online
    if args.target_enhance is not None: profile_cfg["target_enhance_level"] = args.target_enhance
    if args.reroll_threshold is not None: profile_cfg["reroll_min_threshold_pct"] = args.reroll_threshold
    if args.xp_affixes is not None: profile_cfg["required_xp_bonus_affixes"] = args.xp_affixes
    if args.gem_eff_affixes is not None: profile_cfg["required_gem_eff_affixes"] = args.gem_eff_affixes
    if args.ancient_ratio is not None: profile_cfg["min_ancient_affix_ratio"] = args.ancient_ratio
    if args.gem_target_level is not None: profile_cfg["gem_target_level"] = args.gem_target_level

    simulator = MonteCarloSimulator(
        runs=args.runs,
        total_hours=args.hours,
        profile_config=profile_cfg
    )

    sim_data = simulator.run_simulation()
    
    abs_path = os.path.abspath(args.output)
    print(f"✅ 成功執行蒙地卡羅模擬，導出 HTML 控制台: {abs_path}")

if __name__ == "__main__":
    main()
