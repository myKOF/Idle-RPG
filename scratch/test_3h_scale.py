#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
測試 3 小時千萬級 (10^7) 與 100 小時 10 轉生 ($10^{20}$) 真實 DES 數學模型
"""

import math

def calculate_player_dps(level, reincarnation, weapon_rarity, enhance_lvl, skill_lvl, tower_floor):
    # base primary stats for str/agi/int/vit = 5 + (level - 1) * 2
    str_stat = 5 + (level - 1) * 2
    dex_stat = 5 + (level - 1) * 2
    
    reinc_flat_scale = 1.2 * 50 * math.pow(2.8, reincarnation)
    base_atk = 8 + reinc_flat_scale + str_stat * 1.5 + (level - 1) * 2
    
    enhance_mult = 1.0 + enhance_lvl * 0.08
    rarity_mult = math.pow(2.2, weapon_rarity)
    weapon_atk = 40 * rarity_mult * enhance_mult
    
    base_atk += weapon_atk
    
    patk_pct = 0.5 + weapon_rarity * 0.15
    crit_rate = min(1.0, 0.10 + dex_stat * 0.0005)
    crit_dmg = 1.5 + 0.5 * weapon_rarity
    aspd = 1.5 + dex_stat * 0.002
    skill_mult = 1.0 + skill_lvl * 0.2
    
    reinc_mult = math.pow(2.0, reincarnation) * math.pow(2.8, reincarnation)
    tower_mult = 1.0 + (math.floor(tower_floor / 10) * 0.05)
    
    total_patk = base_atk * (1.0 + patk_pct) * skill_mult * reinc_mult * tower_mult
    dps = total_patk * aspd * (1.0 + crit_rate * (crit_dmg - 1.0))
    return dps

print("3 小時 0 轉 Lv.200 (裝備 Rarity 4 +10, 技能 20): DPS =", calculate_player_dps(200, 0, 4, 10, 20, 10))
print("20 小時 1 轉 Lv.500 (裝備 Rarity 5 +25, 技能 50): DPS =", calculate_player_dps(500, 1, 5, 25, 50, 50))
print("100 小時 10 轉 Lv.9999 (裝備 Rarity 7 +70, 技能 200): DPS =", calculate_player_dps(9999, 10, 7, 70, 200, 150))
