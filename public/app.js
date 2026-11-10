/*
 * Night Merchant: All Roads Lead to Rome (211 A.D.)
 * Copyright (c) 2026 Dashiell Renaud.
 *
 * Licensed under the Creative Commons Attribution-NonCommercial-NoDerivatives 4.0
 * International License (CC BY-NC-ND 4.0).
 * https://creativecommons.org/licenses/by-nc-nd/4.0/
 */

function getNightMerchantRuntimeConfig() {
  if (typeof window !== "undefined" && window.NIGHTMERCHANT_CONFIG && typeof window.NIGHTMERCHANT_CONFIG === "object") {
    return window.NIGHTMERCHANT_CONFIG;
  }
  return {};
}

function getNightMerchantApiBaseUrl() {
  const cfg = getNightMerchantRuntimeConfig();
  const raw = typeof cfg.apiBaseUrl === "string" ? cfg.apiBaseUrl.trim() : "";
  return raw.replace(/\/+$/, "");
}

function resolveAssetUrl(rawUrl) {
  const s = String(rawUrl || "");
  if (s.startsWith("/assets/")) {
    return `.${s}`;
  }
  return s;
}

function maskEmailClient(rawEmail) {
  const s = String(rawEmail || "").trim();
  if (!s || !s.includes("@")) return "email on file";
  const parts = s.split("@");
  const local = parts[0] || "";
  const domain = parts[1] || "";
  const domParts = domain.split(".");
  const domHead = domParts[0] || "";
  const domTail = domParts.length > 1 ? `.${domParts.slice(1).join(".")}` : "";
  const maskedLocal = local ? `${local[0]}***` : "***";
  const maskedDom = domHead ? `${domHead[0]}***${domTail}` : "***";
  return `${maskedLocal}@${maskedDom}`;
}

let _fbAuthModule = null;
let _fbAuthInstance = null;
let _fbInitPromise = null;

function getEffectiveFirebaseConfig() {
  const cfg = getNightMerchantRuntimeConfig();
  const baseFb = cfg && cfg.firebaseConfig && typeof cfg.firebaseConfig === "object" ? cfg.firebaseConfig : {};
  const runtimeFb =
    typeof appState !== "undefined" &&
    appState &&
    appState.runtimeFirebaseConfig &&
    typeof appState.runtimeFirebaseConfig === "object"
      ? appState.runtimeFirebaseConfig
      : {};
  const merged = { ...baseFb, ...runtimeFb };
  if (typeof merged.apiKey === "string") {
    merged.apiKey = merged.apiKey.replace(/^[<>"'\s]+|[<>"'\s]+$/g, "");
  }
  if (typeof merged.projectId === "string") {
    merged.projectId = merged.projectId.replace(/^[<>"'\s]+|[<>"'\s]+$/g, "");
  }
  return merged;
}

function isFirebaseClientConfigured() {
  if (typeof appState !== "undefined" && appState && appState.serverFirebaseEnabled === false && !getNightMerchantApiBaseUrl()) {
    return false;
  }
  const fb = getEffectiveFirebaseConfig();
  return Boolean(fb && typeof fb.apiKey === "string" && fb.apiKey.trim() && typeof fb.projectId === "string" && fb.projectId.trim());
}

async function initFirebaseClientIfConfigured() {
  if (!isFirebaseClientConfigured()) return null;
  if (_fbAuthInstance) return _fbAuthInstance;
  if (_fbInitPromise) return _fbInitPromise;

  _fbInitPromise = (async () => {
    try {
      const fbCfg = getEffectiveFirebaseConfig();
      const [appMod, authMod] = await Promise.all([
        import("https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js"),
      ]);
      const existingApps = typeof appMod.getApps === "function" ? appMod.getApps() : [];
      const fbApp = existingApps.length > 0 ? existingApps[0] : appMod.initializeApp(fbCfg);
      const auth = authMod.getAuth(fbApp);
      if (typeof authMod.indexedDBLocalPersistence !== "undefined" && typeof authMod.setPersistence === "function") {
        try {
          await authMod.setPersistence(auth, authMod.indexedDBLocalPersistence);
        } catch (_persistErr) {
          if (typeof authMod.inMemoryPersistence !== "undefined") {
            await authMod.setPersistence(auth, authMod.inMemoryPersistence).catch(() => {});
          }
        }
      }
      if (typeof auth.authStateReady === "function") {
        await auth.authStateReady();
      }
      _fbAuthModule = authMod;
      _fbAuthInstance = auth;
      return auth;
    } catch (err) {
      console.error("[NightMerchant] Firebase client init failed:", err);
      _fbInitPromise = null;
      return null;
    }
  })();

  return _fbInitPromise;
}

async function getFirebaseIdToken() {
  if (!isFirebaseClientConfigured()) return null;
  const auth = await initFirebaseClientIfConfigured();
  if (!auth || !auth.currentUser) return null;
  try {
    return await auth.currentUser.getIdToken();
  } catch (_err) {
    return null;
  }
}

async function signInWithFirebaseCustomToken(customToken) {
  if (!customToken || !isFirebaseClientConfigured()) return null;
  const auth = await initFirebaseClientIfConfigured();
  if (!auth || !_fbAuthModule) return null;
  const cred = await _fbAuthModule.signInWithCustomToken(auth, customToken);
  return cred && cred.user ? cred.user.getIdToken() : null;
}

async function signInWithFirebaseEmailPassword(email, password) {
  if (!email || !password || !isFirebaseClientConfigured()) return null;
  const auth = await initFirebaseClientIfConfigured();
  if (!auth || !_fbAuthModule || typeof _fbAuthModule.signInWithEmailAndPassword !== "function") return null;
  try {
    const cred = await _fbAuthModule.signInWithEmailAndPassword(auth, email, password);
    return cred && cred.user ? cred.user.getIdToken() : null;
  } catch (_err) {
    return null;
  }
}

async function signInWithFirebaseGooglePopup() {
  const auth = await initFirebaseClientIfConfigured();
  if (!auth || !_fbAuthModule) {
    throw new Error("Firebase Google Sign-In is not configured on the server yet.");
  }
  const provider = new _fbAuthModule.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const cred = await _fbAuthModule.signInWithPopup(auth, provider);
  if (!cred || !cred.user) {
    throw new Error("Google sign-in did not return a user credential.");
  }
  return cred.user.getIdToken();
}

async function signOutFirebaseClient() {
  if (!_fbAuthInstance || !_fbAuthModule) return;
  try {
    await _fbAuthModule.signOut(_fbAuthInstance);
  } catch (_err) {}
}

const COLS = ["A", "B", "C", "D", "E", "F"];
const ROWS = ["1", "2", "3", "4", "5", "6"];
const TRACK_NAMES = ["Grain", "Animals", "Wine", "Weapons", "Marble", "Guards"];
const COL_SYMBOLS = ["<<", "<", "=", "=", ">", ">>"];

const MARKET_COLUMNS_META = [
  { col: 1, symbol: "<<", title: "Precious", note: "Buy @ << • Sells @ <<" },
  { col: 2, symbol: "<", title: "Rare", note: "Buy @ < • Sells @ <" },
  { col: 3, symbol: "=", title: "Uncommon", note: "Buy @ = • Sells @ =" },
  { col: 4, symbol: "=", title: "Uncommon", note: "Buy @ = • Sells @ =" },
  { col: 5, symbol: ">", title: "Common", note: "Buy @ > • Sells @ >" },
  { col: 6, symbol: ">>", title: "Abundant", note: "Buy @ >> • Sells @ >>" },
];

const ROME_LANDMARKS = {
  A1: { icon: "🏛️", sub: "Mausoleum Hadriani (Hadrian's Tomb)" },
  B1: { icon: "⛩️", sub: "Via Flaminia (North Entrance)" },
  C1: { icon: "⛰️", sub: "Pincian Hill & Gardens" },
  D1: { icon: "🌿", sub: "Gardens of Sallust" },
  E1: { icon: "⛩️", sub: "Via Nomentana (NE Entrance)" },
  F1: { icon: "🏰", sub: "Praetorian Fortress Camp" },
  A2: { icon: "🏟️", sub: "Stadium of Domitian" },
  B2: { icon: "🏛️", sub: "Pantheum & Thermae Neronianae" },
  C2: { icon: "🏛️", sub: "Portico of Saepta Julia" },
  D2: { icon: "⛰️", sub: "Quirinal Hill" },
  E2: { icon: "🏘️", sub: "Subura Tenement Valley" },
  F2: { icon: "⛰️", sub: "Viminal Hill" },
  A3: { icon: "🎭", sub: "Stone Theater of Pompey" },
  B3: { icon: "🏟️", sub: "Flaminian Circus" },
  C3: { icon: "🏛️", sub: "Imperial Forum & Column" },
  D3: { icon: "🏛️", sub: "Temple of Mars Ultor" },
  E3: { icon: "♨️", sub: "Grand Baths of Trajan" },
  F3: { icon: "⛩️", sub: "Via Tiburtina (East Entrance)" },
  A4: { icon: "⛩️", sub: "Via Aurelia (West Entrance)" },
  B4: { icon: "🌉", sub: "Tiber Island & Bridges" },
  C4: { icon: "⛰️", sub: "Capitoline Hill & Jupiter Temple" },
  D4: { icon: "🏛️", sub: "Temple of Peace (Forum)" },
  E4: { icon: "🏟️", sub: "The Colosseum (Flavian)" },
  F4: { icon: "⛰️", sub: "Esquiline Hill" },
  A5: { icon: "🌿", sub: "Gardens of Julius Caesar" },
  B5: { icon: "⛰️", sub: "Aventine Hill" },
  C5: { icon: "🏇", sub: "Chariot Hippodrome" },
  D5: { icon: "👑", sub: "Palatine Hill & Palaces" },
  E5: { icon: "🏘️", sub: "Caelian Subura Slope" },
  F5: { icon: "🏟️", sub: "Severan Amphitheater" },
  A6: { icon: "🏺", sub: "Mons Testaceus Amphora Hill" },
  B6: { icon: "⛩️", sub: "Via Ostiensis & Pyramid" },
  C6: { icon: "⛰️", sub: "Lesser Aventine (Remuria)" },
  D6: { icon: "♨️", sub: "Baths of Caracalla (Under Construction, 211 A.D.)" },
  E6: { icon: "⛰️", sub: "Caelian Hill" },
  F6: { icon: "⛩️", sub: "Via Tusculana (SE Entrance)" },
};

const FACTION_META = [
  {
    key: "Caracalla",
    gem: "/assets/icons/ruby.png",
    color: "#b91c1c",
    gemSingular: "ruby",
    gemPlural: "rubies",
    title: "Emperor Marcus Aurelius Antoninus (Caracalla)",
    bio: "Born Septimius Bassianus (later nicknamed Caracalla after the hooded Gallic tunic he favored), he is mercurial, ruthless, and enjoys the greatest favor with the Legiones. In December 211 he will purge Geta's supporters and reward his closest loyalists.",
    alignedWith: ["Domna"],
    hostileTo: ["Geta", "Plautilla", "Aurelius (passively hostile)"],
    alignmentNote: "Caracalla is hostile to Geta and Plautilla, allied with Domna, and passively hostile to the Aurelians.",
    defaultDeckCounts: { patricii: 2, legiones: 9, nefarii: 5, total: 16 },
  },
  {
    key: "Geta",
    gem: "/assets/icons/emerald.png",
    color: "#047857",
    gemSingular: "emerald",
    gemPlural: "emeralds",
    title: "Co-Emperor Publius Septimius Geta",
    bio: "Co-emperor Publius Septimius Geta will be murdered in his mother's arms on December 26, 211 A.D., and anyone openly linked to him faces damnatio memoriae. Geta is entitled and cheap during the year, while his Tiber Bridge tolls and Winter Reckoning stakes depend on the active Political Climate.",
    alignedWith: ["Domna"],
    hostileTo: ["Caracalla", "Plautilla (less so)", "Aurelius (less so)"],
    alignmentNote: "Geta is hostile to Caracalla, and less so to Plautilla and the Aurelians, and is aligned with Domna.",
    defaultDeckCounts: { patricii: 5, legiones: 5, nefarii: 5, total: 15 },
  },
  {
    key: "Domna",
    gem: "/assets/icons/diamond.png",
    color: "#475569",
    gemSingular: "diamond",
    gemPlural: "diamonds",
    title: "Empress Mother Julia Domna",
    bio: "Julia Domna, empress mother to Bassianus (Caracalla) and Geta, is remembered for her patronage of sophists, jurists, and scholars. Domna loves both of her sons, strives to mediate their feud, and shapes the imperial court's Political Climate.",
    alignedWith: ["Caracalla", "Geta"],
    hostileTo: ["Plautilla", "Aurelius"],
    alignmentNote: "Domna is hostile to Plautilla and the Aurelians, and allied with Caracalla and Geta.",
    defaultDeckCounts: { patricii: 8, legiones: 3, nefarii: 5, total: 16 },
  },
  {
    key: "Plautilla",
    gem: "/assets/icons/sapphire.png",
    color: "#0369a1",
    gemSingular: "sapphire",
    gemPlural: "sapphires",
    title: "Exiled Augusta Fulvia Plautilla",
    bio: "Exiled Augusta Fulvia Plautilla, daughter of Severus' executed prefect Plautianus. Rumored to sneak back into Rome at night in disguise through smuggler rings, Plautilla is loved by criminals and enjoys the greatest favor with the Nefarii.",
    alignedWith: ["Aurelius"],
    hostileTo: ["Caracalla (most hostile)", "Geta", "Domna"],
    alignmentNote: "Plautilla is most hostile to Caracalla, but also to Geta and Domna, and is allied with the Aurelians.",
    defaultDeckCounts: { patricii: 3, legiones: 8, nefarii: 8, total: 19 },
  },
  {
    key: "Aurelius",
    gem: "/assets/icons/amethyst.png",
    color: "#7e22ce",
    gemSingular: "amethyst",
    gemPlural: "amethysts",
    title: "Lucius Aurelius Commodus Pompeianus (The Aurelians)",
    bio: "Lucius Aurelius Commodus Pompeianus leads the old Claudio-Aurelian senatorial aristocracy that ruled Rome before the Severans. Revered by the Patricii, his faction rewards loyalists handsomely while risking Caracalla's suspicion.",
    alignedWith: ["Plautilla"],
    hostileTo: ["Caracalla", "Geta", "Domna (less so)"],
    alignmentNote: "Hostile to Caracalla and Geta, less so to Domna, and allied with Plautilla.",
    defaultDeckCounts: { patricii: 8, legiones: 3, nefarii: 3, total: 14 },
  },
];

const DEFAULT_POLITICAL_CLIMATE_FACTORS = [
  { id: "Caracalla", label: "Caracalla", gemName: "Ruby", subtitle: "Severan Co-Emperor" },
  { id: "Geta", label: "Geta", gemName: "Emerald", subtitle: "Rival Co-Emperor" },
  { id: "Domna", label: "Julia Domna", gemName: "Diamond", subtitle: "Empress Mother" },
  { id: "Plautilla", label: "Plautilla", gemName: "Sapphire", subtitle: "Exiled Augusta" },
  { id: "Aurelius", label: "Aurelians", gemName: "Amethyst", subtitle: "Old Senate Dynasty" },
  { id: "Missions", label: "Missions", gemName: "Contracts", subtitle: "Collegia & Patrons" },
];

const DEFAULT_POLITICAL_CLIMATE_OPTIONS = [
  {
    id: "caracalla_1",
    factor: "Caracalla",
    factorLabel: "Caracalla",
    gemName: "Ruby",
    optionNumber: 1,
    timing: "endgame",
    title: "Imperial Proscription",
    shortText: "Least Caracalla favor is eliminated",
    description: "End of game: Least Caracalla favor is eliminated.",
  },
  {
    id: "caracalla_2",
    factor: "Caracalla",
    factorLabel: "Caracalla",
    gemName: "Ruby",
    optionNumber: 2,
    timing: "endgame",
    title: "Praetorian Backlash",
    shortText: "-10d per +Ruby; +5d per -Ruby",
    description: "End of game: Lose 10d per +Ruby; gain 5d per -Ruby.",
  },
  {
    id: "caracalla_3",
    factor: "Caracalla",
    factorLabel: "Caracalla",
    gemName: "Ruby",
    optionNumber: 3,
    timing: "midgame",
    title: "Army Pay Hike",
    shortText: "Legiones +2 CP; +1 CP per +Ruby",
    description: "Legiones gain +2 CP. Each +Ruby gives your Cart +1 CP.",
  },
  {
    id: "geta_1",
    factor: "Geta",
    factorLabel: "Geta",
    gemName: "Emerald",
    optionNumber: 1,
    timing: "endgame",
    title: "Brother's Grudge",
    shortText: "Least Geta favor loses 25d",
    description: "End of game: Least Geta favor loses 25d.",
  },
  {
    id: "geta_2",
    factor: "Geta",
    factorLabel: "Geta",
    gemName: "Emerald",
    optionNumber: 2,
    timing: "endgame",
    title: "Jealous Brothers",
    shortText: "+15d/+Emerald if Caracalla ≤ 0, -10d if ≥ +1; -5d/-Emerald",
    description: "End of game: +15d per +Emerald if Caracalla ≤ 0, or -10d if ≥ +1; -5d per -Emerald.",
  },
  {
    id: "geta_3",
    factor: "Geta",
    factorLabel: "Geta",
    gemName: "Emerald",
    optionNumber: 3,
    timing: "midgame",
    title: "Divided Tiber",
    shortText: "Tiber Bridges cost 4d toll, waived with +1 Emerald",
    description: "Tiber Bridges cost a 4d toll, waived with +1 Emerald or Shortcut.",
  },
  {
    id: "domna_1",
    factor: "Domna",
    factorLabel: "Julia Domna",
    gemName: "Diamond",
    optionNumber: 1,
    timing: "endgame",
    title: "Imperial Patronage",
    shortText: "Most Domna favor gains +20% wealth",
    description: "End of game: Most Domna favor gains +20% wealth.",
  },
  {
    id: "domna_2",
    factor: "Domna",
    factorLabel: "Julia Domna",
    gemName: "Diamond",
    optionNumber: 2,
    timing: "endgame",
    title: "Court Neutrality",
    shortText: "-15d per +Diamond and -15d per -Diamond",
    description: "End of game: Lose 15d per +Diamond and 15d per -Diamond.",
  },
  {
    id: "domna_3",
    factor: "Domna",
    factorLabel: "Julia Domna",
    gemName: "Diamond",
    optionNumber: 3,
    timing: "midgame",
    title: "Empress Mediator",
    shortText: "Exchange +Diamonds 1-for-1 for +Rubies or +Emeralds",
    description: "Exchange +Diamonds 1-for-1 into +Rubies or +Emeralds anytime.",
  },
  {
    id: "plautilla_1",
    factor: "Plautilla",
    factorLabel: "Plautilla",
    gemName: "Sapphire",
    optionNumber: 1,
    timing: "endgame",
    title: "Exile's Informants",
    shortText: "Most Plautilla favor steals 15d from wealthiest rival",
    description: "End of game: Most Plautilla favor steals 15d from the wealthiest rival.",
  },
  {
    id: "plautilla_2",
    factor: "Plautilla",
    factorLabel: "Plautilla",
    gemName: "Sapphire",
    optionNumber: 2,
    timing: "endgame",
    title: "Smuggled Dowry",
    shortText: "+10d per completed Plautilla Mission",
    description: "End of game: Gain 10d per completed Mission with +Sapphire or a Plautilla patron.",
  },
  {
    id: "plautilla_3",
    factor: "Plautilla",
    factorLabel: "Plautilla",
    gemName: "Sapphire",
    optionNumber: 3,
    timing: "midgame",
    title: "Smuggler's Fence",
    shortText: "Fenced cargo +1 Scarcity and no Mission failure",
    description: "Fenced cargo sells +1 Scarcity step higher and does not fail the Mission.",
  },
  {
    id: "aurelius_1",
    factor: "Aurelius",
    factorLabel: "Aurelians",
    gemName: "Amethyst",
    optionNumber: 1,
    timing: "endgame",
    title: "Old Senate Purse",
    shortText: "Most Aurelian favor gains 25d",
    description: "End of game: Most Aurelian favor gains 25d.",
  },
  {
    id: "aurelius_2",
    factor: "Aurelius",
    factorLabel: "Aurelians",
    gemName: "Amethyst",
    optionNumber: 2,
    timing: "endgame",
    title: "Choose a Side",
    shortText: "+10d per +Amethyst and +10d per -Amethyst",
    description: "End of game: Gain 10d per +Amethyst and 10d per -Amethyst.",
  },
  {
    id: "aurelius_3",
    factor: "Aurelius",
    factorLabel: "Aurelians",
    gemName: "Amethyst",
    optionNumber: 3,
    timing: "midgame",
    title: "Senatorial Privilege",
    shortText: "Spend +Amethysts when selling for +1 Scarcity per gem",
    description: "Spend +Amethysts when selling a Good for +1 Scarcity step per gem.",
  },
  {
    id: "missions_1",
    factor: "Missions",
    factorLabel: "Missions",
    gemName: "Contracts",
    optionNumber: 1,
    timing: "endgame",
    title: "Master Purveyor",
    shortText: "Most completed Missions gains 30d",
    description: "End of game: Most completed Missions gains 30d.",
  },
  {
    id: "missions_2",
    factor: "Missions",
    factorLabel: "Missions",
    gemName: "Contracts",
    optionNumber: 2,
    timing: "endgame",
    title: "Guild Ledger",
    shortText: "+10d per completed Mission; -10d per failed Mission",
    description: "End of game: Gain 10d per completed Mission; lose 10d per failed or unfinished Mission.",
  },
  {
    id: "missions_3",
    factor: "Missions",
    factorLabel: "Missions",
    gemName: "Contracts",
    optionNumber: 3,
    timing: "midgame",
    title: "Bonded Couriers",
    shortText: "Completed Missions pay 2× cash; failed Missions fine 10d",
    description: "Completed Missions pay 2× Denarii; failed or unfinished Missions fine 10d.",
  },
];

function hasActiveClimateOption(gs, optionId) {
  if (!gs || !gs.politicalClimate || !Array.isArray(gs.politicalClimate.activeIds)) return false;
  return gs.politicalClimate.activeIds.includes(optionId);
}

const EDGE_LABELS = {
  green: "Green (Open)",
  red: "Red (Blocked)",
  toll_2: "Toll 2(d)",
  toll_10: "Toll 10(d)",
  toll_15: "Toll 15(d)",
  mob: "Angry Mob",
  theater: "Theater Troupe",
  soothsayer: "Soothsayer",
  patricii_1: "Patricii ×1",
  patricii_2: "Patricii ×2",
  patricii_3: "Patricii ×3",
  legiones_1: "Legiones ×1",
  legiones_2: "Legiones ×2",
  legiones_3: "Legiones ×3",
  legiones_4: "Legiones ×4",
  nefarii_1: "Nefarii ×1",
  nefarii_2: "Nefarii ×2",
  nefarii_3: "Nefarii ×3",
};

function parseTollAmount(edgeVal) {
  if (!edgeVal) return 0;
  const m = /^toll_(\d+)$/i.exec(String(edgeVal).trim());
  return m ? Number(m[1]) || 0 : 0;
}

function formatEdgeLabel(edgeVal) {
  if (!edgeVal) return "None";
  if (EDGE_LABELS[edgeVal]) return EDGE_LABELS[edgeVal];
  const tollAmt = parseTollAmount(edgeVal);
  if (tollAmt > 0) return `Toll ${tollAmt}(d)`;
  return String(edgeVal);
}

const WEST_BANK_CELLS = new Set(["A1", "A4", "B4", "A5"]);

const TIBER_BRIDGES = {
  "A1|B1": "Pons Aelius",
  "B1|A1": "Pons Aelius",
  "A1|A2": "Pons Neronianus",
  "A2|A1": "Pons Neronianus",
  "A3|A4": "Pons Agrippae",
  "A4|A3": "Pons Agrippae",
  "B4|C4": "Pons Fabricius",
  "C4|B4": "Pons Fabricius",
  "B4|B5": "Pons Aemilius",
  "B5|B4": "Pons Aemilius",
};

function getTiberBridgeName(fromCoord, toCoord) {
  if (!fromCoord || !toCoord) return null;
  return TIBER_BRIDGES[`${fromCoord}|${toCoord}`] || null;
}

function isTiberCrossingBlocked(fromCoord, toCoord) {
  if (!fromCoord || !toCoord || fromCoord === toCoord) return false;
  if (WEST_BANK_CELLS.has(fromCoord) === WEST_BANK_CELLS.has(toCoord)) return false;
  return !getTiberBridgeName(fromCoord, toCoord);
}

const DIR_DELTAS_8 = {
  N: [0, -1],
  NE: [1, -1],
  E: [1, 0],
  SE: [1, 1],
  S: [0, 1],
  SW: [-1, 1],
  W: [-1, 0],
  NW: [-1, -1],
};

function getNeighborCoordInDir(coord, dir) {
  if (!coord || !DIR_DELTAS_8[dir]) return null;
  const cIdx = COLS.indexOf(coord.slice(0, 1));
  const rIdx = ROWS.indexOf(coord.slice(1));
  if (cIdx < 0 || rIdx < 0) return null;
  const [dc, dr] = DIR_DELTAS_8[dir];
  const nc = cIdx + dc;
  const nr = rIdx + dr;
  if (nc < 0 || nc >= COLS.length || nr < 0 || nr >= ROWS.length) return null;
  return `${COLS[nc]}${ROWS[nr]}`;
}

const ROW_TO_ROMAN_ASSET = {
  "1": "I",
  "2": "II",
  "3": "III",
  "4": "IV",
  "5": "V",
  "6": "VI",
};

function getMonumentImageUrl(coord) {
  const c = String(coord || "B1").trim();
  if (c === "A1" || c === "AI") {
    return "/assets/monuments/A1.png?v=26";
  }
  const col = c.slice(0, 1);
  const rowPart = c.slice(1);
  const romanRow = ROW_TO_ROMAN_ASSET[rowPart] || rowPart;
  return `/assets/monuments/${col}${romanRow}.png?v=26`;
}

const CART_COLOR_PALETTE = [
  { id: "Z1", label: "Cobalt", hex: "#4A5FD4" },
  { id: "Z3", label: "Amber", hex: "#EBA439" },
  { id: "Z6", label: "Crimson", hex: "#862D25" },
  { id: "Z7", label: "Emerald", hex: "#49884B" },
  { id: "Z9", label: "Sapphire", hex: "#5BC8FA" },
  { id: "Z11", label: "Amethyst", hex: "#C589CF" },
  { id: "Z2", label: "Lime", hex: "#D4FF5E" },
  { id: "Z4", label: "Rose", hex: "#D89CB0" },
  { id: "Z5", label: "Citron", hex: "#9CA14B" },
  { id: "Z8", label: "Violet", hex: "#6F5E8B" },
  { id: "Z10", label: "Bronze", hex: "#795548" },
  { id: "Z12", label: "Silver", hex: "#9E9E9E" },
];

const DIE_SYMBOL_COLORS = {
  Ruby: "#c81e32",
  Red: "#c81e32",
  Cobalt: "#1d4ed8",
  Blue: "#1d4ed8",
  Emerald: "#047857",
  Green: "#047857",
  Gold: "#b45309",
  Yellow: "#b45309",
  Amethyst: "#7e22ce",
  Purple: "#7e22ce",
  Sapphire: "#0284c7",
  Cyan: "#0284c7",
  Z1: "#4A5FD4",
  Z2: "#6b8e23",
  Z3: "#d97706",
  Z4: "#be185d",
  Z5: "#65a30d",
  Z6: "#862D25",
  Z7: "#49884B",
  Z8: "#6F5E8B",
  Z9: "#0284c7",
  Z10: "#795548",
  Z11: "#9333ea",
  Z12: "#52525b",
  Black: "#111111",
  NPC: "#111111",
};

const DIE_SWATCH_COLORS = {
  Ruby: "#d62839",
  Red: "#d62839",
  Cobalt: "#2563eb",
  Blue: "#2563eb",
  Emerald: "#10b981",
  Green: "#10b981",
  Gold: "#f59e0b",
  Yellow: "#f59e0b",
  Amethyst: "#9333ea",
  Purple: "#9333ea",
  Sapphire: "#06b6d4",
  Cyan: "#06b6d4",
  Z1: "#4A5FD4",
  Z2: "#D4FF5E",
  Z3: "#EBA439",
  Z4: "#D89CB0",
  Z5: "#9CA14B",
  Z6: "#862D25",
  Z7: "#49884B",
  Z8: "#6F5E8B",
  Z9: "#5BC8FA",
  Z10: "#795548",
  Z11: "#C589CF",
  Z12: "#9E9E9E",
  Black: "#111111",
  NPC: "#111111",
};

function getCartColorLabel(colorId) {
  const found = CART_COLOR_PALETTE.find((c) => c.id === colorId);
  return found ? found.label : colorId || "Cobalt";
}

function getPlayerHexColor(colorId) {
  if (!colorId) return "#EBA439";
  if (typeof colorId === "string" && colorId.startsWith("#")) return colorId;
  const found = CART_COLOR_PALETTE.find((c) => c.id === colorId || c.label === colorId);
  if (found && found.hex) return found.hex;
  if (DIE_SWATCH_COLORS[colorId]) return DIE_SWATCH_COLORS[colorId];
  if (DIE_SYMBOL_COLORS[colorId]) return DIE_SYMBOL_COLORS[colorId];
  return "#EBA439";
}

/**
 * Renders a Roman two-wheeled merchant cart SVG icon colored with the player's cart color.
 * Replaces the old circular .color-dot / .cart-token across the UI.
 */
function renderCartIconNode(colorName, extraClass = "", titleText = "") {
  const safeColor = colorName || "Z1";
  const wrap = document.createElement("span");
  wrap.className = `cart-icon-wrap color-${safeColor}${extraClass ? " " + extraClass : ""}`;
  if (titleText) {
    wrap.setAttribute("data-hover-title", titleText);
  }
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 28 20");
  svg.setAttribute("class", "cart-icon-svg");
  svg.setAttribute("aria-hidden", "true");

  // Cart cargo bed & side rails
  const bed = document.createElementNS(svgNS, "path");
  bed.setAttribute(
    "d",
    "M2 5.5 C2 4.7 2.6 4 3.5 4 L17.5 4 C18.3 4 19 4.7 19 5.5 L19 11.5 L25.5 11.5 C26.3 11.5 26.8 12.1 26.8 12.8 C26.8 13.5 26.3 14 25.5 14 L2.5 14 C1.7 14 1.2 13.4 1.2 12.6 L2 5.5 Z"
  );
  bed.setAttribute("fill", "currentColor");
  bed.setAttribute("stroke", "#fff9ec");
  bed.setAttribute("stroke-width", "1.3");
  bed.setAttribute("stroke-linejoin", "round");
  svg.appendChild(bed);

  // Decorative Roman lattice slat on the cart body
  const slat = document.createElementNS(svgNS, "path");
  slat.setAttribute("d", "M4.5 7.5 L16.5 7.5 M4.5 10.2 L16.5 10.2");
  slat.setAttribute("stroke", "rgba(18, 12, 8, 0.55)");
  slat.setAttribute("stroke-width", "1.2");
  slat.setAttribute("stroke-linecap", "round");
  svg.appendChild(slat);

  // Spoked Roman wheel
  const wheelOuter = document.createElementNS(svgNS, "circle");
  wheelOuter.setAttribute("cx", "11");
  wheelOuter.setAttribute("cy", "14.5");
  wheelOuter.setAttribute("r", "4.3");
  wheelOuter.setAttribute("fill", "#1e1610");
  wheelOuter.setAttribute("stroke", "#fff9ec");
  wheelOuter.setAttribute("stroke-width", "1.4");
  svg.appendChild(wheelOuter);

  const wheelRim = document.createElementNS(svgNS, "circle");
  wheelRim.setAttribute("cx", "11");
  wheelRim.setAttribute("cy", "14.5");
  wheelRim.setAttribute("r", "2.6");
  wheelRim.setAttribute("fill", "currentColor");
  svg.appendChild(wheelRim);

  const wheelHub = document.createElementNS(svgNS, "circle");
  wheelHub.setAttribute("cx", "11");
  wheelHub.setAttribute("cy", "14.5");
  wheelHub.setAttribute("r", "1.1");
  wheelHub.setAttribute("fill", "#fff9ec");
  svg.appendChild(wheelHub);

  wrap.appendChild(svg);
  return wrap;
}

function renderGoogleLogoSvg() {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  const paths = [
    {
      fill: "#EA4335",
      d: "M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.4 1 3.5 3.6 1.6 7.4l3.7 2.8C6.2 7.2 8.9 5 12 5z",
    },
    {
      fill: "#4285F4",
      d: "M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.6l3.7 2.9c2.2-2 3.7-5 3.7-8.7z",
    },
    {
      fill: "#FBBC05",
      d: "M5.3 14.8c-.2-.8-.4-1.8-.4-2.8s.2-2 .4-2.8L1.6 6.4C.6 8.4 0 10.6 0 12s.6 3.6 1.6 5.6l3.7-2.8z",
    },
    {
      fill: "#34A853",
      d: "M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3.1 0-5.8-2.1-6.7-5l-3.7 2.8C3.5 19.9 7.4 23 12 23z",
    },
  ];
  for (const p of paths) {
    const pathEl = document.createElementNS(svgNS, "path");
    pathEl.setAttribute("fill", p.fill);
    pathEl.setAttribute("d", p.d);
    svg.appendChild(pathEl);
  }
  return svg;
}

const ROME_DIE_ROMAN_FACES = ["0", "0", "I", "I", "II", "III"];

const appState = {
  user: null,
  csrfToken: null,
  googleClientId: "",
  activeTab: "portal", // "portal" | "tabletop" | "rulebook" | "profile" | "completed_games"
  authMode: "login", // "login" | "register"
  games: [],
  leaderboard: [],
  completedGames: [],
  completedGamesLoading: false,
  shownFinishModalGameIds: new Set(),
  botPersonas: [],
  referenceCatalog: [],
  rulebookSection: "overview",
  rulebookSearch: "",
  currentGameId: null,
  gameSummary: null,
  gameState: null,
  boardViewMode: "auto", // "auto" | "rome" | "market" | "both"
  cartPanelTab: "cart", // "cart" | "navigate"
  inspectedCell: "C3",
  setupDiscardMissions: new Set(),
  setupDiscardInfluence: new Set(),
  cleanupKeepGuards: new Set(),
  cleanupInitializedSeason: null,
  promptedCargoPickups: new Set(),
  promptedCargoDeliveries: new Set(),
  promptedTop3Id: null,
  promptedNpcOfferId: null,
  promptedCartOverflowId: null,
  promptedMarketRewardId: null,
  highlightedMarketTrack: null,
  swappedMissionStackIds: new Set(),
  shownScoutIds: new Set(),
  pollTimer: null,
  lastSeenDiceSeq: null,
  diceRollQueue: [],
  activeDiceOverlay: null,
  isDiceRolling: false,
  diceTickCount: 0,
  diceAnimTimer: null,
  lastSeenMissionEventSeq: null,
  missionModalQueue: [],
  lastSyncedGameId: null,
  lastSyncedPhase: null,
  lastSyncedSeason: null,
  chronicleScrollTop: 0,
  chronicleUserScrolled: false,
  chronicleLastLogSig: null,
  chronicleLastGameId: null,
  armedDieAction: null,
  lastAutoScrolledEncounterKey: null,
  portalDraftName: "",
  portalMaxPlayers: 3,
  portalBotCount: 2,
  portalInviteMode: "open",
  portalInvitedUsernames: "",
  pendingInviteGameId: null,
  highlightedLobbyId: null,
  portalBotStrategies: ["balanced", "luxury", "aggressive", "faction", "opportunist"],
  lastSeenNpcEventSeq: null,
  npcPacingQueue: [],
  activeNpcEvent: null,
  npcPacingTimer: null,
  npcPacingTotal: 0,
  npcPacingIndex: 0,
  _wasViewerTurn: false,
  marketBoardScrollLeft: 0,
  marketBoardScrollTop: 0,
  climateBoardScrollLeft: 0,
};

function navigateToMarketBoardForCategory(category) {
  appState.highlightedMarketTrack = category || null;
  appState.boardViewMode = "market";
  renderApp();
  const marketEl = document.querySelector(".market-board");
  if (marketEl && typeof marketEl.scrollIntoView === "function") {
    marketEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

/**
 * Normalizes currency tokens like "60(d)", "60d", or "60𐆖" so the Roman Denarius symbol "𐆖"
 * is placed at the front of the price (e.g. "𐆖60", "+𐆖100", "<𐆖15").
 */
const DENARIUS_SYM = "𐆖";

function replaceDenariiTokens(rawStr) {
  return String(rawStr)
    .replace(
      /(\b|[+\-<>]=?)(\d+(?:\s*[x×*]\s*)?(?:\(R\)|\(r\)|®|🅁))(?:\(d\)|d\b|𐆖)/g,
      `$1${DENARIUS_SYM}$2`
    )
    .replace(
      /(\b|[+\-<>]=?)(\d+(?:\/\d+)*)(?:\(d\)|d\b|𐆖)/gi,
      `$1${DENARIUS_SYM}$2`
    )
    .replace(/\(d\)/gi, DENARIUS_SYM);
}

/**
 * Appends text to a DOM node, replacing:
 * - (d) or <num>d with the Roman Denarius symbol (𐆖)
 * - (R), (r), ®, or 🅁 with an inline square-enclosed 'R' symbol (<span class="rome-die-box">R</span>)
 */
const GAME_TOKEN_REGEX =
  /(\(SELL_SYM\)|\(BUY_SYM\)|\(COMBAT_ICON\)|\(DECK_ICON\)|\(QUEST_ICON\)|\(R\)|\(r\)|®|🅁|𐆖)/g;

/**
 * Builds an inline SVG vector Roman Denarius monogram (X with crossbar: 𐆖)
 * using createElementNS so it renders identically on mobile (iOS/Android) and desktop
 * without relying on missing U+10196 system font glyphs.
 */
function createDenariusSvgNode(extraClass = "") {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 16 18");
  svg.setAttribute("class", `denarius-sym-svg ${extraClass}`.trim());
  svg.setAttribute("aria-hidden", "true");

  const mkLine = (x1, y1, x2, y2, sw = "2.2") => {
    const ln = document.createElementNS(svgNS, "line");
    ln.setAttribute("x1", String(x1));
    ln.setAttribute("y1", String(y1));
    ln.setAttribute("x2", String(x2));
    ln.setAttribute("y2", String(y2));
    ln.setAttribute("stroke", "currentColor");
    ln.setAttribute("stroke-width", sw);
    ln.setAttribute("stroke-linecap", "round");
    return ln;
  };

  // Diagonal X strokes of the Roman Denarius monogram (X = 10 asses)
  svg.appendChild(mkLine(3, 2.5, 13, 15.5, "2.2"));
  svg.appendChild(mkLine(13, 2.5, 3, 15.5, "2.2"));
  // Horizontal crossbar through the center (𐆖)
  svg.appendChild(mkLine(1.5, 9, 14.5, 9, "1.95"));
  // Classical top & bottom serifs
  svg.appendChild(mkLine(1.8, 2.5, 5.2, 2.5, "1.6"));
  svg.appendChild(mkLine(10.8, 2.5, 14.2, 2.5, "1.6"));
  svg.appendChild(mkLine(1.8, 15.5, 5.2, 15.5, "1.6"));
  svg.appendChild(mkLine(10.8, 15.5, 14.2, 15.5, "1.6"));
  return svg;
}

/**
 * Builds a bold Green +𐆖 symbol representing Sell (or Fence) price on Goods cards.
 */
function createSellPriceSymbolNode(isFence = false) {
  const span = document.createElement("span");
  span.className = "price-sym-sell";
  span.setAttribute("data-hover-title", isFence ? "Fence Price (+d)" : "Sell Price (+d)");
  span.setAttribute("aria-label", isFence ? "Fence Price" : "Sell Price");
  span.appendChild(document.createTextNode("+"));
  span.appendChild(createDenariusSvgNode("price-sym-denarius-svg"));
  return span;
}

/**
 * Builds an italic Red -𐆖 symbol representing Buy (or Hire) price on Goods & Guard cards.
 */
function createBuyPriceSymbolNode(isGuard = false) {
  const span = document.createElement("span");
  span.className = "price-sym-buy";
  span.setAttribute("data-hover-title", isGuard ? "Hire Cost (-d)" : "Buy Price (-d)");
  span.setAttribute("aria-label", isGuard ? "Hire Cost" : "Buy Price");
  span.appendChild(document.createTextNode("-"));
  span.appendChild(createDenariusSvgNode("price-sym-denarius-svg"));
  return span;
}

/**
 * Builds an inline Combat icon node using the game's crossed-gladius artwork (/assets/icons/combat.png).
 */
function createCombatInlineIconNode(extraClass = "") {
  const img = document.createElement("img");
  img.className = `enc-tier-inline-icon combat-tier-icon ${extraClass}`.trim();
  img.src = resolveAssetUrl("/assets/icons/combat.png");
  img.alt = "Combat";
  img.setAttribute("data-hover-title", "Combat");
  return img;
}

/**
 * Builds an inline SVG vector icon representing a fanned Roman Deck of Cards.
 */
function createDeckOfCardsIconNode(extraClass = "") {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 24 22");
  svg.setAttribute("class", `enc-tier-inline-svg deck-cards-icon-svg ${extraClass}`.trim());
  svg.setAttribute("aria-label", "Deck of Cards");

  const mkCardRect = (x, y, w, h, rot, fill, stroke) => {
    const r = document.createElementNS(svgNS, "rect");
    r.setAttribute("x", String(x));
    r.setAttribute("y", String(y));
    r.setAttribute("width", String(w));
    r.setAttribute("height", String(h));
    r.setAttribute("rx", "1.8");
    r.setAttribute("fill", fill);
    r.setAttribute("stroke", stroke);
    r.setAttribute("stroke-width", "1.35");
    if (rot) r.setAttribute("transform", rot);
    return r;
  };

  // Back card (tilted left)
  svg.appendChild(mkCardRect(3, 3, 11, 15, "rotate(-15 8.5 10.5)", "#b48a4e", "#2b190d"));
  // Middle card (tilted slightly)
  svg.appendChild(mkCardRect(6, 2.5, 11, 15, "rotate(-4 11.5 10)", "#d8be8a", "#2b190d"));
  // Front card (tilted right, parchment with inner gold border & Roman diamond emblem)
  svg.appendChild(mkCardRect(9, 3, 11, 15, "rotate(8 14.5 10.5)", "#fbf5e6", "#2b190d"));

  const innerFrame = document.createElementNS(svgNS, "rect");
  innerFrame.setAttribute("x", "10.8");
  innerFrame.setAttribute("y", "4.8");
  innerFrame.setAttribute("width", "7.4");
  innerFrame.setAttribute("height", "11.4");
  innerFrame.setAttribute("rx", "0.8");
  innerFrame.setAttribute("fill", "none");
  innerFrame.setAttribute("stroke", "#92400e");
  innerFrame.setAttribute("stroke-width", "0.9");
  innerFrame.setAttribute("transform", "rotate(8 14.5 10.5)");
  svg.appendChild(innerFrame);

  const emblem = document.createElementNS(svgNS, "polygon");
  emblem.setAttribute("points", "14.5,7.4 16.7,10.5 14.5,13.6 12.3,10.5");
  emblem.setAttribute("fill", "#991b1b");
  emblem.setAttribute("stroke", "#78350f");
  emblem.setAttribute("stroke-width", "0.65");
  emblem.setAttribute("transform", "rotate(8 14.5 10.5)");
  svg.appendChild(emblem);

  return svg;
}

/**
 * Builds an inline SVG vector icon representing an Ancient Roman Treasure Chest (Arca).
 */
function createAncientRomanChestIconNode(extraClass = "") {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 24 20");
  svg.setAttribute("class", `enc-tier-inline-svg roman-chest-icon-svg ${extraClass}`.trim());
  svg.setAttribute("aria-label", "Ancient Roman Treasure Chest");

  // Lower oak & bronze-bound coffer body
  const base = document.createElementNS(svgNS, "rect");
  base.setAttribute("x", "2.5");
  base.setAttribute("y", "8.5");
  base.setAttribute("width", "19");
  base.setAttribute("height", "9.5");
  base.setAttribute("rx", "1.4");
  base.setAttribute("fill", "#7c3f16");
  base.setAttribute("stroke", "#241207");
  base.setAttribute("stroke-width", "1.4");
  svg.appendChild(base);

  // Vaulted Roman chest lid
  const lid = document.createElementNS(svgNS, "path");
  lid.setAttribute("d", "M2.5 8.5 C2.5 4.2, 6 2.5, 12 2.5 C18 2.5, 21.5 4.2, 21.5 8.5 Z");
  lid.setAttribute("fill", "#9a5220");
  lid.setAttribute("stroke", "#241207");
  lid.setAttribute("stroke-width", "1.4");
  lid.setAttribute("stroke-linejoin", "round");
  svg.appendChild(lid);

  // Gold/bronze horizontal rim band
  const rim = document.createElementNS(svgNS, "rect");
  rim.setAttribute("x", "2");
  rim.setAttribute("y", "7.6");
  rim.setAttribute("width", "20");
  rim.setAttribute("height", "2.1");
  rim.setAttribute("rx", "0.7");
  rim.setAttribute("fill", "#eab308");
  rim.setAttribute("stroke", "#241207");
  rim.setAttribute("stroke-width", "1.1");
  svg.appendChild(rim);

  // Left and right bronze vertical strapping bands
  for (const bx of [5.5, 16.7]) {
    const strap = document.createElementNS(svgNS, "rect");
    strap.setAttribute("x", String(bx));
    strap.setAttribute("y", "3.4");
    strap.setAttribute("width", "1.8");
    strap.setAttribute("height", "14.4");
    strap.setAttribute("fill", "#d97706");
    strap.setAttribute("stroke", "#241207");
    strap.setAttribute("stroke-width", "0.85");
    svg.appendChild(strap);
  }

  // Central Roman scutiform lockplate
  const lockPlate = document.createElementNS(svgNS, "rect");
  lockPlate.setAttribute("x", "9.8");
  lockPlate.setAttribute("y", "6.8");
  lockPlate.setAttribute("width", "4.4");
  lockPlate.setAttribute("height", "5.2");
  lockPlate.setAttribute("rx", "1");
  lockPlate.setAttribute("fill", "#fde047");
  lockPlate.setAttribute("stroke", "#241207");
  lockPlate.setAttribute("stroke-width", "1.1");
  svg.appendChild(lockPlate);

  // Keyhole
  const keyhole = document.createElementNS(svgNS, "circle");
  keyhole.setAttribute("cx", "12");
  keyhole.setAttribute("cy", "9.3");
  keyhole.setAttribute("r", "0.85");
  keyhole.setAttribute("fill", "#241207");
  svg.appendChild(keyhole);

  return svg;
}

/**
 * Builds a Cart-in-a-Circle symbol representing a Move action.
 */
function createMoveActionCircleNode(titleText = "Unused Move Action") {
  const wrap = document.createElement("span");
  wrap.className = "action-symbol-circle move-action-circle";
  wrap.setAttribute("data-hover-title", titleText);

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 24 20");
  svg.setAttribute("aria-hidden", "true");

  const body = document.createElementNS(svgNS, "path");
  body.setAttribute("d", "M2 4 H5 L7.5 12.5 H17.5 L20 6 H6.5");
  body.setAttribute("fill", "none");
  body.setAttribute("stroke", "currentColor");
  body.setAttribute("stroke-width", "2.2");
  body.setAttribute("stroke-linecap", "round");
  body.setAttribute("stroke-linejoin", "round");
  svg.appendChild(body);

  for (const cx of [9, 16.5]) {
    const wheel = document.createElementNS(svgNS, "circle");
    wheel.setAttribute("cx", String(cx));
    wheel.setAttribute("cy", "16");
    wheel.setAttribute("r", "2.2");
    wheel.setAttribute("fill", "currentColor");
    svg.appendChild(wheel);
  }
  wrap.appendChild(svg);
  return wrap;
}

/**
 * Builds a Denarius-in-a-Circle symbol representing a Transaction action.
 */
function createTransactionActionCircleNode(titleText = "Unused Transaction Action") {
  const wrap = document.createElement("span");
  wrap.className = "action-symbol-circle transaction-action-circle";
  wrap.setAttribute("data-hover-title", titleText);
  wrap.appendChild(createDenariusSvgNode());
  return wrap;
}

function appendTextWithRomeDice(parentNode, rawValue, isOptionTag = false) {
  const str = replaceDenariiTokens(rawValue);
  if (!GAME_TOKEN_REGEX.test(str)) {
    parentNode.appendChild(document.createTextNode(str));
    return;
  }
  GAME_TOKEN_REGEX.lastIndex = 0;
  if (isOptionTag) {
    const optSafe = str
      .replace(/\(SELL_SYM\)/g, "+d")
      .replace(/\(BUY_SYM\)/g, "-d")
      .replace(/\(COMBAT_ICON\)/g, "Combat")
      .replace(/\(DECK_ICON\)/g, "Deck ")
      .replace(/\(QUEST_ICON\)/g, "Quest")
      .replace(/(\(R\)|\(r\)|®)/g, "🅁")
      .replace(/𐆖(\d+)/g, "$1d")
      .replace(/𐆖/g, "d");
    parentNode.appendChild(document.createTextNode(optSafe));
    return;
  }
  const parts = str.split(GAME_TOKEN_REGEX);
  for (const part of parts) {
    if (!part) continue;
    if (part === "(SELL_SYM)") {
      parentNode.appendChild(createSellPriceSymbolNode(false));
    } else if (part === "(BUY_SYM)") {
      parentNode.appendChild(createBuyPriceSymbolNode(false));
    } else if (part === "(COMBAT_ICON)") {
      parentNode.appendChild(createCombatInlineIconNode());
    } else if (part === "(DECK_ICON)") {
      parentNode.appendChild(createDeckOfCardsIconNode());
    } else if (part === "(QUEST_ICON)") {
      parentNode.appendChild(createAncientRomanChestIconNode());
    } else if (part === "(R)" || part === "(r)" || part === "®" || part === "🅁") {
      const dieBox = document.createElement("span");
      dieBox.className = "rome-die-box";
      dieBox.setAttribute("data-hover-title", "Rome Die");
      dieBox.textContent = "R";
      parentNode.appendChild(dieBox);
    } else if (part === DENARIUS_SYM) {
      const denSpan = document.createElement("span");
      denSpan.className = "denarius-sym";
      denSpan.setAttribute("data-hover-title", "Denarii");
      denSpan.setAttribute("aria-label", "Denarii");
      denSpan.appendChild(createDenariusSvgNode());
      parentNode.appendChild(denSpan);
    } else {
      parentNode.appendChild(document.createTextNode(part));
    }
  }
}

function resolveGoodTrackClass(itemOrTrack) {
  const raw =
    typeof itemOrTrack === "string"
      ? itemOrTrack
      : (itemOrTrack && (itemOrTrack.track || itemOrTrack.category || itemOrTrack.subcategory)) || "";
  const s = String(raw).toLowerCase();
  if (s.includes("grain")) return "good-track-grain";
  if (s.includes("animal")) return "good-track-animals";
  if (s.includes("wine")) return "good-track-wine";
  if (s.includes("weapon")) return "good-track-weapons";
  if (s.includes("marble") || s.includes("stone")) return "good-track-marble";
  if (s.includes("guard")) return "good-track-guards";
  return "good-track-weapons";
}

/**
 * Safe DOM element builder using createElement, textContent, and addEventListener.
 */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  const isOption = String(tag).toLowerCase() === "option";
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "className") {
      node.className = String(v);
    } else if (k === "text") {
      appendTextWithRomeDice(node, v, isOption);
    } else if (k === "style" && typeof v === "object") {
      for (const [sk, sv] of Object.entries(v)) {
        const sVal = String(sv);
        node.style[sk] = sVal.includes("/assets/") ? sVal.replace(/\/assets\//g, "./assets/") : sVal;
      }
    } else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === "disabled" || k === "checked" || k === "selected") {
      if (v) node[k] = true;
    } else if (k === "src" || k === "href") {
      node.setAttribute(k, resolveAssetUrl(String(v)));
    } else if (k === "title") {
      const safeTitle = String(v).replace(/𐆖(\d+)/g, "$1d").replace(/𐆖/g, "d").trim();
      if (safeTitle) {
        node.setAttribute("data-hover-title", safeTitle);
      }
    } else {
      node.setAttribute(k, String(v));
    }
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue;
    if (child instanceof Node) {
      node.appendChild(child);
    } else {
      appendTextWithRomeDice(node, child, isOption);
    }
  }
  return node;
}

const TILE_MODIFIER_MAP = {
  "<<": "++",
  "<": "+",
  "=": "=",
  ">": "-",
  ">>": "--",
  "++": "++",
  "+": "+",
  "-": "-",
  "--": "--",
};

function formatTileModifier(mod) {
  const s = String(mod ?? "=").trim();
  return TILE_MODIFIER_MAP[s] || s;
}

function getTileModifierClass(mod) {
  const f = formatTileModifier(mod);
  if (f === "++" || f === "+") return "mod-positive";
  if (f === "--" || f === "-") return "mod-negative";
  return "mod-neutral";
}

function normalizeRelativeScarcityText(txt) {
  if (!txt) return "";
  const s = String(txt);
  if (/will\s+sell\b/i.test(s) && !/relative/i.test(s)) {
    return s;
  }
  return s
    .replace(/\bat\s*<<(?!\w)/g, "at ++")
    .replace(/\bat\s*<(?!\w)/g, "at +")
    .replace(/\bat\s*>>(?!\w)/g, "at --")
    .replace(/\bat\s*>(?!\w)/g, "at -");
}

function formatMissionObjective(m) {
  if (!m) return "";
  if (m.text) return normalizeRelativeScarcityText(m.text);
  if (m.kind === "sell") {
    const sellLabel = m.item && m.item !== "Cargo" ? m.item : m.category || "Goods";
    return `Sell ${sellLabel} at ${formatTileModifier(m.modifier || "=")} Scarcity in ${m.cell || "Rome"}.`;
  }
  if (m.kind === "delivery") {
    const blocks = m.blocks || 1;
    const combatPart = m.combatText ? ` • ${m.combatText}` : "";
    const fencedPart = m.fencedSell ? ` [Fenced Sell: ${m.fencedSell.join("/")}]` : "";
    return `Pick up ${m.item || "Cargo"} (${m.category || "Goods"} • ${blocks}■${combatPart}) in ${m.pickupCell}, then Deliver to ${m.deliverCell}.${fencedPart}`;
  }
  return normalizeRelativeScarcityText(m.description || "Complete special objective in Rome.");
}

const FACTION_GEM_MAP = {
  Caracalla: "/assets/icons/ruby.png",
  Geta: "/assets/icons/emerald.png",
  Domna: "/assets/icons/diamond.png",
  Plautilla: "/assets/icons/sapphire.png",
  Aurelius: "/assets/icons/amethyst.png",
};

function renderFactionGemNodes(favorList) {
  if (!Array.isArray(favorList) || favorList.length === 0) return [];
  const nodes = [];
  for (const raw of favorList) {
    const str = String(raw || "").trim();
    if (!str) continue;
    const isNeg = str.startsWith("-") || str.toLowerCase().includes("not ") || str.toLowerCase().includes("hostile");
    const cleanName = str.replace(/^[-+!]/, "").trim();
    const gemSrc = FACTION_GEM_MAP[cleanName];
    if (gemSrc) {
      nodes.push(
        el(
          "span",
          {
            className: `phys-gem-badge ${isNeg ? "phys-gem-slash" : ""}`,
            title: `${isNeg ? "Opposes / -1 " : "+1 "}${cleanName}`,
          },
          el("img", { src: gemSrc, alt: cleanName })
        )
      );
    }
  }
  return nodes;
}

function getSellCategoryClass(cat) {
  const c = String(cat || "").toLowerCase();
  if (c.includes("wine")) return "sell-cat-wine";
  if (c.includes("grain")) return "sell-cat-grain";
  if (c.includes("meat")) return "sell-cat-meat";
  if (c.includes("animal")) return "sell-cat-animals";
  if (c.includes("weapon")) return "sell-cat-weapons";
  if (c.includes("marble")) return "sell-cat-marble";
  if (c.includes("guard")) return "sell-cat-guards";
  return "";
}

function buildEncounterFigureNodes(encStr, iconClass) {
  if (!encStr || encStr === "None") return [];
  const s = String(encStr);
  if (s === "mob") {
    return [el("img", { className: iconClass, src: "/assets/icons/angry_mob.png", alt: "Angry Mob" })];
  }
  if (s === "theater") {
    return [el("img", { className: iconClass, src: "/assets/icons/theater_masks.png", alt: "Theater" })];
  }
  if (s === "soothsayer") {
    return [el("img", { className: iconClass, src: "/assets/icons/soothsayer_icon.png", alt: "Soothsayer" })];
  }
  const [deckType, countRaw] = s.split("_");
  const count = Math.max(1, Math.min(4, Number(countRaw) || 1));
  let iconUrl = "/assets/icons/patricii_icon.png";
  if (deckType === "legiones") iconUrl = "/assets/icons/legiones_icon.png";
  else if (deckType === "nefarii") iconUrl = "/assets/icons/nefarii_icon.png";

  const figs = [];
  for (let i = 0; i < count; i++) {
    figs.push(el("img", { className: iconClass, src: iconUrl, alt: s }));
  }
  return figs;
}

function renderDynamicEdgeSlotNode(dir, edgeVal) {
  if (!edgeVal) return null;
  let inner = null;
  const tollAmt = parseTollAmount(edgeVal);
  if (edgeVal === "green") {
    inner = el("span", { className: "dyn-edge-bar edge-green" });
  } else if (edgeVal === "red") {
    inner = el("span", { className: "dyn-edge-bar edge-red" });
  } else if (tollAmt > 0) {
    inner = el("span", { className: "dyn-edge-toll", text: `${tollAmt}(d)` });
  } else {
    const figs = buildEncounterFigureNodes(edgeVal, "dyn-edge-enc-icon");
    if (figs.length > 0) {
      inner = el("span", { className: "dyn-edge-enc-group" }, ...figs);
    }
  }
  if (!inner) return null;
  return el("div", { className: `dyn-edge-slot dyn-edge-${dir}` }, inner);
}

/**
 * Dynamically renders a revealed Rome Tile Card face from its JSON features
 * (edges, sells, buys, encounter, gamble, persistent, refresh, id, coord).
 * Only the isolated monument illustration is placed in the center background.
 */
function renderDynamicTileCardNode(tile, coord, mode = "board") {
  if (!tile) return null;
  const tileCoord = coord || tile.coord || "B1";
  const edges = tile.edges || {};
  const sells = tile.sells || [];
  const buys = tile.buys || [];
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

  const edgeNodes = dirs.map((d) => renderDynamicEdgeSlotNode(d, edges[d])).filter(Boolean);

  const tradeBannerNodes = [];
  if (buys.length > 0) {
    tradeBannerNodes.push(
      el(
        "div",
        {
          className: "dyn-tile-buys-banner",
        },
        "Sells: ",
        ...buys.map((b, idx) => {
          const modText = formatTileModifier(b.modifier);
          return el(
            "span",
            {},
            idx > 0 ? ", " : "",
            el("span", { className: getSellCategoryClass(b.category), text: b.category }),
            el("span", { className: `sell-mod-symbol ${getTileModifierClass(modText)}`, text: modText })
          );
        })
      )
    );
  }
  if (sells.length > 0) {
    tradeBannerNodes.push(
      el(
        "div",
        { className: "dyn-tile-sells-banner" },
        el("span", { className: "dyn-tile-buys-prefix", text: "Buys:" }),
        ...sells.map((s) => {
          const shortCat =
            s.category === "Exotic Animals"
              ? "Exotic"
              : s.category === "Meat Animals"
              ? "Meat"
              : s.category;
          const modText = formatTileModifier(s.modifier);
          return el(
            "span",
            {},
            el("span", { className: getSellCategoryClass(s.category), text: shortCat }),
            el("span", { className: `sell-mod-symbol ${getTileModifierClass(modText)}`, text: modText })
          );
        })
      )
    );
  }

  const centerFigures = buildEncounterFigureNodes(tile.encounter, "dyn-center-enc-icon");

  let bottomLeftNode = null;
  if (tile.refresh) {
    bottomLeftNode = el(
      "div",
      { className: "dyn-tile-bottom-left" },
      el("img", { className: "dyn-bottom-icon", src: "/assets/icons/refresh.png", alt: "Refresh" })
    );
  } else if (tile.persistent) {
    bottomLeftNode = el(
      "div",
      { className: "dyn-tile-bottom-left" },
      el("img", { className: "dyn-bottom-icon", src: "/assets/icons/persist.png", alt: "Persistent" })
    );
  }

  const bottomRightNode = tile.gamble
    ? el(
        "div",
        { className: "dyn-tile-bottom-right" },
        el("img", { className: "dyn-bottom-icon", src: "/assets/icons/dice.png", alt: "Gamble" })
      )
    : null;

  return el(
    "div",
    {
      className: `dyn-tile-card ${mode === "board" ? "board-overlay" : "inspector-preview"} ${
        edges.SW ? "has-edge-sw" : ""
      } ${edges.SE ? "has-edge-se" : ""}`.trim(),
    },
    el("img", {
      className: "dyn-tile-monument-bg",
      src: getMonumentImageUrl(tileCoord),
      alt: tileCoord,
    }),
    ...edgeNodes,
    tradeBannerNodes.length > 0 ? el("div", { className: "dyn-tile-trade-stack" }, ...tradeBannerNodes) : null,
    centerFigures.length > 0 ? el("div", { className: "dyn-tile-center-enc" }, ...centerFigures) : null,
    bottomLeftNode,
    bottomRightNode,
    el("div", { className: "dyn-tile-id-label", text: tile.id || tileCoord })
  );
}

/**
 * Renders the back side of an unrevealed tile card (matching the underlying Rome map board square).
 */
function renderDynamicTileBackNode(coord, cell) {
  const colIdx = Math.max(0, COLS.indexOf(coord.slice(0, 1)));
  const rowIdx = Math.max(0, ROWS.indexOf(coord.slice(1)));
  const bgPosX = `${(colIdx / 5) * 100}%`;
  const bgPosY = `${(rowIdx / 5) * 100}%`;

  return el(
    "div",
    {
      className: "dyn-tile-back",
      style: { backgroundPosition: `${bgPosX} ${bgPosY}` },
    },
    el("div", { className: "cell-neighborhood-title", text: cell ? cell.name : coord }),
    el(
      "div",
      {
        style: {
          background: "rgba(30, 20, 12, 0.84)",
          color: "var(--gold-bright)",
          padding: "2px 8px",
          borderRadius: "4px",
          fontSize: "0.7rem",
          fontWeight: "700",
          border: "1px solid var(--gold)",
        },
      },
      `Face-Down Stack: ${cell ? cell.stackCount : 12} Tiles`
    )
  );
}

function renderFencedSellTableNode(prices) {
  if (!Array.isArray(prices) || prices.length < 5) return null;
  const headers = ["<<", "<", "=", ">", ">>"];
  return el(
    "div",
    { className: "phys-fenced-table" },
    ...headers.map((h) => el("div", { className: "phys-fenced-cell hdr", text: h })),
    ...prices.slice(0, 5).map((p) => el("div", { className: "phys-fenced-cell", text: String(p) }))
  );
}

/**
 * Resolves an authentic 211 A.D. Roman fresco, mosaic, or marble relief vignette
 * for a Market Good, Mission Cargo, or Guard card.
 */
function resolveGoodCardArtUrl(cardOrItem, trackName = "") {
  const c = cardOrItem || {};
  if (c.isMissionCargo) {
    const idStr = String(c.id || c.name || "");
    const parity = idStr.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 2;
    return parity === 0
      ? "/assets/rome_art/fresco_cart_wagon.jpg?v=30"
      : "/assets/rome_art/fresco_cart_mules.jpg?v=30";
  }
  const combined = `${trackName} ${c.track || ""} ${c.category || ""} ${c.subcategory || ""} ${c.subtitle || ""} ${c.name || ""}`.toLowerCase();
  if (combined.includes("guard")) {
    return "/assets/rome_art/good_guards.jpg?v=30";
  }
  if (combined.includes("marble") || combined.includes("stone") || combined.includes("statue")) {
    return "/assets/rome_art/good_marble.jpg?v=30";
  }
  if (
    combined.includes("weapon") ||
    combined.includes("sword") ||
    combined.includes("spear") ||
    combined.includes("shield") ||
    combined.includes("armor") ||
    combined.includes("gladius") ||
    combined.includes("blade")
  ) {
    return "/assets/rome_art/good_weapons.jpg?v=30";
  }
  if (combined.includes("wine")) {
    if (combined.includes("table") || combined.includes("posca") || combined.includes("jug")) {
      return "/assets/rome_art/fresco_merchants_right.jpg?v=30";
    }
    return "/assets/rome_art/good_fine_wine.jpg?v=30";
  }
  if (combined.includes("grain") || combined.includes("wheat") || combined.includes("flour") || combined.includes("bread")) {
    return "/assets/rome_art/good_grain.jpg?v=30";
  }
  if (
    combined.includes("mule") ||
    combined.includes("ox") ||
    combined.includes("horse") ||
    combined.includes("pack") ||
    combined.includes("wagon") ||
    combined.includes("cart")
  ) {
    return "/assets/rome_art/fresco_cart_mules.jpg?v=30";
  }
  if (
    combined.includes("exotic") ||
    combined.includes("leopard") ||
    combined.includes("lion") ||
    combined.includes("tiger") ||
    combined.includes("bear") ||
    combined.includes("ostrich") ||
    combined.includes("panther")
  ) {
    return "/assets/rome_art/good_exotic.jpg?v=30";
  }
  if (combined.includes("animal") || combined.includes("meat") || combined.includes("cattle") || combined.includes("boar") || combined.includes("pig") || combined.includes("dog")) {
    return "/assets/rome_art/good_meat.jpg?v=30";
  }
  return "/assets/rome_art/fresco_merchants_left.jpg?v=30";
}

function renderGoodCardArtNode(cardOrItem, trackName = "") {
  const c = cardOrItem || {};
  return el(
    "div",
    { className: "good-card-art-frame" },
    el("img", {
      className: "good-card-art-img",
      src: resolveGoodCardArtUrl(c, trackName),
      alt: c.name || trackName || "Roman Cargo",
      loading: "lazy",
    })
  );
}

/**
 * Resolves 211 A.D. Pompeii Forum wagon, pack-mule, and colonnade-merchant fresco art
 * for Mission cards (replacing legacy miscropped prototype card scans).
 */
function resolveMissionCardArtUrl(m) {
  if (!m) return "/assets/rome_art/fresco_cart_wagon.jpg?v=30";
  const key = String(m.id || m.name || "mis_1");
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  if (m.kind === "delivery") {
    return hash % 2 === 0
      ? "/assets/rome_art/fresco_cart_wagon.jpg?v=30"
      : "/assets/rome_art/fresco_cart_mules.jpg?v=30";
  }
  if (m.kind === "sell") {
    return hash % 2 === 0
      ? "/assets/rome_art/fresco_merchants_left.jpg?v=30"
      : "/assets/rome_art/fresco_merchants_right.jpg?v=30";
  }
  const desc = `${m.name || ""} ${m.description || ""} ${m.objectiveText || ""}`.toLowerCase();
  if (desc.includes("combat") || desc.includes("defeat") || desc.includes("attack") || desc.includes("fight")) {
    return "/assets/rome_art/good_guards.jpg?v=30";
  }
  return hash % 2 === 0
    ? "/assets/rome_art/fresco_merchants_left.jpg?v=30"
    : "/assets/rome_art/fresco_cart_wagon.jpg?v=30";
}

/**
 * Renders a Mission card in the physical 5:7 format with classical artwork,
 * clear objective description, cargo cubes, fenced sell table, reward chest, and favor gems.
 */
function renderBuriedInfluenceStackCardBackNode(m, buriedCount) {
  const safeCount = Math.max(0, Number(buriedCount) || 0);
  const layerDivs = [];
  const layerDepth = Math.min(4, Math.max(1, safeCount));
  for (let i = 0; i < layerDepth; i++) {
    layerDivs.push(
      el("span", {
        className: "buried-inf-back-layer",
        style: { "--layer-idx": String(i) },
      })
    );
  }
  return el(
    "div",
    {
      className: `phys-card phys-influence-back-card ${safeCount === 0 ? "is-empty-stack" : ""}`,
    },
    ...layerDivs,
    el(
      "div",
      { className: "phys-card-inner phys-inf-back-inner" },
      el(
        "div",
        { className: "phys-card-bar phys-inf-back-bar" },
        el("span", { text: "Face-Down Influence" }),
        el("span", { text: "🔮 Sealed" })
      ),
      el(
        "div",
        { className: "phys-inf-back-body" },
        el("div", { className: "phys-inf-back-crest", text: "🃏" }),
        el("div", { className: "phys-inf-back-count", text: String(safeCount) }),
        el("div", {
          className: "phys-inf-back-title",
          text:
            safeCount === 1
              ? "1 Influence Card Buried"
              : `${safeCount} Influence Cards Buried`,
        }),
        el("div", {
          className: "phys-inf-back-sub",
          text:
            safeCount > 0
              ? `Face-down beneath "${m.name || "Soothsayer Mission"}". Claimed into your hand upon completion.`
              : `No Influence cards are currently buried beneath "${m.name || "Soothsayer Mission"}".`,
        })
      ),
      el(
        "div",
        { className: "phys-card-footer phys-inf-back-footer" },
        el("span", { text: "Card identities remain hidden" })
      )
    )
  );
}

function renderPhysicalMissionCardNode(m, opts = {}) {
  const {
    selectable = false,
    selected = false,
    onClick = null,
    showStatusTag = false,
    canCancel = false,
    cancelLabel = "✕ Cancel Mission",
    soothsayerTotalCount = 0,
  } = opts;
  const cubes = [];
  if (m.kind === "delivery") {
    const nBlocks = Math.max(1, Number(m.blocks) || 1);
    for (let i = 0; i < nBlocks; i++) {
      cubes.push(el("span", { className: "phys-cargo-cube" }));
    }
    if (m.combatText) {
      cubes.push(el("span", { style: { fontSize: "0.62rem", fontWeight: "800", marginLeft: "3px" }, text: m.combatText }));
    }
  }

  let objectiveNode = null;
  if (m.kind === "delivery") {
    objectiveNode = el(
      "div",
      {},
      el(
        "div",
        { style: { fontWeight: "700" } },
        `Pick up `,
        el("span", { style: { textDecoration: "underline", fontWeight: "900" }, text: m.item || "Cargo" }),
        ` (${m.category || "Goods"}) in `,
        el("strong", { text: m.pickupCell }),
        `, Deliver to `,
        el("strong", { text: m.deliverCell })
      ),
      m.fencedSell ? renderFencedSellTableNode(m.fencedSell) : null
    );
  } else if (m.kind === "sell") {
    const modText = formatTileModifier(m.modifier || "=");
    const sellLabel = m.item && m.item !== "Cargo" ? m.item : m.category || "Goods";
    objectiveNode = el(
      "div",
      { style: { fontWeight: "700" } },
      `Sell `,
      el("strong", { text: sellLabel }),
      ` at `,
      el("span", { className: `sell-mod-symbol ${getTileModifierClass(modText)}`, text: modText }),
      ` in `,
      el("strong", { text: m.cell || "Rome" })
    );
  } else {
    objectiveNode = el("div", { style: { fontWeight: "700" }, text: formatMissionObjective(m) });
  }

  const favorGemNodes = renderFactionGemNodes(m.favor || []);
  const hostileGemNodes = m.source === "encounter" ? renderFactionGemNodes(m.hostileFavor || []) : [];
  const reqBlocks = Math.max(1, Number(m.blocks) || 1);
  const buriedCount = Number(
    m.underInfluenceCount !== undefined
      ? m.underInfluenceCount
      : Array.isArray(m.underInfluence)
      ? m.underInfluence.length
      : 0
  );

  const deliveryStatusBadgeNode =
    showStatusTag && m.kind === "delivery"
      ? el("span", {
          style: {
            fontSize: "0.55rem",
            background: m.canDeliverCargo
              ? "#15803d"
              : m.pickedUp
              ? "#16a34a"
              : m.canLoadCargo
              ? "#d97706"
              : "rgba(74, 52, 32, 0.78)",
            color: "#fff",
            padding: "1px 4px",
            borderRadius: "3px",
            fontWeight: "800",
          },
          text: m.canDeliverCargo
            ? `DELIVER @ ${m.deliverCell}`
            : m.pickedUp
            ? `CARGO LOADED → ${m.deliverCell}`
            : m.canLoadCargo
            ? `READY AT ${m.pickupCell}`
            : `PICK UP @ ${m.pickupCell}`,
        })
      : null;

  const externalActions = [];
  if (m.canLoadCargo) {
    externalActions.push(
      el(
        "button",
        {
          type: "button",
          className: "mission-load-cargo-btn",
          title:
            m.hasCargoSpace === false
              ? `Cart full — click to discard Goods on your Cart and load ${m.item || "Cargo"} (${reqBlocks}■)`
              : `Load ${m.item || "Cargo"} (${reqBlocks}■) onto your Cart`,
          onClick: (e) => {
            e.stopPropagation();
            const gsCurr = appState.gameState;
            const viewerCurr =
              gsCurr && Array.isArray(gsCurr.players)
                ? gsCurr.players[gsCurr.viewerPlayerIndex || 0]
                : null;
            triggerMissionCargoLoadWithOverflow(m, viewerCurr);
          },
        },
        m.hasCargoSpace === false
          ? `📦 Load ${m.item || "Cargo"} (${reqBlocks}■ • Swap)`
          : `📦 Load Cargo (${m.item || "Cargo"} • ${reqBlocks}■)`
      )
    );
  }
  if (m.canDeliverCargo) {
    externalActions.push(
      el(
        "button",
        {
          type: "button",
          className: "mission-deliver-cargo-btn",
          title: `Deliver ${m.item || "Cargo"} at ${m.deliverCell} to complete Mission "${m.name}"`,
          onClick: (e) => {
            e.stopPropagation();
            closeModal();
            sendGameAction({ type: "delivery_complete_mission", missionId: m.id });
          },
        },
        `🏛️ Deliver ${m.item || "Cargo"} Here (${m.deliverCell})`
      )
    );
  }
  if (Array.isArray(m.completableSells) && m.completableSells.length > 0) {
    const bulkGrainSells = m.completableSells.filter((s) => s.category === "Grain");
    if (bulkGrainSells.length >= 2) {
      const relMod = formatTileModifier(bulkGrainSells[0].modifier || m.modifier || "=");
      const totalBulkPrice = bulkGrainSells.reduce((acc, s) => acc + (Number(s.price) || 0), 0);
      externalActions.push(
        el(
          "button",
          {
            type: "button",
            className: "mission-sell-complete-btn",
            title: `Bulk Grain Sale: Sell all ${bulkGrainSells.length} Grain cards in ${
              m.cell || "this neighborhood"
            } at ${relMod} (${totalBulkPrice} Denarii total) and complete Mission "${m.name}"`,
            onClick: (e) => {
              e.stopPropagation();
              closeModal();
              sendGameAction({
                type: "delivery_sell",
                category: "Grain",
                bulkGrain: true,
                cardIds: bulkGrainSells.map((s) => s.cardId),
                missionId: m.id,
              });
            },
          },
          replaceDenariiTokens(
            `🌾 Bulk Sell All ${bulkGrainSells.length} Grain (${totalBulkPrice}d @ ${relMod}) — Complete!`
          )
        )
      );
    }
    for (const s of m.completableSells) {
      const relMod = formatTileModifier(s.modifier || m.modifier || "=");
      externalActions.push(
        el(
          "button",
          {
            type: "button",
            className: "mission-sell-complete-btn",
            title: `Sell ${s.cardName} in ${m.cell || "this neighborhood"} at ${relMod} (${s.price} Denarii) and complete Mission "${m.name}"`,
            onClick: (e) => {
              e.stopPropagation();
              closeModal();
              sendGameAction({
                type: "delivery_sell",
                category: s.category,
                cardIds: [s.cardId],
                missionId: m.id,
              });
            },
          },
          replaceDenariiTokens(`💰 Sell ${s.cardName} (${s.price}d @ ${relMod}) — Complete!`)
        )
      );
      if (Array.isArray(s.amethystBoostOptions) && s.amethystBoostOptions.length > 0) {
        for (const boost of s.amethystBoostOptions) {
          externalActions.push(
            el(
              "button",
              {
                type: "button",
                className: "mission-sell-amethyst-btn",
                title: `Spend ${boost.spend} Aurelian Amethyst(s) to boost sale price to ${boost.price} Denarii and complete Mission "${m.name}"`,
                onClick: (e) => {
                  e.stopPropagation();
                  closeModal();
                  sendGameAction({
                    type: "delivery_sell",
                    category: s.category,
                    cardIds: [s.cardId],
                    missionId: m.id,
                    spendAmethysts: boost.spend,
                  });
                },
              },
              replaceDenariiTokens(
                `🔮 Sell ${s.cardName} (-${boost.spend} Amethyst → ${boost.price}d)`
              )
            )
          );
        }
      }
    }
  }
  if (m.canClaimExpose) {
    externalActions.push(
      el(
        "button",
        {
          type: "button",
          className: "mission-deliver-cargo-btn",
          title: `Claim completed Expose Mission "${m.name}"`,
          onClick: (e) => {
            e.stopPropagation();
            closeModal();
            sendGameAction({ type: "delivery_complete_mission", missionId: m.id });
          },
        },
        `✓ Complete Mission (${m.name})`
      )
    );
  }
  if (m.canFightEncounter) {
    const useCb = Boolean(m.canFightEncounter.useCasusBelli);
    const targetLabel = m.canFightEncounter.npcName || "Target";
    externalActions.push(
      el(
        "button",
        {
          type: "button",
          className: "mission-fight-complete-btn",
          title: useCb
            ? `Play Casus Belli to initiate combat against ${targetLabel} for Mission "${m.name}"`
            : `Initiate combat against ${targetLabel} for Mission "${m.name}"`,
          onClick: (e) => {
            e.stopPropagation();
            closeModal();
            sendGameAction({
              type: "resolve_encounter",
              decision: useCb ? "use_casus_belli" : "fight",
            });
          },
        },
        `⚔️ Fight ${targetLabel}${useCb ? " (Casus Belli)" : ""} — Advance!`
      )
    );
  }
  if (canCancel) {
    externalActions.push(
      el(
        "button",
        {
          type: "button",
          className: `mission-cancel-btn ${m.source === "encounter" ? "penalty" : "free"}`,
          onClick: (e) => {
            e.stopPropagation();
            openCancelMissionConfirmModal(m, soothsayerTotalCount);
          },
        },
        cancelLabel
      )
    );
  }

  const missionHoverTitle = `${m.name || "Mission"}: ${formatMissionObjective(m)} — Reward: ${m.rewardText || "Special Reward"}`;
  const cardFace = el(
    "div",
    {
      className: `phys-card phys-mission-card ${selectable ? "selectable" : ""} ${selected ? "selected-discard" : ""}`,
      title: missionHoverTitle,
      onClick,
    },
    selected ? el("div", { className: "phys-card-discard-ribbon", text: "DISCARD" }) : null,
    el(
      "div",
      { className: "phys-card-inner" },
      el(
        "div",
        { className: "phys-card-bar" },
        el(
          "span",
          {
            text:
              m.source === "soothsayer"
                ? "Soothsayer Missio"
                : m.source === "encounter" && !m.hasDrawnMissionCard && m.patronName
                ? `Encounter (${m.patronName})`
                : "Missio",
          }
        ),
        deliveryStatusBadgeNode
      ),
      el(
        "div",
        { className: "phys-card-upper" },
        el(
          "div",
          { className: "phys-card-title-col" },
          el("div", { className: "phys-card-title", text: m.name || "Mission" }),
          cubes.length > 0 ? el("div", { className: "phys-cubes-row" }, ...cubes) : null
        ),
        el(
          "div",
          { className: "phys-card-art-frame" },
          el("img", {
            className: "phys-card-art-img",
            src: resolveMissionCardArtUrl(m),
            alt: m.name || "Mission",
          })
        )
      ),
      el(
        "div",
        { className: "phys-card-body" },
        objectiveNode,
        el(
          "div",
          { className: "phys-reward-line" },
          el("img", { className: "phys-inline-icon", src: "/assets/icons/chest.png", alt: "Reward" }),
          el(
            "span",
            {
              text: `: ${m.rewardText || "Special Reward"}${
                m.patronRewardText ? ` + ${m.patronRewardText} (Patron)` : ""
              }${m.source === "soothsayer" ? " + Buried Influence" : ""}`,
            }
          )
        )
      ),
      el(
        "div",
        { className: "phys-card-footer", style: { justifyContent: "space-between", gap: "4px" } },
        el(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "3px" } },
          favorGemNodes.length > 0
            ? [
                el("img", {
                  className: "phys-inline-icon",
                  src: "/assets/icons/thumb_up.png",
                  alt: "Thumbs Up (Complete Mission)",
                  title: "Friendly Favor for completing this mission",
                }),
                ...favorGemNodes,
              ]
            : el("span", { style: { fontSize: "0.56rem", color: "#9ca3af", fontWeight: "600" }, text: "No Favor" })
        ),
        hostileGemNodes.length > 0
          ? el(
              "div",
              {
                style: { display: "flex", alignItems: "center", gap: "3px" },
                title: "Thumbs Down: Reputational penalty if canceled or failed",
              },
              el("img", {
                className: "phys-inline-icon",
                src: "/assets/icons/thumb_down.png",
                alt: "Thumbs Down (Fail / Cancel Penalty)",
              }),
              ...hostileGemNodes
            )
          : null
      )
    )
  );

  let visualCardNode = cardFace;
  if (showStatusTag && m.source === "encounter" && m.encounterCard) {
    if (!m.hasDrawnMissionCard) {
      // Embedded Encounter Mission: remains a physical Encounter card on the Mission Board
      const encNode = renderPhysicalEncounterCardNode(m.encounterCard, null, { interactive: false });
      visualCardNode = el(
        "div",
        { className: "enc-on-mission-board-wrap" },
        deliveryStatusBadgeNode
          ? el("div", { className: "enc-mission-floating-status" }, deliveryStatusBadgeNode)
          : null,
        encNode
      );
    } else {
      // Deck Quest: Drawn Mission card sits on top of the Encounter card, with clickable protruding side edge
      const stackKey = String(m.id || m.name || "enc_stack");
      const isSwapped = appState.swappedMissionStackIds.has(stackKey);
      const toggleStackSwap = (e) => {
        e.stopPropagation();
        if (appState.swappedMissionStackIds.has(stackKey)) {
          appState.swappedMissionStackIds.delete(stackKey);
        } else {
          appState.swappedMissionStackIds.add(stackKey);
        }
        renderApp();
      };
      const encDeckKey = String(m.encounterCard.deck || "patricii").toLowerCase();
      const patronLabel = m.encounterCard.name || m.patronName || "Encounter";
      const topNode = isSwapped
        ? renderPhysicalEncounterCardNode(m.encounterCard, null, { interactive: false })
        : cardFace;
      const edgeNode = el(
        "button",
        {
          type: "button",
          className: `mission-stack-protruding-edge ${
            isSwapped ? "edge-mission" : `edge-encounter deck-${encDeckKey}`
          }`,
          title: isSwapped
            ? `Click side edge to bring Mission "${m.name || "Quest"}" to the top`
            : `Click protruding Encounter edge to inspect "${patronLabel}"`,
          onClick: toggleStackSwap,
        },
        el("span", { className: "protruding-edge-swap-icon", text: "⇄" }),
        el("span", {
          className: "protruding-edge-label",
          text: isSwapped ? `Missio: ${m.name || "Quest"}` : patronLabel,
        })
      );
      visualCardNode = el(
        "div",
        { className: "mission-card-stack-wrap" },
        el("div", { className: "mission-card-stack-top" }, topNode),
        edgeNode
      );
    }
  } else if (showStatusTag && m.source === "soothsayer") {
    // Soothsayer Mission: sits on top of a face-down stack of Influence cards with clickable protruding side edge
    const stackKey = String(m.id || m.name || "sooth_stack");
    const isSwapped = appState.swappedMissionStackIds.has(stackKey);
    const toggleStackSwap = (e) => {
      e.stopPropagation();
      if (appState.swappedMissionStackIds.has(stackKey)) {
        appState.swappedMissionStackIds.delete(stackKey);
      } else {
        appState.swappedMissionStackIds.add(stackKey);
      }
      renderApp();
    };
    const topNode = isSwapped ? renderBuriedInfluenceStackCardBackNode(m, buriedCount) : cardFace;
    const edgeSlices = [];
    if (!isSwapped) {
      const sliceCount = Math.min(3, Math.max(1, buriedCount || 1));
      for (let i = 0; i < sliceCount; i++) {
        edgeSlices.push(el("span", { className: "protruding-inf-slice", style: { "--slice-idx": String(i) } }));
      }
    }
    const edgeNode = el(
      "button",
      {
        type: "button",
        className: `mission-stack-protruding-edge ${
          isSwapped ? "edge-mission" : "edge-influence-stack"
        }`,
        title: isSwapped
          ? `Click side edge to bring Soothsayer Mission "${m.name || "Mission"}" back to the top`
          : "Click protruding Influence stack edge to check the exact number of buried Influence cards",
        onClick: toggleStackSwap,
      },
      ...edgeSlices,
      el("span", { className: "protruding-edge-swap-icon", text: "⇄" }),
      el("span", {
        className: "protruding-edge-label",
        text: isSwapped ? `Missio: ${m.name || "Soothsayer"}` : "Influence Stack",
      })
    );
    visualCardNode = el(
      "div",
      { className: "mission-card-stack-wrap" },
      el("div", { className: "mission-card-stack-top" }, topNode),
      edgeNode
    );
  }

  if (externalActions.length === 0) {
    return visualCardNode;
  }
  return el(
    "div",
    { className: "phys-card-slot" },
    visualCardNode,
    el("div", { className: "phys-card-external-actions" }, ...externalActions)
  );
}

const FACTION_FAVOR_INFLUENCE_SPECS = {
  "Plautilla Favor": {
    effectText:
      "Receive 6(d), gain 1 Plautilla Favor (Sapphire), and lose 1 Caracalla Favor (Ruby) (can be played after encounter is revealed)",
    gems: ["Plautilla", "-Caracalla"],
  },
  "Aurelian Favor": {
    effectText:
      "Receive 6(d), gain 1 Aurelian Favor (Amethyst), and lose 1 Caracalla Favor (Ruby) (can be played after encounter is revealed)",
    gems: ["Aurelius", "-Caracalla"],
  },
  "Geta Favor": {
    effectText:
      "Receive 5(d), gain 1 Geta Favor (Emerald), and lose 1 Caracalla Favor (Ruby) (can be played after encounter is revealed)",
    gems: ["Geta", "-Caracalla"],
  },
  "Domna Favor": {
    effectText:
      "Receive 6(d), gain 1 Domna Favor (Diamond), and lose 1 Plautilla Favor (Sapphire) and 1 Aurelian Favor (Amethyst) (can be played after encounter is revealed)",
    gems: ["Domna", "-Plautilla", "-Aurelius"],
  },
  "Caracalla Favor": {
    effectText:
      "Receive 5(d), gain 1 Caracalla Favor (Ruby), and lose 1 Geta Favor (Emerald) and 1 Plautilla Favor (Sapphire) (can be played after encounter is revealed)",
    gems: ["Caracalla", "-Geta", "-Plautilla"],
  },
};

function getInfluenceCardEffectText(c) {
  if (!c) return "";
  const cname = String(c.name || "").trim();
  if (FACTION_FAVOR_INFLUENCE_SPECS[cname]) {
    return FACTION_FAVOR_INFLUENCE_SPECS[cname].effectText;
  }
  return String(c.effectText || "");
}

function getInfluenceCardFavorList(c) {
  if (!c) return [];
  const cname = String(c.name || "").trim();
  const extra = c.favorGain && Array.isArray(c.favorGain.extraFavor) ? c.favorGain.extraFavor : null;
  if (extra && extra.length > 0) {
    const pos = extra.filter((x) => !String(x || "").trim().startsWith("-"));
    const neg = extra.filter((x) => String(x || "").trim().startsWith("-"));
    return [...pos, ...neg];
  }
  if (FACTION_FAVOR_INFLUENCE_SPECS[cname]) {
    return FACTION_FAVOR_INFLUENCE_SPECS[cname].gems;
  }
  if (cname.includes("Favor")) {
    const fKey = cname.replace("Favor", "").replace("Aurelian", "Aurelius").trim();
    return [fKey];
  }
  return [];
}

/**
 * Renders an Influence card in the physical 5:7 format with unified classical art.
 */
function renderPhysicalInfluenceCardNode(c, opts = {}) {
  const { selectable = false, selected = false, onClick = null, actionButton = null } = opts;
  const rawArtId = c.id && c.id.startsWith("inf_") ? String(c.id) : "inf_1";
  const artId = rawArtId.replace(/([0-9]+)[a-z]+$/i, "$1");
  const numId = Number(String(artId).replace("inf_", "")) || 1;
  const effectiveArtId = numId > 60 ? "pat_29" : artId;

  const footerItems = [];
  const cname = String(c.name || "");
  if (cname.includes("Favor")) {
    footerItems.push(...renderFactionGemNodes(getInfluenceCardFavorList(c)));
  } else if (cname === "Cartwright") {
    footerItems.push(el("span", { text: "+ ■ ■" }));
  } else if (cname === "Thug") {
    footerItems.push(el("span", { text: "® CP ▲" }));
  }

  const influenceHoverTitle = `${c.name || "Influence"}: ${getInfluenceCardEffectText(c)}`;
  const cardFace = el(
    "div",
    {
      className: `phys-card phys-influence-card ${selectable ? "selectable" : ""} ${selected ? "selected-discard" : ""}`,
      title: influenceHoverTitle,
      onClick,
    },
    selected ? el("div", { className: "phys-card-discard-ribbon", text: "DISCARD" }) : null,
    el(
      "div",
      { className: "phys-card-inner" },
      el("div", { className: "phys-card-bar" }, el("span", { text: "Influence" })),
      el(
        "div",
        { className: "phys-card-upper" },
        el(
          "div",
          { className: "phys-card-title-col" },
          el("div", { className: "phys-card-title", text: c.name || "Influence" }),
          c.bio ? el("div", { className: "phys-card-bio", text: c.bio }) : null
        ),
        el(
          "div",
          { className: "phys-card-art-frame" },
          el("img", {
            className: "phys-card-art-img",
            src: `/assets/cards/${effectiveArtId}.jpg?v=43`,
            alt: c.name || "Influence",
          })
        )
      ),
      el(
        "div",
        { className: "phys-card-body" },
        el("div", { style: { fontWeight: "700", fontSize: "0.72rem" }, text: getInfluenceCardEffectText(c) })
      ),
      el("div", { className: "phys-card-footer" }, ...footerItems)
    )
  );

  if (!actionButton) {
    return cardFace;
  }
  return el(
    "div",
    { className: "phys-card-slot" },
    cardFace,
    el("div", { className: "phys-card-external-actions" }, actionButton)
  );
}

function formatReactionCondition(cond) {
  const s = String(cond || "").trim();
  return s.replace("<=", "≤ ").replace(">=", "≥ ").replace(/\s+/g, " ");
}

function formatReactionTypeSymbol(rOrType) {
  if (!rOrType) return "!";
  const t = typeof rOrType === "object" ? String(rOrType.type || rOrType.effect || "") : String(rOrType);
  if (t === "combat") return "(COMBAT_ICON)";
  if (t === "demand_strict") return "!!";
  if (t === "mission_strict") return "(QUEST_ICON)!!";
  if (t === "mission_request") return "(QUEST_ICON)!";
  if (t === "mission_offer" || t === "mission_bonus") return "(QUEST_ICON)?";
  if (t === "deck_quest_demand") return "(DECK_ICON)(QUEST_ICON)!";
  if (t === "deck_quest_offer") return "(DECK_ICON)(QUEST_ICON)?";
  if (t === "demand") return "!";
  if (t === "offer" || t === "quest_optional") return "?";
  if (t === "cash_reward") {
    return typeof rOrType === "object" && rOrType.reward ? String(rOrType.reward) : "(d)";
  }
  return t;
}

function formatHostileFavorPenaltyText(cardOrMission) {
  const raw =
    Array.isArray(cardOrMission?.hostileFavor) && cardOrMission.hostileFavor.length > 0
      ? cardOrMission.hostileFavor
      : cardOrMission?.faction
      ? [`-${cardOrMission.faction}`]
      : [];
  if (raw.length === 0) return "No Favor Penalty";
  const counts = {};
  for (const entry of raw) {
    const s = String(entry || "").trim();
    if (!s) continue;
    const isNeg = s.startsWith("-");
    const fac = isNeg ? s.slice(1) : s.replace(/^\+/, "");
    if (!fac) continue;
    counts[fac] = (counts[fac] || 0) + (isNeg ? -1 : 1);
  }
  const parts = Object.entries(counts)
    .filter(([, delta]) => delta !== 0)
    .map(([fac, delta]) => `${delta > 0 ? `+${delta}` : delta} ${fac} Favor`);
  return parts.length > 0 ? parts.join(" and ") : "No Favor Penalty";
}

/**
 * Renders an Encounter card (Patricii, Legiones, Nefarii) in the physical 5:7 format.
 * When `pend` is supplied, sections of the card become directly clickable to resolve the encounter!
 */
function renderPhysicalEncounterCardNode(card, pend, opts = {}) {
  const { interactive = false, onFulfill = null, onFight = null } = opts;
  const deckKey = String(
    (typeof pend === "string" ? pend : pend && pend.deck) || card.deck || "patricii"
  ).toLowerCase();
  const factionKey = String(card.faction || "unaligned").toLowerCase();
  const artId = card.id || "pat_1";
  const canFight = Boolean(pend && typeof pend === "object" && pend.canInitiateCombat);
  const combatMandatory = Boolean(pend && typeof pend === "object" && pend.combatMandatory);

  if (card && card.type === "event") {
    const deckDisplay =
      deckKey === "legiones" ? "LEGIONNAIRE" : deckKey === "nefarii" ? "NEFARII" : "PATRICII";
    const handleEventClick = (e) => {
      if (!interactive || !onFulfill) return;
      e.stopPropagation();
      onFulfill();
    };
    return el(
      "div",
      {
        className: `phys-card phys-encounter-card deck-${deckKey} ${interactive ? "interactive-large" : ""}`,
        style: interactive && onFulfill ? { cursor: "pointer" } : undefined,
        title: interactive && onFulfill ? `Click to resolve "${card.name}"!` : card.name || "Event Encounter",
        onClick: interactive && onFulfill ? handleEventClick : null,
      },
      el(
        "div",
        { className: "phys-card-inner" },
        el(
          "div",
          {
            className: `phys-card-bar ${interactive && onFulfill ? "enc-clickable-section section-fulfill" : ""}`,
            style: { justifyContent: "center", fontWeight: "800", letterSpacing: "0.06em", fontSize: "0.68rem" },
          },
          el("span", { text: `${deckDisplay} • EVENT` })
        ),
        el(
          "div",
          { className: "phys-card-upper" },
          el(
            "div",
            { className: "phys-card-title-col" },
            el("div", { className: "phys-card-title", text: card.name || "Encounter Event" }),
            el("div", {
              className: "phys-card-bio",
              text: "Unaligned Roman Street Event",
            })
          ),
          el(
            "div",
            { className: "phys-card-art-frame" },
            el("img", {
              className: "phys-card-art-img",
              src: `/assets/cards/${artId}.jpg?v=43`,
              alt: card.name || "Event Encounter",
            })
          )
        ),
        el(
          "div",
          {
            className: "phys-enc-tiers-row faction-unaligned",
            style: {
              justifyContent: "center",
              alignItems: "center",
              padding: "3px 6px",
              fontWeight: "800",
              fontSize: "0.66rem",
              letterSpacing: "0.06em",
            },
          },
          el("span", { text: "📜 MANDATORY EVENT EFFECT" })
        ),
        el(
          "div",
          {
            className: `phys-card-body ${interactive && onFulfill ? "enc-clickable-section section-fulfill" : ""}`,
          },
          interactive && onFulfill
            ? el(
                "div",
                { style: { marginBottom: "4px" } },
                el("span", {
                  className: "enc-click-hint-pill fulfill",
                  text: "👆 Click Card to Resolve Encounter",
                })
              )
            : null,
          el("div", {
            className: "phys-card-action-text",
            text: card.actionText || "Resolve this Encounter card's effect.",
          })
        ),
        el(
          "div",
          {
            className: "phys-card-bar phys-card-bottom-bar",
            style: { justifyContent: "center", fontSize: "0.64rem", opacity: "0.85" },
          },
          el("span", { text: "No Faction Favor Alignment" })
        )
      )
    );
  }

  const friendlyGems = renderFactionGemNodes(card.friendlyFavor || (card.faction ? [card.faction] : []));
  const hostileGems = renderFactionGemNodes(card.hostileFavor || (card.faction ? [`-${card.faction}`] : []));

  const handleFulfillClick = (e) => {
    if (!interactive || !onFulfill || combatMandatory) return;
    e.stopPropagation();
    onFulfill();
  };

  const handleCombatClick = (e) => {
    if (!interactive) return;
    e.stopPropagation();
    if (!canFight) {
      showToast(
        "Combat is not being threatened by this party! You may only initiate combat if threatened, if required by an active Mission, or by playing 'Casus Belli'.",
        true
      );
      return;
    }
    if (onFight) onFight();
  };

  const tiers =
    Array.isArray(card.tiers) && card.tiers.length > 0
      ? card.tiers
      : Array.isArray(card.reactions) && card.reactions.length > 0
      ? card.reactions.map((r) => ({
          cond: formatReactionCondition(r.condition),
          effect: formatReactionTypeSymbol(r),
        }))
      : [
          { cond: "≤ -1", effect: "(COMBAT_ICON)" },
          { cond: "≥ 0", effect: formatReactionTypeSymbol(pend ? pend.reaction || pend.reactionType : "demand") },
        ];
  const matchedIdx = pend && typeof pend.matchedTierIndex === "number" ? pend.matchedTierIndex : -1;

  const tierCells = tiers.map((t, idx) => {
    const isActive = idx === matchedIdx;
    const rawEff = String(t.effect || "");
    const eff = rawEff
      .replace(/⚔️|⚔/g, "(COMBAT_ICON)")
      .replace(/🃏/g, "(DECK_ICON)")
      .replace(/📦/g, "(QUEST_ICON)");
    const isCombatTier = rawEff.includes("⚔") || eff.includes("(COMBAT_ICON)") || rawEff.toLowerCase() === "combat";
    const clickCls =
      interactive && isCombatTier
        ? canFight
          ? "enc-clickable-section section-combat"
          : "enc-section-locked"
        : interactive && isActive && !combatMandatory
        ? "enc-clickable-section section-fulfill"
        : "";

    return el(
      "div",
      {
        className: `phys-enc-tier-cell ${isActive ? "tier-active" : ""} ${clickCls}`,
        title: isCombatTier
          ? canFight
            ? "Click to Fight in Combat!"
            : "Combat Locked (Not Threatened)"
          : isActive
          ? "Your Active Reputation Tier — Click to Comply / Accept"
          : `Reputation Tier (${t.cond})`,
        onClick: isCombatTier ? handleCombatClick : isActive && !combatMandatory ? handleFulfillClick : null,
      },
      el("div", { className: "phys-enc-tier-effect", text: eff }),
      el("div", { className: "phys-enc-tier-cond", text: t.cond })
    );
  });

  const missionObj = card.mission || null;
  const activeReactionType = String(
    (pend && typeof pend === "object" && (pend.reaction || pend.reactionType)) || ""
  );
  const cardHasDeckQuestDemand =
    !missionObj && Array.isArray(card.reactions) && card.reactions.some((r) => r.type === "deck_quest_demand");
  const cardHasDeckQuestOffer =
    !missionObj && Array.isArray(card.reactions) && card.reactions.some((r) => r.type === "deck_quest_offer");

  const hasDeckQuestDemand = activeReactionType
    ? activeReactionType === "deck_quest_demand"
    : cardHasDeckQuestDemand;
  const hasDeckQuestOffer = activeReactionType
    ? activeReactionType === "deck_quest_offer"
    : cardHasDeckQuestOffer;

  let defaultActionText = "";
  if (activeReactionType === "deck_quest_demand") {
    defaultActionText = "!: Accept the top card of the Missiones deck (unseen) as a Mission.";
  } else if (activeReactionType === "deck_quest_offer") {
    defaultActionText = "?: Accept the top card of the Missiones deck (unseen) as a Mission.";
  } else if (!activeReactionType && card.actionText && (cardHasDeckQuestDemand || cardHasDeckQuestOffer)) {
    const dqNote = cardHasDeckQuestDemand
      ? "(DECK_ICON)(QUEST_ICON)!: Accept top Missiones card (unseen)."
      : "(DECK_ICON)(QUEST_ICON)?: Optional top Missiones card (unseen).";
    defaultActionText = `${card.actionText} • ${dqNote}`;
  } else {
    defaultActionText =
      card.actionText ||
      formatMissionObjective(missionObj) ||
      (hasDeckQuestDemand
        ? "!: Accept the top card of the Missiones deck (unseen) as a Mission."
        : hasDeckQuestOffer
        ? "?: Accept the top card of the Missiones deck (unseen) as a Mission."
        : "Encounter in the streets of Rome.");
  }
  defaultActionText = normalizeRelativeScarcityText(defaultActionText);

  return el(
    "div",
    {
      className: `phys-card phys-encounter-card deck-${deckKey} ${interactive ? "interactive-large" : ""}`,
    },
    el(
      "div",
      { className: "phys-card-inner" },
      // Top Friendly Header Bar (Clickable to Fulfill/Accept when not mandatory combat)
      el(
        "div",
        {
          className: `phys-card-bar ${interactive && !combatMandatory ? "enc-clickable-section section-fulfill" : ""}`,
          title: interactive && !combatMandatory ? "Click to Comply / Accept Friendly Terms" : "",
          onClick: !combatMandatory ? handleFulfillClick : null,
        },
        el(
          "div",
          {
            style: { display: "flex", alignItems: "center", gap: "3px" },
            title: "Green Thumbs Up: Consequences for completing a mission or complying with the party",
          },
          el("img", { className: "phys-inline-icon", src: "/assets/icons/thumb_up.png", alt: "Thumbs Up (Friendly)" }),
          ...friendlyGems
        ),
        el(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "3px" } },
          el("img", { className: "phys-inline-icon", src: "/assets/icons/chest.png", alt: "Reward" }),
          el("span", { text: `:${card.friendlyReward || "25(d)"}` })
        )
      ),
      // Upper Split: Character Name, Bio, Combat Formula + Classical Portrait
      el(
        "div",
        { className: "phys-card-upper" },
        el(
          "div",
          { className: "phys-card-title-col" },
          el(
            "div",
            {},
            el("div", { className: "phys-card-title", text: card.name || "Roman Encounter" }),
            card.bio ? el("div", { className: "phys-card-bio", text: card.bio }) : null
          ),
          el(
            "div",
            {
              className: `phys-card-cp-line ${
                interactive ? (canFight ? "enc-clickable-section section-combat" : "enc-section-locked") : ""
              }`,
              style: { padding: "2px 4px", borderRadius: "4px" },
              title: canFight ? "Click to Fight in Combat!" : "Combat Locked (Not Threatened)",
              onClick: handleCombatClick,
            },
            el("img", { className: "phys-inline-icon", src: "/assets/icons/combat.png", alt: "CP" }),
            el("span", { text: `: ${card.combatFormula || "X(R)"}` })
          )
        ),
        el(
          "div",
          { className: "phys-card-art-frame" },
          el("img", {
            className: "phys-card-art-img",
            src: `/assets/cards/${artId}.jpg?v=43`,
            alt: card.name || "Encounter",
          })
        )
      ),
      // Middle Reputation Tiers Row (Highlighted in Faction Color)
      el("div", { className: `phys-enc-tiers-row faction-${factionKey}` }, ...tierCells),
      // Lower Action / Demand / Offer / Prescribed Mission Box (Clickable to Fulfill/Accept!)
      el(
        "div",
        {
          className: `phys-card-body ${
            interactive && !combatMandatory ? "enc-clickable-section section-fulfill" : ""
          }`,
          title:
            interactive && !combatMandatory
              ? "Click this section of the card to Comply / Accept Offer / Accept Mission"
              : "",
          onClick: !combatMandatory ? handleFulfillClick : null,
        },
        el(
          "div",
          {},
          interactive && !combatMandatory
            ? el(
                "div",
                { style: { marginBottom: "4px" } },
                el("span", {
                  className: "enc-click-hint-pill fulfill",
                  text: "👆 Click Section to Comply / Accept",
                })
              )
            : null,
          hasDeckQuestDemand || hasDeckQuestOffer
            ? el(
                "div",
                {
                  style: {
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "2px 6px",
                    borderRadius: "4px",
                    background: hasDeckQuestDemand ? "rgba(180, 83, 9, 0.16)" : "rgba(21, 128, 61, 0.16)",
                    border: hasDeckQuestDemand ? "1px solid rgba(180, 83, 9, 0.45)" : "1px solid rgba(21, 128, 61, 0.45)",
                    fontSize: "0.62rem",
                    fontWeight: "800",
                    color: hasDeckQuestDemand ? "#92400e" : "#166534",
                    marginBottom: "4px",
                  },
                },
                el("span", {
                  text: hasDeckQuestDemand
                    ? "(DECK_ICON)(QUEST_ICON)! Deck Quest Demand"
                    : "(DECK_ICON)(QUEST_ICON)? Optional Deck Quest Offer",
                })
              )
            : null,
          el("div", {
            style: { fontWeight: "700" },
            text: defaultActionText,
          }),
          missionObj && missionObj.fencedSell ? renderFencedSellTableNode(missionObj.fencedSell) : null
        )
      ),
      // Bottom Inverted Combat Loot & Hostile Favor Bar (Clickable to Initiate Combat when allowed!)
      el(
        "div",
        {
          className: `phys-card-footer ${
            interactive ? (canFight ? "enc-clickable-section section-combat" : "enc-section-locked") : ""
          }`,
          title: canFight
            ? "Click Combat Bar to Fight in Combat!"
            : "Combat Locked — Combat is not threatened by this party",
          onClick: handleCombatClick,
        },
        el(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "4px" } },
          el("img", { className: "phys-inline-icon", src: "/assets/icons/combat.png", alt: "Combat Loot" }),
          el("span", { text: `:${card.combatReward || "30(d)"}` }),
          interactive
            ? el("span", {
                className: `enc-click-hint-pill ${canFight ? "combat" : "locked"}`,
                text: canFight ? "(COMBAT_ICON) Click to Fight" : "🔒 No Combat",
              })
            : null
        ),
        el(
          "div",
          {
            style: { display: "flex", alignItems: "center", gap: "3px" },
            title: "Red Thumbs Down: Consequences for refusing the party's request or engaging in combat",
          },
          el("img", { className: "phys-inline-icon", src: "/assets/icons/thumb_down.png", alt: "Thumbs Down (Hostile)" }),
          ...hostileGems
        )
      )
    )
  );
}

function showToast(message, isError = false) {
  const root = document.getElementById("toast-root");
  if (!root) return;
  root.className = "toast-container";
  const item = el("div", { className: `toast ${isError ? "error" : ""}`, text: message });
  root.appendChild(item);
  setTimeout(() => {
    item.remove();
  }, 4200);
}

function closeModal() {
  hideRomeHoverTooltip();
  const root = document.getElementById("modal-root");
  if (root) root.replaceChildren();
}

function showModal(titleText, bodyNode, options = {}) {
  hideRomeHoverTooltip();
  const root = document.getElementById("modal-root");
  if (!root) return;
  const hasBoxClick = Boolean(options && typeof options.onBoxClick === "function");
  const backdrop = el(
    "div",
    {
      className: "modal-backdrop",
      onClick: (e) => {
        if (e.target === backdrop) closeModal();
      },
    },
    el(
      "div",
      {
        className: options && options.wide ? "modal-box modal-box-wide" : "modal-box",
        style: hasBoxClick ? { cursor: "pointer" } : undefined,
        onClick: hasBoxClick
          ? (e) => {
              if (e.target && typeof e.target.closest === "function" && e.target.closest("[data-modal-close]")) {
                return;
              }
              options.onBoxClick(e);
            }
          : undefined,
      },
      el(
        "div",
        { className: "panel-title" },
        el("span", { text: titleText }),
        el("button", {
          id: "modal-close-btn",
          type: "button",
          className: "btn btn-sm",
          "data-modal-close": "1",
          title: "Close window",
          text: "Close ✕",
          onClick: (e) => {
            e.stopPropagation();
            closeModal();
          },
        })
      ),
      bodyNode
    )
  );
  root.replaceChildren(backdrop);
}

async function apiRequest(path, method = "GET", body = null) {
  const apiBaseUrl = getNightMerchantApiBaseUrl();
  const fullUrl = apiBaseUrl && String(path).startsWith("/") ? `${apiBaseUrl}${path}` : path;
  const headers = { Accept: "application/json" };
  const idToken = await getFirebaseIdToken();
  if (idToken) {
    headers["Authorization"] = `Bearer ${idToken}`;
  }
  if (method !== "GET" && method !== "HEAD") {
    headers["Content-Type"] = "application/json";
    if (appState.csrfToken) {
      headers["X-CSRF-Token"] = appState.csrfToken;
    }
  }
  let resp;
  try {
    resp = await fetch(fullUrl, {
      method,
      headers,
      credentials: apiBaseUrl ? "include" : "same-origin",
      body: body ? JSON.stringify(body) : null,
    });
  } catch (netErr) {
    throw new Error(
      "Could not reach the Night Merchant server — check your connection or try again in a moment."
    );
  }
  const data = await resp.json().catch(() => {
    if (
      resp.status === 404 &&
      !apiBaseUrl &&
      typeof window !== "undefined" &&
      window.location &&
      /dashiellrenaud\.com$/i.test(window.location.hostname || "")
    ) {
      return {
        ok: false,
        error: "Backend API URL (apiBaseUrl) is not yet configured in public/config.js.",
      };
    }
    return { ok: false, error: "Invalid server response." };
  });
  if (!resp.ok || data.ok === false) {
    throw new Error(data.error || data.message || `Request failed (${resp.status})`);
  }
  return data;
}

function applyUserDefaultBoardView(settings) {
  const pref = settings && settings.defaultBoardView ? String(settings.defaultBoardView) : "auto";
  if (["auto", "both", "rome", "market", "climate"].includes(pref)) {
    appState.boardViewMode = pref;
  } else if (pref === "split") {
    appState.boardViewMode = "both";
  } else {
    appState.boardViewMode = "auto";
  }
}

function syncGameUiTransitions(gs, isSwitchingGame = false) {
  if (!gs) return;
  const gameId = appState.currentGameId;
  const prevGameId = appState.lastSyncedGameId;
  const prevPhase = appState.lastSyncedPhase;
  const prevSeason = appState.lastSyncedSeason;
  const nextPhase = gs.phase || null;
  const nextSeason = gs.season || null;

  const gameChanged = isSwitchingGame || prevGameId !== gameId;
  const enteredClimatePhase =
    nextPhase === "setup_climate" && (gameChanged || prevPhase !== "setup_climate");
  const exitedClimatePhase =
    !gameChanged && prevPhase === "setup_climate" && nextPhase !== "setup_climate";
  const enteredMarketPhase =
    !gameChanged &&
    nextPhase === "market" &&
    (prevPhase !== "market" || (prevSeason !== null && prevSeason !== nextSeason));
  const exitedMarketPhase = !gameChanged && prevPhase === "market" && nextPhase !== "market";

  if (enteredClimatePhase) {
    appState.highlightedMarketTrack = null;
    if (appState.boardViewMode !== "both") {
      appState.boardViewMode = "climate";
    }
    appState.pendingScrollToClimate = true;
  } else if (gameChanged || exitedClimatePhase || enteredMarketPhase || exitedMarketPhase) {
    appState.highlightedMarketTrack = null;
    const savedPref =
      appState.user && appState.user.settings && appState.user.settings.defaultBoardView
        ? String(appState.user.settings.defaultBoardView)
        : "auto";
    if (["both", "rome", "market"].includes(savedPref)) {
      appState.boardViewMode = savedPref;
    } else if (savedPref === "split") {
      appState.boardViewMode = "both";
    } else if (appState.boardViewMode !== "both") {
      appState.boardViewMode = "auto";
    }
  }

  appState.lastSyncedGameId = gameId;
  appState.lastSyncedPhase = nextPhase;
  appState.lastSyncedSeason = nextSeason;

  // Chronicle of Rome scroll stability: keep user's scroll position unless a new log event occurs
  const logs = Array.isArray(gs.logs) ? gs.logs : [];
  const lastLog = logs.length > 0 ? logs[logs.length - 1] : null;
  const logSig = lastLog
    ? `${logs.length}:${lastLog.season || ""}:${lastLog.turn ?? ""}:${lastLog.text || ""}`
    : "0";
  if (gameChanged || appState.chronicleLastGameId !== gameId) {
    appState.chronicleLastGameId = gameId;
    appState.chronicleLastLogSig = logSig;
    appState.chronicleUserScrolled = false;
    appState.chronicleScrollTop = 0;
  } else if (appState.chronicleLastLogSig !== null && appState.chronicleLastLogSig !== logSig) {
    appState.chronicleLastLogSig = logSig;
    appState.chronicleUserScrolled = false;
    appState.chronicleScrollTop = 0;
  } else {
    appState.chronicleLastLogSig = logSig;
  }

  // Clear armed die-card action if encounter ended or card was spent
  if (appState.armedDieAction) {
    const viewer = Array.isArray(gs.players) ? gs.players[gs.viewerPlayerIndex || 0] : null;
    const stillHasCard =
      Boolean(gs.pendingEncounter) &&
      Boolean(viewer && (viewer.influence || []).some((c) => c.id === appState.armedDieAction.cardId));
    if (!stillHasCard) {
      appState.armedDieAction = null;
    }
  }
}

function installChronicleViewportScrollWatcher() {
  if (appState._chronicleWatcherInstalled) return;
  appState._chronicleWatcherInstalled = true;
  window.addEventListener(
    "scroll",
    () => {
      if (!appState.chronicleUserScrolled) return;
      const panelEl = document.getElementById("chronicle-of-rome-panel");
      if (!panelEl || typeof panelEl.getBoundingClientRect !== "function") return;
      const rect = panelEl.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) {
        appState.chronicleUserScrolled = false;
        appState.chronicleScrollTop = 0;
        const logBoxEl = document.getElementById("chronicle-log-box");
        if (logBoxEl) {
          logBoxEl.scrollTop = 0;
        }
      }
    },
    { passive: true }
  );
}

async function bootstrap() {
  installChronicleViewportScrollWatcher();
  try {
    const params = new URLSearchParams(window.location.search || "");
    const rawGameParam = (params.get("game") || "").trim();
    if (rawGameParam && /^[A-Za-z0-9_-]{1,40}$/.test(rawGameParam)) {
      appState.pendingInviteGameId = rawGameParam;
    }
  } catch (_e) {}

  await initFirebaseClientIfConfigured();

  try {
    let me = await apiRequest("/api/auth/me");
    appState.googleClientId = me.googleClientId || "";
    if (typeof me.firebaseEnabled === "boolean") {
      appState.serverFirebaseEnabled = me.firebaseEnabled;
    }
    if (me.firebaseConfig && typeof me.firebaseConfig === "object") {
      appState.runtimeFirebaseConfig = me.firebaseConfig;
      await initFirebaseClientIfConfigured();
    }
    if (!me.authenticated && me.firebaseEnabled !== false) {
      const existingToken = await getFirebaseIdToken();
      if (existingToken) {
        try {
          const synced = await apiRequest("/api/auth/firebase", "POST", { idToken: existingToken });
          if (synced && synced.user) {
            me = { authenticated: true, user: synced.user, csrfToken: synced.csrfToken || null };
          }
        } catch (_syncErr) {}
      }
    }
    if (me.authenticated && me.user) {
      appState.user = me.user;
      appState.csrfToken = me.csrfToken || null;
      applyUserDefaultBoardView(me.user.settings);
      if (!me.user.needsUsernameSetup) {
        await refreshPortalOverview();
        await handlePendingInviteDeepLink();
      }
    }
  } catch (err) {
    console.error(err);
  }
  renderApp();
  startPolling();
}

function startPolling() {
  if (appState.pollTimer) clearInterval(appState.pollTimer);
  appState.pollTimer = setInterval(async () => {
    if (!appState.user || appState.user.needsUsernameSetup) return;
    if (appState.activeTab === "tabletop" && appState.currentGameId) {
      try {
        const res = await apiRequest(`/api/games/${appState.currentGameId}`);
        appState.gameSummary = res.summary;
        appState.gameState = res.state;
        syncGameUiTransitions(res.state, false);
        enqueueNewNpcEvents(res.state, false);
        enqueueNewDiceEvents(res.state);
        enqueueNewMissionEvents(res.state);
        renderApp();
        if (!document.getElementById("modal-root")?.hasChildNodes()) {
          checkPostActionModals(res.state);
        }
      } catch (err) {
        if (err && err.message && err.message.includes("Game not found")) {
          appState.currentGameId = null;
          appState.gameSummary = null;
          appState.gameState = null;
          appState.activeTab = "portal";
          await refreshPortalOverview();
          showToast("This game has been terminated.", true);
          renderApp();
        }
      }
    } else if (appState.activeTab === "portal") {
      try {
        await refreshPortalOverview();
        const gamesSlot = document.getElementById("portal-games-list-slot");
        const activeEl = document.activeElement;
        const selectingInsideLobby =
          Boolean(gamesSlot && activeEl && gamesSlot.contains(activeEl)) &&
          activeEl.tagName === "SELECT";
        if (gamesSlot && !selectingInsideLobby) {
          gamesSlot.replaceChildren(...buildPortalGamesListNodes());
        }
        const lbSlot = document.getElementById("portal-leaderboard-slot");
        if (lbSlot) {
          lbSlot.replaceChildren(...buildPortalLeaderboardNodes());
        }
        updateTabTurnTitle();
      } catch (_err) {
        // Ignore transient background portal polling errors
      }
    }
  }, 5000);
}

async function refreshPortalOverview() {
  if (!appState.user) return;
  const data = await apiRequest("/api/portal/overview");
  if (data.user) {
    appState.user = { ...(appState.user || {}), ...data.user };
  }
  appState.games = data.games || [];
  appState.leaderboard = data.leaderboard || [];
  appState.botPersonas = data.botPersonas || [];
  appState.referenceCatalog = data.referenceCatalog || [];
  if (!appState.selectedRefItem && appState.referenceCatalog.length > 0) {
    appState.selectedRefItem = appState.referenceCatalog[0];
  }
}

function seedSeenScoutIds(state) {
  if (!state || !state.players) return;
  const vp = state.players[state.viewerPlayerIndex || 0];
  if (!vp || !Array.isArray(vp.scoutedInfo)) return;
  vp.scoutedInfo.forEach((si) => {
    if (si && si.id) appState.shownScoutIds.add(si.id);
  });
}

function enqueueNewMissionEvents(state) {
  if (!state || !Array.isArray(state.missionEvents)) return;
  if (appState.lastSeenMissionEventSeq === null) {
    appState.lastSeenMissionEventSeq =
      typeof state.lastMissionEventSeq === "number" ? state.lastMissionEventSeq : 0;
    return;
  }
  const viewerIdx = state.viewerPlayerIndex || 0;
  const skipPopups = Boolean(
    appState.user && appState.user.settings && appState.user.settings.skipMissionCompletionPopups
  );
  for (const ev of state.missionEvents) {
    if (ev && typeof ev.seq === "number" && ev.seq > appState.lastSeenMissionEventSeq) {
      appState.lastSeenMissionEventSeq = ev.seq;
      if (ev.playerIndex === viewerIdx && !skipPopups) {
        appState.missionModalQueue.push(ev);
      }
    }
  }
}

function persistSkipMissionCompletionPopups(skipFlag) {
  if (!appState.user) return;
  const nextSettings = {
    ...(appState.user.settings || {}),
    skipMissionCompletionPopups: Boolean(skipFlag),
  };
  appState.user.settings = nextSettings;
  if (skipFlag) {
    appState.missionModalQueue = [];
  }
  apiRequest("/api/profile/update", "POST", { settings: nextSettings })
    .then((res) => {
      if (res && res.user) {
        appState.user = res.user;
      }
    })
    .catch(() => {});
}

function openMissionCompletionModal(ev) {
  if (!ev) return;
  const m = ev.mission || {};
  const rewardNotes = Array.isArray(ev.rewardNotes) && ev.rewardNotes.length > 0
    ? ev.rewardNotes
    : [ev.rewardSummary || m.rewardText || "Mission Reward"];
  const favorNotes = Array.isArray(ev.favorNotes) ? ev.favorNotes : [];
  const favorGems = renderFactionGemNodes(m.favor || []);

  const skipCheckbox = el("input", {
    type: "checkbox",
    checked: Boolean(
      appState.user && appState.user.settings && appState.user.settings.skipMissionCompletionPopups
    ),
    onChange: (e) => {
      persistSkipMissionCompletionPopups(Boolean(e.target.checked));
    },
  });

  const body = el(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: "0.85rem" } },
    el(
      "div",
      {
        style: {
          padding: "0.65rem 0.85rem",
          borderRadius: "4px",
          background: "#ecfdf5",
          border: "1.5px solid #16a34a",
          boxShadow: "var(--bevel-sunken)",
          textAlign: "center",
        },
      },
      el("div", {
        style: { fontFamily: "Cinzel, Georgia, serif", fontSize: "1.02rem", fontWeight: "800", color: "#14532d" },
        text: `✨ Mission Accomplished: "${m.name || "Missio"}"!`,
      }),
      ev.contextDetail
        ? el("div", {
            style: { fontSize: "0.84rem", color: "#8c5612", marginTop: "0.25rem", fontWeight: "700" },
            text: `Completed by ${ev.contextDetail}`,
          })
        : null
    ),
    el(
      "div",
      { style: { display: "flex", justifyContent: "center", margin: "0.2rem 0" } },
      el("div", { style: { width: "250px" } }, renderPhysicalMissionCardNode(m, { showStatusTag: false }))
    ),
    el(
      "div",
      {
        style: {
          padding: "0.75rem 0.9rem",
          borderRadius: "4px",
          background: "#fbf7ee",
          border: "1.5px solid #a88d6b",
          boxShadow: "var(--bevel-sunken)",
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
        },
      },
      el("div", {
        style: { fontFamily: "Cinzel, Georgia, serif", fontSize: "0.86rem", fontWeight: "800", color: "var(--gold-bright)" },
        text: "🎁 Rewards & Imperial Favor Earned",
      }),
      el(
        "div",
        { style: { display: "flex", alignItems: "center", gap: "0.45rem", fontSize: "0.88rem", color: "#754208", fontWeight: "700" } },
        el("img", { className: "phys-inline-icon", src: "/assets/icons/chest.png", alt: "Reward" }),
        el("span", { text: `Rewards: ${rewardNotes.join(" • ")}` })
      ),
      el(
        "div",
        { style: { display: "flex", alignItems: "center", gap: "0.45rem", fontSize: "0.86rem", color: "#15803d", fontWeight: "700", flexWrap: "wrap" } },
        el("img", { className: "phys-inline-icon", src: "/assets/icons/thumb_up.png", alt: "Favor" }),
        el("span", {
          text: `Faction Favor: ${
            favorNotes.length > 0 ? favorNotes.join(", ") : ev.favorSummary || "No Faction Favor change"
          }`,
        }),
        ...favorGems
      )
    ),
    el(
      "div",
      {
        style: {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "0.75rem",
          flexWrap: "wrap",
          marginTop: "0.25rem",
        },
      },
      el(
        "label",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: "0.45rem",
            fontSize: "0.82rem",
            color: "var(--text-muted)",
            cursor: "pointer",
            userSelect: "none",
          },
        },
        skipCheckbox,
        el("span", { text: "Do not show this again" })
      ),
      el("button", {
        type: "button",
        className: "btn btn-primary",
        text: appState.missionModalQueue.length > 0 ? "🏛️ Claim & View Next Completed Mission ▶" : "🏛️ Claim Rewards & Continue",
        onClick: () => {
          if (skipCheckbox.checked) {
            persistSkipMissionCompletionPopups(true);
          }
          closeModal();
          if (appState.gameState) {
            checkPostActionModals(appState.gameState);
          }
        },
      })
    )
  );

  showModal(`🏆 Mission Completed — ${m.name || "Missio"}`, body);
}

function buildFallbackFinalStandings(state) {
  if (!state || !Array.isArray(state.players)) return [];
  const winnerName = state.winner || null;
  const sorted = [...state.players].sort((a, b) => {
    const aElim = a.eliminated ? 1 : 0;
    const bElim = b.eliminated ? 1 : 0;
    if (aElim !== bElim) return aElim - bElim;
    const aWon = winnerName && a.name === winnerName ? 1 : 0;
    const bWon = winnerName && b.name === winnerName ? 1 : 0;
    if (aWon !== bWon) return bWon - aWon;
    const cashDiff = (Number(b.cash) || 0) - (Number(a.cash) || 0);
    if (cashDiff !== 0) return cashDiff;
    return (Number(a.index) || 0) - (Number(b.index) || 0);
  });
  let prevCash = null;
  let prevWon = false;
  let prevElim = null;
  let prevRank = 1;
  return sorted.map((p, idx) => {
    const isElim = Boolean(p.eliminated);
    const won = !isElim && (winnerName ? p.name === winnerName : idx === 0);
    const cashVal = Number(p.cash) || 0;
    let rank = idx + 1;
    if (idx === 0) {
      rank = 1;
    } else if (!won && !prevWon && prevElim === isElim && prevCash !== null && cashVal === prevCash) {
      rank = prevRank;
    }
    prevCash = cashVal;
    prevWon = won;
    prevElim = isElim;
    prevRank = rank;
    const summary = p.statsSummary || {};
    const favorSnap = summary.endingFactionStandings || p.favor || {};
    return {
      rank,
      playerIndex: Number(p.index ?? idx),
      userId: p.userId ?? null,
      name: p.name || `Player ${idx + 1}`,
      color: p.color || "Z3",
      isBot: Boolean(p.isBot),
      won,
      eliminated: isElim,
      eliminationReason: p.eliminationReason || null,
      cash: cashVal,
      winterReckoning: p.winterReckoning || summary.winterReckoning || null,
      endingFactionStandings: favorSnap,
      stats: summary,
    };
  });
}

function openFinalScoringModal(standings, meta = {}) {
  const list = Array.isArray(standings) ? standings : [];
  const gameTitle = meta.gameName || (appState.gameSummary && appState.gameSummary.name) || "Roman Expedition";
  const winnerEntry = list.find((s) => s && s.won) || list.find((s) => s && !s.eliminated) || list[0] || null;
  const winnerName = meta.winnerName || (winnerEntry ? winnerEntry.name : "Unknown Merchant");
  const factionOrder = ["Caracalla", "Geta", "Domna", "Plautilla", "Aurelius"];

  const formatSignedDenarii = (n) => {
    const v = Number(n) || 0;
    return v > 0 ? `+${v}(d)` : `${v}(d)`;
  };

  const rankingCards = list.map((entry, idx) => {
    const rankNum = Number(entry.rank) || idx + 1;
    const stats = entry.stats || {};
    const enc = stats.encounters || {};
    const favorMap = entry.endingFactionStandings || stats.endingFactionStandings || {};
    const totalCells = Number(stats.totalNeighborhoods) || 36;
    const wr = entry.winterReckoning || stats.winterReckoning || null;
    const isEliminated = Boolean(entry.eliminated || (wr && wr.eliminated));
    const elimReason = entry.eliminationReason || (wr && wr.eliminationReason) || "Imperial Proscription";
    const rankClass = !isEliminated && rankNum <= 3 ? `rank-${rankNum}` : "";

    const factionChips = factionOrder.map((fKey) => {
      const fMeta = FACTION_META.find((f) => f.key === fKey) || {
        gem: "/assets/icons/ruby.png",
        color: "#8c5612",
      };
      const val = Number(favorMap[fKey]) || 0;
      const signed = val > 0 ? `+${val}` : String(val);
      const valColor = val > 0 ? "#15803d" : val < 0 ? "#b91c1c" : "var(--text-muted)";
      const fDelta =
        wr && wr.factionBreakdown && typeof wr.factionBreakdown[fKey] === "number"
          ? wr.factionBreakdown[fKey]
          : null;
      return el(
        "span",
        {
          className: "final-faction-chip",
          style: { borderColor: val !== 0 ? fMeta.color : "rgba(133, 94, 52, 0.35)" },
        },
        el("img", { src: fMeta.gem, alt: fKey }),
        el("span", { style: { color: "var(--text-main)" }, text: `${fKey}:` }),
        el("span", { style: { color: valColor }, text: signed }),
        fDelta !== null && fDelta !== 0
          ? el("span", {
              style: {
                fontSize: "0.72rem",
                marginLeft: "0.18rem",
                color: fDelta > 0 ? "#15803d" : "#b91c1c",
              },
              text: `(${formatSignedDenarii(fDelta)})`,
            })
          : null
      );
    });

    let winterNode = null;
    if (wr) {
      const hasClimateBreakdown = Array.isArray(wr.climateBreakdown);
      const mComp = Number(wr.missionsCompleted ?? stats.missionsCompleted) || 0;
      const mFail = Number(wr.missionsFailed ?? stats.missionsFailed) || 0;
      const mNet = typeof wr.netMissions === "number" ? wr.netMissions : mComp - mFail;
      const mNetStr = mNet > 0 ? `+${mNet}` : String(mNet);

      if (hasClimateBreakdown) {
        const step1Fines = Number(wr.step1MissionFines) || 0;
        const cDelta = Number(wr.climateDelta) || 0;
        const wrCells = [
          ["Fall Cash", `${Number(wr.preReckoningCash) || 0}(d)`, "var(--text-main)"],
          ...(step1Fines !== 0
            ? [["Step 1 Mission Fines", formatSignedDenarii(step1Fines), "#b91c1c"]]
            : []),
          [
            "Cart Goods (>>)",
            `+${Number(wr.goodsLiquidated) || 0}(d)`,
            Number(wr.goodsLiquidated) > 0 ? "#15803d" : "var(--text-muted)",
          ],
          [
            "Unpaid Loans",
            Number(wr.loansDeducted) > 0 ? `-${Number(wr.loansDeducted)}(d)` : "0(d)",
            Number(wr.loansDeducted) > 0 ? "#b91c1c" : "var(--text-muted)",
          ],
          [
            "Political Climate",
            isEliminated ? `☠️ ELIMINATED (${formatSignedDenarii(cDelta)})` : formatSignedDenarii(cDelta),
            isEliminated ? "#b91c1c" : cDelta > 0 ? "#15803d" : cDelta < 0 ? "#b91c1c" : "var(--text-muted)",
          ],
          [
            `Missions (✓${mComp}/✕${mFail})`,
            `Net ${mNetStr}`,
            mNet > 0 ? "#15803d" : mNet < 0 ? "#b91c1c" : "var(--text-muted)",
          ],
          [
            "Final Treasury",
            isEliminated
              ? `☠️ ${Number(wr.finalCash ?? entry.cash) || 0}(d) (Proscribed)`
              : `${Number(wr.finalCash ?? entry.cash) || 0}(d)`,
            isEliminated ? "#b91c1c" : "#754208",
          ],
        ];
        winterNode = el(
          "div",
          { className: "winter-reckoning-box" },
          el("div", {
            className: "final-section-label",
            style: { color: "#991b1b" },
            text: "⚔️ December 211 Purge — Political Climate & Winter Reckoning",
          }),
          el(
            "div",
            { className: "winter-reckoning-grid" },
            ...wrCells.map(([lbl, val, clr]) =>
              el(
                "div",
                { className: "final-stat-cell" },
                el("span", { className: "final-stat-lbl", text: lbl }),
                el("span", { className: "final-stat-val", style: { color: clr }, text: val })
              )
            )
          ),
          wr.climateBreakdown.length > 0
            ? el(
                "div",
                { className: "climate-reckoning-breakdown" },
                ...wr.climateBreakdown.map((cb) => {
                  const cbElim = Boolean(cb.eliminated);
                  const cbDelta = Number(cb.delta) || 0;
                  const valText = cbElim ? "☠️ ELIMINATED" : formatSignedDenarii(cbDelta);
                  const valClr = cbElim
                    ? "#b91c1c"
                    : cbDelta > 0
                    ? "#15803d"
                    : cbDelta < 0
                    ? "#b91c1c"
                    : "var(--text-muted)";
                  return el(
                    "div",
                    { className: "climate-reckoning-row" },
                    el(
                      "span",
                      { className: "climate-reckoning-title" },
                      el("strong", { text: `${cb.factor || "Climate"} — ${cb.title || cb.id}: ` }),
                      el("span", { style: { color: "var(--text-muted)" }, text: cb.detail || "" })
                    ),
                    el("span", {
                      className: "climate-reckoning-delta",
                      style: { color: valClr, fontWeight: "800" },
                      text: valText,
                    })
                  );
                })
              )
            : null
        );
      } else {
        const leaderNotes = [];
        if (Number(wr.caracallaLeaderBonus) > 0) {
          leaderNotes.push(`+${wr.caracallaLeaderBonus}(d) Imperial Contract (Caracalla)`);
        }
        if (Number(wr.aureliusLeaderBonus) > 0) {
          leaderNotes.push(`+${wr.aureliusLeaderBonus}(d) Senatorial Patronage (Aurelius)`);
        }
        if (Number(wr.plautillaLeaderBonus) > 0) {
          leaderNotes.push(`+${wr.plautillaLeaderBonus}(d) Smuggler Ring (Plautilla)`);
        }
        if (Number(wr.missionBonus) > 0 && wr.missionRankLabel) {
          leaderNotes.push(`+${wr.missionBonus}(d) Master Purveyor (${wr.missionRankLabel})`);
        }
        const mBonus = Number(wr.missionBonus) || 0;
        const wrCells = [
          ["Fall Cash", `${Number(wr.preReckoningCash) || 0}(d)`, "var(--text-main)"],
          [
            "Cart Goods (>>)",
            `+${Number(wr.goodsLiquidated) || 0}(d)`,
            Number(wr.goodsLiquidated) > 0 ? "#15803d" : "var(--text-muted)",
          ],
          [
            "Unpaid Loans",
            Number(wr.loansDeducted) > 0 ? `-${Number(wr.loansDeducted)}(d)` : "0(d)",
            Number(wr.loansDeducted) > 0 ? "#b91c1c" : "var(--text-muted)",
          ],
          [
            "Faction Purge",
            formatSignedDenarii(wr.factionDelta),
            Number(wr.factionDelta) > 0
              ? "#15803d"
              : Number(wr.factionDelta) < 0
              ? "#b91c1c"
              : "var(--text-muted)",
          ],
          [
            `Missions (Net ${mNetStr})`,
            `+${mBonus}(d)`,
            mBonus > 0 ? "#15803d" : mNet < 0 ? "#b91c1c" : "var(--text-muted)",
          ],
          ["Final Treasury", `${Number(wr.finalCash ?? entry.cash) || 0}(d)`, "#754208"],
        ];
        winterNode = el(
          "div",
          { className: "winter-reckoning-box" },
          el("div", {
            className: "final-section-label",
            style: { color: "#991b1b" },
            text: "⚔️ December 211 Purge — Winter Reckoning",
          }),
          el(
            "div",
            { className: "winter-reckoning-grid" },
            ...wrCells.map(([lbl, val, clr]) =>
              el(
                "div",
                { className: "final-stat-cell" },
                el("span", { className: "final-stat-lbl", text: lbl }),
                el("span", { className: "final-stat-val", style: { color: clr }, text: val })
              )
            )
          ),
          leaderNotes.length > 0
            ? el("div", {
                style: { fontSize: "0.76rem", color: "#754208", fontWeight: "700" },
                text: `🏛️ Reckoning Honors: ${leaderNotes.join(" • ")}`,
              })
            : null
        );
      }
    }

    const netMissionsStat = (Number(stats.missionsCompleted) || 0) - (Number(stats.missionsFailed) || 0);
    const coreStats = [
      ["Combats Engaged", String(Number(stats.combats) || 0)],
      ["Items Purchased", String(Number(stats.itemsPurchased) || 0)],
      ["Items Sold", String(Number(stats.itemsSold) || 0)],
      ["Neighborhoods Traversed", String(Number(stats.neighborhoodsTraversed) || 0)],
      ["Neighborhoods Visited", `${Number(stats.neighborhoodsVisited) || 0} / ${totalCells}`],
      ["Missions Completed", String(Number(stats.missionsCompleted) || 0)],
      ["Missions Failed", String(Number(stats.missionsFailed) || 0)],
      ["Net Missions", netMissionsStat > 0 ? `+${netMissionsStat}` : String(netMissionsStat)],
      ["Influence Cards Played", String(Number(stats.influencePlayed) || 0)],
    ];

    const encounterStats = [
      ["Patricii", Number(enc.patricii) || 0],
      ["Nefarii", Number(enc.nefarii) || 0],
      ["Legionnaires", Number(enc.legiones) || 0],
      ["Angry Mobs", Number(enc.angryMobs) || 0],
      ["Theater Troupes", Number(enc.theaterTroupes) || 0],
      ["Soothsayers", Number(enc.soothsayers) || 0],
    ];

    return el(
      "div",
      { className: `final-ranking-card ${entry.won ? "rank-winner" : ""} ${isEliminated ? "rank-eliminated" : ""}` },
      el(
        "div",
        { className: "final-ranking-header" },
        el(
          "div",
          { className: "final-ranking-identity" },
          el("span", { className: `final-rank-badge ${rankClass}`, text: isEliminated ? "☠️" : `#${rankNum}` }),
          renderCartIconNode(entry.color, "", `${entry.name}'s Cart`),
          el("strong", {
            style: {
              fontFamily: "Cinzel, Georgia, serif",
              fontSize: "1.02rem",
              color: isEliminated ? "#991b1b" : entry.won ? "#6e2119" : "var(--text-main)",
            },
            text: entry.name,
          }),
          entry.isBot
            ? el("span", { className: "badge", text: "AI Persona" })
            : null,
          isEliminated
            ? el("span", {
                className: "eliminated-badge",
                text: `☠️ Eliminated (${elimReason})`,
              })
            : null,
          entry.won && !isEliminated
            ? el("span", {
                className: "badge",
                style: { borderColor: "#b45309", color: "#78350f", background: "#fef3c7" },
                text: "👑 Victorious Night Merchant",
              })
            : null
        ),
        el("div", {
          className: "final-score-pill",
          style: isEliminated ? { borderColor: "#dc2626", color: "#991b1b", background: "#fef2f2" } : {},
          text: isEliminated ? `☠️ ${Number(entry.cash) || 0}d (Eliminated)` : `${Number(entry.cash) || 0} Denarii (d)`,
        })
      ),
      winterNode,
      el(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "0.3rem" } },
        el("div", { className: "final-section-label", text: "Ending Faction Standings" }),
        el("div", { className: "final-faction-strip" }, ...factionChips)
      ),
      el(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "0.3rem" } },
        el("div", { className: "final-section-label", text: "Expedition & Trade Ledger" }),
        el(
          "div",
          { className: "final-stats-grid" },
          ...coreStats.map(([lbl, val]) =>
            el(
              "div",
              { className: "final-stat-cell" },
              el("span", { className: "final-stat-lbl", text: lbl }),
              el("span", { className: "final-stat-val", text: val })
            )
          )
        )
      ),
      el(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "0.3rem" } },
        el("div", { className: "final-section-label", text: "Nocturnal Encounters in Rome" }),
        el(
          "div",
          { className: "final-encounters-row" },
          ...encounterStats.map(([lbl, count]) =>
            el(
              "span",
              { className: "final-encounter-chip" },
              el("span", { text: `${lbl}:` }),
              el("strong", { text: String(count) })
            )
          )
        )
      )
    );
  });

  const body = el(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: "0.85rem" } },
    el(
      "div",
      { className: "final-scoring-banner" },
      el("img", {
        className: "final-scoring-mori-thumb",
        src: "/assets/rome_art/mosaic_memento_mori.jpg?v=30",
        alt: "Pompeii Fortune's Wheel Memento Mori Mosaic",
      }),
      el(
        "div",
        {},
        el("div", {
          className: "final-scoring-banner-title",
          text: `🏛️ Victory in Rome — ${winnerName} Triumphs!`,
        }),
        el("div", {
          className: "final-scoring-banner-sub",
          text: `${gameTitle}${meta.season ? ` • Concluded in ${meta.season}, 211 A.D.` : " • December 211 A.D. Reckoning"}`,
        })
      )
    ),
    rankingCards.length > 0
      ? el("div", { className: "final-rankings-list" }, ...rankingCards)
      : el("p", { style: { color: "var(--text-muted)", textAlign: "center" }, text: "No final player rankings recorded for this game." }),
    el(
      "div",
      {
        style: {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "0.75rem",
          flexWrap: "wrap",
          marginTop: "0.35rem",
        },
      },
      el("button", {
        type: "button",
        className: "btn btn-sm",
        text: "📜 View All Completed Games",
        onClick: () => {
          closeModal();
          openCompletedGamesPage();
        },
      }),
      el("button", {
        type: "button",
        className: "btn btn-primary",
        text: "Close Final Ledger",
        onClick: closeModal,
      })
    )
  );

  showModal(`🏆 Final Scoring & Winter Reckoning — ${gameTitle}`, body, { wide: true });
}

async function loadCompletedGames() {
  if (!appState.user) return;
  appState.completedGamesLoading = true;
  renderApp();
  try {
    const res = await apiRequest("/api/profile/completed-games");
    appState.completedGames = Array.isArray(res.completedGames) ? res.completedGames : [];
    if (res.user) {
      appState.user = { ...(appState.user || {}), ...res.user };
    }
  } catch (err) {
    showToast(err.message || "Failed to load completed games.", true);
  } finally {
    appState.completedGamesLoading = false;
    renderApp();
  }
}

function openCompletedGamesPage() {
  if (!appState.user) return;
  appState.activeTab = "completed_games";
  loadCompletedGames();
}

function renderCompletedGamesView() {
  const user = appState.user || {};
  const games = Array.isArray(appState.completedGames) ? appState.completedGames : [];

  const headerPanel = el(
    "div",
    { className: "panel" },
    el(
      "div",
      { className: "panel-title" },
      el("span", { text: `🏆 Completed Games & Final Scores — ${user.displayName || "Merchant"}` }),
      el(
        "div",
        { style: { display: "flex", gap: "0.5rem", flexWrap: "wrap" } },
        el("button", {
          type: "button",
          className: "btn btn-sm",
          text: "👤 Profile",
          onClick: () => {
            appState.activeTab = "profile";
            renderApp();
          },
        }),
        el("button", {
          type: "button",
          className: "btn btn-sm btn-primary",
          text: "← Back to Members Portal",
          onClick: async () => {
            appState.activeTab = "portal";
            await refreshPortalOverview();
            renderApp();
          },
        })
      )
    ),
    el("p", {
      style: { fontSize: "0.85rem", color: "var(--text-muted)", margin: "0.2rem 0 0.65rem" },
      text: "Every unique Roman expedition you have completed is recorded below with all participating merchants and their final Denarii scores. Each unique game counts at most once toward your total victories and expeditions played.",
    }),
    el(
      "div",
      { className: "completed-games-summary-grid" },
      el(
        "div",
        { className: "profile-stat-box" },
        el("div", { className: "stat-val", text: String(user.gamesPlayed || 0) }),
        el("div", { className: "stat-lbl", text: "Unique Games Completed" })
      ),
      el(
        "div",
        { className: "profile-stat-box" },
        el("div", { className: "stat-val", text: String(user.gamesWon || 0) }),
        el("div", { className: "stat-lbl", text: "Imperial Victories" })
      ),
      el(
        "div",
        { className: "profile-stat-box" },
        el("div", { className: "stat-val", text: `${user.bestWealth || 0}(d)` }),
        el("div", { className: "stat-lbl", text: "Best Final Score" })
      )
    )
  );

  let listContent = null;
  if (appState.completedGamesLoading && games.length === 0) {
    listContent = el(
      "div",
      { className: "panel", style: { textAlign: "center", padding: "2rem" } },
      el("p", { style: { color: "var(--gold-bright)" }, text: "Consulting the Imperial Tabularium..." })
    );
  } else if (games.length === 0) {
    listContent = el(
      "div",
      { className: "panel", style: { textAlign: "center", padding: "2rem" } },
      el("p", {
        style: { color: "var(--text-muted)", marginBottom: "0.85rem" },
        text: "You have not completed any expeditions yet. Finish a game through Fall Clean-Up or Regicide to record your final standings!",
      }),
      el("button", {
        type: "button",
        className: "btn btn-primary",
        text: "🏛️ Return to Lobbies",
        onClick: async () => {
          appState.activeTab = "portal";
          await refreshPortalOverview();
          renderApp();
        },
      })
    );
  } else {
    listContent = el(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: "0.85rem" } },
      ...games.map((g) => {
        const dateStr =
          g.completedAt && Number(g.completedAt) > 0
            ? new Date(Number(g.completedAt) * 1000).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })
            : "Anno Domini 211";
        const hasDetailedStats = Array.isArray(g.standings) && g.standings.length > 0;
        const players = Array.isArray(g.players) ? g.players : [];

        return el(
          "div",
          { className: `completed-game-card ${g.userWon ? "user-won-card" : ""}` },
          el(
            "div",
            { className: "completed-game-card-header" },
            el(
              "div",
              { style: { display: "flex", flexDirection: "column", gap: "0.2rem" } },
              el(
                "div",
                { style: { display: "flex", alignItems: "center", gap: "0.55rem", flexWrap: "wrap" } },
                el("strong", {
                  style: { fontFamily: "Cinzel, Georgia, serif", fontSize: "1.02rem", color: "var(--gold-bright)" },
                  text: g.gameName || "Roman Expedition",
                }),
                g.userWon
                  ? el("span", {
                      className: "badge",
                      style: { borderColor: "#b45309", color: "#78350f", background: "#fef3c7" },
                      text: "🏆 Victory",
                    })
                  : el("span", {
                      className: "badge",
                      text: g.userRank ? `Rank #${g.userRank}` : "Completed",
                    })
              ),
              el("div", {
                style: { fontSize: "0.78rem", color: "var(--text-muted)" },
                text: `Completed ${dateStr}${g.season ? ` • Ended in ${g.season}` : ""}${
                  g.winnerName ? ` • Winner: ${g.winnerName}` : ""
                }`,
              })
            ),
            el(
              "div",
              { style: { display: "flex", gap: "0.45rem", flexWrap: "wrap" } },
              hasDetailedStats
                ? el("button", {
                    type: "button",
                    className: "btn btn-sm btn-primary",
                    text: "📊 Full Stats & Rankings",
                    onClick: () =>
                      openFinalScoringModal(g.standings, {
                        gameName: g.gameName,
                        winnerName: g.winnerName,
                        season: g.season,
                      }),
                  })
                : null,
              g.canReopenBoard
                ? el("button", {
                    type: "button",
                    className: "btn btn-sm",
                    text: "⚔️ Open Board",
                    onClick: () => openGame(g.gameId),
                  })
                : null
            )
          ),
          el(
            "div",
            { className: "completed-game-players-list" },
            ...players.map((p, pIdx) => {
              const rk = Number(p.rank) || pIdx + 1;
              return el(
                "div",
                { className: `completed-game-player-row ${p.won ? "winner-row" : ""}` },
                el(
                  "div",
                  { style: { display: "flex", alignItems: "center", gap: "0.45rem", minWidth: "0" } },
                  el("strong", {
                    style: { color: p.won ? "#6e2119" : "var(--gold-bright)", fontSize: "0.82rem" },
                    text: `#${rk}`,
                  }),
                  renderCartIconNode(p.color || "Z3", "", `${p.name}'s Cart`),
                  el("span", {
                    style: {
                      fontWeight: p.userId === user.id ? "800" : "600",
                      color: p.won ? "#6e2119" : "var(--text-main)",
                      fontSize: "0.86rem",
                    },
                    text: `${p.won ? "👑 " : ""}${p.name}${p.isBot ? " (AI)" : ""}`,
                  })
                ),
                el("strong", {
                  style: { color: "#754208", fontSize: "0.9rem", whiteSpace: "nowrap" },
                  text: `${Number(p.finalScore) || 0}(d)`,
                })
              );
            })
          )
        );
      })
    );
  }

  return el("div", { className: "completed-games-container" }, headerPanel, listContent);
}

function checkPostActionModals(state) {
  if (!state || !state.players) return;
  const vp = state.players[state.viewerPlayerIndex || 0];
  if (!vp) return;

  const finishKey = `${appState.currentGameId || "local"}:finished`;
  if (state.phase !== "finished") {
    appState.shownFinishModalGameIds.delete(finishKey);
  }

  // -1. Check if a Mission was just completed (wait until any active 3D dice overlay is dismissed)
  if (appState.missionModalQueue.length > 0 && !appState.activeDiceOverlay) {
    const nextMissionEv = appState.missionModalQueue.shift();
    openMissionCompletionModal(nextMissionEv);
    return;
  }

  // 0. Check if player has an active Top 3 Peek & Reorder (Informants Influence card)
  if (vp.pendingTop3Reorder && vp.pendingTop3Reorder.id) {
    if (appState.promptedTop3Id !== vp.pendingTop3Reorder.id) {
      appState.promptedTop3Id = vp.pendingTop3Reorder.id;
      openTop3ReorderModal(vp.pendingTop3Reorder);
      return;
    }
  } else {
    appState.promptedTop3Id = null;
  }

  // 0A. Check if player has an incoming Good or Guard reward exceeding Cart/Guard capacity
  if (Array.isArray(vp.pendingCartOverflow) && vp.pendingCartOverflow.length > 0) {
    if (!appState.activeDiceOverlay) {
      const nextOvf = vp.pendingCartOverflow[0];
      if (nextOvf && nextOvf.id && appState.promptedCartOverflowId !== nextOvf.id) {
        appState.promptedCartOverflowId = nextOvf.id;
        openPendingCartOverflowModal(state, vp);
        return;
      }
    }
  } else {
    appState.promptedCartOverflowId = null;
  }

  // 0A2. Check if player has a pending Market Board reward choice (e.g. Vigilante -> Any Meat Animal on Market)
  if (Array.isArray(vp.pendingMarketReward) && vp.pendingMarketReward.length > 0) {
    if (!appState.activeDiceOverlay) {
      const nextMktRwd = vp.pendingMarketReward[0];
      if (nextMktRwd && nextMktRwd.id && appState.promptedMarketRewardId !== nextMktRwd.id) {
        appState.promptedMarketRewardId = nextMktRwd.id;
        openMarketRewardModal(state, vp);
        return;
      }
    }
  } else {
    appState.promptedMarketRewardId = null;
  }

  // 0B. Check if player has an active NPC Purchase/Sale Offer (e.g. Quintus Tineius Sacerdos)
  if (vp.pendingNpcOffer && vp.pendingNpcOffer.id) {
    if (appState.promptedNpcOfferId !== vp.pendingNpcOffer.id) {
      appState.promptedNpcOfferId = vp.pendingNpcOffer.id;
      openNpcOfferModal(state, vp);
      return;
    }
  } else {
    appState.promptedNpcOfferId = null;
  }

  // 1. Check if a new scouted tile/card was just revealed
  if (Array.isArray(vp.scoutedInfo)) {
    for (let i = vp.scoutedInfo.length - 1; i >= 0; i--) {
      const si = vp.scoutedInfo[i];
      if (si && si.id && !appState.shownScoutIds.has(si.id)) {
        appState.shownScoutIds.add(si.id);
        openScoutResultModal(si);
        return;
      }
    }
  }

  // 2. Check if the player has a delivery mission with cargo available to load or deliver at their current cell
  const autoPrompt =
    !appState.user || !appState.user.settings || appState.user.settings.autoPromptCargoLoad !== false;
  if (autoPrompt && state.phase === "delivery" && !state.pendingEncounter && vp.position) {
    const missions = vp.missions || [];
    for (const m of missions) {
      if (m.kind === "delivery" && m.canLoadCargo && !m.pickedUp && !m.completed && !m.failed) {
        const promptKey = `${appState.currentGameId}:pickup:${m.id}:${vp.position}:${state.turn}`;
        if (!appState.promptedCargoPickups.has(promptKey)) {
          appState.promptedCargoPickups.add(promptKey);
          openLoadCargoPromptModal(m, vp);
          return;
        }
      }
      if (m.kind === "delivery" && m.canDeliverCargo && m.pickedUp && !m.completed && !m.failed) {
        const deliverKey = `${appState.currentGameId}:deliver:${m.id}:${vp.position}:${state.turn}`;
        if (!appState.promptedCargoDeliveries.has(deliverKey)) {
          appState.promptedCargoDeliveries.add(deliverKey);
          openDeliverCargoPromptModal(m, vp);
          return;
        }
      }
    }
  }

  // 3. When the game ends, automatically show the Final Scoring & Expedition Statistics pop-up
  if (state.phase === "finished" && !appState.activeDiceOverlay && appState.missionModalQueue.length === 0) {
    if (!appState.shownFinishModalGameIds.has(finishKey)) {
      appState.shownFinishModalGameIds.add(finishKey);
      const standings =
        Array.isArray(state.finalStandings) && state.finalStandings.length > 0
          ? state.finalStandings
          : buildFallbackFinalStandings(state);
      openFinalScoringModal(standings, {
        gameName: appState.gameSummary ? appState.gameSummary.name : "Roman Expedition",
        winnerName: state.winner,
        season: state.season,
      });
      return;
    }
  }
}

async function openGame(gameId) {
  try {
    const isSwitchingGame = appState.currentGameId !== gameId;
    const res = await apiRequest(`/api/games/${gameId}`);
    appState.currentGameId = gameId;
    appState.gameSummary = res.summary;
    appState.gameState = res.state;
    appState.setupDiscardMissions.clear();
    appState.setupDiscardInfluence.clear();
    syncGameUiTransitions(res.state, isSwitchingGame);
    if (isSwitchingGame) {
      appState.marketBoardScrollLeft = 0;
      appState.marketBoardScrollTop = 0;
      appState.climateBoardScrollLeft = 0;
      seedSeenScoutIds(res.state);
      stopNpcTurnPacing();
      enqueueNewNpcEvents(res.state, true);
    } else {
      enqueueNewNpcEvents(res.state, false);
    }
    if (isSwitchingGame || appState.lastSeenDiceSeq === null) {
      clearDiceOverlayState();
      appState.lastSeenDiceSeq =
        res.state && typeof res.state.lastDiceSeq === "number" ? res.state.lastDiceSeq : 0;
    } else {
      enqueueNewDiceEvents(res.state);
    }
    if (isSwitchingGame || appState.lastSeenMissionEventSeq === null) {
      appState.missionModalQueue = [];
      appState.lastSeenMissionEventSeq =
        res.state && typeof res.state.lastMissionEventSeq === "number" ? res.state.lastMissionEventSeq : 0;
    } else {
      enqueueNewMissionEvents(res.state);
    }
    if (res.state && res.state.players) {
      const vp = res.state.players[res.state.viewerPlayerIndex || 0];
      if (vp && vp.position) {
        appState.inspectedCell = vp.position;
      }
    }
    appState.activeTab = "tabletop";
    renderApp();
    checkPostActionModals(res.state);
  } catch (err) {
    showToast(err.message, true);
  }
}

async function sendGameAction(actionPayload) {
  if (!appState.currentGameId) return;
  try {
    const res = await apiRequest(`/api/games/${appState.currentGameId}/action`, "POST", actionPayload);
    if (res.user) {
      appState.user = { ...(appState.user || {}), ...res.user };
    }
    const actType = actionPayload && actionPayload.type ? String(actionPayload.type) : "";
    if (
      [
        "market_buy",
        "delivery_sell",
        "delivery_forum_buy",
        "cleanup_take_loan",
        "cleanup_repay_loan",
        "cleanup_buy_influence",
        "delivery_complete_mission",
        "delivery_gamble",
      ].includes(actType)
    ) {
      playSfx("coin");
    } else if (
      actType === "delivery_trash" ||
      actType === "delivery_attack" ||
      (actType === "resolve_encounter" &&
        (actionPayload.decision === "fight" || actionPayload.decision === "refuse"))
    ) {
      playSfx("combat");
    }
    appState.gameSummary = res.summary;
    appState.gameState = res.state;
    syncGameUiTransitions(res.state, false);
    enqueueNewNpcEvents(res.state, false);
    enqueueNewDiceEvents(res.state);
    enqueueNewMissionEvents(res.state);
    if (res.message) showToast(res.message, false);
    if (actType === "delivery_scout" && actionPayload.targetType === "tile" && actionPayload.targetKey) {
      appState.inspectedCell = actionPayload.targetKey;
    } else if (actType === "initial_scout" && actionPayload.cell) {
      appState.inspectedCell = actionPayload.cell;
    } else if (res.state && res.state.players) {
      const vp = res.state.players[res.state.viewerPlayerIndex || 0];
      if (vp && vp.position) {
        appState.inspectedCell = vp.position;
      }
    }
    renderApp();
    checkPostActionModals(res.state);
  } catch (err) {
    showToast(err.message, true);
  }
}

function renderApp() {
  const root = document.getElementById("app-root");
  if (!root) return;

  const prevMarketMatrixEl = document.querySelector(".ostia-market-board-matrix");
  if (prevMarketMatrixEl) {
    appState.marketBoardScrollLeft = prevMarketMatrixEl.scrollLeft;
    appState.marketBoardScrollTop = prevMarketMatrixEl.scrollTop;
  }
  const prevClimateMatrixEl = document.querySelector(".senate-climate-board-matrix");
  if (prevClimateMatrixEl) {
    appState.climateBoardScrollLeft = prevClimateMatrixEl.scrollLeft;
  }

  hideRomeHoverTooltip();

  const contentNodes = [renderTopbar()];
  if (!appState.user) {
    if (appState.activeTab === "rulebook" || appState.activeTab === "reference") {
      contentNodes.push(renderRulebookView());
    } else {
      contentNodes.push(renderAuthView());
    }
  } else if (appState.user.needsUsernameSetup) {
    if (appState.activeTab === "rulebook" || appState.activeTab === "reference") {
      contentNodes.push(renderRulebookView());
    } else {
      contentNodes.push(renderGoogleUsernameSetupView());
    }
  } else if (appState.activeTab === "tabletop" && appState.gameSummary) {
    contentNodes.push(renderTabletopView());
  } else if (appState.activeTab === "rulebook" || appState.activeTab === "reference") {
    contentNodes.push(renderRulebookView());
  } else if (appState.activeTab === "profile") {
    contentNodes.push(renderProfileView());
  } else if (appState.activeTab === "completed_games") {
    contentNodes.push(renderCompletedGamesView());
  } else {
    contentNodes.push(renderPortalView());
  }
  root.replaceChildren(...contentNodes);

  if (appState.activeTab !== "tabletop") {
    appState.chronicleUserScrolled = false;
    appState.chronicleScrollTop = 0;
  } else {
    const marketMatrixEl = document.querySelector(".ostia-market-board-matrix");
    if (marketMatrixEl) {
      if (typeof appState.marketBoardScrollLeft === "number" && appState.marketBoardScrollLeft > 0) {
        marketMatrixEl.scrollLeft = appState.marketBoardScrollLeft;
      }
      if (typeof appState.marketBoardScrollTop === "number" && appState.marketBoardScrollTop > 0) {
        marketMatrixEl.scrollTop = appState.marketBoardScrollTop;
      }
    }
    const climateMatrixEl = document.querySelector(".senate-climate-board-matrix");
    if (climateMatrixEl && typeof appState.climateBoardScrollLeft === "number" && appState.climateBoardScrollLeft > 0) {
      climateMatrixEl.scrollLeft = appState.climateBoardScrollLeft;
    }
    const logBoxEl = document.getElementById("chronicle-log-box");
    if (logBoxEl) {
      logBoxEl.scrollTop = appState.chronicleUserScrolled ? appState.chronicleScrollTop : 0;
    }
    const gs = appState.gameState;
    const pend = gs && gs.pendingEncounter;
    if (pend) {
      const encKey = `${appState.currentGameId || ""}:${pend.stage || "pre_decision"}:${
        (pend.card && (pend.card.id || pend.card.name)) || pend.chartType || ""
      }`;
      if (appState.lastAutoScrolledEncounterKey !== encKey) {
        appState.lastAutoScrolledEncounterKey = encKey;
        const encPanelEl = document.getElementById("pending-encounter-panel");
        if (encPanelEl && typeof encPanelEl.getBoundingClientRect === "function") {
          const rect = encPanelEl.getBoundingClientRect();
          if (rect.top < 0 || rect.top > window.innerHeight * 0.7) {
            encPanelEl.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }
      }
    } else {
      appState.lastAutoScrolledEncounterKey = null;
    }
    if (appState.pendingScrollToClimate) {
      appState.pendingScrollToClimate = false;
      const climateEl = document.querySelector(".senate-climate-board");
      if (climateEl && typeof climateEl.scrollIntoView === "function") {
        climateEl.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }
  updateTabTurnTitle();
}

function renderTopbar() {
  const navButtons = [];
  if (appState.user && appState.user.needsUsernameSetup) {
    navButtons.push(
      el("button", {
        className: `nav-btn ${appState.activeTab !== "rulebook" && appState.activeTab !== "reference" ? "active" : ""}`,
        text: "🏛️ Choose Username",
        onClick: () => {
          appState.activeTab = "portal";
          renderApp();
        },
      }),
      el("button", {
        className: `nav-btn ${appState.activeTab === "rulebook" || appState.activeTab === "reference" ? "active" : ""}`,
        text: "📜 Rulebook",
        onClick: () => {
          appState.activeTab = "rulebook";
          renderApp();
        },
      })
    );
  } else if (appState.user) {
    navButtons.push(
      el("button", {
        className: `nav-btn ${appState.activeTab === "portal" ? "active" : ""}`,
        text: "🏛️ Lobby",
        onClick: async () => {
          appState.activeTab = "portal";
          await refreshPortalOverview();
          renderApp();
        },
      })
    );
    if (appState.gameSummary && appState.activeTab !== "tabletop") {
      navButtons.push(
        el("button", {
          className: "nav-btn",
          text: "🎲 Return to Game",
          onClick: () => {
            appState.activeTab = "tabletop";
            renderApp();
          },
        })
      );
    }
    navButtons.push(
      el("button", {
        className: `nav-btn ${appState.activeTab === "rulebook" || appState.activeTab === "reference" ? "active" : ""}`,
        text: "📜 Rulebook",
        onClick: () => {
          appState.activeTab = "rulebook";
          renderApp();
        },
      }),
      el("button", {
        className: `nav-btn ${appState.activeTab === "profile" ? "active" : ""}`,
        text: "👤 Profile",
        onClick: () => {
          appState.activeTab = "profile";
          renderApp();
        },
      })
    );
  } else {
    navButtons.push(
      el("button", {
        className: `nav-btn ${appState.activeTab !== "rulebook" && appState.activeTab !== "reference" ? "active" : ""}`,
        text: "🏛️ Sign In",
        onClick: () => {
          appState.activeTab = "portal";
          renderApp();
        },
      }),
      el("button", {
        className: `nav-btn ${appState.activeTab === "rulebook" || appState.activeTab === "reference" ? "active" : ""}`,
        text: "📜 Rulebook",
        onClick: () => {
          appState.activeTab = "rulebook";
          renderApp();
        },
      })
    );
  }

  const userStripChildren = [];
  if (appState.user) {
    if (appState.activeTab === "portal" && !appState.user.needsUsernameSetup) {
      userStripChildren.push(
        el("button", {
          type: "button",
          className: "wins-best-btn",
          title: "View completed games & final scores",
          text: `Wins: ${appState.user.gamesWon} | Best: ${appState.user.bestWealth}d`,
          onClick: () => openCompletedGamesPage(),
        })
      );
    }
    userStripChildren.push(
      el("button", {
        className: "btn btn-sm",
        text: "Sign Out",
        onClick: async () => {
          try {
            await apiRequest("/api/auth/logout", "POST", {});
          } catch (_e) {}
          await signOutFirebaseClient();
          appState.user = null;
          appState.csrfToken = null;
          appState.gameSummary = null;
          appState.gameState = null;
          appState.completedGames = [];
          appState.activeTab = "portal";
          renderApp();
        },
      })
    );
  }

  return el(
    "header",
    { className: "topbar" },
    el(
      "div",
      {
        className: "brand",
        style: { cursor: "pointer" },
        onClick: () => {
          appState.activeTab =
            appState.user && !appState.user.needsUsernameSetup && appState.gameSummary ? "tabletop" : "portal";
          renderApp();
        },
      },
      el("img", {
        className: "brand-crest-img",
        src: "/assets/icons/fleur_de_lis_gold.png",
        alt: "Night Merchant Crest",
      }),
      el(
        "div",
        { className: "brand-title" },
        el("span", { className: "brand-title-main", text: "Night Merchant:" }),
        " ",
        el("span", { className: "brand-title-sub", text: "All Roads Lead to Rome" })
      )
    ),
    el("nav", { className: "nav-tabs" }, ...navButtons),
    el("div", { className: "user-strip" }, ...userStripChildren)
  );
}

async function handlePendingInviteDeepLink() {
  const targetGameId = String(appState.pendingInviteGameId || "").trim();
  if (!targetGameId || !appState.user || appState.user.needsUsernameSetup) return;
  appState.pendingInviteGameId = null;

  try {
    const urlObj = new URL(window.location.href);
    if (urlObj.searchParams.has("game")) {
      urlObj.searchParams.delete("game");
      window.history.replaceState({}, "", urlObj.pathname + urlObj.search + urlObj.hash);
    }
  } catch (_e) {}

  const matching = (appState.games || []).find((g) => String(g.id) === targetGameId);
  if (matching) {
    const alreadySeated = (matching.seats || []).some(
      (s) => !s.isBot && s.userId !== null && s.userId !== undefined && String(s.userId) === String(appState.user.id)
    );
    if (alreadySeated && matching.status !== "lobby") {
      await openGame(matching.id);
      return;
    }
    appState.activeTab = "portal";
    appState.highlightedLobbyId = matching.id;
    renderApp();
    setTimeout(() => {
      const cardEl = document.getElementById(`lobby-card-${matching.id}`);
      if (cardEl && typeof cardEl.scrollIntoView === "function") {
        cardEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 60);
    if (alreadySeated) {
      showToast(`Opened lobby for "${matching.name}".`);
    } else if (matching.canViewerJoin) {
      showToast(`Invited expedition "${matching.name}" is ready — click Claim Invited Seat to join!`);
    } else if (matching.status !== "lobby") {
      showToast(`Expedition "${matching.name}" has already started and is closed to new players.`, true);
    } else {
      showToast(
        `Expedition "${matching.name}" is Invite-Only. Sign in with your invited username (@handle) to claim a seat.`,
        true
      );
    }
  } else {
    showToast(`Expedition #${targetGameId} could not be found.`, true);
  }
}

async function handleGoogleSignInClick() {
  if (isFirebaseClientConfigured()) {
    try {
      const idToken = await signInWithFirebaseGooglePopup();
      const res = await apiRequest("/api/auth/firebase", "POST", { idToken });
      appState.user = res.user;
      appState.csrfToken = res.csrfToken || null;
      applyUserDefaultBoardView(res.user.settings);
      appState.activeTab = "portal";
      if (res.user && res.user.needsUsernameSetup) {
        showToast("Google account verified! Choose your permanent Collegium username to finish joining.");
        renderApp();
        return;
      }
      await refreshPortalOverview();
      showToast(`Signed in with Google as ${res.user.displayName} (${maskEmailClient(res.user.email)})!`);
      renderApp();
      await handlePendingInviteDeepLink();
    } catch (err) {
      showToast(err.message || "Google sign-in was cancelled or failed.", true);
    }
    return;
  }

  // Local offline development fallback when Firebase OAuth is not configured
  const emailInput = el("input", {
    className: "form-input",
    type: "email",
    placeholder: "e.g. mercator.romanus@gmail.com",
    value: "",
    autocomplete: "email",
  });
  const submitLocalGoogle = async () => {
    const emailVal = emailInput.value.trim();
    if (!emailVal || !emailVal.includes("@")) {
      showToast("Please enter a valid Google email address.", true);
      return;
    }
    try {
      const res = await apiRequest("/api/auth/google", "POST", {
        email: emailVal,
        displayName: emailVal.split("@")[0].replace(/\./g, " "),
        googleSub: `google_${emailVal.toLowerCase()}`,
      });
      appState.user = res.user;
      appState.csrfToken = res.csrfToken;
      applyUserDefaultBoardView(res.user.settings);
      appState.activeTab = "portal";
      closeModal();
      if (res.user && res.user.needsUsernameSetup) {
        showToast("Google account verified! Choose your permanent Collegium username to finish joining.");
        renderApp();
        return;
      }
      await refreshPortalOverview();
      showToast(`Signed in with Google as ${res.user.displayName} (${maskEmailClient(res.user.email)})!`);
      renderApp();
      await handlePendingInviteDeepLink();
    } catch (err) {
      showToast(err.message, true);
    }
  };
  showModal(
    "Local Dev — Simulate Google Sign-In",
    el(
      "div",
      {},
      el("div", { className: "form-group" }, el("label", { text: "Simulated Google Email Address" }), emailInput),
      el(
        "div",
        { style: { display: "flex", gap: "0.6rem", justifyContent: "flex-end", marginTop: "1rem" } },
        el("button", { type: "button", className: "btn", text: "Cancel", onClick: closeModal }),
        el("button", { type: "button", className: "btn btn-primary", text: "Continue", onClick: submitLocalGoogle })
      )
    )
  );
}

function renderGoogleUsernameSetupView() {
  const user = appState.user || {};
  const previewNode = el("div", {
    style: {
      fontSize: "0.84rem",
      color: "var(--gold-bright)",
      fontWeight: "700",
      marginTop: "0.35rem",
    },
    text: "Preview: @your_username",
  });
  const errorBox = el("div", {
    style: {
      display: "none",
      padding: "0.55rem 0.75rem",
      marginBottom: "0.85rem",
      borderRadius: "4px",
      background: "rgba(153, 27, 27, 0.12)",
      border: "1px solid #b91c1c",
      color: "#991b1b",
      fontSize: "0.84rem",
      fontWeight: "600",
    },
  });

  const unameInput = el("input", {
    className: "form-input",
    type: "text",
    placeholder: "e.g. marcus_aurelius",
    maxLength: 34,
    autocomplete: "username",
    onInput: (e) => {
      const cleaned = String(e.target.value || "")
        .replace(/^@+/, "")
        .trim()
        .toLowerCase();
      previewNode.textContent = cleaned
        ? `Other players will invite you as: @${cleaned}`
        : "Preview: @your_username";
      errorBox.style.display = "none";
    },
  });

  let submitting = false;
  const submitBtn = el("button", {
    type: "submit",
    className: "btn btn-primary",
    style: { width: "100%", padding: "0.68rem", fontWeight: "700" },
    text: "Confirm Permanent Username & Enter Portal",
  });

  const handleConfirm = async (e) => {
    e.preventDefault();
    if (submitting) return;
    const rawVal = String(unameInput.value || "")
      .replace(/^@+/, "")
      .trim()
      .toLowerCase();
    if (rawVal.length < 3 || rawVal.length > 32) {
      errorBox.textContent = "Username must be between 3 and 32 characters.";
      errorBox.style.display = "block";
      return;
    }
    if (!/^[a-z0-9][a-z0-9_.-]*$/.test(rawVal)) {
      errorBox.textContent =
        "Username must start with a letter or number and contain only letters, numbers, underscores (_), hyphens (-), or periods (.).";
      errorBox.style.display = "block";
      return;
    }
    submitting = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "Confirming Username…";
    try {
      const res = await apiRequest("/api/profile/set-username", "POST", { username: rawVal });
      appState.user = res.user;
      applyUserDefaultBoardView(res.user.settings);
      await refreshPortalOverview();
      showToast(`Salve, @${res.user.username}! Your permanent Collegium username is set.`);
      renderApp();
      await handlePendingInviteDeepLink();
    } catch (err) {
      submitting = false;
      submitBtn.disabled = false;
      submitBtn.textContent = "Confirm Permanent Username & Enter Portal";
      errorBox.textContent = err.message || "Could not save username.";
      errorBox.style.display = "block";
    }
  };

  return el(
    "div",
    { className: "portal-container" },
    el(
      "div",
      {
        className: "auth-card",
        style: { maxWidth: "520px", margin: "2rem auto" },
      },
      el("h2", {
        className: "panel-title fresco-banner-header fresco-merchants",
        text: "🏛️ Welcome — Choose Your Permanent Username",
      }),
      el("p", {
        style: { fontSize: "0.9rem", color: "var(--text-main)", marginTop: "0" },
        text: `Signed in with Google as ${user.displayName || "Merchant"} (${maskEmailClient(user.email)}).`,
      }),
      el(
        "div",
        {
          style: {
            padding: "0.65rem 0.85rem",
            marginBottom: "1rem",
            borderRadius: "4px",
            background: "#fbf7ee",
            border: "1px solid var(--gold)",
            boxShadow: "var(--bevel-sunken)",
            fontSize: "0.84rem",
            color: "var(--text-main)",
            lineHeight: "1.45",
          },
        },
        el("strong", { text: "Permanent Invite Handle: " }),
        el("span", {
          text: "Choose the permanent @username that other players will use to invite you to games. Once confirmed, your username cannot be changed (you can still customize your Display Name and Cart Color anytime in Player Profile).",
        })
      ),
      errorBox,
      el(
        "form",
        { onSubmit: handleConfirm },
        el(
          "div",
          { className: "form-group" },
          el("label", { text: "Permanent Collegium Username (3–32 characters)" }),
          unameInput,
          previewNode
        ),
        submitBtn
      )
    )
  );
}

function renderAuthView() {
  const isLogin = appState.authMode === "login";
  const usernameInput = el("input", {
    className: "form-input",
    type: "text",
    placeholder: isLogin ? "Username or email (e.g. marcus@ostia.it)" : "e.g. marcus_aurelius",
    autocomplete: "username",
  });
  const emailInput = el("input", {
    className: "form-input",
    type: "email",
    placeholder: "e.g. marcus@collegium-ostia.org",
    autocomplete: "email",
  });
  const displayInput = el("input", {
    className: "form-input",
    type: "text",
    placeholder: "e.g. Marcus of Ostia",
  });
  const passwordInput = el("input", {
    className: "form-input",
    type: "password",
    placeholder: "Minimum 8 characters",
    autocomplete: isLogin ? "current-password" : "new-password",
  });

  let selectedColor = "Z3";
  const colorBtns = [];
  const colorPickerGrid = el(
    "div",
    { className: "color-swatch-grid" },
    ...CART_COLOR_PALETTE.slice(0, 6).map((c) => {
      const btn = el(
        "button",
        {
          type: "button",
          className: `color-swatch-option ${c.id === selectedColor ? "selected" : ""}`,
          onClick: () => {
            selectedColor = c.id;
            colorBtns.forEach((item) => item.node.classList.toggle("selected", item.id === selectedColor));
          },
        },
        renderCartIconNode(c.id, "", c.label),
        el("span", { text: c.label })
      );
      colorBtns.push({ id: c.id, node: btn });
      return btn;
    })
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const endpoint = isLogin ? "/api/auth/login" : "/api/auth/register";
      const payload = {
        username: usernameInput.value.trim(),
        password: passwordInput.value,
      };
      if (!isLogin) {
        payload.email = emailInput.value.trim();
        payload.displayName = displayInput.value.trim() || usernameInput.value.trim();
        payload.preferredColor = selectedColor;
      }
      const res = await apiRequest(endpoint, "POST", payload);
      if (isFirebaseClientConfigured()) {
        if (res.firebaseCustomToken) {
          await signInWithFirebaseCustomToken(res.firebaseCustomToken);
        } else if (res.user && res.user.email && payload.password) {
          await signInWithFirebaseEmailPassword(res.user.email, payload.password);
        }
      }
      appState.user = res.user;
      appState.csrfToken = res.csrfToken || null;
      applyUserDefaultBoardView(res.user.settings);
      await refreshPortalOverview();
      showToast(`Salve, ${res.user.displayName}! Welcome to the Collegium Mercatorum.`);
      renderApp();
      await handlePendingInviteDeepLink();
    } catch (err) {
      showToast(err.message, true);
    }
  };

  const handleQuickDemo = async () => {
    try {
      const res = await apiRequest("/api/auth/demo", "POST", {});
      appState.user = res.user;
      appState.csrfToken = res.csrfToken || null;
      applyUserDefaultBoardView(res.user.settings);
      await refreshPortalOverview();
      showToast(`Signed in to local sandbox as ${res.user.displayName}!`);
      renderApp();
      await handlePendingInviteDeepLink();
    } catch (err) {
      showToast(err.message, true);
    }
  };

  const pajouHoverTitle =
    "Geta Dying in his Mother's Arms, Jacques-Augustin-Catherine Pajou, 1766–1828 (Staatsgalerie Stuttgart)";

  const showcaseCard = el(
    "section",
    { className: "panel landing-showcase-card" },
    el(
      "div",
      { className: "panel-title fresco-banner-header fresco-griffin" },
      el("span", { text: "🦅 Anno Domini 211 — All Roads Lead to Rome" }),
      el("span", { style: { fontSize: "0.78rem", color: "#fde6b0" }, text: "2–6 Merchants • Strategy Board Game" })
    ),
    el(
      "figure",
      {
        className: "landing-pajou-figure",
        title: pajouHoverTitle,
      },
      el("img", {
        className: "landing-pajou-img",
        src: "/assets/rome_art/geta_dying_pajou.jpg",
        alt: pajouHoverTitle,
        title: pajouHoverTitle,
      }),
      el(
        "figcaption",
        { className: "landing-pajou-caption" },
        el("em", { text: "Geta Dying in his Mother's Arms" }),
        el("span", {
          text: " — Jacques-Augustin-Catherine Pajou, 1766–1828 (Staatsgalerie Stuttgart)",
        })
      )
    ),
    el(
      "div",
      { className: "landing-blurb-body" },
      el("p", {
        className: "landing-blurb-lead",
        text: "Emperor Septimius Severus is dead in Britain, leaving Rome in the volatile grip of his feuding sons, Caracalla and Geta. By day, Julius Caesar's Lex Iulia Municipalis bars heavy freight wagons from the capital's streets. Only when dusk falls at 8:00 P.M. do the city gates swing open—and the Night Merchants roll in.",
      }),
      el("p", {
        className: "landing-blurb-text",
        text: "Bid for Grain, Wine, Marble, Weapons, and Exotic Beasts at Portus Ostiae, hire gladiators and guards, and thread 36 torchlit neighborhoods across five ancient stone bridges of the Tiber before the 6:00 A.M. sunrise curfew. Court five rival Severan factions—Empress Julia Domna, exiled Plautilla, the old Aurelian Senate, and the warring co-emperors—before December 211's bloody Winter Reckoning crowns Rome's wealthiest purveyor.",
      }),
      el(
        "div",
        { className: "landing-cta-row" },
        el("button", {
          type: "button",
          className: "btn btn-primary",
          text: "📜 Read the Official Rulebook",
          onClick: () => {
            appState.activeTab = "rulebook";
            renderApp();
          },
        }),
        el("span", {
          className: "landing-cta-note",
          text: "Play solo against 5 distinct Roman AI personas or host live & async 2–6 player games.",
        })
      )
    )
  );

  const authCard = el(
    "div",
    { className: "auth-card landing-auth-card" },
    el("h2", {
      className: "panel-title fresco-banner-header fresco-merchants",
      text: "🏛️ Collegium Mercatorum — Members Portal",
    }),
    appState.pendingInviteGameId
      ? el(
          "div",
          {
            style: {
              padding: "0.6rem 0.8rem",
              marginBottom: "0.85rem",
              borderRadius: "4px",
              background: "rgba(180, 83, 9, 0.12)",
              border: "1px solid var(--gold)",
              fontSize: "0.84rem",
              color: "var(--text-main)",
            },
            text: `✉️ Expedition Invitation (#${appState.pendingInviteGameId}): Sign in with your invited Collegium account to claim your seat.`,
          }
        )
      : null,
    el("p", {
      style: { color: "var(--text-muted)", fontSize: "0.88rem", marginTop: "0" },
      text: "Sign in with your Email, Username, or Google Account to host multiplayer games, challenge AI merchants, customize your cart, and climb the Imperial Leaderboard.",
    }),
    el(
      "div",
      { style: { display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" } },
      el("button", {
        className: `btn ${isLogin ? "btn-primary" : ""}`,
        style: { flex: "1 1 140px" },
        text: "Member Sign In",
        onClick: () => {
          appState.authMode = "login";
          renderApp();
        },
      }),
      el("button", {
        className: `btn ${!isLogin ? "btn-primary" : ""}`,
        style: { flex: "1 1 140px" },
        text: "Register New Member",
        onClick: () => {
          appState.authMode = "register";
          renderApp();
        },
      })
    ),
    el(
      "button",
      {
        type: "button",
        className: "btn-google",
        onClick: handleGoogleSignInClick,
      },
      renderGoogleLogoSvg(),
      el("span", { text: "Sign in with Google" })
    ),
    el("div", { className: "auth-divider", text: "or continue with email & password" }),
    el(
      "form",
      { onSubmit: handleSubmit },
      el(
        "div",
        { className: "form-group" },
        el("label", { text: isLogin ? "Username or Email Address" : "Username" }),
        usernameInput
      ),
      !isLogin
        ? el("div", { className: "form-group" }, el("label", { text: "Email Address (Required)" }), emailInput)
        : null,
      !isLogin
        ? el("div", { className: "form-group" }, el("label", { text: "Roman Merchant Title / Display Name" }), displayInput)
        : null,
      !isLogin
        ? el("div", { className: "form-group" }, el("label", { text: "Preferred Merchant Cart" }), colorPickerGrid)
        : null,
      el("div", { className: "form-group" }, el("label", { text: "Password (8+ characters)" }), passwordInput),
      el(
        "button",
        { type: "submit", className: "btn btn-primary", style: { width: "100%", padding: "0.65rem" } },
        isLogin ? "Enter the Port of Ostia" : "Register Account & Enter Portal"
      )
    ),
    !isFirebaseClientConfigured()
      ? el(
          "div",
          { style: { marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--border-subtle)", textAlign: "center" } },
          el("button", {
            type: "button",
            className: "btn btn-crimson",
            style: { width: "100%" },
            text: "⚡ Instant One-Click Local Sandbox Login",
            onClick: handleQuickDemo,
          })
        )
      : null
  );

  return el(
    "div",
    { className: "portal-container" },
    el("div", { className: "landing-hero-grid" }, authCard, showcaseCard)
  );
}

const DEFAULT_BOT_PERSONAS = [
  { strategy: "balanced", name: "Marcus Mercator", title: "Ostia Grain & Wine Syndic" },
  { strategy: "luxury", name: "Cornelia Severa", title: "Palatine Marble Purveyor" },
  { strategy: "aggressive", name: "Titus Valerius", title: "Gladiator & Beasts Contractor" },
  { strategy: "missions", name: "Julia Lucilla", title: "Senatorial Courier" },
  { strategy: "opportunist", name: "Gaius Fulvius", title: "Subura Night Runner" },
];

function getBotPersonasCatalog() {
  return Array.isArray(appState.botPersonas) && appState.botPersonas.length > 0
    ? appState.botPersonas
    : DEFAULT_BOT_PERSONAS;
}

function buildPortalGamesListNodes() {
  if (!Array.isArray(appState.games) || appState.games.length === 0) {
    return [
      el("p", {
        style: { color: "var(--text-muted)" },
        text: "No games created yet. Use the panel on the left to launch a match!",
      }),
    ];
  }
  return appState.games.map((g) => renderLobbyItem(g));
}

function buildPortalLeaderboardNodes() {
  if (!Array.isArray(appState.leaderboard) || appState.leaderboard.length === 0) {
    return [
      el("p", {
        style: { color: "var(--text-muted)", fontSize: "0.82rem", margin: "0.35rem 0" },
        text: "No multiplayer expeditions (2+ human merchants) completed yet. Solo vs. AI games remain recorded in your personal Completed Games ledger.",
      }),
    ];
  }
  return appState.leaderboard.map((row, idx) => {
    const isCurrentUser = Boolean(
      appState.user &&
        ((row.userId !== undefined && row.userId === appState.user.id) ||
          row.displayName === appState.user.displayName)
    );
    const scoreLabel = `${row.gamesWon}W / ${row.gamesPlayed}G | Best: ${row.bestWealth}(d)`;
    return el(
      "div",
      { className: "item-row" },
      el(
        "div",
        { style: { display: "flex", alignItems: "center", gap: "0.5rem" } },
        el("strong", { style: { color: "var(--gold-bright)" }, text: `#${idx + 1}` }),
        renderCartIconNode(row.preferredColor, "", `${row.displayName}'s Cart`),
        el("span", { text: row.displayName })
      ),
      isCurrentUser
        ? el("button", {
            type: "button",
            className: "wins-best-inline-link",
            title: "Click to view your completed games & final scores",
            text: scoreLabel,
            onClick: () => openCompletedGamesPage(),
          })
        : el(
            "div",
            { style: { fontSize: "0.78rem", color: "var(--text-muted)" } },
            scoreLabel
          )
    );
  });
}

function parseUsernameTokensClient(rawStr) {
  if (!rawStr || typeof rawStr !== "string") return [];
  const seen = new Set();
  const out = [];
  for (const part of rawStr.split(/[\s,;]+/)) {
    const clean = part.replace(/^@+/, "").trim().toLowerCase();
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  }
  return out;
}

function renderPortalView() {
  const personas = getBotPersonasCatalog();
  if (!Array.isArray(appState.portalBotStrategies) || appState.portalBotStrategies.length < 5) {
    appState.portalBotStrategies = ["balanced", "luxury", "aggressive", "faction", "opportunist"];
  }
  if (!appState.portalInviteMode) {
    appState.portalInviteMode = "open";
  }
  const initialMaxP = appState.portalMaxPlayers || 3;
  const initialBots = typeof appState.portalBotCount === "number" ? appState.portalBotCount : 1;

  const nameInput = el("input", {
    className: "form-input",
    type: "text",
    value: appState.portalDraftName || `${appState.user.displayName}'s Expedition`,
    onInput: (e) => {
      appState.portalDraftName = e.target.value;
    },
  });
  const maxPlayersSelect = el(
    "select",
    {
      className: "form-input",
      onChange: (e) => {
        appState.portalMaxPlayers = Number(e.target.value) || 3;
      },
    },
    ...[2, 3, 4, 5, 6].map((n) =>
      el("option", { value: String(n), selected: n === initialMaxP, text: `${n} Merchants (Max Seats)` })
    )
  );

  const botStrategiesBox = el("div", { style: { display: "flex", flexDirection: "column", gap: "0.38rem" } });

  const rebuildBotPersonaRows = (count) => {
    if (count <= 0) {
      botStrategiesBox.replaceChildren();
      return;
    }
    const rows = [];
    rows.push(
      el("label", {
        style: { fontSize: "0.76rem", fontWeight: "700", color: "var(--gold-bright)", marginTop: "0.15rem" },
        text: "AI Bot Personas & Playstyles:",
      })
    );
    for (let i = 0; i < count; i++) {
      const currStrat = appState.portalBotStrategies[i] || personas[i % personas.length].strategy;
      appState.portalBotStrategies[i] = currStrat;
      const sel = el(
        "select",
        {
          className: "form-input",
          style: { padding: "0.3rem 0.5rem", fontSize: "0.78rem" },
          onChange: (e) => {
            appState.portalBotStrategies[i] = e.target.value;
          },
        },
        ...personas.map((p) =>
          el("option", {
            value: p.strategy,
            selected: p.strategy === currStrat,
            text: `${p.name} — ${p.title || p.strategy}`,
          })
        )
      );
      rows.push(
        el(
          "div",
          { className: "bot-persona-row" },
          el("span", {
            style: { fontSize: "0.76rem", fontWeight: "700", color: "var(--text-muted)", minWidth: "46px" },
            text: `Bot ${i + 1}:`,
          }),
          sel
        )
      );
    }
    botStrategiesBox.replaceChildren(...rows);
  };

  const botCountSelect = el(
    "select",
    {
      className: "form-input",
      onChange: (e) => {
        const cnt = Math.max(0, Math.min(5, Number(e.target.value) || 0));
        appState.portalBotCount = cnt;
        rebuildBotPersonaRows(cnt);
      },
    },
    ...[0, 1, 2, 3, 4, 5].map((n) =>
      el("option", { value: String(n), selected: n === initialBots, text: `${n} AI Bot Opponent${n === 1 ? "" : "s"}` })
    )
  );
  rebuildBotPersonaRows(initialBots);

  const ensureHumanSeatCapacity = (neededHumanGuests = 1) => {
    let currBots = Math.max(0, Math.min(5, Number(botCountSelect.value) || 0));
    let currMax = Number(maxPlayersSelect.value) || 3;
    const minNeededMax = Math.min(6, 1 + currBots + Math.max(1, neededHumanGuests));
    if (currMax < minNeededMax) {
      currMax = minNeededMax;
      maxPlayersSelect.value = String(currMax);
      appState.portalMaxPlayers = currMax;
    }
    if (1 + currBots >= currMax) {
      currBots = Math.max(0, currMax - 2);
      botCountSelect.value = String(currBots);
      appState.portalBotCount = currBots;
      rebuildBotPersonaRows(currBots);
    }
  };

  const invitePillsSlot = el("div", { className: "invite-pill-row" });
  const refreshInvitePreviewPills = () => {
    const parsed = parseUsernameTokensClient(appState.portalInvitedUsernames || "");
    if (parsed.length === 0) {
      invitePillsSlot.replaceChildren(
        el("span", {
          style: { fontSize: "0.7rem", color: "var(--text-muted)" },
          text: "Enter one or more registered Night Merchant usernames above.",
        })
      );
      return;
    }
    invitePillsSlot.replaceChildren(
      ...parsed.map((uname) => el("span", { className: "invite-user-pill", text: `@${uname}` }))
    );
    ensureHumanSeatCapacity(parsed.length);
  };

  const invitedUsernamesInput = el("input", {
    className: "form-input",
    type: "text",
    placeholder: "e.g. marcus_aurelius, cornelia_severa",
    value: appState.portalInvitedUsernames || "",
    onInput: (e) => {
      appState.portalInvitedUsernames = e.target.value;
      refreshInvitePreviewPills();
    },
  });
  refreshInvitePreviewPills();

  const inviteUsernamesContainer = el(
    "div",
    {
      className: "invite-usernames-box",
      style: { display: appState.portalInviteMode === "invite_only" ? "block" : "none" },
    },
    el("label", {
      style: { display: "block", fontSize: "0.75rem", fontWeight: "700", marginBottom: "0.25rem", color: "var(--crimson)" },
      text: "Invited Player Username(s):",
    }),
    invitedUsernamesInput,
    invitePillsSlot,
    el("div", {
      style: { fontSize: "0.69rem", color: "var(--text-muted)", marginTop: "0.35rem", lineHeight: "1.3" },
      text: "An invitation email is sent to each invited player's email on file. Only invited players can claim empty seats, and joining closes once you start the game.",
    })
  );

  const openLobbyBtn = el("button", {
    className: "btn",
    text:
      appState.portalInviteMode === "invite_only"
        ? "✉️ Create Invite-Only Lobby & Email Invites"
        : "🌐 Open Multiplayer Lobby (Open Invitation)",
    onClick: () => createGame(false),
  });

  const openModeBtn = el(
    "button",
    {
      type: "button",
      className: `invite-mode-card ${appState.portalInviteMode === "open" ? "selected" : ""}`,
      onClick: () => {
        appState.portalInviteMode = "open";
        openModeBtn.classList.add("selected");
        inviteOnlyModeBtn.classList.remove("selected");
        inviteUsernamesContainer.style.display = "none";
        openLobbyBtn.textContent = "🌐 Open Multiplayer Lobby (Open Invitation)";
      },
    },
    el("span", { className: "invite-mode-card-title", text: "🌐 Open Invitation" }),
    el("span", {
      className: "invite-mode-card-sub",
      text: "Any logged-in player can claim an empty seat until you start.",
    })
  );

  const inviteOnlyModeBtn = el(
    "button",
    {
      type: "button",
      className: `invite-mode-card ${appState.portalInviteMode === "invite_only" ? "selected" : ""}`,
      onClick: () => {
        appState.portalInviteMode = "invite_only";
        inviteOnlyModeBtn.classList.add("selected");
        openModeBtn.classList.remove("selected");
        inviteUsernamesContainer.style.display = "block";
        openLobbyBtn.textContent = "✉️ Create Invite-Only Lobby & Email Invites";
        const parsed = parseUsernameTokensClient(appState.portalInvitedUsernames || "");
        ensureHumanSeatCapacity(Math.max(1, parsed.length));
      },
    },
    el("span", { className: "invite-mode-card-title", text: "🔒 Invite Only" }),
    el("span", {
      className: "invite-mode-card-sub",
      text: "Email specific username(s); only invited players can claim seats.",
    })
  );

  const createGame = async (startImmediately) => {
    try {
      if (!startImmediately) {
        const parsedGuests =
          appState.portalInviteMode === "invite_only"
            ? parseUsernameTokensClient(invitedUsernamesInput.value)
            : [];
        if (appState.portalInviteMode === "invite_only" && parsedGuests.length === 0) {
          showToast("Please enter at least one username to invite for an Invite-Only game.", true);
          invitedUsernamesInput.focus();
          return;
        }
        ensureHumanSeatCapacity(Math.max(1, parsedGuests.length));
      }
      const bCount = Math.max(0, Math.min(5, Number(botCountSelect.value) || 0));
      const modeToSend = startImmediately ? "open" : appState.portalInviteMode || "open";
      const res = await apiRequest("/api/games/create", "POST", {
        name: nameInput.value.trim(),
        maxPlayers: Number(maxPlayersSelect.value),
        botCount: bCount,
        botStrategies: appState.portalBotStrategies.slice(0, bCount),
        startImmediately,
        inviteMode: modeToSend,
        invitedUsernames: modeToSend === "invite_only" ? invitedUsernamesInput.value.trim() : "",
      });
      await refreshPortalOverview();
      if (startImmediately && res.state) {
        appState.currentGameId = res.summary.id;
        appState.gameSummary = res.summary;
        appState.gameState = res.state;
        stopNpcTurnPacing();
        enqueueNewNpcEvents(res.state, true);
        seedSeenScoutIds(res.state);
        appState.activeTab = "tabletop";
        showToast("Expedition launched! Select 2 Missions & 2 Influence cards to discard.");
      } else if (modeToSend === "invite_only") {
        appState.portalInvitedUsernames = "";
        invitedUsernamesInput.value = "";
        refreshInvitePreviewPills();
        const sentCnt = res.emailDispatch ? Number(res.emailDispatch.sentCount || 0) : 0;
        if (sentCnt > 0) {
          showToast(`Invite-Only lobby created! Sent ${sentCnt} invitation email${sentCnt === 1 ? "" : "s"}.`);
        } else {
          showToast("Invite-Only lobby created! Only your invited players can claim empty seats.");
        }
      } else {
        showToast("Open Invitation lobby created! Any logged-in player can claim an empty seat until you start.");
      }
      renderApp();
    } catch (err) {
      showToast(err.message, true);
    }
  };

  const createPanel = el(
    "div",
    { className: "panel" },
    el("h3", { className: "panel-title fresco-banner-header fresco-merchants", text: "⚓ Launch New Game / Lobby" }),
    el("div", { className: "form-group" }, el("label", { text: "Convivium / Table Name" }), nameInput),
    el("div", { className: "form-group" }, el("label", { text: "Maximum Players (2–6)" }), maxPlayersSelect),
    el("div", { className: "form-group" }, el("label", { text: "Initial AI Bot Opponents" }), botCountSelect),
    botStrategiesBox,
    el(
      "div",
      { className: "form-group", style: { marginTop: "0.75rem" } },
      el("label", { text: "Human Opponent Lobby Access" }),
      el("div", { className: "invite-mode-grid" }, openModeBtn, inviteOnlyModeBtn),
      inviteUsernamesContainer
    ),
    el(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: "0.55rem", marginTop: "1rem" } },
      openLobbyBtn,
      el("button", {
        className: "btn btn-primary",
        text: "⚔️ Start Match Immediately (Solo vs. AI Bots)",
        onClick: () => createGame(true),
      })
    ),
    el(
      "div",
      { style: { marginTop: "1.1rem", fontSize: "0.8rem", color: "var(--text-muted)", lineHeight: "1.4" } },
      el("strong", { style: { color: "var(--gold-bright)" }, text: "211 A.D. Overview: " }),
      "Each game spans 3 Seasons (Spring, Summer, Fall) plus the December 211 Purge. Buy Goods & Guards at Portus Ostiae, enter Rome at dusk to navigate 36 nocturnal neighborhoods, fulfill Missions, court 5 Severan Factions, and exit before Sunrise!"
    )
  );

  const gamesList = el(
    "div",
    { className: "panel" },
    el(
      "h3",
      { className: "panel-title fresco-banner-header fresco-cart" },
      el("span", { text: "🗺️ Active Games & Open Lobbies" }),
      el("button", {
        className: "btn btn-sm",
        text: "↻ Refresh",
        onClick: async () => {
          await refreshPortalOverview();
          renderApp();
        },
      })
    ),
    el("div", { id: "portal-games-list-slot" }, ...buildPortalGamesListNodes())
  );

  const leaderboardPanel = el(
    "div",
    { className: "panel" },
    el("h3", { className: "panel-title fresco-banner-header fresco-griffin", text: "🏆 Imperial Merchant Leaderboard" }),
    el("div", {
      style: { fontSize: "0.74rem", color: "var(--text-muted)", marginBottom: "0.55rem" },
      text: "Multiplayer standings across completed games with 2+ human merchants.",
    }),
    el(
      "div",
      { id: "portal-leaderboard-slot", className: "item-list" },
      ...buildPortalLeaderboardNodes()
    )
  );

  return el(
    "div",
    { className: "portal-container" },
    el("div", { className: "portal-grid" }, createPanel, gamesList, leaderboardPanel)
  );
}

function openTerminateGameModal(g) {
  let isDeleting = false;
  const confirmBtn = el("button", {
    type: "button",
    className: "btn btn-crimson",
    text: "🗑️ Confirm Terminate Game",
    onClick: async () => {
      if (isDeleting) return;
      isDeleting = true;
      confirmBtn.disabled = true;
      try {
        const res = await apiRequest(`/api/games/${g.id}/terminate`, "POST", {});
        closeModal();
        if (appState.currentGameId === g.id) {
          appState.currentGameId = null;
          appState.gameSummary = null;
          appState.gameState = null;
          stopNpcTurnPacing();
          if (appState.activeTab === "tabletop") {
            appState.activeTab = "portal";
          }
        }
        await refreshPortalOverview();
        showToast(res.message || `Terminated '${g.name}'.`);
        renderApp();
      } catch (err) {
        isDeleting = false;
        confirmBtn.disabled = false;
        showToast(err.message, true);
      }
    },
  });

  showModal(
    `🗑️ Terminate Game — ${g.name}?`,
    el(
      "div",
      {},
      el("p", {
        style: { fontSize: "0.9rem", color: "var(--text-main)", marginTop: "0" },
        text: `Are you sure you want to permanently terminate "${g.name}"? This will immediately end and remove the game for all seated players.`,
      }),
      el(
        "div",
        {
          style: {
            padding: "0.55rem 0.75rem",
            borderRadius: "4px",
            background: "#fef2f2",
            border: "1.5px solid #dc2626",
            fontSize: "0.82rem",
            color: "#7f1d1d",
            marginBottom: "0.9rem",
            boxShadow: "var(--bevel-sunken)",
          },
        },
        `Status: ${g.status === "lobby" ? "Lobby" : `${g.season} • ${g.phase} • Turn ${g.turn}`} • Seated Merchants: ${(g.seats || [])
          .map((s) => s.name)
          .join(", ") || "None"}`
      ),
      el(
        "div",
        { style: { display: "flex", gap: "0.6rem", justifyContent: "flex-end" } },
        el("button", { type: "button", className: "btn", text: "Keep Game", onClick: closeModal }),
        confirmBtn
      )
    )
  );
}

function renderLobbyItem(g) {
  const isHost = g.hostUserId === appState.user.id;
  const isAdmin = Boolean(appState.user && appState.user.isAdmin);
  const canTerminate = isHost || isAdmin;
  const isSeated = (g.seats || []).some((s) => s.userId === appState.user.id);
  const isLobby = g.status === "lobby";
  const inviteMode = g.inviteMode === "invite_only" ? "invite_only" : "open";
  const canJoinSeat = Boolean(g.canViewerJoin !== undefined ? g.canViewerJoin : inviteMode === "open");
  const personas = getBotPersonasCatalog();

  const seatNodes = (g.seats || []).map((s) =>
    el(
      "span",
      { className: "seat-pill" },
      renderCartIconNode(s.color, "", `${s.name}'s Cart`),
      isLobby && isHost && s.isBot
        ? el(
            "select",
            {
              className: "form-input",
              style: { padding: "0.1rem 0.35rem", fontSize: "0.74rem", width: "auto" },
              title: "Change AI Bot Persona",
              onChange: async (e) => {
                try {
                  await apiRequest(`/api/games/${g.id}/update-bot`, "POST", {
                    seatIndex: s.seatIndex,
                    strategy: e.target.value,
                  });
                  await refreshPortalOverview();
                  renderApp();
                } catch (err) {
                  showToast(err.message, true);
                }
              },
            },
            ...personas.map((p) =>
              el("option", {
                value: p.strategy,
                selected: p.strategy === s.botStrategy,
                text: `${p.name} [${p.strategy}]`,
              })
            )
          )
        : el("span", { text: `${s.name}${s.isBot ? ` [AI: ${s.botStrategy}]` : ""}` }),
      isLobby && isHost && s.seatIndex > 0
        ? el("button", {
            className: "btn btn-sm",
            style: { padding: "0.05rem 0.35rem", marginLeft: "0.2rem" },
            text: "✕",
            onClick: async () => {
              try {
                await apiRequest(`/api/games/${g.id}/remove-seat`, "POST", { seatIndex: s.seatIndex });
                await refreshPortalOverview();
                renderApp();
              } catch (err) {
                showToast(err.message, true);
              }
            },
          })
        : null
    )
  );

  let inviteListRow = null;
  if (inviteMode === "invite_only" && Array.isArray(g.invites) && g.invites.length > 0) {
    inviteListRow = el(
      "div",
      { className: "invite-pill-row", style: { marginTop: "0.4rem" } },
      el("span", {
        style: { fontSize: "0.72rem", fontWeight: "700", color: "var(--text-muted)" },
        text: "Invited:",
      }),
      ...g.invites.map((inv) =>
        el("span", {
          className: `invite-user-pill ${inv.seated ? "seated" : ""}`,
          title: inv.displayName || inv.username,
          text: inv.seated ? `@${inv.username} ✓` : `@${inv.username}`,
        })
      )
    );
  }

  let hostExtraInviteRow = null;
  if (isLobby && isHost && inviteMode === "invite_only" && (g.seats || []).length < g.maxPlayers) {
    const extraInput = el("input", {
      className: "form-input",
      type: "text",
      placeholder: "Invite @username...",
      style: { padding: "0.2rem 0.45rem", fontSize: "0.75rem", width: "160px" },
    });
    const sendExtraInvite = async () => {
      const val = extraInput.value.trim();
      if (!val) return;
      try {
        const res = await apiRequest(`/api/games/${g.id}/invite`, "POST", { usernames: val });
        extraInput.value = "";
        await refreshPortalOverview();
        const sentCnt = res.emailDispatch ? Number(res.emailDispatch.sentCount || 0) : 0;
        showToast(sentCnt > 0 ? `${res.message} (Email invite sent!)` : res.message || "Invite added.");
        renderApp();
      } catch (err) {
        showToast(err.message, true);
      }
    };
    extraInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        sendExtraInvite();
      }
    });
    hostExtraInviteRow = el(
      "div",
      { style: { display: "flex", gap: "0.35rem", alignItems: "center", marginTop: "0.4rem" } },
      extraInput,
      el("button", {
        type: "button",
        className: "btn btn-sm",
        text: "✉️ Send Invite",
        onClick: sendExtraInvite,
      })
    );
  }

  const actionBtns = [];
  if (isLobby) {
    if (!isSeated && (g.seats || []).length < g.maxPlayers) {
      if (canJoinSeat) {
        actionBtns.push(
          el("button", {
            className: "btn btn-sm btn-primary",
            text: inviteMode === "invite_only" ? "✉️ Claim Invited Seat" : "Join Seat",
            onClick: async () => {
              try {
                await apiRequest(`/api/games/${g.id}/join`, "POST", {});
                if (appState.highlightedLobbyId === g.id) {
                  appState.highlightedLobbyId = null;
                }
                await refreshPortalOverview();
                showToast("Claimed your merchant seat in the lobby!");
                renderApp();
              } catch (err) {
                showToast(err.message, true);
              }
            },
          })
        );
      } else {
        actionBtns.push(
          el("span", {
            style: { fontSize: "0.74rem", fontWeight: "700", color: "var(--text-muted)" },
            text: "🔒 Invite-Only (Invited Players Only)",
          })
        );
      }
    }
    if (isHost && (g.seats || []).length < g.maxPlayers) {
      const defaultAddPersona = personas[(g.seats || []).length % personas.length];
      const addBotStratSelect = el(
        "select",
        {
          className: "form-input",
          style: { padding: "0.2rem 0.45rem", fontSize: "0.75rem", width: "auto" },
          title: "Select AI Bot Persona to Add",
        },
        ...personas.map((p) =>
          el("option", {
            value: p.strategy,
            selected: p.strategy === defaultAddPersona.strategy,
            text: `${p.name} (${p.strategy})`,
          })
        )
      );
      actionBtns.push(
        addBotStratSelect,
        el("button", {
          className: "btn btn-sm",
          text: "+ Add AI Bot",
          onClick: async () => {
            try {
              await apiRequest(`/api/games/${g.id}/add-bot`, "POST", {
                strategy: addBotStratSelect.value,
                personaIndex: (g.seats || []).length,
              });
              await refreshPortalOverview();
              renderApp();
            } catch (err) {
              showToast(err.message, true);
            }
          },
        })
      );
    }
    if (isHost && (g.seats || []).length >= 2) {
      actionBtns.push(
        el("button", {
          className: "btn btn-sm btn-crimson",
          text: "Start Game ⚔️",
          onClick: async () => {
            try {
              const res = await apiRequest(`/api/games/${g.id}/start`, "POST", {});
              appState.currentGameId = g.id;
              appState.gameSummary = res.summary;
              appState.gameState = res.state;
              stopNpcTurnPacing();
              enqueueNewNpcEvents(res.state, true);
              seedSeenScoutIds(res.state);
              syncGameUiTransitions(res.state, true);
              appState.activeTab = "tabletop";
              renderApp();
            } catch (err) {
              showToast(err.message, true);
            }
          },
        })
      );
    }
  } else {
    actionBtns.push(
      el("button", {
        className: "btn btn-sm btn-primary",
        text: g.status === "finished" ? "View Final Scoreboard" : "Enter Tabletop ⚔️",
        onClick: () => openGame(g.id),
      })
    );
  }

  if (canTerminate) {
    actionBtns.push(
      el("button", {
        className: "btn btn-sm",
        style: {
          borderColor: "#dc2626",
          color: "#991b1b",
          marginLeft: "auto",
        },
        title: isAdmin && !isHost ? "Terminate Game (Admin)" : "Terminate Game (Creator)",
        text: "🗑️ Terminate Game",
        onClick: () => openTerminateGameModal(g),
      })
    );
  }

  let accessBadge = null;
  if (isLobby) {
    if (inviteMode === "invite_only") {
      if (g.viewerIsInvited && !isHost && !isSeated) {
        accessBadge = el("span", { className: "invite-access-badge invited-me", text: "✉️ You're Invited!" });
      } else {
        accessBadge = el("span", { className: "invite-access-badge invite-only", text: "🔒 Invite Only" });
      }
    } else {
      accessBadge = el("span", { className: "invite-access-badge open", text: "🌐 Open Invitation" });
    }
  }

  return el(
    "div",
    {
      id: `lobby-card-${g.id}`,
      className: `lobby-card ${appState.highlightedLobbyId === g.id ? "lobby-highlighted" : ""}`,
    },
    el(
      "div",
      { className: "lobby-header" },
      el(
        "div",
        { style: { display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap" } },
        el("strong", { style: { fontSize: "1rem", color: "var(--gold-bright)" }, text: g.name }),
        accessBadge
      ),
      el("span", {
        className: "badge",
        text:
          g.status === "lobby"
            ? `Lobby (${(g.seats || []).length}/${g.maxPlayers})`
            : g.status === "finished"
            ? `Finished — Winner: ${g.winnerName || "N/A"}`
            : `${g.season} • ${g.phase} • Turn ${g.turn}`,
      })
    ),
    el("div", { className: "seat-pills" }, ...seatNodes),
    inviteListRow,
    hostExtraInviteRow,
    el("div", { style: { display: "flex", gap: "0.5rem", marginTop: "0.5rem", flexWrap: "wrap", alignItems: "center" } }, ...actionBtns)
  );
}

/* =========================================================================
   INTERACTIVE TABLETOP VIEW
   ========================================================================= */

function renderPendingUndoBanner(gs) {
  const pend = gs.pendingUndoRequest;
  if (!pend) return null;
  const myUid = appState.user ? appState.user.id : null;
  const reqUids = Array.isArray(pend.requiredUserIds) ? pend.requiredUserIds : [];
  const reqNames = Array.isArray(pend.requiredNames) ? pend.requiredNames : [];
  const autoNames = Array.isArray(pend.autoApprovedNames) ? pend.autoApprovedNames : [];
  const needsMyApproval = myUid !== null && reqUids.includes(myUid);
  const isRequester = myUid !== null && pend.requesterUserId === myUid;
  const whichTurnText =
    pend.targetType === "current_turn" ? "beginning of the current turn" : "beginning of the previous turn";

  return el(
    "div",
    {
      className: "panel",
      style: {
        borderColor: "#d97706",
        background: "#fffbeb",
        marginBottom: "0.75rem",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "0.75rem",
      },
    },
    el(
      "div",
      {},
      el("div", {
        style: { fontWeight: "800", color: "#78350f", fontSize: "0.95rem", marginBottom: "0.2rem" },
        text: `↩️ Undo Turn Requested by ${pend.requesterName}`,
      }),
      el("div", {
        style: { fontSize: "0.84rem", color: "var(--text-main)" },
        text: `Target: Revert to the ${whichTurnText} (${pend.targetLabel || "Start of Turn"}).`,
      }),
      el("div", {
        style: { fontSize: "0.78rem", color: "#92400e", marginTop: "0.2rem", fontWeight: "600" },
        text: `Awaiting approval from: ${reqNames.join(", ") || "Other players"}${
          autoNames.length > 0 ? ` • Auto-approved by profile setting: ${autoNames.join(", ")}` : ""
        }`,
      })
    ),
    el(
      "div",
      { style: { display: "flex", gap: "0.5rem", flexWrap: "wrap" } },
      needsMyApproval
        ? el("button", {
            className: "btn btn-sm btn-primary",
            text: "✓ Approve Undo",
            onClick: () => sendGameAction({ type: "respond_undo_turn", decision: "approve" }),
          })
        : null,
      needsMyApproval
        ? el("button", {
            className: "btn btn-sm btn-crimson",
            text: "✕ Decline Undo",
            onClick: () => sendGameAction({ type: "respond_undo_turn", decision: "reject" }),
          })
        : null,
      isRequester
        ? el("button", {
            className: "btn btn-sm",
            text: "✕ Cancel Undo Request",
            onClick: () => sendGameAction({ type: "cancel_undo_turn" }),
          })
        : null
    )
  );
}

function renderTabletopView() {
  const gs = appState.gameState;
  if (!gs) {
    return el("div", { className: "portal-container" }, el("p", { text: "Loading game state..." }));
  }

  const viewer = gs.players[gs.viewerPlayerIndex] || gs.players[0];
  const activePlayer = gs.players[gs.activePlayerIndex] || gs.players[0];

  // Determine which board(s) to display
  let effectiveView = appState.boardViewMode;
  if (effectiveView === "auto") {
    if (appState.activeNpcEvent && appState.activeNpcEvent.phase === "market") {
      effectiveView = "market";
    } else if (
      appState.activeNpcEvent &&
      (appState.activeNpcEvent.phase === "delivery" || appState.activeNpcEvent.phase === "delivery_entry")
    ) {
      effectiveView = "rome";
    } else {
      effectiveView =
        gs.phase === "setup_climate"
          ? "climate"
          : gs.phase === "market"
          ? "market"
          : "rome";
    }
  }

  const mainBoards = [];
  if (gs.phase === "setup_discard") {
    if (!viewer.setupDiscarded) {
      mainBoards.push(renderSetupDiscardPanel(viewer));
    } else {
      const pendingPlayers = (gs.players || []).filter((p) => !p.setupDiscarded).map((p) => p.name);
      mainBoards.push(
        el(
          "div",
          { className: "panel", style: { borderColor: "var(--gold-bright)" } },
          el("h3", { className: "panel-title", text: "⏳ Starting Hand Confirmed — Awaiting Rival Merchants" }),
          el("p", {
            style: { fontSize: "0.86rem", color: "var(--text-muted)", margin: "0" },
            text:
              pendingPlayers.length > 0
                ? `Waiting for ${pendingPlayers.join(", ")} to finish discarding 2 Missions & 2 Influence cards before the Political Climate Draft begins.`
                : "Entering Political Climate Draft...",
          })
        )
      );
    }
  }
  if (gs.pendingEncounter) {
    mainBoards.push(renderPendingEncounterPanel(gs, viewer));
  }
  if ((viewer.pendingCartOverflow || []).length > 0) {
    mainBoards.push(renderPendingCartOverflowPanel(gs, viewer));
  }
  if ((viewer.pendingMarketReward || []).length > 0) {
    mainBoards.push(renderPendingMarketRewardPanel(gs, viewer));
  }
  if (viewer.pendingNpcOffer) {
    mainBoards.push(renderPendingNpcOfferPanel(gs, viewer));
  }
  if (gs.phase === "cleanup" && !viewer.cleanupDone) {
    mainBoards.push(renderCleanupPhasePanel(gs, viewer));
  }

  if (effectiveView === "climate" || effectiveView === "both") {
    mainBoards.push(renderPoliticalClimateBoard(gs, viewer));
  }
  if (effectiveView === "market" || effectiveView === "both") {
    mainBoards.push(renderOstiaMarketBoard(gs, viewer));
  }
  if (effectiveView === "rome" || effectiveView === "both") {
    mainBoards.push(renderRomeNightBoard(gs, viewer));
  }

  return el(
    "div",
    { className: "tabletop-wrapper" },
    renderClockAndTurnBanner(gs, viewer, activePlayer),
    renderNpcPacingBanner(),
    renderPendingUndoBanner(gs),
    renderContextualPromptBanner(gs, viewer, activePlayer),
    renderActiveClimateStrip(gs, viewer),
    el(
      "div",
      { className: "tabletop-main" },
      el("div", { style: { display: "flex", flexDirection: "column", gap: "1rem" } }, ...mainBoards),
      renderPlayerSidebar(gs, viewer)
    )
  );
}

function renderClockAndTurnBanner(gs, viewer, activePlayer) {
  const firstPlayer = gs.players[gs.firstPlayerIndex] || gs.players[0];
  const phaseNames = {
    setup_discard: "Preparation: Select Starting Contracts",
    setup_climate: "Preparation: Political Climate Draft",
    market: "Phase I: Ostia Port Market",
    delivery_entry: "Phase II: Dusk Gate Entry & Initial Scout",
    delivery: "Phase II: Rome Night Delivery",
    cleanup: "Phase III: Dawn Clean-Up & Upkeep",
    finished: "December 211 A.D. — Winter Reckoning Complete",
  };
  const activeClimateCount =
    gs.politicalClimate && Array.isArray(gs.politicalClimate.activeIds) ? gs.politicalClimate.activeIds.length : 0;

  const canUndo = Boolean(gs.canUndoTurn);
  const undoPending = Boolean(gs.pendingUndoRequest);
  const undoTooltip = undoPending
    ? "An Undo Turn request is currently awaiting approval."
    : !canUndo
    ? "Nothing to undo yet — game is at the beginning of the initial turn."
    : gs.undoTargetType === "current_turn"
    ? `Revert to the beginning of the current turn (${gs.undoTargetLabel || ""})`
    : `No actions taken yet this turn — revert to the beginning of the previous turn (${gs.undoTargetLabel || ""})`;

  return el(
    "div",
    { className: "clock-banner" },
    el(
      "div",
      { className: "clock-badges" },
      el("span", { className: "badge badge-season", text: `🏛️ Season: ${gs.season} 211 A.D.` }),
      el("span", { className: "badge badge-phase", text: phaseNames[gs.phase] || gs.phase }),
      gs.phase === "delivery" ? el("span", { className: "badge badge-hour", text: `🕰️ ${gs.turnHourLabel}` }) : null,
      el("span", { className: "badge", text: `🦅 1st Player: ${firstPlayer.name}` }),
      el("span", {
        className: "badge",
        style: { borderColor: "#16a34a", color: "#14532d", background: "#ecfdf5" },
        text: `▶ Active Turn: ${activePlayer.name}`,
      })
    ),
    el(
      "div",
      { style: { display: "flex", gap: "0.4rem", flexWrap: "wrap" } },
      el("button", {
        className: "btn btn-sm",
        style: canUndo ? { borderColor: "#8c5612", color: "#6e2119" } : {},
        disabled: !canUndo || undoPending,
        title: undoTooltip,
        text: undoPending
          ? "⏳ Undo Pending..."
          : canUndo && gs.undoTargetType === "previous_turn"
          ? "↩️ Undo Turn (Prev)"
          : "↩️ Undo Turn",
        onClick: () => sendGameAction({ type: "request_undo_turn" }),
      }),
      ...["auto", "rome", "market", "climate", "both"].map((mode) =>
        el("button", {
          className: `btn btn-sm ${appState.boardViewMode === mode ? "btn-primary" : ""}`,
          title:
            mode === "climate"
              ? "Switch to the 6×3 Roman Senate Political Climate Board"
              : undefined,
          text:
            mode === "auto"
              ? "Auto View"
              : mode === "rome"
              ? "🗺️ Rome 211 A.D. Board"
              : mode === "market"
              ? "⚓ Ostia Port Market"
              : mode === "climate"
              ? `🏛️ Political Climate (${activeClimateCount})`
              : "All Boards",
          onClick: () => {
            appState.boardViewMode = mode;
            renderApp();
          },
        })
      )
    )
  );
}

function renderContextualPromptBanner(gs, viewer, activePlayer) {
  let promptText = "";
  const extraActions = [];

  if (gs.phase === "setup_discard") {
    promptText =
      "Setup: Discard 2 Starting Missions and 2 Influence cards below. First to confirm drafts Political Climate first and acts last in turn order.";
  } else if (gs.phase === "setup_climate") {
    const pc = gs.politicalClimate || {};
    const stepNum = Math.min((Number(pc.draftStep) || 0) + 1, Math.max(1, (pc.draftOrder || []).length));
    const totalPicks = (pc.draftOrder || []).length || gs.players.length;
    promptText = `Political Climate Draft — Pick ${stepNum} of ${totalPicks} (${activePlayer.name}): Click a decree in an open column below to enact it.`;
  } else if (gs.phase === "market") {
    promptText = `Ostia Market — ${activePlayer.name}'s turn: Buy 1 Good or Guard, Source a Good, or Pass (${gs.marketConsecutivePasses}/${gs.players.length} passed).`;
    if (gs.activePlayerIndex === viewer.index) {
      extraActions.push(
        el("button", {
          className: "btn btn-sm",
          text: "📦 Source Good (Discard 1 Influence)",
          disabled: viewer.influence.length === 0,
          onClick: () => openMarketSourceModal(gs, viewer),
        }),
        el("button", {
          className: "btn btn-sm btn-crimson",
          text: "Pass Market Turn ⏭️",
          onClick: () => sendGameAction({ type: "market_pass" }),
        })
      );
    }
  } else if (gs.phase === "delivery_entry") {
    promptText =
      "⛩️ Start of Night Delivery (8:00 P.M.): You must start at one of the six Via entrances highlighted in gold on the map (A4, B1, B6, E1, F3, or F6). You may optionally Scout 1 neighborhood stack or deck card first.";
    if (gs.activePlayerIndex === viewer.index) {
      extraActions.push(
        el("button", {
          type: "button",
          className: "btn btn-sm",
          title: "Scout a neighborhood tile or card deck before selecting your Via entrance",
          text: "👁️ Scout",
          disabled: viewer.scoutedThisTurn,
          onClick: () => openScoutModal(gs, viewer),
        })
      );
    }
  } else if (gs.phase === "delivery") {
    const fineBase = gs.season === "Spring" ? 12 : gs.season === "Summer" ? 20 : 32;
    const fineGate = Math.floor(fineBase / 2);
    if (gs.turn === 1 && viewer.movesRemaining === 0) {
      promptText = `Turn 1 (8:00 P.M.) at ${viewer.position || "Gate"}: ${
        viewer.transactedThisTurn ? "Transacted ✓" : "1 Transaction available"
      } • Scout (ends turn) or End Turn.`;
    } else {
      promptText = `Night Delivery (${gs.turnHourLabel}): ${viewer.movesRemaining} move left • ${
        viewer.transactedThisTurn ? "Transacted ✓" : "1 Transaction available"
      }. Exit before Turn 10 ends (${fineBase}d Curfew Fine; ${fineGate}d on a Gate).`;
    }
    if (gs.activePlayerIndex === viewer.index) {
      if (viewer.canReturnShortcut) {
        extraActions.push(
          el("button", {
            type: "button",
            className: "btn btn-sm",
            title: "Return unused Shortcut card to your hand (also returns automatically if you end your turn without crossing a blocked route)",
            text: "↩️ Return Shortcut",
            onClick: () => sendGameAction({ type: "return_shortcut" }),
          })
        );
      }
      const currCell = viewer.position && gs.romeBoard ? gs.romeBoard[viewer.position] : null;
      const currRev = currCell ? currCell.revealed : null;
      if (currCell && currCell.isForum && currRev && Array.isArray(currRev.buys) && currRev.buys.length > 0) {
        const bSpec = currRev.buys[0];
        extraActions.push(
          el("button", {
            type: "button",
            className: "btn btn-sm btn-primary",
            text: `🏛️ Forum Buy (${bSpec.category})`,
            onClick: () => navigateToMarketBoardForCategory(bSpec.category),
          })
        );
      }
      if (currRev && currRev.gamble) {
        const alreadyGambled = Boolean(viewer.gambledThisTurn);
        extraActions.push(
          el("button", {
            type: "button",
            className: "btn btn-sm",
            disabled: alreadyGambled || viewer.transactedThisTurn || viewer.cash <= 0,
            text: alreadyGambled ? "🎲 Gambled ✓" : "🎲 Stadium Gambling",
            onClick: () => openGambleModal(viewer),
          })
        );
      }
      extraActions.push(
        el("button", {
          type: "button",
          className: "btn btn-sm",
          title: "Scout a neighborhood tile or card deck at the end of your turn",
          text: "👁️ Scout",
          disabled: viewer.scoutedThisTurn,
          onClick: () => openScoutModal(gs, viewer),
        }),
        el("button", {
          type: "button",
          className: "btn btn-sm",
          text: "🗑️ Trash Top Tile/Card",
          disabled: viewer.trashedThisTurn || viewer.influence.length === 0,
          onClick: () => openTrashModal(gs, viewer),
        }),
        el("button", {
          type: "button",
          className: "btn btn-sm btn-crimson",
          title: "End your hourly turn",
          text: "End Turn ⏭️",
          onClick: () => sendGameAction({ type: "delivery_end_turn" }),
        })
      );
    }
  } else if (gs.phase === "cleanup") {
    promptText = `Dawn Clean-Up (${gs.season}): Buy Influence (${viewer.influenceBuyCost}d), manage Loans, and pay Guard upkeep.`;
  } else if (gs.phase === "finished") {
    promptText = `Victory in Rome! ${gs.winner} wins as the wealthiest Night Merchant!`;
    extraActions.push(
      el("button", {
        type: "button",
        className: "btn btn-sm btn-primary",
        text: "🏆 Final Rankings & Winter Reckoning",
        onClick: () => {
          const standings =
            Array.isArray(gs.finalStandings) && gs.finalStandings.length > 0
              ? gs.finalStandings
              : buildFallbackFinalStandings(gs);
          openFinalScoringModal(standings, {
            gameName: appState.gameSummary ? appState.gameSummary.name : "Roman Expedition",
            winnerName: gs.winner,
            season: gs.season,
          });
        },
      })
    );
  }

  return el("div", { className: "prompt-banner" }, el("span", { text: promptText }), el("div", { style: { display: "flex", gap: "0.45rem", flexWrap: "wrap" } }, ...extraActions));
}

function renderActiveClimateStrip(gs, viewer) {
  const pc = gs && gs.politicalClimate;
  if (!pc || !Array.isArray(pc.activeIds) || pc.activeIds.length === 0 || gs.phase === "setup_climate") {
    return null;
  }
  const allOptions =
    Array.isArray(pc.options) && pc.options.length > 0 ? pc.options : DEFAULT_POLITICAL_CLIMATE_OPTIONS;
  const activeOpts = pc.activeIds
    .map((id) => allOptions.find((o) => o.id === id))
    .filter(Boolean);
  if (activeOpts.length === 0) return null;

  return el(
    "div",
    { className: "active-climate-strip" },
    el("span", { className: "active-climate-strip-label", text: "🏛️ Enacted Decree:" }),
    el(
      "div",
      { className: "active-climate-pills" },
      ...activeOpts.map((opt) => {
        const fm = FACTION_META.find((f) => f.key === opt.factor);
        const isMid = opt.timing === "midgame";
        return el(
          "button",
          {
            type: "button",
            className: `active-climate-pill ${isMid ? "is-midgame" : "is-endgame"}`,
            style: fm ? { borderColor: fm.color } : {},
            title: `${opt.factorLabel || opt.factor} — ${opt.title}: ${opt.description}`,
            onClick: () => {
              appState.boardViewMode = appState.boardViewMode === "climate" ? "auto" : "climate";
              renderApp();
            },
          },
          fm
            ? el("img", { src: fm.gem, alt: opt.factor, className: "climate-pill-gem" })
            : el("span", { text: "📜" }),
          el("strong", { text: `${opt.factorLabel || opt.factor}:` }),
          el("span", { text: opt.shortText || opt.title })
        );
      })
    )
  );
}

function buildPoliticalClimateExplainerNode(_gs) {
  return el(
    "div",
    { className: "climate-explainer-panel" },
    el(
      "div",
      { className: "climate-explainer-title" },
      "📜 How the Political Climate Board Works"
    ),
    el(
      "p",
      { className: "climate-explainer-text" },
      "When you’re done selecting the influence and mission cards you’d like to keep, place your Senator pawn on one of the Decree squares of the Political Climate table. Only one Senator can be placed in each column."
    ),
    el(
      "p",
      { className: "climate-explainer-text" },
      "The decrees on the Political Climate table set rules that will grant bonuses for mission completion or faction alignment at the end of the game (rows 1 & 2) or change the gameplay (row 3)."
    ),
    el(
      "p",
      { className: "climate-explainer-text" },
      "Row 1 rules reward or penalize players based on superlatives (most missions completed, most/least favor with a given faction). Note that ties are decided by combat between the players."
    ),
    el(
      "p",
      { className: "climate-explainer-text" },
      "Row 2 rules reward or penalize players for each unit of faction loyalty/mission completion being measured."
    ),
    el(
      "p",
      { className: "climate-explainer-text" },
      "Row 3 rules change the in-game faction loyalty or mission completion mechanics."
    ),
    el(
      "p",
      { className: "climate-explainer-text" },
      "The last player to place a Senator receives the First Player Token."
    ),
    el(
      "p",
      { className: "climate-explainer-text" },
      "In a two player game, the second player to place a Senator places two Senators and then the first player places a second Senator (for a total of four)."
    )
  );
}

function buildPoliticalClimateBoardGridNode(gs, viewer, interactiveDraft = false) {
  const pc = (gs && gs.politicalClimate) || {};
  const rawFactors =
    Array.isArray(pc.factors) && pc.factors.length > 0 ? pc.factors : DEFAULT_POLITICAL_CLIMATE_FACTORS;
  const options =
    Array.isArray(pc.options) && pc.options.length > 0 ? pc.options : DEFAULT_POLITICAL_CLIMATE_OPTIONS;
  const activeIds = new Set(Array.isArray(pc.activeIds) ? pc.activeIds : []);
  const activeByFactor = pc.activeByFactor || {};
  const canPickNow =
    Boolean(interactiveDraft) &&
    gs &&
    gs.phase === "setup_climate" &&
    viewer &&
    gs.activePlayerIndex === viewer.index;

  const colColumns = rawFactors.slice(0, 6).map((fac) => {
    const fKey = fac.id || fac.key || "";
    const fm = FACTION_META.find((f) => f.key === fKey);
    const colColor = fm ? fm.color : "#b45309";
    const colOpts = options
      .filter((o) => o.factor === fKey)
      .sort((a, b) => (Number(a.optionNumber) || 0) - (Number(b.optionNumber) || 0));
    const lockedOptId = activeByFactor[fKey] || null;
    return {
      fac,
      fKey,
      fm,
      colColor,
      colOpts,
      lockedOptId,
      headingText: fac.label || fKey,
    };
  });

  const colHeaderNodes = colColumns.map((col) =>
    el(
      "div",
      {
        className: `senate-col-header-box ${col.lockedOptId ? "has-active-option" : ""}`,
        style: { "--senate-col-accent": col.colColor },
      },
      col.fm
        ? el("img", { src: col.fm.gem, alt: col.headingText, className: "climate-factor-gem" })
        : el("span", { className: "climate-factor-scroll", text: "📜" }),
      el("span", { className: "climate-factor-title", text: col.headingText })
    )
  );

  // Strict 6-column x 3-row matrix (each selectable tile is itself the Enact button)
  const matrixCellNodes = [];
  for (let rowIdx = 0; rowIdx < 3; rowIdx++) {
    for (const col of colColumns) {
      const opt = col.colOpts[rowIdx];
      if (!opt) {
        matrixCellNodes.push(el("div", { className: "climate-option-card is-locked" }));
        continue;
      }
      const isSelected = activeIds.has(opt.id);
      const isLockedOut = Boolean(col.lockedOptId && !isSelected);
      const isSelectable = Boolean(canPickNow && !col.lockedOptId);
      const enactOption = () => sendGameAction({ type: "select_climate_option", optionId: opt.id });

      matrixCellNodes.push(
        el(
          "div",
          {
            className: `climate-option-card ${isSelected ? "is-active" : ""} ${isLockedOut ? "is-locked" : ""} ${
              isSelectable ? "is-selectable" : ""
            }`,
            style: { "--senate-col-accent": col.colColor },
            role: isSelectable ? "button" : undefined,
            tabIndex: isSelectable ? "0" : undefined,
            title: isSelectable ? `Enact ${opt.title}` : undefined,
            onClick: isSelectable ? enactOption : undefined,
            onKeyDown: isSelectable
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    enactOption();
                  }
                }
              : undefined,
          },
          el("div", { className: "climate-option-title", text: opt.title }),
          el("div", { className: "climate-option-desc", text: opt.description }),
          isSelected
            ? el("div", {
                className: "climate-option-status active",
                text: "✓ Enacted",
              })
            : isLockedOut
            ? el("div", { className: "climate-option-status locked", text: "Locked" })
            : null
        )
      );
    }
  }

  return el(
    "div",
    {
      className: "senate-climate-board-matrix",
      onScroll: (e) => {
        appState.climateBoardScrollLeft = e.currentTarget.scrollLeft;
      },
    },
    el(
      "div",
      { className: "senate-climate-stage" },
      el("div", { className: "senate-col-headers" }, ...colHeaderNodes),
      el("div", { className: "senate-climate-grid" }, ...matrixCellNodes)
    )
  );
}

function renderPoliticalClimateBoard(gs, viewer) {
  const pc = (gs && gs.politicalClimate) || {};
  const isDraftPhase = gs.phase === "setup_climate";
  const activeCount = Array.isArray(pc.activeIds) ? pc.activeIds.length : 0;
  const draftOrder = Array.isArray(pc.draftOrder) ? pc.draftOrder : [];
  const draftStep = Number(pc.draftStep) || 0;
  const isMyPick = isDraftPhase && gs.activePlayerIndex === viewer.index;

  return el(
    "div",
    { className: "senate-climate-board" },
    el(
      "div",
      { className: "panel-title fresco-banner-header fresco-griffin", style: { flexWrap: "wrap", gap: "0.5rem" } },
      el("span", { text: "🏛️ Curia Julia — Political Climate Board" }),
      el(
        "div",
        { style: { display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap" } },
        isDraftPhase
          ? el("span", {
              className: "badge",
              style: isMyPick
                ? { borderColor: "#16a34a", color: "#14532d", background: "#ecfdf5" }
                : { borderColor: "#d97706", color: "#78350f", background: "#fffbeb" },
              text: isMyPick ? "▶ Your Pick" : `Waiting on ${(gs.players[gs.activePlayerIndex] || {}).name || "Merchant"}`,
            })
          : el("span", {
              className: "badge",
              style: { borderColor: "#deb86c", color: "#fde6b0", background: "rgba(32, 14, 8, 0.72)" },
              text: `${activeCount} Enacted`,
            }),
        !isDraftPhase && appState.boardViewMode === "climate"
          ? el("button", {
              type: "button",
              className: "btn btn-sm",
              text: "↩️ Return to Active Board",
              onClick: () => {
                appState.boardViewMode = "auto";
                renderApp();
              },
            })
          : null
      )
    ),
    buildPoliticalClimateExplainerNode(gs),
    isDraftPhase && draftOrder.length > 0
      ? el(
          "div",
          { className: "climate-draft-order-bar" },
          el("span", { className: "climate-draft-order-lbl", text: "Draft Order:" }),
          ...draftOrder.map((pIdx, idx) => {
            const pl = gs.players[pIdx] || { name: `P${pIdx + 1}`, color: "Z3" };
            const pickDone = idx < draftStep;
            const pickCurr = idx === draftStep;
            const pickInfo = (pc.picks || [])[idx];
            return el(
              "span",
              {
                className: `climate-draft-chip ${pickDone ? "done" : pickCurr ? "current" : "upcoming"}`,
                title: pickInfo ? `Picked ${pickInfo.factor}: ${pickInfo.title}` : `Pick #${idx + 1}`,
              },
              el("strong", { text: `#${idx + 1} ${pl.name}` }),
              pickInfo ? el("span", { text: ` • ${pickInfo.factor}` }) : null
            );
          })
        )
      : null,
    buildPoliticalClimateBoardGridNode(gs, viewer, isDraftPhase)
  );
}

function openPoliticalClimateModal(gs, viewer) {
  const body = el(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: "0.75rem" } },
    buildPoliticalClimateExplainerNode(gs),
    buildPoliticalClimateBoardGridNode(gs, viewer, gs && gs.phase === "setup_climate"),
    el(
      "div",
      { style: { display: "flex", justifyContent: "flex-end" } },
      el("button", { className: "btn btn-primary", text: "Close", onClick: () => closeModal() })
    )
  );
  showModal("🏛️ Curia Julia — Political Climate Board", body, { wide: true });
}

function renderSetupDiscardPanel(viewer) {
  const mDisc = appState.setupDiscardMissions;
  const iDisc = appState.setupDiscardInfluence;

  return el(
    "div",
    { className: "panel", style: { borderColor: "var(--gold-bright)" } },
    el(
      "h3",
      { className: "panel-title" },
      el("span", { text: "📜 Initial Setup: Discard 2 Missions & 2 Influence Cards" }),
      el("button", {
        className: "btn btn-sm",
        text: "Auto-Select 2 & 2",
        onClick: () => {
          mDisc.clear();
          iDisc.clear();
          viewer.missions.slice(-2).forEach((m) => mDisc.add(m.id));
          viewer.influence.slice(-2).forEach((c) => iDisc.add(c.id));
          renderApp();
        },
      })
    ),
    el("h4", { style: { margin: "0.35rem 0 0.5rem 0", color: "var(--gold-bright)" }, text: `Starting Missions (Select 2 to Discard — ${mDisc.size}/2)` }),
    el(
      "div",
      { className: "phys-cards-grid", style: { marginBottom: "1rem" } },
      ...viewer.missions.map((m) => {
        const isSel = mDisc.has(m.id);
        return renderPhysicalMissionCardNode(m, {
          selectable: true,
          selected: isSel,
          onClick: () => {
            if (isSel) mDisc.delete(m.id);
            else if (mDisc.size < 2) mDisc.add(m.id);
            renderApp();
          },
        });
      })
    ),
    el("h4", { style: { margin: "0.5rem 0", color: "var(--gold-bright)" }, text: `Starting Influence Cards (Select 2 to Discard — ${iDisc.size}/2)` }),
    el(
      "div",
      { className: "phys-cards-grid", style: { marginBottom: "1rem" } },
      ...viewer.influence.map((c) => {
        const isSel = iDisc.has(c.id);
        return renderPhysicalInfluenceCardNode(c, {
          selectable: true,
          selected: isSel,
          onClick: () => {
            if (isSel) iDisc.delete(c.id);
            else if (iDisc.size < 2) iDisc.add(c.id);
            renderApp();
          },
        });
      })
    ),
    el("button", {
      className: "btn btn-primary",
      disabled: mDisc.size !== 2 || iDisc.size !== 2,
      text: "✓ Confirm Starting Hand & Enter Political Climate Draft",
      onClick: () =>
        sendGameAction({
          type: "setup_discard",
          discardMissionIds: Array.from(mDisc),
          discardInfluenceIds: Array.from(iDisc),
        }),
    })
  );
}

function formatSignedFlat(val) {
  const n = Number(val) || 0;
  return n >= 0 ? `+${n}` : `${n}`;
}

function armDieCardAction(cardObj, mode = "reroll") {
  if (!cardObj || !cardObj.id) return;
  if (appState.armedDieAction && appState.armedDieAction.cardId === cardObj.id) {
    appState.armedDieAction = null;
  } else {
    appState.armedDieAction = {
      cardId: cardObj.id,
      cardName: cardObj.name || "Influence Card",
      mode,
    };
  }
  renderDiceOverlay();
  renderApp();
}

function handleDieSelectionClick(pend, viewer, targetSide = "player", dieIdx = 0) {
  if (!pend || !viewer) return;
  const hand = viewer.influence || [];
  if (appState.armedDieAction && appState.armedDieAction.cardId) {
    const armedCard = hand.find((c) => c.id === appState.armedDieAction.cardId);
    appState.armedDieAction = null;
    if (armedCard) {
      sendGameAction({
        type: "play_influence",
        cardId: armedCard.id,
        targetSide,
        dieIndex: dieIdx,
        targetIndex: dieIdx,
      });
      return;
    }
  }

  const stage = pend.stage || "pre_decision";
  const twistCard = hand.find((c) => String(c.name || "") === "Twist Of Fate");
  const luckyCard =
    (stage === "driver_fate_post_roll" || stage === "chart_post_roll") && pend.chartType !== "soothsayer"
      ? hand.find((c) => String(c.name || "") === "Lucky Break")
      : null;

  if (twistCard && luckyCard) {
    showModal(
      "🎲 Modify Rolled Die — Choose Influence Card",
      el(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "0.65rem" } },
        el("p", {
          style: { margin: "0", fontSize: "0.88rem", color: "var(--text-main)" },
          text: "You hold both 'Twist Of Fate' and 'Lucky Break'. Choose how you want to modify this die:",
        }),
        el("button", {
          type: "button",
          className: "btn btn-primary",
          text: "🍀 Play 'Lucky Break' (+1 to This Die Roll)",
          onClick: () => {
            closeModal();
            sendGameAction({
              type: "play_influence",
              cardId: luckyCard.id,
              targetSide,
              dieIndex: dieIdx,
              targetIndex: dieIdx,
            });
          },
        }),
        el("button", {
          type: "button",
          className: "btn btn-crimson",
          text: "🎲 Play 'Twist Of Fate' (Re-Roll This Die)",
          onClick: () => {
            closeModal();
            sendGameAction({
              type: "play_influence",
              cardId: twistCard.id,
              targetSide,
              dieIndex: dieIdx,
              targetIndex: dieIdx,
            });
          },
        }),
        el("button", { type: "button", className: "btn", text: "Cancel", onClick: closeModal })
      )
    );
    return;
  }

  const chosen = twistCard || luckyCard;
  if (chosen) {
    sendGameAction({
      type: "play_influence",
      cardId: chosen.id,
      targetSide,
      dieIndex: dieIdx,
      targetIndex: dieIdx,
    });
  }
}

function renderInlineClickableDiceRow(pend, viewer, merchantLabel = "Your") {
  const stage = pend.stage || "pre_decision";
  const hand = (viewer && viewer.influence) || [];
  const hasTwist = hand.some((c) => String(c.name || "") === "Twist Of Fate");
  const hasLucky =
    (stage === "driver_fate_post_roll" || stage === "chart_post_roll") &&
    pend.chartType !== "soothsayer" &&
    hand.some((c) => String(c.name || "") === "Lucky Break");
  const canModifyAny = hasTwist || hasLucky;
  const isArmed = Boolean(appState.armedDieAction);

  let actionHint = "Click to Modify";
  if (appState.armedDieAction) {
    actionHint = appState.armedDieAction.mode === "plus_one" ? "👆 Click for +1!" : "👆 Click to Re-Roll!";
  } else if (hasTwist && !hasLucky) {
    actionHint = "🔄 Click to Re-Roll";
  } else if (hasLucky && !hasTwist) {
    actionHint = "🍀 Click for +1";
  }

  const dieButtons = [];
  if (stage === "combat_post_roll") {
    const pDice = Array.isArray(pend.playerDiceObjs) ? pend.playerDiceObjs : [];
    pDice.forEach((d, idx) => {
      const rom = d.roman !== undefined ? String(d.roman) : toRomanDieSymbol(Number(d.value) || 0);
      const signNote = d.sign === 0 ? "🛡️ Block" : d.sign < 0 ? `-${rom} CP` : `+${rom} CP`;
      dieButtons.push(
        el(
          "button",
          {
            type: "button",
            className: `inline-roman-die-btn ${hasTwist ? "clickable-die" : ""} ${hasTwist && isArmed ? "armed-die" : ""}`,
            disabled: !hasTwist,
            title: hasTwist ? `Click this die to re-roll with 'Twist Of Fate'` : `${merchantLabel} ${d.label || "Die"}`,
            onClick: hasTwist ? () => handleDieSelectionClick(pend, viewer, "player", idx) : null,
          },
          el("span", { className: "inline-roman-die-face", text: rom }),
          el(
            "span",
            { className: "inline-roman-die-meta" },
            el("span", { className: "inline-roman-die-owner", text: `${merchantLabel} • ${d.label || `Die #${idx + 1}`}` }),
            el("span", {
              className: "inline-roman-die-action",
              text: hasTwist ? `${signNote} • ${actionHint}` : signNote,
            })
          )
        )
      );
    });
    const oDice = Array.isArray(pend.oppDiceObjs) ? pend.oppDiceObjs : [];
    oDice.forEach((d, idx) => {
      const rom = d.roman !== undefined ? String(d.roman) : toRomanDieSymbol(Number(d.value) || 0);
      dieButtons.push(
        el(
          "button",
          {
            type: "button",
            className: `inline-roman-die-btn ${hasTwist ? "clickable-die" : ""} ${hasTwist && isArmed ? "armed-die" : ""}`,
            disabled: !hasTwist,
            title: hasTwist ? `Click this opponent die to re-roll with 'Twist Of Fate'` : `Opponent ${d.label || "Die"}`,
            onClick: hasTwist ? () => handleDieSelectionClick(pend, viewer, "opponent", idx) : null,
          },
          el("span", { className: "inline-roman-die-face", text: rom }),
          el(
            "span",
            { className: "inline-roman-die-meta" },
            el("span", { className: "inline-roman-die-owner", text: `Opponent • ${d.label || `Die #${idx + 1}`}` }),
            el("span", {
              className: "inline-roman-die-action",
              text: hasTwist ? `+${rom} CP • ${actionHint}` : `+${rom} CP`,
            })
          )
        )
      );
    });
  } else if (stage === "driver_fate_post_roll" || stage === "chart_post_roll") {
    const rom = toRomanDieSymbol(Number(pend.chartRoll) || 0);
    const labelStr = stage === "driver_fate_post_roll" ? "Death Chart Die" : `${(pend.card && pend.card.name) || "Chart"} Die`;
    dieButtons.push(
      el(
        "button",
        {
          type: "button",
          className: `inline-roman-die-btn ${canModifyAny ? "clickable-die" : ""} ${canModifyAny && isArmed ? "armed-die" : ""}`,
          disabled: !canModifyAny,
          title: canModifyAny ? "Click directly on this die to re-roll or modify it!" : labelStr,
          onClick: canModifyAny ? () => handleDieSelectionClick(pend, viewer, "player", 0) : null,
        },
        el("span", { className: "inline-roman-die-face", text: rom }),
        el(
          "span",
          { className: "inline-roman-die-meta" },
          el("span", { className: "inline-roman-die-owner", text: labelStr }),
          el("span", {
            className: "inline-roman-die-action",
            text: canModifyAny ? actionHint : `Rolled ${rom}`,
          })
        )
      )
    );
  } else if (stage === "demand_post_roll") {
    const rom = toRomanDieSymbol(Number(pend.demandRoll) || 0);
    dieButtons.push(
      el(
        "button",
        {
          type: "button",
          className: `inline-roman-die-btn ${hasTwist ? "clickable-die" : ""} ${hasTwist && isArmed ? "armed-die" : ""}`,
          disabled: !hasTwist,
          title: hasTwist ? "Click directly on this die to re-roll with 'Twist Of Fate'!" : "Demand Die",
          onClick: hasTwist ? () => handleDieSelectionClick(pend, viewer, "player", 0) : null,
        },
        el("span", { className: "inline-roman-die-face", text: rom }),
        el(
          "span",
          { className: "inline-roman-die-meta" },
          el("span", { className: "inline-roman-die-owner", text: `${(pend.card && pend.card.name) || "Demand"} Die` }),
          el("span", {
            className: "inline-roman-die-action",
            text: hasTwist ? actionHint : `Rolled ${rom}`,
          })
        )
      )
    );
  } else if (stage === "gamble_post_roll") {
    const gRolls = Array.isArray(pend.gambleRolls) ? pend.gambleRolls : [];
    gRolls.forEach((val, idx) => {
      const rom = toRomanDieSymbol(Number(val) || 0);
      dieButtons.push(
        el(
          "button",
          {
            type: "button",
            className: `inline-roman-die-btn ${hasTwist ? "clickable-die" : ""} ${hasTwist && isArmed ? "armed-die" : ""}`,
            disabled: !hasTwist,
            title: hasTwist ? "Click directly on this die to re-roll with 'Twist Of Fate'!" : `Gamble Die #${idx + 1}`,
            onClick: hasTwist ? () => handleDieSelectionClick(pend, viewer, "player", idx) : null,
          },
          el("span", { className: "inline-roman-die-face", text: rom }),
          el(
            "span",
            { className: "inline-roman-die-meta" },
            el("span", { className: "inline-roman-die-owner", text: `Gamble Die #${idx + 1}` }),
            el("span", {
              className: "inline-roman-die-action",
              text: hasTwist ? actionHint : `Rolled ${rom}`,
            })
          )
        )
      );
    });
  }

  if (dieButtons.length === 0) return null;
  return el(
    "div",
    { style: { marginBottom: "0.75rem" } },
    canModifyAny
      ? el("div", {
          style: { fontSize: "0.78rem", fontWeight: "700", color: "#8c5612", marginBottom: "0.35rem" },
          text: "👆 Click Directly on Any Die Below to Re-Roll or Modify It:",
        })
      : null,
    el("div", { className: "inline-clickable-dice-bar" }, ...dieButtons)
  );
}

function buildConsumableWeaponPickerNodes(consumables, selectedSet, onChange) {
  return consumables.map((it) => {
    const c = it.combat || {};
    const effParts = [];
    if (c.dice) effParts.push(`+${c.dice}(R)`);
    if (c.flat) effParts.push(`${formatSignedFlat(c.flat)} CP`);
    const effLabel = effParts.join(" ") || "+1 CP";
    const isChecked = selectedSet.has(it.id);

    return el(
      "div",
      { className: `consumable-weapon-opt-card ${isChecked ? "selected" : ""}` },
      el(
        "div",
        { style: { flex: "1", minWidth: "200px" } },
        el("div", {
          style: { fontWeight: "800", fontSize: "0.9rem", color: isChecked ? "#991b1b" : "var(--text-main)" },
          text: `🗡️ ${it.name || it.item || "Weapon"} (${effLabel} — Destroyed if Used)`,
        }),
        el("div", {
          style: { fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "0.18rem" },
          text: isChecked
            ? `Selected for this combat: Grants ${effLabel}, then is destroyed and removed from your Cart.`
            : "Kept safe on your Cart: Contributes 0 CP in this combat and is NOT destroyed.",
        }),
        it.isMissionCargo
          ? el("div", {
              style: { fontSize: "0.76rem", color: "#b91c1c", fontWeight: "700", marginTop: "0.22rem" },
              text: "⚠️ Mission Cargo: Using & destroying this cargo will require loading replacement cargo at its origin again!",
            })
          : null
      ),
      el(
        "div",
        { style: { display: "flex", gap: "0.4rem", flexWrap: "wrap", flexShrink: "0" } },
        el("button", {
          type: "button",
          className: `btn btn-sm ${isChecked ? "btn-crimson" : ""}`,
          text: `🗡️ Use (${effLabel}, Destroyed)`,
          onClick: () => {
            selectedSet.add(it.id);
            onChange();
          },
        }),
        el("button", {
          type: "button",
          className: `btn btn-sm ${!isChecked ? "btn-primary" : ""}`,
          text: "🛡️ Do Not Use (Keep Safe)",
          onClick: () => {
            selectedSet.delete(it.id);
            onChange();
          },
        })
      )
    );
  });
}

function openConsumableWeaponsPromptModal(viewer, consumables, baseActionPayload) {
  const selectedSet = new Set();
  const listContainer = el("div", { style: { display: "flex", flexDirection: "column", gap: "0.55rem", margin: "0.75rem 0" } });
  const confirmBtn = el("button", {
    type: "button",
    className: "btn btn-crimson",
    text: "🎲 Roll Combat Dice",
    onClick: () => {
      closeModal();
      sendGameAction({
        ...baseActionPayload,
        useConsumableIds: Array.from(selectedSet),
      });
    },
  });

  function refreshView() {
    listContainer.replaceChildren(...buildConsumableWeaponPickerNodes(consumables, selectedSet, refreshView));
    const count = selectedSet.size;
    confirmBtn.textContent =
      count > 0
        ? `⚔️ Use ${count} Weapon${count === 1 ? "" : "s"} (Destroyed) & Roll Combat Dice`
        : "🛡️ Keep Weapon(s) Safe on Cart & Roll Combat Dice";
  }

  refreshView();

  showModal(
    "🗡️ Consumable Weapon(s) on Cart — Decide Before Rolling!",
    el(
      "div",
      {},
      el("p", {
        style: { margin: "0", fontSize: "0.88rem", color: "var(--text-main)" },
        text: "You carry weapon(s) that are destroyed if used in combat. Choose whether to expend them in this fight before rolling the combat dice:",
      }),
      listContainer,
      el(
        "div",
        { style: { display: "flex", justifyContent: "space-between", gap: "0.6rem", flexWrap: "wrap", marginTop: "0.9rem" } },
        el("button", { type: "button", className: "btn", text: "Cancel", onClick: closeModal }),
        confirmBtn
      )
    )
  );
}

function initiateCombatWithConsumablePrompt(viewer, baseActionPayload) {
  const consumables = ((viewer && viewer.cart) || []).filter(
    (it) => it && it.combat && it.combat.consumable
  );
  if (consumables.length === 0) {
    sendGameAction(baseActionPayload);
    return;
  }
  openConsumableWeaponsPromptModal(viewer, consumables, baseActionPayload);
}

function buildCombatInfluenceCardActionNode(rc, encPlayerName, oppName, isOtherPlayerEncounter) {
  const nm = String(rc.name || "");
  if (
    nm === "Mercenary Ambush" ||
    nm === "Distraction" ||
    nm === "Gladiator's Intervention" ||
    nm === "Flying Chamber Pot"
  ) {
    const effectShort =
      nm === "Mercenary Ambush"
        ? "+2(R)"
        : nm === "Distraction"
        ? "-1(R)"
        : nm === "Gladiator's Intervention"
        ? "+1(R)"
        : "+1 CP";
    const defaultMerchantFirst = nm !== "Distraction";
    const btnPlayer = el("button", {
      className: `btn btn-sm ${defaultMerchantFirst ? "btn-primary" : ""}`,
      style: { width: "100%", fontSize: "0.7rem", padding: "0.22rem 0.35rem" },
      text: `🎯 ${effectShort} → ${isOtherPlayerEncounter ? encPlayerName : "Your Side"}`,
      onClick: () => sendGameAction({ type: "play_influence", cardId: rc.id, targetSide: "player" }),
    });
    const btnOpp = el("button", {
      className: `btn btn-sm ${!defaultMerchantFirst ? "btn-primary" : ""}`,
      style: { width: "100%", fontSize: "0.7rem", padding: "0.22rem 0.35rem" },
      text: `🎯 ${effectShort} → ${oppName || "Opponent"}`,
      onClick: () => sendGameAction({ type: "play_influence", cardId: rc.id, targetSide: "opponent" }),
    });
    return el(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: "0.25rem", width: "100%" } },
      defaultMerchantFirst ? btnPlayer : btnOpp,
      defaultMerchantFirst ? btnOpp : btnPlayer
    );
  }
  const gsCurr = appState.gameState;
  const viewerCurr =
    gsCurr && Array.isArray(gsCurr.players) ? gsCurr.players[gsCurr.viewerPlayerIndex || 0] : null;
  const needsThugSwap =
    nm.includes("Thug") && viewerCurr && !doesItemFitWithoutSwap(viewerCurr, { reqGuards: 1 });
  return el("button", {
    className: "btn btn-sm btn-primary",
    style: { width: "100%" },
    text:
      nm === "Casus Belli"
        ? "⚔️ Play Casus Belli"
        : needsThugSwap
        ? `Play ${nm} (Fire Guard)`
        : `Play ${nm}`,
    onClick: () => triggerInfluenceCardPlay(gsCurr, viewerCurr, rc),
  });
}

function renderOpponentPublicCartSummaryNode(gs, encPlayer, viewer, theme = "light") {
  if (!encPlayer) return null;
  const isDark = theme === "dark";
  const cartItems = Array.isArray(encPlayer.cart) ? encPlayer.cart : [];
  const guardItems = Array.isArray(encPlayer.guards) ? encPlayer.guards : [];
  const usedBlocks = Number(encPlayer.usedBlocks) || 0;
  const maxBlocks = Number(encPlayer.maxBlocks) || 6;
  const usedGuards = Number(encPlayer.usedGuards) || 0;
  const maxGuards = Number(encPlayer.maxGuards) || 2;
  const cashVal = Number(encPlayer.cash) || 0;
  const favorObj = encPlayer.favor || {};
  const favorEntries = Object.entries(favorObj)
    .filter(([, v]) => Number(v) !== 0)
    .map(([f, v]) => `${f} ${Number(v) > 0 ? `+${v}` : v}`);

  const pillBg = isDark ? "rgba(255, 248, 232, 0.1)" : "#fffbeb";
  const pillBorder = isDark ? "rgba(212, 175, 55, 0.45)" : "#c4a46b";
  const pillColor = isDark ? "#fef3c7" : "#3b2314";
  const subColor = isDark ? "#fcd34d" : "#78350f";

  const goodPills =
    cartItems.length === 0
      ? [
          el("span", {
            style: { fontSize: "0.78rem", fontStyle: "italic", color: isDark ? "#d6c5ab" : "var(--text-muted)" },
            text: "None (Empty Cart)",
          }),
        ]
      : cartItems.map((it) => {
          const blocks = Math.max(1, Number(it.blocks) || 1);
          const track = it.track || it.category || "Good";
          const sub = it.subcategory && it.subcategory !== track ? `${track} · ${it.subcategory}` : track;
          const baseVal =
            !it.isMissionCargo && Array.isArray(it.sell) && it.sell.length >= 3 ? `= ${it.sell[2]}(d)` : null;
          const metaParts = [sub, `${blocks}■`];
          if (baseVal) metaParts.push(baseVal);
          if (it.isMissionCargo) metaParts.push("Mission Cargo");
          if (it.combatText && it.track === "Weapons" && !String(it.combatText).includes("0 CP")) {
            metaParts.push(it.combatText);
          }
          return el(
            "span",
            {
              style: {
                display: "inline-flex",
                alignItems: "center",
                gap: "0.3rem",
                padding: "0.18rem 0.5rem",
                borderRadius: "4px",
                background: pillBg,
                border: `1px solid ${pillBorder}`,
                color: pillColor,
                fontSize: "0.77rem",
                lineHeight: "1.25",
              },
            },
            el("strong", { text: it.name || it.item || "Good" }),
            el("span", {
              style: { color: subColor, fontSize: "0.72rem", fontWeight: "600" },
              text: `(${metaParts.join(" • ")})`,
            })
          );
        });

  const guardPills =
    guardItems.length === 0
      ? [
          el("span", {
            style: { fontSize: "0.78rem", fontStyle: "italic", color: isDark ? "#d6c5ab" : "var(--text-muted)" },
            text: "None",
          }),
        ]
      : guardItems.map((g) => {
          const cText = g.combatText || "+CP • Absorbs 1 Wound";
          return el(
            "span",
            {
              style: {
                display: "inline-flex",
                alignItems: "center",
                gap: "0.3rem",
                padding: "0.18rem 0.5rem",
                borderRadius: "4px",
                background: pillBg,
                border: `1px solid ${pillBorder}`,
                color: pillColor,
                fontSize: "0.77rem",
                lineHeight: "1.25",
              },
            },
            el("strong", { text: `🛡️ ${g.name || "Guard"}` }),
            el("span", {
              style: { color: subColor, fontSize: "0.72rem", fontWeight: "600" },
              text: `(${cText})`,
            })
          );
        });

  return el(
    "div",
    {
      className: "opponent-public-cart-inspector",
      style: {
        width: "100%",
        padding: isDark ? "0.55rem 0.75rem" : "0.65rem 0.85rem",
        marginBottom: isDark ? "0.45rem" : "0.85rem",
        borderRadius: "5px",
        background: isDark ? "rgba(24, 13, 8, 0.78)" : "#f9f3e3",
        border: isDark ? "1px solid rgba(212, 175, 55, 0.55)" : "1.5px solid #b58d4c",
        boxShadow: isDark ? "none" : "var(--bevel-sunken)",
        textAlign: "left",
      },
    },
    el(
      "div",
      {
        style: {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "0.5rem",
          flexWrap: "wrap",
          marginBottom: "0.38rem",
        },
      },
      el(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: "0.45rem",
            flexWrap: "wrap",
            fontSize: "0.8rem",
            fontWeight: "700",
            color: isDark ? "#fde68a" : "#5c2d16",
          },
        },
        el("span", { text: `🛒 ${encPlayer.name}'s Public Cart:` }),
        el("span", {
          style: { fontWeight: "600", color: isDark ? "#fef3c7" : "#3b2314" },
          text: `💰 ${cashVal}(d)  •  📦 ${usedBlocks}/${maxBlocks}■ Goods  •  🛡️ ${usedGuards}/${maxGuards}▲ Guards`,
        }),
        favorEntries.length > 0
          ? el("span", {
              style: { fontSize: "0.74rem", fontWeight: "600", color: subColor },
              text: `•  💎 Favor: ${favorEntries.join(", ")}`,
            })
          : null
      ),
      gs
        ? el("button", {
            type: "button",
            className: "btn btn-sm",
            style: { fontSize: "0.72rem", padding: "0.18rem 0.55rem" },
            text: "🔍 Inspect Full Cart Mat",
            onClick: (e) => {
              e.stopPropagation();
              openPlayerCartModal(gs, encPlayer, viewer);
            },
          })
        : null
    ),
    el(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          gap: "0.35rem",
          flexWrap: "wrap",
          marginBottom: "0.28rem",
        },
      },
      el("span", {
        style: { fontSize: "0.76rem", fontWeight: "700", color: isDark ? "#fcd34d" : "#6e2119" },
        text: "Goods:",
      }),
      ...goodPills
    ),
    el(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          gap: "0.35rem",
          flexWrap: "wrap",
        },
      },
      el("span", {
        style: { fontSize: "0.76rem", fontWeight: "700", color: isDark ? "#fcd34d" : "#6e2119" },
        text: "Guards:",
      }),
      ...guardPills
    )
  );
}

function renderPendingEncounterPanel(gs, viewer) {
  const panelNode = renderPendingEncounterPanelCore(gs, viewer);
  if (!panelNode || !gs || !gs.pendingEncounter || !viewer) return panelNode;
  const pend = gs.pendingEncounter;
  if (pend.playerIndex !== viewer.index) {
    const encPlayer = (gs.players && gs.players[pend.playerIndex]) || null;
    const summaryNode = renderOpponentPublicCartSummaryNode(gs, encPlayer, viewer, "light");
    if (summaryNode) {
      const titleEl = panelNode.querySelector && panelNode.querySelector(".panel-title");
      if (titleEl && titleEl.nextSibling) {
        panelNode.insertBefore(summaryNode, titleEl.nextSibling);
      } else {
        panelNode.prepend(summaryNode);
      }
    }
  }
  return panelNode;
}

function renderPendingEncounterPanelCore(gs, viewer) {
  const pend = gs.pendingEncounter;
  const stage = pend.stage || "pre_decision";
  const card = pend.card || {};
  const encPlayer = (gs.players && gs.players[pend.playerIndex]) || viewer;
  const isOtherPlayerEncounter = pend.playerIndex !== viewer.index;
  const merchantLabel = isOtherPlayerEncounter ? `${encPlayer.name}'s` : "Your";

  // Stage 0A: Non-Person Event Encounter Card (e.g., Salve!, Brutta Figura, Procession, Ushered Along, Road Blocked)
  if (stage === "event_pre_resolve") {
    const deckLabel = String(pend.deck || card.deck || "Encounter").toUpperCase();
    return el(
      "div",
      {
        id: "pending-encounter-panel",
        className: "panel",
        style: { borderColor: "var(--gold-bright)" },
      },
      el(
        "h3",
        { className: "panel-title" },
        el("span", {
          text: `📜 Event Encounter Drawn (${deckLabel} Deck): ${card.name || "Encounter Event"}`,
        }),
        el("span", {
          style: { fontSize: "0.78rem", color: "var(--gold-bright)" },
          text: "👆 Review the Encounter Card & Click to Resolve!",
        })
      ),
      el(
        "div",
        { className: "encounter-interactive-layout" },
        renderPhysicalEncounterCardNode(card, pend, {
          interactive: !isOtherPlayerEncounter,
          onFulfill: () => sendGameAction({ type: "resolve_encounter", decision: "resolve_event" }),
        }),
        el(
          "div",
          {},
          el(
            "div",
            { style: { display: "flex", gap: "0.55rem", flexWrap: "wrap", marginBottom: "0.75rem", fontSize: "0.82rem" } },
            pend.encounterSource
              ? el("span", {
                  className: "badge",
                  style: { borderColor: "#d97706", color: "#78350f", background: "#fffbeb" },
                  text: `📍 ${pend.encounterSource}`,
                })
              : null,
            el("span", { className: "badge", text: `Merchant: ${encPlayer.name}` }),
            el("span", { className: "badge", text: `Deck: ${deckLabel}` }),
            el("span", { className: "badge", text: "Event Card (Mandatory Effect)" })
          ),
          el(
            "div",
            {
              style: {
                padding: "0.75rem 0.9rem",
                background: "#fffbeb",
                border: "1.5px solid #d97706",
                borderRadius: "4px",
                fontSize: "0.88rem",
                color: "#78350f",
                marginBottom: "0.95rem",
                boxShadow: "var(--bevel-sunken)",
              },
            },
            el("div", {
              style: { fontWeight: "800", marginBottom: "0.3rem", fontSize: "0.94rem" },
              text: `📜 ${card.name || "Event"}:`,
            }),
            el("div", {
              style: { color: "var(--text-main)", lineHeight: "1.45" },
              text: card.actionText || "Resolve this Encounter card's effect.",
            })
          ),
          !isOtherPlayerEncounter
            ? el("button", {
                type: "button",
                className: "btn btn-primary",
                style: { fontSize: "0.95rem", padding: "0.55rem 1.25rem" },
                text: `▶ Resolve Encounter: "${card.name || "Continue"}"`,
                onClick: () => sendGameAction({ type: "resolve_encounter", decision: "resolve_event" }),
              })
            : el("div", {
                style: { fontSize: "0.84rem", color: "var(--text-muted)" },
                text: `Waiting for ${encPlayer.name} to acknowledge and resolve ${card.name}...`,
              })
        )
      )
    );
  }

  // Stage 0B: Table/Chart Encounter Pre-Roll Presentation (Angry Mob, Theater Troupe, Soothsayer)
  if (stage === "chart_pre_roll") {
    const cType = pend.chartType || "mob";
    const iconSrc =
      cType === "mob"
        ? "/assets/icons/angry_mob.png"
        : cType === "theater"
        ? "/assets/icons/theater_masks.png"
        : "/assets/icons/soothsayer_icon.png";
    const chartTitle =
      cType === "mob" ? "Angry Mob" : cType === "theater" ? "Theater Troupe" : "Soothsayer";
    const chartRows =
      cType === "mob"
        ? [
            { roll: "0", color: "#991b1b", bg: "#fef2f2", border: "#dc2626", title: "Roll 0 — Wine Looted:", desc: "The mob drinks all Wine on your Cart!" },
            { roll: "I", color: "#92400e", bg: "#fffbeb", border: "#d97706", title: "Roll I — Grain Looted:", desc: "The mob loots all Grain on your Cart!" },
            { roll: "II", color: "#713f12", bg: "#fefce8", border: "#ca8a04", title: "Roll II — Cargo Seized:", desc: "Lose the single most expensive Good on your Cart." },
            { roll: "III", color: "#15803d", bg: "#f0fdf4", border: "#16a34a", title: "Roll III — Clamors Noisily:", desc: "Safe passage! No cargo lost — your turn continues." },
          ]
        : cType === "theater"
        ? [
            { roll: "0", color: "#991b1b", bg: "#fef2f2", border: "#dc2626", title: "Roll 0 — Mocked on Stage:", desc: "Lose all positive Friendly Favor with every faction." },
            { roll: "I", color: "#15803d", bg: "#f0fdf4", border: "#16a34a", title: "Roll I — Satire Clears Your Name:", desc: "Clear all negative Hostile Favor back to 0!" },
            { roll: "II", color: "#713f12", bg: "#fefce8", border: "#ca8a04", title: "Roll II — Blocked by Revelers:", desc: "Lose the rest of this turn AND skip your next turn." },
            { roll: "III", color: "#14532d", bg: "#ecfdf5", border: "#15803d", title: "Roll III — Inspired Patron:", desc: "Roll 1(R) and draw that many Influence cards!" },
          ]
        : [
            { roll: "0", color: "#991b1b", bg: "#fef2f2", border: "#dc2626", title: "Roll 0 — Bare Prophecy:", desc: "Accept the mandatory Mission (0 bonus Influence sealed)." },
            { roll: "I–II", color: "#92400e", bg: "#fffbeb", border: "#d97706", title: "Roll I or II — Fated Omen:", desc: "Accept the mandatory Mission + seal 1 or 2 Influence cards unlocked on completion." },
            { roll: "III", color: "#15803d", bg: "#f0fdf4", border: "#16a34a", title: "Roll III — Auspicious Vision:", desc: "Accept the mandatory Mission + seal 3 Influence cards unlocked on completion!" },
          ];

    const preChartCards = !isOtherPlayerEncounter
      ? (viewer.influence || []).filter((c) => {
          const nm = String(c.name || "");
          if (cType === "mob" && nm === "Man Of The People") return true;
          if (cType === "theater" && nm === "Dramaturge") return true;
          return false;
        })
      : [];
    const autoTreatThree =
      (cType === "mob" && pend.ignoreMobActive) || (cType === "theater" && pend.ignoreTheaterActive);

    const visualCardNode = el(
      "div",
      {
        className: `phys-card ${!isOtherPlayerEncounter ? "interactive-large" : ""}`,
        style: {
          width: "235px",
          flexShrink: "0",
          background: "#f4ebd9",
          border: "3px solid #8a6421",
          borderRadius: "10px",
          overflow: "hidden",
          cursor: !isOtherPlayerEncounter ? "pointer" : "default",
          boxShadow: "0 10px 24px rgba(0,0,0,0.45)",
        },
        title: !isOtherPlayerEncounter ? `Click to resolve ${chartTitle}!` : chartTitle,
        onClick: !isOtherPlayerEncounter
          ? () => sendGameAction({ type: "resolve_encounter", decision: "roll_chart_encounter" })
          : null,
      },
      el(
        "div",
        {
          style: {
            background: cType === "mob" ? "#7f1d1d" : cType === "theater" ? "#4c1d95" : "#1e3a8a",
            color: "#fef08a",
            padding: "0.45rem 0.65rem",
            fontFamily: "Cinzel, Georgia, serif",
            fontWeight: "800",
            fontSize: "0.86rem",
            textAlign: "center",
            letterSpacing: "0.05em",
          },
        },
        chartTitle.toUpperCase()
      ),
      el(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "0.85rem 0.7rem",
            gap: "0.5rem",
            color: "#291d12",
          },
        },
        el("img", {
          src: iconSrc,
          alt: chartTitle,
          style: { width: "76px", height: "76px", objectFit: "contain" },
        }),
        el("div", {
          style: {
            fontSize: "0.72rem",
            fontWeight: "800",
            padding: "0.18rem 0.55rem",
            borderRadius: "999px",
            background: "rgba(138, 100, 33, 0.16)",
            border: "1px solid rgba(138, 100, 33, 0.45)",
          },
          text: "ROLL 1 ROME DIE (0–III)",
        }),
        el("div", {
          style: { fontSize: "0.76rem", textAlign: "center", lineHeight: "1.35" },
          text: card.actionText || `Roll 1(R) on the ${chartTitle} Chart.`,
        }),
        !isOtherPlayerEncounter
          ? el("span", {
              className: "enc-click-hint-pill fulfill",
              text: autoTreatThree ? "👆 Click to Resolve as III" : "👆 Click to Roll 1(R)",
            })
          : null
      )
    );

    return el(
      "div",
      {
        id: "pending-encounter-panel",
        className: "panel",
        style: { borderColor: "var(--gold-bright)" },
      },
      el(
        "h3",
        { className: "panel-title" },
        el("span", { text: `🎭 Encounter in Rome: ${chartTitle}` }),
        el("span", {
          style: { fontSize: "0.78rem", color: "var(--gold-bright)" },
          text: "👆 Review the Encounter & Click to Roll!",
        })
      ),
      el(
        "div",
        { className: "encounter-interactive-layout" },
        el(
          "div",
          { style: { display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-start" } },
          visualCardNode,
          cType === "soothsayer" && pend.soothsayerMission
            ? el(
                "div",
                { style: { width: "225px" } },
                renderPhysicalMissionCardNode(pend.soothsayerMission, { showStatusTag: false })
              )
            : null
        ),
        el(
          "div",
          {},
          el(
            "div",
            { style: { display: "flex", gap: "0.55rem", flexWrap: "wrap", marginBottom: "0.75rem", fontSize: "0.82rem" } },
            pend.encounterSource
              ? el("span", {
                  className: "badge",
                  style: { borderColor: "#d97706", color: "#78350f", background: "#fffbeb" },
                  text: `📍 ${pend.encounterSource}`,
                })
              : null,
            el("span", { className: "badge", text: `Merchant: ${encPlayer.name}` }),
            el("span", { className: "badge", text: `Encounter Type: ${chartTitle}` })
          ),
          autoTreatThree
            ? el("div", {
                style: {
                  padding: "0.55rem 0.8rem",
                  background: "#f0fdf4",
                  border: "1.5px solid #16a34a",
                  borderRadius: "4px",
                  color: "#14532d",
                  fontSize: "0.84rem",
                  fontWeight: "700",
                  marginBottom: "0.75rem",
                  boxShadow: "var(--bevel-sunken)",
                },
                text: `✨ Active Influence Protection: Your ${chartTitle} encounter will automatically resolve as Roll III!`,
              })
            : null,
          el(
            "div",
            {
              style: {
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(185px, 1fr))",
                gap: "0.5rem",
                marginBottom: "0.85rem",
                fontSize: "0.8rem",
              },
            },
            ...chartRows.map((row) =>
              el(
                "div",
                {
                  style: {
                    padding: "0.5rem 0.6rem",
                    background: row.bg,
                    borderRadius: "4px",
                    border: `1px solid ${row.border}`,
                    boxShadow: "var(--bevel-sunken)",
                  },
                },
                el("strong", { style: { color: row.color }, text: row.title }),
                el("div", { style: { marginTop: "0.15rem", color: "var(--text-main)" }, text: row.desc })
              )
            )
          ),
          preChartCards.length > 0 && !autoTreatThree
            ? el(
                "div",
                { style: { display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.75rem" } },
                ...preChartCards.map((rc) =>
                  el("button", {
                    type: "button",
                    className: "btn btn-sm",
                    style: { borderColor: "#15803d", color: "#14532d" },
                    text: `✨ Play '${rc.name}' Before Rolling (Auto-Treat as III)`,
                    onClick: () => sendGameAction({ type: "play_influence", cardId: rc.id }),
                  })
                )
              )
            : null,
          !isOtherPlayerEncounter
            ? el("button", {
                type: "button",
                className: "btn btn-primary",
                style: { fontSize: "0.95rem", padding: "0.55rem 1.25rem" },
                text: autoTreatThree
                  ? `✨ Resolve ${chartTitle} as Roll III`
                  : `🎲 Roll ${chartTitle} Die (1®)`,
                onClick: () => sendGameAction({ type: "resolve_encounter", decision: "roll_chart_encounter" }),
              })
            : el("div", {
                style: { fontSize: "0.84rem", color: "var(--text-muted)" },
                text: `Waiting for ${encPlayer.name} to roll on the ${chartTitle} Chart...`,
              })
        )
      )
    );
  }

  // Stage 0C: Pre-Combat Consumable ("Destroyed if Used") Weapon Choice Before Rolling Combat Dice
  if (stage === "combat_consumable_pre_roll") {
    const consumables = Array.isArray(pend.consumableItems)
      ? pend.consumableItems
      : (encPlayer.cart || []).filter((it) => it && it.combat && it.combat.consumable);
    if (!appState._stageConsumableSelection || appState._stageConsumableEncounterCardId !== card.id) {
      appState._stageConsumableEncounterCardId = card.id;
      appState._stageConsumableSelection = new Set();
    }
    const selectedSet = appState._stageConsumableSelection;

    return el(
      "div",
      {
        id: "pending-encounter-panel",
        className: "panel",
        style: { borderColor: "#b45309" },
      },
      el(
        "h3",
        { className: "panel-title" },
        el("span", { text: `🗡️ Pre-Combat Weapon Choice vs. ${card.name || "Opponent"}` }),
        el("span", {
          style: { fontSize: "0.78rem", color: "var(--gold-bright)" },
          text: "Decide whether to expend destroyed-if-used weapon(s) before rolling!",
        })
      ),
      el(
        "div",
        { className: "encounter-interactive-layout" },
        card && card.id ? renderPhysicalEncounterCardNode(card, pend, { interactive: false }) : null,
        el(
          "div",
          {},
          el("p", {
            style: { marginTop: "0", fontSize: "0.88rem", color: "#78350f", fontWeight: "700" },
            text: "Choose which consumable ('destroyed if used') weapon(s) on your Cart you want to use in this combat before rolling the combat dice:",
          }),
          el(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: "0.55rem", marginBottom: "0.9rem" } },
            ...buildConsumableWeaponPickerNodes(consumables, selectedSet, () => renderApp())
          ),
          !isOtherPlayerEncounter
            ? el("button", {
                type: "button",
                className: "btn btn-crimson",
                style: { fontSize: "0.95rem", padding: "0.55rem 1.25rem" },
                text:
                  selectedSet.size > 0
                    ? `⚔️ Use ${selectedSet.size} Weapon${selectedSet.size === 1 ? "" : "s"} (Destroyed) & Roll Combat Dice`
                    : "🛡️ Keep Weapon(s) Safe on Cart & Roll Combat Dice",
                onClick: () => {
                  const chosenIds = Array.from(selectedSet);
                  appState._stageConsumableSelection = null;
                  sendGameAction({
                    type: "resolve_encounter",
                    decision: "confirm_consumables_and_roll",
                    useConsumableIds: chosenIds,
                  });
                },
              })
            : el("div", {
                style: { fontSize: "0.84rem", color: "var(--text-muted)" },
                text: `Waiting for ${encPlayer.name} to choose whether to use their consumable weapon(s)...`,
              })
        )
      )
    );
  }

  // Stage 2: Combat Post-Roll Influence Opportunity (Gladiator's Intervention, Mercenary Ambush, Flying Chamber Pot, Twist Of Fate)
  if (stage === "combat_post_roll") {
    const pCP = Number(pend.playerCP) || 0;
    const oCP = Number(pend.oppCP) || 0;
    const isVictory = pCP > oCP;
    const isTie = pCP === oCP;
    const rawWounds = Math.max(0, oCP - pCP);
    const ignoreWounds = Number(pend.ignoreWounds) || 0;
    const netWounds = Math.max(0, rawWounds - ignoreWounds);
    const guardCount = (encPlayer.guards || []).length;
    const survivesByArmor = !isVictory && !isTie && netWounds <= 0;
    const survivesByGuard = !isVictory && !isTie && netWounds > 0 && netWounds <= guardCount;
    const armorSources = Array.isArray(pend.armorSources) ? pend.armorSources : [];
    const armorLabelStr =
      armorSources.length > 0
        ? armorSources.join(", ")
        : ignoreWounds > 0
        ? `Armor (Ignore ${ignoreWounds} Wound${ignoreWounds === 1 ? "" : "s"})`
        : "None";
    const equipNotes = Array.isArray(pend.equipmentNotes) ? pend.equipmentNotes : [];

    const postCards = (viewer.influence || []).filter((c) => {
      const nm = String(c.name || "");
      return (
        nm === "Gladiator's Intervention" ||
        nm === "Flying Chamber Pot" ||
        nm === "Twist Of Fate"
      );
    });

    const pDiceSummary = (pend.playerDiceObjs || [])
      .map((d) =>
        d.sign === 0
          ? `${d.label}: 🛡️[${d.roman}]`
          : `${d.label}: ${d.sign < 0 ? "-" : ""}[${d.roman}]`
      )
      .join(", ");
    const oDiceSummary = (pend.oppDiceObjs || []).map((d) => `${d.label}: [${d.roman}]`).join(", ");

    const statusLabel = isVictory
      ? "VICTORY"
      : isTie
      ? "TIE (SURVIVED — NO BONUS)"
      : survivesByArmor
      ? `SURVIVED (${armorLabelStr.toUpperCase()} BLOCKED WOUNDS)`
      : survivesByGuard
      ? "DEFEAT — SURVIVED (GUARD ABSORBED WOUND)"
      : "DEFEAT (ROLL ON DEFEAT CHART)";

    const statusBorderColor = isVictory
      ? "#16a34a"
      : isTie || survivesByArmor
      ? "#ca8a04"
      : survivesByGuard
      ? "#ea580c"
      : "#dc2626";

    let outcomeSummaryText = "";
    if (isVictory) {
      outcomeSummaryText = `🏆 Current Outcome for ${encPlayer.name}: Victory (${pCP} CP vs. ${oCP} CP)!`;
    } else if (isTie) {
      outcomeSummaryText = `⚖️ Current Outcome for ${encPlayer.name}: Tie (${pCP} CP vs. ${oCP} CP) — ${encPlayer.name} survives combat unharmed (no roll on the Defeat Chart), but does not receive the bonus for winning combat.`;
    } else if (survivesByArmor) {
      outcomeSummaryText = `🛡️ Current Outcome for ${encPlayer.name}: Lost by ${rawWounds} point${
        rawWounds === 1 ? "" : "s"
      } (${pCP} CP vs. ${oCP} CP), but ${armorLabelStr} blocked all ${rawWounds} Wound${
        rawWounds === 1 ? "" : "s"
      }! ${encPlayer.name} survives combat and will NOT proceed to a roll on the Defeat Chart.`;
    } else if (survivesByGuard) {
      outcomeSummaryText = `🛡️ Current Outcome for ${encPlayer.name}: Defeat (${pCP} CP vs. ${oCP} CP) — ${rawWounds} Raw Wound(s), ${ignoreWounds} Blocked by ${armorLabelStr}, ${netWounds} Absorbed by Hired Guard(s). Your Driver survives and will NOT proceed to a roll on the Defeat Chart!`;
    } else {
      outcomeSummaryText = `⚠️ Current Outcome for ${encPlayer.name}: Defeat (${pCP} CP vs. ${oCP} CP) — ${rawWounds} Raw Wound(s), ${ignoreWounds} Blocked by ${armorLabelStr} (${netWounds} Unblocked). Driver will proceed to a roll on the Defeat Chart!`;
    }

    return el(
      "div",
      { id: "pending-encounter-panel", className: "panel", style: { borderColor: statusBorderColor } },
      el(
        "h3",
        { className: "panel-title" },
        el("span", {
          text: `⚔️ Combat Dice Rolled: ${encPlayer.name} (${pCP} CP) vs. ${card.name} (${oCP} CP) — ${statusLabel}${
            isOtherPlayerEncounter ? " [Your Intervention Window]" : ""
          }`,
        })
      ),
      el(
        "div",
        {
          style: {
            padding: "0.65rem 0.85rem",
            background: isVictory
              ? "#f0fdf4"
              : isTie || survivesByArmor
              ? "#fefce8"
              : "#fef2f2",
            border: `1.5px solid ${statusBorderColor}`,
            borderRadius: "4px",
            fontSize: "0.85rem",
            color: isVictory ? "#14532d" : isTie || survivesByArmor ? "#713f12" : "#7f1d1d",
            marginBottom: "0.85rem",
            boxShadow: "var(--bevel-sunken)",
          },
        },
        el("div", {
          style: { fontWeight: "700", marginBottom: "0.25rem" },
          text: outcomeSummaryText,
        }),
        pend.encounterSource
          ? el("div", {
              style: { fontSize: "0.78rem", color: "#92400e", marginBottom: "0.25rem", fontWeight: "700" },
              text: `📍 Triggered By: ${pend.encounterSource}`,
            })
          : null,
        el("div", {
          style: { fontSize: "0.78rem", color: "var(--text-main)" },
          text: `${encPlayer.name} Rolls: ${pDiceSummary || "None"} (Flat ${formatSignedFlat(
            pend.playerFlat
          )})  |  Opponent Rolls: ${oDiceSummary || "None"} (Flat ${formatSignedFlat(pend.oppFlat)})`,
        }),
        equipNotes.length > 0
          ? el("div", {
              style: { fontSize: "0.78rem", color: "#78350f", marginTop: "0.3rem", fontWeight: "700" },
              text: `🛡️⚔️ Active Guard & Weapon Effects: ${equipNotes.join(" • ")}`,
            })
          : null
      ),
      renderInlineClickableDiceRow(pend, viewer, merchantLabel),
      buildArmedDieBannerNode() ? el("div", { style: { marginBottom: "0.7rem" } }, buildArmedDieBannerNode()) : null,
      postCards.length > 0
        ? el(
            "div",
            { style: { marginBottom: "0.9rem" } },
            el("div", {
              style: { fontSize: "0.84rem", fontWeight: "700", color: "var(--gold-bright)", marginBottom: "0.45rem" },
              text: isOtherPlayerEncounter
                ? `🃏 Intervene in ${encPlayer.name}'s Combat! Click a Die Above or Play a Post-Roll Influence Card:`
                : "🃏 Post-Roll Combat Influence Cards Available (Click a Die Above to Re-Roll or Play a Card):",
            }),
            el(
              "div",
              { className: "phys-cards-grid compact-sidebar-grid" },
              ...postCards.map((rc) => {
                if (rc.name === "Twist Of Fate") {
                  const isArmed = Boolean(appState.armedDieAction && appState.armedDieAction.cardId === rc.id);
                  return renderPhysicalInfluenceCardNode(rc, {
                    actionButton: el("button", {
                      className: `btn btn-sm ${isArmed ? "btn-crimson" : "btn-primary"}`,
                      style: { width: "100%" },
                      text: isArmed ? "👆 Click Any Die Above!" : "🎲 Click a Die Above to Re-Roll",
                      onClick: () => armDieCardAction(rc, "reroll"),
                    }),
                  });
                }
                return renderPhysicalInfluenceCardNode(rc, {
                  actionButton: buildCombatInfluenceCardActionNode(
                    rc,
                    encPlayer.name,
                    card.name,
                    isOtherPlayerEncounter
                  ),
                });
              })
            )
          )
        : null,
      el(
        "div",
        { style: { display: "flex", gap: "0.65rem", alignItems: "center" } },
        el("button", {
          className: isVictory || isTie || survivesByArmor ? "btn btn-primary" : "btn btn-crimson",
          text: isOtherPlayerEncounter
            ? "✅ Pass Intervention / Confirm Combat Result"
            : isVictory
            ? "✅ Confirm Combat Victory"
            : isTie
            ? "✅ Confirm Combat Tie (Survive, No Bonus)"
            : survivesByArmor
            ? `🛡️ Confirm Survival (${armorLabelStr} Blocked Wounds — No Defeat Roll)`
            : survivesByGuard
            ? "🛡️ Confirm Survival (Guard Absorbed Wound — No Defeat Roll)"
            : "💀 Confirm Combat Result & Proceed to Driver Fate Roll",
          onClick: () => sendGameAction({ type: "resolve_encounter", decision: "finalize_combat" }),
        })
      )
    );
  }

  // Stage 3A: Driver Wounded — Prompt Player to Roll on the Driver Fate (Death) Chart
  if (stage === "driver_fate_pre_roll") {
    const postChartCards = (viewer.influence || []).filter(
      (c) => c.name === "Lucky Break" || c.name === "Twist Of Fate"
    );
    return el(
      "div",
      { id: "pending-encounter-panel", className: "panel", style: { borderColor: "#b91c1c" } },
      el(
        "h3",
        { className: "panel-title" },
        el("span", { text: `💀 Driver Wounded in Combat — Roll on the Driver Fate (Death) Chart!` })
      ),
      el(
        "div",
        {
          style: {
            padding: "0.7rem 0.9rem",
            background: "#fef2f2",
            border: "1.5px solid #dc2626",
            borderRadius: "4px",
            fontSize: "0.85rem",
            color: "#7f1d1d",
            marginBottom: "0.8rem",
            boxShadow: "var(--bevel-sunken)",
          },
        },
        el("strong", { text: "⚔️ Unblocked Wound to Driver: " }),
        `${encPlayer.name} lost combat (${pend.playerCP} CP vs. ${card.name}'s ${pend.oppCP} CP), suffering ${pend.rawWounds} wound(s) (${
          pend.ignoreWounds || 0
        } blocked by Armor${
          pend.casualties && pend.casualties.length ? `, ${pend.casualties.join(", ")}` : ""
        }). Roll 1 Rome Die (1(R)) on the Death Chart below to determine the Driver's fate!`
      ),
      el(
        "div",
        {
          style: {
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(185px, 1fr))",
            gap: "0.5rem",
            marginBottom: "0.85rem",
            fontSize: "0.8rem",
          },
        },
        el(
          "div",
          { style: { padding: "0.5rem", background: "#fef2f2", borderRadius: "4px", border: "1px solid #dc2626" } },
          el("strong", { style: { color: "#991b1b" }, text: "Roll 0 — Dead:" }),
          el("div", { style: { color: "var(--text-main)" }, text: "Lose all Goods on Cart; your night ends immediately." })
        ),
        el(
          "div",
          { style: { padding: "0.5rem", background: "#fffbeb", borderRadius: "4px", border: "1px solid #d97706" } },
          el("strong", { style: { color: "#92400e" }, text: "Roll I — Left for dead:" }),
          el("div", { style: { color: "var(--text-main)" }, text: "Lose all Goods on Cart; your night continues." })
        ),
        el(
          "div",
          { style: { padding: "0.5rem", background: "#fefce8", borderRadius: "4px", border: "1px solid #ca8a04" } },
          el("strong", { style: { color: "#713f12" }, text: "Roll II — Beaten & mugged:" }),
          el("div", { style: { color: "var(--text-main)" }, text: "Lose all Denarii; your night continues." })
        ),
        el(
          "div",
          { style: { padding: "0.5rem", background: "#f0fdf4", borderRadius: "4px", border: "1px solid #16a34a" } },
          el("strong", { style: { color: "#15803d" }, text: "Roll III — Begged for mercy:" }),
          el("div", { style: { color: "var(--text-main)" }, text: "Lose all Influence cards; your night continues." })
        )
      ),
      postChartCards.length > 0
        ? el("div", {
            style: { fontSize: "0.82rem", color: "var(--gold-bright)", marginBottom: "0.75rem", fontWeight: "600" },
            text: `🃏 You hold ${postChartCards.map((c) => `'${c.name}'`).join(", ")} — after rolling the Death Chart die, click directly on the rolled die to modify or re-roll it!`,
          })
        : null,
      el("button", {
        className: "btn btn-crimson",
        style: { fontSize: "0.95rem", padding: "0.55rem 1.25rem" },
        text: "🎲 Roll Driver Fate Die (1(R)) on Death Chart",
        onClick: () => sendGameAction({ type: "resolve_encounter", decision: "roll_driver_fate" }),
      })
    );
  }

  // Stage 3B / Chart Post-Roll: Modify or Re-Roll Driver Fate / Angry Mob / Theater Troupe / Soothsayer Roll
  if (stage === "driver_fate_post_roll" || stage === "chart_post_roll") {
    const cType = pend.chartType || "death";
    const cRoll = Number(pend.chartRoll) || 0;
    const rom = toRomanDieSymbol(cRoll);
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
      { id: "pending-encounter-panel", className: "panel", style: { borderColor: "var(--gold-bright)" } },
      el(
        "h3",
        { className: "panel-title" },
        el("span", {
          text:
            stage === "driver_fate_post_roll"
              ? `💀 ${encPlayer.name}'s Driver Fate (Death Chart) Roll: Rolled [${rom}]${
                  isOtherPlayerEncounter ? " [Your Intervention Window]" : ""
                }`
              : `🎲 ${encPlayer.name}'s ${card.name || "Encounter"} Roll: Rolled [${rom}]${
                  isOtherPlayerEncounter ? " [Your Intervention Window]" : ""
                }`,
        })
      ),
      el(
        "div",
        {
          style: {
            padding: "0.65rem 0.85rem",
            background: "#fffbeb",
            border: "1.5px solid #d97706",
            borderRadius: "4px",
            fontSize: "0.86rem",
            color: "#78350f",
            marginBottom: "0.85rem",
            boxShadow: "var(--bevel-sunken)",
          },
        },
        el("strong", { text: `Current Outcome for ${encPlayer.name} (Roll = ${rom}): ` }),
        pend.previewText || `Rolled ${rom}`
      ),
      renderInlineClickableDiceRow(pend, viewer, merchantLabel),
      buildArmedDieBannerNode() ? el("div", { style: { marginBottom: "0.7rem" } }, buildArmedDieBannerNode()) : null,
      postChartCards.length > 0
        ? el(
            "div",
            { style: { marginBottom: "0.85rem" } },
            el("div", {
              style: { fontSize: "0.84rem", fontWeight: "700", color: "var(--gold-bright)", marginBottom: "0.45rem" },
              text: isOtherPlayerEncounter
                ? `🃏 Intervene on ${encPlayer.name}'s Roll! Click the Die Above or Play a Card:`
                : "🃏 Post-Roll Influence Cards in Hand (Click the Die Above to Modify / Re-Roll!):",
            }),
            el(
              "div",
              { className: "phys-cards-grid compact-sidebar-grid" },
              ...postChartCards.map((rc) => {
                if (rc.name === "Lucky Break") {
                  const isArmed = Boolean(appState.armedDieAction && appState.armedDieAction.cardId === rc.id);
                  return renderPhysicalInfluenceCardNode(rc, {
                    actionButton: el("button", {
                      className: `btn btn-sm ${isArmed ? "btn-crimson" : "btn-primary"}`,
                      style: { width: "100%" },
                      text: isArmed ? "👆 Click Die Above for +1!" : "🍀 Click Die Above (+1)",
                      onClick: () => armDieCardAction(rc, "plus_one"),
                    }),
                  });
                }
                if (rc.name === "Twist Of Fate") {
                  const isArmed = Boolean(appState.armedDieAction && appState.armedDieAction.cardId === rc.id);
                  return renderPhysicalInfluenceCardNode(rc, {
                    actionButton: el("button", {
                      className: `btn btn-sm ${isArmed ? "btn-crimson" : "btn-primary"}`,
                      style: { width: "100%" },
                      text: isArmed ? "👆 Click Die Above to Re-Roll!" : "🎲 Click Die Above to Re-Roll",
                      onClick: () => armDieCardAction(rc, "reroll"),
                    }),
                  });
                }
                return renderPhysicalInfluenceCardNode(rc, {
                  actionButton: el("button", {
                    className: "btn btn-sm btn-primary",
                    style: { width: "100%" },
                    text: `✨ Play ${rc.name} (Treat as III)`,
                    onClick: () => sendGameAction({ type: "play_influence", cardId: rc.id }),
                  }),
                });
              })
            )
          )
        : null,
      el("button", {
        className: "btn btn-primary",
        text: isOtherPlayerEncounter ? "✅ Pass Intervention / Confirm Roll Outcome" : "✅ Confirm Roll Outcome",
        onClick: () =>
          sendGameAction({
            type: "resolve_encounter",
            decision: stage === "driver_fate_post_roll" ? "finalize_driver_fate" : "finalize_chart_roll",
          }),
      })
    );
  }

  // Stage 5 / 6: Demand Post-Roll (e.g., Scorpus / Sabinus) or Stadium Gambling Post-Roll
  if (stage === "demand_post_roll" || stage === "gamble_post_roll") {
    const twistCards = (viewer.influence || []).filter((c) => String(c.name || "") === "Twist Of Fate");
    const gambleRolls = Array.isArray(pend.gambleRolls) ? pend.gambleRolls : [];
    const romDisplay =
      stage === "demand_post_roll"
        ? toRomanDieSymbol(Number(pend.demandRoll) || 0)
        : gambleRolls.map((v) => toRomanDieSymbol(Number(v) || 0)).join(" + ");
    const titleStr =
      stage === "demand_post_roll"
        ? `📜 ${encPlayer.name}'s ${card.name || "Encounter"} Demand Roll: Rolled [${romDisplay}]${
            isOtherPlayerEncounter ? " [Your Intervention Window]" : ""
          }`
        : `🎲 ${encPlayer.name}'s Stadium Gambling (${pend.cell || "Rome"}): Rolled [${romDisplay}]${
            isOtherPlayerEncounter ? " [Your Intervention Window]" : ""
          }`;

    return el(
      "div",
      { id: "pending-encounter-panel", className: "panel", style: { borderColor: "var(--gold-bright)" } },
      el(
        "h3",
        { className: "panel-title" },
        el("span", { text: titleStr })
      ),
      el(
        "div",
        {
          style: {
            padding: "0.65rem 0.85rem",
            background: "#fffbeb",
            border: "1.5px solid #d97706",
            borderRadius: "4px",
            fontSize: "0.86rem",
            color: "#78350f",
            marginBottom: "0.85rem",
            boxShadow: "var(--bevel-sunken)",
          },
        },
        el("strong", { text: `Current Roll Outcome for ${encPlayer.name}: ` }),
        pend.previewText || `Rolled ${romDisplay}`
      ),
      renderInlineClickableDiceRow(pend, viewer, merchantLabel),
      buildArmedDieBannerNode() ? el("div", { style: { marginBottom: "0.7rem" } }, buildArmedDieBannerNode()) : null,
      twistCards.length > 0
        ? el(
            "div",
            { style: { marginBottom: "0.85rem" } },
            el("div", {
              style: { fontSize: "0.84rem", fontWeight: "700", color: "var(--gold-bright)", marginBottom: "0.45rem" },
              text: isOtherPlayerEncounter
                ? `🃏 Intervene on ${encPlayer.name}'s Roll! Click the Die Above to Force a Re-Roll:`
                : "🃏 Click Directly on the Die Above to Re-Roll with Twist Of Fate:",
            }),
            el(
              "div",
              { className: "phys-cards-grid compact-sidebar-grid" },
              ...twistCards.map((rc) => {
                const isArmed = Boolean(appState.armedDieAction && appState.armedDieAction.cardId === rc.id);
                return renderPhysicalInfluenceCardNode(rc, {
                  actionButton: el("button", {
                    className: `btn btn-sm ${isArmed ? "btn-crimson" : "btn-primary"}`,
                    style: { width: "100%" },
                    text: isArmed ? "👆 Click a Die Above to Re-Roll!" : "🎲 Click a Die Above to Re-Roll",
                    onClick: () => armDieCardAction(rc, "reroll"),
                  }),
                });
              })
            )
          )
        : null,
      el("button", {
        className: "btn btn-primary",
        text: isOtherPlayerEncounter ? "✅ Pass Intervention / Confirm Roll Outcome" : "✅ Confirm Roll Outcome",
        onClick: () =>
          sendGameAction({
            type: "resolve_encounter",
            decision: stage === "demand_post_roll" ? "finalize_demand_roll" : "finalize_gamble_roll",
          }),
      })
    );
  }

  // Stage 1: Pre-Decision (Encounter Drawn — Player can play Pre-Roll Combat or Favor/Plea Influence cards)
  const canFight = Boolean(pend.canInitiateCombat);
  const combatMandatory = Boolean(pend.combatMandatory);
  const hasDog =
    !isOtherPlayerEncounter &&
    (viewer.cart.some((c) => c.name === "Trained Dog") || viewer.influence.some((c) => c.name === "Trained Dog"));
  const hasPlea = !isOtherPlayerEncounter && viewer.influence.some((c) => (c.name || "").includes("Plea"));
  const hasCasusBelli =
    !isOtherPlayerEncounter &&
    (Boolean(pend.hasCasusBelliCard) || viewer.influence.some((c) => c.name === "Casus Belli"));

  const reactionInfluenceCards = (viewer.influence || []).filter((c) => {
    const nm = String(c.name || "");
    if (isOtherPlayerEncounter) {
      return (
        nm === "Mercenary Ambush" ||
        nm === "Distraction" ||
        nm === "Gladiator's Intervention" ||
        nm === "Flying Chamber Pot"
      );
    }
    return (
      nm === "Casus Belli" ||
      nm === "Mercenary Ambush" ||
      nm === "Distraction" ||
      nm === "Thug" ||
      nm === "Trained Dog" ||
      nm === "Supplicant" ||
      nm === "Minor Supplicant" ||
      nm.includes("Favor") ||
      nm.includes("Plea")
    );
  });

  const postRollCombatCardsHeld = (viewer.influence || []).filter((c) => {
    const nm = String(c.name || "");
    return nm === "Gladiator's Intervention" || nm === "Flying Chamber Pot" || nm === "Twist Of Fate";
  });

  const te = encPlayer.turnEffects || {};
  const activeCombatMods = [];
  if (te.combatDiceBonus) activeCombatMods.push(`${formatSignedFlat(te.combatDiceBonus)}(R) Merchant Dice`);
  if (te.combatFlatBonus) activeCombatMods.push(`${formatSignedFlat(te.combatFlatBonus)} Merchant Flat CP`);
  if (te.oppDiceMod) activeCombatMods.push(`${formatSignedFlat(te.oppDiceMod)}(R) Opponent Dice`);
  if (te.oppFlatBonus) activeCombatMods.push(`${formatSignedFlat(te.oppFlatBonus)} Opponent Flat CP`);
  if (pend.armyPayHikeActive || hasActiveClimateOption(gs, "caracalla_3")) {
    const posRubies = Math.max(0, Number(encPlayer.favor && encPlayer.favor.Caracalla) || 0);
    if (posRubies > 0) {
      activeCombatMods.push(`+${posRubies} Merchant CP (${posRubies} Caracalla Rub${posRubies === 1 ? "y" : "ies"})`);
    }
    if (pend.deck === "legiones") {
      activeCombatMods.push(`+2 Opponent CP (Legiones Army Pay Hike)`);
    }
  }

  const gearCombatEffects = [];
  (encPlayer.guards || []).forEach((g) => {
    const c = g.combat || {};
    const parts = [];
    if (c.dice) parts.push(`+${c.dice}(R)`);
    if (c.flat) parts.push(formatSignedFlat(c.flat) + " CP");
    if (c.ignoreWoundsFlat) parts.push(`Ignore ${c.ignoreWoundsFlat} Wound${c.ignoreWoundsFlat === 1 ? "" : "s"}`);
    parts.push("Absorbs 1 Wound");
    gearCombatEffects.push(`Guard ${g.name || "Guard"} (${parts.join(", ")})`);
  });
  (encPlayer.cart || []).forEach((it) => {
    const c = it.combat;
    if (!c) return;
    const parts = [];
    if (c.dice) parts.push(`+${c.dice}(R)`);
    if (c.negDice) parts.push(`-${c.negDice}(R)`);
    if (c.flat) parts.push(formatSignedFlat(c.flat) + " CP");
    if (c.ignoreWoundsFlat) parts.push(`Ignore ${c.ignoreWoundsFlat} Wound${c.ignoreWoundsFlat === 1 ? "" : "s"}`);
    if (c.ignoreWoundsDice) parts.push(`Ignore ${c.ignoreWoundsDice}(R) Wound(s)`);
    if (c.consumable) parts.push("Optional — Destroyed if Used");
    if (parts.length > 0) {
      gearCombatEffects.push(`${it.item || it.name || "Gear"} (${parts.join(", ")})`);
    }
  });

  let combatRuleBanner = null;
  if (isOtherPlayerEncounter) {
    combatRuleBanner = el(
      "div",
      {
        style: {
          padding: "0.6rem 0.8rem",
          background: "#fffbeb",
          border: "1.5px solid var(--gold-bright)",
          borderRadius: "4px",
          fontSize: "0.84rem",
          color: "#78350f",
          marginBottom: "0.75rem",
          boxShadow: "var(--bevel-sunken)",
        },
      },
      el("strong", { text: `⚡ Intervention Window (${encPlayer.name}'s Encounter with ${card.name}): ` }),
      `${encPlayer.name} has encountered ${card.name} and is entering combat! You may play Pre-Roll Combat Influence cards from your hand below to help or hinder either side before the dice are rolled, or click 'Pass Intervention & Roll Combat Dice'.`
    );
  } else if (combatMandatory) {
    combatRuleBanner = el(
      "div",
      {
        style: {
          padding: "0.55rem 0.75rem",
          background: "#fef2f2",
          border: "1.5px solid #dc2626",
          borderRadius: "4px",
          fontSize: "0.82rem",
          color: "#7f1d1d",
          marginBottom: "0.75rem",
          boxShadow: "var(--bevel-sunken)",
        },
      },
      el("strong", { text: "⚔️ Hostile Encounter (Mandatory Combat): " }),
      "Your Faction Favor places you in the Combat tier. You may play any Pre-Roll Combat Influence cards below before clicking the Combat section on the Encounter card to roll!"
    );
  } else if (canFight) {
    const reasonLabel =
      pend.combatUnlockReason === "mission"
        ? "Unlocked by your Active Combat Mission!"
        : pend.combatUnlockReason === "casus_belli"
        ? "Unlocked by 'Casus Belli' Influence Card!"
        : "Combat is threatened by this party (!!)";
    combatRuleBanner = el(
      "div",
      {
        style: {
          padding: "0.55rem 0.75rem",
          background: "#fffbeb",
          border: "1.5px solid #d97706",
          borderRadius: "4px",
          fontSize: "0.82rem",
          color: "#78350f",
          marginBottom: "0.75rem",
          boxShadow: "var(--bevel-sunken)",
        },
      },
      el("strong", { text: `⚔️ Combat Available (${reasonLabel}): ` }),
      "Click the Middle Action/Tier box on the card to Comply/Accept, OR play Pre-Roll Influence cards below and click the Bottom Combat Bar on the card to Fight!"
    );
  } else {
    combatRuleBanner = el(
      "div",
      {
        style: {
          padding: "0.55rem 0.75rem",
          background: "#f0f9ff",
          border: "1.5px solid #0284c7",
          borderRadius: "4px",
          fontSize: "0.82rem",
          color: "#0c4a6e",
          marginBottom: "0.75rem",
          boxShadow: "var(--bevel-sunken)",
        },
      },
      el("strong", { text: "🕊️ Combat Not Threatened: " }),
      "This party is not threatening combat at your current Favor tier. You cannot initiate combat unless required by an active Mission or by playing 'Casus Belli'. Click the Action/Tier section on the card to accept/comply, or Refuse below."
    );
  }

  return el(
    "div",
    { id: "pending-encounter-panel", className: "panel", style: { borderColor: "#991b1b" } },
    el(
      "h3",
      { className: "panel-title" },
      el("span", {
        text: isOtherPlayerEncounter
          ? `⚔️ ${encPlayer.name}'s Encounter in Rome: ${card.name} (${(pend.deck || "").toUpperCase()} Deck)`
          : `⚔️ Encounter in Rome: ${card.name} (${(pend.deck || "").toUpperCase()} Deck)`,
      }),
      el("span", {
        style: { fontSize: "0.78rem", color: "var(--gold-bright)" },
        text: isOtherPlayerEncounter
          ? "⚡ Intervene with Influence or Roll Combat Dice"
          : "👆 Click directly on the Encounter Card sections to choose your action!",
      })
    ),
    combatRuleBanner,
    el(
      "div",
      { className: "encounter-interactive-layout" },
      renderPhysicalEncounterCardNode(card, pend, {
        interactive: !isOtherPlayerEncounter,
        onFulfill: () => sendGameAction({ type: "resolve_encounter", decision: "fulfill" }),
        onFight: () => initiateCombatWithConsumablePrompt(viewer, { type: "resolve_encounter", decision: "fight" }),
      }),
      el(
        "div",
        {},
        el(
          "div",
          { style: { display: "flex", gap: "0.55rem", flexWrap: "wrap", marginBottom: "0.75rem", fontSize: "0.82rem" } },
          pend.encounterSource
            ? el("span", {
                className: "badge",
                style: { borderColor: "#d97706", color: "#78350f", background: "#fffbeb" },
                text: `📍 ${pend.encounterSource}`,
              })
            : null,
          el("span", { className: "badge", text: `Merchant: ${encPlayer.name}` }),
          el("span", { className: "badge", text: `Faction: ${card.faction || "Unaligned"}` }),
          el("span", { className: "badge", text: `Effective Favor: ${pend.favorScore > 0 ? `+${pend.favorScore}` : pend.favorScore}` }),
          el("span", {
            className: "badge",
            text: `Active Tier: ${
              pend.matchedTier
                ? `${formatReactionCondition(pend.matchedTier.condition || pend.matchedTier.cond)} → ${formatReactionTypeSymbol(pend.matchedTier)}`
                : formatReactionTypeSymbol(pend.reaction || pend.reactionType)
            }`,
          }),
          el("span", { className: "badge", text: `NPC Combat: ${card.combatFormula || "X(R)"} (X=${pend.xCount})` }),
          activeCombatMods.length > 0
            ? el("span", {
                className: "badge",
                style: { borderColor: "#16a34a", color: "#14532d", background: "#f0fdf4" },
                text: `⚔️ Active Combat Mods: ${activeCombatMods.join(", ")}`,
              })
            : null,
          gearCombatEffects.length > 0
            ? el("span", {
                className: "badge",
                style: { borderColor: "var(--gold-bright)", color: "#78350f", background: "#fffbeb" },
                text: `🛡️⚔️ Guard & Weapon Effects: ${gearCombatEffects.join(" • ")}`,
              })
            : null
        ),
        postRollCombatCardsHeld.length > 0 && canFight
          ? el("div", {
              style: {
                padding: "0.45rem 0.65rem",
                background: "#fdfaf2",
                border: "1px solid #c29b61",
                borderRadius: "4px",
                fontSize: "0.78rem",
                color: "var(--gold-bright)",
                marginBottom: "0.7rem",
              },
              text: `🃏 Post-Roll Combat Cards in Hand (${postRollCombatCardsHeld
                .map((c) => c.name)
                .join(", ")}): You will be prompted with the option to play these AFTER the combat dice are rolled!`,
            })
          : null,
        !isOtherPlayerEncounter
          ? el(
              "div",
              {
                style: {
                  padding: "0.7rem",
                  background: "#fbf7ee",
                  borderRadius: "4px",
                  marginBottom: "0.85rem",
                  border: "1px solid var(--border-subtle)",
                  boxShadow: "var(--bevel-sunken)",
                },
              },
              el("div", {
                style: { fontWeight: "700", color: "var(--gold-bright)", marginBottom: "0.35rem", fontSize: "0.85rem" },
                text: "Interactive Card Section Guide:",
              }),
              !combatMandatory
                ? el("div", {
                    style: { fontSize: "0.8rem", marginBottom: "0.25rem", color: "#15803d", fontWeight: "600" },
                    text: "• Click the Top Bar, Active Tier, or Middle Action Box on the card → Fulfill Demand / Accept Offer or Mission",
                  })
                : null,
              el("div", {
                style: { fontSize: "0.8rem", marginBottom: "0.25rem", color: canFight ? "#b91c1c" : "var(--text-muted)", fontWeight: canFight ? "600" : "400" },
                text: canFight
                  ? "• Click the Combat Formula or Bottom Combat Bar on the card → Initiate Combat!"
                  : "• Combat Section Locked (Combat is not threatened; requires Combat Mission or 'Casus Belli')",
              })
            )
          : null,
        el(
          "div",
          { style: { display: "flex", gap: "0.55rem", flexWrap: "wrap", marginBottom: "0.85rem" } },
          !isOtherPlayerEncounter && !combatMandatory
            ? el("button", {
                className: "btn btn-primary",
                text: (() => {
                  const rType = pend.reaction || pend.reactionType || "";
                  if (rType === "deck_quest_demand") {
                    return "(DECK_ICON)(QUEST_ICON)! Accept Top Missiones Card (Unseen)";
                  }
                  if (rType === "deck_quest_offer") {
                    return "(DECK_ICON)(QUEST_ICON)? Accept Top Missiones Card (Unseen)";
                  }
                  if (
                    (rType === "mission_strict" ||
                      rType === "mission_request" ||
                      rType === "mission_offer" ||
                      rType === "mission_bonus") &&
                    card.mission
                  ) {
                    return `📜 Accept Mission: "${card.mission.name}"`;
                  }
                  if (card.mission && !rType.startsWith("demand")) {
                    return `📜 Accept Mission: "${card.mission.name}"`;
                  }
                  return "✓ Comply / Accept Terms";
                })(),
                onClick: () => sendGameAction({ type: "resolve_encounter", decision: "fulfill" }),
              })
            : null,
          canFight
            ? el("button", {
                className: "btn btn-crimson",
                text: isOtherPlayerEncounter
                  ? `🎲 Pass Intervention & Roll ${encPlayer.name}'s Combat Dice`
                  : "⚔️ Fight! (Roll Combat Dice)",
                onClick: () => {
                  if (isOtherPlayerEncounter) {
                    sendGameAction({ type: "resolve_encounter", decision: "fight" });
                  } else {
                    initiateCombatWithConsumablePrompt(viewer, { type: "resolve_encounter", decision: "fight" });
                  }
                },
              })
            : null,
          !isOtherPlayerEncounter && !combatMandatory
            ? el("button", {
                className: "btn",
                text: (() => {
                  const rType = pend.reaction || pend.reactionType || "";
                  const actTxt = String(card.actionText || "").trim();
                  if (
                    rType === "offer" ||
                    rType === "mission_offer" ||
                    rType === "mission_bonus" ||
                    rType === "quest_optional" ||
                    rType === "deck_quest_offer" ||
                    rType === "cash_reward" ||
                    (!rType && actTxt.startsWith("?"))
                  ) {
                    return "Decline / Pass Offer (No Penalty)";
                  }
                  if (rType === "demand_strict" || rType === "mission_strict" || pend.combatThreatened) {
                    return "Refuse Threat (⚔️ Initiates Combat!)";
                  }
                  return `Refuse Request (Suffer ${formatHostileFavorPenaltyText(card)})`;
                })(),
                onClick: () => {
                  const rType = pend.reaction || pend.reactionType || "";
                  if (rType === "demand_strict" || rType === "mission_strict" || pend.combatThreatened) {
                    initiateCombatWithConsumablePrompt(viewer, { type: "resolve_encounter", decision: "refuse" });
                  } else {
                    sendGameAction({ type: "resolve_encounter", decision: "refuse" });
                  }
                },
              })
            : null,
          !isOtherPlayerEncounter && !canFight && hasCasusBelli
            ? el("button", {
                className: "btn btn-crimson",
                text: "⚔️ Play 'Casus Belli' & Initiate Combat!",
                onClick: () =>
                  initiateCombatWithConsumablePrompt(viewer, {
                    type: "resolve_encounter",
                    decision: "use_casus_belli",
                  }),
              })
            : null,
          hasDog
            ? el("button", {
                className: "btn",
                text: "🐕 Use 'Trained Dog' (Satisfy Denarii Demand / Avoid)",
                onClick: () => sendGameAction({ type: "resolve_encounter", decision: "use_dog" }),
              })
            : null,
          hasPlea
            ? el("button", {
                className: "btn",
                text: "🙏 Play 'Plea' (Cancel Encounter)",
                onClick: () => sendGameAction({ type: "resolve_encounter", decision: "use_plea" }),
              })
            : null
        ),
        reactionInfluenceCards.length > 0
          ? el(
              "div",
              {},
              el("div", {
                style: { fontSize: "0.8rem", fontWeight: "700", color: "var(--gold-bright)", marginBottom: "0.4rem" },
                text: isOtherPlayerEncounter
                  ? `🃏 Your Pre-Roll Combat Influence Cards (Target ${encPlayer.name} or ${card.name}):`
                  : "🃏 Pre-Roll & Reaction Influence Cards in Hand (Play Before Rolling):",
              }),
              el(
                "div",
                { className: "phys-cards-grid compact-sidebar-grid" },
                ...reactionInfluenceCards.map((rc) => {
                  if (rc.name === "Casus Belli" && !canFight) {
                    return renderPhysicalInfluenceCardNode(rc, {
                      actionButton: el("button", {
                        className: "btn btn-sm btn-primary",
                        style: { width: "100%" },
                        text: "⚔️ Play Casus Belli",
                        onClick: () =>
                          initiateCombatWithConsumablePrompt(viewer, {
                            type: "resolve_encounter",
                            decision: "use_casus_belli",
                          }),
                      }),
                    });
                  }
                  return renderPhysicalInfluenceCardNode(rc, {
                    actionButton: buildCombatInfluenceCardActionNode(
                      rc,
                      encPlayer.name,
                      card.name,
                      isOtherPlayerEncounter
                    ),
                  });
                })
              )
            )
          : null
      )
    )
  );
}

function renderPendingNpcOfferPanel(gs, viewer) {
  const offer = viewer.pendingNpcOffer;
  if (!offer) return null;
  const isBuy = (offer.mode || offer.offerType) === "buy_from_npc";
  const npcName = offer.npcName || (offer.npcCard && offer.npcCard.name) || "Patron";
  return el(
    "div",
    { className: "panel", style: { borderColor: "var(--gold-bright)" } },
    el(
      "h3",
      { className: "panel-title" },
      el("span", {
        text: `🤝 Active Offer from ${npcName}: ${
          isBuy ? `Purchase 1 ${offer.category}` : `Sell 1 ${offer.category}`
        }`,
      }),
      el("button", {
        className: "btn btn-sm btn-primary",
        text: `🔍 Choose ${offer.category} Card`,
        onClick: () => openNpcOfferModal(gs, viewer),
      })
    ),
    el(
      "div",
      {
        style: {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "0.75rem",
          flexWrap: "wrap",
          fontSize: "0.85rem",
        },
      },
      el("span", {
        text: `${npcName} (${offer.actionText || ""}) — Select which ${
          offer.category
        } card to ${isBuy ? "purchase" : "sell"}, or decline the offer.`,
      }),
      el(
        "div",
        { style: { display: "flex", gap: "0.5rem" } },
        el("button", {
          className: "btn btn-sm btn-primary",
          text: `📜 Open ${npcName}'s Offer Selection`,
          onClick: () => openNpcOfferModal(gs, viewer),
        }),
        el("button", {
          className: "btn btn-sm",
          text: "Decline Offer",
          onClick: () => sendGameAction({ type: "resolve_npc_offer", decision: "decline" }),
        })
      )
    )
  );
}

function renderPendingMarketRewardPanel(gs, viewer) {
  const queue = (viewer && Array.isArray(viewer.pendingMarketReward) && viewer.pendingMarketReward) || [];
  const rwd = queue[0];
  if (!rwd) return null;
  const catLabel = rwd.categoryLabel || rwd.subcategory || rwd.track || "Good";
  return el(
    "div",
    { className: "panel", style: { borderColor: "var(--gold-bright)" } },
    el(
      "h3",
      { className: "panel-title" },
      el("span", {
        text: `🎁 Market Board Reward Ready: Choose 1 ${catLabel}${
          queue.length > 1 ? ` (${queue.length} rewards queued)` : ""
        }`,
      }),
      el("button", {
        className: "btn btn-sm btn-primary",
        text: `🔍 Choose ${catLabel} on Market`,
        onClick: () => openMarketRewardModal(gs, viewer),
      })
    ),
    el(
      "div",
      {
        style: {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "0.75rem",
          flexWrap: "wrap",
          fontSize: "0.85rem",
        },
      },
      el("span", {
        text: `${rwd.sourceLabel || "Reward"} (${
          rwd.rewardLabel || catLabel
        }) — Select which ${catLabel} card on the Ostia Market Board to claim onto your Cart.`,
      }),
      el(
        "div",
        { style: { display: "flex", gap: "0.5rem" } },
        el("button", {
          className: "btn btn-sm btn-primary",
          text: `🎁 Choose ${catLabel} Card`,
          onClick: () => openMarketRewardModal(gs, viewer),
        }),
        el("button", {
          className: "btn btn-sm",
          text: "Decline Reward",
          onClick: () =>
            sendGameAction({
              type: "resolve_market_reward",
              rewardId: rwd.id,
              decision: "decline",
            }),
        })
      )
    )
  );
}

function renderPendingCartOverflowPanel(gs, viewer) {
  const queue = (viewer && viewer.pendingCartOverflow) || [];
  if (queue.length === 0) return null;
  const ovf = queue[0];
  const card = ovf.card || {};
  const isGuard = ovf.itemType === "guard" || card.track === "Guards";
  const reqBlocks = isGuard ? 0 : Math.max(1, Number(ovf.reqBlocks || card.blocks) || 1);
  return el(
    "div",
    { className: "panel", style: { borderColor: "var(--gold-bright)" } },
    el(
      "h3",
      { className: "panel-title" },
      el("span", {
        text: isGuard
          ? `🛡️ Guard Space Full — Resolve Received Guard: ${card.name}`
          : `🎁 Cart Space Full — Resolve Received Item: ${card.name} (${reqBlocks}■)`,
      }),
      el("button", {
        className: "btn btn-sm btn-primary",
        text: isGuard ? "🛡️ Fire a Guard or Refuse" : "🛒 Discard Goods or Refuse",
        onClick: () => openPendingCartOverflowModal(gs, viewer),
      })
    ),
    el(
      "div",
      {
        style: {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "0.75rem",
          flexWrap: "wrap",
          fontSize: "0.85rem",
        },
      },
      el("span", {
        text: isGuard
          ? `You received "${card.name}" (${ovf.sourceLabel || "Reward"}), and your Guard slots are full (${viewer.usedGuards}/${viewer.maxGuards}▲). Choose a Guard to fire or refuse the new Guard.`
          : `You received "${card.name}" (${reqBlocks}■ • ${ovf.sourceLabel || "Reward"}), and your Cart has ${viewer.usedBlocks}/${viewer.maxBlocks}■ used. Choose Goods to discard or refuse this item.`,
      }),
      el(
        "div",
        { style: { display: "flex", gap: "0.5rem" } },
        el("button", {
          className: "btn btn-sm btn-primary",
          text: isGuard ? "🛡️ Choose Guard to Fire" : "🛒 Choose Goods to Discard",
          onClick: () => openPendingCartOverflowModal(gs, viewer),
        }),
        el("button", {
          className: "btn btn-sm btn-crimson",
          text: `✕ Refuse ${card.name}`,
          onClick: () =>
            sendGameAction({
              type: "resolve_cart_overflow",
              overflowId: ovf.id,
              decision: "refuse",
            }),
        })
      )
    )
  );
}

function renderCleanupPhasePanel(gs, viewer) {
  if (appState.cleanupInitializedSeason !== gs.season) {
    appState.cleanupInitializedSeason = gs.season;
    appState.cleanupKeepGuards = new Set(viewer.guards.map((g) => g.id));
  }

  return el(
    "div",
    { className: "panel", style: { borderColor: "var(--gold-bright)" } },
    el("h3", { className: "panel-title", text: `🌅 Phase III: Dawn Clean-Up (${gs.season})` }),
    el(
      "div",
      { style: { display: "flex", gap: "0.65rem", flexWrap: "wrap", marginBottom: "0.9rem" } },
      el("button", {
        className: "btn btn-primary",
        disabled: viewer.cash < viewer.influenceBuyCost,
        text: `🃏 Buy Influence Card (${viewer.influenceBuyCost}d)`,
        onClick: () => sendGameAction({ type: "cleanup_buy_influence" }),
      }),
      gs.season === "Spring" && !viewer.loans.spring
        ? el("button", {
            className: "btn",
            text: "🏦 Take Spring Loan (+20d now; repay 30d in Summer or 45d in Fall)",
            onClick: () => sendGameAction({ type: "cleanup_take_loan" }),
          })
        : null,
      gs.season === "Summer" && !viewer.loans.summer
        ? el("button", {
            className: "btn",
            text: "🏦 Take Summer Loan (+40d now; repay 60d at end of Fall)",
            onClick: () => sendGameAction({ type: "cleanup_take_loan" }),
          })
        : null,
      gs.season === "Summer" && viewer.loans.spring && viewer.cash >= 30
        ? el("button", {
            className: "btn",
            text: "🏦 Repay Spring Loan (-30d)",
            onClick: () => sendGameAction({ type: "cleanup_repay_loan", loanType: "spring" }),
          })
        : null,
      gs.season === "Fall" && viewer.loans.spring && viewer.cash >= 45
        ? el("button", {
            className: "btn",
            text: "🏦 Repay Spring Loan (-45d)",
            onClick: () => sendGameAction({ type: "cleanup_repay_loan", loanType: "spring" }),
          })
        : null,
      gs.season === "Fall" && viewer.loans.summer && viewer.cash >= 60
        ? el("button", {
            className: "btn",
            text: "🏦 Repay Summer Loan (-60d)",
            onClick: () => sendGameAction({ type: "cleanup_repay_loan", loanType: "summer" }),
          })
        : null
    ),
    viewer.guards.length > 0
      ? el(
          "div",
          { style: { marginBottom: "0.9rem" } },
          el("div", { style: { fontWeight: "700", marginBottom: "0.4rem" }, text: "Select Guards to Retain (Pay Seasonal Upkeep):" }),
          ...viewer.guards.map((g) => {
            const keep = appState.cleanupKeepGuards.has(g.id);
            return el(
              "label",
              { style: { display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.3rem", cursor: "pointer" } },
              el("input", {
                type: "checkbox",
                checked: keep,
                onChange: (e) => {
                  if (e.target.checked) appState.cleanupKeepGuards.add(g.id);
                  else appState.cleanupKeepGuards.delete(g.id);
                },
              }),
              el("span", { text: `${g.name} (${g.combatText}) — Upkeep: ${g.upkeepCost}(d)` })
            );
          })
        )
      : null,
    gs.season === "Fall"
      ? el(
          "label",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              marginBottom: "0.85rem",
              cursor: "pointer",
              fontSize: "0.86rem",
            },
          },
          el("input", {
            type: "checkbox",
            checked:
              appState.cleanupAllowWinterPvpInfluence !== undefined
                ? Boolean(appState.cleanupAllowWinterPvpInfluence)
                : viewer.allowWinterPvpInfluence !== false,
            onChange: (e) => {
              appState.cleanupAllowWinterPvpInfluence = Boolean(e.target.checked);
            },
          }),
          el("span", {
            text: "⚔️ Authorize Combat Influence cards in Winter Reckoning PvP Tie-Breakers (uncheck to save cards)",
          })
        )
      : null,
    el("button", {
      className: "btn btn-crimson",
      text:
        gs.season === "Fall"
          ? "✓ Complete Clean-Up & Enter December 211 Winter Reckoning"
          : "✓ Complete Clean-Up & Advance to Next Season",
      onClick: () =>
        sendGameAction({
          type: "cleanup_finish",
          keepGuardIds: Array.from(appState.cleanupKeepGuards),
          allowWinterPvpInfluence:
            appState.cleanupAllowWinterPvpInfluence !== undefined
              ? Boolean(appState.cleanupAllowWinterPvpInfluence)
              : viewer.allowWinterPvpInfluence !== false,
        }),
    })
  );
}

function renderGoodPriceTableNode(card, trackName, colIndex, isPriceIdxDirect = false) {
  const activePriceIdx = isPriceIdxDirect
    ? Math.max(0, Math.min(4, Number(colIndex) || 2))
    : colIndex === 0
    ? 0
    : colIndex === 1
    ? 1
    : colIndex <= 3
    ? 2
    : colIndex === 4
    ? 3
    : 4;
  const symHeaders = ["<<", "<", "=", ">", ">>"];
  const sellArr = Array.isArray(card.sell) && card.sell.length >= 5 ? card.sell : null;
  const buyArr = Array.isArray(card.buy) && card.buy.length >= 5 && !card.isMissionCargo ? card.buy : null;

  return el(
    "table",
    { className: "good-price-table" },
    el(
      "tbody",
      {},
      el(
        "tr",
        { className: "scarcity-sym-row" },
        el("th", { className: "price-corner-empty", text: "" }),
        ...symHeaders.map((sym, idx) =>
          el("th", {
            className: `sym-col-${idx} ${idx === activePriceIdx ? "active-price-cell" : ""}`,
            text: sym,
          })
        )
      ),
      sellArr
        ? el(
            "tr",
            {},
            el(
              "th",
              { className: "price-row-label price-row-label-sell" },
              createSellPriceSymbolNode(Boolean(card.isMissionCargo))
            ),
            ...sellArr.slice(0, 5).map((val, idx) =>
              el("td", {
                className: `${idx === 2 ? "price-eq-col" : ""} ${idx === activePriceIdx ? "active-price-cell" : ""}`,
                text: String(val),
              })
            )
          )
        : null,
      buyArr
        ? el(
            "tr",
            {},
            el(
              "th",
              { className: "price-row-label price-row-label-buy" },
              createBuyPriceSymbolNode(trackName === "Guards")
            ),
            ...buyArr.slice(0, 5).map((val, idx) =>
              el("td", {
                className: `${idx === 2 ? "price-eq-col" : ""} ${idx === activePriceIdx ? "active-price-cell" : ""}`,
                text: String(val),
              })
            )
          )
        : null
    )
  );
}

function openCartGoodDetailModal(item, gs, viewer, readOnly = false) {
  if (!item) return;
  const trackName = item.track || item.category || "Grain";
  const trackClass = resolveGoodTrackClass(item);
  const blocksCount = Math.max(1, Number(item.blocks) || 1);
  const blocksSymbols = "■".repeat(blocksCount);
  const meta = (gs && gs.marketMeta && gs.marketMeta[trackName]) || {
    scarcityIndex: 2,
    scarcityLabel: "Uncommon (=)",
    scarcitySymbol: "=",
  };
  const activeScarcityIdx = typeof meta.scarcityIndex === "number" ? meta.scarcityIndex : 2;
  const scarcitySymbols = ["<<", "<", "=", ">", ">>"];

  const subtitleText = item.isMissionCargo
    ? `Mission Cargo → ${item.deliverCell || "Rome"}`
    : item.subtitle
    ? `(${item.subtitle})`
    : item.subcategory || item.category || trackName;

  let combatLineText = null;
  if (trackName === "Weapons") {
    combatLineText = item.combatText || "0 CP";
  } else if (item.combatText) {
    combatLineText = item.combatText;
  }

  const sellArr = Array.isArray(item.sell) && item.sell.length >= 5 ? item.sell.slice(0, 5) : null;
  const buyArr = Array.isArray(item.buy) && item.buy.length >= 5 ? item.buy.slice(0, 5) : null;
  const hasSellTable = Boolean(sellArr);
  const currentScarcitySellPrice =
    sellArr && sellArr[activeScarcityIdx] !== undefined ? Number(sellArr[activeScarcityIdx]) : null;
  const sellOpt = Array.isArray(item.availableSells) && item.availableSells.length > 0 ? item.availableSells[0] : null;
  const canSellNow = Boolean(
    !readOnly && sellOpt && gs && gs.phase === "delivery" && viewer && gs.activePlayerIndex === viewer.index
  );
  const hasPaidCost = !item.isMissionCargo && typeof item.purchasePrice === "number";
  const refSellPrice =
    sellOpt && !sellOpt.isFencedCargo
      ? Number(sellOpt.price)
      : currentScarcitySellPrice !== null
      ? currentScarcitySellPrice
      : null;
  const netProfit = hasPaidCost && refSellPrice !== null ? refSellPrice - Number(item.purchasePrice) : null;

  const fullCardNode = el(
    "div",
    { className: "cart-good-detail-showcase" },
    el(
      "div",
      { className: `market-good-card ${trackClass} cart-good-detail-card` },
      el(
        "div",
        { className: "market-good-card-inner" },
        el(
          "div",
          { className: "good-card-header" },
          el("div", { className: "slot-card-name", text: item.name }),
          el("div", { className: "slot-sub", text: subtitleText }),
          combatLineText ? el("div", { className: "good-combat-line", text: combatLineText }) : null
        ),
        renderGoodCardArtNode(item, trackName),
        el(
          "div",
          { className: "good-card-footer" },
          el("div", {
            className: "good-blocks-row",
            title: `Weight: ${blocksCount}■ of Cart Capacity`,
            text: blocksSymbols,
          }),
          hasSellTable
            ? renderGoodPriceTableNode(item, trackName, activeScarcityIdx, false)
            : el("div", {
                className: "mission-cargo-no-sell-note",
                text: `Deliver @ ${item.deliverCell || "Target"}`,
              })
        )
      )
    )
  );

  const infoRows = [
    el(
      "div",
      { className: "cart-good-detail-row" },
      el("span", { className: "cart-good-detail-label", text: "Category & Weight:" }),
      el("strong", {
        text: `${item.isMissionCargo ? `Mission Cargo (${trackName})` : trackName} • ${blocksCount}■ (${blocksSymbols})`,
      })
    ),
  ];

  if (!item.isMissionCargo && currentScarcitySellPrice !== null) {
    infoRows.push(
      el(
        "div",
        { className: "cart-good-detail-row" },
        el("span", { className: "cart-good-detail-label", text: "Current Market Scarcity:" }),
        el("strong", {
          style: { color: "var(--gold-bright)" },
          text: `${meta.scarcityLabel || scarcitySymbols[activeScarcityIdx]} — Base Sell Value: ${currentScarcitySellPrice}(d)`,
        })
      )
    );
  } else if (item.isMissionCargo) {
    infoRows.push(
      el(
        "div",
        { className: "cart-good-detail-row" },
        el("span", { className: "cart-good-detail-label", text: "Mission Delivery Target:" }),
        el("strong", {
          style: { color: "var(--gold-bright)" },
          text: `Deliver to ${item.deliverCell || "Target"}${
            currentScarcitySellPrice !== null ? ` (Fence @ ${meta.scarcitySymbol || "="}: ${currentScarcitySellPrice}(d))` : ""
          }`,
        })
      )
    );
  }

  if (sellArr) {
    infoRows.push(
      el(
        "div",
        { className: "cart-good-detail-row" },
        el("span", {
          className: "cart-good-detail-label",
          text: item.isMissionCargo ? "Fence Values (<< to >>):" : "Sell Values (<< to >>):",
        }),
        el("span", {
          style: { fontWeight: "700" },
          text: sellArr.map((v, idx) => `${scarcitySymbols[idx]} ${v}(d)`).join(" • "),
        })
      )
    );
  }

  if (buyArr && !item.isMissionCargo) {
    infoRows.push(
      el(
        "div",
        { className: "cart-good-detail-row" },
        el("span", { className: "cart-good-detail-label", text: "Buy Values (<< to >>):" }),
        el("span", {
          text: buyArr.map((v, idx) => `${scarcitySymbols[idx]} ${v}(d)`).join(" • "),
        })
      )
    );
  }

  if (hasPaidCost) {
    infoRows.push(
      el(
        "div",
        { className: "cart-good-detail-row" },
        el("span", { className: "cart-good-detail-label", text: "Purchase Price Paid:" }),
        el(
          "strong",
          {},
          el("span", { text: `${item.purchasePrice}(d)` }),
          netProfit !== null
            ? el("span", {
                style: { color: netProfit >= 0 ? "#15803d" : "#b91c1c", marginLeft: "0.35rem" },
                text: `(${netProfit >= 0 ? `+${netProfit}` : netProfit}(d) net at ${
                  sellOpt ? sellOpt.scarcitySymbol || "=" : meta.scarcitySymbol || "="
                })`,
              })
            : null
        )
      )
    );
  }

  if (combatLineText) {
    infoRows.push(
      el(
        "div",
        { className: "cart-good-detail-row" },
        el("span", { className: "cart-good-detail-label", text: "Combat / Effect:" }),
        el("strong", { text: combatLineText })
      )
    );
  }

  const actionBtns = [];
  if (canSellNow && sellOpt) {
    actionBtns.push(
      el("button", {
        type: "button",
        className: `btn ${sellOpt.isFencedCargo ? "btn-crimson" : "btn-primary"}`,
        disabled: viewer.transactedThisTurn,
        text: sellOpt.isFencedCargo
          ? `🕵️ Fence for ${sellOpt.price}(d)`
          : `💰 Sell for ${sellOpt.price}(d) (${sellOpt.scarcitySymbol || "="})`,
        onClick: () => {
          closeModal();
          sendGameAction({
            type: "delivery_sell",
            category: sellOpt.category,
            cardIds: [item.id],
            missionId: sellOpt.missionId || undefined,
          });
        },
      })
    );
  }
  actionBtns.push(
    el("button", {
      type: "button",
      className: "btn btn-primary",
      text: "Close",
      onClick: () => closeModal(),
    })
  );

  const modalBody = el(
    "div",
    { className: "cart-good-detail-modal" },
    fullCardNode,
    el("div", { className: "cart-good-detail-summary" }, ...infoRows),
    el(
      "div",
      { style: { display: "flex", justifyContent: "flex-end", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.4rem" } },
      ...actionBtns
    )
  );

  showModal(`📦 ${item.name} — Cargo Details & Value`, modalBody);
}

function openCartGuardDetailModal(g) {
  if (!g) return;
  const guardsCount = Math.max(1, Number(g.guards) || 1);
  const blocksSymbols = "▲".repeat(guardsCount);
  const combatLineText = `${g.combatText || ""}${g.abilityText ? ` & ${g.abilityText}` : ""}`;
  const buyArr = Array.isArray(g.buy) && g.buy.length >= 5 ? g.buy.slice(0, 5) : null;
  const scarcitySymbols = ["<<", "<", "=", ">", ">>"];

  const fullCardNode = el(
    "div",
    { className: "cart-good-detail-showcase" },
    el(
      "div",
      { className: "market-good-card good-track-guards cart-good-detail-card" },
      el(
        "div",
        { className: "market-good-card-inner" },
        el(
          "div",
          { className: "good-card-header" },
          el("div", { className: "slot-card-name", text: g.name }),
          el("div", { className: "slot-sub", text: "Guard" }),
          combatLineText ? el("div", { className: "good-combat-line", text: combatLineText }) : null
        ),
        renderGoodCardArtNode(g, "Guards"),
        el(
          "div",
          { className: "good-card-footer" },
          el("div", { className: "good-blocks-row", title: `Guard Seat: ${guardsCount}▲`, text: blocksSymbols }),
          buyArr ? renderGoodPriceTableNode(g, "Guards", 2, false) : null
        )
      )
    )
  );

  const infoRows = [
    el(
      "div",
      { className: "cart-good-detail-row" },
      el("span", { className: "cart-good-detail-label", text: "Guard Seats Occupied:" }),
      el("strong", { text: `${guardsCount}▲ (${blocksSymbols})` })
    ),
    el(
      "div",
      { className: "cart-good-detail-row" },
      el("span", { className: "cart-good-detail-label", text: "Seasonal Upkeep Cost:" }),
      el("strong", { style: { color: "var(--gold-bright)" }, text: `${g.upkeepCost ?? 0}(d)` })
    ),
  ];
  if (combatLineText) {
    infoRows.push(
      el(
        "div",
        { className: "cart-good-detail-row" },
        el("span", { className: "cart-good-detail-label", text: "Combat & Special Ability:" }),
        el("strong", { text: combatLineText })
      )
    );
  }
  if (buyArr) {
    infoRows.push(
      el(
        "div",
        { className: "cart-good-detail-row" },
        el("span", { className: "cart-good-detail-label", text: "Hire Costs (<< to >>):" }),
        el("span", { text: buyArr.map((v, idx) => `${scarcitySymbols[idx]} ${v}(d)`).join(" • ") })
      )
    );
  }

  const modalBody = el(
    "div",
    { className: "cart-good-detail-modal" },
    fullCardNode,
    el("div", { className: "cart-good-detail-summary" }, ...infoRows),
    el(
      "div",
      { style: { display: "flex", justifyContent: "flex-end", marginTop: "0.4rem" } },
      el("button", { type: "button", className: "btn btn-primary", text: "Close", onClick: () => closeModal() })
    )
  );

  showModal(`🛡️ ${g.name} — Guard Details`, modalBody);
}

function renderLoadedGoodPhysicalCardNode(item, gs, viewer, readOnly = false) {
  const trackName = item.track || item.category || "Grain";
  const trackClass = resolveGoodTrackClass(item);
  const blocksCount = Math.max(1, Number(item.blocks) || 1);
  const blocksSymbols = "■".repeat(blocksCount);
  const meta = (gs.marketMeta && gs.marketMeta[trackName]) || { scarcityIndex: 2 };
  const activeScarcityIdx = typeof meta.scarcityIndex === "number" ? meta.scarcityIndex : 2;

  const subtitleText = item.isMissionCargo
    ? `Mission Cargo → ${item.deliverCell || "Rome"}`
    : item.subtitle
    ? `(${item.subtitle})`
    : item.subcategory || item.category || trackName;

  let combatLineText = null;
  if (trackName === "Weapons") {
    combatLineText = item.combatText || "0 CP";
  } else if (item.combatText) {
    combatLineText = item.combatText;
  }

  const hasSellTable = Array.isArray(item.sell) && item.sell.length >= 5;
  const sellOpt = Array.isArray(item.availableSells) && item.availableSells.length > 0 ? item.availableSells[0] : null;
  const canSellNow = Boolean(!readOnly && sellOpt && gs.phase === "delivery" && gs.activePlayerIndex === viewer.index);
  const hasPaidCost = !item.isMissionCargo && typeof item.purchasePrice === "number";
  const netProfit =
    hasPaidCost && sellOpt && !sellOpt.isFencedCargo
      ? Number(sellOpt.price) - Number(item.purchasePrice)
      : null;

  const openDetail = () => openCartGoodDetailModal(item, gs, viewer, readOnly);

  const cardFace = el(
    "div",
    {
      className: `market-good-card ${trackClass} loaded-good-phys-card is-clickable-cart-card`,
      role: "button",
      tabIndex: "0",
      title: `Click to view ${item.name} details & sell values`,
      onClick: openDetail,
      onKeyDown: (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openDetail();
        }
      },
    },
    el(
      "div",
      { className: "market-good-card-inner" },
      el(
        "div",
        { className: "good-card-header" },
        el("div", { className: "slot-card-name", text: item.name }),
        el("div", { className: "slot-sub", text: subtitleText }),
        combatLineText ? el("div", { className: "good-combat-line", text: combatLineText }) : null
      ),
      renderGoodCardArtNode(item, trackName),
      el(
        "div",
        { className: "good-card-footer" },
        el("div", { className: "good-blocks-row", title: `Weight: ${blocksCount}■ of Cart Capacity`, text: blocksSymbols }),
        hasSellTable
          ? renderGoodPriceTableNode(item, trackName, activeScarcityIdx, true)
          : el("div", {
              className: "mission-cargo-no-sell-note",
              text: `Deliver @ ${item.deliverCell || "Target"}`,
            })
      )
    )
  );

  const externalMetaNodes = [];
  if (hasPaidCost) {
    externalMetaNodes.push(
      el(
        "div",
        { className: "cost-basis-pill", title: "Purchase price paid for this Good" },
        el("span", { text: `Paid ${item.purchasePrice}d` }),
        netProfit !== null
          ? el("span", {
              className: netProfit >= 0 ? "profit-pos" : "profit-neg",
              text: ` • Net ${netProfit >= 0 ? `+${netProfit}` : netProfit}d`,
            })
          : null
      )
    );
  }
  if (canSellNow) {
    externalMetaNodes.push(
      el("button", {
        type: "button",
        className: `btn btn-sm ${sellOpt.isFencedCargo ? "btn-crimson" : "btn-primary"}`,
        style: { width: "100%", padding: "0.18rem 0.3rem", fontSize: "0.7rem" },
        disabled: viewer.transactedThisTurn,
        title: sellOpt.isFencedCargo
          ? hasActiveClimateOption(gs, "plautilla_3")
            ? "Smuggler's Fence: Sells 1 Scarcity step higher & does NOT count as a Failed Mission (Patron Hostile Favor still applies)!"
            : "Fencing this Mission Cargo sells it for cash but immediately FAILS the Mission!"
          : `Sell ${item.name} in ${viewer.position}`,
        text: sellOpt.isFencedCargo
          ? `🕵️ Fence (${sellOpt.price}d)`
          : `💰 Sell (${sellOpt.price}d @ ${sellOpt.scarcitySymbol || "="})`,
        onClick: () =>
          sendGameAction({
            type: "delivery_sell",
            category: sellOpt.category,
            cardIds: [item.id],
            missionId: sellOpt.missionId || undefined,
          }),
      })
    );
    if (
      sellOpt.category === "Grain" &&
      !sellOpt.isFencedCargo &&
      Number(sellOpt.bulkGrainCount) >= 2 &&
      Array.isArray(sellOpt.bulkGrainCardIds)
    ) {
      externalMetaNodes.push(
        el("button", {
          type: "button",
          className: "btn btn-sm btn-primary",
          style: { width: "100%", padding: "0.16rem 0.26rem", fontSize: "0.66rem" },
          disabled: viewer.transactedThisTurn,
          title: `Bulk Grain Sale: Spend 1 hourly Transaction to sell all ${sellOpt.bulkGrainCount} Grain cards in your Cart for ${sellOpt.bulkGrainTotalPrice} Denarii total!`,
          text: `🌾 Bulk All ${sellOpt.bulkGrainCount} (${sellOpt.bulkGrainTotalPrice}d)`,
          onClick: () =>
            sendGameAction({
              type: "delivery_sell",
              category: "Grain",
              bulkGrain: true,
              cardIds: sellOpt.bulkGrainCardIds,
              missionId: sellOpt.missionId || undefined,
            }),
        })
      );
    }
    if (Array.isArray(sellOpt.amethystBoostOptions) && sellOpt.amethystBoostOptions.length > 0 && !viewer.transactedThisTurn) {
      const boost = sellOpt.amethystBoostOptions[sellOpt.amethystBoostOptions.length - 1];
      externalMetaNodes.push(
        el("button", {
          type: "button",
          className: "btn btn-sm amethyst-boost-btn",
          style: { width: "100%", padding: "0.15rem 0.24rem", fontSize: "0.64rem" },
          title: `Senatorial Privilege: Spend ${boost.spend} Amethyst${
            boost.spend > 1 ? "s" : ""
          } (Aurelius Favor) to boost sale to ${boost.scarcitySymbol} (${boost.price}d)`,
          text: `🔮 -${boost.spend} Amethyst → ${boost.price}d (${boost.scarcitySymbol})`,
          onClick: () =>
            sendGameAction({
              type: "delivery_sell",
              category: sellOpt.category,
              cardIds: [item.id],
              missionId: sellOpt.missionId || undefined,
              spendAmethysts: boost.spend,
            }),
        })
      );
    }
  }

  return el(
    "div",
    { className: "good-card-unit" },
    cardFace,
    externalMetaNodes.length > 0 ? el("div", { className: "good-card-external-meta" }, ...externalMetaNodes) : null
  );
}

function renderHiredGuardPhysicalCardNode(g) {
  const guardsCount = Math.max(1, Number(g.guards) || 1);
  const blocksSymbols = "▲".repeat(guardsCount);
  const combatLineText = `${g.combatText || ""}${g.abilityText ? ` & ${g.abilityText}` : ""}`;
  const hasHireTable = Array.isArray(g.buy) && g.buy.length >= 5;
  const openDetail = () => openCartGuardDetailModal(g);

  const cardFace = el(
    "div",
    {
      className: "market-good-card good-track-guards loaded-good-phys-card is-clickable-cart-card",
      role: "button",
      tabIndex: "0",
      title: `Click to view ${g.name} details & upkeep`,
      onClick: openDetail,
      onKeyDown: (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openDetail();
        }
      },
    },
    el(
      "div",
      { className: "market-good-card-inner" },
      el(
        "div",
        { className: "good-card-header" },
        el("div", { className: "slot-card-name", text: g.name }),
        el("div", { className: "slot-sub", text: "Guard" }),
        combatLineText ? el("div", { className: "good-combat-line", text: combatLineText }) : null
      ),
      renderGoodCardArtNode(g, "Guards"),
      el(
        "div",
        { className: "good-card-footer" },
        el("div", { className: "good-blocks-row", title: `Guard Seat: ${guardsCount}▲`, text: blocksSymbols }),
        hasHireTable ? renderGoodPriceTableNode(g, "Guards", 2, true) : null
      )
    )
  );

  return el(
    "div",
    { className: "good-card-unit" },
    cardFace,
    el(
      "div",
      { className: "good-card-external-meta" },
      el("div", {
        className: "guard-upkeep-pill",
        text: `Upkeep: ${g.upkeepCost ?? 0}(d)`,
      })
    )
  );
}

function renderPhysicalCartMatNode(gs, targetPlayer, viewer, readOnly = false) {
  const swatchColor = resolveDieSwatchColor(targetPlayer.color, "player");
  const cartItems = targetPlayer.cart || [];
  const guardItems = targetPlayer.guards || [];
  const maxGuards = Math.max(2, Number(targetPlayer.maxGuards) || 2);
  const usedGuards = Number(targetPlayer.usedGuards) || 0;
  const maxBlocks = Math.max(6, Number(targetPlayer.maxBlocks) || 6);
  const usedBlocks = Number(targetPlayer.usedBlocks) || 0;

  // Left-hand side: 2 vertically aligned Guard card seats (extends downward if >2 Guard seats or cards)
  const totalGuardRows = Math.max(2, maxGuards, guardItems.length);
  const guardSlotNodes = [];
  for (let i = 0; i < totalGuardRows; i++) {
    const g = guardItems[i];
    if (g) {
      guardSlotNodes.push(
        el(
          "div",
          {
            className: "cart-mat-occupied-slot",
            style: { gridColumn: "1", gridRow: `${i + 1} / span 1` },
          },
          renderHiredGuardPhysicalCardNode(g)
        )
      );
    } else {
      const isBonusGuardSlot = i >= 2;
      guardSlotNodes.push(
        el(
          "div",
          {
            className: `cart-mat-empty-slot guard-empty-slot${isBonusGuardSlot ? " bonus-empty-slot" : ""}`,
            style: { gridColumn: "1", gridRow: `${i + 1} / span 1` },
            title: isBonusGuardSlot ? `Bonus Guard Seat ${i + 1}` : `Guard Seat ${i + 1}`,
          },
          el("span", { className: "cart-mat-empty-symbol", text: "▲" }),
          el("span", {
            className: "cart-mat-empty-text",
            text: isBonusGuardSlot ? `Seat ${i + 1}` : `Seat ${i + 1}`,
          })
        )
      );
    }
  }

  // Right-hand side: 2x3 = 6 Goods card spaces (1 card per space regardless of ■ weight; extends by 3-card rows if >6 cards)
  const numCols = 3;
  const numRows = Math.max(2, Math.ceil(cartItems.length / numCols));
  const totalCardSpaces = numRows * numCols;
  const goodSlotNodes = [];

  for (let i = 0; i < totalCardSpaces; i++) {
    const r = Math.floor(i / numCols);
    const c = i % numCols;
    const item = cartItems[i];
    if (item) {
      goodSlotNodes.push(
        el(
          "div",
          {
            className: "cart-mat-occupied-slot",
            style: {
              gridRow: `${r + 1} / span 1`,
              gridColumn: `${c + 1} / span 1`,
            },
          },
          renderLoadedGoodPhysicalCardNode(item, gs, viewer, readOnly)
        )
      );
    } else {
      const isExtraRowSlot = i >= 6;
      goodSlotNodes.push(
        el("div", {
          className: `cart-mat-empty-slot${isExtraRowSlot ? " bonus-empty-slot" : ""}`,
          style: {
            gridRow: `${r + 1} / span 1`,
            gridColumn: `${c + 1} / span 1`,
          },
        })
      );
    }
  }

  const isExtendedMat = totalGuardRows > 2 || numRows > 2;

  return el(
    "div",
    {
      className: `physical-cart-mat${isExtendedMat ? " is-extended" : ""}`,
      style: { "--cart-trim-color": swatchColor },
    },
    el(
      "div",
      { className: "physical-cart-mat-inner" },
      el(
        "div",
        { className: "cart-mat-zone" },
        el(
          "div",
          { className: "cart-mat-zone-label" },
          el("span", { text: "🛡️ Guards" }),
          el("span", { text: `${usedGuards}/${maxGuards}▲` })
        ),
        el("div", { className: "cart-mat-guards-grid" }, ...guardSlotNodes)
      ),
      el(
        "div",
        { className: "cart-mat-zone" },
        el(
          "div",
          { className: "cart-mat-zone-label" },
          el("span", { text: "📦 Wagon Cargo" }),
          el("span", { text: `${usedBlocks}/${maxBlocks}■` })
        ),
        el("div", { className: "cart-mat-goods-grid" }, ...goodSlotNodes)
      )
    )
  );
}

function openFactionFavorModal(gs, targetPlayer, factionKey) {
  if (!targetPlayer) return;
  const fm = FACTION_META.find((f) => f.key === factionKey) || FACTION_META[0];
  const val = (targetPlayer.favor && targetPlayer.favor[fm.key]) || 0;
  const rawHistory =
    targetPlayer.favorHistory && Array.isArray(targetPlayer.favorHistory[fm.key])
      ? targetPlayer.favorHistory[fm.key]
      : [];

  const historyParts = rawHistory.map((entry) => {
    const d = Number(entry.delta) || 0;
    const absD = Math.abs(d) || 1;
    const gemWord = absD === 1 ? fm.gemSingular : fm.gemPlural;
    const signStr = d >= 0 ? `+${absD}` : `-${absD}`;
    return `${signStr} ${gemWord} from ${entry.reason || "encounter / mission"}`;
  });

  const valStr = val > 0 ? `+${val}` : String(val);
  let summarySentence = "";
  if (historyParts.length > 0) {
    summarySentence = `${valStr} ${fm.key} favor: ${historyParts.join(", ")}`;
  } else if (val !== 0) {
    const absV = Math.abs(val);
    const gemWord = absV === 1 ? fm.gemSingular : fm.gemPlural;
    summarySentence = `${valStr} ${fm.key} favor: ${val > 0 ? `+${absV}` : `-${absV}`} ${gemWord} recorded prior to ledger`;
  } else {
    summarySentence = `0 ${fm.key} favor: No ${fm.key} ${fm.gemPlural} gained or negated yet this game`;
  }

  const deckCounts =
    (gs && gs.factionDeckCounts && gs.factionDeckCounts[fm.key]) ||
    fm.defaultDeckCounts || { patricii: 0, legiones: 0, nefarii: 0, total: 0 };
  const totalCards =
    deckCounts.total !== undefined
      ? deckCounts.total
      : (Number(deckCounts.patricii) || 0) + (Number(deckCounts.legiones) || 0) + (Number(deckCounts.nefarii) || 0);

  const body = el(
    "div",
    { style: { display: "flex", flexDirection: "column", gap: "0.9rem" } },
    // Quick Faction Switcher Tabs
    el(
      "div",
      { style: { display: "flex", gap: "0.4rem", flexWrap: "wrap" } },
      ...FACTION_META.map((tabFm) => {
        const tVal = (targetPlayer.favor && targetPlayer.favor[tabFm.key]) || 0;
        const isCurrent = tabFm.key === fm.key;
        return el(
          "button",
          {
            type: "button",
            className: `btn btn-sm ${isCurrent ? "btn-primary" : ""}`,
            style: {
              display: "inline-flex",
              alignItems: "center",
              gap: "0.3rem",
              borderColor: isCurrent ? tabFm.color : "var(--border-subtle)",
            },
            onClick: () => openFactionFavorModal(gs, targetPlayer, tabFm.key),
          },
          el("img", { src: tabFm.gem, alt: tabFm.key, style: { width: "14px", height: "14px", objectFit: "contain" } }),
          el("span", { text: `${tabFm.key} (${tVal > 0 ? `+${tVal}` : tVal})` })
        );
      })
    ),
    // Header Banner
    el(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
          padding: "0.75rem 0.9rem",
          borderRadius: "4px",
          background: "#fbf7ee",
          border: `1.5px solid ${fm.color}`,
          boxShadow: "var(--bevel-sunken)",
        },
      },
      el(
        "div",
        { style: { display: "flex", alignItems: "center", gap: "0.65rem" } },
        el("img", { src: fm.gem, alt: fm.key, style: { width: "36px", height: "36px", objectFit: "contain" } }),
        el(
          "div",
          {},
          el("div", {
            style: { fontFamily: "Cinzel, Georgia, serif", fontSize: "1.05rem", fontWeight: "800", color: fm.color },
            text: `${fm.key} — ${fm.title}`,
          }),
          el("div", {
            style: { fontSize: "0.76rem", color: "var(--text-muted)" },
            text: `Faction Gem: ${fm.gemSingular.toUpperCase()} • Favor: Uncapped (±5 or more)`,
          })
        )
      ),
      el(
        "div",
        {
          style: {
            textAlign: "right",
            padding: "0.3rem 0.7rem",
            borderRadius: "4px",
            background: "#f3ead8",
            border: "1px solid var(--border-subtle)",
          },
        },
        el("div", {
          style: {
            fontSize: "1.3rem",
            fontWeight: "800",
            color: val > 0 ? "#15803d" : val < 0 ? "#b91c1c" : "var(--gold-bright)",
          },
          text: valStr,
        }),
        el("div", { style: { fontSize: "0.68rem", color: "var(--text-muted)" }, text: "Current Favor" })
      )
    ),
    fm.key === "Domna" &&
      gs &&
      Array.isArray(gs.players) &&
      targetPlayer.index === (typeof gs.viewerPlayerIndex === "number" ? gs.viewerPlayerIndex : 0)
      ? renderDomnaMediatorExchangeBar(gs, targetPlayer, true)
      : null,
    // Section 1: Exact Favor Breakdown
    el(
      "div",
      {
        style: {
          padding: "0.75rem 0.9rem",
          borderRadius: "4px",
          background: "#fdfaf2",
          border: "1.5px solid #c29b61",
          boxShadow: "var(--bevel-sunken)",
        },
      },
      el("div", {
        style: { fontFamily: "Cinzel, Georgia, serif", fontSize: "0.86rem", fontWeight: "800", color: "var(--gold-bright)", marginBottom: "0.35rem" },
        text: `📊 ${targetPlayer.name}'s ${fm.key} Favor Breakdown`,
      }),
      el("div", {
        style: { fontSize: "0.88rem", fontWeight: "700", color: "var(--text-main)", lineHeight: "1.45" },
        text: summarySentence,
      }),
      rawHistory.length > 0
        ? el(
            "div",
            { style: { marginTop: "0.55rem", display: "flex", flexDirection: "column", gap: "0.3rem" } },
            ...(() => {
              let running = 0;
              return rawHistory.map((entry, idx) => {
                const d = Number(entry.delta) || 0;
                running += d;
                const tot = entry.newTotal !== undefined ? Number(entry.newTotal) : running;
                const absD = Math.abs(d) || 1;
                const gemWord = absD === 1 ? fm.gemSingular : fm.gemPlural;
                return el(
                  "div",
                  {
                    style: {
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      fontSize: "0.78rem",
                      padding: "0.28rem 0.5rem",
                      borderRadius: "4px",
                      background: d >= 0 ? "#f0fdf4" : "#fef2f2",
                      border: d >= 0 ? "1px solid #86efac" : "1px solid #fca5a5",
                    },
                  },
                  el(
                    "span",
                    { style: { color: d >= 0 ? "#14532d" : "#7f1d1d", fontWeight: "700" } },
                    `${idx + 1}. ${d >= 0 ? `+${absD}` : `-${absD}`} ${gemWord} — ${entry.reason || "Encounter / Mission"}`
                  ),
                  el("span", {
                    style: { color: "var(--text-muted)", fontSize: "0.72rem", flexShrink: "0", marginLeft: "0.5rem" },
                    text: `→ Favor: ${tot > 0 ? `+${tot}` : tot}`,
                  })
                );
              });
            })()
          )
        : null
    ),
    // Section 2: Faction Lore & Alignments
    el(
      "div",
      {
        style: {
          padding: "0.75rem 0.9rem",
          borderRadius: "4px",
          background: "#fbf7ee",
          border: "1px solid var(--border-subtle)",
          boxShadow: "var(--bevel-sunken)",
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
        },
      },
      el("div", {
        style: { fontFamily: "Cinzel, Georgia, serif", fontSize: "0.86rem", fontWeight: "800", color: "var(--gold-bright)" },
        text: "🏛️ Faction Description & Imperial Alignments",
      }),
      el("p", { style: { margin: "0", fontSize: "0.84rem", color: "var(--text-main)", lineHeight: "1.48" }, text: fm.bio }),
      el(
        "div",
        { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.55rem", marginTop: "0.2rem" } },
        el(
          "div",
          {
            style: {
              padding: "0.45rem 0.6rem",
              borderRadius: "4px",
              background: "#f0fdf4",
              border: "1px solid #86efac",
            },
          },
          el("div", { style: { fontSize: "0.72rem", fontWeight: "800", color: "#15803d", marginBottom: "0.2rem" }, text: "🤝 Aligned With (Allied)" }),
          el("div", { style: { fontSize: "0.82rem", fontWeight: "700", color: "#14532d" }, text: (fm.alignedWith || []).join(", ") || "None" })
        ),
        el(
          "div",
          {
            style: {
              padding: "0.45rem 0.6rem",
              borderRadius: "4px",
              background: "#fef2f2",
              border: "1px solid #fca5a5",
            },
          },
          el("div", { style: { fontSize: "0.72rem", fontWeight: "800", color: "#b91c1c", marginBottom: "0.2rem" }, text: "⚔️ Hostile / Averse To" }),
          el("div", { style: { fontSize: "0.82rem", fontWeight: "700", color: "#7f1d1d" }, text: (fm.hostileTo || []).join(", ") || "None" })
        )
      ),
      el("div", {
        style: { fontSize: "0.78rem", color: "var(--text-muted)", fontStyle: "italic" },
        text: fm.alignmentNote || "",
      })
    ),
    // Section 3: Total Aligned Cards in Each Encounter Deck
    el(
      "div",
      {
        style: {
          padding: "0.75rem 0.9rem",
          borderRadius: "4px",
          background: "#fbf7ee",
          border: "1px solid var(--border-subtle)",
          boxShadow: "var(--bevel-sunken)",
        },
      },
      el("div", {
        style: { fontFamily: "Cinzel, Georgia, serif", fontSize: "0.86rem", fontWeight: "800", color: "var(--gold-bright)", marginBottom: "0.45rem" },
        text: `🃏 Encounter Deck Cards Aligned to ${fm.key}`,
      }),
      el(
        "div",
        { style: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.5rem", textAlign: "center" } },
        el(
          "div",
          { className: "profile-stat-box", style: { borderColor: "#b45309" } },
          el("div", { className: "profile-stat-value", style: { fontSize: "1.1rem", color: "#8c5612" }, text: String(deckCounts.patricii ?? 0) }),
          el("div", { className: "profile-stat-label", text: "Patricii Deck" })
        ),
        el(
          "div",
          { className: "profile-stat-box", style: { borderColor: "#dc2626" } },
          el("div", { className: "profile-stat-value", style: { fontSize: "1.1rem", color: "#b91c1c" }, text: String(deckCounts.legiones ?? 0) }),
          el("div", { className: "profile-stat-label", text: "Legiones Deck" })
        ),
        el(
          "div",
          { className: "profile-stat-box", style: { borderColor: "#64748b" } },
          el("div", { className: "profile-stat-value", style: { fontSize: "1.1rem", color: "#334155" }, text: String(deckCounts.nefarii ?? 0) }),
          el("div", { className: "profile-stat-label", text: "Nefarii Deck" })
        ),
        el(
          "div",
          { className: "profile-stat-box", style: { borderColor: fm.color } },
          el("div", { className: "profile-stat-value", style: { fontSize: "1.1rem", color: fm.color }, text: String(totalCards) }),
          el("div", { className: "profile-stat-label", text: "Total Aligned" })
        )
      )
    ),
    el(
      "div",
      { style: { display: "flex", justifyContent: "flex-end" } },
      el("button", { type: "button", className: "btn btn-primary", text: "Close Faction View", onClick: closeModal })
    )
  );

  showModal(`💎 Imperial Faction Favor — ${fm.key}`, body);
}

function openPlayerCartModal(gs, targetPlayer, viewer) {
  if (!targetPlayer) return;
  const swatchColor = resolveDieSwatchColor(targetPlayer.color, "player");
  const colorLabel = getCartColorLabel(targetPlayer.color);
  const cartItems = targetPlayer.cart || [];
  const guardItems = targetPlayer.guards || [];
  const isViewer = viewer && targetPlayer.index === viewer.index;
  const mDone = Number(targetPlayer.missionsCompleted) || 0;
  const mFail = Number(targetPlayer.missionsFailed) || 0;
  const mNet =
    typeof targetPlayer.netMissions === "number" ? targetPlayer.netMissions : mDone - mFail;

  const node = el(
    "div",
    { className: "modal-card", style: { maxWidth: "740px" } },
    el(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
          borderBottom: `2px solid ${swatchColor}`,
          paddingBottom: "0.6rem",
          marginBottom: "0.75rem",
        },
      },
      el(
        "div",
        { style: { display: "flex", alignItems: "center", gap: "0.6rem" } },
        renderCartIconNode(targetPlayer.color, "cart-icon-lg", `${targetPlayer.name}'s Cart`),
        el(
          "div",
          {},
          el("h3", {
            style: { margin: "0", color: "var(--gold-bright)", fontSize: "1.15rem" },
            text: `${targetPlayer.name}'s Merchant Cart${isViewer ? " (You)" : ""}`,
          }),
          el("div", {
            style: { fontSize: "0.75rem", color: swatchColor, fontWeight: "700" },
            text: `${colorLabel} Cart • ${
              targetPlayer.position
                ? `📍 In Rome at ${targetPlayer.position}`
                : targetPlayer.exitedRome
                ? "✓ Exited Rome Safely"
                : "⚓ At Portus Ostiae"
            }`,
          })
        )
      ),
      el(
        "div",
        {
          className: "player-denarii-pill",
          style: {
            borderColor: swatchColor,
            color: swatchColor,
            fontSize: "1.05rem",
            padding: "0.35rem 0.75rem",
            cursor: "default",
          },
        },
        el("span", { text: `💰 ${targetPlayer.cash}(d)` })
      )
    ),
    el(
      "div",
      {
        style: {
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "0.5rem",
          marginBottom: "0.75rem",
          textAlign: "center",
        },
      },
      el(
        "div",
        { className: "profile-stat-box" },
        el("div", { className: "profile-stat-value", style: { fontSize: "1.05rem" }, text: `${targetPlayer.cash}(d)` }),
        el("div", { className: "profile-stat-label", text: "Denarii" })
      ),
      el(
        "div",
        { className: "profile-stat-box" },
        el(
          "div",
          { className: "profile-stat-value", style: { fontSize: "1.05rem" } },
          `${targetPlayer.usedBlocks}/${targetPlayer.maxBlocks} ■`
        ),
        el("div", { className: "profile-stat-label", text: `Goods (${cartItems.length})` })
      ),
      el(
        "div",
        { className: "profile-stat-box" },
        el(
          "div",
          { className: "profile-stat-value", style: { fontSize: "1.05rem" } },
          `${targetPlayer.usedGuards}/${targetPlayer.maxGuards} ▲`
        ),
        el("div", { className: "profile-stat-label", text: `Guards (${guardItems.length})` })
      ),
      el(
        "div",
        { className: "profile-stat-box" },
        el(
          "div",
          {
            className: "profile-stat-value",
            style: { fontSize: "1.05rem", color: mNet > 0 ? "#15803d" : mNet < 0 ? "#b91c1c" : "var(--gold-bright)" },
          },
          `${mNet >= 0 ? `+${mNet}` : mNet}`
        ),
        el("div", { className: "profile-stat-label", text: `Net Missions (✓${mDone}/✕${mFail})` })
      )
    ),
    el("div", {
      style: { fontSize: "0.76rem", color: "var(--text-muted)" },
      text: "Imperial Faction Standings (Uncapped) — Click a Gem for Details:",
    }),
    el(
      "div",
      { className: "favor-row", style: { marginBottom: "0.65rem" } },
      ...FACTION_META.map((fm) => {
        const val = (targetPlayer.favor && targetPlayer.favor[fm.key]) || 0;
        return el(
          "div",
          {
            className: "favor-box clickable-favor-box",
            style: { cursor: "pointer" },
            title: `Click to view ${fm.key} Favor breakdown, alignments & deck counts`,
            onClick: () => openFactionFavorModal(gs, targetPlayer, fm.key),
          },
          el("img", { className: "favor-gem-img", src: fm.gem, alt: fm.key }),
          el("div", { style: { fontWeight: "700", color: fm.color }, text: fm.key }),
          el("div", { style: { fontWeight: "700" }, text: val > 0 ? `+${val}` : String(val) })
        );
      })
    ),
    isViewer ? renderDomnaMediatorExchangeBar(gs, viewer, true) : null,
    renderPhysicalCartMatNode(gs, targetPlayer, viewer, true),
    el(
      "div",
      { style: { display: "flex", justifyContent: "flex-end", marginTop: "0.65rem" } },
      el("button", { className: "btn btn-primary", text: "Close", onClick: () => closeModal() })
    )
  );
  showModal(`🛒 ${targetPlayer.name}'s Cart Mat & Holdings`, node);
}

function renderDomnaMediatorExchangeBar(gs, viewer, closeModalOnAction = false) {
  if (!gs || !viewer) return null;
  if (!hasActiveClimateOption(gs, "domna_3")) return null;
  if (gs.phase === "finished" || gs.phase === "setup_discard" || gs.phase === "setup_climate") return null;
  const posDiamonds = Math.max(0, Number(viewer.favor && viewer.favor.Domna) || 0);
  if (posDiamonds < 1) return null;

  const triggerExchange = async (targetFaction) => {
    await sendGameAction({
      type: "exchange_domna_diamond",
      targetFaction,
      count: 1,
    });
    if (closeModalOnAction) {
      closeModal();
    }
  };

  return el(
    "div",
    { className: "domna-mediator-bar" },
    el(
      "div",
      { className: "domna-mediator-lbl" },
      el("strong", { text: `💎 Empress Mediator (+${posDiamonds} Diamond${posDiamonds > 1 ? "s" : ""}): ` }),
      el("span", { text: "Exchange 1-for-1 anytime" })
    ),
    el(
      "div",
      { className: "domna-mediator-btns" },
      el("button", {
        type: "button",
        className: "btn btn-sm",
        style: { borderColor: "#b91c1c", color: "#991b1b" },
        title: "Spend 1 positive Diamond (-1 Domna) to gain +1 Ruby (+1 Caracalla)",
        text: "→ +1 Ruby (Caracalla)",
        onClick: () => triggerExchange("Caracalla"),
      }),
      el("button", {
        type: "button",
        className: "btn btn-sm",
        style: { borderColor: "#047857", color: "#065f46" },
        title: "Spend 1 positive Diamond (-1 Domna) to gain +1 Emerald (+1 Geta)",
        text: "→ +1 Emerald (Geta)",
        onClick: () => triggerExchange("Geta"),
      })
    )
  );
}

function getActiveForumBuySpec(gs, viewer) {
  if (!gs || !viewer || !viewer.position) return null;
  const cell = gs.romeBoard && gs.romeBoard[viewer.position];
  if (!cell || !cell.isForum || !cell.revealed) return null;
  const buys = cell.revealed.buys || [];
  if (buys.length === 0) return null;
  return {
    cell: viewer.position,
    cellName: cell.name || viewer.position,
    category: buys[0].category,
    modifier: buys[0].modifier || "=",
    canTransactNow:
      gs.phase === "delivery" && gs.activePlayerIndex === viewer.index && !viewer.transactedThisTurn,
  };
}

function computeForumBuyPriceForCard(card, colIndex, modifier) {
  const colToPriceIdx = [0, 1, 2, 2, 3, 4];
  const shift = modifier === ">" || modifier === "-" ? 1 : modifier === "<" || modifier === "+" ? -1 : 0;
  const effCol = Math.min(5, Math.max(0, colIndex + shift));
  const priceIdx = colToPriceIdx[effCol];
  const buyArr = Array.isArray(card.buy) ? card.buy : [];
  if (buyArr[priceIdx] !== undefined) {
    return Number(buyArr[priceIdx]);
  }
  return Number(card.currentBuyPrice) || 4;
}

function renderMarketHeaderDenariiCounts(gs, viewer) {
  const orderedPlayers = [viewer, ...(gs.players || []).filter((p) => p.index !== viewer.index)];
  return el(
    "div",
    { className: "market-header-denarii-strip" },
    ...orderedPlayers.map((p) => {
      const swatchColor = resolveDieSwatchColor(p.color, "player");
      const isMe = p.index === viewer.index;
      return el(
        "button",
        {
          type: "button",
          className: `player-denarii-pill ${isMe ? "is-viewer-pill" : "is-opponent-pill"}`,
          style: {
            borderColor: swatchColor,
            color: swatchColor,
          },
          title: `Click to view ${p.name}'s Cart (${p.usedBlocks}/${p.maxBlocks}■ Goods, ${p.usedGuards}/${p.maxGuards}▲ Guards, 𐆖${p.cash})`,
          onClick: () => openPlayerCartModal(gs, p, viewer),
        },
        renderCartIconNode(p.color, "", `${p.name}'s Cart`),
        el("span", {
          className: "denarii-pill-name",
          style: { color: swatchColor },
          text: isMe ? `${p.name} (You):` : `${p.name}:`,
        }),
        el("strong", {
          className: "denarii-pill-amount",
          style: { color: swatchColor },
          text: `${p.cash}(d)`,
        })
      );
    })
  );
}

function renderOstiaMarketBoard(gs, viewer) {
  const isMyMarketTurn = gs.phase === "market" && gs.activePlayerIndex === viewer.index;
  const forumSpec = getActiveForumBuySpec(gs, viewer);

  // Column headings row above the 7-column Market Board (Col 0 Quayside + Cols 1..6 Warehouse Scarcity)
  const colHeadersRow = el(
    "div",
    { className: "market-col-headers" },
    el(
      "div",
      { className: "market-col-header-box" },
      el("div", { className: "col-header-title", style: { color: "var(--arch-gold)" }, text: "Quayside & Tracks" }),
      el("div", { className: "col-header-sub", text: `Cargo Deck: ${gs.deckCounts.market}` })
    ),
    ...MARKET_COLUMNS_META.map((cm) =>
      el(
        "div",
        { className: "market-col-header-box" },
        el("div", { className: "col-header-symbol", text: cm.symbol }),
        el("div", { className: "col-header-title", text: `Col ${cm.col}: ${cm.title}` }),
        el("div", { className: "col-header-sub", text: cm.note })
      )
    )
  );

  const gridCells = [];
  for (const trackName of TRACK_NAMES) {
    const cards = gs.marketBoard[trackName] || [];
    const meta = gs.marketMeta[trackName] || { count: cards.length, scarcityLabel: "Uncommon (=)", scarcitySymbol: "=" };
    const trackKey = trackName.toLowerCase();
    const trackClass = resolveGoodTrackClass(trackName);
    const isForumSellingTrack = Boolean(forumSpec && forumSpec.category === trackName);
    const isHighlightedTrack = isForumSellingTrack || appState.highlightedMarketTrack === trackName;

    // Leftmost Column (Col 0): sits directly over the overhead Quayside Thoroughfare on the board
    gridCells.push(
      el(
        "div",
        { className: `track-header-cell ${isHighlightedTrack ? "forum-highlighted-track-header" : ""}` },
        el(
          "div",
          { className: `track-header-plaque ${trackClass}` },
          el("div", { className: "track-title", text: trackName }),
          el("div", { style: { fontSize: "0.7rem", color: "#e6d8c0" }, text: `${meta.count}/6 Bays Stocked` }),
          el("span", { className: "scarcity-pill", text: `Sells At: ${meta.scarcityLabel}` }),
          isForumSellingTrack
            ? el("span", {
                className: "scarcity-pill",
                style: {
                  background: "rgba(34, 197, 94, 0.28)",
                  borderColor: "#4ade80",
                  color: "#bbf7d0",
                  marginTop: "2px",
                },
                text: `🏛️ Forum ${forumSpec.cell}: Sells @ ${formatTileModifier(forumSpec.modifier)}`,
              })
            : null
        )
      )
    );

    // Columns 1..6: Warehouse Bays faintly colored in the color corresponding to that Good type
    for (let col = 0; col < 6; col++) {
      const card = cards[col];
      if (!card) {
        gridCells.push(
          el(
            "div",
            { className: `market-bay-cell track-row-${trackKey} ${isHighlightedTrack ? "forum-highlighted-bay" : ""}` },
            el(
              "div",
              { className: "market-slot-empty-bay" },
              el("div", { className: "empty-bay-stencil", text: `[ ${COL_SYMBOLS[col]} ]` })
            )
          )
        );
      } else {
        const basePrice = card.currentBuyPrice;
        const forumPrice = isForumSellingTrack
          ? computeForumBuyPriceForCard(card, col, forumSpec.modifier)
          : basePrice;
        const effectivePrice = isForumSellingTrack ? forumPrice : basePrice;

        const isGuardTrack = trackName === "Guards";
        const reqBlocks = isGuardTrack ? 0 : Math.max(1, Number(card.blocks) || 1);
        const reqGuards = isGuardTrack ? Math.max(1, Number(card.guards) || 1) : 0;
        const cardBonusBlocks = Number(card.bonusBlocks) || 0;
        const cardBonusGuards = Number(card.bonusGuards) || 0;
        const fitsInCart = doesItemFitWithoutSwap(viewer, {
          reqBlocks,
          reqGuards,
          bonusBlocks: cardBonusBlocks,
          bonusGuards: cardBonusGuards,
        });
        const canSwapToFit =
          fitsInCart ||
          (isGuardTrack
            ? Array.isArray(viewer.guards) && viewer.guards.length > 0
            : Array.isArray(viewer.cart) && viewer.cart.length > 0);

        const canMarketBuy = isMyMarketTurn && viewer.cash >= basePrice && canSwapToFit;
        const canForumBuy =
          isForumSellingTrack && forumSpec.canTransactNow && viewer.cash >= forumPrice && canSwapToFit;
        const canBuy = canMarketBuy || canForumBuy;

        const subtitleText =
          isGuardTrack
            ? "Guard"
            : card.subtitle
            ? `(${card.subtitle})`
            : card.subcategory || card.category || trackName;

        // Combat effect line without "Combat:" prefix
        let combatLineText = null;
        if (isGuardTrack) {
          combatLineText = `${card.combatText || ""}${card.abilityText ? ` & ${card.abilityText}` : ""}`;
        } else if (trackName === "Weapons") {
          combatLineText = card.combatText || "0 CP";
        } else if (card.combatText) {
          combatLineText = card.combatText;
        }

        const blocksSymbols =
          isGuardTrack
            ? "▲".repeat(reqGuards)
            : "■".repeat(reqBlocks);

        const swapSuffix = canBuy && !fitsInCart ? (isGuardTrack ? " (Fire 1)" : " (Swap)") : "";
        let buttonLabel = `${isGuardTrack ? "Hire" : "Buy"} ${effectivePrice}(d)${swapSuffix}`;
        if (isForumSellingTrack && gs.phase === "delivery") {
          buttonLabel = `🏛️ Forum ${isGuardTrack ? "Hire" : "Buy"} ${forumPrice}(d)${swapSuffix}`;
        }

        let buttonTooltip = "";
        if (isForumSellingTrack && gs.phase === "delivery") {
          if (viewer.transactedThisTurn) {
            buttonTooltip = "You have already used your Transaction for this turn.";
          } else if (viewer.cash < forumPrice) {
            buttonTooltip = `Requires ${forumPrice}(d) (You have ${viewer.cash}(d)).`;
          } else if (!fitsInCart) {
            buttonTooltip = isGuardTrack
              ? `Guard capacity full (${viewer.usedGuards}/${viewer.maxGuards}▲) — click to fire a Guard and hire ${card.name} for ${forumPrice}(d).`
              : `Cart space full (${viewer.usedBlocks}/${viewer.maxBlocks}■) — click to discard Goods and buy ${card.name} for ${forumPrice}(d).`;
          } else {
            buttonTooltip = `${isGuardTrack ? "Hire" : "Purchase"} ${card.name} at Forum ${forumSpec.cell} for ${forumPrice}(d)!`;
          }
        } else if (isMyMarketTurn && !fitsInCart && viewer.cash >= basePrice) {
          buttonTooltip = isGuardTrack
            ? `Guard capacity full (${viewer.usedGuards}/${viewer.maxGuards}▲) — click to fire a Guard and hire ${card.name} for ${basePrice}(d).`
            : `Cart space full (${viewer.usedBlocks}/${viewer.maxBlocks}■) — click to discard Goods and buy ${card.name} for ${basePrice}(d).`;
        }

        gridCells.push(
          el(
            "div",
            { className: `market-bay-cell track-row-${trackKey} ${isHighlightedTrack ? "forum-highlighted-bay" : ""}` },
            el(
              "div",
              { className: "good-card-unit" },
              el(
                "div",
                {
                  className: `market-good-card ${trackClass} ${canForumBuy ? "forum-buyable-card" : ""}`,
                  style: { cursor: "pointer" },
                  title: `Click to view ${card.name} up close`,
                  onClick: () => {
                    if (isGuardTrack) {
                      openCartGuardDetailModal(card);
                    } else {
                      openCartGoodDetailModal(Object.assign({ track: trackName }, card), gs, viewer, true);
                    }
                  },
                },
                el(
                  "div",
                  { className: "market-good-card-inner" },
                  el(
                    "div",
                    { className: "good-card-header" },
                    el("div", { className: "slot-card-name", text: card.name }),
                    el("div", { className: "slot-sub", text: subtitleText }),
                    combatLineText ? el("div", { className: "good-combat-line", text: combatLineText }) : null
                  ),
                  renderGoodCardArtNode(card, trackName, false),
                  el(
                    "div",
                    { className: "good-card-footer" },
                    el("div", { className: "good-blocks-row", text: blocksSymbols }),
                    renderGoodPriceTableNode(card, trackName, col)
                  )
                )
              ),
              el(
                "div",
                { className: "good-card-external-meta" },
                el("button", {
                  type: "button",
                  className: `btn btn-sm ${canBuy ? "btn-primary" : ""} ${
                    canForumBuy ? "forum-buy-highlight-btn" : ""
                  }`,
                  style: { width: "100%", padding: "0.18rem 0.3rem", fontSize: "0.7rem" },
                  disabled: !canBuy,
                  title: buttonTooltip,
                  text: buttonLabel,
                  onClick: () => {
                    const actionBase = canForumBuy
                      ? { type: "delivery_forum_buy", colIndex: col }
                      : { type: "market_buy", track: trackName, colIndex: col };
                    const costHere = canForumBuy ? forumPrice : basePrice;
                    if (fitsInCart) {
                      sendGameAction(actionBase);
                    } else {
                      openCartReplacementModal(viewer, {
                        itemType: isGuardTrack ? "guard" : "good",
                        incomingCard: card,
                        reqBlocks,
                        reqGuards,
                        bonusBlocks: cardBonusBlocks,
                        bonusGuards: cardBonusGuards,
                        title: isGuardTrack
                          ? `🛡️ Guard Slots Full — Fire a Guard to Hire ${card.name}?`
                          : `🛒 Cart Space Full — Discard Goods to Buy ${card.name}?`,
                        subtitle: isGuardTrack
                          ? `Hiring "${card.name}" costs ${costHere}(d), and your Guard slots are full (${viewer.usedGuards}/${viewer.maxGuards}▲). Select a Guard to fire, or cancel the hire action.`
                          : `Buying "${card.name}" (${reqBlocks}■) costs ${costHere}(d), and your Cart has ${viewer.usedBlocks}/${viewer.maxBlocks}■ used. Select Goods on your Cart to discard so it fits, or cancel the purchase.`,
                        confirmLabelPrefix: `${isGuardTrack ? "Hire" : "Buy"} ${card.name} for ${costHere}(d)`,
                        cancelLabel: isGuardTrack ? "Cancel Hire" : "Cancel Purchase",
                        onConfirm: (discardCartIds, fireGuardIds) => {
                          sendGameAction({
                            ...actionBase,
                            discardCartIds,
                            fireGuardIds,
                          });
                        },
                      });
                    }
                  },
                })
              )
            )
          )
        );
      }
    }
  }

  return el(
    "div",
    { className: "market-board" },
    el(
      "div",
      { className: "panel-title fresco-banner-header fresco-merchants", style: { flexWrap: "wrap", gap: "0.5rem" } },
      el("span", { text: "⚓ Portus Ostiae — Quayside Thoroughfare & Horrea Warehouse Market Board" }),
      renderMarketHeaderDenariiCounts(gs, viewer)
    ),
    renderMarketNpcSpeechBubble(),
    forumSpec
      ? el(
          "div",
          {
            style: {
              padding: "0.55rem 0.85rem",
              marginBottom: "0.65rem",
              background: "#ecfdf5",
              border: "1.5px solid #16a34a",
              borderRadius: "6px",
              fontSize: "0.84rem",
              color: "#14532d",
              fontWeight: "600",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "0.5rem",
            },
          },
          el("span", {
            text: `🏛️ Your Cart occupies Forum ${forumSpec.cell} (${forumSpec.cellName}), which sells ${
              forumSpec.category
            } (${formatTileModifier(forumSpec.modifier)})! ${
              forumSpec.canTransactNow
                ? `Highlighted '${forumSpec.category}' buttons below are ready to purchase.`
                : viewer.transactedThisTurn
                ? "You have already completed your Transaction this turn."
                : "Wait for your Delivery turn to purchase."
            }`,
          }),
          appState.boardViewMode === "market"
            ? el("button", {
                className: "btn btn-sm",
                text: "🗺️ Return to Rome Board",
                onClick: () => {
                  appState.highlightedMarketTrack = null;
                  appState.boardViewMode = gs.phase === "market" ? "rome" : "auto";
                  renderApp();
                },
              })
            : null
        )
      : null,
    el(
      "div",
      {
        className: "ostia-market-board-matrix",
        onScroll: (e) => {
          appState.marketBoardScrollLeft = e.currentTarget.scrollLeft;
          appState.marketBoardScrollTop = e.currentTarget.scrollTop;
        },
      },
      colHeadersRow,
      el("div", { className: "ostia-market-grid" }, ...gridCells)
    )
  );
}

const TIBER_UNBRIDGED_CELL_CLASSES = {
  B3: ["tiber-block-S"],
  B4: ["tiber-block-N"],
  A5: ["tiber-block-E", "tiber-block-S"],
  B5: ["tiber-block-W"],
  A6: ["tiber-block-N"],
};

const TIBER_BRIDGE_BADGES_BY_CELL = {
  A1: [
    { pos: "E", label: "🌉 Pons Aelius" },
    { pos: "S", label: "🌉 Pons Neronianus" },
  ],
  A4: [{ pos: "N", label: "🌉 Pons Agrippae" }],
  B4: [
    { pos: "E", label: "🌉 Pons Fabricius" },
    { pos: "S", label: "🌉 Pons Aemilius" },
  ],
};

function positionRomeHoverTooltip(tooltipEl, clientX, clientY) {
  if (!tooltipEl) return;
  const pad = 16;
  const w = tooltipEl.offsetWidth || 248;
  const h = tooltipEl.offsetHeight || 290;
  let left = clientX + 18;
  let top = clientY - Math.round(h * 0.35);
  if (left + w + pad > window.innerWidth) {
    left = Math.max(pad, clientX - w - 18);
  }
  if (top + h + pad > window.innerHeight) {
    top = window.innerHeight - h - pad;
  }
  if (top < pad) top = pad;
  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.top = `${top}px`;
}

function showRomeHoverTooltip(coord, cell, previewTile, isScoutedPreview, crossingSummary, clientX, clientY) {
  let tooltipEl = document.getElementById("rome-hover-tooltip");
  if (!tooltipEl) {
    tooltipEl = document.createElement("div");
    tooltipEl.id = "rome-hover-tooltip";
    tooltipEl.className = "rome-hover-tooltip";
    document.body.appendChild(tooltipEl);
  }
  const sellsStr =
    (previewTile.sells || []).length > 0
      ? previewTile.sells.map((s) => `${s.category} (${formatTileModifier(s.modifier)})`).join(", ")
      : "None";
  const buysStr =
    (previewTile.buys || []).length > 0
      ? previewTile.buys.map((b) => `${b.category} (${formatTileModifier(b.modifier)})`).join(", ")
      : null;
  const centerParts = [
    previewTile.encounter ? formatEdgeLabel(previewTile.encounter) : null,
    previewTile.gamble ? "Stadium Gamble (≤20d)" : null,
    previewTile.persistent ? "Persistent (⤹)" : previewTile.refresh ? "Refresh (↻)" : null,
  ].filter(Boolean);

  tooltipEl.replaceChildren(
    el(
      "div",
      { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.4rem", marginBottom: "0.35rem", width: "100%" } },
      el("strong", { style: { color: "var(--arch-gold)", fontSize: "0.8rem" }, text: `${coord} — ${cell ? cell.name : coord}` }),
      el("span", {
        className: "badge",
        style: isScoutedPreview
          ? { borderColor: "#38bdf8", color: "#0369a1", background: "#f0f9ff", fontSize: "0.65rem", padding: "0.08rem 0.35rem" }
          : { fontSize: "0.65rem", padding: "0.08rem 0.35rem" },
        text: isScoutedPreview ? "👁️ Scouted" : "Exposed",
      })
    ),
    renderDynamicTileCardNode(previewTile, coord, "inspector"),
    el(
      "div",
      { style: { fontSize: "0.72rem", marginTop: "0.38rem", lineHeight: "1.35", color: "#f8f1e5", width: "100%" } },
      el("div", {}, el("strong", { style: { color: "var(--arch-gold)" }, text: "Buys: " }), sellsStr),
      buysStr ? el("div", {}, el("strong", { style: { color: "#7dd3fc" }, text: "Sells: " }), buysStr) : null,
      centerParts.length > 0 ? el("div", { style: { color: "#fde68a" }, text: centerParts.join(" • ") }) : null,
      crossingSummary
        ? el("div", {
            style: { marginTop: "0.22rem", paddingTop: "0.22rem", borderTop: "1px solid rgba(255,248,232,0.22)", fontWeight: "700", color: crossingSummary.color },
            text: crossingSummary.text,
          })
        : null
    )
  );
  positionRomeHoverTooltip(tooltipEl, clientX, clientY);
}

function showRomeSimpleHoverTooltip(headingText, detailText, clientX, clientY) {
  let tooltipEl = document.getElementById("rome-hover-tooltip");
  if (!tooltipEl) {
    tooltipEl = document.createElement("div");
    tooltipEl.id = "rome-hover-tooltip";
    tooltipEl.className = "rome-hover-tooltip";
    document.body.appendChild(tooltipEl);
  }
  tooltipEl.replaceChildren(
    el(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: "0.22rem", width: "100%" } },
      el("strong", { style: { color: "var(--arch-gold)", fontSize: "0.82rem" }, text: headingText }),
      detailText
        ? el("div", { style: { fontSize: "0.74rem", lineHeight: "1.35", color: "#f8f1e5" }, text: detailText })
        : null
    )
  );
  positionRomeHoverTooltip(tooltipEl, clientX, clientY);
}

function showRomeUnrevealedCellHoverTooltip(coord, cell, unrevealedCount, crossingSummary, clientX, clientY) {
  let tooltipEl = document.getElementById("rome-hover-tooltip");
  if (!tooltipEl) {
    tooltipEl = document.createElement("div");
    tooltipEl.id = "rome-hover-tooltip";
    tooltipEl.className = "rome-hover-tooltip";
    document.body.appendChild(tooltipEl);
  }
  const cellName = cell && cell.name ? cell.name : coord;
  const featureLines = [];
  if (cell && cell.isGate) {
    featureLines.push("⛩️ Via City Gate Entrance & Exit (halves 6:00 A.M. Curfew Fine)");
  }
  if (cell && cell.isForum) {
    featureLines.push("🏛️ Imperial Forum Market (purchase Goods when revealed)");
  }
  const bridgesHere = TIBER_BRIDGE_BADGES_BY_CELL[coord] || [];
  if (bridgesHere.length > 0) {
    featureLines.push(`🌉 Tiber Bridge: ${bridgesHere.map((b) => b.label).join(", ")}`);
  }

  tooltipEl.replaceChildren(
    el(
      "div",
      { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.4rem", marginBottom: "0.28rem", width: "100%" } },
      el("strong", { style: { color: "var(--arch-gold)", fontSize: "0.8rem" }, text: `${coord} — ${cellName}` }),
      el("span", {
        className: "badge",
        style: { fontSize: "0.65rem", padding: "0.08rem 0.35rem" },
        text: `${unrevealedCount} Face-Down`,
      })
    ),
    el(
      "div",
      { style: { fontSize: "0.73rem", lineHeight: "1.35", color: "#f8f1e5", width: "100%" } },
      el("div", { text: `This is neighborhood ${coord} (${cellName}). Unrevealed stack (${unrevealedCount} tiles).` }),
      ...featureLines.map((line) => el("div", { style: { color: "#fde68a", marginTop: "0.18rem" }, text: line })),
      crossingSummary
        ? el("div", {
            style: { marginTop: "0.22rem", paddingTop: "0.22rem", borderTop: "1px solid rgba(255,248,232,0.22)", fontWeight: "700", color: crossingSummary.color },
            text: crossingSummary.text,
          })
        : null,
      el("div", {
        style: { marginTop: "0.25rem", color: "#cbd5e1", fontSize: "0.68rem" },
        text: "Click to open Move, Scout, or End Turn options.",
      })
    )
  );
  positionRomeHoverTooltip(tooltipEl, clientX, clientY);
}

function getCellOffBoardDirs(coord) {
  if (!coord || coord.length < 2) return [];
  const colIdx = COLS.indexOf(coord.slice(0, 1));
  const rowIdx = ROWS.indexOf(coord.slice(1));
  if (colIdx < 0 || rowIdx < 0) return [];
  const deltas = {
    N: [0, -1],
    NE: [1, -1],
    E: [1, 0],
    SE: [1, 1],
    S: [0, 1],
    SW: [-1, 1],
    W: [-1, 0],
    NW: [-1, -1],
  };
  const offDirs = [];
  for (const [d, [dx, dy]] of Object.entries(deltas)) {
    const nx = colIdx + dx;
    const ny = rowIdx + dy;
    if (nx < 0 || nx >= COLS.length || ny < 0 || ny >= ROWS.length) {
      offDirs.push(d);
    }
  }
  return offDirs;
}

function renderRomeNightBoard(gs, viewer) {
  const missionCells = new Set();
  for (const m of viewer.missions || []) {
    if (!m.completed && !m.failed) {
      if (m.pickupCell && !m.pickedUp) missionCells.add(m.pickupCell);
      if (m.deliverCell) missionCells.add(m.deliverCell);
      if (m.cell) missionCells.add(m.cell);
    }
  }

  const scoutedTileByCoord = {};
  for (const si of viewer.scoutedInfo || []) {
    if (si && si.targetType === "tile" && si.targetKey && si.revealedData) {
      const bCell = gs.romeBoard && gs.romeBoard[si.targetKey];
      if (!bCell || !bCell.revealed) {
        scoutedTileByCoord[si.targetKey] = si.revealedData;
      }
    }
  }

  const isMyDeliveryTurn = gs.phase === "delivery" && gs.activePlayerIndex === viewer.index;
  const reachableDirsByCell = {};
  const adjacentDirInfoByCell = {};
  let passableExitDir = null;
  let anyExitDir = null;
  const playerOffBoardDirs = viewer.position ? getCellOffBoardDirs(viewer.position) : [];
  const isPlayerOnPerimeter = playerOffBoardDirs.length > 0;
  const currCellObj = viewer.position ? gs.romeBoard[viewer.position] : null;
  const currOutDirs = (currCellObj && currCellObj.revealed && currCellObj.revealed.outgoingDirections) || {};
  for (const [dir, dInfo] of Object.entries(currOutDirs)) {
    if (dInfo && dInfo.targetCell) {
      adjacentDirInfoByCell[dInfo.targetCell] = { dir, ...dInfo };
    }
  }

  if (isMyDeliveryTurn && viewer.position && viewer.movesRemaining > 0) {
    for (const [dir, dInfo] of Object.entries(currOutDirs)) {
      if (dInfo.targetCell) {
        const riverBlocked = Boolean(dInfo.blockedByRiver) || isTiberCrossingBlocked(viewer.position, dInfo.targetCell);
        if (!riverBlocked && (dInfo.passable || (viewer.turnEffects && viewer.turnEffects.shortcut))) {
          reachableDirsByCell[dInfo.targetCell] = dir;
        }
      } else if (dInfo.isExit) {
        if (!anyExitDir) anyExitDir = dir;
        if (!passableExitDir && (dInfo.passable || (viewer.turnEffects && viewer.turnEffects.shortcut))) {
          passableExitDir = dir;
        }
      }
    }
    if (!passableExitDir && viewer.turnEffects && viewer.turnEffects.shortcut && playerOffBoardDirs.length > 0) {
      passableExitDir = playerOffBoardDirs[0];
    }
    if (!anyExitDir && playerOffBoardDirs.length > 0) {
      anyExitDir = playerOffBoardDirs[0];
    }
  }

  const triggerPerimeterMapEdgeExit = (e) => {
    if (!isMyDeliveryTurn || !viewer.position || viewer.movesRemaining <= 0 || !isPlayerOnPerimeter) {
      return false;
    }
    const dirToUse = passableExitDir || anyExitDir;
    if (!dirToUse) return false;
    if (e && typeof e.stopPropagation === "function") {
      e.stopPropagation();
    }
    hideRomeHoverTooltip();
    sendGameAction({ type: "delivery_move", direction: dirToUse });
    return true;
  };

  const npcReplay = computeNpcReplayPositions(gs);
  const gridCells = [];
  for (const r of ROWS) {
    for (const c of COLS) {
      const coord = `${c}${r}`;
      const cell = gs.romeBoard[coord];
      const rev = cell ? cell.revealed : null;
      const scoutedTopTile = !rev ? scoutedTileByCoord[coord] || null : null;
      const isCurrent = viewer.position === coord;
      const isMissionTarget = missionCells.has(coord);
      const isReachableMove = Boolean(reachableDirsByCell[coord]);
      const playersHere = gs.players.filter(
        (p) => npcReplay.posByPlayer[p.index] === coord && p.index !== npcReplay.glidingPlayerIndex
      );
      const cellOffDirs = getCellOffBoardDirs(coord);
      const isCellPerimeter = cellOffDirs.length > 0;
      const unrevealedCount = cell
        ? Number(
            cell.stackCount !== undefined
              ? cell.stackCount
              : cell.unrevealedCount !== undefined
              ? cell.unrevealedCount
              : 12
          )
        : 0;

      const cellClasses = ["rome-cell"];
      if (cell && cell.isGate) {
        cellClasses.push("is-gate");
        if (gs.phase === "delivery_entry" || (gs.phase === "delivery" && Number(gs.turn) === 1)) {
          cellClasses.push("is-via-start-highlight");
        }
      }
      if (cell && cell.isForum) cellClasses.push("is-forum");
      if (rev) cellClasses.push("has-revealed-tile");
      if (isCurrent) cellClasses.push("is-current");
      if (isMissionTarget) cellClasses.push("is-mission-target");
      if (isReachableMove) cellClasses.push("is-reachable-move");
      for (const tCls of TIBER_UNBRIDGED_CELL_CLASSES[coord] || []) {
        cellClasses.push(tCls);
      }

      const cellTitleParts = [
        `This is ${coord} (${cell ? cell.name : coord})`,
        cell && cell.isGate ? "Via City Gate Entrance/Exit" : null,
        cell && cell.isForum ? "Imperial Forum Market" : null,
        rev
          ? "Revealed Tile"
          : scoutedTopTile
          ? `Scouted Unrevealed Stack (${unrevealedCount} tiles)`
          : `Unrevealed Stack (${unrevealedCount} face-down tiles)`,
        isCurrent ? "Your Cart is here" : null,
        isReachableMove ? `Reachable Move (${reachableDirsByCell[coord]})` : null,
        "Click for Detailed Tile View",
      ].filter(Boolean);
      const cellHelperTitle = cellTitleParts.join(" • ");

      const handleCellClick = () => {
        hideRomeHoverTooltip();
        appState.inspectedCell = coord;
        renderApp();
        const moveOpts = {
          moveDir: reachableDirsByCell[coord] || null,
          adjInfo: adjacentDirInfoByCell[coord] || null,
        };
        openFaceUpTileUpCloseModal(gs, viewer, coord, cell, rev || scoutedTopTile, moveOpts);
      };

      const handleCellMouseEnter = () => {
        document.querySelectorAll(".compass-btn.is-hovered-dir").forEach((b) => b.classList.remove("is-hovered-dir"));
        const adjInfo = adjacentDirInfoByCell[coord];
        if (adjInfo && viewer.position && viewer.position !== coord) {
          const compassBtn = document.querySelector(`.compass-btn[data-compass-dir="${adjInfo.dir}"]`);
          if (compassBtn) compassBtn.classList.add("is-hovered-dir");
        }
      };

      const exitEdgeVal = passableExitDir && rev && rev.edges ? rev.edges[passableExitDir] : null;
      const shortcutBypass = Boolean(viewer.turnEffects && viewer.turnEffects.shortcut);
      const exitTollAmt = !shortcutBypass ? parseTollAmount(exitEdgeVal) : 0;
      const hasExitToll = exitTollAmt > 0;
      const hasExitHazard =
        !shortcutBypass &&
        !hasExitToll &&
        Boolean(exitEdgeVal && !["green", "red", "None"].includes(String(exitEdgeVal)));
      const exitHazardNodes = [];
      if (hasExitToll) {
        exitHazardNodes.push(
          el("span", {
            className: "exit-strip-toll-badge",
            text: `${exitTollAmt}(d)`,
          })
        );
      } else if (hasExitHazard) {
        const exitFigs = buildEncounterFigureNodes(exitEdgeVal, "exit-strip-enc-icon");
        if (exitFigs.length > 0) {
          exitHazardNodes.push(el("span", { className: "exit-strip-enc-badge" }, ...exitFigs));
        }
      }
      const exitDetailSuffix = shortcutBypass
        ? " (Shortcut active)"
        : hasExitToll
        ? ` (Toll: ${exitTollAmt}d)`
        : hasExitHazard
        ? ` (Encounter: ${formatEdgeLabel(exitEdgeVal)})`
        : "";
      const exitEdgeStripNode =
        isCurrent &&
        isMyDeliveryTurn &&
        viewer.movesRemaining > 0 &&
        passableExitDir &&
        !gs.pendingEncounter &&
        !viewer.pendingNpcOffer &&
        !((viewer.pendingCartOverflow || []).length > 0) &&
        !((viewer.pendingMarketReward || []).length > 0)
          ? el(
              "button",
              {
                type: "button",
                className: `rome-exit-edge-strip exit-dir-${passableExitDir.toLowerCase()}${
                  hasExitHazard ? " has-exit-encounter" : hasExitToll ? " has-exit-toll" : ""
                }`,
                title: `Click to Exit Rome via ${passableExitDir}${exitDetailSuffix}`,
                onClick: (e) => {
                  triggerPerimeterMapEdgeExit(e);
                },
              },
              ...exitHazardNodes,
              el("span", { text: `🚪 Exit (${passableExitDir})` })
            )
          : null;

      const bridgeBadgeNodes = (TIBER_BRIDGE_BADGES_BY_CELL[coord] || []).map((bSpec) =>
        el("span", {
          className: `tiber-bridge-pill bridge-dir-${bSpec.pos}`,
          title: `${bSpec.label} — Stone Bridge across the Tiber`,
          text: bSpec.label,
        })
      );

      gridCells.push(
        el(
          "div",
          {
            className: cellClasses.join(" "),
            title: cellHelperTitle,
            onClick: handleCellClick,
            onMouseEnter: handleCellMouseEnter,
            onMouseLeave: () => {
              document.querySelectorAll(".compass-btn.is-hovered-dir").forEach((b) => b.classList.remove("is-hovered-dir"));
            },
          },
          rev ? renderDynamicTileCardNode(rev, coord, "board") : null,
          !rev && scoutedTopTile
            ? el("span", {
                className: "cell-scouted-badge",
                title: `You have scouted the top unrevealed tile of ${coord} (${cell ? cell.name : coord})`,
                text: "👁️ Scouted",
              })
            : null,
          ...bridgeBadgeNodes,
          exitEdgeStripNode,
          el("div", {
            className: "cell-neighborhood-title",
            title: cellHelperTitle,
            text: cell ? cell.name : "",
          }),
          playersHere.length > 0
            ? el(
                "div",
                {
                  className: `cart-tokens-row ${playersHere.length > 1 ? "is-stacked" : ""} ${
                    rev && rev.edges && rev.edges.S && !["green", "red", "none"].includes(rev.edges.S)
                      ? "has-south-badge"
                      : ""
                  }`.trim(),
                  title: playersHere.map((p) => `${p.name}'s Cart (${getCartColorLabel(p.color)})`).join(" • "),
                },
                ...playersHere.map((p, idx) => {
                  const isOutsideGate = Boolean(npcReplay.waitingOutsideGateByPlayer[p.index] && cell && cell.isGate);
                  const isActiveNpcHere = Boolean(
                    appState.activeNpcEvent &&
                      appState.activeNpcEvent.phase !== "market" &&
                      appState.activeNpcEvent.playerIndex === p.index
                  );
                  return renderCartIconNode(
                    p.color,
                    `cart-icon-board cart-stack-item-${idx}${isOutsideGate ? " is-waiting-outside-gate" : ""}${
                      isActiveNpcHere ? " is-active-npc-cart" : ""
                    }`,
                    isOutsideGate
                      ? `${p.name}'s Cart (${getCartColorLabel(p.color)}) — Poised outside Gate ${coord} (enters on Turn 1)`
                      : `${p.name}'s Cart (${getCartColorLabel(p.color)})`
                  );
                })
              )
            : null
        )
      );
    }
  }

  const canExitOnEdgeClick = Boolean(
    isMyDeliveryTurn && viewer.position && viewer.movesRemaining > 0 && isPlayerOnPerimeter && (passableExitDir || anyExitDir)
  );
  const edgeExitTooltip =
    canExitOnEdgeClick && passableExitDir
      ? `Click the edge of the map to Exit Rome via ${passableExitDir}`
      : "Rome Night Board Perimeter Border (6×6 Grid: Columns A–F × Rows 1–6)";

  const showViaStartBanner =
    gs.phase === "delivery_entry" || (gs.phase === "delivery" && Number(gs.turn) === 1);

  return el(
    "div",
    { className: "rome-layout" },
    showViaStartBanner
      ? el(
          "div",
          {
            className: "via-start-reminder-bar",
            title: "All merchants must enter Rome through one of the six Via City Gates: A4, B1, B6, E1, F3, or F6.",
          },
          el("span", { className: "via-start-reminder-icon", text: "⛩️" }),
          el(
            "span",
            {
              text:
                gs.phase === "delivery_entry"
                  ? "Start at a Via Entrance: Every merchant must enter Rome at one of the six gold-outlined Viae — A4 (Via Aurelia), B1 (Via Flaminia), B6 (Via Ostiensis), E1 (Via Nomentana), F3 (Via Tiburtina), or F6 (Via Tusculana)."
                  : "8:00 P.M. Entry Hour: Merchants begin Night Delivery at one of Rome's six gold-outlined Via entrances (A4, B1, B6, E1, F3, F6).",
            }
          )
        )
      : null,
    el(
      "div",
      {
        className: `rome-board-frame ${canExitOnEdgeClick && passableExitDir ? "can-exit-rome-edge" : ""}`,
        title: edgeExitTooltip,
        onClick: (e) => {
          if (e.target === e.currentTarget) {
            triggerPerimeterMapEdgeExit(e);
          }
        },
      },
      el(
        "div",
        { className: "rome-board-matrix" },
        el("div", {
          className: `rome-axis-corner ${canExitOnEdgeClick && passableExitDir ? "can-exit-rome-edge" : ""}`,
          title: canExitOnEdgeClick && passableExitDir
            ? edgeExitTooltip
            : "Rome Map Grid Axis (Columns A–F × Rows 1–6)",
          onClick: (e) => triggerPerimeterMapEdgeExit(e),
        }),
        el(
          "div",
          {
            className: `rome-col-headers-bar ${canExitOnEdgeClick && passableExitDir ? "can-exit-rome-edge" : ""}`,
            title: canExitOnEdgeClick && passableExitDir
              ? edgeExitTooltip
              : "Rome Map Column Headers (Columns A–F)",
            onClick: (e) => triggerPerimeterMapEdgeExit(e),
          },
          ...COLS.map((c) =>
            el("div", {
              className: "rome-col-heading",
              title: `This is the ${c} column (Neighborhoods ${c}1–${c}6)`,
              text: c,
            })
          )
        ),
        el(
          "div",
          {
            className: `rome-row-headers-bar ${canExitOnEdgeClick && passableExitDir ? "can-exit-rome-edge" : ""}`,
            title: canExitOnEdgeClick && passableExitDir
              ? edgeExitTooltip
              : "Rome Map Row Headers (Rows 1–6)",
            onClick: (e) => triggerPerimeterMapEdgeExit(e),
          },
          ...ROWS.map((r) =>
            el("div", {
              className: "rome-row-heading",
              title: `This is Row ${r} (Neighborhoods A${r}–F${r})`,
              text: r,
            })
          )
        ),
        el("div", { className: "rome-grid" }, ...gridCells, renderRomeNpcAnimationLayer())
      )
    )
  );
}

const COMPASS_NUMPAD_KEY_MAP = {
  NW: "7",
  N: "8",
  NE: "9",
  W: "4",
  E: "6",
  SW: "1",
  S: "2",
  SE: "3",
};

function renderCartNavigationWidget(gs, viewer) {
  const isCartInRome = Boolean(viewer.position);
  const navCoord = viewer.position || "B1";
  const cell = gs.romeBoard[navCoord] || gs.romeBoard["B1"];
  const rev = isCartInRome && cell ? cell.revealed : null;
  const isMyDeliveryTurn = gs.phase === "delivery" && gs.activePlayerIndex === viewer.index && isCartInRome;
  const isMyGateEntryTurn = gs.phase === "delivery_entry" && gs.activePlayerIndex === viewer.index;
  const landmark = ROME_LANDMARKS[navCoord] || { icon: "🏛️", sub: "Roman Quarter" };

  const compassDirs = ["NW", "N", "NE", "W", "CENTER", "E", "SW", "S", "SE"];
  const outDirs = (rev && rev.outgoingDirections) || {};

  const compassNodes = compassDirs.map((dir) => {
    if (dir === "CENTER") {
      return el(
        "div",
        { className: "compass-center" },
        el("strong", { style: { color: "var(--gold-bright)" }, text: isCartInRome ? `${landmark.icon} ${navCoord}` : "🧭" }),
        el("span", {
          style: { fontSize: "0.66rem", color: "var(--text-muted)" },
          text: isCartInRome ? cell?.name || "Your Cart" : "Outside Walls",
        })
      );
    }
    const info = outDirs[dir];
    if (!info) {
      const targetAdj = isCartInRome ? getNeighborCoordInDir(navCoord, dir) : null;
      const riverNoBridge = targetAdj ? isTiberCrossingBlocked(navCoord, targetAdj) : false;
      return el(
        "button",
        {
          type: "button",
          className: "compass-btn blocked",
          "data-compass-dir": dir,
          disabled: true,
        },
        el("strong", { text: dir }),
        el("span", { style: { fontSize: "0.66rem" }, text: riverNoBridge ? "🌊 Tiber River" : rev ? "No Road" : "—" })
      );
    }
    const riverBlocked =
      Boolean(info.tiberBlocked || info.blockedByRiver) ||
      (info.targetCell ? isTiberCrossingBlocked(navCoord, info.targetCell) : false);
    const bridgeName =
      info.bridgeName || info.bridge || (info.targetCell ? getTiberBridgeName(navCoord, info.targetCell) : null);
    const shortcutActive = Boolean(viewer.turnEffects && viewer.turnEffects.shortcut);
    const passable = !riverBlocked && (info.passable || shortcutActive);
    const canClickMove = isMyDeliveryTurn && viewer.movesRemaining > 0 && passable;
    const destLabel = info.isExit ? "🚪 EXIT ROME" : `→ ${info.targetCell}`;
    const dividedTiberActive = Boolean(bridgeName && (Number(info.bridgeTollCost) > 0 || hasActiveClimateOption(gs, "geta_3")));
    const bridgeTollWaived =
      dividedTiberActive && (shortcutActive || (Number(viewer.favor && viewer.favor.Geta) || 0) >= 1);
    const bridgeTollNote = dividedTiberActive
      ? bridgeTollWaived
        ? " • 0d Bridge"
        : " • 4d Toll"
      : "";
    const subLabel = riverBlocked
      ? "🌊 Tiber River"
      : bridgeName
      ? `🌉 ${bridgeName} • ${formatEdgeLabel(info.edge)}${bridgeTollNote}`
      : formatEdgeLabel(info.edge);
    return el(
      "button",
      {
        type: "button",
        className: `compass-btn ${passable ? "passable" : "blocked"}`,
        "data-compass-dir": dir,
        disabled: !canClickMove,
        title: `Move ${dir} (${destLabel})${bridgeTollNote}`,
        onClick: () => sendGameAction({ type: "delivery_move", direction: dir }),
      },
      el("strong", { text: `${dir} (${destLabel})` }),
      el("span", { style: { fontSize: "0.66rem" }, text: subLabel })
    );
  });

  const locationStatusText = isCartInRome
    ? `📍 Cart at ${viewer.position} — ${cell ? cell.name : ""}`
    : viewer.exitedRome
    ? "✓ Cart Exited Rome Safely"
    : isMyGateEntryTurn
    ? "🚪 At City Gates — Choose Entry Gate"
    : "⚓ Cart at Portus Ostiae";

  const movesStatusText = isCartInRome
    ? gs.phase === "delivery" && gs.turn === 1 && viewer.movesRemaining === 0
      ? "Turn 1 Move Used"
      : `Moves Left: ${viewer.movesRemaining ?? 0}`
    : isMyGateEntryTurn
    ? "Turn 1 Entry"
    : gs.phase === "delivery"
    ? "Waiting"
    : "—";

  const gateCoords = Object.keys(gs.romeBoard || {}).filter(
    (coord) => gs.romeBoard[coord] && gs.romeBoard[coord].isGate
  );

  const txButtons = [];
  if (isMyDeliveryTurn && rev) {
    const smugglersFenceActive = hasActiveClimateOption(gs, "plautilla_3");
    let anySellableShown = false;
    const shownBulkGrainKeys = new Set();
    for (const item of viewer.cart || []) {
      const hasPaidCost = !item.isMissionCargo && typeof item.purchasePrice === "number";
      for (const sOpt of item.availableSells || []) {
        if (!anySellableShown) {
          anySellableShown = true;
          txButtons.push(
            el("div", {
              style: { fontSize: "0.72rem", color: "var(--gold-bright)", fontWeight: "700" },
              text: viewer.transactedThisTurn ? "✓ Transaction Used This Hour" : "💰 Sell 1 Good (or Bulk Grain):",
            })
          );
        }
        const bulkKey = `${sOpt.missionId || "tile"}:${sOpt.modifier || "="}`;
        if (
          sOpt.category === "Grain" &&
          !sOpt.isFencedCargo &&
          Number(sOpt.bulkGrainCount) >= 2 &&
          Array.isArray(sOpt.bulkGrainCardIds) &&
          !shownBulkGrainKeys.has(bulkKey)
        ) {
          shownBulkGrainKeys.add(bulkKey);
          const bulkNet = Number(sOpt.bulkGrainTotalPrice) - Number(sOpt.bulkGrainPurchasePrice || 0);
          const bulkNetStr = bulkNet >= 0 ? `+${bulkNet}d` : `${bulkNet}d`;
          txButtons.push(
            el("button", {
              type: "button",
              className: "btn btn-sm btn-primary",
              disabled: viewer.transactedThisTurn,
              text: `🌾 Bulk Sell All ${sOpt.bulkGrainCount} Grain (${sOpt.bulkGrainTotalPrice}d @ ${sOpt.scarcitySymbol}) [Net ${bulkNetStr}]${
                sOpt.isMission ? " [Mission]" : ""
              }`,
              onClick: () =>
                sendGameAction({
                  type: "delivery_sell",
                  category: "Grain",
                  bulkGrain: true,
                  cardIds: sOpt.bulkGrainCardIds,
                  missionId: sOpt.missionId || undefined,
                }),
            })
          );
        }
        let profitSuffix = "";
        if (hasPaidCost && !sOpt.isFencedCargo) {
          const net = Number(sOpt.price) - Number(item.purchasePrice);
          const netStr = net >= 0 ? `+${net}d` : `${net}d`;
          profitSuffix = ` [Paid ${item.purchasePrice}d • Net ${netStr}]`;
        }
        const fenceTag = sOpt.isFencedCargo
          ? smugglersFenceActive
            ? " [Smuggler's Fence]"
            : " [Fails Mission]"
          : "";
        txButtons.push(
          el("button", {
            type: "button",
            className: `btn btn-sm ${sOpt.isFencedCargo ? "btn-crimson" : "btn-primary"}`,
            disabled: viewer.transactedThisTurn,
            text: `${sOpt.isFencedCargo ? "🕵️ Fence" : "💰 Sell"} ${item.name} (${sOpt.price}d @ ${sOpt.scarcitySymbol})${profitSuffix}${
              sOpt.isMission ? " [Mission]" : fenceTag
            }`,
            onClick: () =>
              sendGameAction({
                type: "delivery_sell",
                category: sOpt.category,
                cardIds: [item.id],
                missionId: sOpt.missionId || undefined,
              }),
          })
        );
        if (Array.isArray(sOpt.amethystBoostOptions) && sOpt.amethystBoostOptions.length > 0 && !viewer.transactedThisTurn) {
          txButtons.push(
            el(
              "div",
              { className: "amethyst-boost-row" },
              ...sOpt.amethystBoostOptions.map((boost) =>
                el("button", {
                  type: "button",
                  className: "btn btn-sm amethyst-boost-btn",
                  text: `🔮 Spend ${boost.spend} Amethyst${boost.spend > 1 ? "s" : ""} → Sell ${item.name} (${boost.price}d @ ${boost.scarcitySymbol})`,
                  onClick: () =>
                    sendGameAction({
                      type: "delivery_sell",
                      category: sOpt.category,
                      cardIds: [item.id],
                      missionId: sOpt.missionId || undefined,
                      spendAmethysts: boost.spend,
                    }),
                })
              )
            )
          );
        }
      }
    }

    if (cell && cell.isForum && rev.buys && rev.buys.length > 0) {
      const bSpec = rev.buys[0];
      txButtons.push(
        el("button", {
          type: "button",
          className: "btn btn-sm btn-primary",
          text: `🏛️ Buy ${bSpec.category} at Forum`,
          onClick: () => navigateToMarketBoardForCategory(bSpec.category),
        })
      );
    }

    if (rev.gamble) {
      const alreadyGambled = Boolean(viewer.gambledThisTurn);
      txButtons.push(
        el("button", {
          type: "button",
          className: "btn btn-sm",
          disabled: alreadyGambled || viewer.transactedThisTurn || viewer.cash <= 0,
          text: alreadyGambled ? "🎲 Gambled This Turn ✓" : "🎲 Stadium Gambling (Max 20d)",
          onClick: () => openGambleModal(viewer),
        })
      );
    }
  }

  return el(
    "div",
    { className: "cart-navigation-widget" },
    el(
      "div",
      { className: "cart-nav-status-bar" },
      el("span", { style: { fontWeight: "700", color: "var(--gold-bright)" }, text: locationStatusText }),
      el("span", {
        style: {
          fontWeight: "800",
          color: isMyDeliveryTurn && viewer.movesRemaining > 0 ? "#15803d" : "var(--text-muted)",
        },
        text: movesStatusText,
      })
    ),
    isMyGateEntryTurn
      ? el(
          "div",
          {
            style: {
              marginBottom: "0.6rem",
              padding: "0.5rem 0.6rem",
              borderRadius: "7px",
              background: "rgba(216, 169, 75, 0.1)",
              border: "1px solid rgba(216, 169, 75, 0.35)",
            },
          },
          el("div", {
            style: { fontSize: "0.74rem", fontWeight: "700", color: "var(--gold-bright)", marginBottom: "0.35rem" },
            text: "🚪 Enter Rome via a City Gate:",
          }),
          el(
            "div",
            { style: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.35rem" } },
            ...gateCoords.map((gCoord) =>
              el("button", {
                type: "button",
                className: "btn btn-sm btn-primary",
                text: `🚪 ${gCoord}`,
                title: `Move onto Gate ${gCoord}`,
                onClick: () => sendGameAction({ type: "select_gate", gate: gCoord }),
              })
            )
          )
        )
      : null,
    isCartInRome ? el("div", { className: "compass-grid" }, ...compassNodes) : null,
    txButtons.length > 0
      ? el(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: "0.42rem",
              marginTop: "0.55rem",
              paddingTop: "0.48rem",
              borderTop: "1px solid rgba(110, 82, 50, 0.28)",
            },
          },
          ...txButtons
        )
      : null
  );
}

function renderPlayerSidebar(gs, viewer) {
  const isNavTab = appState.cartPanelTab === "navigate";
  const canSteerNow =
    gs.activePlayerIndex === viewer.index &&
    ((gs.phase === "delivery" && Boolean(viewer.position) && (viewer.movesRemaining || 0) > 0) ||
      gs.phase === "delivery_entry");
  const viewerMissionsDone = Number(viewer.missionsCompleted) || 0;
  const viewerMissionsFail = Number(viewer.missionsFailed) || 0;
  const viewerNetMissions =
    typeof viewer.netMissions === "number" ? viewer.netMissions : viewerMissionsDone - viewerMissionsFail;

  return el(
    "div",
    { className: "sidebar-stack" },
    // All Players Summary
    el(
      "div",
      { className: "panel" },
      el(
        "h3",
        { className: "panel-title" },
        el("span", { text: "👥 Merchants in Rome" }),
        el("span", { style: { fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: "600" }, text: "Click to inspect Cart" })
      ),
      el(
        "div",
        { className: "players-strip" },
        ...gs.players.map((p) => {
          const swatchColor = resolveDieSwatchColor(p.color, "player");
          const pDone = Number(p.missionsCompleted) || 0;
          const pFail = Number(p.missionsFailed) || 0;
          const pNet = typeof p.netMissions === "number" ? p.netMissions : pDone - pFail;
          return el(
            "div",
            {
              className: `player-mini-card clickable-merchant-card ${p.index === gs.activePlayerIndex ? "active-turn" : ""}`,
              style: { borderLeft: `3px solid ${swatchColor}` },
              title: `Click to view ${p.name}'s Cart Mat (${p.usedBlocks}/${p.maxBlocks}■ Goods, ${p.usedGuards}/${p.maxGuards}▲ Guards, Net Missions ${pNet >= 0 ? `+${pNet}` : pNet}, 𐆖${p.cash})`,
              onClick: () => openPlayerCartModal(gs, p, viewer),
            },
            el(
              "div",
              { style: { display: "flex", alignItems: "center", gap: "0.35rem", fontWeight: "700" } },
              renderCartIconNode(p.color, "", `${p.name}'s Cart`),
              el("span", { text: p.eliminated ? `☠️ ${p.name}` : p.name })
            ),
            el("div", {
              style: { color: p.eliminated ? "#b91c1c" : swatchColor, fontWeight: "800", marginTop: "0.2rem" },
              text: p.eliminated ? `☠️ ${p.cash}(d) (Eliminated)` : `💰 ${p.cash}(d)`,
            }),
            el("div", {
              style: { fontSize: "0.71rem", color: "var(--text-muted)" },
              text: `Cart: ${p.usedBlocks}/${p.maxBlocks}■ • ${p.usedGuards}/${p.maxGuards}▲ • 📜 Net ${pNet >= 0 ? `+${pNet}` : pNet}`,
            }),
            el("div", {
              style: { fontSize: "0.72rem", color: p.exitedRome ? "#15803d" : "var(--text-main)", fontWeight: p.exitedRome ? "700" : "400" },
              text: p.position ? `📍 At ${p.position}` : p.exitedRome ? "✓ Exited Safely" : "At Ostia",
            })
          );
        })
      )
    ),

    // Imperial Faction Standings (Directly under Merchants in Rome, above Cart Holdings)
    el(
      "div",
      { className: "panel" },
      el(
        "h3",
        { className: "panel-title" },
        el("span", { text: "🏛️ Faction Standings" }),
        el("span", {
          style: { fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: "600" },
          text: "Click a Gem for Details",
        })
      ),
      el(
        "div",
        { className: "favor-row", style: { margin: "0" } },
        ...FACTION_META.map((fm) => {
          const val = (viewer.favor && viewer.favor[fm.key]) || 0;
          const rivals = (gs.players || []).filter((p) => p.index !== viewer.index);
          return el(
            "div",
            {
              className: "favor-box clickable-favor-box",
              style: { cursor: "pointer" },
              title: `Click to view ${fm.key} Favor breakdown, alignments & deck counts`,
              onClick: () => openFactionFavorModal(gs, viewer, fm.key),
            },
            el("img", { className: "favor-gem-img", src: fm.gem, alt: fm.key }),
            el("div", { style: { fontWeight: "700", color: fm.color }, text: fm.key }),
            el("div", {
              style: {
                fontWeight: "800",
                fontSize: "0.86rem",
                color: val > 0 ? "#15803d" : val < 0 ? "#b91c1c" : "var(--text-main)",
              },
              text: val > 0 ? `+${val}` : String(val),
            }),
            rivals.length > 0
              ? el(
                  "div",
                  { className: "faction-standings-rivals" },
                  ...rivals.map((rv) => {
                    const rVal = (rv.favor && rv.favor[fm.key]) || 0;
                    const rShort = String(rv.name || "Rival").split(" ")[0];
                    return el(
                      "div",
                      {
                        className: "faction-standing-rival-line",
                        title: `${rv.name}: ${rVal > 0 ? `+${rVal}` : rVal} ${fm.key}`,
                      },
                      el(
                        "span",
                        { className: "faction-standing-rival-name" },
                        el("span", {
                          className: "faction-standing-swatch",
                          style: { background: resolveDieSwatchColor(rv.color, "player") },
                        }),
                        el("span", { text: rShort })
                      ),
                      el("strong", {
                        style: {
                          color: rVal > 0 ? "#15803d" : rVal < 0 ? "#b91c1c" : "var(--text-muted)",
                        },
                        text: rVal > 0 ? `+${rVal}` : String(rVal),
                      })
                    );
                  })
                )
              : null
          );
        })
      ),
      renderDomnaMediatorExchangeBar(gs, viewer, false)
    ),

    // Your Merchant Cart Mat & Integrated Navigation + Tile Inspector Tab
    el(
      "div",
      { className: "panel" },
      el(
        "h3",
        { className: "panel-title fresco-banner-header fresco-cart" },
        el(
          "span",
          { style: { display: "inline-flex", alignItems: "center", gap: "0.4rem" } },
          renderCartIconNode(viewer.color, "", `${viewer.name}'s Cart`),
          el("span", { text: `${viewer.name}'s Cart` })
        ),
        el("span", { className: "fresco-header-cash", text: `${viewer.cash}(d)` })
      ),
      el(
        "div",
        { className: "cart-panel-tabs-bar", role: "tablist" },
        el(
          "button",
          {
            type: "button",
            role: "tab",
            "aria-selected": String(!isNavTab),
            className: `cart-panel-tab-btn${!isNavTab ? " is-active" : ""}`,
            title: "View physical Cart Mat (Guards & Cargo)",
            onClick: () => {
              appState.cartPanelTab = "cart";
              renderApp();
            },
          },
          el("span", { text: `🛒 Cart Mat (${viewer.usedBlocks}/${viewer.maxBlocks}■ • ${viewer.usedGuards}/${viewer.maxGuards}▲)` })
        ),
        el(
          "button",
          {
            type: "button",
            role: "tab",
            "aria-selected": String(isNavTab),
            className: `cart-panel-tab-btn${isNavTab ? " is-active" : ""}`,
            title: "Steer your Cart across Rome",
            onClick: () => {
              appState.cartPanelTab = "navigate";
              renderApp();
            },
          },
          canSteerNow ? el("span", { className: "cart-tab-live-dot", title: "Ready to move!" }) : null,
          el("span", {
            text:
              viewer.position && gs.phase === "delivery"
                ? `🧭 Navigate (${viewer.position} • ${viewer.movesRemaining ?? 0} mv)`
                : "🧭 Navigate",
          })
        )
      ),
      isNavTab
        ? renderCartNavigationWidget(gs, viewer)
        : renderPhysicalCartMatNode(gs, viewer, viewer, false)
    ),

    // Active Missions in Portrait 5:7 Format, Subtly Divided by Type (Starting → Encounter → Soothsayer)
    (() => {
      const allMissions = viewer.missions || [];
      const startingMissions = allMissions.filter((m) => !m.source || m.source === "starting");
      const encounterMissions = allMissions.filter((m) => m.source === "encounter");
      const soothsayerMissions = allMissions.filter((m) => m.source === "soothsayer");
      const canActivelyCancel =
        gs.phase !== "setup_discard" && gs.phase !== "setup_climate" && gs.phase !== "finished";
      const canCancelSoothsayer = canActivelyCancel && soothsayerMissions.length > 5;
      const bondedCouriersActive = hasActiveClimateOption(gs, "missions_3");

      const activeGroups = [
        {
          key: "starting",
          title: `Starting (${startingMissions.length})`,
          sub: bondedCouriersActive ? "-10(d) Fine" : "No penalty",
          missions: startingMissions,
          canCancel: canActivelyCancel,
          cancelLabel: bondedCouriersActive ? "✕ Cancel (-10d Fine)" : "✕ Cancel (No Penalty)",
        },
        {
          key: "encounter",
          title: `Encounter (${encounterMissions.length})`,
          sub: bondedCouriersActive ? "👎 + -10(d) Fine" : "👎 Penalty",
          missions: encounterMissions,
          canCancel: canActivelyCancel,
          cancelLabel: bondedCouriersActive ? "✕ Cancel (👎 + -10d)" : "✕ Cancel (👎 Penalty)",
        },
        {
          key: "soothsayer",
          title: `Soothsayer (${soothsayerMissions.length})`,
          sub: canCancelSoothsayer ? "Cancel 1 Free" : bondedCouriersActive ? "🔒 2× Cash / -10d" : "🔒 Mandatory",
          missions: soothsayerMissions,
          canCancel: canCancelSoothsayer,
          cancelLabel: "✕ Cancel Overflow (Free)",
        },
      ].filter((g) => g.missions.length > 0);

      const rowChildren = [];
      activeGroups.forEach((g, idx) => {
        if (idx > 0) {
          rowChildren.push(
            el("div", {
              className: "mission-group-divider",
              title: `${activeGroups[idx - 1].title} | ${g.title}`,
            })
          );
        }
        rowChildren.push(
          el(
            "div",
            {
              className: `mission-row-group mission-group-${g.key}`,
            },
            el(
              "div",
              { className: `mission-section-hdr ${g.key}` },
              el("span", { className: "mission-section-title", text: g.title }),
              el("span", { className: "mission-section-sub", text: g.sub })
            ),
            el(
              "div",
              {
                className: "mission-row-group-cards",
              },
              ...g.missions.map((m) =>
                renderPhysicalMissionCardNode(m, {
                  showStatusTag: true,
                  canCancel: g.canCancel,
                  cancelLabel: g.cancelLabel,
                  soothsayerTotalCount: soothsayerMissions.length,
                })
              )
            )
          )
        );
      });

      return el(
        "div",
        { className: "panel" },
        el(
          "h3",
          { className: "panel-title" },
          el(
            "span",
            { text: `📜 Active Missions (${allMissions.length})${bondedCouriersActive ? " [2× Cash / -10d Fail]" : ""}` }
          ),
          soothsayerMissions.length > 5
            ? el("span", {
                style: {
                  fontSize: "0.72rem",
                  background: "#b45309",
                  color: "#fff",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  fontWeight: "700",
                },
                text: "⚠️ 6 Soothsayer Missions — Cancel 1 Free!",
              })
            : el("span", {
                style: {
                  fontSize: "0.72rem",
                  color: viewerNetMissions > 0 ? "#15803d" : viewerNetMissions < 0 ? "#b91c1c" : "var(--text-muted)",
                  fontWeight: "700",
                },
                title: "Tracks Missions Completed (✓) vs Missions Failed (✕) — including unfinished missions at Winter Reckoning",
                text: `✓${viewerMissionsDone} • ✕${viewerMissionsFail} (Net ${
                  viewerNetMissions >= 0 ? `+${viewerNetMissions}` : viewerNetMissions
                })`,
              })
        ),
        gs.phase === "setup_discard" && !viewer.setupDiscarded
          ? el("div", {
              className: "mission-section-empty",
              text: "Select 2 of your 5 Starting Missions to discard in the Setup panel.",
            })
          : allMissions.length === 0
          ? el("div", { className: "mission-section-empty", text: "No active missions." })
          : el(
              "div",
              {
                className: "missions-single-row",
              },
              ...rowChildren
            )
      );
    })(),

    // Influence Cards & Scouted Intelligence (Physical Card Format)
    el(
      "div",
      { className: "panel" },
      el("h3", { className: "panel-title", text: `🃏 Influence Cards (${(viewer.influence || []).length})` }),
      gs.phase === "setup_discard" && !viewer.setupDiscarded
        ? el("div", {
            style: { fontSize: "0.8rem", color: "var(--text-muted)" },
            text: "Select 2 of your 5 Starting Influence cards to discard in the Setup panel.",
          })
        : (viewer.influence || []).length === 0
        ? el("div", { style: { fontSize: "0.8rem", color: "var(--text-muted)" }, text: "No Influence cards in hand." })
        : el(
            "div",
            { className: "phys-cards-grid compact-sidebar-grid" },
            ...(viewer.influence || []).map((c) => {
              const effCode = String(c.effectCode || "");
              const effTxt = String(c.effectText || "").toLowerCase();
              const cName = String(c.name || "");
              const isTop3Card =
                effCode.startsWith("reorder_top_3") ||
                cName.toLowerCase().includes("informants") ||
                effTxt.includes("look at the top three");
              const isProcurerCard =
                effCode === "buy_any_good_common" ||
                cName.toLowerCase() === "procurer";
              const isProphecyCard = cName === "Prophecy" || effCode === "trigger_soothsayer";
              const isSurpriseShipmentCard =
                cName === "Surprise Shipment" || effCode === "shift_category_scarcity_right";
              const isShortcutCard = cName.includes("Shortcut") || effCode === "shortcut";
              const isReactiveOnly = cName === "Twist Of Fate" || cName === "Lucky Break";
              const pend = gs.pendingEncounter;
              const canPlayShortcutNow =
                gs.phase === "delivery" &&
                gs.activePlayerIndex === viewer.index &&
                Boolean(viewer.position) &&
                !viewer.exitedRome &&
                !viewer.nightEnded &&
                Number(viewer.movesRemaining || 0) > 0 &&
                !pend &&
                !viewer.pendingNpcOffer &&
                !viewer.pendingCartOverflow &&
                !viewer.pendingMarketReward &&
                !(viewer.turnEffects && viewer.turnEffects.shortcut);
              const pendStage = pend ? pend.stage || "pre_decision" : null;
              const isViewerInPostRoll =
                Boolean(pend) &&
                (pend.playerIndex === viewer.index || pend.interveningPlayerIndex === viewer.index) &&
                (cName === "Twist Of Fate"
                  ? [
                      "combat_post_roll",
                      "driver_fate_post_roll",
                      "chart_post_roll",
                      "demand_post_roll",
                      "gamble_post_roll",
                    ].includes(pendStage)
                  : ["driver_fate_post_roll", "chart_post_roll"].includes(pendStage) &&
                    pend.chartType !== "soothsayer");

              let actionNode = null;
              if (
                isReactiveOnly &&
                !isViewerInPostRoll &&
                gs.phase !== "setup_discard" &&
                gs.phase !== "setup_climate" &&
                gs.phase !== "finished"
              ) {
                actionNode = el("div", {
                  style: {
                    fontSize: "0.68rem",
                    color: "#92400e",
                    textAlign: "center",
                    padding: "0.24rem 0.4rem",
                    background: "#fef3c7",
                    border: "1px solid #d97706",
                    borderRadius: "5px",
                    fontWeight: "700",
                  },
                  text: "⚡ Reactive on Die Rolls",
                });
              } else if (
                isShortcutCard &&
                !canPlayShortcutNow &&
                gs.phase !== "setup_discard" &&
                gs.phase !== "setup_climate" &&
                gs.phase !== "finished"
              ) {
                actionNode = el("div", {
                  style: {
                    fontSize: "0.68rem",
                    color: "#92400e",
                    textAlign: "center",
                    padding: "0.24rem 0.4rem",
                    background: "#fef3c7",
                    border: "1px solid #d97706",
                    borderRadius: "5px",
                    fontWeight: "700",
                  },
                  title:
                    viewer.turnEffects && viewer.turnEffects.shortcut
                      ? "Shortcut is already readied for your move this turn"
                      : "Shortcut can only be played on your Night Delivery turn when you have movement remaining",
                  text:
                    viewer.turnEffects && viewer.turnEffects.shortcut
                      ? "✨ Shortcut Readied"
                      : "🛣️ Play When Moving",
                });
              } else if (
                (isViewerInPostRoll || gs.activePlayerIndex === viewer.index) &&
                gs.phase !== "setup_discard" &&
                gs.phase !== "setup_climate" &&
                gs.phase !== "finished"
              ) {
                const needsThugSwap =
                  cName.includes("Thug") && !doesItemFitWithoutSwap(viewer, { reqGuards: 1 });
                const needsWineForgerSwap =
                  cName.includes("Wine Forger") && !doesItemFitWithoutSwap(viewer, { reqBlocks: 1 });
                const isArmedCard = Boolean(appState.armedDieAction && appState.armedDieAction.cardId === c.id);
                actionNode = el("button", {
                  className: `btn btn-sm ${isArmedCard ? "btn-crimson" : "btn-primary"}`,
                  style: { width: "100%", fontSize: "0.72rem", padding: "0.28rem 0.5rem" },
                  text:
                    cName === "Casus Belli"
                      ? "⚔️ Play Casus Belli"
                      : isTop3Card
                      ? "👁️ Inspect & Reorder Top 3"
                      : isProcurerCard
                      ? "🛒 Choose Good @ Common (>)"
                      : isProphecyCard
                      ? "🔮 Summon Soothsayer..."
                      : isSurpriseShipmentCard
                      ? "🚢 Shift Category Scarcity..."
                      : isShortcutCard
                      ? "🛣️ Ready Shortcut for Move"
                      : isReactiveOnly
                      ? isArmedCard
                        ? "👆 Click Any Die to Apply"
                        : "🎲 Click a Die to Apply"
                      : needsThugSwap
                      ? "▶ Play Card (Fire Guard)"
                      : needsWineForgerSwap
                      ? "▶ Play Card (Swap Good)"
                      : "▶ Play Card",
                  onClick: (e) => {
                    e.stopPropagation();
                    if (isTop3Card) {
                      openInformantsTargetModal(gs, viewer, c);
                    } else if (isProcurerCard) {
                      openProcurerGoodModal(gs, viewer, c);
                    } else if (isProphecyCard) {
                      openProphecyTargetModal(gs, viewer, c);
                    } else if (isSurpriseShipmentCard) {
                      openSurpriseShipmentModal(gs, viewer, c);
                    } else {
                      triggerInfluenceCardPlay(gs, viewer, c);
                    }
                  },
                });
              }

              return renderPhysicalInfluenceCardNode(c, {
                actionButton: actionNode,
              });
            })
          ),
      (viewer.scoutedInfo || []).length > 0
        ? el(
            "div",
            { style: { marginTop: "0.75rem", paddingTop: "0.6rem", borderTop: "1px solid var(--border-subtle)" } },
            el("div", { style: { fontWeight: "700", fontSize: "0.82rem", color: "#0369a1", marginBottom: "0.35rem" }, text: "👁️ Scouted Intelligence (Click to View):" }),
            ...(viewer.scoutedInfo || []).slice(-5).map((si) =>
              el(
                "div",
                {
                  style: {
                    fontSize: "0.74rem",
                    marginBottom: "0.3rem",
                    color: "var(--text-main)",
                    padding: "0.3rem 0.45rem",
                    borderRadius: "5px",
                    background: "#f0f9ff",
                    border: "1px solid #7dd3fc",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "0.4rem",
                  },
                  onClick: () => openScoutResultModal(si),
                },
                el("span", { text: `• ${si.label}: ${si.summary}` }),
                el("span", { style: { color: "#0369a1", fontWeight: "700", flexShrink: "0" }, text: "🔍 View" })
              )
            )
          )
        : null
    ),

    // Chronicle Game Log
    el(
      "div",
      { id: "chronicle-of-rome-panel", className: "panel" },
      el("h3", { className: "panel-title", text: "📖 Chronicle of Rome" }),
      el(
        "div",
        {
          id: "chronicle-log-box",
          className: "log-box",
          onScroll: (e) => {
            const st = e.currentTarget.scrollTop;
            appState.chronicleScrollTop = st;
            appState.chronicleUserScrolled = st > 4;
          },
        },
        ...(gs.logs || [])
          .slice()
          .reverse()
          .map((lg) =>
            el("div", { className: `log-entry cat-${lg.category || "info"}`, text: `[${lg.season} T${lg.turn}] ${lg.text}` })
          )
      )
    )
  );
}

/* =========================================================================
   MODALS FOR SOURCING, SCOUTING, CARGO LOADING, TRASHING, FORUM BUY, & GAMBLING
   ========================================================================= */

/**
 * Displays the up-close view of a face-up tile (or the tile currently occupied by the player's Cart),
 * with an Interact button (which opens the Scout/Move/End Turn interface) and a Close button.
 */
function openFaceUpTileUpCloseModal(gs, viewer, coord, cell, tileData, moveOpts = null) {
  const cellName = cell ? cell.name : coord;
  const isCurrent = Boolean(viewer && viewer.position === coord && !viewer.exitedRome);
  const occupants = ((gs && gs.players) || []).filter((p) => p.position === coord && !p.exitedRome);
  const exposedTile = (cell && cell.revealed) || null;
  const isScoutedPreview = Boolean(!exposedTile && tileData);
  const rev = exposedTile || tileData || null;
  const unrevealedCount = cell
    ? Number(
        cell.stackCount !== undefined
          ? cell.stackCount
          : cell.unrevealedCount !== undefined
          ? cell.unrevealedCount
          : 12
      )
    : 0;

  const sellsStr =
    rev && Array.isArray(rev.sells) && rev.sells.length > 0
      ? rev.sells.map((s) => `${s.category} (${formatTileModifier(s.modifier)})`).join(", ")
      : "None";
  const buysStr =
    rev && Array.isArray(rev.buys) && rev.buys.length > 0
      ? rev.buys.map((b) => `${b.category} (${formatTileModifier(b.modifier)})`).join(", ")
      : null;
  const centerParts = rev
    ? [
        rev.encounter ? formatEdgeLabel(rev.encounter) : "No Center Encounter",
        rev.gamble ? "Stadium Gambling (≤20(d))" : null,
        rev.persistent ? "Persistent (⤹)" : rev.refresh ? "Refresh (↻)" : "Standard Tile",
      ].filter(Boolean)
    : [];

  const featureLines = [];
  if (cell && cell.isGate) {
    featureLines.push("⛩️ Via City Gate Entrance & Exit (halves 6:00 A.M. Curfew Fine)");
  }
  if (cell && cell.isForum) {
    featureLines.push("🏛️ Imperial Forum Market (purchase Goods when revealed)");
  }
  const bridgesHere = TIBER_BRIDGE_BADGES_BY_CELL[coord] || [];
  if (bridgesHere.length > 0) {
    featureLines.push(`🌉 Tiber Bridge: ${bridgesHere.map((b) => b.label).join(", ")}`);
  }

  let crossingNote = "";
  const adjInfo = (moveOpts && moveOpts.adjInfo) || null;
  if (adjInfo && viewer && viewer.position && viewer.position !== coord) {
    const dir = adjInfo.dir || moveOpts.moveDir || "";
    const riverBlocked = Boolean(adjInfo.blockedByRiver) || isTiberCrossingBlocked(viewer.position, coord);
    const bridgeName = adjInfo.bridgeName || adjInfo.bridge || getTiberBridgeName(viewer.position, coord);
    const shortcutActive = Boolean(viewer.turnEffects && viewer.turnEffects.shortcut);
    const isPassable = !riverBlocked && (adjInfo.passable || shortcutActive);
    const tollAmt = !shortcutActive ? parseTollAmount(adjInfo.edge) : 0;
    const isHazard =
      !riverBlocked &&
      !shortcutActive &&
      tollAmt <= 0 &&
      Boolean(adjInfo.edge && !["green", "red", "None"].includes(String(adjInfo.edge)));
    if (riverBlocked) {
      crossingNote = `🌊 Blocked by Tiber River (${viewer.position} → ${coord})`;
    } else if (!isPassable) {
      crossingNote = `⛔ Red Barricade (${viewer.position} → ${coord})`;
    } else if (shortcutActive && !adjInfo.passable) {
      crossingNote = `✨ Shortcut Bypasses Barricade (${dir})`;
    } else if (tollAmt > 0) {
      crossingNote = `${bridgeName ? `🌉 ${bridgeName} • ` : ""}Road Toll: ${tollAmt}(d) (${dir})`;
    } else if (isHazard) {
      crossingNote = `${bridgeName ? `🌉 ${bridgeName} • ` : ""}Edge Hazard: ${formatEdgeLabel(adjInfo.edge)} (${dir})`;
    } else {
      crossingNote = bridgeName
        ? `🌉 Cross ${bridgeName} — Open Street (${dir})`
        : `✓ Open Street (${viewer.position} → ${coord})`;
    }
  }

  const proceedToNeighborhoodActions = (e) => {
    if (e && typeof e.stopPropagation === "function") {
      e.stopPropagation();
    }
    openConfirmScoutNeighborhoodModal(gs, viewer, coord, cell, moveOpts);
  };

  showModal(
    `🔍 Tile ${coord} — ${cellName}`,
    el(
      "div",
      { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "0.85rem" } },
      el(
        "div",
        {
          style: {
            display: "flex",
            gap: "0.45rem",
            flexWrap: "wrap",
            justifyContent: "center",
            alignItems: "center",
          },
        },
        el("span", {
          className: "badge",
          style: isScoutedPreview
            ? { borderColor: "#38bdf8", color: "#0369a1", background: "#f0f9ff", fontWeight: "800" }
            : exposedTile
            ? { borderColor: "var(--gold)", background: "#fefce8", color: "#713f12", fontWeight: "700" }
            : {},
          text: isScoutedPreview
            ? `👁️ Scouted Top Tile (${unrevealedCount} in Stack)`
            : exposedTile
            ? "Exposed Face-Up Tile"
            : `${unrevealedCount} Face-Down Tile${unrevealedCount === 1 ? "" : "s"} in Stack`,
        }),
        ...occupants.map((p) =>
          el(
            "span",
            {
              className: "badge",
              style:
                viewer && p.index === viewer.index
                  ? { borderColor: "var(--gold-bright)", background: "#fefce8", color: "#713f12", fontWeight: "800" }
                  : {},
            },
            renderCartIconNode(p.color, "cart-icon-xs", `${p.name}'s Cart`),
            el("span", {
              style: { marginLeft: "0.3rem" },
              text: viewer && p.index === viewer.index ? `${p.name} (Your Cart)` : p.name,
            })
          )
        )
      ),
      el(
        "div",
        { style: { width: "280px", maxWidth: "100%", margin: "0 auto" } },
        rev ? renderDynamicTileCardNode(rev, coord, "inspector") : renderDynamicTileBackNode(coord, cell)
      ),
      el(
        "div",
        {
          style: {
            width: "100%",
            padding: "0.65rem 0.85rem",
            borderRadius: "6px",
            background: "#fbf7ee",
            border: "1.5px solid #a88d6b",
            boxShadow: "var(--bevel-sunken)",
            fontSize: "0.84rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.25rem",
          },
        },
        el(
          "div",
          {},
          el("strong", { style: { color: "var(--gold-bright)" }, text: "Neighborhood: " }),
          `${coord} — ${cellName}${isCurrent ? " (Your Current Tile)" : ""}`
        ),
        rev
          ? [
              el("div", {}, el("strong", { style: { color: "var(--gold-bright)" }, text: "Buys: " }), sellsStr),
              buysStr ? el("div", {}, el("strong", { style: { color: "#0369a1" }, text: "Forum Sells: " }), buysStr) : null,
              centerParts.length > 0
                ? el(
                    "div",
                    {},
                    el("strong", { style: { color: "var(--gold-bright)" }, text: "Properties: " }),
                    centerParts.join(" • ")
                  )
                : null,
            ]
          : el(
              "div",
              {},
              el("strong", { style: { color: "var(--gold-bright)" }, text: "Stack: " }),
              `Unrevealed neighborhood stack (${unrevealedCount} face-down tile${unrevealedCount === 1 ? "" : "s"}).`
            ),
        ...featureLines.map((line) =>
          el("div", { style: { color: "#78350f", fontWeight: "700", fontSize: "0.8rem" }, text: line })
        ),
        crossingNote
          ? el("div", {
              style: {
                marginTop: "0.2rem",
                paddingTop: "0.22rem",
                borderTop: "1px solid rgba(168, 141, 107, 0.45)",
                fontWeight: "700",
                color: "#6e2119",
              },
              text: crossingNote,
            })
          : null,
        el("div", {
          style: { marginTop: "0.2rem", fontSize: "0.75rem", color: "var(--text-muted)", fontStyle: "italic" },
          text: "Click this popup for Scout, Move, or End Turn options (or click outside / Close to dismiss).",
        })
      ),
      el(
        "div",
        {
          style: {
            width: "100%",
            display: "flex",
            justifyContent: "flex-end",
            gap: "0.6rem",
            paddingTop: "0.65rem",
            borderTop: "1px solid var(--border-subtle)",
          },
        },
        el("button", {
          id: "modal-tile-interact-btn",
          type: "button",
          className: "btn btn-primary",
          text: "🧭 Scout / Move / End Turn",
          onClick: proceedToNeighborhoodActions,
        }),
        el("button", {
          type: "button",
          className: "btn",
          "data-modal-close": "1",
          text: "Close",
          onClick: (e) => {
            e.stopPropagation();
            closeModal();
          },
        })
      )
    ),
    {
      onBoxClick: proceedToNeighborhoodActions,
    }
  );
}

function openConfirmScoutNeighborhoodModal(gs, viewer, coord, cell, moveOpts = null) {
  const cellName = cell ? cell.name : coord;
  const unrevealedCount = cell
    ? Number(
        cell.stackCount !== undefined
          ? cell.stackCount
          : cell.unrevealedCount !== undefined
          ? cell.unrevealedCount
          : 12
      )
    : 0;
  const isEntryPhase = gs.phase === "delivery_entry";
  const isDeliveryPhase = gs.phase === "delivery";
  const isMyTurn = Boolean(
    gs &&
      viewer &&
      gs.activePlayerIndex === viewer.index &&
      (isEntryPhase || isDeliveryPhase) &&
      !viewer.exitedRome &&
      !viewer.nightEnded
  );
  const isGateCell = Boolean(cell && cell.isGate);
  const isGateEntrance = Boolean(isEntryPhase && isGateCell && isMyTurn);
  const canScoutTile = Boolean(isMyTurn && !viewer.scoutedThisTurn && unrevealedCount > 0);
  const canScoutDeck = Boolean(isMyTurn && !viewer.scoutedThisTurn);
  const moveDir = moveOpts && moveOpts.moveDir ? String(moveOpts.moveDir) : null;
  const adjInfo = (moveOpts && moveOpts.adjInfo) || null;
  const canMoveStep = Boolean(
    !isEntryPhase &&
      isDeliveryPhase &&
      isMyTurn &&
      moveDir &&
      Number(viewer.movesRemaining || 0) > 0
  );
  const canMoveHere = Boolean(canMoveStep || isGateEntrance);
  const canEndTurnHere = Boolean(!isEntryPhase && isDeliveryPhase && isMyTurn);

  const unusedMoves = isMyTurn
    ? isEntryPhase
      ? 1
      : Math.max(0, Number(viewer.movesRemaining || 0))
    : 0;
  const unusedTransactions =
    isMyTurn && isDeliveryPhase && !viewer.transactedThisTurn ? 1 : 0;

  let crossingNote = "";
  if (canMoveStep && adjInfo) {
    const shortcutActive = Boolean(viewer.turnEffects && viewer.turnEffects.shortcut);
    const bridgeName = adjInfo.bridgeName || adjInfo.bridge || getTiberBridgeName(viewer.position, coord);
    const tollAmt = !shortcutActive ? parseTollAmount(adjInfo.edge) : 0;
    const isHazard =
      !shortcutActive &&
      tollAmt <= 0 &&
      Boolean(adjInfo.edge && !["green", "red", "None"].includes(String(adjInfo.edge)));
    if (shortcutActive && !adjInfo.passable) {
      crossingNote = `Crossing ${moveDir} via ✨ Shortcut.`;
    } else if (tollAmt > 0) {
      crossingNote = `Crossing ${moveDir}${bridgeName ? ` (${bridgeName})` : ""} — Road Toll: ${tollAmt}(d).`;
    } else if (isHazard) {
      crossingNote = `Crossing ${moveDir}${bridgeName ? ` (${bridgeName})` : ""} — Edge Encounter: ${formatEdgeLabel(adjInfo.edge)}.`;
    } else if (bridgeName) {
      crossingNote = `Crossing ${moveDir} across ${bridgeName} (Open Street).`;
    } else {
      crossingNote = `Crossing ${moveDir} via Open Street.`;
    }
  }

  let modalTitle = `🧭 Neighborhood ${coord} — ${cellName}`;
  let promptDescription = "";
  if (!isMyTurn) {
    promptDescription = `Inspecting ${coord} (${cellName}) (${unrevealedCount} face-down tile(s) in stack). Actions are greyed out because it is not currently your Night Delivery turn.`;
  } else if (isEntryPhase) {
    modalTitle = isGateEntrance
      ? `🚪 Entrance & Neighborhood ${coord} — ${cellName}`
      : `👁️ Neighborhood ${coord} — ${cellName}`;
    if (isGateEntrance && canScoutTile) {
      promptDescription = `${coord} (${cellName}) is an available Via Entrance into Rome (${unrevealedCount} face-down tiles in stack). You may Scout 1 tile or deck card first, or Move onto ${coord} as your entrance for the night.`;
    } else if (isGateEntrance) {
      promptDescription = `${coord} (${cellName}) is an available Via Entrance into Rome (you have already used your Initial Scout this night). Move onto ${coord} to start Night Delivery.`;
    } else if (canScoutTile) {
      promptDescription = `You may use your pre-night Initial Scout to peek at the top face-down tile of ${coord} (${cellName}) (${unrevealedCount} face-down tiles in stack) or a deck card. To enter Rome, select one of the six gold-outlined Via entrances (A4, B1, B6, E1, F3, or F6).`;
    } else {
      promptDescription = `You have already used your Initial Scout before this night, and ${coord} (${cellName}) is not a Via entrance. Click one of the six gold-outlined Via entrances (A4, B1, B6, E1, F3, or F6) to start Night Delivery.`;
    }
  } else if (canMoveStep && canScoutTile) {
    modalTitle = `🧭 Adjacent Neighborhood ${coord} — ${cellName} (${moveDir})`;
    promptDescription = `${coord} (${cellName}) is adjacent (${moveDir}) and has ${unrevealedCount} face-down tile(s) in its stack. Move your Cart into ${coord} now, or Scout at the end of your turn (committing to Scout ends your turn so the next merchant can begin).`;
  } else if (canMoveStep) {
    modalTitle = `🧭 Adjacent Neighborhood ${coord} — ${cellName} (${moveDir})`;
    promptDescription = `${coord} (${cellName}) is adjacent (${moveDir}). Move your Cart into ${coord}, or End Turn.`;
  } else if (canScoutTile) {
    promptDescription = `Scout the top face-down tile of ${coord} (${cellName}) (${unrevealedCount} face-down tile(s) in stack) or a deck card at the end of your turn? Committing to Scout immediately advances the turn to the next merchant while you examine the scouted card or tile.`;
  } else if (viewer.scoutedThisTurn) {
    promptDescription = `You have already used your Scout action this turn.`;
  } else {
    promptDescription = `There are no unrevealed tiles remaining in ${coord} (${cellName}), and this neighborhood is not currently reachable in 1 move.`;
  }

  const unusedIndicatorItems = [];
  if (unusedMoves > 0) {
    unusedIndicatorItems.push(
      el(
        "span",
        {
          style: { display: "inline-flex", alignItems: "center", gap: "0.28rem", fontWeight: "800", fontSize: "0.78rem", color: "#54150f" },
          title: `${unusedMoves} unused Move action${unusedMoves > 1 ? "s" : ""} remaining this turn`,
        },
        createMoveActionCircleNode(),
        el("span", { text: `×${unusedMoves}` })
      )
    );
  }
  if (unusedTransactions > 0) {
    unusedIndicatorItems.push(
      el(
        "span",
        {
          style: { display: "inline-flex", alignItems: "center", gap: "0.28rem", fontWeight: "800", fontSize: "0.78rem", color: "#54150f" },
          title: `${unusedTransactions} unused Transaction action remaining this turn`,
        },
        createTransactionActionCircleNode(),
        el("span", { text: `×${unusedTransactions}` })
      )
    );
  }

  const moveBtnLabel = isEntryPhase
    ? `🚪 Move to Gate ${coord}`
    : moveDir
    ? `🛒 Move to ${coord} (${moveDir})`
    : `🛒 Move to ${coord}`;

  showModal(
    modalTitle,
    el(
      "div",
      {},
      el("p", {
        style: { fontSize: "0.9rem", color: "var(--text-main)", marginTop: "0" },
        text: promptDescription,
      }),
      crossingNote
        ? el("p", {
            style: {
              fontSize: "0.82rem",
              fontWeight: "700",
              color: "#6e2119",
              background: "#f8f1e1",
              border: "1px solid #c7af88",
              borderRadius: "5px",
              padding: "0.4rem 0.65rem",
              marginTop: "0.45rem",
            },
            text: replaceDenariiTokens(crossingNote),
          })
        : null,
      el(
        "div",
        {
          style: {
            display: "flex",
            gap: "0.85rem",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "flex-end",
            marginTop: "1rem",
            paddingTop: "0.75rem",
            borderTop: "1px solid var(--border-subtle)",
          },
        },
        el(
          "div",
          {
            style: {
              display: "flex",
              gap: "0.55rem",
              flexWrap: "wrap",
              alignItems: "center",
              flex: "1 1 auto",
            },
          },
          el("button", {
            id: "modal-move-to-btn",
            type: "button",
            className: canMoveHere ? "btn btn-primary" : "btn",
            disabled: !canMoveHere,
            title: canMoveHere
              ? `Move your Cart to ${coord}`
              : "Move to this tile is currently unavailable",
            text: moveBtnLabel,
            onClick: () => {
              if (!canMoveHere) return;
              closeModal();
              if (isGateEntrance) {
                sendGameAction({ type: "select_gate", gate: coord });
              } else {
                sendGameAction({ type: "delivery_move", direction: moveDir });
              }
            },
          }),
          el("button", {
            id: "modal-scout-tile-btn",
            type: "button",
            className: canScoutTile && !canMoveHere ? "btn btn-primary" : "btn",
            disabled: !canScoutTile,
            title: canScoutTile
              ? isEntryPhase
                ? `Scout the top face-down tile of ${coord} before entering Rome`
                : `Scout the top face-down tile of ${coord} and end your turn`
              : "Scout Tile is unavailable (already scouted, no face-down tiles, or not your turn)",
            text: `👁️ Scout Tile ${coord}`,
            onClick: () => {
              if (!canScoutTile) return;
              closeModal();
              if (isEntryPhase) {
                sendGameAction({ type: "initial_scout", targetType: "tile", cell: coord });
              } else {
                sendGameAction({ type: "delivery_scout", targetType: "tile", targetKey: coord });
              }
            },
          }),
          el("button", {
            id: "modal-scout-deck-btn",
            type: "button",
            className: "btn",
            disabled: !canScoutDeck,
            title: canScoutDeck
              ? "Scout the top card of an Encounter deck"
              : "Scout Deck Card is unavailable (already scouted or not your turn)",
            text: "🃏 Scout Deck Card",
            onClick: () => {
              if (!canScoutDeck) return;
              closeModal();
              openScoutModal(gs, viewer);
            },
          })
        ),
        el(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "0.32rem",
              marginLeft: "auto",
            },
          },
          unusedIndicatorItems.length > 0
            ? el(
                "div",
                {
                  className: "unused-turn-actions-indicator",
                  style: {
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.45rem",
                    padding: "0.2rem 0.5rem",
                    borderRadius: "999px",
                    background: "#fbf3df",
                    border: "1px solid #b59257",
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.65)",
                  },
                  title: "Unused Move (Cart in circle) and/or Transaction (Denarius in circle) actions remaining this turn",
                },
                el("span", {
                  style: { fontSize: "0.68rem", fontWeight: "800", textTransform: "uppercase", letterSpacing: "0.04em", color: "#6e2119" },
                  text: "Unused:",
                }),
                ...unusedIndicatorItems
              )
            : null,
          el("button", {
            id: "modal-end-turn-btn",
            type: "button",
            className: "btn btn-crimson",
            disabled: !canEndTurnHere,
            title: canEndTurnHere
              ? "End your hourly turn"
              : "End Turn is unavailable when it is not your turn (or before selecting a starting Via Gate)",
            text: "⏭️ End Turn",
            onClick: () => {
              if (!canEndTurnHere) return;
              closeModal();
              sendGameAction({ type: "delivery_end_turn" });
            },
          })
        )
      )
    )
  );
}

function openNpcOfferModal(gs, viewer) {
  const offer = viewer && viewer.pendingNpcOffer;
  if (!offer) return;
  const isBuy = (offer.mode || offer.offerType) === "buy_from_npc";
  const npcName = offer.npcName || (offer.npcCard && offer.npcCard.name) || "Patron";
  const candidates = Array.isArray(offer.candidates) ? offer.candidates : [];
  const usedBlocks = Number(viewer.usedBlocks) || 0;
  const maxBlocks = Number(viewer.maxBlocks) || 6;

  const candidateCards = candidates.map((cand) => {
    const c = cand.card || {};
    const trackName = c.track || offer.category || "Animals";
    const trackClass = resolveGoodTrackClass(trackName);
    const reqBlocks = Math.max(1, Number(c.blocks) || 1);
    const blocksSymbols = "■".repeat(reqBlocks);
    const price = Number(cand.price) || 0;
    const canAfford = !isBuy || viewer.cash >= price;
    const fitsInCart = !isBuy || usedBlocks + reqBlocks <= maxBlocks;
    const canSwap = fitsInCart || (Array.isArray(viewer.cart) && viewer.cart.length > 0);
    const canSelect = canAfford && canSwap;

    let sourceBadgeText = cand.sourceLabel || "Ostia Market";
    if (cand.source === "market") {
      sourceBadgeText = `⚓ Ostia Market (Col ${(cand.colIndex || 0) + 1})`;
    } else if (cand.source === "deck") {
      sourceBadgeText = "📦 Goods Deck";
    } else if (cand.source === "cart") {
      sourceBadgeText = "🛒 Your Cart";
    }

    let btnText = isBuy ? `💰 Buy for ${price}(d)` : `💰 Sell for ${price}(d)`;
    if (isBuy && !canAfford) {
      btnText = `Requires ${price}(d)`;
    } else if (isBuy && !fitsInCart) {
      btnText = `💰 Buy for ${price}(d) (Swap)`;
    }

    return el(
      "div",
      {
        className: "good-card-unit",
        style: { width: "196px" },
      },
      el(
        "div",
        {
          style: {
            fontSize: "0.66rem",
            fontWeight: "800",
            color: "var(--gold-bright)",
            textAlign: "center",
          },
          text: sourceBadgeText,
        }
      ),
      el(
        "div",
        {
          className: `market-good-card ${trackClass}`,
        },
        el(
          "div",
          { className: "market-good-card-inner" },
          el(
            "div",
            { className: "good-card-header" },
            el("div", { className: "slot-card-name", text: c.name || offer.category }),
            el(
              "div",
              { className: "slot-sub" },
              c.subtitle ? `(${c.subtitle})` : c.subcategory || c.category || trackName
            ),
            c.combatText ? el("div", { className: "good-combat-line", text: c.combatText }) : null
          ),
          renderGoodCardArtNode(c, trackName, false),
          el(
            "div",
            { className: "good-card-footer" },
            el("div", { className: "good-blocks-row", text: blocksSymbols }),
            renderGoodPriceTableNode(c, trackName, typeof cand.colIndex === "number" ? cand.colIndex : 2)
          )
        )
      ),
      el(
        "div",
        { className: "good-card-external-meta" },
        el("button", {
          type: "button",
          className: `btn btn-sm ${canSelect ? "btn-primary" : ""}`,
          style: { width: "100%" },
          disabled: !canSelect,
          text: btnText,
          onClick: () => {
            if (!isBuy || fitsInCart) {
              closeModal();
              sendGameAction({
                type: "resolve_npc_offer",
                decision: "accept",
                candidateId: cand.id || cand.uid,
                cardId: cand.cardId || c.id,
              });
            } else {
              openCartReplacementModal(viewer, {
                itemType: "good",
                incomingCard: c,
                reqBlocks,
                reqGuards: 0,
                bonusBlocks: 0,
                bonusGuards: 0,
                title: `🤝 Cart Space Full — Discard Goods to Buy ${c.name || offer.category}`,
                subtitle: `Buying "${c.name || offer.category}" (${reqBlocks}■) from ${npcName} costs ${price}(d). Select Goods on your Cart to discard so it fits, or return to ${npcName}'s offer.`,
                confirmLabelPrefix: `Buy ${c.name || offer.category} for ${price}(d)`,
                cancelLabel: "← Back to Offer",
                onConfirm: (discardCartIds, fireGuardIds) => {
                  sendGameAction({
                    type: "resolve_npc_offer",
                    decision: "accept",
                    candidateId: cand.id || cand.uid,
                    cardId: cand.cardId || c.id,
                    discardCartIds,
                    fireGuardIds,
                  });
                },
                onCancel: () => openNpcOfferModal(gs, viewer),
              });
            }
          },
        })
      )
    );
  });

  showModal(
    `🤝 ${npcName}'s Offer — ${isBuy ? `Buy 1 ${offer.category}` : `Sell 1 ${offer.category}`}`,
    el(
      "div",
      {},
      el(
        "div",
        {
          style: {
            padding: "0.6rem 0.85rem",
            background: "rgba(212, 175, 55, 0.14)",
            border: "1px solid var(--gold)",
            borderRadius: "6px",
            marginBottom: "0.85rem",
            fontSize: "0.86rem",
          },
        },
        el("div", {
          style: { fontWeight: "700", color: "var(--gold-bright)", marginBottom: "0.25rem" },
          text: `${npcName}: "${offer.actionText || ""}"`,
        }),
        el("div", {
          style: { fontSize: "0.8rem", color: "var(--text-main)" },
          text: `Your Holdings: 𐆖${viewer.cash} Denarii  •  Cart Space: ${usedBlocks}/${maxBlocks}■ used`,
        })
      ),
      candidateCards.length === 0
        ? el("p", {
            style: { color: "var(--text-muted)" },
            text: `No matching ${offer.category} cards are currently available.`,
          })
        : el(
            "div",
            {
              style: {
                display: "flex",
                flexWrap: "wrap",
                gap: "0.75rem",
                maxHeight: "56vh",
                overflowY: "auto",
                padding: "0.25rem",
                justifyContent: "center",
              },
            },
            ...candidateCards
          ),
      el(
        "div",
        {
          style: {
            display: "flex",
            justifyContent: "flex-end",
            gap: "0.6rem",
            marginTop: "1rem",
            paddingTop: "0.65rem",
            borderTop: "1px solid var(--border-subtle)",
          },
        },
        el("button", {
          type: "button",
          className: "btn",
          text: "Inspect Board First",
          onClick: closeModal,
        }),
        el("button", {
          type: "button",
          className: "btn btn-crimson",
          text: "Decline Offer",
          onClick: () => {
            closeModal();
            sendGameAction({ type: "resolve_npc_offer", decision: "decline" });
          },
        })
      )
    )
  );
}

function openMarketRewardModal(gs, viewer) {
  const queue = (viewer && Array.isArray(viewer.pendingMarketReward) && viewer.pendingMarketReward) || [];
  const rwd = queue[0];
  if (!rwd) return;
  const catLabel = rwd.categoryLabel || rwd.subcategory || rwd.track || "Good";
  const candidates = Array.isArray(rwd.candidates) ? rwd.candidates : [];
  const usedBlocks = Number(viewer.usedBlocks) || 0;
  const maxBlocks = Number(viewer.maxBlocks) || 6;
  const usedGuards = Number(viewer.usedGuards) || 0;
  const maxGuards = Number(viewer.maxGuards) || 2;

  const candidateCards = candidates.map((cand) => {
    const c = cand.card || {};
    const trackName = c.track || rwd.track || "Animals";
    const isGuard = trackName === "Guards" || Number(c.guards) > 0;
    const trackClass = resolveGoodTrackClass(trackName);
    const reqBlocks = isGuard ? 0 : Math.max(1, Number(c.blocks) || 1);
    const reqGuards = isGuard ? Math.max(1, Number(c.guards) || 1) : 0;
    const bonusGuards = Number(c.bonusGuards) || 0;
    const bonusBlocks = Number(c.bonusBlocks) || 0;
    const blocksSymbols = isGuard ? "▲".repeat(reqGuards) : "■".repeat(reqBlocks);
    const fitsInCart = isGuard
      ? usedGuards + reqGuards <= maxGuards + bonusGuards
      : usedBlocks + reqBlocks <= maxBlocks + bonusBlocks;
    const canSwap =
      fitsInCart ||
      (isGuard
        ? Array.isArray(viewer.guards) && viewer.guards.length > 0
        : Array.isArray(viewer.cart) && viewer.cart.length > 0);
    const colNum = (Number(cand.colIndex) || 0) + 1;
    const colSym = cand.colSymbol || "=";
    const btnText = fitsInCart
      ? `🎁 Claim ${c.name || catLabel}`
      : canSwap
      ? `🎁 Claim ${c.name || catLabel} (Swap)`
      : `Cart Full (${reqBlocks}■)`;

    return el(
      "div",
      {
        className: "good-card-unit",
        style: { width: "196px" },
      },
      el(
        "div",
        {
          style: {
            fontSize: "0.66rem",
            fontWeight: "800",
            color: "var(--gold-bright)",
            textAlign: "center",
          },
          text: `⚓ Ostia Market (Col ${colNum} • ${colSym})`,
        }
      ),
      el(
        "div",
        {
          className: `market-good-card ${trackClass}`,
        },
        el(
          "div",
          { className: "market-good-card-inner" },
          el(
            "div",
            { className: "good-card-header" },
            el("div", { className: "slot-card-name", text: c.name || catLabel }),
            el(
              "div",
              { className: "slot-sub" },
              c.subtitle ? `(${c.subtitle})` : c.subcategory || c.category || trackName
            ),
            c.combatText ? el("div", { className: "good-combat-line", text: c.combatText }) : null
          ),
          renderGoodCardArtNode(c, trackName, false),
          el(
            "div",
            { className: "good-card-footer" },
            el("div", { className: "good-blocks-row", text: blocksSymbols }),
            renderGoodPriceTableNode(c, trackName, typeof cand.colIndex === "number" ? cand.colIndex : 2)
          )
        )
      ),
      el(
        "div",
        { className: "good-card-external-meta" },
        el("button", {
          type: "button",
          className: `btn btn-sm ${canSwap ? "btn-primary" : ""}`,
          style: { width: "100%" },
          disabled: !canSwap,
          text: btnText,
          onClick: () => {
            if (fitsInCart) {
              closeModal();
              sendGameAction({
                type: "resolve_market_reward",
                rewardId: rwd.id,
                decision: "accept",
                cardId: cand.cardId || c.id,
              });
            } else {
              openCartReplacementModal(viewer, {
                itemType: isGuard ? "guard" : "good",
                incomingCard: c,
                reqBlocks,
                reqGuards,
                bonusBlocks,
                bonusGuards,
                title: `🎁 Cart Space Full — Make Room for ${c.name || catLabel}`,
                subtitle: `Claiming "${c.name || catLabel}" (${
                  isGuard ? `${reqGuards}▲` : `${reqBlocks}■`
                }) from the Ostia Market Board is free, but your Cart is full. Select item(s) to discard so it fits, or go back to choose another card.`,
                confirmLabelPrefix: `Claim ${c.name || catLabel}`,
                cancelLabel: "← Back to Market Choices",
                onConfirm: (discardCartIds, fireGuardIds) => {
                  sendGameAction({
                    type: "resolve_market_reward",
                    rewardId: rwd.id,
                    decision: "accept",
                    cardId: cand.cardId || c.id,
                    discardCartIds,
                    fireGuardIds,
                  });
                },
                onCancel: () => openMarketRewardModal(gs, viewer),
              });
            }
          },
        })
      )
    );
  });

  showModal(
    `🎁 Choose Market Board Reward — 1 ${catLabel}`,
    el(
      "div",
      {},
      el(
        "div",
        {
          style: {
            padding: "0.6rem 0.85rem",
            background: "rgba(212, 175, 55, 0.14)",
            border: "1px solid var(--gold)",
            borderRadius: "6px",
            marginBottom: "0.85rem",
            fontSize: "0.86rem",
          },
        },
        el("div", {
          style: { fontWeight: "700", color: "var(--gold-bright)", marginBottom: "0.25rem" },
          text: `${rwd.sourceLabel || "Reward"}: Choose any 1 ${catLabel} currently on the Ostia Market Board (${rwd.rewardLabel || catLabel}).`,
        }),
        el("div", {
          style: { fontSize: "0.8rem", color: "var(--text-main)" },
          text: `Cart Space: ${usedBlocks}/${maxBlocks}■ Goods  •  Guards: ${usedGuards}/${maxGuards}▲${
            queue.length > 1 ? `  •  (${queue.length} Market rewards queued)` : ""
          }`,
        })
      ),
      candidateCards.length === 0
        ? el("p", {
            style: { color: "var(--text-muted)" },
            text: `No matching ${catLabel} cards are currently on the Ostia Market Board.`,
          })
        : el(
            "div",
            {
              style: {
                display: "flex",
                flexWrap: "wrap",
                gap: "0.75rem",
                maxHeight: "56vh",
                overflowY: "auto",
                padding: "0.25rem",
                justifyContent: "center",
              },
            },
            ...candidateCards
          ),
      el(
        "div",
        {
          style: {
            display: "flex",
            justifyContent: "flex-end",
            gap: "0.6rem",
            marginTop: "1rem",
            paddingTop: "0.65rem",
            borderTop: "1px solid var(--border-subtle)",
          },
        },
        el("button", {
          type: "button",
          className: "btn",
          text: "Inspect Board First",
          onClick: closeModal,
        }),
        el("button", {
          type: "button",
          className: "btn btn-crimson",
          text: "Decline Reward",
          onClick: () => {
            closeModal();
            sendGameAction({
              type: "resolve_market_reward",
              rewardId: rwd.id,
              decision: "decline",
            });
          },
        })
      )
    )
  );
}

function renderScoutedMarketCardPreview(card) {
  const trackName = card.track || "Foods";
  const trackClass = resolveGoodTrackClass(trackName);
  const blocksSymbols =
    trackName === "Guards"
      ? "▲".repeat(Math.max(1, Number(card.guards) || 1))
      : "■".repeat(Math.max(1, Number(card.blocks) || 1));

  return el(
    "div",
    { className: "cart-good-detail-showcase" },
    el(
      "div",
      {
        className: `market-good-card ${trackClass} cart-good-detail-card`,
      },
      el(
        "div",
        { className: "market-good-card-inner" },
        el(
          "div",
          { className: "good-card-header" },
          el("div", { className: "slot-card-name", text: card.name }),
          el("div", { className: "slot-sub", text: card.subtitle ? `(${card.subtitle})` : card.subcategory || card.category || trackName }),
          card.combatText ? el("div", { className: "good-combat-line", text: card.combatText }) : null
        ),
        renderGoodCardArtNode(card, trackName, false),
        el(
          "div",
          { className: "good-card-footer" },
          el("div", { className: "good-blocks-row", text: blocksSymbols }),
          renderGoodPriceTableNode(card, trackName, 2)
        )
      )
    )
  );
}

function openScoutResultModal(si) {
  if (!si) return;
  const rData = si.revealedData;
  let visualNode = null;

  if (si.targetType === "tile" && rData) {
    const coord = si.targetKey || "B1";
    const sellsText =
      (rData.sells || []).length > 0
        ? rData.sells.map((s) => `${s.category} (${formatTileModifier(s.modifier)})`).join(", ")
        : "None";
    const buysText =
      (rData.buys || []).length > 0
        ? rData.buys.map((b) => `${b.category} (${formatTileModifier(b.modifier)})`).join(", ")
        : null;

    visualNode = el(
      "div",
      { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem" } },
      el(
        "div",
        { style: { width: "270px" } },
        renderDynamicTileCardNode(rData, coord, "inspector")
      ),
      el(
        "div",
        {
          style: {
            width: "100%",
            padding: "0.65rem 0.85rem",
            borderRadius: "6px",
            background: "#fbf7ee",
            border: "1.5px solid #a88d6b",
            boxShadow: "var(--bevel-sunken)",
            fontSize: "0.84rem",
          },
        },
        el("div", {}, el("strong", { style: { color: "var(--gold-bright)" }, text: "Tile ID: " }), rData.id || coord),
        el("div", {}, el("strong", { style: { color: "var(--gold-bright)" }, text: "Buys: " }), sellsText),
        buysText ? el("div", {}, el("strong", { style: { color: "#0369a1" }, text: "Forum Sells: " }), buysText) : null,
        el(
          "div",
          {},
          el("strong", { style: { color: "var(--gold-bright)" }, text: "Encounter / Properties: " }),
          [
            rData.encounter ? EDGE_LABELS[rData.encounter] || rData.encounter : "No Center Encounter",
            rData.persistent ? "Persistent (⤹)" : "Refreshes at Dawn (↻)",
            rData.gamble ? "Stadium Gambling (🎲)" : null,
          ]
            .filter(Boolean)
            .join(" • ")
        )
      )
    );
  } else if (si.targetType === "deck" && rData) {
    const dk = (si.targetKey || "").toLowerCase();
    let cardNode = null;
    if (dk === "patricii" || dk === "legiones" || dk === "nefarii") {
      cardNode = renderPhysicalEncounterCardNode(rData, dk, { interactive: true });
    } else if (dk === "missiones") {
      cardNode = renderPhysicalMissionCardNode(rData, { showStatusTag: false });
    } else if (dk === "influence") {
      cardNode = renderPhysicalInfluenceCardNode(rData);
    } else if (dk === "market") {
      cardNode = renderScoutedMarketCardPreview(rData);
    }
    visualNode = el(
      "div",
      { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem" } },
      cardNode ? el("div", { style: { width: "310px", maxWidth: "100%" } }, cardNode) : null,
      el(
        "div",
        {
          style: {
            width: "100%",
            padding: "0.6rem 0.85rem",
            borderRadius: "6px",
            background: "#fbf7ee",
            border: "1.5px solid #a88d6b",
            boxShadow: "var(--bevel-sunken)",
            fontSize: "0.84rem",
            textAlign: "center",
          },
        },
        si.summary || ""
      )
    );
  } else {
    visualNode = el("p", { style: { fontSize: "0.9rem" }, text: `${si.label}: ${si.summary}` });
  }

  const gs = appState.gameState;
  const canEndTurnFromScout =
    Boolean(gs) &&
    gs.phase === "delivery" &&
    gs.activePlayerIndex === gs.viewerPlayerIndex &&
    !gs.pendingEncounter;

  showModal(
    `👁️ Scouted Intelligence — ${si.label || "Revealed Secret"}`,
    el(
      "div",
      {},
      visualNode,
      el(
        "div",
        { style: { display: "flex", gap: "0.6rem", justifyContent: "flex-end", marginTop: "1rem", flexWrap: "wrap" } },
        el("button", {
          type: "button",
          className: canEndTurnFromScout ? "btn" : "btn btn-primary",
          text: "Close Scout View",
          onClick: closeModal,
        }),
        canEndTurnFromScout
          ? el("button", {
              type: "button",
              className: "btn btn-primary",
              text: "⏭️ End Turn",
              onClick: () => {
                closeModal();
                sendGameAction({ type: "delivery_end_turn" });
              },
            })
          : null
      )
    )
  );
}

function openLoadCargoPromptModal(m, viewer) {
  const reqBlocks = Number(m.blocks || 1);
  const hasSpace = m.hasCargoSpace !== false;
  const canSwap = hasSpace || (viewer && Array.isArray(viewer.cart) && viewer.cart.length > 0);

  showModal(
    `📦 Delivery Mission Cargo Available — ${m.name}`,
    el(
      "div",
      {},
      el("p", {
        style: { fontSize: "0.9rem", color: "var(--text-main)", marginTop: "0" },
        text: `You are at ${m.pickupCell}, the pickup location for your Delivery Mission "${m.name}" (Deliver to ${m.deliverCell}). Would you like to load the mission cargo (${reqBlocks}■) onto your cart now?`,
      }),
      el(
        "div",
        { style: { display: "flex", justifyContent: "center", margin: "0.75rem 0" } },
        el("div", { style: { width: "265px" } }, renderPhysicalMissionCardNode(m, { showStatusTag: true }))
      ),
      !hasSpace
        ? el("p", {
            style: { color: "#92400e", fontSize: "0.84rem", fontWeight: "700" },
            text: `Your Cart currently has ${viewer.usedBlocks}/${viewer.maxBlocks}■ used and needs ${reqBlocks}■ to load this cargo. You may discard Goods on your Cart right now to make room, or leave the cargo on the Mission card (and sell Goods first if you wish).`,
          })
        : el("p", {
            style: { color: "var(--text-muted)", fontSize: "0.8rem" },
            text: "If you choose not to load the cargo right now, you can still click the \"📦 Load Cargo\" button directly on this Mission card at any time while your cart remains in this neighborhood.",
          }),
      el(
        "div",
        { style: { display: "flex", gap: "0.6rem", justifyContent: "flex-end", marginTop: "1rem", flexWrap: "wrap" } },
        el("button", {
          type: "button",
          className: "btn",
          text: "No, Leave on Mission Card for Now",
          onClick: closeModal,
        }),
        canSwap
          ? el("button", {
              type: "button",
              className: "btn btn-primary",
              text: hasSpace ? `📦 Yes, Load Cargo (${reqBlocks}■)` : `📦 Discard Goods & Load Cargo (${reqBlocks}■)`,
              onClick: () => {
                triggerMissionCargoLoadWithOverflow(m, viewer);
              },
            })
          : null
      )
    )
  );
}

function openDeliverCargoPromptModal(m, _viewer) {
  const reqBlocks = Number(m.blocks || 1);
  const canFence = Array.isArray(m.fencedSell) && m.fencedSell.length >= 5 && m.source !== "soothsayer";

  showModal(
    `🏛️ Delivery Destination Reached — ${m.name}`,
    el(
      "div",
      {},
      el("p", {
        style: { fontSize: "0.9rem", color: "var(--text-main)", marginTop: "0" },
        text: `You have arrived at ${m.deliverCell}, the delivery destination for your Mission "${m.name}" carrying ${m.item || "Cargo"} (${reqBlocks}■). Would you like to deliver the item now to complete the mission?`,
      }),
      el(
        "div",
        { style: { display: "flex", justifyContent: "center", margin: "0.75rem 0" } },
        el("div", { style: { width: "265px" } }, renderPhysicalMissionCardNode(m, { showStatusTag: true }))
      ),
      el("p", {
        style: { color: "var(--text-muted)", fontSize: "0.8rem" },
        text: canFence
          ? `If you plan to fence ${m.item || "this cargo"} at a buyer neighborhood instead of delivering it, choose "No, Keep on Cart". You can also click "🏛️ Deliver ${m.item || "Cargo"} Here" on the Mission card at any time while in ${m.deliverCell}.`
          : `If you choose not to deliver right now, you can click "🏛️ Deliver ${m.item || "Cargo"} Here" on the Mission card at any time while your cart remains in ${m.deliverCell}.`,
      }),
      el(
        "div",
        { style: { display: "flex", gap: "0.6rem", justifyContent: "flex-end", marginTop: "1rem" } },
        el("button", {
          type: "button",
          className: "btn",
          text: "No, Keep on Cart for Now",
          onClick: closeModal,
        }),
        el("button", {
          type: "button",
          className: "btn btn-primary",
          text: `🏛️ Yes, Deliver ${m.item || "Cargo"} & Claim Reward`,
          onClick: () => {
            closeModal();
            sendGameAction({ type: "delivery_complete_mission", missionId: m.id });
          },
        })
      )
    )
  );
}

function openCancelMissionConfirmModal(m, soothsayerTotalCount = 0) {
  const src = m.source || "starting";
  if (src === "soothsayer" && soothsayerTotalCount <= 5) {
    showToast("Canceling or failing a Soothsayer mission is impossible unless you already have 5 active Soothsayer missions and take on a 6th!", true);
    return;
  }

  const cargoWarning = m.pickedUp
    ? `⚠️ Because you have already picked up "${m.item || "the delivery cargo"}", canceling this mission will throw the item away (it cannot be sold).`
    : null;

  let ruleExplanation = "";
  if (src === "encounter") {
    const hList = formatHostileFavorPenaltyText(m);
    ruleExplanation = `Per the rulebook, canceling or failing an Encounter Mission incurs its Thumbs-Down reputational consequences (${hList}).`;
  } else if (src === "soothsayer") {
    ruleExplanation = "Because you hold more than 5 active Soothsayer missions, you may cancel one active Soothsayer mission with no penalty.";
  } else {
    ruleExplanation = "Per the rulebook, Starting Missions can be canceled voluntarily at any time with no penalty.";
  }

  showModal(
    `✕ Cancel Mission — ${m.name}?`,
    el(
      "div",
      {},
      el("p", { style: { fontSize: "0.9rem", color: "var(--text-main)", marginTop: "0" }, text: ruleExplanation }),
      cargoWarning
        ? el("p", {
            style: {
              fontSize: "0.84rem",
              color: "#7f1d1d",
              fontWeight: "700",
              background: "#fef2f2",
              border: "1.5px solid #dc2626",
              padding: "0.5rem 0.65rem",
              borderRadius: "6px",
            },
            text: cargoWarning,
          })
        : null,
      el(
        "div",
        { style: { display: "flex", justifyContent: "center", margin: "0.75rem 0" } },
        el("div", { style: { width: "255px" } }, renderPhysicalMissionCardNode(m, { showStatusTag: true }))
      ),
      el(
        "div",
        { style: { display: "flex", gap: "0.6rem", justifyContent: "flex-end", marginTop: "1rem" } },
        el("button", { type: "button", className: "btn", text: "Keep Mission", onClick: closeModal }),
        el("button", {
          type: "button",
          className: "btn btn-crimson",
          text: src === "encounter" ? "✕ Confirm Cancel (Take 👎 Penalty)" : "✕ Confirm Cancel (No Penalty)",
          onClick: () => {
            closeModal();
            sendGameAction({ type: "cancel_mission", missionId: m.id });
          },
        })
      )
    )
  );
}

function openProcurerGoodModal(gs, viewer, card) {
  const availableGoods = ((gs && gs.sourceableGoods) || []).filter(
    (g) => g.track !== "Guards" && (Number(g.guards) || 0) === 0
  );
  const freeBlocks = Math.max(0, (Number(viewer.maxBlocks) || 6) - (Number(viewer.usedBlocks) || 0));

  showModal(
    `🛒 Play "${card.name}" — Choose Good in Goods Deck @ Common (>)`,
    el(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: "0.75rem" } },
      el("p", {
        style: { margin: "0", fontSize: "0.88rem", color: "var(--text-main)" },
        text: `Choose any Good currently available in the Goods deck to purchase directly onto your Cart at its Common (>) buying price. (Your Cart has ${freeBlocks}■ free capacity and ${viewer.cash}(d); if full, you may discard Goods on your Cart to make room).`,
      }),
      availableGoods.length === 0
        ? el("div", { style: { color: "var(--text-muted)", fontSize: "0.85rem" }, text: "No Goods remain in the Goods deck." })
        : el(
            "div",
            {
              style: {
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                gap: "0.55rem",
                maxHeight: "380px",
                overflowY: "auto",
                padding: "0.2rem",
              },
            },
            ...availableGoods.map((g) => {
              const buyPrices = Array.isArray(g.buy) ? g.buy : [];
              const commonPrice = buyPrices.length >= 4 ? Number(buyPrices[3]) : Number(buyPrices[buyPrices.length - 1] || 20);
              const blocks = Math.max(1, Number(g.blocks) || 1);
              const hasCash = (Number(viewer.cash) || 0) >= commonPrice;
              const fitsDirectly = freeBlocks >= blocks;
              const canSwap = fitsDirectly || (Array.isArray(viewer.cart) && viewer.cart.length > 0);
              const canSelect = hasCash && canSwap;
              return el(
                "div",
                {
                  style: {
                    padding: "0.55rem 0.7rem",
                    borderRadius: "6px",
                    background: "#fbf7ee",
                    border: "1.5px solid #a88d6b",
                    boxShadow: "var(--bevel-sunken)",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    gap: "0.4rem",
                  },
                },
                el(
                  "div",
                  {},
                  el("div", { style: { fontWeight: "800", color: "var(--gold-bright)", fontSize: "0.86rem" }, text: `${g.name} (${blocks}■)` }),
                  el("div", { style: { fontSize: "0.74rem", color: "var(--text-muted)" }, text: `${g.track} • Common (>) Price: ${commonPrice}(d)` })
                ),
                el("button", {
                  type: "button",
                  className: "btn btn-sm btn-primary",
                  disabled: !canSelect,
                  text: !hasCash
                    ? `Needs ${commonPrice}(d)`
                    : fitsDirectly
                    ? `🛒 Buy ${g.name} for ${commonPrice}(d)`
                    : `🛒 Buy for ${commonPrice}(d) (Swap)`,
                  onClick: () => {
                    if (fitsDirectly) {
                      closeModal();
                      sendGameAction({
                        type: "play_influence",
                        cardId: card.id,
                        goodCardId: g.id,
                        targetGood: g.name,
                      });
                    } else {
                      openCartReplacementModal(viewer, {
                        itemType: "good",
                        incomingCard: g,
                        reqBlocks: blocks,
                        reqGuards: 0,
                        bonusBlocks: 0,
                        bonusGuards: 0,
                        title: `🛒 Cart Full — Discard Goods to Procure ${g.name}`,
                        subtitle: `Purchasing "${g.name}" (${blocks}■) via Procurer costs ${commonPrice}(d). Select Goods on your Cart to discard so it fits, or cancel without playing Procurer.`,
                        confirmLabelPrefix: `Buy ${g.name} for ${commonPrice}(d)`,
                        cancelLabel: "← Back to Goods List",
                        onConfirm: (discardCartIds, fireGuardIds) => {
                          sendGameAction({
                            type: "play_influence",
                            cardId: card.id,
                            goodCardId: g.id,
                            targetGood: g.name,
                            discardCartIds,
                            fireGuardIds,
                          });
                        },
                        onCancel: () => openProcurerGoodModal(gs, viewer, card),
                      });
                    }
                  },
                })
              );
            })
          ),
      el(
        "div",
        { style: { display: "flex", justifyContent: "flex-end" } },
        el("button", { type: "button", className: "btn", text: "Cancel", onClick: closeModal })
      )
    )
  );
}

function doesItemFitWithoutSwap(viewer, spec = {}) {
  if (!viewer) return true;
  const reqB = Number(spec.reqBlocks) || 0;
  const reqG = Number(spec.reqGuards) || 0;
  const bonusB = Number(spec.bonusBlocks) || 0;
  const bonusG = Number(spec.bonusGuards) || 0;
  const usedB = Number(viewer.usedBlocks) || 0;
  const maxB = Number(viewer.maxBlocks) || 6;
  const usedG = Number(viewer.usedGuards) || 0;
  const maxG = Number(viewer.maxGuards) || 2;
  return usedB + reqB <= maxB + bonusB && usedG + reqG <= maxG + bonusG;
}

function describeCartItemDiscardWarning(item, viewer) {
  if (!item || !item.isMissionCargo) return null;
  const src = item.missionSource || "starting";
  const mName = item.missionName || "Mission";
  if (src === "encounter") {
    const linked = ((viewer && viewer.missions) || []).find((m) => m.id === item.missionId);
    const penText = linked ? formatHostileFavorPenaltyText(linked) : "👎 Favor penalty";
    return `⚠️ Encounter Mission Cargo — discarding fails "${mName}" (${penText})!`;
  }
  if (src === "soothsayer") {
    const linked = ((viewer && viewer.missions) || []).find((m) => m.id === item.missionId);
    const pCell = (linked && linked.pickupCell) || "pickup tile";
    return `⚠️ Soothsayer Cargo — discarding resets pickup back to ${pCell}!`;
  }
  return `⚠️ Starting Mission Cargo — discarding cancels "${mName}" (no penalty).`;
}

function openCartReplacementModal(viewer, opts) {
  if (!viewer) return;
  const isGuardIncoming = opts.itemType === "guard";
  const reqBlocks = Number(opts.reqBlocks) || 0;
  const reqGuards = Number(opts.reqGuards) || 0;
  const incBonusBlocks = Number(opts.bonusBlocks) || 0;
  const incBonusGuards = Number(opts.bonusGuards) || 0;
  const incCard = opts.incomingCard || {};

  const selectedCartIds = new Set();
  const selectedGuardIds = new Set();

  const cartItems = Array.isArray(viewer.cart) ? viewer.cart : [];
  const guardItems = Array.isArray(viewer.guards) ? viewer.guards : [];

  const rootContainer = el("div", { className: "cart-swap-modal-root" });

  function computeState() {
    const remCart = cartItems.filter((c) => !selectedCartIds.has(String(c.id)));
    const remGuards = guardItems.filter((g) => !selectedGuardIds.has(String(g.id)));
    const projMaxBlocks =
      6 +
      (Number(viewer.bonusBlocks) || 0) +
      remGuards.reduce((sum, g) => sum + (Number(g.bonusBlocks) || 0), 0) +
      incBonusBlocks;
    const projMaxGuards =
      2 +
      (Number(viewer.bonusGuards) || 0) +
      remGuards.reduce((sum, g) => sum + (Number(g.bonusGuards) || 0), 0) +
      incBonusGuards;
    const projUsedBlocks = remCart.reduce((sum, c) => sum + (Number(c.blocks) || 1), 0) + reqBlocks;
    const projUsedGuards = remGuards.reduce((sum, g) => sum + (Number(g.guards) || 1), 0) + reqGuards;
    const blocksDeficit = Math.max(0, projUsedBlocks - projMaxBlocks);
    const guardsDeficit = Math.max(0, projUsedGuards - projMaxGuards);
    return {
      projMaxBlocks,
      projMaxGuards,
      projUsedBlocks,
      projUsedGuards,
      blocksDeficit,
      guardsDeficit,
      isValid: blocksDeficit === 0 && guardsDeficit === 0,
    };
  }

  function renderModalBody() {
    while (rootContainer.firstChild) {
      rootContainer.removeChild(rootContainer.firstChild);
    }
    const proj = computeState();

    // Header summary banner + incoming item preview
    const previewTrack = incCard.track || (isGuardIncoming ? "Guards" : "Grain");
    const previewCardNode = el(
      "div",
      { className: `cart-swap-incoming-box ${resolveGoodTrackClass(previewTrack)}` },
      el(
        "div",
        { style: { flex: "1", minWidth: "200px" } },
        el("div", {
          style: { fontSize: "0.7rem", fontWeight: "800", textTransform: "uppercase", letterSpacing: "0.6px", color: "var(--gold-bright)" },
          text: isGuardIncoming ? "Incoming Guard" : "Incoming Cart Item",
        }),
        el("div", {
          style: { fontSize: "1.02rem", fontWeight: "800", color: "#fff", marginTop: "2px" },
          text: `${incCard.name || "Item"} (${isGuardIncoming ? "▲".repeat(Math.max(1, reqGuards)) : `${reqBlocks}■`})`,
        }),
        el("div", {
          style: { fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "2px" },
          text: [
            incCard.subcategory || incCard.category || previewTrack,
            incCard.combatText ? `• ${incCard.combatText}` : null,
            Array.isArray(incCard.sell) && incCard.sell.length > 0 ? `• Sells: ${incCard.sell.join("/")}` : null,
          ]
            .filter(Boolean)
            .join(" "),
        }),
        opts.subtitle
          ? el("div", {
              style: { fontSize: "0.82rem", color: "var(--text-main)", marginTop: "0.45rem" },
              text: opts.subtitle,
            })
          : null
      ),
      el(
        "div",
        { className: `cart-swap-status-pill ${proj.isValid ? "is-ready" : "is-deficit"}` },
        isGuardIncoming || selectedGuardIds.size > 0
          ? el("div", {
              text: `Guards: ${proj.projUsedGuards}/${proj.projMaxGuards}▲${
                proj.guardsDeficit > 0 ? ` (Fire ${proj.guardsDeficit}▲ more)` : " ✓"
              }`,
            })
          : null,
        !isGuardIncoming || proj.blocksDeficit > 0 || selectedCartIds.size > 0
          ? el("div", {
              text: `Goods: ${proj.projUsedBlocks}/${proj.projMaxBlocks}■${
                proj.blocksDeficit > 0 ? ` (Discard ${proj.blocksDeficit}■ more)` : " ✓"
              }`,
            })
          : null
      )
    );
    rootContainer.appendChild(previewCardNode);

    // 1. Guard Firing Section (shown when hiring/receiving a Guard)
    if (isGuardIncoming) {
      rootContainer.appendChild(
        el("div", {
          className: "cart-swap-section-title",
          text: "Select Guard(s) on Your Cart to Fire:",
        })
      );
      if (guardItems.length === 0) {
        rootContainer.appendChild(
          el("p", { style: { color: "var(--text-muted)", fontSize: "0.84rem" }, text: "You currently have no Guards to fire." })
        );
      } else {
        const gGrid = el("div", { className: "cart-swap-grid" });
        for (const g of guardItems) {
          const gid = String(g.id);
          const isSelected = selectedGuardIds.has(gid);
          const extraNote =
            Number(g.bonusGuards) > 0
              ? `⚠️ Grants +${g.bonusGuards}▲ Guard Slot — firing removes that extra slot!`
              : Number(g.bonusBlocks) > 0
              ? `⚠️ Grants +${g.bonusBlocks}■ Cart Space — firing reduces max Goods capacity!`
              : null;

          gGrid.appendChild(
            el(
              "div",
              {
                className: `cart-swap-card ${isSelected ? "selected-for-removal" : ""}`,
                onClick: () => {
                  if (selectedGuardIds.has(gid)) {
                    selectedGuardIds.delete(gid);
                  } else {
                    selectedGuardIds.add(gid);
                  }
                  renderModalBody();
                },
              },
              el(
                "div",
                { className: "cart-swap-card-top" },
                el("span", { className: "cart-swap-card-name", text: `${g.name} (1▲)` }),
                el("span", {
                  className: `cart-swap-badge ${isSelected ? "active" : ""}`,
                  text: isSelected ? "✕ FIRE" : "Keep",
                })
              ),
              el("div", {
                className: "cart-swap-card-meta",
                text: `${g.combatText || "Guard"}${
                  String(g.id || "").startsWith("thug_") ? " • Discarded on fire" : " • Returns to bottom of Market deck"
                }`,
              }),
              extraNote
                ? el("div", { className: "cart-swap-warning", text: extraNote })
                : null
            )
          );
        }
        rootContainer.appendChild(gGrid);
      }
    }

    // 2. Cart Goods Discard Section (shown when adding a Good, OR if firing Lucius created a Goods block deficit!)
    if (!isGuardIncoming || proj.blocksDeficit > 0 || selectedCartIds.size > 0) {
      rootContainer.appendChild(
        el("div", {
          className: "cart-swap-section-title",
          text: isGuardIncoming
            ? `⚠️ Firing Reduced Cart Space — Also Select Goods to Discard (${proj.blocksDeficit}■ needed):`
            : "Select Goods on Your Cart to Discard:",
        })
      );
      if (cartItems.length === 0) {
        rootContainer.appendChild(
          el("p", { style: { color: "var(--text-muted)", fontSize: "0.84rem" }, text: "Your Cart currently has no Goods to discard." })
        );
      } else {
        const cGrid = el("div", { className: "cart-swap-grid" });
        for (const item of cartItems) {
          const cid = String(item.id);
          const isSelected = selectedCartIds.has(cid);
          const bCount = Math.max(1, Number(item.blocks) || 1);
          const warnMsg = describeCartItemDiscardWarning(item, viewer);
          const sellLine =
            Array.isArray(item.sell) && item.sell.length > 0
              ? `Sell Table: ${item.sell.join("/")}`
              : item.isMissionCargo
              ? "Mission Cargo (Unsellable)"
              : item.track || "Good";

          cGrid.appendChild(
            el(
              "div",
              {
                className: `cart-swap-card ${isSelected ? "selected-for-removal" : ""}`,
                onClick: () => {
                  if (selectedCartIds.has(cid)) {
                    selectedCartIds.delete(cid);
                  } else {
                    selectedCartIds.add(cid);
                  }
                  renderModalBody();
                },
              },
              el(
                "div",
                { className: "cart-swap-card-top" },
                el("span", {
                  className: "cart-swap-card-name",
                  text: `${item.name} (${"■".repeat(bCount)} ${bCount}■)`,
                }),
                el("span", {
                  className: `cart-swap-badge ${isSelected ? "active" : ""}`,
                  text: isSelected ? "🗑️ DISCARD" : "Keep",
                })
              ),
              el("div", {
                className: "cart-swap-card-meta",
                text: [item.subcategory || item.category || item.track, sellLine, item.combatText || null]
                  .filter(Boolean)
                  .join(" • "),
              }),
              warnMsg ? el("div", { className: "cart-swap-warning", text: warnMsg }) : null
            )
          );
        }
        rootContainer.appendChild(cGrid);
      }
    }

    // Action Footer
    const summaryParts = [];
    if (selectedGuardIds.size > 0) summaryParts.push(`Fire ${selectedGuardIds.size} Guard(s)`);
    if (selectedCartIds.size > 0) summaryParts.push(`Discard ${selectedCartIds.size} Item(s)`);
    const confirmText = proj.isValid
      ? `✓ ${summaryParts.length > 0 ? `${summaryParts.join(" & ")} → ` : ""}${opts.confirmLabelPrefix || "Confirm"}`
      : proj.guardsDeficit > 0
      ? `Select ${proj.guardsDeficit}▲ Guard(s) to Fire`
      : `Select ${proj.blocksDeficit}■ More Goods to Discard`;

    rootContainer.appendChild(
      el(
        "div",
        {
          style: {
            display: "flex",
            justifyContent: "flex-end",
            gap: "0.6rem",
            marginTop: "1rem",
            paddingTop: "0.7rem",
            borderTop: "1px solid var(--border-subtle)",
            flexWrap: "wrap",
          },
        },
        opts.showInspectBoardBtn
          ? el("button", {
              type: "button",
              className: "btn",
              text: "Inspect Board First",
              onClick: closeModal,
            })
          : null,
        el("button", {
          type: "button",
          className: opts.isRefusal ? "btn btn-crimson" : "btn",
          text: opts.cancelLabel || (isGuardIncoming ? "Cancel Hire" : "Cancel"),
          onClick: () => {
            closeModal();
            if (typeof opts.onCancel === "function") {
              opts.onCancel();
            }
          },
        }),
        el("button", {
          type: "button",
          className: "btn btn-primary",
          disabled: !proj.isValid,
          text: confirmText,
          onClick: () => {
            if (!proj.isValid) return;
            const discIds = Array.from(selectedCartIds);
            const fireIds = Array.from(selectedGuardIds);
            closeModal();
            if (typeof opts.onConfirm === "function") {
              opts.onConfirm(discIds, fireIds);
            }
          },
        })
      )
    );
  }

  renderModalBody();
  showModal(
    opts.title || (isGuardIncoming ? "🛡️ Guard Slots Full — Fire a Guard?" : "🛒 Cart Space Full — Discard Goods?"),
    rootContainer
  );
}

function triggerMissionCargoLoadWithOverflow(m, viewer) {
  if (!m) return;
  const reqBlocks = Math.max(1, Number(m.blocks) || 1);
  if (!viewer || m.hasCargoSpace !== false || doesItemFitWithoutSwap(viewer, { reqBlocks })) {
    closeModal();
    sendGameAction({ type: "delivery_load_cargo", missionId: m.id });
    return;
  }
  openCartReplacementModal(viewer, {
    itemType: "good",
    incomingCard: {
      name: m.item || m.name || "Mission Cargo",
      category: m.category || "Cargo",
      subcategory: `Mission Cargo (${m.name})`,
      track: m.category || "Grain",
      blocks: reqBlocks,
      sell: m.source !== "soothsayer" ? m.fencedSell : null,
      combatText: m.combatText || null,
    },
    reqBlocks,
    reqGuards: 0,
    bonusBlocks: 0,
    bonusGuards: 0,
    title: `📦 Cart Space Full — Discard Goods to Load ${m.item || "Cargo"}`,
    subtitle: `Mission "${m.name}" requires ${reqBlocks}■ on your Cart (Deliver to ${m.deliverCell}). Select Goods on your Cart to discard so you can load this cargo now, or leave it on the Mission card.`,
    confirmLabelPrefix: `Load ${m.item || "Cargo"} (${reqBlocks}■)`,
    cancelLabel: "Leave on Mission Card",
    onConfirm: (discardCartIds, fireGuardIds) => {
      sendGameAction({
        type: "delivery_load_cargo",
        missionId: m.id,
        discardCartIds,
        fireGuardIds,
      });
    },
  });
}

function triggerInfluenceCardPlay(gs, viewer, card) {
  if (!card) return;
  const cName = String(card.name || "");
  if (cName.includes("Thug") && viewer && !doesItemFitWithoutSwap(viewer, { reqGuards: 1 })) {
    openCartReplacementModal(viewer, {
      itemType: "guard",
      incomingCard: {
        name: "Thug (Influence)",
        category: "Guards",
        subcategory: "Free Guard",
        track: "Guards",
        guards: 1,
        combatText: "(R) CP",
      },
      reqBlocks: 0,
      reqGuards: 1,
      bonusBlocks: 0,
      bonusGuards: 0,
      title: `🛡️ Guard Slots Full — Fire a Guard to Deploy "${cName}"?`,
      subtitle: `Your Guard slots are full (${viewer.usedGuards}/${viewer.maxGuards}▲). Select one of your current Guards to fire so you can deploy Thug, or cancel to keep "${cName}" in hand.`,
      confirmLabelPrefix: "Deploy Thug",
      cancelLabel: "Cancel (Keep Card)",
      onConfirm: (discardCartIds, fireGuardIds) => {
        sendGameAction({
          type: "play_influence",
          cardId: card.id,
          discardCartIds,
          fireGuardIds,
        });
      },
    });
    return;
  }

  if (cName.includes("Wine Forger") && viewer && !doesItemFitWithoutSwap(viewer, { reqBlocks: 1 })) {
    openCartReplacementModal(viewer, {
      itemType: "good",
      incomingCard: {
        name: "Forged Wine",
        category: "Wine",
        subcategory: "Counts as any Wine",
        track: "Wine",
        blocks: 1,
        sell: [60, 45, 30, 20, 15],
      },
      reqBlocks: 1,
      reqGuards: 0,
      bonusBlocks: 0,
      bonusGuards: 0,
      title: `🍷 Cart Space Full — Discard Goods to Play "${cName}"?`,
      subtitle: `Your Cart is full (${viewer.usedBlocks}/${viewer.maxBlocks}■). Select at least 1■ on your Cart to discard for Forged Wine, or cancel to keep "${cName}" in hand.`,
      confirmLabelPrefix: "Add Forged Wine",
      cancelLabel: "Cancel (Keep Card)",
      onConfirm: (discardCartIds, fireGuardIds) => {
        sendGameAction({
          type: "play_influence",
          cardId: card.id,
          discardCartIds,
          fireGuardIds,
        });
      },
    });
    return;
  }

  if (cName === "Twist Of Fate" || cName === "Lucky Break") {
    armDieCardAction(card, cName === "Lucky Break" ? "plus_one" : "reroll");
    showToast(`👆 Click directly on the die you want to ${cName === "Lucky Break" ? "increase (+1)" : "re-roll"} with '${cName}'!`);
    const encEl = document.getElementById("pending-encounter-panel");
    if (!appState.activeDiceOverlay && encEl && typeof encEl.scrollIntoView === "function") {
      encEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    return;
  }

  sendGameAction({ type: "play_influence", cardId: card.id });
}

function openPendingCartOverflowModal(_gs, viewer) {
  const queue = (viewer && viewer.pendingCartOverflow) || [];
  if (queue.length === 0) return;
  const ovf = queue[0];
  const card = ovf.card || {};
  const isGuard = ovf.itemType === "guard" || card.track === "Guards";
  const reqBlocks = isGuard ? 0 : Math.max(1, Number(ovf.reqBlocks || card.blocks) || 1);
  const reqGuards = isGuard ? Math.max(1, Number(ovf.reqGuards || card.guards) || 1) : 0;

  openCartReplacementModal(viewer, {
    itemType: isGuard ? "guard" : "good",
    incomingCard: card,
    reqBlocks,
    reqGuards,
    bonusBlocks: Number(ovf.bonusBlocks || card.bonusBlocks) || 0,
    bonusGuards: Number(ovf.bonusGuards || card.bonusGuards) || 0,
    title: isGuard
      ? `🛡️ Free Guard Received — ${card.name} (${ovf.sourceLabel || "Reward"})`
      : `🎁 Item Received — ${card.name} (${reqBlocks}■ • ${ovf.sourceLabel || "Reward"})`,
    subtitle: isGuard
      ? `You received Guard "${card.name}" (${ovf.sourceLabel || "Reward"}), but your Guard slots are full (${viewer.usedGuards}/${viewer.maxGuards}▲). Select a Guard to fire, or refuse the new Guard.`
      : `You received "${card.name}" (${reqBlocks}■, ${ovf.sourceLabel || "Reward"}), but your Cart does not have enough free space (${viewer.usedBlocks}/${viewer.maxBlocks}■ used). Select Goods on your Cart to discard, or refuse this item.`,
    confirmLabelPrefix: isGuard ? `Accept ${card.name}` : `Load ${card.name}`,
    cancelLabel: isGuard ? `✕ Refuse ${card.name}` : `✕ Refuse ${card.name}`,
    isRefusal: true,
    showInspectBoardBtn: true,
    onConfirm: (discardCartIds, fireGuardIds) => {
      sendGameAction({
        type: "resolve_cart_overflow",
        overflowId: ovf.id,
        decision: "accept",
        discardCartIds,
        fireGuardIds,
      });
    },
    onCancel: () => {
      sendGameAction({
        type: "resolve_cart_overflow",
        overflowId: ovf.id,
        decision: "refuse",
      });
    },
  });
}

function openProphecyTargetModal(gs, viewer, card) {
  const players = Array.isArray(gs.players) ? gs.players : [];
  showModal(
    `🔮 Play "${card.name}" — Choose Target Player`,
    el(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: "0.75rem" } },
      el("p", {
        style: { fontSize: "0.88rem", color: "var(--text-main)", margin: "0" },
        text: "Trigger a Soothsayer encounter for any player (including yourself or a rival merchant).",
      }),
      el(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "0.45rem" } },
        ...players.map((p) => {
          const isMe = p.index === viewer.index;
          return el(
            "button",
            {
              type: "button",
              className: isMe ? "btn" : "btn btn-primary",
              style: { display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" },
              onClick: () => {
                closeModal();
                sendGameAction({
                  type: "play_influence",
                  cardId: card.id,
                  targetPlayerIndex: p.index,
                });
              },
            },
            el("span", { text: `🔮 ${p.name}${isMe ? " (You)" : ""}` }),
            el("span", {
              style: { fontSize: "0.76rem", opacity: "0.85" },
              text: `${p.cash}(d) • ${p.missionCount ?? (p.missions || []).length} Missions`,
            })
          );
        })
      ),
      el(
        "div",
        { style: { display: "flex", justifyContent: "flex-end" } },
        el("button", { type: "button", className: "btn", text: "Cancel", onClick: closeModal })
      )
    )
  );
}

function openSurpriseShipmentModal(gs, _viewer, card) {
  const tracks = ["Marble", "Wine", "Animals", "Weapons", "Grain"];
  const meta = gs.marketMeta || {};
  showModal(
    `🚢 Play "${card.name}" — Shift Category Scarcity`,
    el(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: "0.75rem" } },
      el("p", {
        style: { fontSize: "0.88rem", color: "var(--text-main)", margin: "0" },
        text: "Move the Scarcity for one category of Goods one level to the right (more abundant / lower sell price) for the rest of this Season.",
      }),
      el(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "0.45rem" } },
        ...tracks.map((tName) => {
          const tMeta = meta[tName] || {};
          return el(
            "button",
            {
              type: "button",
              className: "btn btn-primary",
              style: { display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" },
              onClick: () => {
                closeModal();
                sendGameAction({
                  type: "play_influence",
                  cardId: card.id,
                  track: tName,
                });
              },
            },
            el("span", { text: `📦 ${tName}` }),
            el("span", {
              style: { fontSize: "0.76rem", opacity: "0.9" },
              text: `Current: ${tMeta.scarcitySymbol || "="} (${tMeta.scarcityLabel || "Normal"})`,
            })
          );
        })
      ),
      el(
        "div",
        { style: { display: "flex", justifyContent: "flex-end" } },
        el("button", { type: "button", className: "btn", text: "Cancel", onClick: closeModal })
      )
    )
  );
}

function renderDeckCardBackPickerGrid(gs, deckSpecs, onSelectDeck, tapPillLabel = "👆 Tap Deck to Scout") {
  const counts = (gs && gs.deckCounts) || {};
  return el(
    "div",
    { className: "scout-decks-grid" },
    ...deckSpecs.map((spec) => {
      const rem = counts[spec.key];
      const countText = typeof rem === "number" ? `${rem} card${rem === 1 ? "" : "s"}` : "Deck";
      const cardVisual = spec.img
        ? el(
            "div",
            { className: "scout-deck-card-wrap" },
            el("img", {
              className: "scout-deck-card-img",
              src: spec.img,
              alt: `${spec.label} Deck Card Back`,
            })
          )
        : el(
            "div",
            { className: "scout-deck-card-wrap" },
            el(
              "div",
              {
                className: "scout-deck-card-img",
                style: {
                  width: "126px",
                  height: "176px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.35rem",
                  padding: "0.55rem",
                  textAlign: "center",
                  background:
                    spec.key === "missiones"
                      ? "radial-gradient(circle at 50% 35%, #5b3a1d, #241509)"
                      : "radial-gradient(circle at 50% 35%, #4c1d4b, #1d0c24)",
                  border: "3px double #d4af37",
                  color: "#fef08a",
                },
              },
              el("div", { style: { fontSize: "1.6rem" }, text: spec.icon || "📜" }),
              el("div", {
                style: { fontFamily: "Cinzel, Georgia, serif", fontWeight: "800", fontSize: "0.8rem", letterSpacing: "0.06em" },
                text: spec.label.toUpperCase(),
              })
            )
          );

      return el(
        "button",
        {
          type: "button",
          className: "scout-deck-stack-btn",
          disabled: typeof rem === "number" && rem <= 0,
          onClick: () => onSelectDeck(spec.key),
        },
        cardVisual,
        el("div", { className: "scout-deck-caption", text: spec.label }),
        el("div", { className: "scout-deck-sub", text: countText }),
        el("div", { className: "scout-deck-tap-pill", text: tapPillLabel })
      );
    })
  );
}

function openInformantsTargetModal(gs, _viewer, card) {
  const allDeckSpecs = [
    { key: "patricii", label: "Patricii", img: "/assets/icons/card_back_patricii.png?v=24" },
    { key: "nefarii", label: "Nefarii", img: "/assets/icons/card_back_nefarii.png?v=24" },
    { key: "legiones", label: "Legionnaire", img: "/assets/icons/card_back_legiones.png?v=24" },
    { key: "market", label: "Goods & Guards", img: "/assets/icons/card_back_goods.png?v=24" },
    { key: "missiones", label: "Missiones", icon: "📜" },
    { key: "influence", label: "Influence", icon: "🃏" },
  ];

  const cellSelect = el(
    "select",
    { className: "form-input" },
    ...Object.keys(gs.romeBoard || {}).map((coord) =>
      el("option", {
        value: coord,
        selected: coord === appState.inspectedCell,
        text: `${coord} — ${gs.romeBoard[coord].name} (${gs.romeBoard[coord].stackCount ?? 12} tiles)`,
      })
    )
  );

  showModal(
    `🃏 Play "${card.name}" — Inspect & Reorder Top 3`,
    el(
      "div",
      {},
      el("p", {
        style: { fontSize: "0.88rem", color: "var(--text-main)", marginTop: "0" },
        text: "Look at the top three cards of any deck (tap a deck below) or the top three tiles of any neighborhood stack and put them back in any order.",
      }),
      el(
        "div",
        { style: { marginBottom: "1rem" } },
        el("div", {
          style: { fontWeight: "700", color: "var(--gold-bright)", fontSize: "0.88rem", marginBottom: "0.35rem" },
          text: "Option A: Tap Any Card Deck to Inspect & Reorder Its Top 3 Cards",
        }),
        renderDeckCardBackPickerGrid(
          gs,
          allDeckSpecs,
          (dk) => {
            closeModal();
            sendGameAction({
              type: "play_influence",
              cardId: card.id,
              targetType: "deck",
              targetKey: dk,
            });
          },
          "👁️ Tap for Top 3"
        )
      ),
      el(
        "div",
        { style: { paddingTop: "0.85rem", borderTop: "1px solid var(--border-subtle)" } },
        el("div", { className: "form-group" }, el("label", { text: "Option B: Inspect Top 3 Tiles of Any Neighborhood Stack" }), cellSelect),
        el("button", {
          type: "button",
          className: "btn btn-primary",
          style: { width: "100%" },
          text: "👁️ Look at Top 3 Tiles of Selected Stack",
          onClick: () => {
            closeModal();
            sendGameAction({
              type: "play_influence",
              cardId: card.id,
              targetType: "tile",
              targetKey: cellSelect.value,
            });
          },
        })
      )
    )
  );
}

function openTop3ReorderModal(pendReorder) {
  if (!pendReorder || !Array.isArray(pendReorder.items)) return;
  const currentItems = pendReorder.items.slice();
  const tType = pendReorder.targetType || "deck";
  const tKey = pendReorder.targetKey || "patricii";
  const cardsContainer = el("div", { className: "top3-reorder-grid" });

  function renderPreviewForItem(item) {
    if (tType === "tile") {
      return el("div", { style: { width: "220px" } }, renderDynamicTileCardNode(item, tKey, "inspector"));
    }
    const dk = String(tKey).toLowerCase();
    if (dk === "patricii" || dk === "legiones" || dk === "nefarii") {
      return el("div", { style: { width: "225px" } }, renderPhysicalEncounterCardNode(item, dk));
    }
    if (dk === "missiones") {
      return el("div", { style: { width: "225px" } }, renderPhysicalMissionCardNode(item, { showStatusTag: false }));
    }
    if (dk === "influence") {
      return el("div", { style: { width: "225px" } }, renderPhysicalInfluenceCardNode(item));
    }
    return renderScoutedMarketCardPreview(item);
  }

  function refreshGrid() {
    const slotNodes = currentItems.map((item, idx) => {
      const posLabel = idx === 0 ? "#1 — TOP (1st)" : idx === 1 ? "#2 — SECOND" : "#3 — THIRD";
      return el(
        "div",
        { className: "top3-slot-card" },
        el("div", { className: `top3-pos-badge pos-${idx + 1}`, text: posLabel }),
        renderPreviewForItem(item),
        el(
          "div",
          { className: "top3-move-btns" },
          el("button", {
            type: "button",
            className: "btn btn-sm",
            disabled: idx === 0,
            text: "◀ Move Earlier",
            onClick: () => {
              const tmp = currentItems[idx - 1];
              currentItems[idx - 1] = currentItems[idx];
              currentItems[idx] = tmp;
              refreshGrid();
            },
          }),
          el("button", {
            type: "button",
            className: "btn btn-sm",
            disabled: idx === currentItems.length - 1,
            text: "Move Later ▶",
            onClick: () => {
              const tmp = currentItems[idx + 1];
              currentItems[idx + 1] = currentItems[idx];
              currentItems[idx] = tmp;
              refreshGrid();
            },
          })
        )
      );
    });
    cardsContainer.replaceChildren(...slotNodes);
  }

  refreshGrid();

  showModal(
    `👁️ Informants — Reorder Top ${currentItems.length} of ${pendReorder.label}`,
    el(
      "div",
      {},
      el("p", {
        style: { fontSize: "0.88rem", color: "var(--text-main)", marginTop: "0" },
        text: "Inspect the top items below and use the ◀ Move Earlier / Move Later ▶ buttons to arrange them in any order (#1 will be drawn or revealed first).",
      }),
      cardsContainer,
      el(
        "div",
        { style: { display: "flex", justifyContent: "flex-end", marginTop: "1rem" } },
        el("button", {
          type: "button",
          className: "btn btn-primary",
          text: "✓ Put Back in This Order",
          onClick: () => {
            closeModal();
            sendGameAction({
              type: "reorder_top_3",
              orderedIds: currentItems.map((it) => it.id),
            });
          },
        })
      )
    )
  );
}

function openMarketSourceModal(gs, viewer) {
  const infSelect = el(
    "select",
    { className: "form-input" },
    ...(viewer.influence || []).map((c) =>
      el("option", { value: c.id, text: `${c.name} — ${getInfluenceCardEffectText(c)}` })
    )
  );
  const goodSelect = el(
    "select",
    { className: "form-input" },
    ...(gs.sourceableGoods || []).map((g) =>
      el("option", {
        value: g.id,
        text: `${g.name} (${g.track} • ${g.blocks || 1}■${g.combatText ? ` • ${g.combatText}` : ""} • Buy: ${g.buy.join("/")})`,
      })
    )
  );

  showModal(
    "📦 Source a Good onto the Ostia Market",
    el(
      "div",
      {},
      el("p", {
        style: { fontSize: "0.86rem", color: "var(--text-muted)" },
        text: "Discard 1 Influence card from your hand to search the Market deck and push a chosen Good onto Column 1 (<<) of its Market Track.",
      }),
      el("div", { className: "form-group" }, el("label", { text: "1. Select Influence Card to Discard" }), infSelect),
      el("div", { className: "form-group" }, el("label", { text: "2. Select Good from Market Deck" }), goodSelect),
      el("button", {
        className: "btn btn-primary",
        text: "Confirm Market Source",
        onClick: () => {
          closeModal();
          sendGameAction({
            type: "market_source",
            influenceCardId: infSelect.value,
            goodCardId: goodSelect.value,
          });
        },
      })
    )
  );
}

function openForumBuyModal(gs, viewer, bSpec) {
  const trackCards = gs.marketBoard[bSpec.category] || [];
  showModal(
    `🏛️ Forum Market Purchase: ${bSpec.category} (${formatTileModifier(bSpec.modifier)})`,
    el(
      "div",
      {},
      trackCards.length === 0
        ? el("p", { text: `No ${bSpec.category} cards are currently on the Ostia Market track.` })
        : el(
            "div",
            { className: "item-list" },
            ...trackCards.map((c, idx) =>
              el(
                "div",
                { className: `item-row good-card-row ${resolveGoodTrackClass(bSpec.category)}` },
                el("span", { text: `Col ${idx + 1}: ${c.name} (Base Buy: ${c.currentBuyPrice}d)` }),
                el("button", {
                  className: "btn btn-sm btn-primary",
                  text: "Purchase at Forum",
                  onClick: () => {
                    closeModal();
                    sendGameAction({ type: "delivery_forum_buy", colIndex: idx });
                  },
                })
              )
            )
          )
    )
  );
}

function openGambleModal(viewer) {
  if (viewer.gambledThisTurn) {
    showToast("You can only gamble once per turn.", true);
    return;
  }
  if (viewer.transactedThisTurn) {
    showToast("You have already completed your Transaction for this turn.", true);
    return;
  }
  const maxBet = Math.min(20, Math.max(1, Number(viewer.cash) || 0));
  const betInput = el("input", {
    className: "form-input",
    type: "number",
    min: "1",
    max: String(maxBet),
    value: String(Math.min(5, maxBet)),
  });
  const matchFixingCard = (viewer.influence || []).find((c) => c.name === "Match Fixing");
  const isMatchFixingActive = Boolean(viewer.turnEffects && viewer.turnEffects.matchFixing);
  let gambleSubmitted = false;

  const rollBtn = el("button", {
    className: "btn btn-primary",
    text: "Roll the Rome Die 🎲",
    onClick: () => {
      if (gambleSubmitted) return;
      const clampedBet = Math.min(maxBet, Math.max(1, Math.floor(Number(betInput.value) || 1)));
      gambleSubmitted = true;
      rollBtn.disabled = true;
      closeModal();
      sendGameAction({ type: "delivery_gamble", bet: clampedBet });
    },
  });

  showModal(
    "🎲 Stadium Gambling at the Games",
    el(
      "div",
      {},
      el("p", {
        style: { fontSize: "0.86rem", color: "var(--text-muted)" },
        text: "Wager between 𐆖1 and 𐆖20 (max 𐆖20 per gamble action, once per turn). Roll 1 Rome Die (faces: 0, 0, I, I, II, III) and receive Wager × Roll!",
      }),
      isMatchFixingActive
        ? el("div", {
            style: {
              padding: "0.45rem 0.65rem",
              background: "#ecfdf5",
              border: "1.5px solid #16a34a",
              borderRadius: "6px",
              color: "#14532d",
              fontSize: "0.82rem",
              fontWeight: "700",
              marginBottom: "0.65rem",
            },
            text: "✓ 'Match Fixing' Active: +1(R) Bonus Die will be added to your Gambling roll!",
          })
        : matchFixingCard
        ? el(
            "div",
            {
              style: {
                padding: "0.5rem 0.7rem",
                background: "#fdf6e2",
                border: "1.5px solid #b58d52",
                borderRadius: "6px",
                marginBottom: "0.7rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "0.5rem",
              },
            },
            el("span", {
              style: { fontSize: "0.8rem", color: "var(--gold-bright)", fontWeight: "600" },
              text: "🃏 Hold 'Match Fixing' (+1(R) to Gambling Roll):",
            }),
            el("button", {
              className: "btn btn-sm btn-primary",
              text: "Play 'Match Fixing'",
              onClick: async () => {
                closeModal();
                await sendGameAction({ type: "play_influence", cardId: matchFixingCard.id });
                const updatedViewer =
                  appState.gameState && appState.gameState.players
                    ? appState.gameState.players[appState.gameState.viewerPlayerIndex || 0]
                    : null;
                if (updatedViewer && !updatedViewer.gambledThisTurn) openGambleModal(updatedViewer);
              },
            })
          )
        : null,
      el(
        "div",
        { className: "form-group" },
        el("label", { text: `Wager Amount (Max 𐆖${maxBet} — Cap 𐆖20 • Treasury: 𐆖${viewer.cash})` }),
        betInput
      ),
      rollBtn
    )
  );
}

function openScoutModal(gs, _viewer) {
  const isEntryPhase = gs.phase === "delivery_entry";
  const cellSelect = el(
    "select",
    { className: "form-input" },
    ...Object.keys(gs.romeBoard).map((coord) =>
      el("option", {
        value: coord,
        selected: coord === appState.inspectedCell,
        text: `${coord} — ${gs.romeBoard[coord].name} (${gs.romeBoard[coord].stackCount ?? 12} unrevealed)`,
      })
    )
  );

  const encounterDeckSpecs = [
    { key: "patricii", label: "Patricii", img: "/assets/icons/card_back_patricii.png?v=24" },
    { key: "nefarii", label: "Nefarii", img: "/assets/icons/card_back_nefarii.png?v=24" },
    { key: "legiones", label: "Legionnaire", img: "/assets/icons/card_back_legiones.png?v=24" },
  ];

  showModal(
    isEntryPhase
      ? "👁️ Pre-Night Initial Scout (Before Selecting Gate)"
      : "👁️ Scout Action (Ends Turn)",
    el(
      "div",
      {},
      !isEntryPhase
        ? el("p", {
            style: { fontSize: "0.82rem", color: "var(--text-muted)", marginTop: "0", marginBottom: "0.75rem" },
            text: "Committing to your Scout action immediately advances the turn so the next merchant in sequence can begin while you examine the scouted card or tile.",
          })
        : null,
      el(
        "div",
        { style: { marginBottom: "1.1rem" } },
        el("div", {
          style: { fontWeight: "700", color: "var(--gold-bright)", fontSize: "0.9rem", marginBottom: "0.25rem" },
          text: "Option A: Tap an Encounter Card Deck to Scout Its Top Card",
        }),
        el("div", {
          style: { fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.5rem" },
          text: "Select from the Patricii, Nefarii, or Legionnaire decks below by tapping directly on its card back:",
        }),
        renderDeckCardBackPickerGrid(
          gs,
          encounterDeckSpecs,
          (dk) => {
            closeModal();
            sendGameAction({
              type: isEntryPhase ? "initial_scout" : "delivery_scout",
              targetType: "deck",
              targetKey: dk,
            });
          },
          "👆 Tap Deck to Scout"
        )
      ),
      el(
        "div",
        {
          style: {
            paddingTop: "0.85rem",
            borderTop: "1px solid var(--border-subtle)",
          },
        },
        el(
          "div",
          { className: "form-group" },
          el("label", {
            style: { fontWeight: "700", color: "var(--gold-bright)" },
            text: "Option B: Peek at Top Unrevealed Tile of a Neighborhood Stack",
          }),
          cellSelect
        ),
        el("button", {
          type: "button",
          className: "btn btn-primary",
          style: { width: "100%" },
          text: "👁️ Scout Selected Neighborhood Stack",
          onClick: () => {
            closeModal();
            if (isEntryPhase) {
              sendGameAction({ type: "initial_scout", targetType: "tile", cell: cellSelect.value });
            } else {
              sendGameAction({ type: "delivery_scout", targetType: "tile", targetKey: cellSelect.value });
            }
          },
        })
      )
    )
  );
}

function openTrashModal(gs, viewer) {
  const infSelect = el(
    "select",
    { className: "form-input" },
    ...(viewer.influence || []).map((c) => el("option", { value: c.id, text: c.name }))
  );
  const cellSelect = el(
    "select",
    { className: "form-input" },
    ...Object.keys(gs.romeBoard).map((coord) =>
      el("option", { value: coord, selected: coord === appState.inspectedCell, text: `${coord} — ${gs.romeBoard[coord].name}` })
    )
  );
  const encounterDeckSpecs = [
    { key: "patricii", label: "Patricii", img: "/assets/icons/card_back_patricii.png?v=24" },
    { key: "nefarii", label: "Nefarii", img: "/assets/icons/card_back_nefarii.png?v=24" },
    { key: "legiones", label: "Legionnaire", img: "/assets/icons/card_back_legiones.png?v=24" },
  ];

  showModal(
    "🗑️ Trash Action (Discard 1 Influence to Bury Top Tile or Card)",
    el(
      "div",
      {},
      el("div", { className: "form-group" }, el("label", { text: "1. Influence Card to Discard" }), infSelect),
      el(
        "div",
        { style: { marginBottom: "1rem" } },
        el("div", {
          style: { fontWeight: "700", color: "var(--gold-bright)", fontSize: "0.86rem", marginBottom: "0.35rem" },
          text: "Option A: Tap an Encounter Deck to Bury Its Top Card",
        }),
        renderDeckCardBackPickerGrid(
          gs,
          encounterDeckSpecs,
          (dk) => {
            closeModal();
            sendGameAction({
              type: "delivery_trash",
              influenceCardId: infSelect.value,
              targetType: "deck",
              targetKey: dk,
            });
          },
          "🗑️ Tap to Bury Top"
        )
      ),
      el(
        "div",
        { style: { paddingTop: "0.8rem", borderTop: "1px solid var(--border-subtle)" } },
        el("div", { className: "form-group" }, el("label", { text: "Option B: Target Neighborhood Tile Stack" }), cellSelect),
        el("button", {
          type: "button",
          className: "btn btn-crimson",
          style: { width: "100%" },
          text: "🗑️ Bury Top Tile to Bottom of Stack",
          onClick: () => {
            closeModal();
            sendGameAction({
              type: "delivery_trash",
              influenceCardId: infSelect.value,
              targetType: "tile",
              targetKey: cellSelect.value,
            });
          },
        })
      )
    )
  );
}

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
    desc: "Peeks at the top unrevealed tile of the selected neighborhood stack (ends turn).",
  },
  {
    key: "scoutDeck",
    label: "Scout Encounter Deck Card",
    desc: "Opens or triggers the Encounter Deck Scout picker (Patricii, Legiones, Nefarii).",
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
          hotkeys: savedHotkeys,
        },
      };
      if (newPasswordInput.value) {
        payload.currentPassword = currentPasswordInput.value;
        payload.newPassword = newPasswordInput.value;
      }
      const res = await apiRequest("/api/profile/update", "POST", payload);
      appState.user = res.user;
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
          { style: { display: "flex", alignItems: "center", gap: "0.5rem", fontWeight: "400", cursor: "pointer" } },
          skipMissionPopupsCheckbox,
          el("span", { text: 'Skip mission completion notification popups ("Do not show this again")' })
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
        desc: "Co-Emperor Publius Septimius Geta. +1 Emerald waives the 4(d) Bridge Toll when Divided Tiber is active.",
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
      "Pass: Step out of the Market Round. Once a full round passes with no Market purchases, pass the First Player Token clockwise and enter Rome at dusk.",
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
      "Step 1 — Optional Trash: Discard 1 Influence card to bury the top unexposed tile of any neighborhood or the top card of any deck to the bottom.",
      "Step 2 — Movement (1 Step (M)): Move along a passable outgoing edge to an adjacent neighborhood (revealing its top tile if face-down) or out an exterior perimeter edge to Exit Rome.",
      "Step 3 — Edge Cost / Hazard: Pay any 2(d) road toll (plus +4(d) Bridge Toll if Divided Tiber is active and you hold < +1 Emerald) or resolve any Edge Encounter crossed.",
      "Step 4 — Mission Cargo Pickup & Delivery: Upon arriving in a neighborhood—BEFORE any Center Tile Encounter triggers—you may load or deliver matching Mission Cargo!",
      "Step 5 — Center Tile Encounter: Resolve any Center Encounter on the tile (Patricii, Legiones, Nefarii, Angry Mob, Theater Troupe, or Soothsayer).",
      "Step 6 — One Transaction (1 Good/Hr (T), or Bulk Grain!): Sell AT MOST 1 Good card matching a buyer ('Buys:') on your current tile (or an active Sell Mission here) at its bold Green (SELL_SYM) price—EXCEPT for non-fenced GRAIN, where 1 hourly Transaction may sell ANY NUMBER (or all!) of your Grain cards together at the current Grain scarcity modifier! Alternatively, Purchase 1 Good at a Forum ('Sells:' at C3, D3, or D4) at its italic Red (BUY_SYM) price, OR Gamble once at a Stadium tile (up to 20(d) wager).",
      "Step 7 — End-of-Turn Scout: After completing your Move and Transaction actions, you may Scout one time at the end of your turn by peeking at the top unrevealed tile of any neighborhood stack or the top card of any deck. Committing to your Scout action immediately advances the turn so the next merchant in sequence can begin their turn while you finish examining the scouted tile or card (though the next merchant may choose to wait if they want to see whether you react or move toward that area).",
      "Tiber River & 5 Stone Bridges: The Tiber divides the West Bank (A1, A4, B4, A5) from the East Bank. All diagonal crossings over the Tiber and unbridged orthogonal river borders are completely impassable (even with Shortcut). Carts may cross ONLY via Rome's 5 intra-urban Stone Bridges (in use in 211 A.D.): Pons Aelius (A1↔B1), Pons Neronianus (A1↔A2), Pons Agrippae (A3↔A4), Pons Fabricius (B4↔C4), and Pons Aemilius (B4↔B5).",
    ],
  },
  {
    id: "missions",
    title: "6. Missions, Mission Cargo, & Regicide",
    bullets: [
      "Starting Missions: Kept during Setup (3 per merchant). Can be canceled voluntarily without Favor penalty (unless Bonded Couriers is active, which fines -10(d) on any failed/canceled/unfinished mission!). Starting Mission Cargo can NEVER be sold or fenced.",
      "Encounter Missions: Drawn from NPC encounters. Encounter Mission Cargo displays a bold Green (SELL_SYM) Fence price row—fencing it to a matching buyer sells 1 card for quick Denarii, applies Patron Hostile Favor, and FAILS the mission (unless Smuggler's Fence is active, which boosts Fence Scarcity by +1 step and prevents fencing from counting as a Failed Mission!).",
      "Soothsayer Missions: Mandatory prophecies with 1(R) face-down Influence cards sealed underneath until completed. Cannot be voluntarily canceled unless holding 6 Soothsayer Missions simultaneously.",
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
        img: "./assets/icons/patricii_icon.png",
        title: "Patricii Encounter",
        desc: "Wealthy senators and aristocrats. Friendly Patricii offer lucrative Missions or trade deals; Hostile Patricii demand bribes, wine, or marble.",
      },
      {
        img: "./assets/icons/legiones_icon.png",
        title: "Legiones Encounter",
        desc: "Praetorian guards and urban cohorts. Heavily aligned with Caracalla; gain +2 CP when Army Pay Hike is active.",
      },
      {
        imgs: ["./assets/icons/nefarii_icon.png", "./assets/icons/nefarii_3_icon.png"],
        title: "Nefarii & 3× Syndicate",
        desc: "Cutthroats, thieves, and nocturnal syndicates. A 3-Dagger icon draws 3 Nefarii cards in succession!",
      },
      {
        img: "./assets/icons/angry_mob.png",
        title: "Angry Mob (1R Chart)",
        desc: "Roll 1(R): 0 = Lose all Wine; I = Lose all Grain; II = Lose your most expensive Good; III = Escape unharmed.",
      },
      {
        img: "./assets/icons/theater_masks.png",
        title: "Theater Troupe (1R Chart)",
        desc: "Roll 1(R): 0 = Lose all positive Favor; I = Lose all negative Favor; II = Lose rest of turn & next turn; III = Draw 1(R) Influence.",
      },
      {
        img: "./assets/icons/soothsayer_icon.png",
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
        desc: "Mid-card Encounter tier icons: the Fanned Deck + Roman Arca Chest ((DECK_ICON)(QUEST_ICON)! / ?) draws an unseen Missiones card; the Arca Chest alone ((QUEST_ICON)! / ?) assigns the card's printed Mission.",
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
      "Friendly vs. Hostile Encounters: Determined by your uncapped net Favor with the NPC's Faction. If you refuse a Demand to Fight and lose Combat, the NPC enforces their original Demand AND your turn ends immediately!",
      "Combat Power (CP) & Cargo Gear: Both sides roll Rome Dice (R) plus Guards, Weapons, mandatory Exotic Animals (including Ostrich or negative-die beasts!), and Influence modifiers (plus +1 CP per positive Ruby & +2 CP to Legiones if Army Pay Hike is active). Note that crated Loricae body armor carries 0 CP in street ambushes (too slow to don mid-attack, compensated by lucrative trade margins). If Player CP ≥ Opponent CP against an NPC, you win!",
      "Armor, Guards, & Driver Fate (Damage Deficit Note): If Opponent CP > Player CP, suffer Raw Wounds = (Opponent CP − Player CP). Note that wounds from combat are always determined by the signed damage deficit between the two sides—even when one or both CP totals are negative (for example, if your overall CP is -2 and your opponent's CP is -1, you suffer 1 Wound). Shields/Helmets reduce Wounds first; each remaining Wound kills 1 Guard. If an unblocked Wound reaches your Driver, roll 1(R) on the Driver Fate Chart: 0 = Dead (lose all Goods & your night ends); I = Left for dead (lose all Goods); II = Beaten & mugged (lose all Denarii); III = Begged for mercy (lose all Influence cards).",
      "1(R) Street Charts: Angry Mob (0: lose all Wine; I: lose all Grain; II: lose most expensive Good; III: safe), Theater Troupe (0: lose all positive Friendly Favor; I: lose all negative Hostile Favor; II: lose rest of turn & next turn; III: draw 1(R) Influence), Soothsayer (take mandatory Mission + seal 1(R) Influence cards).",
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
      "Step 4 — PvP Combat Tie-Breakers (Strictly One Winner/Loser!): Every 'Most' and 'Least' modifier—as well as Final Score ties—awards its bonus or penalty to STRICTLY ONE merchant, even if tied at 0! Tied merchants fight PvP Combat: pre-roll cards (Mercenary Ambush, Distraction removing 1 positive die) apply before rolling, all dice roll simultaneously, and reactive post-roll cards (Twist Of Fate, Flying Chamber Pot, Gladiator's Intervention) trigger when they can overturn a deficit. For 'Most' awards, the combat winner claims the prize; for 'Least' penalties/elimination, the combat winner escapes and the combat LOSER suffers the penalty!",
    ],
    table: {
      headers: ["Caracalla", "Geta", "Julia Domna", "Plautilla", "Aurelians", "Missions"],
      rows: [
        [
          "Imperial Proscription: End of game (FIRST): Least Caracalla favor is eliminated.",
          "Brother's Grudge: End of game: Least Geta favor loses 25(d).",
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
          "Guild Ledger: End of game: Gain 10(d) per completed Mission; lose 10(d) per failed or unfinished Mission.",
        ],
        [
          "Army Pay Hike: Legiones gain +2 CP. Each +Ruby gives your Cart +1 CP.",
          "Divided Tiber: Crossing any of the 5 Tiber Bridges costs a 4(d) toll, waived with +1 Emerald or Shortcut.",
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
          "Green / Red Bar",
          "Tile Edge",
          "Open Street (free movement) / Barricaded Alley (impassable without Shortcut).",
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
          "Paid (d)X • Net ±(d)Y",
          "Loaded Cart Cards & Sell Buttons",
          "Tracks what you paid for each Good and your exact net profit at the current buyer.",
        ],
      ],
    },
  },
];

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
    wrap.appendChild(createMoveActionCircleNode("1.9em"));
  } else if (item.symbolType === "tx_sym") {
    wrap.appendChild(createTransactionActionCircleNode("1.9em"));
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

function buildRulebookSectionNodes(searchQuery) {
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
          (sec.table && sec.table.rows.some((r) => r.some((cell) => cell.toLowerCase().includes(q))))
      )
    : RULEBOOK_SECTIONS;

  if (filtered.length === 0) {
    return [
      el(
        "p",
        { style: { color: "var(--text-muted)", fontStyle: "italic", padding: "0.75rem 0" } },
        `No rulebook sections matched "${searchQuery}". Try searching for Tiber, Grain, Favor,Sell, Buy, Loan, Curfew, or Winter.`
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
        : null
    )
  );
}

function renderRulebookView() {
  const sectionsContainer = el(
    "div",
    { id: "rulebook-sections-list" },
    ...buildRulebookSectionNodes(appState.rulebookSearch)
  );

  const searchInput = el("input", {
    className: "form-input",
    type: "search",
    placeholder: "Search rules (e.g. Tiber, Grain, Favor, Cargo, Loan, Winter)...",
    value: appState.rulebookSearch || "",
    onInput: (e) => {
      appState.rulebookSearch = e.target.value;
      sectionsContainer.replaceChildren(...buildRulebookSectionNodes(appState.rulebookSearch));
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
          sectionsContainer.replaceChildren(...buildRulebookSectionNodes(""));
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

function replayLastDiceRoll() {
  const gs = appState.gameState;
  if (!gs || !Array.isArray(gs.diceEvents) || gs.diceEvents.length === 0) {
    showToast("No dice rolls recorded in this game yet.");
    return;
  }
  const latestEvent = gs.diceEvents[gs.diceEvents.length - 1];
  if (appState.diceAnimTimer) {
    clearInterval(appState.diceAnimTimer);
    appState.diceAnimTimer = null;
  }
  appState.activeDiceOverlay = null;
  appState.diceRollQueue.unshift(latestEvent);
  startNextDiceRollAnimation(true);
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
  const viewer = gs.players[gs.viewerPlayerIndex || 0];
  if (!viewer) return null;
  const isEncounterOwner = pend.playerIndex === viewer.index;
  const isIntervenor = pend.interveningPlayerIndex === viewer.index;
  if (!isEncounterOwner && !isIntervenor) return null;

  const stage = pend.stage || "pre_decision";
  const evKind = String((ev && ev.kind) || "");
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
  const viewer = gs.players[gs.viewerPlayerIndex || 0];
  if (!viewer) return null;
  const isEncounterOwner = pend.playerIndex === viewer.index;
  const isIntervenor = pend.interveningPlayerIndex === viewer.index;
  if (!isEncounterOwner && !isIntervenor) return null;

  const encPlayer = gs.players[pend.playerIndex] || viewer;
  const isOtherPlayerEncounter = !isEncounterOwner;
  const oppName = (pend.card && pend.card.name) || "Opponent";

  const stage = pend.stage || "pre_decision";
  if (stage === "combat_post_roll") {
    const pCP = Number(pend.playerCP) || 0;
    const oCP = Number(pend.oppCP) || 0;
    const isVictory = pCP > oCP;
    const isTie = pCP === oCP;
    const rawWounds = Math.max(0, oCP - pCP);
    const ignoreWounds = Number(pend.ignoreWounds) || 0;
    const netWounds = Math.max(0, rawWounds - ignoreWounds);
    const survivesByArmorOrGuard = !isVictory && !isTie && netWounds <= (encPlayer.guards || []).length;
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
            text: isArmed
              ? "👆 Click Any Die Above to Re-Roll (Twist Of Fate Armed)"
              : "🎲 Twist Of Fate — Click a Die Above to Re-Roll",
            onClick: () => {
              armDieCardAction(rc, "reroll");
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
              text: `🃏 ${nm} (${effShort} → ${isOtherPlayerEncounter ? encPlayer.name : "You"})`,
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

    return el(
      "div",
      { className: "dice-post-roll-box" },
      isOtherPlayerEncounter ? renderOpponentPublicCartSummaryNode(gs, encPlayer, viewer, "dark") : null,
      el("div", {
        style: { fontSize: "0.8rem", fontWeight: "700", color: "#fde68a" },
        text:
          postCards.length > 0
            ? isOtherPlayerEncounter
              ? `⚡ Intervention Window on ${encPlayer.name}'s Combat (${pCP} CP vs. ${oCP} CP): Click a die to re-roll, play a card, or pass!`
              : `🃏 Post-Roll Influence Available (${pCP} CP vs. ${oCP} CP): Click a die to re-roll, play a card, or confirm the combat result!`
            : `Combat Total: ${pCP} CP vs. ${oCP} CP — Click below to confirm result.`,
      }),
      buildArmedDieBannerNode(),
      cardButtons.length > 0
        ? el("div", { style: { display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "center" } }, ...cardButtons)
        : null,
      el("button", {
        className: isVictory || isTie || survivesByArmorOrGuard ? "btn btn-sm btn-primary" : "btn btn-sm btn-crimson",
        text: isOtherPlayerEncounter
          ? "✅ Pass Intervention / Confirm Combat Result"
          : isVictory
          ? "✅ Confirm Combat Victory"
          : isTie
          ? "✅ Confirm Combat Tie (Survive, No Bonus)"
          : survivesByArmorOrGuard
          ? "🛡️ Confirm Survival (No Roll on Defeat Chart)"
          : "✅ Confirm Combat Result & Roll Defeat Chart",
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
        text: "💀 Your Driver Suffered an Unblocked Wound! Roll 1(R) on the Driver Fate (Death) Chart:",
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
              ? `⚡ Intervention Window on ${encPlayer.name}'s ${cType === "soothsayer" ? "Soothsayer" : "Chart"} Roll: Click the die above to modify/re-roll, or pass!`
              : `🃏 Post-Roll Influence Available: Click the die above to modify/re-roll, or confirm outcome!`
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
                  text: isArmed ? "👆 Click Die Above to Re-Roll (Twist Of Fate Armed)" : "🎲 Twist Of Fate — Click Die Above to Re-Roll",
                  onClick: () => armDieCardAction(rc, "reroll"),
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
              ? `⚡ Intervention Window on ${encPlayer.name}'s ${rollDesc}: Click the die you want to re-roll with Twist Of Fate, or pass!`
              : `🃏 Twist Of Fate Available on Your ${rollDesc}: Click the die you want to re-roll, or confirm outcome!`
            : `Confirm ${rollDesc} Outcome:`,
      }),
      buildArmedDieBannerNode(),
      firstTwist
        ? el(
            "div",
            { style: { display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "center" } },
            el("button", {
              className: `btn btn-sm ${isArmed ? "btn-crimson" : "btn-primary"}`,
              text: isArmed
                ? "👆 Click Any Die Above to Re-Roll (Twist Of Fate Armed)"
                : "🎲 Twist Of Fate — Click a Die Above to Re-Roll",
              onClick: () => armDieCardAction(firstTwist, "reroll"),
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
              if (
                queueRemaining === 0 &&
                pend &&
                pend.stage === "combat_post_roll" &&
                pend.interveningPlayerIndex == null
              ) {
                await sendGameAction({ type: "resolve_encounter", decision: "finalize_combat" });
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
      cardImg.src = resolveAssetUrl(`/assets/icons/${dk}_icon.png`);
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
        ? "/assets/icons/angry_mob.png"
        : vis.chartType === "theater"
        ? "/assets/icons/theater_masks.png"
        : "/assets/icons/soothsayer_icon.png";
    thumbs.push(
      el(
        "div",
        { className: "npc-bubble-thumb-wrap is-icon" },
        el("img", { className: "npc-bubble-icon-img", src: chartIcon, alt: vis.chartType || "Table Encounter" })
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
  const vIdx = typeof gs.viewerPlayerIndex === "number" ? gs.viewerPlayerIndex : 0;
  const viewer = gs.players[vIdx];
  if (!viewer) return false;
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
  if (
    (viewer.pendingCartOverflow || []).length > 0 ||
    (viewer.pendingMarketReward || []).length > 0 ||
    viewer.pendingNpcOffer ||
    viewer.pendingTop3Reorder
  ) {
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
  return el(
    "div",
    { className: "npc-pacing-banner" },
    el(
      "div",
      { style: { display: "flex", alignItems: "center", gap: "0.55rem", flexWrap: "wrap" } },
      renderCartIconNode(ev.playerColor || "Z3", "", `${ev.playerName || "AI"}'s Cart`),
      el("strong", {
        style: { color: "#6e2119", fontFamily: "Cinzel, Georgia, serif", fontSize: "0.86rem" },
        text: `⏳ AI Turn (${stepNum}/${totalNum}) — ${ev.playerName || "Merchant"}:`,
      }),
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

function installDelayedHoverTooltips() {
  if (appState._delayedHoverInstalled) return;
  appState._delayedHoverInstalled = true;

  window.addEventListener(
    "mouseover",
    (e) => {
      if (!(e.target instanceof Element)) return;
      let cur = e.target;
      while (cur && cur !== document.body) {
        if (cur.hasAttribute("title")) {
          const rawT = (cur.getAttribute("title") || "").trim();
          if (rawT && !cur.hasAttribute("data-hover-title")) {
            cur.setAttribute("data-hover-title", rawT);
          }
          cur.removeAttribute("title");
        }
        cur = cur.parentElement;
      }

      const target = e.target.closest("[data-hover-title]");
      if (target === delayedHoverTargetEl) {
        return;
      }
      hideDelayedHoverTooltip();
      if (!target) return;
      const text = (target.getAttribute("data-hover-title") || "").trim();
      if (!text) return;
      delayedHoverTargetEl = target;
      delayedHoverClientX = e.clientX;
      delayedHoverClientY = e.clientY;
      delayedHoverTimerId = setTimeout(() => {
        delayedHoverTimerId = null;
        if (delayedHoverTargetEl && document.body.contains(delayedHoverTargetEl)) {
          showDelayedHoverTooltipNode(text, delayedHoverClientX, delayedHoverClientY);
        }
      }, DELAYED_HOVER_TOOLTIP_MS);
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
        return;
      }
      const tip = document.getElementById("delayed-hover-tooltip");
      if (tip) {
        positionDelayedHoverTooltip(tip, e.clientX, e.clientY);
      }
    },
    { passive: true }
  );

  for (const evName of ["mousedown", "wheel", "keydown", "touchstart", "blur"]) {
    window.addEventListener(evName, () => hideDelayedHoverTooltip(), { passive: true });
  }
}

function hideRomeHoverTooltip() {
  hideDelayedHoverTooltip();
  const existing = document.getElementById("rome-hover-tooltip");
  if (existing) existing.remove();
  document.querySelectorAll(".compass-btn.is-hovered-dir").forEach((b) => b.classList.remove("is-hovered-dir"));
  document.querySelectorAll(".edge-hover-preview-pill").forEach((p) => p.remove());
}

const NUMPAD_CODE_TO_DIR = {
  Numpad7: "NW",
  Numpad8: "N",
  Numpad9: "NE",
  Numpad4: "W",
  Numpad6: "E",
  Numpad1: "SW",
  Numpad2: "S",
  Numpad3: "SE",
};

const NUMPAD_DIGIT_TO_DIR = {
  "7": "NW",
  "8": "N",
  "9": "NE",
  "4": "W",
  "6": "E",
  "1": "SW",
  "2": "S",
  "3": "SE",
};

function installGlobalHotkeys() {
  if (appState._hotkeysInstalled) return;
  appState._hotkeysInstalled = true;
  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const activeEl = document.activeElement;
    const tag = activeEl && activeEl.tagName ? activeEl.tagName.toUpperCase() : "";
    const inEditable =
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      Boolean(activeEl && activeEl.isContentEditable);

    if (e.key === "Escape") {
      hideRomeHoverTooltip();
      if (appState.activeDiceOverlay && !appState.isDiceRolling) {
        e.preventDefault();
        dismissDiceOverlay();
        return;
      }
      const modalRoot = document.getElementById("modal-root");
      if (modalRoot && modalRoot.hasChildNodes()) {
        e.preventDefault();
        closeModal();
        return;
      }
      if (appState.armedDieAction) {
        e.preventDefault();
        appState.armedDieAction = null;
        renderDiceOverlay();
        renderApp();
        return;
      }
      if (appState.activeNpcEvent) {
        e.preventDefault();
        stopNpcTurnPacing();
        renderApp();
      }
      return;
    }

    if (inEditable) return;

    const k = e.key.toLowerCase();
    const hk = getCustomHotkeys();
    const modalRoot = document.getElementById("modal-root");
    const hasOpenModal = Boolean(modalRoot && modalRoot.hasChildNodes());

    // Close window hotkey when a modal is open
    if (hasOpenModal && hk.closeModal && k === hk.closeModal) {
      e.preventDefault();
      closeModal();
      return;
    }

    // Modal action hotkeys for Scout Tile, Scout Deck Card, Move To, and End Turn
    if (hasOpenModal) {
      const interactBtn = document.getElementById("modal-tile-interact-btn");
      if (interactBtn && (k === hk.scoutTile || k === hk.scoutDeck || k === hk.moveToTile || k === hk.endTurn)) {
        interactBtn.click();
      }
      if (hk.scoutTile && k === hk.scoutTile) {
        const scoutTileBtn = document.getElementById("modal-scout-tile-btn");
        if (scoutTileBtn && !scoutTileBtn.disabled) {
          e.preventDefault();
          scoutTileBtn.click();
          return;
        }
      } else if (hk.scoutDeck && k === hk.scoutDeck) {
        const scoutDeckBtn = document.getElementById("modal-scout-deck-btn");
        if (scoutDeckBtn && !scoutDeckBtn.disabled) {
          e.preventDefault();
          scoutDeckBtn.click();
          return;
        }
      } else if (hk.moveToTile && k === hk.moveToTile) {
        const moveToBtn = document.getElementById("modal-move-to-btn");
        if (moveToBtn && !moveToBtn.disabled) {
          e.preventDefault();
          moveToBtn.click();
          return;
        }
      } else if (hk.endTurn && k === hk.endTurn) {
        const endTurnBtn = document.getElementById("modal-end-turn-btn");
        if (endTurnBtn && !endTurnBtn.disabled) {
          e.preventDefault();
          endTurnBtn.click();
          return;
        }
      }
    }

    if (e.key === " " || e.key === "Enter") {
      if (tag === "BUTTON" || tag === "A") return;
      if (appState.activeDiceOverlay && !appState.isDiceRolling) {
        const contBtn = document.querySelector("#dice-overlay-root .dice-continue-btn");
        if (contBtn) {
          e.preventDefault();
          contBtn.click();
          return;
        }
      }
      if (appState.activeNpcEvent) {
        e.preventDefault();
        stepNextNpcPacingEvent();
        return;
      }
    }

    if (appState.activeTab === "tabletop" && appState.gameState) {
      const gs = appState.gameState;
      const viewer = gs.players[gs.viewerPlayerIndex] || gs.players[0];

      // Numpad 1-9 directional Cart steering (7=NW, 8=N, 9=NE, 4=W, 6=E, 1=SW, 2=S, 3=SE)
      const numpadDir =
        NUMPAD_CODE_TO_DIR[e.code] || (e.location === 3 ? NUMPAD_DIGIT_TO_DIR[e.key] : null);
      if (numpadDir && !hasOpenModal && !appState.activeDiceOverlay && !appState.activeNpcEvent) {
        e.preventDefault();
        if (!viewer) return;
        if (gs.pendingEncounter) {
          showToast("Resolve the active Encounter before moving your Cart.", true);
          return;
        }
        if (gs.phase === "delivery_entry" && gs.activePlayerIndex === viewer.index && !viewer.position) {
          appState.cartPanelTab = "navigate";
          renderApp();
          showToast("Choose a Via City Gate first to enter Rome, then steer with Numpad 1–9.");
          return;
        }
        if (gs.phase !== "delivery" || gs.activePlayerIndex !== viewer.index || !viewer.position) {
          return;
        }
        if ((viewer.movesRemaining || 0) <= 0) {
          showToast("No Cart movement remaining this turn.", true);
          return;
        }
        const cell = gs.romeBoard && gs.romeBoard[viewer.position];
        const outInfo = cell && cell.revealed && cell.revealed.outgoingDirections
          ? cell.revealed.outgoingDirections[numpadDir]
          : null;
        if (!outInfo) {
          const adj = getNeighborCoordInDir(viewer.position, numpadDir);
          const riverMsg = adj && isTiberCrossingBlocked(viewer.position, adj)
            ? "Tiber River (no bridge here)"
            : "No road in that direction";
          showToast(`Cannot move ${numpadDir}: ${riverMsg}.`, true);
          return;
        }
        const riverBlocked =
          Boolean(outInfo.blockedByRiver) ||
          (outInfo.targetCell ? isTiberCrossingBlocked(viewer.position, outInfo.targetCell) : false);
        const passable =
          !riverBlocked && (outInfo.passable || Boolean(viewer.turnEffects && viewer.turnEffects.shortcut));
        if (!passable) {
          showToast(
            riverBlocked
              ? `Cannot move ${numpadDir}: Tiber River blocks crossing.`
              : `Cannot move ${numpadDir}: Street is barricaded.`,
            true
          );
          return;
        }
        sendGameAction({ type: "delivery_move", direction: numpadDir });
        return;
      }

      if (!hasOpenModal && !appState.activeDiceOverlay && viewer) {
        const isMyTurn =
          gs.activePlayerIndex === viewer.index &&
          (gs.phase === "delivery" || gs.phase === "delivery_entry") &&
          !gs.pendingEncounter;
        if (hk.scoutTile && k === hk.scoutTile && isMyTurn) {
          e.preventDefault();
          if (viewer.scoutedThisTurn) {
            showToast("You have already used your Scout action this turn.", true);
            return;
          }
          const targetCoord = appState.inspectedCell || viewer.position || "B1";
          const targetCell = gs.romeBoard && gs.romeBoard[targetCoord];
          if (targetCell) {
            openConfirmScoutNeighborhoodModal(gs, viewer, targetCoord, targetCell);
          } else {
            openScoutModal(gs, viewer);
          }
          return;
        }
        if (hk.scoutDeck && k === hk.scoutDeck && isMyTurn) {
          e.preventDefault();
          if (viewer.scoutedThisTurn) {
            showToast("You have already used your Scout action this turn.", true);
            return;
          }
          openScoutModal(gs, viewer);
          return;
        }
        if (hk.moveToTile && k === hk.moveToTile && isMyTurn) {
          e.preventDefault();
          const targetCoord = appState.inspectedCell || viewer.position || "B1";
          const targetCell = gs.romeBoard && gs.romeBoard[targetCoord];
          if (targetCell) {
            const currCellObj = viewer.position && gs.romeBoard ? gs.romeBoard[viewer.position] : null;
            const currOutDirs = (currCellObj && currCellObj.revealed && currCellObj.revealed.outgoingDirections) || {};
            let moveDir = null;
            let adjInfo = null;
            for (const [dir, dInfo] of Object.entries(currOutDirs)) {
              if (dInfo && dInfo.targetCell === targetCoord) {
                adjInfo = { dir, ...dInfo };
                const riverBlocked = Boolean(dInfo.blockedByRiver) || isTiberCrossingBlocked(viewer.position, targetCoord);
                if (!riverBlocked && (dInfo.passable || (viewer.turnEffects && viewer.turnEffects.shortcut))) {
                  moveDir = dir;
                }
              }
            }
            openConfirmScoutNeighborhoodModal(gs, viewer, targetCoord, targetCell, { moveDir, adjInfo });
          }
          return;
        }
        if (hk.endTurn && k === hk.endTurn && gs.phase === "delivery" && gs.activePlayerIndex === viewer.index && !gs.pendingEncounter) {
          e.preventDefault();
          sendGameAction({ type: "delivery_end_turn" });
          return;
        }
      }

      if ((e.code === "Numpad5" || (e.location === 3 && e.key === "5") || (hk.toggleCartNav && k === hk.toggleCartNav)) && !hasOpenModal) {
        e.preventDefault();
        appState.cartPanelTab = appState.cartPanelTab === "navigate" ? "cart" : "navigate";
        renderApp();
      } else if (hk.viewMarketBoard && k === hk.viewMarketBoard && !hasOpenModal) {
        e.preventDefault();
        appState.boardViewMode = appState.boardViewMode === "market" ? "auto" : "market";
        renderApp();
      } else if (hk.viewRomeBoard && k === hk.viewRomeBoard && !hasOpenModal) {
        e.preventDefault();
        appState.boardViewMode = appState.boardViewMode === "rome" ? "auto" : "rome";
        renderApp();
      } else if (hk.viewClimateBoard && k === hk.viewClimateBoard && !hasOpenModal) {
        e.preventDefault();
        appState.boardViewMode = appState.boardViewMode === "climate" ? "auto" : "climate";
        renderApp();
      } else if (hk.viewAllBoards && k === hk.viewAllBoards && !hasOpenModal) {
        e.preventDefault();
        appState.boardViewMode = appState.boardViewMode === "both" ? "auto" : "both";
        renderApp();
      }
    }
  });
}

window.addEventListener("DOMContentLoaded", () => {
  installDelayedHoverTooltips();
  installGlobalHotkeys();
  bootstrap();
});


