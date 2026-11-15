// Night Merchant: Interactive Tutorial Guide (extracted from app.js)

function getTutorialEnabledLocalFlag() {
  try {
    const store = (typeof window !== "undefined" && window.localStorage) || (typeof localStorage !== "undefined" && localStorage);
    if (store) {
      const raw = store.getItem("nm_tutorial_enabled");
      if (raw === "0" || raw === "false") return false;
      if (raw === "1" || raw === "true") return true;
    }
  } catch (_e) { }
  return true;
}

function setTutorialEnabledLocalFlag(enabled) {
  try {
    const store = (typeof window !== "undefined" && window.localStorage) || (typeof localStorage !== "undefined" && localStorage);
    if (store) {
      store.setItem("nm_tutorial_enabled", enabled ? "1" : "0");
    }
  } catch (_e) { }
}

function isTutorialEnabled() {
  if (appState.user && appState.user.settings && typeof appState.user.settings.tutorialEnabled === "boolean") {
    return appState.user.settings.tutorialEnabled;
  }
  return getTutorialEnabledLocalFlag();
}

async function setTutorialEnabledPreference(enabled) {
  const flag = Boolean(enabled);
  setTutorialEnabledLocalFlag(flag);
  if (appState.user) {
    if (!appState.user.settings || typeof appState.user.settings !== "object") {
      appState.user.settings = {};
    }
    appState.user.settings.tutorialEnabled = flag;
  }
  syncTutorialUiInDom();
  renderApp();
  if (appState.user && typeof apiRequest === "function") {
    try {
      const res = await apiRequest("/api/profile/update", "POST", {
        settings: {
          ...(appState.user.settings || {}),
          tutorialEnabled: flag,
        },
      });
      if (res && res.user) {
        appState.user = res.user;
      }
    } catch (_err) {
      // Already updated locally.
    }
  }
}

function findTutorialMarketGoodSuggestion(gs, viewer) {
  const tracks = ["Grain", "Animals", "Wine", "Arms", "Marble"];
  const board = (gs && gs.marketBoard) || {};
  const cash = Number(viewer && viewer.cash) || 0;
  const abundantAffordable = [];
  const allAffordable = [];
  for (const trackName of tracks) {
    const cards = Array.isArray(board[trackName]) ? board[trackName] : [];
    for (let col = 0; col < cards.length; col++) {
      const card = cards[col];
      if (!card) continue;
      const price = Number(card.currentBuyPrice);
      if (!Number.isFinite(price) || price > cash) continue;
      // Only a Good occupying the 6th slot ('>>' Abundant column, colIndex === 5) is purchasable at Abundant (>>)
      const effectiveCol = Number.isFinite(Number(card.colIndex)) ? Number(card.colIndex) : col;
      const isAbundant = card.colSymbol === ">>" || effectiveCol === 5;
      const entry = { name: card.name || trackName, track: trackName, price, isAbundant };
      allAffordable.push(entry);
      if (isAbundant) abundantAffordable.push(entry);
    }
  }
  if (abundantAffordable.length > 0) {
    abundantAffordable.sort((a, b) => b.price - a.price);
    return { mode: "abundant_most_expensive", item: abundantAffordable[0] };
  }
  if (allAffordable.length > 0) {
    allAffordable.sort((a, b) => a.price - b.price);
    return { mode: "cheapest_affordable", item: allAffordable[0] };
  }
  return { mode: "none", item: null };
}

function hasViewerAvailableTransaction(gs, viewer) {
  if (!gs || !viewer || gs.phase !== "delivery" || gs.activePlayerIndex !== viewer.index || !viewer.position) {
    return false;
  }
  if (viewer.transactedThisTurn || viewer.nightEnded || viewer.nightPaused || gs.pendingEncounter) {
    return false;
  }
  const cell = gs.romeBoard && gs.romeBoard[viewer.position];
  const rev = cell && cell.revealed;
  if (!rev) return false;
  if (Array.isArray(rev.buys) && rev.buys.length > 0) return true;
  if (Array.isArray(rev.sells) && rev.sells.length > 0 && Array.isArray(viewer.cart) && viewer.cart.length > 0) {
    return true;
  }
  if (rev.gamble && viewer.cash > 0) return true;
  if (rev.missionOffer) return true;
  const missionMatch = (viewer.missions || []).some((m) => m && (m.deliverCell === viewer.position || m.cell === viewer.position));
  return missionMatch;
}

function computeActiveTutorialStep(gs, viewer, options = {}) {
  if (!gs || !viewer || gs.season !== "Spring") return null;
  if (options.enabled === false) return null;
  const dismissed =
    options.dismissedSteps instanceof Set ? options.dismissedSteps : appState.tutorialDismissedSteps || new Set();
  const phase = gs.phase || "setup_discard";
  const isMyTurn = gs.activePlayerIndex === viewer.index;
  const isNpcPacing = Boolean(options.isNpcPacing);

  const hasScoutedC3 =
    options.lastScoutedCoord === "C3" ||
    Boolean(
      Array.isArray(viewer.scoutedInfo) &&
      viewer.scoutedInfo.some((si) => si && si.targetType === "tile" && si.targetKey === "C3")
    );

  // 1. Encounter popup (first time in Encounter during Spring)
  if (
    gs.pendingEncounter &&
    Number(gs.pendingEncounter.playerIndex) === Number(viewer.index) &&
    !dismissed.has("spring_delivery_encounter")
  ) {
    return {
      id: "spring_delivery_encounter",
      stepLabel: "Spring Guide • Encounter",
      title: "⚔️ Resolving Your First Encounter",
      highlightSelector: "#pending-encounter-panel",
      paragraphs: [
        "Stepping onto an Encounter draws you into a confrontation with Rome's Patricii, Legiones, Nefarii, or a street chart (Mob, Theater Troupe, Soothsayer).",
        "Check your Status with that faction: Friendly merchants often receive rewards or Missions; Hostile encounters force a Bribe, Flight/Combat roll, or Influence defense.",
        "Use the highlighted Encounter panel to choose your response, roll fate dice, or trigger applicable Influence cards.",
      ],
    };
  }

  // 2. Transaction popup (first time an hourly Transaction is available in Delivery)
  const txAvailable =
    typeof options.hasTransaction === "boolean"
      ? options.hasTransaction
      : hasViewerAvailableTransaction(gs, viewer);
  if (phase === "delivery" && isMyTurn && !isNpcPacing && txAvailable && !dismissed.has("spring_delivery_transaction")) {
    return {
      id: "spring_delivery_transaction",
      stepLabel: "Spring Guide • Transactions",
      title: "⚖️ Perform an Hourly Transaction",
      highlightSelector: "#tx-actions-box",
      paragraphs: [
        "You are standing where a Transaction is available! Look inside the highlighted Cart Navigation panel to Buy goods, Sell cargo matching demand, Gamble, or complete a Mission.",
        "Note: Unless modified by an Influence card or Decree, you may perform 1 Transaction per hour, either before or after moving.",
      ],
    };
  }

  // 3. Turn 6 Curfew reminder
  if (
    phase === "delivery" &&
    Number(gs.turn) >= 6 &&
    viewer.position &&
    !dismissed.has("spring_delivery_turn6_curfew")
  ) {
    return {
      id: "spring_delivery_turn6_curfew",
      stepLabel: "Spring Guide • Curfew Reminder",
      title: "🕰️ Plan Your Exit Before Turn 10 Ends",
      highlightSelector: "#rome-clock-board",
      paragraphs: [
        `It is now Turn ${gs.turn} (${gs.turnHourLabel || "1:00 A.M."}). Rome shuts its gates at Dawn after Turn 10 (5:00 A.M.).`,
        "You will need to leave Rome through one of the Via gates on Turn 10 or sooner to avoid paying the Dawn Curfew fine (12(d) in Spring, or half on a Gate).",
      ],
    };
  }

  // 4. Phase-driven walkthrough steps
  if (phase === "setup_discard" && !viewer.setupDiscardDone && !dismissed.has("spring_setup_discard")) {
    return {
      id: "spring_setup_discard",
      stepLabel: "Spring Guide • Step 1",
      title: "📜 Discard 2 Missions & 2 Influence Cards",
      highlightSelector: "#setup-discard-panel",
      paragraphs: [
        "Click on any 2 Mission cards and 2 Influence cards to mark them to be discarded, then press Confirm Discard.",
        "If an Influence card doesn’t seem valuable or if you don’t understand it, toss it.",
        "Check out the goods that have populated the market board before deciding to keep any Sell missions.",
        "If you can’t decide which cards to discard, click Auto-Select 2 & 2 above to pre-select cards quickly.",
      ],
    };
  }

  if (phase === "setup_climate" && !dismissed.has("spring_setup_climate")) {
    return {
      id: "spring_setup_climate",
      stepLabel: "Spring Guide • Step 2",
      title: "🏛️ Curia Julia Decree Board",
      highlightSelector: isMyTurn ? "#btn-random-decree" : "#political-climate-board",
      paragraphs: [
        "Your starting hand is set! You are now viewing the Political Climate Decree Board.",
        isMyTurn
          ? "Pick one open Decree column — or for your first game, click 🎲 Pick Random Decree above to choose a Decree randomly (as recommended in the Rulebook for first-time players)."
          : "Once it is your turn to draft a Decree, you can pick one manually or click 🎲 Pick Random Decree above.",
      ],
    };
  }

  if (phase === "market" && isMyTurn && !isNpcPacing) {
    const boughtYet = (Number(viewer.marketBought) || 0) > 0 || Boolean(options.marketBoughtAny);
    if (!boughtYet && !dismissed.has("spring_market_buy")) {
      const suggestion = findTutorialMarketGoodSuggestion(gs, viewer);
      let adviceText =
        "Look at the Market Board for the most expensive good available in Abundant (>>) that you can afford (or the cheapest good you can afford if none in Abundant are affordable).";
      if (suggestion.mode === "abundant_most_expensive" && suggestion.item) {
        adviceText = `Tip: Consider buying the most expensive good currently in Abundant (>>) you can afford — e.g. ${suggestion.item.name} (${suggestion.item.track}) for ${suggestion.item.price}(d).`;
      } else if (suggestion.mode === "cheapest_affordable" && suggestion.item) {
        adviceText = `No Abundant (>>) goods fit your budget right now — buy the cheapest good you can afford instead, such as ${suggestion.item.name} (${suggestion.item.track}) for ${suggestion.item.price}(d).`;
      }
      return {
        id: "spring_market_buy",
        stepLabel: "Spring Guide • Step 3",
        title: "⚓ Ostia Market Phase",
        highlightSelector: "#ostia-market-board",
        paragraphs: [
          adviceText,
          "When you are done buying goods for your cart, click Pass Market Turn ⏭️ in the action banner above. (Note: you may need to click Pass multiple times if rivals buy more goods and bring the turn back around.)",
        ],
      };
    }
    if (!dismissed.has("spring_market_pass")) {
      return {
        id: "spring_market_pass",
        stepLabel: "Spring Guide • Passing in Market",
        title: "⏭️ Keep Clicking Pass When Done",
        highlightSelector: "#btn-market-pass",
        paragraphs: [
          "The Market Phase only ends once every merchant passes consecutively on their turns.",
          "You may need to pass multiple times in the Market Phase — keep clicking Pass Market Turn ⏭️ whenever the turn returns to you if you are done purchasing goods.",
        ],
      };
    }
  }

  if (phase === "delivery_entry" && isMyTurn && !isNpcPacing) {
    if (hasScoutedC3 && !dismissed.has("spring_entry_c3_explained")) {
      return {
        id: "spring_entry_c3_explained",
        stepLabel: "Spring Guide • Forum Explained",
        title: "🏛️ The 3 Forum Tiles (C3, D3, D4)",
        highlightSelector: '.rome-cell[data-coord="C3"]',
        paragraphs: [
          "You scouted C3! The central squares C3, D3, and D4 form the 3 Forum tiles — civic hubs in the heart of Rome where special market buys, high-value deliveries, and busy encounters cluster.",
          "Be sure to note what is available to Buy and Sell on the Forum tile you just peeked at so you can plan your route!",
        ],
      };
    }
    if (!viewer.scoutedThisTurn && !hasScoutedC3 && !dismissed.has("spring_entry_scout_c3")) {
      return {
        id: "spring_entry_scout_c3",
        stepLabel: "Spring Guide • Delivery Entry",
        title: "👁️ Scout C3 Before Entering Rome",
        highlightSelector: "#btn-entry-scout",
        paragraphs: [
          "Before entering Rome, use your free once-per-turn Scout! Click 👁️ Scout above (or right-click tile C3) and inspect C3 (The Forum).",
          "Scouting lets you preview unrevealed tile cargo & encounters safely before committing your cart.",
        ],
      };
    }
    if (!dismissed.has("spring_entry_enter_b1")) {
      return {
        id: "spring_entry_enter_b1",
        stepLabel: "Spring Guide • Choose Entry Gate",
        title: "🚪 Enter Rome at Gate B1",
        highlightSelector: '[data-gate-coord="B1"]',
        paragraphs: [
          "Now that you've finished scouting, enter Rome at Gate B1 (Via Flaminia / North-West Gate) by clicking 🚪 B1 in Cart Navigation or clicking B1 on the map!",
        ],
      };
    }
  }

  if (phase === "delivery" && isMyTurn && viewer.position && !dismissed.has("spring_delivery_scout_next")) {
    return {
      id: "spring_delivery_scout_next",
      stepLabel: "Spring Guide • Scouting Next Move",
      title: "🧭 Scout the Next Tile You Plan to Travel To",
      highlightSelector: "#btn-delivery-scout",
      paragraphs: [
        "Welcome inside Rome! Every hour you get a free 👁️ Scout action before or after moving.",
        "Before stepping onto an unrevealed tile, Scout the next tile you plan to travel to so you can spot dangerous Legiones/Nefarii or lucrative Buyers ahead of time.",
      ],
    };
  }

  return null;
}

function dismissTutorialStep(stepId) {
  if (!stepId) return;
  if (!appState.tutorialDismissedSteps) appState.tutorialDismissedSteps = new Set();
  appState.tutorialDismissedSteps.add(stepId);
  syncTutorialUiInDom();
}

function syncTutorialUiInDom() {
  if (typeof document === "undefined") return;
  document.querySelectorAll(".nm-tutorial-target-highlight").forEach((elNode) => {
    elNode.classList.remove("nm-tutorial-target-highlight");
  });
  const existing = document.getElementById("nm-tutorial-popup");
  if (existing && existing.parentNode) {
    existing.parentNode.removeChild(existing);
  }
  if (appState.activeTab !== "tabletop" || !appState.gameState || !isTutorialEnabled()) {
    return;
  }
  const gs = appState.gameState;
  const viewer = getViewerPlayer(gs);
  if (!viewer) return;
  const isNpcPacing = Boolean(
    appState.activeNpcEvent || (Array.isArray(appState.npcPacingQueue) && appState.npcPacingQueue.length > 0)
  );
  const step = computeActiveTutorialStep(gs, viewer, {
    enabled: true,
    dismissedSteps: appState.tutorialDismissedSteps,
    marketBoughtAny: Boolean(appState.tutorialMarketBoughtAny),
    lastScoutedCoord: appState.tutorialLastScoutedCoord || null,
    hasTransaction: Boolean(document.getElementById("tx-actions-box")) || hasViewerAvailableTransaction(gs, viewer),
    isNpcPacing,
  });
  if (!step) return;

  if (step.highlightSelector) {
    const targetEl = document.querySelector(step.highlightSelector);
    if (targetEl) {
      targetEl.classList.add("nm-tutorial-target-highlight");
    }
  }

  const offCheckbox = el("input", {
    type: "checkbox",
    id: "tutorial-disable-checkbox",
    checked: false,
    onChange: (e) => {
      if (e.target && e.target.checked) {
        setTutorialEnabledPreference(false);
      }
    },
  });

  const popup = el(
    "aside",
    {
      id: "nm-tutorial-popup",
      className: "nm-tutorial-popup",
      "data-tutorial-step": step.id,
      role: "dialog",
      "aria-label": step.title,
    },
    el(
      "div",
      { className: "nm-tutorial-head" },
      el("span", { className: "nm-tutorial-badge", text: step.stepLabel || "Spring Tutorial" }),
      el("button", {
        type: "button",
        className: "btn btn-sm",
        style: { padding: "0.08rem 0.38rem", minWidth: "unset" },
        title: "Dismiss this step",
        text: "✕",
        onClick: () => dismissTutorialStep(step.id),
      })
    ),
    el("h4", { className: "nm-tutorial-title", text: step.title }),
    el(
      "div",
      { className: "nm-tutorial-body" },
      ...step.paragraphs.map((p) =>
        p.startsWith("“")
          ? el("blockquote", { className: "nm-tutorial-quote", text: p })
          : el("p", { text: p })
      )
    ),
    el(
      "div",
      { className: "nm-tutorial-footer" },
      el(
        "label",
        { className: "nm-tutorial-disable-label" },
        offCheckbox,
        el("span", { text: "Turn off tutorial" })
      ),
      el("button", {
        type: "button",
        id: "btn-tutorial-got-it",
        className: "btn btn-sm btn-primary",
        text: "Got it →",
        onClick: () => dismissTutorialStep(step.id),
      })
    )
  );
  if (document.body) {
    document.body.appendChild(popup);
  }
}

if (typeof window !== "undefined") {
  window.NightMerchantTutorial = {
    computeActiveTutorialStep,
    findTutorialMarketGoodSuggestion,
    hasViewerAvailableTransaction,
    isTutorialEnabled,
    setTutorialEnabledPreference,
    dismissTutorialStep,
    syncTutorialUiInDom,
  };
}
