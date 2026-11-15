import copy
import json
import subprocess
import unittest
from pathlib import Path
from unittest import mock

import src.game_engine as ge


REPO_ROOT = Path(__file__).resolve().parent.parent


def _make_two_human_state():
    cfg = [
        {"userId": 101, "name": "Marcus", "color": "Crimson", "isBot": False},
        {"userId": 102, "name": "Lucius", "color": "Cobalt", "isBot": False},
    ]
    return ge.create_initial_game_state(cfg)


def _complete_setup_discard(state, clear_hands=False):
    for p in state["players"]:
        disc_m = [m["id"] for m in p["missions"][:2]]
        disc_i = [c["id"] for c in p["influence"][:2]]
        ok, msg = ge.handle_player_action(
            state,
            p["userId"],
            {"type": "setup_discard", "discardMissionIds": disc_m, "discardInfluenceIds": disc_i},
        )
        assert ok, msg
        if clear_hands:
            p["influence"] = []


class GameplayUpdatesTestCase(unittest.TestCase):
    def test_catalog_scripts_and_version_bump(self):
        with open(REPO_ROOT / "src/data/decks.json", "r", encoding="utf-8") as f:
            decks = json.load(f)
        inf_by_id = {c["id"]: c for c in decks["influence"]}
        self.assertEqual(inf_by_id["inf_2"]["effectCode"], "patron_caracalla_domna")
        self.assertEqual(inf_by_id["inf_2"]["favorGain"]["extraFavor"], ["-Caracalla", "-Domna"])
        self.assertIn("6(d)", inf_by_id["inf_2"]["effectText"])

        self.assertEqual(inf_by_id["inf_39"]["effectCode"], "patron_geta_aurelius")
        self.assertEqual(inf_by_id["inf_39"]["favorGain"]["extraFavor"], ["-Geta", "-Aurelius"])
        self.assertIn("6(d)", inf_by_id["inf_39"]["effectText"])

        with open(REPO_ROOT / "src/data/market_and_missions.json", "r", encoding="utf-8") as f:
            mm = json.load(f)
        sag_src = next(c for c in mm["market"] if c["id"] == "wpn_1")
        self.assertTrue(sag_src["combat"]["preRollStrike"])
        self.assertTrue(sag_src["combat"]["consumable"])
        self.assertEqual(sag_src["combat"]["dice"], 1)

        with open(REPO_ROOT / "public/data/cards_catalog.json", "r", encoding="utf-8") as f:
            cat = json.load(f)
        cat_inf = {c["id"]: c for c in cat["influence"]}
        cat_mkt = {c["id"]: c for c in cat["market"]}
        self.assertEqual(cat_inf["inf_2"]["favorGain"]["extraFavor"], ["-Caracalla", "-Domna"])
        self.assertEqual(cat_inf["inf_39"]["favorGain"]["extraFavor"], ["-Geta", "-Aurelius"])
        self.assertTrue(cat_mkt["wpn_1"]["combat"]["preRollStrike"])
        self.assertTrue(cat_mkt["wpn_1"]["combat"]["consumable"])
        self.assertEqual(cat_mkt["wpn_1"]["combat"]["dice"], 1)

        app_js = (REPO_ROOT / "public/app.js").read_text(encoding="utf-8")
        index_html = (REPO_ROOT / "public/index.html").read_text(encoding="utf-8")
        styles_css = (REPO_ROOT / "public/styles.css").read_text(encoding="utf-8")
        rulebook_md = (REPO_ROOT / "NightMerchant Rule Book.md").read_text(encoding="utf-8")
        version_json = json.loads((REPO_ROOT / "public/version.json").read_text(encoding="utf-8"))
        self.assertEqual(version_json["version"], "62")
        self.assertIn("cards_catalog.json?v=62", app_js)
        self.assertIn("app.js?v=62", index_html)
        self.assertTrue((REPO_ROOT / "public/assets/icons/rome_211_map_bg_v4.jpg").is_file())
        self.assertTrue((REPO_ROOT / "public/assets/icons/ostia_market_board_bg.jpg").is_file())
        self.assertIn("ostia_market_board_bg.jpg?v=62", styles_css)
        self.assertEqual(styles_css.count("rome_211_map_bg_v4.jpg?v=62"), 2)
        self.assertNotIn("rome_211_map_bg_v3.jpg", styles_css)
        self.assertNotIn("Divided Tiber", app_js)
        self.assertNotIn("Guild Ledger", app_js)
        self.assertNotIn("Divided Tiber", rulebook_md)
        self.assertNotIn("Guild Ledger", rulebook_md)
        self.assertIn("Sagittae", rulebook_md)

    def test_patron_influence_cards_and_legacy_normalization(self):
        state = _make_two_human_state()
        _complete_setup_discard(state, clear_hands=True)
        state["phase"] = "delivery"
        state["activePlayerIndex"] = 0
        p0 = state["players"][0]

        # Inject stale pre-nerf legacy inf_2, inf_39, and legacy wpn_1 Sagittae
        p0["influence"] = [
            {
                "id": "inf_2",
                "name": "Patron",
                "effectCode": "old_patron",
                "effectText": "Receive 10(d)",
                "favorGain": {"extraFavor": ["Caracalla", "Domna"]},
            },
            {
                "id": "inf_39",
                "name": "Patron",
                "effectCode": "old_patron_2",
                "effectText": "Receive 10(d)",
                "favorGain": {"extraFavor": []},
            },
        ]
        p0["cart"] = [
            {
                "id": "wpn_1c",
                "category": "Weapons",
                "item": "Sagittae",
                "name": "Sagittae",
                "combat": {"dice": 1, "flat": 0, "consumable": True},
            }
        ]

        # Calling handle_player_action normalizes legacy cards automatically
        p0["cash"] = 10
        ok, msg = ge.handle_player_action(state, p0["userId"], {"type": "play_influence", "cardId": "inf_2"})
        self.assertTrue(ok, msg)
        self.assertEqual(p0["cash"], 16)
        self.assertEqual(p0["favor"]["Caracalla"], -1)
        self.assertEqual(p0["favor"]["Domna"], -1)
        self.assertTrue(p0["cart"][0]["combat"]["preRollStrike"])

        ok2, msg2 = ge.handle_player_action(state, p0["userId"], {"type": "play_influence", "cardId": "inf_39"})
        self.assertTrue(ok2, msg2)
        self.assertEqual(p0["cash"], 22)
        self.assertEqual(p0["favor"]["Geta"], -1)
        self.assertEqual(p0["favor"]["Aurelius"], -1)

        # Bot evaluation reflects new penalties
        self.assertEqual(ge._patron_penalty_factions({"id": "inf_2", "name": "Patron"}), ["Caracalla", "Domna"])
        self.assertEqual(ge._patron_penalty_factions({"id": "inf_39", "name": "Patron"}), ["Geta", "Aurelius"])

    def test_sagittae_npc_capacity_reduction_and_preserves_pila(self):
        state = _make_two_human_state()
        _complete_setup_discard(state, clear_hands=True)
        state["phase"] = "delivery"
        state["activePlayerIndex"] = 0
        p0 = state["players"][0]
        p0["position"] = "B4"
        p0["turnStep"] = "after_move"
        p0["favor"]["Caracalla"] = -2  # Hostile to Caracalla

        sag = {
            "id": "wpn_1_test",
            "category": "Weapons",
            "item": "Sagittae",
            "name": "Sagittae",
            "space": 1,
            "combat": {"dice": 1, "flat": 0, "consumable": True, "preRollStrike": True},
        }
        pila = {
            "id": "wpn_3_test",
            "category": "Weapons",
            "item": "Pila",
            "name": "Pila",
            "space": 1,
            "combat": {"dice": 2, "flat": 0, "consumable": True, "preRollStrike": False},
        }
        p0["cart"] = [sag, pila]

        npc_card = {
            "id": "leg_test",
            "name": "Praetorian Patrol",
            "deck": "legiones",
            "faction": "Caracalla",
            "combatFormula": "X(R)+X",
            "demand": "Give me 5(d).",
            "demandCash": 5,
            "hostileFavor": ["-Caracalla"],
        }
        state["pendingEncounter"] = {
            "stage": "pre_decision",
            "playerIndex": 0,
            "card": npc_card,
            "deck": "legiones",
            "xCount": 2,
            "encounterSource": "Test Street",
        }

        # Step 1: Refuse/Fight triggers consumable pre-roll prompt (Sagittae + Pila)
        ok, _ = ge.handle_player_action(state, p0["userId"], {"type": "resolve_encounter", "decision": "fight"})
        self.assertTrue(ok)
        self.assertEqual(state["pendingEncounter"]["stage"], "combat_consumable_pre_roll")

        # Step 2: Select ONLY Sagittae, leaving Pila unselected; Sagittae rolls 1 vs X=2
        with mock.patch("src.game_engine.roll_rome_die", return_value=1):
            ok, msg = ge.handle_player_action(
                state,
                p0["userId"],
                {"type": "resolve_encounter", "decision": "confirm_consumables_and_roll", "useConsumableIds": ["wpn_1_test"]},
            )
        self.assertTrue(ok, msg)
        self.assertEqual([it["id"] for it in p0["cart"]], ["wpn_3_test"])
        self.assertEqual(state["diceEvents"][-2]["kind"], "combat_pre_strike")
        self.assertEqual(state["diceEvents"][-1]["kind"], "combat")
        # Enemy X=2 reduced by 1 -> X=1 => 1(R)+1 = 2 CP (with mocked die=1)
        opp_grp = state["diceEvents"][-1]["groups"][1]
        self.assertEqual(len(opp_grp["dice"]), 1)
        self.assertIn("2 CP", opp_grp["totalLabel"])
        # Hostile favor (-Caracalla) was applied ONCE when fight started, NOT twice after pre-strike!
        self.assertEqual(p0["favor"]["Caracalla"], -3)
        # Unselected Pila still untouched on cart
        self.assertEqual([it["id"] for it in p0["cart"]], ["wpn_3_test"])

    def test_sagittae_npc_immediate_win_x_and_printed_dice_and_twist_only(self):
        # Part A: Printed formula 2(R)-1 defeated immediately when Twist Of Fate re-rolls 0 -> 3 (> 2);
        # rival also holds Twist Of Fate so intervention handoff is tested end-to-end.
        state = _make_two_human_state()
        _complete_setup_discard(state, clear_hands=True)
        state["phase"] = "delivery"
        state["activePlayerIndex"] = 0
        p0, p1 = state["players"]
        p0["influence"] = [
            {"id": "inf_tof", "name": "Twist Of Fate", "effectText": "Re-roll 1 die"},
            {"id": "inf_fcp", "name": "Flying Chamber Pot", "effectText": "+1 CP"},
            {"id": "inf_merc", "name": "Mercenary Ambush", "effectText": "+2(R)"},
        ]
        p1["influence"] = [
            {"id": "inf_tof_rival", "name": "Twist Of Fate", "effectText": "Re-roll 1 die"},
        ]
        sag = {
            "id": "wpn_1_a",
            "category": "Weapons",
            "item": "Sagittae",
            "name": "Sagittae",
            "space": 1,
            "combat": {"dice": 1, "flat": 0, "consumable": True, "preRollStrike": True},
        }
        p0["cart"] = [sag]
        npc_card = {
            "id": "nef_test",
            "name": "Brigand Chief",
            "deck": "nefarii",
            "faction": "Plautilla",
            "combatFormula": "2(R)-1",
            "combatReward": "10(d)",
            "combatRewardObj": {"type": "cash", "amount": 10},
        }
        state["pendingEncounter"] = {
            "stage": "pre_decision",
            "playerIndex": 0,
            "card": npc_card,
            "deck": "nefarii",
            "xCount": 1,
        }
        p0["cash"] = 0
        ok, _ = ge.handle_player_action(state, p0["userId"], {"type": "resolve_encounter", "decision": "fight"})
        self.assertTrue(ok)
        with mock.patch("src.game_engine.roll_rome_die", return_value=0):
            ok, _ = ge.handle_player_action(
                state,
                p0["userId"],
                {"type": "resolve_encounter", "decision": "confirm_consumables_and_roll", "useConsumableIds": ["wpn_1_a"]},
            )
        self.assertTrue(ok)
        self.assertEqual(state["pendingEncounter"]["stage"], "combat_pre_strike_post_roll")
        self.assertFalse(state["pendingEncounter"]["preStrikeDefeatsNpc"])
        self.assertEqual(state["pendingEncounter"]["preStrikeCapacity"], 2)

        # Reject non-Twist Of Fate cards during combat_pre_strike_post_roll
        for forbidden_id in ("inf_fcp", "inf_merc"):
            ok_bad, msg_bad = ge.handle_player_action(state, p0["userId"], {"type": "play_influence", "cardId": forbidden_id})
            self.assertFalse(ok_bad)
            self.assertIn("Twist Of Fate", msg_bad)
        self.assertEqual(len(p0["influence"]), 3)

        # Twist Of Fate re-rolls 0 -> 3, exceeding printed capacity 2 -> instant victory!
        with mock.patch("src.game_engine.roll_rome_die", return_value=3):
            ok_tw, msg_tw = ge.handle_player_action(
                state, p0["userId"], {"type": "play_influence", "cardId": "inf_tof", "dieIndex": 0}
            )
        self.assertTrue(ok_tw, msg_tw)
        self.assertTrue(state["pendingEncounter"]["preStrikeDefeatsNpc"])

        dice_len_before = len(state["diceEvents"])
        # Active player finalizes -> hands off to rival intervenor holding Twist Of Fate
        ok_fin1, _ = ge.handle_player_action(state, p0["userId"], {"type": "resolve_encounter", "decision": "finalize_pre_strike"})
        self.assertTrue(ok_fin1)
        self.assertEqual(state["pendingEncounter"]["interveningPlayerIndex"], 1)
        # Rival passes intervention -> instant victory without rolling main combat!
        ok_fin2, _ = ge.handle_player_action(state, p1["userId"], {"type": "resolve_encounter", "decision": "finalize_pre_strike"})
        self.assertTrue(ok_fin2)
        self.assertIsNone(state["pendingEncounter"])
        self.assertEqual(len(state["diceEvents"]), dice_len_before)  # NO main combat dice event emitted!
        self.assertEqual(p0["cash"], 10)  # Combat reward granted immediately!

        # Part B: Printed 2(R) reduced to 0(R) when Sagittae rolls 2 <= 2
        state2 = _make_two_human_state()
        _complete_setup_discard(state2, clear_hands=True)
        state2["phase"] = "delivery"
        state2["activePlayerIndex"] = 0
        q0 = state2["players"][0]
        q0["cart"] = [copy.deepcopy(sag)]
        with mock.patch("src.game_engine.roll_rome_die", side_effect=[2, 1]):
            ge.execute_combat(
                state2,
                q0,
                {"id": "nef2", "name": "Footpad", "deck": "nefarii", "combatFormula": "2(R)"},
                1,
                use_consumable_ids=["wpn_1_a"],
            )
        self.assertEqual(len(state2["diceEvents"][-1]["groups"][1]["dice"]), 0)

    def test_sagittae_decline_consumables_keeps_cart_intact(self):
        state = _make_two_human_state()
        _complete_setup_discard(state, clear_hands=True)
        state["phase"] = "delivery"
        state["activePlayerIndex"] = 0
        p0 = state["players"][0]
        sag = {"id": "wpn_1_d", "category": "Weapons", "item": "Sagittae", "name": "Sagittae", "combat": {"dice": 1, "consumable": True, "preRollStrike": True}}
        pila = {"id": "wpn_3_d", "category": "Weapons", "item": "Pila", "name": "Pila", "combat": {"dice": 2, "consumable": True, "preRollStrike": False}}
        p0["cart"] = [sag, pila]
        state["pendingEncounter"] = {
            "stage": "pre_decision",
            "playerIndex": 0,
            "card": {"id": "p1", "name": "Sentinel", "deck": "legiones", "combatFormula": "1(R)"},
            "deck": "legiones",
            "xCount": 1,
        }
        ge.handle_player_action(state, p0["userId"], {"type": "resolve_encounter", "decision": "fight"})
        with mock.patch("src.game_engine.roll_rome_die", return_value=1):
            ok, _ = ge.handle_player_action(
                state,
                p0["userId"],
                {"type": "resolve_encounter", "decision": "confirm_consumables_and_roll", "useConsumableIds": []},
            )
        self.assertTrue(ok)
        self.assertEqual(len(p0["cart"]), 2)
        self.assertFalse(any(ev["kind"] == "combat_pre_strike" for ev in state["diceEvents"]))

    def test_sagittae_pvp_armor_guard_kill_and_driver_fate(self):
        state = _make_two_human_state()
        _complete_setup_discard(state, clear_hands=True)
        state["phase"] = "delivery"
        state["turn"] = 2
        state["activePlayerIndex"] = 0
        atk = state["players"][0]
        dfn = state["players"][1]
        atk["position"] = "B4"
        dfn["position"] = "B4"
        atk["influence"] = [{"id": "inf_cb", "name": "Casus Belli"}]
        atk["cart"] = [
            {"id": "wpn_1_pvp", "category": "Weapons", "item": "Sagittae", "name": "Sagittae", "combat": {"dice": 1, "consumable": True, "preRollStrike": True}},
            {"id": "wpn_3_pvp", "category": "Weapons", "item": "Pila", "name": "Pila", "combat": {"dice": 2, "consumable": True, "preRollStrike": False}},
        ]
        dfn["cart"] = [
            {"id": "arm_man", "category": "Weapons", "item": "Manicae", "name": "Manicae", "combat": {"ignoreWoundsFlat": 1}},
            {"id": "arm_scu", "category": "Weapons", "item": "Scuta", "name": "Scuta", "combat": {"ignoreWoundsDice": 1}},
        ]
        dfn["guards"] = [{"id": "grd_1", "category": "Guards", "item": "Veteran", "name": "Veteran", "seats": 1, "combat": {"dice": 1}}]

        # Initiate Casus Belli PvP (Attacker prompts consumables)
        ok, msg = ge.handle_player_action(
            state, atk["userId"], {"type": "play_influence", "cardId": "inf_cb", "targetPlayerIndex": 1}
        )
        self.assertTrue(ok, msg)
        self.assertEqual(state["pendingEncounter"]["stage"], "combat_consumable_pre_roll")
        self.assertEqual(state["pendingEncounter"]["consumableRole"], "attacker")

        # Pre-strike: Sagittae=3, Scuta=1 (+ Manicae=1 -> 3-2=1 unblocked Wound -> kills Defender's 1 Guard)
        # Main combat: Atk Driver=1, Pila=1,1 | Def Driver=1, Scuta=1 => 7 rolls total
        with mock.patch("src.game_engine.roll_rome_die", side_effect=[3, 1, 1, 1, 1, 1, 1]):
            ok, msg = ge.handle_player_action(
                state,
                atk["userId"],
                {
                    "type": "resolve_encounter",
                    "decision": "confirm_consumables_and_roll",
                    "useConsumableIds": ["wpn_1_pvp", "wpn_3_pvp"],
                },
            )
        self.assertTrue(ok, msg)
        self.assertEqual(len(dfn["guards"]), 0)  # Guard killed by pre-roll strike!
        self.assertEqual(atk["cart"], [])  # Both Sagittae (pre-strike) & Pila (carried main combat) consumed!
        pre_ev = next(ev for ev in state["diceEvents"] if ev["kind"] == "combat_pre_strike")
        self.assertIn("Sagittae", pre_ev["outcomeMessage"] + pre_ev["title"])

        # Unblocked pre-roll wounds reaching Driver trigger driver_fate_pre_roll BEFORE main PvP roll
        state_drv = _make_two_human_state()
        _complete_setup_discard(state_drv, clear_hands=True)
        state_drv["phase"] = "delivery"
        state_drv["turn"] = 2
        a2, d2 = state_drv["players"]
        a2["cart"] = [
            {"id": "wpn_1_hit", "category": "Weapons", "item": "Sagittae", "name": "Sagittae", "combat": {"dice": 1, "consumable": True, "preRollStrike": True}},
        ]
        d2["guards"] = []
        d2["cart"] = []
        d2["cash"] = 30
        with mock.patch("src.game_engine.roll_rome_die", return_value=2):
            ge._start_or_resume_pvp_combat(state_drv, a2, d2, atk_consumable_ids=["wpn_1_hit"], def_consumable_ids=[])
        self.assertEqual(state_drv["pendingEncounter"]["stage"], "driver_fate_pre_roll")
        self.assertTrue(state_drv["pendingEncounter"]["isPvp"])
        self.assertEqual(state_drv["pendingEncounter"]["pvpWinnerIndex"], 0)
        self.assertEqual(state_drv["pendingEncounter"]["pvpLoserIndex"], 1)
        # Resolve Driver Fate roll = 2 (Beaten and Mugged -> Attacker claims Defender's 30d; auto-finalizes with no intervenors)
        with mock.patch("src.game_engine.roll_rome_die", return_value=2):
            ok_df, _ = ge.handle_player_action(
                state_drv, d2["userId"], {"type": "resolve_encounter", "decision": "roll_driver_fate"}
            )
            self.assertTrue(ok_df)
        self.assertIsNone(state_drv["pendingEncounter"])
        self.assertEqual(d2["cash"], 0)
        self.assertEqual(a2["cash"], 42)  # 12 + 30 spoils

    def test_sagittae_tiebreaker_round_1_only(self):
        state = _make_two_human_state()
        _complete_setup_discard(state, clear_hands=True)
        p0, p1 = state["players"]
        p0["cart"] = [
            {"id": "wpn_1_tb", "category": "Weapons", "item": "Sagittae", "name": "Sagittae", "combat": {"dice": 1, "consumable": True, "preRollStrike": True}},
        ]
        p1["guards"] = [{"id": "g_tb", "category": "Guards", "item": "Guard", "name": "Guard", "seats": 1, "combat": {"dice": 1}}]
        snap = {0: copy.deepcopy(p0["cart"]), 1: []}

        # Round 1: pre-strike rolls 1 (kills p1 guard); main Round 1 draws (1 vs 1); Round 2 has no pre-strike -> 2 vs 0!
        with mock.patch("src.game_engine.roll_rome_die", side_effect=[1, 1, 1, 2, 0]):
            winner = ge._resolve_pvp_combat_tiebreaker(state, p0, p1, snap, "Most Geta Favor")
        self.assertEqual(winner["index"], 0)
        pre_events = [ev for ev in state["diceEvents"] if ev["kind"] == "combat_pre_strike"]
        self.assertEqual(len(pre_events), 1)  # Fired in Round 1 ONLY, NOT Round 2!

    def test_political_climate_opulence_and_no_divided_tiber_toll(self):
        state = _make_two_human_state()
        _complete_setup_discard(state, clear_hands=True)
        self.assertEqual(state["phase"], "setup_climate")
        p0, p1 = state["players"]
        cur = state["players"][state["activePlayerIndex"]]
        ok, msg = ge.handle_player_action(
            state, cur["userId"], {"type": "select_climate_option", "optionId": "geta_3"}
        )
        self.assertTrue(ok, msg)
        self.assertIn("geta_3", state["politicalClimate"]["activeIds"])
        self.assertEqual(p0["favor"]["Geta"], 1)
        self.assertEqual(p1["favor"]["Geta"], 1)

        # Explicitly set Geta to 0 and verify orthogonal Tiber crossing B4 -> C4 (Pons Fabricius) charges 0(d)!
        state["phase"] = "delivery"
        state["activePlayerIndex"] = 0
        p0["favor"]["Geta"] = 0
        p0["cash"] = 20
        p0["position"] = "B4"
        p0["movesRemaining"] = 4
        state["romeBoard"]["B4"]["revealed"] = {"name": "Trans Tiberim", "edges": {"N": "green", "S": "green", "E": "green", "W": "green"}, "center": None}
        state["romeBoard"]["C4"]["revealed"] = {"name": "Mons Capitolinus", "edges": {"N": "green", "S": "green", "E": "green", "W": "green"}, "center": None}
        ok_mv, msg_mv = ge.handle_player_action(state, p0["userId"], {"type": "delivery_move", "direction": "E"})
        self.assertTrue(ok_mv, msg_mv)
        self.assertEqual(p0["position"], "C4")
        self.assertEqual(p0["cash"], 20)  # Zero Divided Tiber bridge toll!

    def test_political_climate_brothers_grudge_most_geta(self):
        state = _make_two_human_state()
        _complete_setup_discard(state, clear_hands=True)
        state["politicalClimate"]["activeIds"] = ["geta_1"]
        state["season"] = "Fall"
        state["seasonIndex"] = 2
        state["phase"] = "cleanup"
        p0, p1 = state["players"]
        p0["cash"] = 50
        p1["cash"] = 50
        p0["missions"] = []
        p1["missions"] = []
        p0["cart"] = []
        p1["cart"] = []
        p0["favor"]["Geta"] = 4  # Most Geta!
        p1["favor"]["Geta"] = 1
        p0["cleanupDone"] = True
        p1["cleanupDone"] = True
        ge._check_all_cleanups_done(state)
        self.assertEqual(state["phase"], "finished")
        self.assertEqual(p0["cash"], 25)  # Lost -25d!
        self.assertEqual(p1["cash"], 50)

        # Tied Most Geta resolved by PvP combat -> ONLY combat loser loses -25d
        state2 = _make_two_human_state()
        _complete_setup_discard(state2, clear_hands=True)
        state2["politicalClimate"]["activeIds"] = ["geta_1"]
        state2["season"] = "Fall"
        state2["seasonIndex"] = 2
        state2["phase"] = "cleanup"
        q0, q1 = state2["players"]
        q0["cash"] = 50
        q1["cash"] = 50
        q0["missions"] = []
        q1["missions"] = []
        q0["cart"] = []
        q1["cart"] = []
        q0["favor"]["Geta"] = 2
        q1["favor"]["Geta"] = 2
        q0["cleanupDone"] = True
        q1["cleanupDone"] = True
        with mock.patch("src.game_engine.roll_rome_die", side_effect=[3, 0]):
            ge._check_all_cleanups_done(state2)
        self.assertEqual({q0["cash"], q1["cash"]}, {25, 50})
        logs_joined = "\n".join(x.get("text", "") for x in state2.get("logs", []))
        self.assertIn("Lost PvP Tie-Break for Most Geta Favor", logs_joined)

    def test_political_climate_loyalty_rewards_and_sanitize(self):
        state = _make_two_human_state()
        _complete_setup_discard(state, clear_hands=True)
        state["politicalClimate"]["activeIds"] = ["missions_2"]
        state["season"] = "Fall"
        state["seasonIndex"] = 2
        state["phase"] = "cleanup"
        p0, p1 = state["players"]
        p0["cash"] = 10
        p1["cash"] = 10
        p0["missions"] = []
        p1["missions"] = []
        p0["cart"] = []
        p1["cart"] = []

        # p0: Caracalla 3 gems * 2 missions = 60d > Geta 4 * 1 = 40d -> expects +60d
        p0["favor"] = {"Caracalla": 3, "Geta": 4, "Domna": -5, "Plautilla": 0, "Aurelius": 0}
        ge._ensure_player_stats(p0)["factionMissionsCompleted"] = {
            "Caracalla": 2,
            "Geta": 1,
            "Domna": 3,  # negative favor ignored (0)
            "Plautilla": 0,
            "Aurelius": 0,
        }
        # p1: has missions with Aurelius but 0 Aurelius favor -> 0d
        p1["favor"] = {"Caracalla": -2, "Geta": 0, "Domna": 0, "Plautilla": 5, "Aurelius": 0}
        ge._ensure_player_stats(p1)["factionMissionsCompleted"] = {
            "Caracalla": 2,
            "Geta": 0,
            "Domna": 0,
            "Plautilla": 0,
            "Aurelius": 2,
        }

        san = ge.sanitize_state_for_player(state, p0["userId"])
        self.assertEqual(san["players"][0]["stats"]["factionMissionsCompleted"]["Caracalla"], 2)

        p0["cleanupDone"] = True
        p1["cleanupDone"] = True
        ge._check_all_cleanups_done(state)
        self.assertEqual(p0["cash"], 70)  # 10 + 60
        self.assertEqual(p1["cash"], 10)  # 10 + 0

    def test_first_player_token_passes_only_once_per_season_in_cleanup(self):
        cfg = [
            {"userId": 101, "name": "Marcus", "color": "Crimson", "isBot": False},
            {"userId": 102, "name": "Lucius", "color": "Cobalt", "isBot": False},
            {"userId": 103, "name": "Quintus", "color": "Emerald", "isBot": False},
        ]
        state = ge.create_initial_game_state(cfg)
        _complete_setup_discard(state, clear_hands=True)
        self.assertEqual(state["phase"], "setup_climate")

        # Complete Political Climate draft in 3P: p0 discarded first -> firstPlayerIndex becomes 1
        for opt_id in ("caracalla_3", "geta_3", "domna_3"):
            cur = state["players"][state["activePlayerIndex"]]
            ok, msg = ge.handle_player_action(state, cur["userId"], {"type": "select_climate_option", "optionId": opt_id})
            self.assertTrue(ok, msg)

        self.assertEqual(state["phase"], "market")
        self.assertEqual(state["season"], "Spring")
        self.assertEqual(state["firstPlayerIndex"], 1)
        self.assertEqual(state["activePlayerIndex"], 1)

        # End Market Phase (all 3 players pass in turn order): First Player Token MUST stay 1
        for expected_idx in (1, 2, 0):
            self.assertEqual(state["activePlayerIndex"], expected_idx)
            p = state["players"][expected_idx]
            ok, msg = ge.handle_player_action(state, p["userId"], {"type": "market_pass"})
            self.assertTrue(ok, msg)

        self.assertEqual(state["phase"], "delivery_entry")
        self.assertEqual(state["firstPlayerIndex"], 1)
        self.assertEqual(state["activePlayerIndex"], 1)

        # Make B1 peaceful so Gate entry causes no encounter modal while testing turn progression
        state["romeBoard"]["B1"]["revealed"] = {
            "name": "Via Flaminia",
            "edges": {"N": "green", "S": "green", "E": "green", "W": "green"},
            "center": None,
            "encounter": None,
            "persistent": True,
        }
        for expected_idx in (1, 2, 0):
            self.assertEqual(state["activePlayerIndex"], expected_idx)
            p = state["players"][expected_idx]
            ok, msg = ge.handle_player_action(state, p["userId"], {"type": "select_gate", "gate": "B1"})
            self.assertTrue(ok, msg)

        self.assertEqual(state["phase"], "delivery")
        self.assertEqual(state["turn"], 1)
        self.assertEqual(state["firstPlayerIndex"], 1)
        self.assertEqual(state["activePlayerIndex"], 1)

        # Advance hourly from Turn 1 -> Turn 2 -> Turn 3: First Player Token MUST stay 1 each hour
        for expected_turn in (1, 2):
            self.assertEqual(state["turn"], expected_turn)
            for expected_idx in (1, 2, 0):
                self.assertEqual(state["activePlayerIndex"], expected_idx)
                p = state["players"][expected_idx]
                ok, msg = ge.handle_player_action(state, p["userId"], {"type": "delivery_end_turn"})
                self.assertTrue(ok, msg)
            self.assertEqual(state["turn"], expected_turn + 1)
            self.assertEqual(state["firstPlayerIndex"], 1)
            self.assertEqual(state["activePlayerIndex"], 1)

        # Enter Clean-Up (token stays 1 during Clean-Up), then finish all cleanups -> rotates ONCE (1 -> 2)
        ge.begin_cleanup_phase(state)
        self.assertEqual(state["phase"], "cleanup")
        self.assertEqual(state["firstPlayerIndex"], 1)
        self.assertEqual(state["activePlayerIndex"], 1)
        for p in state["players"]:
            ok, msg = ge.handle_player_action(state, p["userId"], {"type": "cleanup_finish", "keepGuardIds": []})
            self.assertTrue(ok, msg)

        self.assertEqual(state["season"], "Summer")
        self.assertEqual(state["phase"], "market")
        self.assertEqual(state["firstPlayerIndex"], 2)
        self.assertEqual(state["activePlayerIndex"], 2)

        # Complete Summer Clean-Up -> rotates ONCE clockwise to Fall (2 -> 0)
        ge.begin_cleanup_phase(state)
        self.assertEqual(state["firstPlayerIndex"], 2)
        for p in state["players"]:
            ok, msg = ge.handle_player_action(state, p["userId"], {"type": "cleanup_finish", "keepGuardIds": []})
            self.assertTrue(ok, msg)

        self.assertEqual(state["season"], "Fall")
        self.assertEqual(state["phase"], "market")
        self.assertEqual(state["firstPlayerIndex"], 0)
        self.assertEqual(state["activePlayerIndex"], 0)

        # Verify Rule Book markdown reflects once-per-season token passing
        rulebook_md = (REPO_ROOT / "NightMerchant Rule Book.md").read_text(encoding="utf-8")
        self.assertNotIn("When the Market Phase ends, pass the First Player Token clockwise", rulebook_md)
        self.assertNotIn("advance the Clock one hour and pass the First Player Token clockwise", rulebook_md)
        self.assertIn("Pass the First Player Token clockwise (once per season)", rulebook_md)

    def test_tutorial_preference_rulebook_and_encounter_icons(self):
        import sys
        import tempfile
        src_dir = str(REPO_ROOT / "src")
        if src_dir not in sys.path:
            sys.path.insert(0, src_dir)
        import db as nm_db

        self.assertTrue(nm_db.DEFAULT_USER_SETTINGS.get("tutorialEnabled"))
        fb_src = (REPO_ROOT / "src/firebase_db.py").read_text(encoding="utf-8")
        self.assertIn('"tutorialEnabled"', fb_src)

        with tempfile.TemporaryDirectory() as tmpdir:
            temp_db = str(Path(tmpdir) / "test_nm.sqlite3")
            with mock.patch.object(nm_db, "DB_PATH", temp_db):
                nm_db.init_db()
                user, err = nm_db.create_user("tuttester", "Tut Tester", "Pass1234!", "Z1", "tut@roma.local")
                self.assertIsNone(err)
                self.assertIsNotNone(user)
                self.assertTrue(user["settings"]["tutorialEnabled"])
                updated, upd_err = nm_db.update_user_profile(
                    user["id"],
                    settings={**user["settings"], "tutorialEnabled": False},
                )
                self.assertIsNone(upd_err)
                self.assertFalse(updated["settings"]["tutorialEnabled"])
                reloaded = nm_db.get_user_by_id(user["id"])
                self.assertFalse(reloaded["settings"]["tutorialEnabled"])

        enc_dir = REPO_ROOT / "public/assets/icons/encounters"
        expected_icons = [
            "mob_center.png",
            "mob_edge.png",
            "mob_corner_edge.png",
            "mob_top_corner_edge.png",
            "theater_center.png",
            "theater_edge.png",
            "theater_corner_edge.png",
            "theater_top_corner_edge.png",
            "soothsayer_center.png",
            "soothsayer_edge.png",
            "patricii_center.png",
            "patricii_edge.png",
        ]
        self.assertTrue((REPO_ROOT / "public/assets/icons/dice.png").is_file())
        for faction in ("nefarii", "legiones"):
            for count in (1, 2, 3, 4):
                for loc in ("center", "flat_edge", "corner_edge"):
                    expected_icons.append(f"{faction}_{count}_{loc}.png")

        for filename in expected_icons:
            fpath = enc_dir / filename
            self.assertTrue(fpath.is_file(), f"Missing encounter artwork {fpath}")
            raw = fpath.read_bytes()
            self.assertGreater(len(raw), 1000, f"Encounter icon too small: {filename}")
            self.assertEqual(raw[:8], b"\x89PNG\r\n\x1a\n", f"Not a valid PNG: {filename}")

        rulebook_md = (REPO_ROOT / "NightMerchant Rule Book.md").read_text(encoding="utf-8")
        self.assertIn("skip the Political Climate track", rulebook_md)

    def test_theater_troupe_friendly_hostile_collections_and_patron(self):
        state = _make_two_human_state()
        _complete_setup_discard(state, clear_hands=True)
        state["phase"] = "delivery"
        state["activePlayerIndex"] = 0
        p0 = state["players"][0]

        # Build both Friendly and Hostile Favor Collections:
        # 1) Mission completion adds +2 Geta to Friendly Collection
        ge.apply_favor_list(p0, ["+Geta", "+Geta"], reason="Completed Mission 'Grain' (Friend: Geta)", collection="friendly")
        # 2) Combat / refused demand (Hostile consequence) gives +1 Caracalla, -1 Domna into Hostile Collection
        ge.apply_favor_list(p0, ["+Caracalla", "-Domna"], reason="Defeated Caracalla patrol (Hostile)", collection="hostile")
        # 3) Play Influence card 'Patron' (-Caracalla, -Domna -> Friendly Favor Collection outcome!)
        p0["influence"] = [{"id": "inf_2", "name": "Patron", "effectCode": "patron_caracalla_domna", "favorGain": {"cash": 6, "extraFavor": ["-Caracalla", "-Domna"]}}]
        ok, msg = ge.handle_player_action(state, p0["userId"], {"type": "play_influence", "cardId": "inf_2"})
        self.assertTrue(ok, msg)

        # Net favor before Theater Troupe:
        # Geta = +2 (friendly)
        # Caracalla = +1 (hostile) - 1 (friendly Patron) = 0
        # Domna = -1 (hostile) - 1 (friendly Patron) = -2
        self.assertEqual(p0["favor"]["Geta"], 2)
        self.assertEqual(p0["favor"]["Caracalla"], 0)
        self.assertEqual(p0["favor"]["Domna"], -2)
        self.assertEqual(p0["favorCollections"]["friendly"]["Geta"], 2)
        self.assertEqual(p0["favorCollections"]["friendly"]["Caracalla"], -1)
        self.assertEqual(p0["favorCollections"]["hostile"]["Caracalla"], 1)

        # Roll 0 on Theater Troupe -> Clears ONLY Friendly Collection!
        # Negates +2 Geta AND negates Patron's -1 Caracalla / -1 Domna, leaving Hostile +1 Caracalla & -1 Domna intact!
        ge._apply_table_encounter_outcome(state, p0, "theater", 0, emit_dice_event=True)
        self.assertEqual(p0["favor"]["Geta"], 0)
        self.assertEqual(p0["favor"]["Caracalla"], 1)
        self.assertEqual(p0["favor"]["Domna"], -1)
        self.assertEqual(p0["favorCollections"]["friendly"]["Geta"], 0)
        self.assertEqual(p0["favorCollections"]["friendly"]["Caracalla"], 0)
        self.assertEqual(p0["favorCollections"]["hostile"]["Caracalla"], 1)

        # Roll I on Theater Troupe -> Clears ONLY Hostile Collection!
        ge._apply_table_encounter_outcome(state, p0, "theater", 1, emit_dice_event=True)
        self.assertEqual(p0["favor"]["Geta"], 0)
        self.assertEqual(p0["favor"]["Caracalla"], 0)
        self.assertEqual(p0["favor"]["Domna"], 0)
        self.assertEqual(p0["favorCollections"]["hostile"]["Caracalla"], 0)
        self.assertEqual(p0["favorCollections"]["hostile"]["Domna"], 0)

    def test_match_fixing_restricted_to_gamble_flow(self):
        state = _make_two_human_state()
        _complete_setup_discard(state, clear_hands=True)
        state["phase"] = "delivery"
        state["activePlayerIndex"] = 0
        p0 = state["players"][0]
        p0["position"] = "B1"
        p0["cash"] = 20
        p0["influence"] = [{"id": "inf_mf", "name": "Match Fixing", "effectCode": "match_fixing"}]

        # Reveal B1 as non-gamble tile -> playing Match Fixing must fail
        state["romeBoard"]["B1"]["revealed"] = {
            "id": "tile_plain",
            "name": "Market Stalls",
            "gamble": False,
            "edges": {"N": "green", "S": "green", "E": "green", "W": "green"},
        }
        ok, err = ge.handle_player_action(state, p0["userId"], {"type": "play_influence", "cardId": "inf_mf"})
        self.assertFalse(ok)
        self.assertIn("Stadium Gambling", err)
        self.assertEqual(len(p0["influence"]), 1)

        # Even on a Gambling tile, omitting fromGamble must fail (cannot pre-arm outside Gamble UI)
        state["romeBoard"]["B1"]["revealed"]["gamble"] = True
        ok2, err2 = ge.handle_player_action(state, p0["userId"], {"type": "play_influence", "cardId": "inf_mf"})
        self.assertFalse(ok2)
        self.assertIn("Stadium Gambling", err2)
        self.assertEqual(len(p0["influence"]), 1)

        # From inside Stadium Gambling modal (fromGamble=True) on a Gamble tile -> succeeds
        ok3, msg3 = ge.handle_player_action(
            state, p0["userId"], {"type": "play_influence", "cardId": "inf_mf", "fromGamble": True}
        )
        self.assertTrue(ok3, msg3)
        self.assertTrue(p0["turnEffects"]["matchFixing"])
        self.assertEqual(len(p0["influence"]), 0)

    def test_if_carrying_contraband_threats_and_no_contraband_passthrough(self):
        enc_by_id = ge._get_static_card_maps()["enc_by_id"]
        leg6 = enc_by_id["leg_6"]
        leg10 = enc_by_id["leg_10"]
        nef29 = enc_by_id["nef_29"]
        self.assertEqual(leg6["reactions"][1]["condition"], "-1..0")
        self.assertEqual(leg6["reactions"][1]["ifCarrying"], "Weapons or Fine Wine")
        self.assertEqual(leg6["reactions"][1]["type"], "combat")
        self.assertEqual(leg10["reactions"][1]["ifCarrying"], "Guards or Weapons")
        self.assertEqual(nef29["reactions"][1]["ifCarrying"], "Exotic Animals")

        state = _make_two_human_state()
        _complete_setup_discard(state, clear_hands=True)
        state["phase"] = "delivery"
        state["activePlayerIndex"] = 0
        p0 = state["players"][0]
        p0["position"] = "B1"

        # 1) _player_carrying_contraband helper checks non-mission goods & guards accurately
        p0["cart"] = [{"id": "g1", "name": "Grain", "category": "Grain"}]
        p0["guards"] = []
        self.assertFalse(ge._player_carrying_contraband(p0, "Weapons or Fine Wine"))

        p0["cart"] = [{"id": "m1", "name": "Contraband Gladii", "category": "Weapons", "isMissionCargo": True}]
        self.assertFalse(ge._player_carrying_contraband(p0, "Weapons or Fine Wine"))

        p0["cart"] = [{"id": "w1", "name": "Gladii", "category": "Weapons"}]
        self.assertTrue(ge._player_carrying_contraband(p0, "Weapons or Fine Wine"))
        self.assertTrue(ge._player_carrying_contraband(p0, "Guards or Weapons"))

        p0["cart"] = []
        p0["guards"] = [{"id": "gd1", "name": "Veteran Guard"}]
        self.assertTrue(ge._player_carrying_contraband(p0, "Guards or Weapons"))
        self.assertFalse(ge._player_carrying_contraband(p0, "Weapons"))

        # 2) At Favor 0 with Fine Wine on cart -> leg_6 (-1..0 ifCarrying Weapons or Fine Wine) triggers Combat!
        p0["guards"] = []
        p0["cart"] = [{"id": "fw1", "name": "Falernian Wine", "category": "Fine Wine"}]
        pend_combat = ge._build_pending_encounter_state(state, p0, leg6, "legiones", 1)
        self.assertEqual(pend_combat["reaction"], "combat")
        self.assertTrue(pend_combat["combatMandatory"])
        self.assertEqual(pend_combat["matchedTierIndex"], 1)

        # 3) At Favor 0 with only Grain -> leg_6 downgrades to peaceful no_contraband inspection!
        p0["cart"] = [{"id": "g1", "name": "Grain", "category": "Grain"}]
        pend_clean = ge._build_pending_encounter_state(state, p0, leg6, "legiones", 1)
        self.assertEqual(pend_clean["reaction"], "no_contraband")
        self.assertFalse(pend_clean["combatMandatory"])
        self.assertFalse(pend_clean["canInitiateCombat"])
        self.assertEqual(pend_clean["matchedTierIndex"], 1)
        self.assertIn("Inspecting cart for Weapons or Fine Wine", pend_clean["card"]["actionText"])

        state["pendingEncounter"] = pend_clean
        state["logs"] = []
        ok, msg = ge.handle_player_action(state, p0["userId"], {"type": "resolve_encounter", "decision": "fulfill"})
        self.assertTrue(ok, msg)
        self.assertIsNone(state.get("pendingEncounter"))
        self.assertEqual(p0["favor"][leg6["faction"]], 0)
        self.assertTrue(any("none found, waved through." in entry.get("text", "") for entry in state["logs"]))

        # 4) AI bot auto-resolution passes no_contraband inspection peacefully
        p1 = state["players"][1]
        p1["isBot"] = True
        p1["cart"] = [{"id": "g2", "name": "Grain", "category": "Grain"}]
        p1["influence"] = []
        pend_bot = ge._build_pending_encounter_state(state, p1, nef29, "nefarii", 1)
        self.assertEqual(pend_bot["reaction"], "no_contraband")
        state["pendingEncounter"] = pend_bot
        state["logs"] = []
        acted = ge._execute_single_bot_encounter_step(state)
        self.assertTrue(acted)
        self.assertIsNone(state.get("pendingEncounter"))
        self.assertEqual(p1["favor"][nef29["faction"]], 0)
        self.assertTrue(any("none found, waved through." in entry.get("text", "") for entry in state["logs"]))

    def test_rebalance_mission_influence_and_favor_updates(self):
        with open(REPO_ROOT / "src/data/decks.json", "r", encoding="utf-8") as f:
            decks = json.load(f)
        with open(REPO_ROOT / "src/data/market_and_missions.json", "r", encoding="utf-8") as f:
            mm = json.load(f)
        missions = mm["missiones"]
        influence = decks["influence"]

        self.assertFalse(any(m.get("kind") == "expose" for m in missions))
        self.assertEqual(len(missions), 52)
        cb_cards = [c for c in influence if "Casus Belli" in c.get("name", "")]
        self.assertEqual(len(cb_cards), 2)
        self.assertFalse(any(c.get("id") == "inf_60" for c in influence))

        inf_by_id = {c["id"]: c for c in influence}
        self.assertEqual(inf_by_id["inf_2"]["favorGain"]["cash"], 6)
        self.assertEqual(inf_by_id["inf_39"]["favorGain"]["cash"], 6)
        for fid in ("inf_16", "inf_18", "inf_52"):
            self.assertEqual(inf_by_id[fid]["favorGain"]["cash"], 4)
            self.assertIn("4(d)", inf_by_id[fid]["effectText"])

        mis_by_id = {m["id"]: m for m in missions}
        self.assertEqual(mis_by_id["mis_3"]["reward"]["amount"], 10)
        self.assertEqual(mis_by_id["mis_18"]["reward"]["amount"], 12)
        self.assertEqual(mis_by_id["mis_28"]["reward"]["amount"], 10)
        self.assertEqual(mis_by_id["mis_10"]["modifier"], "=")
        self.assertEqual(mis_by_id["mis_10"]["reward"]["amount"], 8)
        self.assertIn("= Scarcity", mis_by_id["mis_10"]["text"])
        self.assertEqual(mis_by_id["mis_54"]["modifier"], "=")
        self.assertEqual(mis_by_id["mis_54"]["reward"]["amount"], 12)
        self.assertIn("= Scarcity", mis_by_id["mis_54"]["text"])
        self.assertIn("mis_34", mis_by_id)
        self.assertIn("mis_51", mis_by_id)

        eq_sell_missions = [m for m in missions if m.get("kind") == "sell" and m.get("modifier") == "="]
        self.assertGreaterEqual(len(eq_sell_missions), 6)

    def test_bot_influence_ai_supplicant_procurer_make_haste_informants(self):
        state = _make_two_human_state()
        _complete_setup_discard(state, clear_hands=True)
        state["phase"] = "delivery"
        state["turn"] = 5
        bot = state["players"][1]
        bot["isBot"] = True
        bot["botDifficulty"] = "ionic"
        bot["position"] = "C3"
        bot["cash"] = 18
        bot["movesRemaining"] = 1
        bot["cart"] = []

        # Ensure Grain is in decks["market"] and give a distant mission target for Make Haste
        if not any(c.get("category") == "Grain" for c in state["decks"]["market"]):
            state["decks"]["market"].insert(0, {
                "id": "grn_test",
                "name": "Grain",
                "category": "Grain",
                "subcategory": "Grain",
                "track": "Grain",
                "blocks": 1,
                "buy": [5, 4, 3, 2, 1],
                "sell": [9, 7, 5, 3, 2],
            })
        bot["missions"] = [
            {"id": "m_sell", "kind": "sell", "category": "Grain", "cell": "F6", "modifier": "=", "completed": False},
            {"id": "m_del", "kind": "delivery", "pickupCell": "F6", "deliverCell": "A1", "blocks": 1, "pickedUp": False, "completed": False},
        ]
        bot["influence"] = [
            {"id": "inf_proc", "name": "Procurer", "effectCode": "buy_deck_good"},
            {"id": "inf_mh", "name": "Make Haste", "effectCode": "move_twice"},
            {"id": "inf_info", "name": "Informants", "effectCode": "reorder_top_3_any"},
        ]
        ge._bot_try_proactive_self_influence(state, bot)
        self.assertEqual(len(bot["cart"]), 1, "Bot should procure a good with Procurer")
        self.assertEqual(bot["movesRemaining"], 2, "Bot should gain +1 move from Make Haste")
        self.assertTrue(bot["turnEffects"].get("makeHasteExtraTransact"))
        self.assertIsNone(bot.get("pendingTop3Reorder"), "Bot should finish Informants reorder immediately")
        self.assertEqual(len(bot["influence"]), 0, "Bot should have played Procurer, Make Haste, and Informants")

        # 2) Supplicant during unfavorable combat/demand check
        demand_card = {
            "id": "pat_sup_test",
            "name": "Senator",
            "deck": "Patricii",
            "type": "character",
            "faction": "Domna",
            "combatFormula": "2(R)+2",
            "friendlyFavor": ["Domna"],
            "friendlyReward": "8(d)",
            "hostileFavor": ["-Domna"],
            "combatReward": "8(d)",
            "actionText": "Give 6(d).",
            "reactions": [
                {"condition": "<=0", "type": "combat"},
                {"condition": ">=1", "type": "demand"},
                {"condition": ">=2", "type": "payoff"},
            ],
        }
        bot["favor"]["Domna"] = 0  # <=0 = combat (rank 0), +2 Supplicant -> 2 = payoff (rank 6)!
        bot["influence"] = [{"id": "inf_sup", "name": "Supplicant", "effectCode": "temp_favor_plus_2"}]
        pend = ge._build_pending_encounter_state(state, bot, demand_card, "patricii", 1)
        self.assertEqual(pend["reaction"], "combat")
        state["pendingEncounter"] = pend
        acted = ge._execute_single_bot_encounter_step(state)
        self.assertTrue(acted)
        self.assertEqual(len(bot["influence"]), 0, "Bot should play Supplicant when +2 shifts reaction upward")

    def test_surprise_shipment_removed_and_40_influence_cards(self):
        decks_path = REPO_ROOT / "src/data/decks.json"
        catalog_path = REPO_ROOT / "public/data/cards_catalog.json"
        with open(decks_path, "r", encoding="utf-8") as f:
            decks = json.load(f)
        with open(catalog_path, "r", encoding="utf-8") as f:
            catalog = json.load(f)
        self.assertEqual(len(decks["influence"]), 40)
        self.assertFalse(any(c.get("id") == "inf_35" or c.get("name") == "Surprise Shipment" for c in decks["influence"]))
        self.assertEqual(len(catalog["influence"]), 40)
        self.assertFalse(any(c.get("id") == "inf_35" or c.get("name") == "Surprise Shipment" for c in catalog["influence"]))

    def test_reactive_vs_anytime_influence_enforcement(self):
        state = _make_two_human_state()
        _complete_setup_discard(state, clear_hands=True)
        p0, p1 = state["players"][0], state["players"][1]
        p0["cash"] = 30
        p1["cash"] = 30
        state["phase"] = "market"
        state["activePlayerIndex"] = 0

        # Reactive cards rejected outside their triggering situations
        reactive_cards = [
            {"id": "r_amb", "name": "Mercenary Ambush", "effectCode": "combat_plus_2r_pre"},
            {"id": "r_dis", "name": "Distraction", "effectCode": "combat_minus_1r_pre"},
            {"id": "r_glad", "name": "Gladiator's Intervention", "effectCode": "combat_plus_1r_post"},
            {"id": "r_pot", "name": "Flying Chamber Pot", "effectCode": "combat_plus_1_post"},
            {"id": "r_sup", "name": "Supplicant", "effectCode": "temp_favor_plus_2"},
            {"id": "r_mob", "name": "Man Of The People", "effectCode": "ignore_mob"},
            {"id": "r_the", "name": "Dramaturge", "effectCode": "ignore_theater"},
            {"id": "r_haste", "name": "Make Haste", "effectCode": "move_twice"},
            {"id": "r_puff", "name": "Puffery", "effectCode": "increase_own_sale_scarcity"},
        ]
        p0["influence"] = list(reactive_cards)
        for rc in reactive_cards:
            ok, _msg = ge.handle_player_action(state, p0["userId"], {"type": "play_influence", "cardId": rc["id"], "targetSide": "player"})
            self.assertFalse(ok, f"Reactive card {rc['name']} should be rejected when situation is absent")

        # Anytime cards remain playable even off-turn (p1 acting during p0's Market turn)
        with open(REPO_ROOT / "src/data/decks.json", "r", encoding="utf-8") as f:
            inf_by_id = {c["id"]: c for c in json.load(f)["influence"]}
        p1["influence"] = [
            dict(inf_by_id["inf_2"], id="any_pat"),   # Patron: +6(d), -1 Caracalla, -1 Domna
            dict(inf_by_id["inf_53"], id="any_fav"),  # Caracalla Favor: +5(d), +1 Caracalla, -1 Geta, -1 Plautilla
            {"id": "any_cw", "name": "Cartwright", "effectCode": "permanent_storage_plus_2"},
            {"id": "any_wf", "name": "Wine Forger", "effectCode": "wine_forger"},
            {"id": "any_thug", "name": "Thug", "effectCode": "free_guard_1r"},
        ]
        before_cash = p1["cash"]
        before_caracalla = p1["favor"]["Caracalla"]
        for ac in list(p1["influence"]):
            ok, msg = ge.handle_player_action(state, p1["userId"], {"type": "play_influence", "cardId": ac["id"]})
            self.assertTrue(ok, f"Anytime card {ac['name']} should be playable off-turn: {msg}")
        self.assertEqual(p1["favor"]["Caracalla"], before_caracalla)
        self.assertEqual(p1["favor"]["Domna"], -1)
        self.assertEqual(p1["favor"]["Geta"], -1)
        self.assertEqual(p1["favor"]["Plautilla"], -1)
        self.assertGreaterEqual(p1["cash"], before_cash + 11)
        self.assertEqual(p1["bonusBlocks"], 2)

        # Man Of The People succeeds during Mob chart_pre_roll; Gladiator succeeds during combat_post_roll
        state["phase"] = "delivery"
        p0["position"] = "C3"
        mob_cash_before = p0["cash"]
        state["pendingEncounter"] = {
            "playerIndex": 0,
            "stage": "chart_pre_roll",
            "chartType": "mob",
            "card": {"id": "mob_c", "name": "Angry Mob"},
        }
        ok, _ = ge.handle_player_action(state, p0["userId"], {"type": "play_influence", "cardId": "r_mob"})
        self.assertTrue(ok, "Man Of The People should succeed during Angry Mob chart_pre_roll")
        self.assertIsNone(state["pendingEncounter"])
        self.assertEqual(p0["cash"], mob_cash_before + 4)

        state["pendingEncounter"] = {
            "playerIndex": 0,
            "stage": "combat_post_roll",
            "card": {"id": "leg_c", "name": "Centurion"},
            "playerCP": 4,
            "oppCP": 4,
            "playerDiceObjs": [{"label": "Base", "value": 1, "raw": 1, "roman": "I", "sign": 1, "color": "Z1"}],
            "oppDiceObjs": [{"label": "Opp", "value": 1, "raw": 1, "roman": "I", "sign": 1, "color": "Black"}],
            "playerFlat": 0,
            "oppFlat": 0,
            "playerFlatMods": [],
            "oppFlatMods": [],
        }
        ok, _ = ge.handle_player_action(state, p0["userId"], {"type": "play_influence", "cardId": "r_pot", "targetSide": "player"})
        self.assertTrue(ok, "Flying Chamber Pot should succeed during combat_post_roll")

        # Casus Belli rejected when combat is already available in pre_decision
        p0["influence"].append({"id": "r_cb", "name": "Casus Belli", "effectCode": "casus_belli"})
        state["pendingEncounter"] = {
            "playerIndex": 0,
            "stage": "pre_decision",
            "canInitiateCombat": True,
            "combatMandatory": False,
            "isPvp": False,
            "card": {"id": "nef_c", "name": "Cutthroat"},
        }
        ok, _ = ge.handle_player_action(state, p0["userId"], {"type": "play_influence", "cardId": "r_cb"})
        self.assertFalse(ok, "Casus Belli should be rejected when combat is already available")

    def test_goods_deck_counts_and_six_deck_scout_and_informants(self):
        state = _make_two_human_state()
        _complete_setup_discard(state, clear_hands=True)
        p0 = state["players"][0]
        pub = ge.sanitize_state_for_player(state, user_id=p0["userId"])
        g_counts = pub.get("goodsDeckCounts")
        self.assertIsInstance(g_counts, dict)
        expected_bases = {"Grain": 12, "Animals": 18, "Wine": 18, "Weapons": 12, "Marble": 12, "Guards": 12}
        self.assertEqual(set(g_counts.keys()), set(expected_bases.keys()))
        for cat, base_val in expected_bases.items():
            self.assertEqual(g_counts[cat]["base"], base_val)
            self.assertGreaterEqual(g_counts[cat]["remaining"], 0)
            self.assertLessEqual(g_counts[cat]["remaining"], base_val)

        # Scout works on market, missiones, and influence
        state["phase"] = "delivery"
        state["activePlayerIndex"] = 0
        p0["position"] = "C3"
        for dk in ("market", "missiones", "influence"):
            p0["scoutedThisTurn"] = False
            ok, msg = ge.handle_player_action(
                state,
                p0["userId"],
                {"type": "delivery_scout", "targetType": "deck", "targetKey": dk},
            )
            self.assertTrue(ok, f"Scouting {dk} should succeed: {msg}")
            self.assertGreater(len(p0["scoutedInfo"]), 0)

        # Informants works on market, missiones, and influence
        for dk in ("market", "missiones", "influence"):
            inf_id = f"info_{dk}"
            p0["influence"] = [{"id": inf_id, "name": "Informants", "effectCode": "reorder_top_3_any"}]
            ok, msg = ge.handle_player_action(
                state,
                p0["userId"],
                {"type": "play_influence", "cardId": inf_id, "targetType": "deck", "targetKey": dk},
            )
            self.assertTrue(ok, f"Informants on {dk} should succeed: {msg}")
            self.assertTrue(p0.get("pendingTop3Reorder"))
            p0["pendingTop3Reorder"] = None

    def test_prepared_next_tile_monuments_removed_and_port_8081(self):
        state = _make_two_human_state()
        _complete_setup_discard(state, clear_hands=True)
        p0 = state["players"][0]

        san_player = ge.sanitize_state_for_player(state, user_id=p0["userId"])
        for coord, cell_view in san_player["romeBoard"].items():
            if cell_view["stackCount"] > 0:
                self.assertIsNotNone(cell_view.get("nextTile"), f"{coord} should prepare nextTile for player")
                self.assertEqual(cell_view["nextTile"]["id"], state["romeBoard"][coord]["stack"][0]["id"])
                self.assertIsInstance(cell_view["nextTile"].get("edges"), dict)

        san_spectator = ge.sanitize_state_for_player(state, user_id=None)
        for coord, cell_view in san_spectator["romeBoard"].items():
            self.assertIsNone(cell_view.get("nextTile"), f"Spectator view must omit nextTile for {coord}")

        self.assertFalse((REPO_ROOT / "public/assets/monuments").exists())
        app_js = (REPO_ROOT / "public/app.js").read_text(encoding="utf-8")
        styles_css = (REPO_ROOT / "public/styles.css").read_text(encoding="utf-8")
        server_py = (REPO_ROOT / "src/server.py").read_text(encoding="utf-8")
        self.assertNotIn("monuments/", app_js)
        self.assertIn("dyn-tile-back-underlay", app_js)
        self.assertIn(".dyn-tile-back-underlay", styles_css)
        self.assertIn("http://127.0.0.1:8081", server_py)
        self.assertIn('port: int = 8081', server_py)
        self.assertIn('"8081"', server_py)
        self.assertNotIn("http://127.0.0.1:8080", server_py)

    def test_frontend_ui_js_suite_via_jsc(self):
        jsc = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc"
        proc = subprocess.run(
            [jsc, str(REPO_ROOT / "tests/test_frontend_ui.js")],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(proc.returncode, 0, msg=f"STDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}")
        self.assertIn("JS_UI_TESTS_PASSED", proc.stdout)


if __name__ == "__main__":
    unittest.main()
