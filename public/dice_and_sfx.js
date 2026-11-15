// Night Merchant: 3D Dice Engine, WebAudio SFX, NPC Replay, Tab Alert, & Hover Tooltips (extracted from app.js)

/* =========================================================================
   3D DICE ROLL ANIMATION ENGINE (ADAPTED FROM GRAFT SURVIVAL MODE)
   ========================================================================= */

function toRomanDieSymbol(val) {
  if (typeof val === "string" && ["0", "I", "II", "III", "IV", "V", "VI"].includes(val)) {
    return val;
  }
  const n = Number(val);
  const map = {
    0: "0",
    1: "I",
    2: "II",
    3: "III",
    4: "IV",
    5: "V",
    6: "VI",
  };
  return map[n] !== undefined ? map[n] : String(val);
}

function resolveDieSymbolColor(colorName, rollerType) {
  if (rollerType === "npc" || colorName === "Black" || colorName === "NPC") {
    return "#111111";
  }
  return DIE_SYMBOL_COLORS[colorName] || "#c81e32";
}

function resolveDieSwatchColor(colorName, rollerType) {
  if (rollerType === "npc" || colorName === "Black" || colorName === "NPC") {
    return "#111111";
  }
  return DIE_SWATCH_COLORS[colorName] || "#d62839";
}

function clearDiceOverlayState() {
  if (appState.diceAnimTimer) {
    clearInterval(appState.diceAnimTimer);
    appState.diceAnimTimer = null;
  }
  appState.diceRollQueue = [];
  appState.activeDiceOverlay = null;
  appState.isDiceRolling = false;
  appState.diceTickCount = 0;
  const overlayRoot = document.getElementById("dice-overlay-root");
  if (overlayRoot) overlayRoot.replaceChildren();
}

const DICE_TOTAL_TICKS = 15;
const DICE_TARGET_RX = 1800 - 14; // 5 full X rotations settling at -14deg
const DICE_TARGET_RY = 2160 + 16; // 6 full Y rotations settling at +16deg

function enqueueNewDiceEvents(state) {
  if (!state || !Array.isArray(state.diceEvents)) return;
  if (appState.lastSeenDiceSeq === null) {
    appState.lastSeenDiceSeq = typeof state.lastDiceSeq === "number" ? state.lastDiceSeq : 0;
    return;
  }
  let added = false;
  for (const ev of state.diceEvents) {
    if (ev && typeof ev.seq === "number" && ev.seq > appState.lastSeenDiceSeq) {
      appState.lastSeenDiceSeq = ev.seq;
      appState.diceRollQueue.push(ev);
      added = true;
    }
  }
  if (added) {
    if (!appState.activeDiceOverlay || !appState.isDiceRolling) {
      startNextDiceRollAnimation(false);
    }
  } else if (appState.activeDiceOverlay && !appState.isDiceRolling) {
    refreshSettledDiceOutcomeCard();
  }
}

function computeCubeTransformForTick(isRolling, tickCount, dieIdx) {
  if (!isRolling) {
    return {
      cubeTransform: `translateY(0px) rotateX(${DICE_TARGET_RX}deg) rotateY(${DICE_TARGET_RY}deg) rotateZ(0deg) scale(1)`,
      shadowTransform: "scale(1)",
      shadowOpacity: "0.62",
    };
  }
  const progress = (tickCount + 1) / (DICE_TOTAL_TICKS + 1);
  const eased = 1 - Math.pow(1 - progress, 1.55);
  const startRxOffset = ((dieIdx + 1) * 67) % 160;
  const startRyOffset = ((dieIdx + 1) * 97) % 160;
  const rx = Math.round(eased * DICE_TARGET_RX + (1 - eased) * startRxOffset);
  const ry = Math.round(eased * DICE_TARGET_RY + (1 - eased) * startRyOffset);
  const rz = Math.round(Math.sin((tickCount + dieIdx) * 0.95) * 36 * (1 - eased));
  const bounce = Math.abs(Math.sin((tickCount + dieIdx) * 0.85)) * (1 - eased * 0.55);
  const liftY = -Math.round(bounce * 14);
  const scale = (1.0 + bounce * 0.12).toFixed(2);
  const shScale = (0.78 + (1 - bounce) * 0.22).toFixed(2);
  const shOpacity = (0.34 + (1 - bounce) * 0.28).toFixed(2);
  return {
    cubeTransform: `translateY(${liftY}px) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg) scale(${scale})`,
    shadowTransform: `scale(${shScale})`,
    shadowOpacity: shOpacity,
  };
}

function updateRollingDiceCubesInPlace() {
  const root = document.getElementById("dice-overlay-root");
  if (!root) return;
  const slots = root.querySelectorAll(".dice-unit-slot");
  slots.forEach((slot) => {
    const dieIdx = Number(slot.dataset.dieIdx) || 0;
    const cubeEl = slot.querySelector(".dice-cube-3d");
    const shadowEl = slot.querySelector(".dice-cube-shadow");
    const tf = computeCubeTransformForTick(true, appState.diceTickCount, dieIdx);
    if (cubeEl) cubeEl.style.transform = tf.cubeTransform;
    if (shadowEl) {
      shadowEl.style.transform = tf.shadowTransform;
      shadowEl.style.opacity = tf.shadowOpacity;
    }
  });
}

function settleDiceOverlayInPlace() {
  const root = document.getElementById("dice-overlay-root");
  const ev = appState.activeDiceOverlay;
  if (!root || !ev) return;

  const groups = Array.isArray(ev.groups) ? ev.groups : [];
  const trayNodes = root.querySelectorAll(".dice-group-tray");
  trayNodes.forEach((trayEl, gIdx) => {
    const grp = groups[gIdx];
    if (!grp) return;
    const totalLabel = grp.totalLabel || (grp.total !== undefined ? `Total: ${grp.total}` : "");
    const badgeEl = trayEl.querySelector(".dice-group-total-badge");
    if (badgeEl && totalLabel) {
      badgeEl.textContent = totalLabel;
    }
    const groupDice = Array.isArray(grp.dice) ? grp.dice : [];
    const slotNodes = trayEl.querySelectorAll(".dice-unit-slot");
    slotNodes.forEach((slotEl, dIdx) => {
      const die = groupDice[dIdx];
      if (!die) return;
      const dieIdx = Number(slotEl.dataset.dieIdx) || gIdx * 20 + dIdx;
      const tf = computeCubeTransformForTick(false, DICE_TOTAL_TICKS, dieIdx);
      const cubeEl = slotEl.querySelector(".dice-cube-3d");
      const shadowEl = slotEl.querySelector(".dice-cube-shadow");
      if (cubeEl) {
        cubeEl.classList.add("settled");
        cubeEl.style.transform = tf.cubeTransform;
      }
      if (shadowEl) {
        shadowEl.style.transform = tf.shadowTransform;
        shadowEl.style.opacity = tf.shadowOpacity;
      }
      const settledRoman = toRomanDieSymbol(die.roman !== undefined ? die.roman : die.value);
      const sign = typeof die.sign === "number" ? die.sign : 1;
      const modEl = slotEl.querySelector(".dice-unit-mod");
      if (modEl) {
        if (sign < 0) {
          modEl.textContent = `-${settledRoman} (${-Math.abs(Number(die.value) || 0)})`;
          modEl.className = "dice-unit-mod negative";
        } else if (sign === 0) {
          const isBlock = String(die.label || "").includes("Block");
          const bVal = Number(die.value) || 0;
          modEl.textContent = isBlock
            ? `🛡️ Block: ${settledRoman} (${bVal} Wnd${bVal === 1 ? "" : "s"})`
            : `Roll: ${settledRoman}`;
          modEl.className = "dice-unit-mod aux";
        } else {
          modEl.textContent = `+${settledRoman}`;
          modEl.className = "dice-unit-mod";
        }
      }
    });
  });

  refreshSettledDiceOutcomeCard();
}

function refreshSettledDiceOutcomeCard() {
  const root = document.getElementById("dice-overlay-root");
  const ev = appState.activeDiceOverlay;
  if (!root || !ev) return;
  const backdrop = root.querySelector(".dice-overlay-backdrop");
  if (!backdrop) return;
  const oldCard = backdrop.querySelector(".dice-outcome-card");
  const newCard = buildDiceOutcomeCard(ev, false);
  if (oldCard) {
    backdrop.replaceChild(newCard, oldCard);
  } else {
    backdrop.appendChild(newCard);
  }
}

function startNextDiceRollAnimation(forceAnimate = false) {
  if (appState.diceAnimTimer) {
    clearInterval(appState.diceAnimTimer);
    appState.diceAnimTimer = null;
  }
  if (appState.diceRollQueue.length === 0) {
    appState.activeDiceOverlay = null;
    appState.isDiceRolling = false;
    renderDiceOverlay();
    return;
  }

  const nextEv = appState.diceRollQueue.shift();
  const animatePref = !(appState.user && appState.user.settings && appState.user.settings.animateDice === false);
  if (!forceAnimate && !animatePref) {
    if (appState.diceRollQueue.length > 0) {
      startNextDiceRollAnimation(false);
      return;
    }
    if (buildDiceOverlayInteractiveControls()) {
      appState.activeDiceOverlay = nextEv;
      appState.isDiceRolling = false;
      appState.diceTickCount = DICE_TOTAL_TICKS;
      renderDiceOverlay();
      return;
    }
    appState.activeDiceOverlay = null;
    appState.isDiceRolling = false;
    renderDiceOverlay();
    if (appState.gameState) {
      checkPostActionModals(appState.gameState);
    }
    return;
  }

  playSfx("dice");
  appState.activeDiceOverlay = nextEv;
  appState.isDiceRolling = true;
  appState.diceTickCount = 0;
  renderDiceOverlay();

  appState.diceAnimTimer = setInterval(() => {
    appState.diceTickCount += 1;
    if (appState.diceTickCount >= DICE_TOTAL_TICKS) {
      clearInterval(appState.diceAnimTimer);
      appState.diceAnimTimer = null;
      appState.isDiceRolling = false;
      settleDiceOverlayInPlace();
    } else {
      updateRollingDiceCubesInPlace();
    }
  }, 85);
}

function dismissDiceOverlay() {
  if (appState.diceAnimTimer) {
    clearInterval(appState.diceAnimTimer);
    appState.diceAnimTimer = null;
  }
  appState.activeDiceOverlay = null;
  appState.isDiceRolling = false;
  if (appState.diceRollQueue.length > 0) {
    startNextDiceRollAnimation();
  } else {
    renderDiceOverlay();
    if (appState.gameState) {
      checkPostActionModals(appState.gameState);
    }
  }
}

function getSixFaceSymbolsForCube(settledRoman) {
  const baseFaces = [...ROME_DIE_ROMAN_FACES]; // ["0", "0", "I", "I", "II", "III"]
  const remaining = [...baseFaces];
  const matchIdx = remaining.indexOf(settledRoman);
  if (matchIdx !== -1) {
    remaining.splice(matchIdx, 1);
  } else {
    remaining.pop();
  }
  return {
    front: settledRoman,
    top: remaining[0] || "I",
    right: remaining[1] || "II",
    left: remaining[2] || "0",
    bottom: remaining[3] || "I",
    back: remaining[4] || "III",
  };
}

function build3DDieCube(die, group, dieIdx, isRolling, tickCount) {
  const settledRoman = toRomanDieSymbol(die.roman !== undefined ? die.roman : die.value);
  const symbolColor = resolveDieSymbolColor(die.color || group.colorName, group.rollerType);
  const faces = getSixFaceSymbolsForCube(settledRoman);
  const tf = computeCubeTransformForTick(isRolling, tickCount, dieIdx);

  const faceDefinitions = [
    { cls: "face-front", val: faces.front },
    { cls: "face-back", val: faces.back },
    { cls: "face-right", val: faces.right },
    { cls: "face-left", val: faces.left },
    { cls: "face-top", val: faces.top },
    { cls: "face-bottom", val: faces.bottom },
  ];

  const faceNodes = faceDefinitions.map((f) =>
    el(
      "div",
      { className: `dice-cube-face ${f.cls}` },
      el("span", { className: "dice-face-corner tl", style: { background: symbolColor } }),
      el("span", { className: "dice-face-corner tr", style: { background: symbolColor } }),
      el("span", { className: "dice-face-corner bl", style: { background: symbolColor } }),
      el("span", { className: "dice-face-corner br", style: { background: symbolColor } }),
      el("span", {
        className: "dice-face-roman",
        style: { color: symbolColor },
        text: f.val,
      })
    )
  );

  const sign = typeof die.sign === "number" ? die.sign : 1;
  let modText = "Rolling...";
  let modClass = "dice-unit-mod";
  if (!isRolling) {
    if (sign < 0) {
      modText = `-${settledRoman} (${-Math.abs(Number(die.value) || 0)})`;
      modClass = "dice-unit-mod negative";
    } else if (sign === 0) {
      const isBlock = String(die.label || "").includes("Block");
      const bVal = Number(die.value) || 0;
      modText = isBlock
        ? `🛡️ Block: ${settledRoman} (${bVal} Wnd${bVal === 1 ? "" : "s"})`
        : `Roll: ${settledRoman}`;
      modClass = "dice-unit-mod aux";
    } else {
      modText = `+${settledRoman}`;
    }
  }

  const clickMeta = die && die._overlayClickMeta ? die._overlayClickMeta : null;
  const slotClasses = ["dice-unit-slot"];
  if (!isRolling && clickMeta && clickMeta.clickable) {
    slotClasses.push("clickable-die");
    if (clickMeta.isArmed) slotClasses.push("armed-die");
  }

  return el(
    "div",
    {
      className: slotClasses.join(" "),
      "data-die-idx": String(dieIdx),
      title: !isRolling && clickMeta && clickMeta.title ? clickMeta.title : undefined,
      onClick:
        !isRolling && clickMeta && clickMeta.clickable && typeof clickMeta.onClick === "function"
          ? (e) => {
              e.stopPropagation();
              clickMeta.onClick();
            }
          : null,
    },
    el(
      "div",
      { className: "dice-cube-scene" },
      el("div", {
        className: "dice-cube-shadow",
        style: { transform: tf.shadowTransform, opacity: tf.shadowOpacity },
      }),
      el(
        "div",
        {
          className: `dice-cube-3d ${isRolling ? "" : "settled"}`,
          style: { transform: tf.cubeTransform },
        },
        ...faceNodes
      )
    ),
    el("div", { className: "dice-unit-label", title: die.label || "Die", text: die.label || "Die" }),
    el("div", { className: modClass, text: modText }),
    !isRolling && clickMeta && clickMeta.clickable && clickMeta.pillLabel
      ? el("div", { className: "die-click-action-pill", text: clickMeta.pillLabel })
      : null
  );
}

function buildFlatModifierSlot(mod, idx) {
  const val = Number(mod.value) || 0;
  if (mod.kind === "armor") {
    const armorTxt = mod.text || `Ignore ${val} Wound${val === 1 ? "" : "s"}`;
    return el(
      "div",
      { className: "dice-unit-slot dice-flat-mod-slot", "data-flat-idx": String(idx) },
      el(
        "div",
        {
          className: "dice-flat-mod-badge positive",
          style: { borderColor: "#facc15", background: "rgba(250, 204, 21, 0.16)" },
          title: `${mod.label || "Armor"}: ${armorTxt}`,
        },
        el("span", { className: "dice-flat-mod-value", style: { color: "#fef08a", fontSize: "0.78rem" }, text: `🛡️ -${val} Wnd` }),
        el("span", { className: "dice-flat-mod-sub", style: { color: "#fde047" }, text: "ARMOR" })
      ),
      el("div", {
        className: "dice-unit-label",
        title: mod.label || "Armor",
        text: mod.label || "Armor",
      }),
      el("div", {
        className: "dice-unit-mod aux",
        style: { color: "#fef08a" },
        text: armorTxt,
      })
    );
  }
  const isNeg = val < 0;
  const signStr = val > 0 ? `+${val}` : `${val}`;
  return el(
    "div",
    { className: "dice-unit-slot dice-flat-mod-slot", "data-flat-idx": String(idx) },
    el(
      "div",
      {
        className: `dice-flat-mod-badge ${isNeg ? "negative" : "positive"}`,
        title: `${mod.label || "Flat Modifier"}: ${signStr} CP`,
      },
      el("span", { className: "dice-flat-mod-value", text: `${signStr} CP` }),
      el("span", { className: "dice-flat-mod-sub", text: "FLAT MOD" })
    ),
    el("div", {
      className: "dice-unit-label",
      title: mod.label || "Modifier",
      text: mod.label || "Modifier",
    }),
    el("div", {
      className: `dice-unit-mod ${isNeg ? "negative" : ""}`,
      text: `${signStr} CP`,
    })
  );
}

function getDieClickMetaForOverlay(ev, _grp, gIdx, dIdx) {
  if (appState.isDiceRolling || appState.diceRollQueue.length > 0) return null;
  const gs = appState.gameState;
  if (!gs || !gs.pendingEncounter || !gs.players) return null;
  const pend = gs.pendingEncounter;
  const viewer = getViewerPlayer(gs);
  if (!viewer) return null;
  const isEncounterOwner = pend.playerIndex === viewer.index;
  const isIntervenor = pend.interveningPlayerIndex === viewer.index;
  if (!isEncounterOwner && !isIntervenor) return null;

  const stage = pend.stage || "pre_decision";
  const evKind = String((ev && ev.kind) || "");
  if (stage === "combat_pre_strike_post_roll" && evKind === "combat_pre_strike" && gIdx === 0) {
    const twistCard = (viewer.influence || []).find((c) => String(c.name || "") === "Twist Of Fate");
    if (!twistCard) return null;
    const isArmed = Boolean(appState.armedDieAction && appState.armedDieAction.cardId === twistCard.id);
    return {
      clickable: true,
      isArmed,
      pillLabel: isArmed ? "👆 Click to Re-Roll!" : "🔄 Click to Re-Roll",
      title: "Click this pre-strike die to play 'Twist Of Fate' and re-roll it!",
      onClick: () => handleDieSelectionClick(pend, viewer, "player", dIdx),
    };
  }
  if (stage === "combat_post_roll" && evKind === "combat") {
    const twistCard = (viewer.influence || []).find((c) => String(c.name || "") === "Twist Of Fate");
    if (!twistCard) return null;
    const side = gIdx === 0 ? "player" : "opponent";
    const isArmed = Boolean(appState.armedDieAction && appState.armedDieAction.mode === "reroll");
    return {
      clickable: true,
      isArmed,
      pillLabel: isArmed ? "👆 Click to Re-Roll!" : "🔄 Click to Re-Roll",
      title: "Click this die to play 'Twist Of Fate' and re-roll it!",
      onClick: () => handleDieSelectionClick(pend, viewer, side, dIdx),
    };
  }
  if (stage === "gamble_post_roll" && evKind === "gamble") {
    const twistCard = (viewer.influence || []).find((c) => String(c.name || "") === "Twist Of Fate");
    if (!twistCard) return null;
    const isArmed = Boolean(appState.armedDieAction && appState.armedDieAction.mode === "reroll");
    return {
      clickable: true,
      isArmed,
      pillLabel: isArmed ? "👆 Click to Re-Roll!" : "🔄 Click to Re-Roll",
      title: "Click this die to play 'Twist Of Fate' and re-roll it!",
      onClick: () => handleDieSelectionClick(pend, viewer, "player", dIdx),
    };
  }
  if (stage === "demand_post_roll" && evKind === "demand") {
    const twistCard = (viewer.influence || []).find((c) => String(c.name || "") === "Twist Of Fate");
    if (!twistCard) return null;
    const isArmed = Boolean(appState.armedDieAction && appState.armedDieAction.mode === "reroll");
    return {
      clickable: true,
      isArmed,
      pillLabel: isArmed ? "👆 Click to Re-Roll!" : "🔄 Click to Re-Roll",
      title: "Click this die to play 'Twist Of Fate' and force a re-roll!",
      onClick: () => handleDieSelectionClick(pend, viewer, "player", 0),
    };
  }
  if ((stage === "driver_fate_post_roll" || stage === "chart_post_roll") && (evKind === "driver_fate" || evKind === "table_encounter")) {
    const cType = pend.chartType || "death";
    const twistCard = (viewer.influence || []).find((c) => String(c.name || "") === "Twist Of Fate");
    const luckyCard =
      cType !== "soothsayer"
        ? (viewer.influence || []).find((c) => String(c.name || "") === "Lucky Break")
        : null;
    if (!twistCard && !luckyCard) return null;
    const armed = appState.armedDieAction;
    let pillLabel = "👆 Click Die to Modify";
    if (armed && armed.mode === "reroll") pillLabel = "👆 Click to Re-Roll!";
    else if (armed && armed.mode === "plus_one") pillLabel = "👆 Click for +1!";
    else if (twistCard && !luckyCard) pillLabel = "🔄 Click to Re-Roll";
    else if (luckyCard && !twistCard) pillLabel = "🍀 Click for +1";
    return {
      clickable: true,
      isArmed: Boolean(armed),
      pillLabel,
      title: "Click this die to re-roll or modify it with your Influence card!",
      onClick: () => handleDieSelectionClick(pend, viewer, "player", 0),
    };
  }
  return null;
}

function buildArmedDieBannerNode() {
  const armed = appState.armedDieAction;
  if (!armed) return null;
  return el(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.55rem",
        flexWrap: "wrap",
        padding: "0.4rem 0.7rem",
        borderRadius: "6px",
        background: "rgba(250, 204, 21, 0.2)",
        border: "1px solid #fde047",
        color: "#fef9c3",
        fontSize: "0.8rem",
        fontWeight: "700",
      },
    },
    el("span", {
      text:
        armed.mode === "plus_one"
          ? `👆 Click directly on the die you want to increase (+1) with '${armed.cardName}'!`
          : `👆 Click directly on the die you want to re-roll with '${armed.cardName}'!`,
    }),
    el("button", {
      type: "button",
      className: "btn btn-sm",
      style: { padding: "0.15rem 0.5rem", fontSize: "0.72rem" },
      text: "Cancel",
      onClick: () => {
        appState.armedDieAction = null;
        renderDiceOverlay();
        renderApp();
      },
    })
  );
}

function buildDiceOverlayInteractiveControls() {
  const gs = appState.gameState;
  if (!gs || !gs.pendingEncounter || !gs.players) return null;
  const pend = gs.pendingEncounter;
  const viewer = getViewerPlayer(gs);
  if (!viewer) return null;
  const isEncounterOwner = pend.playerIndex === viewer.index;
  const isIntervenor = pend.interveningPlayerIndex === viewer.index;
  if (!isEncounterOwner && !isIntervenor) return null;

  const encPlayer = gs.players[pend.playerIndex] || viewer;
  const isOtherPlayerEncounter = !isEncounterOwner;
  const oppName = (pend.card && pend.card.name) || "Opponent";
  const singleReroll = getEligibleRerollTargets(pend).length === 1;

  const stage = pend.stage || "pre_decision";
  if (stage === "combat_pre_strike_post_roll") {
    const isPvp = Boolean(pend.isPvp);
    const strikerName = pend.pvpStrikerName || encPlayer.name;
    const targetName = pend.pvpTargetName || oppName;
    const rawW = Number(pend.strikeWounds) || 0;
    const ignW = Number(pend.ignoreWounds) || 0;
    const netW = Number(pend.netWoundsAfterArmor) || 0;
    const twistCards = (viewer.influence || []).filter((c) => String(c.name || "") === "Twist Of Fate");
    const firstTwist = twistCards[0] || null;
    const isArmed = Boolean(firstTwist && appState.armedDieAction && appState.armedDieAction.cardId === firstTwist.id);

    let targetGuardCount = 0;
    if (isPvp && pend.pvpTargetIndex != null) {
      const targetPl =
        (gs.players || []).find((p) => p.index === pend.pvpTargetIndex) || (gs.players || [])[pend.pvpTargetIndex];
      targetGuardCount = targetPl && Array.isArray(targetPl.guards) ? targetPl.guards.length : 0;
    }

    let summaryBanner = "";
    let confirmBtnText = "⚔️ Confirm Pre-Roll Strike & Roll Main Combat";
    if (isPvp) {
      const killsDriver = netW > targetGuardCount;
      summaryBanner = `${strikerName} Pre-Roll Strike vs. ${targetName}: ${rawW} Wnd (${ignW} blocked) -> ${netW} Unblocked`;
      if (isOtherPlayerEncounter && viewer.index !== pend.pvpTargetIndex && viewer.index !== pend.pvpStrikerIndex) {
        confirmBtnText = "✅ Pass Intervention / Confirm Pre-Roll Strike";
      } else if (netW <= 0) {
        confirmBtnText = "🛡️ Confirm Strike Blocked & Roll Main Combat";
      } else if (killsDriver) {
        confirmBtnText = `💀 Confirm ${netW} Pre-Roll Wnd(s) -> ${targetName}'s Driver Fate!`;
      } else {
        confirmBtnText = `🛡️ Confirm ${netW} Guard Casualty & Roll Main Combat`;
      }
    } else {
      const defeatsNpc = Boolean(pend.preStrikeDefeatsNpc);
      const capMode = pend.preStrikeCapacityMode === "x" ? "X" : "(R)";
      const capVal = Number(pend.preStrikeCapacity) || 0;
      summaryBanner = `${strikerName} Pre-Roll Strike vs. ${targetName}: ${netW} Wnd vs. ${capVal} ${capMode}`;
      if (isOtherPlayerEncounter) {
        confirmBtnText = "✅ Pass Intervention / Confirm Pre-Roll Strike";
      } else if (defeatsNpc) {
        confirmBtnText = `🏆 Confirm Pre-Roll Strike Defeats ${targetName}!`;
      } else {
        confirmBtnText =
          netW > 0
            ? `⚔️ Confirm -${Math.min(capVal, netW)} Enemy ${capMode} & Roll Main Combat`
            : "⚔️ Confirm Miss & Roll Main Combat";
      }
    }

    const headerPrompt =
      twistCards.length > 0
        ? isOtherPlayerEncounter
          ? `⚡ Pre-Roll Intervention Window (${summaryBanner}): Only 'Twist Of Fate' may re-roll pre-strike dice, or pass!`
          : `🏹 Pre-Roll Strike Window (${summaryBanner}): Only 'Twist Of Fate' may re-roll these dice before combat continues!`
        : `${summaryBanner} — Click below to continue.`;

    return el(
      "div",
      { className: "dice-post-roll-box" },
      isOtherPlayerEncounter && !isPvp ? renderOpponentPublicCartSummaryNode(gs, encPlayer, viewer, "dark") : null,
      el("div", {
        style: { fontSize: "0.8rem", fontWeight: "700", color: "#fde68a" },
        text: headerPrompt,
      }),
      buildArmedDieBannerNode(),
      firstTwist
        ? el(
            "div",
            { style: { display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "center" } },
            el("button", {
              className: `btn btn-sm ${isArmed ? "btn-crimson" : "btn-primary"}`,
              text: singleReroll
                ? "🎲 Twist Of Fate — Re-Roll Die"
                : isArmed
                ? "👆 Click Any Die Above to Re-Roll (Twist Of Fate Armed)"
                : "🎲 Twist Of Fate — Click a Die Above to Re-Roll",
              onClick: () => triggerTwistOfFateOrArm(gs, firstTwist),
            })
          )
        : null,
      el("button", {
        className: `btn btn-sm ${pend.preStrikeDefeatsNpc ? "btn-primary" : "btn-crimson"}`,
        text: confirmBtnText,
        onClick: async () => {
          if (appState.diceRollQueue.length === 0) {
            dismissDiceOverlay();
          }
          await sendGameAction({ type: "resolve_encounter", decision: "finalize_pre_strike" });
        },
      })
    );
  }
  if (stage === "combat_post_roll") {
    const pCP = Number(pend.playerCP) || 0;
    const oCP = Number(pend.oppCP) || 0;
    const isPvp = Boolean(pend.isPvp);
    const isVictory = pCP > oCP;
    const isTie = pCP === oCP;
    const defPlayer =
      isPvp && pend.pvpDefenderIndex != null
        ? (gs.players || []).find((p) => p.index === pend.pvpDefenderIndex) || (gs.players || [])[pend.pvpDefenderIndex]
        : null;
    const losingPlayer = isPvp && isVictory ? defPlayer : encPlayer;
    const rawWounds = isVictory ? (isPvp ? pCP - oCP : 0) : isTie ? 0 : oCP - pCP;
    const ignoreWounds = isPvp && isVictory ? Number(pend.oppIgnoreWounds) || 0 : Number(pend.ignoreWounds) || 0;
    const netWounds = Math.max(0, rawWounds - ignoreWounds);
    const losingGuardsCount = isPvp && isVictory
      ? Array.isArray(pend.oppGuardNames)
        ? pend.oppGuardNames.length
        : ((losingPlayer && losingPlayer.guards) || []).length
      : (encPlayer.guards || []).length;
    const survivesByArmorOrGuard = !isTie && rawWounds > 0 && netWounds <= losingGuardsCount;
    const postCards = (viewer.influence || []).filter((c) => {
      const nm = String(c.name || "");
      return (
        nm === "Gladiator's Intervention" ||
        nm === "Flying Chamber Pot" ||
        nm === "Twist Of Fate"
      );
    });
    const cardButtons = [];
    let addedTwistBtn = false;
    postCards.forEach((rc) => {
      const nm = String(rc.name || "");
      if (nm === "Twist Of Fate") {
        if (addedTwistBtn) return;
        addedTwistBtn = true;
        const isArmed = Boolean(appState.armedDieAction && appState.armedDieAction.cardId === rc.id);
        cardButtons.push(
          el("button", {
            className: `btn btn-sm ${isArmed ? "btn-crimson" : "btn-primary"}`,
            text: singleReroll
              ? "🎲 Twist Of Fate — Re-Roll Die"
              : isArmed
              ? "👆 Click Any Die Above to Re-Roll (Twist Of Fate Armed)"
              : "🎲 Twist Of Fate — Click a Die Above to Re-Roll",
            onClick: () => {
              triggerTwistOfFateOrArm(gs, rc);
            },
          })
        );
      } else {
        const effShort =
          nm === "Mercenary Ambush"
            ? "+2(R)"
            : nm === "Gladiator's Intervention"
            ? "+1(R)"
            : "+1 CP";
        cardButtons.push(
          el(
            "div",
            { style: { display: "flex", gap: "0.3rem", flexWrap: "wrap", justifyContent: "center" } },
            el("button", {
              className: "btn btn-sm btn-primary",
              text: `🃏 ${nm} (${effShort} → ${isOtherPlayerEncounter || isPvp ? encPlayer.name : "You"})`,
              onClick: () => sendGameAction({ type: "play_influence", cardId: rc.id, targetSide: "player" }),
            }),
            el("button", {
              className: "btn btn-sm",
              text: `🎯 ${nm} (${effShort} → ${oppName})`,
              onClick: () => sendGameAction({ type: "play_influence", cardId: rc.id, targetSide: "opponent" }),
            })
          )
        );
      }
    });

    const headerPrompt =
      postCards.length > 0
        ? isOtherPlayerEncounter
          ? `⚡ Intervention Window on ${isPvp ? `${encPlayer.name} vs. ${oppName}` : `${encPlayer.name}'s Combat`} (${pCP} CP vs. ${oCP} CP): Click a die to re-roll, play a card, or pass!`
          : `🃏 Post-Roll Influence Available (${pCP} CP vs. ${oCP} CP): Click a die to re-roll, play a card, or confirm the combat result!`
        : `Combat Total: ${pCP} CP vs. ${oCP} CP — Click below to confirm result.`;

    let confirmBtnText = "✅ Confirm Combat Victory";
    if (isOtherPlayerEncounter && !(isPvp && viewer.index === pend.pvpDefenderIndex)) {
      confirmBtnText = "✅ Pass Intervention / Confirm Combat Result";
    } else if (isTie) {
      confirmBtnText = isPvp ? "✅ Confirm PvP Tie (No Wounds, No Spoils)" : "✅ Confirm Combat Tie (Survive, No Bonus)";
    } else if (isPvp) {
      if (isVictory) {
        confirmBtnText = survivesByArmorOrGuard
          ? `✅ Confirm PvP Win (${oppName} Survived — No Spoils)`
          : `⚔️ Confirm PvP Win & ${oppName}'s Fate Roll!`;
      } else {
        confirmBtnText = survivesByArmorOrGuard
          ? "🛡️ Confirm PvP Loss (Survived — Turn Ends)"
          : `💀 Confirm PvP Loss & ${encPlayer.name}'s Fate Roll`;
      }
    } else if (!isVictory) {
      confirmBtnText = survivesByArmorOrGuard
        ? "🛡️ Confirm Survival (No Roll on Defeat Chart)"
        : "✅ Confirm Combat Result & Roll Defeat Chart";
    }

    return el(
      "div",
      { className: "dice-post-roll-box" },
      isOtherPlayerEncounter && !isPvp ? renderOpponentPublicCartSummaryNode(gs, encPlayer, viewer, "dark") : null,
      el("div", {
        style: { fontSize: "0.8rem", fontWeight: "700", color: "#fde68a" },
        text: headerPrompt,
      }),
      buildArmedDieBannerNode(),
      cardButtons.length > 0
        ? el("div", { style: { display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "center" } }, ...cardButtons)
        : null,
      el("button", {
        className: isVictory || isTie || survivesByArmorOrGuard ? "btn btn-sm btn-primary" : "btn btn-sm btn-crimson",
        text: confirmBtnText,
        onClick: async () => {
          if (appState.diceRollQueue.length === 0) {
            dismissDiceOverlay();
          }
          await sendGameAction({ type: "resolve_encounter", decision: "finalize_combat" });
        },
      })
    );
  }

  if (stage === "driver_fate_pre_roll") {
    return el(
      "div",
      { className: "dice-post-roll-box", style: { borderColor: "#ef4444", background: "rgba(220, 38, 38, 0.18)" } },
      el("div", {
        style: { fontSize: "0.84rem", fontWeight: "700", color: "#fecaca" },
        text: pend.isPvp
          ? `💀 PvP Combat Defeat (${pend.pvpLoserName || encPlayer.name} Wounded)! Roll 1(R) on the Driver Fate Chart (${pend.pvpWinnerName || "Winner"} claims Spoils):`
          : "💀 Your Driver Suffered an Unblocked Wound! Roll 1(R) on the Driver Fate (Death) Chart:",
      }),
      el("button", {
        className: "btn btn-crimson",
        text: "🎲 Roll Driver Fate Die (1(R))",
        onClick: () => sendGameAction({ type: "resolve_encounter", decision: "roll_driver_fate" }),
      })
    );
  }

  if (stage === "driver_fate_post_roll" || stage === "chart_post_roll") {
    const cType = pend.chartType || "death";
    const postChartCards = (viewer.influence || []).filter((c) => {
      const nm = String(c.name || "");
      if (nm === "Twist Of Fate") return true;
      if (nm === "Lucky Break" && cType !== "soothsayer") return true;
      if (!isOtherPlayerEncounter && cType === "mob" && nm === "Man Of The People") return true;
      if (!isOtherPlayerEncounter && cType === "theater" && nm === "Dramaturge") return true;
      return false;
    });
    return el(
      "div",
      { className: "dice-post-roll-box" },
      isOtherPlayerEncounter ? renderOpponentPublicCartSummaryNode(gs, encPlayer, viewer, "dark") : null,
      el("div", {
        style: { fontSize: "0.8rem", fontWeight: "700", color: "#fde68a" },
        text:
          postChartCards.length > 0
            ? isOtherPlayerEncounter
              ? `⚡ Intervention Window on ${encPlayer.name}'s ${cType === "soothsayer" ? "Soothsayer" : pend.isPvp ? `Driver Fate (PvP Spoils → ${pend.pvpWinnerName || "Winner"})` : "Chart"} Roll: Click the die above to modify/re-roll, or pass!`
              : `🃏 Post-Roll Influence Available${pend.isPvp ? ` (PvP Spoils → ${pend.pvpWinnerName || "Winner"})` : ""}: Click the die above to modify/re-roll, or confirm outcome!`
            : `Confirm Roll Outcome:`,
      }),
      buildArmedDieBannerNode(),
      postChartCards.length > 0
        ? el(
            "div",
            { style: { display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "center" } },
            ...postChartCards.map((rc) => {
              if (rc.name === "Lucky Break") {
                const isArmed = Boolean(appState.armedDieAction && appState.armedDieAction.cardId === rc.id);
                return el("button", {
                  className: `btn btn-sm ${isArmed ? "btn-crimson" : "btn-primary"}`,
                  text: isArmed ? "👆 Click Die Above for +1 (Lucky Break Armed)" : "🍀 Lucky Break (+1) — Click Die Above",
                  onClick: () => armDieCardAction(rc, "plus_one"),
                });
              }
              if (rc.name === "Twist Of Fate") {
                const isArmed = Boolean(appState.armedDieAction && appState.armedDieAction.cardId === rc.id);
                return el("button", {
                  className: `btn btn-sm ${isArmed ? "btn-crimson" : "btn-primary"}`,
                  text: singleReroll
                    ? "🎲 Twist Of Fate — Re-Roll Die"
                    : isArmed
                    ? "👆 Click Die Above to Re-Roll (Twist Of Fate Armed)"
                    : "🎲 Twist Of Fate — Click Die Above to Re-Roll",
                  onClick: () => triggerTwistOfFateOrArm(gs, rc),
                });
              }
              return el("button", {
                className: "btn btn-sm btn-primary",
                text: `✨ Play ${rc.name} (Treat as III)`,
                onClick: () => sendGameAction({ type: "play_influence", cardId: rc.id }),
              });
            })
          )
        : null,
      el("button", {
        className: "btn btn-sm btn-primary",
        text: isOtherPlayerEncounter ? "✅ Pass Intervention / Confirm Roll Outcome" : "✅ Confirm Roll Outcome",
        onClick: async () => {
          if (appState.diceRollQueue.length === 0) {
            dismissDiceOverlay();
          }
          await sendGameAction({
            type: "resolve_encounter",
            decision: stage === "driver_fate_post_roll" ? "finalize_driver_fate" : "finalize_chart_roll",
          });
        },
      })
    );
  }

  if (stage === "demand_post_roll" || stage === "gamble_post_roll") {
    const twistCards = (viewer.influence || []).filter((c) => String(c.name || "") === "Twist Of Fate");
    const firstTwist = twistCards[0] || null;
    const isArmed = Boolean(firstTwist && appState.armedDieAction && appState.armedDieAction.cardId === firstTwist.id);

    const rollDesc =
      stage === "demand_post_roll" ? `${oppName} Demand Roll` : `Stadium Gambling Roll (${pend.cell || "Rome"})`;

    return el(
      "div",
      { className: "dice-post-roll-box" },
      isOtherPlayerEncounter ? renderOpponentPublicCartSummaryNode(gs, encPlayer, viewer, "dark") : null,
      el("div", {
        style: { fontSize: "0.8rem", fontWeight: "700", color: "#fde68a" },
        text:
          twistCards.length > 0
            ? isOtherPlayerEncounter
              ? `⚡ Intervention Window on ${encPlayer.name}'s ${rollDesc}: ${singleReroll ? "Re-roll with Twist Of Fate, or pass!" : "Click the die you want to re-roll with Twist Of Fate, or pass!"}`
              : `🃏 Twist Of Fate Available on Your ${rollDesc}: ${singleReroll ? "Re-roll with Twist Of Fate, or confirm outcome!" : "Click the die you want to re-roll, or confirm outcome!"}`
            : `Confirm ${rollDesc} Outcome:`,
      }),
      buildArmedDieBannerNode(),
      firstTwist
        ? el(
            "div",
            { style: { display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "center" } },
            el("button", {
              className: `btn btn-sm ${isArmed ? "btn-crimson" : "btn-primary"}`,
              text: singleReroll
                ? "🎲 Twist Of Fate — Re-Roll Die"
                : isArmed
                ? "👆 Click Any Die Above to Re-Roll (Twist Of Fate Armed)"
                : "🎲 Twist Of Fate — Click a Die Above to Re-Roll",
              onClick: () => triggerTwistOfFateOrArm(gs, firstTwist),
            })
          )
        : null,
      el("button", {
        className: "btn btn-sm btn-primary",
        text: isOtherPlayerEncounter ? "✅ Pass Intervention / Confirm Roll Outcome" : "✅ Confirm Roll Outcome",
        onClick: async () => {
          if (appState.diceRollQueue.length === 0) {
            dismissDiceOverlay();
          }
          await sendGameAction({
            type: "resolve_encounter",
            decision: stage === "demand_post_roll" ? "finalize_demand_roll" : "finalize_gamble_roll",
          });
        },
      })
    );
  }

  return null;
}

function buildDiceOutcomeCard(ev, isRolling) {
  const groups = Array.isArray(ev.groups) ? ev.groups : [];
  const queueRemaining = appState.diceRollQueue.length;
  const interactiveControls = !isRolling && queueRemaining === 0 ? buildDiceOverlayInteractiveControls() : null;
  const detailText = ev.outcomeDetail || ev.outcomeMessage;

  return el(
    "div",
    { className: "dice-outcome-card" },
    el("div", {
      className: "dice-outcome-title",
      text: isRolling ? "🎲 Rolling the Roman Bones of Fate..." : ev.outcomeTitle || "Roll Complete",
    }),
    !isRolling && detailText
      ? el("div", { className: "dice-outcome-detail", text: detailText })
      : isRolling
      ? el("div", {
          className: "dice-outcome-detail",
          style: { color: "#d4af37", fontStyle: "italic" },
          text:
            groups.length > 1
              ? "All combat dice for both sides are tumbling simultaneously..."
              : "6-sided Roman numeral dice (0, I, II, III) in motion...",
        })
      : null,
    interactiveControls,
    !isRolling
      ? el(
          "div",
          { className: "dice-outcome-actions" },
          el("button", {
            className: "dice-continue-btn",
            text: queueRemaining > 0 ? `NEXT ROLL (${queueRemaining}) ▶` : "CLOSE DICE OVERLAY",
            onClick: async () => {
              const pend = appState.gameState?.pendingEncounter;
              dismissDiceOverlay();
              if (queueRemaining === 0 && pend && pend.interveningPlayerIndex == null) {
                if (pend.stage === "combat_post_roll") {
                  await sendGameAction({ type: "resolve_encounter", decision: "finalize_combat" });
                } else if (pend.stage === "combat_pre_strike_post_roll") {
                  await sendGameAction({ type: "resolve_encounter", decision: "finalize_pre_strike" });
                }
              }
            },
          })
        )
      : null
  );
}

function renderDiceOverlay() {
  const root = document.getElementById("dice-overlay-root");
  if (!root) return;

  const ev = appState.activeDiceOverlay;
  if (!ev) {
    root.replaceChildren();
    return;
  }

  const isRolling = appState.isDiceRolling;
  const tickCount = appState.diceTickCount;
  const groups = Array.isArray(ev.groups) ? ev.groups : [];

  const stageItems = [];
  groups.forEach((grp, gIdx) => {
    if (gIdx > 0) {
      stageItems.push(
        el(
          "div",
          { className: "dice-vs-divider" },
          el("span", { text: "⚔️" }),
          el("span", { text: "VS" }),
          el("span", { text: "⚔️" })
        )
      );
    }

    const swatchColor = resolveDieSwatchColor(grp.colorName, grp.rollerType);
    const groupDice = Array.isArray(grp.dice) ? grp.dice : [];
    const cubeNodes = groupDice.map((d, dIdx) => {
      const dCopy = Object.assign({}, d, {
        _overlayClickMeta: getDieClickMetaForOverlay(ev, grp, gIdx, dIdx),
      });
      return build3DDieCube(dCopy, grp, gIdx * 20 + dIdx, isRolling, tickCount);
    });
    const groupFlatMods = Array.isArray(grp.flatModifiers) ? grp.flatModifiers : [];
    const flatModNodes = groupFlatMods.map((fm, fmIdx) => buildFlatModifierSlot(fm, fmIdx));

    const totalLabel = isRolling
      ? "Rolling..."
      : grp.totalLabel || (grp.total !== undefined ? `Total: ${grp.total}` : "");

    stageItems.push(
      el(
        "div",
        { className: "dice-group-tray" },
        el(
          "div",
          { className: "dice-group-header" },
          el(
            "div",
            { className: "dice-group-roller" },
            el("span", {
              className: "dice-group-swatch",
              style: { background: swatchColor },
            }),
            el("span", { text: grp.rollerName || "Roller" }),
            el("span", {
              style: { fontSize: "0.72rem", color: "#c4b89b", fontWeight: "600" },
              text: grp.rollerType === "npc" ? "(NPC • Black Symbols)" : `(${grp.colorName || "Player"} Symbols)`,
            })
          ),
          totalLabel ? el("span", { className: "dice-group-total-badge", text: totalLabel }) : null
        ),
        el("div", { className: "dice-cubes-grid" }, ...cubeNodes, ...flatModNodes)
      )
    );
  });

  const headerNode = el(
    "div",
    { className: "dice-overlay-header" },
    el("div", { className: "dice-overlay-title", text: ev.title || "Roman Dice Roll" }),
    ev.subtitle ? el("div", { className: "dice-overlay-subtitle", text: ev.subtitle }) : null
  );
  const stageNode = el("div", { className: "dice-stage-container" }, ...stageItems);
  const bottomCard = buildDiceOutcomeCard(ev, isRolling);

  // Reuse existing backdrop element if already mounted so the background never flashes or re-fades!
  const existingBackdrop = root.querySelector(".dice-overlay-backdrop");
  if (existingBackdrop) {
    existingBackdrop.replaceChildren(headerNode, stageNode, bottomCard);
    return;
  }

  const backdrop = el(
    "div",
    {
      className: "dice-overlay-backdrop",
      onClick: (e) => {
        if (e.target === backdrop && !appState.isDiceRolling) {
          dismissDiceOverlay();
        }
      },
    },
    headerNode,
    stageNode,
    bottomCard
  );

  root.replaceChildren(backdrop);
}

/* =========================================================================
   v2.0: WEBAUDIO SOUND EFFECTS, TAB-TITLE TURN ALERT, NPC PACING, & HOTKEYS
   ========================================================================= */

let _nmAudioCtx = null;

function isSoundEffectsEnabled() {
  return !(appState.user && appState.user.settings && appState.user.settings.soundEffects === false);
}

function playSfx(kind) {
  if (!isSoundEffectsEnabled()) return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  try {
    if (!_nmAudioCtx) {
      _nmAudioCtx = new AudioCtx();
    }
    if (_nmAudioCtx.state === "suspended") {
      _nmAudioCtx.resume().catch(() => {});
    }
    const now = _nmAudioCtx.currentTime;
    if (kind === "dice") {
      [0, 0.055, 0.115].forEach((offset, idx) => {
        const osc = _nmAudioCtx.createOscillator();
        const gain = _nmAudioCtx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(210 + idx * 55, now + offset);
        osc.frequency.exponentialRampToValueAtTime(110, now + offset + 0.045);
        gain.gain.setValueAtTime(0.06, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.048);
        osc.connect(gain);
        gain.connect(_nmAudioCtx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.05);
      });
    } else if (kind === "cart_move") {
      [0, 0.09, 0.185].forEach((offset, idx) => {
        const osc = _nmAudioCtx.createOscillator();
        const gain = _nmAudioCtx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(148 - idx * 14, now + offset);
        osc.frequency.exponentialRampToValueAtTime(76, now + offset + 0.065);
        gain.gain.setValueAtTime(0.05, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.07);
        osc.connect(gain);
        gain.connect(_nmAudioCtx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + 0.075);
      });
    } else if (kind === "coin" || kind === "sell") {
      [987.77, 1318.51, 1567.98].forEach((freq, idx) => {
        const osc = _nmAudioCtx.createOscillator();
        const gain = _nmAudioCtx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now + idx * 0.055);
        gain.gain.setValueAtTime(0.052, now + idx * 0.055);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.055 + 0.16);
        osc.connect(gain);
        gain.connect(_nmAudioCtx.destination);
        osc.start(now + idx * 0.055);
        osc.stop(now + idx * 0.055 + 0.17);
      });
    } else if (kind === "buy") {
      [1046.5, 783.99].forEach((freq, idx) => {
        const osc = _nmAudioCtx.createOscillator();
        const gain = _nmAudioCtx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, now + idx * 0.065);
        gain.gain.setValueAtTime(0.05, now + idx * 0.065);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.065 + 0.14);
        osc.connect(gain);
        gain.connect(_nmAudioCtx.destination);
        osc.start(now + idx * 0.065);
        osc.stop(now + idx * 0.065 + 0.15);
      });
    } else if (kind === "combat_win") {
      [523.25, 659.25, 783.99].forEach((freq, idx) => {
        const osc = _nmAudioCtx.createOscillator();
        const gain = _nmAudioCtx.createGain();
        osc.type = idx === 0 ? "sawtooth" : "triangle";
        osc.frequency.setValueAtTime(freq, now + idx * 0.06);
        gain.gain.setValueAtTime(0.048, now + idx * 0.06);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.18);
        osc.connect(gain);
        gain.connect(_nmAudioCtx.destination);
        osc.start(now + idx * 0.06);
        osc.stop(now + idx * 0.06 + 0.19);
      });
    } else if (kind === "combat" || kind === "combat_loss") {
      [280, 165].forEach((freq, idx) => {
        const osc = _nmAudioCtx.createOscillator();
        const gain = _nmAudioCtx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(freq, now + idx * 0.075);
        osc.frequency.exponentialRampToValueAtTime(98, now + idx * 0.075 + 0.14);
        gain.gain.setValueAtTime(0.046, now + idx * 0.075);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.075 + 0.15);
        osc.connect(gain);
        gain.connect(_nmAudioCtx.destination);
        osc.start(now + idx * 0.075);
        osc.stop(now + idx * 0.075 + 0.16);
      });
    } else if (kind === "mission") {
      [587.33, 739.99, 880, 1174.66].forEach((freq, idx) => {
        const osc = _nmAudioCtx.createOscillator();
        const gain = _nmAudioCtx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now + idx * 0.055);
        gain.gain.setValueAtTime(0.048, now + idx * 0.055);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.055 + 0.18);
        osc.connect(gain);
        gain.connect(_nmAudioCtx.destination);
        osc.start(now + idx * 0.055);
        osc.stop(now + idx * 0.055 + 0.19);
      });
    } else if (kind === "encounter") {
      [329.63, 440].forEach((freq, idx) => {
        const osc = _nmAudioCtx.createOscillator();
        const gain = _nmAudioCtx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, now + idx * 0.07);
        gain.gain.setValueAtTime(0.042, now + idx * 0.07);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.15);
        osc.connect(gain);
        gain.connect(_nmAudioCtx.destination);
        osc.start(now + idx * 0.07);
        osc.stop(now + idx * 0.07 + 0.16);
      });
    } else if (kind === "turn") {
      [440, 554.37, 659.25].forEach((freq, idx) => {
        const osc = _nmAudioCtx.createOscillator();
        const gain = _nmAudioCtx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, now + idx * 0.075);
        gain.gain.setValueAtTime(0.05, now + idx * 0.075);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.075 + 0.18);
        osc.connect(gain);
        gain.connect(_nmAudioCtx.destination);
        osc.start(now + idx * 0.075);
        osc.stop(now + idx * 0.075 + 0.19);
      });
    }
  } catch (_err) {
    // Ignore WebAudio autoplay errors gracefully
  }
}

function playSfxForNpcEvent(ev) {
  if (!ev) return;
  const act = ev.actionType || "";
  const vis = ev.visual || {};
  const out = vis.outcome || "";
  if (act === "move" || act === "enter_gate" || act === "gate" || act === "exit") {
    playSfx("cart_move");
  } else if (act === "sell" || act === "deliver" || out === "sell" || out === "gift") {
    playSfx("sell");
  } else if (act === "market_buy" || act === "buy" || act === "pickup" || out === "buy") {
    playSfx("buy");
  } else if (act === "mission" || out === "mission") {
    playSfx("mission");
  } else if (out === "victory") {
    playSfx("combat_win");
  } else if (out === "defeat" || out === "paid" || out === "paid_good") {
    playSfx("combat_loss");
  } else if (act === "encounter" || act === "table_encounter" || act === "event") {
    playSfx("encounter");
  } else if (act === "gamble") {
    playSfx("dice");
  }
}

const GATE_OUTSIDE_DIR_BY_CELL = {
  B1: "N",
  E1: "N",
  F3: "E",
  F6: "S",
  B6: "S",
  A4: "W",
};

function getRomeCellPercentCoords(coord, offBoardDir = null) {
  if (!coord || coord.length < 2) return null;
  const colIdx = COLS.indexOf(String(coord).slice(0, 1));
  const rowIdx = ROWS.indexOf(String(coord).slice(1));
  if (colIdx < 0 || rowIdx < 0) return null;
  let x = ((colIdx + 0.5) / 6) * 100;
  let y = ((rowIdx + 0.78) / 6) * 100;
  if (offBoardDir) {
    const d = String(offBoardDir).toUpperCase();
    if (d.includes("N")) y -= 11;
    if (d.includes("S")) y += 11;
    if (d.includes("W")) x -= 11;
    if (d.includes("E")) x += 11;
  }
  return { x, y, colIdx, rowIdx };
}

function computeNpcReplayPositions(gs) {
  const posByPlayer = {};
  const waitingOutsideGateByPlayer = {};
  for (const p of (gs && gs.players) || []) {
    posByPlayer[p.index] = p.position || null;
    waitingOutsideGateByPlayer[p.index] = Boolean(
      gs.phase === "delivery_entry" || (gs.phase === "delivery" && gs.turn === 1 && p.enteredGateTurn1 === false)
    );
  }
  const futureQueue = Array.isArray(appState.npcPacingQueue) ? appState.npcPacingQueue : [];
  for (let i = futureQueue.length - 1; i >= 0; i -= 1) {
    const qEv = futureQueue[i];
    if (!qEv || typeof qEv.playerIndex !== "number") continue;
    const pIdx = qEv.playerIndex;
    if (qEv.actionType === "move" && qEv.fromCell) {
      posByPlayer[pIdx] = qEv.fromCell;
    } else if (qEv.actionType === "exit" && qEv.fromCell) {
      posByPlayer[pIdx] = qEv.fromCell;
    } else if (qEv.actionType === "enter_gate" && qEv.toCell) {
      posByPlayer[pIdx] = qEv.toCell;
      waitingOutsideGateByPlayer[pIdx] = true;
    } else if (qEv.actionType === "gate") {
      posByPlayer[pIdx] = null;
      waitingOutsideGateByPlayer[pIdx] = true;
    }
  }
  const activeEv = appState.activeNpcEvent;
  let glidingPlayerIndex = null;
  if (activeEv && typeof activeEv.playerIndex === "number" && activeEv.phase !== "market") {
    const act = activeEv.actionType;
    if (act === "move" || act === "enter_gate" || act === "gate" || act === "exit") {
      glidingPlayerIndex = activeEv.playerIndex;
    } else if (activeEv.toCell) {
      posByPlayer[activeEv.playerIndex] = activeEv.toCell;
    }
  }
  return { posByPlayer, waitingOutsideGateByPlayer, glidingPlayerIndex };
}

function getNpcBubbleOutcomeTone(ev) {
  const act = (ev && ev.actionType) || "";
  const vis = (ev && ev.visual) || {};
  const out = vis.outcome || "";
  if (out === "victory") return "is-victory";
  if (out === "defeat" || out === "paid" || out === "paid_good") return "is-defeat";
  if (act === "sell" || act === "deliver" || out === "sell" || out === "gift") return "is-gain";
  if (act === "market_buy" || act === "buy" || out === "buy") return "is-spend";
  if (act === "pickup") return "is-cargo";
  if (act === "mission" || out === "mission" || vis.chartType === "soothsayer") return "is-quest";
  return "is-neutral";
}

function buildNpcSpeechBubbleVisualNodes(ev) {
  const vis = (ev && ev.visual) || {};
  const thumbs = [];

  if (vis.card && vis.card.id && /^[a-z0-9_-]+$/i.test(String(vis.card.id))) {
    const cid = String(vis.card.id);
    const dk = ["patricii", "legiones", "nefarii"].includes(String(vis.card.deck || "").toLowerCase())
      ? String(vis.card.deck).toLowerCase()
      : "patricii";
    const cardImg = el("img", {
      className: "npc-bubble-card-img",
      src: `/assets/cards/${cid}.jpg?v=43`,
      alt: vis.card.name || "Encounter",
    });
    cardImg.onerror = () => {
      cardImg.onerror = null;
      const fallbackUrl =
        dk === "patricii" ? "/assets/icons/encounters/patricii_center.png" : `/assets/icons/encounters/${dk}_1_center.png`;
      cardImg.src = resolveAssetUrl(fallbackUrl);
    };
    thumbs.push(
      el(
        "div",
        { className: "npc-bubble-thumb-wrap is-portrait", title: vis.card.name || "Encounter" },
        cardImg
      )
    );
  } else if (vis.kind === "table_encounter") {
    const chartIcon =
      vis.chartType === "mob"
        ? "/assets/icons/encounters/mob_center.png"
        : vis.chartType === "theater"
          ? "/assets/icons/encounters/theater_center.png"
          : "/assets/icons/encounters/soothsayer_center.png";
    thumbs.push(
      el(
        "div",
        { className: "npc-bubble-thumb-wrap is-icon" },
        el("img", { className: "npc-bubble-icon-img", src: resolveAssetUrl(chartIcon), alt: vis.chartType || "Table Encounter" })
      )
    );
  }

  if (vis.item && vis.item.name) {
    const goodArtUrl = resolveGoodCardArtUrl(vis.item, vis.item.track || "Grain");
    const isSell = ev.actionType === "sell" || ev.actionType === "deliver" || vis.outcome === "sell";
    const isBuy = ev.actionType === "market_buy" || ev.actionType === "buy" || vis.outcome === "buy";
    thumbs.push(
      el(
        "div",
        {
          className: `npc-bubble-thumb-wrap is-good ${isSell ? "anim-good-sell" : isBuy ? "anim-good-buy" : ""}`,
          title: vis.item.name,
        },
        el("img", { className: "npc-bubble-good-img", src: goodArtUrl, alt: vis.item.name })
      )
    );
  }

  const tone = getNpcBubbleOutcomeTone(ev);
  const badgeText = replaceDenariiTokens(vis.outcomeLabel || ev.summary || "Acting...");
  const subLabel =
    vis.card && vis.card.name
      ? vis.card.name
      : vis.item && vis.item.name
      ? vis.item.name
      : replaceDenariiTokens(ev.summary || "");

  return el(
    "div",
    { className: "npc-speech-bubble-inner" },
    el(
      "div",
      { className: "npc-bubble-header" },
      el("span", {
        className: "npc-bubble-color-dot",
        style: { backgroundColor: getPlayerHexColor(ev.playerColor || "Z3") },
      }),
      el("strong", { className: "npc-bubble-merchant-name", text: ev.playerName || "Rival" })
    ),
    el(
      "div",
      { className: "npc-bubble-body" },
      thumbs.length > 0 ? el("div", { className: "npc-bubble-thumbs" }, ...thumbs) : null,
      el(
        "div",
        { className: "npc-bubble-text-col" },
        subLabel ? el("div", { className: "npc-bubble-item-title", text: subLabel }) : null,
        el("div", { className: `npc-bubble-outcome-pill ${tone}`, text: badgeText })
      )
    )
  );
}

function renderRomeNpcAnimationLayer() {
  const ev = appState.activeNpcEvent;
  if (!ev || ev.phase === "market") return null;

  const act = ev.actionType || "";
  const vis = ev.visual || {};
  let startCoords = null;
  let endCoords = null;
  let isGliding = false;

  if (act === "move" && ev.fromCell && ev.toCell) {
    startCoords = getRomeCellPercentCoords(ev.fromCell);
    endCoords = getRomeCellPercentCoords(ev.toCell);
    isGliding = Boolean(startCoords && endCoords);
  } else if ((act === "enter_gate" || act === "gate") && ev.toCell) {
    const outDir = GATE_OUTSIDE_DIR_BY_CELL[ev.toCell] || "N";
    startCoords = getRomeCellPercentCoords(ev.toCell, outDir);
    endCoords = getRomeCellPercentCoords(ev.toCell, act === "gate" ? outDir : null);
    isGliding = Boolean(act === "enter_gate" && startCoords && endCoords);
  } else if (act === "exit" && ev.fromCell) {
    const outDir = vis.direction || (getCellOffBoardDirs(ev.fromCell)[0] || "N");
    startCoords = getRomeCellPercentCoords(ev.fromCell);
    endCoords = getRomeCellPercentCoords(ev.fromCell, outDir);
    isGliding = Boolean(startCoords && endCoords);
  } else {
    const cellRef = ev.toCell || ev.fromCell;
    if (cellRef) {
      endCoords = getRomeCellPercentCoords(cellRef);
    }
  }

  if (!endCoords) return null;

  const layerChildren = [];
  if (act === "move" || act === "enter_gate" || act === "gate" || act === "exit") {
    const gliderNode = el(
      "div",
      {
        className: `npc-gliding-cart-token ${act === "gate" ? "is-poised-gate" : ""}`,
        style: {
          left: `${endCoords.x}%`,
          top: `${endCoords.y}%`,
        },
      },
      renderCartIconNode(ev.playerColor || "Z3", "cart-icon-board is-gliding-active", `${ev.playerName || "Rival"}'s Cart`)
    );
    if (isGliding && startCoords && typeof gliderNode.animate === "function" && appState._lastAnimatedNpcSeq !== ev.seq) {
      appState._lastAnimatedNpcSeq = ev.seq;
      requestAnimationFrame(() => {
        try {
          gliderNode.animate(
            [
              { left: `${startCoords.x}%`, top: `${startCoords.y}%`, transform: "translate(-50%, -50%) scale(1.06)" },
              { left: `${endCoords.x}%`, top: `${endCoords.y}%`, transform: "translate(-50%, -50%) scale(1.16)", offset: 0.6 },
              { left: `${endCoords.x}%`, top: `${endCoords.y}%`, transform: "translate(-50%, -50%) scale(1.04)" },
            ],
            { duration: 560, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
          );
        } catch (_animErr) {
          // Ignore if Web Animations API is unavailable
        }
      });
    }
    layerChildren.push(gliderNode);
  }

  const bubbleAnchor = {
    x: Math.max(8, Math.min(92, endCoords.x)),
    y: Math.max(8, Math.min(92, endCoords.y)),
  };
  const posClasses = ["npc-cart-speech-bubble"];
  if (bubbleAnchor.y < 26) posClasses.push("bubble-below");
  if (bubbleAnchor.x < 22) posClasses.push("bubble-align-left");
  else if (bubbleAnchor.x > 78) posClasses.push("bubble-align-right");

  layerChildren.push(
    el(
      "div",
      {
        className: posClasses.join(" "),
        style: {
          left: `${bubbleAnchor.x}%`,
          top: `${bubbleAnchor.y}%`,
        },
      },
      buildNpcSpeechBubbleVisualNodes(ev)
    )
  );

  return el("div", { className: "npc-board-anim-layer" }, ...layerChildren);
}

function renderMarketNpcSpeechBubble() {
  const ev = appState.activeNpcEvent;
  if (!ev || ev.phase !== "market") return null;
  return el(
    "div",
    { className: "market-npc-speech-showcase" },
    renderCartIconNode(ev.playerColor || "Z3", "market-npc-cart-avatar", `${ev.playerName || "Rival"}'s Cart`),
    el("div", { className: "npc-cart-speech-bubble is-market-inline" }, buildNpcSpeechBubbleVisualNodes(ev))
  );
}

function isViewerActionRequired(gs) {
  if (!gs || !Array.isArray(gs.players) || gs.phase === "finished") return false;
  const viewer = getViewerPlayer(gs);
  if (!viewer) return false;
  const vIdx = viewer.index;
  if (gs.phase === "setup_discard" && !viewer.setupDiscarded) return true;
  if (gs.phase === "cleanup" && !viewer.cleanupDone) return true;
  if (gs.pendingEncounter) {
    const pend = gs.pendingEncounter;
    const actorIdx =
      pend.interveningPlayerIndex !== null && pend.interveningPlayerIndex !== undefined
        ? pend.interveningPlayerIndex
        : pend.playerIndex;
    return actorIdx === vIdx;
  }
  if (hasPlayerBlockingPrompt(viewer, true, gs)) {
    return true;
  }
  return gs.activePlayerIndex === vIdx;
}

function updateTabTurnTitle() {
  const baseTitle = "Night Merchant: All Roads Lead to Rome (211 A.D.)";
  if (appState.activeTab !== "tabletop" || !appState.gameState) {
    document.title = baseTitle;
    appState._wasViewerTurn = false;
    return;
  }
  const myTurn = isViewerActionRequired(appState.gameState);
  document.title = myTurn ? `⚔️ Your Turn! — ${baseTitle}` : baseTitle;
  if (myTurn && appState._wasViewerTurn === false) {
    playSfx("turn");
  }
  appState._wasViewerTurn = myTurn;
}

function stopNpcTurnPacing() {
  if (appState.npcPacingTimer) {
    clearInterval(appState.npcPacingTimer);
    appState.npcPacingTimer = null;
  }
  appState.npcPacingQueue = [];
  appState.activeNpcEvent = null;
  appState.npcPacingTotal = 0;
  appState.npcPacingIndex = 0;
}

function enqueueNewNpcEvents(state, isInitialLoad = false) {
  if (!state || !Array.isArray(state.npcEvents)) return;
  const maxSeq =
    typeof state.lastNpcEventSeq === "number"
      ? state.lastNpcEventSeq
      : state.npcEvents.reduce((acc, e) => Math.max(acc, Number(e && e.seq) || 0), 0);
  if (isInitialLoad || appState.lastSeenNpcEventSeq === null) {
    appState.lastSeenNpcEventSeq = maxSeq;
    return;
  }
  const paceEnabled = !(appState.user && appState.user.settings && appState.user.settings.paceBotTurns === false);
  const viewerIdx = typeof state.viewerPlayerIndex === "number" ? state.viewerPlayerIndex : -1;
  const fresh = [];
  for (const ev of state.npcEvents) {
    if (ev && typeof ev.seq === "number" && ev.seq > appState.lastSeenNpcEventSeq) {
      appState.lastSeenNpcEventSeq = ev.seq;
      if (paceEnabled && ev.playerIndex !== viewerIdx) {
        fresh.push(ev);
      }
    }
  }
  if (fresh.length === 0) return;

  // Cap queued playback to the latest 14 actions so multi-bot turns animate smoothly without dragging
  const trimmed = fresh.slice(-14);
  appState.npcPacingQueue.push(...trimmed);
  appState.npcPacingTotal = appState.npcPacingIndex + appState.npcPacingQueue.length + (appState.activeNpcEvent ? 1 : 0);
  if (!appState.npcPacingTimer) {
    stepNextNpcPacingEvent();
    appState.npcPacingTimer = setInterval(() => {
      if (appState.activeDiceOverlay) return; // Pause NPC ticks while a 3D dice overlay is open
      stepNextNpcPacingEvent();
    }, 1500);
  }
}

function stepNextNpcPacingEvent() {
  if (appState.npcPacingQueue.length === 0) {
    stopNpcTurnPacing();
    renderApp();
    return;
  }
  appState.activeNpcEvent = appState.npcPacingQueue.shift();
  appState.npcPacingIndex += 1;
  playSfxForNpcEvent(appState.activeNpcEvent);
  renderApp();
}

function renderNpcPacingBanner() {
  const ev = appState.activeNpcEvent;
  if (!ev) return null;
  const stepNum = Math.max(1, appState.npcPacingIndex || 1);
  const totalNum = Math.max(stepNum, appState.npcPacingTotal || stepNum);
  const matchedPlayer =
    (appState.gameState &&
      Array.isArray(appState.gameState.players) &&
      appState.gameState.players.find((p) => p.index === ev.playerIndex)) ||
    null;
  const npcEntity = matchedPlayer || {
    name: ev.playerName || "Merchant",
    isBot: true,
    botDifficulty: ev.botDifficulty || "ionic",
  };
  return el(
    "div",
    { className: "npc-pacing-banner" },
    el(
      "div",
      { style: { display: "flex", alignItems: "center", gap: "0.55rem", flexWrap: "wrap" } },
      renderCartIconNode(ev.playerColor || "Z3", "", `${ev.playerName || "AI"}'s Cart`),
      el(
        "strong",
        {
          style: { color: "#6e2119", fontFamily: "Cinzel, Georgia, serif", fontSize: "0.86rem" },
        },
        `⏳ AI Turn (${stepNum}/${totalNum}) — `,
        createPlayerNameNode(npcEntity, { iconSize: 16 }),
        ":"
      ),
      el("span", {
        style: { fontSize: "0.84rem", color: "#231710", fontWeight: "600" },
        text: replaceDenariiTokens(ev.summary || ev.kind || "Acting..."),
      }),
      ev.toCell
        ? el("span", { className: "badge", text: `📍 ${ev.fromCell ? `${ev.fromCell} → ` : ""}${ev.toCell}` })
        : null
    ),
    el(
      "div",
      { style: { display: "flex", gap: "0.4rem", alignItems: "center" } },
      el("button", {
        type: "button",
        className: "btn btn-sm",
        text: "▶ Next",
        onClick: () => stepNextNpcPacingEvent(),
      }),
      el("button", {
        type: "button",
        className: "btn btn-sm btn-crimson",
        text: "⏭️ Skip AI Replay",
        onClick: () => {
          stopNpcTurnPacing();
          renderApp();
        },
      })
    )
  );
}

const DELAYED_HOVER_TOOLTIP_MS = 5000;
let delayedHoverTargetEl = null;
let delayedHoverTimerId = null;
let delayedHoverClientX = 0;
let delayedHoverClientY = 0;

function positionDelayedHoverTooltip(tooltipEl, clientX, clientY) {
  if (!tooltipEl) return;
  const pad = 12;
  const w = tooltipEl.offsetWidth || 220;
  const h = tooltipEl.offsetHeight || 34;
  let left = clientX + 14;
  let top = clientY + 18;
  if (left + w + pad > window.innerWidth) {
    left = Math.max(pad, clientX - w - 14);
  }
  if (top + h + pad > window.innerHeight) {
    top = Math.max(pad, clientY - h - 14);
  }
  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.top = `${top}px`;
}

function showDelayedHoverTooltipNode(text, clientX, clientY) {
  if (!text) return;
  let tip = document.getElementById("delayed-hover-tooltip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "delayed-hover-tooltip";
    tip.className = "delayed-hover-tooltip";
    document.body.appendChild(tip);
  }
  tip.textContent = text;
  positionDelayedHoverTooltip(tip, clientX, clientY);
}

function hideDelayedHoverTooltip() {
  if (delayedHoverTimerId) {
    clearTimeout(delayedHoverTimerId);
    delayedHoverTimerId = null;
  }
  delayedHoverTargetEl = null;
  const tip = document.getElementById("delayed-hover-tooltip");
  if (tip) tip.remove();
}

function hoistHoverTitles(startEl) {
  let cur = startEl instanceof Element ? startEl : null;
  while (cur && cur !== document.body) {
    if (cur.hasAttribute && cur.hasAttribute("title")) {
      const rawT = (cur.getAttribute("title") || "").trim();
      if (rawT && !cur.hasAttribute("data-hover-title")) {
        cur.setAttribute("data-hover-title", rawT);
      }
      cur.removeAttribute("title");
    }
    cur = cur.parentElement || (cur.parentNode instanceof Element ? cur.parentNode : null);
  }
}

function armDelayedHoverTooltip(target, clientX, clientY) {
  if (!target) return;
  const text = (target.getAttribute("data-hover-title") || "").trim();
  if (!text) return;
  delayedHoverTargetEl = target;
  delayedHoverClientX = clientX;
  delayedHoverClientY = clientY;
  delayedHoverTimerId = setTimeout(() => {
    delayedHoverTimerId = null;
    if (delayedHoverTargetEl && document.body.contains(delayedHoverTargetEl)) {
      showDelayedHoverTooltipNode(text, delayedHoverClientX, delayedHoverClientY);
    }
  }, DELAYED_HOVER_TOOLTIP_MS);
}

function installDelayedHoverTooltips() {
  if (appState._delayedHoverInstalled) return;
  appState._delayedHoverInstalled = true;

  window.addEventListener(
    "mouseover",
    (e) => {
      if (!(e.target instanceof Element)) return;
      hoistHoverTitles(e.target);
      const target = e.target.closest("[data-hover-title]");
      if (target === delayedHoverTargetEl) {
        return;
      }
      hideDelayedHoverTooltip();
      armDelayedHoverTooltip(target, e.clientX, e.clientY);
    },
    { passive: true }
  );

  window.addEventListener(
    "mousemove",
    (e) => {
      delayedHoverClientX = e.clientX;
      delayedHoverClientY = e.clientY;
      if (
        delayedHoverTargetEl &&
        (!document.body.contains(delayedHoverTargetEl) ||
          (e.target instanceof Node && !delayedHoverTargetEl.contains(e.target)))
      ) {
        hideDelayedHoverTooltip();
      }
      if (!delayedHoverTargetEl && e.target instanceof Element) {
        hoistHoverTitles(e.target);
        const nextTarget = e.target.closest("[data-hover-title]");
        if (nextTarget) {
          armDelayedHoverTooltip(nextTarget, e.clientX, e.clientY);
        }
        return;
      }
      const tip = document.getElementById("delayed-hover-tooltip");
      if (tip) {
        positionDelayedHoverTooltip(tip, e.clientX, e.clientY);
      }
    },
    { passive: true }
  );

  document.documentElement.addEventListener("mouseleave", () => hideDelayedHoverTooltip(), { passive: true });
  for (const evName of ["mousedown", "wheel", "keydown", "touchstart", "blur"]) {
    window.addEventListener(evName, () => hideDelayedHoverTooltip(), { passive: true });
  }
}

function hideRomeHoverTooltip() {
  hideDelayedHoverTooltip();
  document.querySelectorAll(".compass-btn.is-hovered-dir").forEach((b) => b.classList.remove("is-hovered-dir"));
}
