#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
測試寶石合成與轉生數值修復腳本
"""

import math

def format_game_number(num):
    if num is None or math.isnan(num): return '0'
    if num < 1000: return str(int(num))
    if num < 1e6: return f"{num/1e3:.2f}K"
    if num < 1e9: return f"{num/1e6:.2f}M"
    if num < 1e12: return f"{num/1e9:.2f}B"
    if num < 1e15: return f"{num/1e12:.2f}T"
    return f"{num:.2e}".replace('e+', ' × 10^')

print("12345 ->", format_game_number(12345))
print("56200000 ->", format_game_number(56200000))
print("1250000000 ->", format_game_number(1250000000))
