# Copyright (c) 2026 Dashiell Renaud (https://dashiellrenaud.com)
# Licensed under Creative Commons Attribution-NonCommercial-NoDerivatives 4.0
# International (CC BY-NC-ND 4.0): https://creativecommons.org/licenses/by-nc-nd/4.0/
# SPDX-License-Identifier: CC-BY-NC-ND-4.0

import json
import os

MARKET_CARDS = [
    # GRAIN (12)
    {"id": "grn_1", "name": "Spelt", "category": "Grain", "subcategory": "Grain", "track": "Grain", "blocks": 1, "guards": 0, "sell": [72, 45, 28, 19, 12], "buy": [24, 18, 12, 8, 5]},
    {"id": "grn_2", "name": "Durum", "category": "Grain", "subcategory": "Grain", "track": "Grain", "blocks": 1, "guards": 0, "sell": [50, 32, 21, 14, 9], "buy": [18, 13, 9, 6, 4]},
    {"id": "grn_3", "name": "Millet", "category": "Grain", "subcategory": "Grain", "track": "Grain", "blocks": 1, "guards": 0, "sell": [30, 18, 12, 8, 4], "buy": [10, 7, 5, 3, 1]},
    {"id": "grn_4", "name": "Rye", "category": "Grain", "subcategory": "Grain", "track": "Grain", "blocks": 2, "guards": 0, "sell": [90, 55, 35, 23, 14], "buy": [30, 22, 15, 10, 6]},
    {"id": "grn_5", "name": "Barley", "category": "Grain", "subcategory": "Grain", "track": "Grain", "blocks": 2, "guards": 0, "sell": [83, 50, 33, 21, 13], "buy": [28, 20, 14, 9, 6]},
    {"id": "grn_6", "name": "Oats", "category": "Grain", "subcategory": "Grain", "track": "Grain", "blocks": 1, "guards": 0, "sell": [35, 23, 16, 11, 6], "buy": [12, 9, 6, 4, 2]},
    {"id": "grn_7", "name": "Spelt", "category": "Grain", "subcategory": "Grain", "track": "Grain", "blocks": 2, "guards": 0, "sell": [108, 68, 42, 27, 16], "buy": [36, 27, 18, 12, 7]},
    {"id": "grn_8", "name": "Durum", "category": "Grain", "subcategory": "Grain", "track": "Grain", "blocks": 2, "guards": 0, "sell": [98, 60, 37, 25, 15], "buy": [30, 22, 16, 11, 6]},
    {"id": "grn_9", "name": "Barley", "category": "Grain", "subcategory": "Grain", "track": "Grain", "blocks": 1, "guards": 0, "sell": [40, 27, 18, 11, 7], "buy": [14, 11, 7, 5, 2]},
    {"id": "grn_10", "name": "Oats", "category": "Grain", "subcategory": "Grain", "track": "Grain", "blocks": 2, "guards": 0, "sell": [60, 37, 22, 15, 10], "buy": [20, 15, 10, 6, 4]},
    {"id": "grn_11", "name": "Rye", "category": "Grain", "subcategory": "Grain", "track": "Grain", "blocks": 1, "guards": 0, "sell": [45, 30, 20, 13, 8], "buy": [15, 12, 8, 5, 3]},
    {"id": "grn_12", "name": "Durum", "category": "Grain", "subcategory": "Grain", "track": "Grain", "blocks": 1, "guards": 0, "sell": [50, 32, 21, 14, 9], "buy": [18, 13, 9, 6, 4]},

    # CHEAP WINE (9)
    {"id": "cw_1", "name": "Cretan", "category": "Wine", "subcategory": "Cheap Wine", "track": "Wine", "blocks": 1, "guards": 0, "sell": [210, 130, 82, 57, 30], "buy": [70, 52, 35, 26, 14]},
    {"id": "cw_2", "name": "Ceretanum", "category": "Wine", "subcategory": "Cheap Wine", "track": "Wine", "blocks": 1, "guards": 0, "sell": [180, 113, 70, 48, 26], "buy": [60, 45, 30, 22, 12]},
    {"id": "cw_3", "name": "Passum", "category": "Wine", "subcategory": "Cheap Wine", "track": "Wine", "blocks": 1, "guards": 0, "sell": [98, 60, 37, 25, 15], "buy": [30, 22, 16, 11, 6]},
    {"id": "cw_4", "name": "Massico", "category": "Wine", "subcategory": "Cheap Wine", "track": "Wine", "blocks": 1, "guards": 0, "sell": [150, 95, 58, 40, 22], "buy": [50, 38, 25, 18, 10]},
    {"id": "cw_5", "name": "Vienna", "category": "Wine", "subcategory": "Cheap Wine", "track": "Wine", "blocks": 1, "guards": 0, "sell": [162, 102, 63, 44, 24], "buy": [54, 41, 27, 20, 11]},
    {"id": "cw_6", "name": "Posca", "category": "Wine", "subcategory": "Cheap Wine", "track": "Wine", "blocks": 1, "guards": 0, "sell": [90, 55, 35, 23, 14], "buy": [30, 22, 15, 10, 6]},
    {"id": "cw_7", "name": "Carenum", "category": "Wine", "subcategory": "Cheap Wine", "track": "Wine", "blocks": 1, "guards": 0, "sell": [108, 68, 42, 27, 16], "buy": [36, 27, 18, 12, 7]},
    {"id": "cw_8", "name": "Narbo", "category": "Wine", "subcategory": "Cheap Wine", "track": "Wine", "blocks": 1, "guards": 0, "sell": [120, 75, 47, 31, 18], "buy": [40, 30, 20, 14, 8]},
    {"id": "cw_9", "name": "Massalia", "category": "Wine", "subcategory": "Cheap Wine", "track": "Wine", "blocks": 1, "guards": 0, "sell": [138, 85, 54, 35, 20], "buy": [46, 34, 23, 16, 9]},

    # FINE WINE (9)
    {"id": "fw_1", "name": "Pompeiian", "category": "Wine", "subcategory": "Fine Wine", "track": "Wine", "blocks": 1, "guards": 0, "sell": [360, 225, 140, 101, 50], "buy": [120, 90, 60, 46, 26]},
    {"id": "fw_2", "name": "Lunense", "category": "Wine", "subcategory": "Fine Wine", "track": "Wine", "blocks": 1, "guards": 0, "sell": [372, 235, 138, 106, 52], "buy": [126, 94, 63, 48, 27]},
    {"id": "fw_3", "name": "Praetutium", "category": "Wine", "subcategory": "Fine Wine", "track": "Wine", "blocks": 1, "guards": 0, "sell": [384, 245, 152, 110, 54], "buy": [130, 98, 65, 50, 29]},
    {"id": "fw_4", "name": "Rhaeticum", "category": "Wine", "subcategory": "Fine Wine", "track": "Wine", "blocks": 1, "guards": 0, "sell": [427, 270, 168, 123, 60], "buy": [144, 108, 72, 56, 33]},
    {"id": "fw_5", "name": "Hadrianum", "category": "Wine", "subcategory": "Fine Wine", "track": "Wine", "blocks": 1, "guards": 0, "sell": [446, 290, 182, 132, 64], "buy": [156, 116, 78, 60, 36]},
    {"id": "fw_6", "name": "Alban", "category": "Wine", "subcategory": "Fine Wine", "track": "Wine", "blocks": 1, "guards": 0, "sell": [460, 310, 193, 141, 68], "buy": [166, 124, 83, 64, 39]},
    {"id": "fw_7", "name": "Falernian", "category": "Wine", "subcategory": "Fine Wine", "track": "Wine", "blocks": 1, "guards": 0, "sell": [472, 318, 203, 149, 72], "buy": [174, 132, 87, 68, 44]},
    {"id": "fw_8", "name": "Caecuban", "category": "Wine", "subcategory": "Fine Wine", "track": "Wine", "blocks": 1, "guards": 0, "sell": [478, 324, 210, 154, 74], "buy": [180, 135, 90, 70, 47]},
    {"id": "fw_9", "name": "Opimian", "category": "Wine", "subcategory": "Fine Wine", "track": "Wine", "blocks": 1, "guards": 0, "sell": [484, 331, 215, 160, 76], "buy": [184, 138, 92, 73, 50]},

    # MEAT ANIMALS (9)
    {"id": "ma_1", "name": "Chickens", "category": "Animals", "subcategory": "Meat Animals", "track": "Animals", "blocks": 1, "guards": 0, "sell": [98, 60, 37, 25, 15], "buy": [30, 22, 16, 11, 6]},
    {"id": "ma_2", "name": "Pheasants", "category": "Animals", "subcategory": "Meat Animals", "track": "Animals", "blocks": 1, "guards": 0, "sell": [108, 68, 42, 27, 16], "buy": [36, 27, 18, 12, 7]},
    {"id": "ma_3", "name": "Hares", "category": "Animals", "subcategory": "Meat Animals", "track": "Animals", "blocks": 1, "guards": 0, "sell": [90, 55, 35, 23, 14], "buy": [30, 22, 15, 10, 6]},
    {"id": "ma_4", "name": "Lamb", "category": "Animals", "subcategory": "Meat Animals", "track": "Animals", "blocks": 2, "guards": 0, "sell": [162, 102, 63, 44, 24], "buy": [54, 41, 27, 20, 11]},
    {"id": "ma_5", "name": "Pig", "category": "Animals", "subcategory": "Meat Animals", "track": "Animals", "blocks": 2, "guards": 0, "sell": [210, 130, 82, 57, 30], "buy": [70, 52, 35, 26, 14]},
    {"id": "ma_6", "name": "Geese", "category": "Animals", "subcategory": "Meat Animals", "track": "Animals", "blocks": 1, "guards": 0, "sell": [150, 95, 58, 40, 22], "buy": [50, 38, 25, 18, 10]},
    {"id": "ma_7", "name": "Oysters", "category": "Animals", "subcategory": "Meat Animals", "track": "Animals", "blocks": 1, "guards": 0, "sell": [120, 75, 47, 31, 18], "buy": [40, 30, 20, 14, 8]},
    {"id": "ma_8", "name": "Goat", "category": "Animals", "subcategory": "Meat Animals", "track": "Animals", "blocks": 2, "guards": 0, "sell": [180, 113, 70, 48, 26], "buy": [60, 45, 30, 22, 12]},
    {"id": "ma_9", "name": "Ducks", "category": "Animals", "subcategory": "Meat Animals", "track": "Animals", "blocks": 1, "guards": 0, "sell": [138, 85, 54, 35, 20], "buy": [46, 34, 23, 16, 9]},

    # EXOTIC ANIMALS (9) - Mandatory in combat if they have combat stats
    {"id": "ea_1", "name": "Deer", "category": "Animals", "subcategory": "Exotic Animals", "track": "Animals", "blocks": 2, "guards": 0, "sell": [240, 150, 93, 66, 34], "buy": [80, 60, 40, 30, 16], "combatText": None, "combat": None},
    {"id": "ea_2", "name": "Buffalo", "category": "Animals", "subcategory": "Exotic Animals", "track": "Animals", "blocks": 3, "guards": 0, "sell": [300, 188, 117, 83, 42], "buy": [100, 75, 50, 38, 20], "combatText": None, "combat": None},
    {"id": "ea_3", "name": "Boar", "category": "Animals", "subcategory": "Exotic Animals", "track": "Animals", "blocks": 3, "guards": 0, "sell": [270, 168, 105, 75, 38], "buy": [90, 67, 45, 34, 18], "combatText": "1(R) -1 CP", "combat": {"dice": 1, "negDice": 0, "flat": -1, "mandatory": True}},
    {"id": "ea_4", "name": "Leopard", "category": "Animals", "subcategory": "Exotic Animals", "track": "Animals", "blocks": 2, "guards": 0, "sell": [454, 300, 187, 136, 66], "buy": [160, 120, 80, 62, 38], "combatText": "1 -1(R) CP", "combat": {"dice": 0, "negDice": 1, "flat": 1, "mandatory": True}},
    {"id": "ea_5", "name": "Bear", "category": "Animals", "subcategory": "Exotic Animals", "track": "Animals", "blocks": 2, "guards": 0, "sell": [414, 262, 163, 119, 58], "buy": [140, 105, 70, 54, 32], "combatText": "3 -2(R) CP", "combat": {"dice": 0, "negDice": 2, "flat": 3, "mandatory": True}},
    {"id": "ea_6", "name": "Crocodile", "category": "Animals", "subcategory": "Exotic Animals", "track": "Animals", "blocks": 4, "guards": 0, "sell": [438, 280, 175, 128, 62], "buy": [150, 112, 75, 58, 35], "combatText": "2 -1(R) CP", "combat": {"dice": 0, "negDice": 1, "flat": 2, "mandatory": True}},
    {"id": "ea_7", "name": "Tiger", "category": "Animals", "subcategory": "Exotic Animals", "track": "Animals", "blocks": 4, "guards": 0, "sell": [472, 318, 203, 149, 72], "buy": [174, 132, 87, 68, 44], "combatText": "2(R) -1(R) CP", "combat": {"dice": 2, "negDice": 1, "flat": 0, "mandatory": True}},
    {"id": "ea_8", "name": "Lion", "category": "Animals", "subcategory": "Exotic Animals", "track": "Animals", "blocks": 4, "guards": 0, "sell": [478, 324, 210, 154, 74], "buy": [180, 135, 90, 70, 47], "combatText": "2(R) -2 CP", "combat": {"dice": 2, "negDice": 0, "flat": -2, "mandatory": True}},
    {"id": "ea_9", "name": "Rhinoceros", "category": "Animals", "subcategory": "Exotic Animals", "track": "Animals", "blocks": 4, "guards": 0, "sell": [495, 353, 228, 173, 80], "buy": [196, 147, 98, 79, 56], "combatText": "3(R) -4 CP", "combat": {"dice": 3, "negDice": 0, "flat": -4, "mandatory": True}},

    # WEAPONS (12)
    {"id": "wpn_1", "name": "Sagittae", "subtitle": "Arrows", "category": "Weapons", "subcategory": "Weapons", "track": "Weapons", "blocks": 1, "guards": 0, "sell": [120, 75, 47, 31, 18], "buy": [40, 30, 20, 14, 8], "combatText": "Pre-roll 1(R) CP strike (destroyed if used)", "combat": {"dice": 1, "negDice": 0, "flat": 0, "consumable": True, "preRollStrike": True}},
    {"id": "wpn_2", "name": "Scutae", "subtitle": "Shields", "category": "Weapons", "subcategory": "Weapons", "track": "Weapons", "blocks": 2, "guards": 0, "sell": [130, 90, 50, 36, 22], "buy": [70, 54, 32, 26, 15], "combatText": "Ignore (R) Wounds", "combat": {"dice": 0, "negDice": 0, "flat": 0, "ignoreWoundsDice": 1}},
    {"id": "wpn_3", "name": "Pugiones", "subtitle": "Daggers", "category": "Weapons", "subcategory": "Weapons", "track": "Weapons", "blocks": 1, "guards": 0, "sell": [110, 76, 43, 28, 18], "buy": [56, 42, 25, 21, 13], "combatText": "2 -1(R) CP", "combat": {"dice": 0, "negDice": 1, "flat": 2}},
    {"id": "wpn_4", "name": "Gladii", "subtitle": "Shortswords", "category": "Weapons", "subcategory": "Weapons", "track": "Weapons", "blocks": 2, "guards": 0, "sell": [156, 98, 67, 45, 30], "buy": [84, 62, 38, 32, 24], "combatText": "1(R) CP", "combat": {"dice": 1, "negDice": 0, "flat": 0}},
    {"id": "wpn_5", "name": "Hastae", "subtitle": "Spears", "category": "Weapons", "subcategory": "Weapons", "track": "Weapons", "blocks": 3, "guards": 0, "sell": [155, 120, 66, 44, 28], "buy": [110, 80, 47, 40, 29], "combatText": "2(R) CP", "combat": {"dice": 2, "negDice": 0, "flat": 0}},
    {"id": "wpn_6", "name": "Spathae", "subtitle": "Swords", "category": "Weapons", "subcategory": "Weapons", "track": "Weapons", "blocks": 2, "guards": 0, "sell": [200, 160, 80, 56, 34], "buy": [120, 85, 50, 44, 30], "combatText": "1(R) +1 CP", "combat": {"dice": 1, "negDice": 0, "flat": 1}},
    {"id": "wpn_7", "name": "Manicae", "subtitle": "Armguards", "category": "Weapons", "subcategory": "Weapons", "track": "Weapons", "blocks": 1, "guards": 0, "sell": [240, 180, 96, 65, 40], "buy": [140, 98, 57, 50, 36], "combatText": "Ignore 1 Wound", "combat": {"dice": 0, "negDice": 0, "flat": 0, "ignoreWoundsFlat": 1}},
    {"id": "wpn_8", "name": "Galeae", "subtitle": "Helmets", "category": "Weapons", "subcategory": "Weapons", "track": "Weapons", "blocks": 1, "guards": 0, "sell": [280, 200, 110, 78, 48], "buy": [162, 114, 63, 58, 42], "combatText": "Ignore 2 Wounds", "combat": {"dice": 0, "negDice": 0, "flat": 0, "ignoreWoundsFlat": 2}},
    {"id": "wpn_9", "name": "Arci", "subtitle": "Bows", "category": "Weapons", "subcategory": "Weapons", "track": "Weapons", "blocks": 2, "guards": 0, "sell": [304, 224, 122, 84, 52], "buy": [186, 126, 67, 62, 46], "combatText": "2(R) -1 CP", "combat": {"dice": 2, "negDice": 0, "flat": -1}},
    {"id": "wpn_10", "name": "Pilae", "subtitle": "Javelins", "category": "Weapons", "subcategory": "Weapons", "track": "Weapons", "blocks": 2, "guards": 0, "sell": [230, 150, 92, 64, 33], "buy": [90, 67, 43, 35, 20], "combatText": "1 CP (destroyed if used)", "combat": {"dice": 0, "negDice": 0, "flat": 1, "consumable": True}},
    {"id": "wpn_11", "name": "Pilae", "subtitle": "Javelins", "category": "Weapons", "subcategory": "Weapons", "track": "Weapons", "blocks": 2, "guards": 0, "sell": [230, 150, 92, 64, 33], "buy": [90, 67, 43, 35, 20], "combatText": "1 CP (destroyed if used)", "combat": {"dice": 0, "negDice": 0, "flat": 1, "consumable": True}},
    {"id": "wpn_12", "name": "Loricae", "subtitle": "Body Armor", "category": "Weapons", "subcategory": "Weapons", "track": "Weapons", "blocks": 3, "guards": 0, "sell": [438, 280, 175, 128, 62], "buy": [150, 112, 75, 58, 35], "combatText": None, "combat": None},

    # MARBLE (12)
    {"id": "mrb_1", "name": "Carrara", "category": "Marble", "subcategory": "Marble", "track": "Marble", "blocks": 2, "guards": 0, "sell": [330, 205, 128, 92, 46], "buy": [110, 82, 55, 42, 23]},
    {"id": "mrb_2", "name": "Carrara", "category": "Marble", "subcategory": "Marble", "track": "Marble", "blocks": 3, "guards": 0, "sell": [414, 262, 163, 119, 58], "buy": [140, 105, 70, 54, 32]},
    {"id": "mrb_3", "name": "Pavonazzetto", "category": "Marble", "subcategory": "Marble", "track": "Marble", "blocks": 2, "guards": 0, "sell": [360, 225, 140, 101, 50], "buy": [120, 90, 60, 46, 26]},
    {"id": "mrb_4", "name": "Pavonazzetto", "category": "Marble", "subcategory": "Marble", "track": "Marble", "blocks": 3, "guards": 0, "sell": [438, 280, 175, 128, 62], "buy": [150, 112, 75, 58, 35]},
    {"id": "mrb_5", "name": "Proconesio", "category": "Marble", "subcategory": "Marble", "track": "Marble", "blocks": 2, "guards": 0, "sell": [384, 245, 152, 110, 54], "buy": [130, 98, 65, 50, 29]},
    {"id": "mrb_6", "name": "Proconesio", "category": "Marble", "subcategory": "Marble", "track": "Marble", "blocks": 3, "guards": 0, "sell": [454, 300, 187, 136, 66], "buy": [160, 120, 80, 62, 38]},
    {"id": "mrb_7", "name": "Cipollino", "category": "Marble", "subcategory": "Marble", "track": "Marble", "blocks": 2, "guards": 0, "sell": [414, 262, 163, 119, 58], "buy": [140, 105, 70, 54, 32]},
    {"id": "mrb_8", "name": "Cipollino", "category": "Marble", "subcategory": "Marble", "track": "Marble", "blocks": 3, "guards": 0, "sell": [466, 314, 198, 145, 70], "buy": [170, 128, 85, 66, 42]},
    {"id": "mrb_9", "name": "Numidian", "category": "Marble", "subcategory": "Marble", "track": "Marble", "blocks": 2, "guards": 0, "sell": [438, 280, 175, 128, 62], "buy": [150, 112, 75, 58, 35]},
    {"id": "mrb_10", "name": "Numidian", "category": "Marble", "subcategory": "Marble", "track": "Marble", "blocks": 3, "guards": 0, "sell": [478, 324, 210, 154, 74], "buy": [180, 135, 90, 70, 47]},
    {"id": "mrb_11", "name": "Imperial Porphyry", "category": "Marble", "subcategory": "Marble", "track": "Marble", "blocks": 2, "guards": 0, "sell": [454, 300, 187, 136, 66], "buy": [160, 120, 80, 62, 38]},
    {"id": "mrb_12", "name": "Imperial Porphyry", "category": "Marble", "subcategory": "Marble", "track": "Marble", "blocks": 3, "guards": 0, "sell": [500, 360, 232, 180, 82], "buy": [200, 150, 100, 82, 60]},

    # GUARDS (12)
    {"id": "grd_1", "name": "Lucius", "category": "Guards", "subcategory": "Guard", "track": "Guards", "blocks": 0, "guards": 1, "sell": None, "buy": [60, 46, 24, 20, 18], "combatText": "(R) CP & +■■ Cart Space", "combat": {"dice": 1, "negDice": 0, "flat": 0}, "bonusBlocks": 2, "bonusGuards": 0},
    {"id": "grd_2", "name": "Servius", "category": "Guards", "subcategory": "Guard", "track": "Guards", "blocks": 0, "guards": 1, "sell": None, "buy": [70, 54, 30, 25, 22], "combatText": "(R) CP & +▲ Cart Space", "combat": {"dice": 1, "negDice": 0, "flat": 0}, "bonusBlocks": 0, "bonusGuards": 1},
    {"id": "grd_3", "name": "Pliny", "category": "Guards", "subcategory": "Guard", "track": "Guards", "blocks": 0, "guards": 1, "sell": None, "buy": [50, 38, 20, 17, 15], "combatText": "1 CP & Cheap Wines Sell at +1 Rarity", "combat": {"dice": 0, "negDice": 0, "flat": 1}, "rarityBonus": "Cheap Wine"},
    {"id": "grd_4", "name": "Rufus", "category": "Guards", "subcategory": "Guard", "track": "Guards", "blocks": 0, "guards": 1, "sell": None, "buy": [65, 50, 26, 23, 20], "combatText": "2 CP", "combat": {"dice": 0, "negDice": 0, "flat": 2}},
    {"id": "grd_5", "name": "Decimus", "category": "Guards", "subcategory": "Guard", "track": "Guards", "blocks": 0, "guards": 1, "sell": None, "buy": [60, 46, 24, 20, 18], "combatText": "(R) CP & Ignore 1 Wound", "combat": {"dice": 1, "negDice": 0, "flat": 0, "ignoreWoundsFlat": 1}},
    {"id": "grd_6", "name": "Manius", "category": "Guards", "subcategory": "Guard", "track": "Guards", "blocks": 0, "guards": 1, "sell": None, "buy": [30, 23, 15, 12, 10], "combatText": "1 CP", "combat": {"dice": 0, "negDice": 0, "flat": 1}},
    {"id": "grd_7", "name": "Agrippa", "category": "Guards", "subcategory": "Guard", "track": "Guards", "blocks": 0, "guards": 1, "sell": None, "buy": [55, 42, 22, 19, 17], "combatText": "2(R) - 1 CP", "combat": {"dice": 2, "negDice": 0, "flat": -1}},
    {"id": "grd_8", "name": "Marcus", "category": "Guards", "subcategory": "Guard", "track": "Guards", "blocks": 0, "guards": 1, "sell": None, "buy": [40, 30, 18, 15, 13], "combatText": "(R) CP", "combat": {"dice": 1, "negDice": 0, "flat": 0}},
    {"id": "grd_9", "name": "Paolo", "category": "Guards", "subcategory": "Guard", "track": "Guards", "blocks": 0, "guards": 1, "sell": None, "buy": [80, 62, 40, 35, 30], "combatText": "2(R) CP", "combat": {"dice": 2, "negDice": 0, "flat": 0}},
    {"id": "grd_10", "name": "Michele", "category": "Guards", "subcategory": "Guard", "track": "Guards", "blocks": 0, "guards": 1, "sell": None, "buy": [75, 58, 34, 30, 26], "combatText": "(R) + 1 CP", "combat": {"dice": 1, "negDice": 0, "flat": 1}},
    {"id": "grd_11", "name": "Gnaeus", "category": "Guards", "subcategory": "Guard", "track": "Guards", "blocks": 0, "guards": 1, "sell": None, "buy": [55, 42, 22, 19, 17], "combatText": "(R) CP & Meat Animals Sell at +1 Rarity", "combat": {"dice": 1, "negDice": 0, "flat": 0}, "rarityBonus": "Meat Animals"},
    {"id": "grd_12", "name": "Gordianus", "category": "Guards", "subcategory": "Guard", "track": "Guards", "blocks": 0, "guards": 1, "sell": None, "buy": [40, 30, 18, 15, 13], "combatText": "(R) CP", "combat": {"dice": 1, "negDice": 0, "flat": 0}},
]

# MISSIONES (53 cards across Missiones1.jpg, Missiones2.jpg, Missiones3.jpg)
MISSIONES_CARDS = [
    # --- Missiones1.jpg (21 cards) ---
    {"id": "mis_1", "name": "Patronize The Arts", "kind": "sell", "category": "Marble", "modifier": ">>", "cell": "DI", "rewardText": "Any Wine on Mkt", "reward": {"type": "market_pick", "track": "Wine", "mode": "any"}, "favor": ["Domna"]},
    {"id": "mis_2", "name": "Javelins For The Games", "kind": "delivery", "item": "Pilae", "category": "Weapons", "blocks": 2, "combatText": "1 CP (destroyed if used)", "combat": {"dice": 0, "negDice": 0, "flat": 1, "consumable": True}, "pickupCell": "BVI", "deliverCell": "BIII", "fencedSell": [190, 110, 80, 50, 35], "rewardText": "50(d)", "reward": {"type": "cash", "amount": 50}, "favor": []},
    {"id": "mis_3", "name": "Royal Statue", "kind": "sell", "category": "Marble", "modifier": "<", "cell": "BV", "rewardText": "Domna Favor", "reward": {"type": "none"}, "favor": ["Domna"]},
    {"id": "mis_4", "name": "Price Gouge Grapes", "kind": "sell", "category": "Cheap Wine", "modifier": "<<", "cell": "DIV", "rewardText": "Geta Favor (-Domna)", "reward": {"type": "none"}, "favor": ["-Domna", "Geta"]},
    {"id": "mis_5", "name": "Feed The Plebes", "kind": "sell", "category": "Grain", "modifier": "=", "cell": "BIV", "rewardText": "1 Influence Card", "reward": {"type": "influence", "count": 1}, "favor": ["Plautilla"]},
    {"id": "mis_6", "name": "Feed The Plebes", "kind": "sell", "category": "Grain", "modifier": ">>", "cell": "EII", "rewardText": "1 Influence Card", "reward": {"type": "influence", "count": 1}, "favor": ["Plautilla"]},
    {"id": "mis_7", "name": "Notte Bianca", "kind": "expose", "exposeType": "patricii", "exposeCount": 4, "description": "Expose 4 Patricii (4 individual saffron Patricii icons visible on exposed tiles)", "rewardText": "80(d)", "reward": {"type": "cash", "amount": 80}, "favor": ["Domna"]},
    {"id": "mis_8", "name": "Sate The Plebes", "kind": "sell", "category": "Cheap Wine", "modifier": "=", "cell": "CVI", "rewardText": "1 Influence Card", "reward": {"type": "influence", "count": 1}, "favor": ["Plautilla"]},
    {"id": "mis_9", "name": "Uber Drinks", "kind": "delivery", "item": "Ceretanum", "category": "Cheap Wine", "blocks": 1, "pickupCell": "AV", "deliverCell": "CI", "fencedSell": [160, 100, 65, 40, 30], "rewardText": "60(d)", "reward": {"type": "cash", "amount": 60}, "favor": []},
    {"id": "mis_10", "name": "Price Gouge Grain", "kind": "sell", "category": "Grain", "modifier": "<", "cell": "CI", "rewardText": "20(d)", "reward": {"type": "cash", "amount": 20}, "favor": []},
    {"id": "mis_11", "name": "Sports", "kind": "sell", "category": "Exotic Animals", "modifier": ">", "cell": "AII", "rewardText": "Top card of Goods deck", "reward": {"type": "top_good"}, "favor": ["Caracalla", "Geta"]},
    {"id": "mis_12", "name": "Animal Sacrifice", "kind": "sell", "category": "Meat Animals", "modifier": "<", "cell": "CII", "rewardText": "1 Influence Card", "reward": {"type": "influence", "count": 1}, "favor": ["Aurelius"]},
    {"id": "mis_13", "name": "Sate The Plebes", "kind": "sell", "category": "Cheap Wine", "modifier": ">", "cell": "DII", "rewardText": "Cheapest Guard on Mkt", "reward": {"type": "market_pick", "track": "Guards", "mode": "cheapest"}, "favor": []},
    {"id": "mis_14", "name": "Feast", "kind": "sell", "category": "Meat Animals", "modifier": ">", "cell": "EI", "rewardText": "Cheapest Weapon on Mkt", "reward": {"type": "market_pick", "track": "Weapons", "mode": "cheapest"}, "favor": ["Geta"]},
    {"id": "mis_15", "name": "Grain Delivery", "kind": "delivery", "item": "Spelt", "category": "Grain", "blocks": 2, "pickupCell": "EVI", "deliverCell": "FIV", "fencedSell": [100, 67, 40, 26, 18], "rewardText": "1 Influence Card", "reward": {"type": "influence", "count": 1}, "favor": []},
    {"id": "mis_16", "name": "Arm The Vigiles", "kind": "sell", "category": "Weapons", "modifier": ">>", "cell": "AIV", "rewardText": "Cheapest Meat A on Mkt", "reward": {"type": "market_pick", "track": "Animals", "subcategory": "Meat Animals", "mode": "cheapest"}, "favor": ["Aurelius"]},
    {"id": "mis_17", "name": "Rhino Racing", "kind": "delivery", "item": "Rhinoceros", "category": "Exotic Animals", "blocks": 4, "combatText": "3(R) -4 CP", "combat": {"dice": 3, "negDice": 0, "flat": -4, "mandatory": True}, "pickupCell": "FIII", "deliverCell": "AII", "fencedSell": [380, 250, 140, 90, 50], "rewardText": "(R) x 100(d)", "reward": {"type": "dice_cash", "multiplier": 100}, "favor": []},
    {"id": "mis_18", "name": "Hunting Games", "kind": "sell", "category": "Exotic Animals", "modifier": "<", "cell": "BIII", "rewardText": "Caracalla & Geta Favor", "reward": {"type": "none"}, "favor": ["Caracalla", "Geta"]},
    {"id": "mis_19", "name": "Shields For The Cohortes Urbanae", "kind": "delivery", "item": "Scutae", "category": "Weapons", "blocks": 2, "combatText": "Ignore (R) Wounds", "combat": {"dice": 0, "negDice": 0, "flat": 0, "ignoreWoundsDice": 1}, "pickupCell": "BVI", "deliverCell": "CII", "fencedSell": [130, 90, 50, 36, 22], "rewardText": "20(d) & 1 Influence Card", "reward": {"type": "cash_and_influence", "amount": 20, "count": 1}, "favor": []},
    {"id": "mis_20", "name": "Wine Delivery", "kind": "delivery", "item": "Opimian", "category": "Fine Wine", "blocks": 1, "pickupCell": "DIII", "deliverCell": "BV", "fencedSell": [400, 300, 200, 150, 74], "rewardText": "Cheapest Mkt Marble", "reward": {"type": "market_pick", "track": "Marble", "mode": "cheapest"}, "favor": ["-Caracalla", "Aurelius"]},
    {"id": "mis_21", "name": "Conspire", "kind": "sell", "category": "Weapons", "modifier": ">", "cell": "BI", "rewardText": "Any Cheap W on Mkt", "reward": {"type": "market_pick", "track": "Wine", "subcategory": "Cheap Wine", "mode": "any"}, "favor": ["Plautilla"]},

    # --- Missiones2.jpg (21 cards) ---
    {"id": "mis_22", "name": "Vigilante", "kind": "kill", "targetDeck": "Nefarii", "description": "Kill a Nefarius in Combat", "rewardText": "Any Meat A on Mkt", "reward": {"type": "market_pick", "track": "Animals", "subcategory": "Meat Animals", "mode": "any"}, "favor": ["Caracalla"]},
    {"id": "mis_23", "name": "Armor For The Guards", "kind": "delivery", "item": "Galeae", "category": "Weapons", "blocks": 1, "combatText": "Ignore 2 Wounds", "combat": {"dice": 0, "negDice": 0, "flat": 0, "ignoreWoundsFlat": 2}, "pickupCell": "FI", "deliverCell": "AIV", "fencedSell": [160, 110, 65, 55, 40], "rewardText": "60(d)", "reward": {"type": "cash", "amount": 60}, "favor": []},
    {"id": "mis_24", "name": "Marble Delivery", "kind": "delivery", "item": "Imperial Porphyry", "category": "Marble", "blocks": 2, "pickupCell": "FIII", "deliverCell": "BII", "fencedSell": [380, 260, 157, 116, 66], "rewardText": "Priciest Mkt Guard", "reward": {"type": "market_pick", "track": "Guards", "mode": "priciest"}, "favor": ["-Geta", "Caracalla"]},
    {"id": "mis_25", "name": "Chariot Games", "kind": "sell", "category": "Exotic Animals", "modifier": "=", "cell": "CV", "rewardText": "Any Weapon on Mkt", "reward": {"type": "market_pick", "track": "Weapons", "mode": "any"}, "favor": ["Caracalla", "Geta"]},
    {"id": "mis_26", "name": "Martial Law", "kind": "expose", "exposeType": "legiones", "exposeCount": 12, "description": "Expose 12 Legiones (12 individual red Legiones icons visible on exposed tiles)", "rewardText": "200(d)", "reward": {"type": "cash", "amount": 200}, "favor": ["Caracalla", "Geta"]},
    {"id": "mis_27", "name": "Poultry Delivery", "kind": "delivery", "item": "Chickens", "category": "Meat Animals", "blocks": 1, "pickupCell": "CI", "deliverCell": "DV", "fencedSell": [95, 60, 35, 26, 20], "rewardText": "30(d)", "reward": {"type": "cash", "amount": 30}, "favor": []},
    {"id": "mis_28", "name": "Decorate The Baths", "kind": "sell", "category": "Marble", "modifier": "=", "cell": "DVI", "rewardText": "Caracalla Favor", "reward": {"type": "none"}, "favor": ["Caracalla"]},
    {"id": "mis_29", "name": "Grain Delivery", "kind": "delivery", "item": "Durum", "category": "Grain", "blocks": 2, "pickupCell": "CVI", "deliverCell": "DIII", "fencedSell": [98, 60, 37, 25, 16], "rewardText": "(R) Influence Cards", "reward": {"type": "dice_influence", "dice": 1}, "favor": []},
    {"id": "mis_30", "name": "Arm The Praetoriane", "kind": "sell", "category": "Weapons", "modifier": "<<", "cell": "EIV", "rewardText": "Caracalla Favor (-Plautilla)", "reward": {"type": "none"}, "favor": ["-Plautilla", "Caracalla"]},
    {"id": "mis_31", "name": "Seafood Delivery", "kind": "delivery", "item": "Oysters", "category": "Meat Animals", "blocks": 1, "pickupCell": "BIV", "deliverCell": "FII", "fencedSell": [120, 80, 50, 45, 30], "rewardText": "50(d)", "reward": {"type": "cash", "amount": 50}, "favor": []},
    {"id": "mis_32", "name": "Feast", "kind": "sell", "category": "Meat Animals", "modifier": "=", "cell": "EVI", "rewardText": "30(d)", "reward": {"type": "cash", "amount": 30}, "favor": ["Geta"]},
    {"id": "mis_33", "name": "Price Gouge Grain", "kind": "sell", "category": "Grain", "modifier": "<<", "cell": "DIII", "rewardText": "10(d)", "reward": {"type": "cash", "amount": 10}, "favor": ["-Caracalla", "Geta"]},
    {"id": "mis_34", "name": "Regicide", "kind": "kill_emperor", "description": "Kill the Emperor (Completed if either Geta or Caracalla is killed by any Player)", "rewardText": "You Win The Game", "reward": {"type": "win_game"}, "favor": []},
    {"id": "mis_35", "name": "Uber Drinks", "kind": "delivery", "item": "Falernian", "category": "Fine Wine", "blocks": 1, "pickupCell": "DI", "deliverCell": "FIV", "fencedSell": [160, 100, 65, 40, 30], "rewardText": "60(d)", "reward": {"type": "cash", "amount": 60}, "favor": []},
    {"id": "mis_36", "name": "Hunting Games", "kind": "delivery", "item": "Deer", "category": "Exotic Animals", "blocks": 2, "pickupCell": "EVI", "deliverCell": "AII", "fencedSell": [80, 60, 40, 30, 16], "rewardText": "(R) x 50(d)", "reward": {"type": "dice_cash", "multiplier": 50}, "favor": []},
    {"id": "mis_37", "name": "Revolt", "kind": "kill", "targetDeck": "Legiones", "description": "Kill a Legionary in Combat", "rewardText": "Cheapest Fine W on Mkt", "reward": {"type": "market_pick", "track": "Wine", "subcategory": "Fine Wine", "mode": "cheapest"}, "favor": ["Plautilla"]},
    {"id": "mis_38", "name": "Wine Delivery", "kind": "delivery", "item": "Cretan", "category": "Cheap Wine", "blocks": 1, "pickupCell": "BII", "deliverCell": "CV", "fencedSell": [210, 130, 82, 57, 30], "rewardText": "20(d) & 1 Influence Card", "reward": {"type": "cash_and_influence", "amount": 20, "count": 1}, "favor": []},
    {"id": "mis_39", "name": "Arm The Cohortes Urbanes", "kind": "sell", "category": "Weapons", "modifier": "=", "cell": "BVI", "rewardText": "Cheapest Meat A on Mkt", "reward": {"type": "market_pick", "track": "Animals", "subcategory": "Meat Animals", "mode": "cheapest"}, "favor": ["Aurelius"]},
    {"id": "mis_40", "name": "Quid Pro Quo", "kind": "sell", "category": "Fine Wine", "modifier": ">", "cell": "AV", "rewardText": "Cheapest Exotic A on Mkt", "reward": {"type": "market_pick", "track": "Animals", "subcategory": "Exotic Animals", "mode": "cheapest"}, "favor": ["Aurelius"]},
    {"id": "mis_41", "name": "City Of Thieves", "kind": "expose", "exposeType": "nefarii", "exposeCount": 8, "description": "Expose 8 Nefarii (8 individual black Nefarii icons visible on exposed tiles)", "rewardText": "130(d)", "reward": {"type": "cash", "amount": 130}, "favor": ["Plautilla"]},
    {"id": "mis_42", "name": "Patronize The Arts", "kind": "sell", "category": "Marble", "modifier": ">", "cell": "EIII", "rewardText": "Any Exotic A on Mkt", "reward": {"type": "market_pick", "track": "Animals", "subcategory": "Exotic Animals", "mode": "any"}, "favor": ["Domna"]},

    # --- Missiones3.jpg (11 cards) ---
    {"id": "mis_43", "name": "Sacrificial Lamb", "kind": "delivery", "item": "Lamb", "category": "Meat Animals", "blocks": 2, "pickupCell": "FIV", "deliverCell": "CII", "fencedSell": [160, 100, 63, 44, 24], "rewardText": "20(d) & 1 Influence Card", "reward": {"type": "cash_and_influence", "amount": 20, "count": 1}, "favor": []},
    {"id": "mis_44", "name": "Wine Merchant", "kind": "sell", "category": "Fine Wine", "modifier": "=", "cell": "FIV", "rewardText": "1 Influence Card", "reward": {"type": "influence", "count": 1}, "favor": ["Aurelius"]},
    {"id": "mis_45", "name": "Arm The Uprising", "kind": "sell", "category": "Weapons", "modifier": "<", "cell": "EV", "rewardText": "Cheapest Cheap W on Mkt", "reward": {"type": "market_pick", "track": "Wine", "subcategory": "Cheap Wine", "mode": "cheapest"}, "favor": ["Plautilla"]},
    {"id": "mis_46", "name": "Royal Banquet Wine", "kind": "sell", "category": "Fine Wine", "modifier": "<", "cell": "DV", "rewardText": "Geta Favor", "reward": {"type": "none"}, "favor": ["Geta"]},
    {"id": "mis_47", "name": "Wine Delivery", "kind": "delivery", "item": "Hadrianum", "category": "Fine Wine", "blocks": 1, "pickupCell": "CIII", "deliverCell": "FII", "fencedSell": [370, 240, 170, 120, 68], "rewardText": "Cheapest Mkt Animal", "reward": {"type": "market_pick", "track": "Animals", "mode": "cheapest"}, "favor": ["-Plautilla", "Caracalla"]},
    {"id": "mis_48", "name": "Wine For The Theater", "kind": "sell", "category": "Cheap Wine", "modifier": "<", "cell": "AIII", "rewardText": "10(d)", "reward": {"type": "cash", "amount": 10}, "favor": ["Geta"]},
    {"id": "mis_49", "name": "Assassin", "kind": "kill", "targetDeck": "Patricii", "description": "Kill a Patricius in Combat", "rewardText": "50(d) & 1 Influence Card", "reward": {"type": "cash_and_influence", "amount": 50, "count": 1}, "favor": ["Caracalla"]},
    {"id": "mis_50", "name": "Festival Wine", "kind": "sell", "category": "Fine Wine", "modifier": ">>", "cell": "BII", "rewardText": "(R)(R) Influence Cards", "reward": {"type": "dice_influence", "dice": 2}, "favor": []},
    {"id": "mis_51", "name": "Regime Change", "kind": "kill_emperor_cancel", "description": "Kill the Emperor (Completed if either Geta or Caracalla is killed by any Player)", "rewardText": "100(d) & Cancels all active regicide missions", "reward": {"type": "regime_change", "amount": 100}, "favor": []},
    {"id": "mis_52", "name": "Wine Delivery", "kind": "delivery", "item": "Narbo", "category": "Cheap Wine", "blocks": 1, "pickupCell": "BIV", "deliverCell": "EVI", "fencedSell": [120, 75, 47, 31, 18], "rewardText": "30(d)", "reward": {"type": "cash", "amount": 30}, "favor": []},
    {"id": "mis_53", "name": "Sate The Plebes", "kind": "sell", "category": "Cheap Wine", "modifier": ">>", "cell": "FIII", "rewardText": "2 Influence Cards", "reward": {"type": "influence", "count": 2}, "favor": []},
]

os.makedirs("src/data", exist_ok=True)
with open("src/data/market_and_missions.json", "w", encoding="utf-8") as f:
    json.dump({"market": MARKET_CARDS, "missiones": MISSIONES_CARDS}, f, indent=2)

print(f"Wrote {len(MARKET_CARDS)} market cards and {len(MISSIONES_CARDS)} missiones cards.")
