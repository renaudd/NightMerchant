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
        self.assertIn("8(d)", inf_by_id["inf_2"]["effectText"])

        self.assertEqual(inf_by_id["inf_39"]["effectCode"], "patron_geta_aurelius")
        self.assertEqual(inf_by_id["inf_39"]["favorGain"]["extraFavor"], ["-Geta", "-Aurelius"])
        self.assertIn("8(d)", inf_by_id["inf_39"]["effectText"])

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
        self.assertIn("cards_catalog.json?v=58", app_js)
        self.assertIn("app.js?v=58", index_html)
        self.assertTrue((REPO_ROOT / "public/assets/icons/rome_211_map_bg_v4.jpg").is_file())
        self.assertTrue((REPO_ROOT / "public/assets/icons/ostia_market_board_bg.jpg").is_file())
        self.assertIn("ostia_market_board_bg.jpg?v=58", styles_css)
        self.assertEqual(styles_css.count("rome_211_map_bg_v4.jpg?v=58"), 2)
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
        self.assertEqual(p0["cash"], 18)
        self.assertEqual(p0["favor"]["Caracalla"], -1)
        self.assertEqual(p0["favor"]["Domna"], -1)
        self.assertTrue(p0["cart"][0]["combat"]["preRollStrike"])

        ok2, msg2 = ge.handle_player_action(state, p0["userId"], {"type": "play_influence", "cardId": "inf_39"})
        self.assertTrue(ok2, msg2)
        self.assertEqual(p0["cash"], 26)
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
