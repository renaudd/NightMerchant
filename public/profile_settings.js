// Night Merchant: Player Profile, Custom Hotkeys, & Settings View (extracted from app.js)

/* =========================================================================
   PLAYER PROFILE, CUSTOMIZABLE HOTKEYS, & SETTINGS VIEW
   ========================================================================= */

const DEFAULT_HOTKEYS = {
  moveToTile: "v",
  scoutTile: "s",
  scoutDeck: "d",
  endTurn: "e",
  closeModal: "x",
  toggleCartNav: "n",
  viewRomeBoard: "r",
  viewMarketBoard: "m",
  viewClimateBoard: "c",
  viewAllBoards: "b",
};

const HOTKEY_SPECS = [
  {
    key: "moveToTile",
    label: "Move Cart to Selected Tile",
    desc: "Moves your Cart into the selected adjacent neighborhood (or opens the Move/Scout action prompt).",
  },
  {
    key: "scoutTile",
    label: "Scout Neighborhood Tile Stack",
    desc: "Peeks at the top unrevealed tile of the selected neighborhood stack (once per turn, anytime without ending your turn).",
  },
  {
    key: "scoutDeck",
    label: "Scout Card Deck",
    desc: "Opens the Scout picker across all 6 decks (once per turn, anytime without ending your turn).",
  },
  {
    key: "endTurn",
    label: "End Nocturnal Turn",
    desc: "Ends your current hourly Delivery turn in Rome.",
  },
  {
    key: "closeModal",
    label: "Close Active Popup / Window",
    desc: "Closes the currently open modal window (Esc also always closes modals).",
  },
  {
    key: "toggleCartNav",
    label: "Toggle Cart Mat / Navigate Tab",
    desc: "Switches between your Cart Mat and the 8-direction Compass / Tile Inspector (Numpad 5 also toggles).",
  },
  {
    key: "viewRomeBoard",
    label: "Focus Rome Night Board",
    desc: "Switches the tabletop view between Rome Night Board Only and Auto view.",
  },
  {
    key: "viewMarketBoard",
    label: "Focus Ostia Market Board",
    desc: "Switches the tabletop view between Ostia Market Board Only and Auto view.",
  },
  {
    key: "viewClimateBoard",
    label: "Focus Political Climate Board",
    desc: "Switches the tabletop view between Political Climate Senate Board and Auto view.",
  },
  {
    key: "viewAllBoards",
    label: "Show All Boards Stacked",
    desc: "Toggles showing all tabletop boards stacked simultaneously.",
  },
];

function getCustomHotkeys() {
  const merged = Object.assign({}, DEFAULT_HOTKEYS);
  try {
    const rawLocal = localStorage.getItem("nm_custom_hotkeys");
    if (rawLocal) {
      const parsed = JSON.parse(rawLocal);
      if (parsed && typeof parsed === "object") {
        for (const k of Object.keys(DEFAULT_HOTKEYS)) {
          if (typeof parsed[k] === "string") {
            merged[k] = parsed[k].trim().toLowerCase().slice(0, 1);
          }
        }
      }
    }
  } catch (_e) {
    // Ignore localStorage parse errors
  }
  const userHotkeys = appState.user && appState.user.settings && appState.user.settings.hotkeys;
  if (userHotkeys && typeof userHotkeys === "object") {
    for (const k of Object.keys(DEFAULT_HOTKEYS)) {
      if (typeof userHotkeys[k] === "string") {
        merged[k] = userHotkeys[k].trim().toLowerCase().slice(0, 1);
      }
    }
  }
  return merged;
}

function saveCustomHotkeysLocal(hotkeysMap) {
  const clean = Object.assign({}, DEFAULT_HOTKEYS);
  if (hotkeysMap && typeof hotkeysMap === "object") {
    for (const k of Object.keys(DEFAULT_HOTKEYS)) {
      if (typeof hotkeysMap[k] === "string") {
        clean[k] = hotkeysMap[k].trim().toLowerCase().slice(0, 1);
      }
    }
  }
  try {
    localStorage.setItem("nm_custom_hotkeys", JSON.stringify(clean));
  } catch (_e) {
    // Ignore localStorage write errors
  }
  if (appState.user && appState.user.settings) {
    appState.user.settings.hotkeys = Object.assign({}, clean);
  }
  return clean;
}

function renderProfileView() {
  const user = appState.user;
  if (!user) return renderAuthView();

  const userSettings = user.settings || {};
  let selectedColor = user.preferredColor || "Z3";
  const currentHotkeys = getCustomHotkeys();
  const hotkeyInputsByKey = {};

  const displayNameInput = el("input", {
    className: "form-input",
    type: "text",
    value: user.displayName || "",
    placeholder: "Your Roman Merchant Title",
  });
  const emailInput = el("input", {
    className: "form-input",
    type: "email",
    value: user.email || "",
    placeholder: "merchant@collegium-ostia.org",
  });
  const defaultBoardSelect = el(
    "select",
    { className: "form-input" },
    el("option", { value: "auto", selected: (userSettings.defaultBoardView || "auto") === "auto", text: "Auto-Switch by Game Phase (Market / Rome)" }),
    el("option", { value: "both", selected: userSettings.defaultBoardView === "both", text: "Show Both Boards Stacked" }),
    el("option", { value: "rome", selected: userSettings.defaultBoardView === "rome", text: "Rome Night Board Only" }),
    el("option", { value: "market", selected: userSettings.defaultBoardView === "market", text: "Ostia Market Board Only" })
  );
  const autoPromptCargoCheckbox = el("input", {
    type: "checkbox",
    checked: userSettings.autoPromptCargoLoad !== false,
  });
  const animateDiceCheckbox = el("input", {
    type: "checkbox",
    checked: userSettings.animateDice !== false,
  });
  const paceBotTurnsCheckbox = el("input", {
    type: "checkbox",
    checked: userSettings.paceBotTurns !== false,
  });
  const soundEffectsCheckbox = el("input", {
    type: "checkbox",
    checked: userSettings.soundEffects !== false,
  });
  const allowUndoByDefaultCheckbox = el("input", {
    type: "checkbox",
    checked: Boolean(userSettings.allowUndoByDefault),
  });
  const skipMissionPopupsCheckbox = el("input", {
    type: "checkbox",
    checked: Boolean(userSettings.skipMissionCompletionPopups),
  });
  const tutorialEnabledCheckbox = el("input", {
    id: "profile-tutorial-enabled-checkbox",
    type: "checkbox",
    checked: userSettings.tutorialEnabled !== false,
  });
  const currentPasswordInput = el("input", {
    className: "form-input",
    type: "password",
    placeholder: "Current password (only required if changing password)",
    autocomplete: "current-password",
  });
  const newPasswordInput = el("input", {
    className: "form-input",
    type: "password",
    placeholder: "New password (8+ characters, leave blank to keep current)",
    autocomplete: "new-password",
  });

  const colorButtons = [];
  const previewIconSlot = el(
    "div",
    { style: { display: "flex", alignItems: "center", gap: "0.75rem" } },
    renderCartIconNode(selectedColor, "cart-icon-lg", `${user.displayName}'s Cart`)
  );

  const colorGrid = el(
    "div",
    { className: "color-swatch-grid" },
    ...CART_COLOR_PALETTE.map((c) => {
      const btn = el(
        "button",
        {
          type: "button",
          className: `color-swatch-option ${c.id === selectedColor ? "selected" : ""}`,
          onClick: () => {
            selectedColor = c.id;
            colorButtons.forEach((b) => b.node.classList.toggle("selected", b.id === selectedColor));
            previewIconSlot.replaceChildren(
              renderCartIconNode(selectedColor, "cart-icon-lg", `${user.displayName}'s Cart`)
            );
          },
        },
        renderCartIconNode(c.id, "", c.label),
        el("span", { text: c.label })
      );
      colorButtons.push({ id: c.id, node: btn });
      return btn;
    })
  );

  const hotkeyRows = HOTKEY_SPECS.map((spec) => {
    const hkInput = el("input", {
      className: "form-input",
      type: "text",
      maxLength: "1",
      value: (currentHotkeys[spec.key] || "").toUpperCase(),
      title: `Click and press a key to bind "${spec.label}"`,
      style: {
        width: "54px",
        textAlign: "center",
        fontWeight: "800",
        fontFamily: "Cinzel, Georgia, serif",
        fontSize: "0.92rem",
        padding: "0.3rem 0.25rem",
        textTransform: "uppercase",
        flexShrink: "0",
      },
      onKeyDown: (ev) => {
        if (ev.key === "Tab") return;
        ev.preventDefault();
        if (ev.key === "Backspace" || ev.key === "Delete") {
          hkInput.value = "";
          currentHotkeys[spec.key] = "";
          saveCustomHotkeysLocal(currentHotkeys);
          return;
        }
        if (ev.key && ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
          const cleanChar = ev.key.toLowerCase();
          hkInput.value = cleanChar.toUpperCase();
          currentHotkeys[spec.key] = cleanChar;
          saveCustomHotkeysLocal(currentHotkeys);
        }
      },
      onInput: () => {
        const cleanChar = (hkInput.value || "").trim().toLowerCase().slice(-1);
        hkInput.value = cleanChar.toUpperCase();
        currentHotkeys[spec.key] = cleanChar;
        saveCustomHotkeysLocal(currentHotkeys);
      },
    });
    hotkeyInputsByKey[spec.key] = hkInput;

    return el(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
          padding: "0.45rem 0.65rem",
          borderRadius: "6px",
          background: "#fbf7ee",
          border: "1px solid #c9b18c",
        },
      },
      el(
        "div",
        { style: { minWidth: "0" } },
        el("div", {
          style: { fontWeight: "700", fontSize: "0.84rem", color: "#231710" },
          text: spec.label,
        }),
        el("div", {
          style: { fontSize: "0.74rem", color: "var(--text-muted)", lineHeight: "1.25" },
          text: spec.desc,
        })
      ),
      hkInput
    );
  });

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    try {
      const savedHotkeys = saveCustomHotkeysLocal(currentHotkeys);
      const payload = {
        displayName: displayNameInput.value.trim(),
        email: emailInput.value.trim(),
        preferredColor: selectedColor,
        settings: {
          defaultBoardView: defaultBoardSelect.value,
          autoPromptCargoLoad: autoPromptCargoCheckbox.checked,
          animateDice: animateDiceCheckbox.checked,
          paceBotTurns: paceBotTurnsCheckbox.checked,
          soundEffects: soundEffectsCheckbox.checked,
          allowUndoByDefault: allowUndoByDefaultCheckbox.checked,
          skipMissionCompletionPopups: skipMissionPopupsCheckbox.checked,
          tutorialEnabled: tutorialEnabledCheckbox.checked,
          hotkeys: savedHotkeys,
        },
      };
      if (newPasswordInput.value) {
        payload.currentPassword = currentPasswordInput.value;
        payload.newPassword = newPasswordInput.value;
      }
      const res = await apiRequest("/api/profile/update", "POST", payload);
      appState.user = res.user;
      setTutorialEnabledLocalFlag(res.user && res.user.settings ? res.user.settings.tutorialEnabled !== false : tutorialEnabledCheckbox.checked);
      applyUserDefaultBoardView(res.user.settings);
      currentPasswordInput.value = "";
      newPasswordInput.value = "";
      showToast("Player profile, hotkeys, and merchant cart settings saved!");
      renderApp();
    } catch (err) {
      showToast(err.message, true);
    }
  };

  const summaryPanel = el(
    "div",
    { className: "panel" },
    el("h3", { className: "panel-title", text: "🏛️ Merchant Dossier" }),
    el(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          padding: "0.85rem",
          borderRadius: "6px",
          background: "#fbf7ee",
          border: "1.5px solid #a88d6b",
          boxShadow: "var(--bevel-sunken)",
          marginBottom: "1rem",
        },
      },
      previewIconSlot,
      el(
        "div",
        {},
        el("div", { style: { fontSize: "1.15rem", fontWeight: "700", color: "var(--gold-bright)" }, text: user.displayName }),
        el("div", { style: { fontSize: "0.8rem", color: "var(--text-muted)" }, text: `@${user.username} • ${maskEmailClient(user.email)}` }),
        el(
          "div",
          { style: { display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "0.35rem" } },
          el(
            "span",
            { className: "badge" },
            user.authProvider === "google" ? "🔗 Linked with Google" : "🔑 Collegium Password Account"
          ),
          user.isAdmin
            ? el("span", {
                className: "badge",
                style: { borderColor: "var(--gold-bright)", color: "var(--gold-bright)" },
                text: "🦅 Collegium Admin",
              })
            : null
        )
      )
    ),
    el(
      "div",
      { className: "profile-stat-grid" },
      el(
        "div",
        {
          className: "profile-stat-box profile-stat-box-clickable",
          title: "View all completed games & final scores",
          onClick: () => openCompletedGamesPage(),
        },
        el("div", { className: "stat-val", text: String(user.gamesPlayed || 0) }),
        el("div", { className: "stat-lbl", text: "Expeditions Played" })
      ),
      el(
        "div",
        {
          className: "profile-stat-box profile-stat-box-clickable",
          title: "View all completed games & final scores",
          onClick: () => openCompletedGamesPage(),
        },
        el("div", { className: "stat-val", text: String(user.gamesWon || 0) }),
        el("div", { className: "stat-lbl", text: "Imperial Victories" })
      ),
      el(
        "div",
        {
          className: "stat-box profile-stat-box profile-stat-box-clickable",
          title: "View all completed games & final scores",
          onClick: () => openCompletedGamesPage(),
        },
        el("div", { className: "stat-val", text: `${user.bestWealth || 0}(d)` }),
        el("div", { className: "stat-lbl", text: "Highest Treasury" })
      )
    ),
    el(
      "div",
      { style: { marginTop: "0.75rem", display: "flex", justifyContent: "flex-end" } },
      el("button", {
        type: "button",
        className: "btn btn-sm",
        text: "📜 View Completed Games & Final Scores →",
        onClick: () => openCompletedGamesPage(),
      })
    )
  );

  const settingsFormPanel = el(
    "div",
    { className: "panel" },
    el("h3", { className: "panel-title", text: "⚙️ Account & Game Settings" }),
    el(
      "form",
      { onSubmit: handleSaveProfile },
      el(
        "div",
        { className: "form-group" },
        el("label", { text: "Permanent Collegium Username (Used for Game Invitations)" }),
        el("input", {
          className: "form-input",
          type: "text",
          value: `@${user.username || ""}`,
          readOnly: true,
          disabled: true,
          style: { opacity: "0.85", fontWeight: "700", cursor: "not-allowed" },
        })
      ),
      el("div", { className: "form-group" }, el("label", { text: "Roman Merchant Title / Display Name" }), displayNameInput),
      el("div", { className: "form-group" }, el("label", { text: "Account Email Address (Required)" }), emailInput),
      el("div", { className: "form-group" }, el("label", { text: "Merchant Cart Icon & Token Color" }), colorGrid),
      el("div", { className: "form-group" }, el("label", { text: "Default Tabletop Board View" }), defaultBoardSelect),
      el(
        "div",
        { className: "form-group" },
        el("label", { text: "Tabletop Gameplay Preferences" }),
        el(
          "label",
          { style: { display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: "400", cursor: "pointer", marginBottom: "0.4rem" } },
          autoPromptCargoCheckbox,
          el("span", { text: "Ask via popup when Delivery Mission cargo can be loaded at my current neighborhood" })
        ),
        el(
          "label",
          { style: { display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: "400", cursor: "pointer", marginBottom: "0.4rem" } },
          animateDiceCheckbox,
          el("span", { text: "Show 3D Roman numeral dice roll overlay animations" })
        ),
        el(
          "label",
          { style: { display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: "400", cursor: "pointer", marginBottom: "0.4rem" } },
          paceBotTurnsCheckbox,
          el("span", { text: "Show step-by-step AI Bot Turn Replay banner (with Skip option)" })
        ),
        el(
          "label",
          { style: { display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: "400", cursor: "pointer", marginBottom: "0.4rem" } },
          soundEffectsCheckbox,
          el("span", { text: "Play subtle tabletop sound effects (dice, coins, combat, turn chime)" })
        ),
        el(
          "label",
          { style: { display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: "400", cursor: "pointer", marginBottom: "0.4rem" } },
          allowUndoByDefaultCheckbox,
          el("span", { text: "Allow undo by default (automatically approve Undo Turn requests in multiplayer games)" })
        ),
        el(
          "label",
          { style: { display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: "400", cursor: "pointer", marginBottom: "0.4rem" } },
          skipMissionPopupsCheckbox,
          el("span", { text: 'Skip mission completion notification popups ("Do not show this again")' })
        ),
        el(
          "label",
          { style: { display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: "400", cursor: "pointer" } },
          tutorialEnabledCheckbox,
          el("span", { text: "Enable Guided First-Season Tutorial popups (step-by-step Spring walkthrough)" })
        )
      ),
      el(
        "div",
        {
          style: {
            marginTop: "1rem",
            paddingTop: "0.85rem",
            borderTop: "1px solid var(--border-subtle)",
          },
        },
        el(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.5rem",
              flexWrap: "wrap",
              marginBottom: "0.45rem",
            },
          },
          el("div", {
            style: { fontWeight: "700", fontSize: "0.88rem", color: "var(--gold-bright)" },
            text: "⌨️ Keyboard Shortcuts (Hotkeys)",
          }),
          el("button", {
            type: "button",
            className: "btn btn-sm",
            text: "↺ Reset Hotkeys to Defaults",
            onClick: () => {
              Object.assign(currentHotkeys, DEFAULT_HOTKEYS);
              for (const [k, inp] of Object.entries(hotkeyInputsByKey)) {
                inp.value = (DEFAULT_HOTKEYS[k] || "").toUpperCase();
              }
              saveCustomHotkeysLocal(currentHotkeys);
              showToast("Hotkeys reset to defaults!");
            },
          })
        ),
        el("p", {
          style: { fontSize: "0.76rem", color: "var(--text-muted)", margin: "0 0 0.6rem 0", lineHeight: "1.35" },
          text: "Click any shortcut box below and press a key to customize it. Built-in directional & overlay keys: Numpad 1–9 steers your Cart in 8 compass directions (7=NW, 8=N, 9=NE, 4=W, 6=E, 1=SW, 2=S, 3=SE; 5 toggles Cart/Navigate), Space/Enter advances settled Dice & AI Turn overlays, and Esc always closes open windows.",
        }),
        el(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: "0.4rem" } },
          ...hotkeyRows
        )
      ),
      el(
        "div",
        {
          style: {
            marginTop: "1rem",
            paddingTop: "0.85rem",
            borderTop: "1px solid var(--border-subtle)",
          },
        },
        el("div", { style: { fontWeight: "700", fontSize: "0.85rem", color: "var(--gold-bright)", marginBottom: "0.55rem" }, text: "🔐 Change Password (Optional)" }),
        el("div", { className: "form-group" }, el("label", { text: "Current Password" }), currentPasswordInput),
        el("div", { className: "form-group" }, el("label", { text: "New Password (8+ characters)" }), newPasswordInput)
      ),
      el(
        "div",
        { style: { display: "flex", justifyContent: "flex-end", gap: "0.6rem", marginTop: "1rem" } },
        el(
          "button",
          { type: "submit", className: "btn btn-primary" },
          "💾 Save Profile & Settings"
        )
      )
    )
  );

  return el(
    "div",
    { className: "portal-container" },
    el("div", { className: "profile-grid" }, summaryPanel, settingsFormPanel)
  );
}
