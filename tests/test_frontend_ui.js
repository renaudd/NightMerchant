// DOM & Browser Shim for JavaScriptCore (jsc) automated verification of public/app.js

function makeClassList(elNode) {
  return {
    add: (...cls) => {
      const set = new Set((elNode.className || "").split(/\s+/).filter(Boolean));
      cls.forEach((c) => c && set.add(c));
      elNode.className = Array.from(set).join(" ");
    },
    remove: (...cls) => {
      const drop = new Set(cls);
      elNode.className = (elNode.className || "")
        .split(/\s+/)
        .filter((c) => c && !drop.has(c))
        .join(" ");
    },
    contains: (c) => (elNode.className || "").split(/\s+/).includes(c),
  };
}

function makeFakeElement(tag) {
  const node = {
    tagName: String(tag || "DIV").toUpperCase(),
    nodeType: 1,
    id: "",
    className: "",
    children: [],
    parentNode: null,
    style: {},
    dataset: {},
    attributes: {},
    _text: "",
    _listeners: {},
    setAttribute(k, v) {
      this.attributes[k] = String(v);
      if (k === "id") this.id = String(v);
      if (k === "class") this.className = String(v);
      if (k === "src" || k === "href" || k === "alt") this[k] = String(v);
    },
    getAttribute(k) {
      if (k === "id") return this.id || null;
      if (k === "class") return this.className || null;
      return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null;
    },
    appendChild(child) {
      if (!child) return child;
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    prepend(child) {
      if (!child) return child;
      child.parentNode = this;
      this.children.unshift(child);
      return child;
    },
    insertBefore(newNode, refNode) {
      if (!refNode) return this.appendChild(newNode);
      const idx = this.children.indexOf(refNode);
      newNode.parentNode = this;
      if (idx === -1) this.children.push(newNode);
      else this.children.splice(idx, 0, newNode);
      return newNode;
    },
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx !== -1) this.children.splice(idx, 1);
      if (child) child.parentNode = null;
      return child;
    },
    remove() {
      if (this.parentNode) this.parentNode.removeChild(this);
    },
    addEventListener(evt, fn) {
      this._listeners[evt] = this._listeners[evt] || [];
      this._listeners[evt].push(fn);
    },
    removeEventListener() {},
    contains(other) {
      if (other === this) return true;
      return this.children.some((c) => c && typeof c.contains === "function" && c.contains(other));
    },
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null;
    },
    querySelectorAll(sel) {
      const matches = [];
      const walk = (n) => {
        if (!n || n.nodeType !== 1) return;
        let ok = false;
        if (sel.startsWith("#")) ok = n.id === sel.slice(1);
        else if (sel.startsWith(".")) ok = (n.className || "").split(/\s+/).includes(sel.slice(1));
        else ok = n.tagName.toLowerCase() === sel.toLowerCase();
        if (ok) matches.push(n);
        (n.children || []).forEach(walk);
      };
      (this.children || []).forEach(walk);
      return matches;
    },
    getBoundingClientRect() {
      return { top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100 };
    },
  };
  Object.defineProperty(node, "textContent", {
    get() {
      if (node.children.length === 0) return node._text;
      return node._text + node.children.map((c) => (c.textContent !== undefined ? c.textContent : "")).join(" ");
    },
    set(val) {
      node._text = val == null ? "" : String(val);
      node.children = [];
    },
  });
  Object.defineProperty(node, "innerText", {
    get() {
      return node.textContent;
    },
    set(val) {
      node.textContent = val;
    },
  });
  node.classList = makeClassList(node);
  Object.setPrototypeOf(node, Node.prototype);
  return node;
}

function Node() {}
globalThis.Node = Node;
globalThis.HTMLElement = function () {};
globalThis.HTMLElement.prototype = Object.create(Node.prototype);

const fakeBody = makeFakeElement("body");
const fakeAppRoot = makeFakeElement("div");
fakeAppRoot.id = "app";
fakeBody.appendChild(fakeAppRoot);

globalThis.window = {
  NIGHTMERCHANT_CONFIG: {},
  addEventListener() {},
  removeEventListener() {},
  innerWidth: 1440,
  innerHeight: 900,
  location: { href: "http://127.0.0.1/", origin: "http://127.0.0.1", search: "", hash: "" },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  dispatchEvent() {},
};
globalThis.document = {
  body: fakeBody,
  head: makeFakeElement("head"),
  documentElement: makeFakeElement("html"),
  getElementById: (id) => (id === "app" ? fakeAppRoot : fakeBody.querySelector("#" + id)),
  createElement: (tag) => makeFakeElement(tag),
  createElementNS: (_ns, tag) => makeFakeElement(tag),
  createTextNode: (t) => Object.assign(Object.create(Node.prototype), { nodeType: 3, textContent: String(t || "") }),
  addEventListener() {},
  querySelector: (s) => fakeBody.querySelector(s),
  querySelectorAll: (s) => fakeBody.querySelectorAll(s),
};
globalThis.localStorage = {
  _data: {},
  getItem(k) {
    return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null;
  },
  setItem(k, v) {
    this._data[k] = String(v);
  },
  removeItem(k) {
    delete this._data[k];
  },
};
globalThis.sessionStorage = globalThis.localStorage;
globalThis.navigator = { clipboard: { writeText: () => Promise.resolve() } };
globalThis.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
globalThis.setTimeout = () => 1;
globalThis.clearTimeout = () => {};
globalThis.setInterval = () => 1;
globalThis.clearInterval = () => {};
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
globalThis.URLSearchParams = function () {
  return { get: () => null };
};
globalThis.CustomEvent = function (name, opts) {
  this.type = name;
  this.detail = opts && opts.detail;
};

// Load application source under test
load("public/tutorial.js");
load("public/profile_settings.js");
load("public/rulebook_view.js");
load("public/dice_and_sfx.js");
load("public/app.js");

function assert(cond, msg) {
  if (!cond) {
    throw new Error("JS ASSERT FAILED: " + msg);
  }
}

function collectAllText(node) {
  if (!node) return "";
  if (typeof node.textContent === "string" && (!node.children || node.children.length === 0)) {
    return node.textContent;
  }
  let s = node._text || "";
  if (Array.isArray(node.children)) {
    s += " " + node.children.map(collectAllText).join(" ");
  }
  return s;
}

// 1. Verify DEFAULT_POLITICAL_CLIMATE_OPTIONS updates
const optsById = Object.fromEntries(DEFAULT_POLITICAL_CLIMATE_OPTIONS.map((o) => [o.id, o]));
assert(optsById.geta_1 && optsById.geta_1.title === "Brother's Grudge", "geta_1 title");
assert(optsById.geta_1.description.includes("Most Geta favor loses 25d"), "geta_1 description Most Geta");
assert(optsById.geta_3 && optsById.geta_3.title === "Opulence", "geta_3 title Opulence");
assert(optsById.geta_3.description.includes("+1 Emerald"), "geta_3 description +1 Emerald");
assert(optsById.missions_2 && optsById.missions_2.title === "Loyalty Rewards", "missions_2 title Loyalty Rewards");
assert(optsById.missions_2.description.includes("10 × A × B"), "missions_2 description 10 x A x B");

// 2. Verify Patron Influence card helpers & DOM rendering (current & legacy saved cards)
const inf2Catalog = { id: "inf_2", name: "Patron", effectCode: "patron_caracalla_domna", effectText: "stale", favorGain: { extraFavor: ["-Caracalla", "-Domna"] } };
const inf39Catalog = { id: "inf_39", name: "Patron", effectCode: "patron_geta_aurelius", effectText: "stale", favorGain: { extraFavor: ["-Geta", "-Aurelius"] } };
const inf2Legacy = { id: "inf_2", name: "Patron", effectText: "OLD STALE TEXT" };
const inf39Legacy = { id: "inf_39b", name: "Patron", effectText: "OLD STALE TEXT" };

assert(getInfluenceCardEffectText(inf2Catalog).includes("6(d)") && getInfluenceCardEffectText(inf2Catalog).includes("lose 1 Caracalla") && getInfluenceCardEffectText(inf2Catalog).includes("1 Domna"), "inf_2 effectText");
assert(getInfluenceCardEffectText(inf2Legacy).includes("lose 1 Caracalla") && getInfluenceCardEffectText(inf2Legacy).includes("1 Domna"), "inf_2 legacy effectText");
assert(getInfluenceCardEffectText(inf39Legacy).includes("lose 1 Geta") && getInfluenceCardEffectText(inf39Legacy).includes("1 Aurelian"), "inf_39 legacy effectText");
assert(JSON.stringify(getInfluenceCardFavorList(inf2Legacy)) === JSON.stringify(["-Caracalla", "-Domna"]), "inf_2 legacy gems");
assert(JSON.stringify(getInfluenceCardFavorList(inf39Legacy)) === JSON.stringify(["-Geta", "-Aurelius"]), "inf_39 legacy gems");

const inf2Node = renderPhysicalInfluenceCardNode(inf2Legacy);
const inf2Imgs = inf2Node.querySelectorAll("img").map((i) => i.src || "");
const inf2Slash = inf2Node.querySelectorAll(".phys-gem-slash");
const inf2Titles = inf2Slash.map((n) => n.getAttribute("data-hover-title") || "");
assert(inf2Imgs.some((s) => s.includes("ruby.png")) && inf2Imgs.some((s) => s.includes("diamond.png")), "inf_2 renders Ruby & Diamond icons");
assert(inf2Slash.length === 2, "inf_2 renders 2 slashed negative gem badges");
assert(inf2Titles.includes("Opposes / -1 Caracalla") && inf2Titles.includes("Opposes / -1 Domna"), "inf_2 hover titles reflect -Caracalla and -Domna");

const inf39Node = renderPhysicalInfluenceCardNode(inf39Legacy);
const inf39Imgs = inf39Node.querySelectorAll("img").map((i) => i.src || "");
const inf39Titles = inf39Node.querySelectorAll(".phys-gem-slash").map((n) => n.getAttribute("data-hover-title") || "");
assert(inf39Imgs.some((s) => s.includes("emerald.png")) && inf39Imgs.some((s) => s.includes("amethyst.png")), "inf_39 renders Emerald & Amethyst icons");
assert(inf39Titles.includes("Opposes / -1 Geta") && inf39Titles.includes("Opposes / -1 Aurelius"), "inf_39 hover titles reflect -Geta and -Aurelius");

// 3. Verify setup_discard default board view ("market") vs manual override ("rome")
function buildMinimalGs(phase) {
  const rome = {};
  const cols = ["A", "B", "C", "D", "E", "F"];
  for (let r = 1; r <= 6; r++) {
    for (const c of cols) {
      const coord = c + r;
      rome[coord] = {
        coord,
        name: coord,
        isGate: coord === "D1",
        isForum: coord === "C3",
        stackCount: 2,
        revealed: { name: coord, tileType: "street", edges: { N: "green", S: "green", E: "green", W: "green" }, center: null, modifier: "=" },
      };
    }
  }
  const players = [
    {
      index: 0,
      userId: 1,
      name: "MercA",
      color: "Z3",
      cash: 12,
      favor: { Caracalla: 0, Geta: 0, Domna: 0, Plautilla: 0, Aurelius: 0 },
      stats: { factionMissionsCompleted: { Caracalla: 0, Geta: 0, Domna: 0, Plautilla: 0, Aurelius: 0 } },
      cart: [],
      guards: [],
      missions: [],
      influence: [],
      usedSpace: 0,
      maxSpace: 6,
      guardSeatsUsed: 0,
      maxGuardSeats: 2,
      position: "B4",
      movesRemaining: 4,
      transactionsRemaining: 1,
      setupDiscarded: false,
      cleanupDone: false,
      isBot: false,
    },
    {
      index: 1,
      userId: 2,
      name: "MercB",
      color: "Z4",
      cash: 12,
      favor: { Caracalla: 0, Geta: 0, Domna: 0, Plautilla: 0, Aurelius: 0 },
      stats: { factionMissionsCompleted: { Caracalla: 0, Geta: 0, Domna: 0, Plautilla: 0, Aurelius: 0 } },
      cart: [],
      guards: [],
      missions: [],
      influence: [],
      usedSpace: 0,
      maxSpace: 6,
      guardSeatsUsed: 0,
      maxGuardSeats: 2,
      position: "C4",
      movesRemaining: 4,
      transactionsRemaining: 1,
      setupDiscarded: false,
      cleanupDone: false,
      isBot: false,
    },
  ];
  return {
    phase,
    season: "Spring",
    seasonIndex: 0,
    turn: 1,
    activePlayerIndex: 0,
    firstPlayerIndex: 0,
    players,
    romeBoard: rome,
    deckCounts: { market: 20, missiones: 20, influence: 40, patricii: 30, legiones: 30, nefarii: 29 },
    discardCounts: { market: 0, missiones: 0, influence: 0, patricii: 0, legiones: 0, nefarii: 0 },
    missionMarket: [],
    turnWaitingSince: {},
    marketBoard: Object.fromEntries(TRACK_NAMES.map((t) => [t, []])),
    marketMeta: Object.fromEntries(
      TRACK_NAMES.map((t) => [t, { count: 0, scarcityLabel: "Precious (<<)", scarcitySymbol: "<<" }])
    ),
    politicalClimate: { options: DEFAULT_POLITICAL_CLIMATE_OPTIONS, selectedIds: ["geta_3"], draftOrder: [0, 1], draftStep: 2 },
    pendingEncounter: null,
    diceEvents: [],
    gameLog: [],
    isPlayer: true,
    viewerPlayerIndex: 0,
    viewerUserId: 1,
  };
}

const gsSetup = buildMinimalGs("setup_discard");
appState.gameState = gsSetup;
appState.user = { id: 1, username: "MercA" };
appState.boardViewMode = "auto";
const tableAuto = renderTabletopView(gsSetup);
const tableAutoText = collectAllText(tableAuto);
assert(tableAutoText.includes("Ostia") || tableAuto.querySelectorAll(".market-board-grid").length > 0 || tableAutoText.includes("Market"), "setup_discard + auto renders Ostia Market board");
assert(!tableAutoText.includes("Tiber"), "setup_discard + auto does NOT render Rome board by default");

appState.boardViewMode = "rome";
const tableManualRome = renderTabletopView(gsSetup);
const manualRomeText = collectAllText(tableManualRome);
assert(manualRomeText.includes("B4") && manualRomeText.includes("C4"), "setup_discard + manual rome still renders Rome board");

// 4. Verify Divided Tiber toll removed on orthogonal Tiber crossing edge & compass
const edgeNode = renderDynamicEdgeSlotNode("E", "green", "B4");
assert(!collectAllText(edgeNode).includes("4(d)") && !(edgeNode.children[0].className || "").includes("tiber-toll"), "Divided Tiber 4(d) edge badge removed");

// 5. Verify Sagittae preRollStrike UI labels, Twist Of Fate-only window & dice overlay
const sagCard = { id: "wpn_1", item: "Sagittae", name: "Sagittae", combat: { dice: 1, flat: 0, consumable: true, preRollStrike: true } };
const pilCard = { id: "wpn_3", item: "Pila", name: "Pila", combat: { dice: 2, flat: 0, consumable: true, preRollStrike: false } };
const pickerNodes = buildConsumableWeaponPickerNodes([sagCard, pilCard], new Set(["wpn_1"]), () => {});
const sagText = collectAllText(pickerNodes[0]);
const pilText = collectAllText(pickerNodes[1]);
assert(sagText.includes("Pre-Roll Strike") && pickerNodes[0].querySelectorAll(".rome-die-box").length >= 1, "Sagittae picker label mentions Pre-Roll Strike + Rome die box");
assert(sagText.includes("BEFORE main combat"), "Sagittae picker explains firing BEFORE main combat");
assert(pilText.includes("+2") && pickerNodes[1].querySelectorAll(".rome-die-box").length >= 1, "Pila keeps +2 + Rome die box label");

const gsPre = buildMinimalGs("delivery");
gsPre.players[0].influence = [
  { id: "inf_10", name: "Twist Of Fate", effectText: "Re-roll any die" },
  { id: "inf_11", name: "Flying Chamber Pot", effectText: "+1 CP" },
  { id: "inf_12", name: "Mercenary Ambush", effectText: "+2(R)" },
];
const pendPre = {
  stage: "combat_pre_strike_post_roll",
  isPvp: false,
  playerIndex: 0,
  card: { id: "pat_1", name: "Test Brigand", deck: "patricii", combatFormula: "X(R)+X" },
  strikeNames: ["Sagittae"],
  strikeWounds: 1,
  ignoreWounds: 0,
  netWoundsAfterArmor: 1,
  preStrikeCapacity: 2,
  preStrikeCapacityMode: "x",
  preStrikeDefeatsNpc: false,
  playerDiceObjs: [{ value: 1, roman: "I", sign: 1, label: "Sagittae Pre-Strike ®", color: "Z3" }],
  oppDiceObjs: [],
};
gsPre.pendingEncounter = pendPre;
assert(getEligibleRerollTargets(pendPre).length === 1, "getEligibleRerollTargets returns pre-strike die");
const encPanel = renderPendingEncounterPanel(gsPre, gsPre.players[0]);
const encText = collectAllText(encPanel);
assert(encText.includes("Pre-Roll Strike") && encText.includes("Only 'Twist Of Fate'"), "Pre-roll panel enforces Twist Of Fate only");
assert(encText.includes("Twist Of Fate") && !encText.includes("Flying Chamber Pot") && !encText.includes("Mercenary Ambush"), "Pre-roll panel excludes non-Twist Of Fate cards");
assert(encText.includes("Confirm -1 Enemy X & Roll Main Combat"), "Pre-roll confirm button text accurate");

appState.gameState = gsPre;
const overlayCtrl = buildDiceOverlayInteractiveControls({ kind: "combat_pre_strike", groups: [] });
const overlayText = collectAllText(overlayCtrl);
assert(overlayText.includes("Twist Of Fate") && !overlayText.includes("Flying Chamber Pot"), "Dice overlay also limits to Twist Of Fate only during combat_pre_strike_post_roll");
const dieMeta = getDieClickMetaForOverlay({ kind: "combat_pre_strike", groups: [] }, null, 0, 0);
assert(dieMeta && dieMeta.clickable === true && String(dieMeta.pillLabel).includes("Re-Roll"), "Pre-strike die clickable in overlay with Twist Of Fate");

const rulesDump = JSON.stringify(RULEBOOK_SECTIONS);
assert(rulesDump.includes("Sagittae Pre-Roll"), "RULEBOOK_SECTIONS documents Sagittae Pre-Roll Strike");
assert(!rulesDump.includes("Divided Tiber") && !rulesDump.includes("Guild Ledger"), "RULEBOOK_SECTIONS omits removed climate rules");
const marketSec = RULEBOOK_SECTIONS.find((s) => s.id === "market");
const cleanupSec = RULEBOOK_SECTIONS.find((s) => s.id === "cleanup");
assert(
  marketSec && !JSON.stringify(marketSec).includes("pass the First Player Token"),
  "Market RULEBOOK_SECTIONS no longer passes First Player Token at phase end"
);
assert(
  cleanupSec && JSON.stringify(cleanupSec).includes("pass the First Player Token clockwise (once per season)"),
  "Clean-Up RULEBOOK_SECTIONS documents passing First Player Token once per season"
);

// 6. Item 1: Verify Tiber bridge pills are turned off on Delivery board
const gsRome = buildMinimalGs("delivery");
gsRome.players[0].position = "B1";
const romeBoardEl = renderRomeNightBoard(gsRome, gsRome.players[0]);
assert(romeBoardEl.querySelectorAll(".tiber-bridge-pill").length === 0, "Delivery board hides .tiber-bridge-pill labels");

// 7. Item 2: Verify Pick Random Decree button and Rulebook first-time skip recommendation
const gsClimate = buildMinimalGs("setup_climate");
gsClimate.politicalClimate = {
  options: DEFAULT_POLITICAL_CLIMATE_OPTIONS,
  activeByFactor: {},
  activeIds: [],
  draftOrder: [0, 1],
  draftStep: 0,
};
const climateBoardEl = renderPoliticalClimateBoard(gsClimate, gsClimate.players[0]);
assert(climateBoardEl.querySelector("#btn-random-decree") !== null, "Political Climate Board shows Pick Random Decree button on active player pick");
const setupRuleSec = RULEBOOK_SECTIONS.find((s) => s.id === "setup");
assert(
  setupRuleSec && JSON.stringify(setupRuleSec).toLowerCase().includes("skip the political track"),
  "In-app Rulebook recommends first-time players skip the political track"
);

// 8. Item 4: Verify all 33 stylized location-aware encounter PNG assets map cleanly
assert(getEncounterFigureAssetMeta("mob", "center").src.endsWith("/encounters/mob_center.png"), "Mob center uses mob_center.png");
assert(getEncounterFigureAssetMeta("mob", "flat_edge").src.endsWith("/encounters/mob_edge.png"), "Mob edge uses mob_edge.png");
assert(getEncounterFigureAssetMeta("theater", "center").src.endsWith("/encounters/theater_center.png"), "Theater center uses theater_center.png");
assert(getEncounterFigureAssetMeta("theater", "flat_edge").src.endsWith("/encounters/theater_edge.png"), "Theater edge uses theater_edge.png");
assert(getEncounterFigureAssetMeta("soothsayer", "center").src.endsWith("/encounters/soothsayer_center.png"), "Soothsayer center uses soothsayer_center.png");
assert(getEncounterFigureAssetMeta("soothsayer", "corner_edge").src.endsWith("/encounters/soothsayer_edge.png"), "Soothsayer edge uses soothsayer_edge.png");
assert(getEncounterFigureAssetMeta("patricii", "center").src.endsWith("/encounters/patricii_center.png"), "Patricii center uses patricii_center.png");
assert(getEncounterFigureAssetMeta("patricii", "flat_edge").src.endsWith("/encounters/patricii_edge.png"), "Patricii edge uses patricii_edge.png");
for (const cnt of [1, 2, 3, 4]) {
  for (const loc of ["center", "flat_edge", "corner_edge"]) {
    assert(
      getEncounterFigureAssetMeta(`nefarii:${cnt}`, loc).src.endsWith(`/encounters/nefarii_${cnt}_${loc}.png`),
      `Nefarii ${cnt} ${loc} maps to distinct non-overlapping icon`
    );
    assert(
      getEncounterFigureAssetMeta(`legiones:${cnt}`, loc).src.endsWith(`/encounters/legiones_${cnt}_${loc}.png`),
      `Legiones ${cnt} ${loc} maps to distinct non-overlapping icon`
    );
  }
}
const cornerLegEdge = renderDynamicEdgeSlotNode("NE", "legiones:3", "B2");
assert(
  cornerLegEdge.querySelectorAll("img")[0].attributes.src.endsWith("/encounters/legiones_3_corner_edge.png"),
  "Corner edge Legiones(3) uses corner_edge sprite"
);
const flatMobEdge = renderDynamicEdgeSlotNode("N", "mob", "B2");
assert(
  flatMobEdge.querySelectorAll("img")[0].attributes.src.endsWith("/encounters/mob_edge.png"),
  "Flat edge Mob uses mob_edge sprite"
);
const cornerTheaterSE = renderDynamicEdgeSlotNode("SE", "theater", "B2");
const theaterSeImg = cornerTheaterSE.querySelectorAll("img")[0];
assert(
  theaterSeImg.attributes.src.endsWith("/encounters/theater_corner_edge.png") &&
    theaterSeImg.classList.contains("is-corner-wedge") &&
    theaterSeImg.classList.contains("is-corner-mirror"),
  "SE corner Theater uses mirrored theater_corner_edge wedge sprite"
);
const cornerMobNW = renderDynamicEdgeSlotNode("NW", "mob", "B2");
assert(
  cornerMobNW.querySelectorAll("img")[0].attributes.src.endsWith("/encounters/mob_top_corner_edge.png"),
  "NW corner Mob uses mob_top_corner_edge wedge sprite"
);
const cornerSoothNE = renderDynamicEdgeSlotNode("NE", "soothsayer", "B2");
const cornerPatSW = renderDynamicEdgeSlotNode("SW", "patricii:1", "B2");
assert(
  cornerSoothNE.querySelectorAll("img")[0].classList.contains("is-compact-corner") &&
    cornerPatSW.querySelectorAll("img")[0].classList.contains("is-compact-corner"),
  "Corner Soothsayer and Patricius stay compact with is-compact-corner"
);

// 9. Item 5: Verify Clock Board, Hour Token Piece, Key, and Roll Charts in Delivery view
gsRome.turn = 4;
gsRome.turnHourLabel = "11:00 P.M.";
const clockEl = renderRomeClockBoard(gsRome);
const clockText = collectAllText(clockEl);
assert(clockEl.id === "rome-clock-board", "Clock board renders #rome-clock-board");
assert(clockEl.querySelectorAll(".rome-clock-hour-slot").length === 11, "Clock board shows Hours I..X plus Dawn");
assert(clockEl.querySelectorAll(".rome-clock-token").length === 1, "Clock board places exactly 1 active hour game piece");
const activeSlots = clockEl.querySelectorAll(".is-active");
assert(activeSlots.length === 1 && collectAllText(activeSlots[0]).includes("11:00 P.M."), "Active clock slot matches Turn 4 (11:00 P.M.)");
assert(
  clockText.includes("PATRICII") &&
    clockText.includes("PERSISTENT") &&
    clockText.includes("REFRESH") &&
    clockText.includes("GAMBLING") &&
    clockText.includes("GREEN BORDER") &&
    clockText.includes("RED BORDER") &&
    clockText.includes("Theater Troupe") &&
    clockText.includes("Angry Mob") &&
    clockText.includes("Soothsayer") &&
    clockText.includes("Driver Fate"),
  "Clock board includes expanded Key and all 4 Roll Charts"
);
const leftStack = clockEl.querySelectorAll(".rome-clock-left-stack")[0];
const leftStackText = collectAllText(leftStack);
const leftImgs = leftStack.querySelectorAll("img").map((im) => im.attributes.src || "");
assert(
  leftStack &&
    leftStackText.includes("Stadium Gambling") &&
    leftStackText.includes("Triple Up") &&
    leftImgs.some((s) => s.endsWith("/assets/icons/dice.png")),
  "Stadium Gambling renders under Key with valid Rome dice.png icon"
);

// Verify Random 2 & 2 button is removed on setup_discard and Match Fixing has no Play button in hand
const gsDiscUi = buildMinimalGs("setup_discard");
gsDiscUi.players[0].missions = [{ id: "m1" }, { id: "m2" }, { id: "m3" }, { id: "m4" }];
gsDiscUi.players[0].influence = [{ id: "i1" }, { id: "i2" }, { id: "i3" }, { id: "i4" }];
const discPanel = renderSetupDiscardPanel(gsDiscUi.players[0]);
const discText = collectAllText(discPanel);
assert(!discText.includes("Random 2 & 2") && discText.includes("Auto-Select 2 & 2"), "Setup discard removed Random 2 & 2 button");

const gsHandMf = buildMinimalGs("delivery");
gsHandMf.players[0].position = "B1";
gsHandMf.players[0].influence = [{ id: "mf1", name: "Match Fixing", effectCode: "match_fixing", cost: 4 }];
appState.gameState = gsHandMf;
const mfHandText = collectAllText(renderTabletopView());
assert(!mfHandText.includes("▶ Play") && mfHandText.includes("Play in Gamble UI"), "Match Fixing shows Gamble UI badge instead of Play button in hand");

// 10. Item 3: Verify Guided First-Season Tutorial progression & disable checkbox
const tut = window.NightMerchantTutorial;
assert(tut && typeof tut.computeActiveTutorialStep === "function", "NightMerchantTutorial exported");
const gsTut = buildMinimalGs("setup_discard");
gsTut.season = "Spring";
const v0 = gsTut.players[0];
const stepDiscard = tut.computeActiveTutorialStep(gsTut, v0, { enabled: true });
assert(
  stepDiscard &&
    stepDiscard.id === "spring_setup_discard" &&
    stepDiscard.paragraphs.join(" ").includes("If an Influence card doesn’t seem valuable or if you don’t understand it, toss it.") &&
    stepDiscard.paragraphs.join(" ").includes("Check out the goods that have populated the market board before deciding to keep any Sell missions."),
  "Tutorial Step 1 includes required quotes"
);

gsTut.phase = "setup_climate";
const stepClimate = tut.computeActiveTutorialStep(gsTut, v0, { enabled: true });
assert(stepClimate && stepClimate.id === "spring_setup_climate", "Tutorial Step 2 opens on setup_climate");

gsTut.phase = "market";
v0.cash = 10;
gsTut.marketMeta = {
  Grain: { scarcitySymbol: ">>", scarcityLabel: "Abundant (>>)" },
  Wine: { scarcitySymbol: "=", scarcityLabel: "Uncommon (=)" },
};
// colIndex 5 (">>") is Abundant column; colIndex 3 ("=") is Uncommon column even on Grain!
gsTut.marketBoard = {
  Grain: [
    null,
    null,
    null,
    { id: "g_uncommon", name: "Mid Rye", currentBuyPrice: 9, colIndex: 3, colSymbol: "=" },
    null,
    { id: "g_abundant", name: "Abundant Wheat", currentBuyPrice: 6, colIndex: 5, colSymbol: ">>" },
    null,
  ],
  Wine: [
    null,
    null,
    null,
    { id: "w_1", name: "Cheap Jug", currentBuyPrice: 2, colIndex: 3, colSymbol: "=" },
  ],
};
// While a rival is active or NPC pacing is running, market tutorial must wait!
gsTut.activePlayerIndex = 1;
assert(tut.computeActiveTutorialStep(gsTut, v0, { enabled: true }) === null, "Market tutorial waits when another player is active");
gsTut.activePlayerIndex = 0;
assert(
  tut.computeActiveTutorialStep(gsTut, v0, { enabled: true, isNpcPacing: true }) === null,
  "Market tutorial waits while rival turn animations are playing"
);
const stepMarketBuy = tut.computeActiveTutorialStep(gsTut, v0, { enabled: true });
assert(
  stepMarketBuy &&
    stepMarketBuy.id === "spring_market_buy" &&
    stepMarketBuy.paragraphs.join(" ").includes("Abundant Wheat") &&
    !stepMarketBuy.paragraphs.join(" ").includes("Mid Rye"),
  "Tutorial Market recommends affordable good actually in the Abundant (>>) column"
);
v0.cash = 2; // Now cannot afford Abundant Wheat (6), should pick cheapest affordable Wine (2)
const stepMarketCheap = tut.computeActiveTutorialStep(gsTut, v0, { enabled: true });
assert(
  stepMarketCheap && stepMarketCheap.paragraphs.join(" ").includes("Cheap Jug"),
  "Tutorial Market falls back to cheapest affordable good when Abundant (>>) column is unaffordable"
);
v0.marketBought = 1;
const stepMarketPass = tut.computeActiveTutorialStep(gsTut, v0, { enabled: true });
assert(
  stepMarketPass &&
    stepMarketPass.id === "spring_market_pass" &&
    stepMarketPass.paragraphs.join(" ").toLowerCase().includes("multiple times"),
  "Tutorial warns player they may need to click Pass multiple times"
);

gsTut.phase = "delivery_entry";
const stepScoutC3 = tut.computeActiveTutorialStep(gsTut, v0, { enabled: true });
assert(stepScoutC3 && stepScoutC3.id === "spring_entry_scout_c3" && stepScoutC3.paragraphs.join(" ").includes("C3"), "Tutorial prompts Scouting C3 before entering");
v0.scoutedInfo = [{ targetType: "tile", targetKey: "C3", revealedData: { name: "Forum" } }];
const stepForumExplained = tut.computeActiveTutorialStep(gsTut, v0, { enabled: true });
assert(
  stepForumExplained &&
    stepForumExplained.id === "spring_entry_c3_explained" &&
    stepForumExplained.paragraphs.join(" ").includes("D3") &&
    stepForumExplained.paragraphs.join(" ").includes("D4") &&
    stepForumExplained.paragraphs.join(" ").includes("Buy and Sell"),
  "Tutorial explains 3 Forum tiles C3/D3/D4 after scouting C3"
);
const stepEnterB1 = tut.computeActiveTutorialStep(gsTut, v0, {
  enabled: true,
  dismissedSteps: new Set(["spring_entry_c3_explained"]),
});
assert(stepEnterB1 && stepEnterB1.id === "spring_entry_enter_b1" && stepEnterB1.paragraphs.join(" ").includes("B1"), "Tutorial prompts entering at B1 after scouting");

gsTut.phase = "delivery";
v0.position = "B1";
const stepNextScout = tut.computeActiveTutorialStep(gsTut, v0, { enabled: true });
assert(stepNextScout && stepNextScout.id === "spring_delivery_scout_next", "Tutorial prompts scouting next planned tile on entering Rome");
const stepTx = tut.computeActiveTutorialStep(gsTut, v0, { enabled: true, hasTransaction: true });
assert(stepTx && stepTx.id === "spring_delivery_transaction", "Tutorial explains first available hourly transaction");
gsTut.turn = 6;
gsTut.turnHourLabel = "1:00 A.M.";
const stepTurn6 = tut.computeActiveTutorialStep(gsTut, v0, { enabled: true, hasTransaction: false });
assert(stepTurn6 && stepTurn6.id === "spring_delivery_turn6_curfew" && stepTurn6.paragraphs.join(" ").includes("Turn 10"), "Tutorial reminds player on Turn 6 to exit on Turn 10 or sooner");
gsTut.pendingEncounter = { playerIndex: 0, card: { name: "Patrician" } };
const stepEnc = tut.computeActiveTutorialStep(gsTut, v0, { enabled: true });
assert(stepEnc && stepEnc.id === "spring_delivery_encounter", "Tutorial explains first Encounter immediately");
gsTut.season = "Summer";
assert(tut.computeActiveTutorialStep(gsTut, v0, { enabled: true }) === null, "Tutorial stops after Season 1 (Spring)");

// Verify popup DOM renders disable checkbox and unchecking works + Profile toggle present
appState.activeTab = "tabletop";
appState.user = { id: 1, username: "test", settings: { tutorialEnabled: true } };
gsTut.season = "Spring";
gsTut.phase = "setup_discard";
gsTut.pendingEncounter = null;
appState.gameState = gsTut;
tut.syncTutorialUiInDom();
const popupNode = document.querySelector("#nm-tutorial-popup");
assert(popupNode !== null && document.querySelector("#tutorial-disable-checkbox") !== null, "Rendered tutorial popup contains #tutorial-disable-checkbox");
tut.setTutorialEnabledPreference(false);
assert(tut.isTutorialEnabled() === false && document.querySelector("#nm-tutorial-popup") === null, "Disabling tutorial immediately removes popup");
const profileEl = renderProfileView();
assert(collectAllText(profileEl).includes("Guided First-Season Tutorial"), "Profile view renders tutorial preference toggle");

// 10. Verify ifCarrying contraband threat formatting & no_contraband encounter UI
assert(formatReactionCondition("-1..0") === "-1 to 0", "formatReactionCondition formats negative-to-zero range");
assert(formatReactionCondition("0..1") === "0-1", "formatReactionCondition formats zero-to-one range");
const carrySym = formatReactionTypeSymbol({ type: "combat", ifCarrying: "Weapons or Fine Wine" });
assert(carrySym.includes("Weapons or Fine Wine") && carrySym.includes("(COMBAT_ICON)"), "formatReactionTypeSymbol includes ifCarrying and combat icon");
assert(formatReactionTypeSymbol({ type: "no_contraband", ifCarrying: "Weapons" }) === "✓", "formatReactionTypeSymbol renders no_contraband checkmark");

const gsContra = buildMinimalGs("delivery");
gsContra.viewerPlayerIndex = 0;
const contraCard = {
  id: "leg_6",
  name: "Night Patrol",
  faction: "Caracalla",
  deck: "legiones",
  combat: "X(R)",
  friendlyFavor: "+Caracalla",
  hostileFavor: "-Caracalla",
  actionText: "Inspecting cart for Weapons or Fine Wine — none found.",
  reactions: [
    { condition: "<=-2", type: "combat" },
    { condition: "-1..0", type: "combat", ifCarrying: "Weapons or Fine Wine" },
    { condition: ">=1", type: "offer", actionText: "? 6(d) Bribe" },
  ],
};
const contraPend = {
  playerIndex: 0,
  deck: "legiones",
  card: contraCard,
  reaction: "no_contraband",
  reactionType: "no_contraband",
  matchedTierIndex: 1,
  combatMandatory: false,
  canInitiateCombat: false,
  stage: "pre_decision",
};
gsContra.pendingEncounter = contraPend;
const contraCardEl = renderPhysicalEncounterCardNode(contraCard, contraPend, { interactive: true });
const contraTierCells = contraCardEl.querySelectorAll(".phys-enc-tier-cell");
assert(contraTierCells.length === 3, "Physical encounter card renders 3 reaction tiers");
assert(collectAllText(contraTierCells[1]).includes("✓"), "Active no_contraband tier displays ✓ instead of combat icon");
assert(!contraTierCells[1].className.includes("enc-section-locked"), "Active no_contraband tier is not combat-locked");
assert(contraTierCells[1].className.includes("section-fulfill"), "Active no_contraband tier is clickable to pass inspection");

const contraPanelEl = renderPendingEncounterPanel(gsContra, gsContra.players[0]);
const contraPanelTxt = collectAllText(contraPanelEl);
assert(contraPanelTxt.includes("Contraband Inspection Passed"), "Encounter panel renders Contraband Inspection Passed banner");
assert(contraPanelTxt.includes("✓ Pass Inspection (No Contraband)"), "Encounter panel renders Pass Inspection button");
assert(!contraPanelTxt.includes("Refuse Request") && !contraPanelTxt.includes("Decline / Pass Offer"), "Encounter panel hides Refuse button for no_contraband");

print("JS_UI_TESTS_PASSED");
