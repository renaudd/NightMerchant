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

assert(getInfluenceCardEffectText(inf2Catalog).includes("8(d)") && getInfluenceCardEffectText(inf2Catalog).includes("lose 1 Caracalla") && getInfluenceCardEffectText(inf2Catalog).includes("1 Domna"), "inf_2 effectText");
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

print("JS_UI_TESTS_PASSED");
