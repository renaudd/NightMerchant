# Copyright (c) 2026 Dashiell Renaud (https://dashiellrenaud.com)
# Licensed under Creative Commons Attribution-NonCommercial-NoDerivatives 4.0
# International (CC BY-NC-ND 4.0): https://creativecommons.org/licenses/by-nc-nd/4.0/
# SPDX-License-Identifier: CC-BY-NC-ND-4.0

import copy
import json
import os
import re
import secrets
import time
from typing import Any, Dict, List, Optional, Tuple

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

ROME_DIE_FACES = [0, 0, 1, 1, 2, 3]

GATE_CELLS = ["B1", "E1", "F3", "F6", "B6", "A4"]
FORUM_CELLS = ["C3", "D3", "D4"]

COLS = ["A", "B", "C", "D", "E", "F"]
ROWS = ["1", "2", "3", "4", "5", "6"]
LEGACY_ROMAN_TO_ARABIC_ROW = {"I": "1", "II": "2", "III": "3", "IV": "4", "V": "5", "VI": "6"}

ALL_CELLS = [
    f"{c}{r}"
    for r in ROWS
    for c in COLS
]

WEST_BANK_CELLS = {"A1", "A4", "B4", "A5"}
TIBER_BRIDGE_NAMES = {
    frozenset({"A1", "B1"}): "Pons Milvius",
    frozenset({"A1", "A2"}): "Pons Aelius",
    frozenset({"A3", "A4"}): "Pons Aurelius",
    frozenset({"B4", "C4"}): "Pons Fabricius",
    frozenset({"B4", "B5"}): "Pons Aemilius",
}
TIBER_BRIDGES = set(TIBER_BRIDGE_NAMES.keys())

_B1_CANONICAL_WEST_ROUTES: Dict[int, str] = {
    1: "green",
    2: "toll_2",
    3: "green",
    4: "legiones_1",
    5: "green",
    6: "red",
    7: "toll_2",
    8: "green",
    9: "soothsayer",
    10: "green",
    11: "red",
}

_A1_CANONICAL_EAST_ROUTES: Dict[int, str] = {
    1: "green",
    2: "toll_2",
    3: "green",
    4: "red",
    5: "legiones_1",
    6: "green",
    7: "toll_2",
    8: "nefarii_1",
    9: "red",
    10: "green",
    11: "mob",
}

MAX_GAMBLE_WAGER = 20

NEIGHBORHOOD_NAMES = {
    "A1": "Mausoleum Hadriani", "B1": "Via Flaminia", "C1": "Mons Pincius", "D1": "Horti Sallustiani", "E1": "Via Nomentana", "F1": "Castra Praetoria",
    "A2": "Circus Agonalis", "B2": "Thermae Neronae", "C2": "Septa Julia", "D2": "Collis Quirinalis", "E2": "Subura", "F2": "Collis Viminalis",
    "A3": "Theatrum Pompeii", "B3": "Circus Flaminius", "C3": "Forum Traiani", "D3": "Forum Augustum", "E3": "Thermae Traiani", "F3": "Via Tiburtina",
    "A4": "Via Aurelia", "B4": "Trans Tiberim", "C4": "Mons Capitolinus", "D4": "Forum Vespasiani", "E4": "Amphitheatrum Flavium", "F4": "Collis Esquilinus",
    "A5": "Horti Caesaris", "B5": "Aventinus Major", "C5": "Circus Maximus", "D5": "Mons Palatinus", "E5": "Sucusa", "F5": "Amphitheatrum Castrense",
    "A6": "Mons Testaceus", "B6": "Via Ostiensis", "C6": "Aventinus Minor", "D6": "Thermae Antoninianae", "E6": "Caeliolus", "F6": "Via Tusculana",
}

DIR_DELTAS = {
    "N": (0, -1),
    "NE": (1, -1),
    "E": (1, 0),
    "SE": (1, 1),
    "S": (0, 1),
    "SW": (-1, 1),
    "W": (-1, 0),
    "NW": (-1, -1),
}

TRACK_NAMES = ["Grain", "Animals", "Wine", "Weapons", "Marble", "Guards"]
COL_TO_PRICE_INDEX = [0, 1, 2, 2, 3, 4]
SCARCITY_LABELS = ["Precious (<<)", "Rare (<)", "Uncommon (=)", "Common (>)", "Abundant (>>)"]
SCARCITY_SYMBOLS = ["<<", "<", "=", ">", ">>"]
MODIFIER_DELTAS = {
    "++": -2,
    "+": -1,
    "=": 0,
    "-": 1,
    "--": 2,
    "<<": -2,
    "<": -1,
    ">": 1,
    ">>": 2,
}
MODIFIER_DISPLAY_MAP = {
    "<<": "++",
    "<": "+",
    "=": "=",
    ">": "-",
    ">>": "--",
    "++": "++",
    "+": "+",
    "-": "-",
    "--": "--",
}


def normalize_scarcity_modifier(mod: Optional[str]) -> str:
    if not mod:
        return "="
    return MODIFIER_DISPLAY_MAP.get(str(mod).strip(), str(mod).strip())


_RELATIVE_AT_SCARCITY_RE = re.compile(r"\bat\s+(<<|<|>>|>)(?=\s|[.,;)]|$)")


def _normalize_relative_scarcity_text(txt: Optional[str]) -> str:
    if not txt or not isinstance(txt, str):
        return txt or ""
    return _RELATIVE_AT_SCARCITY_RE.sub(
        lambda m: f"at {MODIFIER_DISPLAY_MAP.get(m.group(1), m.group(1))}",
        txt,
    )


_STATIC_CARD_CACHE: Optional[Dict[str, Any]] = None


def _get_static_card_maps() -> Dict[str, Any]:
    global _STATIC_CARD_CACHE
    if _STATIC_CARD_CACHE is not None:
        return _STATIC_CARD_CACHE
    enc_by_id: Dict[str, Dict[str, Any]] = {}
    enc_by_name: Dict[str, Dict[str, Any]] = {}
    mis_by_id: Dict[str, Dict[str, Any]] = {}
    decks_path = os.path.join(DATA_DIR, "decks.json")
    if os.path.exists(decks_path):
        with open(decks_path, "r", encoding="utf-8") as f:
            dk_raw = json.load(f)
        for dk_name in ("patricii", "legiones", "nefarii"):
            for c in dk_raw.get(dk_name, []):
                if isinstance(c, dict) and c.get("id"):
                    c_cp = copy.deepcopy(c)
                    c_cp["deck"] = dk_name
                    enc_by_id[str(c_cp["id"])] = c_cp
                    if c_cp.get("name"):
                        enc_by_name[str(c_cp["name"]).strip().lower()] = c_cp
    mm_path = os.path.join(DATA_DIR, "market_and_missions.json")
    if os.path.exists(mm_path):
        with open(mm_path, "r", encoding="utf-8") as f:
            mm_raw = json.load(f)
        for m in mm_raw.get("missiones", []):
            if isinstance(m, dict) and m.get("id"):
                mis_by_id[str(m["id"])] = copy.deepcopy(m)
    _STATIC_CARD_CACHE = {
        "enc_by_id": enc_by_id,
        "enc_by_name": enc_by_name,
        "mis_by_id": mis_by_id,
    }
    return _STATIC_CARD_CACHE


def _infer_encounter_deck_key(card: Optional[Dict[str, Any]]) -> str:
    if not isinstance(card, dict):
        return "patricii"
    dk = str(card.get("deck") or "").strip().lower()
    if dk in ("patricii", "legiones", "nefarii"):
        return dk
    cid = str(card.get("id") or "").strip().lower()
    if cid.startswith("leg_"):
        return "legiones"
    if cid.startswith("nef_"):
        return "nefarii"
    return "patricii"



def normalize_cell_id(cell: Optional[str]) -> Optional[str]:
    if not cell or not isinstance(cell, str):
        return cell
    s = cell.strip().upper()
    if len(s) >= 2 and s[0] in COLS:
        rest = s[1:]
        if rest in ROWS:
            return f"{s[0]}{rest}"
        if rest in LEGACY_ROMAN_TO_ARABIC_ROW:
            return f"{s[0]}{LEGACY_ROMAN_TO_ARABIC_ROW[rest]}"
    return cell


def parse_edge_toll(edge_val: Optional[str]) -> Optional[int]:
    if not edge_val or not isinstance(edge_val, str):
        return None
    m = re.match(r"^toll_(\d+)$", edge_val.strip())
    return int(m.group(1)) if m else None


def is_tiber_crossing_blocked(from_cell: Optional[str], target_cell: Optional[str]) -> bool:
    src = normalize_cell_id(from_cell)
    dst = normalize_cell_id(target_cell)
    if not src or not dst:
        return False
    if (src in WEST_BANK_CELLS) != (dst in WEST_BANK_CELLS):
        return frozenset({src, dst}) not in TIBER_BRIDGES
    return False


def get_tiber_bridge_name(from_cell: Optional[str], target_cell: Optional[str]) -> Optional[str]:
    src = normalize_cell_id(from_cell)
    dst = normalize_cell_id(target_cell)
    if not src or not dst:
        return None
    return TIBER_BRIDGE_NAMES.get(frozenset({src, dst}))


def get_effective_tile_edges(coord: str, tile: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not tile or not isinstance(tile.get("edges"), dict):
        return {}
    src = normalize_cell_id(coord) or coord
    idx = int(tile.get("index", 0) or 0)
    if tile.get("refresh") and idx == 12 and src not in FORUM_CELLS:
        return {}
    edges = dict(tile.get("edges") or {})
    tid = str(tile.get("id") or "")
    if tid in ("AII9", "AV9", "A2_9", "A5_9") and "W" in edges:
        del edges["W"]
    if tid in ("FVI4", "F6_4") and "S" in edges:
        del edges["S"]
    if src == "A2" and "NW" in edges:
        edges["N"] = edges.pop("NW")
    if src == "B1" and idx in _B1_CANONICAL_WEST_ROUTES and "W" not in edges:
        edges["W"] = _B1_CANONICAL_WEST_ROUTES[idx]
    if src == "A1":
        if "N" in edges and "W" in edges:
            del edges["N"]
        if idx in _A1_CANONICAL_EAST_ROUTES and "SE" in tile.get("edges", {}):
            # Upgrade legacy pre-Pons-Milvius saved tiles that had E: red + SE: red
            edges["E"] = _A1_CANONICAL_EAST_ROUTES[idx]
    if len(src) == 2 and src[0] in COLS and src[1] in ROWS:
        ci = COLS.index(src[0])
        ri = ROWS.index(src[1])
        for d in ("NE", "SE", "SW", "NW"):
            if d in edges:
                nc = ci + DIR_DELTAS[d][0]
                nr = ri + DIR_DELTAS[d][1]
                if 0 <= nc < len(COLS) and 0 <= nr < len(ROWS):
                    tc = f"{COLS[nc]}{ROWS[nr]}"
                    if (src in WEST_BANK_CELLS) != (tc in WEST_BANK_CELLS):
                        del edges[d]
    return edges


TURN_HOURS = [
    "Turn 1 — 8:00 P.M. - 9:00 P.M.",
    "Turn 2 — 9:00 P.M. - 10:00 P.M.",
    "Turn 3 — 10:00 P.M. - 11:00 P.M.",
    "Turn 4 — 11:00 P.M. - 12:00 A.M.",
    "Turn 5 — 12:00 A.M. - 1:00 A.M.",
    "Turn 6 — 1:00 A.M. - 2:00 A.M.",
    "Turn 7 — 2:00 A.M. - 3:00 A.M.",
    "Turn 8 — 3:00 A.M. - 4:00 A.M.",
    "Turn 9 — 4:00 A.M. - 5:00 A.M.",
    "Turn 10 — 5:00 A.M. - 6:00 A.M. (Sunrise)",
]

FACTIONS = ["Caracalla", "Geta", "Domna", "Plautilla", "Aurelius"]

POLITICAL_CLIMATE_FACTORS: List[Dict[str, Any]] = [
    {"id": "Caracalla", "label": "Caracalla", "gemName": "Ruby", "subtitle": "Severan Co-Emperor"},
    {"id": "Geta", "label": "Geta", "gemName": "Emerald", "subtitle": "Rival Co-Emperor"},
    {"id": "Domna", "label": "Julia Domna", "gemName": "Diamond", "subtitle": "Empress Mother"},
    {"id": "Plautilla", "label": "Plautilla", "gemName": "Sapphire", "subtitle": "Exiled Augusta"},
    {"id": "Aurelius", "label": "Aurelians", "gemName": "Amethyst", "subtitle": "Old Senate Dynasty"},
    {"id": "Missions", "label": "Missions", "gemName": "Contracts", "subtitle": "Collegia & Patrons"},
]

POLITICAL_CLIMATE_OPTIONS: List[Dict[str, Any]] = [
    # Caracalla (Ruby)
    {
        "id": "caracalla_1",
        "factor": "Caracalla",
        "factorLabel": "Caracalla",
        "gemName": "Ruby",
        "optionNumber": 1,
        "timing": "endgame",
        "title": "Imperial Proscription",
        "shortText": "Least Caracalla favor is eliminated",
        "description": "End of game: Least Caracalla favor is eliminated.",
    },
    {
        "id": "caracalla_2",
        "factor": "Caracalla",
        "factorLabel": "Caracalla",
        "gemName": "Ruby",
        "optionNumber": 2,
        "timing": "endgame",
        "title": "Praetorian Backlash",
        "shortText": "-10d per +Ruby; +5d per -Ruby",
        "description": "End of game: Lose 10d per +Ruby; gain 5d per -Ruby.",
    },
    {
        "id": "caracalla_3",
        "factor": "Caracalla",
        "factorLabel": "Caracalla",
        "gemName": "Ruby",
        "optionNumber": 3,
        "timing": "midgame",
        "title": "Army Pay Hike",
        "shortText": "Legiones +2 CP; +1 CP per +Ruby",
        "description": "Legiones gain +2 CP. Each +Ruby gives your Cart +1 CP.",
    },
    # Geta (Emerald)
    {
        "id": "geta_1",
        "factor": "Geta",
        "factorLabel": "Geta",
        "gemName": "Emerald",
        "optionNumber": 1,
        "timing": "endgame",
        "title": "Brother's Grudge",
        "shortText": "Least Geta favor loses 25d",
        "description": "End of game: Least Geta favor loses 25d.",
    },
    {
        "id": "geta_2",
        "factor": "Geta",
        "factorLabel": "Geta",
        "gemName": "Emerald",
        "optionNumber": 2,
        "timing": "endgame",
        "title": "Jealous Brothers",
        "shortText": "+15d/+Emerald if Caracalla ≤ 0, -10d if ≥ +1; -5d/-Emerald",
        "description": "End of game: +15d per +Emerald if Caracalla ≤ 0, or -10d if ≥ +1; -5d per -Emerald.",
    },
    {
        "id": "geta_3",
        "factor": "Geta",
        "factorLabel": "Geta",
        "gemName": "Emerald",
        "optionNumber": 3,
        "timing": "midgame",
        "title": "Divided Tiber",
        "shortText": "Tiber Bridges cost 4d toll, waived with +1 Emerald",
        "description": "Tiber Bridges cost a 4d toll, waived with +1 Emerald or Shortcut.",
    },
    # Domna (Diamond)
    {
        "id": "domna_1",
        "factor": "Domna",
        "factorLabel": "Julia Domna",
        "gemName": "Diamond",
        "optionNumber": 1,
        "timing": "endgame",
        "title": "Imperial Patronage",
        "shortText": "Most Domna favor gains +20% wealth",
        "description": "End of game: Most Domna favor gains +20% wealth.",
    },
    {
        "id": "domna_2",
        "factor": "Domna",
        "factorLabel": "Julia Domna",
        "gemName": "Diamond",
        "optionNumber": 2,
        "timing": "endgame",
        "title": "Court Neutrality",
        "shortText": "-15d per +Diamond and -15d per -Diamond",
        "description": "End of game: Lose 15d per +Diamond and 15d per -Diamond.",
    },
    {
        "id": "domna_3",
        "factor": "Domna",
        "factorLabel": "Julia Domna",
        "gemName": "Diamond",
        "optionNumber": 3,
        "timing": "midgame",
        "title": "Empress Mediator",
        "shortText": "Exchange +Diamonds 1-for-1 for +Rubies or +Emeralds",
        "description": "Exchange +Diamonds 1-for-1 into +Rubies or +Emeralds anytime.",
    },
    # Plautilla (Sapphire)
    {
        "id": "plautilla_1",
        "factor": "Plautilla",
        "factorLabel": "Plautilla",
        "gemName": "Sapphire",
        "optionNumber": 1,
        "timing": "endgame",
        "title": "Exile's Informants",
        "shortText": "Most Plautilla favor steals 15d from wealthiest rival",
        "description": "End of game: Most Plautilla favor steals 15d from the wealthiest rival.",
    },
    {
        "id": "plautilla_2",
        "factor": "Plautilla",
        "factorLabel": "Plautilla",
        "gemName": "Sapphire",
        "optionNumber": 2,
        "timing": "endgame",
        "title": "Smuggled Dowry",
        "shortText": "+10d per completed Plautilla Mission",
        "description": "End of game: Gain 10d per completed Mission with +Sapphire or a Plautilla patron.",
    },
    {
        "id": "plautilla_3",
        "factor": "Plautilla",
        "factorLabel": "Plautilla",
        "gemName": "Sapphire",
        "optionNumber": 3,
        "timing": "midgame",
        "title": "Smuggler's Fence",
        "shortText": "Fenced cargo +1 Scarcity and no Mission failure",
        "description": "Fenced cargo sells +1 Scarcity step higher and does not fail the Mission.",
    },
    # Aurelians (Amethyst)
    {
        "id": "aurelius_1",
        "factor": "Aurelius",
        "factorLabel": "Aurelians",
        "gemName": "Amethyst",
        "optionNumber": 1,
        "timing": "endgame",
        "title": "Old Senate Purse",
        "shortText": "Most Aurelian favor gains 25d",
        "description": "End of game: Most Aurelian favor gains 25d.",
    },
    {
        "id": "aurelius_2",
        "factor": "Aurelius",
        "factorLabel": "Aurelians",
        "gemName": "Amethyst",
        "optionNumber": 2,
        "timing": "endgame",
        "title": "Choose a Side",
        "shortText": "+10d per +Amethyst and +10d per -Amethyst",
        "description": "End of game: Gain 10d per +Amethyst and 10d per -Amethyst.",
    },
    {
        "id": "aurelius_3",
        "factor": "Aurelius",
        "factorLabel": "Aurelians",
        "gemName": "Amethyst",
        "optionNumber": 3,
        "timing": "midgame",
        "title": "Senatorial Privilege",
        "shortText": "Spend +Amethysts when selling for +1 Scarcity per gem",
        "description": "Spend +Amethysts when selling a Good for +1 Scarcity step per gem.",
    },
    # Missions
    {
        "id": "missions_1",
        "factor": "Missions",
        "factorLabel": "Missions",
        "gemName": "Contracts",
        "optionNumber": 1,
        "timing": "endgame",
        "title": "Master Purveyor",
        "shortText": "Most completed Missions gains 30d",
        "description": "End of game: Most completed Missions gains 30d.",
    },
    {
        "id": "missions_2",
        "factor": "Missions",
        "factorLabel": "Missions",
        "gemName": "Contracts",
        "optionNumber": 2,
        "timing": "endgame",
        "title": "Guild Ledger",
        "shortText": "+10d per completed Mission; -10d per failed Mission",
        "description": "End of game: Gain 10d per completed Mission; lose 10d per failed or unfinished Mission.",
    },
    {
        "id": "missions_3",
        "factor": "Missions",
        "factorLabel": "Missions",
        "gemName": "Contracts",
        "optionNumber": 3,
        "timing": "midgame",
        "title": "Bonded Couriers",
        "shortText": "Completed Missions pay 2× cash; failed Missions fine 10d",
        "description": "Completed Missions pay 2× Denarii; failed or unfinished Missions fine 10d.",
    },
]

POLITICAL_CLIMATE_OPTION_MAP: Dict[str, Dict[str, Any]] = {
    opt["id"]: opt for opt in POLITICAL_CLIMATE_OPTIONS
}


def has_climate_modifier(state: Optional[Dict[str, Any]], option_id: str) -> bool:
    if not isinstance(state, dict):
        return False
    pc = state.get("politicalClimate")
    if not isinstance(pc, dict):
        return False
    return option_id in (pc.get("activeIds") or [])

BOT_PERSONAS = [
    {
        "id": "balanced",
        "name": "Marcus Mercator",
        "color": "Z1",
        "strategy": "balanced",
        "title": "Ostia Grain & Wine Syndic",
        "description": "Balanced ROI trader who keeps a steady Guard and cash reserve while fulfilling nearby contracts.",
    },
    {
        "id": "luxury",
        "name": "Cornelia Severa",
        "color": "Z7",
        "strategy": "luxury",
        "title": "Palatine Marble Purveyor",
        "description": "Targets high-margin Marble & Fine Wine, leverages seasonal Loans, and hunts +/++ scarcity sales.",
    },
    {
        "id": "aggressive",
        "name": "Titus Valerius",
        "color": "Z3",
        "strategy": "aggressive",
        "title": "Gladiator & Beasts Contractor",
        "description": "Recruits Guards, Weapons, & Exotic Beasts, pursues Combat contracts, and pressures the leader.",
    },
    {
        "id": "missions",
        "name": "Julia Lucilla",
        "color": "Z11",
        "strategy": "missions",
        "title": "Senatorial Courier",
        "description": "Dedicated courier who routes efficiently across Rome's bridges to fulfill Delivery & Sell Missions.",
    },
    {
        "id": "opportunist",
        "name": "Gaius Fulvius",
        "color": "Z9",
        "strategy": "opportunist",
        "title": "Subura Night Runner",
        "description": "Nimble smuggler who flips compact cargo, plays Influence aggressively, and wagers at Stadiums.",
    },
]


def roll_rome_die() -> int:
    return secrets.choice(ROME_DIE_FACES)


def crypto_shuffle(items: List[Any]) -> List[Any]:
    arr = copy.deepcopy(list(items))
    for i in range(len(arr) - 1, 0, -1):
        j = secrets.randbelow(i + 1)
        arr[i], arr[j] = arr[j], arr[i]
    return arr


def cell_to_xy(cell: str) -> Tuple[int, int]:
    norm = normalize_cell_id(cell) or "B1"
    col_char = norm[0]
    row_str = norm[1:]
    return COLS.index(col_char), ROWS.index(row_str)


def xy_to_cell(x: int, y: int) -> Optional[str]:
    if x < 0 or x >= 6 or y < 0 or y >= 6:
        return None
    return f"{COLS[x]}{ROWS[y]}"


def get_target_cell(from_cell: str, direction: str) -> Optional[str]:
    if direction not in DIR_DELTAS:
        return None
    x, y = cell_to_xy(from_cell)
    dx, dy = DIR_DELTAS[direction]
    return xy_to_cell(x + dx, y + dy)


def load_all_game_data() -> Dict[str, Any]:
    with open(os.path.join(DATA_DIR, "market_and_missions.json"), "r", encoding="utf-8") as f:
        mm = json.load(f)
    tiles_path = os.path.join(DATA_DIR, "tiles.json")
    decks_path = os.path.join(DATA_DIR, "decks.json")
    tiles_data = {}
    decks_data = {"patricii": [], "legiones": [], "nefarii": [], "influence": []}
    if os.path.exists(tiles_path):
        with open(tiles_path, "r", encoding="utf-8") as f:
            tiles_data = json.load(f)
    if os.path.exists(decks_path):
        with open(decks_path, "r", encoding="utf-8") as f:
            decks_data = json.load(f)
    return {
        "market": mm["market"],
        "missiones": mm["missiones"],
        "tiles": tiles_data,
        "patricii": decks_data.get("patricii", []),
        "legiones": decks_data.get("legiones", []),
        "nefarii": decks_data.get("nefarii", []),
        "influence": decks_data.get("influence", []),
    }


def get_track_scarcity_index(track_cards: List[Dict[str, Any]], bonus_shift: int = 0) -> int:
    """
    Base selling scarcity is determined by the symbol on the first empty space
    on the market board for that type of good:
    - 0 cards (6 empty spaces; 1st empty is Col 1 '<<') -> idx 0 ('<<')
    - 1 card  (5 empty spaces; 1st empty is Col 2 '<')  -> idx 1 ('<')
    - 2–3 cards (4–3 empty spaces; 1st empty is Col 3/4 '=') -> idx 2 ('=')
    - 4 cards (2 empty spaces; 1st empty is Col 5 '>')  -> idx 3 ('>')
    - 5–6 cards (1–0 empty spaces; 1st empty is Col 6 '>>') -> idx 4 ('>>')
    """
    count = len(track_cards)
    slot_col = min(5, max(0, count))
    idx = COL_TO_PRICE_INDEX[slot_col]
    return max(0, min(4, idx + bonus_shift))


def push_card_onto_market_track(state: Dict[str, Any], card: Dict[str, Any]) -> None:
    track_name = card["track"]
    track = state["marketBoard"][track_name]
    track.insert(0, card)
    if len(track) > 6:
        overflow = track.pop()
        state["decks"]["market"].append(overflow)


def get_player_cart_limits(player: Dict[str, Any]) -> Tuple[int, int]:
    max_blocks = 6 + player.get("bonusBlocks", 0)
    max_guards = 2 + player.get("bonusGuards", 0)
    for g in player["guards"]:
        max_blocks += g.get("bonusBlocks", 0)
        max_guards += g.get("bonusGuards", 0)
    return max_blocks, max_guards


def _resolve_track_for_category(cat: str) -> str:
    c = (cat or "").strip()
    if c in ("Cheap W", "Cheap Wine", "Fine W", "Fine Wine", "Fancy Wine", "Wine"):
        return "Wine"
    if c in ("Meat A", "Meat Animals", "Meat Animal", "Exotic A", "Exotic Animals", "Exotic Animal", "Animals", "Animal"):
        return "Animals"
    if c in ("Grain", "Weapons", "Marble", "Guards"):
        return c
    return "Grain"


def _create_mission_cargo_card(m: Dict[str, Any]) -> Dict[str, Any]:
    cat = m.get("category") or "Cargo"
    track = _resolve_track_for_category(cat)
    src = m.get("source") or "starting"
    # Only Encounter-assigned delivery mission cargo may be fenced; Starting & Soothsayer cargo cannot be sold
    fenced_sell = list(m.get("fencedSell") or []) if src == "encounter" else []
    return {
        "id": f"mcargo_{m.get('id', secrets.token_hex(2))}",
        "name": m.get("item") or m.get("name", "Mission Cargo"),
        "category": cat,
        "subcategory": cat,
        "track": track,
        "blocks": int(m.get("blocks", 1)),
        "guards": 0,
        "sell": fenced_sell,
        "buy": [0, 0, 0, 0, 0],
        "purchasePrice": 0,
        "combatText": m.get("combatText"),
        "combat": copy.deepcopy(m.get("combat")) if m.get("combat") else None,
        "isMissionCargo": True,
        "missionId": m.get("id"),
        "missionName": m.get("name"),
        "missionSource": src,
        "deliverCell": normalize_cell_id(m.get("deliverCell")),
    }


def get_player_cart_usage(player: Dict[str, Any]) -> Tuple[int, int]:
    # Reconcile any legacy pickedUp flags where no cargo card is present in player['cart']
    cart_mission_ids = {
        c.get("missionId")
        for c in player.get("cart", [])
        if c.get("isMissionCargo") and c.get("missionId")
    }
    for m in player.get("missions", []):
        if m.get("pickedUp") and not m.get("completed") and m.get("id") not in cart_mission_ids:
            m["pickedUp"] = False
    blocks_used = sum(int(item.get("blocks", 1)) for item in player.get("cart", []))
    guards_used = sum(int(g.get("guards", 1)) for g in player.get("guards", []))
    return blocks_used, guards_used


def calculate_faction_favor(player: Dict[str, Any], faction: Optional[str]) -> int:
    if not faction:
        return 0
    return player.get("favor", {}).get(faction, 0) + player.get("tempFavor", 0)


def apply_favor_list(player: Dict[str, Any], favor_list: List[str], reason: str = "") -> List[str]:
    applied = []
    fac_deltas: Dict[str, int] = {}
    for item in favor_list or []:
        if not item:
            continue
        if item.startswith("-"):
            fac = item[1:]
            if fac in FACTIONS:
                player["favor"][fac] = player["favor"].get(fac, 0) - 1
                applied.append(f"-1 {fac}")
                fac_deltas[fac] = fac_deltas.get(fac, 0) - 1
        else:
            fac = item[1:] if item.startswith("+") else item
            if fac in FACTIONS:
                player["favor"][fac] = player["favor"].get(fac, 0) + 1
                applied.append(f"+1 {fac}")
                fac_deltas[fac] = fac_deltas.get(fac, 0) + 1
    if fac_deltas:
        hist = player.setdefault("favorHistory", {f: [] for f in FACTIONS})
        for fac, delta in fac_deltas.items():
            if delta != 0:
                hist.setdefault(fac, []).append({
                    "delta": delta,
                    "reason": reason or "Encounter / Mission consequence",
                    "newTotal": player["favor"][fac],
                })
    return applied


def _default_player_stats() -> Dict[str, Any]:
    return {
        "combats": 0,
        "itemsPurchased": 0,
        "itemsSold": 0,
        "neighborhoodsTraversed": 0,
        "visitedNeighborhoods": [],
        "missionsCompleted": 0,
        "missionsFailed": 0,
        "plautillaMissionsCompleted": 0,
        "influencePlayed": 0,
        "encounters": {
            "patricii": 0,
            "nefarii": 0,
            "legiones": 0,
            "angryMobs": 0,
            "theaterTroupes": 0,
            "soothsayers": 0,
        },
    }


def _ensure_player_stats(player: Dict[str, Any]) -> Dict[str, Any]:
    defaults = _default_player_stats()
    stats = player.get("stats")
    if not isinstance(stats, dict):
        stats = copy.deepcopy(defaults)
        player["stats"] = stats
        return stats
    for k, v in defaults.items():
        if k == "encounters":
            enc = stats.get("encounters")
            if not isinstance(enc, dict):
                stats["encounters"] = copy.deepcopy(v)
            else:
                for ek, ev in v.items():
                    enc.setdefault(ek, ev)
        elif k == "visitedNeighborhoods":
            if not isinstance(stats.get(k), list):
                stats[k] = []
        else:
            if k not in stats:
                stats[k] = v
    return stats


def _inc_player_stat(player: Optional[Dict[str, Any]], key: str, delta: int = 1) -> None:
    if not isinstance(player, dict) or delta == 0:
        return
    stats = _ensure_player_stats(player)
    stats[key] = int(stats.get(key, 0) or 0) + int(delta)


def _inc_encounter_stat(player: Optional[Dict[str, Any]], enc_key: str, delta: int = 1) -> None:
    if not isinstance(player, dict) or delta == 0:
        return
    key_map = {
        "patricii": "patricii",
        "nefarii": "nefarii",
        "legiones": "legiones",
        "mob": "angryMobs",
        "angryMobs": "angryMobs",
        "theater": "theaterTroupes",
        "theaterTroupes": "theaterTroupes",
        "soothsayer": "soothsayers",
        "soothsayers": "soothsayers",
    }
    norm_key = key_map.get(enc_key)
    if not norm_key:
        return
    stats = _ensure_player_stats(player)
    enc = stats["encounters"]
    enc[norm_key] = int(enc.get(norm_key, 0) or 0) + int(delta)


def _record_neighborhood_visit(player: Optional[Dict[str, Any]], cell: Optional[str]) -> None:
    if not isinstance(player, dict) or not cell:
        return
    stats = _ensure_player_stats(player)
    stats["neighborhoodsTraversed"] = int(stats.get("neighborhoodsTraversed", 0) or 0) + 1
    visited = stats["visitedNeighborhoods"]
    if cell not in visited:
        visited.append(cell)


def _format_player_stats_summary(player: Dict[str, Any]) -> Dict[str, Any]:
    stats = _ensure_player_stats(player)
    visited_unique = list(dict.fromkeys(str(c) for c in stats.get("visitedNeighborhoods", []) if c))
    enc = stats.get("encounters") or {}
    favor_snap = {f: int((player.get("favor") or {}).get(f, 0)) for f in FACTIONS}
    return {
        "combats": int(stats.get("combats", 0) or 0),
        "itemsPurchased": int(stats.get("itemsPurchased", 0) or 0),
        "itemsSold": int(stats.get("itemsSold", 0) or 0),
        "neighborhoodsTraversed": int(stats.get("neighborhoodsTraversed", 0) or 0),
        "neighborhoodsVisited": len(visited_unique),
        "totalNeighborhoods": len(ALL_CELLS),
        "visitedNeighborhoods": visited_unique,
        "missionsCompleted": int(stats.get("missionsCompleted", 0) or 0),
        "missionsFailed": int(stats.get("missionsFailed", 0) or 0),
        "netMissions": int(stats.get("missionsCompleted", 0) or 0) - int(stats.get("missionsFailed", 0) or 0),
        "plautillaMissionsCompleted": int(stats.get("plautillaMissionsCompleted", 0) or 0),
        "influencePlayed": int(stats.get("influencePlayed", 0) or 0),
        "endingFactionStandings": favor_snap,
        "encounters": {
            "patricii": int(enc.get("patricii", 0) or 0),
            "nefarii": int(enc.get("nefarii", 0) or 0),
            "legiones": int(enc.get("legiones", 0) or 0),
            "angryMobs": int(enc.get("angryMobs", 0) or 0),
            "theaterTroupes": int(enc.get("theaterTroupes", 0) or 0),
            "soothsayers": int(enc.get("soothsayers", 0) or 0),
        },
    }


def _build_final_standings(state: Dict[str, Any]) -> List[Dict[str, Any]]:
    winner_name = state.get("winner")
    players = list(state.get("players", []))
    sorted_players = sorted(
        players,
        key=lambda p: (
            1 if (winner_name and p.get("name") == winner_name) else 0,
            0 if p.get("eliminated") else 1,
            int(p.get("cash", 0)),
            -int(p.get("index", 0)),
        ),
        reverse=True,
    )
    standings: List[Dict[str, Any]] = []
    prev_cash: Optional[int] = None
    prev_won = False
    prev_elim = False
    prev_rank = 1
    for i, p in enumerate(sorted_players):
        won = bool(winner_name and p.get("name") == winner_name) if winner_name else (i == 0 and not p.get("eliminated"))
        elim = bool(p.get("eliminated", False))
        cash_val = int(p.get("cash", 0))
        if i == 0:
            rank = 1
        elif not won and not prev_won and elim == prev_elim and prev_cash is not None and cash_val == prev_cash:
            rank = prev_rank
        else:
            rank = i + 1
        prev_cash = cash_val
        prev_won = won
        prev_elim = elim
        prev_rank = rank
        summary = _format_player_stats_summary(p)
        standings.append({
            "rank": rank,
            "playerIndex": int(p.get("index", i)),
            "userId": p.get("userId"),
            "name": str(p.get("name", f"Player {i + 1}")),
            "color": str(p.get("color", "Z3")),
            "isBot": bool(p.get("isBot", False)),
            "botStrategy": p.get("botStrategy", "balanced"),
            "won": won,
            "eliminated": elim,
            "eliminationReason": p.get("eliminationReason"),
            "cash": cash_val,
            "winterReckoning": copy.deepcopy(p.get("winterReckoning")),
            "endingFactionStandings": summary["endingFactionStandings"],
            "stats": summary,
        })
    return standings


def _record_mission_completion_event(
    state: Dict[str, Any],
    player: Dict[str, Any],
    mission: Dict[str, Any],
    reward_notes: List[str],
    favor_notes: List[str],
    context_detail: str = "",
) -> None:
    _inc_player_stat(player, "missionsCompleted", 1)
    m_fav = mission.get("favor") or []
    if "Plautilla" in m_fav or mission.get("patronFaction") == "Plautilla":
        _inc_player_stat(player, "plautillaMissionsCompleted", 1)
    if state.get("phase") == "finished":
        state["finalStandings"] = _build_final_standings(state)
    if player.get("isBot"):
        return
    events = state.setdefault("missionEvents", [])
    seq = int(state.get("nextMissionEventSeq", 1))
    state["nextMissionEventSeq"] = seq + 1
    m_snap = copy.deepcopy(mission)
    m_snap["text"] = _format_mission_text(m_snap)
    events.append({
        "seq": seq,
        "playerIndex": player["index"],
        "playerName": player["name"],
        "mission": m_snap,
        "rewardSummary": " • ".join(reward_notes + favor_notes) or mission.get("rewardText") or "Mission Completed",
        "rewardNotes": list(reward_notes),
        "favorNotes": list(favor_notes),
        "contextDetail": context_detail,
    })


def count_exposed_icons(state: Dict[str, Any], icon_prefix: str) -> int:
    total = 0
    for cell_state in state["romeBoard"].values():
        rev = cell_state.get("revealed")
        if not rev:
            continue
        enc = rev.get("encounter") or ""
        if isinstance(enc, str) and enc.startswith(icon_prefix):
            parts = enc.split("_")
            total += int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 1
        for edge_val in (rev.get("edges") or {}).values():
            if isinstance(edge_val, str) and edge_val.startswith(icon_prefix):
                parts = edge_val.split("_")
                total += int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 1
    return total


ROMAN_DIE_MAP = {0: "0", 1: "I", 2: "II", 3: "III", 4: "IV", 5: "V", 6: "VI"}


def roman_die_str(val: int) -> str:
    return ROMAN_DIE_MAP.get(abs(int(val)), str(abs(int(val))))


def add_log(state: Dict[str, Any], message: str, category: str = "info") -> None:
    state["logs"].append({
        "id": secrets.token_hex(4),
        "ts": int(time.time()),
        "season": state["season"],
        "phase": state["phase"],
        "turn": state["turn"],
        "category": category,
        "text": message,
    })
    if len(state["logs"]) > 150:
        state["logs"] = state["logs"][-150:]


def add_dice_event(
    state: Dict[str, Any],
    kind: str,
    title: str,
    subtitle: str,
    groups: List[Dict[str, Any]],
    outcome_title: str,
    outcome_message: str,
) -> Dict[str, Any]:
    seq = int(state.get("nextDiceSeq", 0)) + 1
    state["nextDiceSeq"] = seq
    ev = {
        "seq": seq,
        "kind": kind,
        "title": title,
        "subtitle": subtitle,
        "groups": groups,
        "outcomeTitle": outcome_title,
        "outcomeMessage": outcome_message,
        "outcomeDetail": outcome_message,
        "turn": state.get("turn", 1),
        "season": state.get("season", "Spring"),
    }
    evs = state.setdefault("diceEvents", [])
    evs.append(ev)
    if len(evs) > 40:
        state["diceEvents"] = evs[-40:]
    return ev


def add_npc_event(
    state: Dict[str, Any],
    bot: Dict[str, Any],
    action_type: str,
    summary: str,
    cell: Optional[str] = None,
    from_cell: Optional[str] = None,
    visual: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    seq = int(state.get("nextNpcEventSeq", 0)) + 1
    state["nextNpcEventSeq"] = seq
    ev: Dict[str, Any] = {
        "seq": seq,
        "playerIndex": int(bot.get("index", 0)),
        "playerName": str(bot.get("name", "NPC")),
        "playerColor": str(bot.get("color", "Z3")),
        "botStrategy": str(bot.get("botStrategy", "balanced")),
        "actionType": action_type,
        "summary": summary,
        "cell": normalize_cell_id(cell) if cell else None,
        "fromCell": normalize_cell_id(from_cell) if from_cell else None,
        "season": state.get("season", "Spring"),
        "phase": state.get("phase", ""),
        "turn": int(state.get("turn", 1) or 1),
    }
    if visual:
        ev["visual"] = copy.deepcopy(visual)
    evs = state.setdefault("npcEvents", [])
    evs.append(ev)
    if len(evs) > 60:
        state["npcEvents"] = evs[-60:]
    return ev


def _public_item_visual(item: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": str(item.get("id", "")),
        "name": str(item.get("name") or item.get("item") or "Cargo"),
        "track": str(item.get("track") or _resolve_track_for_category(str(item.get("category", "Grain")))),
        "category": str(item.get("category") or item.get("track") or "Goods"),
        "subcategory": str(item.get("subcategory") or ""),
        "blocks": int(item.get("blocks", 1) or 1),
    }


def _public_encounter_card_visual(card: Dict[str, Any], deck_override: str = "") -> Dict[str, Any]:
    cid = str(card.get("id") or "")
    inferred_deck = (
        deck_override
        or str(card.get("deck") or "")
        or ("patricii" if cid.startswith("pat_") else "legiones" if cid.startswith("leg_") else "nefarii" if cid.startswith("nef_") else "patricii")
    ).lower()
    return {
        "id": cid or "pat_1",
        "name": str(card.get("name") or "Encounter"),
        "deck": inferred_deck,
        "faction": str(card.get("faction") or ""),
        "type": str(card.get("type") or "person"),
    }


def _update_or_add_bot_encounter_outcome(
    state: Dict[str, Any],
    bot: Dict[str, Any],
    card: Dict[str, Any],
    deck_key: str,
    outcome: str,
    outcome_label: str,
    summary: str,
    extra_visual: Optional[Dict[str, Any]] = None,
) -> None:
    if not bot.get("isBot"):
        return
    card_vis = _public_encounter_card_visual(card, deck_key)
    vis: Dict[str, Any] = {
        "kind": "encounter",
        "card": card_vis,
        "outcome": outcome,
        "outcomeLabel": outcome_label,
    }
    if extra_visual:
        vis.update(copy.deepcopy(extra_visual))
    evs = state.get("npcEvents") or []
    for existing in reversed(evs[-6:]):
        if (
            existing.get("playerIndex") == bot.get("index")
            and existing.get("actionType") == "encounter"
            and (existing.get("visual") or {}).get("card", {}).get("id") == card_vis["id"]
            and (existing.get("visual") or {}).get("outcome") in (None, "pending")
        ):
            existing["summary"] = summary
            existing_vis = existing.setdefault("visual", {})
            existing_vis.update(vis)
            return
    add_npc_event(state, bot, "encounter", summary, cell=bot.get("position"), visual=vis)



def matches_category(card: Dict[str, Any], requested_cat: str) -> bool:
    """Checks whether a cart item matches a tile or mission category (e.g. 'Wine', 'Cheap Wine', 'Fine Wine', 'Animals', 'Meat Animals', 'Exotic Animals')."""
    req = requested_cat.strip()
    is_any_wine = bool(card.get("countsAsAnyWine"))
    if req in ("Cheap W", "Cheap Wine"):
        return is_any_wine or card.get("subcategory") == "Cheap Wine" or card.get("category") == "Cheap Wine"
    if req in ("Fine W", "Fine Wine", "Fancy Wine"):
        return is_any_wine or card.get("subcategory") == "Fine Wine" or card.get("category") == "Fine Wine"
    if req in ("Meat A", "Meat Animals", "Meat Animal"):
        return card.get("subcategory") == "Meat Animals" or card.get("category") == "Meat Animals"
    if req in ("Exotic A", "Exotic Animals", "Exotic Animal"):
        return card.get("subcategory") == "Exotic Animals" or card.get("category") == "Exotic Animals"
    if req == "Wine":
        return is_any_wine or card.get("track") == "Wine" or card.get("category") in ("Wine", "Cheap Wine", "Fine Wine")
    if req in ("Animals", "Animal"):
        return card.get("track") == "Animals" or card.get("category") in ("Animals", "Meat Animals", "Exotic Animals")
    if req in ("Weapon", "Weapons"):
        return card.get("track") == "Weapons" or card.get("category") == "Weapons"
    return card.get("category") == req or card.get("track") == req or card.get("name") == req


def compute_sell_price(
    state: Dict[str, Any],
    player: Dict[str, Any],
    card: Dict[str, Any],
    modifier: str,
    spend_amethysts: int = 0,
) -> Tuple[int, str]:
    track_name = card.get("track") or card.get("category")
    if track_name in ("Cheap Wine", "Fine Wine"):
        track_name = "Wine"
    elif track_name in ("Meat Animals", "Exotic Animals"):
        track_name = "Animals"
    track_cards = state["marketBoard"].get(track_name, [])
    shift = state.get("seasonTrackShifts", {}).get(track_name, 0)
    base_idx = get_track_scarcity_index(track_cards, shift)

    if state.get("hourEffects", {}).get("priceEdict"):
        final_idx = base_idx
    else:
        delta = MODIFIER_DELTAS.get(modifier, 0)
        # Check Guard rarity bonuses (Pliny: Cheap Wine, Gnaeus: Meat Animals)
        guard_bonus = 0
        for g in player["guards"]:
            rb = g.get("rarityBonus")
            if rb and matches_category(card, rb):
                guard_bonus -= 1
        # Check Puffery influence effect (+1 rarity level = -1 index)
        puffery_bonus = -1 if player.get("turnEffects", {}).get("puffery") else 0
        # Smuggler's Fence (plautilla_3): fenced Encounter Mission cargo sells 1 Scarcity step higher
        fence_bonus = -1 if (card.get("isMissionCargo") and has_climate_modifier(state, "plautilla_3")) else 0
        # Senatorial Privilege (aurelius_3): spend positive Amethysts (+1 Scarcity step per Amethyst)
        amethyst_bonus = -max(0, int(spend_amethysts or 0)) if has_climate_modifier(state, "aurelius_3") else 0
        final_idx = max(0, min(4, base_idx + delta + guard_bonus + puffery_bonus + fence_bonus + amethyst_bonus))

    sell_table = card.get("sell") or card.get("fencedSell") or [10, 7, 5, 4, 2]
    return int(sell_table[final_idx]), SCARCITY_SYMBOLS[final_idx]


def create_initial_game_state(players_config: List[Dict[str, Any]]) -> Dict[str, Any]:
    data = load_all_game_data()

    market_deck = crypto_shuffle(data["market"])
    mission_deck = crypto_shuffle(data["missiones"])
    influence_deck = crypto_shuffle(data["influence"])
    patricii_deck = crypto_shuffle(data["patricii"])
    legiones_deck = crypto_shuffle(data["legiones"])
    nefarii_deck = crypto_shuffle(data["nefarii"])

    # Prepare 36 Rome neighborhood stacks (A1-F6)
    rome_board = {}
    tiles_by_coord = data["tiles"]
    for cell in ALL_CELLS:
        cell_info = tiles_by_coord.get(cell, {})
        raw_tiles = cell_info.get("tiles", [])
        shuffled_stack = crypto_shuffle(raw_tiles)
        rome_board[cell] = {
            "coord": cell,
            "name": cell_info.get("name", NEIGHBORHOOD_NAMES.get(cell, cell)),
            "isGate": cell in GATE_CELLS,
            "isForum": cell in FORUM_CELLS,
            "revealed": None,
            "stack": shuffled_stack,
        }

    state: Dict[str, Any] = {
        "season": "Spring",
        "seasonIndex": 0,  # 0=Spring, 1=Summer, 2=Fall
        "phase": "setup_discard",  # setup_discard -> setup_climate -> market -> delivery_entry -> delivery -> cleanup -> finished
        "turn": 1,
        "firstPlayerIndex": 0,
        "activePlayerIndex": 0,
        "setupDiscardOrder": [],
        "politicalClimate": {
            "activeIds": [],
            "activeByFactor": {},
            "picks": [],
            "draftOrder": [],
            "draftStep": 0,
            "firstDiscarderIndex": None,
        },
        "marketConsecutivePasses": 0,
        "marketBoard": {t: [] for t in TRACK_NAMES},
        "seasonTrackShifts": {t: 0 for t in TRACK_NAMES},
        "hourEffects": {"priceEdict": False, "lastInfluencePlayed": None},
        "romeBoard": rome_board,
        "decks": {
            "market": market_deck,
            "missiones": mission_deck,
            "influence": influence_deck,
            "patricii": patricii_deck,
            "legiones": legiones_deck,
            "nefarii": nefarii_deck,
        },
        "players": [],
        "pendingEncounter": None,
        "nextDiceSeq": 0,
        "diceEvents": [],
        "nextNpcEventSeq": 0,
        "npcEvents": [],
        "nextMissionEventSeq": 1,
        "missionEvents": [],
        "logs": [],
        "winner": None,
    }

    # Deal 24 cards onto the Ostia Market Board per Rulebook Setup #2
    for _ in range(24):
        if state["decks"]["market"]:
            card = state["decks"]["market"].pop(0)
            push_card_onto_market_track(state, card)

    # Set up players with 12(d), 5 Missiones, 5 Influence
    for idx, pconf in enumerate(players_config):
        dealt_missions = [state["decks"]["missiones"].pop(0) for _ in range(min(5, len(state["decks"]["missiones"])))]
        for m in dealt_missions:
            m["source"] = "starting"
            m["pickedUp"] = False
            m["completed"] = False
        dealt_influence = [state["decks"]["influence"].pop(0) for _ in range(min(5, len(state["decks"]["influence"])))]

        player_obj = {
            "index": idx,
            "userId": pconf.get("userId"),
            "name": pconf["name"],
            "color": pconf["color"],
            "isBot": bool(pconf.get("isBot", False)),
            "botStrategy": pconf.get("botStrategy", "balanced"),
            "cash": 12,
            "cart": [],
            "guards": [],
            "bonusBlocks": 0,
            "bonusGuards": 0,
            "missions": dealt_missions,
            "influence": dealt_influence,
            "soothsayerings": [],
            "favor": {f: 0 for f in FACTIONS},
            "favorHistory": {f: [] for f in FACTIONS},
            "tempFavor": 0,
            "friendInGuard": False,
            "loans": {"spring": False, "summer": False},
            "position": None,
            "previousPosition": None,
            "exitedRome": False,
            "nightEnded": False,
            "eliminated": False,
            "eliminationReason": None,
            "skipTurns": 0,
            "setupDiscarded": False,
            "cleanupDone": False,
            "turnStep": "start",  # start -> moved -> transacted -> done
            "movesRemaining": 1,
            "transactedThisTurn": False,
            "gambledThisTurn": False,
            "scoutedThisTurn": False,
            "trashedThisTurn": False,
            "turnEffects": {},
            "scoutedInfo": [],
            "last stolen": None,
            "stats": _default_player_stats(),
        }
        state["players"].append(player_obj)

    state["turnSeq"] = 1
    state["hasActedThisTurn"] = False
    state["turnSnapshotHistory"] = []
    state["pendingUndoRequest"] = None

    add_log(state, "Anno Domini 211 — Spring Market opens at the port of Ostia. Each merchant receives 12(d) and must select 3 Starting Missions and 3 Influence cards to keep. The first player to finish discarding gets First Pick on the Political Climate Board!", "phase")

    # Defer bot setup discards until human players finish so humans compete fairly for First Pick!
    has_humans = any(not p["isBot"] for p in state["players"])
    if not has_humans:
        bot_indices = crypto_shuffle([p["index"] for p in state["players"] if p["isBot"]])
        for b_idx in bot_indices:
            _bot_complete_setup_discard(state, state["players"][b_idx])
        _check_all_setup_discards_done(state)

    _record_turn_start_snapshot(state)
    return state


MAX_UNDO_SNAPSHOTS = 12


def _describe_turn_label(state: Dict[str, Any]) -> str:
    phase = state.get("phase", "")
    season = state.get("season", "Spring")
    players = state.get("players", [])
    act_idx = int(state.get("activePlayerIndex", 0) or 0)
    act_name = players[act_idx]["name"] if 0 <= act_idx < len(players) else "Merchant"
    if phase == "setup_discard":
        return f"{season} — Starting Hand Selection"
    if phase == "setup_climate":
        return f"{season} — Political Climate Draft ({act_name}'s Pick)"
    if phase == "market":
        return f"{season} Ostia Market — {act_name}'s Turn"
    if phase == "delivery_entry":
        return f"{season} Gate Entry — {act_name}'s Turn"
    if phase == "delivery":
        t_idx = max(0, min(len(TURN_HOURS) - 1, int(state.get("turn", 1)) - 1))
        return f"{season} Night ({TURN_HOURS[t_idx]}) — {act_name}'s Turn"
    if phase == "cleanup":
        return f"{season} Dawn Clean-Up"
    return f"{season} — {phase.capitalize()}"


def _make_clean_snapshot(state: Dict[str, Any]) -> Dict[str, Any]:
    snap_state = {
        k: copy.deepcopy(v)
        for k, v in state.items()
        if k not in ("turnSnapshotHistory", "pendingUndoRequest")
    }
    snap_state["hasActedThisTurn"] = False
    return snap_state


def _record_turn_start_snapshot(state: Dict[str, Any]) -> None:
    hist = state.setdefault("turnSnapshotHistory", [])
    t_seq = int(state.get("turnSeq", 1))
    clean_state = _make_clean_snapshot(state)
    entry = {
        "turnSeq": t_seq,
        "label": _describe_turn_label(state),
        "activePlayerIndex": int(state.get("activePlayerIndex", 0) or 0),
        "phase": state.get("phase", ""),
        "season": state.get("season", "Spring"),
        "turn": int(state.get("turn", 1) or 1),
    }
    entry["state"] = clean_state
    if hist and hist[-1].get("turnSeq") == t_seq:
        hist[-1] = entry
    else:
        hist.append(entry)
    if len(hist) > MAX_UNDO_SNAPSHOTS:
        del hist[:-MAX_UNDO_SNAPSHOTS]
    state["hasActedThisTurn"] = False


def _get_undo_target_info(state: Dict[str, Any]) -> Tuple[Optional[int], Optional[str], Optional[str]]:
    """Returns (snapshot_index, target_type, target_label) if an undo is possible, else (None, None, None)."""
    hist = state.get("turnSnapshotHistory") or []
    if not hist:
        return None, None, None
    has_acted = bool(state.get("hasActedThisTurn", False))
    if has_acted:
        idx = len(hist) - 1
        return idx, "current_turn", hist[idx].get("label") or "Beginning of Current Turn"
    if len(hist) >= 2:
        idx = len(hist) - 2
        return idx, "previous_turn", hist[idx].get("label") or "Beginning of Previous Turn"
    return None, None, None


def _execute_undo_restore(
    state: Dict[str, Any],
    target_idx: int,
    requester_name: str,
    target_type: str,
) -> str:
    hist = list(state.get("turnSnapshotHistory") or [])
    if target_idx < 0 or target_idx >= len(hist):
        return "Beginning of Turn"
    target_entry = hist[target_idx]
    target_label = target_entry.get("label") or (
        "Beginning of Current Turn" if target_type == "current_turn" else "Beginning of Previous Turn"
    )
    max_dice_seq = max(int(state.get("nextDiceSeq", 0)), int(target_entry["state"].get("nextDiceSeq", 0)))
    max_npc_seq = max(int(state.get("nextNpcEventSeq", 0)), int(target_entry["state"].get("nextNpcEventSeq", 0)))
    max_mission_seq = max(
        int(state.get("nextMissionEventSeq", 1)),
        int(target_entry["state"].get("nextMissionEventSeq", 1)),
    )
    restored = copy.deepcopy(target_entry["state"])
    kept_hist = copy.deepcopy(hist[: target_idx + 1])

    state.clear()
    state.update(restored)
    state["nextDiceSeq"] = max_dice_seq
    state["nextNpcEventSeq"] = max_npc_seq
    state["nextMissionEventSeq"] = max_mission_seq
    state["hasActedThisTurn"] = False
    state["pendingUndoRequest"] = None
    state["turnSnapshotHistory"] = kept_hist

    which_str = "beginning of current turn" if target_type == "current_turn" else "beginning of previous turn"
    add_log(state, f"↩️ {requester_name} reverted the game to the {which_str} ({target_label}).", "phase")
    return target_label


def _bot_complete_setup_discard(state: Dict[str, Any], player: Dict[str, Any]) -> None:
    if player["setupDiscarded"]:
        return
    strat = str(player.get("botStrategy", "balanced"))
    missions = player["missions"]

    def _mission_keep_score(m: Dict[str, Any]) -> int:
        kind = m.get("kind")
        cat = str(m.get("category", ""))
        sc = 0
        if strat == "aggressive":
            if kind in ("kill", "kill_emperor", "kill_emperor_cancel"):
                sc += 30
            elif kind in ("sell", "delivery"):
                sc += 15
        elif strat == "luxury":
            if cat in ("Marble", "Fine Wine", "Exotic Animals"):
                sc += 28
            if kind == "sell":
                sc += 18
            elif kind == "delivery":
                sc += 14
        elif strat == "missions":
            if kind == "delivery":
                sc += 30
            elif kind in ("sell", "expose"):
                sc += 22
        else:
            if kind in ("sell", "delivery"):
                sc += 20
            elif kind == "expose":
                sc += 14
        return sc

    missions.sort(key=_mission_keep_score, reverse=True)
    kept_m = missions[:3]
    disc_m = missions[3:]
    player["missions"] = kept_m
    state["decks"]["missiones"].extend(disc_m)

    inf = player["influence"]

    def _inf_keep_score(c: Dict[str, Any]) -> int:
        nm = str(c.get("name", ""))
        sc = 10
        if "Patron" in nm:
            sc += 25
        if strat == "aggressive" and any(k in nm for k in ("Mercenary", "Gladiator", "Casus Belli", "Hired Thug", "Flying Chamber Pot")):
            sc += 20
        elif strat == "luxury" and any(k in nm for k in ("Puffery", "Wine Forger", "Shortcut", "Make Haste")):
            sc += 18
        elif strat == "missions" and any(k in nm for k in ("Make Haste", "Shortcut", "Friend In The Guard")):
            sc += 20
        elif strat == "opportunist" and any(k in nm for k in ("Twist Of Fate", "Make Haste", "Trained Dog", "Plea")):
            sc += 18
        return sc

    inf.sort(key=_inf_keep_score, reverse=True)
    kept_i = inf[:3]
    disc_i = inf[3:]
    player["influence"] = kept_i
    state["decks"]["influence"].extend(disc_i)
    player["setupDiscarded"] = True
    disc_order = state.setdefault("setupDiscardOrder", [])
    if player["index"] not in disc_order:
        disc_order.append(player["index"])
    add_log(state, f"{player['name']} prepared their starting contracts and influence.", "action")


def _init_setup_climate_draft(state: Dict[str, Any]) -> None:
    players = state.get("players", [])
    n = len(players)
    disc_order = list(state.get("setupDiscardOrder") or [])
    for idx in range(n):
        if idx not in disc_order:
            disc_order.append(idx)
    state["setupDiscardOrder"] = disc_order
    first_discarder = disc_order[0] if disc_order else 0

    if n <= 1:
        draft_order = [first_discarder, first_discarder]
    elif n == 2:
        other = disc_order[1]
        draft_order = [first_discarder, other, other, first_discarder]
    else:
        draft_order = disc_order[: min(n, len(POLITICAL_CLIMATE_FACTORS))]

    state["politicalClimate"] = {
        "activeIds": [],
        "activeByFactor": {},
        "picks": [],
        "draftOrder": draft_order,
        "draftStep": 0,
        "firstDiscarderIndex": first_discarder,
    }
    state["phase"] = "setup_climate"
    state["activePlayerIndex"] = draft_order[0]
    state["turnSeq"] = int(state.get("turnSeq", 1)) + 1

    f_name = players[first_discarder]["name"] if 0 <= first_discarder < n else "Merchant"
    order_names = " → ".join(players[i]["name"] for i in draft_order if 0 <= i < n)
    add_log(
        state,
        f"🏛️ POLITICAL CLIMATE DRAFT! {f_name} finished discarding first and earns First Pick ({order_names}), then becomes Last Player in normal turn order.",
        "phase",
    )
    run_bots_until_human(state)


def _apply_climate_option_pick(state: Dict[str, Any], player: Dict[str, Any], option_id: str) -> Tuple[bool, str]:
    opt = POLITICAL_CLIMATE_OPTION_MAP.get(option_id)
    if not opt:
        return False, "Invalid Political Climate option."
    pc = state.setdefault("politicalClimate", {
        "activeIds": [],
        "activeByFactor": {},
        "picks": [],
        "draftOrder": [],
        "draftStep": 0,
        "firstDiscarderIndex": 0,
    })
    draft_order = pc.get("draftOrder") or []
    step = int(pc.get("draftStep", 0) or 0)
    if step >= len(draft_order):
        return False, "All Political Climate options have already been drafted."
    fac = opt["factor"]
    if fac in (pc.get("activeByFactor") or {}):
        return False, f"A {opt['factorLabel']} modifier is already active — only 1 option per column may be chosen."

    pc.setdefault("activeIds", []).append(option_id)
    pc.setdefault("activeByFactor", {})[fac] = option_id
    pc.setdefault("picks", []).append({
        "step": step + 1,
        "playerIndex": player["index"],
        "playerName": player["name"],
        "playerColor": player["color"],
        "optionId": option_id,
        "factor": fac,
        "title": opt["title"],
    })
    timing_lbl = "Mid-Game Rule" if opt["timing"] == "midgame" else "End-Game Modifier"
    add_log(
        state,
        f"🏛️ {player['name']} enacted {opt['factorLabel']} Option {opt['optionNumber']}: {opt['title']} ({timing_lbl} — {opt['shortText']}).",
        "phase",
    )
    if player.get("isBot"):
        add_npc_event(state, player, "climate", f"Enacted {opt['factorLabel']}: {opt['title']}")

    _advance_setup_climate(state)
    return True, f"Enacted {opt['factorLabel']}: {opt['title']}!"


def _advance_setup_climate(state: Dict[str, Any]) -> None:
    pc = state.get("politicalClimate") or {}
    draft_order = pc.get("draftOrder") or []
    pc["draftStep"] = int(pc.get("draftStep", 0) or 0) + 1
    state["turnSeq"] = int(state.get("turnSeq", 1)) + 1

    if pc["draftStep"] < len(draft_order) and len(pc.get("activeByFactor") or {}) < len(POLITICAL_CLIMATE_FACTORS):
        state["activePlayerIndex"] = draft_order[pc["draftStep"]]
        return

    players = state.get("players", [])
    n = max(1, len(players))
    first_discarder = int(pc.get("firstDiscarderIndex", 0) or 0)
    # First player to finish discarding becomes the LAST player in normal game turn order!
    state["firstPlayerIndex"] = (first_discarder + 1) % n if n > 1 else 0
    state["activePlayerIndex"] = state["firstPlayerIndex"]
    state["phase"] = "market"
    state["marketConsecutivePasses"] = 0

    active_titles = [
        f"{POLITICAL_CLIMATE_OPTION_MAP[oid]['factorLabel']}: {POLITICAL_CLIMATE_OPTION_MAP[oid]['title']}"
        for oid in (pc.get("activeIds") or [])
        if oid in POLITICAL_CLIMATE_OPTION_MAP
    ]
    fp_name = players[state["firstPlayerIndex"]]["name"]
    fd_name = players[first_discarder]["name"] if 0 <= first_discarder < n else "Merchant"
    add_log(
        state,
        f"{state['season']} Phase I: Ostia Market Phase begins! Active Political Climate: {'; '.join(active_titles)}. "
        f"{fp_name} holds the First Player Token ({fd_name} acts last in turn order).",
        "phase",
    )


def _check_all_setup_discards_done(state: Dict[str, Any]) -> None:
    if state["phase"] != "setup_discard":
        return
    if all(p["setupDiscarded"] for p in state["players"]):
        _init_setup_climate_draft(state)


def grant_reward(
    state: Dict[str, Any],
    player: Dict[str, Any],
    reward: Optional[Dict[str, Any]],
    reward_text: str = "",
    is_mission_reward: bool = False,
) -> List[str]:
    notes = []
    if not reward and not reward_text:
        return notes

    cash_mult = 2 if (is_mission_reward and has_climate_modifier(state, "missions_3")) else 1
    mult_tag = " (2× Bonded Couriers)" if cash_mult == 2 else ""

    if reward and isinstance(reward, dict):
        rtype = reward.get("type")
        if rtype == "cash":
            amt = int(reward.get("amount", 0)) * cash_mult
            player["cash"] += amt
            notes.append(f"+{amt}(d){mult_tag}")
        elif rtype == "influence":
            cnt = int(reward.get("count", 1))
            drawn = 0
            for _ in range(cnt):
                if state["decks"]["influence"]:
                    player["influence"].append(state["decks"]["influence"].pop(0))
                    drawn += 1
            if drawn:
                notes.append(f"+{drawn} Influence Card(s)")
        elif rtype == "cash_and_influence":
            amt = int(reward.get("amount", 0)) * cash_mult
            cnt = int(reward.get("count", 1))
            player["cash"] += amt
            notes.append(f"+{amt}(d){mult_tag}")
            for _ in range(cnt):
                if state["decks"]["influence"]:
                    player["influence"].append(state["decks"]["influence"].pop(0))
            notes.append(f"+{cnt} Influence")
        elif rtype == "dice_cash":
            r = roll_rome_die()
            mult = int(reward.get("multiplier", 10)) * cash_mult
            r_rom = roman_die_str(r)
            amt_init = r * mult
            add_dice_event(
                state,
                kind="reward",
                title=f"💰 REWARD ROLL — {player['name']}",
                subtitle=f"Rolling Rome Die (® × {mult}d{mult_tag})",
                groups=[{
                    "rollerName": player["name"],
                    "rollerType": "player",
                    "colorName": player["color"],
                    "flatBonus": 0,
                    "totalLabel": f"{r_rom} × {mult}d = +{amt_init}(d)",
                    "dice": [{"value": r, "roman": r_rom, "sign": 1, "label": "Reward ®", "color": player["color"]}],
                }],
                outcome_title=f"ROLLED {r_rom} → +{amt_init}(d)",
                outcome_message=f"{player['name']} rolled {r_rom} for +{amt_init}(d){mult_tag}!",
            )
            rerolled_list = _maybe_bot_reroll_reward_die(state, player, f"Reward (® × {mult}d)", [r], mult=mult)
            r = rerolled_list[0]
            r_rom = roman_die_str(r)
            amt = r * mult
            player["cash"] += amt
            notes.append(f"Rolled ®={r_rom} -> +{amt}(d){mult_tag}")
        elif rtype == "dice_influence":
            dice_cnt = int(reward.get("dice", 1))
            rolls = [roll_rome_die() for _ in range(dice_cnt)]
            rom_list = " + ".join(roman_die_str(x) for x in rolls)
            init_total = sum(rolls)
            add_dice_event(
                state,
                kind="reward",
                title=f"📜 INFLUENCE REWARD ROLL — {player['name']}",
                subtitle=f"Rolling {dice_cnt}® for Influence Cards",
                groups=[{
                    "rollerName": player["name"],
                    "rollerType": "player",
                    "colorName": player["color"],
                    "flatBonus": 0,
                    "totalLabel": f"+{init_total} Influence",
                    "dice": [
                        {"value": x, "roman": roman_die_str(x), "sign": 1, "label": f"Influence ® #{i+1}", "color": player["color"]}
                        for i, x in enumerate(rolls)
                    ],
                }],
                outcome_title=f"ROLLED {rom_list} (+{init_total} INFLUENCE)",
                outcome_message=f"{player['name']} rolled {rom_list} for Influence cards!",
            )
            rolls = _maybe_bot_reroll_reward_die(state, player, "Influence Reward", rolls, mult=0)
            total_cards = sum(rolls)
            drawn = 0
            for _ in range(total_cards):
                if state["decks"]["influence"]:
                    player["influence"].append(state["decks"]["influence"].pop(0))
                    drawn += 1
            rom_list = " + ".join(roman_die_str(x) for x in rolls)
            notes.append(f"Rolled {rom_list} -> +{drawn} Influence Card(s)")
        elif rtype == "top_good":
            for idx, c in enumerate(state["decks"]["market"]):
                if c["track"] != "Guards":
                    card = state["decks"]["market"].pop(idx)
                    notes.append(
                        _award_item_or_enqueue_overflow(
                            state,
                            player,
                            card,
                            source_label="Reward (Goods Deck)",
                            origin={"source": "deck"},
                        )
                    )
                    break
        elif rtype == "market_pick":
            track_name = reward.get("track", "Grain")
            subcat = reward.get("subcategory")
            mode = reward.get("mode", "cheapest")
            notes.extend(
                _grant_or_enqueue_market_pick(
                    state,
                    player,
                    track_name=track_name,
                    subcat=subcat,
                    mode=mode,
                    source_label="Reward (Ostia Market)",
                    reward_label=reward_text or f"Any {subcat or track_name} on Market",
                    deck_fallback=False,
                )
            )
        elif rtype == "win_game":
            state["phase"] = "finished"
            state["winner"] = player["name"]
            state["finalStandings"] = _build_final_standings(state)
            notes.append(f"{player['name']} completed REGICIDE and won the game!")
        elif rtype == "regime_change":
            amt = int(reward.get("amount", 20)) * cash_mult
            player["cash"] += amt
            notes.append(f"+{amt}(d){mult_tag} & cancelled Regicide rewards")
        return notes

    # Fallback string parser for string rewards like "40(d)", "Cheapest Mkt Wine", "1 Meat A from market", "Weapon"
    rt_raw = (reward_text or "").strip()
    m = re.search(r"(\d+)\s*\(d\)", rt_raw)
    if m:
        amt = int(m.group(1)) * cash_mult
        player["cash"] += amt
        notes.append(f"+{amt}(d){mult_tag}")
        return notes

    rt_low = rt_raw.lower()
    str_pick_spec: Optional[Tuple[str, Optional[str], str, bool]] = None
    if "cheap wine" in rt_low:
        str_pick_spec = ("Wine", "Cheap Wine", "cheapest" if "cheapest" in rt_low else "any", False)
    elif "mkt wine" in rt_low or "market wine" in rt_low:
        str_pick_spec = ("Wine", None, "cheapest" if "cheapest" in rt_low else "any", False)
    elif "meat a" in rt_low:
        str_pick_spec = ("Animals", "Meat Animals", "cheapest" if "cheapest" in rt_low else "any", False)
    elif "exotic a" in rt_low:
        str_pick_spec = ("Animals", "Exotic Animals", "cheapest" if "cheapest" in rt_low else "any", False)
    elif "mkt animal" in rt_low or "market animal" in rt_low:
        str_pick_spec = ("Animals", None, "cheapest" if "cheapest" in rt_low else "any", False)
    elif "mkt marble" in rt_low or "market marble" in rt_low:
        str_pick_spec = ("Marble", None, "cheapest" if "cheapest" in rt_low else "any", False)
    elif "mkt weapon" in rt_low or "market weapon" in rt_low:
        str_pick_spec = ("Weapons", None, "cheapest" if "cheapest" in rt_low else "any", False)
    elif rt_low == "weapon":
        str_pick_spec = ("Weapons", None, "cheapest", True)

    if str_pick_spec:
        tr_name, subcat, p_mode, deck_fallback = str_pick_spec
        notes.extend(
            _grant_or_enqueue_market_pick(
                state,
                player,
                track_name=tr_name,
                subcat=subcat,
                mode=p_mode,
                source_label=f"Encounter Reward ({rt_raw})",
                reward_label=rt_raw,
                deck_fallback=deck_fallback,
            )
        )
    return notes


def _singular_category_label(cat: Optional[str]) -> str:
    raw = str(cat or "Good").strip()
    mapping = {
        "Meat Animals": "Meat Animal",
        "Exotic Animals": "Exotic Animal",
        "Animals": "Animal",
        "Weapons": "Weapon",
        "Guards": "Guard",
    }
    return mapping.get(raw, raw)


def _prune_empty_pending_market_rewards(state: Dict[str, Any], player: Dict[str, Any]) -> None:
    queue = player.get("pendingMarketReward") or []
    if not queue:
        return
    kept: List[Dict[str, Any]] = []
    for rwd in queue:
        tr_name = rwd.get("track", "Animals")
        subcat = rwd.get("subcategory")
        track = state.get("marketBoard", {}).get(tr_name, [])
        has_match = any((not subcat or matches_category(c, subcat)) for c in track)
        if has_match:
            kept.append(rwd)
        else:
            cat_lbl = rwd.get("categoryLabel") or _singular_category_label(subcat or tr_name)
            add_log(
                state,
                f"No matching {cat_lbl} remained on the Ostia Market Board for {player['name']}'s reward.",
                "info",
            )
    player["pendingMarketReward"] = kept


def _grant_or_enqueue_market_pick(
    state: Dict[str, Any],
    player: Dict[str, Any],
    track_name: str,
    subcat: Optional[str],
    mode: str,
    source_label: str,
    reward_label: str,
    deck_fallback: bool = False,
) -> List[str]:
    notes: List[str] = []
    track = state["marketBoard"].get(track_name, [])
    candidates = [(i, c) for i, c in enumerate(track) if not subcat or matches_category(c, subcat)]
    cat_lbl = _singular_category_label(subcat or track_name)
    if candidates:
        if mode == "cheapest":
            pick_idx, _ = candidates[-1]
            pick_card = track.pop(pick_idx)
            notes.append(
                _award_item_or_enqueue_overflow(
                    state,
                    player,
                    pick_card,
                    source_label=source_label,
                    origin={"source": "market", "track": track_name, "colIndex": pick_idx},
                )
            )
        elif player.get("isBot"):
            best_pair = max(candidates, key=lambda pair: (_item_base_value(pair[1]), -pair[0]))
            pick_idx = best_pair[0]
            pick_card = track.pop(pick_idx)
            notes.append(
                _award_item_or_enqueue_overflow(
                    state,
                    player,
                    pick_card,
                    source_label=source_label,
                    origin={"source": "market", "track": track_name, "colIndex": pick_idx},
                )
            )
        else:
            player.setdefault("pendingMarketReward", []).append({
                "id": f"mktrwd_{secrets.token_hex(4)}",
                "track": track_name,
                "subcategory": subcat,
                "categoryLabel": cat_lbl,
                "sourceLabel": source_label,
                "rewardLabel": reward_label,
            })
            notes.append(f"Choose 1 {cat_lbl} from Ostia Market")
    elif deck_fallback:
        for idx_d, c_d in enumerate(state["decks"].get("market", [])):
            if c_d.get("track") == track_name and (not subcat or matches_category(c_d, subcat)):
                pick_card = state["decks"]["market"].pop(idx_d)
                notes.append(
                    _award_item_or_enqueue_overflow(
                        state,
                        player,
                        pick_card,
                        source_label=source_label,
                        origin={"source": "deck"},
                    )
                )
                break
    else:
        notes.append(f"No {cat_lbl} on Ostia Market")
    return notes


def _return_overflow_card_to_origin(state: Dict[str, Any], card: Dict[str, Any], origin: Optional[Dict[str, Any]]) -> None:
    orig = origin or {}
    cid = str(card.get("id", ""))
    if cid.startswith(("forged_wine_", "thug_")):
        return
    if orig.get("source") == "market" and orig.get("track") in state.get("marketBoard", {}):
        tr = state["marketBoard"][orig["track"]]
        ins_idx = max(0, min(int(orig.get("colIndex", len(tr))), len(tr)))
        tr.insert(ins_idx, card)
        if len(tr) > 6:
            state["decks"]["market"].append(tr.pop())
    else:
        state["decks"]["market"].append(card)


def _award_item_or_enqueue_overflow(
    state: Dict[str, Any],
    player: Dict[str, Any],
    card: Dict[str, Any],
    source_label: str = "Reward",
    origin: Optional[Dict[str, Any]] = None,
) -> str:
    is_guard = card.get("track") == "Guards" or int(card.get("guards", 0) or 0) > 0
    max_b, max_g = get_player_cart_limits(player)
    used_b, used_g = get_player_cart_usage(player)

    if is_guard:
        req_g = int(card.get("guards", 1) or 1)
        bonus_g = int(card.get("bonusGuards", 0) or 0)
        if used_g + req_g <= max_g + bonus_g:
            player["guards"].append(card)
            return f"Recruited free Guard {card['name']}"
        if player.get("isBot"):
            _return_overflow_card_to_origin(state, card, origin)
            return f"Guard capacity full (could not recruit {card['name']})"
        player.setdefault("pendingCartOverflow", []).append({
            "id": f"ovf_{secrets.token_hex(4)}",
            "itemType": "guard",
            "card": card,
            "reqBlocks": 0,
            "reqGuards": req_g,
            "bonusBlocks": int(card.get("bonusBlocks", 0) or 0),
            "bonusGuards": bonus_g,
            "sourceLabel": source_label,
            "origin": origin or {"source": "deck"},
        })
        add_log(
            state,
            f"{player['name']} received Guard '{card['name']}' ({source_label}) — choose a Guard to fire or refuse the new Guard.",
            "action",
        )
        return f"Received Guard {card['name']} (choose Guard to fire or refuse)"

    req_b = int(card.get("blocks", 1) or 1)
    if used_b + req_b <= max_b:
        player["cart"].append(card)
        return f"Received {card['name']}"
    if player.get("isBot"):
        _return_overflow_card_to_origin(state, card, origin)
        return f"Cart full (could not load {card['name']})"
    player.setdefault("pendingCartOverflow", []).append({
        "id": f"ovf_{secrets.token_hex(4)}",
        "itemType": "good",
        "card": card,
        "reqBlocks": req_b,
        "reqGuards": 0,
        "bonusBlocks": 0,
        "bonusGuards": 0,
        "sourceLabel": source_label,
        "origin": origin or {"source": "deck"},
    })
    add_log(
        state,
        f"{player['name']} received '{card['name']}' ({req_b}■, {source_label}) — choose Cart Goods to discard or refuse item.",
        "action",
    )
    return f"Received {card['name']} (choose Cart Goods to discard or refuse)"


def _item_base_value(c: Dict[str, Any]) -> int:
    s = c.get("sell") or []
    return int(s[2]) if len(s) > 2 else 0


def _prepare_attached_encounter_card(
    state: Optional[Dict[str, Any]],
    card: Dict[str, Any],
    remove_from_deck: bool = True,
) -> Dict[str, Any]:
    """Attaches a normalized Encounter card to a Mission on the Mission Board and removes it from its Encounter deck while active."""
    ec = copy.deepcopy(card)
    _normalize_encounter_card_data(ec)
    dk = _infer_encounter_deck_key(ec)
    ec["deck"] = dk
    if remove_from_deck and isinstance(state, dict):
        deck_list = state.get("decks", {}).get(dk, [])
        cid = ec.get("id")
        if cid:
            for idx in range(len(deck_list) - 1, -1, -1):
                if deck_list[idx].get("id") == cid:
                    deck_list.pop(idx)
                    break
    return ec


def _backfill_encounter_mission_metadata(m_obj: Dict[str, Any]) -> None:
    """Upgrades pre-existing Encounter missions with their physical Encounter card and relative +/- modifiers."""
    if not isinstance(m_obj, dict):
        return
    if "modifier" in m_obj and m_obj["modifier"] is not None:
        m_obj["modifier"] = normalize_scarcity_modifier(str(m_obj["modifier"]))
    if isinstance(m_obj.get("description"), str):
        m_obj["description"] = _normalize_relative_scarcity_text(m_obj["description"])
    if isinstance(m_obj.get("text"), str):
        m_obj["text"] = _normalize_relative_scarcity_text(m_obj["text"])
    if m_obj.get("source") != "encounter":
        return
    mid_str = str(m_obj.get("id") or "")
    inferred_drawn = not mid_str.startswith("enc_")
    if "hasDrawnMissionCard" not in m_obj:
        m_obj["hasDrawnMissionCard"] = bool(inferred_drawn)
    ec = m_obj.get("encounterCard")
    if isinstance(ec, dict):
        _normalize_encounter_card_data(ec)
        ec["deck"] = _infer_encounter_deck_key(ec)
        return
    maps = _get_static_card_maps()
    enc_by_id = maps["enc_by_id"]
    enc_by_name = maps["enc_by_name"]
    found: Optional[Dict[str, Any]] = None
    m_id_match = re.match(r"^enc_([a-z]+_\d+)_", mid_str)
    if m_id_match:
        found = enc_by_id.get(m_id_match.group(1))
    if not found and m_obj.get("patronName"):
        found = enc_by_name.get(str(m_obj["patronName"]).strip().lower())
    if found:
        ec_cp = copy.deepcopy(found)
        _normalize_encounter_card_data(ec_cp)
        ec_cp["deck"] = _infer_encounter_deck_key(ec_cp)
        m_obj["encounterCard"] = ec_cp


def _recycle_mission_cards(state: Dict[str, Any], m: Dict[str, Any]) -> None:
    """Returns finished/canceled Encounter cards to their Encounter deck and genuine Missiones cards to the Missiones deck."""
    if not isinstance(m, dict):
        return
    _backfill_encounter_mission_metadata(m)
    src = m.get("source") or "starting"
    if src == "encounter":
        ec = m.get("encounterCard")
        if isinstance(ec, dict) and ec.get("id"):
            dk = _infer_encounter_deck_key(ec)
            deck_list = state.get("decks", {}).get(dk)
            if isinstance(deck_list, list) and not any(c.get("id") == ec["id"] for c in deck_list):
                clean_ec = copy.deepcopy(ec)
                _normalize_encounter_card_data(clean_ec)
                deck_list.append(clean_ec)
    mid_str = str(m.get("id") or "")
    is_genuine_mission_card = mid_str.startswith("mis_") or (
        src != "encounter" and not mid_str.startswith("enc_")
    ) or bool(m.get("hasDrawnMissionCard"))
    if not is_genuine_mission_card:
        return
    missiones_deck = state.get("decks", {}).get("missiones")
    if not isinstance(missiones_deck, list):
        return
    if mid_str and any(c.get("id") == mid_str for c in missiones_deck):
        return
    canonical = _get_static_card_maps()["mis_by_id"].get(mid_str)
    if canonical:
        clean_m = copy.deepcopy(canonical)
    else:
        clean_m = copy.deepcopy(m)
        for k in (
            "source",
            "patronName",
            "patronFaction",
            "patronRewardText",
            "hostileFavor",
            "encounterCard",
            "hasDrawnMissionCard",
            "underInfluence",
            "underInfluenceCount",
            "pickedUp",
            "completed",
        ):
            clean_m.pop(k, None)
    missiones_deck.append(clean_m)


def _fail_mission(
    state: Dict[str, Any],
    player: Dict[str, Any],
    m: Dict[str, Any],
    reason: str = "canceled",
    is_fenced: bool = False,
) -> List[str]:
    """Handles failing or voluntarily canceling a mission according to rulebook & Political Climate rules."""
    is_overflow = reason == "6th Soothsayer mission overflow"
    fenced_exempt = (is_fenced or "fenced" in reason.lower()) and has_climate_modifier(state, "plautilla_3")
    counts_as_failure = (not is_overflow) and (not fenced_exempt)
    if counts_as_failure:
        _inc_player_stat(player, "missionsFailed", 1)
    mid = m.get("id")
    # Remove any loaded cargo for this mission from player's cart (thrown away, cannot be sold)
    player["cart"] = [c for c in player.get("cart", []) if c.get("missionId") != mid]
    if m in player.get("missions", []):
        player["missions"].remove(m)
    src = m.get("source") or "starting"
    notes: List[str] = []
    if src == "encounter":
        h_notes = apply_favor_list(
            player,
            m.get("hostileFavor", []),
            reason=f"failing/canceling Encounter Mission '{m.get('name', 'Mission')}'",
        )
        notes.extend(h_notes)
        _recycle_mission_cards(state, m)
        if fenced_exempt:
            notes.append("Smuggler's Fence (not counted as Failed Mission)")
            add_log(
                state,
                f"{player['name']} fenced cargo from Encounter Mission '{m.get('name', 'Mission')}' ({reason}) — Smuggler's Fence waives Mission failure! Reputational consequences: {' '.join(h_notes) or 'None'}.",
                "mission",
            )
        else:
            add_log(
                state,
                f"{player['name']} failed/canceled Encounter Mission '{m.get('name', 'Mission')}' ({reason})! Reputational consequences: {' '.join(h_notes) or 'None'}.",
                "mission",
            )
    elif src == "soothsayer":
        if m.get("underInfluence"):
            under = m.pop("underInfluence", [])
            state["decks"]["influence"].extend(under)
        _recycle_mission_cards(state, m)
        add_log(
            state,
            f"{player['name']} {'canceled overflow' if is_overflow else 'failed'} Soothsayer Mission '{m.get('name', 'Mission')}' ({reason}).",
            "mission",
        )
    else:
        _recycle_mission_cards(state, m)
        add_log(
            state,
            f"{player['name']} canceled/failed Starting Mission '{m.get('name', 'Mission')}' ({reason}).",
            "mission",
        )

    if counts_as_failure and has_climate_modifier(state, "missions_3"):
        player["cash"] -= 10
        notes.append("-10(d) Bonded Couriers Fine")
        add_log(
            state,
            f"📜 Bonded Couriers Fine: {player['name']} paid -10(d) for failing Mission '{m.get('name', 'Mission')}'.",
            "penalty",
        )
    return notes


def _remove_cart_item(
    state: Dict[str, Any],
    player: Dict[str, Any],
    item: Dict[str, Any],
    reason: str = "lost",
    is_fenced: bool = False,
) -> None:
    """Removes an item from player['cart'], returning market goods to the market deck or handling mission cargo loss."""
    if item in player.get("cart", []):
        player["cart"].remove(item)
    if item.get("isMissionCargo"):
        mid = item.get("missionId")
        linked = next((m for m in player.get("missions", []) if m.get("id") == mid), None)
        if linked:
            if linked.get("source") == "soothsayer":
                linked["pickedUp"] = False
                add_log(
                    state,
                    f"{player['name']} lost Soothsayer cargo '{item.get('name')}' ({reason}) — must pick up again in {linked.get('pickupCell')}!",
                    "mission",
                )
            else:
                _fail_mission(state, player, linked, reason, is_fenced=is_fenced)
    elif not str(item.get("id", "")).startswith("forged_wine_"):
        state["decks"]["market"].append(item)


def _fire_guard(state: Dict[str, Any], player: Dict[str, Any], guard: Dict[str, Any], reason: str = "fired") -> None:
    """Removes a Guard from player['guards'] and returns Market guards to the bottom of the Market deck."""
    if guard in player.get("guards", []):
        player["guards"].remove(guard)
    if not str(guard.get("id", "")).startswith("thug_"):
        state["decks"]["market"].append(guard)
    add_log(state, f"{player['name']} fired Guard '{guard.get('name', 'Guard')}' ({reason}).", "action")


def _validate_and_apply_cart_space_swaps(
    state: Dict[str, Any],
    player: Dict[str, Any],
    discard_cart_ids: Optional[List[str]] = None,
    fire_guard_ids: Optional[List[str]] = None,
    incoming_blocks: int = 0,
    incoming_guards: int = 0,
    incoming_bonus_blocks: int = 0,
    incoming_bonus_guards: int = 0,
    reason: str = "to make room on Cart",
) -> Tuple[bool, str, List[str]]:
    """Pre-validates Cart block & Guard slot capacity after optional discards/firings before mutating state."""
    get_player_cart_usage(player)

    discard_ids: List[str] = []
    seen_d = set()
    for raw_id in discard_cart_ids or []:
        cid = str(raw_id)
        if cid and cid not in seen_d:
            seen_d.add(cid)
            discard_ids.append(cid)

    fire_ids: List[str] = []
    seen_f = set()
    for raw_id in fire_guard_ids or []:
        gid = str(raw_id)
        if gid and gid not in seen_f:
            seen_f.add(gid)
            fire_ids.append(gid)

    cart_by_id = {str(c.get("id")): c for c in player.get("cart", [])}
    guards_by_id = {str(g.get("id")): g for g in player.get("guards", [])}

    to_discard: List[Dict[str, Any]] = []
    for cid in discard_ids:
        if cid not in cart_by_id:
            return False, "Selected Cart item to discard is no longer on your Cart.", []
        to_discard.append(cart_by_id[cid])

    to_fire: List[Dict[str, Any]] = []
    for gid in fire_ids:
        if gid not in guards_by_id:
            return False, "Selected Guard to fire is no longer on your Cart.", []
        to_fire.append(guards_by_id[gid])

    rem_cart = [c for c in player.get("cart", []) if str(c.get("id")) not in seen_d]
    rem_guards = [g for g in player.get("guards", []) if str(g.get("id")) not in seen_f]

    proj_max_blocks = (
        6
        + int(player.get("bonusBlocks", 0))
        + sum(int(g.get("bonusBlocks", 0) or 0) for g in rem_guards)
        + int(incoming_bonus_blocks or 0)
    )
    proj_max_guards = (
        2
        + int(player.get("bonusGuards", 0))
        + sum(int(g.get("bonusGuards", 0) or 0) for g in rem_guards)
        + int(incoming_bonus_guards or 0)
    )
    proj_used_blocks = sum(int(c.get("blocks", 1)) for c in rem_cart) + int(incoming_blocks or 0)
    proj_used_guards = sum(int(g.get("guards", 1)) for g in rem_guards) + int(incoming_guards or 0)

    if proj_used_guards > proj_max_guards:
        curr_b, curr_g = get_player_cart_usage(player)
        _, curr_max_g = get_player_cart_limits(player)
        return (
            False,
            f"Guard capacity full ({curr_g}/{curr_max_g} ▲). Select a Guard to fire or cancel.",
            [],
        )

    if proj_used_blocks > proj_max_blocks:
        if incoming_blocks == 0 and to_fire:
            deficit = proj_used_blocks - proj_max_blocks
            return (
                False,
                f"Firing that Guard reduces Cart capacity to {proj_max_blocks}■ while carrying {proj_used_blocks}■ — also select at least {deficit}■ of Goods to discard.",
                [],
            )
        curr_b, _ = get_player_cart_usage(player)
        curr_max_b, _ = get_player_cart_limits(player)
        return (
            False,
            f"Not enough space on your Cart ({curr_b}/{curr_max_b} ■ used; requires {incoming_blocks} ■). Select Goods to discard or cancel.",
            [],
        )

    swap_notes: List[str] = []
    for g in to_fire:
        _fire_guard(state, player, g, reason=reason)
        swap_notes.append(f"fired {g.get('name', 'Guard')}")
    for c in to_discard:
        _remove_cart_item(state, player, c, reason=reason)
        add_log(
            state,
            f"{player['name']} discarded '{c.get('name', 'Good')}' ({c.get('blocks', 1)}■) from their Cart ({reason}).",
            "action",
        )
        swap_notes.append(f"discarded {c.get('name', 'Good')}")

    return True, "", swap_notes


def _complete_delivery_mission(state: Dict[str, Any], player: Dict[str, Any], m: Dict[str, Any], cell: str) -> str:
    mid = m.get("id")
    player["cart"] = [c for c in player.get("cart", []) if c.get("missionId") != mid]
    m["completed"] = True
    if m in player.get("missions", []):
        player["missions"].remove(m)
    r_notes = grant_reward(state, player, m.get("reward"), m.get("rewardText", ""), is_mission_reward=True)
    if m.get("patronRewardText"):
        r_notes.extend(grant_reward(state, player, None, m.get("patronRewardText", ""), is_mission_reward=True))
    patron_lbl = f" for {m['patronName']}" if m.get("patronName") else ""
    f_notes = apply_favor_list(
        player,
        m.get("favor", []),
        reason=f"completing mission '{m['name']}'{patron_lbl} (delivered {m.get('item', 'Cargo')} to {cell})",
    )
    if m.get("source") == "soothsayer" and m.get("underInfluence"):
        under = m.pop("underInfluence", [])
        player["influence"].extend(under)
        r_notes.append(f"+{len(under)} Soothsayer Influence Card(s)")
    _record_mission_completion_event(
        state,
        player,
        m,
        r_notes,
        f_notes,
        context_detail=f"Delivered {m.get('item', 'Cargo')} to {cell} ({NEIGHBORHOOD_NAMES.get(cell, cell)})",
    )
    _recycle_mission_cards(state, m)
    msg = f"{player['name']} delivered {m.get('item', 'Cargo')} to {cell} and completed Mission '{m['name']}'! {' '.join(r_notes + f_notes)}"
    add_log(state, msg, "mission")
    return msg


def check_passive_missions(state: Dict[str, Any], player: Dict[str, Any]) -> None:
    """Checks Step 4 passive mission completions ('expose' and picked-up 'delivery' arrivals) before Step 5 Tile Encounters."""
    norm_cell = normalize_cell_id(player.get("position")) if player.get("position") else None
    for m in list(player["missions"]):
        if m.get("completed"):
            continue
        kind = m.get("kind")
        if kind == "expose":
            icon_type = m.get("exposeType", "patricii")
            needed = int(m.get("exposeCount", 4))
            current = count_exposed_icons(state, icon_type)
            if current >= needed:
                m["completed"] = True
                player["missions"].remove(m)
                r_notes = grant_reward(state, player, m.get("reward"), m.get("rewardText", ""), is_mission_reward=True)
                if m.get("patronRewardText"):
                    r_notes.extend(grant_reward(state, player, None, m.get("patronRewardText", ""), is_mission_reward=True))
                patron_lbl = f" for {m['patronName']}" if m.get("patronName") else ""
                f_notes = apply_favor_list(
                    player,
                    m.get("favor", []),
                    reason=f"completing mission '{m['name']}'{patron_lbl}",
                )
                if m.get("source") == "soothsayer" and m.get("underInfluence"):
                    under = m.pop("underInfluence", [])
                    player["influence"].extend(under)
                    r_notes.append(f"+{len(under)} Soothsayer Influence Card(s)")
                _record_mission_completion_event(
                    state,
                    player,
                    m,
                    r_notes,
                    f_notes,
                    context_detail=f"{current}/{needed} {icon_type.capitalize()} symbols simultaneously exposed in Rome",
                )
                _recycle_mission_cards(state, m)
                add_log(state, f"{player['name']} completed Mission '{m['name']}' ({current}/{needed} {icon_type} exposed)! {' '.join(r_notes + f_notes)}", "mission")
                if player.get("isBot"):
                    add_npc_event(
                        state,
                        player,
                        "mission",
                        f"Completed '{m['name']}'",
                        norm_cell,
                        visual={"kind": "mission", "missionName": m.get("name", "Mission"), "outcomeLabel": f"📜 {m.get('name', 'Mission')}"},
                    )
        elif kind == "delivery" and norm_cell:
            p_cell = normalize_cell_id(m.get("pickupCell"))
            d_cell = normalize_cell_id(m.get("deliverCell"))
            # Pickup: automatic for AI bots; human players choose via popup or Mission card button so they control Cart block allocation
            if not m.get("pickedUp") and p_cell == norm_cell:
                if player.get("isBot"):
                    max_b, _ = get_player_cart_limits(player)
                    used_b, _ = get_player_cart_usage(player)
                    req_b = int(m.get("blocks", 1))
                    if used_b + req_b <= max_b:
                        m["pickedUp"] = True
                        cargo_card = _create_mission_cargo_card(m)
                        player["cart"].append(cargo_card)
                        add_log(state, f"{player['name']} picked up {m.get('item', 'Cargo')} ({req_b}■) in {norm_cell} for Mission '{m['name']}'.", "mission")
                        add_npc_event(
                            state,
                            player,
                            "pickup",
                            f"Loaded {m.get('item', 'Cargo')} in {norm_cell}",
                            norm_cell,
                            visual={
                                "kind": "pickup",
                                "item": _public_item_visual(cargo_card),
                                "outcomeLabel": f"📦 Loaded {m.get('item', 'Cargo')}",
                            },
                        )
            # Delivery (Step 4): BOTH humans and bots auto-complete picked-up Cargo Delivery upon arriving at deliverCell BEFORE Step 5 Tile Encounter!
            elif m.get("pickedUp") and d_cell == norm_cell:
                cargo_vis = _public_item_visual({"name": m.get("item", "Cargo"), "category": m.get("category", "Goods"), "blocks": m.get("blocks", 1)})
                _complete_delivery_mission(state, player, m, norm_cell)
                if player.get("isBot"):
                    add_npc_event(
                        state,
                        player,
                        "deliver",
                        f"Delivered {m.get('item', 'Cargo')} in {norm_cell} ('{m['name']}')",
                        norm_cell,
                        visual={
                            "kind": "deliver",
                            "item": cargo_vis,
                            "missionName": m.get("name", "Mission"),
                            "outcomeLabel": f"🏛️ Delivered {m.get('item', 'Cargo')}!",
                        },
                    )


def _estimate_player_standing(state: Dict[str, Any], player: Dict[str, Any]) -> int:
    score = int(player.get("cash", 0))
    for item in player.get("cart", []):
        sell_tbl = item.get("sell")
        if sell_tbl:
            score += int(sell_tbl[min(2, len(sell_tbl) - 1)])
        elif item.get("isMissionCargo"):
            score += 7
    score += 5 * sum(1 for m in player.get("missions", []) if m.get("pickedUp") and not m.get("completed"))
    score += 3 * len(player.get("guards", []))
    score += 2 * len(player.get("influence", []))
    score += 2 * sum(int(v) for v in (player.get("favor") or {}).values())
    loans = player.get("loans") or {}
    if loans.get("spring"):
        score -= 30 if int(state.get("seasonIndex", 0)) <= 1 else 45
    if loans.get("summer"):
        score -= 60
    return score


def _get_winning_opponent(state: Dict[str, Any], bot: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    opponents = [p for p in state.get("players", []) if p["index"] != bot["index"]]
    if not opponents:
        return None
    return max(opponents, key=lambda p: (_estimate_player_standing(state, p), int(p.get("cash", 0)), -p["index"]))


def _count_bot_adversarial_cards(bot: Dict[str, Any]) -> int:
    adv_keywords = ("Twist Of Fate", "Chamber Pot", "Gladiator", "Mercenary", "Distraction", "Surprise Shipment", "Prophecy")
    return sum(1 for c in bot.get("influence", []) if any(k in str(c.get("name", "")) for k in adv_keywords))


def _should_bot_target_adversarially(
    state: Dict[str, Any],
    bot: Dict[str, Any],
    target_player: Dict[str, Any],
    is_extreme_luck: bool = False,
) -> bool:
    if target_player["index"] == bot["index"]:
        return False
    leader_opp = _get_winning_opponent(state, bot)
    if leader_opp is None:
        return False
    target_score = _estimate_player_standing(state, target_player)
    leader_score = _estimate_player_standing(state, leader_opp)
    bot_score = _estimate_player_standing(state, bot)
    # Prioritize the winning opponent (or a player virtually tied with the leader and ahead of this bot)
    if target_player["index"] == leader_opp["index"] or (target_score >= leader_score - 4 and target_score >= bot_score):
        return True
    # Conserve adversarial cards against trailing players unless the bot has surplus cards on an extreme luck roll
    if is_extreme_luck and (_count_bot_adversarial_cards(bot) >= 2 or (state.get("seasonIndex", 0) == 2 and target_score >= bot_score - 3)):
        return True
    return False


def _iter_bots_after_player(state: Dict[str, Any], ref_player: Dict[str, Any]) -> List[Dict[str, Any]]:
    players = state.get("players", [])
    n = len(players)
    if n == 0:
        return []
    result = []
    for offset in range(1, n):
        p = players[(ref_player["index"] + offset) % n]
        if p.get("isBot"):
            result.append(p)
    return result


def _get_player_twist_of_fate_cards(player: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [c for c in player.get("influence", []) if "Twist Of Fate" in str(c.get("name", ""))]


def _find_human_intervenor_for_twist_of_fate(
    state: Dict[str, Any],
    enc_player: Dict[str, Any],
    passed_indices: Optional[List[int]] = None,
) -> Optional[Dict[str, Any]]:
    passed = set(passed_indices or [])
    if not enc_player.get("isBot") and enc_player["index"] not in passed and _get_player_twist_of_fate_cards(enc_player):
        return enc_player
    players = state.get("players", [])
    n = len(players)
    for offset in range(1, n):
        p = players[(enc_player["index"] + offset) % n]
        if not p.get("isBot") and p["index"] not in passed and _get_player_twist_of_fate_cards(p):
            return p
    return None


def _maybe_bot_reroll_reward_die(
    state: Dict[str, Any],
    player: Dict[str, Any],
    kind_label: str,
    rolls: List[int],
    mult: int = 0,
) -> List[int]:
    if not rolls:
        return rolls
    max_val = max(rolls)
    is_lucky = (max_val >= 3) or (len(rolls) > 1 and sum(rolls) >= 4) or (mult >= 10 and max_val >= 2)
    if not is_lucky:
        return rolls
    for bot in _iter_bots_after_player(state, player):
        tof = next((c for c in bot.get("influence", []) if "Twist Of Fate" in str(c.get("name", ""))), None)
        if not tof:
            continue
        if not _should_bot_target_adversarially(state, bot, player, is_extreme_luck=(max_val >= 3)):
            continue
        die_idx = rolls.index(max_val)
        old_r = rolls[die_idx]
        old_rom = roman_die_str(old_r)
        bot["influence"].remove(tof)
        state["decks"]["influence"].append(tof)
        state["hourEffects"]["lastInfluencePlayed"] = tof
        _inc_player_stat(bot, "influencePlayed", 1)
        new_r = roll_rome_die()
        new_rom = roman_die_str(new_r)
        rolls = list(rolls)
        rolls[die_idx] = new_r
        note = f"{bot['name']} played 'Twist Of Fate' against {player['name']}'s lucky {old_rom} {kind_label} roll ({old_rom} -> {new_rom})!"
        add_log(state, note, "action")
        rom_list = " + ".join(roman_die_str(x) for x in rolls)
        total_lbl = f"{new_rom} × {mult}d = +{new_r * mult}(d)" if mult > 0 else f"+{sum(rolls)} Influence"
        add_dice_event(
            state,
            kind="reward",
            title=f"🎲 TWIST OF FATE RE-ROLL ({kind_label.upper()}) — {player['name']}",
            subtitle=note,
            groups=[{
                "rollerName": player["name"],
                "rollerType": "player",
                "colorName": player["color"],
                "flatBonus": 0,
                "totalLabel": total_lbl,
                "dice": [
                    {
                        "value": x,
                        "roman": roman_die_str(x),
                        "sign": 1,
                        "label": f"Re-rolled ®" if i == die_idx else f"Reward ® #{i+1}",
                        "color": player["color"],
                    }
                    for i, x in enumerate(rolls)
                ],
            }],
            outcome_title=f"RE-ROLLED {rom_list}",
            outcome_message=note,
        )
        break
    return rolls


def _get_player_pre_combat_influence(player: Dict[str, Any]) -> List[Dict[str, Any]]:
    cards = []
    for c in player.get("influence", []):
        nm = str(c.get("name", ""))
        if any(k in nm for k in ("Distraction", "Mercenary", "Gladiator", "Flying Chamber Pot")):
            cards.append(c)
    return cards


def _get_player_post_chart_influence(player: Dict[str, Any], chart_type: str, is_self: bool = True) -> List[Dict[str, Any]]:
    cards = []
    for c in player.get("influence", []):
        nm = str(c.get("name", ""))
        if "Twist Of Fate" in nm:
            cards.append(c)
        elif "Lucky Break" in nm and chart_type in ("death", "mob", "theater"):
            cards.append(c)
        elif is_self and "Man Of The People" in nm and chart_type == "mob":
            cards.append(c)
        elif is_self and "Dramaturge" in nm and chart_type == "theater":
            cards.append(c)
    return cards


def _find_human_intervenor_for_pre_combat(state: Dict[str, Any], enc_player: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not enc_player.get("isBot") and _get_player_pre_combat_influence(enc_player):
        return enc_player
    for p in state.get("players", []):
        if not p.get("isBot") and _get_player_pre_combat_influence(p):
            return p
    return None


def _find_human_intervenor_for_post_chart(
    state: Dict[str, Any],
    enc_player: Dict[str, Any],
    chart_type: str,
    passed_indices: Optional[List[int]] = None,
) -> Optional[Dict[str, Any]]:
    passed = set(passed_indices or [])
    if (
        not enc_player.get("isBot")
        and enc_player["index"] not in passed
        and _get_player_post_chart_influence(enc_player, chart_type, is_self=True)
    ):
        return enc_player
    players = state.get("players", [])
    n = len(players)
    for offset in range(1, n):
        p = players[(enc_player["index"] + offset) % n]
        if not p.get("isBot") and p["index"] not in passed and _get_player_post_chart_influence(p, chart_type, is_self=False):
            return p
    return None


def _get_chart_roll_preview(
    player: Dict[str, Any],
    chart_type: str,
    r: int,
    soothsayer_mission: Optional[Dict[str, Any]] = None,
) -> str:
    r_clamped = max(0, min(3, int(r)))
    r_rom = roman_die_str(r_clamped)
    if chart_type == "death":
        if r_clamped == 0:
            return f"Rolled {r_rom} (0) → Yep, dead! Lose all Goods on Cart and your Night is over!"
        if r_clamped == 1:
            return f"Rolled {r_rom} (I) → Left for dead! Lose all Goods on Cart, night continues."
        if r_clamped == 2:
            return f"Rolled {r_rom} (II) → Beaten and mugged! Lose all {player['cash']}(d), night continues."
        return f"Rolled {r_rom} (III) → Begged for mercy! Lose all {len(player['influence'])} Influence cards, night continues."
    if chart_type == "mob":
        if r_clamped == 0:
            return f"Rolled {r_rom} (0) → Angry Mob drinks all of {player['name']}'s Wine!"
        if r_clamped == 1:
            return f"Rolled {r_rom} (I) → Angry Mob loots all of {player['name']}'s Grain!"
        if r_clamped == 2:
            return f"Rolled {r_rom} (II) → Angry Mob seizes {player['name']}'s most expensive Cargo good!"
        return f"Rolled {r_rom} (III) → The crowd clamors noisily as {player['name']} passes safely!"
    if chart_type == "theater":
        if r_clamped == 0:
            return f"Rolled {r_rom} (0) → Mocked on stage! Lose all positive Friendly Favor!"
        if r_clamped == 1:
            return f"Rolled {r_rom} (I) → Satire clears your name! Lose all negative Hostile Favor!"
        if r_clamped == 2:
            return f"Rolled {r_rom} (II) → Blocked by revelers! Lose the rest of this turn and next turn!"
        return f"Rolled {r_rom} (III) → Inspired performance! Roll 1(R) to draw bonus Influence cards!"
    if chart_type == "soothsayer":
        m_name = (soothsayer_mission or {}).get("name", "Soothsayer Mission")
        return f"Rolled {r_rom} ({r_clamped}) → {r_clamped} Influence card(s) sealed beneath mandatory Mission '{m_name}'!"
    return f"Rolled {r_rom}"


def _does_bot_want_post_chart_intervention(
    state: Dict[str, Any],
    player: Dict[str, Any],
    chart_type: str,
    r: int,
) -> bool:
    # Self-defense if player is a bot
    if player.get("isBot"):
        if chart_type == "mob":
            if (r == 0 and any(c.get("track") == "Wine" for c in player["cart"])) or (
                r == 1 and any(c.get("track") == "Grain" for c in player["cart"])
            ) or (r == 2 and len(player["cart"]) > 0):
                if _get_player_post_chart_influence(player, chart_type, is_self=True):
                    return True
        elif chart_type == "theater":
            pos_fav = sum(v for v in player["favor"].values() if v > 0)
            if (r == 0 and pos_fav >= 2) or r == 2:
                if _get_player_post_chart_influence(player, chart_type, is_self=True):
                    return True
        elif chart_type == "death":
            if r == 0 or (r == 1 and len(player["cart"]) >= 2) or (r == 2 and player["cash"] >= 16):
                if _get_player_post_chart_influence(player, chart_type, is_self=True):
                    return True
        elif chart_type == "soothsayer" and r == 0 and _get_player_twist_of_fate_cards(player):
            return True

    # Adversarial check by opposing bots
    neg_fav = sum(abs(v) for v in player["favor"].values() if v < 0)
    is_lucky_rival = False
    is_extreme = False
    if chart_type == "mob" and r == 3 and len(player["cart"]) > 0:
        is_lucky_rival = True
        is_extreme = len(player["cart"]) >= 2
    elif chart_type == "theater" and (r == 3 or (r == 1 and neg_fav >= 2)):
        is_lucky_rival = True
        is_extreme = (r == 3)
    elif chart_type == "death" and (r == 3 or (r == 2 and player["cash"] <= 4 and len(player["cart"]) > 0)):
        is_lucky_rival = True
        is_extreme = True
    elif chart_type == "soothsayer" and r == 3:
        is_lucky_rival = True
        is_extreme = True

    if is_lucky_rival:
        for bot in _iter_bots_after_player(state, player):
            if not _should_bot_target_adversarially(state, bot, player, is_extreme_luck=is_extreme):
                continue
            if chart_type == "theater" and r == 1 and any("Lucky Break" in str(c.get("name", "")) for c in bot["influence"]):
                return True
            if _get_player_twist_of_fate_cards(bot):
                return True
    return False


def _run_bot_post_chart_interventions(
    state: Dict[str, Any],
    player: Dict[str, Any],
    chart_state: Dict[str, Any],
) -> bool:
    if int(chart_state.get("botInterventions", 0)) >= 2:
        return False
    c_type = chart_state.get("chartType", "mob")
    r = int(chart_state.get("chartRoll", 0))
    sooth_m = chart_state.get("soothsayerMission")

    # 1. Self-defense by bot roller
    if player.get("isBot"):
        if c_type == "mob" and any("Man Of The People" in str(c.get("name", "")) for c in player["influence"]):
            bad_mob = (r == 0 and any(c.get("track") == "Wine" for c in player["cart"])) or (
                r == 1 and any(c.get("track") == "Grain" for c in player["cart"])
            ) or (r == 2 and len(player["cart"]) > 0)
            if bad_mob:
                motp = next(c for c in player["influence"] if "Man Of The People" in str(c.get("name", "")))
                player["influence"].remove(motp)
                state["decks"]["influence"].append(motp)
                state["hourEffects"]["lastInfluencePlayed"] = motp
                _inc_player_stat(player, "influencePlayed", 1)
                player["cash"] += 4
                add_log(state, f"{player['name']} played 'Man Of The People' to ignore the Angry Mob and collected +4(d)!", "encounter")
                chart_state["ignoredBySelfCard"] = "mob"
                chart_state["botInterventions"] = int(chart_state.get("botInterventions", 0)) + 1
                return True
        if c_type == "theater" and r in (0, 2) and any("Dramaturge" in str(c.get("name", "")) for c in player["influence"]):
            dram = next(c for c in player["influence"] if "Dramaturge" in str(c.get("name", "")))
            player["influence"].remove(dram)
            state["decks"]["influence"].append(dram)
            state["hourEffects"]["lastInfluencePlayed"] = dram
            _inc_player_stat(player, "influencePlayed", 1)
            add_log(state, f"{player['name']} played 'Dramaturge' to turn the Theater Troupe into an automatic III result!", "encounter")
            chart_state["ignoredBySelfCard"] = "theater"
            chart_state["botInterventions"] = int(chart_state.get("botInterventions", 0)) + 1
            return True
        # Lucky Break on self (e.g. Mob II -> III, Theater II -> III, Death 0 -> I)
        lb = next((c for c in player["influence"] if "Lucky Break" in str(c.get("name", ""))), None)
        if lb and c_type in ("death", "mob", "theater"):
            use_lb = (c_type == "mob" and r == 2 and len(player["cart"]) > 0) or (c_type == "theater" and r == 2) or (c_type == "death" and r == 0)
            if use_lb:
                old_r = r
                new_r = min(3, old_r + 1)
                player["influence"].remove(lb)
                state["decks"]["influence"].append(lb)
                state["hourEffects"]["lastInfluencePlayed"] = lb
                _inc_player_stat(player, "influencePlayed", 1)
                chart_state["chartRoll"] = new_r
                chart_state["previewText"] = _get_chart_roll_preview(player, c_type, new_r, sooth_m)
                chart_state["botInterventions"] = int(chart_state.get("botInterventions", 0)) + 1
                chart_state["passedIntervenors"] = []
                note = f"{player['name']} played 'Lucky Break' (+1 to Chart Roll: {roman_die_str(old_r)} -> {roman_die_str(new_r)})!"
                add_log(state, note, "action")
                return True
        # Twist Of Fate on self
        tof_self = next((c for c in player["influence"] if "Twist Of Fate" in str(c.get("name", ""))), None)
        if tof_self:
            pos_fav = sum(v for v in player["favor"].values() if v > 0)
            bad_self = (
                (c_type == "mob" and ((r == 0 and any(c.get("track") == "Wine" for c in player["cart"])) or (r == 1 and any(c.get("track") == "Grain" for c in player["cart"])) or (r == 2 and len(player["cart"]) > 0)))
                or (c_type == "theater" and ((r == 0 and pos_fav >= 2) or r == 2))
                or (c_type == "death" and (r == 0 or (r == 1 and len(player["cart"]) >= 2) or (r == 2 and player["cash"] >= 16)))
                or (c_type == "soothsayer" and r == 0)
            )
            if bad_self:
                old_r = r
                new_r = roll_rome_die()
                new_rom = roman_die_str(new_r)
                player["influence"].remove(tof_self)
                state["decks"]["influence"].append(tof_self)
                state["hourEffects"]["lastInfluencePlayed"] = tof_self
                _inc_player_stat(player, "influencePlayed", 1)
                chart_state["chartRoll"] = new_r
                chart_state["previewText"] = _get_chart_roll_preview(player, c_type, new_r, sooth_m)
                chart_state["botInterventions"] = int(chart_state.get("botInterventions", 0)) + 1
                chart_state["passedIntervenors"] = []
                note = f"{player['name']} played 'Twist Of Fate' to re-roll their own {c_type.capitalize()} Chart die ({roman_die_str(old_r)} -> {new_rom})!"
                add_log(state, note, "action")
                add_dice_event(
                    state,
                    kind="driver_fate" if c_type == "death" else "table_encounter",
                    title=f"🎲 TWIST OF FATE RE-ROLL ({c_type.upper()}) — {player['name']}",
                    subtitle=note,
                    groups=[{
                        "rollerName": player["name"],
                        "rollerType": "player",
                        "colorName": player["color"],
                        "flatBonus": 0,
                        "totalLabel": f"Re-rolled: {new_rom}",
                        "dice": [{"value": new_r, "roman": new_rom, "sign": 0 if c_type == "death" else 1, "label": "Re-rolled ®", "color": player["color"]}],
                    }],
                    outcome_title=f"RE-ROLLED {new_rom}",
                    outcome_message=chart_state["previewText"],
                )
                return True

    # 2. Adversarial intervention by opposing bots
    r = int(chart_state.get("chartRoll", 0))
    neg_fav = sum(abs(v) for v in player["favor"].values() if v < 0)
    is_lucky_rival = False
    is_extreme = False
    if c_type == "mob" and r == 3 and len(player["cart"]) > 0:
        is_lucky_rival = True
        is_extreme = len(player["cart"]) >= 2
    elif c_type == "theater" and (r == 3 or (r == 1 and neg_fav >= 2)):
        is_lucky_rival = True
        is_extreme = (r == 3)
    elif c_type == "death" and (r == 3 or (r == 2 and player["cash"] <= 4 and len(player["cart"]) > 0)):
        is_lucky_rival = True
        is_extreme = True
    elif c_type == "soothsayer" and r == 3:
        is_lucky_rival = True
        is_extreme = True

    if is_lucky_rival:
        for bot in _iter_bots_after_player(state, player):
            if not _should_bot_target_adversarially(state, bot, player, is_extreme_luck=is_extreme):
                continue
            # Offensive Lucky Break on Theater I -> II (turns 'clear hostile favor' into 'lose turn'!)
            if c_type == "theater" and r == 1:
                lb_opp = next((c for c in bot["influence"] if "Lucky Break" in str(c.get("name", ""))), None)
                if lb_opp:
                    bot["influence"].remove(lb_opp)
                    state["decks"]["influence"].append(lb_opp)
                    state["hourEffects"]["lastInfluencePlayed"] = lb_opp
                    _inc_player_stat(bot, "influencePlayed", 1)
                    chart_state["chartRoll"] = 2
                    chart_state["previewText"] = _get_chart_roll_preview(player, c_type, 2, sooth_m)
                    chart_state["botInterventions"] = int(chart_state.get("botInterventions", 0)) + 1
                    chart_state["passedIntervenors"] = []
                    note = f"{bot['name']} played 'Lucky Break' against {player['name']}'s Theater Troupe roll (I -> II: Blocked by revelers)!"
                    add_log(state, note, "action")
                    return True
            tof = next((c for c in bot["influence"] if "Twist Of Fate" in str(c.get("name", ""))), None)
            if tof:
                old_r = r
                new_r = roll_rome_die()
                new_rom = roman_die_str(new_r)
                bot["influence"].remove(tof)
                state["decks"]["influence"].append(tof)
                state["hourEffects"]["lastInfluencePlayed"] = tof
                _inc_player_stat(bot, "influencePlayed", 1)
                chart_state["chartRoll"] = new_r
                chart_state["previewText"] = _get_chart_roll_preview(player, c_type, new_r, sooth_m)
                chart_state["botInterventions"] = int(chart_state.get("botInterventions", 0)) + 1
                chart_state["passedIntervenors"] = []
                note = f"{bot['name']} played 'Twist Of Fate' to force {player['name']} to re-roll their lucky {roman_die_str(old_r)} {c_type.capitalize()} roll ({roman_die_str(old_r)} -> {new_rom})!"
                add_log(state, note, "action")
                add_dice_event(
                    state,
                    kind="driver_fate" if c_type == "death" else "table_encounter",
                    title=f"🎲 TWIST OF FATE RE-ROLL ({c_type.upper()}) — {player['name']}",
                    subtitle=note,
                    groups=[{
                        "rollerName": player["name"],
                        "rollerType": "player",
                        "colorName": player["color"],
                        "flatBonus": 0,
                        "totalLabel": f"Re-rolled: {new_rom}",
                        "dice": [{"value": new_r, "roman": new_rom, "sign": 0 if c_type == "death" else 1, "label": "Re-rolled ®", "color": player["color"]}],
                    }],
                    outcome_title=f"RE-ROLLED {new_rom}",
                    outcome_message=chart_state["previewText"],
                )
                return True
    return False


def _apply_table_encounter_outcome(
    state: Dict[str, Any],
    player: Dict[str, Any],
    enc_type: str,
    r: int,
    emit_dice_event: bool = True,
    soothsayer_mission: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    r = max(0, min(3, int(r)))
    r_rom = roman_die_str(r)
    if enc_type == "soothsayer":
        goal = soothsayer_mission
        if goal is None and state["decks"]["missiones"]:
            goal = state["decks"]["missiones"].pop(0)
        if not goal:
            return {"type": "soothsayer", "roll": 0}
        under_cards = []
        for _ in range(r):
            if state["decks"]["influence"]:
                under_cards.append(state["decks"]["influence"].pop(0))
        goal["source"] = "soothsayer"
        goal["pickedUp"] = False
        goal["completed"] = False
        goal["underInfluence"] = under_cards
        if len(player["missions"]) >= 5 and player.get("isBot"):
            replaced = next((m for m in player["missions"] if m.get("source") != "soothsayer"), player["missions"][0])
            _fail_mission(state, player, replaced, reason="replaced by Soothsayer mission")
        player["missions"].append(goal)
        msg = f"{player['name']} encountered a Soothsayer! Received mandatory Mission '{goal['name']}' with {len(under_cards)} Influence card(s) sealed beneath it (rolled ®={r_rom})."
        add_log(state, msg, "encounter")
        if emit_dice_event:
            add_dice_event(
                state,
                kind="table_encounter",
                title=f"🔮 SOOTHSAYER PROPHECY — {player['name']}",
                subtitle="Roll ® Influence Cards Sealed Under Mission",
                groups=[{
                    "rollerName": player["name"],
                    "rollerType": "player",
                    "colorName": player["color"],
                    "flatBonus": 0,
                    "totalLabel": f"Rolled {r_rom} ({len(under_cards)} Sealed)",
                    "dice": [{"value": r, "roman": r_rom, "sign": 1, "label": "Soothsayer ®", "color": player["color"]}],
                }],
                outcome_title=f"ROLLED {r_rom} — {len(under_cards)} INFLUENCE SEALED",
                outcome_message=msg,
            )
        if player.get("isBot"):
            add_npc_event(
                state,
                player,
                "table_encounter",
                f"Soothsayer Prophecy ({r_rom} Influence sealed)",
                cell=player.get("position"),
                visual={
                    "kind": "table_encounter",
                    "chartType": "soothsayer",
                    "cardName": "Soothsayer",
                    "roll": r,
                    "roman": r_rom,
                    "outcome": "mission",
                    "outcomeLabel": f"🔮 Prophecy ({r_rom}🃏)",
                },
            )
        check_passive_missions(state, player)
        return {"type": "soothsayer", "roll": r, "mission": goal["name"], "underCards": len(under_cards)}

    if enc_type == "mob":
        mob_lbl = "✓ Passed Safely"
        if r == 0:
            wines = [c for c in list(player["cart"]) if c.get("track") == "Wine"]
            for w in wines:
                _remove_cart_item(state, player, w, reason="looted by Angry Mob")
            if wines:
                state["lastStolenGood"] = wines[0]
            msg = f"Angry Mob (rolled ®={r_rom})! The mob drank all {len(wines)} of {player['name']}'s Wine!"
            mob_lbl = f"🍷 Lost {len(wines)} Wine" if wines else "🍷 No Wine Lost"
        elif r == 1:
            grains = [c for c in list(player["cart"]) if c.get("track") == "Grain"]
            for g in grains:
                _remove_cart_item(state, player, g, reason="looted by Angry Mob")
            if grains:
                state["lastStolenGood"] = grains[0]
            msg = f"Angry Mob (rolled ®={r_rom})! The mob looted all {len(grains)} of {player['name']}'s Grain!"
            mob_lbl = f"🌾 Lost {len(grains)} Grain" if grains else "🌾 No Grain Lost"
        elif r == 2:
            if player["cart"]:
                player["cart"].sort(key=_item_base_value, reverse=True)
                taken = player["cart"][0]
                _remove_cart_item(state, player, taken, reason="seized by Angry Mob")
                state["lastStolenGood"] = taken
                msg = f"Angry Mob (rolled ®={r_rom})! The mob seized {player['name']}'s most expensive cargo: {taken['name']}!"
                mob_lbl = f"📦 Lost {taken['name']}!"
            else:
                msg = f"Angry Mob (rolled ®={r_rom})! {player['name']}'s cart was empty."
                mob_lbl = "📦 Cart Empty"
        else:
            msg = f"Angry Mob (rolled ®={r_rom})! The crowd clamors noisily as {player['name']} passes safely."
            mob_lbl = "✓ Passed Safely"
        add_log(state, msg, "encounter")
        if emit_dice_event:
            add_dice_event(
                state,
                kind="table_encounter",
                title=f"🔥 ANGRY MOB ENCOUNTER — {player['name']}",
                subtitle="0: Lose Wine • I: Lose Grain • II: Lose Best Good • III: Clamors Noisily",
                groups=[{
                    "rollerName": player["name"],
                    "rollerType": "player",
                    "colorName": player["color"],
                    "flatBonus": 0,
                    "totalLabel": f"Rolled {r_rom}",
                    "dice": [{"value": r, "roman": r_rom, "sign": 1, "label": "Angry Mob ®", "color": player["color"]}],
                }],
                outcome_title=f"ROLLED {r_rom}",
                outcome_message=msg,
            )
        if player.get("isBot"):
            add_npc_event(
                state,
                player,
                "table_encounter",
                f"Angry Mob ({r_rom}): {mob_lbl}",
                cell=player.get("position"),
                visual={
                    "kind": "table_encounter",
                    "chartType": "mob",
                    "cardName": "Angry Mob",
                    "roll": r,
                    "roman": r_rom,
                    "outcome": "safe" if r == 3 else "penalty",
                    "outcomeLabel": mob_lbl,
                },
            )
        return {"type": "mob", "roll": r}

    if enc_type == "theater":
        dice_shown = [{"value": r, "roman": r_rom, "sign": 1, "label": "Troupe ®", "color": player["color"]}]
        th_lbl = "🎭 Troupe"
        if r == 0:
            fav_hist = player.setdefault("favorHistory", {f: [] for f in FACTIONS})
            for f in FACTIONS:
                old_val = player["favor"].get(f, 0)
                if old_val > 0:
                    player["favor"][f] = 0
                    fav_hist.setdefault(f, []).append({"delta": -old_val, "reason": "Theater Troupe (mocked on stage: lost Friendly Favor)"})
            msg = f"Theater Troupe (rolled ®={r_rom})! {player['name']} was mocked on stage and lost all positive Friendly Favor!"
            th_lbl = "👎 Lost Friendly Favor"
        elif r == 1:
            fav_hist = player.setdefault("favorHistory", {f: [] for f in FACTIONS})
            for f in FACTIONS:
                old_val = player["favor"].get(f, 0)
                if old_val < 0:
                    player["favor"][f] = 0
                    fav_hist.setdefault(f, []).append({"delta": -old_val, "reason": "Theater Troupe (satire cleared Hostile Favor)"})
            msg = f"Theater Troupe (rolled ®={r_rom})! Satire cleared {player['name']}'s name — lost all negative Hostile Favor!"
            th_lbl = "✨ Cleared Hostile Favor"
        elif r == 2:
            player["skipTurns"] = player.get("skipTurns", 0) + 1
            player["turnStep"] = "done"
            msg = f"Theater Troupe (rolled ®={r_rom})! {player['name']}'s cart is blocked by revelers — loses the rest of this turn and next turn!"
            th_lbl = "⏳ Blocked (Lost Turn)"
        else:
            r2 = roll_rome_die()
            r2_rom = roman_die_str(r2)
            dice_shown.append({"value": r2, "roman": r2_rom, "sign": 1, "label": "Bonus Influence ®", "color": player["color"]})
            rerolled_b = _maybe_bot_reroll_reward_die(state, player, "Theater Troupe Bonus", [r2], mult=0)
            r2 = rerolled_b[0]
            r2_rom = roman_die_str(r2)
            for _ in range(r2):
                if state["decks"]["influence"]:
                    player["influence"].append(state["decks"]["influence"].pop(0))
            msg = f"Theater Troupe (rolled ®={r_rom}, bonus ®={r2_rom})! Inspired performance grants {player['name']} +{r2} Influence card(s)!"
            th_lbl = f"🃏 +{r2} Influence"
        add_log(state, msg, "encounter")
        if emit_dice_event:
            add_dice_event(
                state,
                kind="table_encounter",
                title=f"🎭 THEATER TROUPE ENCOUNTER — {player['name']}",
                subtitle="0: Lose Friendly Favor • I: Lose Hostile Favor • II: Lose Turn • III: Draw ® Influence",
                groups=[{
                    "rollerName": player["name"],
                    "rollerType": "player",
                    "colorName": player["color"],
                    "flatBonus": 0,
                    "totalLabel": f"Rolled {r_rom}",
                    "dice": dice_shown,
                }],
                outcome_title=f"ROLLED {r_rom}",
                outcome_message=msg,
            )
        if player.get("isBot"):
            add_npc_event(
                state,
                player,
                "table_encounter",
                f"Theater Troupe ({r_rom}): {th_lbl}",
                cell=player.get("position"),
                visual={
                    "kind": "table_encounter",
                    "chartType": "theater",
                    "cardName": "Theater Troupe",
                    "roll": r,
                    "roman": r_rom,
                    "outcome": "reward" if r == 3 else ("safe" if r == 1 else "penalty"),
                    "outcomeLabel": th_lbl,
                },
            )
        return {"type": "theater", "roll": r}

    return {"type": enc_type, "roll": r}


def _normalize_encounter_card_data(card: Optional[Dict[str, Any]]) -> None:
    """Normalizes Encounter card alignments and relative +/- scarcity modifiers across live and saved games."""
    if not isinstance(card, dict):
        return
    if card.get("id") == "nef_26" or (card.get("name") == "Clemens" and card.get("type") == "character"):
        if not card.get("faction"):
            card["faction"] = "Aurelius"
        if not card.get("friendlyFavor"):
            card["friendlyFavor"] = ["Aurelius"]
        if card.get("hostileFavor") in (None, [], ["-Caracalla"]):
            card["hostileFavor"] = ["-Aurelius"]
    m_sub = card.get("mission")
    act_str = str(card.get("actionText") or "")
    is_fixed_npc_sell = (
        (isinstance(m_sub, dict) and m_sub.get("kind") == "buy_from_npc" and "relative" not in act_str.lower())
        or ("will sell" in act_str.lower() and "relative" not in act_str.lower())
    )
    if not is_fixed_npc_sell:
        if isinstance(card.get("actionText"), str):
            card["actionText"] = _normalize_relative_scarcity_text(card["actionText"])
        if isinstance(m_sub, dict) and m_sub.get("modifier") is not None:
            m_sub["modifier"] = normalize_scarcity_modifier(str(m_sub["modifier"]))


def _normalize_state_encounter_cards(state: Dict[str, Any]) -> None:
    for dk_name in ("patricii", "legiones", "nefarii"):
        for c in state.get("decks", {}).get(dk_name, []):
            _normalize_encounter_card_data(c)
    pend = state.get("pendingEncounter")
    if isinstance(pend, dict) and isinstance(pend.get("card"), dict):
        _normalize_encounter_card_data(pend["card"])
    for p in state.get("players", []):
        for m_obj in p.get("missions", []):
            _backfill_encounter_mission_metadata(m_obj)
        for si in p.get("scoutedInfo", []):
            if isinstance(si, dict) and si.get("targetType") == "deck":
                _normalize_encounter_card_data(si.get("revealedData"))


def resolve_table_encounter(
    state: Dict[str, Any],
    player: Dict[str, Any],
    enc_type: str,
    roll_override: Optional[int] = None,
    source_label: Optional[str] = None,
    from_pre_roll: bool = False,
    pre_drawn_sooth_goal: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    card_nm_map = {
        "mob": "Angry Mob",
        "theater": "Theater Troupe",
        "soothsayer": "Soothsayer",
    }
    if not from_pre_roll and roll_override is None and enc_type in ("mob", "theater", "soothsayer"):
        _inc_encounter_stat(player, enc_type, 1)
    if (
        not player.get("isBot")
        and roll_override is None
        and not from_pre_roll
        and not state.get("pendingEncounter")
        and enc_type in ("mob", "theater", "soothsayer")
    ):
        sooth_goal_pre = None
        if enc_type == "soothsayer":
            if not state["decks"]["missiones"]:
                add_log(state, f"{player['name']} encountered the Soothsayer, but the Missiones deck is empty.", "encounter")
                return {"type": "soothsayer", "roll": 0}
            sooth_goal_pre = state["decks"]["missiones"].pop(0)
        src_note = f" [{source_label}]" if source_label else ""
        c_nm = card_nm_map.get(enc_type, enc_type.capitalize())
        add_log(state, f"{player['name']} encountered {c_nm}{src_note}!", "encounter")
        state["pendingEncounter"] = {
            "stage": "chart_pre_roll",
            "playerIndex": player["index"],
            "chartType": enc_type,
            "soothsayerMission": sooth_goal_pre,
            "encounterSource": source_label,
            "ignoreMobActive": bool(player.get("turnEffects", {}).get("ignoreMob")),
            "ignoreTheaterActive": bool(player.get("turnEffects", {}).get("ignoreTheater")),
            "card": {
                "name": c_nm,
                "type": "table_encounter",
                "deck": enc_type,
            },
        }
        return {"type": enc_type, "pending": True}

    # Check if player has Man Of The People or Dramaturge active
    if enc_type == "mob" and player.get("turnEffects", {}).get("ignoreMob"):
        player["turnEffects"]["ignoreMob"] = False
        player["cash"] += 4
        add_log(state, f"{player['name']} used 'Man Of The People' to ignore the Angry Mob and collected +4(d) from the crowd!", "encounter")
        return {"type": "mob", "ignored": True}

    if enc_type == "theater" and player.get("turnEffects", {}).get("ignoreTheater"):
        player["turnEffects"]["ignoreTheater"] = False
        add_log(state, f"{player['name']} used 'Dramaturge' to turn the Theater Troupe into an automatic III result!", "encounter")
        return _apply_table_encounter_outcome(state, player, "theater", 3, emit_dice_event=True)

    sooth_goal = pre_drawn_sooth_goal
    if enc_type == "soothsayer" and sooth_goal is None:
        if not state["decks"]["missiones"]:
            return {"type": "soothsayer", "roll": 0}
        sooth_goal = state["decks"]["missiones"].pop(0)

    r = roll_rome_die() if roll_override is None else roll_override
    r_rom = roman_die_str(r)

    if roll_override is None and enc_type in ("mob", "theater", "soothsayer"):
        bot_wants = _does_bot_want_post_chart_intervention(state, player, enc_type, r)
        intervenor = _find_human_intervenor_for_post_chart(state, player, enc_type)
        if bot_wants or intervenor is not None:
            preview_txt = _get_chart_roll_preview(player, enc_type, r, sooth_goal)
            if enc_type == "mob":
                title_str = f"🔥 ANGRY MOB ENCOUNTER — {player['name']}"
                sub_str = "0: Lose Wine • I: Lose Grain • II: Lose Best Good • III: Clamors Noisily"
                die_lbl = "Angry Mob ®"
                card_nm = "Angry Mob"
            elif enc_type == "theater":
                title_str = f"🎭 THEATER TROUPE ENCOUNTER — {player['name']}"
                sub_str = "0: Lose Friendly Favor • I: Lose Hostile Favor • II: Lose Turn • III: Draw ® Influence"
                die_lbl = "Troupe ®"
                card_nm = "Theater Troupe"
            else:
                title_str = f"🔮 SOOTHSAYER PROPHECY — {player['name']}"
                sub_str = "Roll ® Influence Cards Sealed Under Mandatory Mission"
                die_lbl = "Soothsayer ®"
                card_nm = "Soothsayer"

            chart_state: Dict[str, Any] = {
                "stage": "chart_post_roll",
                "playerIndex": player["index"],
                "chartType": enc_type,
                "chartRoll": r,
                "soothsayerMission": sooth_goal,
                "previewText": preview_txt,
                "passedIntervenors": [],
                "botInterventions": 0,
                "card": {
                    "name": card_nm,
                    "deck": enc_type,
                },
            }
            add_dice_event(
                state,
                kind="table_encounter",
                title=title_str,
                subtitle=sub_str,
                groups=[{
                    "rollerName": player["name"],
                    "rollerType": "player",
                    "colorName": player["color"],
                    "flatBonus": 0,
                    "totalLabel": f"Rolled {r_rom}",
                    "dice": [{"value": r, "roman": r_rom, "sign": 1, "label": die_lbl, "color": player["color"]}],
                }],
                outcome_title=f"ROLLED {r_rom}",
                outcome_message=preview_txt,
            )
            _run_bot_post_chart_interventions(state, player, chart_state)
            if chart_state.get("ignoredBySelfCard") == "mob":
                return {"type": "mob", "ignored": True}
            if chart_state.get("ignoredBySelfCard") == "theater":
                return _apply_table_encounter_outcome(state, player, "theater", 3, emit_dice_event=True)

            intervenor = _find_human_intervenor_for_post_chart(state, player, enc_type, chart_state["passedIntervenors"])
            if intervenor is not None:
                avail_cards = _get_player_post_chart_influence(intervenor, enc_type, is_self=(intervenor["index"] == player["index"]))
                c_names = ", ".join(c["name"] for c in avail_cards)
                chart_state["interveningPlayerIndex"] = intervenor["index"]
                if state.get("diceEvents"):
                    last_ev = state["diceEvents"][-1]
                    cur_rom = roman_die_str(int(chart_state["chartRoll"]))
                    last_ev["outcomeTitle"] = f"ROLLED {cur_rom} (INFLUENCE AVAILABLE)"
                    last_ev["outcomeMessage"] = chart_state["previewText"]
                    last_ev["outcomeDetail"] = chart_state["previewText"]
                    last_ev["secretIntervenorIndex"] = intervenor["index"]
                    last_ev["secretCardNames"] = c_names
                    last_ev["secretIntervenorName"] = intervenor["name"]
                state["pendingEncounter"] = chart_state
                return {"type": enc_type, "roll": int(chart_state["chartRoll"]), "pending": True}

            return _apply_table_encounter_outcome(
                state,
                player,
                enc_type,
                int(chart_state["chartRoll"]),
                emit_dice_event=False,
                soothsayer_mission=sooth_goal,
            )

    return _apply_table_encounter_outcome(state, player, enc_type, r, emit_dice_event=True, soothsayer_mission=sooth_goal)


def evaluate_reaction_condition(favor_val: int, cond: str) -> bool:
    c = cond.strip().replace(" ", "")
    if ".." in c:
        parts = c.split("..")
        try:
            return int(parts[0]) <= favor_val <= int(parts[1])
        except ValueError:
            return False
    if c.startswith("<="):
        return favor_val <= int(c[2:])
    if c.startswith("≤"):
        return favor_val <= int(c[1:])
    if c.startswith(">="):
        return favor_val >= int(c[2:])
    if c.startswith("≥"):
        return favor_val >= int(c[1:])
    if c.startswith("<"):
        return favor_val < int(c[1:])
    if c.startswith(">"):
        return favor_val > int(c[1:])
    if c.startswith("="):
        return favor_val == int(c[1:])
    try:
        return favor_val == int(c)
    except ValueError:
        return False


def parse_opponent_combat(formula: str, x_count: int, extra_dice_mod: int = 0) -> Tuple[int, List[int], int]:
    """
    Evaluates opponent combat formula such as 'X(R)', 'X(R)+1', 'X(R)+2', 'X(R)-1',
    'X(R)+X', '2X(R)', '1(R)+2', '2(R)-1', '4(R)', 'X+1', 'X-1', or 'X'.
    Returns (total_cp, dice_rolled, flat_bonus).
    """
    f = (formula or "X(R)").upper().replace(" ", "").replace("®", "(R)").replace("*", "")
    if f.endswith("CP"):
        f = f[:-2]
    if not f:
        f = "X(R)"

    dice_count = 0
    flat_bonus = 0

    terms = re.findall(r"[+-]?[^+-]+", f)
    for term in terms:
        sign = -1 if term.startswith("-") else 1
        body = term.lstrip("+-")
        if not body:
            continue
        if "(R)" in body:
            prefix = body.replace("(R)", "")
            r_occurrences = body.count("(R)")
            if prefix == "":
                d_val = r_occurrences
            elif prefix == "X":
                d_val = x_count * max(1, r_occurrences)
            elif prefix.endswith("X") and prefix[:-1].isdigit():
                d_val = int(prefix[:-1]) * x_count * max(1, r_occurrences)
            elif prefix.isdigit():
                d_val = int(prefix) * max(1, r_occurrences)
            else:
                d_val = x_count
            dice_count += sign * d_val
        else:
            if body == "X":
                flat_bonus += sign * x_count
            elif body.endswith("X") and body[:-1].isdigit():
                flat_bonus += sign * int(body[:-1]) * x_count
            elif body.isdigit():
                flat_bonus += sign * int(body)

    dice_count = max(0, dice_count + extra_dice_mod)
    rolls = [roll_rome_die() for _ in range(dice_count)]
    total = max(0, sum(rolls) + flat_bonus)
    return total, rolls, flat_bonus


def _get_player_post_combat_influence(player: Dict[str, Any]) -> List[Dict[str, Any]]:
    cards = []
    for c in player.get("influence", []):
        nm = str(c.get("name", ""))
        if any(k in nm for k in ("Gladiator", "Flying Chamber Pot", "Twist Of Fate")):
            cards.append(c)
    return cards


def _find_human_intervenor_for_post_combat(
    state: Dict[str, Any],
    enc_player: Dict[str, Any],
    passed_indices: Optional[List[int]] = None,
) -> Optional[Dict[str, Any]]:
    passed = set(passed_indices or [])
    if not enc_player.get("isBot") and enc_player["index"] not in passed and _get_player_post_combat_influence(enc_player):
        return enc_player
    players = state.get("players", [])
    n = len(players)
    for offset in range(1, n):
        p = players[(enc_player["index"] + offset) % n]
        if not p.get("isBot") and p["index"] not in passed and _get_player_post_combat_influence(p):
            return p
    return None


def _format_combat_total_label(cp: int, dice_objs: List[Dict[str, Any]], flat_val: int) -> str:
    dice_sum = sum(int(d["value"]) * int(d.get("sign", 1)) for d in (dice_objs or []) if int(d.get("sign", 1)) != 0)
    if flat_val > 0:
        return f"{cp} CP (Dice {dice_sum} + {flat_val} Flat)"
    if flat_val < 0:
        return f"{cp} CP (Dice {dice_sum} − {abs(flat_val)} Flat)"
    return f"{cp} CP"


def _recompute_combat_totals(c_state: Dict[str, Any]) -> None:
    p_dice_sum = sum(int(d["value"]) * int(d.get("sign", 1)) for d in c_state.get("playerDiceObjs", []) if int(d.get("sign", 1)) != 0)
    o_dice_sum = sum(int(d["value"]) * int(d.get("sign", 1)) for d in c_state.get("oppDiceObjs", []) if int(d.get("sign", 1)) != 0)
    p_cp = max(0, p_dice_sum + int(c_state.get("playerFlat", 0)))
    o_cp = max(0, o_dice_sum + int(c_state.get("oppFlat", 0)))
    c_state["playerCP"] = p_cp
    c_state["oppCP"] = o_cp
    if "ignoreWoundsFlat" in c_state:
        armor_dice_sum = sum(int(d["value"]) for d in c_state.get("playerDiceObjs", []) if int(d.get("sign", 1)) == 0)
        ign_w = int(c_state.get("ignoreWoundsFlat", 0)) + armor_dice_sum
        c_state["ignoreWounds"] = ign_w
        dyn_sources = list(c_state.get("flatArmorSources", []))
        for d in c_state.get("playerDiceObjs", []):
            if int(d.get("sign", 1)) == 0:
                base_lbl = d.get("itemName") or str(d.get("label", "Armor")).replace(" (Block ®)", "").replace(" (Re-rolled)", "")
                val_d = int(d.get("value", 0))
                dyn_sources.append(f"{base_lbl} (Ignore {val_d} Wound{'s' if val_d != 1 else ''}, rolled {d.get('roman', '0')})")
        c_state["armorSources"] = dyn_sources
    else:
        ign_w = int(c_state.get("ignoreWounds", 0))
    raw_w = max(0, o_cp - p_cp)
    c_state["rawWounds"] = raw_w
    c_state["netWoundsAfterArmor"] = max(0, raw_w - ign_w)


def _describe_combat_outcome(player: Dict[str, Any], card: Dict[str, Any], c_state: Dict[str, Any]) -> Tuple[str, str]:
    p_cp = int(c_state.get("playerCP", 0))
    o_cp = int(c_state.get("oppCP", 0))
    raw_w = max(0, o_cp - p_cp)
    ign_w = int(c_state.get("ignoreWounds", 0))
    net_w = max(0, raw_w - ign_w)
    armor_sources = c_state.get("armorSources") or []
    armor_summary = ", ".join(armor_sources) if armor_sources else (f"Armor (Ignore {ign_w} Wound{'s' if ign_w != 1 else ''})" if ign_w > 0 else "")
    equip_notes = c_state.get("equipmentNotes") or []
    equip_suffix = f" [Active Gear & Guards: {' • '.join(equip_notes)}]" if equip_notes else ""

    if p_cp > o_cp:
        return (
            f"VICTORY! {p_cp} CP vs. {o_cp} CP",
            f"COMBAT VICTORY! {player['name']} ({p_cp} CP) defeated {card['name']} ({o_cp} CP)!{equip_suffix}",
        )
    if p_cp == o_cp:
        return (
            f"TIE! {p_cp} CP vs. {o_cp} CP — SURVIVED (NO BONUS)",
            f"COMBAT TIE! {player['name']} ({p_cp} CP) tied with {card['name']} ({o_cp} CP) — {player['name']} survives combat unharmed (no roll on the Defeat Chart), but does not receive the bonus for winning combat.{equip_suffix}",
        )
    if net_w <= 0:
        blocker_names = ", ".join(s.split(" (")[0] for s in armor_sources) if armor_sources else "Armor"
        return (
            f"SURVIVED ({blocker_names.upper()} BLOCKED {raw_w} WOUND{'S' if raw_w != 1 else ''})! {p_cp} CP vs. {o_cp} CP",
            f"{player['name']} ({p_cp} CP) lost by {raw_w} point{'s' if raw_w != 1 else ''} to {card['name']} ({o_cp} CP), but {armor_summary} blocked all {raw_w} Wound{'s' if raw_w != 1 else ''}! You survive combat and will NOT proceed to a roll on the Defeat Chart.{equip_suffix}",
        )
    guards_list = player.get("guards", [])
    if net_w <= len(guards_list):
        casualty_names = ", ".join(g.get("name", "Guard") for g in guards_list[:net_w])
        blocked_part = f" ({ign_w} blocked by {armor_summary}; {net_w} absorbed by Guard: {casualty_names})" if ign_w > 0 else f" ({net_w} absorbed by Guard: {casualty_names})"
        return (
            f"DEFEAT — SURVIVED (GUARD ABSORBED WOUND)! {p_cp} CP vs. {o_cp} CP",
            f"COMBAT DEFEAT: {player['name']} ({p_cp} CP) lost to {card['name']} ({o_cp} CP), suffering {raw_w} Wound{'s' if raw_w != 1 else ''}{blocked_part}. Your Driver survives and will NOT proceed to a roll on the Defeat Chart!{equip_suffix}",
        )
    blocked_part = f" ({ign_w} blocked by {armor_summary})" if ign_w > 0 else ""
    guard_part = f", {len(guards_list)} Guard(s) fell" if guards_list else ""
    return (
        f"DEFEAT! {p_cp} CP vs. {o_cp} CP — ROLL ON DEFEAT CHART",
        f"COMBAT DEFEAT! {player['name']} ({p_cp} CP) lost to {card['name']} ({o_cp} CP), suffering {raw_w} Wound{'s' if raw_w != 1 else ''}{blocked_part}{guard_part}. Your Driver suffered an unblocked wound — roll on the Driver Fate (Defeat) Chart!{equip_suffix}",
    )


def _enforce_refused_demand_after_defeat(state: Dict[str, Any], player: Dict[str, Any], card: Dict[str, Any]) -> List[str]:
    """
    Rulebook Combat Defeat on Refused (!!) Demand:
    When a merchant refuses a strict (!!) Demand and loses the resulting combat,
    in addition to losing their turn and resolving any Wounds/Death Chart roll,
    they must still fulfill the refused Demand to the greatest extent possible from
    whatever resources remain (without receiving Friendly Favor; Hostile Favor was already applied).
    """
    notes: List[str] = []
    if not isinstance(card, dict):
        return notes
    action_text = (card.get("actionText") or "").strip()
    m_raw = card.get("mission") or {}
    hostile_favor_list = card.get("hostileFavor") or ([f"-{card['faction']}"] if card.get("faction") else [])

    # 1. Immediate NPC Purchase/Sale Demand ("!!: Will Sell..." or "!!: Will Buy...")
    is_npc_buy_offer = (m_raw.get("kind") == "buy_from_npc") or ("will sell" in action_text.lower())
    is_npc_sell_offer = (
        m_raw.get("kind") == "sell"
        and not m_raw.get("deliverCell")
        and not m_raw.get("cell")
        and "will buy" in action_text.lower()
    )
    if is_npc_buy_offer:
        req_cat = m_raw.get("category") or "Any"
        raw_mod_str = str(m_raw.get("modifier", "=")).strip()
        fixed_price = m_raw.get("fixedPrice")
        if fixed_price is None:
            m_fp = re.search(r"(\d+)\s*\(d\)", raw_mod_str) or re.search(r"for\s+(\d+)\s*\(d\)", action_text, re.IGNORECASE)
            if m_fp:
                fixed_price = int(m_fp.group(1))
        mod = normalize_scarcity_modifier(raw_mod_str)
        max_b, _ = get_player_cart_limits(player)
        used_b, _ = get_player_cart_usage(player)
        for t_name in ("Weapons", "Grain", "Wine", "Marble", "Animals"):
            tr = state["marketBoard"].get(t_name, [])
            for col_idx, c in enumerate(list(tr)):
                if req_cat == "Any" or matches_category(c, req_cat):
                    pr, _ = _compute_npc_offer_buy_price(state, c, "market", col_idx, mod, fixed_price, action_text)
                    if player["cash"] >= pr and used_b + int(c.get("blocks", 1)) <= max_b:
                        tr.remove(c)
                        player["cash"] -= pr
                        c["purchasePrice"] = pr
                        player["cart"].append(c)
                        _inc_player_stat(player, "itemsPurchased", 1)
                        msg = f"Defeated after refusing demand: {card['name']} forced {player['name']} to buy {c['name']} for {pr}(d)!"
                        add_log(state, msg, "encounter")
                        notes.append(msg)
                        return notes
        return notes

    if is_npc_sell_offer:
        req_cat = m_raw.get("category") or "Any"
        mod = normalize_scarcity_modifier(str(m_raw.get("modifier", "=")).strip())
        for c in list(player.get("cart", [])):
            if c.get("isMissionCargo") and (not c.get("sell") or c.get("missionSource") != "encounter"):
                continue
            if req_cat == "Any" or matches_category(c, req_cat):
                pr, _ = compute_sell_price(state, player, c, mod)
                _remove_cart_item(state, player, c, reason=f"forced sale to {card['name']} after losing combat")
                player["cash"] += pr
                _inc_player_stat(player, "itemsSold", 1)
                msg = f"Defeated after refusing demand: {card['name']} forced {player['name']} to sell {c['name']} for {pr}(d)!"
                add_log(state, msg, "encounter")
                notes.append(msg)
                return notes
        return notes

    # 2. Deck Quest or Embedded Mission Strict Demand
    sooth_cnt = sum(1 for m in player["missions"] if m.get("source") == "soothsayer")
    non_sooth_cnt = len(player["missions"]) - sooth_cnt
    reactions = card.get("reactions") or []
    is_deck_quest = any(r.get("type") == "deck_quest_demand" for r in reactions) or (not card.get("mission") and not action_text)
    if is_deck_quest:
        if state["decks"]["missiones"] and non_sooth_cnt < 5:
            drawn_m = copy.deepcopy(state["decks"]["missiones"].pop(0))
            drawn_m["source"] = "encounter"
            drawn_m["hasDrawnMissionCard"] = True
            drawn_m["encounterCard"] = _prepare_attached_encounter_card(state, card)
            drawn_m["patronName"] = card["name"]
            drawn_m["patronFaction"] = card.get("faction")
            drawn_m["patronRewardText"] = card.get("friendlyReward") or ""
            drawn_m["favor"] = list((drawn_m.get("favor") or []) + (card.get("friendlyFavor") or []))
            drawn_m["hostileFavor"] = copy.deepcopy(hostile_favor_list)
            player["missions"].append(drawn_m)
            msg = f"Defeated after refusing demand: {card['name']} forced {player['name']} to take Deck Quest '{drawn_m['name']}'!"
            add_log(state, msg, "mission")
            notes.append(msg)
            check_passive_missions(state, player)
        return notes

    if card.get("mission"):
        if non_sooth_cnt < 5:
            m_data = copy.deepcopy(card["mission"])
            raw_kind = m_data.get("kind", "sell")
            if raw_kind == "kill" and (m_data.get("target") or "").lower() == "the emperor" or "kill the emperor" in action_text.lower():
                raw_kind = "kill_emperor"
            norm_m_cell = normalize_cell_id(m_data.get("cell") or m_data.get("deliverCell")) or "C3"
            norm_p_cell = normalize_cell_id(m_data.get("pickupCell")) if m_data.get("pickupCell") else None
            norm_d_cell = normalize_cell_id(m_data.get("deliverCell")) if m_data.get("deliverCell") else None
            norm_act_txt = _normalize_relative_scarcity_text(action_text)
            m_obj = {
                "id": f"enc_{card['id']}_{secrets.token_hex(2)}",
                "name": m_data.get("name") or f"{card['name']}'s Task",
                "source": "encounter",
                "hasDrawnMissionCard": False,
                "encounterCard": _prepare_attached_encounter_card(state, card),
                "patronName": card["name"],
                "patronFaction": card.get("faction"),
                "kind": raw_kind,
                "item": m_data.get("item", "Cargo"),
                "category": m_data.get("category", "Wine"),
                "modifier": normalize_scarcity_modifier(m_data.get("modifier") or "+"),
                "target": m_data.get("target"),
                "targetDeck": m_data.get("targetDeck"),
                "cell": norm_m_cell,
                "pickupCell": norm_p_cell,
                "deliverCell": norm_d_cell,
                "blocks": m_data.get("cargoSize") or m_data.get("blocks", 1),
                "fencedSell": m_data.get("payoutTable") or m_data.get("fencedSell"),
                "pickedUp": False,
                "completed": False,
                "description": norm_act_txt,
                "text": norm_act_txt,
                "rewardText": card.get("friendlyReward", "6(d)"),
                "reward": None,
                "favor": card.get("friendlyFavor", []),
                "hostileFavor": copy.deepcopy(hostile_favor_list),
            }
            player["missions"].append(m_obj)
            msg = f"Defeated after refusing demand: {card['name']} forced {player['name']} to accept Mission '{m_obj['name']}'!"
            add_log(state, msg, "mission")
            notes.append(msg)
            check_passive_missions(state, player)
        return notes

    # 3. Influence, Cash, or Goods Strict Demand
    clause_match = re.search(r"\((?![dDrR]\))", action_text)
    primary_text = action_text[:clause_match.start()].strip() if clause_match else action_text.strip()
    primary_low = primary_text.lower()

    if "influence" in primary_low:
        if "®" in primary_text or "(r)" in primary_low:
            cnt = roll_rome_die()
        elif "all" in primary_low:
            cnt = len(player["influence"])
        elif "two" in primary_low:
            cnt = 2
        else:
            cnt = 1
        given = 0
        while given < cnt and player["influence"]:
            c_inf = player["influence"].pop(0)
            state["decks"]["influence"].append(c_inf)
            given += 1
        if given > 0:
            msg = f"Defeated after refusing demand: {card['name']} seized {given} Influence card(s) from {player['name']}!"
            add_log(state, msg, "encounter")
            notes.append(msg)
        return notes

    if "(d)" in primary_text or "cash" in primary_low:
        if "®" in primary_text or "(r)" in primary_low:
            m_mult = re.search(r"(\d+)\s*\(d\)", primary_text)
            mult = int(m_mult.group(1)) if m_mult else 4
            amt = roll_rome_die() * mult
        elif "half" in primary_low:
            amt = (player["cash"] + 1) // 2
        elif "all" in primary_low:
            amt = player["cash"]
        else:
            m_amt = re.search(r"(\d+)\s*\(d\)", primary_text)
            amt = int(m_amt.group(1)) if m_amt else 4
        paid = min(int(player["cash"]), max(0, amt))
        if paid > 0:
            player["cash"] -= paid
            state["lastStolenCash"] = paid
            msg = f"Defeated after refusing demand: {card['name']} extorted {paid}(d) from {player['name']}!"
            add_log(state, msg, "encounter")
            notes.append(msg)
        return notes

    if player["cart"]:
        taken_items = []
        for cat in ("Fine Wine", "Cheap Wine", "Wine", "Grain", "Exotic Animals", "Meat Animals", "Animals", "Weapons", "Marble"):
            if cat.lower() in primary_low or cat.replace("Animals", "A").lower() in primary_low:
                matching = [c for c in player["cart"] if matches_category(c, cat)]
                if matching:
                    taken_items = matching if "all" in primary_low else [matching[0]]
                break
        else:
            if "cheapest" in primary_low:
                player["cart"].sort(key=_item_base_value)
            else:
                player["cart"].sort(key=_item_base_value, reverse=True)
            taken_items = [player["cart"][0]]

        seized_names = []
        for t in taken_items:
            if t in player["cart"]:
                _remove_cart_item(state, player, t, reason=f"seized by {card['name']} after losing combat")
                state["lastStolenGood"] = t
                seized_names.append(t["name"])
        if seized_names:
            msg = f"Defeated after refusing demand: {card['name']} seized {', '.join(seized_names)} from {player['name']}'s Cart!"
            add_log(state, msg, "encounter")
            notes.append(msg)
    return notes


def _apply_driver_fate_outcome(state: Dict[str, Any], player: Dict[str, Any], d_roll: int, pend: Optional[Dict[str, Any]] = None) -> Tuple[str, str]:
    d_roll = max(0, min(3, int(d_roll)))
    d_rom = roman_die_str(d_roll)
    if d_roll == 0:
        driver_outcome = "0: Yep, dead! Lost all Goods and Night is over!"
        for c in list(player["cart"]):
            _remove_cart_item(state, player, c, reason="lost when Driver was killed")
        player["cart"] = []
        player["nightEnded"] = True
    elif d_roll == 1:
        driver_outcome = "I: Left for dead! Lost all Goods, night continues."
        for c in list(player["cart"]):
            _remove_cart_item(state, player, c, reason="lost when Driver was left for dead")
        player["cart"] = []
    elif d_roll == 2:
        driver_outcome = f"II: Beaten and mugged! Lost all {player['cash']}(d), night continues."
        state["lastStolenCash"] = player["cash"]
        player["cash"] = 0
    else:
        driver_outcome = f"III: Begged for mercy! Lost all {len(player['influence'])} Influence cards."
        state["decks"]["influence"].extend(player["influence"])
        player["influence"] = []

    player["movesRemaining"] = 0
    player["turnStep"] = "done"
    state["pendingPostEncounterMove"] = None
    state["pendingPostEncounterRefresh"] = None
    msg = f"Driver wounded (rolled ®={d_rom} -> {driver_outcome})"
    add_log(state, msg, "combat")
    if pend and pend.get("wasRefusedDemand") and pend.get("card"):
        ref_notes = _enforce_refused_demand_after_defeat(state, player, pend["card"])
        if ref_notes:
            driver_outcome = f"{driver_outcome} ({' '.join(ref_notes)})"
    state["pendingEncounter"] = None
    return d_rom, driver_outcome


def _finalize_combat_after_post_roll(state: Dict[str, Any], player: Dict[str, Any], c_state: Dict[str, Any]) -> Dict[str, Any]:
    _recompute_combat_totals(c_state)
    card = c_state["card"]
    x_count = c_state["xCount"]
    player_cp = c_state["playerCP"]
    opp_cp = c_state["oppCP"]
    h_notes = c_state.get("hostileNotes", [])
    ignore_wounds = c_state.get("ignoreWounds", 0)
    armor_sources = c_state.get("armorSources") or []
    armor_summary = ", ".join(armor_sources) if armor_sources else f"{ignore_wounds} blocked"
    was_refused_demand = bool(c_state.get("wasRefusedDemand"))

    if player_cp > opp_cp:
        # Player wins!
        r_notes = grant_reward(state, player, card.get("combatRewardObj"), card.get("combatReward", ""))
        cid_str = str(card.get("id") or "")
        inferred_deck = "patricii" if cid_str.startswith("pat_") else "legiones" if cid_str.startswith("leg_") else "nefarii" if cid_str.startswith("nef_") else ""
        deck_name = card.get("deck") or c_state.get("deck") or inferred_deck
        cname = card.get("name", "")
        is_emperor = any(emp in cname for emp in ("Bassianus", "Caracalla", "Geta"))
        for m in list(player["missions"]):
            if m.get("completed"):
                continue
            if m.get("kind") == "kill" and m.get("targetDeck", "").lower() == deck_name.lower():
                m["completed"] = True
                player["missions"].remove(m)
                mr = grant_reward(state, player, m.get("reward"), m.get("rewardText", ""), is_mission_reward=True)
                if m.get("patronRewardText"):
                    mr.extend(grant_reward(state, player, None, m.get("patronRewardText", ""), is_mission_reward=True))
                if m.get("source") == "soothsayer" and m.get("underInfluence"):
                    under = m.pop("underInfluence", [])
                    player["influence"].extend(under)
                    mr.append(f"+{len(under)} Soothsayer Influence Card(s)")
                patron_lbl = f" for {m['patronName']}" if m.get("patronName") else ""
                mf = apply_favor_list(
                    player,
                    m.get("favor", []),
                    reason=f"completing mission '{m['name']}'{patron_lbl} (defeated {card['name']})",
                )
                _record_mission_completion_event(
                    state,
                    player,
                    m,
                    mr,
                    mf,
                    context_detail=f"Defeated {card['name']} ({deck_name.capitalize()}) in Combat ({player_cp} CP vs. {opp_cp} CP)",
                )
                _recycle_mission_cards(state, m)
                r_notes.extend([f"Completed '{m['name']}'!"] + mr + mf)
        if is_emperor:
            # Step A: Check ALL players for 'Regime Change' ('kill_emperor_cancel') FIRST so it cancels 'Regicide' regardless of seat order!
            regime_change_holders: List[Tuple[Dict[str, Any], Dict[str, Any]]] = []
            for p_chk in state["players"]:
                for m_chk in list(p_chk["missions"]):
                    if not m_chk.get("completed") and m_chk.get("kind") == "kill_emperor_cancel":
                        regime_change_holders.append((p_chk, m_chk))

            if regime_change_holders:
                for p_rc, m_rc in regime_change_holders:
                    m_rc["completed"] = True
                    if m_rc in p_rc["missions"]:
                        p_rc["missions"].remove(m_rc)
                    mr = grant_reward(state, p_rc, m_rc.get("reward"), m_rc.get("rewardText", ""), is_mission_reward=True)
                    if m_rc.get("patronRewardText"):
                        mr.extend(grant_reward(state, p_rc, None, m_rc.get("patronRewardText", ""), is_mission_reward=True))
                    if m_rc.get("source") == "soothsayer" and m_rc.get("underInfluence"):
                        under = m_rc.pop("underInfluence", [])
                        p_rc["influence"].extend(under)
                        mr.append(f"+{len(under)} Soothsayer Influence Card(s)")
                    patron_lbl = f" for {m_rc['patronName']}" if m_rc.get("patronName") else ""
                    mf = apply_favor_list(
                        p_rc,
                        m_rc.get("favor", []),
                        reason=f"completing mission '{m_rc['name']}'{patron_lbl} (defeated {card['name']})",
                    )
                    _record_mission_completion_event(
                        state,
                        p_rc,
                        m_rc,
                        mr,
                        mf,
                        context_detail=f"Defeated {card['name']} in Combat ({player_cp} CP vs. {opp_cp} CP) — cancelled Regicide!",
                    )
                    _recycle_mission_cards(state, m_rc)
                    r_notes.extend([f"{p_rc['name']} triggered '{m_rc['name']}'!"] + mr + mf)

                # Cancel all active 'Regicide' ('kill_emperor') missions across all players without granting win_game
                for p_reg in state["players"]:
                    for m_reg in list(p_reg["missions"]):
                        if m_reg.get("completed"):
                            continue
                        if m_reg.get("kind") == "kill_emperor" or (
                            m_reg.get("kind") != "kill_emperor_cancel" and (m_reg.get("target") or "").lower() == "the emperor"
                        ):
                            p_reg["missions"].remove(m_reg)
                            if m_reg.get("underInfluence"):
                                under_reg = m_reg.pop("underInfluence", [])
                                p_reg["influence"].extend(under_reg)
                            _recycle_mission_cards(state, m_reg)
                            cancel_note = f"{p_reg['name']}'s '{m_reg['name']}' reward was cancelled by 'Regime Change'!"
                            add_log(state, cancel_note, "mission")
                            r_notes.append(cancel_note)
            else:
                for p in state["players"]:
                    for m in list(p["missions"]):
                        if m.get("completed"):
                            continue
                        if m.get("kind") == "kill_emperor" or (m.get("target") or "").lower() == "the emperor":
                            m["completed"] = True
                            p["missions"].remove(m)
                            mr = grant_reward(state, p, m.get("reward"), m.get("rewardText", ""), is_mission_reward=True)
                            if m.get("patronRewardText"):
                                mr.extend(grant_reward(state, p, None, m.get("patronRewardText", ""), is_mission_reward=True))
                            if m.get("source") == "soothsayer" and m.get("underInfluence"):
                                under = m.pop("underInfluence", [])
                                p["influence"].extend(under)
                                mr.append(f"+{len(under)} Soothsayer Influence Card(s)")
                            patron_lbl = f" for {m['patronName']}" if m.get("patronName") else ""
                            mf = apply_favor_list(
                                p,
                                m.get("favor", []),
                                reason=f"completing mission '{m['name']}'{patron_lbl} (defeated {card['name']})",
                            )
                            _record_mission_completion_event(
                                state,
                                p,
                                m,
                                mr,
                                mf,
                                context_detail=f"Defeated {card['name']} in Combat ({player_cp} CP vs. {opp_cp} CP)",
                            )
                            r_notes.extend([f"{p['name']} triggered '{m['name']}'!"] + mr + mf)

        victory_msg = f"COMBAT VICTORY! {player['name']} ({player_cp} CP) defeated {card['name']} ({opp_cp} CP)! {' '.join(h_notes + r_notes)}"
        add_log(state, victory_msg, "combat")
        _update_or_add_bot_encounter_outcome(
            state,
            player,
            card,
            deck_name,
            "victory",
            f"⚔️ Victory! ({player_cp} vs {opp_cp} CP)",
            f"Defeated {card['name']} ({player_cp} vs {opp_cp} CP)",
        )
        state["pendingEncounter"] = None
        return {"winner": "player", "playerCP": player_cp, "oppCP": opp_cp}

    if player_cp == opp_cp:
        # Combat Tie! Player survives unharmed (no roll on Defeat Chart), but receives no victory bonus.
        tie_msg = f"COMBAT TIE! {player['name']} ({player_cp} CP) tied with {card['name']} ({opp_cp} CP) — {player['name']} survives combat (no victory bonus). {' '.join(h_notes)}".strip()
        add_log(state, tie_msg, "combat")
        _update_or_add_bot_encounter_outcome(
            state,
            player,
            card,
            str(card.get("deck") or c_state.get("deck") or "patricii"),
            "tie",
            f"⚖️ Stalemate ({player_cp} vs {opp_cp} CP)",
            f"Tied {card['name']} ({player_cp} vs {opp_cp} CP)",
        )
        state["pendingEncounter"] = None
        return {
            "winner": "tie",
            "playerCP": player_cp,
            "oppCP": opp_cp,
            "wounds": 0,
            "casualties": [],
            "driverOutcome": None,
        }

    # Opponent wins! Losing combat ALWAYS ends the player's turn (and cancels any deferred edge move / refresh).
    player["movesRemaining"] = 0
    player["turnStep"] = "done"
    state["pendingPostEncounterMove"] = None
    state["pendingPostEncounterRefresh"] = None

    raw_wounds = opp_cp - player_cp
    net_wounds = max(0, raw_wounds - ignore_wounds)
    casualties = []
    while net_wounds > 0 and player["guards"]:
        dead_guard = player["guards"].pop(0)
        if not str(dead_guard.get("id", "")).startswith("thug_"):
            state["decks"]["market"].append(dead_guard)
        casualties.append(f"Guard {dead_guard['name']} fell")
        net_wounds -= 1

    _update_or_add_bot_encounter_outcome(
        state,
        player,
        card,
        str(card.get("deck") or c_state.get("deck") or "patricii"),
        "defeat",
        f"💀 Defeated ({player_cp} vs {opp_cp} CP)",
        f"Lost combat to {card['name']} ({player_cp} vs {opp_cp} CP)",
    )

    if net_wounds <= 0:
        survive_reason = " | ".join(casualties) if casualties else f"All {raw_wounds} Wound(s) blocked by {armor_summary} — no roll on Defeat Chart!"
        defeat_msg = f"COMBAT DEFEAT (DRIVER SURVIVED)! {player['name']} ({player_cp} CP) lost to {card['name']} ({opp_cp} CP) by {raw_wounds} Wound(s) ({ignore_wounds} blocked: {armor_summary}). {survive_reason} Turn ends."
        add_log(state, defeat_msg, "combat")
        if was_refused_demand:
            _enforce_refused_demand_after_defeat(state, player, card)
        state["pendingEncounter"] = None
        return {
            "winner": "opponent",
            "playerCP": player_cp,
            "oppCP": opp_cp,
            "wounds": 0,
            "casualties": casualties,
            "driverOutcome": None,
        }

    # Driver suffered an unblocked wound!
    df_context = {"wasRefusedDemand": was_refused_demand, "card": card}
    if player.get("isBot"):
        d_roll = roll_rome_die()
        d_rom = roman_die_str(d_roll)
        preview_txt = _get_chart_roll_preview(player, "death", d_roll)
        bot_wants = _does_bot_want_post_chart_intervention(state, player, "death", d_roll)
        intervenor = _find_human_intervenor_for_post_chart(state, player, "death")
        if bot_wants or intervenor is not None:
            df_state: Dict[str, Any] = {
                "stage": "driver_fate_post_roll",
                "playerIndex": player["index"],
                "chartType": "death",
                "chartRoll": d_roll,
                "previewText": preview_txt,
                "passedIntervenors": [],
                "botInterventions": 0,
                "card": card,
                "wasRefusedDemand": was_refused_demand,
            }
            add_dice_event(
                state,
                kind="driver_fate",
                title=f"💀 DRIVER FATE (DEATH CHART) — {player['name']}",
                subtitle="0: Dead (Lose Goods & End Night) • I: Left for Dead (Lose Goods) • II: Mugged (Lose Cash) • III: Mercy (Lose Influence)",
                groups=[{
                    "rollerName": f"{player['name']} (Wounded Driver)",
                    "rollerType": "player",
                    "colorName": player["color"],
                    "flatBonus": 0,
                    "totalLabel": f"Rolled {d_rom}",
                    "dice": [{"value": d_roll, "roman": d_rom, "sign": 0, "label": "Driver Fate ®", "color": player["color"]}],
                }],
                outcome_title=f"DRIVER FATE: {d_rom}",
                outcome_message=preview_txt,
            )
            _run_bot_post_chart_interventions(state, player, df_state)
            intervenor = _find_human_intervenor_for_post_chart(state, player, "death", df_state["passedIntervenors"])
            if intervenor is not None:
                avail_cards = _get_player_post_chart_influence(intervenor, "death", is_self=False)
                card_names = ", ".join(c["name"] for c in avail_cards)
                df_state["interveningPlayerIndex"] = intervenor["index"]
                if state.get("diceEvents"):
                    last_ev = state["diceEvents"][-1]
                    cur_rom = roman_die_str(int(df_state["chartRoll"]))
                    last_ev["outcomeTitle"] = f"ROLLED {cur_rom} (INFLUENCE AVAILABLE)"
                    last_ev["outcomeMessage"] = df_state["previewText"]
                    last_ev["outcomeDetail"] = df_state["previewText"]
                    last_ev["secretIntervenorIndex"] = intervenor["index"]
                    last_ev["secretCardNames"] = card_names
                    last_ev["secretIntervenorName"] = intervenor["name"]
                state["pendingEncounter"] = df_state
                return {
                    "winner": "opponent",
                    "playerCP": player_cp,
                    "oppCP": opp_cp,
                    "wounds": net_wounds,
                    "casualties": casualties,
                    "driverOutcome": "pending_post_roll",
                }
            _, driver_outcome = _apply_driver_fate_outcome(state, player, int(df_state["chartRoll"]), df_state)
            return {
                "winner": "opponent",
                "playerCP": player_cp,
                "oppCP": opp_cp,
                "wounds": net_wounds,
                "casualties": casualties,
                "driverOutcome": driver_outcome,
            }

        _, driver_outcome = _apply_driver_fate_outcome(state, player, d_roll, df_context)
        add_dice_event(
            state,
            kind="driver_fate",
            title=f"💀 DRIVER FATE (DEATH CHART) — {player['name']}",
            subtitle="0: Dead (Lose Goods & End Night) • I: Left for Dead (Lose Goods) • II: Mugged (Lose Cash) • III: Mercy (Lose Influence)",
            groups=[{
                "rollerName": f"{player['name']} (Wounded Driver)",
                "rollerType": "player",
                "colorName": player["color"],
                "flatBonus": 0,
                "totalLabel": f"Rolled {d_rom}",
                "dice": [{"value": d_roll, "roman": d_rom, "sign": 0, "label": "Driver Fate ®", "color": player["color"]}],
            }],
            outcome_title=f"DRIVER FATE: {d_rom}",
            outcome_message=f"{player['name']}'s Driver wounded (rolled ®={d_rom} -> {driver_outcome})",
        )
        return {
            "winner": "opponent",
            "playerCP": player_cp,
            "oppCP": opp_cp,
            "wounds": net_wounds,
            "casualties": casualties,
            "driverOutcome": driver_outcome,
        }

    # For a human player, pause in 'driver_fate_pre_roll' so the player sees the combat defeat and rolls the Driver Fate (Death Chart) die themselves!
    guard_part = f" ({' | '.join(casualties)})" if casualties else ""
    defeat_msg = (
        f"COMBAT DEFEAT! {player['name']} ({player_cp} CP) lost to {card['name']} ({opp_cp} CP), "
        f"suffering {raw_wounds} Wound(s) ({ignore_wounds} blocked){guard_part}. "
        f"Your Driver suffered an unblocked wound — roll on the Driver Fate (Death) Chart!"
    )
    add_log(state, defeat_msg, "combat")
    state["pendingEncounter"] = {
        "stage": "driver_fate_pre_roll",
        "playerIndex": player["index"],
        "card": card,
        "deck": c_state.get("deck", "nefarii"),
        "xCount": x_count,
        "playerCP": player_cp,
        "oppCP": opp_cp,
        "rawWounds": raw_wounds,
        "ignoreWounds": ignore_wounds,
        "armorSources": armor_sources,
        "equipmentNotes": c_state.get("equipmentNotes", []),
        "casualties": casualties,
        "wasRefusedDemand": was_refused_demand,
    }
    return {
        "winner": "opponent",
        "playerCP": player_cp,
        "oppCP": opp_cp,
        "wounds": net_wounds,
        "casualties": casualties,
        "driverOutcome": "pending_roll",
    }


def _run_bot_pre_combat_interventions(
    state: Dict[str, Any],
    player: Dict[str, Any],
    card: Dict[str, Any],
    x_count: int,
) -> None:
    # 1. Self-help if the fighting merchant is a bot facing dangerous combat
    if player.get("isBot") and (x_count >= 2 or len(player.get("cart", [])) >= 2):
        merc_self = next((c for c in player["influence"] if "Mercenary" in str(c.get("name", ""))), None)
        if merc_self:
            player["influence"].remove(merc_self)
            state["decks"]["influence"].append(merc_self)
            state["hourEffects"]["lastInfluencePlayed"] = merc_self
            _inc_player_stat(player, "influencePlayed", 1)
            player["turnEffects"]["combatDiceBonus"] = player["turnEffects"].get("combatDiceBonus", 0) + 2
            add_log(state, f"{player['name']} played '{merc_self['name']}' (+2® CP in combat against {card['name']})!", "action")
        else:
            dist_self = next((c for c in player["influence"] if "Distraction" in str(c.get("name", ""))), None)
            if dist_self:
                player["influence"].remove(dist_self)
                state["decks"]["influence"].append(dist_self)
                state["hourEffects"]["lastInfluencePlayed"] = dist_self
                _inc_player_stat(player, "influencePlayed", 1)
                player["turnEffects"]["oppDiceMod"] = player["turnEffects"].get("oppDiceMod", 0) - 1
                add_log(state, f"{player['name']} played 'Distraction' (-1® from {card['name']} in combat)!", "action")

    # 2. Adversarial pre-combat play by opposing bots when the target is winning and has meaningful stakes
    meaningful_stakes = len(player.get("cart", [])) > 0 or player.get("cash", 0) >= 16 or x_count >= 2
    if not meaningful_stakes:
        return
    for bot in _iter_bots_after_player(state, player):
        if not _should_bot_target_adversarially(state, bot, player, is_extreme_luck=(len(player.get("cart", [])) >= 2)):
            continue
        dist = next((c for c in bot["influence"] if "Distraction" in str(c.get("name", ""))), None)
        if dist:
            bot["influence"].remove(dist)
            state["decks"]["influence"].append(dist)
            state["hourEffects"]["lastInfluencePlayed"] = dist
            _inc_player_stat(bot, "influencePlayed", 1)
            player["turnEffects"]["combatDiceBonus"] = player["turnEffects"].get("combatDiceBonus", 0) - 1
            add_log(state, f"{bot['name']} played 'Distraction' against {player['name']} (-1® in combat vs. {card['name']})!", "action")
            break
        merc = next((c for c in bot["influence"] if "Mercenary" in str(c.get("name", ""))), None)
        if merc:
            bot["influence"].remove(merc)
            state["decks"]["influence"].append(merc)
            state["hourEffects"]["lastInfluencePlayed"] = merc
            _inc_player_stat(bot, "influencePlayed", 1)
            player["turnEffects"]["oppDiceMod"] = player["turnEffects"].get("oppDiceMod", 0) + 2
            add_log(state, f"{bot['name']} played '{merc['name']}' to reinforce {card['name']} (+2® CP against {player['name']})!", "action")
            break


def _run_bot_post_combat_interventions(
    state: Dict[str, Any],
    player: Dict[str, Any],
    combat_state: Dict[str, Any],
) -> bool:
    if int(combat_state.get("botInterventions", 0)) >= 2:
        return False
    _recompute_combat_totals(combat_state)
    card = combat_state["card"]
    p_cp = int(combat_state["playerCP"])
    o_cp = int(combat_state["oppCP"])

    # 1. Self-defense by bot merchant if losing combat with unblocked wound risk
    if player.get("isBot") and p_cp < o_cp and int(combat_state.get("netWoundsAfterArmor", 0)) > len(player.get("guards", [])):
        pot_self = next((c for c in player["influence"] if "Flying Chamber Pot" in str(c.get("name", ""))), None)
        if pot_self and o_cp - p_cp == 1:
            player["influence"].remove(pot_self)
            state["decks"]["influence"].append(pot_self)
            state["hourEffects"]["lastInfluencePlayed"] = pot_self
            _inc_player_stat(player, "influencePlayed", 1)
            combat_state["playerFlat"] = int(combat_state.get("playerFlat", 0)) + 1
            combat_state.setdefault("playerFlatMods", []).append({"label": pot_self["name"], "value": 1})
            _recompute_combat_totals(combat_state)
            combat_state["botInterventions"] = int(combat_state.get("botInterventions", 0)) + 1
            combat_state["passedIntervenors"] = []
            note = f"{player['name']} played '{pot_self['name']}' (+1 CP -> {combat_state['playerCP']} vs. {combat_state['oppCP']} CP)!"
            add_log(state, note, "combat")
            _emit_updated_combat_dice_event(state, player, combat_state, note)
            return True
        glad_self = next((c for c in player["influence"] if "Gladiator" in str(c.get("name", ""))), None)
        if glad_self and o_cp - p_cp <= 3:
            player["influence"].remove(glad_self)
            state["decks"]["influence"].append(glad_self)
            state["hourEffects"]["lastInfluencePlayed"] = glad_self
            _inc_player_stat(player, "influencePlayed", 1)
            r_g = roll_rome_die()
            r_rom = roman_die_str(r_g)
            combat_state["playerDiceObjs"].append({
                "value": r_g,
                "roman": r_rom,
                "sign": 1,
                "label": f"{glad_self['name']} ®",
                "color": player["color"],
            })
            combat_state["botInterventions"] = int(combat_state.get("botInterventions", 0)) + 1
            combat_state["passedIntervenors"] = []
            note = f"{player['name']} played '{glad_self['name']}' (+{r_rom} CP to {player['name']})!"
            add_log(state, note, "combat")
            _emit_updated_combat_dice_event(state, player, combat_state, note)
            return True
        tof_self = next((c for c in player["influence"] if "Twist Of Fate" in str(c.get("name", ""))), None)
        if tof_self:
            opp_high_idx = next((i for i, d in enumerate(combat_state["oppDiceObjs"]) if int(d.get("value", 0)) >= 3), None)
            own_zero_idx = next((i for i, d in enumerate(combat_state["playerDiceObjs"]) if int(d.get("sign", 1)) > 0 and int(d.get("value", 0)) == 0), None)
            if opp_high_idx is not None or own_zero_idx is not None:
                player["influence"].remove(tof_self)
                state["decks"]["influence"].append(tof_self)
                state["hourEffects"]["lastInfluencePlayed"] = tof_self
                _inc_player_stat(player, "influencePlayed", 1)
                target_die = combat_state["oppDiceObjs"][opp_high_idx] if opp_high_idx is not None else combat_state["playerDiceObjs"][own_zero_idx]
                old_rom = target_die.get("roman", "0")
                new_r = roll_rome_die()
                new_rom = roman_die_str(new_r)
                target_die["value"] = new_r
                target_die["roman"] = new_rom
                if "(Re-rolled)" not in target_die.get("label", ""):
                    target_die["label"] = f"{target_die.get('label', 'Die')} (Re-rolled)"
                combat_state["botInterventions"] = int(combat_state.get("botInterventions", 0)) + 1
                combat_state["passedIntervenors"] = []
                note = f"{player['name']} played 'Twist Of Fate' in self-defense to re-roll {target_die.get('label', 'die')} ({old_rom} -> {new_rom})!"
                add_log(state, note, "combat")
                _emit_updated_combat_dice_event(state, player, combat_state, note)
                return True

    # 2. Adversarial post-combat play by opposing bots when rival is winning/tying by a narrow margin
    _recompute_combat_totals(combat_state)
    p_cp = int(combat_state["playerCP"])
    o_cp = int(combat_state["oppCP"])
    margin = p_cp - o_cp
    if margin < 0 or margin > 2:
        return False

    pos_p_dice = [(i, d) for i, d in enumerate(combat_state["playerDiceObjs"]) if int(d.get("sign", 1)) > 0]
    best_p_die = max(pos_p_dice, key=lambda pair: int(pair[1].get("value", 0))) if pos_p_dice else None
    opp_zero_idx = next((i for i, d in enumerate(combat_state["oppDiceObjs"]) if int(d.get("value", 0)) == 0), None)
    lucky_combat = (
        (best_p_die is not None and int(best_p_die[1].get("value", 0)) >= 3)
        or (opp_zero_idx is not None)
        or (margin in (0, 1))
    )
    if not lucky_combat:
        return False

    is_extreme = (best_p_die is not None and int(best_p_die[1].get("value", 0)) >= 3) or (opp_zero_idx is not None)
    for bot in _iter_bots_after_player(state, player):
        if not _should_bot_target_adversarially(state, bot, player, is_extreme_luck=is_extreme):
            continue
        # Flying Chamber Pot flips a +1 victory into a tie or a tie into a wound!
        pot = next((c for c in bot["influence"] if "Flying Chamber Pot" in str(c.get("name", ""))), None)
        if pot and margin in (0, 1):
            bot["influence"].remove(pot)
            state["decks"]["influence"].append(pot)
            state["hourEffects"]["lastInfluencePlayed"] = pot
            _inc_player_stat(bot, "influencePlayed", 1)
            combat_state["oppFlat"] = int(combat_state.get("oppFlat", 0)) + 1
            combat_state.setdefault("oppFlatMods", []).append({"label": f"{pot['name']} ({bot['name']})", "value": 1})
            combat_state["botInterventions"] = int(combat_state.get("botInterventions", 0)) + 1
            combat_state["passedIntervenors"] = []
            note = f"{bot['name']} threw a 'Flying Chamber Pot' (+1 CP to {card['name']} against {player['name']})!"
            add_log(state, note, "combat")
            _emit_updated_combat_dice_event(state, player, combat_state, note)
            return True
        glad = next((c for c in bot["influence"] if "Gladiator" in str(c.get("name", ""))), None)
        if glad and margin <= 2:
            bot["influence"].remove(glad)
            state["decks"]["influence"].append(glad)
            state["hourEffects"]["lastInfluencePlayed"] = glad
            _inc_player_stat(bot, "influencePlayed", 1)
            r_g = roll_rome_die()
            r_rom = roman_die_str(r_g)
            combat_state["oppDiceObjs"].append({
                "value": r_g,
                "roman": r_rom,
                "sign": 1,
                "label": f"{glad['name']} ({bot['name']}) ®",
                "color": "Black",
            })
            combat_state["botInterventions"] = int(combat_state.get("botInterventions", 0)) + 1
            combat_state["passedIntervenors"] = []
            note = f"{bot['name']} played '{glad['name']}' (+{r_rom} CP to {card['name']} against {player['name']})!"
            add_log(state, note, "combat")
            _emit_updated_combat_dice_event(state, player, combat_state, note)
            return True
        tof = next((c for c in bot["influence"] if "Twist Of Fate" in str(c.get("name", ""))), None)
        if tof:
            target_die = None
            if best_p_die is not None and int(best_p_die[1].get("value", 0)) >= (2 if margin <= 1 else 3):
                target_die = best_p_die[1]
            elif opp_zero_idx is not None:
                target_die = combat_state["oppDiceObjs"][opp_zero_idx]
            if target_die is not None:
                bot["influence"].remove(tof)
                state["decks"]["influence"].append(tof)
                state["hourEffects"]["lastInfluencePlayed"] = tof
                _inc_player_stat(bot, "influencePlayed", 1)
                old_rom = target_die.get("roman", "0")
                new_r = roll_rome_die()
                new_rom = roman_die_str(new_r)
                target_die["value"] = new_r
                target_die["roman"] = new_rom
                if "(Re-rolled)" not in target_die.get("label", ""):
                    target_die["label"] = f"{target_die.get('label', 'Die')} (Re-rolled)"
                combat_state["botInterventions"] = int(combat_state.get("botInterventions", 0)) + 1
                combat_state["passedIntervenors"] = []
                note = f"{bot['name']} played 'Twist Of Fate' against {player['name']} to re-roll {target_die.get('label', 'die')} ({old_rom} -> {new_rom})!"
                add_log(state, note, "combat")
                _emit_updated_combat_dice_event(state, player, combat_state, note)
                return True
    return False


def execute_combat(
    state: Dict[str, Any],
    player: Dict[str, Any],
    card: Dict[str, Any],
    x_count: int,
    source_label: Optional[str] = None,
    use_consumable_ids: Optional[List[str]] = None,
    was_refused_demand: bool = False,
) -> Dict[str, Any]:
    _normalize_encounter_card_data(card)
    consumable_candidates = [
        it for it in player.get("cart", [])
        if (it.get("combat") or {}).get("consumable")
    ]
    if not player.get("isBot") and consumable_candidates and use_consumable_ids is None:
        prev_src = source_label or (state.get("pendingEncounter") or {}).get("encounterSource")
        state["pendingEncounter"] = {
            "stage": "combat_consumable_pre_roll",
            "playerIndex": player["index"],
            "card": copy.deepcopy(card),
            "deck": (card.get("deck") or "nefarii").lower(),
            "xCount": x_count,
            "encounterSource": prev_src,
            "consumableItems": copy.deepcopy(consumable_candidates),
            "wasRefusedDemand": bool(was_refused_demand),
        }
        return {"winner": "pending_consumable_choice", "playerCP": 0, "oppCP": 0}

    _inc_player_stat(player, "combats", 1)

    # 1. Player takes Hostile Favor Consequences
    h_notes = apply_favor_list(player, card.get("hostileFavor", []), reason=f"combat with {card['name']}")

    # 1b. Allow NPC bots to play pre-combat Influence (e.g. Distraction / Mercenary Ambush)
    _run_bot_pre_combat_interventions(state, player, card, x_count)

    # 2. Generate Player CP: Driver (1®) + Guards + Weapons + Mandatory Exotic Animals + Influence modifiers
    driver_roll = roll_rome_die()
    player_rolls = [driver_roll]
    player_dice_objs = [
        {"value": driver_roll, "roman": roman_die_str(driver_roll), "sign": 1, "label": "Driver", "color": player["color"]}
    ]
    init_flat_inf = int(player.get("turnEffects", {}).get("combatFlatBonus", 0))
    player_flat = init_flat_inf
    player_flat_mods: List[Dict[str, Any]] = []
    equipment_notes: List[str] = []
    if init_flat_inf != 0:
        player_flat_mods.append({"label": "Influence Bonus", "value": init_flat_inf})

    if has_climate_modifier(state, "caracalla_3"):
        pos_rubies = max(0, int((player.get("favor") or {}).get("Caracalla", 0)))
        if pos_rubies > 0:
            player_flat += pos_rubies
            player_flat_mods.append({"label": f"Army Pay Hike (+{pos_rubies} Ruby)", "value": pos_rubies})
            equipment_notes.append(f"Army Pay Hike (+{pos_rubies} CP from Rubies)")

    extra_player_dice = int(player.get("turnEffects", {}).get("combatDiceBonus", 0))
    opp_dice_mod = int(player.get("turnEffects", {}).get("oppDiceMod", 0))

    if extra_player_dice > 0:
        for idx_inf in range(extra_player_dice):
            r_inf = roll_rome_die()
            player_rolls.append(r_inf)
            player_dice_objs.append({
                "value": r_inf,
                "roman": roman_die_str(r_inf),
                "sign": 1,
                "label": f"Influence #{idx_inf+1}",
                "color": player["color"],
            })
    elif extra_player_dice < 0:
        for idx_inf in range(abs(extra_player_dice)):
            r_inf = roll_rome_die()
            player_rolls.append(-r_inf)
            player_dice_objs.append({
                "value": r_inf,
                "roman": roman_die_str(r_inf),
                "sign": -1,
                "label": f"Distraction #{idx_inf+1} (-®)",
                "color": player["color"],
            })

    # Guards
    for g in player["guards"]:
        cinfo = g.get("combat") or {}
        g_name = g.get("name", "Guard")
        g_fx_parts = []
        g_roms = []
        for _ in range(cinfo.get("dice", 0)):
            r_g = roll_rome_die()
            g_roms.append(roman_die_str(r_g))
            player_rolls.append(r_g)
            player_dice_objs.append({
                "value": r_g,
                "roman": roman_die_str(r_g),
                "sign": 1,
                "label": f"Guard: {g_name}",
                "color": player["color"],
            })
        if g_roms:
            g_fx_parts.append(f"+{'+'.join(g_roms)} ®")
        g_flat = int(cinfo.get("flat", 0))
        player_flat += g_flat
        if g_flat != 0:
            player_flat_mods.append({"label": f"Guard: {g_name}", "value": g_flat})
            g_fx_parts.append(f"{'+' if g_flat > 0 else ''}{g_flat} CP")
        g_ign_flat = int(cinfo.get("ignoreWoundsFlat", 0))
        if g_ign_flat > 0:
            g_fx_parts.append(f"Ignore {g_ign_flat} Wound{'s' if g_ign_flat != 1 else ''}")
        g_fx_parts.append("Absorbs 1 Wound")
        equipment_notes.append(f"Guard {g_name} ({', '.join(g_fx_parts)})")

    # Weapons & Mandatory Exotic Animals on Cart (including picked-up mission cargo cards in cart)
    consumables_used = []
    selected_consumable_ids = set(str(cid) for cid in (use_consumable_ids or []))
    all_items = list(player["cart"])
    for item in all_items:
        cinfo = item.get("combat")
        if not cinfo:
            continue
        if cinfo.get("consumable"):
            if player.get("isBot"):
                if item.get("isMissionCargo"):
                    continue
            else:
                if str(item.get("id")) not in selected_consumable_ids:
                    continue
        item_label = item.get("item") or item.get("name", "Cargo")
        is_animal = item.get("subcategory") == "Exotic Animals" or item.get("category") == "Exotic Animals"
        i_flat = int(cinfo.get("flat", 0))
        if is_animal or (cinfo.get("dice", 0) > 0 or i_flat != 0 or cinfo.get("negDice", 0) > 0):
            w_fx_parts = []
            w_roms = []
            for _ in range(cinfo.get("dice", 0)):
                r_w = roll_rome_die()
                w_roms.append(roman_die_str(r_w))
                player_rolls.append(r_w)
                player_dice_objs.append({
                    "value": r_w,
                    "roman": roman_die_str(r_w),
                    "sign": 1,
                    "label": item_label,
                    "color": player["color"],
                })
            if w_roms:
                w_fx_parts.append(f"+{'+'.join(w_roms)} ®")
            neg_roms = []
            for _ in range(cinfo.get("negDice", 0)):
                r_neg = roll_rome_die()
                neg_roms.append(roman_die_str(r_neg))
                player_rolls.append(-r_neg)
                player_dice_objs.append({
                    "value": r_neg,
                    "roman": roman_die_str(r_neg),
                    "sign": -1,
                    "label": f"{item_label} (-®)",
                    "color": player["color"],
                })
            if neg_roms:
                w_fx_parts.append(f"-{'-'.join(neg_roms)} ®")
            player_flat += i_flat
            if i_flat != 0:
                player_flat_mods.append({"label": item_label, "value": i_flat})
                w_fx_parts.append(f"{'+' if i_flat > 0 else ''}{i_flat} CP")
            if cinfo.get("consumable") and item in player["cart"]:
                consumables_used.append(item)
                w_fx_parts.append("consumed")
            if w_fx_parts:
                equipment_notes.append(f"{item_label} ({', '.join(w_fx_parts)})")

    # Pre-roll Armor wound-blocking dice and record flat wound-blocking items (Manicae, Galeae, Decimus, Scuta)
    ignore_wounds_flat = 0
    flat_armor_sources: List[str] = []
    for g in player["guards"]:
        g_ign = int((g.get("combat") or {}).get("ignoreWoundsFlat", 0))
        if g_ign > 0:
            ignore_wounds_flat += g_ign
            g_lbl = f"Guard: {g.get('name', 'Guard')}"
            flat_armor_sources.append(f"{g_lbl} (Ignore {g_ign} Wound{'s' if g_ign != 1 else ''})")
            player_flat_mods.append({
                "kind": "armor",
                "label": g_lbl,
                "value": g_ign,
                "text": f"Ignore {g_ign} Wound{'s' if g_ign != 1 else ''}",
            })
    ignore_wounds = ignore_wounds_flat
    for item in all_items:
        cinfo = item.get("combat") or {}
        item_name = item.get("item") or item.get("name", "Armor")
        i_ign_flat = int(cinfo.get("ignoreWoundsFlat", 0))
        if i_ign_flat > 0:
            ignore_wounds_flat += i_ign_flat
            ignore_wounds += i_ign_flat
            flat_armor_sources.append(f"{item_name} (Ignore {i_ign_flat} Wound{'s' if i_ign_flat != 1 else ''})")
            player_flat_mods.append({
                "kind": "armor",
                "label": item_name,
                "value": i_ign_flat,
                "text": f"Ignore {i_ign_flat} Wound{'s' if i_ign_flat != 1 else ''}",
            })
            equipment_notes.append(f"{item_name} (Ignore {i_ign_flat} Wound{'s' if i_ign_flat != 1 else ''})")
        for _ in range(cinfo.get("ignoreWoundsDice", 0)):
            r_arm = roll_rome_die()
            r_arm_rom = roman_die_str(r_arm)
            ignore_wounds += r_arm
            player_dice_objs.append({
                "value": r_arm,
                "roman": r_arm_rom,
                "sign": 0,
                "itemName": item_name,
                "label": f"{item_name} (Block ®)",
                "color": player["color"],
            })
            equipment_notes.append(f"{item_name} (Ignore {r_arm} Wound{'s' if r_arm != 1 else ''}, rolled ®={r_arm_rom})")

    for c_item in consumables_used:
        _remove_cart_item(state, player, c_item, reason="consumed in combat")

    player_cp = max(0, sum(player_rolls) + player_flat)
    opp_cp, opp_rolls, opp_flat = parse_opponent_combat(card.get("combatFormula", "X(R)"), x_count, opp_dice_mod)
    opp_flat_mods: List[Dict[str, Any]] = []
    if opp_flat != 0:
        opp_flat_mods.append({"label": f"{card.get('name', 'Opponent')} ({card.get('combatFormula', '')})", "value": opp_flat})
    cid_str = str(card.get("id") or "")
    eff_deck = (
        card.get("deck")
        or ("legiones" if cid_str.startswith("leg_") else "patricii" if cid_str.startswith("pat_") else "nefarii" if cid_str.startswith("nef_") else "")
    ).lower()
    if has_climate_modifier(state, "caracalla_3") and eff_deck == "legiones":
        opp_flat += 2
        opp_flat_mods.append({"label": "Army Pay Hike (Legiones +2 CP)", "value": 2})
        opp_cp = max(0, sum(opp_rolls) + opp_flat)
    opp_flat_inf = int(player.get("turnEffects", {}).get("oppFlatBonus", 0))
    if opp_flat_inf != 0:
        opp_flat += opp_flat_inf
        opp_flat_mods.append({"label": "Influence Bonus", "value": opp_flat_inf})
        opp_cp = max(0, sum(opp_rolls) + opp_flat)
    opp_dice_objs = [
        {
            "value": r_o,
            "roman": roman_die_str(r_o),
            "sign": 1,
            "label": f"{card.get('name', 'Opponent')} #{idx_o+1}",
            "color": "Black",
        }
        for idx_o, r_o in enumerate(opp_rolls)
    ]

    # Clear one-combat pre-roll effects
    player["turnEffects"]["combatFlatBonus"] = 0
    player["turnEffects"]["oppFlatBonus"] = 0
    player["turnEffects"]["combatDiceBonus"] = 0
    player["turnEffects"]["oppDiceMod"] = 0
    player["turnEffects"]["casusBelli"] = False
    player["tempFavor"] = 0

    stale_src = state.pop("_lastEncounterSource", None)
    prev_src = source_label or (state.get("pendingEncounter") or {}).get("encounterSource") or stale_src
    combat_state = {
        "stage": "combat_post_roll",
        "playerIndex": player["index"],
        "card": card,
        "deck": (card.get("deck") or "nefarii").lower(),
        "xCount": x_count,
        "encounterSource": prev_src,
        "playerDiceObjs": player_dice_objs,
        "oppDiceObjs": opp_dice_objs,
        "playerFlat": player_flat,
        "oppFlat": opp_flat,
        "playerFlatMods": player_flat_mods,
        "oppFlatMods": opp_flat_mods,
        "playerCP": player_cp,
        "oppCP": opp_cp,
        "ignoreWoundsFlat": ignore_wounds_flat,
        "flatArmorSources": flat_armor_sources,
        "ignoreWounds": ignore_wounds,
        "equipmentNotes": equipment_notes,
        "hostileNotes": h_notes,
        "passedIntervenors": [],
        "botInterventions": 0,
        "wasRefusedDemand": bool(was_refused_demand),
    }
    _recompute_combat_totals(combat_state)

    outcome_head, base_outcome_msg = _describe_combat_outcome(player, card, combat_state)
    p_total_lbl = _format_combat_total_label(player_cp, player_dice_objs, player_flat)
    o_total_lbl = _format_combat_total_label(opp_cp, opp_dice_objs, opp_flat)
    if combat_state.get("ignoreWounds", 0) > 0:
        armor_lbl_str = ", ".join(combat_state.get("armorSources", [])) or f"Ignore {combat_state['ignoreWounds']} Wound(s)"
        p_total_lbl = f"{p_total_lbl} • 🛡️ {armor_lbl_str}"

    src_prefix = f"{prev_src} • " if prev_src else ""

    # Emit the initial Combat Dice Event snapshot first
    add_dice_event(
        state,
        kind="combat",
        title=f"⚔️ COMBAT: {player['name']} vs. {card['name']}",
        subtitle=f"{src_prefix}All Combat Dice Rolled Simultaneously",
        groups=[
            {
                "rollerName": f"{player['name']} (Merchant Party)",
                "rollerType": "player",
                "colorName": player["color"],
                "flatBonus": player_flat,
                "flatModifiers": copy.deepcopy(player_flat_mods),
                "totalLabel": p_total_lbl,
                "dice": copy.deepcopy(player_dice_objs),
            },
            {
                "rollerName": f"{card['name']} (×{x_count} {card.get('deck', 'NPC').capitalize()})",
                "rollerType": "npc",
                "colorName": "Black",
                "flatBonus": opp_flat,
                "flatModifiers": copy.deepcopy(opp_flat_mods),
                "totalLabel": o_total_lbl,
                "dice": copy.deepcopy(opp_dice_objs),
            },
        ],
        outcome_title=outcome_head,
        outcome_message=base_outcome_msg,
    )

    # Allow NPC bots to react with post-roll Combat Influence (e.g. Flying Chamber Pot / Gladiator / Twist Of Fate)
    _run_bot_post_combat_interventions(state, player, combat_state)
    _recompute_combat_totals(combat_state)
    player_cp = combat_state["playerCP"]
    opp_cp = combat_state["oppCP"]

    intervenor = _find_human_intervenor_for_post_combat(state, player, combat_state["passedIntervenors"])
    if intervenor is not None:
        post_combat_cards = _get_player_post_combat_influence(intervenor)
        card_names = ", ".join(c["name"] for c in post_combat_cards)
        combat_state["interveningPlayerIndex"] = intervenor["index"]
        cur_head, cur_msg = _describe_combat_outcome(player, card, combat_state)
        if state.get("diceEvents"):
            last_ev = state["diceEvents"][-1]
            last_ev["subtitle"] = f"{src_prefix}All Combat Dice Rolled Simultaneously — Post-Roll Influence Available!"
            last_ev["outcomeTitle"] = f"{cur_head} (INFLUENCE AVAILABLE)"
            last_ev["outcomeMessage"] = cur_msg
            last_ev["outcomeDetail"] = cur_msg
            last_ev["secretIntervenorIndex"] = intervenor["index"]
            last_ev["secretCardNames"] = card_names
            last_ev["secretIntervenorName"] = intervenor["name"]
        state["pendingEncounter"] = combat_state
        return {"winner": "pending", "playerCP": player_cp, "oppCP": opp_cp}

    # If a human player has a deferred Edge Move or Refresh (⤿) tile waiting after this combat (and Driver isn't immediately rolling Death Chart),
    # pause at combat_post_roll so the board doesn't move/reveal the next tile while the combat dice roll is still on screen!
    has_deferred_board_change = bool(state.get("pendingPostEncounterMove") or state.get("pendingPostEncounterRefresh"))
    driver_wounded = (player_cp < opp_cp) and (combat_state.get("netWoundsAfterArmor", 0) > len(player.get("guards", [])))
    if not player.get("isBot") and has_deferred_board_change and not driver_wounded:
        state["pendingEncounter"] = combat_state
        return {"winner": "pending", "playerCP": player_cp, "oppCP": opp_cp}

    return _finalize_combat_after_post_roll(state, player, combat_state)


def _find_combat_mission_for_encounter(player: Dict[str, Any], card: Dict[str, Any], deck_key: str) -> Optional[Dict[str, Any]]:
    """
    Checks if the player holds an active uncompleted mission (either from the Missiones deck
    or prescribed by an encounter) that requires engaging in combat with this encountered party.
    """
    cname = (card.get("name") or "").lower()
    is_emperor = any(emp in cname for emp in ("bassianus", "caracalla", "geta"))
    dk_low = (deck_key or card.get("deck") or "").lower()

    for m in player.get("missions", []):
        if m.get("completed"):
            continue
        kind = (m.get("kind") or "").lower()
        target_deck = (m.get("targetDeck") or "").lower()
        target_str = (m.get("target") or "").lower()
        desc_str = f"{m.get('name', '')} {m.get('description', '')} {m.get('text', '')}".lower()

        if kind in ("kill_emperor", "kill_emperor_cancel") or "emperor" in target_str or "kill the emperor" in desc_str:
            if is_emperor:
                return m
        if kind == "kill":
            if target_deck and target_deck == dk_low:
                return m
            if "patricius" in desc_str and dk_low == "patricii":
                return m
            if "legionary" in desc_str and dk_low == "legiones":
                return m
            if "nefarius" in desc_str and dk_low == "nefarii":
                return m
    return None


def _build_pending_encounter_state(
    state: Dict[str, Any],
    player: Dict[str, Any],
    card: Dict[str, Any],
    deck_key: str,
    x_count: int,
    source_label: Optional[str] = None,
) -> Dict[str, Any]:
    if not source_label and state.get("pendingEncounter"):
        source_label = state["pendingEncounter"].get("encounterSource")
    faction = card.get("faction")
    favor_score = calculate_faction_favor(player, faction)

    matched_reaction = "combat"
    matched_tier_idx = 0
    matched_tier_obj = None
    reactions = card.get("reactions", [])
    for idx_r, r_item in enumerate(reactions):
        cond_str = str(r_item.get("condition", ">=0")).strip()
        if evaluate_reaction_condition(favor_score, cond_str):
            matched_reaction = r_item.get("type", "demand")
            matched_tier_idx = idx_r
            matched_tier_obj = r_item
            if not (cond_str.startswith(">") or cond_str.startswith("≥")):
                break

    action_text = (card.get("actionText") or "").strip()
    if action_text.startswith("?") and matched_reaction in ("demand", "mission_request"):
        matched_reaction = "offer"
    combat_mandatory = matched_reaction == "combat"
    is_strict_demand = (matched_reaction in ("demand_strict", "mission_strict")) or (
        not reactions and not combat_mandatory and action_text.startswith("!!")
    )
    combat_threatened = combat_mandatory or is_strict_demand

    combat_mission = _find_combat_mission_for_encounter(player, card, deck_key)
    casus_belli_active = bool(player.get("turnEffects", {}).get("casusBelli"))
    has_casus_belli_card = any("Casus Belli" in c.get("name", "") for c in player.get("influence", []))

    can_initiate_combat = combat_threatened or (combat_mission is not None) or casus_belli_active
    combat_unlock_reason = None
    if combat_threatened:
        combat_unlock_reason = "Combat Threatened"
    elif combat_mission is not None:
        combat_unlock_reason = f"Mission: {combat_mission.get('name', 'Kill Mission')}"
    elif casus_belli_active:
        combat_unlock_reason = "Casus Belli"

    return {
        "stage": "pre_decision",
        "playerIndex": player["index"],
        "card": card,
        "deck": deck_key,
        "xCount": x_count,
        "encounterSource": source_label,
        "favorScore": favor_score,
        "reaction": matched_reaction,
        "reactionType": matched_reaction,
        "matchedTierIndex": matched_tier_idx,
        "matchedTier": matched_tier_obj,
        "combatMandatory": combat_mandatory,
        "combatThreatened": combat_threatened,
        "canInitiateCombat": can_initiate_combat,
        "combatUnlockReason": combat_unlock_reason,
        "hasCasusBelliCard": has_casus_belli_card,
        "combatFlatBonus": player.get("turnEffects", {}).get("combatFlatBonus", 0),
        "combatDiceBonus": player.get("turnEffects", {}).get("combatDiceBonus", 0),
        "oppDiceMod": player.get("turnEffects", {}).get("oppDiceMod", 0),
        "armyPayHikeActive": has_climate_modifier(state, "caracalla_3"),
    }


def trigger_deck_encounter(state: Dict[str, Any], player: Dict[str, Any], enc_code: str, source_label: Optional[str] = None) -> None:
    """Draws and resolves (or queues interactive choice for) a Patricii, Legiones, or Nefarii encounter."""
    parts = enc_code.split("_")
    deck_key = parts[0].lower()
    x_count = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 1

    deck = state["decks"].get(deck_key, [])
    if not deck:
        return

    card = deck.pop(0)
    deck.append(card)  # Cycle to bottom unless kept as mission
    _normalize_encounter_card_data(card)

    ctype = card.get("type", "character")
    cname = card.get("name", "Encounter")
    src_note = f" [{source_label}]" if source_label else ""

    # Handle special event cards in Encounter decks
    if ctype == "event" or cname in ("Salve!", "Brutta Figura", "Procession", "Ushered Along", "Road Blocked"):
        if not player.get("isBot"):
            add_log(
                state,
                f"{player['name']} drew Encounter Card '{cname}' ({deck_key.capitalize()}){src_note}.",
                "encounter",
            )
            state["pendingEncounter"] = {
                "stage": "event_pre_resolve",
                "playerIndex": player["index"],
                "card": copy.deepcopy(card),
                "deck": deck_key,
                "xCount": x_count,
                "encCode": enc_code,
                "encounterSource": source_label,
            }
            return
        ev_card_vis = _public_encounter_card_visual(card, deck_key)
        if "Salve" in cname:
            player["tempFavor"] = player.get("tempFavor", 0) + 1
            add_log(state, f"{player['name']} drew '{cname}' (+1 temporary Favor for next encounter) and draws again!", "encounter")
            add_npc_event(
                state,
                player,
                "encounter",
                f"Drew '{cname}' (+1 Favor)",
                cell=player.get("position"),
                visual={"kind": "encounter", "card": ev_card_vis, "outcome": "gift", "outcomeLabel": "👋 +1 Temp Favor"},
            )
            trigger_deck_encounter(state, player, enc_code, source_label=source_label)
            return
        if "Brutta" in cname:
            player["tempFavor"] = player.get("tempFavor", 0) - 1
            add_log(state, f"{player['name']} drew '{cname}' (-1 temporary Favor for next encounter) and draws again!", "encounter")
            add_npc_event(
                state,
                player,
                "encounter",
                f"Drew '{cname}' (-1 Favor)",
                cell=player.get("position"),
                visual={"kind": "encounter", "card": ev_card_vis, "outcome": "penalty", "outcomeLabel": "👎 -1 Temp Favor"},
            )
            trigger_deck_encounter(state, player, enc_code, source_label=source_label)
            return
        if "Procession" in cname:
            player["skipTurns"] = player.get("skipTurns", 0) + 1
            player["turnStep"] = "done"
            add_log(state, f"{player['name']} drew '{cname}'! Cart is halted by a religious procession — loses next turn.", "encounter")
            add_npc_event(
                state,
                player,
                "encounter",
                f"Halted by '{cname}'",
                cell=player.get("position"),
                visual={"kind": "encounter", "card": ev_card_vis, "outcome": "penalty", "outcomeLabel": "⏳ Procession (Lost Turn)"},
            )
            return
        if "Ushered" in cname:
            player["movesRemaining"] = player.get("movesRemaining", 0) + 1
            player["turnStep"] = "start"
            add_log(state, f"{player['name']} drew '{cname}'! Must immediately move to another accessible neighborhood.", "encounter")
            add_npc_event(
                state,
                player,
                "encounter",
                f"Drew '{cname}' (Moves again!)",
                cell=player.get("position"),
                visual={"kind": "encounter", "card": ev_card_vis, "outcome": "safe", "outcomeLabel": "⏩ Ushered Along"},
            )
            return
        if "Road Blocked" in cname:
            curr_pos_before = player.get("position")
            prev = player.get("previousPosition")
            if prev:
                player["position"] = prev
                player["turnStep"] = "done"
                add_log(state, f"{player['name']} drew 'Road Blocked'! Forced to turn around to {prev} and end turn.", "encounter")
                add_npc_event(
                    state,
                    player,
                    "move",
                    f"Road Blocked! Turned back to {prev}",
                    cell=prev,
                    from_cell=curr_pos_before,
                    visual={"kind": "encounter", "card": ev_card_vis, "outcome": "penalty", "outcomeLabel": f"🚧 Back to {prev}"},
                )
            else:
                player["turnStep"] = "done"
                add_log(state, f"{player['name']} drew 'Road Blocked'! Turn ends immediately.", "encounter")
                add_npc_event(
                    state,
                    player,
                    "encounter",
                    "Road Blocked! Turn ended",
                    cell=curr_pos_before,
                    visual={"kind": "encounter", "card": ev_card_vis, "outcome": "penalty", "outcomeLabel": "🚧 Road Blocked"},
                )
            return

    _inc_encounter_stat(player, deck_key, 1)
    pending = _build_pending_encounter_state(state, player, card, deck_key, x_count, source_label=source_label)
    faction = card.get("faction")
    favor_score = pending["favorScore"]
    matched_reaction = pending["reaction"]

    add_log(
        state,
        f"{player['name']} encountered {cname} ({deck_key.capitalize()}, {faction or 'Unaligned'}, x{x_count}){src_note}. {player['name']}'s {faction} Favor is {favor_score} -> Reaction: {matched_reaction.upper()}.",
        "encounter",
    )

    if player["isBot"]:
        player["tempFavor"] = 0
        card_vis = _public_encounter_card_visual(card, deck_key)
        _rx_labels = {
            "friendly": "Friendly",
            "combat": "Hostile Combat",
            "demand": "Demand",
            "deck_quest_demand": "Patron Task",
            "neutral": "Neutral",
        }
        rx_nice = _rx_labels.get(str(matched_reaction).lower(), str(matched_reaction).replace("_", " ").title())
        enc_ev = add_npc_event(
            state,
            player,
            "encounter",
            f"Encountered {cname} ({rx_nice})",
            player.get("position"),
            visual={
                "kind": "encounter",
                "card": card_vis,
                "reaction": matched_reaction,
                "outcome": "pending",
                "outcomeLabel": f"⚡ {rx_nice}",
            },
        )
        if matched_reaction == "combat":
            intervenor = _find_human_intervenor_for_pre_combat(state, player)
            if intervenor is not None:
                pending["interveningPlayerIndex"] = intervenor["index"]
                state["pendingEncounter"] = pending
                return
            execute_combat(state, player, card, x_count, source_label=source_label)
        elif bot_should_initiate_combat(state, player, pending):
            if not pending.get("canInitiateCombat") and pending.get("hasCasusBelliCard"):
                cb_card = next((c for c in player["influence"] if "Casus Belli" in c.get("name", "")), None)
                if cb_card:
                    player["influence"].remove(cb_card)
                    state["decks"]["influence"].append(cb_card)
                    state["hourEffects"]["lastInfluencePlayed"] = cb_card
                    _inc_player_stat(player, "influencePlayed", 1)
                    player["turnEffects"]["casusBelli"] = True
                    add_log(state, f"{player['name']} played 'Casus Belli' to initiate combat against {cname}!", "encounter")
            was_ref = bool(pending.get("combatThreatened") and not pending.get("combatMandatory"))
            execute_combat(state, player, card, x_count, source_label=source_label, was_refused_demand=was_ref)
        else:
            cash_before = int(player.get("cash", 0))
            cart_ids_before = {str(x.get("id")) for x in player.get("cart", [])}
            cart_snapshot = [copy.deepcopy(x) for x in player.get("cart", [])]
            missions_before = len(player.get("missions", []))
            req_d, _ = _check_active_demand_kind(state, player, pending)
            chosen_dec = "fulfill"
            if req_d == "cash" and any("Trained Dog" in c.get("name", "") for c in player["influence"]):
                chosen_dec = "use_dog"
            elif req_d == "goods" and player.get("cart") and any("Plea" in c.get("name", "") for c in player["influence"]):
                chosen_dec = "use_plea"
            resolve_pending_encounter_choice(state, player, pending, chosen_dec)
            if not state.get("pendingEncounter"):
                cash_delta = int(player.get("cash", 0)) - cash_before
                cart_after = player.get("cart", [])
                added_items = [x for x in cart_after if str(x.get("id")) not in cart_ids_before]
                after_ids = {str(x.get("id")) for x in cart_after}
                removed_items = [x for x in cart_snapshot if str(x.get("id")) not in after_ids]
                missions_after = len(player.get("missions", []))
                if chosen_dec == "use_dog":
                    _update_or_add_bot_encounter_outcome(state, player, card, deck_key, "safe", "🐕 Trained Dog!", f"Used 'Trained Dog' on {cname}")
                elif chosen_dec == "use_plea":
                    _update_or_add_bot_encounter_outcome(state, player, card, deck_key, "safe", "🙏 Plea Accepted!", f"Used 'Plea' on {cname}")
                elif added_items and cash_delta < 0:
                    bought_it = added_items[-1]
                    _update_or_add_bot_encounter_outcome(
                        state,
                        player,
                        card,
                        deck_key,
                        "buy",
                        f"🛒 Bought {bought_it['name']} (-{abs(cash_delta)}d)",
                        f"Bought {bought_it['name']} from {cname} ({abs(cash_delta)}d)",
                        extra_visual={"item": _public_item_visual(bought_it), "price": abs(cash_delta)},
                    )
                elif removed_items and cash_delta > 0:
                    sold_it = removed_items[0]
                    _update_or_add_bot_encounter_outcome(
                        state,
                        player,
                        card,
                        deck_key,
                        "sell",
                        f"💰 Sold {sold_it['name']} (+{cash_delta}d)",
                        f"Sold {sold_it['name']} to {cname} (+{cash_delta}d)",
                        extra_visual={"item": _public_item_visual(sold_it), "price": cash_delta},
                    )
                elif missions_after > missions_before:
                    _update_or_add_bot_encounter_outcome(state, player, card, deck_key, "mission", "📜 Accepted Task", f"Accepted task from {cname}")
                elif cash_delta > 0:
                    _update_or_add_bot_encounter_outcome(
                        state,
                        player,
                        card,
                        deck_key,
                        "gift",
                        f"🎁 Patronage (+{cash_delta}d)",
                        f"Received +{cash_delta}d from {cname}",
                        extra_visual={"price": cash_delta},
                    )
                elif cash_delta < 0:
                    _update_or_add_bot_encounter_outcome(
                        state,
                        player,
                        card,
                        deck_key,
                        "paid",
                        f"💸 Paid {abs(cash_delta)}d",
                        f"Paid {abs(cash_delta)}d to {cname}",
                        extra_visual={"price": abs(cash_delta)},
                    )
                elif removed_items:
                    gave_it = removed_items[0]
                    _update_or_add_bot_encounter_outcome(
                        state,
                        player,
                        card,
                        deck_key,
                        "paid_good",
                        f"📦 Gave {gave_it['name']}",
                        f"Gave {gave_it['name']} to {cname}",
                        extra_visual={"item": _public_item_visual(gave_it)},
                    )
                else:
                    enc_ev["visual"]["outcome"] = "safe"
                    enc_ev["visual"]["outcomeLabel"] = "✓ Resolved"
    else:
        state["pendingEncounter"] = pending


def _compute_npc_offer_buy_price(
    state: Dict[str, Any],
    card_item: Dict[str, Any],
    source_type: str,
    col_idx: Optional[int],
    modifier: str,
    fixed_price: Optional[Any],
    action_text: str,
) -> Tuple[int, str]:
    if fixed_price is not None:
        fp = int(fixed_price)
        return fp, f"{fp}d Fixed"
    mod = normalize_scarcity_modifier(str(modifier or "="))
    delta = MODIFIER_DELTAS.get(mod, 0)
    buy_table = card_item.get("buy") or [10, 8, 5, 4, 2]
    if "relative to present mkt scarcity" in (action_text or "").lower():
        track_name = card_item.get("track") or _resolve_track_for_category(card_item.get("category", "Grain"))
        track_cards = state["marketBoard"].get(track_name, [])
        shift = state.get("seasonTrackShifts", {}).get(track_name, 0)
        base_idx = get_track_scarcity_index(track_cards, shift)
        p_idx = max(0, min(4, base_idx + delta))
    else:
        p_idx = max(0, min(4, 2 + delta))
    return int(buy_table[p_idx]), SCARCITY_SYMBOLS[p_idx]


def _start_npc_offer(state: Dict[str, Any], player: Dict[str, Any], card: Dict[str, Any], is_buy_offer: bool) -> Tuple[bool, str]:
    m_raw = card.get("mission") or {}
    action_text = card.get("actionText", "")
    req_cat = m_raw.get("category") or "Any"
    raw_mod_str = str(m_raw.get("modifier", "=")).strip()
    fixed_price = m_raw.get("fixedPrice")
    if fixed_price is None:
        m_fp = re.search(r"(\d+)\s*\(d\)", raw_mod_str) or re.search(r"for\s+(\d+)\s*\(d\)", action_text, re.IGNORECASE)
        if m_fp:
            fixed_price = int(m_fp.group(1))
    mod = normalize_scarcity_modifier(raw_mod_str)
    raw_source = str(m_raw.get("source") or m_raw.get("target") or "").strip().lower()
    low_act = action_text.lower()
    if "market or deck" in raw_source or "market or deck" in low_act or "mkt or deck" in low_act:
        src_spec = "market_or_deck"
    elif "deck" in raw_source or "from deck" in low_act or "goods deck" in low_act:
        src_spec = "deck"
    elif "market" in raw_source or "mkt" in raw_source or "from mkt" in low_act or "from market" in low_act:
        src_spec = "market"
    else:
        src_spec = "market_or_deck"
    is_top_of_deck = ("top card" in low_act) or (fixed_price is not None and src_spec == "deck")

    if is_buy_offer:
        candidates: List[Dict[str, Any]] = []
        if src_spec in ("market", "market_or_deck") and not is_top_of_deck:
            for t_name in ("Weapons", "Grain", "Wine", "Marble", "Animals"):
                for col_idx, c in enumerate(state["marketBoard"].get(t_name, [])):
                    if req_cat == "Any" or matches_category(c, req_cat):
                        pr, sym = _compute_npc_offer_buy_price(state, c, "market", col_idx, mod, fixed_price, action_text)
                        candidates.append({
                            "id": f"mkt_{c['id']}_{col_idx}",
                            "cardId": c["id"],
                            "source": "market",
                            "sourceLabel": f"Ostia Market ({t_name} Col #{col_idx + 1})",
                            "track": t_name,
                            "colIndex": col_idx,
                            "price": pr,
                            "scarcitySymbol": sym,
                            "card": copy.deepcopy(c),
                        })
        if src_spec in ("deck", "market_or_deck"):
            for idx_d, c in enumerate(state["decks"].get("market", [])):
                if c.get("track") == "Guards":
                    continue
                if req_cat == "Any" or matches_category(c, req_cat):
                    pr, sym = _compute_npc_offer_buy_price(state, c, "deck", None, mod, fixed_price, action_text)
                    candidates.append({
                        "id": f"deck_{c['id']}_{idx_d}",
                        "cardId": c["id"],
                        "source": "deck",
                        "sourceLabel": "Top of Goods Deck" if is_top_of_deck else "Goods Deck",
                        "track": c.get("track"),
                        "colIndex": None,
                        "price": pr,
                        "scarcitySymbol": sym,
                        "card": copy.deepcopy(c),
                    })
                    if is_top_of_deck:
                        break

        if player.get("isBot"):
            max_b, _ = get_player_cart_limits(player)
            used_b, _ = get_player_cart_usage(player)
            for cand in candidates:
                c_obj = cand["card"]
                pr = int(cand["price"])
                if player["cash"] >= pr and used_b + int(c_obj.get("blocks", 1)) <= max_b:
                    if cand["source"] == "market":
                        tr = state["marketBoard"].get(cand["track"], [])
                        picked = next((x for x in tr if x["id"] == cand["cardId"]), None)
                        if picked:
                            tr.remove(picked)
                    else:
                        dk = state["decks"].get("market", [])
                        picked = next((x for x in dk if x["id"] == cand["cardId"]), None)
                        if picked:
                            dk.remove(picked)
                    if picked:
                        player["cash"] -= pr
                        picked["purchasePrice"] = pr
                        player["cart"].append(picked)
                        _inc_player_stat(player, "itemsPurchased", 1)
                        f_notes = apply_favor_list(
                            player,
                            card.get("friendlyFavor", []),
                            reason=f"buying {picked['name']} from {card['name']}",
                        )
                        add_log(state, f"{player['name']} purchased {picked['name']} from {card['name']} for {pr}(d)! {' '.join(f_notes)}", "encounter")
                        return True, f"Purchased {picked['name']} for {pr}(d)."
            return True, "No affordable item purchased."

        player["pendingNpcOffer"] = {
            "id": f"npcoff_{secrets.token_hex(4)}",
            "mode": "buy_from_npc",
            "offerType": "buy_from_npc",
            "npcName": card.get("name", "Patron"),
            "npcCard": copy.deepcopy(card),
            "actionText": action_text,
            "category": req_cat,
            "modifier": mod,
            "fixedPrice": fixed_price,
            "sourceSpec": src_spec,
            "candidates": candidates,
        }
        return True, f"Select a {req_cat} card to purchase from {card['name']}."

    # Otherwise: NPC offers to buy a matching Good from the player's Cart
    sell_candidates: List[Dict[str, Any]] = []
    for idx_c, c in enumerate(player.get("cart", [])):
        if c.get("isMissionCargo") and (not c.get("sell") or c.get("missionSource") != "encounter"):
            continue
        if req_cat == "Any" or matches_category(c, req_cat):
            pr, sym = compute_sell_price(state, player, c, mod)
            sell_candidates.append({
                "id": f"cart_{c['id']}_{idx_c}",
                "cardId": c["id"],
                "source": "cart",
                "sourceLabel": "Your Cart",
                "track": c.get("track"),
                "colIndex": None,
                "price": pr,
                "scarcitySymbol": sym,
                "card": copy.deepcopy(c),
            })

    if player.get("isBot"):
        if sell_candidates:
            best_c = max(sell_candidates, key=lambda x: x["price"])
            item = next((x for x in player["cart"] if x["id"] == best_c["cardId"]), None)
            if item:
                pr = int(best_c["price"])
                _remove_cart_item(
                    state,
                    player,
                    item,
                    reason=f"fenced/sold to {card['name']} for {pr}(d)" if item.get("isMissionCargo") else f"sold to {card['name']} for {pr}(d)",
                    is_fenced=bool(item.get("isMissionCargo")),
                )
                player["cash"] += pr
                _inc_player_stat(player, "itemsSold", 1)
                f_notes = apply_favor_list(
                    player,
                    card.get("friendlyFavor", []),
                    reason=f"selling {item['name']} to {card['name']}",
                )
                r_notes = grant_reward(state, player, None, card.get("friendlyReward", ""))
                add_log(state, f"{player['name']} sold {item['name']} to {card['name']} for {pr}(d)! {' '.join(f_notes + r_notes)}", "encounter")
                return True, f"Sold {item['name']} for {pr}(d)."
        return True, "No matching item to sell."

    player["pendingNpcOffer"] = {
        "id": f"npcoff_{secrets.token_hex(4)}",
        "mode": "sell_to_npc",
        "offerType": "sell_to_npc",
        "npcName": card.get("name", "Patron"),
        "npcCard": copy.deepcopy(card),
        "actionText": action_text,
        "category": req_cat,
        "modifier": mod,
        "fixedPrice": None,
        "sourceSpec": "cart",
        "candidates": sell_candidates,
    }
    return True, f"Select a {req_cat} card from your Cart to sell to {card['name']}."


def _get_demand_roll_preview(player: Dict[str, Any], card: Dict[str, Any], demand_state: Dict[str, Any]) -> str:
    d_kind = demand_state.get("demandKind", "influence")
    r = max(0, min(3, int(demand_state.get("demandRoll", 0))))
    r_rom = roman_die_str(r)
    note_text = str(demand_state.get("noteText") or "")
    combat_threat = bool(demand_state.get("combatThreatened"))
    f_list = card.get("friendlyFavor") or []
    h_list = demand_state.get("hostileFavorList") or []
    f_part = f" and gains {'/'.join(f_list)} Favor" if f_list else ""
    h_part = "/".join(h_list) if h_list else "Hostile Favor"

    if d_kind == "influence":
        avail = len(player.get("influence", []))
        if avail >= r:
            return f"Rolled {r_rom} ({r}) → {player['name']} gives {r} of {avail} Influence card(s) to {card['name']}{f_part}!"
        if "all card" in note_text or combat_threat:
            return f"Rolled {r_rom} ({r}) → {player['name']} only has {avail} Influence card(s) (gives all {avail}, avoids combat, suffers {h_part})."
        return f"Rolled {r_rom} ({r}) → {player['name']} only has {avail} Influence card(s) (cannot fulfill {r}, suffers {h_part})."

    mult = int(demand_state.get("cashMultiplier", 4))
    amt = r * mult
    cash = int(player.get("cash", 0))
    if cash >= amt:
        return f"Rolled {r_rom} ({r} × {mult}d = {amt}d) → {player['name']} pays {amt}(d) to {card['name']} (from {cash}d){f_part}!"
    if "all (d)" in note_text or combat_threat:
        return f"Rolled {r_rom} ({amt}d demanded) → {player['name']} only has {cash}(d) (pays all {cash}d, avoids combat, suffers {h_part})."
    return f"Rolled {r_rom} ({amt}d demanded) → {player['name']} only has {cash}(d) (cannot pay, suffers {h_part})."


def _does_bot_want_post_demand_intervention(state: Dict[str, Any], player: Dict[str, Any], demand_state: Dict[str, Any]) -> bool:
    r = int(demand_state.get("demandRoll", 0))
    d_kind = demand_state.get("demandKind", "influence")
    mult = int(demand_state.get("cashMultiplier", 4))

    # Self-defense by bot roller on a painful III (or II if it wipes out cards/cash)
    if player.get("isBot") and _get_player_twist_of_fate_cards(player):
        if d_kind == "influence" and len(player.get("influence", [])) > 1 and r == 3:
            return True
        if d_kind == "cash" and r >= 2 and player.get("cash", 0) >= mult:
            return True

    # Adversarial check by opposing bots when target rolled 0 (or I with meaningful holdings)
    meaningful = (
        (d_kind == "influence" and (len(player.get("influence", [])) >= 1 or bool(card_fav := (demand_state.get("card") or {}).get("friendlyFavor"))))
        or (d_kind == "cash" and player.get("cash", 0) >= mult)
    )
    if meaningful and r in (0, 1):
        is_extreme = (r == 0)
        if r == 1 and d_kind == "influence" and len(player.get("influence", [])) < 2:
            return False
        if r == 1 and d_kind == "cash" and player.get("cash", 0) < mult * 2:
            return False
        for bot in _iter_bots_after_player(state, player):
            if _get_player_twist_of_fate_cards(bot) and _should_bot_target_adversarially(state, bot, player, is_extreme_luck=is_extreme):
                return True
    return False


def _run_bot_post_demand_interventions(state: Dict[str, Any], player: Dict[str, Any], demand_state: Dict[str, Any]) -> bool:
    if int(demand_state.get("botInterventions", 0)) >= 2:
        return False
    card = demand_state["card"]
    d_kind = demand_state.get("demandKind", "influence")
    mult = int(demand_state.get("cashMultiplier", 4))
    r = int(demand_state.get("demandRoll", 0))

    # 1. Self-defense by bot roller
    if player.get("isBot"):
        tof_self = next((c for c in player["influence"] if "Twist Of Fate" in str(c.get("name", ""))), None)
        if tof_self:
            bad_self = (d_kind == "influence" and len(player["influence"]) > 1 and r == 3) or (
                d_kind == "cash" and r >= 2 and player["cash"] >= mult
            )
            if bad_self:
                old_r = r
                new_r = roll_rome_die()
                new_rom = roman_die_str(new_r)
                player["influence"].remove(tof_self)
                state["decks"]["influence"].append(tof_self)
                state["hourEffects"]["lastInfluencePlayed"] = tof_self
                _inc_player_stat(player, "influencePlayed", 1)
                demand_state["demandRoll"] = new_r
                demand_state["previewText"] = _get_demand_roll_preview(player, card, demand_state)
                demand_state["botInterventions"] = int(demand_state.get("botInterventions", 0)) + 1
                demand_state["passedIntervenors"] = []
                note = f"{player['name']} played 'Twist Of Fate' to re-roll {card['name']}'s harsh {roman_die_str(old_r)} Demand die ({roman_die_str(old_r)} -> {new_rom})!"
                add_log(state, note, "action")
                add_dice_event(
                    state,
                    kind="demand",
                    title=f"🎲 TWIST OF FATE RE-ROLL (DEMAND: {card['name']})",
                    subtitle=note,
                    groups=[{
                        "rollerName": player["name"],
                        "rollerType": "player",
                        "colorName": player["color"],
                        "flatBonus": 0,
                        "totalLabel": f"Re-rolled: {new_rom}",
                        "dice": [{"value": new_r, "roman": new_rom, "sign": 1, "label": "Re-rolled Demand ®", "color": player["color"]}],
                    }],
                    outcome_title=f"RE-ROLLED {new_rom}",
                    outcome_message=demand_state["previewText"],
                )
                return True

    # 2. Adversarial intervention by opposing bots on lucky 0 / I Demand roll
    r = int(demand_state.get("demandRoll", 0))
    if r in (0, 1):
        if r == 1 and d_kind == "influence" and len(player.get("influence", [])) < 2:
            return False
        if r == 1 and d_kind == "cash" and player.get("cash", 0) < mult * 2:
            return False
        is_extreme = (r == 0)
        for bot in _iter_bots_after_player(state, player):
            tof = next((c for c in bot["influence"] if "Twist Of Fate" in str(c.get("name", ""))), None)
            if not tof:
                continue
            if not _should_bot_target_adversarially(state, bot, player, is_extreme_luck=is_extreme):
                continue
            old_r = r
            new_r = roll_rome_die()
            new_rom = roman_die_str(new_r)
            bot["influence"].remove(tof)
            state["decks"]["influence"].append(tof)
            state["hourEffects"]["lastInfluencePlayed"] = tof
            _inc_player_stat(bot, "influencePlayed", 1)
            demand_state["demandRoll"] = new_r
            demand_state["previewText"] = _get_demand_roll_preview(player, card, demand_state)
            demand_state["botInterventions"] = int(demand_state.get("botInterventions", 0)) + 1
            demand_state["passedIntervenors"] = []
            note = f"{bot['name']} played 'Twist Of Fate' to force {player['name']} to re-roll their lucky {roman_die_str(old_r)} Demand roll for {card['name']} ({roman_die_str(old_r)} -> {new_rom})!"
            add_log(state, note, "action")
            add_dice_event(
                state,
                kind="demand",
                title=f"🎲 TWIST OF FATE RE-ROLL (DEMAND: {card['name']})",
                subtitle=note,
                groups=[{
                    "rollerName": player["name"],
                    "rollerType": "player",
                    "colorName": player["color"],
                    "flatBonus": 0,
                    "totalLabel": f"Re-rolled: {new_rom}",
                    "dice": [{"value": new_r, "roman": new_rom, "sign": 1, "label": "Re-rolled Demand ®", "color": player["color"]}],
                }],
                outcome_title=f"RE-ROLLED {new_rom}",
                outcome_message=demand_state["previewText"],
            )
            return True
    return False


def _apply_demand_roll_outcome(
    state: Dict[str, Any],
    player: Dict[str, Any],
    demand_state: Dict[str, Any],
    emit_dice_event: bool = True,
) -> Tuple[bool, str]:
    card = demand_state["card"]
    d_kind = demand_state.get("demandKind", "influence")
    r = max(0, min(3, int(demand_state.get("demandRoll", 0))))
    r_rom = roman_die_str(r)
    note_text = str(demand_state.get("noteText") or "")
    combat_threat = bool(demand_state.get("combatThreatened"))
    hostile_favor_list = demand_state.get("hostileFavorList") or ([f"-{card['faction']}"] if card.get("faction") else [])
    state["pendingEncounter"] = None

    if d_kind == "influence":
        cnt = r
        avail_inf = len(player["influence"])
        given = 0
        if avail_inf >= cnt:
            for _ in range(cnt):
                c = player["influence"].pop(0)
                state["decks"]["influence"].append(c)
                given += 1
            f_notes = apply_favor_list(
                player,
                card.get("friendlyFavor", []),
                reason=f"giving {given} Influence card(s) to {card['name']}",
            )
            msg = f"{player['name']} gave {given} Influence card(s) to {card['name']}. {' '.join(f_notes)}".strip()
            add_log(state, msg, "encounter")
        elif "all card" in note_text or combat_threat:
            while player["influence"]:
                c = player["influence"].pop(0)
                state["decks"]["influence"].append(c)
                given += 1
            h_notes = apply_favor_list(
                player,
                hostile_favor_list,
                reason=f"unable to give full Influence demand to {card['name']}",
            )
            msg = f"{player['name']} only had {given} Influence card(s) for {card['name']} (avoided combat, took {' '.join(h_notes)})."
            add_log(state, msg, "encounter")
        else:
            h_notes = apply_favor_list(
                player,
                hostile_favor_list,
                reason=f"unable to give Influence card(s) to {card['name']}",
            )
            msg = f"{player['name']} did not have enough Influence cards for {card['name']} ({' '.join(h_notes)})."
            add_log(state, msg, "encounter")

        if emit_dice_event:
            add_dice_event(
                state,
                kind="demand",
                title=f"📜 DEMAND ROLL: {card['name']}",
                subtitle=f"{player['name']} rolls ® Influence Cards demanded",
                groups=[{
                    "rollerName": player["name"],
                    "rollerType": "player",
                    "colorName": player["color"],
                    "flatBonus": 0,
                    "totalLabel": f"Rolled {r_rom} ({given} Given)",
                    "dice": [{"value": r, "roman": r_rom, "sign": 1, "label": "Demand ®", "color": player["color"]}],
                }],
                outcome_title=f"ROLLED {r_rom} INFLUENCE",
                outcome_message=msg,
            )
        return True, msg

    mult = int(demand_state.get("cashMultiplier", 4))
    amt = r * mult
    if player["cash"] >= amt:
        player["cash"] -= amt
        state["lastStolenCash"] = amt
        f_notes = apply_favor_list(
            player,
            card.get("friendlyFavor", []),
            reason=f"paying {amt}(d) to {card['name']}",
        )
        msg = f"{player['name']} paid {amt}(d) to {card['name']}. {' '.join(f_notes)}".strip()
        add_log(state, msg, "encounter")
    elif "all (d)" in note_text or combat_threat:
        paid = player["cash"]
        player["cash"] = 0
        state["lastStolenCash"] = paid
        h_notes = apply_favor_list(
            player,
            hostile_favor_list,
            reason=f"unable to pay full demand to {card['name']}",
        )
        msg = f"{player['name']} only had {paid}(d) for {card['name']} (avoided combat, took {' '.join(h_notes)})."
        add_log(state, msg, "encounter")
    else:
        h_notes = apply_favor_list(
            player,
            hostile_favor_list,
            reason=f"unable to pay {amt}(d) request to {card['name']}",
        )
        msg = f"{player['name']} had less than {amt}(d) for {card['name']} ({' '.join(h_notes)})."
        add_log(state, msg, "encounter")

    if emit_dice_event:
        add_dice_event(
            state,
            kind="demand",
            title=f"🪙 DEMAND ROLL: {card['name']}",
            subtitle=f"{player['name']} rolls ® × {mult}(d)",
            groups=[{
                "rollerName": player["name"],
                "rollerType": "player",
                "colorName": player["color"],
                "flatBonus": 0,
                "totalLabel": f"{r_rom} × {mult}d = {amt}(d)",
                "dice": [{"value": r, "roman": r_rom, "sign": 1, "label": "Bribe ®", "color": player["color"]}],
            }],
            outcome_title=f"ROLLED {r_rom} → {amt}(d)",
            outcome_message=msg,
        )
    return True, msg


def _get_gamble_roll_preview(player: Dict[str, Any], gamble_state: Dict[str, Any]) -> str:
    rolls = [int(x) for x in (gamble_state.get("gambleRolls") or [0])]
    bet = int(gamble_state.get("bet", 0))
    mult = sum(rolls)
    payout = bet * mult
    net = payout - bet
    rom_list = " + ".join(roman_die_str(x) for x in rolls)
    return f"Wager {bet}(d) • Rolled {rom_list} ({mult}×) → Payout {payout}(d) ({'+' if net >= 0 else ''}{net}d net)!"


def _does_bot_want_post_gamble_intervention(state: Dict[str, Any], player: Dict[str, Any], gamble_state: Dict[str, Any]) -> bool:
    rolls = [int(x) for x in (gamble_state.get("gambleRolls") or [0])]
    bet = int(gamble_state.get("bet", 0))
    max_r = max(rolls) if rolls else 0
    if player.get("isBot") and sum(rolls) == 0 and bet >= 3 and _get_player_twist_of_fate_cards(player):
        return True
    if (max_r >= 3 and bet >= 3) or (max_r >= 2 and bet >= 5):
        is_extreme = (max_r >= 3 and bet >= 4) or (bet * sum(rolls) >= 12)
        for bot in _iter_bots_after_player(state, player):
            if _get_player_twist_of_fate_cards(bot) and _should_bot_target_adversarially(state, bot, player, is_extreme_luck=is_extreme):
                return True
    return False


def _run_bot_post_gamble_interventions(state: Dict[str, Any], player: Dict[str, Any], gamble_state: Dict[str, Any]) -> bool:
    if int(gamble_state.get("botInterventions", 0)) >= 2:
        return False
    rolls = [int(x) for x in (gamble_state.get("gambleRolls") or [0])]
    bet = int(gamble_state.get("bet", 0))
    cell = gamble_state.get("cell", "Stadium")

    if player.get("isBot") and sum(rolls) == 0 and bet >= 3:
        tof_self = next((c for c in player["influence"] if "Twist Of Fate" in str(c.get("name", ""))), None)
        if tof_self:
            player["influence"].remove(tof_self)
            state["decks"]["influence"].append(tof_self)
            state["hourEffects"]["lastInfluencePlayed"] = tof_self
            _inc_player_stat(player, "influencePlayed", 1)
            new_r = roll_rome_die()
            rolls[0] = new_r
            gamble_state["gambleRolls"] = rolls
            gamble_state["previewText"] = _get_gamble_roll_preview(player, gamble_state)
            gamble_state["botInterventions"] = int(gamble_state.get("botInterventions", 0)) + 1
            gamble_state["passedIntervenors"] = []
            rom_list = " + ".join(roman_die_str(x) for x in rolls)
            note = f"{player['name']} played 'Twist Of Fate' to re-roll their 0 Stadium Gambling die (0 -> {roman_die_str(new_r)})!"
            add_log(state, note, "action")
            add_dice_event(
                state,
                kind="gamble",
                title=f"🎲 TWIST OF FATE RE-ROLL (STADIUM {cell}) — {player['name']}",
                subtitle=note,
                groups=[{
                    "rollerName": player["name"],
                    "rollerType": "player",
                    "colorName": player["color"],
                    "flatBonus": 0,
                    "totalLabel": f"Multiplier: {sum(rolls)}× ({bet * sum(rolls)}d)",
                    "dice": [
                        {"value": x, "roman": roman_die_str(x), "sign": 1, "label": "Re-rolled ®" if i == 0 else f"Gamble ® #{i+1}", "color": player["color"]}
                        for i, x in enumerate(rolls)
                    ],
                }],
                outcome_title=f"RE-ROLLED {rom_list} → {sum(rolls)}× ({bet * sum(rolls)}d)",
                outcome_message=gamble_state["previewText"],
            )
            return True

    max_r = max(rolls) if rolls else 0
    if (max_r >= 3 and bet >= 3) or (max_r >= 2 and bet >= 5):
        is_extreme = (max_r >= 3 and bet >= 4) or (bet * sum(rolls) >= 12)
        for bot in _iter_bots_after_player(state, player):
            tof = next((c for c in bot["influence"] if "Twist Of Fate" in str(c.get("name", ""))), None)
            if not tof:
                continue
            if not _should_bot_target_adversarially(state, bot, player, is_extreme_luck=is_extreme):
                continue
            die_idx = rolls.index(max_r)
            old_r = rolls[die_idx]
            new_r = roll_rome_die()
            bot["influence"].remove(tof)
            state["decks"]["influence"].append(tof)
            state["hourEffects"]["lastInfluencePlayed"] = tof
            _inc_player_stat(bot, "influencePlayed", 1)
            rolls[die_idx] = new_r
            gamble_state["gambleRolls"] = rolls
            gamble_state["previewText"] = _get_gamble_roll_preview(player, gamble_state)
            gamble_state["botInterventions"] = int(gamble_state.get("botInterventions", 0)) + 1
            gamble_state["passedIntervenors"] = []
            rom_list = " + ".join(roman_die_str(x) for x in rolls)
            note = f"{bot['name']} played 'Twist Of Fate' against {player['name']}'s lucky {roman_die_str(old_r)} Stadium Gambling roll ({roman_die_str(old_r)} -> {roman_die_str(new_r)})!"
            add_log(state, note, "action")
            add_dice_event(
                state,
                kind="gamble",
                title=f"🎲 TWIST OF FATE RE-ROLL (STADIUM {cell}) — {player['name']}",
                subtitle=note,
                groups=[{
                    "rollerName": player["name"],
                    "rollerType": "player",
                    "colorName": player["color"],
                    "flatBonus": 0,
                    "totalLabel": f"Multiplier: {sum(rolls)}× ({bet * sum(rolls)}d)",
                    "dice": [
                        {"value": x, "roman": roman_die_str(x), "sign": 1, "label": "Re-rolled ®" if i == die_idx else f"Gamble ® #{i+1}", "color": player["color"]}
                        for i, x in enumerate(rolls)
                    ],
                }],
                outcome_title=f"RE-ROLLED {rom_list} → {sum(rolls)}× ({bet * sum(rolls)}d)",
                outcome_message=gamble_state["previewText"],
            )
            return True
    return False


def _apply_gamble_roll_outcome(
    state: Dict[str, Any],
    player: Dict[str, Any],
    gamble_state: Dict[str, Any],
    emit_dice_event: bool = True,
) -> Tuple[bool, str]:
    rolls = [int(x) for x in (gamble_state.get("gambleRolls") or [0])]
    bet = int(gamble_state.get("bet", 0))
    curr_cell = gamble_state.get("cell", player.get("position") or "Stadium")
    mult = sum(rolls)
    payout = bet * mult
    player["cash"] += payout
    net = payout - bet
    rom_list = " + ".join(roman_die_str(x) for x in rolls)
    state["pendingEncounter"] = None
    msg = f"STADIUM GAMBLING in {curr_cell}: {player['name']} wagered {bet}(d), rolled ®={rom_list} ({mult}x) -> received {payout}(d) ({'+' if net >= 0 else ''}{net}d net)!"
    add_log(state, msg, "action")
    if emit_dice_event:
        add_dice_event(
            state,
            kind="gamble",
            title=f"🎲 STADIUM GAMBLING ({curr_cell}) — {player['name']}",
            subtitle=f"Wager: {bet}(d) • 0: Lose • I: 1× • II: 2× • III: 3×",
            groups=[{
                "rollerName": player["name"],
                "rollerType": "player",
                "colorName": player["color"],
                "flatBonus": 0,
                "totalLabel": f"Multiplier: {mult}× ({payout}d)",
                "dice": [
                    {"value": x, "roman": roman_die_str(x), "sign": 1, "label": f"Gamble ® #{i+1}", "color": player["color"]}
                    for i, x in enumerate(rolls)
                ],
            }],
            outcome_title=f"ROLLED {rom_list} → {mult}× PAYOUT ({payout}d)",
            outcome_message=msg,
        )
    return True, f"Rolled {rom_list} ({mult}x) — payout {payout}(d)!"


def resolve_pending_encounter_choice(
    state: Dict[str, Any],
    player: Dict[str, Any],
    pending: Dict[str, Any],
    decision: str,
    use_consumable_ids: Optional[List[str]] = None,
) -> Tuple[bool, str]:
    """
    decision: 'fulfill' | 'refuse' | 'fight' | 'use_dog' | 'use_plea' | 'use_casus_belli'
              | 'resolve_event' | 'roll_chart_encounter' | 'confirm_consumables_and_roll'
              | 'finalize_combat' | 'roll_driver_fate' | 'finalize_driver_fate'
              | 'finalize_chart_roll' | 'finalize_demand_roll' | 'finalize_gamble_roll'
    """
    stage = pending.get("stage", "pre_decision")
    cur_actor_idx = pending.get("interveningPlayerIndex")
    if cur_actor_idx is None:
        cur_actor_idx = player["index"]

    # Stage 0A: Resolving a non-person Encounter Event card (Salve!, Brutta Figura, Procession, Ushered Along, Road Blocked)
    if stage == "event_pre_resolve":
        card_ev = pending.get("card") or {}
        cname = str(card_ev.get("name", "Encounter"))
        enc_code = str(pending.get("encCode") or f"{pending.get('deck', 'patricii')}_{pending.get('xCount', 1)}")
        src_lbl = pending.get("encounterSource")
        state["pendingEncounter"] = None

        if "Salve" in cname:
            player["tempFavor"] = player.get("tempFavor", 0) + 1
            add_log(state, f"{player['name']} resolved '{cname}' (+1 temporary Favor for next encounter) and draws again!", "encounter")
            trigger_deck_encounter(state, player, enc_code, source_label=src_lbl)
            return True, f"'{cname}': +1 temporary Favor — drawing next encounter!"
        if "Brutta" in cname:
            player["tempFavor"] = player.get("tempFavor", 0) - 1
            add_log(state, f"{player['name']} resolved '{cname}' (-1 temporary Favor for next encounter) and draws again!", "encounter")
            trigger_deck_encounter(state, player, enc_code, source_label=src_lbl)
            return True, f"'{cname}': -1 temporary Favor — drawing next encounter!"
        if "Procession" in cname:
            player["skipTurns"] = player.get("skipTurns", 0) + 1
            player["turnStep"] = "done"
            add_log(state, f"{player['name']} resolved '{cname}'! Cart is halted by a religious procession — loses next turn.", "encounter")
            return True, f"'{cname}' resolved — loses next turn."
        if "Ushered" in cname:
            player["movesRemaining"] = player.get("movesRemaining", 0) + 1
            player["turnStep"] = "start"
            add_log(state, f"{player['name']} resolved '{cname}'! Must immediately move to another accessible neighborhood.", "encounter")
            return True, f"'{cname}' resolved — you must move again!"
        if "Road Blocked" in cname:
            move_info = state.get("pendingPostEncounterMove")
            if move_info and move_info.get("playerIndex") == player["index"]:
                state["pendingPostEncounterMove"] = None
                player["movesRemaining"] = 0
                player["turnStep"] = "done"
                add_log(state, f"{player['name']} resolved 'Road Blocked' on edge — stays on {player.get('position')} and ends turn.", "encounter")
                return True, f"Road Blocked on edge — staying on {player.get('position')} and ending turn."
            state["pendingPostEncounterRefresh"] = None
            prev = player.get("previousPosition")
            if prev:
                player["position"] = prev
                player["movesRemaining"] = 0
                player["turnStep"] = "done"
                add_log(state, f"{player['name']} resolved 'Road Blocked'! Forced to turn around to {prev} and end turn.", "encounter")
                return True, f"Road Blocked — turned around to {prev} and ended turn."
            player["movesRemaining"] = 0
            player["turnStep"] = "done"
            add_log(state, f"{player['name']} resolved 'Road Blocked'! Turn ends immediately.", "encounter")
            return True, "Road Blocked — turn ended."
        return True, f"Resolved '{cname}'."

    # Stage 0B: Rolling / Resolving a Table Encounter (Angry Mob, Theater Troupe, Soothsayer) after presenting the encounter
    if stage == "chart_pre_roll":
        c_type = str(pending.get("chartType") or "mob")
        src_lbl = pending.get("encounterSource")
        sooth_goal = pending.get("soothsayerMission")
        state["pendingEncounter"] = None
        resolve_table_encounter(
            state,
            player,
            c_type,
            source_label=src_lbl,
            from_pre_roll=True,
            pre_drawn_sooth_goal=sooth_goal,
        )
        return True, f"Resolved {c_type.capitalize()} encounter."

    # Stage 0C: Pre-Combat Consumable ("destroyed if used") Weapon Opt-In
    if stage == "combat_consumable_pre_roll":
        chosen_ids = list(use_consumable_ids) if use_consumable_ids is not None else []
        c_card = pending["card"]
        c_x = int(pending.get("xCount", 1))
        c_src = pending.get("encounterSource")
        was_ref = bool(pending.get("wasRefusedDemand"))
        state["pendingEncounter"] = None
        execute_combat(
            state,
            player,
            c_card,
            c_x,
            source_label=c_src,
            use_consumable_ids=chosen_ids,
            was_refused_demand=was_ref,
        )
        return True, "Combat dice rolled!"

    # Stage 2: Finalizing Combat after post-roll Influence opportunity
    if stage == "combat_post_roll" or decision == "finalize_combat":
        passed = pending.setdefault("passedIntervenors", [])
        if cur_actor_idx not in passed:
            passed.append(cur_actor_idx)
        if pending.pop("humanModifiedSinceBotCheck", False):
            _run_bot_post_combat_interventions(state, player, pending)
        next_int = _find_human_intervenor_for_post_combat(state, player, pending.get("passedIntervenors"))
        if next_int is not None:
            pending["interveningPlayerIndex"] = next_int["index"]
            state["pendingEncounter"] = pending
            return True, f"Waiting for {next_int['name']} to respond to the Combat roll."
        res = _finalize_combat_after_post_roll(state, player, pending)
        if state.get("pendingEncounter") and state["pendingEncounter"].get("stage") in ("driver_fate_pre_roll", "driver_fate_post_roll"):
            return True, "Combat Defeat — Driver was wounded! Resolving Driver Fate (Death) Chart."
        return True, f"Combat finalized ({res.get('playerCP', 0)} CP vs. {res.get('oppCP', 0)} CP)."

    # Stage 3A: Rolling the Driver Fate (Death Chart) die
    if stage == "driver_fate_pre_roll" or decision == "roll_driver_fate":
        d_roll = roll_rome_die()
        d_rom = roman_die_str(d_roll)
        preview_txt = _get_chart_roll_preview(player, "death", d_roll)
        bot_wants = _does_bot_want_post_chart_intervention(state, player, "death", d_roll)
        intervenor = _find_human_intervenor_for_post_chart(state, player, "death")

        if bot_wants or intervenor is not None:
            pending["stage"] = "driver_fate_post_roll"
            pending["chartType"] = "death"
            pending["chartRoll"] = d_roll
            pending["previewText"] = preview_txt
            pending["passedIntervenors"] = []
            pending["botInterventions"] = 0
            add_dice_event(
                state,
                kind="driver_fate",
                title=f"💀 DRIVER FATE (DEATH CHART) — {player['name']}",
                subtitle="0: Dead (Lose Goods & End Night) • I: Left for Dead (Lose Goods) • II: Mugged (Lose Cash) • III: Mercy (Lose Influence)",
                groups=[{
                    "rollerName": f"{player['name']} (Wounded Driver)",
                    "rollerType": "player",
                    "colorName": player["color"],
                    "flatBonus": 0,
                    "totalLabel": f"Rolled {d_rom}",
                    "dice": [{"value": d_roll, "roman": d_rom, "sign": 0, "label": "Driver Fate ®", "color": player["color"]}],
                }],
                outcome_title=f"DRIVER FATE: {d_rom}",
                outcome_message=preview_txt,
            )
            _run_bot_post_chart_interventions(state, player, pending)
            intervenor = _find_human_intervenor_for_post_chart(state, player, "death", pending["passedIntervenors"])
            if intervenor is not None:
                avail_chart_cards = _get_player_post_chart_influence(intervenor, "death", is_self=(intervenor["index"] == player["index"]))
                card_names = ", ".join(c["name"] for c in avail_chart_cards)
                pending["interveningPlayerIndex"] = intervenor["index"]
                if state.get("diceEvents"):
                    last_ev = state["diceEvents"][-1]
                    cur_rom = roman_die_str(int(pending["chartRoll"]))
                    last_ev["outcomeTitle"] = f"ROLLED {cur_rom} (INFLUENCE AVAILABLE)"
                    last_ev["outcomeMessage"] = pending["previewText"]
                    last_ev["outcomeDetail"] = pending["previewText"]
                    last_ev["secretIntervenorIndex"] = intervenor["index"]
                    last_ev["secretCardNames"] = card_names
                    last_ev["secretIntervenorName"] = intervenor["name"]
                state["pendingEncounter"] = pending
                return True, f"Driver Fate rolled {roman_die_str(int(pending['chartRoll']))} — waiting on {intervenor['name']} (Influence response window)."
            d_rom_fin, driver_outcome = _apply_driver_fate_outcome(state, player, int(pending["chartRoll"]), pending)
            return True, f"Driver Fate rolled {d_rom_fin}: {driver_outcome}"

        _, driver_outcome = _apply_driver_fate_outcome(state, player, d_roll, pending)
        add_dice_event(
            state,
            kind="driver_fate",
            title=f"💀 DRIVER FATE (DEATH CHART) — {player['name']}",
            subtitle="0: Dead (Lose Goods & End Night) • I: Left for Dead (Lose Goods) • II: Mugged (Lose Cash) • III: Mercy (Lose Influence)",
            groups=[{
                "rollerName": f"{player['name']} (Wounded Driver)",
                "rollerType": "player",
                "colorName": player["color"],
                "flatBonus": 0,
                "totalLabel": f"Rolled {d_rom}",
                "dice": [{"value": d_roll, "roman": d_rom, "sign": 0, "label": "Driver Fate ®", "color": player["color"]}],
            }],
            outcome_title=f"DRIVER FATE: {d_rom}",
            outcome_message=f"Driver wounded (rolled ®={d_rom} -> {driver_outcome})",
        )
        return True, f"Driver Fate rolled {d_rom}: {driver_outcome}"

    # Stage 3B: Finalizing Driver Fate after post-roll Influence opportunity
    if stage == "driver_fate_post_roll" or decision == "finalize_driver_fate":
        passed = pending.setdefault("passedIntervenors", [])
        if cur_actor_idx not in passed:
            passed.append(cur_actor_idx)
        if pending.pop("humanModifiedSinceBotCheck", False):
            _run_bot_post_chart_interventions(state, player, pending)
        next_int = _find_human_intervenor_for_post_chart(state, player, "death", pending.get("passedIntervenors"))
        if next_int is not None:
            pending["interveningPlayerIndex"] = next_int["index"]
            state["pendingEncounter"] = pending
            return True, f"Waiting for {next_int['name']} to respond to the Driver Fate roll."
        d_roll = int(pending.get("chartRoll", 0))
        d_rom, driver_outcome = _apply_driver_fate_outcome(state, player, d_roll, pending)
        return True, f"Driver Fate confirmed ({d_rom}): {driver_outcome}"

    # Stage 4: Finalizing Angry Mob / Theater Troupe / Soothsayer Chart Roll after post-roll Influence opportunity
    if stage == "chart_post_roll" or decision == "finalize_chart_roll":
        c_type = pending.get("chartType", "mob")
        passed = pending.setdefault("passedIntervenors", [])
        if cur_actor_idx not in passed:
            passed.append(cur_actor_idx)
        if pending.pop("humanModifiedSinceBotCheck", False):
            _run_bot_post_chart_interventions(state, player, pending)
            if pending.get("ignoredBySelfCard") == "mob":
                state["pendingEncounter"] = None
                return True, "Angry Mob ignored."
            if pending.get("ignoredBySelfCard") == "theater":
                state["pendingEncounter"] = None
                _apply_table_encounter_outcome(state, player, "theater", 3, emit_dice_event=True)
                return True, "Theater Troupe resolved."
        next_int = _find_human_intervenor_for_post_chart(state, player, c_type, pending.get("passedIntervenors"))
        if next_int is not None:
            pending["interveningPlayerIndex"] = next_int["index"]
            state["pendingEncounter"] = pending
            return True, f"Waiting for {next_int['name']} to respond to the {c_type.capitalize()} roll."
        c_roll = int(pending.get("chartRoll", 0))
        sooth_m = pending.get("soothsayerMission")
        state["pendingEncounter"] = None
        _apply_table_encounter_outcome(state, player, c_type, c_roll, emit_dice_event=False, soothsayer_mission=sooth_m)
        return True, f"{c_type.capitalize()} encounter resolved."

    # Stage 5: Finalizing Demand Roll (e.g. Scorpus / Sabinus) after Twist Of Fate intervention opportunity
    if stage == "demand_post_roll" or decision == "finalize_demand_roll":
        passed = pending.setdefault("passedIntervenors", [])
        if cur_actor_idx not in passed:
            passed.append(cur_actor_idx)
        if pending.pop("humanModifiedSinceBotCheck", False):
            _run_bot_post_demand_interventions(state, player, pending)
        next_int = _find_human_intervenor_for_twist_of_fate(state, player, pending.get("passedIntervenors"))
        if next_int is not None:
            pending["interveningPlayerIndex"] = next_int["index"]
            state["pendingEncounter"] = pending
            return True, f"Waiting for {next_int['name']} to respond to the Demand roll."
        return _apply_demand_roll_outcome(state, player, pending, emit_dice_event=False)

    # Stage 6: Finalizing Stadium Gambling Roll after Twist Of Fate intervention opportunity
    if stage == "gamble_post_roll" or decision == "finalize_gamble_roll":
        passed = pending.setdefault("passedIntervenors", [])
        if cur_actor_idx not in passed:
            passed.append(cur_actor_idx)
        if pending.pop("humanModifiedSinceBotCheck", False):
            _run_bot_post_gamble_interventions(state, player, pending)
        next_int = _find_human_intervenor_for_twist_of_fate(state, player, pending.get("passedIntervenors"))
        if next_int is not None:
            pending["interveningPlayerIndex"] = next_int["index"]
            state["pendingEncounter"] = pending
            return True, f"Waiting for {next_int['name']} to respond to the Gambling roll."
        return _apply_gamble_roll_outcome(state, player, pending, emit_dice_event=False)

    card = pending["card"]
    deck_key = pending.get("deck", (card.get("deck") or "patricii").lower())
    x_count = pending["xCount"]
    enc_src = pending.get("encounterSource")
    state.pop("_lastEncounterSource", None)
    # Re-evaluate pending state in case player played an Influence card while encounter was open
    refreshed = _build_pending_encounter_state(state, player, card, deck_key, x_count, source_label=enc_src)
    reaction = refreshed["reaction"]
    matched_tier = refreshed.get("matchedTier") or {}
    action_text = card.get("actionText", "")

    if player.get("isBot") and refreshed["combatMandatory"]:
        state["pendingEncounter"] = None
        execute_combat(state, player, card, x_count, source_label=enc_src)
        return True, "Combat dice rolled!"

    if decision == "use_casus_belli":
        cb = next((c for c in player["influence"] if "Casus Belli" in c.get("name", "")), None)
        if not cb:
            return False, "You do not have 'Casus Belli' in your hand."
        player["influence"].remove(cb)
        state["decks"]["influence"].append(cb)
        state["hourEffects"]["lastInfluencePlayed"] = cb
        _inc_player_stat(player, "influencePlayed", 1)
        player["turnEffects"]["casusBelli"] = True
        add_log(state, f"{player['name']} played 'Casus Belli' to initiate combat against {card['name']}!", "encounter")
        state["pendingEncounter"] = None
        was_ref_cb = bool(refreshed["combatThreatened"] and not refreshed["combatMandatory"])
        execute_combat(
            state,
            player,
            card,
            x_count,
            source_label=enc_src,
            use_consumable_ids=use_consumable_ids,
            was_refused_demand=was_ref_cb,
        )
        return True, f"Played 'Casus Belli' and initiated combat against {card['name']}!"

    if decision == "fight":
        if not refreshed["canInitiateCombat"]:
            return (
                False,
                "Combat cannot be initiated when combat is not threatened by the encountered party (unless unlocked by a combat-requiring Mission or 'Casus Belli').",
            )
        state["pendingEncounter"] = None
        was_ref_fight = bool(refreshed["combatThreatened"] and not refreshed["combatMandatory"])
        execute_combat(
            state,
            player,
            card,
            x_count,
            source_label=enc_src,
            use_consumable_ids=use_consumable_ids,
            was_refused_demand=was_ref_fight,
        )
        return True, "Combat dice rolled!"

    if refreshed["combatMandatory"] and decision not in ("fight", "use_casus_belli"):
        return False, f"{card['name']} is hostile (Favor {refreshed['favorScore']}) and initiates Combat! Click the Combat section on the card to fight."

    state["pendingEncounter"] = None
    player["tempFavor"] = 0

    if decision == "use_dog":
        dog = next((c for c in player["influence"] if "Trained Dog" in c.get("name", "")), None)
        if dog:
            player["influence"].remove(dog)
            state["decks"]["influence"].append(dog)
            state["hourEffects"]["lastInfluencePlayed"] = dog
            _inc_player_stat(player, "influencePlayed", 1)
            f_notes = apply_favor_list(
                player,
                card.get("friendlyFavor", []),
                reason=f"satisfying {card['name']}'s demand with Trained Dog",
            )
            add_log(state, f"{player['name']} played 'Trained Dog' to satisfy {card['name']}'s demand for Denarii! {' '.join(f_notes)}", "encounter")
            return True, "Played 'Trained Dog' to satisfy demand."

    if decision == "use_plea":
        plea = next((c for c in player["influence"] if "Plea" in c.get("name", "")), None)
        if plea:
            player["influence"].remove(plea)
            state["decks"]["influence"].append(plea)
            state["hourEffects"]["lastInfluencePlayed"] = plea
            _inc_player_stat(player, "influencePlayed", 1)
            f_notes = apply_favor_list(
                player,
                card.get("friendlyFavor", []),
                reason=f"satisfying {card['name']}'s demand with Plea",
            )
            add_log(state, f"{player['name']} played 'Plea' to satisfy {card['name']}'s demand for Goods! {' '.join(f_notes)}", "encounter")
            return True, "Played 'Plea' to satisfy demand."

    # Cash Reward tier (e.g., 3(d), 6(d), 7(d), 12(d))
    if reaction == "cash_reward":
        if decision == "refuse":
            add_log(state, f"{player['name']} declined {card['name']}'s gift.", "encounter")
            return True, "Declined gift."
        tier_reward = matched_tier.get("reward") or card.get("friendlyReward") or "4(d)"
        r_notes = grant_reward(state, player, None, tier_reward)
        f_notes = apply_favor_list(
            player,
            card.get("friendlyFavor", []),
            reason=f"receiving patronage from {card['name']}",
        )
        add_log(state, f"{player['name']} received patronage from {card['name']} ({tier_reward})! {' '.join(r_notes + f_notes)}", "encounter")
        return True, f"Collected {tier_reward}."

    is_offer_reaction = (
        reaction in ("offer", "mission_offer", "mission_bonus", "quest_optional", "deck_quest_offer", "cash_reward")
    ) or (
        action_text.strip().startswith("?")
        and reaction not in ("deck_quest_demand", "demand", "demand_strict", "mission_request", "mission_strict")
    )
    hostile_favor_list = card.get("hostileFavor") or ([f"-{card['faction']}"] if card.get("faction") else [])

    # Deck Quest Demand (🃏📦!) or Deck Quest Offer (🃏📦?)
    if reaction in ("deck_quest_demand", "deck_quest_offer"):
        if decision == "refuse":
            if reaction == "deck_quest_offer":
                add_log(state, f"{player['name']} politely declined {card['name']}'s optional Deck Quest offer.", "encounter")
                return True, "Declined optional Deck Quest offer."
            if refreshed["combatThreatened"]:
                execute_combat(
                    state,
                    player,
                    card,
                    x_count,
                    source_label=enc_src,
                    use_consumable_ids=use_consumable_ids,
                    was_refused_demand=True,
                )
                return True, "Refused mandatory Deck Quest threat — Combat initiated!"
            h_notes = apply_favor_list(
                player,
                hostile_favor_list,
                reason=f"refusing Deck Quest demand from {card['name']}",
            )
            pen_str = " and ".join(f"{n} Favor" for n in h_notes) if h_notes else "no Favor penalty"
            add_log(state, f"{player['name']} refused {card['name']}'s Deck Quest demand ({pen_str}).", "encounter")
            return True, f"Refused {card['name']}'s Deck Quest demand ({pen_str})."

        sooth_cnt = sum(1 for m in player["missions"] if m.get("source") == "soothsayer")
        non_sooth_cnt = len(player["missions"]) - sooth_cnt
        if state["decks"]["missiones"] and non_sooth_cnt < 5:
            drawn_m = copy.deepcopy(state["decks"]["missiones"].pop(0))
            drawn_m["source"] = "encounter"
            drawn_m["hasDrawnMissionCard"] = True
            drawn_m["encounterCard"] = _prepare_attached_encounter_card(state, card)
            drawn_m["patronName"] = card["name"]
            drawn_m["patronFaction"] = card.get("faction")
            drawn_m["patronRewardText"] = card.get("friendlyReward") or ""
            combined_fav = list((drawn_m.get("favor") or []) + (card.get("friendlyFavor") or []))
            drawn_m["favor"] = combined_fav
            drawn_m["hostileFavor"] = copy.deepcopy(hostile_favor_list)
            player["missions"].append(drawn_m)
            add_log(
                state,
                f"{player['name']} accepted a Deck Quest from {card['name']} and drew Mission '{drawn_m['name']}'!",
                "mission",
            )
            check_passive_missions(state, player)
            return True, f"Accepted Deck Quest from {card['name']}: drew '{drawn_m['name']}'!"
        add_log(state, f"{player['name']} accepted {card['name']}'s Deck Quest (Mission hand full or deck empty).", "mission")
        return True, "Deck Quest resolved."

    # Check if this card is an immediate NPC Purchase/Sale Offer ("?: Will Sell..." or "?: Will Buy..." with no delivery cell)
    m_raw = card.get("mission") or {}
    is_npc_buy_offer = (m_raw.get("kind") == "buy_from_npc") or ("will sell" in action_text.lower())
    is_npc_sell_offer = (
        m_raw.get("kind") == "sell"
        and not m_raw.get("deliverCell")
        and not m_raw.get("cell")
        and ("will buy" in action_text.lower() or reaction == "offer")
    )

    if is_npc_buy_offer or is_npc_sell_offer:
        if decision == "refuse":
            if is_offer_reaction:
                add_log(state, f"{player['name']} politely declined {card['name']}'s offer.", "encounter")
                return True, "Declined offer."
            if reaction in ("demand_strict", "mission_strict") or (
                refreshed["combatThreatened"]
                and reaction not in ("offer", "mission_offer", "mission_bonus", "demand", "mission_request")
            ):
                execute_combat(
                    state,
                    player,
                    card,
                    x_count,
                    source_label=enc_src,
                    use_consumable_ids=use_consumable_ids,
                    was_refused_demand=True,
                )
                return True, "Refused demand — Combat initiated!"
            if reaction in ("demand", "mission_request"):
                h_notes = apply_favor_list(
                    player,
                    hostile_favor_list,
                    reason=f"refusing demand from {card['name']}",
                )
                pen_str = " and ".join(f"{n} Favor" for n in h_notes) if h_notes else "no Favor penalty"
                add_log(state, f"{player['name']} refused {card['name']}'s demand ({pen_str}).", "encounter")
                return True, f"Refused {card['name']}'s demand ({pen_str})."
            add_log(state, f"{player['name']} politely declined {card['name']}'s offer.", "encounter")
            return True, "Declined offer."
        return _start_npc_offer(state, player, card, is_buy_offer=is_npc_buy_offer)

    # Mission request / demand / strict threat / bonus offer
    if card.get("mission") or not action_text.strip():
        is_strict_m = (reaction in ("demand_strict", "mission_strict")) or (
            not card.get("reactions") and action_text.strip().startswith("!!")
        )
        is_optional_m = is_offer_reaction
        if decision == "refuse":
            if is_strict_m and not is_optional_m:
                execute_combat(
                    state,
                    player,
                    card,
                    x_count,
                    source_label=enc_src,
                    use_consumable_ids=use_consumable_ids,
                    was_refused_demand=True,
                )
                return True, "Refused mandatory mission threat — Combat initiated!"
            if is_optional_m:
                add_log(state, f"{player['name']} politely declined {card['name']}'s optional mission offer.", "encounter")
                return True, "Declined mission offer."
            h_notes = apply_favor_list(
                player,
                hostile_favor_list,
                reason=f"refusing mission demand from {card['name']}",
            )
            pen_str = " and ".join(f"{n} Favor" for n in h_notes) if h_notes else "no Favor penalty"
            add_log(state, f"{player['name']} refused {card['name']}'s mission demand ({pen_str}).", "encounter")
            return True, f"Refused {card['name']}'s mission demand ({pen_str})."

        # Check if this is a Quest card that draws from the Missiones deck (no embedded mission on card)
        sooth_cnt = sum(1 for m in player["missions"] if m.get("source") == "soothsayer")
        if not card.get("mission") and not action_text.strip():
            if state["decks"]["missiones"] and (len(player["missions"]) < 5 or (not player.get("isBot") and sooth_cnt < 5)):
                drawn_m = copy.deepcopy(state["decks"]["missiones"].pop(0))
                drawn_m["source"] = "encounter"
                drawn_m["hasDrawnMissionCard"] = True
                drawn_m["encounterCard"] = _prepare_attached_encounter_card(state, card)
                drawn_m["patronName"] = card["name"]
                drawn_m["patronFaction"] = card.get("faction")
                drawn_m["patronRewardText"] = card.get("friendlyReward") or ""
                drawn_m["favor"] = list((drawn_m.get("favor") or []) + (card.get("friendlyFavor") or []))
                drawn_m["hostileFavor"] = copy.deepcopy(hostile_favor_list)
                player["missions"].append(drawn_m)
                add_log(state, f"{player['name']} accepted a Quest from {card['name']} and drew Mission '{drawn_m['name']}'!", "mission")
                check_passive_missions(state, player)
                return True, f"Accepted Quest '{drawn_m['name']}'."
            return True, "Quest resolved."

        m_data = copy.deepcopy(card.get("mission") or {})
        raw_kind = m_data.get("kind", "sell")
        if raw_kind == "kill" and (m_data.get("target") or "").lower() == "the emperor" or "kill the emperor" in action_text.lower():
            raw_kind = "kill_emperor"
        norm_m_cell = normalize_cell_id(m_data.get("cell") or m_data.get("deliverCell")) or "C3"
        norm_p_cell = normalize_cell_id(m_data.get("pickupCell")) if m_data.get("pickupCell") else None
        norm_d_cell = normalize_cell_id(m_data.get("deliverCell")) if m_data.get("deliverCell") else None
        norm_act_txt = _normalize_relative_scarcity_text(action_text)
        if len(player["missions"]) < 5 or (not player.get("isBot") and sooth_cnt < 5):
            m_obj = {
                "id": f"enc_{card['id']}_{secrets.token_hex(2)}",
                "name": m_data.get("name") or f"{card['name']}'s Task",
                "source": "encounter",
                "hasDrawnMissionCard": False,
                "encounterCard": _prepare_attached_encounter_card(state, card),
                "patronName": card["name"],
                "patronFaction": card.get("faction"),
                "kind": raw_kind,
                "item": m_data.get("item", "Cargo"),
                "category": m_data.get("category", "Wine"),
                "modifier": normalize_scarcity_modifier(m_data.get("modifier") or "+"),
                "target": m_data.get("target"),
                "targetDeck": m_data.get("targetDeck"),
                "cell": norm_m_cell,
                "pickupCell": norm_p_cell,
                "deliverCell": norm_d_cell,
                "blocks": m_data.get("cargoSize") or m_data.get("blocks", 1),
                "fencedSell": m_data.get("payoutTable") or m_data.get("fencedSell"),
                "pickedUp": False,
                "completed": False,
                "description": norm_act_txt,
                "text": norm_act_txt,
                "rewardText": card.get("friendlyReward", "6(d)"),
                "reward": None,
                "favor": card.get("friendlyFavor", []),
                "hostileFavor": copy.deepcopy(hostile_favor_list),
            }
            player["missions"].append(m_obj)
            add_log(state, f"{player['name']} accepted Mission from {card['name']}: {norm_act_txt}", "mission")
            check_passive_missions(state, player)
        return True, f"Accepted mission from {card['name']}."

    # Offer (?)
    if is_offer_reaction:
        if decision == "refuse":
            add_log(state, f"{player['name']} politely declined {card['name']}'s offer.", "encounter")
            return True, "Declined offer."
        f_notes = apply_favor_list(
            player,
            card.get("friendlyFavor", []),
            reason=f"accepting offer from {card['name']}",
        )
        if "Move again" in action_text:
            player["movesRemaining"] = player.get("movesRemaining", 0) + 1
            player["turnStep"] = "start"
            add_log(state, f"{player['name']} accepted {card['name']}'s escort to move again this turn! {' '.join(f_notes)}", "encounter")
            return True, "Moving again this turn!"
        add_log(state, f"{player['name']} transacted with {card['name']} ({action_text}). {' '.join(f_notes)}", "encounter")
        return True, f"Transacted with {card['name']}."

    # Demand (!!) or Request (!)
    if decision == "refuse":
        if refreshed["combatThreatened"]:
            execute_combat(
                state,
                player,
                card,
                x_count,
                source_label=enc_src,
                use_consumable_ids=use_consumable_ids,
                was_refused_demand=True,
            )
            return True, "Refused demand — Combat initiated!"
        else:
            h_notes = apply_favor_list(
                player,
                hostile_favor_list,
                reason=f"refusing demand from {card['name']}",
            )
            pen_str = " and ".join(f"{n} Favor" for n in h_notes) if h_notes else "no Favor penalty"
            add_log(state, f"{player['name']} refused {card['name']}'s demand and suffered {pen_str}.", "encounter")
            return True, f"Refused {card['name']}'s demand ({pen_str})."

    # Fulfill Demand / Request
    clause_match = re.search(r"\((?![dDrR]\))", action_text)
    primary_text = action_text[:clause_match.start()].strip() if clause_match else action_text.strip()
    note_text = action_text[clause_match.start():].strip().lower() if clause_match else ""
    primary_low = primary_text.lower()
    low_txt = action_text.lower()

    if "influence" in primary_low:
        if not player["influence"] and "no demand" in note_text:
            add_log(state, f"{player['name']} had no Influence cards to give {card['name']} — demand ignored.", "encounter")
            return True, "No Influence cards to give — demand ignored."
        if "®" in primary_text or "(r)" in primary_low:
            r = roll_rome_die()
            demand_state = {
                "stage": "demand_post_roll",
                "playerIndex": player["index"],
                "card": copy.deepcopy(card),
                "deck": deck_key,
                "xCount": x_count,
                "encounterSource": enc_src,
                "demandKind": "influence",
                "demandRoll": r,
                "cashMultiplier": 4,
                "noteText": note_text,
                "combatThreatened": bool(refreshed["combatThreatened"]),
                "hostileFavorList": list(hostile_favor_list),
                "passedIntervenors": [],
                "botInterventions": 0,
            }
            demand_state["previewText"] = _get_demand_roll_preview(player, card, demand_state)
            bot_wants = _does_bot_want_post_demand_intervention(state, player, demand_state)
            intervenor = _find_human_intervenor_for_twist_of_fate(state, player)
            if bot_wants or intervenor is not None:
                r_rom = roman_die_str(r)
                add_dice_event(
                    state,
                    kind="demand",
                    title=f"📜 DEMAND ROLL: {card['name']}",
                    subtitle=f"{player['name']} rolls ® Influence Cards demanded",
                    groups=[{
                        "rollerName": player["name"],
                        "rollerType": "player",
                        "colorName": player["color"],
                        "flatBonus": 0,
                        "totalLabel": f"Rolled {r_rom}",
                        "dice": [{"value": r, "roman": r_rom, "sign": 1, "label": "Demand ®", "color": player["color"]}],
                    }],
                    outcome_title=f"ROLLED {r_rom} INFLUENCE",
                    outcome_message=demand_state["previewText"],
                )
                _run_bot_post_demand_interventions(state, player, demand_state)
                intervenor = _find_human_intervenor_for_twist_of_fate(state, player, demand_state["passedIntervenors"])
                if intervenor is not None:
                    demand_state["interveningPlayerIndex"] = intervenor["index"]
                    if state.get("diceEvents"):
                        last_ev = state["diceEvents"][-1]
                        cur_rom = roman_die_str(int(demand_state["demandRoll"]))
                        last_ev["outcomeTitle"] = f"ROLLED {cur_rom} INFLUENCE (INFLUENCE AVAILABLE)"
                        last_ev["outcomeMessage"] = demand_state["previewText"]
                        last_ev["outcomeDetail"] = demand_state["previewText"]
                        last_ev["secretIntervenorIndex"] = intervenor["index"]
                        last_ev["secretCardNames"] = "Twist Of Fate"
                        last_ev["secretIntervenorName"] = intervenor["name"]
                    state["pendingEncounter"] = demand_state
                    return True, demand_state["previewText"]
                return _apply_demand_roll_outcome(state, player, demand_state, emit_dice_event=False)
            return _apply_demand_roll_outcome(state, player, demand_state, emit_dice_event=True)

        if "all" in primary_low:
            cnt = len(player["influence"])
        elif "two" in primary_low:
            cnt = 2
        else:
            cnt = 1

        avail_inf = len(player["influence"])
        if avail_inf >= cnt:
            given = 0
            for _ in range(cnt):
                c = player["influence"].pop(0)
                state["decks"]["influence"].append(c)
                given += 1
            f_notes = apply_favor_list(
                player,
                card.get("friendlyFavor", []),
                reason=f"giving {given} Influence card(s) to {card['name']}",
            )
            msg = f"{player['name']} gave {given} Influence card(s) to {card['name']}. {' '.join(f_notes)}"
            add_log(state, msg, "encounter")
        elif "all card" in note_text or refreshed["combatThreatened"]:
            given = 0
            while player["influence"]:
                c = player["influence"].pop(0)
                state["decks"]["influence"].append(c)
                given += 1
            h_notes = apply_favor_list(
                player,
                hostile_favor_list,
                reason=f"unable to give full Influence demand to {card['name']}",
            )
            msg = f"{player['name']} only had {given} Influence card(s) for {card['name']} (avoided combat, took {' '.join(h_notes)})."
            add_log(state, msg, "encounter")
        else:
            h_notes = apply_favor_list(
                player,
                hostile_favor_list,
                reason=f"unable to give Influence card(s) to {card['name']}",
            )
            msg = f"{player['name']} did not have enough Influence cards for {card['name']} ({' '.join(h_notes)})."
            add_log(state, msg, "encounter")
        return True, msg

    if "(d)" in primary_text or "cash" in primary_low:
        if player["cash"] <= 0 and "no cash, no demand" in note_text:
            add_log(state, f"{player['name']} had no Cash for {card['name']} — demand ignored.", "encounter")
            return True, "No Cash — demand ignored."
        if "®" in primary_text or "(r)" in primary_low:
            m_mult = re.search(r"(\d+)\s*\(d\)", primary_text)
            cash_mult = int(m_mult.group(1)) if m_mult else 4
            r = roll_rome_die()
            demand_state = {
                "stage": "demand_post_roll",
                "playerIndex": player["index"],
                "card": copy.deepcopy(card),
                "deck": deck_key,
                "xCount": x_count,
                "encounterSource": enc_src,
                "demandKind": "cash",
                "demandRoll": r,
                "cashMultiplier": cash_mult,
                "noteText": note_text,
                "combatThreatened": bool(refreshed["combatThreatened"]),
                "hostileFavorList": list(hostile_favor_list),
                "passedIntervenors": [],
                "botInterventions": 0,
            }
            demand_state["previewText"] = _get_demand_roll_preview(player, card, demand_state)
            bot_wants = _does_bot_want_post_demand_intervention(state, player, demand_state)
            intervenor = _find_human_intervenor_for_twist_of_fate(state, player)
            if bot_wants or intervenor is not None:
                r_rom = roman_die_str(r)
                amt_init = r * cash_mult
                add_dice_event(
                    state,
                    kind="demand",
                    title=f"🪙 DEMAND ROLL: {card['name']}",
                    subtitle=f"{player['name']} rolls ® × {cash_mult}(d)",
                    groups=[{
                        "rollerName": player["name"],
                        "rollerType": "player",
                        "colorName": player["color"],
                        "flatBonus": 0,
                        "totalLabel": f"{r_rom} × {cash_mult}d = {amt_init}(d)",
                        "dice": [{"value": r, "roman": r_rom, "sign": 1, "label": "Bribe ®", "color": player["color"]}],
                    }],
                    outcome_title=f"ROLLED {r_rom} → {amt_init}(d)",
                    outcome_message=demand_state["previewText"],
                )
                _run_bot_post_demand_interventions(state, player, demand_state)
                intervenor = _find_human_intervenor_for_twist_of_fate(state, player, demand_state["passedIntervenors"])
                if intervenor is not None:
                    demand_state["interveningPlayerIndex"] = intervenor["index"]
                    if state.get("diceEvents"):
                        last_ev = state["diceEvents"][-1]
                        cur_r = int(demand_state["demandRoll"])
                        cur_rom = roman_die_str(cur_r)
                        last_ev["outcomeTitle"] = f"ROLLED {cur_rom} → {cur_r * cash_mult}(d) (INFLUENCE AVAILABLE)"
                        last_ev["outcomeMessage"] = demand_state["previewText"]
                        last_ev["outcomeDetail"] = demand_state["previewText"]
                        last_ev["secretIntervenorIndex"] = intervenor["index"]
                        last_ev["secretCardNames"] = "Twist Of Fate"
                        last_ev["secretIntervenorName"] = intervenor["name"]
                    state["pendingEncounter"] = demand_state
                    return True, demand_state["previewText"]
                return _apply_demand_roll_outcome(state, player, demand_state, emit_dice_event=False)
            return _apply_demand_roll_outcome(state, player, demand_state, emit_dice_event=True)

        if "half" in primary_low:
            amt = (player["cash"] + 1) // 2
        elif "all" in primary_low:
            amt = player["cash"]
        else:
            m = re.search(r"(\d+)\s*\(d\)", primary_text)
            amt = int(m.group(1)) if m else 4

        if player["cash"] >= amt:
            player["cash"] -= amt
            state["lastStolenCash"] = amt
            f_notes = apply_favor_list(
                player,
                card.get("friendlyFavor", []),
                reason=f"paying {amt}(d) to {card['name']}",
            )
            msg = f"{player['name']} paid {amt}(d) to {card['name']}. {' '.join(f_notes)}"
            add_log(state, msg, "encounter")
        elif "all (d)" in note_text or refreshed["combatThreatened"]:
            paid = player["cash"]
            player["cash"] = 0
            state["lastStolenCash"] = paid
            h_notes = apply_favor_list(
                player,
                hostile_favor_list,
                reason=f"unable to pay full demand to {card['name']}",
            )
            msg = f"{player['name']} only had {paid}(d) for {card['name']} (avoided combat, took {' '.join(h_notes)})."
            add_log(state, msg, "encounter")
        else:
            h_notes = apply_favor_list(
                player,
                hostile_favor_list,
                reason=f"unable to pay {amt}(d) request to {card['name']}",
            )
            msg = f"{player['name']} had less than {amt}(d) for {card['name']} ({' '.join(h_notes)})."
            add_log(state, msg, "encounter")
        return True, msg

    # Goods demand (e.g., Fine Wine, Wine, Grain, Exotic Animals, Weapons, Marble, Meat Animals, cheapest/most valuable)
    if not player["cart"]:
        if "receive thumbs-down" in note_text:
            h_notes = apply_favor_list(
                player,
                hostile_favor_list,
                reason=f"having no requested Goods for {card['name']}",
            )
            msg = f"{player['name']} had no Goods on their Cart for {card['name']} ({' '.join(h_notes)})."
            add_log(state, msg, "encounter")
            return True, msg
        add_log(state, f"{player['name']} had no Goods on their Cart for {card['name']} — demand ignored.", "encounter")
        return True, "No Goods on Cart — demand ignored."

    taken_items = []
    for cat in ("Fine Wine", "Cheap Wine", "Wine", "Grain", "Exotic Animals", "Meat Animals", "Animals", "Weapons", "Marble"):
        if cat.lower() in primary_low or cat.replace("Animals", "A").lower() in primary_low:
            matching = [c for c in player["cart"] if matches_category(c, cat)]
            if not matching:
                if "receive thumbs-down" in note_text:
                    h_notes = apply_favor_list(
                        player,
                        hostile_favor_list,
                        reason=f"having no {cat} for {card['name']}",
                    )
                    msg = f"{player['name']} has no {cat} on their Cart for {card['name']} ({' '.join(h_notes)})."
                    add_log(state, msg, "encounter")
                    return True, msg
                add_log(state, f"{player['name']} has no {cat} on their Cart — {card['name']}'s demand ignored.", "encounter")
                return True, f"No {cat} on Cart — demand ignored."
            if "all" in primary_low:
                taken_items = matching
            else:
                taken_items = [matching[0]]
            break

    if not taken_items and player["cart"]:
        if "cheapest" in primary_low:
            player["cart"].sort(key=_item_base_value)
        else:
            player["cart"].sort(key=_item_base_value, reverse=True)
        taken_items = [player["cart"][0]]

    for t in taken_items:
        if t in player["cart"]:
            _remove_cart_item(state, player, t, reason=f"handed over to {card['name']}")
            state["lastStolenGood"] = t

    names = ", ".join(t["name"] for t in taken_items)
    f_notes = apply_favor_list(
        player,
        card.get("friendlyFavor", []),
        reason=f"giving {names} to {card['name']}",
    )
    msg = f"{player['name']} handed over {names} to {card['name']}. {' '.join(f_notes)}"
    add_log(state, msg, "encounter")
    return True, msg


def _run_tile_encounter_and_refresh_loop(state: Dict[str, Any], player: Dict[str, Any], cell: str) -> None:
    cell_state = state["romeBoard"][cell]
    safety_counter = 0
    while safety_counter < 12:
        safety_counter += 1
        rev = cell_state.get("revealed")
        if not rev:
            break
        enc = rev.get("encounter")
        if enc:
            src_lbl = f"Tile {rev.get('id', cell)} in {cell}{' (Refresh ⤿)' if rev.get('refresh') else ''} — Center ({enc.replace('_', ' ×')})"
            if enc in ("mob", "theater", "soothsayer"):
                resolve_table_encounter(state, player, enc, source_label=src_lbl)
            else:
                trigger_deck_encounter(state, player, enc, source_label=src_lbl)

        if state.get("pendingEncounter") or player.get("pendingNpcOffer") or player.get("pendingCartOverflow") or player.get("pendingMarketReward"):
            if rev.get("refresh", False):
                state["pendingPostEncounterRefresh"] = {
                    "playerIndex": player["index"],
                    "cell": cell,
                }
            break

        if player["nightEnded"] or player["turnStep"] == "done":
            break

        if rev.get("refresh", False):
            add_log(state, f"Tile {rev['id']} has the Refresh (⤿) icon! Cycling to the bottom of {cell} and revealing the next tile...", "action")
            cell_state["stack"].append(rev)
            cell_state["revealed"] = cell_state["stack"].pop(0) if cell_state["stack"] else None
            check_passive_missions(state, player)
            if state.get("pendingEncounter") or player.get("pendingNpcOffer") or player.get("pendingCartOverflow") or player.get("pendingMarketReward") or player["nightEnded"] or player["turnStep"] == "done":
                break
        else:
            break


def resolve_tile_entry(state: Dict[str, Any], player: Dict[str, Any], cell: str) -> None:
    """Handles Step 3 (Reveal Tile), Step 4 (Complete Missions), Step 5 (Trigger Encounter), and Step 6 (Refresh ⤿)."""
    cell = normalize_cell_id(cell) or cell
    _record_neighborhood_visit(player, cell)
    cell_state = state["romeBoard"][cell]
    current_rev = cell_state.get("revealed")

    # Reveal new tile unless current revealed tile has persistent ⤹ icon
    if not current_rev or not current_rev.get("persistent", False):
        if current_rev:
            cell_state["stack"].append(current_rev)
        if cell_state["stack"]:
            cell_state["revealed"] = cell_state["stack"].pop(0)

    # Step 4: Check Mission pickups/deliveries/exposes (deliveries complete BEFORE Step 5 Tile Encounter!)
    check_passive_missions(state, player)

    # Step 5 & 6: Trigger Encounter and handle Refresh (⤿) loop
    _run_tile_encounter_and_refresh_loop(state, player, cell)


def _finish_pending_encounter_continuations(state: Dict[str, Any], player: Dict[str, Any]) -> None:
    """Completes any deferred edge move or Refresh (⤿) tile cycle after an encounter/combat/NPC offer finishes."""
    if state.get("pendingEncounter") or player.get("pendingNpcOffer") or player.get("pendingCartOverflow") or player.get("pendingMarketReward"):
        return

    # 1. Deferred move after an Edge Encounter
    move_info = state.get("pendingPostEncounterMove")
    if move_info and move_info.get("playerIndex") == player["index"]:
        state["pendingPostEncounterMove"] = None
        if not player["nightEnded"] and player["turnStep"] != "done":
            curr_cell = normalize_cell_id(move_info["fromCell"]) or move_info["fromCell"]
            direction = move_info["direction"]
            target_cell = normalize_cell_id(move_info["targetCell"]) if move_info.get("targetCell") else None
            player["movesRemaining"] = max(0, int(player.get("movesRemaining", 1)) - 1)
            player["previousPosition"] = curr_cell
            if target_cell is None:
                player["position"] = None
                player["exitedRome"] = True
                player["turnStep"] = "done"
                add_log(state, f"{player['name']} exited Rome safely via {curr_cell} ({direction}) before Dawn!", "phase")
                advance_delivery_turn(state)
                return
            player["position"] = target_cell
            if player.get("turnEffects", {}).get("makeHasteExtraTransact"):
                player["transactedThisTurn"] = False
                player["gambledThisTurn"] = False
                player["turnEffects"]["makeHasteExtraTransact"] = False
            if player["movesRemaining"] <= 0:
                player["turnStep"] = "moved"
            bridge_lbl = get_tiber_bridge_name(curr_cell, target_cell)
            bridge_suffix = f" via {bridge_lbl}" if bridge_lbl else ""
            add_log(state, f"{player['name']} moved {direction} from {curr_cell} to {target_cell} ({NEIGHBORHOOD_NAMES.get(target_cell, target_cell)}){bridge_suffix}.", "action")
            resolve_tile_entry(state, player, target_cell)
            if state.get("pendingEncounter") or player.get("pendingNpcOffer") or player.get("pendingCartOverflow") or player.get("pendingMarketReward"):
                return

    # 2. Deferred Refresh (⤿) tile cycling after a Tile Encounter
    ref_info = state.get("pendingPostEncounterRefresh")
    if ref_info and ref_info.get("playerIndex") == player["index"]:
        state["pendingPostEncounterRefresh"] = None
        if not player["nightEnded"] and player["turnStep"] != "done":
            r_cell = normalize_cell_id(ref_info["cell"]) or ref_info["cell"]
            cell_state = state["romeBoard"].get(r_cell)
            if cell_state:
                rev = cell_state.get("revealed")
                if rev and rev.get("refresh", False):
                    add_log(state, f"Tile {rev['id']} has the Refresh (⤿) icon! Cycling to the bottom of {r_cell} and revealing the next tile...", "action")
                    cell_state["stack"].append(rev)
                    cell_state["revealed"] = cell_state["stack"].pop(0) if cell_state["stack"] else None
                    check_passive_missions(state, player)
                    _run_tile_encounter_and_refresh_loop(state, player, r_cell)
                    if state.get("pendingEncounter") or player.get("pendingNpcOffer") or player.get("pendingCartOverflow") or player.get("pendingMarketReward"):
                        return

    # 3. If a human player's turn/night was ended by the encounter (e.g. Road Blocked, Theater II, Combat Defeat, or Driver Death), advance turn automatically
    if (
        not player.get("isBot")
        and state.get("phase") == "delivery"
        and state.get("activePlayerIndex") == player["index"]
        and (player.get("nightEnded") or player.get("turnStep") == "done")
    ):
        advance_delivery_turn(state)


def _begin_night_delivery_turn_1(state: Dict[str, Any]) -> None:
    """Transitions from Gate selection ('delivery_entry') to Turn 1 of Night Delivery.
    Entering Rome from outside the walls onto the chosen Via Gate IS each player's Move for Turn 1 (8:00 P.M.):
    each player starts Turn 1 with movesRemaining = 0 and resolves tile entry on their Gate when their Turn 1 turn begins.
    """
    state["phase"] = "delivery"
    state["turn"] = 1
    state["activePlayerIndex"] = state["firstPlayerIndex"]
    state["turnSeq"] = int(state.get("turnSeq", 1)) + 1

    for p in state["players"]:
        gate = normalize_cell_id(p.get("position"))
        p["position"] = gate
        p["turnStep"] = "moved"
        p["movesRemaining"] = 0
        p["transactedThisTurn"] = False
        p["gambledThisTurn"] = False
        p["scoutedThisTurn"] = False
        p["trashedThisTurn"] = False
        p["enteredGateTurn1"] = False

    first_p = state["players"][state["firstPlayerIndex"]]
    first_gate = normalize_cell_id(first_p.get("position"))
    first_p["position"] = first_gate
    first_p["enteredGateTurn1"] = True
    add_log(
        state,
        f"Night falls over Rome! Turn 1 (8:00 P.M.) begins — {first_p['name']} enters Rome through Gate {first_gate} ({NEIGHBORHOOD_NAMES.get(first_gate, first_gate)})!",
        "phase",
    )
    if first_p.get("isBot") and first_gate:
        add_npc_event(
            state,
            first_p,
            "enter_gate",
            f"Entered Rome via Gate {first_gate} ({NEIGHBORHOOD_NAMES.get(first_gate, first_gate)})",
            cell=first_gate,
            from_cell=None,
            visual={"kind": "enter_gate", "gate": first_gate},
        )
    if first_gate:
        resolve_tile_entry(state, first_p, first_gate)
    if (
        (first_p.get("nightEnded") or first_p.get("turnStep") == "done")
        and not state.get("pendingEncounter")
        and not first_p.get("pendingNpcOffer")
        and not first_p.get("pendingCartOverflow")
        and not first_p.get("pendingMarketReward")
    ):
        advance_delivery_turn(state)


def advance_market_turn(state: Dict[str, Any]) -> None:
    n = len(state["players"])
    state["turnSeq"] = int(state.get("turnSeq", 1)) + 1
    if state["marketConsecutivePasses"] >= n:
        # End Market Phase! Pass First Player Token clockwise
        state["firstPlayerIndex"] = (state["firstPlayerIndex"] + 1) % n
        state["activePlayerIndex"] = state["firstPlayerIndex"]
        state["phase"] = "delivery_entry"
        for p in state["players"]:
            p["position"] = None
            p["previousPosition"] = None
            p["exitedRome"] = False
            p["nightEnded"] = False
            p["skipTurns"] = 0
            p["scoutedThisTurn"] = False
            p["gambledThisTurn"] = False
            p["enteredGateTurn1"] = False
            p["friendInGuard"] = False
            p["turnStep"] = "entry"
        add_log(
            state,
            f"All merchants passed in Ostia. Phase II: Night Delivery in Rome begins! First Player Token passes to {state['players'][state['firstPlayerIndex']]['name']}. Select an entry Gate ('Via') to enter Rome.",
            "phase",
        )
        return
    state["activePlayerIndex"] = (state["activePlayerIndex"] + 1) % n


def _refund_unused_shortcut(state: Dict[str, Any], p: Dict[str, Any], manual: bool = False) -> bool:
    """Returns an armed Shortcut card to the player's hand if they did not cross a blocked/non-green route during their turn."""
    te = p.get("turnEffects")
    if not isinstance(te, dict) or not te.get("shortcut"):
        return False
    sc_card = te.pop("shortcutCard", None)
    te["shortcut"] = False
    if isinstance(sc_card, dict):
        p.setdefault("influence", []).append(sc_card)
        if manual:
            add_log(state, f"{p['name']} returned unused 'Shortcut' to their hand.", "action")
        else:
            add_log(
                state,
                f"{p['name']} did not pass through a blocked route this turn — 'Shortcut' returned to hand unused.",
                "action",
            )
        return True
    return False


def advance_delivery_turn(state: Dict[str, Any]) -> None:
    if state["pendingEncounter"] or state["phase"] == "finished":
        return
    if any(p.get("pendingNpcOffer") or p.get("pendingCartOverflow") or p.get("pendingMarketReward") for p in state["players"] if not p.get("isBot")):
        return

    n = len(state["players"])
    state["turnSeq"] = int(state.get("turnSeq", 1)) + 1
    current_idx = state["activePlayerIndex"]

    # Refund unused Shortcut (if any) and reset current player's temporary turn effects
    p_curr = state["players"][current_idx]
    _refund_unused_shortcut(state, p_curr)
    p_curr["turnStep"] = "done"
    p_curr["turnEffects"] = {}

    if all(p["turnStep"] == "done" or p["exitedRome"] or p["nightEnded"] for p in state["players"]):
        # Hour complete!
        if all(p["exitedRome"] or p["nightEnded"] for p in state["players"]) or state["turn"] >= 10:
            begin_cleanup_phase(state)
            return

        state["turn"] += 1
        state["firstPlayerIndex"] = (state["firstPlayerIndex"] + 1) % n
        state["hourEffects"] = {"priceEdict": False, "lastInfluencePlayed": None}
        for p in state["players"]:
            if p["exitedRome"] or p["nightEnded"]:
                p["turnStep"] = "done"
            elif p.get("skipTurns", 0) > 0:
                p["skipTurns"] -= 1
                p["turnStep"] = "done"
                add_log(state, f"{p['name']} loses this turn ({TURN_HOURS[state['turn'] - 1]}).", "info")
            else:
                p["turnStep"] = "start"
                p["movesRemaining"] = 1
                p["transactedThisTurn"] = False
                p["gambledThisTurn"] = False
                p["scoutedThisTurn"] = False
                p["trashedThisTurn"] = False

        add_log(state, f"Clock advances to {TURN_HOURS[state['turn'] - 1]}. First Player Token passes to {state['players'][state['firstPlayerIndex']]['name']}.", "phase")

        # Find first active player for the new hour
        for offset in range(n):
            cand = (state["firstPlayerIndex"] + offset) % n
            if state["players"][cand]["turnStep"] != "done":
                state["activePlayerIndex"] = cand
                return
        # If everyone skipped/done this hour, recurse to advance hour
        advance_delivery_turn(state)
        return

    # Otherwise move to next player who hasn't acted this hour
    for offset in range(1, n + 1):
        cand = (current_idx + offset) % n
        cand_p = state["players"][cand]
        if cand_p["turnStep"] != "done" and not cand_p["exitedRome"] and not cand_p["nightEnded"]:
            state["activePlayerIndex"] = cand
            cand_p["gambledThisTurn"] = False
            if state["turn"] == 1 and not cand_p.get("enteredGateTurn1") and cand_p.get("position"):
                gate_c = normalize_cell_id(cand_p["position"])
                cand_p["position"] = gate_c
                cand_p["enteredGateTurn1"] = True
                add_log(
                    state,
                    f"{cand_p['name']} enters Rome through Gate {gate_c} ({NEIGHBORHOOD_NAMES.get(gate_c, gate_c)})!",
                    "action",
                )
                if cand_p.get("isBot") and gate_c:
                    add_npc_event(
                        state,
                        cand_p,
                        "enter_gate",
                        f"Entered Rome via Gate {gate_c} ({NEIGHBORHOOD_NAMES.get(gate_c, gate_c)})",
                        cell=gate_c,
                        from_cell=None,
                        visual={"kind": "enter_gate", "gate": gate_c},
                    )
                if gate_c:
                    resolve_tile_entry(state, cand_p, gate_c)
                if (
                    (cand_p.get("nightEnded") or cand_p.get("turnStep") == "done")
                    and not state.get("pendingEncounter")
                    and not cand_p.get("pendingNpcOffer")
                    and not cand_p.get("pendingCartOverflow")
                    and not cand_p.get("pendingMarketReward")
                ):
                    advance_delivery_turn(state)
            return


def begin_cleanup_phase(state: Dict[str, Any]) -> None:
    state["phase"] = "cleanup"
    state["turnSeq"] = int(state.get("turnSeq", 1)) + 1
    season = state["season"]
    base_fine = {"Spring": 12, "Summer": 20, "Fall": 32}.get(season, 12)

    add_log(state, f"DAWN BREAKS OVER ROME! {season} Night Delivery has ended. Assessing Daybreak Fines and cleaning up Rome...", "phase")

    # 1. Pay Fines for any player still in Rome (not exitedRome)
    for p in state["players"]:
        _refund_unused_shortcut(state, p)
        pos = normalize_cell_id(p.get("position"))
        if not p["exitedRome"] and pos:
            on_gate = pos in GATE_CELLS
            fine = base_fine // 2 if on_gate else base_fine
            if p.get("friendInGuard") or p.get("turnEffects", {}).get("friendInGuard"):
                fine = 0 if on_gate else (fine // 2)
                p["friendInGuard"] = False
                p.get("turnEffects", {})["friendInGuard"] = False
                if fine == 0:
                    add_log(state, f"Daybreak Fine: {p['name']} used 'Friend In The City Guard' to waive the Gate Fine at {pos}!", "action")

            if fine > 0:
                if p["cash"] >= fine:
                    p["cash"] -= fine
                    add_log(state, f"Daybreak Fine: {p['name']} was caught in {pos} at Dawn and paid {fine}(d){' (Gate half-penalty)' if on_gate else ''}.", "penalty")
                else:
                    rem = fine - p["cash"]
                    paid_cash = p["cash"]
                    p["cash"] = 0
                    seized = []
                    p["cart"].sort(key=lambda c: _item_base_value(c) or 4)
                    while rem > 0 and p["cart"]:
                        g = p["cart"][0]
                        val = _item_base_value(g) or 4
                        rem -= val
                        seized.append(f"{g['name']} ({val}d)")
                        _remove_cart_item(state, p, g, reason="seized for Daybreak Fine")
                    add_log(state, f"Daybreak Fine: {p['name']} paid {paid_cash}(d) cash and forfeited {', '.join(seized) or 'all cargo'} to cover the {fine}(d) fine!", "penalty")
        p["friendInGuard"] = False
        p["position"] = None
        p["previousPosition"] = None
        p["cleanupDone"] = False

    # 2. Clean Up Rome: move all exposed tiles to bottom of their stacks
    for cell_state in state["romeBoard"].values():
        if cell_state.get("revealed"):
            cell_state["stack"].append(cell_state["revealed"])
            cell_state["revealed"] = None

    state["seasonTrackShifts"] = {t: 0 for t in TRACK_NAMES}
    state["activePlayerIndex"] = state["firstPlayerIndex"]

    for p in state["players"]:
        if p["isBot"]:
            _bot_complete_cleanup(state, p)

    _check_all_cleanups_done(state)


def get_guard_upkeep_cost(state: Dict[str, Any], guard: Dict[str, Any]) -> int:
    """
    Rulebook Cleanup #5: Pay price is equal to what their hiring cost would be if placed
    in the first exposed slot on the right of the market board.
    """
    guards_on_mkt = len(state["marketBoard"].get("Guards", []))
    slot_col = min(5, guards_on_mkt)
    price_idx = COL_TO_PRICE_INDEX[slot_col]
    buy_table = guard.get("buy") or [10, 8, 4, 3, 2]
    return int(buy_table[price_idx])


def get_influence_buy_price(player: Dict[str, Any]) -> int:
    count = len(player["influence"])
    for m in player["missions"]:
        count += len(m.get("underInfluence", []))
    if count <= 1:
        return 2
    if count <= 3:
        return 4
    if count == 4:
        return 6
    return 8


def _bot_complete_cleanup(state: Dict[str, Any], player: Dict[str, Any]) -> None:
    if player["cleanupDone"]:
        return
    strategy = player.get("botStrategy", "balanced")
    season_key = state["season"].lower()

    # Consider taking a Loan if cash-poor in Spring or Summer (especially Luxury / Aggressive personas)
    loan_cash_thresh = 10 if strategy in ("luxury", "aggressive") else 5
    if season_key == "spring" and not player["loans"].get("spring") and player["cash"] <= loan_cash_thresh:
        player["loans"]["spring"] = True
        player["cash"] += 20
        add_log(state, f"{player['name']} took out the 20(d) Spring Loan.", "action")
        add_npc_event(state, player, "loan", "Took 20(d) Spring Loan")
    elif season_key == "summer" and not player["loans"].get("summer") and player["cash"] <= loan_cash_thresh:
        player["loans"]["summer"] = True
        player["cash"] += 40
        add_log(state, f"{player['name']} took out the 40(d) Summer Loan.", "action")
        add_npc_event(state, player, "loan", "Took 40(d) Summer Loan")

    # Pay guards if affordable
    kept_guards = []
    guard_buffer = 3 if strategy == "aggressive" else 6
    for g in player["guards"]:
        cost = get_guard_upkeep_cost(state, g)
        if player["cash"] >= cost + guard_buffer:
            player["cash"] -= cost
            kept_guards.append(g)
        else:
            state["decks"]["market"].append(g)
    player["guards"] = kept_guards

    # Buy 1 influence card if cheap
    inf_cost = get_influence_buy_price(player)
    if state["season"] != "Fall" and player["cash"] >= inf_cost + 8 and state["decks"]["influence"]:
        player["cash"] -= inf_cost
        player["influence"].append(state["decks"]["influence"].pop(0))

    # Repay loans when holding ample Denarii
    if player["loans"].get("spring"):
        sp_cost = 30 if season_key == "summer" else 45
        if player["cash"] >= sp_cost + (10 if season_key == "summer" else 0):
            player["cash"] -= sp_cost
            player["loans"]["spring"] = False
            add_log(state, f"{player['name']} repaid their Spring Loan for {sp_cost}(d).", "action")
            add_npc_event(state, player, "loan", f"Repaid Spring Loan ({sp_cost}d)")
    if season_key == "fall" and player["loans"].get("summer") and player["cash"] >= 60:
        player["cash"] -= 60
        player["loans"]["summer"] = False
        add_log(state, f"{player['name']} repaid their Summer Loan for 60(d).", "action")
        add_npc_event(state, player, "loan", "Repaid Summer Loan (60d)")

    player["cleanupDone"] = True


def _resolve_pvp_combat_tiebreaker(
    state: Dict[str, Any],
    p1: Dict[str, Any],
    p2: Dict[str, Any],
    gear_map: Optional[Dict[int, List[Dict[str, Any]]]] = None,
    context_label: str = "Final Tie-Breaker",
) -> Dict[str, Any]:
    """
    Resolves Combat between tied Players using Drivers (1®), Guards, Weapons, mandatory Exotic Animals,
    Army Pay Hike Rubies (if active), and combat Influence cards. Repeats Combat on a draw (keeping Round-1
    Influence & consumable Weapons exhausted) until one Merchant wins by at least 1 CP.
    """
    gear_map = gear_map if gear_map is not None else {}
    p1_gear = list(gear_map.get(p1["index"], p1.get("cart", [])))
    p2_gear = list(gear_map.get(p2["index"], p2.get("cart", [])))
    used_inf_ids: set = set()
    consumed_gear_ids: set = set()
    army_hike = has_climate_modifier(state, "caracalla_3")

    round_num = 0
    while True:
        round_num += 1
        _inc_player_stat(p1, "combats", 1)
        _inc_player_stat(p2, "combats", 1)

        def _build_side_roll(
            fighter: Dict[str, Any],
            rival: Dict[str, Any],
            gear_list: List[Dict[str, Any]],
            opp_distract_dice: int,
        ) -> Tuple[int, List[Dict[str, Any]], int, List[Dict[str, Any]]]:
            d_drv = roll_rome_die()
            dice_objs: List[Dict[str, Any]] = [
                {"value": d_drv, "roman": roman_die_str(d_drv), "sign": 1, "label": "Driver ®", "color": fighter["color"]}
            ]
            flat_total = 0
            flat_mods: List[Dict[str, Any]] = []

            if army_hike:
                pos_rubies = max(0, int((fighter.get("favor") or {}).get("Caracalla", 0)))
                if pos_rubies > 0:
                    flat_total += pos_rubies
                    flat_mods.append({"label": f"Army Pay Hike (+{pos_rubies} Ruby)", "value": pos_rubies})

            # Guards
            for g in fighter.get("guards", []):
                cinfo = g.get("combat") or {}
                g_name = g.get("name", "Guard")
                for _ in range(int(cinfo.get("dice", 0))):
                    rg = roll_rome_die()
                    dice_objs.append({"value": rg, "roman": roman_die_str(rg), "sign": 1, "label": f"Guard: {g_name}", "color": fighter["color"]})
                gf = int(cinfo.get("flat", 0))
                if gf != 0:
                    flat_total += gf
                    flat_mods.append({"label": f"Guard: {g_name}", "value": gf})

            # Weapons & mandatory Exotic Animals
            for item in gear_list:
                cinfo = item.get("combat")
                if not cinfo:
                    continue
                iid = str(item.get("id", ""))
                if cinfo.get("consumable"):
                    if iid in consumed_gear_ids:
                        continue
                    consumed_gear_ids.add(iid)
                item_lbl = item.get("item") or item.get("name", "Gear")
                is_animal = item.get("subcategory") == "Exotic Animals" or item.get("category") == "Exotic Animals"
                iflat = int(cinfo.get("flat", 0))
                if is_animal or int(cinfo.get("dice", 0)) > 0 or iflat != 0 or int(cinfo.get("negDice", 0)) > 0:
                    for _ in range(int(cinfo.get("dice", 0))):
                        rw = roll_rome_die()
                        dice_objs.append({"value": rw, "roman": roman_die_str(rw), "sign": 1, "label": item_lbl, "color": fighter["color"]})
                    for _ in range(int(cinfo.get("negDice", 0))):
                        rn = roll_rome_die()
                        dice_objs.append({"value": rn, "roman": roman_die_str(rn), "sign": -1, "label": f"{item_lbl} (-®)", "color": fighter["color"]})
                    if iflat != 0:
                        flat_total += iflat
                        flat_mods.append({"label": item_lbl, "value": iflat})

            # Round-1 one-shot Combat Influence cards (exhausted on subsequent draw rounds)
            if round_num == 1:
                for inf_c in list(fighter.get("influence", [])):
                    cid = str(inf_c.get("id", ""))
                    if cid in used_inf_ids:
                        continue
                    nm = str(inf_c.get("name", ""))
                    if "Mercenary" in nm or "Gladiator" in nm:
                        used_inf_ids.add(cid)
                        fighter["influence"].remove(inf_c)
                        state["decks"]["influence"].append(inf_c)
                        _inc_player_stat(fighter, "influencePlayed", 1)
                        cnt_d = 2 if "Mercenary" in nm else 1
                        for k_i in range(cnt_d):
                            ri = roll_rome_die()
                            dice_objs.append({"value": ri, "roman": roman_die_str(ri), "sign": 1, "label": f"{nm} #{k_i + 1}", "color": fighter["color"]})
                    elif "Flying Chamber Pot" in nm:
                        used_inf_ids.add(cid)
                        fighter["influence"].remove(inf_c)
                        state["decks"]["influence"].append(inf_c)
                        _inc_player_stat(fighter, "influencePlayed", 1)
                        flat_total += 1
                        flat_mods.append({"label": nm, "value": 1})

            for idx_d in range(opp_distract_dice):
                rd = roll_rome_die()
                dice_objs.append({"value": rd, "roman": roman_die_str(rd), "sign": -1, "label": f"Distraction (-®)", "color": fighter["color"]})

            dice_sum = sum(int(d["value"]) * int(d["sign"]) for d in dice_objs)
            return max(0, dice_sum + flat_total), dice_objs, flat_total, flat_mods

        p1_distracts = 0
        p2_distracts = 0
        if round_num == 1:
            for inf_c in list(p1.get("influence", [])):
                if "Distraction" in str(inf_c.get("name", "")):
                    used_inf_ids.add(str(inf_c.get("id", "")))
                    p1["influence"].remove(inf_c)
                    state["decks"]["influence"].append(inf_c)
                    _inc_player_stat(p1, "influencePlayed", 1)
                    p2_distracts += 1
            for inf_c in list(p2.get("influence", [])):
                if "Distraction" in str(inf_c.get("name", "")):
                    used_inf_ids.add(str(inf_c.get("id", "")))
                    p2["influence"].remove(inf_c)
                    state["decks"]["influence"].append(inf_c)
                    _inc_player_stat(p2, "influencePlayed", 1)
                    p1_distracts += 1

        cp1, dice1, flat1, fmods1 = _build_side_roll(p1, p2, p1_gear, p1_distracts)
        cp2, dice2, flat2, fmods2 = _build_side_roll(p2, p1, p2_gear, p2_distracts)

        # Allow trailing player to spend Twist Of Fate in Round 1
        for trailing, leading, t_dice, l_dice, t_flat, l_flat, is_p1 in (
            (p1, p2, dice1, dice2, flat1, flat2, True),
            (p2, p1, dice2, dice1, flat2, flat1, False),
        ):
            cur_t = max(0, sum(int(d["value"]) * int(d["sign"]) for d in t_dice) + t_flat)
            cur_l = max(0, sum(int(d["value"]) * int(d["sign"]) for d in l_dice) + l_flat)
            if cur_t <= cur_l:
                tof = next((c for c in trailing.get("influence", []) if "Twist Of Fate" in str(c.get("name", ""))), None)
                if tof:
                    opp_hi = next((d for d in l_dice if int(d.get("sign", 1)) > 0 and int(d.get("value", 0)) >= 2), None)
                    own_lo = next((d for d in t_dice if int(d.get("sign", 1)) > 0 and int(d.get("value", 0)) == 0), None)
                    target_d = opp_hi or own_lo
                    if target_d is not None:
                        trailing["influence"].remove(tof)
                        state["decks"]["influence"].append(tof)
                        _inc_player_stat(trailing, "influencePlayed", 1)
                        nr = roll_rome_die()
                        target_d["value"] = nr
                        target_d["roman"] = roman_die_str(nr)
                        target_d["label"] = f"{target_d['label']} (Re-rolled)"

        cp1 = max(0, sum(int(d["value"]) * int(d["sign"]) for d in dice1) + flat1)
        cp2 = max(0, sum(int(d["value"]) * int(d["sign"]) for d in dice2) + flat2)

        # Safety against astronomical infinite tie loops
        if round_num >= 25 and cp1 == cp2:
            cp1 += 1 if secrets.randbelow(2) == 0 else 0
            if cp1 == cp2:
                cp2 += 1

        is_draw = cp1 == cp2
        round_winner = None if is_draw else (p1 if cp1 > cp2 else p2)
        out_title = f"ROUND {round_num} DRAW ({cp1}–{cp2} CP) — REPEATING!" if is_draw else f"{round_winner['name']} TRIUMPHS ({cp1}–{cp2} CP)!"
        out_msg = (
            f"{context_label} — Combat Round {round_num} ended in a {cp1}–{cp2} CP draw! Repeating Combat..."
            if is_draw
            else f"{context_label}: {round_winner['name']} defeated {(p2 if round_winner is p1 else p1)['name']} ({cp1} CP vs. {cp2} CP) in Round {round_num}!"
        )
        add_dice_event(
            state,
            kind="tiebreaker",
            title=f"⚔️ {context_label.upper()} (ROUND {round_num}): {p1['name']} vs. {p2['name']}",
            subtitle="PvP Tie-Breaker Combat (Drivers, Guards, Weapons, Exotic Animals & Combat Influence)",
            groups=[
                {
                    "rollerName": p1["name"],
                    "rollerType": "player",
                    "colorName": p1["color"],
                    "flatBonus": flat1,
                    "flatModifiers": fmods1,
                    "totalLabel": _format_combat_total_label(cp1, dice1, flat1),
                    "dice": copy.deepcopy(dice1),
                },
                {
                    "rollerName": p2["name"],
                    "rollerType": "player",
                    "colorName": p2["color"],
                    "flatBonus": flat2,
                    "flatModifiers": fmods2,
                    "totalLabel": _format_combat_total_label(cp2, dice2, flat2),
                    "dice": copy.deepcopy(dice2),
                },
            ],
            outcome_title=out_title,
            outcome_message=out_msg,
        )
        add_log(state, out_msg, "combat")
        if round_winner is not None:
            if consumed_gear_ids:
                if p1["index"] in gear_map:
                    gear_map[p1["index"]] = [g for g in p1_gear if str(g.get("id", "")) not in consumed_gear_ids]
                if p2["index"] in gear_map:
                    gear_map[p2["index"]] = [g for g in p2_gear if str(g.get("id", "")) not in consumed_gear_ids]
            return round_winner


def _ordered_tied_players(state: Dict[str, Any], tied: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    n = max(1, len(state.get("players", [])))
    fp = int(state.get("firstPlayerIndex", 0) or 0)
    return sorted(tied, key=lambda p: (int(p.get("index", 0)) - fp) % n)


def _resolve_multiway_pvp_winner(
    state: Dict[str, Any],
    tied: List[Dict[str, Any]],
    gear_map: Dict[int, List[Dict[str, Any]]],
    context_label: str,
) -> Dict[str, Any]:
    ordered = _ordered_tied_players(state, tied)
    champ = ordered[0]
    for challenger in ordered[1:]:
        champ = _resolve_pvp_combat_tiebreaker(state, champ, challenger, gear_map, context_label=context_label)
    return champ


def _resolve_multiway_pvp_loser(
    state: Dict[str, Any],
    tied: List[Dict[str, Any]],
    gear_map: Dict[int, List[Dict[str, Any]]],
    context_label: str,
) -> Dict[str, Any]:
    """Resolves ties for 'Least' penalties/eliminations: combat winner escapes safe, loser stays in jeopardy until 1 sole loser remains."""
    ordered = _ordered_tied_players(state, tied)
    loser = ordered[0]
    for opponent in ordered[1:]:
        bout_winner = _resolve_pvp_combat_tiebreaker(state, loser, opponent, gear_map, context_label=context_label)
        loser = opponent if bout_winner is loser else loser
    return loser


def _bot_optimize_domna_diamonds_for_winter(state: Dict[str, Any]) -> None:
    """When Empress Mediator (domna_3) is active, bots convert positive Diamonds into Rubies or Emeralds before Winter Reckoning if advantageous."""
    if not has_climate_modifier(state, "domna_3"):
        return
    players = state.get("players", [])
    for bot in players:
        if not bot.get("isBot"):
            continue
        while int((bot.get("favor") or {}).get("Domna", 0)) > 0:
            cur_car = int(bot["favor"].get("Caracalla", 0))
            cur_get = int(bot["favor"].get("Geta", 0))
            min_car = min((int((p.get("favor") or {}).get("Caracalla", 0)) for p in players), default=0)
            min_get = min((int((p.get("favor") or {}).get("Geta", 0)) for p in players), default=0)

            target_fac: Optional[str] = None
            if has_climate_modifier(state, "caracalla_1") and cur_car <= min_car:
                target_fac = "Caracalla"
            elif has_climate_modifier(state, "geta_1") and cur_get <= min_get:
                target_fac = "Geta"
            elif has_climate_modifier(state, "geta_2") and cur_car <= 0:
                target_fac = "Geta"
            elif has_climate_modifier(state, "caracalla_3"):
                target_fac = "Caracalla"

            if not target_fac:
                break

            bot["favor"]["Domna"] -= 1
            bot["favor"][target_fac] = int(bot["favor"].get(target_fac, 0)) + 1
            hist = bot.setdefault("favorHistory", {f: [] for f in FACTIONS})
            hist.setdefault("Domna", []).append({
                "delta": -1,
                "reason": f"Empress Mediator exchange -> +1 {target_fac}",
                "newTotal": bot["favor"]["Domna"],
            })
            hist.setdefault(target_fac, []).append({
                "delta": 1,
                "reason": "Empress Mediator exchange from 1 Diamond",
                "newTotal": bot["favor"][target_fac],
            })
            add_log(
                state,
                f"💎 {bot['name']} invoked Empress Mediator to exchange 1 Diamond for +1 {target_fac} Favor!",
                "action",
            )


def _check_all_cleanups_done(state: Dict[str, Any]) -> None:
    if state["phase"] != "cleanup":
        return
    if not all(p["cleanupDone"] for p in state["players"]):
        return

    n = len(state["players"])
    state["firstPlayerIndex"] = (state["firstPlayerIndex"] + 1) % n
    state["activePlayerIndex"] = state["firstPlayerIndex"]
    state["turnSeq"] = int(state.get("turnSeq", 1)) + 1

    if state["season"] == "Spring":
        state["season"] = "Summer"
        state["seasonIndex"] = 1
        state["phase"] = "market"
        state["turn"] = 1
        state["marketConsecutivePasses"] = 0
        add_log(state, f"SUMMER 211 A.D. BEGINS! Phase I: Ostia Market is open. {state['players'][state['firstPlayerIndex']]['name']} holds the First Player Token.", "phase")
        run_bots_until_human(state)
    elif state["season"] == "Summer":
        state["season"] = "Fall"
        state["seasonIndex"] = 2
        state["phase"] = "market"
        state["turn"] = 1
        state["marketConsecutivePasses"] = 0
        add_log(state, f"FALL 211 A.D. BEGINS! The final season starts at Ostia Market. {state['players'][state['firstPlayerIndex']]['name']} holds the First Player Token.", "phase")
        run_bots_until_human(state)
    else:
        # End of Fall -> DECEMBER 211 WINTER RECKONING (Political Climate Modifiers & PvP Tie-Breakers)!
        add_log(state, "DECEMBER 211 A.D. — Winter Reckoning sweeps Rome as the active Political Climate is settled!", "phase")

        players = state["players"]
        pre_cash_map: Dict[int, int] = {}
        step1_fine_map: Dict[int, int] = {}
        liq_map: Dict[int, int] = {}
        loan_map: Dict[int, int] = {}
        pvp_gear_snapshot: Dict[int, List[Dict[str, Any]]] = {}
        climate_breakdown_map: Dict[int, List[Dict[str, Any]]] = {p["index"]: [] for p in players}
        fac_breakdown_map: Dict[int, Dict[str, int]] = {
            p["index"]: {f: 0 for f in FACTIONS} for p in players
        }
        mission_bonus_map: Dict[int, int] = {p["index"]: 0 for p in players}

        def _record_climate_delta(
            target_p: Dict[str, Any],
            opt_id: str,
            factor: str,
            title: str,
            delta: int,
            detail: str,
        ) -> None:
            idx_p = int(target_p["index"])
            target_p["cash"] = int(target_p.get("cash", 0)) + int(delta)
            climate_breakdown_map[idx_p].append({
                "id": opt_id,
                "factor": factor,
                "title": title,
                "delta": int(delta),
                "detail": detail,
            })
            if factor in FACTIONS:
                fac_breakdown_map[idx_p][factor] = int(fac_breakdown_map[idx_p].get(factor, 0)) + int(delta)
            elif factor == "Missions":
                mission_bonus_map[idx_p] = int(mission_bonus_map.get(idx_p, 0)) + int(delta)

        # Step 1: Fail unfulfilled missions (incrementing missionsFailed, applying Hostile Favor, & applying missions_3 -10d fines!)
        for p in players:
            p["eliminated"] = False
            p["eliminationReason"] = None
            pre_cash_map[p["index"]] = int(p.get("cash", 0))
            for m in list(p.get("missions", [])):
                if not m.get("completed"):
                    _fail_mission(state, p, m, reason="unfulfilled at end of 211 A.D.")
            step1_fine_map[p["index"]] = int(p.get("cash", 0)) - pre_cash_map[p["index"]]

        # Step 2: Snapshot combat gear for potential PvP tie-breakers, then liquidate remaining non-mission Cart Goods at Abundant (>>) Sell Price
        for p in players:
            pvp_gear_snapshot[p["index"]] = [
                copy.deepcopy(c) for c in p.get("cart", []) if c.get("combat") and not c.get("isMissionCargo")
            ]
            liq_total = 0
            liq_items = []
            for item in list(p.get("cart", [])):
                if item.get("isMissionCargo"):
                    continue
                sell_tbl = item.get("sell") or []
                abundant_val = int(sell_tbl[4]) if len(sell_tbl) >= 5 else (int(sell_tbl[-1]) if sell_tbl else 0)
                if abundant_val > 0:
                    p["cash"] += abundant_val
                    liq_total += abundant_val
                    liq_items.append(f"{item['name']} (+{abundant_val}d)")
                if not str(item.get("id", "")).startswith("forged_wine_"):
                    state["decks"]["market"].append(item)
            p["cart"] = []
            liq_map[p["index"]] = liq_total
            if liq_items:
                add_log(state, f"Winter Liquidation: {p['name']} liquidated {', '.join(liq_items)} at Abundant (>>) prices for +{liq_total}(d).", "action")

        # Step 3: Deduct Unpaid Loans (45d Spring, 60d Summer)
        for p in players:
            loan_ded = 0
            if p["loans"].get("spring"):
                p["cash"] -= 45
                loan_ded += 45
                add_log(state, f"Winter Loan Settlement: 45(d) deducted from {p['name']} for unpaid Spring Loan.", "penalty")
            if p["loans"].get("summer"):
                p["cash"] -= 60
                loan_ded += 60
                add_log(state, f"Winter Loan Settlement: 60(d) deducted from {p['name']} for unpaid Summer Loan.", "penalty")
            loan_map[p["index"]] = loan_ded

        # Step 4: Allow bots to convert remaining positive Diamonds if Empress Mediator (domna_3) is active
        _bot_optimize_domna_diamonds_for_winter(state)

        # Step 5: Apply flat Political Climate valuations & flat Most/Least awards
        # 5a. Caracalla Option 2: -10d per positive Ruby, +5d per negative Ruby
        if has_climate_modifier(state, "caracalla_2"):
            for p in players:
                car_v = int((p.get("favor") or {}).get("Caracalla", 0))
                delta = (car_v * -10) if car_v > 0 else (abs(car_v) * 5)
                det = f"Caracalla {car_v:+d} ({'-10d/+' if car_v > 0 else '+5d/-'} Ruby)" if car_v != 0 else "Caracalla 0 (0d)"
                _record_climate_delta(p, "caracalla_2", "Caracalla", "Praetorian Backlash", delta, det)

        # 5b. Geta Option 1: Least Geta favor loses -25(d) (ties resolved by PvP Combat; loser pays -25d)
        if has_climate_modifier(state, "geta_1") and players:
            min_get = min(int((p.get("favor") or {}).get("Geta", 0)) for p in players)
            tied_least_get = [p for p in players if int((p.get("favor") or {}).get("Geta", 0)) == min_get]
            if len(tied_least_get) > 1:
                add_log(
                    state,
                    f"⚔️ Tie for Least Geta Favor ({min_get:+d}) between {', '.join(x['name'] for x in tied_least_get)} — PvP Combat decides who suffers -25(d)!",
                    "combat",
                )
                loser_get = _resolve_multiway_pvp_loser(
                    state, tied_least_get, pvp_gear_snapshot, f"Least Geta Favor ({min_get:+d}) Penalty"
                )
                det_g1 = f"Lost PvP Tie-Break for Least Geta Favor ({min_get:+d})"
            else:
                loser_get = tied_least_get[0]
                det_g1 = f"Sole Least Geta Favor ({min_get:+d})"
            _record_climate_delta(loser_get, "geta_1", "Geta", "Brother's Grudge", -25, det_g1)
            add_log(state, f"Brother's Grudge: {loser_get['name']} suffers -25(d) ({det_g1}).", "penalty")

        # 5c. Geta Option 2 (Jealous Brothers): +15d/Emerald if Caracalla <= 0, -10d/Emerald if Caracalla >= +1; -5d per negative Emerald
        if has_climate_modifier(state, "geta_2"):
            for p in players:
                fav = p.get("favor") or {}
                get_v = int(fav.get("Geta", 0))
                car_v = int(fav.get("Caracalla", 0))
                if get_v > 0:
                    rate = 15 if car_v <= 0 else -10
                    delta = get_v * rate
                    det = f"+{get_v} Emerald × {rate:+d}d (Caracalla {car_v:+d})"
                elif get_v < 0:
                    delta = -5 * abs(get_v)
                    det = f"{get_v} Emerald × -5d"
                else:
                    delta = 0
                    det = "Geta 0 (0d)"
                _record_climate_delta(p, "geta_2", "Geta", "Jealous Brothers", delta, det)

        # 5d. Domna Option 2 (Court Neutrality): -15d per positive Diamond AND -15d per negative Diamond
        if has_climate_modifier(state, "domna_2"):
            for p in players:
                dom_v = int((p.get("favor") or {}).get("Domna", 0))
                delta = -15 * abs(dom_v)
                det = f"Domna {dom_v:+d} ({abs(dom_v)} × -15d)" if dom_v != 0 else "Domna 0 (0d — Neutrality Kept!)"
                _record_climate_delta(p, "domna_2", "Domna", "Court Neutrality", delta, det)

        # 5e. Plautilla Option 2 (Smuggled Dowry): +10d per completed Plautilla-linked mission
        if has_climate_modifier(state, "plautilla_2"):
            for p in players:
                st_p = _ensure_player_stats(p)
                pla_m = int(st_p.get("plautillaMissionsCompleted", 0) or 0)
                delta = 10 * pla_m
                det = f"{pla_m} Plautilla Mission{'s' if pla_m != 1 else ''} × +10d"
                _record_climate_delta(p, "plautilla_2", "Plautilla", "Smuggled Dowry", delta, det)

        # 5f. Aurelius Option 1 (Old Senate Purse): Most Aurelian favor gains +25(d) (ties -> PvP Combat)
        if has_climate_modifier(state, "aurelius_1") and players:
            max_aur = max(int((p.get("favor") or {}).get("Aurelius", 0)) for p in players)
            tied_aur = [p for p in players if int((p.get("favor") or {}).get("Aurelius", 0)) == max_aur]
            if len(tied_aur) > 1:
                add_log(
                    state,
                    f"⚔️ Tie for Most Aurelian Favor ({max_aur:+d}) between {', '.join(x['name'] for x in tied_aur)} — PvP Combat decides the +25(d) purse!",
                    "combat",
                )
                win_aur = _resolve_multiway_pvp_winner(
                    state, tied_aur, pvp_gear_snapshot, f"Most Aurelian Favor ({max_aur:+d}) +25d"
                )
                det_a1 = f"Won PvP Tie-Break for Most Aurelian Favor ({max_aur:+d})"
            else:
                win_aur = tied_aur[0]
                det_a1 = f"Sole Most Aurelian Favor ({max_aur:+d})"
            _record_climate_delta(win_aur, "aurelius_1", "Aurelius", "Old Senate Purse", 25, det_a1)
            add_log(state, f"Old Senate Purse: {win_aur['name']} claims +25(d) ({det_a1})!", "phase")

        # 5g. Aurelius Option 2 (Choose a Side): +10d per positive Amethyst AND +10d per negative Amethyst
        if has_climate_modifier(state, "aurelius_2"):
            for p in players:
                aur_v = int((p.get("favor") or {}).get("Aurelius", 0))
                delta = 10 * abs(aur_v)
                det = f"Aurelius {aur_v:+d} ({abs(aur_v)} × +10d)" if aur_v != 0 else "Aurelius 0 (0d)"
                _record_climate_delta(p, "aurelius_2", "Aurelius", "Choose a Side", delta, det)

        # 5h. Missions Option 1 (Master Purveyor): Most completed missions gains +30(d) (ties -> PvP Combat)
        if has_climate_modifier(state, "missions_1") and players:
            max_comp = max(int(_ensure_player_stats(p).get("missionsCompleted", 0) or 0) for p in players)
            tied_m1 = [p for p in players if int(_ensure_player_stats(p).get("missionsCompleted", 0) or 0) == max_comp]
            if len(tied_m1) > 1:
                add_log(
                    state,
                    f"⚔️ Tie for Most Completed Missions ({max_comp}) between {', '.join(x['name'] for x in tied_m1)} — PvP Combat decides +30(d)!",
                    "combat",
                )
                win_m1 = _resolve_multiway_pvp_winner(
                    state, tied_m1, pvp_gear_snapshot, f"Most Completed Missions ({max_comp}) +30d"
                )
                det_m1 = f"Won PvP Tie-Break for Most Completed Missions ({max_comp})"
            else:
                win_m1 = tied_m1[0]
                det_m1 = f"Sole Most Completed Missions ({max_comp})"
            _record_climate_delta(win_m1, "missions_1", "Missions", "Master Purveyor", 30, det_m1)
            add_log(state, f"Master Purveyor: {win_m1['name']} claims +30(d) ({det_m1})!", "phase")

        # 5i. Missions Option 2 (Guild Ledger): +10d per completed mission and -10d per failed/unfulfilled mission (net negative allowed)
        if has_climate_modifier(state, "missions_2"):
            for p in players:
                st_p = _ensure_player_stats(p)
                comp_c = int(st_p.get("missionsCompleted", 0) or 0)
                fail_c = int(st_p.get("missionsFailed", 0) or 0)
                net_c = comp_c - fail_c
                delta = 10 * net_c
                det = f"{comp_c} Completed (+{comp_c * 10}d), {fail_c} Failed (-{fail_c * 10}d)"
                _record_climate_delta(p, "missions_2", "Missions", "Guild Ledger", delta, det)

        # Step 6: Plautilla Option 1 (Exile's Informants) — Most Plautilla favor steals 15(d) from the wealthiest rival
        if has_climate_modifier(state, "plautilla_1") and len(players) >= 2:
            max_pla = max(int((p.get("favor") or {}).get("Plautilla", 0)) for p in players)
            tied_pla = [p for p in players if int((p.get("favor") or {}).get("Plautilla", 0)) == max_pla]
            if len(tied_pla) > 1:
                add_log(
                    state,
                    f"⚔️ Tie for Most Plautilla Favor ({max_pla:+d}) between {', '.join(x['name'] for x in tied_pla)} — PvP Combat decides who steals 15(d)!",
                    "combat",
                )
                thief_p = _resolve_multiway_pvp_winner(
                    state, tied_pla, pvp_gear_snapshot, f"Most Plautilla Favor ({max_pla:+d}) 15d Heist"
                )
            else:
                thief_p = tied_pla[0]

            rivals = [r for r in players if r["index"] != thief_p["index"]]
            top_rival_cash = max(int(r.get("cash", 0)) for r in rivals)
            tied_victims = [r for r in rivals if int(r.get("cash", 0)) == top_rival_cash]
            if len(tied_victims) > 1:
                add_log(
                    state,
                    f"⚔️ {', '.join(x['name'] for x in tied_victims)} are tied as wealthiest rival ({top_rival_cash}d) — PvP Combat decides whose purse is raided!",
                    "combat",
                )
                victim_p = _resolve_multiway_pvp_loser(
                    state, tied_victims, pvp_gear_snapshot, f"Defend Purse vs. {thief_p['name']}'s Plautilla Heist"
                )
            else:
                victim_p = tied_victims[0]

            _record_climate_delta(
                victim_p,
                "plautilla_1",
                "Plautilla",
                "Exile's Informants (Raided)",
                -15,
                f"15(d) stolen by {thief_p['name']} (Most Plautilla Favor)",
            )
            _record_climate_delta(
                thief_p,
                "plautilla_1",
                "Plautilla",
                "Exile's Informants",
                15,
                f"Stole 15(d) from wealthiest rival {victim_p['name']}",
            )
            add_log(
                state,
                f"Exile's Informants: {thief_p['name']} (Most Plautilla Favor {max_pla:+d}) stole 15(d) from wealthiest rival {victim_p['name']}!",
                "phase",
            )

        # Step 7: Domna Option 1 (Imperial Patronage) — Most Domna favor gains +20% of final wealth (after flat modifiers & steals)
        if has_climate_modifier(state, "domna_1") and players:
            max_dom = max(int((p.get("favor") or {}).get("Domna", 0)) for p in players)
            tied_dom = [p for p in players if int((p.get("favor") or {}).get("Domna", 0)) == max_dom]
            if len(tied_dom) > 1:
                add_log(
                    state,
                    f"⚔️ Tie for Most Domna Favor ({max_dom:+d}) between {', '.join(x['name'] for x in tied_dom)} — PvP Combat decides the +20% Imperial Patronage!",
                    "combat",
                )
                win_dom = _resolve_multiway_pvp_winner(
                    state, tied_dom, pvp_gear_snapshot, f"Most Domna Favor ({max_dom:+d}) +20% Wealth"
                )
                det_d1_prefix = f"Won PvP Tie-Break for Most Domna Favor ({max_dom:+d})"
            else:
                win_dom = tied_dom[0]
                det_d1_prefix = f"Sole Most Domna Favor ({max_dom:+d})"
            base_wealth = int(win_dom.get("cash", 0))
            dom_bonus = (base_wealth * 20 + 50) // 100 if base_wealth > 0 else 0
            _record_climate_delta(
                win_dom,
                "domna_1",
                "Domna",
                "Imperial Patronage",
                dom_bonus,
                f"{det_d1_prefix}: +20% of {base_wealth}d = +{dom_bonus}d",
            )
            add_log(
                state,
                f"Imperial Patronage: {win_dom['name']} gains +{dom_bonus}(d) (+20% of {base_wealth}d)!",
                "phase",
            )

        # Step 8: Caracalla Option 1 (Imperial Proscription) — Least Caracalla favor is ELIMINATED!
        if has_climate_modifier(state, "caracalla_1") and len(players) >= 2:
            min_car = min(int((p.get("favor") or {}).get("Caracalla", 0)) for p in players)
            tied_least_car = [p for p in players if int((p.get("favor") or {}).get("Caracalla", 0)) == min_car]
            if len(tied_least_car) > 1:
                add_log(
                    state,
                    f"⚔️ Tie for Least Caracalla Favor ({min_car:+d}) between {', '.join(x['name'] for x in tied_least_car)} — PvP Combat to survive Caracalla's Purge!",
                    "combat",
                )
                elim_p = _resolve_multiway_pvp_loser(
                    state, tied_least_car, pvp_gear_snapshot, f"Survive Caracalla's Purge (Least Favor {min_car:+d})"
                )
                elim_reason = f"Eliminated after losing PvP Tie-Break for Least Caracalla Favor ({min_car:+d})"
            else:
                elim_p = tied_least_car[0]
                elim_reason = f"Eliminated for holding Least Caracalla Favor ({min_car:+d})"
            elim_p["eliminated"] = True
            elim_p["eliminationReason"] = elim_reason
            climate_breakdown_map[elim_p["index"]].append({
                "id": "caracalla_1",
                "factor": "Caracalla",
                "title": "Imperial Proscription",
                "delta": 0,
                "eliminated": True,
                "detail": elim_reason,
            })
            add_log(state, f"☠️ IMPERIAL PROSCRIPTION! {elim_p['name']} is purged by Caracalla ({elim_reason})!", "penalty")

        # Step 9: Finalize winterReckoning summaries & rank surviving Merchants (breaking 1st-place ties via PvP Combat!)
        for p in players:
            idx_p = int(p["index"])
            st_p = _ensure_player_stats(p)
            comp_c = int(st_p.get("missionsCompleted", 0) or 0)
            fail_c = int(st_p.get("missionsFailed", 0) or 0)
            net_c = comp_c - fail_c
            pla_c = int(st_p.get("plautillaMissionsCompleted", 0) or 0)
            clim_items = climate_breakdown_map[idx_p]
            clim_delta = sum(int(x.get("delta", 0)) for x in clim_items)
            fac_bd = fac_breakdown_map[idx_p]
            fac_tot = sum(fac_bd.values())
            m_bon = int(mission_bonus_map.get(idx_p, 0))
            p["winterReckoning"] = {
                "preReckoningCash": pre_cash_map[idx_p],
                "step1MissionFines": step1_fine_map[idx_p],
                "goodsLiquidated": liq_map[idx_p],
                "loansDeducted": loan_map[idx_p],
                "climateDelta": clim_delta,
                "climateBreakdown": clim_items,
                "factionDelta": fac_tot,
                "factionBreakdown": fac_bd,
                "missionsCompleted": comp_c,
                "missionsFailed": fail_c,
                "netMissions": net_c,
                "plautillaMissionsCompleted": pla_c,
                "missionBonus": m_bon,
                "eliminated": bool(p.get("eliminated", False)),
                "eliminationReason": p.get("eliminationReason"),
                "finalCash": int(p["cash"]),
            }
            elim_tag = f" [ELIMINATED: {p['eliminationReason']}]" if p.get("eliminated") else ""
            clim_summary = ", ".join(
                f"{it['title']} {'ELIMINATED' if it.get('eliminated') else ('+' + str(it['delta']) + 'd' if int(it['delta']) >= 0 else str(it['delta']) + 'd')}"
                for it in clim_items
            ) or "No end-game modifiers"
            add_log(
                state,
                f"Winter Reckoning for {p['name']}: Climate {clim_delta:+d}(d) ({clim_summary}) -> Final Total: {p['cash']}(d){elim_tag}.",
                "phase",
            )

        survivors = [p for p in players if not p.get("eliminated")]
        contenders = survivors if survivors else list(players)
        ranked = sorted(contenders, key=lambda x: x["cash"], reverse=True)
        top_cash = ranked[0]["cash"]
        tied = [p for p in ranked if p["cash"] == top_cash]
        if len(tied) > 1:
            winner_p = _resolve_multiway_pvp_winner(state, tied, pvp_gear_snapshot, f"Final Wealth Tie-Breaker ({top_cash}d)")
            state["winner"] = winner_p["name"]
            add_log(state, f"TIE-BREAKER COMBAT! {winner_p['name']} triumphed in tie-breaking combat with {top_cash}(d)!", "phase")
        else:
            state["winner"] = ranked[0]["name"]
            add_log(state, f"VICTORY! {ranked[0]['name']} survives the purge of 211 A.D. as Rome's wealthiest merchant with {top_cash}(d)!", "phase")
        state["phase"] = "finished"
        state["finalStandings"] = _build_final_standings(state)


def handle_player_action(
    state: Dict[str, Any],
    user_id: Optional[int],
    action: Dict[str, Any],
    allow_undo_map: Optional[Dict[int, bool]] = None,
) -> Tuple[bool, str]:
    """Validates and executes a player action, including Undo Turn requests/approvals, then runs AI bots until the next human decision."""
    _normalize_state_encounter_cards(state)
    act_type = action.get("type", "")
    allow_undo_map = allow_undo_map or {}

    human_players = [p for p in state.get("players", []) if not p.get("isBot")]
    req_player = next((p for p in human_players if p.get("userId") == user_id), None)
    if not req_player and len(human_players) == 1:
        req_player = human_players[0]

    # --- UNDO TURN ACTIONS ---
    if act_type == "request_undo_turn":
        if not req_player:
            return False, "Only human players in this game may request an Undo."
        if state.get("pendingUndoRequest"):
            return False, "An Undo Turn request is already awaiting approval."
        target_idx, target_type, target_label = _get_undo_target_info(state)
        if target_idx is None or not target_type:
            return False, "Nothing to undo yet — game is at the beginning of the initial turn."

        other_humans = [
            p for p in human_players
            if p["index"] != req_player["index"] and p.get("userId") is not None
        ]
        if not other_humans:
            restored_lbl = _execute_undo_restore(state, target_idx, req_player["name"], target_type)
            which_desc = "beginning of current turn" if target_type == "current_turn" else "beginning of previous turn"
            return True, f"Reverted to {which_desc} ({restored_lbl})."

        required_uids: List[Any] = []
        required_names: List[str] = []
        auto_approved_uids: List[Any] = [req_player["userId"]] if req_player.get("userId") is not None else []
        auto_approved_names: List[str] = []
        for oh in other_humans:
            oh_uid = oh["userId"]
            if allow_undo_map.get(oh_uid, False) or allow_undo_map.get(str(oh_uid), False):
                auto_approved_uids.append(oh_uid)
                auto_approved_names.append(oh["name"])
            else:
                required_uids.append(oh_uid)
                required_names.append(oh["name"])

        if not required_uids:
            restored_lbl = _execute_undo_restore(state, target_idx, req_player["name"], target_type)
            which_desc = "beginning of current turn" if target_type == "current_turn" else "beginning of previous turn"
            return True, f"Undo auto-approved by player profile settings — reverted to {which_desc} ({restored_lbl})."

        state["pendingUndoRequest"] = {
            "id": f"undo_{secrets.token_hex(4)}",
            "requesterUserId": req_player.get("userId"),
            "requesterName": req_player["name"],
            "requesterPlayerIndex": req_player["index"],
            "targetSnapshotIndex": target_idx,
            "targetType": target_type,
            "targetLabel": target_label or "Beginning of Turn",
            "requiredUserIds": required_uids,
            "requiredNames": required_names,
            "approvedUserIds": auto_approved_uids,
            "autoApprovedNames": auto_approved_names,
        }
        which_desc = "beginning of current turn" if target_type == "current_turn" else "beginning of previous turn"
        add_log(
            state,
            f"↩️ {req_player['name']} requested to Undo Turn back to the {which_desc} ({target_label}). Waiting for approval from {', '.join(required_names)}.",
            "info",
        )
        return True, f"Undo requested — waiting for {', '.join(required_names)} to approve."

    if act_type == "respond_undo_turn":
        pend_u = state.get("pendingUndoRequest")
        if not pend_u:
            return False, "There is no pending Undo Turn request."
        if not req_player or req_player.get("userId") is None:
            return False, "Only human players in this game may vote on an Undo request."
        uid_val = req_player["userId"]
        decision = action.get("decision", "approve")
        if decision == "reject":
            state["pendingUndoRequest"] = None
            add_log(state, f"✕ {req_player['name']} declined {pend_u['requesterName']}'s Undo Turn request.", "info")
            return True, f"Declined {pend_u['requesterName']}'s Undo Turn request."
        if uid_val not in pend_u.get("requiredUserIds", []):
            return False, "You have already approved this Undo request (or your approval is not pending)."
        pend_u["requiredUserIds"] = [u for u in pend_u["requiredUserIds"] if u != uid_val]
        rem_names = [
            p["name"] for p in human_players
            if p.get("userId") in pend_u["requiredUserIds"]
        ]
        pend_u["requiredNames"] = rem_names
        if uid_val not in pend_u.get("approvedUserIds", []):
            pend_u.setdefault("approvedUserIds", []).append(uid_val)
        if not pend_u["requiredUserIds"]:
            restored_lbl = _execute_undo_restore(
                state,
                int(pend_u["targetSnapshotIndex"]),
                pend_u["requesterName"],
                pend_u["targetType"],
            )
            return True, f"All players approved! Reverted to {restored_lbl}."
        add_log(state, f"✓ {req_player['name']} approved {pend_u['requesterName']}'s Undo request.", "info")
        return True, f"Approved Undo request ({len(pend_u['requiredUserIds'])} player(s) still pending)."

    if act_type == "cancel_undo_turn":
        pend_u = state.get("pendingUndoRequest")
        if not pend_u:
            return False, "No pending Undo request to cancel."
        if not req_player or req_player.get("userId") != pend_u.get("requesterUserId"):
            return False, "Only the player who requested the Undo may cancel it."
        state["pendingUndoRequest"] = None
        add_log(state, f"{req_player['name']} canceled their Undo Turn request.", "info")
        return True, "Undo Turn request canceled."

    if state.get("pendingUndoRequest"):
        pend_u = state["pendingUndoRequest"]
        return False, f"Game is paused while {pend_u['requesterName']}'s Undo Turn request awaits approval."

    # Backfill initial turn snapshot for pre-existing games loaded from DB
    if not state.get("turnSnapshotHistory"):
        state.setdefault("turnSeq", 1)
        state.setdefault("hasActedThisTurn", False)
        _record_turn_start_snapshot(state)

    prev_turn_seq = int(state.get("turnSeq", 1))
    ok, msg = _execute_player_action_inner(state, user_id, action)
    if ok:
        new_turn_seq = int(state.get("turnSeq", 1))
        if new_turn_seq != prev_turn_seq:
            _record_turn_start_snapshot(state)
        else:
            state["hasActedThisTurn"] = True
    return ok, msg


def _execute_player_action_inner(state: Dict[str, Any], user_id: Optional[int], action: Dict[str, Any]) -> Tuple[bool, str]:
    """Internal turn/phase action executor."""
    act_type = action.get("type", "")

    if state["phase"] == "finished":
        return False, "This game has already finished."

    # 0. Resolve Pending Cart / Guard Overflow (from Mission, Combat, or Patron rewards)
    if act_type == "resolve_cart_overflow":
        ovf_id = action.get("overflowId")
        target_p = next(
            (
                p for p in state["players"]
                if not p["isBot"]
                and p.get("pendingCartOverflow")
                and (not ovf_id or any(o.get("id") == ovf_id for o in p.get("pendingCartOverflow", [])))
            ),
            None,
        )
        if not target_p:
            target_p = state["players"][state["activePlayerIndex"]]
        if not target_p["isBot"] and target_p.get("userId") is not None and user_id != target_p.get("userId"):
            return False, "Not authorized."
        queue = target_p.get("pendingCartOverflow") or []
        if not queue:
            return False, "No pending Cart or Guard space decision active."
        ovf = next((o for o in queue if o.get("id") == ovf_id), queue[0])
        card = ovf.get("card") or {}
        is_guard = ovf.get("itemType") == "guard" or card.get("track") == "Guards"
        decision = action.get("decision", "accept")

        if decision in ("refuse", "decline", "cancel"):
            target_p["pendingCartOverflow"] = [o for o in queue if o.get("id") != ovf.get("id")]
            _return_overflow_card_to_origin(state, card, ovf.get("origin"))
            add_log(
                state,
                f"{target_p['name']} refused {'Guard' if is_guard else 'Good'} '{card.get('name', 'Item')}' (Cart space full).",
                "action",
            )
            if not target_p.get("pendingCartOverflow"):
                _finish_pending_encounter_continuations(state, target_p)
            run_bots_until_human(state)
            return True, f"Refused {card.get('name', 'item')}."

        ok_swap, err_swap, swap_notes = _validate_and_apply_cart_space_swaps(
            state,
            target_p,
            discard_cart_ids=action.get("discardCartIds"),
            fire_guard_ids=action.get("fireGuardIds"),
            incoming_blocks=0 if is_guard else int(card.get("blocks", 1) or 1),
            incoming_guards=int(card.get("guards", 1) or 1) if is_guard else 0,
            incoming_bonus_blocks=int(card.get("bonusBlocks", 0) or 0),
            incoming_bonus_guards=int(card.get("bonusGuards", 0) or 0),
            reason=f"to make room for {card.get('name', 'new item')}",
        )
        if not ok_swap:
            return False, err_swap

        target_p["pendingCartOverflow"] = [o for o in queue if o.get("id") != ovf.get("id")]
        if is_guard:
            target_p["guards"].append(card)
            add_log(
                state,
                f"{target_p['name']} accepted Guard '{card.get('name', 'Guard')}' ({', '.join(swap_notes) or 'space available'}).",
                "action",
            )
        else:
            target_p["cart"].append(card)
            add_log(
                state,
                f"{target_p['name']} loaded '{card.get('name', 'Good')}' onto their Cart ({', '.join(swap_notes) or 'space available'}).",
                "action",
            )

        if state.get("pendingEncounter") and state["pendingEncounter"].get("stage", "pre_decision") == "pre_decision":
            pend_curr = state["pendingEncounter"]
            enc_p = state["players"][pend_curr["playerIndex"]]
            prev_int = pend_curr.get("interveningPlayerIndex")
            state["pendingEncounter"] = _build_pending_encounter_state(
                state,
                enc_p,
                pend_curr["card"],
                pend_curr.get("deck", "patricii"),
                pend_curr.get("xCount", 1),
            )
            if prev_int is not None:
                state["pendingEncounter"]["interveningPlayerIndex"] = prev_int

        if not target_p.get("pendingCartOverflow") and not target_p.get("pendingMarketReward"):
            _finish_pending_encounter_continuations(state, target_p)
        run_bots_until_human(state)
        return True, f"Added {card.get('name', 'item')} to your Cart!"

    # 0B. Resolve Pending Market Board Reward Choice (e.g. Vigilante -> Any Meat Animal on Market)
    if act_type == "resolve_market_reward":
        rwd_id = action.get("rewardId")
        target_p = next(
            (
                p for p in state["players"]
                if not p["isBot"]
                and p.get("pendingMarketReward")
                and (not rwd_id or any(r.get("id") == rwd_id for r in p.get("pendingMarketReward", [])))
            ),
            None,
        )
        if not target_p:
            target_p = state["players"][state["activePlayerIndex"]]
        if not target_p["isBot"] and target_p.get("userId") is not None and user_id != target_p.get("userId"):
            return False, "Not authorized."
        queue = target_p.get("pendingMarketReward") or []
        if not queue:
            return False, "No pending Market Board reward selection active."
        rwd = next((r for r in queue if r.get("id") == rwd_id), queue[0])
        track_name = rwd.get("track", "Animals")
        subcat = rwd.get("subcategory")
        cat_lbl = rwd.get("categoryLabel") or _singular_category_label(subcat or track_name)
        decision = action.get("decision", "accept")

        if decision in ("refuse", "decline", "cancel"):
            target_p["pendingMarketReward"] = [r for r in queue if r.get("id") != rwd.get("id")]
            _prune_empty_pending_market_rewards(state, target_p)
            add_log(
                state,
                f"{target_p['name']} declined Market Board reward ({cat_lbl}).",
                "action",
            )
            if not target_p.get("pendingMarketReward") and not target_p.get("pendingCartOverflow"):
                _finish_pending_encounter_continuations(state, target_p)
            run_bots_until_human(state)
            return True, f"Declined {cat_lbl} reward."

        track = state["marketBoard"].get(track_name, [])
        candidates = [(i, c) for i, c in enumerate(track) if not subcat or matches_category(c, subcat)]
        if not candidates:
            target_p["pendingMarketReward"] = [r for r in queue if r.get("id") != rwd.get("id")]
            _prune_empty_pending_market_rewards(state, target_p)
            if not target_p.get("pendingMarketReward") and not target_p.get("pendingCartOverflow"):
                _finish_pending_encounter_continuations(state, target_p)
            run_bots_until_human(state)
            return False, f"No matching {cat_lbl} remains on the Ostia Market Board."

        card_id = action.get("cardId")
        chosen_pair = next(((i, c) for i, c in candidates if c.get("id") == card_id), None)
        if not chosen_pair:
            return False, f"Please select a valid {cat_lbl} card from the Ostia Market Board."

        pick_idx, pick_card = chosen_pair
        is_guard = pick_card.get("track") == "Guards" or int(pick_card.get("guards", 0) or 0) > 0
        ok_swap, err_swap, swap_notes = _validate_and_apply_cart_space_swaps(
            state,
            target_p,
            discard_cart_ids=action.get("discardCartIds"),
            fire_guard_ids=action.get("fireGuardIds"),
            incoming_blocks=0 if is_guard else int(pick_card.get("blocks", 1) or 1),
            incoming_guards=int(pick_card.get("guards", 1) or 1) if is_guard else 0,
            incoming_bonus_blocks=int(pick_card.get("bonusBlocks", 0) or 0),
            incoming_bonus_guards=int(pick_card.get("bonusGuards", 0) or 0),
            reason=f"to make room for {pick_card.get('name', 'Market reward')}",
        )
        if not ok_swap:
            return False, err_swap

        # Pop the chosen card from the Ostia Market Board track
        actual_idx = next((idx_t for idx_t, c_t in enumerate(track) if c_t.get("id") == pick_card.get("id")), pick_idx)
        claimed_card = track.pop(actual_idx)
        target_p["pendingMarketReward"] = [r for r in queue if r.get("id") != rwd.get("id")]
        _prune_empty_pending_market_rewards(state, target_p)

        swap_suffix = f" ({', '.join(swap_notes)})" if swap_notes else ""
        if is_guard:
            target_p["guards"].append(claimed_card)
            add_log(
                state,
                f"{target_p['name']} claimed Guard '{claimed_card.get('name', 'Guard')}' from the Ostia Market Board{swap_suffix}!",
                "action",
            )
        else:
            target_p["cart"].append(claimed_card)
            add_log(
                state,
                f"{target_p['name']} claimed '{claimed_card.get('name', 'Good')}' from the Ostia Market Board{swap_suffix}!",
                "action",
            )

        check_passive_missions(state, target_p)
        if state.get("pendingEncounter") and state["pendingEncounter"].get("stage", "pre_decision") == "pre_decision":
            pend_curr = state["pendingEncounter"]
            enc_p = state["players"][pend_curr["playerIndex"]]
            prev_int = pend_curr.get("interveningPlayerIndex")
            state["pendingEncounter"] = _build_pending_encounter_state(
                state,
                enc_p,
                pend_curr["card"],
                pend_curr.get("deck", "patricii"),
                pend_curr.get("xCount", 1),
            )
            if prev_int is not None:
                state["pendingEncounter"]["interveningPlayerIndex"] = prev_int

        if not target_p.get("pendingMarketReward") and not target_p.get("pendingCartOverflow"):
            _finish_pending_encounter_continuations(state, target_p)
        run_bots_until_human(state)
        return True, f"Claimed {claimed_card.get('name', 'item')} from the Ostia Market Board!"

    human_count = sum(1 for p in state["players"] if not p["isBot"])

    # 1. Setup discard phase (can be submitted by any human player who hasn't discarded yet)
    if state["phase"] == "setup_discard":
        player = next((p for p in state["players"] if p.get("userId") == user_id and not p["setupDiscarded"]), None)
        if not player and human_count == 1:
            player = next((p for p in state["players"] if not p["isBot"] and not p["setupDiscarded"]), None)
        if not player:
            return False, "Setup discard already completed or not authorized."

        disc_m_ids = set(action.get("discardMissionIds", []))
        disc_i_ids = set(action.get("discardInfluenceIds", []))
        if len(player["missions"]) >= 5 and len(disc_m_ids) != 2:
            return False, "Please select exactly 2 Starting Mission cards to discard."
        if len(player["influence"]) >= 5 and len(disc_i_ids) != 2:
            return False, "Please select exactly 2 Influence cards to discard."

        kept_m, d_m = [], []
        for m in player["missions"]:
            (d_m if m["id"] in disc_m_ids else kept_m).append(m)
        player["missions"] = kept_m
        state["decks"]["missiones"].extend(d_m)

        kept_i, d_i = [], []
        for c in player["influence"]:
            (d_i if c["id"] in disc_i_ids else kept_i).append(c)
        player["influence"] = kept_i
        state["decks"]["influence"].extend(d_i)

        player["setupDiscarded"] = True
        disc_order = state.setdefault("setupDiscardOrder", [])
        if player["index"] not in disc_order:
            disc_order.append(player["index"])
        add_log(state, f"{player['name']} selected 3 Starting Missions and 3 Influence cards.", "action")
        if all(p["setupDiscarded"] for p in state["players"] if not p["isBot"]):
            for p_bot in state["players"]:
                if p_bot["isBot"] and not p_bot["setupDiscarded"]:
                    _bot_complete_setup_discard(state, p_bot)
        _check_all_setup_discards_done(state)
        return True, "Starting hand confirmed."

    # 1A. Political Climate draft phase (snake draft in 2P; 1 pick per player up to 6 in 3P+)
    if state["phase"] == "setup_climate":
        if act_type != "select_climate_option":
            return False, "Please finish selecting the game's Political Climate options before starting Ostia Market."
        player = state["players"][state["activePlayerIndex"]]
        if not player["isBot"] and player.get("userId") is not None and user_id != player.get("userId"):
            if human_count != 1:
                return False, f"Waiting for {player['name']} to choose a Political Climate option."
        option_id = str(action.get("optionId", "")).strip()
        ok_pick, msg_pick = _apply_climate_option_pick(state, player, option_id)
        if not ok_pick:
            return False, msg_pick
        run_bots_until_human(state)
        return True, msg_pick

    # 1A-2. Empress Mediator (Domna Option 3): Exchange positive Diamonds 1-for-1 into Rubies or Emeralds at any time
    if act_type == "exchange_domna_diamond":
        if not has_climate_modifier(state, "domna_3"):
            return False, "Empress Mediator is not active in this game's Political Climate."
        ex_player = next((p for p in state["players"] if not p["isBot"] and p.get("userId") == user_id), None)
        if not ex_player and human_count == 1:
            ex_player = next((p for p in state["players"] if not p["isBot"]), None)
        if not ex_player:
            return False, "Not authorized to exchange Diamonds."
        target_fac = str(action.get("targetFaction", "")).strip()
        if target_fac not in ("Caracalla", "Geta"):
            return False, "Diamonds may only be exchanged for Rubies (Caracalla) or Emeralds (Geta)."
        try:
            cnt = int(action.get("count", 1) or 1)
        except (TypeError, ValueError):
            return False, "Invalid Diamond exchange count."
        if cnt < 1:
            return False, "Must exchange at least 1 positive Diamond."
        cur_dom = int((ex_player.get("favor") or {}).get("Domna", 0))
        if cur_dom < cnt:
            return False, f"You only have +{max(0, cur_dom)} positive Diamond(s) available to exchange."
        ex_player["favor"]["Domna"] = cur_dom - cnt
        ex_player["favor"][target_fac] = int(ex_player["favor"].get(target_fac, 0)) + cnt
        hist = ex_player.setdefault("favorHistory", {f: [] for f in FACTIONS})
        gem_lbl = "Ruby" if target_fac == "Caracalla" else "Emerald"
        gem_pl = "Rubies" if target_fac == "Caracalla" else "Emeralds"
        hist.setdefault("Domna", []).append({
            "delta": -cnt,
            "reason": f"Empress Mediator exchange -> +{cnt} {gem_lbl if cnt == 1 else gem_pl} ({target_fac})",
            "newTotal": ex_player["favor"]["Domna"],
        })
        hist.setdefault(target_fac, []).append({
            "delta": cnt,
            "reason": f"Empress Mediator exchange from {cnt} Diamond{'s' if cnt != 1 else ''}",
            "newTotal": ex_player["favor"][target_fac],
        })
        add_log(
            state,
            f"💎 {ex_player['name']} invoked Empress Mediator to exchange {cnt} Diamond{'s' if cnt != 1 else ''} for +{cnt} {target_fac} Favor!",
            "action",
        )
        # Refresh pending encounter reactions if the player just shifted Favor before making an encounter choice
        if state.get("pendingEncounter") and state["pendingEncounter"].get("stage", "pre_decision") == "pre_decision":
            pend_curr = state["pendingEncounter"]
            if pend_curr.get("playerIndex") == ex_player["index"]:
                prev_int = pend_curr.get("interveningPlayerIndex")
                state["pendingEncounter"] = _build_pending_encounter_state(
                    state,
                    ex_player,
                    pend_curr["card"],
                    pend_curr.get("deck", "patricii"),
                    pend_curr.get("xCount", 1),
                )
                if prev_int is not None:
                    state["pendingEncounter"]["interveningPlayerIndex"] = prev_int
        return True, f"Exchanged {cnt} Diamond{'s' if cnt != 1 else ''} for +{cnt} {target_fac} Favor!"

    # 1B. Step 4 Delivery cargo loading & mission delivery (allowed BEFORE resolving a Step 5 pendingEncounter!)
    if state["phase"] == "delivery" and act_type == "delivery_load_cargo":
        mission_id = action.get("missionId", "")
        target_p = next(
            (
                p for p in state["players"]
                if not p["isBot"] and any(m.get("id") == mission_id for m in p.get("missions", []))
            ),
            None,
        )
        if not target_p:
            target_p = state["players"][state["activePlayerIndex"]]
        if not target_p["isBot"] and target_p.get("userId") is not None and user_id != target_p.get("userId"):
            return False, "You can only load cargo onto your own Cart."
        m = next((x for x in target_p.get("missions", []) if x.get("id") == mission_id), None)
        if not m:
            return False, "Mission not found."
        if m.get("kind") != "delivery":
            return False, "This mission does not have loadable cargo."
        if m.get("pickedUp"):
            return False, "Cargo for this mission is already loaded onto your Cart."
        curr_cell = normalize_cell_id(target_p.get("position"))
        pickup_cell = normalize_cell_id(m.get("pickupCell"))
        if not curr_cell or curr_cell != pickup_cell:
            return False, f"You must be in {pickup_cell} to load this cargo."
        req_b = int(m.get("blocks", 1))
        ok_swap, err_swap, _ = _validate_and_apply_cart_space_swaps(
            state,
            target_p,
            discard_cart_ids=action.get("discardCartIds"),
            fire_guard_ids=action.get("fireGuardIds"),
            incoming_blocks=req_b,
            reason=f"to load {m.get('item', 'Cargo')} for Mission '{m['name']}'",
        )
        if not ok_swap:
            return False, err_swap
        if m not in target_p.get("missions", []):
            return False, "Mission is no longer active."
        m["pickedUp"] = True
        target_p["cart"].append(_create_mission_cargo_card(m))
        add_log(
            state,
            f"{target_p['name']} loaded {m.get('item', 'Cargo')} ({req_b}■) onto their Cart in {curr_cell} for Mission '{m['name']}'.",
            "mission",
        )
        check_passive_missions(state, target_p)
        return True, f"Loaded {m.get('item', 'Cargo')} ({req_b}■) onto your Cart!"

    if state["phase"] == "delivery" and act_type == "delivery_complete_mission":
        mission_id = action.get("missionId", "")
        target_p = next(
            (
                p for p in state["players"]
                if not p["isBot"] and any(m.get("id") == mission_id for m in p.get("missions", []))
            ),
            None,
        )
        if not target_p:
            target_p = state["players"][state["activePlayerIndex"]]
        if not target_p["isBot"] and target_p.get("userId") is not None and user_id != target_p.get("userId"):
            return False, "You can only complete your own Mission."
        m = next((x for x in target_p.get("missions", []) if x.get("id") == mission_id), None)
        if not m:
            return False, "Mission not found."
        if m.get("kind") == "expose":
            req_cnt = int(m.get("exposeCount", 4))
            cur_cnt = count_exposed_icons(state, m.get("exposeType", "patricii"))
            if cur_cnt < req_cnt:
                return False, f"Need {req_cnt} exposed {m.get('exposeType', 'patricii').capitalize()} icons ({cur_cnt}/{req_cnt} currently exposed)."
            check_passive_missions(state, target_p)
            return True, f"Completed Mission '{m.get('name', 'Mission')}'!"
        if m.get("kind") != "delivery":
            return False, "This mission cannot be completed with this action."
        if not m.get("pickedUp"):
            return False, f"You must first pick up {m.get('item', 'the cargo')} in {normalize_cell_id(m.get('pickupCell'))}."
        curr_cell = normalize_cell_id(target_p.get("position"))
        deliver_cell = normalize_cell_id(m.get("deliverCell"))
        if not curr_cell or curr_cell != deliver_cell:
            return False, f"You must be in {deliver_cell} to deliver this cargo."
        msg = _complete_delivery_mission(state, target_p, m, curr_cell)
        return True, msg

    # 2. Pending Encounter Choice (including human intervention on another player's encounter/combat/chart roll)
    if state.get("pendingEncounter"):
        pend = state["pendingEncounter"]
        enc_player = state["players"][pend["playerIndex"]]
        intervenor_idx = pend.get("interveningPlayerIndex")
        acting_player = state["players"][intervenor_idx] if intervenor_idx is not None else enc_player
        if not acting_player["isBot"] and acting_player.get("userId") is not None and user_id != acting_player.get("userId"):
            return False, "Waiting for the active player to resolve their encounter."
        if act_type == "play_influence":
            card_id = action.get("cardId")
            card = next((c for c in acting_player["influence"] if c["id"] == card_id), None)
            if not card and acting_player["index"] != enc_player["index"]:
                card = next((c for c in enc_player["influence"] if c["id"] == card_id), None)
                if card:
                    acting_player = enc_player
            if not card:
                return False, "Influence card not found in hand."
            ok, msg = _execute_influence_card(state, acting_player, card, action)
            if ok and state.get("pendingEncounter") and state["pendingEncounter"].get("stage", "pre_decision") == "pre_decision":
                prev_int = state["pendingEncounter"].get("interveningPlayerIndex")
                state["pendingEncounter"] = _build_pending_encounter_state(
                    state,
                    enc_player,
                    pend["card"],
                    pend.get("deck", "patricii"),
                    pend.get("xCount", 1),
                )
                if prev_int is not None:
                    state["pendingEncounter"]["interveningPlayerIndex"] = prev_int
            elif ok and not state.get("pendingEncounter"):
                _finish_pending_encounter_continuations(state, enc_player)
                run_bots_until_human(state)
            return ok, msg
        if act_type not in ("resolve_encounter", "encounter_choice"):
            return False, "Please resolve the current encounter or die roll window first."
        decision = action.get("decision", "fulfill")
        valid_decisions = (
            "fulfill",
            "refuse",
            "fight",
            "use_dog",
            "use_plea",
            "use_casus_belli",
            "resolve_event",
            "roll_chart_encounter",
            "confirm_consumables_and_roll",
            "finalize_combat",
            "roll_driver_fate",
            "finalize_driver_fate",
            "finalize_chart_roll",
            "finalize_demand_roll",
            "finalize_gamble_roll",
        )
        if decision not in valid_decisions:
            return False, "Invalid encounter decision."
        raw_use_cons = action.get("useConsumableIds")
        use_cons_list = [str(x) for x in raw_use_cons] if isinstance(raw_use_cons, list) else None
        ok, msg = resolve_pending_encounter_choice(state, enc_player, pend, decision, use_consumable_ids=use_cons_list)
        if not ok:
            return False, msg
        if not state.get("pendingEncounter") and not enc_player.get("pendingNpcOffer") and not enc_player.get("pendingCartOverflow") and not enc_player.get("pendingMarketReward"):
            _finish_pending_encounter_continuations(state, enc_player)
        run_bots_until_human(state)
        return True, msg

    # 3. Cleanup Phase actions
    if state["phase"] == "cleanup":
        player = next((p for p in state["players"] if p.get("userId") == user_id and not p["cleanupDone"]), None)
        if not player and human_count == 1:
            player = next((p for p in state["players"] if not p["isBot"] and not p["cleanupDone"]), None)
        if not player:
            return False, "Clean-up already completed for this season or not authorized."

        if act_type == "cleanup_buy_influence":
            cost = get_influence_buy_price(player)
            if player["cash"] < cost:
                return False, f"Insufficient Denarii (requires {cost}(d))."
            if not state["decks"]["influence"]:
                return False, "Influence deck is empty."
            player["cash"] -= cost
            card = state["decks"]["influence"].pop(0)
            player["influence"].append(card)
            add_log(state, f"{player['name']} purchased an Influence card for {cost}(d).", "action")
            return True, f"Bought Influence card '{card['name']}' for {cost}(d)."

        if act_type == "cleanup_take_loan":
            season_key = state["season"].lower()
            if season_key == "spring" and not player["loans"]["spring"]:
                player["loans"]["spring"] = True
                player["cash"] += 20
                add_log(state, f"{player['name']} took out the 20(d) Spring Loan.", "action")
                return True, "Received 20(d) Spring Loan."
            if season_key == "summer" and not player["loans"]["summer"]:
                player["loans"]["summer"] = True
                player["cash"] += 40
                add_log(state, f"{player['name']} took out the 40(d) Summer Loan.", "action")
                return True, "Received 40(d) Summer Loan."
            return False, "Loan not available for this season or already taken."

        if act_type == "cleanup_repay_loan":
            season_key = state["season"].lower()
            req_loan = str(action.get("loanType") or "").strip().lower()
            if not req_loan:
                req_loan = "spring" if player["loans"].get("spring") else "summer"
            if req_loan == "spring" and player["loans"].get("spring") and season_key in ("summer", "fall"):
                cost = 30 if season_key == "summer" else 45
                if player["cash"] < cost:
                    return False, f"Insufficient Denarii to repay Spring Loan (requires {cost}(d))."
                player["cash"] -= cost
                player["loans"]["spring"] = False
                add_log(state, f"{player['name']} repaid the Spring Loan for {cost}(d).", "action")
                return True, f"Repaid Spring Loan ({cost}d)."
            if req_loan == "summer" and player["loans"].get("summer") and season_key == "fall":
                cost = 60
                if player["cash"] < cost:
                    return False, f"Insufficient Denarii to repay Summer Loan (requires {cost}(d))."
                player["cash"] -= cost
                player["loans"]["summer"] = False
                add_log(state, f"{player['name']} repaid the Summer Loan for {cost}(d).", "action")
                return True, f"Repaid Summer Loan ({cost}d)."
            return False, "Cannot repay that loan right now."

        if act_type == "cleanup_finish":
            keep_guard_ids = set(action.get("keepGuardIds", [g["id"] for g in player["guards"]]))
            kept, released = [], []
            for g in player["guards"]:
                if g["id"] in keep_guard_ids:
                    cost = get_guard_upkeep_cost(state, g)
                    if player["cash"] >= cost:
                        player["cash"] -= cost
                        kept.append(g)
                    else:
                        released.append(g)
                        state["decks"]["market"].append(g)
                else:
                    released.append(g)
                    state["decks"]["market"].append(g)
            player["guards"] = kept
            player["cleanupDone"] = True
            add_log(state, f"{player['name']} completed Clean-Up (kept {len(kept)} guard(s), released {len(released)}).", "action")
            _check_all_cleanups_done(state)
            return True, "Clean-Up completed."

    # Voluntary Mission Cancellation (Starting: no penalty; Encounter: Hostile Favor penalty; Soothsayer: only if >5 active Soothsayer missions)
    if act_type == "cancel_mission":
        mission_id = action.get("missionId", "")
        target_p = next(
            (
                p for p in state["players"]
                if not p["isBot"] and any(m.get("id") == mission_id for m in p.get("missions", []))
            ),
            None,
        )
        if not target_p:
            target_p = state["players"][state["activePlayerIndex"]]
        if not target_p["isBot"] and target_p.get("userId") is not None and user_id != target_p.get("userId"):
            return False, "You can only cancel your own Missions."
        m = next((x for x in target_p.get("missions", []) if x.get("id") == mission_id), None)
        if not m:
            return False, "Mission not found."
        src = m.get("source") or "starting"
        if src == "soothsayer":
            sooth_count = sum(1 for x in target_p.get("missions", []) if x.get("source") == "soothsayer")
            if sooth_count <= 5:
                return (
                    False,
                    "Canceling or failing a Soothsayer mission is impossible unless you already have 5 active Soothsayer missions and take on an additional Soothsayer mission.",
                )
            _fail_mission(state, target_p, m, reason="6th Soothsayer mission overflow")
            return True, f"Canceled Soothsayer Mission '{m.get('name', 'Mission')}' with no penalty."
        if src == "encounter":
            h_notes = _fail_mission(state, target_p, m, reason="voluntarily canceled")
            return True, f"Canceled Encounter Mission '{m.get('name', 'Mission')}' ({' '.join(h_notes) or 'Reputational consequences applied'})."
        s_notes = _fail_mission(state, target_p, m, reason="voluntarily canceled")
        suffix = f" ({' '.join(s_notes)})" if s_notes else " with no penalty"
        return True, f"Canceled Starting Mission '{m.get('name', 'Mission')}'{suffix}."

    # Confirm Top 3 Reorder from Informants ("Look at the top three cards of any deck or the top three tiles of any stack...")
    if act_type == "reorder_top_3":
        target_p = next(
            (p for p in state["players"] if not p["isBot"] and p.get("pendingTop3Reorder")),
            None,
        )
        if not target_p:
            target_p = state["players"][state["activePlayerIndex"]]
        if not target_p["isBot"] and target_p.get("userId") is not None and user_id != target_p.get("userId"):
            return False, "Not authorized."
        pend_r = target_p.get("pendingTop3Reorder")
        if not pend_r:
            return False, "No pending Top 3 reorder active."
        t_type = pend_r.get("targetType", "deck")
        t_key = pend_r.get("targetKey", "patricii")
        if t_type == "tile":
            t_key = normalize_cell_id(t_key) or t_key
        target_list = (
            state["romeBoard"].get(t_key, {}).get("stack", [])
            if t_type == "tile"
            else state["decks"].get(t_key, [])
        )
        k = min(3, len(target_list))
        if k > 0:
            orig_top = list(target_list[:k])
            ordered_ids = action.get("orderedIds") or []
            new_top: List[Dict[str, Any]] = []
            used_indices = set()
            for oid in ordered_ids:
                for idx_o, item_o in enumerate(orig_top):
                    if idx_o not in used_indices and str(item_o.get("id")) == str(oid):
                        new_top.append(item_o)
                        used_indices.add(idx_o)
                        break
            for idx_o, item_o in enumerate(orig_top):
                if idx_o not in used_indices:
                    new_top.append(item_o)
            target_list[:k] = new_top
            top_one = new_top[0]
            summary_str = (
                _summarize_tile(top_one)
                if t_type == "tile"
                else f"Top of {t_key.capitalize()}: {top_one.get('name', 'Card')}"
            )
            target_p["scoutedInfo"].append({
                "id": f"top3_{secrets.token_hex(4)}",
                "turn": state.get("turn", 1),
                "targetType": t_type,
                "targetKey": t_key,
                "label": f"Informants Top 3 ({pend_r.get('label', t_key)})",
                "summary": summary_str,
                "revealedData": copy.deepcopy(top_one),
            })
        target_p["pendingTop3Reorder"] = None
        add_log(
            state,
            f"{target_p['name']} reordered the top {k} item(s) of {pend_r.get('label', t_key)}.",
            "action",
        )
        return True, f"Put top {k} item(s) of {pend_r.get('label', t_key)} back in your chosen order!"

    # Confirm or Decline NPC Purchase/Sale Offer ("?: Will Sell..." / "?: Will Buy...")
    if act_type == "resolve_npc_offer":
        target_p = next(
            (p for p in state["players"] if not p["isBot"] and p.get("pendingNpcOffer")),
            None,
        )
        if not target_p:
            target_p = state["players"][state["activePlayerIndex"]]
        if not target_p["isBot"] and target_p.get("userId") is not None and user_id != target_p.get("userId"):
            return False, "Not authorized."
        offer = target_p.get("pendingNpcOffer")
        if not offer:
            return False, "No pending NPC offer active."
        npc_card = offer.get("npcCard") or {"name": "Patron", "friendlyFavor": [], "friendlyReward": ""}
        decision = action.get("decision", "confirm")
        if decision == "decline" or not offer.get("candidates"):
            target_p["pendingNpcOffer"] = None
            add_log(state, f"{target_p['name']} declined {npc_card.get('name', 'NPC')}'s transaction offer.", "encounter")
            _finish_pending_encounter_continuations(state, target_p)
            run_bots_until_human(state)
            return True, f"Declined {npc_card.get('name', 'NPC')}'s offer."

        cand_id = action.get("candidateId") or action.get("candidateUid")
        card_id = action.get("cardId")
        cands = offer.get("candidates", [])
        chosen = next(
            (
                c
                for c in cands
                if (cand_id and (c.get("id") == cand_id or c.get("uid") == cand_id))
                or (card_id and c.get("cardId") == card_id)
            ),
            None,
        )
        if not chosen and cands:
            chosen = cands[0]
        if not chosen:
            return False, "Please select a valid card for the transaction."

        mode = offer.get("mode", "buy_from_npc")
        pr = int(chosen.get("price", 0))
        c_data = chosen.get("card") or {}

        if mode == "buy_from_npc":
            if target_p["cash"] < pr:
                return False, f"Not enough Denarii (costs {pr}(d), you have {target_p['cash']}(d))."
            req_b = int(c_data.get("blocks", 1))
            ok_swap, err_swap, _ = _validate_and_apply_cart_space_swaps(
                state,
                target_p,
                discard_cart_ids=action.get("discardCartIds"),
                fire_guard_ids=action.get("fireGuardIds"),
                incoming_blocks=req_b,
                reason=f"to purchase {c_data.get('name', 'Good')} from {npc_card.get('name', 'NPC')}",
            )
            if not ok_swap:
                return False, err_swap

            picked = None
            if chosen.get("source") == "market":
                tr = state["marketBoard"].get(chosen.get("track", ""), [])
                picked = next((x for x in tr if x["id"] == chosen["cardId"]), None)
                if picked:
                    tr.remove(picked)
            else:
                dk = state["decks"].get("market", [])
                picked = next((x for x in dk if x["id"] == chosen["cardId"]), None)
                if picked:
                    dk.remove(picked)
            if not picked:
                picked = copy.deepcopy(c_data)

            picked["purchasePrice"] = pr
            target_p["cash"] -= pr
            target_p["cart"].append(picked)
            _inc_player_stat(target_p, "itemsPurchased", 1)
            f_notes = apply_favor_list(
                target_p,
                npc_card.get("friendlyFavor", []),
                reason=f"buying {picked['name']} from {npc_card.get('name', 'NPC')}",
            )
            target_p["pendingNpcOffer"] = None
            msg = f"{target_p['name']} purchased {picked['name']} from {npc_card.get('name', 'NPC')} for {pr}(d)! {' '.join(f_notes)}"
            add_log(state, msg, "encounter")
            check_passive_missions(state, target_p)
            _finish_pending_encounter_continuations(state, target_p)
            run_bots_until_human(state)
            return True, f"Purchased {picked['name']} for {pr}(d)!"

        # mode == "sell_to_npc"
        cart_item = next((x for x in target_p["cart"] if x["id"] == chosen["cardId"]), None)
        if not cart_item:
            return False, "Selected item is no longer on your Cart."
        was_fenced_npc = bool(cart_item.get("isMissionCargo"))
        _remove_cart_item(
            state,
            target_p,
            cart_item,
            reason=f"{'fenced' if was_fenced_npc else 'sold'} to {npc_card.get('name', 'NPC')} for {pr}(d)",
            is_fenced=was_fenced_npc,
        )
        target_p["cash"] += pr
        _inc_player_stat(target_p, "itemsSold", 1)
        f_notes = apply_favor_list(
            target_p,
            npc_card.get("friendlyFavor", []),
            reason=f"selling {cart_item['name']} to {npc_card.get('name', 'NPC')}",
        )
        r_notes = grant_reward(state, target_p, None, npc_card.get("friendlyReward", ""))
        target_p["pendingNpcOffer"] = None
        msg = f"{target_p['name']} sold {cart_item['name']} to {npc_card.get('name', 'NPC')} for {pr}(d)! {' '.join(f_notes + r_notes)}"
        add_log(state, msg, "encounter")
        _finish_pending_encounter_continuations(state, target_p)
        run_bots_until_human(state)
        return True, f"Sold {cart_item['name']} for {pr}(d)!"

    # All turn-based actions require activePlayerIndex
    player = state["players"][state["activePlayerIndex"]]
    if not player["isBot"] and player.get("userId") is not None and user_id != player.get("userId"):
        return False, f"It is currently {player['name']}'s turn."

    # Play Influence Card (can be played anytime on turn)
    if act_type == "play_influence":
        card_id = action.get("cardId")
        card = next((c for c in player["influence"] if c["id"] == card_id), None)
        if not card:
            return False, "Influence card not found in hand."
        ok, msg = _execute_influence_card(state, player, card, action)
        if ok:
            run_bots_until_human(state)
        return ok, msg

    if act_type == "return_shortcut":
        if not _refund_unused_shortcut(state, player, manual=True):
            return False, "No active unused Shortcut card to return."
        return True, "Returned unused 'Shortcut' card to your hand."

    # 4. Ostia Market Phase
    if state["phase"] == "market":
        if act_type == "market_source":
            inf_id = action.get("influenceCardId")
            good_id = action.get("goodCardId")
            inf_card = next((c for c in player["influence"] if c["id"] == inf_id), None)
            if not inf_card:
                return False, "Select an Influence card to discard for Sourcing."
            good_card = next((c for c in state["decks"]["market"] if c["id"] == good_id), None)
            if not good_card:
                return False, "Selected Good not found in Market deck."
            player["influence"].remove(inf_card)
            state["decks"]["influence"].append(inf_card)
            state["decks"]["market"].remove(good_card)
            push_card_onto_market_track(state, good_card)
            add_log(state, f"{player['name']} discarded '{inf_card['name']}' to Source {good_card['name']} onto the {good_card['track']} track!", "action")
            return True, f"Sourced {good_card['name']} onto the Market."

        if act_type == "market_buy":
            track_name = action.get("track")
            col_idx = int(action.get("colIndex", 0))
            track = state["marketBoard"].get(track_name, [])
            if col_idx < 0 or col_idx >= len(track):
                return False, "Invalid Market slot."
            card = track[col_idx]
            price_idx = COL_TO_PRICE_INDEX[col_idx]
            price = int(card["buy"][price_idx])
            if player["cash"] < price:
                return False, f"Not enough Denarii (costs {price}(d), you have {player['cash']}(d))."

            is_guard = card["track"] == "Guards"
            ok_swap, err_swap, _ = _validate_and_apply_cart_space_swaps(
                state,
                player,
                discard_cart_ids=action.get("discardCartIds"),
                fire_guard_ids=action.get("fireGuardIds"),
                incoming_blocks=0 if is_guard else int(card.get("blocks", 1) or 1),
                incoming_guards=int(card.get("guards", 1) or 1) if is_guard else 0,
                incoming_bonus_blocks=int(card.get("bonusBlocks", 0) or 0),
                incoming_bonus_guards=int(card.get("bonusGuards", 0) or 0),
                reason=f"to {'hire' if is_guard else 'buy'} {card['name']} in Ostia Market",
            )
            if not ok_swap:
                return False, err_swap

            player["cash"] -= price
            bought = track.pop(col_idx)
            bought["purchasePrice"] = price
            if is_guard:
                player["guards"].append(bought)
            else:
                player["cart"].append(bought)
            _inc_player_stat(player, "itemsPurchased", 1)

            # Replenish from top of Market deck
            replenished_msg = ""
            if state["decks"]["market"]:
                rep = state["decks"]["market"].pop(0)
                push_card_onto_market_track(state, rep)
                replenished_msg = f" Market replenished with {rep['name']} ({rep['track']})."

            state["marketConsecutivePasses"] = 0
            add_log(state, f"{player['name']} {'hired' if is_guard else 'purchased'} {bought['name']} ({bought['track']}) for {price}(d).{replenished_msg}", "action")
            advance_market_turn(state)
            run_bots_until_human(state)
            return True, f"{'Hired' if is_guard else 'Purchased'} {bought['name']} for {price}(d)."

        if act_type == "market_pass":
            state["marketConsecutivePasses"] += 1
            add_log(state, f"{player['name']} passed in the Ostia Market ({state['marketConsecutivePasses']}/{len(state['players'])} passes).", "action")
            advance_market_turn(state)
            run_bots_until_human(state)
            return True, "Passed Market turn."

    # 5. Delivery Entry Phase (Initial Scout + Gate Selection)
    if state["phase"] == "delivery_entry":
        if act_type == "initial_scout":
            if player.get("scoutedThisTurn"):
                return False, "You have already used your Initial Scout before this night."
            cell = normalize_cell_id(action.get("cell", "B1")) or "B1"
            if cell not in state["romeBoard"]:
                return False, "Invalid neighborhood cell."
            stack = state["romeBoard"][cell]["stack"]
            player["scoutedThisTurn"] = True
            if stack:
                top_tile = stack[0]
                player["scoutedInfo"].append({
                    "id": f"scout_{secrets.token_hex(4)}",
                    "turn": 0,
                    "targetType": "tile",
                    "targetKey": cell,
                    "label": f"Initial Scout ({cell})",
                    "summary": _summarize_tile(top_tile),
                    "revealedData": copy.deepcopy(top_tile),
                })
                add_log(state, f"{player['name']} performed their Initial Scout on {cell}.", "action")
            return True, f"Scouted top tile of {cell}."

        if act_type == "select_gate":
            gate = normalize_cell_id(action.get("gate", "B1")) or "B1"
            if gate not in GATE_CELLS:
                return False, "Entry point must be one of the 6 Via Gate tiles (B1, E1, F3, F6, B6, A4)."
            player["position"] = gate
            player["previousPosition"] = None
            player["turnStep"] = "ready"
            add_log(state, f"{player['name']} positioned their Cart at Gate {gate} ({NEIGHBORHOOD_NAMES.get(gate, gate)}).", "action")

            n = len(state["players"])
            if all(normalize_cell_id(p.get("position")) in GATE_CELLS for p in state["players"]):
                _begin_night_delivery_turn_1(state)
                run_bots_until_human(state)
            else:
                state["activePlayerIndex"] = (state["activePlayerIndex"] + 1) % n
                state["turnSeq"] = int(state.get("turnSeq", 1)) + 1
                run_bots_until_human(state)
            return True, f"Selected Gate {gate}."

    # 6. Delivery Phase Turn Actions
    if state["phase"] == "delivery":
        if act_type == "delivery_trash":
            if player.get("trashedThisTurn"):
                return False, "Already used Trash action this turn."
            inf_id = action.get("influenceCardId")
            target_type = action.get("targetType", "tile")  # 'tile' or 'deck'
            target_key = action.get("targetKey", "B1")
            if target_type == "tile":
                target_key = normalize_cell_id(target_key) or "B1"
            inf_card = next((c for c in player["influence"] if c["id"] == inf_id), None)
            if not inf_card:
                return False, "Select an Influence card to discard."
            player["influence"].remove(inf_card)
            state["decks"]["influence"].append(inf_card)
            player["trashedThisTurn"] = True
            if target_type == "tile" and target_key in state["romeBoard"]:
                stk = state["romeBoard"][target_key]["stack"]
                if stk:
                    stk.append(stk.pop(0))
                add_log(state, f"{player['name']} discarded '{inf_card['name']}' to bury the top unexposed tile of {target_key}.", "action")
            elif target_type == "deck" and target_key in state["decks"]:
                dk = state["decks"][target_key]
                if dk:
                    dk.append(dk.pop(0))
                add_log(state, f"{player['name']} discarded '{inf_card['name']}' to bury the top card of the {target_key.capitalize()} deck.", "action")
            return True, "Trashed top item to bottom of stack/deck."

        if act_type == "delivery_move":
            if player.get("movesRemaining", 0) <= 0:
                if int(state.get("turn", 1)) == 1:
                    return False, "Entering Rome through your chosen Via Gate was your Move for Turn 1 (8:00 P.M.). You may Transact, Scout, or End Turn."
                return False, "You have already moved this turn."
            curr_cell = normalize_cell_id(player.get("position"))
            if not curr_cell:
                return False, "Cart is not on the board."
            direction = action.get("direction", "")
            if direction not in DIR_DELTAS:
                return False, "Invalid movement direction."
            target_cell = get_target_cell(curr_cell, direction)
            if is_tiber_crossing_blocked(curr_cell, target_cell):
                return (
                    False,
                    "Cannot cross the Tiber River here — carts may only cross orthogonally via Rome's four stone bridges (A1↔A2, A3↔A4, B4↔C4, B4↔B5).",
                )

            rev_tile = state["romeBoard"][curr_cell].get("revealed")
            edges = get_effective_tile_edges(curr_cell, rev_tile)
            edge_val = edges.get(direction, "red")
            toll_amt = parse_edge_toll(edge_val)

            shortcut_active = player.get("turnEffects", {}).get("shortcut", False)
            guard_friend_active = bool(player.get("friendInGuard") or player.get("turnEffects", {}).get("friendInGuard"))
            bridge_lbl = get_tiber_bridge_name(curr_cell, target_cell)
            div_tiber_active = has_climate_modifier(state, "geta_3")
            has_emerald = int((player.get("favor") or {}).get("Geta", 0)) >= 1
            needed_shortcut = bool(
                shortcut_active
                and (
                    edge_val != "green"
                    or (div_tiber_active and bool(bridge_lbl) and not has_emerald)
                )
            )
            if not needed_shortcut:
                if edge_val in ("red", None, "none"):
                    return False, f"Direction {direction} is impassable ({edge_val})."
                edge_toll_due = int(toll_amt) if (toll_amt is not None and not guard_friend_active) else 0
                bridge_toll_due = 4 if (div_tiber_active and bridge_lbl and not has_emerald) else 0
                total_toll_due = edge_toll_due + bridge_toll_due
                if player["cash"] < total_toll_due:
                    if edge_toll_due > 0 and bridge_toll_due > 0:
                        return False, f"Insufficient Denarii for the {edge_toll_due}(d) edge toll + 4(d) Divided Tiber bridge toll ({total_toll_due}d total)."
                    if bridge_toll_due > 0:
                        return False, f"Insufficient Denarii for the 4(d) Divided Tiber toll across {bridge_lbl} (waived with ≥ +1 Emerald)."
                    return False, f"Insufficient Denarii for the {edge_toll_due}(d) edge toll."
                if toll_amt is not None:
                    if guard_friend_active:
                        add_log(state, f"{player['name']} crossed the {direction} edge of {curr_cell} with {toll_amt}(d) toll waived by 'Friend In The City Guard'!", "action")
                    else:
                        player["cash"] -= edge_toll_due
                        add_log(state, f"{player['name']} paid {edge_toll_due}(d) toll to cross the {direction} edge of {curr_cell}.", "action")
                if div_tiber_active and bridge_lbl:
                    if has_emerald:
                        add_log(state, f"{player['name']} crossed {bridge_lbl} with the 4(d) Divided Tiber toll waived (+Emerald Favor)!", "action")
                    else:
                        player["cash"] -= 4
                        add_log(state, f"{player['name']} paid 4(d) Divided Tiber toll to cross {bridge_lbl}.", "action")
            else:
                player["turnEffects"]["shortcut"] = False
                sc_card = player["turnEffects"].pop("shortcutCard", None)
                if isinstance(sc_card, dict):
                    state["decks"]["influence"].append(sc_card)
                    state["hourEffects"]["lastInfluencePlayed"] = sc_card
                    _inc_player_stat(player, "influencePlayed", 1)
                add_log(state, f"{player['name']} used 'Shortcut' to pass freely through the {direction} edge!", "action")

            # Resolve Edge Encounter before moving if present and not bypassed by Shortcut
            if not needed_shortcut and edge_val not in ("green", "red", None, "none") and toll_amt is None:
                tile_id_lbl = (rev_tile or {}).get("id", curr_cell)
                src_lbl = f"Crossing {direction} Edge of {tile_id_lbl} ({curr_cell} → {target_cell or 'Exit'}) ({edge_val.replace('_', ' ×')})"
                if edge_val in ("mob", "theater", "soothsayer"):
                    resolve_table_encounter(state, player, edge_val, source_label=src_lbl)
                else:
                    trigger_deck_encounter(state, player, edge_val, source_label=src_lbl)

                if state.get("pendingEncounter") or player.get("pendingNpcOffer") or player.get("pendingCartOverflow") or player.get("pendingMarketReward"):
                    state["pendingPostEncounterMove"] = {
                        "playerIndex": player["index"],
                        "fromCell": curr_cell,
                        "direction": direction,
                        "targetCell": target_cell,
                    }
                    run_bots_until_human(state)
                    return True, "Resolving edge encounter before completing move."

            if player["nightEnded"] or player["turnStep"] == "done":
                advance_delivery_turn(state)
                run_bots_until_human(state)
                return True, "Edge encounter ended turn."

            player["movesRemaining"] -= 1
            player["previousPosition"] = curr_cell

            if target_cell is None:
                # Exiting Rome!
                player["position"] = None
                player["exitedRome"] = True
                player["turnStep"] = "done"
                add_log(state, f"{player['name']} exited Rome safely via {curr_cell} ({direction}) before Dawn!", "phase")
                advance_delivery_turn(state)
                run_bots_until_human(state)
                return True, "Exited Rome safely!"

            player["position"] = target_cell
            if player.get("turnEffects", {}).get("makeHasteExtraTransact"):
                player["transactedThisTurn"] = False
                player["gambledThisTurn"] = False
                player["turnEffects"]["makeHasteExtraTransact"] = False
            if player["movesRemaining"] <= 0:
                player["turnStep"] = "moved"
            bridge_suffix = f" via {bridge_lbl}" if bridge_lbl else ""
            add_log(state, f"{player['name']} moved {direction} from {curr_cell} to {target_cell} ({NEIGHBORHOOD_NAMES.get(target_cell, target_cell)}){bridge_suffix}.", "action")
            resolve_tile_entry(state, player, target_cell)
            if (player["nightEnded"] or player["turnStep"] == "done") and not state.get("pendingEncounter") and not player.get("pendingNpcOffer") and not player.get("pendingCartOverflow") and not player.get("pendingMarketReward"):
                advance_delivery_turn(state)
            run_bots_until_human(state)
            return True, f"Moved to {target_cell}."

        if act_type == "delivery_sell":
            if player.get("transactedThisTurn") or player.get("gambledThisTurn"):
                return False, "Already completed your Transaction for this turn."
            curr_cell = normalize_cell_id(player.get("position"))
            if not curr_cell:
                return False, "Not in a neighborhood."
            rev_tile = state["romeBoard"][curr_cell].get("revealed") or {}
            category = action.get("category", "")
            req_mission_id = str(action.get("missionId") or "").strip()
            raw_card_ids = [str(cid) for cid in (action.get("cardIds") or []) if cid]
            if len(raw_card_ids) > 1:
                return False, "You may only sell 1 Good per hour."
            card_ids = set(raw_card_ids)

            try:
                spend_amethysts = int(action.get("spendAmethysts", 0) or 0)
            except (TypeError, ValueError):
                return False, "Invalid Amethyst spend amount."
            if spend_amethysts < 0:
                return False, "Invalid Amethyst spend amount."
            if spend_amethysts > 0:
                if not has_climate_modifier(state, "aurelius_3"):
                    return False, "Senatorial Privilege is not active in this game's Political Climate."
                if state.get("hourEffects", {}).get("priceEdict"):
                    return False, "Cannot spend Amethysts to shift Scarcity while Price Edict is active this hour."
                avail_am = int((player.get("favor") or {}).get("Aurelius", 0))
                if avail_am < spend_amethysts:
                    return False, f"Insufficient Aurelian Amethysts (have +{max(0, avail_am)}, requested {spend_amethysts})."

            # Find matching sell option on tile OR on an active Sell Mission for this cell
            tile_sells = rev_tile.get("sells", [])
            mission_sells = [
                m for m in player["missions"]
                if not m.get("completed") and m.get("kind") == "sell" and normalize_cell_id(m.get("cell")) == curr_cell
            ]

            chosen_mod = None
            matched_mission = None
            if req_mission_id:
                spec_m = next((m for m in mission_sells if str(m.get("id")) == req_mission_id), None)
                if not spec_m:
                    return False, "Selected Sell Mission is not active at this neighborhood."
                category = spec_m["category"]
                chosen_mod = spec_m["modifier"]
                matched_mission = spec_m
            else:
                for m in mission_sells:
                    if m["category"] == category or matches_category({"category": category, "subcategory": category, "track": category}, m["category"]):
                        chosen_mod = m["modifier"]
                        matched_mission = m
                        break
                if chosen_mod is None:
                    for s in tile_sells:
                        if s["category"] == category:
                            chosen_mod = s["modifier"]
                            break
            if chosen_mod is None:
                return False, f"Cannot sell {category} at {curr_cell}."

            to_sell = [
                c
                for c in player["cart"]
                if (not card_ids or c["id"] in card_ids)
                and matches_category(c, category)
                and (
                    (not c.get("isMissionCargo"))
                    if req_mission_id
                    else (not c.get("isMissionCargo") or (c.get("missionSource") == "encounter" and bool(c.get("sell"))))
                )
            ]
            if not to_sell:
                return False, f"You have no matching {category} on your Cart that can be sold."

            # Strictly 1 Good card sold per hour
            item = to_sell[0]
            _, base_sym = compute_sell_price(state, player, item, chosen_mod, spend_amethysts=0)
            base_sym_idx = SCARCITY_SYMBOLS.index(base_sym) if base_sym in SCARCITY_SYMBOLS else 2
            eff_spend_am = min(spend_amethysts, base_sym_idx)
            price, sym = compute_sell_price(state, player, item, chosen_mod, spend_amethysts=eff_spend_am)

            am_log_note = ""
            if eff_spend_am > 0:
                player["favor"]["Aurelius"] = int(player["favor"].get("Aurelius", 0)) - eff_spend_am
                player.setdefault("favorHistory", {f: [] for f in FACTIONS}).setdefault("Aurelius", []).append({
                    "delta": -eff_spend_am,
                    "reason": f"Senatorial Privilege sale of {item['name']} in {curr_cell} ({base_sym} -> {sym})",
                    "newTotal": player["favor"]["Aurelius"],
                })
                am_log_note = f" [spent {eff_spend_am} Amethyst -> {sym}]"

            was_fenced = bool(item.get("isMissionCargo"))
            sold_label = f"{item['name']} ({price}d @ {sym}){am_log_note}"
            _remove_cart_item(
                state,
                player,
                item,
                reason=f"{'fenced' if was_fenced else 'sold'} in {curr_cell} for {price}(d)",
                is_fenced=was_fenced,
            )

            player["cash"] += price
            player["transactedThisTurn"] = True
            _inc_player_stat(player, "itemsSold", 1)
            add_log(state, f"{player['name']} {'fenced' if was_fenced else 'sold'} {sold_label} in {curr_cell} for {price}(d)!", "action")

            # Complete any matching Sell Mission at this cell (fenced cargo never fulfills a separate Sell Mission)
            if not was_fenced and matched_mission and matched_mission in player["missions"]:
                matched_mission["completed"] = True
                player["missions"].remove(matched_mission)
                r_notes = grant_reward(state, player, matched_mission.get("reward"), matched_mission.get("rewardText", ""), is_mission_reward=True)
                if matched_mission.get("patronRewardText"):
                    r_notes.extend(grant_reward(state, player, None, matched_mission.get("patronRewardText", ""), is_mission_reward=True))
                patron_lbl = f" for {matched_mission['patronName']}" if matched_mission.get("patronName") else ""
                f_notes = apply_favor_list(
                    player,
                    matched_mission.get("favor", []),
                    reason=f"completing mission '{matched_mission['name']}'{patron_lbl} (sold {category} in {curr_cell})",
                )
                if matched_mission.get("source") == "soothsayer" and matched_mission.get("underInfluence"):
                    under = matched_mission.pop("underInfluence", [])
                    player["influence"].extend(under)
                    r_notes.append(f"+{len(under)} Soothsayer Influence Card(s)")
                _record_mission_completion_event(
                    state,
                    player,
                    matched_mission,
                    r_notes,
                    f_notes,
                    context_detail=f"Sold {sold_label} in {curr_cell} ({NEIGHBORHOOD_NAMES.get(curr_cell, curr_cell)})",
                )
                _recycle_mission_cards(state, matched_mission)
                add_log(state, f"{player['name']} fulfilled Sell Mission '{matched_mission['name']}' in {curr_cell}! {' '.join(r_notes + f_notes)}", "mission")

            return True, f"Sold {item['name']} for {price}(d)."

        if act_type == "delivery_forum_buy":
            if player.get("transactedThisTurn") or player.get("gambledThisTurn"):
                return False, "Already completed your Transaction for this turn."
            curr_cell = normalize_cell_id(player.get("position"))
            if curr_cell not in FORUM_CELLS:
                return False, "Market purchases in Rome are only available on the three central Forum tiles (C3, D3, D4)."
            rev_tile = state["romeBoard"][curr_cell].get("revealed") or {}
            buys = rev_tile.get("buys", [])
            if not buys:
                return False, "This Forum tile does not offer a Buy/Hire option."
            buy_spec = buys[0]
            track_name = buy_spec["category"]
            mod = buy_spec.get("modifier", "=")
            col_idx = int(action.get("colIndex", 0))
            track = state["marketBoard"].get(track_name, [])
            if col_idx < 0 or col_idx >= len(track):
                return False, f"No {track_name} available in that Market slot."
            card = track[col_idx]
            eff_col = min(5, max(0, col_idx + (1 if mod in (">", "-") else (-1 if mod in ("<", "+") else 0))))
            price = int(card["buy"][COL_TO_PRICE_INDEX[eff_col]])
            if player["cash"] < price:
                return False, f"Requires {price}(d)."
            is_guard = card["track"] == "Guards"
            ok_swap, err_swap, _ = _validate_and_apply_cart_space_swaps(
                state,
                player,
                discard_cart_ids=action.get("discardCartIds"),
                fire_guard_ids=action.get("fireGuardIds"),
                incoming_blocks=0 if is_guard else int(card.get("blocks", 1) or 1),
                incoming_guards=int(card.get("guards", 1) or 1) if is_guard else 0,
                incoming_bonus_blocks=int(card.get("bonusBlocks", 0) or 0),
                incoming_bonus_guards=int(card.get("bonusGuards", 0) or 0),
                reason=f"to {'hire' if is_guard else 'buy'} {card['name']} at Forum {curr_cell}",
            )
            if not ok_swap:
                return False, err_swap
            bought = track.pop(col_idx)
            bought["purchasePrice"] = price
            if is_guard:
                player["guards"].append(bought)
            else:
                player["cart"].append(bought)
            player["cash"] -= price
            player["transactedThisTurn"] = True
            _inc_player_stat(player, "itemsPurchased", 1)
            add_log(state, f"{player['name']} {'hired' if is_guard else 'bought'} {bought['name']} at Forum {curr_cell} for {price}(d).", "action")
            return True, f"{'Hired' if is_guard else 'Bought'} {bought['name']} for {price}(d)."

        if act_type == "delivery_gamble":
            if player.get("gambledThisTurn"):
                return False, "You can only gamble once per turn."
            if player.get("transactedThisTurn"):
                return False, "Already completed your Transaction for this turn."
            curr_cell = normalize_cell_id(player.get("position"))
            rev_tile = (state["romeBoard"].get(curr_cell or "") or {}).get("revealed") or {}
            if not rev_tile.get("gamble"):
                return False, "Stadium Gambling is not available on this tile."
            bet = int(action.get("bet", 0))
            if bet <= 0:
                return False, "Invalid bet amount."
            if bet > MAX_GAMBLE_WAGER:
                return False, f"Maximum Stadium Gambling wager is {MAX_GAMBLE_WAGER}(d)."
            if bet > player["cash"]:
                return False, f"Insufficient Denarii (you have {player['cash']}(d))."
            player["cash"] -= bet
            dice_cnt = 2 if player.get("turnEffects", {}).get("matchFixing") else 1
            player["turnEffects"]["matchFixing"] = False
            rolls = [roll_rome_die() for _ in range(dice_cnt)]
            player["gambledThisTurn"] = True
            player["transactedThisTurn"] = True
            gamble_state = {
                "stage": "gamble_post_roll",
                "playerIndex": player["index"],
                "cell": curr_cell,
                "bet": bet,
                "gambleRolls": list(rolls),
                "passedIntervenors": [],
                "botInterventions": 0,
                "card": {"name": f"Stadium Gambling ({curr_cell})", "deck": "gamble"},
            }
            gamble_state["previewText"] = _get_gamble_roll_preview(player, gamble_state)
            bot_wants = _does_bot_want_post_gamble_intervention(state, player, gamble_state)
            intervenor = _find_human_intervenor_for_twist_of_fate(state, player)
            if bot_wants or intervenor is not None:
                mult_init = sum(rolls)
                payout_init = bet * mult_init
                rom_list_init = " + ".join(roman_die_str(x) for x in rolls)
                add_dice_event(
                    state,
                    kind="gamble",
                    title=f"🎲 STADIUM GAMBLING ({curr_cell}) — {player['name']}",
                    subtitle=f"Wager: {bet}(d) • 0: Lose • I: 1× • II: 2× • III: 3×",
                    groups=[{
                        "rollerName": player["name"],
                        "rollerType": "player",
                        "colorName": player["color"],
                        "flatBonus": 0,
                        "totalLabel": f"Multiplier: {mult_init}× ({payout_init}d)",
                        "dice": [
                            {"value": x, "roman": roman_die_str(x), "sign": 1, "label": f"Gamble ® #{i+1}", "color": player["color"]}
                            for i, x in enumerate(rolls)
                        ],
                    }],
                    outcome_title=f"ROLLED {rom_list_init} → {mult_init}× PAYOUT ({payout_init}d)",
                    outcome_message=gamble_state["previewText"],
                )
                _run_bot_post_gamble_interventions(state, player, gamble_state)
                intervenor = _find_human_intervenor_for_twist_of_fate(state, player, gamble_state["passedIntervenors"])
                if intervenor is not None:
                    gamble_state["interveningPlayerIndex"] = intervenor["index"]
                    if state.get("diceEvents"):
                        last_ev = state["diceEvents"][-1]
                        cur_rolls = [int(x) for x in gamble_state["gambleRolls"]]
                        cur_rom = " + ".join(roman_die_str(x) for x in cur_rolls)
                        cur_mult = sum(cur_rolls)
                        avail_tof = _get_player_twist_of_fate_cards(intervenor)
                        c_names = ", ".join(c["name"] for c in avail_tof) or "Twist Of Fate"
                        last_ev["outcomeTitle"] = f"ROLLED {cur_rom} → {cur_mult}× (INFLUENCE AVAILABLE)"
                        last_ev["outcomeMessage"] = gamble_state["previewText"]
                        last_ev["outcomeDetail"] = gamble_state["previewText"]
                        last_ev["secretIntervenorIndex"] = intervenor["index"]
                        last_ev["secretCardNames"] = c_names
                        last_ev["secretIntervenorName"] = intervenor["name"]
                    state["pendingEncounter"] = gamble_state
                    return True, gamble_state["previewText"]
                return _apply_gamble_roll_outcome(state, player, gamble_state, emit_dice_event=False)
            return _apply_gamble_roll_outcome(state, player, gamble_state, emit_dice_event=True)

        if act_type == "delivery_scout":
            if player.get("scoutedThisTurn"):
                return False, "Already used your Free Scout this turn."
            target_type = action.get("targetType", "tile")
            target_key = action.get("targetKey", "C3")
            if target_type == "tile":
                target_key = normalize_cell_id(target_key) or "C3"
            player["scoutedThisTurn"] = True
            if target_type == "tile" and target_key in state["romeBoard"]:
                stk = state["romeBoard"][target_key]["stack"]
                if stk:
                    top_tile = stk[0]
                    player["scoutedInfo"].append({
                        "id": f"scout_{secrets.token_hex(4)}",
                        "turn": state["turn"],
                        "targetType": "tile",
                        "targetKey": target_key,
                        "label": f"Tile Stack {target_key}",
                        "summary": _summarize_tile(top_tile),
                        "revealedData": copy.deepcopy(top_tile),
                    })
                return True, f"Scouted top tile of {target_key}."
            if target_type == "deck" and target_key in state["decks"]:
                dk = state["decks"][target_key]
                if dk:
                    top_c = dk[0]
                    player["scoutedInfo"].append({
                        "id": f"scout_{secrets.token_hex(4)}",
                        "turn": state["turn"],
                        "targetType": "deck",
                        "targetKey": target_key,
                        "label": f"Deck {target_key.capitalize()}",
                        "summary": f"{top_c.get('name', 'Card')} — {top_c.get('actionText') or top_c.get('effectText') or top_c.get('category', '')}",
                        "revealedData": copy.deepcopy(top_c),
                    })
                return True, f"Scouted top card of {target_key.capitalize()}."
            return False, "Invalid scout target."

        if act_type == "delivery_end_turn":
            if player.get("pendingMarketReward") or player.get("pendingCartOverflow") or player.get("pendingNpcOffer"):
                return False, "Please finish choosing your pending reward or offer before ending your turn."
            advance_delivery_turn(state)
            run_bots_until_human(state)
            return True, "Turn ended."

    return False, f"Unrecognized or invalid action '{act_type}' in phase '{state['phase']}'."


def _summarize_tile(tile: Dict[str, Any]) -> str:
    buys_from_player = ", ".join(
        f"{s['category']} ({normalize_scarcity_modifier(s.get('modifier'))})" for s in tile.get("sells", [])
    ) or "None"
    forum_sells = ", ".join(
        f"{b['category']} ({normalize_scarcity_modifier(b.get('modifier'))})" for b in tile.get("buys", [])
    )
    forum_part = f" | Forum Sells [{forum_sells}]" if forum_sells else ""
    enc = tile.get("encounter") or "No center encounter"
    return f"{tile.get('id', 'Tile')}: Buys [{buys_from_player}]{forum_part} | Encounter: {enc} | Gamble: {'Yes' if tile.get('gamble') else 'No'}"


def _emit_updated_combat_dice_event(state: Dict[str, Any], player: Dict[str, Any], pend: Dict[str, Any], note: str) -> None:
    _recompute_combat_totals(pend)
    card = pend["card"]
    x_count = pend["xCount"]
    p_cp = pend["playerCP"]
    o_cp = pend["oppCP"]
    outcome_head, base_outcome_msg = _describe_combat_outcome(player, card, pend)
    p_total_lbl = _format_combat_total_label(p_cp, pend.get("playerDiceObjs", []), int(pend.get("playerFlat", 0)))
    o_total_lbl = _format_combat_total_label(o_cp, pend.get("oppDiceObjs", []), int(pend.get("oppFlat", 0)))
    if pend.get("ignoreWounds", 0) > 0:
        armor_lbl_str = ", ".join(pend.get("armorSources", [])) or f"Ignore {pend['ignoreWounds']} Wound(s)"
        p_total_lbl = f"{p_total_lbl} • 🛡️ {armor_lbl_str}"
    add_dice_event(
        state,
        kind="combat",
        title=f"⚔️ COMBAT UPDATE: {player['name']} vs. {card['name']}",
        subtitle=note,
        groups=[
            {
                "rollerName": f"{player['name']} (Merchant Party)",
                "rollerType": "player",
                "colorName": player["color"],
                "flatBonus": pend["playerFlat"],
                "flatModifiers": copy.deepcopy(pend.get("playerFlatMods", [])),
                "totalLabel": p_total_lbl,
                "dice": copy.deepcopy(pend["playerDiceObjs"]),
            },
            {
                "rollerName": f"{card['name']} (×{x_count} {card.get('deck', 'NPC').capitalize()})",
                "rollerType": "npc",
                "colorName": "Black",
                "flatBonus": pend["oppFlat"],
                "flatModifiers": copy.deepcopy(pend.get("oppFlatMods", [])),
                "totalLabel": o_total_lbl,
                "dice": copy.deepcopy(pend["oppDiceObjs"]),
            },
        ],
        outcome_title=outcome_head,
        outcome_message=f"{note} -> {base_outcome_msg}",
    )


def _check_active_demand_kind(
    state: Dict[str, Any],
    player: Dict[str, Any],
    pend_override: Optional[Dict[str, Any]] = None,
) -> Tuple[Optional[str], Optional[Dict[str, Any]]]:
    """Returns ('cash' | 'goods' | 'other', card) if player currently faces an active non-combat Demand/Request."""
    pend = pend_override if pend_override is not None else state.get("pendingEncounter")
    if not pend or pend.get("stage", "pre_decision") != "pre_decision":
        return None, None
    if pend.get("playerIndex") != player.get("index"):
        return None, None
    c_enc = pend.get("card")
    if not isinstance(c_enc, dict):
        return None, None
    refreshed = _build_pending_encounter_state(
        state,
        player,
        c_enc,
        pend.get("deck", "patricii"),
        int(pend.get("xCount", 1)),
        source_label=pend.get("encounterSource"),
    )
    if refreshed.get("combatMandatory"):
        return None, c_enc
    reaction = refreshed.get("reaction")
    action_text = str(c_enc.get("actionText") or "").strip()
    if reaction not in ("demand", "demand_strict") or action_text.startswith("?"):
        return None, c_enc
    if c_enc.get("mission") or not action_text:
        return "other", c_enc
    clause_match = re.search(r"\((?![dDrR]\))", action_text)
    primary_text = action_text[:clause_match.start()].strip() if clause_match else action_text
    primary_low = primary_text.lower()
    if "influence" in primary_low:
        return "influence", c_enc
    if "(d)" in primary_text or "cash" in primary_low:
        return "cash", c_enc
    return "goods", c_enc


def _execute_influence_card(state: Dict[str, Any], player: Dict[str, Any], card: Dict[str, Any], action: Dict[str, Any]) -> Tuple[bool, str]:
    cname = card.get("name", "")
    pend = state.get("pendingEncounter")
    pend_stage = pend.get("stage", "pre_decision") if pend else None
    enc_player = state["players"][pend["playerIndex"]] if pend else player

    # Pre-validate reactive & conditional cards before consuming the card from hand
    if "Trained Dog" in cname:
        d_kind, _ = _check_active_demand_kind(state, player)
        if d_kind != "cash":
            return (
                False,
                "Trained Dog can only be played during an active Encounter demanding Denarii (d).",
            )
    if "Plea" in cname:
        d_kind, _ = _check_active_demand_kind(state, player)
        if d_kind != "goods":
            return (
                False,
                "Plea can only be played during an active Encounter demanding Goods from your Cart.",
            )
    if "Twist Of Fate" in cname:
        if not pend or pend_stage not in (
            "combat_post_roll",
            "driver_fate_post_roll",
            "chart_post_roll",
            "demand_post_roll",
            "gamble_post_roll",
        ):
            return (
                False,
                "Twist Of Fate is a reactive card — play it during a die roll window to force any one ® die to be re-rolled.",
            )
        if pend_stage == "combat_post_roll":
            t_side = action.get("targetSide", "player")
            d_list = pend["oppDiceObjs"] if t_side == "opponent" else pend["playerDiceObjs"]
            if not d_list:
                return False, "No dice on that side to re-roll."
    if "Lucky Break" in cname:
        if (
            not pend
            or pend_stage not in ("driver_fate_post_roll", "chart_post_roll")
            or pend.get("chartType") not in ("death", "mob", "theater")
        ):
            return (
                False,
                "Lucky Break is a reactive card — play it after rolling on the Death, Angry Mob, or Theater Troupe chart (+1 to roll).",
            )
    if "Prophecy" in cname and pend is not None:
        return False, "Resolve the current encounter or die roll before playing Prophecy."
    if "Change Of Plans" in cname:
        curr_cell = player.get("position")
        if not curr_cell or curr_cell not in state.get("romeBoard", {}) or not state["romeBoard"][curr_cell].get("revealed"):
            return False, "Change Of Plans can only be played while your Cart is on a revealed neighborhood tile in Rome."
    if "Shortcut" in cname:
        if (
            state.get("phase") != "delivery"
            or state.get("activePlayerIndex") != player.get("index")
            or player.get("exitedRome")
            or player.get("nightEnded")
            or player.get("turnStep") == "done"
            or not normalize_cell_id(player.get("position"))
        ):
            return (
                False,
                "Shortcut can only be played on your Night Delivery turn while your Cart is in Rome and ready to move.",
            )
        if (
            pend is not None
            or player.get("pendingNpcOffer")
            or player.get("pendingCartOverflow")
            or player.get("pendingMarketReward")
        ):
            return (
                False,
                "Resolve the current encounter or prompt before playing Shortcut to move.",
            )
        if int(player.get("movesRemaining", 0)) <= 0:
            return (
                False,
                "Shortcut can only be played when you are able to move (you have no movement remaining this hour).",
            )
        if player.get("turnEffects", {}).get("shortcut"):
            return False, "Shortcut is already active for your movement this turn."
    procurer_picked: Optional[Dict[str, Any]] = None
    if "Procurer" in cname:
        good_id = action.get("goodCardId")
        good_name = action.get("goodName") or action.get("targetGood")
        max_b, _ = get_player_cart_limits(player)
        used_b, _ = get_player_cart_usage(player)
        chosen_idx = None
        for idx, c in enumerate(state["decks"].get("market", [])):
            if c.get("track") == "Guards":
                continue
            if good_id and c.get("id") == good_id:
                chosen_idx = idx
                break
            if good_name and c.get("name") == good_name:
                chosen_idx = idx
                break
        if chosen_idx is None:
            for idx, c in enumerate(state["decks"].get("market", [])):
                if c.get("track") == "Guards":
                    continue
                price_cand = int(c["buy"][3]) if len(c.get("buy", [])) > 3 else int(c["buy"][2])
                if player["cash"] >= price_cand and used_b + int(c.get("blocks", 1)) <= max_b:
                    chosen_idx = idx
                    break
        if chosen_idx is None:
            return False, "No affordable Good in the Goods deck was selected."
        cand_good = state["decks"]["market"][chosen_idx]
        cand_price = int(cand_good["buy"][3]) if len(cand_good.get("buy", [])) > 3 else int(cand_good["buy"][2])
        if player["cash"] < cand_price:
            return False, f"Not enough Denarii to procure {cand_good['name']} at '>' Scarcity ({cand_price}(d) required, you have {player['cash']}(d))."
        ok_swap, err_swap, _ = _validate_and_apply_cart_space_swaps(
            state,
            player,
            discard_cart_ids=action.get("discardCartIds"),
            fire_guard_ids=action.get("fireGuardIds"),
            incoming_blocks=int(cand_good.get("blocks", 1) or 1),
            reason=f"to procure {cand_good['name']}",
        )
        if not ok_swap:
            return False, err_swap
        procurer_picked = cand_good

    if "Thug" in cname:
        ok_swap, err_swap, _ = _validate_and_apply_cart_space_swaps(
            state,
            player,
            discard_cart_ids=action.get("discardCartIds"),
            fire_guard_ids=action.get("fireGuardIds"),
            incoming_guards=1,
            reason="to deploy Thug (Free Guard)",
        )
        if not ok_swap:
            return False, err_swap

    if "Wine Forger" in cname:
        ok_swap, err_swap, _ = _validate_and_apply_cart_space_swaps(
            state,
            player,
            discard_cart_ids=action.get("discardCartIds"),
            fire_guard_ids=action.get("fireGuardIds"),
            incoming_blocks=1,
            reason="to add Forged Wine to Cart",
        )
        if not ok_swap:
            return False, err_swap

    if "Shortcut" in cname:
        player["influence"].remove(card)
        player["turnEffects"]["shortcut"] = True
        player["turnEffects"]["shortcutCard"] = copy.deepcopy(card)
        add_log(
            state,
            f"{player['name']} readied '{cname}' for movement (returns to hand unused if no blocked route is crossed this turn)!",
            "action",
        )
        return (
            True,
            "Shortcut readied! Cross any red, tolled, or encounter route as Green this turn (returns to hand if unused).",
        )

    player["influence"].remove(card)
    state["decks"]["influence"].append(card)
    state["hourEffects"]["lastInfluencePlayed"] = card
    _inc_player_stat(player, "influencePlayed", 1)

    if "Trained Dog" in cname and pend and pend.get("card"):
        c_enc = pend["card"]
        state["pendingEncounter"] = None
        player["tempFavor"] = 0
        f_notes = apply_favor_list(
            player,
            c_enc.get("friendlyFavor", []),
            reason=f"satisfying {c_enc['name']}'s demand with Trained Dog",
        )
        add_log(state, f"{player['name']} played 'Trained Dog' to satisfy {c_enc['name']}'s demand for Denarii! {' '.join(f_notes)}", "encounter")
        _finish_pending_encounter_continuations(state, player)
        return True, f"Played 'Trained Dog' to satisfy {c_enc['name']}'s demand!"

    if "Plea" in cname and pend and pend.get("card"):
        c_enc = pend["card"]
        state["pendingEncounter"] = None
        player["tempFavor"] = 0
        f_notes = apply_favor_list(
            player,
            c_enc.get("friendlyFavor", []),
            reason=f"satisfying {c_enc['name']}'s demand with Plea",
        )
        add_log(state, f"{player['name']} played 'Plea' to satisfy {c_enc['name']}'s demand for Goods! {' '.join(f_notes)}", "encounter")
        _finish_pending_encounter_continuations(state, player)
        return True, f"Played 'Plea' to satisfy {c_enc['name']}'s demand!"

    # Handle Post-Roll Combat, Chart, Demand, & Gambling Influence Cards when in a post-roll stage
    if pend and pend_stage == "combat_post_roll":
        target_side = action.get("targetSide", "player")
        if "Gladiator" in cname:
            bonus_d = 1
            rolled_roms = []
            for _ in range(bonus_d):
                r_g = roll_rome_die()
                r_rom = roman_die_str(r_g)
                rolled_roms.append(r_rom)
                die_obj = {
                    "value": r_g,
                    "roman": r_rom,
                    "sign": 1,
                    "label": f"{cname} ®",
                    "color": enc_player["color"] if target_side == "player" else "Black",
                }
                if target_side == "opponent":
                    pend["oppDiceObjs"].append(die_obj)
                else:
                    pend["playerDiceObjs"].append(die_obj)
            pend["passedIntervenors"] = []
            pend["humanModifiedSinceBotCheck"] = True
            note = f"{player['name']} played '{cname}' after the roll (+{'+'.join(rolled_roms)} CP to {pend['card']['name'] if target_side == 'opponent' else enc_player['name']})!"
            add_log(state, note, "combat")
            _emit_updated_combat_dice_event(state, enc_player, pend, note)
            return True, f"Played '{cname}' (+{'+'.join(rolled_roms)} CP -> {pend['playerCP']} vs. {pend['oppCP']} CP)!"

        if "Flying Chamber Pot" in cname:
            if target_side == "opponent":
                pend["oppFlat"] = int(pend.get("oppFlat", 0)) + 1
                pend.setdefault("oppFlatMods", []).append({"label": cname, "value": 1})
            else:
                pend["playerFlat"] = int(pend.get("playerFlat", 0)) + 1
                pend.setdefault("playerFlatMods", []).append({"label": cname, "value": 1})
            _recompute_combat_totals(pend)
            pend["passedIntervenors"] = []
            pend["humanModifiedSinceBotCheck"] = True
            note = f"{player['name']} played '{cname}' after the roll (+1 CP to {pend['card']['name'] if target_side == 'opponent' else enc_player['name']})!"
            add_log(state, note, "combat")
            if state.get("diceEvents"):
                last_ev = state["diceEvents"][-1]
                if last_ev.get("kind") == "combat" and len(last_ev.get("groups", [])) >= 2:
                    p_total_lbl = _format_combat_total_label(pend["playerCP"], pend.get("playerDiceObjs", []), int(pend["playerFlat"]))
                    if pend.get("ignoreWounds", 0) > 0:
                        armor_lbl_str = ", ".join(pend.get("armorSources", [])) or f"Ignore {pend['ignoreWounds']} Wound(s)"
                        p_total_lbl = f"{p_total_lbl} • 🛡️ {armor_lbl_str}"
                    last_ev["groups"][0]["flatBonus"] = pend["playerFlat"]
                    last_ev["groups"][0]["flatModifiers"] = copy.deepcopy(pend.get("playerFlatMods", []))
                    last_ev["groups"][0]["totalLabel"] = p_total_lbl
                    last_ev["groups"][1]["flatBonus"] = pend["oppFlat"]
                    last_ev["groups"][1]["flatModifiers"] = copy.deepcopy(pend.get("oppFlatMods", []))
                    last_ev["groups"][1]["totalLabel"] = _format_combat_total_label(pend["oppCP"], pend.get("oppDiceObjs", []), int(pend["oppFlat"]))
                    outcome_head, base_outcome_msg = _describe_combat_outcome(enc_player, pend["card"], pend)
                    last_ev["outcomeTitle"] = outcome_head
                    last_ev["outcomeMessage"] = f"{note} -> {base_outcome_msg}"
                    last_ev["outcomeDetail"] = f"{note} -> {base_outcome_msg}"
            return True, f"Played '{cname}' (+1 CP -> {pend['playerCP']} vs. {pend['oppCP']} CP)!"

        if "Twist Of Fate" in cname:
            dice_list = pend["oppDiceObjs"] if target_side == "opponent" else pend["playerDiceObjs"]
            die_idx = int(action.get("dieIndex", action.get("targetIndex", 0)))
            die_idx = max(0, min(len(dice_list) - 1, die_idx))
            target_die = dice_list[die_idx]
            old_rom = target_die.get("roman", "0")
            new_r = roll_rome_die()
            new_rom = roman_die_str(new_r)
            target_die["value"] = new_r
            target_die["roman"] = new_rom
            if "(Re-rolled)" not in target_die.get("label", ""):
                target_die["label"] = f"{target_die.get('label', 'Die')} (Re-rolled)"
            pend["passedIntervenors"] = []
            pend["humanModifiedSinceBotCheck"] = True
            note = f"{player['name']} played 'Twist Of Fate' to re-roll {target_die.get('label', 'die')} ({old_rom} -> {new_rom})!"
            add_log(state, note, "combat")
            _emit_updated_combat_dice_event(state, enc_player, pend, note)
            return True, f"Played 'Twist Of Fate'! Re-rolled {old_rom} -> {new_rom} ({pend['playerCP']} vs. {pend['oppCP']} CP)."

    if pend and pend_stage in ("chart_pre_roll", "driver_fate_post_roll", "chart_post_roll"):
        c_type = pend.get("chartType", "death")
        if pend_stage in ("driver_fate_post_roll", "chart_post_roll") and "Lucky Break" in cname:
            old_r = int(pend.get("chartRoll", 0))
            new_r = min(3, old_r + 1)
            new_rom = roman_die_str(new_r)
            pend["chartRoll"] = new_r
            pend["previewText"] = _get_chart_roll_preview(enc_player, c_type, new_r, pend.get("soothsayerMission"))
            pend["passedIntervenors"] = []
            pend["humanModifiedSinceBotCheck"] = True
            note = f"{player['name']} played 'Lucky Break' (+1 to {enc_player['name']}'s Chart Roll: {roman_die_str(old_r)} -> {new_rom})!"
            add_log(state, note, "action")
            if state.get("diceEvents"):
                last_ev = state["diceEvents"][-1]
                if last_ev.get("groups"):
                    last_ev["groups"][0]["totalLabel"] = f"Adjusted: {new_rom} (+1 Lucky Break)"
                    if last_ev["groups"][0].get("dice"):
                        last_ev["groups"][0]["dice"][0]["value"] = new_r
                        last_ev["groups"][0]["dice"][0]["roman"] = new_rom
                last_ev["outcomeTitle"] = f"ADJUSTED TO {new_rom} (LUCKY BREAK)"
                last_ev["outcomeMessage"] = pend["previewText"]
                last_ev["outcomeDetail"] = pend["previewText"]
            return True, f"Played 'Lucky Break'! Roll increased from {roman_die_str(old_r)} to {new_rom}."

        if pend_stage in ("driver_fate_post_roll", "chart_post_roll") and "Twist Of Fate" in cname:
            old_r = int(pend.get("chartRoll", 0))
            new_r = roll_rome_die()
            new_rom = roman_die_str(new_r)
            pend["chartRoll"] = new_r
            pend["previewText"] = _get_chart_roll_preview(enc_player, c_type, new_r, pend.get("soothsayerMission"))
            pend["passedIntervenors"] = []
            pend["humanModifiedSinceBotCheck"] = True
            note = f"{player['name']} played 'Twist Of Fate' to re-roll {enc_player['name']}'s {c_type.capitalize()} Chart die ({roman_die_str(old_r)} -> {new_rom})!"
            add_log(state, note, "action")
            add_dice_event(
                state,
                kind="driver_fate" if c_type == "death" else "table_encounter",
                title=f"🎲 TWIST OF FATE RE-ROLL ({c_type.upper()}) — {enc_player['name']}",
                subtitle=note,
                groups=[{
                    "rollerName": enc_player["name"],
                    "rollerType": "player",
                    "colorName": enc_player["color"],
                    "flatBonus": 0,
                    "totalLabel": f"Re-rolled: {new_rom}",
                    "dice": [{"value": new_r, "roman": new_rom, "sign": 0 if c_type == "death" else 1, "label": "Re-rolled ®", "color": enc_player["color"]}],
                }],
                outcome_title=f"RE-ROLLED {new_rom}",
                outcome_message=pend["previewText"],
            )
            return True, f"Played 'Twist Of Fate'! Re-rolled {roman_die_str(old_r)} -> {new_rom}."

        if "Man Of The People" in cname and c_type == "mob":
            state["pendingEncounter"] = None
            enc_player["cash"] += 4
            add_log(state, f"{player['name']} played 'Man Of The People' to ignore the Angry Mob and collected +4(d) from the crowd!", "encounter")
            _finish_pending_encounter_continuations(state, enc_player)
            return True, "Played 'Man Of The People' — Angry Mob consequences ignored and +4(d) collected!"

        if "Dramaturge" in cname and c_type == "theater":
            state["pendingEncounter"] = None
            add_log(state, f"{player['name']} played 'Dramaturge' to turn the Theater Troupe into an automatic III result!", "encounter")
            _apply_table_encounter_outcome(state, enc_player, "theater", 3, emit_dice_event=True)
            _finish_pending_encounter_continuations(state, enc_player)
            return True, "Played 'Dramaturge' — Theater Troupe turned into an automatic III result!"

    if pend and pend_stage == "demand_post_roll" and "Twist Of Fate" in cname:
        old_r = int(pend.get("demandRoll", 0))
        new_r = roll_rome_die()
        new_rom = roman_die_str(new_r)
        pend["demandRoll"] = new_r
        pend["previewText"] = _get_demand_roll_preview(enc_player, pend["card"], pend)
        pend["passedIntervenors"] = []
        pend["humanModifiedSinceBotCheck"] = True
        note = (
            f"{player['name']} played 'Twist Of Fate' to re-roll {enc_player['name']}'s Demand die for "
            f"{pend['card']['name']} ({roman_die_str(old_r)} -> {new_rom})!"
        )
        add_log(state, note, "action")
        add_dice_event(
            state,
            kind="demand",
            title=f"🎲 TWIST OF FATE RE-ROLL (DEMAND: {pend['card']['name']})",
            subtitle=note,
            groups=[{
                "rollerName": enc_player["name"],
                "rollerType": "player",
                "colorName": enc_player["color"],
                "flatBonus": 0,
                "totalLabel": f"Re-rolled: {new_rom}",
                "dice": [{"value": new_r, "roman": new_rom, "sign": 1, "label": "Re-rolled Demand ®", "color": enc_player["color"]}],
            }],
            outcome_title=f"RE-ROLLED {new_rom}",
            outcome_message=pend["previewText"],
        )
        return True, f"Played 'Twist Of Fate'! Re-rolled Demand die {roman_die_str(old_r)} -> {new_rom}."

    if pend and pend_stage == "gamble_post_roll" and "Twist Of Fate" in cname:
        rolls = [int(x) for x in (pend.get("gambleRolls") or [0])]
        die_idx = max(0, min(len(rolls) - 1, int(action.get("dieIndex", action.get("targetIndex", 0)))))
        old_r = rolls[die_idx]
        new_r = roll_rome_die()
        rolls[die_idx] = new_r
        pend["gambleRolls"] = rolls
        pend["previewText"] = _get_gamble_roll_preview(enc_player, pend)
        pend["passedIntervenors"] = []
        pend["humanModifiedSinceBotCheck"] = True
        rom_list = " + ".join(roman_die_str(x) for x in rolls)
        mult = sum(rolls)
        payout = int(pend.get("bet", 0)) * mult
        cell_lbl = pend.get("cell", "Stadium")
        note = (
            f"{player['name']} played 'Twist Of Fate' to re-roll {enc_player['name']}'s Stadium Gambling die #{die_idx + 1} "
            f"({roman_die_str(old_r)} -> {roman_die_str(new_r)})!"
        )
        add_log(state, note, "action")
        add_dice_event(
            state,
            kind="gamble",
            title=f"🎲 TWIST OF FATE RE-ROLL (STADIUM {cell_lbl}) — {enc_player['name']}",
            subtitle=note,
            groups=[{
                "rollerName": enc_player["name"],
                "rollerType": "player",
                "colorName": enc_player["color"],
                "flatBonus": 0,
                "totalLabel": f"Multiplier: {mult}× ({payout}d)",
                "dice": [
                    {
                        "value": x,
                        "roman": roman_die_str(x),
                        "sign": 1,
                        "label": f"Gamble ® #{i+1}{' (Re-rolled)' if i == die_idx else ''}",
                        "color": enc_player["color"],
                    }
                    for i, x in enumerate(rolls)
                ],
            }],
            outcome_title=f"RE-ROLLED {rom_list} → {mult}× PAYOUT ({payout}d)",
            outcome_message=pend["previewText"],
        )
        return True, f"Played 'Twist Of Fate'! Re-rolled Gambling die {roman_die_str(old_r)} -> {roman_die_str(new_r)} ({mult}x -> {payout}d)."

    if "Patron" in cname:
        player["cash"] += 8
        add_log(state, f"{player['name']} played Influence '{cname}' and received +8(d)!", "action")
        return True, "Received +8(d) from Patron."
    if "Cartwright" in cname:
        player["bonusBlocks"] = player.get("bonusBlocks", 0) + 2
        add_log(state, f"{player['name']} played '{cname}' (+2■ permanent Cart Goods capacity)!", "action")
        return True, "Cart Goods capacity permanently increased by +2■."
    if "Thug" in cname:
        player["guards"].append({
            "id": f"thug_{secrets.token_hex(2)}",
            "name": "Thug (Influence)",
            "category": "Guards",
            "subcategory": "Guard",
            "track": "Guards",
            "blocks": 0,
            "guards": 1,
            "buy": [4, 3, 2, 2, 1],
            "purchasePrice": 0,
            "combatText": "(R) CP",
            "combat": {"dice": 1, "negDice": 0, "flat": 0},
        })
        add_log(state, f"{player['name']} played '{cname}' to deploy a Free Guard ((R) CP) onto their Cart!", "action")
        return True, "Added Free Guard (Thug) to Cart."
    if "Shortcut" in cname:
        player["turnEffects"]["shortcut"] = True
        add_log(state, f"{player['name']} played '{cname}' — next passable/bridged edge this turn is treated as Green!", "action")
        return True, "Next edge movement this turn ignores red blocks, tolls, and edge encounters (cannot cross unbridged Tiber borders)."
    if "Make Haste" in cname:
        player["movesRemaining"] = player.get("movesRemaining", 0) + 1
        player["turnEffects"]["makeHasteExtraTransact"] = True
        player["turnStep"] = "start"
        add_log(state, f"{player['name']} played '{cname}' to move twice this turn (and transact on both tiles)!", "action")
        return True, "Granted an extra move and transaction window this turn."
    if "Puffery" in cname:
        player["turnEffects"]["puffery"] = True
        add_log(state, f"{player['name']} played '{cname}' — all Goods sold this turn gain +1 Scarcity level!", "action")
        return True, "All sales this turn gain +1 Scarcity level."
    if "Match Fixing" in cname:
        player["turnEffects"]["matchFixing"] = True
        add_log(state, f"{player['name']} played '{cname}' — adds +1® to your next Stadium Gambling roll!", "action")
        return True, "Next Gamble roll uses 2® dice!"
    if "Man Of The People" in cname:
        player["turnEffects"]["ignoreMob"] = True
        add_log(state, f"{player['name']} played '{cname}' (ignores next Angry Mob encounter and collects +4(d)).", "action")
        return True, "Will ignore next Angry Mob encounter and collect +4(d)."
    if "Dramaturge" in cname:
        player["turnEffects"]["ignoreTheater"] = True
        add_log(state, f"{player['name']} played '{cname}' (turns next Theater Troupe encounter into an automatic III result).", "action")
        return True, "Next Theater Troupe encounter will be an automatic III result."
    if "Friend In The City Guard" in cname:
        player["friendInGuard"] = True
        player["turnEffects"]["friendInGuard"] = True
        add_log(state, f"{player['name']} played '{cname}' (waives all Edge Tolls this Night, and halves Daybreak Fine or waives Gate Fine).", "action")
        return True, "All Edge Tolls waived this Night, plus Daybreak/Gate Fine protection active."
    if "Change Of Plans" in cname:
        curr_cell = player.get("position")
        cell_state = state["romeBoard"][curr_cell]
        old_rev = cell_state.get("revealed")
        if old_rev:
            cell_state["stack"].append(old_rev)
            cell_state["revealed"] = None
        if cell_state["stack"]:
            cell_state["revealed"] = cell_state["stack"].pop(0)
        player["cash"] += 2
        new_rev = cell_state.get("revealed") or {}
        add_log(
            state,
            f"{player['name']} played 'Change Of Plans' in {curr_cell} — cycled {old_rev.get('id', 'tile')} to the bottom, revealed {new_rev.get('id', 'tile')}, and gained +2(d)!",
            "action",
        )
        check_passive_missions(state, player)
        _run_tile_encounter_and_refresh_loop(state, player, curr_cell)
        return True, f"Cycled tile in {curr_cell}, revealed {new_rev.get('id', 'new tile')}, and gained +2(d)!"
    if "Minor Supplicant" in cname:
        enc_player["tempFavor"] = enc_player.get("tempFavor", 0) + 1
        add_log(state, f"{player['name']} played '{cname}' (+1 Favor for {enc_player['name']}'s encounter).", "action")
        return True, "+1 temporary Favor for encounter."
    if "Supplicant" in cname:
        enc_player["tempFavor"] = enc_player.get("tempFavor", 0) + 2
        add_log(state, f"{player['name']} played '{cname}' (+2 Favor for {enc_player['name']}'s encounter).", "action")
        return True, "+2 temporary Favor for encounter."
    if "Flying Chamber Pot" in cname:
        target_side = action.get("targetSide", "player")
        if target_side == "opponent":
            enc_player["turnEffects"]["oppFlatBonus"] = enc_player["turnEffects"].get("oppFlatBonus", 0) + 1
            add_log(state, f"{player['name']} readied '{cname}' (+1 CP to Opponent in {enc_player['name']}'s combat).", "action")
            return True, "+1 CP bonus ready for Opponent in combat."
        enc_player["turnEffects"]["combatFlatBonus"] = enc_player["turnEffects"].get("combatFlatBonus", 0) + 1
        add_log(state, f"{player['name']} readied '{cname}' (+1 CP to {enc_player['name']} in combat).", "action")
        return True, f"+1 CP bonus ready for {enc_player['name']} in combat."
    if "Distraction" in cname:
        target_side = action.get("targetSide", "opponent")
        if target_side == "player":
            enc_player["turnEffects"]["combatDiceBonus"] = enc_player["turnEffects"].get("combatDiceBonus", 0) - 1
            add_log(state, f"{player['name']} readied '{cname}' (-1® from {enc_player['name']} in combat).", "action")
            return True, f"{enc_player['name']} loses 1® in next combat."
        enc_player["turnEffects"]["oppDiceMod"] = enc_player["turnEffects"].get("oppDiceMod", 0) - 1
        add_log(state, f"{player['name']} readied '{cname}' (-1® from Opponent in {enc_player['name']}'s combat).", "action")
        return True, "Opponent loses 1® in next combat."
    if "Mercenary" in cname or "Gladiator" in cname:
        bonus_d = 2 if "Mercenary" in cname else 1
        target_side = action.get("targetSide", "player")
        if target_side == "opponent":
            enc_player["turnEffects"]["oppDiceMod"] = enc_player["turnEffects"].get("oppDiceMod", 0) + bonus_d
            add_log(state, f"{player['name']} played '{cname}' (+{bonus_d}® CP to Opponent in {enc_player['name']}'s combat).", "action")
            return True, f"+{bonus_d}® CP added to Opponent for next combat."
        enc_player["turnEffects"]["combatDiceBonus"] = enc_player["turnEffects"].get("combatDiceBonus", 0) + bonus_d
        add_log(state, f"{player['name']} played '{cname}' (+{bonus_d}® CP to {enc_player['name']} in combat).", "action")
        return True, f"+{bonus_d}® CP added to {enc_player['name']} for next combat."
    if "Favor" in cname:
        fg = card.get("favorGain") or {}
        fac = fg.get("faction")
        cash_b = int(fg.get("cash", 6))
        player["cash"] += cash_b
        f_notes = apply_favor_list(
            player,
            fg.get("extraFavor") or ([fac] if fac else []),
            reason=f"playing Influence card '{cname}'",
        )
        add_log(state, f"{player['name']} played '{cname}' (+{cash_b}(d), {' '.join(f_notes)})!", "action")
        return True, f"+{cash_b}(d) and Favor updated."
    if "Wine Forger" in cname:
        player["cart"].append({
            "id": f"forged_wine_{secrets.token_hex(2)}",
            "name": "Forged Wine",
            "category": "Wine",
            "subcategory": "Fine Wine",
            "track": "Wine",
            "blocks": 1,
            "guards": 0,
            "sell": [12, 9, 6, 4, 3],
            "buy": [4, 3, 2, 2, 1],
            "purchasePrice": 0,
            "countsAsAnyWine": True,
        })
        add_log(state, f"{player['name']} played 'Wine Forger' — added Forged Wine (counts as any Wine) to Cart!", "action")
        return True, "Added Forged Wine to Cart."
    if "Prophecy" in cname:
        target_p = player
        raw_t = action.get("targetPlayerIndex")
        if raw_t is not None:
            try:
                t_idx = int(raw_t)
                if 0 <= t_idx < len(state["players"]):
                    target_p = state["players"][t_idx]
            except (TypeError, ValueError):
                pass
        if target_p["index"] != player["index"]:
            add_log(state, f"{player['name']} played 'Prophecy' to summon the Soothsayer upon {target_p['name']}!", "action")
        else:
            add_log(state, f"{player['name']} played 'Prophecy' to consult the Soothsayer!", "action")
        resolve_table_encounter(state, target_p, "soothsayer")
        return True, f"Triggered Soothsayer for {target_p['name']}."
    if "Surprise Shipment" in cname:
        track_name = action.get("track", "Wine")
        if track_name in state["seasonTrackShifts"]:
            state["seasonTrackShifts"][track_name] += 1
        add_log(state, f"{player['name']} played 'Surprise Shipment' — moved {track_name} scarcity one level to the right for this Season!", "action")
        return True, f"Shifted {track_name} scarcity for this season."
    if "Casus Belli" in cname:
        enc_player["turnEffects"]["casusBelli"] = True
        add_log(state, f"{player['name']} played 'Casus Belli' — may initiate combat in an encounter even when combat is not threatened!", "action")
        return True, "'Casus Belli' active — you may initiate combat in your encounter!"
    if "Procurer" in cname:
        if procurer_picked is not None:
            if procurer_picked in state["decks"].get("market", []):
                state["decks"]["market"].remove(procurer_picked)
            price = int(procurer_picked["buy"][3]) if len(procurer_picked.get("buy", [])) > 3 else int(procurer_picked["buy"][2])
            procurer_picked["purchasePrice"] = price
            player["cash"] -= price
            player["cart"].append(procurer_picked)
            _inc_player_stat(player, "itemsPurchased", 1)
            add_log(state, f"{player['name']} used 'Procurer' to buy {procurer_picked['name']} from the Goods deck at Common (>) price for {price}(d)!", "action")
            return True, f"Procured {procurer_picked['name']} at Common (>) price for {price}(d)."
        return True, "Played Procurer."

    eff_code = str(card.get("effectCode", ""))
    eff_txt = str(card.get("effectText", "")).lower()
    if eff_code.startswith("reorder_top_3") or "informants" in cname.lower() or "look at the top three" in eff_txt:
        target_type = action.get("targetType", "deck")
        raw_tkey = action.get("targetKey", "patricii")
        target_key = normalize_cell_id(raw_tkey) if target_type == "tile" else raw_tkey
        if target_type == "tile" and target_key in state["romeBoard"]:
            stk = state["romeBoard"][target_key]["stack"]
            top_items = copy.deepcopy(stk[:3])
            label_str = f"Neighborhood Stack {target_key} ({NEIGHBORHOOD_NAMES.get(target_key, target_key)})"
        else:
            target_type = "deck"
            if target_key not in state["decks"]:
                target_key = "patricii"
            dk = state["decks"][target_key]
            top_items = copy.deepcopy(dk[:3])
            label_str = f"{target_key.capitalize()} Deck"
        player["pendingTop3Reorder"] = {
            "id": f"top3_{secrets.token_hex(4)}",
            "targetType": target_type,
            "targetKey": target_key,
            "label": label_str,
            "items": top_items,
        }
        add_log(
            state,
            f"{player['name']} played '{cname}' to inspect and reorder the top {len(top_items)} item(s) of {label_str}!",
            "action",
        )
        return True, f"Inspecting top {len(top_items)} of {label_str} — put them back in any order!"

    add_log(state, f"{player['name']} played Influence card '{cname}'.", "action")
    return True, f"Played '{cname}'."


def _bot_grid_distance(src_cell: str, dst_cell: str, state: Optional[Dict[str, Any]] = None) -> int:
    """BFS shortest step count on the 6x6 Rome grid respecting Tiber Bridges (and revealed impassable edges)."""
    s = normalize_cell_id(src_cell)
    t = normalize_cell_id(dst_cell)
    if not s or not t:
        return 99
    if s == t:
        return 0
    visited = {s}
    queue: List[Tuple[str, int]] = [(s, 0)]
    rome_board = (state or {}).get("romeBoard") or {}
    while queue:
        u, dist = queue.pop(0)
        rev = (rome_board.get(u) or {}).get("revealed")
        eff_edges = get_effective_tile_edges(u, rev) if rev else None
        for d in DIR_DELTAS:
            if eff_edges is not None and eff_edges.get(d) in ("red", None, "none"):
                continue
            v = get_target_cell(u, d)
            if not v or v in visited:
                continue
            if is_tiber_crossing_blocked(u, v):
                continue
            if v == t:
                return dist + 1
            visited.add(v)
            queue.append((v, dist + 1))
    # Fallback ignoring revealed tile red edges (e.g. if a Shortcut or tile refresh could open a path)
    if state is not None:
        return _bot_grid_distance(s, t, None) + 2
    return 99


def _bot_distance_to_exit(cell: str, state: Optional[Dict[str, Any]] = None) -> int:
    c = normalize_cell_id(cell)
    if not c:
        return 0
    rev = ((state or {}).get("romeBoard") or {}).get(c, {}).get("revealed")
    if rev:
        eff_edges = get_effective_tile_edges(c, rev)
        for d, val in eff_edges.items():
            if val not in ("red", None, "none") and get_target_cell(c, d) is None:
                return 1
    return min((_bot_grid_distance(c, g, state) + 1 for g in GATE_CELLS), default=4)


def run_bots_until_human(state: Dict[str, Any]) -> None:
    """Executes AI bot turns automatically until it is a human player's turn or the game ends."""
    safety = 0
    while safety < 250:
        safety += 1
        if state["phase"] in ("finished", "setup_discard", "cleanup"):
            break
        if any(
            p.get("pendingNpcOffer") or p.get("pendingCartOverflow") or p.get("pendingMarketReward")
            for p in state["players"]
            if not p.get("isBot")
        ):
            break
        if state.get("pendingEncounter"):
            pend = state["pendingEncounter"]
            if pend.get("interveningPlayerIndex") is not None:
                break
            p_enc = state["players"][pend["playerIndex"]]
            if p_enc["isBot"]:
                c_enc = pend.get("card") or {}
                deck_k = pend.get("deck", (c_enc.get("deck") or "patricii").lower())
                decision = "fulfill"
                r_type = pend.get("reaction") or pend.get("reactionType") or ""
                if (
                    pend.get("stage", "pre_decision") == "pre_decision"
                    and bot_should_initiate_combat(state, p_enc, pend, c_enc, deck_k)
                ):
                    decision = "fight"
                elif (
                    pend.get("stage", "pre_decision") == "pre_decision"
                    and r_type in ("mission_offer", "deck_quest_offer", "quest_optional")
                    and (
                        (state.get("season") == "Fall" and int(state.get("turn", 1)) >= 7)
                        or len(p_enc.get("missions", [])) >= 4
                    )
                ):
                    decision = "refuse"
                resolve_pending_encounter_choice(state, p_enc, pend, decision)
                if not state.get("pendingEncounter"):
                    _finish_pending_encounter_continuations(state, p_enc)
                continue
            break

        active_p = state["players"][state["activePlayerIndex"]]
        if not active_p["isBot"]:
            break

        if state["phase"] == "setup_climate":
            _run_bot_climate_pick(state, active_p)
        elif state["phase"] == "market":
            _run_bot_market_turn(state, active_p)
        elif state["phase"] == "delivery_entry":
            _run_bot_entry_turn(state, active_p)
        elif state["phase"] == "delivery":
            _run_bot_delivery_turn(state, active_p)
        else:
            break


def _run_bot_climate_pick(state: Dict[str, Any], bot: Dict[str, Any]) -> None:
    pc = state.get("politicalClimate") or {}
    taken_factors = set((pc.get("activeByFactor") or {}).keys())
    candidates = [opt for opt in POLITICAL_CLIMATE_OPTIONS if opt["factor"] not in taken_factors]
    if not candidates:
        _advance_setup_climate(state)
        return

    strat = str(bot.get("botStrategy", "balanced"))
    mission_favors = [f for m in bot.get("missions", []) for f in (m.get("favor") or [])]

    def _score_opt(opt: Dict[str, Any]) -> int:
        oid = opt["id"]
        fac = opt["factor"]
        sc = 10 + secrets.randbelow(5)
        pos_m = sum(1 for f in mission_favors if f == fac)
        neg_m = sum(1 for f in mission_favors if f == f"-{fac}")

        if strat == "aggressive":
            if oid in ("caracalla_3", "caracalla_1", "aurelius_2", "geta_1"):
                sc += 20
        elif strat == "luxury":
            if oid in ("aurelius_3", "domna_1", "aurelius_1", "geta_2"):
                sc += 20
        elif strat == "missions":
            if oid in ("missions_3", "missions_1", "missions_2", "plautilla_2"):
                sc += 22
        elif strat == "opportunist":
            if oid in ("plautilla_3", "plautilla_1", "domna_3", "geta_3"):
                sc += 20
        else:
            if oid in ("missions_1", "missions_2", "domna_1", "aurelius_1", "geta_2", "domna_3"):
                sc += 14

        if pos_m > 0 and oid in ("domna_1", "plautilla_1", "plautilla_2", "aurelius_1", "aurelius_2", "aurelius_3", "geta_2", "geta_3", "caracalla_3", "domna_3"):
            sc += 8 * pos_m
        if neg_m > 0 and oid in ("caracalla_2", "aurelius_2"):
            sc += 10 * neg_m
        return sc

    chosen = max(candidates, key=_score_opt)
    _apply_climate_option_pick(state, bot, chosen["id"])


def bot_should_initiate_combat(
    state: Dict[str, Any],
    bot: Dict[str, Any],
    pend: Dict[str, Any],
    card: Optional[Dict[str, Any]] = None,
    deck_key: Optional[str] = None,
) -> bool:
    if pend.get("combatMandatory"):
        return True
    eff_card = card if card is not None else (pend.get("card") or {})
    eff_deck = deck_key if deck_key is not None else str(pend.get("deck") or "patricii")
    if not pend.get("canInitiateCombat") and not pend.get("hasCasusBelliCard"):
        return False
    combat_m = _find_combat_mission_for_encounter(bot, eff_card, eff_deck)
    party_strength = 1 + len(bot.get("guards", [])) + sum(
        1 for c in bot.get("cart", []) if (c.get("combat") or {}).get("dice", 0) > 0 or (c.get("combat") or {}).get("flat", 0) > 0
    )
    if combat_m is not None and party_strength >= int(pend.get("xCount", 1)):
        return True
    if (
        bot.get("botStrategy") == "aggressive"
        and pend.get("canInitiateCombat")
        and pend.get("combatThreatened")
        and party_strength >= int(pend.get("xCount", 1)) + 1
    ):
        return True
    return False


def _run_bot_market_turn(state: Dict[str, Any], bot: Dict[str, Any]) -> None:
    strategy = bot.get("botStrategy", "balanced")
    # Play cash-generating Influence cards (Patron / Favor) in Ostia if cash is low
    if bot["cash"] <= 6:
        for inf_c in list(bot.get("influence", [])):
            nm = str(inf_c.get("name", ""))
            if "Patron" in nm or ("Favor" in nm and (inf_c.get("favorGain") or {}).get("faction") != "Geta"):
                _execute_influence_card(state, bot, inf_c, {})
                add_npc_event(state, bot, "influence", f"Played '{nm}' in Ostia")
                break

    max_b, max_g = get_player_cart_limits(bot)
    used_b, used_g = get_player_cart_usage(bot)

    # Persona-aware Guard recruitment
    want_guards = 2 if strategy == "aggressive" else (0 if strategy == "opportunist" else 1)
    guard_cash_buffer = 2 if strategy == "aggressive" else 4
    if used_g < want_guards and state["marketBoard"]["Guards"]:
        guards_track = state["marketBoard"]["Guards"]
        col_idx = len(guards_track) - 1
        g_card = guards_track[col_idx]
        price = int(g_card["buy"][COL_TO_PRICE_INDEX[col_idx]])
        req_g = int(g_card.get("guards", 1) or 1)
        if used_g + req_g <= max_g + int(g_card.get("bonusGuards", 0) or 0) and bot["cash"] >= price + guard_cash_buffer:
            bot["cash"] -= price
            bought = guards_track.pop(col_idx)
            bought["purchasePrice"] = price
            bot["guards"].append(bought)
            _inc_player_stat(bot, "itemsPurchased", 1)
            if state["decks"]["market"]:
                push_card_onto_market_track(state, state["decks"]["market"].pop(0))
            state["marketConsecutivePasses"] = 0
            add_log(state, f"{bot['name']} hired Guard {bought['name']} in Ostia for {price}(d).", "action")
            add_npc_event(
                state,
                bot,
                "market_buy",
                f"Hired Guard {bought['name']} ({price}d)",
                visual={
                    "kind": "buy",
                    "item": _public_item_visual(bought),
                    "price": price,
                    "outcomeLabel": f"🛡️ Hired -{price}d",
                },
            )
            advance_market_turn(state)
            return

    # Reserve Cart blocks for unpicked Delivery Mission cargo if Courier ('missions') or already carrying goods
    delivery_blocks_needed = max(
        (
            int(m.get("blocks", 1))
            for m in bot.get("missions", [])
            if m.get("kind") == "delivery" and not m.get("completed") and not m.get("pickedUp")
        ),
        default=0,
    )
    eff_max_b = max_b
    if strategy == "missions" and delivery_blocks_needed > 0:
        eff_max_b = max(2, max_b - min(3, delivery_blocks_needed))
    elif delivery_blocks_needed > 0 and len(bot.get("cart", [])) >= 1:
        eff_max_b = max(3, max_b - min(2, delivery_blocks_needed))

    mission_cats = [m.get("category", "") for m in bot["missions"] if m.get("kind") == "sell" and not m.get("completed")]
    toll_reserve = 0 if strategy in ("luxury", "aggressive") else (2 if bot["cash"] >= 6 else 0)

    def _find_best_market_good(reserve_amt: int) -> Optional[Tuple[str, int, int, float]]:
        best_c = None
        best_sc = -999.0
        for track_name in ("Marble", "Wine", "Animals", "Weapons", "Grain"):
            track = state["marketBoard"].get(track_name, [])
            for col_idx, card in enumerate(track):
                blocks = int(card.get("blocks", 1) or 1)
                if used_b + blocks > eff_max_b:
                    continue
                price = int(card["buy"][COL_TO_PRICE_INDEX[col_idx]])
                if price > bot["cash"] - reserve_amt:
                    continue
                expected_sell = int(card["sell"][get_track_scarcity_index(track)])
                profit = expected_sell - price
                bonus = 0.0
                if any(matches_category(card, mc) for mc in mission_cats):
                    bonus += 13.0 if strategy == "missions" else 9.0
                if strategy == "luxury" and (track_name == "Marble" or card.get("subcategory") == "Fine Wine"):
                    bonus += 4.5
                elif strategy == "aggressive" and (track_name == "Weapons" or card.get("subcategory") == "Exotic Animals"):
                    bonus += 4.0
                elif strategy == "opportunist" and blocks == 1:
                    bonus += 2.5
                score = (profit + bonus) / max(1, blocks)
                if score > best_sc and (profit >= 1 or bonus >= 4.0):
                    best_sc = score
                    best_c = (track_name, col_idx, price, score)
        return best_c

    best_choice = _find_best_market_good(toll_reserve)
    if not best_choice and toll_reserve > 0:
        best_choice = _find_best_market_good(0)

    if best_choice:
        track_name, col_idx, price, _ = best_choice
        track = state["marketBoard"][track_name]
        bought = track.pop(col_idx)
        bought["purchasePrice"] = price
        bot["cash"] -= price
        bot["cart"].append(bought)
        _inc_player_stat(bot, "itemsPurchased", 1)
        if state["decks"]["market"]:
            push_card_onto_market_track(state, state["decks"]["market"].pop(0))
        state["marketConsecutivePasses"] = 0
        add_log(state, f"{bot['name']} bought {bought['name']} ({track_name}) in Ostia for {price}(d).", "action")
        add_npc_event(
            state,
            bot,
            "market_buy",
            f"Bought {bought['name']} ({price}d)",
            visual={
                "kind": "buy",
                "item": _public_item_visual(bought),
                "price": price,
                "outcomeLabel": f"🛒 Bought -{price}d",
            },
        )
        advance_market_turn(state)
    else:
        state["marketConsecutivePasses"] += 1
        add_log(state, f"{bot['name']} passed in the Ostia Market.", "action")
        add_npc_event(state, bot, "market_pass", "Passed in Ostia Market", visual={"kind": "pass", "outcomeLabel": "⏭ Passed"})
        advance_market_turn(state)


def _compute_bot_goal_cells(state: Dict[str, Any], bot: Dict[str, Any]) -> List[Tuple[str, int]]:
    """Returns list of (cell, priority_weight) target neighborhoods in Rome for this bot."""
    goals: List[Tuple[str, int]] = []
    max_b, _ = get_player_cart_limits(bot)
    used_b, _ = get_player_cart_usage(bot)
    turn_num = int(state.get("turn", 1))
    strategy = bot.get("botStrategy", "balanced")

    sellable_items = [c for c in bot.get("cart", []) if not c.get("isMissionCargo")]

    for m in bot.get("missions", []):
        if m.get("completed"):
            continue
        mkind = m.get("kind")
        if mkind == "delivery":
            d_cell = normalize_cell_id(m.get("deliverCell"))
            p_cell = normalize_cell_id(m.get("pickupCell"))
            if m.get("pickedUp") and d_cell:
                goals.append((d_cell, 100))
            elif not m.get("pickedUp") and p_cell and used_b + int(m.get("blocks", 1)) <= max_b and turn_num <= 7:
                goals.append((p_cell, 85 if strategy == "missions" else 70))
        elif mkind == "sell":
            s_cell = normalize_cell_id(m.get("cell"))
            if s_cell and any(matches_category(c, m.get("category", "")) for c in sellable_items):
                goals.append((s_cell, 90))
        elif mkind == "kill" and strategy == "aggressive" and turn_num <= 7:
            t_deck = str(m.get("targetDeck") or "").lower()
            for coord, c_st in state["romeBoard"].items():
                rev = c_st.get("revealed")
                if rev and str(rev.get("encounter") or "").lower().startswith(t_deck):
                    goals.append((coord, 65))

    # Add revealed tiles that buy any of our sellable cart items profitably
    if sellable_items:
        for coord, c_st in state["romeBoard"].items():
            rev = c_st.get("revealed")
            if not rev:
                continue
            for ts in rev.get("sells", []):
                matching = [c for c in sellable_items if matches_category(c, ts["category"])]
                if matching:
                    best_pr = max(compute_sell_price(state, bot, c, ts["modifier"])[0] for c in matching)
                    cost_b = int(matching[0].get("purchasePrice", 0) or 0)
                    if best_pr >= cost_b or turn_num >= 6:
                        goals.append((coord, 40 + max(0, best_pr - cost_b) * 3))
        # If no revealed buyers exist yet, explore central unrevealed neighborhoods to uncover buyers
        if not any(w >= 40 for _, w in goals):
            for hub in ("C3", "D3", "C4", "D4", "B3", "C2", "D5", "E4"):
                if not state["romeBoard"].get(hub, {}).get("revealed"):
                    goals.append((hub, 30))

    # Opportunist seeks revealed Stadiums when flush with Denarii
    if strategy == "opportunist" and bot.get("cash", 0) >= 6 and turn_num <= 6 and not bot.get("transactedThisTurn"):
        for coord, c_st in state["romeBoard"].items():
            rev = c_st.get("revealed")
            if rev and rev.get("gamble"):
                goals.append((coord, 45))

    return goals


def _run_bot_entry_turn(state: Dict[str, Any], bot: Dict[str, Any]) -> None:
    goals = _compute_bot_goal_cells(state, bot)
    if goals:
        best_goal = max(goals, key=lambda pair: pair[1])[0]
        chosen_gate = min(GATE_CELLS, key=lambda g: (_bot_grid_distance(g, best_goal, state), secrets.randbelow(4)))
    else:
        chosen_gate = secrets.choice(GATE_CELLS)

    bot["position"] = chosen_gate
    bot["previousPosition"] = None
    bot["turnStep"] = "ready"
    add_log(state, f"{bot['name']} positioned their Cart at Gate {chosen_gate} ({NEIGHBORHOOD_NAMES.get(chosen_gate, chosen_gate)}).", "action")
    add_npc_event(
        state,
        bot,
        "gate",
        f"Positioned Cart outside {chosen_gate} ({NEIGHBORHOOD_NAMES.get(chosen_gate, chosen_gate)})",
        cell=chosen_gate,
        visual={"kind": "gate", "gate": chosen_gate, "outcomeLabel": f"🏛️ Gate {chosen_gate}"},
    )

    n = len(state["players"])
    if all(p["position"] in GATE_CELLS for p in state["players"]):
        _begin_night_delivery_turn_1(state)
    else:
        state["activePlayerIndex"] = (state["activePlayerIndex"] + 1) % n


def _bot_try_proactive_self_influence(state: Dict[str, Any], bot: Dict[str, Any]) -> None:
    """Plays beneficial non-reactive Influence cards in Rome (Patron, Thug, Wine Forger, Cartwright, Friend In The City Guard)."""
    if state.get("pendingEncounter") or not bot.get("influence"):
        return
    max_b, max_g = get_player_cart_limits(bot)
    used_b, used_g = get_player_cart_usage(bot)
    for c in list(bot.get("influence", [])):
        nm = str(c.get("name", ""))
        if "Patron" in nm:
            _execute_influence_card(state, bot, c, {})
            add_npc_event(state, bot, "influence", f"Played '{nm}' (+8d)", cell=bot.get("position"), visual={"kind": "influence", "cardName": nm, "outcomeLabel": "🃏 +8d"})
        elif "Favor" in nm and (c.get("favorGain") or {}).get("faction") != "Geta":
            _execute_influence_card(state, bot, c, {})
            add_npc_event(state, bot, "influence", f"Played '{nm}'", cell=bot.get("position"), visual={"kind": "influence", "cardName": nm, "outcomeLabel": f"🃏 {nm}"})
        elif "Thug" in nm and used_g + 1 <= max_g:
            _execute_influence_card(state, bot, c, {})
            add_npc_event(state, bot, "influence", "Deployed Free Guard 'Thug'", cell=bot.get("position"), visual={"kind": "influence", "cardName": nm, "outcomeLabel": "🛡️ Thug (+1 CP)"})
            _, used_g = get_player_cart_usage(bot)
        elif "Cartwright" in nm and used_b >= max_b - 1:
            _execute_influence_card(state, bot, c, {})
            add_npc_event(state, bot, "influence", "Played 'Cartwright' (+2■)", cell=bot.get("position"), visual={"kind": "influence", "cardName": nm, "outcomeLabel": "🛒 +2■ Space"})
            max_b, _ = get_player_cart_limits(bot)
        elif "Wine Forger" in nm and used_b + 1 <= max_b and int(state.get("turn", 1)) <= 7:
            _execute_influence_card(state, bot, c, {})
            add_npc_event(state, bot, "influence", "Played 'Wine Forger'", cell=bot.get("position"), visual={"kind": "influence", "cardName": nm, "outcomeLabel": "🍷 Wine Forger"})
            used_b, _ = get_player_cart_usage(bot)
        elif "Friend In The City Guard" in nm and not bot.get("friendInGuard") and int(state.get("turn", 1)) >= 6:
            _execute_influence_card(state, bot, c, {})
            add_npc_event(state, bot, "influence", "Played 'Friend In The City Guard'", cell=bot.get("position"), visual={"kind": "influence", "cardName": nm, "outcomeLabel": "🛡️ Free Tolls"})


def _bot_try_adversarial_turn_influence(state: Dict[str, Any], bot: Dict[str, Any]) -> None:
    """Allows NPC bots to play proactive adversarial Influence cards (Surprise Shipment, Prophecy) against the winning player."""
    if state.get("pendingEncounter") or not bot.get("influence"):
        return
    leader = _get_winning_opponent(state, bot)
    if not leader or not _should_bot_target_adversarially(state, bot, leader, is_extreme_luck=False):
        return

    # 1. Surprise Shipment: depress scarcity on a Goods category heavily held on the leader's Cart (and not held by this bot)
    ss_card = next((c for c in bot["influence"] if "Surprise Shipment" in str(c.get("name", ""))), None)
    if ss_card:
        best_track = None
        best_leader_val = 0
        for t_name in ("Marble", "Wine", "Animals", "Weapons", "Grain"):
            if any(c.get("track") == t_name for c in bot.get("cart", [])):
                continue
            track_cards = state["marketBoard"].get(t_name, [])
            shift = state.get("seasonTrackShifts", {}).get(t_name, 0)
            sc_idx = get_track_scarcity_index(track_cards, shift)
            if sc_idx >= 4:
                continue
            leader_items = [c for c in leader.get("cart", []) if c.get("track") == t_name and c.get("sell")]
            if not leader_items:
                continue
            leader_blocks = sum(int(c.get("blocks", 1)) for c in leader_items)
            leader_val = sum(int(c["sell"][sc_idx]) for c in leader_items)
            if (leader_blocks >= 2 or leader_val >= 8) and leader_val > best_leader_val:
                best_leader_val = leader_val
                best_track = t_name
        if best_track:
            _execute_influence_card(state, bot, ss_card, {"track": best_track})
            add_npc_event(state, bot, "influence", f"Played 'Surprise Shipment' on {best_track}", cell=bot.get("position"), visual={"kind": "influence", "cardName": "Surprise Shipment", "outcomeLabel": f"📉 {best_track}"})
            if state.get("pendingEncounter"):
                return

    # 2. Prophecy: saddle the winning player with a Soothsayer encounter when their mission slate is crowded or night is late
    proph_card = next((c for c in bot["influence"] if "Prophecy" in str(c.get("name", ""))), None)
    if proph_card and (int(state.get("turn", 1)) >= 5 or len(leader.get("missions", [])) >= 3):
        _execute_influence_card(state, bot, proph_card, {"targetPlayerIndex": leader["index"]})
        add_npc_event(state, bot, "influence", f"Played 'Prophecy' on {leader['name']}", cell=bot.get("position"), visual={"kind": "influence", "cardName": "Prophecy", "outcomeLabel": f"🔮 → {leader['name']}"})


def _run_bot_delivery_turn(state: Dict[str, Any], bot: Dict[str, Any]) -> None:
    if state.get("pendingEncounter"):
        return
    curr_cell = bot.get("position")
    if not curr_cell or bot["exitedRome"] or bot["nightEnded"]:
        advance_delivery_turn(state)
        return

    # 0. Consider playing self-buff and adversarial Influence cards
    _bot_try_proactive_self_influence(state, bot)
    _bot_try_adversarial_turn_influence(state, bot)
    if state.get("pendingEncounter"):
        return

    # 1. Try to sell/transact on current tile before moving (if already profitable)
    _bot_try_transact(state, bot)
    if state.get("pendingEncounter") or state["phase"] == "finished":
        return

    # 2. Move if movesRemaining > 0
    while bot.get("movesRemaining", 0) > 0 and not bot["exitedRome"] and not bot["nightEnded"] and bot["turnStep"] != "done":
        curr_cell = bot.get("position")
        if not curr_cell:
            break
        rev_tile = state["romeBoard"][curr_cell].get("revealed") or {}
        edges = get_effective_tile_edges(curr_cell, rev_tile)
        guard_friend_active = bool(bot.get("friendInGuard") or bot.get("turnEffects", {}).get("friendInGuard"))
        div_tiber_active = has_climate_modifier(state, "geta_3")
        bot_has_emerald = int((bot.get("favor") or {}).get("Geta", 0)) >= 1

        passable: List[Tuple[str, str]] = []
        for d, val in edges.items():
            if val in ("red", None, "none"):
                continue
            t_cand = get_target_cell(curr_cell, d)
            if is_tiber_crossing_blocked(curr_cell, t_cand):
                continue
            toll_amt = parse_edge_toll(val)
            edge_cost = (toll_amt or 0) if not guard_friend_active else 0
            bridge_cost = 4 if (div_tiber_active and get_tiber_bridge_name(curr_cell, t_cand) and not bot_has_emerald) else 0
            if bot["cash"] < edge_cost + bridge_cost:
                continue
            passable.append((d, val))

        used_shortcut = False
        if not passable:
            sc = next((c for c in bot["influence"] if "Shortcut" in c.get("name", "")), None)
            bridged_dirs = [d for d in edges.keys() if not is_tiber_crossing_blocked(curr_cell, get_target_cell(curr_cell, d))]
            if sc and bridged_dirs:
                bot["influence"].remove(sc)
                state["decks"]["influence"].append(sc)
                state["hourEffects"]["lastInfluencePlayed"] = sc
                _inc_player_stat(bot, "influencePlayed", 1)
                used_shortcut = True
                passable = [(d, "green") for d in bridged_dirs]
                add_log(state, f"{bot['name']} played 'Shortcut' to bypass blocked edges in {curr_cell}!", "action")
                add_npc_event(state, bot, "influence", f"Played 'Shortcut' in {curr_cell}", cell=curr_cell)
            else:
                bot["movesRemaining"] = 0
                break

        goals = _compute_bot_goal_cells(state, bot)
        turns_left = max(0, 10 - int(state.get("turn", 1)))
        dist_exit = _bot_distance_to_exit(curr_cell, state)
        has_cargo_or_goals = bool(bot.get("cart")) or bool(goals)
        should_exit = (dist_exit >= turns_left + 1) or (int(state.get("turn", 1)) >= 9) or (not has_cargo_or_goals and int(state.get("turn", 1)) >= 3)

        chosen_dir, chosen_val = passable[0]
        if should_exit:
            egress_dirs = [(d, v) for d, v in passable if get_target_cell(curr_cell, d) is None]
            if egress_dirs:
                greens_out = [pair for pair in egress_dirs if pair[1] == "green"]
                chosen_dir, chosen_val = (greens_out or egress_dirs)[0]
            else:
                best_exit_score = 9999.0
                for d, v in passable:
                    tcell = get_target_cell(curr_cell, d)
                    if not tcell:
                        continue
                    d_gate = min(_bot_grid_distance(tcell, g, state) for g in GATE_CELLS)
                    edge_pen = 0.0 if v == "green" else (0.4 if parse_edge_toll(v) is not None else 0.8)
                    if div_tiber_active and get_tiber_bridge_name(curr_cell, tcell) and not bot_has_emerald and not used_shortcut:
                        edge_pen += 0.9
                    sc_val = d_gate + edge_pen
                    if sc_val < best_exit_score:
                        best_exit_score = sc_val
                        chosen_dir, chosen_val = d, v
        else:
            non_egress = [(d, v) for d, v in passable if get_target_cell(curr_cell, d) is not None]
            cand_pool = non_egress if non_egress else passable
            best_move_score = -9999.0
            for d, v in cand_pool:
                tcell = get_target_cell(curr_cell, d)
                if not tcell:
                    continue
                if goals:
                    best_g_val = max(
                        weight - 14.0 * _bot_grid_distance(tcell, g_cell, state)
                        for g_cell, weight in goals
                    )
                else:
                    # Explore toward central neighborhoods
                    best_g_val = 25.0 - 6.0 * _bot_grid_distance(tcell, "C3", state)
                if tcell == bot.get("previousPosition"):
                    best_g_val -= 8.0
                if v == "green":
                    best_g_val += 3.0
                elif parse_edge_toll(v) is not None:
                    best_g_val -= 1.5
                else:
                    best_g_val -= 2.5
                if div_tiber_active and get_tiber_bridge_name(curr_cell, tcell) and not bot_has_emerald and not used_shortcut:
                    best_g_val -= 4.0
                if best_g_val > best_move_score:
                    best_move_score = best_g_val
                    chosen_dir, chosen_val = d, v

        target_cell = get_target_cell(curr_cell, chosen_dir)
        toll_amt = parse_edge_toll(chosen_val) if not used_shortcut else None
        if toll_amt is not None and not guard_friend_active:
            bot["cash"] -= toll_amt
            add_log(state, f"{bot['name']} paid {toll_amt}(d) toll to cross the {chosen_dir} edge of {curr_cell}.", "action")

        bridge_nm_pre = get_tiber_bridge_name(curr_cell, target_cell) if not used_shortcut else None
        if div_tiber_active and bridge_nm_pre:
            if bot_has_emerald:
                add_log(state, f"{bot['name']} crossed {bridge_nm_pre} with the 4(d) Divided Tiber toll waived (+Emerald Favor)!", "action")
            else:
                bot["cash"] -= 4
                add_log(state, f"{bot['name']} paid 4(d) Divided Tiber toll to cross {bridge_nm_pre}.", "action")

        # Edge encounter
        if not used_shortcut and chosen_val not in ("green", "red", None, "none") and toll_amt is None:
            curr_rev_tile = (state["romeBoard"].get(curr_cell) or {}).get("revealed") or {}
            tile_id_lbl = curr_rev_tile.get("id", curr_cell)
            src_lbl = f"Crossing {chosen_dir} Edge of {tile_id_lbl} ({curr_cell} → {target_cell or 'Exit'}) ({str(chosen_val).replace('_', ' ×')})"
            if chosen_val in ("mob", "theater", "soothsayer"):
                resolve_table_encounter(state, bot, chosen_val, source_label=src_lbl)
            else:
                trigger_deck_encounter(state, bot, chosen_val, source_label=src_lbl)
            if state.get("pendingEncounter"):
                state["pendingPostEncounterMove"] = {
                    "playerIndex": bot["index"],
                    "fromCell": curr_cell,
                    "direction": chosen_dir,
                    "targetCell": target_cell,
                }
                return

        if bot["nightEnded"] or bot["turnStep"] == "done":
            break

        bot["movesRemaining"] -= 1
        bot["previousPosition"] = curr_cell

        if target_cell is None:
            bot["position"] = None
            bot["exitedRome"] = True
            bot["turnStep"] = "done"
            add_log(state, f"{bot['name']} exited Rome safely via {curr_cell} ({chosen_dir})!", "phase")
            add_npc_event(
                state,
                bot,
                "exit",
                f"Exited Rome via {curr_cell} ({chosen_dir})",
                from_cell=curr_cell,
                visual={"kind": "exit", "direction": chosen_dir, "outcomeLabel": f"🏁 Exited ({chosen_dir})"},
            )
            break

        if bot.get("transactedThisTurn") and bot.get("turnEffects", {}).get("makeHasteExtraTransact"):
            bot["transactedThisTurn"] = False
            bot["gambledThisTurn"] = False
            bot["turnEffects"]["makeHasteExtraTransact"] = False

        bot["position"] = target_cell
        bridge_nm = get_tiber_bridge_name(curr_cell, target_cell)
        bridge_note = f" across {bridge_nm}" if bridge_nm else ""
        add_log(state, f"{bot['name']} moved {chosen_dir}{bridge_note} from {curr_cell} to {target_cell} ({NEIGHBORHOOD_NAMES.get(target_cell, target_cell)}).", "action")
        add_npc_event(
            state,
            bot,
            "move",
            f"Moved {chosen_dir}{bridge_note} to {target_cell} ({NEIGHBORHOOD_NAMES.get(target_cell, target_cell)})",
            cell=target_cell,
            from_cell=curr_cell,
            visual={
                "kind": "move",
                "direction": chosen_dir,
                "bridge": bridge_nm,
                "outcomeLabel": f"🧭 {curr_cell} → {target_cell}",
            },
        )
        resolve_tile_entry(state, bot, target_cell)
        if state.get("pendingEncounter") or state["phase"] == "finished":
            return
        _bot_try_transact(state, bot)
        if state.get("pendingEncounter") or state["phase"] == "finished":
            return

    if state["activePlayerIndex"] == bot["index"] and state["phase"] == "delivery" and not state.get("pendingEncounter"):
        advance_delivery_turn(state)


def _bot_pick_amethyst_boost(state: Dict[str, Any], bot: Dict[str, Any], item: Dict[str, Any], modifier: str) -> Tuple[int, int, str]:
    base_p, base_sym = compute_sell_price(state, bot, item, modifier, spend_amethysts=0)
    if not has_climate_modifier(state, "aurelius_3") or state.get("hourEffects", {}).get("priceEdict"):
        return 0, base_p, base_sym
    avail_am = max(0, int((bot.get("favor") or {}).get("Aurelius", 0)))
    cur_idx = SCARCITY_SYMBOLS.index(base_sym) if base_sym in SCARCITY_SYMBOLS else 2
    max_s = min(avail_am, cur_idx)
    best_spend = 0
    best_p = base_p
    best_sym = base_sym
    for k in range(1, max_s + 1):
        cand_p, cand_sym = compute_sell_price(state, bot, item, modifier, spend_amethysts=k)
        # Spend Amethysts when marginal gain is at least 5(d) per spent Amethyst
        if cand_p - base_p >= 5 * k and (cand_p - best_p >= 5):
            best_spend = k
            best_p = cand_p
            best_sym = cand_sym
    return best_spend, best_p, best_sym


def _bot_try_transact(state: Dict[str, Any], bot: Dict[str, Any]) -> None:
    if bot.get("transactedThisTurn") or bot.get("gambledThisTurn") or not bot.get("position") or bot["exitedRome"] or bot["nightEnded"]:
        return
    curr_cell = bot["position"]
    rev_tile = state["romeBoard"][curr_cell].get("revealed") or {}
    tile_sells = rev_tile.get("sells", [])
    mission_sells = [
        m for m in bot["missions"]
        if not m.get("completed") and m.get("kind") == "sell" and normalize_cell_id(m.get("cell")) == curr_cell
    ]
    sellable_cart = [c for c in bot["cart"] if not c.get("isMissionCargo")]

    # 1. Complete a Sell Mission at this cell if possible (1 Good sold per hour)
    for m in mission_sells:
        matching = [c for c in sellable_cart if matches_category(c, m["category"])]
        if matching:
            puff = next((inf for inf in bot.get("influence", []) if "Puffery" in str(inf.get("name", ""))), None)
            if puff and not bot.get("turnEffects", {}).get("puffery"):
                _execute_influence_card(state, bot, puff, {})
            item = max(matching, key=lambda c: compute_sell_price(state, bot, c, m["modifier"])[0])
            spend_am, p, sym = _bot_pick_amethyst_boost(state, bot, item, m["modifier"])
            am_note = ""
            if spend_am > 0:
                bot["favor"]["Aurelius"] = int(bot["favor"].get("Aurelius", 0)) - spend_am
                bot.setdefault("favorHistory", {f: [] for f in FACTIONS}).setdefault("Aurelius", []).append({
                    "delta": -spend_am,
                    "reason": f"Senatorial Privilege sale of {item['name']} in {curr_cell}",
                    "newTotal": bot["favor"]["Aurelius"],
                })
                am_note = f" [spent {spend_am} Amethyst -> {sym}]"
            _remove_cart_item(state, bot, item, reason=f"sold in {curr_cell} for Mission '{m['name']}'")
            bot["cash"] += p
            bot["transactedThisTurn"] = True
            _inc_player_stat(bot, "itemsSold", 1)
            m["completed"] = True
            if m in bot["missions"]:
                bot["missions"].remove(m)
            r_notes = grant_reward(state, bot, m.get("reward"), m.get("rewardText", ""), is_mission_reward=True)
            if m.get("patronRewardText"):
                r_notes.extend(grant_reward(state, bot, None, m.get("patronRewardText", ""), is_mission_reward=True))
            if m.get("source") == "soothsayer" and m.get("underInfluence"):
                under = m.pop("underInfluence", [])
                bot["influence"].extend(under)
                r_notes.append(f"+{len(under)} Soothsayer Influence Card(s)")
            patron_lbl = f" for {m['patronName']}" if m.get("patronName") else ""
            f_notes = apply_favor_list(
                bot,
                m.get("favor", []),
                reason=f"completing mission '{m['name']}'{patron_lbl} (sold {item['name']} in {curr_cell})",
            )
            _record_mission_completion_event(
                state,
                bot,
                m,
                r_notes,
                f_notes,
                context_detail=f"Sold {item['name']} in {curr_cell} ({NEIGHBORHOOD_NAMES.get(curr_cell, curr_cell)})",
            )
            _recycle_mission_cards(state, m)
            add_log(state, f"{bot['name']} sold {item['name']} ({p}d @ {sym}){am_note} in {curr_cell} and completed Mission '{m['name']}'! {' '.join(r_notes + f_notes)}", "mission")
            add_npc_event(
                state,
                bot,
                "sell",
                f"Sold {item['name']} & completed '{m['name']}' in {curr_cell} (+{p}d)",
                cell=curr_cell,
                visual={
                    "kind": "sell",
                    "item": _public_item_visual(item),
                    "price": p,
                    "scarcitySymbol": sym,
                    "missionName": m["name"],
                    "outcomeLabel": f"💰 +{p}d • 📜 {m['name']}",
                },
            )
            return

    # 2. Sell 1 non-mission good on tile (1 Good sold per hour)
    reserved_mission_cats = [
        m.get("category", "")
        for m in bot.get("missions", [])
        if not m.get("completed") and m.get("kind") == "sell" and int(state.get("turn", 1)) <= 7
    ]
    for s in tile_sells:
        matching = []
        for c in sellable_cart:
            if not matches_category(c, s["category"]):
                continue
            if any(matches_category(c, rc) for rc in reserved_mission_cats):
                continue
            p_cand, _ = compute_sell_price(state, bot, c, s["modifier"])
            cost_b = int(c.get("purchasePrice", 0) or 0)
            if int(state.get("turn", 1)) < 7 and p_cand < cost_b:
                continue
            matching.append(c)
        if matching:
            puff = next((inf for inf in bot.get("influence", []) if "Puffery" in str(inf.get("name", ""))), None)
            if puff and not bot.get("turnEffects", {}).get("puffery"):
                _execute_influence_card(state, bot, puff, {})
            item = max(
                matching,
                key=lambda c: compute_sell_price(state, bot, c, s["modifier"])[0] - int(c.get("purchasePrice", 0) or 0),
            )
            spend_am, p, sym = _bot_pick_amethyst_boost(state, bot, item, s["modifier"])
            am_note = ""
            if spend_am > 0:
                bot["favor"]["Aurelius"] = int(bot["favor"].get("Aurelius", 0)) - spend_am
                bot.setdefault("favorHistory", {f: [] for f in FACTIONS}).setdefault("Aurelius", []).append({
                    "delta": -spend_am,
                    "reason": f"Senatorial Privilege sale of {item['name']} in {curr_cell}",
                    "newTotal": bot["favor"]["Aurelius"],
                })
                am_note = f" [spent {spend_am} Amethyst -> {sym}]"
            _remove_cart_item(state, bot, item, reason=f"sold in {curr_cell} for {p}(d)")
            bot["cash"] += p
            bot["transactedThisTurn"] = True
            _inc_player_stat(bot, "itemsSold", 1)
            add_log(state, f"{bot['name']} sold {item['name']} ({p}d @ {sym}){am_note} in {curr_cell}.", "action")
            add_npc_event(
                state,
                bot,
                "sell",
                f"Sold {item['name']} in {curr_cell} (+{p}d)",
                cell=curr_cell,
                visual={
                    "kind": "sell",
                    "item": _public_item_visual(item),
                    "price": p,
                    "scarcitySymbol": sym,
                    "outcomeLabel": f"💰 Sold +{p}d",
                },
            )
            return

    # 3. Opportunist Stadium Gambling (especially with Match Fixing)
    mf = next((inf for inf in bot.get("influence", []) if "Match Fixing" in str(inf.get("name", ""))), None)
    if rev_tile.get("gamble") and bot["cash"] >= 6 and (bot.get("botStrategy") == "opportunist" or mf is not None):
        if mf is not None and not bot.get("turnEffects", {}).get("matchFixing"):
            _execute_influence_card(state, bot, mf, {})
        bet = min(MAX_GAMBLE_WAGER, max(2, bot["cash"] // (3 if bot.get("turnEffects", {}).get("matchFixing") else 5)))
        if bet > 0:
            bot["cash"] -= bet
            dice_cnt = 2 if bot.get("turnEffects", {}).get("matchFixing") else 1
            bot["turnEffects"]["matchFixing"] = False
            rolls = [roll_rome_die() for _ in range(dice_cnt)]
            bot["gambledThisTurn"] = True
            bot["transactedThisTurn"] = True
            g_state = {
                "stage": "gamble_post_roll",
                "playerIndex": bot["index"],
                "cell": curr_cell,
                "bet": bet,
                "gambleRolls": list(rolls),
                "passedIntervenors": [],
                "botInterventions": 0,
                "card": {"name": f"Stadium Gambling ({curr_cell})", "deck": "gamble"},
            }
            g_state["previewText"] = _get_gamble_roll_preview(bot, g_state)
            _apply_gamble_roll_outcome(state, bot, g_state, emit_dice_event=True)
            payout = bet * sum(g_state.get("gambleRolls") or rolls)
            net_g = payout - bet
            add_npc_event(
                state,
                bot,
                "gamble",
                f"Wagered {bet}d at Stadium {curr_cell} (won {payout}d)",
                cell=curr_cell,
                visual={
                    "kind": "gamble",
                    "bet": bet,
                    "payout": payout,
                    "outcomeLabel": f"🎲 +{net_g}d" if net_g >= 0 else f"🎲 {net_g}d",
                },
            )


def _format_mission_text(m: Dict[str, Any]) -> str:
    if m.get("text"):
        return _normalize_relative_scarcity_text(str(m["text"]))
    kind = m.get("kind")
    if kind == "sell":
        cell = normalize_cell_id(m.get("cell", "")) or ""
        cname = NEIGHBORHOOD_NAMES.get(cell, cell)
        mod_str = normalize_scarcity_modifier(str(m.get("modifier", "=")))
        return f"Sell {m.get('category', 'Goods')} at {mod_str} Scarcity in {cell} ({cname})."
    if kind == "delivery":
        p_cell = normalize_cell_id(m.get("pickupCell", "")) or ""
        d_cell = normalize_cell_id(m.get("deliverCell", "")) or ""
        p_name = NEIGHBORHOOD_NAMES.get(p_cell, p_cell)
        d_name = NEIGHBORHOOD_NAMES.get(d_cell, d_cell)
        blocks = m.get("blocks", 1)
        ct = m.get("combatText")
        c_txt = f" • {ct}" if ct else ""
        if m.get("source") == "encounter" and m.get("fencedSell"):
            fenced = "/".join(str(x) for x in m.get("fencedSell", []))
            fenced_part = f" [Fenced Sell: {fenced}]"
        else:
            fenced_part = ""
        return f"Pick up {m.get('item', 'Cargo')} ({m.get('category', '')} • {blocks}■{c_txt}) in {p_cell} ({p_name}), Deliver to {d_cell} ({d_name}).{fenced_part}"
    return _normalize_relative_scarcity_text(str(m.get("description") or "Complete special objective in Rome."))


def sanitize_state_for_player(state: Dict[str, Any], user_id: Optional[int]) -> Dict[str, Any]:
    """Returns a client-ready view of the game state with hidden unrevealed stacks/decks and enriched UI metadata."""
    _normalize_state_encounter_cards(state)
    human_players = [p for p in state["players"] if not p["isBot"]]
    single_human = len(human_players) <= 1

    # Enrich marketBoard with live prices and track scarcity metadata
    market_meta = {}
    market_tracks = {}
    for t_name in TRACK_NAMES:
        cards = state["marketBoard"].get(t_name, [])
        shift = state.get("seasonTrackShifts", {}).get(t_name, 0)
        sc_idx = get_track_scarcity_index(cards, shift)
        market_meta[t_name] = {
            "count": len(cards),
            "scarcityIndex": sc_idx,
            "scarcitySymbol": SCARCITY_SYMBOLS[sc_idx],
            "scarcityLabel": SCARCITY_LABELS[sc_idx],
            "shift": shift,
        }
        enriched_cards = []
        for col_idx, c in enumerate(cards):
            cc = copy.deepcopy(c)
            p_idx = COL_TO_PRICE_INDEX[min(col_idx, 5)]
            cc["currentBuyPrice"] = int(c["buy"][p_idx])
            cc["colIndex"] = col_idx
            cc["colSymbol"] = ["<<", "<", "=", "=", ">", ">>"][min(col_idx, 5)]
            if t_name == "Weapons" and not cc.get("combatText"):
                cc["combatText"] = "No combat bonus (0 CP)"
            if t_name != "Guards" and "sell" in c:
                cc["currentTrackSellPrice"] = int(c["sell"][sc_idx])
            enriched_cards.append(cc)
        market_tracks[t_name] = enriched_cards

    # Enrich romeBoard while hiding unrevealed tile stack contents
    rome_view = {}
    for raw_coord, cell in state["romeBoard"].items():
        coord = normalize_cell_id(raw_coord) or raw_coord
        rev = copy.deepcopy(cell.get("revealed"))
        if rev:
            eff_edges = get_effective_tile_edges(coord, rev)
            rev["edges"] = eff_edges
            for s_entry in (rev.get("sells") or []):
                if "modifier" in s_entry:
                    s_entry["modifier"] = normalize_scarcity_modifier(str(s_entry["modifier"]))
            for b_entry in (rev.get("buys") or []):
                if "modifier" in b_entry:
                    b_entry["modifier"] = normalize_scarcity_modifier(str(b_entry["modifier"]))
            out_dirs = {}
            div_tiber_active = has_climate_modifier(state, "geta_3")
            for d in DIR_DELTAS:
                val = eff_edges.get(d)
                t_cell = get_target_cell(coord, d)
                tiber_blocked = is_tiber_crossing_blocked(coord, t_cell)
                bridge_name = get_tiber_bridge_name(coord, t_cell)
                toll_cost = parse_edge_toll(val)
                bridge_toll_cost = 4 if (div_tiber_active and bridge_name) else 0
                if val is not None or tiber_blocked:
                    out_dirs[d] = {
                        "edge": val,
                        "targetCell": t_cell,
                        "isExit": t_cell is None and val is not None,
                        "tiberBlocked": tiber_blocked,
                        "bridgeName": bridge_name,
                        "tollCost": toll_cost,
                        "bridgeTollCost": bridge_toll_cost,
                        "passable": (val not in ("red", None, "none")) and not tiber_blocked,
                    }
            rev["outgoingDirections"] = out_dirs
        stack_len = len(cell.get("stack", []))
        rome_view[coord] = {
            "coord": coord,
            "name": cell.get("name", NEIGHBORHOOD_NAMES.get(coord, coord)),
            "isGate": coord in GATE_CELLS,
            "isForum": coord in FORUM_CELLS,
            "westBank": coord in WEST_BANK_CELLS,
            "revealed": rev,
            "stackCount": stack_len,
            "unrevealedCount": stack_len,
        }

    # Deterministically sorted & deduplicated sourceable goods (eliminates deck top-order leakage)
    grouped_sourceable: Dict[Tuple[str, str, int], Dict[str, Any]] = {}
    for c in state["decks"].get("market", []):
        key = (str(c.get("track", "")), str(c.get("name", "")), int(c.get("blocks", 1) or 1))
        existing = grouped_sourceable.get(key)
        if existing is None or str(c.get("id", "")) < str(existing.get("id", "")):
            grouped_sourceable[key] = c

    sourceable_goods = []
    for key in sorted(
        grouped_sourceable.keys(),
        key=lambda k: (TRACK_NAMES.index(k[0]) if k[0] in TRACK_NAMES else 99, k[1], k[2]),
    ):
        c = grouped_sourceable[key]
        sourceable_goods.append({
            "id": c["id"],
            "name": c["name"],
            "track": c["track"],
            "category": c["category"],
            "subcategory": c.get("subcategory", c["category"]),
            "blocks": c.get("blocks", 1),
            "guards": c.get("guards", 0),
            "combatText": c.get("combatText") or ("No combat bonus (0 CP)" if c.get("track") == "Weapons" else None),
            "buy": c.get("buy", []),
            "sell": c.get("sell", []),
        })

    _legacy_color_map = {
        "Ruby": "Z3",
        "Cobalt": "Z1",
        "Emerald": "Z7",
        "Gold": "Z5",
        "Amethyst": "Z11",
        "Sapphire": "Z9",
        "Red": "Z6",
        "Purple": "Z8",
    }
    players_view = []
    viewer_player_index = None
    aur_priv_active = has_climate_modifier(state, "aurelius_3") and not state.get("hourEffects", {}).get("priceEdict")
    for p in state["players"]:
        if p.get("color") in _legacy_color_map:
            p["color"] = _legacy_color_map[p["color"]]
        is_owner = (p.get("userId") is not None and p.get("userId") == user_id) or (single_human and not p["isBot"])
        if is_owner and viewer_player_index is None:
            viewer_player_index = p["index"]
        max_b, max_g = get_player_cart_limits(p)
        used_b, used_g = get_player_cart_usage(p)
        p_copy = copy.deepcopy(p)
        if isinstance(p_copy.get("turnEffects"), dict):
            p_copy["turnEffects"].pop("shortcutCard", None)
        p_copy["canReturnShortcut"] = bool(
            is_owner
            and isinstance(p.get("turnEffects"), dict)
            and p["turnEffects"].get("shortcut")
            and isinstance(p["turnEffects"].get("shortcutCard"), dict)
        )
        p_copy["gambledThisTurn"] = bool(p.get("gambledThisTurn", False))
        p_copy["eliminated"] = bool(p.get("eliminated", False))
        p_copy["eliminationReason"] = p.get("eliminationReason")
        p_copy["maxBlocks"] = max_b
        p_copy["maxGuards"] = max_g
        p_copy["usedBlocks"] = used_b
        p_copy["usedGuards"] = used_g
        p_copy["influenceBuyCost"] = get_influence_buy_price(p)
        curr_cell = normalize_cell_id(p.get("position"))
        p_copy["position"] = curr_cell
        avail_amethysts = max(0, int((p.get("favor") or {}).get("Aurelius", 0))) if aur_priv_active else 0

        def _build_amethyst_boosts(itm: Dict[str, Any], mod_val: str, base_pr: int, base_sym: str) -> List[Dict[str, Any]]:
            if avail_amethysts <= 0:
                return []
            cur_idx = SCARCITY_SYMBOLS.index(base_sym) if base_sym in SCARCITY_SYMBOLS else 2
            max_steps = min(avail_amethysts, cur_idx)
            boosts: List[Dict[str, Any]] = []
            for k_am in range(1, max_steps + 1):
                b_pr, b_sym = compute_sell_price(state, p, itm, mod_val, spend_amethysts=k_am)
                if b_pr > base_pr or b_sym != base_sym:
                    boosts.append({
                        "spend": k_am,
                        "price": b_pr,
                        "scarcitySymbol": b_sym,
                    })
            return boosts

        pend_live = state.get("pendingEncounter")
        can_transact_now = (
            state["phase"] == "delivery"
            and state["activePlayerIndex"] == p["index"]
            and not p.get("transactedThisTurn")
            and not p.get("gambledThisTurn")
            and not pend_live
            and not p.get("pendingNpcOffer")
            and not p.get("pendingCartOverflow")
            and not p.get("pendingMarketReward")
        )

        for m_obj in p_copy.get("missions", []):
            _backfill_encounter_mission_metadata(m_obj)
            under_list = m_obj.pop("underInfluence", None)
            if m_obj.get("source") == "soothsayer":
                m_obj["underInfluenceCount"] = (
                    len(under_list)
                    if isinstance(under_list, list)
                    else int(m_obj.get("underInfluenceCount", 0) or 0)
                )
            if "modifier" in m_obj and m_obj["modifier"] is not None:
                m_obj["modifier"] = normalize_scarcity_modifier(str(m_obj["modifier"]))
            m_obj["text"] = _format_mission_text(m_obj)
            if (
                state["phase"] == "delivery"
                and not m_obj.get("completed")
                and m_obj.get("kind") == "delivery"
                and not m_obj.get("pickedUp")
                and curr_cell
                and curr_cell == normalize_cell_id(m_obj.get("pickupCell"))
            ):
                req_b = int(m_obj.get("blocks", 1))
                m_obj["canLoadCargo"] = True
                m_obj["hasCargoSpace"] = (used_b + req_b <= max_b)
            else:
                m_obj["canLoadCargo"] = False
                m_obj["hasCargoSpace"] = False

            if (
                state["phase"] == "delivery"
                and not m_obj.get("completed")
                and m_obj.get("kind") == "delivery"
                and m_obj.get("pickedUp")
                and curr_cell
                and curr_cell == normalize_cell_id(m_obj.get("deliverCell"))
            ):
                m_obj["canDeliverCargo"] = True
            else:
                m_obj["canDeliverCargo"] = False

            # Per-Good completion buttons for Sell Missions when at the target neighborhood
            completable_sells: List[Dict[str, Any]] = []
            if (
                can_transact_now
                and not m_obj.get("completed")
                and m_obj.get("kind") == "sell"
                and curr_cell
                and curr_cell == normalize_cell_id(m_obj.get("cell"))
            ):
                m_cat = m_obj.get("category", "")
                m_mod = m_obj.get("modifier", "=")
                for c_itm in p.get("cart", []):
                    if c_itm.get("isMissionCargo"):
                        continue
                    if matches_category(c_itm, m_cat):
                        pr_m, sym_m = compute_sell_price(state, p, c_itm, m_mod)
                        cost_b_m = c_itm.get("purchasePrice")
                        completable_sells.append({
                            "cardId": c_itm["id"],
                            "cardName": c_itm["name"],
                            "track": c_itm.get("track"),
                            "category": m_cat,
                            "modifier": normalize_scarcity_modifier(str(m_mod)),
                            "price": pr_m,
                            "purchasePrice": cost_b_m,
                            "netProfit": (pr_m - int(cost_b_m)) if cost_b_m is not None else None,
                            "scarcitySymbol": sym_m,
                            "amethystBoostOptions": _build_amethyst_boosts(c_itm, m_mod, pr_m, sym_m),
                        })
            m_obj["completableSells"] = completable_sells

            # Expose Mission completion claim button if icons already meet threshold
            if (
                state["phase"] == "delivery"
                and not m_obj.get("completed")
                and m_obj.get("kind") == "expose"
                and count_exposed_icons(state, m_obj.get("exposeType", "patricii")) >= int(m_obj.get("exposeCount", 4))
            ):
                m_obj["canClaimExpose"] = True
            else:
                m_obj["canClaimExpose"] = False

            # Combat Mission fight button when facing a matching NPC in pre_decision encounter
            can_fight_enc = None
            if (
                isinstance(pend_live, dict)
                and pend_live.get("stage") == "pre_decision"
                and pend_live.get("playerIndex") == p["index"]
                and pend_live.get("interveningPlayerIndex") is None
                and not m_obj.get("completed")
                and (pend_live.get("canInitiateCombat") or pend_live.get("hasCasusBelliCard"))
            ):
                c_enc = pend_live.get("card") or {}
                if _find_combat_mission_for_encounter({"missions": [m_obj]}, c_enc, str(c_enc.get("deck") or "")):
                    can_fight_enc = {
                        "npcName": str(c_enc.get("name") or "Target"),
                        "useCasusBelli": bool(not pend_live.get("canInitiateCombat") and pend_live.get("hasCasusBelliCard")),
                    }
            m_obj["canFightEncounter"] = can_fight_enc

        p_copy["missions"].sort(
            key=lambda x: 0
            if (not x.get("source") or x.get("source") == "starting")
            else (1 if x.get("source") == "encounter" else 2)
        )
        p_copy["missionCount"] = len(p.get("missions", []))
        p_copy["influenceCount"] = len(p.get("influence", []))
        st_live = _ensure_player_stats(p)
        p_copy["missionsCompleted"] = int(st_live.get("missionsCompleted", 0) or 0)
        p_copy["missionsFailed"] = int(st_live.get("missionsFailed", 0) or 0)
        p_copy["netMissions"] = p_copy["missionsCompleted"] - p_copy["missionsFailed"]
        p_copy["plautillaMissionsCompleted"] = int(st_live.get("plautillaMissionsCompleted", 0) or 0)

        # Enrich cart items with live sell options + cost basis if player is on a Rome tile
        rev_tile = (rome_view.get(curr_cell or "") or {}).get("revealed") or {}
        tile_sells = rev_tile.get("sells", [])
        mission_sells = [
            m for m in p.get("missions", [])
            if not m.get("completed") and m.get("kind") == "sell" and normalize_cell_id(m.get("cell")) == curr_cell
        ]

        for item in p_copy["cart"]:
            if not is_owner and item.get("isMissionCargo") and item.get("missionSource") != "encounter":
                item.pop("missionId", None)
                item.pop("missionName", None)
                item.pop("deliverCell", None)
            if item.get("track") == "Weapons" and not item.get("combatText"):
                item["combatText"] = "No combat bonus (0 CP)"
            cost_basis = item.get("purchasePrice")
            sell_opts = []
            can_sell_this = (not item.get("isMissionCargo")) or (
                item.get("missionSource") == "encounter" and bool(item.get("sell"))
            )
            if is_owner and can_sell_this:
                for ms in mission_sells:
                    if matches_category(item, ms["category"]):
                        pr, sym = compute_sell_price(state, p, item, ms["modifier"])
                        sell_opts.append({
                            "category": ms["category"],
                            "modifier": normalize_scarcity_modifier(str(ms["modifier"])),
                            "price": pr,
                            "purchasePrice": cost_basis,
                            "netProfit": (pr - int(cost_basis)) if cost_basis is not None else None,
                            "scarcitySymbol": sym,
                            "isMission": True,
                            "missionName": ms["name"],
                            "isFencedCargo": bool(item.get("isMissionCargo")),
                            "missionSource": item.get("missionSource"),
                            "amethystBoostOptions": _build_amethyst_boosts(item, ms["modifier"], pr, sym),
                        })
                for ts in tile_sells:
                    if matches_category(item, ts["category"]):
                        pr, sym = compute_sell_price(state, p, item, ts["modifier"])
                        sell_opts.append({
                            "category": ts["category"],
                            "modifier": normalize_scarcity_modifier(str(ts["modifier"])),
                            "price": pr,
                            "purchasePrice": cost_basis,
                            "netProfit": (pr - int(cost_basis)) if cost_basis is not None else None,
                            "scarcitySymbol": sym,
                            "isMission": False,
                            "isFencedCargo": bool(item.get("isMissionCargo")),
                            "missionSource": item.get("missionSource"),
                            "amethystBoostOptions": _build_amethyst_boosts(item, ts["category_mod"] if "category_mod" in ts else ts["modifier"], pr, sym),
                        })
            item["availableSells"] = sell_opts

        for g in p_copy["guards"]:
            g["upkeepCost"] = get_guard_upkeep_cost(state, g)

        for si_entry in p_copy.get("scoutedInfo") or []:
            if isinstance(si_entry, dict) and isinstance(si_entry.get("tile"), dict):
                si_coord = normalize_cell_id(si_entry.get("cell") or si_entry["tile"].get("coord")) or "B1"
                si_entry["tile"]["edges"] = get_effective_tile_edges(si_coord, si_entry["tile"])

        p_copy["pendingCartOverflow"] = copy.deepcopy(p.get("pendingCartOverflow") or [])
        enriched_mkt_rewards: List[Dict[str, Any]] = []
        for rwd_raw in p.get("pendingMarketReward") or []:
            rwd_cp = copy.deepcopy(rwd_raw)
            tr_nm = rwd_cp.get("track", "Animals")
            sub_nm = rwd_cp.get("subcategory")
            rwd_cands = []
            for cc in market_tracks.get(tr_nm, []):
                if not sub_nm or matches_category(cc, sub_nm):
                    rwd_cands.append({
                        "cardId": cc.get("id"),
                        "colIndex": cc.get("colIndex", 0),
                        "colSymbol": cc.get("colSymbol", "="),
                        "card": copy.deepcopy(cc),
                    })
            rwd_cp["candidates"] = rwd_cands
            enriched_mkt_rewards.append(rwd_cp)
        p_copy["pendingMarketReward"] = enriched_mkt_rewards
        p_copy["statsSummary"] = _format_player_stats_summary(p)

        if not is_owner and state["phase"] != "finished":
            p_copy["missions"] = []
            p_copy["influence"] = []
            p_copy["scoutedInfo"] = []
            p_copy["pendingTop3Reorder"] = None
            p_copy["pendingNpcOffer"] = None
            p_copy["pendingCartOverflow"] = []
            p_copy["pendingMarketReward"] = []
        players_view.append(p_copy)

    if viewer_player_index is None:
        viewer_player_index = state["activePlayerIndex"]

    # Redact opponent secret information on pendingEncounter and diceEvents
    pend_view = copy.deepcopy(state.get("pendingEncounter"))
    if isinstance(pend_view, dict) and state.get("phase") != "finished":
        if pend_view.get("soothsayerMission") and pend_view.get("playerIndex") != viewer_player_index:
            pend_view["soothsayerMission"] = {"name": "Hidden Soothsayer Prophecy", "redacted": True}
            if pend_view.get("chartType") == "soothsayer" and pend_view.get("previewText"):
                r_c = max(0, min(3, int(pend_view.get("chartRoll", 0))))
                pend_view["previewText"] = f"Rolled {roman_die_str(r_c)} ({r_c}) → {r_c} Influence card(s) sealed beneath mandatory Soothsayer Mission!"

    dice_events_view = copy.deepcopy(state.get("diceEvents", [])[-15:])
    for ev in dice_events_view:
        sec_idx = ev.pop("secretIntervenorIndex", None)
        sec_names = ev.pop("secretCardNames", None)
        sec_actor = ev.pop("secretIntervenorName", None)
        if sec_idx is not None and sec_names:
            base_msg = ev.get("outcomeMessage", "")
            if viewer_player_index == sec_idx:
                priv_msg = f"{base_msg} — You hold {sec_names} and may play an Influence card before confirming!"
            else:
                actor_lbl = sec_actor or "Another merchant"
                priv_msg = f"{base_msg} — Waiting on {actor_lbl} (Influence response window)."
            ev["outcomeMessage"] = priv_msg
            ev["outcomeDetail"] = priv_msg

    faction_deck_counts: Dict[str, Dict[str, int]] = {}
    for f_name in FACTIONS:
        p_cnt = sum(1 for c in state["decks"].get("patricii", []) if c.get("faction") == f_name)
        l_cnt = sum(1 for c in state["decks"].get("legiones", []) if c.get("faction") == f_name)
        n_cnt = sum(1 for c in state["decks"].get("nefarii", []) if c.get("faction") == f_name)
        faction_deck_counts[f_name] = {
            "patricii": p_cnt,
            "legiones": l_cnt,
            "nefarii": n_cnt,
            "total": p_cnt + l_cnt + n_cnt,
        }

    undo_idx, undo_type, undo_lbl = _get_undo_target_info(state)
    human_count = sum(1 for p in state.get("players", []) if not p.get("isBot"))

    final_standings = None
    if state.get("phase") == "finished":
        final_standings = copy.deepcopy(state.get("finalStandings") or _build_final_standings(state))

    pc_raw = copy.deepcopy(state.get("politicalClimate") or {})
    pc_view = {
        "activeIds": list(pc_raw.get("activeIds") or []),
        "activeByFactor": dict(pc_raw.get("activeByFactor") or {}),
        "picks": list(pc_raw.get("picks") or []),
        "draftOrder": list(pc_raw.get("draftOrder") or []),
        "draftStep": int(pc_raw.get("draftStep", 0) or 0),
        "firstDiscarderIndex": pc_raw.get("firstDiscarderIndex"),
        "factors": copy.deepcopy(POLITICAL_CLIMATE_FACTORS),
        "options": copy.deepcopy(POLITICAL_CLIMATE_OPTIONS),
    }

    turn_idx = max(0, min(len(TURN_HOURS) - 1, state["turn"] - 1))
    return {
        "season": state["season"],
        "seasonIndex": state["seasonIndex"],
        "phase": state["phase"],
        "turn": state["turn"],
        "turnHourLabel": TURN_HOURS[turn_idx],
        "firstPlayerIndex": state["firstPlayerIndex"],
        "activePlayerIndex": state["activePlayerIndex"],
        "viewerPlayerIndex": viewer_player_index,
        "setupDiscardOrder": list(state.get("setupDiscardOrder") or []),
        "politicalClimate": pc_view,
        "marketConsecutivePasses": state["marketConsecutivePasses"],
        "marketBoard": market_tracks,
        "marketMeta": market_meta,
        "maxGambleWager": MAX_GAMBLE_WAGER,
        "hourEffects": state.get("hourEffects", {}),
        "romeBoard": rome_view,
        "deckCounts": {k: len(v) for k, v in state["decks"].items()},
        "factionDeckCounts": faction_deck_counts,
        "sourceableGoods": sourceable_goods,
        "players": players_view,
        "pendingEncounter": pend_view,
        "hasActedThisTurn": bool(state.get("hasActedThisTurn", False)),
        "canUndoTurn": undo_idx is not None and state.get("pendingUndoRequest") is None,
        "undoTargetType": undo_type,
        "undoTargetLabel": undo_lbl,
        "humanPlayerCount": human_count,
        "pendingUndoRequest": state.get("pendingUndoRequest"),
        "lastDiceSeq": int(state.get("nextDiceSeq", 0)),
        "diceEvents": dice_events_view,
        "lastNpcEventSeq": int(state.get("nextNpcEventSeq", 0)),
        "npcEvents": copy.deepcopy(state.get("npcEvents", [])[-25:]),
        "lastMissionEventSeq": max(
            (int(e.get("seq", 0)) for e in state.get("missionEvents", [])),
            default=max(0, int(state.get("nextMissionEventSeq", 1)) - 1),
        ),
        "missionEvents": state.get("missionEvents", [])[-15:],
        "logs": state.get("logs", [])[-80:],
        "winner": state.get("winner"),
        "finalStandings": final_standings,
    }


