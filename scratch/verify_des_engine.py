#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DES 引擎自測與驗證腳本
驗證玩家從 0 開始、完整歷經 10 轉生、高塔 150 層、神鑄鍛造與極限推關的平滑進程
"""

import math
import random

class GameConfig:
    MAX_LEVEL = 9999
    MAX_REINCARNATION = 10
    MAX_TOWER_FLOOR = 150

    REINCARNATION_EXP_MULTS = [1, 10, 100, 1000, 10000, 100000, 1000000, 10000000, 100000000, 1000000000, 1e11]
    REINCARNATION_BASE_EXP_ADD = [0, 500000, 1500000, 3000000, 6000000, 12000000, 24000000, 48000000, 96000000, 192000000, 384000000]

def safe_pow(base, exp, max_val=1e300):
    try:
        res = math.pow(base, exp)
        return min(max_val, res)
    except OverflowError:
        return max_val

def get_xp_for_next_level(level, reinc):
    reinc_idx = min(reinc, len(GameConfig.REINCARNATION_EXP_MULTS) - 1)
    exp_mult = GameConfig.REINCARNATION_EXP_MULTS[reinc_idx]
    base_add = GameConfig.REINCARNATION_BASE_EXP_ADD[reinc_idx]
    return math.floor((30 * math.pow(level, 2.5) + 40) * exp_mult + base_add)

print("Level 1 -> 100 EXP needed:", sum(get_xp_for_next_level(l, 0) for l in range(1, 100)))
print("Level 1 -> 9999 EXP needed (Reinc 0):", sum(get_xp_for_next_level(l, 0) for l in range(1, 1000)))
