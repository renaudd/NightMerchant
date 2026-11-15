// Night Merchant: Official HTML Rulebook View (extracted from app.js)

/* =========================================================================
   OFFICIAL HTML RULEBOOK VIEW (REPLACING ORIGINAL BOARDS GALLERY)
   ========================================================================= */

const RULEBOOK_SECTIONS = [
  {
    id: "overview",
    title: "1. Overview & Historical Setting (211 A.D.)",
    paragraphs: [
      "Welcome to Night Merchant: All Roads Lead to Rome! The year is 211 A.D. Emperor Septimius Severus has died in Eboracum, leaving Rome in the volatile hands of his feuding sons Bassianus (known to history as Caracalla) and Geta. Under Julius Caesar's Lex Iulia Municipalis (45 B.C.), heavy merchant wagons are barred from Rome's streets by day (historically exempting only imperial public-works stone haulers, while private nocturnal marble consignments must still roll by night). Only at dusk (8:00 P.M.) do the six Via entrances open to the Collegium Mercatorum.",
      "Across 3 Seasons (Spring, Summer, and Fall), 2 to 6 merchants buy Goods and hire Guards at Portus Ostiae by day, then navigate 36 nocturnal neighborhoods of Rome (A1–F6) across 10 hourly turns (8:00 P.M. to 5:00 A.M.) before the 6:00 A.M. Sunrise Curfew. After Fall Clean-Up, the December 211 Purge (Winter Reckoning) settles unfinished contracts, cart inventory, loans, and imperial faction alliances—crowning the wealthiest merchant in Denarii (d)!",
    ],
    bullets: [
      "Game Boards: The Portus Ostiae Market Board (6 tracks: Grain, Animals, Wine, Weapons, Marble, and Guards × 6 scarcity bays), the 6×3 Political Climate Board, and the Nocturnal Rome City Board (6×6 grid A1–F6, 36 neighborhoods including Mausoleum Hadriani at A1, Thermae Neronianae at B2, Saepta Julia at C2, and Mons Testaceus at A6, plus 6 Via Entrances, 3 Imperial Forums, and the Tiber River crossed by 5 Stone Bridges).",
      "Neighborhood Tiles: 432 square tiles (12 per neighborhood across 36 stacks) featuring streets, barricades, 2(d) road tolls, encounters, Stadium gambling, and nocturnal buyers.",
      "Decks & Mats: Market Cards, Missiones (Starting & Encounter Missions), Influence Cards, Patricii / Legiones / Nefarii Encounter Decks, Merchant Cart Mats (6■ Cargo Blocks in 2×3 grid, 2▲ Guard Slots in 2×1 column, 5 Uncapped Faction Favor tracks), and 6-sided Roman Numeral Dice (0, 0, I, I, II, III).",
    ],
  },
  {
    id: "factions",
    title: "2. The Five Severan Factions of Rome (Uncapped Favor)",
    paragraphs: [
      "Five rival imperial figures command loyalty and fear across Rome in 211 A.D. Favor gems earned or lost from Missions, Encounters, and Influence cards are UNCAPPED (can reach ±5 or more!), determining whether a faction's agents treat you as a Friendly ally or a Hostile target and fueling the game's drafted Political Climate:",
    ],
    iconGrid: [
      {
        img: "./assets/icons/ruby.png",
        title: "Ruby — Caracalla",
        desc: "Co-Emperor Marcus Aurelius Antoninus. Grants +1 CP per positive Ruby when Army Pay Hike is active.",
      },
      {
        img: "./assets/icons/emerald.png",
        title: "Emerald — Geta",
        desc: "Co-Emperor Publius Septimius Geta. Entitled and miserly, yet popular across Rome—until Caracalla's December purge.",
      },
      {
        img: "./assets/icons/diamond.png",
        title: "Diamond — Julia Domna",
        desc: "Empress Mother Julia Domna. Can be exchanged 1-for-1 into +Ruby or +Emerald when Empress Mediator is active.",
      },
      {
        img: "./assets/icons/sapphire.png",
        title: "Sapphire — Plautilla",
        desc: "Exiled Augusta Fulvia Plautilla. Favored among nocturnal smugglers and the Nefarii underworld.",
      },
      {
        img: "./assets/icons/amethyst.png",
        title: "Amethyst — Aurelius",
        desc: "Senatorial scion Pompeianus. Spend +Amethysts to boost sale scarcity by +1 step per gem with Senatorial Privilege.",
      },
      {
        imgs: ["./assets/icons/thumb_up.png", "./assets/icons/thumbs.png", "./assets/icons/thumb_down.png"],
        title: "Friendly / Neutral / Hostile",
        desc: "Thumbs Up (Friendly, positive net Favor), Neutral (0 Favor), and Thumbs Down (Hostile, negative net Favor) govern NPC reactions.",
      },
    ],
    table: {
      headers: ["Faction & Gem", "Historical Role in 211 A.D.", "Alignments & Character"],
      rows: [
        [
          "Caracalla (Ruby)",
          "Co-Emperor Marcus Aurelius Antoninus (born Bassianus)",
          "Mercurial, ruthless, and favored by the Legiones. Allied with Domna; hostile to Geta, Plautilla, and the Aurelians.",
        ],
        [
          "Geta (Emerald)",
          "Co-Emperor Publius Septimius Geta",
          "Entitled and penny-pinching, yet popular in the city—doomed to be murdered by Caracalla in late December 211 A.D. Allied with Domna; hostile to Caracalla.",
        ],
        [
          "Domna (Diamond)",
          "Empress Mother Julia Domna (mother to Bassianus and Geta)",
          "Wealthy patroness of scholars and sophists who strives for peace between her sons. Allied with Caracalla & Geta; hostile to Plautilla & Aurelius.",
        ],
        [
          "Plautilla (Sapphire)",
          "Exiled Augusta Fulvia Plautilla",
          "Banished wife of Caracalla sneaking through Rome in nocturnal disguise; loved by criminals and favored among the Nefarii. Allied with Aurelius; most hostile to Caracalla.",
        ],
        [
          "Aurelius (Amethyst)",
          "Lucius Aurelius Commodus Pompeianus (The Aurelians)",
          "Scion of the old Claudio-Aurelian senatorial aristocracy; favored among the Patricii. Allied with Plautilla; hostile to Caracalla & Geta.",
        ],
      ],
    },
    bullets: [
      "Historical Note — Lucius Fabius Cilo (Tutor of Caracalla & Geta): Even amid Caracalla's bloody December 211 A.D. purge of Geta's supporters, personal ties could halt Praetorian steel. Romans were in outcry when soldiers sent to kill Cilo dragged him from his bath through the streets; Caracalla intervened—'Insult not my father, strike not my tutor!'—and had the arresting officer put to death.",
    ],
  },
  {
    id: "setup",
    title: "3. Game Setup, Initial Discard, & Political Climate Draft",
    bullets: [
      "Starting Treasury & Market: Each merchant begins Spring with 12(d) and 0 Favor across all five factions. 24 Goods/Guards are dealt onto the Portus Ostiae Market Board and left-aligned toward Precious (<<).",
      "Initial Hand & Speed Discard: Each merchant is dealt 5 distinct Starting Missions and 5 distinct Influence cards, then discards 2 Missions and 2 Influence cards (keeping 3 of each).",
      "Political Climate Draft (6×3 Board): The FIRST merchant to finish discarding claims First Pick on the 6-column Political Climate Board (Caracalla, Geta, Domna, Plautilla, Aurelians, Missions — at most 1 Decree may be enacted per column).",
      "First-Game Tip — Skip the Political Track (or Draft Randomly): New players are recommended to skip the Political Climate track their first time playing (or use the Pick Random Decree button) so you can focus on learning the Ostia Market, Nocturnal Delivery, and Encounters.",
      "2-Player vs. 3+ Player Draft: In a 2-player game, 4 modifiers are enacted via snake draft (First Discarder → Rival → Rival → First Discarder — first pick and last pick!). In 3–6 player games, each merchant enacts 1 modifier in discard-completion order (up to all 6 columns).",
      "Normal Game Turn Order & 5th/6th Player Stipend: Once the Political Climate is set, the First Player Token goes to the merchant seated AFTER the First Discarder—so the merchant who claimed First Pick on the Political Climate acts LAST in normal turn order! In 5–6 player games, to offset late Spring Market position, the 5th merchant in Spring turn order receives +1(d) (starting at 13(d)) and the 6th merchant receives +2(d) (starting at 14(d)).",
    ],
  },
  {
    id: "market",
    title: "4. Phase I: The Ostia Market Phase & Goods Card Symbols",
    paragraphs: [
      "During daylight at Portus Ostiae, merchants take turns in turn order performing 1 Market Action per turn until all merchants pass consecutively. Every Good and Guard card features a 5-column Price Board (from << Precious to >> Abundant) and compact symbols:",
    ],
    iconGrid: [
      {
        symbolType: "sell_sym",
        title: "Bold Green +𐆖 (Sell / Fence Row)",
        desc: "The top price row on a Good Card. Shows the Denarii you RECEIVE when selling that Good in Rome (or Fencing Encounter Mission Cargo) at each Scarcity column (<< to >>).",
      },
      {
        symbolType: "buy_sym",
        title: "Italic Red -𐆖 (Buy / Hire Row)",
        desc: "The bottom price row on a Good or Guard Card. Shows the Denarii you PAY to buy that Good at Portus Ostiae (or a Rome Forum) or to hire/retain a Guard.",
      },
      {
        symbolType: "denarius",
        title: "Denarius (𐆖)",
        desc: "Imperial silver coin (U+10196) used for all Market purchases, nocturnal sales, road tolls, Stadium wagers, Guard upkeep, and final victory scoring.",
      },
      {
        badgeText: "<<  <  =  >  >>",
        title: "5 Scarcity Columns",
        desc: "From left to right: << Precious (0 cards left on track), < Rare (1 card), = Uncommon (2–3 cards), > Common (4 cards), and >> Abundant (5–6 cards).",
      },
      {
        badgeText: "■  ■■  ■■■",
        badgeClass: "rulebook-badge-cargo",
        title: "Cart Space Cubes (■)",
        desc: "Brown squares showing how many of your Cart Mat's 6 Cargo slots (6■) a Good occupies (1■, 2■, or 3■). Heavier Goods yield higher profit margins.",
      },
      {
        badgeText: "▲  ▲▲",
        badgeClass: "rulebook-badge-guard",
        title: "Guard Seat Triangles (▲)",
        desc: "Gold triangles showing how many of your Cart Mat's 2 Guard seats (2▲) a hired Guard occupies (1▲ or 2▲).",
      },
    ],
    bullets: [
      "Buy a Good or Hire a Guard: Pay the card's italic Red (BUY_SYM) Buy/Hire price for its current column (<<, <, =, >, >>). Goods occupy ■ blocks on your Cart Mat (max 6■); Guards occupy ▲ slots (max 2▲). A replacement card is drawn onto the leftmost column of its category.",
      "Source a Good (Discard 1 Influence): Discard 1 Influence card to select a Good from the deck onto the leftmost column of its track (sliding existing cards right).",
      "Pass: Step out of the Market Round. Once a full round passes with no Market purchases, enter Rome at dusk.",
    ],
    table: {
      headers: ["Cards Remaining on Track", "Scarcity Symbol", "Market Supply State", "Base Rome Selling Column ((SELL_SYM))"],
      rows: [
        ["0 Cards", "<<", "Precious (Depleted)", "Sells at << (highest (SELL_SYM) column) by default."],
        ["1 Card", "<", "Rare (Low Supply)", "Sells at < by default (+ shifts to <<)."],
        ["2–3 Cards", "=", "Uncommon (Balanced)", "Sells at = by default."],
        ["4 Cards", ">", "Common (High Supply)", "Sells at > by default."],
        ["5–6 Cards", ">>", "Abundant (Flooded)", "Sells at >> (lowest (SELL_SYM) column) by default."],
      ],
    },
  },
  {
    id: "delivery",
    title: "5. Phase II: Nocturnal Rome Delivery, Tile Icons, & The Tiber River",
    paragraphs: [
      "At 8:00 P.M. (Turn 1), each merchant may take 1 Initial Scout (tile or deck card) and then enters Rome through one of the 6 Via City Gates: B1 (Via Flaminia), E1 (Via Nomentana), F3 (Via Tiburtina), F6 (Via Tusculana), B6 (Via Ostiensis), or A4 (Via Aurelia). Entering a Gate uses your Turn 1 movement.",
      "Across Turns 1–10 (8:00 P.M. to 5:00 A.M.), each active merchant resolves their hourly turn in strict sequence:",
    ],
    iconGrid: [
      {
        symbolType: "move_sym",
        title: "Move Action Circle (M)",
        desc: "Represents 1 Cart Movement action along an open green street edge (or granted as a bonus Move by Influence cards).",
      },
      {
        symbolType: "tx_sym",
        title: "Transaction Action Circle (T)",
        desc: "Represents 1 hourly Transaction: Sell 1 Good (or Bulk-Sell all Grain!), Buy 1 Good at a Forum, or Gamble at a Stadium.",
      },
      {
        badgeText: "++  +  =  -  --",
        title: "Tile Buyer & Forum Modifiers",
        desc: "Shifts a Good's current Ostia Scarcity column 1 or 2 steps toward << Precious (+ / ++) or >> Abundant (- / --) when buying or selling on that tile.",
      },
      {
        img: "./assets/icons/persist.png",
        title: "Persistent Tile Icon",
        desc: "Landmarks marked with the Persistent icon stay face-up on the Rome board between Seasons instead of returning to their stack at Dawn.",
      },
      {
        img: "./assets/icons/refresh.png",
        title: "Refresh Tile Icon",
        desc: "Volatile streets marked with the Refresh icon discard after their encounter resolves, immediately revealing the next tile beneath.",
      },
      {
        img: "./assets/icons/fleur_de_lis_gold.png",
        title: "Imperial Forum / First Player",
        desc: "Marks Rome's 3 central Imperial Forums (C3, D3, D4) where Goods are sold to merchants, as well as the seasonal First Player emblem.",
      },
    ],
    bullets: [
      "Step 1 (or Anytime During Your Turn) — Optional Trash: Once per Delivery turn (before or after Moving, even while on an occupied cell), discard 1 Influence card to bury the top card of ANY of the 6 decks (Patricii, Legiones, Nefarii, Goods & Guards, Missiones, or Influence—if targeting Influence, its existing top card cycles BEFORE your discarded card goes underneath), bury the top unrevealed stack tile of any neighborhood, OR trash an exposed face-up tile. Trashing an exposed tile on an occupied cell pushes it to the bottom and immediately flips the top unrevealed stack tile face-up; on an unoccupied cell, it leaves the space unrevealed until entered.",
      "Step 2 — Movement (1 Step (M)): Move along a passable outgoing edge to an adjacent neighborhood (revealing its top tile if face-down) or out an exterior perimeter edge to Exit Rome.",
      "Step 3 — Edge Cost / Hazard: Pay any 2(d) road toll or resolve any Edge Encounter crossed.",
      "Step 4 — Mission Cargo Pickup & Delivery: Upon arriving in a neighborhood—BEFORE any Center Tile Encounter triggers—you may load or deliver matching Mission Cargo!",
      "Step 5 — Center Tile Encounter: Resolve any Center Encounter on the tile (Patricii, Legiones, Nefarii, Angry Mob, Theater Troupe, or Soothsayer).",
      "Step 6 — One Transaction (1 Good/Hr (T), or Bulk Grain!): Sell AT MOST 1 Good card matching a buyer ('Buys:') on your current tile (or an active Sell Mission here) at its bold Green (SELL_SYM) price—EXCEPT for non-fenced GRAIN, where 1 hourly Transaction may sell ANY NUMBER (or all!) of your Grain cards together at the current Grain scarcity modifier! Alternatively, Purchase 1 Good at a Forum ('Sells:' at C3, D3, or D4) at its italic Red (BUY_SYM) price, OR Gamble once at a Stadium tile (up to 20(d) wager).",
      "Step 7 — Flexible Free Scout (Once Per Turn, Anytime): Once per Delivery turn—before or after Moving and before or after Transacting—you may Scout by peeking at the top unrevealed tile of any neighborhood stack or the top card of any of the 6 decks (Patricii, Legiones, Nefarii, Goods & Guards, Missiones, or Influence). Scouting NEVER forces your turn to end; continue taking remaining actions afterward or click End Turn from the Scout preview.",
      "Tiber River & Stone Crossings: The Tiber divides the West Bank (A1, A4, B4, A5) from the East Bank. All diagonal crossings over the Tiber (NW, NE, SE, SW) are completely impassable (even with Shortcut). Carts may cross between the West Bank and East Bank orthogonally (N, S, E, or W) along any passable tile edge (using the face-up tile's edge indicator as the source of truth), including across Rome's Stone Bridges (A1↔B1 Pons Aelius, A1↔A2 Pons Neronianus, A3↔A4 Pons Agrippae, B4↔C4 Pons Fabricius, B4↔B5 Pons Aemilius) and adjacent orthogonal river crossings (B3↔B4, A5↔B5, A5↔A6).",
    ],
  },
  {
    id: "missions",
    title: "6. Missions, Mission Cargo, & Regicide",
    bullets: [
      "5-Mission Active Limit: You may hold at most 5 active missions at a time. As soon as you take on a 6th active mission (from an Encounter, Combat defeat, or Soothsayer), you are immediately prompted to choose 1 of the 6 missions to cancel, and you cannot end your turn while holding more than 5 active missions.",
      "Starting Missions: Kept during Setup (3 per merchant). Can be canceled voluntarily without Favor penalty (unless Bonded Couriers is active, which fines -10(d) on any failed/canceled/unfinished mission!). Starting Mission Cargo can NEVER be sold or fenced.",
      "Encounter Missions: Drawn from NPC encounters. Encounter Mission Cargo displays a bold Green (SELL_SYM) Fence price row—fencing it to a matching buyer sells 1 card for quick Denarii, applies Patron Hostile Favor, and FAILS the mission (unless Smuggler's Fence is active, which boosts Fence Scarcity by +1 step and prevents fencing from counting as a Failed Mission!).",
      "Soothsayer Missions: Mandatory prophecies with 1(R) face-down Influence cards sealed underneath until completed. A Soothsayer mission can only be canceled if all six (6) of your active missions are Soothsayer missions (returning its sealed Influence cards to the deck with no penalty).",
      "Regicide & Regime Change ('Any Player' Clauses): Two high-stakes Encounter Missions—Regicide (defeating Emperor Caracalla in combat) and Regime Change (defeating Co-Emperor Geta in combat)—trigger if ANY Player defeats that Emperor in combat while you hold the Mission! Completing Regicide immediately ends the game in an instant assassination victory for the Regicide holder; completing Regime Change awards 100(d) and +2 Rubies (+1 Diamond) while continuing the year.",
    ],
  },
  {
    id: "combat",
    title: "7. Encounters, Combat, Charts, & Stadium Gambling",
    paragraphs: [
      "As your cart rolls through Rome's nocturnal streets and alleys, tile edges and centers trigger encounters with Rome's three major NPC decks, street hazards, and amphitheater games:",
    ],
    iconGrid: [
      {
        img: "./assets/icons/encounters/patricii_center.png",
        title: "Patricii Encounter",
        desc: "Wealthy senators & magistrates (30 cards: Julia Domna 8, Aurelius 8, Geta 5, Plautilla 3, Caracalla 2, Events 4). Friendly nobles offer Missions and Denarii; hostile nobles demand bribes or luxury goods.",
      },
      {
        img: "./assets/icons/encounters/legiones_1_center.png",
        title: "Legiones Encounter",
        desc: "Praetorian guards, vigiles & cohorts (30 cards: Caracalla 9, Plautilla 8, Geta 5, Domna 3, Aurelius 3, Events 2; +2 CP under Army Pay Hike). Historically, Roman soldiers extorted bribes and were often as dangerous to merchants as street criminals.",
      },
      {
        imgs: ["./assets/icons/encounters/nefarii_1_center.png", "./assets/icons/encounters/nefarii_3_center.png"],
        title: "Nefarii & 1×–3× Combat Icons",
        desc: "Cutthroats, thieves & syndicates (29 cards: Plautilla 8, Caracalla 5, Geta 5, Domna 5, Aurelius 3, Events 3). ANY 1×, 2×, or 3× Patricii/Legiones/Nefarii icon ALWAYS draws 1 card; the icon count (1–3) sets X in Combat (e.g., 3 Daggers = 3(R)+3 CP).",
      },
      {
        img: "./assets/icons/encounters/mob_center.png",
        title: "Angry Mob (1R Chart)",
        desc: "Roll 1(R): 0 = Lose all Wine; I = Lose all Grain; II = Lose your most expensive Good; III = Escape unharmed.",
      },
      {
        img: "./assets/icons/encounters/theater_center.png",
        title: "Theater Troupe (1R Chart)",
        desc: "Roll 1(R): 0 = Lose all Friendly outcomes; I = Lose all Hostile outcomes; II = Lose rest of turn & next turn; III = Draw 1(R) Influence.",
      },
      {
        img: "./assets/icons/encounters/soothsayer_center.png",
        title: "Soothsayer Prophecy",
        desc: "Draws a mandatory Soothsayer Mission and seals 1(R) face-down Influence cards beneath it until you fulfill the prophecy.",
      },
      {
        img: "./assets/icons/combat.png",
        title: "Combat & Combat Power (CP)",
        desc: "Crossed gladius swords mark street combat and hostile Combat tiers on Encounter cards. Compare total Player CP vs. Opponent CP.",
      },
      {
        symbolType: "enc_deck_quest",
        title: "Encounter Deck & Quest Chest",
        desc: "Center-bar Encounter tier icons: Card + Chest + ! ((DECK_ICON)(QUEST_ICON)!) means a Deck Quest Demand (draw and accept top Missiones card unseen; refuse = Hostile Favor); Card + Chest + ? ((DECK_ICON)(QUEST_ICON)?) means an Optional Deck Quest Offer; Chest alone ((QUEST_ICON)! / ?) assigns the card's printed Mission.",
      },
      {
        symbolType: "rome_die",
        title: "Roman Numeral Die (R)",
        desc: "6-sided custom die with faces 0, 0, I, I, II, III (mean roll = 1.0). Rolled for Combat, Charts, and Stadium wagers.",
      },
      {
        imgs: ["./assets/icons/dice.png", "./assets/icons/chest.png"],
        title: "Stadium Wager & Loot Chest",
        desc: "Dice icon lets you spend your Transaction to wager 1–20(d) (win Wager × 1(R) roll). Chest icon marks special cargo/treasure rewards.",
      },
    ],
    bullets: [
      "Friendly vs. Hostile Encounters: Determined by your uncapped net Favor with the NPC's Faction. Drawing on any 1×, 2×, or 3× Patricii, Legiones, or Nefarii icon ALWAYS draws 1 Encounter card; the icon count (1–3) sets X in X(R)+X Combat. If you refuse a Demand to Fight and lose Combat, the NPC enforces their original Demand AND your turn ends immediately!",
      "Contraband Inspections (If Carrying → ⚔ / ✓): Certain Legiones and Nefarii encounter tiers inspect your cart for specific cargo or Guards (e.g., Weapons, Fine Wine, Exotic Animals, Marble, or Guards—non-Mission cargo/hired Guards). If your Favor falls in that tier AND you are carrying a matching item, Combat triggers! If you are clean (none carried), the tier downgrades to ✓ and you pass through peacefully with no Favor change.",
      "Combat Power (CP) & Cargo Gear: Both sides roll Rome Dice (R) plus Guards, Weapons, mandatory Exotic Animals (including Ostrich or negative-die beasts!), and Influence modifiers (plus +1 CP per positive Ruby & +2 CP to Legiones if Army Pay Hike is active). Note that crated Loricae body armor carries 0 CP in street ambushes (too slow to don mid-attack, compensated by lucrative trade margins). If Player CP ≥ Opponent CP against an NPC, you win!",
      "Sagittae Pre-Roll 1(R) Strike (Destroyed if Used): Before committing to the main combat dice roll, any merchant carrying Sagittae may choose to fire it in a dedicated pre-roll strike phase (destroying the card). Each Sagittae fired rolls 1(R) Wounds directly at the target BEFORE main combat dice are rolled: Armor (Manicae, Galeae, Scuta, Decimus) blocks Wounds first. Against an NPC, each unblocked Wound permanently deducts 1 from the NPC's X count (for X-based formulas like X(R)+X) or 1(R) from printed (R) formulas, and if unblocked Wounds EXCEED that capacity, the NPC is defeated immediately without rolling main combat! Against a rival merchant (Casus Belli or Tie-Breaker Round 1), unblocked Wounds kill Guards first and trigger the target's Driver Fate Chart roll immediately if any Wound reaches their Driver. Only 'Twist Of Fate' may be played to re-roll dice during a Sagittae pre-strike window.",
      "Armor, Guards, & Driver Fate (Damage Deficit Note): If Opponent CP > Player CP, suffer Raw Wounds = (Opponent CP − Player CP). Note that wounds from combat are always determined by the signed damage deficit between the two sides—even when one or both CP totals are negative (for example, if your overall CP is -2 and your opponent's CP is -1, you suffer 1 Wound). Shields/Helmets reduce Wounds first; each remaining Wound kills 1 Guard. If an unblocked Wound reaches your Driver, roll 1(R) on the Driver Fate Chart: 0 = Dead (lose all Goods & your night ends); I = Left for dead (lose all Goods); II = Beaten & mugged (lose all Denarii); III = Begged for mercy (lose all Influence cards).",
      "1(R) Street Charts: Angry Mob (0: lose all Wine; I: lose all Grain; II: lose most expensive Good; III: safe), Theater Troupe (0: lose all Friendly Favor outcomes; I: lose all Hostile Favor outcomes; II: lose rest of turn & next turn; III: draw 1(R) Influence), Soothsayer (take mandatory Mission + seal 1(R) Influence cards).",
      "Casus Belli — Encounter vs. Proactive PvP Combat: Inside your initial NPC Encounter pre-decision window, Casus Belli unlocks Combat against a non-threatening NPC (usable even on Turn 1 without consuming a Transaction). Outside encounters on Turn 2+ of your Night Delivery turn (strictly prohibited on Turn 1), you may play Casus Belli against an active rival merchant on your same neighborhood cell (A1–F6): this immediately exhausts your hourly Transaction (T) for the turn (blocked if you already transacted, gambled, or ended your turn). Both combatants choose consumable Weapons before rolling (any chosen Sagittae fire first as pre-roll 1(R) strikes; other consumables such as Pila add to main combat), followed by simultaneous Combat Dice (R) + Guards + Weapons + mandatory Exotic Animals + Army Pay Hike (+1 CP per positive Ruby) + pre/post-roll Influence cards (Gladiator's Intervention +1(R) CP, Flying Chamber Pot +1 CP). Ties inflict no Wounds or Spoils; if the Attacker loses by CP, their turn ends immediately. Any unblocked Wounds reaching the loser's Driver trigger a 1(R) Driver Fate Chart roll where the Winner claims Spoils (0/I: all Goods, discarding Mission Cargo; II: all Denarii; III: all Influence cards), and only a Roll of 0 ends the loser's night for the Season.",
      "Stadium Gambling: On a tile with the Dice icon, wager 1(d) to 20(d) (capped at 20(d) per gamble action) and roll 1(R) to win Wager × Roll!",
    ],
  },
  {
    id: "cleanup",
    title: "8. Phase III: Dawn Clean-Up, Curfew Fines, & Loans",
    bullets: [
      "6:00 A.M. Dawn Curfew Fine: Any merchant still inside Rome after Turn 10 (5:00 A.M.) pays a seasonal curfew fine—Spring 12(d), Summer 20(d), Fall 32(d)—halved to 6(d) / 10(d) / 16(d) if standing on one of the 6 Via Gate tiles!",
      "Tile Cleanup: Persistent tiles (⤹) stay face-up for future seasons; Refresh tiles (↻) discard after encounters; ordinary revealed tiles return to the bottom of their stacks at Dawn.",
      "Buy Influence Cards: Cost scales by your current Influence hand size (including face-down Soothsayer cards): 0–1 cards = 2(d), 2–3 cards = 4(d), 4 cards = 6(d), 5+ cards = 8(d).",
      "Collegium Loans: Spring Loan grants +20(d) (repay 30(d) at end of Summer, or 45(d) at end of Fall / Winter Reckoning). Summer Loan grants +40(d) (repay 60(d) at end of Fall / Winter Reckoning).",
      "Guard Upkeep & Winter Tie-Breaker Policy: Pay each retained Guard's current Market hiring cost (or release them to the bottom of the Market deck). During Fall Clean-Up, you may also toggle whether your Driver is authorized to expend Combat Influence cards during Winter Reckoning PvP tie-breakers.",
      "Next Season & First Player Token: When Clean-Up concludes, pass the First Player Token clockwise (once per season) and advance to Summer or Fall (or proceed to Winter Reckoning after Fall).",
    ],
  },
  {
    id: "winter",
    title: "9. Winter Reckoning & The 6×3 Political Climate Matrix",
    paragraphs: [
      "Unless a merchant achieves instant victory via Regicide earlier in the year, the game concludes after Fall Clean-Up with Winter Reckoning, governed by the Political Climate modifiers drafted during Setup:",
    ],
    bullets: [
      "Step 1 — Unfinished Missions Fail: Incomplete Missions fail first (applying Encounter Hostile Favor and -10(d) each if Bonded Couriers is active); remaining mission cargo is discarded.",
      "Step 2 — Cart Liquidation & Loans: Remaining non-mission Goods liquidate at Abundant (>>) (SELL_SYM) Sell Price, then unpaid Spring (-45(d)) and Summer (-60(d)) Loans are deducted.",
      "Step 3 — Imperial Proscription FIRST, Then Political Climate Settlement: If Imperial Proscription (Caracalla Option 1) is enacted, it resolves FIRST—eliminating the merchant with Least Caracalla Favor BEFORE any other Most/Least awards, penalties, steals, or percentages! Eliminated merchants cannot win or suffer subsequent Most/Least awards and rank below all survivors. Then resolve Flat Gem/Mission Modifiers & Least Penalties → Exile's Informants Steal → Domna +20% Wealth.",
      "Step 4 — PvP Combat Tie-Breakers (Strictly One Winner/Loser!): Every 'Most' and 'Least' modifier—as well as Final Score ties—awards its bonus or penalty to STRICTLY ONE merchant, even if tied at 0! Tied merchants fight PvP Combat: any single-use Sagittae pre-roll strikes resolve simultaneously in Round 1 (before main dice; only Twist Of Fate may re-roll pre-strike dice), pre-roll cards (Mercenary Ambush +2(R), Distraction -1(R) removing 1 positive die) apply before rolling, all dice roll simultaneously, and reactive post-roll cards (Twist Of Fate, Flying Chamber Pot +1 CP, Gladiator's Intervention +1(R) CP) trigger when they can overturn a deficit. For 'Most' awards, the combat winner claims the prize; for 'Least' penalties/elimination, the combat winner escapes and the combat LOSER suffers the penalty!",
    ],
    table: {
      headers: ["Caracalla", "Geta", "Julia Domna", "Plautilla", "Aurelians", "Missions"],
      rows: [
        [
          "Imperial Proscription: End of game (FIRST): Least Caracalla favor is eliminated.",
          "Brother's Grudge: End of game: Most Geta favor loses 25(d).",
          "Imperial Patronage: End of game: Most Domna favor gains +20% wealth.",
          "Exile's Informants: End of game: Most Plautilla favor steals 15(d) from the wealthiest rival.",
          "Old Senate Purse: End of game: Most Aurelian favor gains 25(d).",
          "Master Purveyor: End of game: Most completed Missions gains 30(d).",
        ],
        [
          "Praetorian Backlash: End of game: Lose 10(d) per +Ruby; gain 5(d) per -Ruby.",
          "Jealous Brothers: End of game: +15(d) per +Emerald if Caracalla ≤ 0, or -10(d) if ≥ +1; -5(d) per -Emerald.",
          "Court Neutrality: End of game: Lose 15(d) per +Diamond and 15(d) per -Diamond.",
          "Smuggled Dowry: End of game: Gain 10(d) per completed Mission with +Sapphire or a Plautilla patron.",
          "Choose a Side: End of game: Gain 10(d) per +Amethyst and 10(d) per -Amethyst.",
          "Loyalty Rewards: End of game: Receive 10 × A × B denarii (A = gems of any one faction, B = missions completed for that faction).",
        ],
        [
          "Army Pay Hike: Legiones gain +2 CP. Each +Ruby gives your Cart +1 CP.",
          "Opulence: All players start with +1 Emerald.",
          "Empress Mediator: Exchange +Diamonds 1-for-1 into +Rubies or +Emeralds anytime.",
          "Smuggler's Fence: Fenced cargo sells +1 Scarcity step higher and does not fail the Mission.",
          "Senatorial Privilege: Spend +Amethysts when selling Goods (including Bulk Grain) for +1 Scarcity step per gem.",
          "Bonded Couriers: Completed Missions pay 2× Denarii; failed or unfinished Missions fine 10(d).",
        ],
      ],
    },
  },
  {
    id: "symbols",
    title: "10. Complete Symbol Key & Strategy Overlays",
    paragraphs: [
      "Use this quick-reference table to decode every symbol on Goods Cards, Encounter Cards, Cart Mats, and Rome Neighborhood Tiles (keyboard shortcuts can be viewed and customized on your Profile page):",
    ],
    table: {
      headers: ["Feature / Symbol", "Where Shown", "Meaning"],
      rows: [
        [
          "(SELL_SYM) (Bold Green +𐆖)",
          "Goods Cards & Mission Cargo",
          "Sell Price Row (or Fence Price Row on Encounter Mission Cargo) — the Denarii you earn when selling that Good at each scarcity level (<< to >>).",
        ],
        [
          "(BUY_SYM) (Italic Red -𐆖)",
          "Goods & Guards Cards",
          "Buy / Hire Price Row — the Denarii you pay to purchase that Good at Portus Ostiae / Imperial Forums or to hire/retain a Guard.",
        ],
        [
          "(d) Denarius Symbol",
          "Treasury, Cards, & Tiles",
          "Roman Silver Denarius coin — the currency of Night Merchant.",
        ],
        [
          "<<  <  =  >  >>",
          "Ostia Market & Price Tables",
          "The 5 Market Scarcity columns: Precious (<<), Rare (<), Uncommon (=), Common (>), and Abundant (>>).",
        ],
        [
          "++  +  =  -  --",
          "Rome Tiles & Forums",
          "Neighborhood Buyer / Forum price modifier — shifts the active Scarcity column 1 or 2 steps toward << (+ / ++) or >> (- / --).",
        ],
        [
          "■ Cargo / ▲ Guard Slots",
          "Goods, Guards, & Cart Mat",
          "Each ■ occupies 1 Cargo block on your Cart (max 6■); each ▲ occupies 1 Guard seat (max 2▲).",
        ],
        [
          "(R) Roman Die / (M) Move / (T) Tx",
          "Cards, Tiles, & Rules",
          "(R) rolls a 6-sided Roman die (0, 0, I, I, II, III); (M) grants/uses a Move step; (T) grants/uses an hourly Transaction.",
        ],
        [
          "(COMBAT_ICON) / ! / ?",
          "Encounter Reputation Tiers",
          "(COMBAT_ICON) initiates immediate Combat; ! is a mandatory Demand (comply or fight); ? is an optional Friendly Offer or Gift.",
        ],
        [
          "(QUEST_ICON)! / (QUEST_ICON)?",
          "Encounter Reputation Tiers",
          "Ancient Roman Arca Chest — mandatory ((QUEST_ICON)!) or optional ((QUEST_ICON)?) Mission prescribed directly on the Encounter card.",
        ],
        [
          "(DECK_ICON)(QUEST_ICON)! / (DECK_ICON)(QUEST_ICON)?",
          "Encounter Reputation Tiers",
          "Fanned Card Deck + Roman Arca Chest — mandatory (!) or optional (?) unseen Mission drawn from the top of the Missiones deck.",
        ],
        [
          "(GREEN_BAR)",
          "Tile Edge",
          "Open Street — passable movement between connected neighborhoods without a Shortcut card.",
        ],
        [
          "(RED_BAR)",
          "Tile Edge",
          "Barricaded Alley — impassable barrier unless crossing with a Shortcut Influence card.",
        ],
        [
          "2(d) Badge",
          "Tile Edge",
          "Road Toll — pay 2 Denarii to cross (unless waived by Shortcut or Pass).",
        ],
        [
          "🌊 Tiber / 🌉 Pons",
          "Rome Map Borders",
          "Unbridged Tiber borders & river diagonals are impassable; cross only at the 5 Stone Bridges.",
        ],
        [
          "🌾 Bulk Sell Grain",
          "Cart & Navigate Panel",
          "Spend 1 hourly Transaction to sell ALL non-fenced Grain cards in your Cart at once.",
        ],
        [
          "👁️ Scouted Badge",
          "Unrevealed Rome Cell",
          "Hover over any tile you have Scouted (or click any face-up tile) to inspect its zoomed street layout.",
        ],
        [
          "Highlighted Scarcity & Paid/Net",
          "Cart Mat, Card Detail Modal, & Sell Buttons",
          "Loaded Cart Goods & Guards highlight the Scarcity column (<< to >>) where you acquired them; click any Card or inspect its Sell button to view the exact Purchase Price Paid and Net Profit.",
        ],
      ],
    },
  },
  {
    id: "catalog-goods",
    title: "11. Goods & Guards Cards",
    catalogKey: "market",
    paragraphs: [
      "Complete reference catalog of all 84 Cargo & Guard cards across Ostia's 6 Market tracks (Marble, Wine, Animals, Weapons, Grain, and Guards). No Scarcity column is pre-highlighted in this reference catalog; click any card to inspect its full buy and sell tables.",
    ],
  },
  {
    id: "catalog-influence",
    title: "12. Influence Cards",
    catalogKey: "influence",
    paragraphs: [
      "Complete reference catalog of all 40 Influence cards found in the Influence deck. Filter by tactical role or use the Rulebook search box to find specific effects.",
    ],
  },
  {
    id: "catalog-missions",
    title: "13. Mission Cards",
    catalogKey: "missiones",
    paragraphs: [
      "Complete reference catalog of all 52 Missiones deck cards (Delivery, Trade/Sell, and Combat/Regicide contracts). Filter by Patron Faction favor or Mission Kind.",
    ],
  },
  {
    id: "catalog-encounters",
    title: "14. Encounter Cards",
    catalogKey: "encounters",
    paragraphs: [
      "Complete reference catalog of all 89 Roman Street Encounter cards across the Patricii (30), Legiones (30), and Nefarii (29) decks. Inspect each deck's mechanical profile, Roman historical context (including Praetorian and legionary extortion often rivaling street crime), and five-faction gem composition below—or click any deck card to filter.",
    ],
  },
];

function getInfluenceCatalogCategory(c) {
  const ec = String((c && c.effectCode) || "");
  if (ec.startsWith("faction_favor_") || ec === "temp_favor_plus_2") return "Favor";
  if (
    ec === "casus_belli" ||
    ec.startsWith("combat_") ||
    ec === "free_guard_1r"
  ) {
    return "Combat";
  }
  if (
    ec === "reroll_die" ||
    ec === "chart_roll_plus_1" ||
    ec === "gambling_plus_1r" ||
    ec === "ignore_mob" ||
    ec === "ignore_theater_troupe" ||
    ec === "trigger_soothsayer"
  ) {
    return "Dice & Charts";
  }
  if (
    ec === "move_twice" ||
    ec === "pass_edge_as_green" ||
    ec === "increase_own_sale_scarcity" ||
    ec === "reduce_fine" ||
    ec === "reorder_top_3_any"
  ) {
    return "Movement & Scarcity";
  }
  return "Trade & Cart";
}

function getMissionCatalogKindLabel(m) {
  const k = String((m && m.kind) || "");
  if (k === "delivery") return "Delivery";
  if (k === "sell") return "Sell";
  if (k === "kill" || k === "kill_emperor" || k === "kill_emperor_cancel") return "Combat / Kill";
  return k || "Other";
}

function getCatalogSearchBlob(card, catalogKey) {
  if (!card) return "";
  if (catalogKey === "market") {
    return [
      card.name,
      card.subtitle,
      card.category,
      card.subcategory,
      card.track,
      card.combatText,
      card.abilityText,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }
  if (catalogKey === "influence") {
    return [card.name, card.effectText, getInfluenceCatalogCategory(card), card.bio]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }
  if (catalogKey === "missiones") {
    return [
      card.name,
      card.kind,
      getMissionCatalogKindLabel(card),
      card.item,
      card.category,
      card.pickupCell,
      card.deliverCell,
      card.cell,
      card.rewardText,
      card.text,
      card.description,
      ...(Array.isArray(card.favor) ? card.favor : []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }
  const m = card.mission || {};
  const reactionKeywords = Array.isArray(card.reactions)
    ? card.reactions.map((r) => {
        const info = getEncounterReactionInfo(r);
        const rt = r && (r.type || inferTierReactionType(r));
        const extra =
          rt === "deck_quest_demand" || rt === "deck_quest_offer" ? "missiones unseen" : "";
        return `${rt || ""} ${info.label} ${extra}`;
      })
    : [];
  return [
    card.name,
    card.deck,
    card.type,
    card.faction,
    card.bio,
    card.combatFormula,
    card.friendlyReward,
    card.combatReward,
    card.actionText,
    m.name,
    m.text,
    ...reactionKeywords,
    ...(Array.isArray(card.friendlyFavor) ? card.friendlyFavor : []),
    ...(Array.isArray(card.hostileFavor) ? card.hostileFavor : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getCatalogAllItemsForKey(catalogKey) {
  const cat = appState.cardsCatalog;
  if (!cat) return [];
  if (catalogKey === "market") return Array.isArray(cat.market) ? cat.market : [];
  if (catalogKey === "influence") return Array.isArray(cat.influence) ? cat.influence : [];
  if (catalogKey === "missiones") return Array.isArray(cat.missiones) ? cat.missiones : [];
  if (catalogKey === "encounters") {
    return [
      ...(Array.isArray(cat.patricii) ? cat.patricii : []),
      ...(Array.isArray(cat.legiones) ? cat.legiones : []),
      ...(Array.isArray(cat.nefarii) ? cat.nefarii : []),
    ];
  }
  return [];
}

function getRulebookCatalogCardsFiltered(catalogKey, searchQuery, applyPillFilters = true) {
  const all = getCatalogAllItemsForKey(catalogKey);
  const q = String(searchQuery || "").trim().toLowerCase();
  const f = appState.rulebookCatalogFilters || {};
  return all.filter((card) => {
    if (q && !getCatalogSearchBlob(card, catalogKey).includes(q)) return false;
    if (!applyPillFilters) return true;
    if (catalogKey === "market") {
      if (f.marketTrack && f.marketTrack !== "All") {
        const track = card.track || card.category || "";
        if (track !== f.marketTrack) return false;
      }
    } else if (catalogKey === "influence") {
      if (f.influenceCategory && f.influenceCategory !== "All") {
        if (getInfluenceCatalogCategory(card) !== f.influenceCategory) return false;
      }
    } else if (catalogKey === "missiones") {
      if (f.missionFaction && f.missionFaction !== "All") {
        const fav = Array.isArray(card.favor) ? card.favor : [];
        if (f.missionFaction === "No Favor") {
          if (fav.length > 0) return false;
        } else if (f.missionFaction === "Hostile") {
          if (!fav.some((x) => String(x || "").trim().startsWith("-"))) return false;
        } else {
          if (!fav.some((x) => String(x || "").replace(/^[-+!]/, "").trim() === f.missionFaction)) return false;
        }
      }
      if (f.missionKind && f.missionKind !== "All") {
        if (getMissionCatalogKindLabel(card) !== f.missionKind) return false;
      }
    } else if (catalogKey === "encounters") {
      if (f.encounterDeck && f.encounterDeck !== "All") {
        if (String(card.deck || "").toLowerCase() !== f.encounterDeck.toLowerCase()) return false;
      }
      if (f.encounterFaction && f.encounterFaction !== "All") {
        if (f.encounterFaction === "Event (Unaligned)") {
          if (card.type !== "event") return false;
        } else {
          if (String(card.faction || "") !== f.encounterFaction) return false;
        }
      }
    }
    return true;
  });
}

function buildRulebookFilterRowNode(labelText, options, currentVal, onSelect) {
  return el(
    "div",
    { className: "rulebook-filter-row" },
    el("span", { className: "rulebook-filter-label", text: labelText }),
    el(
      "div",
      { className: "rulebook-filter-pills" },
      ...options.map((opt) =>
        el("button", {
          type: "button",
          className: `rulebook-filter-pill ${(currentVal || "All") === opt ? "active" : ""}`,
          text: opt,
          onClick: () => onSelect(opt),
        })
      )
    )
  );
}

function renderRulebookCatalogSectionBody(sec, searchQuery, onRefresh) {
  const key = sec.catalogKey;
  if (!appState.cardsCatalog && !appState.cardsCatalogLoading && !appState.cardsCatalogError) {
    ensureCardsCatalogLoaded();
  }
  if (appState.cardsCatalogError && !appState.cardsCatalog) {
    return el(
      "div",
      { className: "rulebook-catalog-status error" },
      el("span", { text: `Unable to load card catalog: ${appState.cardsCatalogError}` }),
      el("button", {
        type: "button",
        className: "btn btn-sm",
        text: "Retry",
        onClick: () => {
          appState.cardsCatalogError = null;
          ensureCardsCatalogLoaded();
        },
      })
    );
  }
  if (!appState.cardsCatalog) {
    return el("div", {
      className: "rulebook-catalog-status",
      text: "⏳ Loading physical card catalog (270 cards)...",
    });
  }

  const f = appState.rulebookCatalogFilters;
  const setFilter = (field, val) => {
    appState.rulebookCatalogFilters[field] = val;
    if (onRefresh) onRefresh();
  };

  const filterBars = [];
  if (key === "market") {
    filterBars.push(
      buildRulebookFilterRowNode(
        "Category:",
        ["All", "Marble", "Wine", "Animals", "Weapons", "Grain", "Guards"],
        f.marketTrack,
        (val) => setFilter("marketTrack", val)
      )
    );
  } else if (key === "influence") {
    filterBars.push(
      buildRulebookFilterRowNode(
        "Role:",
        ["All", "Favor", "Combat", "Dice & Charts", "Movement & Scarcity", "Trade & Cart"],
        f.influenceCategory,
        (val) => setFilter("influenceCategory", val)
      )
    );
  } else if (key === "missiones") {
    filterBars.push(
      buildRulebookFilterRowNode(
        "Faction:",
        ["All", "Caracalla", "Geta", "Domna", "Plautilla", "Aurelius", "Hostile", "No Favor"],
        f.missionFaction,
        (val) => setFilter("missionFaction", val)
      ),
      buildRulebookFilterRowNode(
        "Type:",
        ["All", "Delivery", "Sell", "Combat / Kill"],
        f.missionKind,
        (val) => setFilter("missionKind", val)
      )
    );
  } else if (key === "encounters") {
    filterBars.push(
      buildRulebookFilterRowNode(
        "Deck:",
        ["All", "Patricii", "Legiones", "Nefarii"],
        f.encounterDeck,
        (val) => setFilter("encounterDeck", val)
      ),
      buildRulebookFilterRowNode(
        "Alignment:",
        ["All", "Caracalla", "Geta", "Domna", "Plautilla", "Aurelius", "Event (Unaligned)"],
        f.encounterFaction,
        (val) => setFilter("encounterFaction", val)
      )
    );
  }

  const allTotal = getCatalogAllItemsForKey(key).length;
  const filteredCards = getRulebookCatalogCardsFiltered(key, searchQuery, true);

  const cardNodes = filteredCards.map((card) => {
    if (key === "market") {
      const trackName = card.track || card.category || "Grain";
      const isGuard = trackName === "Guards";
      return el(
        "div",
        { className: "good-card-unit rulebook-catalog-good-unit" },
        renderPhysicalMarketGoodCardFaceNode(card, {
          trackName,
          priceColIndex: -1,
          isPriceIdxDirect: true,
          extraCardClass: "catalog-good-card",
          title: `Click to view ${card.name} details`,
          onClick: () => {
            if (isGuard) {
              openCartGuardDetailModal(Object.assign({ isCatalogPreview: true }, card));
            } else {
              openCartGoodDetailModal(
                Object.assign({ track: trackName, isCatalogPreview: true }, card),
                null,
                null,
                true
              );
            }
          },
        })
      );
    }
    if (key === "influence") {
      return renderPhysicalInfluenceCardNode(card);
    }
    if (key === "missiones") {
      return renderPhysicalMissionCardNode(card, { showStatusTag: false });
    }
    return renderPhysicalEncounterCardNode(card, null, { interactive: false });
  });

  const gridClass =
    key === "market"
      ? "rulebook-cards-grid rulebook-cards-grid-goods"
      : "rulebook-cards-grid rulebook-cards-grid-phys";

  const encounterDeckProfilesNode =
    key === "encounters"
      ? el(
          "div",
          { className: "encounter-deck-profiles-grid" },
          ...["patricii", "legiones", "nefarii"].map((dk) => {
            const prof = ENCOUNTER_DECK_PROFILES[dk];
            const filterVal = prof.filterValue || prof.label;
            const isSelected = f.encounterDeck === filterVal;
            return el(
              "button",
              {
                type: "button",
                className: `encounter-deck-profile-card${isSelected ? " is-active" : ""}`,
                style: { cursor: "pointer", font: "inherit", color: "inherit", width: "100%" },
                title: isSelected
                  ? `Showing ${prof.label} cards — click to show all Encounter decks`
                  : `Click to filter Section 14 to ${prof.label} cards`,
                onClick: () => setFilter("encounterDeck", isSelected ? "All" : filterVal),
              },
              el(
                "div",
                { className: "encounter-deck-profile-head" },
                el("img", {
                  className: "encounter-deck-profile-thumb",
                  src: prof.img,
                  alt: `${prof.label} Card Back`,
                }),
                el(
                  "div",
                  {},
                  el("div", { className: "encounter-deck-profile-title", text: prof.label }),
                  el("div", { className: "encounter-deck-profile-sub", text: prof.subtitle })
                )
              ),
              renderEncounterDeckMetaBlockNode(null, dk, {
                useLiveCounts: false,
                includeHistory: true,
                showFactionName: true,
              })
            );
          })
        )
      : null;

  const encounterTierIconKeyNode =
    key === "encounters"
      ? el(
          "div",
          { className: "rulebook-tier-icon-key" },
          el("div", {
            className: "rulebook-tier-icon-key-title",
            text: "Center Bar Icon Key (hover any card's tier cell for full details):",
          }),
          el(
            "div",
            { className: "rulebook-tier-icon-key-items" },
            ...[
              [
                "(DECK_ICON)(QUEST_ICON)!",
                "Deck Quest Demand (draw & accept top Missiones card unseen; refuse = Hostile Favor)",
              ],
              [
                "(DECK_ICON)(QUEST_ICON)?",
                "Optional Deck Quest Offer (draw & accept top Missiones card unseen; decline freely)",
              ],
              ["(QUEST_ICON)!!", "Strict Printed Mission"],
              ["(QUEST_ICON)!", "Printed Mission Request"],
              ["(QUEST_ICON)?", "Optional Printed Mission"],
              ["!! / ! / ?", "Strict Demand / Request / Offer"],
              ["(COMBAT_ICON)", "Mandatory Combat"],
            ].map(([tok, desc]) =>
              el(
                "span",
                { className: "rulebook-tier-icon-key-item" },
                el("span", { text: tok }),
                el("strong", { text: "=" }),
                el("span", { text: desc })
              )
            )
          )
        )
      : null;

  return el(
    "div",
    { className: "rulebook-catalog-wrap" },
    encounterDeckProfilesNode,
    el(
      "div",
      { className: "rulebook-catalog-toolbar" },
      ...filterBars,
      encounterTierIconKeyNode,
      el("div", {
        className: "rulebook-catalog-count",
        text: `Showing ${filteredCards.length} of ${allTotal} cards`,
      })
    ),
    cardNodes.length > 0
      ? el("div", { className: gridClass }, ...cardNodes)
      : el("p", {
          style: { color: "var(--text-muted)", fontStyle: "italic", padding: "0.75rem 0" },
          text: "No cards match your current filters and search query.",
        })
  );
}

function renderRulebookIconVisualNode(item) {
  const wrap = el("div", { className: "rulebook-icon-visual" });
  if (item.symbolType === "sell_sym") {
    const badge = el("span", { className: "rulebook-symbol-pill rulebook-symbol-pill-sell" });
    badge.appendChild(createSellPriceSymbolNode(false));
    wrap.appendChild(badge);
  } else if (item.symbolType === "buy_sym") {
    const badge = el("span", { className: "rulebook-symbol-pill rulebook-symbol-pill-buy" });
    badge.appendChild(createBuyPriceSymbolNode(false));
    wrap.appendChild(badge);
  } else if (item.symbolType === "denarius") {
    const badge = el("span", { className: "rulebook-symbol-pill" });
    badge.appendChild(createDenariusSvgNode("1.55em"));
    wrap.appendChild(badge);
  } else if (item.symbolType === "move_sym") {
    wrap.appendChild(createMoveActionCircleNode("Move Action (M)"));
  } else if (item.symbolType === "tx_sym") {
    wrap.appendChild(createTransactionActionCircleNode("Transaction Action (T)"));
  } else if (item.symbolType === "enc_deck_quest") {
    const badge = el("span", {
      className: "rulebook-symbol-pill",
      style: { display: "inline-flex", alignItems: "center", gap: "0.3rem", padding: "0.2rem 0.45rem" },
    });
    badge.appendChild(createDeckOfCardsIconNode("1.55em"));
    badge.appendChild(createAncientRomanChestIconNode("1.55em"));
    wrap.appendChild(badge);
  } else if (item.symbolType === "rome_die") {
    const dieNode = el(
      "span",
      {
        className: "rome-die-box",
        style: { width: "1.9rem", height: "1.9rem", fontSize: "1.05rem" },
      },
      "R"
    );
    wrap.appendChild(dieNode);
  } else if (item.badgeText) {
    wrap.appendChild(
      el("span", {
        className: `rulebook-symbol-badge ${item.badgeClass || ""}`,
        text: item.badgeText,
      })
    );
  } else if (Array.isArray(item.imgs)) {
    const multiWrap = el("div", { className: "rulebook-icon-multi" });
    item.imgs.forEach((src) => {
      multiWrap.appendChild(
        el("img", {
          src,
          alt: item.title || "Game icon",
          className: "rulebook-icon-img rulebook-icon-img-sm",
          loading: "lazy",
        })
      );
    });
    wrap.appendChild(multiWrap);
  } else if (item.img) {
    wrap.appendChild(
      el("img", {
        src: item.img,
        alt: item.title || "Game icon",
        className: "rulebook-icon-img",
        loading: "lazy",
      })
    );
  }
  return wrap;
}

function renderRulebookFormattedBulletNode(bulletText) {
  const li = el("li", { className: "rulebook-bullet-item" });
  const colonIdx = bulletText.indexOf(": ");
  if (colonIdx > 0 && colonIdx <= 68) {
    const leadText = bulletText.slice(0, colonIdx + 1);
    const bodyText = bulletText.slice(colonIdx + 1);
    const leadStrong = el("strong", { className: "rulebook-bullet-lead" });
    appendTextWithRomeDice(leadStrong, leadText);
    li.appendChild(leadStrong);
    appendTextWithRomeDice(li, bodyText);
  } else {
    appendTextWithRomeDice(li, bulletText);
  }
  return li;
}

function buildRulebookSectionNodes(searchQuery, onRefresh = null) {
  const q = (searchQuery || "").trim().toLowerCase();
  const filtered = q
    ? RULEBOOK_SECTIONS.filter(
        (sec) =>
          sec.title.toLowerCase().includes(q) ||
          (sec.paragraphs || []).some((p) => p.toLowerCase().includes(q)) ||
          (sec.bullets || []).some((b) => b.toLowerCase().includes(q)) ||
          (sec.iconGrid || []).some(
            (ic) =>
              (ic.title || "").toLowerCase().includes(q) ||
              (ic.desc || "").toLowerCase().includes(q) ||
              (ic.badgeText || "").toLowerCase().includes(q)
          ) ||
          (sec.table && sec.table.rows.some((r) => r.some((cell) => cell.toLowerCase().includes(q)))) ||
          (sec.catalogKey &&
            appState.cardsCatalog &&
            getRulebookCatalogCardsFiltered(sec.catalogKey, q, false).length > 0)
      )
    : RULEBOOK_SECTIONS;

  if (filtered.length === 0) {
    return [
      el(
        "p",
        { style: { color: "var(--text-muted)", fontStyle: "italic", padding: "0.75rem 0" } },
        `No rulebook sections matched "${searchQuery}". Try searching for Tiber, Grain, Favor, Sell, Buy, Loan, Curfew, Winter, Casus Belli, or a card name.`
      ),
    ];
  }

  return filtered.map((sec) =>
    el(
      "section",
      { id: `rulebook-sec-${sec.id}`, className: "rulebook-section" },
      el("h3", { text: sec.title }),
      ...(sec.paragraphs || []).map((p) => el("p", { className: "rulebook-paragraph", text: p })),
      sec.iconGrid
        ? el(
            "div",
            { className: "rulebook-icon-grid" },
            ...sec.iconGrid.map((item) =>
              el(
                "div",
                { className: "rulebook-icon-card" },
                renderRulebookIconVisualNode(item),
                el(
                  "div",
                  { className: "rulebook-icon-copy" },
                  el("div", { className: "rulebook-icon-title", text: item.title }),
                  el("div", { className: "rulebook-icon-desc", text: item.desc })
                )
              )
            )
          )
        : null,
      sec.bullets
        ? el(
            "ul",
            { className: "rulebook-bullet-list" },
            ...sec.bullets.map((b) => renderRulebookFormattedBulletNode(b))
          )
        : null,
      sec.table
        ? el(
            "div",
            { className: "rulebook-table-wrap" },
            el(
              "table",
              { className: "rulebook-table" },
              el(
                "thead",
                {},
                el("tr", {}, ...sec.table.headers.map((h) => el("th", { text: h })))
              ),
              el(
                "tbody",
                {},
                ...sec.table.rows.map((row) =>
                  el("tr", {}, ...row.map((cellText) => el("td", { text: cellText })))
                )
              )
            )
          )
        : null,
      sec.catalogKey ? renderRulebookCatalogSectionBody(sec, searchQuery, onRefresh) : null
    )
  );
}

function renderRulebookView() {
  ensureCardsCatalogLoaded();
  let sectionsContainer = null;
  const refreshSections = () => {
    if (sectionsContainer) {
      sectionsContainer.replaceChildren(...buildRulebookSectionNodes(appState.rulebookSearch, refreshSections));
    }
  };
  sectionsContainer = el(
    "div",
    { id: "rulebook-sections-list" },
    ...buildRulebookSectionNodes(appState.rulebookSearch, refreshSections)
  );

  const searchInput = el("input", {
    className: "form-input",
    type: "search",
    placeholder: "Search rules & cards (e.g. Tiber, Casus Belli, Falernian)...",
    value: appState.rulebookSearch || "",
    onInput: (e) => {
      appState.rulebookSearch = e.target.value;
      refreshSections();
    },
  });

  const tocSidebar = el(
    "aside",
    { className: "panel rulebook-toc" },
    el("h3", { className: "panel-title", text: "📜 Codex Regulae" }),
    !appState.user
      ? el(
          "button",
          {
            type: "button",
            className: "btn btn-primary",
            style: { width: "100%", marginBottom: "0.75rem" },
            onClick: () => {
              appState.activeTab = "portal";
              renderApp();
            },
          },
          "← Back to Welcome & Sign In"
        )
      : null,
    el("div", { className: "form-group", style: { marginBottom: "0.75rem" } }, searchInput),
    ...RULEBOOK_SECTIONS.map((sec) =>
      el("button", {
        type: "button",
        className: `rulebook-toc-btn ${appState.rulebookSection === sec.id ? "active" : ""}`,
        text: sec.title,
        onClick: () => {
          appState.rulebookSection = sec.id;
          appState.rulebookSearch = "";
          searchInput.value = "";
          refreshSections();
          tocSidebar.querySelectorAll(".rulebook-toc-btn").forEach((btn, idx) => {
            btn.classList.toggle("active", RULEBOOK_SECTIONS[idx] && RULEBOOK_SECTIONS[idx].id === sec.id);
          });
          const targetEl = document.getElementById(`rulebook-sec-${sec.id}`);
          if (targetEl) targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
        },
      })
    )
  );

  return el(
    "div",
    { className: "portal-container" },
    el(
      "div",
      { className: "rulebook-layout" },
      tocSidebar,
      el(
        "div",
        { className: "panel rulebook-content" },
        el(
          "div",
          { className: "panel-title fresco-banner-header fresco-merchants" },
          el("span", { text: "📜 Night Merchant: All Roads Lead to Rome — Official v2.0 Rulebook (211 A.D.)" }),
          el("span", { style: { fontSize: "0.8rem", color: "#fde6b0" }, text: "Complete HTML Edition" })
        ),
        sectionsContainer
      )
    )
  );
}
