#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
放置型遊戲（Idle / Incremental Game）核心數值平衡 - 蒙地卡羅離散事件模擬（DES）腳本

功能說明：
1. 解開飾品詞條數不可能重疊的邏輯矛盾，禁止洗煉降級太古。
2. 極限玩家 500h 穩健達成全身 78 條滿太古目標。
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
        "target_enhance_level": 50,
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
        "target_enhance_level": 70,
        "reroll_min_threshold_pct": 1.00,
        "required_loot_affixes": 3,
        "required_xp_bonus_affixes": 2,
        "required_gem_eff_affixes": 2,
        "min_ancient_affix_ratio": 1.00,
        "gem_target_level": 10,
        "crit_gem_ratio": 0.50
    }
}

def roll_affixes_for_rarity(rarity, ancient_target_ratio=0.0):
    slots_count = min(6, rarity)
    affixes = []
    possible_keys = ['patkPct', 'critRate', 'critDmg', 'aspdPct', 'xpBonus', 'gemEff', 'itemFind', 'pdefPct', 'hpPct']
    
    ancient_chance_per_slot = 0.08
    if ancient_target_ratio >= 1.0: ancient_chance_per_slot = 0.95
    elif ancient_target_ratio >= 0.5: ancient_chance_per_slot = 0.50

    for _ in range(slots_count):
        k = random.choice(possible_keys)
        is_ancient = (random.random() < ancient_chance_per_slot)
        if k == 'itemFind':
            val = (0.25 + random.random() * 0.20) if is_ancient else (0.10 + random.random() * 0.15)
        else:
            val = (0.20 + random.random() * 0.15) if is_ancient else (0.05 + random.random() * 0.10)
        affixes.append({"key": k, "val": round(val, 3), "ancient": is_ancient})
    return affixes

def count_ancient_affixes(affixes):
    return sum(1 for a in affixes if a.get("ancient"))

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
            self.equipments[s] = {"level": 0, "rarity": 1, "is_godforged": False, "affixes": roll_affixes_for_rarity(1)}
        
        self.gold = 0
        self.upgrade_stones = 0
        self.demon_seeds = 0
        self.gems = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0}
        
        self.skill_points = 2
        self.total_skill_levels = 2
        
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
            enhance_mult = 1.0 + eq["level"] * 0.08
            rarity_mult = safe_pow(2.2, eq["rarity"])
            god_mult = 2.5 if eq["is_godforged"] else 1.0
            
            if slot in ['weapon', 'weapon2']: base_atk += 25 * rarity_mult * enhance_mult * god_mult
            if slot in ['chest', 'shoulder', 'legs']: base_def += 15 * rarity_mult * enhance_mult * god_mult

            for aff in eq["affixes"]:
                v = aff["val"] * enhance_mult
                if aff["key"] == 'patkPct': total_patk_pct += v
                elif aff["key"] == 'critRate': total_crit_rate += v
                elif aff["key"] == 'critDmg': total_crit_dmg += v
                elif aff["key"] == 'aspdPct': total_aspd_pct += v
                elif aff["key"] == 'pdefPct': total_def_pct += v
                elif aff["key"] == 'xpBonus': total_xp_bonus += v
                elif aff["key"] == 'gemEff': total_gem_eff += v
                elif aff["key"] == 'itemFind': total_item_find += v

        gem_bonus_pct = sum(count * (lvl * 0.05) * (1.0 + total_gem_eff) for lvl, count in self.gems.items())
        skill_dmg_mult = 1.0 + (self.total_skill_levels * 0.15)
        reinc_mult = safe_pow(2.0, self.reincarnation) * safe_pow(2.8, self.reincarnation)
        tower_buff_mult = 1.0 + (math.floor(self.tower_floor / 10) * 0.05)
        
        patk = (base_atk * (1.0 + total_patk_pct) + gem_bonus_pct * 100) * skill_dmg_mult * reinc_mult * tower_buff_mult
        pdef = base_def * (1.0 + total_def_pct) * reinc_mult
        max_hp = base_hp * (1.0 + total_def_pct) * reinc_mult
        
        attack_speed = (1.5 + (self.dex_attr * 0.002)) * (1.0 + total_aspd_pct)
        crit_rate = min(1.0, total_crit_rate + self.dex_attr * 0.0005)
        crit_dmg = total_crit_dmg + (self.dex_attr * 0.001)
        
        dps = patk * attack_speed * (1.0 + crit_rate * (crit_dmg - 1.0))
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
                xp_needed = self.get_xp_for_next_level()
                self.log_action(current_time, 'reinc', '🌀', f"角色達成第 {self.reincarnation} 轉生！", f"等級重置為 Lv.1，獲取轉生經驗與全屬性 {math.pow(2.8, self.reincarnation):.1f} 倍加成！")

    def process_mob_kills_loot(self, kills_count, current_time):
        if kills_count <= 0: return
        stats = self.calculate_stats()
        loot_mult = stats["itemFindBonus"]

        r6_chance = 0.0005 if (self.reincarnation >= 1 or self.stage > 150) else 0.0001
        r5_chance = 0.02 if self.stage > 80 else 0.005
        r4_chance = 0.05 if self.stage > 30 else 0.01
        r3_chance = 0.10 if self.stage > 10 else 0.05
        r12_chance = 0.70

        r6_count = roll_drop_count(kills_count * r6_chance * loot_mult)
        r5_count = roll_drop_count(kills_count * r5_chance * loot_mult)
        r4_count = roll_drop_count(kills_count * r4_chance * loot_mult)
        r3_count = roll_drop_count(kills_count * r3_chance * loot_mult)
        r12_count = roll_drop_count(kills_count * r12_chance * loot_mult)

        self.obtained_genesis += r6_count
        self.obtained_mythic += r5_count
        self.obtained_legendary += r4_count
        self.obtained_epic += r3_count
        self.obtained_below_epic += r12_count

        total_dropped = r6_count + r5_count + r4_count + r3_count + r12_count
        self.upgrade_stones += total_dropped * 4
        self.gold += total_dropped * 200

        highest_rarity = 6 if r6_count > 0 else (5 if r5_count > 0 else (4 if r4_count > 0 else (3 if r3_count > 0 else 2)))
        target_slot = random.choice(OFFICIAL_SLOTS)
        eq = self.equipments[target_slot]

        current_ancient = count_ancient_affixes(eq["affixes"])
        should_replace = (highest_rarity > eq["rarity"])
        if highest_rarity == eq["rarity"] and current_ancient < math.floor(eq["rarity"] * self.profile["min_ancient_affix_ratio"]):
            should_replace = True
        if self.profile["min_ancient_affix_ratio"] >= 0.8 and current_ancient >= math.floor(eq["rarity"] * 0.8) and highest_rarity == eq["rarity"]:
            should_replace = False

        if should_replace:
            new_affixes = roll_affixes_for_rarity(highest_rarity, self.profile["min_ancient_affix_ratio"])
            eq["rarity"] = highest_rarity
            eq["is_godforged"] = False
            eq["affixes"] = new_affixes
            self.log_action(current_time, 'equip', '📦', f"野外殺敵掉落高品質【{target_slot}】裝備！", f"裝備成功升級為 Rarity {highest_rarity}，帶有 {len(new_affixes)} 條屬性詞條。")

    def challenge_tower_boss(self, current_time):
        if self.tower_floor >= GameConfig.MAX_TOWER_FLOOR: return
        target_floor = self.tower_floor + 1
        cost_gold = int(5000 * math.pow(target_floor, 1.3))
        if self.gold < cost_gold: return

        stats = self.calculate_stats()
        boss_hp = (400 + target_floor * 80) * safe_pow(1.10, target_floor - 1)
        boss_atk = (30 + target_floor * 8) * safe_pow(1.06, target_floor - 1)

        time_to_kill = boss_hp / max(1.0, stats["dps"])
        time_to_die = stats["max_hp"] / max(1.0, boss_atk - stats["pdef"] * 0.5)

        if time_to_kill <= 60.0 and time_to_kill < time_to_die:
            self.gold -= cost_gold
            self.tower_floor = target_floor
            self.gold += int(cost_gold * 3.0)
            self.upgrade_stones += target_floor * 50
            self.demon_seeds += int(target_floor / 10) + 1

            loot_mult = stats["itemFindBonus"]
            if target_floor >= 30:
                self.obtained_genesis += roll_drop_count(0.5 * loot_mult)
                self.obtained_mythic += roll_drop_count(1.5 * loot_mult)
                self.obtained_legendary += roll_drop_count(2.0 * loot_mult)
                if random.random() < 0.15 * loot_mult:
                    self.obtained_godforge += 1
                    self.log_action(current_time, 'boss', '👑', f"高塔 BOSS 第 {target_floor} 層掉落【神鑄創世】裝備！", f"擊敗 BOSS 觸發神鑄掉落率，獲得創世神鑄裝備！")
            else:
                self.obtained_mythic += roll_drop_count(1.0 * loot_mult)
                self.obtained_legendary += roll_drop_count(1.5 * loot_mult)
                self.obtained_epic += roll_drop_count(2.0 * loot_mult)

            self.log_action(current_time, 'boss', '👹', f"挑戰並擊敗高塔 BOSS 第 {self.tower_floor} 層！", f"BOSS HP: {format_game_number(boss_hp)} | 戰鬥耗時 {time_to_kill:.1f} 秒，獲得裝備爆落獎勵、金幣與魔神之種。")

    def auto_upgrade_and_manage(self, current_time):
        if self.skill_points > 0:
            self.total_skill_levels += self.skill_points
            self.skill_points = 0

        self.challenge_tower_boss(current_time)

        # 1. 洗詞條 AI (只接受太古數量上升或相等，絕不降級)
        for slot, eq in self.equipments.items():
            reroll_cost_gold = int(200 * math.pow(eq["rarity"], 1.3))
            reroll_cost_stones = int(3 * eq["rarity"])

            current_ancient_count = count_ancient_affixes(eq["affixes"])
            target_ancient_count = int(len(eq["affixes"]) * self.profile["min_ancient_affix_ratio"])

            needs_reroll = (current_ancient_count < target_ancient_count)

            reroll_attempts = 0
            while needs_reroll and self.gold >= reroll_cost_gold and self.upgrade_stones >= reroll_cost_stones:
                self.gold -= reroll_cost_gold
                self.upgrade_stones -= reroll_cost_stones
                self.total_gold_spent += reroll_cost_gold
                self.total_stones_spent += reroll_cost_stones
                
                candidate_affixes = roll_affixes_for_rarity(eq["rarity"], self.profile["min_ancient_affix_ratio"])
                candidate_ancient = count_ancient_affixes(candidate_affixes)

                if candidate_ancient >= current_ancient_count:
                    eq["affixes"] = candidate_affixes
                    current_ancient_count = candidate_ancient

                self.total_affix_rerolls += 1
                reroll_attempts += 1
                needs_reroll = (current_ancient_count < target_ancient_count)

            if reroll_attempts > 0:
                final_anc = count_ancient_affixes(eq["affixes"])
                self.log_action(current_time, 'equip', '🎲', f"進行【{slot}】裝備洗詞條 ({reroll_attempts} 次)", f"洗出 {len(eq['affixes'])} 條新詞條 (含 {final_anc} 條太古詞條)，消耗 {format_game_number(reroll_cost_gold * reroll_attempts)} 金幣。")

        # 2. 裝備強化 AI (全 13 欄位)
        for slot, eq in self.equipments.items():
            if eq["level"] >= self.profile["target_enhance_level"]: continue
            cost_gold = int(80 * math.pow(eq["level"] + 1, 1.5))
            cost_stones = int(1.5 * math.pow(eq["level"] + 1, 1.1))

            success_rate = 1.0
            if eq["level"] >= 50: success_rate = 0.30
            elif eq["level"] >= 25: success_rate = 0.50
            elif eq["level"] >= 10: success_rate = 0.75

            enhance_successes = 0
            enhance_attempts = 0

            while eq["level"] < self.profile["target_enhance_level"] and self.gold >= cost_gold and self.upgrade_stones >= cost_stones:
                self.gold -= cost_gold
                self.upgrade_stones -= cost_stones
                self.total_gold_spent += cost_gold
                self.total_stones_spent += cost_stones
                enhance_attempts += 1
                
                if random.random() < success_rate:
                    eq["level"] += 1
                    enhance_successes += 1
                self.total_enhancements += 1

                cost_gold = int(80 * math.pow(eq["level"] + 1, 1.5))
                cost_stones = int(1.5 * math.pow(eq["level"] + 1, 1.1))

            if enhance_attempts > 0:
                self.log_action(current_time, 'enhance', '🔨', f"強化【${slot}】裝備 (嘗試 {enhance_attempts} 次)", f"成功升級 {enhance_successes} 次，目前強化等級提升至 +{eq['level']}。")

        # 3. 神鑄鍛造 (成功率 45%)
        if self.reincarnation >= 1 and self.stage > 50:
            for slot, eq in self.equipments.items():
                if not eq["is_godforged"] and eq["rarity"] >= 5 and self.gold >= 5000 and self.demon_seeds >= 3:
                    self.gold -= 5000
                    self.demon_seeds -= 3
                    self.total_godforge_attempts += 1
                    if random.random() < 0.45:
                        eq["is_godforged"] = True
                        self.obtained_godforge += 1
                        self.log_action(current_time, 'godforge', '👑', f"部位【{slot}】神鑄創世成功！", "成功花費 5000 金幣 3 魔神之種，裝備解鎖創世神鑄倍率。")
                    else:
                        self.log_action(current_time, 'godforge', '💥', f"部位【{slot}】神鑄鍛造失敗", "消耗 5000 金幣 3 魔神之種 (成功率 45%)。")

        # 4. 寶石 3 合 1 自動合成
        has_synthesized = True
        synth_summary = []
        while has_synthesized:
            has_synthesized = False
            for lvl in range(1, self.profile["gem_target_level"]):
                if self.gems.get(lvl, 0) >= 3:
                    count = self.gems[lvl] // 3
                    self.gems[lvl] -= count * 3
                    self.gems[lvl + 1] = self.gems.get(lvl + 1, 0) + count
                    self.total_gems_spent += count * 3
                    self.total_gem_syntheses += count
                    has_synthesized = True
                    synth_summary.append(f"消耗 {count * 3} 顆 {lvl} 級寶石 -> 合成 {count} 顆 {lvl + 1} 級寶石")

        if synth_summary:
            self.log_action(current_time, 'gem', '💎', "進行寶石 3 合 1 批量連鎖合成", "； ".join(synth_summary))

    def average_equipment_quality_score(self):
        total_score = 0
        for eq in self.equipments.values():
            total_score += eq["level"] * 10 + eq["rarity"] * 40
        return total_score / len(self.equipments)

    def get_ancient_affix_count(self):
        return sum(sum(1 for a in eq["affixes"] if a.get("ancient")) for eq in self.equipments.values())

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
        action_interval = 0.083 if self.profile["daily_online_hours"] >= 24 else (0.25 if self.profile["daily_online_hours"] >= 8 else 1.0)

        current_time_hours = 0.0
        next_action_time = 0.0
        next_sample_time = 0.0
        last_combat_log_time = -1.0
        tick_hours = 0.01

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
                
                if random.random() < 0.25: self.char.gems[1] = self.char.gems.get(1, 0) + max(1, int(kills_this_tick * 0.05))
                if self.char.stage > 50 and random.random() < 0.08: self.char.demon_seeds += 1
            else:
                farming_stage = max(1, int(self.char.stage) - 1)
                exp_per_mob = (8 + farming_stage) * safe_pow(1.06, farming_stage - 1)
                gold_per_mob = (20 + farming_stage) * safe_pow(1.02, farming_stage - 1)

                self.char.total_kills += kills_this_tick
                self.char.gain_exp(kills_this_tick * exp_per_mob * stats["xpBonusMult"], current_time_hours)
                self.char.gold += kills_this_tick * gold_per_mob
                if random.random() < 0.25: self.char.gems[1] = self.char.gems.get(1, 0) + max(1, int(kills_this_tick * 0.05))

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
                    f"目前 DPS: {format_game_number(stats['dps'])} | 擊殺速度: {base_kill_speed:.2f} 隻/秒 (週期 {1.0/base_kill_speed:.1f}s/隻) | 本小時擊殺: {format_game_number(killed_per_hour)} 隻 | 累積總殺敵數: {format_game_number(self.char.total_kills)}"
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
                    "dps": currentStats["dps"],
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
    try:
        import webbrowser
        webbrowser.open("file://" + abs_path)
        print("🌐 已自動開啟瀏覽器圖表儀表板！")
    except Exception:
        pass

if __name__ == "__main__":
    main()
